import { describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { sha256Hex } from "../src/canonical";
import { createLabUser } from "../scripts/benchmarks/lab-user";
import { LAB_SYSTEMS, labVariants, runLab, type LabVariant } from "../scripts/benchmarks/lab";
import { makeLabPaidReaderPlan } from "../scripts/benchmarks/lab-paid-plan";
import { createRetrievers, pack, type System } from "../scripts/benchmarks/retrieval";
import { OhSqliteStore } from "../src/sqlite/store";
import type { Corpus, Dataset, Turn } from "../scripts/benchmarks/datasets";

const turns: readonly Turn[] = [
  { id: "u1", sessionId: "s1", date: "2024-01-01", speaker: "User", text: "My garden has a lemon tree." },
  { id: "a1", sessionId: "s1", date: "2024-01-01", speaker: "ASSISTANT", text: "Assistant-only answer: cobalt." },
  { id: "p1", sessionId: "s2", date: "2024-02-01", speaker: "Alice", text: "I planted an olive tree." },
];
const corpus: Corpus = { id: "mixed", groupId: "group", turns };
const question = { id: "q1", corpusId: "mixed", category: "single-session-user", question: "Which tree is in my garden?", questionDate: "2024-03-01",
  answer: "lemon", unanswerable: false, evidenceTurnIds: ["u1"], evidenceSessionIds: ["s1"] };
const dataset: Dataset = { corpora: [corpus], questions: [question] };
const budget = { topK: 5, contextBytes: 12_000 };
const selected: readonly LabVariant[] = [
  { id: "bm25-user-focused:k5:b12000", system: "bm25-user-focused", budget },
  { id: "user-context:k1:b12000", system: "user-context", budget: { ...budget, topK: 1 } },
];
const namespace = "f".repeat(64);

describe("lab user system integration", () => {
  test("preserves default matrices, deduplicates user-context topK, and binds offline and paid contexts", async () => {
    expect(LAB_SYSTEMS).toContain("bm25-user-focused");
    expect(LAB_SYSTEMS).toContain("user-context");
    expect((await import("../scripts/benchmarks/retrieval")).SYSTEMS).not.toContain("bm25-user-focused" as System);
    expect(labVariants(["recent", "bm25-window"], [3, 5], [100, 200]).map(v => v.id)).toEqual([
      "recent:k1:b100", "recent:k1:b200", "bm25-window:k3:b100", "bm25-window:k3:b200", "bm25-window:k5:b100", "bm25-window:k5:b200",
    ]);
    expect(labVariants(["user-context"], [3, 5], [100, 200]).map(v => v.id)).toEqual(["user-context:k1:b100", "user-context:k1:b200"]);

    const [offline, plan] = await Promise.all([runLab(dataset, selected), makeLabPaidReaderPlan(dataset, selected, namespace, "question-last-v1")]);
    const direct = createLabUser(corpus);
    const original = createRetrievers(corpus);
    try {
      const focused = await direct.retrieve(question.question, budget, "focused");
      const context = await direct.retrieve(question.question, selected[1]!.budget, "context");
      expect(focused.context).not.toContain("Assistant-only answer");
      expect(context.context).toBe(pack([turns[0]!, turns[2]!].map(turn => ({ turn })), budget.contextBytes).context);
      const bySystem = new Map(offline.rows.map(row => [row.system, row]));
      expect(bySystem.get("bm25-user-focused")?.contextSha256).toBe(sha256Hex(focused.context));
      expect(bySystem.get("user-context")?.contextSha256).toBe(sha256Hex(context.context));
      expect(bySystem.get("user-context")?.contextBytes).toBe(Buffer.byteLength(context.context));
      expect(bySystem.get("user-context")?.fullContextBytes).toBe(original.fullContextBytes);
      expect(bySystem.get("user-context")?.budgetExempt).toBe(false);
      expect(plan.profile).toBe("oh.lab-paid-reader-plan.v2");
      expect(plan.cases.map(c => [c.system, c.variant])).toEqual(selected.map(v => [v.system, v.id]));
      for (const planCase of plan.cases) {
        const memory = JSON.parse(plan.jobs.find(job => job.key === planCase.jobKey)!.request.body.messages[1]!.content).memory;
        const expected = planCase.system === "user-context" ? context.context : focused.context;
        expect(memory).toBe(expected);
        expect(planCase.contextSha256).toBe(sha256Hex(expected));
      }
    } finally { direct.close(); original.close(); }
  });

  test("closes both original and user indexes when offline metrics fail after retrieval", async () => {
    const failing = { ...question, evidenceTurnIds: ["u1"] };
    Object.defineProperty(failing, "evidenceTurnIds", { get() { throw new Error("metrics failure"); } });
    const closed = spyOn(OhSqliteStore.prototype, "close"), rawClosed = spyOn(Database.prototype, "close");
    try {
      await expect(runLab({ corpora: [corpus], questions: [failing] }, selected)).rejects.toThrow("metrics failure");
      expect(closed).not.toHaveBeenCalled();
      expect(rawClosed.mock.calls.length).toBe(2);
    } finally { closed.mockRestore(); rawClosed.mockRestore(); }
  });
});
