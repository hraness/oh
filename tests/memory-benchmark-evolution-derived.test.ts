import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../src/graph";
import { makeOhObservationPromptV1, parseOhObservationRecordV1, parseOhObservationResponseV1, parseOhObservationSessionV1 } from "../src/observe";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import { DATASETS, type Corpus, type Dataset } from "../scripts/benchmarks/datasets";
import { parseEvolutionRunConfig, validateEvolutionContextRunVersion } from "../scripts/benchmarks/evolution";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput, type EvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { EVOLUTION_DERIVED_CORPORA_PROTOCOL, evolutionObserveRouterAudit, type EvolutionDerivedCorpora } from "../scripts/benchmarks/evolution-derived";
import { makeEvolutionRequest, parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { observeLaneCorpusSha256, observeLaneSessions, observeLaneTurnRecords, rebuildObserveLaneRecords,
  type ObserveLaneArtifactCorpus, type ObserveLaneArtifactSession } from "../scripts/benchmarks/evolution-observe-lane";
import { makeEvolutionReaderPlan, validateEvolutionContextPlanSources, validateEvolutionReaderPlan, type EvolutionContextPlan } from "../scripts/benchmarks/evolution-plan";
import { evolutionContextBindingV9, makeEvolutionContextPlanV9, validateEvolutionContextPlanV9Sources } from "../scripts/benchmarks/evolution-plan-v9";
import { evolutionReaderDatePolicySha256 } from "../scripts/benchmarks/evolution-reader-date-policy";
import { evolutionJobKey, evolutionReaderJobsV2, makeEvolutionReaderPlanV2, validateEvolutionReaderPlanV2 } from "../scripts/benchmarks/evolution-reader-plan-v2";
import { EVOLUTION_RELEASE_JUDGE, EVOLUTION_RELEASE_RUBRIC_SHA } from "../scripts/benchmarks/evolution-release";
import { EVOLUTION_DERIVED_SYSTEMS, prepareEvolutionCorpus, validateEvolutionContextSources,
  type EvolutionAnyRetrievalResult, type EvolutionDerivedRecords, type EvolutionRetrievalVariant } from "../scripts/benchmarks/evolution-retrieval";
import { parseEvolutionRunConfigV9, writeEvolutionObserveRouterAudit, validateEvolutionObserveRouterAudit } from "../scripts/benchmarks/evolution-runner-v9";
import { makeEvolutionStudyV9Scope, validateEvolutionStudyV9Artifacts, parseEvolutionStudyV9, parseEvolutionV9Variant, type EvolutionStudyV9 } from "../scripts/benchmarks/evolution-study-v9";
import { parseEvolutionExperimentVariant } from "../scripts/benchmarks/evolution-variants";

const h = canonicalSha256;
const corpus: Corpus = { id: "derived-corpus", groupId: "derived-corpus", turns: [
  { id: "t1", sessionId: "shared", sessionIndex: 0, date: "2025-01-01T12:00:00.000Z", speaker: "user", text: "I prefer quiet cafes and herbal tea." },
  { id: "t2", sessionId: "shared", sessionIndex: 0, date: "2025-01-01T12:00:00.000Z", speaker: "assistant", text: "The courtyard cafe is quiet." },
  { id: "t3", sessionId: "shared", sessionIndex: 1, date: "2025-02-01T12:00:00.000Z", speaker: "user", text: "My bicycle is turquoise and has a wicker basket." },
  { id: "t4", sessionId: "shared", sessionIndex: 1, date: "2025-02-01T12:00:00.000Z", speaker: "assistant", text: "The bicycle basket carries tea." },
] };
const date = "2025-03-01T12:00:00.000Z", question = "What would you recommend for a quiet cafe?";
const variant = (system: EvolutionRetrievalVariant["system"], topK = 20, contextBytes = 24_000): EvolutionRetrievalVariant => ({ id: system, system, budget: { topK, contextBytes } });
const artifactPin = { path: "/fixture/observations.json", sha256: h("pinned observation artifact bytes") };

/** Real product prompt/response parsing and record rebuilding; only the extractor's text is synthetic. */
function artifactCorpus(): ObserveLaneArtifactCorpus {
  const turns = observeLaneTurnRecords(corpus);
  const sessions = observeLaneSessions(corpus).map((group): ObserveLaneArtifactSession => {
    const records = group.indices.map(i => turns[i]!), session = parseOhObservationSessionV1(records), prompt = makeOhObservationPromptV1(session);
    const promptTurns = JSON.parse(prompt.messages[1]!.content).turns as { id: string; speaker: string; text: string }[];
    const response = JSON.stringify({ observations: [{ text: promptTurns[0]!.text, speaker: "user", kind: group.sessionIndex === 0 ? "preference" : "fact",
      eventAt: null, resolvedFrom: null, facet: group.sessionIndex === 0 ? "leisure" : "transport", sources: [promptTurns[0]!.id] }] });
    const parsed = parseOhObservationResponseV1(response, session);
    if (!parsed.ok) throw new Error(`Synthetic observation response rejected: ${parsed.rejection}`);
    return { sessionId: group.sessionId, sessionIndex: group.sessionIndex, sessionSha256: session.sessionSha256, turnKeys: records.map(r => r.key),
      requestSha256: makeEvolutionRequest("gpt5-nano-reader", prompt.messages).requestSha256, responseSha256: sha256Hex(response), status: "completed",
      rejection: null, rejectionIndex: null, response, observationCount: parsed.observations.length,
      facetCount: parsed.observations.filter(o => o.facet !== null).length, observationBytes: parsed.observations.reduce((n, o) => n + Buffer.byteLength(o.text), 0),
      turnBytes: group.indices.reduce((n, i) => n + Buffer.byteLength(corpus.turns[i]!.text), 0) };
  });
  return { corpusId: corpus.id, corpusSha256: observeLaneCorpusSha256(corpus), sessions };
}
async function derivedFixture(): Promise<EvolutionDerivedRecords> {
  const rebuilt = await rebuildObserveLaneRecords(corpus, artifactCorpus(), { extractor: "gpt5-nano-reader" });
  return { artifactSha256: artifactPin.sha256, records: rebuilt.derived };
}
/** Controlled rankings put observations first and raw turns in reverse source order to catch renderer changes. */
function backend(observations = true): OhSemanticSearchBackendV1 & { indexed: readonly KnowledgeGraphRecordV1[]; builds: number } {
  const result = { profile: OH_EMBEDDING_PROFILE_V1, indexed: [] as readonly KnowledgeGraphRecordV1[], builds: 0,
    async index(records: readonly KnowledgeGraphRecordV1[]) { result.indexed = records; result.builds++; return { indexed: records.length, v: 1 as const }; },
    async search(_query: string, limit: number) {
      return result.indexed.filter(r => observations || r.key.startsWith("edition:turn-"))
        .slice().sort((a, b) => Number(a.key.startsWith("edition:turn-")) - Number(b.key.startsWith("edition:turn-")) || (a.key < b.key ? 1 : -1))
        .slice(0, limit).map((record, index) => ({ key: record.key, recordSha256: record.recordSha256, score: 100 - index, v: 1 as const }));
    }, async close() {} };
  return result;
}
function reseal(result: EvolutionAnyRetrievalResult, mutate: (draft: any) => void): EvolutionAnyRetrievalResult {
  const value = structuredClone(result) as any; mutate(value); const { resultSha256: _old, ...payload } = value;
  return { ...value, resultSha256: h(payload) };
}
function derivedMap(records: EvolutionDerivedRecords): EvolutionDerivedCorpora {
  return { protocol: EVOLUTION_DERIVED_CORPORA_PROTOCOL, artifactSha256: records.artifactSha256, extractor: "gpt5-nano-reader", byCorpus: new Map([[corpus.id, records]]) };
}

test("derived retrieval indexes observations but not receipts, bounds complete context, and authenticates provenance", async () => {
  const derived = await derivedFixture(), vectors = backend(), prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: vectors, derivedRecords: derived });
  try {
    expect(prepared.identity.protocol).toBe("oh.evolution-prepared.v2");
    for (const system of EVOLUTION_DERIVED_SYSTEMS) {
      const result = await prepared.retrieve(question, variant(system), date);
      expect(result.protocol).toBe("oh.evolution-retrieval.v2");
      if (result.protocol !== "oh.evolution-retrieval.v2") throw new Error("Expected V2 result");
      expect(result.derived).toHaveLength(2); expect(result.context).toContain("Remembered preferences (leisure):");
      expect(result.context).toContain("Memory:"); expect(result.context).toContain("turquoise");
      expect(result.turnIds).toHaveLength(4); expect(result.sources.map(s => s.turnId)).toEqual(result.turnIds);
      expect(new Set(result.derived.flatMap(d => d.sourceTurnIds))).toEqual(new Set(["t1", "t3"]));
      expect(result.contextBytes).toBe(Buffer.byteLength(result.context));
      validateEvolutionContextSources(corpus, result, { semantic: true, derivedRecords: derived, question: { question, questionDate: date, system } });
      const validate = (value: EvolutionAnyRetrievalResult) => validateEvolutionContextSources(corpus, value,
        { semantic: true, derivedRecords: derived, question: { question, questionDate: date, system } });
      for (const mutate of [
        (x: any) => x.derived[0].sourceTurnIds = ["t2"], (x: any) => x.derived[0].sourceKeys = ["edition:turn-00001"],
        (x: any) => x.derived[0].recordSha256 = h("foreign record"), (x: any) => x.derived.push(x.derived[0]),
        (x: any) => { x.context = x.context.replace("turquoise", "orange"); x.contextBytes = Buffer.byteLength(x.context); x.contextSha256 = sha256Hex(x.context); },
      ]) expect(() => validate(reseal(result, mutate))).toThrow();
      for (const contextBytes of [1, 180, 400]) {
        const tight = await prepared.retrieve(question, variant(system, 20, contextBytes), date);
        expect(tight.contextBytes).toBeLessThanOrEqual(contextBytes); validate(tight);
      }
    }
    expect(vectors.indexed).toHaveLength(6); expect(vectors.indexed.some(r => r.key.startsWith("activity:"))).toBe(false); expect(vectors.builds).toBe(1);
    await expect(prepared.retrieve(question, variant("oh-semantic"), date)).rejects.toThrow();
  } finally { await prepared.close(); }
});

