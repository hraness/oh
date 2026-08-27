# SQLite storage V1

SQLite schema version `1` is the local authority for an Oh space. The default
CLI database is `.oh/oh.sqlite`; callers may select another path or use an
in-memory database.

## Connection policy

The Bun SQLite driver opens in strict mode and applies:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA trusted_schema = OFF;
```

Each migration and committed operation runs inside `BEGIN IMMEDIATE`. Failure
rolls back the transaction and preserves the original error.

## Tables

| Table | Role |
| --- | --- |
| `oh_migrations` | Applied migration version, immutable name, SQL digest, and timestamp. |
| `oh_contracts` | Exact contract manifest and digest accepted by the store. |
| `oh_spaces` | Current compare-and-swap head for each logical space. |
| `oh_operations` | Append-only canonical operation chain. |
| `oh_operation_records` | Ordered record changes for each operation. |
| `oh_records` | Current canonical record materialization. |
| `oh_dependencies` | Current explicit dependency edges. |
| `oh_sync_outbox` | Local operations eligible for sync. |
| `oh_sync_state` | Last settled state for a named remote. |
| `oh_search_documents` | Derived keyword text bound to a record digest. |
| `oh_search_fts` | Derived FTS5 index. |

The first migration is named `0001_oh_core`. An implementation MUST store and
check the exact SHA-256 digest of applied migration SQL. It MUST refuse to run
when the same migration version or name has different bytes.

## Authority and derivation

`oh_operations`, `oh_spaces`, and the canonical current records define state.
The dependency and operation-record tables are checked materializations. Search
documents, FTS rows, and the separate QMD cache are derived and rebuildable.

Deleting an embedding or FTS index MUST NOT delete authored records or
operations. A search result MUST be rejoined to a current record and digest
before it is returned as current.

## Replay verification

`oh verify` runs SQLite `integrity_check`, parses every canonical operation,
replays the operation chain from an empty graph, recomputes record-set and graph
revision digests, checks dependencies, compares the materialized records, and
requires the reconstructed head to equal the stored head.

Backup and restore procedures SHOULD preserve the database and WAL atomically.
An application SHOULD run replay verification after an untrusted transfer or
restore before treating the space as authoritative.
