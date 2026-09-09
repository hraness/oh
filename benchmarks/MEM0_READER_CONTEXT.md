# Mem0 reader context adapter

`scripts/benchmarks/mem0-reader-context.ts` packs the existing Mem0 worker search
projection into a context for a separately authenticated reader request. It is a
pure adapter: it opens no files, parses no scorer labels, and invokes no provider
or ledger operation. The Oh retrieval and reader protocols remain unchanged.

The admitted worker projection has exactly `results`, containing up to 50 rows
with `memory` and `metadata`. Metadata has exactly `chunkId` and `sourceDigest`.
Every row must refer to an admitted source chunk with its current digest. Every
memory is bounded UTF-8 text; the complete projection is bounded at 1 MiB. Validation
includes rows subsequently omitted for size. Unsupported fields fail closed.

The current bridge omits SDK memory IDs, scores and `user_id`. The adapter does
not reconstruct them or assert their uniqueness. It preserves the exact returned
array order, including repeated projections. Each output row has a rank and a
derived occurrence ID, explicitly distinct from an SDK memory ID. Duplicate
projections are counted and retained.

Use `makeMem0ReaderSearchBinding` after authenticating the original source
artifact, completed search receipt, worker, runtime and execution source. Its
`pins` argument contains six SHA-256 values:

- `sourceArtifactSha256`: the exact qualified source-receipt file bytes.
- `querySha256`: the exact search query text, which must also match the reader question.
- `workerSha256` and `runtimeSha256`: the worker file and verified runtime receipt.
- `executionSourceSha256`: the source identity used for the search.
- `searchReceiptSha256`: the exact completed search-receipt file bytes.

The function validates the corpus and model policy, reconstructs the existing
derivation receipt, and binds its namespace and digests to the canonical search
result. `sourceReceiptSha256` inside this binding retains the existing corpus
field's meaning: the original full-history context-plan file digest. It differs
from the outer source artifact file digest.

The I/O owner must verify that the pinned worker and search receipt used the
fixed top 50, threshold 0.1, no-reranker search and the same namespace and query.
Pins alone do not prove that a worker ran or that an artifact is authentic. The
adapter cannot recover checks for fields absent from the original projection.

Persist and pin the binding, then call:

```ts
const context = packMem0ReaderContext({
  corpus, policy, result, binding,
  expectedBindingSha256: canonicalSha256(binding),
  contextBytes: 48_000, // Or 96_000, fixed before comparison.
});
```

Packing retains a prefix of whole memories in SDK order. At the first memory
that cannot fit, that row and all later rows are omitted. Headers and separators
count toward the exact UTF-8 budget. Text is never truncated, reordered or
deduplicated. The output records included and omitted rows, byte counts, hashes,
the binding and the packing policy. An empty result produces an empty context.

Reader text is labeled model-derived memory and contains only those retrieved
memory strings with derived row labels. Original source turns, metadata digests,
SDK timestamps and scorer fields are not added to the text. Chunk membership
establishes an attribution boundary; it does not prove factual correctness,
entailment, or that a chunk lists all evidence used to update a memory. Derived
row labels are not original-source citations and must not be scored as those.

Focused checks cover deterministic packing, exact UTF-8 limits, rank-prefix
omission, duplicate projections, malformed and foreign provenance, no source or
gold rendering, and independent artifact/query/runtime binding. They establish
adapter behavior, not live Mem0 accuracy or superiority.

The two `tests/fixtures/mem0-reader-context-sdk-*-v1.json` files retain the exact
input and result bytes from a one-chunk synthetic run using Mem0 2.0.20 at
commit `9a7924befd7026e41e445ba809370009e5e985a6` and local Qdrant 1.19.0. The
worker used deterministic fake RPC responses with network sockets blocked; it
made no provider calls. The captured result is joined against its validated
source chunk without changing memory or metadata. This fixture qualifies the
current projection shape and adapter join. It does not authenticate a future
live search or establish model quality.
