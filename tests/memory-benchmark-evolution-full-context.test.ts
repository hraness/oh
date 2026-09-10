import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { EVOLUTION_FULL_HISTORY_POLICY } from "../scripts/benchmarks/evolution-full-history";
import { EVOLUTION_RELEASE_READER, EVOLUTION_RELEASE_JUDGE, EVOLUTION_RELEASE_RUBRIC_SHA, makeEvolutionReleaseScope,
  validateEvolutionReleaseArtifacts, selectEvolutionReleaseShard, parseEvolutionReleaseStudy, type EvolutionReleaseStudy } from "../scripts/benchmarks/evolution-release";
import { makeEvolutionReaderPlan, validateEvolutionAnyContextPlan, validateEvolutionContextPlanSources } from "../scripts/benchmarks/evolution-plan";
import { makeEvolutionContextPlanV3 } from "../scripts/benchmarks/evolution-plan-v3";
import { loadEvolutionFullContextAuthorization, parseEvolutionRunConfig, validateEvolutionContextRunVersion, retrievalIdentity, type EvolutionFullContextRunConfig } from "../scripts/benchmarks/evolution";
import { EVOLUTION_FULL_CONTEXT_VARIANTS, validateEvolutionFullContextArtifacts, parseEvolutionFullContextStudy, type EvolutionFullContextStudy } from "../scripts/benchmarks/evolution-full-context-study";
import { makeEvolutionFullContextPlan, assertEvolutionFullContextBinding } from "../scripts/benchmarks/evolution-full-context-plan";
import { makeEvolutionJudgePlan } from "../scripts/benchmarks/evolution-judge";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { parseEvolutionResponse, EVOLUTION_MODEL_V2_PROTOCOL, type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import type { EvolutionAttemptFailure } from "../scripts/benchmarks/evolution-store";
import { buildEvolutionReport, buildEvolutionFullContextShardReport } from "../scripts/benchmarks/evolution-report";
import { checkEvolutionFullContextStudy, combineEvolutionFullContext, parseEvolutionFullContextArgs } from "../scripts/benchmarks/evolution-full-context-cli";
const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No network or provider in companion fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });
const bytes = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
const h = canonicalSha256;
const variants = [{ id: "window-96k", system: "bm25-window", budget: { topK: 100, contextBytes: 96_000 } },
  { id: "semantic-96k", system: "oh-semantic", budget: { topK: 100, contextBytes: 96_000 } }] as const;
