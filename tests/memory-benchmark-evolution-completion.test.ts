import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { OH_EMBEDDING_PROFILE_V1 } from "../src/semantic";
import { DATASETS, type Corpus, type Dataset, type Turn } from "../scripts/benchmarks/datasets";
import { createEvolutionFullHistorySource } from "../scripts/benchmarks/evolution-full-history";
import { boundEvolutionCompletionWire, createEvolutionSourceCompletion, EVOLUTION_COMPLETION_POLICY, type EvolutionCompletionInputs, type EvolutionCompletionParent } from "../scripts/benchmarks/evolution-completion";
import { EVOLUTION_COMPLETION_TREATMENTS, makeEvolutionCompletionPlan, prepareEvolutionCompletionReaderRequests, projectEvolutionCompletionParents, validateEvolutionCompletionPlan, type EvolutionCompletionPlanInput } from "../scripts/benchmarks/evolution-completion-plan";
import { makeEvolutionReaderPlan, validateEvolutionAnyContextPlan, validateEvolutionContextPlanSources, validateEvolutionReaderPlan, type EvolutionContextPlan } from "../scripts/benchmarks/evolution-plan";
import { EVOLUTION_MODEL_PROTOCOL, parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { loadEvolutionCompletionParents, parseEvolutionRunConfig, validateEvolutionContextRunVersion, type EvolutionCompletionRunConfig } from "../scripts/benchmarks/evolution";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { makeEvolutionJudgePlan } from "../scripts/benchmarks/evolution-judge";
import { buildEvolutionReport } from "../scripts/benchmarks/evolution-report";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import type { EvolutionRetrievalResult, EvolutionRetrievalVariant } from "../scripts/benchmarks/evolution-retrieval";
import { renderTurn } from "../scripts/benchmarks/retrieval";

const originalFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No network in pure completion fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = originalFetch; });
const question = { question: "Where is the bicycle stored?", questionDate: "2026-02-01" };
const prefixVariant = { id: "oh-focused-window-96k", system: "oh-focused-window", budget: { topK: 100, contextBytes: 96_000 } } as const;
const poolVariant = (semantic: boolean): EvolutionRetrievalVariant => ({ id: `${semantic ? "semantic" : "focused"}-top100-96k`, system: semantic ? "oh-semantic" : "oh-focused", budget: { topK: 100, contextBytes: 96_000 } });
const turn = (id: string, sessionId = id, sessionIndex = 0, text = `Synthetic source ${id} café 🗼`): Turn => ({ id, sessionId, sessionIndex, date: "2026-01-01", speaker: "user", text });
const corpus = (turns: readonly Turn[]): Corpus => ({ id: "synthetic-corpus", groupId: "synthetic-corpus", turns });
function sized(id: string, renderedBytes: number, sessionId = id): Turn {
  const value = turn(id, sessionId), prefix = "Preserved café 🗼 ";
  return { ...value, text: prefix + "x".repeat(renderedBytes - Buffer.byteLength(renderTurn({ ...value, text: prefix }))) };
}
// Synthetic cached-result fixtures: construct current canonical sources and an explicit
// lexical/semantic prepared identity without search, embeddings or index construction.
function parent(source: Corpus, variant: EvolutionRetrievalVariant, ids: readonly string[], q = question, omittedForBudget = 0): EvolutionCompletionParent {
  const full = createEvolutionFullHistorySource(source), byId = new Map(source.turns.map((t, i) => [t.id, i]));
  const selected = ids.map(id => byId.get(id)!), context = selected.map(i => renderTurn(source.turns[i]!)).join("\n\n");
  const { preparedSha256: _old, ...identity } = full.identity;
  const preparedSha256 = canonicalSha256({ ...identity, semanticProfileSha256: variant.system === "oh-semantic" ? canonicalSha256(OH_EMBEDDING_PROFILE_V1) : null });
  const payload = { protocol: "oh.evolution-retrieval.v1" as const, preparedSha256, variantSha256: canonicalSha256(variant), querySha256: sha256Hex(q.question),
    context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context), turnIds: [...ids], sessionIds: [...new Set(selected.map(i => source.turns[i]!.sessionId))],
    sources: selected.map(i => full.result.sources[i]!), omittedForBudget, facets: [], coveredFacets: [], coverageKind: null };
  const result: EvolutionRetrievalResult = { ...payload, resultSha256: canonicalSha256(payload) };
  return { variant, result, expectedResultSha256: result.resultSha256 };
}
function fixture() {
  const source = corpus([turn("prefix"), turn("lexical"), turn("semantic"), turn("outside")]);
  const prefix = parent(source, prefixVariant, ["prefix"]), lexical = parent(source, poolVariant(false), ["lexical"]), semantic = parent(source, poolVariant(true), ["semantic"]);
  const input: EvolutionCompletionInputs = { question, mode: "lexical", prefix, pool: lexical };
  return { source, prefix, lexical, semantic, input, prepared: createEvolutionSourceCompletion(source) };
}
function reseal<T extends object>(value: T, key = "resultSha256"): T {
  const r = value as Record<string, unknown>, { [key]: _old, ...payload } = r; r[key] = canonicalSha256(payload); return value;
}
function resealResult(value: any) { value.contextBytes = Buffer.byteLength(value.context); value.contextSha256 = sha256Hex(value.context); return reseal(value); }

