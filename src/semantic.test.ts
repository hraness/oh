import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";

import { canonicalJson, canonicalSha256, sha256Hex } from "./canonical";
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

function testRecordDocument(value: ReturnType<typeof record>): string {
  return `# ${value.key}\n\nkind: ${value.kind}\n\n${canonicalJson(value.value)}\n`;
}

function qmdVectorResult(value: ReturnType<typeof record>,
  overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  const filename = `${sha256Hex(value.key)}.md`;
  const body = testRecordDocument(value);
  const hash = sha256Hex(body);
  return {
    body,
    bodyLength: body.length,
    chunkPos: 0,
    collectionName: "oh",
    context: null,
    displayPath: `oh/${filename}`,
    docid: hash.slice(0, 6),
    filepath: `qmd://oh/${filename}`,
    hash,
    modifiedAt: "",
    score: 0.9,
    source: "vec",
    title: value.key,
    ...overrides,
  };
}

function deferred<T>(): Readonly<{ promise: Promise<T>; resolve: (value: T) => void }> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: (value) => resolvePromise?.(value) };
}

async function writeManifest(root: string, value: ReturnType<typeof record>): Promise<void> {
  const filename = `${sha256Hex(value.key)}.md`;
  await writeFile(join(root, "manifest.json"), canonicalJson({
    entries: { [filename]: { key: value.key, recordSha256: value.recordSha256 } },
    profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1),
    v: 1,
  }), "utf8");
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
  test("closes idempotently after optional backend initialization fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-failed-open-test-"));
    roots.push(root);
    const backend = new OhQmdSemanticBackendV1({
      cacheDirectory: root,
      storeFactory: async () => { throw new Error("optional backend unavailable"); },
    });
    await expect(backend.index([])).rejects.toThrow("optional backend unavailable");
    await expect(backend.close()).resolves.toBeUndefined();
    await expect(backend.close()).resolves.toBeUndefined();
  });

  test("waits for a racing first open and closes a store that resolves after closure", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-close-race-test-"));
    roots.push(root);
    const entered = deferred<void>();
    const release = deferred<void>();
    let closeCalls = 0;
    const backend = new OhQmdSemanticBackendV1({
      cacheDirectory: root,
      storeFactory: async () => {
        entered.resolve();
        await release.promise;
        return {
          close: async () => { closeCalls += 1; },
          embed: async () => ({}),
          searchVector: async () => [],
          update: async () => ({}),
        };
      },
    });
    const authority = new OhSqliteStore({ path: ":memory:" });
    const search = backend.search("racing open", 1, authority);
    await entered.promise;
    let closeSettled = false;
    const close = backend.close().finally(() => { closeSettled = true; });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    release.resolve();
    await expect(search).rejects.toThrow("closed");
    await expect(close).resolves.toBeUndefined();
    await expect(backend.close()).resolves.toBeUndefined();
    expect(closeCalls).toBe(1);
    authority.close();
  });

  test("shares and preserves a store close failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-close-error-test-"));
    roots.push(root);
    let closeCalls = 0;
    const backend = new OhQmdSemanticBackendV1({
      cacheDirectory: root,
      storeFactory: async () => ({
        close: () => {
          closeCalls += 1;
          throw new Error("synthetic close failure");
        },
        embed: async () => ({}),
        searchVector: async () => [],
        update: async () => ({}),
      }),
    });
    await backend.index([]);
    await expect(backend.close()).rejects.toThrow("synthetic close failure");
    await expect(backend.close()).rejects.toThrow("synthetic close failure");
    expect(closeCalls).toBe(1);
  });

  test("waits for an admitted search before closing its store", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-active-search-close-test-"));
    roots.push(root);
    const original = record("Ada Lovelace");
    const authority = new OhSqliteStore({ path: ":memory:" });
    commit(authority, original, "op_active_search");
    const entered = deferred<void>();
    const release = deferred<void>();
    let blockSearch = false;
    let closeCalls = 0;
    const backend = new OhQmdSemanticBackendV1({
      cacheDirectory: root,
      storeFactory: async () => ({
        close: async () => { closeCalls += 1; },
        embed: async () => ({}),
        searchVector: async () => {
          if (blockSearch) {
            entered.resolve();
            await release.promise;
          }
          return [qmdVectorResult(original)];
        },
        update: async () => ({}),
      }),
    });
    await backend.index([original]);
    blockSearch = true;
    const search = backend.search("active", 1, authority);
    await entered.promise;
    let closeSettled = false;
    const close = backend.close().finally(() => { closeSettled = true; });
    await expect(backend.search("late", 1, authority)).rejects.toThrow("closed");
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    expect(closeCalls).toBe(0);
    release.resolve();
    expect((await search)[0]?.recordSha256).toBe(original.recordSha256);
    await close;
    expect(closeCalls).toBe(1);
    authority.close();
  });

  test("shares one complete manifest and store initialization across concurrent first searches", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-concurrent-load-test-"));
    roots.push(root);
    const authority = new OhSqliteStore({ path: ":memory:" });
    const original = record("Ada Lovelace");
    commit(authority, original, "op_concurrent");
    await writeManifest(root, original);
    const entered = deferred<void>();
    const release = deferred<void>();
    let factoryCalls = 0;
    const backend = new OhQmdSemanticBackendV1({
      cacheDirectory: root,
      storeFactory: async () => {
        factoryCalls += 1;
        entered.resolve();
        await release.promise;
        return {
          close: async () => {},
          embed: async () => ({}),
          searchVector: async () => [qmdVectorResult(original)],
          update: async () => ({}),
        };
      },
    });
    const searches = [
      backend.search("first", 1, authority),
      backend.search("second", 1, authority),
      backend.search("third", 1, authority),
    ];
    await entered.promise;
    expect(factoryCalls).toBe(1);
    release.resolve();
    const results = await Promise.all(searches);
    expect(results.every((items) => items[0]?.recordSha256 === original.recordSha256)).toBe(true);
    await backend.close();
    authority.close();
  });

  test("memoizes malformed manifest rejection across concurrent and repeated attempts", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-invalid-manifest-test-"));
    roots.push(root);
    await writeFile(join(root, "manifest.json"), "{}", "utf8");
    let factoryCalls = 0;
    const backend = new OhQmdSemanticBackendV1({
      cacheDirectory: root,
      storeFactory: async () => {
        factoryCalls += 1;
        throw new Error("factory must not run");
      },
    });
    const authority = new OhSqliteStore({ path: ":memory:" });
    const first = await Promise.allSettled([
      backend.search("first", 1, authority),
      backend.search("second", 1, authority),
    ]);
    expect(first.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(first.every((result) => result.status === "rejected"
      && result.reason instanceof Error && result.reason.message.includes("manifest"))).toBe(true);
    await writeManifest(root, record("corrected only on disk"));
    await expect(backend.search("retry", 1, authority)).rejects.toThrow("manifest");
    expect(factoryCalls).toBe(0);
    await backend.close();
    authority.close();
  });

  test("keeps the prior manifest published when reindex embedding fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-failed-reindex-test-"));
    roots.push(root);
    const original = record("Ada Lovelace");
    const updated = record("Augusta Ada King");
    const authority = new OhSqliteStore({ path: ":memory:" });
    commit(authority, original, "op_failed_reindex");
    let embedCalls = 0;
    let searchResult = qmdVectorResult(original);
    const backend = new OhQmdSemanticBackendV1({
      cacheDirectory: root,
      storeFactory: async () => ({
        close: async () => {},
        embed: async () => {
          embedCalls += 1;
          if (embedCalls === 2) throw new Error("synthetic embed failure");
        },
        searchVector: async () => [searchResult],
        update: async () => ({}),
      }),
    });
    await backend.index([original]);
    const published = await readFile(join(root, "manifest.json"), "utf8");
    searchResult = qmdVectorResult(updated);
    await expect(backend.index([updated])).rejects.toThrow("synthetic embed failure");
    expect(await readFile(join(root, "manifest.json"), "utf8")).toBe(published);
    expect(await backend.search("stale score", 1, authority)).toEqual([]);
    searchResult = qmdVectorResult(original);
    expect((await backend.search("prior snapshot", 1, authority))[0]?.recordSha256)
      .toBe(original.recordSha256);
    await backend.close();
    authority.close();
  });

  test("uses one manifest snapshot across a search and concurrent successful reindex", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-search-reindex-race-test-"));
    roots.push(root);
    const original = record("Ada Lovelace");
    const updated = record("Augusta Ada King");
    const authority = new OhSqliteStore({ path: ":memory:" });
    commit(authority, original, "op_race_original");
    const entered = deferred<void>();
    const release = deferred<void>();
    let blockSearch = false;
    let searchResult = qmdVectorResult(original);
    const backend = new OhQmdSemanticBackendV1({
      cacheDirectory: root,
      storeFactory: async () => ({
        close: async () => {},
        embed: async () => ({}),
        searchVector: async () => {
          const captured = searchResult;
          if (blockSearch) {
            entered.resolve();
            await release.promise;
            blockSearch = false;
          }
          return [captured];
        },
        update: async () => ({}),
      }),
    });
    await backend.index([original]);
    blockSearch = true;
    const oldSearch = backend.search("old snapshot", 1, authority);
    await entered.promise;
    await backend.index([updated]);
    release.resolve();
    expect((await oldSearch)[0]?.recordSha256).toBe(original.recordSha256);

    commit(authority, updated, "op_race_updated");
    searchResult = qmdVectorResult(original);
    expect(await backend.search("stale body", 1, authority)).toEqual([]);
    searchResult = qmdVectorResult(updated);
    expect((await backend.search("current body", 1, authority))[0]?.recordSha256)
      .toBe(updated.recordSha256);
    await backend.close();
    authority.close();
  });

  test("serializes concurrent index publications", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-serialized-index-test-"));
    roots.push(root);
    const first = record("First edition");
    const second = record("Second edition");
    const firstUpdate = deferred<void>();
    const releaseFirst = deferred<void>();
    let updateCalls = 0;
    const backend = new OhQmdSemanticBackendV1({
      cacheDirectory: root,
      storeFactory: async () => ({
        close: async () => {},
        embed: async () => ({}),
        searchVector: async () => [],
        update: async () => {
          updateCalls += 1;
          if (updateCalls === 1) {
            firstUpdate.resolve();
            await releaseFirst.promise;
          }
        },
      }),
    });
    const firstIndex = backend.index([first]);
    await firstUpdate.promise;
    const secondIndex = backend.index([second]);
    await Promise.resolve();
    expect(updateCalls).toBe(1);
    releaseFirst.resolve();
    await Promise.all([firstIndex, secondIndex]);
    expect(updateCalls).toBe(2);
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as {
      entries: Record<string, { recordSha256: string }>;
    };
    expect(manifest.entries[`${sha256Hex(second.key)}.md`]?.recordSha256).toBe(second.recordSha256);
    await backend.close();
  });

  test("rejoins hits to the exact authoritative record digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-semantic-test-"));
    roots.push(root);
    const key = "entity:ada";
    const original = record("Ada Lovelace");
    let closed = false;
    const openings: Parameters<QmdStoreFactoryV1>[0][] = [];
    const factory: QmdStoreFactoryV1 = async (options) => {
      openings.push(options);
      return {
      close: async () => { closed = true; },
      embed: async () => ({}),
      searchVector: async () => [qmdVectorResult(original)],
      update: async () => ({}),
      };
    };
    const authority = new OhSqliteStore({ path: ":memory:" });
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
    const original = record("Ada Lovelace");
    const openings: Parameters<QmdStoreFactoryV1>[0][] = [];
    const factory: QmdStoreFactoryV1 = async (options) => {
      openings.push(options);
      return {
        close: async () => {},
        embed: async () => ({}),
        searchVector: async () => [
          qmdVectorResult(original, { filepath: `qmd://other/${sha256Hex("entity:ada")}.md`, score: 1 }),
          qmdVectorResult(original, { score: -0.1 }),
          qmdVectorResult(original, { score: 1.1 }),
          { file: `qmd://oh/${sha256Hex("entity:ada")}.md`, score: 0.7 },
          qmdVectorResult(original, { extension: "rejected", score: 0.75 }),
          qmdVectorResult(original, { displayPath: "oh/other.md", score: 0.76 }),
          qmdVectorResult(original, { score: 0.8 }),
        ],
        update: async () => ({}),
      };
    };
    const authority = new OhSqliteStore({ path: ":memory:" });
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
