# Contributing

Oh accepts focused issues and pull requests for the ontology kernel, local
runtime, protocol documentation, Agent Skill, and website.

## Prepare a checkout

Use Bun 1.3.14 so local results match continuous integration.

```sh
git clone https://github.com/hraness/oh.git
cd oh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

`bun run check` type-checks, runs the complete test suite, and rebuilds the
committed `dist/` entrypoints. It must finish without changing tracked files.

## Make a change

- Add a focused regression test for behavior changes. Add property tests for
  parsers, ordering, digest round trips, replay, and sync laws.
- Treat foreign input as `unknown` and validate it before use. Bound bytes,
  items, recursion, paths, subprocesses, and remote responses.
- Preserve deterministic output. Never depend on locale, insertion order,
  wall-clock timing, or a mutable hosted model for a contract digest.
- Keep SQLite authoritative. Search documents, FTS rows, and embeddings must
  remain derived, rebuildable, and rejoined to an exact current record digest.
- Keep `@tobilu/qmd` optional and dynamically loaded. The root package and
  non-semantic entrypoints must work without it.
- Update the matching page under `spec/` when a public behavior or limit
  changes. Update machine-readable schemas and discovery documents in the same
  pull request.

## Change a contract

V1 serialized bytes are immutable. Do not change a digest preimage, domain
separator, canonical ordering rule, record kind, identifier grammar, migration
body, or protocol meaning under an existing version.

An additive runtime API change may retain the current contract when it does not
alter persisted or exchanged bytes. A wire change needs a new version, an
explicit compatibility decision, fixtures proving old and new behavior, and a
migration or coexistence path. Applied SQLite migration names and SQL digests
must never change.

## Submit a pull request

Explain the user-visible outcome, the invariant affected, and the verification
you ran. Keep generated `dist/` changes in the same commit as their source.
Avoid unrelated formatting or dependency updates.

Use the private process in [SECURITY.md](SECURITY.md) for vulnerabilities.
