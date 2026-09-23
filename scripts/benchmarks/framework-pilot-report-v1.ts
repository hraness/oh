import { canonicalSha256, isPlainRecord } from "../../src/canonical";
import { percentile, random } from "./metrics";

export const FRAMEWORK_PILOT_REPORT_ARMS_V1 = ["oh", "supermemory", "bm25"] as const;
export const FRAMEWORK_PILOT_REPORT_TYPES_V1 = ["knowledge-update", "multi-session", "single-session-assistant",
  "single-session-preference", "single-session-user", "temporal-reasoning"] as const;
export type FrameworkPilotReportArmV1 = typeof FRAMEWORK_PILOT_REPORT_ARMS_V1[number];
export type FrameworkPilotReportQuestionTypeV1 = typeof FRAMEWORK_PILOT_REPORT_TYPES_V1[number];
export type FrameworkPilotReportStageStatusV1 = "completed" | "failed" | "not-run";
export type FrameworkPilotReportCaseV1 = Readonly<{ caseId: string; questionType: FrameworkPilotReportQuestionTypeV1 }>;
export type FrameworkPilotReportRowV1 = Readonly<{
  caseId: string; arm: FrameworkPilotReportArmV1;
  retrievalStatus: FrameworkPilotReportStageStatusV1; readerStatus: FrameworkPilotReportStageStatusV1;
  judgeStatus: FrameworkPilotReportStageStatusV1; verdict: 0 | 1 | null; searchMs: number | null;
}>;
export type FrameworkPilotReportAccountingV1 = Readonly<{
  unit: "USD-microdollars"; observed: number | null; confirmed: number | null; unresolved: number | null;
  priorTaskExposure: number | null; priorGlobalExposure: number | null;
}>;
export type FrameworkPilotReportInputV1 = Readonly<{
  protocol: "oh.framework-pilot-report-input.v1"; cases: readonly FrameworkPilotReportCaseV1[];
  rows: readonly FrameworkPilotReportRowV1[]; accounting: FrameworkPilotReportAccountingV1;
}>;

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

/** Fixed before outcomes; changing any statistical choice requires a new protocol. */
export const FRAMEWORK_PILOT_REPORT_PLAN_V1 = immutable({
  protocol: "oh.framework-pilot-report-plan.v1",
  cases: 60, casesPerType: 10, arms: FRAMEWORK_PILOT_REPORT_ARMS_V1, questionTypes: FRAMEWORK_PILOT_REPORT_TYPES_V1,
  conservativeSuccessRate: "correct completed verdicts divided by every planned case; incomplete rows contribute zero successes",
  gradedAnswerAccuracy: "correct divided by completed judgments only; conditional and excludes failures/not-run; null when none",
  primary: { left: "oh", right: "supermemory", metric: "conservativeSuccessRate", role: "primary" },
  secondary: { left: "oh", right: "bm25", metric: "conservativeSuccessRate", role: "secondary-descriptive" },
  bootstrap: { method: "paired-case-tuples-within-fixed-question-types", generator: "mulberry32", seed: 20260923,
    replicates: 10_000, casesPerTypePerReplicate: 10, typeOrder: "declared-lexical", caseOrder: "caseId-ascending",
    sharedDrawsAcrossComparisons: true, intervalLevel: 0.95, quantiles: [0.025, 0.975],
    quantileMethod: "nearest-rank-ceil-p-times-n", endpointRanksOneBased: [250, 9750],
    differenceUnit: "percentage-points", intervalScope: "resampling-uncertainty-conditional-on-this-fixed-balanced-pilot" },
  latency: { unit: "milliseconds", scope: "successful-retrievals-including-downstream-failures",
    quantiles: [0.5, 0.95], quantileMethod: "nearest-rank-ceil-p-times-n", failedRetrievalsExcluded: true },
  models: { readerProfileId: "gpt4o-gateway-framework-pilot-alias-v1-reader",
    judgeProfileId: "gpt4o-gateway-framework-pilot-16-alias-v1-judge", requestedModel: "openai/gpt-4o",
    qualification: "gateway-alias", snapshotPinned: false, guaranteedResolvedSnapshot: null },
  limitations: { populationInference: false, sotaClaim: false, qualitySuperiorityClaim: false,
    campaignArtifactIdentity: "not-established-by-report-helper", suppliedVerdictValidity: "caller-responsibility",
    costReconciliation: "not-established-by-report-helper" },
} as const);
export const FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1 = canonicalSha256(FRAMEWORK_PILOT_REPORT_PLAN_V1);

