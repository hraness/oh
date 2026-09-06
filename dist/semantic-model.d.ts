import { type Sha256Hex } from "./canonical";
import { type KnowledgeGraphRecordV1 } from "./graph";
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
export type QmdStore = {
    close(): Promise<void>;
    embed(options: Readonly<{
        collection: string;
        model: string;
    }>): Promise<unknown>;
    searchVector(query: string, options: Readonly<{
        collection: string;
        limit: number;
    }>): Promise<unknown>;
    update(options: Readonly<{
        collections: readonly string[];
    }>): Promise<unknown>;
};
export type QmdStoreFactoryV1 = (options: Readonly<{
    config: Readonly<Record<string, unknown>>;
    dbPath: string;
}>) => Promise<QmdStore>;
export type SemanticManifestV1 = Readonly<{
    entries: Readonly<Record<string, Readonly<{
        key: string;
        recordSha256: Sha256Hex;
    }>>>;
    profileSha256: Sha256Hex;
    v: 1;
}>;
export declare function recordDocument(record: KnowledgeGraphRecordV1): string;
type ParsedQmdVectorResult = Readonly<{
    body: string;
    filename: string;
    hash: Sha256Hex;
    score: number;
    title: string;
}>;
export declare function semanticManifest(entries: Record<string, {
    key: string;
    recordSha256: Sha256Hex;
}>): SemanticManifestV1;
export declare function parseQmdVectorResults(value: unknown): readonly ParsedQmdVectorResult[];
export {};
//# sourceMappingURL=semantic-model.d.ts.map