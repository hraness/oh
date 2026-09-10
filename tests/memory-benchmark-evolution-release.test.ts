import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { OH_EMBEDDING_PROFILE_V1 } from "../src/semantic";
import { DATASETS, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { createEvolutionFullHistorySource } from "../scripts/benchmarks/evolution-full-history";
import { renderTurn } from "../scripts/benchmarks/retrieval";
import { EVOLUTION_RELEASE_READER, EVOLUTION_RELEASE_READERS, EVOLUTION_RELEASE_JUDGE, EVOLUTION_RELEASE_RUBRIC_SHA, makeEvolutionReleaseScope,
  validateEvolutionReleaseArtifacts, selectEvolutionReleaseShard, parseEvolutionReleaseStudy, type EvolutionReleaseStudy } from "../scripts/benchmarks/evolution-release";
import { makeEvolutionReleaseContextPlan, evolutionReleaseContextBinding, assertEvolutionReleaseContextBinding, rebindEvolutionReleaseContextPlan } from "../scripts/benchmarks/evolution-release-plan";
import { makeEvolutionReaderPlan, validateEvolutionAnyContextPlan, validateEvolutionContextPlanSources, type EvolutionContextPlan } from "../scripts/benchmarks/evolution-plan";
import { loadEvolutionReleaseAuthorization, parseEvolutionRunConfig, parseEvolutionArgs, validateEvolutionContextRunVersion, retrievalIdentity, type EvolutionReleaseRunConfig } from "../scripts/benchmarks/evolution";
import { makeEvolutionJudgePlan } from "../scripts/benchmarks/evolution-judge";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import type { EvolutionAttemptFailure } from "../scripts/benchmarks/evolution-store";
import { parseEvolutionReleaseArgs, prepareEvolutionReleaseScope, combineEvolutionRelease } from "../scripts/benchmarks/evolution-release-cli";
import { buildEvolutionReport, buildEvolutionReleaseShardReport } from "../scripts/benchmarks/evolution-report";

const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No provider or network in release fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });
const bytes = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
const h = canonicalSha256;
const variants = [{ id: "window-96k", system: "bm25-window", budget: { topK: 100, contextBytes: 96_000 } },
  { id: "semantic-96k", system: "oh-semantic", budget: { topK: 100, contextBytes: 96_000 } }] as const;
function fixture(root = "/example/full-release") {
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
function contexts(f = fixture(), shardId = "shard-001") {
  const dataset = selectEvolutionReleaseShard(f.dataset, f.manifest, f.authorization, shardId), projected = projectEvolutionRunnerInput(dataset);
  const corpora = new Map(projected.corpora.map(c => [c.id, c]));
  const cases = projected.questions.flatMap(q => variants.map(v => {
    const source = { ...corpora.get(q.corpusId)!, groupId: q.corpusId }, full = createEvolutionFullHistorySource(source), n = v.system === "oh-semantic" ? 0 : 1;
    const { preparedSha256: _old, ...identity } = full.identity;
    const preparedSha256 = h({ ...identity, semanticProfileSha256: v.system === "oh-semantic" ? h(OH_EMBEDDING_PROFILE_V1) : null });
    const context = renderTurn(source.turns[n]!), payload = { protocol: "oh.evolution-retrieval.v1" as const, preparedSha256,
      variantSha256: h(v), querySha256: sha256Hex(q.question), context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context),
      turnIds: [source.turns[n]!.id], sessionIds: [source.turns[n]!.sessionId], sources: [full.result.sources[n]!],
      omittedForBudget: 0, facets: [], coveredFacets: [], coverageKind: null };
    return { questionId: q.id, variantId: v.id, result: { ...payload, resultSha256: h(payload) } };
  }));
  const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: f.study.manifestPin.sha256,
    retrievalSourceSha256: f.study.retrievalSourceSha256, inputSha256: h(projected), variants, questions: projected.questions, cases };
  const basePlan: EvolutionContextPlan = { ...payload, planSha256: h(payload) };
  const plan = makeEvolutionReleaseContextPlan({ dataset: projected, basePlan, binding: evolutionReleaseContextBinding(f.authorization, shardId) });
  return { dataset, projected, basePlan, plan };
}
function reseal(v: any, key = "planSha256") { const { [key]: _old, ...payload } = v; v[key] = h(payload); return v; }

