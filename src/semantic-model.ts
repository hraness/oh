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
  const scale = vector.reduce((maximum, component) => Math.max(maximum, Math.abs(component)), 0);
  if (scale === 0) throw new TypeError("Embedding vectors must have nonzero magnitude.");
  const scaledMagnitude = Math.sqrt(vector.reduce((sum, component) => {
    const scaled = component / scale;
    return sum + scaled * scaled;
  }, 0));
  if (!Number.isFinite(scaledMagnitude) || scaledMagnitude === 0) {
    throw new TypeError("Embedding vectors must have finite nonzero magnitude.");
  }
  const normalized = vector.map((component) => (component / scale) / scaledMagnitude);
  if (normalized.some((component) => !Number.isFinite(component))) {
    throw new TypeError("Embedding vectors must normalize to finite values.");
  }
  return normalized;
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

export type QmdStore = {
  close(): Promise<void>;
  embed(options: Readonly<{ collection: string; model: string }>): Promise<unknown>;
  searchVector(query: string, options: Readonly<{ collection: string; limit: number }>): Promise<unknown>;
  update(options: Readonly<{ collections: readonly string[] }>): Promise<unknown>;
};
export type QmdStoreFactoryV1 = (options: Readonly<{
  config: Readonly<Record<string, unknown>>;
  dbPath: string;
}>) => Promise<QmdStore>;

export type SemanticManifestV1 = Readonly<{
  entries: Readonly<Record<string, Readonly<{ key: string; recordSha256: Sha256Hex }>>>;
  profileSha256: Sha256Hex;
  v: 1;
}>;

export function recordDocument(record: KnowledgeGraphRecordV1): string {
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

export function semanticManifest(entries: Record<string, { key: string; recordSha256: Sha256Hex }>): SemanticManifestV1 {
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

export function parseQmdVectorResults(value: unknown): readonly ParsedQmdVectorResult[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("QMD returned an invalid vector result batch.");
  }
  return value.map(parseQmdVectorResult)
    .filter((result): result is ParsedQmdVectorResult => result !== null);
}

