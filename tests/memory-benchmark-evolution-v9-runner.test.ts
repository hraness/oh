import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { OH_EMBEDDING_PROFILE_V1 } from "../src/semantic";
import { DATASETS, selectQuestions, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, selectEvolutionPartition, type EvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { createEvolutionFullHistorySource } from "../scripts/benchmarks/evolution-full-history";
import { renderTurn } from "../scripts/benchmarks/retrieval";
import { EVOLUTION_RELEASE_JUDGE, EVOLUTION_RELEASE_READERS, EVOLUTION_RELEASE_RUBRIC_SHA } from "../scripts/benchmarks/evolution-release";
import { validateEvolutionContextPlan, type EvolutionContextPlan } from "../scripts/benchmarks/evolution-plan";
import { parseEvolutionRunConfig } from "../scripts/benchmarks/evolution";
import { EVOLUTION_STUDY_V9_PROTOCOL, makeEvolutionStudyV9Scope, selectEvolutionStudyV9Shard, validateEvolutionStudyV9Artifacts, type EvolutionStudyV9 } from "../scripts/benchmarks/evolution-study-v9";
import { projectEvolutionRunnerInputV9 } from "../scripts/benchmarks/evolution-reader-date-policy";
import { validateEvolutionContextPlanV9Envelope } from "../scripts/benchmarks/evolution-plan-v9";
import { evolutionReaderJobsV2, validateEvolutionReaderPlanV2, type EvolutionReaderPlanV2 } from "../scripts/benchmarks/evolution-reader-plan-v2";
import { evolutionJudgeJobsV9, validateEvolutionJudgePlanV9, type EvolutionJudgePlanV9 } from "../scripts/benchmarks/evolution-judge-v9";
import { EVOLUTION_PROFILES } from "../scripts/benchmarks/evolution-model";
import { EVOLUTION_REBIND_DEVELOPMENT_PROTOCOL, EVOLUTION_REBIND_V9_PROTOCOL, EVOLUTION_RUN_V9_PROTOCOL, executeEvolutionPhaseV9, prepareEvolutionJudgesV9,
  prepareEvolutionReadersV9, prepareEvolutionV9, rebindEvolutionDevelopment, rebindEvolutionV9, reportEvolutionV9, type EvolutionV9Environment } from "../scripts/benchmarks/evolution-runner-v9";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import type { EvolutionCampaign, EvolutionPin } from "../scripts/benchmarks/evolution-budget";

const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No provider or network in V9 runner fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });
const h = canonicalSha256, bytes = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
const control = { id: "window-96k", system: "bm25-window", budget: { topK: 100, contextBytes: 96_000 } } as const;
const candidate = { id: "semantic-96k", system: "oh-semantic", budget: { topK: 100, contextBytes: 96_000 } } as const;
const variants = [control, candidate] as const, nano = EVOLUTION_RELEASE_READERS[0];
const auth = { method: "project-oidc" as const, project: "synthetic-v9", scope: "synthetic-team", environment: "development" as const };
function credential() {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url"), now = Math.floor(Date.now() / 1000);
  return { kind: "gateway-oidc" as const, auth, token: `${encode({ alg: "RS256" })}.${encode({ sub: `owner:${auth.scope}:project:${auth.project}:environment:development`,
    aud: `https://vercel.com/${auth.scope}`, iss: "https://oidc.vercel.com", exp: now + 3600, iat: now })}.synthetic` };
}
/** Twelve synthetic corpora: eight development/evaluated, four closed/unknown; two categories so the seeded selection interleaves. */
function syntheticDataset(): Dataset {
  const corpora = Array.from({ length: 12 }, (_, i) => ({ id: `c-${i}`, groupId: `g-${i}`,
    turns: [0, 1].map(n => ({ id: `t-${i}-${n}`, sessionId: `s-${i}-${n}`, sessionIndex: n, date: `2026-01-0${n + 1}`, speaker: "user", text: `Synthetic memory ${i}/${n} café.` })) }));
  return { corpora, questions: corpora.map((c, i) => ({ id: `q-${i}`, corpusId: c.id, category: i % 2 ? "multi-session" : "single-session-user",
    question: `Where is synthetic item ${i}?`, questionDate: "2026-01-09", answer: "PRIVATE_GOLD_SENTINEL", unanswerable: false,
    evidenceTurnIds: [c.turns[0]!.id], evidenceSessionIds: [c.turns[0]!.sessionId] })) };
}
/** Synthetic whole-turn contexts with the exact prepared identity the source validator recomputes (same shape as the V9 plan tests). */
function baseContexts(projected: EvolutionRunnerInput, manifestSha256: string, retrievalSourceSha256: string): EvolutionContextPlan {
  const corpora = new Map(projected.corpora.map(c => [c.id, c]));
  const cases = projected.questions.flatMap(q => variants.map(v => {
    const src = { ...corpora.get(q.corpusId)!, groupId: q.corpusId }, full = createEvolutionFullHistorySource(src), n = v.system === "oh-semantic" ? 0 : 1;
    const { preparedSha256: _old, ...identity } = full.identity;
    const preparedSha256 = h({ ...identity, semanticProfileSha256: v.system === "oh-semantic" ? h(OH_EMBEDDING_PROFILE_V1) : null });
    const context = renderTurn(src.turns[n]!), payload = { protocol: "oh.evolution-retrieval.v1" as const, preparedSha256, variantSha256: h(v), querySha256: sha256Hex(q.question),
      context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context), turnIds: [src.turns[n]!.id], sessionIds: [src.turns[n]!.sessionId],
      sources: [full.result.sources[n]!], omittedForBudget: 0, facets: [], coveredFacets: [], coverageKind: null };
    return { questionId: q.id, variantId: v.id, result: { ...payload, resultSha256: h(payload) } };
  }));
  const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256, retrievalSourceSha256, inputSha256: h(projected), variants, questions: projected.questions, cases };
  return { ...payload, planSha256: h(payload) };
}
/** Synthetic Gateway provider: every reader answer is distinct per call so every judge request is distinct; judges answer yes. */
function provider() {
  let calls = 0, readerCalls = 0, judgeCalls = 0;
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    calls++; expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions"); expect(init.method).toBe("POST"); expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body)), judge = body.messages.length === 1;
    let answer: string;
    if (judge) { judgeCalls++; expect(body.messages[0].content).toContain("PRIVATE_GOLD_SENTINEL"); answer = "yes"; }
    else { readerCalls++; expect(JSON.stringify(body)).not.toContain("PRIVATE_GOLD_SENTINEL"); answer = `PRIVATE_PREDICTION_SENTINEL ${calls}`; }
    const selected = Object.values(EVOLUTION_PROFILES).find(p => p.model === body.model)!;
    const wire = { model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      providerMetadata: { gateway: { cost: "0.0001", routing: { finalProvider: selected.provider, originalModelId: body.model, canonicalSlug: body.model } } } };
    await Promise.resolve(); return new Response(JSON.stringify(wire), { status: 200 });
  };
  return { fetcher, counts: () => ({ calls, readerCalls, judgeCalls }) };
}

