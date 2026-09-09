import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import type { Dataset } from "./datasets";
import { assertExactEvolutionCoverage, evolutionRunnerQuestionId } from "./evolution-dataset";
import { makeEvolutionRequest, validateEvolutionRequest, type EvolutionProfileId, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { validateEvolutionReaderPlan, type EvolutionContextPlan, type EvolutionReaderPlan } from "./evolution-plan";
import { buildJudgePrompt, loadJudgeProfile, parseJudgeDecision } from "./judge";

export type EvolutionJudgeProfileId = "gpt4o-gateway-judge" | "gpt4o-official-snapshot-judge";
// Offline differential evidence: all six official task types, abstention and literal-field interpolation.
// The upstream MIT attribution/license and exact prompt text are retained in the pinned profile JSON.
export const EVOLUTION_LME_NATIVE_REFERENCE = {
  evaluator: "https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py",
  sourceSha256: "ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251",
  parityRubricSha256: "00d319ba0a194a69871576d8c677c1557d7706f69b599c9b7beee32441d58cfc",
} as const;
export type EvolutionJudgeCase = Readonly<{ questionId: string; variantId: string; reader: EvolutionProfileId;
  requestSha256: string | null; readerFailed: boolean }>;
export type EvolutionJudgePlan = Readonly<{ protocol: "oh.memory.evolution-judge-plan.v1";
  readerPlanSha256: string; readerOutputSha256: string; profile: EvolutionJudgeProfileId; rubricSha256: string;
  scoringRule: "native-contains-yes" | "strict-yes-no"; cases: readonly EvolutionJudgeCase[];
  requests: readonly EvolutionRequest[]; planSha256: string }>;
const fail = (message: string): never => { throw new TypeError(`Evolution judge: ${message}.`); };
const caseKey = (c: EvolutionJudgeCase) => JSON.stringify([c.questionId, c.variantId, c.reader]);
const profileRule = (profile: EvolutionJudgeProfileId) => profile === "gpt4o-official-snapshot-judge" ? "native-contains-yes" as const : "strict-yes-no" as const;

export function scoreEvolutionJudgeDecision(profile: EvolutionJudgeProfileId, answer: unknown): 0 | 1 | null {
  if (profile !== "gpt4o-official-snapshot-judge" && profile !== "gpt4o-gateway-judge") fail("unknown judge profile");
  if (profile === "gpt4o-gateway-judge") return parseJudgeDecision(answer);
  return typeof answer === "string" ? Number(answer.toLowerCase().includes("yes")) as 0 | 1 : null;
}

export function validateEvolutionJudgePlan(plan: EvolutionJudgePlan): EvolutionJudgePlan {
  if (!isPlainRecord(plan) || !hasExactKeys(plan, ["protocol", "readerPlanSha256", "readerOutputSha256", "profile", "rubricSha256", "scoringRule", "cases", "requests", "planSha256"])
    || !["gpt4o-gateway-judge", "gpt4o-official-snapshot-judge"].includes(plan.profile)
    || !Array.isArray(plan.cases) || plan.cases.length < 1 || plan.cases.length > 512_000
    || !Array.isArray(plan.requests) || plan.requests.length > plan.cases.length) fail("invalid shape or bounds");
  const { planSha256, ...payload } = plan;
  if (plan.protocol !== "oh.memory.evolution-judge-plan.v1" || canonicalSha256(payload) !== planSha256
    || [plan.readerPlanSha256, plan.readerOutputSha256, plan.rubricSha256].some(d => parseSha256Hex(d) === null)
    || plan.scoringRule !== profileRule(plan.profile)) fail("identity or scoring rule changed");
  const requests = new Map(plan.requests.map(request => {
    validateEvolutionRequest(request);
    if (request.profileId !== plan.profile) fail("request profile changed");
    return [request.requestSha256, request] as const;
  }));
  if (requests.size !== plan.requests.length) fail("duplicate physical request");
  const selectedRequests = new Set<string>();
  for (const c of plan.cases) {
    if (!isPlainRecord(c) || !hasExactKeys(c, ["questionId", "variantId", "reader", "requestSha256", "readerFailed"])
      || typeof c.readerFailed !== "boolean" || [c.questionId, c.variantId, c.reader].some(v => typeof v !== "string" || !v.length || v.length > 256)
      || (c.readerFailed ? c.requestSha256 !== null : typeof c.requestSha256 !== "string" || !requests.has(c.requestSha256))) fail("invalid case mapping");
    if (c.requestSha256 !== null) selectedRequests.add(c.requestSha256);
  }
  const keys = plan.cases.map(caseKey); assertExactEvolutionCoverage(keys, keys);
  if (selectedRequests.size !== requests.size) fail("unselected physical request");
  return plan;
}

/** Pure gold-bearing stage. The caller authenticates response bytes before supplying responses. */
export function makeEvolutionJudgePlan(input: Readonly<{ contextPlan: EvolutionContextPlan; readerPlan: EvolutionReaderPlan;
  responses: ReadonlyMap<string, EvolutionResponse>; dataset: Dataset; profile: EvolutionJudgeProfileId;
  rubric: Awaited<ReturnType<typeof loadJudgeProfile>>; readerOutputSha256: string }>): EvolutionJudgePlan {
  const reader = validateEvolutionReaderPlan(input.readerPlan, input.contextPlan);
  if (input.profile === "gpt4o-official-snapshot-judge" && input.rubric.sha256 !== EVOLUTION_LME_NATIVE_REFERENCE.parityRubricSha256) {
    fail("direct native judge requires the parity-qualified rubric");
  }
  assertExactEvolutionCoverage(reader.requests.map(r => r.requestSha256), [...input.responses.keys()]);
  const questions = new Map(input.dataset.questions.map(q => [evolutionRunnerQuestionId(q.id), q]));
  assertExactEvolutionCoverage([...questions.keys()], input.contextPlan.questions.map(q => q.id));
  const requests = new Map<string, EvolutionRequest>();
  const cases = reader.cases.map(c => {
    const question = questions.get(c.questionId)!, response = input.responses.get(c.requestSha256)!;
    if (response.requestSha256 !== c.requestSha256) fail("response belongs to another reader request");
    let requestSha256: string | null = null;
    if (response.status === "completed" && response.answer !== null) {
      const prompt = buildJudgePrompt(question, response.answer, input.rubric);
      const messages = input.profile === "gpt4o-official-snapshot-judge"
        ? [{ role: "user" as const, content: prompt }]
        : [{ role: "system" as const, content: "You are a fair and precise evaluator." }, { role: "user" as const, content: prompt }];
      const request = makeEvolutionRequest(input.profile, messages);
      requests.set(request.requestSha256, request); requestSha256 = request.requestSha256;
    }
    return { questionId: c.questionId, variantId: c.variantId, reader: c.reader, requestSha256, readerFailed: requestSha256 === null };
  });
  const payload = { protocol: "oh.memory.evolution-judge-plan.v1" as const, readerPlanSha256: reader.planSha256,
    readerOutputSha256: input.readerOutputSha256, profile: input.profile, rubricSha256: input.rubric.sha256,
    scoringRule: profileRule(input.profile), cases, requests: [...requests.values()] };
  return validateEvolutionJudgePlan({ ...payload, planSha256: canonicalSha256(payload) });
}
