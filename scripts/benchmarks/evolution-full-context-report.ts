/** Pure complete-release companion reduction. Callers authenticate original file
 * bytes; the shard reporter owns source/raw-response custody. No I/O here. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { evolutionPin, type EvolutionPin } from "./evolution-budget";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import { assertExactEvolutionCoverage } from "./evolution-dataset";
import type { EvolutionEvaluationScopeQuestion } from "./evolution-evaluation-scope";
import { parseEvolutionFullContextStudy, type EvolutionFullContextAuthorization } from "./evolution-full-context-study";
import { EVOLUTION_LME_NATIVE_REFERENCE } from "./evolution-judge";
import { summarizeEvolutionPairs, summarizeEvolutionScores, type EvolutionMetricCase } from "./evolution-metrics";
import { buildEvolutionReleaseReport, EVOLUTION_RELEASE_METRICS,
  type EvolutionReleaseOutcome, type EvolutionReleasePhysical, type EvolutionReleaseReportInput } from "./evolution-release-report";

export type EvolutionFullContextReportInput = Readonly<{ authorization: EvolutionFullContextAuthorization;
  parentReports: EvolutionReleaseReportInput["reports"]; reports: readonly Readonly<{ pin: EvolutionPin; report: unknown }>[] }>;
type Metric = typeof EVOLUTION_RELEASE_METRICS[number];
type Row = Record<string, unknown>;
function fail(message: string): never { throw new TypeError(`Full-context reducer: ${message}.`); }
function object(value: unknown, keys?: readonly string[]): Row {
  if (!isPlainRecord(value) || keys !== undefined && !hasExactKeys(value, keys)) fail("exact object fields required");
  for (const key of Reflect.ownKeys(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !d.enumerable || !Object.hasOwn(d, "value")) fail("data properties required");
  }
  return value;
}
function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) fail("bounded dense array required");
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, "value")) fail("data array entries required");
  }
  return value;
}
function digest(value: unknown): string { if (parseSha256Hex(value) === null) fail("SHA256 required"); return value as string; }
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > 512 || /\p{Surrogate}/u.test(value)) fail("bounded metadata text required");
  return value;
}
function uint(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail("bounded unsigned integer required");
  return value;
}
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
const tuple = (...values: readonly string[]) => JSON.stringify(values);
const baseMetric = (metric: Metric) => metric === "evidence-precision" || metric === "evidence-f1" ? "evidence-recall" : metric;
const metadata = (questions: readonly EvolutionEvaluationScopeQuestion[]): EvolutionMetricCase[] => questions.map(q => ({ id: q.id,
  groupId: q.groupId, historyId: q.historyId, category: q.category }));
const scoreRows = (rows: readonly EvolutionReleaseOutcome[], metric: Metric) => rows.map(r => ({ id: r.questionId,
  score: r.scores[metric], failed: metric === "judge-accuracy" && (r.readerFailed || r.judgeFailed) }));
const scores = (questions: readonly EvolutionEvaluationScopeQuestion[], rows: readonly EvolutionReleaseOutcome[], metric: Metric) =>
  summarizeEvolutionScores(metadata(questions), scoreRows(rows, metric), baseMetric(metric));
const pairs = (questions: readonly EvolutionEvaluationScopeQuestion[], left: readonly EvolutionReleaseOutcome[], right: readonly EvolutionReleaseOutcome[], metric: Metric) =>
  summarizeEvolutionPairs(metadata(questions), scoreRows(left, metric), scoreRows(right, metric), baseMetric(metric));
function physical(value: unknown): EvolutionReleasePhysical {
  const row = object(value, ["requestSha256", "evidenceSha256", "phase", "status", "knownUsageMicros", "unresolvedReservationMicros", "serviceMs"]);
  digest(row.requestSha256); digest(row.evidenceSha256); uint(row.unresolvedReservationMicros);
  if (row.phase !== "reader" && row.phase !== "judge" || !["verified", "captured", "reserved"].includes(String(row.status))) fail("physical phase/status");
  if (row.status === "verified") { uint(row.knownUsageMicros); if (row.unresolvedReservationMicros !== 0) fail("verified usage retains reservation"); }
  else if (row.knownUsageMicros !== null || row.unresolvedReservationMicros === 0) fail("unknown usage must retain full reservation");
  if (row.serviceMs !== null && (typeof row.serviceMs !== "number" || !Number.isFinite(row.serviceMs) || Object.is(row.serviceMs, -0)
    || row.serviceMs < 0 || row.serviceMs > 86_400_000) || row.status === "reserved" && row.serviceMs !== null) fail("service-time custody");
  return row as unknown as EvolutionReleasePhysical;
}
function cost(rows: readonly EvolutionReleasePhysical[]) {
  const known = rows.filter(r => r.status === "verified"), unknown = rows.filter(r => r.status !== "verified");
  const knownUsageMicros = uint(known.reduce((sum, r) => sum + r.knownUsageMicros!, 0));
  const unresolvedReservationMicros = uint(unknown.reduce((sum, r) => sum + r.unresolvedReservationMicros, 0));
  return { occupiedRequests: rows.length, physicalRequests: rows.filter(r => r.status !== "reserved").length,
    unknownDispatches: rows.filter(r => r.status === "reserved").length, knownUsageMicros, unresolvedReservationMicros,
    accountedMicros: uint(knownUsageMicros + unresolvedReservationMicros), usageCoverage: { knownRequests: known.length, unknownRequests: unknown.length } };
}
function latency(rows: readonly EvolutionReleasePhysical[]) {
  const physical = rows.filter(r => r.status !== "reserved"), measured = physical.map(r => r.serviceMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  return { occupiedRequests: rows.length, physicalRequests: physical.length, unknownDispatches: rows.length - physical.length,
    measuredRequests: measured.length, unmeasuredPhysicalRequests: physical.length - measured.length, totalMs: measured.reduce((sum, ms) => sum + ms, 0),
    p50Ms: measured.length ? measured[Math.ceil(measured.length * 0.5) - 1]! : null, p95Ms: measured.length ? measured[Math.ceil(measured.length * 0.95) - 1]! : null };
}
function compareCost(value: unknown, rows: readonly EvolutionReleasePhysical[]) {
  const claimed = object(value), expected = cost(rows);
  for (const key of Object.keys(expected) as (keyof typeof expected)[]) if (!same(claimed[key], expected[key])) fail("shard phase cost disagrees with evidence");
}

/** Both exact five-shard studies are required. The parent reducer is invoked
 * unchanged first; its V2 behavior and result identity are retained verbatim. */
