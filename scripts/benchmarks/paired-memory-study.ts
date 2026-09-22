/** A new, bounded paired-reader protocol. Historical Evolution study enums stay closed.
 * The dataset adapter owns the gold-free projection and native prompt; the scorer is
 * pinned separately and is never invoked while planning or dispatching readers. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { evolutionPin, parseEvolutionCampaign, type EvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { makeEvolutionRequest, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import type { EvolutionStore } from "./evolution-store";
import type { Message } from "./model";

export const PAIRED_MEMORY_LIMITS = Object.freeze({ questions: 300, population: 100_000, arms: 2, repeats: 3,
  contextBytes: 96 * 1024, questionBytes: 16 * 1024, sourceBytes: 64 * 1024 * 1024, planBytes: 128 * 1024 * 1024,
  resultBytes: 2 * 1024 * 1024, campaignMicros: 20_000_000, taskMicros: 25_000_000, concurrency: 4, attempts: 8 });
export type PairedMemoryReader = "gpt5-mini-reader" | "gpt4o-mini-reader" | "gpt4o-mini-clonemem-choice-v1-reader";
export type PairedMemoryQuestion = Readonly<{ id: string; groupId: string; question: string; questionDate: string;
  personName: string; choices: readonly Readonly<{ id: string; text: string }>[];
  contexts: readonly Readonly<{ armId: string; text: string }>[] }>;
export type PairedMemorySource = Readonly<{ protocol: "oh.memory.paired-source.v1"; datasetRevision: string;
  selection: Readonly<{ algorithm: "clonemem-balanced-sha256-v1"; seed: number;
    population: readonly Readonly<{ questionId: string; groupId: string }>[]; count: number }>;
  arms: readonly [string, string]; questions: readonly PairedMemoryQuestion[] }>;
export type PairedMemoryPromptInput = Readonly<Pick<PairedMemoryQuestion, "question" | "questionDate" | "personName" | "choices">>;
export type PairedMemoryRenderer = (question: PairedMemoryPromptInput, context: string) => readonly Message[];
export type PairedMemoryJob = Readonly<{ key: string; request: EvolutionRequest; repeat: number }>;
export type PairedMemoryCase = Readonly<{ questionId: string; groupId: string; armId: string; repeat: number;
  contextSha256: string; jobKey: string }>;
export type PairedMemoryPlan = Readonly<{ protocol: "oh.memory.paired-plan.v1"; sourcePin: EvolutionPin;
  sourceSha256: string; promptPin: EvolutionPin; scorerPin: EvolutionPin; campaignPin: EvolutionPin; campaignSha256: string;
  readerProfile: PairedMemoryReader; arms: readonly [string, string]; questionIds: readonly string[]; repeats: 3;
  canaryQuestionIds: readonly string[]; jobs: readonly PairedMemoryJob[]; cases: readonly PairedMemoryCase[];
  maximumReservationMicros: number; maximumPhysicalCalls: number; additionalJudgeReservationMicros: 0 }>;
export type PairedMemoryPlanInput = Readonly<{ source: unknown; sourcePin: EvolutionPin; promptPin: EvolutionPin;
  scorerPin: EvolutionPin; campaignPin: EvolutionPin; campaign: EvolutionCampaign;
  readerProfile: PairedMemoryReader; renderMessages: PairedMemoryRenderer }>;

function fail(reason: string): never { throw new TypeError(`Paired memory study: ${reason}.`); }
function text(value: unknown, maximum: number, empty = false): value is string {
  return typeof value === "string" && (empty || value.length > 0) && Buffer.byteLength(value) <= maximum
    && !/\p{Surrogate}/u.test(value) && !value.includes("\0");
}
function id(value: unknown): value is string { return text(value, 160) && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(value); }
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function boundedJson(value: unknown, maximum: number): string {
  const encoded = canonicalJson(value); if (Buffer.byteLength(encoded) > maximum) fail("artifact byte bound"); return encoded;
}

/** Selection is fixed by a public seed and the complete eligible ID population, never an answer or score.
 * The adapter must establish eligibility before calling this function and pin the raw source revision. */
