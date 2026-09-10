import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { acceptance, assertBaselineRange, assertInstalled, assertMedia, assertScriptMode, baselineCells, baselineObservations,
  captureScreenshot, captureSnapshot, expectedMedia, expectedVersions, inheritedSchedulerEnvironment, legacyBase, originalsCollected, screenshotOptions, settle, settledState, sha256 } from "./contract.mjs";
import { assertInteractionInventory, tabTo, focusEvidence, linkStateTargets, roles } from "./surfaces.mjs";

const cell = baselineObservations()[0];
const snapshot = () => {
  const fonts = { status: "loaded", faces: [{ family: "Nebula Sans", status: "loaded" }] }, animations = [];
  return { media: expectedMedia(cell), fonts, animations, readinessAfter: { fonts: structuredClone(fonts), animations: [] },
    viewport: { width: cell.width, scrollX: 0, scrollY: 0 }, focus: { id: "" }, nodes: [{ styles: { color: "rgb(1, 2, 3)" }, box: { x: 0, y: 0 } }] };
};

const schedulerInput = () => ({
  CIRCLE_NODE_TOTAL: "6", GOMAXPROCS: "3", JUNGLE_CHECK_TURBO_CONCURRENCY: "2", RAYON_NUM_THREADS: "4",
  UV_THREADPOOL_SIZE: "5", VIPS_CONCURRENCY: "1", VITEST_MAX_WORKERS: "5", JUNGLE_CHECK_WORKER_BUDGET: "5",
  HRA_LOCAL_EFFICIENCY_LEASE: '{"private":"host-custody"}', JUNGLE_CHECK_RESOURCE_BINDING: '{"private":"repository-custody"}',
});

test("clean child environment preserves only exact inherited scheduler limits and private bindings", () => {
  const original = schedulerInput();
  const result = inheritedSchedulerEnvironment({ ...original, HOME: "excluded-home", GITHUB_TOKEN: "excluded-secret",
    VERCEL_OIDC_TOKEN: "excluded-provider", NODE_OPTIONS: "excluded-loader", GITHUB_ACTIONS: "true", PATH: "excluded-path" });
  assert.deepEqual({ ...result.workerLimits, ...result.bindings }, original);
  assert.deepEqual(Object.keys(result.bindings), ["HRA_LOCAL_EFFICIENCY_LEASE", "JUNGLE_CHECK_RESOURCE_BINDING"]);
  assert.equal(Object.keys(result.workerLimits).length, 8);
  for (const [key, value] of Object.entries(result.bindings)) {
    assert.deepEqual(result.bindingEvidence[key], { bytes: Buffer.byteLength(value), sha256: sha256(value) });
    assert.ok(!JSON.stringify({ ...result.workerLimits, bindings: result.bindingEvidence }).includes(value));
  }
  assert.ok(!JSON.stringify(result).includes("excluded-"));
  assert.deepEqual(original, schedulerInput());
});

test("scheduler pass-through rejects absent, malformed or widened limits without defaults or value disclosure", () => {
  const input = schedulerInput();
  for (const key of Object.keys(input)) {
    const absent = { ...input }; delete absent[key];
    assert.throws(() => inheritedSchedulerEnvironment(absent), /Missing or invalid scheduler/);
  }
  for (const key of Object.keys(input).filter((key) => !key.endsWith("LEASE") && !key.endsWith("BINDING"))) {
    for (const value of [undefined, 1, "", "0", "-1", "01", "1.0", "1e1", " 1", "9007199254740992", "private-invalid"]) {
      assert.throws(() => inheritedSchedulerEnvironment({ ...input, [key]: value }), (error) => {
        assert.match(error.message, /Missing or invalid scheduler/); assert.ok(!error.message.includes("private-invalid")); return true;
      });
    }
    if (key !== "JUNGLE_CHECK_WORKER_BUDGET") {
      assert.throws(() => inheritedSchedulerEnvironment({ ...input, [key]: key === "CIRCLE_NODE_TOTAL" ? "7" : "6" }), /exceeds/);
    }
  }
  assert.throws(() => inheritedSchedulerEnvironment({ ...input, JUNGLE_CHECK_WORKER_BUDGET: "4" }), /exceeds/);
  for (const key of ["HRA_LOCAL_EFFICIENCY_LEASE", "JUNGLE_CHECK_RESOURCE_BINDING"]) {
    for (const value of [undefined, 1, "", "private\0invalid", "x".repeat(4097), "é".repeat(2049)]) {
      assert.throws(() => inheritedSchedulerEnvironment({ ...input, [key]: value }), /Missing or invalid scheduler custody/);
    }
  }
});

