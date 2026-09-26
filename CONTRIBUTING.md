# Contributing

Oh accepts focused issues and pull requests for the TypeScript library and CLI
(`src/`), the Rust crates (`rust/`), the specification (`spec/`), the Agent
Skill (`skills/oh/`), and the website (`site/`). Report vulnerabilities through
the private process in [SECURITY.md](SECURITY.md).

## Set up a checkout

CI runs `bun run check` on Linux and macOS. To get the same results on your
machine, install the toolchain it uses:

- Use macOS on Apple silicon or Intel, or Linux on x64. The check compiles a
  native SQLite helper, `oh-sqlite-cli`, for your machine and fails on any
  other platform.
- Install Bun 1.3.14.
- Install Node.js 24 or newer. CI uses 24.19.0.
- Install stable Rust through rustup, then run
  `rustup target add wasm32-unknown-unknown`. The build puts `~/.cargo/bin`
  first on `PATH`, so the rustup toolchain wins over a system or Homebrew Rust
  that may lack that target.
- Install `wasm-pack`, which the build uses to compile three of the Rust
  crates to WebAssembly.

Then clone the repository, install dependencies from the lockfile, and run the
full check:

```sh
git clone https://github.com/hraness/oh.git
cd oh
bun install --frozen-lockfile --ignore-scripts
bun run check
```

`bun run check` validates `costs.json` (the registry of data that Oh stores or
ships), builds the Rust and WebAssembly artifacts, type-checks the source and
scripts, confirms that Effect code stays inside its declared runtimes, runs the
complete test suite, and rebuilds the committed `dist/` files. It then confirms
that the portable entry points type-check and run under Node.js, that the
research entry point builds for the browser without platform imports, and that
the packed package installs, runs its CLI, and loads its root and subpath entry
points.

The check must finish without changing any tracked file. If it changes one,
as a `dist/` rebuild you forgot to commit would, CI fails. CI also fails when
the check leaves a new untracked file that `.gitignore` does not exclude.

## Make a change

- Add a focused regression test for each behavior change. Write property tests
  with `fast-check` for parsers, ordering, digest round trips, replay, and sync
  laws.
- Treat outside input as `unknown` and validate it before use. Limit bytes,
  items, recursion depth, paths, subprocesses, and remote responses, and apply
  each limit before any expensive work.
- Keep output deterministic. A digest that Oh stores or exchanges must never
  depend on locale, insertion order, wall-clock timing, or a hosted model that
  can change.
- Keep SQLite records and the append-only operation log as the source of truth.
  Search documents, FTS rows, and embeddings must stay derived and rebuildable,
  and every search result must be joined back to its record’s current digest.
- Keep `@tobilu/qmd`, the local embedding engine, optional and dynamically
  imported. The root package and the entry points that do not use semantic
  search must work without it.
- Four runtimes are built on Effect 3.22.1: the semantic lifecycle, sync, the
  memory host, and direct libSQL. Effect is a pinned build dependency that
  each of them bundles, so consumers do not install it. Follow the rules in
  each runtime’s guide: [semantic lifecycle](docs/semantic-lifecycle.md),
  [sync](docs/sync-runtime.md), [memory host](docs/memory-runtime.md), and
  [direct libSQL](docs/libsql-runtime.md).
- A new production module that uses Effect needs a declared role in
  `scripts/check-effect-architecture.ts`, or `bun run check:effect` fails.
- When a public behavior or limit changes, update the matching page in `spec/`
  and, in the same pull request, its machine-readable schemas and discovery
  documents such as `spec/manifest.json`. Copy every `spec/` change into
  `site/public/spec/`, because the `Site` job in CI and
  `tests/site-surface.test.ts` require the two directories to match byte for
  byte.
- Register each new SQLite table, Rust build artifact, or stored benchmark
  output in `costs.json`. Each entry names its kind, its retention class, and
  the source file responsible for it, and `bun run check` rejects an entry
  that lacks a field its kind requires. The check also fails when a website
  page or route forces dynamic rendering or the edge runtime without an entry.

## Change a wire contract or migration

