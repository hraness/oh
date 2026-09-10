/** V9 judge plan: one logical case per reader case (question, variant, reader, stage, repeat) and declared judge
 * repeat index. Physical judge requests are deduplicated by digest and dispatched once per judge repeat index, so a
 * judge repeat is a distinct predeclared first attempt in the campaign store, never a retry. Gold enters only here. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import type { Dataset } from "./datasets";
import { assertExactEvolutionCoverage, evolutionRunnerQuestionId } from "./evolution-dataset";
import { EVOLUTION_LME_NATIVE_REFERENCE, evolutionJudgeScoringRule, type EvolutionJudgeScoringRule } from "./evolution-judge";
import { EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, buildLocomoJudgeMessages, loadLocomoJudgeProfile, type EvolutionLocomoJudgeProfile } from "./evolution-locomo-judge";
import { makeEvolutionRequest, validateEvolutionRequest, type EvolutionProfileId, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import type { EvolutionContextPlanV9 } from "./evolution-plan-v9";
import { evolutionJobKey, evolutionPhysicalJobs, evolutionReaderJobsV2, validateEvolutionReaderPlanV2, type EvolutionPhysicalJob,
  type EvolutionReaderPlanV2, type EvolutionReaderStage } from "./evolution-reader-plan-v2";
import { validateEvolutionAttemptFailure, type EvolutionAttemptFailure } from "./evolution-store";
import { EVOLUTION_V9_JUDGES, type EvolutionV9Judge } from "./evolution-study-v9";
import { buildJudgePrompt, loadJudgeProfile } from "./judge";

export const EVOLUTION_JUDGE_PLAN_V9_PROTOCOL = "oh.memory.evolution-judge-plan.v9" as const;
export type EvolutionNativeJudgeProfile = Awaited<ReturnType<typeof loadJudgeProfile>>;
/** The rubric a V9 judge plan renders with: the pinned native LongMemEval prompts or the LoCoMo parity prompt. */
export type EvolutionJudgeRubricV9 = Readonly<{ kind: "longmemeval-native"; sha256: string; profile: EvolutionNativeJudgeProfile }>
  | Readonly<{ kind: "locomo-parity"; sha256: string; profile: EvolutionLocomoJudgeProfile }>;
export type EvolutionJudgeCaseV9 = Readonly<{ questionId: string; variantId: string; reader: EvolutionProfileId; stage: EvolutionReaderStage;
  repeat: number; judgeRepeat: number; readerRequestSha256: string; requestSha256: string | null; readerFailed: boolean }>;
export type EvolutionJudgePlanV9 = Readonly<{ protocol: typeof EVOLUTION_JUDGE_PLAN_V9_PROTOCOL; readerPlanSha256: string; readerOutputSha256: string;
  profile: EvolutionV9Judge; rubricSha256: string; scoringRule: EvolutionJudgeScoringRule; judgeRepeats: number;
  cases: readonly EvolutionJudgeCaseV9[]; requests: readonly EvolutionRequest[]; planSha256: string }>;
const PLAN_KEYS = ["protocol", "readerPlanSha256", "readerOutputSha256", "profile", "rubricSha256", "scoringRule", "judgeRepeats", "cases", "requests", "planSha256"] as const;
const CASE_KEYS = ["questionId", "variantId", "reader", "stage", "repeat", "judgeRepeat", "readerRequestSha256", "requestSha256", "readerFailed"] as const;
function fail(message: string): never { throw new TypeError(`Evolution judge V9: ${message}.`); }
export const evolutionJudgeCaseKeyV9 = (c: Pick<EvolutionJudgeCaseV9, "questionId" | "variantId" | "reader" | "stage" | "repeat" | "judgeRepeat">) =>
  JSON.stringify([c.questionId, c.variantId, c.reader, c.stage, c.repeat, c.judgeRepeat]);
function judgeRepeatCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 3) fail("judge repeats require 1..3");
  return value as number;
}
export function isEvolutionV9Judge(value: unknown): value is EvolutionV9Judge { return (EVOLUTION_V9_JUDGES as readonly unknown[]).includes(value); }

