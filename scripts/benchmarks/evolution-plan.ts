import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { assertExactEvolutionCoverage, type EvolutionRunnerInput, type EvolutionRunnerQuestion } from "./evolution-dataset";
import { createEvolutionContextSourceValidator, prepareEvolutionCorpus, type EvolutionRetrievalResult, type EvolutionRetrievalVariant } from "./evolution-retrieval";
import { createOhSourceSpanPacker, OH_SPAN_POLICY, OH_SPAN_POOL_VARIANT, type OhSourceSpanResult } from "./evolution-spans";
import { isEvolutionSpanVariant, parseEvolutionExperimentVariant, type EvolutionExperimentVariant } from "./evolution-variants";
import { makeEvolutionRequest, validateEvolutionRequest, type EvolutionProfileId, type EvolutionRequest } from "./evolution-model";
import { answerMessages } from "./model";
import type { Turn } from "./datasets";

export type EvolutionContextCase = Readonly<{ questionId: string; variantId: string; result: EvolutionRetrievalResult }>;
export type EvolutionContextPlan = Readonly<{ protocol: "oh.memory.evolution-context-plan.v1"; manifestSha256: string;
  retrievalSourceSha256: string; inputSha256: string; variants: readonly EvolutionRetrievalVariant[];
  questions: readonly EvolutionRunnerQuestion[]; cases: readonly EvolutionContextCase[]; planSha256: string }>;
export type EvolutionContextCaseV2 = Readonly<{ questionId: string; variantId: string }> & (
  Readonly<{ kind: "whole-turn"; result: EvolutionRetrievalResult }> | Readonly<{ kind: "source-spans"; result: OhSourceSpanResult }>);
export type EvolutionContextPlanV2 = Readonly<{ protocol: "oh.memory.evolution-context-plan.v2"; manifestSha256: string;
  retrievalSourceSha256: string; inputSha256: string; variants: readonly EvolutionExperimentVariant[];
  questions: readonly EvolutionRunnerQuestion[]; cases: readonly EvolutionContextCaseV2[];
  pools: readonly Readonly<{ questionId: string; result: EvolutionRetrievalResult }>[]; planSha256: string }>;
export type EvolutionAnyContextPlan = EvolutionContextPlan | EvolutionContextPlanV2;
export type EvolutionReaderCase = Readonly<{ questionId: string; variantId: string; reader: EvolutionProfileId;
  contextSha256: string; requestSha256: string }>;
export type EvolutionReaderPlan = Readonly<{ protocol: "oh.memory.evolution-reader-plan.v1"; contextPlanSha256: string;
  manifestSha256: string; readerProfiles: readonly EvolutionProfileId[]; cases: readonly EvolutionReaderCase[];
  requests: readonly EvolutionRequest[]; planSha256: string }>;
function fail(reason: string): never { throw new TypeError(`Evolution plan: ${reason}.`); }
const digest = (value: string) => { if (parseSha256Hex(value) === null) fail("invalid digest"); return value; };
const pair = (question: string, variant: string) => JSON.stringify([question, variant]);

/** Prepare once, then run any reader matrix against the identical source-backed contexts.
 * The input has already crossed the gold-free projection boundary; no labels enter retrieval. */
