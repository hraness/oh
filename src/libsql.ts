import {
  canonicalJson,
  canonicalNow,
  canonicalSha256,
  parseSha256Hex,
  safeCode,
  type Sha256Hex,
} from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import { canonicalKnowledgeGraphChangesV1, parseKnowledgeGraphRecordV1,
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

const AUTHORITY_SCHEMA_NAME = "oh.libsql-authority.v1";
const AUTHORITY_SCHEMA_VERSION = 1;
const EMPTY_RECORDS_SHA256 = canonicalSha256([]);

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
]);

const AUTHORITY_SCHEMA_SHA256 = canonicalSha256(AUTHORITY_SCHEMA_STATEMENTS);

function rowValue(
  row: Readonly<Record<string, unknown>> | readonly unknown[],
  key: string,
  index: number,
): unknown {
  return Array.isArray(row) ? row[index] : (row as Readonly<Record<string, unknown>>)[key];
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
}

/** One-time schema operation for a client authorized to create authority tables. */
export async function bootstrapOhLibSqlAuthorityV1(
  client: OhLibSqlClientV1,
): Promise<Readonly<{ schemaSha256: Sha256Hex; schemaVersion: 1; v: 1 }>> {
  await client.execute(`CREATE TABLE IF NOT EXISTS oh_authority_schemas (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    schema_sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = await queryOne(client, { sql: `SELECT name, schema_sha256
    FROM oh_authority_schemas WHERE version = ?`, args: [AUTHORITY_SCHEMA_VERSION] });
  if (applied !== null && (rowValue(applied, "name", 0) !== AUTHORITY_SCHEMA_NAME
    || rowValue(applied, "schema_sha256", 1) !== AUTHORITY_SCHEMA_SHA256)) {
    throw new OhIntegrityError("The installed libSQL authority schema differs from this runtime.");
  }
  const setup: OhLibSqlStatementV1[] = AUTHORITY_SCHEMA_STATEMENTS.map((sql) => ({ sql }));
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
  const purged = await queryOne(client, { sql: "SELECT receipt_json FROM oh_authority_purges WHERE space_id = ?",
    args: [binding.spaceId] });
  if (purged !== null) {
    const json = rowValue(purged, "receipt_json", 0);
    if (typeof json !== "string") throw new OhIntegrityError("A remote purge receipt is invalid.");
    const receipt = parseOhSpacePurgeReceiptV1(JSON.parse(json));
    if (receipt === null || canonicalJson(receipt) !== json) throw new OhIntegrityError("A remote purge receipt is invalid.");
    throw new OhPurgedSpaceError(receipt);
  }
  const now = canonicalNow();
  await client.batch([
    { sql: `INSERT INTO oh_authority_spaces(space_id, contract_id, generation,
      head_operation_sha256, graph_revision_sha256, records_sha256, sequence, created_at, updated_at)
      VALUES (?, ?, 0, NULL, NULL, ?, 0, ?, ?) ON CONFLICT(space_id) DO NOTHING`,
      args: [binding.spaceId, OH_CONTRACT_MANIFEST_V1.contractId, EMPTY_RECORDS_SHA256, now, now] },
    { sql: `INSERT INTO oh_authority_bindings(space_id, realm_id, profile_id, profile_kind,
      profile_sha256, binding_sha256, binding_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(space_id) DO NOTHING`,
      args: [binding.spaceId, binding.realmId, binding.profile.profileId, binding.profile.profileKind,
        binding.profile.profileSha256, binding.bindingSha256, canonicalJson(binding), now] },
  ], "write");
  const persisted = await queryOne(client, { sql: "SELECT binding_json FROM oh_authority_bindings WHERE space_id = ?",
    args: [binding.spaceId] });
  if (persisted === null || rowValue(persisted, "binding_json", 0) !== canonicalJson(binding)) {
    throw new OhProfileError("The remote space is already bound to a different realm or profile.");
  }
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
    const row = await queryOne(this.#client, { sql: "SELECT receipt_json FROM oh_authority_purges WHERE space_id = ?",
      args: [this.binding.spaceId] });
    if (row === null) return null;
    const json = rowValue(row, "receipt_json", 0);
    if (typeof json !== "string") throw new OhIntegrityError("A remote purge receipt is invalid.");
    const receipt = parseOhSpacePurgeReceiptV1(JSON.parse(json));
    if (receipt === null || canonicalJson(receipt) !== json) throw new OhIntegrityError("A remote purge receipt is invalid.");
    return receipt;
  }

  async #headAt(reference: OhHeadRefV1): Promise<OhHeadV1> {
    const parsed = parseOhHeadRefV1(reference);
    if (parsed === null) throw new TypeError("Invalid Oh head reference.");
    if (parsed.sequence === 0) return emptyOhHeadV1();
    const row = await queryOne(this.#client, { sql: `SELECT operation_json FROM oh_authority_operations
      WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, parsed.sequence] });
    if (row === null) throw new OhConflictError("The requested head is not present in this space.");
    const operation = parseOperationJson(rowValue(row, "operation_json", 0));
    if (operation.operationSha256 !== parsed.operationSha256) {
      throw new OhConflictError("The requested sequence identifies a different operation head.");
    }
    return { generation: operation.sequence, graphRevisionSha256: operation.graphRevisionSha256,
      operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
      sequence: operation.sequence, v: 1 };
  }

  async snapshot(options: Readonly<{
    head?: OhHeadRefV1;
    maximumRecords?: number;
  }> = {}): Promise<OhSnapshotV1> {
    this.#assertOpen();
    const current = await this.head();
    const target = options.head === undefined ? current : await this.#headAt(options.head);
    if (target.sequence > current.sequence) throw new OhConflictError("The requested head is ahead of this space.");
    const rows = (await this.#client.execute({ sql: `SELECT operation_json FROM oh_authority_operations
      WHERE space_id = ? AND sequence <= ? ORDER BY sequence`, args: [this.binding.spaceId, target.sequence] })).rows;
    const operations = rows.map((row) => parseOperationJson(rowValue(row, "operation_json", 0)));
    const snapshot = replayOhOperationsV1(this.binding.spaceId, operations, options.maximumRecords);
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
    const limit = normalizeLimit(options.limit);
    const current = await this.head();
    const fromHead = await this.#headAt(from);
    const through = options.through === undefined ? current : await this.#headAt(options.through);
    if (fromHead.sequence > through.sequence || through.sequence > current.sequence) {
      throw new OhConflictError("The change-feed bounds do not identify one remote history prefix.");
    }
    const rows = (await this.#client.execute({ sql: `SELECT operation_json FROM oh_authority_operations
      WHERE space_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence LIMIT ?`,
      args: [this.binding.spaceId, fromHead.sequence, through.sequence, limit + 1] })).rows;
    const parsed = rows.map((row) => parseOperationJson(rowValue(row, "operation_json", 0)));
    const hasMore = parsed.length > limit;
    const operations = parsed.slice(0, limit);
    let prior: OhHeadRefV1 = fromHead;
    for (const operation of operations) {
      if (operation.sequence !== prior.sequence + 1
        || operation.parentOperationSha256 !== prior.operationSha256) {
        throw new OhIntegrityError("The remote change feed contains a gap or fork.");
      }
      prior = { operationSha256: operation.operationSha256, sequence: operation.sequence };
    }
    return { from: { operationSha256: fromHead.operationSha256, sequence: fromHead.sequence },
      hasMore, operations, through, to: prior, v: 1 };
  }

  async #assertMaterializedSnapshot(snapshot: OhSnapshotV1): Promise<void> {
    const rows = (await this.#client.execute({ sql: `SELECT record_json FROM oh_authority_records
      WHERE space_id = ? ORDER BY record_key`, args: [this.binding.spaceId] })).rows;
    const records: KnowledgeGraphRecordV1[] = rows.map((row) => {
      const json = rowValue(row, "record_json", 0);
      if (typeof json !== "string") throw new OhIntegrityError("A materialized remote record is not JSON text.");
      const parsed = parseKnowledgeGraphRecordV1(JSON.parse(json));
      if (parsed === null || canonicalJson(parsed) !== json) throw new OhIntegrityError("A materialized remote record is invalid.");
      return parsed;
    });
    if (canonicalJson(records) !== canonicalJson(snapshot.records)) {
      throw new OhIntegrityError("Remote materialized records do not match operation replay.");
    }
    const dependencyRows = (await this.#client.execute({ sql: `SELECT record_key, dependency_key
      FROM oh_authority_dependencies WHERE space_id = ? ORDER BY record_key, dependency_key`,
      args: [this.binding.spaceId] })).rows.map((row) => ({
        dependency_key: rowValue(row, "dependency_key", 1),
        record_key: rowValue(row, "record_key", 0),
      }));
    const expectedDependencies = snapshot.records.flatMap((record) =>
      record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })));
    if (canonicalJson(dependencyRows) !== canonicalJson(expectedDependencies)) {
      throw new OhIntegrityError("Remote materialized dependencies do not match operation replay.");
    }
  }

  async #operationById(operationId: string): Promise<OhOperationV1 | null> {
    const row = await queryOne(this.#client, { sql: `SELECT operation_json FROM oh_authority_operations
      WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId] });
    return row === null ? null : parseOperationJson(rowValue(row, "operation_json", 0));
  }

  async commit(input: OhCommitInputV1): Promise<OhOperationV1> {
    this.#assertOpen();
    const actorId = safeCode(input.actorId);
    const operationId = safeCode(input.operationId);
    const changes = canonicalKnowledgeGraphChangesV1(input.changes);
    if (actorId === null || operationId === null || changes.length === 0) throw new TypeError("Invalid Oh commit input.");
    const duplicate = await this.#operationById(operationId);
    if (duplicate !== null) {
      if (duplicate.actorId !== actorId || canonicalJson(duplicate.changes) !== canonicalJson(changes)) {
        throw new OhConflictError("The operation ID is already bound to different content.");
      }
      return duplicate;
    }
    const current = await this.head();
    if (!Number.isSafeInteger(input.expectedHead.generation) || input.expectedHead.generation < 0
      || current.generation !== input.expectedHead.generation
      || current.operationSha256 !== input.expectedHead.operationSha256) {
      throw new OhConflictError("The expected head does not match the current remote space head.");
    }
    const snapshot = await this.snapshot({ head: current });
    await this.#assertMaterializedSnapshot(snapshot);
    const transition = transitionOhSnapshotV1({ actorId, changes,
      instant: input.instant ?? canonicalNow(), operationId, snapshot, spaceId: this.binding.spaceId });
    const operation = transition.operation;
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
      statements.push({ sql: `INSERT INTO oh_authority_operation_records(operation_sha256,
        ordinal, record_key, change_kind, record_sha256)
        SELECT ?, ?, ?, ?, ? WHERE ${existsOperation}`,
      args: [operation.operationSha256, ordinal, key, change.kind, digest, operation.operationSha256] });
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
    try {
      await this.#client.batch(statements, "write");
    } catch (error) {
      const raced = await this.#operationById(operationId);
      if (raced !== null && raced.actorId === actorId
        && canonicalJson(raced.changes) === canonicalJson(changes)) return raced;
      const head = await this.head();
      if (head.operationSha256 !== current.operationSha256) {
        throw new OhConflictError("The remote space head changed while committing.");
      }
      throw error;
    }
    const persisted = await this.#operationById(operationId);
    if (persisted === null || canonicalJson(persisted) !== canonicalJson(operation)) {
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
    const countRow = await queryOne(this.#client, { sql: `SELECT count(*) AS count
      FROM oh_authority_operations WHERE space_id = ?`, args: [this.binding.spaceId] });
    const operations = countRow === null ? null : integer(rowValue(countRow, "count", 0));
    if (operations === null || operations !== snapshot.head.sequence) {
      throw new OhIntegrityError("Remote operation count does not match its head.");
    }
    return { head: snapshot.head, integrity: "verified", operations,
      records: snapshot.records.length, v: 1 };
  }

  async purgeWorkingSpace(purgedAt: string): Promise<OhSpacePurgeReceiptV1> {
    this.#assertOpen();
    if (this.binding.profile.profileKind !== "working"
      || !this.binding.profile.capabilities.wholeSpacePurge) {
      throw new OhProfileError("Whole-space purge requires a bound working profile.");
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await this.#readPurge();
      if (existing !== null) { this.#purged = existing; return existing; }
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
      statements.push({ sql: `DELETE FROM oh_authority_operation_records WHERE operation_sha256 IN
        (SELECT operation_sha256 FROM oh_authority_operations WHERE space_id = ?)
        AND ${receiptExists}`,
      args: [this.binding.spaceId, this.binding.spaceId, receipt.receiptSha256] });
      statements.push(guardedDelete("oh_authority_dependencies"));
      statements.push(guardedDelete("oh_authority_records"));
      statements.push(guardedDelete("oh_authority_operations"));
      statements.push(guardedDelete("oh_authority_bindings"));
      statements.push(guardedDelete("oh_authority_spaces"));
      statements.push({ sql: `INSERT INTO oh_authority_commit_guards(value)
        SELECT 'invalid' WHERE EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
          OR NOT ${receiptExists}`,
      args: [this.binding.spaceId, this.binding.spaceId, receipt.receiptSha256] });
      try { await this.#client.batch(statements, "write"); } catch {
        const raced = await this.#readPurge();
        if (raced !== null) { this.#purged = raced; return raced; }
        continue;
      }
      const persisted = await this.#readPurge();
      if (persisted !== null) { this.#purged = persisted; return persisted; }
    }
    throw new OhConflictError("The remote working space changed repeatedly while purging.");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#closeClient) this.#client.close?.();
  }
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
  const authority = new OhLibSqlStoreV1(client, binding, options.closeClient ?? false);
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
