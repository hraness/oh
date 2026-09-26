# Search and recall

Search finds records by keyword, by meaning, or both, and recall runs several
searches at once and can add records from a date window. Every index behind
them is a copy of the records: before a result is returned, Oh rejoins it to
the current SQLite record by digest and drops it if the record changed. This
guide covers the modes, the limits, and how to add local embeddings, a local
reranker, or a hosted vector cache.

## Pick a mode

| Mode | What runs | Needs |
| --- | --- | --- |
| `keyword` | The SQLite FTS5 index. | Nothing extra. |
| `semantic` | The embedding backend alone. | A `semanticBackend`. |
| `hybrid` | Keyword and semantic results, fused by rank. | A `semanticBackend`. |
| `rerank` | Keyword and semantic candidates, rescored by a local cross-encoder. | A `rerankBackend`, and a `semanticBackend` for the semantic half. |

With no `mode`, search and recall pick `rerank` when a reranker is
configured, `hybrid` when a semantic backend is configured, and `keyword`
otherwise.

`limit` defaults to 10 and accepts 1 through 100. In the keyword, semantic,
and hybrid modes each source contributes up to three times `limit`
candidates, capped at 100. Hybrid scoring adds 2/(60 + rank) for a keyword
hit and 1/(60 + rank) for a semantic hit, so a record that tops the keyword
list alone scores 2/61. Ties break by key. In `rerank` mode each source
contributes `rerankPoolSize` candidates (default 30, from 1 through 60).

A response is `{ diagnostics, mode, results, v: 1 }`. Each result carries the
current record, its fused score, and `evidence` listing which source found it
at which rank. When a backend is missing or fails, the response gains a
`semantic-unavailable` or `rerank-unavailable` diagnostic and keeps whatever
the other sources found. Check `diagnostics` when a workflow depends on
semantic or reranked results.

From the CLI, `oh search QUERY` and `oh recall QUERY` take
`--mode keyword|semantic|hybrid` and `--limit N`. The CLI has no semantic
backend: semantic mode returns no results and hybrid mode returns keyword
results, both with a `semantic-unavailable` diagnostic. The retrieval format is
in the [retrieval specification](../spec/v1/retrieval.md).

## Add local semantic search

Semantic state is a cache. Each QMD result is rejoined to the current SQLite
record by record digest before Oh returns it. QMD is an optional peer
dependency:

```sh
bun add @tobilu/qmd@2.5.3
```

```ts
import { Oh } from "@hraness/oh/sdk";
import { OhQmdSemanticBackendV1 } from "@hraness/oh/semantic";

const backend = new OhQmdSemanticBackendV1({
  cacheDirectory: ".oh/semantic",
});
const oh = Oh.open({ semanticBackend: backend });

try {
  await oh.indexSemantic();
  const result = await oh.search("early programmable machines", {
    mode: "hybrid",
  });
  console.log(result.results);
} finally {
  await oh.close();
}
```

The cache lives in the `cacheDirectory` you pass, here `.oh/semantic`.
`indexSemantic()` embeds every current record into it and returns
`{ indexed, v: 1 }`; without a backend it rejects with “No local semantic
backend is configured.” On first use QMD may download its embedding model,
EmbeddingGemma 300M in Q8_0 GGUF form, from Hugging Face. After that,
inference runs on your machine with 768-dimension vectors and cosine
similarity. The full profile is in the
[embedding specification](../spec/v1/embedding.md), and
[Local semantic backend lifecycle](semantic-lifecycle.md) explains how
indexing and closing interact. Keyword mode works when QMD or the model is
absent.

## Rerank locally

A reranker rescores the fused keyword and semantic candidates against the
original question with a cross-encoder model you download yourself:

```ts
import { Oh } from "@hraness/oh/sdk";
import { OhQmdRerankBackendV1 } from "@hraness/oh/rerank";
import { OhQmdSemanticBackendV1 } from "@hraness/oh/semantic";

const backend = new OhQmdSemanticBackendV1({ cacheDirectory: ".oh/semantic" });
const reranker = new OhQmdRerankBackendV1({
  modelPath: "/absolute/path/to/qwen3-reranker-0.6b-q8_0.gguf",
});
const oh = Oh.open({ semanticBackend: backend, rerankBackend: reranker });
try {
  await oh.indexSemantic();
  const result = await oh.search("early programmable machines");
  console.log(result.mode, result.results, result.diagnostics);
} finally {
  await oh.close();
}
```

The optional `@tobilu/qmd@2.5.3` rerank backend loads the model file at
`modelPath`. It never downloads reranker weights or starts a hosted service.
`OH_RERANK_PROFILE_V1` records the expected model, Qwen3-Reranker-0.6B in
Q8_0 GGUF form with a 4,096-token context. A reranked query is at most 16,384
bytes, each document at most 65,536 bytes, and one call at most 128
documents. For the keyword half, the query is normalized (lowercased, common
English words removed, first 16 terms kept); the semantic half and the
reranker see the original text.

