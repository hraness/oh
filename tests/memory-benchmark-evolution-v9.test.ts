import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { OH_EMBEDDING_PROFILE_V1 } from "../src/semantic";
import { DATASETS, selectQuestions, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput, selectEvolutionPartition } from "../scripts/benchmarks/evolution-dataset";
import { createEvolutionFullHistorySource } from "../scripts/benchmarks/evolution-full-history";
import { renderTurn } from "../scripts/benchmarks/retrieval";
import { EVOLUTION_RELEASE_JUDGE, EVOLUTION_RELEASE_READERS, EVOLUTION_RELEASE_RUBRIC_SHA, makeEvolutionReleaseScope, validateEvolutionReleaseArtifacts,
  type EvolutionReleaseStudy } from "../scripts/benchmarks/evolution-release";
import { makeEvolutionReleaseContextPlan, evolutionReleaseContextBinding } from "../scripts/benchmarks/evolution-release-plan";
import { makeEvolutionReaderPlan, type EvolutionContextPlan } from "../scripts/benchmarks/evolution-plan";
import { EVOLUTION_CONTEXT_SOURCE_FILES, parseEvolutionArgs, parseEvolutionRunConfig, retrievalIdentity, validateEvolutionContextRunVersion } from "../scripts/benchmarks/evolution";
import { EVOLUTION_EVALUATION_SCOPE_V2_PROTOCOL, makeEvolutionEvaluationScopeV2, validateEvolutionEvaluationScopeV2 } from "../scripts/benchmarks/evolution-evaluation-scope";
import { EVOLUTION_STUDY_V9_PROTOCOL, makeEvolutionStudyV9Scope, parseEvolutionStudyV9, selectEvolutionStudyV9Shard, validateEvolutionStudyV9Artifacts,
  type EvolutionStudyV9 } from "../scripts/benchmarks/evolution-study-v9";
import { EVOLUTION_CONTEXT_PLAN_V9_PROTOCOL, assertEvolutionContextBindingV9, evolutionContextBindingV9, makeEvolutionContextPlanV9, rebindEvolutionBasePlan,
  rebindEvolutionContextPlanV9, validateEvolutionContextPlanV9Envelope, validateEvolutionContextPlanV9Sources } from "../scripts/benchmarks/evolution-plan-v9";
import { EVOLUTION_READER_PLAN_V2_PROTOCOL, evolutionJobKey, evolutionPhysicalJobs, evolutionReaderJobsV2, makeEvolutionReaderPlanV2, validateEvolutionReaderPlanV2 } from "../scripts/benchmarks/evolution-reader-plan-v2";
import { evolutionReaderDatePolicySha256, projectEvolutionRunnerInputV9 } from "../scripts/benchmarks/evolution-reader-date-policy";
import { EVOLUTION_JUDGE_PLAN_V9_PROTOCOL, evolutionJudgeJobsV9, loadEvolutionJudgeRubricV9, makeEvolutionJudgePlanV9, validateEvolutionJudgePlanV9 } from "../scripts/benchmarks/evolution-judge-v9";
import { EVOLUTION_PHASE_V2_PROTOCOL, EVOLUTION_REPORT_V9_PROTOCOL, buildEvolutionReportV9, evolutionPhaseAttemptsV9 } from "../scripts/benchmarks/evolution-report-v9";
import { buildEvolutionStudyV9Report } from "../scripts/benchmarks/evolution-study-v9-report";
import { EVOLUTION_RUN_V9_PROTOCOL, loadEvolutionStudyV9Authorization, parseEvolutionRunConfigV9, runEvolutionJobsV9 } from "../scripts/benchmarks/evolution-runner-v9";
import { EVOLUTION_STUDY_V9_COMBINE_PROTOCOL, combineEvolutionRelease, prepareEvolutionReleaseScope } from "../scripts/benchmarks/evolution-release-cli";
import { makeEvolutionRequest, parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore, type EvolutionAttemptFailure } from "../scripts/benchmarks/evolution-store";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";