test("protects the full96KB UTF-8 prefix and counts every separator inside the24KB atomic completion cap", () => {
  const source = corpus([sized("prefix", 96_000), sized("large-opening", 23_900, "large"), sized("large-hit", 100, "large"), sized("exact-fit", 23_998)]);
  const prefix = parent(source, prefixVariant, ["prefix"]), pool = parent(source, poolVariant(false), ["large-hit", "exact-fit"]), prepared = createEvolutionSourceCompletion(source);
  const input: EvolutionCompletionInputs = { question, mode: "lexical", prefix, pool }, result = prepared.pack(input);
  expect(Buffer.from(result.context).subarray(0, 96_000)).toEqual(Buffer.from(prefix.result.context));
  expect(result.prefixContextBytes).toBe(96_000); expect(result.contextBytes).toBe(120_000); expect(result.appendedBytes).toBe(24_000);
  expect(result.appendedTurnIds).toEqual(["exact-fit"]);
  expect(result.decisions).toEqual([{ hitTurnId: "large-hit", missingTurnIds: ["large-opening", "large-hit"], status: "omitted-for-budget" }, { hitTurnId: "exact-fit", missingTurnIds: ["exact-fit"], status: "appended" }]);
  expect(prepared.validate(input, result)).toEqual(result); expect(result.sources[0]).toEqual(prefix.result.sources[0]);
  expect(result.context).toContain("café 🗼"); expect(Object.isFrozen(result.sources)).toBe(true);
});

test("same-occurrence opening/hit/neighbors form one deduplicated bundle and never cross repeated session IDs", () => {
  const source = corpus([turn("prefix"), turn("other-occurrence", "repeat", 0), turn("opening", "repeat", 1),
    { ...turn("previous", "repeat", 1), speaker: "assistant" }, turn("hit", "repeat", 1), turn("next", "repeat", 1), turn("later-occurrence", "repeat", 2)]);
  const prefix = parent(source, prefixVariant, ["prefix"]), pool = parent(source, poolVariant(false), ["hit", "previous"]);
  const result = createEvolutionSourceCompletion(source).pack({ question, mode: "lexical", prefix, pool });
  expect(result.appendedTurnIds).toEqual(["opening", "hit", "previous", "next"]);
  expect(result.decisions[1]!.status).toBe("already-present"); expect(new Set(result.turnIds).size).toBe(result.turnIds.length);
  expect(result.turnIds).not.toContain("other-occurrence"); expect(result.turnIds).not.toContain("later-occurrence");
  expect(result.context).toBe([...prefix.result.turnIds, ...result.appendedTurnIds].map(id => renderTurn(source.turns.find(t => t.id === id)!)).join("\n\n"));
});

test("an already-retained hit can gain a missing opener; empty and budget-truncated pools stay explicitly recorded", () => {
  const source = corpus([turn("opening", "session"), turn("hit", "session")]), prefix = parent(source, prefixVariant, ["hit"]);
  const prepared = createEvolutionSourceCompletion(source), pool = parent(source, poolVariant(false), ["hit"], question, 1);
  const result = prepared.pack({ question, mode: "lexical", prefix, pool });
  expect(result.turnIds).toEqual(["hit", "opening"]); expect(result.prefixContextSha256).toBe(prefix.result.contextSha256); expect(result.poolOmittedForBudget).toBe(1);
  const empty = prepared.pack({ question, mode: "lexical", prefix, pool: parent(source, poolVariant(false), []) });
  expect(empty.context).toBe(prefix.result.context); expect(empty.appendedBytes).toBe(0); expect(empty.decisions).toEqual([]);
  expect(EVOLUTION_COMPLETION_POLICY.poolScope).toBe("authenticated-budgeted-retrieval-result");
});