test("turn-only identity stays V1 while artifact and rebuilt record changes invalidate derived preparation", async () => {
  const derived = await derivedFixture(), raw = await prepareEvolutionCorpus(corpus, { semanticBackend: backend() });
  const first = await prepareEvolutionCorpus(corpus, { semanticBackend: backend(), derivedRecords: derived });
  const other = await prepareEvolutionCorpus(corpus, { semanticBackend: backend(), derivedRecords: { ...derived, artifactSha256: h("other artifact") } });
  try {
    const turns = observeLaneTurnRecords(corpus), payload = { protocol: "oh.evolution-prepared.v1", corpusId: corpus.id, corpusSha256: h(corpus),
      sourceRecordsSha256: h(turns.map(r => ({ key: r.key, recordSha256: r.recordSha256 }))), sourceRecordCount: 4, semanticProfileSha256: h(OH_EMBEDDING_PROFILE_V1) };
    expect(raw.identity).toEqual({ ...payload, preparedSha256: h(payload) });
    expect(first.identity.preparedSha256).not.toBe(raw.identity.preparedSha256); expect(other.identity.preparedSha256).not.toBe(first.identity.preparedSha256);
    await expect(raw.retrieve(question, variant("oh-semantic-obs"), date)).rejects.toThrow();
    const changed = { ...corpus, turns: corpus.turns.map((turn, i) => i === 0 ? { ...turn, text: "Replaced provenance." } : turn) };
    await expect(prepareEvolutionCorpus(changed, { derivedRecords: derived })).rejects.toThrow();
    const observations = derived.records.filter(r => parseOhObservationRecordV1(r) !== null);
    await expect(prepareEvolutionCorpus(corpus, { derivedRecords: { ...derived, records: observations } })).rejects.toThrow();
    const duplicate = [...derived.records, derived.records[0]!];
    await expect(prepareEvolutionCorpus(corpus, { derivedRecords: { ...derived, records: duplicate } })).rejects.toThrow();
    const foreign = createKnowledgeGraphRecordV1({ key: "edition:foreign", kind: "edition", dependencies: [], v: 1, value: "Invented memory" });
    await expect(prepareEvolutionCorpus(corpus, { derivedRecords: { ...derived, records: [foreign] } })).rejects.toThrow();
  } finally { await Promise.all([raw.close(), first.close(), other.close()]); }
});

