import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

function collectPageFailures(page) {
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on("requestfailed", (request) => failures.push(`Request failed: ${new URL(request.url()).pathname}`));
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

async function inspectOhFieldLifecycle(page, mobile) {
  await page.bringToFront();
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForFunction(() => scrollY === 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const host = page.locator(".hraness-material-wall");
  const light = () => host.evaluate((element) => element.style.getPropertyValue("--hraness-hero-light-x"));
  const eligible = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)").matches);
  assert.equal(eligible, !mobile, "Native pointer media must match this desktop/mobile case");
  assert.equal(await page.locator(".oh-organism").count(), 12, "All authored organisms exist before pointer interaction");
  const move = async () => {
    const box = await host.boundingBox();
    assert.ok(box && box.height > 0);
    await page.mouse.move(box.x + box.width * .22, Math.max(90, box.y + 80));
  };
  const headingGeometry = () => page.locator("h1").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
  const headingBefore = await headingGeometry();
  await move();
  if (eligible) {
    await page.waitForFunction(() => document.querySelector(".hraness-material-wall").style.getPropertyValue("--hraness-hero-light-x") !== "");
    await page.waitForFunction(() => [...document.querySelectorAll(".oh-organism")].some((node) => Number(node.style.getPropertyValue("--hraness-hero-proximity")) > 0));
  } else {
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await light(), "", "Coarse input keeps the authored field still");
  }
  assert.deepEqual(await headingGeometry(), headingBefore, "Pointer light never moves the headline in the document");
  const activeLight = await light();
  if (eligible) {
    // Exercise the subscribed visibility handler while paint is active, as
    // well as checking below that it cannot restart an offscreen field.
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    assert.equal(await light(), "", "Visibility notification clears active light");
    assert.equal(await page.locator(".oh-organism").evaluateAll((nodes) => nodes.every((node) => !node.style.getPropertyValue("--hraness-hero-proximity"))), true);
    await move();
    await page.waitForFunction(() => document.querySelector(".hraness-material-wall").style.getPropertyValue("--hraness-hero-light-x") !== "");
  }
  await page.locator("#benchmarks").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector(".hraness-material-wall").getBoundingClientRect().bottom <= 0);
  await page.waitForFunction(() => document.querySelector(".hraness-material-wall").style.getPropertyValue("--hraness-hero-light-x") === "");
  const offscreen = await page.evaluate(async () => {
    const host = document.querySelector(".hraness-material-wall");
    const nodes = [...document.querySelectorAll(".oh-organism")];
    document.dispatchEvent(new Event("visibilitychange"));
    let changedFrames = 0;
    for (let frame = 0; frame < 8; frame++) {
      await new Promise(requestAnimationFrame);
      if (host.style.getPropertyValue("--hraness-hero-light-x") || nodes.some((node) => node.style.getPropertyValue("--hraness-hero-proximity"))) changedFrames++;
    }
    return { documentVisible: !document.hidden, offscreen: host.getBoundingClientRect().bottom <= 0, organisms: nodes.length, frames: 8, changedFrames };
  });
  assert.deepEqual(offscreen, { documentVisible: true, offscreen: true, organisms: 12, frames: 8, changedFrames: 0 });
  await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await move();
  if (eligible) await page.waitForFunction(() => document.querySelector(".hraness-material-wall").style.getPropertyValue("--hraness-hero-light-x") !== "");
  const resumedLight = await light();
  await selectNativeMedia(page, { "prefers-reduced-motion": "reduce" });
  await page.waitForFunction(() => document.querySelector(".hraness-material-wall").style.getPropertyValue("--hraness-hero-light-x") === "");
  await move();
  const reducedMotion = await page.locator(".oh-organism").evaluateAll((nodes) => ({
    requested: matchMedia("(prefers-reduced-motion: reduce)").matches,
    organisms: nodes.length,
    stationary: nodes.every((node) => getComputedStyle(node).transform === "none" && !node.style.getPropertyValue("--hraness-hero-proximity")),
  }));
  assert.deepEqual(reducedMotion, { requested: true, organisms: 12, stationary: true });
  await selectNativeMedia(page, { "prefers-reduced-motion": "no-preference" });
  return { eligible, activeLight, offscreen, resumedLight, reducedMotion };
}

