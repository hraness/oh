/** Split-conformal candidate selection for benchmark retrieval. Pointwise scores
 * are ordinal, so a fixed top-k carries no recall guarantee; given a held-out
 * labeled calibration set of (score, label) rows, the conformal threshold keeps
 * every candidate scoring at or above the r-th smallest positive calibration
 * score, where r = floor((n+1)*alpha) clamped to [0, n] and n is the number of
 * positive rows. Over exchangeable draws a new relevant item clears that
 * threshold with probability at least (n+1-r)/(n+1) — the honest finite-sample
 * marginal-recall bound, emitted beside the nominal 1-alpha target rather than
 * rounded up to it. With zero positive rows no finite threshold exists: the
 * artifact is `unbounded`, its coverage bound is 0 and selection stays empty
 * instead of silently returning an unguarded set. The module is score-agnostic
 * — calibrated probabilities may be supplied as scores — and is
 * benchmark-scoped only: no transport, no provider access, no clock, fully
 * deterministic. */
import { canonicalSha256, hasExactKeys, isPlainRecord, utf8ByteLength } from "../../src/canonical";

export const CONFORMAL_SELECTION_PROTOCOL = "oh.benchmark.conformal-selection.v1" as const;
export const CONFORMAL_MAX_CALIBRATION_ROWS = 1_000_000;
export const CONFORMAL_MAX_CANDIDATES = 1_000_000;
export const CONFORMAL_MAX_ID_BYTES = 256;
export const CONFORMAL_MAX_BUDGET_BYTES = 1_073_741_824;
export const CONFORMAL_ASSUMPTION = "exchangeability" as const;

export type ConformalLabel = 0 | 1;
export type ConformalCalibrationRow = Readonly<{ score: number; label: ConformalLabel }>;
export type ConformalCandidate = Readonly<{ id: string; score: number }>;

/** Emitted by {@link conformalThreshold}. `rank` is the ascending order
 * statistic r into the sorted positive scores; rank 0 yields threshold 0
 * (admit every in-domain score) and rank is null only when `unbounded`.
 * `coverage` is the achieved finite-sample bound (n+1-r)/(n+1), which is never
 * below the nominal 1-alpha target; it is 0 when the artifact is unbounded. */
export type ConformalThresholdArtifact = Readonly<{
  protocol: typeof CONFORMAL_SELECTION_PROTOCOL;
  alpha: number;
  positives: number;
  samples: number;
  rank: number | null;
  threshold: number | null;
  unbounded: boolean;
  coverage: number;
  calibrationSha256: string;
}>;

/** `targetRecall` and `coverage` are null when selection ran without a
 * threshold artifact (bare numeric threshold, explicit alpha only, or null),
 * because no calibrated finite-sample bound exists to report honestly. */
export type ConformalBound = Readonly<{
  targetRecall: number | null;
  coverage: number | null;
  assumption: typeof CONFORMAL_ASSUMPTION;
}>;

export type ConformalSelectionArtifact = Readonly<{
  protocol: typeof CONFORMAL_SELECTION_PROTOCOL;
  threshold: number | null;
  unbounded: boolean;
  bound: ConformalBound;
  calibrationSha256: string | null;
  budgetBytes: number | null;
  selectedBytes: number | null;
  truncated: boolean;
  selected: readonly string[];
  selectionSha256: string;
}>;

export type ConformalThresholdInput = ConformalThresholdArtifact | number | null;

function checkedAlpha(alpha: unknown): number {
  if (typeof alpha !== "number" || !Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw new RangeError("Conformal alpha must be a finite number in the open interval (0, 1).");
  }
  return alpha;
}

function checkedScore(score: unknown, where: string): number {
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1 || Object.is(score, -0)) {
    throw new RangeError(`Conformal ${where} must be a finite score in [0, 1].`);
  }
  return score;
}

function checkedCalibration(calibration: readonly ConformalCalibrationRow[]): { positives: number[]; samples: number } {
  if (!Array.isArray(calibration) || calibration.length > CONFORMAL_MAX_CALIBRATION_ROWS) {
    throw new RangeError(`Conformal calibration accepts at most ${CONFORMAL_MAX_CALIBRATION_ROWS} rows.`);
  }
  const positives: number[] = [];
  for (const [index, row] of calibration.entries()) {
    if (!isPlainRecord(row) || !hasExactKeys(row, ["score", "label"])) {
      throw new TypeError(`Conformal calibration row ${index} must be a plain {score, label} record.`);
    }
    const score = checkedScore(row.score, `calibration[${index}].score`);
    if ((row.label !== 0 && row.label !== 1) || Object.is(row.label, -0)) {
      throw new RangeError(`Conformal calibration[${index}].label must be the binary label 0 or 1.`);
    }
    if (row.label === 1) positives.push(score);
  }
  return { positives, samples: calibration.length };
}

