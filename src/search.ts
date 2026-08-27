import type { KnowledgeGraphRecordV1 } from "./graph";
import type { OhSemanticSearchBackendV1 } from "./semantic";
import type { OhSqliteStore } from "./sqlite/store";

export type OhSearchModeV1 = "hybrid" | "keyword" | "semantic";
export type OhSearchDiagnosticV1 = Readonly<{
  code: "semantic-unavailable";
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
  backend?: OhSemanticSearchBackendV1;
  limit?: number;
  mode?: OhSearchModeV1;
  query: string;
  store: OhSqliteStore;
}>): Promise<OhSearchResponseV1> {
  const limit = input.limit ?? 10;
  const mode = input.mode ?? "keyword";
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Search limit must be 1 through 100.");
  const keyword = mode === "semantic" ? [] : input.store.searchKeyword(input.query, Math.min(100, limit * 3));
  let semantic: Awaited<ReturnType<OhSemanticSearchBackendV1["search"]>> = [];
  const diagnostics: OhSearchDiagnosticV1[] = [];
  if (mode !== "keyword") {
    if (input.backend === undefined) {
      diagnostics.push({ code: "semantic-unavailable", message: "No local semantic backend is configured.", v: 1 });
    } else {
      try { semantic = await input.backend.search(input.query, Math.min(100, limit * 3), input.store); }
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
  const results: OhSearchResultV1[] = [];
  for (const [key, rank] of [...byKey.entries()].sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))) {
    const record = input.store.get(key);
    if (record === null) continue;
    results.push({ evidence: rank.evidence, record, score: rank.score, v: 1 });
    if (results.length === limit) break;
  }
  return { diagnostics, mode, results, v: 1 };
}