export function selectPairedMemoryIds(population: readonly Readonly<{ questionId: string; groupId: string }>[], seed: number, count: number): readonly string[] {
  if (!Array.isArray(population) || population.length < 1 || population.length > PAIRED_MEMORY_LIMITS.population
    || population.some(row => !isPlainRecord(row) || !hasExactKeys(row, ["questionId", "groupId"]) || !id(row.questionId) || !id(row.groupId))
    || new Set(population.map(row => row.questionId)).size !== population.length || !integer(seed, 0, 2 ** 32 - 1)
    || !integer(count, 1, Math.min(PAIRED_MEMORY_LIMITS.questions, population.length))) fail("selection bounds or duplicate IDs");
  const ranks = new Map<string, string>();
  const rank = (value: string) => { if (!ranks.has(value)) ranks.set(value, sha256Hex(`oh.clonemem.reader-draw.v1:${seed}:${value}`)); return ranks.get(value)!; };
  const compare = (a: string, b: string) => rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0;
  const byGroup = new Map<string, string[]>();
  for (const row of population) { if (!byGroup.has(row.groupId)) byGroup.set(row.groupId, []); byGroup.get(row.groupId)!.push(row.questionId); }
  const groups = [...byGroup.keys()].sort(compare);
  for (const questions of byGroup.values()) questions.sort(compare);
  const selected: string[] = [];
  for (let index = 0; selected.length < count; index++) for (const group of groups) {
    const questionId = byGroup.get(group)![index];
    if (questionId !== undefined) selected.push(questionId);
    if (selected.length === count) break;
  }
  return Object.freeze(selected);
}

/** Reject unknown fields, including gold/evidence, rather than passing whole dataset rows to the reader.
 * This is a schema boundary; the pinned adapter remains responsible for semantic source provenance. */
export function parsePairedMemorySource(value: unknown): PairedMemorySource {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "datasetRevision", "selection", "arms", "questions"])
    || value.protocol !== "oh.memory.paired-source.v1" || !text(value.datasetRevision, 256)
    || !Array.isArray(value.arms) || value.arms.length !== 2 || !value.arms.every(id) || value.arms[0] === value.arms[1]
    || !isPlainRecord(value.selection) || !hasExactKeys(value.selection, ["algorithm", "seed", "population", "count"])
    || value.selection.algorithm !== "clonemem-balanced-sha256-v1" || !Array.isArray(value.selection.population)
    || !integer(value.selection.seed, 0, 2 ** 32 - 1) || !integer(value.selection.count, 1, PAIRED_MEMORY_LIMITS.questions)
    || !Array.isArray(value.questions) || value.questions.length !== value.selection.count) fail("gold-free source shape");
  const population = value.selection.population as PairedMemorySource["selection"]["population"];
  const selected = selectPairedMemoryIds(population, value.selection.seed, value.selection.count);
  const groupsByQuestion = new Map(population.map(row => [row.questionId, row.groupId]));
  const arms = value.arms as [string, string];
  const questions = value.questions.map((question, index) => {
    if (!isPlainRecord(question) || !hasExactKeys(question, ["id", "groupId", "question", "questionDate", "personName", "choices", "contexts"])
      || question.id !== selected[index] || !id(question.groupId) || question.groupId !== groupsByQuestion.get(question.id as string)
      || !text(question.question, PAIRED_MEMORY_LIMITS.questionBytes)
      || !text(question.questionDate, 512, true) || !text(question.personName, 512)
      || !Array.isArray(question.choices) || question.choices.length < 2 || question.choices.length > 8
      || !Array.isArray(question.contexts) || question.contexts.length !== 2) fail("question projection or fixed selection order");
    const choices = question.choices.map(choice => {
      if (!isPlainRecord(choice) || !hasExactKeys(choice, ["id", "text"]) || typeof choice.id !== "string"
        || !/^[A-Za-z0-9_-]{1,16}$/.test(choice.id) || !text(choice.text, 16_384)) fail("gold-free choice shape");
      return { id: choice.id, text: choice.text };
    });
    if (new Set(choices.map(choice => choice.id.toUpperCase())).size !== choices.length) fail("choice duplicate");
    const contexts = question.contexts.map((context, armIndex) => {
      if (!isPlainRecord(context) || !hasExactKeys(context, ["armId", "text"]) || context.armId !== arms[armIndex]
        || !text(context.text, PAIRED_MEMORY_LIMITS.contextBytes, true)) fail("context projection, order or byte bound");
      return { armId: context.armId as string, text: context.text };
    });
    return { id: question.id as string, groupId: question.groupId, question: question.question, questionDate: question.questionDate,
      personName: question.personName, choices, contexts };
  });
  const source: PairedMemorySource = { protocol: value.protocol, datasetRevision: value.datasetRevision,
    selection: { algorithm: "clonemem-balanced-sha256-v1", seed: value.selection.seed,
      population: population.map(row => ({ questionId: row.questionId, groupId: row.groupId })), count: value.selection.count },
    arms: [...arms], questions };
  boundedJson(source, PAIRED_MEMORY_LIMITS.sourceBytes); return freeze(source);
}

