import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  boundedText,
  canonicalJson,
  canonicalNow,
  canonicalSha256,
  parseSha256Hex,
  safeCode,
  type JsonValue,
  type Sha256Hex,
} from "../canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "../contract";
import {
  canonicalKnowledgeGraphChangesV1,
  knowledgeGraphRecordRefV1,
  OH_GRAPH_LIMITS_V1,
  parseKnowledgeGraphRecordV1,
  type KnowledgeGraphChangeV1,
  type KnowledgeGraphRecordKindV1,
  type KnowledgeGraphRecordV1,
} from "../graph";
import { OH_CONTRACT_ID_V1 } from "../ontology";
import {
  createOhOperationV1,
  graphRevisionSha256V1,
  parseOhOperationV1,
  type OhOperationV1,
} from "../operation";
import { openOhSqliteDatabase, withImmediateTransaction, type OhSqliteDatabase } from "./driver";
import { applyOhSqliteMigrations, OH_SQLITE_SCHEMA_VERSION } from "./migrations";

const EMPTY_RECORDS_SHA256 = canonicalSha256([]);

export class OhConflictError extends Error {
  constructor(message: string) { super(message); this.name = "OhConflictError"; }
}
export class OhIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "OhIntegrityError"; }
}
export class OhDependencyError extends Error {
  constructor(message: string) { super(message); this.name = "OhDependencyError"; }
}

export type OhHeadV1 = Readonly<{
  generation: number;
  graphRevisionSha256: Sha256Hex | null;
  operationSha256: Sha256Hex | null;
  recordsSha256: Sha256Hex;
  sequence: number;
  v: 1;
}>;

export type OhCommitInputV1 = Readonly<{
  actorId: string;
  changes: readonly KnowledgeGraphChangeV1[];
  expectedHead: Pick<OhHeadV1, "generation" | "operationSha256">;
  instant?: string;
  operationId: string;
}>;

export type OhRecordListOptions = Readonly<{
  kind?: KnowledgeGraphRecordKindV1;
  limit?: number;
}>;

export type OhKeywordSearchResultV1 = Readonly<{
  key: string;
  kind: KnowledgeGraphRecordKindV1;
  recordSha256: Sha256Hex;
  score: number;
  snippet: string;
  v: 1;
}>;

export type OhReplayVerificationV1 = Readonly<{
  head: OhHeadV1;
  operations: number;
  records: number;
  sqliteIntegrity: "ok";
  v: 1;
}>;

type SpaceRow = {
  generation: number;
  graph_revision_sha256: string | null;
  head_operation_sha256: string | null;
  records_sha256: string;
  sequence: number;
};
type RecordRow = { record_json: string };
type CurrentRecordRow = {
  kind: string;
  operation_sha256: string;
  record_json: string;
  record_key: string;
  record_sha256: string;
  sequence: number;
};
type OperationRow = { operation_json: string };

function parseHead(row: SpaceRow): OhHeadV1 {
  const operationSha256 = row.head_operation_sha256 === null ? null : parseSha256Hex(row.head_operation_sha256);
  const graphRevisionSha256 = row.graph_revision_sha256 === null ? null : parseSha256Hex(row.graph_revision_sha256);
  const recordsSha256 = parseSha256Hex(row.records_sha256);
  if ((row.head_operation_sha256 !== null && operationSha256 === null)
    || (row.graph_revision_sha256 !== null && graphRevisionSha256 === null) || recordsSha256 === null) {
    throw new OhIntegrityError("The stored space head contains an invalid digest.");
  }
  return { generation: row.generation, graphRevisionSha256, operationSha256,
    recordsSha256, sequence: row.sequence, v: 1 };
}