export async function makeEvolutionContextPlan(input: Readonly<{ dataset: EvolutionRunnerInput;
  variants: readonly EvolutionRetrievalVariant[]; manifestSha256: string; retrievalSourceSha256: string;
  semanticCacheDirectory?: string }>) {
  const dataset = structuredClone(input.dataset), variants = structuredClone(input.variants);
  if (dataset.questions.length < 1 || dataset.questions.length > 2000 || variants.length < 1 || variants.length > 32
    || new Set(variants.map(v => v.id)).size !== variants.length) fail("invalid context matrix bounds");
  assertExactEvolutionCoverage(dataset.questions.map(q => q.id), dataset.questions.map(q => q.id));
  const cases: EvolutionContextCase[] = [], timing: Array<{ corpusId: string; preparationMs: number; retrievalMs: number; queries: number }> = [];
  for (const corpus of dataset.corpora) {
    const questions = dataset.questions.filter(q => q.corpusId === corpus.id);
    if (questions.length === 0) fail("unselected corpus");
    const start = performance.now();
    const prepared = await prepareEvolutionCorpus({ ...corpus, groupId: corpus.id },
      input.semanticCacheDirectory === undefined ? {} : { semanticCacheDirectory: input.semanticCacheDirectory });
    const preparationMs = performance.now() - start, queryStart = performance.now();
    try {
      for (const question of questions) for (const variant of variants) {
        cases.push({ questionId: question.id, variantId: variant.id, result: await prepared.retrieve(question.question, variant) });
      }
      timing.push({ corpusId: corpus.id, preparationMs, retrievalMs: performance.now() - queryStart, queries: prepared.stats.queryCount });
    } finally { await prepared.close(); }
  }
  const questionOrder = new Map(dataset.questions.map((q, i) => [q.id, i])), variantOrder = new Map(variants.map((v, i) => [v.id, i]));
  cases.sort((a, b) => questionOrder.get(a.questionId)! - questionOrder.get(b.questionId)! || variantOrder.get(a.variantId)! - variantOrder.get(b.variantId)!);
  const payload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: digest(input.manifestSha256),
    retrievalSourceSha256: digest(input.retrievalSourceSha256), inputSha256: canonicalSha256(dataset), variants, questions: dataset.questions, cases };
  const plan = { ...payload, planSha256: canonicalSha256(payload) };
  validateEvolutionContextPlan(plan);
  return { plan, timing };
}
export function validateEvolutionContextPlan(plan: EvolutionContextPlan): EvolutionContextPlan {
  const { planSha256, ...payload } = plan;
  if (plan.protocol !== "oh.memory.evolution-context-plan.v1" || canonicalSha256(payload) !== digest(planSha256)
    || plan.questions.length < 1 || plan.questions.length > 2000 || plan.variants.length < 1 || plan.variants.length > 32
    || plan.cases.length !== plan.questions.length * plan.variants.length) fail("context plan shape or digest");
  digest(plan.manifestSha256); digest(plan.retrievalSourceSha256); digest(plan.inputSha256);
  const expected = plan.questions.flatMap(q => plan.variants.map(v => pair(q.id, v.id)));
  assertExactEvolutionCoverage(expected, plan.cases.map(c => pair(c.questionId, c.variantId)));
  for (const c of plan.cases) {
    const question = plan.questions.find(q => q.id === c.questionId)!, variant = plan.variants.find(v => v.id === c.variantId)!;
    const { resultSha256, ...result } = c.result;
    if (sha256Hex(result.context) !== result.contextSha256 || Buffer.byteLength(result.context) !== result.contextBytes
      || result.contextBytes > variant.budget.contextBytes || canonicalSha256(result) !== resultSha256
      || result.variantSha256 !== canonicalSha256(variant) || result.querySha256 !== sha256Hex(question.question)) fail("context, query or variant identity drift");
  }
  return plan;
}
export function makeEvolutionReaderPlan(context: EvolutionAnyContextPlan, readerProfiles: readonly EvolutionProfileId[]): EvolutionReaderPlan {
  validateEvolutionAnyContextPlan(context);
  if (readerProfiles.length < 1 || readerProfiles.length > 8 || new Set(readerProfiles).size !== readerProfiles.length
    || readerProfiles.some(p => !p.endsWith("-reader"))) fail("distinct reader profiles required");
  const cases: EvolutionReaderCase[] = [], requests = new Map<string, EvolutionRequest>();
  for (const c of context.cases) {
    const question = context.questions.find(q => q.id === c.questionId)!;
    for (const reader of readerProfiles) {
      const request = makeEvolutionRequest(reader, answerMessages(question, c.result.context));
      requests.set(request.requestSha256, request);
      cases.push({ questionId: c.questionId, variantId: c.variantId, reader, contextSha256: c.result.contextSha256, requestSha256: request.requestSha256 });
    }
  }
  const payload = { protocol: "oh.memory.evolution-reader-plan.v1" as const, contextPlanSha256: context.planSha256,
    manifestSha256: context.manifestSha256, readerProfiles: [...readerProfiles], cases, requests: [...requests.values()] };
  return { ...payload, planSha256: canonicalSha256(payload) };
}
export function validateEvolutionReaderPlan(plan: EvolutionReaderPlan, context: EvolutionAnyContextPlan) {
  const { planSha256, ...payload } = plan;
  if (plan.protocol !== "oh.memory.evolution-reader-plan.v1" || canonicalSha256(payload) !== digest(planSha256)
    || plan.cases.length < 1 || plan.cases.length > 512_000 || plan.requests.length < 1 || plan.requests.length > plan.cases.length) fail("reader plan bounds or identity");
  digest(plan.contextPlanSha256); digest(plan.manifestSha256);
  const requests = new Map(plan.requests.map(request => { validateEvolutionRequest(request); return [request.requestSha256, request] as const; }));
  if (requests.size !== plan.requests.length) fail("duplicate physical requests");
  const identities = plan.cases.map(c => JSON.stringify([c.questionId, c.variantId, c.reader]));
  assertExactEvolutionCoverage(identities, identities);
  for (const c of plan.cases) if (requests.get(c.requestSha256)?.profileId !== c.reader || !plan.readerProfiles.includes(c.reader)) fail("case/request profile mismatch");
  if ([...requests.keys()].some(key => !plan.cases.some(c => c.requestSha256 === key))) fail("unselected physical request");
  const expected = makeEvolutionReaderPlan(context, plan.readerProfiles);
  if (canonicalSha256(expected) !== canonicalSha256(plan)) fail("reader matrix differs from the complete prepared context/profile product");
  return plan;
}

