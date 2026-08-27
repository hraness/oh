// @bun
// src/sqlite/driver.ts
import { Database } from "bun:sqlite";
function openOhSqliteDatabase(path) {
  const database = new Database(path, { create: true, strict: true });
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA trusted_schema = OFF");
  return database;
}
function withImmediateTransaction(database, work) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}
// src/canonical.ts
import { createHash, randomBytes } from "crypto";

class OhValidationError extends Error {
  code;
  path;
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = "OhValidationError";
    this.code = code;
    this.path = path;
  }
}
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function assertUnicodeScalarString(value, path) {
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343)) {
        throw new OhValidationError("invalid-unicode", path, "contains an unpaired surrogate");
      }
      index += 1;
    } else if (code >= 56320 && code <= 57343) {
      throw new OhValidationError("invalid-unicode", path, "contains an unpaired surrogate");
    }
  }
}
function encodeCanonical(value, path, ancestors) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") {
    assertUnicodeScalarString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new OhValidationError("non-json-number", path, "must be finite");
    }
    if (Object.is(value, -0)) {
      throw new OhValidationError("noncanonical-number", path, "negative zero is not canonical");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === null) {
    throw new OhValidationError("non-json-value", path, `cannot encode ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new OhValidationError("cycle", path, "contains a cycle");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const encoded = [];
      for (let index = 0;index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new OhValidationError("sparse-array", `${path}[${index}]`, "must not contain holes");
        }
        encoded.push(encodeCanonical(value[index], `${path}[${index}]`, ancestors));
      }
      const extraKeys = Reflect.ownKeys(value).filter((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length));
      if (extraKeys.length > 0) {
        throw new OhValidationError("non-json-property", path, "array has non-index properties");
      }
      return `[${encoded.join(",")}]`;
    }
    if (!isPlainRecord(value)) {
      throw new OhValidationError("non-plain-object", path, "must be a plain object");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new OhValidationError("non-json-property", path, "object has a symbol property");
    }
    const keys = ownKeys;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new OhValidationError("non-json-property", `${path}.${key}`, "must be an enumerable data property");
      }
    }
    keys.sort();
    const entries = keys.map((key) => {
      assertUnicodeScalarString(key, `${path}.<key>`);
      return `${JSON.stringify(key)}:${encodeCanonical(value[key], `${path}.${key}`, ancestors)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
function canonicalJson(value) {
  return encodeCanonical(value, "$", new Set);
}
function parseCanonicalJson(text, maximumBytes = 16 * 1024 * 1024) {
  if (utf8ByteLength(text) > maximumBytes) {
    throw new OhValidationError("limit-exceeded", "$", "canonical JSON exceeds its byte limit");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new OhValidationError("invalid-json", "$", "is not valid JSON");
  }
  if (canonicalJson(value) !== text) {
    throw new OhValidationError("noncanonical-json", "$", "keys or values are not canonical");
  }
  return value;
}
function utf8ByteLength(value) {
  return Buffer.byteLength(value, "utf8");
}
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function canonicalSha256(value) {
  return sha256Hex(canonicalJson(value));
}
function parseSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}
function parseCanonicalInstantV1(value) {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : null;
}
function canonicalNow() {
  return new Date().toISOString();
}
function opaqueId(prefix) {
  if (!/^[a-z][a-z0-9_]{1,15}$/u.test(prefix)) {
    throw new OhValidationError("invalid-prefix", "prefix", "must be a short lowercase code");
  }
  return `${prefix}${randomBytes(12).toString("hex")}`;
}
function safeCode(value, maximumLength = 128) {
  return typeof value === "string" && value.length <= maximumLength && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function boundedText(value, maximumBytes = 64 * 1024) {
  if (typeof value !== "string" || value.length === 0 || value.normalize("NFC") !== value || utf8ByteLength(value) > maximumBytes)
    return null;
  try {
    assertUnicodeScalarString(value, "$text");
  } catch {
    return null;
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code >= 11 && code <= 12 || code >= 14 && code <= 31 || code >= 127 && code <= 159)
      return null;
  }
  return value;
}
function orderedUnique(values, key) {
  return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value));
}
function sortUnique(values, key) {
  const sorted = [...values].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (!orderedUnique(sorted, key)) {
    throw new OhValidationError("duplicate", "$", "contains duplicate canonical values");
  }
  return sorted;
}

