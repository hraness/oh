import { describe, expect, spyOn, test } from "bun:test";

import { createKnowledgeGraphRecordV1 } from "../src/graph";
import { OhSqliteStore } from "../src/sqlite/store";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { createRetrievers, createUnitIndex, DEFAULT_SYSTEMS, SYSTEMS } from "../scripts/benchmarks/retrieval";
import { buildExtractionChunks, parseMemoryUnits } from "../scripts/benchmarks/units";

const corpus: Corpus = { id: "record-parity", groupId: "record-parity", turns: [
  { id: "t0", sessionId: "sess-alpha", date: "2026-01-01", speaker: "Ada", text: "Ada talked about her new café visit." },
  { id: "t1", sessionId: "sess-alpha", date: "2026-01-01", speaker: "Bea", text: "Bea replied about the trip." },
  { id: "t2", sessionId: "sess-alpha", date: "2026-01-01", speaker: "Ada", text: "Ada mentioned Paris Paris Paris again and again." },
  { id: "t3", sessionId: "sess-alpha", date: "2026-01-01", speaker: "Bea", text: "Bea agreed with Ada about Paris." },
  { id: "t4", sessionId: "sess-alpha", date: "2026-01-01", speaker: "Ada", text: "" },
  { id: "t5", sessionId: "sess-alpha", date: "2026-01-01", speaker: "Bea", text: `word${"x".repeat(80)} appears once.` },
  { id: "tie0", sessionId: "sess-tie", date: "2026-01-02", speaker: "Ada", text: "Identical duplicate marker phrase." },
  { id: "tie1", sessionId: "sess-tie", date: "2026-01-02", speaker: "Bea", text: "Identical duplicate marker phrase." },
  { id: "meta0", sessionId: "sess-only-hallway77", date: "2026-01-03", speaker: "Cy", text: "Cy said nothing special." },
] };

