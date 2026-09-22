/** Development-only matched reader screen: fixed vector-window context and
 * legacy versus existing composition instruction. This protocol cannot make confirmatory claims. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { evolutionPin, parseEvolutionCampaign, type EvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { buildLocomoJudgeMessages, EVOLUTION_LOCOMO_J_CATEGORIES, EVOLUTION_LOCOMO_JUDGE_PROFILE_ID,
  type EvolutionLocomoJudgeProfile } from "./evolution-locomo-judge";
import { EVOLUTION_PROFILES, evolutionReaderProfileId, makeEvolutionRequest, type EvolutionRequest } from "./evolution-model";
import { EVOLUTION_READER_CONTRACTS, evolutionAnswerMessages } from "./evolution-reader-contracts";
import type { EvolutionStore } from "./evolution-store";
import type { Question } from "./datasets";
import { locomoWindowOutcomeReceipt, type LocomoWindowOutcome } from "./locomo-window-study";
import { selectLocomoOrderDevIds as selectLocomoCompositionDevIds } from "./locomo-order-dev";
export { selectLocomoCompositionDevIds };

export const LOCOMO_COMPOSITION_DEV_ARMS = ["vector-window", "vector-window-composition"] as const;
export const LOCOMO_COMPOSITION_DEV_GROUPS = ["conv-49", "conv-50"] as const;
export const LOCOMO_COMPOSITION_DEV_POPULATION_COUNTS = Object.freeze({ "conv-49": 156, "conv-50": 158 });
export const LOCOMO_COMPOSITION_DEV_TASK_BUDGET = Object.freeze({ authorizedMicros: 25_000_000,
  priorCompletedMicros: 3_759_317, newCampaignMaximumMicros: 8_000_000,
  maximumTaskMicros: 11_759_317, unallocatedMicros: 13_240_683 });
export const LOCOMO_COMPOSITION_DEV_READER = "gpt4o-mini-reader" as const;
const candidateReader = evolutionReaderProfileId(LOCOMO_COMPOSITION_DEV_READER, "composition-v1");
if (candidateReader !== "gpt4o-mini-composition-v1-reader") throw new TypeError("Composition reader profile identity changed.");
/** Both existing profile identities and exact immutable instructions are plan inputs. */
export const LOCOMO_COMPOSITION_DEV_READER_PROFILES = Object.freeze([
  Object.freeze({ armId: LOCOMO_COMPOSITION_DEV_ARMS[0], profileId: LOCOMO_COMPOSITION_DEV_READER, contractId: "legacy-v1" as const,
    profileSha256: canonicalSha256(EVOLUTION_PROFILES[LOCOMO_COMPOSITION_DEV_READER]),
    instructionSha256: EVOLUTION_READER_CONTRACTS["legacy-v1"].instructionSha256 }),
  Object.freeze({ armId: LOCOMO_COMPOSITION_DEV_ARMS[1], profileId: candidateReader, contractId: "composition-v1" as const,
    profileSha256: canonicalSha256(EVOLUTION_PROFILES[candidateReader]),
    instructionSha256: EVOLUTION_READER_CONTRACTS["composition-v1"].instructionSha256 }),
] as const);

export const LOCOMO_COMPOSITION_DEV_LIMITS = Object.freeze({ questions: 160,
  population: 314, repeats: 3, maximumContextBytes: 12000, judgeMessageBytes: 24000,
  campaignMicros: 8_000_000, maximumPhysicalCalls: 1920, sourceBytes: 16 * 1024 * 1024,
  planBytes: 64 * 1024 * 1024, resultBytes: 16 * 1024 * 1024, attempts: 8, seed: 17 });
export type LocomoCompositionDevArm = typeof LOCOMO_COMPOSITION_DEV_ARMS[number];
export type LocomoCompositionDevPopulation = readonly Readonly<{ questionId: string; groupId: string }>[];
export type LocomoCompositionDevQuestion = Readonly<{ id: string; groupId: string; question: string; questionDate: string;
  contexts: readonly Readonly<{ armId: LocomoCompositionDevArm; text: string; contextSha256: string; turnIds: readonly string[] }>[] }>;
