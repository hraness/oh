import type { KnowledgeGraphRecordV1 } from "./graph";
import { type OhRerankBackendV1 } from "./rerank-model";
import type { OhSemanticSearchBackend } from "./semantic";
import type { OhSqliteStore } from "./sqlite/store";
export type OhSearchModeV1 = "hybrid" | "keyword" | "rerank" | "semantic";
export type OhSearchDiagnosticV1 = Readonly<{
    code: "rerank-unavailable" | "semantic-unavailable";
    message: string;
    v: 1;
}>;
export type OhSearchResultV1 = Readonly<{
    evidence: readonly Readonly<{
        lane: "keyword" | "semantic";
        rank: number;
        score: number;
        v: 1;
    }>[];
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
export declare function resolveOhSearchModeV1(input: Readonly<{
    backend?: OhSemanticSearchBackend;
    mode?: OhSearchModeV1;
    reranker?: OhRerankBackendV1;
}>): OhSearchModeV1;
export declare function searchOhV1(input: Readonly<{
    backend?: OhSemanticSearchBackend;
    limit?: number;
    mode?: OhSearchModeV1;
    query: string;
    reranker?: OhRerankBackendV1;
    rerankPoolSize?: number;
    store: OhSqliteStore;
}>): Promise<OhSearchResponseV1>;
//# sourceMappingURL=search.d.ts.map