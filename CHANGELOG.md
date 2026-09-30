# Changelog

Each section below describes one release of Oh. The release workflow copies a
version's section onto its GitHub Release page, so write the section in the
pull request that bumps the version.

## Unreleased

- Make the temporary signing certificate chain discoverable and pass literal
  code requirements to macOS when signing and verifying native helpers.

- Sign and notarize both Mac SQLite helpers with a stable Apple Developer ID.
  Verify their identity before execution and publish the same signed bytes
  through the existing exact-package release checks.

## 0.13.3 - 2026-09-29

The same package as 0.13.2, released through the full release check. npm
published 0.13.2 with valid provenance, but reports the trusted-publisher ID
in a new format that the release check refused, so 0.13.2 never reached the
site or the published-release record. Install 0.13.3.

- The SQLite snapshot helper is bundled for Linux x64, Linux arm64, macOS
  arm64, macOS x64, and Windows x64, as in 0.13.2.
- The release check accepts npm's trusted-publisher ID with or without the
  `oidc:` prefix and still rejects any other form.

## 0.13.2 - 2026-09-29

The package now carries the SQLite snapshot helper for Linux arm64 and
Windows x64 as well as Linux x64 and macOS. `@hraness/oh/sqlite-snapshot`
works on those two platforms without building anything, and the release
installs the package and runs the CLI and the helper on all five before it
publishes.

- `snapshotDatabase` and `snapshotDatabaseSync` find the bundled helper on
  Linux arm64 and Windows x64 (`oh-sqlite-cli.exe`).
- Each release now installs the exact tarball and runs `oh` on Ubuntu x64,
  Ubuntu arm64, macOS and Windows.

## 0.13.1 - 2026-09-26

The 0.13.0 release stopped before publishing because its version check read
`oh --version`, which now prints `oh 0.13.0` for people. The check reads
`oh --version --json` instead. The package is otherwise the same as 0.13.0.

- Everything listed under 0.13.0 ships in this release.

## 0.13.0 - 2026-09-26

The `oh` command line now prints short sentences for people and keeps
canonical JSON for scripts and agents. Scripts that read `oh` output must add
`--json`; coding agents get JSON by default. The library, SQLite format and
JSON shapes are unchanged.

- In a terminal, commands print a short result, such as
  `✓ Saved entity:ada (generation 1).`, and at most one `Next:` hint on
  stderr. `--json` prints the same canonical JSON as before. When Claude Code,
  Codex, Cursor, Gemini CLI or `AI_AGENT` is detected, JSON is the default;
  `HRANESS_AUDIENCE=human` or `agent` overrides the guess.
- Running `oh` alone prints a short start screen, `oh --help` is grouped, and
  every command has its own help (`oh put --help`, `oh help put`).
- `oh put` takes the value as `--value`; `--json VALUE` still works.
- Reading commands no longer create `.oh/oh.sqlite` when it is missing. They
  stop with `No Oh store at .oh/oh.sqlite` and point at `oh init`.
- Errors are one sentence and one next command, such as
  `✗ No record named "entity:ada" in space default.` then `→ oh list`. A
  missing record exits 3 as before; a mistyped command or option now exits 2
  with a suggestion. With `--json` or an agent, errors are one
  `{"ok":false,"error":{...}}` object on stdout.
- `oh search` and `oh recall` warn that the CLI has only keyword search when
  asked for `--mode semantic` or `hybrid`.
- `oh --version` prints `oh 0.13.0`. The support commands name `oh` instead of
  the runtime path when `oh` on your PATH runs the same file.

## 0.12.1 - 2026-09-26

Installed copies of Oh now run the Rust text engine. Releases 0.10.3 through
0.12.0 looked for its WebAssembly files in the wrong folder and fell back to
the TypeScript reference, which gives the same results more slowly.

- The packaged loader finds its WebAssembly files, so an installed copy
  reports `rust-wasm` as its canonical text engine and
  `loadProjectionRustEngineV1()` returns the Rust Datalog engine instead of
  `null`.
- The release check installs the packed package and fails unless the loader
  reports the Rust engine and the Datalog engine loads.
- The LongMemEval-S result for all 500 questions is published in
  `benchmarks/LONGMEMEVAL_S_500_RESULT_V1.md`. A pipeline that gives the
  reader every message the user wrote answered 93.07% correctly, averaged over
  three runs, against 88.87% for Oh semantic retrieval alone and 86.13% for
  BM25, with the same GPT-5 mini reader and GPT-4o judge. The result is
  in-sample: the pipeline's rules were written after studying all 500
  questions.
- The matched framework pilot is published in
  `benchmarks/FRAMEWORK_PILOT_RESULT_V1.md`. On 60 previously seen
  LongMemEval-S questions, Supermemory answered 75.00%, Oh 71.67%, and BM25
  68.33%. Both differences with Oh are within the measurement noise.
- The LongMemEval benchmark parser gives each session a neutral alias instead
  of its original dataset identifier, some of which contained answer wording.
  Earlier prepared benchmark inputs must be rebuilt.
- The README is shorter, and its reference sections moved to seven guides in
  `docs/`.
- oh.computer has a blog at `/blog` with an Atom feed at `/blog/feed.xml`.
