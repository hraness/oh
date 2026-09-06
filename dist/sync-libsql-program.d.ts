import { Effect } from "effect";
import { LibSqlSyncClient, type SyncTransportService } from "./sync-platform";
/** A shared initialization attempt retains its result for every admitted waiter. */
export declare const makeLibSqlSyncTransport: Effect.Effect<SyncTransportService, never, LibSqlSyncClient>;
//# sourceMappingURL=sync-libsql-program.d.ts.map