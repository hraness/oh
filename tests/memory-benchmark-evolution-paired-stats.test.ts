import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest } from "../scripts/benchmarks/evolution-dataset";
import { EVOLUTION_STRATA, EVOLUTION_STRATUM_EVIDENCE_PREFIX, analyzeEvolutionPairs, attributeEvolutionArmCost, contentClusters, declareEvolutionStrata,
  evolutionPairedStatsSha256, exactSignTestPValue, holmAdjust, loadEvolutionQuestionMeta, loadEvolutionRunRows, normalQuantile, parseEvolutionPredictedFlips,
  seededRandom, simulateEvolutionPower, summarizeEvolutionStrata, type EvolutionPairedRow } from "../scripts/benchmarks/evolution-paired-stats";
import { EVOLUTION_STRATA_EVIDENCE, parseCompareSpec, parseEvolutionPairedStatsArgs, parsePowerRule, parseStudySpec, runEvolutionPairedStatsCli } from "../scripts/benchmarks/evolution-paired-stats-cli";

const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No provider or network in paired-stats fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });

const h = canonicalSha256, QUESTIONS = 60, DEVELOPMENT = 20;
const GOLD = "PRIVATE_GOLD_SENTINEL", QUESTION_TEXT = "PRIVATE_QUESTION_SENTINEL", ANSWER_TEXT = "PRIVATE_ANSWER_SENTINEL";
function dataset(): Dataset {
  const corpora = Array.from({ length: QUESTIONS }, (_, i) => ({ id: `c-${i}`, groupId: `g-${Math.floor(i / 2)}`,
    turns: [0, 1].map(n => ({ id: `t-${i}-${n}`, sessionId: `s-${i}-${n}`, sessionIndex: n, date: "2026-01-01", speaker: "user",
      // Even corpora pairs share their evidence session text with the next corpus so content reclustering has something to merge.
      text: n === 0 && i % 4 === 0 ? "Shared evidence text." : `Synthetic memory ${i}/${n}.` })) }));
  const questions = corpora.map((c, i) => ({ id: i < DEVELOPMENT ? `dev-${i}` : `closed-${i}`, corpusId: c.id, category: i % 3 ? "multi-session" : "temporal-reasoning",
    question: `${QUESTION_TEXT} ${i}`, questionDate: "2026-01-02", answer: GOLD, unanswerable: false, evidenceTurnIds: [c.turns[0]!.id], evidenceSessionIds: [c.turns[0]!.sessionId] }));
  return { corpora, questions };
}
function manifest(d = dataset()) {
  const groups = [...new Set(d.corpora.map(c => c.groupId))].map(groupId => {
    const index = Number(groupId.slice(2));
    return { groupId, partition: index * 2 < DEVELOPMENT ? "development" as const : "closed" as const, exposure: index * 2 < DEVELOPMENT ? "evaluated" as const : "unknown" as const, evidence: "Synthetic declaration." };
  });
  return createEvolutionDatasetManifest(d, { dataset: "longmemeval-s", revision: DATASETS["longmemeval-s"].revision, sourceSha256: DATASETS["longmemeval-s"].sha256, groups });
}
/** `readerFailed` is a captured response without an answer; `attemptFailed` is a transport-level attempt with no response entry at all. */
type Outcome = Readonly<{ correct: boolean; answer?: string; readerFailed?: boolean; attemptFailed?: boolean; judgeFailed?: boolean }>;
/** Build the four artifacts of one run directory from a per-(question, variant, reader) outcome table. */
function artifacts(m: ReturnType<typeof manifest>, arms: readonly Readonly<{ variantId: string; reader: string }>[], outcome: (runnerId: string, variantId: string, reader: string) => Outcome, manifestSha256 = h(m)) {
  const readerCases: Record<string, unknown>[] = [], readerResponses: Record<string, unknown>[] = [], readerFailures: Record<string, unknown>[] = [], judgeCases: Record<string, unknown>[] = [], judgeResponses = new Map<string, Record<string, unknown>>();
  for (const q of m.questions) for (const arm of arms) {
    const o = outcome(q.runnerId, arm.variantId, arm.reader);
    const requestSha256 = h(["reader", q.runnerId, arm.variantId, arm.reader]), contextSha256 = h(["context", q.runnerId, arm.variantId]);
    readerCases.push({ questionId: q.runnerId, variantId: arm.variantId, reader: arm.reader, contextSha256, requestSha256 });
    if (o.attemptFailed) {
      readerFailures.push({ requestSha256, profileSha256: h(["profile", arm.reader]), repeat: 0, storeStatus: "reserved", reason: "dispatch-outcome-unknown", rawSha256: null, rawBytes: null, transport: null, serviceMs: null, reservationMicros: 1_000 });
      judgeCases.push({ questionId: q.runnerId, variantId: arm.variantId, reader: arm.reader, requestSha256: null, readerFailed: true }); continue;
    }
    const answer = o.readerFailed ? null : `${ANSWER_TEXT} ${o.answer ?? (o.correct ? "right" : "wrong")}`;
    readerResponses.push({ requestSha256, response: { requestSha256, status: o.readerFailed ? "failed" : "completed", answer } });
    if (o.readerFailed) { judgeCases.push({ questionId: q.runnerId, variantId: arm.variantId, reader: arm.reader, requestSha256: null, readerFailed: true }); continue; }
    // Judge requests are shared by arms that produced the same answer for the same question, as the judge planner deduplicates them.
    const judgeSha256 = h(["judge", q.runnerId, answer]);
    judgeCases.push({ questionId: q.runnerId, variantId: arm.variantId, reader: arm.reader, requestSha256: judgeSha256, readerFailed: false });
    const verdict = { requestSha256: judgeSha256, response: { requestSha256: judgeSha256, status: o.judgeFailed ? "failed" : "completed", answer: o.judgeFailed ? null : o.correct ? `Yes, it contains ${GOLD}` : "No" } };
    if (JSON.stringify(judgeResponses.get(judgeSha256) ?? verdict) !== JSON.stringify(verdict)) throw Error("fixture: one answer text cannot carry two verdicts");
    judgeResponses.set(judgeSha256, verdict);
  }
  const readers = { protocol: "oh.memory.evolution-reader-plan.v1", manifestSha256, cases: readerCases, planSha256: h(readerCases) };
  const readersComplete = { protocol: "oh.memory.evolution-phase.v1", phase: "reader", planSha256: readers.planSha256, complete: true, responses: readerResponses, failures: readerFailures };
  const judges = { protocol: "oh.memory.evolution-judge-plan.v1", readerPlanSha256: readers.planSha256, scoringRule: "native-contains-yes", cases: judgeCases, planSha256: h(judgeCases) };
  const judgesComplete = { protocol: "oh.memory.evolution-phase.v1", phase: "judge", planSha256: judges.planSha256, complete: true, responses: [...judgeResponses.values()] };
  return { readers, readersComplete, judges, judgesComplete };
}
const CAND = { variantId: "semantic-96k", reader: "mini" }, CTRL = { variantId: "window-96k", reader: "mini" };
/** The manifest sorts questions by identifier, so fixtures address a question by the number in its identifier, not by position. */
const index = (runnerId: string, m: ReturnType<typeof manifest>) => Number(m.questions.find(q => q.runnerId === runnerId)?.id.split("-")[1]);
/** Control is right on questions 0..39; the candidate loses question 10 and wins one question in each of eight closed
 * groups; repeat r flips question 50 + r to correct for both arms, which leaves the pairing untouched but adds run noise. */
