import { describe, expect, test } from "bun:test";
import { createLabDiverse } from "../scripts/benchmarks/lab-diverse";
import type { Corpus, Turn } from "../scripts/benchmarks/datasets";
import { createRetrievers, pack, renderTurn, type Retrieved, type RetrievalBudget, type System } from "../scripts/benchmarks/retrieval";

const turn = (id: string, sessionId = "same", text = id, sessionIndex = 0): Turn => ({
  id, sessionId, text, sessionIndex, date: "2026-01-01", speaker: "User" });
const corpus = (turns: readonly Turn[]): Corpus => ({ id: "diverse", groupId: "dev", turns });
const roomy = { topK: 20, contextBytes: 12_000 };
function source(ids: readonly string[]) {
  const calls: { system: System; question: string; budget: RetrievalBudget }[] = [];
  return { calls, async retrieve(system: System, question: string, budget: RetrievalBudget): Promise<Retrieved> {
    calls.push({ system, question, budget });
    return { context: "forbidden source rendering", turnIds: ids, sessionIds: [], recordDigests: [],
      budgetExempt: false, omittedForBudget: 0 };
  } };
}

describe("lab session-diverse raw evidence allocation", () => {
  test("reserves distinct anchors before a verbose adjacent turn consumes their budget", async () => {
    const turns = [turn("a", "A"), turn("a-next", "A", "verbose ".repeat(25)), turn("b", "B")];
    const input = corpus(turns), supplied = source(["a", "b"]);
    const bytes = Buffer.byteLength(turns.slice(0, 2).map(renderTurn).join("\n\n"));
    const result = await createLabDiverse(input, supplied).retrieve("query", { topK: 2, contextBytes: bytes });
    expect(result.turnIds).toEqual(["a", "b"]);
    expect(pack(turns.map(turn => ({ turn })), bytes).turnIds).toEqual(["a", "a-next"]);
    expect(result.omittedForBudget).toBe(1);
    expect(result.budgetExempt).toBe(false);
    expect(result.recordDigests).toEqual([]);
    expect(Buffer.byteLength(result.context)).toBeLessThanOrEqual(bytes);
  });

  test("visits occurrences by first rank and neighbors preceding then following round-robin", async () => {
    const turns = [turn("a-before", "A"), turn("a", "A"), turn("a-after", "A"),
      turn("b-before", "B"), turn("b", "B"), turn("b-after", "B")];
    const result = await createLabDiverse(corpus(turns), source(["b", "a"])).retrieve("q", { ...roomy, topK: 2 });
    expect(result.turnIds).toEqual(["b", "a", "b-before", "a-before", "b-after", "a-after"]);
    expect(result.turnIds.length).toBeGreaterThan(2);
    expect(result.omittedForBudget).toBe(0);
  });

  test("uses the first fitting same-occurrence anchor and keeps omitted-anchor neighbors eligible", async () => {
    const turns = [turn("left"), turn("huge", "same", "x".repeat(1000)), turn("small")];
    const result = await createLabDiverse(corpus(turns), source(["huge", "small"]))
      .retrieve("q", { topK: 2, contextBytes: 180 });
    expect(result.turnIds).toEqual(["small", "left"]);
    expect(result.omittedForBudget).toBe(1);
    expect(result.context).not.toContain("xxx");
  });

  test("expands a remaining anchor even when it was already admitted as another anchor's neighbor", async () => {
    const turns = [turn("a"), turn("b"), turn("c")];
    const result = await createLabDiverse(corpus(turns), source(["a", "b", "b"]))
      .retrieve("q", { ...roomy, topK: 2 });
    expect(result.turnIds).toEqual(["a", "b", "c"]);
    expect(result.omittedForBudget).toBe(0);
  });

  test("keeps occurrence boundaries and original dates without inventing recency", async () => {
    const turns = [turn("excluded-before", "same", "before", 1),
      { ...turn("anchor", "same", "needle", 2), date: "2025-12-01" },
      { ...turn("neighbor", "same", "detail", 2), date: "2026-01-01" },
      turn("excluded-after", "same", "after", 3)];
    const result = await createLabDiverse(corpus(turns), source(["anchor"])).retrieve("q", { ...roomy, topK: 1 });
    expect(result.turnIds).toEqual(["anchor", "neighbor"]);
    expect(result.context).toBe(turns.slice(1, 3).map(renderTurn).join("\n\n"));
    expect(result.sessionIds).toEqual(["same"]);
    expect(result.omittedForBudget).toBe(0);
  });

  test("uses exact UTF8 and separator budgets and counts final distinct omissions", async () => {
    const turns = [turn("a", "A", "狐 🍋"), turn("b", "A", "é😀")];
    const bytes = Buffer.byteLength(turns.map(renderTurn).join("\n\n"));
    const retriever = createLabDiverse(corpus(turns), source(["a", "a"]));
    const exact = await retriever.retrieve("q", { topK: 1, contextBytes: bytes });
    const short = await retriever.retrieve("q", { topK: 1, contextBytes: bytes - 1 });
    const tiny = await retriever.retrieve("q", { topK: 1, contextBytes: 1 });
    expect(Buffer.byteLength(exact.context)).toBe(bytes);
    expect(exact.omittedForBudget).toBe(0);
    expect(short.turnIds).toEqual(["a"]);
    expect(short.omittedForBudget).toBe(1);
    expect(tiny.context).toBe("");
    expect(tiny.omittedForBudget).toBe(2);
  });

  test("detaches raw fields without reading labels and shares ranking across concurrent budgets", async () => {
    const item = { ...turn("a", "A", "needle") }, other = turn("b", "B");
    let labelReads = 0;
    for (const key of ["answer", "has_answer", "question"]) Object.defineProperty(item, key,
      { enumerable: true, get() { labelReads += 1; throw new Error("Label was read."); } });
    const input = corpus([item, other]);
    Object.defineProperty(input, "questions", { get() { throw new Error("Questions were read."); } });
    const supplied = source(["a", "b"]), retriever = createLabDiverse(input, supplied);
    const [small, large] = await Promise.all([retriever.retrieve("q", { ...roomy, topK: 1 }), retriever.retrieve("q", roomy)]);
    expect(small.turnIds).toEqual(["a"]);
    expect(large.turnIds).toEqual(["a", "b"]);
    expect(supplied.calls).toEqual([{ system: "bm25-focused", question: "q", budget: { topK: 100, contextBytes: 4_000_000 } }]);
    item.text = "changed after snapshot";
    expect((await retriever.retrieve("q", roomy)).context).toContain("needle");
    expect(large.context).not.toContain("forbidden source rendering");
    expect(labelReads).toBe(0);
    await retriever.retrieve("Q", roomy);
    expect(supplied.calls).toHaveLength(2);
    await createLabDiverse(corpus([turn("a", "A", "different corpus"), other]), supplied).retrieve("q", roomy);
    expect(supplied.calls).toHaveLength(3);
  });

  test("borrows real focused BM25 without closing it or accepting irrelevant corpus IDs", async () => {
    const input = corpus([turn("a", "A", "crimson bicycle"), turn("b", "A", "stored in the shed"), turn("c", "B", "clouds")]);
    const shared = createRetrievers(input);
    try {
      const retriever = createLabDiverse(input, shared);
      expect((await retriever.retrieve("crimson", roomy)).turnIds).toEqual(["a", "b"]);
      expect((await retriever.retrieve("zzzabsent", roomy)).turnIds).toEqual([]);
      expect((await shared.retrieve("bm25-focused", "clouds", roomy)).turnIds).toEqual(["c"]);
    } finally { shared.close(); }
    const supplied = source(["elsewhere"]), bad = createLabDiverse(input, supplied);
    await expect(bad.retrieve("q", roomy)).rejects.toThrow("different corpus");
    await expect(bad.retrieve("q", { ...roomy, topK: 1 })).rejects.toThrow("different corpus");
    expect(supplied.calls).toHaveLength(1);
    const unused = source(["a"]), checked = createLabDiverse(input, unused);
    await expect(checked.retrieve("q", { topK: 0, contextBytes: 12 })).rejects.toThrow("budget");
    await expect(checked.retrieve("q", { topK: 20, contextBytes: NaN })).rejects.toThrow("budget");
    await expect(checked.retrieve("x".repeat(65_537), roomy)).rejects.toThrow("question");
    expect(unused.calls).toHaveLength(0);
    expect(() => createLabDiverse(corpus([turn("a"), turn("a")]), unused)).toThrow("unique");
  });
});
