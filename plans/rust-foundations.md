# Hraness Rust Foundations

## Overview

This plan implements the cross-project Rust foundation roadmap for the Hraness
org: canonical JSON/digest primitives, untrusted archive parsing, Datalog/graph
reduction, and custody consolidation. Work starts in `hraness/oh` because its
`no-required-runtime-dependencies` policy forces a clean WASM-first design that
can be reused by Textbutler, Sponge, and Wordcell.

The TypeScript reference implementations stay authoritative until each Rust
replacement proves byte-exact parity through property tests.

## Constraints

- `oh` has **no required runtime dependencies**. Rust artifacts must be optional
  or bundled; WASM is the default integration, N-API is opt-in.
- Convex (Sponge) supports WASM but not `.node` add-ons.
- Every new data surface must register in `costs.json` and pass
  `bun run check:cost-surfaces`.
- Do not change existing `dist/` wire schemas or published npm surfaces. New Rust
  must be an opt-in sidecar or a versioned engine identity.
- Hraness packages upgrade independently via immutable release tags or full
  commit pins; do not coordinate main branches.
- Each phase lands as a focused commit (or stacked PR) with green repository
  gates.

## Phases

| Phase | Name | Depends on | Parallelizable with |
|---|---|---|---|
| 1 | Canonical JSON core crate in `oh` | none | — |
| 2 | WASM + N-API bindings for canonical crate | Phase 1 | — |
| 3 | TS parity tests and opt-in WASM loader | Phase 2 | — |
| 4 | CI, costs.json, and packaging for canonical crate | Phase 3 | — |
| 5 | Shared bounded ZIP64 archive crate | Phase 4 | — |
| 6 | Textbutler X-archive sidecar integration | Phase 5 | — |
| 7 | Shared SQLite snapshot / iMessage / Contacts reader | Phase 6 | — |
| 8 | Sponge canonical/digest migration | Phase 4 + oh release | — |
| 9 | Wordcell clip/bundle reader migration | Phase 5, 7 | — |
| 10 | Positive-Datalog projection / graph reducer crate | Phase 4 | 5, 7 |
| 11 | Custody/desktop-foundation consolidation | Phase 4 | 10 |

## Phase 1: Canonical JSON core crate in `oh`

- **Status:** Done
- **Depends on:** none
- **Objective:** A Rust crate `oh-canonical` that reproduces `src/canonical.ts`.
- **Scope:** `rust/oh-canonical/`
- **Out of scope:** bindings, packaging, downstream consumers.
- **Approach:**
  - Sort object keys by UTF-16 code unit.
  - Escape strings to match `JSON.stringify` (including U+2028/U+2029).
  - Reject unpaired surrogates, `-0`, non-finite numbers, and non-plain objects.
  - Implement ECMAScript-compatible number formatting (adapted from
    `parse-rust-core`) for byte-exact parity with `JSON.stringify`.
- **Acceptance criteria:**
  - `cargo test -p oh-canonical` passes.
  - Rust output matches `canonicalJson` on the existing hand-written cases.
- **Validation:** `cargo test --locked`

## Phase 2: WASM + N-API bindings for canonical crate

- **Status:** Done
- **Depends on:** Phase 1
- **Objective:** Build `oh-canonical-wasm` and `oh-canonical-napi` from the same
  core crate.
- **Scope:** `rust/oh-canonical-wasm/`, `rust/oh-canonical-napi/`
- **Out of scope:** TS loader, distribution packaging.
- **Approach:**
  - `wasm-pack --target web` for portable use.
  - `napi-rs` cdylib for Bun/Node opt-in use.
  - Disable `wasm-opt` if its default flags break bulk-memory operations.
- **Acceptance criteria:**
  - `cargo check --workspace` succeeds.
  - `bun run rust:build:wasm` produces a loadable `pkg/` directory.
- **Validation:** `cargo check --locked && bun run rust:build:wasm`

## Phase 3: TS parity tests and opt-in WASM loader

- **Status:** Done
- **Depends on:** Phase 2
- **Objective:** Prove Rust output equals TS reference and expose an opt-in
  `loadCanonicalRustTextEngine()`.
- **Scope:** `src/canonical-rust.ts`, `src/canonical-rust-parity.test.ts`
- **Out of scope:** Replacing existing `canonicalJson` callers.
- **Approach:**
  - Dynamically import the WASM artifact from outside `src/` using a computed
    URL so TypeScript does not resolve it at compile time.
  - Fall back to the TS reference if the WASM module is unavailable.
  - Use `fast-check` to compare canonical JSON and SHA-256 on generated
    inputs.
