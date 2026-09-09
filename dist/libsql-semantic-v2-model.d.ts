import { type Sha256Hex } from "./canonical";
import { type OhCloudflareEmbeddingClientV1, type OhRenderedEmbeddingInputV1 } from "./cloudflare-embedding";
import type { OhLibSqlResultV1 } from "./libsql";
export declare const OH_LIBSQL_SEMANTIC_LIMITS_V2: Readonly<{
    chunksPerDocument: 64;
    chunksPerGeneration: 4096;
    documentsPerGeneration: 512;
    embeddingBatch: 16;
    searchLimit: 100;
    searchPage: 128;
}>;
export declare class OhLibSqlSemanticV2Error extends Error {
    readonly code: "conflict" | "integrity" | "invalid-input" | "purged" | "schema-unavailable";
    constructor(code: OhLibSqlSemanticV2Error["code"], message: string);
}
export type OhSemanticAuthorityRefV2 = Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    generation: number;
    /** Defaults to an authority-specific isolation when omitted. */
    isolationSha256?: Sha256Hex;
    records: readonly Readonly<{
        key: string;
        recordSha256: Sha256Hex;
    }>[];
    v: 2;
}>;
export type OhSemanticDocumentV2 = Readonly<{
    content: string;
    key: string;
    recordSha256: Sha256Hex;
    title: string;
    v: 2;
}>;
export type OhSemanticStageResultV2 = Readonly<{
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
    v: 2;
}>;
export type OhSemanticPublishResultV2 = Readonly<{
    authorityId: string;
    generation: number;
    generationSha256: Sha256Hex;
    isolationSha256: Sha256Hex;
    published: boolean;
    v: 2;
}>;
export type OhSemanticPublishedHeadV2 = Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    generation: number;
    generationSha256: Sha256Hex;
    isolationSha256: Sha256Hex;
    membershipSha256: Sha256Hex;
    profileSha256: Sha256Hex;
    publishedAt: string;
    rendererSha256: Sha256Hex;
    v: 2;
}>;
export type OhSemanticSearchResultV2 = Readonly<{
    chunkOrdinal: number;
    key: string;
    recordSha256: Sha256Hex;
    score: number;
    v: 2;
}>;
export type OhSemanticPurgeResultV2 = Readonly<{
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
    v: 2;
}>;
export declare const SCHEMA_NAME_V1 = "oh.libsql-semantic-cache.v1";
export declare const SCHEMA_VERSION_V1 = 1;
export declare const SCHEMA_NAME = "oh.libsql-semantic-cache.v2";
export declare const SCHEMA_VERSION = 2;
export declare const VECTOR_BYTES: number;
export declare const DEFAULT_ISOLATION_KIND = "oh.semantic-authority-isolation.v2";
export declare const GENERATION_KIND = "oh.semantic-generation.v2";
export declare const MEMBERSHIP_KIND = "oh.semantic-membership.v2";
export declare const PURGE_MARKER_KIND = "oh.semantic-purge-marker.v2";
export declare const PURGE_RECEIPT_KIND = "oh.semantic-purge-receipt.v2";
export declare const TRANSITION_PAGE_SIZE = 32;
export declare const TRANSITION_TABLE_NAME = "oh_semantic_v1_purge_transition";
export declare const SCHEMA_TABLE = "CREATE TABLE IF NOT EXISTS oh_semantic_schemas (\n  version INTEGER PRIMARY KEY,\n  name TEXT NOT NULL UNIQUE,\n  schema_sha256 TEXT NOT NULL,\n  applied_at TEXT NOT NULL\n) STRICT";
export declare const TRANSITION_TABLE = "CREATE TABLE oh_semantic_v1_purge_transition (\n  authority_id TEXT PRIMARY KEY,\n  purged_at TEXT NOT NULL\n) STRICT";
export declare const SCHEMA_STATEMENTS_V1: readonly string[];
export declare const SCHEMA_STATEMENTS: readonly string[];
export declare function normalizedSchemaSql(sql: string): string;
export type SchemaObject = Readonly<{
    name: string;
    sql: string;
    tableName: string;
    type: "index" | "table" | "trigger";
}>;
export declare function expectedSchemaObject(statement: string): SchemaObject;
export declare const EXPECTED_SCHEMA_OBJECTS: readonly Readonly<{
    name: string;
    sql: string;
    tableName: string;
    type: "index" | "table" | "trigger";
}>[];
export declare const SCHEMA_SHA256: Sha256Hex;
export declare const EXPECTED_SCHEMA_OBJECTS_V1: readonly Readonly<{
    name: string;
    sql: string;
    tableName: string;
    type: "index" | "table" | "trigger";
}>[];
export declare const SCHEMA_SHA256_V1: Sha256Hex;
export declare const EXPECTED_TRANSITION_SCHEMA_OBJECTS: readonly Readonly<{
    name: string;
    sql: string;
    tableName: string;
    type: "index" | "table" | "trigger";
}>[];
export declare function rowValue(row: Readonly<Record<string, unknown>> | readonly unknown[], key: string, index: number): unknown;
export declare function integer(value: unknown): number | null;
export declare function rowsAffected(result: OhLibSqlResultV1): number;
export declare function parseAuthorityId(value: unknown): string;
export declare function deriveOhSemanticIsolationSha256V2(authorityId: string): Sha256Hex;
export declare function isolationSha256(authorityId: string, value: unknown): Sha256Hex;
export declare function purgeMarkerSha256(authorityId: string, isolation: Sha256Hex, purgedAt: string): Sha256Hex;
export declare function parseRecordKey(value: unknown): string;
export declare function parseGeneration(value: unknown): number;
export declare function parseDigest(value: unknown, label: string): Sha256Hex;
export declare function parseInstant(value: unknown): string;
export type LegacyPurge = Readonly<{
    authorityId: string;
    purgedAt: string;
}>;
export declare function vectorBytes(vector: readonly number[]): Uint8Array;
export declare function storedBytes(value: unknown): Uint8Array | null;
export declare function decodeVector(value: unknown, expectedSha256: unknown): readonly number[];
export type Membership = Readonly<{
    input: OhRenderedEmbeddingInputV1;
    inputSha256: Sha256Hex;
    ordinal: number;
    recordKey: string;
    recordSha256: Sha256Hex;
}>;
export type Generation = Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    chunkCount: number;
    createdAt: string;
    documentCount: number;
    generation: number;
    generationSha256: Sha256Hex;
    isolationSha256: Sha256Hex;
    membershipSha256: Sha256Hex;
    memberships: readonly Membership[];
}>;
export type StoredGeneration = Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    chunkCount: number;
    createdAt: string;
    documentCount: number;
    generation: number;
    generationSha256: Sha256Hex;
    isolationSha256: Sha256Hex;
    membershipSha256: Sha256Hex;
    profileSha256: Sha256Hex;
    rendererSha256: Sha256Hex;
}>;
export type StoredHead = Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    generation: number;
    generationSha256: Sha256Hex;
    isolationSha256: Sha256Hex;
    membershipSha256: Sha256Hex;
    profileSha256: Sha256Hex;
    publishedAt: string;
    rendererSha256: Sha256Hex;
}>;
export declare function parseStoredGeneration(row: Readonly<Record<string, unknown>> | readonly unknown[]): StoredGeneration;
export declare function generationMatches(left: StoredGeneration, right: Generation): boolean;
export declare function parseStoredHead(row: Readonly<Record<string, unknown>> | readonly unknown[]): StoredHead;
export declare function headMatchesGeneration(head: StoredHead, generation: StoredGeneration): boolean;
export declare const GENERATION_SELECT = "SELECT authority_id, generation, authority_sha256,\n  isolation_sha256, profile_sha256, renderer_sha256, membership_sha256, generation_sha256,\n  document_count, chunk_count, created_at\n  FROM oh_semantic_generations WHERE authority_id = ? AND generation = ?";
export declare const HEAD_SELECT = "SELECT authority_id, generation, authority_sha256,\n  isolation_sha256, profile_sha256, renderer_sha256, membership_sha256,\n  generation_sha256, published_at\n  FROM oh_semantic_heads WHERE authority_id = ?";
export type StoredPurge = Readonly<Omit<OhSemanticPurgeResultV2, "purgeReceiptSha256">>;
export declare function purgeResult(stored: StoredPurge): OhSemanticPurgeResultV2;
export type StoredVector = Readonly<{
    bytes: Uint8Array;
    inputSha256: Sha256Hex;
    vectorSha256: Sha256Hex;
}>;
export declare function validateEmbeddingClient(client: OhCloudflareEmbeddingClientV1): void;
//# sourceMappingURL=libsql-semantic-v2-model.d.ts.map