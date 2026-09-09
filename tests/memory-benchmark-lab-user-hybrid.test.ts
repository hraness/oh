import { describe, expect, test } from "bun:test";
import { createLabUserHybrid } from "../scripts/benchmarks/lab-user-hybrid";
import { renderTurn, type Retrieved, type RetrievalBudget, type System } from "../scripts/benchmarks/retrieval";
import type { Corpus, Turn } from "../scripts/benchmarks/datasets";

const turn = (id: string, speaker: string, text: string): Turn => ({ id, sessionId: `s-${id}`, date: "2026-01-01", speaker, text });
const human = turn("u", "User", "humanneedle personal fact"), assistant = turn("a", "assistant", "assistant-only fact"), peer = turn("p", "Alice", "humanneedle peer fact");
const corpus: Corpus = { id: "hybrid", groupId: "development", turns: [human, assistant, peer] };
const roomy = { topK: 10, contextBytes: 12_000 };

function source(ids: readonly string[]) {
  const calls: { system: System; query: string; budget: RetrievalBudget }[] = [];
  return { calls, async retrieve(system: System, query: string, budget: RetrievalBudget): Promise<Retrieved> {
    calls.push({ system, query, budget });
    return { context: "untrusted source rendering", turnIds: ids, sessionIds: [], recordDigests: [], budgetExempt: false, omittedForBudget: 0 };
  } };
}

describe("lab user hybrid raw-turn union", () => {
  test("alternates human-focused and original rankings while preserving assistant-only raw evidence", async () => {
    const original = source(["a", "u", "p"]), hybrid = createLabUserHybrid(corpus, original);
    try {
      const result = await hybrid.retrieve("humanneedle", { ...roomy, topK: 3 });
      expect(result.turnIds).toEqual(["u", "a", "p"]);
      expect(result.context).toBe([human, assistant, peer].map(renderTurn).join("\n\n"));
      expect(result.context).not.toContain("untrusted source rendering");
      expect(result.recordDigests).toEqual([]);
      expect(result.budgetExempt).toBe(false);
      expect(original.calls).toEqual([{ system: "bm25-focused", query: "humanneedle", budget: { topK: 100, contextBytes: 4_000_000 } }]);
    } finally { hybrid.close(); }
  });

  test("caches exact-query union ranking and enforces the raw UTF-8 byte cap", async () => {
    const original = source(["a", "u", "p"]), hybrid = createLabUserHybrid(corpus, original);
    try {
      const firstTwo = [human, assistant].map(renderTurn).join("\n\n");
      const exact = await hybrid.retrieve("humanneedle", { topK: 2, contextBytes: Buffer.byteLength(firstTwo) });
      const short = await hybrid.retrieve("humanneedle", { topK: 2, contextBytes: Buffer.byteLength(firstTwo) - 1 });
      expect(exact.turnIds).toEqual(["u", "a"]);
      expect(exact.context).toBe(firstTwo);
      expect(short.turnIds).toEqual(["u"]);
      expect(short.omittedForBudget).toBe(1);
      expect(Buffer.byteLength(short.context)).toBeLessThanOrEqual(Buffer.byteLength(firstTwo) - 1);
      expect(original.calls).toHaveLength(1);
    } finally { hybrid.close(); }
  });

  test("never reads labels, rejects foreign source IDs, and closes its user index", async () => {
    const labelled = { ...corpus };
    Object.defineProperty(labelled, "questions", { get() { throw new Error("question labels were read"); } });
    const bad = source(["foreign"]), hybrid = createLabUserHybrid(labelled, bad);
    await expect(hybrid.retrieve("humanneedle", roomy)).rejects.toThrow("different corpus");
    hybrid.close();
    await expect(hybrid.retrieve("humanneedle", roomy)).rejects.toThrow("closed");
    expect(bad.calls).toHaveLength(1);
  });
});
