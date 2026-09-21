/**
 * Benchmark-scoped score calibration for ordinal relevance signals.
 *
 * Jev pointwise scores are ordinal rank signals, not calibrated probabilities
 * (measured ECE ≈ 0.155: every annotated positive scored ≤ 0.52 while unjudged
 * topical items reached 0.99). This module fits monotone calibrators on
 * (score, label) pairs so downstream selection can reason in probabilities.
 *
 * Boundary: calibration fits only on development-labeled data, never on the
 * evaluation cohort. All fitting is deterministic — fixed iteration order and
 * iteration counts, no clocks, no randomness — and every fitted model carries
 * the SHA-256 digest of both its canonical payload and its exact training
 * input for auditability. Not part of the public package surface.
 */
import {
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  type Sha256Hex,
} from "../../src/canonical";

export const ISOTONIC_MODEL_KIND = "oh.benchmark.calibration.isotonic.v1" as const;
export const PLATT_MODEL_KIND = "oh.benchmark.calibration.platt.v1" as const;

export const CALIBRATION_LIMITS_V1 = Object.freeze({
  maximumBins: 1_000,
  maximumFolds: 1_000,
  maximumSamples: 1_000_000,
  plattIterations: 100,
  plattMinimumWeight: 1e-12,
  plattRidge: 1e-9,
  plattTolerance: 1e-12,
  probabilityEpsilon: 1e-15,
});

export type CalibrationLabel = 0 | 1;
export type CalibrationSample = Readonly<{ label: CalibrationLabel; score: number }>;
export type CalibrationPrediction = Readonly<{ label: CalibrationLabel; prediction: number }>;

export type IsotonicStep = Readonly<{ threshold: number; value: number }>;

export type IsotonicModel = Readonly<{
  inputSha256: Sha256Hex;
  kind: typeof ISOTONIC_MODEL_KIND;
  modelSha256: Sha256Hex;
  samples: number;
  steps: readonly IsotonicStep[];
}>;

export type PlattModel = Readonly<{
  a: number;
  b: number;
  inputSha256: Sha256Hex;
  iterations: number;
  kind: typeof PLATT_MODEL_KIND;
  modelSha256: Sha256Hex;
  samples: number;
}>;

export type CalibrationMetrics = Readonly<{ brier: number; ece: number; logLoss: number }>;

export type CalibratorReport = Readonly<{
  folds: number;
  isotonic: CalibrationMetrics;
  platt: CalibrationMetrics;
  raw: CalibrationMetrics;
  reportSha256: Sha256Hex;
  samples: number;
}>;

function fail(reason: string): never {
  throw new TypeError(`Jev calibration: ${reason}`);
}

/** Negative zero is rejected so every accepted value is canonical-JSON safe. */
function parseProbabilityField(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0) || value < 0 || value > 1) {
    fail(`${path} must be a finite number in [0, 1]`);
  }
  return value;
}

function parseLabelField(value: unknown, path: string): CalibrationLabel {
  if (value !== 0 && value !== 1) fail(`${path} must be the binary label 0 or 1`);
  return value === 1 ? 1 : 0;
}

function parseSample(value: unknown, path: string): CalibrationSample {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["label", "score"])) {
    fail(`${path} must be a plain record with exactly the keys label and score`);
  }
  return Object.freeze({
    label: parseLabelField(value.label, `${path}.label`),
    score: parseProbabilityField(value.score, `${path}.score`),
  });
}

function denseBoundedList(input: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(input) || input.length === 0
    || input.length > CALIBRATION_LIMITS_V1.maximumSamples
    || Reflect.ownKeys(input).length !== input.length + 1) {
    fail(`${path} must be a non-empty dense array of at most ${CALIBRATION_LIMITS_V1.maximumSamples} items`);
  }
  return input as readonly unknown[];
}

function parseSamples(input: unknown): readonly CalibrationSample[] {
  const list = denseBoundedList(input, "samples");
  const parsed = new Array<CalibrationSample>(list.length);
  for (let index = 0; index < list.length; index += 1) {
    parsed[index] = parseSample(list[index], `samples[${index}]`);
  }
  return Object.freeze(parsed);
}