const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No provider or network in V9 fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });
const bytes = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
const h = canonicalSha256;
const control = { id: "window-96k", system: "bm25-window", budget: { topK: 100, contextBytes: 96_000 } } as const;
const candidate = { id: "semantic-96k", system: "oh-semantic", budget: { topK: 100, contextBytes: 96_000 } } as const;
const variants = [control, candidate] as const;
const mini = EVOLUTION_RELEASE_READERS[1], nano = EVOLUTION_RELEASE_READERS[0];
function source(root = "/example/v9") {
  const dataset: Dataset = { corpora: Array.from({ length: 500 }, (_, i) => ({ id: `c-${i}`, groupId: `g-${i}`,
    turns: [0, 1].map(n => ({ id: `t-${i}-${n}`, sessionId: `s-${i}-${n}`, sessionIndex: n, date: `2026-01-0${n + 1}`, speaker: "user", text: `Synthetic memory ${i}/${n} café.` })) })), questions: [] };
  const questions = dataset.corpora.map((c, i) => ({ id: `q-${i}`, corpusId: c.id, category: i % 2 ? "multi-session" : "single-session-user",
    question: `Where is synthetic item ${i}?`, questionDate: "2026-01-09", answer: "PRIVATE_GOLD_SENTINEL", unanswerable: false,
    evidenceTurnIds: [c.turns[0]!.id], evidenceSessionIds: [c.turns[0]!.sessionId] }));
  const full: Dataset = { corpora: dataset.corpora, questions };
  const manifest = createEvolutionDatasetManifest(full, { dataset: "longmemeval-s", revision: DATASETS["longmemeval-s"].revision, sourceSha256: DATASETS["longmemeval-s"].sha256,
    groups: full.corpora.map((c, i) => ({ groupId: c.groupId, partition: i < 100 ? "development" : "closed", exposure: i < 100 ? "evaluated" : "unknown", evidence: "Synthetic declaration." })) });
  const manifestBytes = bytes(manifest), pin = (name: string, sha256: string) => ({ path: join(root, name + ".json"), sha256 });
  return { dataset: full, manifest, manifestBytes, pin, root };
}
type Source = ReturnType<typeof source>;
function v7(s: Source) {
  const study: EvolutionReleaseStudy = { protocol: "oh.memory.evolution-release-study.v1", mode: "full-release-descriptive", dataset: "longmemeval-s",
    datasetPin: s.pin("official", DATASETS["longmemeval-s"].sha256), manifestPin: s.pin("manifest", sha256Hex(s.manifestBytes)), campaignPin: s.pin("campaign", h("campaign")),
    retrievalSourceSha256: h("parent retrieval source"), variants, reader: mini, judge: EVOLUTION_RELEASE_JUDGE, rubricSha256: EVOLUTION_RELEASE_RUBRIC_SHA,
    candidatePresentation: "retrieval-order", repeatPolicy: "predeclared-full-matrix-first-attempt" };
  const studyBytes = bytes(study), scope = makeEvolutionReleaseScope(studyBytes, s.manifestBytes);
  return { study, studyBytes, scope, authorization: validateEvolutionReleaseArtifacts({ studyBytes, manifestBytes: s.manifestBytes, scopeBytes: bytes(scope) }) };
}
function v9Study(s: Source, overrides: Partial<EvolutionStudyV9> = {}): EvolutionStudyV9 {
  return { protocol: EVOLUTION_STUDY_V9_PROTOCOL, mode: "explicit-selection-descriptive", dataset: "longmemeval-s",
    datasetPin: s.pin("official", DATASETS["longmemeval-s"].sha256), manifestPin: s.pin("manifest", sha256Hex(s.manifestBytes)), campaignPin: s.pin("campaign-v9", h("campaign v9")),
    retrievalSourceSha256: h("current retrieval source"), candidate, control, readers: [mini], judge: EVOLUTION_RELEASE_JUDGE, rubricSha256: EVOLUTION_RELEASE_RUBRIC_SHA,
    repeats: 2, judgeRepeats: 2, selection: s.manifest.questions.map(q => q.runnerId), maximumQuestionsPerShard: 100, shardPolicy: "packed-clusters",
    derivedRecordsPin: null, retrievalProvenance: null, readerDatePolicy: "question-date", candidatePresentation: "retrieval-order", repeatPolicy: "predeclared-full-matrix-indexed-repeats", ...overrides };
}
function v9(s: Source, overrides: Partial<EvolutionStudyV9> = {}) {
  const study = v9Study(s, overrides), studyBytes = bytes(study), scope = makeEvolutionStudyV9Scope(studyBytes, s.manifestBytes), scopeBytes = bytes(scope);
  const authorization = validateEvolutionStudyV9Artifacts({ studyBytes, manifestBytes: s.manifestBytes, scopeBytes });
  const config = (shardId = "shard-001") => ({ protocol: EVOLUTION_RUN_V9_PROTOCOL, dataset: study.dataset, datasetPin: study.datasetPin, manifestPin: study.manifestPin,
    campaignPin: study.campaignPin, studyPin: s.pin("study-v9", sha256Hex(studyBytes)), scopePin: s.pin("scope-v9", sha256Hex(scopeBytes)), shardId,
    limit: scope.shards.find(x => x.id === shardId)!.questionIds.length, variants: [study.control, study.candidate], readers: study.readers, judge: study.judge,
    repeats: study.repeats, judgeRepeats: study.judgeRepeats, readerDatePolicy: study.readerDatePolicy, derivedRecordsPin: study.derivedRecordsPin,
    directory: join(s.root, "v9", shardId), storeDirectory: join(s.root, "v9-store"), concurrency: 24, semanticCacheDirectory: join(s.root, "v9-cache") });
  return { study, studyBytes, scope, scopeBytes, authorization, config };
}
/** Synthetic whole-turn contexts with the exact prepared identity the source validator recomputes. */
function baseContexts(projected: ReturnType<typeof projectEvolutionRunnerInput>, manifestSha256: string, retrievalSourceSha256: string): EvolutionContextPlan {
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
function v9Contexts(s: Source, f: ReturnType<typeof v9>, shardId = "shard-001") {
  const dataset = selectEvolutionStudyV9Shard(s.dataset, s.manifest, f.authorization, shardId), projected = projectEvolutionRunnerInputV9(dataset, f.study.readerDatePolicy);
  const basePlan = baseContexts(projected, f.study.manifestPin.sha256, f.study.retrievalSourceSha256);
  const plan = makeEvolutionContextPlanV9({ dataset: projected, basePlan, binding: evolutionContextBindingV9(f.authorization, shardId) });
  return { dataset, projected, basePlan, plan };
}
function reseal(v: any, key = "planSha256") { const { [key]: _old, ...payload } = v; v[key] = h(payload); return v; }
function raw(request: EvolutionRequest, answer: string) {
  return bytes({ model: request.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 }, providerMetadata: { gateway: { routing: { finalProvider: request.provider,
      originalModelId: request.model, canonicalSlug: request.model, resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1) } } } });
}
const phase = (kind: "reader" | "judge", planSha256: string, rows: readonly { requestSha256: string; repeat: number; response: EvolutionResponse }[], failures: readonly EvolutionAttemptFailure[] = []) =>
  bytes({ protocol: EVOLUTION_PHASE_V2_PROTOCOL, phase: kind, planSha256, complete: true, responses: rows, failures, wallMs: 12 });