export type LocomoCompositionDevSource = Readonly<{ protocol: "oh.locomo-composition-dev-source.v1"; datasetSha256: string;
  captureSha256: string; selectionPolicySha256: string;
  population: LocomoCompositionDevPopulation; questions: readonly LocomoCompositionDevQuestion[] }>;
export type LocomoCompositionDevJob = Readonly<{ key: string; request: EvolutionRequest; repeat: number }>;
export type LocomoCompositionDevCase = Readonly<{ questionId: string; groupId: string; armId: LocomoCompositionDevArm; repeat: number;
  contextSha256: string; readerJobKey: string }>;
export type LocomoCompositionDevPlan = Readonly<{ protocol: "oh.locomo-composition-dev-plan.v1"; sourcePin: EvolutionPin;
  sourceSha256: string; scorerPin: EvolutionPin; campaignPin: EvolutionPin; campaignSha256: string;
  arms: typeof LOCOMO_COMPOSITION_DEV_ARMS; readerProfiles: typeof LOCOMO_COMPOSITION_DEV_READER_PROFILES;
  judgeProfile: typeof EVOLUTION_LOCOMO_JUDGE_PROFILE_ID; questionIds: readonly string[]; canaryQuestionIds: readonly string[];
  selection: "balanced-160"; repeats: 3; cases: readonly LocomoCompositionDevCase[];
  readerJobs: readonly LocomoCompositionDevJob[]; maximumReaderReservationMicros: number; maximumJudgeReservationMicros: number;
  maximumReservationMicros: number; maximumPhysicalCalls: number;
  judgeMessageBytes: 24000; planSha256: string }>;
export type LocomoCompositionDevOutcome = LocomoWindowOutcome;
export type LocomoCompositionDevJudgeCase = Readonly<{ questionId: string; armId: LocomoCompositionDevArm; repeat: number;
  readerJobKey: string; answerSha256: string | null; judgeJobKey: string | null;
  disposition: "judge-request" | "reader-failure" | "judge-input-bound" }>;
export type LocomoCompositionDevJudgePlan = Readonly<{ protocol: "oh.locomo-composition-dev-judge-plan.v1";
  readerPlanSha256: string; scorerSha256: string; readerOutcomesSha256: string;
  judgeCases: readonly LocomoCompositionDevJudgeCase[]; judgeJobs: readonly LocomoCompositionDevJob[]; judgePlanSha256: string }>;
export type LocomoCompositionDevResult = Readonly<{ protocol: "oh.locomo-composition-dev-result.v1"; phase: "reader" | "judge"; planSha256: string; scorerSha256: string;
  readerOutcomes: readonly LocomoCompositionDevOutcome[]; judgePlanSha256: string | null;
  judgeCases: readonly LocomoCompositionDevJudgeCase[]; judgeJobs: readonly LocomoCompositionDevJob[]; judgeOutcomes: readonly LocomoCompositionDevOutcome[];
  halt: "none" | "canary-failure" | "reader-failure" | "judge-failure" | "preexisting-unresolved" | "interrupted";
  ledger: ReturnType<EvolutionStore["summary"]>; resultSha256: string }>;

/** Result identity is the compact receipt's digest, with complete response and
 * request hashes as children. This avoids a giant serialized hydrated matrix. */
