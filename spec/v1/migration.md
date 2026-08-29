# Compatibility and migration V1

This document defines the supported migration path for one conforming Oh V1
space to another storage location or Oh installation. Source and target MUST
use contract `oh.ontology.v1` with contract digest
`e53ae573c2af417082be9f554d0f6f3e317f054daf745181f462608e3f622594` and
the same space ID.

V1 does not ship a cross-contract transformer. A different contract digest,
protocol identifier, or space ID fails closed before an operation is applied.

## Preserved authority

The append-only operation chain is the migration unit. Every imported operation
MUST retain its canonical fields, record envelopes, logical keys, dependencies,
sequence, parent digest, record-set digest, graph-revision digest, and operation
digest. A migration MUST NOT rename identifiers, rewrite record values, replace
timestamps, recompute operations under a different contract, or reconstruct the
chain from current-row snapshots.

SQLite current-record and dependency tables are checked materializations of the
operation chain. Search documents, FTS5 rows, and the QMD semantic directory are
derived state and are not migration authority.

## Offline migration

Use the shipped CLI to move a space:

1. Stop or coordinate writers to keep the source head stable during export.
2. Run `oh contract` and confirm its printed contract ID and digest match the
   required values above. Then run `oh verify --db <source> --space <space>`
   against the source database and space.
3. Initialize an empty target with the same space ID.
4. Export operations in ascending sequence with
   `oh sync export --after <sequence> --limit <count>`. The limit MUST be from
   1 through 1,000. Begin after sequence `0` and continue from the last exported
   sequence until the bundle is empty.
5. Transfer each complete JSON bundle without changing its parsed content.
6. Import the bundles in order with `oh sync import --file <path>`. Import
   verifies the protocol, contract digest, bundle digest, space ID, operation
   digests, contiguous sequence, parent head, and reproduced graph head.
7. Run `oh verify` against the target.
8. Compare the source and target `head` objects returned by `oh verify`. The
   `generation`, `sequence`, `operationSha256`, `graphRevisionSha256`, and
   `recordsSha256` values MUST match exactly before the target becomes
   authoritative.

Re-importing an operation already present with the same digest and canonical
content is idempotent. An operation that does not extend the target head is a
conflict. Equal sequence numbers with different operation digests are also a
conflict. Oh does not merge divergent histories automatically.

## Connected migration

`synchronizeOhStoreV1` provides the same fast-forward rule through an
`OhOperationSyncTransportV1`. The transport handshake compares the complete V1
contract manifest before exchanging operations. Settlement succeeds only when
both heads have the same sequence and operation digest. Applications own
transport credentials, availability, retries, backups, and any explicit merge
policy.

## Search state

Keyword search remains available from the SQLite store after operation import.
Semantic state MAY be rebuilt with the exact profile in
[`embedding-profile.json`](embedding-profile.json). A semantic result is current
only after it rejoins a record with the same record digest. Copying a semantic
directory does not establish migration parity.

## Rollback

Keep the verified source database read-only until the target head has matched
and the application has accepted the cutover. If the target fails verification
or serving checks, restore routing to that unchanged source. Do not make
rollback depend on reversing a content or identifier rewrite.

SQLite schema migrations are separate from space transfer. The store records
each applied migration name and SQL digest in `oh_migrations` and refuses to
open when an applied version has different migration bytes.

SQLite schema version 2 appends `0002_store_realms` without changing the
released `0001_oh_core` SQL. Existing spaces remain unbound after upgrade. A
host may bind one through the promise-based store authority; once persisted,
the exact realm and profile bytes cannot be replaced. A purged working space
cannot be used as a migration source or recreated under the same identifier.

The direct libSQL authority has its own `oh_authority_` schema digest. It emits
the same V1 record and operation bytes, but it is not a destination for the
offline CLI import procedure above. Applications moving authority between
adapters MUST prove an exact complete operation chain and matching head through
a separately reviewed migration workflow. A dependency-closure capsule is a
selective content export for adoption, not proof of full authority migration.
