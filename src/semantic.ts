import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex,
  safeCode, sha256Hex, type Sha256Hex } from "./canonical";
import { OH_GRAPH_LIMITS_V1, type KnowledgeGraphRecordV1 } from "./graph";
import type { OhSqliteStore } from "./sqlite/store";

export const OH_EMBEDDING_PROFILE_V1 = Object.freeze({
  dimensions: 768,
  distance: "cosine",
  documentation: "https://ai.google.dev/gemma/docs/embeddinggemma",
  documentFormat: "title: {title} | text: {content}",
  engine: "@tobilu/qmd@2.5.3",
  model: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
  normalization: "l2",
  queryFormat: "task: search result | query: {query}",
  v: 1,
} as const);

export type OhEmbeddingProfileV1 = typeof OH_EMBEDDING_PROFILE_V1;

export function formatOhEmbeddingQueryV1(query: string): string {
  return `task: search result | query: ${query}`;
}

export function formatOhEmbeddingDocumentV1(title: string, content: string): string {
  return `title: ${title} | text: ${content}`;
}

export function normalizeOhEmbeddingV1(vector: readonly number[]): readonly number[] {
  if (vector.length !== OH_EMBEDDING_PROFILE_V1.dimensions
    || vector.some((component) => !Number.isFinite(component))) {
    throw new TypeError(`Embedding vectors must contain ${OH_EMBEDDING_PROFILE_V1.dimensions} finite values.`);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, component) => sum + component * component, 0));
  if (magnitude === 0) throw new TypeError("Embedding vectors must have nonzero magnitude.");
  return vector.map((component) => component / magnitude);
}

export function cosineSimilarityV1(left: readonly number[], right: readonly number[]): number {
  const normalizedLeft = normalizeOhEmbeddingV1(left);
  const normalizedRight = normalizeOhEmbeddingV1(right);
  return normalizedLeft.reduce((sum, component, index) => sum + component * (normalizedRight[index] as number), 0);
}

export type OhSemanticSearchResultV1 = Readonly<{
  key: string;
  recordSha256: Sha256Hex;
  score: number;
  v: 1;
}>;

export interface OhSemanticSearchBackendV1 {
  readonly profile: OhEmbeddingProfileV1;
  close(): Promise<void>;
  index(records: readonly KnowledgeGraphRecordV1[]): Promise<Readonly<{ indexed: number; v: 1 }>>;
  search(query: string, limit: number, authority: OhSqliteStore): Promise<readonly OhSemanticSearchResultV1[]>;
}

type QmdStore = {
  close(): Promise<void>;
  embed(options: Readonly<{ collection: string; model: string }>): Promise<unknown>;
  searchVector(query: string, options: Readonly<{ collection: string; limit: number }>): Promise<unknown>;
  update(options: Readonly<{ collections: readonly string[] }>): Promise<unknown>;
};
export type QmdStoreFactoryV1 = (options: Readonly<{
  config: Readonly<Record<string, unknown>>;
  dbPath: string;
}>) => Promise<QmdStore>;

const qmdModuleSpecifier: string = "@tobilu/qmd";
async function defaultQmdStoreFactory(options: Parameters<QmdStoreFactoryV1>[0]): Promise<QmdStore> {
  let module: unknown;
  try { module = await import(qmdModuleSpecifier); } catch {
    throw new Error("Semantic search needs the optional @tobilu/qmd@2.5.3 package.");
  }
  const createStore = (module as { createStore?: unknown }).createStore;
  if (typeof createStore !== "function") throw new Error("The installed QMD package has no compatible createStore export.");
  return await (createStore as QmdStoreFactoryV1)(options);
}

type SemanticManifestV1 = Readonly<{
  entries: Readonly<Record<string, Readonly<{ key: string; recordSha256: Sha256Hex }>>>;
  profileSha256: Sha256Hex;
  v: 1;
}>;

function recordDocument(record: KnowledgeGraphRecordV1): string {
  return `# ${record.key}\n\nkind: ${record.kind}\n\n${canonicalJson(record.value)}\n`;
}

const QMD_VECTOR_RESULT_KEYS = [
  "body", "bodyLength", "chunkPos", "collectionName", "context", "displayPath", "docid",
  "filepath", "hash", "modifiedAt", "score", "source", "title",
] as const;
type ParsedQmdVectorResult = Readonly<{
  body: string;
  filename: string;
  hash: Sha256Hex;
  score: number;
  title: string;
}>;

function semanticManifest(entries: Record<string, { key: string; recordSha256: Sha256Hex }>): SemanticManifestV1 {
  const immutableEntries: Record<string, Readonly<{ key: string; recordSha256: Sha256Hex }>> = {};
  for (const [filename, entry] of Object.entries(entries)) {
    immutableEntries[filename] = Object.freeze({ ...entry });
  }
  return Object.freeze({
    entries: Object.freeze(immutableEntries),
    profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1),
    v: 1,
  });
}

