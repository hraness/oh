// Finite-population conditional inference for a fixed-size pool comparison.
// Not ordinary McNemar: this conditions on a hypergeometric urn draw from a
// finite pool of size <= 1000 and maximizes over a nuisance discordant count,
// so inference is conservative; arithmetic and confidence-bound decisions are exact.
//
// All bound/rejection decisions are made in exact rational arithmetic using
// BigInt binomial coefficients, never floating-point log-factorials. This is
// required because floating-point sums of hypergeometric terms can land a
// hair above or below a boundary probability like 1/20 due to roundoff,
// which would silently flip a <= alpha decision at the boundary. The input
// alpha (a JS number) is itself decomposed into its exact IEEE-754 rational
// value before comparison, so the comparison reflects exactly what double
// was passed in, not a decimal approximation of it.

type Fraction = { num: bigint; den: bigint };

// Binomial-coefficient cache is a plain Map created fresh per top-level
// exported call (and threaded through the binary search within a single
// finitePopulationLowerBound call), so its lifetime and size are bounded by
// one invocation; nothing persists across calls or grows unbounded over the
// life of the process.
function chooseBig(n: number, k: number, cache: Map<number, bigint>): bigint {
  if (k < 0 || n < 0 || k > n) return 0n;
  const kk = Math.min(k, n - k);
  if (kk === 0) return 1n;
  const key = n * 1001 + kk;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  // Sequential multiply-then-divide: C(n, i+1) is always an integer, so each
  // intermediate division is exact (a standard property of this recurrence).
  let result = 1n;
  for (let i = 0; i < kk; i++) {
    result = (result * BigInt(n - i)) / BigInt(i + 1);
  }
  cache.set(key, result);
  return result;
}

function hypergeomUpperTailExact(
  D: number,
  A: number,
  m: number,
  w: number,
  cache: Map<number, bigint>
): Fraction {
  const B = D - A;
  const den = chooseBig(D, m, cache);
  const upperX = Math.min(m, A);
  const lowerX = Math.max(w, 0);
  let num = 0n;
  for (let x = lowerX; x <= upperX; x++) {
    num += chooseBig(A, x, cache) * chooseBig(B, m - x, cache);
  }
  return { num, den };
}

function compareFractions(a: Fraction, b: Fraction): number {
  const left = a.num * b.den;
  const right = b.num * a.den;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fractionToNumber(f: Fraction): number {
  if (f.den === 0n) return 0;
  return Number(f.num) / Number(f.den);
}

// Decomposes a finite JS number into the exact rational value it represents
// under IEEE-754 double precision (sign * mantissa * 2^exponent), so that
// comparisons against exact combinatorial fractions are not subject to any
// decimal-to-binary rounding ambiguity beyond what the double itself encodes.
function doubleToRational(x: number): Fraction {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, x);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const sign = hi >>> 31 === 1 ? -1n : 1n;
  const biasedExponent = (hi >>> 20) & 0x7ff;
  const mantissaHigh = hi & 0xfffff;
  let mantissa = (BigInt(mantissaHigh) << 32n) | BigInt(lo);
  let exponent: number;
  if (biasedExponent === 0) {
    exponent = -1074;
  } else {
    mantissa |= 1n << 52n;
    exponent = biasedExponent - 1075;
  }
  let num = sign * mantissa;
  let den = 1n;
  if (exponent >= 0) {
    num <<= BigInt(exponent);
  } else {
    den = 1n << BigInt(-exponent);
  }
  return { num, den };
}

// Least favorable A under H0: A - B <= h, given B = D - A >= 0 and A <= D.
// The hypergeometric upper tail is non-decreasing in A, so the supremum over
// the null-consistent A values sits at this upper bound.
function maxAllowedA(D: number, h: number): number {
  return Math.min(D, Math.floor((D + h) / 2));
}