test("full release keeps500 exact IDs and closed/unknown exposure in five fixed paired shards", () => {
  const f = fixture();
  expect(f.scope.coverage).toMatchObject({ releaseQuestions: 500, selectedQuestions: 500, logicalReaderCases: 1000 });
  expect(f.scope.shards.map(s => s.questionIds.length)).toEqual([100, 100, 100, 100, 100]);
  expect(f.scope.strata).toContainEqual({ partition: "closed", exposure: "unknown", questions: 400, groups: 400 });
  const selected = f.scope.shards.flatMap(s => selectEvolutionReleaseShard(f.dataset, f.manifest, f.authorization, s.id).questions.map(q => q.id));
  expect(new Set(selected).size).toBe(500); expect(selected.sort()).toEqual(f.dataset.questions.map(q => q.id).sort());
  expect(JSON.stringify(f.scope)).not.toContain("PRIVATE_GOLD_SENTINEL"); expect(JSON.stringify(f.scope)).not.toContain("Synthetic memory");
  for (const mutate of [(s: any) => s.candidatePresentation = "source-order", (s: any) => s.reader = "gpt5-mini-reader",
    (s: any) => s.variants.reverse(), (s: any) => s.variants[1].budget.contextBytes = 192000,
    (s: any) => s.rubricSha256 = h("other"), (s: any) => s.answer = "gold", (s: any) => s.datasetPin.sha256 = h("other")]) {
    const bad = structuredClone(f.study); mutate(bad); expect(() => parseEvolutionReleaseStudy(bad)).toThrow();
  }
  const bad = structuredClone(f.scope) as any; bad.questions[100].exposure = "unseen"; reseal(bad, "scopeSha256");
  expect(() => validateEvolutionReleaseArtifacts({ ...f, scopeBytes: bytes(bad) })).toThrow();
});

test("V7 wraps exact old retrieval/request bytes and source-only projection without reinterpreting legacy wires", () => {
  const f = fixture(), c = contexts(f), config = parseEvolutionRunConfig(f.config);
  expect(h(config)).toBe(h(f.config)); expect(() => validateEvolutionContextRunVersion(c.plan, config)).not.toThrow();
  expect(validateEvolutionAnyContextPlan(c.plan)).toEqual(c.plan); expect(() => validateEvolutionContextPlanSources(c.plan, c.projected)).not.toThrow();
  expect(makeEvolutionReaderPlan(c.plan, [EVOLUTION_RELEASE_READER]).requests).toEqual(makeEvolutionReaderPlan(c.basePlan, [EVOLUTION_RELEASE_READER]).requests);
  expect(JSON.stringify(c.plan)).not.toContain("PRIVATE_GOLD_SENTINEL");
  const guarded = structuredClone(c.dataset);
  for (const row of [...guarded.corpora, ...guarded.corpora.flatMap(c => c.turns), ...guarded.questions])
    Object.defineProperty(row, "answer", { enumerable: true, get() { throw Error("gold getter reached"); } });
  // Caller must use the gold-free public projection, which never enumerates unsupported fields.
  expect(projectEvolutionRunnerInput(guarded)).toEqual(c.projected);
  for (const protocol of ["oh.memory.evolution-run.v1", "oh.memory.evolution-run.v4", "oh.memory.evolution-run.v5", "oh.memory.evolution-run.v6"] as const)
    expect(() => validateEvolutionContextRunVersion(c.plan, { protocol })).toThrow();
  for (const mutate of [(x: any) => x.studySha256 = h("other"), (x: any) => x.shardId = "shard-002", (x: any) => x.cases.pop(),
    (x: any) => x.questions.reverse(), (x: any) => x.cases[0].result.context = "invented", (x: any) => x.cases[0].answer = "gold"]) {
    const bad = structuredClone(c.plan); mutate(bad); reseal(bad); expect(() => assertEvolutionReleaseContextBinding(bad, f.authorization, "shard-001")).toThrow();
  }
  const changed = structuredClone(c.projected); (changed.corpora[0]!.turns[1] as { text: string }).text += " changed";
  expect(() => validateEvolutionContextPlanSources(c.plan, changed)).toThrow();
});

