import type { OhLibSqlClientV1, OhLibSqlStoreAuthorityOptionsV1 } from "./libsql-model";
import type { Sha256Hex } from "./canonical";
import type { OhStoreAuthorityV1, OhSpacePurgeReceiptV1 } from "./store";
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
export type { OhLibSqlClientV1, OhLibSqlResultV1, OhLibSqlStatementV1, OhLibSqlStoreAuthorityOptionsV1, OhLibSqlValueV1 } from "./libsql-model";
export declare function bootstrapOhLibSqlAuthorityV1(client: OhLibSqlClientV1): Promise<Readonly<{
    schemaSha256: Sha256Hex;
    schemaVersion: 1;
    v: 1;
}>>;
export declare function createOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1, options?: OhLibSqlStoreAuthorityOptionsV1): Promise<OhStoreAuthorityV1>;
export declare function openExistingOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1, options?: OhLibSqlStoreAuthorityOptionsV1): Promise<OhStoreAuthorityV1>;
export declare function purgeOhLibSqlWorkingSpaceV1(client: OhLibSqlClientV1, options?: OhLibSqlStoreAuthorityOptionsV1 & Readonly<{
    purgedAt?: string;
}>): Promise<OhSpacePurgeReceiptV1>;
//# sourceMappingURL=libsql.d.ts.map