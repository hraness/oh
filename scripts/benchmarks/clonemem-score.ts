/** Pure, post-capture scoring. The caller authenticates the pinned source, plan,
 * rank capture and native store before supplying them here. No retrieval, model
 * calls, file access or source selection occurs in this module. */
import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { cloneMemChoiceCorrect, cloneMemRecallAtK, type CloneMemScorerRow } from "./clonemem-dataset";
import { EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID } from "./evolution-model";
import { mean, pairedBootstrap } from "./metrics";
import { validatePairedMemoryResult, type PairedMemoryDisposition, type PairedMemoryPlan,
  type PairedMemoryResult } from "./paired-memory-study";

export const CLONEMEM_SCORE_POLICY = Object.freeze({ protocol: "oh.clonemem.score.v1", k: 10,
  repeats: 3, seed: 17, bootstrapSamples: 10_000, minimumChoiceGain: 0.05,
  intervalZeroTolerance: 1e-12,
  baseline: "raw-vector", candidate: "oh-hybrid", diagnostic: "oh-keyword" } as const);
export type CloneMemScoringArm = "raw-vector" | "oh-hybrid" | "oh-keyword";
export type CloneMemFrozenRank = Readonly<{ questionId: string; armId: CloneMemScoringArm; traceIds: readonly string[] }>;
export type CloneMemNativeAnswer = Readonly<{ jobKey: string; answer: string | null }>;
export type CloneMemScoreInput = Readonly<{ scorerRows: readonly CloneMemScorerRow[];
  retrieval: readonly CloneMemFrozenRank[]; plan: PairedMemoryPlan; result: PairedMemoryResult;
  answers: readonly CloneMemNativeAnswer[] }>;
type Pair = Readonly<{ questionId: string; personId: string; baseline: number; candidate: number }>;
type Cell = Readonly<{ questionId: string; personId: string; armId: string; repeat: number;
  score: number; disposition: PairedMemoryDisposition }>;
const primaryArms = [CLONEMEM_SCORE_POLICY.baseline, CLONEMEM_SCORE_POLICY.candidate] as const;
const dispositions = ["completed", "truncated", "refused", "failed", "unresolved", "unattempted"] as const;

