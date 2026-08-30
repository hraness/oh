import { type Sha256Hex } from "./canonical";
import { type OhStoreAuthorityV1, type OhStoreProfileV1 } from "./store";
export type OhLibSqlValueV1 = ArrayBuffer | Date | Uint8Array | bigint | boolean | null | number | string;
export type OhLibSqlStatementV1 = Readonly<{
    args?: readonly OhLibSqlValueV1[];
    sql: string;
}>;
export type OhLibSqlResultV1 = Readonly<{
    rows: readonly (Readonly<Record<string, unknown>> | readonly unknown[])[];
    rowsAffected?: number;
}>;
/** Structural subset implemented by `@libsql/client` clients. */
export interface OhLibSqlClientV1 {
    batch(statements: readonly OhLibSqlStatementV1[], mode?: "deferred" | "read" | "write"): Promise<readonly OhLibSqlResultV1[]>;
    close?(): void;
    execute(statement: OhLibSqlStatementV1 | string): Promise<OhLibSqlResultV1>;
}
export type OhLibSqlStoreAuthorityOptionsV1 = Readonly<{
    closeClient?: boolean;
    profile?: OhStoreProfileV1;
    realmId?: string;
    spaceId?: string;
}>;
export declare const OH_LIBSQL_STORE_LIMITS_V1: Readonly<{
    changesPerCommit: 64;
    changeFeedLimit: 7;
    dependenciesPerCommit: 512;
    historyBytes: number;
    historyOperations: 16384;
    operationBytes: number;
    providerResponseBytes: 9000000;
    snapshotComponentBytes: number;
}>;
/** One-time schema operation for a client authorized to create authority tables. */
export declare function bootstrapOhLibSqlAuthorityV1(client: OhLibSqlClientV1): Promise<Readonly<{
    schemaSha256: Sha256Hex;
    schemaVersion: 1;
    v: 1;
}>>;
/** Opens a direct libSQL/Turso authority; this is not operation-log sync. */
export declare function createOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1, options?: OhLibSqlStoreAuthorityOptionsV1): Promise<OhStoreAuthorityV1>;
/**
 * Opens an already-bound direct libSQL/Turso authority without creating or
 * updating data. This seam is for separately held read or purge custody that
 * must fail closed instead of acquiring space-creation authority.
 */
export declare function openExistingOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1, options?: OhLibSqlStoreAuthorityOptionsV1): Promise<OhStoreAuthorityV1>;
//# sourceMappingURL=libsql.d.ts.map