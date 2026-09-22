/** Pure post-capture scoring. The report owner must first authenticate file pins
 * and every native outcome against the locked campaign store. This module makes
 * no calls and reconstructs both prompt stages before computing any score. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { EVOLUTION_LOCOMO_JUDGE_RUBRIC_SHA, parseLocomoJudgeDecision,
  type EvolutionLocomoJudgeProfile } from "./evolution-locomo-judge";
import { makeEvolutionRequest, validateEvolutionRequest } from "./evolution-model";
import { LOCOMO_F1_PROTOCOL, scoreLocomoF1 } from "./evolution-metrics";
import { evolutionAnswerMessages } from "./evolution-reader-contracts";
import { validateEvolutionAttemptFailure } from "./evolution-store";
import { LOCOMO_WINDOW_ARMS, LOCOMO_WINDOW_GROUPS, LOCOMO_WINDOW_LIMITS, LOCOMO_WINDOW_READER,
  locomoWindowJobKey, locomoWindowResultReceipt, makeLocomoWindowJudgePlan, parseLocomoWindowScorer, parseLocomoWindowSource,
  type LocomoWindowJob, type LocomoWindowOutcome, type LocomoWindowPlan,
  type LocomoWindowResult, type LocomoWindowScorer, type LocomoWindowSource } from "./locomo-window-study";
import { mean, pairedBootstrap } from "./metrics";

export const LOCOMO_WINDOW_SCORE_POLICY = Object.freeze({ protocol: "oh.locomo-window-score.v1",
  repeats: 3, seed: 17, bootstrapSamples: 10_000, intervalZeroTolerance: 1e-12,
  baseline: "vector-window", candidate: "anchors-query-4",
  endpoint: "adapted-LoCoMo-J-model-judged-QA", primary: "selected-question-mean-of-three-readers",
  judgeReplication: "one-physical-judge-per-distinct-exact-prompt-at-repeat-zero" } as const);
export type LocomoWindowScoreInput = Readonly<{ plan: LocomoWindowPlan; result: LocomoWindowResult;
  source: LocomoWindowSource; scorer: LocomoWindowScorer; rubric: EvolutionLocomoJudgeProfile }>;
type Cell = Readonly<{ questionId: string; groupId: string; armId: string; repeat: number; score: 0 | 1; f1: number; f1BoundFailure: boolean;
  readerDisposition: LocomoWindowOutcome["disposition"];
  judgment: "correct" | "wrong" | "reader-failure" | "judge-input-bound" | "judge-failure" | "incomplete" }>;
type Pair = Readonly<{ questionId: string; groupId: string; baselineCount: number; candidateCount: number }>;
const outcomeKinds = ["completed", "truncated", "refused", "failed", "unresolved", "unattempted"] as const;
const judgmentKinds = ["correct", "wrong", "reader-failure", "judge-input-bound", "judge-failure", "incomplete"] as const;
const unsettled = (outcome: LocomoWindowOutcome) => outcome.disposition === "unresolved" || outcome.disposition === "unattempted";
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number"
  && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value <= maximum;
const same = (left: unknown, right: unknown) => canonicalSha256(left) === canonicalSha256(right);
const key = (questionId: string, armId: string, repeat: number) => JSON.stringify([questionId, armId, repeat]);
function fail(reason: string): never { throw new TypeError(`LoCoMo window scoring: ${reason}.`); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function verifyPlanDigest(value: LocomoWindowPlan): void {
  const { planSha256, ...preimage } = value;
  if (planSha256 !== canonicalSha256(preimage)) fail("planSha256 mismatch");
}

function verifyOutcomes(jobs: readonly LocomoWindowJob[], outcomes: readonly LocomoWindowOutcome[]): void {
  if (!Array.isArray(outcomes) || outcomes.length !== jobs.length) fail("physical outcome coverage");
  outcomes.forEach((outcome, index) => {
    const job = jobs[index]!;
    if (!isPlainRecord(outcome as unknown) || !hasExactKeys(outcome as unknown as Record<string, unknown>, ["jobKey", "disposition", "response", "failure", "chargeMicros", "serviceMs"])
      || outcome.jobKey !== job.key || !outcomeKinds.includes(outcome.disposition)
      || !integer(outcome.chargeMicros, job.request.reservationMicros)
      || outcome.serviceMs !== null && (!Number.isFinite(outcome.serviceMs) || outcome.serviceMs < 0 || outcome.serviceMs > 86_400_000)) fail("outcome identity or bounds");
    if (outcome.disposition === "unattempted") {
      if (outcome.response !== null || outcome.failure !== null || outcome.chargeMicros !== 0 || outcome.serviceMs !== null) fail("unattempted custody");
    } else if (outcome.disposition === "unresolved") {
      const failure = validateEvolutionAttemptFailure(outcome.failure, job.request, job.repeat);
      if (outcome.response !== null || outcome.chargeMicros !== job.request.reservationMicros
        || outcome.serviceMs !== failure.serviceMs) fail("unresolved custody");
    } else {
      const response = outcome.response;
      if (response === null || outcome.failure !== null || response.status !== outcome.disposition
        || response.requestSha256 !== job.request.requestSha256 || response.profileSha256 !== job.request.profileSha256
        || parseSha256Hex(response.rawSha256) === null || !integer(response.rawBytes, 4 * 1024 * 1024)
        || !integer(response.usage.micros, job.request.reservationMicros) || outcome.chargeMicros !== response.usage.micros
        || response.identity.requestedModel !== job.request.model || response.identity.finalProvider !== job.request.provider) fail("native response custody");
      if (outcome.disposition === "completed") {
        if (typeof response.answer !== "string" || response.answer.length === 0 || Buffer.byteLength(response.answer) > 4 * 1024 * 1024
          || /\p{Surrogate}/u.test(response.answer)) fail("completed answer custody");
      } else if (response.answer !== null) fail("noncompleted answer custody");
    }
  });
}

function verifyInputs(input: LocomoWindowScoreInput) {
  const { plan, result, rubric } = input;
  const source = parseLocomoWindowSource(input.source), scorer = parseLocomoWindowScorer(input.scorer, source);
  if (Buffer.byteLength(JSON.stringify(plan)) > LOCOMO_WINDOW_LIMITS.planBytes) fail("artifact bounds");
  verifyPlanDigest(plan);
  // Full native answers remain in the store; the bounded receipt hashes them
  // individually instead of serializing a second complete hydrated matrix.
  locomoWindowResultReceipt(result);
  const count = plan.selection === "preferred-300" ? 300 : plan.selection === "cost-only-prefix-120" ? 120 : 0;
  if (plan.protocol !== "oh.locomo-window-plan.v1" || plan.readerProfile !== LOCOMO_WINDOW_READER
    || plan.judgeProfile !== "gpt4o-mini-locomo-j-judge-v1" || plan.repeats !== 3 || plan.judgeMessageBytes !== 24000
    || plan.sourceSha256 !== canonicalSha256(source) || !same(plan.arms, LOCOMO_WINDOW_ARMS)
    || count === 0 || !same(plan.questionIds, source.questions.slice(0, count).map(question => question.id))
    || !same(plan.canaryQuestionIds, plan.questionIds.slice(0, 2)) || rubric.sha256 !== EVOLUTION_LOCOMO_JUDGE_RUBRIC_SHA
    || plan.cases.length !== count * 6 || plan.readerJobs.length < count * 3 || plan.readerJobs.length > count * 6) fail("frozen plan scope");
  const jobs = new Map<string, LocomoWindowJob>();
  for (const job of plan.readerJobs) {
    validateEvolutionRequest(job.request);
    if (jobs.has(job.key) || !integer(job.repeat, 2) || job.request.profileId !== LOCOMO_WINDOW_READER
      || job.key !== locomoWindowJobKey(job.request, job.repeat)) fail("reader job identity");
    jobs.set(job.key, job);
  }
  const expectedCells = [], expectedJobs = new Map<string, LocomoWindowJob>();
  for (const [questionIndex, question] of source.questions.slice(0, count).entries()) {
    const requests = question.contexts.map(context => makeEvolutionRequest(LOCOMO_WINDOW_READER,
      evolutionAnswerMessages({ question: question.question, questionDate: question.questionDate }, context.text, "legacy-v1")));
    for (let repeat = 0; repeat < 3; repeat++) for (const armIndex of (questionIndex + repeat) % 2 === 0 ? [0, 1] : [1, 0]) {
      const context = question.contexts[armIndex]!, request = requests[armIndex]!, readerJobKey = locomoWindowJobKey(request, repeat);
      expectedCells.push({ questionId: question.id, groupId: question.groupId, armId: context.armId, repeat,
        contextSha256: context.contextSha256, readerJobKey });
      if (!expectedJobs.has(readerJobKey)) expectedJobs.set(readerJobKey, { key: readerJobKey, request, repeat });
    }
  }
  if (!same(expectedCells, plan.cases) || !same([...expectedJobs.values()], plan.readerJobs)) fail("reader context, prompt or matrix binding");
  if (result.protocol !== "oh.locomo-window-result.v1" || result.planSha256 !== plan.planSha256
    || result.scorerSha256 !== plan.scorerPin.sha256 || !["reader", "judge"].includes(result.phase)
    || !["none", "canary-failure", "reader-failure", "judge-failure", "preexisting-unresolved", "interrupted"].includes(result.halt)) fail("result binding");
  verifyOutcomes(plan.readerJobs, result.readerOutcomes);
  const readersSettled = result.readerOutcomes.every(outcome => !unsettled(outcome));
  if (result.phase === "judge") {
    if (!readersSettled) fail("judge stage before complete readers");
    const expected = makeLocomoWindowJudgePlan(plan, scorer, result.readerOutcomes, rubric);
    if (result.judgePlanSha256 !== expected.judgePlanSha256 || !same(result.judgeCases, expected.judgeCases)
      || !same(result.judgeJobs, expected.judgeJobs)) fail("judge prompt, answer, case or plan binding");
  } else if (result.judgePlanSha256 !== null || result.judgeCases.length !== 0 || result.judgeJobs.length !== 0
    || result.judgeOutcomes.length !== 0) fail("judge stage before complete readers");
  verifyOutcomes(result.judgeJobs, result.judgeOutcomes);
  const outcomes = [...result.readerOutcomes, ...result.judgeOutcomes];
  const ledgerKeys = ["calls", "exposureMicros", "confirmedMicros", "unresolvedMicros", "additionalBudgetMicros", "maximumCalls", "historicalExposureMicros", "combinedExposureMicros"];
  if (!isPlainRecord(result.ledger) || !hasExactKeys(result.ledger, ledgerKeys)
    || ledgerKeys.some(field => !integer((result.ledger as Record<string, unknown>)[field]))
    || result.ledger.exposureMicros !== result.ledger.confirmedMicros + result.ledger.unresolvedMicros
    || result.ledger.combinedExposureMicros !== result.ledger.historicalExposureMicros + result.ledger.exposureMicros
    || result.ledger.additionalBudgetMicros > 20_000_000 || result.ledger.maximumCalls > 3600
    || result.ledger.exposureMicros > result.ledger.additionalBudgetMicros || result.ledger.calls > result.ledger.maximumCalls
    || result.ledger.calls !== outcomes.filter(outcome => outcome.disposition !== "unattempted").length
    || result.ledger.exposureMicros !== outcomes.reduce((sum, outcome) => sum + outcome.chargeMicros, 0)
    || result.ledger.unresolvedMicros !== outcomes.filter(outcome => outcome.disposition === "unresolved").reduce((sum, outcome) => sum + outcome.chargeMicros, 0)) fail("ledger accounting or unexplained jobs");
  return { source, scorer, readersSettled };
}

function comparison(rows: readonly Pair[]) {
  // Integer counts preserve exact zero before resampling; only scale at the end.
  const paired = pairedBootstrap(rows.map(row => ({ cluster: row.groupId, left: row.baselineCount, right: row.candidateCount })), 17, 10_000);
  const scale = (value: number) => Math.abs(value / 3) <= 1e-12 ? 0 : value / 3;
  return { questions: rows.length, baseline: mean(rows.map(row => row.baselineCount))! / 3,
    candidate: mean(rows.map(row => row.candidateCount))! / 3,
    wins: rows.filter(row => row.candidateCount > row.baselineCount).length,
    losses: rows.filter(row => row.candidateCount < row.baselineCount).length,
    ties: rows.filter(row => row.candidateCount === row.baselineCount).length,
    paired: paired === null ? null : { ...paired, delta: scale(paired.delta), lower: scale(paired.lower), upper: scale(paired.upper) } };
}
function cellSummary(cells: readonly Cell[]) {
  const correct = cells.reduce((sum, cell) => sum + cell.score, 0);
  return { cases: cells.length, correct, accuracy: cells.length ? correct / cells.length : null,
    nativeF1: mean(cells.map(cell => cell.f1)), nativeF1BoundFailures: cells.filter(cell => cell.f1BoundFailure).length,
    readerDispositions: Object.fromEntries(outcomeKinds.map(disposition => [disposition, cells.filter(cell => cell.readerDisposition === disposition).length])),
    judgments: Object.fromEntries(judgmentKinds.map(disposition => [disposition, cells.filter(cell => cell.judgment === disposition).length])) };
}

/** Missing/duplicate cases throw. Explicit noncompletion retains zero in the
 * fixed matrix but cannot qualify any public claim. Native known reader failures
 * are zero; any judge-only failure prevents promotion even with a positive CI. */
