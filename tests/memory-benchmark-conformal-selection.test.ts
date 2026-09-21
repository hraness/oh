import { describe, expect, test } from "bun:test";
import {
  conformalSelect, conformalThreshold, expectedCoverage,
  CONFORMAL_MAX_CALIBRATION_ROWS, CONFORMAL_SELECTION_PROTOCOL,
  type ConformalCalibrationRow,
} from "../scripts/benchmarks/conformal-selection";

/** Twenty positive scores 0.50, 0.52, …, 0.88 plus three negative rows whose
 * scores (including the 0.99 outlier) must not move the positive quantile. */
const positiveScores = Array.from({ length: 20 }, (_, index) => 0.5 + index * 0.02);
const calibration: ConformalCalibrationRow[] = [
  ...positiveScores.map((score) => ({ score, label: 1 as const })),
  { score: 0.99, label: 0 }, { score: 0.7, label: 0 }, { score: 0.05, label: 0 },
];

describe("conformalThreshold", () => {
  test("lands on the floor((n+1)*alpha) order statistic of positive scores", () => {
    const artifact = conformalThreshold(calibration, 0.1);
    // r = floor(21 * 0.1) = 2 → second-smallest positive score.
    expect(artifact.threshold).toBe(positiveScores[1]!);
    expect(artifact.rank).toBe(2);
    expect(artifact.positives).toBe(20);
    expect(artifact.samples).toBe(23);
    expect(artifact.unbounded).toBe(false);
    expect(artifact.alpha).toBe(0.1);
    expect(artifact.protocol).toBe(CONFORMAL_SELECTION_PROTOCOL);
    expect(artifact.calibrationSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("raises the order statistic for a stricter alpha", () => {
    const artifact = conformalThreshold(calibration, 0.5);
    // r = floor(21 * 0.5) = 10 → tenth-smallest positive score.
    expect(artifact.rank).toBe(10);
    expect(artifact.threshold).toBe(positiveScores[9]!);
    expect(artifact.coverage).toBeCloseTo(11 / 21, 12);
  });

  test("rank 0 admits the whole score domain when (n+1)*alpha < 1", () => {
    const artifact = conformalThreshold(
      [{ score: 0.9, label: 1 }, { score: 0.8, label: 1 }, { score: 0.7, label: 1 }], 0.1);
    // r = floor(4 * 0.1) = 0 → threshold 0 keeps every in-domain score.
    expect(artifact.rank).toBe(0);
    expect(artifact.threshold).toBe(0);
    expect(artifact.coverage).toBe(1);
    expect(artifact.unbounded).toBe(false);
  });

  test("empty positives return an unbounded null threshold without throwing", () => {
    const artifact = conformalThreshold([{ score: 0.9, label: 0 }, { score: 0.1, label: 0 }], 0.1);
    expect(artifact.threshold).toBeNull();
    expect(artifact.unbounded).toBe(true);
    expect(artifact.rank).toBeNull();
    expect(artifact.coverage).toBe(0);
    expect(artifact.positives).toBe(0);
    expect(artifact.calibrationSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("rejects out-of-range alpha and malformed rows", () => {
    for (const alpha of [0, 1, -0.2, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => conformalThreshold(calibration, alpha)).toThrow("alpha");
    }
    expect(() => conformalThreshold([{ score: 0.5, label: 2 as never }], 0.1)).toThrow("label");
    expect(() => conformalThreshold([{ score: 0.5, label: "1" as never }], 0.1)).toThrow("label");
    expect(() => conformalThreshold([{ score: 0.5, label: 0.5 as never }], 0.1)).toThrow("label");
    expect(() => conformalThreshold([{ score: 1.5, label: 1 }], 0.1)).toThrow("score");
    expect(() => conformalThreshold([{ score: Number.NaN, label: 1 }], 0.1)).toThrow("score");
    expect(() => conformalThreshold([{ score: -0.05, label: 1 }], 0.1)).toThrow("score");
    expect(() => conformalThreshold(
      new Array(CONFORMAL_MAX_CALIBRATION_ROWS + 1).fill({ score: 0.5, label: 1 }), 0.1)).toThrow("at most");
  });
});

describe("expectedCoverage", () => {
  test("reports the honest finite-sample bound, never below the target", () => {
    const coverage = expectedCoverage(calibration, 0.1);
    // Achieved bound: (n+1-r)/(n+1) = 19/21 ≈ 0.9048 ≥ 0.9 nominal.
    expect(coverage).toBeCloseTo(19 / 21, 12);
    expect(coverage).toBeGreaterThanOrEqual(0.9);
    expect(coverage).toBe(conformalThreshold(calibration, 0.1).coverage);
  });

  test("is 0 when the calibration set has no positives", () => {
    expect(expectedCoverage([{ score: 0.4, label: 0 }], 0.1)).toBe(0);
  });
});

describe("conformalSelect", () => {
  const artifact = conformalThreshold(calibration, 0.1); // threshold = positiveScores[1]

  test("partitions candidates at the threshold in score-desc, id-asc order", () => {
    const result = conformalSelect({
      candidates: [
        { id: "c-below", score: 0.51 },
        { id: "c-tie-b", score: 0.9 },
        { id: "c-edge", score: positiveScores[1]! },
        { id: "c-tie-a", score: 0.9 },
        { id: "c-low", score: 0.01 },
      ],
      threshold: artifact,
    });
    expect(result.selected).toEqual(["c-tie-a", "c-tie-b", "c-edge"]);
    expect(result.threshold).toBe(positiveScores[1]!);
    expect(result.unbounded).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.bound).toEqual({ targetRecall: 0.9, coverage: 19 / 21, assumption: "exchangeability" });
    expect(result.calibrationSha256).toBe(artifact.calibrationSha256);
    expect(result.selectionSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.protocol).toBe(CONFORMAL_SELECTION_PROTOCOL);
  });

  test("null and unbounded thresholds select nothing without throwing", () => {
    const unbounded = conformalThreshold([{ score: 0.9, label: 0 }], 0.1);
    const candidates = [{ id: "a", score: 0.9 }, { id: "b", score: 0.4 }];
    const fromArtifact = conformalSelect({ candidates, threshold: unbounded });
    expect(fromArtifact.selected).toEqual([]);
    expect(fromArtifact.unbounded).toBe(true);
    expect(fromArtifact.bound).toEqual({ targetRecall: 0.9, coverage: 0, assumption: "exchangeability" });
    const bare = conformalSelect({ candidates, threshold: null });
    expect(bare.selected).toEqual([]);
    expect(bare.unbounded).toBe(true);
    expect(bare.bound.targetRecall).toBeNull();
    expect(bare.bound.coverage).toBeNull();
    expect(bare.truncated).toBe(false);
    expect(bare.selectionSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("is deterministic across runs and candidate input order", () => {
    const candidates = [
      { id: "b", score: 0.7 }, { id: "a", score: 0.7 }, { id: "c", score: 0.9 }, { id: "d", score: 0.1 },
    ];
    const first = conformalSelect({ candidates, threshold: artifact });
    const second = conformalSelect({ candidates, threshold: artifact });
    const shuffled = conformalSelect({ candidates: [...candidates].reverse(), threshold: artifact });
    expect(second.selectionSha256).toBe(first.selectionSha256);
    expect(shuffled.selectionSha256).toBe(first.selectionSha256);
    expect(first.selected).toEqual(["c", "a", "b"]);
    expect(conformalThreshold(calibration, 0.1).calibrationSha256).toBe(artifact.calibrationSha256);
  });

  test("truncates by selection order under a byte budget", () => {
    const candidates = [{ id: "k1", score: 0.9 }, { id: "k2", score: 0.8 }, { id: "k3", score: 0.7 }];
    const bytes = { k1: 10, k2: 10, k3: 10 };
    const capped = conformalSelect({ candidates, threshold: artifact, budgetBytes: 25, bytes });
    expect(capped.selected).toEqual(["k1", "k2"]);
    expect(capped.truncated).toBe(true);
    expect(capped.selectedBytes).toBe(20);
    expect(capped.budgetBytes).toBe(25);
    const full = conformalSelect({ candidates, threshold: artifact, budgetBytes: 30, bytes });
    expect(full.selected).toEqual(["k1", "k2", "k3"]);
    expect(full.truncated).toBe(false);
    const zero = conformalSelect({ candidates, threshold: artifact, budgetBytes: 0, bytes });
    expect(zero.selected).toEqual([]);
    expect(zero.truncated).toBe(true);
  });

  test("rejects malformed inputs", () => {
    const candidates = [{ id: "a", score: 0.9 }];
    expect(() => conformalSelect({ candidates: [...candidates, { id: "a", score: 0.4 }], threshold: 0.5 }))
      .toThrow("duplicated");
    expect(() => conformalSelect({ candidates, threshold: Number.NaN })).toThrow("finite");
    expect(() => conformalSelect({ candidates, threshold: artifact, budgetBytes: 10 })).toThrow("bytes");
    expect(() => conformalSelect({ candidates, threshold: artifact, budgetBytes: -1, bytes: { a: 1 } }))
      .toThrow("budgetBytes");
    expect(() => conformalSelect({ candidates, threshold: artifact, budgetBytes: 1.5, bytes: { a: 1 } }))
      .toThrow("budgetBytes");
    expect(() => conformalSelect({ candidates, threshold: artifact, bytes: { a: 1.5 } })).toThrow("bytes");
    expect(() => conformalSelect({ candidates: [{ id: "a", score: 1.4 }], threshold: 0.5 })).toThrow("score");
    expect(() => conformalSelect({ candidates, threshold: 0.5, alpha: 2 })).toThrow("alpha");
    expect(() => conformalSelect({ candidates, threshold: artifact, alpha: 0.2 })).toThrow("agrees");
    expect(() => conformalSelect({ candidates, threshold: { threshold: 0.5 } as never })).toThrow("artifact");
  });

  test("accepts a bare threshold with an explicit alpha for the bound target", () => {
    const result = conformalSelect({ candidates: [{ id: "a", score: 0.9 }, { id: "b", score: 0.4 }], threshold: 0.5, alpha: 0.2 });
    expect(result.selected).toEqual(["a"]);
    expect(result.bound.targetRecall).toBeCloseTo(0.8);
    expect(result.bound.coverage).toBeNull();
    expect(result.calibrationSha256).toBeNull();
  });
});
