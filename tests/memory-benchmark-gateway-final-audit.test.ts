import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, chmod, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createGatewayV5Auditor, gatewayAuditorSourceIdentity, gatewayClosedFileSet } from "../scripts/benchmark-audit/audit-gateway-study-v5-final";
import { gatewaySupervisorJson, verifyGatewayV5Supervisor } from "../scripts/benchmark-audit/gateway-v5-audit-supervisor";
import { makeClaudeExtractionJobs, CLAUDE_STUDY_MODEL } from "../scripts/benchmarks/claude-study-plan";
import { completeClaudeExtractionOutcome } from "../scripts/benchmarks/claude-extraction-outcome";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import { CLAUDE_SUBSCRIPTION_PROFILE, type ClaudeInvocation } from "../scripts/benchmarks/claude-subscription";
import { DATASETS, type Corpus, type Question } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, EXTRACTION_SCHEMA } from "../scripts/benchmarks/units";
import * as plan from "../scripts/benchmarks/gateway-study-plan-v3";
import { gatewayJobPending, gatewayReservation } from "../scripts/benchmarks/gateway-study-store-v3";
import { parseGatewayStudyResponse, gatewayStudyLedgerExposure, type GatewayStudyLedgerEvent } from "../scripts/benchmarks/gateway-study-transport-v3";
import { gatewayV5JobPending } from "../scripts/benchmarks/gateway-study-store-v5";
import { parseGatewayStudyV5 } from "../scripts/benchmarks/gateway-study-transport-v5";
import { completeGatewayV5Extraction } from "../scripts/benchmarks/gateway-study-plan-v5";
import { GATEWAY_STUDY_IMPORT_V5_QUALIFICATION } from "../scripts/benchmarks/gateway-study-import-v5";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { GATEWAY_STUDY_IMPORT_V4_QUALIFICATION } from "../scripts/benchmarks/gateway-study-import-v4";
import { assessSuperiority } from "../scripts/benchmarks/superiority";

