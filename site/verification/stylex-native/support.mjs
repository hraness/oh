import assert from 'node:assert/strict';

export function bounded(promise, milliseconds, label, signal) {
  assert.ok(Number.isFinite(milliseconds) && milliseconds > 0);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      handler(value);
    };
    const abort = () => finish(reject, signal.reason ?? new Error(`Cancelled: ${label}`));
    const timer = setTimeout(() => finish(reject, new Error(`Timeout: ${label}`)), milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error));
    if (signal?.aborted) abort();
  });
}

export async function preservingCleanup(body, cleanup) {
  let value, primary, secondary;
  try { value = await body(); } catch (error) { primary = error; }
  try { await cleanup(); } catch (error) { secondary = error; }
  if (primary && secondary) throw new AggregateError([primary, secondary], 'Case and cleanup failed');
  if (primary) throw primary;
  if (secondary) throw secondary;
  return value;
}

export function parseProcessRows(stdout) {
  return stdout.split('\n').filter((line) => line.trim()).map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(line);
    assert.ok(match, 'Unsupported process identity row');
    return { pid: Number(match[1]), ppid: Number(match[2]), started: match[3].replace(/\s+/g, ' '), command: match[4] };
  });
}

export function sameProcess(expected, actual) {
  // Command may legitimately change through exec; kernel creation time may not.
  return actual?.pid === expected.pid && actual.started === expected.started;
}

