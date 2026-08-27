import { type Sha256Hex } from "./canonical";
import { type OhContractManifestV1 } from "./contract";
import { type OhOperationV1 } from "./operation";
import type { OhSqliteStore } from "./sqlite/store";
export declare const OH_SYNC_PROTOCOL_V1: "oh.sync.v1";
export type OhSyncHeadV1 = Readonly<{
    operationSha256: Sha256Hex | null;
    sequence: number;
    v: 1;
}>;
export type OhSyncBundleV1 = Readonly<{
    bundleSha256: Sha256Hex;
    contractSha256: Sha256Hex;
    operations: readonly OhOperationV1[];
    protocol: typeof OH_SYNC_PROTOCOL_V1;
    spaceId: string;
    v: 1;
}>;
export declare function createOhSyncBundleV1(spaceId: string, operations: readonly OhOperationV1[]): OhSyncBundleV1;
export declare function parseOhSyncBundleV1(value: unknown): OhSyncBundleV1 | null;
export interface OhOperationSyncTransportV1 {
    handshake(manifest: OhContractManifestV1): Promise<void>;
    head(spaceId: string): Promise<OhSyncHeadV1>;
    pull(spaceId: string, afterSequence: number, limit: number): Promise<OhSyncBundleV1>;
    push(bundle: OhSyncBundleV1): Promise<OhSyncHeadV1>;
}
export type OhSyncResultV1 = Readonly<{
    head: OhSyncHeadV1;
    pulled: number;
    pushed: number;
    rounds: number;
    v: 1;
}>;
/**
 * Reconciles only fast-forward histories. Concurrent heads fail closed and leave
 * both logs intact for an explicit merge operation.
 */
export declare function synchronizeOhStoreV1(store: OhSqliteStore, transport: OhOperationSyncTransportV1, options?: Readonly<{
    batchSize?: number;
    maximumRounds?: number;
    remoteId?: string;
}>): Promise<OhSyncResultV1>;
export type LibSqlValueV1 = ArrayBuffer | Date | Uint8Array | bigint | boolean | null | number | string;
export type LibSqlStatementV1 = {
    args?: LibSqlValueV1[];
    sql: string;
};
export type LibSqlResultV1 = Readonly<{
    rows: readonly (Readonly<Record<string, unknown>> | readonly unknown[])[];
}>;
export interface LibSqlClientV1 {
    execute(statement: LibSqlStatementV1 | string): Promise<LibSqlResultV1>;
    batch(statements: LibSqlStatementV1[], mode?: "deferred" | "read" | "write"): Promise<readonly LibSqlResultV1[]>;
}
/** A zero-dependency adapter for clients implementing @libsql/client's execute/batch shape. */
export declare function createLibSqlOperationSyncTransportV1(client: LibSqlClientV1): OhOperationSyncTransportV1;
//# sourceMappingURL=sync.d.ts.map