/** Loads the rubric bound to a V9 judge profile. The native rubric must remain the parity-qualified pinned bytes. */
export async function loadEvolutionJudgeRubricV9(profile: EvolutionV9Judge): Promise<EvolutionJudgeRubricV9> {
  if (!isEvolutionV9Judge(profile)) fail("unknown V9 judge profile");
  if (profile === EVOLUTION_LOCOMO_JUDGE_PROFILE_ID) {
    const loaded = await loadLocomoJudgeProfile();
    return Object.freeze({ kind: "locomo-parity", sha256: loaded.sha256, profile: loaded });
  }
  const loaded = await loadJudgeProfile();
  if (loaded.sha256 !== EVOLUTION_LME_NATIVE_REFERENCE.parityRubricSha256) fail("native judge requires the parity-qualified rubric");
  return Object.freeze({ kind: "longmemeval-native", sha256: loaded.sha256, profile: loaded });
}
function judgeMessages(profile: EvolutionV9Judge, rubric: EvolutionJudgeRubricV9, question: Dataset["questions"][number], answer: string) {
  if ((profile === EVOLUTION_LOCOMO_JUDGE_PROFILE_ID) !== (rubric.kind === "locomo-parity")) fail("rubric kind differs from the judge profile");
  if (rubric.kind === "locomo-parity") return buildLocomoJudgeMessages(question, answer, rubric.profile);
  return [{ role: "user" as const, content: buildJudgePrompt(question, answer, rubric.profile) }];
}

/** Pure gold-bearing stage. The caller authenticates response bytes per (request, repeat) job before supplying them. */
export function makeEvolutionJudgePlanV9(input: Readonly<{ contextPlan: EvolutionContextPlanV9; readerPlan: EvolutionReaderPlanV2;
  responses: ReadonlyMap<string, EvolutionResponse>; failures?: ReadonlyMap<string, EvolutionAttemptFailure>; dataset: Dataset;
  profile: EvolutionV9Judge; rubric: EvolutionJudgeRubricV9; judgeRepeats: number; readerOutputSha256: string }>): EvolutionJudgePlanV9 {
  const reader = validateEvolutionReaderPlanV2(input.readerPlan, input.contextPlan), judgeRepeats = judgeRepeatCount(input.judgeRepeats);
  if (!isEvolutionV9Judge(input.profile) || parseSha256Hex(input.readerOutputSha256) === null) fail("unknown judge profile or reader output digest");
  if ((input.profile === EVOLUTION_LOCOMO_JUDGE_PROFILE_ID) !== (input.rubric.kind === "locomo-parity") || parseSha256Hex(input.rubric.sha256) === null) fail("rubric kind differs from the judge profile");
  const failures = input.failures ?? new Map<string, EvolutionAttemptFailure>(), jobs = evolutionReaderJobsV2(reader);
  assertExactEvolutionCoverage(jobs.map(j => j.key), [...input.responses.keys(), ...failures.keys()]);
  for (const job of jobs) {
    const failure = failures.get(job.key), response = input.responses.get(job.key);
    if (failure !== undefined) validateEvolutionAttemptFailure(failure, job.request, job.repeat);
    if (response !== undefined && response.requestSha256 !== job.request.requestSha256) fail("response belongs to another reader request");
  }
  const questions = new Map(input.dataset.questions.map(q => [evolutionRunnerQuestionId(q.id), q]));
  assertExactEvolutionCoverage([...questions.keys()], input.contextPlan.questions.map(q => q.id));
  const requests = new Map<string, EvolutionRequest>();
  const cases = reader.cases.flatMap(c => {
    const question = questions.get(c.questionId)!, response = input.responses.get(evolutionJobKey(c.requestSha256, c.repeat));
    let requestSha256: string | null = null;
    if (response?.status === "completed" && response.answer !== null) {
      const request = makeEvolutionRequest(input.profile, judgeMessages(input.profile, input.rubric, question, response.answer));
      requests.set(request.requestSha256, request); requestSha256 = request.requestSha256;
    }
    return Array.from({ length: judgeRepeats }, (_, judgeRepeat): EvolutionJudgeCaseV9 => ({ questionId: c.questionId, variantId: c.variantId, reader: c.reader,
      stage: c.stage, repeat: c.repeat, judgeRepeat, readerRequestSha256: c.requestSha256, requestSha256, readerFailed: requestSha256 === null }));
  });
  const payload = { protocol: EVOLUTION_JUDGE_PLAN_V9_PROTOCOL, readerPlanSha256: reader.planSha256, readerOutputSha256: input.readerOutputSha256,
    profile: input.profile, rubricSha256: input.rubric.sha256, scoringRule: evolutionJudgeScoringRule(input.profile), judgeRepeats, cases, requests: [...requests.values()] };
  return validateEvolutionJudgePlanV9({ ...payload, planSha256: canonicalSha256(payload) });
}

