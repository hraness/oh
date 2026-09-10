import { describe, expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { EVOLUTION_CONTEXT_SOURCE_FILES, parseEvolutionRunConfig } from "../scripts/benchmarks/evolution";
import { makeEvolutionContextPlan, makeEvolutionExperimentContextPlan, makeEvolutionReaderPlan,
  validateEvolutionAnyContextPlan, validateEvolutionContextPlan, validateEvolutionContextPlanSources,
  validateEvolutionReaderPlan } from "../scripts/benchmarks/evolution-plan";
import { makeEvolutionJudgePlan } from "../scripts/benchmarks/evolution-judge";
import { buildEvolutionReport } from "../scripts/benchmarks/evolution-report";
import { EVOLUTION_GATEWAY_ENDPOINT, parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { createEvolutionSeedCandidate, crossoverEvolutionCandidates, mutateEvolutionCandidate, parseEvolutionPopulationPolicy,
  validateEvolutionCandidate, type EvolutionGenome } from "../scripts/benchmarks/evolution-population";
import { renderOhSourceSpan } from "../scripts/benchmarks/evolution-spans";
import { EVOLUTION_RETRIEVAL_SYSTEMS, prepareEvolutionCorpus, type EvolutionRetrievalVariant } from "../scripts/benchmarks/evolution-retrieval";
import { parseEvolutionExperimentVariant, type EvolutionExperimentVariant } from "../scripts/benchmarks/evolution-variants";

const bytes = (value: unknown) => new TextEncoder().encode(canonicalJson(value));
const corpus = { id: "synthetic-corpus", groupId: "synthetic-family", turns: [
  { id: "D1:1", sessionId: "session-one", sessionIndex: 0, date: "2026-01-01", speaker: "user", text: "I visited Paris 🗼 during my summer holiday. I travelled by train. My next trip is next Friday." },
  { id: "D2:1", sessionId: "session-two", sessionIndex: 1, date: "2026-02-01", speaker: "user", text: "I bought a red bicycle. My bicycle arrived yesterday. My old bicycle was blue." },
  { id: "D3:1", sessionId: "session-three", sessionIndex: 2, date: "2026-03-01", speaker: "user", text: "The unrelated recipe uses oats and apples." },
] };
const dataset: Dataset = { corpora: [corpus], questions: [
  { id: "where", corpusId: corpus.id, category: "single-session-user", question: "Where did I visit during my summer holiday?", questionDate: "2026-03-01", answer: "Paris", unanswerable: false, evidenceTurnIds: ["D1:1"], evidenceSessionIds: ["session-one"] },
  { id: "bicycle", corpusId: corpus.id, category: "knowledge-update", question: "What color is my bicycle?", questionDate: "2026-03-01", answer: "red", unanswerable: false, evidenceTurnIds: ["D2:1"], evidenceSessionIds: ["session-two"] },
] };
const native: EvolutionRetrievalVariant[] = [24_000, 48_000, 96_000].map(contextBytes => ({ id: `whole-${contextBytes}`, system: "oh-keyword", budget: { topK: 100, contextBytes } }));
const variants: EvolutionExperimentVariant[] = [...native, ...[24_000, 48_000, 96_000].map(contextBytes => ({ id: `span-${contextBytes}`, system: "oh-source-spans" as const, budget: { topK: 100 as const, contextBytes } }))];
const projected = () => projectEvolutionRunnerInput(dataset);
const manifest = createEvolutionDatasetManifest(dataset, { dataset: "longmemeval-s", revision: "synthetic-source-spans-v2", sourceSha256: "a".repeat(64),
  groups: [{ groupId: corpus.groupId, partition: "development", exposure: "evaluated", evidence: "Synthetic implementation fixture." }],
  histories: [{ corpusId: corpus.id, historyId: "synthetic-history" }] });
const manifestBytes = bytes(manifest), manifestSha256 = sha256Hex(manifestBytes);
const options = () => ({ dataset: projected(), variants, manifestSha256, retrievalSourceSha256: "b".repeat(64) });
async function fixture() {
  const result = await makeEvolutionExperimentContextPlan(options());
  if (result.plan.protocol !== "oh.memory.evolution-context-plan.v2") throw new Error("Expected explicit span plan");
  return { ...result, plan: result.plan };
}
function reseal(value: any, field: string) {
  const { [field]: _old, ...payload } = value; value[field] = canonicalSha256(payload); return value;
}
function resealResult(value: any) {
  value.contextSha256 = sha256Hex(value.context); value.contextBytes = Buffer.byteLength(value.context);
  return reseal(value, "resultSha256");
}
function raw(request: EvolutionRequest, answer: string) {
  return bytes({ model: request.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 100, completion_tokens: 3, total_tokens: 103 },
    ...(request.endpoint === EVOLUTION_GATEWAY_ENDPOINT ? { providerMetadata: { gateway: { routing: {
      finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model,
      resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1),
    } } } } : {}) });
}
const phase = (kind: "reader" | "judge", planSha256: string, responses: ReadonlyMap<string, EvolutionResponse>) => bytes({
  protocol: "oh.memory.evolution-phase.v1", phase: kind, planSha256, complete: true,
  responses: [...responses].map(([requestSha256, response]) => ({ requestSha256, response })),
});

