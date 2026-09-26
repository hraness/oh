# SQLite storage V1

A SQLite database with schema version `2` is the local authoritative store for
an Oh space. The CLI’s default database is `.oh/oh.sqlite`. Callers can select
another path or use an in-memory database.

## Connection policy

Oh opens the database with the Bun SQLite driver in strict mode and applies
these pragmas:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA trusted_schema = OFF;
```

Each migration and each committed operation runs inside `BEGIN IMMEDIATE`. On
failure, Oh rolls back the transaction and rethrows the original error.

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
| `oh_sync_state` | Sequences and remote head recorded by the last completed sync with a named remote. |
| `oh_search_documents` | Derived keyword text tied to a record digest. |
| `oh_search_fts` | Derived FTS5 index. |
| `oh_space_bindings` | Host-selected realm, lifecycle profile, capabilities, and application-profile digest for a supported store port. |
| `oh_space_purges` | Content-free purge receipt that permanently reserves the identifier of a purged working space. |

The first migration, `0001_oh_core`, is frozen at its released bytes. Schema
version 2 adds `0002_store_realms`. An implementation MUST store and check the
exact SHA-256 digest of applied migration SQL. It MUST refuse to run when the
same migration version or name has different bytes.

## Realm profiles and purge

A promise-based store port MAY bind one space to one host-selected realm and
profile. The binding includes the exact Oh contract digest, an optional
application-profile digest, and declared capabilities. A supported runtime
MUST reject a later attempt to open the same space under different binding
bytes. A working profile disables operation replication and allows
whole-space purge, which only the host can perform. The purge API cannot purge
a space with a canonical profile. For a canonical space, the local SQLite
store can instead give the host a replication handle. The promise-based store
that an agent receives never has that handle.

Purge deletes the space head, the complete operation history, current records,
dependency and operation materializations, sync state, and derived keyword
rows in one immediate transaction. It leaves only a purge receipt
(`OhSpacePurgeReceiptV1`), a content-free record of the space ID, prior head,
binding digest, purge instant, and receipt digest. Opening the purged space
identifier again in the same database fails with `OhPurgedSpaceError`. A host
that deletes an entire database file MUST retain any required deletion
evidence in its own control plane.

The realm and profile binding is local store metadata. V1 operation digest
preimages do not contain it. The binding therefore protects opens and
operations through a supported runtime, and it makes no portable cryptographic
claim about a V1 history. Such a claim requires a new wire contract. It cannot
come from a change to V1 operation bytes.

## Authoritative and derived state

`oh_operations`, `oh_spaces`, and the canonical current records define state.
The dependency and operation-record tables are materializations that replay
verification checks. Search documents, FTS rows, and the separate QMD cache
are derived and rebuildable.

Deleting an embedding or FTS index MUST NOT delete authored records or
operations. A search result MUST be rejoined to a current record and digest
before it is returned as current.

## Replay verification

`oh verify` runs SQLite `integrity_check` and `foreign_key_check` and parses
every canonical operation. It replays the operation chain from an empty graph,
recomputes record-set and graph revision digests, and checks dependencies. It
then compares the materialized records, dependency rows, operation-record rows,
search documents, and FTS rows with the replay, and requires the reconstructed
head to equal the stored head.

Backup and restore procedures SHOULD preserve the database and WAL atomically.
An application SHOULD run replay verification after an untrusted transfer or
restore before treating the space as authoritative.