export function locomoCompositionDevResultReceipt(result: Omit<LocomoCompositionDevResult, "resultSha256"> | LocomoCompositionDevResult) {
  if (result.readerOutcomes.length > 960 || result.judgeOutcomes.length > 960
    || result.judgeJobs.length > 960 || result.judgeCases.length > 960) throw new TypeError("LoCoMo composition development receipt: matrix bound.");
  const payload = { protocol: "oh.locomo-composition-dev-receipt.v1", resultProtocol: result.protocol, phase: result.phase,
    planSha256: result.planSha256, scorerSha256: result.scorerSha256,
    readerOutcomes: result.readerOutcomes.map(locomoWindowOutcomeReceipt), judgePlanSha256: result.judgePlanSha256,
    judgeCases: result.judgeCases, judgeJobs: result.judgeJobs.map(job => ({ key: job.key, repeat: job.repeat,
      requestSha256: job.request.requestSha256, requestObjectSha256: canonicalSha256(job.request) })),
    judgeOutcomes: result.judgeOutcomes.map(locomoWindowOutcomeReceipt), halt: result.halt, ledger: result.ledger };
  const encoded = canonicalJson(payload);
  if (Buffer.byteLength(encoded) + 84 > LOCOMO_COMPOSITION_DEV_LIMITS.resultBytes) throw new TypeError("LoCoMo composition development receipt: byte bound.");
  const resultSha256 = sha256Hex(encoded);
  if ("resultSha256" in result && result.resultSha256 !== resultSha256) throw new TypeError("LoCoMo composition development receipt: result digest changed.");
  return { ...payload, resultSha256 };
}

function fail(reason: string): never { throw new TypeError(`LoCoMo composition development study: ${reason}.`); }
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

/** Exact gold-free source schema. The development adapter separately authenticates
 * original turn renderings and eligibility before emitting these reader-only fields. */
export function parseLocomoCompositionDevSource(value: unknown): LocomoCompositionDevSource {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "datasetSha256", "captureSha256", "selectionPolicySha256", "population", "questions"])
    || value.protocol !== "oh.locomo-composition-dev-source.v1" || !hash(value.datasetSha256) || !hash(value.captureSha256)
    || !hash(value.selectionPolicySha256) || !Array.isArray(value.population) || !Array.isArray(value.questions)
    || value.questions.length !== 160) fail("gold-free source shape");
  const population = value.population as LocomoCompositionDevPopulation, selected = selectLocomoCompositionDevIds(population);
  const groups = new Map(population.map(row => [row.questionId, row.groupId]));
  const questions = value.questions.map((row, index): LocomoCompositionDevQuestion => {
    if (!isPlainRecord(row) || !hasExactKeys(row, ["id", "groupId", "question", "questionDate", "contexts"])
      || row.id !== selected[index] || row.groupId !== groups.get(selected[index]!) || !text(row.question, 16384)
      || !text(row.questionDate, 512, true) || !Array.isArray(row.contexts) || row.contexts.length !== 2) fail("question projection or fixed draw");
    const contexts = row.contexts.map((context, armIndex) => {
      if (!isPlainRecord(context) || !hasExactKeys(context, ["armId", "text", "contextSha256", "turnIds"])
        || context.armId !== LOCOMO_COMPOSITION_DEV_ARMS[armIndex] || !text(context.text, 12000, true)
        || context.contextSha256 !== sha256Hex(context.text) || !Array.isArray(context.turnIds) || context.turnIds.length > 512
        || context.turnIds.some(turn => !id(turn)) || new Set(context.turnIds).size !== context.turnIds.length) fail("context identity or bound");
      return { armId: context.armId as LocomoCompositionDevArm, text: context.text,
        contextSha256: context.contextSha256 as string, turnIds: [...context.turnIds] as string[] };
    });
    const baseline = contexts[0]!, candidate = contexts[1]!;
    if (baseline.text !== candidate.text || baseline.contextSha256 !== candidate.contextSha256
      || !same(baseline.turnIds, candidate.turnIds)) fail("both arms require byte-identical context and identical ordered turn IDs");
    return { id: row.id as string, groupId: row.groupId as string, question: row.question, questionDate: row.questionDate, contexts };
  });
  const source: LocomoCompositionDevSource = { protocol: value.protocol, datasetSha256: value.datasetSha256,
    captureSha256: value.captureSha256, selectionPolicySha256: value.selectionPolicySha256,
    population: population.map(row => ({ questionId: row.questionId, groupId: row.groupId })), questions };
  bounded(source, LOCOMO_COMPOSITION_DEV_LIMITS.sourceBytes); return freeze(source);
}

