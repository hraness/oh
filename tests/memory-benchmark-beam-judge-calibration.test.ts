import { expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { assessBeamJudgeCalibrationV1, assessBeamJudgeCalibrationV2, auditBeamJudgeCalibrationV1, auditBeamJudgeCalibrationV2,
  prepareBeamJudgeCalibrationV1, prepareBeamJudgeCalibrationV2 } from "../scripts/benchmarks/beam-judge-calibration";

const config = { model: "invented-judge-model", provider: "mock-only", settings: { temperature: 0 } };
const observation = (index: number, response: string | null) => {
  const plan = prepareBeamJudgeCalibrationV1(config), cell = plan.manifest.cells[index]!;
  return { key: cell.key, configSha256: plan.manifest.configSha256, requestSha256: cell.requestSha256, response };
};

test("paired calibration is balanced and covers every answer schema without disclosing expected labels to judge", () => {
  const plan = prepareBeamJudgeCalibrationV1(config);
  expect(plan.fixtures).toHaveLength(16); expect(plan.fixtures.filter(row => row.expected)).toHaveLength(8);
  const references = new Set(plan.fixtures.flatMap(row => Object.keys(row.reference as object)));
  for (const field of ["answer", "ideal_answer", "ideal_response", "ideal_summary", "expected_compliance"]) expect(references.has(field)).toBeTrue();
  for (let i = 0; i < plan.fixtures.length; i += 2) {
    expect(plan.fixtures[i]?.reference).toEqual(plan.fixtures[i + 1]?.reference);
    expect(plan.fixtures[i]?.question).toBe(plan.fixtures[i + 1]?.question);
    expect(plan.fixtures[i]?.response).not.toBe(plan.fixtures[i + 1]?.response);
  }
  for (const cell of plan.cells) {
    expect(cell.request.prompt).not.toContain('"expected":'); expect(cell.request.prompt).not.toContain(cell.key);
    expect(canonicalSha256(cell.request)).toBe(plan.manifest.cells.find(row => row.key === cell.key)?.requestSha256);
  }
});

test("prepared config and requests cannot drift after hashing", () => {
  const input = structuredClone(config), plan = prepareBeamJudgeCalibrationV1(input);
  input.settings.temperature = 1;
  expect(plan.cells[0]?.request.config).toEqual(config);
  expect(Object.isFrozen(plan.cells[0]?.request.config)).toBeTrue();
  expect(Object.isFrozen((plan.cells[0]?.request.config as typeof config).settings)).toBeTrue();
  expect(() => { (plan.cells[0]!.request as { prompt: string }).prompt = "changed"; }).toThrow();
  expect(prepareBeamJudgeCalibrationV1(input).manifest.configSha256).not.toBe(plan.manifest.configSha256);
});

test("mixed known observations produce an explicit confusion matrix and unresolved/missing counts", () => {
  // Fixtures are positive, negative pairs. Deliberately simulate both judge error types.
  const result = auditBeamJudgeCalibrationV1(config, [observation(0, "yes"), observation(1, "yes"),
    observation(2, "no"), observation(3, "no"), observation(4, "yes because"), observation(5, null)]);
  expect(result.confusion).toEqual({ truePositive: 1, trueNegative: 1, falsePositive: 1, falseNegative: 1 });
  expect(result.unresolved).toHaveLength(2); expect(result.missing).toHaveLength(10); expect(result.complete).toBeFalse();
  expect(result.scope).toBe("invented-development-fixture-agreement-only");
});

test("fully resolved disagreement is complete accounting, never a passing-qualification claim", () => {
  const result = auditBeamJudgeCalibrationV1(config, Array.from({ length: 16 }, (_, i) => observation(i, "yes")));
  expect(result.complete).toBeTrue(); expect(result.confusion.falsePositive).toBe(8);
  expect(result.confusion.truePositive).toBe(8); expect("qualified" in result).toBeFalse();
});

test("foreign, duplicate, misbound and oversize observations fail rather than affecting aggregate scores", () => {
  const row = observation(0, "yes");
  for (const rows of [[row, row], [{ ...row, key: "foreign" }], [{ ...row, configSha256: "0".repeat(64) }],
    [{ ...row, requestSha256: "0".repeat(64) }], [{ ...row, response: "yes", correct: true }], Array.from({ length: 17 }, () => row)]) {
    expect(() => auditBeamJudgeCalibrationV1(config, rows)).toThrow();
  }
  expect(() => auditBeamJudgeCalibrationV1({ ...config, model: "another" }, [row])).toThrow("identity mismatch");
  expect(() => prepareBeamJudgeCalibrationV1({ model: "" })).toThrow();
});

test("extending calibration preserves V1 fixture, manifest and request bytes", () => {
  const old = prepareBeamJudgeCalibrationV1(config), current = prepareBeamJudgeCalibrationV2(config);
  expect(old.fixtureSha256).toBe("9865882035fba7152c7e0c81bfea934f81c4d807b352e5fc5b59a5122d3ec72d");
  expect(old.manifest.manifestSha256).toBe("0a6738bdf3231940e80ff4e13490799ef5468a65884120492aadd9fd3b4e44af");
  expect(old.manifest.cells[0]?.requestSha256).toBe("0a63b330f4034c662778c9ca3f70e0ff1a964053200c8f56499c25583107438e");
  expect(current.fixtures.slice(0, 16)).toEqual(old.fixtures);
  expect(current.cells.slice(0, 16)).toEqual(old.cells);
  expect(current.manifest.configSha256).not.toBe(old.manifest.configSha256);
  expect(current.fixtureSha256).not.toBe(old.fixtureSha256);
  // A new run must collect fresh observations for every case, including old controls.
  expect(() => auditBeamJudgeCalibrationV2(config, [observation(0, "yes")])).toThrow("identity mismatch");
});

test("V2 adds balanced invented coverage, distraction, paraphrase and reversal controls without sending expected labels", () => {
  const plan = prepareBeamJudgeCalibrationV2(config);
  expect(plan.fixtures).toHaveLength(24); expect(plan.fixtures.filter(row => row.expected)).toHaveLength(12);
  expect(plan.fixtures.slice(16).map(row => row.key)).toEqual([
    "final-facet-coverage/positive", "final-facet-coverage/negative", "verbose-distractors/positive", "verbose-distractors/negative",
    "complete-paraphrase/positive", "complete-paraphrase/negative", "reversed-order/positive", "reversed-order/negative",
  ]);
  for (let i = 16; i < 24; i += 2) {
    expect(plan.fixtures[i]?.question).toBe(plan.fixtures[i + 1]?.question);
    expect(plan.fixtures[i]?.reference).toEqual(plan.fixtures[i + 1]?.reference);
    expect(plan.fixtures[i]?.expected).toBeTrue(); expect(plan.fixtures[i + 1]?.expected).toBeFalse();
    expect(plan.fixtures[i]?.response).not.toBe(plan.fixtures[i + 1]?.response);
  }
  for (const cell of plan.cells) {
    expect(cell.request.protocol).toBe("oh.beam-custom-binary-judge.v2");
    expect(cell.request.prompt).not.toContain('"expected":'); expect(cell.request.prompt).not.toContain(cell.key);
    expect(canonicalSha256(cell.request)).toBe(plan.manifest.cells.find(row => row.key === cell.key)?.requestSha256);
    expect(Object.isFrozen(cell.request)).toBeTrue();
  }
});

function matchingV2Observations() {
  const plan = prepareBeamJudgeCalibrationV2(config);
  return plan.manifest.cells.map((cell, i) => ({ ...cell, configSha256: plan.manifest.configSha256,
    response: plan.fixtures[i]!.expected ? "yes" : "no" }));
}

test("assessment requires perfect complete agreement on the fixed suite and preserves its narrow scope", () => {
  // These responses are mocked to exercise assessment, not evidence of live judge agreement.
  const result = assessBeamJudgeCalibrationV2(config, matchingV2Observations());
  expect(result).toMatchObject({ status: "pass", complete: true, expectedCells: 24, observedCells: 24, resolvedCases: 24,
    correctCases: 24, incorrectCases: 0, missingCases: 0, unresolvedCases: 0, expectedPositiveCases: 12,
    expectedNegativeCases: 12, agreementOverAllExpected: 1, scope: "invented-development-fixture-agreement-only" });
  expect(Object.isFrozen(result)).toBeTrue(); expect(Object.isFrozen(result.cases[0])).toBeTrue();
  expect("qualified" in result).toBeFalse();
  const old = assessBeamJudgeCalibrationV1(config, Array.from({ length: 16 }, (_, i) => observation(i, i % 2 ? "no" : "yes")));
  expect(old).toMatchObject({ status: "pass", expectedCells: 16, correctCases: 16, expectedPositiveCases: 8, expectedNegativeCases: 8 });
});

test("passing the old sixteen cannot mask a new false positive or false negative", () => {
  for (const index of [17, 20, 23]) {
    const rows = matchingV2Observations(); rows[index]!.response = rows[index]!.response === "yes" ? "no" : "yes";
    const result = assessBeamJudgeCalibrationV2(config, rows);
    expect(result).toMatchObject({ status: "fail", complete: true, correctCases: 23, incorrectCases: 1,
      expectedCells: 24, resolvedCases: 24, agreementOverAllExpected: 23 / 24 });
    expect(result.confusion.falsePositive + result.confusion.falseNegative).toBe(1);
  }
  const yes = assessBeamJudgeCalibrationV2(config, matchingV2Observations().map(row => ({ ...row, response: "yes" })));
  expect(yes).toMatchObject({ status: "fail", correctCases: 12, incorrectCases: 12, expectedCells: 24, agreementOverAllExpected: 0.5 });
  expect(yes.confusion.falsePositive).toBe(12);
});

test("missing and malformed cases remain visible in the full denominator, including a fully absent run", () => {
  const firstSixteen = assessBeamJudgeCalibrationV2(config, matchingV2Observations().slice(0, 16));
  expect(firstSixteen).toMatchObject({ status: "incomplete", correctCases: 16, missingCases: 8,
    unresolvedCases: 0, expectedCells: 24, agreementOverAllExpected: 16 / 24 });
  const rows = matchingV2Observations().slice(0, 23); rows[22]!.response = "yes because";
  expect(assessBeamJudgeCalibrationV2(config, rows)).toMatchObject({ status: "incomplete", correctCases: 22,
    resolvedCases: 22, missingCases: 1, unresolvedCases: 1, expectedCells: 24, agreementOverAllExpected: 22 / 24 });
  expect(assessBeamJudgeCalibrationV2(config, [])).toMatchObject({ status: "incomplete", correctCases: 0,
    resolvedCases: 0, missingCases: 24, expectedCells: 24, agreementOverAllExpected: 0 });
});

test("V2 rejects duplicate, foreign, oversized, mislabeled and wrong-config observations before assessment", () => {
  const rows = matchingV2Observations(), first = rows[0]!;
  for (const invalid of [[...rows, first], [first, first], [{ ...first, key: "foreign" }],
    [{ ...first, expected: true }], [{ ...first, configSha256: "0".repeat(64) }], [{ ...first, requestSha256: "0".repeat(64) }]]) {
    expect(() => assessBeamJudgeCalibrationV2(config, invalid)).toThrow();
  }
  expect(() => assessBeamJudgeCalibrationV2({ ...config, model: "different" }, rows)).toThrow("identity mismatch");
});
