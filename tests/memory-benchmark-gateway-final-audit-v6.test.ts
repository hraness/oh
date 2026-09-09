import { preNativePacket } from "./helpers/gateway-v6-pre-native";
import { beforeAll, describe, expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createGatewayV6Auditor } from "../scripts/benchmark-audit/audit-gateway-study-v6-final";
import { gatewayAuditorSourceIdentity } from "../scripts/benchmark-audit/audit-gateway-study-v5-final";
import { gatewaySupervisorJson } from "../scripts/benchmark-audit/gateway-v6-audit-supervisor";
import type { Corpus, Question } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { makeGatewayReaderJobs, type GatewayJob } from "../scripts/benchmarks/gateway-study-plan-v3";
import { completeGatewayV6Reader, makeGatewayV6JudgePlan } from "../scripts/benchmarks/gateway-study-plan-v6";
import { gatewayReservation } from "../scripts/benchmarks/gateway-study-store-v3";
import { gatewayV6JobPending } from "../scripts/benchmarks/gateway-study-store-v6";
import { gatewayStudyLedgerExposure, type GatewayStudyLedgerEvent, type GatewayStudyRaw } from "../scripts/benchmarks/gateway-study-transport-v3";
import { parseGatewayStudyV6, GATEWAY_READER_FAILURE_V6_POLICY_SHA256, type GatewayStudyV6Result } from "../scripts/benchmarks/gateway-study-transport-v6";
import type { GatewayStudyV6Freeze } from "../scripts/benchmarks/gateway-study-v6";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { buildExtractionChunks } from "../scripts/benchmarks/units";

const runtime = await realpath(new URL("..", import.meta.url));
const directory = "/synthetic/gateway-study-v6", CARRY = 18_268_639;
const hash = (value: string) => sha256Hex("synthetic-final-audit-v6:" + value), freezeSha256 = hash("freeze");
const encode = (value: unknown) => Buffer.from(JSON.stringify(value) + "\n");
const decode = (raw: Uint8Array) => JSON.parse(new TextDecoder().decode(raw)) as Record<string, any>;
const T = Date.parse("2026-01-01T00:00:00.000Z"), iso = (seconds: number) => new Date(T + seconds * 1000).toISOString();
const auth = { method: "project-oidc", project: "synthetic-audit", scope: "synthetic-owner", environment: "development" } as const;
const PARTIAL = "SYNTHETIC_PARTIAL_READER_TEXT_RAW_ONLY", GOLD = "SYNTHETIC_GOLD_JUDGE_ONLY";
let auditor: Awaited<ReturnType<typeof createGatewayV6Auditor>>, sourceSha256: string;
beforeAll(async () => {
  sourceSha256 = (await gatewayAuditorSourceIdentity(runtime)).sha256;
  auditor = await createGatewayV6Auditor(runtime, sourceSha256);
});