/** Native-only calls keep the V1 wire representation. Mixed span plans use a separate V2 union. */
export async function makeEvolutionExperimentContextPlan(input: Readonly<{ dataset: EvolutionRunnerInput;
  variants: readonly EvolutionExperimentVariant[]; manifestSha256: string; retrievalSourceSha256: string }>) {
  const variants = input.variants.map(parseEvolutionExperimentVariant);
  if (!variants.some(isEvolutionSpanVariant)) return makeEvolutionContextPlan({ ...input, variants: variants as EvolutionRetrievalVariant[] });
  if (!Array.isArray(input.dataset.corpora) || input.dataset.corpora.length < 1 || input.dataset.corpora.length > 2000
    || !Array.isArray(input.dataset.questions) || input.dataset.questions.length < 1 || input.dataset.questions.length > 2000) fail("invalid projected input bounds");
  for (const c of input.dataset.corpora) if (!Array.isArray(c.turns) || c.turns.length < 1 || c.turns.length > 8192) fail("invalid source corpus bounds");
  const dataset: EvolutionRunnerInput = { corpora: input.dataset.corpora.map(c => ({ id: c.id, turns: c.turns.map((t: Turn) => ({
    id: t.id, sessionId: t.sessionId, ...(t.sessionIndex === undefined ? {} : { sessionIndex: t.sessionIndex }),
    date: t.date, speaker: t.speaker, text: t.text })) })), questions: input.dataset.questions.map(q => ({
    id: q.id, corpusId: q.corpusId, question: q.question, questionDate: q.questionDate })) };
  if (dataset.questions.length < 1 || dataset.questions.length > 2000 || variants.length > 32
    || new Set(variants.map(v => v.id)).size !== variants.length) fail("invalid context matrix bounds");
  assertExactEvolutionCoverage(dataset.questions.map(q => q.id), dataset.questions.map(q => q.id));
  assertExactEvolutionCoverage([...new Set(dataset.questions.map(q => q.corpusId))], dataset.corpora.map(c => c.id));
  const cases: EvolutionContextCaseV2[] = [], pools: EvolutionContextPlanV2["pools"][number][] = [];
  const timing: Array<{ corpusId: string; preparationMs: number; retrievalMs: number; queries: number }> = [];
  for (const corpus of dataset.corpora) {
    const questions = dataset.questions.filter(q => q.corpusId === corpus.id);
    if (questions.length === 0) fail("unselected corpus");
    const source = { ...corpus, groupId: corpus.id }, start = performance.now();
    const prepared = await prepareEvolutionCorpus(source), spans = createOhSourceSpanPacker(source);
    const preparationMs = performance.now() - start, queryStart = performance.now();
    try {
      for (const question of questions) {
        const pool = await prepared.retrieve(question.question, OH_SPAN_POOL_VARIANT);
        pools.push({ questionId: question.id, result: pool });
        for (const variant of variants) {
          if (isEvolutionSpanVariant(variant)) cases.push({ questionId: question.id, variantId: variant.id, kind: "source-spans",
            result: spans.pack(question.question, pool, { contextBytes: variant.budget.contextBytes }) });
          else cases.push({ questionId: question.id, variantId: variant.id, kind: "whole-turn", result: await prepared.retrieve(question.question, variant) });
        }
      }
      timing.push({ corpusId: corpus.id, preparationMs, retrievalMs: performance.now() - queryStart, queries: prepared.stats.queryCount });
    } finally { await prepared.close(); }
  }
  const order = new Map(dataset.questions.map((q, i) => [q.id, i])), variantOrder = new Map(variants.map((v, i) => [v.id, i]));
  pools.sort((a, b) => order.get(a.questionId)! - order.get(b.questionId)!);
  cases.sort((a, b) => order.get(a.questionId)! - order.get(b.questionId)! || variantOrder.get(a.variantId)! - variantOrder.get(b.variantId)!);
  const payload = { protocol: "oh.memory.evolution-context-plan.v2" as const, manifestSha256: digest(input.manifestSha256),
    retrievalSourceSha256: digest(input.retrievalSourceSha256), inputSha256: canonicalSha256(dataset), variants, questions: dataset.questions, cases, pools };
  const plan: EvolutionContextPlanV2 = { ...payload, planSha256: canonicalSha256(payload) };
  validateEvolutionContextPlanSources(plan, dataset);
  return { plan, timing };
}

