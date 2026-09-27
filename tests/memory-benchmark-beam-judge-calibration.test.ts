import { expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { auditBeamJudgeCalibrationV1, prepareBeamJudgeCalibrationV1 } from "../scripts/benchmarks/beam-judge-calibration";

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
