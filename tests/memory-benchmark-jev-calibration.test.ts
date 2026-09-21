import { describe, expect, test } from "bun:test";
import {
  brierScore,
  evaluateCalibrator,
  expectedCalibrationError,
  fitIsotonic,
  fitPlatt,
  ISOTONIC_MODEL_KIND,
  logLoss,
  PLATT_MODEL_KIND,
  predictIsotonic,
  predictPlatt,
  type CalibrationSample,
} from "../scripts/benchmarks/jev-calibration";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

describe("fitIsotonic", () => {
  // Staircase fixture: labels in score order are 0,0,0,1,0,1,1,1,1,1.
  const staircase: CalibrationSample[] = [
    { label: 0, score: 0.1 },
    { label: 0, score: 0.2 },
    { label: 0, score: 0.3 },
    { label: 1, score: 0.4 },
    { label: 0, score: 0.5 },
    { label: 1, score: 0.5 },
    { label: 1, score: 0.6 },
    { label: 1, score: 0.7 },
    { label: 1, score: 0.8 },
    { label: 1, score: 0.9 },
  ];

  test("recovers a monotone step function", () => {
    const model = fitIsotonic(staircase);
    expect(model.kind).toBe(ISOTONIC_MODEL_KIND);
    expect(model.samples).toBe(staircase.length);
    expect(model.steps.length).toBeGreaterThan(1);
    // Step values are non-decreasing in threshold.
    for (let index = 1; index < model.steps.length; index += 1) {
      expect(model.steps[index]!.threshold).toBeGreaterThanOrEqual(model.steps[index - 1]!.threshold);
      expect(model.steps[index]!.value).toBeGreaterThanOrEqual(model.steps[index - 1]!.value);
    }
    // PAVA pooled the 1-then-0 violation at scores 0.4/0.5 into a 0.5 plateau.
    expect(predictIsotonic(model, 0.45)).toBeCloseTo(0.5, 12);
    expect(predictIsotonic(model, 0.05)).toBe(0);
    expect(predictIsotonic(model, 0.95)).toBe(1);
  });

  test("predictions are non-decreasing in score and inside [0, 1]", () => {
    const model = fitIsotonic(staircase);
    let previous = -1;
    for (let index = 0; index <= 100; index += 1) {
      const prediction = predictIsotonic(model, index / 100);
      expect(prediction).toBeGreaterThanOrEqual(0);
      expect(prediction).toBeLessThanOrEqual(1);
      expect(prediction).toBeGreaterThanOrEqual(previous);
      previous = prediction;
    }
  });

  test("fit is deterministic and carries audit digests", () => {
    const first = fitIsotonic(staircase);
    const second = fitIsotonic(staircase.map((sample) => ({ ...sample })));
    expect(first.modelSha256).toBe(second.modelSha256);
    expect(first.inputSha256).toBe(second.inputSha256);
    expect(first.modelSha256).toMatch(SHA256_HEX);
    expect(first.inputSha256).toMatch(SHA256_HEX);
    // Input order is part of the audited preimage.
    expect(fitIsotonic([...staircase].reverse()).inputSha256).not.toBe(first.inputSha256);
  });
});

describe("expectedCalibrationError", () => {
  test("is near zero on a perfectly calibrated synthetic", () => {
    // For each probability p = k/10, ten samples hold exactly k positives, so
    // every bin's mean confidence equals its empirical accuracy.
    const samples: CalibrationSample[] = [];
    for (let tenths = 0; tenths <= 10; tenths += 1) {
      for (let index = 0; index < 10; index += 1) {
        samples.push({ label: index < tenths ? 1 : 0, score: tenths / 10 });
      }
    }
    expect(expectedCalibrationError(samples, 10)).toBeLessThan(1e-9);
  });

  test("is high on a deliberately miscalibrated synthetic", () => {
    const samples: CalibrationSample[] = [];
    for (let index = 0; index < 20; index += 1) {
      samples.push({ label: index < 10 ? 1 : 0, score: 0.99 });
    }
    // Single occupied bin: |0.5 - 0.99| = 0.49.
    expect(expectedCalibrationError(samples, 10)).toBeCloseTo(0.49, 12);
    expect(expectedCalibrationError(samples, 10)).toBeGreaterThan(0.4);
  });

  test("accepts explicit prediction records and respects the bin count", () => {
    const predictions = [
      { label: 1 as const, prediction: 1 },
      { label: 0 as const, prediction: 0 },
      { label: 1 as const, prediction: 0.5 },
    ];
    expect(expectedCalibrationError(predictions, 10)).toBeLessThan(0.2);
    expect(expectedCalibrationError(predictions, 2)).toBeLessThan(0.2);
  });

  test("brierScore and logLoss match hand-computed values", () => {
    const predictions = [
      { label: 1 as const, prediction: 0.9 },
      { label: 0 as const, prediction: 0.2 },
    ];
    expect(brierScore(predictions)).toBeCloseTo((0.01 + 0.04) / 2, 12);
    const expected = (-Math.log(0.9) - Math.log(0.8)) / 2;
    expect(logLoss(predictions)).toBeCloseTo(expected, 12);
  });
});

