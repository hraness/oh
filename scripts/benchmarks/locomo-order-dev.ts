/** Development-only factorial experiment: fixed selection crossed with original
 * versus source-order presentation. This protocol cannot make confirmatory claims. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { evolutionPin, parseEvolutionCampaign, type EvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { buildLocomoJudgeMessages, EVOLUTION_LOCOMO_J_CATEGORIES, EVOLUTION_LOCOMO_JUDGE_PROFILE_ID,
  type EvolutionLocomoJudgeProfile } from "./evolution-locomo-judge";
import { EVOLUTION_PROFILES, makeEvolutionRequest, type EvolutionRequest } from "./evolution-model";
import { evolutionAnswerMessages } from "./evolution-reader-contracts";
import type { EvolutionStore } from "./evolution-store";
import type { Question } from "./datasets";
import { locomoWindowOutcomeReceipt, type LocomoWindowOutcome } from "./locomo-window-study";

export const LOCOMO_ORDER_DEV_ARMS = ["vector-window", "vector-window-source-order", "anchors-query-4", "anchors-query-4-source-order"] as const;
export const LOCOMO_ORDER_DEV_GROUPS = ["conv-49", "conv-50"] as const;
export const LOCOMO_ORDER_DEV_POPULATION_COUNTS = Object.freeze({ "conv-49": 156, "conv-50": 158 });
export const LOCOMO_ORDER_DEV_TASK_BUDGET = Object.freeze({ authorizedMicros: 25_000_000,
  priorCompletedMicros: 2_692_061, newCampaignMaximumMicros: 15_000_000,
  maximumTaskMicros: 17_692_061, unallocatedMicros: 7_307_939 });
export const LOCOMO_ORDER_DEV_READER = "gpt4o-mini-reader" as const;
export const LOCOMO_ORDER_DEV_LIMITS = Object.freeze({ questions: 160,
  population: 314, repeats: 3, maximumContextBytes: 12000, judgeMessageBytes: 24000,
  campaignMicros: 15_000_000, maximumPhysicalCalls: 3840, sourceBytes: 16 * 1024 * 1024,
  planBytes: 64 * 1024 * 1024, resultBytes: 16 * 1024 * 1024, attempts: 8, seed: 17 });
export type LocomoOrderDevArm = typeof LOCOMO_ORDER_DEV_ARMS[number];
export type LocomoOrderDevPopulation = readonly Readonly<{ questionId: string; groupId: string }>[];
export type LocomoOrderDevQuestion = Readonly<{ id: string; groupId: string; question: string; questionDate: string;
  contexts: readonly Readonly<{ armId: LocomoOrderDevArm; text: string; contextSha256: string; turnIds: readonly string[] }>[] }>;
export type LocomoOrderDevSource = Readonly<{ protocol: "oh.locomo-order-dev-source.v1"; datasetSha256: string;
  captureSha256: string; selectionPolicySha256: string;
  population: LocomoOrderDevPopulation; questions: readonly LocomoOrderDevQuestion[] }>;
export type LocomoOrderDevJob = Readonly<{ key: string; request: EvolutionRequest; repeat: number }>;
export type LocomoOrderDevCase = Readonly<{ questionId: string; groupId: string; armId: LocomoOrderDevArm; repeat: number;
  contextSha256: string; readerJobKey: string }>;
export type LocomoOrderDevPlan = Readonly<{ protocol: "oh.locomo-order-dev-plan.v1"; sourcePin: EvolutionPin;
  sourceSha256: string; scorerPin: EvolutionPin; campaignPin: EvolutionPin; campaignSha256: string;
  arms: typeof LOCOMO_ORDER_DEV_ARMS; readerProfile: typeof LOCOMO_ORDER_DEV_READER;
  judgeProfile: typeof EVOLUTION_LOCOMO_JUDGE_PROFILE_ID; questionIds: readonly string[]; canaryQuestionIds: readonly string[];
  selection: "balanced-160"; repeats: 3; cases: readonly LocomoOrderDevCase[];
  readerJobs: readonly LocomoOrderDevJob[]; maximumReaderReservationMicros: number; maximumJudgeReservationMicros: number;
  maximumReservationMicros: number; maximumPhysicalCalls: number;
  judgeMessageBytes: 24000; planSha256: string }>;
export type LocomoOrderDevOutcome = LocomoWindowOutcome;
export type LocomoOrderDevJudgeCase = Readonly<{ questionId: string; armId: LocomoOrderDevArm; repeat: number;
  readerJobKey: string; answerSha256: string | null; judgeJobKey: string | null;
  disposition: "judge-request" | "reader-failure" | "judge-input-bound" }>;
export type LocomoOrderDevJudgePlan = Readonly<{ protocol: "oh.locomo-order-dev-judge-plan.v1";
  readerPlanSha256: string; scorerSha256: string; readerOutcomesSha256: string;
  judgeCases: readonly LocomoOrderDevJudgeCase[]; judgeJobs: readonly LocomoOrderDevJob[]; judgePlanSha256: string }>;
export type LocomoOrderDevResult = Readonly<{ protocol: "oh.locomo-order-dev-result.v1"; phase: "reader" | "judge"; planSha256: string; scorerSha256: string;
  readerOutcomes: readonly LocomoOrderDevOutcome[]; judgePlanSha256: string | null;
  judgeCases: readonly LocomoOrderDevJudgeCase[]; judgeJobs: readonly LocomoOrderDevJob[]; judgeOutcomes: readonly LocomoOrderDevOutcome[];
  halt: "none" | "canary-failure" | "reader-failure" | "judge-failure" | "preexisting-unresolved" | "interrupted";
  ledger: ReturnType<EvolutionStore["summary"]>; resultSha256: string }>;

/** Result identity is the compact receipt's digest, with complete response and
 * request hashes as children. This avoids a giant serialized hydrated matrix. */