function extractSearchText(value: JsonValue, maximumBytes = 1024 * 1024): string {
  const parts: string[] = [];
  let bytes = 0;
  const visit = (candidate: JsonValue, depth: number): void => {
    if (depth > 32 || bytes >= maximumBytes) return;
    if (typeof candidate === "string") {
      const remaining = maximumBytes - bytes;
      const text = Buffer.from(candidate, "utf8").subarray(0, remaining).toString("utf8");
      if (text.length > 0) { parts.push(text); bytes += Buffer.byteLength(text, "utf8") + 1; }
    } else if (typeof candidate === "number" || typeof candidate === "boolean") {
      const text = String(candidate); parts.push(text); bytes += text.length + 1;
    } else if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
    } else if (candidate !== null) {
      for (const [key, item] of Object.entries(candidate)) {
        parts.push(key); bytes += key.length + 1;
        visit(item, depth + 1);
      }
    }
  };
  visit(value, 0);
  return parts.join(" ").normalize("NFC");
}

function normalizeLimit(value: number | undefined, fallback = 50, maximum = 1000): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`limit must be an integer from 1 through ${maximum}.`);
  }
  return value;
}

function ftsQuery(value: string): string | null {
  const normalized = boundedText(value.normalize("NFC"), 4096);
  if (normalized === null) return null;
  const tokens = normalized.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}/gu)?.slice(0, 16) ?? [];
  return tokens.length === 0 ? null : tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

export class OhSqliteStore {
  readonly database: OhSqliteDatabase;
  readonly spaceId: string;
  #closed = false;

  constructor(options: Readonly<{ database?: OhSqliteDatabase; path?: string; spaceId?: string }> = {}) {
    const spaceId = safeCode(options.spaceId ?? "default");
    if (spaceId === null) throw new TypeError("Invalid space ID.");
    if (options.database !== undefined && options.path !== undefined) {
      throw new TypeError("Pass either a database or a path, not both.");
    }
    const path = options.path ?? "oh.sqlite";
    if (options.database === undefined && path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.database = options.database ?? openOhSqliteDatabase(path);
    this.spaceId = spaceId;
    applyOhSqliteMigrations(this.database);
    this.#registerContract();
    this.ensureSpace();
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("The Oh store is closed.");
  }

  #registerContract(): void {
    const manifestJson = canonicalJson(OH_CONTRACT_MANIFEST_V1);
    this.database.query(`INSERT INTO oh_contracts(contract_id, contract_sha256, manifest_json, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(contract_id) DO NOTHING`)
      .run(OH_CONTRACT_ID_V1, OH_CONTRACT_MANIFEST_V1.contractSha256, manifestJson, canonicalNow());
    const existing = this.database.query<{ contract_sha256: string; manifest_json: string }, [string]>(
      "SELECT contract_sha256, manifest_json FROM oh_contracts WHERE contract_id = ?",
    ).get(OH_CONTRACT_ID_V1);
    if (existing === null || existing.contract_sha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256
      || existing.manifest_json !== manifestJson) {
      throw new OhIntegrityError("The stored contract manifest differs from this runtime.");
    }
  }

  ensureSpace(): OhHeadV1 {
    this.#assertOpen();
    const now = canonicalNow();
    this.database.query(`INSERT INTO oh_spaces(
      space_id, contract_id, generation, head_operation_sha256, graph_revision_sha256,
      records_sha256, sequence, created_at, updated_at
    ) VALUES (?, ?, 0, NULL, NULL, ?, 0, ?, ?) ON CONFLICT(space_id) DO NOTHING`)
      .run(this.spaceId, OH_CONTRACT_ID_V1, EMPTY_RECORDS_SHA256, now, now);
    return this.head();
  }

  head(): OhHeadV1 {
    this.#assertOpen();
    const row = this.database.query<SpaceRow, [string]>(`SELECT generation, graph_revision_sha256,
      head_operation_sha256, records_sha256, sequence FROM oh_spaces WHERE space_id = ?`).get(this.spaceId);
    if (row === null) throw new OhIntegrityError("The requested space does not exist.");
    return parseHead(row);
  }

