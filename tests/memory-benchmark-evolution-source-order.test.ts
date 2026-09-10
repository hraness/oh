import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { OH_EMBEDDING_PROFILE_V1 } from "../src/semantic";
import { DATASETS, type Corpus, type Dataset, type Turn } from "../scripts/benchmarks/datasets";
import { createEvolutionFullHistorySource } from "../scripts/benchmarks/evolution-full-history";
import type { EvolutionCompletionParent } from "../scripts/benchmarks/evolution-completion";
import { createEvolutionSourceOrder, validateEvolutionSourceOrderResultEnvelope } from "../scripts/benchmarks/evolution-source-order";
import { EVOLUTION_SOURCE_ORDER_READER, EVOLUTION_SOURCE_ORDER_TREATMENTS, makeEvolutionSourceOrderPlan, projectEvolutionSourceOrderParents,
  validateEvolutionSourceOrderPlan, type EvolutionSourceOrderPlanInput } from "../scripts/benchmarks/evolution-source-order-plan";
import { makeEvolutionReaderPlan, validateEvolutionAnyContextPlan, validateEvolutionContextPlanSources, validateEvolutionReaderPlan,
  type EvolutionContextPlan } from "../scripts/benchmarks/evolution-plan";
import { parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { loadEvolutionSourceOrderParents, parseEvolutionRunConfig, validateEvolutionContextRunVersion, type EvolutionSourceOrderRunConfig } from "../scripts/benchmarks/evolution";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { makeEvolutionJudgePlan } from "../scripts/benchmarks/evolution-judge";
import { buildEvolutionReport } from "../scripts/benchmarks/evolution-report";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { renderTurn } from "../scripts/benchmarks/retrieval";

const originalFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No network in source-order fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = originalFetch; });
const question = { question: "Where is the bicycle stored?", questionDate: "2026-02-01" };
const variant = { id: "semantic-top100-96k", system: "oh-semantic", budget: { topK: 100, contextBytes: 96_000 } } as const;
const turn = (id: string, sessionId = id, sessionIndex = 0, text = `Synthetic source ${id} café 🗼\n\nLiteral separator`): Turn =>
  ({ id, sessionId, sessionIndex, date: "2026-01-01", speaker: "user", text });
const corpus = (turns: readonly Turn[]): Corpus => ({ id: "synthetic-corpus", groupId: "synthetic-corpus", turns });
// Synthetic cached semantic result. No index, query, embedding, provider, or stored-response access.
function parent(source: Corpus, ids: readonly string[], semantic = true): EvolutionCompletionParent {
  const full = createEvolutionFullHistorySource(source), byId = new Map(source.turns.map((t, i) => [t.id, i]));
  const selected = ids.map(id => byId.get(id)!), context = selected.map(i => renderTurn(source.turns[i]!)).join("\n\n");
  const { preparedSha256: _old, ...identity } = full.identity;
  const preparedSha256 = canonicalSha256({ ...identity, semanticProfileSha256: semantic ? canonicalSha256(OH_EMBEDDING_PROFILE_V1) : null });
  const payload = { protocol: "oh.evolution-retrieval.v1" as const, preparedSha256, variantSha256: canonicalSha256(variant), querySha256: sha256Hex(question.question),
    context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context), turnIds: [...ids], sessionIds: [...new Set(selected.map(i => source.turns[i]!.sessionId))],
    sources: selected.map(i => full.result.sources[i]!), omittedForBudget: 0, facets: [], coveredFacets: [], coverageKind: null };
  const result = { ...payload, resultSha256: canonicalSha256(payload) };
  return { variant, result, expectedResultSha256: result.resultSha256 };
}
function fixture(): EvolutionSourceOrderPlanInput {
  const source = corpus([turn("first", "repeat", 0), turn("equal-date", "repeat", 1), turn("third"), turn("unselected")]);
  return { dataset: { corpora: [{ id: source.id, turns: source.turns }], questions: [{ id: "q1", corpusId: source.id, ...question }] },
    parents: [{ questionId: "q1", parent: parent(source, ["third", "first", "equal-date"]) }], manifestSha256: "a".repeat(64), retrievalSourceSha256: "b".repeat(64) };
}
function reseal<T extends object>(value: T, key = "resultSha256"): T {
  const r = value as Record<string, unknown>, { [key]: _old, ...payload } = r; r[key] = canonicalSha256(payload); return value;
}
function originalPlan(input: EvolutionSourceOrderPlanInput): EvolutionContextPlan {
  const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: input.manifestSha256,
    retrievalSourceSha256: "c".repeat(64), inputSha256: canonicalSha256(input.dataset), variants: [variant], questions: input.dataset.questions,
    cases: input.parents.map(p => ({ questionId: p.questionId, variantId: variant.id, result: p.parent.result })) };
  return { ...payload, planSha256: canonicalSha256(payload) };
}
test("canonical corpus order preserves exact source multiset and UTF-8 bytes, equal dates and repeated-session occurrences", () => {
  const f = fixture(), source = corpus(f.dataset.corpora[0]!.turns), p = f.parents[0]!.parent;
  const factory = createEvolutionSourceOrder(source), input = { question, parent: p }, r = factory.order(input);
  expect(r.turnIds).toEqual(["first", "equal-date", "third"]); expect(r.originalRanks).toEqual([1, 2, 0]); expect(r.orderChanged).toBe(true);
  expect(r.sources).toEqual([p.result.sources[1]!, p.result.sources[2]!, p.result.sources[0]!]);
  expect(r.context).toBe(source.turns.slice(0, 3).map(renderTurn).join("\n\n")); expect(r.contextBytes).toBe(p.result.contextBytes);
  expect(r.sessionIds).toEqual(["repeat", "third"]); expect(r.turnIds).not.toContain("unselected");
  expect(factory.validate(input, r)).toEqual(r); expect(validateEvolutionSourceOrderResultEnvelope(r, input)).toEqual(r);
  expect(Object.isFrozen(r.sources)).toBe(true); expect(r.parentContextSha256).toBe(p.result.contextSha256);
});

