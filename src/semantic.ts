import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex,
  safeCode, sha256Hex, type Sha256Hex } from "./canonical";
import type { KnowledgeGraphRecordV1 } from "./graph";
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

type QmdSearchResult = Readonly<{ file: string; score: number }>;
type QmdStore = {
  close(): Promise<void>;
  embed(options: Readonly<{ collection: string; model: string }>): Promise<unknown>;
  searchVector(query: string, options: Readonly<{ collection: string; limit: number }>): Promise<readonly QmdSearchResult[]>;
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

function qmdResultFilename(file: unknown): string | null {
  if (typeof file !== "string") return null;
  if (file.startsWith("qmd://")) {
    let url: URL;
    try { url = new URL(file); } catch { return null; }
    if (url.protocol !== "qmd:" || url.hostname !== "oh" || url.search !== "" || url.hash !== "") return null;
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { return null; }
    if (!/^\/[a-f0-9]{64}\.md$/u.test(path)) return null;
    return path.slice(1);
  }
  const filename = basename(file);
  return /^[a-f0-9]{64}\.md$/u.test(filename) ? filename : null;
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
  #manifest: SemanticManifestV1 = { entries: {}, profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1), v: 1 };
  #manifestLoaded = false;
  #store: Promise<QmdStore> | null = null;
  #closed = false;

  constructor(options: Readonly<{ cacheDirectory: string; databasePath?: string; storeFactory?: QmdStoreFactoryV1 }>) {
    this.#cacheDirectory = resolve(options.cacheDirectory);
    this.#databasePath = resolve(options.databasePath ?? join(this.#cacheDirectory, "qmd.sqlite"));
    this.#factory = options.storeFactory ?? defaultQmdStoreFactory;
  }

  async #open(): Promise<QmdStore> {
    if (this.#closed) throw new Error("The semantic backend is closed.");
    const documents = join(this.#cacheDirectory, "documents");
    await mkdir(documents, { recursive: true });
    await this.#loadManifest();
    this.#store ??= this.#factory({
      dbPath: this.#databasePath,
      config: {
        collections: { oh: { path: documents, pattern: "*.md" } },
        models: { embed: OH_EMBEDDING_PROFILE_V1.model },
      },
    });
    return this.#store;
  }

  async #loadManifest(): Promise<void> {
    if (this.#manifestLoaded) return;
    this.#manifestLoaded = true;
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
    this.#manifest = { entries, profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1), v: 1 };
  }

  async index(records: readonly KnowledgeGraphRecordV1[]): Promise<Readonly<{ indexed: number; v: 1 }>> {
    if (records.length > 65_536) throw new RangeError("A semantic snapshot may contain at most 65,536 records.");
    const documents = join(this.#cacheDirectory, "documents");
    await mkdir(documents, { recursive: true });
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
    this.#manifest = { entries, profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1), v: 1 };
    this.#manifestLoaded = true;
    const manifestPath = join(this.#cacheDirectory, "manifest.json");
    const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
    await writeFile(temporaryManifest, canonicalJson(this.#manifest), { encoding: "utf8", mode: 0o600 });
    await rename(temporaryManifest, manifestPath);
    const store = await this.#open();
    await store.update({ collections: ["oh"] });
    await store.embed({ collection: "oh", model: OH_EMBEDDING_PROFILE_V1.model });
    return { indexed: records.length, v: 1 };
  }

  async search(query: string, limit: number, authority: OhSqliteStore): Promise<readonly OhSemanticSearchResultV1[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Semantic limit must be 1 through 100.");
    const store = await this.#open();
    const results = await store.searchVector(query, { collection: "oh", limit: Math.min(100, limit * 3) });
    const output: OhSemanticSearchResultV1[] = [];
    const seen = new Set<string>();
    for (const result of results) {
      const filename = qmdResultFilename(result.file);
      if (filename === null) continue;
      const entry = this.#manifest.entries[filename];
      if (entry === undefined || seen.has(entry.key) || !Number.isFinite(result.score)
        || result.score < 0 || result.score > 1) continue;
      const current = authority.get(entry.key);
      if (current === null || current.recordSha256 !== entry.recordSha256) continue;
      seen.add(entry.key);
      output.push({ key: entry.key, recordSha256: entry.recordSha256, score: result.score, v: 1 });
      if (output.length === limit) break;
    }
    return output;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#store !== null) await (await this.#store).close();
  }
}