type LabeledProbability = Readonly<{ label: CalibrationLabel; probability: number }>;

/**
 * Accepts `{score, label}` samples and `{prediction, label}` held-out
 * predictions interchangeably; the numeric field is the confidence estimate.
 */
function parseLabeledProbability(value: unknown, path: string): LabeledProbability {
  if (!isPlainRecord(value)) fail(`${path} must be a plain record`);
  let probability: unknown;
  if (hasExactKeys(value, ["label", "score"])) probability = value.score;
  else if (hasExactKeys(value, ["label", "prediction"])) probability = value.prediction;
  else fail(`${path} must have exactly the keys label plus score or prediction`);
  return {
    label: parseLabelField(value.label, `${path}.label`),
    probability: parseProbabilityField(probability, `${path}.probability`),
  };
}

function parseLabeledProbabilities(input: unknown): readonly LabeledProbability[] {
  const list = denseBoundedList(input, "predictions");
  const parsed = new Array<LabeledProbability>(list.length);
  for (let index = 0; index < list.length; index += 1) {
    parsed[index] = parseLabeledProbability(list[index], `predictions[${index}]`);
  }
  return parsed;
}

function parseBins(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)
    || value < 1 || value > CALIBRATION_LIMITS_V1.maximumBins) {
    fail(`bins must be an integer in [1, ${CALIBRATION_LIMITS_V1.maximumBins}]`);
  }
  return value;
}

/** Keeps computed values canonical-JSON safe; negative zero cannot survive a digest. */
function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function clampProbability(value: number): number {
  if (value < CALIBRATION_LIMITS_V1.probabilityEpsilon) return CALIBRATION_LIMITS_V1.probabilityEpsilon;
  if (value > 1 - CALIBRATION_LIMITS_V1.probabilityEpsilon) return 1 - CALIBRATION_LIMITS_V1.probabilityEpsilon;
  return value;
}

function inputDigest(kind: string, samples: readonly CalibrationSample[]): Sha256Hex {
  return canonicalSha256({ kind, samples });
}

/**
 * Pool-adjacent-violators monotone non-decreasing regression. Points are sorted
 * by score with a stable index tie-break; adjacent blocks violating monotonicity
 * are merged into their label-mean until the block values are non-decreasing.
 * The model is the resulting sorted step function: one `{threshold, value}` step
 * per final block, where threshold is the block's minimum score.
 */
export function fitIsotonic(input: unknown): IsotonicModel {
  const samples = parseSamples(input);
  const inputSha256 = inputDigest(ISOTONIC_MODEL_KIND, samples);
  const sorted = samples
    .map((sample, index) => ({ index, label: sample.label, score: sample.score }))
    .sort((left, right) => left.score - right.score || left.index - right.index);
  const blocks: Array<{ max: number; min: number; sum: number; weight: number }> = [];
  for (const point of sorted) {
    blocks.push({ max: point.score, min: point.score, sum: point.label, weight: 1 });
    while (blocks.length >= 2) {
      const right = blocks[blocks.length - 1]!;
      const left = blocks[blocks.length - 2]!;
      if (left.sum / left.weight <= right.sum / right.weight) break;
      blocks.splice(blocks.length - 2, 2, {
        max: right.max,
        min: left.min,
        sum: left.sum + right.sum,
        weight: left.weight + right.weight,
      });
    }
  }
  const steps = Object.freeze(blocks.map((block) => Object.freeze({
    threshold: block.min,
    value: canonicalNumber(block.sum / block.weight),
  })));
  const payload = {
    inputSha256,
    kind: ISOTONIC_MODEL_KIND,
    samples: samples.length,
    steps,
  };
  return Object.freeze({ ...payload, modelSha256: canonicalSha256(payload) });
}

/**
 * Step-function prediction: the value of the last step whose threshold is at
 * most the score. Scores below the first threshold take the first step's value,
 * keeping the result in [0, 1] and non-decreasing in score.
 */
