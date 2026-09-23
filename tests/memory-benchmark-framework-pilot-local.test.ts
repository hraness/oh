import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_RERANK_PROFILE_V1, type OhRerankBackendV1 } from "../src/rerank-model";
import { OH_EMBEDDING_PROFILE_V1, recordDocument, type OhSemanticSearchBackendV1 } from "../src/semantic-model";
import { runFrameworkPilotLocalV1, type FrameworkPilotLocalBackendsV1 } from "../scripts/benchmarks/framework-pilot-local-v1";
import { createFrameworkPilotSourceUnitsV1 } from "../scripts/benchmarks/framework-pilot-source-v1";

const parents: string[] = [];
async function parent(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oh-pilot-local-test-")); parents.push(path); return path;
}
afterEach(async () => { for (const path of parents.splice(0)) await rm(path, { recursive: true, force: true }); });
function input(texts = ["Ruby crystal alpha", "Ruby crystal alpha"], queries = ["Where is Ruby?", "the and"] ) {
  const source = { protocol: "oh.framework-pilot-source.v1", sessions: [{ sessionId: "s0001", sessionIndex: 0,
    date: "2030-01-02", turns: texts.map(text => ({ role: "user", text })) }] };
  const splitPlan = { protocol: "oh.framework-pilot-split-plan.v1", sourceSha256: canonicalSha256(source),
    turns: texts.map((text, index) => ({ turnId: `s0001#0:${index}`, spans: [{ startByte: 0, endByte: Buffer.byteLength(text) }] })) };
  return { protocol: "oh.framework-pilot-local-input.v1", source, splitPlan,
    sourceUnits: createFrameworkPilotSourceUnitsV1(source, splitPlan),
    queries: queries.map((text, index) => ({ queryId: `q${String(index + 1).padStart(4, "0")}`, text })) };
}
type Hooks = Partial<{
  index: OhSemanticSearchBackendV1["index"]; search: OhSemanticSearchBackendV1["search"];
  rerank: OhRerankBackendV1["rerank"]; semanticClose: () => Promise<void>; rerankClose: () => Promise<void>;
  openRerank: () => Promise<OhRerankBackendV1>;
}>;
function synthetic(hooks: Hooks = {}) {
  const state = { events: [] as string[], directories: [] as string[], records: [] as readonly KnowledgeGraphRecordV1[],
    indexCalls: 0, semanticCloses: 0, rerankCloses: 0, queries: [] as string[], documents: [] as string[][] };
  const backends: FrameworkPilotLocalBackendsV1 = {
    async openSemantic({ cacheDirectory }) {
      expect(await readdir(cacheDirectory)).toEqual([]);
      state.directories.push(cacheDirectory); state.events.push("semantic-open");
      await writeFile(join(cacheDirectory, "synthetic-owned-index"), "synthetic");
      return { profile: OH_EMBEDDING_PROFILE_V1,
        async index(records) {
          state.events.push("index"); state.indexCalls++; state.records = records;
          expect(Object.isFrozen(records)).toBe(true);
          expect(records.every(record => Object.isFrozen(record) && Object.isFrozen(record.value))).toBe(true);
          return hooks.index ? await hooks.index(records) : { indexed: records.length, v: 1 };
        },
        async search(query, limit, authority) {
          state.events.push("semantic-search"); state.queries.push(query);
          expect(state.indexCalls).toBe(1); expect(limit).toBe(30);
          expect(authority.snapshotRecords().map(record => record.recordSha256)).toEqual(state.records.map(record => record.recordSha256));
          return hooks.search ? await hooks.search(query, limit, authority)
            : state.records.slice(0, limit).map(record => ({ key: record.key, recordSha256: record.recordSha256, score: 0.5, v: 1 }));
        }, async close() { state.events.push("semantic-close"); state.semanticCloses++; await hooks.semanticClose?.(); } };
    },
    async openRerank() {
      state.events.push("rerank-open");
      if (hooks.openRerank) return await hooks.openRerank();
      return { profile: OH_RERANK_PROFILE_V1,
        async rerank(query, documents) {
          state.events.push("rerank"); state.documents.push(documents.map(document => document.text));
          for (const document of documents) expect(document.text).toBe(recordDocument(state.records.find(record => record.key === document.key)!));
          return hooks.rerank ? await hooks.rerank(query, documents)
            : documents.map(document => ({ key: document.key, score: Number(document.key.slice(-6)), v: 1 }));
        }, async close() { state.events.push("rerank-close"); state.rerankCloses++; await hooks.rerankClose?.(); } };
    } };
  return { state, backends };
}

