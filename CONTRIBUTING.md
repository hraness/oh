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

`bun run check` type-checks, enforces the declared Effect boundaries, runs the
complete test suite, and rebuilds the committed `dist/` entrypoints. It must
finish without changing tracked files.

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
- Keep the local semantic lifecycle within its [documented ownership and
  validation boundaries](docs/semantic-lifecycle.md), and sync in its
  [service and transaction boundaries](docs/sync-runtime.md). Effect is an exact
  build dependency bundled into the admitted runtime graphs; consumers do not
  install it.
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

## Validate a pull request

Run focused checks for the changed behavior locally and obtain independent diff
review. Keep source changes and any required generated `dist/` updates together.
The complete test suite in `bun run check` includes every test selected by
`bun run test:benchmarks`, along with strict typing, Effect boundaries, builds,
Node portability, and packed-package root, subpath and CLI smoke checks.

Fresh PR CI may serve as the final source aggregate when both `Check` operating
systems, `Site`, and all other required checks succeed for the exact final head
and current base. The workflow records and verifies the tested merge commit and
its head/base parents, pins Bun 1.3.14 and Node.js 24.19.0, installs the frozen
lockfiles, runs the full checks, and rejects changed tracked or new untracked
files after the build. Record the run URLs, tested merge SHA, head SHA, base SHA
and conclusions in the PR. Check that neither head nor base has changed before
admission; a superseded, cancelled or stale run is insufficient. One owner waits
for CI. An equivalent local aggregate need not run again while CI is pending.

CI does not replace private dataset comparisons, coupled performance runs,
paid/provider accounting, authenticated behavior, native capabilities or
installation checks it does not execute. Preserve those task-specific receipts
and their exact input/source identities. These source-gate rules do not change
release, deployment, production verification or runtime approval requirements.
If CI is unavailable or its coverage is uncertain, run the complete local
aggregate through the repository and host schedulers before admission.
