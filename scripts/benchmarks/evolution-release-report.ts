/** Pure full-release reducer. Caller authenticates study/scope and report-file bytes
 * before invoking this function. No source, answer, raw-response, store or provider I/O.
 * Shard reporter custody binds outcomes to responses; these ID-only rows cannot
 * independently reconstruct that relationship or establish source freshness. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import { evolutionPin, type EvolutionPin } from "./evolution-budget";
import { assertExactEvolutionCoverage } from "./evolution-dataset";
import type { EvolutionEvaluationScopeQuestion } from "./evolution-evaluation-scope";
import { EVOLUTION_LME_NATIVE_REFERENCE } from "./evolution-judge";
import { summarizeEvolutionScores, summarizeEvolutionPairs, type EvolutionMetricCase, type EvolutionScore } from "./evolution-metrics";
import { EVOLUTION_PROFILES } from "./evolution-model";
import { parseEvolutionReleaseStudy, type EvolutionReleaseAuthorization } from "./evolution-release";

export const EVOLUTION_RELEASE_REPORT_PROTOCOL = "oh.memory.evolution-release-summary.v1" as const;
export const EVOLUTION_RELEASE_METRICS = ["judge-accuracy", "evidence-precision", "evidence-recall", "evidence-f1", "evidence-all"] as const;
type Metric = typeof EVOLUTION_RELEASE_METRICS[number];
export type EvolutionReleaseOutcome = Readonly<{ questionId: string; variantId: string; reader: string; readerFailed: boolean; judgeFailed: boolean;
  scores: Readonly<Record<Metric, number | null>> }>;
export type EvolutionReleasePhysical = Readonly<{ requestSha256: string; evidenceSha256: string; phase: "reader" | "judge";
  status: "verified" | "captured" | "reserved"; knownUsageMicros: number | null; unresolvedReservationMicros: number; serviceMs: number | null }>;
export type EvolutionReleaseReportInput = Readonly<{ authorization: EvolutionReleaseAuthorization;
  reports: readonly Readonly<{ pin: EvolutionPin; report: unknown }>[] }>;
type Row = Record<string, unknown>;
function fail(message: string): never { throw new TypeError(`Evolution release reducer: ${message}.`); }
function object(value: unknown, keys?: readonly string[]): Row {
  if (!isPlainRecord(value) || keys !== undefined && !hasExactKeys(value, keys)) fail("exact object fields required");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail("plain data properties required");
  }
  return value;
}
function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) fail("bounded dense array required");
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("plain dense array values required");
  }
  return value;
}
function digest(value: unknown): string { if (parseSha256Hex(value) === null) fail("SHA256 required"); return value as string; }
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > 512 || /\p{Surrogate}/u.test(value)) fail("bounded metadata text required");
  return value;
}
function uint(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0) || value > maximum) fail("bounded unsigned integer required");
  return value;
}
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
const tuple = (...values: readonly string[]) => JSON.stringify(values);
const baseMetric = (metric: Metric) => metric === "evidence-precision" || metric === "evidence-f1" ? "evidence-recall" : metric;
const metadata = (questions: readonly EvolutionEvaluationScopeQuestion[]): EvolutionMetricCase[] => questions.map(q => ({ id: q.id,
  groupId: q.groupId, historyId: q.historyId, category: q.category }));
function scoreRows(rows: readonly EvolutionReleaseOutcome[], metric: Metric): EvolutionScore[] {
  return rows.map(r => ({ id: r.questionId, score: r.scores[metric], failed: metric === "judge-accuracy" && (r.readerFailed || r.judgeFailed) }));
}
function scores(questions: readonly EvolutionEvaluationScopeQuestion[], rows: readonly EvolutionReleaseOutcome[], metric: Metric) {
  return summarizeEvolutionScores(metadata(questions), scoreRows(rows, metric), baseMetric(metric));
}
function pairs(questions: readonly EvolutionEvaluationScopeQuestion[], candidate: readonly EvolutionReleaseOutcome[], control: readonly EvolutionReleaseOutcome[], metric: Metric) {
  return summarizeEvolutionPairs(metadata(questions), scoreRows(candidate, metric), scoreRows(control, metric), baseMetric(metric));
}
function strata(questions: readonly EvolutionEvaluationScopeQuestion[]) {
  return [...new Set(questions.map(q => tuple(q.partition, q.exposure)))].sort().map(key => {
    const subset = questions.filter(q => tuple(q.partition, q.exposure) === key), first = subset[0]!;
    return { partition: first.partition, exposure: first.exposure, questions: subset };
  });
}
function authorization(value: EvolutionReleaseAuthorization) {
  boundEvolutionCompletionWire(value, 8 * 1024 * 1024, 200_000);
  const a = object(value, ["study", "studySha256", "scope", "scopeFileSha256"]), study = parseEvolutionReleaseStudy(a.study);
  digest(a.studySha256); digest(a.scopeFileSha256);
  const s = object(a.scope, ["protocol", "mode", "manifestSha256", "source", "datasetMetadataSha256", "eligibilityAuditSha256", "design",
    "maximumQuestionsPerShard", "questions", "shards", "coverage", "strata", "failurePolicy", "qualification", "scopeSha256"]);
  const { scopeSha256, ...payload } = s;
  if (s.protocol !== "oh.memory.evaluation-scope.v1" || s.mode !== "full-release-descriptive" || s.eligibilityAuditSha256 !== null
    || s.maximumQuestionsPerShard !== 100 || canonicalSha256(payload) !== digest(scopeSha256)
    || s.manifestSha256 !== study.manifestPin.sha256) fail("authorized full-release scope identity");
  const source = object(s.source, ["dataset", "revision", "sourceSha256"]);
  if (source.dataset !== study.dataset || source.sourceSha256 !== study.datasetPin.sha256) fail("scope source binding");
  text(source.revision); digest(s.datasetMetadataSha256);
  const expectedDesign = { experimentSpecSha256: a.studySha256,
    candidate: { id: study.variants[1]!.id, specSha256: canonicalSha256({ variant: study.variants[1], presentation: study.candidatePresentation }) },
    controls: [{ id: study.variants[0]!.id, specSha256: canonicalSha256({ variant: study.variants[0], presentation: "retrieval-order" }) }],
    readers: [{ id: study.reader, specSha256: canonicalSha256(EVOLUTION_PROFILES[study.reader]) }],
    judge: { id: study.judge, specSha256: canonicalSha256(EVOLUTION_PROFILES[study.judge]) }, rubricSha256: study.rubricSha256 };
  if (!same(s.design, expectedDesign)) fail("scope design differs from fixed study");
  if (array(s.questions, 500).length !== 500 || array(s.shards, 5).length !== 5) fail("all five full100 shards required");
  const scope = value.scope, questions = scope.questions;
  const byGroup = new Map<string, string>(), byHistory = new Map<string, string>(), byCluster = new Map<string, string>();
  for (const q of questions) {
    object(q, ["id", "corpusId", "groupId", "historyId", "clusterId", "category", "partition", "exposure", "questionContentSha256", "corpusContentSha256"]);
    for (const t of [q.id, q.corpusId, q.groupId, q.historyId, q.clusterId, q.category]) text(t);
    if (!["single-session-user", "single-session-assistant", "single-session-preference", "multi-session", "knowledge-update", "temporal-reasoning"].includes(q.category)) fail("official LongMemEval category required");
    digest(q.questionContentSha256); digest(q.corpusContentSha256);
    if (!["development", "search-validation", "sealed", "closed"].includes(q.partition)
      || !["unseen", "development", "evaluated", "unknown"].includes(q.exposure) || q.partition === "sealed" && q.exposure !== "unseen") fail("invalid exposure declaration");
    const disposition = tuple(q.partition, q.exposure);
    for (const [map, key, status] of [[byGroup, q.groupId, disposition], [byHistory, q.historyId, q.partition], [byCluster, q.clusterId, q.partition]] as const) {
      const old = map.get(key); if (old !== undefined && old !== status) fail("declared cluster disposition disagreement"); map.set(key, status);
    }
  }
  assertExactEvolutionCoverage(questions.map(q => q.id), questions.map(q => q.id));
  const byQuestion = new Map(questions.map(q => [q.id, q])), covered: string[] = [], clusterShard = new Map<string, string>();
  const groupShard = new Map<string, string>(), historyShard = new Map<string, string>();
  for (const [index, shard] of scope.shards.entries()) {
    object(shard, ["id", "questionIds", "questionIdsSha256"]);
    if (shard.id !== `shard-${String(index + 1).padStart(3, "0")}` || array(shard.questionIds, 100).length !== 100
      || canonicalSha256(shard.questionIds) !== digest(shard.questionIdsSha256)) fail("fixed shard ID/coverage identity");
    for (const id of shard.questionIds) {
      const q = byQuestion.get(text(id)); if (!q) fail("unknown shard question");
      for (const [map, key] of [[clusterShard, q.clusterId], [groupShard, q.groupId], [historyShard, q.historyId]] as const) {
        const prior = map.get(key); if (prior !== undefined && prior !== shard.id) fail("declared family/history cluster crosses shards");
        map.set(key, shard.id);
      }
      covered.push(id);
    }
  }
  assertExactEvolutionCoverage(questions.map(q => q.id), covered);
  const coverage = { releaseQuestions: 500, selectedQuestions: 500, declaredGroups: byGroup.size, declaredHistories: byHistory.size,
    connectedDeclaredClusters: byCluster.size, logicalReaderCases: 1000 };
  const expectedStrata = strata(questions).map(s => ({ partition: s.partition, exposure: s.exposure, questions: s.questions.length,
    groups: new Set(s.questions.map(q => q.groupId)).size }));
  if (!same(s.coverage, coverage) || !same(s.strata, expectedStrata)
    || s.failurePolicy !== "all-planned-questions;reader-failure-zero;judge-failure-zero-separate;unadmitted-incomplete;first-attempt-only"
    || s.qualification !== "Metadata custody only; declared clusters are not proven independent; unknown exposure is not unseen. Referenced experiment and eligibility documents require separate authentication.") fail("scope coverage/disclosure drift");
  return { study, scope, studySha256: value.studySha256, scopeFileSha256: value.scopeFileSha256 };
}
function physical(value: unknown): EvolutionReleasePhysical {
  const row = object(value, ["requestSha256", "evidenceSha256", "phase", "status", "knownUsageMicros", "unresolvedReservationMicros", "serviceMs"]);
  digest(row.requestSha256); digest(row.evidenceSha256);
  if (row.phase !== "reader" && row.phase !== "judge" || !["verified", "captured", "reserved"].includes(String(row.status))) fail("physical phase/status");
  uint(row.unresolvedReservationMicros);
  if (row.status === "verified") {
    uint(row.knownUsageMicros); if (row.unresolvedReservationMicros !== 0) fail("verified usage retains reservation");
  } else if (row.knownUsageMicros !== null || row.unresolvedReservationMicros === 0) fail("unknown usage must retain full positive reservation");
  if (row.serviceMs !== null && (typeof row.serviceMs !== "number" || !Number.isFinite(row.serviceMs) || Object.is(row.serviceMs, -0)
    || row.serviceMs < 0 || row.serviceMs > 86_400_000)) fail("bounded service duration");
  if (row.status === "reserved" && row.serviceMs !== null) fail("unknown dispatch has no measured service time");
  return row as unknown as EvolutionReleasePhysical;
}
function physicalCost(rows: readonly EvolutionReleasePhysical[]) {
  const known = rows.filter(r => r.status === "verified"), unknown = rows.filter(r => r.status !== "verified");
  const knownUsageMicros = uint(known.reduce((sum, r) => sum + r.knownUsageMicros!, 0)), unresolvedReservationMicros = uint(unknown.reduce((sum, r) => sum + r.unresolvedReservationMicros, 0));
  return { occupiedRequests: rows.length, physicalRequests: rows.filter(r => r.status !== "reserved").length,
    unknownDispatches: rows.filter(r => r.status === "reserved").length, knownUsageMicros, unresolvedReservationMicros,
    accountedMicros: uint(knownUsageMicros + unresolvedReservationMicros), usageCoverage: { knownRequests: known.length, unknownRequests: unknown.length } };
}
function physicalLatency(rows: readonly EvolutionReleasePhysical[]) {
  const physical = rows.filter(r => r.status !== "reserved"), measured = physical.map(r => r.serviceMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  return { occupiedRequests: rows.length, physicalRequests: physical.length, unknownDispatches: rows.length - physical.length,
    measuredRequests: measured.length, unmeasuredPhysicalRequests: physical.length - measured.length, totalMs: measured.reduce((sum, ms) => sum + ms, 0),
    p50Ms: measured.length ? measured[Math.ceil(measured.length * 0.5) - 1]! : null, p95Ms: measured.length ? measured[Math.ceil(measured.length * 0.95) - 1]! : null };
}
function validateCost(reportCost: unknown, rows: readonly EvolutionReleasePhysical[]) {
  const cost = object(reportCost), expected = physicalCost(rows);
  for (const key of ["occupiedRequests", "physicalRequests", "unknownDispatches", "knownUsageMicros", "unresolvedReservationMicros", "accountedMicros", "usageCoverage"] as const)
    if (!same(cost[key], expected[key])) fail("shard cost/physical evidence disagreement");
}
function validateSummary(value: unknown, expected: ReturnType<typeof scores>) {
  const m = object(value);
  if (!same(m.overall, expected.overall) || !same(m.byCategory, expected.byCategory)) fail("shard metric summary disagrees with outcomes");
}

/** Requires all five authenticated report objects. No partial full-release summary
 * is returned. File pins name original bytes; caller must verify those bytes first. */