function validateResultEnvelope(value: unknown, question: EvolutionRunnerQuestion, byteLimit: number): asserts value is EvolutionRetrievalResult | OhSourceSpanResult {
  const boundedText = (v: unknown, max = 512) => typeof v === "string" && Buffer.byteLength(v) <= max;
  const integer = (v: unknown, max: number) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
  const common = ["protocol", "preparedSha256", "querySha256", "context", "contextSha256", "contextBytes", "turnIds", "sessionIds", "resultSha256"];
  if (!isPlainRecord(value) || typeof value.context !== "string" || Buffer.byteLength(value.context) > byteLimit
    || value.contextBytes !== Buffer.byteLength(value.context) || value.contextSha256 !== sha256Hex(value.context)
    || value.querySha256 !== sha256Hex(question.question) || parseSha256Hex(value.preparedSha256) === null
    || !Array.isArray(value.turnIds) || value.turnIds.length > 8192 || value.turnIds.some(v => !boundedText(v))
    || new Set(value.turnIds).size !== value.turnIds.length || !Array.isArray(value.sessionIds)
    || value.sessionIds.length > value.turnIds.length || value.sessionIds.some(v => !boundedText(v))
    || new Set(value.sessionIds).size !== value.sessionIds.length) fail("invalid result envelope");
  if (value.protocol === "oh.evolution-retrieval.v1") {
    if (!hasExactKeys(value, [...common, "variantSha256", "sources", "omittedForBudget", "facets", "coveredFacets", "coverageKind"])
      || parseSha256Hex(value.variantSha256) === null || !Array.isArray(value.sources) || value.sources.length !== value.turnIds.length
      || !integer(value.omittedForBudget, 8192) || !Array.isArray(value.facets) || value.facets.length > 4
      || value.facets.some(v => !boundedText(v, 16_384)) || !Array.isArray(value.coveredFacets)
      || value.coveredFacets.length > value.facets.length || value.coveredFacets.some(v => !integer(v, 3))
      || ![null, "lexical-clause"].includes(value.coverageKind as null | string)) fail("invalid whole-turn result contract");
    for (const source of value.sources) if (!isPlainRecord(source) || !hasExactKeys(source, ["turnId", "sessionId", "key", "recordSha256"])
      || ![source.turnId, source.sessionId, source.key].every(v => boundedText(v)) || parseSha256Hex(source.recordSha256) === null) fail("invalid source record identity");
  } else if (value.protocol === "oh.evolution-source-spans.v1") {
    if (!hasExactKeys(value, [...common, "poolResultSha256", "policySha256", "contextByteLimit", "spans"])
      || parseSha256Hex(value.poolResultSha256) === null || parseSha256Hex(value.policySha256) === null
      || !integer(value.contextByteLimit, 96_000) || value.contextByteLimit === 0 || !Array.isArray(value.spans)
      || value.spans.length > OH_SPAN_POLICY.maximumSpans || value.turnIds.length > value.spans.length) fail("invalid source-span result contract");
    for (const span of value.spans) if (!isPlainRecord(span) || !hasExactKeys(span, ["id", "turnId", "sessionId", "sessionIndex", "date", "speaker", "key", "recordSha256",
      "sourceTextSha256", "startByte", "endByte", "focusStartByte", "focusEndByte", "text"])
      || ![span.turnId, span.sessionId, span.speaker, span.key].every(v => boundedText(v)) || !boundedText(span.date, 256)
      || ![span.id, span.recordSha256, span.sourceTextSha256].every(v => parseSha256Hex(v) !== null)
      || span.sessionIndex !== null && !integer(span.sessionIndex, Number.MAX_SAFE_INTEGER)
      || ![span.startByte, span.endByte, span.focusStartByte, span.focusEndByte].every(v => integer(v, 524_288))
      || !boundedText(span.text, OH_SPAN_POLICY.maximumSpanBytes)) fail("invalid source-span identity");
  } else fail("unknown result protocol");
  const { resultSha256, ...payload } = value;
  if (canonicalSha256(payload) !== resultSha256) fail("result envelope digest changed");
}