function pValueForHExact(
  poolSize: number,
  sampleSize: number,
  wins: number,
  losses: number,
  h: number,
  cache: Map<number, bigint>
): Fraction {
  const m = wins + losses;
  const dMin = m;
  const dMax = poolSize - sampleSize + m;
  // Defaults to 0/1: if no discordant-population count D is consistent with
  // this null margin, the null is logically impossible given the observed
  // data, so it is rejected outright (p = 0).
  let best: Fraction = { num: 0n, den: 1n };
  for (let D = dMin; D <= dMax; D++) {
    const K = maxAllowedA(D, h);
    if (K < 0) continue;
    const candidate = hypergeomUpperTailExact(D, K, m, wins, cache);
    if (compareFractions(candidate, best) > 0) {
      best = candidate;
    }
  }
  return best;
}

function assertFiniteInteger(name: string, value: number): void {
  if (
    typeof value !== "number" ||
    Number.isNaN(value) ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    throw new TypeError(`${name} must be a finite integer, received ${value}`);
  }
}

function validateCounts(
  poolSize: number,
  sampleSize: number,
  wins: number,
  losses: number
): void {
  assertFiniteInteger("poolSize", poolSize);
  assertFiniteInteger("sampleSize", sampleSize);
  assertFiniteInteger("wins", wins);
  assertFiniteInteger("losses", losses);
  if (poolSize < 1 || poolSize > 1000) {
    throw new RangeError(`poolSize must satisfy 1 <= poolSize <= 1000, received ${poolSize}`);
  }
  if (sampleSize < 1 || sampleSize > poolSize) {
    throw new RangeError(
      `sampleSize must satisfy 1 <= sampleSize <= poolSize, received ${sampleSize}`
    );
  }
  if (wins < 0 || losses < 0) {
    throw new RangeError(`wins and losses must be >= 0, received wins=${wins}, losses=${losses}`);
  }
  if (wins + losses > sampleSize) {
    throw new RangeError(
      `wins + losses must be <= sampleSize, received ${wins + losses} > ${sampleSize}`
    );
  }
}

function validateNullExcess(poolSize: number, nullExcess: number): void {
  assertFiniteInteger("nullExcess", nullExcess);
  if (nullExcess < -poolSize || nullExcess > poolSize) {
    throw new RangeError(
      `nullExcess must satisfy -poolSize <= nullExcess <= poolSize, received ${nullExcess}`
    );
  }
}

function validateAlpha(alpha: number): void {
  if (typeof alpha !== "number" || Number.isNaN(alpha) || !Number.isFinite(alpha)) {
    throw new TypeError(`alpha must be a finite number, received ${alpha}`);
  }
  if (!(alpha > 0 && alpha < 1)) {
    throw new RangeError(`alpha must satisfy 0 < alpha < 1, received ${alpha}`);
  }
}

export function finitePopulationPValue(
  poolSize: number,
  sampleSize: number,
  wins: number,
  losses: number,
  nullExcess: number = 0
): number {
  validateCounts(poolSize, sampleSize, wins, losses);
  validateNullExcess(poolSize, nullExcess);
  const cache = new Map<number, bigint>();
  const p = pValueForHExact(poolSize, sampleSize, wins, losses, nullExcess, cache);
  return fractionToNumber(p);
}

export function finitePopulationLowerBound(
  poolSize: number,
  sampleSize: number,
  wins: number,
  losses: number,
  alpha: number = 0.025
): number {
  validateCounts(poolSize, sampleSize, wins, losses);
  validateAlpha(alpha);

  const alphaFraction = doubleToRational(alpha);
  const cache = new Map<number, bigint>();

  // p_h is non-decreasing in h (K_h(D) is non-decreasing in h and the
  // hypergeometric tail is non-decreasing in A), so binary search for the
  // largest h with p_h <= alpha is valid. The comparison uses exact rational
  // arithmetic against the exact value of the alpha double, so a p_h that is
  // mathematically exactly equal to alpha (e.g. exactly 1/20) is never
  // misclassified by floating-point roundoff.
  let best = -poolSize - 1;
  let low = -poolSize;
  let high = poolSize;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const p = pValueForHExact(poolSize, sampleSize, wins, losses, mid, cache);
    if (compareFractions(p, alphaFraction) <= 0) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return (best + 1) / poolSize;
}