test("derived arms with no observation hits preserve their raw controls' exact context bytes", async () => {
  const derived = await derivedFixture(), raw = await prepareEvolutionCorpus(corpus, { semanticBackend: backend(false) });
  const observed = await prepareEvolutionCorpus(corpus, { semanticBackend: backend(false), derivedRecords: derived });
  try {
    for (const [control, candidate] of [["oh-semantic", "oh-semantic-obs"], ["oh-recall-mq", "oh-recall-mq-obs"]] as const) {
      for (const q of [question, "What color is the bicycle?"]) for (const contextBytes of [1, 180, 400, 24_000]) {
        const before = await raw.retrieve(q, variant(control, 20, contextBytes), date), after = await observed.retrieve(q, variant(candidate, 20, contextBytes), date);
        expect(after.context).toBe(before.context); expect(after.turnIds).toEqual(before.turnIds); expect(after.contextSha256).toBe(before.contextSha256);
        expect(after.protocol).toBe("oh.evolution-retrieval.v2");
        if (after.protocol === "oh.evolution-retrieval.v2") expect(after.derived).toEqual([]);
        validateEvolutionContextSources(corpus, after, { semantic: true, derivedRecords: derived, question: { question: q, questionDate: date, system: candidate } });
      }
    }
  } finally { await Promise.all([raw.close(), observed.close()]); }
});