describe("bm25-record-window matches oh-window exactly", () => {
  test("is explicit-only: present in SYSTEMS but excluded from DEFAULT_SYSTEMS", () => {
    expect(SYSTEMS).toContain("bm25-record-fact");
    expect(SYSTEMS).toContain("bm25-record-window");
    expect(DEFAULT_SYSTEMS).not.toContain("bm25-record-fact");
    expect(DEFAULT_SYSTEMS).not.toContain("bm25-record-window");
  });

  test("a metadata-only term matches oh and the record baseline but not the visible-text baseline", async () => {
    const retrievers = createRetrievers(corpus);
    try {
      const budget = { topK: 5, contextBytes: 4_000 };
      const oh = await retrievers.retrieve("oh-window", "hallway77", budget);
      const record = await retrievers.retrieve("bm25-record-window", "hallway77", budget);
      const visible = await retrievers.retrieve("bm25-window", "hallway77", budget);
      expect(record).toEqual(oh);
      expect(oh.turnIds).toContain("meta0");
      expect(visible.turnIds).toEqual([]);
    } finally { retrievers.close(); }
  });

  test("matches oh-window for an ordinary visible-text term", async () => {
    const retrievers = createRetrievers(corpus);
    try {
      const budget = { topK: 5, contextBytes: 4_000 };
      const oh = await retrievers.retrieve("oh-window", "paris", budget);
      const record = await retrievers.retrieve("bm25-record-window", "paris", budget);
      expect(record).toEqual(oh);
      expect(oh.turnIds.length).toBeGreaterThan(0);
    } finally { retrievers.close(); }
  });

  test("breaks ties by record key identically to oh-window", async () => {
    const retrievers = createRetrievers(corpus);
    try {
      const budget = { topK: 5, contextBytes: 4_000 };
      const oh = await retrievers.retrieve("oh-window", "duplicate", budget);
      const record = await retrievers.retrieve("bm25-record-window", "duplicate", budget);
      expect(record).toEqual(oh);
      expect(oh.turnIds).toEqual(expect.arrayContaining(["tie0", "tie1"]));
    } finally { retrievers.close(); }
  });

  test("folds diacritics identically via the shared unicode61 tokenizer", async () => {
    const retrievers = createRetrievers(corpus);
    try {
      const budget = { topK: 5, contextBytes: 4_000 };
      const oh = await retrievers.retrieve("oh-window", "cafe", budget);
      const record = await retrievers.retrieve("bm25-record-window", "cafe", budget);
      expect(record).toEqual(oh);
      expect(oh.turnIds).toContain("t0");
    } finally { retrievers.close(); }
  });

  test("empty text and no-match queries stay empty for both baselines", async () => {
    const retrievers = createRetrievers(corpus);
    try {
      const budget = { topK: 5, contextBytes: 4_000 };
      const oh = await retrievers.retrieve("oh-window", "zzzznomatchzzzz", budget);
      const record = await retrievers.retrieve("bm25-record-window", "zzzznomatchzzzz", budget);
      expect(record).toEqual(oh);
      expect(oh.turnIds).toEqual([]);
    } finally { retrievers.close(); }
  });

  test("matches production's 16-term cap, repeated terms, and 64-character token bound", async () => {
    const retrievers = createRetrievers(corpus);
    try {
      const budget = { topK: 5, contextBytes: 4_000 };
      const manyTerms = `${Array.from({ length: 20 }, (_, index) => `term${index}`).join(" ")} paris paris paris`;
      const oh = await retrievers.retrieve("oh-window", manyTerms, budget);
      const record = await retrievers.retrieve("bm25-record-window", manyTerms, budget);
      expect(record).toEqual(oh);
      const longToken = `word${"x".repeat(80)}`;
      const ohLong = await retrievers.retrieve("oh-window", longToken, budget);
      const recordLong = await retrievers.retrieve("bm25-record-window", longToken, budget);
      expect(recordLong).toEqual(ohLong);
    } finally { retrievers.close(); }
  });

  test("packs the same window grouping and byte budget as oh-window", async () => {
    const budget = { topK: 5, contextBytes: 120 };
    const retrievers = createRetrievers(corpus);
    try {
      const oh = await retrievers.retrieve("oh-window", "paris", budget);
      const record = await retrievers.retrieve("bm25-record-window", "paris", budget);
      expect(record).toEqual(oh);
      expect(record.omittedForBudget).toBeGreaterThan(0);
    } finally { retrievers.close(); }
  });

  test("never calls production searchKeyword", async () => {
    const retrievers = createRetrievers(corpus);
    try {
      const spy = spyOn(OhSqliteStore.prototype, "searchKeyword");
      spy.mockClear();
      try {
        await retrievers.retrieve("bm25-record-window", "paris", { topK: 5, contextBytes: 2_000 });
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    } finally { retrievers.close(); }
  });
});

describe("bm25-record-fact matches oh-fact exactly", () => {
  const factCorpus: Corpus = { id: "fact-record", groupId: "fact-record", turns: [
    { id: "a", sessionId: "s", date: "2026-01-01", speaker: "Ada", text: "I moved to Paris." },
    { id: "b", sessionId: "s", date: "2026-01-01", speaker: "Bea", text: "Congratulations!" },
  ] };
  const chunk = buildExtractionChunks(factCorpus)[0]!;
  const units = parseMemoryUnits({ units: [{ text: "Ada is a Paris resident.",
    supports: [{ turnId: "a", quote: "I moved to Paris." }] }] }, chunk).units;

  test("matches context, support IDs, and record digests", async () => {
    const retrievers = createRetrievers(factCorpus, units);
    try {
      const budget = { topK: 2, contextBytes: 1_000 };
      const oh = await retrievers.retrieve("oh-fact", "resident", budget);
      const record = await retrievers.retrieve("bm25-record-fact", "resident", budget);
      expect(record).toEqual(oh);
      expect(record.context).toContain("Ada is a Paris resident.");
      expect(record.supportTurnIds).toEqual(["a"]);
    } finally { retrievers.close(); }
  });

  test("prepares its record index ahead of queries and does not rebuild on retrieval", async () => {
    const retrievers = createRetrievers(factCorpus, units);
    try {
      const systems = ["bm25-record-window", "bm25-record-fact"] as const;
      const ingestion = retrievers.prepare(systems);
      expect(ingestion.recordIndexes?.window?.documents).toBeGreaterThan(0);
      expect(ingestion.recordIndexes?.fact?.documents).toBeGreaterThan(0);
      expect(ingestion.recordIndexes?.window?.buildMs).toBeGreaterThanOrEqual(0);
      expect(ingestion.recordIndexes?.fact?.buildMs).toBeGreaterThanOrEqual(0);
      const commits = spyOn(OhSqliteStore.prototype, "commit");
      try {
        for (const system of systems) {
          const retrieved = await retrievers.retrieve(system, "Paris", { topK: 2, contextBytes: 1_000 });
          expect(retrieved.context).toContain("Paris");
        }
        expect(commits).not.toHaveBeenCalled();
        expect(retrievers.prepare(systems)).toEqual(ingestion);
      } finally { commits.mockRestore(); }
    } finally { retrievers.close(); }
  });

  test("never calls production searchKeyword", async () => {
    const retrievers = createRetrievers(factCorpus, units);
    try {
      const spy = spyOn(OhSqliteStore.prototype, "searchKeyword");
      spy.mockClear();
      try {
        await retrievers.retrieve("bm25-record-fact", "resident", { topK: 2, contextBytes: 1_000 });
        expect(spy).not.toHaveBeenCalled();
      } finally { spy.mockRestore(); }
    } finally { retrievers.close(); }
  });

  test("refuses memory units whose source digest is no longer current", async () => {
    const authority = new OhSqliteStore({ path: ":memory:", spaceId: "record-source-test" });
    const records = factCorpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({ v: 1, kind: "edition",
      key: `edition:source-${index}`, value: { ...turn }, dependencies: [] }));
    authority.commit({ actorId: "test", expectedHead: authority.head(), operationId: "op_source_init",
      instant: "2026-01-01T00:00:00.000Z", changes: records.map((record) => ({ v: 1, kind: "put", record })) });
    const index = createUnitIndex(factCorpus, units.map((unit) => ({ ...unit, sourceTurnIds: ["a"] })), records, authority);
    try {
      expect((await index.retrieve("bm25-record-fact", "resident", { topK: 2, contextBytes: 1_000 })).context).not.toBe("");
      const update = createKnowledgeGraphRecordV1({ v: 1, kind: "edition", key: records[0]!.key, dependencies: [],
        value: { ...factCorpus.turns[0]!, text: "I moved to Rome." } });
      authority.commit({ actorId: "test", expectedHead: authority.head(), operationId: "op_source_update",
        instant: "2026-01-02T00:00:00.000Z", changes: [{ v: 1, kind: "put", record: update }] });
      expect((await index.retrieve("bm25-record-fact", "resident", { topK: 2, contextBytes: 1_000 })).context).toBe("");
    } finally { index.close(); authority.close(); }
  });
});
