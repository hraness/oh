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
