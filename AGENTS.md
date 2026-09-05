# Contents

- `src/` – dependency-free canonical, ontology, schema, graph, operation, sync, SQLite, search, SDK, CLI, and optional semantic runtime code with colocated tests.
- `dist/` – committed Bun-targeted ESM, executable CLI, and TypeScript declarations built from `src/`.
- `spec/` – versioned human and machine-readable ontology, wire, storage, sync, embedding, and migration contracts.
- `skills/oh/` – installable Agent Skill for operating Oh from a coding-agent workflow.
- `site/` – the public Next.js website for `https://oh.computer`, deployed from the existing Hraness Vercel project.
- `.agents/skills/` – portable plan authoring, phased execution, implementation, and independent review workflows.
- `.github/` – public contribution templates, branch validation, dependency updates, and exact-artifact release automation.
- `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `LICENSE` – public usage, project policy, threat model, and terms.
- `STYLE.md` – the public and reader-facing prose contract.
- `package.json`, `tsconfig.json`, and `bun.lock` – package identity, exported surfaces, and frozen Bun toolchain.

# Guidelines

- Use Bun 1.3.14 for installs, scripts, tests, builds, and package checks. Keep the base package free of required runtime dependencies.
- Follow `STYLE.md` for the public website, specifications, documentation, README, and Agent Skill prose.
- Keep `site/` deployable as an ordinary Vercel Next.js root. Do not add OpenAI Sites, Vinext, Cloudflare Worker, Wrangler, or alternate hosting configuration.
- Build the site on the pinned Hraness design-kit release and its `product-marketing` grammar: Nebula Sans for every proportional text and display role, light appearance by default with dark mirrored through `prefers-color-scheme`, sentence-case labels, and one accent. Keep true monospace for code, commands, and data surfaces only.
- Treat this repository as the complete public project. Use only its public identities, paths, commands, examples, and contributor workflow.
- Follow the shared [Hraness README guidelines](https://github.com/hraness/.github/blob/main/README_GUIDELINES.md). Keep the durable definition, mechanism-backed rationale, shortest verified first task, observable behavior, boundaries, verification, and task-oriented documentation path current.
- Preserve canonical JSON, digest preimages, V1 identifier grammars, record kinds, limits, operation ordering, protocol literals, and applied SQLite migration bytes. Version a wire change instead of mutating an existing contract.
- Parse external values from `unknown`, require exact keys where the contract does, reject noncanonical values, and enforce byte, item, recursion, path, and response limits before expensive work.
- Keep SQLite records and the append-only operation log authoritative. FTS and semantic state are derived, optional, rebuildable, and joined back to the current record digest.
- Use compare-and-swap for writes, one immediate transaction for each committed operation, idempotent operation IDs, and explicit conflict handling. Never hide a divergent sync history behind last-write-wins behavior.
- Keep QMD optional, dynamically imported, local, and pinned to the exact embedding profile. Do not add a hosted embedding dependency to the default path.
- Update narrative specifications, machine-readable manifests and schemas, implementation, and regression evidence together when a public contract changes.
- Keep the Agent Skill concise and self-contained. It may guide reads and writes, but it cannot broaden a user's authorization or silently choose a database, space, sync destination, or destructive operation.
- Rebuild `dist/` after source changes. Run `bun run check`, confirm the build leaves tracked files clean, and exercise the packed root, subpaths, and `oh --help` before handoff.
- Enable GitHub release immutability and configure npm trusted publishing for `.github/workflows/release.yml` before the next stable release. Release only a new annotated `v*` tag at exact current `main`. Build one npm tarball, test those unchanged bytes on Linux and macOS, publish them through npm OIDC with provenance, then attach that same tarball and `SHA256SUMS` to the immutable GitHub Release. Never move or reuse a release tag.

<!-- hra-local-efficiency:start -->
- Treat the user's request to change this repository as standing authorization for routine task-owned commits, pushes, pull requests, merges, releases, deployments, and production verification after the repository's required validation, review, identity, and rollout gates pass. Do not ask for another confirmation at each delivery step.
- Use the repository's documented delivery workflow and preserve every runtime-enforced approval, branch protection, environment rule, safety policy, and final gate. Ask for user input only when delivery needs a material product decision, missing credentials or authority, an irreversibly destructive action outside task scope, or resolution of a release failure that cannot be handled safely and autonomously.
- Prefer short-lived repository workload identities such as OIDC trusted publishing, GitHub Apps, and narrowly scoped machine identities. Do not add long-lived personal tokens, weaken two-factor authentication, or bypass provider controls to eliminate an interactive prompt. Batch unavoidable human-gated production promotions into intentional stable releases while agents publish validated prerelease or beta channels through workload identities when the repository supports them.
- Preserve useful reasoning fan-out, but avoid unnecessary checkout fan-out. Prefer subagents in the current task for bounded research, review, diagnosis, and focused checks when they can safely share one working tree; create a separate task or worktree only for independently deliverable divergent edits, an isolated verification tree, or a different execution environment.
- Give each expensive focused validation command and external wait one owner. The integration owner reviews that evidence and runs the repository-required aggregate or final gate once after convergence. Reuse evidence only for the exact Git tree, command, lockfiles, toolchain, relevant environment, and validity period, and never to skip a required final integration, merge, release, deployment, or production-verification gate.
- On Hraness development machines, use `$hra-local-efficiency` and the installed host scheduler for heavyweight top-level commands when available. Keep ordinary work in the compute lane; give authenticated browser/dev-server/Chromium work one `browser-auth` owner and Mac-only validation one `mac-native` owner.
- When a CI or policy gate scans complete Git history, check out the exact governed SHA and fetch only the fully qualified governed refs before scanning. Preserve the complete-history gate and reject unexpected refs instead of importing unrelated concurrent heads.
- At closeout, record applicable branch, PR, check, merge, release, deployment, and production evidence. Archive only conclusively finished tasks, never from silence alone, and reclaim only freshly revalidated clean merged worktrees through the guarded exact-path flow.
<!-- hra-local-efficiency:end -->