export const locomoCompositionDevJobKey = (request: EvolutionRequest, repeat: number) => `${request.requestSha256}:${repeat}`;
export function locomoCompositionDevJudgeReservation(): number {
  const profile = EVOLUTION_PROFILES[EVOLUTION_LOCOMO_JUDGE_PROFILE_ID];
  return Math.ceil(((LOCOMO_COMPOSITION_DEV_LIMITS.judgeMessageBytes + 2048)
    * Math.max(...profile.prices.map(price => Math.max(price.input, price.cacheWrite)))
    + profile.maxOutputTokens * Math.max(...profile.prices.map(price => price.output))) / 1000);
}
export type LocomoCompositionDevPlanInput = Readonly<{ source: unknown; sourcePin: EvolutionPin; scorerPin: EvolutionPin;
  campaignPin: EvolutionPin; campaign: EvolutionCampaign }>;

/** Admit the entire fixed two-arm matrix plus every worst-case judge. No fallback. */
export function makeLocomoCompositionDevPlan(input: LocomoCompositionDevPlanInput): LocomoCompositionDevPlan {
  const source = parseLocomoCompositionDevSource(input.source), campaign = parseEvolutionCampaign(input.campaign);
  const { id: _baselineId, readerContract: _baselineContract, ...baseline } = EVOLUTION_PROFILES[LOCOMO_COMPOSITION_DEV_READER];
  const { id: _candidateId, readerContract: _candidateContract, ...candidate } = EVOLUTION_PROFILES[candidateReader];
  if (!same(baseline, candidate) || _candidateContract?.baseReader !== LOCOMO_COMPOSITION_DEV_READER
    || _candidateContract.id !== "composition-v1"
    || _candidateContract.instructionSha256 !== EVOLUTION_READER_CONTRACTS["composition-v1"].instructionSha256) fail("reader difference must be the existing composition contract only");
  if (campaign.additionalBudgetMicros !== LOCOMO_COMPOSITION_DEV_LIMITS.campaignMicros
    || campaign.maximumCalls !== LOCOMO_COMPOSITION_DEV_LIMITS.maximumPhysicalCalls) fail("campaign exceeds fixed study bounds");
  const sourcePin = evolutionPin(input.sourcePin), scorerPin = evolutionPin(input.scorerPin), campaignPin = evolutionPin(input.campaignPin);
  if (new Set([sourcePin.path, scorerPin.path, campaignPin.path]).size !== 3) fail("separate source/scorer/campaign roles required");
  const matrix = (questions: readonly LocomoCompositionDevQuestion[]) => {
    const jobs = new Map<string, LocomoCompositionDevJob>(), cases: LocomoCompositionDevCase[] = [];
    const nextOrdinal = new Map<string, number>();
    for (const question of questions) {
      const questionIndex = nextOrdinal.get(question.groupId) ?? 0;
      nextOrdinal.set(question.groupId, questionIndex + 1);
      const requests = question.contexts.map((context, index) => {
        const reader = LOCOMO_COMPOSITION_DEV_READER_PROFILES[index]!;
        return makeEvolutionRequest(reader.profileId,
          evolutionAnswerMessages({ question: question.question, questionDate: question.questionDate }, context.text, reader.contractId));
      });
      for (let repeat = 0; repeat < 3; repeat++) for (const armIndex of [0, 1].map(offset => (offset + questionIndex + repeat) % 2)) {
        const context = question.contexts[armIndex]!, request = requests[armIndex]!, key = locomoCompositionDevJobKey(request, repeat);
        if (!jobs.has(key)) jobs.set(key, { key, request, repeat });
        cases.push({ questionId: question.id, groupId: question.groupId, armId: context.armId, repeat,
          contextSha256: context.contextSha256, readerJobKey: key });
      }
    }
    const readerJobs = [...jobs.values()], reader = readerJobs.reduce((sum, job) => sum + job.request.reservationMicros, 0);
    const judge = cases.length * locomoCompositionDevJudgeReservation();
    return { readerJobs, cases, reader, judge, total: reader + judge, calls: readerJobs.length + cases.length };
  };
  const questions = source.questions, chosen = matrix(questions);
  if (chosen.total > campaign.additionalBudgetMicros || chosen.calls > campaign.maximumCalls) fail("full predeclared matrix exceeds complete bound");
  const payload = { protocol: "oh.locomo-composition-dev-plan.v1" as const, sourcePin, sourceSha256: canonicalSha256(source), scorerPin, campaignPin,
    campaignSha256: canonicalSha256(campaign), arms: LOCOMO_COMPOSITION_DEV_ARMS, readerProfiles: LOCOMO_COMPOSITION_DEV_READER_PROFILES,
    judgeProfile: EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, questionIds: questions.map(question => question.id),
    canaryQuestionIds: questions.slice(0, 2).map(question => question.id), selection: "balanced-160" as const,
    repeats: 3 as const, cases: chosen.cases, readerJobs: chosen.readerJobs, maximumReaderReservationMicros: chosen.reader,
    maximumJudgeReservationMicros: chosen.judge, maximumReservationMicros: chosen.total,
    maximumPhysicalCalls: chosen.calls, judgeMessageBytes: 24000 as const };
  const plan = { ...payload, planSha256: canonicalSha256(payload) }; bounded(plan, LOCOMO_COMPOSITION_DEV_LIMITS.planBytes); return freeze(plan);
}
export function verifyLocomoCompositionDevPlan(value: unknown, input: LocomoCompositionDevPlanInput): LocomoCompositionDevPlan {
  bounded(value, LOCOMO_COMPOSITION_DEV_LIMITS.planBytes); const expected = makeLocomoCompositionDevPlan(input);
  if (!same(value, expected)) fail("plan does not reconstruct from pinned inputs"); return expected;
}