test("requires exact independent parent/query/variant pins and the actual semantic prepared identity", () => {
  const f = fixture(); expect(f.prepared.pack({ ...f.input, mode: "semantic", pool: f.semantic }).mode).toBe("semantic");
  expect(() => f.prepared.pack({ ...f.input, mode: "semantic", pool: f.lexical })).toThrow();
  const disguised = structuredClone(f.lexical) as any; disguised.variant = poolVariant(true); disguised.result.variantSha256 = canonicalSha256(disguised.variant);
  reseal(disguised.result); disguised.expectedResultSha256 = disguised.result.resultSha256;
  expect(() => f.prepared.pack({ ...f.input, mode: "semantic", pool: disguised })).toThrow("source");
  for (const change of [
    (x: any) => x.prefix.expectedResultSha256 = "e".repeat(64),
    (x: any) => x.pool.variant.system = "oh-hybrid",
    (x: any) => x.pool.variant.budget.contextBytes = 192_000,
    (x: any) => x.prefix.variant.system = "oh-focused-window-opening",
    (x: any) => x.question.question = "Different question",
    (x: any) => x.pool.extra = "unexpected",
    (x: any) => x.pool.result.answer = "GOLD_SENTINEL",
    (x: any) => x.pool.result.turnIds = Array(101).fill("lexical"),
  ]) { const changed = structuredClone(f.input); change(changed); expect(() => f.prepared.pack(changed)).toThrow(); }
  const result = f.prepared.pack(f.input);
  expect(() => f.prepared.validate({ ...f.input, question: { ...question, questionDate: "2026-03-01" } }, result)).toThrow();
});

test("rejects resealed source edits, prefix reorder, invented claims and a source revision outside retained context", () => {
  const f = fixture(), result = f.prepared.pack(f.input);
  for (const change of [
    (r: any) => r.context = r.context.replace("Synthetic", "Fabricated"),
    (r: any) => r.turnIds.reverse(),
    (r: any) => r.sources[0].recordSha256 = "d".repeat(64),
    (r: any) => r.appendedTurnIds.push("outside"),
    (r: any) => r.decisions[0].status = "already-present",
    (r: any) => r.prefixResultSha256 = "a".repeat(64),
    (r: any) => r.context = f.prefix.result.context,
    (r: any) => r.mode = "semantic",
    (r: any) => r.questionSha256 = "b".repeat(64),
  ]) { const bad = structuredClone(result); change(bad); resealResult(bad); expect(() => f.prepared.validate(f.input, bad)).toThrow(); }
  const changed = structuredClone(f.source); (changed.turns[3] as { text: string }).text += " revised";
  expect(() => createEvolutionSourceCompletion(changed).pack(f.input)).toThrow("source");
  (f.source.turns[3] as { text: string }).text += " caller mutation";
  expect(f.prepared.pack(f.input)).toEqual(result);
});