/** Ascending rank r = floor((n+1)*alpha) clamped to [0, n]; r = 0 means the
 * conformal set covers the whole score domain (threshold 0). The 1e-9 negative
 * bias only ever lowers r when floating-point error nudges the product just
 * above an integer, keeping the emitted threshold conservative — it never
 * under-covers. The achieved marginal bound for the emitted rank is exactly
 * (n+1-r)/(n+1), equivalent to the ceil((n+1)(1-alpha))/(n+1) form. */
function coverageRank(positives: number, alpha: number): number {
  return Math.min(positives, Math.max(0, Math.floor((positives + 1) * alpha - 1e-9)));
}

/** The finite-sample marginal-recall bound actually achieved: (n+1-r)/(n+1)
 * for n positive calibration rows, 0 when the calibration set has no
 * positives. Reports the honest bound, not the nominal 1-alpha target. */
export function expectedCoverage(calibration: readonly ConformalCalibrationRow[], alpha: number): number {
  checkedAlpha(alpha);
  const { positives } = checkedCalibration(calibration);
  const n = positives.length;
  return n === 0 ? 0 : (n + 1 - coverageRank(n, alpha)) / (n + 1);
}

/** Split-conformal recall threshold over the positive calibration scores:
 * selecting every candidate with score >= threshold covers a new relevant item
 * with marginal probability >= `coverage` under exchangeability. A calibration
 * set with no positive rows yields `threshold: null` and `unbounded: true`;
 * the recall bound is then vacuous and {@link conformalSelect} emits an empty
 * selection rather than throwing or silently keeping candidates. */
export function conformalThreshold(
  calibration: readonly ConformalCalibrationRow[],
  alpha: number,
): ConformalThresholdArtifact {
  checkedAlpha(alpha);
  const { positives, samples } = checkedCalibration(calibration);
  const calibrationSha256 = canonicalSha256(calibration);
  const n = positives.length;
  if (n === 0) {
    return { protocol: CONFORMAL_SELECTION_PROTOCOL, alpha, positives: 0, samples,
      rank: null, threshold: null, unbounded: true, coverage: 0, calibrationSha256 };
  }
  const sorted = [...positives].sort((left, right) => left - right);
  const rank = coverageRank(n, alpha);
  const threshold = rank === 0 ? 0 : sorted[rank - 1]!;
  return { protocol: CONFORMAL_SELECTION_PROTOCOL, alpha, positives: n, samples, rank, threshold,
    unbounded: false, coverage: (n + 1 - rank) / (n + 1), calibrationSha256 };
}

type NormalizedThreshold = Readonly<{
  threshold: number | null; alpha: number | null; coverage: number | null; calibrationSha256: string | null;
}>;

const THRESHOLD_ARTIFACT_KEYS = ["alpha", "calibrationSha256", "coverage", "positives",
  "protocol", "rank", "samples", "threshold", "unbounded"] as const;

function normalizedThreshold(value: unknown, alpha: number | undefined): NormalizedThreshold {
  if (value === null || typeof value === "number") {
    const explicit = alpha === undefined ? null : checkedAlpha(alpha);
    if (value === null) return { threshold: null, alpha: explicit, coverage: null, calibrationSha256: null };
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new RangeError("Conformal threshold must be a finite number, a threshold artifact, or null.");
    }
    return { threshold: value, alpha: explicit, coverage: null, calibrationSha256: null };
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, THRESHOLD_ARTIFACT_KEYS) || value.protocol !== CONFORMAL_SELECTION_PROTOCOL) {
    throw new TypeError("Conformal selection needs a conformalThreshold artifact, a finite number, or null.");
  }
  const artifactAlpha = checkedAlpha(value.alpha);
  const positives = value.positives, samples = value.samples, rank = value.rank;
  const artifactThreshold = value.threshold, coverage = value.coverage;
  if (typeof positives !== "number" || !Number.isSafeInteger(positives) || positives < 0 || positives > CONFORMAL_MAX_CALIBRATION_ROWS
    || typeof samples !== "number" || !Number.isSafeInteger(samples) || samples < positives || samples > CONFORMAL_MAX_CALIBRATION_ROWS) {
    throw new RangeError("Conformal threshold artifact has invalid row counts.");
  }
  if (rank !== null && (typeof rank !== "number" || !Number.isSafeInteger(rank) || rank < 0 || rank > positives)) {
    throw new RangeError("Conformal threshold artifact has an invalid rank.");
  }
  if (artifactThreshold !== null
    && (typeof artifactThreshold !== "number" || !Number.isFinite(artifactThreshold) || Object.is(artifactThreshold, -0))) {
    throw new RangeError("Conformal threshold artifact has a non-finite threshold.");
  }
  if (typeof value.unbounded !== "boolean" || value.unbounded !== (artifactThreshold === null)) {
    throw new TypeError("Conformal threshold artifact pairs unbounded with a null threshold.");
  }
  if (typeof coverage !== "number" || !Number.isFinite(coverage) || coverage < 0 || coverage > 1 || Object.is(coverage, -0)) {
    throw new RangeError("Conformal threshold artifact has an invalid coverage bound.");
  }
  const digest = value.calibrationSha256;
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest)) {
    throw new TypeError("Conformal threshold artifact has an invalid calibrationSha256.");
  }
  if (alpha !== undefined && checkedAlpha(alpha) !== artifactAlpha) {
    throw new RangeError("Conformal selection alpha disagrees with the threshold artifact.");
  }
  return { threshold: artifactThreshold, alpha: artifactAlpha, coverage, calibrationSha256: digest };
}

