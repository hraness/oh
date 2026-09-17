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
| 8 | Sponge canonical/digest migration | Phase 4 | — |
| 9 | Wordcell canonical/digest migration | Phase 4 | — |
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
  - Use `dtoa` (a Rust port of V8's Grisu3/dtoa.c) for ECMAScript-compatible
    number formatting so byte parity with `JSON.stringify` holds even at the
    edge of `f64` precision.
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

- **Status:** Done
- **Depends on:** Phase 4
- **Objective:** A reusable Rust crate `oh-archive` that safely extracts selected
  entries from untrusted ZIP archives.
- **Scope:** `rust/oh-archive/`, `rust/oh-archive-wasm/`, `rust/oh-archive-napi/`,
  `rust/oh-archive-strict-wasm/`
- **Out of scope:** SQLite parsing, HTML/Markdown extraction.
- **Approach:**
  - Use the `zip` crate with only `deflate` support enabled.
  - Accept regex patterns; only matching entries are extracted.
  - Enforce `max_entries`, `max_total_bytes`, `max_entry_bytes`.
  - Reject encrypted entries, path-traversal names, and unsupported
    compression methods.
  - Write extracted files atomically into a caller-supplied output directory.
  - Provide WASM and N-API bindings, plus a strict in-memory WASM reader for
    Textbutler's exact X-archive contract.
- **Acceptance criteria:**
  - `cargo test -p oh-archive` passes.
  - Property-based tests with generated ZIP files verify bounds and path
    sanitization.
  - `bun run rust:build:wasm` produces a loadable archive WASM artifact.
- **Validation:** `cargo test -p oh-archive && cargo clippy -- -D warnings && bun run rust:build:wasm`

## Phase 6: Textbutler X-archive sidecar integration

- **Status:** Done
- **Depends on:** Phase 5
- **Objective:** Replace the in-process JS ZIP walk in Textbutler's legacy
  `src/x-archive-zip.ts` with the Rust sidecar for memory isolation.
- **Scope:** `hraness/textbutler` repository: vendored strict-archive WASM,
  `src/x-archive-zip-rust.ts`, parity tests, package policy.
- **Out of scope:** Changing iMessage/Contacts parsing, renaming the npm
  package.
- **Approach:**
  - Use `oh-archive-strict-wasm` via raw WebAssembly instantiation.
  - Preserve the existing `ExtractedXArchiveMember` contract and all validation
    rules (EOCD ambiguity, local-header consistency, descriptor widths,
    compression-ratio cap, etc.).
  - Gate through `src/x-archive.ts` so the Rust reader is opt-in and the TS
    reader remains the fallback.
  - Update Textbutler's package smoke policy to admit single-level vendored
    `.wasm` artifacts under `vendor/<name>/<file>.wasm`.
- **Acceptance criteria:**
  - Existing X-archive tests pass with the Rust path.
  - No regression in supported archive features.
  - `costs.json` updated for `rust:archive-strict-wasm`.
  - `bun run check` in Textbutler passes.
- **Validation:** `bun run check` in Textbutler.

## Phase 7: Shared SQLite snapshot / iMessage / Contacts reader

- **Status:** Done
- **Depends on:** Phase 5
- **Objective:** Move the filesystem-snapshot and read-only query isolation for
  iMessage and Contacts into Rust.
- **Scope:** New crate `oh-sqlite` plus N-API/WASM bindings in `hraness/oh`.
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
  - `cargo test -p oh-sqlite` passes.
- **Validation:** `cargo test -p oh-sqlite && cargo clippy -- -D warnings`

## Phase 8: Sponge canonical/digest migration

- **Status:** Done
- **Depends on:** Phase 4
- **Objective:** Consume the Rust canonical-JSON/digest engine in Sponge behind
  the existing `lib/digest.ts` API.
- **Scope:** `hraness/sponge` repository.
- **Out of scope:** Datalog/graph reducer, library capture worker.
- **Approach:**
  - Vendor the raw-ABI `oh-canonical-raw-wasm` artifact as a base64-embedded
    module so it works in browser, Convex, Bun, and Node without fs or native
    add-ons.
  - Add `lib/canonical-rust.ts` with a lone-surrogate / f64-edge fallback guard.
  - Prefer the Rust path in `sha256CanonicalJson`; fall back to the existing
    Web Crypto + TypeScript canonicalization on any mismatch.
  - Add `fast-check` parity tests against `lib/document-domain.ts`.
- **Acceptance criteria:**
  - `bun run check` passes (accounting for a pre-existing local `.env.local`
    that must be removed for the final preview-themes gate).
  - Parity tests pass on representative Convex-shaped values.
- **Validation:** `bun run check` in Sponge.

## Phase 9: Wordcell canonical/digest migration

- **Status:** Done
- **Depends on:** Phase 4
- **Objective:** Reuse the Oh canonical/digest engine in Wordcell's Oh adoption
  path.
- **Scope:** `hraness/wordcell` repository.
- **Out of scope:** Generalizing the existing metadata-search-tool runner
  (covered in Phase 11), rewriting clip extraction in Rust.
- **Approach:**
  - Vendor the raw-ABI `oh-canonical-raw-wasm` artifact and add
    `src/oh/canonical-rust.ts`.
  - Use `canonicalSha256Rust` as an optional fast path in
    `src/oh-adoption.ts`; fall back to `@hraness/oh` on mismatch.
  - Add parity tests against `@hraness/oh` strict canonical output.
- **Acceptance criteria:**
  - `bun run typecheck && bun run build` in Wordcell pass.
  - Oh adoption tests pass.
- **Validation:** `bun run typecheck && bun run build && bun test src/oh-adoption.test.ts`

## Phase 10: Positive-Datalog projection / graph reducer crate

- **Status:** Done
- **Depends on:** Phase 4
- **Objective:** A Rust implementation of `oh`’s positive-Datalog projection
  engine that downstream consumers can opt into.
- **Scope:** New crate `oh-datalog` plus WASM bindings in `hraness/oh`.
- **Out of scope:** Removing the TS reference engine.
- **Approach:**
  - Port `materializeNaive`, `matchBody`, and `unifyLiteral` semantics.
  - Enforce `workUnits` / `derivedTuples` budgets with atomic counters.
  - Add a new engine identity, e.g. `oh.projection.rust.v1`, behind
    `evaluateOhProjectionWithMaterializerV1`.
  - Prove parity with the TS engine on frozen test fixtures.
- **Acceptance criteria:**
  - `cargo test -p oh-datalog` passes.
  - Transitive-closure and work-budget tests pass.
  - Budget enforcement matches the TS policy.
- **Validation:** `cargo test -p oh-datalog && cargo clippy -- -D warnings`

## Phase 11: Custody/desktop-foundation consolidation

- **Status:** Blocked
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
- **Blocker:** The `local-custody` and `desktop-foundation` source repositories
  are not present in this workspace, so this phase cannot be implemented or
  validated here. It should resume once those repositories are in scope.

## Implementation log

- 2026-09-17: Phases 1–4 implemented, committed, and pushed as
  `rust-canonical-foundations` → `https://github.com/hraness/oh/pull/128`.
- 2026-09-17: Phase 5 and Phase 7 implemented and pushed to
  `rust-archive-foundations` → `https://github.com/hraness/oh/pull/129`. This adds
  `oh-archive` (bounded ZIP64 extraction), `oh-sqlite` (read-only SQLite snapshot
  isolation), and their N-API/WASM bindings.
- 2026-09-17: Phase 6 implemented and pushed to Textbutler
  `rust-archive-sidecar` → `https://github.com/hraness/textbutler/pull/125`.
- 2026-09-17: Phase 10 (`oh-datalog` positive-Datalog projection engine)
  implemented and pushed to `rust-archive-foundations` → `https://github.com/hraness/oh/pull/129`.
- 2026-09-17: Raw-ABI `oh-canonical-raw-wasm` crate added and the ECMAScript
  number formatter switched from `ryu` to `dtoa` for V8 parity; pushed to
  `rust-canonical-raw-wasm` → `https://github.com/hraness/oh/pull/132`.
- 2026-09-17: Phase 8 implemented and pushed to Sponge `rust-canonical-wasm` →
  `https://github.com/hraness/sponge/pull/285`.
- 2026-09-17: Phase 9 implemented and pushed to Wordcell `rust-canonical-wordcell` →
  `https://github.com/hraness/wordcell/pull/72`.
- 2026-09-17: Phase 11 remains blocked until the `local-custody` and
  `desktop-foundation` repositories are available in the workspace.