export function locomoOrderDevResultReceipt(result: Omit<LocomoOrderDevResult, "resultSha256"> | LocomoOrderDevResult) {
  if (result.readerOutcomes.length > 1920 || result.judgeOutcomes.length > 1920
    || result.judgeJobs.length > 1920 || result.judgeCases.length > 1920) throw new TypeError("LoCoMo order development receipt: matrix bound.");
  const payload = { protocol: "oh.locomo-order-dev-receipt.v1", resultProtocol: result.protocol, phase: result.phase,
    planSha256: result.planSha256, scorerSha256: result.scorerSha256,
    readerOutcomes: result.readerOutcomes.map(locomoWindowOutcomeReceipt), judgePlanSha256: result.judgePlanSha256,
    judgeCases: result.judgeCases, judgeJobs: result.judgeJobs.map(job => ({ key: job.key, repeat: job.repeat,
      requestSha256: job.request.requestSha256, requestObjectSha256: canonicalSha256(job.request) })),
    judgeOutcomes: result.judgeOutcomes.map(locomoWindowOutcomeReceipt), halt: result.halt, ledger: result.ledger };
  const encoded = canonicalJson(payload);
  if (Buffer.byteLength(encoded) + 84 > LOCOMO_ORDER_DEV_LIMITS.resultBytes) throw new TypeError("LoCoMo order development receipt: byte bound.");
  const resultSha256 = sha256Hex(encoded);
  if ("resultSha256" in result && result.resultSha256 !== resultSha256) throw new TypeError("LoCoMo order development receipt: result digest changed.");
  return { ...payload, resultSha256 };
}

function fail(reason: string): never { throw new TypeError(`LoCoMo order development study: ${reason}.`); }
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