/** Pure preparation: exact conservative native reservations, no provider/auth access and no gold scorer. */
export function makePairedMemoryPlan(input: PairedMemoryPlanInput): PairedMemoryPlan {
  const source = parsePairedMemorySource(input.source), campaign = parseEvolutionCampaign(input.campaign);
  if (!["gpt5-mini-reader", "gpt4o-mini-reader", "gpt4o-mini-clonemem-choice-v1-reader"].includes(input.readerProfile)) fail("closed matched reader profile");
  if (campaign.additionalBudgetMicros > PAIRED_MEMORY_LIMITS.campaignMicros || campaign.maximumCalls > 1800) fail("campaign exceeds study cap");
  const sourcePin = evolutionPin(input.sourcePin), promptPin = evolutionPin(input.promptPin), scorerPin = evolutionPin(input.scorerPin), campaignPin = evolutionPin(input.campaignPin);
  if (sourcePin.path === campaignPin.path || [promptPin.path, scorerPin.path].some(path => [sourcePin.path, campaignPin.path].includes(path))) fail("source and campaign data roles must be separate from code");
  const jobs = new Map<string, PairedMemoryJob>(), cases: PairedMemoryCase[] = [];
  for (const [questionIndex, question] of source.questions.entries()) {
    const requests = question.contexts.map(context => makeEvolutionRequest(input.readerProfile,
      input.renderMessages(Object.freeze({ question: question.question, questionDate: question.questionDate,
        personName: question.personName, choices: question.choices }), context.text)));
    for (let repeat = 0; repeat < 3; repeat++) {
      // Deterministic alternating order avoids always giving one arm the first provider slot.
      const armOrder = (questionIndex + repeat) % 2 === 0 ? [0, 1] : [1, 0];
      for (const armIndex of armOrder) {
        const request = requests[armIndex]!, context = question.contexts[armIndex]!, key = `${request.requestSha256}:${repeat}`;
        if (!jobs.has(key)) jobs.set(key, { key, request, repeat });
        cases.push({ questionId: question.id, groupId: question.groupId, armId: context.armId, repeat,
          contextSha256: sha256Hex(context.text), jobKey: key });
      }
    }
  }
  const physical = [...jobs.values()], reservation = physical.reduce((sum, job) => sum + job.request.reservationMicros, 0);
  if (reservation > campaign.additionalBudgetMicros || physical.length > campaign.maximumCalls) fail("complete-plan reservation or call cap");
  const plan: PairedMemoryPlan = { protocol: "oh.memory.paired-plan.v1", sourcePin, sourceSha256: canonicalSha256(source),
    promptPin, scorerPin, campaignPin, campaignSha256: canonicalSha256(campaign), readerProfile: input.readerProfile,
    arms: source.arms, questionIds: source.questions.map(q => q.id), repeats: 3,
    canaryQuestionIds: source.questions.slice(0, 2).map(q => q.id), jobs: physical, cases,
    maximumReservationMicros: reservation, maximumPhysicalCalls: physical.length, additionalJudgeReservationMicros: 0 };
  boundedJson(plan, PAIRED_MEMORY_LIMITS.planBytes); return freeze(plan);
}

