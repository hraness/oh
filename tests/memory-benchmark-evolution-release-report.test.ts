import { expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest } from "../scripts/benchmarks/evolution-dataset";
import { makeEvolutionReleaseScope, validateEvolutionReleaseArtifacts, EVOLUTION_RELEASE_READER, EVOLUTION_RELEASE_JUDGE, EVOLUTION_RELEASE_RUBRIC_SHA } from "../scripts/benchmarks/evolution-release";
import { buildEvolutionReleaseReport, EVOLUTION_RELEASE_METRICS, type EvolutionReleaseOutcome, type EvolutionReleasePhysical, type EvolutionReleaseReportInput } from "../scripts/benchmarks/evolution-release-report";
import { summarizeEvolutionScores, summarizeEvolutionPairs, type EvolutionMetricCase } from "../scripts/benchmarks/evolution-metrics";
import { EVOLUTION_LME_NATIVE_REFERENCE } from "../scripts/benchmarks/evolution-judge";

const sha = (text: string) => sha256Hex(text), bytes = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
const variants = [{ id: "window-96k", system: "bm25-window", budget: { topK: 100, contextBytes: 96000 } },
  { id: "oh-semantic-top100-96k-v1", system: "oh-semantic", budget: { topK: 100, contextBytes: 96000 } }] as const;