export function buildEvolutionReleaseReport(input: EvolutionReleaseReportInput) {
  object(input, ["authorization", "reports"]);
  const auth = authorization(input.authorization), { study, scope } = auth;
  if (array(input.reports, 5).length !== 5) fail("all five shard reports required");
  const variants = study.variants.map(v => v.id), questions = new Map(scope.questions.map(q => [q.id, q]));
  const allOutcomes: EvolutionReleaseOutcome[] = [], allPhysical = new Map<string, EvolutionReleasePhysical>(), seenShards = new Set<string>(), seenPins = new Set<string>();
  const reportPins: Array<{ shardId: string; reportFileSha256: string }> = [], campaignIds = new Set<string>();
  let attributedOccurrences = 0;
  for (const entry of input.reports) {
    object(entry, ["pin", "report"]); const pin = evolutionPin(entry.pin);
    if (seenPins.has(pin.sha256)) fail("duplicate report file pin"); seenPins.add(pin.sha256);
    boundEvolutionCompletionWire(entry.report, 16 * 1024 * 1024, 500_000);
    const report = object(entry.report, ["protocol", "status", "qualification", "dataset", "pins", "scoring", "coverage", "cost", "latency", "arms", "comparisonPolicy", "comparisons", "release"]);
    if (report.protocol !== "oh.memory.evolution-report.v2" || report.status !== "complete") fail("complete V2 shard report required");
    const release = object(report.release, ["studySha256", "scopeSha256", "scopeFileSha256", "shardId", "questionIds", "campaignSha256", "retrievalSourceSha256", "candidatePresentation", "outcomes", "physical"]);
    if (release.studySha256 !== auth.studySha256 || release.scopeSha256 !== scope.scopeSha256 || release.scopeFileSha256 !== auth.scopeFileSha256
      || release.retrievalSourceSha256 !== study.retrievalSourceSha256 || release.candidatePresentation !== "retrieval-order") fail("shard study/scope/source binding");
    const shardId = text(release.shardId), shard = scope.shards.find(s => s.id === shardId);
    if (!shard || seenShards.has(shardId) || !same(release.questionIds, shard.questionIds)) fail("missing/duplicate shard or question coverage");
    seenShards.add(shardId); campaignIds.add(digest(release.campaignSha256)); reportPins.push({ shardId, reportFileSha256: pin.sha256 });
    const selected = shard.questionIds.map(id => questions.get(id)!);
    const dataset = object(report.dataset), pins = object(report.pins), scoring = object(report.scoring), coverage = object(report.coverage);
    if (dataset.name !== study.dataset || dataset.revision !== scope.source.revision || dataset.partition !== "full-release-descriptive"
      || dataset.selectedQuestions !== 100 || dataset.selectedCorpora !== new Set(selected.map(q => q.corpusId)).size
      || dataset.declaredGroups !== new Set(selected.map(q => q.groupId)).size || dataset.declaredHistories !== new Set(selected.map(q => q.historyId)).size
      || pins.manifestSha256 !== study.manifestPin.sha256 || pins.sourceSha256 !== study.datasetPin.sha256 || pins.rubricSha256 !== study.rubricSha256) fail("shard dataset metadata/pins");
    for (const v of Object.values(pins)) digest(v);
    if (scoring.judgeProfile !== study.judge || scoring.judgeRule !== "native-contains-yes" || !same(scoring.judgeReference, EVOLUTION_LME_NATIVE_REFERENCE)
      || scoring.officialLocomoF1 !== null || scoring.evidenceUnit !== "session" || scoring.answerCitationF1 !== null) fail("fixed native16 scoring contract");
    if (coverage.logicalReaderCases !== 200 || coverage.logicalJudgeCases !== 200 || coverage.expectedQuestionsPerArm !== 100 || coverage.completeAttemptCoverage !== true) fail("all planned logical cases required");
    const rows = array(release.outcomes, 200).map(value => {
      const r = object(value, ["questionId", "variantId", "reader", "readerFailed", "judgeFailed", "scores"]);
      if (!shard.questionIds.includes(text(r.questionId)) || !variants.includes(text(r.variantId)) || r.reader !== study.reader
        || typeof r.readerFailed !== "boolean" || typeof r.judgeFailed !== "boolean" || r.readerFailed && r.judgeFailed) fail("outcome matrix/reader/failure binding");
      const values = object(r.scores, EVOLUTION_RELEASE_METRICS);
      for (const metric of EVOLUTION_RELEASE_METRICS) {
        const score = values[metric];
        if (score !== null && (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1 || Object.is(score, -0))) fail("bounded metric score");
        if (metric === "judge-accuracy" && score !== 0 && score !== 1 || metric === "evidence-all" && score !== null && score !== 0 && score !== 1) fail("binary metric eligibility");
      }
      if ((r.readerFailed || r.judgeFailed) && values["judge-accuracy"] !== 0) fail("failed answer must remain zero");
      const evidence = EVOLUTION_RELEASE_METRICS.slice(1).map(m => values[m]);
      if (evidence.some(v => v === null) && evidence.some(v => v !== null)) fail("evidence metrics disagree on eligibility");
      return r as unknown as EvolutionReleaseOutcome;
    });
    assertExactEvolutionCoverage(shard.questionIds.flatMap(q => variants.map(v => tuple(q, v, study.reader))), rows.map(r => tuple(r.questionId, r.variantId, r.reader)));
    const arms = array(report.arms, 2).map(v => object(v));
    assertExactEvolutionCoverage(variants, arms.map(a => text(a.variantId)));
    for (const arm of arms) {
      const armRows = rows.filter(r => r.variantId === arm.variantId);
      if (arm.reader !== study.reader || arm.readerFailures !== armRows.filter(r => r.readerFailed).length
        || arm.judgeFailures !== armRows.filter(r => r.judgeFailed).length) fail("shard arm failure denominator");
      const metrics = array(arm.metrics, 5).map(v => object(v));
      assertExactEvolutionCoverage(EVOLUTION_RELEASE_METRICS, metrics.map(m => text(m.metric)));
      for (const m of metrics) validateSummary(m, scores(selected, armRows, m.metric as Metric));
    }
    const comparisons = array(report.comparisons, 1); if (comparisons.length !== 1) fail("single fixed paired comparison required");
    const comparison = object(comparisons[0]);
    if (comparison.kind !== "retrieval" || !same(comparison.left, { variantId: variants[1], reader: study.reader })
      || !same(comparison.right, { variantId: variants[0], reader: study.reader })) fail("paired comparison orientation");
    const pairedMetrics = array(comparison.metrics, 5).map(v => object(v));
    assertExactEvolutionCoverage(EVOLUTION_RELEASE_METRICS, pairedMetrics.map(m => text(m.metric)));
    for (const m of pairedMetrics) {
      const expected = pairs(selected, rows.filter(r => r.variantId === variants[1]), rows.filter(r => r.variantId === variants[0]), m.metric as Metric);
      if (!same(m.paired, expected.paired) || !same(m.byCategory, expected.byCategory)) fail("shard paired metrics disagree with outcomes");
    }
    const physicalRows = array(release.physical, 400).map(physical);
    assertExactEvolutionCoverage(physicalRows.map(r => r.requestSha256), physicalRows.map(r => r.requestSha256));
    for (const phase of ["reader", "judge"] as const) {
      const phaseRows = physicalRows.filter(r => r.phase === phase);
      const maximum = phase === "reader" ? 200 : rows.filter(r => !r.readerFailed).length;
      if (phaseRows.length > maximum || maximum > 0 && phaseRows.length === 0) fail("phase physical/logical coverage bounds");
      validateCost(object(report.cost)[phase], phaseRows);
    }
    const totals = physicalCost(physicalRows), cost = object(report.cost);
    for (const k of ["knownUsageMicros", "unresolvedReservationMicros", "accountedMicros"] as const) if (cost[k] !== totals[k]) fail("total cost differs from phase evidence");
    if (coverage.verifiedPhysicalResponses !== physicalRows.filter(r => r.status === "verified").length
      || coverage.capturedUnverifiableAttempts !== physicalRows.filter(r => r.status === "captured").length
      || coverage.unknownDispatches !== totals.unknownDispatches
      || coverage.completePhysicalResponses !== physicalRows.every(r => r.status === "verified")) fail("physical coverage counts");
    for (const r of physicalRows) {
      const previous = allPhysical.get(r.requestSha256);
      if (previous && !same(previous, r)) fail("duplicate physical request has changed first evidence, phase, usage or service time");
      allPhysical.set(r.requestSha256, r);
    }
    attributedOccurrences += physicalRows.length; allOutcomes.push(...rows);
  }
  if (campaignIds.size !== 1) fail("shards use different campaigns");
  assertExactEvolutionCoverage(scope.shards.map(s => s.id), [...seenShards]);
  assertExactEvolutionCoverage(scope.questions.flatMap(q => variants.map(v => tuple(q.id, v, study.reader))), allOutcomes.map(r => tuple(r.questionId, r.variantId, r.reader)));
  const exposureStrata = strata(scope.questions);
  const arms = variants.map(variantId => {
    const rows = allOutcomes.filter(r => r.variantId === variantId);
    return { variantId, reader: study.reader, readerFailures: rows.filter(r => r.readerFailed).length, judgeFailures: rows.filter(r => r.judgeFailed).length,
      metrics: EVOLUTION_RELEASE_METRICS.map(metric => {
        const s = scores(scope.questions, rows, metric);
        return { metric, overall: s.overall, byCategory: s.byCategory, byExposureStratum: exposureStrata.map(group => {
          const ids = new Set(group.questions.map(q => q.id));
          return { partition: group.partition, exposure: group.exposure, ...scores(group.questions, rows.filter(r => ids.has(r.questionId)), metric).overall };
        }) };
      }) };
  });
  const comparisons = EVOLUTION_RELEASE_METRICS.map(metric => {
    const left = allOutcomes.filter(r => r.variantId === variants[1]), right = allOutcomes.filter(r => r.variantId === variants[0]);
    const s = pairs(scope.questions, left, right, metric);
    return { metric, paired: s.paired, byCategory: s.byCategory, byExposureStratum: exposureStrata.map(group => {
      const ids = new Set(group.questions.map(q => q.id));
      return { partition: group.partition, exposure: group.exposure, ...pairs(group.questions, left.filter(r => ids.has(r.questionId)), right.filter(r => ids.has(r.questionId)), metric).paired };
    }) };
  });
  const physicalRows = [...allPhysical.values()], total = physicalCost(physicalRows);
  const payload = { protocol: EVOLUTION_RELEASE_REPORT_PROTOCOL, status: "complete" as const, mode: "full-release-descriptive" as const,
    design: { variants: study.variants, reader: study.reader, judge: study.judge, rubricSha256: study.rubricSha256, candidatePresentation: study.candidatePresentation },
    scope: { ...scope.coverage, shards: 5, strata: scope.strata },
    pins: { studySha256: auth.studySha256, scopeSha256: scope.scopeSha256, scopeFileSha256: auth.scopeFileSha256,
      manifestSha256: study.manifestPin.sha256, sourceSha256: study.datasetPin.sha256, campaignFileSha256: study.campaignPin.sha256,
      campaignSha256: [...campaignIds][0]!, retrievalSourceSha256: study.retrievalSourceSha256,
      reports: reportPins.sort((a, b) => a.shardId < b.shardId ? -1 : 1) },
    arms, comparison: { candidateVariantId: variants[1]!, controlVariantId: variants[0]!, reader: study.reader, metrics: comparisons },
    cost: { ...total, shardAttributedOccurrences: attributedOccurrences, crossShardReusedOccurrences: attributedOccurrences - physicalRows.length,
      phases: (["reader", "judge"] as const).map(phase => ({ phase, ...physicalCost(physicalRows.filter(r => r.phase === phase)) })),
      qualification: "Each distinct request is counted once across shards only when its complete first-evidence projection is identical. Known usage plus unresolved full reservations is conservative attributed exposure, not incremental campaign spending or a provider invoice." },
    latency: { ...physicalLatency(physicalRows), phases: (["reader", "judge"] as const).map(phase => ({ phase, ...physicalLatency(physicalRows.filter(r => r.phase === phase)) })),
      qualification: "Distinct original physical service durations, including reused captures. No summed wall-time, cache-hit latency or end-to-end throughput claim." },
    qualification: ["Full500 descriptive coverage with the original exposure dispositions. Prior adaptive development and unknown exposure remain disclosed; unknown does not mean unseen.",
      "Every planned question remains in each arm; reader and judge failures are separate and score zero. Evidence eligibility remains independent of answer failure; unlabeled evidence is unscored.",
      "Declared families, histories and clusters are not proven independent. These paired/category/exposure summaries do not establish fresh confirmation, statistical superiority or benchmark saturation.",
      "Native LongMemEval rubric and contains-yes decision with Gateway GPT-4o alias and16-token cap. Not pinned-snapshot or official protocol reproduction.",
      "Caller authenticates original study/scope/report file bytes. Shard reporter authenticates source and raw responses. This pure reducer checks the ID-only projection and aggregate consistency; it does not independently map outcomes to physical responses or reauthenticate raw/source bytes."] };
  return freezeEvolutionCompletion({ ...payload, summarySha256: canonicalSha256(payload) });
}
