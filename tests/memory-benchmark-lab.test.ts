import { describe, expect, test } from "bun:test";
import { labVariants, runLab } from "../scripts/benchmarks/lab";
import { runRetrieval } from "../scripts/benchmarks/runner";
import type { System } from "../scripts/benchmarks/retrieval";
import type { Dataset } from "../scripts/benchmarks/datasets";

const dataset: Dataset = {
  corpora: [{ id: "c1", groupId: "g1", turns: [
    { id: "t1", sessionId: "s1", date: "2024-01-01", speaker: "User", text: "I planted a lemon tree in the garden." },
    { id: "t2", sessionId: "s1", date: "2024-01-01", speaker: "Assistant", text: "The lemon tree will need watering." },
    { id: "t3", sessionId: "s2", date: "2024-02-01", speaker: "User", text: "I adopted a dog named Pip." },
  ] }],
  questions: [
    { id: "q1", corpusId: "c1", category: "single-session-user", question: "What tree did I plant?", questionDate: "2024-03-01", answer: "lemon", unanswerable: false, evidenceTurnIds: ["t1"], evidenceSessionIds: ["s1"] },
    { id: "q2", corpusId: "c1", category: "single-session-user", question: "What is my dog's name?", questionDate: "2024-03-01", answer: "Pip", unanswerable: false, evidenceTurnIds: ["t3"], evidenceSessionIds: ["s2"] },
  ],
};

describe("development lab", () => {
  test("shared indexes preserve independent retrieval outputs across systems and budgets", async () => {
    const variants = labVariants(["bm25-window", "oh-window", "bm25-block", "full-context"], [1, 3], [80, 1000]);
    const sweep = await runLab(dataset, variants);
    for (const variant of variants) {
      const independent = await runRetrieval(dataset, [variant.system as System], variant.budget, 17);
      const strip = ({ retrievalMs: _ms, ...row }: Record<string, unknown>) => row;
      expect(sweep.rows.filter(r => r.variant === variant.id).map(({ variant: _variant, ...row }) => strip(row)))
        .toEqual(independent.rows.map(strip));
    }
    expect(sweep.timing.corpusPreparations).toBe(1);
    expect(sweep.rows.length).toBe(dataset.questions.length * variants.length);
    expect(sweep.modelCalls).toBe(0);
  });

  test("answer labels and annotations cannot change retrieval contexts", async () => {
    const variants = labVariants(["oh-window", "bm25-block"], [3], [1000]);
    const altered = { ...dataset, questions: dataset.questions.map(q => ({ ...q, answer: "unrelated replacement", evidenceTurnIds: ["missing"], evidenceSessionIds: [] })) };
    const before = await runLab(dataset, variants), after = await runLab(altered, variants);
    expect(after.rows.map(r => r.contextSha256)).toEqual(before.rows.map(r => r.contextSha256));
    expect(after.rows.map(r => r.metrics.turnRecall)).toEqual([0, 0, 0, 0]);
  });

  test("lab-only systems preserve labels and native source provenance in a complete matrix", async () => {
    const variants = labVariants(["bm25-session", "oh-memory-api", "bm25-fusion"], [1, 3], [1000]);
    const sweep = await runLab(dataset, variants);
    expect(sweep.rows).toHaveLength(12);
    const again = await runLab(dataset, variants);
    expect(again.resultSha256).toBe(sweep.resultSha256);
    expect(sweep.ingestion[0]!.native!.queryCalls).toBe(1);
    expect(sweep.ingestion[0]!.native!.sourceRecordCount).toBe(3);
    expect(sweep.rows.filter(r => r.system === "oh-memory-api").every(r => r.recordDigests.length === r.retrievedTurns.length)).toBe(true);
    expect(sweep.rows.every(r => r.contextBytes <= 1000)).toBe(true);
    expect(sweep.rows.map(r => r.system).every(s => s === "bm25-session" || s === "oh-memory-api" || s === "bm25-fusion")).toBe(true);
  });

  test("controls do not multiply with budgets and invalid sweeps fail before indexing", () => {
    expect(labVariants(["full-context", "no-memory"], [1, 20], [100, 1000])).toHaveLength(2);
    expect(labVariants(["recent"], [1, 20], [100, 1000])).toHaveLength(2);
    expect(() => labVariants(["oh-window"], [1, 1], [1000])).toThrow();
    expect(() => labVariants(["oh-window"], [101], [1000])).toThrow();
    expect(() => labVariants(["oh-window", "oh-window"], [1], [1000])).toThrow();
    expect(() => labVariants(["oh-window", "bm25-window"], Array.from({ length: 100 }, (_, i) => i + 1), [100, 1000])).toThrow();
  });
});
