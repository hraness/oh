# Local semantic lifecycle

`OhQmdSemanticBackendV1` owns one optional QMD store and drains admitted work
before closing it. Its public methods remain Promise-based. SQLite records,
record digests, the embedding profile, and canonical manifest bytes retain
their existing contracts.

## Ownership

`src/semantic.ts` is the public facade. `src/semantic-model.ts` holds the pure
profile, document, manifest, and result rules. Neither exposes Effect in the
public API.

`src/semantic-program.ts` composes the lifecycle through the named
`SemanticPlatform` service. One scope owns acquisition and its finalizer. A
semaphore serializes complete index publications; a fiber set tracks both
searches and queued index operations. References hold the published manifest
and closed fence. Cached effects share the first manifest load, initialization,
store release, and close outcome, including failures.

`src/semantic-platform.ts` owns native filesystem access, current-authority
reads, and the optional QMD import. Its named live layer captures paths once.
Foreign exceptions enter a closed tagged failure channel; their original
values are retained solely for the existing Promise rejection boundary.
Do not log or serialize those foreign causes.

`src/semantic-runtime.ts` owns fiber admission and execution. Admission is
registered before returning a Promise. Closing raises the fence synchronously,
waits for all admitted operations to settle, and then closes the owner scope.
The asynchronous runner accepts only a total effect with no outstanding
requirements and an explicit exit value; the facade projects expected failures
back to their original rejection values. It does not turn expected failures
into defects.

## Behavior to preserve

- Concurrent first requests share one manifest load and one store acquisition.
  A malformed manifest stays rejected for that backend instance.
- A store acquired after close began is released once. A release failure is
  visible to that request and every close caller, with the original identity.
- An index already using the store finishes its publication before close.
  Queued snapshots fail when they reach the closed fence. A failed index does
  not poison later queued work.
- An admitted search finishes before store release. It keeps the manifest it
  observed when it began and rejoins every hit against current SQLite authority
  before returning it.
- Manifest publication follows document writes, QMD update, and successful
  embedding. A failed embedding does not replace the published manifest.
- There is no new timeout, automatic retry, or foreign-operation cancellation.
  A blocked QMD operation can still delay close; replacing drain with
  interruption would change the existing contract.

The scope enforces resource ownership inside this implementation. It cannot
prove QMD correctness, record authority, canonical bytes, or the safety of a
new retry policy. Preserve the domain checks and consequential race tests.

## Contributor checks

Run `bun test ./src/semantic.test.ts` for lifecycle and authoritative-result
regressions. Run `bun run check:effect` for the source policy and its paired
valid/invalid fixtures. The latter uses the pinned TypeScript compiler API,
without patching the compiler, and is included in `bun run check`.

The policy names exact lifecycle modules, adapters, and execution roots.
It rejects typed floating effects, unclassified Effect imports, runners outside
their owner, broad error/requirement channels, assertions that erase Effect
types, failure-erasure shortcuts, and selected native I/O outside adapters.
These checks constrain common mistakes; they are not a proof of JavaScript
purity or authorization. An independent reviewer must approve policy/checker
changes, and tests must still demonstrate that work actually executes.

Effect 3.22.1 is pinned as a build dependency and bundled into
`dist/semantic.js`. Its MIT notice is included in `LICENSE`. The root and
portable entrypoints keep their dependency boundary, and QMD stays dynamically
loaded only when needed. Keep `dist/` committed alongside its source and run the
entire aggregate gate, including packed-consumer and portable Node checks.
