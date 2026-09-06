import type { OhSqliteStore } from "./sqlite/store";
import type { LibSqlClientV1, OhOperationSyncTransportV1, OhSyncResultV1 } from "./sync-model";
import { type SyncOptions } from "./sync-program";
export declare function runSyncBoundary(store: OhSqliteStore, transport: OhOperationSyncTransportV1, options: SyncOptions): Promise<OhSyncResultV1>;
export declare function makeLibSqlSyncBoundary(client: LibSqlClientV1): OhOperationSyncTransportV1;
//# sourceMappingURL=sync-runtime.d.ts.map