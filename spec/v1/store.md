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

A remote commit reads one exact snapshot, computes the ordinary V1 operation,
then uses one write batch guarded by the expected head. The final guard aborts
the complete transaction when compare-and-swap did not settle at the declared
operation. The adapter re-reads and verifies the persisted canonical operation
before returning success.

Remote purge similarly inserts a receipt only for the expected working head,
deletes every payload and materialization row under that receipt in the same
write batch, and aborts if either the receipt or deletion is incomplete. A
later open returns the stored purge receipt instead of recreating the space.
