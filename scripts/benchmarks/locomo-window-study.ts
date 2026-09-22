/** Fixed LoCoMo window comparison. Context selection is already confirmed; this
 * module only plans matched readers and the separately gold-bearing native judge. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { evolutionPin, parseEvolutionCampaign, type EvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { buildLocomoJudgeMessages, EVOLUTION_LOCOMO_J_CATEGORIES, EVOLUTION_LOCOMO_JUDGE_PROFILE_ID,
  type EvolutionLocomoJudgeProfile } from "./evolution-locomo-judge";
import { EVOLUTION_PROFILES, makeEvolutionRequest, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { evolutionAnswerMessages } from "./evolution-reader-contracts";
import type { EvolutionAttemptFailure, EvolutionStore } from "./evolution-store";
import type { Question } from "./datasets";

export const LOCOMO_WINDOW_ARMS = ["vector-window", "anchors-query-4"] as const;
export const LOCOMO_WINDOW_GROUPS = ["conv-26", "conv-30", "conv-41", "conv-42", "conv-43", "conv-44", "conv-47", "conv-48"] as const;
export const LOCOMO_WINDOW_POPULATION_COUNTS = Object.freeze({ "conv-26": 152, "conv-30": 81, "conv-41": 152,
  "conv-42": 199, "conv-43": 178, "conv-44": 123, "conv-47": 150, "conv-48": 191 });
export const LOCOMO_WINDOW_READER = "gpt4o-mini-reader" as const;
export const LOCOMO_WINDOW_LIMITS = Object.freeze({ preferredQuestions: 300, fallbackQuestions: 120,
  population: 1226, repeats: 3, maximumContextBytes: 12000, judgeMessageBytes: 24000,
  campaignMicros: 20_000_000, maximumPhysicalCalls: 3600, sourceBytes: 16 * 1024 * 1024,
  planBytes: 32 * 1024 * 1024, resultBytes: 16 * 1024 * 1024, attempts: 8, seed: 17 });
export type LocomoWindowArm = typeof LOCOMO_WINDOW_ARMS[number];
export type LocomoWindowPopulation = readonly Readonly<{ questionId: string; groupId: string }>[];
export type LocomoWindowQuestion = Readonly<{ id: string; groupId: string; question: string; questionDate: string;
  contexts: readonly Readonly<{ armId: LocomoWindowArm; text: string; contextSha256: string; turnIds: readonly string[] }>[] }>;
export type LocomoWindowSource = Readonly<{ protocol: "oh.locomo-window-source.v1"; datasetSha256: string;
  confirmationRowsSha256: string; selectionPolicySha256: string;
  population: LocomoWindowPopulation; questions: readonly LocomoWindowQuestion[] }>;
export type LocomoWindowJob = Readonly<{ key: string; request: EvolutionRequest; repeat: number }>;
export type LocomoWindowCase = Readonly<{ questionId: string; groupId: string; armId: LocomoWindowArm; repeat: number;
  contextSha256: string; readerJobKey: string }>;
export type LocomoWindowPlan = Readonly<{ protocol: "oh.locomo-window-plan.v1"; sourcePin: EvolutionPin;
  sourceSha256: string; scorerPin: EvolutionPin; campaignPin: EvolutionPin; campaignSha256: string;
  arms: typeof LOCOMO_WINDOW_ARMS; readerProfile: typeof LOCOMO_WINDOW_READER;
  judgeProfile: typeof EVOLUTION_LOCOMO_JUDGE_PROFILE_ID; questionIds: readonly string[]; canaryQuestionIds: readonly string[];
  selection: "preferred-300" | "cost-only-prefix-120"; repeats: 3; cases: readonly LocomoWindowCase[];
  readerJobs: readonly LocomoWindowJob[]; maximumReaderReservationMicros: number; maximumJudgeReservationMicros: number;
  maximumReservationMicros: number; preferredReservationMicros: number; maximumPhysicalCalls: number;
  judgeMessageBytes: 24000; planSha256: string }>;
export type LocomoWindowOutcome = Readonly<{ jobKey: string;
  disposition: EvolutionResponse["status"] | "unresolved" | "unattempted";
  response: EvolutionResponse | null; failure: EvolutionAttemptFailure | null; chargeMicros: number; serviceMs: number | null }>;
export type LocomoWindowJudgeCase = Readonly<{ questionId: string; armId: LocomoWindowArm; repeat: number;
  readerJobKey: string; answerSha256: string | null; judgeJobKey: string | null;
  disposition: "judge-request" | "reader-failure" | "judge-input-bound" }>;
export type LocomoWindowJudgePlan = Readonly<{ protocol: "oh.locomo-window-judge-plan.v1";
  readerPlanSha256: string; scorerSha256: string; readerOutcomesSha256: string;
  judgeCases: readonly LocomoWindowJudgeCase[]; judgeJobs: readonly LocomoWindowJob[]; judgePlanSha256: string }>;
export type LocomoWindowResult = Readonly<{ protocol: "oh.locomo-window-result.v1"; phase: "reader" | "judge"; planSha256: string; scorerSha256: string;
  readerOutcomes: readonly LocomoWindowOutcome[]; judgePlanSha256: string | null;
  judgeCases: readonly LocomoWindowJudgeCase[]; judgeJobs: readonly LocomoWindowJob[]; judgeOutcomes: readonly LocomoWindowOutcome[];
  halt: "none" | "canary-failure" | "reader-failure" | "judge-failure" | "preexisting-unresolved" | "interrupted";
  ledger: ReturnType<EvolutionStore["summary"]>; resultSha256: string }>;

/** Compact native references, never replacement response text. Each response
 * digest covers its complete native object (including both answer fields). */