export type LocomoCompositionDevScorer = Readonly<{ protocol: "oh.locomo-composition-dev-scorer.v1"; datasetSha256: string;
  sourceSha256: string; questions: readonly Pick<Question, "id" | "corpusId" | "category" | "question" | "answer" | "unanswerable">[] }>;
/** The only gold-bearing source boundary, used after reader response capture. */
export function parseLocomoCompositionDevScorer(value: unknown, source: LocomoCompositionDevSource): LocomoCompositionDevScorer {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "datasetSha256", "sourceSha256", "questions"])
    || value.protocol !== "oh.locomo-composition-dev-scorer.v1" || value.datasetSha256 !== source.datasetSha256
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
export function makeLocomoCompositionDevJudgePlan(plan: LocomoCompositionDevPlan, scorer: LocomoCompositionDevScorer,
  readerOutcomes: readonly LocomoCompositionDevOutcome[], rubric: EvolutionLocomoJudgeProfile): LocomoCompositionDevJudgePlan {
  if (readerOutcomes.length !== plan.readerJobs.length || readerOutcomes.some((outcome, index) => outcome.jobKey !== plan.readerJobs[index]!.key
    || outcome.disposition === "unattempted" || outcome.disposition === "unresolved")) fail("judge requires complete authenticated readers");
  if (readerOutcomes.some((outcome, index) => outcome.response === null
    || outcome.response.requestSha256 !== plan.readerJobs[index]!.request.requestSha256
    || outcome.response.profileSha256 !== plan.readerJobs[index]!.request.profileSha256)) fail("reader response request or profile binding");
  const outcomes = new Map(readerOutcomes.map(outcome => [outcome.jobKey, outcome]));
  const questions = new Map(scorer.questions.map(question => [question.id, question]));
  const jobs = new Map<string, LocomoCompositionDevJob>();
  const judgeCases = plan.cases.map((cell): LocomoCompositionDevJudgeCase => {
    const outcome = outcomes.get(cell.readerJobKey)!, response = outcome.response;
    if (response === null || response.status !== outcome.disposition) fail("reader native response custody");
    const common = { questionId: cell.questionId, armId: cell.armId, repeat: cell.repeat, readerJobKey: cell.readerJobKey };
    if (response.status !== "completed" || response.answer === null || response.answer.length === 0) return { ...common, answerSha256: null, judgeJobKey: null, disposition: "reader-failure" };
    const question = questions.get(cell.questionId); if (!question) fail("missing judge question");
    const answerSha256 = sha256Hex(response.answer);
    if (Buffer.byteLength(response.answer) > 262144) return { ...common, answerSha256, judgeJobKey: null, disposition: "judge-input-bound" };
    const messages = buildLocomoJudgeMessages(question, response.answer, rubric);
    if (Buffer.byteLength(JSON.stringify(messages)) > plan.judgeMessageBytes) return { ...common, answerSha256, judgeJobKey: null, disposition: "judge-input-bound" };
    const request = makeEvolutionRequest(EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, messages), key = locomoCompositionDevJobKey(request, 0);
    if (request.reservationMicros > locomoCompositionDevJudgeReservation()) fail("judge escaped complete reservation");
    if (!jobs.has(key)) jobs.set(key, { key, request, repeat: 0 });
    return { ...common, answerSha256, judgeJobKey: key, disposition: "judge-request" };
  });
  const payload = { protocol: "oh.locomo-composition-dev-judge-plan.v1" as const, readerPlanSha256: plan.planSha256,
    scorerSha256: plan.scorerPin.sha256, readerOutcomesSha256: canonicalSha256(readerOutcomes.map(locomoWindowOutcomeReceipt)), judgeCases, judgeJobs: [...jobs.values()] };
  return freeze({ ...payload, judgePlanSha256: canonicalSha256(payload) });
}

