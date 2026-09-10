/** V9 study-bound context wrapper. Original retrieval result wires remain intact; the wrapper records the candidate
 * variant digest, the derived-record pin, the reader date policy digest and the candidate's result protocol. Every case
 * carries exactly the result protocol its own variant system emits: V1 whole-turn results for native systems, V2
 * results for the recall systems and for the derived systems, whose contexts add pinned observations beside raw turns. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { evolutionPin, type EvolutionPin } from "./evolution-budget";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import { assertExactEvolutionCoverage, type EvolutionRunnerInput } from "./evolution-dataset";
import { EVOLUTION_EVALUATION_SCOPE_V2_MAXIMUM_SHARD } from "./evolution-evaluation-scope";
import { validateEvolutionContextPlan, validateEvolutionContextPlanSources, type EvolutionContextPlan } from "./evolution-plan";
import { evolutionReaderDatePolicySha256, parseEvolutionReaderDatePolicy, type EvolutionReaderDatePolicy } from "./evolution-reader-date-policy";
import type { EvolutionReleaseContextPlan } from "./evolution-release-plan";
import type { EvolutionDerivedCorpora } from "./evolution-derived";
import { evolutionSystemResultProtocol, isEvolutionDerivedSystem, type EvolutionAnyRetrievalResult, type EvolutionResultProtocol } from "./evolution-retrieval";
import { evolutionStudyV9Shard, evolutionStudyV9Variants, type EvolutionStudyV9Authorization } from "./evolution-study-v9";

export const EVOLUTION_CONTEXT_PLAN_V9_PROTOCOL = "oh.memory.evolution-context-plan.v9" as const;
/** The result protocol of a whole-turn candidate; a V2 candidate binds "oh.evolution-retrieval.v2" instead. */
export const EVOLUTION_V9_RESULT_PROTOCOL = "oh.evolution-retrieval.v1" as const;
export type EvolutionContextBindingV9 = Readonly<{ studySha256: string; scopeSha256: string; shardId: string; candidatePresentation: "retrieval-order";
  candidateVariantSha256: string; derivedRecordsPin: EvolutionPin | null; readerDatePolicy: EvolutionReaderDatePolicy; readerDatePolicySha256: string;
  resultProtocol: EvolutionResultProtocol }>;
export type EvolutionContextPlanV9 = Omit<EvolutionContextPlan, "protocol" | "cases"> & EvolutionContextBindingV9 & Readonly<{
  protocol: typeof EVOLUTION_CONTEXT_PLAN_V9_PROTOCOL; basePlan: EvolutionContextPlan;
  cases: readonly Readonly<{ questionId: string; variantId: string; kind: "whole-turn"; result: EvolutionAnyRetrievalResult }>[];
}>;
const RESULT_PROTOCOLS: readonly EvolutionResultProtocol[] = ["oh.evolution-retrieval.v1", "oh.evolution-retrieval.v2"];
/** Derived arms and the derived-record pin imply each other; the pin is consumed only by a derived system. */
function derivedBinding(variants: readonly Readonly<{ system: string }>[], derivedRecordsPin: EvolutionPin | null): void {
  if (variants.some(v => isEvolutionDerivedSystem(v.system)) !== (derivedRecordsPin !== null)) fail("derived systems and the derived-record pin require each other");
}
const ENVELOPE_KEYS = ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "variants", "questions", "cases", "planSha256", "studySha256", "scopeSha256",
  "shardId", "candidatePresentation", "candidateVariantSha256", "derivedRecordsPin", "readerDatePolicy", "readerDatePolicySha256", "resultProtocol", "basePlan"] as const;
