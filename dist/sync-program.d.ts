import { Effect } from "effect";
import { type OhSyncResultV1 } from "./sync-model";
import { SyncStore, SyncTransport, type SyncFailure } from "./sync-platform";
export type SyncOptions = Readonly<{
    batchSize?: number;
    maximumRounds?: number;
    remoteId?: string;
}>;
/** Only the store adapter can enter the synchronous SQLite transaction. */
export declare function synchronize(options?: SyncOptions): Effect.Effect<OhSyncResultV1, SyncFailure, SyncStore | SyncTransport>;
//# sourceMappingURL=sync-program.d.ts.map