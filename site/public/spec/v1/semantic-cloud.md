# Hosted semantic cache V1

`@hraness/oh/semantic-cloud` is a rebuildable retrieval adapter. It combines
one fixed Cloudflare Workers AI EmbeddingGemma profile with a separate direct
libSQL cache. It is not an Oh graph authority, and it adds no vector field to
an Oh record. It is also not a third memory lane: the composite memory facade
keeps its two stores, `canonical` and `working` (`OhMemoryLaneV1`).

## Profile and portability

The hosted profile is `oh.cloudflare.embeddinggemma.v1`. It uses model
`@cf/google/embeddinggemma-300m`, 768 dimensions, L2 normalization, and cosine
similarity. Queries use `task: search result | query: {query}`. Document chunks
use `title: {title} | text: {content}`.

The renderer greedily partitions content between Unicode scalar values. Every
complete formatted input is at most 448 UTF-8 bytes. When content does not fit,
the renderer reports it instead of dropping text. A document with some chunks
has status `partial` and diagnostic code `partial`. A document whose first
chunk cannot fit has status `oversize` and diagnostic code `oversize-prefix`.
The cache stager accepts only complete documents, at most 64 chunks per
document, 512 documents, and 4,096 chunks in one authority generation.

The profile digest and renderer digest identify the exact derived space.
Their complete canonical payloads and digests are published in
[`cloudflare-embedding-profile.json`](cloudflare-embedding-profile.json) and
[`cloudflare-embedding-renderer.json`](cloudflare-embedding-renderer.json).
Implementations MUST NOT mix vectors across either digest. A local quantized
implementation and a hosted implementation may use the same model family but
are not assumed to emit byte-identical or interchangeable vectors. The source
records are the portable authority. To change models, delete the index and
rebuild it.

## Provider requests

`OhCloudflareEmbeddingClientV1` sends one POST to the fixed Workers AI
account and model route. The batch size and response size are limited, and
redirects are rejected. Each request has a fixed deadline,
`AbortSignal.timeout(deadlineMs)`, where `deadlineMs` defaults to 15,000 and is
at most 30,000. A caller can also pass a `signal`, and the request stops at
whichever fires first.

The client accepts a response only when `success` is `true`, the result shape is
[n, 768] for n inputs, and every component is finite. It ignores extra keys. It
normalizes every finite nonzero vector.

An `OhCloudflareEmbeddingError` carries only a `code` (`aborted`,
`invalid-input`, `invalid-response`, or `provider-unavailable`) and an optional
HTTP `status`. Credentials and response bodies never enter an error. Invalid
constructor limits throw a `RangeError`.

The host owns the account, token, spend controls, privacy decision, and network
policy. Agent input MUST NOT select an account, endpoint, token, model, batch
limit, or profile. Source text is sent to the provider when it is embedded,
although the semantic cache does not store it.

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
retaining its plaintext. Access to the cache database needs protection too,
because its keys, record digests, generation timing, and vector geometry are
metadata.

Publishing never mutates a staged generation. Search pins one published head
and scans its chunks, at most 4,096, in fixed pages. It computes exact cosine
similarity in the application, keeps the best chunk per record, and rereads the
head. Every hit is matched against a current authority record digest that the
caller supplies. A stale head, changed authority digest, changed record digest,
concurrent publish, or purge returns no stale result.

`publishedHead` returns the current compare-and-swap base, or `null` for an
absent or purged authority. The base has exactly `authorityId`,
`authoritySha256`, `generation`, `generationSha256`, `membershipSha256`,
`profileSha256`, `publishedAt`, `rendererSha256`, and `v`. It exposes no vector,
record body, or formatted input. The read verifies that the pointer matches its
immutable generation and fails with an integrity error when it does not. It
also fails with an integrity error when the head disappears during the read,
and with a conflict error when the head changes during the read. A host can
read the base, stage a later generation, and pass the returned generation to
`publish` as `expectedPublishedGeneration`, without keeping a second cache
pointer elsewhere.

`purgeAuthority` writes a permanent tombstone, removes the head, memberships,
and staged generations, then deletes vectors no remaining authority uses. The
tombstone prevents the same authority ID from being staged or published again.
Hosts SHOULD include a session epoch in the authority ID and allocate a
different ID for each separate lifetime.

## Failure and lifecycle rules

Hosted semantic failure MUST NOT weaken exact graph or Datalog operations. A
consumer may return semantic-unavailable or omit semantic results from recall.
It keeps the authoritative remember, exact query, read, and explanation
operations intact.

For a purgeable working authority, the lifecycle worker MUST stop further
writes, purge the derived semantic authority, then purge the authoritative
working store. It acknowledges completion only after both operations have
converged. Both purges are idempotent. A failed cache purge can be retried, and
it MUST NOT be reported as complete merely because the authority purge
succeeded.
