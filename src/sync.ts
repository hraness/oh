import type { OhSqliteStore } from "./sqlite/store";
import type { LibSqlClientV1, OhOperationSyncTransportV1, OhSyncResultV1 } from "./sync-model";
import { makeLibSqlSyncBoundary, runSyncBoundary } from "./sync-runtime";

export { OH_SYNC_PROTOCOL_V1, OH_SYNC_BUNDLE_MAX_BYTES_V1, createOhSyncBundleV1,
  parseOhSyncHeadRefV1, parseOhSyncHeadV1, parseOhSyncBundleV1 } from "./sync-model";
export type { OhSyncHeadV1, OhSyncBundleV1, OhOperationSyncTransportV1, OhSyncResultV1,
  LibSqlValueV1, LibSqlStatementV1, LibSqlResultV1, LibSqlClientV1 } from "./sync-model";

/** Reconciles only fast-forward histories and preserves the original Promise boundary. */
export async function synchronizeOhStoreV1(
  store: OhSqliteStore,
  transport: OhOperationSyncTransportV1,
  options: Readonly<{ batchSize?: number; maximumRounds?: number; remoteId?: string }> = {},
): Promise<OhSyncResultV1> {
  return await runSyncBoundary(store, transport, options);
}

/** Bundled-runtime adapter for clients implementing @libsql/client's execute/batch shape. */
export function createLibSqlOperationSyncTransportV1(client: LibSqlClientV1): OhOperationSyncTransportV1 {
  return makeLibSqlSyncBoundary(client);
}
