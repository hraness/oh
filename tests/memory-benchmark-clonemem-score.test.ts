import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { makeCloneMemChoiceMessages, type CloneMemScorerRow } from "../scripts/benchmarks/clonemem-dataset";
import { scoreCloneMemStudy, type CloneMemScoreInput } from "../scripts/benchmarks/clonemem-score";
import { EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID } from "../scripts/benchmarks/evolution-model";
import { makePairedMemoryPlan, selectPairedMemoryIds, type PairedMemoryCase, type PairedMemoryDisposition,
  type PairedMemoryResult, type PairedMemorySource } from "../scripts/benchmarks/paired-memory-study";

const pin = (name: string) => ({ path: `/fixture/${name}`, sha256: sha256Hex(name) });
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function fixture(options: Readonly<{ groups?: readonly number[]; identicalArms?: boolean;
  answer?: (cell: PairedMemoryCase) => string; disposition?: (cell: PairedMemoryCase) => PairedMemoryDisposition;
  rank?: (row: CloneMemScorerRow, arm: string) => readonly string[] }> = {}): CloneMemScoreInput {
  const population = (options.groups ?? [3, 3, 3]).flatMap((count, group) => Array.from({ length: count }, (_, i) => ({
    questionId: `private-person-${group}:private-question-${i}`, groupId: `private-person-${group}` })));
  const questionIds = selectPairedMemoryIds(population, 17, population.length);
  const source: PairedMemorySource = { protocol: "oh.memory.paired-source.v1", datasetRevision: "f".repeat(40),
    selection: { algorithm: "clonemem-balanced-sha256-v1", seed: 17, population, count: population.length },
    arms: ["raw-vector", "oh-hybrid"], questions: questionIds.map(id => ({ id,
      groupId: population.find(row => row.questionId === id)!.groupId, question: `Private fixture question ${id}`,
      questionDate: "2020-01-01T00:00:00", personName: "Private Fixture Person",
      choices: [{ id: "A", text: "Private first choice" }, { id: "B", text: "Private second choice" }],
      contexts: ["raw-vector", "oh-hybrid"].map(armId => ({ armId,
        text: `Private fixture context ${id} ${options.identicalArms ? "shared" : armId}` })) })) };
  const plan = makePairedMemoryPlan({ source, sourcePin: pin("source"), promptPin: pin("prompt"), scorerPin: pin("scorer"),
    campaignPin: pin("campaign"), campaign: { protocol: "oh.memory.evolution-campaign.v1", campaignId: "scoring-fixture",
      storeDirectory: "/fixture/store", approval: "Synthetic offline test only", additionalBudgetMicros: 20_000_000,
      maximumCalls: 1800, historicalExposureMicros: 0, historicalLedgers: [{ ...pin("history"), bytes: 0 }], authAuthority: pin("auth") },
    readerProfile: EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID, renderMessages: makeCloneMemChoiceMessages });
  const scorerRows: CloneMemScorerRow[] = population.map(row => ({ questionId: row.questionId, personId: row.groupId,
    category: "inference", correctChoiceId: "A", evidenceGroups: [[`private-gold-${row.questionId}`]] }));
  const retrieval = scorerRows.flatMap(row => (["raw-vector", "oh-hybrid", "oh-keyword"] as const).map(armId => ({
    questionId: row.questionId, armId, traceIds: options.rank?.(row, armId)
      ?? [armId === "raw-vector" ? "private-wrong-trace" : row.evidenceGroups[0]![0]!] })));
  const answers = plan.jobs.map(job => {
    const cell = plan.cases.find(cell => cell.jobKey === job.key)!;
    const disposition = options.disposition?.(cell) ?? "completed";
    return { jobKey: job.key, answer: disposition === "completed" ? options.answer?.(cell) ?? (cell.armId === "oh-hybrid" ? "A" : "B") : null };
  });
  const outcomes = plan.jobs.map((job, index) => {
    const disposition = options.disposition?.(plan.cases.find(cell => cell.jobKey === job.key)!) ?? "completed";
    return { jobKey: job.key, disposition, answerSha256: answers[index]!.answer === null ? null : sha256Hex(answers[index]!.answer!),
      rawSha256: ["unattempted", "unresolved"].includes(disposition) ? null : sha256Hex(`raw-${job.key}`),
      chargeMicros: disposition === "unattempted" ? 0 : disposition === "unresolved" ? job.request.reservationMicros : 10,
      serviceMs: ["unattempted", "unresolved"].includes(disposition) ? null : 12 };
  });
  const exposureMicros = outcomes.reduce((sum, row) => sum + row.chargeMicros, 0);
  const unresolvedMicros = outcomes.filter(row => row.disposition === "unresolved").reduce((sum, row) => sum + row.chargeMicros, 0);
  const result: PairedMemoryResult = { protocol: "oh.memory.paired-result.v1", planSha256: canonicalSha256(plan),
    halt: outcomes.some(row => row.disposition !== "completed") ? "reader-failure" : "none", outcomes,
    ledger: { calls: outcomes.filter(row => row.disposition !== "unattempted").length, exposureMicros,
      confirmedMicros: exposureMicros - unresolvedMicros, unresolvedMicros, additionalBudgetMicros: 20_000_000,
      maximumCalls: 1800, historicalExposureMicros: 0, combinedExposureMicros: exposureMicros } };
  return { scorerRows, retrieval, plan, result, answers };
}

