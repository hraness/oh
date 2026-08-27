import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import { sha256Hex } from "./canonical";
import { createKnowledgeGraphRecordV1 } from "./graph";
import { searchOhV1 } from "./search";
import { OH_EMBEDDING_PROFILE_V1, OhQmdSemanticBackendV1, cosineSimilarityV1,
  formatOhEmbeddingDocumentV1, formatOhEmbeddingQueryV1, normalizeOhEmbeddingV1,
  type QmdStoreFactoryV1 } from "./semantic";
import { OhSqliteStore } from "./sqlite/store";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const record = (name: string) => createKnowledgeGraphRecordV1({ dependencies: [], key: "entity:ada",
  kind: "entity", v: 1, value: { name } });

function commit(store: OhSqliteStore, value: ReturnType<typeof record>, operationId: string): void {
  store.commit({ actorId: "agent.test", changes: [{ kind: "put", record: value, v: 1 }],
    expectedHead: store.head(), operationId });
}

describe("local EmbeddingGemma profile", () => {
  test("matches the pinned KB/QMD model and prompt contract", () => {
    expect(OH_EMBEDDING_PROFILE_V1).toMatchObject({
      dimensions: 768,
      engine: "@tobilu/qmd@2.5.3",
      model: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
      normalization: "l2",
    });
    expect(formatOhEmbeddingQueryV1("agent research")).toBe("task: search result | query: agent research");
    expect(formatOhEmbeddingDocumentV1("Ada", "research notes")).toBe("title: Ada | text: research notes");
  });

  test("validates dimensions and cosine normalization", () => {
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 3 : index === 1 ? 4 : 0);
    const normalized = normalizeOhEmbeddingV1(vector);
    expect(normalized[0]).toBeCloseTo(0.6);
    expect(normalized[1]).toBeCloseTo(0.8);
    expect(cosineSimilarityV1(vector, vector)).toBeCloseTo(1);
    expect(() => normalizeOhEmbeddingV1([1, 2])).toThrow("768");
  });
});

describe("QMD derived index confinement", () => {
  test("rejoins hits to the exact authoritative record digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-test-"));
    roots.push(root);
    const key = "entity:ada";
    let closed = false;
    const openings: Parameters<QmdStoreFactoryV1>[0][] = [];
    const factory: QmdStoreFactoryV1 = async (options) => {
      openings.push(options);
      return {
      close: async () => { closed = true; },
      embed: async () => ({}),
      searchVector: async () => [{ file: `qmd://oh/${sha256Hex(key)}.md`, score: 0.9 }],
      update: async () => ({}),
      };
    };
    const authority = new OhSqliteStore({ path: ":memory:" });
    const original = record("Ada Lovelace");
    commit(authority, original, "op_first");
    const backend = new OhQmdSemanticBackendV1({ cacheDirectory: root, storeFactory: factory });
    expect(await backend.index(authority.snapshotRecords())).toEqual({ indexed: 1, v: 1 });
    expect(openings).toHaveLength(1);
    const config = openings[0]?.config as { collections?: { oh?: { path?: unknown } } };
    const collectionPath = config.collections?.oh?.path;
    expect(typeof collectionPath).toBe("string");
    expect(isAbsolute(collectionPath as string)).toBe(true);
    expect(collectionPath).toBe(join(root, "documents"));
    expect(await backend.search("mathematician", 10, authority)).toEqual([
      { key, recordSha256: original.recordSha256, score: 0.9, v: 1 },
    ]);
    await backend.close();
    expect(closed).toBe(true);
    closed = false;
    const reopened = new OhQmdSemanticBackendV1({ cacheDirectory: root, storeFactory: factory });
    expect(await reopened.search("mathematician", 10, authority)).toEqual([
      { key, recordSha256: original.recordSha256, score: 0.9, v: 1 },
    ]);
    commit(authority, record("Augusta Ada King"), "op_second");
    expect(await reopened.search("mathematician", 10, authority)).toEqual([]);
    await reopened.close();
    expect(closed).toBe(true);
    authority.close();
  });

  test("resolves relative QMD paths once and rejects results outside its collection URI", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-relative-test-"));
    roots.push(root);
    const relativeCache = relative(process.cwd(), join(root, "cache"));
    const openings: Parameters<QmdStoreFactoryV1>[0][] = [];
    const factory: QmdStoreFactoryV1 = async (options) => {
      openings.push(options);
      return {
        close: async () => {},
        embed: async () => ({}),
        searchVector: async () => [
          { file: `qmd://other/${sha256Hex("entity:ada")}.md`, score: 1 },
          { file: `qmd://oh/${sha256Hex("entity:ada")}.md`, score: -0.1 },
          { file: `qmd://oh/${sha256Hex("entity:ada")}.md`, score: 1.1 },
          { file: `qmd://oh/${sha256Hex("entity:ada")}.md`, score: 0.8 },
        ],
        update: async () => ({}),
      };
    };
    const authority = new OhSqliteStore({ path: ":memory:" });
    const original = record("Ada Lovelace");
    commit(authority, original, "op_first");
    const backend = new OhQmdSemanticBackendV1({ cacheDirectory: relativeCache,
      databasePath: join(relativeCache, "custom.sqlite"), storeFactory: factory });
    await backend.index(authority.snapshotRecords());
    expect(openings).toHaveLength(1);
    expect(openings[0]?.dbPath).toBe(resolve(relativeCache, "custom.sqlite"));
    const config = openings[0]?.config as { collections?: { oh?: { path?: unknown } } };
    expect(config.collections?.oh?.path).toBe(resolve(relativeCache, "documents"));
    expect(await backend.search("mathematician", 10, authority)).toEqual([
      { key: "entity:ada", recordSha256: original.recordSha256, score: 0.8, v: 1 },
    ]);
    await backend.close();
    authority.close();
  });

  test("degrades hybrid search to model-free keyword evidence", async () => {
    const authority = new OhSqliteStore({ path: ":memory:" });
    commit(authority, record("Ada Lovelace analytical engine"), "op_first");
    const response = await searchOhV1({ store: authority, query: "analytical engine", mode: "hybrid",
      backend: {
        profile: OH_EMBEDDING_PROFILE_V1,
        close: async () => {},
        index: async () => ({ indexed: 0, v: 1 }),
        search: async () => { throw new Error("model unavailable"); },
      } });
    expect(response.results[0]?.record.key).toBe("entity:ada");
    expect(response.results[0]?.evidence.map((item) => item.lane)).toEqual(["keyword"]);
    expect(response.diagnostics).toEqual([{ code: "semantic-unavailable", message: "model unavailable", v: 1 }]);
    authority.close();
  });
});