const STAGES = ["completed", "failed", "not-run"] as const;
const ROW_KEYS = ["caseId", "arm", "retrievalStatus", "readerStatus", "judgeStatus", "verdict", "searchMs"] as const;
const ACCOUNTING_KEYS = ["unit", "observed", "confirmed", "unresolved", "priorTaskExposure", "priorGlobalExposure"] as const;
type OverallStatus = "completed" | "retrieval-failed" | "reader-failed" | "judge-failed" | "not-run";

function fail(reason: string): never { throw new TypeError(`Framework pilot report: ${reason}.`); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) fail("plain records required");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) fail("unexpected fields");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail("data fields required");
    result[key] = descriptor.value;
  }
  return result;
}
function list(value: unknown, length: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length || Reflect.ownKeys(value).length !== length + 1) fail("exact dense array required");
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail("array data entries required");
    result.push(descriptor.value);
  }
  return result;
}
function member<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.some(item => item === value)) fail("unknown closed value");
  return value;
}
function caseId(value: unknown): string {
  if (typeof value !== "string" || !/^c00(?:[0-5][0-9]|60)$/.test(value) || value === "c0000") fail("invalid case alias");
  return value;
}
function amount(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail("invalid microdollar amount");
  return value;
}
function duration(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) fail("invalid search duration");
  return value;
}
function parse(value: unknown): FrameworkPilotReportInputV1 {
  const input = exact(value, ["protocol", "cases", "rows", "accounting"]);
  if (input.protocol !== "oh.framework-pilot-report-input.v1") fail("invalid protocol");
  const cases = list(input.cases, 60).map(item => {
    const row = exact(item, ["caseId", "questionType"]);
    return { caseId: caseId(row.caseId), questionType: member(row.questionType, FRAMEWORK_PILOT_REPORT_TYPES_V1) };
  }).sort((a, b) => a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1 : 0);
  if (new Set(cases.map(row => row.caseId)).size !== 60) fail("duplicate or missing case");
  for (const type of FRAMEWORK_PILOT_REPORT_TYPES_V1) {
    if (cases.filter(row => row.questionType === type).length !== 10) fail("question types must contain ten cases each");
  }
  const rows = list(input.rows, 180).map(item => {
    const row = exact(item, ROW_KEYS), id = caseId(row.caseId), arm = member(row.arm, FRAMEWORK_PILOT_REPORT_ARMS_V1);
    const retrievalStatus = member(row.retrievalStatus, STAGES), readerStatus = member(row.readerStatus, STAGES);
    const judgeStatus = member(row.judgeStatus, STAGES), searchMs = duration(row.searchMs);
    if (retrievalStatus !== "completed" && (readerStatus !== "not-run" || judgeStatus !== "not-run")
      || readerStatus !== "completed" && judgeStatus !== "not-run") fail("invalid downstream stage progression");
    if (retrievalStatus === "completed" && searchMs === null || retrievalStatus === "not-run" && searchMs !== null) fail("duration and retrieval status conflict");
    let verdict: 0 | 1 | null = null;
    if (judgeStatus === "completed") {
      if ((row.verdict !== 0 && row.verdict !== 1) || Object.is(row.verdict, -0)) fail("completed judgment requires binary verdict");
      verdict = row.verdict;
    } else if (row.verdict !== null) fail("incomplete judgment cannot carry a verdict");
    return { caseId: id, arm, retrievalStatus, readerStatus, judgeStatus, verdict, searchMs };
  });
  const coverage = new Set(rows.map(row => `${row.caseId}:${row.arm}`));
  if (coverage.size !== 180) fail("duplicate or missing case-arm row");
  for (const row of cases) for (const arm of FRAMEWORK_PILOT_REPORT_ARMS_V1) {
    if (!coverage.has(`${row.caseId}:${arm}`)) fail("incomplete case-arm matrix");
  }
  rows.sort((a, b) => a.caseId < b.caseId ? -1 : a.caseId > b.caseId ? 1
    : FRAMEWORK_PILOT_REPORT_ARMS_V1.indexOf(a.arm) - FRAMEWORK_PILOT_REPORT_ARMS_V1.indexOf(b.arm));
  const cost = exact(input.accounting, ACCOUNTING_KEYS);
  if (cost.unit !== "USD-microdollars") fail("explicit USD-microdollars required");
  const accounting: FrameworkPilotReportAccountingV1 = { unit: "USD-microdollars", observed: amount(cost.observed),
    confirmed: amount(cost.confirmed), unresolved: amount(cost.unresolved), priorTaskExposure: amount(cost.priorTaskExposure),
    priorGlobalExposure: amount(cost.priorGlobalExposure) };
  return { protocol: "oh.framework-pilot-report-input.v1", cases, rows, accounting };
}
function status(row: FrameworkPilotReportRowV1): OverallStatus {
  if (row.retrievalStatus === "failed") return "retrieval-failed";
  if (row.readerStatus === "failed") return "reader-failed";
  if (row.judgeStatus === "failed") return "judge-failed";
  return row.judgeStatus === "completed" ? "completed" : "not-run";
}
function success(row: FrameworkPilotReportRowV1): number { return Number(row.judgeStatus === "completed" && row.verdict === 1); }
function summary(rows: readonly FrameworkPilotReportRowV1[]) {
  const outcomes: Record<OverallStatus, number> = { completed: 0, "retrieval-failed": 0, "reader-failed": 0, "judge-failed": 0, "not-run": 0 };
  const stages = { retrieval: { completed: 0, failed: 0, "not-run": 0 },
    reader: { completed: 0, failed: 0, "not-run": 0 }, judge: { completed: 0, failed: 0, "not-run": 0 } };
  let correct = 0, incorrectJudgments = 0, successfulSearchesWithIncompleteDownstream = 0;
  const successfulSearchMs: number[] = [];
  for (const row of rows) {
    outcomes[status(row)]++;
    stages.retrieval[row.retrievalStatus]++; stages.reader[row.readerStatus]++; stages.judge[row.judgeStatus]++;
    correct += success(row); incorrectJudgments += Number(row.judgeStatus === "completed" && row.verdict === 0);
    if (row.retrievalStatus === "completed") {
      successfulSearchMs.push(row.searchMs!);
      successfulSearchesWithIncompleteDownstream += Number(row.judgeStatus !== "completed");
    }
  }
  const completedJudgments = stages.judge.completed;
  return { plannedCases: rows.length, correct, incorrectJudgments, completedJudgments, ungradedCases: rows.length - completedJudgments,
    conservativeSuccessRate: { unit: "proportion", numerator: correct, denominator: rows.length, value: correct / rows.length,
      incompleteContribution: "zero-successes-without-imputing-an-incorrect-judge-verdict" },
    gradedAnswerAccuracy: { unit: "proportion", numerator: correct, denominator: completedJudgments,
      value: completedJudgments === 0 ? null : correct / completedJudgments,
      caveat: "conditional-on-completed-judgments; excludes-failures-and-not-run" },
    outcomes, stages,
    searchLatency: { unit: "milliseconds", quantileMethod: "nearest-rank-ceil-p-times-n", contributingCount: successfulSearchMs.length,
      excludedRetrievalFailures: stages.retrieval.failed, excludedRetrievalNotRun: stages.retrieval["not-run"],
      successfulSearchesWithIncompleteDownstream, p50: percentile(successfulSearchMs, 0.5), p95: percentile(successfulSearchMs, 0.95) } };
}
function comparisons(input: FrameworkPilotReportInputV1) {
  const byKey = new Map(input.rows.map(row => [`${row.caseId}:${row.arm}`, row] as const));
  const strata = FRAMEWORK_PILOT_REPORT_TYPES_V1.map(type => input.cases.filter(row => row.questionType === type).map(row => {
    const values = FRAMEWORK_PILOT_REPORT_ARMS_V1.map(arm => success(byKey.get(`${row.caseId}:${arm}`)!));
    return [values[0]! - values[1]!, values[0]! - values[2]!] as const;
  }));
  const primary: number[] = [], secondary: number[] = [], next = random(FRAMEWORK_PILOT_REPORT_PLAN_V1.bootstrap.seed);
  for (let replicate = 0; replicate < 10_000; replicate++) {
    let first = 0, second = 0;
    for (const group of strata) for (let index = 0; index < 10; index++) {
      const tuple = group[Math.floor(next() * 10)]!; first += tuple[0]; second += tuple[1];
    }
    primary.push(first); secondary.push(second);
  }
  function result(right: "supermemory" | "bm25", role: "primary" | "secondary-descriptive", values: number[], index: 0 | 1) {
    const sum = strata.reduce((total, group) => total + group.reduce((subtotal, tuple) => subtotal + tuple[index], 0), 0);
    return { left: "oh", right, role, metric: "conservativeSuccessRate", unit: "percentage-points", pairedCases: 60,
      estimate: sum / 60 * 100, interval95: { lower: percentile(values, 0.025)! / 60 * 100, upper: percentile(values, 0.975)! / 60 * 100 },
      intervalScope: FRAMEWORK_PILOT_REPORT_PLAN_V1.bootstrap.intervalScope,
      replicateDifferenceNumeratorsSha256: canonicalSha256(values), replicateDenominator: 60 };
  }
  return { primary: result("supermemory", "primary", primary, 0), secondary: result("bm25", "secondary-descriptive", secondary, 1) };
}

