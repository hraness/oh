import { Deferred, Effect, Either, Ref } from "effect";
import {
  canonicalJson,
  canonicalSha256,
  parseSha256Hex,
  safeCode,
  utf8ByteLength,
  type Sha256Hex,
} from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import {
  canonicalKnowledgeGraphChangesV1,
  knowledgeGraphRecordRefV1,
  OH_GRAPH_LIMITS_V1,
  parseKnowledgeGraphRecordV1,
  type KnowledgeGraphRecordV1,
} from "./graph";
import { OH_OPERATION_MAX_BYTES_V1, type OhOperationV1 } from "./operation";
import {
  createOhDependencyClosureV1,
  createOhSpacePurgeReceiptV1,
  createOhStoreBindingV1,
  emptyOhHeadV1,
  OH_CANONICAL_STORE_PROFILE_V1,
  OH_WORKING_STORE_PROFILE_V1,
  OhConflictError,
  OhIntegrityError,
  OhOperationSizeError,
  OhProfileError,
  OhPurgedSpaceError,
  parseOhHeadRefV1,
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
  type OhStoreBindingV1,
  type OhStoreVerificationV1,
} from "./store";
import {
  type OhLibSqlStatementV1,
  type OhLibSqlResultV1,
  type OhLibSqlStoreAuthorityOptionsV1,
  OH_LIBSQL_STORE_LIMITS_V1,
  AUTHORITY_SCHEMA_NAME,
  AUTHORITY_SCHEMA_VERSION,
  EMPTY_RECORDS_SHA256,
  PURGE_ROW_SELECT,
  BINDING_ROW_SELECT,
  SPACE_PURGE_PROOF_SELECT,
  OPERATION_ROW_COLUMNS,
  OPERATION_RESPONSE_BYTES,
  RECORD_RESPONSE_BYTES,
  DEPENDENCY_RESPONSE_BYTES,
  OPERATION_RECORD_RESPONSE_BYTES,
  AUTHORITY_SCHEMA_TABLE_STATEMENT,
  AUTHORITY_SCHEMA_STATEMENTS,
  normalizedSchemaSql,
  AUTHORITY_SCHEMA_OBJECTS,
  AUTHORITY_SCHEMA_SHA256,
  rowValue,
  integer,
  normalizeLimit,
  parseOperationRow,
  parseBindingRow,
  parsePurgeReceiptRow,
  parseHeadRow,
  PURGE_PAYLOAD_TABLES,
} from "./libsql-model";
import {
  libSqlValue,
  libSqlFailure,
  type LibSqlFailure,
  type LibSqlAuthorityClientService,
} from "./libsql-platform";

function queryOne(
  client: LibSqlAuthorityClientService,
  statement: OhLibSqlStatementV1,
): Effect.Effect<Readonly<Record<string, unknown>> | readonly unknown[] | null, LibSqlFailure> {
  return Effect.gen(function* () {
    return (yield* client.execute(statement)).rows[0] ?? null;
  });
}

function verifyAuthoritySchemaObjects(client: LibSqlAuthorityClientService): Effect.Effect<void, LibSqlFailure> {
  return Effect.gen(function* () {
    const rows = (yield* client.execute({
      sql: `SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND (name = 'oh_authority_schemas' OR name GLOB 'oh_authority_*'
      OR tbl_name GLOB 'oh_authority_*')
    ORDER BY type, name` })).rows;
    const actual = (yield* libSqlValue(() => rows.map((row) => {
      const type = rowValue(row, "type", 0);
      const name = rowValue(row, "name", 1);
      const tableName = rowValue(row, "tbl_name", 2);
      const sql = rowValue(row, "sql", 3);
      if ((type !== "table" && type !== "index" && type !== "trigger") || typeof name !== "string"
        || typeof tableName !== "string" || typeof sql !== "string") {
        throw new OhIntegrityError("The installed libSQL authority has an invalid schema object.");
      }
      return { name, sql: normalizedSchemaSql(sql), tableName, type };
    })));
    if ((yield* libSqlValue(() => canonicalJson(actual))) !== (yield* libSqlValue(() => canonicalJson(AUTHORITY_SCHEMA_OBJECTS)))) {
      return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The installed libSQL authority objects differ from this runtime.")));
    }
  });
}

function verifyAuthoritySchema(client: LibSqlAuthorityClientService): Effect.Effect<void, LibSqlFailure> {
  return Effect.gen(function* () {
    const installed = yield* queryOne(client, {
      sql: `SELECT name, schema_sha256
    FROM oh_authority_schemas WHERE version = ?`, args: [AUTHORITY_SCHEMA_VERSION]
    });
    if (installed === null || rowValue(installed, "name", 0) !== AUTHORITY_SCHEMA_NAME
      || rowValue(installed, "schema_sha256", 1) !== AUTHORITY_SCHEMA_SHA256) {
      return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The installed libSQL authority schema differs from this runtime.")));
    }
    const contract = yield* queryOne(client, {
      sql: `SELECT contract_sha256, manifest_json
    FROM oh_authority_contracts WHERE contract_id = ?`, args: [OH_CONTRACT_MANIFEST_V1.contractId]
    });
    if (contract === null || rowValue(contract, "contract_sha256", 0) !== OH_CONTRACT_MANIFEST_V1.contractSha256
      || rowValue(contract, "manifest_json", 1) !== (yield* libSqlValue(() => canonicalJson(OH_CONTRACT_MANIFEST_V1)))) {
      return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority contract differs from this runtime.")));
    }
    yield* verifyAuthoritySchemaObjects(client);
  });
}

/** One-time schema operation for a client authorized to create authority tables. */
export function bootstrapAuthority(
  client: LibSqlAuthorityClientService,
): Effect.Effect<Readonly<{ schemaSha256: Sha256Hex; schemaVersion: 1; v: 1 }>, LibSqlFailure> {
  return Effect.gen(function* () {
    const existingObjects = (yield* client.execute({
      sql: `SELECT name FROM sqlite_schema
    WHERE sql IS NOT NULL AND (name = 'oh_authority_schemas' OR name GLOB 'oh_authority_*'
      OR tbl_name GLOB 'oh_authority_*')` })).rows;
    if (existingObjects.length > 0) {
      if (!(yield* libSqlValue(() => existingObjects.some((row) => rowValue(row, "name", 0) === "oh_authority_schemas")))) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("Refusing to bootstrap over preexisting Oh authority objects.")));
      }
      yield* verifyAuthoritySchema(client);
      return { schemaSha256: AUTHORITY_SCHEMA_SHA256, schemaVersion: 1, v: 1 };
    }
    const setup: OhLibSqlStatementV1[] = (yield* libSqlValue(() => [AUTHORITY_SCHEMA_TABLE_STATEMENT, ...AUTHORITY_SCHEMA_STATEMENTS]
      .map((sql) => ({ sql }))));
    setup.push({
      sql: `INSERT INTO oh_authority_schemas(version, name, schema_sha256, applied_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(version) DO NOTHING`,
      args: [AUTHORITY_SCHEMA_VERSION, AUTHORITY_SCHEMA_NAME, AUTHORITY_SCHEMA_SHA256, (yield* client.currentInstant)]
    });
    setup.push({
      sql: `INSERT INTO oh_authority_contracts(contract_id, contract_sha256, manifest_json)
    VALUES (?, ?, ?) ON CONFLICT(contract_id) DO NOTHING`, args: [OH_CONTRACT_MANIFEST_V1.contractId,
      OH_CONTRACT_MANIFEST_V1.contractSha256, (yield* libSqlValue(() => canonicalJson(OH_CONTRACT_MANIFEST_V1)))]
    });
    yield* client.batch(setup, "write");
    yield* verifyAuthoritySchema(client);
    return { schemaSha256: AUTHORITY_SCHEMA_SHA256, schemaVersion: 1, v: 1 };
  });
}

