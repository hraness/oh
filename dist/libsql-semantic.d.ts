import { type Sha256Hex } from "./canonical";
import { type OhCloudflareEmbeddingClientV1 } from "./cloudflare-embedding";
import type { OhLibSqlClientV1 } from "./libsql";
export declare const OH_LIBSQL_SEMANTIC_LIMITS_V1: Readonly<{
    chunksPerDocument: 64;
    chunksPerGeneration: 4096;
    documentsPerGeneration: 512;
    embeddingBatch: 16;
    searchLimit: 100;
    searchPage: 128;
}>;
export declare class OhLibSqlSemanticError extends Error {
    readonly code: "conflict" | "integrity" | "invalid-input" | "purged" | "schema-unavailable";
    constructor(code: OhLibSqlSemanticError["code"], message: string);
}
export type OhSemanticAuthorityRefV1 = Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    generation: number;
    records: readonly Readonly<{
        key: string;
        recordSha256: Sha256Hex;
    }>[];
    v: 1;
}>;
export type OhSemanticDocumentV1 = Readonly<{
    content: string;
    key: string;
    recordSha256: Sha256Hex;
    title: string;
    v: 1;
}>;
export type OhSemanticStageResultV1 = Readonly<{
    authorityId: string;
    chunks: number;
    documents: number;
    embedded: number;
    generation: number;
    generationSha256: Sha256Hex;
    membershipSha256: Sha256Hex;
    reused: number;
    status: "staged";
    v: 1;
}>;
export type OhSemanticPublishResultV1 = Readonly<{
    authorityId: string;
    generation: number;
    generationSha256: Sha256Hex;
    published: boolean;
    v: 1;
}>;
export type OhSemanticSearchResultV1 = Readonly<{
    chunkOrdinal: number;
    key: string;
    recordSha256: Sha256Hex;
    score: number;
    v: 1;
}>;
export type OhSemanticPurgeResultV1 = Readonly<{
    authorityId: string;
    generations: number;
    memberships: number;
    orphanVectors: number;
    purgedAt: string;
    v: 1;
}>;
export declare function bootstrapOhLibSqlSemanticCacheV1(client: OhLibSqlClientV1, options?: Readonly<{
    appliedAt?: string;
}>): Promise<Readonly<{
    schemaSha256: Sha256Hex;
    schemaVersion: 1;
    v: 1;
}>>;
export declare class OhLibSqlSemanticCacheV1 {
    #private;
    private constructor();
    /** @internal Public callers should use `openOhLibSqlSemanticCacheV1`. */
    static open(client: OhLibSqlClientV1, closeClient: boolean): Promise<OhLibSqlSemanticCacheV1>;
    close(): Promise<void>;
    stage(input: Readonly<{
        authorityId: string;
        authoritySha256: Sha256Hex;
        createdAt?: string;
        documents: readonly OhSemanticDocumentV1[];
        embeddingClient: OhCloudflareEmbeddingClientV1;
        generation: number;
        maximumChunksPerDocument?: number;
        signal?: AbortSignal;
    }>): Promise<OhSemanticStageResultV1>;
    publish(input: Readonly<{
        authorityId: string;
        expectedPublishedGeneration: number | null;
        generation: number;
        publishedAt?: string;
    }>): Promise<OhSemanticPublishResultV1>;
    search(input: Readonly<{
        authority: OhSemanticAuthorityRefV1;
        embeddingClient: OhCloudflareEmbeddingClientV1;
        limit?: number;
        query: string;
        signal?: AbortSignal;
    }>): Promise<readonly OhSemanticSearchResultV1[]>;
    purgeAuthority(input: Readonly<{
        authorityId: string;
        purgedAt?: string;
    }>): Promise<OhSemanticPurgeResultV1>;
}
export declare function openOhLibSqlSemanticCacheV1(client: OhLibSqlClientV1, options?: Readonly<{
    closeClient?: boolean;
}>): Promise<OhLibSqlSemanticCacheV1>;
//# sourceMappingURL=libsql-semantic.d.ts.map