type Json = any;
function costs(rows: readonly EvolutionReleasePhysical[]) {
  const verified = rows.filter(r => r.status === "verified"), unknown = rows.filter(r => r.status !== "verified");
  const knownUsageMicros = verified.reduce((n, r) => n + r.knownUsageMicros!, 0), unresolvedReservationMicros = unknown.reduce((n, r) => n + r.unresolvedReservationMicros, 0);
  return { occupiedRequests: rows.length, physicalRequests: rows.filter(r => r.status !== "reserved").length,
    unknownDispatches: rows.filter(r => r.status === "reserved").length, knownUsageMicros, unresolvedReservationMicros, accountedMicros: knownUsageMicros + unresolvedReservationMicros,
    usageCoverage: { knownRequests: verified.length, unknownRequests: unknown.length } };
}
function fixture(): EvolutionReleaseReportInput {
  // Entire fixture is fabricated, including all500 source IDs/text and labels.
  // Only projected metadata enters the reducer; it has no source/dataset I/O.
  const corpora = Array.from({ length: 500 }, (_, i) => ({ id: `synthetic-corpus-${i}`, groupId: `synthetic-group-${i}`,
    turns: [{ id: `synthetic-turn-${i}`, sessionId: `synthetic-session-${i}`, date: "2026-01-01", speaker: "user", text: "Synthetic source sentinel." }] }));
  const dataset: Dataset = { corpora, questions: corpora.map((c, i) => ({ id: `synthetic-question-${i}`, corpusId: c.id, question: "Synthetic question?", questionDate: "2026-01-02",
    answer: "Synthetic answer sentinel", category: i % 2 ? "multi-session" : "single-session-user", unanswerable: false,
    evidenceTurnIds: [], evidenceSessionIds: [] })) };
  const manifest = createEvolutionDatasetManifest(dataset, { dataset: "longmemeval-s", revision: DATASETS["longmemeval-s"].revision,
    sourceSha256: DATASETS["longmemeval-s"].sha256,
    groups: corpora.map((c, i) => ({ groupId: c.groupId, partition: i < 100 ? "development" as const : "closed" as const,
      exposure: i < 100 ? "evaluated" as const : "unknown" as const, evidence: "Synthetic metadata fixture." })),
    histories: corpora.map((c, i) => ({ corpusId: c.id, historyId: `synthetic-history-${i}` })) });
  const manifestBytes = bytes(manifest), study = { protocol: "oh.memory.evolution-release-study.v1", mode: "full-release-descriptive", dataset: "longmemeval-s",
    datasetPin: { path: "/synthetic/source.json", sha256: DATASETS["longmemeval-s"].sha256 }, manifestPin: { path: "/synthetic/manifest.json", sha256: sha256Hex(manifestBytes) },
    campaignPin: { path: "/synthetic/campaign.json", sha256: sha("campaign-file") }, retrievalSourceSha256: sha("execution-source"), variants,
    reader: EVOLUTION_RELEASE_READER, judge: EVOLUTION_RELEASE_JUDGE, rubricSha256: EVOLUTION_RELEASE_RUBRIC_SHA,
    candidatePresentation: "retrieval-order", repeatPolicy: "predeclared-full-matrix-first-attempt" };
  const studyBytes = bytes(study), scope = makeEvolutionReleaseScope(studyBytes, manifestBytes);
  const authorization = validateEvolutionReleaseArtifacts({ studyBytes, manifestBytes, scopeBytes: bytes(scope) });
  const position = new Map(scope.questions.map((q, i) => [q.id, i]));
  const reports = scope.shards.map(shard => {
    const selected = shard.questionIds.map(id => scope.questions.find(q => q.id === id)!);
    const metricCases: EvolutionMetricCase[] = selected.map(q => ({ id: q.id, groupId: q.groupId, historyId: q.historyId, category: q.category }));
    const outcomes: EvolutionReleaseOutcome[] = variants.flatMap((v, arm) => selected.map(q => {
      const i = position.get(q.id)!, readerFailed = arm === 1 && (i === 1 || i === 3), judgeFailed = arm === 1 && i === 2, eligible = i % 50 !== 0;
      return { questionId: q.id, variantId: v.id, reader: EVOLUTION_RELEASE_READER, readerFailed, judgeFailed,
        scores: { "judge-accuracy": Number(!readerFailed && !judgeFailed && (arm === 0 ? i % 5 !== 0 : i % 10 !== 0)),
          "evidence-precision": eligible ? 1 : null, "evidence-recall": eligible ? (arm === 0 ? 0.5 : 1) : null,
          "evidence-f1": eligible ? (arm === 0 ? 2 / 3 : 1) : null, "evidence-all": eligible ? arm : null } };
    }));
    const rawScores = (v: string, metric: typeof EVOLUTION_RELEASE_METRICS[number]) => outcomes.filter(r => r.variantId === v).map(r => ({ id: r.questionId,
      score: r.scores[metric], failed: metric === "judge-accuracy" && (r.readerFailed || r.judgeFailed) }));
    const base = (m: typeof EVOLUTION_RELEASE_METRICS[number]) => m === "evidence-precision" || m === "evidence-f1" ? "evidence-recall" : m;
    const arms = variants.map(v => ({ variantId: v.id, reader: EVOLUTION_RELEASE_READER,
      readerFailures: outcomes.filter(r => r.variantId === v.id && r.readerFailed).length, judgeFailures: outcomes.filter(r => r.variantId === v.id && r.judgeFailed).length,
      latency: {}, metrics: EVOLUTION_RELEASE_METRICS.map(metric => ({ ...summarizeEvolutionScores(metricCases, rawScores(v.id, metric), base(metric)), metric })) }));
    const comparisons = [{ kind: "retrieval", left: { variantId: variants[1].id, reader: EVOLUTION_RELEASE_READER }, right: { variantId: variants[0].id, reader: EVOLUTION_RELEASE_READER },
      metrics: EVOLUTION_RELEASE_METRICS.map(metric => { const p = summarizeEvolutionPairs(metricCases, rawScores(variants[1].id, metric), rawScores(variants[0].id, metric), base(metric));
        return { metric, paired: p.paired, byCategory: p.byCategory, byGroup: p.byGroup, byHistory: p.byHistory, qualification: p.qualification }; }) }];
    const physical: EvolutionReleasePhysical[] = [];
    for (const phase of ["reader", "judge"] as const) for (const [index, row] of outcomes.entries()) {
      if (phase === "judge" && row.readerFailed) continue;
      const global = position.get(row.questionId)!, candidate = row.variantId === variants[1].id;
      const status = phase === "reader" && candidate && global === 1 ? "captured" : phase === "judge" && candidate && global === 2 ? "reserved" : "verified";
      // One identical judge request is reused by every shard. Different lexical
      // request IDs carry independently authenticated evidence elsewhere.
      const key = phase === "judge" && index === 0 ? "shared-judge" : `${phase}-${row.questionId}-${row.variantId}`;
      physical.push({ requestSha256: sha(key), evidenceSha256: sha(`evidence-${key}`), phase, status,
        knownUsageMicros: status === "verified" ? 10 : null, unresolvedReservationMicros: status === "captured" ? 50 : status === "reserved" ? 70 : 0,
        serviceMs: status === "reserved" ? null : status === "captured" ? 5 : 2 });
    }
    const readerCost = costs(physical.filter(r => r.phase === "reader")), judgeCost = costs(physical.filter(r => r.phase === "judge"));
    const report = { protocol: "oh.memory.evolution-report.v2", status: "complete", qualification: "Synthetic shard fixture.",
      dataset: { name: "longmemeval-s", revision: DATASETS["longmemeval-s"].revision, partition: "full-release-descriptive", selectedQuestions: 100,
        selectedCorpora: selected.length, declaredGroups: selected.length, declaredHistories: selected.length },
      pins: { manifestSha256: study.manifestPin.sha256, sourceSha256: study.datasetPin.sha256, selectedDatasetSha256: sha(shard.id + "metadata"),
        contextPlanSha256: sha(shard.id + "context"), readerPlanSha256: sha(shard.id + "readers"), readerOutputSha256: sha(shard.id + "reader-output"),
        judgePlanSha256: sha(shard.id + "judges"), judgeOutputSha256: sha(shard.id + "judge-output"), rubricSha256: EVOLUTION_RELEASE_RUBRIC_SHA },
      scoring: { judgeProfile: EVOLUTION_RELEASE_JUDGE, judgeRule: "native-contains-yes", judgeReference: EVOLUTION_LME_NATIVE_REFERENCE,
        officialLocomoF1: null, evidenceUnit: "session", answerCitationF1: null },
      coverage: { logicalReaderCases: 200, logicalJudgeCases: 200, expectedQuestionsPerArm: 100, completeAttemptCoverage: true,
        completePhysicalResponses: physical.every(r => r.status === "verified"), verifiedPhysicalResponses: physical.filter(r => r.status === "verified").length,
        capturedUnverifiableAttempts: physical.filter(r => r.status === "captured").length, unknownDispatches: physical.filter(r => r.status === "reserved").length },
      cost: { reader: readerCost, judge: judgeCost, knownUsageMicros: readerCost.knownUsageMicros + judgeCost.knownUsageMicros,
        unresolvedReservationMicros: readerCost.unresolvedReservationMicros + judgeCost.unresolvedReservationMicros, accountedMicros: readerCost.accountedMicros + judgeCost.accountedMicros },
      latency: {}, arms, comparisonPolicy: "Left minus right.", comparisons,
      release: { studySha256: authorization.studySha256, scopeSha256: scope.scopeSha256, scopeFileSha256: authorization.scopeFileSha256,
        shardId: shard.id, questionIds: shard.questionIds, campaignSha256: sha("campaign-payload"), retrievalSourceSha256: study.retrievalSourceSha256,
        candidatePresentation: "retrieval-order", outcomes, physical } };
    return { pin: { path: `/synthetic/${shard.id}.json`, sha256: canonicalSha256(report) }, report };
  });
  return { authorization, reports };
}
// One canonical synthetic base keeps focused checks small and independent of I/O.
const valid = fixture();
function changed(mutator: (value: Json) => void) { const value = structuredClone(valid); mutator(value); return value; }
function resealScope(value: Json) { const { scopeSha256: _old, ...payload } = value.authorization.scope; value.authorization.scope.scopeSha256 = canonicalSha256(payload); }
test("reduces all500 exact cases, preserves exposure/categories and failures and deduplicates cross-shard first evidence", () => {
  const result = buildEvolutionReleaseReport(valid);
  expect(result.scope).toMatchObject({ releaseQuestions: 500, selectedQuestions: 500, logicalReaderCases: 1000, shards: 5 });
  expect(result.scope.strata).toEqual([{ partition: "closed", exposure: "unknown", questions: 400, groups: 400 }, { partition: "development", exposure: "evaluated", questions: 100, groups: 100 }]);
  const control = result.arms[0]!, candidate = result.arms[1]!, accuracy = candidate.metrics[0]!;
  expect(control.metrics[0]!.overall.mean).toBe(0.8); expect(accuracy.overall.mean).toBe(447 / 500);
  expect(candidate.readerFailures).toBe(2); expect(candidate.judgeFailures).toBe(1); expect(accuracy.overall.failed).toBe(3);
  expect(accuracy.byExposureStratum.reduce((sum, s) => sum + s.cases, 0)).toBe(500);
  expect(accuracy.byCategory.reduce((sum, s) => sum + s.cases, 0)).toBe(500);
  expect(candidate.metrics[1]!.overall).toMatchObject({ scored: 490, unscored: 10, failed: 0, mean: 1 });
  expect(result.comparison.metrics[0]!.paired).toMatchObject({ cases: 500, wins: 50, losses: 3, ties: 447, meanDelta: 47 / 500 });
  expect(result.comparison.metrics[1]!.paired.unscored).toBe(10);
  expect(result.cost).toMatchObject({ occupiedRequests: 1994, physicalRequests: 1993, knownUsageMicros: 19920, unresolvedReservationMicros: 120,
    accountedMicros: 20040, unknownDispatches: 1, crossShardReusedOccurrences: 4, usageCoverage: { knownRequests: 1992, unknownRequests: 2 } });
  expect(result.latency).toMatchObject({ measuredRequests: 1993, totalMs: 3989, p50Ms: 2, p95Ms: 2 });
  expect(Object.isFrozen(result.arms)).toBe(true);
  const raw = canonicalJson(result);
  for (const forbidden of ["synthetic-corpus", "synthetic-question", "synthetic-group", "synthetic-history", '"questionId"', '"path"', '"outcomes"', '"requestSha256"', '"evidenceSha256"', "Synthetic source sentinel", "Synthetic answer sentinel", "/synthetic/"]) expect(raw).not.toContain(forbidden);
  expect(raw).toContain("unknown does not mean unseen");
});
test("output is deterministic under report/physical input order and does not mutate caller rows", () => {
  const reversed = changed(v => { v.reports.reverse(); for (const r of v.reports) r.report.release.physical.reverse(); });
  expect(buildEvolutionReleaseReport(reversed)).toEqual(buildEvolutionReleaseReport(valid));
  expect(Object.isFrozen(valid.reports[0]!.report)).toBe(false);
});
test("missing, duplicate, partial, foreign and cross-shard outcome coverage fail closed", () => {
  for (const mutate of [
    (v: Json) => v.reports.pop(), (v: Json) => v.reports[1] = v.reports[0], (v: Json) => v.reports[0].report.status = "incomplete",
    (v: Json) => v.reports[0].report.release.outcomes.pop(), (v: Json) => v.reports[0].report.release.outcomes.push(v.reports[0].report.release.outcomes[0]),
    (v: Json) => v.reports[0].report.release.outcomes[0].questionId = v.reports[1].report.release.outcomes[0].questionId,
    (v: Json) => v.reports[0].report.release.questionIds.reverse(), (v: Json) => v.reports[0].report.coverage.completeAttemptCoverage = false,
    (v: Json) => v.reports[0].report.release.outcomes[0].answer = "PRIVATE_SENTINEL",
  ]) expect(() => buildEvolutionReleaseReport(changed(mutate))).toThrow();
});
test("protocol, fixed design, presentation, model, source, campaign and exposure scope remain bound", () => {
  for (const mutate of [
    (v: Json) => v.reports[0].report.protocol = "oh.memory.evolution-report.v1",
    (v: Json) => v.reports[0].report.release.studySha256 = sha("other-study"), (v: Json) => v.reports[0].report.release.scopeFileSha256 = sha("other-scope"),
    (v: Json) => v.reports[0].report.release.retrievalSourceSha256 = sha("other-source"), (v: Json) => v.reports[0].report.release.campaignSha256 = sha("other-campaign"),
    (v: Json) => v.reports[0].report.release.candidatePresentation = "corpus-order", (v: Json) => v.reports[0].report.release.outcomes[0].reader = "gpt5-mini-reader",
    (v: Json) => v.reports[0].report.scoring.judgeRule = "strict-yes-no", (v: Json) => v.reports[0].report.pins.rubricSha256 = sha("other-rubric"),
    (v: Json) => v.authorization.study.variants.reverse(), (v: Json) => v.authorization.scope.questions[0].exposure = "unseen",
    (v: Json) => { v.authorization.scope.strata[0].exposure = "unseen"; resealScope(v); },
    (v: Json) => { v.authorization.scope.shards[0].questionIds.pop(); resealScope(v); },
  ]) expect(() => buildEvolutionReleaseReport(changed(mutate))).toThrow();
});
test("missing/null answer scores, fractional binary scores, failed nonzero scores, altered summaries and eligibility fail", () => {
  for (const mutate of [
    (v: Json) => v.reports[0].report.release.outcomes[0].scores["judge-accuracy"] = null,
    (v: Json) => v.reports[0].report.release.outcomes[0].scores["judge-accuracy"] = 0.5,
    (v: Json) => v.reports[0].report.release.outcomes[0].scores["evidence-all"] = 0.5,
    (v: Json) => { v.reports[0].report.release.outcomes[0].readerFailed = true; v.reports[0].report.release.outcomes[0].scores["judge-accuracy"] = 1; },
    (v: Json) => v.reports[0].report.release.outcomes[0].scores["evidence-recall"] = 1,
    (v: Json) => v.reports[0].report.arms[0].metrics[0].overall.mean = 0.999,
    (v: Json) => v.reports[0].report.comparisons[0].metrics[0].paired.wins++,
    (v: Json) => v.reports[0].report.arms[1].judgeFailures++,
  ]) expect(() => buildEvolutionReleaseReport(changed(mutate))).toThrow();
});
test("conflicting duplicate physical evidence and malformed usage/unknown dispatch/service custody are rejected", () => {
  for (const mutate of [
    (v: Json) => v.reports[1].report.release.physical.find((p: Json) => p.requestSha256 === sha("shared-judge")).evidenceSha256 = sha("changed-first-evidence"),
    (v: Json) => v.reports[1].report.release.physical.find((p: Json) => p.requestSha256 === sha("shared-judge")).serviceMs = 3,
    (v: Json) => v.reports[0].report.release.physical.push(v.reports[0].report.release.physical[0]),
    (v: Json) => v.reports[0].report.release.physical[0].knownUsageMicros = -1,
    (v: Json) => v.reports[0].report.release.physical[0].knownUsageMicros = 0.001,
    (v: Json) => v.reports[0].report.release.physical[0].knownUsageMicros = Number.MAX_SAFE_INTEGER + 1,
    (v: Json) => v.reports[0].report.release.physical[0].serviceMs = Infinity,
    (v: Json) => v.reports[0].report.release.physical.find((p: Json) => p.status === "reserved").serviceMs = 10,
    (v: Json) => v.reports[0].report.release.physical.find((p: Json) => p.status === "captured").knownUsageMicros = 0,
    (v: Json) => v.reports[0].report.release.physical.find((p: Json) => p.status === "reserved").unresolvedReservationMicros = 0,
    (v: Json) => v.reports[0].report.cost.reader.knownUsageMicros++,
    (v: Json) => v.reports[0].report.coverage.capturedUnverifiableAttempts = 0,
  ]) expect(() => buildEvolutionReleaseReport(changed(mutate))).toThrow();
});
test("oversized or accessor/cyclic wire shapes reject before hashing", () => {
  const cyclic = changed(v => { v.reports[0].report.release.loop = v.reports[0].report.release; });
  expect(() => buildEvolutionReleaseReport(cyclic)).toThrow();
  const oversized = changed(v => v.reports[0].report.release.outcomes = Array(500001));
  expect(() => buildEvolutionReleaseReport(oversized)).toThrow();
  let reads = 0; const getters = changed(v => Object.defineProperty(v.reports[0].report.release, "physical", { get() { reads++; return []; }, enumerable: true }));
  expect(() => buildEvolutionReleaseReport(getters)).toThrow(); expect(reads).toBe(0);
  const rootGetter = changed(v => Object.defineProperty(v, "authorization", { get() { reads++; return {}; }, enumerable: true }));
  expect(() => buildEvolutionReleaseReport(rootGetter)).toThrow(); expect(reads).toBe(0);
  const entryGetter = changed(v => Object.defineProperty(v.reports, "0", { get() { reads++; return {}; }, enumerable: true }));
  expect(() => buildEvolutionReleaseReport(entryGetter)).toThrow(); expect(reads).toBe(0);
});
test("resealed declarations cannot split the same family or history across shards under different cluster labels", () => {
  for (const key of ["groupId", "historyId"] as const) {
    const malformed = changed(v => {
      const scope = v.authorization.scope;
      const candidates = scope.shards.map((shard: Json) => scope.questions.filter((q: Json) => shard.questionIds.includes(q.id) && q.partition === "closed"));
      const nonempty = candidates.filter((questions: Json[]) => questions.length > 0);
      nonempty[1][0][key] = nonempty[0][0][key];
      resealScope(v);
    });
    expect(() => buildEvolutionReleaseReport(malformed)).toThrow("declared family/history cluster crosses shards");
  }
});