test("closed 58-cell corpus keeps every breakpoint, route, palette and 116 JS/no-JS observations", () => {
  const cells = baselineCells(), observations = baselineObservations();
  assert.equal(cells.length, 58); assert.equal(observations.length, 116);
  assert.equal(new Set(observations.map((row) => row.observationId)).size, 116);
  assert.deepEqual(Object.fromEntries(["ordinary", "coarse", "forced", "reduced", "print", "missing"].map((family) => [family, cells.filter((row) => row.family === family).length])),
    { ordinary: 32, coarse: 8, forced: 8, reduced: 4, print: 2, missing: 4 });
  for (const route of ["/", "/spec"]) for (const width of [375, 480, 481, 512, 513, 768, 769, 1280]) for (const color of ["light", "dark"])
    assert.equal(cells.filter((row) => row.family === "ordinary" && row.route === route && row.width === width && row.colorScheme === color).length, 1);
  for (const candidate of cells) {
    const modes = observations.filter((row) => row.id === candidate.id);
    assert.deepEqual(modes.map((row) => row.javaScriptEnabled), [true, false]);
    assert.equal(candidate.expectedStatus, candidate.family === "missing" ? 404 : 200);
    assert.equal(candidate.height, 900);
  }
});

test("every actual media field is required; viewport and opposing queries cannot be relabeled", () => {
  for (const candidate of baselineObservations()) {
    const expected = expectedMedia(candidate);
    assertMedia(expected, candidate);
    for (const key of Object.keys(expected)) {
      const bad = { ...expected, [key]: typeof expected[key] === "number" ? expected[key] + 1 : !expected[key] };
      assert.throws(() => assertMedia(bad, candidate));
      const missing = { ...expected }; delete missing[key]; assert.throws(() => assertMedia(missing, candidate));
    }
    assert.throws(() => assertMedia({ ...expected, extra: false }, candidate));
  }
});

test("legacy identity permits only collector commits and exact installed profile", () => {
  assert.equal(legacyBase, "27f0587f599b15f0eb657d6c084f0c006915edc9");
  assert.deepEqual(expectedVersions, { next: "16.3.3", react: "19.2.6", "react-dom": "19.2.6" });
  assertBaselineRange(["site/verification/stylex-native/README.md", "site/verification/stylex-native/contract.mjs", "site/verification/stylex-native/contract.test.mjs"]);
  for (const path of ["site/app/page.tsx", "site/bun.lock", "site/package.json", "package.json", "site/verification/stylex-native/../app.mjs", "/site/verification/stylex-native/test.mjs"])
    assert.throws(() => assertBaselineRange([path]));
  assert.throws(() => assertBaselineRange([]));
  assertInstalled(expectedVersions);
  for (const name of Object.keys(expectedVersions)) assert.throws(() => assertInstalled({ ...expectedVersions, [name]: "latest" }));
  assert.throws(() => assertInstalled({ ...expectedVersions, extra: "1" }));
});

test("screenshot uses allow/initial and fences state in native order", async () => {
  const events = [];
  const state = snapshot();
  const result = await captureScreenshot({ settings: cell, fullPage: true,
    settle: async () => events.push("settle"),
    capture: async () => { events.push("capture"); return structuredClone(state); },
    screenshot: async (options) => { events.push("screenshot"); assert.deepEqual(options, screenshotOptions(true)); return Buffer.from("pixels"); },
  });
  assert.deepEqual(events, ["settle", "capture", "screenshot", "settle", "capture"]);
  assert.equal(result.proof.beforeSha256, result.proof.afterSha256);
  assert.equal(result.bytes.toString(), "pixels");
});