const SELECT_INPUT_KEYS = new Set(["alpha", "budgetBytes", "bytes", "candidates", "threshold"]);

/** Smallest-set selection at the conformal threshold: every candidate with
 * score >= threshold, ordered score descending then id ascending for
 * determinism. `threshold` is normally the artifact emitted by
 * {@link conformalThreshold} — it carries alpha, the achieved coverage bound
 * and the calibration digest into the emitted bound and provenance. A bare
 * finite number or null is also accepted; null (or an unbounded artifact)
 * selects nothing. `budgetBytes` truncates the selection to its longest prefix
 * whose `bytes`-mapped candidate sizes fit the cap and marks `truncated`;
 * `bytes` alone reports `selectedBytes` without truncating. */
export function conformalSelect(input: Readonly<{
  candidates: readonly ConformalCandidate[];
  threshold: ConformalThresholdInput;
  alpha?: number;
  budgetBytes?: number;
  bytes?: Readonly<Record<string, number>>;
}>): ConformalSelectionArtifact {
  if (!isPlainRecord(input)) throw new TypeError("Conformal selection input must be a plain record.");
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !SELECT_INPUT_KEYS.has(key)) {
      throw new TypeError(`Conformal selection input has an unexpected field "${String(key)}".`);
    }
  }
  if (!Object.hasOwn(input, "threshold")) {
    throw new TypeError("Conformal selection needs an explicit threshold field (null is allowed).");
  }
  const { threshold, alpha, coverage, calibrationSha256 } = normalizedThreshold(input.threshold, input.alpha);
  if (!Array.isArray(input.candidates) || input.candidates.length > CONFORMAL_MAX_CANDIDATES) {
    throw new RangeError(`Conformal selection accepts at most ${CONFORMAL_MAX_CANDIDATES} candidates.`);
  }
  const seen = new Set<string>();
  for (const [index, candidate] of input.candidates.entries()) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ["id", "score"])) {
      throw new TypeError(`Conformal candidate ${index} must be a plain {id, score} record.`);
    }
    if (typeof candidate.id !== "string" || candidate.id.length === 0 || utf8ByteLength(candidate.id) > CONFORMAL_MAX_ID_BYTES) {
      throw new TypeError(`Conformal candidate ${index} needs a non-empty id within ${CONFORMAL_MAX_ID_BYTES} bytes.`);
    }
    checkedScore(candidate.score, `candidates[${index}].score`);
    if (seen.has(candidate.id)) throw new TypeError(`Conformal candidate id "${candidate.id}" is duplicated.`);
    seen.add(candidate.id);
  }
  let budgetBytes: number | null = null;
  if (input.budgetBytes !== undefined) {
    if (!Number.isSafeInteger(input.budgetBytes) || input.budgetBytes < 0 || input.budgetBytes > CONFORMAL_MAX_BUDGET_BYTES) {
      throw new RangeError(`Conformal budgetBytes must be a safe integer in 0..${CONFORMAL_MAX_BUDGET_BYTES}.`);
    }
    if (input.bytes === undefined) throw new TypeError("Conformal budgetBytes needs a bytes record keyed by candidate id.");
    budgetBytes = input.budgetBytes;
  }
  let bytes: Readonly<Record<string, number>> | null = null;
  if (input.bytes !== undefined) {
    if (!isPlainRecord(input.bytes)) throw new TypeError("Conformal bytes must be a plain record keyed by candidate id.");
    bytes = input.bytes;
  }
  const eligible = threshold === null ? [] : input.candidates
    .filter((candidate) => candidate.score >= threshold)
    .sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const selected: string[] = [];
  let selectedBytes = 0, truncated = false;
  for (const candidate of eligible) {
    if (bytes !== null) {
      const size = bytes[candidate.id];
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
        throw new TypeError(`Conformal bytes["${candidate.id}"] must be a non-negative safe integer.`);
      }
      if (budgetBytes !== null && selectedBytes + size > budgetBytes) { truncated = true; break; }
      selectedBytes += size;
    }
    selected.push(candidate.id);
  }
  const bound: ConformalBound = {
    targetRecall: alpha === null ? null : 1 - alpha,
    coverage,
    assumption: CONFORMAL_ASSUMPTION,
  };
  const artifact = {
    protocol: CONFORMAL_SELECTION_PROTOCOL,
    threshold,
    unbounded: threshold === null,
    bound,
    calibrationSha256,
    budgetBytes,
    selectedBytes: bytes === null ? null : selectedBytes,
    truncated,
    selected,
  };
  return { ...artifact, selectionSha256: canonicalSha256(artifact) };
}
