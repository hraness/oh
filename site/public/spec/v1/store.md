# Store ports, profiles, and direct libSQL authority

This document defines host APIs over the V1 graph and operation contract. An
*authority* is the store that holds a space’s current records and operation
log: local SQLite or direct libSQL. These APIs add no wire change, so records
and operations keep their V1 bytes in both authorities.

## Promise-based store port

`@hraness/oh/store` has no dependency on `bun:sqlite`. Its methods return
promises and expose:

- the current exact head;
- a current or historical snapshot at an exact sequence and operation digest;
- a size-limited, contiguous page of changes up to a pinned head;
- compare-and-swap commit;
- dependency-closure export;
- replay and materialization verification; and
- close.

A historical read MUST fail if its sequence is absent or identifies a
different operation digest. A change page MUST name its source cursor, pinned
through-head, returned cursor, and whether more operations remain. In
`OhChangesPageV1` these are `from`, `through`, `to`, and `hasMore`.

A commit can declare `maximumOperationBytes`. The built-in SQLite and direct
libSQL authorities measure the exact canonical operation before persistence,
including on an exact operation-ID replay. An operation larger than the
declared maximum throws `OhOperationSizeError`, a `RangeError` subtype that
carries `operationBytes` and `maximumOperationBytes`. The check runs before
anything is written, so this error never leaves the outcome of a write in
doubt. Its public `code` is `oh.operation-size.v1`, and
`instanceof OhOperationSizeError` gives the same answer across separately
bundled Oh entry points. To check an unknown caught value, a caller can use
`isOhOperationSizeError` instead. The guard requires a native error with
immutable branded numeric fields, so a plain object with the public fields
copied onto it does not pass.

The core `OhConflictError`, `OhIntegrityError`, `OhDependencyError`, and
`OhProfileError` classes likewise preserve `instanceof` identity across
separately bundled Oh entry points. Their corresponding `isOhConflictError`,
`isOhIntegrityError`, `isOhDependencyError`, and `isOhProfileError` guards
require a native error with the immutable brand for that exact error family.
An instance of an ordinary subclass passes its branded base class’s check, but
a base instance MUST NOT satisfy an arbitrary subclass check.

## Record revision reads

The operation log records every change to every record key. Each committed
operation lists its puts and tombstones, and a key can appear at most once in
one operation. A reader can therefore ask how often a stored record was
written without keeping a separate counter.

`reduceOhRecordRevisionsV1` turns a set of one key’s log changes into counts:
how many puts and tombstones touched it, how many puts followed the first one,
how many distinct record digests those puts stored, how many puts stored bytes
the key already held, which change was the most recent, and the head sequence
the answer was read through.

A put whose digest matches the preceding put’s digest advances the log without
changing the record, and `idempotentPuts` counts exactly those puts. The
distinct digest count does not carry that meaning and must not be used for it.
A key put as A, B, A has three puts and two digests, and every put changed the
record. By those two numbers it looks the same as A, A, B, which contains one
rewrite. A tombstone clears the record, so a put that restores identical bytes
after a tombstone changes the record, and `idempotentPuts` does not count it.

The reducer sorts its input by sequence. It rejects two changes at one
sequence, a change ahead of the head it was read through, a start sequence
after that head, and more than 65,536 changes. It requires every input field,
including `truncated`, so a caller cannot omit the one field that separates an
exact count from a lower bound.

The counts are facts about the log. V1 attaches no meaning to them. The kernel
states how often a record was written, and an application decides whether
that matters for review, ranking, or trust.

A count follows one record key. When an application represents a correction as
a record that supersedes an older one, as the observation profile does, the
correction is a separate key with its own count. Following that chain is the
application’s work.

Two functions read those changes. `OhSqliteStore.recordRevisions` reads them
from the local log inside one read transaction, newest first, and returns the
reduced counts. Its `limit` defaults to 65,536, which is also the maximum. A
read that finds more changes than its limit reports `truncated: true`.
Truncation drops the oldest changes, so the latest change, the latest
sequence, and the through sequence stay exact while the counts become lower
bounds.

`ohRecordRevisionChangesFromOperationsV1` collects the same changes from
operations a reader already holds, so a change-feed consumer derives the same
counts without local SQL. It accepts at most 1,000 operations, the same limit
as an operation page and an import. It requires the caller to name the space.
A sequence numbers an operation within one space, so operations from the
wrong space would reduce to counts that look plausible and are wrong. It also
requires one contiguous run of operations in sequence order, because a missing
page would lower the counts with nothing reporting it.

A run that is contiguous within one call can still start after the first
operation in the log, and a run read from a live feed’s cursor always does.
The function therefore returns the first sequence it observed, and a reduce
over a run that did not start at the log’s first operation reports
`truncated: true`. Otherwise a partial window would report counts lower than
the truth, in the same shape as an exact answer for a key first written later
in the log, and no consumer could tell the two apart. A caller that stitches
several pages together concatenates the changes and reduces once with the
earliest observed sequence.

The `limit` caps the number of changes returned, and the search itself has no
cap. In the worst case the read examines every operation in the space up to
its through sequence, so its cost grows with the length of the log instead of
with `limit`. A key written rarely or not at all is the expensive case. V1
guarantees the result limit and nothing about search speed. The plan SQLite
chooses for this read depends on the indexes and table statistics the
database has, so a host that adds either can make the read faster or slower.
Treat the counts as correct, and measure latency on the database you use.

Both functions only read. Neither adds a table, index, or migration, and
neither is part of the `OhStoreV1` port, the operation bytes, or any V1 digest
preimage.

## Semantic bundle ingress

