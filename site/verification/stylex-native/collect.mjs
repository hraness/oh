import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assertListenerOwner, bounded, observeChild, OwnedProcesses, parseListenerPids, parseProcessRows, preservingCleanup, ResourceTracker } from './support.mjs';
import { acceptance, assertBaselineRange, assertInstalled, assertScriptMode, baselineObservations, captureScreenshot, captureSnapshot, expectedMedia, inheritedSchedulerEnvironment, legacyBase, originalsCollected, settle, totalDeadlineMs } from './contract.mjs';
import { proveInteractions, proveRoles } from './surfaces.mjs';

// Build and observe the exact legacy Oh site. This entry point is native-only;
// importing it is not a pure check. The adjacent modules contain pure contracts.
// No source changes, provider traffic, credentials, installs, or cache cleanup.
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert.match(process.argv[i], /^--[a-z-]+$/);
  assert.ok(process.argv[i + 1]);
  assert.ok(!args.has(process.argv[i]));
  args.set(process.argv[i], process.argv[i + 1]);
}
assert.deepEqual([...args.keys()].sort(), ['--bun', '--node-sha', '--chromium', '--chromium-sha', '--chromium-version', '--expected-head', '--output', '--playwright', '--repo'].sort());
const root = await realpath(args.get('--repo'));
const site = join(root, 'site');
assert.match(args.get('--expected-head'), /^[a-f0-9]{40}$/);
for (const key of ['--node-sha', '--chromium-sha']) assert.match(args.get(key), /^[a-f0-9]{64}$/);
const output = resolve(args.get('--output'));
const executablePath = await realpath(args.get('--chromium'));
const bun = await realpath(args.get('--bun'));
const node = await realpath(process.execPath);
const playwrightEntry = await realpath(args.get('--playwright'));
const playwrightRoot = dirname(playwrightEntry);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile);
const git = async (...argv) => (await run('/usr/bin/git', ['--no-optional-locks', '-C', root, ...argv], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trimEnd();
const inside = (parent, child) => { const path = relative(parent, child); return path !== '' && !isAbsolute(path) && path !== '..' && !path.startsWith('../'); };
assert.equal(process.version, 'v24.18.1');
assert.equal(hash(await readFile(node)), args.get('--node-sha'));
assert.equal((await run(bun, ['--version'], { timeout: 5000 })).stdout.trim(), '1.3.14');
assert.equal(JSON.parse(await readFile(join(playwrightRoot, 'package.json'), 'utf8')).version, '1.62.0');
assert.equal(JSON.parse(await readFile(join(playwrightRoot, 'package.json'), 'utf8')).name, 'playwright-core');
assert.ok(!inside(root, output) && output !== root, 'Evidence must be outside the source checkout');
for (const directory of [root, site]) for (const name of await readdir(directory)) {
  assert.ok(!name.startsWith('.env'), 'Refusing implicit environment-file inputs');
}
assert.equal(await git('status', '--porcelain=v1', '--untracked-files=all'), '');
assert.equal(await git('rev-parse', 'HEAD'), args.get('--expected-head'));
assert.equal(await git('merge-base', legacyBase, 'HEAD'), legacyBase);
assertBaselineRange((await git('diff', '--name-only', legacyBase, 'HEAD')).split('\n'));
assert.equal(hash(await readFile(executablePath)), args.get('--chromium-sha'));
assert.ok((await lstat(executablePath)).isFile());
assert.ok(!(await lstat(output).catch((error) => { if (error.code === 'ENOENT') return null; throw error; })), 'Evidence target must be absent');
assert.equal(await realpath(dirname(output)), dirname(output), 'Evidence parent must be canonical');
await mkdir(output, { mode: 0o700 });
await mkdir(join(output, 'runtime'), { mode: 0o700 });

async function fileRecord(path, label, expectedBlob) {
  const info = await lstat(path);
  assert.ok(info.isFile() && !info.isSymbolicLink(), `Nonordinary file: ${label}`);
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await descriptor.stat();
    assert.ok(opened.isFile() && opened.ino === info.ino && opened.dev === info.dev);
    const bytes = await descriptor.readFile();
    const after = await descriptor.stat();
    assert.equal(after.size, bytes.length);
    assert.equal(after.mtimeMs, opened.mtimeMs);
    if (expectedBlob) assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), expectedBlob, `Git blob drift: ${label}`);
    return { path: label, mode: opened.mode & 0o777, bytes: bytes.length, sha256: hash(bytes) };
  } finally { await descriptor.close(); }
}
async function sourceInventory() {
  assert.equal(await git('rev-parse', 'HEAD'), args.get('--expected-head'));
  assert.equal(await git('diff', '--cached', '--name-only'), '');
  const paths = (await git('ls-files', '--stage', '-z')).split('\0').filter(Boolean).sort();
  const result = [];
  for (const entry of paths) {
    const match = /^(100644|100755) ([a-f0-9]{40}) 0\t(.+)$/s.exec(entry);
    assert.ok(match, 'Source index must contain only ordinary stage-zero files');
    const record = await fileRecord(join(root, match[3]), match[3], match[2]);
    assert.equal(Boolean(record.mode & 0o111), match[1] === '100755', `Git mode drift: ${match[3]}`);
    result.push({ ...record, gitBlob: match[2] });
  }
  result.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return result;
}
async function inventory(directory, { cache = false, links = false } = {}, prefix = '', boundary = directory) {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!prefix && cache && name === 'cache') continue; // Next's non-served compiler cache only.
    const path = prefix ? `${prefix}/${name}` : name;
    const absolute = join(directory, name), info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      assert.ok(links && inside(boundary, await realpath(absolute)), `Unbounded symlink: ${path}`);
      result.push({ path, link: await readlink(absolute) });
    } else if (info.isDirectory()) result.push(...await inventory(absolute, { cache, links }, path, boundary));
    else result.push(await fileRecord(absolute, path));
  }
  return result;
}
const before = await sourceInventory();
const packageSource = JSON.parse(await readFile(join(site, 'package.json'), 'utf8'));
assert.equal(packageSource.scripts.build, 'next build --webpack');
assert.equal(packageSource.scripts.prebuild, 'bun run test');
assert.equal(packageSource.scripts.postbuild, 'bun test ./tests/runtime.test.ts');
assert.equal(packageSource.packageManager, 'bun@1.3.14');
const installedDirectory = await lstat(join(site, 'node_modules'));
assert.ok(installedDirectory.isDirectory() && !installedDirectory.isSymbolicLink(), 'Install must be an ordinary owned directory');
const installed = await inventory(join(site, 'node_modules'), { links: true });
const selectedVersions = {}, selectedPackageFiles = [];
for (const name of ['next', 'react', 'react-dom']) {
  const relativePath = `${name}/package.json`, absolute = join(site, 'node_modules', relativePath);
  assert.ok(inside(join(site, 'node_modules'), await realpath(absolute)));
  const descriptor = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try { assert.ok((await descriptor.stat()).isFile()); bytes = await descriptor.readFile(); }
  finally { await descriptor.close(); }
  const record = installed.find((row) => row.path === relativePath);
  assert.ok(record); assert.equal(hash(bytes), record.sha256); assert.equal(bytes.length, record.bytes);
  const metadata = JSON.parse(bytes.toString('utf8')); assert.equal(metadata.name, name);
  selectedVersions[name] = metadata.version; selectedPackageFiles.push(record);
  assert.equal(packageSource.dependencies[name], metadata.version);
}
assertInstalled(selectedVersions);
assert.equal(packageSource.dependencies['@hraness/ui'], 'github:hraness/ui#v0.4.10');
assert.equal(packageSource.dependencies['@hraness/design-kit'], 'github:hraness/design-kit#v0.4.0');
const playwrightFiles = await inventory(playwrightRoot);
const executables = await Promise.all([bun, node, executablePath].map((path) => fileRecord(path, path)));
const collectorPaths = [fileURLToPath(import.meta.url), ...['./support.mjs', './contract.mjs', './surfaces.mjs'].map((path) => fileURLToPath(new URL(path, import.meta.url)))];
const collectorFiles = await Promise.all(collectorPaths.map((path) => fileRecord(path, path)));
const scheduler = inheritedSchedulerEnvironment(process.env);
const recordedEnvironment = { PATH: `${dirname(node)}:${dirname(bun)}:/usr/bin:/bin`, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', TMPDIR: join(output, 'runtime'), ...scheduler.workerLimits };
const environment = { ...recordedEnvironment, ...scheduler.bindings };
const { chromium } = await import(pathToFileURL(playwrightEntry).href);
const receipt = {
  schema: 'oh-site-native-baseline-v1', startedAt: new Date().toISOString(),
  root, site, legacyBase, head: await git('rev-parse', 'HEAD'), tree: await git('rev-parse', 'HEAD^{tree}'),
  source: before, sourceSha256: hash(JSON.stringify(before)), build: null,
  installed, installedSha256: hash(JSON.stringify(installed)), selectedVersions, selectedPackageFiles, playwrightFiles, executables, collectorFiles,
  buildCommand: [bun, 'run', 'build'], environment: recordedEnvironment, schedulerBindings: scheduler.bindingEvidence, node: process.version,
  coverage: { cells: 58, observations: 116, modes: ['js', 'no-js'], absoluteDeadlineMs: totalDeadlineMs },
  browserExecutable: executablePath, browserExecutableSha256: args.get('--chromium-sha'),
  observations: [], errors: [], cleanup: { originalOperationsCollected: false }, work: 'pending', accepted: false,
};
const abort = new AbortController();
let server, browserServer, browser, port, browserPort, activeContext, activeCase, build, intentionalBrowserClose = false;
const children = [], pendingCloses = [], censusJobs = new Set();
const nativeProbes = new Set(), nativeProbeFailures = [], resourceTrackers = [];
function trackNativeProbe(original) {
  nativeProbes.add(original);
  original.then(() => nativeProbes.delete(original), (error) => {
    nativeProbes.delete(original); nativeProbeFailures.push(formatError(error));
  });
}
async function drainNativeProbes() {
  while (nativeProbes.size) await Promise.allSettled([...nativeProbes]);
  assert.deepEqual(nativeProbeFailures, [], 'A retained native probe failed');
}
const onSignal = (signal) => { abort.abort(new Error(`Cancelled: ${signal}`)); };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
const totalTimer = setTimeout(() => abort.abort(new Error('Baseline deadline exceeded (1800s)')), totalDeadlineMs);
const reserve = createServer();
const processes = new OwnedProcesses({
  census: async () => {
    const command = run('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,comm='], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
    const observerPid = command.child.pid;
    // Exclude only this exact, already-collected ps observer, never a name.
    return parseProcessRows((await command).stdout).filter((row) => row.pid !== observerPid);
  },
  signal: async (pid, signal) => { try { process.kill(pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } },
  wait: delay,
});
const censusTimer = setInterval(() => {
  if (censusJobs.size) return;
  const job = processes.scan().catch((error) => { receipt.errors.push(`census: ${error.message}`); abort.abort(error); }).finally(() => censusJobs.delete(job));
  censusJobs.add(job);
}, 1000);
let serverLog = '';
async function own(child, label) {
  const observer = observeChild(child, label); children.push(observer);
  await processes.add(child.pid, process.pid, label);
  return observer;
}
function check() { abort.signal.throwIfAborted(); }
async function step(promise, label, ms = 30_000) {
  check(); const result = await bounded(promise, ms, label, abort.signal); check(); return result;
}
async function closeContext(context) {
  const promise = context.close(); pendingCloses.push(promise); promise.catch(() => {});
  await bounded(promise, 5000, 'context close');
  if (activeContext === context) activeContext = null;
}
async function listenerPids(port) {
  try {
    return parseListenerPids((await run('/usr/sbin/lsof', ['-nP', '-a', '-iTCP:' + port, '-sTCP:LISTEN', '-Fp'], { timeout: 5000, maxBuffer: 64 * 1024 })).stdout);
  } catch (error) {
    if (error.code === 1 && error.stdout === '' && error.stderr === '') return [];
    throw error;
  }
}
async function proveServerListener() {
  const alive = await processes.alive();
  const pids = await listenerPids(port); assertListenerOwner(pids, alive, server.pid);
  return { port, pids, identities: alive.filter((row) => pids.includes(row.pid)) };
}

try {
  // Observe this invocation's descendant lineage during acquisition as well;
  // the controller itself is immutable evidence, never a cleanup target.
  await processes.add(process.pid, process.ppid, 'collector', { controlOnly: true });
  check();
  const buildChild = spawn(bun, ['run', 'build'], { cwd: site, env: environment, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let buildLog = '';
  for (const stream of [buildChild.stdout, buildChild.stderr]) stream.on('data', (bytes) => { buildLog = (buildLog + bytes.toString()).slice(-1024 * 1024); });
  const built = await own(buildChild, 'ordinary-build');
  try {
    const result = await step(built.complete, 'ordinary build', 600_000);
    assert.equal(result.exit.code, 0, buildLog);
    assert.equal(result.exit.signal, null);
    receipt.buildExit = result;
  } finally { await writeFile(join(output, 'build.log'), buildLog, { mode: 0o600, flag: 'wx' }); }
  assert.deepEqual(await sourceInventory(), before);
  assert.equal(await git('status', '--porcelain=v1', '--untracked-files=all'), '');
  assert.deepEqual(await inventory(join(site, 'node_modules'), { links: true }), installed);
  build = await inventory(join(site, '.next'), { cache: true });
  assert.ok(build.length > 0);
  receipt.build = build; receipt.buildSha256 = hash(JSON.stringify(build));
  await new Promise((done, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', done); });
  port = reserve.address().port;
  await new Promise((done, reject) => reserve.close((error) => error ? reject(error) : done()));
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [join(site, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: site, env: environment, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (bytes) => { serverLog = (serverLog + bytes.toString()).slice(-1024 * 1024); });
  await own(server, 'production-server');
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    check();
    assert.equal(server.exitCode, null, serverLog);
    assert.equal(server.signalCode, null, serverLog);
    const response = await fetch(`${origin}/`, { redirect: 'manual', signal: AbortSignal.timeout(1000) }).catch(() => null);
    if (response?.status === 200) { await response.arrayBuffer(); ready = true; break; }
    await response?.body?.cancel();
    await delay(200);
  }
  assert.ok(ready, `Production server not ready: ${serverLog}`);
  receipt.serverListener = await proveServerListener();
  // launchServer has its own 30s acquisition/cleanup bound; do not race away a lease.
  browserServer = await chromium.launchServer({ executablePath, headless: true, timeout: 30_000, env: environment, host: '127.0.0.1' });
  await own(browserServer.process(), 'chromium');
  const endpoint = new URL(browserServer.wsEndpoint());
  assert.equal(endpoint.protocol, 'ws:'); assert.equal(endpoint.hostname, '127.0.0.1');
  browserPort = Number(endpoint.port); assert.ok(Number.isInteger(browserPort) && browserPort > 0);
  assert.deepEqual(await listenerPids(browserPort), [process.pid], 'Browser transport must belong to the collector');
  receipt.browserTransport = { port: browserPort, pid: process.pid };
  check();
  browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 30_000 });
  browser.on('disconnected', () => { if (!intentionalBrowserClose) abort.abort(new Error('Unexpected browser disconnect')); });
  receipt.browserVersion = browser.version();
  assert.equal(receipt.browserVersion, args.get('--chromium-version'));
  const cases = baselineObservations();
  assert.equal(cases.length, 116);
  for (const [index, settings] of cases.entries()) {
    check();
    await proveServerListener();
    activeCase = (async () => {
    const context = await browser.newContext({ viewport: { width: settings.width, height: settings.height }, colorScheme: settings.colorScheme,
      forcedColors: settings.forcedColors, reducedMotion: settings.reducedMotion, hasTouch: settings.coarse,
      javaScriptEnabled: settings.javaScriptEnabled, deviceScaleFactor: 1,
      serviceWorkers: 'block' });
    activeContext = context;
    await preservingCleanup(async () => {
      check();
      const resources = new ResourceTracker(origin);
      resourceTrackers.push(resources);
      let page;
      const request = (value) => {
        try {
          if (settings.expectedStatus === 404 && value.url() === `${origin}${settings.route}` && value.isNavigationRequest()
            && value.resourceType() === 'document' && value.frame() === page?.mainFrame()) resources.allowMissingDocument(value);
        } catch (error) { resources.errors.push(error); }
        resources.start(value);
      };
      const finished = (value) => resources.finish(value);
      const failed = (value) => resources.finish(value, value.failure()?.errorText ?? 'Unknown failure');
      const responseReceived = (value) => resources.response(value);
      context.on('request', request); context.on('requestfinished', finished);
      context.on('requestfailed', failed); context.on('response', responseReceived);
      await context.route('**/*', (route) => {
        return resources.task((async () => {
          try { resources.local(route.request().url()); }
          catch (error) { resources.errors.push(error); await route.abort(); return; }
          await route.continue();
        })());
      });
      await context.routeWebSocket('**/*', (socket) => {
        resources.errors.push(new Error('Unexpected WebSocket request'));
        socket.close({ code: 1008, reason: 'Baseline permits ordinary loopback HTTP only' });
      });
      page = await context.newPage();
      const pageErrors = [], consoleErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url }); });
      await page.emulateMedia({ media: settings.media });
      const response = await page.goto(`${origin}${settings.route}`, { waitUntil: 'networkidle', timeout: 30_000 });
      assert.equal(response.status(), settings.expectedStatus);
      assert.equal(response.url(), origin + settings.route);
      assert.ok(response.request().isNavigationRequest() && response.request().frame() === page.mainFrame());
      const bodyProbe = response.text(); trackNativeProbe(bodyProbe);
      const html = await step(bodyProbe, 'actual document body', 5000);
      const pageScriptMode = await page.evaluate(() => ({
        scripts: [...document.scripts].filter((node) => /^\(self\.__next_f=self\.__next_f\|\|\[\]\)\.push\(\[0\]\)/.test(node.textContent))
          .map((node) => ({ type: node.type, src: node.getAttribute('src'), text: node.textContent, outerHTML: node.outerHTML })),
        ownGlobal: Object.hasOwn(globalThis, '__next_f'), arrayGlobal: Array.isArray(globalThis.__next_f),
      }));
      assertScriptMode(settings.javaScriptEnabled, html, pageScriptMode);
      const capture = () => page.locator('body').evaluate(captureSnapshot, expectedMedia(settings));
      const paint = () => settle({ capture, wait: delay, track: trackNativeProbe, signal: abort.signal });
      await paint(); await resources.settle({ wait: delay });
      const surface = await proveRoles(page, settings);
      const states = [];
      const record = async (name, fullPage) => {
        const captured = await captureScreenshot({ settings, fullPage, settle: paint, capture,
          screenshot: (options) => page.screenshot(options) });
        const filename = settings.observationId + '-' + name;
        await writeFile(join(output, filename + '.png'), captured.bytes, { mode: 0o600, flag: 'wx' });
        const state = { name, snapshot: captured.snapshot, screenshotProof: captured.proof,
          screenshot: filename + '.png', screenshotSha256: hash(captured.bytes) };
        states.push(state); return state;
      };
      await record('initial', true);
      const interaction = await proveInteractions(page, settings, paint, record);
      await paint();
      await resources.settle({ wait: delay });
      assert.deepEqual(pageErrors, []);
      resources.assertConsole(consoleErrors);
      assert.ok(browser.isConnected() && !page.isClosed());
      resources.seal();
      check();
      const observation = { settings, pageScriptMode, documentSha256: hash(html), surface, states, interaction, resources: resources.records };
      const filename = settings.observationId + '.json';
      const serialized = JSON.stringify(observation, null, 2) + '\n';
      await writeFile(join(output, filename), serialized, { mode: 0o600, flag: 'wx' });
      // Preserve listeners through intentional closure; late resource admission is red.
      await closeContext(context);
      resources.assertClean(); assert.deepEqual(pageErrors, []); resources.assertConsole(consoleErrors);
      assert.ok(browser.isConnected()); check();
      receipt.observations.push({ observationId: settings.observationId, settings, record: filename,
        recordSha256: hash(serialized), states: states.map((state) => ({ name: state.name, screenshotSha256: state.screenshotSha256 })) });
      process.stdout.write('Oh baseline ' + (index + 1) + '/116 ' + settings.observationId + ' ' + settings.route + '\n');
    }, async () => { if (activeContext === context) await closeContext(context); });
    })();
    activeCase.catch(() => {});
    try { await step(activeCase, `case ${index + 1}`, 60_000); }
    catch (error) { abort.abort(error); throw error; }
    activeCase = null;
  }
  assert.equal(receipt.observations.length, 116);
  receipt.serverListenerAfter = await proveServerListener();
  check();
  assert.deepEqual(await sourceInventory(), before);
  assert.equal(await git('status', '--porcelain=v1', '--untracked-files=all'), '');
  assert.equal(hash(await readFile(executablePath)), args.get('--chromium-sha'));
  receipt.work = 'passed';
} catch (error) {
  receipt.work = 'failed'; receipt.errors.push(formatError(error));
} finally {
  clearTimeout(totalTimer);
  clearInterval(censusTimer);
  await Promise.all([...censusJobs]);
  intentionalBrowserClose = true;
  for (const [label, close] of [
    ['context', async () => { if (activeContext) await closeContext(activeContext); }],
    ['browser', async () => { if (browser) await browser.close(); }],
    ['browserServer', async () => { if (browserServer) await browserServer.close(); }],
  ]) {
    const promise = Promise.resolve().then(close); pendingCloses.push(promise); promise.catch(() => {});
    try { await bounded(promise, 5000, label); receipt.cleanup[`${label}Closed`] = true; }
    catch (error) { receipt.errors.push(`${label} cleanup: ${formatError(error)}`); }
  }
  // Exact recorded PID/start identities only; TERM, finite grace, then KILL.
  try { receipt.cleanup.processes = await processes.stop(); }
  catch (error) { receipt.errors.push(formatError(error)); }
  const collections = [...pendingCloses, ...children.map((child) => child.complete), ...(activeCase ? [activeCase] : []),
    drainNativeProbes(), ...resourceTrackers.map((tracker) => tracker.drain())];
  const terminal = Promise.allSettled(collections);
  try {
    const results = await bounded(terminal, 10_000, 'original operation and EOF collection');
    for (const result of results) if (result.status === 'rejected') receipt.errors.push(formatError(result.reason));
    receipt.cleanup.nativeProbes = { pending: nativeProbes.size, failures: nativeProbeFailures.length };
    receipt.cleanup.resources = resourceTrackers.map((tracker) => ({ pending: tracker.pending.size, tasks: tracker.tasks.size, responses: tracker.records.length }));
    receipt.cleanup.originalOperationsCollected = originalsCollected(nativeProbes.size, receipt.cleanup.resources, children.map((child) => child.result));
    assert.equal(receipt.cleanup.originalOperationsCollected, true, 'Original probes, resources or child EOFs remain uncollected');
  } catch (error) { receipt.errors.push(formatError(error)); }
  receipt.cleanup.children = children.map((child) => child.result);
  if (reserve.listening) await new Promise((done) => reserve.close(done));
  if (port) {
    try {
      await assertPortAbsent(port); assert.deepEqual(await listenerPids(port), []);
      if (browserPort) { await assertPortAbsent(browserPort); assert.deepEqual(await listenerPids(browserPort), []); }
      await delay(200); await assertPortAbsent(port); assert.deepEqual(await listenerPids(port), []);
      if (browserPort) { await assertPortAbsent(browserPort); assert.deepEqual(await listenerPids(browserPort), []); }
      receipt.cleanup.loopbackClosed = true;
    } catch (error) { receipt.errors.push(formatError(error)); }
  }
  try {
    assert.deepEqual(await sourceInventory(), before);
    assert.equal(await git('status', '--porcelain=v1', '--untracked-files=all'), '');
    assert.deepEqual(await inventory(join(site, 'node_modules'), { links: true }), installed);
    assert.deepEqual(await inventory(playwrightRoot), playwrightFiles);
    assert.deepEqual(await Promise.all([bun, node, executablePath].map((path) => fileRecord(path, path))), executables);
    assert.deepEqual(await Promise.all(collectorPaths.map((path) => fileRecord(path, path))), collectorFiles);
    if (build) assert.deepEqual(await inventory(join(site, '.next'), { cache: true }), build);
    receipt.cleanup.inputsAndServedOutputsUnchanged = true;
  } catch (error) { receipt.errors.push(formatError(error)); }
  process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  receipt.finishedAt = new Date().toISOString();
  receipt.cleanup.browserDisconnected = browser ? !browser.isConnected() : false;
  receipt.accepted = !abort.signal.aborted && acceptance(receipt);
  receipt.state = receipt.accepted ? 'complete' : 'failed';
  await writeFile(join(output, 'server.log'), serverLog, { mode: 0o600, flag: 'wx' });
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ accepted: receipt.accepted, observations: receipt.observations.length, errorCount: receipt.errors.length,
    errorsSha256: hash(JSON.stringify(receipt.errors)), cleanupSha256: hash(JSON.stringify(receipt.cleanup)),
    receipt: join(output, 'receipt.json'), receiptSha256: hash(JSON.stringify(receipt, null, 2) + '\n'),
    sourceSha256: receipt.sourceSha256, buildSha256: receipt.buildSha256 }) + '\n');
  process.exitCode = receipt.accepted ? 0 : 1;
}

function formatError(error) {
  if (error instanceof AggregateError) return `${error.message}\n${error.errors.map(formatError).join('\n')}`;
  return String(error?.stack ?? error).slice(0, 16_384);
}
function assertPortAbsent(port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); reject(new Error('Loopback listener survived')); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Cannot prove loopback listener absence')); });
    socket.once('error', (error) => { socket.destroy(); if (error.code === 'ECONNREFUSED') resolve(); else reject(error); });
  });
}