test("V9 runner files: V4 development rebind, V9 rebind of a seed-ordered V1 parent, reader and judge phases keyed (request, repeat) through the store, and the report", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "oh-v9-runner-"))), dataset = syntheticDataset();
  const manifest = createEvolutionDatasetManifest(dataset, { dataset: "longmemeval-s", revision: DATASETS["longmemeval-s"].revision, sourceSha256: DATASETS["longmemeval-s"].sha256,
    groups: dataset.corpora.map((c, i) => ({ groupId: c.groupId, partition: i < 8 ? "development" : "closed", exposure: i < 8 ? "evaluated" : "unknown", evidence: "Synthetic declaration." })) });
  const pin = async (name: string, value: unknown): Promise<EvolutionPin> => {
    const raw = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : bytes(value);
    const path = join(root, name); await writeFile(path, raw, { mode: 0o600 }); return { path, sha256: sha256Hex(raw) };
  };
  const current = h("current retrieval source"), parentSource = h("parent retrieval source");
  const env: EvolutionV9Environment = { identity: async () => current, source: async config => { expect(config.datasetPin.sha256).toBe(DATASETS["longmemeval-s"].sha256); return dataset; } };
  try {
    const manifestPin = await pin("manifest.json", bytes(manifest)), datasetPin = { path: join(root, "official-never-read.json"), sha256: DATASETS["longmemeval-s"].sha256 };
    const ledger = await pin("historical.jsonl", ""), authAuthority = await pin("auth.json", { schema: "oh.gateway-v3-authority.v1", ...auth });
    const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "synthetic-v9-runner", storeDirectory: join(root, "store"),
      approval: "Offline synthetic fake-provider test only; never send this fixture token", additionalBudgetMicros: 10_000_000, maximumCalls: 1000,
      historicalExposureMicros: 0, historicalLedgers: [{ ...ledger, bytes: 0 }], authAuthority };
    const campaignPin = await pin("campaign.json", campaign);
    // V4 development configuration: a seeded development selection whose whole-turn V1 contexts were prepared under a previous source identity.
    const seeded = selectQuestions(selectEvolutionPartition(dataset, manifest, "development"), 6, 17), devProjected = projectEvolutionRunnerInputV9(seeded, "question-date");
    const parent = baseContexts(devProjected, manifestPin.sha256, parentSource), parentPin = await pin("parent-contexts.json", bytes(parent));
    const v4 = { protocol: "oh.memory.evolution-run.v4" as const, dataset: "longmemeval-s" as const, datasetPin, manifestPin, campaignPin, limit: 6, seed: 17, variants,
      readers: [nano], judge: EVOLUTION_RELEASE_JUDGE, directory: join(root, "dev"), storeDirectory: join(root, "store"), concurrency: 24 };
    expect(parseEvolutionRunConfig(v4).protocol).toBe("oh.memory.evolution-run.v4");
    const v4Pin = await pin("config-v4.json", v4), devRebound = await rebindEvolutionDevelopment(v4, v4Pin, parentPin, env);
    expect(devRebound).toMatchObject({ status: "rebound", contexts: 12, parentPlanSha256: parent.planSha256, modelCalls: 0 });
    const devPlan = validateEvolutionContextPlan(await Bun.file(devRebound.contextPath).json());
    expect(devPlan.retrievalSourceSha256).toBe(current); expect(devPlan.questions).toEqual(devProjected.questions); expect(devPlan.cases.map(c => c.result)).toEqual(parent.cases.map(c => c.result));
    expect(await Bun.file(join(root, "dev", "preparation.json")).json()).toMatchObject({ protocol: EVOLUTION_REBIND_DEVELOPMENT_PROTOCOL, parentRetrievalSourceSha256: parentSource, retrievalSourceSha256: current, modelCalls: 0 });
    await expect(rebindEvolutionDevelopment({ ...v4, directory: join(root, "dev-again") }, v4Pin, { path: devRebound.contextPath, sha256: devRebound.contextFileSha256 }, env)).rejects.toThrow("already carries");
    await expect(rebindEvolutionDevelopment({ ...v4, protocol: "oh.memory.evolution-run.v7" as any, directory: join(root, "dev-v7") }, v4Pin, parentPin, env)).rejects.toThrow("V4");
    // V9 study over the same six development questions, declaring the V1 parent as provenance.
    const study: EvolutionStudyV9 = { protocol: EVOLUTION_STUDY_V9_PROTOCOL, mode: "explicit-selection-descriptive", dataset: "longmemeval-s", datasetPin, manifestPin, campaignPin,
      retrievalSourceSha256: current, candidate, control, readers: [nano], judge: EVOLUTION_RELEASE_JUDGE, rubricSha256: EVOLUTION_RELEASE_RUBRIC_SHA, repeats: 2, judgeRepeats: 2,
      selection: devProjected.questions.map(q => q.id), maximumQuestionsPerShard: 100, shardPolicy: "packed-clusters", derivedRecordsPin: null,
      retrievalProvenance: { parentStudySha256: parent.planSha256, parentRetrievalSourceSha256: parentSource }, readerDatePolicy: "question-date",
      candidatePresentation: "retrieval-order", repeatPolicy: "predeclared-full-matrix-indexed-repeats" };
    const studyBytes = bytes(study), scope = makeEvolutionStudyV9Scope(studyBytes, bytes(manifest)), scopeBytes = bytes(scope);
    const authorization = validateEvolutionStudyV9Artifacts({ studyBytes, manifestBytes: bytes(manifest), scopeBytes });
    const studyPin = await pin("study.json", studyBytes), scopePin = await pin("scope.json", scopeBytes), directory = join(root, "v9", "shard-001");
    const shard = projectEvolutionRunnerInputV9(selectEvolutionStudyV9Shard(dataset, manifest, authorization, "shard-001"), "question-date");
    expect(scope.shards).toHaveLength(1); expect(shard.questions.map(q => q.id)).not.toEqual(devProjected.questions.map(q => q.id));
    const v9 = { protocol: EVOLUTION_RUN_V9_PROTOCOL, dataset: "longmemeval-s", datasetPin, manifestPin, campaignPin, studyPin, scopePin, shardId: "shard-001", limit: 6, variants,
      readers: [nano], judge: EVOLUTION_RELEASE_JUDGE, repeats: 2, judgeRepeats: 2, readerDatePolicy: "question-date", derivedRecordsPin: null,
      directory, storeDirectory: join(root, "store"), concurrency: 24, semanticCacheDirectory: join(root, "cache") };
    const configPin = await pin("config-v9.json", v9);
    await expect(prepareEvolutionV9(configPin, env)).rejects.toThrow("rebind");
    const rebound = await rebindEvolutionV9(configPin, parentPin, env);
    expect(rebound).toMatchObject({ status: "rebound", contexts: 12, parentPlanSha256: parent.planSha256, modelCalls: 0 });
    const contextPin = { path: rebound.contextPath, sha256: rebound.contextFileSha256 }, context = validateEvolutionContextPlanV9Envelope(await Bun.file(contextPin.path).json());
    expect(context.questions.map(q => q.id)).toEqual(shard.questions.map(q => q.id));
    const key = (c: { questionId: string; variantId: string }) => JSON.stringify([c.questionId, c.variantId]), originals = new Map(parent.cases.map(c => [key(c), c.result]));
    for (const c of context.cases) expect(c.result).toEqual(originals.get(key(c))!);
    expect(await Bun.file(join(directory, "preparation.json")).json()).toMatchObject({ protocol: EVOLUTION_REBIND_V9_PROTOCOL, parentStudySha256: parent.planSha256, parentProtocol: "oh.memory.evolution-context-plan.v1", modelCalls: 0 });
    // Reader phase: 6 questions x 2 variants x 1 reader x 2 repeats = 24 physical (request, repeat) jobs over 12 distinct requests.
    const readers = await prepareEvolutionReadersV9(configPin, contextPin, env);
    expect(readers).toMatchObject({ status: "readers-prepared", cases: 24, physicalRequests: 12, physicalJobs: 24, modelCalls: 0 });
    const readerPlanPin = { path: readers.planPath, sha256: readers.planFileSha256 }, readerPlan = validateEvolutionReaderPlanV2(await Bun.file(readerPlanPin.path).json() as EvolutionReaderPlanV2, context);
    const fake = provider(), phase = { configPin, maxUsd: 10, maxNewCalls: 1000, credential: credential(), identity: { ...env, fetcher: fake.fetcher } };
    const readerRun = await executeEvolutionPhaseV9({ ...phase, planPin: readerPlanPin, phase: "reader", output: join(directory, "reader-output.json") });
    expect(readerRun).toMatchObject({ status: "completed", cases: 24, verifiedResponses: 24, failedAttempts: 0, required: 24, admissionAttempts: 24, errors: 0 });
    expect(fake.counts()).toEqual({ calls: 24, readerCalls: 24, judgeCalls: 0 });
    const readerOutputRaw = await Bun.file(readerRun.output).bytes(), readerOutputPin = { path: readerRun.output, sha256: sha256Hex(readerOutputRaw) };
    const readerReceipt = JSON.parse(new TextDecoder().decode(readerOutputRaw));
    expect(readerReceipt).toMatchObject({ protocol: "oh.memory.evolution-phase.v2", phase: "reader", complete: true, verified: true, executionPolicy: { repeatKeyed: true } });
    expect(readerReceipt.responses).toHaveLength(24); expect(readerReceipt.responses.filter((r: { repeat: number }) => r.repeat === 1)).toHaveLength(12);
    // Judge phase: every reader answer differs, so 24 judge requests x 2 judge repeats = 48 jobs.
    const judges = await prepareEvolutionJudgesV9(configPin, readerPlanPin, readerOutputPin, env);
    expect(judges).toMatchObject({ status: "judges-prepared", cases: 48, physicalRequests: 24, physicalJobs: 48, modelCalls: 0 });
    const judgePlanPin = { path: judges.output, sha256: judges.planFileSha256 }, judgePlan = validateEvolutionJudgePlanV9(await Bun.file(judgePlanPin.path).json() as EvolutionJudgePlanV9);
    const judgeRun = await executeEvolutionPhaseV9({ ...phase, planPin: judgePlanPin, phase: "judge", output: join(directory, "judge-output.json") });
    expect(judgeRun).toMatchObject({ status: "completed", verifiedResponses: 48, required: 48, admissionAttempts: 48, errors: 0 });
    expect(fake.counts()).toEqual({ calls: 72, readerCalls: 24, judgeCalls: 48 });
    const judgeOutputPin = { path: judgeRun.output, sha256: sha256Hex(await Bun.file(judgeRun.output).bytes()) };
    const reported = await reportEvolutionV9({ configPin, readerPlanPin, judgePlanPin, readerOutputPin, judgeOutputPin, output: join(directory, "report.json"), identity: env });
    expect(reported).toMatchObject({ status: "reported", modelCalls: 0 }); expect(reported.budget).toMatchObject({ calls: 72, unresolvedMicros: 0 });
    const report = await Bun.file(reported.output).json(), encoded = JSON.stringify(report);
    expect(report.protocol).toBe("oh.memory.evolution-report.v9");
    expect(report.coverage).toMatchObject({ logicalReaderCases: 24, logicalJudgeCases: 48, physicalReaderJobs: 24, repeats: 2, judgeRepeats: 2, completeAttemptCoverage: true, completePhysicalResponses: true });
    expect(report.study.outcomes).toHaveLength(24); expect(report.study.physical).toHaveLength(72);
    for (const arm of report.arms) { expect(arm.metrics.find((m: { metric: string }) => m.metric === "judge-mean").overall.mean).toBe(1); expect(arm.repeatAgreement.unanimous).toBe(6); }
    for (const secret of ["PRIVATE_GOLD_SENTINEL", "PRIVATE_PREDICTION_SENTINEL", "Synthetic memory", "Where is synthetic"]) expect(encoded).not.toContain(secret);
    // Replay: every (request, repeat) job is a store hit, so a throwing transport and a zero call bound still complete the phase.
    const replay = await executeEvolutionPhaseV9({ ...phase, maxNewCalls: 0, identity: { ...env, fetcher: async () => { throw new Error("No second dispatch"); } },
      planPin: readerPlanPin, phase: "reader", output: join(directory, "reader-replay.json") });
    expect(replay).toMatchObject({ status: "completed", verifiedResponses: 24, admissionAttempts: 0, errors: 0 });
    const store = await openEvolutionStore({ directory: campaign.storeDirectory, campaign });
    try {
      expect(store.summary()).toMatchObject({ calls: 72, unresolvedMicros: 0 });
      for (const job of [...evolutionReaderJobsV2(readerPlan), ...evolutionJudgeJobsV9(judgePlan)]) expect(store.lookup(job.request, job.repeat).kind).toBe("hit");
      expect(store.lookup(evolutionReaderJobsV2(readerPlan)[0]!.request, 2).kind).toBe("miss");
    } finally { await store.close(); }
    // A tampered context pin and a mismatched repeat count are refused before any dispatch.
    await expect(prepareEvolutionReadersV9(configPin, { ...contextPin, sha256: h("other") }, env)).rejects.toThrow();
    await expect(prepareEvolutionReadersV9(await pin("config-v9-repeats.json", { ...v9, repeats: 3 }), contextPin, env)).rejects.toThrow("configuration");
  } finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