test("every scope reload pins study, manifest and scope; config cannot alter matrix or reclassify an old run", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "oh-release-")), f = fixture(root);
  try {
    await writeFile(f.config.studyPin.path, f.studyBytes); await writeFile(f.config.scopePin.path, f.scopeBytes); await writeFile(f.config.manifestPin.path, f.manifestBytes);
    const config = parseEvolutionRunConfig(f.config) as EvolutionReleaseRunConfig;
    expect(await loadEvolutionReleaseAuthorization(config)).toEqual(f.authorization);
    for (const mutate of [(x: any) => x.protocol = "oh.memory.evolution-run.v4", (x: any) => x.shardId = "shard-006",
      (x: any) => x.limit = 500, (x: any) => x.seed = 18, (x: any) => x.readers = ["gpt5-mini-reader"], (x: any) => x.concurrency = 12,
      (x: any) => x.studyPin.path = x.directory + "/study.json", (x: any) => x.semanticCacheDirectory = x.storeDirectory]) {
      const bad = structuredClone(f.config); mutate(bad); expect(() => parseEvolutionRunConfig(bad)).toThrow();
    }
    await expect(loadEvolutionReleaseAuthorization({ ...config, campaignPin: { ...config.campaignPin, sha256: h("other") } })).rejects.toThrow("configuration");
    await writeFile(f.config.studyPin.path, bytes({ ...f.study, retrievalSourceSha256: h("changed") }));
    await expect(loadEvolutionReleaseAuthorization(config)).rejects.toThrow("pinned content changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function reportFixture(f = fixture(), shardId = "shard-001") {
  const c = contexts(f, shardId), readerPlan = makeEvolutionReaderPlan(c.plan, [EVOLUTION_RELEASE_READER]), captures = new Map<string, Uint8Array>();
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
    release: { studyBytes: f.studyBytes, scopeBytes: f.scopeBytes, shardId, campaignSha256: h("canonical campaign") } };
  return { f, c, input, readerResponses, failures };
}

test("native16 generic paid/report contracts retain all200 cases, raw-authenticated failures, unknown usage and separate evidence scores", async () => {
  const f = await reportFixture(), report = await buildEvolutionReleaseShardReport(f.input);
  expect(report.protocol).toBe("oh.memory.evolution-report.v2"); expect(report.dataset.partition).toBe("full-release-descriptive");
  expect(report.coverage).toMatchObject({ logicalReaderCases: 200, logicalJudgeCases: 200, expectedQuestionsPerArm: 100, completeAttemptCoverage: true,
    capturedUnverifiableAttempts: 1, unknownDispatches: 1 });
  expect(report.release.outcomes).toHaveLength(200); expect(report.release.outcomes.filter(o => o.readerFailed)).toHaveLength(1);
  expect(report.release.outcomes.filter(o => o.judgeFailed).length).toBeGreaterThanOrEqual(1);
  for (const o of report.release.outcomes.filter(o => o.readerFailed || o.judgeFailed)) expect(o.scores["judge-accuracy"]).toBe(0);
  expect(report.cost.unresolvedReservationMicros).toBe([...f.failures.values()].reduce((s, r) => s + r.reservationMicros, 0));
  expect(report.release.physical.find(r => r.status === "reserved")).toMatchObject({ knownUsageMicros: null, serviceMs: null });
  expect(report.arms.find(a => a.variantId === variants[1].id)!.metrics.find(m => m.metric === "evidence-recall")!.overall.mean).toBe(1);
  const encoded = JSON.stringify(report); expect(encoded).not.toContain("PRIVATE_GOLD_SENTINEL"); expect(encoded).not.toContain("PRIVATE_PREDICTION_SENTINEL"); expect(encoded).not.toContain("Synthetic memory");
  await expect(buildEvolutionReport(f.input)).rejects.toThrow("only development");
  const missing = JSON.parse(new TextDecoder().decode(f.input.readerOutputBytes)); missing.responses.pop();
  await expect(buildEvolutionReleaseShardReport({ ...f.input, readerOutputBytes: bytes(missing) })).rejects.toThrow();
  await expect(buildEvolutionReleaseShardReport({ ...f.input, release: { ...f.input.release, shardId: "shard-002" } })).rejects.toThrow();
});


