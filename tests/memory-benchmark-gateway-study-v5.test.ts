import { afterEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import { makeClaudeExtractionJobs } from "../scripts/benchmarks/claude-study-plan";
import { DATASETS, type Corpus, type Question } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { completeGatewayExtraction, completeGatewayReader, completeGatewayJudge, gatewayStudyMemory, makeGatewayExtractionJobs,
  makeGatewayReaderJobs, makeGatewayJudgePlan, type GatewayJob, type GatewayExtractionJob } from "../scripts/benchmarks/gateway-study-plan-v3";
import { completeGatewayV5Extraction, completeGatewayV5Reader, completeGatewayV5Judge } from "../scripts/benchmarks/gateway-study-plan-v5";
import { gatewayJobPending, gatewayReservation, openGatewayStudyStore, readGatewaySavedJob } from "../scripts/benchmarks/gateway-study-store-v3";
import { gatewayV5JobPending, openGatewayStudyV5Store, readGatewayV5SavedJob } from "../scripts/benchmarks/gateway-study-store-v5";
import { GatewayStudyBudget, gatewayStudyLedgerExposure, invokeGatewayStudy, parseGatewayStudyResponse,
  type GatewayStudyRaw, type GatewayStudyFetcher } from "../scripts/benchmarks/gateway-study-transport-v3";
import { invokeGatewayStudyV5, parseGatewayStudyV5, type GatewayStudyV5Result } from "../scripts/benchmarks/gateway-study-transport-v5";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, EXTRACTION_SCHEMA } from "../scripts/benchmarks/units";

const h = (s: string) => sha256Hex(`gateway-v5-synthetic:${s}`), freeze = h("freeze"), partial = "TRUNCATED_TEXT_MUST_NOT_BECOME_MEMORY";
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function directory() { const p = await realpath(await mkdtemp(join(tmpdir(), "gateway-v5-synthetic-"))); await chmod(p, 0o700); temporary.push(p); return p; }
function fixture() {
  const corpus: Corpus = { id: "synthetic-corpus", groupId: "synthetic-group", turns: [0, 1].map(n => ({ id: `turn-${n}`, sessionId: `session-${n}`,
    date: "2026-01-01", speaker: "Casey", text: `Casey owns bicycle ${n}.` })) };
  const questions: Question[] = [{ id: "synthetic-question", corpusId: corpus.id, category: "single-session-user", question: "What does Casey own?",
    questionDate: "2026-01-02", answer: "GOLD_SENTINEL", unanswerable: false, evidenceTurnIds: ["turn-0"], evidenceSessionIds: ["session-0"] }];
  const legacy: ClaudeLegacyExtraction = { protocol: "oh.memory-claude-legacy.v1", provenance: { reportSha256: h("legacy"), sourceSha256: h("source"),
    selectionReportSha256: h("selection"), dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256, split: "test", seed: 17, originalStatus: "incomplete",
    extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION), reader: "openai/gpt-4.1-mini", provider: "vercel-gateway", maximumOutput: 8192 },
    schemaSha256: canonicalSha256(EXTRACTION_SCHEMA), reportedUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 } },
    parents: buildExtractionChunks(corpus).map((chunk, ordinal) => ({ ordinal, corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunkId: chunk.id, legacy: null })),
    requiredChunks: 2, completedChunks: 0, missingChunks: 2, totalUnits: 0, qualifications: [] };
  return { corpus, questions, legacy, jobs: makeGatewayExtractionJobs(makeClaudeExtractionJobs([corpus], legacy), new Map()) };
}
function envelope(job: GatewayJob, content: string | null = partial, finish = "length", refusal: string | null = null) {
  const output = finish === "length" ? 16384 : 2;
  return { model: job.request.model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content, refusal } }],
    usage: { prompt_tokens: 20, completion_tokens: output, total_tokens: 20 + output }, providerMetadata: { gateway: { routing: {
      originalModelId: job.request.model, canonicalSlug: job.request.model, resolvedProvider: "openai", finalProvider: "openai", modelAttemptCount: 1,
      totalProviderAttemptCount: 1, modelAttempts: [{ canonicalSlug: job.request.model, success: true, providerAttemptCount: 1,
        providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } };
}
function raw(job: GatewayJob, value: unknown = envelope(job)): GatewayStudyRaw {
  const body = new TextEncoder().encode(JSON.stringify(value));
  return { requestSha256: job.request.requestSha256, httpStatus: 200, bodyComplete: true, receivedBytes: body.length, transportError: null, body };
}
function parsed(job: GatewayJob, value: unknown = envelope(job)) { return parseGatewayStudyV5(job.request, gatewayReservation(job), raw(job, value)); }
async function runStored(store: Awaited<ReturnType<typeof openGatewayStudyV5Store>>, job: GatewayJob, fetcher: GatewayStudyFetcher = async () => Response.json(envelope(job))) {
  const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1, priorExposureMicros: 809209 });
  await store.begin(job);
  const result = await invokeGatewayStudyV5({ request: job.request, oidcToken: "synthetic-project-oidc", reservationId: job.key, budget,
    record: e => store.record(job, e), capture: r => store.capture(job, r), fetcher });
  await store.complete(job, result); return { result, budget };
}

