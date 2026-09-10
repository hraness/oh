import { expect, test } from "bun:test";
import { buildEvolutionFullContextReport } from "../scripts/benchmarks/evolution-full-context-report";
import { parseEvolutionFullContextStudy, EVOLUTION_FULL_CONTEXT_VARIANTS } from "../scripts/benchmarks/evolution-full-context-study";
import { EVOLUTION_FULL_HISTORY_POLICY } from "../scripts/benchmarks/evolution-full-history";
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

function companionFixture() {
  const parent = fixture(), auth = parent.authorization, scope = auth.scope;
  const study = parseEvolutionFullContextStudy({ protocol: "oh.memory.evolution-full-context-study.v1", mode: "full-release-descriptive-companion",
    parentStudyPin: { path: "/synthetic/parent-study.json", sha256: auth.studySha256 },
    parentScopePin: { path: "/synthetic/parent-scope.json", sha256: auth.scopeFileSha256 },
    datasetPin: auth.study.datasetPin, manifestPin: auth.study.manifestPin,
    campaignPin: { path: "/synthetic/companion-campaign.json", sha256: sha("companion-campaign-file") },
    sourceSha256: sha("companion-source"), fullHistoryPolicySha256: canonicalSha256(EVOLUTION_FULL_HISTORY_POLICY),
    variants: EVOLUTION_FULL_CONTEXT_VARIANTS, reader: auth.study.reader, judge: auth.study.judge, rubricSha256: auth.study.rubricSha256,
    repeatPolicy: "predeclared-full-matrix-first-attempt" });
  const authorization = { study, studySha256: sha256Hex(bytes(study)), parent: auth };
  const position = new Map(scope.questions.map((q, i) => [q.id, i]));
  const reports = parent.reports.map(entry => {
    const original = entry.report as Json, shardId = original.release.shardId;
    const selected = original.release.questionIds.map((id: string) => scope.questions.find(q => q.id === id)!);
    const cases: EvolutionMetricCase[] = selected.map((q: Json) => ({ id: q.id, groupId: q.groupId, historyId: q.historyId, category: q.category }));
    const outcomes: EvolutionReleaseOutcome[] = selected.map((q: Json) => {
      const i = position.get(q.id)!, readerFailed = i === 1 || i === 3, judgeFailed = i === 2, eligible = i % 50 !== 0;
      return { questionId: q.id, variantId: "full-history", reader: study.reader, readerFailed, judgeFailed,
        scores: { "judge-accuracy": Number(!readerFailed && !judgeFailed && i % 4 !== 0), "evidence-precision": eligible ? 0.5 : null,
          "evidence-recall": eligible ? 1 : null, "evidence-f1": eligible ? 2 / 3 : null, "evidence-all": eligible ? 1 : null } };
    });
    const physical: EvolutionReleasePhysical[] = [];
    for (const phase of ["reader", "judge"] as const) for (const [index, row] of outcomes.entries()) {
      if (phase === "judge" && row.readerFailed) continue;
      const global = position.get(row.questionId)!;
      const status = phase === "reader" && global === 1 ? "captured" : phase === "judge" && global === 2 ? "reserved" : "verified";
      // A repeated request hash exists in BOTH campaigns, with different first
      // evidence/cost. Only within-campaign duplicates may be deduplicated.
      const key = phase === "judge" && index === 0 ? "shared-judge" : `companion-${phase}-${row.questionId}`;
      physical.push({ requestSha256: sha(key), evidenceSha256: sha(`companion-evidence-${key}`), phase, status,
        knownUsageMicros: status === "verified" ? 20 : null, unresolvedReservationMicros: status === "captured" ? 50 : status === "reserved" ? 70 : 0,
        serviceMs: status === "reserved" ? null : status === "captured" ? 7 : 3 });
    }
    const readerCost = costs(physical.filter(r => r.phase === "reader")), judgeCost = costs(physical.filter(r => r.phase === "judge"));
    const { release: _release, ...common } = original;
    const report = { ...structuredClone(common), protocol: "oh.memory.evolution-report.v3",
      pins: { ...original.pins, contextPlanSha256: sha("companion-" + shardId) },
      coverage: { logicalReaderCases: 100, logicalJudgeCases: 100, expectedQuestionsPerArm: 100, completeAttemptCoverage: true,
        completePhysicalResponses: physical.every(r => r.status === "verified"), verifiedPhysicalResponses: physical.filter(r => r.status === "verified").length,
        capturedUnverifiableAttempts: physical.filter(r => r.status === "captured").length, unknownDispatches: physical.filter(r => r.status === "reserved").length },
      cost: { reader: readerCost, judge: judgeCost, knownUsageMicros: readerCost.knownUsageMicros + judgeCost.knownUsageMicros,
        unresolvedReservationMicros: readerCost.unresolvedReservationMicros + judgeCost.unresolvedReservationMicros, accountedMicros: readerCost.accountedMicros + judgeCost.accountedMicros },
      arms: [{ variantId: "full-history", reader: study.reader, readerFailures: outcomes.filter(r => r.readerFailed).length,
        judgeFailures: outcomes.filter(r => r.judgeFailed).length, latency: {}, metrics: EVOLUTION_RELEASE_METRICS.map(metric => ({
          ...summarizeEvolutionScores(cases, outcomes.map(r => ({ id: r.questionId, score: r.scores[metric], failed: metric === "judge-accuracy" && (r.readerFailed || r.judgeFailed) })),
            metric === "evidence-precision" || metric === "evidence-f1" ? "evidence-recall" : metric), metric })) }],
      comparisons: [], companion: { studySha256: authorization.studySha256, parentStudySha256: auth.studySha256,
        parentScopeSha256: scope.scopeSha256, parentScopeFileSha256: auth.scopeFileSha256,
        shardId, questionIds: original.release.questionIds, campaignSha256: sha("companion-campaign-payload"), sourceSha256: study.sourceSha256,
        fullHistoryPolicySha256: study.fullHistoryPolicySha256, sourcePresentation: "every-turn-input-corpus-order", outcomes, physical } };
    return { pin: { path: `/synthetic/companion-${shardId}.json`, sha256: canonicalSha256(report) }, report };
  });
  return { authorization, parentReports: parent.reports, reports };
}

