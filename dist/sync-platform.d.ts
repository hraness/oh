import { Context, Effect, Layer } from "effect";
import type { OhSqliteStore } from "./sqlite/store";
import type { LibSqlClientV1, LibSqlResultV1, LibSqlStatementV1, OhOperationSyncTransportV1, OhSyncBundleV1, OhSyncHeadV1 } from "./sync-model";
import type { OhContractManifestV1 } from "./contract";
export type SyncFailure = Readonly<{
    _tag: "StoreFailure" | "TransportFailure" | "ValidationFailure" | "SyncConflict" | "RoundLimit";
    /** Original rejection identity is retained only at the public boundary. */
    cause: unknown;
}>;
export declare function syncInvalid(cause: unknown): SyncFailure;
export interface SyncTransportService {
    handshake(manifest: OhContractManifestV1): Effect.Effect<void, SyncFailure>;
    head(spaceId: string): Effect.Effect<OhSyncHeadV1, SyncFailure>;
    pull(spaceId: string, afterSequence: number, limit: number): Effect.Effect<OhSyncBundleV1, SyncFailure>;
    push(bundle: OhSyncBundleV1): Effect.Effect<OhSyncHeadV1, SyncFailure>;
}
declare const SyncTransport_base: Context.TagClass<SyncTransport, "@hraness/oh/SyncTransport", SyncTransportService>;
export declare class SyncTransport extends SyncTransport_base {
}
export interface SyncStoreService {
    readonly spaceId: string;
    readonly head: Effect.Effect<ReturnType<OhSqliteStore["head"]>, SyncFailure>;
    importOperations(input: Parameters<OhSqliteStore["importOperations"]>[0]): Effect.Effect<ReturnType<OhSqliteStore["importOperations"]>, SyncFailure>;
    changesSince(head: Parameters<OhSqliteStore["changesSince"]>[0], options: Parameters<OhSqliteStore["changesSince"]>[1]): Effect.Effect<ReturnType<OhSqliteStore["changesSince"]>, SyncFailure>;
    updateSyncState(remoteId: string, state: Parameters<OhSqliteStore["updateSyncState"]>[1]): Effect.Effect<void, SyncFailure>;
}
declare const SyncStore_base: Context.TagClass<SyncStore, "@hraness/oh/SyncStore", SyncStoreService>;
export declare class SyncStore extends SyncStore_base {
}
export declare function syncStoreLive(store: OhSqliteStore): Layer.Layer<SyncStore>;
export declare function syncTransportLive(transport: OhOperationSyncTransportV1): Layer.Layer<SyncTransport>;
export interface LibSqlSyncClientService {
    execute(statement: LibSqlStatementV1 | string): Effect.Effect<LibSqlResultV1, SyncFailure>;
    batch(statements: LibSqlStatementV1[], mode: "deferred" | "read" | "write"): Effect.Effect<readonly LibSqlResultV1[], SyncFailure>;
}
declare const LibSqlSyncClient_base: Context.TagClass<LibSqlSyncClient, "@hraness/oh/LibSqlSyncClient", LibSqlSyncClientService>;
export declare class LibSqlSyncClient extends LibSqlSyncClient_base {
}
export declare function libSqlSyncClientLive(client: LibSqlClientV1): Layer.Layer<LibSqlSyncClient>;
export {};
//# sourceMappingURL=sync-platform.d.ts.map