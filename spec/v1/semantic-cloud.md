# Hosted semantic cache V1

`@hraness/oh/semantic-cloud` is a rebuildable retrieval adapter. It combines
one fixed Cloudflare Workers AI EmbeddingGemma profile with a separate direct
libSQL cache. It is not an Oh graph authority, a third memory lane, or a vector
field in an Oh record.

## Profile and portability

The hosted profile is `oh.cloudflare.embeddinggemma.v1`. It uses model
`@cf/google/embeddinggemma-300m`, 768 dimensions, L2 normalization, and cosine
similarity. Queries use `task: search result | query: {query}`. Document chunks
use `title: {title} | text: {content}`.

The renderer greedily partitions content on Unicode-scalar boundaries. Every
complete formatted input is at most 448 UTF-8 bytes. It exposes partial or
overlarge-prefix diagnostics instead of silently dropping text. The cache
stager accepts only complete documents, at most 64 chunks per document, 512
documents, and 4,096 chunks in one authority generation.

The profile digest and renderer digest identify the exact derived space.
Their complete canonical payloads and digests are published in
[`cloudflare-embedding-profile.json`](cloudflare-embedding-profile.json) and
[`cloudflare-embedding-renderer.json`](cloudflare-embedding-renderer.json).
Implementations MUST NOT mix vectors across either digest. A local quantized
implementation and a hosted implementation may use the same model family but
are not assumed to emit byte-identical or interchangeable vectors. Portable
authority comes from the source records: deleting and rebuilding an index is
the model-migration path.

## Provider boundary

`OhCloudflareEmbeddingClientV1` sends one bounded POST to the fixed Workers AI
account/model route, rejects redirects, applies a caller-cancellable deadline,
and accepts only the exact successful shape. It validates and normalizes every
finite nonzero vector. Errors retain only a fixed classification and optional
HTTP status; credentials and response bodies do not enter an error.

The host owns the account, token, spend controls, privacy decision, and network
policy. Agent input MUST NOT select an account, endpoint, token, model, batch
limit, or profile. Source text necessarily crosses the provider boundary when
it is embedded, even though it is not persisted in the semantic cache.

## Derived libSQL cache

Schema creation is an explicit deployment operation through
`bootstrapOhLibSqlSemanticCacheV1`. `openOhLibSqlSemanticCacheV1` verifies the
complete schema inventory and performs no DDL. Applications SHOULD use a
short-lived schema credential and separate runtime/purge credentials.

The current derived-cache schema revision is 2. Bootstrap upgrades an exact
revision-1 inventory, but deliberately invalidates its live heads,
generations, memberships, and vectors: they were globally deduplicated and
cannot be assigned a private isolation after the fact. Permanent revision-1
purge tombstones survive as revision-2 receipts with `countsRecorded: false`.
Any partial or drifted inventory fails closed. The exact legacy DDL used by the
migration conformance test is
[`libsql-semantic-cache-schema-v1.sql`](libsql-semantic-cache-schema-v1.sql).

The cache stores:

- normalized vectors as exact 3,072-byte little-endian float32 blobs;
- vector digests keyed by private isolation, profile, renderer, and
  formatted-input digest;
- an immutable assignment of every isolation digest to one authority;
- immutable record/chunk membership for staged authority generations;
- one compare-and-swap published generation per authority; and
- permanent authority purge tombstones.

It stores no title, source content, query, page body, record JSON, account ID,
or provider token. A formatted-input digest permits vector reuse within one
isolation without retaining its plaintext. Cache database access still
deserves protection: its keys, record digests, generation timing, raw vector
checksums, and vector geometry are metadata.

`isolationSha256` is an opaque, host-controlled SHA-256 digest. A host SHOULD
derive it from the private authority handle, cache epoch, and exact profile
identity, then pass it unchanged to `stage`, `publish`, `publishedHead`,
`search`, `purgeAuthority`, and `purgeReceipt`. Oh never places it in renderer
or provider text. The generation digest, membership digest, published head,
stored membership, and vector primary key all bind it. One isolation can be
reserved by only one authority; one authority may rotate through more than one
isolation. Identical rendered text in different authorities or epochs is
embedded and stored separately, so it cannot create reuse or deletion
coupling. Raw vector byte equality remains visible to a database holder and is
not a confidentiality boundary.

For compatibility, omission derives
`SHA-256(canonicalJson({authorityId,kind:"oh.semantic-authority-isolation.v1",v:1}))`.
That default is private across distinct authority IDs. Private hosted systems
SHOULD still supply their own digest so authority capabilities and cache epochs
do not have to appear in the public authority ID.

Publishing never mutates a staged generation. Search pins one published head,
scans at most its bounded 4,096 chunks in fixed pages, computes exact cosine in
the application, keeps the best chunk per record, and rereads the head. Every
hit is rejoined to a caller-supplied current authority record digest. A stale
head, changed authority digest, changed record digest, concurrent publish, or
purge returns no stale authority.

`publishedHead` returns the current compare-and-swap base or `null` for an
absent, purged, or isolation-mismatched authority. Its bounded projection
contains only the authority, isolation, generation, profile, renderer,
membership, generation and publication identities already held by the cache;
it exposes no vector, record body or formatted input. The read verifies that
the pointer still matches its immutable generation and fails with an integrity
error on divergence. A host can read the base, stage a later authoritative
generation, and pass the returned generation to `publish` without keeping a
second cache pointer elsewhere.

`purgeAuthority` binds the caller's isolation, writes a permanent tombstone,
removes the head, memberships, and staged generations, then deletes every
vector in every isolation reserved by that authority. It verifies that no
head, generation, membership, or scoped vector remains. The tombstone prevents
the same authority ID from being staged or published again. Hosts SHOULD
include a session epoch in the authority ID and allocate a new ID for a
genuinely new lifetime.

The first purge stores its removal counts and returns a content-free
`OhSemanticPurgeResultV1`. It includes authority, requested isolation, fixed
profile, the formerly published generation and generation digest when one
existed, first-run counts, `purgedAt`, three zero residual proofs, a stable
`purgeMarkerSha256`, and a canonical `purgeReceiptSha256`. A replay returns the
same receipt even though a second deletion would affect zero rows.
`purgeReceipt` performs the same isolation check and zero-residual proof without
issuing deletes. A mismatched isolation is a conflict, not evidence of purge.

## Failure and lifecycle rules

Hosted semantic failure MUST NOT weaken exact graph or Datalog operations. A
consumer may return semantic-unavailable or omit the recall lane while keeping
authoritative remember, exact query, read, and explanation operations intact.

For a purgeable working authority, the lifecycle worker MUST stop new writes,
purge the derived semantic authority, then purge the authoritative working
store. It acknowledges completion only after both operations have converged.
Both purges are idempotent. A failed cache purge remains retryable and MUST NOT
be reported as complete merely because the authority purge succeeded.
