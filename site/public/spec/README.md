# Oh specification

This directory is the versioned public specification for Oh. It defines what
an independent implementation must match to store and exchange Oh data:
canonical bytes, ontology identities, graph envelopes, schema revisions, SQLite
and direct libSQL storage, operation sync, store profiles, local and hosted
embedding profiles, and memory-page interchange.

[`manifest.json`](manifest.json) is the discovery document. It names V1 as
the current version and points to its contract, ontology, JSON Schemas, and
profiles, plus the optional research profile. V1 pins these components:

| Component | Version |
| --- | --- |
| Ontology | `1.0.0` |
| Contract ID | `oh.ontology.v1` |
| Graph format | `1` |
| Schema format | `1` |
| SQLite schema | `2` |
| Sync protocol | `oh.sync.v1` |
| Local embedding profile | `1` |
| Local rerank profile | `1` |
| Hosted embedding profile | `oh.cloudflare.embeddinggemma.v1` |
| Hosted semantic cache V1 | Schema revision `1` |
| Hosted semantic cache V2 | `oh.semantic-cloud.v2` |
| Precomputed hosted vector snapshot | `oh.semantic-hosted-snapshot.v1` |
| Projection semantics | `oh.projection.positive-datalog.v1` |
| Composite memory | V1 (`createOhMemoryAuthorityV1`), with V2 `query` and `explain` envelopes |
| Memory page | `oh.memory-page.v1` |
| Observation | `oh.observation.v1` |
| Recall rendering | `oh.recall-render.v1` |
| Recall date grammar | `oh.recall-date-grammar.v1` |

## Documents

- [Canonical JSON and digests](v1/canonical-json.md) defines which JSON values
  Oh accepts, the single byte encoding of each, and the fields each content
  digest covers.
- [Ontology](v1/ontology.md) names ontology `oh.ontology.v1` at version
  `1.0.0` and defines its seven kernel concepts, identity grammars, values,
  contexts, and errors.
- [Schema evolution](v1/schema-evolution.md) specifies content-addressed
  schema and vocabulary records, which let each namespace revise its concepts
  without changing the record envelope.
- [Graph and operations](v1/graph.md) defines the record envelope behind each
  logical key and the content-addressed chain of operations that records every
  change.
- [SQLite storage](v1/storage.md) defines SQLite schema version `2`, its
  tables, and its connection settings. A SQLite database is the local source
  of truth for a space, and the CLI uses `.oh/oh.sqlite` unless you choose
  another path.
- [Store ports, profiles, and direct libSQL authority](v1/store.md) defines
  the Promise-based store API, the canonical and working profiles,
  dependency-closure exports (chosen records plus every record they depend
  on), and direct libSQL storage of current records and the operation log.
- [Sync protocol](v1/sync.md) defines `oh.sync.v1`, which exchanges canonical
  operations after both sides confirm the same contract manifest: the
  versions and record kinds published in `v1/contract.json`.
- [Local embedding profile](v1/embedding.md) pins the QMD engine, model, and
  vector settings for optional local semantic search.
- [Hosted semantic cache V1](v1/semantic-cloud.md) specifies an adapter that
  pairs one fixed Cloudflare Workers AI EmbeddingGemma profile with a
  rebuildable libSQL cache.
- [Hosted semantic cache V2](v2/semantic-cloud.md) keeps that profile and
  renderer and changes only the cache protocol. Each authority (a set of
  records the cache indexes) and each cache epoch gets its own embeddings,
  even for identical text, so none reuses another’s vectors or depends on
  another for deletion.
- [Precomputed hosted embeddings](hosted-embedding-v1/README.md) describes a
  backend that searches an application-supplied snapshot of precomputed
  vectors through the SQLite search API, with no network requests or
  credentials.
- [Derived projections](v1/projection.md) defines reproducible views that
  positive Datalog rules compute over one graph snapshot. Every result carries
  `authority: "derived"` and must never be read as a graph assertion.
- [Composite agent memory](v1/memory.md) defines `@hraness/oh/memory`: an
  agent object with four methods over a writable working store and a canonical
  store pinned at one head, and a separate host object, the only part that can
  move that pin or adopt a nominated change.
- [Memory pages and `.oh.md` interchange](v1/memory-page.md) defines a
  size-limited Markdown page with its sources, stored as an `edition` record,
  and the self-contained `.oh.md` file that carries one.
- [Observations distilled from sessions](v1/observation.md) defines an
  observation: one dated sentence distilled from a session and stored as an
  `edition` record that cites its source turns.
- [Recall and dated rendering](v1/recall.md) specifies recall, which fuses the
  rankings of up to six read-only searches and renders the results in date
  order, under headings relative to a question date.
- [Search and local reranking](v1/retrieval.md) defines which search mode Oh
  uses when a caller names none, and how the local reranker scores and orders
  candidates.
- [Compatibility and migration](v1/migration.md) explains how to move one V1
  space to another location or installation by carrying its operation chain
  under the same contract digest and space ID.

## Machine-readable files

