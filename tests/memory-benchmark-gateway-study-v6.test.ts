import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate as nextEventLoopTurn } from "node:timers/promises";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { Corpus, Question } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { buildExtractionChunks } from "../scripts/benchmarks/units";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { makeGatewayReaderJobs } from "../scripts/benchmarks/gateway-study-plan-v3";
import { GatewayStudyBudget, type GatewayStudyRequest, type GatewayStudyRaw, type GatewayStudyLedgerEvent } from "../scripts/benchmarks/gateway-study-transport-v3";
import { GATEWAY_READER_FAILURE_V6_POLICY_SHA256, invokeGatewayStudyV6, parseGatewayStudyV6 } from "../scripts/benchmarks/gateway-study-transport-v6";
import { openGatewayStudyV6Store } from "../scripts/benchmarks/gateway-study-store-v6";
import { gatewayReservation, writeGatewayStudyJson } from "../scripts/benchmarks/gateway-study-store-v3";
import { gatewayStudyV5Procedure } from "../scripts/benchmarks/gateway-study-v5";
import { parseGatewayStudyV6Freeze, gatewayStudyV6Procedure, gatewayV6LedgerExposure, gatewayV6RemainingReaderJobs,
  checkGatewayV6PriorBatches, gatewayStudyV6Internals, GATEWAY_V6_PRIOR_EXPOSURE_MICROS, type GatewayStudyV6Freeze } from "../scripts/benchmarks/gateway-study-v6";