Oh’s wire contract is every byte it stores or exchanges: records, operations,
sync bundles, digests, and the SQLite schema. Three terms come up when you
change it:

- **Canonical JSON** gives every accepted JSON value exactly one byte
  encoding. Every content digest in Oh, such as a record or operation digest,
  is SHA-256 over those UTF-8 bytes.
- A **digest preimage** is the exact set of fields a digest covers.
  [Canonical JSON and digests](spec/v1/canonical-json.md#digest-preimages)
  lists the preimage for each envelope.
- A **migration** is a numbered SQL step in `src/sqlite/migrations.ts`. Each
  database records the version, name, and SQL digest of every migration it has
  applied. If a recorded name or digest differs from the code’s migration with
  the same version, Oh refuses to open the database.

These rules protect data that already exists:

- V1 serialized bytes are immutable. Under an existing version, do not change a
  digest preimage, domain separator, canonical ordering rule, record kind,
  identifier grammar, migration body, or protocol meaning.
- Applied SQLite migration names and SQL digests must never change. To change
  the schema, add a migration with the next version, as SQLite schema version
  `2` did with `0002_store_realms`.
- An additive runtime API change can keep the current contract when the bytes
  it persists and exchanges stay the same.
- A wire change needs a new version, a written decision about compatibility,
  fixtures that prove both the old and the new behavior, and a way for
  existing data to migrate or for both versions to coexist.

## Open a pull request

Fill in the template with the user-visible outcome, the invariant your change
affects, and the checks you ran. Commit regenerated `dist/` files in the same
commit as the source that produced them, and leave unrelated formatting and
dependency updates out of the pull request.

## Validate a pull request

Run focused checks for the behavior you changed, then have a person or agent
who did not write the change review the diff. CI runs each of these checks
too:

| Change | Focused check |
| --- | --- |
| TypeScript source or tests | `bun test` on the affected files, such as `bun test ./src/store.test.ts` |
| Rust crates | `bun run rust:check`, which runs `cargo check --locked`, `cargo clippy -- -D warnings`, and `cargo test --locked` in `rust/` |
| Specification | `diff -qr spec site/public/spec` |
| Website | `bun install --frozen-lockfile --ignore-scripts`, `bun run lint`, and `bun run build` in `site/` |

CI also tests the benchmark audit and supervisor tools under Python 3.14:

```sh
python3 -B -m unittest discover -s tests -p 'test_*supervisor.py'
python3 -B -m unittest discover -s tests -p 'test_gateway_v5_audit_helpers.py'
python3 -B -m unittest discover -s tests -p 'test_gateway_v6_*.py'
```

For a benchmark change, run the focused tests for the files you touched.
`bun run check` already includes every test that `bun run test:benchmarks`
selects, so that subset needs no separate run.

### Use CI as the final check

A fresh CI run can stand in for the final local `bun run check` when all of
these hold:

- The `Required` check passed. It passes only when every other job in the run
  passes: `Check` and `Rust` on Linux and macOS, `Site`, and
  `Build N-API crates` for each of its three native targets.
- The run tested the final head of the pull request against the current base.
- When you merge, neither the head nor the base has changed since the run.
- The run was not superseded, cancelled, or stale.

For a pull request, each run confirms that the commit it tests merges the pull
request head into the current tip of the base branch, and logs the tested,
head, and base SHAs. It pins Bun 1.3.14 and Node.js 24.19.0, installs from the
lockfiles without updating them, runs the full checks, and fails if the check
changes a tracked file or leaves a new untracked one.

Record the run URLs, the tested merge SHA, the head SHA, the base SHA, and the
conclusions in the pull request. One person or agent waits for CI, and nobody
needs to repeat the same full check locally while it is pending.

### When CI is not enough

CI does not replace checks that it does not run, such as private dataset
comparisons, performance runs, calls to paid providers, authenticated
behavior, native capabilities, and installation checks. For each such check,
record the inputs and the source revision it used.

These rules cover source changes only. They do not change what releases,
deployments, or production checks require.

If CI is unavailable or you are unsure what it covered, run `bun run check`
locally before you merge, and confirm that the tree stays clean.