const valid = companionFixture();
function changed(mutator: (value: Json) => void) { const value = structuredClone(valid); mutator(value); return value; }

// Each fixture validates ten synthetic100-case shard reports; repeated negative
// cases need a bounded allowance on slower CI hosts without changing assertions.
test("combines all five plus five shards into three exact500 arms while retaining parent summary identity", () => {
  const result = buildEvolutionFullContextReport(valid);
  const parent = buildEvolutionReleaseReport({ authorization: valid.authorization.parent, reports: valid.parentReports });
  expect(result.scope).toMatchObject({ releaseQuestions: 500, selectedQuestions: 500, logicalReaderCases: 1500,
    parentLogicalReaderCases: 1000, companionLogicalReaderCases: 500, shards: 5, companionShards: 5 });
  expect(result.pins.parentSummarySha256).toBe(parent.summarySha256);
  expect(result.arms.slice(0, 2)).toEqual(parent.arms);
  expect(result.parentComparison).toEqual(parent.comparison);
  const full = result.arms[2]!;
  expect(full).toMatchObject({ variantId: "full-history", readerFailures: 2, judgeFailures: 1 });
  expect(full.metrics[0]!.overall).toMatchObject({ cases: 500, scored: 500, failed: 3, mean: 372 / 500 });
  expect(full.metrics[1]!.overall).toMatchObject({ scored: 490, unscored: 10, failed: 0 });
  expect(full.metrics[0]!.byCategory.reduce((sum, group) => sum + group.cases, 0)).toBe(500);
  expect(full.metrics[0]!.byExposureStratum.reduce((sum, group) => sum + group.cases, 0)).toBe(500);
  expect(result.comparisons[0]!.metrics[0]!.paired).toMatchObject({ cases: 500, wins: 103, losses: 75, ties: 322, meanDelta: 28 / 500 });
  expect(result.comparisons[1]!.metrics[0]!.paired).toMatchObject({ cases: 500, wins: 100, losses: 25, ties: 375, meanDelta: 75 / 500 });
  expect(result.comparisons[1]!.right.variantId).toBe("full-history");
  expect(result.comparisons[1]!.metrics[1]!.paired.unscored).toBe(10);
}, 20_000);