Reranking trades compute for relevance. The
[SDK retrieval study](../benchmarks/SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md)
measured a 12.34-second warm reranker p95 on an Apple M5 Max. It replayed
earlier semantic rankings, so that figure excludes embedding time and is not
a latency promise for your hardware. The study used the default SDK route and
record rendering on two development personas it had seen before; measure your
own records and workload before relying on it.

## Recall several queries

`oh.recall(queries, options)` runs one to six distinct queries, each at most
16,384 bytes, and fuses the results by 1/(60 + rank). `limit` defaults to 10
and accepts 1 through 100. Pass a `window` of `{ since, until, v: 1 }` with
canonical UTC instants to add the records dated inside it as another source.
`asOf` is checked and echoed in the response; it does not filter records. The
response holds at most (queries + 1) × `limit` results.

`oh recall QUERY --as-of INSTANT` reads relative dates such as “last week”
from the query to build a window, renders the results within a 96,000-byte
budget, and prints `{ recall, rendering, v: 1 }`. The
[recall specification](../spec/v1/recall.md) defines the date rules and the
rendering.

## Use the hosted semantic cache

The hosted V2 adapter keeps the same rule, that records are the source of
truth, with its own cache tied to one embedding profile. It sends each input,
up to its size limit, to Cloudflare Workers AI’s EmbeddingGemma model. That is
a network call billed to your Cloudflare account. The cache stores only
float32 vectors, input digests, record digests, which records belong to each
generation, and a pointer to the published generation, in a libSQL database
you run. It stores no title, body, record JSON, or query text.

Every cache call also takes an isolation SHA-256 that keeps one authority’s
vectors (an authority is the store whose records you index) apart from
another’s. The helper below derives a safe default from the
authority ID. A private multi-tenant host should instead derive an opaque
digest from its private authority handle, cache epoch, and profile identity,
and pass that same digest to every cache call.

```ts
import { createClient } from "@libsql/client";
import {
  OhCloudflareEmbeddingClientV1,
  bootstrapOhLibSqlSemanticCacheV2,
  deriveOhSemanticIsolationSha256V2,
  openOhLibSqlSemanticCacheV2,
} from "@hraness/oh/semantic-cloud";

// Deploy once with a short-lived schema credential.
const schemaClient = createClient({
  authToken: process.env.OH_SEMANTIC_SCHEMA_TOKEN!,
  url: process.env.OH_SEMANTIC_DATABASE_URL!,
});
await bootstrapOhLibSqlSemanticCacheV2(schemaClient);
schemaClient.close();

const client = createClient({
  authToken: process.env.OH_SEMANTIC_RUNTIME_TOKEN!,
  url: process.env.OH_SEMANTIC_DATABASE_URL!,
});
const cache = await openOhLibSqlSemanticCacheV2(client, { closeClient: true });
const embedder = new OhCloudflareEmbeddingClientV1({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
  apiToken: process.env.CLOUDFLARE_WORKERS_AI_TOKEN!,
});
const authorityId = "thread:research/epoch:1";
const isolationSha256 = deriveOhSemanticIsolationSha256V2(authorityId);

const staged = await cache.stage({
  authorityId,
  authoritySha256: snapshot.head.recordsSha256,
  documents,
  embeddingClient: embedder,
  generation: snapshot.head.generation,
  isolationSha256,
});
const published = await cache.publishedHead({
  authorityId,
  isolationSha256,
});
await cache.publish({
  authorityId,
  expectedPublishedGeneration: published?.generation ?? null,
  generation: staged.generation,
  isolationSha256,
});
```

In this example, `snapshot` is the result of `await store.snapshot()` on the
promise-based store you are indexing (such as `authority.store` from
[Direct libSQL store](libsql-runtime.md)), and `documents` is the list of
`{ content, key, recordSha256, title, v: 2 }` entries you built from its
records. `stage` also
accepts `createdAt`, `maximumChunksPerDocument`, and an abort `signal`.

A search needs the current authority generation and record digests, and
returns nothing for a head that is stale or was replaced meanwhile. Purge
writes a permanent tombstone for the authority first, then deletes its
generation memberships and every vector under its isolation digests. Retrying
a purge returns the same counts as the first run and confirms that no cache
rows are left. Different authorities and cache epochs never share a vector, and
the isolation digest is never sent to the provider. A purged authority ID
cannot come back; allocate a new epoch for a new lifetime. When the hosted
cache fails, you lose that shortcut, and graph reads and rules keep working
unchanged.

The [hosted semantic cache V2 specification](../spec/v2/semantic-cloud.md)
defines the format, and
[Hosted semantic cache V2 lifecycle](hosted-semantic-runtime.md) covers
closing, client ownership, and the bundled runtime. The released V1 API and
digests keep working for compatibility; V1 and V2 cannot open the same
semantic database at the same time.
