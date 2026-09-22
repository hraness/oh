import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { loadLocomoJudgeProfile } from "../scripts/benchmarks/evolution-locomo-judge";
import { parseEvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { scoreLocomoWindowStudy, type LocomoWindowScoreInput } from "../scripts/benchmarks/locomo-window-score";
import { LOCOMO_WINDOW_ARMS, LOCOMO_WINDOW_GROUPS, locomoWindowResultReceipt, makeLocomoWindowJudgePlan, makeLocomoWindowPlan,
  selectLocomoWindowIds, type LocomoWindowCase, type LocomoWindowJob, type LocomoWindowOutcome,
  type LocomoWindowResult, type LocomoWindowScorer, type LocomoWindowSource } from "../scripts/benchmarks/locomo-window-study";

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
const pin = (name: string) => ({ path: `/private-fixture/${name}`, sha256: sha256Hex(name) });
const rubric = await loadLocomoJudgeProfile();
// Each regression reconstructs the full 300 x 2 x 3 matrix. Bound its runtime
// independently of Bun's five-second default for small unit tests.
const matrixTest = (name: string, run: () => void) => test(name, run, 20_000);
let defaultFixture: LocomoWindowScoreInput | undefined;
function outcome(job: LocomoWindowJob, answer: string, status: "completed" | "truncated" = "completed"): LocomoWindowOutcome {
  const response = parseEvolutionResponse(new TextEncoder().encode(JSON.stringify({ model: job.request.model,
    choices: [{ index: 0, finish_reason: status === "truncated" ? "length" : "stop", message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 50, completion_tokens: 2, total_tokens: 52 },
    providerMetadata: { gateway: { routing: { finalProvider: job.request.provider, originalModelId: job.request.model,
      canonicalSlug: job.request.model, resolvedProviderApiModelId: "gpt-4o-mini-2024-07-18" } } } })), job.request);
  return { jobKey: job.key, disposition: response.status, response, failure: null, chargeMicros: response.usage.micros, serviceMs: 4 };
}
function seal(result: Omit<LocomoWindowResult, "resultSha256" | "ledger">): LocomoWindowResult {
  const outcomes = [...result.readerOutcomes, ...result.judgeOutcomes];
  const exposureMicros = outcomes.reduce((sum, row) => sum + row.chargeMicros, 0);
  const unresolvedMicros = outcomes.filter(row => row.disposition === "unresolved").reduce((sum, row) => sum + row.chargeMicros, 0);
  const payload = { ...result, ledger: { calls: outcomes.filter(row => row.disposition !== "unattempted").length,
    exposureMicros, confirmedMicros: exposureMicros - unresolvedMicros, unresolvedMicros,
    additionalBudgetMicros: 20_000_000, maximumCalls: 3600, historicalExposureMicros: 42, combinedExposureMicros: 42 + exposureMicros } };
  return { ...payload, resultSha256: locomoWindowResultReceipt(payload).resultSha256 };
}
function reseal(input: Mutable<LocomoWindowScoreInput>): void {
  const { resultSha256: _hash, ledger: _ledger, ...payload } = input.result;
  input.result = structuredClone(seal(payload)) as Mutable<LocomoWindowResult>;
}
function fixture(options: Readonly<{ identicalArms?: boolean; readerAnswer?: (cell: LocomoWindowCase) => string;
  readerStatus?: (cell: LocomoWindowCase) => "completed" | "truncated";
  judgeAnswer?: (cell: LocomoWindowCase) => string; judgeStatus?: (cell: LocomoWindowCase) => "completed" | "truncated" }> = {}): LocomoWindowScoreInput {
  if (Object.keys(options).length === 0 && defaultFixture !== undefined) return defaultFixture;
  const counts = [152, 81, 152, 199, 178, 123, 150, 191];
  const population = LOCOMO_WINDOW_GROUPS.flatMap((groupId, groupIndex) => Array.from({ length: counts[groupIndex]! }, (_, i) => ({
    questionId: `private-question-${groupId}-${i}`, groupId })));
  const selected = selectLocomoWindowIds(population, 300), group = new Map(population.map(row => [row.questionId, row.groupId]));
  const source: LocomoWindowSource = { protocol: "oh.locomo-window-source.v1", datasetSha256: sha256Hex("data"),
    confirmationRowsSha256: sha256Hex("confirmation"), selectionPolicySha256: sha256Hex("selection"), population,
    questions: selected.map(id => ({ id, groupId: group.get(id)!, question: `Private fixture question ${id}?`, questionDate: "2023-01-01",
      contexts: LOCOMO_WINDOW_ARMS.map(armId => {
        const text = `Private context ${id} ${options.identicalArms ? "shared" : armId}`;
        return { armId, text, contextSha256: sha256Hex(text), turnIds: [`private-turn-${id}`] };
      }) })) };
  const scorer: LocomoWindowScorer = { protocol: "oh.locomo-window-scorer.v1", datasetSha256: source.datasetSha256,
    sourceSha256: canonicalSha256(source), questions: source.questions.map(row => ({ id: row.id, corpusId: row.groupId,
      category: "locomo:4", question: row.question, answer: `private-gold-${row.id}`, unanswerable: false })) };
  const plan = makeLocomoWindowPlan({ source, sourcePin: pin("source"), scorerPin: pin("scorer"), campaignPin: pin("campaign"),
    campaign: { protocol: "oh.memory.evolution-campaign.v1", campaignId: "score-fixture", storeDirectory: "/private-fixture/store",
      approval: "Offline synthetic test", additionalBudgetMicros: 20_000_000, maximumCalls: 3600, historicalExposureMicros: 42,
      historicalLedgers: [{ ...pin("history"), bytes: 0 }], authAuthority: pin("auth") } });
  const readerOutcomes = plan.readerJobs.map(job => {
    const cell = plan.cases.find(cell => cell.readerJobKey === job.key)!;
    return outcome(job, options.readerAnswer?.(cell) ?? (cell.armId === "anchors-query-4" ? `private-gold-${cell.questionId}` : "wrong"),
      options.readerStatus?.(cell));
  });
  const judgePlan = makeLocomoWindowJudgePlan(plan, scorer, readerOutcomes, rubric);
  const judgeOutcomes = judgePlan.judgeJobs.map(job => {
    const judgeCase = judgePlan.judgeCases.find(cell => cell.judgeJobKey === job.key)!;
    const cell = plan.cases.find(cell => cell.questionId === judgeCase.questionId && cell.armId === judgeCase.armId && cell.repeat === judgeCase.repeat)!;
    return outcome(job, options.judgeAnswer?.(cell) ?? (cell.armId === "anchors-query-4" ? "CORRECT" : "WRONG"), options.judgeStatus?.(cell));
  });
  const fixture: LocomoWindowScoreInput = { plan, source, scorer, rubric, result: seal({ protocol: "oh.locomo-window-result.v1", phase: "judge", planSha256: plan.planSha256,
    scorerSha256: plan.scorerPin.sha256, readerOutcomes, judgePlanSha256: judgePlan.judgePlanSha256,
    judgeCases: judgePlan.judgeCases, judgeJobs: judgePlan.judgeJobs, judgeOutcomes, halt: "none" }) };
  if (Object.keys(options).length === 0) defaultFixture = fixture;
  return fixture;
}

describe("fixed LoCoMo window model-judged scorer", () => {
  matrixTest("three readers and one deduplicated exact judge produce eight-cluster paired estimates and private-free aggregates", () => {
    const input = fixture(), { publicSummary: score, privateObservations } = scoreLocomoWindowStudy(input);
    expect(score.matrixComplete).toBeTrue(); expect(score.claims.modelJudgedQaImprovement).toBeTrue();
    expect(score.reader).toMatchObject({ questions: 300, populationQuestions: 1226, conversations: 8, repeats: 3,
      logicalCases: 1800, physicalReaderJobs: 1800, physicalJudgeJobs: 600, judgeOnlyFailureCases: 0 });
    expect(score.reader.comparison).toMatchObject({ questions: 300, baseline: 0, candidate: 1, wins: 300, losses: 0, ties: 0,
      paired: { clusters: 8, delta: 1, lower: 1, upper: 1, samples: 10_000 } });
    expect(score.reader.arms.map(arm => [arm.cases, arm.correct, arm.accuracy])).toEqual([[900, 0, 0], [900, 900, 1]]);
    expect(score.reader.byConversation.map(group => group.questions).sort()).toEqual([37, 37, 37, 37, 38, 38, 38, 38]);
    expect(score.reader.nativeF1Secondary.comparison).toMatchObject({ baseline: 0, candidate: 1 });
    expect(score.reader.populationWeightedSecondary).toMatchObject({ baseline: 0, candidate: 1, delta: 1 });
    expect(privateObservations.cells).toHaveLength(1800); expect(privateObservations.questions).toHaveLength(300);
    expect(JSON.stringify(score)).not.toContain("private-"); expect(JSON.stringify(score)).not.toContain("/private-fixture");
    expect(score.claims.independentJudgeRepeats).toBeFalse(); expect(Object.isFrozen(score.reader.byConversation)).toBeTrue();
  });

  matrixTest("identical arm requests share within-repeat readers and globally share judges without fabricating an advantage", () => {
    const score = scoreLocomoWindowStudy(fixture({ identicalArms: true, readerAnswer: () => "same", judgeAnswer: () => "CORRECT" })).publicSummary;
    expect(score.reader).toMatchObject({ physicalReaderJobs: 900, physicalJudgeJobs: 300 });
    expect(score.reader.comparison).toMatchObject({ baseline: 1, candidate: 1, wins: 0, losses: 0, ties: 300,
      paired: { delta: 0, lower: 0, upper: 0 } });
    expect(score.claims.modelJudgedQaImprovement).toBeFalse();
  });

  matrixTest("known reader failures score zero in every original denominator and do not count as judge failures", () => {
    const score = scoreLocomoWindowStudy(fixture({ readerStatus: cell => cell.armId === "anchors-query-4" && cell.repeat === 1 ? "truncated" : "completed" })).publicSummary;
    expect(score.matrixComplete).toBeTrue(); expect(score.reader.judgeOnlyFailureCases).toBe(0);
    expect(score.reader.arms[1]).toMatchObject({ cases: 900, correct: 600, accuracy: 2 / 3,
      judgments: { "reader-failure": 300 }, repeatAccuracyRange: { minimum: 0, maximum: 1 },
      retrospectiveMajorityCorrectDiagnostic: { correct: 300, accuracy: 1 } });
    expect(score.reader.byRepeat[1]!.arms[1]!.accuracy).toBe(0);
    expect(score.reader.comparison.paired).toMatchObject({ delta: 2 / 3, lower: 2 / 3, upper: 2 / 3 });
    expect(score.claims.modelJudgedQaImprovement).toBeTrue();
  });

  matrixTest("different fractional repeat patterns with equal integer totals have exactly zero paired bounds", () => {
    const score = scoreLocomoWindowStudy(fixture({ readerAnswer: cell => `${cell.questionId}/${cell.armId}/${cell.repeat}`,
      judgeAnswer: cell => (cell.armId === "anchors-query-4" ? cell.repeat < 2 : cell.repeat > 0) ? "CORRECT" : "WRONG" })).publicSummary;
    expect(score.reader.physicalJudgeJobs).toBe(1800);
    expect(score.reader.comparison).toMatchObject({ baseline: 2 / 3, candidate: 2 / 3,
      wins: 0, losses: 0, ties: 300, paired: { delta: 0, lower: 0, upper: 0 } });
    expect(score.reader.byRepeat.map(row => row.arms.map(arm => arm.accuracy))).toEqual([[0, 1], [1, 1], [1, 0]]);
    expect(score.claims.modelJudgedQaImprovement).toBeFalse();
  });

  matrixTest("ambiguous native judge labels and judge transport failures remain zero and block promotion", () => {
    const data = fixture(); const first = data.plan.questionIds[0]!;
    for (const mode of ["ambiguous", "truncated"] as const) {
      const score = scoreLocomoWindowStudy(fixture({ judgeAnswer: cell => cell.questionId === first && mode === "ambiguous"
        ? "CORRECT and WRONG" : cell.armId === "anchors-query-4" ? "CORRECT" : "WRONG",
      judgeStatus: cell => cell.questionId === first && mode === "truncated" ? "truncated" : "completed" })).publicSummary;
      expect(score.matrixComplete).toBeTrue(); expect(score.reader.judgeOnlyFailureCases).toBe(6);
      expect(score.reader.arms[1]!.cases).toBe(900); expect(score.reader.arms[1]!.correct).toBe(897);
      expect(score.reader.comparison.paired!.lower).toBeGreaterThan(0);
      expect(score.claims.modelJudgedQaImprovement).toBeFalse();
    }
  });

  matrixTest("the frozen full-message judge envelope is a visible failure without truncating or removing the question", () => {
    const first = fixture().plan.questionIds[0]!;
    const score = scoreLocomoWindowStudy(fixture({ readerAnswer: cell => cell.questionId === first && cell.armId === "anchors-query-4"
      ? "x".repeat(24_000) : cell.armId === "anchors-query-4" ? `private-gold-${cell.questionId}` : "wrong" })).publicSummary;
    expect(score.reader).toMatchObject({ questions: 300, logicalCases: 1800, judgeOnlyFailureCases: 3 });
    expect(score.reader.arms[1]!.judgments["judge-input-bound"]).toBe(3);
    expect(score.reader.arms[1]!.accuracy).toBe(897 / 900); expect(score.claims.modelJudgedQaImprovement).toBeFalse();
  });

  matrixTest("unattempted readers retain the entire matrix and refuse promotion; no judge stage may precede complete readers", () => {
    const data = structuredClone(fixture()) as Mutable<LocomoWindowScoreInput>;
    const first = data.result.readerOutcomes[0]!;
    data.result.readerOutcomes[0] = { jobKey: first.jobKey, disposition: "unattempted", response: null, failure: null, chargeMicros: 0, serviceMs: null };
    data.result.judgePlanSha256 = null; data.result.judgeCases = []; data.result.judgeJobs = []; data.result.judgeOutcomes = [];
    data.result.halt = "interrupted"; data.result.phase = "reader"; reseal(data);
    const score = scoreLocomoWindowStudy(data).publicSummary;
    expect(score.matrixComplete).toBeFalse(); expect(score.reader.logicalCases).toBe(1800);
    expect(score.reader.arms.map(arm => arm.cases)).toEqual([900, 900]); expect(score.claims.modelJudgedQaImprovement).toBeFalse();
    data.result.judgePlanSha256 = sha256Hex("unexpected"); reseal(data);
    expect(() => scoreLocomoWindowStudy(data)).toThrow("judge stage before complete readers");
  });

  matrixTest("an unresolved native judge retains its full reservation and blocks completeness", () => {
    const data = structuredClone(fixture()) as Mutable<LocomoWindowScoreInput>, job = data.result.judgeJobs[0]!;
    data.result.judgeOutcomes[0] = { jobKey: job.key, disposition: "unresolved", response: null,
      failure: { requestSha256: job.request.requestSha256, profileSha256: job.request.profileSha256, repeat: 0,
        storeStatus: "reserved", reason: "dispatch-outcome-unknown", rawSha256: null, rawBytes: null, transport: null,
        serviceMs: null, reservationMicros: job.request.reservationMicros }, chargeMicros: job.request.reservationMicros, serviceMs: null };
    data.result.halt = "judge-failure"; reseal(data);
    const score = scoreLocomoWindowStudy(data).publicSummary;
    expect(score.matrixComplete).toBeFalse(); expect(score.costs.unresolvedMicros).toBe(job.request.reservationMicros);
    expect(score.claims.modelJudgedQaImprovement).toBeFalse(); expect(score.reader.arms[0]!.cases).toBe(900);
  });

  matrixTest("a fully settled reader-only phase is never presented as a complete QA score", () => {
    const data = structuredClone(fixture()) as Mutable<LocomoWindowScoreInput>;
    data.result.phase = "reader"; data.result.judgePlanSha256 = null;
    data.result.judgeCases = []; data.result.judgeJobs = []; data.result.judgeOutcomes = []; reseal(data);
    const score = scoreLocomoWindowStudy(data).publicSummary;
    expect(score.matrixComplete).toBeFalse(); expect(score.claims.modelJudgedQaImprovement).toBeFalse();
    expect(score.reader.arms.map(arm => arm.judgments.incomplete)).toEqual([900, 900]);
  });

  matrixTest("missing, duplicated, mislabeled and mismatched native outcomes are rejected even when the result is resealed", () => {
    const base = fixture();
    const changes = [
      (data: Mutable<LocomoWindowScoreInput>) => { data.result.readerOutcomes.pop(); },
      (data: Mutable<LocomoWindowScoreInput>) => { data.result.readerOutcomes[1] = data.result.readerOutcomes[0]!; },
      (data: Mutable<LocomoWindowScoreInput>) => { data.result.readerOutcomes[0]!.response!.requestSha256 = sha256Hex("other"); },
      (data: Mutable<LocomoWindowScoreInput>) => { data.result.judgeOutcomes[0]!.response!.profileSha256 = sha256Hex("other"); },
      (data: Mutable<LocomoWindowScoreInput>) => { data.result.judgeCases[0]!.answerSha256 = sha256Hex("other"); },
      (data: Mutable<LocomoWindowScoreInput>) => { data.result.judgeJobs[0]!.repeat = 1; },
    ];
    for (const change of changes) {
      const data = structuredClone(base) as Mutable<LocomoWindowScoreInput>; change(data); reseal(data);
      expect(() => scoreLocomoWindowStudy(data)).toThrow();
    }
  });

  matrixTest("self-consistent score changes cannot decouple source contexts, raw gold, judge answers or physical accounting", () => {
    const base = fixture();
    for (const change of [
      (data: Mutable<LocomoWindowScoreInput>) => { data.scorer.questions[0]!.answer = "altered private gold"; },
      (data: Mutable<LocomoWindowScoreInput>) => { data.result.readerOutcomes[0]!.response!.answer = "altered answer"; },
      (data: Mutable<LocomoWindowScoreInput>) => { data.result.judgeCases[0]!.questionId = data.plan.questionIds[1]!; },
    ]) {
      const data = structuredClone(base) as Mutable<LocomoWindowScoreInput>; change(data); reseal(data);
      expect(() => scoreLocomoWindowStudy(data)).toThrow("judge prompt, answer, case or plan binding");
    }
    const data = structuredClone(base) as Mutable<LocomoWindowScoreInput>;
    data.plan.cases[0]!.contextSha256 = sha256Hex("wrong context");
    const { planSha256: _hash, ...payload } = data.plan; data.plan.planSha256 = canonicalSha256(payload);
    data.result.planSha256 = data.plan.planSha256; reseal(data);
    expect(() => scoreLocomoWindowStudy(data)).toThrow("reader context, prompt or matrix binding");
    const ledger = structuredClone(base) as Mutable<LocomoWindowScoreInput>; ledger.result.ledger.calls++;
    const { resultSha256: _resultHash, ...resultPayload } = ledger.result;
    ledger.result.resultSha256 = locomoWindowResultReceipt(resultPayload).resultSha256;
    expect(() => scoreLocomoWindowStudy(ledger)).toThrow("ledger accounting");
  });

  matrixTest("heterogeneous conversation effects cross zero and poststratification is explicitly separate from the balanced primary", () => {
    const score = scoreLocomoWindowStudy(fixture({ judgeAnswer: cell =>
      (LOCOMO_WINDOW_GROUPS.indexOf(cell.groupId as typeof LOCOMO_WINDOW_GROUPS[number]) < 4) === (cell.armId === "anchors-query-4") ? "CORRECT" : "WRONG" })).publicSummary;
    expect(score.reader.comparison.paired!.lower).toBeLessThan(0); expect(score.reader.comparison.paired!.upper).toBeGreaterThan(0);
    expect(score.reader.comparison.paired!.clusters).toBe(8); expect(score.claims.modelJudgedQaImprovement).toBeFalse();
    expect(score.reader.populationWeightedSecondary.candidate).toBeCloseTo((152 + 81 + 152 + 199) / 1226, 12);
    expect(score.reader.populationWeightedSecondary.candidate).not.toBe(score.reader.comparison.candidate);
  });
});
