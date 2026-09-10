import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { assertExactEvolutionCoverage, type EvolutionRunnerInput, type EvolutionRunnerQuestion } from "./evolution-dataset";
import { createEvolutionContextSourceValidator, evolutionLegacyVariant, prepareEvolutionCorpus, type EvolutionRetrievalResult } from "./evolution-retrieval";
import { createOhSourceSpanPacker, OH_SPAN_POLICY, OH_SPAN_POOL_VARIANT, type OhSourceSpanResult } from "./evolution-spans";
import { createOhSourceSpanPrototype, OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT, OH_SPAN_PROTOTYPE_POLICY, type OhPrototypeResult } from "./evolution-spans-prototype";
import { createEvolutionFullHistorySource, validateEvolutionFullHistoryResult, type EvolutionFullHistoryResult } from "./evolution-full-history";
import { isEvolutionV3Treatment, parseEvolutionTreatment, type EvolutionTreatment } from "./evolution-treatments-v3";
import { validateEvolutionLegacyResultEnvelope } from "./evolution-plan";
import type { Turn } from "./datasets";

type PoolKind = "raw" | "focused";
export type EvolutionContextCaseV3 = Readonly<{ questionId: string; variantId: string }> & (
  Readonly<{ kind: "whole-turn"; result: EvolutionRetrievalResult }> |
  Readonly<{ kind: "source-spans"; result: OhSourceSpanResult }> |
  Readonly<{ kind: "source-spans-v2"; result: OhPrototypeResult }> |
  Readonly<{ kind: "full-history"; result: EvolutionFullHistoryResult }>);
export type EvolutionContextPlanV3 = Readonly<{ protocol: "oh.memory.evolution-context-plan.v3";
  manifestSha256: string; retrievalSourceSha256: string; inputSha256: string; variants: readonly EvolutionTreatment[];
  questions: readonly EvolutionRunnerQuestion[]; cases: readonly EvolutionContextCaseV3[];
  pools: readonly Readonly<{ questionId: string; kind: PoolKind; result: EvolutionRetrievalResult }>[]; planSha256: string }>;
function fail(reason: string): never { throw new TypeError(`Evolution V3 plan: ${reason}.`); }
const digest = (v: unknown) => { if (parseSha256Hex(v) === null) fail("invalid digest"); };
const pair = (a: string, b: string) => JSON.stringify([a, b]);
const poolVariant = (kind: PoolKind) => kind === "raw" ? OH_SPAN_POOL_VARIANT : OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT;
const poolKinds = (variants: readonly EvolutionTreatment[]): PoolKind[] => [
  ...(variants.some(v => v.system === "oh-source-spans") ? ["raw" as const] : []),
  ...(variants.some(v => v.system === "oh-source-spans-v2") ? ["focused" as const] : []),
];
function project(input: EvolutionRunnerInput): EvolutionRunnerInput {
  if (!Array.isArray(input.corpora) || input.corpora.length < 1 || input.corpora.length > 2000
    || !Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 2000) fail("input bounds");
  const corpora = input.corpora.map(c => {
    if (!Array.isArray(c.turns) || c.turns.length < 1 || c.turns.length > 8192) fail("source turn bounds");
    return { id: c.id, turns: c.turns.map((t: Turn) => ({ id: t.id, sessionId: t.sessionId,
      ...(t.sessionIndex === undefined ? {} : { sessionIndex: t.sessionIndex }), date: t.date, speaker: t.speaker, text: t.text })) };
  });
  const questions = input.questions.map(q => ({ id: q.id, corpusId: q.corpusId, question: q.question, questionDate: q.questionDate }));
  assertExactEvolutionCoverage(questions.map(q => q.id), questions.map(q => q.id));
  assertExactEvolutionCoverage([...new Set(questions.map(q => q.corpusId))], corpora.map(c => c.id));
  return { corpora, questions };
}

