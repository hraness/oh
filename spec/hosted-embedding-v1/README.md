# Precomputed hosted embeddings

`OhHostedSemanticBackendV2` searches an immutable set of precomputed vectors
through Oh’s SQLite search API. An application must supply the complete
snapshot explicitly. The backend makes no network requests, holds no
credentials, and owns no files or provider process. The SQLite records are the
authority.

The [manifest](manifest.json) pins the [profile](profile.json) by digest and
names the [snapshot schema](snapshot.schema.json) by path. This profile is
separate from local QMD and the hosted libSQL semantic cache. It does not change
other profiles or default search behavior.

## Profile and rendering

The profile names Vercel AI Gateway’s `openai/text-embedding-3-small` alias,
OpenAI as the provider, 1536 dimensions, float vectors, explicit L2
normalization and cosine similarity. The profile records these as the fields
`gateway` and `provider`. Oh contains no gateway adapter and does not check
where a vector came from. A model alias does not identify immutable provider
weights. Provider evaluations and comparisons must report that limit.
[Gateway embeddings](https://vercel.com/docs/ai-gateway/modalities/embeddings)
describes the compatible embedding endpoint.

A document is the exact output of Oh’s `recordDocument` renderer:

```text
# {record.key}

kind: {record.kind}

{canonical JSON of record.value}
```

The renderer includes a final newline. Split only oversized documents into
contiguous chunks of at most 4096 UTF-8 bytes, each ending between Unicode
scalar values. Keep every byte, with no overlap or truncation. A query is the
exact nonempty Unicode scalar string, limited to 8192 UTF-8 bytes. Apply no
prefix or normalization to it. Document and query roles have separate vector
bindings, even for identical text.

Every stored vector has 1536 finite components and unit length. The backend
does not normalize vectors. It rejects a vector whose squared magnitude differs
from 1 by more than 0.000001. The repository preparation module normalizes each
finite nonzero vector before it builds a snapshot. For each current record,
search takes the highest chunk cosine score. It sorts by descending score and
breaks ties by the ASCII record key. A record whose current SQLite digest
differs from the snapshot is excluded. Hybrid search uses Oh’s usual keyword
and semantic rank fusion.

## Snapshot contract

A snapshot contains sorted record references and query hashes, embeddings, and
receipts. A receipt is an `OhHostedSettlementV1` object: the caller’s record of
one settled provider call. Record entries bind the record digest,
rendered-document digest, and every chunk’s byte range and exact input hash.
Query entries bind the exact query hash. Each embedding is referenced exactly
once by one chunk or query and by one input position in a receipt. Receipt
positions are complete: there are no missing, repeated or unreferenced vectors.
Query hashes and record keys are unique and sorted. Receipt request and
settlement hashes are unique.

`sourceSha256` is the canonical SHA-256 of this object, with records in key
order:

```json
{"protocol":"oh.semantic-hosted-source.v1","records":[{"key":"edition:example","recordSha256":"..."}]}
```

A snapshot accepts at most 4096 records, 4096 embeddings, 4096 receipts and 1024
queries. The records, queries, embeddings and receipts arrays each hold at least
one item. Each receipt covers at most 128 inputs. Document chunks together are
limited to 16 MiB of input. Source validation is limited to 32 MiB and the
snapshot to 128 MiB of canonical JSON. The repository preparation module also
counts query bytes in its 16 MiB input limit. Vector squared magnitude must
differ from 1 by at most 0.000001. Known cost must not exceed the receipt’s
reservation. All wire objects have exact keys. Nonfinite numbers, negative zero,
sparse arrays and accessor properties are invalid.

Wire traversal is limited to depth 32 and 8 million nodes. A settlement is
limited to 32 KiB. The source envelope has a 32 MiB limit, and the rendered
documents together have a 32 MiB limit.

The runtime parser enforces cross-reference, canonical-order, byte and numeric
rules beyond what JSON Schema can express. `index(records)` also rerenders
the complete supplied records and verifies every document and chunk binding
before search becomes available. A failed index validation makes the backend
unavailable for search, even if an earlier index succeeded. `close()` prevents
further indexing and search.

A receipt contains authority, request, raw-response and settlement hashes,
exact ordered input hashes, role, profile, known cost, reservation, service
latency, and `physicalCalls`, which is always 1. These fields record provenance.
Hashes alone do not authenticate a provider call or spending authority. The
caller must verify them against its immutable captured response and settled
ledger before it accepts a snapshot. Source validation proves that the vectors
are bound to the source inputs. It does not prove that the provider produced
correct vectors.

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
not authorize inference, open a hosted service, or download a model. The
constructor accepts parsed data and detaches it before use. Persist the exact
snapshot bytes and hash if the same vectors must be reused later. QMD caches are
incompatible.

## Repository experiment

`scripts/benchmarks/evolution-hosted-embedding.ts` provides a source-only
workload planner and a preparation function requiring an injected metered
embedding function. There is no default provider. The planner binds the profile,
authority, source, every complete chunk and query input, batch order and byte
counts before any call. A batch holds only document inputs or only query inputs,
with at most 128 inputs and 128 KiB of UTF-8 text. Concurrency defaults to 1 and
can be set from 1 through 4.

The injected function must reserve durably before dispatch, make exactly one
physical request without retries, authenticate the complete raw response
including route and usage, settle it, and return its vectors and receipt. It
owns request deadlines and cancellation drain. An unresolved or malformed
response retains its reservation and occupied request identity in that ledger.
The preparer does not reinterpret a failure as zero cost or release a
reservation.

On failure, preparation stops starting batches and waits for all started
invocations. `HostedEmbeddingPreparationError` exposes, as `settledReceipts`,
the receipts of batches whose response passed full validation. It produces no
complete snapshot. Attempted callback invocations are counted separately from
authenticated physical-call totals. The caller’s ledger is the source for
complete known and unresolved accounting.

The corpus adapter copies only the original dated turn fields before ingestion.
It never reads benchmark gold-answer fields or evidence labels. Retrieval uses
Oh SQLite records and `searchOhV1`, with top 100 and 96000 bytes of whole
original turns packed in retrieval order. Semantic and hybrid modes share the
exact query vector. A missing vector or semantic diagnostic fails the experiment
instead of accepting keyword fallback. Results use
`oh.evolution-hosted-context.v1`, with source, profile, snapshot, query, mode
and complete context bindings. Its validator replays only local ranking and
packing with those same precomputed vectors.

This experiment is not part of the QMD or full-release benchmark plans. A paid
study needs a separately reviewed provider and ledger adapter, authority,
preflight and launch. Source and fake-provider tests cover the local data path.
Provider latency, cost and retrieval quality need their own measured
evaluation.

Run the offline focused proof from a repository checkout:

```sh
bun test src/semantic-hosted.test.ts tests/memory-benchmark-evolution-hosted-embedding.test.ts
```
