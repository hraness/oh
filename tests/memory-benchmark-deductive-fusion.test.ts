import { describe, expect, test } from "bun:test";
import { fuseRanks, FUSION_POLICY, frozenFusionRetrieve, mechanicalRank } from "../scripts/benchmarks/deductive-fusion-probe";
import { frozenWindow } from "../scripts/benchmarks/deductive-frozen-control";
import { deductivePlan, prepareDeductive } from "../scripts/benchmarks/deductive-retrieval";
import type { Corpus } from "../scripts/benchmarks/datasets";

const vector = Array.from({ length: 20 }, (_, index) => `v${index}`);

describe("frozen development rank fusion", () => {
  test("zero structural weight exactly preserves captured order without a tail", () => {
    expect(fuseRanks(vector, ["new", ...[...vector].reverse()], 0).map((row) => row.turnId)).toEqual(vector);
  });

  test("missing vector ranks receive no fabricated similarity contribution", () => {
    const rows = fuseRanks(vector, ["new", "v19"], 0.25);
    expect(rows.find((row) => row.turnId === "new")!.score).toBe(0.25 / 61);
    expect(rows.find((row) => row.turnId === "v19")!.score).toBe(0.75 / 80 + 0.25 / 62);
    expect(rows.find((row) => row.turnId === "v0")!.score).toBe(0.75 / 61);
  });

  test("rejects incomplete captures and undeclared policy weights", () => {
    expect(() => fuseRanks(vector.slice(0, 19), [], 0.25)).toThrow("complete fusion ranks");
    expect(() => fuseRanks([...vector.slice(0, 19), "v0"], [], 0.25)).toThrow("complete fusion ranks");
    expect(() => fuseRanks(vector, ["same", "same"], 0.25)).toThrow("complete fusion ranks");
    expect(() => fuseRanks(vector, [], 0.6)).toThrow("Undeclared fusion weight");
    expect(FUSION_POLICY.structuralWeights).toEqual([0, 0.25, 0.5, 0.75]);
  });

  test("shared confirmation helpers preserve mechanical order and independent zero-alpha bytes", () => {
    const corpus: Corpus = { id: "fusion-helper", groupId: "fusion-helper",
      turns: Array.from({ length: 24 }, (_, index) => ({ id: `v${index}`,
        sessionId: `s${Math.floor(index / 6)}`, date: `1:00 pm on ${Math.floor(index / 6) + 1} May, 2023`,
        speaker: index % 2 === 0 ? "Evan" : "Sam", text: `I enjoy hiking near Granite Peak trail ${index}.` })) };
    const prepared = prepareDeductive(corpus);
    try {
      const question = "What did Evan most recently say about hiking?";
      const mechanical = mechanicalRank(corpus, prepared, question);
      expect(mechanical).toEqual(deductivePlan(corpus, prepared, "deductive", question,
        { topK: 100, contextBytes: 12_000 }).seeds.map((row) => row.turnId));
      const baseline = frozenFusionRetrieve(corpus, prepared, vector, mechanical, 0);
      const control = frozenWindow(corpus, vector);
      expect(baseline.context).toBe(control.context);
      expect(baseline.turnIds).toEqual(control.turnIds);
    } finally { prepared.store.close(); prepared.fts.close(); }
  });
});
