import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bounded } from "./support.mjs";

export const legacyBase = "27f0587f599b15f0eb657d6c084f0c006915edc9";
export const expectedVersions = Object.freeze({ next: "16.3.3", react: "19.2.6", "react-dom": "19.2.6" });
export const totalDeadlineMs = 1_800_000;
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Preserve the outer schedulers' finite worker limits without recomputing or
// increasing them. Opaque custody bindings are private pass-through values:
// only the schedulers authenticate leases; this helper grants no authority.
export function inheritedSchedulerEnvironment(inherited) {
  const workerLimits = {};
  for (const key of ["CIRCLE_NODE_TOTAL", "GOMAXPROCS", "JUNGLE_CHECK_TURBO_CONCURRENCY",
    "RAYON_NUM_THREADS", "UV_THREADPOOL_SIZE", "VIPS_CONCURRENCY", "VITEST_MAX_WORKERS", "JUNGLE_CHECK_WORKER_BUDGET"]) {
    const value = inherited[key];
    assert.ok(typeof value === "string" && /^[1-9][0-9]*$/.test(value)
      && Number.isSafeInteger(Number(value)), `Missing or invalid scheduler worker limit: ${key}`);
    workerLimits[key] = value;
  }
  const budget = Number(workerLimits.JUNGLE_CHECK_WORKER_BUDGET);
  for (const [key, value] of Object.entries(workerLimits)) {
    assert.ok(Number(value) <= budget + (key === "CIRCLE_NODE_TOTAL" ? 1 : 0), `Scheduler limit exceeds its inherited budget: ${key}`);
  }
  const bindings = {}, bindingEvidence = {};
  for (const key of ["HRA_LOCAL_EFFICIENCY_LEASE", "JUNGLE_CHECK_RESOURCE_BINDING"]) {
    const value = inherited[key];
    assert.ok(typeof value === "string" && value.length > 0 && !value.includes("\0")
      && Buffer.byteLength(value) <= 4096, `Missing or invalid scheduler custody binding: ${key}`);
    bindings[key] = value;
    bindingEvidence[key] = { bytes: Buffer.byteLength(value), sha256: sha256(value) };
  }
  return { workerLimits, bindings, bindingEvidence };
}

export function baselineCells() {
  const cells = [];
  const add = (family, route, width, colorScheme, overrides = {}) => cells.push({
    id: String(cells.length + 1).padStart(2, "0"), family, route, width, height: 900,
    colorScheme, forcedColors: "none", reducedMotion: "no-preference",
    media: "screen", coarse: false, expectedStatus: 200, ...overrides,
  });
  for (const route of ["/", "/spec"]) for (const width of [375, 480, 481, 512, 513, 768, 769, 1280])
    for (const color of ["light", "dark"]) add("ordinary", route, width, color);
  for (const route of ["/", "/spec"]) for (const width of [375, 1280])
    for (const color of ["light", "dark"]) add("coarse", route, width, color, { coarse: true });
  for (const route of ["/", "/spec"]) for (const width of [375, 1280])
    for (const color of ["light", "dark"]) add("forced", route, width, color, { forcedColors: "active" });
  for (const route of ["/", "/spec"]) for (const width of [375, 1280])
    add("reduced", route, width, "light", { reducedMotion: "reduce" });
  for (const route of ["/", "/spec"]) add("print", route, 1280, "light", { media: "print" });
  for (const width of [375, 1280]) for (const color of ["light", "dark"])
    add("missing", "/__stylex-baseline-missing__", width, color, { expectedStatus: 404 });
  assert.equal(cells.length, 58);
  return cells;
}

export function baselineObservations() {
  return baselineCells().flatMap((cell) => [true, false].map((javaScriptEnabled) => ({
    ...cell, observationId: cell.id + (javaScriptEnabled ? "-js" : "-no-js"), javaScriptEnabled,
  })));
}

export function expectedMedia(settings) {
  return { width: settings.width, height: settings.height, dark: settings.colorScheme === "dark",
    forced: settings.forcedColors === "active", print: settings.media === "print",
    reduce: settings.reducedMotion === "reduce", coarse: settings.coarse, fine: !settings.coarse, hover: !settings.coarse };
}
export function assertMedia(actual, settings) {
  assert.deepEqual(actual, expectedMedia(settings), "Native media differs from the requested cell");
}

