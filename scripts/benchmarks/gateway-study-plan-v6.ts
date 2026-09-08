import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { CLAUDE_JUDGE_SYSTEM, CLAUDE_STUDY_SYSTEMS } from "./claude-study-plan";
import type { Question } from "./datasets";
import { GATEWAY_STUDY_PLAN_V3_PROFILE, type GatewayExtractionJob, type GatewayReaderJob, type GatewayReaderRow,
  type GatewayJudgeJob, type GatewayJudgeRow } from "./gateway-study-plan-v3";
import { completeGatewayV5Extraction, completeGatewayV5Reader, completeGatewayV5Judge } from "./gateway-study-plan-v5";
import { makeGatewayStudyRequest, gatewayStudyTransportInternals } from "./gateway-study-transport-v3";
import { GATEWAY_READER_FAILURE_V6_POLICY_SHA256, type GatewayStudyV6Result, type GatewayStudyTerminalReaderFailure } from "./gateway-study-transport-v6";
import { buildJudgePrompt, type loadJudgeProfile } from "./judge";
import { benchmarkOrder } from "./retrieval";

const frozen = gatewayStudyTransportInternals.frozen;
export const GATEWAY_JUDGE_PLAN_V6_PROFILE = "oh.memory-gateway-judge-plan.v6" as const;
export type GatewayReaderFailureV6 = Readonly<Omit<GatewayReaderRow, "status" | "prediction" | "tokenF1" | "response"> & {
  status: "terminal-reader-failure"; reason: "output-token-limit"; policySha256: string; response: GatewayStudyTerminalReaderFailure;
}>;
export type GatewayReaderOutcomeV6 = GatewayReaderRow | GatewayReaderFailureV6;
type CaseIdentity = Readonly<{ ordinal: number; readerJobKey: string; questionId: string; corpusId: string;
  groupId: string; category: string; system: GatewayReaderRow["system"]; readerOutcomeSha256: string }>;
export type GatewayModelJudgeCaseV6 = CaseIdentity & Readonly<{ kind: "model"; jobKey: string; ownerOrdinal: number }>;
export type GatewayPolicyJudgeCaseV6 = CaseIdentity & Readonly<{ kind: "reader-failure"; policySha256: string; reason: "output-token-limit" }>;
export type GatewayJudgeCaseV6 = GatewayModelJudgeCaseV6 | GatewayPolicyJudgeCaseV6;
export type GatewayJudgePlanV6 = Readonly<{ profile: typeof GATEWAY_JUDGE_PLAN_V6_PROFILE; policySha256: string;
  jobs: readonly GatewayJudgeJob[]; cases: readonly GatewayJudgeCaseV6[]; casesSha256: string }>;
export type GatewayScoredCaseV6 =
  | GatewayModelJudgeCaseV6 & Readonly<{ status: "completed"; correct: 0 | 1; requestSha256: string; reusedJudgment: boolean; decisionSource: "model" }>
  | GatewayPolicyJudgeCaseV6 & Readonly<{ status: "terminal-reader-failure"; correct: 0; decisionSource: "reader-failure-policy" }>;
export type GatewayV6JudgePlanInput = Readonly<{ readerJobs: readonly GatewayReaderJob[]; readerRows: readonly GatewayReaderOutcomeV6[];
  questions: readonly Question[]; profile: Awaited<ReturnType<typeof loadJudgeProfile>> }>;