export function locomoWindowOutcomeReceipt(outcome: LocomoWindowOutcome) {
  const response = outcome.response;
  return { jobKey: outcome.jobKey, disposition: outcome.disposition, chargeMicros: outcome.chargeMicros,
    serviceMs: outcome.serviceMs, failure: outcome.failure, response: response === null ? null : {
      responseSha256: canonicalSha256(response), requestSha256: response.requestSha256, profileSha256: response.profileSha256,
      rawSha256: response.rawSha256, rawBytes: response.rawBytes, status: response.status,
      answerSha256: response.answer === null ? null : sha256Hex(response.answer),
      partialAnswerSha256: response.partialAnswer === null ? null : sha256Hex(response.partialAnswer),
      finishReason: response.finishReason, failureReason: response.failureReason, usage: response.usage, identity: response.identity } };
}
/** Result identity is the compact receipt's digest, with complete response and
 * request hashes as children. This avoids a giant serialized hydrated matrix. */
export function locomoWindowResultReceipt(result: Omit<LocomoWindowResult, "resultSha256"> | LocomoWindowResult) {
  if (result.readerOutcomes.length > 1800 || result.judgeOutcomes.length > 1800
    || result.judgeJobs.length > 1800 || result.judgeCases.length > 1800) throw new TypeError("LoCoMo window receipt: matrix bound.");
  const payload = { protocol: "oh.locomo-window-receipt.v1", resultProtocol: result.protocol, phase: result.phase,
    planSha256: result.planSha256, scorerSha256: result.scorerSha256,
    readerOutcomes: result.readerOutcomes.map(locomoWindowOutcomeReceipt), judgePlanSha256: result.judgePlanSha256,
    judgeCases: result.judgeCases, judgeJobs: result.judgeJobs.map(job => ({ key: job.key, repeat: job.repeat,
      requestSha256: job.request.requestSha256, requestObjectSha256: canonicalSha256(job.request) })),
    judgeOutcomes: result.judgeOutcomes.map(locomoWindowOutcomeReceipt), halt: result.halt, ledger: result.ledger };
  const encoded = canonicalJson(payload);
  if (Buffer.byteLength(encoded) + 84 > LOCOMO_WINDOW_LIMITS.resultBytes) throw new TypeError("LoCoMo window receipt: byte bound.");
  const resultSha256 = sha256Hex(encoded);
  if ("resultSha256" in result && result.resultSha256 !== resultSha256) throw new TypeError("LoCoMo window receipt: result digest changed.");
  return { ...payload, resultSha256 };
}

function fail(reason: string): never { throw new TypeError(`LoCoMo window study: ${reason}.`); }
const same = (left: unknown, right: unknown) => canonicalJson(left) === canonicalJson(right);
function text(value: unknown, maximum: number, empty = false): value is string {
  return typeof value === "string" && (empty || value.length > 0) && Buffer.byteLength(value) <= maximum
    && !value.includes("\0") && !/\p{Surrogate}/u.test(value);
}
function id(value: unknown): value is string { return text(value, 160) && /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(value); }
function hash(value: unknown): value is string { return typeof value === "string" && parseSha256Hex(value) !== null; }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function bounded(value: unknown, maximum: number): void {
  if (Buffer.byteLength(canonicalJson(value)) > maximum) fail("artifact byte limit");
}

