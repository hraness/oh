import { hasExactKeys, isPlainRecord, parseSha256Hex, safeCode, type Sha256Hex } from "./canonical";
import type { KnowledgeGraphRecordV1 } from "./graph";
import { normalizeOhRerankLexicalQueryV1, OH_RERANK_LIMITS_V1, parseOhRerankDocumentsV1,
  parseOhRerankQueryV1, parseOhRerankResultsV1, type OhRerankBackendV1 } from "./rerank-model";
import type { OhSemanticSearchBackend, OhSemanticSearchResultV1 } from "./semantic";
import { recordDocument } from "./semantic-model";
import type { OhSqliteStore } from "./sqlite/store";

export type OhSearchModeV1 = "hybrid" | "keyword" | "rerank" | "semantic";
export type OhSearchDiagnosticV1 = Readonly<{
  code: "rerank-unavailable" | "semantic-unavailable";
  message: string;
  v: 1;
}>;
export type OhSearchResultV1 = Readonly<{
  evidence: readonly Readonly<{ lane: "keyword" | "semantic"; rank: number; score: number; v: 1 }>[];
  record: KnowledgeGraphRecordV1;
  score: number;
  v: 1;
}>;
export type OhSearchResponseV1 = Readonly<{
  diagnostics: readonly OhSearchDiagnosticV1[];
  mode: OhSearchModeV1;
  results: readonly OhSearchResultV1[];
  v: 1;
}>;

/** Select only capabilities supplied by the caller; selection never acquires a backend. */
export function resolveOhSearchModeV1(input: Readonly<{ backend?: OhSemanticSearchBackend;
  mode?: OhSearchModeV1; reranker?: OhRerankBackendV1 }>): OhSearchModeV1 {
  const mode = input.mode === undefined
    ? input.reranker !== undefined ? "rerank" : input.backend !== undefined ? "hybrid" : "keyword"
    : input.mode;
  if (mode !== "keyword" && mode !== "semantic" && mode !== "hybrid" && mode !== "rerank") {
    throw new TypeError("Search mode must be keyword, semantic, hybrid, or rerank.");
  }
  return mode;
}

