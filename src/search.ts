import type { KnowledgeGraphRecordV1 } from "./graph";
import { normalizeOhRerankLexicalQueryV1, OH_RERANK_LIMITS_V1, type OhRerankBackendV1 } from "./rerank-model";
import type { OhSemanticSearchBackend } from "./semantic";
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
  const mode = input.mode ?? "keyword";
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Search limit must be 1 through 100.");
  const poolSize = input.rerankPoolSize ?? OH_RERANK_LIMITS_V1.defaultPoolSize;
  if (!Number.isSafeInteger(poolSize) || poolSize < OH_RERANK_LIMITS_V1.minimumPoolSize
    || poolSize > OH_RERANK_LIMITS_V1.maximumPoolSize) {
    throw new RangeError("Rerank pool size must be 1 through 60.");
  }
  const rerank = mode === "rerank";
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
      try { semantic = await input.backend.search(input.query, laneSize, input.store); }
      catch (error) {
        diagnostics.push({ code: "semantic-unavailable",
          message: error instanceof Error ? error.message : "Local semantic search failed.", v: 1 });
      }
    }
  }
  const byKey = new Map<string, { evidence: OhSearchResultV1["evidence"][number][]; score: number }>();
  const add = (key: string, lane: "keyword" | "semantic", rank: number, laneScore: number): void => {
    const contribution = (lane === "keyword" ? 2 : 1) / (60 + rank);
    const current = byKey.get(key) ?? { evidence: [], score: 0 };
    current.evidence.push({ lane, rank, score: laneScore, v: 1 });
    current.score += contribution;
    byKey.set(key, current);
  };
  keyword.forEach((result, index) => add(result.key, "keyword", index + 1, result.score));
  semantic.forEach((result, index) => add(result.key, "semantic", index + 1, result.score));
  if (rerank && input.reranker !== undefined && byKey.size > 0) {
    const pool = [...byKey.entries()].sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]));
    const documents: { key: string; record: KnowledgeGraphRecordV1; score: number }[] = [];
    for (const [key] of pool) {
      const record = input.store.get(key);
      if (record !== null) documents.push({ key, record, score: byKey.get(key)!.score });
    }
    try {
      const scored = await input.reranker.rerank(input.query,
        documents.map((document) => ({ key: document.key, text: recordDocument(document.record), v: 1 })));
      const keys = new Set(documents.map((document) => document.key));
      if (scored.length !== documents.length || scored.some((result) => !keys.has(result.key))) {
        throw new Error("The rerank backend did not score every candidate document.");
      }
      const ordered = [...scored].sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
      const order = new Map(ordered.map((result, index) => [result.key, { rank: index + 1, score: result.score }]));
      const ranked = documents
        .filter((document) => order.has(document.key))
        .sort((left, right) => order.get(left.key)!.rank - order.get(right.key)!.rank);
      const results: OhSearchResultV1[] = [];
      for (const document of ranked.slice(0, limit)) {
        results.push({ evidence: byKey.get(document.key)!.evidence, record: document.record,
          score: order.get(document.key)!.score, v: 1 });
      }
      return { diagnostics, mode, results, v: 1 };
    } catch (error) {
      diagnostics.push({ code: "rerank-unavailable",
        message: error instanceof Error ? error.message : "Local rerank failed.", v: 1 });
    }
  } else if (rerank) {
    diagnostics.push({ code: "rerank-unavailable", message: "No local rerank backend is configured.", v: 1 });
  }
  const results: OhSearchResultV1[] = [];
  for (const [key, rank] of [...byKey.entries()].sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))) {
    const record = input.store.get(key);
    if (record === null) continue;
    results.push({ evidence: rank.evidence, record, score: rank.score, v: 1 });
    if (results.length === limit) break;
  }
  return { diagnostics, mode, results, v: 1 };
}
