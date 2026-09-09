import type { Sha256Hex } from "./canonical";
import type { OhCloudflareEmbeddingClientV1 } from "./cloudflare-embedding";
import type { OhLibSqlClientV1 } from "./libsql";
import type { OhSemanticAuthorityRefV2, OhSemanticDocumentV2, OhSemanticStageResultV2, OhSemanticPublishResultV2, OhSemanticPublishedHeadV2, OhSemanticSearchResultV2, OhSemanticPurgeResultV2 } from "./libsql-semantic-v2-model";
export { OH_LIBSQL_SEMANTIC_LIMITS_V2, OhLibSqlSemanticV2Error, deriveOhSemanticIsolationSha256V2 } from "./libsql-semantic-v2-model";
export type { OhSemanticAuthorityRefV2, OhSemanticDocumentV2, OhSemanticStageResultV2, OhSemanticPublishResultV2, OhSemanticPublishedHeadV2, OhSemanticSearchResultV2, OhSemanticPurgeResultV2 } from "./libsql-semantic-v2-model";
export declare function bootstrapOhLibSqlSemanticCacheV2(client: OhLibSqlClientV1, options?: Readonly<{
    appliedAt?: string;
}>): Promise<Readonly<{
    schemaSha256: Sha256Hex;
    schemaVersion: 2;
    v: 2;
}>>;
export declare class OhLibSqlSemanticCacheV2 {
    #private;
    private constructor();
    /** @internal Public callers should use `openOhLibSqlSemanticCacheV2`. */
    static open(client: OhLibSqlClientV1, closeClient: boolean): Promise<OhLibSqlSemanticCacheV2>;
    close(): Promise<void>;
    publishedHead(input: Readonly<{
        authorityId: string;
        isolationSha256?: Sha256Hex;
    }>): Promise<OhSemanticPublishedHeadV2 | null>;
    stage(input: Readonly<{
        authorityId: string;
        authoritySha256: Sha256Hex;
        createdAt?: string;
        documents: readonly OhSemanticDocumentV2[];
        embeddingClient: OhCloudflareEmbeddingClientV1;
        generation: number;
        isolationSha256?: Sha256Hex;
        maximumChunksPerDocument?: number;
        signal?: AbortSignal;
    }>): Promise<OhSemanticStageResultV2>;
    publish(input: Readonly<{
        authorityId: string;
        expectedPublishedGeneration: number | null;
        generation: number;
        isolationSha256?: Sha256Hex;
        publishedAt?: string;
    }>): Promise<OhSemanticPublishResultV2>;
    search(input: Readonly<{
        authority: OhSemanticAuthorityRefV2;
        embeddingClient: OhCloudflareEmbeddingClientV1;
        limit?: number;
        query: string;
        signal?: AbortSignal;
    }>): Promise<readonly OhSemanticSearchResultV2[]>;
    purgeReceipt(input: Readonly<{
        authorityId: string;
        isolationSha256?: Sha256Hex;
    }>): Promise<OhSemanticPurgeResultV2 | null>;
    purgeAuthority(input: Readonly<{
        authorityId: string;
        isolationSha256?: Sha256Hex;
        purgedAt?: string;
    }>): Promise<OhSemanticPurgeResultV2>;
}
export declare function openOhLibSqlSemanticCacheV2(client: OhLibSqlClientV1, options?: Readonly<{
    closeClient?: boolean;
}>): Promise<OhLibSqlSemanticCacheV2>;
//# sourceMappingURL=libsql-semantic-v2.d.ts.map