test("V9 studies pin explicit selections, candidate/control systems, repeats and a date policy; V2 scopes reproduce the V1 full500 packing", () => {
  const s = source(), release = v7(s), f = v9(s);
  expect(f.scope.protocol).toBe(EVOLUTION_EVALUATION_SCOPE_V2_PROTOCOL);
  expect(f.scope.shards.map(x => x.questionIds)).toEqual(release.scope.shards.map(x => x.questionIds));
  expect(f.scope.coverage).toMatchObject({ releaseQuestions: 500, selectedQuestions: 500, partiallySelectedClusters: 0, logicalReaderCases: 2000, logicalJudgeCases: 4000 });
  expect(f.scope.design).toMatchObject({ dataset: "longmemeval-s", candidateVariantSha256: h(candidate), repeats: 2, judgeRepeats: 2, readerDatePolicySha256: evolutionReaderDatePolicySha256("question-date") });
  expect(JSON.stringify(f.scope)).not.toContain("PRIVATE_GOLD_SENTINEL"); expect(JSON.stringify(f.scope)).not.toContain("Synthetic memory");
  // Explicit subset: the development stratum pinned by ids, not by seed.
  const dev = s.manifest.questions.filter(q => q.partition === "development").map(q => q.runnerId);
  const subset = v9(s, { selection: dev, maximumQuestionsPerShard: 40 });
  expect(subset.scope.coverage.selectedQuestions).toBe(100); expect(subset.scope.shards.every(x => x.questionIds.length <= 40)).toBe(true);
  expect(subset.scope.strata).toEqual([{ partition: "development", exposure: "evaluated", questions: 100, groups: 100 }]);
  expect(subset.scope.shards.flatMap(x => x.questionIds).sort()).toEqual([...dev].sort());
  const perCluster = v9(s, { selection: dev.slice(0, 3), shardPolicy: "one-cluster-per-shard" });
  expect(perCluster.scope.shards).toHaveLength(3); expect(perCluster.scope.shards.map(x => x.questionIds.length)).toEqual([1, 1, 1]);
  for (const mutate of [(x: any) => x.dataset = "beam", (x: any) => x.judge = "gpt4o-mini-locomo-j-judge-v1", (x: any) => x.repeats = 4, (x: any) => x.judgeRepeats = 0,
    (x: any) => x.selection = ["q-0"], (x: any) => x.selection.push(x.selection[0]), (x: any) => x.control = { ...x.candidate }, (x: any) => x.readers = [],
    (x: any) => x.readerDatePolicy = "today", (x: any) => x.rubricSha256 = h("other"), (x: any) => x.candidate.budget.topK = 401, (x: any) => x.maximumQuestionsPerShard = 261,
    (x: any) => x.retrievalProvenance = { parentStudySha256: "x" }, (x: any) => x.derivedRecordsPin = { path: "relative", sha256: h("d") }, (x: any) => x.gold = "leak"]) {
    const bad = structuredClone(f.study) as any; mutate(bad); expect(() => parseEvolutionStudyV9(bad)).toThrow();
  }
  expect(() => parseEvolutionStudyV9({ ...f.study, dataset: "locomo", datasetPin: s.pin("locomo", DATASETS.locomo.sha256) })).toThrow("require each other");
  const foreign = structuredClone(f.study); (foreign as any).selection = [...foreign.selection.slice(1), `q-${"0".repeat(64)}`];
  expect(() => makeEvolutionStudyV9Scope(bytes(foreign), s.manifestBytes)).toThrow("foreign");
  const bad = structuredClone(f.scope) as any; bad.questions[100].exposure = "unseen"; reseal(bad, "scopeSha256");
  expect(() => validateEvolutionStudyV9Artifacts({ studyBytes: f.studyBytes, manifestBytes: s.manifestBytes, scopeBytes: bytes(bad) })).toThrow();
  expect(() => validateEvolutionEvaluationScopeV2({ manifestBytes: s.manifestBytes, manifestSha256: sha256Hex(s.manifestBytes), source: f.scope.source,
    request: { mode: "explicit-selection", maximumQuestionsPerShard: 100, shardPolicy: "packed-clusters", design: f.scope.design, selectedQuestionIds: f.study.selection } }, bytes(f.scope))).not.toThrow();
  expect(() => makeEvolutionEvaluationScopeV2({ manifestBytes: s.manifestBytes, manifestSha256: sha256Hex(s.manifestBytes), source: f.scope.source,
    request: { mode: "explicit-selection", maximumQuestionsPerShard: 100, shardPolicy: "random", design: f.scope.design, selectedQuestionIds: f.study.selection } } as any)).toThrow("shard policy");
});

test("V9 run configurations bind study, scope, repeats, date policy and the derived-record slot; V9 contexts wrap exact whole-turn results", () => {
  const s = source(), f = v9(s), c = v9Contexts(s, f), config = parseEvolutionRunConfig(f.config());
  expect(config).toEqual(parseEvolutionRunConfigV9(f.config())); expect(h(config)).toBe(h(f.config()));
  expect(() => validateEvolutionContextRunVersion(c.plan, config)).not.toThrow();
  for (const protocol of ["oh.memory.evolution-run.v4", "oh.memory.evolution-run.v7"] as const) expect(() => validateEvolutionContextRunVersion(c.plan, { protocol })).toThrow("V9");
  expect(() => validateEvolutionContextRunVersion({ protocol: "oh.memory.evolution-context-plan.v6" }, config)).toThrow("V9");
  for (const mutate of [(x: any) => x.seed = 17, (x: any) => delete x.repeats, (x: any) => x.concurrency = 12, (x: any) => x.limit = 0, (x: any) => x.shardId = "shard-1",
    (x: any) => x.variants = [x.variants[0]], (x: any) => x.variants = [x.variants[1], x.variants[1]], (x: any) => x.judge = "gpt4o-gateway-judge",
    (x: any) => x.storeDirectory = x.directory + "/store", (x: any) => x.semanticCacheDirectory = x.storeDirectory, (x: any) => x.studyPin.path = x.directory + "/study.json",
    (x: any) => x.derivedRecordsPin = { path: x.semanticCacheDirectory + "/obs.json", sha256: h("obs") }, (x: any) => x.readerDatePolicy = "now", (x: any) => x.datasetPin.sha256 = h("other")]) {
    const bad = structuredClone(f.config()); mutate(bad); expect(() => parseEvolutionRunConfig(bad)).toThrow();
  }
  expect(c.plan.protocol).toBe(EVOLUTION_CONTEXT_PLAN_V9_PROTOCOL); expect(c.plan.candidateVariantSha256).toBe(h(candidate));
  expect(c.plan.readerDatePolicySha256).toBe(evolutionReaderDatePolicySha256("question-date")); expect(c.plan.resultProtocol).toBe("oh.evolution-retrieval.v1");
  expect(validateEvolutionContextPlanV9Envelope(c.plan)).toEqual(c.plan);
  expect(() => validateEvolutionContextPlanV9Sources(c.plan, c.projected)).not.toThrow();
  expect(() => assertEvolutionContextBindingV9(c.plan, f.authorization, "shard-001")).not.toThrow();
  expect(c.plan.cases.map(x => x.result)).toEqual(c.basePlan.cases.map(x => x.result));
  expect(JSON.stringify(c.plan)).not.toContain("PRIVATE_GOLD_SENTINEL");
  for (const mutate of [(x: any) => x.studySha256 = h("other"), (x: any) => x.shardId = "shard-002", (x: any) => x.cases.pop(), (x: any) => x.readerDatePolicy = "final-session-date",
    (x: any) => x.derivedRecordsPin = { path: "/example/obs.json", sha256: h("obs") }, (x: any) => x.cases[0].result.context = "invented", (x: any) => x.candidateVariantSha256 = h(control)]) {
    const bad = structuredClone(c.plan); mutate(bad); reseal(bad); expect(() => assertEvolutionContextBindingV9(bad, f.authorization, "shard-001")).toThrow();
  }
  const changed = structuredClone(c.projected); (changed.corpora[0]!.turns[1] as { text: string }).text += " changed";
  expect(() => validateEvolutionContextPlanV9Sources(c.plan, changed)).toThrow();
  expect(() => makeEvolutionContextPlanV9({ dataset: c.projected, basePlan: { ...c.basePlan, variants: [candidate, control] } as any, binding: evolutionContextBindingV9(f.authorization, "shard-001") })).toThrow();
  for (const file of ["evolution-plan-v9.ts", "evolution-study-v9.ts", "evolution-reader-date-policy.ts", "evolution-runner-v9.ts", "evolution-evaluation-scope.ts"])
    expect(EVOLUTION_CONTEXT_SOURCE_FILES as readonly string[]).toContain(`scripts/benchmarks/${file}`);
  expect(parseEvolutionArgs(["rebind", "--config", "/a/c.json", "--config-sha256", h("c"), "--context", "/a/x.json", "--context-sha256", h("x")]).command).toBe("rebind");
});

