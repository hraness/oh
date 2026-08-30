---
name: oh
description: Operate a local hraness/oh ontology store through its checked CLI or SDK. Use when a coding agent needs to initialize, inspect, write, search, verify, export, import, or synchronize content-addressed research records in an Oh SQLite space.
---

# Operate Oh

Keep the selected SQLite space authoritative. Inspect its contract and head
before writing, use generation-checked mutations, and verify replay after a
batch of changes.

## Preserve authorization and location

- Resolve the repository instructions that apply to the target files first.
- Resolve the exact database path and space. Use `.oh/oh.sqlite` and `default`
  only when they already exist or the user chose the defaults.
- Do not run a database command against a missing path merely to inspect it.
  Oh opens and initializes the selected database as part of normal commands.
- Creating a database, tombstoning a record, importing a bundle, or syncing a
  remote requires the user's request to include that write or its direct
  workflow.
- Never put credentials, authentication tokens, or sensitive source text into
  a record unless the user explicitly selected an appropriately protected
  database and destination.

`oh --help` and `oh version` are side-effect-free installation checks:

```sh
oh --help
oh version
```

The supported CLI is `@hraness/oh@0.2.0` from the immutable `v0.2.0` GitHub
tag. It requires Bun 1.3.14 or newer. The versioned contract is published at
<https://oh.computer/spec/>.

## Open an existing space

Confirm that the exact database is a regular file before a read command. First
inspect the installed runtime contract, then replay the database operation log:

```sh
test -f .oh/oh.sqlite
oh contract
oh verify --db .oh/oh.sqlite --space default
```

Stop if the installed contract differs from `oh.ontology.v1`, opening the
database reports a stored-contract mismatch, replay fails, or the user named
another database. Do not repair an integrity or contract failure by deleting
state.

Use the narrowest read:

```sh
oh get entity:ada-lovelace --db .oh/oh.sqlite --space default
oh list --kind statement --limit 50 --db .oh/oh.sqlite --space default
oh log --limit 20 --db .oh/oh.sqlite --space default
oh search "analytical engine" --mode keyword --limit 10 \
  --db .oh/oh.sqlite --space default
```

A missing `get` exits with status 3 and prints no record. Treat it as absence,
not a corrupt database. CLI output is canonical JSON, so parse it rather than
scraping presentation text.

## Initialize only when requested

Choose a confined path owned by the user's task. Do not overwrite or merge an
unrelated database.

```sh
oh init --db .oh/oh.sqlite --space default
oh verify --db .oh/oh.sqlite --space default
```

Record the returned head. Add the database directory to the repository's
ignore rules when it is local working state.

## Write one checked record

Choose a stable lowercase logical key and one V1 kind. Current kinds include
`entity`, `statement`, `assertion`, `evidence`, `context`, `inquiry`, `schema`,
`vocabulary`, and the remaining kinds printed by `oh contract`.

1. Read every declared dependency with `oh get`.
2. Run `oh verify` and take `head.generation` from its JSON result.
3. Prepare one valid JSON value. Prefer `--file` for structured or multiline
   content and `--json` for a short literal.
4. Use a stable operation ID when an exact retry must be idempotent.
5. Pass the reviewed generation.

```sh
oh put \
  --kind statement \
  --key statement:ada-program \
  --depends-on entity:ada-lovelace \
  --file /absolute/path/to/statement.json \
  --actor agent.local \
  --operation op_ada_program_v1 \
  --expected-generation 4 \
  --db .oh/oh.sqlite \
  --space default
```

If the expected generation is stale, read the new head and affected records,
reconcile the intended change, and create a new operation. Do not loop on a
conflict or change the expected generation without reviewing intervening work.

After a write batch, run:

```sh
oh verify --db .oh/oh.sqlite --space default
```

## Tombstone deliberately

A tombstone removes the current record from the materialized graph while the
operation remains in history. Confirm the exact key and current digest. Check
that no retained record depends on it. Then require the reviewed generation:

```sh
oh tombstone statement:obsolete \
  --expected-generation 5 \
  --operation op_remove_obsolete_v1 \
  --db .oh/oh.sqlite \
  --space default
```

Run replay verification immediately. Do not edit SQLite tables directly to
bypass dependency or compare-and-swap checks.

## Search with explicit evidence lanes

Use `keyword` for the model-free CLI path. `semantic` and `hybrid` need an SDK
instance configured with the optional local QMD backend. If a response contains
`semantic-unavailable`, report that diagnostic and preserve any keyword result;
do not substitute a hosted model.

Treat a search score as retrieval evidence, not proof that a research claim is
true. Open the returned record and its dependencies before relying on it.

## Export or import an operation bundle

An export is read-only but writes a file when redirected. Choose the output
path explicitly and protect it like the source research:

```sh
oh sync export --after 0 --limit 1000 \
  --db .oh/oh.sqlite --space default > /absolute/path/to/oh-bundle.json
```

Before import, preserve the destination, inspect its contract and head, and
confirm the bundle belongs to the same space. Import is sequential rather than
bundle-atomic: if a later operation conflicts, an earlier valid prefix may
already be present. After an error, inspect the destination head and run replay
verification before retrying.

```sh
oh sync import --file /absolute/path/to/oh-bundle.json \
  --db .oh/oh.sqlite --space default
oh verify --db .oh/oh.sqlite --space default
```

Remote libSQL or Turso sync is an SDK workflow. The user must select the remote
and credential source. Never print credentials or embed them in records. Oh
settles fast-forward histories only; preserve both logs when it reports a
divergence.

## Use composite memory only through host bindings

`@hraness/oh/experimental/memory` is an SDK-only surface. Do not let a model
construct its options. Trusted application code must bind two distinct
authority handles, exact binding digests, a pinned canonical head, working
codecs, a working actor, domain extractor relation ownership and digests,
host-purposed named rule/query programs, and named nomination routes before
giving the returned object to an agent.

The agent-facing object may call only `remember`, `query`, `explain`, and
`nominate`. Never add a tool parameter for a database path or URL, authority,
realm, space, store profile, rule pack, raw query, sync destination, canonical
write, caller-asserted actor/time, or purge operation. Preserve lane, conflict,
fact-policy, and premise-authority labels in query output. Treat every result
as derived. A nomination may select only a host-registered route and is a
prepared dependency-closure candidate for destination-owned review, not
permission to write durable knowledge or import the working operation chain.

## Finish with evidence

Report the exact database and space, reads or mutations performed, final head
generation and operation digest, replay result, search diagnostics, and any
sync counts. Do not claim success from a command exit alone when `oh verify`
was part of the requested workflow.