/** Fixed metadata-only ordering; both declared sample sizes use the same prefix. */
export function selectLocomoWindowIds(population: LocomoWindowPopulation, count: 120 | 300): readonly string[] {
  if (!Array.isArray(population) || population.length !== LOCOMO_WINDOW_LIMITS.population
    || population.some(row => !isPlainRecord(row) || !hasExactKeys(row, ["questionId", "groupId"])
      || !id(row.questionId) || !(LOCOMO_WINDOW_GROUPS as readonly unknown[]).includes(row.groupId))
    || new Set(population.map(row => row.questionId)).size !== population.length || ![120, 300].includes(count)) fail("native eligible population");
  const rank = (value: string) => sha256Hex(`oh.locomo.window-reader-draw.v1:17:${value}`);
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const compare = (a: string, b: string) => compareText(rank(a), rank(b)) || compareText(a, b);
  const groups = [...LOCOMO_WINDOW_GROUPS].sort(compare);
  const byGroup = new Map(groups.map(group => [group, population.filter(row => row.groupId === group).map(row => row.questionId).sort(compare)]));
  if (groups.some(group => byGroup.get(group)!.length !== LOCOMO_WINDOW_POPULATION_COUNTS[group])) fail("native group population counts");
  const selected: string[] = [];
  for (let index = 0; selected.length < count; index++) for (const group of groups) {
    selected.push(byGroup.get(group)![index]!); if (selected.length === count) break;
  }
  return freeze(selected);
}

/** Exact gold-free source schema: the source adapter authenticates native eligibility
 * and the confirmed retrieval context before producing these reader-only fields. */
export function parseLocomoWindowSource(value: unknown): LocomoWindowSource {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "datasetSha256", "confirmationRowsSha256", "selectionPolicySha256", "population", "questions"])
    || value.protocol !== "oh.locomo-window-source.v1" || !hash(value.datasetSha256) || !hash(value.confirmationRowsSha256)
    || !hash(value.selectionPolicySha256) || !Array.isArray(value.population) || !Array.isArray(value.questions)
    || value.questions.length !== 300) fail("gold-free source shape");
  const population = value.population as LocomoWindowPopulation, selected = selectLocomoWindowIds(population, 300);
  const groups = new Map(population.map(row => [row.questionId, row.groupId]));
  const questions = value.questions.map((row, index): LocomoWindowQuestion => {
    if (!isPlainRecord(row) || !hasExactKeys(row, ["id", "groupId", "question", "questionDate", "contexts"])
      || row.id !== selected[index] || row.groupId !== groups.get(selected[index]!) || !text(row.question, 16384)
      || !text(row.questionDate, 512, true) || !Array.isArray(row.contexts) || row.contexts.length !== 2) fail("question projection or fixed draw");
    const contexts = row.contexts.map((context, armIndex) => {
      if (!isPlainRecord(context) || !hasExactKeys(context, ["armId", "text", "contextSha256", "turnIds"])
        || context.armId !== LOCOMO_WINDOW_ARMS[armIndex] || !text(context.text, 12000, true)
        || context.contextSha256 !== sha256Hex(context.text) || !Array.isArray(context.turnIds) || context.turnIds.length > 512
        || context.turnIds.some(turn => !id(turn)) || new Set(context.turnIds).size !== context.turnIds.length) fail("context identity or bound");
      return { armId: context.armId as LocomoWindowArm, text: context.text,
        contextSha256: context.contextSha256 as string, turnIds: [...context.turnIds] as string[] };
    });
    return { id: row.id as string, groupId: row.groupId as string, question: row.question, questionDate: row.questionDate, contexts };
  });
  const source: LocomoWindowSource = { protocol: value.protocol, datasetSha256: value.datasetSha256,
    confirmationRowsSha256: value.confirmationRowsSha256, selectionPolicySha256: value.selectionPolicySha256,
    population: population.map(row => ({ questionId: row.questionId, groupId: row.groupId })), questions };
  bounded(source, LOCOMO_WINDOW_LIMITS.sourceBytes); return freeze(source);
}

export const locomoWindowJobKey = (request: EvolutionRequest, repeat: number) => `${request.requestSha256}:${repeat}`;
export function locomoWindowJudgeReservation(): number {
  const profile = EVOLUTION_PROFILES[EVOLUTION_LOCOMO_JUDGE_PROFILE_ID];
  return Math.ceil(((LOCOMO_WINDOW_LIMITS.judgeMessageBytes + 2048)
    * Math.max(...profile.prices.map(price => Math.max(price.input, price.cacheWrite)))
    + profile.maxOutputTokens * Math.max(...profile.prices.map(price => price.output))) / 1000);
}
export type LocomoWindowPlanInput = Readonly<{ source: unknown; sourcePin: EvolutionPin; scorerPin: EvolutionPin;
  campaignPin: EvolutionPin; campaign: EvolutionCampaign }>;

