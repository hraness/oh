import { isPlainRecord } from "./canonical";

/** Cross-encoder rerank profile for the optional local Qwen3 backend.
 * The procedure mirrors the frozen CloneMem confirmation arm
 * `oh-union-qwen3-rerank-v1`: the lexical lane receives the normalized query,
 * the semantic lane keeps the original stem, their bounded top-N results form
 * one union pool, and every candidate document is reranked against the
 * original query before the top results are returned. */
export const OH_RERANK_PROFILE_V1 = Object.freeze({
  contextSize: 4_096,
  engine: "@tobilu/qmd@2.5.3 LlamaCpp.rerank",
  language: "en",
  lexicalQuery: "normalized original query stem",
  model: "Qwen3-Reranker-0.6B Q8_0 GGUF",
  modelSha256: "22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48",
  modelRevision: "a02f48bb4f057028298c21fa033da2b30d7742d5",
  normalization: "NFC; en-US lowercase; token regex; first-occurrence deduplication; fixed stopword removal; first16",
  ranking: "score descending, then ASCII key ascending",
  semanticQuery: "unchanged original query stem",
  v: 1,
} as const);

export const OH_RERANK_LIMITS_V1 = Object.freeze({
  defaultPoolSize: 30,
  maximumDocumentBytes: 65_536,
  maximumDocuments: 128,
  maximumPoolSize: 60,
  maximumQueryBytes: 16_384,
  minimumPoolSize: 1,
} as const);

/** English stopwords frozen with the lexical normalization profile. */
export const OH_RERANK_STOPWORDS_V1 = Object.freeze(
  "a an and are as at be been being but by can could did do does doing for from had has have having he her hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves s t ve ll re d m don isn aren wasn weren".split(" "));

const stopwordSet = new Set<string>(OH_RERANK_STOPWORDS_V1);

/** Normalizes a query for the rerank pool's lexical lane. Does not stem words;
 * an empty content-term output is an empty lexical lane, never an error. */
export function normalizeOhRerankLexicalQueryV1(query: string): string {
  if (typeof query !== "string" || Buffer.byteLength(query) > OH_RERANK_LIMITS_V1.maximumQueryBytes
    || /\p{Surrogate}/u.test(query) || query.includes("\0")) {
    throw new TypeError("Rerank lexical query must be a bounded string.");
  }
  return [...new Set(query.normalize("NFC").toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}/gu) ?? [])]
    .filter((token) => !stopwordSet.has(token)).slice(0, 16).join(" ");
}

export type OhRerankDocumentV1 = Readonly<{ key: string; text: string; v: 1 }>;
export type OhRerankResultV1 = Readonly<{ key: string; score: number; v: 1 }>;

/** Optional local cross-encoder boundary. Implementations own their model
 * lifecycle; `rerank` returns one bounded score per submitted document and
 * `close` releases the model. Scores are engine-specific relevance values. */
export interface OhRerankBackendV1 {
  readonly profile: typeof OH_RERANK_PROFILE_V1;
  rerank(query: string, documents: readonly OhRerankDocumentV1[]): Promise<readonly OhRerankResultV1[]>;
  close(): Promise<void>;
}

export function parseOhRerankQueryV1(query: string): string {
  if (typeof query !== "string" || Buffer.byteLength(query) > OH_RERANK_LIMITS_V1.maximumQueryBytes
    || /\p{Surrogate}/u.test(query) || query.includes("\0") || query.trim().length === 0) {
    throw new TypeError("Rerank query must be a bounded nonempty string.");
  }
  return query;
}

export function parseOhRerankDocumentsV1(documents: readonly OhRerankDocumentV1[]): readonly OhRerankDocumentV1[] {
  if (!Array.isArray(documents) || documents.length > OH_RERANK_LIMITS_V1.maximumDocuments) {
    throw new TypeError("Rerank accepts at most 128 documents.");
  }
  const seen = new Set<string>();
  return documents.map((document) => {
    if (!isPlainRecord(document) || typeof document.key !== "string" || document.key.length === 0
      || document.key.length > 512 || typeof document.text !== "string"
      || Buffer.byteLength(document.text) > OH_RERANK_LIMITS_V1.maximumDocumentBytes
      || !seen.add(document.key)) throw new TypeError("Rerank document identity or byte bound failed.");
    return { key: document.key, text: document.text, v: 1 } as const;
  });
}

export function parseOhRerankResultsV1(results: readonly OhRerankResultV1[], keys: ReadonlySet<string>): readonly OhRerankResultV1[] {
  if (!Array.isArray(results) || results.length !== keys.size) throw new TypeError("Rerank must score every submitted document once.");
  const seen = new Set<string>();
  return results.map((result) => {
    if (!isPlainRecord(result) || typeof result.key !== "string" || !keys.has(result.key)
      || typeof result.score !== "number" || !Number.isFinite(result.score) || !seen.add(result.key)) {
      throw new TypeError("Rerank result coverage or score bound failed.");
    }
    return { key: result.key, score: result.score, v: 1 } as const;
  });
}