/** A fixed development screen only. Category membership comes from the separate
 * scorer after capture; it is never a reader or selection input. */
export function decideLocomoCompositionDev(input: Readonly<{ overallDelta: number;
  groupDeltas: readonly Readonly<{ groupId: string; delta: number }>[];
  temporalDelta: number; temporalQuestions: number;
  matrixComplete: boolean; readerFailureCases: number; judgeOnlyFailureCases: number }>) {
  if (!Number.isFinite(input.overallDelta) || Math.abs(input.overallDelta) > 1 || input.groupDeltas.length !== 2
    || input.groupDeltas.some((row, index) => row.groupId !== LOCOMO_COMPOSITION_DEV_GROUPS[index]
      || !Number.isFinite(row.delta) || Math.abs(row.delta) > 1)
    || !Number.isFinite(input.temporalDelta) || Math.abs(input.temporalDelta) > 1
    || !Number.isSafeInteger(input.temporalQuestions) || input.temporalQuestions <= 0 || input.temporalQuestions > 160
    || !Number.isSafeInteger(input.readerFailureCases) || input.readerFailureCases < 0 || input.readerFailureCases > 960
    || typeof input.matrixComplete !== "boolean" || !Number.isSafeInteger(input.judgeOnlyFailureCases)
    || input.judgeOnlyFailureCases < 0 || input.judgeOnlyFailureCases > 960) fail("decision inputs");
  return { contrast: "vector-window-composition minus vector-window", minimumDelta: 0.03, tolerance: 1e-12,
    temporalRequirement: "strictly positive locomo:2 delta",
    advanceToSeparateConfirmation: input.matrixComplete && input.readerFailureCases === 0 && input.judgeOnlyFailureCases === 0
      && input.overallDelta >= 0.03 - 1e-12 && input.groupDeltas.every(row => row.delta >= -1e-12)
      && input.temporalDelta > 1e-12,
    confirmedImprovement: false, externalFrameworkSuperiority: false,
    qualification: "Two previously exposed development conversations; this decision is not a confirmatory gain" };
}
