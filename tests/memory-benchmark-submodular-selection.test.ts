import { describe, expect, test } from "bun:test";

import { canonicalSha256 } from "../src/canonical";
import {
  selectBudgeted,
  SUBMODULAR_SELECTION_PROTOCOL,
  type Item,
  type Selection,
} from "../scripts/benchmarks/submodular-selection";

/** F(S) = Σ weight + diversityWeight · |∪ features| — the module's objective, reimplemented. */
function objectiveOf(subset: readonly Item[], diversityWeight: number): number {
  let weight = 0;
  const covered = new Set<string>();
  for (const item of subset) {
    weight += item.weight;
    for (const feature of item.features ?? []) covered.add(feature);
  }
  return weight + diversityWeight * covered.size;
}

/** Exhaustive knapsack optimum over all byte-feasible subsets (items ≤ 10). */
function exhaustiveOptimum(items: readonly Item[], budgetBytes: number, diversityWeight: number): number {
  let best = 0;
  for (let mask = 0; mask < (1 << items.length); mask += 1) {
    let bytes = 0;
    const subset: Item[] = [];
    for (let index = 0; index < items.length; index += 1) {
      if (mask & (1 << index)) {
        bytes += items[index]!.bytes;
        subset.push(items[index]!);
      }
    }
    if (bytes <= budgetBytes) best = Math.max(best, objectiveOf(subset, diversityWeight));
  }
  return best;
}

const GREEDY_BOUND = (1 - Math.exp(-1)) / 2; // ≈ 0.316

