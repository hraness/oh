# Store ports, profiles, and direct libSQL authority

The graph and operation contract remains V1. This document defines additive
host APIs that preserve those bytes across local SQLite and direct libSQL
authorities.

## Promise-based store port

`@hraness/oh/store` has no dependency on `bun:sqlite`. Its methods return
promises and expose:

- the current exact head;
- a current or historical snapshot at an exact sequence and operation digest;
- a bounded contiguous change page through a pinned head;
- compare-and-swap commit;
- dependency-closure export;
- replay and materialization verification; and
- close.

A historical read MUST fail if its sequence is absent or identifies a
different operation digest. A change page MUST name its source cursor, pinned
through-head, returned cursor, and whether more operations remain.

A commit may declare `maximumOperationBytes`. The built-in SQLite and direct
libSQL authorities measure the exact canonical operation before persistence,
including on an exact operation-ID replay. Exceeding the host-declared bound
throws `OhOperationSizeError`, a `RangeError` subtype carrying
`operationBytes` and `maximumOperationBytes`; it never indicates an ambiguous
post-effect failure. Its public `code` is `oh.operation-size.v1`, and
`instanceof OhOperationSizeError` remains stable across separately bundled Oh
entrypoints. Callers validating an unknown caught value may instead use
`isOhOperationSizeError`; the guard requires a native error with immutable
branded numeric fields, so copying the public fields onto a plain object is not
sufficient.

The core `OhConflictError`, `OhIntegrityError`, `OhDependencyError`, and
`OhProfileError` classes likewise preserve `instanceof` identity across
separately bundled Oh entrypoints. Their corresponding `isOhConflictError`,
`isOhIntegrityError`, `isOhDependencyError`, and `isOhProfileError` guards
require a native error with the immutable brand for that exact error family.
A branded base class remains visible through an ordinary subclass, but a base
instance MUST NOT satisfy an arbitrary subclass check.

## Record revision reads

The operation log already records every change to every record key: each
committed operation lists its puts and tombstones, and a key can appear at most
once in one operation. A reader can therefore ask how often a stored record was
written without keeping a separate counter.

`reduceOhRecordRevisionsV1` turns a bounded set of one key's log changes into
counts: how many puts and tombstones touched it, how many puts followed the
first one, how many distinct record digests those puts stored, which change was
the most recent, and the head sequence the answer was read through. A put that
stores bytes the key already held advances the log without changing the record,
so while no tombstone touched the key, a put count above the distinct-digest
count means the key was rewritten rather than changed. After a tombstone that
comparison no longer holds, because removing a record and restoring identical
bytes changes it twice while storing one digest. The reducer sorts its input by
sequence and rejects two changes at one sequence, a change ahead of the head it
was read through, and more than 65,536 changes.

The counts are facts about the log. V1 attaches no meaning to them: the kernel
states how often a record was written, and an application decides whether that
matters for review, ranking, or trust.

A count follows one record key. Where an application represents a correction as
a new record that supersedes an older one, as the observation profile does, the
correction is a separate key with its own count, and following that chain is the
application's work.

Two readers produce those changes. `OhSqliteStore.recordRevisions` reads them
from the local log inside one read transaction, newest first, under an explicit
`limit` that defaults to 65,536. A read that hits its bound reports
`truncated: true`; truncation drops the oldest changes, so the latest change,
the latest sequence, and the through sequence stay exact while the counts become
lower bounds. `ohRecordRevisionChangesFromOperationsV1` collects the same
changes from operations a reader already holds, so a change-feed consumer
derives identical counts without local SQL. It accepts at most 1,000 operations,
matching the operation page and import bounds. It requires the caller to name
the space, because a sequence numbers an operation within one space and a feed
from the wrong space would otherwise reduce to plausible wrong counts, and it
requires one contiguous run of operations in sequence order, because a missing
page would otherwise lower the counts with nothing reporting it. Contiguity
across separate calls remains the caller's to maintain.

The `limit` bounds the result, not the search. In the worst case the read
examines every operation in the space up to its through sequence, so its cost
grows with the length of the log rather than with `limit`, and a key written
rarely or not at all is the expensive case. V1 promises the bound on the result
and nothing about the speed of the search: the plan SQLite chooses for this read
depends on the indexes and table statistics the database happens to carry, so a
host that adds either can change the cost in both directions. Treat the counts
as correct and the latency as something to measure on the database in front of
you.

Both are reads. They add no table, index, or migration, they never write, and
the `OhStoreV1` port, the operation bytes, and every V1 digest preimage are
unchanged.

## Semantic bundle ingress

Model-facing code SHOULD use `OhSemanticBundleIngressV1` instead of generic
record puts. The ingress seals its codec registry, requires a registered codec
for every put kind, parses all values, creates canonical record envelopes, and
submits all puts and tombstones as one compare-and-swap operation. Missing
codecs, invalid values, duplicate keys, stale heads, and incomplete dependency
closures fail before the authority head moves.

## Profiles and host control

A binding combines one exact contract, application profile, lifecycle profile,
realm, and space. The built-in canonical profile permits operation replication
and forbids whole-space purge. The built-in working profile forbids operation
replication and permits purge.