/** Fixed 80-per-conversation metadata-only draw from all 314 native eligible IDs. */
export function selectLocomoOrderDevIds(population: LocomoOrderDevPopulation): readonly string[] {
  if (!Array.isArray(population) || population.length !== LOCOMO_ORDER_DEV_LIMITS.population
    || population.some(row => !isPlainRecord(row) || !hasExactKeys(row, ["questionId", "groupId"])
      || !id(row.questionId) || !(LOCOMO_ORDER_DEV_GROUPS as readonly unknown[]).includes(row.groupId))
    || new Set(population.map(row => row.questionId)).size !== population.length) fail("native eligible population");
  const rank = (value: string) => sha256Hex(`oh.locomo.order-dev-draw.v1:17:${value}`);
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const compare = (a: string, b: string) => compareText(rank(a), rank(b)) || compareText(a, b);
  const groups = [...LOCOMO_ORDER_DEV_GROUPS].sort(compare);
  const byGroup = new Map(groups.map(group => [group, population.filter(row => row.groupId === group).map(row => row.questionId).sort(compare)]));
  if (groups.some(group => byGroup.get(group)!.length !== LOCOMO_ORDER_DEV_POPULATION_COUNTS[group])) fail("native group population counts");
  const selected: string[] = [];
  for (let index = 0; selected.length < 160; index++) for (const group of groups) {
    selected.push(byGroup.get(group)![index]!); if (selected.length === 160) break;
  }
  return freeze(selected);
}

/** Exact gold-free source schema. The development adapter separately authenticates
 * original turn renderings and eligibility before emitting these reader-only fields. */
export function parseLocomoOrderDevSource(value: unknown): LocomoOrderDevSource {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "datasetSha256", "captureSha256", "selectionPolicySha256", "population", "questions"])
    || value.protocol !== "oh.locomo-order-dev-source.v1" || !hash(value.datasetSha256) || !hash(value.captureSha256)
    || !hash(value.selectionPolicySha256) || !Array.isArray(value.population) || !Array.isArray(value.questions)
    || value.questions.length !== 160) fail("gold-free source shape");
  const population = value.population as LocomoOrderDevPopulation, selected = selectLocomoOrderDevIds(population);
  const groups = new Map(population.map(row => [row.questionId, row.groupId]));
  const questions = value.questions.map((row, index): LocomoOrderDevQuestion => {
    if (!isPlainRecord(row) || !hasExactKeys(row, ["id", "groupId", "question", "questionDate", "contexts"])
      || row.id !== selected[index] || row.groupId !== groups.get(selected[index]!) || !text(row.question, 16384)
      || !text(row.questionDate, 512, true) || !Array.isArray(row.contexts) || row.contexts.length !== 4) fail("question projection or fixed draw");
    const contexts = row.contexts.map((context, armIndex) => {
      if (!isPlainRecord(context) || !hasExactKeys(context, ["armId", "text", "contextSha256", "turnIds"])
        || context.armId !== LOCOMO_ORDER_DEV_ARMS[armIndex] || !text(context.text, 12000, true)
        || context.contextSha256 !== sha256Hex(context.text) || !Array.isArray(context.turnIds) || context.turnIds.length > 512
        || context.turnIds.some(turn => !id(turn)) || new Set(context.turnIds).size !== context.turnIds.length) fail("context identity or bound");
      return { armId: context.armId as LocomoOrderDevArm, text: context.text,
        contextSha256: context.contextSha256 as string, turnIds: [...context.turnIds] as string[] };
    });
    for (const index of [0, 2]) {
      const original = contexts[index]!, ordered = contexts[index + 1]!;
      if (Buffer.byteLength(original.text) !== Buffer.byteLength(ordered.text)
        || !same([...original.turnIds].sort(), [...ordered.turnIds].sort())) fail("presentation pair membership or byte volume changed");
    }
    return { id: row.id as string, groupId: row.groupId as string, question: row.question, questionDate: row.questionDate, contexts };
  });
  const source: LocomoOrderDevSource = { protocol: value.protocol, datasetSha256: value.datasetSha256,
    captureSha256: value.captureSha256, selectionPolicySha256: value.selectionPolicySha256,
    population: population.map(row => ({ questionId: row.questionId, groupId: row.groupId })), questions };
  bounded(source, LOCOMO_ORDER_DEV_LIMITS.sourceBytes); return freeze(source);
}