function parseQmdVectorResult(value: unknown): ParsedQmdVectorResult | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, QMD_VECTOR_RESULT_KEYS)) return null;
  const pathMatch = typeof value.filepath === "string"
    ? /^qmd:\/\/oh\/([a-f0-9]{64}\.md)$/u.exec(value.filepath)
    : null;
  const filename = pathMatch?.[1];
  const hash = parseSha256Hex(value.hash);
  const title = safeCode(value.title, 512);
  if (filename === undefined || value.displayPath !== `oh/${filename}` || value.collectionName !== "oh"
    || value.source !== "vec" || value.context !== null || value.modifiedAt !== ""
    || hash === null || value.docid !== hash.slice(0, 6) || title === null
    || typeof value.body !== "string" || typeof value.bodyLength !== "number" || !Number.isSafeInteger(value.bodyLength)
    || value.bodyLength < 0 || value.bodyLength > OH_GRAPH_LIMITS_V1.recordBytes + 4096
    || value.body.length !== value.bodyLength || hash !== sha256Hex(value.body) || typeof value.chunkPos !== "number"
    || !Number.isSafeInteger(value.chunkPos) || value.chunkPos < 0
    || typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) {
    return null;
  }
  return { body: value.body, filename, hash, score: value.score, title };
}

function parseQmdVectorResults(value: unknown): readonly ParsedQmdVectorResult[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("QMD returned an invalid vector result batch.");
  }
  return value.map(parseQmdVectorResult)
    .filter((result): result is ParsedQmdVectorResult => result !== null);
}

/**
 * Optional, rebuildable local QMD index. SQLite records remain authoritative;
 * every returned hit is rejoined to its exact current record digest.
 */
export class OhQmdSemanticBackendV1 implements OhSemanticSearchBackendV1 {
  readonly profile = OH_EMBEDDING_PROFILE_V1;
  readonly #cacheDirectory: string;
  readonly #databasePath: string;
  readonly #factory: QmdStoreFactoryV1;
  #manifest: SemanticManifestV1 = semanticManifest({});
  #manifestLoad: Promise<void> | null = null;
  #store: Promise<QmdStore> | null = null;
  #storeClose: Promise<void> | null = null;
  #closure: Promise<void> | null = null;
  #indexQueue: Promise<void> = Promise.resolve();
  readonly #activeSearches = new Set<Promise<unknown>>();
  #closed = false;

  constructor(options: Readonly<{ cacheDirectory: string; databasePath?: string; storeFactory?: QmdStoreFactoryV1 }>) {
    this.#cacheDirectory = resolve(options.cacheDirectory);
    this.#databasePath = resolve(options.databasePath ?? join(this.#cacheDirectory, "qmd.sqlite"));
    this.#factory = options.storeFactory ?? defaultQmdStoreFactory;
  }

  async #open(): Promise<QmdStore> {
    if (this.#closed) throw new Error("The semantic backend is closed.");
    this.#store ??= this.#initializeStore();
    const store = await this.#store;
    if (this.#closed) {
      await this.#closeStore(store);
      throw new Error("The semantic backend is closed.");
    }
    return store;
  }

