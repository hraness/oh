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
    /** Defaults to an authority-specific isolation when omitted. */
    isolationSha256?: Sha256Hex;
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
    isolationSha256: Sha256Hex;
    membershipSha256: Sha256Hex;
    reused: number;
    status: "staged";
    v: 1;
}>;
export type OhSemanticPublishResultV1 = Readonly<{
    authorityId: string;
    generation: number;
    generationSha256: Sha256Hex;
    isolationSha256: Sha256Hex;
    published: boolean;
    v: 1;
}>;
/** The exact, currently published cache pointer for one semantic authority. */
export type OhSemanticPublishedHeadV1 = Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    generation: number;
    generationSha256: Sha256Hex;
    isolationSha256: Sha256Hex;
    membershipSha256: Sha256Hex;
    profileSha256: Sha256Hex;
    publishedAt: string;
    rendererSha256: Sha256Hex;
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
    countsRecorded: boolean;
    generations: number;
    isolationScopes: number;
    isolationSha256: Sha256Hex;
    memberships: number;
    orphanVectors: number;
    profileSha256: Sha256Hex;
    publishedGeneration: number | null;
    publishedGenerationSha256: Sha256Hex | null;
    purgeMarkerSha256: Sha256Hex;
    purgeReceiptSha256: Sha256Hex;
    purgedAt: string;
    residualGenerations: 0;
    residualMemberships: 0;
    residualScopedVectors: 0;
    v: 1;
}>;
/**
 * Derives the private-by-default cache scope used when a host does not supply
 * its own epoch/profile isolation digest.
 */
export declare function deriveOhSemanticIsolationSha256V1(authorityId: string): Sha256Hex;
export declare function bootstrapOhLibSqlSemanticCacheV1(client: OhLibSqlClientV1, options?: Readonly<{
    appliedAt?: string;
}>): Promise<Readonly<{
    schemaSha256: Sha256Hex;
    schemaVersion: 2;
    v: 1;
}>>;
export declare class OhLibSqlSemanticCacheV1 {
    #private;
    private constructor();
    /** @internal Public callers should use `openOhLibSqlSemanticCacheV1`. */
    static open(client: OhLibSqlClientV1, closeClient: boolean): Promise<OhLibSqlSemanticCacheV1>;
    close(): Promise<void>;
    /**
     * Reads the current compare-and-swap base without exposing cache rows or
     * private source text. An absent or purged authority has no published head.
     */
    publishedHead(input: Readonly<{
        authorityId: string;
        isolationSha256?: Sha256Hex;
    }>): Promise<OhSemanticPublishedHeadV1 | null>;
    stage(input: Readonly<{
        authorityId: string;
        authoritySha256: Sha256Hex;
        createdAt?: string;
        documents: readonly OhSemanticDocumentV1[];
        embeddingClient: OhCloudflareEmbeddingClientV1;
        generation: number;
        isolationSha256?: Sha256Hex;
        maximumChunksPerDocument?: number;
        signal?: AbortSignal;
    }>): Promise<OhSemanticStageResultV1>;
    publish(input: Readonly<{
        authorityId: string;
        expectedPublishedGeneration: number | null;
        generation: number;
        isolationSha256?: Sha256Hex;
        publishedAt?: string;
    }>): Promise<OhSemanticPublishResultV1>;
    search(input: Readonly<{
        authority: OhSemanticAuthorityRefV1;
        embeddingClient: OhCloudflareEmbeddingClientV1;
        limit?: number;
        query: string;
        signal?: AbortSignal;
    }>): Promise<readonly OhSemanticSearchResultV1[]>;
    /** Reads the immutable, content-free receipt for a completed purge. */
    purgeReceipt(input: Readonly<{
        authorityId: string;
        isolationSha256?: Sha256Hex;
    }>): Promise<OhSemanticPurgeResultV1 | null>;
    purgeAuthority(input: Readonly<{
        authorityId: string;
        isolationSha256?: Sha256Hex;
        purgedAt?: string;
    }>): Promise<OhSemanticPurgeResultV1>;
}
export declare function openOhLibSqlSemanticCacheV1(client: OhLibSqlClientV1, options?: Readonly<{
    closeClient?: boolean;
}>): Promise<OhLibSqlSemanticCacheV1>;
//# sourceMappingURL=libsql-semantic.d.ts.map