test("rebind reuses a V6 release parent, a V1 development parent or a V9 parent byte-for-byte under a V9 study that declares its provenance", () => {
  const s = source(), release = v7(s), parentProjected = projectEvolutionRunnerInput(selectEvolutionStudyV9Shard(s.dataset, s.manifest, v9(s).authorization, "shard-001"));
  const parentBase = baseContexts(parentProjected, release.study.manifestPin.sha256, release.study.retrievalSourceSha256);
  const parentPlan = makeEvolutionReleaseContextPlan({ dataset: parentProjected, basePlan: parentBase, binding: evolutionReleaseContextBinding(release.authorization, "shard-001") });
  const provenance = { parentStudySha256: sha256Hex(release.studyBytes), parentRetrievalSourceSha256: release.study.retrievalSourceSha256 };
  const child = v9(s, { retrievalProvenance: provenance, repeats: 1, judgeRepeats: 1 });
  const rebound = rebindEvolutionContextPlanV9({ dataset: parentProjected, parent: parentPlan, authorization: child.authorization, shardId: "shard-001", retrievalSourceSha256: child.study.retrievalSourceSha256 });
  expect(rebound.cases.map(c => c.result)).toEqual(parentPlan.cases.map(c => c.result));
  expect(h(rebound.cases.map(c => c.result))).toBe(h(parentBase.cases.map(c => c.result)));
  expect(rebound.retrievalSourceSha256).toBe(child.study.retrievalSourceSha256); expect(rebound.basePlan.retrievalSourceSha256).toBe(child.study.retrievalSourceSha256);
  expect(rebound.studySha256).toBe(sha256Hex(child.studyBytes)); expect(rebound.inputSha256).toBe(h(parentProjected));
  expect(() => assertEvolutionContextBindingV9(rebound, child.authorization, "shard-001")).not.toThrow();
  validateEvolutionContextPlanV9Sources(rebound, parentProjected);
  // The date policy only moves questionDate: rebinding under final-session-date keeps the identical retrieval results.
  const dated = v9(s, { retrievalProvenance: provenance, readerDatePolicy: "final-session-date" });
  const datedProjected = projectEvolutionRunnerInputV9(selectEvolutionStudyV9Shard(s.dataset, s.manifest, dated.authorization, "shard-001"), "final-session-date");
  expect(datedProjected.questions.every(q => q.questionDate === "2026-01-02")).toBe(true); expect(datedProjected.corpora).toEqual(parentProjected.corpora);
  const datedRebound = rebindEvolutionContextPlanV9({ dataset: datedProjected, parent: parentPlan, authorization: dated.authorization, shardId: "shard-001", retrievalSourceSha256: dated.study.retrievalSourceSha256 });
  expect(datedRebound.cases.map(c => c.result)).toEqual(parentPlan.cases.map(c => c.result)); expect(datedRebound.inputSha256).not.toBe(rebound.inputSha256);
  expect(datedRebound.readerDatePolicySha256).toBe(evolutionReaderDatePolicySha256("final-session-date"));
  // A V1 development parent stands in with its own plan digest; a V9 parent chains through its study digest.
  const fromV1 = v9(s, { retrievalProvenance: { parentStudySha256: parentBase.planSha256, parentRetrievalSourceSha256: parentBase.retrievalSourceSha256 }, repeats: 1, judgeRepeats: 1 });
  expect(rebindEvolutionContextPlanV9({ dataset: parentProjected, parent: parentBase, authorization: fromV1.authorization, shardId: "shard-001", retrievalSourceSha256: fromV1.study.retrievalSourceSha256 }).cases.map(c => c.result)).toEqual(parentBase.cases.map(c => c.result));
  const chained = v9(s, { retrievalProvenance: { parentStudySha256: rebound.studySha256, parentRetrievalSourceSha256: rebound.retrievalSourceSha256 }, retrievalSourceSha256: h("third source") });
  expect(rebindEvolutionContextPlanV9({ dataset: parentProjected, parent: rebound, authorization: chained.authorization, shardId: "shard-001", retrievalSourceSha256: h("third source") }).retrievalSourceSha256).toBe(h("third source"));
  const plain = v9(s), tampered = structuredClone(parentPlan) as any; tampered.basePlan.cases[0].result.context = "changed"; reseal(tampered.basePlan.cases[0].result, "resultSha256"); reseal(tampered.basePlan); reseal(tampered);
  expect(() => rebindEvolutionContextPlanV9({ dataset: parentProjected, parent: parentPlan, authorization: plain.authorization, shardId: "shard-001", retrievalSourceSha256: plain.study.retrievalSourceSha256 })).toThrow("provenance");
  expect(() => rebindEvolutionContextPlanV9({ dataset: parentProjected, parent: parentPlan, authorization: child.authorization, shardId: "shard-002", retrievalSourceSha256: child.study.retrievalSourceSha256 })).toThrow();
  expect(() => rebindEvolutionContextPlanV9({ dataset: parentProjected, parent: parentPlan, authorization: child.authorization, shardId: "shard-001", retrievalSourceSha256: h("other") })).toThrow("current retrieval source");
  expect(() => rebindEvolutionContextPlanV9({ dataset: parentProjected, parent: tampered, authorization: child.authorization, shardId: "shard-001", retrievalSourceSha256: child.study.retrievalSourceSha256 })).toThrow();
  const wrongParent = v9(s, { retrievalProvenance: { ...provenance, parentStudySha256: h("other parent") } });
  expect(() => rebindEvolutionContextPlanV9({ dataset: parentProjected, parent: parentPlan, authorization: wrongParent.authorization, shardId: "shard-001", retrievalSourceSha256: wrongParent.study.retrievalSourceSha256 })).toThrow("provenance");
  const changedText = structuredClone(parentProjected); (changedText.questions[0] as { question: string }).question += "?";
  expect(() => rebindEvolutionBasePlan({ base: parentBase, dataset: changedText, retrievalSourceSha256: h("x") })).toThrow("questions differ");
  expect(rebindEvolutionBasePlan({ base: parentBase, dataset: parentProjected, retrievalSourceSha256: h("x") }).retrievalSourceSha256).toBe(h("x"));
});

