import { afterEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, readFile, realpath, rename, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { completeClaudeExtractionOutcome } from "../scripts/benchmarks/claude-extraction-outcome";
import type { ClaudeExtractionOutcomeV3 } from "../scripts/benchmarks/claude-extraction-outcome-v3";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import { CLAUDE_STUDY_MODEL, makeClaudeExtractionJobs, type ClaudeCorpusMemory, type ClaudeExtractionJob } from "../scripts/benchmarks/claude-study-plan";
import { CLAUDE_SUBSCRIPTION_PROFILE, type ClaudeInvocation } from "../scripts/benchmarks/claude-subscription";
import { DATASETS, type Corpus, type Question } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { completeGatewayExtraction, completeGatewayJudge, completeGatewayReader, expandGatewayJudgments, gatewayStudyMemory,
  makeGatewayExtractionJobs, makeGatewayJudgePlan, makeGatewayReaderJobs, type GatewayJob } from "../scripts/benchmarks/gateway-study-plan-v3";
import { gatewayReservation, openGatewayStudyStore, readGatewaySavedJob, writeGatewayStudyJson } from "../scripts/benchmarks/gateway-study-store-v3";
import { GatewayStudyBudget, gatewayStudyLedgerExposure, invokeGatewayStudy, parseGatewayStudyResponse,
  type GatewayStudyFetcher, type GatewayStudyRaw } from "../scripts/benchmarks/gateway-study-transport-v3";
import { checkGatewayPriorBatches, gatewayStudyProcedure, parseGatewayStudyFreeze, qualifyGatewayOIDC, readGatewayStudyAuth,
  settleGatewayWave, type GatewayStudyAuth } from "../scripts/benchmarks/gateway-study-v3";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, EXTRACTION_SCHEMA, parseMemoryUnits } from "../scripts/benchmarks/units";