test("capture rejects altered options, pre/post media, content, focus, font and geometry", async () => {
  const run = async (before, after, options = screenshotOptions(true)) => {
    let calls = 0;
    return captureScreenshot({ settings: cell, fullPage: true, settle: async () => {},
      capture: async () => structuredClone(calls++ === 0 ? before : after), screenshot: async () => Buffer.from("pixels") }, options);
  };
  for (const options of [{ ...screenshotOptions(true), animations: "disabled" }, { ...screenshotOptions(true), caret: "hide" },
    { ...screenshotOptions(true), style: "*{color:red}" }, { ...screenshotOptions(true), fullPage: false },
    { ...screenshotOptions(true), mask: [] }]) await assert.rejects(run(snapshot(), snapshot(), options), /unmodified/);
  for (const mutate of [
    (state) => { state.media.height++; }, (state) => { state.media.coarse = !state.media.coarse; },
    (state) => { state.focus.id = "foreign"; }, (state) => { state.nodes[0].styles.color = "red"; },
    (state) => { state.nodes[0].box.y++; }, (state) => { state.viewport.scrollY++; },
    (state) => { state.fonts.status = "loading"; },
  ]) {
    const after = snapshot(); mutate(after); await assert.rejects(run(snapshot(), after));
  }
  const badBefore = snapshot(); badBefore.media.width++; await assert.rejects(run(badBefore, snapshot()), /media/);
});

test("host polling settles no-JS state without invoking page promises", async () => {
  let now = 0, calls = 0; const waits = [];
  const result = await settle({ capture: async () => { calls++; return snapshot(); },
    now: () => now, wait: async (ms) => { waits.push(ms); now += ms; } });
  assert.equal(calls, 3); assert.deepEqual(waits, [50, 50]); assert.equal(result.observations, 3);
  assert.equal(result.stateSha256, settledState(snapshot()));
});

test("late font/animation settlement resets quiet count; errors and unbounded motion reject", async () => {
  let now = 0, calls = 0;
  const ready = await settle({ capture: async () => {
    const state = snapshot(); if (calls++ < 2) state.fonts.status = "loading"; return state;
  }, wait: async (ms) => { now += ms; }, now: () => now });
  assert.equal(ready.observations, 5);
  for (const mutate of [
    (state) => { state.fonts.faces[0].status = "error"; },
    (state) => { state.animations = [{ endTime: null }]; },
  ]) {
    const state = snapshot(); mutate(state);
    await assert.rejects(settle({ capture: async () => state, wait: async () => {}, now: () => 0 }));
  }
  now = 0;
  await assert.rejects(settle({ capture: async () => ({ ...snapshot(), fonts: { status: "loading", faces: [] } }),
    milliseconds: 100, now: () => now, wait: async (ms) => { now += ms; } }), /deadline exceeded/);
});

test("absolute settlement rejects a late third success and retains stalled captures/yields for collection", async () => {
  let now = 0, calls = 0;
  await assert.rejects(settle({ capture: async () => { if (++calls === 3) now = 5001; return snapshot(); },
    wait: async (ms) => { now += ms; }, now: () => now }), /deadline exceeded/);
  for (const stalled of ["capture", "yield"]) {
    let release; const pending = new Promise((resolve) => { release = resolve; }); const original = [];
    const options = { capture: async () => stalled === "capture" ? pending : snapshot(),
      wait: async () => stalled === "yield" ? pending : undefined, track: (promise) => original.push(promise), milliseconds: 5 };
    await assert.rejects(settle(options), /Timeout/);
    assert.ok(original.length > 0); release(snapshot()); await Promise.all(original);
  }
  const abort = new AbortController(), original = []; let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const waiting = settle({ capture: () => pending, wait: async () => {}, signal: abort.signal, track: (promise) => original.push(promise) });
  abort.abort(new Error("owned cancellation")); await assert.rejects(waiting, /owned cancellation/);
  release(snapshot()); await Promise.all(original);
});

