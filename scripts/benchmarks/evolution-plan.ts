import { canonicalSha256, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { assertExactEvolutionCoverage, type EvolutionRunnerInput, type EvolutionRunnerQuestion } from "./evolution-dataset";
import { prepareEvolutionCorpus, type EvolutionRetrievalResult, type EvolutionRetrievalVariant } from "./evolution-retrieval";
import { makeEvolutionRequest, validateEvolutionRequest, type EvolutionProfileId, type EvolutionRequest } from "./evolution-model";
import { answerMessages } from "./model";

export type EvolutionContextCase = Readonly<{ questionId: string; variantId: string; result: EvolutionRetrievalResult }>;
export type EvolutionContextPlan = Readonly<{ protocol: "oh.memory.evolution-context-plan.v1"; manifestSha256: string;
  retrievalSourceSha256: string; inputSha256: string; variants: readonly EvolutionRetrievalVariant[];
  questions: readonly EvolutionRunnerQuestion[]; cases: readonly EvolutionContextCase[]; planSha256: string }>;
export type EvolutionReaderCase = Readonly<{ questionId: string; variantId: string; reader: EvolutionProfileId;
  contextSha256: string; requestSha256: string }>;
export type EvolutionReaderPlan = Readonly<{ protocol: "oh.memory.evolution-reader-plan.v1"; contextPlanSha256: string;
  manifestSha256: string; readerProfiles: readonly EvolutionProfileId[]; cases: readonly EvolutionReaderCase[];
  requests: readonly EvolutionRequest[]; planSha256: string }>;
const fail = (reason: string): never => { throw new TypeError(`Evolution plan: ${reason}.`); };
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
export function makeEvolutionReaderPlan(context: EvolutionContextPlan, readerProfiles: readonly EvolutionProfileId[]): EvolutionReaderPlan {
  validateEvolutionContextPlan(context);
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
export function validateEvolutionReaderPlan(plan: EvolutionReaderPlan, context: EvolutionContextPlan) {
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