test("deduplicates complete evidence within each campaign and never conflates identical cross-campaign request hashes", () => {
  const result = buildEvolutionFullContextReport(valid);
  expect(result.cost.companion).toMatchObject({ occupiedRequests: 994, physicalRequests: 993, unknownDispatches: 1,
    knownUsageMicros: 19840, unresolvedReservationMicros: 120, accountedMicros: 19960, crossShardReusedOccurrences: 4 });
  expect(result.cost.combined).toEqual({ occupiedRequests: 2988, physicalRequests: 2986, unknownDispatches: 2,
    knownUsageMicros: 39760, unresolvedReservationMicros: 240, accountedMicros: 40000 });
  expect(result.latency.companion).toMatchObject({ measuredRequests: 993, totalMs: 2983, p50Ms: 3, p95Ms: 3 });
  expect(result.cost.parent.campaignSha256).not.toBe(result.cost.companion.campaignSha256);
}, 20_000);

test("deterministic immutable projection contains no private IDs, text, paths or per-request rows", () => {
  const result = buildEvolutionFullContextReport(valid);
  const reverse = changed(value => { value.reports.reverse(); value.parentReports.reverse(); for (const entry of value.reports) entry.report.companion.physical.reverse(); });
  expect(buildEvolutionFullContextReport(reverse)).toEqual(result);
  expect(Object.isFrozen(result.arms[2]!.metrics)).toBe(true);
  expect(Object.isFrozen(valid.reports[0]!.report)).toBe(false);
  const wire = canonicalJson(result);
  for (const forbidden of ["synthetic-corpus", "synthetic-question", "synthetic-group", "synthetic-history", '"questionId"', '"path"',
    '"outcomes"', '"requestSha256"', '"evidenceSha256"', "Synthetic source sentinel", "Synthetic answer sentinel", "/synthetic/"]) expect(wire).not.toContain(forbidden);
  expect(wire).toContain("Unknown is not unseen");
}, 20_000);

test("missing, duplicate, foreign, partial or moved companion cases reject without manufacturing a complete report", () => {
  for (const mutate of [
    (v: Json) => v.parentReports.pop(), (v: Json) => v.reports.pop(), (v: Json) => v.reports[1] = v.reports[0],
    (v: Json) => v.reports[0].report.status = "incomplete", (v: Json) => v.reports[0].report.companion.outcomes.pop(),
    (v: Json) => v.reports[0].report.companion.questionIds.reverse(),
    (v: Json) => v.reports[0].report.companion.outcomes[0].questionId = v.reports[1].report.companion.outcomes[0].questionId,
    (v: Json) => v.reports[0].report.companion.outcomes[0].answer = "PRIVATE_SENTINEL",
    (v: Json) => v.reports[0].report.coverage.completeAttemptCoverage = false,
    (v: Json) => v.reports[0].report.companion.outcomes.push(v.reports[0].report.companion.outcomes[0]),
  ]) expect(() => buildEvolutionFullContextReport(changed(mutate))).toThrow();
}, 20_000);