const WINS = new Set([40, 42, 44, 46, 48, 54, 56, 58]);
function threeRepeats(m: ReturnType<typeof manifest>) {
  return [0, 1, 2].flatMap(repeat => loadEvolutionRunRows(artifacts(m, [CAND, CTRL], (runnerId, variantId) => {
    const i = index(runnerId, m), noisy = i === 50 + repeat;
    const control = i < 40, candidate = (i < 40 && i !== 10) || WINS.has(i);
    const correct = (variantId === CAND.variantId ? candidate : control) !== noisy;
    return { correct, answer: noisy ? `noisy-${repeat}` : correct ? "stable-right" : "stable-wrong" };
  }), repeat));
}

describe("evolution paired statistics", () => {
  test("exact sign test, normal quantile, Holm and the seeded generator are deterministic and exact", () => {
    expect(exactSignTestPValue(39, 17)).toBeCloseTo(0.00228077, 8);
    expect(exactSignTestPValue(0, 0)).toBe(1); expect(exactSignTestPValue(5, 0)).toBe(0.03125); expect(exactSignTestPValue(43, 42)).toBeCloseTo(0.5, 1);
    expect(() => exactSignTestPValue(-1, 0)).toThrow(); expect(() => exactSignTestPValue(1.5, 0)).toThrow();
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5); expect(normalQuantile(0.5)).toBeCloseTo(0, 9); expect(normalQuantile(0.01)).toBeCloseTo(-2.326348, 5);
    expect(() => normalQuantile(0)).toThrow(); expect(() => normalQuantile(1)).toThrow();
    expect(holmAdjust([0.01, 0.02, 0.2], 0.05)).toEqual([{ adjustedP: 0.03, level: round8(0.05 / 3), rejected: true }, { adjustedP: 0.04, level: 0.025, rejected: true }, { adjustedP: 0.2, level: 0.05, rejected: false }]);
    expect(holmAdjust([0.04, 0.01], 0.05).map(x => x.rejected)).toEqual([true, true]); expect(holmAdjust([0.06, 0.01], 0.05).map(x => x.rejected)).toEqual([false, true]);
    expect(() => holmAdjust([0.5], 1)).toThrow(); expect(() => holmAdjust([2], 0.05)).toThrow();
    const a = seededRandom(17), b = seededRandom(17), first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first); expect(first.every(x => x >= 0 && x < 1)).toBe(true); expect(() => seededRandom(-1)).toThrow();
  });

  test("joins reader and judge artifacts by request digest, applies the contains-yes rule and keeps only answer digests", () => {
    const m = manifest(), rows = loadEvolutionRunRows(artifacts(m, [CAND, CTRL], (runnerId, variantId) => {
      const i = index(runnerId, m);
      return i === 0 ? { correct: false, readerFailed: variantId === CAND.variantId } : i === 1 ? { correct: false, judgeFailed: true } : { correct: i % 2 === 0 };
    }), 0);
    expect(rows.length).toBe(QUESTIONS * 2);
    const failedReader = rows.find(r => r.readerFailed), failedJudge = rows.filter(r => r.judgeFailed);
    expect(failedReader).toMatchObject({ variantId: CAND.variantId, answerSha256: null, judgeRequestSha256: null, verdict: null, judgeFailed: false });
    expect(failedJudge.length).toBe(2); expect(failedJudge.every(r => r.verdict === null && r.answerSha256 !== null)).toBe(true);
    expect(rows.filter(r => r.verdict === 1).length).toBe(58); expect(rows.filter(r => r.verdict === 0).length).toBe(2 * QUESTIONS - 58 - 3);
    const serialized = JSON.stringify(rows);
    for (const sentinel of [GOLD, QUESTION_TEXT, ANSWER_TEXT, "Synthetic memory"]) expect(serialized).not.toContain(sentinel);
    const good = artifacts(m, [CAND], () => ({ correct: true }));
    for (const mutate of [(a: any) => a.readersComplete.planSha256 = h("other"), (a: any) => a.judges.readerPlanSha256 = h("other"), (a: any) => a.judgesComplete.phase = "reader",
      (a: any) => a.readers.cases.push({ ...a.readers.cases[0] }), (a: any) => a.readers.cases[0].gold = GOLD, (a: any) => a.judges.cases[0].readerFailed = true,
      (a: any) => a.judges.scoringRule = "strict-yes-no", (a: any) => a.readersComplete.responses.pop(), (a: any) => a.judgesComplete.complete = false,
      (a: any) => a.readersComplete.responses[0].response.requestSha256 = h("other"), (a: any) => a.judges.cases.pop()]) {
      const bad = structuredClone(good); mutate(bad); expect(() => loadEvolutionRunRows(bad, 0)).toThrow();
    }
    expect(() => loadEvolutionRunRows(good, 101)).toThrow();
  });

  test("declares strata beside the V1 pin without changing partitions, and reads either pin", () => {
    const d = dataset(), m = manifest(d), pinned = loadEvolutionQuestionMeta(m);
    expect(summarizeEvolutionStrata(pinned)).toEqual([{ stratum: "closed", questions: 40, groups: 20 }, { stratum: "development", questions: 20, groups: 10 }]);
    const declared = declareEvolutionStrata(m, ["closed-20", "closed-33"], EVOLUTION_STRATA_EVIDENCE) as typeof m;
    const meta = loadEvolutionQuestionMeta(declared);
    expect(summarizeEvolutionStrata(meta)).toEqual([{ stratum: "aggregate-only-closed", questions: 36, groups: 18 }, { stratum: "development", questions: 20, groups: 10 }, { stratum: "inspected-closed", questions: 4, groups: 2 }]);
    // Inspecting one question of a pair taints its whole group: closed-21 shares closed-20's group.
    expect(meta.filter(q => q.stratum === "inspected-closed").map(q => q.id).sort()).toEqual(["closed-20", "closed-21", "closed-32", "closed-33"]);
    expect(declared.questions).toEqual(m.questions); expect(declared.corpora).toEqual(m.corpora); expect(declared.datasetSha256).toBe(m.datasetSha256);
    expect(declared.groups.map(g => g.partition)).toEqual(m.groups.map(g => g.partition));
    expect(declared.groups.filter(g => g.partition === "closed").every(g => g.exposure === "evaluated")).toBe(true);
    expect(declared.groups.every(g => EVOLUTION_STRATUM_EVIDENCE_PREFIX.test(g.evidence) && Buffer.byteLength(g.evidence) <= 4_096)).toBe(true);
    expect(new Set(declared.groups.map(g => EVOLUTION_STRATUM_EVIDENCE_PREFIX.exec(g.evidence)?.[1]))).toEqual(new Set(EVOLUTION_STRATA));
    expect(() => declareEvolutionStrata(m, ["dev-1"], EVOLUTION_STRATA_EVIDENCE)).toThrow("closed questions only");
    expect(() => declareEvolutionStrata(m, ["missing"], EVOLUTION_STRATA_EVIDENCE)).toThrow();
    expect(() => declareEvolutionStrata(m, ["closed-20", "closed-20"], EVOLUTION_STRATA_EVIDENCE)).toThrow("duplicate");
    expect(() => declareEvolutionStrata(declared, [], EVOLUTION_STRATA_EVIDENCE)).toThrow("already declares");
    for (const mutate of [(x: any) => x.groups[0].evidence = "stratum=inspected-closed; " + x.groups[0].evidence, (x: any) => { const g = x.groups.find((g: any) => g.partition === "closed"); g.evidence = "stratum=development; x"; },
      (x: any) => { const g = x.groups.find((g: any) => g.partition === "closed"); g.evidence = "stratum=sealed; x"; }, (x: any) => { const g = x.groups.find((g: any) => g.partition === "closed"); g.exposure = "unknown"; },
      (x: any) => x.questions[0].groupId = "g-999", (x: any) => x.protocol = "oh.memory-evolution.dataset.v2", (x: any) => x.questions[0].answer = GOLD]) {
      const bad = structuredClone(declared); mutate(bad); expect(() => loadEvolutionQuestionMeta(bad)).toThrow();
    }
  });

  test("analyzes repeats: per-question mean, majority-of-3, W/L/T, sign test, cluster bootstrap, Holm, slices, flips and the recoverable pool", () => {
    const d = dataset(), m = manifest(d), declared = declareEvolutionStrata(m, ["closed-20"], EVOLUTION_STRATA_EVIDENCE);
    const questions = loadEvolutionQuestionMeta(declared), rows = threeRepeats(m), reclusters = contentClusters(d);
    expect(new Set(reclusters.values()).size).toBe(46); // corpora 0, 4, ..., 56 share their evidence session text
    const predictions = parseEvolutionPredictedFlips({ protocol: "oh.memory.evolution-predicted-flips.v1", basisSha256: h("atlas"),
      predictions: [{ questionId: "dev-6", mechanism: "two-stage" }, { questionId: "closed-56", mechanism: "two-stage" }, { questionId: "dev-2", mechanism: "answer-contract" }, { questionId: "outside", mechanism: "answer-contract" }] });
    const input = { rows, questions, comparisons: [{ candidate: CAND, control: CTRL }], resamples: 2_000, seed: 7, reclusters, predictions, canaries: ["dev-6", "dev-10"] };
    const analysis = analyzeEvolutionPairs(input);
    expect(analysis.protocol).toBe("oh.memory.evolution-paired-stats.v1"); expect(analysis.questions).toBe(QUESTIONS);
    expect(analysis.strata).toEqual([{ stratum: "aggregate-only-closed", questions: 38, groups: 19 }, { stratum: "development", questions: 20, groups: 10 }, { stratum: "inspected-closed", questions: 2, groups: 1 }]);
    const [candidate, control] = analysis.arms;
    // Control: 40 right; each repeat flips exactly one control-wrong question to right: 41 per repeat, majority 40.
    expect(control).toMatchObject({ variantId: CTRL.variantId, repeats: [0, 1, 2], perRepeat: [{ repeat: 0, correct: 41 }, { repeat: 1, correct: 41 }, { repeat: 2, correct: 41 }], meanCorrect: 41, majorityCorrect: 40, sdCorrect: 0, range: [41, 41], judgeRepeatOnly: false });
    expect(control?.readerFlip).toEqual({ questionsWithDisagreement: 3, rate: 0.05, identicalAnswerAllRepeats: 57 });
    // 57 stable questions give 3 identical-answer pairs each; each noisy question keeps one identical pair between its two quiet repeats.
    expect(control?.judgeFlip).toEqual({ identicalAnswerPairs: 57 * 3 + 3, flippedPairs: 0, rate: 0 });
    expect(candidate).toMatchObject({ variantId: CAND.variantId, meanCorrect: 48, majorityCorrect: 47, meanAccuracyPoints: 80 });
    expect(candidate?.byStratum.map(s => [s.label, s.majorityCorrect])).toEqual([["aggregate-only-closed", 26], ["development", 19], ["inspected-closed", 2]]);
    const [c] = analysis.comparisons;
    expect(c).toMatchObject({ questions: QUESTIONS, repeats: { candidate: 3, control: 3 }, wins: 8, losses: 1, ties: 51, majority: { wins: 8, losses: 1, ties: 51 }, meanDeltaPoints: round4(700 / 60) });
    expect(c?.signTest).toEqual({ discordant: 9, wins: 8, oneSidedPValue: 0.01953125 });
    expect(c?.clusterBootstrap).toMatchObject({ clusters: 30, resamples: 2_000, seed: 7 });
    expect(c?.clusterBootstrap.intervalPoints[0]).toBeGreaterThan(0); expect(c?.clusterBootstrap.intervalPoints[0]).toBeLessThan(700 / 60); expect(c?.clusterBootstrap.intervalPoints[1]).toBeGreaterThan(700 / 60);
    // Content links join corpora 0, 4, ..., 56; declared pairs pull in their group mates, so 30 questions form one cluster beside 15 untouched pairs.
    expect(c?.contentReclusterBootstrap?.clusters).toBe(16);
    expect(c?.finitePopulation).toMatchObject({ poolSize: QUESTIONS, wins: 8, losses: 1, lowerBound: round6(7 / 60) });
    expect(c?.byStratum.map(s => [s.label, s.wins, s.losses, s.ties])).toEqual([["aggregate-only-closed", 8, 0, 30], ["development", 0, 1, 19], ["inspected-closed", 0, 0, 2]]);
    expect(c?.byCategory.map(s => s.label)).toEqual(["multi-session", "temporal-reasoning"]);
    expect(c?.developmentFlips).toEqual({ gained: [], lost: ["dev-10"], replicatedGains: [] });
    expect(c?.closedFlips).toEqual({ gained: 8, lost: 0 });
    expect(c?.predictedFlips).toMatchObject({ basisSha256: h("atlas"), predictedInScope: 3, predictedOutsideScope: 1, realized: 1, byMechanism: [{ mechanism: "answer-contract", predicted: 1, realized: 0 }, { mechanism: "two-stage", predicted: 2, realized: 1 }],
      unpredictedGains: 7, unpredictedGainsReplicatedInAllRepeats: 7, unpredictedLosses: 1 });
    expect(c?.predictedFlips?.precision).toBeCloseTo(1 / 3, 6); expect(c?.predictedFlips?.recall).toBeCloseTo(1 / 8, 6);
    expect(c?.holm).toMatchObject({ level: 0.025, better: true, clearlyBetter: true });
    expect(analysis.recoverablePool).toMatchObject({ questions: QUESTIONS, anyArmMajorityCorrect: 48, allArmsMajorityWrong: 12, byArm: [{ variantId: CAND.variantId, recoverableFromOtherArms: 1 }, { variantId: CTRL.variantId, recoverableFromOtherArms: 8 }] });
    expect(analysis.canaries).toEqual([{ id: "dev-6", byArm: [{ ...CAND, meanCorrect: 1 }, { ...CTRL, meanCorrect: 1 }] }, { id: "dev-10", byArm: [{ ...CAND, meanCorrect: 0 }, { ...CTRL, meanCorrect: 1 }] }]);
    // Closed identifiers, question text, gold and answers never reach the analysis; development identifiers do.
    const serialized = JSON.stringify(analysis);
    for (const sentinel of [GOLD, QUESTION_TEXT, ANSWER_TEXT, "closed-", "Synthetic memory", "Shared evidence"]) expect(serialized).not.toContain(sentinel);
    expect(serialized).toContain("dev-10");
    expect(evolutionPairedStatsSha256(analysis)).toBe(evolutionPairedStatsSha256(analyzeEvolutionPairs(input)));
    const reseeded = analyzeEvolutionPairs({ ...input, seed: 8 }).comparisons[0];
    expect(reseeded?.clusterBootstrap.seed).toBe(8); expect(reseeded?.holm.better).toBe(true); expect(reseeded?.signTest).toEqual(c?.signTest);
  });

  test("rejects context drift, incomplete repeat matrices, closed canaries and unknown arms", () => {
    const m = manifest(), questions = loadEvolutionQuestionMeta(m), rows = threeRepeats(m), base = { rows, questions, comparisons: [{ candidate: CAND, control: CTRL }], resamples: 100 };
    expect(() => analyzeEvolutionPairs({ ...base, rows: rows.slice(1) })).toThrow("incomplete repeat matrix");
    const drifted: EvolutionPairedRow[] = rows.map((r, i) => i === 0 ? { ...r, contextSha256: h("drift") } : r);
    expect(() => analyzeEvolutionPairs({ ...base, rows: drifted })).toThrow("context digest differs");
    expect(() => analyzeEvolutionPairs({ ...base, rows: [...rows, rows[0]!] })).toThrow("duplicate row");
    expect(() => analyzeEvolutionPairs({ ...base, canaries: ["closed-30"] })).toThrow("development-partition");
    expect(() => analyzeEvolutionPairs({ ...base, comparisons: [{ candidate: CAND, control: { variantId: "other", reader: "mini" } }] })).toThrow("unknown arm");
    expect(() => analyzeEvolutionPairs({ ...base, comparisons: [{ candidate: CAND, control: CAND }] })).toThrow("same arm");
    expect(() => analyzeEvolutionPairs({ ...base, alpha: 0.5 })).toThrow(); expect(() => analyzeEvolutionPairs({ ...base, resamples: 10 })).toThrow();
    expect(() => analyzeEvolutionPairs({ ...base, questions: questions.slice(1) })).toThrow("outside the manifest");
    expect(() => analyzeEvolutionPairs({ ...base, reclusters: new Map() })).toThrow("recluster map lacks");
    expect(() => parseEvolutionPredictedFlips({ protocol: "oh.memory.evolution-predicted-flips.v1", basisSha256: h("x"), predictions: [{ questionId: "a", mechanism: "m" }, { questionId: "a", mechanism: "n" }] })).toThrow("duplicate");
    expect(() => parseEvolutionPredictedFlips({ protocol: "oh.memory.evolution-predicted-flips.v2", basisSha256: h("x"), predictions: [] })).toThrow();
  });

  test("judge-only repeats are recognized: identical answers with differing verdicts count as judge flips, not reader flips", () => {
    const m = manifest(), questions = loadEvolutionQuestionMeta(m);
    const rows = [0, 1].flatMap(repeat => loadEvolutionRunRows(artifacts(m, [CTRL], runnerId => ({ correct: index(runnerId, m) % 2 === repeat, answer: "same" })), repeat));
    const arm = analyzeEvolutionPairs({ rows, questions, comparisons: [], resamples: 100 }).arms[0];
    expect(arm).toMatchObject({ judgeRepeatOnly: true, readerFlip: { questionsWithDisagreement: QUESTIONS, rate: 1, identicalAnswerAllRepeats: QUESTIONS }, judgeFlip: { identicalAnswerPairs: QUESTIONS, flippedPairs: QUESTIONS, rate: 1 } });
  });

  test("attributes cost to arms with shared judge requests split equally, counting a failed attempt's retained reservation", () => {
    const m = manifest(), a = artifacts(m, [CAND, CTRL], (runnerId, variantId) => ({ correct: true, answer: index(runnerId, m) % 2 ? "shared" : variantId }));
    const physical = physicalRows(a);
    const expected = [{ ...CAND, questions: QUESTIONS, readerMicros: 60_000, judgeMicrosShared: 4_500, totalMicros: 64_500 }, { ...CTRL, questions: QUESTIONS, readerMicros: 60_000, judgeMicrosShared: 4_500, totalMicros: 64_500 }]
      .sort((x, y) => JSON.stringify([x.variantId, x.reader]) < JSON.stringify([y.variantId, y.reader]) ? -1 : 1);
    expect(attributeEvolutionArmCost(a.readers, a.judges, physical)).toEqual(expected);
    // A reserved attempt has no known usage; its retained reservation is the accounted exposure of that arm.
    const reserved = physical.map((r, i) => i === 0 ? { ...r, status: "reserved", knownUsageMicros: null, unresolvedReservationMicros: 1_000 } : r);
    expect(attributeEvolutionArmCost(a.readers, a.judges, reserved)).toEqual(expected);
    expect(() => attributeEvolutionArmCost(a.readers, a.judges, physical.slice(1))).toThrow("lacks a physical row");
    expect(() => attributeEvolutionArmCost(a.readers, a.judges, [{ ...physical[0], extra: 1 }, ...physical.slice(1)])).toThrow("exact keys");
    expect(() => attributeEvolutionArmCost(a.readers, a.judges, [{ ...physical[0], knownUsageMicros: null }, ...physical.slice(1)])).toThrow();
  });

  test("Holm across two comparisons of one call: a comparison under alpha on its own is not better when the chain stops before it", () => {
    const m = manifest(), questions = loadEvolutionQuestionMeta(m), A = { variantId: "a-96k", reader: "mini" }, B = { variantId: "b-96k", reader: "mini" };
    // A wins questions 40 and 42, B wins 44 and 46 (two of thirty declared groups each); CAND keeps its eight wins and one loss.
    const rows = loadEvolutionRunRows(artifacts(m, [CAND, A, B, CTRL], (runnerId, variantId) => {
      const i = index(runnerId, m);
      return { correct: variantId === CAND.variantId ? (i < 40 && i !== 10) || WINS.has(i) : variantId === A.variantId ? i < 40 || i === 40 || i === 42 : variantId === B.variantId ? i < 40 || i === 44 || i === 46 : i < 40 };
    }), 0);
    const weak = analyzeEvolutionPairs({ rows, questions, comparisons: [{ candidate: A, control: CTRL }, { candidate: B, control: CTRL }], resamples: 2_000, seed: 5, alpha: 0.2 });
    // P(no winning group resampled) = (28/30)^30 is about 0.13: under alpha, above the rank-1 level alpha/2, so Holm rejects neither.
    for (const c of weak.comparisons) {
      expect(c.wins).toBe(2); expect(c.losses).toBe(0);
      expect(c.clusterBootstrap.pDeltaAtMostZero).toBeGreaterThan(0.1); expect(c.clusterBootstrap.pDeltaAtMostZero).toBeLessThanOrEqual(0.2);
      expect(c.clusterBootstrap.lowerBoundPoints).toBeGreaterThan(0);
      expect(c.holm).toMatchObject({ rejected: false, better: false, clearlyBetter: false });
    }
    // The rank-2 comparison carries level alpha and a positive lower bound at that level: the reading the chain must refuse.
    const second = weak.comparisons.find(c => c.holm.level === 0.2);
    expect(second?.holm.lowerBoundPoints).toBeGreaterThan(0); expect(second?.holm.adjustedP).toBeGreaterThan(0.2);
    // When the stronger comparison meets its stricter level the chain continues and the weaker one is decided at alpha.
    const strong = analyzeEvolutionPairs({ rows, questions, comparisons: [{ candidate: CAND, control: CTRL }, { candidate: B, control: CTRL }], resamples: 2_000, seed: 5, alpha: 0.2 });
    expect(strong.comparisons[0]?.holm).toMatchObject({ level: 0.1, rejected: true, better: true, clearlyBetter: true });
    expect(strong.comparisons[1]?.holm).toMatchObject({ level: 0.2, rejected: true, better: true, clearlyBetter: false });
  });

  test("a transport-level reader attempt failure is accepted from the failures list, scores zero and is counted", () => {
    const m = manifest(), questions = loadEvolutionQuestionMeta(m);
    const a = artifacts(m, [CAND, CTRL], (runnerId, variantId) => index(runnerId, m) === 3 && variantId === CAND.variantId ? { correct: false, attemptFailed: true } : { correct: true });
    expect(a.readersComplete.failures.length).toBe(1); expect(a.readersComplete.responses.length).toBe(2 * QUESTIONS - 1);
    const rows = loadEvolutionRunRows(a, 0), failed = rows.filter(r => r.readerFailed);
    expect(rows.length).toBe(2 * QUESTIONS); expect(failed.length).toBe(1);
    expect(failed[0]).toMatchObject({ variantId: CAND.variantId, answerSha256: null, judgeRequestSha256: null, verdict: null, readerFailed: true, judgeFailed: false });
    const analysis = analyzeEvolutionPairs({ rows, questions, comparisons: [{ candidate: CAND, control: CTRL }], resamples: 100 });
    expect(analysis.arms[0]).toMatchObject({ variantId: CAND.variantId, meanCorrect: QUESTIONS - 1, perRepeat: [{ repeat: 0, correct: QUESTIONS - 1, readerFailures: 1, judgeFailures: 0 }] });
    expect(analysis.comparisons[0]).toMatchObject({ wins: 0, losses: 1, ties: QUESTIONS - 1 });
    const failure = a.readersComplete.failures[0]!, judgeCase = a.judges.cases.find(c => c.readerFailed)!;
    for (const mutate of [
      // the judge plan says the reader did not fail, so a response is required
      (x: any) => { const c = x.judges.cases.find((c: any) => c.readerFailed); c.readerFailed = false; c.requestSha256 = x.judges.cases.find((c: any) => !c.readerFailed).requestSha256; },
      (x: any) => x.readersComplete.failures = [],
      (x: any) => delete x.readersComplete.failures,
      (x: any) => x.readersComplete.failures[0].requestSha256 = h("other"),
      (x: any) => x.readersComplete.failures[0].extra = true,
      (x: any) => x.readersComplete.failures.push({ ...failure }),
      // one request cannot be both a response and a failure
      (x: any) => x.readersComplete.responses.push({ requestSha256: failure.requestSha256, response: { requestSha256: failure.requestSha256, status: "failed", answer: null } }),
    ]) { const bad = structuredClone(a); mutate(bad); expect(() => loadEvolutionRunRows(bad, 0)).toThrow(); }
    expect(judgeCase.requestSha256).toBeNull();
  });

  test("the declared strata evidence is bounded by the V1 evidence limit after the prefix and citation are added", () => {
    const m = manifest();
    expect(() => declareEvolutionStrata(m, [], { evaluated: "e".repeat(3_000), inspected: "i", aggregateOnly: "a".repeat(3_000) })).toThrow("declared evidence");
    expect(() => declareEvolutionStrata(m, [], { evaluated: "e".repeat(3_501), inspected: "i", aggregateOnly: "a" })).toThrow("evidence");
    expect(loadEvolutionQuestionMeta(declareEvolutionStrata(m, [], { evaluated: "e".repeat(2_000), inspected: "i", aggregateOnly: "a".repeat(2_000) })).length).toBe(QUESTIONS);
  });

  test("power simulator reproduces from its seed and separates false positives from power", () => {
    const rule = { kind: "majority-gain" as const, minimumGain: 3, maximumRegressions: 2 };
    const nothing = simulateEvolutionPower({ questions: 100, repeats: 3, baseAccuracy: 0.92, trueGainPoints: 0, flipRate: 0.04, rule, simulations: 400, seed: 3 });
    const gain = simulateEvolutionPower({ questions: 100, repeats: 3, baseAccuracy: 0.92, trueGainPoints: 5, flipRate: 0.04, rule, simulations: 400, seed: 3 });
    expect(nothing.power).toBeLessThan(0.05); expect(gain.power).toBeGreaterThan(0.8); expect(gain.observedDeltaPoints.mean).toBeGreaterThan(3);
    expect(nothing).toEqual(simulateEvolutionPower({ questions: 100, repeats: 3, baseAccuracy: 0.92, trueGainPoints: 0, flipRate: 0.04, rule, simulations: 400, seed: 3 }));
    const bound = simulateEvolutionPower({ questions: 500, repeats: 3, baseAccuracy: 0.9, trueGainPoints: 0, flipRate: 0.04, rule: { kind: "mean-lower-bound", alpha: 0.025, minimumGainPoints: 0 }, simulations: 400, seed: 3 });
    expect(bound.power).toBeLessThan(0.08); expect(bound.protocol).toBe("oh.memory.evolution-power.v1");
    expect(() => simulateEvolutionPower({ questions: 100, repeats: 3, baseAccuracy: 1, trueGainPoints: 0, flipRate: 0.04, rule })).toThrow();
    expect(() => simulateEvolutionPower({ questions: 100, repeats: 3, baseAccuracy: 0.9, trueGainPoints: 0, flipRate: 0.5, rule })).toThrow();
    expect(() => simulateEvolutionPower({ questions: 100, repeats: 3, baseAccuracy: 0.9, trueGainPoints: 0, flipRate: 0.1, rule: { kind: "other" } as never })).toThrow();
  });

  test("CLI parsing is exact and the offline commands run without a provider", async () => {
    expect(parseEvolutionPairedStatsArgs(["power", "--questions", "10", "--repeats", "3", "--base-accuracy", "0.9", "--gain-points", "0", "--flip-rate", "0.04", "--rule", "majority-gain:3:2"]).command).toBe("power");
    for (const args of [[], ["rescore"], ["rescore", "--manifest", "/m", "--study", "a=/x", "--manifest", "/n"], ["power", "--questions"], ["power", "--questions", "--repeats"], ["rescore", "--manifest", "/m", "--study", "a=/x", "--bogus", "1"]])
      expect(() => parseEvolutionPairedStatsArgs(args)).toThrow();
    expect(parseStudySpec("mini=/a/one,/a/two@2")).toEqual({ label: "mini", directories: [{ directory: "/a/one", repeat: 0 }, { directory: "/a/two", repeat: 2 }] });
    for (const bad of ["=/a", "Mini=/a", "mini=relative", "mini=/a@200", "mini=/a@x"]) expect(() => parseStudySpec(bad)).toThrow();
    expect(parseCompareSpec("mini:semantic-96k/reader-a=window-96k/reader-b")).toEqual({ label: "mini", comparison: { candidate: { variantId: "semantic-96k", reader: "reader-a" }, control: { variantId: "window-96k", reader: "reader-b" } } });
    expect(() => parseCompareSpec("mini:semantic-96k=window-96k")).toThrow();
    expect(parsePowerRule("lower-bound:0.025:5")).toEqual({ kind: "mean-lower-bound", alpha: 0.025, minimumGainPoints: 5 });
    expect(() => parsePowerRule("lower-bound:0.025")).toThrow(); expect(() => parsePowerRule("majority-gain:a:b")).toThrow();
    const power = await runEvolutionPairedStatsCli(["power", "--questions", "50", "--repeats", "3", "--base-accuracy", "0.9", "--gain-points", "6", "--flip-rate", "0.04", "--rule", "majority-gain:2:2", "--simulations", "50", "--seed", "1"]);
    expect(power).toMatchObject({ protocol: "oh.memory.evolution-power.v1", questions: 50, simulations: 50, seed: 1 });
    await expect(runEvolutionPairedStatsCli(["rescore", "--manifest", "/nonexistent/manifest.json", "--study", "a=/nonexistent/run"])).rejects.toThrow();
  });

  test("CLI end to end offline: declare-strata round trip, rescore over a run directory pinned to the V1 file, cost, and the rejections", async () => {
    const root = await mkdtemp(join(await realpath(tmpdir()), "oh-paired-cli-"));
    try {
      const d = dataset(), m = manifest(d), inspected = ["closed-20", "closed-33"];
      const pinPath = join(root, "exposure.json"), pinText = JSON.stringify(m, null, 2) + "\n", pinSha256 = sha256Hex(pinText);
      await writeFile(pinPath, pinText);
      const inspectedPath = join(root, "inspected.json"), v2Path = join(root, "exposure-v2.json");
      await writeFile(inspectedPath, JSON.stringify(inspected));
      const declared = await runEvolutionPairedStatsCli(["declare-strata", "--manifest", pinPath, "--inspected", inspectedPath, "--output", v2Path]) as Record<string, unknown>;
      const v2Text = await readFile(v2Path, "utf8"), v2Sha256 = sha256Hex(v2Text);
      expect(declared).toMatchObject({ command: "declare-strata", inputManifestSha256: pinSha256, output: v2Path, sha256: v2Sha256, modelCalls: 0,
        strata: [{ stratum: "aggregate-only-closed", questions: 36, groups: 18 }, { stratum: "development", questions: 20, groups: 10 }, { stratum: "inspected-closed", questions: 4, groups: 2 }] });
      expect(JSON.parse(v2Text)).toEqual(declareEvolutionStrata(m, inspected, EVOLUTION_STRATA_EVIDENCE));
      expect((await stat(v2Path)).mode & 0o777).toBe(0o600);
      await expect(runEvolutionPairedStatsCli(["declare-strata", "--manifest", pinPath, "--inspected", inspectedPath, "--output", v2Path])).rejects.toThrow();
      // The run directory pins the V1 file by its byte digest, as the runner does; the strata manifest is analysis-only.
      const outcome = (runnerId: string, variantId: string) => { const i = index(runnerId, m); return { correct: variantId === CAND.variantId ? (i < 40 && i !== 10) || WINS.has(i) : i < 40 }; };
      const writeRun = async (name: string, a: ReturnType<typeof artifacts>, report?: unknown) => {
        const directory = join(root, name); await mkdir(directory);
        for (const [file, value] of [["readers.json", a.readers], ["readers-complete.json", a.readersComplete], ["judges.json", a.judges], ["judges-complete.json", a.judgesComplete], ...(report === undefined ? [] : [["report.json", report]])] as const)
          await writeFile(join(directory, file), JSON.stringify(value));
        return directory;
      };
      const a = artifacts(m, [CAND, CTRL], outcome, pinSha256), run = await writeRun("run", a, { protocol: "synthetic", release: { physical: physicalRows(a) } });
      const compare = `s:${CAND.variantId}/${CAND.reader}=${CTRL.variantId}/${CTRL.reader}`, out = join(root, "rescore.json");
      const args = ["rescore", "--manifest", v2Path, "--pin", pinPath, "--study", `s=${run}`, "--compare", compare, "--resamples", "200", "--seed", "3"];
      const result = await runEvolutionPairedStatsCli([...args, "--output", out]) as any;
      expect(result).toMatchObject({ protocol: "oh.memory.evolution-paired-rescore.v1", manifest: { path: v2Path, sha256: v2Sha256, acceptedPins: [v2Sha256, pinSha256].sort() }, reclustered: false, predictionsSha256: null, resamples: 200, seed: 3, alpha: 0.025, modelCalls: 0 });
      expect(result.strata).toEqual(declared.strata);
      const [study] = result.studies;
      expect(study.runs).toEqual([{ directory: run, repeat: "0", readersSha256: sha256Hex(JSON.stringify(a.readers)), readersCompleteSha256: sha256Hex(JSON.stringify(a.readersComplete)), judgesSha256: sha256Hex(JSON.stringify(a.judges)), judgesCompleteSha256: sha256Hex(JSON.stringify(a.judgesComplete)) }]);
      expect(study.analysis.arms.map((x: any) => [x.variantId, x.meanCorrect])).toEqual([[CAND.variantId, 47], [CTRL.variantId, 40]]);
      expect(study.analysis.comparisons[0]).toMatchObject({ wins: 8, losses: 1, ties: 51, holm: { level: 0.025, rejected: true, better: true, clearlyBetter: true } });
      expect(study.analysis.comparisons[0].byStratum.map((x: any) => [x.label, x.wins, x.losses])).toEqual([["aggregate-only-closed", 8, 0], ["development", 0, 1], ["inspected-closed", 0, 0]]);
      const written = await readFile(out, "utf8");
      expect(result.written).toEqual({ output: out, sha256: sha256Hex(written) }); expect((await stat(out)).mode & 0o777).toBe(0o600);
      const { written: _written, ...unwritten } = result;
      expect(JSON.parse(written)).toEqual(JSON.parse(JSON.stringify(unwritten)));
      for (const sentinel of [GOLD, QUESTION_TEXT, ANSWER_TEXT, "closed-", "Synthetic memory"]) expect(written).not.toContain(sentinel);
      expect(written).toContain("dev-10");
      await expect(runEvolutionPairedStatsCli([...args, "--output", out])).rejects.toThrow();
      // Without the pin, a run pinned to the V1 file is refused; with a foreign manifest digest it is refused either way.
      await expect(runEvolutionPairedStatsCli(["rescore", "--manifest", v2Path, "--study", `s=${run}`])).rejects.toThrow("pins a manifest other than");
      const foreign = await writeRun("foreign", artifacts(m, [CAND, CTRL], outcome, h("other")));
      await expect(runEvolutionPairedStatsCli(["rescore", "--manifest", v2Path, "--pin", pinPath, "--study", `s=${foreign}`])).rejects.toThrow("pins a manifest other than");
      // A pin whose partitions differ from the strata manifest is refused before any run is read.
      const drifted = structuredClone(m) as any, driftedPath = join(root, "exposure-drifted.json");
      drifted.questions[0].partition = "development"; // closed-20 sorts first; its group stays closed in the strata manifest
      await writeFile(driftedPath, JSON.stringify(drifted));
      await expect(runEvolutionPairedStatsCli(["rescore", "--manifest", v2Path, "--pin", driftedPath, "--study", `s=${run}`])).rejects.toThrow("different questions or partitions");
      // The dataset gate accepts only the pinned source bytes.
      const datasetPath = join(root, "dataset.json"); await writeFile(datasetPath, JSON.stringify(d));
      await expect(runEvolutionPairedStatsCli([...args, "--dataset", datasetPath])).rejects.toThrow("dataset bytes do not match");
      await expect(runEvolutionPairedStatsCli([...args, "--compare", "t:a/b=c/d"])).rejects.toThrow("unknown study");
      // Cost attribution over the same directory from its report ledger.
      const cost = await runEvolutionPairedStatsCli(["cost", "--study", `s=${run}`]) as any;
      expect(cost).toMatchObject({ protocol: "oh.memory.evolution-paired-cost.v1", modelCalls: 0 });
      // 51 agreeing questions share one judge request (50 micros each side); the 9 discordant ones pay 100 each: 3,450 per arm.
      expect(cost.studies[0].arms).toEqual([
        { ...CAND, questions: QUESTIONS, correct: 47, readerMicros: 60_000, judgeMicrosShared: 3_450, totalMicros: 63_450, usdPerQuestion: round6(0.06345 / 60), usdPerCorrect: round6(0.06345 / 47) },
        { ...CTRL, questions: QUESTIONS, correct: 40, readerMicros: 60_000, judgeMicrosShared: 3_450, totalMicros: 63_450, usdPerQuestion: round6(0.06345 / 60), usdPerCorrect: round6(0.06345 / 40) }]);
      await expect(runEvolutionPairedStatsCli(["cost", "--study", `s=${foreign}`])).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
/** A release report's physical ledger for the fixture: 1,000 micros per reader request, 100 per judge request, all verified. */
function physicalRows(a: ReturnType<typeof artifacts>) {
  return [...a.readersComplete.responses.map(r => ({ requestSha256: r.requestSha256 as string, evidenceSha256: h(r), phase: "reader", status: "verified", knownUsageMicros: 1_000, unresolvedReservationMicros: 0, serviceMs: 1 })),
    ...a.judgesComplete.responses.map(r => ({ requestSha256: r.requestSha256 as string, evidenceSha256: h(r), phase: "judge", status: "verified", knownUsageMicros: 100, unresolvedReservationMicros: 0, serviceMs: 1 }))];
}
function round8(v: number) { return Number(v.toFixed(8)); }
function round4(v: number) { return Number(v.toFixed(4)); }
function round6(v: number) { return Number(v.toFixed(6)); }