test("exact96KB and empty selections preserve bytes with no added header or truncation", () => {
  const first = turn("first", "one", 0, "café 🗼 "), second = turn("second", "two", 0, "");
  const remaining = 96_000 - Buffer.byteLength(renderTurn(first)) - Buffer.byteLength(renderTurn(second)) - 2;
  const source = corpus([first, { ...second, text: "x".repeat(remaining) }]);
  const p = parent(source, ["second", "first"]), factory = createEvolutionSourceOrder(source);
  const r = factory.order({ question, parent: p });
  expect(r.contextBytes).toBe(96_000); expect(r.context).toBe(source.turns.map(renderTurn).join("\n\n"));
  const empty = factory.order({ question, parent: parent(source, []) });
  expect(empty.context).toBe(""); expect(empty.contextBytes).toBe(0); expect(empty.originalRanks).toEqual([]); expect(empty.orderChanged).toBe(false);
});

test("rejects parent/query/variant/semantic identity drift and resealed changes including unretained source changes", () => {
  const f = fixture(), source = corpus(f.dataset.corpora[0]!.turns), input = { question, parent: f.parents[0]!.parent }, factory = createEvolutionSourceOrder(source);
  const r = factory.order(input);
  for (const change of [
    (x: any) => x.parent.expectedResultSha256 = "e".repeat(64), (x: any) => x.question.question = "Another question",
    (x: any) => x.parent.variant.budget.contextBytes = 192_000, (x: any) => x.parent.variant.system = "oh-focused",
    (x: any) => x.parent.result.answer = "GOLD_SENTINEL", (x: any) => x.parent.extra = "unexpected",
    (x: any) => x.parent.result.turnIds = Array(101).fill("first"),
  ]) { const bad = structuredClone(input); change(bad); expect(() => factory.order(bad)).toThrow(); }
  expect(() => factory.order({ question, parent: parent(source, ["first"], false) })).toThrow("source");
  for (const change of [
    (x: any) => x.turnIds.reverse(), (x: any) => x.originalRanks.reverse(), (x: any) => x.sources[0].recordSha256 = "d".repeat(64),
    (x: any) => x.context = x.context.replace("Synthetic", "Invented!"), (x: any) => x.parentContextSha256 = "a".repeat(64),
    (x: any) => x.corpusSha256 = "a".repeat(64), (x: any) => x.orderChanged = false, (x: any) => x.sessionIds.push("invented"),
  ]) { const bad = structuredClone(r) as any; change(bad); bad.contextBytes = Buffer.byteLength(bad.context); bad.contextSha256 = sha256Hex(bad.context); reseal(bad);
    expect(() => factory.validate(input, bad)).toThrow(); }
  expect(() => factory.validate({ ...input, question: { ...question, questionDate: "2027-01-01" } }, r)).toThrow();
  const changed = structuredClone(source); (changed.turns[3] as { text: string }).text += " revised";
  expect(() => createEvolutionSourceOrder(changed).order(input)).toThrow("source");
  // The factory snapshots source data; returned sources do not freeze caller-owned parent rows.
  (source.turns[0] as { text: string }).text += " caller mutation";
  expect(factory.order(input)).toEqual(r); expect(Object.isFrozen(input.parent.result.sources)).toBe(false);
});

