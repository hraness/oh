import { type Sha256Hex } from "./canonical";
import { type OhOperationV1 } from "./operation";
import { type OhHeadV1, type OhSpacePurgeReceiptV1, type OhStoreBindingV1, type OhStoreProfileV1 } from "./store";
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
export declare const AUTHORITY_SCHEMA_NAME = "oh.libsql-authority.v1";
export declare const AUTHORITY_SCHEMA_VERSION = 1;
export declare const EMPTY_RECORDS_SHA256: Sha256Hex;
export declare const PURGE_ROW_SELECT = "SELECT space_id, binding_sha256, prior_operation_sha256,\n  prior_sequence, purged_at, receipt_sha256, receipt_json\n  FROM oh_authority_purges WHERE space_id = ?";
export declare const BINDING_ROW_SELECT = "SELECT space_id, realm_id, profile_id, profile_kind,\n  profile_sha256, binding_sha256, binding_json FROM oh_authority_bindings WHERE space_id = ?";
export declare const SPACE_PURGE_PROOF_SELECT = "SELECT generation, graph_revision_sha256, head_operation_sha256,\n  records_sha256, sequence, contract_id FROM oh_authority_spaces WHERE space_id = ?";
export declare const OPERATION_ROW_COLUMNS = "operation_sha256, space_id, sequence, operation_id,\n  parent_operation_sha256, graph_revision_sha256, records_sha256, operation_json, instant";
export declare const OPERATION_RESPONSE_BYTES = "2 * length(CAST(operation.operation_json AS BLOB))\n  + 2 * (length(operation.operation_sha256) + length(operation.space_id)\n    + length(operation.operation_id) + coalesce(length(operation.parent_operation_sha256), 0)\n    + length(operation.graph_revision_sha256) + length(operation.records_sha256)\n    + length(operation.instant)) + 512";
export declare const RECORD_RESPONSE_BYTES = "2 * length(CAST(record.record_json AS BLOB))\n  + 2 * (length(record.record_key) + length(record.kind) + length(record.record_sha256)\n    + length(record.operation_sha256)) + 384";
export declare const DEPENDENCY_RESPONSE_BYTES = "2 * (length(dependency.record_key)\n  + length(dependency.dependency_key)) + 192";
export declare const OPERATION_RECORD_RESPONSE_BYTES = "2 * (length(materialized.space_id)\n  + length(materialized.operation_sha256) + length(materialized.record_key)\n  + length(materialized.change_kind) + length(materialized.record_sha256)) + 320";
export declare const AUTHORITY_SCHEMA_TABLE_STATEMENT = "CREATE TABLE IF NOT EXISTS oh_authority_schemas (\n  version INTEGER PRIMARY KEY,\n  name TEXT NOT NULL UNIQUE,\n  schema_sha256 TEXT NOT NULL,\n  applied_at TEXT NOT NULL\n) STRICT";
export declare const AUTHORITY_SCHEMA_STATEMENTS: readonly string[];
export declare function normalizedSchemaSql(sql: string): string;
export declare function expectedSchemaObject(statement: string): Readonly<{
    name: string;
    sql: string;
    tableName: string;
    type: "index" | "table" | "trigger";
}>;
export declare const AUTHORITY_SCHEMA_OBJECTS: readonly Readonly<{
    name: string;
    sql: string;
    tableName: string;
    type: "index" | "table" | "trigger";
}>[];
export declare const AUTHORITY_SCHEMA_SHA256: Sha256Hex;
export declare function rowValue(row: Readonly<Record<string, unknown>> | readonly unknown[], key: string, index: number): unknown;
export declare function integer(value: unknown): number | null;
export declare function normalizeLimit(value: number | undefined, fallback?: number, maximum?: number): number;
export declare function parseOperationJson(value: unknown): OhOperationV1;
export declare function parseOperationRow(row: Readonly<Record<string, unknown>> | readonly unknown[], expected?: Readonly<{
    operationId?: string;
    operationSha256?: string;
    spaceId?: string;
}>): OhOperationV1;
export declare function parseBindingRow(row: Readonly<Record<string, unknown>> | readonly unknown[], expectedSpaceId: string): OhStoreBindingV1;
export declare function parsePurgeReceiptRow(row: Readonly<Record<string, unknown>> | readonly unknown[], expectedSpaceId: string, expectedBindingSha256?: Sha256Hex): OhSpacePurgeReceiptV1;
export declare function parseHeadRow(row: Readonly<Record<string, unknown>> | readonly unknown[]): OhHeadV1;
export declare const PURGE_PAYLOAD_TABLES: readonly ["oh_authority_spaces", "oh_authority_bindings", "oh_authority_operations", "oh_authority_operation_records", "oh_authority_records", "oh_authority_dependencies"];
//# sourceMappingURL=libsql-model.d.ts.map