function planFixture(): EvolutionCompletionPlanInput {
  const f = fixture();
  return { dataset: { corpora: [{ id: f.source.id, turns: f.source.turns }], questions: [{ id: "q1", corpusId: f.source.id, ...question }] },
    parents: [{ questionId: "q1", prefix: f.prefix, lexical: f.lexical, semantic: f.semantic }], manifestSha256: "a".repeat(64), retrievalSourceSha256: "b".repeat(64) };
}
test("paired plans and request preparation use gold-free projections and existing model/contract request semantics", () => {
  const input = planFixture(), plan = makeEvolutionCompletionPlan(input);
  expect(plan.cases).toHaveLength(2); expect(plan.parents).toHaveLength(1); expect(plan.variants.map(v => v.mode)).toEqual(["lexical", "semantic"]);
  expect(makeEvolutionCompletionPlan(input)).toEqual(plan); expect(validateEvolutionCompletionPlan(input, plan)).toEqual(plan);
  const guarded = structuredClone(input);
  for (const value of [guarded.dataset, ...guarded.dataset.corpora, ...guarded.dataset.corpora.flatMap(c => c.turns), ...guarded.dataset.questions])
    for (const key of ["answer", "category", "evidenceTurnIds", "evidenceSessionIds", "unanswerable"])
      Object.defineProperty(value, key, { enumerable: true, get() { throw Error("gold getter reached"); } });
  expect(makeEvolutionCompletionPlan(guarded)).toEqual(plan);
  const readers = prepareEvolutionCompletionReaderRequests(guarded, plan, ["gpt5-nano-explicit-abstention-composition-v1-reader", "gpt5-mini-explicit-abstention-v1-reader"]);
  expect(readers.cases).toHaveLength(4); expect(readers.requests).toHaveLength(4);
  expect(readers.requests.every(r => r.protocol === EVOLUTION_MODEL_PROTOCOL)).toBe(true);
  expect(JSON.stringify(readers)).not.toContain("GOLD_SENTINEL"); expect(JSON.stringify(readers)).not.toContain('"evidenceTurnIds"');
  for (const row of readers.cases) {
    const context = plan.cases.find(c => c.variantId === row.variantId)!.result;
    const message = readers.requests.find(r => r.requestSha256 === row.requestSha256)!.body.messages[1]!.content;
    expect(JSON.parse(message)).toEqual({ ...question, memory: context.context });
  }
});

test("plan reconstruction rejects resealed parent substitutions, gold injection, missing pairs and selection drift", () => {
  const input = planFixture(), plan = makeEvolutionCompletionPlan(input);
  for (const change of [
    (v: any) => v.parents[0].semantic = v.parents[0].lexical,
    (v: any) => v.questions[0].questionDate = "2027-01-01",
    (v: any) => v.questions[0].answer = "GOLD_SENTINEL",
    (v: any) => v.cases.pop(),
    (v: any) => v.cases[1] = v.cases[0],
    (v: any) => v.variants[0].prefixBytes = 64_000,
    (v: any) => v.retrievalSourceSha256 = "c".repeat(64),
  ]) { const bad = structuredClone(plan); change(bad); reseal(bad, "planSha256"); expect(() => validateEvolutionCompletionPlan(input, bad)).toThrow(); }
  expect(() => makeEvolutionCompletionPlan({ ...input, parents: [...input.parents, ...input.parents] })).toThrow();
  expect(() => makeEvolutionCompletionPlan({ ...input, dataset: { ...input.dataset, questions: Array(101).fill(input.dataset.questions[0]) } })).toThrow("bounded");
  expect(() => prepareEvolutionCompletionReaderRequests(input, plan, ["gpt4o-gateway-judge"])).toThrow("reader");
  expect(() => prepareEvolutionCompletionReaderRequests(input, plan, ["gpt5-nano-reader", "gpt5-nano-reader"])).toThrow("distinct");
});

test("a no-addition completion reuses the exact historical reader request without relabeling its context wire", () => {
  const input = planFixture(), p = input.parents[0]!, source = corpus(input.dataset.corpora[0]!.turns);
  const emptyInput: EvolutionCompletionPlanInput = { ...input, parents: [{ ...p,
    lexical: parent(source, poolVariant(false), []), semantic: parent(source, poolVariant(true), []) }] };
  const completion = makeEvolutionCompletionPlan(emptyInput), readers = prepareEvolutionCompletionReaderRequests(emptyInput, completion, ["gpt5-nano-reader"]);
  expect(readers.cases).toHaveLength(2); expect(readers.requests).toHaveLength(1);
  const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: input.manifestSha256,
    retrievalSourceSha256: input.retrievalSourceSha256, inputSha256: canonicalSha256(input.dataset), variants: [prefixVariant], questions: input.dataset.questions,
    cases: [{ questionId: "q1", variantId: prefixVariant.id, result: p.prefix.result }] };
  const original: EvolutionContextPlan = { ...payload, planSha256: canonicalSha256(payload) };
  expect(makeEvolutionReaderPlan(original, ["gpt5-nano-reader"]).requests).toEqual(readers.requests);
  expect(completion.protocol).toBe("oh.memory.evolution-context-plan.v4");
  expect(completion.cases[0]!.result.protocol).toBe("oh.memory.evolution-source-completion.v1");
  expect(makeEvolutionReaderPlan(completion, ["gpt5-nano-reader"]).requests).toEqual(readers.requests);
});