test("source projection never enumerates gold getters; wire bounds reject sparse, cyclic and accessor inputs", () => {
  const f = fixture(), expected = makeEvolutionSourceOrderPlan(f), guarded = structuredClone(f);
  for (const value of [guarded.dataset, ...guarded.dataset.corpora, ...guarded.dataset.corpora.flatMap(c => c.turns), ...guarded.dataset.questions])
    for (const key of ["answer", "category", "evidenceTurnIds", "evidenceSessionIds", "unanswerable"])
      Object.defineProperty(value, key, { enumerable: true, get() { throw Error("gold getter reached"); } });
  expect(makeEvolutionSourceOrderPlan(guarded)).toEqual(expected);
  const p = f.parents[0]!.parent, factory = createEvolutionSourceOrder(corpus(f.dataset.corpora[0]!.turns));
  const bad = structuredClone(p) as any; bad.result.turnIds = Array(3);
  expect(() => factory.order({ question, parent: bad })).toThrow("dense");
  bad.result = {}; bad.result.self = bad.result;
  expect(() => factory.order({ question, parent: bad })).toThrow("structure bound");
  let reads = 0; Object.defineProperty(bad, "result", { get() { reads++; return {}; }, enumerable: true });
  expect(() => factory.order({ question, parent: bad })).toThrow("accessor"); expect(reads).toBe(0);
});

test("new plan authenticates complete selection and rejects resealed parent swaps, missing rows and old wire relabels", () => {
  const input = fixture(), plan = makeEvolutionSourceOrderPlan(input);
  expect(validateEvolutionAnyContextPlan(plan)).toEqual(plan); expect(validateEvolutionSourceOrderPlan(input, plan)).toEqual(plan);
  expect(() => validateEvolutionContextPlanSources(plan, input.dataset)).not.toThrow();
  for (const change of [
    (x: any) => x.parents[0].parent.result.context = "invented", (x: any) => x.parents[0].parent.expectedResultSha256 = "d".repeat(64),
    (x: any) => x.questions[0].questionDate = "2027-01-01", (x: any) => x.questions[0].answer = "GOLD_SENTINEL",
    (x: any) => x.cases.pop(), (x: any) => x.parents.push(x.parents[0]), (x: any) => x.variants[0].budget.contextBytes = 48_000,
    (x: any) => x.retrievalSourceSha256 = "c".repeat(64), (x: any) => x.protocol = "oh.memory.evolution-context-plan.v4",
  ]) { const bad = structuredClone(plan); change(bad); reseal(bad, "planSha256"); expect(() => validateEvolutionSourceOrderPlan(input, bad)).toThrow(); }
  expect(() => makeEvolutionSourceOrderPlan({ ...input, dataset: { ...input.dataset, questions: Array(101).fill(input.dataset.questions[0]) } })).toThrow("bounded");
  // A valid different parent/candidate pair remains untrusted against the original input.
  const other = { ...input, parents: [{ questionId: "q1", parent: parent(corpus(input.dataset.corpora[0]!.turns), ["first"]) }] };
  expect(() => validateEvolutionSourceOrderPlan(input, makeEvolutionSourceOrderPlan(other))).toThrow("authenticated parent");
});

test("unchanged order reuses original request bytes; reordered presentation retains exact body size and reservation", () => {
  const input = fixture(), plan = makeEvolutionSourceOrderPlan(input), original = originalPlan(input);
  const readers = makeEvolutionReaderPlan(plan, [EVOLUTION_SOURCE_ORDER_READER]), old = makeEvolutionReaderPlan(original, [EVOLUTION_SOURCE_ORDER_READER]);
  expect(validateEvolutionReaderPlan(readers, plan)).toEqual(readers);
  expect(readers.requests[0]!.protocol).toBe(old.requests[0]!.protocol);
  expect(readers.requests[0]!.reservationMicros).toBe(old.requests[0]!.reservationMicros);
  expect(Buffer.byteLength(canonicalJson(readers.requests[0]!.body))).toBe(Buffer.byteLength(canonicalJson(old.requests[0]!.body)));
  expect(readers.requests[0]!.body.messages[0]).toEqual(old.requests[0]!.body.messages[0]);
  expect(readers.requests[0]!.requestSha256).not.toBe(old.requests[0]!.requestSha256);
  const ordered = { ...input, parents: [{ questionId: "q1", parent: parent(corpus(input.dataset.corpora[0]!.turns), ["first", "equal-date", "third"]) }] };
  const orderedPlan = makeEvolutionSourceOrderPlan(ordered);
  expect(orderedPlan.cases[0]!.result.orderChanged).toBe(false);
  expect(makeEvolutionReaderPlan(orderedPlan, [EVOLUTION_SOURCE_ORDER_READER]).requests).toEqual(makeEvolutionReaderPlan(originalPlan(ordered), [EVOLUTION_SOURCE_ORDER_READER]).requests);
});

