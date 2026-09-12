/** Reader plan V2: one logical case per (question, variant, reader, stage, repeat). Physical requests are still
 * deduplicated by request digest; the repeat index is carried to the campaign store, which keys every occupied
 * attempt by (request, repeat), so a repeat is a distinct predeclared first attempt, never a retry. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { assertExactEvolutionCoverage } from "./evolution-dataset";
import { makeEvolutionRequest, evolutionReaderContract, validateEvolutionRequest, type EvolutionProfileId, type EvolutionRequest } from "./evolution-model";
import { validateEvolutionContextPlanV9Envelope, type EvolutionContextPlanV9 } from "./evolution-plan-v9";
import { evolutionAnswerMessages } from "./evolution-reader-contracts";

export const EVOLUTION_READER_PLAN_V2_PROTOCOL = "oh.memory.evolution-reader-plan.v2" as const;
/** `answer` is the single-call stage implemented here. `select` is reserved for the two-stage evidence-selection reader;
 * a plan naming it is rejected until that stage's request derivation is admitted by its own protocol revision. */
export const EVOLUTION_READER_STAGES = ["select", "answer"] as const;
export type EvolutionReaderStage = typeof EVOLUTION_READER_STAGES[number];
export type EvolutionReaderCaseV2 = Readonly<{ questionId: string; variantId: string; reader: EvolutionProfileId; stage: EvolutionReaderStage;
  repeat: number; contextSha256: string; requestSha256: string }>;
export type EvolutionReaderPlanV2 = Readonly<{ protocol: typeof EVOLUTION_READER_PLAN_V2_PROTOCOL; contextPlanSha256: string; manifestSha256: string;
  readerProfiles: readonly EvolutionProfileId[]; repeats: number; stages: readonly EvolutionReaderStage[];
  cases: readonly EvolutionReaderCaseV2[]; requests: readonly EvolutionRequest[]; planSha256: string }>;