export function predictIsotonic(model: IsotonicModel, score: number): number {
  if (!isPlainRecord(model) || model.kind !== ISOTONIC_MODEL_KIND
    || !Array.isArray(model.steps) || model.steps.length === 0) {
    fail("an isotonic model with a non-empty steps array is required");
  }
  const parsed = parseProbabilityField(score, "score");
  let low = 0;
  let high = model.steps.length - 1;
  let chosen = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const step: unknown = model.steps[mid];
    const threshold = isPlainRecord(step) ? step.threshold : undefined;
    if (typeof threshold === "number" && threshold <= parsed) {
      chosen = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const chosenStep: unknown = model.steps[chosen];
  const value = isPlainRecord(chosenStep) ? chosenStep.value : undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail("model step value must be a finite number in [0, 1]");
  }
  return value;
}

/**
 * Platt scaling: a logistic sigmoid on the raw score, fit by deterministic
 * Newton iterations (fixed cap, fixed tolerance, fixed ridge) against
 * prior-count regularized targets — positives aim at (N+ + 1)/(N+ + 2) and
 * negatives at 1/(N- + 2), per Platt's original correction.
 */
export function fitPlatt(input: unknown): PlattModel {
  const samples = parseSamples(input);
  const inputSha256 = inputDigest(PLATT_MODEL_KIND, samples);
  let positives = 0;
  for (const sample of samples) positives += sample.label;
  const negatives = samples.length - positives;
  const targetPositive = (positives + 1) / (positives + 2);
  const targetNegative = 1 / (negatives + 2);
  let a = 0;
  let b = Math.log((negatives + 1) / (positives + 1));
  let iterations = 0;
  while (iterations < CALIBRATION_LIMITS_V1.plattIterations) {
    iterations += 1;
    let gradientA = 0;
    let gradientB = 0;
    let hAA = CALIBRATION_LIMITS_V1.plattRidge;
    let hAB = 0;
    let hBB = CALIBRATION_LIMITS_V1.plattRidge;
    for (const sample of samples) {
      const target = sample.label === 1 ? targetPositive : targetNegative;
      const p = sigmoid(a * sample.score + b);
      const weight = Math.max(p * (1 - p), CALIBRATION_LIMITS_V1.plattMinimumWeight);
      const residual = p - target;
      gradientA += residual * sample.score;
      gradientB += residual;
      hAA += weight * sample.score * sample.score;
      hAB += weight * sample.score;
      hBB += weight;
    }
    const determinant = hAA * hBB - hAB * hAB;
    if (!Number.isFinite(determinant) || determinant <= 0) break;
    const stepA = (hBB * gradientA - hAB * gradientB) / determinant;
    const stepB = (hAA * gradientB - hAB * gradientA) / determinant;
    const nextA = a - stepA;
    const nextB = b - stepB;
    if (!Number.isFinite(nextA) || !Number.isFinite(nextB)) break;
    a = nextA;
    b = nextB;
    if (Math.abs(stepA) + Math.abs(stepB) <= CALIBRATION_LIMITS_V1.plattTolerance) break;
  }
  const payload = {
    a: canonicalNumber(a),
    b: canonicalNumber(b),
    inputSha256,
    iterations,
    kind: PLATT_MODEL_KIND,
    samples: samples.length,
  };
  return Object.freeze({ ...payload, modelSha256: canonicalSha256(payload) });
}

/** Sigmoid on the learned linear map, clamped strictly inside (0, 1). */
export function predictPlatt(model: PlattModel, score: number): number {
  if (!isPlainRecord(model) || model.kind !== PLATT_MODEL_KIND
    || typeof model.a !== "number" || !Number.isFinite(model.a)
    || typeof model.b !== "number" || !Number.isFinite(model.b)) {
    fail("a Platt model with finite coefficients a and b is required");
  }
  const parsed = parseProbabilityField(score, "score");
  return clampProbability(sigmoid(model.a * parsed + model.b));
}

/**
 * Standard equal-width expected calibration error: Σ (|bin|/N)·|accuracy −
 * confidence| over `bins` uniform bins of the prediction.
 */
