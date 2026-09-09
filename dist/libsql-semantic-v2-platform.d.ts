import { Context, Effect, Layer } from "effect";
import { type OhCloudflareEmbeddingClientV1, type OhRenderedEmbeddingInputV1 } from "./cloudflare-embedding";
import type { OhLibSqlClientV1, OhLibSqlResultV1, OhLibSqlStatementV1 } from "./libsql-model";
/** Private classification; public Promise callers receive the original value. */
export type SemanticCacheFailure = Readonly<{
    _tag: "SemanticCacheDomain" | "SemanticCacheEmbedding" | "SemanticCacheForeign";
    cause: unknown;
}>;
export declare function semanticCacheFailure(cause: unknown): SemanticCacheFailure;
export declare function semanticCacheValue<A>(evaluate: () => A): Effect.Effect<A, SemanticCacheFailure>;
export interface SemanticCacheSqlService {
    readonly execute: (statement: string | OhLibSqlStatementV1) => Effect.Effect<OhLibSqlResultV1, SemanticCacheFailure>;
    readonly batch: (statements: readonly OhLibSqlStatementV1[], mode?: "read" | "write" | "deferred") => Effect.Effect<readonly OhLibSqlResultV1[], SemanticCacheFailure>;
    readonly close: Effect.Effect<void, SemanticCacheFailure>;
}
declare const SemanticCacheSql_base: Context.TagClass<SemanticCacheSql, "@hraness/oh/SemanticCacheV2/Sql", SemanticCacheSqlService>;
export declare class SemanticCacheSql extends SemanticCacheSql_base {
}
export interface SemanticCacheClockService {
    readonly currentInstant: Effect.Effect<string, SemanticCacheFailure>;
}
declare const SemanticCacheClock_base: Context.TagClass<SemanticCacheClock, "@hraness/oh/SemanticCacheV2/Clock", SemanticCacheClockService>;
export declare class SemanticCacheClock extends SemanticCacheClock_base {
}
export interface SemanticCacheEmbeddingService {
    readonly embed: (client: OhCloudflareEmbeddingClientV1, inputs: readonly OhRenderedEmbeddingInputV1[], options: Readonly<{
        signal?: AbortSignal;
    }>) => Effect.Effect<readonly (readonly number[])[], SemanticCacheFailure>;
}
declare const SemanticCacheEmbedding_base: Context.TagClass<SemanticCacheEmbedding, "@hraness/oh/SemanticCacheV2/Embedding", SemanticCacheEmbeddingService>;
export declare class SemanticCacheEmbedding extends SemanticCacheEmbedding_base {
}
export declare function semanticCacheSqlLive(client: OhLibSqlClientV1): Layer.Layer<SemanticCacheSql>;
export declare const semanticCacheClockLive: Layer.Layer<SemanticCacheClock, never, never>;
export declare const semanticCacheEmbeddingLive: Layer.Layer<SemanticCacheEmbedding, never, never>;
export {};
//# sourceMappingURL=libsql-semantic-v2-platform.d.ts.map