const runtime = await realpath(new URL("..", import.meta.url)), studyDirectory = "/synthetic/gateway-study";
const auth = { method: "project-oidc", project: "audit-fixture", scope: "fixture-owner", environment: "development" } as const;
const CARRIED = 809209;
const h = (s: string) => sha256Hex(`gateway-auditor-synthetic:${s}`), freezeSha256 = h("freeze");
const encode = (v: unknown) => Buffer.from(JSON.stringify(v) + "\n"), decode = (v: Uint8Array) => JSON.parse(new TextDecoder().decode(v)) as Record<string, unknown>;
const T = Date.parse("2026-01-01T00:00:00.000Z"), iso = (s: number) => new Date(T + s * 1000).toISOString();
let auditor: Awaited<ReturnType<typeof createGatewayV5Auditor>>, sourceSha256: string;
beforeAll(async () => { sourceSha256 = (await gatewayAuditorSourceIdentity(runtime)).sha256; auditor = await createGatewayV5Auditor(runtime, sourceSha256); });
async function fixture() {
  const corpora: Corpus[] = [0, 1].map(n => ({ id: `corpus-${n}`, groupId: `group-${n}`, turns: [0, 1, 2, 3].map(k => ({ id: `turn-${n}-${k}`,
    sessionId: `session-${n}-${k}`, date: "2026-01-01", speaker: "Casey", text: `Casey owns bicycle${n}${k}.` })) }));
  const questions: Question[] = corpora.map((c, n) => ({ id: `question-${n}`, corpusId: c.id, category: "single-session-user", question: `What bicycle does Casey own in conversation${n}?`,
    questionDate: "2026-01-02", answer: `GOLD_SENTINEL_${n}`, unanswerable: false, evidenceTurnIds: [c.turns[0]!.id], evidenceSessionIds: [c.turns[0]!.sessionId] }));
  let ordinal = 0; const legacy: ClaudeLegacyExtraction = { protocol: "oh.memory-claude-legacy.v1", provenance: { reportSha256: h("legacy"), sourceSha256: h("original"),
    selectionReportSha256: h("selection"), dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256, split: "test", seed: 17, originalStatus: "incomplete",
    extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION), reader: "openai/gpt-4.1-mini", provider: "vercel-gateway", maximumOutput: 8192 },
    schemaSha256: canonicalSha256(EXTRACTION_SCHEMA), reportedUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 } },
    parents: corpora.flatMap(c => buildExtractionChunks(c).map(chunk => { const id = ordinal++, payload = { id: chunk.id, units: [], rejected: 0 }; return { ordinal: id,
      corpusId: c.id, corpusSha256: corpusIdentity(c), chunkId: chunk.id, legacy: id === 0 ? { origin: "legacy-native", payload, payloadSha256: canonicalSha256(payload) } : null }; })),
    requiredChunks: 8, completedChunks: 1, missingChunks: 7, totalUnits: 0, qualifications: [] };
  const originalJobs = makeClaudeExtractionJobs(corpora, legacy), old = originalJobs[0]!;
  const native: ClaudeInvocation = { protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256: old.requestSha256, status: "completed", exitCode: 0, timedOut: false, outputBoundExceeded: false,
    stdout: { bytes: 1, sha256: h("old") }, stderr: { bytes: 0, sha256: sha256Hex("") }, completion: { prediction: "{", reportedModel: CLAUDE_STUDY_MODEL, sessionId: "old-session",
      numTurns: 1, durationMs: 1, usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, modelUsage: {}, listPriceEstimateUsd: .001, billedUsd: null, physicalModelAttempts: null } };
  const imported = new Map([[old.key, completeClaudeExtractionOutcome(old, native)]]), importedSummary = { synthetic: true, importedFirstResponses: 1 };
  const selection = { poolSize: 3, selected: questions.map(q => ({ questionId: q.id, corpusId: q.corpusId, groupId: corpora.find(c => c.id === q.corpusId)!.groupId })) };
  const artifacts = new Map<string, Uint8Array>(), priorArtifacts = new Map<string, Uint8Array>(), events: GatewayStudyLedgerEvent[] = [], priorEvents: GatewayStudyLedgerEvent[] = [];
  const priorFreeze = h("prior-freeze"), priorSource = h("prior-source"), priorRun = "00000000-0000-4000-8000-000000000009";
  function save(job: plan.GatewayJob, content: string, refusal = false, prior = false) {
    const family = job.request.model.slice(7), body = encode({ model: prior ? job.request.model : family, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: refusal ? null : content, refusal: refusal ? "Synthetic refusal" : null } }],
      usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 }, providerMetadata: { gateway: { cost: "0.00002", routing: prior ? { originalModelId: job.request.model, canonicalSlug: job.request.model, resolvedProvider: "openai", finalProvider: "openai", modelAttemptCount: 1, totalProviderAttemptCount: 1, modelAttempts: [{ canonicalSlug: job.request.model, success: true, providerAttemptCount: 1, providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } : { finalProvider: "openai", resolvedProviderApiModelId: `${family}-${family === "gpt-4o" ? "2024-08-06" : "2025-04-14"}` } } } });
    const reservation = gatewayReservation(job), raw = { requestSha256: job.request.requestSha256, httpStatus: 200, bodyComplete: true, receivedBytes: body.length, transportError: null, body } as const;
    const response = parseGatewayStudyResponse(job.request, reservation, raw), reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros } as const,
      settled = { v: 1, id: job.key, kind: "settled", micros: response.usage.micros } as const;
    const target = prior ? priorArtifacts : artifacts, frozen = prior ? priorFreeze : freezeSha256;
    for (const [name, value] of Object.entries({ "pending.json": prior ? gatewayJobPending(job, frozen) : gatewayV5JobPending(job, frozen), "reserved.json": reserved, "response.json": { ...raw, body: { bytes: body.length, sha256: sha256Hex(body) } },
      ...(prior ? {} : { "settled.json": settled, "result.json": { protocol: "oh.memory-gateway-store.v5", freezeSha256, jobKey: job.key, result: response } }) })) target.set(`jobs/${job.key}/${name}`, encode(value));
    target.set(`jobs/${job.key}/response.body`, body); if (prior) priorEvents.push(reserved); else events.push(reserved, settled); return response;
  }
  const allExtractionJobs = plan.makeGatewayExtractionJobs(originalJobs, imported), extractionJobs = allExtractionJobs.slice(4);
  const priorRows = allExtractionJobs.slice(0, 4).map((job, i) => { const turn = job.original.chunk.turns[0]!;
    const content = i === 0 ? JSON.stringify({ units: [{ text: turn.text, supports: [{ turnId: turn.id, quote: turn.text }] }] }) : i === 1 ? "{" : '{"units":[]}';
    return plan.completeGatewayExtraction(job, save(job, content, i === 2, true)); });
  const priorOrigins = allExtractionJobs.slice(0, 4).map((job, i) => ({ origin: "imported-rejected-gateway-v3-capture", replayProfile: "oh.gateway-study-import.v4", originalNativeStatus: "blocked", key: job.key, ordinal: job.ordinal, requestSha256: job.request.requestSha256, freezeSha256: priorFreeze, sourceSha256: priorSource, runId: priorRun, rawSha256: priorRows[i]!.response.rawSha256, rawBytes: priorRows[i]!.response.rawBytes, conservativeReservedMicros: gatewayReservation(job).micros }));
  const priorLedgerRaw = Buffer.concat(priorEvents.map(encode)), priorExposure = gatewayStudyLedgerExposure(priorEvents), priorUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 };
  for (const row of priorRows) for (const key of Object.keys(priorUsage) as Array<keyof typeof priorUsage>) priorUsage[key] += row.response.usage[key];
  const priorSummary = { schema: "oh.gateway-study-import-summary.v4", manifestSha256: h("prior-manifest"), freezeSha256: priorFreeze, sourceSha256: priorSource, importedClaudeManifestSha256: h("import"), importedTransportInvocations: 4, importedRowsSha256: canonicalSha256(priorRows), originsSha256: canonicalSha256(priorOrigins), originalGatewayStatus: "blocked", externalExposureMicros: priorExposure, ledger: { path: "/synthetic/prior/ledger.jsonl", bytes: priorLedgerRaw.length, sha256: sha256Hex(priorLedgerRaw), exposureMicros: priorExposure }, reportedUsage: priorUsage, validCount: 2, invalidEnvelopeCount: 1, invalidRefusalCount: 1, billedUsd: null, physicalModelAttempts: null, qualification: GATEWAY_STUDY_IMPORT_V4_QUALIFICATION };
  const priorContinuation = { rows: [], origins: [], summary: { importedRowsSha256: canonicalSha256([]), originsSha256: canonicalSha256([]) } };
  const priorGateway = { rows: priorRows, origins: priorOrigins, summary: priorSummary }, loaded = { corpora, questions, legacy, originalJobs, imported, importedSummary, selection, priorGateway, priorContinuation };
  const priorRead = async (p: string, max: number) => { const raw = priorArtifacts.get(p); if (!raw || raw.length > max) throw new Error("missing synthetic prior capture"); return raw; };
  const priorInput = { jobs: allExtractionJobs, prior: priorGateway, freezeSha256: priorFreeze, sourceSha256: priorSource, runId: priorRun, ledgerRaw: priorLedgerRaw, read: priorRead };
  const extraction = extractionJobs.map((job, i) => plan.completeGatewayExtraction(job, save(job, i === 0 ? '{"units":[]}' : "", i === 1)));
  const memory = plan.gatewayStudyMemory(legacy, imported, [...priorRows, ...extraction]), readerJobs = await plan.makeGatewayReaderJobs({ corpora, questions, memory });
  const readers = readerJobs.map(job => plan.completeGatewayReader(job, questions[job.native.questionIndex]!, save(job, "bicycle"))), profile = await loadJudgeProfile();
  const judgePlan = plan.makeGatewayJudgePlan({ readerJobs, readerRows: readers, questions, profile });
  const physical = judgePlan.jobs.map(job => plan.completeGatewayJudge(job, save(job, "yes"))), judgments = plan.expandGatewayJudgments(judgePlan, physical);
  const assessment = assessSuperiority(selection.poolSize, selection.selected, judgments), study = { synthetic: true }, procedure = { synthetic: true };
  const comparison = { protocol: "oh.memory-gateway-study.v5", freezeSha256, study, procedure, originalStudiesStatus: "incomplete", extraction: { imported: importedSummary, priorGateway: priorSummary, priorContinuation: priorContinuation.summary, rows: extraction },
    readers, judgments, physicalJudgeResults: physical, assessment };
  const allJobs = [...extractionJobs, ...readerJobs, ...judgePlan.jobs], orderedKeys = allJobs.map(j => j.key);
  const read = async (p: string, max: number) => { const raw = artifacts.get(p); if (!raw || raw.length > max) throw new Error("Synthetic artifact missing or oversized"); return raw; };
  const ledgerRaw = Buffer.concat(events.map(encode));
  return { priorInput, priorArtifacts, priorEvents, priorGateway, loaded, artifacts, read, events, ledgerRaw, comparison, profile, study, procedure, orderedKeys, extractionJobs, readerJobs, memory, judgePlan, allJobs,
    input: { loaded, read, ledgerRaw, comparison, profile, study, procedure, freezeSha256, jobKeys: [...orderedKeys].sort() } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function historyFixture(f: Fixture) {
  const external = new Map<string, Uint8Array>(), artifacts = new Map(f.artifacts), counts = [f.extractionJobs.length, f.orderedKeys.length - f.extractionJobs.length];
  const runs: Record<string, unknown>[] = [], receipts: Record<string, unknown>[] = []; let cumulative = 0, previousExposure = 0;
  const comparison = { path: join(studyDirectory, "comparison-00000000-0000-4000-8000-000000000002.json"), sha256: h("comparison") };
  for (const [i, calls] of counts.entries()) { const before = cumulative; cumulative += calls; const runId = `00000000-0000-4000-8000-00000000000${i + 1}`, max = i === 0 ? calls : 256, start = iso(10 + i * 20), end = iso(20 + i * 20);
    const qualified = { ...auth, issuer: `https://oidc.vercel.com/${auth.scope}`, subject: `owner:${auth.scope}:project:${auth.project}:environment:${auth.environment}`,
      audience: `https://vercel.com/${auth.scope}`, expiresAt: T / 1000 + 10000, signatureVerifiedLocally: false };
    const initialJobKeys = f.orderedKeys.slice(0, before).sort(), admittedKeys = f.orderedKeys.slice(before, cumulative), finalJobKeys = f.orderedKeys.slice(0, cumulative).sort();
    const admissionName = `batch-${runId}-started.json`, admissionRaw = encode({ protocol: "oh.memory-gateway-batch-admission.v5", runId, freezeSha256, sourceSha256, importedStudySha256: h("import"),
      start, maximumNewCalls: max, concurrency: 4, openingLedgerExposureMicros: previousExposure, priorGatewayExposureMicros: CARRIED, priorGatewayStudySha256: h("prior-manifest"), priorContinuationStudySha256: h("continuation-manifest"), initialJobKeysSha256: canonicalSha256(initialJobKeys), qualified });
    artifacts.set(admissionName, admissionRaw); const admission = { path: join(studyDirectory, admissionName), sha256: sha256Hex(admissionRaw) };
    const prefixEvents = f.events.slice(0, cumulative * 2), prefix = Buffer.concat(prefixEvents.map(encode)), exposure = gatewayStudyLedgerExposure(prefixEvents), confirmed = exposure - previousExposure;
    const b = { protocol: "oh.memory-gateway-batch.v5", runId, freezeSha256, sourceSha256, importedStudySha256: h("import"), start, end, admission, maximumNewCalls: max, concurrency: 4,
      newTransportInvocations: calls, admittedKeys, initialJobKeys, finalJobKeys, failed: false, storeClosed: true, sourceVerifiedAtClose: true, importVerifiedAtClose: true, originalLedgerVerifiedAtClose: true, priorGatewayVerifiedAtClose: true, priorContinuationVerifiedAtClose: true, priorGatewayStudySha256: h("prior-manifest"), priorContinuationStudySha256: h("continuation-manifest"),
      interrupted: false, stopReason: i === 0 ? "call-limit" : null, qualified, ledger: { path: join(studyDirectory, "ledger.jsonl"), bytes: prefix.length, sha256: sha256Hex(prefix), exposureMicros: exposure, priorGatewayExposureMicros: CARRIED, totalAmendmentExposureMicros: CARRIED + exposure,
        budget: { capUsd: 40, maxCalls: max, reservedCalls: calls, historicalExposureUsd: 21.655385, priorAmendmentExposureUsd: (CARRIED + previousExposure) / 1e6, accountedUsd: (CARRIED + exposure) / 1e6,
          confirmedThisRunUsd: confirmed / 1e6, unresolvedThisRunUsd: 0, billedUsd: null } }, comparisonArtifact: i === 0 ? null : comparison,
      result: i === 0 ? { status: "paused", phase: "reader", resolved: 0, required: 6 } : { status: "completed", phase: "judge", resolved: 6, required: 6 } };
    receipts.push(b); artifacts.set(`batch-${runId}.json`, encode(b)); previousExposure = exposure;
    const jobDir = `/synthetic/supervisor-${i}`, argv = ["/synthetic/bin/vercel", "env", "run", "--project", auth.project, "--scope", auth.scope, "--environment", auth.environment, "--",
      "/synthetic/bin/bun", join(runtime, "scripts/benchmarks/gateway-study-v5.ts"), "run", "--directory", studyDirectory, "--freeze-sha256", freezeSha256, "--max-new-calls", String(max)];
    const configRaw = Buffer.from(gatewaySupervisorJson({ argv, cwd: runtime, jobDir, requireAbsent: [join(studyDirectory, "active.lock")] }));
    const configuration = { path: join(jobDir, "config.json"), sha256: sha256Hex(configRaw) }; external.set(configuration.path, configRaw);
    const statusRaw = encode({ state: "exited", supervisorPid: 100 + i * 10, supervisorStart: "synthetic-start", bootIdentity: "synthetic-boot", commandSha256: sha256Hex(gatewaySupervisorJson(argv)),
      configSha256: configuration.sha256, startedAt: iso(9 + i * 20).replace(".000Z", "Z"), childPid: 101 + i * 10, childPgid: 101 + i * 10, childStart: "synthetic-child", exitCode: 0,
      groupGone: true, finishedAt: iso(21 + i * 20).replace(".000Z", "Z") });
    const supervisorStatus = { path: join(jobDir, "status.json"), sha256: sha256Hex(statusRaw) }; external.set(supervisorStatus.path, statusRaw);
    runs.push({ runId, admissionSha256: admission.sha256, closureSha256: sha256Hex(encode(b)), configuration, supervisorStatus, groupGone: true, runnerExitCode: 0, newTransportInvocations: calls });
  }
  const finalBatch = { path: join(studyDirectory, `batch-${String(runs[1]!.runId)}.json`), sha256: String(runs[1]!.closureSha256) };
  const closure = { schema: "oh.gateway-final-supervisor-closure.v5", createdAt: iso(100), freezeSha256, inventorySha256: h("inventory"), finalBatchSha256: finalBatch.sha256,
    verification: "owner-verified-complete-producer-inventory", allProducersClosed: true, runs };
  const read = async (p: string) => { const raw = artifacts.get(p); if (!raw) throw new Error("missing synthetic artifact"); return raw; };
  const readPin = async (p: { path: string; sha256: string }) => { const raw = external.get(p.path); if (!raw) throw new Error("missing synthetic pin"); return raw; };
  function reseal() { for (const [i, b] of receipts.entries()) { const name = `batch-${String(b.runId)}.json`, raw = encode(b); artifacts.set(name, raw); runs[i]!.closureSha256 = sha256Hex(raw); }
    finalBatch.sha256 = String(runs[1]!.closureSha256); closure.finalBatchSha256 = finalBatch.sha256; }
  return { closure, receipts, runs, external, artifacts, reseal, input: { closure, files: [...artifacts.keys()], read, readPin, studyDirectory, freezeSha256,
    freezeCreatedAt: iso(0), importedSha256: h("import"), priorGatewaySha256: h("prior-manifest"), priorContinuationSha256: h("continuation-manifest"), finalBatch, comparison, ledgerRaw: f.ledgerRaw, orderedKeys: f.orderedKeys, extractionCount: f.extractionJobs.length,
    readerCases: 6, judgeOwners: f.judgePlan.jobs.length, importedCount: 1, auth } };
}

describe("Gateway v5 independent final reconstruction", () => {
  test("reconstructs every parent, full context, first-owner judgment and ledger usage with no network", async () => {
    const f = await fixture(), oldFetch = globalThis.fetch; let network = 0;
    globalThis.fetch = Object.assign((async () => { network++; throw new Error("network forbidden"); }), oldFetch) as typeof fetch;
    try { const result = await auditor.reconstruct(f.input); expect(result.importedCount).toBe(1); expect(result.extractionCount).toBe(2);
      expect(result.readerCases).toBe(6); expect(result.judgeOwners).toBe(2); expect(result.invalidGatewayExtraction).toBe(1);
      expect(result.usage.micros).toBe(gatewayStudyLedgerExposure(f.events)); expect(result.assessment.status).toBe("completed");
      expect(result.orderedKeys).toEqual(f.orderedKeys); expect(network).toBe(0); expect(JSON.stringify(f.readerJobs.map(j => j.request))).not.toContain("GOLD_SENTINEL");
    } finally { globalThis.fetch = oldFetch; }
  });
  test("rejects a partial matrix before any saved response read", async () => { const f = await fixture(); let reads = 0;
    await expect(auditor.reconstruct({ ...f.input, comparison: { ...f.comparison, judgments: f.comparison.judgments.slice(1) }, read: async () => { reads++; throw new Error("unexpected read"); } })).rejects.toThrow("incomplete-matrix"); expect(reads).toBe(0); });
  test("rejects forged matrix identity, correctness, reader diagnostics, alias owner and assessment", async () => {
    for (const field of ["identity", "correct", "reader", "alias", "assessment"]) { const f = await fixture(), c = structuredClone(f.comparison);
      if (field === "identity") c.judgments[0]!.questionId = "other";
      if (field === "correct") c.judgments[0]!.correct = 0;
      if (field === "reader") Object.assign(c.readers[0]!, { tokenF1: 1 });
      if (field === "alias") c.judgments[1]!.ownerOrdinal = 3;
      if (field === "assessment") c.assessment.established = !c.assessment.established;
      await expect(auditor.reconstruct({ ...f.input, comparison: c })).rejects.toThrow(); }
  });
  test("rejects missing/extra jobs, changed request, response body, settled value and saved result", async () => {
    for (const file of ["pending.json", "response.body", "settled.json", "result.json"]) { const f = await fixture(), key = f.orderedKeys[0]!;
      f.artifacts.set(`jobs/${key}/${file}`, encode({ changed: true })); await expect(auditor.reconstruct(f.input)).rejects.toThrow(); }
    const f = await fixture(); for (const jobKeys of [f.orderedKeys.slice(1), [...f.orderedKeys, h("extra")]]) await expect(auditor.reconstruct({ ...f.input, jobKeys })).rejects.toThrow("complete-job-inventory");
  });
  test("whole context checking rejects text forgery even when hashes and metadata are retained", async () => { const f = await fixture(), jobs = structuredClone(f.readerJobs);
    Object.assign(jobs[0]!.native.retrieved, { context: "forged context" }); await expect(auditor.verifyContexts(f.loaded, f.memory, jobs)).rejects.toThrow("entire-reader-context"); });
  test("requires every original parent once and never admits an imported parent under a new key", async () => { const f = await fixture();
    await expect(auditor.reconstruct({ ...f.input, loaded: { ...f.loaded, originalJobs: f.loaded.originalJobs.slice(1) } })).rejects.toThrow();
    await expect(auditor.reconstruct({ ...f.input, loaded: { ...f.loaded, imported: new Map() } })).rejects.toThrow(); });
  test("rejects duplicate or unpaid ledger jobs and any historical reservation prefix above40USD", async () => { const f = await fixture();
    for (const events of [f.events.slice(1), [...f.events, f.events[0]!], [{ v: 1, kind: "reserved", id: "a", micros: 30_000_000 }, { v: 1, kind: "reserved", id: "b", micros: 30_000_000 },
      { v: 1, kind: "settled", id: "a", micros: 1 }, { v: 1, kind: "settled", id: "b", micros: 1 }]]) expect(() => auditor.parseLedger(Buffer.concat(events.map(encode)))).toThrow();
    expect(() => auditor.parseLedger(f.ledgerRaw.subarray(0, -1))).toThrow("partial-ledger-line"); });
  test("replays all four imported captures without settlements and reports usage separately from carried exposure", async () => {
    const f = await fixture(), result = await auditor.verifyPriorResponses(f.priorInput);
    expect(result.importedGatewayCount).toBe(4); expect(result.externalExposureMicros).toBe(gatewayStudyLedgerExposure(f.priorEvents));
    expect(result.reportedUsage).toEqual(f.priorGateway.summary.reportedUsage); expect(result.externalExposureMicros).toBeGreaterThan(result.reportedUsage.micros);
    expect([...f.priorArtifacts.keys()].some(p => p.endsWith("settled.json") || p.endsWith("result.json"))).toBe(false);
    expect((await auditor.reconstruct(f.input)).importedGatewayCount).toBe(4);
    expect(f.priorGateway.rows.map(r => r.status)).toEqual(["valid", "invalid-envelope", "invalid-refusal", "valid"]);
    expect(f.priorGateway.rows.every(r => r.response.identity.resolvedProviderApiModelId === null && r.response.identity.resolvedSnapshot === null)).toBe(true);
    expect(f.orderedKeys.some(key => f.priorGateway.rows.some(row => row.jobKey === key))).toBe(false);
    expect(f.priorGateway.rows[0]!.payload.units).toHaveLength(1);
    expect(f.memory.flatMap(m => m.chunks.flatMap(c => c.units)).some(u => u.id === f.priorGateway.rows[0]!.payload.units[0]!.id)).toBe(true);
  });
  test("rejects changed prior raw bytes, request, native row, origin and reported usage", async () => {
    for (const field of ["pending.json", "response.body", "response.json", "reserved.json", "row", "origin", "usage"]) {
      const f = await fixture();
      if (field === "row") f.priorInput.prior = { ...f.priorGateway, rows: [...f.priorGateway.rows].reverse() };
      else if (field === "origin") f.priorInput.prior = { ...f.priorGateway, origins: f.priorGateway.origins.map(o => ({ ...o, originalNativeStatus: "completed" })) };
      else if (field === "usage") f.priorInput.prior = { ...f.priorGateway, summary: { ...f.priorGateway.summary, reportedUsage: { ...f.priorGateway.summary.reportedUsage, micros: 0 } } };
      else f.priorArtifacts.set(`jobs/${f.priorGateway.rows[0]!.jobKey}/${field}`, encode({ changed: true }));
      await expect(auditor.verifyPriorResponses(f.priorInput)).rejects.toThrow();
    }
  });
  test("cannot settle or discount the old ledger and cannot regenerate imported ordinals", async () => {
    const f = await fixture(), event = f.priorEvents[0]!;
    await expect(auditor.verifyPriorResponses({ ...f.priorInput, ledgerRaw: Buffer.concat([f.priorInput.ledgerRaw, encode({ ...event, kind: "settled", micros: 1 })]) })).rejects.toThrow("prior-unsettled-reservations");
    const discount = { ...f.priorGateway, summary: { ...f.priorGateway.summary, externalExposureMicros: f.priorGateway.summary.reportedUsage.micros } };
    await expect(auditor.verifyPriorResponses({ ...f.priorInput, prior: discount })).rejects.toThrow("prior-summary-once");
    const rows = [...f.priorGateway.rows].reverse(), priorGateway = { ...f.priorGateway, rows,
      summary: { ...f.priorGateway.summary, importedRowsSha256: canonicalSha256(rows) } };
    await expect(auditor.reconstruct({ ...f.input, loaded: { ...f.loaded, priorGateway } })).rejects.toThrow();
    await expect(auditor.reconstruct({ ...f.input, loaded: { ...f.loaded, priorGateway: { ...f.priorGateway, rows: f.priorGateway.rows.slice(1) } } })).rejects.toThrow("four-prior-captures");
  });
  test("checks the combined cap at every prefix even when the new ledger alone stays below40USD", () => {
    const reservation = { v: 1, kind: "reserved", id: "synthetic-cap", micros: 40_000_000 - CARRIED }, settlement = { v: 1, kind: "settled", id: "synthetic-cap", micros: 1 };
    expect(() => auditor.parseLedger(Buffer.concat([reservation, settlement].map(encode)))).not.toThrow();
    expect(() => auditor.parseLedger(Buffer.concat([{ ...reservation, micros: reservation.micros + 1 }, settlement].map(encode)))).toThrow("carried-ledger-prefix-cap");
  });
});

describe("Gateway v4 complete supervisor history and ledger prefixes", () => {
  test("accepts scoped custody and authenticates an earlier prefix of the final append-only ledger", async () => { const f = await fixture(), history = await historyFixture(f);
    const result = await auditor.verifyHistory(history.input); expect(result.total).toBe(f.orderedKeys.length); expect(result.history).toHaveLength(2); expect(result.exposureMicros).toBe(gatewayStudyLedgerExposure(f.events)); });
  test("every batch binds the old manifest and the full carried reservation cost", async () => {
    for (const field of ["priorGatewayExposureMicros", "totalAmendmentExposureMicros", "budget"]) {
      const f = await fixture(), h = await historyFixture(f), ledger = h.receipts[0]!.ledger as Record<string, unknown>;
      if (field === "budget") { const budget = ledger.budget as Record<string, unknown>; budget.priorAmendmentExposureUsd = 0; budget.accountedUsd = (ledger.exposureMicros as number) / 1e6; }
      else ledger[field] = 0;
      h.reseal(); await expect(auditor.verifyHistory(h.input)).rejects.toThrow();
    }
    const h = await historyFixture(await fixture()); let replays = 0;
    await expect(auditor.verifyCustody({ ...h.input, priorGatewaySha256: "1".repeat(64) }).then(() => { replays++; })).rejects.toThrow(); expect(replays).toBe(0);
    const f = await fixture(); await expect(auditor.reconstruct({ ...f.input, jobKeys: [...f.orderedKeys, f.priorGateway.rows[0]!.jobKey] })).rejects.toThrow("complete-job-inventory");
  });
  test("rejects failed/unclosed producers, changed source, missing admission and borrowed comparison", async () => {
    for (const field of ["failed", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose", "priorGatewayVerifiedAtClose", "priorGatewayStudySha256", "comparisonArtifact", "admission"]) {
      const h = await historyFixture(await fixture()), b = h.receipts[1]!; b[field] = field === "failed" ? true : field === "comparisonArtifact" || field === "admission" ? null : false; h.reseal();
      await expect(auditor.verifyHistory(h.input)).rejects.toThrow(); }
  });
  test("rejects prefix hash/length/coverage/cost tampering, budget relabeling and ledger suffix", async () => {
    for (const field of ["sha256", "bytes", "exposureMicros", "budget"]) { const f = await fixture(), h = await historyFixture(f), l = h.receipts[0]!.ledger as Record<string, unknown>;
      l[field] = field === "sha256" ? h.input.finalBatch.sha256 : field === "bytes" ? f.ledgerRaw.length : field === "exposureMicros" ? 999 : {};
      h.reseal(); await expect(auditor.verifyHistory(h.input)).rejects.toThrow(); }
    const f = await fixture(), h = await historyFixture(f); await expect(auditor.verifyHistory({ ...h.input, ledgerRaw: Buffer.concat([f.ledgerRaw, encode({ v: 1, kind: "reserved", id: "extra", micros: 1 })]) })).rejects.toThrow("unclosed-ledger-suffix");
  });
  test("rejects admissions reordered against native plan and incomplete phase transitions", async () => {
    for (const field of ["admittedKeys", "initialJobKeys", "finalJobKeys", "result"]) { const h = await historyFixture(await fixture());
      h.receipts[1]![field] = field === "result" ? { status: "completed", phase: "judge", resolved: 5, required: 6 } : []; h.reseal(); await expect(auditor.verifyHistory(h.input)).rejects.toThrow(); }
  });
  test("rejects overlapping histories, undeclared batch files and omitted owner completion", async () => {
    const h = await historyFixture(await fixture()); h.receipts[1]!.start = iso(1); h.reseal(); await expect(auditor.verifyHistory(h.input)).rejects.toThrow();
    const other = await historyFixture(await fixture()); await expect(auditor.verifyHistory({ ...other.input, files: [...other.input.files, "batch-extra.json"] })).rejects.toThrow();
    other.closure.allProducersClosed = false; await expect(auditor.verifyHistory(other.input)).rejects.toThrow("external-owner-closure");
  });
  test("scoped Vercel supervisor rejects missing lock gate, changed provider command or active child", async () => {
    for (const field of ["lock", "command", "child"]) { const h = await historyFixture(await fixture()), r = h.runs[0]!, cfg = r.configuration as { path: string; sha256: string }, status = r.supervisorStatus as { path: string; sha256: string };
      if (field === "child") { const s = decode(h.external.get(status.path)!); s.groupGone = false; const raw = encode(s); h.external.set(status.path, raw); status.sha256 = sha256Hex(raw); }
      else { const c = decode(h.external.get(cfg.path)!); if (field === "lock") c.requireAbsent = []; else (c.argv as string[])[4] = "other-project";
        const raw = Buffer.from(gatewaySupervisorJson(c)); h.external.set(cfg.path, raw); cfg.sha256 = sha256Hex(raw); }
      await expect(auditor.verifyHistory(h.input)).rejects.toThrow(); }
  });
  test("complete producer custody is checked without reading semantic files, and failed custody prevents replay", async () => {
    const f = await fixture(), h = await historyFixture(f); let semanticReads = 0, replays = 0;
    const checked = { ...h.input, read: async (p: string) => { if (!p.startsWith("batch-")) semanticReads++; return h.input.read(p); } };
    expect(await auditor.verifyCustody(checked)).toEqual({ producers: 2, metadataOnly: true }); expect(semanticReads).toBe(0);
    const status = h.runs[1]!.supervisorStatus as { path: string; sha256: string }, value = decode(h.external.get(status.path)!);
    value.groupGone = false; const raw = encode(value); h.external.set(status.path, raw); status.sha256 = sha256Hex(raw);
    await expect(auditor.verifyCustody(checked).then(() => { replays++; return auditor.reconstruct(f.input); })).rejects.toThrow("closed status");
    expect(semanticReads).toBe(0); expect(replays).toBe(0);
  });
  test("distinct batch run IDs cannot reuse producer proof or process identity", async () => {
    const duplicate = await historyFixture(await fixture()); duplicate.runs[1]!.configuration = duplicate.runs[0]!.configuration;
    await expect(auditor.verifyCustody(duplicate.input)).rejects.toThrow("reused-producer-proof");
    const sameProcess = await historyFixture(await fixture()), second = sameProcess.runs[1]!.supervisorStatus as { path: string; sha256: string };
    const s = decode(sameProcess.external.get(second.path)!); s.supervisorPid = 100; s.childPid = 101; s.childPgid = 101;
    const raw = encode(s); sameProcess.external.set(second.path, raw); second.sha256 = sha256Hex(raw);
    await expect(auditor.verifyCustody(sameProcess.input)).rejects.toThrow("reused-producer-identity");
  });
  test("pinned authority auth must match both OIDC claims and the supervisor scope", async () => {
    const h = await historyFixture(await fixture());
    await expect(auditor.verifyCustody({ ...h.input, auth: { ...auth, project: "different-authorized-project" } })).rejects.toThrow("scoped-oidc-metadata");
    await expect(auditor.verifyCustody({ ...h.input, auth: { ...auth, scope: "different-owner" } })).rejects.toThrow("scoped-oidc-metadata");
  });
  test("valid four-call waves allow reverse settlements but reject fifth reservation, interleaving and phase mixing", () => {
    const keys = Array.from({ length: 6 }, (_, i) => h(`wave-${i}`));
    const reserve = (i: number): GatewayStudyLedgerEvent => ({ v: 1, id: keys[i]!, kind: "reserved", micros: 10 });
    const settle = (i: number): GatewayStudyLedgerEvent => ({ v: 1, id: keys[i]!, kind: "settled", micros: 1 });
    const valid = [0, 1, 2, 3].map(reserve).concat([3, 2, 1, 0].map(settle), [4, 5].map(reserve), [5, 4].map(settle));
    expect(() => auditor.verifyWaves(valid, keys, 0, 6)).not.toThrow();
    for (const bad of [[0, 1, 2, 3, 4].map(reserve).concat([4, 3, 2, 1, 0].map(settle)),
      [reserve(0), reserve(1), settle(0), reserve(2), settle(1), settle(2)]]) expect(() => auditor.verifyWaves(bad, keys, 0, 6)).toThrow("invalid-four-call-wave");
    expect(() => auditor.verifyWaves([reserve(0), reserve(1), settle(0), settle(1)], keys, 1, 5)).toThrow("invalid-four-call-wave");
  });
  test("source and closed-file loaders reject aliases, symlinks, missing six-file jobs and active locks", async () => {
    await expect(createGatewayV5Auditor(runtime, h("wrong-source"))).rejects.toThrow("runtime-before-import");
    const root = await realpath(await mkdtemp(join(tmpdir(), "gateway-audit-synthetic-"))); await chmod(root, 0o700);
    try { await mkdir(join(root, "jobs"), { mode: 0o700 }); await writeFile(join(root, "active.lock"), "x", { mode: 0o600 }); await expect(gatewayClosedFileSet(root)).rejects.toThrow("live-store-lock");
      await rm(join(root, "active.lock")); await symlink("/synthetic", join(root, "link")); await expect(gatewayClosedFileSet(root)).rejects.toThrow("special-file");
      await rm(join(root, "link")); await mkdir(join(root, "jobs", h("incomplete")), { mode: 0o700 }); await expect(gatewayClosedFileSet(root)).rejects.toThrow("complete-job-files");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

async function continuationFixture() {
  const f = await fixture(), jobs = f.extractionJobs, artifacts = new Map<string, Uint8Array>(), rows = [], origins = [], events: GatewayStudyLedgerEvent[] = [];
  const priorFreeze = h("v4-closed-freeze"), priorSource = h("v4-closed-source"), runIds = [h("v4-run-one"), h("v4-run-two")];
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 };
  for (const [index, job] of jobs.entries()) {
    const p = `jobs/${job.key}`, bodyValue = decode(f.artifacts.get(`${p}/response.body`)!);
    if (index === 0) Object.assign(bodyValue, { choices: [{ index: 0, finish_reason: "length", message: { role: "assistant", refusal: null, content: '{"units":[]}' } }],
      usage: { prompt_tokens: 20, completion_tokens: 16384, total_tokens: 16404 } });
    const body = encode(bodyValue), reservation = gatewayReservation(job), raw = { requestSha256: job.request.requestSha256, httpStatus: 200, bodyComplete: true, receivedBytes: body.length, transportError: null, body } as const;
    const response = parseGatewayStudyV5(job.request, reservation, raw), row = completeGatewayV5Extraction(job, response);
    const reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros } as const, settled = { v: 1, id: job.key, kind: "settled", micros: response.usage.micros } as const;
    events.push(reserved); if (index !== 0) events.push(settled);
    for (const [name, value] of Object.entries({ "pending.json": gatewayJobPending(job, priorFreeze), "reserved.json": reserved,
      "response.json": { ...raw, body: { bytes: body.length, sha256: sha256Hex(body) } }, ...(index === 0 ? {} : { "settled.json": settled,
        "result.json": { protocol: "oh.memory-gateway-store.v3", freezeSha256: priorFreeze, jobKey: job.key, result: response } }) })) artifacts.set(`${p}/${name}`, encode(value));
    artifacts.set(`${p}/response.body`, body); rows.push(row);
    origins.push({ origin: "imported-gateway-v4-first-response", replayProfile: "oh.gateway-study-import.v5", originalNativeStatus: index === 0 ? "blocked" : "completed",
      key: job.key, ordinal: job.ordinal, requestSha256: job.request.requestSha256, freezeSha256: priorFreeze, sourceSha256: priorSource, runId: runIds[index]!,
      rawSha256: response.rawSha256, rawBytes: response.rawBytes, conservativeReservedMicros: reservation.micros, originalSettledMicros: index === 0 ? null : response.usage.micros });
    for (const key of Object.keys(usage) as Array<keyof typeof usage>) usage[key] += response.usage[key];
  }
  const ledgerRaw = Buffer.concat(events.map(encode)), exposure = gatewayStudyLedgerExposure(events);
  const summary = { schema: "oh.gateway-study-import-summary.v5", manifestSha256: h("v4-manifest"), freezeSha256: priorFreeze, sourceSha256: priorSource,
    importedClaudeManifestSha256: h("claude-manifest"), importedPriorGatewayManifestSha256: h("prior-gateway-manifest"), importedTransportInvocations: rows.length,
    importedRowsSha256: canonicalSha256(rows), originsSha256: canonicalSha256(origins), originalGatewayStatus: "blocked", externalExposureMicros: exposure,
    ledger: { path: "/synthetic/v4/ledger.jsonl", sha256: sha256Hex(ledgerRaw), bytes: ledgerRaw.length, exposureMicros: exposure }, reportedUsage: usage,
    validCount: rows.filter(r => r.status === "valid").length, invalidEnvelopeCount: 0, invalidRefusalCount: 1, invalidTruncationCount: 1,
    billedUsd: null, physicalModelAttempts: null, qualification: GATEWAY_STUDY_IMPORT_V5_QUALIFICATION };
  const read = async (p: string, max: number) => { const raw = artifacts.get(p); if (!raw || raw.length > max) throw new Error("missing continuation fixture"); return raw; };
  return { f, artifacts, events, rows, origins, summary, input: { jobs, prior: { rows, origins, summary }, freezeSha256: priorFreeze, sourceSha256: priorSource,
    runIds, firstBatchCount: 1, truncatedKey: jobs[0]!.key, ledgerRaw, read } };
}
describe("Gateway v5 independent truncation audit", () => {
  test("replays truncated and successful siblings once and preserves the unresolved reserve", async () => {
    const f = await continuationFixture(), before = new Map(f.artifacts), result = await auditor.verifyContinuationResponses(f.input);
    expect(result.importedCount).toBe(2); expect(result.invalidTruncationCount).toBe(1);
    expect(result.externalExposureMicros).toBe(f.summary.externalExposureMicros); expect(result.externalExposureMicros).toBeGreaterThan(result.reportedUsage.micros);
    expect(f.rows[0]!.payload.units).toEqual([]); expect("prediction" in f.rows[0]!.response).toBe(false); expect(f.artifacts).toEqual(before);
  });
  test("rejects discarded siblings, changed raw bytes, partial text acceptance or invented old settlement", async () => {
    const f = await continuationFixture();
    await expect(auditor.verifyContinuationResponses({ ...f.input, prior: { ...f.input.prior, rows: f.rows.slice(1) } })).rejects.toThrow();
    const altered = structuredClone(f.input.prior); Object.assign(altered.rows[0]!.response, { prediction: "partial text" });
    await expect(auditor.verifyContinuationResponses({ ...f.input, prior: altered })).rejects.toThrow("continuation-native-rows");
    await expect(auditor.verifyContinuationResponses({ ...f.input, ledgerRaw: Buffer.concat([...f.events, { v: 1, id: f.input.truncatedKey, kind: "settled", micros: 0 }].map(encode)) })).rejects.toThrow();
    f.artifacts.set(`jobs/${f.input.truncatedKey}/response.body`, encode({ changed: true }));
    await expect(auditor.verifyContinuationResponses(f.input)).rejects.toThrow("continuation-raw-binding");
  });
  test("reconstructs a new settled truncation as zero memory across the full reader and judge matrix", async () => {
    const f = await fixture(), job = f.extractionJobs[0]!, p = `jobs/${job.key}`, bodyValue = decode(f.artifacts.get(`${p}/response.body`)!);
    Object.assign(bodyValue, { choices: [{ index: 0, finish_reason: "length", message: { role: "assistant", refusal: null, content: '{"units":[]}' } }], usage: { prompt_tokens: 20, completion_tokens: 16384, total_tokens: 16404 } });
    const body = encode(bodyValue), raw = { requestSha256: job.request.requestSha256, httpStatus: 200, bodyComplete: true, receivedBytes: body.length, transportError: null, body } as const;
    const response = parseGatewayStudyV5(job.request, gatewayReservation(job), raw), row = completeGatewayV5Extraction(job, response);
    expect(() => parseGatewayStudyResponse(job.request, gatewayReservation(job), raw)).toThrow();
    f.artifacts.set(`${p}/response.body`, body); f.artifacts.set(`${p}/response.json`, encode({ ...raw, body: { bytes: body.length, sha256: sha256Hex(body) } }));
    const settled = { v: 1, id: job.key, kind: "settled", micros: response.usage.micros } as const;
    f.artifacts.set(`${p}/settled.json`, encode(settled)); f.artifacts.set(`${p}/result.json`, encode({ protocol: "oh.memory-gateway-store.v5", freezeSha256, jobKey: job.key, result: response }));
    const events = f.events.map(e => e.id === job.key && e.kind === "settled" ? settled : e), ledgerRaw = Buffer.concat(events.map(encode));
    const comparison = { ...f.comparison, extraction: { ...f.comparison.extraction, rows: [row, ...f.comparison.extraction.rows.slice(1)] } };
    const result = await auditor.reconstruct({ ...f.input, ledgerRaw, comparison });
    expect(result.invalidTruncationCount).toBe(1); expect(result.invalidGatewayExtraction).toBe(2); expect(result.readerCases).toBe(6);
    expect(result.usage.micros).toBe(gatewayStudyLedgerExposure(events));
    if (f.comparison.assessment.status !== "completed") throw new Error("Complete fixture required");
    expect(result.assessment).toEqual(f.comparison.assessment);
  });
  test("requires the new ancestry pin and close flag before semantic replay", async () => {
    const f = await fixture(), history = await historyFixture(f);
    history.receipts[0]!.priorContinuationVerifiedAtClose = false; history.reseal();
    await expect(auditor.verifyCustody(history.input)).rejects.toThrow("batch-custody-or-time");
    history.receipts[0]!.priorContinuationVerifiedAtClose = true; history.receipts[0]!.priorContinuationStudySha256 = h("forged"); history.reseal();
    await expect(auditor.verifyCustody(history.input)).rejects.toThrow("batch-custody-or-time");
  });
});

 test("v5 final custody cannot silently accept a resumed budget or interruption stop", async () => {
  for (const change of [{ stopReason: "budget" }, { stopReason: "interrupted", interrupted: true }]) {
    const f = await fixture(), history = await historyFixture(f); Object.assign(history.receipts[0]!, change); history.reseal();
    await expect(auditor.verifyCustody(history.input)).rejects.toThrow();
    await expect(auditor.verifyHistory(history.input)).rejects.toThrow();
  }
});
