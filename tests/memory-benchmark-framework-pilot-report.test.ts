import { describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { FRAMEWORK_PILOT_REPORT_ARMS_V1 as ARMS, FRAMEWORK_PILOT_REPORT_TYPES_V1 as TYPES,
  FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1, FRAMEWORK_PILOT_REPORT_PLAN_V1, reportFrameworkPilotV1,
  type FrameworkPilotReportInputV1, type FrameworkPilotReportRowV1 } from "../scripts/benchmarks/framework-pilot-report-v1";

function fixture(): FrameworkPilotReportInputV1 {
  const cases = TYPES.flatMap((questionType, type) => Array.from({ length: 10 }, (_, index) => ({
    caseId: `c${String(type * 10 + index + 1).padStart(4, "0")}`, questionType })));
  return { protocol: "oh.framework-pilot-report-input.v1", cases,
    rows: cases.flatMap(row => ARMS.map(arm => ({ caseId: row.caseId, arm, retrievalStatus: "completed" as const,
      readerStatus: "completed" as const, judgeStatus: "completed" as const, verdict: 1 as const, searchMs: Number(row.caseId.slice(1)) }))),
    accounting: { unit: "USD-microdollars", observed: null, confirmed: null, unresolved: null,
      priorTaskExposure: 14_348_242, priorGlobalExposure: 263_307_255 } };
}
function change(input: FrameworkPilotReportInputV1, index: number, patch: Partial<FrameworkPilotReportRowV1>): FrameworkPilotReportInputV1 {
  return { ...input, rows: input.rows.map((row, i) => i === index ? { ...row, ...patch } : row) };
}
function rejected(value: unknown) { expect(() => reportFrameworkPilotV1(value)).toThrow("Framework pilot report:"); }

describe("fixed balanced framework pilot reporting", () => {
  test("separates conservative planned-case success, conditional graded accuracy and stage outcomes", () => {
    let input = fixture();
    input = change(input, 0, { verdict: 0 });
    input = change(input, 3, { retrievalStatus: "failed", readerStatus: "not-run", judgeStatus: "not-run", verdict: null, searchMs: 9999 });
    input = change(input, 6, { readerStatus: "failed", judgeStatus: "not-run", verdict: null });
    input = change(input, 9, { judgeStatus: "failed", verdict: null });
    input = change(input, 12, { retrievalStatus: "not-run", readerStatus: "not-run", judgeStatus: "not-run", verdict: null, searchMs: null });
    input = change(input, 15, { readerStatus: "not-run", judgeStatus: "not-run", verdict: null });
    input = change(input, 18, { judgeStatus: "not-run", verdict: null });
    const report = reportFrameworkPilotV1(input), oh = report.quality.arms[0]!;
    expect(oh).toMatchObject({ plannedCases: 60, correct: 53, incorrectJudgments: 1, completedJudgments: 54, ungradedCases: 6,
      conservativeSuccessRate: { numerator: 53, denominator: 60, value: 53 / 60 },
      gradedAnswerAccuracy: { numerator: 53, denominator: 54, value: 53 / 54 },
      outcomes: { completed: 54, "retrieval-failed": 1, "reader-failed": 1, "judge-failed": 1, "not-run": 3 },
      stages: { retrieval: { completed: 58, failed: 1, "not-run": 1 }, reader: { completed: 56, failed: 1, "not-run": 3 },
        judge: { completed: 54, failed: 1, "not-run": 5 } } });
    expect(oh.gradedAnswerAccuracy.caveat).toContain("conditional");
    expect(oh.byType[0]).toMatchObject({ plannedCases: 10, correct: 3, conservativeSuccessRate: { denominator: 10, value: 0.3 } });
    expect(report.quality.comparisons.primary).toMatchObject({ metric: "conservativeSuccessRate", left: "oh", right: "supermemory", role: "primary", estimate: -7 / 60 * 100 });
    expect(report.quality.comparisons.secondary.role).toBe("secondary-descriptive");
  });

  test("enforces exact aliases, six balanced types and every planned case-arm row once", () => {
    const input = fixture();
    for (const cases of [input.cases.slice(1), [...input.cases, input.cases[0]!], input.cases.map((row, i) => i === 1 ? input.cases[0]! : row),
      input.cases.map((row, i) => i === 0 ? { ...row, caseId: "c0061" } : row),
      input.cases.map((row, i) => i === 0 ? { ...row, caseId: "c0000" } : row),
      input.cases.map((row, i) => i === 0 ? { ...row, questionType: TYPES[1] } : row),
      input.cases.map((row, i) => i === 0 ? { ...row, questionType: "other" } : row)]) rejected({ ...input, cases });
    for (const rows of [input.rows.slice(1), [...input.rows, input.rows[0]!], input.rows.map((row, i) => i === 1 ? input.rows[0]! : row),
      input.rows.map((row, i) => i === 0 ? { ...row, arm: "letta" } : row),
      input.rows.map((row, i) => i === 0 ? { ...row, caseId: "original-dataset-id" } : row)]) rejected({ ...input, rows });
    rejected({ ...input, protocol: "other" });
  });

  test("rejects impossible stage progression and verdicts on incomplete judgments", () => {
    const input = fixture();
    for (const patch of [{ retrievalStatus: "failed" }, { readerStatus: "not-run" }, { judgeStatus: "failed" },
      { judgeStatus: "not-run", verdict: 0 }, { verdict: null }, { verdict: -0 }, { verdict: 2 }, { verdict: true },
      { verdict: "yes" }, { retrievalStatus: "pending" }, { readerStatus: "completed", judgeStatus: "unknown" }]) {
      rejected(change(input, 0, patch as Partial<FrameworkPilotReportRowV1>));
    }
  });

  test("uses successful search durations only with exact counts and null empty quantiles", () => {
    const base = reportFrameworkPilotV1(fixture()).quality.arms[0]!;
    expect(base.searchLatency).toMatchObject({ contributingCount: 60, p50: 30, p95: 57, excludedRetrievalFailures: 0, excludedRetrievalNotRun: 0 });
    let input = change(fixture(), 0, { retrievalStatus: "failed", readerStatus: "not-run", judgeStatus: "not-run", verdict: null, searchMs: 1e100 });
    input = change(input, 3, { readerStatus: "failed", judgeStatus: "not-run", verdict: null });
    const measured = reportFrameworkPilotV1(input).quality.arms[0]!;
    expect(measured.searchLatency).toMatchObject({ contributingCount: 59, p50: 31, p95: 58, excludedRetrievalFailures: 1,
      excludedRetrievalNotRun: 0, successfulSearchesWithIncompleteDownstream: 1 });
    const empty = fixture();
    const report = reportFrameworkPilotV1({ ...empty, rows: empty.rows.map(row => ({ ...row, retrievalStatus: "not-run",
      readerStatus: "not-run", judgeStatus: "not-run", verdict: null, searchMs: null })) });
    expect(report.quality.arms[0]).toMatchObject({ incorrectJudgments: 0, ungradedCases: 60,
      conservativeSuccessRate: { denominator: 60, value: 0 }, gradedAnswerAccuracy: { denominator: 0, value: null },
      searchLatency: { contributingCount: 0, p50: null, p95: null, excludedRetrievalNotRun: 60 } });
    for (const searchMs of [-1, -0, NaN, Infinity, -Infinity, "1", undefined, null]) rejected(change(fixture(), 0, { searchMs } as Partial<FrameworkPilotReportRowV1>));
    rejected(change(fixture(), 0, { retrievalStatus: "not-run", readerStatus: "not-run", judgeStatus: "not-run", verdict: null, searchMs: 0 }));
  });

  test("preserves case pairs and the fixed balance of all six strata", () => {
    const input = fixture();
    const same = reportFrameworkPilotV1({ ...input, rows: input.rows.map(row => ({ ...row, verdict: Number(row.caseId.slice(1)) % 2 as 0 | 1 })) });
    expect(same.quality.comparisons.primary).toMatchObject({ estimate: 0, interval95: { lower: 0, upper: 0 } });
    expect(same.quality.comparisons.secondary.interval95).toEqual({ lower: 0, upper: 0 });
    const opposite = reportFrameworkPilotV1({ ...input, rows: input.rows.map(row => ({ ...row, verdict: row.arm === "oh" ? 1 : 0 })) });
    expect(opposite.quality.comparisons.primary).toMatchObject({ estimate: 100, interval95: { lower: 100, upper: 100 } });
    const strata = reportFrameworkPilotV1({ ...input, rows: input.rows.map(row => {
      const type = Math.floor((Number(row.caseId.slice(1)) - 1) / 10);
      return { ...row, verdict: row.arm === "oh" ? Number(type < 3) : Number(type >= 3) };
    }) });
    expect(strata.quality.comparisons.primary).toMatchObject({ estimate: 0, interval95: { lower: 0, upper: 0 } });
  });

  test("matches an independently computed integer oracle and is invariant to input ordering", () => {
    const base = fixture(), input = { ...base, rows: base.rows.map(row => {
      const index = Number(row.caseId.slice(1)) - 1, type = Math.floor(index / 10), within = index % 10;
      const correct = row.arm === "oh" ? (within + type) % 3 === 0 : row.arm === "supermemory" ? (2 * within + type) % 5 < 2 : (within + type) % 4 === 0;
      return { ...row, verdict: Number(correct) as 0 | 1 };
    }) };
    // Independent Python integer mulberry32, 10,000 x six strata x ten draws.
    // Numerators are exact integers; endpoint ranks are 250 and 9750, denominator 60.
    const report = reportFrameworkPilotV1(input);
    expect(report.quality.comparisons.primary).toMatchObject({ estimate: -4 / 60 * 100, interval95: { lower: -14 / 60 * 100, upper: 6 / 60 * 100 },
      replicateDifferenceNumeratorsSha256: "114d73493408f847bfde446ea53fd89f6981c12b63f452a006fe5ff4a37b17c4" });
    expect(report.quality.comparisons.secondary).toMatchObject({ estimate: 5 / 60 * 100, interval95: { lower: -5 / 60 * 100, upper: 15 / 60 * 100 },
      replicateDifferenceNumeratorsSha256: "1f59b65cddc7071b29bc2d2ad35c7fac574b80eabe9a1583ed7dc31463953a27" });
    expect(reportFrameworkPilotV1({ ...input, cases: [...input.cases].reverse(), rows: [...input.rows].reverse() })).toEqual(report);
  });

  test("keeps nullable accounting separate and states prior exposure and Gateway limitations", () => {
    const input = fixture(), unknown = reportFrameworkPilotV1(input);
    expect(unknown.accounting).toMatchObject({ observed: null, confirmed: null, unresolved: null, priorTaskExposure: 14348242,
      priorGlobalExposure: 263307255, finalCostEstablished: false, unknownAmountsRemainNull: true });
    const known = reportFrameworkPilotV1({ ...input, accounting: { ...input.accounting, observed: 176, confirmed: 176, unresolved: 10478 } });
    expect(known.quality).toEqual(unknown.quality);
    expect(known.accounting).toMatchObject({ observed: 176, confirmed: 176, unresolved: 10478, observedAndConfirmedMayOverlap: true, finalCostEstablished: false });
    expect(known.plan.models).toMatchObject({ qualification: "gateway-alias", snapshotPinned: false, guaranteedResolvedSnapshot: null });
    expect(known.plan.limitations).toMatchObject({ populationInference: false, sotaClaim: false, qualitySuperiorityClaim: false });
    expect(known.planSha256).toBe(FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1);
    expect(known.planSha256).toBe(canonicalSha256(FRAMEWORK_PILOT_REPORT_PLAN_V1));
    expect(Object.isFrozen(known.quality.arms[0]!.searchLatency)).toBe(true);
    for (const field of ["observed", "confirmed", "unresolved", "priorTaskExposure", "priorGlobalExposure"]) {
      for (const bad of [-1, -0, NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER + 1, "0", undefined]) rejected({ ...input, accounting: { ...input.accounting, [field]: bad } });
    }
    rejected({ ...input, accounting: { ...input.accounting, unit: "USD" } });
  });

  test("rejects unrecognized content, sparse arrays and accessors without reading their values", () => {
    const input = fixture();
    rejected({ ...input, originalQuestionId: "private" });
    rejected({ ...input, rows: input.rows.map((row, index) => index === 0 ? { ...row, answer: "private" } : row) });
    const sparse = [...input.rows]; delete sparse[0]; rejected({ ...input, rows: sparse });
    let reads = 0;
    const row = { ...input.rows[0]!, get verdict() { reads++; return 1; } };
    rejected({ ...input, rows: [row, ...input.rows.slice(1)] });
    const cases = [...input.cases]; Object.defineProperty(cases, "0", { get() { reads++; return input.cases[0]; }, enumerable: true });
    rejected({ ...input, cases });
    expect(reads).toBe(0);
    rejected({ ...input, [Symbol("extra")]: true });
  });
});