| File | Contents |
| --- | --- |
| [`v1/contract.json`](v1/contract.json) | The V1 contract manifest that sync compares: contract ID and digest, ontology and format versions, and record kinds. |
| [`v1/ontology.json`](v1/ontology.json) | The ontology version, contract ID, identifier patterns, kernel concepts, and limits. |
| [`v1/contract.schema.json`](v1/contract.schema.json) | JSON Schema for the contract manifest. |
| [`v1/record.schema.json`](v1/record.schema.json) | JSON Schema for a graph record. |
| [`v1/schema-revision.schema.json`](v1/schema-revision.schema.json) | JSON Schema for a schema revision. |
| [`v1/operation.schema.json`](v1/operation.schema.json) | JSON Schema for an operation. |
| [`v1/sync-bundle.schema.json`](v1/sync-bundle.schema.json) | JSON Schema for a sync bundle. |
| [`v1/projection-rule-pack.schema.json`](v1/projection-rule-pack.schema.json) | JSON Schema for a projection rule pack. |
| [`v1/projection-query.schema.json`](v1/projection-query.schema.json) | JSON Schema for a projection query. |
| [`v1/projection-identity.schema.json`](v1/projection-identity.schema.json) | JSON Schema for a projection identity. |
| [`v1/projection-result.schema.json`](v1/projection-result.schema.json) | JSON Schema for a projection result. |
| [`v1/memory-page.schema.json`](v1/memory-page.schema.json) | JSON Schema for a memory page value. |
| [`v1/embedding-profile.json`](v1/embedding-profile.json) | The local QMD embedding profile: engine, model, dimensions, and input formats. |
| [`v1/rerank-profile.json`](v1/rerank-profile.json) | The local reranker profile: QMD 2.5.3 and the Qwen3-Reranker-0.6B model, pinned by SHA-256. |
| [`v1/recall-date-grammar.json`](v1/recall-date-grammar.json) | The `oh.recall-date-grammar.v1` rules for resolving dates in UTC, with weeks that start on Monday. |
| [`v1/cloudflare-embedding-profile.json`](v1/cloudflare-embedding-profile.json) | The hosted Cloudflare EmbeddingGemma profile and its digest. |
| [`v1/cloudflare-embedding-renderer.json`](v1/cloudflare-embedding-renderer.json) | The renderer that splits a document into hosted embedding inputs of at most 448 UTF-8 bytes, and its digest. |
| [`v1/libsql-semantic-cache-schema-v1.sql`](v1/libsql-semantic-cache-schema-v1.sql) | The hosted semantic cache schema, revision 1. |
| [`v1/libsql-semantic-digest-fixture-v1.json`](v1/libsql-semantic-digest-fixture-v1.json) | Digest fixture for the V1 cache: sample inputs and the digests they must produce. |
| [`v2/manifest.json`](v2/manifest.json) | The V2 cache manifest: its schema and digest fixture, the V1 schema it upgrades from, and the V1 profile and renderer it reuses. |
| [`v2/libsql-semantic-cache-schema-v2.sql`](v2/libsql-semantic-cache-schema-v2.sql) | The hosted semantic cache schema, revision 2. |
| [`v2/libsql-semantic-digest-fixture-v2.json`](v2/libsql-semantic-digest-fixture-v2.json) | Digest fixture for the V2 cache, including `isolationSha256`. |
| [`hosted-embedding-v1/manifest.json`](hosted-embedding-v1/manifest.json) | The precomputed hosted embedding manifest: its profile, the profile’s digest, and its snapshot schema. |
| [`hosted-embedding-v1/profile.json`](hosted-embedding-v1/profile.json) | The precomputed hosted embedding profile: the `openai/text-embedding-3-small` model alias, 1,536 dimensions, and the rules for chunking documents and scoring records. |
| [`hosted-embedding-v1/snapshot.schema.json`](hosted-embedding-v1/snapshot.schema.json) | JSON Schema for a precomputed vector snapshot. |

## Optional research profile

The [portable research profile](research-v1/README.md) adds schema-validated
source records, domain vocabulary packs, and verified packet interchange
through the optional `@hraness/oh/research` and `@hraness/oh/research-store`
entry points. Its source namespaces and digest preimages are separate from the
base Oh V1 envelope contract, which the profile leaves unchanged.

## Conformance

The words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY state interoperability
requirements. The JSON Schemas check the structure of exchanged values. The
narrative documents and the runtime parsers also define what a schema cannot
express: canonical order, digest preimages, byte limits, dependency rules, and
replay behavior.

An implementation conforms to V1 only when it reproduces canonical JSON and
digests byte for byte, rejects malformed or noncanonical input, preserves the
order of operation history, and follows the same replay rules. Accepting extra
input breaks conformance when that input changes the bytes an implementation
stores or exchanges.

## Versioning

An existing version is immutable. A change to serialized keys, accepted value
grammar, ordering, a digest preimage, a record kind, a limit, migration SQL, or
protocol meaning needs a new version. A new convenience API may keep the
current contract when it produces the same bytes.

Schema records inside an Oh graph have their own namespace, code, revision, and
content digest. Their evolution rules, in
[Schema evolution](v1/schema-evolution.md), are separate from the version of
the Oh envelope itself.
