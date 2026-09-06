import { canonicalJson, canonicalSha256, parseSha256Hex, type Sha256Hex } from "./canonical";

import { parseOhOperationV1, type OhOperationV1 } from "./operation";
import {
  OhIntegrityError,
  parseOhSpacePurgeReceiptV1,
  parseOhStoreBindingV1,
  type OhHeadV1,
  type OhSpacePurgeReceiptV1,
  type OhStoreBindingV1,
  type OhStoreProfileV1,
} from "./store";

export type OhLibSqlValueV1 = ArrayBuffer | Date | Uint8Array | bigint | boolean | null | number | string;
export type OhLibSqlStatementV1 = Readonly<{ args?: readonly OhLibSqlValueV1[]; sql: string }>;
export type OhLibSqlResultV1 = Readonly<{
  rows: readonly (Readonly<Record<string, unknown>> | readonly unknown[])[];
  rowsAffected?: number;
}>;

/** Structural subset implemented by `@libsql/client` clients. */
export interface OhLibSqlClientV1 {
  batch(
    statements: readonly OhLibSqlStatementV1[],
    mode?: "deferred" | "read" | "write",
  ): Promise<readonly OhLibSqlResultV1[]>;
  close?(): void;
  execute(statement: OhLibSqlStatementV1 | string): Promise<OhLibSqlResultV1>;
}

export type OhLibSqlStoreAuthorityOptionsV1 = Readonly<{
  closeClient?: boolean;
  profile?: OhStoreProfileV1;
  realmId?: string;
  spaceId?: string;
}>;

export const OH_LIBSQL_STORE_LIMITS_V1 = Object.freeze({
  changesPerCommit: 64,
  changeFeedLimit: 7,
  dependenciesPerCommit: 512,
  historyBytes: 4 * 1024 * 1024,
  historyOperations: 16_384,
  operationBytes: 512 * 1024,
  providerResponseBytes: 9_000_000,
  snapshotComponentBytes: 6 * 1024 * 1024,
});

export const AUTHORITY_SCHEMA_NAME = "oh.libsql-authority.v1";
export const AUTHORITY_SCHEMA_VERSION = 1;
export const EMPTY_RECORDS_SHA256 = canonicalSha256([]);
export const PURGE_ROW_SELECT = `SELECT space_id, binding_sha256, prior_operation_sha256,
  prior_sequence, purged_at, receipt_sha256, receipt_json
  FROM oh_authority_purges WHERE space_id = ?`;
export const BINDING_ROW_SELECT = `SELECT space_id, realm_id, profile_id, profile_kind,
  profile_sha256, binding_sha256, binding_json FROM oh_authority_bindings WHERE space_id = ?`;
export const SPACE_PURGE_PROOF_SELECT = `SELECT generation, graph_revision_sha256, head_operation_sha256,
  records_sha256, sequence, contract_id FROM oh_authority_spaces WHERE space_id = ?`;
export const OPERATION_ROW_COLUMNS = `operation_sha256, space_id, sequence, operation_id,
  parent_operation_sha256, graph_revision_sha256, records_sha256, operation_json, instant`;
// libSQL serializes text again in its JSON response. Twice the UTF-8 text plus all
// duplicated columns and a fixed row reserve is a conservative upper bound for
// canonical JSON, whose own escapes can only be escaped once more by transport.
export const OPERATION_RESPONSE_BYTES = `2 * length(CAST(operation.operation_json AS BLOB))
  + 2 * (length(operation.operation_sha256) + length(operation.space_id)
    + length(operation.operation_id) + coalesce(length(operation.parent_operation_sha256), 0)
    + length(operation.graph_revision_sha256) + length(operation.records_sha256)
    + length(operation.instant)) + 512`;
export const RECORD_RESPONSE_BYTES = `2 * length(CAST(record.record_json AS BLOB))
  + 2 * (length(record.record_key) + length(record.kind) + length(record.record_sha256)
    + length(record.operation_sha256)) + 384`;
export const DEPENDENCY_RESPONSE_BYTES = `2 * (length(dependency.record_key)
  + length(dependency.dependency_key)) + 192`;
