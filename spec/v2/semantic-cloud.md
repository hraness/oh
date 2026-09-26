# Hosted semantic cache V2

Hosted semantic-cache V2 is the isolated successor to the immutable
[semantic-cache V1 contract](../v1/semantic-cloud.md). It keeps the same fixed
Cloudflare EmbeddingGemma profile and renderer and changes only the rebuildable
libSQL cache protocol. It does not change an Oh graph, record, operation, local
embedding, or provider contract.

Applications use `bootstrapOhLibSqlSemanticCacheV2` and
`openOhLibSqlSemanticCacheV2`. The parallel
`bootstrapOhLibSqlSemanticCacheV1`, `openOhLibSqlSemanticCacheV1`, V1 types,
V1 result values, and V1 digest preimages keep the released V1 behavior. V1
and V2 use the same physical table names, so they cannot be open in one
database at the same time. A V1 database can be upgraded to V2. A V2 database
cannot be opened as V1 or downgraded.

The host MUST quiesce V1 stage, publish, head, and search traffic before
upgrade. An already-open V1 object gives no access to the V2 runtime.
Bootstrap does resolve a V1 purge that races the upgrade. A purge committed
before the transition starts is copied into it. A purge that reaches the
changed schema cannot report success.

## Isolation and identity

Every V2 authority reference and every stage, publish, head, search, receipt,
and purge operation binds an `isolationSha256`. It is a validated opaque
SHA-256 supplied by the host. Private hosts SHOULD derive it from their private
authority handle, cache epoch, and exact cache profile. When omitted, Oh derives:

```json
{"authorityId":"<authority>","kind":"oh.semantic-authority-isolation.v2","v":2}
```

and hashes the canonical JSON. An isolation belongs to one authority for good.
An authority may reserve several isolation epochs. The isolation digest never
enters renderer or provider text.

Vector primary identity is
`(isolation_sha256, profile_sha256, renderer_sha256, input_sha256)`.
Generations, memberships, and published heads store the isolation explicitly.
The membership digest hashes a canonical `oh.semantic-membership.v2` envelope.
The generation digest hashes an `oh.semantic-generation.v2` envelope. As a
result, identical rendered text in different authorities or epochs is embedded
and stored separately. Isolation prevents one authority from reusing or
deleting another’s vectors. It is not encryption, and anyone with database
access can see equal raw input digests or vector bytes.

All public V2 values use `v: 2`. Provider and renderer values use V1 because
those fixed contracts did not change.

## Published reads and purges

`publishedHead` returns `null` for an isolation mismatch. Search checks the
same isolation before sending a query to the provider and again while reading
memberships. Publish requires the staged generation’s exact isolation.

`purgeAuthority` takes an isolation and fails with a conflict, deleting
nothing, in three cases:

- the authority’s published head holds a different isolation;
- another authority owns the isolation; or
- the isolation is unreserved while this authority already owns one.

Otherwise it reserves the isolation if needed and writes the permanent
authority tombstone. It then deletes the authority’s published head, every
generation and membership, and every vector in every isolation the authority
owns. Isolation rows stay.

The purge result records the first execution’s counts and returns them
unchanged on replay. It contains `purgeMarkerSha256`, the canonical
`oh.semantic-purge-receipt.v2` `purgeReceiptSha256`, and zero
`residualGenerations`, `residualMemberships`, and
`residualScopedVectors`. The cache stores the tombstone and its counts, and
computes `purgeReceiptSha256` each time it is read. `purgeReceipt` returns the
same proof, which contains no cached content, without issuing deletes.

## V1-to-V2 transition

Bootstrap accepts exactly four schema inventories: an empty database, the
published V1 inventory, the transition inventory described below, and the V2
inventory. It creates V2 in an empty database. Any other inventory fails with
`integrity`. An upgrade from V1 first starts one atomic write transaction that:

1. creates `oh_semantic_v1_purge_transition`;
2. copies every V1 authority tombstone into it with one database-side
   `INSERT ... SELECT`;
3. only after that copy, drops all six V1 tables, including the globally
   deduplicated derived rows, `oh_semantic_purges`, and the V1 schema-marker
   table; and
4. creates the V2 schema without a V2 schema marker.

The copy has no lifetime tombstone cap and returns no rows to the host. A
concurrent V1 purge either commits before this transaction and is copied,
or runs afterward against a non-V1 schema and cannot report success. Concurrent
V2 bootstraps converge on the one transition table.

While the transition table exists, `openOhLibSqlSemanticCacheV2` fails
closed. Bootstrap reads transition rows in pages of 32, ordered by
`authority_id`. Each page atomically writes a V2 isolation row and a V2 purge
row for every legacy tombstone. It deletes a transition row only when both
rows exist with the expected values. A crash before a page commit changes
nothing, and a crash after commit can replay safely. Live V1 heads,
generations, memberships, and vectors are discarded on purpose, because their
global vector identity cannot be assigned a private owner after the fact.

Finalization inserts the exact V2 schema marker only when the transition table
is empty, then drops that table in the same transaction. Until that commit,
neither a partially projected database nor a V2 runtime is accepted. Legacy
receipts use `countsRecorded: false`, and purges made under V2 use
`countsRecorded: true`.

The exact standalone schemas are
[revision 1](../v1/libsql-semantic-cache-schema-v1.sql) and
[revision 2](libsql-semantic-cache-schema-v2.sql). Fixed
[V1](../v1/libsql-semantic-digest-fixture-v1.json) and
[V2](libsql-semantic-digest-fixture-v2.json) fixtures make the incompatible
digest domains explicit. A hosted failure only removes derived semantic
results and MUST NOT weaken exact graph or Datalog
operations.
