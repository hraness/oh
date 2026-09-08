import { canonicalSha256 } from "../../src/canonical";
import { makeGatewayV6JudgePlan, expandGatewayV6Judgments, type GatewayV6JudgePlanInput } from "./gateway-study-plan-v6";
import type { GatewayJudgeRow } from "./gateway-study-plan-v3";
import { GATEWAY_READER_FAILURE_V6_POLICY_SHA256 } from "./gateway-study-transport-v6";
import { gatewayStudyTransportInternals } from "./gateway-study-transport-v3";
import { assessSuperiority, type FamilyCase } from "./superiority";

export type GatewayV6AssessmentInput = GatewayV6JudgePlanInput & Readonly<{ poolSize: number; selected: readonly FamilyCase[];
  physicalJudgeRows: readonly GatewayJudgeRow[]; caseOutcomes: readonly unknown[] }>;

/** Reader and judge responses must first be replayed from authenticated raw evidence by the caller.
 * This adapter reconstructs every grade and provenance field; only its private numerical projection
 * treats policy-scored failures as resolved binary inputs. Public reader/case statuses remain failures. */
export function assessGatewayV6Superiority(input: GatewayV6AssessmentInput) {
  if (input.questions.length !== input.selected.length || input.caseOutcomes.length !== input.selected.length * 3) {
    throw new TypeError("Gateway assessment v6: complete selected matrix required.");
  }
  const plan = makeGatewayV6JudgePlan(input), outcomes = expandGatewayV6Judgments(plan, input.physicalJudgeRows);
  if (canonicalSha256(outcomes) !== canonicalSha256(input.caseOutcomes)) throw new TypeError("Gateway assessment v6: scoring provenance drift.");
  for (const [i, selected] of input.selected.entries()) {
    const first = outcomes[i * 3];
    if (first === undefined || selected.questionId !== first.questionId || selected.corpusId !== first.corpusId || selected.groupId !== first.groupId) {
      throw new TypeError("Gateway assessment v6: selected family order drift.");
    }
  }
  const project = (adverse: boolean) => outcomes.map(row => ({ questionId: row.questionId, corpusId: row.corpusId, groupId: row.groupId,
    system: row.system, status: "completed" as const,
    correct: adverse && row.decisionSource === "reader-failure-policy" && row.system !== "oh-fact" ? 1 : row.correct }));
  const primary = assessSuperiority(input.poolSize, input.selected, project(false));
  const adverse = assessSuperiority(input.poolSize, input.selected, project(true));
  const failures = outcomes.filter(row => row.decisionSource === "reader-failure-policy");
  return gatewayStudyTransportInternals.frozen({ profile: "oh.memory-gateway-assessment.v6" as const,
    policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256, primary, adverse,
    criterionPassed: primary.established, robustToReaderFailureAssignments: primary.established && adverse.established,
    coverage: { cases: outcomes.length, modelJudgedCases: outcomes.length - failures.length, policyScoredReaderFailures: failures.length,
      physicalJudgeRequests: plan.jobs.length },
    failureCountsBySystem: Object.fromEntries(["oh-fact", "bm25-window", "bm25-record-window"].map(system => [system, failures.filter(row => row.system === system).length])),
    caseOutcomesSha256: canonicalSha256(outcomes), judgePlanSha256: canonicalSha256(plan),
    scope: "Post-start reader-failure scoring amendment; original studies remain incomplete; no unchanged confirmatory error control or official leaderboard claim." });
}