test("layout-flush font/animation drift never settles", async () => {
  const state = snapshot(); state.readinessAfter.fonts.status = "loading";
  assert.throws(() => settledState(state), /Layout changed/);
  let now = 0;
  await assert.rejects(settle({ capture: async () => state, milliseconds: 100, now: () => now,
    wait: async (ms) => { now += ms; } }), /deadline/);
});

test("real executable document bootstrap, global ownership and array shape prove both JS modes", () => {
  const text = "(self.__next_f=self.__next_f||[]).push([0])", outerHTML = "<script>" + text + "</script>";
  const script = { text, outerHTML, type: "", src: null };
  for (const mode of [true, false]) {
    const state = { scripts: [script], ownGlobal: mode, arrayGlobal: mode };
    assertScriptMode(mode, outerHTML, state);
    for (const mutate of [
      (bad) => { bad.scripts = []; }, (bad) => { bad.scripts.push(script); },
      (bad) => { bad.scripts[0].type = "application/ld+json"; }, (bad) => { bad.scripts[0].type = "module"; },
      (bad) => { bad.scripts[0].src = "/foreign.js"; }, (bad) => { bad.ownGlobal = !mode; },
      (bad) => { bad.arrayGlobal = !mode; }, (bad) => { bad.scripts[0].text = '"self.__next_f=[]"'; },
    ]) { const bad = structuredClone(state); mutate(bad); assert.throws(() => assertScriptMode(mode, outerHTML, bad)); }
    assert.throws(() => assertScriptMode(mode, "<script type='application/json'>" + text + "</script>", state));
  }
});

// Minimal host context proves the serialized function has no imported/outer
// lexical references. It is a syntax/protocol check, not a browser substitute.
test("serialized capture is synchronous and validates media before and after computed styles", () => {
  const expected = expectedMedia(cell);
  const node = { tagName: "BODY", id: "", childNodes: [], innerText: "Oh", clientWidth: 375, scrollWidth: 375,
    getAttribute: () => null, hasAttribute: () => false, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 375, height: 10 }), getClientRects: () => [{}] };
  const fonts = []; fonts.status = "loaded";
  const media = { "(prefers-color-scheme: dark)": false, "(forced-colors: active)": false, print: false,
    "(prefers-reduced-motion: reduce)": false, "(pointer: coarse)": false, "(pointer: fine)": true, "(hover: hover)": true };
  let drift = false;
  const context = { innerWidth: 375, innerHeight: 900, scrollX: 0, scrollY: 0, expected, body: node,
    Node: { TEXT_NODE: 3 }, matchMedia: (query) => ({ matches: media[query] }),
    document: { documentElement: node, activeElement: node, title: "Oh", fonts, querySelectorAll: () => [], getAnimations: () => [] },
    getComputedStyle: () => { if (drift) context.innerWidth = 376; const style = ["color"]; style.getPropertyValue = () => "black"; return style; },
  };
  const source = "(" + captureSnapshot.toString() + ")(body, expected)";
  const result = runInNewContext(source, context);
  assert.equal(typeof result.then, "undefined"); assert.equal(result.media.width, 375); assert.equal(result.nodes.length, 2);
  assert.doesNotMatch(captureSnapshot.toString(), /\b(?:await|requestAnimationFrame|fonts\.ready)\b/);
  drift = true; assert.throws(() => runInNewContext(source, context), /media mismatch/);
  context.innerWidth = 374; assert.throws(() => runInNewContext(source, context), /media mismatch/);
});

test("terminal acceptance cannot omit a mode, reorder cells or precede any custody join", () => {
  const receipt = { work: "passed", errors: [], observations: baselineObservations(), cleanup: {
    contextClosed: true, browserClosed: true, browserServerClosed: true, browserDisconnected: true,
    originalOperationsCollected: true, loopbackClosed: true, inputsAndServedOutputsUnchanged: true, processes: { survivors: [] },
  } };
  assert.equal(acceptance(receipt), true);
  for (const key of Object.keys(receipt.cleanup)) {
    const bad = structuredClone(receipt); delete bad.cleanup[key]; assert.equal(acceptance(bad), false);
  }
  for (const mutate of [
    (bad) => { bad.observations.pop(); }, (bad) => { bad.observations.reverse(); },
    (bad) => { bad.observations[1] = bad.observations[0]; }, (bad) => { bad.errors.push("failure"); },
    (bad) => { bad.work = "pending"; }, (bad) => { bad.cleanup.processes.survivors.push(12); },
  ]) { const bad = structuredClone(receipt); mutate(bad); assert.equal(acceptance(bad), false); }
});

