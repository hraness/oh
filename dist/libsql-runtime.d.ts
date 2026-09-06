import type { OhLibSqlClientV1, OhLibSqlStoreAuthorityOptionsV1 } from "./libsql-model";
import type { OhStoreAuthorityV1, OhSpacePurgeReceiptV1 } from "./store";
export declare function bootstrapOhLibSqlAuthorityV1(client: OhLibSqlClientV1): Promise<Readonly<{
    schemaSha256: import("./canonical").Sha256Hex;
    schemaVersion: 1;
    v: 1;
}>>;
export declare function createOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1, options?: OhLibSqlStoreAuthorityOptionsV1): Promise<OhStoreAuthorityV1>;
export declare function openExistingOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1, options?: OhLibSqlStoreAuthorityOptionsV1): Promise<OhStoreAuthorityV1>;
export declare function purgeOhLibSqlWorkingSpaceV1(client: OhLibSqlClientV1, options?: OhLibSqlStoreAuthorityOptionsV1 & Readonly<{
    purgedAt?: string;
}>): Promise<OhSpacePurgeReceiptV1>;
//# sourceMappingURL=libsql-runtime.d.ts.map