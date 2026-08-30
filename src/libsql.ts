import {
  canonicalJson,
  canonicalNow,
  canonicalSha256,
  parseSha256Hex,
  safeCode,
  utf8ByteLength,
  type Sha256Hex,
} from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import { canonicalKnowledgeGraphChangesV1, knowledgeGraphRecordRefV1, OH_GRAPH_LIMITS_V1,
  parseKnowledgeGraphRecordV1,
  type KnowledgeGraphRecordV1 } from "./graph";
import { parseOhOperationV1, type OhOperationV1 } from "./operation";
import {
  createOhDependencyClosureV1,
  createOhSpacePurgeReceiptV1,
  createOhStoreBindingV1,
  emptyOhHeadV1,
  OH_CANONICAL_STORE_PROFILE_V1,
  OhConflictError,
  OhIntegrityError,
  OhProfileError,
  OhPurgedSpaceError,
  parseOhHeadRefV1,
  parseOhSpacePurgeReceiptV1,
  parseOhStoreBindingV1,
  parseOhStoreProfileV1,
  replayOhOperationsV1,
  transitionOhSnapshotV1,
  type OhChangesPageV1,
  type OhCommitInputV1,
  type OhDependencyClosureV1,
  type OhHeadRefV1,
  type OhHeadV1,
  type OhSnapshotV1,
  type OhSpacePurgeReceiptV1,
  type OhStoreAuthorityV1,
  type OhStoreBindingV1,
  type OhStoreHostControlV1,
  type OhStoreProfileV1,
  type OhStoreV1,
  type OhStoreVerificationV1,
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

const AUTHORITY_SCHEMA_NAME = "oh.libsql-authority.v1";
const AUTHORITY_SCHEMA_VERSION = 1;
const EMPTY_RECORDS_SHA256 = canonicalSha256([]);
const PURGE_ROW_SELECT = `SELECT space_id, binding_sha256, prior_operation_sha256,
  prior_sequence, purged_at, receipt_sha256, receipt_json
  FROM oh_authority_purges WHERE space_id = ?`;
const BINDING_ROW_SELECT = `SELECT space_id, realm_id, profile_id, profile_kind,
  profile_sha256, binding_sha256, binding_json FROM oh_authority_bindings WHERE space_id = ?`;
const OPERATION_ROW_COLUMNS = `operation_sha256, space_id, sequence, operation_id,
  parent_operation_sha256, graph_revision_sha256, records_sha256, operation_json, instant`;
// libSQL serializes text again in its JSON response. Twice the UTF-8 text plus all
// duplicated columns and a fixed row reserve is a conservative upper bound for
// canonical JSON, whose own escapes can only be escaped once more by transport.
const OPERATION_RESPONSE_BYTES = `2 * length(CAST(operation.operation_json AS BLOB))
  + 2 * (length(operation.operation_sha256) + length(operation.space_id)
    + length(operation.operation_id) + coalesce(length(operation.parent_operation_sha256), 0)
    + length(operation.graph_revision_sha256) + length(operation.records_sha256)
    + length(operation.instant)) + 512`;
const RECORD_RESPONSE_BYTES = `2 * length(CAST(record.record_json AS BLOB))
  + 2 * (length(record.record_key) + length(record.kind) + length(record.record_sha256)
    + length(record.operation_sha256)) + 384`;
const DEPENDENCY_RESPONSE_BYTES = `2 * (length(dependency.record_key)
  + length(dependency.dependency_key)) + 192`;
const OPERATION_RECORD_RESPONSE_BYTES = `2 * (length(materialized.space_id)
  + length(materialized.operation_sha256) + length(materialized.record_key)
  + length(materialized.change_kind) + length(materialized.record_sha256)) + 320`;

const AUTHORITY_SCHEMA_TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS oh_authority_schemas (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;

const AUTHORITY_SCHEMA_STATEMENTS = Object.freeze([
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

function normalizedSchemaSql(sql: string): string {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\b/giu, "").replace(/\s+/gu, " ").trim();
}

function expectedSchemaObject(statement: string): Readonly<{
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

const AUTHORITY_SCHEMA_OBJECTS = Object.freeze(
  [AUTHORITY_SCHEMA_TABLE_STATEMENT, ...AUTHORITY_SCHEMA_STATEMENTS]
    .map(expectedSchemaObject)
    .sort((left, right) => canonicalJson([left.type, left.name])
      .localeCompare(canonicalJson([right.type, right.name]))),
);
const AUTHORITY_SCHEMA_SHA256 = canonicalSha256(AUTHORITY_SCHEMA_OBJECTS);

function rowValue(
  row: Readonly<Record<string, unknown>> | readonly unknown[],
  key: string,
  index: number,
): unknown {
  return Array.isArray(row) ? row[index] : (row as Readonly<Record<string, unknown>>)[key];
}

function integer(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function normalizeLimit(value: number | undefined, fallback = 100, maximum = 1000): number {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new RangeError(`limit must be an integer from 1 through ${maximum}.`);
  }
  return limit;
}

function parseOperationJson(value: unknown): OhOperationV1 {
  if (typeof value !== "string") throw new OhIntegrityError("A stored operation is not JSON text.");
  let parsedValue: unknown;
  try { parsedValue = JSON.parse(value); } catch { throw new OhIntegrityError("A stored operation is not JSON."); }
  const operation = parseOhOperationV1(parsedValue);
  if (operation === null || canonicalJson(operation) !== value) {
    throw new OhIntegrityError("A stored operation is invalid.");
  }
  return operation;
}

function parseOperationRow(
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

function parseBindingRow(
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

function parsePurgeReceiptRow(
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

function parseHeadRow(row: Readonly<Record<string, unknown>> | readonly unknown[]): OhHeadV1 {
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

async function queryOne(
  client: OhLibSqlClientV1,
  statement: OhLibSqlStatementV1,
): Promise<Readonly<Record<string, unknown>> | readonly unknown[] | null> {
  return (await client.execute(statement)).rows[0] ?? null;
}

async function verifyAuthoritySchemaObjects(client: OhLibSqlClientV1): Promise<void> {
  const rows = (await client.execute({ sql: `SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND (name = 'oh_authority_schemas' OR name GLOB 'oh_authority_*'
      OR tbl_name GLOB 'oh_authority_*')
    ORDER BY type, name` })).rows;
  const actual = rows.map((row) => {
    const type = rowValue(row, "type", 0);
    const name = rowValue(row, "name", 1);
    const tableName = rowValue(row, "tbl_name", 2);
    const sql = rowValue(row, "sql", 3);
    if ((type !== "table" && type !== "index" && type !== "trigger") || typeof name !== "string"
      || typeof tableName !== "string" || typeof sql !== "string") {
      throw new OhIntegrityError("The installed libSQL authority has an invalid schema object.");
    }
    return { name, sql: normalizedSchemaSql(sql), tableName, type };
  });
  if (canonicalJson(actual) !== canonicalJson(AUTHORITY_SCHEMA_OBJECTS)) {
    throw new OhIntegrityError("The installed libSQL authority objects differ from this runtime.");
  }
}

async function verifyAuthoritySchema(client: OhLibSqlClientV1): Promise<void> {
  const installed = await queryOne(client, { sql: `SELECT name, schema_sha256
    FROM oh_authority_schemas WHERE version = ?`, args: [AUTHORITY_SCHEMA_VERSION] });
  if (installed === null || rowValue(installed, "name", 0) !== AUTHORITY_SCHEMA_NAME
    || rowValue(installed, "schema_sha256", 1) !== AUTHORITY_SCHEMA_SHA256) {
    throw new OhIntegrityError("The installed libSQL authority schema differs from this runtime.");
  }
  const contract = await queryOne(client, { sql: `SELECT contract_sha256, manifest_json
    FROM oh_authority_contracts WHERE contract_id = ?`, args: [OH_CONTRACT_MANIFEST_V1.contractId] });
  if (contract === null || rowValue(contract, "contract_sha256", 0) !== OH_CONTRACT_MANIFEST_V1.contractSha256
    || rowValue(contract, "manifest_json", 1) !== canonicalJson(OH_CONTRACT_MANIFEST_V1)) {
    throw new OhIntegrityError("The remote authority contract differs from this runtime.");
  }
  await verifyAuthoritySchemaObjects(client);
}

/** One-time schema operation for a client authorized to create authority tables. */
export async function bootstrapOhLibSqlAuthorityV1(
  client: OhLibSqlClientV1,
): Promise<Readonly<{ schemaSha256: Sha256Hex; schemaVersion: 1; v: 1 }>> {
  const existingObjects = (await client.execute({ sql: `SELECT name FROM sqlite_schema
    WHERE sql IS NOT NULL AND (name = 'oh_authority_schemas' OR name GLOB 'oh_authority_*'
      OR tbl_name GLOB 'oh_authority_*')` })).rows;
  if (existingObjects.length > 0) {
    if (!existingObjects.some((row) => rowValue(row, "name", 0) === "oh_authority_schemas")) {
      throw new OhIntegrityError("Refusing to bootstrap over preexisting Oh authority objects.");
    }
    await verifyAuthoritySchema(client);
    return { schemaSha256: AUTHORITY_SCHEMA_SHA256, schemaVersion: 1, v: 1 };
  }
  const setup: OhLibSqlStatementV1[] = [AUTHORITY_SCHEMA_TABLE_STATEMENT, ...AUTHORITY_SCHEMA_STATEMENTS]
    .map((sql) => ({ sql }));
  setup.push({ sql: `INSERT INTO oh_authority_schemas(version, name, schema_sha256, applied_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(version) DO NOTHING`,
    args: [AUTHORITY_SCHEMA_VERSION, AUTHORITY_SCHEMA_NAME, AUTHORITY_SCHEMA_SHA256, canonicalNow()] });
  setup.push({ sql: `INSERT INTO oh_authority_contracts(contract_id, contract_sha256, manifest_json)
    VALUES (?, ?, ?) ON CONFLICT(contract_id) DO NOTHING`, args: [OH_CONTRACT_MANIFEST_V1.contractId,
      OH_CONTRACT_MANIFEST_V1.contractSha256, canonicalJson(OH_CONTRACT_MANIFEST_V1)] });
  await client.batch(setup, "write");
  await verifyAuthoritySchema(client);
  return { schemaSha256: AUTHORITY_SCHEMA_SHA256, schemaVersion: 1, v: 1 };
}

async function initializeSpace(
  client: OhLibSqlClientV1,
  binding: OhStoreBindingV1,
): Promise<void> {
  const purged = await queryOne(client, { sql: PURGE_ROW_SELECT,
    args: [binding.spaceId] });
  if (purged !== null) throw new OhPurgedSpaceError(parsePurgeReceiptRow(
    purged, binding.spaceId, binding.bindingSha256));
  const now = canonicalNow();
  try { await client.batch([
    { sql: `INSERT INTO oh_authority_spaces(space_id, contract_id, generation,
      head_operation_sha256, graph_revision_sha256, records_sha256, sequence, created_at, updated_at)
      SELECT ?, ?, 0, NULL, NULL, ?, 0, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ?)
      ON CONFLICT(space_id) DO NOTHING`,
      args: [binding.spaceId, OH_CONTRACT_MANIFEST_V1.contractId, EMPTY_RECORDS_SHA256, now, now,
        binding.spaceId] },
    { sql: `INSERT INTO oh_authority_bindings(space_id, realm_id, profile_id, profile_kind,
      profile_sha256, binding_sha256, binding_json, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ?)
        AND EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
      ON CONFLICT(space_id) DO NOTHING`,
      args: [binding.spaceId, binding.realmId, binding.profile.profileId, binding.profile.profileKind,
        binding.profile.profileSha256, binding.bindingSha256, canonicalJson(binding), now,
        binding.spaceId, binding.spaceId] },
    { sql: `INSERT INTO oh_authority_commit_guards(value)
      SELECT 'invalid' WHERE EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ?)
        OR NOT EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
        OR NOT EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ? AND binding_sha256 = ?)`,
      args: [binding.spaceId, binding.spaceId, binding.spaceId, binding.bindingSha256] },
  ], "write"); } catch (error) {
    const raced = await queryOne(client, { sql: PURGE_ROW_SELECT,
      args: [binding.spaceId] });
    if (raced !== null) throw new OhPurgedSpaceError(parsePurgeReceiptRow(
      raced, binding.spaceId, binding.bindingSha256));
    const persisted = await queryOne(client, { sql: BINDING_ROW_SELECT, args: [binding.spaceId] });
    if (persisted !== null
      && canonicalJson(parseBindingRow(persisted, binding.spaceId)) !== canonicalJson(binding)) {
      throw new OhProfileError("The remote space is already bound to a different realm or profile.");
    }
    throw error;
  }
  const persisted = await queryOne(client, { sql: BINDING_ROW_SELECT, args: [binding.spaceId] });
  if (persisted === null) {
    const raced = await queryOne(client, { sql: PURGE_ROW_SELECT,
      args: [binding.spaceId] });
    if (raced !== null) throw new OhPurgedSpaceError(parsePurgeReceiptRow(
      raced, binding.spaceId, binding.bindingSha256));
    throw new OhIntegrityError("The remote space has no persisted binding after initialization.");
  }
  if (canonicalJson(parseBindingRow(persisted, binding.spaceId)) !== canonicalJson(binding)) {
    throw new OhProfileError("The remote space is already bound to a different realm or profile.");
  }
}

async function requireExistingSpace(
  client: OhLibSqlClientV1,
  binding: OhStoreBindingV1,
): Promise<void> {
  const results = await client.batch([
    { sql: BINDING_ROW_SELECT, args: [binding.spaceId] },
    { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256,
      records_sha256, sequence, contract_id FROM oh_authority_spaces WHERE space_id = ?`,
      args: [binding.spaceId] },
    { sql: PURGE_ROW_SELECT, args: [binding.spaceId] },
  ], "read");
  if (results.length !== 3) {
    throw new OhIntegrityError("The remote authority returned an incomplete existing-space proof.");
  }
  const [bindingResult, spaceResult, purgeResult] = results as
    [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1];
  const purgeRow = purgeResult.rows[0];
  if (purgeRow !== undefined) {
    throw new OhPurgedSpaceError(parsePurgeReceiptRow(
      purgeRow, binding.spaceId, binding.bindingSha256));
  }
  const bindingRow = bindingResult.rows[0];
  const spaceRow = spaceResult.rows[0];
  if (bindingRow === undefined || spaceRow === undefined) {
    throw new OhIntegrityError("The requested remote Oh space does not already exist.");
  }
  const persisted = parseBindingRow(bindingRow, binding.spaceId);
  if (canonicalJson(persisted) !== canonicalJson(binding)) {
    throw new OhProfileError("The remote space is bound to a different realm or profile.");
  }
  if (rowValue(spaceRow, "contract_id", 5) !== OH_CONTRACT_MANIFEST_V1.contractId) {
    throw new OhIntegrityError("The existing remote space uses a different Oh contract.");
  }
  parseHeadRow(spaceRow);
}

class OhLibSqlStoreV1 implements OhStoreV1 {
  readonly binding: OhStoreBindingV1;
  readonly #client: OhLibSqlClientV1;
  readonly #closeClient: boolean;
  #closed = false;
  #purged: OhSpacePurgeReceiptV1 | null = null;

  constructor(client: OhLibSqlClientV1, binding: OhStoreBindingV1, closeClient: boolean) {
    this.#client = client;
    this.binding = binding;
    this.#closeClient = closeClient;
  }

  #assertOpen(): void {
    if (this.#purged !== null) throw new OhPurgedSpaceError(this.#purged);
    if (this.#closed) throw new Error("The Oh libSQL store is closed.");
  }

  async head(): Promise<OhHeadV1> {
    this.#assertOpen();
    const row = await queryOne(this.#client, { sql: `SELECT generation, graph_revision_sha256,
      head_operation_sha256, records_sha256, sequence FROM oh_authority_spaces WHERE space_id = ?`,
      args: [this.binding.spaceId] });
    if (row === null) {
      const purged = await this.#readPurge();
      if (purged !== null) { this.#purged = purged; throw new OhPurgedSpaceError(purged); }
      throw new OhIntegrityError("The remote Oh space does not exist.");
    }
    return parseHeadRow(row);
  }

  async #readPurge(): Promise<OhSpacePurgeReceiptV1 | null> {
    const row = await queryOne(this.#client, { sql: PURGE_ROW_SELECT,
      args: [this.binding.spaceId] });
    if (row === null) return null;
    return parsePurgeReceiptRow(row, this.binding.spaceId, this.binding.bindingSha256);
  }

  async #headAt(reference: OhHeadRefV1): Promise<OhHeadV1> {
    const parsed = parseOhHeadRefV1(reference);
    if (parsed === null) throw new TypeError("Invalid Oh head reference.");
    if (parsed.sequence === 0) return emptyOhHeadV1();
    const row = await queryOne(this.#client, { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
      WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, parsed.sequence] });
    if (row === null) throw new OhConflictError("The requested head is not present in this space.");
    const operation = parseOperationRow(row, { spaceId: this.binding.spaceId });
    if (operation.spaceId !== this.binding.spaceId || operation.sequence !== parsed.sequence
      || operation.operationSha256 !== parsed.operationSha256) {
      throw new OhConflictError("The requested sequence identifies a different operation head.");
    }
    return { generation: operation.sequence, graphRevisionSha256: operation.graphRevisionSha256,
      operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
      sequence: operation.sequence, v: 1 };
  }

  async #currentMaterializedSnapshot(expectedHead: OhHeadV1, maximumRecords: number): Promise<OhSnapshotV1> {
    const provenancePredicate = `operation.space_id = ? AND (operation.operation_sha256 IS ?
      OR operation.operation_sha256 IN (SELECT record.operation_sha256
        FROM oh_authority_records AS record WHERE record.space_id = ?))`;
    const results = await this.#client.batch([
      { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] },
      { sql: `SELECT
          (SELECT count(*) FROM (SELECT DISTINCT operation.operation_sha256
            FROM oh_authority_operations AS operation WHERE ${provenancePredicate})) AS provenance_count,
          (SELECT coalesce(sum(bytes), 0) FROM (SELECT DISTINCT operation.operation_sha256,
            ${OPERATION_RESPONSE_BYTES} AS bytes FROM oh_authority_operations AS operation
            WHERE ${provenancePredicate})) AS provenance_bytes,
          (SELECT count(*) FROM oh_authority_records WHERE space_id = ?) AS record_count,
          (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0) FROM oh_authority_records AS record
            WHERE record.space_id = ?) AS record_bytes,
          (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
            FROM oh_authority_dependencies AS dependency
            WHERE dependency.space_id = ?) AS dependency_bytes`,
      args: [this.binding.spaceId, expectedHead.operationSha256, this.binding.spaceId,
        this.binding.spaceId, expectedHead.operationSha256, this.binding.spaceId,
        this.binding.spaceId, this.binding.spaceId, this.binding.spaceId] },
      { sql: `SELECT record_key, kind, record_sha256, record_json, operation_sha256, sequence
        FROM oh_authority_records AS record WHERE record.space_id = ?
          AND (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0)
            FROM oh_authority_records AS record WHERE record.space_id = ?) <= ? ORDER BY record_key`, args: [this.binding.spaceId,
        this.binding.spaceId, OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes] },
      { sql: `SELECT record_key, dependency_key FROM oh_authority_dependencies
        AS dependency WHERE dependency.space_id = ?
          AND (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
            FROM oh_authority_dependencies AS dependency WHERE dependency.space_id = ?) <= ?
        ORDER BY record_key, dependency_key`,
      args: [this.binding.spaceId, this.binding.spaceId, OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS}
        FROM oh_authority_operations AS operation
        WHERE ${provenancePredicate}
          AND (SELECT coalesce(sum(bytes), 0) FROM (SELECT DISTINCT candidate.operation_sha256,
            ${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")} AS bytes
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND (candidate.operation_sha256 IS ?
              OR candidate.operation_sha256 IN (SELECT record.operation_sha256
                FROM oh_authority_records AS record WHERE record.space_id = ?)))) <= ?
        ORDER BY operation.sequence`,
      args: [this.binding.spaceId, expectedHead.operationSha256, this.binding.spaceId,
        this.binding.spaceId, expectedHead.operationSha256, this.binding.spaceId,
        OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes] },
      { sql: `SELECT count(*) AS count, min(sequence) AS minimum, max(sequence) AS maximum
        FROM oh_authority_operations WHERE space_id = ?`, args: [this.binding.spaceId] },
    ], "read");
    if (results.length !== 6) throw new OhIntegrityError("The remote authority returned an incomplete snapshot batch.");
    const [headResult, sizeResult, recordResult, dependencyResult, provenanceResult, historyResult] = results as
      [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1,
        OhLibSqlResultV1, OhLibSqlResultV1];
    const headRow = headResult.rows[0];
    if (headRow === undefined) {
      const purge = await this.#readPurge();
      if (purge !== null) { this.#purged = purge; throw new OhPurgedSpaceError(purge); }
      throw new OhIntegrityError("The remote Oh space disappeared while reading its snapshot.");
    }
    const head = parseHeadRow(headRow);
    if (canonicalJson(head) !== canonicalJson(expectedHead)) {
      throw new OhConflictError("The remote space head changed while reading its current snapshot.");
    }
    const size = sizeResult.rows[0];
    const provenanceOperations = size === undefined ? null : integer(rowValue(size, "provenance_count", 0));
    const provenanceBytes = size === undefined ? null : integer(rowValue(size, "provenance_bytes", 1));
    const recordCount = size === undefined ? null : integer(rowValue(size, "record_count", 2));
    const recordBytes = size === undefined ? null : integer(rowValue(size, "record_bytes", 3));
    const dependencyBytes = size === undefined ? null : integer(rowValue(size, "dependency_bytes", 4));
    if (provenanceOperations === null || provenanceBytes === null || recordCount === null
      || recordBytes === null || dependencyBytes === null
      || provenanceOperations > OH_LIBSQL_STORE_LIMITS_V1.historyOperations
      || provenanceBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes
      || recordBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes
      || dependencyBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes) {
      throw new RangeError("The current libSQL materialization exceeds its provider-safe response bounds.");
    }
    if (recordResult.rows.length !== recordCount || provenanceResult.rows.length !== provenanceOperations) {
      throw new OhIntegrityError("The provider-safe snapshot queries omitted bounded authority rows.");
    }
    const history = historyResult.rows[0];
    const operationCount = history === undefined ? null : integer(rowValue(history, "count", 0));
    const minimumValue = history === undefined ? undefined : rowValue(history, "minimum", 1);
    const maximumValue = history === undefined ? undefined : rowValue(history, "maximum", 2);
    const minimumSequence = history === undefined ? null : integer(rowValue(history, "minimum", 1));
    const maximumSequence = history === undefined ? null : integer(rowValue(history, "maximum", 2));
    if (operationCount !== head.sequence
      || (head.sequence === 0 && (minimumValue !== null || maximumValue !== null))
      || (head.sequence > 0 && (minimumSequence !== 1 || maximumSequence !== head.sequence))) {
      throw new OhIntegrityError("The remote operation history does not exactly cover its current head.");
    }
    if (recordResult.rows.length > maximumRecords) {
      throw new RangeError("The remote graph exceeds the requested record snapshot bound.");
    }
    const provenanceBySha256 = new Map<Sha256Hex, OhOperationV1>();
    for (const row of provenanceResult.rows) {
      const operation = parseOperationRow(row, { spaceId: this.binding.spaceId });
      if (provenanceBySha256.has(operation.operationSha256)) {
        throw new OhIntegrityError("A current materialization provenance operation is invalid.");
      }
      provenanceBySha256.set(operation.operationSha256, operation);
    }
    if (provenanceBySha256.size !== provenanceOperations
      || (head.operationSha256 !== null && !provenanceBySha256.has(head.operationSha256))) {
      throw new OhIntegrityError("The current materialization omitted required provenance operations.");
    }
    if (head.sequence > 0) {
      const terminal = head.operationSha256 === null ? undefined : provenanceBySha256.get(head.operationSha256);
      if (terminal === undefined || terminal.sequence !== head.sequence
        || terminal.graphRevisionSha256 !== head.graphRevisionSha256
        || terminal.recordsSha256 !== head.recordsSha256) {
        throw new OhIntegrityError("The remote space head differs from its terminal canonical operation.");
      }
    }
    const materialized = recordResult.rows.map((row) => {
      const json = rowValue(row, "record_json", 3);
      if (typeof json !== "string") throw new OhIntegrityError("A materialized remote record is not JSON text.");
      let value: unknown;
      try { value = JSON.parse(json); } catch { throw new OhIntegrityError("A materialized remote record is invalid."); }
      const record = parseKnowledgeGraphRecordV1(value);
      const operationSha256 = parseSha256Hex(rowValue(row, "operation_sha256", 4));
      const sequence = integer(rowValue(row, "sequence", 5));
      if (record === null || canonicalJson(record) !== json || operationSha256 === null
        || sequence === null || sequence < 1 || sequence > head.sequence
        || rowValue(row, "record_key", 0) !== record.key
        || rowValue(row, "kind", 1) !== record.kind
        || rowValue(row, "record_sha256", 2) !== record.recordSha256) {
        throw new OhIntegrityError("A materialized remote record is invalid.");
      }
      const provenance = provenanceBySha256.get(operationSha256);
      if (provenance === undefined || provenance.sequence !== sequence
        || !provenance.changes.some((change) => change.kind === "put"
          && canonicalJson(change.record) === json)) {
        throw new OhIntegrityError("A materialized remote record has no exact canonical provenance put.");
      }
      return { record, sequence };
    });
    const records = materialized.map(({ record }) => record);
    if (canonicalSha256(records.map(knowledgeGraphRecordRefV1)) !== head.recordsSha256) {
      throw new OhIntegrityError("Materialized remote records do not reproduce the current head.");
    }
    const dependencyRows = dependencyResult.rows.map((row) => ({
      dependency_key: rowValue(row, "dependency_key", 1),
      record_key: rowValue(row, "record_key", 0),
    }));
    const expectedDependencies = records.flatMap((record) =>
      record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })));
    if (canonicalJson(dependencyRows) !== canonicalJson(expectedDependencies)) {
      throw new OhIntegrityError("Materialized remote dependencies do not match their record envelopes.");
    }
    return { head, records, v: 1 };
  }

  async snapshot(options: Readonly<{
    head?: OhHeadRefV1;
    maximumRecords?: number;
  }> = {}): Promise<OhSnapshotV1> {
    this.#assertOpen();
    const current = await this.head();
    const target = options.head === undefined ? current : await this.#headAt(options.head);
    if (target.sequence > current.sequence) throw new OhConflictError("The requested head is ahead of this space.");
    const maximumRecords = options.maximumRecords ?? OH_GRAPH_LIMITS_V1.recordsPerSnapshot;
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1
      || maximumRecords > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
      throw new RangeError(`maximumRecords must be an integer from 1 through ${OH_GRAPH_LIMITS_V1.recordsPerSnapshot}.`);
    }
    if (target.operationSha256 === current.operationSha256) {
      return await this.#currentMaterializedSnapshot(current, maximumRecords);
    }
    if (target.sequence > OH_LIBSQL_STORE_LIMITS_V1.historyOperations) {
      throw new RangeError("The requested libSQL history exceeds its operation replay bound.");
    }
    const historyResults = await this.#client.batch([
      { sql: `SELECT count(*) AS count, min(operation.sequence) AS minimum,
          max(operation.sequence) AS maximum,
          coalesce(sum(length(CAST(operation.operation_json AS BLOB))), 0) AS canonical_bytes,
          coalesce(sum(${OPERATION_RESPONSE_BYTES}), 0) AS response_bytes
        FROM oh_authority_operations AS operation
        WHERE operation.space_id = ? AND operation.sequence <= ?`,
      args: [this.binding.spaceId, target.sequence] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations AS operation
        WHERE operation.space_id = ? AND operation.sequence <= ?
          AND (SELECT coalesce(sum(length(CAST(candidate.operation_json AS BLOB))), 0)
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
          AND (SELECT coalesce(sum(${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")}), 0)
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
        ORDER BY operation.sequence`, args: [this.binding.spaceId, target.sequence,
        this.binding.spaceId, target.sequence, OH_LIBSQL_STORE_LIMITS_V1.historyBytes,
        this.binding.spaceId, target.sequence, OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes] },
      { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] },
    ], "read");
    if (historyResults.length !== 3) {
      throw new OhIntegrityError("The remote authority returned an incomplete history batch.");
    }
    const [historySizeResult, historyRowResult, purgeResult] = historyResults as
      [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1];
    const historySizeRow = historySizeResult.rows[0];
    const historyBytes = historySizeRow === undefined ? null
      : integer(rowValue(historySizeRow, "canonical_bytes", 3));
    const responseBytes = historySizeRow === undefined ? null
      : integer(rowValue(historySizeRow, "response_bytes", 4));
    if (historyBytes === null || historyBytes > OH_LIBSQL_STORE_LIMITS_V1.historyBytes
      || responseBytes === null || responseBytes > OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes) {
      throw new RangeError("The requested libSQL history exceeds its provider-safe replay bounds.");
    }
    const historyCount = historySizeRow === undefined ? null : integer(rowValue(historySizeRow, "count", 0));
    const minimumSequence = historySizeRow === undefined ? null : integer(rowValue(historySizeRow, "minimum", 1));
    const maximumSequence = historySizeRow === undefined ? null : integer(rowValue(historySizeRow, "maximum", 2));
    if (historyCount !== target.sequence
      || (target.sequence === 0 && (rowValue(historySizeRow!, "minimum", 1) !== null
        || rowValue(historySizeRow!, "maximum", 2) !== null))
      || (target.sequence > 0 && (minimumSequence !== 1 || maximumSequence !== target.sequence))
      || historyRowResult.rows.length !== historyCount) {
      const purgeRow = purgeResult.rows[0];
      if (purgeRow !== undefined) {
        const purge = parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256);
        this.#purged = purge;
        throw new OhPurgedSpaceError(purge);
      }
      throw new OhIntegrityError("The remote operation history does not exactly cover the requested head.");
    }
    const operations = historyRowResult.rows.map((row) => parseOperationRow(row,
      { spaceId: this.binding.spaceId }));
    const snapshot = replayOhOperationsV1(this.binding.spaceId, operations, maximumRecords);
    if (snapshot.head.operationSha256 !== target.operationSha256
      || snapshot.head.recordsSha256 !== target.recordsSha256) {
      throw new OhIntegrityError("Remote operation replay does not reproduce the requested head.");
    }
    return snapshot;
  }

  async changesSince(
    fromValue: OhHeadRefV1,
    options: Readonly<{ limit?: number; through?: OhHeadRefV1 }> = {},
  ): Promise<OhChangesPageV1> {
    this.#assertOpen();
    const from = parseOhHeadRefV1(fromValue);
    if (from === null) throw new TypeError("Invalid change-feed cursor.");
    const requestedThrough = options.through === undefined ? undefined : parseOhHeadRefV1(options.through);
    if (requestedThrough === null) throw new TypeError("Invalid change-feed through head.");
    const limit = normalizeLimit(options.limit, OH_LIBSQL_STORE_LIMITS_V1.changeFeedLimit,
      OH_LIBSQL_STORE_LIMITS_V1.changeFeedLimit);
    const throughSequence = requestedThrough?.sequence ?? null;
    const results = await this.#client.batch([
      { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, from.sequence] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, throughSequence] },
      { sql: `SELECT count(*) AS count, coalesce(sum(response_bytes), 0) AS response_bytes FROM (
          SELECT ${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")} AS response_bytes
          FROM oh_authority_operations AS candidate
          WHERE candidate.space_id = ? AND candidate.sequence > ?
            AND candidate.sequence <= coalesce(?,
              (SELECT sequence FROM oh_authority_spaces WHERE space_id = ?))
          ORDER BY candidate.sequence LIMIT ?
        )`, args: [this.binding.spaceId, from.sequence, throughSequence,
        this.binding.spaceId, limit + 1] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        AS operation WHERE operation.space_id = ? AND operation.sequence > ?
          AND operation.sequence <= coalesce(?,
            (SELECT sequence FROM oh_authority_spaces WHERE space_id = ?))
          AND (SELECT coalesce(sum(response_bytes), 0) FROM (
            SELECT ${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")} AS response_bytes
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND candidate.sequence > ?
              AND candidate.sequence <= coalesce(?,
                (SELECT sequence FROM oh_authority_spaces WHERE space_id = ?))
            ORDER BY candidate.sequence LIMIT ?
          )) <= ?
        ORDER BY operation.sequence LIMIT ?`,
      args: [this.binding.spaceId, from.sequence, throughSequence, this.binding.spaceId,
        this.binding.spaceId, from.sequence, throughSequence, this.binding.spaceId, limit + 1,
        OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes, limit + 1] },
      { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] },
    ], "read");
    if (results.length !== 6) throw new OhIntegrityError("The remote authority returned an incomplete change-feed batch.");
    const [currentResult, fromResult, throughResult, pageSizeResult, pageResult, purgeResult] = results as
      [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1,
        OhLibSqlResultV1, OhLibSqlResultV1];
    const currentRow = currentResult.rows[0];
    if (currentRow === undefined) {
      const purgeRow = purgeResult.rows[0];
      if (purgeRow !== undefined) {
        const purge = parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256);
        this.#purged = purge;
        throw new OhPurgedSpaceError(purge);
      }
      throw new OhIntegrityError("The remote Oh space disappeared while reading its change feed.");
    }
    const current = parseHeadRow(currentRow);
    const resolveHead = (reference: OhHeadRefV1, result: OhLibSqlResultV1): OhHeadV1 => {
      if (reference.sequence === 0) return emptyOhHeadV1();
      const row = result.rows[0];
      if (row === undefined) throw new OhConflictError("A requested change-feed head is not present in this space.");
      const operation = parseOperationRow(row, { spaceId: this.binding.spaceId });
      if (operation.spaceId !== this.binding.spaceId || operation.sequence !== reference.sequence
        || operation.operationSha256 !== reference.operationSha256) {
        throw new OhConflictError("A requested change-feed sequence identifies a different operation head.");
      }
      return { generation: operation.sequence, graphRevisionSha256: operation.graphRevisionSha256,
        operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
        sequence: operation.sequence, v: 1 };
    };
    const fromHead = resolveHead(from, fromResult);
    const through = requestedThrough === undefined ? current : resolveHead(requestedThrough, throughResult);
    if (fromHead.sequence > through.sequence || through.sequence > current.sequence) {
      throw new OhConflictError("The change-feed bounds do not identify one remote history prefix.");
    }
    const pageSizeRow = pageSizeResult.rows[0];
    const pageCount = pageSizeRow === undefined ? null : integer(rowValue(pageSizeRow, "count", 0));
    const pageResponseBytes = pageSizeRow === undefined ? null
      : integer(rowValue(pageSizeRow, "response_bytes", 1));
    if (pageCount === null || pageCount > limit + 1 || pageResponseBytes === null) {
      throw new OhIntegrityError("The remote change feed returned invalid response bounds.");
    }
    if (pageResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes) {
      throw new RangeError("The requested change-feed page exceeds its provider response bound.");
    }
    const parsed = pageResult.rows.map((row) => parseOperationRow(row, { spaceId: this.binding.spaceId }));
    if (parsed.length !== pageCount) {
      throw new OhIntegrityError("The remote change feed omitted provider-bounded rows.");
    }
    const hasMore = parsed.length > limit;
    const operations = parsed.slice(0, limit);
    let prior: OhHeadRefV1 = fromHead;
    for (const operation of parsed) {
      if (operation.spaceId !== this.binding.spaceId
        || operation.sequence !== prior.sequence + 1
        || operation.parentOperationSha256 !== prior.operationSha256) {
        throw new OhIntegrityError("The remote change feed contains a gap or fork.");
      }
      prior = { operationSha256: operation.operationSha256, sequence: operation.sequence };
    }
    if (!hasMore && (prior.sequence !== through.sequence
      || prior.operationSha256 !== through.operationSha256)) {
      throw new OhIntegrityError("The remote change feed does not reach its pinned through head.");
    }
    const last = operations.at(-1);
    const to = last === undefined
      ? { operationSha256: fromHead.operationSha256, sequence: fromHead.sequence }
      : { operationSha256: last.operationSha256, sequence: last.sequence };
    return { from: { operationSha256: fromHead.operationSha256, sequence: fromHead.sequence },
      hasMore, operations, through, to, v: 1 };
  }

  async #assertMaterializedSnapshot(snapshot: OhSnapshotV1): Promise<void> {
    if (snapshot.head.sequence > OH_LIBSQL_STORE_LIMITS_V1.historyOperations) {
      throw new RangeError("The libSQL authority exceeds its explicit verification operation bound.");
    }
    const verificationResults = await this.#client.batch([
        { sql: `SELECT * FROM (WITH bounded_operation AS (
            SELECT * FROM oh_authority_operations
            WHERE space_id = ? AND sequence <= ?
          ) SELECT count(*) AS operation_count, min(operation.sequence) AS minimum,
            max(operation.sequence) AS maximum,
            coalesce(sum(length(CAST(operation.operation_json AS BLOB))), 0) AS canonical_bytes,
            coalesce(sum(${OPERATION_RESPONSE_BYTES}), 0) AS operation_response_bytes,
            (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0)
              FROM oh_authority_records AS record WHERE record.space_id = ?) AS record_response_bytes,
            (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
              FROM oh_authority_dependencies AS dependency
              WHERE dependency.space_id = ?) AS dependency_response_bytes,
            (SELECT coalesce(sum(${OPERATION_RECORD_RESPONSE_BYTES}), 0)
              FROM oh_authority_operation_records AS materialized
              JOIN bounded_operation AS owner
                ON owner.operation_sha256 = materialized.operation_sha256) AS operation_record_response_bytes
          FROM bounded_operation AS operation)`, args: [this.binding.spaceId, snapshot.head.sequence,
          this.binding.spaceId, this.binding.spaceId] },
        { sql: `SELECT ${OPERATION_ROW_COLUMNS}
          FROM oh_authority_operations AS operation
          WHERE operation.space_id = ? AND operation.sequence <= ?
            AND (SELECT coalesce(sum(length(CAST(candidate.operation_json AS BLOB))), 0)
              FROM oh_authority_operations AS candidate
              WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
            AND (SELECT coalesce(sum(${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")}), 0)
              FROM oh_authority_operations AS candidate
              WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
          ORDER BY operation.sequence`, args: [this.binding.spaceId, snapshot.head.sequence,
          this.binding.spaceId, snapshot.head.sequence, OH_LIBSQL_STORE_LIMITS_V1.historyBytes,
          this.binding.spaceId, snapshot.head.sequence, OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes] },
        { sql: `SELECT record_key, kind, record_sha256, record_json, operation_sha256, sequence
          FROM oh_authority_records AS record WHERE record.space_id = ?
            AND (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0)
              FROM oh_authority_records AS record WHERE record.space_id = ?) <= ?
          ORDER BY record.record_key`, args: [this.binding.spaceId, this.binding.spaceId,
          OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes] },
        { sql: `SELECT record_key, dependency_key FROM oh_authority_dependencies AS dependency
          WHERE dependency.space_id = ?
            AND (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
              FROM oh_authority_dependencies AS dependency WHERE dependency.space_id = ?) <= ?
          ORDER BY dependency.record_key, dependency.dependency_key`, args: [this.binding.spaceId,
          this.binding.spaceId, OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes] },
        { sql: `SELECT materialized.space_id, materialized.operation_sha256, materialized.ordinal,
          materialized.record_key, materialized.change_kind, materialized.record_sha256
          FROM oh_authority_operation_records AS materialized
          JOIN oh_authority_operations AS operation
            ON operation.operation_sha256 = materialized.operation_sha256
          WHERE operation.space_id = ? AND operation.sequence <= ?
            AND (SELECT coalesce(sum(${OPERATION_RECORD_RESPONSE_BYTES}), 0)
              FROM oh_authority_operation_records AS materialized
              JOIN oh_authority_operations AS owner
                ON owner.operation_sha256 = materialized.operation_sha256
              WHERE owner.space_id = ? AND owner.sequence <= ?) <= ?
          ORDER BY operation.sequence, materialized.ordinal`, args: [this.binding.spaceId,
          snapshot.head.sequence, this.binding.spaceId, snapshot.head.sequence,
          OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes] },
        { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
          FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] },
      ], "read");
    if (verificationResults.length !== 6) {
      throw new OhIntegrityError("The remote authority returned an incomplete verification batch.");
    }
    const [sizeResult, operationResult, recordResult, dependencyResult, operationRecordResult, headResult] =
      verificationResults as [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1,
        OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1];
    const sizeRow = sizeResult.rows[0];
    const operationCount = sizeRow === undefined ? null : integer(rowValue(sizeRow, "operation_count", 0));
    const minimumValue = sizeRow === undefined ? undefined : rowValue(sizeRow, "minimum", 1);
    const maximumValue = sizeRow === undefined ? undefined : rowValue(sizeRow, "maximum", 2);
    const minimumSequence = sizeRow === undefined ? null : integer(rowValue(sizeRow, "minimum", 1));
    const maximumSequence = sizeRow === undefined ? null : integer(rowValue(sizeRow, "maximum", 2));
    const historyBytes = sizeRow === undefined ? null : integer(rowValue(sizeRow, "canonical_bytes", 3));
    const operationResponseBytes = sizeRow === undefined ? null
      : integer(rowValue(sizeRow, "operation_response_bytes", 4));
    const recordResponseBytes = sizeRow === undefined ? null
      : integer(rowValue(sizeRow, "record_response_bytes", 5));
    const dependencyResponseBytes = sizeRow === undefined ? null
      : integer(rowValue(sizeRow, "dependency_response_bytes", 6));
    const operationRecordResponseBytes = sizeRow === undefined ? null
      : integer(rowValue(sizeRow, "operation_record_response_bytes", 7));
    if (historyBytes === null || historyBytes > OH_LIBSQL_STORE_LIMITS_V1.historyBytes
      || operationResponseBytes === null
      || operationResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes
      || recordResponseBytes === null
      || recordResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes
      || dependencyResponseBytes === null
      || dependencyResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes
      || operationRecordResponseBytes === null
      || operationRecordResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes) {
      throw new RangeError("The libSQL authority exceeds its provider-safe verification bounds.");
    }
    if (operationCount !== snapshot.head.sequence
      || (snapshot.head.sequence === 0 && (minimumValue !== null || maximumValue !== null))
      || (snapshot.head.sequence > 0
        && (minimumSequence !== 1 || maximumSequence !== snapshot.head.sequence))
      || operationResult.rows.length !== operationCount) {
      throw new OhIntegrityError("The remote operation history does not exactly cover its verified head.");
    }
    const headRow = headResult.rows[0];
    if (headRow === undefined) throw new OhIntegrityError("The remote authority lost its head during verification.");
    if (canonicalJson(parseHeadRow(headRow)) !== canonicalJson(snapshot.head)) {
      throw new OhConflictError("The remote authority head changed during verification.");
    }
    const operations = operationResult.rows.map((row) => {
      return parseOperationRow(row, { spaceId: this.binding.spaceId });
    });
    const replayed = replayOhOperationsV1(this.binding.spaceId, operations);
    if (canonicalJson(replayed) !== canonicalJson(snapshot)) {
      throw new OhIntegrityError("Remote operation replay changed during materialization verification.");
    }
    const materializedBy = new Map<string, Readonly<{ operationSha256: Sha256Hex; sequence: number }>>();
    for (const operation of operations) {
      for (const change of operation.changes) {
        const key = change.kind === "put" ? change.record.key : change.key;
        if (change.kind === "put") materializedBy.set(key,
          { operationSha256: operation.operationSha256, sequence: operation.sequence });
        else materializedBy.delete(key);
      }
    }
    const records: KnowledgeGraphRecordV1[] = recordResult.rows.map((row) => {
      const json = rowValue(row, "record_json", 3);
      if (typeof json !== "string") throw new OhIntegrityError("A materialized remote record is not JSON text.");
      let value: unknown;
      try { value = JSON.parse(json); } catch { throw new OhIntegrityError("A materialized remote record is invalid."); }
      const record = parseKnowledgeGraphRecordV1(value);
      const provenance = record === null ? undefined : materializedBy.get(record.key);
      if (record === null || canonicalJson(record) !== json
        || rowValue(row, "record_key", 0) !== record.key
        || rowValue(row, "kind", 1) !== record.kind
        || rowValue(row, "record_sha256", 2) !== record.recordSha256
        || provenance === undefined
        || rowValue(row, "operation_sha256", 4) !== provenance.operationSha256
        || integer(rowValue(row, "sequence", 5)) !== provenance.sequence) {
        throw new OhIntegrityError("A materialized remote record differs from operation replay.");
      }
      return record;
    });
    if (canonicalJson(records) !== canonicalJson(snapshot.records)) {
      throw new OhIntegrityError("Remote materialized records do not match operation replay.");
    }
    const dependencyRows = dependencyResult.rows.map((row) => ({
      dependency_key: rowValue(row, "dependency_key", 1),
      record_key: rowValue(row, "record_key", 0),
    }));
    const expectedDependencies = snapshot.records.flatMap((record) =>
      record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })));
    if (canonicalJson(dependencyRows) !== canonicalJson(expectedDependencies)) {
      throw new OhIntegrityError("Remote materialized dependencies do not match operation replay.");
    }
    const operationRecordRows = operationRecordResult.rows.map((row) => ({
      change_kind: rowValue(row, "change_kind", 4),
      operation_sha256: rowValue(row, "operation_sha256", 1),
      ordinal: integer(rowValue(row, "ordinal", 2)),
      record_key: rowValue(row, "record_key", 3),
      record_sha256: rowValue(row, "record_sha256", 5),
      space_id: rowValue(row, "space_id", 0),
    }));
    const expectedOperationRecords = operations.flatMap((operation) =>
      operation.changes.map((change, ordinal) => ({ change_kind: change.kind,
        operation_sha256: operation.operationSha256, ordinal,
        record_key: change.kind === "put" ? change.record.key : change.key,
        record_sha256: change.kind === "put" ? change.record.recordSha256 : change.priorSha256,
        space_id: this.binding.spaceId })));
    if (canonicalJson(operationRecordRows) !== canonicalJson(expectedOperationRecords)) {
      throw new OhIntegrityError("Remote operation-record rows do not match operation replay.");
    }
  }

  async #operationById(operationId: string): Promise<OhOperationV1 | null> {
    const row = await queryOne(this.#client, { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
      WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId] });
    if (row === null) return null;
    return parseOperationRow(row, { operationId, spaceId: this.binding.spaceId });
  }

  async #commitPreflight(operationId: string): Promise<Readonly<{
    current: OhHeadV1;
    duplicate: OhOperationV1 | null;
  }>> {
    const results = await this.#client.batch([
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId] },
      { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] },
      { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] },
    ], "read");
    if (results.length !== 3) throw new OhIntegrityError("The remote authority returned an incomplete commit preflight.");
    const [duplicateResult, headResult, purgeResult] = results as
      [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1];
    const headRow = headResult.rows[0];
    if (headRow === undefined) {
      const purgeRow = purgeResult.rows[0];
      if (purgeRow !== undefined) {
        const purge = parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256);
        this.#purged = purge;
        throw new OhPurgedSpaceError(purge);
      }
      throw new OhIntegrityError("The remote space disappeared during commit preflight.");
    }
    const duplicateRow = duplicateResult.rows[0];
    return { current: parseHeadRow(headRow), duplicate: duplicateRow === undefined ? null
      : parseOperationRow(duplicateRow, { operationId, spaceId: this.binding.spaceId }) };
  }

  async #assertOperationReachable(operation: OhOperationV1, expectedHead: OhHeadV1): Promise<void> {
    if (operation.sequence < 1 || operation.sequence > expectedHead.sequence) {
      throw new OhIntegrityError("A remote idempotent operation is not reachable from the current head.");
    }
    const results = await this.#client.batch([
      { sql: `SELECT * FROM (WITH RECURSIVE authority_chain(sequence, operation_sha256) AS (
          SELECT sequence, operation_sha256 FROM oh_authority_operations
          WHERE space_id = ? AND sequence = ? AND operation_sha256 = ?
          UNION ALL
          SELECT candidate.sequence, candidate.operation_sha256
          FROM oh_authority_operations AS candidate
          JOIN authority_chain AS prior
            ON candidate.space_id = ? AND candidate.sequence = prior.sequence + 1
              AND candidate.parent_operation_sha256 = prior.operation_sha256
          WHERE candidate.sequence <= ?
        ) SELECT count(*) AS count, min(sequence) AS minimum, max(sequence) AS maximum,
          (SELECT operation_sha256 FROM authority_chain ORDER BY sequence DESC LIMIT 1) AS terminal_sha256
        FROM authority_chain)`, args: [this.binding.spaceId, operation.sequence,
        operation.operationSha256, this.binding.spaceId, expectedHead.sequence] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, expectedHead.sequence] },
      { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] },
      { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] },
    ], "read");
    if (results.length !== 4) throw new OhIntegrityError("The remote authority returned an incomplete reachability proof.");
    const [chainResult, terminalResult, headResult, purgeResult] = results as
      [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1];
    const headRow = headResult.rows[0];
    if (headRow === undefined) {
      const purgeRow = purgeResult.rows[0];
      if (purgeRow !== undefined) {
        const purge = parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256);
        this.#purged = purge;
        throw new OhPurgedSpaceError(purge);
      }
      throw new OhIntegrityError("The remote space disappeared during an idempotency proof.");
    }
    const current = parseHeadRow(headRow);
    if (canonicalJson(current) !== canonicalJson(expectedHead)) {
      throw new OhConflictError("The remote space head changed during an idempotency proof.");
    }
    const chain = chainResult.rows[0];
    const count = chain === undefined ? null : integer(rowValue(chain, "count", 0));
    const minimum = chain === undefined ? null : integer(rowValue(chain, "minimum", 1));
    const maximum = chain === undefined ? null : integer(rowValue(chain, "maximum", 2));
    const terminalSha256 = chain === undefined ? null : rowValue(chain, "terminal_sha256", 3);
    if (count !== expectedHead.sequence - operation.sequence + 1
      || minimum !== operation.sequence || maximum !== expectedHead.sequence
      || terminalSha256 !== expectedHead.operationSha256) {
      throw new OhIntegrityError("A remote idempotent operation has no exact path to the current head.");
    }
    const terminalRow = terminalResult.rows[0];
    if (terminalRow === undefined || expectedHead.operationSha256 === null) {
      throw new OhIntegrityError("The remote current head operation is missing.");
    }
    const terminal = parseOperationRow(terminalRow, { operationSha256: expectedHead.operationSha256,
      spaceId: this.binding.spaceId });
    if (terminal.sequence !== expectedHead.sequence
      || terminal.graphRevisionSha256 !== expectedHead.graphRevisionSha256
      || terminal.recordsSha256 !== expectedHead.recordsSha256) {
      throw new OhIntegrityError("The remote space head differs from its terminal canonical operation.");
    }
  }

  async commit(input: OhCommitInputV1): Promise<OhOperationV1> {
    this.#assertOpen();
    const actorId = safeCode(input.actorId);
    const operationId = safeCode(input.operationId);
    const changes = canonicalKnowledgeGraphChangesV1(input.changes);
    if (actorId === null || operationId === null || changes.length === 0) throw new TypeError("Invalid Oh commit input.");
    if (changes.length > OH_LIBSQL_STORE_LIMITS_V1.changesPerCommit) {
      throw new RangeError("A direct libSQL commit exceeds its change-count bound.");
    }
    const dependencies = changes.reduce((count, change) => count
      + (change.kind === "put" ? change.record.dependencies.length : 0), 0);
    if (dependencies > OH_LIBSQL_STORE_LIMITS_V1.dependenciesPerCommit) {
      throw new RangeError("A direct libSQL commit exceeds its dependency-count bound.");
    }
    const { current, duplicate } = await this.#commitPreflight(operationId);
    if (duplicate !== null) {
      await this.#assertOperationReachable(duplicate, current);
      if (duplicate.actorId !== actorId || canonicalJson(duplicate.changes) !== canonicalJson(changes)) {
        throw new OhConflictError("The operation ID is already bound to different content.");
      }
      return duplicate;
    }
    if (!Number.isSafeInteger(input.expectedHead.generation) || input.expectedHead.generation < 0
      || current.generation !== input.expectedHead.generation
      || current.operationSha256 !== input.expectedHead.operationSha256) {
      throw new OhConflictError("The expected head does not match the current remote space head.");
    }
    const snapshot = await this.#currentMaterializedSnapshot(current, OH_GRAPH_LIMITS_V1.recordsPerSnapshot);
    const transition = transitionOhSnapshotV1({ actorId, changes,
      instant: input.instant ?? canonicalNow(), operationId, snapshot, spaceId: this.binding.spaceId });
    const operation = transition.operation;
    if (utf8ByteLength(canonicalJson(operation)) > OH_LIBSQL_STORE_LIMITS_V1.operationBytes) {
      throw new RangeError("A direct libSQL operation exceeds its canonical byte bound.");
    }
    const existsOperation = "EXISTS (SELECT 1 FROM oh_authority_operations WHERE operation_sha256 = ?)";
    const statements: OhLibSqlStatementV1[] = [{
      sql: `INSERT INTO oh_authority_operations(operation_sha256, space_id, sequence,
        operation_id, parent_operation_sha256, graph_revision_sha256, records_sha256,
        operation_json, instant)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM oh_authority_spaces
          WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ?)`,
      args: [operation.operationSha256, this.binding.spaceId, operation.sequence, operation.operationId,
        operation.parentOperationSha256, operation.graphRevisionSha256, operation.recordsSha256,
        canonicalJson(operation), operation.instant, this.binding.spaceId, current.generation,
        current.operationSha256],
    }];
    for (const [ordinal, change] of operation.changes.entries()) {
      const key = change.kind === "put" ? change.record.key : change.key;
      const digest = change.kind === "put" ? change.record.recordSha256 : change.priorSha256;
      statements.push({ sql: `INSERT INTO oh_authority_operation_records(space_id, operation_sha256,
        ordinal, record_key, change_kind, record_sha256)
        SELECT ?, ?, ?, ?, ?, ? WHERE ${existsOperation}`,
      args: [this.binding.spaceId, operation.operationSha256, ordinal, key, change.kind, digest,
        operation.operationSha256] });
      statements.push({ sql: `DELETE FROM oh_authority_dependencies WHERE space_id = ? AND record_key = ?
        AND ${existsOperation}`, args: [this.binding.spaceId, key, operation.operationSha256] });
      if (change.kind === "put") {
        statements.push({ sql: `INSERT INTO oh_authority_records(space_id, record_key, kind,
          record_sha256, record_json, operation_sha256, sequence)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${existsOperation}
          ON CONFLICT(space_id, record_key) DO UPDATE SET kind = excluded.kind,
          record_sha256 = excluded.record_sha256, record_json = excluded.record_json,
          operation_sha256 = excluded.operation_sha256, sequence = excluded.sequence`,
        args: [this.binding.spaceId, key, change.record.kind, change.record.recordSha256,
          canonicalJson(change.record), operation.operationSha256, operation.sequence,
          operation.operationSha256] });
      } else {
        statements.push({ sql: `DELETE FROM oh_authority_records WHERE space_id = ? AND record_key = ?
          AND record_sha256 = ? AND ${existsOperation}`,
        args: [this.binding.spaceId, key, change.priorSha256, operation.operationSha256] });
      }
    }
    for (const change of operation.changes) {
      if (change.kind !== "put") continue;
      for (const dependency of change.record.dependencies) {
        statements.push({ sql: `INSERT INTO oh_authority_dependencies(space_id, record_key, dependency_key)
          SELECT ?, ?, ? WHERE ${existsOperation}`,
        args: [this.binding.spaceId, change.record.key, dependency, operation.operationSha256] });
      }
    }
    statements.push({ sql: `UPDATE oh_authority_spaces SET generation = ?, head_operation_sha256 = ?,
      graph_revision_sha256 = ?, records_sha256 = ?, sequence = ?, updated_at = ?
      WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ? AND ${existsOperation}`,
    args: [operation.sequence, operation.operationSha256, operation.graphRevisionSha256,
      operation.recordsSha256, operation.sequence, operation.instant, this.binding.spaceId,
      current.generation, current.operationSha256, operation.operationSha256] });
    statements.push({ sql: `INSERT INTO oh_authority_commit_guards(value)
      SELECT 'invalid' WHERE NOT EXISTS (SELECT 1 FROM oh_authority_spaces
        WHERE space_id = ? AND generation = ? AND head_operation_sha256 = ?)`,
    args: [this.binding.spaceId, operation.sequence, operation.operationSha256] });
    statements.push({ sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
      WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId] });
    statements.push({ sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
      FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] });
    let writeResults: readonly OhLibSqlResultV1[];
    try {
      writeResults = await this.#client.batch(statements, "write");
    } catch (error) {
      const raced = await this.#operationById(operationId);
      const head = await this.head();
      if (raced !== null && raced.actorId === actorId
        && canonicalJson(raced.changes) === canonicalJson(changes)) {
        await this.#assertOperationReachable(raced, head);
        return raced;
      }
      if (head.operationSha256 !== current.operationSha256) {
        throw new OhConflictError("The remote space head changed while committing.");
      }
      throw error;
    }
    if (writeResults.length !== statements.length) {
      throw new OhIntegrityError("The remote authority returned an incomplete commit result batch.");
    }
    const persistedRow = writeResults.at(-2)?.rows[0];
    const persistedHeadRow = writeResults.at(-1)?.rows[0];
    if (persistedRow === undefined || persistedHeadRow === undefined) {
      throw new OhIntegrityError("The remote authority omitted its persisted commit result.");
    }
    const persisted = parseOperationRow(persistedRow, { operationId, spaceId: this.binding.spaceId });
    const persistedHead = parseHeadRow(persistedHeadRow);
    if (canonicalJson(persisted) !== canonicalJson(operation)
      || persistedHead.operationSha256 !== operation.operationSha256
      || persistedHead.sequence !== operation.sequence
      || persistedHead.graphRevisionSha256 !== operation.graphRevisionSha256
      || persistedHead.recordsSha256 !== operation.recordsSha256) {
      throw new OhIntegrityError("The remote authority did not persist the committed operation exactly.");
    }
    return persisted;
  }

  async exportDependencyClosure(input: Readonly<{
    head?: OhHeadRefV1;
    maximumRecords?: number;
    roots: readonly string[];
  }>): Promise<OhDependencyClosureV1> {
    if (!this.binding.profile.capabilities.dependencyClosureExport) {
      throw new OhProfileError("This remote profile does not permit dependency-closure export.");
    }
    const snapshot = await this.snapshot({ ...(input.head === undefined ? {} : { head: input.head }),
      ...(input.maximumRecords === undefined ? {} : { maximumRecords: input.maximumRecords }) });
    return createOhDependencyClosureV1({ binding: this.binding,
      ...(input.maximumRecords === undefined ? {} : { maximumRecords: input.maximumRecords }),
      roots: input.roots, snapshot });
  }

  async verify(): Promise<OhStoreVerificationV1> {
    this.#assertOpen();
    const snapshot = await this.snapshot();
    await this.#assertMaterializedSnapshot(snapshot);
    return { head: snapshot.head, integrity: "verified", operations: snapshot.head.sequence,
      records: snapshot.records.length, v: 1 };
  }

  async #assertPurgeComplete(expected: OhSpacePurgeReceiptV1): Promise<void> {
    const tables = ["oh_authority_spaces", "oh_authority_bindings", "oh_authority_operations",
      "oh_authority_operation_records", "oh_authority_records", "oh_authority_dependencies"] as const;
    const results = await this.#client.batch([
      { sql: PURGE_ROW_SELECT,
        args: [this.binding.spaceId] },
      ...tables.map((table) => ({ sql: `SELECT count(*) AS count FROM ${table} WHERE space_id = ?`,
        args: [this.binding.spaceId] })),
      { sql: `SELECT count(*) AS count FROM oh_authority_operation_records AS materialized
        LEFT JOIN oh_authority_operations AS operation
          ON operation.operation_sha256 = materialized.operation_sha256
        WHERE operation.operation_sha256 IS NULL OR operation.space_id <> materialized.space_id` },
    ], "read");
    const receiptRow = results[0]?.rows[0];
    if (receiptRow === undefined
      || canonicalJson(parsePurgeReceiptRow(receiptRow, this.binding.spaceId,
        this.binding.bindingSha256)) !== canonicalJson(expected)) {
      throw new OhIntegrityError("The remote purge receipt differs from the requested purge.");
    }
    for (let index = 0; index < tables.length; index += 1) {
      const countRow = results[index + 1]?.rows[0];
      if (countRow === undefined || integer(rowValue(countRow, "count", 0)) !== 0) {
        throw new OhIntegrityError(`Remote purge left rows in ${tables[index]}.`);
      }
    }
    const orphanRow = results[tables.length + 1]?.rows[0];
    if (orphanRow === undefined || integer(rowValue(orphanRow, "count", 0)) !== 0) {
      throw new OhIntegrityError("Remote purge left an orphaned or cross-space operation record.");
    }
  }

  async purgeWorkingSpace(purgedAt: string): Promise<OhSpacePurgeReceiptV1> {
    this.#assertOpen();
    if (this.binding.profile.profileKind !== "working"
      || !this.binding.profile.capabilities.wholeSpacePurge) {
      throw new OhProfileError("Whole-space purge requires a bound working profile.");
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.#readPurge();
      if (existing !== null) {
        await this.#assertPurgeComplete(existing);
        this.#purged = existing;
        return existing;
      }
      const head = await this.head();
      const receipt = createOhSpacePurgeReceiptV1({ binding: this.binding, priorHead: head, purgedAt });
      const receiptExists = "EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ? AND receipt_sha256 = ?)";
      const statements: OhLibSqlStatementV1[] = [{ sql: `INSERT INTO oh_authority_purges(space_id,
        binding_sha256, prior_operation_sha256, prior_sequence, purged_at, receipt_sha256, receipt_json)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM oh_authority_spaces
          WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ?)
          AND EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ? AND binding_sha256 = ?)`,
      args: [this.binding.spaceId, this.binding.bindingSha256, head.operationSha256, head.sequence,
        receipt.purgedAt, receipt.receiptSha256, canonicalJson(receipt), this.binding.spaceId,
        head.generation, head.operationSha256, this.binding.spaceId, this.binding.bindingSha256] }];
      const guardedDelete = (table: string): OhLibSqlStatementV1 => ({
        sql: `DELETE FROM ${table} WHERE space_id = ? AND ${receiptExists}`,
        args: [this.binding.spaceId, this.binding.spaceId, receipt.receiptSha256],
      });
      statements.push({ sql: `DELETE FROM oh_authority_operation_records
        WHERE operation_sha256 IN (SELECT operation_sha256 FROM oh_authority_operations WHERE space_id = ?)
          AND ${receiptExists}`,
      args: [this.binding.spaceId, this.binding.spaceId, receipt.receiptSha256] });
      statements.push(guardedDelete("oh_authority_dependencies"));
      statements.push(guardedDelete("oh_authority_records"));
      statements.push(guardedDelete("oh_authority_operations"));
      statements.push(guardedDelete("oh_authority_bindings"));
      statements.push(guardedDelete("oh_authority_spaces"));
      statements.push({ sql: `INSERT INTO oh_authority_commit_guards(value)
        SELECT 'invalid' WHERE EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_operations WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_operation_records WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_operation_records AS materialized
            LEFT JOIN oh_authority_operations AS operation
              ON operation.operation_sha256 = materialized.operation_sha256
            WHERE operation.operation_sha256 IS NULL OR operation.space_id <> materialized.space_id)
          OR EXISTS (SELECT 1 FROM oh_authority_records WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_dependencies WHERE space_id = ?)
          OR NOT ${receiptExists}`,
      args: [this.binding.spaceId, this.binding.spaceId, this.binding.spaceId,
        this.binding.spaceId, this.binding.spaceId, this.binding.spaceId,
        this.binding.spaceId, receipt.receiptSha256] });
      try { await this.#client.batch(statements, "write"); } catch {
        const raced = await this.#readPurge();
        if (raced !== null) {
          await this.#assertPurgeComplete(raced);
          this.#purged = raced;
          return raced;
        }
        continue;
      }
      const persisted = await this.#readPurge();
      if (persisted !== null) {
        await this.#assertPurgeComplete(persisted);
        this.#purged = persisted;
        return persisted;
      }
    }
    throw new OhConflictError("The remote working space changed repeatedly while purging.");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#closeClient) this.#client.close?.();
  }
}

