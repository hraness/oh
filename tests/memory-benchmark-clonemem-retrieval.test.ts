import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1, type OhSemanticSearchResultV1 } from "../src/semantic-model";
import { prepareCloneMemRetrieval } from "../scripts/benchmarks/clonemem-retrieval";
import type { CloneMemMemory } from "../scripts/benchmarks/clonemem-dataset";

const source: CloneMemMemory = { personId: "persona", personName: "Person", traces: [
  { id: "early-semantic", date: "2024-01-01T00:00:00", medium: "diary", content: "Entire earliest trace.\nSecond line." },
  { id: "future-lexical", date: "2024-01-03T00:00:00", medium: "mail", content: "Rareterm future future future." },
  { id: "early-lexical", date: "2024-01-01T00:00:00", medium: "note", content: "Rareterm early lexical trace." },
  { id: "middle", date: "2024-01-02T00:00:00", medium: "chat", content: "Middle trace." },
] };
function fake(options: { mutate?: (hits: OhSemanticSearchResultV1[]) => OhSemanticSearchResultV1[];
  search?: () => Promise<void>; mismatchIndex?: boolean } = {}) {
  let records: readonly KnowledgeGraphRecordV1[] = [], closed = 0;
  const indexes: string[][] = [], searches: { query: string; limit: number; keys: string[] }[] = [];
  const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index(next) { records = [...next]; indexes.push(next.map(record => record.key));
      return { indexed: next.length + (options.mismatchIndex ? 1 : 0), v: 1 }; },
    async search(query, limit, authority) {
      searches.push({ query, limit, keys: authority.snapshotRecords().map(record => record.key) });
      await options.search?.();
      const hits = records.map((record, index) => ({ key: record.key, recordSha256: record.recordSha256, score: 1 - index / 100, v: 1 as const }));
      return options.mutate?.(hits) ?? hits;
    }, async close() { closed++; } };
  return { backend, indexes, searches, closed: () => closed };
}
test("actual SDK hybrid uses one shared capture, whole native traces, and only causally eligible records", async () => {
  const injected = structuredClone(source);
  Object.defineProperty(injected, "gold", { enumerable: true, get() { throw Error("gold must not be read"); } });
  Object.defineProperty(injected.traces[0]!, "answer", { enumerable: true, get() { throw Error("answer must not be read"); } });
  const mock = fake(), prepared = await prepareCloneMemRetrieval(injected, mock.backend);
  try {
    expect(mock.indexes).toEqual([]);
    const row = await prepared.retrieve("Rareterm", "2024-01-01T00:00:00Z");
    expect(mock.searches).toHaveLength(1); expect(mock.searches[0]!.limit).toBe(30);
    expect(mock.indexes).toEqual([["edition:trace-00000", "edition:trace-00002"]]);
    expect(mock.searches[0]!.keys).toEqual(mock.indexes[0]!);
    expect(row.eligibleTraceIds).toEqual(["early-semantic", "early-lexical"]);
    expect(row.arms.map(arm => [arm.arm, arm.traceIds[0]])).toEqual([
      ["oh-hybrid", "early-lexical"], ["raw-vector", "early-semantic"], ["oh-keyword", "early-lexical"]]);
    expect(row.arms[1]!.context).toBe("---- idx 1 ----\nEntire earliest trace.\nSecond line.\n\n---- idx 2 ----\nRareterm early lexical trace.");
    for (const arm of row.arms) {
      expect(arm.contextSha256).toBe(sha256Hex(arm.context));
      expect(arm.contextBytes).toBe(Buffer.byteLength(arm.context));
      expect(arm.traceIds).not.toContain("future-lexical");
      expect(arm.traceIds.length).toBeLessThanOrEqual(10);
    }
    expect(row.arms[0]!.evidence[0]!.map(lane => lane.lane)).toEqual(["keyword", "semantic"]);
    expect(row.semanticCaptureSha256).toBe(canonicalSha256(row.semanticCapture));
    expect(Object.isFrozen(row.semanticCapture[0])).toBe(true);
    expect(row.timing.hybridWallMs).toBeGreaterThanOrEqual(row.timing.sharedSemanticTop30Ms);
  } finally { await prepared.close(); }
  expect(mock.closed()).toBe(1);
});
test("incremental chronological ingestion preserves global keys, skips unchanged cutoffs, and includes exact cutoff", async () => {
  const mock = fake(), prepared = await prepareCloneMemRetrieval(source, mock.backend);
  try {
    await prepared.retrieve("first", "2024-01-01T00:00:00");
    const same = await prepared.retrieve("second", "2024-01-01T12:00:00");
    expect(same.timing.incrementalIndexMs).toBe(0);
    const later = await prepared.retrieve("third", "2024-01-02T00:00:00");
    expect(later.eligibleTraceIds).toEqual(["early-semantic", "early-lexical", "middle"]);
    expect(mock.indexes).toHaveLength(2);
    expect(mock.indexes[1]).toEqual(["edition:trace-00000", "edition:trace-00002", "edition:trace-00003"]);
    await expect(prepared.retrieve("backwards", "2024-01-01T00:00:00")).rejects.toThrow("chronological");
    await expect(prepared.retrieve("after-failure", "2024-01-04T00:00:00")).rejects.toThrow("failed");
    expect(mock.searches).toHaveLength(3);
  } finally { await prepared.close(); }
});
test("stale, duplicate, nonfinite and unknown semantic hits fail closed instead of lexical fallback", async () => {
  for (const mutate of [
    (hits: OhSemanticSearchResultV1[]) => [{ ...hits[0]!, recordSha256: sha256Hex("wrong") }],
    (hits: OhSemanticSearchResultV1[]) => [hits[0]!, hits[0]!],
    (hits: OhSemanticSearchResultV1[]) => [{ ...hits[0]!, score: Infinity }],
    (hits: OhSemanticSearchResultV1[]) => [{ ...hits[0]!, key: "edition:trace-00001" }],
  ]) {
    const mock = fake({ mutate }), prepared = await prepareCloneMemRetrieval(source, mock.backend);
    try { await expect(prepared.retrieve("Rareterm", "2024-01-01T00:00:00")).rejects.toThrow("fallback"); }
    finally { await prepared.close(); }
    expect(mock.closed()).toBe(1);
  }
});
test("capture top ten preserves the physical ranking without vector tail invention or context truncation", async () => {
  const many: CloneMemMemory = { personId: "many", personName: "Person", traces: Array.from({ length: 40 }, (_, index) => ({
    id: `trace-${index}`, medium: "mail", date: "2024-01-01T00:00:00", content: `${index} ${"x".repeat(2_000)}` })) };
  const mock = fake({ mutate: hits => hits.slice(0, 30) }), prepared = await prepareCloneMemRetrieval(many, mock.backend);
  try {
    const row = await prepared.retrieve("x", "2024-01-01T00:00:00");
    expect(row.semanticCapture).toHaveLength(30);
    expect(row.arms[1]!.traceIds).toEqual(Array.from({ length: 10 }, (_, index) => `trace-${index}`));
    expect(row.arms[1]!.contextBytes).toBeGreaterThan(12_000);
    expect(row.arms[1]!.context).toContain(many.traces[9]!.content);
    expect(mock.searches).toHaveLength(1);
  } finally { await prepared.close(); }
});
test("index count failures admit no query and owned close is idempotent", async () => {
  const mock = fake({ mismatchIndex: true }), prepared = await prepareCloneMemRetrieval(source, mock.backend);
  await expect(prepared.retrieve("Rareterm", "2024-01-01T00:00:00")).rejects.toThrow("incomplete index");
  expect(mock.searches).toHaveLength(0);
  await prepared.close(); await prepared.close();
  expect(mock.closed()).toBe(1);
  await expect(prepared.retrieve("closed", "2024-01-01T00:00:00")).rejects.toThrow("closed");
});
test("concurrent retrieval is refused and close drains the sole owned query", async () => {
  let entered!: () => void, release!: () => void;
  const began = new Promise<void>(resolve => { entered = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const mock = fake({ search: async () => { entered(); await wait; } });
  const prepared = await prepareCloneMemRetrieval(source, mock.backend);
  const pending = prepared.retrieve("Rareterm", "2024-01-01T00:00:00");
  await began;
  await expect(prepared.retrieve("other", "2024-01-01T00:00:00")).rejects.toThrow("concurrent");
  const closing = prepared.close(); expect(mock.closed()).toBe(0);
  release(); await pending; await closing;
  expect(mock.closed()).toBe(1);
});