test("rebind reorders a seed-ordered V1 development parent into the shard's canonical order and reuses every result unchanged", () => {
  const s = source(), seeded = selectQuestions(selectEvolutionPartition(s.dataset, s.manifest, "development"), 60, 17);
  const parentProjected = projectEvolutionRunnerInput(seeded), parent = baseContexts(parentProjected, sha256Hex(s.manifestBytes), h("parent retrieval source"));
  const study = v9(s, { selection: parentProjected.questions.map(q => q.id), maximumQuestionsPerShard: 100, repeats: 1, judgeRepeats: 1,
    retrievalProvenance: { parentStudySha256: parent.planSha256, parentRetrievalSourceSha256: parent.retrievalSourceSha256 } });
  expect(study.scope.shards).toHaveLength(1);
  const shardProjected = projectEvolutionRunnerInputV9(selectEvolutionStudyV9Shard(s.dataset, s.manifest, study.authorization, "shard-001"), "question-date");
  // The seeded development order is category-interleaved by seeded hash; the V2 scope lays the same set out by runner ID.
  expect(shardProjected.questions.map(q => q.id)).not.toEqual(parentProjected.questions.map(q => q.id));
  expect([...shardProjected.questions.map(q => q.id)].sort()).toEqual([...parentProjected.questions.map(q => q.id)].sort());
  const rebound = rebindEvolutionContextPlanV9({ dataset: shardProjected, parent, authorization: study.authorization, shardId: "shard-001", retrievalSourceSha256: study.study.retrievalSourceSha256 });
  expect(rebound.questions.map(q => q.id)).toEqual(shardProjected.questions.map(q => q.id));
  expect(rebound.basePlan.questions).toEqual(shardProjected.questions); expect(rebound.inputSha256).toBe(h(shardProjected));
  const key = (c: { questionId: string; variantId: string }) => JSON.stringify([c.questionId, c.variantId]);
  const originals = new Map(parent.cases.map(c => [key(c), c.result]));
  expect(rebound.cases).toHaveLength(parent.cases.length);
  for (const c of rebound.cases) expect(c.result).toEqual(originals.get(key(c))!);
  expect(rebound.cases.map(key)).toEqual(shardProjected.questions.flatMap(q => variants.map(v => key({ questionId: q.id, variantId: v.id }))));
  expect(() => assertEvolutionContextBindingV9(rebound, study.authorization, "shard-001")).not.toThrow();
  validateEvolutionContextPlanV9Sources(rebound, shardProjected);
  expect(rebound.basePlan.planSha256).not.toBe(parent.planSha256);
  // Set equality is required: a shard that drops one parent question, adds a foreign one or rebinds a different corpus is refused.
  const dropped = { corpora: shardProjected.corpora, questions: shardProjected.questions.slice(1) };
  expect(() => rebindEvolutionBasePlan({ base: parent, dataset: dropped, retrievalSourceSha256: h("x") })).toThrow("questions differ");
  const other = projectEvolutionRunnerInput(selectEvolutionStudyV9Shard(s.dataset, s.manifest, v9(s).authorization, "shard-002"));
  const swapped = { corpora: [...shardProjected.corpora, other.corpora[0]!], questions: [...shardProjected.questions.slice(1), other.questions[0]!] };
  expect(() => rebindEvolutionBasePlan({ base: parent, dataset: swapped, retrievalSourceSha256: h("x") })).toThrow("questions differ");
  const rebased = structuredClone(shardProjected) as { questions: { corpusId: string }[] }; rebased.questions[0]!.corpusId = shardProjected.questions[1]!.corpusId;
  expect(() => rebindEvolutionBasePlan({ base: parent, dataset: rebased as typeof shardProjected, retrievalSourceSha256: h("x") })).toThrow("questions differ");
  // A parent whose case order was permuted still rebinds to the canonical layout with the same results.
  const permuted = structuredClone(parent) as any; permuted.cases.reverse(); reseal(permuted);
  expect(rebindEvolutionBasePlan({ base: permuted, dataset: shardProjected, retrievalSourceSha256: h("x") }).cases.map(key)).toEqual(rebound.cases.map(key));
});

test("reader plan V2 carries an indexed repeat per case, dedupes physical requests and reserves the select stage", () => {
  const s = source(), f = v9(s, { readers: [mini, nano] }), c = v9Contexts(s, f);
  const plan = makeEvolutionReaderPlanV2(c.plan, [mini, nano], 2);
  expect(plan.protocol).toBe(EVOLUTION_READER_PLAN_V2_PROTOCOL); expect(plan.stages).toEqual(["answer"]);
  expect(plan.cases).toHaveLength(100 * 2 * 2 * 2); expect(plan.requests).toHaveLength(100 * 2 * 2);
  expect(plan.cases.every(x => x.stage === "answer" && (x.repeat === 0 || x.repeat === 1))).toBe(true);
  expect(evolutionReaderJobsV2(plan)).toHaveLength(plan.requests.length * 2);
  expect(new Set(evolutionReaderJobsV2(plan).map(j => j.key)).size).toBe(plan.requests.length * 2);
  expect(plan.requests.map(r => r.body.messages)).toEqual(makeEvolutionReaderPlan(c.basePlan, [mini, nano]).requests.map(r => r.body.messages));
  expect(validateEvolutionReaderPlanV2(plan, c.plan)).toEqual(plan);
  expect(() => validateEvolutionReaderPlanV2(makeEvolutionReaderPlanV2(c.plan, [mini, nano], 1), c.plan)).not.toThrow();
  expect(() => validateEvolutionReaderPlanV2(plan, v9Contexts(s, f, "shard-002").plan)).toThrow("differs");
  for (const mutate of [(x: any) => x.cases[0].repeat = 2, (x: any) => x.stages = ["select", "answer"], (x: any) => x.cases[0].stage = "select", (x: any) => x.repeats = 3, (x: any) => x.cases.pop()]) {
    const bad = structuredClone(plan) as any; mutate(bad); reseal(bad); expect(() => validateEvolutionReaderPlanV2(bad, c.plan)).toThrow();
  }
  expect(() => makeEvolutionReaderPlanV2(c.plan, [mini], 4)).toThrow("repeats");
  expect(() => evolutionPhysicalJobs(plan.requests, [{ requestSha256: plan.requests[0]!.requestSha256, repeat: 3 }])).toThrow("repeat");
  expect(evolutionJobKey("a".repeat(64), 1)).toBe(`${"a".repeat(64)}#1`);
  const dated = v9(s, { readerDatePolicy: "final-session-date" }), dc = v9Contexts(s, dated);
  const datedPlan = makeEvolutionReaderPlanV2(dc.plan, [mini], 1);
  expect(datedPlan.requests[0]!.body.messages[1]!.content).toContain('"questionDate":"2026-01-02"'); expect(plan.requests[0]!.body.messages[1]!.content).toContain('"questionDate":"2026-01-09"');
});

