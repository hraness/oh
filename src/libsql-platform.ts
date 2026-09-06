import { Context, Effect, Layer } from "effect";
import { canonicalNow } from "./canonical";
import { OhConflictError, OhDependencyError, OhIntegrityError, OhOperationSizeError, OhProfileError, OhPurgedSpaceError } from "./store";
import type { OhLibSqlClientV1, OhLibSqlResultV1, OhLibSqlStatementV1 } from "./libsql-model";

export type LibSqlFailure = Readonly<{
  _tag: "LibSqlConflict" | "LibSqlDependency" | "LibSqlIntegrity" | "LibSqlProfile" | "LibSqlPurged" | "LibSqlClosed"
    | "LibSqlCapacity" | "LibSqlValidation" | "LibSqlForeign";
  /** Kept locally to reproduce the existing public rejection value. */
  cause: unknown;
}>;

export function libSqlFailure(cause: unknown): LibSqlFailure {
  return { _tag: cause instanceof OhConflictError ? "LibSqlConflict"
    : cause instanceof OhDependencyError ? "LibSqlDependency"
    : cause instanceof OhIntegrityError ? "LibSqlIntegrity"
    : cause instanceof OhProfileError ? "LibSqlProfile"
    : cause instanceof OhPurgedSpaceError ? "LibSqlPurged"
    : cause instanceof OhOperationSizeError || cause instanceof RangeError ? "LibSqlCapacity"
    : cause instanceof TypeError ? "LibSqlValidation" : "LibSqlForeign", cause };
}

/** Existing canonical validators may throw; unrelated generator defects remain defects. */
export function libSqlValue<A>(evaluate: () => A): Effect.Effect<A, LibSqlFailure> {
  return Effect.try({ try: evaluate, catch: libSqlFailure });
}

export interface LibSqlAuthorityClientService {
  execute(statement: OhLibSqlStatementV1 | string): Effect.Effect<OhLibSqlResultV1, LibSqlFailure>;
  batch(statements: readonly OhLibSqlStatementV1[], mode?: "deferred" | "read" | "write"):
    Effect.Effect<readonly OhLibSqlResultV1[], LibSqlFailure>;
  readonly close: Effect.Effect<void, LibSqlFailure>;
  readonly currentInstant: Effect.Effect<string, LibSqlFailure>;
}

export class LibSqlAuthorityClient extends Context.Tag("@hraness/oh/LibSqlAuthorityClient")<
  LibSqlAuthorityClient, LibSqlAuthorityClientService
>() {}

/** The structural client owns transaction atomicity. Never split a batch or
 * abandon its foreign Promise when a fiber is interrupted; no retry is added. */
export function libSqlAuthorityClientLive(client: OhLibSqlClientV1): Layer.Layer<LibSqlAuthorityClient> {
  const settle = <A>(call: () => Promise<A>): Effect.Effect<A, LibSqlFailure> =>
    Effect.uninterruptible(Effect.tryPromise({ try: call, catch: libSqlFailure }));
  return Layer.succeed(LibSqlAuthorityClient, {
    execute: statement => settle(() => client.execute(statement)),
    batch: (statements, mode) => settle(() => client.batch(statements, mode)),
    close: libSqlValue(() => { client.close?.(); }),
    currentInstant: libSqlValue(canonicalNow),
  });
}