async function fixture(families = 2, importedCount = 2) {
  const corpora: Corpus[] = Array.from({ length: families }, (_, i) => ({ id: `audit-corpus-${i}`, groupId: `audit-group-${i}`,
    turns: [{ id: `audit-turn-${i}`, sessionId: `audit-session-${i}`, date: "2026-01-01", speaker: "Casey", text: "Casey owns a bicycle." }] }));
  const questions: Question[] = corpora.map((c, i) => ({ id: `audit-question-${i}`, corpusId: c.id, category: "single-session-user",
    question: `What does Casey own in synthetic conversation ${i}?`, questionDate: "2026-01-02", answer: GOLD,
    unanswerable: false, evidenceTurnIds: [`audit-turn-${i}`], evidenceSessionIds: [`audit-session-${i}`] }));
  const memory = corpora.map(c => ({ corpusId: c.id, corpusSha256: corpusIdentity(c),
    chunks: buildExtractionChunks(c).map(chunk => ({ id: chunk.id, units: [], rejected: 0 })) }));
  const readerJobs = await makeGatewayReaderJobs({ corpora, questions, memory }), profile = await loadJudgeProfile();
  const selected = questions.map((q, i) => ({ questionId: q.id, corpusId: q.corpusId, groupId: corpora[i]!.groupId }));
  const artifacts = new Map<string, Uint8Array>(), importedRaw = new Map<string, Uint8Array>();
  const pairs = new Map<string, readonly GatewayStudyLedgerEvent[]>();
  function save(job: GatewayJob, failure: boolean, imported: boolean): GatewayStudyV6Result {
    const body = encode({ model: job.request.model, choices: [{ index: 0, finish_reason: failure ? "length" : "stop",
      message: { role: "assistant", content: failure ? PARTIAL : job.phase === "judge" ? "yes" : "Synthetic bicycle answer", refusal: null } }],
      usage: { prompt_tokens: 20, completion_tokens: failure ? 512 : 2, total_tokens: failure ? 532 : 22 },
      providerMetadata: { gateway: { routing: { originalModelId: job.request.model, canonicalSlug: job.request.model,
        finalProvider: "openai", resolvedProvider: "openai", modelAttemptCount: 1, totalProviderAttemptCount: 1,
        modelAttempts: [{ canonicalSlug: job.request.model, success: true, providerAttemptCount: 1,
          providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } });
    const reservation = gatewayReservation(job), raw: GatewayStudyRaw = { requestSha256: job.request.requestSha256,
      httpStatus: 200, bodyComplete: true, receivedBytes: body.length, transportError: null, body };
    const response = parseGatewayStudyV6(job.request, reservation, raw);
    if (imported) { importedRaw.set(job.key, body); return response; }
    const reserved = { v: 1, kind: "reserved", id: job.key, micros: reservation.micros } as const;
    const settled = { v: 1, kind: "settled", id: job.key, micros: response.usage.micros } as const;
    pairs.set(job.key, [reserved, settled]);
    for (const [name, value] of Object.entries({ "pending.json": gatewayV6JobPending(job, freezeSha256), "reserved.json": reserved,
      "settled.json": settled, "response.json": { ...raw, body: { bytes: body.length, sha256: sha256Hex(body) } },
      "result.json": { protocol: "oh.memory-gateway-store.v6", freezeSha256, jobKey: job.key, result: response } })) {
      artifacts.set(`jobs/${job.key}/${name}`, encode(value));
    }
    artifacts.set(`jobs/${job.key}/response.body`, body);
    return response;
  }
  // Each failure precedes successful equal answers, exercising sparse physical ownership.
  const failureOrdinals = [0, importedCount + 1];
  const readerResults = readerJobs.map(job => ({ job, response: save(job, failureOrdinals.includes(job.ordinal), job.ordinal < importedCount) }));
  const readers = readerResults.map(({ job, response }) => completeGatewayV6Reader(job, questions[job.native.questionIndex]!, response));
  const judgePlan = makeGatewayV6JudgePlan({ readerJobs, readerRows: readers, questions, profile });
  for (const job of judgePlan.jobs) save(job, false, false);
  const jobs: GatewayJob[] = [...readerJobs.slice(importedCount), ...judgePlan.jobs], events: GatewayStudyLedgerEvent[] = [];
  for (const phase of ["reader", "judge"]) {
    const phaseJobs = jobs.filter(job => job.phase === phase);
    for (let i = 0; i < phaseJobs.length; i += 4) {
      const wave = phaseJobs.slice(i, i + 4);
      events.push(...wave.map(job => pairs.get(job.key)![0]!), ...wave.toReversed().map(job => pairs.get(job.key)![1]!));
    }
  }
  const ledgerRaw = Buffer.concat(events.map(encode)), orderedKeys = jobs.map(job => job.key);
  const importedReaderResults = readerResults.slice(0, importedCount), importedJobKeys = [hash("old-extraction"), ...readerJobs.slice(0, importedCount).map(job => job.key)];
  const read = async (path: string, max: number) => {
    const raw = artifacts.get(path); if (!raw || raw.length > max) throw new Error("Missing or oversized synthetic artifact"); return raw;
  };
  return { artifacts, importedRaw, readerJobs, readers, readerResults, importedCount, judgePlan, jobs, pairs, events, ledgerRaw, orderedKeys,
    input: { readerJobs, importedReaderResults, importedJobKeys, questions, selected, poolSize: families, profile,
      freezeSha256, jobKeys: [...orderedKeys].sort(), ledgerRaw, read } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Replay = Awaited<ReturnType<Awaited<ReturnType<typeof createGatewayV6Auditor>>["reconstruct"]>>;

function historyFixture(f: Fixture, replay: Replay, recovery = false) {
  const artifacts = new Map(f.artifacts), external = new Map<string, Uint8Array>(), runs: Record<string, any>[] = [], batches: Record<string, any>[] = [];
  const counts = [32, 116], syntheticPin = (name: string) => ({ path: `/synthetic/${name}.json`, sha256: hash(name) });
  const freeze: GatewayStudyV6Freeze = { protocol: "oh.memory-gateway-freeze.v6", createdAt: iso(0), sourceSha256, sourceGitHead: "a".repeat(40),
    importedStudy: syntheticPin("import"), authority: syntheticPin("authority"), originalLedger: { ...syntheticPin("original-ledger"), bytes: 1, exposureMicros: 1 },
    inputs: { selection: syntheticPin("selection"), legacy: syntheticPin("legacy"), exclusions: [syntheticPin("exclusion")], originalSourceSha256: hash("original-source") },
    policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256, priorAmendmentExposureMicros: CARRY, procedure: { synthetic: true },
    study: { importedJobKeysSha256: canonicalSha256([...f.input.importedJobKeys].sort()) } };
  const freezeSha256 = recovery ? sha256Hex(JSON.stringify(freeze)) : hash("freeze"), shift = recovery ? 40 : 0;
  const comparison = { path: join(directory, "comparison-00000000-0000-4000-8000-000000000002.json"), sha256: hash("comparison") };
  let frontier = 0, priorExposure = 0;
  for (const [i, calls] of counts.entries()) {
    const before = frontier; frontier += calls;
    const runId = `00000000-0000-4000-8000-00000000000${i + 1}`, maximum = i === 0 ? 32 : 256, start = iso(10 + i * 20 + shift), end = iso(20 + i * 20 + shift);
    const initialJobKeys = f.orderedKeys.slice(0, before).sort(), admittedKeys = f.orderedKeys.slice(before, frontier), finalJobKeys = f.orderedKeys.slice(0, frontier).sort();
    const qualified = { ...auth, issuer: `https://oidc.vercel.com/${auth.scope}`, subject: `owner:${auth.scope}:project:${auth.project}:environment:${auth.environment}`,
      audience: `https://vercel.com/${auth.scope}`, expiresAt: T / 1000 + 10000, signatureVerifiedLocally: false };
    const admissionName = `batch-${runId}-started.json`, admissionValue = { protocol: "oh.memory-gateway-batch-admission.v6", runId, freezeSha256, sourceSha256,
      sourceGitHead: freeze.sourceGitHead, importedStudySha256: freeze.importedStudy.sha256, policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256,
      priorAmendmentExposureMicros: CARRY, importedJobKeysSha256: freeze.study.importedJobKeysSha256, start, maximumNewCalls: maximum, concurrency: 4,
      openingLedgerExposureMicros: priorExposure, initialJobKeysSha256: canonicalSha256(initialJobKeys), qualified };
    const admissionRaw = encode(admissionValue), admission = { path: join(directory, admissionName), sha256: sha256Hex(admissionRaw) };
    artifacts.set(admissionName, admissionRaw);
    const prefixEvents = f.events.slice(0, frontier * 2), prefix = Buffer.concat(prefixEvents.map(encode)), exposure = gatewayStudyLedgerExposure(prefixEvents);
    const b = { protocol: "oh.memory-gateway-batch.v6", runId, freezeSha256, sourceSha256, sourceGitHead: freeze.sourceGitHead,
      importedStudySha256: freeze.importedStudy.sha256, policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256, priorAmendmentExposureMicros: CARRY,
      importedJobKeysSha256: freeze.study.importedJobKeysSha256, start, end, admission, maximumNewCalls: maximum, concurrency: 4,
      newTransportInvocations: calls, admittedKeys, initialJobKeys, finalJobKeys, failed: false, interrupted: false, stopReason: i === 0 ? "call-limit" : null,
      storeClosed: true, sourceVerifiedAtClose: true, importVerifiedAtClose: true, originalLedgerVerifiedAtClose: true, qualified,
      ledger: { path: join(directory, "ledger.jsonl"), bytes: prefix.length, sha256: sha256Hex(prefix), exposureMicros: exposure,
        priorAmendmentExposureMicros: CARRY, totalAmendmentExposureMicros: CARRY + exposure,
        budget: { capUsd: 40, maxCalls: maximum, reservedCalls: calls, historicalExposureUsd: 21.655385,
          priorAmendmentExposureUsd: (CARRY + priorExposure) / 1e6, accountedUsd: (CARRY + exposure) / 1e6,
          confirmedThisRunUsd: (exposure - priorExposure) / 1e6, unresolvedThisRunUsd: 0, billedUsd: null } },
      comparisonArtifact: i === 0 ? null : comparison,
      result: i === 0 ? { status: "paused", phase: "judge", resolved: 4, required: 120 }
        : { status: "completed", phase: "judge", resolved: 360, required: 360, modelJudgedCases: replay.assessment.coverage.modelJudgedCases,
          policyScoredReaderFailures: replay.assessment.coverage.policyScoredReaderFailures, physicalJudgeRequests: replay.judgeOwners } };
    batches.push(b); artifacts.set(`batch-${runId}.json`, encode(b)); priorExposure = exposure;
    const jobDir = recovery ? `/synthetic/gateway-study-v6-batch-${String(i + 2).padStart(3, "0")}` : `/synthetic/v6-supervisor-${i}`, argv = ["/synthetic/bin/vercel", "env", "run", "--project", auth.project, "--scope", auth.scope,
      "--environment", "development", "--", "/synthetic/bin/bun", join(runtime, "scripts/benchmarks/gateway-study-v6.ts"), "run",
      "--directory", directory, "--freeze-sha256", freezeSha256, "--max-new-calls", String(maximum)];
    const configRaw = Buffer.from(gatewaySupervisorJson({ argv, cwd: runtime, jobDir, requireAbsent: [join(directory, "active.lock")] }));
    const configuration = { path: join(jobDir, "config.json"), sha256: sha256Hex(configRaw) }; external.set(configuration.path, configRaw);
    const statusRaw = encode({ state: "exited", supervisorPid: 100 + i * 10, supervisorStart: "synthetic-supervisor-start", bootIdentity: "synthetic-boot",
      commandSha256: sha256Hex(gatewaySupervisorJson(argv)), configSha256: configuration.sha256,
      startedAt: iso(9 + i * 20 + shift).replace(".000Z", "Z"), childPid: 101 + i * 10, childPgid: 101 + i * 10, childStart: "synthetic-child-start",
      exitCode: 0, groupGone: true, finishedAt: iso(21 + i * 20 + shift).replace(".000Z", "Z") });
    const supervisorStatus = { path: join(jobDir, "status.json"), sha256: sha256Hex(statusRaw) }; external.set(supervisorStatus.path, statusRaw);
    runs.push({ runId, admissionSha256: admission.sha256, closureSha256: sha256Hex(encode(b)), configuration, supervisorStatus,
      groupGone: true, runnerExitCode: 0, newTransportInvocations: calls });
  }
  const finalBatch = { path: join(directory, `batch-${runs[1]!.runId}.json`), sha256: runs[1]!.closureSha256 as string };
  const closure: Record<string, any> = { schema: recovery ? "oh.gateway-final-supervisor-closure.v6.1" : "oh.gateway-final-supervisor-closure.v6", createdAt: iso(100), freezeSha256, inventorySha256: hash("inventory"), finalBatchSha256: finalBatch.sha256,
    verification: "owner-verified-complete-producer-inventory", allProducersClosed: true, runs };
  if (recovery) {
    const failed = preNativePacket(runtime, "/synthetic", freeze, { studyDirectory: directory, auth });
    closure.preNativeFailures = [failed.input.acceptance];
    for (const [path, raw] of failed.external) external.set(path, raw);
    for (const [path, raw] of failed.study) artifacts.set(path, raw);
  }
  const read = async (path: string, max: number) => { const raw = artifacts.get(path); if (!raw || raw.length > max) throw new Error("Missing synthetic history artifact"); return raw; };
  const readPin = async (p: { path: string; sha256: string }, max: number) => { const raw = external.get(p.path); if (!raw || raw.length > max) throw new Error("Missing synthetic supervisor pin"); return raw; };
  function reseal() {
    for (const [i, b] of batches.entries()) { const raw = encode(b); artifacts.set(`batch-${b.runId}.json`, raw); runs[i]!.closureSha256 = sha256Hex(raw); }
    finalBatch.sha256 = runs[1]!.closureSha256; closure.finalBatchSha256 = finalBatch.sha256;
  }
  return { batches, runs, artifacts, external, closure, reseal,
    input: { closure, files: [...artifacts.keys()], read, readPin, studyDirectory: directory, freezeSha256, freeze, finalBatch, comparison, auth } };
}

describe("Gateway v6 independent final replay", () => {
  test("retains imported and new terminal zero scores, with raw-only partial text and sparse first-owner judges", async () => {
    const f = await fixture(), result = await auditor.reconstruct(f.input);
    expect(result.remainingReaderCount).toBe(4); expect(result.judgeOwners).toBe(2);
    expect(result.jobs.filter(j => j.phase === "judge").map(j => j.ordinal)).toEqual([1, 4]);
    expect(result.scoredCases.filter(c => c.kind === "reader-failure").map(c => ({ ordinal: c.ordinal, status: c.status, correct: c.correct })))
      .toEqual([0, 3].map(ordinal => ({ ordinal, status: "terminal-reader-failure", correct: 0 })));
    expect(result.scoredCases[2]).toMatchObject({ ordinal: 2, ownerOrdinal: 1, reusedJudgment: true, decisionSource: "model" });
    for (const ordinal of [0, 3]) {
      expect(result.scoredCases[ordinal]).not.toHaveProperty("jobKey"); expect(result.scoredCases[ordinal]).not.toHaveProperty("ownerOrdinal");
      expect(result.readers[ordinal]).not.toHaveProperty("prediction"); expect(result.readers[ordinal]).not.toHaveProperty("tokenF1");
    }
    expect(JSON.stringify({ readers: result.readers, cases: result.scoredCases, assessment: result.assessment })).not.toContain(PARTIAL);
    expect(new TextDecoder().decode(f.importedRaw.get(f.readerJobs[0]!.key)!)).toContain(PARTIAL);
    expect(new TextDecoder().decode(f.artifacts.get(`jobs/${f.readerJobs[3]!.key}/response.body`)!)).toContain(PARTIAL);
    expect(JSON.stringify(f.readerJobs.map(j => j.request))).not.toContain(GOLD);
    expect(result.assessment.policySha256).toBe(GATEWAY_READER_FAILURE_V6_POLICY_SHA256);
    expect(result.newLedgerExposureMicros).toBe(gatewayStudyLedgerExposure(f.events));
    expect(result.orderedKeys.some(key => f.input.importedJobKeys.includes(key))).toBe(false);
  });
  test("replays ordinary new readers and new terminal failures against all six durable artifacts", async () => {
    const f = await fixture();
    for (const ordinal of [2, 3]) {
      const job = f.readerJobs[ordinal]!;
      expect(await auditor.readResponse(f.input.read, freezeSha256, job, f.events)).toEqual(f.readerResults[ordinal]!.response);
    }
    const key = f.readerJobs[3]!.key, path = `jobs/${key}/result.json`, saved = decode(f.artifacts.get(path)!);
    saved.result.prediction = PARTIAL; f.artifacts.set(path, encode(saved));
    await expect(auditor.readResponse(f.input.read, freezeSha256, f.readerJobs[3]!, f.events)).rejects.toThrow("saved-result-binding");
  });
  test("rejects resubmitted imported keys and a truncated imported prefix before saved response reads", async () => {
    const f = await fixture(); let reads = 0;
    const read = async () => { reads++; throw new Error("Unexpected synthetic read"); };
    await expect(auditor.reconstruct({ ...f.input, jobKeys: [...f.input.jobKeys, f.readerJobs[0]!.key].sort(), read })).rejects.toThrow("import-new-partition");
    await expect(auditor.reconstruct({ ...f.input, importedReaderResults: f.input.importedReaderResults.slice(0, 1), read })).rejects.toThrow("attempted-reader-resubmitted");
    await expect(auditor.reconstruct({ ...f.input, importedReaderResults: [...f.input.importedReaderResults].reverse(), read })).rejects.toThrow("imported-reader-prefix");
    expect(reads).toBe(0);
  });
  test("rejects omitted outcomes, invented physical judges and imported policy projection drift", async () => {
    const f = await fixture();
    for (const jobKeys of [f.input.jobKeys.slice(1), [...f.input.jobKeys, hash("invented-judge")].sort()]) {
      await expect(auditor.reconstruct({ ...f.input, jobKeys })).rejects.toThrow("exact-new-job-set");
    }
    const forged = structuredClone(f.input.importedReaderResults); Object.assign(forged[0]!.response, { policySha256: hash("wrong-policy") });
    await expect(auditor.reconstruct({ ...f.input, importedReaderResults: forged })).rejects.toThrow("evidence binding");
    const missing = f.readerJobs[2]!; f.artifacts.delete(`jobs/${missing.key}/response.body`);
    await expect(auditor.reconstruct(f.input)).rejects.toThrow("Missing or oversized");
  });
  test("rejects pending request, raw body, metadata, saved projection and settlement drift", async () => {
    for (const file of ["pending.json", "response.body", "response.json", "result.json", "reserved.json", "settled.json"]) {
      const f = await fixture(), job = f.readerJobs[2]!;
      f.artifacts.set(`jobs/${job.key}/${file}`, encode({ changed: true }));
      await expect(auditor.readResponse(f.input.read, freezeSha256, job, f.events)).rejects.toThrow();
    }
  });
  test("unsettled new responses cannot be carried forward as a completed v6 audit", async () => {
    const f = await fixture(), incomplete = f.events.filter(e => !(e.kind === "settled" && e.id === f.readerJobs[3]!.key));
    await expect(auditor.reconstruct({ ...f.input, ledgerRaw: Buffer.concat(incomplete.map(encode)) })).rejects.toThrow("job-ledger-binding");
    const without = new Map(f.artifacts); without.delete(`jobs/${f.readerJobs[3]!.key}/settled.json`);
    await expect(auditor.reconstruct({ ...f.input, read: async path => { const raw = without.get(path); if (!raw) throw new Error("Unsettled synthetic failure"); return raw; } })).rejects.toThrow("Unsettled synthetic failure");
  });
  test("ledger parsing preserves carry at every reservation prefix and rejects malformed histories", () => {
    const reservation = { v: 1, id: hash("cap"), kind: "reserved", micros: 40_000_000 - CARRY }, settled = { ...reservation, kind: "settled", micros: 1 };
    expect(auditor.parseLedger(Buffer.concat([reservation, settled].map(encode)))).toHaveLength(2);
    expect(() => auditor.parseLedger(Buffer.concat([{ ...reservation, micros: reservation.micros + 1 }, settled].map(encode)))).toThrow("carried-ledger-prefix-cap");
    for (const events of [[settled], [reservation, reservation], [reservation, { ...settled, micros: reservation.micros + 1 }]]) {
      expect(() => auditor.parseLedger(Buffer.concat(events.map(encode)))).toThrow();
    }
    expect(() => auditor.parseLedger(encode(reservation).subarray(0, -1))).toThrow("partial-ledger-line");
  });
  test("wave validation rejects early refill, mixed phases, a fifth reservation and unfinished work", async () => {
    const f = await fixture(), reader = f.jobs.filter(j => j.phase === "reader"), judges = f.jobs.filter(j => j.phase === "judge");
    const reserved = (j: GatewayJob) => f.pairs.get(j.key)![0]!, settled = (j: GatewayJob) => f.pairs.get(j.key)![1]!;
    expect(() => auditor.verifyWaves(f.events, f.jobs)).not.toThrow();
    for (const events of [[reserved(reader[0]!), reserved(reader[1]!), settled(reader[0]!), reserved(reader[2]!)],
      [reserved(reader[0]!), reserved(judges[0]!)], [...reader.map(reserved), reserved(judges[0]!)], [reserved(reader[0]!)], [settled(reader[0]!)]]) {
      expect(() => auditor.verifyWaves(events, f.jobs)).toThrow();
    }
    const fifth = { ...reader[0]!, key: hash("fifth-reader") };
    expect(() => auditor.verifyWaves([...reader.map(reserved), { ...reserved(reader[0]!), id: fifth.key }], [...f.jobs, fifth])).toThrow("invalid-four-call-wave");
  });
  test("fully settled waves cannot be reordered around the native reader-to-judge transition", async () => {
    const f = await fixture(), readerKeys = new Set(f.readerJobs.map(j => j.key));
    const reordered = [...f.events.filter(e => !readerKeys.has(e.id)), ...f.events.filter(e => readerKeys.has(e.id))];
    expect(() => auditor.verifyWaves(reordered, f.jobs)).not.toThrow();
    await expect(auditor.reconstruct({ ...f.input, ledgerRaw: Buffer.concat(reordered.map(encode)) })).rejects.toThrow("new-request-order");
  });
});

describe("Gateway v6 final custody and native history", () => {
  let full: Fixture, replay: Replay;
  beforeAll(async () => { full = await fixture(120, 332); replay = await auditor.reconstruct(full.input); });
  test("accepts all360cases with332imported readers,28new readers,120sparse judges and two closed batches", async () => {
    const h = historyFixture(full, replay), custody = await auditor.verifyCustody(h.input);
    expect(custody.history).toHaveLength(2); expect(replay.scoredCases).toHaveLength(360);
    expect(replay.remainingReaderCount).toBe(28); expect(replay.judgeOwners).toBe(120); expect(replay.jobs).toHaveLength(148);
    expect(replay.jobs.filter(j => j.phase === "judge").slice(0, 3).map(j => j.ordinal)).toEqual([1, 3, 6]);
    expect(() => auditor.verifyHistory(custody, replay, full.ledgerRaw, directory)).not.toThrow();
  });
  test("custody inspects only native batch/admission and external supervisor metadata before replay", async () => {
    const h = historyFixture(full, replay), reads: string[] = [];
    await auditor.verifyCustody({ ...h.input, read: async (path, max) => { reads.push(path); return h.input.read(path, max); } });
    expect(reads).toHaveLength(4); expect(reads.every(path => path.startsWith("batch-"))).toBe(true);
    h.closure.allProducersClosed = false; let invoked = 0;
    await expect(auditor.verifyCustody({ ...h.input, read: async () => { invoked++; throw new Error("Should not inspect responses"); } })).rejects.toThrow("external-owner-closure");
    expect(invoked).toBe(0);
  });
  test("failed producer, wrong policy/source/carry or incomplete admission cannot pass custody", async () => {
    for (const field of ["failed", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose", "sourceGitHead", "policySha256", "priorAmendmentExposureMicros", "importedJobKeysSha256"]) {
      const h = historyFixture(full, replay); h.batches[1]![field] = field === "failed" ? true : field.endsWith("Sha256") ? hash("drift") : field === "sourceGitHead" ? "b".repeat(40) : field === "priorAmendmentExposureMicros" ? 0 : false;
      h.reseal(); await expect(auditor.verifyCustody(h.input)).rejects.toThrow();
    }
    const h = historyFixture(full, replay); h.artifacts.delete(`batch-${h.runs[0]!.runId}-started.json`);
    await expect(auditor.verifyCustody(h.input)).rejects.toThrow("Missing synthetic history artifact");
  });
  test("undeclared producers, overlapping lifetimes, mutable pins and live child status are rejected", async () => {
    const h = historyFixture(full, replay);
    await expect(auditor.verifyCustody({ ...h.input, files: [...h.input.files, "batch-unlisted.json"] })).rejects.toThrow("complete-batch-file-set");
    h.batches[1]!.start = iso(1); h.reseal(); await expect(auditor.verifyCustody(h.input)).rejects.toThrow();
    for (const change of ["live", "unscoped", "no-lock", "mutated-pin"]) {
      const h = historyFixture(full, replay), run = h.runs[0]!, pin = change === "live" ? run.supervisorStatus : run.configuration;
      const value = decode(h.external.get(pin.path)!);
      if (change === "live") value.groupGone = false;
      if (change === "unscoped") value.argv[4] = "another-project";
      if (change === "no-lock") value.requireAbsent = [];
      const raw = change === "live" ? encode(value) : Buffer.from(gatewaySupervisorJson(value));
      h.external.set(pin.path, change === "mutated-pin" ? encode({ changed: true }) : raw);
      if (change !== "mutated-pin") pin.sha256 = sha256Hex(raw);
      await expect(auditor.verifyCustody(h.input)).rejects.toThrow();
    }
  });
  test("history rejects discounted carry, prefix edits, wrong phase counts and reopened admissions", async () => {
    for (const field of ["carry", "opening", "budget", "bytes", "hash", "phase", "counts", "admitted", "initial", "final"]) {
      const h = historyFixture(full, replay), b = h.batches[0]!;
      if (field === "carry") b.ledger.priorAmendmentExposureMicros = 0;
      if (field === "opening") {
        const name = `batch-${b.runId}-started.json`, a = decode(h.artifacts.get(name)!); a.openingLedgerExposureMicros = 1;
        const raw = encode(a); h.artifacts.set(name, raw); b.admission.sha256 = sha256Hex(raw); h.runs[0]!.admissionSha256 = b.admission.sha256;
      }
      if (field === "budget") b.ledger.budget.priorAmendmentExposureUsd = 0;
      if (field === "bytes") b.ledger.bytes = full.ledgerRaw.length;
      if (field === "hash") b.ledger.sha256 = hash("wrong-prefix");
      if (field === "phase") b.result.phase = "reader";
      if (field === "counts") b.result.resolved = 32;
      if (field === "admitted") b.admittedKeys = [...b.admittedKeys].reverse();
      if (field === "initial") {
        b.initialJobKeys = [full.input.importedJobKeys[0]];
        const name = `batch-${b.runId}-started.json`, a = decode(h.artifacts.get(name)!); a.initialJobKeysSha256 = canonicalSha256(b.initialJobKeys);
        const raw = encode(a); h.artifacts.set(name, raw); b.admission.sha256 = sha256Hex(raw); h.runs[0]!.admissionSha256 = b.admission.sha256;
      }
      if (field === "final") b.finalJobKeys.pop();
      h.reseal(); const custody = await auditor.verifyCustody(h.input);
      expect(() => auditor.verifyHistory(custody, replay, full.ledgerRaw, directory)).toThrow();
    }
  });
  test("history rejects ledger suffixes and completed-case counts borrowed from physical judges", async () => {
    const h = historyFixture(full, replay), custody = await auditor.verifyCustody(h.input);
    const suffix = Buffer.concat([full.ledgerRaw, encode({ v: 1, id: hash("unclosed-extra"), kind: "reserved", micros: 1 })]);
    expect(() => auditor.verifyHistory(custody, replay, suffix, directory)).toThrow("unclosed-ledger-suffix");
    h.batches[1]!.result.resolved = 120; h.reseal(); const wrongCount = await auditor.verifyCustody(h.input);
    expect(() => auditor.verifyHistory(wrongCount, replay, full.ledgerRaw, directory)).toThrow("phase-frontier");
  });
});


describe("Gateway v6 recovered physical/native history", () => {
  test("one historical failed launcher followed by two successful native batches preserves all360 cases", async () => {
    const full = await fixture(120, 332), replay = await auditor.reconstruct(full.input), h = historyFixture(full, replay, true);
    const custody = await auditor.verifyCustody(h.input);
    expect(custody.preNativeFailures).toHaveLength(1); expect(custody.history).toHaveLength(2);
    expect(custody.history[0]!.configuration.path).toContain("batch-002/");
    expect(() => auditor.verifyHistory(custody, replay, full.ledgerRaw, directory)).not.toThrow();
  });
  test("missing or duplicate failure, shifted physical names, and native failure remain ineligible", async () => {
    const full = await fixture(120, 332), replay = await auditor.reconstruct(full.input);
    for (const mode of ["missing", "duplicate", "physical", "failed", "before-acceptance", "old-schema-extra"]) {
      const h = historyFixture(full, replay, true);
      if (mode === "missing") h.closure.preNativeFailures = [];
      if (mode === "duplicate") h.closure.preNativeFailures.push(h.closure.preNativeFailures[0]);
      if (mode === "physical") h.runs[0]!.configuration.path = "/synthetic/gateway-study-v6-batch-003/config.json";
      if (mode === "failed") h.batches[0]!.failed = true;
      if (mode === "before-acceptance") h.batches[0]!.start = iso(29);
      if (mode === "old-schema-extra") h.closure.schema = "oh.gateway-final-supervisor-closure.v6";
      h.reseal(); await expect(auditor.verifyCustody(h.input)).rejects.toThrow();
    }
  });
});
