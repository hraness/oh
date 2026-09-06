import { Cause, Effect, Exit, Fiber, FiberSet, Option, Ref } from "effect";

import type { OhSemanticSearchBackendV1 } from "./semantic-model";
import { semanticPlatformLive, type SemanticFailure, type SemanticOptions } from "./semantic-platform";
import { makeSemanticLifecycle } from "./semantic-program";

type SemanticBoundary = Omit<OhSemanticSearchBackendV1, "profile">;

/** The only asynchronous runner accepts an already closed, total boundary. */
async function runClosed<A>(effect: Effect.Effect<Exit.Exit<A, SemanticFailure>, never, never>): Promise<A> {
  const result = await Effect.runPromise(effect);
  if (Exit.isSuccess(result)) return result.value;
  const expected = Cause.failureOption(result.cause);
  if (Option.isSome(expected)) throw expected.value.cause;
  throw Cause.squash(result.cause);
}

export function makeSemanticBoundary(options: SemanticOptions): SemanticBoundary {
  const lifecycle = Effect.runSync(makeSemanticLifecycle.pipe(Effect.provide(semanticPlatformLive(options))));
  const start = Effect.runSync(FiberSet.runtime(lifecycle.operations)<never>());

  function admitted<A>(operation: Effect.Effect<A, SemanticFailure, never>, immediate = true): Promise<A> {
    // Register synchronously before returning to the caller, so immediate close
    // cannot overtake an admitted operation before its fiber has started.
    const fiber = start(Effect.exit(operation), { immediate });
    return runClosed(Fiber.join(fiber));
  }
  function isClosed(): boolean {
    return Effect.runSync(Ref.get(lifecycle.closed));
  }
  return {
    index(records) {
      if (records.length > 65_536) {
        return Promise.reject(new RangeError("A semantic snapshot may contain at most 65,536 records."));
      }
      if (isClosed()) return Promise.reject(new Error("The semantic backend is closed."));
      // Index snapshots have always entered an asynchronous FIFO queue. Keep
      // same-turn close ahead of their first filesystem operation.
      return admitted(lifecycle.index([...records]), false);
    },
    search(query, limit, authority) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        return Promise.reject(new RangeError("Semantic limit must be 1 through 100."));
      }
      if (isClosed()) return Promise.reject(new Error("The semantic backend is closed."));
      return admitted(lifecycle.search(query, limit, authority));
    },
    close() {
      Effect.runSync(Ref.set(lifecycle.closed, true));
      return runClosed(Effect.exit(lifecycle.close));
    },
  };
}
