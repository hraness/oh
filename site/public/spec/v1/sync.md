# Operation sync V1

The protocol identifier is `oh.sync.v1`. Sync exchanges canonical operations.
It does not exchange current-row snapshots or semantic indexes.

## Handshake

Before reading or writing a remote, a transport MUST compare the complete V1
contract manifest. The V1 contract manifest digest is
`e53ae573c2af417082be9f554d0f6f3e317f054daf745181f462608e3f622594`.
A different digest fails before any operation is exchanged.

A transport implements four methods, each with limited input and output:

```ts
interface OhOperationSyncTransportV1 {
  handshake(manifest: OhContractManifestV1): Promise<void>;
  head(spaceId: string): Promise<OhSyncHeadV1>;
  pull(spaceId: string, afterSequence: number, limit: number): Promise<OhSyncBundleV1>;
  push(bundle: OhSyncBundleV1): Promise<OhSyncHeadV1>;
}
```

## Bundle

A bundle contains the protocol identifier `oh.sync.v1`, the contract digest,
one space ID, at most 1,000 ordered operations, and its own digest,
`bundleSha256`. Operations MUST form one contiguous chain. An empty bundle is
valid. The complete canonical bundle is limited to 64 MiB plus 4 KiB for the
envelope and the separators between operations, and to a matching limit on
the number of JSON nodes. All operations in a bundle share these limits. Each
operation’s top-level strings, dependencies, and record values count against
them. An in-process object graph can refer to one value many times, and every
reference counts, so a compact graph cannot expand into unlimited detached
data. `OH_SYNC_BUNDLE_MAX_BYTES_V1` exposes the canonical byte limit.

When it pushes, the included synchronizer, `synchronizeOhStoreV1`, selects the
longest nonempty local prefix that fits these shared limits, even when the
requested page holds more operations. The libSQL adapter applies the same
running total of canonical bytes in its ordered remote query. A valid history
larger than one bundle therefore syncs in several pages that each fit the
limits, and it never becomes too large to sync. Host and offline exporters can
request the same behavior with
`createOhSyncBundleV1(spaceId, operations, { largestFittingPrefix: true })`.

Parsing recomputes every operation digest and the bundle digest. Import also
requires the bundle’s space to equal the selected local space and the
operations to extend the exact local head in order. The SQLite host
replication handle applies a complete bundle in one `BEGIN IMMEDIATE`
transaction. If a later operation fails semantic replay, the import keeps none
of the valid operations before it. Importing an exact bundle that is already
on the local store’s current chain is an idempotent replay.

`parseOhSyncHeadV1` is the strict parser for untrusted transport heads. It
accepts exactly the fields `operationSha256`, `sequence`, and `v`. A head has
a null digest exactly when its sequence is zero. `parseOhSyncHeadRefV1`
applies the same rules to a host cursor with exactly the two fields
`operationSha256` and `sequence`. Both reject negative zero, accessor
properties, proxies, and extra or hidden properties, and neither runs caller
code while it checks.

Bundle parsing checks each envelope’s exact keys and the collection limits
that are cheap to test before it recursively copies values. It rejects any
operation that parsing would otherwise normalize to different canonical JSON.
Copying a record value is limited to 128 nested levels, 1,048,576 traversed
value nodes, and the graph record’s 1 MiB canonical value limit. The parser
also applies the 64 MiB canonical operation limit and a matching limit on
operation nodes. Traversal counts the canonical bytes of strings and
containers as it goes. An array whose length cannot fit the remaining budget
is rejected before its entries are enumerated or copied. An object that
appears in several places counts against the budget again at each canonical
occurrence. Dependencies are checked against the same operation budget before
any nested collection is copied.

## Host-controlled SQLite replication

`createOhSqliteStoreAuthorityV1` places canonical replication on
`authority.host.replication`. Replication is never a method of `OhStoreV1`,
the store port that an application can give an agent. A working profile gets
no replication handle. A canonical profile’s handle exposes the exact binding,
the current head, a pinned bundle export, and an atomic bundle import. Import
parses its expected head as an exact, strict head reference before it parses
the bundle.

Pinned export reads one page with `changesSince(from, { limit, through })`.
The bundle holds the longest prefix of that page that fits the bundle limits.
Export returns the canonical bundle with the page’s exact `from` and
`through`. The returned `to` names the last exported operation, and `hasMore`
is true when operations after `to` and up to `through` were not exported. A
writer that commits after `through` therefore cannot enlarge the exported
interval without notice. Applications SHOULD persist those four fields before
they release their hold on the local store for network I/O.

## Sync rounds

The included synchronizer defaults to batches of 100 operations and at most
100 rounds. Each round compares the local and remote heads:

- Equal sequences with equal digests finish the sync.
- A lower local sequence pulls a chain that begins at the exact local head.
- A higher local sequence pushes a chain that begins at the exact remote head.
- Equal sequences with different digests, or any chain that does not extend
  the expected head, are a conflict.

The synchronizer rejects a pulled page with more operations than the requested
batch size. A page that reaches the observed remote sequence must end at that
exact operation digest, and the synchronizer rejects it before import
otherwise. When a pull reaches the observed remote head, or an acknowledged
push reaches the local head, the synchronizer reads both heads again. If they
match, the sync finishes in that same round, so callers do not need to
reserve an extra round in `maximumRounds` to observe the result.

The synchronizer never performs last-write-wins merging. It leaves divergent
append-only histories intact for an explicit domain merge. Remote
acknowledgments must equal the final pushed operation. The included
synchronizer suits simple transports and keeps the concrete store open while
it waits on the network. Applications that journal uncertain effects SHOULD
instead split capture, network exchange, and atomic import into separately
revalidated host phases.

## libSQL and Turso transport

The included adapter, `createLibSqlOperationSyncTransportV1`, accepts a client
with `execute` and transactional `batch` methods compatible with
`@libsql/client`. It creates only these tables:

- `oh_sync_contracts`, containing exact contract manifests; and
- `oh_sync_operations`, containing the ordered canonical operation log.

The application supplies the client, credentials, endpoint, access policy,
retry policy, and backups. The adapter passes values as SQL parameters and
verifies canonical operation JSON on pull. A pull cursor is nonnegative, and a
pull limit is one through 1,000. The adapter rejects a provider response with
more rows than it requested. It checks the byte length of each raw operation
JSON string against the 64 MiB operation limit before parsing it. The ordered
query returns only the longest prefix that fits the shared bundle byte limit.
Semantic documents and vectors never pass through this transport.

A retried push is idempotent, even after another writer has extended the
remote past the last submitted operation. The adapter reads no more rows than
the push submitted. It requires the sequence, digest, and canonical operation
JSON of every submitted operation to match the immutable remote rows. It then
acknowledges the last submitted operation, even when the remote head is newer.
A missing or changed row rejects the push as a sync conflict.

## Offline transfer

`oh sync export --after <sequence> --limit <count>` writes one canonical
bundle. `oh sync import --file <path>` verifies the complete bundle and
applies it idempotently in one atomic import. If a later operation is invalid,
the import keeps none of the valid operations before it. Before reading, the
CLI requires a regular file no larger than the canonical bundle limit plus the
one terminal line feed that export writes. It checks the byte count again
after the read. A transfer process SHOULD preserve the exact bytes and SHOULD
run `oh verify` after the final import.