const auth = { method: "project-oidc", project: "example-project", scope: "example-team", environment: "development" } as const;
const h = (label: string) => sha256Hex(`gateway-v3-integration-synthetic:${label}`), freezeSha256 = h("freeze");
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "oh-gateway-v3-synthetic-")));
  await chmod(path, 0o700); temporary.push(path); return path;
}
function fixture(families = 2) {
  const corpora: Corpus[] = Array.from({ length: families }, (_, n) => ({ id: `corpus-${n}`, groupId: `family-${n}`, turns: [
    { id: `turn-${n}-a`, sessionId: `session-${n}-a`, date: "2026-01-01", speaker: "Casey", text: `Casey owns bicycle ${n}.` },
    { id: `turn-${n}-b`, sessionId: `session-${n}-b`, date: "2026-01-02", speaker: "Casey", text: `Casey paints bicycle ${n} blue.` },
  ] }));
  const questions: Question[] = corpora.map((corpus, n) => ({ id: `question-${n}`, corpusId: corpus.id, category: "single-session-user",
    question: `What does Casey own in conversation ${n}?`, questionDate: "2026-01-03", answer: `GOLD_SENTINEL_${n}`,
    unanswerable: false, evidenceTurnIds: [`turn-${n}-a`], evidenceSessionIds: [`session-${n}-a`] }));
  const memory: ClaudeCorpusMemory[] = corpora.map(corpus => ({ corpusId: corpus.id, corpusSha256: corpusIdentity(corpus),
    chunks: buildExtractionChunks(corpus).map(chunk => {
      const turn = chunk.turns[0]!, parsed = parseMemoryUnits({ units: [{ text: turn.text, supports: [{ turnId: turn.id, quote: turn.text }] }] }, chunk);
      return { id: chunk.id, units: parsed.units, rejected: parsed.rejected };
    }) }));
  let ordinal = 0;
  const legacy: ClaudeLegacyExtraction = { protocol: "oh.memory-claude-legacy.v1",
    provenance: { reportSha256: h("legacy"), sourceSha256: h("source"), selectionReportSha256: h("selection"),
      dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256, split: "test", seed: 17, originalStatus: "incomplete",
      extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION), reader: "openai/gpt-4.1-mini",
        provider: "vercel-gateway", maximumOutput: 8192 }, schemaSha256: canonicalSha256(EXTRACTION_SCHEMA),
      reportedUsage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 3, micros: 9 } },
    parents: memory.flatMap(entry => entry.chunks.map(payload => ({ ordinal: ordinal++, corpusId: entry.corpusId,
      corpusSha256: entry.corpusSha256, chunkId: payload.id,
      legacy: ordinal === 1 ? { origin: "legacy-native", payload, payloadSha256: canonicalSha256(payload) } : null }))),
    requiredChunks: families * 2, completedChunks: 1, missingChunks: families * 2 - 1, totalUnits: 1, qualifications: [] };
  const original = makeClaudeExtractionJobs(corpora, legacy);
  return { corpora, questions, memory, legacy, original };
}
function imported(job: ClaudeExtractionJob, prediction = '{"units":[]}'): ClaudeExtractionOutcomeV3 {
  const invocation: ClaudeInvocation = { protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256: job.requestSha256, status: "completed",
    exitCode: 0, timedOut: false, outputBoundExceeded: false, stdout: { bytes: 20, sha256: h("stdout") }, stderr: { bytes: 0, sha256: sha256Hex("") },
    completion: { prediction, reportedModel: CLAUDE_STUDY_MODEL, sessionId: "synthetic-session", numTurns: 1, durationMs: 5,
      usage: { inputTokens: 10, outputTokens: 3, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
      modelUsage: {}, listPriceEstimateUsd: .001, billedUsd: null, physicalModelAttempts: null } };
  return completeClaudeExtractionOutcome(job, invocation);
}
function responseBody(job: GatewayJob, content: string | null = '{"units":[]}', finish = "stop", refusal: string | null = null) {
  const family = job.request.model.slice(7);
  return { id: `synthetic-${job.key}`, model: family, choices: [{ index: 0, finish_reason: finish,
    message: { role: "assistant", content, refusal } }], usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 },
    providerMetadata: { gateway: { cost: "0.00002", routing: { finalProvider: "openai",
      resolvedProviderApiModelId: `${family}-${family === "gpt-4o" ? "2024-08-06" : "2025-04-14"}` } } } };
}
function response(job: GatewayJob, content = '{"units":[]}') {
  const body = new TextEncoder().encode(JSON.stringify(responseBody(job, content)));
  const raw: GatewayStudyRaw = { requestSha256: job.request.requestSha256, httpStatus: 200, body,
    bodyComplete: true, receivedBytes: body.length, transportError: null };
  return parseGatewayStudyResponse(job.request, gatewayReservation(job), raw);
}
async function runStored(store: Awaited<ReturnType<typeof openGatewayStudyStore>>, job: GatewayJob,
  budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }), fetcher?: GatewayStudyFetcher) {
  await store.begin(job);
  const result = await invokeGatewayStudy({ request: job.request, oidcToken: "synthetic-no-provider-token", reservationId: job.key, budget,
    record: event => store.record(job, event), capture: raw => store.capture(job, raw),
    fetcher: fetcher ?? (async () => Response.json(responseBody(job))) });
  await store.complete(job, result); return result;
}