function expectTraceConsistent(selection: Selection): void {
  expect(selection.trace.map((entry) => entry.id)).toEqual(selection.selected.map((item) => item.id));
  let cumulative = 0;
  let totalBytes = 0;
  for (const [index, entry] of selection.trace.entries()) {
    cumulative += entry.marginalGain;
    totalBytes += selection.selected[index]!.bytes;
    expect(entry.gainPerByte).toBe(entry.marginalGain / selection.selected[index]!.bytes);
    expect(entry.cumulativeGain).toBe(cumulative);
  }
  expect(selection.objective).toBe(cumulative);
  expect(selection.totalBytes).toBe(totalBytes);
  expect(selection.totalBytes).toBeLessThanOrEqual(selection.budgetBytes);
  expect(selection.selectionSha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(selection.selectionSha256).toBe(canonicalSha256({
    objective: selection.objective,
    protocol: SUBMODULAR_SELECTION_PROTOCOL,
    selected: selection.selected.map((item) => item.id),
    trace: selection.trace,
  }));
}

describe("selectBudgeted", () => {
  test("uniform bytes make density-greedy provably optimal and equal the exhaustive optimum", () => {
    const items: Item[] = [
      { id: "i8", bytes: 100, weight: 3 },
      { id: "i5", bytes: 100, weight: 6 },
      { id: "i1", bytes: 100, weight: 10 },
      { id: "beta", bytes: 100, weight: 9 },
      { id: "i7", bytes: 100, weight: 4 },
      { id: "alpha", bytes: 100, weight: 9 }, // ties beta on gainPerByte and gain: id asc wins
      { id: "i6", bytes: 100, weight: 5 },
      { id: "i4", bytes: 100, weight: 7 },
    ];
    const selection = selectBudgeted({ items, budgetBytes: 300 });
    expect(selection.objective).toBe(exhaustiveOptimum(items, 300, 0));
    expect(selection.objective).toBe(10 + 9 + 9);
    expect(selection.selected.map((item) => item.id)).toEqual(["i1", "alpha", "beta"]);
    expect(selection.fallbackUsed).toBe("density-greedy");
    expectTraceConsistent(selection);
  });

  test("equals the exhaustive optimum on a mixed byte/feature fixture", () => {
    const items: Item[] = [
      { id: "a", bytes: 60, weight: 20, features: ["t1"] },
      { id: "b", bytes: 50, weight: 15, features: ["t2"] },
      { id: "c", bytes: 40, weight: 12, features: ["t1", "t3"] },
      { id: "d", bytes: 30, weight: 8, features: ["t4"] },
      { id: "e", bytes: 45, weight: 11, features: ["t2"] },
      { id: "f", bytes: 35, weight: 9, features: ["t5"] },
      { id: "g", bytes: 80, weight: 18, features: ["t1", "t2"] },
      { id: "h", bytes: 25, weight: 6 },
      { id: "i", bytes: 55, weight: 10, features: ["t3"] },
      { id: "j", bytes: 90, weight: 19, features: ["t6"] },
    ];
    const optimum = exhaustiveOptimum(items, 220, 0.5);
    const selection = selectBudgeted({ items, budgetBytes: 220, diversityWeight: 0.5 });
    expect(optimum).toBe(66.5);
    expect(selection.objective).toBeGreaterThanOrEqual(optimum * GREEDY_BOUND - 1e-9);
    expect(selection.objective).toBe(optimum);
    expect(selection.fallbackUsed).toBe("density-greedy");
    expectTraceConsistent(selection);
  });

  test("stays inside the (1−1/e)/2 bound even when greedy misses the optimum", () => {
    const items: Item[] = [
      { id: "a", bytes: 60, weight: 20, features: ["t1"] },
      { id: "b", bytes: 50, weight: 15, features: ["t2"] },
      { id: "c", bytes: 40, weight: 12, features: ["t1", "t3"] },
      { id: "d", bytes: 30, weight: 8, features: ["t4"] },
      { id: "e", bytes: 45, weight: 11, features: ["t2"] },
      { id: "f", bytes: 35, weight: 9, features: ["t5"] },
      { id: "g", bytes: 80, weight: 18, features: ["t1", "t2"] },
      { id: "h", bytes: 25, weight: 6 },
      { id: "i", bytes: 55, weight: 10, features: ["t3"] },
      { id: "j", bytes: 90, weight: 19, features: ["t6"] },
    ];
    const optimum = exhaustiveOptimum(items, 200, 0.3);
    const selection = selectBudgeted({ items, budgetBytes: 200, diversityWeight: 0.3 });
    expect(optimum).toBe(59.2);
    expect(selection.objective).toBe(56.2); // documented: greedy is not always optimal
    expect(selection.objective).toBeGreaterThanOrEqual(optimum * GREEDY_BOUND - 1e-9);
    expectTraceConsistent(selection);
  });

  test("best-single fallback rescues density-greedy and reaches the optimum", () => {
    // heavy packs alone at 10.0; the two smalls beat its density but cannot pack
    // together (51+51 > 100), so greedy stalls at one small (6.4) while the
    // singleton is optimal.
    const items: Item[] = [
      { id: "s1", bytes: 51, weight: 6 },
      { id: "s2", bytes: 51, weight: 6.4 },
      { id: "heavy", bytes: 100, weight: 10 },
    ];
    const optimum = exhaustiveOptimum(items, 100, 0);
    const selection = selectBudgeted({ items, budgetBytes: 100 });
    expect(optimum).toBe(10);
    expect(selection.fallbackUsed).toBe("best-single");
    expect(selection.selected.map((item) => item.id)).toEqual(["heavy"]);
    expect(selection.objective).toBe(optimum);
    expect(selection.trace).toEqual([{
      id: "heavy", marginalGain: 10, gainPerByte: 0.1, cumulativeGain: 10,
    }]);
    expectTraceConsistent(selection);
  });

  test("respects the budget and skips infeasible oversized items even at huge weight", () => {
    const items: Item[] = [
      { id: "oversized", bytes: 101, weight: 1_000_000 },
      { id: "x", bytes: 40, weight: 5 },
      { id: "y", bytes: 40, weight: 4 },
      { id: "z", bytes: 40, weight: 3 },
    ];
    const selection = selectBudgeted({ items, budgetBytes: 100 });
    expect(selection.selected.map((item) => item.id)).toEqual(["x", "y"]);
    expect(selection.totalBytes).toBe(80);
    expect(selection.totalBytes).toBeLessThanOrEqual(100);
    expect(selection.fallbackUsed).toBe("density-greedy");
    expectTraceConsistent(selection);
  });

  test("diversity weight changes the selection on overlapping features", () => {
    const items: Item[] = [
      { id: "a", bytes: 100, weight: 10, features: ["x"] },
      { id: "b", bytes: 100, weight: 9.5, features: ["x"] }, // redundant with a
      { id: "c", bytes: 100, weight: 9, features: ["y"] },
    ];
    const pure = selectBudgeted({ items, budgetBytes: 200 });
    expect(pure.selected.map((item) => item.id)).toEqual(["a", "b"]);
    expect(pure.objective).toBe(19.5);
    const diverse = selectBudgeted({ items, budgetBytes: 200, diversityWeight: 2 });
    expect(diverse.selected.map((item) => item.id)).toEqual(["a", "c"]); // c's new feature outbids b's weight
    expect(diverse.objective).toBe(23);
    expectTraceConsistent(diverse);
  });

  test("is deterministic: same input twice and reversed input give identical digest", () => {
    const items: Item[] = [
      { id: "a", bytes: 60, weight: 20, features: ["t1"] },
      { id: "b", bytes: 50, weight: 15, features: ["t2"] },
      { id: "c", bytes: 40, weight: 12, features: ["t1", "t3"] },
      { id: "d", bytes: 30, weight: 8, features: ["t4"] },
    ];
    const first = selectBudgeted({ items, budgetBytes: 150, diversityWeight: 0.5 });
    const second = selectBudgeted({ items, budgetBytes: 150, diversityWeight: 0.5 });
    expect(second).toEqual(first);
    expect(second.selectionSha256).toBe(first.selectionSha256);
    const reversed = selectBudgeted({ items: [...items].reverse(), budgetBytes: 150, diversityWeight: 0.5 });
    expect(reversed.selectionSha256).toBe(first.selectionSha256);
    expect(reversed.selected.map((item) => item.id)).toEqual(first.selected.map((item) => item.id));
  });

  test("empty item list yields a documented empty density-greedy selection", () => {
    const selection = selectBudgeted({ items: [], budgetBytes: 100 });
    expect(selection.selected).toEqual([]);
    expect(selection.trace).toEqual([]);
    expect(selection.objective).toBe(0);
    expect(selection.totalBytes).toBe(0);
    expect(selection.fallbackUsed).toBe("density-greedy");
    expect(selection.selectionSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  test("rejects a zero, negative or non-integer budget", () => {
    const items: Item[] = [{ id: "a", bytes: 1, weight: 1 }];
    expect(() => selectBudgeted({ items, budgetBytes: 0 })).toThrow();
    expect(() => selectBudgeted({ items, budgetBytes: -5 })).toThrow();
    expect(() => selectBudgeted({ items, budgetBytes: 1.5 })).toThrow();
    expect(() => selectBudgeted({ items, budgetBytes: Number.NaN })).toThrow();
  });

  test("rejects duplicate ids and malformed items", () => {
    const valid: Item = { id: "a", bytes: 10, weight: 1 };
    expect(() => selectBudgeted({ items: [valid, { id: "a", bytes: 5, weight: 2 }], budgetBytes: 100 }))
      .toThrow(/duplicate item id/u);
    expect(() => selectBudgeted({ items: [{ id: "b", bytes: 0, weight: 1 }], budgetBytes: 100 })).toThrow();
    expect(() => selectBudgeted({ items: [{ id: "b", bytes: 10, weight: -1 }], budgetBytes: 100 })).toThrow();
    expect(() => selectBudgeted({ items: [{ id: "b", bytes: 10, weight: Number.NaN }], budgetBytes: 100 })).toThrow();
    expect(() => selectBudgeted({ items: [{ id: "b", bytes: 10, weight: Number.POSITIVE_INFINITY }], budgetBytes: 100 })).toThrow();
    expect(() => selectBudgeted({ items: [{ id: "", bytes: 10, weight: 1 }], budgetBytes: 100 })).toThrow();
    expect(() => selectBudgeted({ items: [{ id: "b", bytes: 10, weight: 1, extra: true } as Item], budgetBytes: 100 })).toThrow();
    expect(() => selectBudgeted({ items: [valid], budgetBytes: 100, diversityWeight: -1 })).toThrow();
  });

  test("enforces item-count and per-item feature limits", () => {
    const manyItems: Item[] = Array.from({ length: 1025 }, (_, index) => ({ id: `i${index}`, bytes: 1, weight: 1 }));
    expect(() => selectBudgeted({ items: manyItems, budgetBytes: 100 })).toThrow();
    const manyFeatures: Item[] = [{
      id: "a", bytes: 1, weight: 1, features: Array.from({ length: 65 }, (_, index) => `f${index}`),
    }];
    expect(() => selectBudgeted({ items: manyFeatures, budgetBytes: 100 })).toThrow();
    const atLimit: Item[] = [{
      id: "a", bytes: 1, weight: 1, features: Array.from({ length: 64 }, (_, index) => `f${index}`),
    }];
    expect(() => selectBudgeted({ items: atLimit, budgetBytes: 100, diversityWeight: 1 })).not.toThrow();
  });
});