/** Serialized plans are admitted only by full reconstruction from pinned source and prompt code. */
export function verifyPairedMemoryPlan(value: unknown, input: PairedMemoryPlanInput): PairedMemoryPlan {
  const plan = makePairedMemoryPlan(input);
  if (boundedJson(value, PAIRED_MEMORY_LIMITS.planBytes) !== canonicalJson(plan)) fail("plan does not exactly reconstruct");
  return plan;
}

export function partitionPairedMemoryCanary(plan: PairedMemoryPlan) {
  const questions = new Set(plan.canaryQuestionIds);
  const keys = new Set(plan.cases.filter(cell => questions.has(cell.questionId)).map(cell => cell.jobKey));
  return Object.freeze({ canary: Object.freeze(plan.jobs.filter(job => keys.has(job.key))),
    remainder: Object.freeze(plan.jobs.filter(job => !keys.has(job.key))) });
}

/** Bounded orchestration only: no built-in provider access. Tests can exercise stop/drain
 * with an offline callback; the live caller must pass the reviewed launch gate first. */
export async function executePairedMemoryBatches(jobs: readonly PairedMemoryJob[],
  invoke: (job: PairedMemoryJob, stopped: () => boolean) => Promise<Readonly<{ status: EvolutionResponse["status"] }>>,
  externalStopped: () => boolean = () => false): Promise<boolean> {
  if (jobs.length > 1800 || new Set(jobs.map(job => job.key)).size !== jobs.length) fail("physical batch coverage");
  let stopped = false;
  const admissionStopped = () => stopped || externalStopped();
  for (let offset = 0; offset < jobs.length && !admissionStopped(); offset += PAIRED_MEMORY_LIMITS.concurrency) {
    await Promise.all(jobs.slice(offset, offset + PAIRED_MEMORY_LIMITS.concurrency).map(async job => {
      if (admissionStopped()) return;
      try { if ((await invoke(job, admissionStopped)).status !== "completed") stopped = true; }
      catch { stopped = true; }
    }));
  }
  return !admissionStopped();
}

export type PairedMemoryDisposition = EvolutionResponse["status"] | "unresolved" | "unattempted";
export type PairedMemoryOutcome = Readonly<{ jobKey: string; disposition: PairedMemoryDisposition; answerSha256: string | null;
  rawSha256: string | null; chargeMicros: number; serviceMs: number | null }>;
export type PairedMemoryResult = Readonly<{ protocol: "oh.memory.paired-result.v1"; planSha256: string;
  halt: "none" | "canary-failure" | "reader-failure" | "preexisting-unresolved" | "interrupted"; outcomes: readonly PairedMemoryOutcome[];
  ledger: ReturnType<EvolutionStore["summary"]> }>;

