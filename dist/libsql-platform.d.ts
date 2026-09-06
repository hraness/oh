import { Context, Effect, Layer } from "effect";
import type { OhLibSqlClientV1, OhLibSqlResultV1, OhLibSqlStatementV1 } from "./libsql-model";
export type LibSqlFailure = Readonly<{
    _tag: "LibSqlConflict" | "LibSqlDependency" | "LibSqlIntegrity" | "LibSqlProfile" | "LibSqlPurged" | "LibSqlClosed" | "LibSqlCapacity" | "LibSqlValidation" | "LibSqlForeign";
    /** Kept locally to reproduce the existing public rejection value. */
    cause: unknown;
}>;
export declare function libSqlFailure(cause: unknown): LibSqlFailure;
/** Existing canonical validators may throw; unrelated generator defects remain defects. */
export declare function libSqlValue<A>(evaluate: () => A): Effect.Effect<A, LibSqlFailure>;
export interface LibSqlAuthorityClientService {
    execute(statement: OhLibSqlStatementV1 | string): Effect.Effect<OhLibSqlResultV1, LibSqlFailure>;
    batch(statements: readonly OhLibSqlStatementV1[], mode?: "deferred" | "read" | "write"): Effect.Effect<readonly OhLibSqlResultV1[], LibSqlFailure>;
    readonly close: Effect.Effect<void, LibSqlFailure>;
    readonly currentInstant: Effect.Effect<string, LibSqlFailure>;
}
declare const LibSqlAuthorityClient_base: Context.TagClass<LibSqlAuthorityClient, "@hraness/oh/LibSqlAuthorityClient", LibSqlAuthorityClientService>;
export declare class LibSqlAuthorityClient extends LibSqlAuthorityClient_base {
}
/** The structural client owns transaction atomicity. Never split a batch or
 * abandon its foreign Promise when a fiber is interrupted; no retry is added. */
export declare function libSqlAuthorityClientLive(client: OhLibSqlClientV1): Layer.Layer<LibSqlAuthorityClient>;
export {};
//# sourceMappingURL=libsql-platform.d.ts.map