test("wire checks bound keys, sparse arrays, recursion and accessors before hashing", () => {
  expect(() => boundEvolutionCompletionWire({ ["k".repeat(128)]: 1 }, 127)).toThrow("byte bound");
  expect(() => boundEvolutionCompletionWire(Array(100_000), 1_000)).toThrow("item bound");
  expect(() => boundEvolutionCompletionWire(Array(2), 1_000)).toThrow("dense");
  const cyclic: any = {}; cyclic.next = cyclic;
  expect(() => boundEvolutionCompletionWire(cyclic, 1_000)).toThrow("structure bound");
  let reads = 0; const getter = { get context() { reads++; return "text"; } };
  expect(() => boundEvolutionCompletionWire(getter, 1_000)).toThrow("accessor"); expect(reads).toBe(0);
});

function originalPlan(input: EvolutionCompletionPlanInput, role: "prefix" | "lexical" | "semantic"): EvolutionContextPlan {
  const variant = input.parents[0]![role].variant;
  const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: input.manifestSha256,
    retrievalSourceSha256: "c".repeat(64), inputSha256: canonicalSha256(input.dataset), variants: [variant], questions: input.dataset.questions,
    cases: input.parents.map(p => ({ questionId: p.questionId, variantId: variant.id, result: p[role].result })) };
  return { ...payload, planSha256: canonicalSha256(payload) };
}
function runConfig(root: string, input = planFixture()) {
  const pin = (name: string, sha256 = "a".repeat(64)) => ({ path: join(root, name + ".json"), sha256 });
  return { protocol: "oh.memory.evolution-run.v5", dataset: "longmemeval-s", datasetPin: pin("official", DATASETS["longmemeval-s"].sha256),
    manifestPin: pin("manifest", input.manifestSha256), campaignPin: pin("campaign"), limit: 100, seed: 17,
    variants: EVOLUTION_COMPLETION_TREATMENTS, readers: ["gpt5-nano-reader", "gpt5-mini-reader"], judge: "gpt4o-gateway-native-rubric-16-judge-v1",
    directory: join(root, "output"), storeDirectory: join(root, "store"), concurrency: 24,
    completionParents: Object.fromEntries((["prefix", "lexical", "semantic"] as const).map(role => [role, { pin: pin(role), variantId: input.parents[0]![role].variant.id }])) };
}
test("run V5 admits only the fixed pair with original pins and rejects all legacy wire relabels", () => {
  const input = runConfig("/example/completion"), config = parseEvolutionRunConfig(input), plan = makeEvolutionCompletionPlan(planFixture());
  expect(canonicalSha256(config)).toBe(canonicalSha256(input)); expect(() => validateEvolutionContextRunVersion(plan, config)).not.toThrow();
  for (const protocol of ["oh.memory.evolution-run.v1", "oh.memory.evolution-run.v2", "oh.memory.evolution-run.v3", "oh.memory.evolution-run.v4"] as const) {
    expect(() => parseEvolutionRunConfig({ ...input, protocol })).toThrow();
    expect(() => validateEvolutionContextRunVersion(plan, { protocol })).toThrow();
  }
  for (const protocol of ["oh.memory.evolution-context-plan.v1", "oh.memory.evolution-context-plan.v2", "oh.memory.evolution-context-plan.v3"] as const)
    expect(() => validateEvolutionContextRunVersion({ protocol }, config)).toThrow();
  for (const change of [
    (v: any) => v.variants.reverse(), (v: any) => v.variants[0].completionBytes = 48_000,
    (v: any) => v.limit = 101, (v: any) => v.concurrency = 12, (v: any) => v.readers.push("qwen37-flash-reader"),
    (v: any) => delete v.completionParents.semantic, (v: any) => v.completionParents.lexical.pin.path = v.directory + "/contexts.json",
    (v: any) => v.completionParents.prefix.pin.sha256 = "invalid",
  ]) { const changed = structuredClone(input); change(changed); expect(() => parseEvolutionRunConfig(changed)).toThrow(); }
});