Model-facing code SHOULD use `OhSemanticBundleIngressV1` instead of generic
record puts. The ingress seals its codec registry, requires a registered codec
for every put kind, parses all values, creates canonical record envelopes, and
submits all puts and tombstones as one compare-and-swap operation. Missing
codecs, invalid values, duplicate keys, stale heads, and incomplete dependency
closures fail before the authority head moves.

## Profiles and host control

A binding combines one exact contract, application profile, lifecycle
profile, realm, and space. The built-in canonical profile,
`OH_CANONICAL_STORE_PROFILE_V1`, permits operation replication and forbids
whole-space purge. The built-in working profile, `OH_WORKING_STORE_PROFILE_V1`,
forbids operation replication and permits purge.

Creating an authority returns separate `store` and `host` objects. The `store`
object never has a purge method. Trusted control-plane code keeps the `host`
object and does not pass it to an agent tool or model. The split limits what
code holding only `store` can call. It does not protect against code that
already holds raw database credentials or direct filesystem access.

## Dependency-closure capsules

A dependency-closure capsule, `OhDependencyClosureV1`, is an export of a set of
root records and every record they depend on. The export records the source
binding and exact head, sorts unique roots, and includes exactly the records
reachable from the roots through declared dependencies. The capsule digest,
`closureSha256`, covers all of those fields. Verification rejects a missing
dependency, an extra unrelated record, a changed record digest, reordered
roots or records, and a false capsule digest. V1 limits a capsule to 1,024
roots, 8,192 records, and 67,108,864 canonical UTF-8 bytes.

A closure is content evidence for a later reviewed adoption. It does not copy
source authority, review state, credentials, or operation history into a
destination.

## Direct libSQL authority

`@hraness/oh/libsql` accepts any client with the `execute` and transactional
`batch` methods of `@libsql/client`. It runs on Node 24 and in serverless
runtimes and does not import `bun:sqlite`. The V1 sync transport uses libSQL
as a remote copy of the operation log. This entry point makes libSQL the
authority for current records and operations.

`bootstrapOhLibSqlAuthorityV1` is the only API that creates schema objects.
Run it in a deployment or migration step with a short-lived schema credential.
`createOhLibSqlStoreAuthorityV1` opens the store at runtime. It only verifies
the installed schema and contract, then reads the bound data space or creates
it, so a runtime token needs no schema-change permission.

`openExistingOhLibSqlStoreAuthorityV1` opens with the fewest permissions, for
a reader or purge job that holds its own credential. It verifies the same
exact schema, contract, space head, and binding with reads only. It rejects a
missing, purged, or differently bound space and never inserts, updates, or
deletes data while opening. That credential can therefore leave out
permission to create spaces and bindings and keep only the data permissions
its later task needs.

`purgeOhLibSqlWorkingSpaceV1` purges one working space in a single call, for a
job that deletes spaces. It purges an existing space with the exact working
binding. If creation never completed, it instead atomically writes a purge
receipt with an empty head. Creation and this purge can race, and each runs
as one transaction in the authority database. Whichever commits first, the
result is one complete purge receipt, and a delayed creator cannot bring the
space back. The purge credential needs no permission to create spaces or
bindings.

At runtime, opening verifies the schema marker and the exact set of installed
tables, indexes, and triggers. Every read of an operation, binding, or purge
receipt parses its canonical JSON and checks each SQL column that duplicates a
JSON field. Reads of current state also check that operations are contiguous
up to the exact head, and check the put that produced each record, the record
digests, and the dependency rows.

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

A normal remote commit takes three atomic round trips to the provider. The
first checks the operation ID, the head, and purge state. The second reads the
exact current materialization. The third is one guarded write batch. The last
guard in that batch aborts the whole transaction unless compare-and-swap left
the head at the declared operation. The batch then reads back the canonical
operation and the persisted head, and the adapter returns success only when
both match.

Response size limits are part of the API. V1 accepts at most 64 changes, 512
dependencies, and 512 KiB of canonical operation JSON per commit. A feed page
returns at most seven operations, plus one extra operation that Oh checks and
uses only to report whether more exist. Oh refuses a page whose conservative
transport size estimate exceeds 9,000,000 bytes. Historical replay is limited
to 16,384 operations, 4 MiB of canonical operation JSON, and the same response
estimate. For current snapshots and full verification, each SQL query
estimates the transport size of its whole result set and returns rows only
when that estimate is within its limit. Sizes, rows, and the pinned head are
read in the same transaction, so a concurrent append cannot enlarge a response
between the size check and the read.

Remote purge inserts a receipt only for the expected working head. In the same
write batch it deletes every payload and materialization row that the receipt
covers, and it aborts if either the receipt or the deletion is incomplete. A
later open rejects with `OhPurgedSpaceError`, which carries the stored purge
receipt, and does not recreate the space. Operation-record deletion finds each
row’s space through its canonical operation. The check after purge also
rejects any operation-record row in the database whose operation is missing or
belongs to a different space. Purge receipts are immutable and, by design,
keep only binding, prior-head, and purge-event information.

### Direct libSQL shutdown

Calling `close()` on an authority’s store immediately rejects new calls on
both its `store` and `host` objects. Operations that started before the call
finish their native calls, result validation, and reconciliation before
`close()` resolves. Closing does not serialize those operations: SQL
compare-and-swap decides between concurrent commits.

Oh borrows the client and does not close it unless the authority was opened
with `closeClient: true`. In that case Oh closes the client once, after the
started operations finish, and every `close()` call receives that same result.
A failed operation and a failed close each reject their own Promise with the
original value. The standalone `purgeOhLibSqlWorkingSpaceV1` helper behaves
like a `finally` block: when the purge and the requested client close both
fail, it rejects with the close failure.