export function validateEvolutionAnyContextPlan(plan: EvolutionAnyContextPlan): EvolutionAnyContextPlan {
  if (isPlainRecord(plan) && plan.protocol === "oh.memory.evolution-context-plan.v1") return validateEvolutionContextPlan(plan);
  if (!isPlainRecord(plan) || !hasExactKeys(plan, ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "variants", "questions", "cases", "pools", "planSha256"])
    || plan.protocol !== "oh.memory.evolution-context-plan.v2" || !Array.isArray(plan.variants) || plan.variants.length < 1 || plan.variants.length > 32
    || !Array.isArray(plan.questions) || plan.questions.length < 1 || plan.questions.length > 2000
    || !Array.isArray(plan.cases) || plan.cases.length !== plan.questions.length * plan.variants.length
    || !Array.isArray(plan.pools) || plan.pools.length !== plan.questions.length) fail("V2 context plan shape or bounds");
  const variants = plan.variants.map(parseEvolutionExperimentVariant);
  if (!variants.some(isEvolutionSpanVariant) || new Set(variants.map(v => v.id)).size !== variants.length) fail("V2 requires distinct treatments including spans");
  for (const q of plan.questions) if (!isPlainRecord(q) || !hasExactKeys(q, ["id", "corpusId", "question", "questionDate"])
    || [q.id, q.corpusId, q.question, q.questionDate].some(v => typeof v !== "string" || Buffer.byteLength(v) > 16_384)
    || !q.id || !q.corpusId || !q.question) fail("V2 question projection changed");
  digest(plan.manifestSha256); digest(plan.retrievalSourceSha256); digest(plan.inputSha256);
  assertExactEvolutionCoverage(plan.questions.map(q => q.id), plan.questions.map(q => q.id));
  for (const p of plan.pools) if (!isPlainRecord(p) || !hasExactKeys(p, ["questionId", "result"])) fail("V2 pool mapping changed");
  for (const c of plan.cases) if (!isPlainRecord(c) || !hasExactKeys(c, ["questionId", "variantId", "kind", "result"])) fail("V2 case mapping changed");
  assertExactEvolutionCoverage(plan.questions.map(q => q.id), plan.pools.map(p => p.questionId));
  const questions = new Map(plan.questions.map(q => [q.id, q])), pools = new Map(plan.pools.map(p => [p.questionId, p.result]));
  for (const p of plan.pools) {
    if (!isPlainRecord(p) || !hasExactKeys(p, ["questionId", "result"])) fail("V2 pool mapping changed");
    validateResultEnvelope(p.result, questions.get(p.questionId)!, OH_SPAN_POOL_VARIANT.budget.contextBytes);
    if (p.result.protocol !== "oh.evolution-retrieval.v1" || p.result.variantSha256 !== canonicalSha256(OH_SPAN_POOL_VARIANT)
      || p.result.omittedForBudget !== 0 || p.result.turnIds.length > 100 || p.result.coverageKind !== null) fail("V2 requires complete native pool");
  }
  assertExactEvolutionCoverage(plan.questions.flatMap(q => variants.map(v => pair(q.id, v.id))), plan.cases.map(c => pair(c.questionId, c.variantId)));
  for (const c of plan.cases) {
    if (!isPlainRecord(c) || !hasExactKeys(c, ["questionId", "variantId", "kind", "result"])) fail("V2 case mapping changed");
    const q = questions.get(c.questionId)!, variant = variants.find(v => v.id === c.variantId)!;
    validateResultEnvelope(c.result, q, variant.budget.contextBytes);
    if (isEvolutionSpanVariant(variant)) {
      const pool = pools.get(q.id)!;
      if (c.kind !== "source-spans" || c.result.protocol !== "oh.evolution-source-spans.v1"
        || c.result.poolResultSha256 !== pool.resultSha256 || c.result.preparedSha256 !== pool.preparedSha256
        || c.result.contextByteLimit !== variant.budget.contextBytes || c.result.policySha256 !== canonicalSha256(OH_SPAN_POLICY)
        || !Array.isArray(c.result.spans) || c.result.spans.length > OH_SPAN_POLICY.maximumSpans) fail("V2 span treatment or pool binding changed");
    } else if (c.kind !== "whole-turn" || c.result.protocol !== "oh.evolution-retrieval.v1"
      || c.result.variantSha256 !== canonicalSha256(variant)) fail("V2 whole-turn treatment changed");
  }
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(payload) !== digest(planSha256)) fail("V2 plan digest changed");
  return plan;
}

