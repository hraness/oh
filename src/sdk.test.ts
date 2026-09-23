import { describe, expect, test } from "bun:test";

import { OH_RERANK_PROFILE_V1, type OhRerankBackendV1 } from "./rerank-model";
import { Oh } from "./sdk";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "./semantic";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("Oh retrieval defaults and lifetime", () => {
  test("recall uses the configured reranker by default, supports pool size, and honors explicit modes", async () => {
    let semanticCalls = 0, rerankCalls = 0;
    const limits: number[] = [];
    const semanticBackend: OhSemanticSearchBackendV1 = {
      profile: OH_EMBEDDING_PROFILE_V1, close: async () => {}, index: async () => ({ indexed: 0, v: 1 }),
      search: async (_query, limit, store) => {
        semanticCalls++; limits.push(limit);
        return store.list().map((record) => ({ key: record.key, recordSha256: record.recordSha256, score: 1, v: 1 }));
      },
    };
    const rerankBackend: OhRerankBackendV1 = { profile: OH_RERANK_PROFILE_V1, close: async () => {},
      rerank: async (_query, documents) => {
        rerankCalls++;
        return documents.map((item) => ({ key: item.key, score: item.key === "entity:b" ? 1 : 0, v: 1 }));
      } };
    const oh = Oh.open({ databasePath: ":memory:", semanticBackend, rerankBackend });
    try {
      oh.put({ key: "entity:a", kind: "entity", value: { text: "shared engine" } });
      oh.put({ key: "entity:b", kind: "entity", value: { text: "shared engine" } });
      const response = await oh.recall("shared engine", { rerankPoolSize: 12 });
      expect(response.mode).toBe("rerank");
      expect(response.results[0]?.record.key).toBe("entity:b");
      expect(response.diagnostics).toEqual([]);
      expect(limits).toEqual([12]);
      for (const mode of ["keyword", "hybrid", "semantic", "rerank"] as const) {
        expect((await oh.recall("shared engine", { mode })).mode).toBe(mode);
      }
      expect([semanticCalls, rerankCalls]).toEqual([4, 2]);
    } finally { await oh.close(); }
  });

  test("close fences new operations and awaits a whole admitted recall before releasing backends and authority", async () => {
    const entered = deferred<void>(), release = deferred<void>(), disposing = deferred<void>(), disposed = deferred<void>();
    const events: string[] = [];
    let calls = 0;
    const oh = Oh.open({ databasePath: ":memory:", rerankBackend: {
      profile: OH_RERANK_PROFILE_V1,
      close: async () => { events.push("dispose"); disposing.resolve(); await disposed.promise; },
      rerank: async (_query, documents) => {
        calls++;
        if (calls === 1) { entered.resolve(); await release.promise; }
        events.push(`rank${calls}`);
        return documents.map((item) => ({ key: item.key, score: 1, v: 1 }));
      },
    } });
    oh.put({ key: "entity:ada", kind: "entity", value: { text: "Ada engine" } });
    const recall = oh.recall(["Ada", "engine"]);
    await entered.promise;
    let closeSettled = 0;
    const first = oh.close().then(() => { closeSettled++; });
    const second = oh.close().then(() => { closeSettled++; });
    await expect(oh.search("late")).rejects.toThrow("closed");
    await expect(oh.recall("late")).rejects.toThrow("closed");
    await expect(oh.indexSemantic()).rejects.toThrow("closed");
    expect(() => oh.put({ key: "entity:late", kind: "entity", value: {} })).toThrow("closed");
    expect(() => oh.get("entity:ada")).toThrow("closed");
    expect(closeSettled).toBe(0);
    release.resolve();
    expect((await recall).results.map((item) => item.record.key)).toEqual(["entity:ada"]);
    await disposing.promise;
    expect(events).toEqual(["rank1", "rank2", "dispose"]);
    expect(closeSettled).toBe(0);
    expect(oh.store.get("entity:ada")?.key).toBe("entity:ada");
    disposed.resolve();
    await Promise.all([first, second, oh.close()]);
    expect(closeSettled).toBe(2);
    expect(() => oh.store.head()).toThrow("closed");
  });

  test("every close caller observes the same release failure while remaining resources still close", async () => {
    const failure = Object.freeze({ message: "semantic release failure" });
    let rerankCloses = 0, semanticCloses = 0;
    const oh = Oh.open({ databasePath: ":memory:", semanticBackend: {
      profile: OH_EMBEDDING_PROFILE_V1, index: async () => ({ indexed: 0, v: 1 }), search: async () => [],
      close: async () => { semanticCloses++; throw failure; },
    }, rerankBackend: {
      profile: OH_RERANK_PROFILE_V1, rerank: async () => [], close: async () => { rerankCloses++; },
    } });
    const first = oh.close(), second = oh.close();
    await expect(first).rejects.toBe(failure);
    await expect(second).rejects.toBe(failure);
    await expect(oh.close()).rejects.toBe(failure);
    expect([semanticCloses, rerankCloses]).toEqual([1, 1]);
    expect(() => oh.store.head()).toThrow("closed");
  });

  test.each(["search", "indexSemantic"] as const)("close drains an admitted %s before either backend closes", async (method) => {
    const entered = deferred<void>(), release = deferred<void>();
    const events: string[] = [];
    const oh = Oh.open({ databasePath: ":memory:", semanticBackend: {
      profile: OH_EMBEDDING_PROFILE_V1,
      close: async () => { events.push("semantic-close"); },
      index: async () => { entered.resolve(); await release.promise; events.push("index"); return { indexed: 1, v: 1 }; },
      search: async (_query, _limit, authority) => {
        entered.resolve(); await release.promise;
        const record = authority.get("entity:ada");
        if (record === null) throw new Error("authority closed too early");
        events.push("search");
        return [{ key: record.key, recordSha256: record.recordSha256, score: 1, v: 1 }];
      },
    }, rerankBackend: { profile: OH_RERANK_PROFILE_V1,
      close: async () => { events.push("rerank-close"); },
      rerank: async (_query, documents) => documents.map((item) => ({ key: item.key, score: 1, v: 1 })),
    } });
    oh.put({ key: "entity:ada", kind: "entity", value: { text: "engine" } });
    const operation = method === "search" ? oh.search("engine") : oh.indexSemantic();
    await entered.promise;
    const closing = oh.close();
    expect(events).toEqual([]);
    release.resolve();
    await operation;
    await closing;
    expect(events).toEqual([method === "search" ? "search" : "index", "semantic-close", "rerank-close"]);
    expect(() => oh.store.head()).toThrow("closed");
  });
});
