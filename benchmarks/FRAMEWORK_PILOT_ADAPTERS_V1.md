# Framework pilot adapters V1

These benchmark helpers run fresh local retrieval, describe one bounded
Supermemory case, and define shared reader routes. They build on the
[source and context contracts](FRAMEWORK_PILOT_SOURCE_V1.md). They do not report
a matched framework quality result or activate a paid campaign.

## Common inputs

Each adapter validates the source bundle against the exact source projection and
UTF-8 split plan. The source retains authored text, roles, dates, session
equivalence and occurrence order. The common content is canonical JSON of each
unit without its `unitSha256` field; the digest is bound separately. The local
SDK adds its normal record wrapper for indexing. Supermemory adds its documented
transport fields. Neither adapter reads a benchmark answer or evidence label.

The source contract proves preservation relative to the supplied projection.
Connecting that projection to the complete raw dataset remains a separate
step. Native model admission must also establish that every actual query and
wrapped document fits the selected model. A byte bound does not establish a
token bound.

The [pinned tokenizer](FRAMEWORK_PILOT_TOKENIZER_V1.md) counts complete rendered
context strings. Its 8,192-token ceiling includes JSON escaping, metadata and
separators. It does not measure the complete reader request or replace the
request's monetary reservation.

## Fresh Oh and BM25 retrieval

[`runFrameworkPilotLocalV1`](../scripts/benchmarks/framework-pilot-local-v1.ts)
creates a new in-memory Oh store, BM25 index and private cache child. It ingests
every validated source unit, verifies the authority snapshot, indexes it once,
and calls `Oh.search(query, { limit: 20 })` with configured semantic and rerank
backends. It supplies no search-mode override. Queries retain their input order.

The BM25 baseline uses the same canonical unit content, SQLite FTS5 with
`unicode61 remove_diacritics 2`, and Oh's declared lexical normalization. It
quotes normalized terms, joins them with `OR`, and breaks score ties by source
ordinal. Empty normalized queries return no lexical hits.

Both arms join results to exact unit and current record digests. The Oh arm
records its selected mode, diagnostics, semantic and rerank calls, and timing.
A fallback is `unqualified-fallback`, even when it returns useful source hits.
Incomplete indexing or an authority change fails the case. Query failures and
queries not attempted remain in the result.

Backend factories are explicit dependencies. This module does not download or
load models, prove their provenance, enforce their process lifetime, or qualify
a native backend from a callback's profile assertion. It drains acquired
resources before removing its cache; a failed close retains that cache and
records the failure. Initialization, ingestion, indexing, search and cleanup
times remain separate.

## Supermemory retrieval and cleanup

[`prepareFrameworkPilotSupermemoryV1`](../scripts/benchmarks/framework-pilot-supermemory-v1.ts)
validates a complete case before transport work. Each source unit becomes one
document in a fresh namespace. Provider dates come from an explicit mapping
bound to the source digest and occurrence; authored dates remain unchanged in
the content. The caller declares `instant` or `dynamic` dreaming when preparing
the case. This input profile differs from session-level ingestion.

The fixed `hybrid-rerank-20.v1` search profile uses v4 hybrid search, limit 20,
threshold 0.6 and reranking. Query rewriting and aggregation are off. Document
references are requested; related memories, summaries, extra chunks and
forgotten memories are off. Reranking is a supported relevance option and a
separately billed operation. These settings are a declared comparison profile,
not a claim about Supermemory's defaults or its best possible configuration.
See the [v4 search reference](https://supermemory.ai/docs/api-reference/recall-search/search-memory-entries)
and [provider pricing](https://supermemory.ai/pricing/).

The runner requires a permanent namespace claim and durable request intent
before dispatch. The supplied transport must enforce the exact target,
deadline, response limit, zero redirects and zero automatic retries, and close
the connection before returning or throwing. These are requirements on an
external transport; this module does not implement or attest that transport.

All documents must have both document and dreaming completion, with an exact
source echo, before the one search. Readiness is bounded from each pre-dispatch
intent, including upload time and waiting behind other uploads. Request counts,
response bytes, polls, work and cleanup have separate explicit limits. A plan
may contain at most 2,000 documents and declare at most 2,000 memory entries,
with cleanup capacity reserved for those bounds. Those limits do not prove that a particular dataset case
will fit. Request counts exclude provider-internal work and are not a cash cap.

Results distinguish `provider-generated-memory` from
`provider-document-chunk`. Returned document references join to accepted source
units, but neither result kind is claimed to be authenticated original text.
They must not be relabeled as source-unit Recall@20. A subsequent renderer must
retain the evidence kind when preparing a common reader context.

Cleanup requires complete scoped inventories and ownership checks. It deletes
only the owned namespace, checks known document IDs for absence, and observes
two empty inventories separated by the declared delay. Uncertain writes retain
their identities for reconciliation. Scoped absence does not prove physical
erasure, cancellation of internal work or final billing settlement.

## Reader and judge routes

The [model catalog](../scripts/benchmarks/evolution-model.ts) adds three explicit
profiles without changing the identities of older profiles:

| Profile | Request route | Output ceiling |
| --- | --- | ---: |
| `gpt4o-20240806-framework-pilot-v1-reader` | Direct `gpt-4o-2024-08-06` | 512 |
| `gpt4o-gateway-framework-pilot-v1-reader` | Gateway `openai/gpt-4o`; requires reported resolution to `gpt-4o-2024-08-06` | 512 |
| `gpt4o-gateway-framework-pilot-16-v1-judge` | Same Gateway route and resolution requirement | 16 |

Each uses temperature 0, one user message, no streaming and no model fallback.
The existing direct snapshot judge retains its 10-token ceiling. The Gateway
judge's 16-token ceiling is an explicit operational departure: the earlier
10-token Gateway treatment remains blocked for new dispatch after its recorded
provider rejection.

An accepted Gateway response remains an alias request with
`snapshotPinned: false`, even when its reported resolution matches. Missing or different
resolution fails validation. Route availability and account authority require
separate live evidence. The constructor neither discovers credentials nor
dispatches requests. All routes retain the existing shared spending ledger,
first-response capture, conservative reservations and usage checks.

## Validation and remaining campaign work

Synthetic contract tests cover source joins, complete ingestion, default SDK
selection, fallback diagnostics, lifecycle failures, bounded provider responses,
uncertain writes and owned cleanup. Tokenizer qualification compares its counts
against the pinned official implementation. These checks do not establish live
retrieval quality or the fairness of a complete campaign by themselves.

A campaign still needs a frozen population and exposure record, a verified raw
source bridge, native model and common split-plan admission, a qualified live
provider transport, account-specific funding, a shared evidence renderer and
reader prompt, separate gold access, and reporting over every intended case.
Capture all retrieval contexts or failures before opening gold for judging.
Keep ingestion, local compute, query, reader, judge and cleanup costs and times
in the final report, including unknown or unsettled charges.