  async #initializeStore(): Promise<QmdStore> {
    const documents = join(this.#cacheDirectory, "documents");
    await mkdir(documents, { recursive: true });
    await this.#loadManifest();
    if (this.#closed) throw new Error("The semantic backend is closed.");
    const store = await this.#factory({
      dbPath: this.#databasePath,
      config: {
        collections: { oh: { path: documents, pattern: "*.md" } },
        models: { embed: OH_EMBEDDING_PROFILE_V1.model },
      },
    });
    if (this.#closed) {
      await this.#closeStore(store);
      throw new Error("The semantic backend is closed.");
    }
    return store;
  }

  #closeStore(store: QmdStore): Promise<void> {
    this.#storeClose ??= Promise.resolve().then(() => store.close());
    return this.#storeClose;
  }

  #loadManifest(): Promise<void> {
    this.#manifestLoad ??= this.#readManifest();
    return this.#manifestLoad;
  }

  async #readManifest(): Promise<void> {
    let text: string;
    try { text = await readFile(join(this.#cacheDirectory, "manifest.json"), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error("The semantic manifest is not JSON."); }
    if (canonicalJson(value) !== text || !isPlainRecord(value)
      || !hasExactKeys(value, ["entries", "profileSha256", "v"]) || value.v !== 1
      || value.profileSha256 !== canonicalSha256(OH_EMBEDDING_PROFILE_V1) || !isPlainRecord(value.entries)
      || Object.keys(value.entries).length > 65_536) throw new Error("The semantic manifest is incompatible or invalid.");
    const entries: Record<string, { key: string; recordSha256: Sha256Hex }> = {};
    for (const [filename, candidate] of Object.entries(value.entries)) {
      if (!/^[a-f0-9]{64}\.md$/u.test(filename) || !isPlainRecord(candidate)
        || !hasExactKeys(candidate, ["key", "recordSha256"])) throw new Error("The semantic manifest has an invalid entry.");
      const key = safeCode(candidate.key, 512);
      const recordSha256 = parseSha256Hex(candidate.recordSha256);
      if (key === null || recordSha256 === null || filename !== `${sha256Hex(key)}.md`) {
        throw new Error("The semantic manifest entry identity is invalid.");
      }
      entries[filename] = { key, recordSha256 };
    }
    this.#manifest = semanticManifest(entries);
  }

  index(records: readonly KnowledgeGraphRecordV1[]): Promise<Readonly<{ indexed: number; v: 1 }>> {
    if (records.length > 65_536) {
      return Promise.reject(new RangeError("A semantic snapshot may contain at most 65,536 records."));
    }
    if (this.#closed) return Promise.reject(new Error("The semantic backend is closed."));
    const snapshot = [...records];
    const operation = this.#indexQueue.then(() => this.#indexSnapshot(snapshot));
    this.#indexQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #indexSnapshot(records: readonly KnowledgeGraphRecordV1[]): Promise<Readonly<{ indexed: number; v: 1 }>> {
    if (this.#closed) throw new Error("The semantic backend is closed.");
    const documents = join(this.#cacheDirectory, "documents");
    await mkdir(documents, { recursive: true });
    await this.#loadManifest();
    const entries: Record<string, { key: string; recordSha256: Sha256Hex }> = {};
    for (const record of records) {
      const filename = `${sha256Hex(record.key)}.md`;
      entries[filename] = { key: record.key, recordSha256: record.recordSha256 };
      const path = join(documents, filename);
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, recordDocument(record), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, path);
    }
    const retained = new Set(Object.keys(entries));
    for (const filename of await readdir(documents)) {
      if (/^[a-f0-9]{64}\.md$/u.test(filename) && !retained.has(filename)) await unlink(join(documents, filename));
    }
    const nextManifest = semanticManifest(entries);
    const store = await this.#open();
    await store.update({ collections: ["oh"] });
    await store.embed({ collection: "oh", model: OH_EMBEDDING_PROFILE_V1.model });
    const manifestPath = join(this.#cacheDirectory, "manifest.json");
    const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
    await writeFile(temporaryManifest, canonicalJson(nextManifest), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryManifest, manifestPath);
    this.#manifest = nextManifest;
    return { indexed: records.length, v: 1 };
  }

  search(query: string, limit: number, authority: OhSqliteStore): Promise<readonly OhSemanticSearchResultV1[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return Promise.reject(new RangeError("Semantic limit must be 1 through 100."));
    }
    if (this.#closed) return Promise.reject(new Error("The semantic backend is closed."));
    const operation = this.#searchSnapshot(query, limit, authority);
    this.#activeSearches.add(operation);
    void operation.then(
      () => { this.#activeSearches.delete(operation); },
      () => { this.#activeSearches.delete(operation); },
    );
    return operation;
  }

  async #searchSnapshot(query: string, limit: number,
    authority: OhSqliteStore): Promise<readonly OhSemanticSearchResultV1[]> {
    const store = await this.#open();
    const manifest = this.#manifest;
    const results = parseQmdVectorResults(await store.searchVector(query,
      { collection: "oh", limit: Math.min(100, limit * 3) }));
    const output: OhSemanticSearchResultV1[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      const entry = manifest.entries[result.filename];
      if (entry === undefined || result.title !== entry.key || seen.has(entry.key)) continue;
      const current = authority.get(entry.key);
      if (current === null || current.recordSha256 !== entry.recordSha256) continue;
      const expectedDocument = recordDocument(current);
      if (result.body !== expectedDocument || result.hash !== sha256Hex(expectedDocument)) continue;
      seen.add(entry.key);
      output.push({ key: entry.key, recordSha256: entry.recordSha256, score: result.score, v: 1 });
      if (output.length === limit) break;
    }
    return output;
  }

  async #finishClose(): Promise<void> {
    await this.#indexQueue;
    await Promise.allSettled([...this.#activeSearches]);
    if (this.#store === null) return;
    try {
      const store = await this.#store;
      await this.#closeStore(store);
    } catch {
      // Initialization failures are not close failures. A close initiated by
      // late initialization is shared separately and must still be observed.
      if (this.#storeClose !== null) await this.#storeClose;
    }
  }

  close(): Promise<void> {
    this.#closed = true;
    this.#closure ??= this.#finishClose();
    return this.#closure;
  }
}
