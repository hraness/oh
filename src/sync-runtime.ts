import { Cause, Effect, Exit, Layer, Option } from "effect";
import type { OhSqliteStore } from "./sqlite/store";
import type { LibSqlClientV1, OhOperationSyncTransportV1, OhSyncResultV1 } from "./sync-model";
import { makeLibSqlSyncTransport } from "./sync-libsql-program";
import { libSqlSyncClientLive, syncStoreLive, syncTransportLive, type SyncFailure } from "./sync-platform";
import { synchronize, type SyncOptions } from "./sync-program";

/** Closed runners retain the public facade's exact foreign rejection value. */
async function runClosed<A>(program: Effect.Effect<Exit.Exit<A, SyncFailure>, never, never>): Promise<A> {
  const result = await Effect.runPromise(program);
  if (Exit.isSuccess(result)) return result.value;
  const expected = Cause.failureOption(result.cause);
  if (Option.isSome(expected)) throw expected.value.cause;
  throw Cause.squash(result.cause);
}

export function runSyncBoundary(store: OhSqliteStore, transport: OhOperationSyncTransportV1,
  options: SyncOptions): Promise<OhSyncResultV1> {
  return runClosed(synchronize(options).pipe(
    Effect.provide(Layer.merge(syncStoreLive(store), syncTransportLive(transport))),
    Effect.exit,
  ));
}

export function makeLibSqlSyncBoundary(client: LibSqlClientV1): OhOperationSyncTransportV1 {
  const transport = Effect.runSync(makeLibSqlSyncTransport.pipe(Effect.provide(libSqlSyncClientLive(client))));
  return {
    handshake: (manifest) => runClosed(Effect.exit(transport.handshake(manifest))),
    head: (spaceId) => runClosed(Effect.exit(transport.head(spaceId))),
    pull: (spaceId, afterSequence, limit) => runClosed(Effect.exit(transport.pull(spaceId, afterSequence, limit))),
    push: (bundle) => runClosed(Effect.exit(transport.push(bundle))),
  };
}