- **Acceptance criteria:**
  - `bun test src/canonical-rust-parity.test.ts` passes.
  - `bun run typecheck` passes.
- **Validation:** `bun test src/canonical-rust-parity.test.ts && bun run typecheck`

## Phase 4: CI, costs.json, and packaging for canonical crate

- **Status:** Done
- **Depends on:** Phase 3
- **Objective:** Land the canonical foundation with CI, cost-surface registry,
  and git hygiene.
- **Scope:** `.github/workflows/ci.yml`, `costs.json`, `.gitignore`,
  `package.json`, `rust/README.md`, `rust/Cargo.lock`
- **Out of scope:** Publishing the npm package or cutting a release.
- **Approach:**
  - Add `rust:check`, `rust:build:wasm`, and `rust:build` scripts.
  - Add a Rust CI job installing Rust, `wasm-pack`, Bun, and running
    `cargo check/clippy/test` and WASM build.
  - Register `rust:canonical-wasm` and `rust:canonical-napi` in `costs.json`.
  - Gitignore `rust/target/`, `rust/**/pkg/`, and `rust/**/*.node`.
- **Acceptance criteria:**
  - `bun run check:cost-surfaces` passes.
  - `cargo clippy -- -D warnings` passes.
  - PR opened and pushed.
- **Validation:** `bun run check:cost-surfaces && cargo clippy -- -D warnings && cargo test --locked`

## Phase 5: Shared bounded ZIP64 archive crate

- **Status:** In progress
- **Depends on:** Phase 4
- **Objective:** A reusable Rust crate `oh-archive` that safely extracts selected
  entries from untrusted ZIP archives.
- **Scope:** `rust/oh-archive/`, `rust/oh-archive-wasm/`, `rust/oh-archive-napi/`,
  update `rust/Cargo.toml` workspace members.
- **Out of scope:** SQLite parsing, HTML/Markdown extraction.
- **Approach:**
  - Use the `zip` crate with only `deflate` support enabled.
  - Accept regex patterns; only matching entries are extracted.
  - Enforce `max_entries`, `max_total_bytes`, `max_entry_bytes`.
  - Reject encrypted entries, path-traversal names, and unsupported
    compression methods.
  - Write extracted files atomically into a caller-supplied output directory.
  - Provide WASM and N-API bindings, plus a JSON CLI mode for sidecar use.
- **Acceptance criteria:**
  - `cargo test -p oh-archive` passes.
  - Property-based tests with generated ZIP files verify bounds and path
    sanitization.
  - `bun run rust:build:wasm` produces a loadable archive WASM artifact.
- **Validation:** `cargo test -p oh-archive && cargo clippy -- -D warnings && bun run rust:build:wasm`

## Phase 6: Textbutler X-archive sidecar integration

- **Status:** Not started
- **Depends on:** Phase 5
- **Objective:** Replace the in-process JS ZIP walk in Textbutler's legacy
  `src/x-archive-zip.ts` with the Rust sidecar for memory isolation.
- **Scope:** `hraness/textbutler` repository: add Rust sidecar invocation,
  preserve the existing `ExtractedXArchiveMember` contract.
- **Out of scope:** Changing iMessage/Contacts parsing, renaming the npm
  package.
- **Approach:**
  - Build `oh-archive` as a sidecar binary or use the N-API module.
  - Invoke it from `src/x-archive-zip.ts` with the same regex selection and
    byte limits.
  - Compare output byte-for-byte on sample archives before enabling by default.
  - Gate behind an opt-in flag until parity is proven in CI.
- **Acceptance criteria:**
  - Existing X-archive tests pass with the Rust sidecar.
  - No regression in supported archive features.
  - `costs.json` updated for the new sidecar artifact.
- **Validation:** `bun test` in Textbutler.

## Phase 7: Shared SQLite snapshot / iMessage / Contacts reader

- **Status:** In progress
- **Depends on:** Phase 5
- **Objective:** Move the filesystem-snapshot and read-only query isolation for
  iMessage and Contacts into Rust.
- **Scope:** New crate `oh-sqlite` plus Textbutler integration for
  `src/imessage.ts` and `src/contacts.ts`.
- **Out of scope:** Rewriting the attributed-body / typedstream parsers in
  Rust (keep them in TS if byte-exact parity is not proven).
- **Approach:**
  - Rust crate copies `chat.db` + `-wal` + `-journal` to a private temp
    directory atomically and verifies ownership/mode.
  - Expose the snapshot path and schema validation via JSON CLI.
  - TS runs its existing SQL queries against the Rust-provided snapshot path.
- **Acceptance criteria:**
  - Snapshot creation is atomic and read-only with respect to the source.
  - Ownership checks match existing Textbutler policy.
  - `bun test` in Textbutler passes.