function fail(reason: string): never { throw new TypeError(`Evolution V9 context: ${reason}.`); }
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
export const EVOLUTION_V9_SHARD_ID = /^shard-\d{3}$/;
export function evolutionContextBindingV9(authorization: EvolutionStudyV9Authorization, shardId: string): EvolutionContextBindingV9 {
  evolutionStudyV9Shard(authorization, shardId);
  const { study } = authorization;
  return { studySha256: authorization.studySha256, scopeSha256: authorization.scope.scopeSha256, shardId, candidatePresentation: study.candidatePresentation,
    candidateVariantSha256: canonicalSha256(study.candidate), derivedRecordsPin: study.derivedRecordsPin, readerDatePolicy: study.readerDatePolicy,
    readerDatePolicySha256: evolutionReaderDatePolicySha256(study.readerDatePolicy), resultProtocol: evolutionSystemResultProtocol(study.candidate.system) };
}
export function assertEvolutionContextBindingV9(plan: EvolutionContextPlanV9, authorization: EvolutionStudyV9Authorization, shardId: string): void {
  validateEvolutionContextPlanV9Envelope(plan);
  const binding = evolutionContextBindingV9(authorization, shardId), { study } = authorization;
  if (!same({ ...binding }, { studySha256: plan.studySha256, scopeSha256: plan.scopeSha256, shardId: plan.shardId, candidatePresentation: plan.candidatePresentation,
    candidateVariantSha256: plan.candidateVariantSha256, derivedRecordsPin: plan.derivedRecordsPin, readerDatePolicy: plan.readerDatePolicy,
    readerDatePolicySha256: plan.readerDatePolicySha256, resultProtocol: plan.resultProtocol })
    || !same(plan.variants, evolutionStudyV9Variants(study)) || plan.manifestSha256 !== study.manifestPin.sha256
    || plan.retrievalSourceSha256 !== study.retrievalSourceSha256
    || !same(plan.questions.map(q => q.id), evolutionStudyV9Shard(authorization, shardId).questionIds)) fail("context differs from study/scope/exact shard");
}
export function makeEvolutionContextPlanV9(input: Readonly<{ dataset: EvolutionRunnerInput; basePlan: EvolutionContextPlan; binding: EvolutionContextBindingV9;
  derived?: EvolutionDerivedCorpora }>): EvolutionContextPlanV9 {
  const base = validateEvolutionContextPlan(input.basePlan);
  validateEvolutionContextPlanSources(base, input.dataset, input.derived);
  const binding = input.binding;
  if ([binding.studySha256, binding.scopeSha256, binding.candidateVariantSha256, binding.readerDatePolicySha256].some(x => parseSha256Hex(x) === null)
    || !EVOLUTION_V9_SHARD_ID.test(binding.shardId) || binding.candidatePresentation !== "retrieval-order" || !RESULT_PROTOCOLS.includes(binding.resultProtocol)
    || binding.readerDatePolicySha256 !== evolutionReaderDatePolicySha256(parseEvolutionReaderDatePolicy(binding.readerDatePolicy))
    || (binding.derivedRecordsPin !== null && !same(binding.derivedRecordsPin, evolutionPin(binding.derivedRecordsPin)))
    || base.questions.length > EVOLUTION_EVALUATION_SCOPE_V2_MAXIMUM_SHARD || base.variants.length !== 2
    || binding.candidateVariantSha256 !== canonicalSha256(base.variants[1]) || binding.resultProtocol !== evolutionSystemResultProtocol(base.variants[1]!.system)) fail("fixed binding required");
  derivedBinding(base.variants, binding.derivedRecordsPin);
  if ((binding.derivedRecordsPin !== null) !== (input.derived !== undefined) || (input.derived !== undefined && input.derived.artifactSha256 !== binding.derivedRecordsPin!.sha256)) fail("derived records must be rebuilt from the pinned artifact");
  const protocols = new Map(base.variants.map(v => [v.id, evolutionSystemResultProtocol(v.system)]));
  if (base.cases.some(c => c.result.protocol !== protocols.get(c.variantId))) fail("result protocol differs from the variant system");
  const cases = base.cases.map(c => ({ ...c, kind: "whole-turn" as const, result: c.result }));
  const { planSha256: _old, protocol: _protocol, cases: _cases, ...fields } = base;
  const payload = { protocol: EVOLUTION_CONTEXT_PLAN_V9_PROTOCOL, ...fields, ...binding, basePlan: base, cases };
  return freezeEvolutionCompletion(structuredClone({ ...payload, planSha256: canonicalSha256(payload) }));
}
export function validateEvolutionContextPlanV9Envelope(value: unknown): EvolutionContextPlanV9 {
  boundEvolutionCompletionWire(value, 128 * 1024 * 1024, 6_000_000);
  if (!isPlainRecord(value) || !hasExactKeys(value, ENVELOPE_KEYS) || value.protocol !== EVOLUTION_CONTEXT_PLAN_V9_PROTOCOL) fail("exact V9 context required");
  const plan = value as unknown as EvolutionContextPlanV9, base = validateEvolutionContextPlan(plan.basePlan);
  for (const d of [plan.studySha256, plan.scopeSha256, plan.planSha256, plan.candidateVariantSha256, plan.readerDatePolicySha256]) if (parseSha256Hex(d) === null) fail("digest required");
  if (!EVOLUTION_V9_SHARD_ID.test(plan.shardId) || plan.candidatePresentation !== "retrieval-order" || !RESULT_PROTOCOLS.includes(plan.resultProtocol)
    || plan.resultProtocol !== evolutionSystemResultProtocol(base.variants[1]!.system)
    || plan.readerDatePolicySha256 !== evolutionReaderDatePolicySha256(parseEvolutionReaderDatePolicy(plan.readerDatePolicy))
    || (plan.derivedRecordsPin !== null && !same(plan.derivedRecordsPin, evolutionPin(plan.derivedRecordsPin)))
    || base.questions.length > EVOLUTION_EVALUATION_SCOPE_V2_MAXIMUM_SHARD || base.variants.length !== 2 || plan.candidateVariantSha256 !== canonicalSha256(base.variants[1])
    || plan.manifestSha256 !== base.manifestSha256 || plan.retrievalSourceSha256 !== base.retrievalSourceSha256 || plan.inputSha256 !== base.inputSha256
    || !same(plan.questions, base.questions) || !same(plan.variants, base.variants) || !Array.isArray(plan.cases) || plan.cases.length !== base.cases.length) fail("base context binding");
  derivedBinding(base.variants, plan.derivedRecordsPin);
  const keys = (rows: readonly { questionId: string; variantId: string }[]) => rows.map(c => JSON.stringify([c.questionId, c.variantId]));
  assertExactEvolutionCoverage(keys(base.cases), keys(plan.cases));
  const originals = new Map(base.cases.map(c => [JSON.stringify([c.questionId, c.variantId]), c]));
  const protocols = new Map(base.variants.map(v => [v.id, evolutionSystemResultProtocol(v.system)]));
  for (const c of plan.cases as readonly unknown[]) {
    if (!isPlainRecord(c) || !hasExactKeys(c, ["questionId", "variantId", "kind", "result"])) fail("case shape");
    const row = c as EvolutionContextPlanV9["cases"][number], original = originals.get(JSON.stringify([row.questionId, row.variantId]))!;
    if (row.kind !== "whole-turn" || row.result.protocol !== protocols.get(row.variantId) || !same(row.result, original.result)) fail("base retrieval changed");
  }
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(payload) !== planSha256) fail("plan digest");
  return plan;
}
export function validateEvolutionContextPlanV9Sources(plan: EvolutionContextPlanV9, dataset: EvolutionRunnerInput, derived?: EvolutionDerivedCorpora): void {
  validateEvolutionContextPlanV9Envelope(plan);
  const { studySha256, scopeSha256, shardId, candidatePresentation, candidateVariantSha256, derivedRecordsPin, readerDatePolicy, readerDatePolicySha256, resultProtocol } = plan;
  const expected = makeEvolutionContextPlanV9({ dataset, basePlan: plan.basePlan, ...(derived === undefined ? {} : { derived }),
    binding: { studySha256, scopeSha256, shardId, candidatePresentation, candidateVariantSha256, derivedRecordsPin, readerDatePolicy, readerDatePolicySha256, resultProtocol } });
  if (!same(expected, plan)) fail("context differs from current source reconstruction");
}
/** The base whole-turn plan carried by any rebind-eligible parent: a development V1 plan, a V7 release wrapper or a V9 wrapper. */
export type EvolutionRebindParent = EvolutionContextPlan | EvolutionReleaseContextPlan | EvolutionContextPlanV9;
export function evolutionRebindParentBase(parent: EvolutionRebindParent): Readonly<{ base: EvolutionContextPlan; parentStudySha256: string | null; protocol: EvolutionRebindParent["protocol"] }> {
  if (parent.protocol === "oh.memory.evolution-context-plan.v1") return { base: validateEvolutionContextPlan(parent), parentStudySha256: null, protocol: parent.protocol };
  if (parent.protocol === EVOLUTION_CONTEXT_PLAN_V9_PROTOCOL) { const p = validateEvolutionContextPlanV9Envelope(parent); return { base: p.basePlan, parentStudySha256: p.studySha256, protocol: p.protocol }; }
  if (parent.protocol === "oh.memory.evolution-context-plan.v6") return { base: validateEvolutionContextPlan(parent.basePlan), parentStudySha256: parent.studySha256, protocol: parent.protocol };
  return fail("parent context protocol is not rebind-eligible");
}
const caseKey = (c: Readonly<{ questionId: string; variantId: string }>) => JSON.stringify([c.questionId, c.variantId]);
/** Every (question, variant) case of `right` must carry exactly the result of the same case in `left`; order is immaterial. */
function assertSameEvolutionRetrieval(left: readonly EvolutionContextPlan["cases"][number][], right: readonly EvolutionContextPlan["cases"][number][]): void {
  const originals = new Map(left.map(c => [caseKey(c), c.result]));
  if (right.length !== left.length || right.some(c => !same(c.result, originals.get(caseKey(c))))) fail("rebound retrieval changed");
}
/** Restamp a validated base plan under the current retrieval source and the study's projection. Retrieval is not rerun;
 * every parent result is re-validated against the current source rendering by the V9 wrapper. The parent must carry
 * the shard's exact question set with identical text and corpus binding; only `questionDate` may differ, because the
 * declared reader date policy is applied in projection. A development parent prepared in seeded selection order is
 * reordered into the shard's order (questions and cases) before resealing, so its results are reused unchanged
 * while the plan digest moves with the order. */