export function scoreLocomoWindowStudy(input: LocomoWindowScoreInput) {
  const { source, scorer, readersSettled } = verifyInputs(input), { plan, result } = input;
  const gold = new Map(scorer.questions.map(question => [question.id, question]));
  const readers = new Map(result.readerOutcomes.map(row => [row.jobKey, row]));
  const judges = new Map(result.judgeOutcomes.map(row => [row.jobKey, row]));
  const judgeCases = new Map(result.judgeCases.map(row => [key(row.questionId, row.armId, row.repeat), row]));
  const cells: Cell[] = plan.cases.map(cell => {
    const reader = readers.get(cell.readerJobKey)!, judgeCase = judgeCases.get(key(cell.questionId, cell.armId, cell.repeat));
    let judgment: Cell["judgment"] = "incomplete", score: 0 | 1 = 0;
    let f1 = 0, f1BoundFailure = false;
    if (reader.disposition === "completed") {
      try {
        if (Buffer.byteLength(reader.response!.answer!) > 262_144) throw new RangeError("F1 answer byte bound");
        f1 = scoreLocomoF1(gold.get(cell.questionId)!, reader.response!.answer!);
      }
      catch (error) { if (!(error instanceof RangeError)) throw error; f1BoundFailure = true; }
    }
    if (reader.disposition !== "completed" && !unsettled(reader)) judgment = "reader-failure";
    else if (judgeCase?.disposition === "judge-input-bound") judgment = "judge-input-bound";
    else if (judgeCase?.disposition === "judge-request") {
      const judge = judges.get(judgeCase.judgeJobKey!)!;
      if (!unsettled(judge)) {
        const parsed = judge.disposition === "completed" ? parseLocomoJudgeDecision(judge.response!.answer) : null;
        judgment = parsed === null ? "judge-failure" : parsed === 1 ? "correct" : "wrong"; score = parsed ?? 0;
      }
    }
    return { questionId: cell.questionId, groupId: cell.groupId, armId: cell.armId, repeat: cell.repeat,
      readerDisposition: reader.disposition, judgment, score, f1, f1BoundFailure };
  });
  const cellMap = new Map(cells.map(cell => [key(cell.questionId, cell.armId, cell.repeat), cell]));
  const questions: Pair[] = plan.questionIds.map(questionId => {
    const counts = LOCOMO_WINDOW_ARMS.map(arm => [0, 1, 2].reduce((sum, repeat) => sum + cellMap.get(key(questionId, arm, repeat))!.score, 0));
    return { questionId, groupId: cellMap.get(key(questionId, LOCOMO_WINDOW_ARMS[0], 0))!.groupId,
      baselineCount: counts[0]!, candidateCount: counts[1]! };
  });
  const primary = comparison(questions);
  const matrixComplete = result.phase === "judge" && readersSettled && result.judgeOutcomes.every(outcome => !unsettled(outcome));
  const judgeOnlyFailureCases = cells.filter(cell => cell.judgment === "judge-failure" || cell.judgment === "judge-input-bound").length;
  const byConversation = LOCOMO_WINDOW_GROUPS.map(groupId => ({ groupId,
    populationQuestions: source.population.filter(row => row.groupId === groupId).length,
    questions: questions.filter(row => row.groupId === groupId).length,
    comparison: comparison(questions.filter(row => row.groupId === groupId)),
    arms: LOCOMO_WINDOW_ARMS.map(armId => ({ armId, ...cellSummary(cells.filter(cell => cell.groupId === groupId && cell.armId === armId)) })) }));
  const weighted = LOCOMO_WINDOW_ARMS.map((_arm, index) => byConversation.reduce((sum, group) =>
    sum + group.populationQuestions * (index === 0 ? group.comparison.baseline : group.comparison.candidate), 0) / source.population.length);
  const publicSummary = { protocol: "oh.locomo-window-public-score.v1", policy: LOCOMO_WINDOW_SCORE_POLICY,
    planSha256: plan.planSha256, resultSha256: result.resultSha256, sourceSha256: plan.sourceSha256,
    scorerSha256: plan.scorerPin.sha256, readerProfile: plan.readerProfile, judgeProfile: plan.judgeProfile,
    rubricSha256: input.rubric.sha256, matrixComplete, halt: result.halt, costs: { ...result.ledger },
    reader: { questions: questions.length, populationQuestions: source.population.length, conversations: byConversation.length,
      repeats: 3, logicalCases: cells.length, physicalReaderJobs: plan.readerJobs.length, physicalJudgeJobs: result.judgeJobs.length,
      judgeOnlyFailureCases, comparison: primary,
      nativeF1Secondary: { protocol: LOCOMO_F1_PROTOCOL, primary: false, fixedFailureDenominator: true,
        comparison: (() => {
          const observations = questions.map(question => ({ cluster: question.groupId,
            left: mean(cells.filter(cell => cell.questionId === question.questionId && cell.armId === LOCOMO_WINDOW_ARMS[0]).map(cell => cell.f1))!,
            right: mean(cells.filter(cell => cell.questionId === question.questionId && cell.armId === LOCOMO_WINDOW_ARMS[1]).map(cell => cell.f1))! }));
          return { baseline: mean(observations.map(row => row.left)), candidate: mean(observations.map(row => row.right)),
            paired: pairedBootstrap(observations, 17, 10_000) };
        })() },
      arms: LOCOMO_WINDOW_ARMS.map(armId => {
        const repeats = [0, 1, 2].map(repeat => cellSummary(cells.filter(cell => cell.armId === armId && cell.repeat === repeat)).accuracy!);
        const majority = plan.questionIds.filter(id => [0, 1, 2].reduce((sum, repeat) => sum + cellMap.get(key(id, armId, repeat))!.score, 0) >= 2).length;
        return { armId, ...cellSummary(cells.filter(cell => cell.armId === armId)),
          repeatAccuracyRange: { minimum: Math.min(...repeats), maximum: Math.max(...repeats) },
          retrospectiveMajorityCorrectDiagnostic: { questions: questions.length, correct: majority, accuracy: majority / questions.length,
            rule: "at-least-two-of-three-correct; otherwise-zero; not-primary" } };
      }),
      byRepeat: [0, 1, 2].map(repeat => ({ repeat, arms: LOCOMO_WINDOW_ARMS.map(armId => ({ armId,
        ...cellSummary(cells.filter(cell => cell.repeat === repeat && cell.armId === armId)) })) })),
      byConversation,
      populationWeightedSecondary: { estimand: "native-eligible-population-poststratified-estimate; not-full-population-evaluation",
        populationQuestions: source.population.length, sampledQuestions: questions.length,
        baseline: weighted[0]!, candidate: weighted[1]!, delta: weighted[1]! - weighted[0]! } },
    claims: { modelJudgedQaImprovement: matrixComplete && judgeOnlyFailureCases === 0
      && primary.paired !== null && primary.paired.lower > LOCOMO_WINDOW_SCORE_POLICY.intervalZeroTolerance,
      fullNativeLeaderboardEvaluation: false, independentJudgeRepeats: false, humanValidatedAccuracy: false,
      externalFrameworkSuperiority: false, previouslyUnexposedDataset: false } };
  return freeze({ publicSummary, privateObservations: { questions, cells } });
}