async function reportFixture(s: Source, f: ReturnType<typeof v9>, shardId = "shard-001") {
  const c = v9Contexts(s, f, shardId), readerPlan = makeEvolutionReaderPlanV2(c.plan, f.study.readers, f.study.repeats), captures = new Map<string, Uint8Array>();
  const jobs = evolutionReaderJobsV2(readerPlan), failedJob = jobs[1]!;
  const failure: EvolutionAttemptFailure = { requestSha256: failedJob.request.requestSha256, profileSha256: failedJob.request.profileSha256, repeat: failedJob.repeat,
    storeStatus: "captured", reason: "unverifiable-first-response", rawSha256: sha256Hex(""), rawBytes: 0, transport: { httpStatus: null, complete: false, receivedBytes: 0, error: "network" },
    serviceMs: 120000, reservationMicros: failedJob.request.reservationMicros };
  const failures = new Map([[failedJob.key, failure]]);
  const responses = new Map<string, EvolutionResponse>(), rows: { requestSha256: string; repeat: number; response: EvolutionResponse }[] = [];
  const variantOf = new Map(readerPlan.cases.map(x => [x.requestSha256, x.variantId]));
  for (const job of jobs) {
    if (job.key === failedJob.key) continue;
    // Answers differ per arm and per repeat, so every judge request is distinct and the judge can split the control arm's first repeat.
    const answer = `PRIVATE_PREDICTION_SENTINEL ${variantOf.get(job.request.requestSha256)} ${job.repeat}`, body = raw(job.request, answer), response = parseEvolutionResponse(body, job.request);
    captures.set(job.key, body); responses.set(job.key, response); rows.push({ requestSha256: job.request.requestSha256, repeat: job.repeat, response });
  }
  const readerOutputBytes = phase("reader", readerPlan.planSha256, rows, [failure]);
  const judgePlan = makeEvolutionJudgePlanV9({ contextPlan: c.plan, readerPlan, responses, failures, dataset: c.dataset, profile: f.study.judge,
    rubric: await loadEvolutionJudgeRubricV9(f.study.judge), judgeRepeats: f.study.judgeRepeats, readerOutputSha256: sha256Hex(readerOutputBytes) });
  const judgeJobs = evolutionJudgeJobsV9(judgePlan), judgeRows: { requestSha256: string; repeat: number; response: EvolutionResponse }[] = [], judgeResponses = new Map<string, EvolutionResponse>();
  const reservedJob = judgeJobs[0]!, judgeFailure: EvolutionAttemptFailure = { requestSha256: reservedJob.request.requestSha256, profileSha256: reservedJob.request.profileSha256, repeat: reservedJob.repeat,
    storeStatus: "reserved", reason: "dispatch-outcome-unknown", rawSha256: null, rawBytes: null, transport: null, serviceMs: null, reservationMicros: reservedJob.request.reservationMicros };
  failures.set(reservedJob.key, judgeFailure);
  for (const job of judgeJobs) {
    if (job.key === reservedJob.key) continue;
    // Judge repeat 1 disagrees with judge repeat 0 on the control arm's first repeat, so per-cell and mean scores differ.
    const disagree = job.repeat === 1 && job.request.body.messages[0]!.content.includes(`PRIVATE_PREDICTION_SENTINEL ${control.id} 0`);
    const body = raw(job.request, disagree ? "no" : "yes"), response = parseEvolutionResponse(body, job.request);
    captures.set(job.key, body); judgeResponses.set(job.key, response); judgeRows.push({ requestSha256: job.request.requestSha256, repeat: job.repeat, response });
  }
  const judgeOutputBytes = phase("judge", judgePlan.planSha256, judgeRows, [judgeFailure]);
  const input = { dataset: c.dataset, manifestBytes: s.manifestBytes, manifestSha256: f.study.manifestPin.sha256, contextPlan: c.plan, readerPlan, judgePlan,
    readerOutputBytes, judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes),
    loadRawResponse: async (r: EvolutionRequest, _response: EvolutionResponse, repeat: number) => captures.get(evolutionJobKey(r.requestSha256, repeat))!,
    loadAttemptFailure: async (r: EvolutionRequest, repeat: number) => failures.get(evolutionJobKey(r.requestSha256, repeat))!,
    loadServiceMs: async (r: EvolutionRequest, _response: EvolutionResponse, repeat: number) => repeat + 1,
    study: { studyBytes: f.studyBytes, scopeBytes: f.scopeBytes, shardId, campaignSha256: h("canonical campaign") } };
  return { c, readerPlan, judgePlan, jobs, judgeJobs, input, responses, failures, readerOutputBytes };
}