test("each reload authenticates original parent file bytes and rejects selection or resealed parent substitutions", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "oh-completion-pins-")), input = planFixture();
  try {
    const raw = runConfig(root, input);
    for (const role of ["prefix", "lexical", "semantic"] as const) {
      const content = canonicalJson(originalPlan(input, role)), binding = raw.completionParents[role]!;
      binding.pin.sha256 = sha256Hex(content); await writeFile(binding.pin.path, content);
    }
    const config = parseEvolutionRunConfig(raw) as EvolutionCompletionRunConfig;
    expect(await loadEvolutionCompletionParents(config, input.dataset)).toEqual(input.parents);
    const wrong = { ...input.dataset, questions: input.dataset.questions.map(q => ({ ...q, questionDate: "2027-01-01" })) };
    await expect(loadEvolutionCompletionParents(config, wrong)).rejects.toThrow("selection");
    const sourceChanged = structuredClone(input.dataset); (sourceChanged.corpora[0]!.turns[3] as { text: string }).text += " current revision";
    await expect(loadEvolutionCompletionParents(config, sourceChanged)).rejects.toThrow("selection");
    const original = originalPlan(input, "lexical"), substituted = { ...original, cases: [{ ...original.cases[0]!, result: input.parents[0]!.prefix.result }] };
    reseal(substituted, "planSha256"); await writeFile(config.completionParents.lexical.pin.path, canonicalJson(substituted));
    await expect(loadEvolutionCompletionParents(config, input.dataset)).rejects.toThrow("pinned content changed");
    expect(() => projectEvolutionCompletionParents({ prefix: { plan: originalPlan(input, "prefix"), variantId: input.parents[0]!.prefix.variant.id },
      lexical: { plan: original, variantId: input.parents[0]!.lexical.variant.id }, semantic: { plan: original, variantId: input.parents[0]!.lexical.variant.id } }, input.dataset, input.manifestSha256)).toThrow("fixed parent");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generic reader, native judge and authenticated report consume V4 without changing request or scoring contracts", async () => {
  const source = corpus([turn("prefix"), turn("lexical"), turn("semantic")]);
  const dataset: Dataset = { corpora: [source], questions: [{ id: "synthetic-question", corpusId: source.id, ...question,
    category: "single-session-user", answer: "garage", unanswerable: false, evidenceTurnIds: ["lexical"], evidenceSessionIds: ["lexical"] }] };
  const manifest = createEvolutionDatasetManifest(dataset, { dataset: "longmemeval-s", revision: "synthetic-v1", sourceSha256: "a".repeat(64),
    groups: [{ groupId: source.groupId, partition: "development", exposure: "evaluated", evidence: "Synthetic fixture." }],
    histories: [{ corpusId: source.id, historyId: "synthetic-history" }] });
  const bytes = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
  const manifestBytes = bytes(manifest), projected = projectEvolutionRunnerInput(dataset), current = { ...projected.corpora[0]!, groupId: projected.corpora[0]!.id };
  const input: EvolutionCompletionPlanInput = { dataset: projected, manifestSha256: sha256Hex(manifestBytes), retrievalSourceSha256: "b".repeat(64),
    parents: [{ questionId: projected.questions[0]!.id, prefix: parent(current, prefixVariant, ["prefix"]),
      lexical: parent(current, poolVariant(false), ["lexical"]), semantic: parent(current, poolVariant(true), ["semantic"]) }] };
  const contextPlan = makeEvolutionCompletionPlan(input);
  expect(validateEvolutionAnyContextPlan(contextPlan)).toEqual(contextPlan); expect(() => validateEvolutionContextPlanSources(contextPlan, projected)).not.toThrow();
  const readerPlan = makeEvolutionReaderPlan(contextPlan, ["gpt5-nano-reader", "gpt5-mini-reader"]);
  expect(validateEvolutionReaderPlan(readerPlan, contextPlan)).toEqual(readerPlan);
  expect(readerPlan.requests).toEqual(prepareEvolutionCompletionReaderRequests(input, contextPlan, readerPlan.readerProfiles).requests);
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
  expect(report.coverage).toMatchObject({ logicalReaderCases: 4, logicalJudgeCases: 4, expectedQuestionsPerArm: 1, completeAttemptCoverage: true });
  expect(report.arms).toHaveLength(4); expect(report.arms.every(a => a.metrics.find(m => m.metric === "judge-accuracy")!.overall.mean === 1)).toBe(true);
  expect(report.cost.reader.physicalRequests).toBe(4); expect(report.cost.judge.physicalRequests).toBe(1);
  expect(report.comparisons).toHaveLength(4); expect(JSON.stringify(report)).not.toContain("Synthetic source");
  const stale = structuredClone(projected); (stale.corpora[0]!.turns[0] as { text: string }).text += " changed";
  expect(() => validateEvolutionContextPlanSources(contextPlan, stale)).toThrow();
});