function parentFixture(root = "/example/full-release") {
  const sourceDataset = { corpora: Array.from({ length: 500 }, (_, i) => ({ id: `c-${i}`, groupId: `g-${i}`,
    turns: [0, 1].map(n => ({ id: `t-${i}-${n}`, sessionId: `s-${i}-${n}`, sessionIndex: n, date: "2026-01-01", speaker: "user", text: `Synthetic memory ${i}/${n} café.` })) })), questions: [] };
  const dataset: Dataset = { corpora: sourceDataset.corpora, questions: sourceDataset.corpora.map((c, i) => ({ id: `q-${i}`, corpusId: c.id, category: i % 2 ? "multi-session" : "single-session-user",
    question: `Where is synthetic item ${i}?`, questionDate: "2026-01-02", answer: "PRIVATE_GOLD_SENTINEL", unanswerable: false,
    evidenceTurnIds: [c.turns[0]!.id], evidenceSessionIds: [c.turns[0]!.sessionId] })) };
  const manifest = createEvolutionDatasetManifest(dataset, { dataset: "longmemeval-s", revision: DATASETS["longmemeval-s"].revision,
    sourceSha256: DATASETS["longmemeval-s"].sha256, groups: dataset.corpora.map((c, i) => ({ groupId: c.groupId,
      partition: i < 100 ? "development" : "closed", exposure: i < 100 ? "evaluated" : "unknown", evidence: "Synthetic declaration." })) });
  const manifestBytes = bytes(manifest), pin = (name: string, sha256: string) => ({ path: join(root, name + ".json"), sha256 });
  const study: EvolutionReleaseStudy = { protocol: "oh.memory.evolution-release-study.v1", mode: "full-release-descriptive", dataset: "longmemeval-s",
    datasetPin: pin("official", DATASETS["longmemeval-s"].sha256), manifestPin: pin("manifest", sha256Hex(manifestBytes)), campaignPin: pin("campaign", h("campaign")),
    retrievalSourceSha256: h("retrieval source"), variants, reader: EVOLUTION_RELEASE_READER, judge: EVOLUTION_RELEASE_JUDGE,
    rubricSha256: EVOLUTION_RELEASE_RUBRIC_SHA, candidatePresentation: "retrieval-order", repeatPolicy: "predeclared-full-matrix-first-attempt" };
  const studyBytes = bytes(study), scope = makeEvolutionReleaseScope(studyBytes, manifestBytes), scopeBytes = bytes(scope);
  const authorization = validateEvolutionReleaseArtifacts({ studyBytes, manifestBytes, scopeBytes });
  const config = { protocol: "oh.memory.evolution-run.v7", dataset: study.dataset, datasetPin: study.datasetPin, manifestPin: study.manifestPin,
    campaignPin: study.campaignPin, studyPin: pin("study", sha256Hex(studyBytes)), scopePin: pin("scope", sha256Hex(scopeBytes)), shardId: "shard-001",
    variants, readers: [study.reader], judge: study.judge, limit: 100, seed: 17, concurrency: 24,
    directory: join(root, "output"), storeDirectory: join(root, "store"), semanticCacheDirectory: join(root, "qmd-cache") };
  return { dataset, manifest, manifestBytes, study, studyBytes, scope, scopeBytes, authorization, config };
}

