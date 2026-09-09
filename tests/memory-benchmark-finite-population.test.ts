import { describe, expect, test } from "bun:test";
import {
  finitePopulationLowerBound,
  finitePopulationPValue,
} from "../scripts/benchmarks/finite-population";

// Independent combinatorics helper for calibration tests below; deliberately
// not reusing anything from the module under test.
function chooseExact(n: number, k: number): number {
  if (k < 0 || k > n || n < 0) return 0;
  const kk = Math.min(k, n - k);
  let result = 1;
  for (let i = 0; i < kk; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

const TOY_VECTORS: Array<{
  poolSize: number;
  sampleSize: number;
  wins: number;
  losses: number;
  pAtZero: number;
  lower95: number;
  lower975: number;
}> = [
  { poolSize: 4, sampleSize: 2, wins: 2, losses: 0, pAtZero: 1 / 6, lower95: 0, lower975: 0 },
  { poolSize: 6, sampleSize: 3, wins: 3, losses: 0, pAtZero: 1 / 20, lower95: 1 / 6, lower975: 0 },
  {
    poolSize: 6,
    sampleSize: 3,
    wins: 2,
    losses: 1,
    pAtZero: 1 / 2,
    lower95: -1 / 3,
    lower975: -1 / 3,
  },
  { poolSize: 6, sampleSize: 3, wins: 0, losses: 0, pAtZero: 1, lower95: -1 / 2, lower975: -1 / 2 },
  { poolSize: 6, sampleSize: 6, wins: 4, losses: 2, pAtZero: 0, lower95: 1 / 3, lower975: 1 / 3 },
  { poolSize: 6, sampleSize: 6, wins: 3, losses: 3, pAtZero: 1, lower95: 0, lower975: 0 },
  {
    poolSize: 6,
    sampleSize: 6,
    wins: 2,
    losses: 4,
    pAtZero: 1,
    lower95: -1 / 3,
    lower975: -1 / 3,
  },
  { poolSize: 8, sampleSize: 5, wins: 4, losses: 0, pAtZero: 0, lower95: 1 / 4, lower975: 1 / 8 },
];

describe("finitePopulationPValue: toy reference vectors", () => {
  for (const v of TOY_VECTORS) {
    test(`M=${v.poolSize} n=${v.sampleSize} w=${v.wins} l=${v.losses}`, () => {
      const p = finitePopulationPValue(v.poolSize, v.sampleSize, v.wins, v.losses, 0);
      expect(Math.abs(p - v.pAtZero)).toBeLessThan(1e-9);
    });
  }
});

describe("finitePopulationLowerBound: toy reference vectors", () => {
  for (const v of TOY_VECTORS) {
    test(`95% M=${v.poolSize} n=${v.sampleSize} w=${v.wins} l=${v.losses}`, () => {
      const bound = finitePopulationLowerBound(v.poolSize, v.sampleSize, v.wins, v.losses, 0.05);
      expect(Math.abs(bound - v.lower95)).toBeLessThan(1e-9);
    });
    test(`97.5% M=${v.poolSize} n=${v.sampleSize} w=${v.wins} l=${v.losses}`, () => {
      const bound = finitePopulationLowerBound(v.poolSize, v.sampleSize, v.wins, v.losses, 0.025);
      expect(Math.abs(bound - v.lower975)).toBeLessThan(1e-9);
    });
  }
});

describe("exact-alpha boundary regression", () => {
  // Previously miscomputed via floating log-factorials: p_h at h=18 is
  // mathematically exactly 1/20, and the IEEE double 0.05 is exactly
  // (marginally) >= 1/20, so the correct bound is 0.95, not 0.90. This
  // requires exact rational comparison, not float summation with a<=
  // tolerance or epsilon subtraction.
  test("finitePopulationLowerBound(20,19,19,0,0.05) resolves the exact boundary to 0.95", () => {
    const bound = finitePopulationLowerBound(20, 19, 19, 0, 0.05);
    expect(bound).toBe(0.95);
  });

  test("finitePopulationPValue(20,19,19,0,18) is exactly 1/20", () => {
    const p = finitePopulationPValue(20, 19, 19, 0, 18);
    expect(p).toBe(1 / 20);
  });

  test("finitePopulationLowerBound(20,19,19,0,0.025) is not fooled by the same near-boundary value", () => {
    // At the tighter alpha the same h=18 fraction of 1/20 exceeds 0.025, so
    // the achievable bound must drop below 0.95.
    const bound = finitePopulationLowerBound(20, 19, 19, 0, 0.025);
    expect(bound).toBeLessThan(0.95);
  });
});

describe("invalid inputs", () => {
  test("finitePopulationPValue throws on invalid arguments", () => {
    expect(() => finitePopulationPValue(1.5, 1, 0, 0)).toThrow(TypeError);
    expect(() => finitePopulationPValue(NaN, 1, 0, 0)).toThrow(TypeError);
    expect(() => finitePopulationPValue(Infinity, 1, 0, 0)).toThrow(TypeError);
    expect(() => finitePopulationPValue(0, 1, 0, 0)).toThrow(RangeError);
    expect(() => finitePopulationPValue(1001, 1, 0, 0)).toThrow(RangeError);
    expect(() => finitePopulationPValue(10, 0, 0, 0)).toThrow(RangeError);
    expect(() => finitePopulationPValue(10, 11, 0, 0)).toThrow(RangeError);
    expect(() => finitePopulationPValue(10, 5, -1, 0)).toThrow(RangeError);
    expect(() => finitePopulationPValue(10, 5, 0, -1)).toThrow(RangeError);
    expect(() => finitePopulationPValue(10, 5, 3, 3)).toThrow(RangeError);
    expect(() => finitePopulationPValue(10, 5, 1.5, 0)).toThrow(TypeError);
    expect(() => finitePopulationPValue(10, 5, 0, 0, 1.5)).toThrow(TypeError);
    expect(() => finitePopulationPValue(10, 5, 0, 0, 11)).toThrow(RangeError);
    expect(() => finitePopulationPValue(10, 5, 0, 0, -11)).toThrow(RangeError);
    expect(() => finitePopulationPValue(10, 5, 0, 0, NaN)).toThrow(TypeError);
  });

  test("finitePopulationLowerBound throws on invalid arguments", () => {
    expect(() => finitePopulationLowerBound(1.5, 1, 0, 0)).toThrow(TypeError);
    expect(() => finitePopulationLowerBound(0, 1, 0, 0)).toThrow(RangeError);
    expect(() => finitePopulationLowerBound(10, 11, 0, 0)).toThrow(RangeError);
    expect(() => finitePopulationLowerBound(10, 5, -1, 0)).toThrow(RangeError);
    expect(() => finitePopulationLowerBound(10, 5, 3, 3)).toThrow(RangeError);
    expect(() => finitePopulationLowerBound(10, 5, 0, 0, 0)).toThrow(RangeError);
    expect(() => finitePopulationLowerBound(10, 5, 0, 0, 1)).toThrow(RangeError);
    expect(() => finitePopulationLowerBound(10, 5, 0, 0, -0.1)).toThrow(RangeError);
    expect(() => finitePopulationLowerBound(10, 5, 0, 0, NaN)).toThrow(TypeError);
    expect(() => finitePopulationLowerBound(10, 5, 0, 0, Infinity)).toThrow(TypeError);
  });
});

describe("monotonicity of the p-value in the null margin", () => {
  const cases: Array<[number, number, number, number]> = [
    [20, 10, 6, 2],
    [50, 30, 12, 5],
    [8, 5, 4, 0],
    [6, 6, 3, 3],
  ];
  for (const [poolSize, sampleSize, wins, losses] of cases) {
    test(`M=${poolSize} n=${sampleSize} w=${wins} l=${losses} is non-decreasing in h`, () => {
      let prev = finitePopulationPValue(poolSize, sampleSize, wins, losses, -poolSize);
      for (let h = -poolSize + 1; h <= poolSize; h++) {
        const current = finitePopulationPValue(poolSize, sampleSize, wins, losses, h);
        expect(current).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = current;
      }
    });
  }
});

describe("full census (n = poolSize) is exact", () => {
  const cases: Array<[number, number, number]> = [
    [10, 6, 2],
    [10, 3, 3],
    [10, 2, 6],
    [50, 30, 10],
  ];
  for (const [poolSize, wins, losses] of cases) {
    const excess = wins - losses;
    test(`M=${poolSize} w=${wins} l=${losses}: step function at excess=${excess}`, () => {
      expect(finitePopulationPValue(poolSize, poolSize, wins, losses, excess)).toBeCloseTo(1, 9);
      expect(finitePopulationPValue(poolSize, poolSize, wins, losses, excess - 1)).toBeCloseTo(
        0,
        9
      );
    });

    test(`M=${poolSize} w=${wins} l=${losses}: lower bound equals exact excess fraction`, () => {
      const expected = excess / poolSize;
      expect(finitePopulationLowerBound(poolSize, poolSize, wins, losses, 0.025)).toBeCloseTo(
        expected,
        9
      );
      expect(finitePopulationLowerBound(poolSize, poolSize, wins, losses, 0.05)).toBeCloseTo(
        expected,
        9
      );
    });
  }
});

describe("no observed discordance leaves partial-sample uncertainty", () => {
  const cases: Array<[number, number]> = [
    [6, 3],
    [10, 5],
    [20, 10],
  ];
  for (const [poolSize, sampleSize] of cases) {
    test(`M=${poolSize} n=${sampleSize}: p=1 at h=0, negative lower bound`, () => {
      expect(finitePopulationPValue(poolSize, sampleSize, 0, 0, 0)).toBeCloseTo(1, 9);
      const bound95 = finitePopulationLowerBound(poolSize, sampleSize, 0, 0, 0.05);
      const bound975 = finitePopulationLowerBound(poolSize, sampleSize, 0, 0, 0.025);
      expect(bound95).toBeLessThan(0);
      expect(bound975).toBeLessThanOrEqual(bound95 + 1e-9);
    });
  }
});

describe("small-population calibration via direct enumeration", () => {
  test("type-I error probability never exceeds alpha", () => {
    const smallMValues = [4, 6, 8];
    const alphas = [0.025, 0.05];

    for (const poolSize of smallMValues) {
      for (let sampleSize = 1; sampleSize <= poolSize; sampleSize++) {
        for (let candidateOnly = 0; candidateOnly <= poolSize; candidateOnly++) {
          for (
            let baselineOnly = 0;
            candidateOnly + baselineOnly <= poolSize;
            baselineOnly++
          ) {
            const concordant = poolSize - candidateOnly - baselineOnly;
            const trueExcess = candidateOnly - baselineOnly;
            const denom = chooseExact(poolSize, sampleSize);

            for (const alpha of alphas) {
              let typeIProbability = 0;
              const maxWins = Math.min(sampleSize, candidateOnly);
              for (let wins = 0; wins <= maxWins; wins++) {
                const maxLosses = Math.min(sampleSize - wins, baselineOnly);
                for (let losses = 0; losses <= maxLosses; losses++) {
                  const concordantDrawn = sampleSize - wins - losses;
                  if (concordantDrawn < 0 || concordantDrawn > concordant) continue;
                  const numerator =
                    chooseExact(candidateOnly, wins) *
                    chooseExact(baselineOnly, losses) *
                    chooseExact(concordant, concordantDrawn);
                  const probability = numerator / denom;
                  const p = finitePopulationPValue(
                    poolSize,
                    sampleSize,
                    wins,
                    losses,
                    trueExcess
                  );
                  if (p <= alpha) {
                    typeIProbability += probability;
                  }
                }
              }
              expect(typeIProbability).toBeLessThanOrEqual(alpha + 1e-9);
            }
          }
        }
      }
    }
  });

  test("lower-bound coverage: P(trueExcess < lowerBound) never exceeds alpha", () => {
    const smallMValues = [4, 6, 8];
    const alphas = [0.025, 0.05];

    for (const poolSize of smallMValues) {
      for (let sampleSize = 1; sampleSize <= poolSize; sampleSize++) {
        for (let candidateOnly = 0; candidateOnly <= poolSize; candidateOnly++) {
          for (
            let baselineOnly = 0;
            candidateOnly + baselineOnly <= poolSize;
            baselineOnly++
          ) {
            const concordant = poolSize - candidateOnly - baselineOnly;
            const trueExcess = candidateOnly - baselineOnly;
            const denom = chooseExact(poolSize, sampleSize);

            for (const alpha of alphas) {
              let coverageFailureProbability = 0;
              const maxWins = Math.min(sampleSize, candidateOnly);
              for (let wins = 0; wins <= maxWins; wins++) {
                const maxLosses = Math.min(sampleSize - wins, baselineOnly);
                for (let losses = 0; losses <= maxLosses; losses++) {
                  const concordantDrawn = sampleSize - wins - losses;
                  if (concordantDrawn < 0 || concordantDrawn > concordant) continue;
                  const numerator =
                    chooseExact(candidateOnly, wins) *
                    chooseExact(baselineOnly, losses) *
                    chooseExact(concordant, concordantDrawn);
                  const probability = numerator / denom;
                  const bound = finitePopulationLowerBound(
                    poolSize,
                    sampleSize,
                    wins,
                    losses,
                    alpha
                  );
                  if (bound > trueExcess / poolSize + 1e-12) {
                    coverageFailureProbability += probability;
                  }
                }
              }
              expect(coverageFailureProbability).toBeLessThanOrEqual(alpha + 1e-9);
            }
          }
        }
      }
    }
  });
});

describe("practical performance at target scale", () => {
  test("M=308 with a realistic partial sample completes and stays within bounds", () => {
    const p = finitePopulationPValue(308, 200, 50, 30, 0);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);

    const bound = finitePopulationLowerBound(308, 200, 50, 30, 0.025);
    expect(Number.isFinite(bound)).toBe(true);
    expect(bound).toBeGreaterThanOrEqual(-1);
    expect(bound).toBeLessThanOrEqual(1);
  });

  test("M=308 full census is exact", () => {
    const p = finitePopulationPValue(308, 308, 60, 40, 20);
    expect(p).toBeCloseTo(1, 9);
    const bound = finitePopulationLowerBound(308, 308, 60, 40, 0.025);
    expect(bound).toBeCloseTo(20 / 308, 9);
  });

  test("M=1000 (maximum supported pool size) with a partial sample completes and stays within bounds", () => {
    const p = finitePopulationPValue(1000, 900, 80, 40, 0);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);

    const bound = finitePopulationLowerBound(1000, 900, 80, 40, 0.025);
    expect(Number.isFinite(bound)).toBe(true);
    expect(bound).toBeGreaterThanOrEqual(-1);
    expect(bound).toBeLessThanOrEqual(1);
  });

  test("M=1000 full census is exact", () => {
    const p = finitePopulationPValue(1000, 1000, 150, 90, 60);
    expect(p).toBeCloseTo(1, 9);
    const bound = finitePopulationLowerBound(1000, 1000, 150, 90, 0.025);
    expect(bound).toBeCloseTo(60 / 1000, 9);
  });

  test("poolSize=1001 is still rejected at the boundary", () => {
    expect(() => finitePopulationPValue(1001, 500, 10, 5)).toThrow(RangeError);
  });
});

// Independent Python fractions.Fraction/math.comb reference calculations.
describe("finite-pool p-values at study scale", () => {
  for (const [M, n, w, l, expected] of [
    [308, 120, 24, 12, 0.02214912511927699],
    [308, 120, 30, 12, 0.0016839667078485433],
    [308, 120, 20, 10, 0.03775835338306341],
    [1000, 500, 180, 120, 0.000007841836487215252],
  ] as const) {
    test(M + ":" + n + ":" + w + ":" + l, () => {
      expect(finitePopulationPValue(M, n, w, l)).toBeCloseTo(expected, 14);
    });
  }
});