test("offline scope CLI authenticates current source and metadata without opening an absent dataset, uses exclusive outputs and strict flags", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "oh-release-cli-")), f = fixture(root), output = join(root, "scope-output.json");
  try {
    const studyBytes = bytes({ ...f.study, retrievalSourceSha256: await retrievalIdentity() }), studyPin = { ...f.config.studyPin, sha256: sha256Hex(studyBytes) };
    await writeFile(studyPin.path, studyBytes); await writeFile(f.config.manifestPin.path, f.manifestBytes);
    const argv = ["scope", "--study", studyPin.path, "--study-sha256", studyPin.sha256, "--output", output];
    expect(parseEvolutionReleaseArgs(argv)).toEqual({ command: "scope", pin: studyPin, output });
    for (const bad of [argv.slice(0, -1), [...argv, "--unexpected", "true"], [...argv, "--output", output], ["scope", "--study", "relative"]])
      expect(() => parseEvolutionReleaseArgs(bad)).toThrow();
    const result = await prepareEvolutionReleaseScope(studyPin, output);
    expect(result.modelCalls).toBe(0); expect((await Bun.file(output).json()).coverage.selectedQuestions).toBe(500);
    expect(await Bun.file(f.study.datasetPin.path).exists()).toBe(false);
    await expect(prepareEvolutionReleaseScope(studyPin, output)).rejects.toThrow();
    await expect(prepareEvolutionReleaseScope({ ...studyPin, sha256: h("changed") }, join(root, "other.json"))).rejects.toThrow("pinned content changed");
  } finally { await rm(root, { recursive: true, force: true }); }
});


test("offline combine consumes five actual synthetic native16 shard reports and publishes only full500 aggregates", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "oh-release-combine-")), f = fixture(root);
  try {
    await writeFile(f.config.studyPin.path, f.studyBytes); await writeFile(f.config.scopePin.path, f.scopeBytes); await writeFile(f.config.manifestPin.path, f.manifestBytes);
    const reportPins: { path: string; sha256: string }[] = [], accounted: number[] = [];
    for (const shard of f.scope.shards) {
      const input = await reportFixture(f, shard.id), report = await buildEvolutionReleaseShardReport(input.input), raw = bytes(report);
      const pin = { path: join(root, shard.id + ".json"), sha256: sha256Hex(raw) }; await writeFile(pin.path, raw); reportPins.push(pin); accounted.push(report.cost.accountedMicros);
    }
    const combine = { protocol: "oh.memory.evolution-release-combine.v1", studyPin: f.config.studyPin, scopePin: f.config.scopePin, reportPins }, raw = bytes(combine);
    const inputPin = { path: join(root, "combine.json"), sha256: sha256Hex(raw) }, output = join(root, "public.json"); await writeFile(inputPin.path, raw);
    expect((await combineEvolutionRelease(inputPin, output)).modelCalls).toBe(0);
    const summary = await Bun.file(output).json(), encoded = JSON.stringify(summary);
    expect(summary.scope.selectedQuestions).toBe(500); expect(summary.scope.logicalReaderCases).toBe(1000);
    expect(summary.cost.accountedMicros).toBe(accounted.reduce((a, b) => a + b, 0)); expect(summary.cost.unknownDispatches).toBe(5);
    expect(summary.arms.every((a: any) => a.metrics[0].overall.cases === 500)).toBe(true);
    expect(encoded).not.toContain(root); expect(encoded).not.toContain(f.scope.questions[0]!.id);
    expect(encoded).not.toContain("PRIVATE_GOLD_SENTINEL"); expect(encoded).not.toContain("PRIVATE_PREDICTION_SENTINEL");
    await expect(combineEvolutionRelease(inputPin, output)).rejects.toThrow();
    await writeFile(reportPins[0]!.path, "{}"); await expect(combineEvolutionRelease(inputPin, join(root, "changed.json"))).rejects.toThrow("pinned content changed");
  } finally { await rm(root, { recursive: true, force: true }); }
// Five authenticated 200-case reports exceed Bun's default 5s on CI runners.
}, 20_000);

