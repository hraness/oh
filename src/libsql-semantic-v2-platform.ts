import { Context, Effect, Layer } from "effect";
import { canonicalNow } from "./canonical";
import {
  OhCloudflareEmbeddingError, type OhCloudflareEmbeddingClientV1,
  type OhRenderedEmbeddingInputV1
} from "./cloudflare-embedding";
import type { OhLibSqlClientV1, OhLibSqlResultV1, OhLibSqlStatementV1 } from "./libsql-model";
import { OhLibSqlSemanticV2Error } from "./libsql-semantic-v2-model";

/** Private classification; public Promise callers receive the original value. */
export type SemanticCacheFailure = Readonly<{
  _tag: "SemanticCacheDomain" | "SemanticCacheEmbedding" | "SemanticCacheForeign";
  cause: unknown;
}>;

export function semanticCacheFailure(cause: unknown): SemanticCacheFailure {
  return {
    _tag: cause instanceof OhLibSqlSemanticV2Error ? "SemanticCacheDomain"
      : cause instanceof OhCloudflareEmbeddingError ? "SemanticCacheEmbedding" : "SemanticCacheForeign",
    cause,
  };
}

export function semanticCacheValue<A>(evaluate: () => A): Effect.Effect<A, SemanticCacheFailure> {
  return Effect.try({ try: evaluate, catch: semanticCacheFailure });
}

export interface SemanticCacheSqlService {
  readonly execute: (statement: string | OhLibSqlStatementV1) => Effect.Effect<OhLibSqlResultV1, SemanticCacheFailure>;
  readonly batch: (statements: readonly OhLibSqlStatementV1[], mode?: "read" | "write" | "deferred") =>
    Effect.Effect<readonly OhLibSqlResultV1[], SemanticCacheFailure>;
  readonly close: Effect.Effect<void, SemanticCacheFailure>;
}
export class SemanticCacheSql extends Context.Tag("@hraness/oh/SemanticCacheV2/Sql")<
  SemanticCacheSql, SemanticCacheSqlService>() { }

export interface SemanticCacheClockService {
  readonly currentInstant: Effect.Effect<string, SemanticCacheFailure>;
}
export class SemanticCacheClock extends Context.Tag("@hraness/oh/SemanticCacheV2/Clock")<
  SemanticCacheClock, SemanticCacheClockService>() { }

export interface SemanticCacheEmbeddingService {
  readonly embed: (client: OhCloudflareEmbeddingClientV1, inputs: readonly OhRenderedEmbeddingInputV1[],
    options: Readonly<{ signal?: AbortSignal; }>) => Effect.Effect<readonly (readonly number[])[], SemanticCacheFailure>;
}
export class SemanticCacheEmbedding extends Context.Tag("@hraness/oh/SemanticCacheV2/Embedding")<
  SemanticCacheEmbedding, SemanticCacheEmbeddingService>() { }

/** A fiber cannot attest settlement of a foreign Promise. Join it even when
 * interruption is requested; the existing provider owns its signal/deadline. */
function settled<A>(operation: () => Promise<A>): Effect.Effect<A, SemanticCacheFailure> {
  return Effect.uninterruptible(Effect.tryPromise({ try: operation, catch: semanticCacheFailure }));
}

export function semanticCacheSqlLive(client: OhLibSqlClientV1): Layer.Layer<SemanticCacheSql> {
  return Layer.succeed(SemanticCacheSql, {
    execute: statement => settled(() => client.execute(statement)),
    batch: (statements, mode) => settled(() => client.batch(statements, mode)),
    // Await any returned thenable even though the public structural client also
    // accepts synchronous close. No close is invoked for a borrowed client.
    close: settled(async () => { await client.close?.(); }),
  });
}

export const semanticCacheClockLive = Layer.succeed(SemanticCacheClock, {
  currentInstant: semanticCacheValue(canonicalNow),
});

export const semanticCacheEmbeddingLive = Layer.succeed(SemanticCacheEmbedding, {
  // The existing fixed-profile adapter retains provenance validation, response
  // bounds, sanitized HTTP errors and best-effort bad-status body cancellation.
  // Neither this port nor the workflow retries a POST.
  embed: (client, inputs, options) => settled(() => client.embed(inputs, options)),
});