function bindOhLibSqlStoreAuthorityV1(
  client: OhLibSqlClientV1,
  binding: OhStoreBindingV1,
  profile: OhStoreProfileV1,
  closeClient: boolean,
): OhStoreAuthorityV1 {
  const authority = new OhLibSqlStoreV1(client, binding, closeClient);
  const store: OhStoreV1 = Object.freeze({
    binding,
    changesSince: (from: OhHeadRefV1, changeOptions?: Readonly<{ limit?: number; through?: OhHeadRefV1 }>) =>
      authority.changesSince(from, changeOptions),
    close: () => authority.close(),
    commit: (input: OhCommitInputV1) => authority.commit(input),
    exportDependencyClosure: (input: Readonly<{
      head?: OhHeadRefV1;
      maximumRecords?: number;
      roots: readonly string[];
    }>) => authority.exportDependencyClosure(input),
    head: () => authority.head(),
    snapshot: (snapshotOptions?: Readonly<{ head?: OhHeadRefV1; maximumRecords?: number }>) =>
      authority.snapshot(snapshotOptions),
    verify: () => authority.verify(),
  });
  let purge: OhSpacePurgeReceiptV1 | null = null;
  const host: OhStoreHostControlV1 = Object.freeze({
    binding,
    purgeWorkingSpace: async (input: Readonly<{ purgedAt?: string }>) => {
      if (profile.profileKind !== "working" || !profile.capabilities.wholeSpacePurge) {
        throw new OhProfileError("This host handle is not bound to a purgeable working profile.");
      }
      if (purge !== null) return purge;
      purge = await authority.purgeWorkingSpace(input.purgedAt ?? canonicalNow());
      return purge;
    },
  });
  return Object.freeze({ host, store });
}

