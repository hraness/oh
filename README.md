# open-source tools for agentic research

Oh gives coding agents a local, inspectable place to keep research knowledge.
It stores content-addressed records and an append-only operation log in SQLite,
checks every mutation against an explicit ontology contract, and keeps search
indexes derived and replaceable.

[Website](https://oh.computer) · [Versioned specification](spec/README.md) ·
[Agent Skill](skills/oh/SKILL.md)

## Install

[Bun 1.3.14 or newer](https://bun.sh/docs/installation) is required. Install
the current immutable release directly from GitHub:

```sh
bun add --global github:hraness/oh#v0.1.1
oh --help
```

For a project dependency, pin the same release in `package.json`:

```json
{
  "dependencies": {
    "@hraness/oh": "github:hraness/oh#v0.1.1"
  }
}
```

The base package has no required runtime dependencies. Local semantic search
uses the optional `@tobilu/qmd@2.5.3` peer and its pinned EmbeddingGemma model.
Keyword search, ontology parsing, SQLite storage, replay verification, and sync
need no hosted model.

## Start a local research space

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

Commands print canonical JSON, except `oh version` and help. A missing `oh get`
record exits with status 3. Invalid input, an integrity failure, or a concurrent
head conflict exits with status 1 and leaves the current log intact.

Run `oh contract` to inspect the ontology, graph, schema, and SQLite versions
compiled into the installed runtime. Opening an Oh database separately checks
that its stored contract manifest matches that runtime.

## Model

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
and sync contracts. Use `@hraness/oh/sqlite` for the local store,
`@hraness/oh/sdk` for the `Oh` facade, `@hraness/oh/sync` for transport seams,
and `@hraness/oh/semantic` for the optional local embedding backend.

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

## Give Oh to a coding agent

The repository includes an installable Agent Skill at
[`skills/oh`](skills/oh/SKILL.md). Copy or link that directory into the skill
location used by your agent runner. The skill teaches an agent to inspect the
contract and current head, use generation-checked writes, verify replay, and
keep remote sync explicit.

You can also give an agent this prompt:

```text
Install hraness/oh and its Oh Agent Skill from the immutable v0.1.1 tag at
https://github.com/hraness/oh. Verify the CLI with `oh --help` and `oh version`.
Do not create or modify an Oh database until I name its path and ask you to.
```

## Specification

[`spec/manifest.json`](spec/manifest.json) is the machine-readable discovery
document. The current contract is V1:

- [Canonical JSON and digests](spec/v1/canonical-json.md)
- [Ontology](spec/v1/ontology.md)
- [Schema evolution](spec/v1/schema-evolution.md)
- [Graph and operations](spec/v1/graph.md)
- [SQLite storage](spec/v1/storage.md)
- [Sync protocol](spec/v1/sync.md)
- [Local embedding profile](spec/v1/embedding.md)
- [Compatibility and migration](spec/v1/migration.md)

The JSON Schemas describe exchange envelopes. Runtime parsers additionally
enforce canonical ordering, byte limits, referential integrity, and digest
preimages that JSON Schema cannot express.

## Contribute

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing a wire contract or
migration. Report security issues through the private process in
[SECURITY.md](SECURITY.md).

Oh is available under the [MIT License](LICENSE).
