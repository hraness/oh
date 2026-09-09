import { describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { sha256Hex } from "../src/canonical";
import { createLabUserHybrid } from "../scripts/benchmarks/lab-user-hybrid";
import { LAB_SYSTEMS, labVariants, runLab, type LabVariant } from "../scripts/benchmarks/lab";
import { makeLabPaidReaderPlan } from "../scripts/benchmarks/lab-paid-plan";
import { createRetrievers, SYSTEMS, type System } from "../scripts/benchmarks/retrieval";
import { OhSqliteStore } from "../src/sqlite/store";
import type { Corpus, Dataset, Turn } from "../scripts/benchmarks/datasets";

const corpus: Corpus = { id: "hybrid", groupId: "group", turns: [
  { id: "u", sessionId: "s1", date: "2024-01-01", speaker: "User", text: "My garden has a lemon tree." },
  { id: "a", sessionId: "s1", date: "2024-01-01", speaker: "Assistant", text: "Assistant-only fact about cobalt." },
  { id: "p", sessionId: "s2", date: "2024-02-01", speaker: "Alice", text: "I planted an olive tree." },
] };
const question = { id: "q", corpusId: "hybrid", category: "single-session-user", question: "Which tree is in my garden?", questionDate: "2024-03-01",
  answer: "lemon", unanswerable: false, evidenceTurnIds: ["u"], evidenceSessionIds: ["s1"] };
const dataset: Dataset = { corpora: [corpus], questions: [question] };
const hybridBudget = { topK: 5, contextBytes: 12_000 };
const variants: readonly LabVariant[] = [
  { id: "bm25-user-hybrid:k5:b12000", system: "bm25-user-hybrid", budget: hybridBudget },
  { id: "bm25-focused:k5:b12000", system: "bm25-focused", budget: hybridBudget },
];

describe("lab user-hybrid integration", () => {
  test("keeps the hybrid opt-in, binds offline and paid contexts, and preserves question-last-v1", async () => {
    expect(LAB_SYSTEMS).toContain("bm25-user-hybrid");
    expect(SYSTEMS).not.toContain("bm25-user-hybrid" as System);
    expect(labVariants(["bm25-user-hybrid"], [1, 3], [100, 200]).map(v => v.id)).toEqual([
      "bm25-user-hybrid:k1:b100", "bm25-user-hybrid:k1:b200", "bm25-user-hybrid:k3:b100", "bm25-user-hybrid:k3:b200",
    ]);
    const [offline, plan] = await Promise.all([runLab(dataset, variants), makeLabPaidReaderPlan(dataset, variants, "e".repeat(64), "question-last-v1")]);
    const shared = createRetrievers(corpus), hybrid = createLabUserHybrid(corpus, shared);
    try {
      const expected = await hybrid.retrieve(question.question, hybridBudget);
      const row = offline.rows.find(item => item.system === "bm25-user-hybrid")!;
      expect(row.contextSha256).toBe(sha256Hex(expected.context));
      expect(row.contextBytes).toBe(Buffer.byteLength(expected.context));
      expect(row.fullContextBytes).toBe(shared.fullContextBytes);
      expect(row.budgetExempt).toBe(false);
      const planCase = plan.cases.find(item => item.system === "bm25-user-hybrid")!;
      const job = plan.jobs.find(item => item.key === planCase.jobKey)!;
      const readerPayload = JSON.parse(job.request.body.messages[1]!.content);
      expect(plan.profile).toBe("oh.lab-paid-reader-plan.v2");
      if (plan.profile !== "oh.lab-paid-reader-plan.v2") throw new Error("reader policy profile drift");
      expect(plan.readerPolicy).toBe("question-last-v1");
      expect(readerPayload.memory).toBe(expected.context);
      expect(planCase.contextSha256).toBe(sha256Hex(expected.context));
      expect(planCase.contextBytes).toBe(Buffer.byteLength(expected.context));
    } finally { hybrid.close(); shared.close(); }
  });

  test("closes the private filtered index and caller-owned inclusive index after an offline failure", async () => {
    const failing = { ...question, evidenceTurnIds: ["u"] };
    Object.defineProperty(failing, "evidenceTurnIds", { get() { throw new Error("metrics failure"); } });
    const closed = spyOn(OhSqliteStore.prototype, "close"), rawClosed = spyOn(Database.prototype, "close");
    try {
      await expect(runLab({ corpora: [corpus], questions: [failing] }, variants)).rejects.toThrow("metrics failure");
      expect(closed).not.toHaveBeenCalled();
      expect(rawClosed.mock.calls.length).toBe(2);
    } finally { closed.mockRestore(); rawClosed.mockRestore(); }
  });
});