test("rebuilding rejects forged, omitted, reordered and miscounted session provenance before retrieval", async () => {
  const artifact = artifactCorpus();
  for (const mutate of [
    (x: any) => x.sessions.pop(), (x: any) => x.sessions.reverse(), (x: any) => x.sessions[0].sessionId = "foreign-session",
    (x: any) => x.sessions[0].sessionIndex = 9, (x: any) => x.sessions[0].turnKeys.reverse(), (x: any) => x.sessions[0].requestSha256 = h("foreign request"),
    (x: any) => x.sessions[0].responseSha256 = null, (x: any) => x.sessions[0].observationCount++, (x: any) => x.sessions[0].facetCount++,
    (x: any) => x.sessions[0].observationBytes++, (x: any) => x.sessions[0].turnBytes++,
  ]) {
    const changed = structuredClone(artifact); mutate(changed);
    await expect(rebuildObserveLaneRecords(corpus, changed, { extractor: "gpt5-nano-reader" })).rejects.toThrow();
  }
});

test("V4 and V9 pass mixed raw/derived source-authenticated contexts into unchanged reader contracts", async () => {
  const derived = await derivedFixture(), map = derivedMap(derived), control = variant("oh-keyword"), candidate = variant("oh-recall-mq-obs");
  const dataset: EvolutionRunnerInput = { corpora: [{ id: corpus.id, turns: corpus.turns }], questions: [{ id: `q-${h("question")}`, corpusId: corpus.id, question, questionDate: date }] };
  const raw = await prepareEvolutionCorpus(corpus), observed = await prepareEvolutionCorpus(corpus, { semanticBackend: backend(), derivedRecords: derived });
  try {
    const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: h("manifest"), retrievalSourceSha256: h("source"), inputSha256: h(dataset),
      variants: [control, candidate], questions: dataset.questions, cases: [
        { questionId: dataset.questions[0]!.id, variantId: control.id, result: await raw.retrieve(question, control, date) },
        { questionId: dataset.questions[0]!.id, variantId: candidate.id, result: await observed.retrieve(question, candidate, date) },
      ] };
    const base: EvolutionContextPlan = { ...payload, planSha256: h(payload) };
    validateEvolutionContextPlanSources(base, dataset, map); expect(() => validateEvolutionContextPlanSources(base, dataset)).toThrow();
    const config = parseEvolutionRunConfig(v4Config([control, candidate]));
    validateEvolutionContextRunVersion(base, config);
    const reader = makeEvolutionReaderPlan(base, ["gpt5-nano-reader"]); expect(validateEvolutionReaderPlan(reader, base)).toEqual(reader);
    expect(reader.requests.some(r => JSON.stringify(r.body).includes("Memory:"))).toBe(true);
    const binding = { studySha256: h("study"), scopeSha256: h("scope"), shardId: "shard-001", candidatePresentation: "retrieval-order" as const,
      candidateVariantSha256: h(candidate), derivedRecordsPin: artifactPin, readerDatePolicy: "question-date" as const,
      readerDatePolicySha256: evolutionReaderDatePolicySha256("question-date"), resultProtocol: "oh.evolution-retrieval.v2" as const };
    const wrapped = makeEvolutionContextPlanV9({ dataset, basePlan: base, binding, derived: map });
    expect(wrapped.cases.map(c => c.result.protocol)).toEqual(["oh.evolution-retrieval.v1", "oh.evolution-retrieval.v2"]);
    expect(wrapped.cases.map(c => c.result)).toEqual(base.cases.map(c => c.result));
    validateEvolutionContextPlanV9Sources(wrapped, dataset, map); expect(() => validateEvolutionContextPlanV9Sources(wrapped, dataset)).toThrow();
    const repeated = makeEvolutionReaderPlanV2(wrapped, ["gpt5-nano-reader"], 2); expect(validateEvolutionReaderPlanV2(repeated, wrapped)).toEqual(repeated);
    expect(repeated.cases).toHaveLength(4); expect(repeated.requests).toHaveLength(2);
    expect(() => makeEvolutionContextPlanV9({ dataset, basePlan: base, binding: { ...binding, derivedRecordsPin: { ...artifactPin, sha256: h("wrong artifact") } }, derived: map })).toThrow();
  } finally { await Promise.all([raw.close(), observed.close()]); }
});

