import { Effect, Exit, FiberSet, Ref, Scope } from "effect";

import { sha256Hex } from "./canonical";
import type { KnowledgeGraphRecordV1 } from "./graph";
import { parseQmdVectorResults, recordDocument, semanticManifest,
  type OhSemanticSearchResultV1, type SemanticManifestV1 } from "./semantic-model";
import { SemanticPlatform, type SemanticFailure } from "./semantic-platform";
import type { OhSqliteStore } from "./sqlite/store";

export interface SemanticLifecycle {
  readonly closed: Ref.Ref<boolean>;
  readonly operations: FiberSet.FiberSet<Exit.Exit<unknown, SemanticFailure>, never>;
  readonly close: Effect.Effect<void, SemanticFailure>;
  index(records: readonly KnowledgeGraphRecordV1[]): Effect.Effect<Readonly<{ indexed: number; v: 1 }>, SemanticFailure>;
  search(query: string, limit: number, authority: OhSqliteStore): Effect.Effect<readonly OhSemanticSearchResultV1[], SemanticFailure>;
}

/** One owner scope holds the optional store until all admitted operations settle. */
export const makeSemanticLifecycle: Effect.Effect<SemanticLifecycle, never, SemanticPlatform> = Effect.gen(function* () {
  const platform = yield* SemanticPlatform;
  const owner = yield* Scope.make();
  const operations = yield* Scope.extend(FiberSet.make<Exit.Exit<unknown, SemanticFailure>, never>(), owner);
  const closed = yield* Ref.make(false);
  const manifest = yield* Ref.make<SemanticManifestV1>(semanticManifest({}));
  const releaseResult = yield* Ref.make<Exit.Exit<void, SemanticFailure>>(Exit.void);
  const indexing = yield* Effect.makeSemaphore(1);

  const ensureOpen: Effect.Effect<void, SemanticFailure> = Effect.gen(function* () {
    if (yield* Ref.get(closed)) {
      return yield* Effect.fail({ _tag: "Closed", cause: new Error("The semantic backend is closed.") } satisfies SemanticFailure);
    }
  });
  const loadManifest = yield* Effect.cached(platform.loadManifest.pipe(
    Effect.flatMap((value) => Ref.set(manifest, value)),
  ));
  const initialize = yield* Effect.cached(Effect.gen(function* () {
    yield* platform.prepare;
    yield* loadManifest;
    yield* ensureOpen;
    // Acquisition and finalizer registration are uninterruptible as one unit.
    return yield* Scope.extend(Effect.acquireRelease(
      Effect.gen(function* () {
        const store = yield* platform.open;
        const release = yield* Effect.cached(platform.close(store));
        return { store, release };
      }),
      ({ release }) => Effect.exit(release).pipe(Effect.flatMap((result) => Ref.set(releaseResult, result))),
    ), owner);
  }));

  const open = Effect.gen(function* () {
    yield* ensureOpen;
    const acquired = yield* initialize;
    if (yield* Ref.get(closed)) {
      // A late store must close even though the operation that acquired it fails.
      // The scope finalizer shares this cached release, including its exact error.
      yield* acquired.release;
      yield* ensureOpen;
    }
    return acquired.store;
  });

  function index(records: readonly KnowledgeGraphRecordV1[]): Effect.Effect<Readonly<{ indexed: number; v: 1 }>, SemanticFailure> {
    return indexing.withPermits(1)(Effect.gen(function* () {
      yield* ensureOpen;
      yield* platform.prepare;
      yield* loadManifest;
      const next = yield* platform.writeDocuments(records);
      const store = yield* open;
      yield* platform.update(store);
      yield* platform.embed(store);
      yield* platform.publishManifest(next);
      yield* Ref.set(manifest, next);
      return { indexed: records.length, v: 1 };
    }));
  }

  function search(query: string, limit: number,
    authority: OhSqliteStore): Effect.Effect<readonly OhSemanticSearchResultV1[], SemanticFailure> {
    return Effect.gen(function* () {
      const store = yield* open;
      const snapshot = yield* Ref.get(manifest);
      const rawResults = yield* platform.search(store, query, Math.min(100, limit * 3));
      const results = yield* Effect.try({
        try: () => parseQmdVectorResults(rawResults),
        catch: (cause): SemanticFailure => ({ _tag: "ResultFailure", cause }),
      });
      const output: OhSemanticSearchResultV1[] = [];
      const seen = new Set<string>();
      for (const result of results) {
        const entry = snapshot.entries[result.filename];
        if (entry === undefined || result.title !== entry.key || seen.has(entry.key)) continue;
        const current = yield* platform.readAuthority(authority, entry.key);
        if (current === null || current.recordSha256 !== entry.recordSha256) continue;
        const expectedDocument = recordDocument(current);
        if (result.body !== expectedDocument || result.hash !== sha256Hex(expectedDocument)) continue;
        seen.add(entry.key);
        output.push({ key: entry.key, recordSha256: entry.recordSha256, score: result.score, v: 1 });
        if (output.length === limit) break;
      }
      return output;
    });
  }

  const close = yield* Effect.cached(Effect.gen(function* () {
    // A failed operation does not abort draining its siblings or poison close.
    yield* FiberSet.awaitEmpty(operations);
    yield* Scope.close(owner, Exit.void);
    const result = yield* Ref.get(releaseResult);
    return yield* result;
  }));
  return { closed, operations, close, index, search };
});