- **Validation:** `cargo test -p oh-sqlite && bun test` in Textbutler.

## Phase 8: Sponge canonical/digest migration

- **Status:** Not started
- **Depends on:** Phase 4 + an immutable `oh` release containing Phases 1–4
- **Objective:** Consume the WASM canonical/digest engine in Sponge's
  `lib/document-domain.ts`, `lib/integrity-domain.ts`, and `lib/digest.ts`.
- **Scope:** `hraness/sponge` repository.
- **Out of scope:** Datalog/graph reducer, library capture worker.
- **Approach:**
  - Bump `@hraness/oh-research` to the release that ships the WASM artifact.
  - Add a feature flag that routes `canonicalJson` / `sha256Text` through the
    WASM engine.
  - Run `fast-check` parity tests against the existing TS reference.
  - Enable by default only after byte-exact parity is proven.
- **Acceptance criteria:**
  - `bun run check` passes with the feature flag on and off.
  - Parity tests pass on representative Convex-shaped values.
- **Validation:** `bun run check` in Sponge.

## Phase 9: Wordcell clip/bundle reader migration

- **Status:** Not started
- **Depends on:** Phase 5, Phase 7
- **Objective:** Reuse `oh-archive` and `oh-sqlite` in Wordcell's capture and
  bundle reading pipeline.
- **Scope:** `hraness/wordcell` repository.
- **Out of scope:** Generalizing the existing metadata-search-tool runner
  (covered in Phase 11).
- **Approach:**
  - Replace hand-rolled ZIP walks in `src/clip/bundle-reader.ts` with
    `oh-archive`.
  - Replace SQLite snapshot logic in clip extraction with `oh-sqlite`.
  - Add parity tests before enabling by default.
- **Acceptance criteria:**
  - Wordcell clip tests pass.
  - Bundle digest identity is preserved.
- **Validation:** `bun test` in Wordcell.

## Phase 10: Positive-Datalog projection / graph reducer crate

- **Status:** Not started
- **Depends on:** Phase 4
- **Objective:** A Rust implementation of `oh`’s positive-Datalog projection
  engine that downstream consumers can opt into.
- **Scope:** New crate `oh-datalog` in `hraness/oh`.
- **Out of scope:** Removing the TS reference engine.
- **Approach:**
  - Port `materializeNaive`, `matchBody`, and `unifyLiteral` semantics.
  - Enforce `workUnits` / `derivedTuples` budgets with atomic counters.
  - Add a new engine identity, e.g. `oh.projection.rust.v1`, behind
    `evaluateOhProjectionWithMaterializerV1`.
  - Prove parity with the TS engine on frozen test fixtures.
- **Acceptance criteria:**
  - `cargo test -p oh-datalog` passes.
  - Frozen projection fixtures produce identical relation sets via TS and Rust.
  - Budget enforcement matches the TS policy.
- **Validation:** `cargo test -p oh-datalog && bun test` in `oh` on projection tests.

## Phase 11: Custody/desktop-foundation consolidation

- **Status:** Not started
- **Depends on:** Phase 4
- **Objective:** Extend the existing `@hraness/local-custody` and
  `@hraness/desktop-foundation` shared packages with Rust where they are not
  already Rust, rather than duplicating that logic in Textbutler.
- **Scope:** The repositories that publish `@hraness/local-custody` and
  `@hraness/desktop-foundation`.
- **Out of scope:** Rewriting Textbutler's daemon policy or menu UI in Rust.
- **Approach:**
  - Audit the current implementation of those shared packages.
  - If they are TypeScript, introduce Rust sidecars for path traversal,
    ownership checks, atomic replace, and Unix-socket peer UID verification.
  - Keep the public API unchanged.
- **Acceptance criteria:**
  - Textbutler continues to consume the shared packages with no API changes.
  - New Rust components have parity tests against the existing TS behavior.
- **Validation:** `bun run check` in the affected repositories.

## Implementation log

- 2026-09-17: Phases 1–4 implemented, committed, and pushed as
  `rust-canonical-foundations` → PR #128.
- 2026-09-17: Phase 5 and Phase 7 implemented and pushed to
  `rust-archive-foundations` → PR #129. This adds `oh-archive` (bounded ZIP64
  extraction), `oh-sqlite` (read-only SQLite snapshot isolation), and their
  N-API/WASM bindings.
- 2026-09-17: Phase 10 (`oh-datalog` positive-Datalog projection engine) is
  the next large in-repo phase; Phases 6, 8, 9, and 11 require published
  upstream artifacts or external repository changes.
