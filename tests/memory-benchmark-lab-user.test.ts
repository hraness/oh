import { describe, expect, test } from "bun:test";
import { createLabUser } from "../scripts/benchmarks/lab-user";
import { renderTurn } from "../scripts/benchmarks/retrieval";
import type { Corpus, Turn } from "../scripts/benchmarks/datasets";

const turn = (id: string, speaker: string, text: string, date = "2026-01-01"): Turn =>
  ({ id, sessionId: `session-${id}`, date, speaker, text });
const corpus = (turns: readonly Turn[]): Corpus => ({ id: "user-lab", groupId: "development", turns });
const roomy = { topK: 10, contextBytes: 12_000 };

describe("lab user-turn retrieval candidate", () => {
  test("filters only case-insensitive explicit assistant roles and keeps original source fields", async () => {
    const source = corpus([
      turn("u1", "User", "I planted a lemon tree.", "2024-01-01"),
      turn("a1", "ASSISTANT", "You planted a lemon tree.", "2024-01-01"),
      turn("p1", "Alice", "I also planted an olive tree.", "2024-01-02"),
      turn("a2", "assistant", "Assistant-only fact: cobalt."),
    ]);
    const retriever = createLabUser(source);
    try {
      const focused = await retriever.retrieve("which tree did I plant", roomy);
      expect(focused.turnIds).toEqual(["u1", "p1"]);
      expect(focused.context).toContain("[u1] [2024-01-01] User: I planted a lemon tree.");
      expect(focused.context).toContain("[p1] [2024-01-02] Alice: I also planted an olive tree.");
      expect(focused.context).not.toContain("Assistant-only fact");
      expect(focused.recordDigests).toEqual([]);
      expect(focused.budgetExempt).toBe(false);
      expect(focused.supportTurnIds).toBeUndefined();
    } finally { retriever.close(); }
  });

  test("context mode packs every retained raw turn under the actual byte budget", async () => {
    const retained = turn("u1", "user", "狐 🍋");
    const participant = turn("p1", "Speaker 2", "é😀");
    const bytes = Buffer.byteLength([retained, participant].map(renderTurn).join("\n\n"));
    const retriever = createLabUser(corpus([retained, turn("a1", "Assistant", "discard"), participant]));
    try {
      const exact = await retriever.retrieve("ignored", { topK: 1, contextBytes: bytes }, "context");
      const short = await retriever.retrieve("ignored", { topK: 1, contextBytes: bytes - 1 }, "context");
      expect(exact.turnIds).toEqual(["u1", "p1"]);
      expect(exact.context).toBe([retained, participant].map(renderTurn).join("\n\n"));
      expect(exact.budgetExempt).toBe(false);
      expect(short.turnIds).toEqual(["u1"]);
      expect(short.omittedForBudget).toBe(1);
      expect(Buffer.byteLength(short.context)).toBeLessThanOrEqual(bytes - 1);
    } finally { retriever.close(); }
  });

  test("does not read labels or mutate its source, and reports an honest empty human corpus", async () => {
    const original = turn("u1", "User", "unchanged source");
    Object.defineProperty(original, "answer", { get() { throw new Error("answer label was read"); } });
    Object.defineProperty(original, "evidenceTurnIds", { get() { throw new Error("evidence was read"); } });
    const source = corpus([original, turn("a1", "assistant", "only assistant")]);
    Object.defineProperty(source, "questions", { get() { throw new Error("questions were read"); } });
    const retriever = createLabUser(source);
    try {
      (original as { text: string }).text = "mutated after snapshot";
      const result = await retriever.retrieve("unchanged", roomy);
      expect(result.context).toContain("unchanged source");
      expect(result.context).not.toContain("mutated after snapshot");
    } finally { retriever.close(); }

    const empty = createLabUser(corpus([turn("a1", "Assistant", "sole fact")]));
    try {
      for (const mode of ["focused", "context"] as const) {
        const result = await empty.retrieve("sole fact", { topK: 1, contextBytes: 40 }, mode);
        expect(result).toEqual({ context: "", turnIds: [], sessionIds: [], recordDigests: [], budgetExempt: false, omittedForBudget: 0 });
      }
    } finally { empty.close(); }
  });

  test("validates the public mode and budget contract", async () => {
    const retriever = createLabUser(corpus([turn("u1", "user", "fact")]));
    try {
      await expect(retriever.retrieve("fact", { topK: 0, contextBytes: 100 })).rejects.toThrow("budget");
      await expect(retriever.retrieve("fact", roomy, "full-context" as never)).rejects.toThrow("mode");
    } finally { retriever.close(); }
  });
});