describe("CloneMem native paired scorer", () => {
  test("positive co-primary result uses question means, three persona clusters and separate public/private outputs", () => {
    const { publicSummary: score, privateObservations } = scoreCloneMemStudy(fixture());
    expect(score.claims).toEqual({ recallAt10Improvement: true, multipleChoiceImprovement: true,
      combinedImprovement: true, externalFrameworkSuperiority: false });
    expect(score.retrieval.comparison).toMatchObject({ questions: 9, baseline: 0, candidate: 1, wins: 9, losses: 0, ties: 0,
      paired: { clusters: 3, delta: 1, lower: 1, upper: 1, samples: 10_000 } });
    expect(score.reader.comparison).toMatchObject({ questions: 9, paired: { clusters: 3, delta: 1 } });
    expect(score.reader.arms.map(arm => [arm.cases, arm.correct, arm.accuracy])).toEqual([[27, 0, 0], [27, 27, 1]]);
    expect(score.reader.byRepeat.map(row => row.arms.map(arm => arm.cases))).toEqual([[9, 9], [9, 9], [9, 9]]);
    expect(score.reader.byPersona.map(row => row.arms.map(arm => arm.cases))).toEqual([[9, 9], [9, 9], [9, 9]]);
    expect(privateObservations.reader).toHaveLength(9); expect(privateObservations.cells).toHaveLength(54);
    expect(JSON.stringify(score)).not.toContain("private-"); expect(JSON.stringify(score)).not.toContain("/fixture");
    expect(Object.isFrozen(score.reader.arms)).toBeTrue();
  });

  test("recall uses the native evidence union and excludes only empty evidence from its mean", () => {
    const data = structuredClone(fixture({ groups: [1, 1, 1] })) as Mutable<CloneMemScoreInput>;
    data.scorerRows[0]!.evidenceGroups = [["g1", "g2"], ["g2", "g3"]];
    data.scorerRows[1]!.evidenceGroups = [];
    for (const rank of data.retrieval.filter(rank => rank.questionId === data.scorerRows[0]!.questionId)) {
      rank.traceIds = rank.armId === "raw-vector" ? ["g1"] : ["g1", "g3"];
    }
    const score = scoreCloneMemStudy(data).publicSummary;
    expect(score.retrieval).toMatchObject({ questions: 3, scorableQuestions: 2, noEvidenceQuestions: 1 });
    expect(score.retrieval.arms[0]!.recallAt10).toBeCloseTo(1 / 6, 12);
    expect(score.retrieval.arms[1]!.recallAt10).toBeCloseTo(5 / 6, 12);
    expect(score.reader.arms[1]!.cases).toBe(9);
    expect(score.retrieval.comparison.paired!.clusters).toBe(2);
  });

  test("question weighting is preserved within unequal persona clusters, without treating repeats as independent", () => {
    const score = scoreCloneMemStudy(fixture({ groups: [7, 1, 1],
      answer: cell => (cell.groupId === "private-person-0") === (cell.armId === "oh-hybrid") ? "A" : "B",
      rank: (row, arm) => (row.personId === "private-person-0") === (arm === "oh-hybrid") ? row.evidenceGroups.flat() : ["wrong"] })).publicSummary;
    expect(score.reader.observedChoiceGain).toBeCloseTo(5 / 9, 12);
    expect(score.reader.comparison.paired).toMatchObject({ clusters: 3, lower: -1, upper: 1 });
    expect(score.reader.comparison).toMatchObject({ wins: 7, losses: 2, ties: 0 });
    expect(score.claims.combinedImprovement).toBeFalse();
    expect(score.retrieval.comparison.paired!.delta).toBeCloseTo(5 / 9, 12);
  });

  test("whole-choice native matching rejects prose; known failures remain zero with the fixed three-repeat denominator", () => {
    const score = scoreCloneMemStudy(fixture({ answer: cell => cell.armId === "raw-vector" ? "Answer: A" : " a\n",
      disposition: cell => cell.armId === "oh-hybrid" && cell.repeat === 1 ? "failed" : "completed" })).publicSummary;
    expect(score.matrixComplete).toBeTrue(); expect(score.allResponsesCompleted).toBeFalse();
    expect(score.reader.arms[0]!).toMatchObject({ cases: 27, correct: 0, accuracy: 0 });
    expect(score.reader.arms[1]!).toMatchObject({ cases: 27, correct: 18, accuracy: 2 / 3, dispositions: { failed: 9 } });
    expect(score.reader.arms[1]!).toMatchObject({ repeatAccuracyRange: { minimum: 0, maximum: 1 },
      retrospectiveMajorityCorrectDiagnostic: { questions: 9, correct: 9, accuracy: 1 } });
    expect(score.reader.arms[0]!.retrospectiveMajorityCorrectDiagnostic.correct).toBe(0);
    expect(score.reader.byRepeat[1]!.arms[1]!).toMatchObject({ cases: 9, correct: 0, accuracy: 0 });
    expect(score.reader.comparison.paired!.clusters).toBe(3);
  });

  test("shared physical requests score every logical cell exactly once and cannot create an arm advantage", () => {
    const data = fixture({ identicalArms: true, answer: () => "A" });
    expect(data.plan.jobs).toHaveLength(27);
    const score = scoreCloneMemStudy(data).publicSummary;
    expect(score.reader).toMatchObject({ logicalCases: 54, physicalJobs: 27, observedChoiceGain: 0 });
    expect(score.reader.arms.map(arm => arm.correct)).toEqual([27, 27]);
    expect(score.reader.comparison).toMatchObject({ wins: 0, losses: 0, ties: 9, paired: { lower: 0, upper: 0 } });
    expect(score.claims.combinedImprovement).toBeFalse();
  });

  test("an exact zero cluster difference cannot become a positive interval through thirds rounding", () => {
    const score = scoreCloneMemStudy(fixture({ groups: [2, 2, 2], answer: cell => {
      const first = cell.questionId.endsWith("-0");
      const correct = cell.armId === "oh-hybrid" ? first : cell.repeat < (first ? 2 : 1);
      return correct ? "A" : "B";
    } })).publicSummary;
    expect(score.reader.arms.map(arm => arm.accuracy)).toEqual([0.5, 0.5]);
    expect(score.reader.comparison.paired).toMatchObject({ delta: 0, lower: 0, upper: 0 });
    expect(score.reader.observedChoiceGain).toBe(0);
    expect(score.claims.multipleChoiceImprovement).toBeFalse();
  });

  test("fractional recall with a true zero bound is treated as numerical zero before the claim gate", () => {
    const data = structuredClone(fixture({ groups: [2, 2, 2] })) as Mutable<CloneMemScoreInput>;
    for (const row of data.scorerRows) row.evidenceGroups = [["g1", "g2", "g3"]];
    for (const rank of data.retrieval) {
      const first = rank.questionId.endsWith("-0");
      rank.traceIds = rank.armId === "raw-vector" ? (first ? ["g1", "g2"] : ["g1"]) : (first ? ["g1", "g2", "g3"] : []);
    }
    const score = scoreCloneMemStudy(data).publicSummary;
    expect(score.retrieval.comparison.paired).toMatchObject({ delta: 0, lower: 0, upper: 0 });
    expect(score.claims.recallAt10Improvement).toBeFalse();
    expect(score.claims.multipleChoiceImprovement).toBeTrue();
    expect(score.policy.intervalZeroTolerance).toBe(1e-12);
  });

  test("unresolved and explicitly unattempted cases cannot qualify any claim or change denominators", () => {
    for (const disposition of ["unresolved", "unattempted"] as const) {
      const score = scoreCloneMemStudy(fixture({ disposition: cell => cell.groupId === "private-person-0"
        && cell.armId === "oh-hybrid" && cell.repeat === 0 ? disposition : "completed" })).publicSummary;
      expect(score.matrixComplete).toBeFalse(); expect(score.reader.final).toBeFalse();
      expect(Object.values(score.claims).every(value => value === false)).toBeTrue();
      expect(score.reader.arms.map(arm => arm.cases)).toEqual([27, 27]);
      expect(score.reader.arms[1]!.correct).toBe(24);
      expect(score.reader.arms[1]!.dispositions[disposition]).toBe(3);
    }
  });

  test("co-primary gate requires both endpoints, positive clustered lower bounds and at least five choice percentage points", () => {
    const retrievalOnly = scoreCloneMemStudy(fixture({ answer: () => "A" })).publicSummary;
    expect(retrievalOnly.claims).toMatchObject({ recallAt10Improvement: true, multipleChoiceImprovement: false, combinedImprovement: false });
    const readerOnly = scoreCloneMemStudy(fixture({ rank: () => ["wrong"] })).publicSummary;
    expect(readerOnly.claims).toMatchObject({ recallAt10Improvement: false, multipleChoiceImprovement: true, combinedImprovement: false });
    // Each of three personas has two one-repeat wins among twenty questions: 2/60 = 3.33pp.
    const small = scoreCloneMemStudy(fixture({ groups: [20, 20, 20], answer: cell => cell.armId === "oh-hybrid"
      && cell.repeat === 0 && /private-question-[01]$/.test(cell.questionId) ? "A" : "B" })).publicSummary;
    expect(small.reader.comparison.paired!.lower).toBeGreaterThan(0);
    expect(small.reader.observedChoiceGain).toBeCloseTo(1 / 30, 12);
    expect(small.claims.multipleChoiceImprovement).toBeTrue(); expect(small.claims.combinedImprovement).toBeFalse();
    const exact = scoreCloneMemStudy(fixture({ groups: [20, 20, 20], answer: cell => cell.armId === "oh-hybrid"
      && cell.repeat === 0 && /private-question-[012]$/.test(cell.questionId) ? "A" : "B" })).publicSummary;
    expect(exact.reader.observedChoiceGain).toBe(0.05); expect(exact.claims.combinedImprovement).toBeTrue();
    const negative = scoreCloneMemStudy(fixture({ answer: cell => cell.armId === "raw-vector" ? "A" : "B" })).publicSummary;
    expect(negative.reader.comparison.paired).toMatchObject({ delta: -1, lower: -1, upper: -1 });
    expect(negative.claims.multipleChoiceImprovement).toBeFalse();
    const onePersona = scoreCloneMemStudy(fixture({ groups: [3] })).publicSummary;
    expect(onePersona.reader.comparison.paired).toBeNull(); expect(onePersona.claims.combinedImprovement).toBeFalse();
  });

  test("missing, duplicate, extra or relabeled population, rank, case, job and answer identities are rejected", () => {
    const original = fixture();
    const invalid = (change: (value: any) => void) => {
      const value = structuredClone(original); change(value); expect(() => scoreCloneMemStudy(value)).toThrow();
    };
    invalid(value => value.scorerRows.pop());
    invalid(value => value.scorerRows.push(value.scorerRows[0]));
    invalid(value => value.retrieval.pop());
    invalid(value => { value.retrieval[0] = value.retrieval[1]; });
    invalid(value => { value.retrieval[0].questionId = "foreign"; });
    invalid(value => { value.retrieval[0].armId = "foreign"; });
    invalid(value => { value.retrieval[0].traceIds = Array.from({ length: 11 }, (_, i) => `trace-${i}`); });
    invalid(value => { value.retrieval[0].traceIds = ["same", "same"]; });
    invalid(value => value.plan.cases.pop());
    invalid(value => { value.plan.cases[0] = value.plan.cases[1]; });
    invalid(value => { value.plan.cases[0].groupId = "foreign"; });
    invalid(value => { value.plan.cases[0].repeat = 3; });
    invalid(value => value.plan.jobs.push(value.plan.jobs[0]));
    invalid(value => { value.plan.questionIds[0] = value.plan.questionIds[1]; });
    invalid(value => value.answers.pop());
    invalid(value => { value.answers[0] = value.answers[1]; });
    invalid(value => { value.answers[0].jobKey = "foreign"; });
    invalid(value => { value.answers[0].answer = "forged"; });
    invalid(value => value.result.outcomes.pop());
    invalid(value => { value.result.ledger.exposureMicros++; });
    const failed = structuredClone(fixture({ disposition: () => "failed" })) as Mutable<CloneMemScoreInput>;
    failed.answers[0]!.answer = "A";
    expect(() => scoreCloneMemStudy(failed)).toThrow("noncompleted native answer");
  });

  test("keyword diagnostic is optional, must have complete coverage, and never influences primary comparisons", () => {
    const original = fixture(), without = { ...original, retrieval: original.retrieval.filter(row => row.armId !== "oh-keyword") };
    const withSummary = scoreCloneMemStudy(original).publicSummary, withoutSummary = scoreCloneMemStudy(without).publicSummary;
    expect(withSummary.retrieval.arms).toHaveLength(3); expect(withoutSummary.retrieval.arms).toHaveLength(2);
    expect(withSummary.claims).toEqual(withoutSummary.claims);
    expect(withSummary.retrieval.comparison).toEqual(withoutSummary.retrieval.comparison);
    expect(() => scoreCloneMemStudy({ ...without, retrieval: [...without.retrieval, original.retrieval.find(row => row.armId === "oh-keyword")!] })).toThrow("coverage");
  });
});
