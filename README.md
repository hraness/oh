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