function v4Config(variants: readonly EvolutionRetrievalVariant[] = [variant("oh-keyword"), variant("oh-semantic-obs")]) {
  return { protocol: "oh.memory.evolution-run.v4", dataset: "longmemeval-s", datasetPin: { path: "/fixture/data", sha256: DATASETS["longmemeval-s"].sha256 },
    manifestPin: { path: "/fixture/manifest", sha256: h("manifest") }, campaignPin: { path: "/fixture/campaign", sha256: h("campaign") }, limit: 1, seed: 17,
    variants, readers: ["gpt5-nano-reader"], judge: EVOLUTION_RELEASE_JUDGE, directory: "/fixture/run", storeDirectory: "/fixture/store", concurrency: 24,
    semanticCacheDirectory: "/fixture/cache", derivedRecordsPin: artifactPin };
}
function study(): EvolutionStudyV9 {
  const config = v4Config();
  return { protocol: "oh.memory.evolution-study.v9", mode: "explicit-selection-descriptive", dataset: "longmemeval-s", datasetPin: config.datasetPin,
    manifestPin: config.manifestPin, campaignPin: config.campaignPin, retrievalSourceSha256: h("source"), control: config.variants[0]!, candidate: config.variants[1]!,
    readers: ["gpt5-nano-reader"], judge: EVOLUTION_RELEASE_JUDGE, rubricSha256: EVOLUTION_RELEASE_RUBRIC_SHA, repeats: 1, judgeRepeats: 1,
    selection: [`q-${h("question")}`], maximumQuestionsPerShard: 100, shardPolicy: "packed-clusters", derivedRecordsPin: artifactPin, retrievalProvenance: null,
    readerDatePolicy: "question-date", candidatePresentation: "retrieval-order", repeatPolicy: "predeclared-full-matrix-indexed-repeats" };
}
test("configuration admission binds observation pins to derived arms and caps every V2 search at 100", () => {
  for (const system of EVOLUTION_DERIVED_SYSTEMS) {
    expect(parseEvolutionExperimentVariant(variant(system, 100)).system).toBe(system);
    expect(parseEvolutionV9Variant(variant(system, 100)).system).toBe(system);
    expect(() => parseEvolutionExperimentVariant(variant(system, 101))).toThrow(); expect(() => parseEvolutionV9Variant(variant(system, 101))).toThrow();
  }
  const config = v4Config(); expect(parseEvolutionRunConfig(config).derivedRecordsPin).toEqual(artifactPin);
  const { derivedRecordsPin: _pin, ...noPin } = config;
  expect(() => parseEvolutionRunConfig(noPin)).toThrow(); expect(() => parseEvolutionRunConfig({ ...config, variants: [variant("oh-keyword")] })).toThrow();
  for (const path of ["/fixture/run/observations.json", "/fixture/store/observations.json", "/fixture/cache/observations.json"]) {
    expect(() => parseEvolutionRunConfig({ ...config, derivedRecordsPin: { ...artifactPin, path } })).toThrow();
  }
  const declared = study(); expect(parseEvolutionStudyV9(declared)).toEqual(declared);
  expect(() => parseEvolutionStudyV9({ ...declared, derivedRecordsPin: null })).toThrow();
  expect(() => parseEvolutionStudyV9({ ...declared, candidate: variant("oh-semantic") })).toThrow();
  const { seed: _seed, ...fields } = config;
  const v9 = { ...fields, protocol: "oh.memory.evolution-run.v9", studyPin: { path: "/fixture/study", sha256: h("study") }, scopePin: { path: "/fixture/scope", sha256: h("scope") },
    shardId: "shard-001", repeats: 1, judgeRepeats: 1, readerDatePolicy: "question-date" };
  expect(parseEvolutionRunConfigV9(v9).derivedRecordsPin).toEqual(artifactPin);
  expect(() => parseEvolutionRunConfigV9({ ...v9, derivedRecordsPin: null })).toThrow();
  expect(() => parseEvolutionRunConfigV9({ ...v9, variants: [variant("oh-keyword"), variant("oh-semantic")] })).toThrow();
});

