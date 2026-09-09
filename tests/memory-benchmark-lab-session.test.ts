import { describe, expect, test } from "bun:test";
import type { Corpus, Turn } from "../scripts/benchmarks/datasets";
import { createLabSession } from "../scripts/benchmarks/lab-session";
import { renderTurn } from "../scripts/benchmarks/retrieval";

function turn(id: string, sessionId: string, text: string, sessionIndex?: number): Turn {
  return { id, sessionId, text, date: "2024-01-01", speaker: "User",
    ...(sessionIndex === undefined ? {} : { sessionIndex }) };
}
function corpus(turns: readonly Turn[]): Corpus { return { id: "c", groupId: "g", turns }; }
const roomy = { topK: 1, contextBytes: 12_000 };

describe("lab session BM25", () => {
  test("ranks complete session documents and returns their original source turns", async () => {
    const turns = [turn("a1", "a", "cobalt sapphire"), turn("a2", "a", "saved context"),
      turn("b1", "b", "cobalt meadow"), turn("b2", "b", "other context")];
    const index = createLabSession(corpus(turns));
    try {
      const result = await index.retrieve("cobalt sapphire", roomy);
      expect(result.turnIds).toEqual(["a1", "a2"]);
      expect(result.context).toBe(turns.slice(0, 2).map(renderTurn).join("\n\n"));
      expect(result.sessionIds).toEqual(["a"]);
      expect(result.recordDigests).toEqual([]);
      expect(result.budgetExempt).toBe(false);
      expect(result.omittedForBudget).toBe(0);
    } finally { index.close(); }
  });

  test("reused session IDs keep distinct occurrence indexes, including zero and absent", async () => {
    const turns = [turn("s#0:0", "same", "orchard cedar", 0), turn("s#1:0", "same", "compass quartz", 1),
      turn("s#1:1", "same", "unchanged follow-up", 1), turn("s:0", "same", "paper birch")];
    const index = createLabSession(corpus(turns));
    try {
      expect((await index.retrieve("quartz", roomy)).turnIds).toEqual(["s#1:0", "s#1:1"]);
      expect((await index.retrieve("cedar", roomy)).turnIds).toEqual(["s#0:0"]);
      expect((await index.retrieve("birch", roomy)).turnIds).toEqual(["s:0"]);
    } finally { index.close(); }
  });

  test("ties use first source occurrence and repeated query terms cannot duplicate turns", async () => {
    const index = createLabSession(corpus([turn("z1", "z", "needle"), turn("a1", "a", "needle")]));
    try {
      expect((await index.retrieve("needle", roomy)).turnIds).toEqual(["z1"]);
      const result = await index.retrieve("needle needle", { ...roomy, topK: 2 });
      expect(result.turnIds).toEqual(["z1", "a1"]);
      expect(await index.retrieve("needle needle", { ...roomy, topK: 2 })).toEqual(result);
      expect((await index.retrieve("!!!", roomy)).context).toBe("");
    } finally { index.close(); }
  });

  test("uses UTF-8 bytes and separators, preserving whole turns when others do not fit", async () => {
    const turns = [turn("t1", "s", "needle 🍋"), turn("t2", "s", "狐"), turn("t3", "s", "🦊".repeat(100))];
    const index = createLabSession(corpus(turns));
    try {
      const pair = turns.slice(0, 2).map(renderTurn).join("\n\n");
      const exact = await index.retrieve("needle", { topK: 1, contextBytes: Buffer.byteLength(pair) });
      expect(exact.context).toBe(pair);
      expect(exact.turnIds).toEqual(["t1", "t2"]);
      expect(exact.omittedForBudget).toBe(1);
      const short = await index.retrieve("needle", { topK: 1, contextBytes: Buffer.byteLength(pair) - 1 });
      expect(short.context).toBe(renderTurn(turns[0]!));
      expect(short.omittedForBudget).toBe(2);
      const skip = await index.retrieve("needle", { topK: 1, contextBytes: Buffer.byteLength(renderTurn(turns[1]!)) });
      expect(skip.context).toBe(renderTurn(turns[1]!));
      expect(skip.omittedForBudget).toBe(2);
    } finally { index.close(); }
  });

  test("indexing and rendering never read gold, questions or has_answer fields", async () => {
    const item = turn("t1", "s", "ordinary source memory");
    const data = corpus([item]);
    const forbidden = { enumerable: true, get() { throw new Error("Label was read."); } };
    Object.defineProperty(item, "has_answer", forbidden);
    Object.defineProperty(data, "answer", forbidden);
    Object.defineProperty(data, "questions", forbidden);
    const index = createLabSession(data);
    try {
      expect((await index.retrieve("memory", roomy)).context).toBe(renderTurn(item));
      expect((await index.retrieve("has_answer", roomy)).turnIds).toEqual([]);
    } finally { index.close(); }
  });

  test("invalid budgets reject and closed indexes cannot be queried", async () => {
    const index = createLabSession(corpus([turn("t1", "s", "needle")]));
    try {
      for (const budget of [{ topK: 0, contextBytes: 100 }, { topK: 101, contextBytes: 100 },
        { topK: 1, contextBytes: 0 }, { topK: 1, contextBytes: 4_000_001 }]) {
        await expect(index.retrieve("needle", budget)).rejects.toThrow("Invalid retrieval budget.");
      }
    } finally { index.close(); }
    index.close();
    await expect(index.retrieve("", roomy)).rejects.toThrow("Session retriever is closed.");
  });
});
