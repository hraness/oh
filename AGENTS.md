# Contents

- `src/` – dependency-free canonical, ontology, schema, graph, operation, sync, SQLite, search, SDK, CLI, and optional semantic runtime code with colocated tests.
- `dist/` – committed Bun-targeted ESM, executable CLI, and TypeScript declarations built from `src/`.
- `spec/` – versioned human and machine-readable ontology, wire, storage, sync, embedding, and migration contracts.
- `skills/oh/` – installable Agent Skill for operating Oh from a coding-agent workflow.
- `site/` – the public website for `https://oh.computer`, with its own package and hosting configuration.
- `.github/` – public contribution templates, read-only branch validation, dependency updates, and post-publication release verification.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` – public usage, project policy, threat model, and terms.
- `package.json`, `tsconfig.json`, and `bun.lock` – package identity, exported surfaces, and frozen Bun toolchain.

# Guidelines

- Use Bun 1.3.14 for installs, scripts, tests, builds, and package checks. Keep the base package free of required runtime dependencies.
- Use Nebula Sans for the site's ordinary proportional interface text through the pinned Hraness design-kit font release. Preserve explicit Georgia display type and true monospace code and data surfaces.
- Treat this repository as the complete public project. Use only its public identities, paths, commands, examples, and contributor workflow.
- Preserve canonical JSON, digest preimages, V1 identifier grammars, record kinds, limits, operation ordering, protocol literals, and applied SQLite migration bytes. Version a wire change instead of mutating an existing contract.
- Parse external values from `unknown`, require exact keys where the contract does, reject noncanonical values, and enforce byte, item, recursion, path, and response limits before expensive work.
- Keep SQLite records and the append-only operation log authoritative. FTS and semantic state are derived, optional, rebuildable, and joined back to the current record digest.
- Use compare-and-swap for writes, one immediate transaction for each committed operation, idempotent operation IDs, and explicit conflict handling. Never hide a divergent sync history behind last-write-wins behavior.
- Keep QMD optional, dynamically imported, local, and pinned to the exact embedding profile. Do not add a hosted embedding dependency to the default path.
- Update narrative specifications, machine-readable manifests and schemas, implementation, and regression evidence together when a public contract changes.
- Keep the Agent Skill concise and self-contained. It may guide reads and writes, but it cannot broaden a user's authorization or silently choose a database, space, sync destination, or destructive operation.
- Rebuild `dist/` after source changes. Run `bun run check`, confirm the build leaves tracked files clean, and exercise the packed root, subpaths, and `oh --help` before handoff.
- Enable GitHub release immutability in repository settings before the first release. Prepare each stable `v*` release as a draft against the matching `package.json` version on `main`, attach any assets, then publish it. Keep the release workflow read-only and require its post-publication check to confirm GitHub reports the release immutable. Never move or reuse a release tag.