test("router audit depends on query text and category counts without reading answers", () => {
  const input = [{ id: "routed", category: "preference", question }, { id: "plain", category: "fact", question: "What color is my bicycle?" }];
  for (const q of input) Object.defineProperty(q, "answer", { enumerable: true, get() { throw new Error("Gold read"); } });
  const audit = evolutionObserveRouterAudit(input);
  expect(audit.routedIds).toEqual(["routed"]); expect(audit.byCategory.preference).toEqual({ questions: 1, routed: 1, share: 1 });
  expect(audit.byCategory.fact).toEqual({ questions: 1, routed: 0, share: 0 });
  expect(evolutionObserveRouterAudit([...input].reverse())).toEqual(audit);
});


const wire = (value: unknown) => new TextEncoder().encode(canonicalJson(value));
function captured(request: EvolutionRequest, answer: string): Uint8Array {
  return wire({ model: request.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 100, completion_tokens: 3, total_tokens: 103 }, providerMetadata: { gateway: { routing: {
      finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model,
      resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1),
    } } } });
}

test("V4 and V9 reports authenticate derived records and reject missing or substituted artifacts", async () => {
  const { makeEvolutionJudgePlan } = await import("../scripts/benchmarks/evolution-judge");
  const { buildEvolutionReport } = await import("../scripts/benchmarks/evolution-report");
  const { buildEvolutionReportV9 } = await import("../scripts/benchmarks/evolution-report-v9");
  const { evolutionJudgeJobsV9, loadEvolutionJudgeRubricV9, makeEvolutionJudgePlanV9 } = await import("../scripts/benchmarks/evolution-judge-v9");
  const { loadJudgeProfile } = await import("../scripts/benchmarks/judge");
  const dataset: Dataset = { corpora: [corpus], questions: [{ id: "report-question", corpusId: corpus.id, category: "single-session-user", question,
    questionDate: date, answer: "PRIVATE_GOLD_DERIVED", unanswerable: false, evidenceTurnIds: ["t1"], evidenceSessionIds: ["shared"] }] };
  const manifest = createEvolutionDatasetManifest(dataset, { dataset: "longmemeval-s", revision: DATASETS["longmemeval-s"].revision,
    sourceSha256: DATASETS["longmemeval-s"].sha256, groups: [{ groupId: corpus.groupId, partition: "development", exposure: "evaluated", evidence: "Synthetic offline fixture." }] });
  const manifestBytes = wire(manifest), manifestSha256 = sha256Hex(manifestBytes), projected = projectEvolutionRunnerInput(dataset);
  const projectedCorpus = { ...projected.corpora[0]!, groupId: projected.corpora[0]!.id }, records = await derivedFixture();
  const derived: EvolutionDerivedCorpora = { ...derivedMap(records), byCorpus: new Map([[projectedCorpus.id, records]]) };
  const swappedRecords = { ...records, artifactSha256: h("substituted artifact") };
  const swapped = { ...derived, artifactSha256: swappedRecords.artifactSha256, byCorpus: new Map([[projectedCorpus.id, swappedRecords]]) };
  const control = variant("oh-keyword"), candidate = variant("oh-recall-mq-obs");
  const raw = await prepareEvolutionCorpus(projectedCorpus), observed = await prepareEvolutionCorpus(projectedCorpus, { semanticBackend: backend(), derivedRecords: records });
  try {
    const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256, retrievalSourceSha256: h("source"), inputSha256: h(projected),
      variants: [control, candidate], questions: projected.questions, cases: [
        { questionId: projected.questions[0]!.id, variantId: control.id, result: await raw.retrieve(question, control, date) },
        { questionId: projected.questions[0]!.id, variantId: candidate.id, result: await observed.retrieve(question, candidate, date) },
      ] };
    const base: EvolutionContextPlan = { ...payload, planSha256: h(payload) }, readerPlan = makeEvolutionReaderPlan(base, ["gpt5-nano-reader"]);
    const captures = new Map<string, Uint8Array>();
    const responsesFor = (requests: readonly EvolutionRequest[], answer: string) => new Map(requests.map(request => {
      const bytes = captured(request, answer); captures.set(request.requestSha256, bytes); return [request.requestSha256, parseEvolutionResponse(bytes, request)];
    }));
    const phase = (kind: "reader" | "judge", planSha256: string, responses: ReadonlyMap<string, EvolutionResponse>) => wire({ protocol: "oh.memory.evolution-phase.v1",
      phase: kind, planSha256, complete: true, responses: [...responses].map(([requestSha256, response]) => ({ requestSha256, response })) });
    const responses = responsesFor(readerPlan.requests, "PRIVATE_PREDICTION_DERIVED"), readerOutputBytes = phase("reader", readerPlan.planSha256, responses);
    const judgePlan = makeEvolutionJudgePlan({ contextPlan: base, readerPlan, responses, dataset, profile: EVOLUTION_RELEASE_JUDGE,
      rubric: await loadJudgeProfile(), readerOutputSha256: sha256Hex(readerOutputBytes) });
    const judgeOutputBytes = phase("judge", judgePlan.planSha256, responsesFor(judgePlan.requests, "yes"));
    const input = { dataset, manifestBytes, manifestSha256, contextPlan: base, readerPlan, judgePlan, readerOutputBytes, judgeOutputBytes,
      judgeOutputSha256: sha256Hex(judgeOutputBytes), loadRawResponse: async (r: EvolutionRequest) => captures.get(r.requestSha256)! };
    const report = await buildEvolutionReport({ ...input, derived });
    expect(report.status).toBe("complete"); expect(report.arms).toHaveLength(2);
    await expect(buildEvolutionReport(input)).rejects.toThrow(); await expect(buildEvolutionReport({ ...input, derived: swapped })).rejects.toThrow();
    const declaration = { ...study(), control, candidate, manifestPin: { path: "/fixture/manifest", sha256: manifestSha256 }, selection: projected.questions.map(q => q.id) };
    const studyBytes = wire(declaration), scopeBytes = wire(makeEvolutionStudyV9Scope(studyBytes, manifestBytes));
    const authorization = validateEvolutionStudyV9Artifacts({ studyBytes, scopeBytes, manifestBytes });
    const wrapped = makeEvolutionContextPlanV9({ dataset: projected, basePlan: base, derived, binding: evolutionContextBindingV9(authorization, "shard-001") });
    const readerV9 = makeEvolutionReaderPlanV2(wrapped, declaration.readers, declaration.repeats), readerResponses = new Map<string, EvolutionResponse>();
    const captureV9 = new Map<string, Uint8Array>();
    const rowsFor = (jobs: ReturnType<typeof evolutionReaderJobsV2>, answer: string, responses: Map<string, EvolutionResponse>) => jobs.map(job => {
      const bytes = captured(job.request, answer), response = parseEvolutionResponse(bytes, job.request);
      captureV9.set(job.key, bytes); responses.set(job.key, response); return { requestSha256: job.request.requestSha256, repeat: job.repeat, response };
    });
    const phaseV9 = (phase: string, planSha256: string, responses: ReturnType<typeof rowsFor>) => wire({ protocol: "oh.memory.evolution-phase.v2", phase, planSha256, complete: true, responses });
    const readerBytes = phaseV9("reader", readerV9.planSha256, rowsFor(evolutionReaderJobsV2(readerV9), "PRIVATE_PREDICTION_DERIVED", readerResponses));
    const judgeV9 = makeEvolutionJudgePlanV9({ contextPlan: wrapped, readerPlan: readerV9, responses: readerResponses, failures: new Map(), dataset,
      profile: declaration.judge, rubric: await loadEvolutionJudgeRubricV9(declaration.judge), judgeRepeats: declaration.judgeRepeats, readerOutputSha256: sha256Hex(readerBytes) });
    const judgeBytes = phaseV9("judge", judgeV9.planSha256, rowsFor(evolutionJudgeJobsV9(judgeV9), "yes", new Map()));
    const inputV9 = { dataset, manifestBytes, manifestSha256, contextPlan: wrapped, readerPlan: readerV9, judgePlan: judgeV9,
      readerOutputBytes: readerBytes, judgeOutputBytes: judgeBytes, judgeOutputSha256: sha256Hex(judgeBytes),
      loadRawResponse: async (r: EvolutionRequest, _response: EvolutionResponse, repeat: number) => captureV9.get(evolutionJobKey(r.requestSha256, repeat))!,
      study: { studyBytes, scopeBytes, shardId: "shard-001", campaignSha256: h("campaign") } };
    const reportV9 = await buildEvolutionReportV9({ ...inputV9, derived });
    expect(reportV9.arms).toHaveLength(2); expect(reportV9.design.derivedRecordsPinSha256).toBe(artifactPin.sha256);
    await expect(buildEvolutionReportV9(inputV9)).rejects.toThrow(); await expect(buildEvolutionReportV9({ ...inputV9, derived: swapped })).rejects.toThrow();
    for (const value of [report, reportV9]) {
      expect(JSON.stringify(value)).not.toContain("PRIVATE_GOLD_DERIVED"); expect(JSON.stringify(value)).not.toContain("PRIVATE_PREDICTION_DERIVED");
      expect(JSON.stringify(value)).not.toContain("I prefer quiet cafes");
    }
  } finally { await Promise.all([raw.close(), observed.close()]); }
});