test("a rebound study reuses exact parent retrieval under a declared reader/campaign change and nothing else", () => {
  const f = fixture(), parent = contexts(f), mini = EVOLUTION_RELEASE_READERS[1], current = h("current retrieval source");
  const provenance = { parentStudySha256: sha256Hex(f.studyBytes), parentRetrievalSourceSha256: f.study.retrievalSourceSha256 };
  const child: EvolutionReleaseStudy = { ...f.study, reader: mini, retrievalSourceSha256: current, retrievalProvenance: provenance,
    campaignPin: { path: "/example/full-release/campaign-mini.json", sha256: h("campaign mini") } };
  const childBytes = bytes(child), childScope = makeEvolutionReleaseScope(childBytes, f.manifestBytes);
  const authorization = validateEvolutionReleaseArtifacts({ studyBytes: childBytes, manifestBytes: f.manifestBytes, scopeBytes: bytes(childScope) });
  expect(parseEvolutionReleaseStudy(child).reader).toBe(mini);
  expect(() => parseEvolutionReleaseStudy({ ...child, reader: "gpt5-mini-reader" })).toThrow();
  expect(() => parseEvolutionReleaseStudy({ ...child, retrievalProvenance: { parentStudySha256: "x" } })).toThrow();
  expect(authorization.scope.shards.map(s => s.questionIds)).toEqual(f.authorization.scope.shards.map(s => s.questionIds));
  const rebound = rebindEvolutionReleaseContextPlan({ dataset: parent.projected, parent: parent.plan, authorization, shardId: "shard-001", retrievalSourceSha256: current });
  expect(rebound.studySha256).toBe(sha256Hex(childBytes)); expect(rebound.scopeSha256).toBe(authorization.scope.scopeSha256);
  expect(rebound.retrievalSourceSha256).toBe(current); expect(rebound.basePlan.retrievalSourceSha256).toBe(current);
  expect(rebound.cases.map(c => c.result)).toEqual(parent.plan.cases.map(c => c.result));
  expect(() => assertEvolutionReleaseContextBinding(rebound, authorization, "shard-001")).not.toThrow();
  expect(() => assertEvolutionReleaseContextBinding(rebound, f.authorization, "shard-001")).toThrow("context differs");
  validateEvolutionContextPlanSources(rebound.basePlan, parent.projected);
  expect(makeEvolutionReaderPlan(rebound, [mini]).readerProfiles).toEqual([mini]);
  expect(makeEvolutionReaderPlan(rebound, [mini]).requests.every(r => r.profileId === mini)).toBe(true);
  const { retrievalProvenance: _provenance, ...plain } = child;
  const without = validateEvolutionReleaseArtifacts({ studyBytes: bytes(plain), manifestBytes: f.manifestBytes,
    scopeBytes: bytes(makeEvolutionReleaseScope(bytes(plain), f.manifestBytes)) });
  expect(() => rebindEvolutionReleaseContextPlan({ dataset: parent.projected, parent: parent.plan, authorization: without, shardId: "shard-001", retrievalSourceSha256: current })).toThrow("provenance");
  expect(() => rebindEvolutionReleaseContextPlan({ dataset: parent.projected, parent: parent.plan, authorization, shardId: "shard-002", retrievalSourceSha256: current })).toThrow("shard");
  expect(() => rebindEvolutionReleaseContextPlan({ dataset: parent.projected, parent: parent.plan, authorization, shardId: "shard-001", retrievalSourceSha256: h("other") })).toThrow("current retrieval source");
  expect(() => rebindEvolutionReleaseContextPlan({ dataset: parent.projected, parent: parent.plan, authorization: f.authorization, shardId: "shard-001", retrievalSourceSha256: f.study.retrievalSourceSha256 })).toThrow();
  const wrongParent = validateEvolutionReleaseArtifacts({ studyBytes: bytes({ ...child, retrievalProvenance: { ...provenance, parentStudySha256: h("other parent") } }), manifestBytes: f.manifestBytes,
    scopeBytes: bytes(makeEvolutionReleaseScope(bytes({ ...child, retrievalProvenance: { ...provenance, parentStudySha256: h("other parent") } }), f.manifestBytes)) });
  expect(() => rebindEvolutionReleaseContextPlan({ dataset: parent.projected, parent: parent.plan, authorization: wrongParent, shardId: "shard-001", retrievalSourceSha256: current })).toThrow("provenance");
  const tampered = structuredClone(parent.plan) as any; tampered.basePlan.cases[0].result.context = "changed"; reseal(tampered.basePlan.cases[0].result, "resultSha256"); reseal(tampered.basePlan); reseal(tampered);
  expect(() => rebindEvolutionReleaseContextPlan({ dataset: parent.projected, parent: tampered, authorization, shardId: "shard-001", retrievalSourceSha256: current })).toThrow();
  const config = parseEvolutionRunConfig({ ...f.config, readers: [mini], campaignPin: child.campaignPin, studyPin: { ...f.config.studyPin, sha256: sha256Hex(childBytes) } }) as EvolutionReleaseRunConfig;
  expect(config.readers).toEqual([mini]);
  expect(parseEvolutionArgs(["rebind", "--config", "/a/c.json", "--config-sha256", h("c"), "--context", "/a/x.json", "--context-sha256", h("x")]).command).toBe("rebind");
  expect(() => parseEvolutionArgs(["rebind", "--config", "/a/c.json", "--config-sha256", h("c")])).toThrow();
});
