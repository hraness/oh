import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import type { Corpus } from "../scripts/benchmarks/datasets";
import type { EvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { EVOLUTION_DATE_GRAMMARS, evolutionInstant, evolutionQuestionInstant, parseEvolutionInstant } from "../scripts/benchmarks/evolution-dates";
import { validateEvolutionContextPlan, validateEvolutionContextPlanSources, validateEvolutionLegacyResultEnvelope,
  type EvolutionContextPlan } from "../scripts/benchmarks/evolution-plan";
import { createEvolutionContextSourceValidator, EVOLUTION_RECALL_SYSTEMS, EVOLUTION_RETRIEVAL_SYSTEMS, evolutionLegacyResult,
  evolutionLegacyVariant, evolutionRecallQueries, evolutionRecallWindow, evolutionSystemUsesSemantic, isEvolutionRecallSystem,
  prepareEvolutionCorpus, validateEvolutionContextSources, type EvolutionRecallSystem, type EvolutionRetrievalResultV2,
  type EvolutionRetrievalVariant } from "../scripts/benchmarks/evolution-retrieval";
import { EVOLUTION_CONTEXT_SOURCE_FILES } from "../scripts/benchmarks/evolution";
import { parseEvolutionExperimentVariant } from "../scripts/benchmarks/evolution-variants";
import { renderTurn } from "../scripts/benchmarks/retrieval";

/** Synthetic LongMemEval-shaped sessions: session timestamps carry the dataset grammar, turns keep source order. */
const corpus: Corpus = { id: "conversation-r", groupId: "family-r", turns: [
  { id: "t1", sessionId: "s-early", sessionIndex: 0, date: "2023/05/04 (Thu) 10:15", speaker: "user", text: "I bought a crimson kayak from the river shop." },
  { id: "t2", sessionId: "s-early", sessionIndex: 0, date: "2023/05/04 (Thu) 10:15", speaker: "assistant", text: "A crimson kayak sounds fun on the water." },
  { id: "t3", sessionId: "s-mid", sessionIndex: 1, date: "2023/05/20 (Sat) 09:02", speaker: "user", text: "Turquoise bicycle needs another basket." },
  { id: "t4", sessionId: "s-mid", sessionIndex: 1, date: "2023/05/20 (Sat) 09:02", speaker: "assistant", text: "A wicker basket fits most bicycle racks." },
  { id: "t5", sessionId: "s-late", sessionIndex: 2, date: "2023/05/24 (Wed) 18:40", speaker: "user", text: "The garden tomatoes are finally ripe." },
  { id: "t6", sessionId: "s-late", sessionIndex: 2, date: "2023/05/24 (Wed) 18:40", speaker: "assistant", text: "Ripe tomatoes are best picked in the morning." },
] };
const QUESTION_DATE = "2023/05/25 (Thu) 08:00";
const variant = (system: EvolutionRetrievalVariant["system"], topK = 20, contextBytes = 24_000): EvolutionRetrievalVariant => ({
  id: `${system}:${topK}:${contextBytes}`, system, budget: { topK, contextBytes },
});
const terms = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

/** A deterministic stand-in for the local vector lane: term overlap over the current records, at most `limit` hits. */
function overlapBackend(): OhSemanticSearchBackendV1 & { searches: string[] } {
  let indexed: readonly KnowledgeGraphRecordV1[] = [];
  const backend = { profile: OH_EMBEDDING_PROFILE_V1, searches: [] as string[],
    async index(records: readonly KnowledgeGraphRecordV1[]) { indexed = records; return { indexed: records.length, v: 1 as const }; },
    async search(query: string, limit: number) {
      backend.searches.push(query);
      const wanted = terms(query);
      return indexed.map(record => ({ record, overlap: [...terms(JSON.stringify(record.value))].filter(term => wanted.has(term)).length }))
        .filter(hit => hit.overlap > 0).sort((a, b) => b.overlap - a.overlap || a.record.key.localeCompare(b.record.key)).slice(0, limit)
        .map(hit => ({ key: hit.record.key, recordSha256: hit.record.recordSha256, score: hit.overlap, v: 1 as const }));
    },
    async close() {} };
  return backend;
}
function reseal(result: EvolutionRetrievalResultV2, mutate: (draft: any) => void): EvolutionRetrievalResultV2 {
  const changed = structuredClone(result) as any; mutate(changed);
  const { resultSha256: _ignored, ...payload } = changed;
  return { ...changed, resultSha256: canonicalSha256(payload) };
}

describe("evolution benchmark date grammars", () => {
  test("parse the two dataset timestamp forms strictly and fail closed on anything else", () => {
    expect(EVOLUTION_DATE_GRAMMARS).toEqual({ longmemeval: "YYYY/MM/DD (Www) HH:MM", locomo: "H:MM am|pm on D Month, YYYY", canonical: "YYYY-MM-DDTHH:MM:SS.mmmZ" });
    expect(parseEvolutionInstant("2023/05/20 (Sat) 02:21")).toBe("2023-05-20T02:21:00.000Z");
    expect(parseEvolutionInstant("2023/05/20 (Sun) 02:21")).toBeNull();
    expect(parseEvolutionInstant("2023/02/30 (Thu) 02:21")).toBeNull();
    expect(parseEvolutionInstant("1:56 pm on 8 May, 2023")).toBe("2023-05-08T13:56:00.000Z");
    expect(parseEvolutionInstant("12:05 am on 1 January, 2024")).toBe("2024-01-01T00:05:00.000Z");
    expect(parseEvolutionInstant("12:30 pm on 31 December, 2023")).toBe("2023-12-31T12:30:00.000Z");
    expect(parseEvolutionInstant("13:00 pm on 8 May, 2023")).toBeNull();
    expect(parseEvolutionInstant("1:56 pm on 8 Maij, 2023")).toBeNull();
    expect(parseEvolutionInstant("2023-05-20T02:21:00.000Z")).toBe("2023-05-20T02:21:00.000Z");
    for (const value of ["", "2023-05-20", "May 20 2023", 20230520, null, "2023/05/20 (Sat) 2:21", "x".repeat(300)]) {
      expect(parseEvolutionInstant(value)).toBeNull();
    }
    expect(() => evolutionInstant("2023-05-20", "turn date")).toThrow("turn date");
    expect(evolutionQuestionInstant("")).toBeNull();
    expect(evolutionQuestionInstant(QUESTION_DATE)).toBe("2023-05-25T08:00:00.000Z");
    expect(() => evolutionQuestionInstant("tomorrow")).toThrow("question date");
    expect(EVOLUTION_CONTEXT_SOURCE_FILES).toContain("scripts/benchmarks/evolution-dates.ts");
  });
});

describe("evolution recall systems", () => {
  test("declares the three recall systems as semantic, bounded, question-dated members", () => {
    expect(EVOLUTION_RECALL_SYSTEMS).toEqual(["oh-recall", "oh-recall-mq", "oh-recall-mq-dw"]);
    for (const system of EVOLUTION_RECALL_SYSTEMS) {
      expect(EVOLUTION_RETRIEVAL_SYSTEMS).toContain(system);
      expect(isEvolutionRecallSystem(system) && evolutionSystemUsesSemantic(system)).toBe(true);
      expect(parseEvolutionExperimentVariant({ id: "r", system, budget: { topK: 100, contextBytes: 96_000 } }).system).toBe(system);
      expect(() => parseEvolutionExperimentVariant({ id: "r", system, budget: { topK: 101, contextBytes: 96_000 } })).toThrow();
      expect(() => evolutionLegacyVariant(variant(system))).toThrow("question date");
    }
    expect(isEvolutionRecallSystem("oh-semantic")).toBe(false);
    expect(evolutionSystemUsesSemantic("oh-semantic") && evolutionSystemUsesSemantic("oh-hybrid") && !evolutionSystemUsesSemantic("oh-keyword")).toBe(true);
    expect(evolutionLegacyVariant(variant("oh-keyword")).system).toBe("oh-keyword");
    const question = "What color is my kayak and where did I buy it?";
    expect(evolutionRecallQueries(question, "oh-recall")).toEqual([question]);
    const multi = evolutionRecallQueries(question, "oh-recall-mq");
    expect(multi[0]).toBe(question);
    expect(multi.length).toBeGreaterThan(1);
    expect(multi.length).toBeLessThanOrEqual(6);
    expect(new Set(multi).size).toBe(multi.length);
    expect(evolutionRecallQueries(question, "oh-recall-mq-dw")).toEqual(multi);
    expect(() => evolutionRecallQueries("", "oh-recall")).toThrow("question");
    const asOf = "2023-05-25T08:00:00.000Z";
    expect(evolutionRecallWindow("What did I do last Saturday?", "oh-recall-mq-dw", asOf)).toEqual({ since: "2023-05-20T00:00:00.000Z", until: "2023-05-20T23:59:59.999Z", v: 1 });
    expect(evolutionRecallWindow("What did I do last Saturday?", "oh-recall-mq", asOf)).toBeNull();
    expect(evolutionRecallWindow("What did I do last Saturday?", "oh-recall-mq-dw", null)).toBeNull();
    expect(evolutionRecallWindow("What color is my kayak?", "oh-recall-mq-dw", asOf)).toBeNull();
    expect(evolutionRecallWindow("What did I do the day before yesterday?", "oh-recall-mq-dw", asOf)).toBeNull();
  });

  test("renders dated chronological V2 contexts from raw turns while oh-semantic keeps its V1 bytes", async () => {
    const backend = overlapBackend();
    const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
    try {
      const question = "What color is my kayak?";
      const semantic = await prepared.retrieve(question, variant("oh-semantic"), QUESTION_DATE);
      expect(semantic.protocol).toBe("oh.evolution-retrieval.v1");
      const legacy = evolutionLegacyResult(semantic);
      expect(legacy.context).toBe(legacy.turnIds.map(id => corpus.turns.find(turn => turn.id === id)!).map(renderTurn).join("\n\n"));
      expect(await prepared.retrieve(question, variant("oh-semantic"))).toEqual(semantic);
      validateEvolutionContextSources(corpus, semantic, { semantic: true });

      const recall = await prepared.retrieve(question, variant("oh-recall"), QUESTION_DATE);
      expect(recall.protocol).toBe("oh.evolution-retrieval.v2");
      expect(Object.keys(recall)).toEqual(["protocol", "preparedSha256", "variantSha256", "querySha256", "asOf", "renderer", "queries", "window",
        "context", "contextSha256", "contextBytes", "turnIds", "sessionIds", "sources", "derived", "omittedForBudget", "resultSha256"]);
      expect(recall).toMatchObject({ asOf: "2023-05-25T08:00:00.000Z", renderer: "oh.recall-render.v1", queries: [question], window: null, derived: [],
        omittedForBudget: 0, preparedSha256: semantic.preparedSha256, querySha256: sha256Hex(question), variantSha256: canonicalSha256(variant("oh-recall")) });
      expect(recall.context.startsWith("Question date: 2023/05/25 (Thu)\n\nDate: 2023/05/04 (Thu), 21 days before the question\n")).toBe(true);
      expect(recall.context).toContain(renderTurn(corpus.turns[0]!));
      expect(recall.context).not.toContain("[3 weeks later]");
      expect(recall.turnIds).toEqual(["t1", "t2"]);
      expect(recall.sessionIds).toEqual(["s-early"]);
      expect(recall.sources.map(source => source.turnId)).toEqual(recall.turnIds);
      expect(recall.contextSha256).toBe(sha256Hex(recall.context));
      expect(recall.contextBytes).toBe(Buffer.byteLength(recall.context));
      const { resultSha256, ...payload } = recall;
      expect(resultSha256).toBe(canonicalSha256(payload));
      expect(JSON.parse(JSON.stringify(recall))).toEqual(recall);
      expect(new Set(recall.turnIds)).toEqual(new Set(legacy.turnIds));

      await expect(prepared.retrieve(question, variant("oh-recall"))).rejects.toThrow("question date");
      await expect(prepared.retrieve(question, variant("oh-recall", 101), QUESTION_DATE)).rejects.toThrow("1 through 100");
      await expect(prepared.retrieve(question, variant("oh-recall"), "2023-05-25")).rejects.toThrow("question date");
      const undated = await prepared.retrieve(question, variant("oh-recall"), "");
      expect(undated.asOf).toBeNull();
      expect(undated.context.startsWith("Question date:")).toBe(false);
      expect(undated.context).toBe(legacy.context);
      expect(prepared.stats.semanticIndexBuilds).toBe(1);
    } finally { await prepared.close(); }
  });

  test("fuses several bounded queries and applies the date window only under the -dw system", async () => {
    const backend = overlapBackend();
    const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
    try {
      const question = "Which basket did I want for my bicycle and when did I buy the kayak?";
      const single = await prepared.retrieve(question, variant("oh-recall", 2), QUESTION_DATE);
      backend.searches.length = 0;
      const multi = await prepared.retrieve(question, variant("oh-recall-mq", 2), QUESTION_DATE);
      expect(multi.queries.length).toBeGreaterThan(1);
      expect(backend.searches).toEqual([...multi.queries]);
      expect(multi.turnIds.length).toBeLessThanOrEqual(2);
      expect(single.turnIds.length).toBeLessThanOrEqual(2);
      expect(multi.window).toBeNull();
      expect(multi.context.split("\n\n").filter(block => block.startsWith("Date: "))).toHaveLength(multi.sessionIds.length);
      // Chronological blocks: every dated header precedes its turns and dates never decrease.
      const headers = [...multi.context.matchAll(/^Date: (\d{4}\/\d{2}\/\d{2})/gmu)].map(match => match[1]!);
      expect([...headers].sort()).toEqual(headers);

      const dated = await prepared.retrieve("What did I plant last Wednesday?", variant("oh-recall-mq-dw", 2), QUESTION_DATE);
      expect(dated.window).toEqual({ since: "2023-05-24T00:00:00.000Z", until: "2023-05-24T23:59:59.999Z", v: 1 });
      expect(dated.turnIds).toContain("t5");
      expect(dated.context).toContain("Date: 2023/05/24 (Wed), 1 day before the question");
      const noWindow = await prepared.retrieve("What did I plant?", variant("oh-recall-mq-dw", 2), QUESTION_DATE);
      expect(noWindow.window).toBeNull();
      const validate = createEvolutionContextSourceValidator(corpus, { semantic: true });
      validate(dated, { question: "What did I plant last Wednesday?", questionDate: QUESTION_DATE, system: "oh-recall-mq-dw" });
      validate(noWindow, { question: "What did I plant?", questionDate: QUESTION_DATE, system: "oh-recall-mq-dw" });
      validate(multi, { question, questionDate: QUESTION_DATE, system: "oh-recall-mq" });
      expect(() => validate(dated, { question: "What did I plant last Wednesday?", questionDate: QUESTION_DATE, system: "oh-recall-mq" })).toThrow("source identity");
      const tight = await prepared.retrieve(question, variant("oh-recall-mq", 6, 200), QUESTION_DATE);
      expect(tight.omittedForBudget).toBeGreaterThan(0);
      expect(tight.contextBytes).toBeLessThanOrEqual(200);
      validate(tight, { question, questionDate: QUESTION_DATE, system: "oh-recall-mq" });
    } finally { await prepared.close(); }
  });

  test("the V2 validator re-renders under the question instant and rejects resealed claims", async () => {
    const backend = overlapBackend();
    const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
    const question = "What color is my kayak?", context = { question, questionDate: QUESTION_DATE, system: "oh-recall" as EvolutionRecallSystem };
    try {
      const original = await prepared.retrieve(question, variant("oh-recall"), QUESTION_DATE);
      const validate = createEvolutionContextSourceValidator(corpus, { semantic: true });
      const before = prepared.stats;
      validate(original, context);
      validateEvolutionContextSources(corpus, JSON.parse(JSON.stringify(original)), { semantic: true, question: context });
      expect(prepared.stats).toEqual(before);
      expect(() => validate(original)).toThrow("requires the question");
      expect(() => validate(original, { ...context, system: "oh-semantic" as never })).toThrow("requires the question");
      expect(() => createEvolutionContextSourceValidator(corpus)(original, context)).toThrow("source identity");
      expect(() => validate(original, { ...context, question: "Another question" })).toThrow("source identity");
      expect(() => validate(original, { ...context, questionDate: "2023/05/26 (Fri) 08:00" })).toThrow("source identity");
      for (const mutate of [
        (r: any) => { r.context = r.context.replace("crimson", "violet"); r.contextBytes = Buffer.byteLength(r.context); r.contextSha256 = sha256Hex(r.context); },
        (r: any) => { r.asOf = "2023-05-26T08:00:00.000Z"; },
        (r: any) => { r.asOf = null; },
        (r: any) => { r.queries = ["kayak"]; },
        (r: any) => { r.window = { since: "2023-05-04T00:00:00.000Z", until: "2023-05-04T23:59:59.999Z", v: 1 }; },
        (r: any) => { r.renderer = "oh.recall-render.v2"; },
        (r: any) => { r.derived = [{ text: "fabricated memory" }]; },
        (r: any) => { r.turnIds = [...r.turnIds].reverse(); r.sources = [...r.sources].reverse(); },
        (r: any) => { r.turnIds.push("t5"); r.sources.push({ turnId: "t5", sessionId: "s-late", key: "edition:turn-00004", recordSha256: r.sources[0].recordSha256 }); },
        (r: any) => { r.sources[0].recordSha256 = sha256Hex("different source"); },
        (r: any) => { r.sessionIds = ["s-late"]; },
        (r: any) => { r.preparedSha256 = sha256Hex("another-corpus"); },
        (r: any) => { r.protocol = "oh.evolution-retrieval.v3"; },
        (r: any) => { r.extra = "unrecognized field"; },
        (r: any) => { delete r.derived; },
      ]) {
        expect(() => validate(reseal(original, mutate), context)).toThrow();
      }
      expect(() => createEvolutionContextSourceValidator(corpus, { derivedRecords: [{} as never] })).toThrow("derived records");
      expect(() => evolutionLegacyResult(original)).toThrow("not admitted");
      const changedCorpus = { ...corpus, turns: corpus.turns.map(turn => ({ ...turn, text: `${turn.text} changed` })) };
      expect(() => validateEvolutionContextSources(changedCorpus, original, { semantic: true, question: context })).toThrow("source identity");
      const undatedCorpus = { ...corpus, turns: corpus.turns.map(turn => ({ ...turn, date: "2023-05-04" })) };
      const plain = await prepareEvolutionCorpus(undatedCorpus, { semanticBackend: overlapBackend() });
      try { await expect(plain.retrieve(question, variant("oh-recall"), QUESTION_DATE)).rejects.toThrow("turn date"); }
      finally { await plain.close(); }
    } finally { await prepared.close(); }
  });

  test("context plans dispatch validation by result protocol and bind each result to its variant system", async () => {
    const backend = overlapBackend();
    // The runner projects each corpus with groupId = id before preparation and validation.
    const prepared = await prepareEvolutionCorpus({ ...corpus, groupId: corpus.id }, { semanticBackend: backend });
    try {
      const input: EvolutionRunnerInput = { corpora: [{ id: corpus.id, turns: corpus.turns }],
        questions: [{ id: "q-r", corpusId: corpus.id, question: "What color is my kayak?", questionDate: QUESTION_DATE }] };
      const variants = [variant("oh-semantic"), variant("oh-recall"), variant("oh-recall-mq-dw")];
      const cases = [];
      for (const v of variants) cases.push({ questionId: "q-r", variantId: v.id, result: await prepared.retrieve(input.questions[0]!.question, v, QUESTION_DATE) });
      const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: sha256Hex("manifest"), retrievalSourceSha256: sha256Hex("source"),
        inputSha256: canonicalSha256(input), variants, questions: input.questions, cases };
      const plan: EvolutionContextPlan = { ...payload, planSha256: canonicalSha256(payload) };
      expect(validateEvolutionContextPlan(plan)).toEqual(plan);
      validateEvolutionContextPlanSources(plan, input);
      for (const c of plan.cases) validateEvolutionLegacyResultEnvelope(c.result, input.questions[0]!, 24_000);
      expect(() => validateEvolutionLegacyResultEnvelope({ ...cases[1]!.result, extra: 1 }, input.questions[0]!, 24_000)).toThrow("recall result contract");
      expect(() => validateEvolutionLegacyResultEnvelope({ ...cases[1]!.result, derived: [1] }, input.questions[0]!, 24_000)).toThrow("recall result contract");
      const resealPlan = (mutate: (draft: any) => void) => {
        const draft = structuredClone(plan) as any; mutate(draft);
        for (const c of draft.cases) { const { resultSha256: _r, ...rest } = c.result; c.result.resultSha256 = canonicalSha256(rest); }
        const { planSha256: _p, ...rest } = draft; return { ...draft, planSha256: canonicalSha256(rest) };
      };
      // A V1 whole-turn result relabeled as the recall variant (digests resealed) is refused by protocol before source validation.
      expect(() => validateEvolutionContextPlanSources(resealPlan(draft => {
        draft.cases[1].result = structuredClone(cases[0]!.result); draft.cases[1].result.variantSha256 = canonicalSha256(variants[1]);
      }), input)).toThrow("result protocol");
      // A -dw result resealed under the plain recall variant fails the V2 re-derivation of queries and window.
      expect(() => validateEvolutionContextPlanSources(resealPlan(draft => {
        draft.cases[1].result = structuredClone(cases[2]!.result); draft.cases[1].result.variantSha256 = canonicalSha256(variants[1]);
      }), input)).toThrow("source identity");
    } finally { await prepared.close(); }
  });
});