function runConfig(root: string, input = fixture()) {
  const pin = (name: string, sha256 = "a".repeat(64)) => ({ path: join(root, name + ".json"), sha256 });
  return { protocol: "oh.memory.evolution-run.v6", dataset: "longmemeval-s", datasetPin: pin("official", DATASETS["longmemeval-s"].sha256),
    manifestPin: pin("manifest", input.manifestSha256), campaignPin: pin("campaign"), limit: 100, seed: 17, variants: EVOLUTION_SOURCE_ORDER_TREATMENTS,
    readers: [EVOLUTION_SOURCE_ORDER_READER], judge: "gpt4o-gateway-native-rubric-16-judge-v1", directory: join(root, "output"), storeDirectory: join(root, "store"),
    concurrency: 24, sourceOrderParent: { pin: pin("semantic"), variantId: variant.id } };
}
test("runV6 is additive and admits only fixed nano/source-order controls with independent parent pins", () => {
  const raw = runConfig("/example/source-order"), config = parseEvolutionRunConfig(raw), plan = makeEvolutionSourceOrderPlan(fixture());
  expect(canonicalSha256(config)).toBe(canonicalSha256(raw)); expect(() => validateEvolutionContextRunVersion(plan, config)).not.toThrow();
  for (const protocol of ["oh.memory.evolution-run.v1", "oh.memory.evolution-run.v2", "oh.memory.evolution-run.v3", "oh.memory.evolution-run.v4", "oh.memory.evolution-run.v5"] as const) {
    expect(() => parseEvolutionRunConfig({ ...raw, protocol })).toThrow(); expect(() => validateEvolutionContextRunVersion(plan, { protocol })).toThrow();
  }
  for (const protocol of ["oh.memory.evolution-context-plan.v1", "oh.memory.evolution-context-plan.v2", "oh.memory.evolution-context-plan.v3", "oh.memory.evolution-context-plan.v4"] as const)
    expect(() => validateEvolutionContextRunVersion({ protocol }, config)).toThrow();
  for (const change of [
    (x: any) => x.limit = 101, (x: any) => x.readers = ["gpt5-mini-reader"], (x: any) => x.judge = "gpt4o-gateway-judge",
    (x: any) => x.variants.push(x.variants[0]), (x: any) => x.variants[0].budget.contextBytes = 192_000,
    (x: any) => x.sourceOrderParent.pin.path = x.storeDirectory + "/parent.json", (x: any) => x.concurrency = 12,
    (x: any) => x.sourceOrderParent.pin.sha256 = "invalid", (x: any) => x.completionParents = {},
  ]) { const bad = structuredClone(raw); change(bad); expect(() => parseEvolutionRunConfig(bad)).toThrow(); }
});