describe("Gateway study v3 fixed parent and matrix planning", () => {
  test("new provider keys cannot re-admit previously attempted valid or malformed parents", () => {
    const f = fixture(), first = f.original[0]!, second = f.original[1]!;
    const history = new Map<string, ClaudeExtractionOutcomeV3>([[first.key, imported(first)], [second.key, imported(second, '{"units":[')]]);
    const jobs = makeGatewayExtractionJobs(f.original, history);
    expect(jobs).toHaveLength(1); expect(jobs[0]!.ordinal).toBe(3);
    expect(jobs[0]!.key).not.toBe(jobs[0]!.original.key);
    expect(jobs[0]!.request.requestSha256).not.toBe(jobs[0]!.original.requestSha256);
    expect(jobs[0]!.request.body.max_tokens).toBe(16384);
    expect(JSON.stringify(jobs[0]!.request)).not.toContain("GOLD_SENTINEL");
    const changedKey = [{ ...first, key: h("changed-provider-job") }, ...f.original.slice(1)];
    expect(() => makeGatewayExtractionJobs(changedKey, history)).toThrow("imported parent binding");
    expect(() => makeGatewayExtractionJobs(f.original, new Map([[h("other"), imported(first)]]))).toThrow();
    expect(() => makeGatewayExtractionJobs([...f.original, first], history)).toThrow("duplicate original parent");
  });
  test("invalid extraction adapters and native empty/all-rejected payloads retain distinct dispositions", () => {
    const job = makeGatewayExtractionJobs(fixture().original, new Map())[0]!;
    for (const [text, status, reason, rejected] of [["{", "invalid-envelope", "invalid-json", 0],
      ['{"wrong":[]}', "invalid-envelope", "wrong-envelope", 0], ['{"units":[]}', "valid", null, 0],
      ['{"units":[null]}', "valid", null, 1]] as const) {
      const row = completeGatewayExtraction(job, response(job, text));
      expect(row).toMatchObject({ status, reason }); expect(row.payload.units).toEqual([]); expect(row.payload.rejected).toBe(rejected);
      expect(row.payloadSha256).toBe(canonicalSha256(row.payload)); expect(row.originalJobKey).toBe(job.original.key);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(responseBody(job, null, "stop", "Synthetic refusal")));
    const rejected = parseGatewayStudyResponse(job.request, gatewayReservation(job), { requestSha256: job.request.requestSha256,
      httpStatus: 200, body: bytes, bodyComplete: true, receivedBytes: bytes.length, transportError: null });
    expect(completeGatewayExtraction(job, rejected)).toMatchObject({ status: "invalid-refusal", reason: "refusal", payload: { units: [] } });
  });
  test("response transplants between distinct parents and phases fail before native semantic conversion", async () => {
    const f = fixture(), extracts = makeGatewayExtractionJobs(f.original, new Map()), readers = await makeGatewayReaderJobs(f);
    const first = extracts[0]!, second = extracts[1]!, reader = readers[0]!;
    expect(() => completeGatewayExtraction(second, response(first))).toThrow("response request or phase identity");
    expect(() => completeGatewayReader(reader, f.questions[0]!, response(first))).toThrow();
    expect(() => completeGatewayExtraction(first, response(reader, "bicycle"))).toThrow();
    expect(() => completeGatewayReader(readers[3]!, f.questions[1]!, response(reader, "bicycle"))).toThrow();
    expect(() => completeGatewayReader(reader, f.questions[1]!, response(reader, "bicycle"))).toThrow("authenticated reader question");
  });
  test("memory includes every legacy/imported/new parent exactly once and rejects omissions/replacements", () => {
    const f = fixture(), old = f.original[0]!, history = new Map([[old.key, imported(old, "{")]]);
    const jobs = makeGatewayExtractionJobs(f.original, history), rows = jobs.map(job => completeGatewayExtraction(job, response(job)));
    const memory = gatewayStudyMemory(f.legacy, history, rows);
    expect(memory).toHaveLength(2); expect(memory.map(entry => entry.chunks.length)).toEqual([2, 2]);
    expect(memory[0]!.chunks[0]).toEqual(f.memory[0]!.chunks[0]); expect(memory[0]!.chunks[1]!.units).toEqual([]);
    expect(() => gatewayStudyMemory(f.legacy, history, rows.slice(1))).toThrow();
    expect(() => gatewayStudyMemory(f.legacy, history, [rows[0]!, rows[0]!])).toThrow();
    expect(() => gatewayStudyMemory(f.legacy, history, [{ ...rows[0]!, ordinal: 0 }, rows[1]!])).toThrow("legacy extraction was replaced");
    expect(() => gatewayStudyMemory(f.legacy, history, [{ ...rows[0]!, corpusId: "forged" }, rows[1]!])).toThrow();
  });
  test("all three arms per family survive reader/judge aliases with complete physical owner coverage", async () => {
    const f = fixture(), readerJobs = await makeGatewayReaderJobs(f), profile = await loadJudgeProfile();
    expect(readerJobs.map(job => job.native.system)).toEqual(["bm25-window", "bm25-record-window", "oh-fact", "bm25-record-window", "oh-fact", "bm25-window"]);
    expect(readerJobs).toHaveLength(f.questions.length * 3);
    expect(JSON.stringify(readerJobs.map(job => job.request))).not.toContain("GOLD_SENTINEL");
    const readerRows = readerJobs.map(job => completeGatewayReader(job, f.questions[job.native.questionIndex]!, response(job, "bicycle")));
    const plan = makeGatewayJudgePlan({ readerJobs, readerRows, questions: f.questions, profile });
    expect(plan.jobs).toHaveLength(2); expect(plan.cases).toHaveLength(6);
    expect(plan.cases.map(row => row.ownerOrdinal)).toEqual([0, 0, 0, 3, 3, 3]);
    expect(JSON.stringify(plan.jobs.map(job => job.request))).toContain("GOLD_SENTINEL");
    const judgments = plan.jobs.map((job, n) => completeGatewayJudge(job, response(job, n === 0 ? "yes" : "no")));
    const rows = expandGatewayJudgments(plan, judgments);
    expect(rows.map(row => row.correct)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(rows.map(row => row.reusedJudgment)).toEqual([false, true, true, false, true, true]);
    expect(() => expandGatewayJudgments(plan, judgments.slice(1))).toThrow();
    expect(() => expandGatewayJudgments(plan, [judgments[0]!, judgments[0]!])).toThrow();
    expect(() => completeGatewayJudge(plan.jobs[1]!, judgments[0]!.response)).toThrow();
    expect(() => completeGatewayJudge(plan.jobs[0]!, response(plan.jobs[0]!, "yes because"))).toThrow("native yes/no");
    for (const changed of [readerRows.slice(1), [...readerRows].reverse(), readerRows.map((row, n) => n === 1 ? { ...row, tokenF1: 1 } : row)]) {
      expect(() => makeGatewayJudgePlan({ readerJobs, readerRows: changed, questions: f.questions, profile })).toThrow();
    }
  });
  test("judge expansion refuses a missing case, duplicate case or transplanted owner", async () => {
    const f = fixture(), readerJobs = await makeGatewayReaderJobs(f), profile = await loadJudgeProfile();
    const readerRows = readerJobs.map(job => completeGatewayReader(job, f.questions[job.native.questionIndex]!, response(job, "bicycle")));
    const plan = makeGatewayJudgePlan({ readerJobs, readerRows, questions: f.questions, profile });
    const judgments = plan.jobs.map(job => completeGatewayJudge(job, response(job, "yes")));
    expect(() => expandGatewayJudgments({ ...plan, cases: plan.cases.slice(1) }, judgments)).toThrow();
    expect(() => expandGatewayJudgments({ ...plan, cases: [plan.cases[0]!, plan.cases[0]!, ...plan.cases.slice(2)] }, judgments)).toThrow();
    expect(() => expandGatewayJudgments({ ...plan, cases: plan.cases.map((row, n) => n === 1 ? { ...row, ownerOrdinal: 3, jobKey: plan.jobs[1]!.key } : row) }, judgments)).toThrow();
    const forged = plan.cases.map((row, n) => n === 1 ? { ...row, ownerOrdinal: 3, jobKey: plan.jobs[1]!.key } : row);
    expect(() => expandGatewayJudgments({ ...plan, cases: forged, casesSha256: canonicalSha256(forged) }, judgments)).toThrow("first-owner");
  });
});

describe("Gateway study v3 durable first-response storage", () => {
  test("captures, settles, closes and replays without permitting an occupied job retry", async () => {
    const path = await directory(), job = makeGatewayExtractionJobs(fixture().original, new Map())[0]!;
    const store = await openGatewayStudyStore(path, freezeSha256);
    const result = await runStored(store, job); expect(await store.lookup(job)).toEqual(result);
    const exposure = gatewayStudyLedgerExposure(store.events); expect(exposure).toBe(result.usage.micros);
    await expect(store.begin(job)).rejects.toThrow("occupied first response"); await store.close();
    const resumed = await openGatewayStudyStore(path, freezeSha256);
    try {
      expect(resumed.exposure).toBe(exposure); expect(await resumed.lookup(job)).toEqual(result);
      await expect(resumed.begin(job)).rejects.toThrow("occupied first response");
      expect((await lstat(join(path, "ledger.jsonl"))).mode & 0o777).toBe(0o600);
    } finally { await resumed.close(); }
    await expect(lstat(join(path, "active.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  test("four overlapping synthetic requests share durable reservations and one budget across reverse completions", async () => {
    const path = await directory(), jobs = makeGatewayExtractionJobs(fixture(3).original, new Map()).slice(0, 4);
    const store = await openGatewayStudyStore(path, freezeSha256), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 4 });
    const releases: Array<() => void> = []; let active = 0, maximum = 0, calls = 0;
    let allAdmitted!: () => void; const ready = new Promise<void>(resolve => { allAdmitted = resolve; });
    const running = jobs.map(job => runStored(store, job, budget, async () => {
      calls++; active++; maximum = Math.max(maximum, active);
      expect(store.events.filter(event => event.id === job.key && event.kind === "reserved")).toHaveLength(1);
      await new Promise<void>(resolve => { releases.push(resolve); if (releases.length === 4) allAdmitted(); });
      active--; return Response.json(responseBody(job));
    }));
    try {
      await ready; expect(calls).toBe(4); expect(maximum).toBe(4); expect(store.events.filter(event => event.kind === "reserved")).toHaveLength(4);
      for (const release of [...releases].reverse()) release();
      const results = await Promise.all(running);
      expect(store.events).toHaveLength(8); expect(gatewayStudyLedgerExposure(store.events)).toBe(results.reduce((n, r) => n + r.usage.micros, 0));
      expect(budget.summary.unresolvedThisRunUsd).toBe(0); expect(budget.summary.reservedCalls).toBe(4);
      for (const [i, job] of jobs.entries()) expect(await store.lookup(job)).toEqual(results[i]!);
    } finally { for (const release of releases) release(); await Promise.allSettled(running); await store.close(); }
    const resumed = await openGatewayStudyStore(path, freezeSha256);
    try { expect(resumed.exposure).toBe(80); expect(resumed.keys()).toEqual(jobs.map(job => job.key).sort()); }
    finally { await resumed.close(); }
  });
  test("transport failure leaves its capture and reservation occupied across reopen", async () => {
    const path = await directory(), job = makeGatewayExtractionJobs(fixture().original, new Map())[0]!;
    const store = await openGatewayStudyStore(path, freezeSha256); let calls = 0;
    await expect(runStored(store, job, undefined, async () => { calls++; throw new Error("synthetic network failure"); })).rejects.toThrow();
    expect(store.events.map(event => event.kind)).toEqual(["reserved"]); expect(calls).toBe(1);
    expect((await readFile(join(path, "jobs", job.key, "response.json"), "utf8"))).toContain('"transportError": "network"');
    await expect(store.begin(job)).rejects.toThrow("occupied"); await store.close();
    const resumed = await openGatewayStudyStore(path, freezeSha256);
    try { expect(resumed.exposure).toBe(gatewayReservation(job).micros); await expect(resumed.lookup(job)).rejects.toThrow("incomplete or unexpected occupied job");
      await expect(resumed.begin(job)).rejects.toThrow("occupied"); }
    finally { await resumed.close(); }
  });
  test("the actual runner wave drains every admitted request before rejecting, preserving the failed reservation", async () => {
    const path = await directory(), jobs = makeGatewayExtractionJobs(fixture(3).original, new Map());
    const store = await openGatewayStudyStore(path, freezeSha256), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 4 });
    const releases = new Map<string, () => void>(); let calls = 0, done = false;
    let allAdmitted!: () => void, firstFailed!: () => void;
    const ready = new Promise<void>(resolve => { allAdmitted = resolve; }), failed = new Promise<void>(resolve => { firstFailed = resolve; });
    const running = settleGatewayWave(jobs.slice(0, 4), async job => {
      try {
        return await runStored(store, job, budget, async () => {
          calls++;
          await new Promise<void>(resolve => { releases.set(job.key, resolve); if (releases.size === 4) allAdmitted(); });
          if (job.key === jobs[0]!.key) throw new Error("synthetic first-call failure");
          return Response.json(responseBody(job));
        });
      } catch (error) { if (job.key === jobs[0]!.key) firstFailed(); throw error; }
    });
    const observation = running.then(() => { done = true; return "fulfilled"; }, () => { done = true; return "rejected"; });
    try {
      await ready; releases.get(jobs[0]!.key)!(); await failed; await Promise.resolve();
      expect(done).toBe(false); expect(calls).toBe(4);
      for (const release of [...releases.values()].reverse()) release();
      expect(await observation).toBe("rejected");
      expect(store.events.filter(event => event.kind === "reserved")).toHaveLength(4);
      expect(store.events.filter(event => event.kind === "settled")).toHaveLength(3);
      expect(store.keys()).not.toContain(jobs[4]!.key);
      expect(gatewayStudyLedgerExposure(store.events)).toBe(gatewayReservation(jobs[0]!).micros + 60);
      for (const job of jobs.slice(0, 4)) expect(await lstat(join(path, "jobs", job.key, "response.json"))).toBeDefined();
      for (const job of jobs.slice(1, 4)) expect(await store.lookup(job)).not.toBeNull();
      await expect(store.lookup(jobs[0]!)).rejects.toThrow("incomplete or unexpected occupied job");
    } finally { for (const release of releases.values()) release(); await observation; await store.close(); }
  });
  test("runner wave bounds reject zero or five jobs before executing any callback", async () => {
    let calls = 0; const execute = async (value: number) => { calls++; return value * 2; };
    await expect(settleGatewayWave([], execute)).rejects.toThrow("wave must contain");
    await expect(settleGatewayWave([1, 2, 3, 4, 5], execute)).rejects.toThrow("wave must contain");
    expect(calls).toBe(0); expect(await settleGatewayWave([2, 1], execute)).toEqual([4, 2]);
  });
  test("capture without reservation and raw or result transplants do not become saved completions", async () => {
    const path = await directory(), jobs = makeGatewayExtractionJobs(fixture().original, new Map()), [one, two] = [jobs[0]!, jobs[1]!];
    const store = await openGatewayStudyStore(path, freezeSha256);
    try {
      await store.begin(one);
      const body = new TextEncoder().encode(JSON.stringify(responseBody(one)));
      await expect(store.capture(one, { requestSha256: one.request.requestSha256, httpStatus: 200, body, bodyComplete: true,
        receivedBytes: body.length, transportError: null })).rejects.toThrow("durable reservation");
      await expect(store.complete(one, response(two))).rejects.toThrow("completion identity");
    } finally { await store.close(); }
  });
  test("raw byte and derived result tampering both fail independent saved-response readback", async () => {
    for (const target of ["response.body", "result.json"] as const) {
      const path = await directory(), job = makeGatewayExtractionJobs(fixture().original, new Map())[0]!;
      const store = await openGatewayStudyStore(path, freezeSha256); await runStored(store, job);
      const events = store.events; await store.close();
      const file = join(path, "jobs", job.key, target);
      if (target === "response.body") await writeFile(file, JSON.stringify(responseBody(job, "changed")), { mode: 0o600 });
      else { const value = JSON.parse(await readFile(file, "utf8")); value.result.prediction = "changed"; await writeFile(file, JSON.stringify(value), { mode: 0o600 }); }
      await expect(readGatewaySavedJob(path, freezeSha256, job, events)).rejects.toThrow(target === "response.body" ? "response bytes changed" : "saved response projection changed");
    }
  });
  test("replacement and in-place truncation of the shared ledger prevent the next admission and successful close", async () => {
    for (const mutation of ["replace", "truncate"] as const) {
      const path = await directory(), jobs = makeGatewayExtractionJobs(fixture().original, new Map()), store = await openGatewayStudyStore(path, freezeSha256);
      await runStored(store, jobs[0]!); const ledgerPath = join(path, "ledger.jsonl");
      if (mutation === "replace") { const bytes = await readFile(ledgerPath); await rename(ledgerPath, join(path, "ledger-preserved.jsonl")); await writeFile(ledgerPath, bytes, { mode: 0o600 }); }
      else await truncate(ledgerPath, 0);
      await expect(store.begin(jobs[1]!)).rejects.toThrow("ledger path or handle changed");
      expect(store.keys()).not.toContain(jobs[1]!.key); await expect(store.close()).rejects.toThrow("ledger path or handle changed");
      expect(await lstat(join(path, "active.lock"))).toBeDefined();
    }
  });
  test("ledger mutation also prevents a successful close without a subsequent admission", async () => {
    const path = await directory(), job = makeGatewayExtractionJobs(fixture().original, new Map())[0]!, store = await openGatewayStudyStore(path, freezeSha256);
    await runStored(store, job); await truncate(join(path, "ledger.jsonl"), 0);
    await expect(store.close()).rejects.toThrow("ledger path or handle changed"); expect(await lstat(join(path, "active.lock"))).toBeDefined();
  });
  test("jobs directory replacement prevents admission even when the ledger path is unchanged", async () => {
    const path = await directory(), job = makeGatewayExtractionJobs(fixture().original, new Map())[0]!, store = await openGatewayStudyStore(path, freezeSha256);
    await rename(join(path, "jobs"), join(path, "preserved-jobs"));
    const { mkdir } = await import("node:fs/promises"); await mkdir(join(path, "jobs"), { mode: 0o700 });
    await expect(store.begin(job)).rejects.toThrow("store directory changed"); await expect(store.close()).rejects.toThrow("store directory changed");
  });
});