describe("Gateway v5 extraction outcome boundary", () => {
  test("exact-cap truncation is explicit zero memory even when the output is parseable JSON", () => {
    const job = fixture().jobs[0]!;
    for (const text of [partial, '{"units":[]}']) {
      const response = parsed(job, envelope(job, text)), row = completeGatewayV5Extraction(job, response);
      expect(row).toMatchObject({ profile: "oh.memory-gateway-study-plan.v5", origin: "gateway-v5-first-response", status: "invalid-truncation", reason: "output-token-limit",
        jobKey: job.key, originalJobKey: job.original.key, ordinal: job.ordinal, requestSha256: job.request.requestSha256, payload: { id: job.original.chunk.id, units: [], rejected: 0 } });
      expect(row.payloadSha256).toBe(canonicalSha256(row.payload)); expect(row.response).not.toHaveProperty("prediction");
      expect(JSON.stringify(row)).not.toContain(partial); expect(Object.isFrozen(row)).toBe(true); expect(Object.isFrozen(row.payload.units)).toBe(true);
    }
  });
  test("valid, malformed, all-rejected and refusal extraction rows retain their exact native semantics", () => {
    const job = fixture().jobs[0]!;
    for (const [content, refusal] of [['{"units":[]}', null], ['{"units":[null]}', null], ["{", null], [null, "Synthetic refusal"]] as const) {
      const capture = raw(job, envelope(job, content, "stop", refusal)), old = parseGatewayStudyResponse(job.request, gatewayReservation(job), capture);
      const next = parseGatewayStudyV5(job.request, gatewayReservation(job), capture);
      expect(completeGatewayV5Extraction(job, next)).toEqual(completeGatewayExtraction(job, old));
    }
  });
  test("truncation cannot transplant requests or weaken reader and judge outcomes", async () => {
    const f = fixture(), first = f.jobs[0]!, second = f.jobs[1]!, truncated = parsed(first);
    expect(() => completeGatewayV5Extraction(second, truncated)).toThrow();
    for (const response of [{ ...truncated, requestSha256: h("wrong") }, { ...truncated, identity: { ...truncated.identity, requestedModel: "openai/gpt-4o" as const } },
      { ...truncated, usage: { ...truncated.usage, outputTokens: 16383 } }, { ...truncated, prediction: partial }]) expect(() => completeGatewayV5Extraction(first, response)).toThrow();
    const rows = f.jobs.map(j => completeGatewayV5Extraction(j, parsed(j))), memory = gatewayStudyMemory(f.legacy, new Map(), rows);
    const readers = await makeGatewayReaderJobs({ corpora: [f.corpus], questions: f.questions, memory });
    const ordinary = parsed(readers[0]!, envelope(readers[0]!, "bicycle", "stop"));
    expect(completeGatewayV5Reader(readers[0]!, f.questions[0]!, ordinary)).toEqual(completeGatewayReader(readers[0]!, f.questions[0]!, ordinary as Exclude<GatewayStudyV5Result, { kind: "truncated-extraction" }>));
    expect(() => completeGatewayV5Reader(readers[0]!, f.questions[0]!, truncated)).toThrow("outside extraction");
    expect(() => completeGatewayV5Extraction(readers[0] as unknown as GatewayExtractionJob, truncated)).toThrow();
    const readerRows = readers.map(j => completeGatewayV5Reader(j, f.questions[0]!, parsed(j, envelope(j, "bicycle", "stop"))));
    const judges = makeGatewayJudgePlan({ readerJobs: readers, readerRows, questions: f.questions, profile: await loadJudgeProfile() }), judge = judges.jobs[0]!;
    const yes = parsed(judge, envelope(judge, "yes", "stop"));
    expect(completeGatewayV5Judge(judge, yes)).toEqual(completeGatewayJudge(judge, yes as Exclude<GatewayStudyV5Result, { kind: "truncated-extraction" }>));
    expect(() => completeGatewayV5Judge(judge, truncated)).toThrow("outside extraction");
  });
  test("failed extraction parents remain in complete memory coverage and cannot replace earlier parents", () => {
    const f = fixture(), rows = f.jobs.map(j => completeGatewayV5Extraction(j, parsed(j))), memory = gatewayStudyMemory(f.legacy, new Map(), rows);
    expect(memory[0]!.chunks).toHaveLength(2); expect(memory[0]!.chunks.every(c => c.units.length === 0 && c.rejected === 0)).toBe(true);
    expect(JSON.stringify(memory)).not.toContain(partial);
    expect(() => gatewayStudyMemory(f.legacy, new Map(), rows.slice(1))).toThrow();
    expect(() => gatewayStudyMemory(f.legacy, new Map(), [rows[0]!, rows[0]!])).toThrow();
  });
});

