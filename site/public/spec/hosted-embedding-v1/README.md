# Precomputed hosted embeddings

`OhHostedSemanticBackendV2` searches an immutable set of precomputed vectors
through Oh's existing SQLite search API. An application must supply the complete
snapshot explicitly. The backend makes no network requests, holds no credentials,
and owns no files or provider process. SQLite records remain authoritative.

The [manifest](manifest.json) binds the [profile](profile.json) and
[snapshot schema](snapshot.schema.json). This profile is separate from local QMD
and the hosted libSQL semantic cache. Existing profiles and default search
behavior are unchanged.

## Profile and rendering

The profile names Vercel AI Gateway's `openai/text-embedding-3-small` alias,
OpenAI as the sole provider, 1536 dimensions, float vectors, explicit L2
normalization and cosine similarity. A model alias does not identify immutable
provider weights. Provider qualification and comparisons must report that limit.
[Gateway embeddings](https://vercel.com/docs/ai-gateway/modalities/embeddings)
describes the compatible embedding endpoint.

A document is the exact output of Oh's `recordDocument` renderer:

```text
# {record.key}

kind: {record.kind}

{canonical JSON of record.value}
```

The renderer includes a final newline. Split only oversized documents into
contiguous chunks of at most 4096 UTF-8 bytes, ending at Unicode scalar boundaries.
Keep every byte, with no overlap or truncation. Queries are the exact nonempty
Unicode scalar string, limited to 8192 UTF-8 bytes; apply no prefix or normalization.
Document and query roles have separate vector bindings, even for identical text.

Normalize each complete 1536-component finite nonzero vector to unit length.
For each current record, take its highest chunk cosine score. Sort descending
by score, breaking ties by the ASCII record key. A record whose current SQLite
digest differs from the snapshot is excluded. Oh retains its existing keyword
and semantic rank fusion for hybrid search.

## Snapshot contract

A snapshot contains sorted record references and query hashes, embeddings, and
settlement receipts. Record entries bind the record digest, rendered-document
digest, and every chunk's byte range and exact input hash. Query entries bind
the exact query hash. Each embedding is referenced exactly once by one chunk or
query and by one input position in a receipt. Receipt positions are complete:
there are no missing, repeated or unreferenced vectors. Query hashes and record
keys are unique and sorted. Receipt request and settlement hashes are unique.

`sourceSha256` is the canonical SHA-256 of this object, with records in key order:

```json
{"protocol":"oh.semantic-hosted-source.v1","records":[{"key":"edition:example","recordSha256":"..."}]}
```

A snapshot admits at most 4096 records, 4096 embeddings and 1024 queries. Each receipt
covers at most 128 inputs. Document chunks together are bounded to 16 MiB of input;
source validation is bounded to 32 MiB and the snapshot to 128 MiB of canonical JSON.
The repository preparation module also includes query bytes in its 16 MiB input
limit. Vector squared magnitude must differ from 1 by at most 0.000001. Known cost
must not exceed the receipt's reservation. All wire objects have exact keys;
nonfinite numbers, negative zero, sparse arrays and accessor properties are invalid.

Wire traversal is bounded to depth 32 and 8 million nodes. A settlement is
bounded to 32 KiB. Source envelopes and rendered documents each have a 32 MiB
limit.

The runtime parser enforces cross-reference, canonical-order, byte and numeric
rules beyond what JSON Schema can express. `index(records)` additionally rerenders
the complete supplied records and verifies every document/chunk binding before
search becomes available. A failed index validation invalidates earlier index
readiness. `close()` prevents further indexing and search.

A receipt contains authority, request, raw-response and settlement hashes, exact
ordered input hashes, role, profile, known cost, reservation and service latency.
Those pins preserve provenance; hashes alone do not authenticate a provider call
or spending authority. The caller must verify them against its immutable captured
response and settled ledger before admitting a snapshot. Source validation proves
that vectors bind the source inputs, not that the provider produced correct vectors.

## Use with Oh

```ts
import { Oh } from "@hraness/oh/sdk";
import { OhHostedSemanticBackendV2 } from "@hraness/oh/semantic";

// Authenticate the complete snapshot and its ledger receipts first.
const backend = new OhHostedSemanticBackendV2(snapshot);
const oh = Oh.open({ databasePath: "example.sqlite", semanticBackend: backend });
try {
  await oh.indexSemantic(); // Records must exactly match the snapshot's source.
  const result = await oh.search(exactPreparedQuery, { mode: "hybrid", limit: 10 });
  // Inspect diagnostics: ordinary Oh search retains its existing fallback behavior.
} finally {
  await oh.close();
}
```

Snapshot preparation and storage belong to the caller. Loading a snapshot does
not authorize inference, open a hosted service, or download a model. The constructor
accepts parsed data and detaches it before use; persist the exact snapshot bytes
and hash if the same vectors must be reused later. QMD caches are incompatible.

## Repository experiment boundary

`scripts/benchmarks/evolution-hosted-embedding.ts` provides a source-only workload
planner and a preparation function requiring an injected metered embedding
function. There is no default provider. The planner binds the profile, authority,
source, every complete chunk/query input, batch order and byte counts before any
call. Batches contain at most 128 inputs and 128 KiB of UTF-8 text; concurrency is
explicitly bounded from 1 through 4.

The injected function must reserve durably before dispatch, make exactly one
physical request without retries, authenticate the complete raw response including
route and usage, settle it, and return its vectors and receipt. It owns request
deadlines and cancellation drain. An unresolved or malformed response retains
its reservation and occupied request identity in that ledger. The preparer does
not reinterpret a failure as zero cost or release a reservation.

On failure, preparation stops new batches and waits for all started invocations.
It exposes completed settlement receipts in `HostedEmbeddingPreparationError`
and produces no complete snapshot. Attempted callback invocations are separate
from authenticated physical-call totals. The caller's ledger remains the source
for complete known and unresolved accounting.

The corpus adapter whitelists original dated turn fields before ingestion; it
never reads benchmark gold-answer fields or evidence labels. Retrieval uses actual
Oh SQLite records and `searchOhV1`, with top 100 and 96000 bytes of whole original
turns packed in retrieval order. Semantic and hybrid modes share the exact query
vector. A missing vector or semantic diagnostic fails the experiment instead of
accepting keyword fallback. Results use `oh.evolution-hosted-context.v1`, with
source, profile, snapshot, query, mode and complete context bindings. Its validator
replays only local ranking and packing with those same precomputed vectors.

This experiment does not enter the existing QMD or full-release benchmark plans.
A paid study needs a separately reviewed provider/ledger adapter, authority,
preflight and launch. Source and fake-provider tests establish the local data path;
provider latency, cost and retrieval quality require their own measured evaluation.

Run the offline focused proof from a repository checkout:

```sh
bun test src/semantic-hosted.test.ts tests/memory-benchmark-evolution-hosted-embedding.test.ts
```
