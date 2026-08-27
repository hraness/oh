import { type Sha256Hex } from "./canonical";
import type { KnowledgeGraphRecordV1 } from "./graph";
import type { OhSqliteStore } from "./sqlite/store";
export declare const OH_EMBEDDING_PROFILE_V1: Readonly<{
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
export type OhEmbeddingProfileV1 = typeof OH_EMBEDDING_PROFILE_V1;
export declare function formatOhEmbeddingQueryV1(query: string): string;
export declare function formatOhEmbeddingDocumentV1(title: string, content: string): string;
export declare function normalizeOhEmbeddingV1(vector: readonly number[]): readonly number[];
export declare function cosineSimilarityV1(left: readonly number[], right: readonly number[]): number;
export type OhSemanticSearchResultV1 = Readonly<{
    key: string;
    recordSha256: Sha256Hex;
    score: number;
    v: 1;
}>;
export interface OhSemanticSearchBackendV1 {
    readonly profile: OhEmbeddingProfileV1;
    close(): Promise<void>;
    index(records: readonly KnowledgeGraphRecordV1[]): Promise<Readonly<{
        indexed: number;
        v: 1;
    }>>;
    search(query: string, limit: number, authority: OhSqliteStore): Promise<readonly OhSemanticSearchResultV1[]>;
}
type QmdSearchResult = Readonly<{
    file: string;
    score: number;
}>;
type QmdStore = {
    close(): Promise<void>;
    embed(options: Readonly<{
        collection: string;
        model: string;
    }>): Promise<unknown>;
    searchVector(query: string, options: Readonly<{
        collection: string;
        limit: number;
    }>): Promise<readonly QmdSearchResult[]>;
    update(options: Readonly<{
        collections: readonly string[];
    }>): Promise<unknown>;
};
export type QmdStoreFactoryV1 = (options: Readonly<{
    config: Readonly<Record<string, unknown>>;
    dbPath: string;
}>) => Promise<QmdStore>;
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
    index(records: readonly KnowledgeGraphRecordV1[]): Promise<Readonly<{
        indexed: number;
        v: 1;
    }>>;
    search(query: string, limit: number, authority: OhSqliteStore): Promise<readonly OhSemanticSearchResultV1[]>;
    close(): Promise<void>;
}
export {};
//# sourceMappingURL=semantic.d.ts.map