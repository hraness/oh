/** V7 scope-bound context wrapper. Original retrieval result wires remain intact. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { assertExactEvolutionCoverage, type EvolutionRunnerInput } from "./evolution-dataset";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import { validateEvolutionContextPlan, validateEvolutionContextPlanSources, type EvolutionContextPlan } from "./evolution-plan";
import { evolutionReleaseShard, type EvolutionReleaseAuthorization } from "./evolution-release";
import type { EvolutionRetrievalResult } from "./evolution-retrieval";
export type EvolutionReleaseContextBinding = Readonly<{ studySha256: string; scopeSha256: string; shardId: string; candidatePresentation: "retrieval-order" }>;
export type EvolutionReleaseContextPlan = Omit<EvolutionContextPlan, "protocol" | "cases"> & EvolutionReleaseContextBinding & Readonly<{
  protocol: "oh.memory.evolution-context-plan.v6"; basePlan: EvolutionContextPlan;
  cases: readonly Readonly<{ questionId: string; variantId: string; kind: "whole-turn"; result: EvolutionRetrievalResult }>[];
}>;
function fail(reason: string): never { throw new TypeError(`Evolution release context: ${reason}.`); }
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
export function evolutionReleaseContextBinding(authorization: EvolutionReleaseAuthorization, shardId: string): EvolutionReleaseContextBinding {
  evolutionReleaseShard(authorization, shardId);
  return { studySha256: authorization.studySha256, scopeSha256: authorization.scope.scopeSha256, shardId,
    candidatePresentation: authorization.study.candidatePresentation };
}
export function assertEvolutionReleaseContextBinding(plan: EvolutionReleaseContextPlan, authorization: EvolutionReleaseAuthorization, shardId: string): void {
  validateEvolutionReleaseContextPlanEnvelope(plan);
  const binding = evolutionReleaseContextBinding(authorization, shardId);
  if (Object.entries(binding).some(([key, value]) => plan[key as keyof EvolutionReleaseContextBinding] !== value)
    || !same(plan.variants, authorization.study.variants) || plan.manifestSha256 !== authorization.study.manifestPin.sha256
    || plan.retrievalSourceSha256 !== authorization.study.retrievalSourceSha256
    || !same(plan.questions.map(q => q.id), evolutionReleaseShard(authorization, shardId).questionIds)) fail("context differs from study/scope/exact shard");
}
export function makeEvolutionReleaseContextPlan(input: Readonly<{ dataset: EvolutionRunnerInput; basePlan: EvolutionContextPlan; binding: EvolutionReleaseContextBinding }>): EvolutionReleaseContextPlan {
  const base = validateEvolutionContextPlan(input.basePlan);
  validateEvolutionContextPlanSources(base, input.dataset);
  const binding = input.binding;
  if ([binding.studySha256, binding.scopeSha256].some(x => parseSha256Hex(x) === null) || !/^shard-00[1-5]$/.test(binding.shardId)
    || binding.candidatePresentation !== "retrieval-order" || base.questions.length !== 100 || base.variants.length !== 2
    || base.variants[0]!.system !== "bm25-window" || base.variants[1]!.system !== "oh-semantic"
    || base.variants.some(v => v.budget.contextBytes !== 96_000 || v.budget.topK !== 100)) fail("fixed bound required");
  const cases = base.cases.map(c => ({ ...c, kind: "whole-turn" as const }));
  const { planSha256: _old, protocol: _protocol, cases: _cases, ...fields } = base;
  const payload = { protocol: "oh.memory.evolution-context-plan.v6" as const, ...fields, ...binding, basePlan: base, cases };
  return freezeEvolutionCompletion(structuredClone({ ...payload, planSha256: canonicalSha256(payload) }));
}
/** Reuse a parent study's exact retrieval results under a rebound study whose only differences are reader and
 * campaign. The parent's retrieval outputs are re-validated against the current source rendering; retrieval is not rerun,
 * and the rebound study must declare the parent study and retrieval-source digests it inherits. */