test("persisted pre-read router audit rejects missing, edited and stale selections without exposing text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oh-derived-router-"));
  const dataset: Dataset = { corpora: [corpus], questions: [{ id: "audit-question", corpusId: corpus.id, category: "single-session-user", question,
    questionDate: date, answer: "PRIVATE_ROUTER_GOLD", unanswerable: false, evidenceTurnIds: ["t1"], evidenceSessionIds: ["shared"] }] };
  try {
    await expect(validateEvolutionObserveRouterAudit(directory, dataset)).rejects.toThrow();
    await writeEvolutionObserveRouterAudit(directory, dataset); await validateEvolutionObserveRouterAudit(directory, dataset);
    const path = join(directory, "observe-router-audit.json"), text = await readFile(path, "utf8"), value = JSON.parse(text);
    expect(text).not.toContain(question); expect(text).not.toContain("PRIVATE_ROUTER_GOLD"); expect(text).not.toContain("I prefer quiet cafes");
    await expect(validateEvolutionObserveRouterAudit(directory, { ...dataset, questions: [{ ...dataset.questions[0]!, question: "What color is the bicycle?" }] })).rejects.toThrow();
    value.byCategory["single-session-user"].routed = 0;
    const { auditSha256: _old, ...payload } = value; value.auditSha256 = h(payload);
    await writeFile(path, JSON.stringify(value)); await expect(validateEvolutionObserveRouterAudit(directory, dataset)).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
