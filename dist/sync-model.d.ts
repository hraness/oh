import { type Sha256Hex } from "./canonical";
import { type OhContractManifestV1 } from "./contract";
import { type OhOperationV1 } from "./operation";
import type { OhHeadRefV1 } from "./store";
export declare const OH_SYNC_PROTOCOL_V1: "oh.sync.v1";
export type OhSyncHeadV1 = Readonly<{
    operationSha256: Sha256Hex | null;
    sequence: number;
    v: 1;
}>;
export declare const OH_SYNC_BUNDLE_MAX_OPERATIONS_V1 = 1000;
export declare const OH_SYNC_BUNDLE_MAX_BYTES_V1: number;
type SyncIngressBudgetV1 = {
    bytes: number;
    maximumBytes: number;
    maximumNodes: number;
    nodes: number;
};
export declare function syncIngressBundleBudgetV1(spaceId: string): SyncIngressBudgetV1;
export declare function parseOhSyncHeadRefV1(value: unknown): OhHeadRefV1 | null;
export declare function parseOhSyncHeadV1(value: unknown): OhSyncHeadV1 | null;
export type OhSyncBundleV1 = Readonly<{
    bundleSha256: Sha256Hex;
    contractSha256: Sha256Hex;
    operations: readonly OhOperationV1[];
    protocol: typeof OH_SYNC_PROTOCOL_V1;
    spaceId: string;
    v: 1;
}>;
export declare function createOhSyncBundleV1(spaceId: string, operations: readonly OhOperationV1[], options?: Readonly<{
    largestFittingPrefix?: boolean;
}>): OhSyncBundleV1;
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
export {};
//# sourceMappingURL=sync-model.d.ts.map