export function rebindEvolutionReleaseContextPlan(input: Readonly<{ dataset: EvolutionRunnerInput; parent: EvolutionReleaseContextPlan;
  authorization: EvolutionReleaseAuthorization; shardId: string; retrievalSourceSha256: string }>): EvolutionReleaseContextPlan {
  const parent = validateEvolutionReleaseContextPlanEnvelope(input.parent), { study } = input.authorization, provenance = study.retrievalProvenance;
  if (provenance === undefined) fail("rebound study must declare retrieval provenance");
  if (parent.studySha256 === input.authorization.studySha256 || parent.studySha256 !== provenance.parentStudySha256
    || parent.retrievalSourceSha256 !== provenance.parentRetrievalSourceSha256 || parent.shardId !== input.shardId) fail("parent context does not match declared provenance/shard");
  if (study.retrievalSourceSha256 !== input.retrievalSourceSha256 || parseSha256Hex(input.retrievalSourceSha256) === null) fail("rebound study must pin the current retrieval source");
  validateEvolutionContextPlanSources(parent.basePlan, input.dataset);
  const { planSha256: _old, ...fields } = parent.basePlan;
  const payload = { ...fields, retrievalSourceSha256: input.retrievalSourceSha256 };
  const basePlan = freezeEvolutionCompletion(structuredClone({ ...payload, planSha256: canonicalSha256(payload) })) as EvolutionContextPlan;
  const plan = makeEvolutionReleaseContextPlan({ dataset: input.dataset, basePlan, binding: evolutionReleaseContextBinding(input.authorization, input.shardId) });
  assertEvolutionReleaseContextBinding(plan, input.authorization, input.shardId);
  if (!same(plan.cases.map(c => c.result), parent.cases.map(c => c.result)) || !same(plan.questions, parent.questions)) fail("rebound retrieval changed");
  return plan;
}
export function validateEvolutionReleaseContextPlanEnvelope(value: unknown): EvolutionReleaseContextPlan {
  boundEvolutionCompletionWire(value, 128 * 1024 * 1024, 4_000_000);
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "variants", "questions", "cases", "planSha256", "studySha256", "scopeSha256", "shardId", "candidatePresentation", "basePlan"])
    || value.protocol !== "oh.memory.evolution-context-plan.v6") fail("exact V6 context required");
  const plan = value as unknown as EvolutionReleaseContextPlan, base = validateEvolutionContextPlan(plan.basePlan);
  for (const d of [plan.studySha256, plan.scopeSha256, plan.planSha256]) if (parseSha256Hex(d) === null) fail("digest required");
  if (!/^shard-00[1-5]$/.test(plan.shardId) || plan.candidatePresentation !== "retrieval-order"
    || base.questions.length !== 100 || base.variants.length !== 2 || base.variants[0]!.system !== "bm25-window" || base.variants[1]!.system !== "oh-semantic"
    || base.variants.some(v => v.budget.contextBytes !== 96_000 || v.budget.topK !== 100)
    || plan.manifestSha256 !== base.manifestSha256 || plan.retrievalSourceSha256 !== base.retrievalSourceSha256 || plan.inputSha256 !== base.inputSha256
    || !same(plan.questions, base.questions) || !same(plan.variants, base.variants) || !Array.isArray(plan.cases) || plan.cases.length !== 200) fail("base context binding");
  const keys = (rows: readonly { questionId: string; variantId: string }[]) => rows.map(c => JSON.stringify([c.questionId, c.variantId]));
  assertExactEvolutionCoverage(keys(base.cases), keys(plan.cases));
  const originals = new Map(base.cases.map(c => [JSON.stringify([c.questionId, c.variantId]), c]));
  for (const c of plan.cases) {
    if (!isPlainRecord(c) || !hasExactKeys(c, ["questionId", "variantId", "kind", "result"])) fail("case shape");
    const original = originals.get(JSON.stringify([c.questionId, c.variantId]))!;
    if (c.kind !== "whole-turn" || !same(c.result, original.result)) fail("base retrieval changed");
  }
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(payload) !== planSha256) fail("plan digest");
  return plan;
}
export function validateEvolutionReleaseContextPlanSources(plan: EvolutionReleaseContextPlan, dataset: EvolutionRunnerInput): void {
  validateEvolutionReleaseContextPlanEnvelope(plan);
  const expected = makeEvolutionReleaseContextPlan({ dataset, basePlan: plan.basePlan,
    binding: { studySha256: plan.studySha256, scopeSha256: plan.scopeSha256, shardId: plan.shardId, candidatePresentation: plan.candidatePresentation } });
  if (!same(expected, plan)) fail("context differs from current source reconstruction");
}
