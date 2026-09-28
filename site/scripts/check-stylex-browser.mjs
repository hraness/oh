import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { log } from "node:console";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { withReducedTransparency } from "./browser-transparency.mjs";
import { inspectBenchmark, runBenchmarkAccessibilityCases } from "./check-benchmark-browser.mjs";

// Use an explicitly selected installed browser, never a signed-in profile or an
// implicit download. Run after `bun run build`, under the repository scheduler.
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
assert.ok(executablePath, "Set CHROMIUM_EXECUTABLE_PATH to an installed Chromium executable.");
const site = fileURLToPath(new URL("../", import.meta.url));
const artifacts = process.env.OH_BROWSER_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });

function startServer() {
  const child = spawn(join(site, "node_modules/.bin/next"), [
    "start", "--hostname", "127.0.0.1", "--port", "0",
  ], { cwd: site, env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise((resolve) => child.once("close", resolve));
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`Next startup timed out.\n${output}`)), 15_000);
    const capture = (chunk) => {
      output = (output + chunk.toString()).slice(-16_000);
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/u);
      if (match && output.includes("Ready in")) {
        clearTimeout(deadline);
        resolve(`http://127.0.0.1:${match[1]}`);
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", (error) => { clearTimeout(deadline); reject(error); });
    child.once("close", (code) => {
      clearTimeout(deadline);
      reject(new Error(`Next exited ${code}.\n${output}`));
    });
  });
  return { child, closed, ready };
}

async function stopServer(server) {
  if (server.child.exitCode !== null || server.child.signalCode !== null) {
    await server.closed;
    return;
  }
  server.child.kill("SIGTERM");
  const deadline = setTimeout(() => server.child.kill("SIGKILL"), 5_000);
  try { await server.closed; } finally { clearTimeout(deadline); }
}

function closeTo(actual, expected, label) {
  assert.ok(Math.abs(Number.parseFloat(actual) - expected) < 0.15, `${label}: ${actual}, expected ${expected}px`);
}

function collectPageFailures(page, failedRequests) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("requestfailed", (request) => {
    const event = { url: request.url(), method: request.method(), resourceType: request.resourceType(), failure: request.failure() };
    if (failedRequests) failedRequests.push(event);
    else failures.push(`Request failed: ${new URL(event.url).pathname}: ${event.failure?.errorText}`);
  });
  return failures;
}

const nativeMediaSessions = new WeakMap();
async function nativeMediaSession(page) {
  let session = nativeMediaSessions.get(page);
  if (!session) {
    session = await page.context().newCDPSession(page);
    nativeMediaSessions.set(page, session);
  }
  // Chromium clears emulated media on detach. The page/context owns this
  // session for the entire case and closes it in the existing finally block.
  return session;
}

