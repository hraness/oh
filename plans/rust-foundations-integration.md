# Rust Foundations Integration Roadmap

Follow-up to `rust-foundations.md`. The foundational crates are implemented and
proved through property/vector tests; this plan ships them to downstream
consumers and hardens the surface.

## Constraints (carried forward)

- `oh` remains free of required runtime dependencies. Rust artifacts are
  optional or bundled.
- Convex (Sponge) supports WASM, not native add-ons.
- Each consumer upgrades independently via immutable release tags or full commit
  pins; do not coordinate `main` branches.
- Preserve every existing public API and wire contract. New Rust paths are
  opt-in until proven, then default-on with a safe fallback.
- Every new data surface registers in `costs.json` and passes
  `bun run check:cost-surfaces`.

## Phases

| Phase | Name | Depends on | Repository(s) |
|---|---|---|---|
| A | Ship Rust WASM artifacts in `@hraness/oh` releases | Phases 1–11 | `hraness/oh` |
| B | Migrate Sponge, Wordcell, Textbutler off vendored blobs | Phase A | sponge, wordcell, textbutler |
| C | Flip Rust paths to default-on with fallback telemetry | Phase B | oh, sponge, wordcell, textbutler |
| D | Integrate archive / SQLite / Datalog engines downstream | Phase C | sponge, wordcell, textbutler, oh |
| E | Hardening: control-socket/protected-input Rust port, property tests, cross-platform N-API | Phase A | local-custody, oh |

## Phase A: Ship Rust WASM artifacts in `@hraness/oh` releases

- **Status:** In progress
- **Objective:** The `@hraness/oh` npm package ships the built Rust WASM/N-API
  artifacts as first-class files so downstream packages can import them instead
  of vendoring blobs.
- **Scope:** `package.json`, `scripts/build-rust-artifacts.ts`,
  `src/canonical-rust.ts`, `costs.json`, release workflow.
- **Approach:**
  - Add `scripts/build-rust-artifacts.ts` that:
    - builds `oh-canonical-wasm`, `oh-canonical-raw-wasm`, `oh-archive-wasm`,
      `oh-archive-strict-wasm`, and `oh-datalog-wasm`;
    - copies the loadable outputs into `rust-artifacts/<crate>/`;
    - for `oh-canonical-raw-wasm`, also emits a `artifact.ts` with base64 + SHA-256.
  - Add `rust-artifacts/` to `package.json` `files` and add conditional exports
    such as `./canonical-rust` and `./archive-strict-wasm`.
  - Update `src/canonical-rust.ts` to resolve the WASM module from the packaged
    `rust-artifacts/` location, with a source-time fallback to `rust/` for
    local development.
  - Include `rust:build:artifacts` in the release `verify` job before `npm pack`.
- **Acceptance criteria:**
  - `bun run build` (or a dedicated `rust:build:artifacts`) produces a consistent
    `rust-artifacts/` tree.
  - `npm pack --dry-run` includes the artifacts.
  - `bun run check` passes.
- **Validation:** `bun run check && bun run ./scripts/build-rust-artifacts.ts && npm pack --dry-run`

## Phase B: Migrate downstream consumers off vendored blobs

- **Status:** Not started
- **Depends on:** Phase A
- **Objective:** Sponge, Wordcell, and Textbutler load the WASM artifacts from
  the published `@hraness/oh` package instead of checking in base64 blobs.
- **Scope:** `lib/canonical-rust.ts` and `lib/vendor/oh-canonical/` in sponge;
  `src/oh/canonical-rust.ts` and `src/vendor/oh-canonical/` in wordcell;
  `src/x-archive-zip-rust.ts` and `src/vendor/oh-archive/` in textbutler.
- **Approach:**
  - Bump `@hraness/oh` to the Phase A release in each consumer.
  - Replace vendored artifact imports with imports from
    `@hraness/oh/canonical-rust` / `@hraness/oh/archive-strict-wasm`.
  - Delete vendored files and any vendor-specific lint/pack exclusions.
  - Keep the same loader contract and fallback semantics.
- **Acceptance criteria:**
  - `bun run check` passes in each consumer.
  - No `.wasm` blobs remain under `lib/vendor/` or `src/vendor/`.
- **Validation:** `bun run check` in sponge, wordcell, textbutler.

## Phase C: Flip Rust paths to default-on with fallback telemetry

- **Status:** Not started
- **Depends on:** Phase B
- **Objective:** Make the Rust engine the default where parity is proven, while
  keeping a safe TypeScript fallback and surfacing mismatch events for review.
- **Scope:** Canonical/digest loaders in sponge (`lib/digest.ts`), wordcell
  (`src/oh-adoption.ts`), and textbutler archive reader; `oh` loader if any.
- **Approach:**
  - Change `sha256CanonicalJson` and `canonicalJson` call sites to call the Rust
    path first and only fall back on mismatch or load failure.
  - Add a non-fatal `rust-engine-fallback` event (or simple stderr warning) when
    fallback is triggered, including the reason and the input shape class.
  - Keep a compile-time or environment variable escape hatch to force the TS
    reference path.
- **Acceptance criteria:**
  - Downstream tests pass with Rust as the default.
  - Forcing TS path still passes the same tests.
- **Validation:** `bun run test` in each consumer with both default and forced-TS.

## Phase D: Integrate archive / SQLite / Datalog engines downstream

- **Status:** Not started
- **Depends on:** Phase C
- **Objective:** Use the shared Rust engines for real production workloads beyond
  canonical JSON/digest.
- **Scope:**
  - **Textbutler:** route iMessage/Contacts snapshot creation through
    `oh-sqlite` (already in `@hraness/oh` after Phase A).
  - **Sponge:** use `oh-archive` for capture bundle ingestion if any ZIP-shaped
    paths exist.
  - **Wordcell:** use `oh-archive` for capture-bundle reading.
  - **oh:** expose `oh-datalog` `oh.projection.rust.v1` behind the existing
    projection engine identity.
- **Approach:**
  - Add opt-in wrappers that match each consumer's existing contract.
  - Property/vector parity tests against the current TypeScript implementation.
  - Only flip defaults where parity is green.
- **Acceptance criteria:**
  - New engine paths have dedicated tests.
  - No regression in existing test suites.
- **Validation:** `bun run check` in each affected repo.

## Phase E: Hardening

- **Status:** Not started
- **Depends on:** Phase A
- **Objective:** Close remaining gaps in the Rust surface.
- **Scope:** `local-custody/rust/`, `oh/rust/`, release/CI matrices.
- **Approach:**
  - Port `local-custody` `control-socket` and `protected-input` to Rust with
    vector tests.
  - Add property tests for `oh-archive` malformed ZIP handling and
    `oh-datalog` budget enforcement.
  - Add a cross-platform N-API build matrix for Bun consumers that want native
    speed where WASM is not enough.
  - Optionally run `wasm-opt` on shipped WASM artifacts with size budgets in
    `costs.json`.
- **Acceptance criteria:**
  - `cargo test` and `bun run check` pass in `local-custody` and `oh`.
  - N-API artifacts build on Linux/macOS CI.
- **Validation:** `cargo test --locked && bun run check`.

## Implementation log

- 2026-09-17: Plan created; Phase A started.