export function expectedCalibrationError(input: unknown, bins = 10): number {
  const entries = parseLabeledProbabilities(input);
  const binCount = parseBins(bins);
  const confidenceSums = new Array<number>(binCount).fill(0);
  const labelSums = new Array<number>(binCount).fill(0);
  const counts = new Array<number>(binCount).fill(0);
  for (const entry of entries) {
    const bin = Math.min(binCount - 1, Math.floor(entry.probability * binCount));
    confidenceSums[bin]! += entry.probability;
    labelSums[bin]! += entry.label;
    counts[bin]! += 1;
  }
  let ece = 0;
  for (let bin = 0; bin < binCount; bin += 1) {
    const count = counts[bin]!;
    if (count === 0) continue;
    const accuracy = labelSums[bin]! / count;
    const confidence = confidenceSums[bin]! / count;
    ece += (count / entries.length) * Math.abs(accuracy - confidence);
  }
  return canonicalNumber(ece);
}

/** Mean squared error of the probabilistic predictions. */
export function brierScore(input: unknown): number {
  const entries = parseLabeledProbabilities(input);
  let sum = 0;
  for (const entry of entries) {
    const difference = entry.probability - entry.label;
    sum += difference * difference;
  }
  return canonicalNumber(sum / entries.length);
}

/** Mean binary cross-entropy with clamped probabilities. */
export function logLoss(input: unknown): number {
  const entries = parseLabeledProbabilities(input);
  let sum = 0;
  for (const entry of entries) {
    const p = clampProbability(entry.probability);
    sum += entry.label === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return canonicalNumber(sum / entries.length);
}

function metricsOf(predictions: readonly CalibrationPrediction[], bins: number): CalibrationMetrics {
  return Object.freeze({
    brier: brierScore(predictions),
    ece: expectedCalibrationError(predictions, bins),
    logLoss: logLoss(predictions),
  });
}

function parseEvaluateOptions(options: unknown, sampleCount: number): { bins: number; folds: number } {
  let bins = 10;
  let folds = 5;
  if (options !== undefined) {
    if (!isPlainRecord(options)) fail("options must be a plain record");
    for (const key of Reflect.ownKeys(options)) {
      if (key !== "bins" && key !== "folds") fail(`unknown option ${String(key)}`);
    }
    if (options.folds !== undefined) {
      const requested = options.folds;
      if (typeof requested !== "number" || !Number.isInteger(requested)
        || requested < 2 || requested > CALIBRATION_LIMITS_V1.maximumFolds) {
        fail(`folds must be an integer in [2, ${CALIBRATION_LIMITS_V1.maximumFolds}]`);
      }
      folds = requested;
    }
    if (options.bins !== undefined) bins = parseBins(options.bins);
  }
  if (folds > sampleCount) {
    fail("folds must not exceed the sample count so every held-out fold is non-empty");
  }
  return { bins, folds };
}

/**
 * Deterministic k-fold evaluation: sample index % folds assigns the held-out
 * fold, models fit on the remaining folds, and metrics pool every held-out
 * prediction. `raw` scores the uncalibrated score itself as the baseline.
 */
export function evaluateCalibrator(input: unknown, options: unknown = undefined): CalibratorReport {
  const samples = parseSamples(input);
  const { bins, folds } = parseEvaluateOptions(options, samples.length);
  const isotonicHeld: CalibrationPrediction[] = [];
  const plattHeld: CalibrationPrediction[] = [];
  const rawHeld: CalibrationPrediction[] = [];
  for (let fold = 0; fold < folds; fold += 1) {
    const train: CalibrationSample[] = [];
    const held: CalibrationSample[] = [];
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      if (index % folds === fold) held.push(sample);
      else train.push(sample);
    }
    const isotonicModel = fitIsotonic(train);
    const plattModel = fitPlatt(train);
    for (const sample of held) {
      isotonicHeld.push({ label: sample.label, prediction: predictIsotonic(isotonicModel, sample.score) });
      plattHeld.push({ label: sample.label, prediction: predictPlatt(plattModel, sample.score) });
      rawHeld.push({ label: sample.label, prediction: sample.score });
    }
  }
  const report = {
    folds,
    isotonic: metricsOf(isotonicHeld, bins),
    platt: metricsOf(plattHeld, bins),
    raw: metricsOf(rawHeld, bins),
    samples: samples.length,
  };
  return Object.freeze({ ...report, reportSha256: canonicalSha256(report) });
}