describe("Gateway v5 durable raw reconstruction and version isolation", () => {
  test("captures and settles only the new job, closes, and reopens the same text-free truncation", async () => {
    const p = await directory(), job = fixture().jobs[0]!, store = await openGatewayStudyV5Store(p, freeze); let calls = 0;
    const { result, budget } = await runStored(store, job, async () => { calls++; return Response.json(envelope(job)); });
    expect(calls).toBe(1); expect(store.events.map(e => e.kind)).toEqual(["reserved", "settled"]);
    expect(gatewayStudyLedgerExposure(store.events)).toBe(result.usage.micros);
    expect(budget.summary.accountedUsd).toBe((809209 + result.usage.micros) / 1e6);
    expect(await store.lookup(job)).toEqual(result); await expect(store.begin(job)).rejects.toThrow("occupied first response"); await store.close();
    const reopened = await openGatewayStudyV5Store(p, freeze);
    try { expect(await reopened.lookup(job)).toEqual(result); expect(reopened.exposure).toBe(result.usage.micros);
      expect(await readGatewayV5SavedJob(p, freeze, job, reopened.events)).toEqual(result);
      await expect(reopened.begin(job)).rejects.toThrow("occupied first response");
      const projection = await readFile(join(p, "jobs", job.key, "result.json"), "utf8"); expect(projection).not.toContain(partial);
      expect(await readFile(join(p, "jobs", job.key, "response.body"), "utf8")).toContain(partial);
    } finally { await reopened.close(); }
    await expect(lstat(join(p, "active.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  test("raw bytes, reservations, settlements and saved projections must all agree", async () => {
    for (const file of ["response.body", "reserved.json", "settled.json", "result.json", "pending.json"]) {
      const p = await directory(), job = fixture().jobs[0]!, store = await openGatewayStudyV5Store(p, freeze);
      await runStored(store, job); const events = store.events; await store.close();
      await writeFile(join(p, "jobs", job.key, file), "{}\n", { mode: 0o600 });
      await expect(readGatewayV5SavedJob(p, freeze, job, events)).rejects.toThrow();
    }
  });
  test("an out-of-policy length remains occupied capture evidence with no settlement or retry", async () => {
    const p = await directory(), job = fixture().jobs[0]!, store = await openGatewayStudyV5Store(p, freeze); let calls = 0;
    const value = envelope(job); value.usage.completion_tokens = 16383; value.usage.total_tokens = 16403;
    await expect(runStored(store, job, async () => { calls++; return Response.json(value); })).rejects.toThrow();
    expect(calls).toBe(1); expect(store.events.map(e => e.kind)).toEqual(["reserved"]);
    expect(gatewayStudyLedgerExposure(store.events)).toBe(gatewayReservation(job).micros);
    expect((await readdir(join(p, "jobs", job.key))).sort()).toEqual(["pending.json", "reserved.json", "response.body", "response.json"]);
    await expect(store.lookup(job)).rejects.toThrow("incomplete or unexpected"); await expect(store.begin(job)).rejects.toThrow("occupied first response"); await store.close();
  });
  test("old and new entry points reject each other's on-disk protocol", async () => {
    const job = fixture().jobs[0]!;
    expect(gatewayV5JobPending(job, freeze)).toEqual({ ...gatewayJobPending(job, freeze), protocol: "oh.memory-gateway-store.v5" });
    const p = await directory(), store = await openGatewayStudyV5Store(p, freeze); await runStored(store, job); const events = store.events; await store.close();
    await expect(readGatewaySavedJob(p, freeze, job, events)).rejects.toThrow("pending request changed");
    await expect(openGatewayStudyStore(p, freeze)).rejects.toThrow("store header changed");
    const oldPath = await directory(), old = await openGatewayStudyStore(oldPath, freeze); await old.close();
    await expect(openGatewayStudyV5Store(oldPath, freeze)).rejects.toThrow("store header changed");
  });
  test("the old store still records ordinary results and rejects exact-cap length", async () => {
    const job = fixture().jobs[0]!;
    for (const finish of ["stop", "length"]) {
      const p = await directory(), store = await openGatewayStudyStore(p, freeze), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 });
      await store.begin(job);
      const running = invokeGatewayStudy({ request: job.request, oidcToken: "synthetic-project-oidc", reservationId: job.key, budget,
        record: e => store.record(job, e), capture: r => store.capture(job, r), fetcher: async () => Response.json(envelope(job, '{"units":[]}', finish)) });
      if (finish === "length") { await expect(running).rejects.toThrow("incomplete or truncated"); expect(store.events.map(e => e.kind)).toEqual(["reserved"]); }
      else { const result = await running; await store.complete(job, result); expect(await store.lookup(job)).toEqual(result); expect(store.events).toHaveLength(2); }
      await store.close();
    }
  });
});
