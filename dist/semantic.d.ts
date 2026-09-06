import type { KnowledgeGraphRecordV1 } from "./graph";
import { type OhSemanticSearchBackendV1, type QmdStoreFactoryV1 } from "./semantic-model";
import type { OhSqliteStore } from "./sqlite/store";
export { OH_EMBEDDING_PROFILE_V1, cosineSimilarityV1, formatOhEmbeddingDocumentV1, formatOhEmbeddingQueryV1, normalizeOhEmbeddingV1 } from "./semantic-model";
export type { OhEmbeddingProfileV1, OhSemanticSearchBackendV1, OhSemanticSearchResultV1, QmdStoreFactoryV1 } from "./semantic-model";
/**
 * Optional, rebuildable local QMD index. SQLite records remain authoritative;
 * every returned hit is rejoined to its exact current record digest.
 */
export declare class OhQmdSemanticBackendV1 implements OhSemanticSearchBackendV1 {
    #private;
    readonly profile: Readonly<{
        readonly dimensions: 768;
        readonly distance: "cosine";
        readonly documentation: "https://ai.google.dev/gemma/docs/embeddinggemma";
        readonly documentFormat: "title: {title} | text: {content}";
        readonly engine: "@tobilu/qmd@2.5.3";
        readonly model: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
        readonly normalization: "l2";
        readonly queryFormat: "task: search result | query: {query}";
        readonly v: 1;
    }>;
    constructor(options: Readonly<{
        cacheDirectory: string;
        databasePath?: string;
        storeFactory?: QmdStoreFactoryV1;
    }>);
    index(records: readonly KnowledgeGraphRecordV1[]): ReturnType<OhSemanticSearchBackendV1["index"]>;
    search(query: string, limit: number, authority: OhSqliteStore): ReturnType<OhSemanticSearchBackendV1["search"]>;
    close(): Promise<void>;
}
//# sourceMappingURL=semantic.d.ts.map