  #loadRecords(): Map<string, KnowledgeGraphRecordV1> {
    const rows = this.database.query<RecordRow, [string]>(
      "SELECT record_json FROM oh_records WHERE space_id = ? ORDER BY record_key",
    ).all(this.spaceId);
    const records = new Map<string, KnowledgeGraphRecordV1>();
    for (const row of rows) {
      let value: unknown;
      try { value = JSON.parse(row.record_json); } catch { throw new OhIntegrityError("A stored record is not JSON."); }
      if (canonicalJson(value) !== row.record_json) throw new OhIntegrityError("A stored record is not canonical JSON.");
      const record = parseKnowledgeGraphRecordV1(value);
      if (record === null || records.has(record.key)) throw new OhIntegrityError("A stored graph record is invalid.");
      records.set(record.key, record);
    }
    return records;
  }

  #transition(
    head: OhHeadV1,
    changes: readonly KnowledgeGraphChangeV1[],
    operationId: string,
  ): Readonly<{ graphRevisionSha256: Sha256Hex; records: Map<string, KnowledgeGraphRecordV1>; recordsSha256: Sha256Hex }> {
    const records = this.#loadRecords();
    for (const change of changes) {
      if (change.kind === "put") {
        records.set(change.record.key, change.record);
      } else {
        const prior = records.get(change.key);
        if (prior === undefined || prior.recordSha256 !== change.priorSha256) {
          throw new OhConflictError(`The prior digest for ${change.key} does not match the current record.`);
        }
        records.delete(change.key);
      }
    }
    if (records.size > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
      throw new RangeError("Graph transition exceeds its record snapshot limit.");
    }
    for (const record of records.values()) {
      for (const dependency of record.dependencies) {
        if (!records.has(dependency)) throw new OhDependencyError(`Missing dependency ${dependency} for ${record.key}.`);
      }
    }
    const refs = [...records.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
      .map(knowledgeGraphRecordRefV1);
    const recordsSha256 = canonicalSha256(refs);
    const graphRevisionSha256 = graphRevisionSha256V1({ changes, operationId,
      parentGraphRevisionSha256: head.graphRevisionSha256, recordsSha256, revision: head.sequence + 1 });
    return { graphRevisionSha256, records, recordsSha256 };
  }

  #persist(operation: OhOperationV1): void {
    this.database.query(`INSERT INTO oh_operations(operation_sha256, space_id, sequence,
      operation_id, parent_operation_sha256, graph_revision_sha256, records_sha256,
      operation_json, instant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      operation.operationSha256, this.spaceId, operation.sequence, operation.operationId,
      operation.parentOperationSha256, operation.graphRevisionSha256, operation.recordsSha256,
      canonicalJson(operation), operation.instant,
    );
    const changedKeys = operation.changes.map((change) => change.kind === "put" ? change.record.key : change.key);
    const deleteDependencies = this.database.query("DELETE FROM oh_dependencies WHERE space_id = ? AND record_key = ?");
    for (const key of changedKeys) deleteDependencies.run(this.spaceId, key);

    const insertOperationRecord = this.database.query(`INSERT INTO oh_operation_records(
      operation_sha256, ordinal, record_key, change_kind, record_sha256) VALUES (?, ?, ?, ?, ?)`);
    const upsertRecord = this.database.query(`INSERT INTO oh_records(space_id, record_key, kind,
      record_sha256, record_json, operation_sha256, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id, record_key) DO UPDATE SET kind = excluded.kind,
      record_sha256 = excluded.record_sha256, record_json = excluded.record_json,
      operation_sha256 = excluded.operation_sha256, sequence = excluded.sequence`);
    const deleteRecord = this.database.query("DELETE FROM oh_records WHERE space_id = ? AND record_key = ?");
    const deleteSearch = this.database.query("DELETE FROM oh_search_documents WHERE space_id = ? AND record_key = ?");
    const deleteFts = this.database.query("DELETE FROM oh_search_fts WHERE space_id = ? AND record_key = ?");
    const upsertSearch = this.database.query(`INSERT INTO oh_search_documents(space_id, record_key,
      record_sha256, text) VALUES (?, ?, ?, ?) ON CONFLICT(space_id, record_key) DO UPDATE SET
      record_sha256 = excluded.record_sha256, text = excluded.text`);
    const insertFts = this.database.query("INSERT INTO oh_search_fts(space_id, record_key, text) VALUES (?, ?, ?)");
    for (const [ordinal, change] of operation.changes.entries()) {
      const key = change.kind === "put" ? change.record.key : change.key;
      const digest = change.kind === "put" ? change.record.recordSha256 : change.priorSha256;
      insertOperationRecord.run(operation.operationSha256, ordinal, key, change.kind, digest);
      deleteFts.run(this.spaceId, key);
      deleteSearch.run(this.spaceId, key);
      if (change.kind === "put") {
        const recordJson = canonicalJson(change.record);
        upsertRecord.run(this.spaceId, key, change.record.kind, change.record.recordSha256,
          recordJson, operation.operationSha256, operation.sequence);
        const text = `${key} ${change.record.kind} ${extractSearchText(change.record.value)}`;
        upsertSearch.run(this.spaceId, key, change.record.recordSha256, text);
        insertFts.run(this.spaceId, key, text);
      } else deleteRecord.run(this.spaceId, key);
    }
    const insertDependency = this.database.query(
      "INSERT INTO oh_dependencies(space_id, record_key, dependency_key) VALUES (?, ?, ?)",
    );
    for (const change of operation.changes) {
      if (change.kind === "put") {
        for (const dependency of change.record.dependencies) insertDependency.run(this.spaceId, change.record.key, dependency);
      }
    }
    this.database.query("INSERT INTO oh_sync_outbox(space_id, sequence, operation_sha256) VALUES (?, ?, ?)")
      .run(this.spaceId, operation.sequence, operation.operationSha256);
    const updated = this.database.query(`UPDATE oh_spaces SET generation = ?, head_operation_sha256 = ?,
      graph_revision_sha256 = ?, records_sha256 = ?, sequence = ?, updated_at = ?
      WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ?`).run(
      operation.sequence, operation.operationSha256, operation.graphRevisionSha256,
      operation.recordsSha256, operation.sequence, operation.instant, this.spaceId,
      operation.sequence - 1, operation.parentOperationSha256,
    );
    if (updated.changes !== 1) throw new OhConflictError("The space head changed while committing.");
  }

  commit(input: OhCommitInputV1): OhOperationV1 {
    this.#assertOpen();
    const actorId = safeCode(input.actorId);
    const operationId = safeCode(input.operationId);
    if (actorId === null || operationId === null) throw new TypeError("Invalid actor or operation ID.");
    const changes = canonicalKnowledgeGraphChangesV1(input.changes);
    if (changes.length === 0 || changes.length > 8192) throw new TypeError("A commit needs 1 through 8192 changes.");
    return withImmediateTransaction(this.database, () => {
      const duplicate = this.database.query<OperationRow, [string, string]>(
        "SELECT operation_json FROM oh_operations WHERE space_id = ? AND operation_id = ?",
      ).get(this.spaceId, operationId);
      if (duplicate !== null) {
        const existing = parseOhOperationV1(JSON.parse(duplicate.operation_json));
        if (existing === null) throw new OhIntegrityError("The stored idempotent operation is invalid.");
        if (existing.actorId !== actorId || canonicalJson(existing.changes) !== canonicalJson(changes)) {
          throw new OhConflictError("The operation ID is already bound to different content.");
        }
        return existing;
      }
      const head = this.head();
      if (head.generation !== input.expectedHead.generation
        || head.operationSha256 !== input.expectedHead.operationSha256) {
        throw new OhConflictError("The expected head does not match the current space head.");
      }
      const transition = this.#transition(head, changes, operationId);
      const operation = createOhOperationV1({ actorId, changes, contractId: OH_CONTRACT_ID_V1,
        graphRevisionSha256: transition.graphRevisionSha256, instant: input.instant ?? canonicalNow(),
        operationId, parentOperationSha256: head.operationSha256,
        recordsSha256: transition.recordsSha256, sequence: head.sequence + 1, spaceId: this.spaceId, v: 1 });
      this.#persist(operation);
      return operation;
    });
  }

  importOperation(value: unknown): Readonly<{ imported: boolean; operation: OhOperationV1 }> {
    this.#assertOpen();
    const operation = parseOhOperationV1(value);
    if (operation === null || operation.spaceId !== this.spaceId) throw new OhIntegrityError("Invalid imported operation.");
    return withImmediateTransaction(this.database, () => {
      const duplicate = this.database.query<OperationRow, [string]>(
        "SELECT operation_json FROM oh_operations WHERE operation_sha256 = ?",
      ).get(operation.operationSha256);
      if (duplicate !== null) {
        if (canonicalJson(JSON.parse(duplicate.operation_json)) !== canonicalJson(operation)) {
          throw new OhIntegrityError("An operation digest is bound to different bytes.");
        }
        return { imported: false, operation };
      }
      const head = this.head();
      if (operation.sequence !== head.sequence + 1 || operation.parentOperationSha256 !== head.operationSha256) {
        throw new OhConflictError("The imported operation does not extend the local head.");
      }
      const transition = this.#transition(head, operation.changes, operation.operationId);
      if (transition.recordsSha256 !== operation.recordsSha256
        || transition.graphRevisionSha256 !== operation.graphRevisionSha256) {
        throw new OhIntegrityError("The imported operation does not reproduce its declared graph head.");
      }
      this.#persist(operation);
      return { imported: true, operation };
    });
  }

  exportOperations(afterSequence = 0, limit = 1000): readonly OhOperationV1[] {
    this.#assertOpen();
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw new RangeError("afterSequence must be nonnegative.");
    const boundedLimit = normalizeLimit(limit);
    const rows = this.database.query<OperationRow, [string, number, number]>(
      "SELECT operation_json FROM oh_operations WHERE space_id = ? AND sequence > ? ORDER BY sequence LIMIT ?",
    ).all(this.spaceId, afterSequence, boundedLimit);
    return rows.map((row) => {
      const operation = parseOhOperationV1(JSON.parse(row.operation_json));
      if (operation === null || canonicalJson(operation) !== row.operation_json) throw new OhIntegrityError("A stored operation is invalid.");
      return operation;
    });
  }

  get(key: string): KnowledgeGraphRecordV1 | null {
    this.#assertOpen();
    const parsedKey = safeCode(key, 512);
    if (parsedKey === null) throw new TypeError("Invalid record key.");
    const row = this.database.query<RecordRow, [string, string]>(
      "SELECT record_json FROM oh_records WHERE space_id = ? AND record_key = ?",
    ).get(this.spaceId, parsedKey);
    if (row === null) return null;
    const record = parseKnowledgeGraphRecordV1(JSON.parse(row.record_json));
    if (record === null || canonicalJson(record) !== row.record_json) throw new OhIntegrityError("The stored record is invalid.");
    return record;
  }

  list(options: OhRecordListOptions = {}): readonly KnowledgeGraphRecordV1[] {
    this.#assertOpen();
    const limit = normalizeLimit(options.limit);
    const rows = options.kind === undefined
      ? this.database.query<RecordRow, [string, number]>(
          "SELECT record_json FROM oh_records WHERE space_id = ? ORDER BY record_key LIMIT ?",
        ).all(this.spaceId, limit)
      : this.database.query<RecordRow, [string, string, number]>(
          "SELECT record_json FROM oh_records WHERE space_id = ? AND kind = ? ORDER BY record_key LIMIT ?",
        ).all(this.spaceId, options.kind, limit);
    return rows.map((row) => {
      const record = parseKnowledgeGraphRecordV1(JSON.parse(row.record_json));
      if (record === null || canonicalJson(record) !== row.record_json) {
        throw new OhIntegrityError("The stored record is invalid.");
      }
      return record;
    });
  }

  snapshotRecords(maximum: number = OH_GRAPH_LIMITS_V1.recordsPerSnapshot): readonly KnowledgeGraphRecordV1[] {
    this.#assertOpen();
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
      throw new RangeError(`maximum must be an integer from 1 through ${OH_GRAPH_LIMITS_V1.recordsPerSnapshot}.`);
    }
    const count = this.database.query<{ count: number }, [string]>(
      "SELECT count(*) AS count FROM oh_records WHERE space_id = ?",
    ).get(this.spaceId)?.count ?? 0;
    if (count > maximum) throw new RangeError(`The graph contains ${count} records, above the requested snapshot bound.`);
    return this.database.query<RecordRow, [string]>(
      "SELECT record_json FROM oh_records WHERE space_id = ? ORDER BY record_key",
    ).all(this.spaceId).map((row) => {
      const record = parseKnowledgeGraphRecordV1(JSON.parse(row.record_json));
      if (record === null || canonicalJson(record) !== row.record_json) {
        throw new OhIntegrityError("The stored record is invalid.");
      }
      return record;
    });
  }

  log(limit = 50): readonly OhOperationV1[] {
    this.#assertOpen();
    const rows = this.database.query<OperationRow, [string, number]>(
      "SELECT operation_json FROM oh_operations WHERE space_id = ? ORDER BY sequence DESC LIMIT ?",
    ).all(this.spaceId, normalizeLimit(limit));
    return rows.map((row) => {
      const operation = parseOhOperationV1(JSON.parse(row.operation_json));
      if (operation === null) throw new OhIntegrityError("The stored operation is invalid.");
      return operation;
    });
  }

  searchKeyword(query: string, limit = 20): readonly OhKeywordSearchResultV1[] {
    this.#assertOpen();
    const match = ftsQuery(query);
    if (match === null) return [];
    type SearchRow = { kind: string; rank: number; record_key: string; record_sha256: string; snippet: string };
    const rows = this.database.query<SearchRow, [string, string, number]>(`SELECT r.record_key,
      r.kind, r.record_sha256, bm25(oh_search_fts) AS rank,
      snippet(oh_search_fts, 2, '', '', ' … ', 24) AS snippet
      FROM oh_search_fts JOIN oh_records r
      ON r.space_id = oh_search_fts.space_id AND r.record_key = oh_search_fts.record_key
      WHERE oh_search_fts MATCH ? AND oh_search_fts.space_id = ?
      ORDER BY rank, r.record_key LIMIT ?`).all(match, this.spaceId, normalizeLimit(limit, 20, 100));
    return rows.map((row) => {
      const digest = parseSha256Hex(row.record_sha256);
      if (digest === null) throw new OhIntegrityError("Search returned an invalid record digest.");
      return { key: row.record_key, kind: row.kind as KnowledgeGraphRecordKindV1,
        recordSha256: digest, score: 1 / (1 + Math.max(0, row.rank)), snippet: row.snippet, v: 1 };
    });
  }

  syncState(remoteId: string): Readonly<{ pulledSequence: number; pushedSequence: number; remoteHeadSha256: Sha256Hex | null }> {
    this.#assertOpen();
    const id = safeCode(remoteId);
    if (id === null) throw new TypeError("Invalid remote ID.");
    const row = this.database.query<{ pulled_sequence: number; pushed_sequence: number; remote_head_sha256: string | null }, [string, string]>(
      "SELECT pulled_sequence, pushed_sequence, remote_head_sha256 FROM oh_sync_state WHERE remote_id = ? AND space_id = ?",
    ).get(id, this.spaceId);
    const digest = row?.remote_head_sha256 === null || row === null ? null : parseSha256Hex(row.remote_head_sha256);
    if (row !== null && row.remote_head_sha256 !== null && digest === null) throw new OhIntegrityError("Invalid remote head digest.");
    return { pulledSequence: row?.pulled_sequence ?? 0, pushedSequence: row?.pushed_sequence ?? 0, remoteHeadSha256: digest };
  }

  updateSyncState(remoteId: string, state: Readonly<{ pulledSequence: number; pushedSequence: number; remoteHeadSha256: Sha256Hex | null }>): void {
    this.#assertOpen();
    const id = safeCode(remoteId);
    if (id === null || !Number.isSafeInteger(state.pulledSequence) || state.pulledSequence < 0
      || !Number.isSafeInteger(state.pushedSequence) || state.pushedSequence < 0) throw new TypeError("Invalid sync state.");
    this.database.query(`INSERT INTO oh_sync_state(remote_id, space_id, pulled_sequence,
      pushed_sequence, remote_head_sha256, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(remote_id, space_id) DO UPDATE SET pulled_sequence = excluded.pulled_sequence,
      pushed_sequence = excluded.pushed_sequence, remote_head_sha256 = excluded.remote_head_sha256,
      updated_at = excluded.updated_at`).run(id, this.spaceId, state.pulledSequence,
      state.pushedSequence, state.remoteHeadSha256, canonicalNow());
  }

  verifyReplay(): OhReplayVerificationV1 {
    this.#assertOpen();
    const integrity = this.database.query<{ integrity_check: string }, []>("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok") throw new OhIntegrityError("SQLite integrity_check failed.");
    const storedCount = this.database.query<{ count: number }, [string]>(
      "SELECT count(*) AS count FROM oh_operations WHERE space_id = ?",
    ).get(this.spaceId)?.count ?? 0;
    const operations: readonly OhOperationV1[] = storedCount <= 1000
      ? this.exportOperations(0, 1000)
      : this.database.query<OperationRow, [string]>(
          "SELECT operation_json FROM oh_operations WHERE space_id = ? ORDER BY sequence",
        ).all(this.spaceId).map((row) => {
        let value: unknown;
        try { value = JSON.parse(row.operation_json); } catch { throw new OhIntegrityError("A stored operation is not JSON."); }
        if (canonicalJson(value) !== row.operation_json) throw new OhIntegrityError("A stored operation is not canonical JSON.");
        const parsed = parseOhOperationV1(value);
        if (parsed === null) throw new OhIntegrityError("A stored operation is invalid.");
        return parsed;
      });
    return this.#verifyOperations(operations);
  }

  #verifyOperations(operations: readonly OhOperationV1[]): OhReplayVerificationV1 {
    const records = new Map<string, KnowledgeGraphRecordV1>();
    const materializedBy = new Map<string, Readonly<{ operationSha256: Sha256Hex; sequence: number }>>();
    let head: OhHeadV1 = { generation: 0, graphRevisionSha256: null, operationSha256: null,
      recordsSha256: EMPTY_RECORDS_SHA256, sequence: 0, v: 1 };
    for (const operation of operations) {
      if (operation.spaceId !== this.spaceId || operation.sequence !== head.sequence + 1
        || operation.parentOperationSha256 !== head.operationSha256) throw new OhIntegrityError("Operation replay chain is broken.");
      for (const change of operation.changes) {
        if (change.kind === "put") {
          records.set(change.record.key, change.record);
          materializedBy.set(change.record.key, { operationSha256: operation.operationSha256,
            sequence: operation.sequence });
        }
        else {
          const prior = records.get(change.key);
          if (prior?.recordSha256 !== change.priorSha256) throw new OhIntegrityError("Replay tombstone does not match its prior record.");
          records.delete(change.key);
          materializedBy.delete(change.key);
        }
      }
      for (const record of records.values()) {
        if (record.dependencies.some((dependency) => !records.has(dependency))) throw new OhIntegrityError("Replay has a missing dependency.");
      }
      const refs = [...records.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
        .map(knowledgeGraphRecordRefV1);
      const recordsSha256 = canonicalSha256(refs);
      const graphRevisionSha256 = graphRevisionSha256V1({ changes: operation.changes,
        operationId: operation.operationId, parentGraphRevisionSha256: head.graphRevisionSha256,
        recordsSha256, revision: operation.sequence });
      if (recordsSha256 !== operation.recordsSha256 || graphRevisionSha256 !== operation.graphRevisionSha256) {
        throw new OhIntegrityError("Replay does not reproduce an operation head.");
      }
      head = { generation: operation.sequence, graphRevisionSha256, operationSha256: operation.operationSha256,
        recordsSha256, sequence: operation.sequence, v: 1 };
    }
    const storedRows = this.database.query<CurrentRecordRow, [string]>(
      `SELECT record_key, kind, record_sha256, record_json, operation_sha256, sequence
       FROM oh_records WHERE space_id = ? ORDER BY record_key`,
    ).all(this.spaceId);
    if (storedRows.length !== records.size || storedRows.some((row) => {
      const record = records.get(row.record_key);
      const provenance = materializedBy.get(row.record_key);
      return record === undefined || record.kind !== row.kind || record.recordSha256 !== row.record_sha256
        || canonicalJson(record) !== row.record_json || provenance === undefined
        || provenance.operationSha256 !== row.operation_sha256 || provenance.sequence !== row.sequence;
    })) throw new OhIntegrityError("Materialized records do not match operation replay.");
    const storedDependencies = this.database.query<{
      dependency_key: string; record_key: string;
    }, [string]>(`SELECT record_key, dependency_key FROM oh_dependencies
      WHERE space_id = ? ORDER BY record_key, dependency_key`).all(this.spaceId);
    const expectedDependencies = [...records.values()]
      .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
      .flatMap((record) => record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })));
    if (canonicalJson(storedDependencies) !== canonicalJson(expectedDependencies)) {
      throw new OhIntegrityError("Materialized dependencies do not match operation replay.");
    }
    const storedOperationRecords = this.database.query<{
      change_kind: string; operation_sha256: string; ordinal: number; record_key: string; record_sha256: string | null;
    }, [string]>(`SELECT materialized.operation_sha256, materialized.ordinal, materialized.record_key,
        materialized.change_kind, materialized.record_sha256
      FROM oh_operation_records AS materialized
      JOIN oh_operations AS operation ON operation.operation_sha256 = materialized.operation_sha256
      WHERE operation.space_id = ? ORDER BY operation.sequence, materialized.ordinal`).all(this.spaceId);
    const expectedOperationRecords = operations.flatMap((operation) => operation.changes.map((change, ordinal) => ({
      change_kind: change.kind,
      operation_sha256: operation.operationSha256,
      ordinal,
      record_key: change.kind === "put" ? change.record.key : change.key,
      record_sha256: change.kind === "put" ? change.record.recordSha256 : change.priorSha256,
    })));
    if (canonicalJson(storedOperationRecords) !== canonicalJson(expectedOperationRecords)) {
      throw new OhIntegrityError("Materialized operation records do not match operation replay.");
    }
    if (canonicalJson(head) !== canonicalJson(this.head())) throw new OhIntegrityError("The stored head does not match operation replay.");
    return { head, operations: operations.length, records: records.size, sqliteIntegrity: "ok", v: 1 };
  }

  contract(): Readonly<{ manifest: typeof OH_CONTRACT_MANIFEST_V1; sqliteSchemaVersion: number }> {
    return { manifest: OH_CONTRACT_MANIFEST_V1, sqliteSchemaVersion: OH_SQLITE_SCHEMA_VERSION };
  }

  close(): void {
    if (this.#closed) return;
    this.database.close(false);
    this.#closed = true;
  }
}
