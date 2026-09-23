import { describe, expect, test } from "bun:test";

import { createKnowledgeGraphRecordV1 } from "./graph";
import { OH_RERANK_PROFILE_V1 } from "./rerank-model";
import { searchOhV1 } from "./search";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "./semantic";
import { OhSqliteStore } from "./sqlite/store";

function put(store: OhSqliteStore, name: string, key = "entity:ada") {
  const record = createKnowledgeGraphRecordV1({ dependencies: [], key, kind: "entity", v: 1, value: { name } });
  store.commit({ actorId: "test", changes: [{ kind: "put", record, v: 1 }], expectedHead: store.head(),
    operationId: `op_${store.head().generation}` });
  return record;
}
function backend(search: OhSemanticSearchBackendV1["search"]): OhSemanticSearchBackendV1 {
  return { profile: OH_EMBEDDING_PROFILE_V1, close: async () => {}, index: async () => ({ indexed: 0, v: 1 }), search };
}

describe("search backend authority and bounds", () => {
  test("drops stale vector hits instead of crediting a newer record with old evidence", async () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    const old = put(store, "old engine");
    put(store, "current engine");
    try {
      const response = await searchOhV1({ query: "engine", store, backend: backend(async () => [
        { key: old.key, recordSha256: old.recordSha256, score: 1, v: 1 },
      ]) });
      expect(response.mode).toBe("hybrid");
      expect(response.diagnostics).toEqual([]);
      expect(response.results).toHaveLength(1);
      expect(response.results[0]?.evidence.map((item) => item.lane)).toEqual(["keyword"]);
      expect(response.results[0]?.record.value).toEqual({ name: "current engine" });
    } finally { store.close(); }
  });

  test("drops stale keyword hits when authority changes during the semantic request", async () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    put(store, "old engine");
    try {
      const response = await searchOhV1({ query: "engine", store, backend: backend(async () => {
        put(store, "unrelated replacement");
        return [];
      }) });
      expect(response.results).toEqual([]);
    } finally { store.close(); }
  });

  test("rejects oversized, duplicate, non-finite and malformed external semantic lanes before pooling", async () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    const record = put(store, "Ada engine");
    const hit = { key: record.key, recordSha256: record.recordSha256, score: 1, v: 1 };
    const invalid: unknown[] = [null, [hit, hit], new Array(1), [null], [{ ...hit, v: 2 }], [{ ...hit, extra: true }],
      [{ ...hit, recordSha256: "bad" }], [{ ...hit, key: "bad\0key" }], [{ ...hit, score: Infinity }],
      [{ ...hit, score: NaN }], Array.from({ length: 31 }, (_, index) => ({ ...hit, key: `entity:x${index}` }))];
    try {
      for (const value of invalid) {
        const response = await searchOhV1({ query: "engine", store, backend: backend(async () => value as never) });
        expect(response.diagnostics.map((item) => item.code)).toEqual(["semantic-unavailable"]);
        expect(response.results[0]?.evidence.map((item) => item.lane)).toEqual(["keyword"]);
      }
    } finally { store.close(); }
  });

  test("a rerank failure does not return records changed or tombstoned while the model was scoring", async () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    put(store, "Ada engine");
    const other = put(store, "Other engine", "entity:other");
    put(store, "Stable engine", "entity:stable");
    try {
      const response = await searchOhV1({ query: "engine", store, reranker: {
        profile: OH_RERANK_PROFILE_V1, close: async () => {}, rerank: async () => {
          put(store, "unrelated replacement");
          store.commit({ actorId: "test", changes: [{ kind: "tombstone", key: other.key, priorSha256: other.recordSha256, v: 1 }],
            expectedHead: store.head(), operationId: "op_deleted" });
          throw new Error("scoring failed after concurrent update");
        },
      } });
      expect(response.mode).toBe("rerank");
      expect(response.diagnostics.map((item) => item.code)).toEqual(["semantic-unavailable", "rerank-unavailable"]);
      expect(response.results.map((item) => item.record.key)).toEqual(["entity:stable"]);
    } finally { store.close(); }
  });
});