/** Each source corpus is prepared once; both pool types are shared across mechanisms and readers. */
export async function makeEvolutionContextPlanV3(input: Readonly<{ dataset: EvolutionRunnerInput;
  variants: readonly EvolutionTreatment[]; manifestSha256: string; retrievalSourceSha256: string }>) {
  const variants = input.variants.map(parseEvolutionTreatment), dataset = project(input.dataset), kinds = poolKinds(variants);
  if (!variants.some(isEvolutionV3Treatment) || variants.length > 32 || new Set(variants.map(v => v.id)).size !== variants.length) fail("distinct V3 treatments required");
  const cases: EvolutionContextCaseV3[] = [], pools: EvolutionContextPlanV3["pools"][number][] = [];
  const timing: Array<{ corpusId: string; preparationMs: number; retrievalMs: number; queries: number }> = [];
  for (const corpus of dataset.corpora) {
    const source = { ...corpus, groupId: corpus.id }, start = performance.now();
    const needsRetrieval = variants.some(v => v.system !== "full-history");
    const prepared = needsRetrieval ? await prepareEvolutionCorpus(source) : null;
    try {
      const spans = kinds.includes("raw") ? createOhSourceSpanPacker(source) : null;
      const prototype = kinds.includes("focused") ? createOhSourceSpanPrototype(source) : null;
      const full = variants.some(v => v.system === "full-history") ? createEvolutionFullHistorySource(source) : null;
      const preparationMs = performance.now() - start, queryStart = performance.now();
      for (const q of dataset.questions.filter(q => q.corpusId === corpus.id)) {
        const byKind = new Map<PoolKind, EvolutionRetrievalResult>();
        for (const kind of kinds) {
          const result = await prepared!.retrieve(q.question, poolVariant(kind));
          byKind.set(kind, result); pools.push({ questionId: q.id, kind, result });
        }
        for (const v of variants) {
          const common = { questionId: q.id, variantId: v.id };
          if (v.system === "full-history") cases.push({ ...common, kind: "full-history", result: full!.result });
          else if (v.system === "oh-source-spans-v2") cases.push({ ...common, kind: "source-spans-v2", result: prototype!.pack(v.mechanism, q.question, byKind.get("focused")!) });
          else if (v.system === "oh-source-spans") cases.push({ ...common, kind: "source-spans", result: spans!.pack(q.question, byKind.get("raw")!, { contextBytes: v.budget.contextBytes }) });
          else cases.push({ ...common, kind: "whole-turn", result: await prepared!.retrieve(q.question, evolutionLegacyVariant(v)) });
        }
      }
      timing.push({ corpusId: corpus.id, preparationMs, retrievalMs: performance.now() - queryStart, queries: prepared?.stats.queryCount ?? 0 });
    } finally { await prepared?.close(); }
  }
  const qo = new Map(dataset.questions.map((q, i) => [q.id, i])), vo = new Map(variants.map((v, i) => [v.id, i]));
  cases.sort((a, b) => qo.get(a.questionId)! - qo.get(b.questionId)! || vo.get(a.variantId)! - vo.get(b.variantId)!);
  pools.sort((a, b) => qo.get(a.questionId)! - qo.get(b.questionId)! || kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  const payload = { protocol: "oh.memory.evolution-context-plan.v3" as const, manifestSha256: input.manifestSha256,
    retrievalSourceSha256: input.retrievalSourceSha256, inputSha256: canonicalSha256(dataset), variants, questions: dataset.questions, cases, pools };
  const plan: EvolutionContextPlanV3 = { ...payload, planSha256: canonicalSha256(payload) };
  validateEvolutionContextPlanV3Sources(plan, dataset);
  return { plan, timing };
}

/** Structural validation is followed by source authentication before admission and reporting. */
export function validateEvolutionContextPlanV3(value: unknown): EvolutionContextPlanV3 {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "variants", "questions", "cases", "pools", "planSha256"])
    || value.protocol !== "oh.memory.evolution-context-plan.v3" || !Array.isArray(value.variants) || value.variants.length < 1 || value.variants.length > 32
    || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 2000
    || !Array.isArray(value.cases) || value.cases.length !== value.questions.length * value.variants.length
    || !Array.isArray(value.pools) || value.pools.length > value.questions.length * 2) fail("shape or matrix bounds");
  const variants = value.variants.map(parseEvolutionTreatment);
  if (!variants.some(isEvolutionV3Treatment) || new Set(variants.map(v => v.id)).size !== variants.length) fail("distinct V3 treatments required");
  for (const q of value.questions) if (!isPlainRecord(q) || !hasExactKeys(q, ["id", "corpusId", "question", "questionDate"])
    || [q.id, q.corpusId, q.question, q.questionDate].some(v => typeof v !== "string" || Buffer.byteLength(v) > 16384)
    || !q.id || !q.corpusId || !q.question) fail("gold-free question shape");
  for (const p of value.pools) if (!isPlainRecord(p) || !hasExactKeys(p, ["questionId", "kind", "result"]) || !["raw", "focused"].includes(String(p.kind))) fail("pool mapping");
  for (const c of value.cases) if (!isPlainRecord(c) || !hasExactKeys(c, ["questionId", "variantId", "kind", "result"])) fail("case mapping");
  const plan = value as unknown as EvolutionContextPlanV3, kinds = poolKinds(variants);
  digest(plan.manifestSha256); digest(plan.retrievalSourceSha256); digest(plan.inputSha256); digest(plan.planSha256);
  assertExactEvolutionCoverage(plan.questions.map(q => q.id), plan.questions.map(q => q.id));
  assertExactEvolutionCoverage(plan.questions.flatMap(q => kinds.map(k => pair(q.id, k))), plan.pools.map(p => pair(p.questionId, p.kind)));
  assertExactEvolutionCoverage(plan.questions.flatMap(q => variants.map(v => pair(q.id, v.id))), plan.cases.map(c => pair(c.questionId, c.variantId)));
  const questions = new Map(plan.questions.map(q => [q.id, q])), pools = new Map(plan.pools.map(p => [pair(p.questionId, p.kind), p.result]));
  for (const p of plan.pools) {
    validateEvolutionLegacyResultEnvelope(p.result, questions.get(p.questionId)!, 4_000_000);
    if (p.result.protocol !== "oh.evolution-retrieval.v1" || p.result.variantSha256 !== canonicalSha256(poolVariant(p.kind))
      || p.result.omittedForBudget !== 0 || p.result.turnIds.length > 100 || p.result.coverageKind !== null) fail("complete native pool required");
  }
  for (const c of plan.cases) {
    const q = questions.get(c.questionId)!, v = variants.find(v => v.id === c.variantId)!;
    if (v.system === "full-history") {
      if (c.kind !== "full-history") fail("full-history case kind");
      const result = validateEvolutionFullHistoryResult(c.result);
      if (result.corpusId !== q.corpusId) fail("full-history corpus binding");
    } else if (v.system === "oh-source-spans-v2") {
      const r = c.result, pool = pools.get(pair(q.id, "focused"))!;
      if (c.kind !== "source-spans-v2" || !isPlainRecord(r) || !hasExactKeys(r, ["protocol", "variant", "policySha256", "preparedSha256", "poolResultSha256", "querySha256", "contextByteLimit", "context", "contextSha256", "contextBytes", "spans", "turnIds", "sessionIds", "resultSha256"])
        || r.protocol !== "oh.evolution-source-spans.v2-prototype" || r.variant !== v.mechanism || r.contextByteLimit !== 48000
        || r.policySha256 !== canonicalSha256(OH_SPAN_PROTOTYPE_POLICY) || r.poolResultSha256 !== pool.resultSha256 || r.preparedSha256 !== pool.preparedSha256
        || r.querySha256 !== sha256Hex(q.question) || typeof r.context !== "string" || Buffer.byteLength(r.context) > 48000
        || r.contextBytes !== Buffer.byteLength(r.context) || r.contextSha256 !== sha256Hex(r.context)
        || !Array.isArray(r.spans) || r.spans.length > 128 || !Array.isArray(r.turnIds) || r.turnIds.length > 128
        || !Array.isArray(r.sessionIds) || r.sessionIds.length > 128) fail("prototype identity or bounds");
      const { resultSha256, ...payload } = r;
      if (canonicalSha256(payload) !== resultSha256) fail("prototype digest");
    } else {
      validateEvolutionLegacyResultEnvelope(c.result, q, v.budget.contextBytes);
      if (v.system === "oh-source-spans") {
        const pool = pools.get(pair(q.id, "raw"))!;
        if (c.kind !== "source-spans" || c.result.protocol !== "oh.evolution-source-spans.v1"
          || c.result.poolResultSha256 !== pool.resultSha256 || c.result.preparedSha256 !== pool.preparedSha256
          || c.result.contextByteLimit !== v.budget.contextBytes || c.result.policySha256 !== canonicalSha256(OH_SPAN_POLICY)) fail("legacy span binding");
      } else if (c.kind !== "whole-turn" || c.result.protocol !== "oh.evolution-retrieval.v1" || c.result.variantSha256 !== canonicalSha256(v)) fail("whole-turn binding");
    }
  }
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(payload) !== planSha256) fail("plan digest");
  return plan;
}