/** Opens a direct libSQL/Turso authority; this is not operation-log sync. */
export async function createOhLibSqlStoreAuthorityV1(
  client: OhLibSqlClientV1,
  options: OhLibSqlStoreAuthorityOptionsV1 = {},
): Promise<OhStoreAuthorityV1> {
  const profile = parseOhStoreProfileV1(options.profile ?? OH_CANONICAL_STORE_PROFILE_V1);
  if (profile === null) throw new TypeError("Invalid libSQL store profile.");
  const spaceId = options.spaceId ?? "default";
  const binding = createOhStoreBindingV1({ profile,
    realmId: options.realmId ?? `realm:${spaceId}`, spaceId, v: 1 });
  await verifyAuthoritySchema(client);
  await initializeSpace(client, binding);
  return bindOhLibSqlStoreAuthorityV1(client, binding, profile, options.closeClient ?? false);
}

/**
 * Opens an already-bound direct libSQL/Turso authority without creating or
 * updating data. This seam is for separately held read or purge custody that
 * must fail closed instead of acquiring space-creation authority.
 */
export async function openExistingOhLibSqlStoreAuthorityV1(
  client: OhLibSqlClientV1,
  options: OhLibSqlStoreAuthorityOptionsV1 = {},
): Promise<OhStoreAuthorityV1> {
  const profile = parseOhStoreProfileV1(options.profile ?? OH_CANONICAL_STORE_PROFILE_V1);
  if (profile === null) throw new TypeError("Invalid libSQL store profile.");
  const spaceId = options.spaceId ?? "default";
  const binding = createOhStoreBindingV1({ profile,
    realmId: options.realmId ?? `realm:${spaceId}`, spaceId, v: 1 });
  await verifyAuthoritySchema(client);
  await requireExistingSpace(client, binding);
  return bindOhLibSqlStoreAuthorityV1(client, binding, profile, options.closeClient ?? false);
}