/** Pure arithmetic over an explicitly complete, preselected matrix. This helper
 * does not authenticate campaign artifacts, judge verdicts, model identity or
 * financial settlement. It never reads question, answer, reference or source data. */
export function reportFrameworkPilotV1(value: unknown) {
  const input = parse(value);
  const arms = FRAMEWORK_PILOT_REPORT_ARMS_V1.map(arm => {
    const rows = input.rows.filter(row => row.arm === arm);
    return { arm, ...summary(rows), byType: FRAMEWORK_PILOT_REPORT_TYPES_V1.map(questionType => {
      const ids = new Set(input.cases.filter(row => row.questionType === questionType).map(row => row.caseId));
      return { questionType, ...summary(rows.filter(row => ids.has(row.caseId))) };
    }) };
  });
  return immutable({ protocol: "oh.framework-pilot-report.v1", plan: FRAMEWORK_PILOT_REPORT_PLAN_V1,
    planSha256: FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1, caseManifestSha256: canonicalSha256(input.cases),
    outcomesSha256: canonicalSha256(input.rows), inputSha256: canonicalSha256(input),
    quality: { plannedCases: 60, plannedCaseArmRows: 180, arms, comparisons: comparisons(input) },
    accounting: { ...input.accounting, basis: "caller-supplied-not-reconciled", observedAndConfirmedMayOverlap: true,
      unknownAmountsRemainNull: true, finalCostEstablished: false } });
}
export type FrameworkPilotReportV1 = ReturnType<typeof reportFrameworkPilotV1>;