function fixture(root = "/example/companion", overlap: "none" | "id" | "store" = "none") {
  const f = parentFixture(root), pin = (name: string, body: Uint8Array) => ({ path: join(root, name + ".json"), sha256: sha256Hex(body) });
  const campaign = (campaignId: string, storeDirectory: string) => ({ protocol: "oh.memory.evolution-campaign.v1", campaignId, storeDirectory,
    approval: "Synthetic fixture only", additionalBudgetMicros: 5_000_000, maximumCalls: 1500, historicalExposureMicros: 0,
    historicalLedgers: [{ path: join(root, "unused-historic.jsonl"), sha256: sha256Hex(""), bytes: 0 }],
    authAuthority: { path: join(root, "unused-auth.json"), sha256: h("unused") } });
  const parentCampaignBytes = bytes(campaign("parent", join(root, "parent-store")));
  const parentStudy = { ...f.study, campaignPin: pin("parent-campaign", parentCampaignBytes) }, parentStudyBytes = bytes(parentStudy);
  const parentScope = makeEvolutionReleaseScope(parentStudyBytes, f.manifestBytes), parentScopeBytes = bytes(parentScope);
  const campaignBytes = bytes(campaign(overlap === "id" ? "parent" : "companion", join(root, overlap === "store" ? "parent-store" : "companion-store")));
  const study: EvolutionFullContextStudy = { protocol: "oh.memory.evolution-full-context-study.v1", mode: "full-release-descriptive-companion",
    parentStudyPin: pin("parent-study", parentStudyBytes), parentScopePin: pin("parent-scope", parentScopeBytes),
    datasetPin: f.study.datasetPin, manifestPin: f.study.manifestPin, campaignPin: pin("companion-campaign", campaignBytes),
    sourceSha256: h("companion source"), fullHistoryPolicySha256: h(EVOLUTION_FULL_HISTORY_POLICY), variants: EVOLUTION_FULL_CONTEXT_VARIANTS,
    reader: EVOLUTION_RELEASE_READER, judge: EVOLUTION_RELEASE_JUDGE, rubricSha256: EVOLUTION_RELEASE_RUBRIC_SHA,
    repeatPolicy: "predeclared-full-matrix-first-attempt" };
  const studyBytes = bytes(study), config = { protocol: "oh.memory.evolution-run.v8", dataset: "longmemeval-s", datasetPin: study.datasetPin,
    manifestPin: study.manifestPin, campaignPin: study.campaignPin, companionStudyPin: pin("companion-study", studyBytes),
    shardId: "shard-001", variants: study.variants, readers: [study.reader], judge: study.judge, limit: 100, seed: 17, concurrency: 24,
    directory: join(root, "output"), storeDirectory: join(root, overlap === "store" ? "parent-store" : "companion-store") };
  const authorization = validateEvolutionFullContextArtifacts({ studyBytes, parentStudyBytes, parentScopeBytes, manifestBytes: f.manifestBytes });
  return { ...f, parentStudy, parentStudyBytes, parentScopeBytes, parentCampaignBytes, campaignBytes, study, studyBytes, config, authorization };
}
async function contexts(f = fixture(), shardId = "shard-001") {
  const dataset = selectEvolutionReleaseShard(f.dataset, f.manifest, f.authorization.parent, shardId), projected = projectEvolutionRunnerInput(dataset);
  const made = await makeEvolutionFullContextPlan({ dataset: projected, authorization: f.authorization, shardId });
  return { dataset, projected, ...made };
}
function reseal(v: any, key = "planSha256") { const { [key]: _old, ...payload } = v; v[key] = h(payload); return v; }
async function persist(f: ReturnType<typeof fixture>) {
  for (const [pin, raw] of [[f.study.parentStudyPin, f.parentStudyBytes], [f.study.parentScopePin, f.parentScopeBytes],
    [f.parentStudy.campaignPin, f.parentCampaignBytes], [f.study.campaignPin, f.campaignBytes], [f.study.manifestPin, f.manifestBytes],
    [f.config.companionStudyPin, f.studyBytes]] as const) await writeFile(pin.path, raw);
}
test("companion preserves exact parent500 and exposure while V7 retains exactly two arms", () => {
  const f = fixture(); expect(parseEvolutionFullContextStudy(f.study)).toEqual(f.study);
  expect(f.authorization.parent.scope.questions).toHaveLength(500);
  expect(f.authorization.parent.scope.strata).toContainEqual({ partition: "closed", exposure: "unknown", questions: 400, groups: 400 });
  expect(f.authorization.parent.study.variants).toEqual(variants);
  expect(() => parseEvolutionReleaseStudy({ ...f.parentStudy, variants: [...variants, EVOLUTION_FULL_CONTEXT_VARIANTS[0]] })).toThrow();
  for (const mutate of [(v: any) => v.parentStudyPin.sha256 = h("changed"), (v: any) => v.manifestPin.sha256 = h("changed"),
    (v: any) => v.variants = variants, (v: any) => v.reader = "gpt5-mini-reader", (v: any) => v.fullHistoryPolicySha256 = h("other"),
    (v: any) => v.campaignPin = f.parentStudy.campaignPin]) {
    const bad = structuredClone(f.study); mutate(bad);
    expect(() => validateEvolutionFullContextArtifacts({ ...f, studyBytes: bytes(bad) })).toThrow();
  }
});
test("V8 uses complete-source V3 bytes without QMD, duplicated base context or gold fields", async () => {
  const f = fixture(), c = await contexts(f), base = await makeEvolutionContextPlanV3({ dataset: c.projected, variants: EVOLUTION_FULL_CONTEXT_VARIANTS,
    manifestSha256: f.study.manifestPin.sha256, retrievalSourceSha256: f.study.sourceSha256 });
  const config = parseEvolutionRunConfig(f.config);
  expect(() => validateEvolutionContextRunVersion(c.plan, config)).not.toThrow(); expect(validateEvolutionAnyContextPlan(c.plan)).toEqual(c.plan);
  expect(() => validateEvolutionContextPlanSources(c.plan, c.projected)).not.toThrow();
  expect(c.timing.every(t => t.queries === 0)).toBeTrue(); expect(c.plan.pools).toEqual([]);
  expect(c.plan.cases).toEqual(base.plan.cases); expect(Object.hasOwn(c.plan, "basePlan")).toBeFalse();
  const readers = makeEvolutionReaderPlan(c.plan, [EVOLUTION_RELEASE_READER]);
  expect(readers.requests).toEqual(makeEvolutionReaderPlan(base.plan, [EVOLUTION_RELEASE_READER]).requests);
  expect(readers.requests).toHaveLength(100); expect(readers.requests.every(r => r.protocol === EVOLUTION_MODEL_V2_PROTOCOL)).toBeTrue();
  expect(JSON.stringify(c.plan)).not.toContain("PRIVATE_GOLD_SENTINEL");
  for (const corpus of c.projected.corpora) Object.defineProperty(corpus, "answer", { enumerable: true, get() { throw Error("gold getter reached"); } });
  expect((await makeEvolutionFullContextPlan({ dataset: c.projected, authorization: f.authorization, shardId: "shard-001" })).plan).toEqual(c.plan);
  for (const protocol of ["oh.memory.evolution-run.v3", "oh.memory.evolution-run.v4", "oh.memory.evolution-run.v7"] as const)
    expect(() => validateEvolutionContextRunVersion(c.plan, { protocol })).toThrow();
  expect(() => validateEvolutionContextRunVersion(base.plan, config)).toThrow();
});
test("resealed companion source/order/shard/coverage attacks fail source or study reconstruction", async () => {
  const f = fixture(), c = await contexts(f);
  for (const mutate of [(v: any) => v.studySha256 = h("changed"), (v: any) => v.parentScopeSha256 = h("changed"),
    (v: any) => v.questions.reverse(), (v: any) => v.cases.pop(), (v: any) => v.cases[0].kind = "whole-turn",
    (v: any) => v.cases[0].result.context += "foreign", (v: any) => v.cases[0].answer = "gold"]) {
    const bad = structuredClone(c.plan); mutate(bad); reseal(bad);
    expect(() => { assertEvolutionFullContextBinding(bad, f.authorization, "shard-001"); validateEvolutionContextPlanSources(bad, c.projected); }).toThrow();
  }
  const changed = structuredClone(c.projected); (changed.corpora[0]!.turns as unknown[]).reverse();
  expect(() => validateEvolutionContextPlanSources(c.plan, changed)).toThrow();
});
test("V8 reload authenticates parent and companion bytes and separate campaigns without opening dataset/store", async () => {
  for (const overlap of ["none", "id", "store"] as const) {
    const root = await mkdtemp(join(await realpath(tmpdir()), "oh-full-context-")), f = fixture(root, overlap);
    try {
      await persist(f); const config = parseEvolutionRunConfig(f.config) as EvolutionFullContextRunConfig;
      if (overlap !== "none") { await expect(loadEvolutionFullContextAuthorization(config)).rejects.toThrow("separate campaign"); continue; }
      expect(await loadEvolutionFullContextAuthorization(config)).toEqual(f.authorization);
      await expect(loadEvolutionFullContextAuthorization({ ...config, directory: join(root, "parent-store", "child") })).rejects.toThrow("non-overlapping store/output");
      expect(await Bun.file(f.study.datasetPin.path).exists()).toBeFalse(); expect(await Bun.file(config.storeDirectory).exists()).toBeFalse();
      for (const mutate of [(v: any) => v.limit = 99, (v: any) => v.concurrency = 12, (v: any) => v.shardId = "shard-006",
        (v: any) => v.variants = variants, (v: any) => v.companionStudyPin.path = v.directory + "/study.json", (v: any) => v.seed = 18]) {
        const bad = structuredClone(f.config); mutate(bad); expect(() => parseEvolutionRunConfig(bad)).toThrow();
      }
      await writeFile(f.study.parentStudyPin.path, bytes({ ...f.parentStudy, candidatePresentation: "source-order" }));
      await expect(loadEvolutionFullContextAuthorization(config)).rejects.toThrow("pinned content changed");
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
async function reportFixture(f = fixture(), shardId = "shard-001") {
  const c = await contexts(f, shardId), readerPlan = makeEvolutionReaderPlan(c.plan, [EVOLUTION_RELEASE_READER]), captures = new Map<string, Uint8Array>();
  const failRequest = readerPlan.requests[0]!;
  const failure: EvolutionAttemptFailure = { requestSha256: failRequest.requestSha256, profileSha256: failRequest.profileSha256, repeat: 0,
    storeStatus: "captured", reason: "unverifiable-first-response", rawSha256: sha256Hex(""), rawBytes: 0,
    transport: { httpStatus: null, complete: false, receivedBytes: 0, error: "network" }, serviceMs: 120000, reservationMicros: failRequest.reservationMicros };
  const failures = new Map([[failure.requestSha256, failure]]);
  function responses(requests: readonly EvolutionRequest[], answer: string, exclude?: string) {
    return new Map(requests.filter(r => r.requestSha256 !== exclude).map(r => {
      const raw = bytes({ model: r.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
        usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 }, providerMetadata: { gateway: { routing: { finalProvider: r.provider,
          originalModelId: r.model, canonicalSlug: r.model, resolvedProviderApiModelId: r.model.slice(r.model.indexOf("/") + 1) } } } });
      captures.set(r.requestSha256, raw); return [r.requestSha256, parseEvolutionResponse(raw, r)] as const;
    }));
  }
  const phase = (phase: string, planSha256: string, responses: Map<string, EvolutionResponse>, failures: readonly EvolutionAttemptFailure[] = []) => bytes({
    protocol: "oh.memory.evolution-phase.v1", phase, planSha256, complete: true, responses: [...responses].map(([requestSha256, response]) => ({ requestSha256, response })), failures });
  const readerResponses = responses(readerPlan.requests, "PRIVATE_PREDICTION_SENTINEL", failure.requestSha256);
  const readerOutputBytes = phase("reader", readerPlan.planSha256, readerResponses, [failure]);
  const judgePlan = makeEvolutionJudgePlan({ contextPlan: c.plan, readerPlan, responses: readerResponses, failures, dataset: c.dataset,
    profile: EVOLUTION_RELEASE_JUDGE, rubric: await loadJudgeProfile(), readerOutputSha256: sha256Hex(readerOutputBytes) });
  const judgeResponses = responses(judgePlan.requests, "yes"), failedJudge = judgePlan.requests[0]!;
  const judgeFailure: EvolutionAttemptFailure = { requestSha256: failedJudge.requestSha256, profileSha256: failedJudge.profileSha256, repeat: 0,
    storeStatus: "reserved", reason: "dispatch-outcome-unknown", rawSha256: null, rawBytes: null, transport: null, serviceMs: null, reservationMicros: failedJudge.reservationMicros };
  judgeResponses.delete(failedJudge.requestSha256); failures.set(judgeFailure.requestSha256, judgeFailure);
  const judgeOutputBytes = phase("judge", judgePlan.planSha256, judgeResponses, [judgeFailure]);
  const input = { dataset: c.dataset, manifestBytes: f.manifestBytes, manifestSha256: f.study.manifestPin.sha256, contextPlan: c.plan, readerPlan, judgePlan,
    readerOutputBytes, judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes), loadRawResponse: async (r: EvolutionRequest) => captures.get(r.requestSha256)!,
    loadAttemptFailure: async (r: EvolutionRequest) => failures.get(r.requestSha256)!,
    companion: { studyBytes: f.studyBytes, parentStudyBytes: f.parentStudyBytes, parentScopeBytes: f.parentScopeBytes, shardId, campaignSha256: h("canonical companion campaign") } };
  return { f, c, input, readerResponses, failures };
}

test("companion native16 report preserves full100 failure denominator and unknown reservations", async () => {
  const f = await reportFixture(), report = await buildEvolutionFullContextShardReport(f.input);
  expect(report.protocol).toBe("oh.memory.evolution-report.v3"); expect(report.dataset.partition).toBe("full-release-descriptive");
  expect(report.coverage).toMatchObject({ logicalReaderCases: 100, logicalJudgeCases: 100, expectedQuestionsPerArm: 100, completeAttemptCoverage: true,
    capturedUnverifiableAttempts: 1, unknownDispatches: 1 });
  expect(report.companion.outcomes).toHaveLength(100); expect(report.companion.outcomes.filter(o => o.readerFailed)).toHaveLength(1);
  expect(report.companion.outcomes.some(o => o.judgeFailed)).toBeTrue();
  for (const o of report.companion.outcomes.filter(o => o.readerFailed || o.judgeFailed)) expect(o.scores["judge-accuracy"]).toBe(0);
  expect(report.cost.unresolvedReservationMicros).toBe([...f.failures.values()].reduce((s, r) => s + r.reservationMicros, 0));
  expect(report.companion.physical.find(r => r.status === "reserved")).toMatchObject({ knownUsageMicros: null, serviceMs: null });
  expect(report.arms[0]!.metrics.find(m => m.metric === "evidence-recall")!.overall.mean).toBe(1);
  const encoded = JSON.stringify(report); expect(encoded).not.toContain("PRIVATE_GOLD_SENTINEL"); expect(encoded).not.toContain("PRIVATE_PREDICTION_SENTINEL"); expect(encoded).not.toContain("Synthetic memory");
  await expect(buildEvolutionReport(f.input)).rejects.toThrow("only development");
  const missing = JSON.parse(new TextDecoder().decode(f.input.readerOutputBytes)); missing.responses.pop();
  await expect(buildEvolutionFullContextShardReport({ ...f.input, readerOutputBytes: bytes(missing) })).rejects.toThrow();
  await expect(buildEvolutionFullContextShardReport({ ...f.input, companion: { ...f.input.companion, shardId: "shard-002" } })).rejects.toThrow();
});

test("offline companion metadata CLI pins all originals and writes exclusive outputs without dataset or store", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "oh-full-context-cli-")), f = fixture(root), output = join(root, "admission.json");
  try {
    await persist(f);
    const studyBytes = bytes({ ...f.study, sourceSha256: await retrievalIdentity() });
    const pin = { ...f.config.companionStudyPin, sha256: sha256Hex(studyBytes) }; await writeFile(pin.path, studyBytes);
    const argv = ["check", "--study", pin.path, "--study-sha256", pin.sha256, "--output", output];
    expect(parseEvolutionFullContextArgs(argv)).toEqual({ command: "check", pin, output });
    for (const bad of [argv.slice(0, -1), [...argv, "--unknown", "yes"], [...argv, "--output", output], ["check", "--study", "relative"]])
      expect(() => parseEvolutionFullContextArgs(bad)).toThrow();
    expect((await checkEvolutionFullContextStudy(pin, output)).modelCalls).toBe(0);
    const receipt = await Bun.file(output).json(); expect(receipt.questions).toBe(500); expect(receipt.logicalReaderCases).toBe(500);
    expect(receipt.shards.map((s: any) => s.questions)).toEqual([100, 100, 100, 100, 100]);
    expect(await Bun.file(f.study.datasetPin.path).exists()).toBeFalse(); expect(await Bun.file(f.config.storeDirectory).exists()).toBeFalse();
    await expect(checkEvolutionFullContextStudy(pin, output)).rejects.toThrow();
    await expect(checkEvolutionFullContextStudy(pin, f.study.parentStudyPin.path)).rejects.toThrow("output overlaps");
    const bad = bytes({ protocol: "oh.memory.evolution-full-context-combine.v1", studyPin: pin, parentReportPins: [], reportPins: [] }), badPin = { path: join(root, "bad-combine.json"), sha256: sha256Hex(bad) }; await writeFile(badPin.path, bad);
    await expect(combineEvolutionFullContext(badPin, join(root, "bad-output.json"))).rejects.toThrow("exact five parent");
  } finally { await rm(root, { recursive: true, force: true }); }
});
