/** Pure V9 study reducer. The caller authenticates study/scope and shard report-file bytes before invoking it.
 * No source, answer, raw-response, store or provider I/O. Shard reporters bind outcomes to responses; these ID-only
 * rows cannot independently reconstruct that relationship or establish source freshness. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import { evolutionPin, type EvolutionPin } from "./evolution-budget";
import { assertExactEvolutionCoverage } from "./evolution-dataset";
import type { EvolutionEvaluationScopeQuestion } from "./evolution-evaluation-scope";
import { EVOLUTION_LOCOMO_CATEGORY_NAMES, EVOLUTION_LOCOMO_JUDGE_PROFILE_ID } from "./evolution-locomo-judge";
import { summarizeEvolutionPairs, summarizeEvolutionScores, type EvolutionMetricCase, type EvolutionScore } from "./evolution-metrics";
import { EVOLUTION_REPORT_V9_PROTOCOL, type EvolutionOutcomeV9, type EvolutionPhysicalV9 } from "./evolution-report-v9";
import { evolutionJobKey } from "./evolution-reader-plan-v2";
import type { EvolutionStudyV9Authorization } from "./evolution-study-v9";

export const EVOLUTION_STUDY_V9_REPORT_PROTOCOL = "oh.memory.evolution-study-summary.v9" as const;
export const EVOLUTION_STUDY_V9_METRICS = ["judge-mean", "locomo-f1", "evidence-recall", "evidence-all"] as const;
type Metric = typeof EVOLUTION_STUDY_V9_METRICS[number];
export type EvolutionStudyV9ReportInput = Readonly<{ authorization: EvolutionStudyV9Authorization; reports: readonly Readonly<{ pin: EvolutionPin; report: unknown }>[] }>;
type Row = Record<string, unknown>;
function fail(message: string): never { throw new TypeError(`Evolution study V9 reducer: ${message}.`); }
function object(value: unknown, keys?: readonly string[]): Row {
  if (!isPlainRecord(value) || keys !== undefined && !hasExactKeys(value, keys)) fail("exact object fields required");
  return value;
}
function array(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) fail("bounded array required");
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
function unit(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1 || Object.is(value, -0)) fail("bounded unit score required");
  return value;
}
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
const tuple = (...values: readonly (string | number)[]) => JSON.stringify(values);
const metadata = (questions: readonly EvolutionEvaluationScopeQuestion[]): EvolutionMetricCase[] => questions.map(q => ({ id: q.id, groupId: q.groupId, historyId: q.historyId, category: q.category }));
/** Per-question rows for one arm: the mean over reader repeats of each repeat's own judge mean, F1 or evidence value. */
function questionScores(rows: readonly EvolutionOutcomeV9[], questionIds: readonly string[], metric: Metric): EvolutionScore[] {
  const byQuestion = new Map<string, EvolutionOutcomeV9[]>();
  for (const r of rows) { const list = byQuestion.get(r.questionId) ?? []; list.push(r); byQuestion.set(r.questionId, list); }
  return questionIds.map(id => {
    const repeats = byQuestion.get(id) ?? [];
    if (repeats.length === 0) fail("outcome row missing for a scope question");
    const values = repeats.map(r => metric === "judge-mean" ? r.judgeMean : metric === "locomo-f1" ? r.locomoF1 : metric === "evidence-recall" ? r.evidence.recall : r.evidence.all);
    if (values.some(v => v === null) !== values.every(v => v === null)) fail("repeat rows disagree on metric eligibility");
    const score = values[0] === null ? null : (values as number[]).reduce((sum, v) => sum + v, 0) / values.length;
    return { id, score, failed: metric === "judge-mean" && repeats.every(r => r.decisions.every(d => d === null)) };
  });
}
function cellScores(rows: readonly EvolutionOutcomeV9[], questionIds: readonly string[], repeat: number, judgeRepeat: number): EvolutionScore[] {
  const byQuestion = new Map(rows.filter(r => r.repeat === repeat).map(r => [r.questionId, r]));
  return questionIds.map(id => { const r = byQuestion.get(id); if (!r) fail("outcome row missing for a repeat cell");
    const decision = r.decisions[judgeRepeat]; if (decision === undefined) fail("judge repeat outside the declared count");
    return { id, score: decision ?? 0, failed: decision === null }; });
}
function strata(questions: readonly EvolutionEvaluationScopeQuestion[]) {
  return [...new Set(questions.map(q => tuple(q.partition, q.exposure)))].sort().map(key => {
    const subset = questions.filter(q => tuple(q.partition, q.exposure) === key), first = subset[0]!;
    return { partition: first.partition, exposure: first.exposure, questions: subset };
  });
}
function physical(value: unknown): EvolutionPhysicalV9 {
  const row = object(value, ["requestSha256", "repeat", "evidenceSha256", "phase", "status", "knownUsageMicros", "unresolvedReservationMicros", "serviceMs"]);
  digest(row.requestSha256); digest(row.evidenceSha256); uint(row.repeat, 2);
  if (row.phase !== "reader" && row.phase !== "judge" || !["verified", "captured", "reserved"].includes(String(row.status))) fail("physical phase/status");
  uint(row.unresolvedReservationMicros);
  if (row.status === "verified") { uint(row.knownUsageMicros); if (row.unresolvedReservationMicros !== 0) fail("verified usage retains reservation"); }
  else if (row.knownUsageMicros !== null || row.unresolvedReservationMicros === 0) fail("unknown usage must retain full positive reservation");
  if (row.serviceMs !== null && (typeof row.serviceMs !== "number" || !Number.isFinite(row.serviceMs) || Object.is(row.serviceMs, -0) || row.serviceMs < 0 || row.serviceMs > 86_400_000)) fail("bounded service duration");
  if (row.status === "reserved" && row.serviceMs !== null) fail("unknown dispatch has no measured service time");
  return row as unknown as EvolutionPhysicalV9;
}
function physicalCost(rows: readonly EvolutionPhysicalV9[]) {
  const known = rows.filter(r => r.status === "verified"), unknown = rows.filter(r => r.status !== "verified");
  const knownUsageMicros = uint(known.reduce((sum, r) => sum + r.knownUsageMicros!, 0)), unresolvedReservationMicros = uint(unknown.reduce((sum, r) => sum + r.unresolvedReservationMicros, 0));
  return { occupiedJobs: rows.length, physicalJobs: rows.filter(r => r.status !== "reserved").length, unknownDispatches: rows.filter(r => r.status === "reserved").length,
    knownUsageMicros, unresolvedReservationMicros, accountedMicros: uint(knownUsageMicros + unresolvedReservationMicros),
    usageCoverage: { knownRequests: known.length, unknownRequests: unknown.length } };
}
function physicalLatency(rows: readonly EvolutionPhysicalV9[]) {
  const attempted = rows.filter(r => r.status !== "reserved"), measured = attempted.map(r => r.serviceMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  return { occupiedJobs: rows.length, physicalJobs: attempted.length, unknownDispatches: rows.length - attempted.length, measuredJobs: measured.length,
    totalMs: measured.reduce((sum, ms) => sum + ms, 0), p50Ms: measured.length ? measured[Math.ceil(measured.length * 0.5) - 1]! : null,
    p95Ms: measured.length ? measured[Math.ceil(measured.length * 0.95) - 1]! : null };
}
function outcome(value: unknown, judgeRepeats: number, locomo: boolean): EvolutionOutcomeV9 {
  const r = object(value, ["questionId", "variantId", "reader", "repeat", "readerFailed", "decisions", "judgeMean", "locomoF1", "evidence"]);
  text(r.questionId); text(r.variantId); text(r.reader); uint(r.repeat, 2);
  if (typeof r.readerFailed !== "boolean") fail("reader failure flag");
  const decisions = array(r.decisions, 3);
  if (decisions.length !== judgeRepeats || decisions.some(d => d !== 0 && d !== 1 && d !== null)) fail("decision vector must cover every judge repeat with 0, 1 or null");
  if (r.readerFailed && decisions.some(d => d !== null)) fail("failed reader cannot carry judge decisions");
  const judgeMean = unit(r.judgeMean), expected = (decisions as (0 | 1 | null)[]).reduce((sum: number, d) => sum + (d ?? 0), 0) / decisions.length;
  if (judgeMean === null || Math.abs(judgeMean - expected) > 1e-12) fail("judge mean disagrees with its decisions");
  const locomoF1 = unit(r.locomoF1);
  if ((locomoF1 === null) === locomo) fail("LoCoMo F1 diagnostic eligibility");
  const e = object(r.evidence, ["precision", "recall", "f1", "all"]);
  const values = [unit(e.precision), unit(e.recall), unit(e.f1), unit(e.all)];
  if (values.some(v => v === null) !== values.every(v => v === null) || (values[3] !== null && values[3] !== 0 && values[3] !== 1)) fail("evidence metrics disagree on eligibility");
  return r as unknown as EvolutionOutcomeV9;
}

/** Requires every shard report of the scope. No partial study summary is returned. */
export function buildEvolutionStudyV9Report(input: EvolutionStudyV9ReportInput) {
  object(input, ["authorization", "reports"]);
  boundEvolutionCompletionWire(input.authorization, 32 * 1024 * 1024, 400_000);
  const { study, scope } = input.authorization, locomo = study.dataset === "locomo";
  const { scopeSha256, ...scopePayload } = scope;
  if (canonicalSha256(scopePayload) !== digest(scopeSha256) || scope.manifestSha256 !== study.manifestPin.sha256) fail("authorized scope identity");
  const variants = [study.control.id, study.candidate.id], questions = new Map(scope.questions.map(q => [q.id, q]));
  if (array(input.reports, scope.shards.length).length !== scope.shards.length) fail("every shard report is required");
  const allOutcomes: EvolutionOutcomeV9[] = [], allPhysical = new Map<string, EvolutionPhysicalV9>(), seenShards = new Set<string>(), seenPins = new Set<string>();
  const reportPins: Array<{ shardId: string; reportFileSha256: string }> = [], campaignIds = new Set<string>();
  let attributedOccurrences = 0;
  for (const entry of input.reports) {
    object(entry, ["pin", "report"]); const pin = evolutionPin(entry.pin);
    if (seenPins.has(pin.sha256)) fail("duplicate report file pin"); seenPins.add(pin.sha256);
    boundEvolutionCompletionWire(entry.report, 64 * 1024 * 1024, 2_000_000);
    const report = object(entry.report);
    if (report.protocol !== EVOLUTION_REPORT_V9_PROTOCOL || report.status !== "complete") fail("complete V9 shard report required");
    const binding = object(report.study, ["studySha256", "scopeSha256", "scopeFileSha256", "shardId", "questionIds", "campaignSha256", "retrievalSourceSha256", "candidatePresentation", "outcomes", "physical"]);
    if (binding.studySha256 !== input.authorization.studySha256 || binding.scopeSha256 !== scope.scopeSha256 || binding.scopeFileSha256 !== input.authorization.scopeFileSha256
      || binding.retrievalSourceSha256 !== study.retrievalSourceSha256 || binding.candidatePresentation !== "retrieval-order") fail("shard study/scope/source binding");
    const shardId = text(binding.shardId), shard = scope.shards.find(s => s.id === shardId);
    if (!shard || seenShards.has(shardId) || !same(binding.questionIds, shard.questionIds)) fail("missing/duplicate shard or question coverage");
    seenShards.add(shardId); campaignIds.add(digest(binding.campaignSha256)); reportPins.push({ shardId, reportFileSha256: pin.sha256 });
    const design = object(report.design), scoring = object(report.scoring), coverage = object(report.coverage), pins = object(report.pins);
    if (design.repeats !== study.repeats || design.judgeRepeats !== study.judgeRepeats || design.readerDatePolicy !== study.readerDatePolicy
      || design.candidateVariantId !== study.candidate.id || design.controlVariantId !== study.control.id || !same(design.readers, study.readers)
      || design.candidateVariantSha256 !== canonicalSha256(study.candidate)) fail("shard design differs from the study");
    if (scoring.judgeProfile !== study.judge || pins.rubricSha256 !== study.rubricSha256 || pins.manifestSha256 !== study.manifestPin.sha256 || pins.sourceSha256 !== study.datasetPin.sha256) fail("shard judge/rubric/pins");
    if (coverage.expectedQuestionsPerArm !== shard.questionIds.length || coverage.completeAttemptCoverage !== true
      || coverage.logicalReaderCases !== shard.questionIds.length * variants.length * study.readers.length * study.repeats) fail("all planned logical cases required");
    const rows = array(binding.outcomes, 260 * 2 * 4 * 3).map(v => outcome(v, study.judgeRepeats, locomo));
    const expectedRows = shard.questionIds.flatMap(q => variants.flatMap(v => study.readers.flatMap(r => Array.from({ length: study.repeats }, (_, repeat) => tuple(q, v, r, repeat)))));
    assertExactEvolutionCoverage(expectedRows, rows.map(r => tuple(r.questionId, r.variantId, r.reader, r.repeat)));
    const arms = array(report.arms, 8).map(v => object(v));
    for (const arm of arms) {
      const armRows = rows.filter(r => r.variantId === arm.variantId && r.reader === arm.reader), selected = shard.questionIds.map(id => questions.get(id)!);
      const expected = summarizeEvolutionScores(metadata(selected), questionScores(armRows, shard.questionIds, "judge-mean"), "judge-mean");
      const reported = array(arm.metrics, 8).map(m => object(m)).find(m => m.metric === "judge-mean");
      if (reported === undefined || !same(reported.overall, expected.overall) || !same(reported.byCategory, expected.byCategory)) fail("shard judge-mean summary disagrees with outcomes");
      if (arm.readerFailures !== armRows.filter(r => r.readerFailed).length) fail("shard arm reader-failure denominator");
    }
    const physicalRows = array(binding.physical, 100_000).map(physical);
    assertExactEvolutionCoverage(physicalRows.map(r => evolutionJobKey(r.requestSha256, r.repeat)), physicalRows.map(r => evolutionJobKey(r.requestSha256, r.repeat)));
    const totals = physicalCost(physicalRows), cost = object(report.cost);
    for (const k of ["knownUsageMicros", "unresolvedReservationMicros", "accountedMicros"] as const) if (cost[k] !== totals[k]) fail("total cost differs from physical evidence");
    if (coverage.unknownDispatches !== totals.unknownDispatches || coverage.verifiedPhysicalResponses !== physicalRows.filter(r => r.status === "verified").length) fail("physical coverage counts");
    for (const r of physicalRows) {
      const key = evolutionJobKey(r.requestSha256, r.repeat), previous = allPhysical.get(key);
      if (previous && !same(previous, r)) fail("duplicate physical job has changed first evidence, phase, usage or service time");
      allPhysical.set(key, r);
    }
    attributedOccurrences += physicalRows.length; allOutcomes.push(...rows);
  }
  if (campaignIds.size !== 1) fail("shards use different campaigns");
  assertExactEvolutionCoverage(scope.shards.map(s => s.id), [...seenShards]);
  const questionIds = scope.questions.map(q => q.id), exposureStrata = strata(scope.questions), cases = metadata(scope.questions);
  const metrics: readonly Metric[] = locomo ? EVOLUTION_STUDY_V9_METRICS : EVOLUTION_STUDY_V9_METRICS.filter(m => m !== "locomo-f1");
  const cells = Array.from({ length: study.repeats }, (_, repeat) => Array.from({ length: study.judgeRepeats }, (_, judgeRepeat) => ({ repeat, judgeRepeat }))).flat();
  const armRows = (variantId: string, reader: string) => allOutcomes.filter(r => r.variantId === variantId && r.reader === reader);
  const arms = variants.flatMap(variantId => study.readers.map(reader => {
    const rows = armRows(variantId, reader);
    return { variantId, reader, readerFailures: rows.filter(r => r.readerFailed).length, judgeFailures: rows.reduce((sum, r) => sum + (r.readerFailed ? 0 : r.decisions.filter(d => d === null).length), 0),
      metrics: metrics.map(metric => {
        const s = summarizeEvolutionScores(cases, questionScores(rows, questionIds, metric), metric);
        return { metric, overall: s.overall, byCategory: s.byCategory, byExposureStratum: exposureStrata.map(group => ({ partition: group.partition, exposure: group.exposure,
          ...summarizeEvolutionScores(metadata(group.questions), questionScores(rows, group.questions.map(q => q.id), metric), metric).overall })) };
      }),
      byCell: cells.map(cell => ({ ...cell, ...summarizeEvolutionScores(cases, cellScores(rows, questionIds, cell.repeat, cell.judgeRepeat), "judge-accuracy").overall })) };
  }));
  const comparisons = study.readers.map(reader => {
    const left = armRows(study.candidate.id, reader), right = armRows(study.control.id, reader);
    return { candidateVariantId: study.candidate.id, controlVariantId: study.control.id, reader,
      metrics: metrics.map(metric => {
        const s = summarizeEvolutionPairs(cases, questionScores(left, questionIds, metric), questionScores(right, questionIds, metric), metric);
        return { metric, paired: s.paired, byCategory: s.byCategory, byExposureStratum: exposureStrata.map(group => ({ partition: group.partition, exposure: group.exposure,
          ...summarizeEvolutionPairs(metadata(group.questions), questionScores(left, group.questions.map(q => q.id), metric), questionScores(right, group.questions.map(q => q.id), metric), metric).paired })) };
      }),
      byCell: cells.map(cell => ({ ...cell, ...summarizeEvolutionPairs(cases, cellScores(left, questionIds, cell.repeat, cell.judgeRepeat), cellScores(right, questionIds, cell.repeat, cell.judgeRepeat), "judge-accuracy").paired })) };
  });
  const physicalRows = [...allPhysical.values()], total = physicalCost(physicalRows);
  const payload = { protocol: EVOLUTION_STUDY_V9_REPORT_PROTOCOL, status: "complete" as const, mode: study.mode,
    design: { dataset: study.dataset, candidate: study.candidate, control: study.control, readers: study.readers, judge: study.judge, rubricSha256: study.rubricSha256,
      repeats: study.repeats, judgeRepeats: study.judgeRepeats, readerDatePolicy: study.readerDatePolicy, candidatePresentation: study.candidatePresentation, repeatPolicy: study.repeatPolicy,
      shardPolicy: study.shardPolicy, derivedRecordsPinSha256: study.derivedRecordsPin?.sha256 ?? null, categoryNames: locomo ? EVOLUTION_LOCOMO_CATEGORY_NAMES : null },
    scope: { ...scope.coverage, shards: scope.shards.length, strata: scope.strata },
    pins: { studySha256: input.authorization.studySha256, scopeSha256: scope.scopeSha256, scopeFileSha256: input.authorization.scopeFileSha256,
      manifestSha256: study.manifestPin.sha256, sourceSha256: study.datasetPin.sha256, campaignFileSha256: study.campaignPin.sha256, campaignSha256: [...campaignIds][0]!,
      retrievalSourceSha256: study.retrievalSourceSha256, reports: reportPins.sort((a, b) => a.shardId < b.shardId ? -1 : 1) },
    arms, comparisons,
    cost: { ...total, shardAttributedOccurrences: attributedOccurrences, crossShardReusedOccurrences: attributedOccurrences - physicalRows.length,
      phases: (["reader", "judge"] as const).map(phase => ({ phase, ...physicalCost(physicalRows.filter(r => r.phase === phase)) })),
      qualification: "Each distinct (request, repeat) job is counted once across shards only when its complete first-evidence projection is identical. Known usage plus unresolved full reservations is conservative attributed exposure, not incremental campaign spending or a provider invoice." },
    latency: { ...physicalLatency(physicalRows), phases: (["reader", "judge"] as const).map(phase => ({ phase, ...physicalLatency(physicalRows.filter(r => r.phase === phase)) })),
      qualification: "Distinct original physical service durations, including reused captures. No summed wall-time, cache-hit latency or end-to-end throughput claim." },
    qualification: ["Explicit-selection descriptive coverage with the original exposure dispositions. Prior adaptive development and evaluated or unknown exposure remain disclosed; neither means unseen.",
      "Every planned question remains in each arm and each declared repeat; reader and judge failures are separate and score zero. The per-question judge mean averages every (reader repeat, judge repeat) cell. Evidence eligibility is independent of answer failure; unlabeled evidence is unscored.",
      "Declared families, histories and clusters are not proven independent. These paired, category, exposure and per-cell summaries do not establish fresh confirmation, statistical superiority or benchmark saturation; repeats average reader and judge noise, not question sampling.",
      study.judge === EVOLUTION_LOCOMO_JUDGE_PROFILE_ID
        ? "LoCoMo J under the Packer/Mem0/Zep CORRECT-WRONG prompt on the Gateway gpt-4o-mini alias over categories 1-4; the official F1 is a diagnostic that underestimates abstention. Not a pinned-snapshot reproduction of any leaderboard harness."
        : "Native LongMemEval rubric and contains-yes decision through a Gateway GPT-4o alias, or the pinned direct snapshot when declared. Not an official protocol reproduction.",
      "Caller authenticates original study/scope/report file bytes. Shard reporters authenticate source and raw responses. This pure reducer checks the ID-only projection and aggregate consistency; it does not independently map outcomes to physical responses or reauthenticate raw/source bytes."] };
  return freezeEvolutionCompletion({ ...payload, summarySha256: canonicalSha256(payload) });
}
