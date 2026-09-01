# Hosted semantic cache V2

Hosted semantic-cache V2 is the isolated successor to the immutable
[semantic-cache V1 contract](../v1/semantic-cloud.md). It keeps the same fixed
Cloudflare EmbeddingGemma profile and renderer, but changes only the rebuildable
libSQL cache protocol. It does not change an Oh graph, record, operation, local
embedding, or provider contract.

Applications use `bootstrapOhLibSqlSemanticCacheV2` and
`openOhLibSqlSemanticCacheV2`. The parallel
`bootstrapOhLibSqlSemanticCacheV1`, `openOhLibSqlSemanticCacheV1`, V1 types,
V1 result values, and V1 digest preimages remain the released V1 behavior. V1
and V2 use the same physical table names and therefore cannot be open in one
database simultaneously. A V1 database can be upgraded to V2; a V2 database
cannot be opened as V1 or downgraded.

The host MUST quiesce V1 stage, publish, head, and search traffic before
upgrade. An already-open V1 object is not a V2 runtime capability. Bootstrap
does, however, arbitrate a racing V1 purge: a purge committed before transition
custody is copied, while a purge that reaches the changed schema cannot report
success.

## Isolation and identity

Every V2 authority reference and every stage, publish, head, search, receipt,
and purge operation binds an `isolationSha256`. It is a validated opaque
SHA-256 supplied by the host. Private hosts SHOULD derive it from their private
authority handle, cache epoch, and exact cache profile. When omitted, Oh derives:

```json
{"authorityId":"<authority>","kind":"oh.semantic-authority-isolation.v2","v":2}
```

and hashes the canonical JSON. One isolation belongs immutably to one authority,
while one authority may reserve multiple isolation epochs. The digest never
enters renderer or provider text.

Vector primary identity is
`(isolation_sha256, profile_sha256, renderer_sha256, input_sha256)`.
Generations, memberships, and published heads retain the isolation explicitly.
The membership digest hashes a canonical
`oh.semantic-membership.v2` envelope; the generation digest hashes an
`oh.semantic-generation.v2` envelope. Consequently identical rendered text in
different authorities or epochs is embedded and stored independently. Isolation
prevents reuse and deletion coupling; it is not encryption and a database holder
can still observe equal raw input digests or vector bytes.

All public V2 values use `v: 2`. Provider and renderer values remain V1 because
those fixed contracts did not change.

## Published reads and purge custody

`publishedHead` returns `null` for an isolation mismatch. Search checks the
same isolation before sending a query to the provider and again while reading
memberships. Publish requires the staged generation's exact isolation.

`purgeAuthority` accepts the current published isolation, writes the permanent
authority tombstone, deletes every generation and membership for the authority,
and deletes every vector in every isolation reserved by it. A mismatched current
isolation is a conflict and authorizes no deletion. The receipt records the
first execution's counts and returns them unchanged on replay. It contains
`purgeMarkerSha256`, the canonical
`oh.semantic-purge-receipt.v2` `purgeReceiptSha256`, and zero
`residualGenerations`, `residualMemberships`, and
`residualScopedVectors`. `purgeReceipt` replays the same content-free proof
without issuing deletes.

## V1-to-V2 transition

Bootstrap recognizes only the exact published V1 inventory or the exact V2
inventory. An upgrade first starts one atomic write transaction that:

1. creates `oh_semantic_v1_purge_transition`;
2. copies every V1 authority tombstone into it with one database-side
   `INSERT ... SELECT`;
3. only after that copy, drops the unsafe globally deduplicated V1 derived rows;
   and
4. creates the V2 schema without a V2 schema marker.

The copy has no lifetime tombstone cap and returns no unbounded row set to the
host. A concurrent V1 purge either commits before this transaction and is copied,
or runs afterward against a non-V1 schema and cannot report success. Concurrent
V2 bootstraps converge on the one transition table.

While the transition table exists, `openOhLibSqlSemanticCacheV2` fails closed.
Bootstrap reads transition rows in fixed pages. Each page atomically creates the
V2 isolation and receipt for every legacy tombstone and deletes a transition row
only when the complete computed V2 custody record exists. A crash before a page
commit changes nothing; a crash after commit can replay safely. Live V1 heads,
generations, memberships, and vectors are deliberately invalidated because their
global vector identity cannot be assigned a private owner after the fact.

Finalization inserts the exact V2 schema marker only when the transition table
is empty, then drops that table in the same transaction. Until that commit,
neither a partially projected database nor a V2 runtime is accepted. Legacy
receipts use `countsRecorded: false`; new V2 purges use
`countsRecorded: true`.

The exact standalone schemas are
[revision 1](../v1/libsql-semantic-cache-schema-v1.sql) and
[revision 2](libsql-semantic-cache-schema-v2.sql). Fixed
[V1](../v1/libsql-semantic-digest-fixture-v1.json) and
[V2](libsql-semantic-digest-fixture-v2.json) fixtures make the incompatible
digest domains explicit. Hosted failure remains a
missing derived retrieval lane and MUST NOT weaken exact graph or Datalog
operations.
