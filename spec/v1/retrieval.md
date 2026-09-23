# Search and local reranking

Oh search reads authoritative records through rebuildable indexes. It never
writes records or installs a model as a side effect of a query.

## Default selection

In SDK version 0.12.0, an omitted search or recall mode selects `rerank` when a
reranker is configured, `hybrid` when only a semantic backend is configured,
and `keyword` otherwise. Explicit `keyword`, `semantic`, `hybrid`, and `rerank`
requests remain available. The response reports the resolved mode.

The command-line store opens without model backends, so its ordinary search
uses keyword retrieval. Applications configure local models through the SDK.
Configuring a backend is a resource decision, not an experimental feature flag.

## Candidate selection

Reranking normalizes the lexical query with the fixed English normalization
profile while preserving the original query for semantic retrieval and the
cross-encoder. Each candidate lane defaults to 30 records, configurable from
1 through 60. Their union retains both lanes' ranking evidence. The result
limit remains 1 through 100, default 10; it does not enlarge either candidate
pool. Fewer candidates can produce fewer results.

Each candidate uses the SDK's `recordDocument` representation. Model scores
order the complete pool, descending, with code-unit record-key ordering for
ties. The implementation rejects missing, duplicate, foreign, or nonfinite
scores before accepting a ranking. Record identities are checked against the
current store before results return.

## Local backend

The [reranker profile](rerank-profile.json) pins QMD 2.5.3 and the
Qwen3-Reranker-0.6B Q8_0 model by SHA-256. The caller supplies a local GGUF file.
The backend verifies model identity and admits query, document, and formatted
pair token lengths against the 4,096-token context before ranking any pair.
Oversized requests fail without silently truncating their text.

The backend loads lazily, serializes its operations, and drains them before
disposing model resources. The SDK drains accepted searches and recalls before
closing its backends and store. A repeated close observes the same outcome.

## Availability and failure

Without semantic search, reranking can use the lexical pool and reports
`semantic-unavailable`. If the reranker is unavailable or returns an invalid
ranking, the result retains the fused retrieval order and reports
`rerank-unavailable`. Consumers requiring either capability must check these
diagnostics. An empty candidate pool requires no reranker call.

Fallback preserves useful reads; it is not evidence that the requested model
ran. Model scores express relevance under one profile, not truth or permission
to accept a memory. Mutations retain their own authorization and compare-and-swap
contracts.

## Evaluation scope

The CloneMem study uses a benchmark-specific source renderer and captured
semantic rankings. Its numerical results are not a guarantee for the SDK's
record renderer, an arbitrary embedding backend, or a consumer application.
Compare the actual application pipeline with matched context, reader, and
scoring settings; report failures and latency alongside quality.
