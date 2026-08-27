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
chain. An empty bundle is valid.

Parsing recomputes every operation digest and the bundle digest. Import also
requires the bundle space to equal the selected local space and each operation
to extend the exact local head.

## Settlement

The synchronizer defaults to batches of 100 and at most 100 rounds. Each round
compares heads:

- Equal sequences and equal digests are settled.
- A lower local sequence pulls a chain that begins at the exact local head.
- A higher local sequence pushes a chain that begins at the exact remote head.
- Equal sequences with different digests, or any non-extending chain, are a
  conflict.

The synchronizer never performs last-write-wins merging. Divergent append-only
histories remain intact for an explicit domain merge. Remote acknowledgments
must equal the final pushed operation.

## libSQL and Turso seam

The included adapter accepts a client with `execute` and transactional `batch`
methods compatible with `@libsql/client`. It creates only:

- `oh_sync_contracts`, containing exact contract manifests; and
- `oh_sync_operations`, containing the ordered canonical operation log.

The application supplies the client, credentials, endpoint, access policy,
retry policy, and backups. The adapter parameterizes values and verifies
canonical operation JSON on pull. Semantic documents and vectors never cross
this seam.

## Offline transfer

`oh sync export --after <sequence> --limit <count>` emits one canonical bundle.
`oh sync import --file <path>` verifies and applies a bundle idempotently. A
transfer process SHOULD preserve the exact bytes and SHOULD run `oh verify`
after the final import.