export const OPERATION_RECORD_RESPONSE_BYTES = `2 * (length(materialized.space_id)
  + length(materialized.operation_sha256) + length(materialized.record_key)
  + length(materialized.change_kind) + length(materialized.record_sha256)) + 320`;

export const AUTHORITY_SCHEMA_TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS oh_authority_schemas (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;

export const AUTHORITY_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS oh_authority_contracts (
    contract_id TEXT PRIMARY KEY,
    contract_sha256 TEXT NOT NULL,
    manifest_json TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_spaces (
    space_id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    head_operation_sha256 TEXT,
    graph_revision_sha256 TEXT,
    records_sha256 TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(generation = sequence)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_operations (
    operation_sha256 TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    operation_id TEXT NOT NULL,
    parent_operation_sha256 TEXT,
    graph_revision_sha256 TEXT NOT NULL,
    records_sha256 TEXT NOT NULL,
    operation_json TEXT NOT NULL,
    instant TEXT NOT NULL,
    UNIQUE(space_id, sequence),
    UNIQUE(space_id, operation_id)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_operation_records (
    space_id TEXT NOT NULL,
    operation_sha256 TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    record_key TEXT NOT NULL,
    change_kind TEXT NOT NULL CHECK(change_kind IN ('put', 'tombstone')),
    record_sha256 TEXT NOT NULL,
    PRIMARY KEY(operation_sha256, ordinal),
    UNIQUE(operation_sha256, record_key)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_records (
    space_id TEXT NOT NULL,
    record_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    record_sha256 TEXT NOT NULL,
    record_json TEXT NOT NULL,
    operation_sha256 TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    PRIMARY KEY(space_id, record_key)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_dependencies (
    space_id TEXT NOT NULL,
    record_key TEXT NOT NULL,
    dependency_key TEXT NOT NULL,
    PRIMARY KEY(space_id, record_key, dependency_key)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_bindings (
    space_id TEXT PRIMARY KEY,
    realm_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    profile_kind TEXT NOT NULL CHECK(profile_kind IN ('canonical', 'working')),
    profile_sha256 TEXT NOT NULL,
    binding_sha256 TEXT NOT NULL UNIQUE,
    binding_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_purges (
    space_id TEXT PRIMARY KEY,
    binding_sha256 TEXT NOT NULL,
    prior_operation_sha256 TEXT,
    prior_sequence INTEGER NOT NULL CHECK(prior_sequence >= 0),
    purged_at TEXT NOT NULL,
    receipt_sha256 TEXT NOT NULL UNIQUE,
    receipt_json TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_commit_guards (
    value TEXT NOT NULL CHECK(value = 'ok')
  ) STRICT`,
  "CREATE INDEX IF NOT EXISTS oh_authority_operations_space_sequence ON oh_authority_operations(space_id, sequence)",
  "CREATE INDEX IF NOT EXISTS oh_authority_records_space_kind ON oh_authority_records(space_id, kind, record_key)",
  "CREATE INDEX IF NOT EXISTS oh_authority_dependencies_dependency ON oh_authority_dependencies(space_id, dependency_key)",
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operations_no_update
    BEFORE UPDATE ON oh_authority_operations
    BEGIN SELECT RAISE(ABORT, 'Oh authority operations are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operations_guard_delete
    BEFORE DELETE ON oh_authority_operations
    WHEN NOT EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = OLD.space_id)
    BEGIN SELECT RAISE(ABORT, 'Oh authority operations require a purge receipt'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operation_records_no_update
    BEFORE UPDATE ON oh_authority_operation_records
    BEGIN SELECT RAISE(ABORT, 'Oh authority operation records are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operation_records_guard_insert
    BEFORE INSERT ON oh_authority_operation_records
    WHEN NOT EXISTS (SELECT 1 FROM oh_authority_operations
      WHERE operation_sha256 = NEW.operation_sha256 AND space_id = NEW.space_id)
    BEGIN SELECT RAISE(ABORT, 'Oh authority operation record has no owning operation'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operation_records_guard_delete
    BEFORE DELETE ON oh_authority_operation_records
    WHEN NOT EXISTS (SELECT 1 FROM oh_authority_operations AS operation
      JOIN oh_authority_purges AS purge ON purge.space_id = operation.space_id
      WHERE operation.operation_sha256 = OLD.operation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh authority operation records require a purge receipt'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_purges_immutable_update
    BEFORE UPDATE ON oh_authority_purges
    BEGIN SELECT RAISE(ABORT, 'Oh authority purge receipts are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_purges_immutable_delete
    BEFORE DELETE ON oh_authority_purges
    BEGIN SELECT RAISE(ABORT, 'Oh authority purge receipts are immutable'); END`,
]);

export function normalizedSchemaSql(sql: string): string {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\b/giu, "").replace(/\s+/gu, " ").trim();
}

export function expectedSchemaObject(statement: string): Readonly<{
  name: string;
  sql: string;
  tableName: string;
  type: "index" | "table" | "trigger";
}> {
  const match = /^CREATE\s+(TABLE|INDEX|TRIGGER)(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z0-9_]+)/iu.exec(statement.trim());
  if (match === null) throw new Error("Invalid compiled authority schema statement.");
  const declaredType = match[1]?.toLowerCase();
  const type = declaredType === "index" ? "index" as const
    : declaredType === "trigger" ? "trigger" as const : "table" as const;
  const name = match[2] as string;
  const tableMatch = type === "index" || type === "trigger" ? /\bON\s+([a-z0-9_]+)/iu.exec(statement) : null;
  const tableName = type === "table" ? name : tableMatch?.[1];
  if (tableName === undefined) throw new Error("Invalid compiled authority index statement.");
  return { name, sql: normalizedSchemaSql(statement), tableName, type };
}

export const AUTHORITY_SCHEMA_OBJECTS = Object.freeze(
  [AUTHORITY_SCHEMA_TABLE_STATEMENT, ...AUTHORITY_SCHEMA_STATEMENTS]
    .map(expectedSchemaObject)
    .sort((left, right) => canonicalJson([left.type, left.name])
      .localeCompare(canonicalJson([right.type, right.name]))),
);
export const AUTHORITY_SCHEMA_SHA256 = canonicalSha256(AUTHORITY_SCHEMA_OBJECTS);

export function rowValue(
  row: Readonly<Record<string, unknown>> | readonly unknown[],
  key: string,
  index: number,
): unknown {
  return Array.isArray(row) ? row[index] : (row as Readonly<Record<string, unknown>>)[key];
}

export function integer(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeLimit(value: number | undefined, fallback = 100, maximum = 1000): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new RangeError(`limit must be an integer from 1 through ${maximum}.`);
  }
  return limit;
}

export function parseOperationJson(value: unknown): OhOperationV1 {
  if (typeof value !== "string") throw new OhIntegrityError("A stored operation is not JSON text.");
  let parsedValue: unknown;
  try { parsedValue = JSON.parse(value); } catch { throw new OhIntegrityError("A stored operation is not JSON."); }
  const operation = parseOhOperationV1(parsedValue);
  if (operation === null || canonicalJson(operation) !== value) {
    throw new OhIntegrityError("A stored operation is invalid.");
  }
  return operation;
}

export function parseOperationRow(
  row: Readonly<Record<string, unknown>> | readonly unknown[],
  expected: Readonly<{ operationId?: string; operationSha256?: string; spaceId?: string }> = {},
): OhOperationV1 {
  const operation = parseOperationJson(rowValue(row, "operation_json", 7));
  if (rowValue(row, "operation_sha256", 0) !== operation.operationSha256
    || rowValue(row, "space_id", 1) !== operation.spaceId
    || integer(rowValue(row, "sequence", 2)) !== operation.sequence
    || rowValue(row, "operation_id", 3) !== operation.operationId
    || rowValue(row, "parent_operation_sha256", 4) !== operation.parentOperationSha256
    || rowValue(row, "graph_revision_sha256", 5) !== operation.graphRevisionSha256
    || rowValue(row, "records_sha256", 6) !== operation.recordsSha256
    || rowValue(row, "instant", 8) !== operation.instant
    || (expected.spaceId !== undefined && operation.spaceId !== expected.spaceId)
    || (expected.operationId !== undefined && operation.operationId !== expected.operationId)
    || (expected.operationSha256 !== undefined && operation.operationSha256 !== expected.operationSha256)) {
    throw new OhIntegrityError("Remote operation columns do not match their canonical envelope.");
  }
  return operation;
}

export function parseBindingRow(
  row: Readonly<Record<string, unknown>> | readonly unknown[],
  expectedSpaceId: string,
): OhStoreBindingV1 {
  const json = rowValue(row, "binding_json", 6);
  if (typeof json !== "string") throw new OhIntegrityError("A remote store binding is not JSON text.");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new OhIntegrityError("A remote store binding is not JSON."); }
  const binding = parseOhStoreBindingV1(value);
  if (binding === null || canonicalJson(binding) !== json || binding.spaceId !== expectedSpaceId
    || rowValue(row, "space_id", 0) !== binding.spaceId
    || rowValue(row, "realm_id", 1) !== binding.realmId
    || rowValue(row, "profile_id", 2) !== binding.profile.profileId
    || rowValue(row, "profile_kind", 3) !== binding.profile.profileKind
    || rowValue(row, "profile_sha256", 4) !== binding.profile.profileSha256
    || rowValue(row, "binding_sha256", 5) !== binding.bindingSha256) {
    throw new OhIntegrityError("Remote binding columns do not match their canonical envelope.");
  }
  return binding;
}

export function parsePurgeReceiptRow(
  row: Readonly<Record<string, unknown>> | readonly unknown[],
  expectedSpaceId: string,
  expectedBindingSha256?: Sha256Hex,
): OhSpacePurgeReceiptV1 {
  const json = rowValue(row, "receipt_json", 6);
  if (typeof json !== "string") throw new OhIntegrityError("A remote purge receipt is invalid.");
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new OhIntegrityError("A remote purge receipt is invalid."); }
  const receipt = parseOhSpacePurgeReceiptV1(value);
  if (receipt === null || canonicalJson(receipt) !== json) {
    throw new OhIntegrityError("A remote purge receipt is invalid.");
  }
  if (receipt.spaceId !== expectedSpaceId
    || (expectedBindingSha256 !== undefined && receipt.bindingSha256 !== expectedBindingSha256)
    || rowValue(row, "space_id", 0) !== receipt.spaceId
    || rowValue(row, "binding_sha256", 1) !== receipt.bindingSha256
    || rowValue(row, "prior_operation_sha256", 2) !== receipt.priorHead.operationSha256
    || integer(rowValue(row, "prior_sequence", 3)) !== receipt.priorHead.sequence
    || rowValue(row, "purged_at", 4) !== receipt.purgedAt
    || rowValue(row, "receipt_sha256", 5) !== receipt.receiptSha256) {
    throw new OhIntegrityError("Remote purge columns do not match their canonical receipt.");
  }
  return receipt;
}

export function parseHeadRow(row: Readonly<Record<string, unknown>> | readonly unknown[]): OhHeadV1 {
  const generation = integer(rowValue(row, "generation", 0));
  const graphValue = rowValue(row, "graph_revision_sha256", 1);
  const operationValue = rowValue(row, "head_operation_sha256", 2);
  const recordsSha256 = parseSha256Hex(rowValue(row, "records_sha256", 3));
  const sequence = integer(rowValue(row, "sequence", 4));
  const graphRevisionSha256 = graphValue === null ? null : parseSha256Hex(graphValue);
  const operationSha256 = operationValue === null ? null : parseSha256Hex(operationValue);
  if (generation === null || sequence === null || generation !== sequence || recordsSha256 === null
    || (graphValue !== null && graphRevisionSha256 === null)
    || (operationValue !== null && operationSha256 === null)
    || ((sequence === 0) !== (operationSha256 === null))
    || ((sequence === 0) !== (graphRevisionSha256 === null))) {
    throw new OhIntegrityError("The remote authority contains an invalid head.");
  }
  return { generation, graphRevisionSha256, operationSha256, recordsSha256, sequence, v: 1 };
}

export const PURGE_PAYLOAD_TABLES = ["oh_authority_spaces", "oh_authority_bindings",
  "oh_authority_operations", "oh_authority_operation_records", "oh_authority_records",
  "oh_authority_dependencies"] as const;
