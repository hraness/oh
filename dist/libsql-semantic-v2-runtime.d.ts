import { Effect } from "effect";
import type { OhLibSqlClientV1 } from "./libsql-model";
import { SemanticCacheSql, type SemanticCacheClock, type SemanticCacheEmbedding, type SemanticCacheFailure } from "./libsql-semantic-v2-platform";
export type SemanticCacheRequirements = SemanticCacheSql | SemanticCacheClock | SemanticCacheEmbedding;
/** Admission is synchronous; SQL keeps its own concurrency/CAS authority. */
export declare const makeSemanticCacheOwner: Effect.Effect<{
    admit: Effect.Effect<boolean, never, never>;
    beginClose: Effect.Effect<void, never, never>;
    drained: Effect.Effect<void, never, never>;
    complete: <A, R>(program: Effect.Effect<A, SemanticCacheFailure, R>) => Effect.Effect<A, SemanticCacheFailure, R>;
}, never, never>;
export interface SemanticCacheRuntime {
    readonly run: <A>(program: Effect.Effect<A, SemanticCacheFailure, SemanticCacheRequirements>) => Promise<A>;
    readonly close: () => Promise<void>;
}
export declare function openSemanticCacheRuntime(client: OhLibSqlClientV1, closeClient: boolean): Promise<SemanticCacheRuntime>;
/** Bootstrap borrows the client for one complete resumable schema workflow. */
export declare function bootstrapSemanticCacheRuntime(client: OhLibSqlClientV1, options: Readonly<{
    appliedAt?: string;
}>): Promise<Readonly<{
    schemaSha256: import("./canonical").Sha256Hex;
    schemaVersion: 2;
    v: 2;
}>>;
//# sourceMappingURL=libsql-semantic-v2-runtime.d.ts.map