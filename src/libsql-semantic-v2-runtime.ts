import { Cause, Deferred, Effect, Exit, Layer, ManagedRuntime, Option, Ref } from "effect";
import type { OhLibSqlClientV1 } from "./libsql-model";
import { OhLibSqlSemanticV2Error } from "./libsql-semantic-v2-model";
import { bootstrapSemanticCache, verifySchema } from "./libsql-semantic-v2-program";
import {
  SemanticCacheSql, type SemanticCacheClock, type SemanticCacheEmbedding,
  semanticCacheSqlLive, semanticCacheClockLive, semanticCacheEmbeddingLive,
  type SemanticCacheFailure
} from "./libsql-semantic-v2-platform";

export type SemanticCacheRequirements = SemanticCacheSql | SemanticCacheClock | SemanticCacheEmbedding;

function reject(cause: Cause.Cause<SemanticCacheFailure>): never {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) throw failure.value.cause;
  throw Cause.squash(cause);
}

function unwrap<A>(exit: Exit.Exit<A, SemanticCacheFailure>): A {
  return Exit.isSuccess(exit) ? exit.value : reject(exit.cause);
}

/** Admission is synchronous; SQL keeps its own concurrency/CAS authority. */
export const makeSemanticCacheOwner = Effect.gen(function*() {
  const active = yield* Ref.make(0);
  const closing = yield* Ref.make(false);
  const drained = yield* Deferred.make<void>();
  const admit = Effect.gen(function*() {
    if (yield* Ref.get(closing)) return false;
    yield* Ref.update(active, count => count + 1);
    return true;
  });
  const release = Effect.gen(function*() {
    const remaining = yield* Ref.updateAndGet(active, count => count - 1);
    if (remaining === 0 && (yield* Ref.get(closing))) yield* Deferred.succeed(drained, undefined);
  });
  const beginClose = Effect.gen(function*() {
    yield* Ref.set(closing, true);
    if ((yield* Ref.get(active)) === 0) yield* Deferred.succeed(drained, undefined);
  });
  return {
    admit, beginClose, drained: Deferred.await(drained),
    complete: <A, R>(program: Effect.Effect<A, SemanticCacheFailure, R>): Effect.Effect<A, SemanticCacheFailure, R> =>
      Effect.uninterruptible(program.pipe(Effect.ensuring(release))),
  };
});

export interface SemanticCacheRuntime {
  readonly run: <A>(program: Effect.Effect<A, SemanticCacheFailure, SemanticCacheRequirements>) => Promise<A>;
  readonly close: () => Promise<void>;
}

function cacheLayer(client: OhLibSqlClientV1) {
  return Layer.mergeAll(semanticCacheSqlLive(client), semanticCacheClockLive, semanticCacheEmbeddingLive);
}

export async function openSemanticCacheRuntime(client: OhLibSqlClientV1, closeClient: boolean): Promise<SemanticCacheRuntime> {
  const runtime = ManagedRuntime.make(cacheLayer(client));
  const opened = await runtime.runPromiseExit(Effect.uninterruptible(verifySchema()));
  if (Exit.isFailure(opened)) {
    // Ownership transfers only after schema verification succeeds. Failed open
    // disposes this Effect context but retains the caller's native client.
    await runtime.dispose();
    return reject(opened.cause);
  }
  const owner = Effect.runSync(makeSemanticCacheOwner);
  let closing: Promise<void> | undefined;
  const run: SemanticCacheRuntime["run"] = program => {
    if (!Effect.runSync(owner.admit)) return Promise.reject(
      new OhLibSqlSemanticV2Error("schema-unavailable", "The semantic cache is closed."));
    return runtime.runPromiseExit(owner.complete(program)).then(unwrap);
  };
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    Effect.runSync(owner.beginClose);
    // Yield before native close to cache the Promise even under synchronous
    // reentry. An operation failure and close failure keep separate owners.
    closing = runtime.runPromiseExit(Effect.uninterruptible(Effect.gen(function*() {
      yield* Effect.yieldNow();
      yield* owner.drained;
      if (closeClient) yield* (yield* SemanticCacheSql).close;
    }))).then(async exit => {
      await runtime.dispose();
      return unwrap(exit);
    });
    return closing;
  };
  return Object.freeze({ run, close });
}

/** Bootstrap borrows the client for one complete resumable schema workflow. */
export function bootstrapSemanticCacheRuntime(client: OhLibSqlClientV1, options: Readonly<{ appliedAt?: string; }>) {
  return Effect.runPromiseExit(Effect.uninterruptible(bootstrapSemanticCache(options))
    .pipe(Effect.provide(cacheLayer(client)))).then(unwrap);
}
