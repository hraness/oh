# Oh Rust foundations

Shared Rust primitives for the `oh` package. This workspace ships optional
WASM and N-API artifacts; the TypeScript implementation remains the default
fallback so the base package has no required runtime dependencies.

## Crates

- `oh-canonical` — canonical JSON and SHA-256 digest primitives.
  Implements the same contract as `src/canonical.ts`.
- `oh-canonical-wasm` — `wasm-pack`/`wasm-bindgen` bindings.
- `oh-canonical-napi` — `napi-rs` bindings (opt-in performance layer).
- `oh-archive` — bounded, untrusted ZIP64 archive extraction.
- `oh-archive-wasm` — `wasm-pack` bindings for `oh-archive`.
- `oh-archive-napi` — `napi-rs` bindings for `oh-archive`.

## Build

```bash
# Check, lint, and test
cargo check --locked
cargo clippy -- -D warnings
cargo test --locked

# Build the WASM artifact
bun run rust:build:wasm
```

## Number formatting

`oh-canonical` uses an ECMAScript-compatible number formatter (adapted from
`parse-rust-core`) so that `canonical_json` is byte-for-byte identical to the
TypeScript reference's `JSON.stringify` output for all accepted values.

## License

MIT. `src/js_number.rs` contains number-formatting logic adapted from
`parse-rust-core`, used under the Apache-2.0 license.