const h = (value: string) => sha256Hex(`runner-v6-synthetic:${value}`), prior = GATEWAY_V6_PRIOR_EXPOSURE_MICROS;
const auth = { method: "project-oidc", project: "example-project", scope: "example-team", environment: "development" } as const;
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function directory() { const p = await realpath(await mkdtemp(join(tmpdir(), "gateway-v6-runner-synthetic-"))); await chmod(p, 0o700); temporary.push(p); return p; }
function freeze(): GatewayStudyV6Freeze {
  const pin = (name: string) => ({ path: `/synthetic/${name}.json`, sha256: h(name) });
  return { protocol: "oh.memory-gateway-freeze.v6", createdAt: "2026-01-01T00:00:00.000Z", sourceSha256: h("source"), sourceGitHead: "a".repeat(40),
    importedStudy: pin("import"), authority: pin("authority"), originalLedger: { ...pin("ledger"), bytes: 100, exposureMicros: 100 },
    inputs: { selection: pin("selection"), legacy: pin("legacy"), exclusions: [pin("exclusion")], originalSourceSha256: h("original-source") },
    policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256, priorAmendmentExposureMicros: prior,
    procedure: gatewayStudyV6Procedure(h("judge"), auth), study: { importedJobKeysSha256: h("imported-keys") } };
}
function envelope(req: GatewayStudyRequest, failure = false) {
  const output = failure ? req.maximumOutput : 2;
  return { model: req.model, choices: [{ index: 0, finish_reason: failure ? "length" : "stop", message: { role: "assistant",
    content: failure ? "SYNTHETIC_PARTIAL_NEVER_ACCEPTED" : req.phase === "judge" ? "yes" : "Synthetic bicycle", refusal: null } }],
    usage: { prompt_tokens: 20, completion_tokens: output, total_tokens: 20 + output }, providerMetadata: { gateway: { routing: {
      originalModelId: req.model, canonicalSlug: req.model, finalProvider: "openai", resolvedProvider: "openai", modelAttemptCount: 1,
      totalProviderAttemptCount: 1, modelAttempts: [{ canonicalSlug: req.model, success: true, providerAttemptCount: 1,
        providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } };
}
async function fixture() {
  const corpora: Corpus[] = Array.from({ length: 120 }, (_, i) => ({ id: `synthetic-c${i}`, groupId: `synthetic-g${i}`,
    turns: [{ id: `synthetic-t${i}`, sessionId: `synthetic-s${i}`, date: "2026-01-01", speaker: "Casey", text: "Casey owns a bicycle." }] }));
  const questions: Question[] = corpora.map((c, i) => ({ id: `synthetic-q${i}`, corpusId: c.id, category: "single-session-user", question: `Synthetic question ${i}: what does Casey own?`,
    questionDate: "2026-01-02", answer: "SYNTHETIC_GOLD_ONLY", unanswerable: false, evidenceTurnIds: [`synthetic-t${i}`], evidenceSessionIds: [`synthetic-s${i}`] }));
  const memory = corpora.map(c => ({ corpusId: c.id, corpusSha256: corpusIdentity(c), chunks: buildExtractionChunks(c).map(chunk => ({ id: chunk.id, units: [], rejected: 0 })) }));
  const readerJobs = await makeGatewayReaderJobs({ corpora, questions, memory });
  const importedReaderResults = readerJobs.slice(0, 332).map(job => {
    const body = new TextEncoder().encode(JSON.stringify(envelope(job.request, job.ordinal === 331)));
    const raw: GatewayStudyRaw = { requestSha256: job.request.requestSha256, httpStatus: 200, body, bodyComplete: true, receivedBytes: body.length, transportError: null };
    return { job, response: parseGatewayStudyV6(job.request, gatewayReservation(job), raw) };
  });
  return { readerJobs, importedReaderResults, questions, selected: questions.map((q, i) => ({ questionId: q.id, corpusId: q.corpusId, groupId: corpora[i]!.groupId })),
    poolSize: 120, profile: await loadJudgeProfile(),
    importedJobKeys: [...Array.from({ length: 4732 }, (_, i) => h(`extraction-${i}`)), ...importedReaderResults.map(r => r.job.key)].sort() };
}
function fourRequestBarrier() {
  type Wave = { arrivals: number; gate: ReturnType<typeof Promise.withResolvers<void>>; timer: ReturnType<typeof setTimeout> };
  let wave: Wave | undefined, closed: Error | undefined;
  function cancel(error: Error) {
    closed = error;
    if (wave !== undefined) { clearTimeout(wave.timer); wave.gate.reject(error); wave = undefined; }
  }
  return {
    arrive() {
      if (closed !== undefined) return Promise.reject(closed);
      if (wave === undefined) {
        const gate = Promise.withResolvers<void>();
        wave = { arrivals: 0, gate, timer: setTimeout(() => cancel(new Error(`Synthetic wave admitted ${wave?.arrivals ?? 0}/4 requests`)), 4000) };
      }
      const current = wave;
      if (++current.arrivals === 4) { clearTimeout(current.timer); wave = undefined; current.gate.resolve(); }
      return current.gate.promise;
    },
    close() { cancel(new Error("Synthetic execution ended before its four-request wave drained")); },
  };
}
async function execute(f: Awaited<ReturnType<typeof fixture>>, path: string, maximumNewCalls: number,
  control: { failFirstJudge?: boolean; stop?: boolean; failNewReader?: boolean } = {}) {
  // These fixtures have 28 new readers, 120 judge owners and only complete four-request waves.
  if (maximumNewCalls % 4 !== 0) throw new Error("Synthetic fixture requires call limits divisible by four");
  const store = await openGatewayStudyV6Store(path, h("run-freeze")), state = gatewayStudyV6Internals.newExecutionState(), calls: { key: string; phase: string }[] = [];
  const progress: Record<string, unknown>[] = [], budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: maximumNewCalls,
    priorExposureMicros: prior + gatewayV6LedgerExposure(store.events, prior) });
  const arrivals = fourRequestBarrier(), failureObserved = Promise.withResolvers<void>(), siblings = Promise.withResolvers<void>();
  const transports: ReturnType<typeof invokeGatewayStudyV6>[] = [];
  let failedJudgeKey: string | undefined, observedFailure = false, finished = false;
  // Tests may wait for the failure event before attaching their assertion to the overall execution.
  void failureObserved.promise.catch(() => {}); void siblings.promise.catch(() => {});
  let judge = 0, reader = 0, inflight = 0, peak = 0;
  const running = gatewayStudyV6Internals.executePhases({ ...f, store, state, budget, maximumNewCalls, oidcToken: "synthetic-only",
    stopped: () => control.stop ?? false, qualify: () => {}, progress: row => progress.push(row), invoke: options => {
      const transport = invokeGatewayStudyV6({ ...options, fetcher: async () => {
        calls.push({ key: options.reservationId, phase: options.request.phase }); inflight++; peak = Math.max(peak, inflight);
        const failing = options.request.phase === "judge" ? ++judge === 1 && control.failFirstJudge : ++reader === 1 && control.failNewReader;
        if (failing && options.request.phase === "judge") failedJudgeKey = options.reservationId;
        try {
          await arrivals.arrive();
          if (control.failFirstJudge && options.request.phase === "judge" && !failing) await siblings.promise;
          return Response.json(envelope(options.request, Boolean(failing)));
        } finally { inflight--; }
      } }).catch(error => {
        if (options.reservationId === failedJudgeKey) { observedFailure = true; failureObserved.resolve(); }
        throw error;
      });
      transports.push(transport); return transport;
    } }).finally(() => {
      finished = true; arrivals.close();
      if (!observedFailure) failureObserved.reject(new Error("Synthetic execution ended without the expected judge failure"));
      siblings.reject(new Error("Synthetic execution ended while judge siblings were held"));
    });
  void running.catch(() => {});
  return { store, state, budget, calls, progress, running, counters: () => ({ inflight, peak }), finished: () => finished,
    failedJudgeObserved: failureObserved.promise, releaseJudgeSiblings: () => siblings.resolve(),
    drain: async () => { siblings.resolve(); arrivals.close(); await Promise.allSettled(transports); } };
}

describe("Gateway v6 freeze and budget boundary", () => {
  test("freezes exact policy, once-carried exposure and committed source without changing generation", () => {
    const value = freeze(); expect(parseGatewayStudyV6Freeze(value)).toEqual(value);
    const before = gatewayStudyV5Procedure(h("judge"), auth), after = gatewayStudyV6Procedure(h("judge"), auth);
    expect(after.generation).toEqual(before.generation); expect(after.budget).toEqual(before.budget);
    expect(after.judging).toEqual(before.judging); expect(after.readerFailure.carryMicros).toBe(18_268_639);
    expect(after.readerFailure.policySha256).toBe(GATEWAY_READER_FAILURE_V6_POLICY_SHA256);
    for (const changed of [{ ...value, priorAmendmentExposureMicros: prior - 1 }, { ...value, priorAmendmentExposureMicros: prior + 809209 },
      { ...value, policySha256: h("wrong") }, { ...value, sourceGitHead: "not-a-commit" }, { ...value, protocol: "oh.memory-gateway-freeze.v5" },
      { ...value, importedStudy: { ...value.importedStudy, path: "relative.json" } }, { ...value, extra: true }]) expect(() => parseGatewayStudyV6Freeze(changed)).toThrow();
    const source = { sourceSha256: value.sourceSha256, gitHead: value.sourceGitHead, dirty: false, bun: "1.3.14" } as any;
    gatewayStudyV6Internals.assertSource(source, value);
    for (const change of [{ dirty: true }, { bun: "1.3.15" }, { gitHead: "b".repeat(40) }, { sourceSha256: h("changed") }]) {
      expect(() => gatewayStudyV6Internals.assertSource({ ...source, ...change }, value)).toThrow();
    }
  });
  test("every reservation prefix includes full old exposure even if later settlement would fit", () => {
    const reserve = (micros: number): GatewayStudyLedgerEvent => ({ v: 1, id: "synthetic", kind: "reserved", micros });
    expect(gatewayV6LedgerExposure([], prior)).toBe(0);
    expect(gatewayV6LedgerExposure([reserve(40_000_000 - prior)], prior)).toBe(40_000_000 - prior);
    expect(() => gatewayV6LedgerExposure([reserve(40_000_001 - prior), { v: 1, id: "synthetic", kind: "settled", micros: 0 }], prior)).toThrow("prefix exceeds");
    for (const carry of [0, 809209, prior - 1, prior + 809209]) expect(() => gatewayV6LedgerExposure([], carry)).toThrow("carried exposure");
  });
});

describe("Gateway v6 fixed reader dispatch and drained judge continuation", () => {
  test("imports exactly the attempted prefix and rejects dropped, swapped or rebound responses", async () => {
    const f = await fixture(); expect(gatewayV6RemainingReaderJobs(f.readerJobs, f.importedReaderResults).map(j => j.ordinal)).toEqual(Array.from({ length: 28 }, (_, i) => i + 332));
    expect(() => gatewayV6RemainingReaderJobs(f.readerJobs, f.importedReaderResults.slice(1))).toThrow();
    const reversed = [...f.importedReaderResults]; [reversed[0], reversed[1]] = [reversed[1]!, reversed[0]!];
    expect(() => gatewayV6RemainingReaderJobs(f.readerJobs, reversed)).toThrow("prefix job changed");
    const changed = [...f.importedReaderResults]; changed[0] = { ...changed[0]!, response: { ...changed[0]!.response, requestSha256: h("wrong") } };
    expect(() => gatewayV6RemainingReaderJobs(f.readerJobs, changed)).toThrow("prefix response changed");
  });
  test("one shared call limit crosses 28 readers into sparse judge owners and resumes without repeating a request", async () => {
    const f = await fixture(), path = await directory(), first = await execute(f, path, 32);
    try {
      expect(await first.running).toBeNull(); expect(first.state.stopReason).toBe("call-limit");
      expect(first.state.result).toEqual({ status: "paused", phase: "judge", resolved: 4, required: 120 });
      expect(first.calls.filter(c => c.phase === "reader")).toHaveLength(28); expect(first.calls.filter(c => c.phase === "judge")).toHaveLength(4);
      expect(first.calls.every(c => !f.importedJobKeys.includes(c.key))).toBe(true); expect(first.counters()).toEqual({ inflight: 0, peak: 4 });
      expect(first.progress.some(p => p.phase === "reader" && p.resolved === 360 && p.required === 360 && p.imported === 332)).toBe(true);
    } finally { await first.store.close(); }
    const second = await execute(f, path, 256);
    try {
      const completed = await second.running; expect(completed).not.toBeNull();
      expect(second.calls).toHaveLength(116); expect(second.calls.every(c => c.phase === "judge")).toBe(true);
      expect(new Set([...first.calls, ...second.calls].map(c => c.key)).size).toBe(148);
      expect(completed!.readers).toHaveLength(360); expect(completed!.scoredCases).toHaveLength(360); expect(completed!.physicalJudgeResults).toHaveLength(120);
      expect(completed!.scoredCases[331]).toMatchObject({ status: "terminal-reader-failure", correct: 0, decisionSource: "reader-failure-policy" });
      expect(second.state.result).toMatchObject({ status: "completed", phase: "judge", resolved: 360, required: 360, modelJudgedCases: 359, policyScoredReaderFailures: 1, physicalJudgeRequests: 120 });
      expect(second.state.stopReason).toBeNull(); expect(second.counters().peak).toBe(4);
      expect(second.budget.summary.accountedUsd).toBe((prior + gatewayV6LedgerExposure(second.store.events, prior)) / 1e6);
    } finally { await second.store.close(); }
  }, 30_000);
  test("future same-class reader failure keeps all cases and does not trigger a replacement request", async () => {
    const f = await fixture(), path = await directory(), run = await execute(f, path, 256, { failNewReader: true });
    try {
      const completed = await run.running; expect(completed).not.toBeNull();
      expect(run.calls.filter(c => c.phase === "reader")).toHaveLength(28);
      expect(completed!.readers[332]).toMatchObject({ status: "terminal-reader-failure" });
      expect(completed!.assessment.coverage.policyScoredReaderFailures).toBe(2); expect(completed!.scoredCases).toHaveLength(360);
      expect(JSON.stringify(completed)).not.toContain("SYNTHETIC_PARTIAL_NEVER_ACCEPTED");
    } finally { await run.store.close(); }
  }, 30_000);
  test("a judge failure drains its three siblings, retains the reservation and dispatches no subsequent wave", async () => {
    const f = await fixture(), path = await directory(), run = await execute(f, path, 256, { failFirstJudge: true });
    try {
      await run.failedJudgeObserved;
      await nextEventLoopTurn(); // Let an incorrect fail-fast execution propagate while siblings stay held.
      expect(run.finished()).toBe(false); expect(run.counters()).toEqual({ inflight: 3, peak: 4 });
      expect(run.calls).toHaveLength(32); expect(run.store.events.filter(e => e.kind === "settled")).toHaveLength(28);
      run.releaseJudgeSiblings();
      await expect(run.running).rejects.toThrow("outside the exact-cap extraction policy");
      expect(run.state.phase).toBe("judge"); expect(run.calls).toHaveLength(32); expect(run.counters()).toEqual({ inflight: 0, peak: 4 });
      expect(run.store.events.filter(e => e.kind === "reserved")).toHaveLength(32); expect(run.store.events.filter(e => e.kind === "settled")).toHaveLength(31);
      expect(run.budget.summary.unresolvedThisRunUsd).toBeGreaterThan(0);
      expect(run.progress.filter(p => p.phase === "judge")).toHaveLength(0);
    } finally { run.releaseJudgeSiblings(); await run.running.catch(() => {}); await run.drain(); await run.store.close(); }
  });
  test("interruption and imported occupancy prevent any new transport", async () => {
    const f = await fixture(), path = await directory(), run = await execute(f, path, 4, { stop: true });
    try { expect(await run.running).toBeNull(); expect(run.state.stopReason).toBe("interrupted"); expect(run.calls).toHaveLength(0); }
    finally { await run.store.close(); }
    const occupied = await openGatewayStudyV6Store(path, h("run-freeze")); await occupied.begin(f.readerJobs[0]!); await occupied.close();
    const next = await execute(f, path, 4);
    try { await expect(next.running).rejects.toThrow("imported job cannot enter new store"); expect(next.calls).toHaveLength(0); }
    finally { await next.store.close(); }
  });
});

describe("Gateway v6 prior-batch admission and ledger chain", () => {
  test("genesis rejects saved paid responses and orphan pending jobs before admission or invocation", async () => {
    const f = await fixture();
    for (const completed of [true, false]) {
      const path = await directory();
      if (completed) {
        const priorRun = await execute(f, path, 4);
        try { expect(await priorRun.running).toBeNull(); expect(priorRun.calls).toHaveLength(4); }
        finally { await priorRun.store.close(); }
      } else {
        const orphan = await openGatewayStudyV6Store(path, h("run-freeze"));
        await orphan.begin(f.readerJobs[332]!); await orphan.close();
        await rm(join(path, "ledger.jsonl"));
      }
      const before = completed ? await readFile(join(path, "ledger.jsonl")) : null;
      let admissions = 0, invocations = 0;
      const admissionAttempt = async () => {
        await checkGatewayV6PriorBatches(path, h("run-freeze"), freeze());
        admissions++; invocations++;
      };
      await expect(admissionAttempt()).rejects.toThrow("occupied store without native batch history");
      expect(admissions).toBe(0); expect(invocations).toBe(0);
      expect((await readdir(path)).some(name => name.startsWith("batch-"))).toBe(false);
      if (before !== null) expect(await readFile(join(path, "ledger.jsonl"))).toEqual(before);
    }
  });
  test("the opened store must match the authenticated native frontier before admission", async () => {
    const path = await directory(), frontier = await checkGatewayV6PriorBatches(path, h("run-freeze"), freeze());
    const store = await openGatewayStudyV6Store(path, h("run-freeze"));
    try {
      expect(frontier.keys).toEqual([]); expect(frontier.ledgerBytes).toBe(0);
      await gatewayStudyV6Internals.assertStoreFrontier(path, store, frontier);
      const f = await fixture(); await store.begin(f.readerJobs[332]!);
      await expect(gatewayStudyV6Internals.assertStoreFrontier(path, store, frontier)).rejects.toThrow("native history keys");
    } finally { await store.close(); }
  });
  async function savedBatch() {
    const path = await directory(), f = freeze(), freezeSha256 = h("freeze"), runId = randomUUID(), start = "2026-01-01T00:00:01.000Z", keys = [0, 1, 2, 3].map(i => h(`job${i}`));
    const events: GatewayStudyLedgerEvent[] = [...keys.map(id => ({ v: 1 as const, id, kind: "reserved" as const, micros: 20 })),
      ...keys.map(id => ({ v: 1 as const, id, kind: "settled" as const, micros: 10 }))];
    const ledger = events.map(e => JSON.stringify(e)).join("\n") + "\n"; await writeFile(join(path, "ledger.jsonl"), ledger, { mode: 0o600 });
    const identity = { runId, freezeSha256, sourceSha256: f.sourceSha256, sourceGitHead: f.sourceGitHead, importedStudySha256: f.importedStudy.sha256,
      policySha256: f.policySha256, priorAmendmentExposureMicros: prior, importedJobKeysSha256: f.study.importedJobKeysSha256 };
    const admission = { protocol: "oh.memory-gateway-batch-admission.v6", ...identity, start, maximumNewCalls: 4, concurrency: 4,
      openingLedgerExposureMicros: 0, initialJobKeysSha256: canonicalSha256([]), qualified: { synthetic: true } };
    const admissionPath = join(path, `batch-${runId}-started.json`), admissionPin = await writeGatewayStudyJson(admissionPath, admission);
    const closure = { protocol: "oh.memory-gateway-batch.v6", ...identity, start, end: "2026-01-01T00:00:02.000Z", admission: admissionPin,
      maximumNewCalls: 4, concurrency: 4, newTransportInvocations: 4, initialJobKeys: [], admittedKeys: keys, finalJobKeys: [...keys].sort(), failed: false,
      interrupted: false, stopReason: "call-limit", comparisonArtifact: null, result: { status: "paused", phase: "reader" },
      storeClosed: true, sourceVerifiedAtClose: true, importVerifiedAtClose: true, originalLedgerVerifiedAtClose: true, qualified: { synthetic: true },
      ledger: { path: join(path, "ledger.jsonl"), bytes: Buffer.byteLength(ledger), sha256: sha256Hex(ledger), exposureMicros: 40,
        priorAmendmentExposureMicros: prior, totalAmendmentExposureMicros: prior + 40 } };
    const closurePath = join(path, `batch-${runId}.json`), check = () => checkGatewayV6PriorBatches(path, freezeSha256, f);
    return { path, f, admission, admissionPath, closure, closurePath, check };
  }
  test("requires closed admission, matching identity, clean flags and complete current ledger prefix", async () => {
    const b = await savedBatch(); await expect(b.check()).rejects.toThrow("unclosed batch admission");
    await writeGatewayStudyJson(b.closurePath, b.closure); const before = await readFile(b.closurePath); await b.check(); expect(await readFile(b.closurePath)).toEqual(before);
    for (const changed of [{ failed: true }, { importVerifiedAtClose: false }, { sourceGitHead: "b".repeat(40) }, { policySha256: h("wrong") },
      { priorAmendmentExposureMicros: prior - 1 }, { stopReason: "budget" }, { result: { status: "completed", phase: "judge" } },
      { interrupted: true }, { importedJobKeysSha256: h("changed") }]) {
      await writeFile(b.closurePath, JSON.stringify({ ...b.closure, ...changed })); await expect(b.check()).rejects.toThrow("did not close for continuation");
    }
    await writeFile(b.closurePath, JSON.stringify(b.closure));
    await writeFile(join(b.path, "ledger.jsonl"), (await readFile(join(b.path, "ledger.jsonl"), "utf8")) + "{}\n");
    await expect(b.check()).rejects.toThrow("unclosed ledger suffix");
  });
  test("resealed admission cannot discard prior exposure, change opening exposure or alter the call limit", async () => {
    const b = await savedBatch();
    for (const change of [{ priorAmendmentExposureMicros: 809209 }, { openingLedgerExposureMicros: 1 }, { maximumNewCalls: 8 }]) {
      const raw = JSON.stringify({ ...b.admission, ...change }); await writeFile(b.admissionPath, raw);
      await writeFile(b.closurePath, JSON.stringify({ ...b.closure, admission: { path: b.admissionPath, sha256: sha256Hex(raw) } }), { mode: 0o600 });
      await expect(b.check()).rejects.toThrow("prior admission binding");
    }
  });
});