export function buildEvolutionFullContextReport(input: EvolutionFullContextReportInput) {
  object(input, ["authorization", "parentReports", "reports"]);
  boundEvolutionCompletionWire(input.authorization, 8 * 1024 * 1024, 200_000);
  const authorization = object(input.authorization, ["study", "studySha256", "parent"]);
  const study = parseEvolutionFullContextStudy(authorization.study), studySha256 = digest(authorization.studySha256);
  const parent = buildEvolutionReleaseReport({ authorization: input.authorization.parent, reports: input.parentReports });
  const auth = input.authorization.parent, scope = auth.scope;
  if (study.parentStudyPin.sha256 !== auth.studySha256 || study.parentScopePin.sha256 !== auth.scopeFileSha256
    || !same(study.datasetPin, auth.study.datasetPin) || !same(study.manifestPin, auth.study.manifestPin)
    || study.reader !== auth.study.reader || study.judge !== auth.study.judge || study.rubricSha256 !== auth.study.rubricSha256
    || study.campaignPin.sha256 === auth.study.campaignPin.sha256 || study.campaignPin.path === auth.study.campaignPin.path) fail("companion study does not bind the parent and separate campaign");
  if (array(input.reports, 5).length !== 5) fail("all five companion shards required");
  const questions = new Map(scope.questions.map(q => [q.id, q])), seenShards = new Set<string>(), seenPins = new Set<string>();
  const allRows: EvolutionReleaseOutcome[] = [], allPhysical = new Map<string, EvolutionReleasePhysical>(), campaigns = new Set<string>();
  const reportPins: Array<{ shardId: string; reportFileSha256: string }> = []; let attributedOccurrences = 0;
  for (const entry of input.reports) {
    object(entry, ["pin", "report"]); const pin = evolutionPin(entry.pin);
    if (seenPins.has(pin.sha256)) fail("duplicate companion report pin"); seenPins.add(pin.sha256);
    boundEvolutionCompletionWire(entry.report, 16 * 1024 * 1024, 500_000);
    const report = object(entry.report, ["protocol", "status", "qualification", "dataset", "pins", "scoring", "coverage", "cost", "latency", "arms", "comparisonPolicy", "comparisons", "companion"]);
    if (report.protocol !== "oh.memory.evolution-report.v3" || report.status !== "complete") fail("complete V3 companion report required");
    const companion = object(report.companion, ["studySha256", "parentStudySha256", "parentScopeSha256", "parentScopeFileSha256", "shardId", "questionIds", "campaignSha256", "sourceSha256", "fullHistoryPolicySha256", "sourcePresentation", "outcomes", "physical"]);
    if (companion.studySha256 !== studySha256 || companion.parentStudySha256 !== auth.studySha256
      || companion.parentScopeSha256 !== scope.scopeSha256 || companion.parentScopeFileSha256 !== auth.scopeFileSha256
      || companion.sourceSha256 !== study.sourceSha256 || companion.fullHistoryPolicySha256 !== study.fullHistoryPolicySha256
      || companion.sourcePresentation !== "every-turn-input-corpus-order") fail("companion study/scope/source/policy binding");
    const shardId = text(companion.shardId), shard = scope.shards.find(s => s.id === shardId), campaign = digest(companion.campaignSha256);
    if (!shard || seenShards.has(shardId) || !same(companion.questionIds, shard.questionIds)) fail("exact one-time companion shard coverage");
    if (campaign === parent.pins.campaignSha256) fail("companion campaign aliases parent");
    seenShards.add(shardId); campaigns.add(campaign); reportPins.push({ shardId, reportFileSha256: pin.sha256 });
    const selected = shard.questionIds.map(id => questions.get(id)!);
    const dataset = object(report.dataset), pins = object(report.pins), scoring = object(report.scoring), coverage = object(report.coverage);
    if (dataset.name !== "longmemeval-s" || dataset.revision !== scope.source.revision || dataset.partition !== "full-release-descriptive"
      || dataset.selectedQuestions !== 100 || dataset.selectedCorpora !== new Set(selected.map(q => q.corpusId)).size
      || dataset.declaredGroups !== new Set(selected.map(q => q.groupId)).size || dataset.declaredHistories !== new Set(selected.map(q => q.historyId)).size
      || pins.manifestSha256 !== study.manifestPin.sha256 || pins.sourceSha256 !== study.datasetPin.sha256 || pins.rubricSha256 !== study.rubricSha256) fail("companion dataset/pin binding");
    for (const value of Object.values(pins)) digest(value);
    if (scoring.judgeProfile !== study.judge || scoring.judgeRule !== "native-contains-yes" || !same(scoring.judgeReference, EVOLUTION_LME_NATIVE_REFERENCE)
      || scoring.officialLocomoF1 !== null || scoring.evidenceUnit !== "session" || scoring.answerCitationF1 !== null) fail("companion scoring contract");
    if (coverage.logicalReaderCases !== 100 || coverage.logicalJudgeCases !== 100 || coverage.expectedQuestionsPerArm !== 100
      || coverage.completeAttemptCoverage !== true) fail("complete companion attempt denominator");
    const rows = array(companion.outcomes, 100).map(value => {
      const row = object(value, ["questionId", "variantId", "reader", "readerFailed", "judgeFailed", "scores"]);
      if (!shard.questionIds.includes(text(row.questionId)) || row.variantId !== "full-history" || row.reader !== study.reader
        || typeof row.readerFailed !== "boolean" || typeof row.judgeFailed !== "boolean" || row.readerFailed && row.judgeFailed) fail("companion outcome identity/failure");
      const values = object(row.scores, EVOLUTION_RELEASE_METRICS);
      for (const metric of EVOLUTION_RELEASE_METRICS) {
        const value = values[metric];
        if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1 || Object.is(value, -0))) fail("bounded outcome score");
        if (metric === "judge-accuracy" && value !== 0 && value !== 1 || metric === "evidence-all" && value !== null && value !== 0 && value !== 1) fail("binary answer/evidence metric");
      }
      if ((row.readerFailed || row.judgeFailed) && values["judge-accuracy"] !== 0) fail("failed answer must stay zero");
      const evidence = EVOLUTION_RELEASE_METRICS.slice(1).map(metric => values[metric]);
      if (evidence.some(v => v === null) && evidence.some(v => v !== null)) fail("evidence eligibility disagreement");
      return row as unknown as EvolutionReleaseOutcome;
    });
    assertExactEvolutionCoverage(shard.questionIds, rows.map(row => row.questionId));
    const arms = array(report.arms, 1); if (arms.length !== 1) fail("one complete-source companion arm required");
    const arm = object(arms[0]);
    if (arm.variantId !== "full-history" || arm.reader !== study.reader || arm.readerFailures !== rows.filter(r => r.readerFailed).length
      || arm.judgeFailures !== rows.filter(r => r.judgeFailed).length) fail("companion arm denominator");
    const metrics = array(arm.metrics, 5).map(value => object(value));
    assertExactEvolutionCoverage(EVOLUTION_RELEASE_METRICS, metrics.map(metric => text(metric.metric)));
    for (const metric of metrics) {
      const expected = scores(selected, rows, metric.metric as Metric);
      if (!same(metric.overall, expected.overall) || !same(metric.byCategory, expected.byCategory)) fail("companion summary disagrees with outcomes");
    }
    if (array(report.comparisons, 0).length !== 0) fail("one-arm companion cannot carry an internal comparison");
    const physicalRows = array(companion.physical, 200).map(physical);
    assertExactEvolutionCoverage(physicalRows.map(r => r.requestSha256), physicalRows.map(r => r.requestSha256));
    const reportCost = object(report.cost);
    for (const phase of ["reader", "judge"] as const) {
      const phaseRows = physicalRows.filter(r => r.phase === phase), maximum = phase === "reader" ? 100 : rows.filter(r => !r.readerFailed).length;
      if (phaseRows.length > maximum || maximum > 0 && phaseRows.length === 0) fail("companion phase coverage bounds");
      compareCost(reportCost[phase], phaseRows);
    }
    const total = cost(physicalRows);
    for (const key of ["knownUsageMicros", "unresolvedReservationMicros", "accountedMicros"] as const) if (reportCost[key] !== total[key]) fail("companion total cost disagrees with evidence");
    if (coverage.verifiedPhysicalResponses !== physicalRows.filter(r => r.status === "verified").length
      || coverage.capturedUnverifiableAttempts !== physicalRows.filter(r => r.status === "captured").length
      || coverage.unknownDispatches !== total.unknownDispatches || coverage.completePhysicalResponses !== physicalRows.every(r => r.status === "verified")) fail("companion physical coverage");
    for (const row of physicalRows) {
      const key = tuple(campaign, row.requestSha256), previous = allPhysical.get(key);
      if (previous && !same(previous, row)) fail("same-campaign first evidence changed");
      allPhysical.set(key, row);
    }
    attributedOccurrences += physicalRows.length; allRows.push(...rows);
  }
  if (campaigns.size !== 1) fail("companion shards use different campaigns");
  assertExactEvolutionCoverage(scope.shards.map(s => s.id), [...seenShards]);
  assertExactEvolutionCoverage(scope.questions.map(q => q.id), allRows.map(row => row.questionId));
  const strata = [...new Set(scope.questions.map(q => tuple(q.partition, q.exposure)))].sort().map(key => {
    const questions = scope.questions.filter(q => tuple(q.partition, q.exposure) === key), first = questions[0]!;
    return { partition: first.partition, exposure: first.exposure, questions, ids: new Set(questions.map(q => q.id)) };
  });
  const fullArm = { variantId: "full-history", reader: study.reader, readerFailures: allRows.filter(r => r.readerFailed).length,
    judgeFailures: allRows.filter(r => r.judgeFailed).length, metrics: EVOLUTION_RELEASE_METRICS.map(metric => {
      const value = scores(scope.questions, allRows, metric);
      return { metric, overall: value.overall, byCategory: value.byCategory, byExposureStratum: strata.map(group => ({
        partition: group.partition, exposure: group.exposure, ...scores(group.questions, allRows.filter(r => group.ids.has(r.questionId)), metric).overall })) };
    }) };
  // Parent rows have already passed the unchanged parent reducer. No private IDs
  // or arbitrary shard text is copied into the returned public summary.
  const parentRows = input.parentReports.flatMap(entry => (entry.report as { release: { outcomes: readonly EvolutionReleaseOutcome[] } }).release.outcomes);
  const comparisons = auth.study.variants.map(variant => {
    const left = parentRows.filter(row => row.variantId === variant.id);
    return { left: { variantId: variant.id, reader: study.reader }, right: { variantId: "full-history", reader: study.reader },
      metrics: EVOLUTION_RELEASE_METRICS.map(metric => {
        const value = pairs(scope.questions, left, allRows, metric);
        return { metric, paired: value.paired, byCategory: value.byCategory, byExposureStratum: strata.map(group => ({
          partition: group.partition, exposure: group.exposure, ...pairs(group.questions, left.filter(r => group.ids.has(r.questionId)), allRows.filter(r => group.ids.has(r.questionId)), metric).paired })) };
      }) };
  });
  const physicalRows = [...allPhysical.values()], companionCost = cost(physicalRows);
  const combined = Object.fromEntries((["occupiedRequests", "physicalRequests", "unknownDispatches", "knownUsageMicros", "unresolvedReservationMicros", "accountedMicros"] as const)
    .map(key => [key, uint(parent.cost[key] + companionCost[key])])) as Record<"occupiedRequests" | "physicalRequests" | "unknownDispatches" | "knownUsageMicros" | "unresolvedReservationMicros" | "accountedMicros", number>;
  const payload = { protocol: "oh.memory.evolution-full-context-summary.v1", status: "complete", mode: "full-release-descriptive-companion",
    design: { parentVariants: auth.study.variants, companionVariants: study.variants, reader: study.reader, judge: study.judge,
      rubricSha256: study.rubricSha256, candidatePresentation: "retrieval-order", fullContextPresentation: "every-turn-input-corpus-order" },
    scope: { ...parent.scope, logicalReaderCases: 1500, parentLogicalReaderCases: 1000, companionLogicalReaderCases: 500, companionShards: 5 },
    pins: { parentSummarySha256: parent.summarySha256, parentStudySha256: auth.studySha256, parentScopeSha256: scope.scopeSha256,
      parentScopeFileSha256: auth.scopeFileSha256, companionStudySha256: studySha256, companionCampaignFileSha256: study.campaignPin.sha256,
      companionCampaignSha256: [...campaigns][0]!, companionSourceSha256: study.sourceSha256, fullHistoryPolicySha256: study.fullHistoryPolicySha256,
      reports: reportPins.sort((a, b) => a.shardId < b.shardId ? -1 : 1), parent: parent.pins },
    arms: [...parent.arms, fullArm], parentComparison: parent.comparison, comparisons,
    cost: { combined, parent: { campaignSha256: parent.pins.campaignSha256, ...parent.cost },
      companion: { campaignSha256: [...campaigns][0]!, ...companionCost, shardAttributedOccurrences: attributedOccurrences,
        crossShardReusedOccurrences: attributedOccurrences - physicalRows.length,
        phases: (["reader", "judge"] as const).map(phase => ({ phase, ...cost(physicalRows.filter(row => row.phase === phase)) })) },
      qualification: "Deduplicate identical first evidence within each campaign. Different campaign identities are counted separately even when request hashes match; combined values are conservative attributed exposure, not newly spent money or a provider invoice." },
    latency: { parent: parent.latency, companion: { ...latency(physicalRows), phases: (["reader", "judge"] as const).map(phase => ({ phase, ...latency(physicalRows.filter(row => row.phase === phase)) })) },
      qualification: "Original distinct service times within each campaign. Cross-campaign reuse, cache-hit latency, summed wall time and end-to-end throughput are not independently identified here." },
    qualification: ["Exact500 questions in all three arms; every planned failure remains in the answer denominator at zero. Evidence eligibility is independent of answer failures.",
      "The frozen parent's BM25/semantic result is retained unchanged. The companion adds complete source history and does not amend the parent study.",
      "Original development and closed/unknown exposure strata remain disclosed. Unknown is not unseen; declared families and histories are not proven independent. No fresh confirmation, saturation or superiority claim.",
      "Native LongMemEval rubric with Gateway GPT-4o alias and adapted16-token cap; not pinned-snapshot or official protocol reproduction.",
      "Caller authenticates original study/scope/report bytes; shard reporters authenticate source and raw responses. This reducer validates ID-only outcomes, aggregate consistency and campaign-separated attribution, not raw-source custody or a logical-to-physical mapping."] };
  return freezeEvolutionCompletion({ ...payload, summarySha256: canonicalSha256(payload) });
}