/** A physical dispatch unit: the store keys attempts by (request, repeat). */
export type EvolutionPhysicalJob = Readonly<{ key: string; request: EvolutionRequest; repeat: number }>;
function fail(reason: string): never { throw new TypeError(`Evolution reader plan V2: ${reason}.`); }
const digest = (value: string) => { if (parseSha256Hex(value) === null) fail("invalid digest"); return value; };
export const evolutionJobKey = (requestSha256: string, repeat: number) => `${requestSha256}#${repeat}`;
export function evolutionPhysicalJobs(requests: readonly EvolutionRequest[], pairs: ReadonlyArray<Readonly<{ requestSha256: string; repeat: number }>>): readonly EvolutionPhysicalJob[] {
  const byDigest = new Map(requests.map(r => [r.requestSha256, r])), seen = new Set<string>(), jobs: EvolutionPhysicalJob[] = [];
  for (const pair of pairs) {
    const request = byDigest.get(pair.requestSha256);
    if (request === undefined || !Number.isSafeInteger(pair.repeat) || pair.repeat < 0 || pair.repeat > 2) fail("unknown request or repeat index");
    const key = evolutionJobKey(pair.requestSha256, pair.repeat);
    if (seen.has(key)) continue;
    seen.add(key); jobs.push({ key, request, repeat: pair.repeat });
  }
  return jobs;
}
export function makeEvolutionReaderPlanV2(context: EvolutionContextPlanV9, readerProfiles: readonly EvolutionProfileId[], repeats: number): EvolutionReaderPlanV2 {
  validateEvolutionContextPlanV9Envelope(context);
  if (readerProfiles.length < 1 || readerProfiles.length > 4 || new Set(readerProfiles).size !== readerProfiles.length
    || readerProfiles.some(p => !p.endsWith("-reader"))) fail("distinct reader profiles required");
  if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 3) fail("repeats require 1..3");
  const cases: EvolutionReaderCaseV2[] = [], requests = new Map<string, EvolutionRequest>();
  for (const c of context.cases) {
    const question = context.questions.find(q => q.id === c.questionId)!;
    for (const reader of readerProfiles) {
      const request = makeEvolutionRequest(reader, evolutionAnswerMessages(question, c.result.context, evolutionReaderContract(reader)));
      requests.set(request.requestSha256, request);
      for (let repeat = 0; repeat < repeats; repeat++) {
        cases.push({ questionId: c.questionId, variantId: c.variantId, reader, stage: "answer", repeat, contextSha256: c.result.contextSha256, requestSha256: request.requestSha256 });
      }
    }
  }
  const payload = { protocol: EVOLUTION_READER_PLAN_V2_PROTOCOL, contextPlanSha256: context.planSha256, manifestSha256: context.manifestSha256,
    readerProfiles: [...readerProfiles], repeats, stages: ["answer" as const], cases, requests: [...requests.values()] };
  return { ...payload, planSha256: canonicalSha256(payload) };
}
export function validateEvolutionReaderPlanV2(plan: EvolutionReaderPlanV2, context: EvolutionContextPlanV9): EvolutionReaderPlanV2 {
  if (!isPlainRecord(plan) || !hasExactKeys(plan, ["protocol", "contextPlanSha256", "manifestSha256", "readerProfiles", "repeats", "stages", "cases", "requests", "planSha256"])) fail("exact V2 plan required");
  const { planSha256, ...payload } = plan;
  if (plan.protocol !== EVOLUTION_READER_PLAN_V2_PROTOCOL || canonicalSha256(payload) !== digest(planSha256) || !Array.isArray(plan.cases)
    || plan.cases.length < 1 || plan.cases.length > 512_000 || !Array.isArray(plan.requests) || plan.requests.length < 1 || plan.requests.length > plan.cases.length
    || !Number.isSafeInteger(plan.repeats) || plan.repeats < 1 || plan.repeats > 3 || !Array.isArray(plan.stages)) fail("reader plan bounds or identity");
  if (plan.stages.length !== 1 || plan.stages[0] !== "answer") fail("the select stage requires the two-stage reader protocol revision");
  digest(plan.contextPlanSha256); digest(plan.manifestSha256);
  const requests = new Map(plan.requests.map(request => { validateEvolutionRequest(request); return [request.requestSha256, request] as const; }));
  if (requests.size !== plan.requests.length) fail("duplicate physical requests");
  const identities = plan.cases.map(c => JSON.stringify([c.questionId, c.variantId, c.reader, c.stage, c.repeat]));
  assertExactEvolutionCoverage(identities, identities);
  for (const c of plan.cases as readonly unknown[]) {
    if (!isPlainRecord(c) || !hasExactKeys(c, ["questionId", "variantId", "reader", "stage", "repeat", "contextSha256", "requestSha256"])) fail("case shape");
    const row = c as EvolutionReaderCaseV2;
    if (row.stage !== "answer" || !Number.isSafeInteger(row.repeat) || row.repeat < 0 || row.repeat >= plan.repeats
      || requests.get(row.requestSha256)?.profileId !== row.reader || !plan.readerProfiles.includes(row.reader)) fail("case/request profile, stage or repeat mismatch");
  }
  if ([...requests.keys()].some(key => !plan.cases.some(c => c.requestSha256 === key))) fail("unselected physical request");
  const expected = makeEvolutionReaderPlanV2(context, plan.readerProfiles, plan.repeats);
  if (canonicalSha256(expected) !== canonicalSha256(plan)) fail("reader matrix differs from the complete prepared context/profile/repeat product");
  return plan;
}
export function evolutionReaderJobsV2(plan: EvolutionReaderPlanV2): readonly EvolutionPhysicalJob[] {
  return evolutionPhysicalJobs(plan.requests, plan.cases.map(c => ({ requestSha256: c.requestSha256, repeat: c.repeat })));
}