/** Pure full-plan admission. The 120 fallback is allowed only when the exact
 * 300-reader reservation plus every possible judge cannot fit the frozen cap. */
export function makeLocomoWindowPlan(input: LocomoWindowPlanInput): LocomoWindowPlan {
  const source = parseLocomoWindowSource(input.source), campaign = parseEvolutionCampaign(input.campaign);
  if (campaign.additionalBudgetMicros > LOCOMO_WINDOW_LIMITS.campaignMicros
    || campaign.maximumCalls > LOCOMO_WINDOW_LIMITS.maximumPhysicalCalls) fail("campaign exceeds fixed study bounds");
  const sourcePin = evolutionPin(input.sourcePin), scorerPin = evolutionPin(input.scorerPin), campaignPin = evolutionPin(input.campaignPin);
  if (new Set([sourcePin.path, scorerPin.path, campaignPin.path]).size !== 3) fail("separate source/scorer/campaign roles required");
  const matrix = (questions: readonly LocomoWindowQuestion[]) => {
    const jobs = new Map<string, LocomoWindowJob>(), cases: LocomoWindowCase[] = [];
    for (const [questionIndex, question] of questions.entries()) {
      const requests = question.contexts.map(context => makeEvolutionRequest(LOCOMO_WINDOW_READER,
        evolutionAnswerMessages({ question: question.question, questionDate: question.questionDate }, context.text, "legacy-v1")));
      for (let repeat = 0; repeat < 3; repeat++) for (const armIndex of (questionIndex + repeat) % 2 === 0 ? [0, 1] : [1, 0]) {
        const context = question.contexts[armIndex]!, request = requests[armIndex]!, key = locomoWindowJobKey(request, repeat);
        if (!jobs.has(key)) jobs.set(key, { key, request, repeat });
        cases.push({ questionId: question.id, groupId: question.groupId, armId: context.armId, repeat,
          contextSha256: context.contextSha256, readerJobKey: key });
      }
    }
    const readerJobs = [...jobs.values()], reader = readerJobs.reduce((sum, job) => sum + job.request.reservationMicros, 0);
    const judge = cases.length * locomoWindowJudgeReservation();
    return { readerJobs, cases, reader, judge, total: reader + judge, calls: readerJobs.length + cases.length };
  };
  const preferred = matrix(source.questions);
  const usePreferred = preferred.total <= campaign.additionalBudgetMicros;
  const questions = usePreferred ? source.questions : source.questions.slice(0, 120), chosen = usePreferred ? preferred : matrix(questions);
  if (chosen.total > campaign.additionalBudgetMicros || chosen.calls > campaign.maximumCalls) fail("neither predeclared sample fits the complete bound");
  const payload = { protocol: "oh.locomo-window-plan.v1" as const, sourcePin, sourceSha256: canonicalSha256(source), scorerPin, campaignPin,
    campaignSha256: canonicalSha256(campaign), arms: LOCOMO_WINDOW_ARMS, readerProfile: LOCOMO_WINDOW_READER,
    judgeProfile: EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, questionIds: questions.map(question => question.id),
    canaryQuestionIds: questions.slice(0, 2).map(question => question.id), selection: usePreferred ? "preferred-300" as const : "cost-only-prefix-120" as const,
    repeats: 3 as const, cases: chosen.cases, readerJobs: chosen.readerJobs, maximumReaderReservationMicros: chosen.reader,
    maximumJudgeReservationMicros: chosen.judge, maximumReservationMicros: chosen.total, preferredReservationMicros: preferred.total,
    maximumPhysicalCalls: chosen.calls, judgeMessageBytes: 24000 as const };
  const plan = { ...payload, planSha256: canonicalSha256(payload) }; bounded(plan, LOCOMO_WINDOW_LIMITS.planBytes); return freeze(plan);
}
export function verifyLocomoWindowPlan(value: unknown, input: LocomoWindowPlanInput): LocomoWindowPlan {
  bounded(value, LOCOMO_WINDOW_LIMITS.planBytes); const expected = makeLocomoWindowPlan(input);
  if (!same(value, expected)) fail("plan does not reconstruct from pinned inputs"); return expected;
}