test("judge plan V9 keys cases by reader and judge repeat, and phase V2 receipts require complete (request, repeat) coverage", async () => {
  const s = source(), f = v9(s), r = await reportFixture(s, f);
  expect(r.judgePlan.protocol).toBe(EVOLUTION_JUDGE_PLAN_V9_PROTOCOL); expect(r.judgePlan.judgeRepeats).toBe(2);
  expect(r.judgePlan.cases).toHaveLength(r.readerPlan.cases.length * 2); expect(r.judgePlan.cases.filter(x => x.readerFailed)).toHaveLength(2);
  expect(r.judgePlan.requests).toHaveLength(r.jobs.length - 1); expect(r.judgeJobs).toHaveLength(r.judgePlan.requests.length * 2);
  expect(r.judgePlan.scoringRule).toBe("native-contains-yes"); expect(r.judgePlan.requests.every(x => x.body.messages.length === 1)).toBe(true);
  expect(validateEvolutionJudgePlanV9(r.judgePlan)).toEqual(r.judgePlan);
  for (const mutate of [(x: any) => x.judgeRepeats = 3, (x: any) => x.cases[0].judgeRepeat = 2, (x: any) => x.cases[0].stage = "select", (x: any) => x.profile = "gpt4o-mini-locomo-j-judge-v1",
    (x: any) => x.scoringRule = "strict-yes-no", (x: any) => x.cases.pop(), (x: any) => { x.cases[0].readerFailed = true; x.cases[0].requestSha256 = null; }]) {
    const bad = structuredClone(r.judgePlan) as any; mutate(bad); reseal(bad); expect(() => validateEvolutionJudgePlanV9(bad)).toThrow();
  }
  const incomplete = new Map(r.responses); incomplete.delete(r.jobs[0]!.key); const rubric = await loadEvolutionJudgeRubricV9(f.study.judge);
  expect(() => makeEvolutionJudgePlanV9({ contextPlan: r.c.plan, readerPlan: r.readerPlan, responses: incomplete, failures: r.failures, dataset: r.c.dataset, profile: f.study.judge,
    rubric, judgeRepeats: 2, readerOutputSha256: h("x") })).toThrow(/missing|Coverage/);
  const receipt = JSON.parse(new TextDecoder().decode(r.readerOutputBytes));
  const parsed = evolutionPhaseAttemptsV9(receipt, "reader", r.readerPlan.planSha256, r.jobs);
  expect(parsed.responses.size).toBe(r.jobs.length - 1); expect(parsed.failures.size).toBe(1); expect(parsed.wallMs).toBe(12);
  for (const mutate of [(x: any) => x.responses.pop(), (x: any) => x.responses[0].repeat = 2, (x: any) => x.failures[0].repeat = 0, (x: any) => x.protocol = "oh.memory.evolution-phase.v1",
    (x: any) => x.responses.push(x.responses[0]), (x: any) => x.complete = false]) {
    const bad = structuredClone(receipt); mutate(bad); expect(() => evolutionPhaseAttemptsV9(bad, "reader", r.readerPlan.planSha256, r.jobs)).toThrow();
  }
});

test("V9 shard reports average judge decisions over repeats per question, keep every cell, attribute cost per (request, repeat) job and publish no text", async () => {
  const s = source(), f = v9(s), r = await reportFixture(s, f), report = await buildEvolutionReportV9(r.input);
  expect(report.protocol).toBe(EVOLUTION_REPORT_V9_PROTOCOL); expect(report.dataset.partition).toBe("explicit-selection-descriptive");
  expect(report.coverage).toMatchObject({ logicalReaderCases: 400, logicalJudgeCases: 800, expectedQuestionsPerArm: 100, repeats: 2, judgeRepeats: 2,
    physicalReaderJobs: 400, capturedUnverifiableAttempts: 1, unknownDispatches: 1, completeAttemptCoverage: true, completePhysicalResponses: false });
  expect(report.study.outcomes).toHaveLength(400); expect(report.study.physical).toHaveLength(r.jobs.length + r.judgeJobs.length);
  expect(report.study.physical.filter(p => p.repeat === 1)).toHaveLength((r.jobs.length + r.judgeJobs.length) / 2);
  expect(report.study.outcomes.filter(o => o.readerFailed)).toHaveLength(1);
  const failed = report.study.outcomes.find(o => o.readerFailed)!; expect(failed.decisions).toEqual([null, null]); expect(failed.judgeMean).toBe(0);
  const controlArm = report.arms.find(a => a.variantId === control.id)!, candidateArm = report.arms.find(a => a.variantId === candidate.id)!;
  // Control repeat 0 is judged yes/no across the two judge repeats: its cells split while the candidate stays unanimous except for failures.
  expect(controlArm.byCell.map(cell => cell.overall.mean)).toEqual([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)]);
  expect(controlArm.byCell.find(cell => cell.repeat === 0 && cell.judgeRepeat === 1)!.overall.mean).toBeLessThan(controlArm.byCell.find(cell => cell.repeat === 0 && cell.judgeRepeat === 0)!.overall.mean!);
  expect(candidateArm.metrics.find(m => m.metric === "judge-mean")!.overall.mean).toBeGreaterThan(controlArm.metrics.find(m => m.metric === "judge-mean")!.overall.mean!);
  // The reserved judge job and the failed reader both fall on the control arm's first question, whose four cells all score zero.
  expect(candidateArm.repeatAgreement.unanimous).toBe(100); expect(controlArm.repeatAgreement.unanimous).toBe(1);
  expect(controlArm.metrics.find(m => m.metric === "judge-mean")!.overall.mean).toBeCloseTo(297 / 400, 12);
  expect(candidateArm.metrics.find(m => m.metric === "judge-mean")!.overall.mean).toBe(1);
  expect(report.arms.every(a => a.metrics.find(m => m.metric === "evidence-recall")!.overall.mean === (a.variantId === candidate.id ? 1 : 0))).toBe(true);
  const comparison = report.comparisons[0]!;
  expect(comparison).toMatchObject({ kind: "retrieval", left: { variantId: candidate.id, reader: mini }, right: { variantId: control.id, reader: mini } });
  expect(comparison.metrics.find(m => m.metric === "judge-mean")!.paired.wins).toBeGreaterThan(0); expect(comparison.byCell).toHaveLength(4);
  expect(report.cost.unresolvedReservationMicros).toBe([...r.failures.values()].reduce((sum, x) => sum + x.reservationMicros, 0));
  expect(report.latency.reader.physical.p95Ms).toBe(2); expect(report.design).toMatchObject({ repeats: 2, judgeRepeats: 2, readerDatePolicy: "question-date", derivedRecordsPinSha256: null, stages: ["answer"] });
  expect(report.scoring.officialLocomoF1).toBeNull(); expect(report.scoring.failurePolicy).toContain("judge repeat");
  const encoded = JSON.stringify(report);
  for (const secret of ["PRIVATE_GOLD_SENTINEL", "PRIVATE_PREDICTION_SENTINEL", "Synthetic memory", "Where is synthetic"]) expect(encoded).not.toContain(secret);
  const missing = JSON.parse(new TextDecoder().decode(r.input.readerOutputBytes)); missing.responses.pop();
  await expect(buildEvolutionReportV9({ ...r.input, readerOutputBytes: bytes(missing) })).rejects.toThrow();
  await expect(buildEvolutionReportV9({ ...r.input, study: { ...r.input.study, shardId: "shard-002" } })).rejects.toThrow();
  await expect(buildEvolutionReportV9({ ...r.input, readerPlan: makeEvolutionReaderPlanV2(r.c.plan, [mini], 1) })).rejects.toThrow();
});