// Playwright serializes this function. Keep every browser helper inside it;
// there is deliberately no promise, RAF or fonts.ready wait in the page.
export function captureSnapshot(body, expected) {
  const mediaNow = () => ({ width: innerWidth, height: innerHeight,
    dark: matchMedia("(prefers-color-scheme: dark)").matches, forced: matchMedia("(forced-colors: active)").matches,
    print: matchMedia("print").matches, reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
    coarse: matchMedia("(pointer: coarse)").matches, fine: matchMedia("(pointer: fine)").matches,
    hover: matchMedia("(hover: hover)").matches });
  const validate = (actual) => {
    if (Object.keys(actual).length !== Object.keys(expected).length
      || Object.entries(actual).some(([key, value]) => !Object.hasOwn(expected, key) || expected[key] !== value)) {
      throw new Error("Snapshot media mismatch");
    }
  };
  const media = mediaNow(); validate(media);
  const readiness = () => ({
    fonts: { status: document.fonts.status, faces: [...document.fonts].map((font) => ({
      family: font.family, style: font.style, weight: font.weight, status: font.status,
    })) },
    animations: document.getAnimations().filter((animation) => animation.pending || animation.playState === "running")
      .map((animation) => ({ pending: animation.pending, state: animation.playState, endTime: animation.effect?.getComputedTiming().endTime ?? null })),
  });
  const readyBefore = readiness();
  const nodes = [document.documentElement, body, ...body.querySelectorAll("*")]
    .filter((node) => !["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT"].includes(node.tagName));
  const active = document.activeElement;
  const result = {
    media, title: document.title,
    canonical: [...document.querySelectorAll('link[rel="canonical"]')].map((node) => node.href),
    structuredData: [...document.querySelectorAll('script[type="application/ld+json"]')].map((node) => JSON.parse(node.textContent)),
    text: body.innerText,
    ...readyBefore,
    viewport: { width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, scrollX, scrollY },
    focus: { index: nodes.indexOf(active), tag: active?.tagName ?? null, id: active?.id ?? null, href: active?.getAttribute("href") ?? null },
    nodes: nodes.map((node) => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect(), laidOut = node.getClientRects().length > 0;
      return { tag: node.tagName, id: node.id, class: node.getAttribute("class"), role: node.getAttribute("role"),
        href: node.getAttribute("href"), tabIndex: node.getAttribute("tabindex"), open: node.hasAttribute("open"),
        ariaLabel: node.getAttribute("aria-label"), ariaLabelledby: node.getAttribute("aria-labelledby"),
        text: [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join(""),
        box: { x: box.x, y: box.y, width: box.width, height: box.height, laidOut,
          documentX: box.x + (laidOut ? scrollX : 0), documentY: box.y + (laidOut ? scrollY : 0) },
        scroll: { width: node.scrollWidth, clientWidth: node.clientWidth, left: node.scrollLeft },
        styles: Object.fromEntries([...style].filter((key) => !key.startsWith("--")).map((key) => [key, style.getPropertyValue(key)])),
        pseudo: Object.fromEntries(["::before", "::after", "::marker"].map((pseudo) => {
          const pseudoStyle = getComputedStyle(node, pseudo);
          return [pseudo, Object.fromEntries([...pseudoStyle].filter((key) => !key.startsWith("--"))
            .map((key) => [key, pseudoStyle.getPropertyValue(key)]))];
        })),
      };
    }),
  };
  validate(mediaNow());
  result.readinessAfter = readiness();
  return result;
}

export function settledState(snapshot) {
  assert.equal(snapshot.fonts.status, "loaded", "Fonts have not settled");
  assert.ok(snapshot.fonts.faces.every((face) => face.status !== "error"), "A font failed");
  assert.deepEqual(snapshot.animations, [], "Native animations have not settled");
  assert.deepEqual(snapshot.readinessAfter, { fonts: snapshot.fonts, animations: snapshot.animations }, "Layout changed font/animation readiness");
  return sha256(JSON.stringify(snapshot));
}