test("study, parent, source, full-history, profile and separate campaign identities remain bound", () => {
  for (const mutate of [
    (v: Json) => v.authorization.study.parentStudyPin.sha256 = sha("other-study"),
    (v: Json) => v.authorization.study.campaignPin = v.authorization.parent.study.campaignPin,
    (v: Json) => v.reports[0].report.protocol = "oh.memory.evolution-report.v2",
    (v: Json) => v.reports[0].report.companion.sourceSha256 = sha("other-source"),
    (v: Json) => v.reports[0].report.companion.fullHistoryPolicySha256 = sha("other-policy"),
    (v: Json) => v.reports[0].report.companion.parentScopeFileSha256 = sha("other-scope"),
    (v: Json) => v.reports[0].report.companion.studySha256 = sha("other-study"),
    (v: Json) => v.reports[0].report.companion.sourcePresentation = "truncated",
    (v: Json) => v.reports[0].report.companion.campaignSha256 = sha("campaign-payload"),
    (v: Json) => v.reports[0].report.companion.campaignSha256 = sha("other-campaign"),
    (v: Json) => v.reports[0].report.companion.outcomes[0].reader = "gpt5-mini-reader",
    (v: Json) => v.reports[0].report.scoring.judgeRule = "strict-yes-no",
    (v: Json) => v.parentReports[0].report.arms[0].metrics[0].overall.mean = 0.99,
  ]) expect(() => buildEvolutionFullContextReport(changed(mutate))).toThrow();
}, 20_000);

test("failed and missing answers, mismatched evidence eligibility, altered summaries and physical accounting reject", () => {
  for (const mutate of [
    (v: Json) => v.reports[0].report.companion.outcomes[0].scores["judge-accuracy"] = null,
    (v: Json) => v.reports[0].report.companion.outcomes[0].scores["judge-accuracy"] = 0.5,
    (v: Json) => { const row = v.reports[0].report.companion.outcomes[0]; row.readerFailed = true; row.scores["judge-accuracy"] = 1; },
    (v: Json) => v.reports[0].report.companion.outcomes[0].scores["evidence-recall"] = 0,
    (v: Json) => v.reports[0].report.arms[0].metrics[0].overall.mean = 0.99,
    (v: Json) => v.reports[0].report.arms[0].readerFailures++,
    (v: Json) => v.reports[0].report.cost.reader.knownUsageMicros++,
    (v: Json) => v.reports[0].report.companion.physical[0].knownUsageMicros = -1,
    (v: Json) => v.reports[0].report.companion.physical[0].serviceMs = Infinity,
    (v: Json) => v.reports[0].report.companion.physical.find((r: Json) => r.status === "reserved").serviceMs = 1,
    (v: Json) => v.reports[0].report.companion.physical.find((r: Json) => r.status === "captured").knownUsageMicros = 0,
    (v: Json) => v.reports[1].report.companion.physical.find((r: Json) => r.requestSha256 === sha("shared-judge")).evidenceSha256 = sha("changed-evidence"),
    (v: Json) => v.reports[0].report.coverage.verifiedPhysicalResponses++,
  ]) expect(() => buildEvolutionFullContextReport(changed(mutate))).toThrow();
}, 20_000);

test("untrusted oversized, cyclic or accessor input fails before evaluation", () => {
  const oversized = changed(value => { value.reports[0].report.companion.outcomes = new Array(500001); });
  expect(() => buildEvolutionFullContextReport(oversized)).toThrow();
  const cycle = changed(value => { value.reports[0].report.companion.loop = value.reports[0].report; });
  expect(() => buildEvolutionFullContextReport(cycle)).toThrow();
  let reads = 0;
  const getter = changed(value => { Object.defineProperty(value.reports[0].report.companion, "physical", { enumerable: true, get() { reads++; return []; } }); });
  expect(() => buildEvolutionFullContextReport(getter)).toThrow(); expect(reads).toBe(0);
  const rootGetter = changed(value => { Object.defineProperty(value, "authorization", { enumerable: true, get() { reads++; return {}; } }); });
  expect(() => buildEvolutionFullContextReport(rootGetter)).toThrow(); expect(reads).toBe(0);
}, 20_000);
