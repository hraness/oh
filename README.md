# Oh

[![skills.sh](https://skills.sh/b/hraness/oh)](https://skills.sh/hraness/oh)

Oh is open-source memory for agents that stores each fact with its sources and every change in a history you can replay.

You get a TypeScript SDK, a CLI, and an Agent Skill. All three read and write
the same versioned records and the same append-only log of operations. The
default store is one SQLite file on your machine: it needs no account and no
hosted model, and its search indexes can be deleted and rebuilt.

[Website](https://oh.computer) · [Versioned specification](spec/README.md) ·
[Agent Skill](skills/oh/SKILL.md)

Latest release: [v0.12.0](https://github.com/hraness/oh/releases/tag/v0.12.0)
on [npm](https://www.npmjs.com/package/@hraness/oh), free and MIT licensed.

## Why Oh

- **Every record says what it is.** A record declares a kind, a stable key, the
  keys it depends on, and its content as canonical JSON (one fixed byte
  encoding, so equal content always has the same SHA-256 digest). The ontology
  and schemas that give kinds their meaning are versioned. Oh checks shape and
  references; it cannot tell whether a statement is true.
- **Every change is on the record.** A write names the head it expects (the
  space’s current generation and operation digest) and fails if another writer
  moved it first. Accepted operations are digested, chained to their parent,
  and never rewritten, so `oh verify` can replay the history and compare. A
  digest shows that bytes changed; it does not encrypt data or identify who
  wrote them.
- **The file you control is the source of truth.** Records and operations live
  in one SQLite file. Sync is a step you call, with a transport you supply, and
  it accepts only histories that extend yours, after both sides confirm the same
  contract (the versions of the record format, ontology, and schemas). Two
  histories that diverge stop with a conflict for you to resolve.
- **Search indexes are copies.** The keyword index, optional local embeddings,
  and the optional hosted vector cache are built from current records and
  rejoined to them by digest before a result is returned. Deleting an index
  loses speed, never data.
- **Rules derive facts without writing them.** Recursive rules run against one
  graph head and return rows with proofs. The rows are output you can throw
  away; saving one as knowledge takes your own reviewed write.
- **Agents get scratch space apart from reviewed memory.** The memory
  entry point pairs a working store the host can purge with a reviewed store
  pinned at one head, and every answer says which store each premise came
  from. Moving working records into the reviewed store goes through a host
  call the agent never sees. See [Give an agent working memory](docs/working-memory.md).

[The thread through hraness](https://hraness.com/writing/the-thread-through-hraness)
follows this design across the projects, and the
[ALGAL vision](https://algal.computer/docs/vision/) states the bet behind it.

## Install and first run

The installation instructions below use `0.12.0`, the
[verified public release](https://github.com/hraness/oh/actions/runs/35900362605).

[Bun 1.3.14 or newer](https://bun.sh/docs/installation) is required for the
CLI, the SDK, and the SQLite store. The runtime-neutral store interfaces and the
direct libSQL store also run on Node 24 and in serverless functions. Install
the release from npm:

```sh
bun add --global @hraness/oh@0.12.0
oh --help
```

The same package bytes and their checksum are attached to the
[immutable GitHub Release](https://github.com/hraness/oh/releases/tag/v0.12.0):
[`hraness-oh-0.12.0.tgz`](https://github.com/hraness/oh/releases/download/v0.12.0/hraness-oh-0.12.0.tgz)
and
[`SHA256SUMS`](https://github.com/hraness/oh/releases/download/v0.12.0/SHA256SUMS).

Oh writes to `.oh/oh.sqlite` and the `default` space unless you choose another
path or space. Every command except `oh contract` and `oh version` creates that
directory, file, and space if they are missing. Keep `.oh/` out of source
control.

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

This stores one entity, reads it back, finds it through the keyword index, and
replays the log to check it. It needs no account, hosted model, remote
database, or semantic-search package. `oh get` prints the record as one line of
canonical JSON; here it is with line breaks added:

```json
{
  "dependencies": [],
  "key": "entity:ada-lovelace",
  "kind": "entity",
  "recordSha256": "fcfe318e7248366d2408d1fa392268ac16490e72487079956c20db96b8369449",
  "v": 1,
  "value": { "name": "Ada Lovelace", "role": "mathematician" }
}
```

The digest is the same on every machine because it covers only the record.
`oh verify` ends with `"operations":1,"records":1,"sqliteIntegrity":"ok"`.

The CLI may print an occasional note about optional development support on
stderr. It never changes stdout or exit codes, CI turns it off, and
[Optional development support](docs/development-support.md) explains how to
switch it off yourself.

## How Oh behaves

Commands print canonical JSON, except `oh version` and help. A missing `oh get`
record exits with status 3. Invalid input, an integrity failure, or a
concurrent head conflict exits with status 1 and leaves the log as it was.

`oh contract` prints the ontology, graph, schema, and SQLite versions compiled
into the installed runtime. Opening a database checks that the contract stored
in it matches that runtime, and refuses to open it otherwise.

A space holds one current graph and one append-only chain of operations:

- A record has a stable key, one declared kind, ordered dependencies, any
  canonical JSON content, and a SHA-256 digest over all of that.
- An operation puts or tombstones (deletes) records in one `BEGIN IMMEDIATE`
  transaction. Before the head moves, the store compares the caller’s expected
  generation and operation digest with the current head and refuses a stale one.
- Each operation’s digest covers its parent operation, the resulting graph
  revision and record set, the contract, the actor, the timestamp, and the
  sequence number.
- The SQLite records and the operation log are the source of truth. The FTS5
  keyword index and local embedding files are copies that can be rebuilt.
- Sync exchanges size-limited bundles of operations after both sides confirm
  the same contract. Only a history that extends the other side’s is applied
  automatically; a divergent history stops with a conflict.
  [Fast-forward sync](docs/sync-runtime.md) shows the libSQL and Turso
  transport. For offline transfer, `oh sync export` writes a bundle to stdout
  and `oh sync import --file <path>` checks it and applies it in one
  transaction, or not at all.

Version 1 of the ontology names seven core ideas: entity, statement,
assertion, evidence, context, inquiry, and projection. The graph format also
carries schema, vocabulary, review, rights, edition, and activity records.
Meaning specific to an application belongs in registered codecs and versioned
schema records, where anyone reading the data can find it.

## Follow a question to its answer

A research application can map familiar work onto Oh records, so each step
of a review is a record you can open:

| Research object | Oh record kind | What you can inspect |
| --- | --- | --- |
| Question | `inquiry` | The question and its durable investigation trail. |
| Source | `entity` | A stable identity for a paper, dataset, person, or system. |
| Capture | `edition` | A size-limited source edition or extract under an application profile. |
| Claim | `statement` | The proposition, separate from who accepts it. |
| Citation | `evidence` | How a passage, table, or observation bears on an assertion. |
| Artifact | `view` | A derived brief or answer with addressable inputs. |

An attributable `assertion` sits between a claim and the evidence that bears on
it. A small review leaves a path you can walk, where a chat answer leaves one
paragraph:

```text
inquiry:primary-endpoint
  → entity:trial-report
  → edition:trial-report-v1
  → statement:endpoint-12-weeks
  → assertion:endpoint-12-weeks
  → evidence:table-2
  → view:review-brief
```

The [homepage trace](https://oh.computer/#trace) shows the CLI read and an
illustrative evidence record that passes its schema. It models how records
point to their sources; it makes no claim about a real study.

For research data there is an optional profile with 14 domain vocabularies,
source-preserving imports from Wikidata captures, and research packets that
Oh validates before storing. [The research profile](docs/research-profile.md)
lists each catalog, the version that added it, and what it covers.

## Use the SDK

For a project dependency, pin the same immutable release in `package.json`:

```json
{
  "dependencies": {
    "@hraness/oh": "0.12.0"
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
  // Recall fuses several searches and can add records from a date window: spec/v1/recall.md
  console.log((await oh.recall(["Ada", "engine"], { asOf: null })).results.length);
  console.log(oh.verify());
} finally {
  await oh.close();
}
```

Pass the head you reviewed when concurrent writers matter. After an
`OhConflictError`, read the new head and records, reconcile your change, and
submit a new operation; retrying the same call fails the same way.

[Call Oh from TypeScript](docs/sdk.md) covers every SDK method, batch writes,
error classes, and the table of entry points (`@hraness/oh/store`,
`@hraness/oh/libsql`, `@hraness/oh/sqlite`, `@hraness/oh/sync`,
`@hraness/oh/projection`, `@hraness/oh/memory`, and the rest), with the
runtimes each one is tested under.

### Use the best configured retrieval

With no `mode`, search and recall pick the strongest path you have configured:
local reranking when a reranker is present, hybrid keyword and semantic search
when a semantic backend is present, and keyword search otherwise. There is no
experimental switch. Pass `mode` when you need a particular policy or a
reproducible comparison. A backend that is missing adds a diagnostic to the
response and leaves the other results in place.
[Search and recall](docs/search.md) shows how to add local embeddings, a local
reranker, or the hosted cache, and what each costs.

## Give Oh to a coding agent

The repository includes an installable Agent Skill at
[`skills/oh`](skills/oh/SKILL.md). Copy or link that directory into the skill
location your agent runner uses. The skill teaches an agent to read the
contract and current head, write with the expected generation, verify the
replay, and sync only where you tell it to.

You can also give an agent this prompt:

```text
Install @hraness/oh@0.12.0 from npm and use its packaged Oh Agent Skill. The
exact npm tarball and SHA256SUMS are mirrored by the immutable v0.12.0 Release at
https://github.com/hraness/oh/releases/tag/v0.12.0. Verify the CLI with
`oh --help` and `oh version`.
Do not create or modify an Oh database until I name its path and ask you to.
```

## Limits

- Digests detect changed contract, record, operation, and bundle bytes. They do
  not encrypt data, authenticate an actor, authorize a write, or prove that a
  research statement is true.
- Oh does not redact record values. Protect the database, filesystem, backups,
  and any sync destination according to the sensitivity of what you store.
- The optional QMD semantic cache holds text derived from records. Its model
  and inference stay local, but the cache needs the same care as the records.
- The libSQL sync transport checks the contract and that histories extend each
  other. You handle credentials, transport security, access control, tenant
  isolation, backup, retry, and remote availability.
- Divergent histories never merge automatically. Oh reports the conflict and
  leaves reconciliation to you.
- Derived rows and proofs are disposable output. Publishing one as knowledge
  takes an application-level review and a new write to the graph.

Read [SECURITY.md](SECURITY.md) for the full public threat model.

## Benchmarks

On all 500 [LongMemEval-S](benchmarks/LONGMEMEVAL_S_500_RESULT_V1.md)
questions, with GPT-5 mini answering each question three times and GPT-4o
judging with LongMemEval’s prompts, Oh semantic retrieval scored **88.87%** and
BM25 keyword retrieval **86.13%** (mean of three runs). On questions answered
correctly in at least two of three runs, the measure fixed before the runs, Oh
leads BM25 by 2.8 points with a 95% interval from 0.0 to 5.6, which does not
rule out a tie. A lab pipeline that gives the model every message the user
wrote, plus the assistant replies retrieval ranks highest, scored **93.07%**
(474 of 500 on the two-of-three measure). Its instructions and rules were
written after studying all 500 questions, so that score is in-sample, and the
pipeline is not part of the package. The
[benchmark report](https://oh.computer/blog/longmemeval-s-user-log) explains how
it works and what the study cost.

The [SDK retrieval evaluation](benchmarks/SDK_RETRIEVAL_QUALIFICATION_RESULT_V1.md)
scored **80.59%** answer accuracy with the configured default reranking against
**69.86%** for matched semantic retrieval, a gain of **10.73 percentage
points**. Both personas improved, and evidence recall@10 rose from **12.05% to
26.10%**. All 876 reader cases completed on 146 development questions the
project had already seen, with three repeats per arm. A separate comparison
against ordinary hybrid retrieval, with fresh reader responses, scored **80.59%
against 64.16%**; the two candidate samples are kept apart even though their
scores match. The reader was the Gateway GPT-4o mini alias, scored by exact
option ID with no judge. The route met its development thresholds only by
counting one handled Metal startup message as allowed; a rule allowing no error
logs at all would have failed it. No reranker run or cleanup failed. This is a
development result, with no untouched holdout and no population-level
confidence claim. Both comparisons used 1,752 reader calls and cost
**$1.461086**.

In the earlier [CloneMem reserved-persona study](benchmarks/CLONEMEM_RERANK_CONFIRM_RESULT_V1.md),
Oh’s combined lexical and vector candidates with local Qwen3 reranking scored
**77.82%** answer accuracy against **70.54%** for vector retrieval, a paired
gain of **7.28 percentage points** with a 95% persona-cluster bootstrap
interval of **+4.61 to +10.27 points**. The study covers 861 questions from
seven personas, three reader repeats per arm, and 5,166 completed cases. Mean
evidence recall@10 rose from **14.48% to 32.80%**, with **22.1% fewer context
bytes**. The seven personas were held out from immediate development, but the
project had seen the data before. Two failed campaign attempts were excluded
under a retry rule added during the run; their captures and costs are recorded.
An [independent audit](benchmarks/CLONEMEM_RERANK_CONFIRM_AUDIT_V2.md)
reproduced the scores and interval, and counting every missing first-attempt
response against Oh left a gain of 6.16 points. The reader was the Gateway
GPT-4o mini alias, with no verified fixed snapshot, and the scores describe
that study’s renderer and candidate preparation, not every SDK deployment.

In the [matched framework pilot](benchmarks/FRAMEWORK_PILOT_RESULT_V1.md),
Supermemory scored **75.00%**, Oh **71.67%**, and a BM25 baseline **68.33%**.
The paired Oh and Supermemory difference was **−3.33 points**, with a 95%
within-type bootstrap interval from −13.33 to +6.67 that includes zero. All
three shared the same 60 LongMemEval-S questions the project had already seen,
a single query, a 20-item retrieval limit, an 8,192-token evidence renderer, a
GPT-4o reader, and a fixed-rubric judge, with every planned case counted. The
pilot is one configuration on development data.

Oh has not shown that it outperforms Letta, Supermemory, or other memory
frameworks. Published results from other projects use their own protocols, and
the [website comparison](https://oh.computer/#benchmarks) keeps them apart from
Oh’s matched runs. A comparison between frameworks needs a common dataset,
reader, scoring procedure, context allowance, failure accounting, and
production adapter.

Results that did not pass are kept. On LoCoMo, query-aware packing raised
evidence recall (90.08% against 88.93%) without an answer-quality gain (77.33%
against 78.11%). Earlier CloneMem hybrid and keyword-fusion screens also missed
their answer-quality targets. The
[experiment history and reproduction guide](benchmarks/README.md) lists every
study.

Run the network-free state and projection checks from a checkout:

```sh
bun run test:benchmarks
bun run bench:memory state
bun run bench:memory projection
```

The state suite checks updates, conflicts, provenance, and stale-write rejection.
Reusing canonical tuple keys cut local median projection time by 25% to 34%
across the recorded 16-, 32-, and 48-node cases, with identical result digests,
proofs, and work counts. These microbenchmarks do not predict production
latency.

The [memory benchmark guide](benchmarks/README.md) covers checksum-pinned
datasets, raw and extracted memory comparisons, spending limits for paid runs,
recorded reader results, and how to reproduce each one. Retrieval recall,
answer quality, and how an agent writes memory are measured separately. The
benchmark adapters exist to reproduce past studies; the SDK defaults are
described in [Use the SDK](#use-the-sdk).

## Verify a checkout

```sh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

`bun run check` type-checks the package, runs every test, rebuilds the
committed `dist/` entry points, and fails if any tracked file changes.

## Specification

[`spec/manifest.json`](spec/manifest.json) is the machine-readable index of the
contracts. The current contract is version 1:

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

The JSON Schemas describe the exchanged formats. The runtime parsers also
enforce canonical ordering, byte limits, references between records, and the
exact bytes each digest covers, which JSON Schema cannot express.

## Who builds on Oh

Use Oh to build an application’s memory layer. Use Wordcell to maintain and query a Markdown knowledge base.
Each consumer pins an immutable release and upgrades on its own schedule:

- [Wordcell](https://wordcell.io)
  ([source](https://github.com/hraness/wordcell)) is a knowledge base for
  agents: markdown, backlinks, search, ontology, and git context. Its Markdown
  vault is the only source of truth. `wordcell graph rebuild` writes a
  disposable, gitignored `.wordcell/oh.sqlite` copy of the graph, and no query
  or rebuild writes back into notes.
- [Sponge](https://sponge.computer) builds deep research tools for connected,
  cited knowledge, exploring self-evolution. Its server-side agents use the Oh
  store, the libSQL store, rules, and the memory host as working memory, and
  that store is the source of truth.

[Oh and Wordcell](docs/wordcell.md) explains where one ends and the other
begins. Wordcell measures its own search pipeline; Oh’s memory benchmark
scores do not carry over to it.

## Find the right documentation

- **Try it:** [Install and first run](#install-and-first-run).
- **Build on it in TypeScript:** [Use the SDK](#use-the-sdk), then
  [Call Oh from TypeScript](docs/sdk.md) and
  [Search and recall](docs/search.md).
- **Store data somewhere other than a local file:**
  [Direct libSQL store](docs/libsql-runtime.md) and
  [Fast-forward sync](docs/sync-runtime.md).
- **Give an agent memory:** [Give an agent working memory](docs/working-memory.md),
  [Memory pages and `.oh.md` files](docs/memory-pages.md), and
  [How memory host calls run](docs/memory-runtime.md).
- **Derive facts with rules:** [Derive facts with rules](docs/projections.md).
- **Run semantic search:**
  [Local semantic backend lifecycle](docs/semantic-lifecycle.md) and
  [Hosted semantic cache V2 lifecycle](docs/hosted-semantic-runtime.md).
- **Store research sources:** [The research profile](docs/research-profile.md).
- **Hand Oh to an agent or work with a Markdown vault:** the
  [Oh Agent Skill](skills/oh/SKILL.md) or [Oh and Wordcell](docs/wordcell.md).
- **Implement or change a contract:** start at the
  [specification map](spec/README.md), then read the version 1 text and its
  JSON Schema together.
- **Contribute or report a vulnerability:** [CONTRIBUTING.md](CONTRIBUTING.md)
  or the private process in [SECURITY.md](SECURITY.md).

## Contribute and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing a wire format or a
migration. Report security issues through the private process in
[SECURITY.md](SECURITY.md).

Oh is available under the [MIT License](LICENSE).