test("each parent reload checks exact bytes plus manifest and source selection independently of the new plan", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "oh-source-order-pins-")), input = fixture();
  try {
    const raw = runConfig(root), content = canonicalJson(originalPlan(input));
    raw.sourceOrderParent.pin.sha256 = sha256Hex(content); await writeFile(raw.sourceOrderParent.pin.path, content);
    const config = parseEvolutionRunConfig(raw) as EvolutionSourceOrderRunConfig;
    expect(await loadEvolutionSourceOrderParents(config, input.dataset)).toEqual(input.parents);
    expect(await loadEvolutionSourceOrderParents(config, input.dataset)).toEqual(input.parents);
    const changed = structuredClone(input.dataset); (changed.corpora[0]!.turns[3] as { text: string }).text += " changed";
    await expect(loadEvolutionSourceOrderParents(config, changed)).rejects.toThrow("selection");
    await expect(loadEvolutionSourceOrderParents({ ...config, manifestPin: { ...config.manifestPin, sha256: "e".repeat(64) } }, input.dataset)).rejects.toThrow("manifest");
    const other = { ...input, parents: [{ questionId: "q1", parent: parent(corpus(input.dataset.corpora[0]!.turns), ["first"]) }] };
    await writeFile(config.sourceOrderParent.pin.path, canonicalJson(originalPlan(other)));
    await expect(loadEvolutionSourceOrderParents(config, input.dataset)).rejects.toThrow("pinned content changed");
    expect(() => projectEvolutionSourceOrderParents({ plan: originalPlan(input), variantId: "missing" }, input.dataset, input.manifestSha256)).toThrow("semantic parent");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generic reader, native16 judge and raw-authenticated report consume V5 with unchanged paid protocols", async () => {
  const source = corpus([turn("first"), turn("second")]);
  const dataset: Dataset = { corpora: [source], questions: [{ id: "synthetic-question", corpusId: source.id, ...question,
    category: "single-session-user", answer: "garage", unanswerable: false, evidenceTurnIds: ["first"], evidenceSessionIds: ["first"] }] };
  const manifest = createEvolutionDatasetManifest(dataset, { dataset: "longmemeval-s", revision: "synthetic-v1", sourceSha256: "a".repeat(64),
    groups: [{ groupId: source.groupId, partition: "development", exposure: "evaluated", evidence: "Synthetic fixture." }],
    histories: [{ corpusId: source.id, historyId: "synthetic-history" }] });
  const bytes = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
  const manifestBytes = bytes(manifest), projected = projectEvolutionRunnerInput(dataset), current = { ...projected.corpora[0]!, groupId: projected.corpora[0]!.id };
  const input: EvolutionSourceOrderPlanInput = { dataset: projected, manifestSha256: sha256Hex(manifestBytes), retrievalSourceSha256: "b".repeat(64),
    parents: [{ questionId: projected.questions[0]!.id, parent: parent(current, ["second", "first"]) }] };
  const contextPlan = makeEvolutionSourceOrderPlan(input), readerPlan = makeEvolutionReaderPlan(contextPlan, [EVOLUTION_SOURCE_ORDER_READER]);
  const captures = new Map<string, Uint8Array>();
  const responses = (requests: readonly EvolutionRequest[], answer: string) => new Map(requests.map(request => {
    const raw = bytes({ model: request.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
      usage: { prompt_tokens: 100, completion_tokens: 2, total_tokens: 102 }, providerMetadata: { gateway: { routing: { finalProvider: request.provider,
        originalModelId: request.model, canonicalSlug: request.model, resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1) } } } });
    captures.set(request.requestSha256, raw); return [request.requestSha256, parseEvolutionResponse(raw, request)] as const;
  }));
  const phase = (phase: string, planSha256: string, values: Map<string, EvolutionResponse>) => bytes({ protocol: "oh.memory.evolution-phase.v1", phase, planSha256,
    complete: true, responses: [...values].map(([requestSha256, response]) => ({ requestSha256, response })) });
  const readerResponses = responses(readerPlan.requests, "garage"), readerOutputBytes = phase("reader", readerPlan.planSha256, readerResponses);
  const judgePlan = makeEvolutionJudgePlan({ contextPlan, readerPlan, responses: readerResponses, dataset,
    profile: "gpt4o-gateway-native-rubric-16-judge-v1", rubric: await loadJudgeProfile(), readerOutputSha256: sha256Hex(readerOutputBytes) });
  const judgeOutputBytes = phase("judge", judgePlan.planSha256, responses(judgePlan.requests, "yes"));
  const report = await buildEvolutionReport({ dataset, manifestBytes, manifestSha256: input.manifestSha256, contextPlan, readerPlan, judgePlan,
    readerOutputBytes, judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes), loadRawResponse: async request => captures.get(request.requestSha256)! });
  expect(report.coverage).toMatchObject({ logicalReaderCases: 1, logicalJudgeCases: 1, expectedQuestionsPerArm: 1, completeAttemptCoverage: true });
  expect(report.arms[0]!.metrics.find(m => m.metric === "judge-accuracy")!.overall.mean).toBe(1);
  expect(report.arms[0]!.metrics.find(m => m.metric === "evidence-recall")!.overall.mean).toBe(1);
  expect(report.cost.reader.physicalRequests).toBe(1); expect(report.cost.judge.physicalRequests).toBe(1);
  expect(JSON.stringify(report)).not.toContain("Synthetic source");
});