export function validateEvolutionContextPlanV3Sources(plan: EvolutionContextPlanV3, input: EvolutionRunnerInput): void {
  validateEvolutionContextPlanV3(plan);
  if (plan.inputSha256 !== canonicalSha256(input) || canonicalSha256(plan.questions) !== canonicalSha256(input.questions)) fail("source selection changed");
  assertExactEvolutionCoverage([...new Set(input.questions.map(q => q.corpusId))], input.corpora.map(c => c.id));
  const pools = new Map(plan.pools.map(p => [pair(p.questionId, p.kind), p.result]));
  for (const corpus of input.corpora) {
    const source = { ...corpus, groupId: corpus.id }, kinds = poolKinds(plan.variants);
    const validate = createEvolutionContextSourceValidator(source);
    const spans = kinds.includes("raw") ? createOhSourceSpanPacker(source) : null;
    const prototype = kinds.includes("focused") ? createOhSourceSpanPrototype(source) : null;
    const full = plan.variants.some(v => v.system === "full-history") ? createEvolutionFullHistorySource(source) : null;
    const questions = new Map(input.questions.filter(q => q.corpusId === corpus.id).map(q => [q.id, q]));
    for (const q of questions.values()) for (const kind of kinds) validate(pools.get(pair(q.id, kind))!);
    for (const c of plan.cases) {
      const q = questions.get(c.questionId); if (q === undefined) continue;
      if (c.kind === "full-history") full!.validate(c.result);
      else if (c.kind === "source-spans-v2") prototype!.validate(c.result, pools.get(pair(q.id, "focused"))!, q.question);
      else if (c.kind === "source-spans") spans!.validate(c.result, pools.get(pair(q.id, "raw"))!, q.question, { contextBytes: c.result.contextByteLimit });
      else validate(c.result);
    }
  }
}
