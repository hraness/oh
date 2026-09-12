import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { log } from "node:console";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { withReducedTransparency } from "./browser-transparency.mjs";

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
  });
  browser = await launchPromise;
  assert.equal(interrupted, false, "Browser run interrupted");
  browserVersion = browser.version();
  for (const mobile of [false, true]) {
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width: mobile ? 390 : 1440, height: 900 },
        isMobile: mobile, hasTouch: mobile, colorScheme,
      });
      try {
        const page = await context.newPage();
        const failures = [];
        page.on("pageerror", (error) => failures.push(error.message));
        page.on("response", (response) => {
          if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
        });
        page.on("requestfailed", (request) => failures.push(`Request failed: ${new URL(request.url()).pathname}`));
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
                "backgroundColor", "backgroundSize", "color", "backdropFilter", "borderTopStyle", "borderTopWidth",
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
              overflow: document.documentElement.scrollWidth > innerWidth,
              background: getComputedStyle(document.body).backgroundColor,
              body: styles("body"), heading: styles("h1"),
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
          assert.equal(metrics.overflow, false, `${label}: horizontal overflow`);
          assert.equal(metrics.background, colorScheme === "light" ? "rgb(248, 247, 244)" : "rgb(18, 16, 15)");
          assert.match(metrics.body.fontFamily, /Nebula Sans/u);
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
            closeTo(metrics.heading.fontSize, mobile ? 44 : 64, "editorial h1");
            closeTo(metrics.heading.lineHeight, (mobile ? 44 : 64) * 1.06, "editorial h1 leading");
            closeTo(metrics.header.minBlockSize, 72, "editorial header");
            closeTo(metrics.hero.paddingBlockStart, mobile ? 44 : 56, "editorial hero start");
            closeTo(metrics.hero.paddingBlockEnd, mobile ? 72 : 64, "editorial hero end");
            closeTo(metrics.sectionHeading.fontSize, mobile ? 38.4 : 52, "editorial h2");
            assert.ok(metrics.layers.some((layer) => layer.startsWith("oh-marketing")), "Editorial override layer missing");
            assert.equal(metrics.material, true);
            assert.ok(metrics.layers.includes("oh-material"), "Lantern override layer missing");
            assert.equal((metrics.field.backgroundImage.match(/repeating-linear-gradient\(/gu) ?? []).length, 2);
            assert.equal((metrics.field.backgroundImage.match(/radial-gradient\(/gu) ?? []).length, 1);
            assert.doesNotMatch(metrics.field.backgroundImage, /url\(/u, "Lantern wall has no texture assets");
            assert.equal(metrics.field.backgroundSize, "auto, auto, auto, auto", "Canonical wall layers must not inherit editorial texture tiling");
            assert.equal(metrics.pane.backgroundColor, colorScheme === "light" ? "rgb(255, 254, 250)" : "rgb(29, 26, 24)", "Opaque Paper reading pane");
            assert.equal(metrics.pane.color, colorScheme === "light" ? "rgb(28, 25, 23)" : "rgb(245, 242, 237)", "Paired reading ink");
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
            return document.activeElement === element || Math.abs(element.getBoundingClientRect().top) < 2;
          }, target);
          const askLink = page.locator('[data-slot="ask-ai-about-this-link"]').first();
          await askLink.focus();
          assert.equal(await askLink.evaluate((element) => element.matches(":focus-visible") && Number.parseFloat(getComputedStyle(element).outlineWidth) >= 2), true);
          if (mobile) assert.ok((await askLink.boundingBox()).height >= 48, "Coarse hit target must be at least 48px");
          if (route === "/") {
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
            });
            await page.emulateMedia({ forcedColors: "active" });
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
            } finally { await page.emulateMedia({ forcedColors: "none" }); }
            assert.equal((await readMaterial()).wall.image, metrics.field.backgroundImage, "Material restores after native media changes");
          }
          assert.deepEqual(failures, [], `${label}: runtime/resource failures`);
          log(`PASS ${label}: compiled layers, theme, fonts, geometry, focus, targets and disclosure`);
        }
      } finally { await context.close(); }
    }
  }
} catch (error) {
  log(JSON.stringify({ completed: false, evidence }, null, 2));
  throw error;
} finally {
  await cleanup();
}
log(JSON.stringify({ completed: true, cleanup: "browser and server closed", browser: browserVersion, node: process.version, scenarios: evidence.length, evidence }, null, 2));