test("original collection requires empty retained probes/resources and actual child EOFs even on red", () => {
  const children = [{ closed: true, stdoutEOF: true, stderrEOF: true, exit: { code: 1, signal: null } }];
  assert.equal(originalsCollected(0, [{ pending: 0, tasks: 0 }], children), true);
  assert.equal(originalsCollected(1, [{ pending: 0, tasks: 0 }], children), false);
  assert.equal(originalsCollected(0, [{ pending: 1, tasks: 0 }], children), false);
  assert.equal(originalsCollected(0, [{ pending: 0, tasks: 1 }], children), false);
  for (const key of ["closed", "stdoutEOF", "stderrEOF", "exit"]) {
    const bad = structuredClone(children); bad[0][key] = key === "exit" ? null : false;
    assert.equal(originalsCollected(0, [], bad), false);
  }
  assert.throws(() => originalsCollected(-1, [], []));
});

test("native keyboard helper never manufactures focus and fails after its finite bound", async () => {
  let tabs = 0, focused = false;
  const page = { keyboard: { press: async (key) => { assert.equal(key, "Tab"); tabs++; if (tabs === 3) focused = true; } } };
  const target = { count: async () => 1, evaluate: async () => focused };
  assert.equal(await tabTo(page, target, 4), 3);
  focused = false; tabs = 0;
  await assert.rejects(tabTo(page, target, 2), /Native Tab/); assert.equal(tabs, 2);
  assert.doesNotMatch(tabTo.toString(), /\.focus\(/);
  assert.ok(roles.home.disclosure && roles.spec.nav);
});

test("authored link-state families include body, Ask-AI and home-only footer without visiting providers", () => {
  assert.deepEqual(linkStateTargets(true).map((row) => row.name), ["header-brand", "header-nav", "header-action", "hero-primary", "hero-secondary", "cta-primary", "cta-secondary", "first-run-summary", "record", "interface", "install-note", "maker", "ask-ai", "footer"]);
  assert.deepEqual(linkStateTargets(false).map((row) => row.name), ["header-brand", "header-nav", "header-action", "header-current", "spec-primary", "spec-secondary", "ask-ai"]);
  assert.equal(new Set(linkStateTargets(true).map((row) => row.selector)).size, 14);
  assert.throws(() => linkStateTargets("home"));
  const home = { applicable: true, links: linkStateTargets(true), commands: [{ index: 0 }, { index: 1 }],
    questions: Array.from({ length: 8 }, (_, index) => ({ index, opened: true, closed: true })) };
  assertInteractionInventory(cell, home);
  for (let index = 0; index < 14; index++) {
    const bad = structuredClone(home); bad.links.splice(index, 1); assert.throws(() => assertInteractionInventory(cell, bad));
  }
  for (const mutate of [(bad) => bad.commands.pop(), (bad) => bad.questions.pop(), (bad) => { bad.questions[0].closed = false; }]) {
    const bad = structuredClone(home); mutate(bad); assert.throws(() => assertInteractionInventory(cell, bad));
  }
});

test("focus evidence requires real native focus, visible hit area and ring", async () => {
  const good = { active: true, visible: true, fragments: [{ visible: true, ownedHit: true }],
    outlineStyle: "solid", outlineWidth: "2px", boxShadow: "none" };
  assert.deepEqual(await focusEvidence({ evaluate: async () => good }), good);
  for (const mutate of [
    (bad) => { bad.active = false; }, (bad) => { bad.visible = false; }, (bad) => { bad.fragments = []; },
    (bad) => { bad.fragments[0].ownedHit = false; }, (bad) => { bad.outlineStyle = "none"; },
  ]) { const bad = structuredClone(good); mutate(bad); await assert.rejects(focusEvidence({ evaluate: async () => bad })); }
});
