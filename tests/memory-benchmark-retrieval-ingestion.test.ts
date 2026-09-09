import { describe, expect, spyOn, test } from "bun:test";

import { canonicalJson, canonicalSha256 } from "../src/canonical";
import { OH_OPERATION_MAX_BYTES_V1 } from "../src/operation";
import { OhSqliteStore, type OhCommitInputV1 } from "../src/sqlite/store";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { createRetrievers, SYSTEMS } from "../scripts/benchmarks/retrieval";
import type { MemoryUnit } from "../scripts/benchmarks/units";

function fixture(count: number): { corpus: Corpus; units: MemoryUnit[] } {
  const turns = Array.from({ length: count }, (_, i) => ({ id: `turn-${i}`, sessionId: "repeated-session",
    sessionIndex: Math.floor(i / 24), date: "2026-01-01", speaker: i % 2 ? "Ada" : "Bea",
    text: `${i % 3 ? "Paris café" : "London library"} on Friday, journal entry ${i % 11}.` }));
  return { corpus: { id: "ingestion", groupId: "ingestion", turns }, units: turns.map(turn => ({
    id: `unit-${turn.id}`, text: `Travel note: ${turn.text}`, date: turn.date,
    sessionId: turn.sessionId, sessionIndex: turn.sessionIndex,
    supports: [{ turnId: turn.id, quote: turn.text }],
  })) };
}

async function outputs(corpus: Corpus, units: readonly MemoryUnit[]) {
  const retrievers = createRetrievers(corpus, units);
  try {
    retrievers.prepare(SYSTEMS);
    const rows = [];
    for (const system of SYSTEMS) for (const budget of [{ topK: 20, contextBytes: 12000 }, { topK: 4, contextBytes: 140 }]) {
      rows.push({ system, budget, result: await retrievers.retrieve(system, "Paris cafe Friday", budget) });
    }
    return { fullContextBytes: retrievers.fullContextBytes, rows };
  } finally { retrievers.close(); }
}

describe("bounded benchmark ingestion", () => {
  test("larger batches preserve every retrieval arm against 128-record authoritative commits", async () => {
    const { corpus, units } = fixture(769);
    const commit = OhSqliteStore.prototype.commit;
    let referenceOperations = 0;
    const legacy = spyOn(OhSqliteStore.prototype, "commit").mockImplementation(function (this: OhSqliteStore, input: OhCommitInputV1) {
      let last: ReturnType<typeof commit> | undefined;
      for (let offset = 0; offset < input.changes.length; offset += 128) {
        last = commit.call(this, { ...input, expectedHead: this.head(), operationId: `reference_${referenceOperations++}`,
          changes: input.changes.slice(offset, offset + 128) });
      }
      if (last === undefined) throw new Error("Empty reference commit.");
      return last;
    });
    let reference: Awaited<ReturnType<typeof outputs>>;
    try { reference = await outputs(corpus, units); } finally { legacy.mockRestore(); }
    const calls: { actorId: string; count: number }[] = [];
    const current = spyOn(OhSqliteStore.prototype, "commit").mockImplementation(function (this: OhSqliteStore, input: OhCommitInputV1) {
      calls.push({ actorId: input.actorId, count: input.changes.length });
      return commit.call(this, input);
    });
    try {
      const actual = await outputs(corpus, units);
      expect(actual).toEqual(reference);
      expect(canonicalSha256(actual)).toBe(canonicalSha256(reference));
      expect(calls.filter(row => row.actorId === "benchmark.ingest").map(row => row.count)).toEqual([512, 257]);
      expect(calls.some(row => row.actorId === "benchmark.units" && row.count === 512)).toBe(true);
      expect(calls.length).toBeLessThan(referenceOperations);
    } finally { current.mockRestore(); }
  });

  test("escaped Unicode payloads split on bytes before the record-count limit", () => {
    const { corpus } = fixture(13);
    const large: Corpus = { ...corpus, turns: corpus.turns.map(turn => ({ ...turn, text: "é😀\\\n".repeat(32768) })) };
    const commit = OhSqliteStore.prototype.commit;
    const batches: { count: number; changesBytes: number; operationBytes: number }[] = [];
    const spy = spyOn(OhSqliteStore.prototype, "commit").mockImplementation(function (this: OhSqliteStore, input: OhCommitInputV1) {
      const operation = commit.call(this, input);
      batches.push({ count: input.changes.length, changesBytes: Buffer.byteLength(canonicalJson(input.changes)),
        operationBytes: Buffer.byteLength(canonicalJson(operation)) });
      return operation;
    });
    try {
      const retrievers = createRetrievers(large);
      try {
        expect(batches.length).toBeGreaterThan(1);
        expect(batches.reduce((total, batch) => total + batch.count, 0)).toBe(large.turns.length);
        expect(batches.every(batch => batch.count <= 512 && batch.changesBytes <= 4 * 1024 * 1024)).toBe(true);
        expect(batches.every(batch => batch.operationBytes <= OH_OPERATION_MAX_BYTES_V1)).toBe(true);
        expect(batches.reduce((total, batch) => total + batch.changesBytes, 0)).toBeGreaterThan(4 * 1024 * 1024);
        expect(retrievers.fullContextBytes).toBeLessThan(4 * 1024 * 1024);
      } finally { retrievers.close(); }
    } finally { spy.mockRestore(); }
  });

  test("empty corpora need no commit and invalid source support still fails before unit ingestion", async () => {
    const commit = spyOn(OhSqliteStore.prototype, "commit");
    try {
      const empty = createRetrievers({ id: "empty", groupId: "empty", turns: [] });
      try {
        expect(commit).not.toHaveBeenCalled();
        expect((await empty.retrieve("bm25-window", "Paris", { topK: 2, contextBytes: 100 })).turnIds).toEqual([]);
      } finally { empty.close(); }
      const { corpus, units } = fixture(1);
      const bad = createRetrievers(corpus, [{ ...units[0]!, supports: [{ turnId: "unknown", quote: "Paris" }] }]);
      try {
        commit.mockClear();
        expect(() => bad.prepare(["oh-fact"])).toThrow("valid source support");
        expect(commit).not.toHaveBeenCalled();
      } finally { bad.close(); }
    } finally { commit.mockRestore(); }
  });
});