async function selectNativeMedia(page, overrides) {
  const features = await page.evaluate((overrides) => Object.entries({
    "prefers-color-scheme": matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    "prefers-reduced-motion": matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "no-preference",
    "prefers-reduced-transparency": matchMedia("(prefers-reduced-transparency: reduce)").matches ? "reduce" : "no-preference",
    "forced-colors": matchMedia("(forced-colors: active)").matches ? "active" : "none",
    ...overrides,
  }).map(([name, value]) => ({ name, value })), overrides);
  const session = await nativeMediaSession(page);
  await session.send("Emulation.setEmulatedMedia", { features });
  assert.equal(await page.evaluate((features) => features.every(({ name, value }) => matchMedia(`(${name}: ${value})`).matches), features), true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function inspectAppearanceCases(browser, origin) {
  const rows = [];
  const expected = { light: "rgb(251, 241, 199)", dark: "rgb(40, 40, 40)" };
  for (const width of [320, 390, 1440]) for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme, viewport: { width, height: 900 } });
    const failedRequests = [];
    let auditedRequestCount = 0;
    let failures;
    let scenarioError;
    try {
      const page = await context.newPage();
      failures = collectPageFailures(page, failedRequests);
      for (const route of ["/", "/spec"]) {
        assert.equal((await page.goto(`${origin}${route}`, { waitUntil: "networkidle" })).status(), 200);
        const paint = await page.evaluate(async () => {
          await document.fonts.ready;
          return { background: getComputedStyle(document.body).backgroundColor,
            palette: document.documentElement.dataset.palette,
            scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
            heading: document.querySelector("h1")?.textContent,
            recordKinds: [...document.querySelectorAll(".oh-rows dt code")].map(element => element.textContent),
            proof: document.querySelector(".oh-proof pre")?.textContent ?? null };
        });
        assert.equal(paint.background, expected[colorScheme]);
        assert.equal(paint.palette, "gruvbox");
        assert.ok(paint.scrollWidth <= width, `No-JavaScript content stays inside ${width}px viewport`);
        assert.equal(paint.viewportWidth, width, "Overflow must not expand the mobile viewport");
        assert.ok(paint.heading);
        assert.deepEqual(paint.recordKinds, route === "/" ? ["inquiry", "entity", "edition", "statement", "evidence", "view"] : []);
        if (route === "/") assert.match(paint.proof, /oh put --kind evidence/u);
        const declaredScripts = await page.locator('script[src], link[as="script"][href]').evaluateAll((nodes) => nodes.map((node) => node.src || node.href));
        // In a context with scripting explicitly disabled, Chromium cancels the
        // declared Next webpack preload with the exact "csp" reason. Retain the
        // raw event and reject every other failed request, including assets.
        const currentRequests = failedRequests.slice(auditedRequestCount);
        const disabledScriptCancellations = currentRequests.filter((event) => {
          const url = new URL(event.url);
          return event.method === "GET" && event.resourceType === "script" && event.failure?.errorText === "csp"
            && url.origin === origin && !url.search && !url.hash
            && /^\/_next\/static\/chunks\/webpack-[a-f0-9]+\.js$/u.test(url.pathname)
            && declaredScripts.includes(event.url);
        });
        assert.ok(disabledScriptCancellations.length <= 1, "At most the declared disabled webpack preload may be cancelled");
        assert.deepEqual(currentRequests, disabledScriptCancellations, "No-JavaScript rejects all unrelated failed requests");
        assert.deepEqual(failures, [], `No-JavaScript ${width} ${colorScheme} ${route}: runtime/resource failures`);
        rows.push({ label: `no-js-${width}-${colorScheme}-${route === "/" ? "home" : "spec"}`, paint, failures: [...failures], failedRequests: currentRequests, disabledScriptCancellations });
        auditedRequestCount = failedRequests.length;
      }
    } catch (error) {
      scenarioError = error;
    } finally {
      await context.close();
      try {
        assert.equal(failedRequests.length, auditedRequestCount, `No unclassified late no-JavaScript request failures: ${JSON.stringify(failedRequests.slice(auditedRequestCount))}`);
        if (failures) assert.deepEqual(failures, [], "No late no-JavaScript runtime/resource failures");
      } catch (lateError) {
        if (scenarioError) throw new AggregateError([scenarioError, lateError], "No-JavaScript scenario and late request audit failed");
        throw lateError;
      }
    }
    if (scenarioError) throw scenarioError;
  }
  for (const width of [320, 390, 1440]) {
    const context = await browser.newContext({ colorScheme: "light", viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      const failures = collectPageFailures(page);
      assert.equal((await page.goto(origin, { waitUntil: "networkidle" })).status(), 200);
      const menu = page.locator('[data-hraness-appearance-menu]');
      assert.equal(await menu.count(), 1);
      await page.waitForFunction(() => document.querySelector('[data-hraness-appearance-menu]')?.dataset.ready === "true");
      await menu.locator("summary").focus();
      await page.keyboard.press("Enter");
      await menu.getByRole("radio", { name: "Tokyo Night", exact: true }).check();
      await menu.getByRole("radio", { name: "Dark", exact: true }).check();
      await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(26, 27, 38)");
      const panel = await menu.locator(":scope > div").boundingBox();
      assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= width, `Appearance choices stay inside ${width}px viewport: ${JSON.stringify(panel)}`);
      await page.keyboard.press("Escape");
      assert.equal(await menu.evaluate((node) => node.open), false);
      assert.equal(await menu.locator("summary").evaluate((node) => document.activeElement === node), true);
      await page.goto(`${origin}/spec`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(26, 27, 38)", "Saved choice survives route and reload");
      await menu.locator("summary").click();
      await menu.getByRole("radio", { name: "Gruvbox", exact: true }).check();
      await menu.getByRole("radio", { name: "System", exact: true }).check();
      await selectNativeMedia(page, { "prefers-color-scheme": "dark" });
      await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(40, 40, 40)");
      await selectNativeMedia(page, { "prefers-color-scheme": "light" });
      await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(251, 241, 199)");
      assert.deepEqual(failures, [], `Appearance ${width}: runtime/resource failures`);
      rows.push({ label: `appearance-${width}`, savedPalette: "tokyo-night", savedMode: "dark", liveSystem: ["dark", "light"], keyboard: "passed", boundedPanel: panel, failures });
    } finally { await context.close(); }
  }
  return rows;
}

