# SQLite storage V1

SQLite schema version `2` is the local authority for an Oh space. The default
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
| `oh_space_bindings` | Host-selected realm, lifecycle profile, capabilities, and application-profile digest for a supported store port. |
| `oh_space_purges` | Minimal receipt that permanently reserves the identifier of a purged working space. |

The first migration is named `0001_oh_core`; its released bytes remain
unchanged. Schema version 2 adds `0002_store_realms`. An implementation MUST
store and check the exact SHA-256 digest of applied migration SQL. It MUST
refuse to run when the same migration version or name has different bytes.

## Realm profiles and purge

A promise-based store port MAY bind one space to one host-selected realm and
profile. The binding includes the exact Oh contract digest, an optional
application-profile digest, and declared capabilities. A supported runtime
MUST reject a later attempt to open the same space under different binding
bytes. A working profile disables operation replication and enables only
host-controlled whole-space purge. A canonical profile cannot be purged by
that API.

Purge deletes the space head, complete operation history, current records,
dependency and operation materializations, sync state, and derived keyword
rows in one immediate transaction. It leaves only a content-free receipt with
the prior head, binding digest, purge instant, and receipt digest. The purged
space identifier cannot be reopened in the same database. A host that deletes
an entire database file MUST retain any required deletion evidence in its own
control plane.

Realm and profile binding is additive store control metadata. V1 operation
digest preimages do not contain the binding. It therefore protects supported
opens and operations but is not a portable cryptographic claim about a V1
history. Such a claim requires a new wire contract rather than a change to V1
operation bytes.

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