// src/sqlite/migrations.ts
var OH_SQLITE_SCHEMA_VERSION = 1;
var OH_SQLITE_MIGRATIONS = Object.freeze([
  Object.freeze({
    name: "0001_oh_core",
    version: 1,
    sql: `
CREATE TABLE oh_contracts (
  contract_id TEXT PRIMARY KEY,
  contract_sha256 TEXT NOT NULL CHECK(length(contract_sha256) = 64),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE oh_spaces (
  space_id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES oh_contracts(contract_id),
  generation INTEGER NOT NULL CHECK(generation >= 0),
  head_operation_sha256 TEXT CHECK(head_operation_sha256 IS NULL OR length(head_operation_sha256) = 64),
  graph_revision_sha256 TEXT CHECK(graph_revision_sha256 IS NULL OR length(graph_revision_sha256) = 64),
  records_sha256 TEXT NOT NULL CHECK(length(records_sha256) = 64),
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(generation = sequence),
  CHECK((sequence = 0) = (head_operation_sha256 IS NULL)),
  CHECK((sequence = 0) = (graph_revision_sha256 IS NULL))
) STRICT;

CREATE TABLE oh_operations (
  operation_sha256 TEXT PRIMARY KEY CHECK(length(operation_sha256) = 64),
  space_id TEXT NOT NULL REFERENCES oh_spaces(space_id),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  operation_id TEXT NOT NULL,
  parent_operation_sha256 TEXT CHECK(parent_operation_sha256 IS NULL OR length(parent_operation_sha256) = 64),
  graph_revision_sha256 TEXT NOT NULL CHECK(length(graph_revision_sha256) = 64),
  records_sha256 TEXT NOT NULL CHECK(length(records_sha256) = 64),
  operation_json TEXT NOT NULL CHECK(json_valid(operation_json)),
  instant TEXT NOT NULL,
  UNIQUE(space_id, sequence),
  UNIQUE(space_id, operation_id)
) STRICT;

CREATE TABLE oh_operation_records (
  operation_sha256 TEXT NOT NULL REFERENCES oh_operations(operation_sha256),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  record_key TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK(change_kind IN ('put', 'tombstone')),
  record_sha256 TEXT CHECK(record_sha256 IS NULL OR length(record_sha256) = 64),
  PRIMARY KEY(operation_sha256, ordinal),
  UNIQUE(operation_sha256, record_key)
) STRICT;

CREATE TABLE oh_records (
  space_id TEXT NOT NULL REFERENCES oh_spaces(space_id),
  record_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  record_sha256 TEXT NOT NULL CHECK(length(record_sha256) = 64),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  operation_sha256 TEXT NOT NULL REFERENCES oh_operations(operation_sha256),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  PRIMARY KEY(space_id, record_key)
) STRICT;

CREATE TABLE oh_dependencies (
  space_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  dependency_key TEXT NOT NULL,
  PRIMARY KEY(space_id, record_key, dependency_key),
  FOREIGN KEY(space_id, record_key) REFERENCES oh_records(space_id, record_key) ON DELETE CASCADE,
  FOREIGN KEY(space_id, dependency_key) REFERENCES oh_records(space_id, record_key)
) STRICT;

CREATE TABLE oh_sync_outbox (
  space_id TEXT NOT NULL REFERENCES oh_spaces(space_id),
  sequence INTEGER NOT NULL,
  operation_sha256 TEXT NOT NULL REFERENCES oh_operations(operation_sha256),
  PRIMARY KEY(space_id, sequence),
  UNIQUE(operation_sha256)
) STRICT;

CREATE TABLE oh_sync_state (
  remote_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES oh_spaces(space_id),
  pulled_sequence INTEGER NOT NULL CHECK(pulled_sequence >= 0),
  pushed_sequence INTEGER NOT NULL CHECK(pushed_sequence >= 0),
  remote_head_sha256 TEXT CHECK(remote_head_sha256 IS NULL OR length(remote_head_sha256) = 64),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(remote_id, space_id)
) STRICT;

CREATE TABLE oh_search_documents (
  space_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  record_sha256 TEXT NOT NULL CHECK(length(record_sha256) = 64),
  text TEXT NOT NULL,
  PRIMARY KEY(space_id, record_key),
  FOREIGN KEY(space_id, record_key) REFERENCES oh_records(space_id, record_key) ON DELETE CASCADE
) STRICT;

CREATE VIRTUAL TABLE oh_search_fts USING fts5(
  space_id UNINDEXED,
  record_key UNINDEXED,
  text,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE INDEX oh_operations_space_sequence ON oh_operations(space_id, sequence);
CREATE INDEX oh_records_space_kind ON oh_records(space_id, kind, record_key);
CREATE INDEX oh_dependencies_dependency ON oh_dependencies(space_id, dependency_key);
`
  })
]);
function applyOhSqliteMigrations(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS oh_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    migration_sha256 TEXT NOT NULL CHECK(length(migration_sha256) = 64),
    applied_at TEXT NOT NULL
  ) STRICT`);
  const select = database.query("SELECT name, migration_sha256 FROM oh_migrations WHERE version = ?");
  const insert = database.query("INSERT INTO oh_migrations(version, name, migration_sha256, applied_at) VALUES (?, ?, ?, ?)");
  for (const migration of OH_SQLITE_MIGRATIONS) {
    const digest = sha256Hex(migration.sql);
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = select.get(migration.version);
      if (existing !== null) {
        if (existing.name !== migration.name || existing.migration_sha256 !== digest) {
          throw new Error(`SQLite migration ${migration.version} does not match the applied migration.`);
        }
      } else {
        database.exec(migration.sql);
        insert.run(migration.version, migration.name, digest, canonicalNow());
      }
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }
}
// src/sqlite/store.ts
import { mkdirSync } from "fs";
import { dirname } from "path";

// src/graph.ts
var OH_GRAPH_FORMAT_VERSION_V1 = 1;
var OH_GRAPH_LIMITS_V1 = Object.freeze({
  changesPerOperation: 8192,
  dependenciesPerRecord: 4096,
  recordBytes: 1024 * 1024,
  recordsPerSnapshot: 65536
});
var OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 = [
  "activity",
  "assertion",
  "context",
  "dependency-manifest",
  "edition",
  "entity",
  "evidence",
  "identity-operation",
  "inquiry",
  "inquiry-event",
  "review-decision",
  "rights-decision",
  "schema",
  "shape",
  "statement",
  "type-membership",
  "view",
  "vocabulary"
];
function recordKey(value) {
  return typeof value === "string" && value.length <= 512 && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function createKnowledgeGraphRecordV1(input) {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["dependencies", "key", "kind", "v", "value"]) || input.v !== 1 || !Array.isArray(input.dependencies))
    throw new TypeError("Invalid graph record input.");
  const key = recordKey(input.key);
  const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === input.kind);
  if (key === null || kind === undefined || input.dependencies.length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord)
    throw new TypeError("Invalid graph record identity.");
  const dependencies = input.dependencies.map(recordKey);
  if (dependencies.some((dependency) => dependency === null) || !orderedUnique(dependencies, String) || dependencies.includes(key)) {
    throw new TypeError("Graph dependencies must be ordered, unique, and non-reflexive.");
  }
  const valueJson = canonicalJson(input.value);
  if (Buffer.byteLength(valueJson, "utf8") > OH_GRAPH_LIMITS_V1.recordBytes) {
    throw new RangeError("Graph record value exceeds its canonical byte limit.");
  }
  const payload = { dependencies, key, kind, v: 1, value: input.value };
  return { ...payload, recordSha256: canonicalSha256(payload) };
}
function parseKnowledgeGraphRecordV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "recordSha256"))
    return null;
  const recordSha256 = parseSha256Hex(value.recordSha256);
  const { recordSha256: _digest, ...input } = value;
  try {
    const created = createKnowledgeGraphRecordV1(input);
    return recordSha256 !== null && created.recordSha256 === recordSha256 ? { ...created, recordSha256 } : null;
  } catch {
    return null;
  }
}
function knowledgeGraphRecordRefV1(record) {
  return {
    dependencies: record.dependencies,
    key: record.key,
    kind: record.kind,
    sha256: record.recordSha256,
    v: 1
  };
}
function changeKey(change) {
  return change.kind === "put" ? change.record.key : change.key;
}
function canonicalKnowledgeGraphChangesV1(changes) {
  const normalized = [];
  for (const change of changes) {
    if (!isPlainRecord(change) || change.v !== 1)
      throw new TypeError("Invalid graph change.");
    if (change.kind === "put") {
      const record = parseKnowledgeGraphRecordV1(change.record);
      if (record === null)
        throw new TypeError("Invalid graph record in change.");
      normalized.push({ kind: "put", record, v: 1 });
    } else if (change.kind === "tombstone") {
      const key = recordKey(change.key);
      const priorSha256 = parseSha256Hex(change.priorSha256);
      if (key === null || priorSha256 === null)
        throw new TypeError("Invalid graph tombstone.");
      normalized.push({ key, kind: "tombstone", priorSha256, v: 1 });
    } else
      throw new TypeError("Unknown graph change kind.");
  }
  return sortUnique(normalized, changeKey);
}
function graphRevisionSha256V1(input) {
  const changes = canonicalKnowledgeGraphChangesV1(input.changes);
  const operationId = safeCode(input.operationId);
  const parentGraphRevisionSha256 = input.parentGraphRevisionSha256 === null ? null : parseSha256Hex(input.parentGraphRevisionSha256);
  const recordsSha256 = parseSha256Hex(input.recordsSha256);
  const revision = Number.isSafeInteger(input.revision) && input.revision > 0 ? input.revision : null;
  if (changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation || operationId === null || recordsSha256 === null || revision === null || input.parentGraphRevisionSha256 !== null && parentGraphRevisionSha256 === null || revision === 1 !== (parentGraphRevisionSha256 === null)) {
    throw new TypeError("Invalid graph revision digest input.");
  }
  return canonicalSha256({ changes, operationId, parentGraphRevisionSha256, recordsSha256, revision, v: 1 });
}
function createKnowledgeGraphRevisionV1(input) {
  if (input.parent !== null && parseKnowledgeGraphRevisionV1(input.parent) === null) {
    throw new TypeError("Invalid parent graph revision.");
  }
  const operationId = safeCode(input.operationId);
  const changes = canonicalKnowledgeGraphChangesV1(input.changes);
  if (operationId === null || changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation)
    throw new TypeError("Invalid graph revision.");
  const byKey = new Map((input.parent?.recordRefs ?? []).map((ref) => [ref.key, ref]));
  for (const change of changes) {
    if (change.kind === "put") {
      for (const dependency of change.record.dependencies) {
        if (!byKey.has(dependency) && !changes.some((candidate) => candidate.kind === "put" && candidate.record.key === dependency)) {
          throw new TypeError(`Missing graph dependency: ${dependency}`);
        }
      }
      byKey.set(change.record.key, knowledgeGraphRecordRefV1(change.record));
    } else {
      const prior = byKey.get(change.key);
      if (prior === undefined || prior.sha256 !== change.priorSha256)
        throw new TypeError("Tombstone prior digest does not match.");
      byKey.delete(change.key);
    }
  }
  if (byKey.size > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    throw new RangeError("Graph revision exceeds its record snapshot limit.");
  }
  for (const ref of byKey.values()) {
    if (ref.dependencies.some((dependency) => !byKey.has(dependency))) {
      throw new TypeError(`Missing graph dependency after revision: ${ref.key}`);
    }
  }
  const recordRefs = [...byKey.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const recordsSha256 = canonicalSha256(recordRefs);
  const payload = {
    changes,
    operationId,
    parentGraphRevisionSha256: input.parent?.graphRevisionSha256 ?? null,
    recordRefs,
    recordsSha256,
    revision: (input.parent?.revision ?? 0) + 1,
    v: 1
  };
  return { ...payload, graphRevisionSha256: graphRevisionSha256V1(payload) };
}
function parseKnowledgeGraphRevisionV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "changes",
    "graphRevisionSha256",
    "operationId",
    "parentGraphRevisionSha256",
    "recordRefs",
    "recordsSha256",
    "revision",
    "v"
  ]) || value.v !== 1 || !Array.isArray(value.changes) || !Array.isArray(value.recordRefs) || value.recordRefs.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot)
    return null;
  const graphRevisionSha256 = parseSha256Hex(value.graphRevisionSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const parentGraphRevisionSha256 = value.parentGraphRevisionSha256 === null ? null : parseSha256Hex(value.parentGraphRevisionSha256);
  const operationId = safeCode(value.operationId);
  const revision = Number.isSafeInteger(value.revision) && value.revision > 0 ? value.revision : null;
  let changes;
  try {
    changes = canonicalKnowledgeGraphChangesV1(value.changes);
  } catch {
    return null;
  }
  const refs = [];
  for (const item of value.recordRefs) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["dependencies", "key", "kind", "sha256", "v"]) || item.v !== 1 || !Array.isArray(item.dependencies))
      return null;
    const dependencies = item.dependencies.map(recordKey);
    const key = recordKey(item.key);
    const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === item.kind);
    const sha256 = parseSha256Hex(item.sha256);
    if (key === null || kind === undefined || sha256 === null || dependencies.some((dependency) => dependency === null) || dependencies.length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord || !orderedUnique(dependencies, String) || dependencies.includes(key))
      return null;
    refs.push({ dependencies, key, kind, sha256, v: 1 });
  }
  if (graphRevisionSha256 === null || recordsSha256 === null || operationId === null || revision === null || value.parentGraphRevisionSha256 !== null && parentGraphRevisionSha256 === null || !orderedUnique(refs, (ref) => ref.key) || canonicalSha256(refs) !== recordsSha256)
    return null;
  const keys = new Set(refs.map((ref) => ref.key));
  if (refs.some((ref) => ref.dependencies.some((dependency) => !keys.has(dependency))))
    return null;
  const payload = {
    changes,
    operationId,
    parentGraphRevisionSha256,
    recordRefs: refs,
    recordsSha256,
    revision,
    v: 1
  };
  try {
    return graphRevisionSha256V1(payload) === graphRevisionSha256 ? { ...payload, graphRevisionSha256 } : null;
  } catch {
    return null;
  }
}
function reduceKnowledgeGraphRevisionsV1(revisions) {
  if (revisions.length === 0 || revisions.length > 65536)
    return null;
  const ordered = [...revisions].sort((left, right) => left.revision - right.revision);
  let parent = null;
  const operationIds = new Set;
  for (const candidate of ordered) {
    const current = parseKnowledgeGraphRevisionV1(candidate);
    if (current === null || current.revision !== (parent?.revision ?? 0) + 1 || current.parentGraphRevisionSha256 !== (parent?.graphRevisionSha256 ?? null) || operationIds.has(current.operationId))
      return null;
    try {
      const rebuilt = createKnowledgeGraphRevisionV1({ changes: current.changes, operationId: current.operationId, parent });
      if (rebuilt.graphRevisionSha256 !== current.graphRevisionSha256)
        return null;
    } catch {
      return null;
    }
    operationIds.add(current.operationId);
    parent = current;
  }
  return parent;
}

// src/ontology.ts
var OH_ONTOLOGY_VERSION_V1 = "1.0.0";
var OH_CONTRACT_ID_V1 = "oh.ontology.v1";
var OH_KNOWLEDGE_LIMITS_V1 = Object.freeze({
  dimensions: 64,
  listValues: 256,
  qualifiers: 128,
  statementBytes: 256 * 1024,
  textBytes: 64 * 1024
});
var OH_KNOWLEDGE_KERNEL_CONCEPTS_V1 = [
  { code: "entity", description: "A stable identity anchor for something that can be referred to.", label: "Entity" },
  { code: "statement", description: "An immutable proposition with a subject, predicate, object, and qualifiers.", label: "Statement" },
  { code: "assertion", description: "An attributable stance toward a statement.", label: "Assertion" },
  { code: "evidence", description: "A typed account of how an observation bears on an assertion.", label: "Evidence" },
  { code: "context", description: "The scenario and dimensions in which knowledge applies.", label: "Context" },
  { code: "inquiry", description: "A question and its durable investigation trail.", label: "Inquiry" },
  { code: "projection", description: "A reproducible view derived from exact knowledge.", label: "Projection" }
];
function success(value) {
  return { ok: true, value };
}
function failure(field, code = "invalid-input") {
  return { error: { code, field }, ok: false };
}
function parseOpaqueId(value, prefix) {
  return typeof value === "string" && new RegExp(`^${prefix}[a-z0-9]{24}$`, "u").test(value) ? value : null;
}
function parseKnowledgeEntityId(value) {
  return parseOpaqueId(value, "kent_");
}
function parseKnowledgeAssertionId(value) {
  return parseOpaqueId(value, "kast_");
}
function parseKnowledgeEvidenceId(value) {
  return parseOpaqueId(value, "kevd_");
}
function parseKnowledgeInquiryId(value) {
  return parseOpaqueId(value, "kinq_");
}
var OH_KNOWLEDGE_ENTITY_STATES_V1 = ["active", "quarantined", "redirected", "tombstoned"];
function parseKnowledgeEntityV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "entityId",
    "identityOperationId",
    "identityRevision",
    "redirectEntityId",
    "state",
    "v"
  ]) || value.v !== 1)
    return failure("entity");
  const entityId = parseKnowledgeEntityId(value.entityId);
  const identityOperationId = safeCode(value.identityOperationId);
  const identityRevision = Number.isSafeInteger(value.identityRevision) && value.identityRevision > 0 ? value.identityRevision : null;
  const redirectEntityId = value.redirectEntityId === null ? null : parseKnowledgeEntityId(value.redirectEntityId);
  const state = OH_KNOWLEDGE_ENTITY_STATES_V1.find((candidate) => candidate === value.state);
  return entityId !== null && identityOperationId !== null && identityRevision !== null && (value.redirectEntityId === null || redirectEntityId !== null) && state !== undefined && state === "redirected" === (redirectEntityId !== null) && redirectEntityId !== entityId ? success({ entityId, identityOperationId, identityRevision, redirectEntityId, state, v: 1 }) : failure("entity");
}
function parseKnowledgeSchemaRefV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["code", "namespace", "revision", "schemaSha256", "v"]) || value.v !== 1)
    return failure("schemaRef");
  const code = safeCode(value.code);
  const namespace = safeCode(value.namespace);
  const revision = Number.isSafeInteger(value.revision) && value.revision > 0 ? value.revision : null;
  const schemaSha256 = parseSha256Hex(value.schemaSha256);
  return code !== null && namespace !== null && revision !== null && schemaSha256 !== null ? success({ code, namespace, revision, schemaSha256, v: 1 }) : failure("schemaRef");
}
var INTEGER = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u;
var DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u;
function parseKnowledgeValueInternal(value, depth) {
  if (!isPlainRecord(value) || value.v !== 1 || depth > 8)
    return null;
  switch (value.kind) {
    case "entity": {
      if (!hasExactKeys(value, ["entityId", "kind", "v"]))
        return null;
      const entityId = parseKnowledgeEntityId(value.entityId);
      return entityId === null ? null : { entityId, kind: "entity", v: 1 };
    }
    case "text": {
      if (!hasExactKeys(value, ["kind", "language", "text", "v"]))
        return null;
      const language = typeof value.language === "string" && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value.language) ? value.language : null;
      const text = boundedText(value.text);
      return language !== null && text !== null ? { kind: "text", language, text, v: 1 } : null;
    }
    case "string": {
      const parsed = boundedText(value.value);
      return hasExactKeys(value, ["kind", "v", "value"]) && parsed !== null ? { kind: "string", v: 1, value: parsed } : null;
    }
    case "boolean":
      return hasExactKeys(value, ["kind", "v", "value"]) && typeof value.value === "boolean" ? { kind: "boolean", v: 1, value: value.value } : null;
    case "integer":
    case "decimal": {
      const valid = typeof value.value === "string" && value.value.length <= 1024 && (value.kind === "integer" ? INTEGER.test(value.value) : DECIMAL.test(value.value) && value.value !== "-0");
      return hasExactKeys(value, ["kind", "v", "value"]) && valid ? { kind: value.kind, v: 1, value: value.value } : null;
    }
    case "uri": {
      if (!hasExactKeys(value, ["kind", "uri", "v"]) || typeof value.uri !== "string" || value.uri.length > 4096)
        return null;
      try {
        const url = new URL(value.uri);
        return url.href === value.uri && url.username === "" && url.password === "" && !["data:", "file:", "javascript:"].includes(url.protocol) ? { kind: "uri", uri: value.uri, v: 1 } : null;
      } catch {
        return null;
      }
    }
    case "list":
    case "set": {
      if (!hasExactKeys(value, ["kind", "v", "values"]) || !Array.isArray(value.values) || value.values.length > OH_KNOWLEDGE_LIMITS_V1.listValues)
        return null;
      const values = [];
      for (const item of value.values) {
        const parsed = parseKnowledgeValueInternal(item, depth + 1);
        if (parsed === null)
          return null;
        values.push(parsed);
      }
      if (value.kind === "set" && !orderedUnique(values, canonicalJson))
        return null;
      return { kind: value.kind, v: 1, values };
    }
    case "extension": {
      if (!hasExactKeys(value, ["canonicalizerSha256", "canonicalValue", "kind", "mediaType", "schema", "v", "valueSha256"]))
        return null;
      const canonicalizerSha256 = parseSha256Hex(value.canonicalizerSha256);
      const canonicalValue = boundedText(value.canonicalValue, 64 * 1024);
      const mediaType = typeof value.mediaType === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value.mediaType) ? value.mediaType : null;
      const schema = parseKnowledgeSchemaRefV1(value.schema);
      const valueSha256 = parseSha256Hex(value.valueSha256);
      return canonicalizerSha256 !== null && canonicalValue !== null && mediaType !== null && schema.ok && valueSha256 !== null ? { canonicalizerSha256, canonicalValue, kind: "extension", mediaType, schema: schema.value, v: 1, valueSha256 } : null;
    }
    default:
      return null;
  }
}
function parseKnowledgeValueV1(value) {
  const parsed = parseKnowledgeValueInternal(value, 0);
  return parsed === null ? failure("value") : success(parsed);
}
function verifyKnowledgeValueV1(value) {
  const parsed = parseKnowledgeValueV1(value);
  if (!parsed.ok)
    return parsed;
  if (parsed.value.kind === "extension" && sha256Hex(parsed.value.canonicalValue) !== parsed.value.valueSha256) {
    return failure("valueSha256", "digest-mismatch");
  }
  if (parsed.value.kind === "list" || parsed.value.kind === "set") {
    for (const child of parsed.value.values) {
      const verified = verifyKnowledgeValueV1(child);
      if (!verified.ok)
        return verified;
    }
  }
  return success(parsed.value);
}
function parseDimension(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["predicate", "v", "value"]) || value.v !== 1)
    return null;
  const predicate = parseKnowledgeSchemaRefV1(value.predicate);
  const parsedValue = parseKnowledgeValueV1(value.value);
  return predicate.ok && parsedValue.ok ? { predicate: predicate.value, v: 1, value: parsedValue.value } : null;
}
function createKnowledgeContextV1(input) {
  if (!isPlainRecord(input) || input.v !== 1 || !Array.isArray(input.dimensions) || input.dimensions.length > OH_KNOWLEDGE_LIMITS_V1.dimensions || !["actual", "counterfactual", "hypothetical", "planned"].includes(input.scenario))
    return failure("context");
  const dimensions = [];
  for (const item of input.dimensions) {
    const parsed = parseDimension(item);
    if (parsed === null)
      return failure("dimensions");
    const verified = verifyKnowledgeValueV1(parsed.value);
    if (!verified.ok)
      return verified;
    dimensions.push(parsed);
  }
  let canonicalDimensions;
  try {
    canonicalDimensions = sortUnique(dimensions, canonicalJson);
  } catch {
    return failure("dimensions", "noncanonical-input");
  }
  const payload = { dimensions: canonicalDimensions, scenario: input.scenario, v: 1 };
  return success({ ...payload, contextSha256: canonicalSha256(payload) });
}
function parseKnowledgeContextV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["contextSha256", "dimensions", "scenario", "v"]))
    return failure("context");
  const digest = parseSha256Hex(value.contextSha256);
  if (digest === null)
    return failure("contextSha256");
  const created = createKnowledgeContextV1({ dimensions: value.dimensions, scenario: value.scenario, v: value.v });
  return created.ok && created.value.contextSha256 === digest && canonicalJson(created.value.dimensions) === canonicalJson(value.dimensions) ? success({ ...created.value, contextSha256: digest }) : failure("contextSha256", "digest-mismatch");
}
function createKnowledgeStatementV1(input) {
  const object = parseKnowledgeValueV1(input.object);
  const predicate = parseKnowledgeSchemaRefV1(input.predicate);
  const subject = parseKnowledgeEntityId(input.subject);
  if (input.v !== 1 || !object.ok || !predicate.ok || subject === null || !Array.isArray(input.qualifiers) || input.qualifiers.length > OH_KNOWLEDGE_LIMITS_V1.qualifiers)
    return failure("statement");
  const verifiedObject = verifyKnowledgeValueV1(object.value);
  if (!verifiedObject.ok)
    return verifiedObject;
  const qualifiers = [];
  for (const item of input.qualifiers) {
    const parsed = parseDimension(item);
    if (parsed === null)
      return failure("qualifiers");
    const verified = verifyKnowledgeValueV1(parsed.value);
    if (!verified.ok)
      return verified;
    qualifiers.push(parsed);
  }
  let canonicalQualifiers;
  try {
    canonicalQualifiers = sortUnique(qualifiers, canonicalJson);
  } catch {
    return failure("qualifiers", "noncanonical-input");
  }
  const payload = { object: object.value, predicate: predicate.value, qualifiers: canonicalQualifiers, subject, v: 1 };
  if (Buffer.byteLength(canonicalJson(payload), "utf8") > OH_KNOWLEDGE_LIMITS_V1.statementBytes)
    return failure("statement", "limit-exceeded");
  return success({ ...payload, statementSha256: canonicalSha256(payload) });
}
function parseKnowledgeStatementV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["object", "predicate", "qualifiers", "statementSha256", "subject", "v"]))
    return failure("statement");
  const digest = parseSha256Hex(value.statementSha256);
  const created = createKnowledgeStatementV1(value);
  return digest !== null && created.ok && created.value.statementSha256 === digest && canonicalJson(created.value.qualifiers) === canonicalJson(value.qualifiers) ? success({ ...created.value, statementSha256: digest }) : failure("statementSha256", "digest-mismatch");
}
function parseKnowledgeAgentRefV1(value) {
  if (!isPlainRecord(value) || value.v !== 1)
    return null;
  if (value.kind === "entity" && hasExactKeys(value, ["entityId", "kind", "v"])) {
    const entityId = parseKnowledgeEntityId(value.entityId);
    return entityId === null ? null : { entityId, kind: "entity", v: 1 };
  }
  if (value.kind === "model" && hasExactKeys(value, ["kind", "model", "receiptSha256", "v"])) {
    const model = parseKnowledgeSchemaRefV1(value.model);
    const receiptSha256 = parseSha256Hex(value.receiptSha256);
    return model.ok && receiptSha256 !== null ? { kind: "model", model: model.value, receiptSha256, v: 1 } : null;
  }
  if (value.kind === "system" && hasExactKeys(value, ["authority", "kind", "receiptSha256", "v"])) {
    const authority = parseKnowledgeSchemaRefV1(value.authority);
    const receiptSha256 = parseSha256Hex(value.receiptSha256);
    return authority.ok && receiptSha256 !== null ? { authority: authority.value, kind: "system", receiptSha256, v: 1 } : null;
  }
  return null;
}
function parseDigestArray(value, maximum = 2048) {
  if (!Array.isArray(value) || value.length > maximum)
    return null;
  const digests = value.map(parseSha256Hex);
  return digests.every((digest) => digest !== null) && orderedUnique(digests, String) ? digests : null;
}
var OH_KNOWLEDGE_ACTIVITY_KINDS_V1 = [
  "extraction",
  "human-entry",
  "human-review",
  "import",
  "model-proposal",
  "normalization",
  "publication",
  "resolution",
  "transformation"
];
function parseActivityInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "actor",
    "inputSha256s",
    "kind",
    "occurredAt",
    "outputSha256s",
    "policySha256",
    "tool",
    "v"
  ]) || value.v !== 1)
    return null;
  const actor = parseKnowledgeAgentRefV1(value.actor);
  const inputSha256s = parseDigestArray(value.inputSha256s);
  const kind = OH_KNOWLEDGE_ACTIVITY_KINDS_V1.find((candidate) => candidate === value.kind);
  const occurredAt = parseCanonicalInstantV1(value.occurredAt);
  const outputSha256s = parseDigestArray(value.outputSha256s);
  const policySha256 = parseSha256Hex(value.policySha256);
  const tool = value.tool === null ? null : parseKnowledgeSchemaRefV1(value.tool);
  const parsedTool = tool === null ? null : tool.ok ? tool.value : null;
  return actor !== null && inputSha256s !== null && kind !== undefined && occurredAt !== null && outputSha256s !== null && policySha256 !== null && (value.tool === null || parsedTool !== null) ? { actor, inputSha256s, kind, occurredAt, outputSha256s, policySha256, tool: parsedTool, v: 1 } : null;
}
function createKnowledgeActivityV1(input) {
  const parsed = parseActivityInput(input);
  return parsed === null ? failure("activity") : success({ ...parsed, activitySha256: canonicalSha256(parsed) });
}
function parseKnowledgeActivityV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "activitySha256"))
    return failure("activity");
  const activitySha256 = parseSha256Hex(value.activitySha256);
  const { activitySha256: _digest, ...input } = value;
  const parsed = parseActivityInput(input);
  return activitySha256 !== null && parsed !== null && canonicalSha256(parsed) === activitySha256 ? success({ ...parsed, activitySha256 }) : failure("activitySha256", "digest-mismatch");
}
var OH_KNOWLEDGE_ASSERTION_STANCES_V1 = ["questions", "refutes", "reports", "supports", "undetermined"];
var OH_KNOWLEDGE_ASSERTION_STATES_V1 = [
  "accepted-for-purpose",
  "disputed",
  "proposed",
  "reviewed",
  "superseded",
  "withdrawn"
];
function parseStringCodes(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum)
    return null;
  const codes = value.map((item) => safeCode(item));
  return codes.every((code) => code !== null) && orderedUnique(codes, String) ? codes : null;
}
function parseAssertionInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "acceptedPurposes",
    "assertionId",
    "assertor",
    "confidence",
    "contextSha256",
    "provenanceActivitySha256",
    "reviewActivitySha256",
    "stance",
    "state",
    "statementSha256",
    "v"
  ]) || value.v !== 1)
    return null;
  const acceptedPurposes = parseStringCodes(value.acceptedPurposes, 32);
  const assertionId = parseKnowledgeAssertionId(value.assertionId);
  const assertor = parseKnowledgeAgentRefV1(value.assertor);
  const confidence = value.confidence === null ? null : parseKnowledgeSchemaRefV1(value.confidence);
  const parsedConfidence = confidence === null ? null : confidence.ok ? confidence.value : null;
  const contextSha256 = value.contextSha256 === null ? null : parseSha256Hex(value.contextSha256);
  const provenanceActivitySha256 = parseSha256Hex(value.provenanceActivitySha256);
  const reviewActivitySha256 = value.reviewActivitySha256 === null ? null : parseSha256Hex(value.reviewActivitySha256);
  const stance = OH_KNOWLEDGE_ASSERTION_STANCES_V1.find((candidate) => candidate === value.stance);
  const state = OH_KNOWLEDGE_ASSERTION_STATES_V1.find((candidate) => candidate === value.state);
  const statementSha256 = parseSha256Hex(value.statementSha256);
  if (acceptedPurposes === null || assertionId === null || assertor === null || value.confidence !== null && parsedConfidence === null || value.contextSha256 !== null && contextSha256 === null || provenanceActivitySha256 === null || value.reviewActivitySha256 !== null && reviewActivitySha256 === null || stance === undefined || state === undefined || statementSha256 === null)
    return null;
  if (assertor.kind === "model" && (state !== "proposed" || acceptedPurposes.length !== 0 || reviewActivitySha256 !== null))
    return null;
  if (state === "accepted-for-purpose" !== acceptedPurposes.length > 0 || state !== "proposed" && reviewActivitySha256 === null)
    return null;
  return {
    acceptedPurposes,
    assertionId,
    assertor,
    confidence: parsedConfidence,
    contextSha256,
    provenanceActivitySha256,
    reviewActivitySha256,
    stance,
    state,
    statementSha256,
    v: 1
  };
}
function createKnowledgeAssertionV1(input) {
  const parsed = parseAssertionInput(input);
  return parsed === null ? failure("assertion") : success({ ...parsed, assertionSha256: canonicalSha256(parsed) });
}
function parseKnowledgeAssertionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "assertionSha256"))
    return failure("assertion");
  const assertionSha256 = parseSha256Hex(value.assertionSha256);
  const { assertionSha256: _digest, ...input } = value;
  const parsed = parseAssertionInput(input);
  return assertionSha256 !== null && parsed !== null && canonicalSha256(parsed) === assertionSha256 ? success({ ...parsed, assertionSha256 }) : failure("assertionSha256", "digest-mismatch");
}
var OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1 = [
  "background",
  "contradicts",
  "corroborates",
  "direct-observation",
  "method",
  "quotation",
  "registry-record",
  "supports"
];
function parseEvidenceInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "assertionSha256",
    "bearing",
    "disclosure",
    "evidenceId",
    "observationSha256",
    "provenanceActivitySha256",
    "selector",
    "sourceEntityId",
    "v"
  ]) || value.v !== 1)
    return null;
  const assertionSha256 = parseSha256Hex(value.assertionSha256);
  const bearing = OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1.find((candidate) => candidate === value.bearing);
  const evidenceId = parseKnowledgeEvidenceId(value.evidenceId);
  const observationSha256 = value.observationSha256 === null ? null : parseSha256Hex(value.observationSha256);
  const provenanceActivitySha256 = parseSha256Hex(value.provenanceActivitySha256);
  const selector = value.selector === null ? null : boundedText(value.selector, 8192);
  const sourceEntityId = value.sourceEntityId === null ? null : parseKnowledgeEntityId(value.sourceEntityId);
  return assertionSha256 !== null && bearing !== undefined && (value.disclosure === "private" || value.disclosure === "public" || value.disclosure === "shared") && evidenceId !== null && (value.observationSha256 === null || observationSha256 !== null) && provenanceActivitySha256 !== null && (value.selector === null || selector !== null) && (value.sourceEntityId === null || sourceEntityId !== null) && (observationSha256 !== null || sourceEntityId !== null) ? {
    assertionSha256,
    bearing,
    disclosure: value.disclosure,
    evidenceId,
    observationSha256,
    provenanceActivitySha256,
    selector,
    sourceEntityId,
    v: 1
  } : null;
}
function createKnowledgeEvidenceLinkV1(input) {
  const parsed = parseEvidenceInput(input);
  return parsed === null ? failure("evidence") : success({ ...parsed, evidenceSha256: canonicalSha256(parsed) });
}
function parseKnowledgeEvidenceLinkV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "evidenceSha256"))
    return failure("evidence");
  const evidenceSha256 = parseSha256Hex(value.evidenceSha256);
  const { evidenceSha256: _digest, ...input } = value;
  const parsed = parseEvidenceInput(input);
  return evidenceSha256 !== null && parsed !== null && canonicalSha256(parsed) === evidenceSha256 ? success({ ...parsed, evidenceSha256 }) : failure("evidenceSha256", "digest-mismatch");
}
function createKnowledgeInquiryV1(input) {
  const answerForm = safeCode(input.answerForm);
  const authorEntityId = parseKnowledgeEntityId(input.authorEntityId);
  const contextSha256 = input.contextSha256 === null ? null : parseSha256Hex(input.contextSha256);
  const createdAt = parseCanonicalInstantV1(input.createdAt);
  const inquiryId = parseKnowledgeInquiryId(input.inquiryId);
  const language = typeof input.language === "string" && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(input.language) ? input.language : null;
  const parents = Array.isArray(input.parentInquiryIds) ? input.parentInquiryIds.map(parseKnowledgeInquiryId) : null;
  const question = boundedText(input.question, 16384);
  if (input.v !== 1 || answerForm === null || authorEntityId === null || input.contextSha256 !== null && contextSha256 === null || createdAt === null || inquiryId === null || language === null || parents === null || parents.some((item) => item === null) || !orderedUnique(parents, String) || !["private", "public", "shared"].includes(input.privacy) || question === null || !["abandoned", "open", "paused", "resolved"].includes(input.status))
    return failure("inquiry");
  const payload = {
    answerForm,
    authorEntityId,
    contextSha256,
    createdAt,
    inquiryId,
    language,
    parentInquiryIds: parents,
    privacy: input.privacy,
    question,
    status: input.status,
    v: 1
  };
  return success({ ...payload, inquirySha256: canonicalSha256(payload) });
}
function parseKnowledgeInquiryV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "inquirySha256"))
    return failure("inquiry");
  const digest = parseSha256Hex(value.inquirySha256);
  const { inquirySha256: _digest, ...input } = value;
  const created = createKnowledgeInquiryV1(input);
  return digest !== null && created.ok && created.value.inquirySha256 === digest ? success({ ...created.value, inquirySha256: digest }) : failure("inquirySha256", "digest-mismatch");
}

// src/schema.ts
var OH_SCHEMA_FORMAT_VERSION_V1 = 1;
var OH_SCHEMA_KINDS_V1 = ["concept", "mapping", "predicate", "shape", "unit", "vocabulary"];
function parseLocalizedTexts(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128)
    return null;
  const output = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["language", "text", "v"]) || item.v !== 1)
      return null;
    const language = typeof item.language === "string" && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(item.language) ? item.language : null;
    const text = boundedText(item.text, 16384);
    if (language === null || text === null)
      return null;
    output.push({ language, text, v: 1 });
  }
  return orderedUnique(output, canonicalJson) ? output : null;
}
function parseSchemaInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "body",
    "code",
    "compatibility",
    "description",
    "kind",
    "labels",
    "namespace",
    "previousSchemaSha256",
    "revision",
    "v"
  ]) || value.v !== 1 || !isPlainRecord(value.body))
    return null;
  try {
    canonicalJson(value.body);
  } catch {
    return null;
  }
  const code = safeCode(value.code);
  const namespace = safeCode(value.namespace);
  const kind = OH_SCHEMA_KINDS_V1.find((candidate) => candidate === value.kind);
  const labels = parseLocalizedTexts(value.labels);
  const description = parseLocalizedTexts(value.description);
  const previousSchemaSha256 = value.previousSchemaSha256 === null ? null : parseSha256Hex(value.previousSchemaSha256);
  const revision = Number.isSafeInteger(value.revision) && value.revision > 0 ? value.revision : null;
  const compatibility = value.compatibility === "additive" || value.compatibility === "breaking" ? value.compatibility : null;
  return code !== null && namespace !== null && kind !== undefined && labels !== null && description !== null && (value.previousSchemaSha256 === null || previousSchemaSha256 !== null) && revision !== null && compatibility !== null && revision === 1 === (previousSchemaSha256 === null) && (revision !== 1 || compatibility === "additive") ? {
    body: value.body,
    code,
    compatibility,
    description,
    kind,
    labels,
    namespace,
    previousSchemaSha256,
    revision,
    v: 1
  } : null;
}
function createKnowledgeSchemaRevisionV1(input) {
  const parsed = parseSchemaInput(input);
  if (parsed === null)
    throw new TypeError("Invalid schema revision input.");
  return { ...parsed, schemaSha256: canonicalSha256(parsed) };
}
function parseKnowledgeSchemaRevisionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "schemaSha256"))
    return null;
  const schemaSha256 = parseSha256Hex(value.schemaSha256);
  const { schemaSha256: _digest, ...input } = value;
  const parsed = parseSchemaInput(input);
  return schemaSha256 !== null && parsed !== null && canonicalSha256(parsed) === schemaSha256 ? { ...parsed, schemaSha256 } : null;
}
function knowledgeSchemaRefV1(schema) {
  return {
    code: schema.code,
    namespace: schema.namespace,
    revision: schema.revision,
    schemaSha256: schema.schemaSha256,
    v: 1
  };
}
function additiveBodyRetainsPrior(prior, next) {
  return Object.entries(prior).every(([key, value]) => Object.hasOwn(next, key) && canonicalJson(next[key]) === canonicalJson(value));
}
function verifyKnowledgeSchemaEvolutionV1(prior, next) {
  if (parseKnowledgeSchemaRevisionV1(prior) === null || parseKnowledgeSchemaRevisionV1(next) === null) {
    return { ok: false, reason: "invalid-schema" };
  }
  if (prior.namespace !== next.namespace || prior.code !== next.code || prior.kind !== next.kind) {
    return { ok: false, reason: "identity-changed" };
  }
  if (next.revision !== prior.revision + 1 || next.previousSchemaSha256 !== prior.schemaSha256) {
    return { ok: false, reason: "chain-broken" };
  }
  if (next.compatibility === "additive" && !additiveBodyRetainsPrior(prior.body, next.body)) {
    return { ok: false, reason: "false-additive-claim" };
  }
  return { ok: true };
}
function createKnowledgeVocabularyRevisionV1(input) {
  const namespace = safeCode(input.namespace);
  if (namespace === null || input.v !== 1 || !Number.isSafeInteger(input.revision) || input.revision < 1 || !Array.isArray(input.schemaRefs) || input.schemaRefs.length > 65536) {
    throw new TypeError("Invalid vocabulary revision input.");
  }
  const refs = [];
  for (const candidate of input.schemaRefs) {
    const parsed = parseKnowledgeSchemaRefV1(candidate);
    if (!parsed.ok || parsed.value.namespace !== namespace)
      throw new TypeError("Invalid vocabulary schema reference.");
    refs.push(parsed.value);
  }
  if (!orderedUnique(refs, canonicalJson))
    throw new TypeError("Vocabulary schema references must be ordered and unique.");
  const payload = { namespace, revision: input.revision, schemaRefs: refs, v: 1 };
  return { ...payload, vocabularySha256: canonicalSha256(payload) };
}
function parseKnowledgeVocabularyRevisionV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["namespace", "revision", "schemaRefs", "v", "vocabularySha256"]))
    return null;
  const digest = parseSha256Hex(value.vocabularySha256);
  try {
    const created = createKnowledgeVocabularyRevisionV1({
      namespace: value.namespace,
      revision: value.revision,
      schemaRefs: value.schemaRefs,
      v: value.v
    });
    return digest !== null && created.vocabularySha256 === digest ? { ...created, vocabularySha256: digest } : null;
  } catch {
    return null;
  }
}

// src/contract.ts
var manifestPayload = Object.freeze({
  contractId: OH_CONTRACT_ID_V1,
  graphFormatVersion: OH_GRAPH_FORMAT_VERSION_V1,
  ontologyVersion: OH_ONTOLOGY_VERSION_V1,
  recordKinds: OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  schemaFormatVersion: OH_SCHEMA_FORMAT_VERSION_V1,
  v: 1
});
var OH_CONTRACT_MANIFEST_V1 = Object.freeze({
  ...manifestPayload,
  contractSha256: canonicalSha256(manifestPayload)
});
function parseOhContractManifestV1(value) {
  try {
    return canonicalJson(value) === canonicalJson(OH_CONTRACT_MANIFEST_V1) ? OH_CONTRACT_MANIFEST_V1 : null;
  } catch {
    return null;
  }
}

class OhRecordCodecRegistry {
  #codecs = new Map;
  register(codec) {
    if (this.#codecs.has(codec.kind))
      throw new TypeError(`A codec is already registered for ${codec.kind}.`);
    this.#codecs.set(codec.kind, codec);
    return this;
  }
  parse(kind, value) {
    const codec = this.#codecs.get(kind);
    if (codec !== undefined)
      return codec.parse(value);
    try {
      canonicalJson(value);
      return value;
    } catch {
      return null;
    }
  }
  has(kind) {
    return this.#codecs.has(kind);
  }
}

// src/operation.ts
var OH_OPERATION_MAX_BYTES_V1 = 64 * 1024 * 1024;
function parsePayload(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "actorId",
    "changes",
    "contractId",
    "graphRevisionSha256",
    "instant",
    "operationId",
    "parentOperationSha256",
    "recordsSha256",
    "sequence",
    "spaceId",
    "v"
  ]) || value.v !== 1 || value.contractId !== OH_CONTRACT_ID_V1 || !Array.isArray(value.changes))
    return null;
  const actorId = safeCode(value.actorId);
  const operationId = safeCode(value.operationId);
  const spaceId = safeCode(value.spaceId);
  const graphRevisionSha256 = parseSha256Hex(value.graphRevisionSha256);
  const parentOperationSha256 = value.parentOperationSha256 === null ? null : parseSha256Hex(value.parentOperationSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const instant = parseCanonicalInstantV1(value.instant);
  const sequence = Number.isSafeInteger(value.sequence) && value.sequence > 0 ? value.sequence : null;
  let changes;
  try {
    changes = canonicalKnowledgeGraphChangesV1(value.changes);
  } catch {
    return null;
  }
  if (changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation)
    return null;
  return actorId !== null && operationId !== null && spaceId !== null && graphRevisionSha256 !== null && recordsSha256 !== null && instant !== null && sequence !== null && (value.parentOperationSha256 === null || parentOperationSha256 !== null) && sequence === 1 === (parentOperationSha256 === null) ? {
    actorId,
    changes,
    contractId: OH_CONTRACT_ID_V1,
    graphRevisionSha256,
    instant,
    operationId,
    parentOperationSha256,
    recordsSha256,
    sequence,
    spaceId,
    v: 1
  } : null;
}
function createOhOperationV1(input) {
  const payload = parsePayload(input);
  if (payload === null)
    throw new TypeError("Invalid Oh operation payload.");
  const operation = { ...payload, operationSha256: canonicalSha256(payload) };
  if (Buffer.byteLength(canonicalJson(operation), "utf8") > OH_OPERATION_MAX_BYTES_V1) {
    throw new RangeError("Oh operation exceeds its canonical byte limit.");
  }
  return operation;
}
function parseOhOperationV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "operationSha256"))
    return null;
  const operationSha256 = parseSha256Hex(value.operationSha256);
  const { operationSha256: _digest, ...input } = value;
  const payload = parsePayload(input);
  return operationSha256 !== null && payload !== null && Buffer.byteLength(canonicalJson({ ...payload, operationSha256 }), "utf8") <= OH_OPERATION_MAX_BYTES_V1 && canonicalSha256(payload) === operationSha256 ? { ...payload, operationSha256 } : null;
}

// src/sqlite/store.ts
var EMPTY_RECORDS_SHA256 = canonicalSha256([]);

class OhConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "OhConflictError";
  }
}

class OhIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "OhIntegrityError";
  }
}

class OhDependencyError extends Error {
  constructor(message) {
    super(message);
    this.name = "OhDependencyError";
  }
}
function parseHead(row) {
  const operationSha256 = row.head_operation_sha256 === null ? null : parseSha256Hex(row.head_operation_sha256);
  const graphRevisionSha256 = row.graph_revision_sha256 === null ? null : parseSha256Hex(row.graph_revision_sha256);
  const recordsSha256 = parseSha256Hex(row.records_sha256);
  if (row.head_operation_sha256 !== null && operationSha256 === null || row.graph_revision_sha256 !== null && graphRevisionSha256 === null || recordsSha256 === null) {
    throw new OhIntegrityError("The stored space head contains an invalid digest.");
  }
  return {
    generation: row.generation,
    graphRevisionSha256,
    operationSha256,
    recordsSha256,
    sequence: row.sequence,
    v: 1
  };
}
function extractSearchText(value, maximumBytes = 1024 * 1024) {
  const parts = [];
  let bytes = 0;
  const visit = (candidate, depth) => {
    if (depth > 32 || bytes >= maximumBytes)
      return;
    if (typeof candidate === "string") {
      const remaining = maximumBytes - bytes;
      const text = Buffer.from(candidate, "utf8").subarray(0, remaining).toString("utf8");
      if (text.length > 0) {
        parts.push(text);
        bytes += Buffer.byteLength(text, "utf8") + 1;
      }
    } else if (typeof candidate === "number" || typeof candidate === "boolean") {
      const text = String(candidate);
      parts.push(text);
      bytes += text.length + 1;
    } else if (Array.isArray(candidate)) {
      for (const item of candidate)
        visit(item, depth + 1);
    } else if (candidate !== null) {
      for (const [key, item] of Object.entries(candidate)) {
        parts.push(key);
        bytes += key.length + 1;
        visit(item, depth + 1);
      }
    }
  };
  visit(value, 0);
  return parts.join(" ").normalize("NFC");
}
function normalizeLimit(value, fallback = 50, maximum = 1000) {
  if (value === undefined)
    return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`limit must be an integer from 1 through ${maximum}.`);
  }
  return value;
}
function ftsQuery(value) {
  const normalized = boundedText(value.normalize("NFC"), 4096);
  if (normalized === null)
    return null;
  const tokens = normalized.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}/gu)?.slice(0, 16) ?? [];
  return tokens.length === 0 ? null : tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

class OhSqliteStore {
  database;
  spaceId;
  #closed = false;
  constructor(options = {}) {
    const spaceId = safeCode(options.spaceId ?? "default");
    if (spaceId === null)
      throw new TypeError("Invalid space ID.");
    if (options.database !== undefined && options.path !== undefined) {
      throw new TypeError("Pass either a database or a path, not both.");
    }
    const path = options.path ?? "oh.sqlite";
    if (options.database === undefined && path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true });
    this.database = options.database ?? openOhSqliteDatabase(path);
    this.spaceId = spaceId;
    applyOhSqliteMigrations(this.database);
    this.#registerContract();
    this.ensureSpace();
  }
  #assertOpen() {
    if (this.#closed)
      throw new Error("The Oh store is closed.");
  }
  #registerContract() {
    const manifestJson = canonicalJson(OH_CONTRACT_MANIFEST_V1);
    this.database.query(`INSERT INTO oh_contracts(contract_id, contract_sha256, manifest_json, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(contract_id) DO NOTHING`).run(OH_CONTRACT_ID_V1, OH_CONTRACT_MANIFEST_V1.contractSha256, manifestJson, canonicalNow());
    const existing = this.database.query("SELECT contract_sha256, manifest_json FROM oh_contracts WHERE contract_id = ?").get(OH_CONTRACT_ID_V1);
    if (existing === null || existing.contract_sha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256 || existing.manifest_json !== manifestJson) {
      throw new OhIntegrityError("The stored contract manifest differs from this runtime.");
    }
  }
  ensureSpace() {
    this.#assertOpen();
    const now = canonicalNow();
    this.database.query(`INSERT INTO oh_spaces(
      space_id, contract_id, generation, head_operation_sha256, graph_revision_sha256,
      records_sha256, sequence, created_at, updated_at
    ) VALUES (?, ?, 0, NULL, NULL, ?, 0, ?, ?) ON CONFLICT(space_id) DO NOTHING`).run(this.spaceId, OH_CONTRACT_ID_V1, EMPTY_RECORDS_SHA256, now, now);
    return this.head();
  }
  head() {
    this.#assertOpen();
    const row = this.database.query(`SELECT generation, graph_revision_sha256,
      head_operation_sha256, records_sha256, sequence FROM oh_spaces WHERE space_id = ?`).get(this.spaceId);
    if (row === null)
      throw new OhIntegrityError("The requested space does not exist.");
    return parseHead(row);
  }
  #loadRecords() {
    const rows = this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? ORDER BY record_key").all(this.spaceId);
    const records = new Map;
    for (const row of rows) {
      let value;
      try {
        value = JSON.parse(row.record_json);
      } catch {
        throw new OhIntegrityError("A stored record is not JSON.");
      }
      if (canonicalJson(value) !== row.record_json)
        throw new OhIntegrityError("A stored record is not canonical JSON.");
      const record = parseKnowledgeGraphRecordV1(value);
      if (record === null || records.has(record.key))
        throw new OhIntegrityError("A stored graph record is invalid.");
      records.set(record.key, record);
    }
    return records;
  }
  #transition(head, changes, operationId) {
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
        if (!records.has(dependency))
          throw new OhDependencyError(`Missing dependency ${dependency} for ${record.key}.`);
      }
    }
    const refs = [...records.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(knowledgeGraphRecordRefV1);
    const recordsSha256 = canonicalSha256(refs);
    const graphRevisionSha256 = graphRevisionSha256V1({
      changes,
      operationId,
      parentGraphRevisionSha256: head.graphRevisionSha256,
      recordsSha256,
      revision: head.sequence + 1
    });
    return { graphRevisionSha256, records, recordsSha256 };
  }
  #persist(operation) {
    this.database.query(`INSERT INTO oh_operations(operation_sha256, space_id, sequence,
      operation_id, parent_operation_sha256, graph_revision_sha256, records_sha256,
      operation_json, instant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(operation.operationSha256, this.spaceId, operation.sequence, operation.operationId, operation.parentOperationSha256, operation.graphRevisionSha256, operation.recordsSha256, canonicalJson(operation), operation.instant);
    const changedKeys = operation.changes.map((change) => change.kind === "put" ? change.record.key : change.key);
    const deleteDependencies = this.database.query("DELETE FROM oh_dependencies WHERE space_id = ? AND record_key = ?");
    for (const key of changedKeys)
      deleteDependencies.run(this.spaceId, key);
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
        upsertRecord.run(this.spaceId, key, change.record.kind, change.record.recordSha256, recordJson, operation.operationSha256, operation.sequence);
        const text = `${key} ${change.record.kind} ${extractSearchText(change.record.value)}`;
        upsertSearch.run(this.spaceId, key, change.record.recordSha256, text);
        insertFts.run(this.spaceId, key, text);
      } else
        deleteRecord.run(this.spaceId, key);
    }
    const insertDependency = this.database.query("INSERT INTO oh_dependencies(space_id, record_key, dependency_key) VALUES (?, ?, ?)");
    for (const change of operation.changes) {
      if (change.kind === "put") {
        for (const dependency of change.record.dependencies)
          insertDependency.run(this.spaceId, change.record.key, dependency);
      }
    }
    this.database.query("INSERT INTO oh_sync_outbox(space_id, sequence, operation_sha256) VALUES (?, ?, ?)").run(this.spaceId, operation.sequence, operation.operationSha256);
    const updated = this.database.query(`UPDATE oh_spaces SET generation = ?, head_operation_sha256 = ?,
      graph_revision_sha256 = ?, records_sha256 = ?, sequence = ?, updated_at = ?
      WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ?`).run(operation.sequence, operation.operationSha256, operation.graphRevisionSha256, operation.recordsSha256, operation.sequence, operation.instant, this.spaceId, operation.sequence - 1, operation.parentOperationSha256);
    if (updated.changes !== 1)
      throw new OhConflictError("The space head changed while committing.");
  }
  commit(input) {
    this.#assertOpen();
    const actorId = safeCode(input.actorId);
    const operationId = safeCode(input.operationId);
    if (actorId === null || operationId === null)
      throw new TypeError("Invalid actor or operation ID.");
    const changes = canonicalKnowledgeGraphChangesV1(input.changes);
    if (changes.length === 0 || changes.length > 8192)
      throw new TypeError("A commit needs 1 through 8192 changes.");
    return withImmediateTransaction(this.database, () => {
      const duplicate = this.database.query("SELECT operation_json FROM oh_operations WHERE space_id = ? AND operation_id = ?").get(this.spaceId, operationId);
      if (duplicate !== null) {
        const existing = parseOhOperationV1(JSON.parse(duplicate.operation_json));
        if (existing === null)
          throw new OhIntegrityError("The stored idempotent operation is invalid.");
        if (existing.actorId !== actorId || canonicalJson(existing.changes) !== canonicalJson(changes)) {
          throw new OhConflictError("The operation ID is already bound to different content.");
        }
        return existing;
      }
      const head = this.head();
      if (head.generation !== input.expectedHead.generation || head.operationSha256 !== input.expectedHead.operationSha256) {
        throw new OhConflictError("The expected head does not match the current space head.");
      }
      const transition = this.#transition(head, changes, operationId);
      const operation = createOhOperationV1({
        actorId,
        changes,
        contractId: OH_CONTRACT_ID_V1,
        graphRevisionSha256: transition.graphRevisionSha256,
        instant: input.instant ?? canonicalNow(),
        operationId,
        parentOperationSha256: head.operationSha256,
        recordsSha256: transition.recordsSha256,
        sequence: head.sequence + 1,
        spaceId: this.spaceId,
        v: 1
      });
      this.#persist(operation);
      return operation;
    });
  }
  importOperation(value) {
    this.#assertOpen();
    const operation = parseOhOperationV1(value);
    if (operation === null || operation.spaceId !== this.spaceId)
      throw new OhIntegrityError("Invalid imported operation.");
    return withImmediateTransaction(this.database, () => {
      const duplicate = this.database.query("SELECT operation_json FROM oh_operations WHERE operation_sha256 = ?").get(operation.operationSha256);
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
      if (transition.recordsSha256 !== operation.recordsSha256 || transition.graphRevisionSha256 !== operation.graphRevisionSha256) {
        throw new OhIntegrityError("The imported operation does not reproduce its declared graph head.");
      }
      this.#persist(operation);
      return { imported: true, operation };
    });
  }
  exportOperations(afterSequence = 0, limit = 1000) {
    this.#assertOpen();
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0)
      throw new RangeError("afterSequence must be nonnegative.");
    const boundedLimit = normalizeLimit(limit);
    const rows = this.database.query("SELECT operation_json FROM oh_operations WHERE space_id = ? AND sequence > ? ORDER BY sequence LIMIT ?").all(this.spaceId, afterSequence, boundedLimit);
    return rows.map((row) => {
      const operation = parseOhOperationV1(JSON.parse(row.operation_json));
      if (operation === null || canonicalJson(operation) !== row.operation_json)
        throw new OhIntegrityError("A stored operation is invalid.");
      return operation;
    });
  }
  get(key) {
    this.#assertOpen();
    const parsedKey = safeCode(key, 512);
    if (parsedKey === null)
      throw new TypeError("Invalid record key.");
    const row = this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? AND record_key = ?").get(this.spaceId, parsedKey);
    if (row === null)
      return null;
    const record = parseKnowledgeGraphRecordV1(JSON.parse(row.record_json));
    if (record === null || canonicalJson(record) !== row.record_json)
      throw new OhIntegrityError("The stored record is invalid.");
    return record;
  }
  list(options = {}) {
    this.#assertOpen();
    const limit = normalizeLimit(options.limit);
    const rows = options.kind === undefined ? this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? ORDER BY record_key LIMIT ?").all(this.spaceId, limit) : this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? AND kind = ? ORDER BY record_key LIMIT ?").all(this.spaceId, options.kind, limit);
    return rows.map((row) => {
      const record = parseKnowledgeGraphRecordV1(JSON.parse(row.record_json));
      if (record === null || canonicalJson(record) !== row.record_json) {
        throw new OhIntegrityError("The stored record is invalid.");
      }
      return record;
    });
  }
  snapshotRecords(maximum = OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    this.#assertOpen();
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
      throw new RangeError(`maximum must be an integer from 1 through ${OH_GRAPH_LIMITS_V1.recordsPerSnapshot}.`);
    }
    const count = this.database.query("SELECT count(*) AS count FROM oh_records WHERE space_id = ?").get(this.spaceId)?.count ?? 0;
    if (count > maximum)
      throw new RangeError(`The graph contains ${count} records, above the requested snapshot bound.`);
    return this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? ORDER BY record_key").all(this.spaceId).map((row) => {
      const record = parseKnowledgeGraphRecordV1(JSON.parse(row.record_json));
      if (record === null || canonicalJson(record) !== row.record_json) {
        throw new OhIntegrityError("The stored record is invalid.");
      }
      return record;
    });
  }
  log(limit = 50) {
    this.#assertOpen();
    const rows = this.database.query("SELECT operation_json FROM oh_operations WHERE space_id = ? ORDER BY sequence DESC LIMIT ?").all(this.spaceId, normalizeLimit(limit));
    return rows.map((row) => {
      const operation = parseOhOperationV1(JSON.parse(row.operation_json));
      if (operation === null)
        throw new OhIntegrityError("The stored operation is invalid.");
      return operation;
    });
  }
  searchKeyword(query, limit = 20) {
    this.#assertOpen();
    const match = ftsQuery(query);
    if (match === null)
      return [];
    const rows = this.database.query(`SELECT r.record_key,
      r.kind, r.record_sha256, bm25(oh_search_fts) AS rank,
      snippet(oh_search_fts, 2, '', '', ' \u2026 ', 24) AS snippet
      FROM oh_search_fts JOIN oh_records r
      ON r.space_id = oh_search_fts.space_id AND r.record_key = oh_search_fts.record_key
      WHERE oh_search_fts MATCH ? AND oh_search_fts.space_id = ?
      ORDER BY rank, r.record_key LIMIT ?`).all(match, this.spaceId, normalizeLimit(limit, 20, 100));
    return rows.map((row) => {
      const digest = parseSha256Hex(row.record_sha256);
      if (digest === null)
        throw new OhIntegrityError("Search returned an invalid record digest.");
      return {
        key: row.record_key,
        kind: row.kind,
        recordSha256: digest,
        score: 1 / (1 + Math.max(0, row.rank)),
        snippet: row.snippet,
        v: 1
      };
    });
  }
  syncState(remoteId) {
    this.#assertOpen();
    const id = safeCode(remoteId);
    if (id === null)
      throw new TypeError("Invalid remote ID.");
    const row = this.database.query("SELECT pulled_sequence, pushed_sequence, remote_head_sha256 FROM oh_sync_state WHERE remote_id = ? AND space_id = ?").get(id, this.spaceId);
    const digest = row?.remote_head_sha256 === null || row === null ? null : parseSha256Hex(row.remote_head_sha256);
    if (row !== null && row.remote_head_sha256 !== null && digest === null)
      throw new OhIntegrityError("Invalid remote head digest.");
    return { pulledSequence: row?.pulled_sequence ?? 0, pushedSequence: row?.pushed_sequence ?? 0, remoteHeadSha256: digest };
  }
  updateSyncState(remoteId, state) {
    this.#assertOpen();
    const id = safeCode(remoteId);
    if (id === null || !Number.isSafeInteger(state.pulledSequence) || state.pulledSequence < 0 || !Number.isSafeInteger(state.pushedSequence) || state.pushedSequence < 0)
      throw new TypeError("Invalid sync state.");
    this.database.query(`INSERT INTO oh_sync_state(remote_id, space_id, pulled_sequence,
      pushed_sequence, remote_head_sha256, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(remote_id, space_id) DO UPDATE SET pulled_sequence = excluded.pulled_sequence,
      pushed_sequence = excluded.pushed_sequence, remote_head_sha256 = excluded.remote_head_sha256,
      updated_at = excluded.updated_at`).run(id, this.spaceId, state.pulledSequence, state.pushedSequence, state.remoteHeadSha256, canonicalNow());
  }
  verifyReplay() {
    this.#assertOpen();
    const integrity = this.database.query("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok")
      throw new OhIntegrityError("SQLite integrity_check failed.");
    const storedCount = this.database.query("SELECT count(*) AS count FROM oh_operations WHERE space_id = ?").get(this.spaceId)?.count ?? 0;
    const operations = storedCount <= 1000 ? this.exportOperations(0, 1000) : this.database.query("SELECT operation_json FROM oh_operations WHERE space_id = ? ORDER BY sequence").all(this.spaceId).map((row) => {
      let value;
      try {
        value = JSON.parse(row.operation_json);
      } catch {
        throw new OhIntegrityError("A stored operation is not JSON.");
      }
      if (canonicalJson(value) !== row.operation_json)
        throw new OhIntegrityError("A stored operation is not canonical JSON.");
      const parsed = parseOhOperationV1(value);
      if (parsed === null)
        throw new OhIntegrityError("A stored operation is invalid.");
      return parsed;
    });
    return this.#verifyOperations(operations);
  }
  #verifyOperations(operations) {
    const records = new Map;
    const materializedBy = new Map;
    let head = {
      generation: 0,
      graphRevisionSha256: null,
      operationSha256: null,
      recordsSha256: EMPTY_RECORDS_SHA256,
      sequence: 0,
      v: 1
    };
    for (const operation of operations) {
      if (operation.spaceId !== this.spaceId || operation.sequence !== head.sequence + 1 || operation.parentOperationSha256 !== head.operationSha256)
        throw new OhIntegrityError("Operation replay chain is broken.");
      for (const change of operation.changes) {
        if (change.kind === "put") {
          records.set(change.record.key, change.record);
          materializedBy.set(change.record.key, {
            operationSha256: operation.operationSha256,
            sequence: operation.sequence
          });
        } else {
          const prior = records.get(change.key);
          if (prior?.recordSha256 !== change.priorSha256)
            throw new OhIntegrityError("Replay tombstone does not match its prior record.");
          records.delete(change.key);
          materializedBy.delete(change.key);
        }
      }
      for (const record of records.values()) {
        if (record.dependencies.some((dependency) => !records.has(dependency)))
          throw new OhIntegrityError("Replay has a missing dependency.");
      }
      const refs = [...records.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(knowledgeGraphRecordRefV1);
      const recordsSha256 = canonicalSha256(refs);
      const graphRevisionSha256 = graphRevisionSha256V1({
        changes: operation.changes,
        operationId: operation.operationId,
        parentGraphRevisionSha256: head.graphRevisionSha256,
        recordsSha256,
        revision: operation.sequence
      });
      if (recordsSha256 !== operation.recordsSha256 || graphRevisionSha256 !== operation.graphRevisionSha256) {
        throw new OhIntegrityError("Replay does not reproduce an operation head.");
      }
      head = {
        generation: operation.sequence,
        graphRevisionSha256,
        operationSha256: operation.operationSha256,
        recordsSha256,
        sequence: operation.sequence,
        v: 1
      };
    }
    const storedRows = this.database.query(`SELECT record_key, kind, record_sha256, record_json, operation_sha256, sequence
       FROM oh_records WHERE space_id = ? ORDER BY record_key`).all(this.spaceId);
    if (storedRows.length !== records.size || storedRows.some((row) => {
      const record = records.get(row.record_key);
      const provenance = materializedBy.get(row.record_key);
      return record === undefined || record.kind !== row.kind || record.recordSha256 !== row.record_sha256 || canonicalJson(record) !== row.record_json || provenance === undefined || provenance.operationSha256 !== row.operation_sha256 || provenance.sequence !== row.sequence;
    }))
      throw new OhIntegrityError("Materialized records do not match operation replay.");
    const storedDependencies = this.database.query(`SELECT record_key, dependency_key FROM oh_dependencies
      WHERE space_id = ? ORDER BY record_key, dependency_key`).all(this.spaceId);
    const expectedDependencies = [...records.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).flatMap((record) => record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })));
    if (canonicalJson(storedDependencies) !== canonicalJson(expectedDependencies)) {
      throw new OhIntegrityError("Materialized dependencies do not match operation replay.");
    }
    const storedOperationRecords = this.database.query(`SELECT materialized.operation_sha256, materialized.ordinal, materialized.record_key,
        materialized.change_kind, materialized.record_sha256
      FROM oh_operation_records AS materialized
      JOIN oh_operations AS operation ON operation.operation_sha256 = materialized.operation_sha256
      WHERE operation.space_id = ? ORDER BY operation.sequence, materialized.ordinal`).all(this.spaceId);
    const expectedOperationRecords = operations.flatMap((operation) => operation.changes.map((change, ordinal) => ({
      change_kind: change.kind,
      operation_sha256: operation.operationSha256,
      ordinal,
      record_key: change.kind === "put" ? change.record.key : change.key,
      record_sha256: change.kind === "put" ? change.record.recordSha256 : change.priorSha256
    })));
    if (canonicalJson(storedOperationRecords) !== canonicalJson(expectedOperationRecords)) {
      throw new OhIntegrityError("Materialized operation records do not match operation replay.");
    }
    if (canonicalJson(head) !== canonicalJson(this.head()))
      throw new OhIntegrityError("The stored head does not match operation replay.");
    return { head, operations: operations.length, records: records.size, sqliteIntegrity: "ok", v: 1 };
  }
  contract() {
    return { manifest: OH_CONTRACT_MANIFEST_V1, sqliteSchemaVersion: OH_SQLITE_SCHEMA_VERSION };
  }
  close() {
    if (this.#closed)
      return;
    this.database.close(false);
    this.#closed = true;
  }
}
export {
  withImmediateTransaction,
  openOhSqliteDatabase,
  applyOhSqliteMigrations,
  OhSqliteStore,
  OhIntegrityError,
  OhDependencyError,
  OhConflictError,
  OH_SQLITE_SCHEMA_VERSION,
  OH_SQLITE_MIGRATIONS
};