const server = startServer();
let browser;
let launchPromise;
let cleanupPromise;
let interrupted = false;
const evidence = [];
async function cleanup() {
  cleanupPromise ??= (async () => {
    try {
      const active = browser ?? await launchPromise?.catch(() => undefined);
      if (active) await active.close();
    } finally { await stopServer(server); }
  })();
  await cleanupPromise;
}
const signals = [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]];
for (const [signal, code] of signals) {
  process.once(signal, () => {
    interrupted = true;
    void cleanup().then(() => process.exit(code), () => process.exit(1));
  });
}
let browserVersion;
try {
  const origin = await server.ready;
  assert.equal(interrupted, false, "Browser run interrupted");
  launchPromise = chromium.launch({
    executablePath, headless: true, timeout: 15_000,
    handleSIGHUP: false, handleSIGINT: false, handleSIGTERM: false,
    args: ["--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4"],
  });
  browser = await launchPromise;
  assert.equal(interrupted, false, "Browser run interrupted");
  browserVersion = browser.version();
  for (const width of [360, 390, 1440]) {
    const mobile = width < 600;
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: mobile ? (width === 360 ? 740 : 844) : 900 },
        isMobile: mobile, hasTouch: mobile, colorScheme, reducedMotion: "no-preference", forcedColors: "none",
      });
      try {
        const page = await context.newPage();
        await selectNativeMedia(page, { "prefers-reduced-transparency": "no-preference" });
        const failures = collectPageFailures(page);
        for (const route of ["/", "/spec"]) {
          assert.equal((await page.goto(`${origin}${route}`, { waitUntil: "networkidle" })).status(), 200);
          await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          });
          const metrics = await page.evaluate(() => {
            const styles = (selector) => {
              const element = document.querySelector(selector);
              if (!element) return null;
              const style = getComputedStyle(element);
              return Object.fromEntries([
                "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
                "textTransform", "minBlockSize", "paddingBlockStart", "paddingBlockEnd", "backgroundImage",
                "backgroundColor", "backgroundSize", "color", "backdropFilter", "borderTopStyle", "borderTopWidth", "boxShadow",
              ].map((name) => [name, style[name]]));
            };
            const layers = [];
            const headingRules = [];
            const heading = document.querySelector("h1");
            const visit = (rules, parents = []) => {
              for (const rule of rules) {
                const next = rule.constructor.name === "CSSLayerBlockRule" ? [...parents, rule.name] : parents;
                if (next !== parents) layers.push(next.join("."));
                if (rule.selectorText && rule.style?.fontFamily && heading?.matches(rule.selectorText)) {
                  headingRules.push({ selector: rule.selectorText, layer: next.join("."), family: rule.style.fontFamily });
                }
                if (rule.styleSheet) visit(rule.styleSheet.cssRules, rule.layerName ? [...next, rule.layerName] : next);
                else if (rule.cssRules) visit(rule.cssRules, next);
              }
            };
            for (const sheet of document.styleSheets) visit(sheet.cssRules);
            return {
              scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
              background: getComputedStyle(document.body).backgroundColor,
              body: styles("body"), heading: styles("h1"),
              primaryAction: styles('.hraness-marketing-header .hraness-marketing-action[data-emphasis="primary"]'),
              sectionHeading: styles(".hraness-marketing-section__heading"),
              header: styles(".hraness-marketing-header__inner"),
              hero: styles(".hraness-marketing-hero"), field: styles(".oh-hero"),
              chrome: styles(".hraness-marketing-header"), pane: styles(".oh-terminal"),
              material: document.querySelector('[data-hraness-material="lantern"]') !== null,
              label: styles('[data-slot="ask-ai-about-this-label"]'),
              link: styles('[data-slot="ask-ai-about-this-link"]'),
              fonts: { body: document.fonts.check('16px "Nebula Sans"'), display: document.fonts.check('44px "Nebula Sans"') },
              loadedFonts: [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replaceAll('"', "")),
              layers, headingRules,
            };
          });
          const label = `${width}-${colorScheme}-${route === "/" ? "home" : "spec"}`;
          evidence.push({ label, metrics });
          if (artifacts) await page.screenshot({ path: join(artifacts, `${label}.png`) });
          assert.ok(metrics.scrollWidth <= width, `${label}: horizontal overflow`);
          assert.equal(metrics.viewportWidth, width, `${label}: requested viewport remains fixed`);
          assert.equal(metrics.background, colorScheme === "light" ? "rgb(251, 241, 199)" : "rgb(40, 40, 40)");
          assert.match(metrics.body.fontFamily, /Nebula Sans/u);
          assert.equal(metrics.primaryAction.color, colorScheme === "light" ? "rgb(251, 241, 199)" : "rgb(40, 40, 40)", "Primary action uses paired Gruvbox ink");
          assert.equal(metrics.primaryAction.backgroundImage, "none", "Primary action stays solid");
          assert.equal(metrics.primaryAction.backgroundColor, colorScheme === "light" ? "rgb(6, 89, 104)" : "rgb(169, 193, 184)", "Primary action uses the selected palette surface");
          assert.equal(metrics.fonts.body, true);
          assert.ok(metrics.loadedFonts.includes("Nebula Sans"), "Nebula Sans must be a loaded font face");
          assert.match(metrics.label.fontFamily, /Nebula Sans/u);
          assert.match(metrics.link.fontFamily, /Nebula Sans/u);
          assert.equal(metrics.label.textTransform, "none");
          assert.equal(metrics.label.letterSpacing, "normal");
          assert.ok(metrics.layers.some((layer) => layer.startsWith("components.hraness-ui.priority")), "UI compiled CSS missing");
          assert.ok(metrics.layers.some((layer) => layer.startsWith("components.hraness-design-kit.priority")), "Design-kit compiled CSS missing");
          if (mobile) closeTo(metrics.link.minBlockSize, 48, "Ask AI coarse target");
          if (route === "/") {
            assert.equal(metrics.fonts.display, true);
            assert.match(metrics.heading.fontFamily, /Nebula Sans/u);
            assert.ok(parseFloat(metrics.heading.fontSize) >= 38 && parseFloat(metrics.heading.fontSize) <= 72, "Quiet heading scale");
            assert.ok(parseFloat(metrics.heading.lineHeight) >= parseFloat(metrics.heading.fontSize), "Heading has adequate leading");
            closeTo(metrics.header.minBlockSize, 52, "Quiet header");
            assert.ok(metrics.layers.some((layer) => layer.startsWith("oh-marketing")), "Marketing layer missing");
            assert.equal(metrics.material, true);
            assert.ok(metrics.layers.includes("oh-material"), "Material layer missing");
            assert.equal(metrics.field.backgroundImage, "none");
            assert.equal(metrics.pane.backgroundImage, "none");
            assert.equal(metrics.pane.boxShadow, "none");
            assert.equal(metrics.pane.borderTopStyle, "solid");
            closeTo(metrics.pane.borderTopWidth, 1, "Proof separator");
            assert.equal(await page.locator(".oh-field, .oh-organism, [data-hraness-hero-backdrop]").count(), 0);
            for (const link of await page.locator(".hraness-marketing-header a").all()) {
              const box = await link.boundingBox();
              assert.ok(box && box.height >= 44, `${label}: header link ${await link.getAttribute("href")} must remain visible and touch-sized (height: ${box?.height ?? "missing"})`);
            }
          } else {
            assert.match(metrics.heading.fontFamily, /Nebula Sans/u);
            assert.equal(metrics.material, false);
            assert.equal(metrics.pane, null);

          }

          await page.keyboard.press("Tab");
          assert.equal(await page.locator(".skip-link").evaluate((element) => document.activeElement === element), true);
          assert.ok((await page.locator(".skip-link").boundingBox()).y >= 0, "Focused skip link must be visible");
          const target = await page.locator(".skip-link").getAttribute("href");
          assert.equal(await page.locator(target).count(), 1, "Skip link must reference a real unique target");
          await page.keyboard.press("Enter");
          await page.waitForFunction((hash) => location.hash === hash, target);
          await page.waitForFunction((selector) => {
            const element = document.querySelector(selector);
            return document.activeElement === element;
          }, target);
          const askLink = page.locator('[data-slot="ask-ai-about-this-link"]').first();
          await askLink.focus();
          assert.equal(await askLink.evaluate((element) => element.matches(":focus-visible") && Number.parseFloat(getComputedStyle(element).outlineWidth) >= 2), true);
          if (mobile) assert.ok((await askLink.boundingBox()).height >= 48, "Coarse hit target must be at least 48px");
          if (route === "/") {
            const details = page.locator("#questions details").first();
            assert.equal(await details.evaluate((element) => element.open), false);
            await details.locator("summary").focus();
            await page.keyboard.press("Enter");
            assert.equal(await details.evaluate((element) => element.open), true);
            await page.keyboard.press("Enter");
            assert.equal(await details.evaluate((element) => element.open), false);
            // Same native page and controls: material fallback must remove
            // glazing without hiding text or replacing the existing focus.
            const readMaterial = () => page.evaluate(() => {
              const style = (selector) => {
                const element = document.querySelector(selector);
                if (!element) throw new Error(`Missing material target ${selector}`);
                const value = getComputedStyle(element);
                return { image: value.backgroundImage, background: value.backgroundColor,
                  color: value.color, backdrop: value.backdropFilter, shadow: value.boxShadow };
              };
              return { wall: style(".oh-hero"), chrome: style(".hraness-marketing-header"),
                pane: style(".oh-terminal"), canvas: style("body") };
            });
            await withReducedTransparency(page, async () => {
              const fallback = await readMaterial();
              assert.equal(fallback.wall.image, "none");
              assert.equal(fallback.chrome.backdrop, "none");
              assert.notEqual(fallback.chrome.background, "rgba(0, 0, 0, 0)", "Reduced-transparency opaque chrome");
              assert.equal(fallback.pane.background, metrics.pane.backgroundColor);
            }, await nativeMediaSession(page));
            await selectNativeMedia(page, { "forced-colors": "active" });
            try {
              const fallback = await readMaterial();
              for (const surface of [fallback.wall, fallback.chrome, fallback.pane]) {
                assert.equal(surface.image, "none");
                assert.equal(surface.background, fallback.canvas.background);
                assert.equal(surface.shadow, "none");
              }
              assert.equal(fallback.pane.color, fallback.canvas.color);
              assert.equal(fallback.chrome.backdrop, "none");
              await details.locator("summary").focus();
              assert.equal(await details.locator("summary").evaluate((element) =>
                element.matches(":focus-visible") && Number.parseFloat(getComputedStyle(element).outlineWidth) >= 2), true);
            } finally { await selectNativeMedia(page, { "forced-colors": "none" }); }
            assert.equal((await readMaterial()).wall.image, metrics.field.backgroundImage, "Material restores after native media changes");
            metrics.benchmark = await inspectBenchmark(page, label, artifacts);
          }
          assert.deepEqual(failures, [], `${label}: runtime/resource failures`);
          log(`PASS ${label}: compiled layers, theme, fonts, geometry, focus, targets and disclosure`);
        }
      } finally { await context.close(); }
    }
  }
  evidence.push(...await runBenchmarkAccessibilityCases(browser, origin, artifacts));
  evidence.push(...await inspectAppearanceCases(browser, origin));
} catch (error) {
  log(JSON.stringify({ completed: false, evidence }, null, 2));
  throw error;
} finally {
  await cleanup();
}
const receipt = { completed: true, cleanup: "browser and server closed", browser: browserVersion, node: process.version, scenarios: evidence.length };
const evidencePath = artifacts ? join(artifacts, "browser-evidence.json") : null;
if (evidencePath) await writeFile(evidencePath, JSON.stringify({ ...receipt, evidence }, null, 2) + "\n");
// Keep stdout bounded: large synchronous Bun console writes can end mid-JSON
// when piped. The awaited artifact write retains complete structured evidence.
log(JSON.stringify({ ...receipt, labels: evidence.map((row) => row.label), evidencePath }, null, 2));
