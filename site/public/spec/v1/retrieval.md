# Search and local reranking

Oh search reads authoritative records through rebuildable indexes. It never
writes records or installs a model as a side effect of a query.

## Default selection

In SDK version 0.12.0, an omitted search or recall mode selects `rerank` when a
reranker is configured, `hybrid` when only a semantic backend is configured,
and `keyword` otherwise. Explicit `keyword`, `semantic`, `hybrid`, and `rerank`
requests are also accepted. The response reports the resolved mode.

The command-line store opens without model backends, so its ordinary search
uses keyword retrieval. Applications configure local models through the SDK.
Configuring a backend is a choice about local resources. It is not an
experimental feature flag.

## Candidate selection

Reranking normalizes the lexical query with the fixed English normalization
profile while preserving the original query for semantic retrieval and the
cross-encoder. Each candidate lane defaults to 30 records, configurable from
1 through 60. Their union keeps the ranking evidence from both lanes. The result
limit is 1 through 100, default 10, and it does not enlarge either candidate
pool. Fewer candidates can produce fewer results.

Each candidate uses the SDK’s `recordDocument` representation. Model scores
order the complete pool, descending, with code-unit record-key ordering for
ties. The implementation rejects missing, duplicate, foreign, or nonfinite
scores before accepting a ranking. Before results return, Oh compares each
record identity with the current store.

## Local backend

The [reranker profile](rerank-profile.json) pins QMD 2.5.3 and the
Qwen3-Reranker-0.6B Q8_0 model by SHA-256. The caller supplies a local GGUF file.
The backend verifies model identity and checks query, document, and formatted
pair token lengths against the 4,096-token context before ranking any pair.
Oversized requests fail without silently truncating their text.

The backend loads lazily, serializes its operations, and drains them before
disposing model resources. The SDK drains accepted searches and recalls before
closing its backends and store. A repeated close observes the same outcome.

## Availability and failure

Without semantic search, reranking can use the lexical pool and reports
`semantic-unavailable`. If the reranker is unavailable or returns an invalid
ranking, the result keeps the fused retrieval order and reports
`rerank-unavailable`. Consumers requiring either capability must check these
diagnostics. An empty candidate pool requires no reranker call.

A fallback result does not show that the requested model ran. Model scores
express relevance under one profile. They do not establish that a memory is
true or grant permission to accept it. Mutations keep their own authorization
and compare-and-swap contracts.

## Evaluation scope

The earlier CloneMem reserved-persona study uses a benchmark-specific source
renderer and captured semantic rankings. A separate SDK evaluation uses
`Oh.search` and its record renderer on 146 previously exposed development
questions, with replayed semantic rankings and a local reranker. Its measured
latency excludes semantic inference, and its report records a handled native
initialization diagnostic.

Neither study establishes performance for an arbitrary embedding backend or
consumer application, or superiority over another memory framework. Compare
the actual application pipeline with matched context, reader, and scoring
settings, and report failures and latency alongside quality. See the
[SDK retrieval evaluation report](https://github.com/hraness/oh/blob/main/benchmarks/SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md)
for the protocol, results, and limitations.