/** Read authoritative native ledger outcomes. No response is reissued or scored here. */
export function collectPairedMemoryResult(plan: PairedMemoryPlan, store: EvolutionStore, halt: PairedMemoryResult["halt"]): PairedMemoryResult {
  const outcomes = plan.jobs.map(job => {
    const entry = store.lookup(job.request, job.repeat);
    if (entry.kind === "hit") return { jobKey: job.key, disposition: entry.result.status,
      answerSha256: entry.result.answer === null ? null : sha256Hex(entry.result.answer), rawSha256: entry.result.rawSha256,
      chargeMicros: entry.result.usage.micros, serviceMs: store.readServiceMs(job.request, job.repeat) };
    return { jobKey: job.key, disposition: entry.kind === "occupied" ? "unresolved" as const : "unattempted" as const,
      answerSha256: null, rawSha256: null, chargeMicros: entry.kind === "occupied" ? job.request.reservationMicros : 0,
      serviceMs: entry.kind === "occupied" && entry.status === "captured" ? store.readServiceMs(job.request, job.repeat) : null };
  });
  const result: PairedMemoryResult = { protocol: "oh.memory.paired-result.v1", planSha256: canonicalSha256(plan), halt, outcomes, ledger: store.summary() };
  boundedJson(result, PAIRED_MEMORY_LIMITS.resultBytes); return freeze(result);
}

/** Exact physical coverage precedes every public projection; missing jobs are never dropped. */
export function validatePairedMemoryResult(plan: PairedMemoryPlan, result: PairedMemoryResult): void {
  if (!isPlainRecord(result) || !hasExactKeys(result, ["protocol", "planSha256", "halt", "outcomes", "ledger"])
    || result.protocol !== "oh.memory.paired-result.v1" || result.planSha256 !== canonicalSha256(plan)
    || !["none", "canary-failure", "reader-failure", "preexisting-unresolved", "interrupted"].includes(result.halt)
    || !Array.isArray(result.outcomes) || result.outcomes.length !== plan.jobs.length) fail("result shape or physical coverage");
  result.outcomes.forEach((outcome, index) => {
    if (!isPlainRecord(outcome) || !hasExactKeys(outcome, ["jobKey", "disposition", "answerSha256", "rawSha256", "chargeMicros", "serviceMs"])
      || outcome.jobKey !== plan.jobs[index]!.key || typeof outcome.disposition !== "string"
      || !["completed", "truncated", "refused", "failed", "unresolved", "unattempted"].includes(outcome.disposition)
      || !integer(outcome.chargeMicros, 0, plan.jobs[index]!.request.reservationMicros)
      || (outcome.serviceMs !== null && (typeof outcome.serviceMs !== "number" || !Number.isFinite(outcome.serviceMs) || outcome.serviceMs < 0))
      || (outcome.answerSha256 !== null && parseSha256Hex(outcome.answerSha256) === null)
      || (outcome.rawSha256 !== null && parseSha256Hex(outcome.rawSha256) === null)) fail("outcome identity or bounds");
    if (outcome.disposition === "completed" && (outcome.answerSha256 === null || outcome.rawSha256 === null)) fail("completed result without answer custody");
    if (["truncated", "refused", "failed"].includes(outcome.disposition) && (outcome.rawSha256 === null || outcome.answerSha256 !== null)) fail("invalid failed-response custody");
    if (outcome.disposition === "unattempted" && (outcome.chargeMicros !== 0 || outcome.rawSha256 !== null || outcome.answerSha256 !== null || outcome.serviceMs !== null)) fail("unattempted result has provider evidence");
    if (outcome.disposition === "unresolved" && (outcome.chargeMicros !== plan.jobs[index]!.request.reservationMicros || outcome.answerSha256 !== null)) fail("unresolved reservation changed");
  });
  const ledgerKeys = ["calls", "exposureMicros", "confirmedMicros", "unresolvedMicros", "additionalBudgetMicros", "maximumCalls", "historicalExposureMicros", "combinedExposureMicros"];
  if (!isPlainRecord(result.ledger) || !hasExactKeys(result.ledger, ledgerKeys)
    || ledgerKeys.some(key => !integer((result.ledger as Record<string, unknown>)[key], 0, Number.MAX_SAFE_INTEGER))
    || result.ledger.exposureMicros !== result.ledger.confirmedMicros + result.ledger.unresolvedMicros
    || result.ledger.combinedExposureMicros !== result.ledger.historicalExposureMicros + result.ledger.exposureMicros
    || result.ledger.additionalBudgetMicros > PAIRED_MEMORY_LIMITS.campaignMicros
    || result.ledger.exposureMicros > result.ledger.additionalBudgetMicros || result.ledger.calls > result.ledger.maximumCalls
    || result.ledger.calls !== result.outcomes.filter(outcome => outcome.disposition !== "unattempted").length
    || result.ledger.exposureMicros !== result.outcomes.reduce((sum, outcome) => sum + outcome.chargeMicros, 0)
    || result.ledger.unresolvedMicros !== result.outcomes.filter(outcome => outcome.disposition === "unresolved").reduce((sum, outcome) => sum + outcome.chargeMicros, 0)) fail("ledger accounting or unexplained physical jobs");
}