function initializeSpace(
  client: LibSqlAuthorityClientService,
  binding: OhStoreBindingV1,
): Effect.Effect<void, LibSqlFailure> {
  return Effect.gen(function* () {
    const purged = yield* queryOne(client, {
      sql: PURGE_ROW_SELECT,
      args: [binding.spaceId]
    });
    if (purged !== null) return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError((yield* libSqlValue(() => parsePurgeReceiptRow(
      purged, binding.spaceId, binding.bindingSha256))))));
    const now = yield* client.currentInstant;
    const attempt = yield* Effect.either(client.batch([
      {
        sql: `INSERT INTO oh_authority_spaces(space_id, contract_id, generation,
      head_operation_sha256, graph_revision_sha256, records_sha256, sequence, created_at, updated_at)
      SELECT ?, ?, 0, NULL, NULL, ?, 0, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ?)
      ON CONFLICT(space_id) DO NOTHING`,
        args: [binding.spaceId, OH_CONTRACT_MANIFEST_V1.contractId, EMPTY_RECORDS_SHA256, now, now,
        binding.spaceId]
      },
      {
        sql: `INSERT INTO oh_authority_bindings(space_id, realm_id, profile_id, profile_kind,
      profile_sha256, binding_sha256, binding_json, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ?)
        AND EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
      ON CONFLICT(space_id) DO NOTHING`,
        args: [binding.spaceId, binding.realmId, binding.profile.profileId, binding.profile.profileKind,
        binding.profile.profileSha256, binding.bindingSha256, (yield* libSqlValue(() => canonicalJson(binding))), now,
        binding.spaceId, binding.spaceId]
      },
      {
        sql: `INSERT INTO oh_authority_commit_guards(value)
      SELECT 'invalid' WHERE EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ?)
        OR NOT EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
        OR NOT EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ? AND binding_sha256 = ?)`,
        args: [binding.spaceId, binding.spaceId, binding.spaceId, binding.bindingSha256]
      },
    ], "write"));
    if (Either.isLeft(attempt)) {
      const error = attempt.left;
      const raced = yield* queryOne(client, {
        sql: PURGE_ROW_SELECT,
        args: [binding.spaceId]
      });
      if (raced !== null) return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError((yield* libSqlValue(() => parsePurgeReceiptRow(
        raced, binding.spaceId, binding.bindingSha256))))));
      const persisted = yield* queryOne(client, { sql: BINDING_ROW_SELECT, args: [binding.spaceId] });
      if (persisted !== null
        && (yield* libSqlValue(() => canonicalJson(parseBindingRow(persisted, binding.spaceId)))) !== (yield* libSqlValue(() => canonicalJson(binding)))) {
        return yield* Effect.fail(libSqlFailure(new OhProfileError("The remote space is already bound to a different realm or profile.")));
      }
      return yield* Effect.fail(error);
    }
    const persisted = yield* queryOne(client, { sql: BINDING_ROW_SELECT, args: [binding.spaceId] });
    if (persisted === null) {
      const raced = yield* queryOne(client, {
        sql: PURGE_ROW_SELECT,
        args: [binding.spaceId]
      });
      if (raced !== null) return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError((yield* libSqlValue(() => parsePurgeReceiptRow(
        raced, binding.spaceId, binding.bindingSha256))))));
      return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote space has no persisted binding after initialization.")));
    }
    if ((yield* libSqlValue(() => canonicalJson(parseBindingRow(persisted, binding.spaceId)))) !== (yield* libSqlValue(() => canonicalJson(binding)))) {
      return yield* Effect.fail(libSqlFailure(new OhProfileError("The remote space is already bound to a different realm or profile.")));
    }
  });
}

function requireExistingSpace(
  client: LibSqlAuthorityClientService,
  binding: OhStoreBindingV1,
): Effect.Effect<void, LibSqlFailure> {
  return Effect.gen(function* () {
    const results = yield* client.batch([
      { sql: BINDING_ROW_SELECT, args: [binding.spaceId] },
      {
        sql: `SELECT generation, graph_revision_sha256, head_operation_sha256,
      records_sha256, sequence, contract_id FROM oh_authority_spaces WHERE space_id = ?`,
        args: [binding.spaceId]
      },
      { sql: PURGE_ROW_SELECT, args: [binding.spaceId] },
    ], "read");
    if (results.length !== 3) {
      return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete existing-space proof.")));
    }
    const [bindingResult, spaceResult, purgeResult] = results as
      [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1];
    const purgeRow = purgeResult.rows[0];
    if (purgeRow !== undefined) {
      return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError((yield* libSqlValue(() => parsePurgeReceiptRow(
        purgeRow, binding.spaceId, binding.bindingSha256))))));
    }
    const bindingRow = bindingResult.rows[0];
    const spaceRow = spaceResult.rows[0];
    if (bindingRow === undefined || spaceRow === undefined) {
      return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The requested remote Oh space does not already exist.")));
    }
    const persisted = (yield* libSqlValue(() => parseBindingRow(bindingRow, binding.spaceId)));
    if ((yield* libSqlValue(() => canonicalJson(persisted))) !== (yield* libSqlValue(() => canonicalJson(binding)))) {
      return yield* Effect.fail(libSqlFailure(new OhProfileError("The remote space is bound to a different realm or profile.")));
    }
    if (rowValue(spaceRow, "contract_id", 5) !== OH_CONTRACT_MANIFEST_V1.contractId) {
      return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The existing remote space uses a different Oh contract.")));
    }
    (yield* libSqlValue(() => parseHeadRow(spaceRow)));
  });
}

function assertRemotePurgeComplete(
  client: LibSqlAuthorityClientService,
  binding: OhStoreBindingV1,
  expected: OhSpacePurgeReceiptV1,
): Effect.Effect<void, LibSqlFailure> {
  return Effect.gen(function* () {
    const results = yield* client.batch([
      { sql: PURGE_ROW_SELECT, args: [binding.spaceId] },
      ...(yield* libSqlValue(() => PURGE_PAYLOAD_TABLES.map((table) => ({
        sql: `SELECT count(*) AS count FROM ${table} WHERE space_id = ?`,
        args: [binding.spaceId],
      })))),
      {
        sql: `SELECT count(*) AS count FROM oh_authority_operation_records AS materialized
      LEFT JOIN oh_authority_operations AS operation
        ON operation.operation_sha256 = materialized.operation_sha256
      WHERE operation.operation_sha256 IS NULL OR operation.space_id <> materialized.space_id` },
    ], "read");
    const receiptRow = results[0]?.rows[0];
    if (receiptRow === undefined
      || (yield* libSqlValue(() => canonicalJson(parsePurgeReceiptRow(receiptRow, binding.spaceId,
        binding.bindingSha256)))) !== (yield* libSqlValue(() => canonicalJson(expected)))) {
      return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote purge receipt differs from the requested purge.")));
    }
    for (let index = 0; index < PURGE_PAYLOAD_TABLES.length; index += 1) {
      const countRow = results[index + 1]?.rows[0];
      if (countRow === undefined || integer(rowValue(countRow, "count", 0)) !== 0) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError(`Remote purge left rows in ${PURGE_PAYLOAD_TABLES[index]}.`)));
      }
    }
    const orphanRow = results[PURGE_PAYLOAD_TABLES.length + 1]?.rows[0];
    if (orphanRow === undefined || integer(rowValue(orphanRow, "count", 0)) !== 0) {
      return yield* Effect.fail(libSqlFailure(new OhIntegrityError("Remote purge left an orphaned or cross-space operation record.")));
    }
  });
}

export class LibSqlStoreProgram {
  readonly binding: OhStoreBindingV1;
  readonly #client: LibSqlAuthorityClientService;
  #purged: OhSpacePurgeReceiptV1 | null = null;
  #hostPurge: OhSpacePurgeReceiptV1 | null = null;

  constructor(client: LibSqlAuthorityClientService, binding: OhStoreBindingV1) {
    this.#client = client;
    this.binding = binding;
  }

  closedFailure(): LibSqlFailure {
    return this.#purged === null
      ? { _tag: "LibSqlClosed", cause: new Error("The Oh libSQL store is closed.") }
      : libSqlFailure(new OhPurgedSpaceError(this.#purged));
  }

  purgeFromHost(input: Readonly<{ purgedAt?: string }>): Effect.Effect<OhSpacePurgeReceiptV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      if (this.binding.profile.profileKind !== "working" || !this.binding.profile.capabilities.wholeSpacePurge) {
        return yield* Effect.fail(libSqlFailure(new OhProfileError("This host handle is not bound to a purgeable working profile.")));
      }
      if (this.#hostPurge !== null) return this.#hostPurge;
      this.#hostPurge = yield* this.purgeWorkingSpace(input.purgedAt ?? (yield* this.#client.currentInstant));
      return this.#hostPurge;
    });
  }