async function inspectAppearanceCases(browser, origin) {
  const rows = [];
  const expected = { light: "rgb(251, 241, 199)", dark: "rgb(40, 40, 40)" };
  for (const width of [320, 390, 1440]) for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme, viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      const failures = collectPageFailures(page);
      for (const route of ["/", "/spec"]) {
        assert.equal((await page.goto(`${origin}${route}`, { waitUntil: "networkidle" })).status(), 200);
        const paint = await page.evaluate(async () => {
          await document.fonts.ready;
          return { background: getComputedStyle(document.body).backgroundColor,
            palette: document.documentElement.dataset.palette,
            scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
            heading: document.querySelector("h1")?.textContent,
            organisms: document.querySelectorAll(".oh-organism").length };
        });
        assert.equal(paint.background, expected[colorScheme]);
        assert.equal(paint.palette, "gruvbox");
        assert.ok(paint.scrollWidth <= width, `No-JavaScript content stays inside ${width}px viewport`);
        assert.equal(paint.viewportWidth, width, "Overflow must not expand the mobile viewport");
        assert.ok(paint.heading);
        assert.equal(paint.organisms, route === "/" ? 12 : 0);
        assert.deepEqual(failures, [], `No-JavaScript ${width} ${colorScheme} ${route}: runtime/resource failures`);
        rows.push({ label: `no-js-${width}-${colorScheme}-${route === "/" ? "home" : "spec"}`, paint, failures: [...failures] });
      }
    } finally { await context.close(); }
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