export function rebindEvolutionBasePlan(input: Readonly<{ base: EvolutionContextPlan; dataset: EvolutionRunnerInput; retrievalSourceSha256: string;
  derived?: EvolutionDerivedCorpora }>): EvolutionContextPlan {
  const base = validateEvolutionContextPlan(input.base), { dataset } = input;
  if (parseSha256Hex(input.retrievalSourceSha256) === null) fail("current retrieval source digest required");
  const parents = new Map(base.questions.map(q => [q.id, q]));
  if (base.questions.length !== dataset.questions.length || parents.size !== base.questions.length || dataset.questions.some(q => {
    const parent = parents.get(q.id); return parent === undefined || parent.corpusId !== q.corpusId || parent.question !== q.question;
  })) fail("parent questions differ from the study shard");
  const questionOrder = new Map(dataset.questions.map((q, i) => [q.id, i])), variantOrder = new Map(base.variants.map((v, i) => [v.id, i]));
  const cases = [...base.cases].sort((a, b) => questionOrder.get(a.questionId)! - questionOrder.get(b.questionId)! || variantOrder.get(a.variantId)! - variantOrder.get(b.variantId)!);
  const { planSha256: _old, questions: _questions, cases: _cases, ...fields } = base;
  const payload = { ...fields, retrievalSourceSha256: input.retrievalSourceSha256, inputSha256: canonicalSha256(dataset), questions: dataset.questions, cases };
  const rebound = freezeEvolutionCompletion(structuredClone({ ...payload, planSha256: canonicalSha256(payload) })) as EvolutionContextPlan;
  validateEvolutionContextPlanSources(rebound, dataset, input.derived);
  assertSameEvolutionRetrieval(base.cases, rebound.cases);
  return rebound;
}
/** Reuse a parent's exact retrieval results under a V9 study that declares the parent's study and retrieval-source
 * digests. A V1 development parent has no study; its plan digest stands in for the parent study digest. */