describe("explicit versioned source-span plans", () => {
  test("prepares each corpus once, shares one native pool per question, and reuses deterministic span budgets", async () => {
    const f = await fixture(), again = await fixture();
    expect(f.plan).toEqual(again.plan);
    expect(f.timing).toHaveLength(1); expect(f.timing[0]!.queries).toBe(2 * (1 + native.length));
    expect(f.plan.cases).toHaveLength(12); expect(f.plan.pools).toHaveLength(2);
    expect(validateEvolutionAnyContextPlan(f.plan)).toEqual(f.plan);
    expect(() => validateEvolutionContextPlanSources(f.plan, projected())).not.toThrow();
    expect(JSON.stringify(f.plan)).not.toContain('"answer"');
    for (const c of f.plan.cases) {
      expect(c.result.contextBytes).toBeLessThanOrEqual(variants.find(v => v.id === c.variantId)!.budget.contextBytes);
      if (c.kind === "source-spans") {
        expect(c.result.poolResultSha256).toBe(f.plan.pools.find(p => p.questionId === c.questionId)!.result.resultSha256);
        expect(c.result.context).toBe(c.result.spans.map(renderOhSourceSpan).join("\n\n"));
        for (const span of c.result.spans) {
          const turn = corpus.turns.find(t => t.id === span.turnId)!;
          expect(Buffer.from(turn.text).subarray(span.startByte, span.endByte).toString("utf8")).toBe(span.text);
          expect(span).toMatchObject({ date: turn.date, speaker: turn.speaker, sessionId: turn.sessionId, sessionIndex: turn.sessionIndex });
        }
      }
    }
    expect(() => validateEvolutionContextPlan(f.plan as never)).toThrow();
  });

  test("native-only dispatch preserves V1 bytes and identical native reader requests across V1 and V2", async () => {
    const input = { ...options(), variants: native }, old = await makeEvolutionContextPlan(input);
    const dispatched = await makeEvolutionExperimentContextPlan(input), mixed = await fixture();
    expect(dispatched.plan).toEqual(old.plan); expect(dispatched.plan.protocol).toBe("oh.memory.evolution-context-plan.v1");
    const readers = ["gpt5-nano-reader", "gpt5-mini-reader"] as const;
    const v1 = makeEvolutionReaderPlan(old.plan, readers), v2 = makeEvolutionReaderPlan(mixed.plan, readers);
    expect(validateEvolutionReaderPlan(v2, mixed.plan)).toEqual(v2);
    expect(v2.cases).toHaveLength(24); expect(v2.requests).toHaveLength(8);
    for (const c of v1.cases) expect(v2.cases.find(v => v.questionId === c.questionId && v.variantId === c.variantId && v.reader === c.reader)).toEqual(c);
    const perReader = v2.cases.filter(c => c.questionId === mixed.plan.questions[0]!.id && c.reader === readers[0] && c.variantId.startsWith("span"));
    expect(new Set(perReader.map(c => c.requestSha256)).size).toBe(1);
    expect(v1.requests.every(request => v2.requests.some(other => canonicalSha256(request) === canonicalSha256(other)))).toBeTrue();
  });

  test("projects only authorized source fields even when gold getters would throw", async () => {
    const input = projected();
    for (const target of [input, input.corpora[0]!, input.corpora[0]!.turns[0]!, input.questions[0]!]) {
      Object.defineProperty(target, "answer", { enumerable: true, get() { throw new Error("Gold getter entered retrieval"); } });
      Object.defineProperty(target, "evidenceTurnIds", { enumerable: true, get() { throw new Error("Evidence getter entered retrieval"); } });
    }
    const clean = await fixture(), trapped = await makeEvolutionExperimentContextPlan({ ...options(), dataset: input });
    expect(trapped.plan).toEqual(clean.plan);
  });

  test("resealed metadata, offset, text, overlap, budget, and common provenance attacks fail source authentication", async () => {
    const { plan } = await fixture();
    const attacks: Array<(result: any) => void> = [
      r => { r.spans[0].speaker = "forged"; }, r => { r.spans[0].date = "2020-01-01"; },
      r => { r.spans[0].sessionIndex = 99; }, r => { r.spans[0].recordSha256 = "c".repeat(64); },
      r => { r.spans[0].sourceTextSha256 = "d".repeat(64); }, r => { r.spans[0].startByte++; },
      r => { r.spans[0].text = "The invented answer is Rome."; }, r => { r.spans.push({ ...r.spans[0] }); },
      r => { r.contextByteLimit = 48_000; }, r => { r.turnIds = ["absent"]; }, r => { r.sessionIds = ["absent"]; },
      r => { r.poolResultSha256 = "e".repeat(64); }, r => { r.spans[0].key = "edition:absent"; },
    ];
    for (const attack of attacks) {
      const invalid = structuredClone(plan) as any, row = invalid.cases.find((c: any) => c.kind === "source-spans");
      expect(row.result.spans.length).toBeGreaterThan(0); attack(row.result);
      row.result.context = row.result.spans.map(renderOhSourceSpan).join("\n\n"); resealResult(row.result); reseal(invalid, "planSha256");
      expect(() => validateEvolutionContextPlanSources(invalid, projected())).toThrow();
    }
    const original = projected(), stale = structuredClone(plan) as any;
    const changed = { ...original, corpora: original.corpora.map(c => ({ ...c, turns: c.turns.map((t, index) =>
      index === 2 ? { ...t, text: t.text + " A later canonical record revision." } : t) })) };
    stale.inputSha256 = canonicalSha256(changed); reseal(stale, "planSha256");
    expect(() => validateEvolutionContextPlanSources(stale, changed)).toThrow("source");
  });

  test("rejects resealed unknown shapes, missing or foreign pools, incompatible treatments, and duplicate corpus inputs", async () => {
    const { plan } = await fixture();
    for (const attack of [
      (p: any) => { p.pools.pop(); }, (p: any) => { p.pools[1] = p.pools[0]; },
      (p: any) => { p.pools[0].questionId = "foreign"; }, (p: any) => { p.pools[0].result.omittedForBudget = 1; resealResult(p.pools[0].result); },
      (p: any) => { p.cases.find((c: any) => c.kind === "source-spans").kind = "whole-turn"; },
      (p: any) => { p.cases.find((c: any) => c.kind === "source-spans").result.sources = []; },
      (p: any) => { p.variants.find((v: any) => v.system === "oh-source-spans").budget.topK = 20; },
      (p: any) => { p.extra = "undeclared treatment"; }, (p: any) => { p.questions[0].answer = "forbidden"; },
      (p: any) => { p.cases[0].result.sources[0].recordSha256 = null; resealResult(p.cases[0].result); },
    ]) { const invalid = structuredClone(plan) as any; attack(invalid); reseal(invalid, "planSha256"); expect(() => validateEvolutionAnyContextPlan(invalid)).toThrow(); }
    const input = projected();
    await expect(makeEvolutionExperimentContextPlan({ ...options(), dataset: { ...input, corpora: [...input.corpora, input.corpora[0]!] } })).rejects.toThrow();
    expect(() => validateEvolutionAnyContextPlan(null as never)).toThrow();
  });

  test("config requires explicit V2, bounded top100 spans, and pins both implementation modules", async () => {
    const pin = { path: "/example/config.json", sha256: "b".repeat(64) };
    const config = { protocol: "oh.memory.evolution-run.v2", dataset: "longmemeval-s", datasetPin: { ...pin, sha256: DATASETS["longmemeval-s"].sha256 },
      manifestPin: pin, campaignPin: pin, limit: 100, seed: 7, variants, readers: ["gpt5-nano-reader", "gpt5-mini-reader"],
      judge: "gpt4o-gateway-judge", directory: "/example/run", storeDirectory: "/example/store", concurrency: 6 };
    expect(parseEvolutionRunConfig(config).variants).toEqual(variants);
    expect(() => parseEvolutionRunConfig({ ...config, protocol: "oh.memory.evolution-run.v1" })).toThrow("V2");
    expect(() => parseEvolutionRunConfig({ ...config, variants: native })).toThrow("V1");
    for (const budget of [{ topK: 20, contextBytes: 24_000 }, { topK: 100, contextBytes: 96_001 }]) {
      expect(() => parseEvolutionExperimentVariant({ id: "span", system: "oh-source-spans", budget })).toThrow();
    }
    expect(EVOLUTION_CONTEXT_SOURCE_FILES).toContain("scripts/benchmarks/evolution-spans.ts");
    expect(EVOLUTION_CONTEXT_SOURCE_FILES).toContain("scripts/benchmarks/evolution-variants.ts");
    expect(EVOLUTION_CONTEXT_SOURCE_FILES).toContain("scripts/benchmarks/evolution-dates.ts");
    expect(EVOLUTION_RETRIEVAL_SYSTEMS as readonly string[]).not.toContain("oh-source-spans");
    const prepared = await prepareEvolutionCorpus(corpus);
    try { await expect(prepared.retrieve("Paris", variants.at(-1)! as never)).rejects.toThrow("Unknown"); }
    finally { await prepared.close(); }
  });

  test("mixed plans produce authenticated complete reader/judge/report matrices with synthetic raw captures only", async () => {
    const { plan: contextPlan } = await fixture(), readerPlan = makeEvolutionReaderPlan(contextPlan, ["gpt5-nano-reader", "gpt5-mini-reader"]);
    const captures = new Map<string, Uint8Array>(), readers = new Map<string, EvolutionResponse>();
    for (const request of readerPlan.requests) {
      const c = readerPlan.cases.find(c => c.requestSha256 === request.requestSha256)!;
      const index = contextPlan.questions.findIndex(q => q.id === c.questionId), response = raw(request, dataset.questions[index]!.answer);
      captures.set(request.requestSha256, response); readers.set(request.requestSha256, parseEvolutionResponse(response, request));
    }
    const readerOutputBytes = phase("reader", readerPlan.planSha256, readers);
    const judgePlan = makeEvolutionJudgePlan({ contextPlan, readerPlan, responses: readers, dataset, profile: "gpt4o-gateway-judge",
      rubric: await loadJudgeProfile(), readerOutputSha256: sha256Hex(readerOutputBytes) });
    const judges = new Map<string, EvolutionResponse>();
    for (const request of judgePlan.requests) {
      const response = raw(request, "yes"); captures.set(request.requestSha256, response); judges.set(request.requestSha256, parseEvolutionResponse(response, request));
    }
    const judgeOutputBytes = phase("judge", judgePlan.planSha256, judges), input = { dataset, manifestBytes, manifestSha256,
      contextPlan, readerPlan, judgePlan, readerOutputBytes, judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes),
      loadRawResponse: async (request: EvolutionRequest) => captures.get(request.requestSha256)! };
    const report = await buildEvolutionReport(input);
    expect(report.coverage).toMatchObject({ logicalReaderCases: 24, logicalJudgeCases: 24, expectedQuestionsPerArm: 2, completeAttemptCoverage: true });
    expect(report.arms).toHaveLength(12); expect(report.cost.reader.physicalRequests).toBe(8);
    expect(report.cost.accountedMicros).toBe([...readers.values(), ...judges.values()].reduce((sum, r) => sum + r.usage.micros, 0));
    expect(report.qualification).toContain("no superiority claim");
    for (const arm of report.arms) expect(arm.metrics.find(m => m.metric === "judge-accuracy")!.overall).toMatchObject({ cases: 2, scored: 2 });
    expect(JSON.stringify(report)).not.toContain("Paris");
    const invalid = structuredClone(contextPlan) as any, c = invalid.cases.find((c: any) => c.kind === "source-spans");
    c.result.spans[0].text = "A fabricated source sentence."; c.result.context = c.result.spans.map(renderOhSourceSpan).join("\n\n");
    resealResult(c.result); reseal(invalid, "planSha256");
    await expect(buildEvolutionReport({ ...input, contextPlan: invalid })).rejects.toThrow();
  });

  test("fixed-reader evolution only breeds compatible span systems, caps and top100 candidate pools", () => {
    const domain = { protocol: "oh.evolution-population-policy.v1", mode: "fixed-reader-memory", fixedReader: "gpt5-mini-reader",
      allowed: { system: ["oh-keyword", "oh-source-spans"], topK: [20, 100], contextBytes: [24_000, 48_000, 96_000, 120_000], reader: ["gpt5-mini-reader"] }, maximumPopulation: 16 };
    const policy = parseEvolutionPopulationPolicy(domain), g: EvolutionGenome = { system: "oh-source-spans", topK: 100, contextBytes: 24_000, reader: "gpt5-mini-reader" };
    const left = createEvolutionSeedCandidate(g, policy, { seed: 1, hypothesis: "Retain verbatim spans from the native top100 pool" });
    const right = createEvolutionSeedCandidate({ ...g, system: "oh-keyword", topK: 20, contextBytes: 120_000 }, policy, { seed: 2, hypothesis: "Compare whole sources" });
    expect(() => createEvolutionSeedCandidate({ ...g, topK: 20 }, policy, { seed: 1, hypothesis: "Invalid pool size" })).toThrow();
    expect(() => createEvolutionSeedCandidate({ ...g, contextBytes: 120_000 }, policy, { seed: 1, hypothesis: "Invalid cap" })).toThrow();
    expect(() => parseEvolutionPopulationPolicy({ ...domain, allowed: { ...domain.allowed, topK: [20] } })).toThrow();
    expect(() => mutateEvolutionCandidate(left, policy, { seed: 3, hypothesis: "Invalid topK mutation", axis: "topK" })).toThrow();
    for (let seed = 0; seed < 24; seed++) {
      const options = { seed, hypothesis: "Only combine compatible parental genes" }, child = crossoverEvolutionCandidates(left, right, policy, options);
      expect(child).toEqual(crossoverEvolutionCandidates(left, right, policy, options)); expect(validateEvolutionCandidate(child, policy)).toEqual(child);
      expect(child.genome.reader).toBe(g.reader); expect(child.parentIds).toEqual([left.id, right.id]);
      if (child.genome.system === "oh-source-spans") { expect(child.genome.topK).toBe(100); expect(child.genome.contextBytes).toBeLessThanOrEqual(96_000); }
      const mutation = mutateEvolutionCandidate(left, policy, { ...options, axis: "contextBytes" });
      expect(mutation.genome.contextBytes).toBeLessThanOrEqual(96_000); expect(mutation.genome.reader).toBe(g.reader);
    }
  });
});