test("the V9 reducer combines every shard into aggregate-only means, per-cell accuracies and deduplicated cost; the CLI writes scope and combine offline", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "oh-v9-")), s = source(root), pinned = v9(s, { repeats: 1, judgeRepeats: 2, retrievalSourceSha256: await retrievalIdentity() });
  try {
    await writeFile(pinned.config().studyPin.path, pinned.studyBytes); await writeFile(pinned.config().manifestPin.path, s.manifestBytes);
    const scopeOutput = join(root, "scope-output.json"), scoped = await prepareEvolutionReleaseScope(pinned.config().studyPin, scopeOutput);
    expect(scoped.modelCalls).toBe(0); expect(h(await Bun.file(scopeOutput).json())).toBe(h(pinned.scope));
    await writeFile(pinned.config().scopePin.path, pinned.scopeBytes);
    const config = parseEvolutionRunConfig(pinned.config()); expect(config.protocol).toBe(EVOLUTION_RUN_V9_PROTOCOL);
    expect(await loadEvolutionStudyV9Authorization(config as any)).toEqual(pinned.authorization);
    await expect(loadEvolutionStudyV9Authorization({ ...(config as any), repeats: 2 })).rejects.toThrow("configuration");
    const reportPins: { path: string; sha256: string }[] = [], accounted: number[] = [];
    for (const shard of pinned.scope.shards) {
      const fixture = await reportFixture(s, pinned, shard.id), report = await buildEvolutionReportV9(fixture.input), rawReport = bytes(report);
      const pin = { path: join(root, shard.id + ".json"), sha256: sha256Hex(rawReport) }; await writeFile(pin.path, rawReport); reportPins.push(pin); accounted.push(report.cost.accountedMicros);
    }
    const reports = await Promise.all(reportPins.map(async pin => ({ pin, report: await Bun.file(pin.path).json() })));
    const summary = buildEvolutionStudyV9Report({ authorization: pinned.authorization, reports });
    expect(summary.scope.selectedQuestions).toBe(500); expect(summary.arms).toHaveLength(2); expect(summary.arms[0]!.metrics[0]!.overall.cases).toBe(500);
    expect(summary.arms[0]!.byCell).toHaveLength(2); expect(summary.comparisons[0]!.byCell).toHaveLength(2);
    expect(summary.comparisons[0]!.metrics.find(m => m.metric === "judge-mean")!.byExposureStratum).toHaveLength(2);
    expect(summary.cost.accountedMicros).toBe(accounted.reduce((a, b) => a + b, 0)); expect(summary.cost.unknownDispatches).toBe(5);
    expect(() => buildEvolutionStudyV9Report({ authorization: pinned.authorization, reports: reports.slice(1) })).toThrow("every shard");
    const tampered = structuredClone(reports) as any; tampered[0].report.study.outcomes[0].judgeMean = 0.5;
    expect(() => buildEvolutionStudyV9Report({ authorization: pinned.authorization, reports: tampered })).toThrow("judge mean");
    const combine = { protocol: EVOLUTION_STUDY_V9_COMBINE_PROTOCOL, studyPin: pinned.config().studyPin, scopePin: pinned.config().scopePin, reportPins }, rawCombine = bytes(combine);
    const inputPin = { path: join(root, "combine.json"), sha256: sha256Hex(rawCombine) }, output = join(root, "public.json"); await writeFile(inputPin.path, rawCombine);
    expect((await combineEvolutionRelease(inputPin, output)).modelCalls).toBe(0);
    const published = await Bun.file(output).json(), encoded = JSON.stringify(published);
    expect(published.summarySha256).toBe(summary.summarySha256); expect(encoded).not.toContain(root); expect(encoded).not.toContain(pinned.scope.questions[0]!.id);
    for (const secret of ["PRIVATE_GOLD_SENTINEL", "PRIVATE_PREDICTION_SENTINEL", "Synthetic memory"]) expect(encoded).not.toContain(secret);
    await expect(combineEvolutionRelease(inputPin, output)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);

test("paid V9 jobs are admitted once per (request, repeat) in the exclusive campaign store and reused on replay", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-v9-store-")));
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "v9-jobs-test", storeDirectory: directory, approval: "Test fixture only",
    additionalBudgetMicros: 100_000, maximumCalls: 10, historicalExposureMicros: 0, historicalLedgers: [{ path: "/tmp/fixture-ledger", sha256: "a".repeat(64), bytes: 0 }],
    authAuthority: { path: "/tmp/fixture-auth", sha256: "b".repeat(64) } };
  const request = makeEvolutionRequest("gpt4o-official-snapshot-judge", [{ role: "user", content: "Is the answer correct?" }]);
  const other = makeEvolutionRequest("gpt4o-official-snapshot-judge", [{ role: "user", content: "Is the other answer correct?" }]);
  const body = () => new TextEncoder().encode(JSON.stringify({ model: "gpt-4o-2024-08-06", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "yes" } }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }));
  const jobs = evolutionPhysicalJobs([request, other], [{ requestSha256: request.requestSha256, repeat: 0 }, { requestSha256: request.requestSha256, repeat: 1 },
    { requestSha256: other.requestSha256, repeat: 0 }, { requestSha256: request.requestSha256, repeat: 0 }]);
  expect(jobs).toHaveLength(3);
  const credential = { kind: "benchmark-openai-key" as const, token: "fixture-never-sent" };
  let store = await openEvolutionStore({ directory, campaign }), calls = 0;
  try {
    const first = await runEvolutionJobsV9({ store, jobs, credential, concurrency: 24, maxNewCalls: 2, fetcher: async () => { calls++; return new Response(body()); } });
    expect(calls).toBe(2); expect(first.responses.size).toBe(2); expect(first.failures.size).toBe(0); expect(first.admissionAttempts).toBe(2);
    expect(store.lookup(request, 0).kind).toBe("hit"); expect(store.lookup(request, 1).kind).toBe("hit"); expect(store.lookup(other, 0).kind).toBe("miss");
    const second = await runEvolutionJobsV9({ store, jobs, credential, concurrency: 24, maxNewCalls: 20, fetcher: async () => { calls++; return new Response(body()); } });
    expect(calls).toBe(3); expect(second.responses.size).toBe(3); expect(second.admissionAttempts).toBe(1);
    expect(store.summary()).toMatchObject({ calls: 3, unresolvedMicros: 0 });
  } finally { await store.close(); }
  store = await openEvolutionStore({ directory, campaign });
  try {
    const replay = await runEvolutionJobsV9({ store, jobs, credential, concurrency: 24, maxNewCalls: 0, fetcher: async () => { throw new Error("No network permitted"); } });
    expect(replay.responses.size).toBe(3); expect(replay.admissionAttempts).toBe(0);
    await expect(runEvolutionJobsV9({ store, jobs: [...jobs, jobs[0]!], credential, concurrency: 24, maxNewCalls: 0 })).rejects.toThrow("duplicate");
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