// The weave field retains the immutable grain asset; its pattern is authored CSS.
async function assertWallAssets(context, background, origin) {
  const expected = [
    ['grain', 152319, 'b40c33a0e382c8e9d0518b4720321b5c262a929c28d40a190a902d07acd06553'],
  ];
  const urls = [...background.matchAll(/url\("([^"]+)"\)/gu)].map(match => new URL(match[1], origin));
  assert.equal(urls.length, expected.length);
  const result = [];
  for (const [index, url] of urls.entries()) {
    const [name, size, sha256] = expected[index];
    assert.equal(url.origin, origin); assert.equal(url.search, ''); assert.equal(url.hash, '');
    assert.match(url.pathname, new RegExp(`^/_next/static/media/${name}\\.[a-f0-9]+\\.svg$`, 'u'));
    const response = await context.request.get(url.href, { timeout: 5000, maxRedirects: 0 });
    assert.equal(response.status(), 200);
    const bytes = await response.body();
    assert.equal(bytes.length, size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256);
    result.push({ name, path: url.pathname, bytes: size, sha256 });
  }
  return result;
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
  for (const mobile of [false, true]) {
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: mobile ? 390 : 1440, height: 900 },
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
              hero: styles(".hraness-marketing-hero"), field: styles(".hraness-material-wall"),
              chrome: styles(".hraness-material-chrome"), pane: styles(".hraness-material-pane"),
              material: document.querySelector('[data-hraness-material="lantern"]') !== null,
              label: styles('[data-slot="ask-ai-about-this-label"]'),
              link: styles('[data-slot="ask-ai-about-this-link"]'),
              fonts: { body: document.fonts.check('16px "Nebula Sans"'), display: document.fonts.check('44px "Instrument Serif"') },
              loadedFonts: [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replaceAll('"', "")),
              layers, headingRules,
            };
          });
          const label = `${mobile ? "mobile" : "desktop"}-${colorScheme}-${route === "/" ? "home" : "spec"}`;
          evidence.push({ label, metrics });
          if (artifacts) await page.screenshot({ path: join(artifacts, `${label}.png`) });
          assert.ok(metrics.scrollWidth <= (mobile ? 390 : 1440), `${label}: horizontal overflow`);
          assert.equal(metrics.viewportWidth, mobile ? 390 : 1440, `${label}: requested viewport remains fixed`);
          assert.equal(metrics.background, colorScheme === "light" ? "rgb(251, 241, 199)" : "rgb(40, 40, 40)");
          assert.match(metrics.body.fontFamily, /Nebula Sans/u);
          assert.equal(metrics.primaryAction.color, colorScheme === "light" ? "rgb(251, 241, 199)" : "rgb(40, 40, 40)", "Primary action uses paired Gruvbox ink");
          assert.ok(metrics.primaryAction.backgroundImage.includes(colorScheme === "light" ? "rgb(6, 89, 104)" : "rgb(169, 193, 184)"), "Primary action foil uses the selected palette surface");
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
            assert.ok(metrics.loadedFonts.includes("Instrument Serif"), "Instrument Serif must be a loaded font face");
            assert.match(metrics.heading.fontFamily, /Instrument Serif/u);
            closeTo(metrics.heading.fontSize, mobile ? 49.98 : 88, "editorial h1");
            closeTo(metrics.heading.lineHeight, (mobile ? 49.98 : 88) * 1.02, "editorial h1 leading");
            closeTo(metrics.header.minBlockSize, 52, "editorial header");
            closeTo(metrics.hero.paddingBlockStart, mobile ? 56 : 112, "editorial hero start");
            closeTo(metrics.hero.paddingBlockEnd, mobile ? 72 : 128, "editorial hero end");
            closeTo(metrics.sectionHeading.fontSize, mobile ? 34 : 56, "editorial h2");
            assert.ok(metrics.layers.some((layer) => layer.startsWith("oh-marketing")), "Editorial override layer missing");
            assert.equal(metrics.material, true);
            assert.ok(metrics.layers.includes("oh-material"), "Lantern override layer missing");
            assert.equal((metrics.field.backgroundImage.match(/gradient\(/gu) ?? []).length, 3);
            assert.equal((metrics.field.backgroundImage.match(/radial-gradient\(/gu) ?? []).length, 1);
            assert.equal((metrics.field.backgroundImage.match(/repeating-conic-gradient\(/gu) ?? []).length, 1);
            assert.doesNotMatch(metrics.field.backgroundImage, /repeating-linear-gradient\(/u);
            assert.equal(metrics.field.backgroundSize, "64px 64px, 24px 24px, 100% 100%, 100% 100%");
            metrics.textures = await assertWallAssets(context, metrics.field.backgroundImage, origin);
            assert.equal(metrics.pane.backgroundColor, colorScheme === "light" ? "rgb(249, 245, 215)" : "rgb(29, 32, 33)", "Opaque Gruvbox reading pane");
            // Canonical accessible Gruvbox foreground from palette-system.css.
            assert.equal(metrics.pane.color, colorScheme === "light" ? "rgb(57, 53, 51)" : "rgb(240, 229, 199)", "Paired reading ink");
            assert.notEqual(metrics.pane.boxShadow, "none", "Shared soft reading depth");
            assert.equal(metrics.pane.borderTopStyle, "solid");
            closeTo(metrics.pane.borderTopWidth, 1, "reading seam");
            assert.equal(metrics.chrome.backdropFilter, "blur(20px) saturate(1.1)");
          } else {
            assert.match(metrics.heading.fontFamily, /Nebula Sans/u);
            assert.equal(metrics.material, false);
            assert.equal(metrics.pane, null);
            assert.equal(metrics.chrome, null);
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
            metrics.ohFieldLifecycle = await inspectOhFieldLifecycle(page, mobile);
            const details = page.locator("details.first-run-details");
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
              return { wall: style(".hraness-material-wall"), chrome: style(".hraness-material-chrome"),
                pane: style(".hraness-material-pane"), canvas: style("body") };
            });
            await withReducedTransparency(page, async () => {
              const fallback = await readMaterial();
              assert.equal(fallback.wall.image, "none");
              assert.equal(fallback.chrome.backdrop, "none");
              assert.equal(fallback.chrome.background, metrics.pane.backgroundColor, "Reduced-transparency opaque chrome");
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
