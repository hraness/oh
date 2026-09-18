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

- **Status:** Done (WASM in `@hraness/oh@0.10.3`, PR #133; SQLite sidecars in `@hraness/oh@0.10.6`, PRs #136/#139)
- **Objective:** The `@hraness/oh` package ships built Rust WASM artifacts and
  native SQLite sidecars as first-class files so downstream packages can import
  them instead of vendoring blobs. N-API libraries remain CI artifacts, not
  package exports.
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

- **Status:** Done (sponge #285, wordcell #72, textbutler #125)
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

- **Status:** Done (sponge #285, wordcell #72, textbutler #125)
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
  - Keep the TypeScript reference functions directly testable as the fallback
    path; no process-wide force switch is part of the released contract.
- **Acceptance criteria:**
  - Downstream tests pass with Rust as the default.
  - Direct reference-path tests preserve the same result contracts.
- **Validation:** `bun run test` in each consumer.

## Phase D: Integrate archive / SQLite / Datalog engines downstream

- **Status:** Done (oh #134/#136, wordcell #74, textbutler #129)
- **Depends on:** Phase C
- **Objective:** Use the shared Rust engines for real production workloads beyond
  canonical JSON/digest.
- **Scope:**
  - **Textbutler:** route iMessage/Contacts snapshot creation through
    `oh-sqlite`.
  - **Sponge/Wordcell archive:** not applicable; neither has a production
    ZIP-shaped ingestion path requiring the strict archive engine.
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

- **Status:** Partially done (local-custody #8, oh #135; remaining items below)
- **Depends on:** Phase A
- **Objective:** Close remaining gaps in the Rust surface.
- **Scope:** `local-custody/rust/`, `oh/rust/`, release/CI matrices.
- **Approach:**
  - `local-custody` has Rust control-socket/protected-input/filesystem code and
    vector tests, but the released TypeScript package does not ship or call a
    native artifact yet.
  - Deterministic archive and Datalog budget regressions exist; dedicated
    arbitrary-input/fuzz targets remain future hardening.
  - The cross-platform N-API matrix builds CI artifacts. They remain unpublished
    until a consumer justifies a package loader/distribution contract.
  - `wasm-opt` and explicit optimized-size budgets remain optional future work.
- **Acceptance criteria:**
  - `cargo test` and `bun run check` pass in `local-custody` and `oh`.
  - N-API artifacts build on Linux/macOS CI.
- **Validation:** `cargo test --locked && bun run check`.

## Implementation log

- 2026-09-17: Plan created; Phase A started.
- 2026-09-17: Phase A completed with `@hraness/oh@0.10.3` release (PR #133).
- 2026-09-17: Phases B and C completed; Sponge, Wordcell, and Textbutler consume
  released artifacts with default-on Rust paths and fallback telemetry
  (sponge #285, wordcell #72, textbutler #125).
- 2026-09-17: Phase D Datalog integration started: `oh-datalog` `materialize_projection`
  seam exposed as `@hraness/oh/projection/rust` (PR #134) and Wordcell graph
  authority wired to use it (PR #74).
- 2026-09-17: Phase E hardening started: `local-custody` control-socket and
  protected-input Rust port pushed (PR #8); deterministic `oh-archive`
  malformed-input and `oh-datalog` budget regressions landed.
- 2026-09-18: Audit PR #142 hardened ECMAScript number parity, raw WASM ABI
  bounds, strict archive option parsing, and SQLite snapshot/protocol isolation.
  Follow-up work documents N-API as build-only and smoke-loads native artifacts.