/** Shape, digest and closed-list validation; the runner separately rebuilds the plan from authenticated reader evidence. */
export function validateEvolutionJudgePlanV9(plan: EvolutionJudgePlanV9): EvolutionJudgePlanV9 {
  if (!isPlainRecord(plan) || !hasExactKeys(plan, PLAN_KEYS) || !isEvolutionV9Judge(plan.profile)
    || !Array.isArray(plan.cases) || plan.cases.length < 1 || plan.cases.length > 512_000
    || !Array.isArray(plan.requests) || plan.requests.length > plan.cases.length) fail("invalid shape or bounds");
  const { planSha256, ...payload } = plan;
  if (plan.protocol !== EVOLUTION_JUDGE_PLAN_V9_PROTOCOL || canonicalSha256(payload) !== planSha256
    || [plan.readerPlanSha256, plan.readerOutputSha256, plan.rubricSha256].some(d => parseSha256Hex(d) === null)
    || plan.scoringRule !== evolutionJudgeScoringRule(plan.profile)) fail("identity or scoring rule changed");
  const judgeRepeats = judgeRepeatCount(plan.judgeRepeats);
  const requests = new Map(plan.requests.map(request => {
    validateEvolutionRequest(request);
    if (request.profileId !== plan.profile) fail("request profile changed");
    return [request.requestSha256, request] as const;
  }));
  if (requests.size !== plan.requests.length) fail("duplicate physical request");
  const selectedRequests = new Set<string>(), keys: string[] = [];
  for (const c of plan.cases as readonly unknown[]) {
    if (!isPlainRecord(c) || !hasExactKeys(c, CASE_KEYS)) fail("invalid case shape");
    const row = c as EvolutionJudgeCaseV9;
    if (typeof row.readerFailed !== "boolean" || row.stage !== "answer" || [row.questionId, row.variantId, row.reader].some(v => typeof v !== "string" || !v.length || v.length > 256)
      || parseSha256Hex(row.readerRequestSha256) === null || !Number.isSafeInteger(row.repeat) || row.repeat < 0 || row.repeat > 2
      || !Number.isSafeInteger(row.judgeRepeat) || row.judgeRepeat < 0 || row.judgeRepeat >= judgeRepeats
      || (row.readerFailed ? row.requestSha256 !== null : typeof row.requestSha256 !== "string" || !requests.has(row.requestSha256))) fail("invalid case mapping");
    if (row.requestSha256 !== null) selectedRequests.add(row.requestSha256);
    keys.push(evolutionJudgeCaseKeyV9(row));
  }
  assertExactEvolutionCoverage(keys, keys);
  if (selectedRequests.size !== requests.size) fail("unselected physical request");
  // Every reader case carries exactly the declared judge repeat indices; a widened count cannot hide missing cells.
  const perReaderCase = new Map<string, { count: number; request: string | null; readerRequest: string }>();
  for (const c of plan.cases) {
    const key = JSON.stringify([c.questionId, c.variantId, c.reader, c.stage, c.repeat]), group = perReaderCase.get(key);
    if (group === undefined) perReaderCase.set(key, { count: 1, request: c.requestSha256, readerRequest: c.readerRequestSha256 });
    else if (group.request !== c.requestSha256 || group.readerRequest !== c.readerRequestSha256) fail("judge repeats of one reader case disagree on their request");
    else group.count++;
  }
  if ([...perReaderCase.values()].some(g => g.count !== judgeRepeats)) fail("judge repeat coverage differs from the declared count");
  return plan;
}

/** Physical dispatch units: every distinct judge request once per declared judge repeat index. */
export function evolutionJudgeJobsV9(plan: EvolutionJudgePlanV9): readonly EvolutionPhysicalJob[] {
  return evolutionPhysicalJobs(plan.requests, plan.cases.flatMap(c => c.requestSha256 === null ? [] : [{ requestSha256: c.requestSha256, repeat: c.judgeRepeat }]));
}