export type LocomoWindowScorer = Readonly<{ protocol: "oh.locomo-window-scorer.v1"; datasetSha256: string;
  sourceSha256: string; questions: readonly Pick<Question, "id" | "corpusId" | "category" | "question" | "answer" | "unanswerable">[] }>;
/** The only gold-bearing source boundary, used after reader response capture. */
export function parseLocomoWindowScorer(value: unknown, source: LocomoWindowSource): LocomoWindowScorer {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "datasetSha256", "sourceSha256", "questions"])
    || value.protocol !== "oh.locomo-window-scorer.v1" || value.datasetSha256 !== source.datasetSha256
    || value.sourceSha256 !== canonicalSha256(source) || !Array.isArray(value.questions) || value.questions.length !== source.questions.length) fail("scorer source binding");
  const questions = value.questions.map((row, index) => {
    const query = source.questions[index]!;
    if (!isPlainRecord(row) || !hasExactKeys(row, ["id", "corpusId", "category", "question", "answer", "unanswerable"])
      || row.id !== query.id || row.corpusId !== query.groupId || row.question !== query.question || row.unanswerable !== false
      || !(EVOLUTION_LOCOMO_J_CATEGORIES as readonly unknown[]).includes(row.category) || !text(row.answer, 16384, true)) fail("native scorer eligibility or question identity");
    return { id: query.id, corpusId: query.groupId, category: row.category as string, question: query.question,
      answer: row.answer, unanswerable: false };
  });
  return freeze({ protocol: value.protocol, datasetSha256: source.datasetSha256, sourceSha256: value.sourceSha256 as string, questions });
}

/** Outcomes must come from native store reconciliation. No calls occur here.
 * Equal exact judge prompts share one physical attempt at judge repeat zero. */
export function makeLocomoWindowJudgePlan(plan: LocomoWindowPlan, scorer: LocomoWindowScorer,
  readerOutcomes: readonly LocomoWindowOutcome[], rubric: EvolutionLocomoJudgeProfile): LocomoWindowJudgePlan {
  if (readerOutcomes.length !== plan.readerJobs.length || readerOutcomes.some((outcome, index) => outcome.jobKey !== plan.readerJobs[index]!.key
    || outcome.disposition === "unattempted" || outcome.disposition === "unresolved")) fail("judge requires complete authenticated readers");
  const outcomes = new Map(readerOutcomes.map(outcome => [outcome.jobKey, outcome]));
  const questions = new Map(scorer.questions.map(question => [question.id, question]));
  const jobs = new Map<string, LocomoWindowJob>();
  const judgeCases = plan.cases.map((cell): LocomoWindowJudgeCase => {
    const outcome = outcomes.get(cell.readerJobKey)!, response = outcome.response;
    if (response === null || response.status !== outcome.disposition) fail("reader native response custody");
    const common = { questionId: cell.questionId, armId: cell.armId, repeat: cell.repeat, readerJobKey: cell.readerJobKey };
    if (response.status !== "completed" || response.answer === null || response.answer.length === 0) return { ...common, answerSha256: null, judgeJobKey: null, disposition: "reader-failure" };
    const question = questions.get(cell.questionId); if (!question) fail("missing judge question");
    const answerSha256 = sha256Hex(response.answer);
    if (Buffer.byteLength(response.answer) > 262144) return { ...common, answerSha256, judgeJobKey: null, disposition: "judge-input-bound" };
    const messages = buildLocomoJudgeMessages(question, response.answer, rubric);
    if (Buffer.byteLength(JSON.stringify(messages)) > plan.judgeMessageBytes) return { ...common, answerSha256, judgeJobKey: null, disposition: "judge-input-bound" };
    const request = makeEvolutionRequest(EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, messages), key = locomoWindowJobKey(request, 0);
    if (request.reservationMicros > locomoWindowJudgeReservation()) fail("judge escaped complete reservation");
    if (!jobs.has(key)) jobs.set(key, { key, request, repeat: 0 });
    return { ...common, answerSha256, judgeJobKey: key, disposition: "judge-request" };
  });
  const payload = { protocol: "oh.locomo-window-judge-plan.v1" as const, readerPlanSha256: plan.planSha256,
    scorerSha256: plan.scorerPin.sha256, readerOutcomesSha256: canonicalSha256(readerOutcomes.map(locomoWindowOutcomeReceipt)), judgeCases, judgeJobs: [...jobs.values()] };
  return freeze({ ...payload, judgePlanSha256: canonicalSha256(payload) });
}