describe("framework pilot fresh local retrieval", () => {
  test("uses the real SDK default route, common complete source, explicit BM25 policy and owned cleanup", async () => {
    const packet = input(), cacheParent = await parent(), { state, backends } = synthetic();
    const result = await runFrameworkPilotLocalV1(packet, backends, { cacheParent });
    expect(result.status).toBe("complete");
    expect(result.backendQualification).toBe("not-established-by-this-module");
    expect(result.modelContextFit).toBe("not-established-by-this-module");
    expect(result.sourceCompleteness).toBe("relative-to-supplied-projection");
    expect(result.bundleSha256).toBe(packet.sourceUnits.bundleSha256);
    expect(result.records.map(record => record.unitSha256)).toEqual(packet.sourceUnits.units.map(unit => unit.unitSha256));
    expect(result.indexed).toBe(2); expect(state.indexCalls).toBe(1);
    expect(state.queries).toEqual(packet.queries.map(query => query.text));
    expect(result.queries.map(query => query.queryId)).toEqual(["q0001", "q0002"]);
    expect(result.queries[0]!.querySha256).toBe(sha256Hex(packet.queries[0]!.text));
    expect(result.queries[0]!.lexicalQuery).toBe("ruby");
    expect(result.queries[0]!.bm25.hits.map(hit => hit.unitId)).toEqual(["u000001", "u000002"]);
    expect(result.queries[1]!.bm25.hits).toEqual([]);
    expect(result.queries[0]!.oh.hits.map(hit => hit.unitId)).toEqual(["u000002", "u000001"]);
    expect(result.queries.every(query => query.oh.mode === "rerank" && query.oh.rerankCalls === 1 && query.oh.diagnostics.length === 0)).toBe(true);
    for (const query of result.queries) for (const hit of [...query.oh.hits, ...query.bm25.hits]) {
      const record = state.records.find(record => record.key === hit.recordKey)!;
      expect(hit.content).toBe(canonicalJson(record.value)); expect(hit.recordSha256).toBe(record.recordSha256);
      expect(result.records.find(value => value.key === record.key)!.documentSha256).toBe(sha256Hex(recordDocument(record)));
    }
    expect(result.cache).toEqual({ directory: state.directories[0], created: true, removed: true });
    expect(await readdir(cacheParent)).toEqual([]);
    expect(state.semanticCloses).toBe(1); expect(state.rerankCloses).toBe(1);
    expect(state.events.slice(-2)).toEqual(["semantic-close", "rerank-close"]);
    for (const value of Object.values(result.timings)) expect(Number.isFinite(value) && value >= 0).toBe(true);
    expect(result.timings.totalMs).toBeGreaterThanOrEqual(result.timings.semanticIndexMs);
    expect(Object.isFrozen(result.queries[0]!.oh.hits[0])).toBe(true);
    expect(Object.isFrozen(result.queries[0]!.oh.hits[0]!.evidence)).toBe(true);
  });

  test("repeated runs have fresh index directories and namespaces, and no captured semantic replay", async () => {
    const cacheParent = await parent(), first = synthetic(), second = synthetic();
    const left = await runFrameworkPilotLocalV1(input(["first text"], ["first"]), first.backends, { cacheParent });
    const right = await runFrameworkPilotLocalV1(input(["second text"], ["second"]), second.backends, { cacheParent });
    expect(left.namespace).not.toBe(right.namespace); expect(left.cache.directory).not.toBe(right.cache.directory);
    expect(left.records[0]!.recordSha256).not.toBe(right.records[0]!.recordSha256);
    expect(first.state.indexCalls).toBe(1); expect(second.state.indexCalls).toBe(1);
    expect(canonicalJson(second.state.records)).not.toContain("first text");
    expect(await readdir(cacheParent)).toEqual([]);
  });

  test("fully ingests multiple batches and preserves source and query order with a bounded top twenty", async () => {
    const packet = input(Array.from({ length: 130 }, (_, index) => `source ${index} Ruby`), ["second question", "first question"]);
    const { state, backends } = synthetic(), result = await runFrameworkPilotLocalV1(packet, backends, { cacheParent: await parent() });
    expect(result.status).toBe("complete"); expect(state.records.length).toBe(130); expect(result.indexed).toBe(130);
    expect(state.records.map(record => record.key)).toEqual(packet.sourceUnits.units.map(unit => `edition:${unit.unitId}`));
    expect(state.queries).toEqual(["second question", "first question"]);
    expect(result.queries[0]!.oh.hits.length).toBe(20);
    expect(canonicalJson(state.records)).not.toContain("second question");
  });

  test("preserves repeated occurrences, unsorted dates, empty text and literal Unicode source bytes", async () => {
    const source = { protocol: "oh.framework-pilot-source.v1", sessions: [
      { sessionId: "s0001", sessionIndex: 0, date: "2030-03-03", turns: [{ role: "user", text: "Cafe\u0301\0\n🧪" }] },
      { sessionId: "s0001", sessionIndex: 1, date: "2020-01-01", turns: [{ role: "assistant", text: "" }] },
      { sessionId: "s0002", sessionIndex: 2, date: "2010-01-01", turns: [] },
    ] };
    const splitPlan = { protocol: "oh.framework-pilot-split-plan.v1", sourceSha256: canonicalSha256(source), turns: [
      { turnId: "s0001#0:0", spans: [{ startByte: 0, endByte: Buffer.byteLength(source.sessions[0]!.turns[0]!.text) }] },
      { turnId: "s0001#1:0", spans: [{ startByte: 0, endByte: 0 }] },
    ] };
    const bundle = createFrameworkPilotSourceUnitsV1(source, splitPlan), { state, backends } = synthetic();
    const result = await runFrameworkPilotLocalV1({ ...input(), source, splitPlan, sourceUnits: bundle }, backends, { cacheParent: await parent() });
    expect(result.status).toBe("complete"); expect(result.sourceSha256).toBe(canonicalSha256(source));
    expect(state.records.map(record => (record.value as { date: string }).date)).toEqual(["2030-03-03", "2020-01-01"]);
    expect(state.records.map(record => (record.value as { text: string }).text)).toEqual(["Cafe\u0301\0\n🧪", ""]);
    expect(state.records.map(record => (record.value as { turnId: string }).turnId)).toEqual(["s0001#0:0", "s0001#1:0"]);
    expect(result.bundleSha256).toBe(bundle.bundleSha256);
  });

  test("rejects tampered source, label fields, sparse/accessor queries and byte-invalid units before factories", async () => {
    const cacheParent = await parent(), { state, backends } = synthetic();
    const packet = input(), changed = structuredClone(packet);
    (changed.sourceUnits.units[0] as { text: string }).text = "forged";
    const malformed: unknown[] = [changed, { ...packet, gold: "label" }, { ...packet, queries: [{ queryId: "q0001", text: "Ruby", answer: "label" }] },
      { ...packet, queries: [{ queryId: "q0002", text: "Ruby" }] }, { ...packet, queries: Array(1) },
      { ...packet, queries: [{ queryId: "q0001", text: " " }] }, { ...packet, queries: [{ queryId: "q0001", text: "x".repeat(16_385) }] },
      input(["x".repeat(65_537)])];
    let reads = 0;
    const row = { queryId: "q0001", get text() { reads++; return "Ruby"; } };
    malformed.push({ ...packet, queries: [row] });
    for (const value of malformed) await expect(runFrameworkPilotLocalV1(value, backends, { cacheParent })).rejects.toThrow();
    expect(reads).toBe(0); expect(state.events).toEqual([]); expect(await readdir(cacheParent)).toEqual([]);
  });

  test("partial indexing fails the configured arm while retaining completed BM25 and close evidence", async () => {
    const { state, backends } = synthetic({ index: async records => ({ indexed: records.length - 1, v: 1 }) });
    const result = await runFrameworkPilotLocalV1(input(), backends, { cacheParent: await parent() });
    expect(result.status).toBe("failed"); expect(result.failure?.stage).toBe("semantic-index");
    expect(result.failure?.message).toContain("every unit"); expect(result.indexed).toBe(0);
    expect(result.queries.every(query => query.bm25.status === "complete" && query.oh.status === "not-run")).toBe(true);
    expect(state.queries).toEqual([]); expect(state.semanticCloses).toBe(1); expect(state.rerankCloses).toBe(1);
    expect(result.timings.semanticIndexMs).toBeGreaterThanOrEqual(0); expect(result.cache.removed).toBe(true);
  });

  test("semantic and rerank fallback diagnostics never become qualified rerank success", async () => {
    for (const hooks of [{ search: async () => { throw Error("semantic unavailable"); } },
      { rerank: async () => { throw Error("pair exceeds native token allowance"); } }]) {
      const { backends } = synthetic(hooks), result = await runFrameworkPilotLocalV1(input(), backends, { cacheParent: await parent() });
      expect(result.status).toBe("unqualified"); expect(result.failure).toBeNull();
      expect(result.queries[0]!.oh.status).toBe("unqualified-fallback");
      expect(result.queries[0]!.oh.diagnostics.length).toBe(1);
      expect(result.queries[0]!.oh.hits.length).toBeGreaterThan(0);
      expect(result.queries[0]!.oh.hits.every(hit => result.records.some(record => record.recordSha256 === hit.recordSha256))).toBe(true);
      expect(result.cache.removed).toBe(true);
    }
  });

  test("stale and foreign semantic identities are explicit diagnostics instead of silent source joins", async () => {
    for (const key of ["edition:u000001", "edition:foreign"]) {
      const { backends } = synthetic({ search: async () => [{ key, recordSha256: "0".repeat(64) as never, score: 1, v: 1 }] });
      const result = await runFrameworkPilotLocalV1(input(), backends, { cacheParent: await parent() });
      expect(result.status).toBe("unqualified");
      expect(result.queries[0]!.oh.diagnostics[0]!.message).toContain("digest join");
      expect(result.queries[0]!.oh.hits.every(hit => hit.recordSha256 !== "0".repeat(64))).toBe(true);
    }
  });

  test("records a failed attempted query and stops after authority mutation", async () => {
    const { state, backends } = synthetic({ search: async (_query, _limit, authority) => {
      const record = createKnowledgeGraphRecordV1({ key: "edition:mutated", dependencies: [], kind: "edition", value: "mutated", v: 1 });
      authority.commit({ actorId: "test", changes: [{ kind: "put", record, v: 1 }], expectedHead: authority.head(),
        instant: "2026-01-01T00:00:00.000Z", operationId: "op_test_changed" }); return [];
    } });
    const result = await runFrameworkPilotLocalV1(input(), backends, { cacheParent: await parent() });
    expect(result.status).toBe("failed"); expect(result.failure?.message).toContain("authority changed");
    expect(result.queries[0]!.oh.status).toBe("failed"); expect(result.queries[1]!.oh.status).toBe("not-run");
    expect(result.queries[0]!.oh.searchMs).toBeGreaterThanOrEqual(result.queries[0]!.oh.semanticMs);
    expect(result.queries[0]!.oh.semanticCalls).toBe(1); expect(state.queries.length).toBe(1);
    expect(result.cache.removed).toBe(true);
  });

  test("failed partial acquisition closes returned resources exactly once", async () => {
    const { state, backends } = synthetic({ openRerank: async () => { throw Error("acquisition failed"); } });
    const result = await runFrameworkPilotLocalV1(input(), backends, { cacheParent: await parent() });
    expect(result.status).toBe("failed"); expect(result.failure?.stage).toBe("initialize");
    expect(state.semanticCloses).toBe(1); expect(state.rerankCloses).toBe(0); expect(state.indexCalls).toBe(0);
    expect(result.cache.removed).toBe(true);
  });

  test("failed close preserves the owned directory and attempts the other close", async () => {
    const cacheParent = await parent(), { state, backends } = synthetic({ semanticClose: async () => { throw Error("drain failed"); } });
    const result = await runFrameworkPilotLocalV1(input(), backends, { cacheParent });
    expect(result.status).toBe("failed"); expect(result.cleanupFailures.map(value => value.stage)).toEqual(["sdk-close"]);
    expect(result.failure).toBeNull(); expect(result.cache.removed).toBe(false);
    expect(await readdir(result.cache.directory!)).toEqual(["synthetic-owned-index"]);
    expect(state.semanticCloses).toBe(1); expect(state.rerankCloses).toBe(1);
    expect(result.queries.every(query => query.oh.status === "complete")).toBe(true);
  });

  test("awaits admitted backend work before close and directory removal", async () => {
    let enter!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const { state, backends } = synthetic({ search: async () => { enter(); await pending; return []; } });
    const run = runFrameworkPilotLocalV1(input(["Ruby"], ["Ruby"]), backends, { cacheParent: await parent() });
    await entered;
    expect(state.semanticCloses).toBe(0); expect(state.rerankCloses).toBe(0);
    expect(await readdir(state.directories[0]!)).toEqual(["synthetic-owned-index"]);
    finish(); const result = await run;
    expect(result.status).toBe("complete"); expect(result.cache.removed).toBe(true);
    expect(state.semanticCloses).toBe(1); expect(state.rerankCloses).toBe(1);
  });

  test("empty results retain a rerank mode without claiming a reranker call", async () => {
    const { backends } = synthetic({ search: async () => [] });
    const result = await runFrameworkPilotLocalV1(input(["empty source"], ["quartz"]), backends, { cacheParent: await parent() });
    expect(result.status).toBe("complete"); expect(result.queries[0]!.oh.mode).toBe("rerank");
    expect(result.queries[0]!.oh.hits).toEqual([]); expect(result.queries[0]!.oh.rerankCalls).toBe(0);
    expect(result.backendQualification).toBe("not-established-by-this-module");
  });
});