export const locomoOrderDevJobKey = (request: EvolutionRequest, repeat: number) => `${request.requestSha256}:${repeat}`;
export function locomoOrderDevJudgeReservation(): number {
  const profile = EVOLUTION_PROFILES[EVOLUTION_LOCOMO_JUDGE_PROFILE_ID];
  return Math.ceil(((LOCOMO_ORDER_DEV_LIMITS.judgeMessageBytes + 2048)
    * Math.max(...profile.prices.map(price => Math.max(price.input, price.cacheWrite)))
    + profile.maxOutputTokens * Math.max(...profile.prices.map(price => price.output))) / 1000);
}
export type LocomoOrderDevPlanInput = Readonly<{ source: unknown; sourcePin: EvolutionPin; scorerPin: EvolutionPin;
  campaignPin: EvolutionPin; campaign: EvolutionCampaign }>;

/** Admit the entire fixed factorial matrix plus every worst-case judge. No fallback. */
export function makeLocomoOrderDevPlan(input: LocomoOrderDevPlanInput): LocomoOrderDevPlan {
  const source = parseLocomoOrderDevSource(input.source), campaign = parseEvolutionCampaign(input.campaign);
  if (campaign.additionalBudgetMicros !== LOCOMO_ORDER_DEV_LIMITS.campaignMicros
    || campaign.maximumCalls !== LOCOMO_ORDER_DEV_LIMITS.maximumPhysicalCalls) fail("campaign exceeds fixed study bounds");
  const sourcePin = evolutionPin(input.sourcePin), scorerPin = evolutionPin(input.scorerPin), campaignPin = evolutionPin(input.campaignPin);
  if (new Set([sourcePin.path, scorerPin.path, campaignPin.path]).size !== 3) fail("separate source/scorer/campaign roles required");
  const matrix = (questions: readonly LocomoOrderDevQuestion[]) => {
    const jobs = new Map<string, LocomoOrderDevJob>(), cases: LocomoOrderDevCase[] = [];
    const nextOrdinal = new Map<string, number>();
    for (const question of questions) {
      const questionIndex = nextOrdinal.get(question.groupId) ?? 0;
      nextOrdinal.set(question.groupId, questionIndex + 1);
      const requests = question.contexts.map(context => makeEvolutionRequest(LOCOMO_ORDER_DEV_READER,
        evolutionAnswerMessages({ question: question.question, questionDate: question.questionDate }, context.text, "legacy-v1")));
      for (let repeat = 0; repeat < 3; repeat++) for (const armIndex of [0, 1, 2, 3].map(offset => (offset + questionIndex + repeat) % 4)) {
        const context = question.contexts[armIndex]!, request = requests[armIndex]!, key = locomoOrderDevJobKey(request, repeat);
        if (!jobs.has(key)) jobs.set(key, { key, request, repeat });
        cases.push({ questionId: question.id, groupId: question.groupId, armId: context.armId, repeat,
          contextSha256: context.contextSha256, readerJobKey: key });
      }
    }
    const readerJobs = [...jobs.values()], reader = readerJobs.reduce((sum, job) => sum + job.request.reservationMicros, 0);
    const judge = cases.length * locomoOrderDevJudgeReservation();
    return { readerJobs, cases, reader, judge, total: reader + judge, calls: readerJobs.length + cases.length };
  };
  const questions = source.questions, chosen = matrix(questions);
  if (chosen.total > campaign.additionalBudgetMicros || chosen.calls > campaign.maximumCalls) fail("full predeclared matrix exceeds complete bound");
  const payload = { protocol: "oh.locomo-order-dev-plan.v1" as const, sourcePin, sourceSha256: canonicalSha256(source), scorerPin, campaignPin,
    campaignSha256: canonicalSha256(campaign), arms: LOCOMO_ORDER_DEV_ARMS, readerProfile: LOCOMO_ORDER_DEV_READER,
    judgeProfile: EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, questionIds: questions.map(question => question.id),
    canaryQuestionIds: questions.slice(0, 2).map(question => question.id), selection: "balanced-160" as const,
    repeats: 3 as const, cases: chosen.cases, readerJobs: chosen.readerJobs, maximumReaderReservationMicros: chosen.reader,
    maximumJudgeReservationMicros: chosen.judge, maximumReservationMicros: chosen.total,
    maximumPhysicalCalls: chosen.calls, judgeMessageBytes: 24000 as const };
  const plan = { ...payload, planSha256: canonicalSha256(payload) }; bounded(plan, LOCOMO_ORDER_DEV_LIMITS.planBytes); return freeze(plan);
}
export function verifyLocomoOrderDevPlan(value: unknown, input: LocomoOrderDevPlanInput): LocomoOrderDevPlan {
  bounded(value, LOCOMO_ORDER_DEV_LIMITS.planBytes); const expected = makeLocomoOrderDevPlan(input);
  if (!same(value, expected)) fail("plan does not reconstruct from pinned inputs"); return expected;
}