export function parseListenerPids(text) {
  if (text === '') return [];
  // Native lsof -Fp always includes file-descriptor records. A process group
  // must contain at least one ordinary numeric descriptor; no other fields
  // are selected by this exact listener query or admitted by this parser.
  const lines = (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
  const pids = [], owners = new Set();
  let descriptors = null;
  for (const line of lines) {
    if (/^p[1-9]\d*$/.test(line)) {
      assert.ok(descriptors === null || descriptors.size > 0, 'Listener owner lacks a descriptor');
      const pid = Number(line.slice(1)); assert.ok(Number.isSafeInteger(pid) && pid > 1);
      assert.ok(!owners.has(pid), 'Duplicate listener owner');
      owners.add(pid); pids.push(pid); descriptors = new Set();
    } else {
      assert.match(line, /^f(?:0|[1-9]\d*)$/, 'Unsupported listener field');
      assert.ok(descriptors !== null, 'Listener descriptor lacks an owner');
      const descriptor = Number(line.slice(1)); assert.ok(Number.isSafeInteger(descriptor));
      assert.ok(!descriptors.has(descriptor), 'Duplicate listener descriptor');
      descriptors.add(descriptor);
    }
  }
  assert.ok(descriptors !== null && descriptors.size > 0, 'Listener owner lacks a descriptor');
  return pids;
}

export function assertListenerOwner(pids, owned, rootPid) {
  assert.ok(pids.length > 0, 'No positively identified listener');
  const byPid = new Map(owned.map((row) => [row.pid, row]));
  for (const pid of pids) {
    const seen = new Set(); let current = pid;
    while (current !== rootPid) {
      assert.ok(!seen.has(current), 'Listener ownership cycle'); seen.add(current);
      const row = byPid.get(current); assert.ok(row, 'Foreign listener owner');
      current = row.admittedParent;
    }
    assert.ok(byPid.has(rootPid), 'Listener root identity missing');
  }
}

// All external effects are injected so signal escalation is tested without
// launching or signalling any real process. No process-group or name matching.
export class OwnedProcesses {
  constructor({ census, signal, wait, now = Date.now }) {
    this.census = census; this.signal = signal; this.wait = wait; this.now = now;
    this.owned = new Map(); this.history = []; this.events = []; this.chain = Promise.resolve();
  }
  async add(pid, parentPid, label, { controlOnly = false } = {}) {
    const rows = await this.census();
    const row = rows.find((entry) => entry.pid === pid);
    assert.ok(row && row.ppid === parentPid, `Unproven direct child: ${label}`);
    const admitted = { ...row, label, admittedParent: parentPid, controlOnly };
    this.owned.set(pid, admitted); this.history.push(admitted);
    await this.scan();
  }
  scan() {
    const next = this.chain.then(async () => {
      const rows = await this.census();
      for (let changed = true; changed;) {
        changed = false;
        for (const row of rows) {
          const parent = this.owned.get(row.ppid);
          const previous = this.owned.get(row.pid);
          if (!parent || (previous && sameProcess(previous, row))) continue;
          if (!sameProcess(parent, rows.find((candidate) => candidate.pid === parent.pid))) continue;
          const admitted = { ...row, label: `${parent.label}/child`, admittedParent: row.ppid };
          this.owned.set(row.pid, admitted); this.history.push(admitted);
          changed = true;
        }
      }
      return rows;
    });
    // Keep the chain drainable after a failed observation; caller retains error.
    this.chain = next.catch(() => {});
    return next;
  }
  async alive() {
    const rows = await this.scan();
    return [...this.owned.values()].filter((entry) => !entry.controlOnly && sameProcess(entry, rows.find((row) => row.pid === entry.pid)));
  }
  async send(entry, signal) {
    assert.ok(!entry.controlOnly, 'Controller is never a signal target');
    const actual = (await this.census()).find((row) => row.pid === entry.pid);
    if (!actual) return;
    assert.ok(sameProcess(entry, actual), `Refusing reused PID ${entry.pid}`);
    assert.ok(entry.pid > 1, 'Invalid owned PID');
    await this.signal(entry.pid, signal);
    this.events.push({ pid: entry.pid, started: entry.started, signal });
  }
  async stop({ grace = 5000, killGrace = 5000 } = {}) {
    const errors = [];
    for (const [signal, duration] of [['SIGTERM', grace], ['SIGKILL', killGrace]]) {
      const end = this.now() + duration;
      const sent = new Set();
      while (true) {
        const alive = await this.alive();
        if (!alive.length) break;
        // Children before roots; each PID is independently re-resolved at send.
        for (const entry of alive.reverse()) {
          const identity = `${entry.pid}:${entry.started}`;
          if (sent.has(identity)) continue;
          sent.add(identity);
          try { await this.send(entry, signal); } catch (error) { errors.push(error); }
        }
        if (this.now() >= end) break;
        await this.wait(Math.min(100, end - this.now()));
      }
    }
    const survivors = await this.alive();
    if (survivors.length) errors.push(new Error(`Owned survivors: ${survivors.map((row) => row.pid).join(',')}`));
    if (errors.length) throw new AggregateError(errors, 'Owned process cleanup failed');
    return { identities: this.history, signals: this.events, survivors: [] };
  }
}

export function observeChild(child, label) {
  const result = { label, pid: child.pid, exit: null, closed: false, stdoutEOF: false, stderrEOF: false, errors: [] };
  const exit = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      result.exit = { code: child.exitCode, signal: child.signalCode }; resolve(result.exit);
    } else child.once('exit', (code, signal) => { result.exit = { code, signal }; resolve(result.exit); });
  });
  const close = new Promise((resolve) => child.once('close', () => { result.closed = true; resolve(); }));
  child.on('error', (error) => result.errors.push(error.message));
  const eof = (stream, name) => new Promise((resolve, reject) => {
    if (!stream || stream.readableEnded) { result[name] = true; resolve(); return; }
    stream.once('end', () => { result[name] = true; resolve(); });
    stream.once('error', reject);
    stream.once('close', () => { if (!result[name]) reject(new Error(`${label}: ${name} closed without EOF`)); });
    stream.resume();
  });
  const complete = Promise.all([exit, close, eof(child.stdout, 'stdoutEOF'), eof(child.stderr, 'stderrEOF')]).then(() => {
    assert.deepEqual(result.errors, [], `${label} child errors`);
    return result;
  });
  complete.catch(() => {});
  return { result, exit, complete };
}