function fail(reason: string): never { throw new TypeError(`Gateway study plan v6: ${reason}.`); }
function same(left: unknown, right: unknown, reason: string): void { if (canonicalSha256(left) !== canonicalSha256(right)) fail(reason); }
function at<T>(rows: readonly T[], index: number): T { return rows[index] ?? fail("missing ordered row"); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function exact(value: unknown, keys: readonly string[]): boolean { return isPlainRecord(value) && hasExactKeys(value, keys); }
function ordinary(response: GatewayStudyV6Result) {
  if (response.kind === "terminal-reader-failure") fail("reader failure outside reader phase");
  return response;
}

export function completeGatewayV6Extraction(job: GatewayExtractionJob, response: GatewayStudyV6Result) {
  return completeGatewayV5Extraction(job, ordinary(response));
}
export function completeGatewayV6Judge(job: GatewayJudgeJob, response: GatewayStudyV6Result) {
  return completeGatewayV5Judge(job, ordinary(response));
}

/** Callers first replay authenticated raw transport. This projection contains no partial answer. */
export function completeGatewayV6Reader(job: GatewayReaderJob, question: Question, response: GatewayStudyV6Result): GatewayReaderOutcomeV6 {
  if (response.kind !== "terminal-reader-failure") return completeGatewayV5Reader(job, question, response);
  const n = job.native;
  same(job.request, makeGatewayStudyRequest({ phase: "reader", messages: job.request.body.messages }), "reader request drift");
  same(n.question, { id: question.id, corpusId: question.corpusId, category: question.category,
    question: question.question, questionDate: question.questionDate }, "reader question binding");
  if (job.phase !== "reader" || job.request.maximumOutput !== 512 || !hasExactKeys(response,
    ["kind", "reason", "finishReason", "policySha256", "requestSha256", "rawSha256", "rawBytes", "usage", "identity"])
    || response.requestSha256 !== job.request.requestSha256 || response.policySha256 !== GATEWAY_READER_FAILURE_V6_POLICY_SHA256
    || response.reason !== "output-token-limit" || response.finishReason !== "length" || response.usage.outputTokens !== 512
    || response.identity.requestedModel !== job.request.model || response.identity.finalProvider !== "openai"
    || !digest(response.rawSha256) || !Number.isSafeInteger(response.rawBytes) || response.rawBytes < 1 || response.rawBytes > 1_048_576) fail("terminal reader evidence binding");
  return frozen({ jobKey: job.key, ordinal: job.ordinal, questionId: question.id, corpusId: question.corpusId,
    groupId: n.groupId, category: question.category, system: n.system, status: "terminal-reader-failure", reason: "output-token-limit",
    policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256, requestSha256: job.request.requestSha256,
    retrievedSha256: n.retrievedSha256, contextSha256: n.contextSha256, response });
}

function judgeJob(ordinal: number, prompt: string, profileSha256: string): GatewayJudgeJob {
  const request = makeGatewayStudyRequest({ phase: "judge", messages: [{ role: "system", content: CLAUDE_JUDGE_SYSTEM }, { role: "user", content: prompt }] });
  const promptSha256 = sha256Hex(prompt);
  return { key: canonicalSha256({ profile: GATEWAY_STUDY_PLAN_V3_PROFILE, phase: "judge", ordinal,
    identity: { profileSha256, promptSha256 }, requestSha256: request.requestSha256 }), ordinal, request, phase: "judge", promptSha256, profileSha256 };
}

/** Policy cases retain their original position but never acquire a judge request or alias owner. */
export function makeGatewayV6JudgePlan(input: GatewayV6JudgePlanInput): GatewayJudgePlanV6 {
  const { readerJobs, readerRows, questions, profile } = input;
  if (questions.length < 1 || questions.length > 1000 || readerJobs.length !== questions.length * 3 || readerRows.length !== readerJobs.length
    || new Set(questions.map(q => q.id)).size !== questions.length || new Set(readerJobs.map(j => j.key)).size !== readerJobs.length
    || !digest(profile.sha256)) fail("complete reader matrix required");
  const jobs: GatewayJudgeJob[] = [], cases: GatewayJudgeCaseV6[] = [], owners = new Map<string, GatewayJudgeJob>();
  for (const [ordinal, job] of readerJobs.entries()) {
    const row = at(readerRows, ordinal), n = job.native, question = at(questions, Math.floor(ordinal / 3));
    const system = at(benchmarkOrder(CLAUDE_STUDY_SYSTEMS, Math.floor(ordinal / 3)), ordinal % 3);
    if (job.ordinal !== ordinal || n.ordinal !== ordinal || n.questionIndex !== Math.floor(ordinal / 3) || n.system !== system
      || row.jobKey !== job.key || row.ordinal !== ordinal || row.requestSha256 !== job.request.requestSha256) fail("reader order or response binding");
    same(row, completeGatewayV6Reader(job, question, row.response), "reader outcome drift");
    const identity: CaseIdentity = { ordinal, readerJobKey: job.key, questionId: question.id, corpusId: question.corpusId,
      groupId: n.groupId, category: question.category, system, readerOutcomeSha256: canonicalSha256(row) };
    if (row.status === "terminal-reader-failure") {
      cases.push({ ...identity, kind: "reader-failure", policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256, reason: "output-token-limit" });
      continue;
    }
    const prepared = judgeJob(ordinal, buildJudgePrompt(question, row.prediction, profile), profile.sha256);
    let owner = owners.get(prepared.request.requestSha256);
    if (owner === undefined) { owner = prepared; owners.set(prepared.request.requestSha256, owner); jobs.push(owner); }
    cases.push({ ...identity, kind: "model", jobKey: owner.key, ownerOrdinal: owner.ordinal });
  }
  return frozen({ profile: GATEWAY_JUDGE_PLAN_V6_PROFILE, policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256,
    jobs, cases, casesSha256: canonicalSha256(cases) });
}

/** Validate positional/physical ownership; the assessment adapter also rebuilds the plan from reader evidence. */
export function expandGatewayV6Judgments(plan: GatewayJudgePlanV6, rows: readonly GatewayJudgeRow[]): readonly GatewayScoredCaseV6[] {
  if (!exact(plan, ["profile", "policySha256", "jobs", "cases", "casesSha256"])
    || plan.profile !== GATEWAY_JUDGE_PLAN_V6_PROFILE || plan.policySha256 !== GATEWAY_READER_FAILURE_V6_POLICY_SHA256
    || !Array.isArray(plan.cases) || plan.cases.length < 3 || plan.cases.length > 3000 || plan.cases.length % 3 !== 0
    || !Array.isArray(plan.jobs) || !Array.isArray(rows) || rows.length !== plan.jobs.length || rows.length > plan.cases.length
    || canonicalSha256(plan.cases) !== plan.casesSha256) fail("complete bound scoring matrix required");
  const owners = new Map<string, number>(), readerKeys = new Set<string>(), questions = new Set<string>(), groups = new Set<string>(), corpora = new Set<string>();
  for (const [ordinal, c] of plan.cases.entries()) {
    const identity = ["ordinal", "readerJobKey", "questionId", "corpusId", "groupId", "category", "system", "readerOutcomeSha256"];
    if (!exact(c, [...identity, ...(c.kind === "model" ? ["kind", "jobKey", "ownerOrdinal"] : ["kind", "policySha256", "reason"])])
      || !digest(c.readerJobKey) || !digest(c.readerOutcomeSha256) || readerKeys.has(c.readerJobKey)
      || [c.questionId, c.corpusId, c.groupId, c.category].some(v => typeof v !== "string" || v.length < 1 || v.length > 512)) fail("case identity");
    readerKeys.add(c.readerJobKey);
    const family = Math.floor(ordinal / 3), first = at(plan.cases, family * 3);
    if (ordinal % 3 === 0) {
      if (questions.has(c.questionId) || groups.has(c.groupId) || corpora.has(c.corpusId)) fail("duplicate family");
      questions.add(c.questionId); groups.add(c.groupId); corpora.add(c.corpusId);
    }
    if (c.ordinal !== ordinal || c.questionId !== first.questionId || c.corpusId !== first.corpusId || c.groupId !== first.groupId
      || c.category !== first.category || c.system !== at(benchmarkOrder(CLAUDE_STUDY_SYSTEMS, family), ordinal % 3)) fail("case family or arm order");
    if (c.kind === "reader-failure") {
      if (c.policySha256 !== GATEWAY_READER_FAILURE_V6_POLICY_SHA256 || c.reason !== "output-token-limit") fail("failure policy binding");
    } else if (c.kind === "model") {
      if (!digest(c.jobKey)) fail("judge key");
      if (!owners.has(c.jobKey)) owners.set(c.jobKey, ordinal);
      if (c.ownerOrdinal !== owners.get(c.jobKey)) fail("judge first-owner binding");
    } else fail("case provenance");
  }
  same(plan.jobs.map(j => ({ key: j.key, ordinal: j.ordinal })), [...owners].map(([key, ordinal]) => ({ key, ordinal })), "physical judge owner order");
  const byKey = new Map<string, GatewayJudgeRow>(), requests = new Set<string>();
  for (const [i, job] of plan.jobs.entries()) {
    const prompt = job.request.body.messages[1]?.content;
    if (!digest(job.profileSha256) || job.request.body.messages[0]?.content !== CLAUDE_JUDGE_SYSTEM || typeof prompt !== "string") fail("judge profile binding");
    same(job, judgeJob(job.ordinal, prompt, job.profileSha256), "judge request drift");
    if (requests.has(job.request.requestSha256)) fail("duplicate physical judge request");
    requests.add(job.request.requestSha256);
    const row = at(rows, i);
    same(row, completeGatewayV6Judge(job, row.response), "judge response binding");
    byKey.set(job.key, row);
  }
  return frozen(plan.cases.map((c): GatewayScoredCaseV6 => {
    if (c.kind === "reader-failure") return { ...c, status: "terminal-reader-failure", correct: 0, decisionSource: "reader-failure-policy" };
    const row = byKey.get(c.jobKey) ?? fail("missing physical judge");
    return { ...c, status: "completed", correct: row.correct, requestSha256: row.requestSha256,
      reusedJudgment: c.ordinal !== c.ownerOrdinal, decisionSource: "model" };
  }));
}
