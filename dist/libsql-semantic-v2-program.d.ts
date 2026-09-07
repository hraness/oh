import { Effect } from "effect";
import { type Sha256Hex } from "./canonical";
import { type OhCloudflareEmbeddingClientV1 } from "./cloudflare-embedding";
import { OhSemanticAuthorityRefV2, OhSemanticDocumentV2, OhSemanticStageResultV2, OhSemanticPublishResultV2, OhSemanticPublishedHeadV2, OhSemanticSearchResultV2, OhSemanticPurgeResultV2 } from "./libsql-semantic-v2-model";
import { SemanticCacheSql, SemanticCacheClock, SemanticCacheEmbedding, type SemanticCacheFailure } from "./libsql-semantic-v2-platform";
export declare function verifySchema(): Effect.Effect<void, SemanticCacheFailure, SemanticCacheSql>;
export declare function bootstrapSemanticCache(options?: Readonly<{
    appliedAt?: string;
}>): Effect.Effect<Readonly<{
    schemaSha256: Sha256Hex;
    schemaVersion: 2;
    v: 2;
}>, SemanticCacheFailure, SemanticCacheSql | SemanticCacheClock>;
export declare function publishedHead(input: Readonly<{
    authorityId: string;
    isolationSha256?: Sha256Hex;
}>): Effect.Effect<OhSemanticPublishedHeadV2 | null, SemanticCacheFailure, SemanticCacheSql>;
export declare function stage(input: Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    createdAt?: string;
    documents: readonly OhSemanticDocumentV2[];
    embeddingClient: OhCloudflareEmbeddingClientV1;
    generation: number;
    isolationSha256?: Sha256Hex;
    maximumChunksPerDocument?: number;
    signal?: AbortSignal;
}>): Effect.Effect<OhSemanticStageResultV2, SemanticCacheFailure, SemanticCacheSql | SemanticCacheClock | SemanticCacheEmbedding>;
export declare function publish(input: Readonly<{
    authorityId: string;
    expectedPublishedGeneration: number | null;
    generation: number;
    isolationSha256?: Sha256Hex;
    publishedAt?: string;
}>): Effect.Effect<OhSemanticPublishResultV2, SemanticCacheFailure, SemanticCacheSql | SemanticCacheClock>;
export declare function search(input: Readonly<{
    authority: OhSemanticAuthorityRefV2;
    embeddingClient: OhCloudflareEmbeddingClientV1;
    limit?: number;
    query: string;
    signal?: AbortSignal;
}>): Effect.Effect<readonly OhSemanticSearchResultV2[], SemanticCacheFailure, SemanticCacheSql | SemanticCacheEmbedding>;
export declare function purgeReceipt(input: Readonly<{
    authorityId: string;
    isolationSha256?: Sha256Hex;
}>): Effect.Effect<OhSemanticPurgeResultV2 | null, SemanticCacheFailure, SemanticCacheSql>;
export declare function purgeAuthority(input: Readonly<{
    authorityId: string;
    isolationSha256?: Sha256Hex;
    purgedAt?: string;
}>): Effect.Effect<OhSemanticPurgeResultV2, SemanticCacheFailure, SemanticCacheSql | SemanticCacheClock>;
//# sourceMappingURL=libsql-semantic-v2-program.d.ts.map