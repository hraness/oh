/** Scope-bound complete source with one serialized copy of each long context. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import type { EvolutionRunnerInput } from "./evolution-dataset";
import { makeEvolutionContextPlanV3, validateEvolutionContextPlanV3, validateEvolutionContextPlanV3Sources, type EvolutionContextPlanV3 } from "./evolution-plan-v3";
import { evolutionReleaseShard } from "./evolution-release";
import { EVOLUTION_FULL_CONTEXT_VARIANTS, type EvolutionFullContextAuthorization } from "./evolution-full-context-study";

export type EvolutionFullContextBinding = Readonly<{ studySha256: string; parentStudySha256: string; parentScopeSha256: string; shardId: string }>;
export type EvolutionFullContextPlan = Omit<EvolutionContextPlanV3, "protocol"> & EvolutionFullContextBinding & Readonly<{ protocol: "oh.memory.evolution-context-plan.v7" }>;
function fail(reason: string): never { throw new TypeError(`Evolution full-context plan: ${reason}.`); }
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
export function evolutionFullContextBinding(authorization: EvolutionFullContextAuthorization, shardId: string): EvolutionFullContextBinding {
  evolutionReleaseShard(authorization.parent, shardId);
  return { studySha256: authorization.studySha256, parentStudySha256: authorization.parent.studySha256,
    parentScopeSha256: authorization.parent.scope.scopeSha256, shardId };
}
function base(plan: EvolutionFullContextPlan): EvolutionContextPlanV3 {
  const { protocol: _protocol, planSha256: _hash, studySha256: _study, parentStudySha256: _parent, parentScopeSha256: _scope, shardId: _shard, ...fields } = plan;
  const payload = { protocol: "oh.memory.evolution-context-plan.v3" as const, ...fields };
  return { ...payload, planSha256: canonicalSha256(payload) };
}
export function validateEvolutionFullContextPlanEnvelope(value: unknown): EvolutionFullContextPlan {
  boundEvolutionCompletionWire(value, 128 * 1024 * 1024, 4_000_000);
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "manifestSha256", "retrievalSourceSha256", "inputSha256", "variants", "questions", "cases", "pools", "planSha256",
    "studySha256", "parentStudySha256", "parentScopeSha256", "shardId"])
    || value.protocol !== "oh.memory.evolution-context-plan.v7" || typeof value.shardId !== "string" || !/^shard-00[1-5]$/.test(value.shardId)
    || [value.studySha256, value.parentStudySha256, value.parentScopeSha256].some(d => parseSha256Hex(d) === null)) fail("exact companion envelope required");
  const plan = value as unknown as EvolutionFullContextPlan;
  if (!same(plan.variants, EVOLUTION_FULL_CONTEXT_VARIANTS) || !Array.isArray(plan.questions) || plan.questions.length !== 100
    || !Array.isArray(plan.cases) || plan.cases.length !== 100 || plan.cases.some(c => c.kind !== "full-history")
    || !Array.isArray(plan.pools) || plan.pools.length !== 0) fail("one untruncated full-history arm for100 cases required");
  validateEvolutionContextPlanV3(base(plan));
  const { planSha256, ...payload } = plan;
  if (canonicalSha256(payload) !== planSha256) fail("companion plan digest changed");
  return plan;
}
export function assertEvolutionFullContextBinding(plan: EvolutionFullContextPlan, authorization: EvolutionFullContextAuthorization, shardId: string): void {
  validateEvolutionFullContextPlanEnvelope(plan);
  if (Object.entries(evolutionFullContextBinding(authorization, shardId)).some(([key, value]) => plan[key as keyof EvolutionFullContextBinding] !== value)
    || plan.manifestSha256 !== authorization.study.manifestPin.sha256 || plan.retrievalSourceSha256 !== authorization.study.sourceSha256
    || !same(plan.questions.map(q => q.id), evolutionReleaseShard(authorization.parent, shardId).questionIds)) fail("companion differs from exact study/source/shard");
}
export async function makeEvolutionFullContextPlan(input: Readonly<{ dataset: EvolutionRunnerInput; authorization: EvolutionFullContextAuthorization; shardId: string }>) {
  const binding = evolutionFullContextBinding(input.authorization, input.shardId);
  const made = await makeEvolutionContextPlanV3({ dataset: input.dataset, variants: EVOLUTION_FULL_CONTEXT_VARIANTS,
    manifestSha256: input.authorization.study.manifestPin.sha256, retrievalSourceSha256: input.authorization.study.sourceSha256 });
  const { protocol: _protocol, planSha256: _hash, ...fields } = made.plan;
  const payload = { protocol: "oh.memory.evolution-context-plan.v7" as const, ...fields, ...binding };
  const plan: EvolutionFullContextPlan = freezeEvolutionCompletion({ ...payload, planSha256: canonicalSha256(payload) });
  assertEvolutionFullContextBinding(plan, input.authorization, input.shardId);
  return { plan, timing: made.timing };
}
export function validateEvolutionFullContextPlanSources(plan: EvolutionFullContextPlan, dataset: EvolutionRunnerInput): void {
  validateEvolutionFullContextPlanEnvelope(plan); validateEvolutionContextPlanV3Sources(base(plan), dataset);
}