function fail(reason: string): never { throw new TypeError(`CloneMem scoring: ${reason}.`); }
function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= maximum
    && !value.includes("\0") && !/\p{Surrogate}/u.test(value);
}
function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) fail(`duplicate ${label}`);
}
function key(questionId: string, armId: string, repeat?: number): string {
  return JSON.stringify([questionId, armId, ...(repeat === undefined ? [] : [repeat])]);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function compare(rows: readonly Pair[], repeats: 1 | 3 = 1) {
  // For choice scores, resample integer correct counts then divide by three.
  // This is algebraically identical to resampling question means, without
  // rounding a true zero bound upward through e.g. (1 - 2/3) - 1/3.
  const interval = pairedBootstrap(rows.map(row => ({ cluster: row.personId,
    left: row.baseline * repeats, right: row.candidate * repeats })), CLONEMEM_SCORE_POLICY.seed, CLONEMEM_SCORE_POLICY.bootstrapSamples);
  const scaled = (value: number) => Math.abs(value / repeats) <= CLONEMEM_SCORE_POLICY.intervalZeroTolerance ? 0 : value / repeats;
  return { questions: rows.length, baseline: mean(rows.map(row => row.baseline)), candidate: mean(rows.map(row => row.candidate)),
    wins: rows.filter(row => row.candidate > row.baseline).length,
    losses: rows.filter(row => row.candidate < row.baseline).length,
    ties: rows.filter(row => row.candidate === row.baseline).length,
    paired: interval === null ? null : { ...interval, delta: scaled(interval.delta),
      lower: scaled(interval.lower), upper: scaled(interval.upper) } };
}
function cellSummary(cells: readonly Cell[]) {
  const correct = cells.reduce((sum, cell) => sum + cell.score, 0);
  return { cases: cells.length, correct, accuracy: cells.length === 0 ? null : correct / cells.length,
    dispositions: Object.fromEntries(dispositions.map(disposition => [disposition, cells.filter(cell => cell.disposition === disposition).length])) };
}

/** The scorer rows define the exact retrieval population; plan.questionIds
 * defines the exact reader subset. All supplied native answers must match the
 * authenticated result's answer digests, including shared physical requests.
 * Missing rows throw. Explicit unattempted/unresolved outcomes remain in the
 * fixed denominator and make every claim gate false. */
export function scoreCloneMemStudy(input: CloneMemScoreInput) {
  const { scorerRows, retrieval, plan, result, answers } = input;
  if (!Array.isArray(scorerRows) || scorerRows.length < 1 || scorerRows.length > 5_120) fail("scorer population bound");
  unique(scorerRows.map(row => row.questionId), "scorer question");
  let references = 0;
  for (const row of scorerRows) {
    if (!text(row.questionId, 512) || !text(row.personId, 128) || !text(row.category, 256)
      || !text(row.correctChoiceId, 16) || !Array.isArray(row.evidenceGroups) || row.evidenceGroups.length > 256) fail("scorer row bounds");
    for (const group of row.evidenceGroups) {
      if (!Array.isArray(group) || group.length > 2_000 || group.some(id => !text(id, 256))) fail("evidence group bounds");
      references += group.length;
      if (references > 250_000) fail("total evidence reference bound");
    }
  }
  const rows = new Map(scorerRows.map(row => [row.questionId, row]));
  const people = [...new Set(scorerRows.map(row => row.personId))].sort();
  if (people.length > 10) fail("persona bound");
  const persona = new Map(people.map((id, index) => [id, `persona-${String(index + 1).padStart(2, "0")}`]));
  if (!Array.isArray(retrieval) || retrieval.length < scorerRows.length * 2 || retrieval.length > scorerRows.length * 3) fail("retrieval coverage");
  const hasDiagnostic = retrieval.some(row => row.armId === CLONEMEM_SCORE_POLICY.diagnostic);
  const retrievalArms: readonly CloneMemScoringArm[] = hasDiagnostic ? [...primaryArms, CLONEMEM_SCORE_POLICY.diagnostic] : primaryArms;
  if (retrieval.length !== scorerRows.length * retrievalArms.length) fail("retrieval coverage");
  const ranks = new Map<string, readonly string[]>();
  for (const rank of retrieval) {
    if (!rows.has(rank.questionId) || !retrievalArms.includes(rank.armId) || !Array.isArray(rank.traceIds)
      || rank.traceIds.length > CLONEMEM_SCORE_POLICY.k || rank.traceIds.some((id: unknown) => !text(id, 256))) fail("rank identity or bounds");
    unique(rank.traceIds, "ranked trace");
    const identity = key(rank.questionId, rank.armId);
    if (ranks.has(identity)) fail("duplicate retrieval cell");
    ranks.set(identity, rank.traceIds);
  }
  for (const row of scorerRows) for (const armId of retrievalArms) if (!ranks.has(key(row.questionId, armId))) fail("missing retrieval cell");

  if (plan.protocol !== "oh.memory.paired-plan.v1" || plan.readerProfile !== EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID
    || plan.repeats !== 3 || plan.arms.length !== 2 || !primaryArms.every(arm => plan.arms.includes(arm))
    || !Array.isArray(plan.questionIds) || plan.questionIds.length < 1 || plan.questionIds.length > 300
    || plan.questionIds.some(id => !rows.has(id))) fail("reader plan scope");
  unique(plan.questionIds, "selected question");
  const selected = new Set(plan.questionIds);
  if (!Array.isArray(plan.cases) || plan.cases.length !== plan.questionIds.length * 2 * 3
    || !Array.isArray(plan.jobs) || plan.jobs.length < 1 || plan.jobs.length > plan.cases.length
    || plan.maximumPhysicalCalls !== plan.jobs.length) fail("reader matrix bound");
  unique(plan.jobs.map(job => job.key), "physical job");
  const jobs = new Map(plan.jobs.map(job => [job.key, job]));
  const seenCases = new Set<string>(), referencedJobs = new Set<string>();
  for (const cell of plan.cases) {
    if (!selected.has(cell.questionId) || cell.groupId !== rows.get(cell.questionId)?.personId
      || !primaryArms.some(arm => arm === cell.armId) || !Number.isSafeInteger(cell.repeat) || cell.repeat < 0 || cell.repeat >= 3
      || jobs.get(cell.jobKey)?.repeat !== cell.repeat) fail("reader cell identity");
    const identity = key(cell.questionId, cell.armId, cell.repeat);
    if (seenCases.has(identity)) fail("duplicate reader cell");
    seenCases.add(identity); referencedJobs.add(cell.jobKey);
  }
  if (referencedJobs.size !== jobs.size) fail("unreferenced physical job");
  for (const questionId of plan.questionIds) for (const armId of primaryArms) for (let repeat = 0; repeat < 3; repeat++) {
    if (!seenCases.has(key(questionId, armId, repeat))) fail("missing reader cell");
  }
  validatePairedMemoryResult(plan, result);
  if (!Array.isArray(answers) || answers.length !== jobs.size) fail("native answer coverage");
  unique(answers.map(answer => answer.jobKey), "native answer");
  const outcomes = new Map(result.outcomes.map(outcome => [outcome.jobKey, outcome]));
  const answerMap = new Map(answers.map(answer => {
    const outcome = outcomes.get(answer.jobKey);
    if (outcome === undefined) fail("unknown native answer");
    if (outcome.disposition === "completed") {
      if (typeof answer.answer !== "string" || Buffer.byteLength(answer.answer) > 16_384
        || /\p{Surrogate}/u.test(answer.answer) || sha256Hex(answer.answer) !== outcome.answerSha256) fail("native answer custody");
    } else if (answer.answer !== null) fail("noncompleted native answer");
    return [answer.jobKey, answer.answer] as const;
  }));

  const retrievalObservations = scorerRows.map(row => ({ questionId: row.questionId, personId: row.personId,
    values: retrievalArms.map(armId => ({ armId, recall: cloneMemRecallAtK(row, ranks.get(key(row.questionId, armId))!, 10) })) }));
  const retrievalPairs: Pair[] = retrievalObservations.flatMap(row => {
    const baseline = row.values[0]!.recall, candidate = row.values[1]!.recall;
    return baseline === null || candidate === null ? [] : [{ questionId: row.questionId, personId: row.personId, baseline, candidate }];
  });
  const cells: Cell[] = plan.cases.map(cell => ({ questionId: cell.questionId, personId: cell.groupId, armId: cell.armId,
    repeat: cell.repeat, score: cloneMemChoiceCorrect(rows.get(cell.questionId)!, answerMap.get(cell.jobKey)!),
    disposition: outcomes.get(cell.jobKey)!.disposition }));
  const cellMap = new Map(cells.map(cell => [key(cell.questionId, cell.armId, cell.repeat), cell]));
  const readerObservations = plan.questionIds.map(questionId => {
    const vectorRepeats = [0, 1, 2].map(repeat => cellMap.get(key(questionId, primaryArms[0], repeat))!.score);
    const hybridRepeats = [0, 1, 2].map(repeat => cellMap.get(key(questionId, primaryArms[1], repeat))!.score);
    return { questionId, personId: rows.get(questionId)!.personId,
      baseline: vectorRepeats.reduce((sum, value) => sum + value, 0) / 3,
      candidate: hybridRepeats.reduce((sum, value) => sum + value, 0) / 3, vectorRepeats, hybridRepeats };
  });
  const retrievalComparison = compare(retrievalPairs), readerComparison = compare(readerObservations, 3);
  const matrixComplete = result.outcomes.every(outcome => outcome.disposition !== "unattempted" && outcome.disposition !== "unresolved");
  const readerArms = primaryArms.map(armId => {
    const byRepeat = [0, 1, 2].map(repeat => cellSummary(cells.filter(cell => cell.armId === armId && cell.repeat === repeat)).accuracy!);
    const majorityCorrect = plan.questionIds.filter(questionId => [0, 1, 2]
      .reduce((sum, repeat) => sum + cellMap.get(key(questionId, armId, repeat))!.score, 0) >= 2).length;
    return { armId, ...cellSummary(cells.filter(cell => cell.armId === armId)),
      repeatAccuracyRange: { minimum: Math.min(...byRepeat), maximum: Math.max(...byRepeat) },
      retrospectiveMajorityCorrectDiagnostic: { questions: plan.questionIds.length, correct: majorityCorrect,
        accuracy: majorityCorrect / plan.questionIds.length, rule: "at-least-two-of-three-correct; otherwise-zero; not-primary" } };
  });
  const observedChoiceGain = (readerArms[1]!.correct - readerArms[0]!.correct) / (plan.questionIds.length * 3);
  const meetsFivePointGain = (readerArms[1]!.correct - readerArms[0]!.correct) * 20 >= plan.questionIds.length * 3;
  const recallPositive = matrixComplete && retrievalComparison.paired !== null && retrievalComparison.paired.lower > 0;
  const choicePositive = matrixComplete && readerComparison.paired !== null && readerComparison.paired.lower > 0;
  const publicSummary = {
    protocol: "oh.clonemem.public-score.v1", policy: { ...CLONEMEM_SCORE_POLICY }, planSha256: canonicalSha256(plan),
    readerProfile: plan.readerProfile, matrixComplete, allResponsesCompleted: result.outcomes.every(outcome => outcome.disposition === "completed"),
    halt: result.halt, costs: { ...result.ledger },
    retrieval: { questions: scorerRows.length, scorableQuestions: retrievalPairs.length, noEvidenceQuestions: scorerRows.length - retrievalPairs.length,
      personas: people.length, arms: retrievalArms.map(armId => ({ armId,
        recallAt10: mean(retrievalObservations.map(row => row.values.find(value => value.armId === armId)!.recall)) })),
      comparison: retrievalComparison, byPersona: people.map(personId => ({ persona: persona.get(personId)!,
        questions: scorerRows.filter(row => row.personId === personId).length,
        scorableQuestions: retrievalPairs.filter(row => row.personId === personId).length,
        arms: retrievalArms.map(armId => ({ armId, recallAt10: mean(retrievalObservations.filter(row => row.personId === personId)
          .map(row => row.values.find(value => value.armId === armId)!.recall)) })) })) },
    reader: { questions: plan.questionIds.length, personas: new Set(readerObservations.map(row => row.personId)).size,
      repeats: 3, logicalCases: cells.length, physicalJobs: jobs.size, final: matrixComplete, arms: readerArms,
      observedChoiceGain, comparison: readerComparison,
      byRepeat: [0, 1, 2].map(repeat => ({ repeat, arms: primaryArms.map(armId => ({ armId,
        ...cellSummary(cells.filter(cell => cell.repeat === repeat && cell.armId === armId)) })) })),
      byPersona: people.filter(personId => readerObservations.some(row => row.personId === personId)).map(personId => ({ persona: persona.get(personId)!,
        questions: readerObservations.filter(row => row.personId === personId).length,
        arms: primaryArms.map(armId => ({ armId, ...cellSummary(cells.filter(cell => cell.personId === personId && cell.armId === armId)) })) })) },
    claims: { recallAt10Improvement: recallPositive, multipleChoiceImprovement: choicePositive,
      combinedImprovement: recallPositive && choicePositive && meetsFivePointGain,
      externalFrameworkSuperiority: false },
  };
  return freeze({ publicSummary, privateObservations: { retrieval: retrievalObservations, reader: readerObservations, cells } });
}