Creating an authority returns separate `store` and `host` objects. The ordinary
store never has a purge method. Trusted control-plane code retains the host
object and does not pass it to an agent tool or model. This is an API and
custody boundary, not protection from code that already holds raw database
credentials or direct filesystem access.

## Dependency-closure capsules

A closure export pins the source binding and exact head, sorts unique roots,
and includes exactly the records reachable through declared dependencies. The
capsule digest binds all of those fields. Verification rejects a missing
dependency, an extra unrelated record, a changed record digest, reordered
roots or records, and a false capsule digest. V1 bounds a capsule to 1,024
roots, 8,192 records, and 67,108,864 canonical UTF-8 bytes.

A closure is content evidence for a later reviewed adoption. It does not copy
source authority, review state, credentials, or operation history into a
destination.

## Direct libSQL authority

`@hraness/oh/libsql` accepts the `execute` and transactional `batch` shape of
`@libsql/client`. It is Node 24 and serverless compatible and does not import
`bun:sqlite`. Unlike the V1 sync transport, it treats libSQL as the current
record and operation authority.

`bootstrapOhLibSqlAuthorityV1` is the only API that creates schema objects.
Run it in a deployment or migration step with a short-lived schema credential.
`createOhLibSqlStoreAuthorityV1` is the runtime open: it only verifies the
installed schema and contract before reading or creating a bound data space,
so a runtime token does not need schema-change permission.

`openExistingOhLibSqlStoreAuthorityV1` is the least-privilege open for a
separately held reader or purge worker. It verifies the same exact schema,
contract, space head, and binding using reads only. It rejects a missing,
purged, or differently bound space and never inserts, updates, or deletes data
during open. A provider credential can therefore omit space and binding
creation while retaining only the data actions required by its later task.

`purgeOhLibSqlWorkingSpaceV1` is the one-shot lifecycle-worker boundary. It
purges an existing exact working binding or atomically writes an empty-head
purge receipt when creation never completed. Creation and absent-space fencing
race in the same authority transaction: whichever wins, the result converges
to one complete purge receipt, and a delayed creator cannot resurrect the
space. The credential still needs no permission to create spaces or bindings.

Runtime open verifies the exact installed table, index, and trigger set, not
only a schema marker. Every operation, binding, and purge receipt read parses
its canonical JSON and cross-checks each duplicated SQL column. Current reads
also prove contiguous operation coverage through the exact terminal head,
record provenance puts, record digests, and dependency materialization.

Its private implementation tables use the `oh_authority_` prefix:

| Table | Role |
| --- | --- |
| `oh_authority_schemas` | Exact adapter schema name and digest. |
| `oh_authority_contracts` | Exact Oh contract manifest. |
| `oh_authority_spaces` | Current compare-and-swap heads. |
| `oh_authority_operations` | Canonical append-only operations. |
| `oh_authority_operation_records` | Ordered changes per operation. |
| `oh_authority_records` | Current record materialization. |
| `oh_authority_dependencies` | Current dependency edges. |
| `oh_authority_bindings` | Realm and profile control metadata. |
| `oh_authority_purges` | Minimal whole-space purge receipts. |
| `oh_authority_commit_guards` | Empty constraint table used to abort a stale transactional batch. |

A normal remote commit takes three atomic provider round trips: an idempotency,
head, and purge preflight; one exact current-materialization read; and one
guarded write batch. The final write guard aborts the complete transaction when
compare-and-swap did not settle at the declared operation. Its write-batch
readback must reproduce both the canonical operation and persisted head before
the adapter returns success.

Provider responses are bounded as part of the API. V1 accepts at most 64
changes, 512 dependencies, and 512 KiB of canonical operation JSON per commit.
A feed returns at most seven operations plus one checked sentinel and refuses a
page whose conservative transport estimate exceeds 9,000,000 bytes. Historical
replay is limited to 16,384 operations, 4 MiB of canonical operation JSON, and
the same response estimate. Current snapshot and full-verification result sets
are independently transport-estimated and SQL-gated before rows are returned.
Sizing, rows, and the pinned head are read in the same transaction, so a
concurrent append cannot grow an unchecked response between preflight and read.

Remote purge similarly inserts a receipt only for the expected working head,
deletes every payload and materialization row under that receipt in the same
write batch, and aborts if either the receipt or deletion is incomplete. A
later open returns the stored purge receipt instead of recreating the space.
Operation-record deletion resolves ownership through the canonical operation;
the purge postcondition also rejects any global orphan or cross-space owner
mismatch. Purge receipts are immutable and intentionally retain only binding,
prior-head, and purge-event evidence.

### Direct libSQL shutdown

Calling an authority store's `close()` immediately fences new calls on both its
store and host handles. Already admitted operations finish their native calls,
transaction result validation and reconciliation before close resolves. Concurrent
commits remain concurrent and are arbitrated by SQL compare-and-swap.

The client is borrowed unless `closeClient: true` was selected when opening the
authority. An owned client is closed once after the drain; repeated `close()` calls
observe that same result. A failed operation and a failed authority close reject
their respective Promises with their original values. The standalone
`purgeOhLibSqlWorkingSpaceV1` helper retains its `finally` contract: when both purge
and its requested client close fail, the close failure is its rejection value.