describe("Gateway v3 frozen procedure and admission guards", () => {
  function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    return [encode({ typ: "JWT", alg: "RS256", kid: "synthetic", ...header }), encode({ sub: "owner:example-team:project:example-project:environment:development",
      aud: "https://vercel.com/example-team", iss: "https://oidc.vercel.com/example-team", iat: 1000, exp: 5000, ...claims }), "synthetic"].join(".");
  }
  test("reads only the project identity from exact pinned authority bytes and detects changed content", async () => {
    const path = await directory(), file = join(path, "authority.json");
    const document = { schema: "oh.gateway-v3-authority.v1", project: auth.project, scope: auth.scope,
      environment: auth.environment, provider: "vercel-gateway", unrelatedApprovalMetadata: "synthetic" };
    const pin = await writeGatewayStudyJson(file, document);
    const result = await readGatewayStudyAuth(pin);
    expect(result).toEqual(auth); expect(result).not.toHaveProperty("unrelatedApprovalMetadata");
    expect(result).not.toHaveProperty("schema");
    const changed = JSON.stringify({ ...document, project: "other-project" });
    await writeFile(file, changed);
    await expect(readGatewayStudyAuth(pin)).rejects.toThrow("pinned file changed");
    expect(await readGatewayStudyAuth({ path: file, sha256: sha256Hex(changed) })).toEqual({ ...auth, project: "other-project" });
  });
  test("rejects noncanonical authority pins even when their file contents are otherwise valid", async () => {
    const path = await directory(), pin = await writeGatewayStudyJson(join(path, "authority.json"), {
      schema: "oh.gateway-v3-authority.v1", project: auth.project, scope: auth.scope, environment: auth.environment });
    for (const invalid of [{ ...pin, sha256: h("wrong-authority") }, { ...pin, sha256: pin.sha256.toUpperCase() },
      { ...pin, sha256: "not-a-digest" }, { ...pin, path: "relative-authority.json" },
      { ...pin, path: `${path}/./authority.json` }, { ...pin, extra: "unexpected-pin-field" }]) {
      await expect(readGatewayStudyAuth(invalid)).rejects.toThrow();
    }
  });
  test("rejects malformed, unbounded or wrong-schema authority and invalid approved identity fields", async () => {
    const path = await directory(), file = join(path, "authority.json"), base = {
      schema: "oh.gateway-v3-authority.v1", project: auth.project, scope: auth.scope, environment: auth.environment };
    const values = [null, [], "text", {}, { ...base, schema: "oh.gateway-v3-authority.v2" },
      { ...base, project: undefined }, { ...base, environment: "production" }, { ...base, environment: undefined },
      ...["", "Uppercase", "-leading", "trailing-", "repeated--hyphen", "space name", "a".repeat(101), 17, null].map(project => ({ ...base, project })),
      ...["", "Uppercase", "space name", undefined].map(scope => ({ ...base, scope }))];
    for (const value of values) {
      const raw = JSON.stringify(value); await writeFile(file, raw);
      await expect(readGatewayStudyAuth({ path: file, sha256: sha256Hex(raw) })).rejects.toThrow();
    }
    for (const raw of [Buffer.from("{"), Buffer.from([0xff]), Buffer.alloc(0), Buffer.alloc(1024 * 1024 + 1, 32)]) {
      await writeFile(file, raw);
      await expect(readGatewayStudyAuth({ path: file, sha256: sha256Hex(raw) })).rejects.toThrow();
    }
  });
  test("procedure copies exact approved authentication and OIDC follows that project binding", () => {
    const mutable = { ...auth, project: String(auth.project) }, procedure = gatewayStudyProcedure(h("judge"), mutable);
    expect(procedure.auth).toEqual(auth); expect(procedure.auth).not.toBe(mutable);
    mutable.project = "other-project"; expect(procedure.auth.project).toBe(auth.project);
    expect(() => qualifyGatewayOIDC(token(), mutable, 1000)).toThrow("identity or lifetime mismatch");
    expect(qualifyGatewayOIDC(token({ sub: "owner:example-team:project:other-project:environment:development" }), mutable, 1000).project).toBe("other-project");
    for (const invalid of [{ ...auth, method: "api-key" }, { ...auth, environment: "preview" }, { ...auth, extra: "ignored" }]) {
      expect(() => gatewayStudyProcedure(h("judge"), invalid as GatewayStudyAuth)).toThrow("invalid approved project identity");
      expect(() => qualifyGatewayOIDC(token(), invalid as GatewayStudyAuth, 1000)).toThrow("invalid approved project identity");
    }
  });
  test("OIDC checks exact project/environment and usable lifetime without claiming local signature verification", () => {
    expect(qualifyGatewayOIDC(token(), auth, 1000)).toMatchObject({ method: "project-oidc", signatureVerifiedLocally: false, expiresAt: 5000 });
    expect(qualifyGatewayOIDC(token({ iss: "https://oidc.vercel.com" }), auth, 1000).signatureVerifiedLocally).toBe(false);
    for (const claims of [{ sub: "owner:example-team:project:other:environment:development" }, { aud: "https://vercel.com/other" },
      { iss: "https://oidc.example.com/example-team" }, { exp: 1309 }, { iat: 1061 }]) expect(() => qualifyGatewayOIDC(token(claims), auth, 1000)).toThrow();
    expect(() => qualifyGatewayOIDC(token({}, { alg: "none" }), auth, 1000)).toThrow();
    expect(() => qualifyGatewayOIDC("not-a-token", auth, 1000)).toThrow();
  });
  test("freeze parsing binds the versioned procedure, canonical pins and fixed spending policy", () => {
    const pin = { path: "/tmp/synthetic-input.json", sha256: h("pin") }, procedure = gatewayStudyProcedure(h("judge"), auth);
    const freeze = { protocol: "oh.memory-gateway-freeze.v3" as const, createdAt: "2026-01-01T00:00:00.000Z", sourceSha256: h("source"),
      importedStudy: pin, authority: pin, originalLedger: { ...pin, bytes: 925682, exposureMicros: 21655385 },
      inputs: { selection: pin, legacy: pin, exclusions: [pin], originalSourceSha256: h("original") }, procedure, study: {} };
    expect(parseGatewayStudyFreeze(freeze)).toEqual(freeze);
    expect(procedure.generation).toMatchObject({ only: ["openai"], fallbackModels: [], ordinaryRetryLimit: 0, concurrency: 4 });
    expect(procedure.budget).toMatchObject({ newCapMicros: 40_000_000, sharedAcrossAllPhases: true, originalLedgerImmutable: true });
    for (const invalid of [{ ...freeze, protocol: "old" }, { ...freeze, createdAt: "2026-01-01" },
      { ...freeze, importedStudy: { ...pin, path: "relative.json" } }, { ...freeze, sourceSha256: h("source").toUpperCase() },
      { ...freeze, extra: true }]) expect(() => parseGatewayStudyFreeze(invalid)).toThrow();
  });
  test("prior batch admission must have an authenticated successful closure before continuation", async () => {
    const path = await directory(), runId = randomUUID(), source = h("source"), imported = h("imported"), start = "2026-01-01T00:00:00.000Z";
    const admission = await writeGatewayStudyJson(join(path, `batch-${runId}-started.json`), { protocol: "oh.memory-gateway-batch-admission.v3",
      runId, freezeSha256, sourceSha256: source, importedStudySha256: imported, maximumNewCalls: 4, start });
    await expect(checkGatewayPriorBatches(path, freezeSha256, source, imported)).rejects.toThrow("unclosed batch admission");
    const closure = { protocol: "oh.memory-gateway-batch.v3", runId, freezeSha256, sourceSha256: source, importedStudySha256: imported,
      failed: false, storeClosed: true, sourceVerifiedAtClose: true, importVerifiedAtClose: true, originalLedgerVerifiedAtClose: true,
      admission, maximumNewCalls: 4, start };
    const closePath = join(path, `batch-${runId}.json`); await writeGatewayStudyJson(closePath, closure);
    await checkGatewayPriorBatches(path, freezeSha256, source, imported);
    for (const flag of ["failed", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose"] as const) {
      await writeFile(closePath, JSON.stringify({ ...closure, [flag]: flag === "failed" }), { mode: 0o600 });
      await expect(checkGatewayPriorBatches(path, freezeSha256, source, imported)).rejects.toThrow("prior batch did not close successfully");
    }
    await writeFile(closePath, JSON.stringify({ ...closure, maximumNewCalls: 8 }), { mode: 0o600 });
    await expect(checkGatewayPriorBatches(path, freezeSha256, source, imported)).rejects.toThrow("prior admission binding");
  });
});