  #assertOpen(): void {
    if (this.#purged !== null) throw new OhPurgedSpaceError(this.#purged);
  }

  head(): Effect.Effect<OhHeadV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      yield* libSqlValue(() => this.#assertOpen());
      const row = yield* queryOne(this.#client, {
        sql: `SELECT generation, graph_revision_sha256,
      head_operation_sha256, records_sha256, sequence FROM oh_authority_spaces WHERE space_id = ?`,
        args: [this.binding.spaceId]
      });
      if (row === null) {
        const purged = yield* this.#readPurge();
        if (purged !== null) { this.#purged = purged; return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError(purged))); }
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote Oh space does not exist.")));
      }
      return (yield* libSqlValue(() => parseHeadRow(row)));
    });
  }

  #readPurge(): Effect.Effect<OhSpacePurgeReceiptV1 | null, LibSqlFailure> {
    return Effect.gen(this, function* () {
      const row = yield* queryOne(this.#client, {
        sql: PURGE_ROW_SELECT,
        args: [this.binding.spaceId]
      });
      if (row === null) return null;
      return (yield* libSqlValue(() => parsePurgeReceiptRow(row, this.binding.spaceId, this.binding.bindingSha256)));
    });
  }

  #headAt(reference: OhHeadRefV1): Effect.Effect<OhHeadV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      const parsed = (yield* libSqlValue(() => parseOhHeadRefV1(reference)));
      if (parsed === null) return yield* Effect.fail(libSqlFailure(new TypeError("Invalid Oh head reference.")));
      if (parsed.sequence === 0) return emptyOhHeadV1();
      const row = yield* queryOne(this.#client, {
        sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
      WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, parsed.sequence]
      });
      if (row === null) return yield* Effect.fail(libSqlFailure(new OhConflictError("The requested head is not present in this space.")));
      const operation = (yield* libSqlValue(() => parseOperationRow(row, { spaceId: this.binding.spaceId })));
      if (operation.spaceId !== this.binding.spaceId || operation.sequence !== parsed.sequence
        || operation.operationSha256 !== parsed.operationSha256) {
        return yield* Effect.fail(libSqlFailure(new OhConflictError("The requested sequence identifies a different operation head.")));
      }
      return {
        generation: operation.sequence, graphRevisionSha256: operation.graphRevisionSha256,
        operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
        sequence: operation.sequence, v: 1
      };
    });
  }

  #currentMaterializedSnapshot(expectedHead: OhHeadV1, maximumRecords: number): Effect.Effect<OhSnapshotV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      const provenancePredicate = `operation.space_id = ? AND (operation.operation_sha256 IS ?
      OR operation.operation_sha256 IN (SELECT record.operation_sha256
        FROM oh_authority_records AS record WHERE record.space_id = ?))`;
      const results = yield* this.#client.batch([
        {
          sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId]
        },
        {
          sql: `SELECT
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
          this.binding.spaceId, this.binding.spaceId, this.binding.spaceId]
        },
        {
          sql: `SELECT record_key, kind, record_sha256, record_json, operation_sha256, sequence
        FROM oh_authority_records AS record WHERE record.space_id = ?
          AND (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0)
            FROM oh_authority_records AS record WHERE record.space_id = ?) <= ? ORDER BY record_key`, args: [this.binding.spaceId,
          this.binding.spaceId, OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes]
        },
        {
          sql: `SELECT record_key, dependency_key FROM oh_authority_dependencies
        AS dependency WHERE dependency.space_id = ?
          AND (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
            FROM oh_authority_dependencies AS dependency WHERE dependency.space_id = ?) <= ?
        ORDER BY record_key, dependency_key`,
          args: [this.binding.spaceId, this.binding.spaceId, OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes]
        },
        {
          sql: `SELECT ${OPERATION_ROW_COLUMNS}
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
          OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes]
        },
        {
          sql: `SELECT count(*) AS count, min(sequence) AS minimum, max(sequence) AS maximum
        FROM oh_authority_operations WHERE space_id = ?`, args: [this.binding.spaceId]
        },
      ], "read");
      if (results.length !== 6) return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete snapshot batch.")));
      const [headResult, sizeResult, recordResult, dependencyResult, provenanceResult, historyResult] = results as
        [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1,
          OhLibSqlResultV1, OhLibSqlResultV1];
      const headRow = headResult.rows[0];
      if (headRow === undefined) {
        const purge = yield* this.#readPurge();
        if (purge !== null) { this.#purged = purge; return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError(purge))); }
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote Oh space disappeared while reading its snapshot.")));
      }
      const head = (yield* libSqlValue(() => parseHeadRow(headRow)));
      if ((yield* libSqlValue(() => canonicalJson(head))) !== (yield* libSqlValue(() => canonicalJson(expectedHead)))) {
        return yield* Effect.fail(libSqlFailure(new OhConflictError("The remote space head changed while reading its current snapshot.")));
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
        return yield* Effect.fail(libSqlFailure(new RangeError("The current libSQL materialization exceeds its provider-safe response bounds.")));
      }
      if (recordResult.rows.length !== recordCount || provenanceResult.rows.length !== provenanceOperations) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The provider-safe snapshot queries omitted bounded authority rows.")));
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
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote operation history does not exactly cover its current head.")));
      }
      if (recordResult.rows.length > maximumRecords) {
        return yield* Effect.fail(libSqlFailure(new RangeError("The remote graph exceeds the requested record snapshot bound.")));
      }
      const provenanceBySha256 = new Map<Sha256Hex, OhOperationV1>();
      for (const row of provenanceResult.rows) {
        const operation = (yield* libSqlValue(() => parseOperationRow(row, { spaceId: this.binding.spaceId })));
        if (provenanceBySha256.has(operation.operationSha256)) {
          return yield* Effect.fail(libSqlFailure(new OhIntegrityError("A current materialization provenance operation is invalid.")));
        }
        provenanceBySha256.set(operation.operationSha256, operation);
      }
      if (provenanceBySha256.size !== provenanceOperations
        || (head.operationSha256 !== null && !provenanceBySha256.has(head.operationSha256))) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The current materialization omitted required provenance operations.")));
      }
      if (head.sequence > 0) {
        const terminal = head.operationSha256 === null ? undefined : provenanceBySha256.get(head.operationSha256);
        if (terminal === undefined || terminal.sequence !== head.sequence
          || terminal.graphRevisionSha256 !== head.graphRevisionSha256
          || terminal.recordsSha256 !== head.recordsSha256) {
          return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote space head differs from its terminal canonical operation.")));
        }
      }
      const materialized = (yield* libSqlValue(() => recordResult.rows.map((row) => {
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
      })));
      const records = (yield* libSqlValue(() => materialized.map(({ record }) => record)));
      if ((yield* libSqlValue(() => canonicalSha256(records.map(knowledgeGraphRecordRefV1)))) !== head.recordsSha256) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("Materialized remote records do not reproduce the current head.")));
      }
      const dependencyRows = (yield* libSqlValue(() => dependencyResult.rows.map((row) => ({
        dependency_key: rowValue(row, "dependency_key", 1),
        record_key: rowValue(row, "record_key", 0),
      }))));
      const expectedDependencies = (yield* libSqlValue(() => records.flatMap((record) =>
        record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })))));
      if ((yield* libSqlValue(() => canonicalJson(dependencyRows))) !== (yield* libSqlValue(() => canonicalJson(expectedDependencies)))) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("Materialized remote dependencies do not match their record envelopes.")));
      }
      return { head, records, v: 1 };
    });
  }

  snapshot(options: Readonly<{
    head?: OhHeadRefV1;
    maximumRecords?: number;
  }> = {}): Effect.Effect<OhSnapshotV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      yield* libSqlValue(() => this.#assertOpen());
      const current = yield* this.head();
      const target = options.head === undefined ? current : yield* this.#headAt(options.head);
      if (target.sequence > current.sequence) return yield* Effect.fail(libSqlFailure(new OhConflictError("The requested head is ahead of this space.")));
      const maximumRecords = options.maximumRecords ?? OH_GRAPH_LIMITS_V1.recordsPerSnapshot;
      if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1
        || maximumRecords > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
        return yield* Effect.fail(libSqlFailure(new RangeError(`maximumRecords must be an integer from 1 through ${OH_GRAPH_LIMITS_V1.recordsPerSnapshot}.`)));
      }
      if (target.operationSha256 === current.operationSha256) {
        return yield* this.#currentMaterializedSnapshot(current, maximumRecords);
      }
      if (target.sequence > OH_LIBSQL_STORE_LIMITS_V1.historyOperations) {
        return yield* Effect.fail(libSqlFailure(new RangeError("The requested libSQL history exceeds its operation replay bound.")));
      }
      const historyResults = yield* this.#client.batch([
        {
          sql: `SELECT count(*) AS count, min(operation.sequence) AS minimum,
          max(operation.sequence) AS maximum,
          coalesce(sum(length(CAST(operation.operation_json AS BLOB))), 0) AS canonical_bytes,
          coalesce(sum(${OPERATION_RESPONSE_BYTES}), 0) AS response_bytes
        FROM oh_authority_operations AS operation
        WHERE operation.space_id = ? AND operation.sequence <= ?`,
          args: [this.binding.spaceId, target.sequence]
        },
        {
          sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations AS operation
        WHERE operation.space_id = ? AND operation.sequence <= ?
          AND (SELECT coalesce(sum(length(CAST(candidate.operation_json AS BLOB))), 0)
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
          AND (SELECT coalesce(sum(${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")}), 0)
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
        ORDER BY operation.sequence`, args: [this.binding.spaceId, target.sequence,
          this.binding.spaceId, target.sequence, OH_LIBSQL_STORE_LIMITS_V1.historyBytes,
          this.binding.spaceId, target.sequence, OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes]
        },
        { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] },
      ], "read");
      if (historyResults.length !== 3) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete history batch.")));
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
        return yield* Effect.fail(libSqlFailure(new RangeError("The requested libSQL history exceeds its provider-safe replay bounds.")));
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
          const purge = (yield* libSqlValue(() => parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256)));
          this.#purged = purge;
          return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError(purge)));
        }
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote operation history does not exactly cover the requested head.")));
      }
      const operations = (yield* libSqlValue(() => historyRowResult.rows.map((row) => parseOperationRow(row,
        { spaceId: this.binding.spaceId }))));
      const snapshot = (yield* libSqlValue(() => replayOhOperationsV1(this.binding.spaceId, operations, maximumRecords)));
      if (snapshot.head.operationSha256 !== target.operationSha256
        || snapshot.head.recordsSha256 !== target.recordsSha256) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("Remote operation replay does not reproduce the requested head.")));
      }
      return snapshot;
    });
  }

  changesSince(
    fromValue: OhHeadRefV1,
    options: Readonly<{ limit?: number; through?: OhHeadRefV1 }> = {},
  ): Effect.Effect<OhChangesPageV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      yield* libSqlValue(() => this.#assertOpen());
      const from = (yield* libSqlValue(() => parseOhHeadRefV1(fromValue)));
      if (from === null) return yield* Effect.fail(libSqlFailure(new TypeError("Invalid change-feed cursor.")));
      const requestedThrough = options.through === undefined ? undefined : (yield* libSqlValue(() => parseOhHeadRefV1(options.through)));
      if (requestedThrough === null) return yield* Effect.fail(libSqlFailure(new TypeError("Invalid change-feed through head.")));
      const limit = (yield* libSqlValue(() => normalizeLimit(options.limit, OH_LIBSQL_STORE_LIMITS_V1.changeFeedLimit,
        OH_LIBSQL_STORE_LIMITS_V1.changeFeedLimit)));
      const throughSequence = requestedThrough?.sequence ?? null;
      const results = yield* this.#client.batch([
        {
          sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId]
        },
        {
          sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, from.sequence]
        },
        {
          sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, throughSequence]
        },
        {
          sql: `SELECT count(*) AS count, coalesce(sum(response_bytes), 0) AS response_bytes FROM (
          SELECT ${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")} AS response_bytes
          FROM oh_authority_operations AS candidate
          WHERE candidate.space_id = ? AND candidate.sequence > ?
            AND candidate.sequence <= coalesce(?,
              (SELECT sequence FROM oh_authority_spaces WHERE space_id = ?))
          ORDER BY candidate.sequence LIMIT ?
        )`, args: [this.binding.spaceId, from.sequence, throughSequence,
          this.binding.spaceId, limit + 1]
        },
        {
          sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
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
          OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes, limit + 1]
        },
        { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] },
      ], "read");
      if (results.length !== 6) return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete change-feed batch.")));
      const [currentResult, fromResult, throughResult, pageSizeResult, pageResult, purgeResult] = results as
        [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1,
          OhLibSqlResultV1, OhLibSqlResultV1];
      const currentRow = currentResult.rows[0];
      if (currentRow === undefined) {
        const purgeRow = purgeResult.rows[0];
        if (purgeRow !== undefined) {
          const purge = (yield* libSqlValue(() => parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256)));
          this.#purged = purge;
          return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError(purge)));
        }
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote Oh space disappeared while reading its change feed.")));
      }
      const current = (yield* libSqlValue(() => parseHeadRow(currentRow)));
      const resolveHead = (reference: OhHeadRefV1, result: OhLibSqlResultV1): OhHeadV1 => {
        if (reference.sequence === 0) return emptyOhHeadV1();
        const row = result.rows[0];
        if (row === undefined) throw new OhConflictError("A requested change-feed head is not present in this space.");
        const operation = parseOperationRow(row, { spaceId: this.binding.spaceId });
        if (operation.spaceId !== this.binding.spaceId || operation.sequence !== reference.sequence
          || operation.operationSha256 !== reference.operationSha256) {
          throw new OhConflictError("A requested change-feed sequence identifies a different operation head.");
        }
        return {
          generation: operation.sequence, graphRevisionSha256: operation.graphRevisionSha256,
          operationSha256: operation.operationSha256, recordsSha256: operation.recordsSha256,
          sequence: operation.sequence, v: 1
        };
      };
      const fromHead = yield* libSqlValue(() => resolveHead(from, fromResult));
      const through = requestedThrough === undefined ? current : yield* libSqlValue(() => resolveHead(requestedThrough, throughResult));
      if (fromHead.sequence > through.sequence || through.sequence > current.sequence) {
        return yield* Effect.fail(libSqlFailure(new OhConflictError("The change-feed bounds do not identify one remote history prefix.")));
      }
      const pageSizeRow = pageSizeResult.rows[0];
      const pageCount = pageSizeRow === undefined ? null : integer(rowValue(pageSizeRow, "count", 0));
      const pageResponseBytes = pageSizeRow === undefined ? null
        : integer(rowValue(pageSizeRow, "response_bytes", 1));
      if (pageCount === null || pageCount > limit + 1 || pageResponseBytes === null) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote change feed returned invalid response bounds.")));
      }
      if (pageResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes) {
        return yield* Effect.fail(libSqlFailure(new RangeError("The requested change-feed page exceeds its provider response bound.")));
      }
      const parsed = (yield* libSqlValue(() => pageResult.rows.map((row) => parseOperationRow(row, { spaceId: this.binding.spaceId }))));
      if (parsed.length !== pageCount) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote change feed omitted provider-bounded rows.")));
      }
      const hasMore = parsed.length > limit;
      const operations = parsed.slice(0, limit);
      let prior: OhHeadRefV1 = fromHead;
      for (const operation of parsed) {
        if (operation.spaceId !== this.binding.spaceId
          || operation.sequence !== prior.sequence + 1
          || operation.parentOperationSha256 !== prior.operationSha256) {
          return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote change feed contains a gap or fork.")));
        }
        prior = { operationSha256: operation.operationSha256, sequence: operation.sequence };
      }
      if (!hasMore && (prior.sequence !== through.sequence
        || prior.operationSha256 !== through.operationSha256)) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote change feed does not reach its pinned through head.")));
      }
      const last = operations.at(-1);
      const to = last === undefined
        ? { operationSha256: fromHead.operationSha256, sequence: fromHead.sequence }
        : { operationSha256: last.operationSha256, sequence: last.sequence };
      return {
        from: { operationSha256: fromHead.operationSha256, sequence: fromHead.sequence },
        hasMore, operations, through, to, v: 1
      };
    });
  }

  #assertMaterializedSnapshot(snapshot: OhSnapshotV1): Effect.Effect<void, LibSqlFailure> {
    return Effect.gen(this, function* () {
      if (snapshot.head.sequence > OH_LIBSQL_STORE_LIMITS_V1.historyOperations) {
        return yield* Effect.fail(libSqlFailure(new RangeError("The libSQL authority exceeds its explicit verification operation bound.")));
      }
      const verificationResults = yield* this.#client.batch([
        {
          sql: `SELECT * FROM (WITH bounded_operation AS (
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
          this.binding.spaceId, this.binding.spaceId]
        },
        {
          sql: `SELECT ${OPERATION_ROW_COLUMNS}
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
          this.binding.spaceId, snapshot.head.sequence, OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes]
        },
        {
          sql: `SELECT record_key, kind, record_sha256, record_json, operation_sha256, sequence
          FROM oh_authority_records AS record WHERE record.space_id = ?
            AND (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0)
              FROM oh_authority_records AS record WHERE record.space_id = ?) <= ?
          ORDER BY record.record_key`, args: [this.binding.spaceId, this.binding.spaceId,
          OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes]
        },
        {
          sql: `SELECT record_key, dependency_key FROM oh_authority_dependencies AS dependency
          WHERE dependency.space_id = ?
            AND (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
              FROM oh_authority_dependencies AS dependency WHERE dependency.space_id = ?) <= ?
          ORDER BY dependency.record_key, dependency.dependency_key`, args: [this.binding.spaceId,
          this.binding.spaceId, OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes]
        },
        {
          sql: `SELECT materialized.space_id, materialized.operation_sha256, materialized.ordinal,
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
          OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes]
        },
        {
          sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
          FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId]
        },
      ], "read");
      if (verificationResults.length !== 6) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete verification batch.")));
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
        return yield* Effect.fail(libSqlFailure(new RangeError("The libSQL authority exceeds its provider-safe verification bounds.")));
      }
      if (operationCount !== snapshot.head.sequence
        || (snapshot.head.sequence === 0 && (minimumValue !== null || maximumValue !== null))
        || (snapshot.head.sequence > 0
          && (minimumSequence !== 1 || maximumSequence !== snapshot.head.sequence))
        || operationResult.rows.length !== operationCount) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote operation history does not exactly cover its verified head.")));
      }
      const headRow = headResult.rows[0];
      if (headRow === undefined) return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority lost its head during verification.")));
      if ((yield* libSqlValue(() => canonicalJson(parseHeadRow(headRow)))) !== (yield* libSqlValue(() => canonicalJson(snapshot.head)))) {
        return yield* Effect.fail(libSqlFailure(new OhConflictError("The remote authority head changed during verification.")));
      }
      const operations = (yield* libSqlValue(() => operationResult.rows.map((row) => {
        return parseOperationRow(row, { spaceId: this.binding.spaceId });
      })));
      const replayed = (yield* libSqlValue(() => replayOhOperationsV1(this.binding.spaceId, operations)));
      if ((yield* libSqlValue(() => canonicalJson(replayed))) !== (yield* libSqlValue(() => canonicalJson(snapshot)))) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("Remote operation replay changed during materialization verification.")));
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
      const records: KnowledgeGraphRecordV1[] = (yield* libSqlValue(() => recordResult.rows.map((row) => {
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
      })));
      if ((yield* libSqlValue(() => canonicalJson(records))) !== (yield* libSqlValue(() => canonicalJson(snapshot.records)))) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("Remote materialized records do not match operation replay.")));
      }
      const dependencyRows = (yield* libSqlValue(() => dependencyResult.rows.map((row) => ({
        dependency_key: rowValue(row, "dependency_key", 1),
        record_key: rowValue(row, "record_key", 0),
      }))));
      const expectedDependencies = (yield* libSqlValue(() => snapshot.records.flatMap((record) =>
        record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })))));
      if ((yield* libSqlValue(() => canonicalJson(dependencyRows))) !== (yield* libSqlValue(() => canonicalJson(expectedDependencies)))) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("Remote materialized dependencies do not match operation replay.")));
      }
      const operationRecordRows = (yield* libSqlValue(() => operationRecordResult.rows.map((row) => ({
        change_kind: rowValue(row, "change_kind", 4),
        operation_sha256: rowValue(row, "operation_sha256", 1),
        ordinal: integer(rowValue(row, "ordinal", 2)),
        record_key: rowValue(row, "record_key", 3),
        record_sha256: rowValue(row, "record_sha256", 5),
        space_id: rowValue(row, "space_id", 0),
      }))));
      const expectedOperationRecords = (yield* libSqlValue(() => operations.flatMap((operation) =>
        operation.changes.map((change, ordinal) => ({
          change_kind: change.kind,
          operation_sha256: operation.operationSha256, ordinal,
          record_key: change.kind === "put" ? change.record.key : change.key,
          record_sha256: change.kind === "put" ? change.record.recordSha256 : change.priorSha256,
          space_id: this.binding.spaceId
        })))));
      if ((yield* libSqlValue(() => canonicalJson(operationRecordRows))) !== (yield* libSqlValue(() => canonicalJson(expectedOperationRecords)))) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("Remote operation-record rows do not match operation replay.")));
      }
    });
  }

  #operationById(operationId: string): Effect.Effect<OhOperationV1 | null, LibSqlFailure> {
    return Effect.gen(this, function* () {
      const row = yield* queryOne(this.#client, {
        sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
      WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId]
      });
      if (row === null) return null;
      return (yield* libSqlValue(() => parseOperationRow(row, { operationId, spaceId: this.binding.spaceId })));
    });
  }

  #commitPreflight(operationId: string): Effect.Effect<Readonly<{
    current: OhHeadV1;
    duplicate: OhOperationV1 | null;
  }>, LibSqlFailure> {
    return Effect.gen(this, function* () {
      const results = yield* this.#client.batch([
        {
          sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId]
        },
        {
          sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId]
        },
        { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] },
      ], "read");
      if (results.length !== 3) return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete commit preflight.")));
      const [duplicateResult, headResult, purgeResult] = results as
        [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1];
      const headRow = headResult.rows[0];
      if (headRow === undefined) {
        const purgeRow = purgeResult.rows[0];
        if (purgeRow !== undefined) {
          const purge = (yield* libSqlValue(() => parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256)));
          this.#purged = purge;
          return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError(purge)));
        }
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote space disappeared during commit preflight.")));
      }
      const duplicateRow = duplicateResult.rows[0];
      return {
        current: (yield* libSqlValue(() => parseHeadRow(headRow))), duplicate: duplicateRow === undefined ? null
          : (yield* libSqlValue(() => parseOperationRow(duplicateRow, { operationId, spaceId: this.binding.spaceId })))
      };
    });
  }

  #assertOperationReachable(operation: OhOperationV1, expectedHead: OhHeadV1): Effect.Effect<void, LibSqlFailure> {
    return Effect.gen(this, function* () {
      if (operation.sequence < 1 || operation.sequence > expectedHead.sequence) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("A remote idempotent operation is not reachable from the current head.")));
      }
      const results = yield* this.#client.batch([
        {
          sql: `SELECT * FROM (WITH RECURSIVE authority_chain(sequence, operation_sha256) AS (
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
          operation.operationSha256, this.binding.spaceId, expectedHead.sequence]
        },
        {
          sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, expectedHead.sequence]
        },
        {
          sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId]
        },
        { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] },
      ], "read");
      if (results.length !== 4) return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete reachability proof.")));
      const [chainResult, terminalResult, headResult, purgeResult] = results as
        [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1];
      const headRow = headResult.rows[0];
      if (headRow === undefined) {
        const purgeRow = purgeResult.rows[0];
        if (purgeRow !== undefined) {
          const purge = (yield* libSqlValue(() => parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256)));
          this.#purged = purge;
          return yield* Effect.fail(libSqlFailure(new OhPurgedSpaceError(purge)));
        }
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote space disappeared during an idempotency proof.")));
      }
      const current = (yield* libSqlValue(() => parseHeadRow(headRow)));
      if ((yield* libSqlValue(() => canonicalJson(current))) !== (yield* libSqlValue(() => canonicalJson(expectedHead)))) {
        return yield* Effect.fail(libSqlFailure(new OhConflictError("The remote space head changed during an idempotency proof.")));
      }
      const chain = chainResult.rows[0];
      const count = chain === undefined ? null : integer(rowValue(chain, "count", 0));
      const minimum = chain === undefined ? null : integer(rowValue(chain, "minimum", 1));
      const maximum = chain === undefined ? null : integer(rowValue(chain, "maximum", 2));
      const terminalSha256 = chain === undefined ? null : rowValue(chain, "terminal_sha256", 3);
      if (count !== expectedHead.sequence - operation.sequence + 1
        || minimum !== operation.sequence || maximum !== expectedHead.sequence
        || terminalSha256 !== expectedHead.operationSha256) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("A remote idempotent operation has no exact path to the current head.")));
      }
      const terminalRow = terminalResult.rows[0];
      const expectedOperationSha256 = expectedHead.operationSha256;
      if (terminalRow === undefined || expectedOperationSha256 === null) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote current head operation is missing.")));
      }
      const terminal = (yield* libSqlValue(() => parseOperationRow(terminalRow, {
        operationSha256: expectedOperationSha256,
        spaceId: this.binding.spaceId
      })));
      if (terminal.sequence !== expectedHead.sequence
        || terminal.graphRevisionSha256 !== expectedHead.graphRevisionSha256
        || terminal.recordsSha256 !== expectedHead.recordsSha256) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote space head differs from its terminal canonical operation.")));
      }
    });
  }

  commit(input: OhCommitInputV1): Effect.Effect<OhOperationV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      yield* libSqlValue(() => this.#assertOpen());
      const actorId = (yield* libSqlValue(() => safeCode(input.actorId)));
      const operationId = (yield* libSqlValue(() => safeCode(input.operationId)));
      const maximumOperationBytes = input.maximumOperationBytes ?? OH_OPERATION_MAX_BYTES_V1;
      const changes = (yield* libSqlValue(() => canonicalKnowledgeGraphChangesV1(input.changes)));
      if (actorId === null || operationId === null || changes.length === 0
        || !Number.isSafeInteger(maximumOperationBytes)
        || maximumOperationBytes < 1
        || maximumOperationBytes > OH_OPERATION_MAX_BYTES_V1) {
        return yield* Effect.fail(libSqlFailure(new TypeError("Invalid Oh commit input.")));
      }
      if (changes.length > OH_LIBSQL_STORE_LIMITS_V1.changesPerCommit) {
        return yield* Effect.fail(libSqlFailure(new RangeError("A direct libSQL commit exceeds its change-count bound.")));
      }
      const dependencies = (yield* libSqlValue(() => changes.reduce((count, change) => count
        + (change.kind === "put" ? change.record.dependencies.length : 0), 0)));
      if (dependencies > OH_LIBSQL_STORE_LIMITS_V1.dependenciesPerCommit) {
        return yield* Effect.fail(libSqlFailure(new RangeError("A direct libSQL commit exceeds its dependency-count bound.")));
      }
      const { current, duplicate } = yield* this.#commitPreflight(operationId);
      if (duplicate !== null) {
        yield* this.#assertOperationReachable(duplicate, current);
        if (duplicate.actorId !== actorId || (yield* libSqlValue(() => canonicalJson(duplicate.changes))) !== (yield* libSqlValue(() => canonicalJson(changes)))) {
          return yield* Effect.fail(libSqlFailure(new OhConflictError("The operation ID is already bound to different content.")));
        }
        const operationBytes = utf8ByteLength((yield* libSqlValue(() => canonicalJson(duplicate))));
        if (operationBytes > maximumOperationBytes) {
          return yield* Effect.fail(libSqlFailure(new OhOperationSizeError(operationBytes, maximumOperationBytes)));
        }
        return duplicate;
      }
      if (!Number.isSafeInteger(input.expectedHead.generation) || input.expectedHead.generation < 0
        || current.generation !== input.expectedHead.generation
        || current.operationSha256 !== input.expectedHead.operationSha256) {
        return yield* Effect.fail(libSqlFailure(new OhConflictError("The expected head does not match the current remote space head.")));
      }
      const snapshot = yield* this.#currentMaterializedSnapshot(current, OH_GRAPH_LIMITS_V1.recordsPerSnapshot);
      const instant = (yield* libSqlValue(() => input.instant)) ?? (yield* this.#client.currentInstant);
      const transition = (yield* libSqlValue(() => transitionOhSnapshotV1({
        actorId, changes,
        instant, maximumOperationBytes,
        operationId, snapshot, spaceId: this.binding.spaceId
      })));
      const operation = transition.operation;
      const operationJson = (yield* libSqlValue(() => canonicalJson(operation)));
      const operationBytes = utf8ByteLength(operationJson);
      if (operationBytes > maximumOperationBytes) {
        return yield* Effect.fail(libSqlFailure(new OhOperationSizeError(operationBytes, maximumOperationBytes)));
      }
      if (operationBytes > OH_LIBSQL_STORE_LIMITS_V1.operationBytes) {
        return yield* Effect.fail(libSqlFailure(new RangeError("A direct libSQL operation exceeds its canonical byte bound.")));
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
          operationJson, operation.instant, this.binding.spaceId, current.generation,
        current.operationSha256],
      }];
      for (const [ordinal, change] of operation.changes.entries()) {
        const key = change.kind === "put" ? change.record.key : change.key;
        const digest = change.kind === "put" ? change.record.recordSha256 : change.priorSha256;
        statements.push({
          sql: `INSERT INTO oh_authority_operation_records(space_id, operation_sha256,
        ordinal, record_key, change_kind, record_sha256)
        SELECT ?, ?, ?, ?, ?, ? WHERE ${existsOperation}`,
          args: [this.binding.spaceId, operation.operationSha256, ordinal, key, change.kind, digest,
          operation.operationSha256]
        });
        statements.push({
          sql: `DELETE FROM oh_authority_dependencies WHERE space_id = ? AND record_key = ?
        AND ${existsOperation}`, args: [this.binding.spaceId, key, operation.operationSha256]
        });
        if (change.kind === "put") {
          statements.push({
            sql: `INSERT INTO oh_authority_records(space_id, record_key, kind,
          record_sha256, record_json, operation_sha256, sequence)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${existsOperation}
          ON CONFLICT(space_id, record_key) DO UPDATE SET kind = excluded.kind,
          record_sha256 = excluded.record_sha256, record_json = excluded.record_json,
          operation_sha256 = excluded.operation_sha256, sequence = excluded.sequence`,
            args: [this.binding.spaceId, key, change.record.kind, change.record.recordSha256,
            (yield* libSqlValue(() => canonicalJson(change.record))), operation.operationSha256, operation.sequence,
            operation.operationSha256]
          });
        } else {
          statements.push({
            sql: `DELETE FROM oh_authority_records WHERE space_id = ? AND record_key = ?
          AND record_sha256 = ? AND ${existsOperation}`,
            args: [this.binding.spaceId, key, change.priorSha256, operation.operationSha256]
          });
        }
      }
      for (const change of operation.changes) {
        if (change.kind !== "put") continue;
        for (const dependency of change.record.dependencies) {
          statements.push({
            sql: `INSERT INTO oh_authority_dependencies(space_id, record_key, dependency_key)
          SELECT ?, ?, ? WHERE ${existsOperation}`,
            args: [this.binding.spaceId, change.record.key, dependency, operation.operationSha256]
          });
        }
      }
      statements.push({
        sql: `UPDATE oh_authority_spaces SET generation = ?, head_operation_sha256 = ?,
      graph_revision_sha256 = ?, records_sha256 = ?, sequence = ?, updated_at = ?
      WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ? AND ${existsOperation}`,
        args: [operation.sequence, operation.operationSha256, operation.graphRevisionSha256,
        operation.recordsSha256, operation.sequence, operation.instant, this.binding.spaceId,
        current.generation, current.operationSha256, operation.operationSha256]
      });
      statements.push({
        sql: `INSERT INTO oh_authority_commit_guards(value)
      SELECT 'invalid' WHERE NOT EXISTS (SELECT 1 FROM oh_authority_spaces
        WHERE space_id = ? AND generation = ? AND head_operation_sha256 = ?)`,
        args: [this.binding.spaceId, operation.sequence, operation.operationSha256]
      });
      statements.push({
        sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
      WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId]
      });
      statements.push({
        sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
      FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId]
      });
      const write = yield* Effect.either(this.#client.batch(statements, "write"));
      if (Either.isLeft(write)) {
        const error = write.left;
        const raced = yield* this.#operationById(operationId);
        const head = yield* this.head();
        if (raced !== null && raced.actorId === actorId
          && (yield* libSqlValue(() => canonicalJson(raced.changes))) === (yield* libSqlValue(() => canonicalJson(changes)))) {
          yield* this.#assertOperationReachable(raced, head);
          return raced;
        }
        if (head.operationSha256 !== current.operationSha256) {
          return yield* Effect.fail(libSqlFailure(new OhConflictError("The remote space head changed while committing.")));
        }
        return yield* Effect.fail(error);
      }
      const writeResults = write.right;
      if (writeResults.length !== statements.length) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete commit result batch.")));
      }
      const persistedRow = writeResults.at(-2)?.rows[0];
      const persistedHeadRow = writeResults.at(-1)?.rows[0];
      if (persistedRow === undefined || persistedHeadRow === undefined) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority omitted its persisted commit result.")));
      }
      const persisted = (yield* libSqlValue(() => parseOperationRow(persistedRow, { operationId, spaceId: this.binding.spaceId })));
      const persistedHead = (yield* libSqlValue(() => parseHeadRow(persistedHeadRow)));
      if ((yield* libSqlValue(() => canonicalJson(persisted))) !== (yield* libSqlValue(() => canonicalJson(operation)))
        || persistedHead.operationSha256 !== operation.operationSha256
        || persistedHead.sequence !== operation.sequence
        || persistedHead.graphRevisionSha256 !== operation.graphRevisionSha256
        || persistedHead.recordsSha256 !== operation.recordsSha256) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority did not persist the committed operation exactly.")));
      }
      return persisted;
    });
  }

  exportDependencyClosure(input: Readonly<{
    head?: OhHeadRefV1;
    maximumRecords?: number;
    roots: readonly string[];
  }>): Effect.Effect<OhDependencyClosureV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      if (!this.binding.profile.capabilities.dependencyClosureExport) {
        return yield* Effect.fail(libSqlFailure(new OhProfileError("This remote profile does not permit dependency-closure export.")));
      }
      const snapshot = yield* this.snapshot({
        ...(input.head === undefined ? {} : { head: input.head }),
        ...(input.maximumRecords === undefined ? {} : { maximumRecords: input.maximumRecords })
      });
      return (yield* libSqlValue(() => createOhDependencyClosureV1({
        binding: this.binding,
        ...(input.maximumRecords === undefined ? {} : { maximumRecords: input.maximumRecords }),
        roots: input.roots, snapshot
      })));
    });
  }

  verify(): Effect.Effect<OhStoreVerificationV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      yield* libSqlValue(() => this.#assertOpen());
      const snapshot = yield* this.snapshot();
      yield* this.#assertMaterializedSnapshot(snapshot);
      return {
        head: snapshot.head, integrity: "verified", operations: snapshot.head.sequence,
        records: snapshot.records.length, v: 1
      };
    });
  }

  #assertPurgeComplete(expected: OhSpacePurgeReceiptV1): Effect.Effect<void, LibSqlFailure> {
    return Effect.gen(this, function* () {
      yield* assertRemotePurgeComplete(this.#client, this.binding, expected);
    });
  }

  purgeWorkingSpace(purgedAt: string): Effect.Effect<OhSpacePurgeReceiptV1, LibSqlFailure> {
    return Effect.gen(this, function* () {
      yield* libSqlValue(() => this.#assertOpen());
      if (this.binding.profile.profileKind !== "working"
        || !this.binding.profile.capabilities.wholeSpacePurge) {
        return yield* Effect.fail(libSqlFailure(new OhProfileError("Whole-space purge requires a bound working profile.")));
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = yield* this.#readPurge();
        if (existing !== null) {
          yield* this.#assertPurgeComplete(existing);
          this.#purged = existing;
          return existing;
        }
        const head = yield* this.head();
        const receipt = (yield* libSqlValue(() => createOhSpacePurgeReceiptV1({ binding: this.binding, priorHead: head, purgedAt })));
        const receiptExists = "EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ? AND receipt_sha256 = ?)";
        const statements: OhLibSqlStatementV1[] = [{
          sql: `INSERT INTO oh_authority_purges(space_id,
        binding_sha256, prior_operation_sha256, prior_sequence, purged_at, receipt_sha256, receipt_json)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM oh_authority_spaces
          WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ?)
          AND EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ? AND binding_sha256 = ?)`,
          args: [this.binding.spaceId, this.binding.bindingSha256, head.operationSha256, head.sequence,
          receipt.purgedAt, receipt.receiptSha256, (yield* libSqlValue(() => canonicalJson(receipt))), this.binding.spaceId,
          head.generation, head.operationSha256, this.binding.spaceId, this.binding.bindingSha256]
        }];
        const guardedDelete = (table: string): OhLibSqlStatementV1 => ({
          sql: `DELETE FROM ${table} WHERE space_id = ? AND ${receiptExists}`,
          args: [this.binding.spaceId, this.binding.spaceId, receipt.receiptSha256],
        });
        statements.push({
          sql: `DELETE FROM oh_authority_operation_records
        WHERE operation_sha256 IN (SELECT operation_sha256 FROM oh_authority_operations WHERE space_id = ?)
          AND ${receiptExists}`,
          args: [this.binding.spaceId, this.binding.spaceId, receipt.receiptSha256]
        });
        statements.push(guardedDelete("oh_authority_dependencies"));
        statements.push(guardedDelete("oh_authority_records"));
        statements.push(guardedDelete("oh_authority_operations"));
        statements.push(guardedDelete("oh_authority_bindings"));
        statements.push(guardedDelete("oh_authority_spaces"));
        statements.push({
          sql: `INSERT INTO oh_authority_commit_guards(value)
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
          this.binding.spaceId, receipt.receiptSha256]
        });
        const write = yield* Effect.either(this.#client.batch(statements, "write"));
        if (Either.isLeft(write)) {
          const raced = yield* this.#readPurge();
          if (raced !== null) {
            yield* this.#assertPurgeComplete(raced);
            this.#purged = raced;
            return raced;
          }
          continue;
        }
        const persisted = yield* this.#readPurge();
        if (persisted !== null) {
          yield* this.#assertPurgeComplete(persisted);
          this.#purged = persisted;
          return persisted;
        }
      }
      return yield* Effect.fail(libSqlFailure(new OhConflictError("The remote working space changed repeatedly while purging.")));
    });
  }

}

/** Opens a direct libSQL/Turso authority; this is not operation-log sync. */
export function createAuthority(
  client: LibSqlAuthorityClientService,
  options: OhLibSqlStoreAuthorityOptionsV1 = {},
): Effect.Effect<LibSqlStoreProgram, LibSqlFailure> {
  return Effect.gen(function* () {
    const profile = (yield* libSqlValue(() => parseOhStoreProfileV1(options.profile ?? OH_CANONICAL_STORE_PROFILE_V1)));
    if (profile === null) return yield* Effect.fail(libSqlFailure(new TypeError("Invalid libSQL store profile.")));
    const spaceId = options.spaceId ?? "default";
    const binding = (yield* libSqlValue(() => createOhStoreBindingV1({
      profile,
      realmId: options.realmId ?? `realm:${spaceId}`, spaceId, v: 1
    })));
    yield* verifyAuthoritySchema(client);
    yield* initializeSpace(client, binding);
    return new LibSqlStoreProgram(client, binding);
  });
}

/**
 * Opens an already-bound direct libSQL/Turso authority without creating or
 * updating data. This seam is for separately held read or purge custody that
 * must fail closed instead of acquiring space-creation authority.
 */
export function openExistingAuthority(
  client: LibSqlAuthorityClientService,
  options: OhLibSqlStoreAuthorityOptionsV1 = {},
): Effect.Effect<LibSqlStoreProgram, LibSqlFailure> {
  return Effect.gen(function* () {
    const profile = (yield* libSqlValue(() => parseOhStoreProfileV1(options.profile ?? OH_CANONICAL_STORE_PROFILE_V1)));
    if (profile === null) return yield* Effect.fail(libSqlFailure(new TypeError("Invalid libSQL store profile.")));
    const spaceId = options.spaceId ?? "default";
    const binding = (yield* libSqlValue(() => createOhStoreBindingV1({
      profile,
      realmId: options.realmId ?? `realm:${spaceId}`, spaceId, v: 1
    })));
    yield* verifyAuthoritySchema(client);
    yield* requireExistingSpace(client, binding);
    return new LibSqlStoreProgram(client, binding);
  });
}

/**
 * Purges an existing working authority or atomically fences its exact binding
 * when creation never completed. The empty-space receipt prevents a delayed
 * creator from resurrecting abandoned custody without granting the purge
 * credential permission to create a space or binding.
 */
export function purgeWorkingSpace(
  client: LibSqlAuthorityClientService,
  options: OhLibSqlStoreAuthorityOptionsV1 & Readonly<{ purgedAt?: string }> = {},
): Effect.Effect<OhSpacePurgeReceiptV1, LibSqlFailure> {
  return Effect.gen(function* () {

    const profile = (yield* libSqlValue(() => parseOhStoreProfileV1(options.profile ?? OH_WORKING_STORE_PROFILE_V1)));
    if (profile === null) return yield* Effect.fail(libSqlFailure(new TypeError("Invalid libSQL store profile.")));
    if (profile.profileKind !== "working" || !profile.capabilities.wholeSpacePurge) {
      return yield* Effect.fail(libSqlFailure(new OhProfileError("Whole-space purge requires a bound working profile.")));
    }
    const spaceId = options.spaceId ?? "default";
    const binding = (yield* libSqlValue(() => createOhStoreBindingV1({
      profile,
      realmId: options.realmId ?? `realm:${spaceId}`, spaceId, v: 1
    })));
    const purgedAt = options.purgedAt ?? (yield* client.currentInstant);
    yield* verifyAuthoritySchema(client);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const proof = yield* client.batch([
        { sql: BINDING_ROW_SELECT, args: [binding.spaceId] },
        { sql: SPACE_PURGE_PROOF_SELECT, args: [binding.spaceId] },
        { sql: PURGE_ROW_SELECT, args: [binding.spaceId] },
      ], "read");
      if (proof.length !== 3) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete purge proof.")));
      }
      const [bindingResult, spaceResult, purgeResult] = proof as
        [OhLibSqlResultV1, OhLibSqlResultV1, OhLibSqlResultV1];
      const existingPurge = purgeResult.rows[0];
      if (existingPurge !== undefined) {
        const receipt = (yield* libSqlValue(() => parsePurgeReceiptRow(existingPurge, binding.spaceId, binding.bindingSha256)));
        yield* assertRemotePurgeComplete(client, binding, receipt);
        return receipt;
      }
      const bindingRow = bindingResult.rows[0];
      const spaceRow = spaceResult.rows[0];
      if ((bindingRow === undefined) !== (spaceRow === undefined)) {
        return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority has only half of its space binding.")));
      }
      if (bindingRow !== undefined && spaceRow !== undefined) {
        const persisted = (yield* libSqlValue(() => parseBindingRow(bindingRow, binding.spaceId)));
        if ((yield* libSqlValue(() => canonicalJson(persisted))) !== (yield* libSqlValue(() => canonicalJson(binding)))) {
          return yield* Effect.fail(libSqlFailure(new OhProfileError("The remote space is bound to a different realm or profile.")));
        }
        if (rowValue(spaceRow, "contract_id", 5) !== OH_CONTRACT_MANIFEST_V1.contractId) {
          return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The existing remote space uses a different Oh contract.")));
        }
        (yield* libSqlValue(() => parseHeadRow(spaceRow)));
        const authority = new LibSqlStoreProgram(client, binding);
        return yield* authority.purgeWorkingSpace(purgedAt);
      }

      const receipt = (yield* libSqlValue(() => createOhSpacePurgeReceiptV1({
        binding,
        priorHead: emptyOhHeadV1(),
        purgedAt,
      })));
      const receiptJson = (yield* libSqlValue(() => canonicalJson(receipt)));
      const write = yield* Effect.either(client.batch([
        {
          sql: `INSERT INTO oh_authority_purges(space_id, binding_sha256,
            prior_operation_sha256, prior_sequence, purged_at, receipt_sha256, receipt_json)
            SELECT ?, ?, NULL, 0, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
              AND NOT EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ?)
            ON CONFLICT(space_id) DO NOTHING`,
          args: [binding.spaceId, binding.bindingSha256, receipt.purgedAt,
          receipt.receiptSha256, receiptJson, binding.spaceId, binding.spaceId]
        },
        {
          sql: `INSERT INTO oh_authority_commit_guards(value)
            SELECT 'invalid' WHERE EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_operations WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_operation_records WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_records WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_dependencies WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_operation_records AS materialized
                LEFT JOIN oh_authority_operations AS operation
                  ON operation.operation_sha256 = materialized.operation_sha256
                WHERE operation.operation_sha256 IS NULL
                  OR operation.space_id <> materialized.space_id)
              OR NOT EXISTS (SELECT 1 FROM oh_authority_purges
                WHERE space_id = ? AND receipt_sha256 = ?)`,
          args: [binding.spaceId, binding.spaceId, binding.spaceId, binding.spaceId,
          binding.spaceId, binding.spaceId, binding.spaceId, receipt.receiptSha256]
        },
      ], "write"));
      if (Either.isLeft(write)) {
        const error = write.left;
        const recovery = yield* client.batch([
          { sql: BINDING_ROW_SELECT, args: [binding.spaceId] },
          { sql: SPACE_PURGE_PROOF_SELECT, args: [binding.spaceId] },
          { sql: PURGE_ROW_SELECT, args: [binding.spaceId] },
        ], "read");
        if (recovery.length !== 3) {
          return yield* Effect.fail(libSqlFailure(new OhIntegrityError("The remote authority returned an incomplete purge recovery proof.")));
        }
        const raced = recovery[2]?.rows[0];
        if (raced !== undefined) {
          const persisted = (yield* libSqlValue(() => parsePurgeReceiptRow(raced, binding.spaceId, binding.bindingSha256)));
          yield* assertRemotePurgeComplete(client, binding, persisted);
          return persisted;
        }
        if (recovery[0]?.rows[0] !== undefined || recovery[1]?.rows[0] !== undefined) continue;
        return yield* Effect.fail(error);
      }
      const persisted = yield* queryOne(client, { sql: PURGE_ROW_SELECT, args: [binding.spaceId] });
      if (persisted === null) continue;
      const exact = (yield* libSqlValue(() => parsePurgeReceiptRow(persisted, binding.spaceId, binding.bindingSha256)));
      yield* assertRemotePurgeComplete(client, binding, exact);
      return exact;
    }
    return yield* Effect.fail(libSqlFailure(new OhConflictError("The remote working space changed repeatedly while fencing purge.")));
  });
}
/** Admission and drain are one local authority lifetime. SQL still arbitrates
 * concurrent commits; this gate does not serialize independent operations. */
export const makeLibSqlOwner = Effect.gen(function* () {
  const active = yield* Ref.make(0);
  const closing = yield* Ref.make(false);
  const drained = yield* Deferred.make<void>();
  const admit = Effect.gen(function* () {
    if (yield* Ref.get(closing)) return false;
    yield* Ref.update(active, count => count + 1);
    return true;
  });
  const release = Effect.gen(function* () {
    const remaining = yield* Ref.updateAndGet(active, count => count - 1);
    if (remaining === 0 && (yield* Ref.get(closing))) yield* Deferred.succeed(drained, undefined);
  });
  const beginClose = Effect.gen(function* () {
    yield* Ref.set(closing, true);
    if ((yield* Ref.get(active)) === 0) yield* Deferred.succeed(drained, undefined);
  });
  return {
    admit, beginClose,
    drained: Deferred.await(drained),
    complete: <A>(operation: Effect.Effect<A, LibSqlFailure>): Effect.Effect<A, LibSqlFailure> =>
      Effect.uninterruptible(operation.pipe(Effect.ensuring(release))),
  };
});
