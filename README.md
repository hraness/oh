# open-source tools for agentic research

[![skills.sh](https://skills.sh/b/hraness/oh)](https://skills.sh/hraness/oh)

Turn a research question into an artifact whose sources, claims, citations,
dependencies, and change history remain inspectable in one local SQLite file.
Oh is the ontology kernel, store, CLI, TypeScript SDK, and Agent Skill behind
that path. It stores content-addressed records and an append-only operation log,
checks every mutation against an explicit versioned contract, and keeps keyword
and semantic indexes derived and replaceable.

[Website](https://oh.computer) · [Versioned specification](spec/README.md) ·
[Agent Skill](skills/oh/SKILL.md)

## From a question to an inspectable artifact

Oh supplies a versioned graph envelope and a small ontology kernel. A research
application can map familiar work onto explicit records without hiding meaning
in a database convention:

| Research object | Oh record kind | What becomes inspectable |
| --- | --- | --- |
| Question | `inquiry` | The question and its durable investigation trail. |
| Source | `entity` | A stable identity for a paper, dataset, person, or system. |
| Capture | `edition` | A bounded source edition or extract under an application profile. |
| Claim | `statement` | The proposition, separate from who accepts it. |
| Citation | `evidence` | How a passage, table, or observation bears on an assertion. |
| Artifact | `view` | A derived brief or answer with addressable inputs. |

An attributable `assertion` sits between a claim and the evidence that bears on
it. A small review can therefore leave an inspectable path instead of one
opaque answer:

```text
inquiry:primary-endpoint
  → entity:trial-report
  → edition:trial-report-v1
  → statement:endpoint-12-weeks
  → assertion:endpoint-12-weeks
  → evidence:table-2
  → view:review-brief
```

The [homepage trace](https://oh.computer/#trace) shows the exact CLI read and a
schema-checked illustrative evidence record. It is a model of record custody,
not a claim about a real study.

## Why Oh

- **Make meaning explicit.** Every record declares a kind, stable logical key,
  ordered dependencies, and canonical JSON content under a versioned ontology
  and schema contract.
- **Keep changes accountable.** Content digests, append-only operations,
  compare-and-swap writes, and replay verification make accepted graph changes
  inspectable and stale writes visible.
- **Keep local state authoritative.** Records and operations live in one SQLite
  file you control. Sync is an explicit transport seam and accepts only
  fast-forward histories after an exact contract handshake.
- **Treat search as a view.** FTS5 documents, optional local embeddings, and a
  separately scoped hosted cache are derived from current record digests, so
  an index can be rebuilt without becoming graph authority.
- **Derive without silently asserting.** Positive recursive rules run against
  one exact graph head and fact-pack digest. Their tuples and bounded proofs
  are deterministic, disposable output rather than accepted graph records.
- **Remember without conflating authority.** A stable host-bound facade composes a
  purgeable working authority with one pinned canonical head while preserving
  lane, conflict, record, and proof provenance.

## Install and first run

[Bun 1.3.14 or newer](https://bun.sh/docs/installation) is required for the
CLI, local SDK, and SQLite authority. The runtime-neutral store contracts and
direct libSQL authority also support Node 24 serverless runtimes. Install the
exact current release from npm:

```sh
bun add --global @hraness/oh@0.4.0
oh --help
```

The identical package bytes and their checksum are available from the
[immutable GitHub Release](https://github.com/hraness/oh/releases/tag/v0.4.0),
including the mirrored
[`hraness-oh-0.4.0.tgz`](https://github.com/hraness/oh/releases/download/v0.4.0/hraness-oh-0.4.0.tgz)
and
[`SHA256SUMS`](https://github.com/hraness/oh/releases/download/v0.4.0/SHA256SUMS).

Oh writes to `.oh/oh.sqlite` and the `default` space unless you select another
path or space. Keep `.oh/` out of source control.

```sh
oh init
oh put \
  --kind entity \
  --key entity:ada-lovelace \
  --json '{"name":"Ada Lovelace","role":"mathematician"}'
oh get entity:ada-lovelace
oh search "mathematician" --mode keyword
oh verify
```

This first task creates one entity, reads it back, finds it through the derived
keyword index, and verifies the authoritative operation chain. It needs no
account, hosted model, remote database, or semantic-search dependency.

## What becomes observable

Commands print canonical JSON, except `oh version` and help. A missing `oh get`
record exits with status 3. Invalid input, an integrity failure, or a concurrent
head conflict exits with status 1 and leaves the current log intact.

Run `oh contract` to inspect the ontology, graph, schema, and SQLite versions
compiled into the installed runtime. Opening an Oh database separately checks
that its stored contract manifest matches that runtime.

## How Oh works

An Oh space has one current graph and one append-only operation chain:

- A record has a stable logical key, one declared kind, ordered dependencies,
  arbitrary canonical JSON content, and a SHA-256 digest over its envelope.
- A mutation puts or tombstones records in one `BEGIN IMMEDIATE` transaction.
  Compare-and-swap checks reject a stale generation before the head moves.
- Every operation binds the parent operation, graph revision, complete record
  set, contract, actor, timestamp, and sequence to a digest.
- SQLite records and the operation log are authoritative. FTS5 documents and
  local embedding files can be deleted and rebuilt.
- Sync exchanges bounded operation bundles after an exact contract handshake.
  Only fast-forward histories settle automatically; divergence fails closed.

The V1 kernel distinguishes seven ideas: entity, statement, assertion,
evidence, context, inquiry, and projection. The generic graph envelope also
supports schema, vocabulary, review, rights, edition, and activity records.
Product-specific meaning belongs in registered codecs and versioned schema
records, not in hidden storage conventions.

## Use the SDK

For a project dependency, pin the same immutable release in `package.json`:

```json
{
  "dependencies": {
    "@hraness/oh": "0.4.0"
  }
}
```

The base package has no required runtime dependencies. Keyword search,
ontology parsing, SQLite storage, replay verification, and sync need no hosted
model.

```ts
import { Oh } from "@hraness/oh/sdk";

const oh = Oh.open({
  databasePath: ".oh/research.sqlite",
  spaceId: "paper-one",
});

try {
  const head = oh.head();
  oh.put({
    expectedHead: head,
    key: "entity:ada-lovelace",
    kind: "entity",
    value: { name: "Ada Lovelace" },
  });

  const result = await oh.search("Ada", { mode: "keyword" });
  console.log(result.results[0]?.record);
  console.log(oh.verify());
} finally {
  await oh.close();
}
```

Pass the head you actually reviewed when concurrent writers matter. Do not
retry `OhConflictError` blindly. Read the new head and records, reconcile the
intended change, then submit a new operation.

The root entrypoint exports canonical JSON, ontology, schema, graph, operation,
store, and sync contracts. Use `@hraness/oh/store` for the runtime-neutral
promise interface, `@hraness/oh/libsql` for a direct Node 24 or serverless
authority, `@hraness/oh/sqlite` for the local Bun store, `@hraness/oh/sdk` for
the local `Oh` facade, `@hraness/oh/sync` for transport seams,
`@hraness/oh/projection` for recursive derived views, and
`@hraness/oh/semantic` for the optional local embedding backend, and
`@hraness/oh/semantic-cloud` for the Cloudflare EmbeddingGemma plus direct
libSQL derived-cache adapter. Use the narrow stable `@hraness/oh/memory-page`
entrypoint for model-neutral page records and `.oh.md` interchange. The
stable `@hraness/oh/memory` subpath composes host-bound working and canonical
stores behind separate agent and host-control surfaces. The former
`@hraness/oh/experimental/memory` path remains as a compatibility alias.

## Open a scoped working store

Working memory uses the same V1 graph and operation bytes under a different
storage lifecycle. The host chooses and retains the realm binding. Application
code receives the promise-based store and keeps the host object that can purge
a working space out of agent tools. A model-facing adapter should expose strict
semantic ingress and bounded query methods, not generic commit or change-feed
access.

```ts
import { createClient } from "@libsql/client";
import {
  bootstrapOhLibSqlAuthorityV1,
  createOhLibSqlStoreAuthorityV1,
  purgeOhLibSqlWorkingSpaceV1,
} from "@hraness/oh/libsql";
import { OH_WORKING_STORE_PROFILE_V1 } from "@hraness/oh/store";

// Run once during deployment with a short-lived schema credential.
const schemaClient = createClient({
  authToken: process.env.OH_SCHEMA_TOKEN!,
  url: process.env.OH_DATABASE_URL!,
});
await bootstrapOhLibSqlAuthorityV1(schemaClient);
schemaClient.close();

// Runtime opens verify the schema and execute no DDL.
const runtimeClient = createClient({
  authToken: process.env.OH_RUNTIME_TOKEN!,
  url: process.env.OH_DATABASE_URL!,
});
const authority = await createOhLibSqlStoreAuthorityV1(runtimeClient, {
  profile: OH_WORKING_STORE_PROFILE_V1,
  realmId: "tenant:example/thread:research",
  spaceId: "thread:research",
});

const store = authority.store;
console.log(await store.head());

// A separately held purge worker either purges the exact existing binding or
// writes an empty-head tombstone when creation never completed. It cannot
// create a space or binding, and a delayed creator cannot resurrect custody.
const purgeClient = createClient({
  authToken: process.env.OH_PURGE_TOKEN!,
  url: process.env.OH_DATABASE_URL!,
});
await purgeOhLibSqlWorkingSpaceV1(purgeClient, {
  closeClient: true,
  profile: OH_WORKING_STORE_PROFILE_V1,
  realmId: "tenant:example/thread:research",
  spaceId: "thread:research",
});
```

The working profile disables operation replication. Dependency-closure export
remains available for explicit reviewed adoption. `purgeWorkingSpace` exists
only on `authority.host`; do not expose that object or raw database credentials
through a model tool. Read the [store-port specification](spec/v1/store.md) for
exact snapshot, change-feed, codec ingress, closure, and purge behavior.

## Compose working and canonical memory

The stable `@hraness/oh/memory` entrypoint uses the same Oh kernel twice, not a
separate memory database model. Trusted host code supplies two distinct
physical store handles, their expected binding digests, one exact canonical
head, sealed working codecs, digest-identified fact extractors, and closed
registries of named projection programs and nomination routes.

Use `createOhMemoryAuthorityV1` for an application integration. It returns an
`agent` object with only `remember`, `query`, `explain`, and `nominate`, plus a
separate `host` object for canonical-head rollover and reviewed adoption:

```ts
import { createOhMemoryAuthorityV1 } from "@hraness/oh/memory";

const memory = await createOhMemoryAuthorityV1({
  actorId: "research.memory-agent",
  adoptionActorId: "research.memory-reviewer",
  canonical: {
    authorityId: "project-reviewed",
    expectedBindingSha256: canonical.store.binding.bindingSha256,
    expectedHead: await canonical.store.head(),
    store: canonical.store,
  },
  nominationRoutes: [{
    destinationPurpose: "kb.review",
    nominationId: "knowledge-review",
  }],
  programs: [projectDependenciesProgramV2],
  working: {
    authorityId: "thread-working",
    codecs,
    expectedBindingSha256: working.store.binding.bindingSha256,
    store: working.store,
  },
});

const result = await memory.agent.query({
  bindings: {},
  continuation: null,
  programId: "project.dependencies",
  v: 2,
});

const nomination = await memory.agent.nominate({
  nominationId: "knowledge-review",
  roots: ["edition:reviewed-summary"],
  v: 1,
});
await memory.host.adoptNomination({
  expectedCanonicalHead: result.identity.canonical.head,
  nomination,
  v: 1,
});

// To replace an existing key, trusted host code must prove the reviewed
// canonical digest. Omit replacements to retain strict insert-only adoption.
await memory.host.adoptNomination({
  expectedCanonicalHead: reviewedCanonicalHead,
  nomination: revisedNomination,
  replacements: [{
    expectedPriorRecordSha256: reviewedRecord.recordSha256,
    key: reviewedRecord.key,
    v: 1,
  }],
  v: 1,
});
```

`adoptNomination` parses the complete proposal, checks its host-selected route
and working authority, and re-exports the closure from the exact nominated
working head. An absent record is inserted, an equal digest is already present,
and a different digest fails closed by default. Trusted host code can authorize
an intentional replacement only by naming the logical key and its exact
reviewed prior digest in a bounded `replacements` list. Missing, stale, wrong,
duplicate, or absent-key claims fail without a partial write. Every supplied
claim is checked, including claims for keys already at their nominated digest;
an exact replay validates those claims against its exact reviewed head. The
inserts and authorized replacements share one compare-and-swap operation; the existing
parent-head and record-change bytes carry the transition without a new persisted
format. Before that commit, the authority proves that the prospective canonical
snapshot stays within 8,192 records and 32 MiB. After it, the authority re-reads
the physical head, so a reachable duplicate operation or a later writer cannot
make it install an obsolete intermediate head. A stale expected head succeeds
only when the current physical snapshot contains every nominated digest exactly.

`advanceCanonical` moves the facade's pin only from its current exact head to
the same head or a proven descendant in the bound canonical operation chain.
One call proves at most 16,384 operations over at most 64 bounded pages; callers
must advance longer histories in reviewed chunks. Host mutations are
serialized. A query already in flight keeps the immutable pin it captured,
existing explanation capabilities survive rollover in one shared 64 MiB cache,
and an old continuation fails when the memory identity changes.

Every stable method snapshots unknown JSON input through data-property
descriptors before validation. Accessors, symbols, proxies, sparse arrays, and
non-JSON values fail closed, and execution uses only the detached bytes. The
snapshot walk is capped at 128 levels, 65,536 entries per container, and
1,048,576 total nodes, and counts canonical bytes before it clones each child.

V2 evaluates one complete bounded result before paging it. Agent input may bind
only host-declared primitive query-body parameters; it cannot choose sources,
rules, purpose, page size, or evaluation limits. Pass an issued continuation
back unchanged only to the same named query and do not log it. Catch
`OhMemoryContinuationError` when a supplied cursor needs to be restarted; its
`reason` distinguishes encoding, authentication, and exact-identity failures.
Other store and projection failures keep their original types. The compatibility
alias `@hraness/oh/experimental/memory` remains available, but new integrations
should use `@hraness/oh/memory`. Read the [memory specification](spec/v1/memory.md)
for the complete authority, conflict, pagination, and lifecycle boundary.

## Use a memory page or `.oh.md` file

A memory page is an ordinary `edition` record with bounded Markdown, explicit
source observations, and a host-attestation receipt reference. It is useful
for readable summaries and long-running-agent notes without introducing a
second memory ontology. Its canonical `.oh.md` form contains the complete
record key, dependencies, digest, metadata, and body:

```ts
import {
  createOhMemoryPageRecordV1,
  renderOhMemoryPageMarkdownV1,
} from "@hraness/oh/memory-page";

const page = createOhMemoryPageRecordV1({
  dependencies: ["activity:memory-attestation"],
  key: "edition:session-summary",
  value: {
    body: "## Current state\n\nThe provider rollout is paused before activation.",
    createdAt: "2026-08-31T12:00:00.000Z",
    format: "oh.memory-page.v1",
    language: "en",
    provenance: {
      actorId: "host.memory",
      attestationSha256: receiptSha256,
      attestedAt: "2026-08-31T12:00:00.000Z",
      kind: "host-attested",
      v: 1,
    },
    sources: [],
    summary: "The exact resumable session frontier.",
    title: "Session frontier",
    updatedAt: "2026-08-31T12:00:00.000Z",
    v: 1,
  },
});

const portable = renderOhMemoryPageMarkdownV1(page);
```

The page never stores vectors, model IDs, scores, or provider configuration.
Treat its Markdown and source titles as untrusted data. See the
[memory-page specification](spec/v1/memory-page.md) for the exact format and
round-trip rules.

## Derive an exact projection

The projection subpath is pure TypeScript and runs in Node 24 serverless
functions without loading SQLite. A snapshot binds the current space head and
complete record-reference set. A fact pack binds the deterministic extractor
that translated those records into relations. Rules and queries are typed data,
not strings or executable callbacks.

```ts
import {
  OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1,
  createOhProjectionDatasetV1,
  createOhProjectionLiteralV1,
  createOhProjectionQueryV1,
  createOhProjectionRecordFactsV1,
  createOhProjectionRulePackV1,
  createOhProjectionRuleV1,
  createOhProjectionSnapshotV1,
  evaluateOhProjectionV1,
  ohProjectionVariableV1 as variable,
} from "@hraness/oh/projection";

const records = oh.store.snapshotRecords();
const snapshot = createOhProjectionSnapshotV1({
  head: oh.head(),
  records,
  spaceId: oh.store.spaceId,
});
const dataset = createOhProjectionDatasetV1({
  extractorSha256: OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1.extractorSha256,
  factPackId: OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1.factPackId,
  factPackRevision: OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1.factPackRevision,
  facts: createOhProjectionRecordFactsV1(records),
  snapshot,
});

const x = variable("x");
const y = variable("y");
const z = variable("z");
const literal = (relation: string, ...terms: ReturnType<typeof variable>[]) =>
  createOhProjectionLiteralV1({ relation, terms });
const rulePack = createOhProjectionRulePackV1({
  rulePackId: "example.dependencies",
  rulePackRevision: 1,
  rules: [
    createOhProjectionRuleV1({
      body: [literal("oh.dependency", x, y)],
      head: literal("depends", x, y),
      ruleId: "depends.direct",
    }),
    createOhProjectionRuleV1({
      body: [literal("depends", x, y), literal("oh.dependency", y, z)],
      head: literal("depends", x, z),
      ruleId: "depends.transitive",
    }),
  ],
});
const query = createOhProjectionQueryV1({
  find: ["x", "z"],
  queryId: "all.dependencies",
  where: [literal("depends", x, z)],
});

const result = evaluateOhProjectionV1({ dataset, query, rulePack, snapshot });
console.log(result.rows);
```

`result.authority` is always `derived`. Oh does not commit a result, elevate an
agent assertion, or make a proof authoritative. Changing the snapshot,
extracted fact set, rule pack, or query produces a new identity and requires a
full rebuild.

The reference evaluator favors bounded, transparent correctness. It supports
positive recursion and set semantics; it does not yet support negation,
aggregation, arithmetic, or incremental invalidation. An optional compatibility
lane evaluates the same rules with exactly `@suss/datalog@0.20.0` and returns a
result only after every relation agrees with the reference evaluator:

```sh
bun add @suss/datalog@0.20.0
```

```ts
import { evaluateOhProjectionWithSussV1 } from "@hraness/oh/experimental/projection-suss";

const checked = evaluateOhProjectionWithSussV1({
  dataset,
  query,
  rulePack,
  snapshot,
});
```

Suss does not expose an execution-budget hook. Its adapter therefore applies a
conservative finite-domain admission bound and refuses programs it cannot prove
will stay inside the requested tuple ceiling. The built-in evaluator remains
available for those programs. The compatibility lane deliberately runs both
engines; it is an equivalence check, not a performance backend.

## Add local semantic search

Semantic state is a cache. Each QMD result is rejoined to the current SQLite
record by exact record digest before Oh returns it.

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

The exact V1 profile is documented in
[the embedding specification](spec/v1/embedding.md). The model download and
all inference stay local. Keyword mode remains available when QMD or the model
is absent.

## Add a hosted semantic cache

The hosted V2 adapter uses the same source-record principle with a distinct,
profile-bound cache. It sends bounded inputs to Cloudflare Workers AI's
EmbeddingGemma model and stores only float32 vectors, input digests, record
digests, immutable generation membership, and a published pointer in direct
libSQL. It stores no title, body, record JSON, or query text.

Every cache call also binds an isolation SHA-256. The helper below derives a
safe authority-specific default. A private multi-tenant host should instead
derive an opaque digest from its private authority handle, cache epoch, and
profile identity, then pass that same digest to every cache operation.

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

Search requires the exact current authority generation and record digests, and
returns nothing from a stale or concurrently replaced head. Purge writes a
permanent authority tombstone before deleting memberships and every vector in
that authority's reserved isolation scopes. Its immutable marker and receipt
make retries return the same first-run counts while proving zero residual cache
rows. Distinct authority or cache-epoch isolation digests never reuse a vector,
and the digest never enters provider text. The same authority ID cannot be
resurrected; allocate a new epoch for a new lifetime. Hosted failure is a
missing convenience lane, never permission to weaken exact graph or Datalog
operations. Read the
[isolated hosted semantic-cache V2 specification](spec/v2/semantic-cloud.md).
The released V1 API and digests remain available unchanged for compatibility;
V1 and V2 cannot open the same semantic database simultaneously.

## Sync through libSQL or Turso

`createLibSqlOperationSyncTransportV1` accepts the `execute` and `batch` shape
implemented by libSQL clients. Oh creates two remote tables for the contract
manifest and immutable operation chain. It does not send semantic cache files.

```sh
bun add @libsql/client@^0.17.4
```

```ts
import { createClient } from "@libsql/client";
import { Oh } from "@hraness/oh/sdk";
import { createLibSqlOperationSyncTransportV1 } from "@hraness/oh/sync";

const client = createClient({ url: process.env.TURSO_DATABASE_URL! });
const oh = Oh.open();

try {
  const transport = createLibSqlOperationSyncTransportV1(client);
  const result = await oh.sync(transport, { remoteId: "research-cloud" });
  console.log(result);
} finally {
  await oh.close();
  client.close();
}
```

The consumer owns credentials, client construction, retry policy, and remote
availability. The transport handshakes before exchanging data and refuses a
different contract or a non-fast-forward history.

For offline transfer, `oh sync export` writes a bounded bundle to stdout and
`oh sync import --file <path>` verifies and imports it idempotently.

## Boundaries and limitations

- Digests detect changed contract, record, operation, and bundle bytes. They do
  not encrypt data, authenticate an actor, authorize a write, or prove that a
  research statement is true.
- Oh does not redact record values. Protect the database, filesystem, backups,
  and any sync destination according to the sensitivity of the research graph.
- The optional QMD cache contains derived record text. Its pinned model and
  inference stay local, but the cache still needs the same deliberate handling
  as its source data.
- The libSQL seam validates exact contracts and fast-forward history. The
  consumer remains responsible for credentials, transport security, access
  control, tenant isolation, backup, retry, and remote availability.
- Divergent histories do not merge automatically. Oh returns an explicit
  conflict and leaves reconciliation policy to the consumer.
- Projection tuples and proofs are derived cache output. Persisting or
  publishing them as knowledge requires an explicit application-level review
  and a new authoritative graph operation.

Read [SECURITY.md](SECURITY.md) for the complete public threat model.

## Give Oh to a coding agent

The repository includes an installable Agent Skill at
[`skills/oh`](skills/oh/SKILL.md). Copy or link that directory into the skill
location used by your agent runner. The skill teaches an agent to inspect the
contract and current head, use generation-checked writes, verify replay, and
keep remote sync explicit.

You can also give an agent this prompt:

```text
Install @hraness/oh@0.4.0 from npm and use its packaged Oh Agent Skill. The
exact npm tarball and SHA256SUMS are mirrored by the immutable v0.4.0 Release at
https://github.com/hraness/oh/releases/tag/v0.4.0. Verify the CLI with
`oh --help` and `oh version`.
Do not create or modify an Oh database until I name its path and ask you to.
```

## Find the right documentation

- **Install and prove the local path:** follow
  [Install and first run](#install-and-first-run).
- **Embed Oh in a tool:** use [the SDK](#use-the-sdk), then select the narrow
  package subpath for SQLite, sync, projection, or optional semantics.
- **Give Oh to an agent:** install the [Oh Agent Skill](skills/oh/SKILL.md) and
  keep its database, space, sync target, and mutation authority explicit.
- **Implement or change a contract:** begin with the
  [specification map](spec/README.md), then read the applicable V1 narrative and
  machine-readable schema together.
- **Contribute or report a vulnerability:** follow
  [CONTRIBUTING.md](CONTRIBUTING.md) or the private process in
  [SECURITY.md](SECURITY.md).

## Specification

[`spec/manifest.json`](spec/manifest.json) is the machine-readable discovery
document. The current contract is V1:

- [Canonical JSON and digests](spec/v1/canonical-json.md)
- [Ontology](spec/v1/ontology.md)
- [Schema evolution](spec/v1/schema-evolution.md)
- [Graph and operations](spec/v1/graph.md)
- [SQLite storage](spec/v1/storage.md)
- [Store ports, profiles, and direct libSQL authority](spec/v1/store.md)
- [Sync protocol](spec/v1/sync.md)
- [Local embedding profile](spec/v1/embedding.md)
- [Derived projections](spec/v1/projection.md)
- [Compatibility and migration](spec/v1/migration.md)

The JSON Schemas describe exchange envelopes. Runtime parsers additionally
enforce canonical ordering, byte limits, referential integrity, and digest
preimages that JSON Schema cannot express.

## Benchmark memory

The checkout includes three separate measurements: typed memory-state
correctness, evidence retrieval from public conversations, and an opt-in
model reader. A retrieval score is not an answer-accuracy score, and passing
state tests does not establish that an agent writes useful memories.

Start with the network-free checks:

```sh
bun run test:benchmarks
bun run bench:memory state
bun run bench:memory projection
```

The state benchmark exercises the real working/canonical authority, compares
updates and multi-hop results with an independent replay oracle, and checks
proof provenance, conflicting authorities, canonical pins, idempotency, and
stale-write rejection. Its observations are synthetic typed records, not
LLM-extracted facts. The projection benchmark records repeated wall-clock
measurements and complete result digests; it does not change evaluation bounds.

Fetch a checksum-pinned public dataset explicitly, then measure retrieval:

```sh
bun run bench:memory fetch --dataset longmemeval-s
bun run bench:memory retrieval --dataset longmemeval-s --split dev --limit 24
```

LongMemEval S downloads about 277 MB. `longmemeval-oracle` is a smaller,
evidence-only diagnostic, **not** the S benchmark. `locomo` is also supported;
its download uses `gh` and its data is licensed CC BY-NC 4.0. Review that
noncommercial license for your intended use. The cleaned LongMemEval release
is MIT-licensed. Neither dataset is included in the npm package.

All stores use SQLite `:memory:`. Downloads and reports live in
`.cache/benchmarks/`; no production database, hosted cache, or sync destination
is read or written. Ingestion receives only raw turns, dates, speakers, and
provided image captions. Answers, evidence labels, and supplied summaries stay
outside the memory adapters. Images are not fetched.

The baselines include no memory, recent turns, unbounded full context, raw
SQLite BM25, and Oh's actual keyword API. Focused-query and neighboring-turn
variants are experimental benchmark adapters, not changes to Oh's default
search policy and not implementations of Letta, Mem0, or another competitor.
Retrieval adapters share the same top-K seed count and UTF-8 context-byte
budget; recent context uses the byte budget alone. Full context is explicitly
exempt, and bytes are not reported as tokens. Experimental `oh-anchor-window`
and `bm25-anchor-window` variants reserve room for ranked matches before filling
remaining space with neighboring turns. They do not change production search.
Paired comparisons prefer the matching BM25 variant rather than a smaller
plain-retrieval context.

Reports include source-file hashes, dataset revision and checksum, selected
question IDs, context digests, per-category scores, missing-annotation counts,
latencies, and paired conversation-cluster bootstrap intervals. LoCoMo category
IDs retain the original dataset numbering. Repeated LongMemEval session IDs
receive distinct turn-occurrence IDs without dropping any content; session
recall retains the original labels, and duplicate-session counts are reported.
Evidence protocol `oh.evidence-references.v2` splits unambiguous multi-citation
entries and resolves leading-zero aliases only to existing turn IDs. Reports
retain the raw annotations and normalization audit; ambiguous or genuinely
missing references remain misses. Earlier raw-reference reports are retained
as historical measurements, not silently rewritten.
Development/test splits keep whole conversations or question families together.
Choose an adapter on `--split dev`,
freeze it, and use `--split test` for the final measurement; do not repeatedly
optimize against the held-out answers. A pilot subset is not a full-benchmark run.

For a paid reader comparison, supply a benchmark-only `OPENAI_API_KEY` in the
runner environment, then explicitly authorize both limits:

```sh
bun run bench:memory answer --dataset longmemeval-s --split dev --limit 24 \
  --paid --max-usd 10 --max-calls 96
```

Alternatively, pass an ignored `.env.benchmark` file explicitly with
`bun --env-file=.env.benchmark run bench:memory answer ...`. Direct OpenAI uses
pinned GPT-4.1-family snapshots. Credentials are never included in reports.

An existing Vercel project can instead supply short-lived OIDC authentication
without exporting its secrets to a file. Select your project and team explicitly:

```sh
vercel env run --project YOUR_PROJECT --scope YOUR_TEAM --environment development -- \
  bun run bench:memory answer --provider vercel-gateway \
  --reader openai/gpt-4.1-mini --dataset locomo --split dev --limit 24 \
  --paid --max-usd 10 --max-calls 96
```

The Gateway transport reads only `VERCEL_OIDC_TOKEN`, uses a fixed HTTPS
endpoint, restricts upstream routing to OpenAI, and does not configure remote
keys, environment variables, or deployments. Its explicit `openai/gpt-4.1-mini`
and `openai/gpt-4.1` profiles are family aliases, not verified dated snapshots;
reports distinguish those runs from direct OpenAI. Dated profiles still reject
an alias response unless routing metadata proves the requested snapshot.
Gateway does not advertise a sampling seed, so the runner does not send one.

Every adapter in a run uses the same answer prompt and output-token limit.
Reader profile `oh.benchmark.reader.v2` requests short, complete answers without
restatements or citations, with a default 512-token output bound configurable
through `--answer-tokens`. Empty or clipped completions retain their known cost
and remain failed cases while other questions continue. Transport, identity,
authentication, and spending failures stop the run; nothing is silently retried.

Both transports reserve conservative maximum request cost before dispatch and
share one locked spending ledger across runs in this checkout. Unresolved
requests retain their reservation. Usage-based inference accounting includes
Gateway-reported inference cost when available; it is not a consolidated billing
invoice. Runs rotate system order across the entire question sequence, including
one-question corpora, and report an undiscounted `uncachedReaderCostUsd`
estimate alongside observed cache-adjusted accounting. Provider caches can be
shared across similar requests, so cache-discount differences alone do not
establish an algorithmic efficiency gain. Missing cache details are distinguished
from reported zero cache use. The cumulative cap cannot exceed $10; separate
checkouts do not share that ledger. Do not remove it to restart a pilot budget.

The reader's diagnostic `oh-token-f1.v1` metric is **not** MemEval set-F1,
LoCoMo's native scorer, or an LLM judge. Failed and unattempted requests remain
visible in coverage and lower-bound denominators. LongMemEval hypotheses are
also included for separate native evaluation.

Grade an existing reader report without re-running the memory system:

```sh
vercel env run --project YOUR_PROJECT --scope YOUR_TEAM --environment development -- \
  bun run bench:memory judge --provider vercel-gateway \
  --dataset longmemeval-s --split dev --input RUN.json \
  --paid --max-usd 10 --max-calls 96
```

The judge validates the reader report against the pinned dataset, split, seed,
and complete question/system matrix. Only this separate judging step receives
gold references. LongMemEval uses the [attributed native prompt text](benchmarks/profiles/longmemeval-judge-v1.json);
LoCoMo uses a separately labelled semantic-reference diagnostic. The renderer
was checked against all twelve category/abstention combinations of the pinned
upstream function. Verdicts must be an entire yes/no answer, not a substring.
The Gateway GPT-4o alias and its 16-token minimum differ from the native pinned
judge's 10-token setting; these results are not an exact leaderboard reproduction.
Judging shares the same cumulative spending ledger, and failed or missing
answers remain visible in denominators. LLM judging is fallible, and one
conversation cannot produce a meaningful cluster-bootstrap interval.

Read the [source and protocol audit](benchmarks/research.json) for lessons from
Lemmalog, Letta, PropMem, Graphiti, Mem0, Hindsight, and SimpleMem, including
differences that prevent direct leaderboard comparisons.

Use `bun run bench:memory --help` for all options. `--output` and
`--summary-output` accept new report paths and refuse existing files. Use
`summarize --input RUN.json --output SUMMARY.json` to retain a compact report
with the original source identity and the full report's checksum.

### Recorded offline results

The September 5, 2026 runs use 20 retrieval seeds and a 12,000-byte context
budget. These are **evidence-recall measurements**, not reader accuracy or
leaderboard scores:

| Held-out data | Evidence-labelled questions | Oh keyword | Oh window | BM25 window | Focused BM25 |
| --- | ---: | ---: | ---: | ---: | ---: |
| LoCoMo: 8 conversations, 1,586 questions | 1,224 | 61.60% | 78.89% | 78.74% | 64.90% |
| LongMemEval S: 60-question sample | 51 | 70.65% | 76.37% | 72.45% | 78.66% |

The LoCoMo Oh-window minus BM25-window difference is 0.15 percentage points;
its paired 95% bootstrap interval spans -0.05 to +0.46 points. This does not
establish a win. On the LongMemEval sample, focused BM25 is stronger than either
window variant. Neighbor context can displace useful long turns at a fixed
budget. The frozen retrieval algorithms were replayed only to correct citation
format handling; that scoring correction is not a memory improvement.
Inspect the [LoCoMo report](benchmarks/results/locomo-heldout-v2.json) and
[LongMemEval report](benchmarks/results/longmemeval-s-heldout-v2.json) for
per-category results, exact selections, costs in bytes, and remaining annotation
limitations. Eight conversations and a 60-question sample limit generalization.

The [state validation](benchmarks/results/state-validation-v2.json) passes all
620 generated state, provenance, and authority checks. Separately, reusing
canonical tuple keys during projection sorting reduces local median evaluation
time from 27.6 to 20.7 ms, 230.3 to 155.2 ms, and 903.5 to 592.0 ms for 16-, 32-,
and 48-node chains. Each size has one warmup and five timed runs. Complete
result digests, including proofs and work-unit counts, match the
[before](benchmarks/results/projection-before.json) and
[after](benchmarks/results/projection-after.json) reports. These are local
microbenchmarks, not production latency guarantees.

### Recorded reader results

The initial [direct-key preflight](benchmarks/results/reader-preflight.json)
remains a historical blocked attempt. Vercel project OIDC subsequently enabled
reader and judge runs using only the public datasets. The algorithms, prompts,
and selections were [frozen before the held-out run](benchmarks/results/heldout-reader-freeze.json).

These are **judge-assessed results on small held-out samples**, not full-dataset
or official leaderboard scores:

| System | LoCoMo: 48 questions, 8 conversations | LongMemEval S: 12 questions |
| --- | ---: | ---: |
| No memory | 9/48 (18.8%) | 5/12 (41.7%) |
| Full history | 29/48 (60.4%) | 8/12 (66.7%) |
| BM25 window | 23/48 (47.9%) | 8/12 (66.7%) |
| Oh window | 25/48 (52.1%) | 8/12 (66.7%) |

Oh's LoCoMo difference from BM25 is +4.17 percentage points, with a paired
conversation-bootstrap interval of -4.35 to +16.28 points. That does **not**
establish superiority. LongMemEval's paired outcomes are identical in this
sample, not proven equivalent in the population. Five LongMemEval questions
and nine LoCoMo questions are unanswerable, which matters when interpreting
the no-memory baseline.

Oh-window used 36,982 reader input tokens against full history's 1,460,995 on
the LongMemEval sample, with the same judged score. On LoCoMo it used 142,933
against 1,635,570, but full history scored higher. These are reader-context
trade-offs, not total-system cost savings. Token F1 alone ranked full history
below Oh on LoCoMo even though the semantic judge ranked it higher.

The anchor-first ablation was **not promoted**: on the development samples it
reduced Oh's judged correctness from 9/12 to 8/12 on LongMemEval and from 11/24
to 10/24 on LoCoMo. It remains an explicit experimental adapter, not the default
reader comparison or a production search change. Those outcomes were not used
to tune on the held-out questions.

Inspect the [LoCoMo reader](benchmarks/results/locomo-reader-heldout.json),
[LoCoMo judge](benchmarks/results/locomo-judge-heldout.json),
[LongMemEval reader](benchmarks/results/longmemeval-s-reader-heldout.json), and
[LongMemEval judge](benchmarks/results/longmemeval-s-judge-heldout.json) reports
for selections, category results, input tokens, and source identities.
The [pilot audit](benchmarks/results/reader-audit.json) reconciles all 1,341
request reservations with the ledger: $8.159259 in usage-based accounting plus
$0.016416 retained for four unresolved early requests, or $8.175675 against the
$10 cumulative cap. This is not a consolidated provider invoice.

The tested state guarantees, bounded retrieval, and downstream reader results
remain distinct. Learned extraction, real-agent memory-writing behavior, and
superiority over comparable OSS systems are still unproven.

## Verify a checkout

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

The complete gate type-checks the package, runs the complete test suite,
rebuilds the committed `dist/` entrypoints, and must leave tracked files
unchanged.

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing a wire contract or
migration. Report security issues through the private process in
[SECURITY.md](SECURITY.md).

Oh is available under the [MIT License](LICENSE).
