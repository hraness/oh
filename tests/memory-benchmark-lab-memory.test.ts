import { describe, expect, test } from "bun:test";
import { createKnowledgeGraphRecordV1 } from "../src/graph";
import { createLabMemory } from "../scripts/benchmarks/lab-memory";
import type { Corpus, Turn } from "../scripts/benchmarks/datasets";
import { createRetrievers } from "../scripts/benchmarks/retrieval";

const turn = (id: string, text: string): Turn => ({ id, text, sessionId: "session-1",
  date: "2026-01-01", speaker: "User" });
const corpus = (turns: readonly Turn[]): Corpus => ({ id: "lab-synthetic", groupId: "lab-dev", turns });
const budget = { topK: 20, contextBytes: 12_000 };

describe("native memory development adapter", () => {
  test("materializes actual V2 canonical source records and preserves raw provenance", async () => {
    const input = corpus([turn("one", "Mira keeps a crimson bicycle."), turn("two", "Clouds formed overnight.")]);
    const memory = await createLabMemory(input);
    try {
      const result = await memory.retrieve("What bicycle does Mira keep?", budget);
      expect(result.turnIds).toEqual(["one"]);
      expect(result.context).toContain(input.turns[0]!.text);
      expect(result.native.ranking).toBe("host-raw-text-bm25");
      expect(result.native.cache).toBe("corpus-program-authority-snapshot");
      expect(result.native.sourceRecordCount).toBe(2);
      expect(result.native.queryCalls).toBe(1);
      expect(result.native.canonical.lane).toBe("canonical");
      expect(result.native.working.lane).toBe("working");
      expect(result.native.canonical.head.sequence).toBe(1);
      expect(result.native.working.head.sequence).toBe(0);
      const expected = createKnowledgeGraphRecordV1({ dependencies: [], key: "edition:turn-00000",
        kind: "edition", value: { ...input.turns[0]! }, v: 1 });
      expect(result.recordDigests).toEqual([expected.recordSha256]);
      expect(result.nativeSources).toEqual([{ turnId: "one", key: expected.key, recordSha256: expected.recordSha256 }]);
      expect(result.native.materializationSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally { await memory.close(); }
  });

  test("traverses native pagination and reuses the same source projection across budgets and questions", async () => {
    const input = corpus(Array.from({ length: 257 }, (_, i) => turn(`turn-${i}`, `unique${i} record.`)));
    const memory = await createLabMemory(input);
    try {
      expect(memory.native.queryCalls).toBe(2);
      expect(memory.native.pageResultSha256).toHaveLength(2);
      const end = await memory.retrieve("unique256", budget);
      const beginning = await memory.retrieve("unique0", { ...budget, topK: 1 });
      expect(end.turnIds).toEqual(["turn-256"]);
      expect(beginning.turnIds).toEqual(["turn-0"]);
      expect(end.native).toBe(beginning.native);
      expect(end.native.sourceRecordCount).toBe(257);
      expect(memory.native.queryCalls).toBe(2);
    } finally { await memory.close(); }
  });

  test("matches the independent raw-text BM25 control on the same ranked input", async () => {
    const input = corpus([turn("first", "cobalt amber amber"), turn("second", "cobalt"),
      turn("third", "amber garden trees"), turn("fourth", "snow")]);
    const memory = await createLabMemory(input), baseline = createRetrievers(input);
    try {
      for (const question of ["amber cobalt", "snow", "nonexistent", ""]) {
        const actual = await memory.retrieve(question, budget);
        const expected = await baseline.retrieve("bm25-focused", question, budget);
        expect(actual.context).toBe(expected.context);
        expect(actual.turnIds).toEqual(expected.turnIds);
        expect(actual.sessionIds).toEqual(expected.sessionIds);
      }
    } finally { await memory.close(); baseline.close(); }
  });

  test("ignores extra answer and has_answer fields without invoking their getters", async () => {
    const clean = { ...turn("one", "Mira keeps a crimson bicycle."), sessionIndex: 7 };
    const poisoned = { ...clean, gold: "forbidden-label" };
    let forbiddenReads = 0;
    for (const key of ["answer", "has_answer", "question"]) Object.defineProperty(poisoned, key, {
      enumerable: true, get() { forbiddenReads += 1; throw new Error("Labels must not enter ingestion."); },
    });
    const memory = await createLabMemory(corpus([poisoned]));
    try {
      const result = await memory.retrieve("crimson", budget);
      const expected = createKnowledgeGraphRecordV1({ dependencies: [], key: "edition:turn-00000",
        kind: "edition", value: clean, v: 1 });
      expect(forbiddenReads).toBe(0);
      expect(result.recordDigests).toEqual([expected.recordSha256]);
      expect(result.nativeSources).toEqual([{ turnId: "one", key: expected.key, recordSha256: expected.recordSha256 }]);
      expect(result.context).toContain(clean.text);
      expect((await memory.retrieve("forbidden-label", budget)).turnIds).toEqual([]);
      expect((await memory.retrieve("has_answer", budget)).turnIds).toEqual([]);
      expect(forbiddenReads).toBe(0);
    } finally { await memory.close(); }
  });

  test("binds cache identity to source content and detaches caller-owned text", async () => {
    const mutable = { ...turn("one", "The crimson bicycle is stored here.") };
    const first = await createLabMemory(corpus([mutable]));
    mutable.text = "Tampered emerald scooter.";
    const second = await createLabMemory(corpus([mutable]));
    try {
      const original = await first.retrieve("crimson", budget);
      expect(original.context).toContain("crimson bicycle");
      expect(original.context).not.toContain("Tampered");
      expect((await first.retrieve("emerald", budget)).turnIds).toEqual([]);
      expect((await second.retrieve("emerald", budget)).turnIds).toEqual(["one"]);
      expect(first.native.corpusSha256).not.toBe(second.native.corpusSha256);
      expect(first.native.materializationSha256).not.toBe(second.native.materializationSha256);
      expect(first.native.memorySha256).not.toBe(second.native.memorySha256);
    } finally { await first.close(); await second.close(); }
  });

  test("enforces byte budgets and reports only selected source records", async () => {
    const memory = await createLabMemory(corpus([turn("long", "needle ".repeat(30)), turn("short", "needle")]));
    try {
      const small = await memory.retrieve("needle", { topK: 20, contextBytes: 50 });
      expect(Buffer.byteLength(small.context)).toBeLessThanOrEqual(50);
      expect(small.turnIds).toEqual(["short"]);
      expect(small.omittedForBudget).toBe(1);
      expect(small.nativeSources.map(source => source.turnId)).toEqual([...small.turnIds]);
      const empty = await memory.retrieve("needle", { topK: 1, contextBytes: 1 });
      expect(empty.context).toBe("");
      expect(empty.recordDigests).toEqual([]);
      expect(empty.nativeSources).toEqual([]);
      await expect(memory.retrieve("needle", { topK: 0, contextBytes: 50 })).rejects.toThrow("budget");
      await expect(memory.retrieve("needle", { topK: 20, contextBytes: Infinity })).rejects.toThrow("budget");
    } finally { await memory.close(); }
    await memory.close();
    await expect(memory.retrieve("needle", budget)).rejects.toThrow("closed");
  });

  test("rejects empty and ambiguous raw source identities", async () => {
    await expect(createLabMemory(corpus([]))).rejects.toThrow("uniquely identified");
    await expect(createLabMemory(corpus([turn("same", "one"), turn("same", "two")]))).rejects.toThrow("uniquely identified");
  });
});
