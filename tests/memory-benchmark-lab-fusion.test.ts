import { describe, expect, test } from "bun:test";
import type { Corpus, Turn } from "../scripts/benchmarks/datasets";
import { createLabFusion } from "../scripts/benchmarks/lab-fusion";
import { createRetrievers, renderTurn, type Retrieved, type RetrievalBudget, type System } from "../scripts/benchmarks/retrieval";

const turn = (id: string, text = id): Turn => ({ id, text, sessionId: "same", sessionIndex: 0,
  date: "2026-01-01", speaker: "User" });
const corpus = (turns: readonly Turn[]): Corpus => ({ id: "fusion", groupId: "dev", turns });
const roomy = { topK: 2, contextBytes: 12_000 };
function ranked(turnIds: readonly string[]): Retrieved {
  return { context: "unused source rendering", turnIds, sessionIds: [], recordDigests: [],
    budgetExempt: false, omittedForBudget: 0 };
}
function sources(focused: readonly string[], block: readonly string[]) {
  const calls: { system: System; question: string; budget: RetrievalBudget }[] = [];
  return { calls, async retrieve(system: System, question: string, budget: RetrievalBudget) {
    calls.push({ system, question, budget });
    return ranked(system === "bm25-focused" ? focused : block);
  } };
}

describe("lab host BM25 rank fusion", () => {
  test("complementary source rankings promote two shared evidence turns over separate distractors", async () => {
    const input = corpus([turn("evidence-a"), turn("evidence-b"), turn("raw-distractor"), turn("block-distractor")]);
    const source = sources(["raw-distractor", "evidence-a", "evidence-b"], ["block-distractor", "evidence-b", "evidence-a"]);
    const fusion = createLabFusion(input, source);
    const result = await fusion.retrieve("question", roomy);
    expect(result.turnIds).toEqual(["evidence-a", "evidence-b"]);
    expect(result.context).toBe(input.turns.slice(0, 2).map(renderTurn).join("\n\n"));
    const evidence = new Set(["evidence-a", "evidence-b"]);
    expect(source.calls).toHaveLength(2);
    expect(["raw-distractor", "evidence-a"].filter(id => evidence.has(id))).toHaveLength(1);
    expect(["block-distractor", "evidence-b"].filter(id => evidence.has(id))).toHaveLength(1);
    expect(result.turnIds.filter(id => evidence.has(id))).toHaveLength(2);
    expect(result.recordDigests).toEqual([]);
    expect(result.budgetExempt).toBe(false);
  });

  test("suppresses duplicate votes, caps each raw source ranking at 100, and breaks ties by corpus order", async () => {
    const turns = Array.from({ length: 102 }, (_, i) => turn(`t${i}`));
    const duplicate = createLabFusion(corpus(turns), sources(["t1", "t1", "t1", "t0"], ["t0", "t1"]));
    expect((await duplicate.retrieve("query", roomy)).turnIds).toEqual(["t0", "t1"]);
    const all = turns.map(item => item.id);
    const bounded = createLabFusion(corpus(turns), sources(all, []));
    const result = await bounded.retrieve("query", { ...roomy, topK: 100 });
    expect(result.turnIds).toEqual(all.slice(0, 100));
    expect(result.turnIds).not.toContain("t100");
  });

  test("shares concurrent source work across budgets but keeps exact query and corpus caches independent", async () => {
    const source = sources(["a", "b"], ["b", "a"]);
    const fusion = createLabFusion(corpus([turn("a"), turn("b")]), source);
    const [small, large] = await Promise.all([fusion.retrieve("q", { ...roomy, topK: 1 }), fusion.retrieve("q", roomy)]);
    expect(small.turnIds).toEqual(["a"]);
    expect(large.turnIds).toEqual(["a", "b"]);
    expect(source.calls.map(call => call.system)).toEqual(["bm25-focused", "bm25-block"]);
    expect(source.calls.every(call => call.budget.topK === 100 && call.budget.contextBytes === 4_000_000)).toBe(true);
    await fusion.retrieve("Q", roomy);
    await fusion.retrieve("q ", roomy);
    expect(source.calls).toHaveLength(6);
    const other = createLabFusion(corpus([turn("b", "other source"), turn("a")]), source);
    expect((await other.retrieve("q", { ...roomy, topK: 1 })).context).toContain("other source");
    expect(source.calls).toHaveLength(8);
  });

  test("snapshots source identities and raw text without reading labels or accepting source context", async () => {
    const first = { ...turn("first", "needle 🍋"), sessionIndex: 1 };
    const second = { ...turn("second", "狐"), sessionIndex: 2 };
    const input = corpus([first, second]);
    const forbidden = { enumerable: true, get() { throw new Error("Label was read."); } };
    Object.defineProperty(first, "has_answer", forbidden);
    Object.defineProperty(input, "questions", forbidden);
    Object.defineProperty(input, "answer", forbidden);
    const ids = ["first", "second"];
    const fusion = createLabFusion(input, sources(ids, []));
    const pair = [first, second].map(renderTurn).join("\n\n");
    const exact = await fusion.retrieve("q", { ...roomy, contextBytes: Buffer.byteLength(pair) });
    expect(exact.context).toBe(pair);
    expect(exact.sessionIds).toEqual(["same"]);
    expect(exact.omittedForBudget).toBe(0);
    first.text = "Changed after snapshot.";
    ids.reverse();
    const shortened = await fusion.retrieve("q", { ...roomy, contextBytes: Buffer.byteLength(pair) - 1 });
    expect(shortened.turnIds).toEqual(["first"]);
    expect(shortened.context).toContain("needle 🍋");
    expect(shortened.omittedForBudget).toBe(1);
    expect(shortened.context).not.toContain("Changed");
  });

  test("uses the shared real BM25 and block retrievers without inventing source turns", async () => {
    const input = corpus([turn("one", "Mira keeps a crimson bicycle."), turn("two", "The bicycle is in the shed."),
      { ...turn("three", "Clouds formed overnight."), sessionIndex: 1 }]);
    const shared = createRetrievers(input);
    try {
      const fusion = createLabFusion(input, shared);
      const result = await fusion.retrieve("crimson bicycle", roomy);
      expect(result.turnIds).toEqual(["one", "two"]);
      expect(result.context).toBe(input.turns.slice(0, 2).map(renderTurn).join("\n\n"));
      expect((await fusion.retrieve("zzznomatch", roomy)).turnIds).toEqual([]);
      expect((await shared.retrieve("bm25-focused", "crimson", roomy)).turnIds).toEqual(["one"]);
    } finally { shared.close(); }
  });

  test("invalid budgets make no source calls and failed source queries cannot become cached successes", async () => {
    const source = sources(["known"], ["other-corpus"]);
    const fusion = createLabFusion(corpus([turn("known")]), source);
    for (const budget of [{ topK: 0, contextBytes: 100 }, { topK: 101, contextBytes: 100 },
      { topK: 1, contextBytes: 0 }, { topK: 1, contextBytes: 4_000_001 }]) {
      await expect(fusion.retrieve("q", budget)).rejects.toThrow("budget");
    }
    await expect(fusion.retrieve("x".repeat(65_537), roomy)).rejects.toThrow("question");
    expect(source.calls).toHaveLength(0);
    await expect(fusion.retrieve("q", roomy)).rejects.toThrow("different corpus");
    await expect(fusion.retrieve("q", { ...roomy, topK: 1 })).rejects.toThrow("different corpus");
    expect(source.calls).toHaveLength(2);
    expect(() => createLabFusion(corpus([turn("duplicate"), turn("duplicate")]), source)).toThrow("unique");
  });
});