/** Source authentication is required before admission or reporting, including resealed cache rows. */
export function validateEvolutionContextPlanSources(plan: EvolutionAnyContextPlan, input: EvolutionRunnerInput): void {
  validateEvolutionAnyContextPlan(plan);
  if (plan.inputSha256 !== canonicalSha256(input) || canonicalSha256(plan.questions) !== canonicalSha256(input.questions)) fail("context source selection changed");
  assertExactEvolutionCoverage([...new Set(input.questions.map(q => q.corpusId))], input.corpora.map(c => c.id));
  const poolByQuestion = new Map(plan.protocol === "oh.memory.evolution-context-plan.v2" ? plan.pools.map(p => [p.questionId, p.result]) : []);
  for (const corpus of input.corpora) {
    const source = { ...corpus, groupId: corpus.id }, validate = createEvolutionContextSourceValidator(source);
    const spans = plan.protocol === "oh.memory.evolution-context-plan.v2" ? createOhSourceSpanPacker(source) : undefined;
    const questions = new Map(input.questions.filter(q => q.corpusId === corpus.id).map(q => [q.id, q]));
    for (const q of questions.values()) { const pool = poolByQuestion.get(q.id); if (pool !== undefined) validate(pool); }
    for (const c of plan.cases) {
      const q = questions.get(c.questionId); if (q === undefined) continue;
      if (c.result.protocol === "oh.evolution-source-spans.v1") {
        const variant = plan.variants.find(v => v.id === c.variantId)!;
        spans!.validate(c.result, poolByQuestion.get(c.questionId)!, q.question, { contextBytes: variant.budget.contextBytes });
      } else validate(c.result);
    }
  }
  const corpusIds = new Set(input.corpora.map(c => c.id));
  if (input.questions.some(q => !corpusIds.has(q.corpusId))) fail("question source corpus missing");
}
