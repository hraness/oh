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

The cache stores:

- normalized vectors as exact 3,072-byte little-endian float32 blobs;
- vector digests keyed by profile, renderer, and formatted-input digest;
- immutable record/chunk membership for staged authority generations;
- one compare-and-swap published generation per authority; and
- permanent authority purge tombstones.

It stores no title, source content, query, page body, record JSON, account ID,
or provider token. A formatted-input digest permits vector reuse without
retaining its plaintext. Cache database access still deserves protection: its
keys, record digests, generation timing, and vector geometry are metadata.

Publishing never mutates a staged generation. Search pins one published head,
scans at most its bounded 4,096 chunks in fixed pages, computes exact cosine in
the application, keeps the best chunk per record, and rereads the head. Every
hit is rejoined to a caller-supplied current authority record digest. A stale
head, changed authority digest, changed record digest, concurrent publish, or
purge returns no stale authority.

`purgeAuthority` writes a permanent tombstone, removes the head, memberships,
and staged generations, then deletes vectors no remaining authority uses. The
tombstone prevents the same authority ID from being staged or published again.
Hosts SHOULD include a session epoch in the authority ID and allocate a new ID
for a genuinely new lifetime.

## Failure and lifecycle rules

Hosted semantic failure MUST NOT weaken exact graph or Datalog operations. A
consumer may return semantic-unavailable or omit the recall lane while keeping
authoritative remember, exact query, read, and explanation operations intact.

For a purgeable working authority, the lifecycle worker MUST stop new writes,
purge the derived semantic authority, then purge the authoritative working
store. It acknowledges completion only after both operations have converged.
Both purges are idempotent. A failed cache purge remains retryable and MUST NOT
be reported as complete merely because the authority purge succeeded.