// Host-side finite polling also works with JavaScript disabled. This certifies
// sampled stable native state, not a fictitious page-side RAF event.
export async function settle({ capture, wait, track = () => {}, signal, now = Date.now, milliseconds = 5000 }) {
  assert.ok(Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= 5000);
  const end = now() + milliseconds;
  const step = async (operation, label) => {
    signal?.throwIfAborted();
    const remaining = end - now(); assert.ok(remaining > 0, "Native settlement deadline exceeded");
    const original = Promise.resolve().then(operation); track(original);
    const value = await bounded(original, remaining, label, signal);
    signal?.throwIfAborted();
    assert.ok(now() < end, "Native settlement deadline exceeded");
    return value;
  };
  let previous, consecutive = 0, observations = 0;
  while (now() < end) {
    const snapshot = await step(capture, "native snapshot"); observations++;
    let state;
    if (snapshot.fonts.status === "loaded" && snapshot.fonts.faces.every((face) => face.status !== "error")
      && snapshot.animations.length === 0
      && JSON.stringify(snapshot.readinessAfter) === JSON.stringify({ fonts: snapshot.fonts, animations: snapshot.animations })) state = settledState(snapshot);
    else {
      assert.ok(snapshot.fonts.faces.every((face) => face.status !== "error"), "A font failed");
      assert.ok(snapshot.animations.every((animation) => Number.isFinite(animation.endTime)), "Unbounded native animation");
    }
    consecutive = state && state === previous ? consecutive + 1 : 0;
    previous = state;
    if (consecutive === 2) return { observations, stateSha256: state, snapshot };
    await step(() => wait(Math.min(50, end - now())), "native settlement yield");
  }
  throw new Error("Native state did not settle within its 5s bound");
}

export function screenshotOptions(fullPage) {
  assert.equal(typeof fullPage, "boolean");
  return { fullPage, animations: "allow", caret: "initial", timeout: 30_000 };
}
export async function captureScreenshot({ settings, fullPage, settle: settleNative, capture, screenshot }, options = screenshotOptions(fullPage)) {
  assert.deepEqual(options, screenshotOptions(fullPage), "Only unmodified native screenshot options are allowed");
  await settleNative();
  const before = await capture(); assertMedia(before.media, settings); settledState(before);
  const bytes = await screenshot(options);
  await settleNative();
  const after = await capture(); assertMedia(after.media, settings); settledState(after);
  // Whole-page captures must not change even the scroll origin or sticky paint.
  assert.deepEqual(after, before, "Screenshot changed media, focus, content, styles or geometry");
  return { snapshot: before, bytes, proof: { options, beforeSha256: sha256(JSON.stringify(before)), afterSha256: sha256(JSON.stringify(after)) } };
}

export function assertBaselineRange(paths) {
  assert.ok(paths.length > 0, "Collector checkpoint must be committed");
  for (const path of paths) assert.match(path, /^site\/verification\/stylex-native\/(?:README|[a-z][a-z.-]*)\.(?:mjs|md)$/, "Production baseline changed");
}
export function assertInstalled(versions) { assert.deepEqual(versions, expectedVersions); }

export function assertScriptMode(javaScriptEnabled, html, observation) {
  assert.equal(typeof javaScriptEnabled, "boolean");
  assert.ok(Buffer.byteLength(html) <= 16 * 1024 * 1024, "Document exceeds baseline bound");
  assert.equal(observation.scripts.length, 1, "Actual document must contain exactly one qualified Next bootstrap");
  const script = observation.scripts[0];
  assert.equal(script.type, ""); assert.equal(script.src, null);
  assert.match(script.text, /^\(self\.__next_f=self\.__next_f\|\|\[\]\)\.push\(\[0\]\)/);
  assert.equal(script.outerHTML, "<script>" + script.text + "</script>");
  assert.ok(html.includes(script.outerHTML), "Bootstrap is not present in the actual response");
  assert.equal(observation.ownGlobal, javaScriptEnabled, "Actual page-script property differs from the requested observation");
  assert.equal(observation.arrayGlobal, javaScriptEnabled, "Actual page-script array differs from the requested observation");
}

export function acceptance(receipt) {
  const expected = baselineObservations().map((entry) => entry.observationId);
  return receipt.work === "passed" && receipt.errors.length === 0
    && JSON.stringify(receipt.observations.map((entry) => entry.observationId)) === JSON.stringify(expected)
    && receipt.cleanup.contextClosed === true && receipt.cleanup.browserClosed === true
    && receipt.cleanup.browserServerClosed === true && receipt.cleanup.browserDisconnected === true
    && receipt.cleanup.originalOperationsCollected === true && receipt.cleanup.loopbackClosed === true
    && receipt.cleanup.inputsAndServedOutputsUnchanged === true
    && receipt.cleanup.processes?.survivors.length === 0;
}

export function originalsCollected(nativePending, resources, children) {
  assert.ok(Number.isSafeInteger(nativePending) && nativePending >= 0);
  for (const row of resources) for (const key of ["pending", "tasks"]) assert.ok(Number.isSafeInteger(row[key]) && row[key] >= 0);
  return nativePending === 0 && resources.every((row) => row.pending === 0 && row.tasks === 0)
    && children.every((row) => row.closed === true && row.stdoutEOF === true && row.stderrEOF === true && row.exit !== null);
}
