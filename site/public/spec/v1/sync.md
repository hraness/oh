# Operation sync V1

The protocol identifier is `oh.sync.v1`. Sync exchanges canonical operations,
not current-row snapshots or semantic indexes.

## Handshake

Before reading or writing a remote, a transport MUST compare the complete V1
contract manifest. The current contract digest is
`e53ae573c2af417082be9f554d0f6f3e317f054daf745181f462608e3f622594`.
A different digest fails before operation exchange.

A transport implements four bounded methods:

```ts
interface OhOperationSyncTransportV1 {
  handshake(manifest: OhContractManifestV1): Promise<void>;
  head(spaceId: string): Promise<OhSyncHeadV1>;
  pull(spaceId: string, afterSequence: number, limit: number): Promise<OhSyncBundleV1>;
  push(bundle: OhSyncBundleV1): Promise<OhSyncHeadV1>;
}
```

## Bundle

A bundle binds `oh.sync.v1`, the contract digest, one space ID, at most 1,000
ordered operations, and its own digest. Operations MUST form one contiguous
chain. An empty bundle is valid. The complete canonical bundle is limited to
64 MiB plus 4 KiB of envelope and operation-separator allowance, and to the
equivalent finite JSON-node budget. Every operation, including its top-level
strings, dependencies, and record values, consumes those shared limits; compact
in-process graphs with repeated references do not multiply into unbounded
detached data. `OH_SYNC_BUNDLE_MAX_BYTES_V1` exposes the canonical byte limit.

The stock synchronizer selects the largest nonempty local prefix that fits
these shared limits, even when the requested operation-count page is larger.
The libSQL adapter applies the same cumulative canonical-byte predicate in its
ordered remote query. A valid history larger than one bundle therefore advances
in bounded pages instead of becoming permanently unsynchronizable. Host and
offline exporters can request the same behavior with
`createOhSyncBundleV1(spaceId, operations, { largestFittingPrefix: true })`.

Parsing recomputes every operation digest and the bundle digest. Import also
requires the bundle space to equal the selected local space and each operation
to extend the exact local head. The SQLite host replication handle applies a
complete bundle in one `BEGIN IMMEDIATE` transaction. If any later operation
fails semantic replay, no valid prefix is retained. An exact bundle already on
the current authority chain is an idempotent replay.

`parseOhSyncHeadV1` is the strict ingress for untrusted transport heads. It
requires only `operationSha256`, `sequence`, and `v`, and enforces that sequence
zero is the only null-digest head. `parseOhSyncHeadRefV1` applies the same
descriptor-safe rules to an exact two-field host cursor. Both reject negative
zero, accessors, proxies, and extra or hidden properties without invoking
caller code. Bundle parsing checks exact envelopes and cheap collection limits
before recursively detaching values; it rejects operations that parsing would
otherwise normalize to different canonical JSON. Record-value detachment is
limited to 128 nested levels, 1,048,576 traversed value nodes, and the graph
record's 1 MiB canonical value ceiling. The parser also applies the 64 MiB
canonical operation ceiling and an equivalent finite operation-node budget.
Canonical string and container bytes are counted during traversal, and an
array whose length cannot fit the remaining budget is rejected before its
entries are enumerated or cloned. Shared object references consume the budget
again for every canonical occurrence. Dependencies are preflighted under the
same operation budget before any nested collection is cloned.

## Host-controlled SQLite replication

`createOhSqliteStoreAuthorityV1` keeps canonical replication on
`authority.host.replication`; it is never a method on the agent-safe
`OhStoreV1`. Working profiles receive no replication handle. The canonical
handle exposes the exact binding, current head, pinned bundle export, and
atomic bundle import.
Import requires an exact strict head reference before parsing the bundle.

Pinned export delegates to `changesSince(from, { limit, through })` and returns
the page's exact `from`, `to`, `through`, and `hasMore` evidence with the
canonical bundle. A writer that advances after `through` therefore cannot
silently enlarge the exported interval. Applications SHOULD persist that
bounded evidence before releasing local custody for network I/O.

## Settlement

The synchronizer defaults to batches of 100 and at most 100 rounds. Each round
compares heads:

- Equal sequences and equal digests are settled.
- A lower local sequence pulls a chain that begins at the exact local head.
- A higher local sequence pushes a chain that begins at the exact remote head.
- Equal sequences with different digests, or any non-extending chain, are a
  conflict.

A pull may not exceed the requested batch size. A page that reaches the
observed remote sequence must end at that exact operation digest, and is
rejected before import otherwise. A terminal pull or acknowledged terminal
push settles in that same round after fresh local- and remote-head checks;
callers do not need to reserve an extra observation round in `maximumRounds`.

The synchronizer never performs last-write-wins merging. Divergent append-only
histories remain intact for an explicit domain merge. Remote acknowledgments
must equal the final pushed operation. The stock synchronizer is convenient for
simple transports and keeps the concrete store open while awaiting the network.
Applications that journal uncertain effects SHOULD instead split capture,
network exchange, and atomic import into separately revalidated host phases.

## libSQL and Turso seam

The included adapter accepts a client with `execute` and transactional `batch`
methods compatible with `@libsql/client`. It creates only:

- `oh_sync_contracts`, containing exact contract manifests; and
- `oh_sync_operations`, containing the ordered canonical operation log.

The application supplies the client, credentials, endpoint, access policy,
retry policy, and backups. The adapter parameterizes values and verifies
canonical operation JSON on pull. Pull cursors are nonnegative, pull limits are
1 through 1,000, a provider response may not exceed its requested row count,
each raw operation JSON string is byte-bounded before parsing, and the ordered
query returns only the largest prefix within the shared bundle byte ceiling.
Semantic documents and vectors never cross this seam.

Push retries are idempotent even if another writer has advanced the remote
past the submitted tail. The adapter reads at most the submitted row count,
requires every submitted sequence, digest, and canonical operation JSON to
match the immutable remote rows, and acknowledges the submitted tail rather
than the newer remote head. A missing or changed row fails closed.

## Offline transfer

`oh sync export --after <sequence> --limit <count>` emits one canonical bundle.
`oh sync import --file <path>` verifies and applies the complete bundle
idempotently in one atomic import; an invalid later operation cannot leave a
valid prefix behind. Before reading, the CLI requires a regular file no larger
than the canonical bundle limit plus its one exported terminal LF, and checks
the actual bytes again after the read. A transfer process SHOULD preserve the
exact bytes and SHOULD run `oh verify` after the final import.
