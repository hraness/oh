/** Direct libSQL/Turso store authority. Promise and canonical DTO surfaces remain stable. */
import { OH_LIBSQL_STORE_LIMITS_V1 as limits } from "./libsql-model";
import type { OhLibSqlClientV1, OhLibSqlStoreAuthorityOptionsV1 } from "./libsql-model";
import type { Sha256Hex } from "./canonical";
import type { OhStoreAuthorityV1, OhSpacePurgeReceiptV1 } from "./store";
import {
  bootstrapOhLibSqlAuthorityV1 as bootstrap,
  createOhLibSqlStoreAuthorityV1 as createAuthority,
  openExistingOhLibSqlStoreAuthorityV1 as openAuthority,
  purgeOhLibSqlWorkingSpaceV1 as purge,
} from "./libsql-runtime";

export const OH_LIBSQL_STORE_LIMITS_V1 = limits;
export type { OhLibSqlClientV1, OhLibSqlResultV1, OhLibSqlStatementV1,
  OhLibSqlStoreAuthorityOptionsV1, OhLibSqlValueV1 } from "./libsql-model";

export async function bootstrapOhLibSqlAuthorityV1(client: OhLibSqlClientV1):
  Promise<Readonly<{ schemaSha256: Sha256Hex; schemaVersion: 1; v: 1 }>> {
  return await bootstrap(client);
}

export async function createOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1,
  options: OhLibSqlStoreAuthorityOptionsV1 = {}): Promise<OhStoreAuthorityV1> {
  return await createAuthority(client, options);
}

export async function openExistingOhLibSqlStoreAuthorityV1(client: OhLibSqlClientV1,
  options: OhLibSqlStoreAuthorityOptionsV1 = {}): Promise<OhStoreAuthorityV1> {
  return await openAuthority(client, options);
}

export async function purgeOhLibSqlWorkingSpaceV1(client: OhLibSqlClientV1,
  options: OhLibSqlStoreAuthorityOptionsV1 & Readonly<{ purgedAt?: string }> = {}):
  Promise<OhSpacePurgeReceiptV1> {
  return await purge(client, options);
}
