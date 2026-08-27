# Local embedding profile V1

Oh semantic search is optional, local, and derived. SQLite records remain
authoritative. Keyword search remains available without a model.

## Exact profile

| Field | Value |
| --- | --- |
| Engine | `@tobilu/qmd@2.5.3` |
| Model | `hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf` |
| Dimensions | `768` |
| Distance | `cosine` |
| Normalization | `l2` |
| Documentation | `https://ai.google.dev/gemma/docs/embeddinggemma` |
| Query format | `task: search result | query: {query}` |
| Document format | `title: {title} \| text: {content}` |
| Profile version | `1` |

The native 768-dimensional output follows the
[EmbeddingGemma model profile](https://ai.google.dev/gemma/docs/embeddinggemma).
Implementations MUST NOT silently truncate it to another Matryoshka dimension
under profile V1.

## Derived document contract

For each current record, Oh writes one local Markdown document whose filename
is the SHA-256 digest of the logical key. The document includes the key, kind,
and canonical JSON value. A canonical manifest binds that filename to the
logical key and exact `recordSha256`.

Before returning a semantic hit, Oh resolves the filename through the manifest,
loads the current SQLite record, and requires its digest to match. Stale,
unknown, duplicate, non-finite, or out-of-range results are discarded.

## Search modes

- `keyword` uses the local FTS5 index only.
- `semantic` uses the configured local backend only.
- `hybrid` combines keyword and semantic ranks while preserving lane, rank,
  and score as evidence.

When no semantic backend is configured, semantic and hybrid requests return a
`semantic-unavailable` diagnostic rather than contacting a hosted provider.
Hybrid can still return its keyword lane.

## Deployment boundary

The base package MUST remain usable without QMD. A serverless or browser bundle
SHOULD exclude QMD and model artifacts. Cloud applications SHOULD keep exact
and keyword retrieval on the request path and run semantic indexing in a
bounded, long-lived local-model worker. Unavailable semantic search should be
visible as a diagnostic, never replaced silently by a different model.

The cache directory can contain derived record text. It needs the same local
confidentiality treatment as the source data even though it can be rebuilt.
