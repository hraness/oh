/** Versioned source-order context plan; historical context wires remain unchanged. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { assertExactEvolutionCoverage, type EvolutionRunnerInput, type EvolutionRunnerQuestion } from "./evolution-dataset";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion, projectEvolutionCompletionCorpus,
  projectEvolutionCompletionQuestion, type EvolutionCompletionParent } from "./evolution-completion";
import { createEvolutionSourceOrder, EVOLUTION_SOURCE_ORDER_POLICY, validateEvolutionSourceOrderParent,
  validateEvolutionSourceOrderResultEnvelope, type EvolutionSourceOrderResult } from "./evolution-source-order";
import { validateEvolutionContextPlan, type EvolutionContextPlan } from "./evolution-plan";

export const EVOLUTION_SOURCE_ORDER_READER = "gpt5-nano-explicit-abstention-composition-v1-reader" as const;
export const EVOLUTION_SOURCE_ORDER_TREATMENTS = freezeEvolutionCompletion([{
  id: "oh-semantic-source-order-96k-v1", system: "oh-source-order" as const, budget: { topK: 100, contextBytes: 96_000 },
}]);
export type EvolutionSourceOrderTreatment = typeof EVOLUTION_SOURCE_ORDER_TREATMENTS[number];
export type EvolutionSourceOrderParentRow = Readonly<{ questionId: string; parent: EvolutionCompletionParent }>;
export type EvolutionSourceOrderPlanInput = Readonly<{ dataset: EvolutionRunnerInput; parents: readonly EvolutionSourceOrderParentRow[];
  manifestSha256: string; retrievalSourceSha256: string }>;
export type EvolutionSourceOrderPlan = Readonly<{
  protocol: "oh.memory.evolution-context-plan.v5"; manifestSha256: string; retrievalSourceSha256: string; inputSha256: string; policySha256: string;
  variants: typeof EVOLUTION_SOURCE_ORDER_TREATMENTS; questions: readonly EvolutionRunnerQuestion[]; parents: readonly EvolutionSourceOrderParentRow[];
  cases: readonly Readonly<{ questionId: string; variantId: string; kind: "source-order"; result: EvolutionSourceOrderResult }>[]; planSha256: string;
}>;
const MAX_QUESTIONS = 100, MAX_PLAN_BYTES = 128 * 1024 * 1024;
const KEYS = ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "policySha256", "variants", "questions", "parents", "cases", "planSha256"];
function fail(reason: string): never { throw new TypeError(`Evolution source-order plan: ${reason}.`); }
function id(value: unknown): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > 512 || /\p{Surrogate}/u.test(value)) fail("bounded ID required");
  return value;
}
export function parseEvolutionSourceOrderTreatment(value: unknown): EvolutionSourceOrderTreatment {
  boundEvolutionCompletionWire(value, 2_000, 100);
  if (canonicalSha256(value) !== canonicalSha256(EVOLUTION_SOURCE_ORDER_TREATMENTS[0]!)) fail("fixed treatment required");
  return EVOLUTION_SOURCE_ORDER_TREATMENTS[0]!;
}
function project(input: EvolutionRunnerInput): EvolutionRunnerInput {
  if (!isPlainRecord(input) || !Array.isArray(input.corpora) || input.corpora.length < 1 || input.corpora.length > MAX_QUESTIONS
    || !Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > MAX_QUESTIONS) fail("bounded source selection required");
  const corpora = input.corpora.map(value => {
    if (!isPlainRecord(value)) fail("source corpus object");
    const corpus = projectEvolutionCompletionCorpus({ id: id(value.id), groupId: id(value.id), turns: value.turns });
    return { id: corpus.id, turns: corpus.turns };
  });
  const questions = input.questions.map(q => ({ id: id(q.id), corpusId: id(q.corpusId), ...projectEvolutionCompletionQuestion(q) }));
  assertExactEvolutionCoverage(questions.map(q => q.id), questions.map(q => q.id));
  assertExactEvolutionCoverage([...new Set(questions.map(q => q.corpusId))], corpora.map(c => c.id));
  return { corpora, questions };
}
/** Caller must verify original artifact bytes against its independent pin first.
 * Its historical source-manifest hash stays historical, never rewritten to the current one. */