export function rebindEvolutionContextPlanV9(input: Readonly<{ dataset: EvolutionRunnerInput; parent: EvolutionRebindParent;
  authorization: EvolutionStudyV9Authorization; shardId: string; retrievalSourceSha256: string; derived?: EvolutionDerivedCorpora }>): EvolutionContextPlanV9 {
  const { study } = input.authorization, provenance = study.retrievalProvenance, parent = evolutionRebindParentBase(input.parent);
  if (provenance === null) fail("rebound study must declare retrieval provenance");
  const parentStudySha256 = parent.parentStudySha256 ?? parent.base.planSha256;
  if (parentStudySha256 === input.authorization.studySha256 || parentStudySha256 !== provenance.parentStudySha256
    || parent.base.retrievalSourceSha256 !== provenance.parentRetrievalSourceSha256) fail("parent context does not match declared provenance");
  if (study.retrievalSourceSha256 !== input.retrievalSourceSha256) fail("rebound study must pin the current retrieval source");
  if (!same(parent.base.variants, evolutionStudyV9Variants(study))) fail("parent variants differ from the study's control/candidate");
  const derived = input.derived === undefined ? {} : { derived: input.derived };
  const basePlan = rebindEvolutionBasePlan({ base: parent.base, dataset: input.dataset, retrievalSourceSha256: input.retrievalSourceSha256, ...derived });
  const plan = makeEvolutionContextPlanV9({ dataset: input.dataset, basePlan, binding: evolutionContextBindingV9(input.authorization, input.shardId), ...derived });
  assertEvolutionContextBindingV9(plan, input.authorization, input.shardId);
  assertSameEvolutionRetrieval(parent.base.cases, plan.cases);
  return plan;
}