/** Recovery never issues a request. Settle verifiable captured first responses and
 * reconcile every physical job before exposing the set of never-reserved jobs. */
export function reconcilePairedMemoryStore(plan: PairedMemoryPlan, store: EvolutionStore) {
  for (const job of plan.jobs) {
    const entry = store.lookup(job.request, job.repeat);
    if (entry.kind === "occupied" && entry.status === "captured") {
      try { store.finalize(job.request, job.repeat); } catch { /* The full unknown reservation stays occupied. */ }
    }
  }
  const result = collectPairedMemoryResult(plan, store, "none");
  validatePairedMemoryResult(plan, result);
  return Object.freeze({ result, blocked: result.ledger.unresolvedMicros !== 0,
    unissued: Object.freeze(plan.jobs.filter((_, index) => result.outcomes[index]!.disposition === "unattempted")) });
}

/** Output allowlist: no question IDs, prompts, answers, gold, file paths, or provider raw bytes.
 * Optional native scores must cover every logical cell; failed/unattempted cells always score zero. */
export function pairedMemoryPublicSummary(plan: PairedMemoryPlan, result: PairedMemoryResult,
  scores?: readonly Readonly<{ questionId: string; armId: string; repeat: number; score: 0 | 1 }>[]) {
  validatePairedMemoryResult(plan, result);
  if (scores !== undefined && (!Array.isArray(scores) || scores.length !== plan.cases.length)) fail("score denominator");
  if (scores !== undefined && result.outcomes.some(outcome => outcome.disposition === "unattempted" || outcome.disposition === "unresolved")) fail("final scoring requires a complete matrix");
  const outcomes = new Map(result.outcomes.map(outcome => [outcome.jobKey, outcome]));
  const byArm = plan.arms.map(armId => ({ armId, cases: 0, completed: 0, truncated: 0, refused: 0, failed: 0,
    unresolved: 0, unattempted: 0, correct: scores === undefined ? null as number | null : 0 }));
  plan.cases.forEach((cell, index) => {
    const arm = byArm.find(row => row.armId === cell.armId)!, outcome = outcomes.get(cell.jobKey)!;
    arm.cases++; arm[outcome.disposition]++;
    if (scores !== undefined) {
      const score = scores[index];
      if (!isPlainRecord(score) || !hasExactKeys(score, ["questionId", "armId", "repeat", "score"])
        || score.questionId !== cell.questionId || score.armId !== cell.armId || score.repeat !== cell.repeat
        || (score.score !== 0 && score.score !== 1) || (outcome.disposition !== "completed" && score.score !== 0)) fail("native score coverage or failure scored nonzero");
      arm.correct! += score.score;
    }
  });
  return freeze({ protocol: "oh.memory.paired-public-summary.v1", planSha256: result.planSha256,
    readerProfile: plan.readerProfile, selectedQuestions: plan.questionIds.length, repeats: 3, logicalCases: plan.cases.length,
    physicalJobs: plan.jobs.length, maximumReservationMicros: plan.maximumReservationMicros,
    matrixComplete: result.outcomes.every(outcome => outcome.disposition !== "unattempted" && outcome.disposition !== "unresolved"),
    allResponsesCompleted: result.outcomes.every(outcome => outcome.disposition === "completed"),
    halt: result.halt, ledger: { ...result.ledger }, arms: byArm });
}
