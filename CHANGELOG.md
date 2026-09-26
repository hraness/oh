# Changelog

Each section below describes one release of Oh. The release workflow copies a
version's section onto its GitHub Release page, so write the section in the
pull request that bumps the version.

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
