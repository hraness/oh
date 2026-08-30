# open-source tools for agentic research

[![skills.sh](https://skills.sh/b/hraness/oh)](https://skills.sh/hraness/oh)

Oh is a local-first ontology kernel, SQLite store, CLI, TypeScript SDK, and
Agent Skill for building durable, inspectable research graphs. It stores
content-addressed records and an append-only operation log, checks every
mutation against an explicit versioned contract, and keeps keyword and semantic
indexes derived and replaceable.

[Website](https://oh.computer) · [Versioned specification](spec/README.md) ·
[Agent Skill](skills/oh/SKILL.md)

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
- **Treat search as a view.** FTS5 documents and optional local embeddings are
  derived from current record digests, so either index can be rebuilt without
  becoming graph authority.
- **Derive without silently asserting.** Positive recursive rules run against
  one exact graph head and fact-pack digest. Their tuples and bounded proofs
  are deterministic, disposable output rather than accepted graph records.
- **Remember without conflating authority.** An experimental facade composes a
  purgeable working authority with one pinned canonical head while preserving
  lane, conflict, record, and proof provenance.

## Install and first run

[Bun 1.3.14 or newer](https://bun.sh/docs/installation) is required for the
CLI, local SDK, and SQLite authority. The runtime-neutral store contracts and
direct libSQL authority also support Node 24 serverless runtimes. Install the
current immutable release directly from GitHub:

```sh
bun add --global github:hraness/oh#v0.2.2
oh --help
```

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
    "@hraness/oh": "github:hraness/oh#v0.2.2"
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
`@hraness/oh/semantic` for the optional local embedding backend. The
`@hraness/oh/experimental/memory` subpath composes host-bound working and
canonical stores behind a smaller agent-facing surface.

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

The experimental memory facade uses the same Oh kernel twice, not a separate
memory database model. Trusted host code supplies two distinct physical store
handles, their expected binding digests, one exact canonical head, sealed
working codecs, digest-identified fact extractors, and a closed registry of
named projection programs:

```ts
import { createOhMemoryAgentV1 } from "@hraness/oh/experimental/memory";

const memory = await createOhMemoryAgentV1({
  actorId: "research.memory-agent",
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
  programs: [{
    programId: "project.dependencies",
    purpose: "answer.research",
    query,
    rulePack,
  }],
  working: {
    authorityId: "thread-working",
    codecs,
    expectedBindingSha256: working.store.binding.bindingSha256,
    store: working.store,
  },
});

const result = await memory.query({
  programId: "project.dependencies",
  v: 1,
});
```

The returned object has only `remember`, `query`, `explain`, and `nominate`.
The host fixes the working actor, each program purpose, and every nomination
destination before exposing those methods. `remember` accepts an idempotency
request plus semantic changes and returns a locator-free working-lane receipt;
it does not accept caller-supplied actor or time claims. The object cannot
select a store, install a rule, write canonical knowledge, sync, or purge.
Query identity binds both exact physical lanes and all projection policy;
conflicting same-key records remain visible. Explanation requires a bounded,
short-lived opaque capability bound to the exact result. Nomination chooses
only a host-registered route and creates a verified working dependency-closure
proposal; it never promotes it. Read the
[experimental memory specification](spec/v1/memory.md) for the complete
authority and lifecycle boundary.

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
Install hraness/oh and its Oh Agent Skill from the immutable v0.2.2 tag at
https://github.com/hraness/oh. Verify the CLI with `oh --help` and `oh version`.
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