describe("fitPlatt", () => {
  const separable: CalibrationSample[] = [
    { label: 0, score: 0.1 },
    { label: 0, score: 0.2 },
    { label: 0, score: 0.3 },
    { label: 0, score: 0.4 },
    { label: 1, score: 0.6 },
    { label: 1, score: 0.7 },
    { label: 1, score: 0.8 },
    { label: 1, score: 0.9 },
  ];

  test("separates a clean fixture with predictions strictly inside (0, 1)", () => {
    const model = fitPlatt(separable);
    expect(model.kind).toBe(PLATT_MODEL_KIND);
    expect(model.a).toBeGreaterThan(0);
    expect(model.iterations).toBeGreaterThan(0);
    expect(model.iterations).toBeLessThanOrEqual(100);
    const low = predictPlatt(model, 0.1);
    const high = predictPlatt(model, 0.9);
    expect(low).toBeLessThan(0.5);
    expect(high).toBeGreaterThan(0.5);
    expect(high).toBeGreaterThan(low);
    for (const prediction of [low, high, predictPlatt(model, 0), predictPlatt(model, 1)]) {
      expect(prediction).toBeGreaterThan(0);
      expect(prediction).toBeLessThan(1);
    }
  });

  test("is deterministic: identical input yields identical modelSha256", () => {
    const first = fitPlatt(separable);
    const second = fitPlatt(separable.map((sample) => ({ ...sample })));
    expect(second.modelSha256).toBe(first.modelSha256);
    expect(second.a).toBe(first.a);
    expect(second.b).toBe(first.b);
    expect(second.iterations).toBe(first.iterations);
  });

  test("handles a single-class fixture without divergence", () => {
    const model = fitPlatt([{ label: 1, score: 0.7 }, { label: 1, score: 0.9 }]);
    const prediction = predictPlatt(model, 0.8);
    expect(prediction).toBeGreaterThan(0.5);
    expect(prediction).toBeLessThan(1);
  });
});

describe("evaluateCalibrator", () => {
  // A hard threshold fixture: raw scores are far from empirical rates, so
  // calibration provably reduces held-out ECE.
  const stepwise: CalibrationSample[] = Array.from({ length: 50 }, (_, index) => ({
    label: index >= 25 ? 1 as const : 0 as const,
    score: index / 50,
  }));

  test("report shape is correct", () => {
    const report = evaluateCalibrator(stepwise, { folds: 5 });
    expect(report.samples).toBe(50);
    expect(report.folds).toBe(5);
    expect(report.reportSha256).toMatch(SHA256_HEX);
    for (const section of [report.isotonic, report.platt, report.raw]) {
      expect(Object.keys(section).sort()).toEqual(["brier", "ece", "logLoss"]);
      expect(Number.isFinite(section.ece)).toBe(true);
      expect(Number.isFinite(section.brier)).toBe(true);
      expect(Number.isFinite(section.logLoss)).toBe(true);
    }
  });

  test("held-out isotonic ECE does not exceed raw ECE when calibration helps", () => {
    const report = evaluateCalibrator(stepwise, { folds: 5 });
    expect(report.isotonic.ece).toBeLessThan(report.raw.ece);
    expect(report.platt.ece).toBeLessThan(report.raw.ece);
  });

  test("evaluation is deterministic", () => {
    const first = evaluateCalibrator(stepwise, { folds: 5 });
    const second = evaluateCalibrator(stepwise, { folds: 5 });
    expect(second.reportSha256).toBe(first.reportSha256);
  });
});

describe("input validation", () => {
  test("rejects empty samples", () => {
    expect(() => fitIsotonic([])).toThrow(TypeError);
    expect(() => fitPlatt([])).toThrow(TypeError);
    expect(() => expectedCalibrationError([])).toThrow(TypeError);
    expect(() => evaluateCalibrator([], { folds: 2 })).toThrow(TypeError);
  });

  test("rejects out-of-range and non-finite scores", () => {
    for (const score of [-0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      expect(() => fitIsotonic([{ label: 0, score }])).toThrow(TypeError);
    }
    expect(() => predictIsotonic(fitIsotonic([{ label: 0, score: 0.5 }]), 1.5)).toThrow(TypeError);
    expect(() => predictPlatt(fitPlatt([{ label: 0, score: 0.5 }]), -0.2)).toThrow(TypeError);
  });

  test("rejects non-binary labels", () => {
    for (const label of [2, 0.5, -1, "yes", Number.NaN]) {
      expect(() => fitIsotonic([{ label, score: 0.5 } as unknown as CalibrationSample])).toThrow(TypeError);
    }
    expect(() => fitPlatt([{ label: 1, score: 0.5 }, { label: 3, score: 0.6 } as unknown as CalibrationSample]))
      .toThrow(TypeError);
  });

  test("rejects malformed records and oversized inputs", () => {
    expect(() => fitIsotonic([{ label: 0 }])).toThrow(TypeError);
    expect(() => fitIsotonic([{ label: 0, score: 0.5, extra: 1 }])).toThrow(TypeError);
    expect(() => fitIsotonic(["not a record"])).toThrow(TypeError);
    expect(() => fitIsotonic(new Array(1_000_001).fill({ label: 0, score: 0.5 }))).toThrow(TypeError);
    expect(() => expectedCalibrationError([{ label: 0, confidence: 0.5 }])).toThrow(TypeError);
    expect(() => expectedCalibrationError([{ label: 0, score: 0.5 }], 0)).toThrow(TypeError);
    expect(() => evaluateCalibrator(stepwiseSamples(), { folds: 1 })).toThrow(TypeError);
    expect(() => evaluateCalibrator(stepwiseSamples(), { folds: 999 })).toThrow(TypeError);
  });
});

function stepwiseSamples(): CalibrationSample[] {
  return Array.from({ length: 10 }, (_, index) => ({
    label: index >= 5 ? 1 as const : 0 as const,
    score: index / 10,
  }));
}