export function projectEvolutionSourceOrderParents(input: Readonly<{ plan: unknown; variantId: string }>, dataset: EvolutionRunnerInput,
  manifestSha256: string): readonly EvolutionSourceOrderParentRow[] {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["plan", "variantId"])) fail("parent artifact mapping");
  boundEvolutionCompletionWire(input.plan, MAX_PLAN_BYTES, 3_000_000);
  if (!isPlainRecord(input.plan) || !hasExactKeys(input.plan, ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "variants", "questions", "cases", "planSha256"])
    || input.plan.protocol !== "oh.memory.evolution-context-plan.v1") fail("original V1 parent artifact required");
  const plan = validateEvolutionContextPlan(input.plan as unknown as EvolutionContextPlan), selected = project(dataset);
  if (plan.manifestSha256 !== manifestSha256 || plan.inputSha256 !== canonicalSha256(selected)
    || canonicalSha256(plan.questions) !== canonicalSha256(selected.questions)) fail("parent selection or manifest differs");
  const variant = plan.variants.find(v => v.id === input.variantId);
  if (!variant || variant.system !== "oh-semantic" || variant.budget.topK !== 100 || variant.budget.contextBytes !== 96_000) fail("fixed semantic parent required");
  const rows = plan.cases.filter(c => c.variantId === variant.id);
  assertExactEvolutionCoverage(selected.questions.map(q => q.id), rows.map(r => r.questionId));
  const byId = new Map(rows.map(r => [r.questionId, r.result]));
  return selected.questions.map(q => { const result = byId.get(q.id)!;
    return { questionId: q.id, parent: validateEvolutionSourceOrderParent({ variant, result, expectedResultSha256: result.resultSha256 }, q) }; });
}
export function makeEvolutionSourceOrderPlan(input: EvolutionSourceOrderPlanInput): EvolutionSourceOrderPlan {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["dataset", "parents", "manifestSha256", "retrievalSourceSha256"])
    || parseSha256Hex(input.manifestSha256) === null || parseSha256Hex(input.retrievalSourceSha256) === null
    || !Array.isArray(input.parents) || input.parents.length < 1 || input.parents.length > MAX_QUESTIONS) fail("exact plan inputs");
  const dataset = project(input.dataset);
  for (const p of input.parents) if (!isPlainRecord(p) || !hasExactKeys(p, ["questionId", "parent"])) fail("exact parent row");
  assertExactEvolutionCoverage(dataset.questions.map(q => q.id), input.parents.map(p => id(p.questionId)));
  const parents = new Map(input.parents.map(p => [p.questionId, p])), factories = new Map(dataset.corpora.map(c => [c.id,
    createEvolutionSourceOrder({ id: c.id, groupId: c.id, turns: c.turns })]));
  const cases = dataset.questions.map(q => ({ questionId: q.id, variantId: EVOLUTION_SOURCE_ORDER_TREATMENTS[0]!.id, kind: "source-order" as const,
    result: factories.get(q.corpusId)!.order({ question: q, parent: parents.get(q.id)!.parent }) }));
  const payload = { protocol: "oh.memory.evolution-context-plan.v5" as const, manifestSha256: input.manifestSha256, retrievalSourceSha256: input.retrievalSourceSha256,
    inputSha256: canonicalSha256(dataset), policySha256: canonicalSha256(EVOLUTION_SOURCE_ORDER_POLICY), variants: EVOLUTION_SOURCE_ORDER_TREATMENTS,
    questions: dataset.questions, parents: dataset.questions.map(q => parents.get(q.id)!), cases };
  boundEvolutionCompletionWire(payload, MAX_PLAN_BYTES, 3_000_000);
  if (Buffer.byteLength(canonicalJson(payload)) > MAX_PLAN_BYTES) fail("plan exceeds128MiB");
  return freezeEvolutionCompletion(structuredClone({ ...payload, planSha256: canonicalSha256(payload) }));
}
export function validateEvolutionSourceOrderPlan(input: EvolutionSourceOrderPlanInput, value: unknown): EvolutionSourceOrderPlan {
  validateEvolutionSourceOrderPlanEnvelope(value);
  const expected = makeEvolutionSourceOrderPlan(input);
  if (canonicalSha256(value) !== canonicalSha256(expected)) fail("plan differs from authenticated parent or current source selection");
  return expected;
}
/** Envelope only. Generic CLI reloads the original parent pin and validates the
 * source reconstruction before every reader/judge/report operation. */
export function validateEvolutionSourceOrderPlanEnvelope(value: unknown): EvolutionSourceOrderPlan {
  boundEvolutionCompletionWire(value, MAX_PLAN_BYTES, 3_000_000);
  if (!isPlainRecord(value) || !hasExactKeys(value, KEYS) || value.protocol !== "oh.memory.evolution-context-plan.v5"
    || !Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > MAX_QUESTIONS
    || !Array.isArray(value.parents) || value.parents.length !== value.questions.length
    || !Array.isArray(value.cases) || value.cases.length !== value.questions.length) fail("V5 shape or matrix bounds");
  const plan = value as unknown as EvolutionSourceOrderPlan;
  for (const d of [plan.manifestSha256, plan.retrievalSourceSha256, plan.inputSha256, plan.planSha256]) if (parseSha256Hex(d) === null) fail("plan digest required");
  if (plan.policySha256 !== canonicalSha256(EVOLUTION_SOURCE_ORDER_POLICY)
    || canonicalSha256(plan.variants) !== canonicalSha256(EVOLUTION_SOURCE_ORDER_TREATMENTS)) fail("fixed treatment changed");
  for (const q of plan.questions) {
    if (!isPlainRecord(q) || !hasExactKeys(q, ["id", "corpusId", "question", "questionDate"])) fail("question projection shape");
    id(q.id); id(q.corpusId); projectEvolutionCompletionQuestion(q);
  }
  assertExactEvolutionCoverage(plan.questions.map(q => q.id), plan.parents.map(p => p.questionId));
  assertExactEvolutionCoverage(plan.questions.map(q => JSON.stringify([q.id, plan.variants[0]!.id])), plan.cases.map(c => JSON.stringify([c.questionId, c.variantId])));
  const questions = new Map(plan.questions.map(q => [q.id, q])), parents = new Map(plan.parents.map(p => [p.questionId, p]));
  for (const p of plan.parents) {
    if (!isPlainRecord(p) || !hasExactKeys(p, ["questionId", "parent"])) fail("parent row shape");
    validateEvolutionSourceOrderParent(p.parent, questions.get(p.questionId)!);
  }
  for (const c of plan.cases) {
    if (!isPlainRecord(c) || !hasExactKeys(c, ["questionId", "variantId", "kind", "result"]) || c.kind !== "source-order") fail("case shape");
    const q = questions.get(c.questionId)!;
    const r = validateEvolutionSourceOrderResultEnvelope(c.result, { question: q, parent: parents.get(q.id)!.parent });
    if (r.corpusId !== q.corpusId) fail("case corpus binding");
  }
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(payload) !== planSha256) fail("plan digest differs");
  return plan;
}