function compareKeys(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function semanticResults(value: unknown, limit: number): readonly OhSemanticSearchResultV1[] {
  if (!Array.isArray(value) || value.length > limit) throw new TypeError("Semantic search exceeded its bounded result lane.");
  const seen = new Set<string>(), parsed: OhSemanticSearchResultV1[] = [];
  for (const row of value) {
    if (!isPlainRecord(row) || !hasExactKeys(row, ["key", "recordSha256", "score", "v"]) || row.v !== 1) {
      throw new TypeError("Semantic search returned an invalid V1 result.");
    }
    const key = safeCode(row.key, 512), digest = parseSha256Hex(row.recordSha256);
    if (key === null || digest === null || seen.has(key) || typeof row.score !== "number" || !Number.isFinite(row.score)) {
      throw new TypeError("Semantic search returned an invalid identity or score.");
    }
    seen.add(key);
    parsed.push({ key, recordSha256: digest, score: row.score, v: 1 });
  }
  return parsed;
}

export async function searchOhV1(input: Readonly<{
  backend?: OhSemanticSearchBackend;
  limit?: number;
  mode?: OhSearchModeV1;
  query: string;
  reranker?: OhRerankBackendV1;
  rerankPoolSize?: number;
  store: OhSqliteStore;
}>): Promise<OhSearchResponseV1> {
  const limit = input.limit ?? 10;
  const mode = resolveOhSearchModeV1(input);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Search limit must be 1 through 100.");
  const poolSize = input.rerankPoolSize ?? OH_RERANK_LIMITS_V1.defaultPoolSize;
  if (!Number.isSafeInteger(poolSize) || poolSize < OH_RERANK_LIMITS_V1.minimumPoolSize
    || poolSize > OH_RERANK_LIMITS_V1.maximumPoolSize) {
    throw new RangeError("Rerank pool size must be 1 through 60.");
  }
  const rerank = mode === "rerank";
  if (rerank) parseOhRerankQueryV1(input.query);
  // In rerank mode the lexical lane mirrors the confirmed procedure: it searches
  // the normalized query while the semantic lane and the reranker keep the
  // original stem. Other modes keep their existing query routing unchanged.
  const laneSize = rerank ? poolSize : Math.min(100, limit * 3);
  const lexicalQuery = rerank ? normalizeOhRerankLexicalQueryV1(input.query) : input.query;
  const keyword = mode === "semantic" ? [] : input.store.searchKeyword(lexicalQuery, laneSize);
  let semantic: Awaited<ReturnType<OhSemanticSearchBackend["search"]>> = [];
  const diagnostics: OhSearchDiagnosticV1[] = [];
  if (mode !== "keyword") {
    if (input.backend === undefined) {
      diagnostics.push({ code: "semantic-unavailable", message: "No local semantic backend is configured.", v: 1 });
    } else {
      try { semantic = semanticResults(await input.backend.search(input.query, laneSize, input.store), laneSize); }
      catch (error) {
        diagnostics.push({ code: "semantic-unavailable",
          message: error instanceof Error ? error.message : "Local semantic search failed.", v: 1 });
      }
    }
  }
  const byKey = new Map<string, { evidence: OhSearchResultV1["evidence"][number][]; recordSha256: Sha256Hex; score: number }>();
  const add = (key: string, digest: Sha256Hex, lane: "keyword" | "semantic", rank: number, laneScore: number): void => {
    if (input.store.get(key)?.recordSha256 !== digest) return;
    const contribution = (lane === "keyword" ? 2 : 1) / (60 + rank);
    const current = byKey.get(key) ?? { evidence: [], recordSha256: digest, score: 0 };
    current.evidence.push({ lane, rank, score: laneScore, v: 1 });
    current.score += contribution;
    byKey.set(key, current);
  };
  keyword.forEach((result, index) => add(result.key, result.recordSha256, "keyword", index + 1, result.score));
  semantic.forEach((result, index) => add(result.key, result.recordSha256, "semantic", index + 1, result.score));
  if (rerank && input.reranker !== undefined && byKey.size > 0) {
    const pool = [...byKey.entries()].sort((left, right) => right[1].score - left[1].score || compareKeys(left[0], right[0]));
    const documents: { key: string; record: KnowledgeGraphRecordV1 }[] = [];
    for (const [key] of pool) {
      const record = input.store.get(key);
      if (record !== null && record.recordSha256 === byKey.get(key)!.recordSha256) documents.push({ key, record });
    }
    try {
      const submitted = parseOhRerankDocumentsV1(
        documents.map((document) => ({ key: document.key, text: recordDocument(document.record), v: 1 })));
      const keys = new Set(documents.map((document) => document.key));
      const scored = parseOhRerankResultsV1(submitted.length === 0 ? []
        : await input.reranker.rerank(input.query, submitted), keys);
      const ordered = [...scored].sort((left, right) => right.score - left.score || compareKeys(left.key, right.key));
      const order = new Map(ordered.map((result, index) => [result.key, { rank: index + 1, score: result.score }]));
      const ranked = documents
        .filter((document) => order.has(document.key))
        .sort((left, right) => order.get(left.key)!.rank - order.get(right.key)!.rank);
      const results: OhSearchResultV1[] = [];
      for (const document of ranked) {
        const current = input.store.get(document.key);
        if (current === null || current.recordSha256 !== document.record.recordSha256) continue;
        results.push({ evidence: byKey.get(document.key)!.evidence, record: current,
          score: order.get(document.key)!.score, v: 1 });
        if (results.length === limit) break;
      }
      return { diagnostics, mode, results, v: 1 };
    } catch (error) {
      diagnostics.push({ code: "rerank-unavailable",
        message: error instanceof Error ? error.message : "Local rerank failed.", v: 1 });
    }
  } else if (rerank && input.reranker === undefined) {
    diagnostics.push({ code: "rerank-unavailable", message: "No local rerank backend is configured.", v: 1 });
  }
  const results: OhSearchResultV1[] = [];
  for (const [key, rank] of [...byKey.entries()].sort((left, right) => right[1].score - left[1].score || compareKeys(left[0], right[0]))) {
    const record = input.store.get(key);
    if (record === null || record.recordSha256 !== rank.recordSha256) continue;
    results.push({ evidence: rank.evidence, record, score: rank.score, v: 1 });
    if (results.length === limit) break;
  }
  return { diagnostics, mode, results, v: 1 };
}