export class ResourceTracker {
  constructor(origin) { this.origin = origin; this.pending = new Set(); this.tasks = new Set(); this.errors = []; this.records = []; this.sealed = false; this.missingDocument = null; }
  allowMissingDocument(request) {
    assert.equal(this.missingDocument, null, 'Only one missing document admission');
    assert.equal(request.url(), `${this.origin}/__stylex-baseline-missing__`);
    assert.equal(request.isNavigationRequest(), true); assert.equal(request.resourceType(), 'document');
    this.missingDocument = { request, responseSeen: false };
  }
  assertConsole(errors) {
    let expectedMissing = 0;
    for (const error of errors) {
      if (this.missingDocument?.responseSeen && error.url === this.missingDocument.request.url()
        && error.text === 'Failed to load resource: the server responded with a status of 404 (Not Found)') {
        expectedMissing++; assert.ok(expectedMissing <= 1, 'Duplicate missing-document console error');
      } else throw new Error(`Console error: ${error.text}`);
    }
  }
  local(url) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, this.origin, 'Non-loopback resource');
    assert.equal(parsed.protocol, 'http:');
    assert.equal(parsed.username + parsed.password, '');
  }
  start(request) {
    try { this.local(request.url()); assert.ok(!this.sealed, 'Resource admitted after seal'); }
    catch (error) { this.errors.push(error); }
    this.pending.add(request);
  }
  finish(request, failure = null) {
    if (!this.pending.delete(request)) this.errors.push(new Error('Unmatched resource completion'));
    if (failure) this.errors.push(new Error(`Request failed: ${request.url()} ${failure}`));
  }
  task(promise) {
    let task;
    task = Promise.resolve(promise).catch((error) => this.errors.push(error)).finally(() => this.tasks.delete(task));
    this.tasks.add(task);
    return task;
  }
  response(response) {
    this.task((async () => {
      this.local(response.url());
      const status = response.status();
      const expectedMissing = status === 404 && this.missingDocument && this.missingDocument.request === response.request()
        && response.url() === `${this.origin}/__stylex-baseline-missing__`;
      assert.ok(status >= 200 && status < 400 || expectedMissing, `Resource HTTP ${status}: ${response.url()}`);
      if (expectedMissing) { assert.equal(this.missingDocument.responseSeen, false); this.missingDocument.responseSeen = true; }
      const failure = await response.finished();
      assert.equal(failure, null, `Incomplete response: ${response.url()}`);
      this.records.push({ url: response.url(), status });
    })());
  }
  async settle({ milliseconds = 5000, wait, now = Date.now } = {}) {
    const end = now() + milliseconds;
    // Two quiet event-loop observations, while preserving every original task.
    let quiet = 0;
    while (quiet < 2) {
      assert.ok(now() < end, `Resource settlement timeout: ${[...this.pending].map((request) => request.url()).slice(0, 16).join(',')}`);
      if (this.tasks.size) await bounded(Promise.all([...this.tasks]), Math.max(1, end - now()), 'response collection');
      quiet = this.pending.size === 0 && this.tasks.size === 0 ? quiet + 1 : 0;
      await wait(0);
    }
    this.assertClean();
  }
  assertClean() { if (this.errors.length) throw new AggregateError(this.errors, 'Resource failures'); }
  seal() { assert.equal(this.pending.size + this.tasks.size, 0); this.assertClean(); this.sealed = true; }
  async drain() {
    // Called after browser transport/process teardown; retain original promises
    // even if the earlier quiet/settlement wrapper timed out.
    while (this.tasks.size) await Promise.allSettled([...this.tasks]);
    assert.equal(this.pending.size, 0, 'Uncollected original resource requests');
    this.assertClean();
    return { pending: this.pending.size, tasks: this.tasks.size, records: this.records.length };
  }
}