export type LocomoOrderDevScorer = Readonly<{ protocol: "oh.locomo-order-dev-scorer.v1"; datasetSha256: string;
  sourceSha256: string; questions: readonly Pick<Question, "id" | "corpusId" | "category" | "question" | "answer" | "unanswerable">[] }>;
/** The only gold-bearing source boundary, used after reader response capture. */
export function parseLocomoOrderDevScorer(value: unknown, source: LocomoOrderDevSource): LocomoOrderDevScorer {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "datasetSha256", "sourceSha256", "questions"])
    || value.protocol !== "oh.locomo-order-dev-scorer.v1" || value.datasetSha256 !== source.datasetSha256
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
export function makeLocomoOrderDevJudgePlan(plan: LocomoOrderDevPlan, scorer: LocomoOrderDevScorer,
  readerOutcomes: readonly LocomoOrderDevOutcome[], rubric: EvolutionLocomoJudgeProfile): LocomoOrderDevJudgePlan {
  if (readerOutcomes.length !== plan.readerJobs.length || readerOutcomes.some((outcome, index) => outcome.jobKey !== plan.readerJobs[index]!.key
    || outcome.disposition === "unattempted" || outcome.disposition === "unresolved")) fail("judge requires complete authenticated readers");
  const outcomes = new Map(readerOutcomes.map(outcome => [outcome.jobKey, outcome]));
  const questions = new Map(scorer.questions.map(question => [question.id, question]));
  const jobs = new Map<string, LocomoOrderDevJob>();
  const judgeCases = plan.cases.map((cell): LocomoOrderDevJudgeCase => {
    const outcome = outcomes.get(cell.readerJobKey)!, response = outcome.response;
    if (response === null || response.status !== outcome.disposition) fail("reader native response custody");
    const common = { questionId: cell.questionId, armId: cell.armId, repeat: cell.repeat, readerJobKey: cell.readerJobKey };
    if (response.status !== "completed" || response.answer === null || response.answer.length === 0) return { ...common, answerSha256: null, judgeJobKey: null, disposition: "reader-failure" };
    const question = questions.get(cell.questionId); if (!question) fail("missing judge question");
    const answerSha256 = sha256Hex(response.answer);
    if (Buffer.byteLength(response.answer) > 262144) return { ...common, answerSha256, judgeJobKey: null, disposition: "judge-input-bound" };
    const messages = buildLocomoJudgeMessages(question, response.answer, rubric);
    if (Buffer.byteLength(JSON.stringify(messages)) > plan.judgeMessageBytes) return { ...common, answerSha256, judgeJobKey: null, disposition: "judge-input-bound" };
    const request = makeEvolutionRequest(EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, messages), key = locomoOrderDevJobKey(request, 0);
    if (request.reservationMicros > locomoOrderDevJudgeReservation()) fail("judge escaped complete reservation");
    if (!jobs.has(key)) jobs.set(key, { key, request, repeat: 0 });
    return { ...common, answerSha256, judgeJobKey: key, disposition: "judge-request" };
  });
  const payload = { protocol: "oh.locomo-order-dev-judge-plan.v1" as const, readerPlanSha256: plan.planSha256,
    scorerSha256: plan.scorerPin.sha256, readerOutcomesSha256: canonicalSha256(readerOutcomes.map(locomoWindowOutcomeReceipt)), judgeCases, judgeJobs: [...jobs.values()] };
  return freeze({ ...payload, judgePlanSha256: canonicalSha256(payload) });
}
