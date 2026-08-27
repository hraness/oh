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
export declare function searchOhV1(input: Readonly<{
    backend?: OhSemanticSearchBackendV1;
    limit?: number;
    mode?: OhSearchModeV1;
    query: string;
    store: OhSqliteStore;
}>): Promise<OhSearchResponseV1>;
//# sourceMappingURL=search.d.ts.map