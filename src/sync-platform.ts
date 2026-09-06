import { Context, Effect, Layer } from "effect";

import type { OhSqliteStore } from "./sqlite/store";
import type { LibSqlClientV1, LibSqlResultV1, LibSqlStatementV1,
  OhOperationSyncTransportV1, OhSyncBundleV1, OhSyncHeadV1 } from "./sync-model";
import type { OhContractManifestV1 } from "./contract";

export type SyncFailure = Readonly<{
  _tag: "StoreFailure" | "TransportFailure" | "ValidationFailure" | "SyncConflict" | "RoundLimit";
  /** Original rejection identity is retained only at the public boundary. */
  cause: unknown;
}>;

export function syncInvalid(cause: unknown): SyncFailure {
  return { _tag: "ValidationFailure", cause };
}

export interface SyncTransportService {
  handshake(manifest: OhContractManifestV1): Effect.Effect<void, SyncFailure>;
  head(spaceId: string): Effect.Effect<OhSyncHeadV1, SyncFailure>;
  pull(spaceId: string, afterSequence: number, limit: number): Effect.Effect<OhSyncBundleV1, SyncFailure>;
  push(bundle: OhSyncBundleV1): Effect.Effect<OhSyncHeadV1, SyncFailure>;
}

export class SyncTransport extends Context.Tag("@hraness/oh/SyncTransport")<
  SyncTransport, SyncTransportService
>() {}

export interface SyncStoreService {
  readonly spaceId: string;
  readonly head: Effect.Effect<ReturnType<OhSqliteStore["head"]>, SyncFailure>;
  importOperations(input: Parameters<OhSqliteStore["importOperations"]>[0]):
    Effect.Effect<ReturnType<OhSqliteStore["importOperations"]>, SyncFailure>;
  changesSince(head: Parameters<OhSqliteStore["changesSince"]>[0],
    options: Parameters<OhSqliteStore["changesSince"]>[1]):
    Effect.Effect<ReturnType<OhSqliteStore["changesSince"]>, SyncFailure>;
  updateSyncState(remoteId: string, state: Parameters<OhSqliteStore["updateSyncState"]>[1]):
    Effect.Effect<void, SyncFailure>;
}

export class SyncStore extends Context.Tag("@hraness/oh/SyncStore")<SyncStore, SyncStoreService>() {}

function storeCall<A>(operation: () => A): Effect.Effect<A, SyncFailure> {
  // The transaction body executes synchronously, without an Effect yield.
  return Effect.try({ try: operation, catch: (cause): SyncFailure => ({ _tag: "StoreFailure", cause }) });
}

function transportCall<A>(operation: () => Promise<A>): Effect.Effect<A, SyncFailure> {
  return Effect.tryPromise({ try: operation,
    catch: (cause): SyncFailure => ({ _tag: "TransportFailure", cause }) });
}

export function syncStoreLive(store: OhSqliteStore): Layer.Layer<SyncStore> {
  return Layer.succeed(SyncStore, {
    spaceId: store.spaceId,
    head: storeCall(() => store.head()),
    importOperations: (input) => storeCall(() => store.importOperations(input)),
    changesSince: (head, options) => storeCall(() => store.changesSince(head, options)),
    updateSyncState: (remoteId, state) => storeCall(() => store.updateSyncState(remoteId, state)),
  });
}

export function syncTransportLive(transport: OhOperationSyncTransportV1): Layer.Layer<SyncTransport> {
  return Layer.succeed(SyncTransport, {
    handshake: (manifest) => transportCall(() => transport.handshake(manifest)),
    head: (spaceId) => transportCall(() => transport.head(spaceId)),
    pull: (spaceId, afterSequence, limit) => transportCall(() => transport.pull(spaceId, afterSequence, limit)),
    push: (bundle) => transportCall(() => transport.push(bundle)),
  });
}

export interface LibSqlSyncClientService {
  execute(statement: LibSqlStatementV1 | string): Effect.Effect<LibSqlResultV1, SyncFailure>;
  batch(statements: LibSqlStatementV1[], mode: "deferred" | "read" | "write"):
    Effect.Effect<readonly LibSqlResultV1[], SyncFailure>;
}

export class LibSqlSyncClient extends Context.Tag("@hraness/oh/LibSqlSyncClient")<
  LibSqlSyncClient, LibSqlSyncClientService
>() {}

export function libSqlSyncClientLive(client: LibSqlClientV1): Layer.Layer<LibSqlSyncClient> {
  return Layer.succeed(LibSqlSyncClient, {
    execute: (statement) => transportCall(() => client.execute(statement)),
    batch: (statements, mode) => transportCall(() => client.batch(statements, mode)),
  });
}
