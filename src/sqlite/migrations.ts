import { canonicalNow, sha256Hex } from "../canonical";
import type { OhSqliteDatabase } from "./driver";

export const OH_SQLITE_SCHEMA_VERSION = 1 as const;

export type OhSqliteMigration = Readonly<{ name: string; sql: string; version: number }>;

export const OH_SQLITE_MIGRATIONS: readonly OhSqliteMigration[] = Object.freeze([
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
`,
  }),
]);

export function applyOhSqliteMigrations(database: OhSqliteDatabase): void {
  database.exec(`CREATE TABLE IF NOT EXISTS oh_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    migration_sha256 TEXT NOT NULL CHECK(length(migration_sha256) = 64),
    applied_at TEXT NOT NULL
  ) STRICT`);
  const select = database.query<{ migration_sha256: string; name: string }, [number]>(
    "SELECT name, migration_sha256 FROM oh_migrations WHERE version = ?",
  );
  const insert = database.query(
    "INSERT INTO oh_migrations(version, name, migration_sha256, applied_at) VALUES (?, ?, ?, ?)",
  );
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
      try { database.exec("ROLLBACK"); } catch { /* preserve the migration error */ }
      throw error;
    }
  }
}
