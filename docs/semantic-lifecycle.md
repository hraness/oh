# Local semantic backend lifecycle

Suppose your process starts shutting down while `OhQmdSemanticBackendV1` is
halfway through embedding a snapshot. You call `close()`. The backend refuses
new calls at once, lets that index run finish, waits for the searches it has
already accepted, and then closes its QMD store once. A call that arrives
after `close()` rejects without touching the store.

QMD (`@tobilu/qmd` 2.5.3) is the optional package that builds and searches the
local vector index. The backend imports it the first time an index or search
call needs a store. That index is a cache: your SQLite store stays the source
of truth, and every hit is compared with it before you see it. A file in the
cache directory, `manifest.json`, records which Oh record each indexed
document came from. The
[embedding specification](../spec/v1/embedding.md#derived-document-contract)
defines the record digests, the embedding profile, and the format of
`manifest.json`.

The public methods return Promises. Inside, the lifecycle is written with
[Effect](https://effect.website), a TypeScript library for asynchronous
programs that declares each program’s expected failures and required services
in its type. Effect 3.22.1 is bundled into `@hraness/oh/semantic`, so you don’t
install it.

## What close does

Closing drains the backend: it waits until every call it has already accepted
has finished, whether that call succeeded or failed. Only then does it close
the QMD store.

- `close()` marks the backend closed before it returns. A call made on the
  next line rejects with an `Error` whose message is
  `The semantic backend is closed.`
- Argument checks come first. A search whose `limit` is outside `1` through
  `100`, or an index call with more than 65,536 records, rejects with a
  `RangeError` even after close.
- Every `close()` call, concurrent or later, gets the same outcome. If
  releasing the store failed, each one rejects with the same error value.
- If the store never opened, for example because QMD isn’t installed,
  `close()` resolves.
- Close has no timeout, retry, or cancellation. A QMD call that never returns
  keeps `close()` waiting, and the backend does not interrupt it.

If you pass the backend to `Oh.open({ semanticBackend })`, `oh.close()` waits
for the SDK’s pending calls and then closes the backend for you. If you use
the backend on its own, call `close()` when you’re done. Until you do, the QMD
store stays open.

## Calls in flight at close

Index calls run one at a time. Searches run alongside them and alongside each
other. When you close with work in flight:

- The index call that is already using the store runs to the end before the
  store closes, so it can update QMD, embed the documents, and replace
  `manifest.json`.
- Index calls that are waiting for their turn, or that haven’t started using
  the store, reject with the closed error when they get there. An index call
  made in the same synchronous turn as `close()` rejects before it writes
  anything to disk.
- A failed index call doesn’t block the calls behind it. The next one in line
  runs normally.
- A search the backend accepted before `close()` finishes before the store
  closes.

## How searches stay correct

`manifest.json` maps each indexed document to a record key and that record’s
SHA-256 digest, and it names the embedding profile by its digest. An index
call writes the documents, asks QMD to update and embed them, and only then
replaces `manifest.json`. If the update or the embedding fails, the file from
the last successful index stays in effect.

A search uses the mapping from `manifest.json` as it stood when the search
started, even if an index call replaces the file while the search runs. Before
it returns a hit, it loads the current record from the SQLite store you
passed. It drops the hit if the record is gone, if its digest has changed, or
if the indexed text differs from the record’s current document. A stale index
entry can hide a result, but it can’t return a record that changed after it
was indexed.

## First use and failures that stick

The first calls on a new backend share one read of `manifest.json` and one
store opening. A failure in either is remembered. A malformed
`manifest.json`, or a store that can’t open, makes every later call on that
backend object reject with the same error. When QMD isn’t installed, that
error’s message is
`Semantic search needs the optional @tobilu/qmd@2.5.3 package.` Fix the
cause, then create a new backend object.

A store that finishes opening after `close()` has begun is closed right away,
once. If that close fails, the call that opened the store and every `close()`
call reject with the same error value.

## Change the lifecycle code

This section is for contributors. Only one file talks to the outside world,
and only one file runs programs.

| File | Role |
| --- | --- |
| `src/semantic.ts` | The public class. Its methods return Promises, and no Effect type appears in its API. |
| `src/semantic-model.ts` | Pure rules for the embedding profile, documents, `manifest.json`, and results, with no Effect types in its public API. |
| `src/semantic-program.ts` | The lifecycle, written against the `SemanticPlatform` service. |
| `src/semantic-platform.ts` | The adapter for the filesystem, SQLite record reads, and the optional QMD import. |
| `src/semantic-runtime.ts` | The runtime: the only file that starts and runs programs. |

A few Effect terms help here. A *service* is a dependency that a program asks
for by its tag, and a *layer* supplies it. A *fiber* is one running program,
like a thread that costs almost nothing to start. A *scope* holds resources
and runs their cleanup functions, called finalizers, when it closes. A
*defect* is an unexpected throw, kept apart from the failures a program
declares. An `Exit` records whether a program succeeded or failed.

In the program, one scope holds the QMD store together with the finalizer
that releases it. A semaphore with one permit makes each index call finish
before the next one begins. A fiber set tracks every search and queued index
call, and that set is what `close()` waits on. `Ref` cells hold the closed
flag and the mapping last read from or written to `manifest.json`. Cached
effects (`Effect.cached`) share the first read of `manifest.json`, the store
opening, the store release, and the close outcome, failures included.

The live layer, `semanticPlatformLive`, resolves the cache paths once, when
the backend is constructed. Exceptions from the filesystem, QMD, or SQLite
become failures tagged `FilesystemFailure`, `BackendFailure`,
`ManifestFailure`, `ResultFailure`, or `AuthorityFailure`, and a call on a
closed backend fails with `Closed`. Each failure carries the original thrown
value only so that the Promise can reject with it. Don’t log or serialize
those values.

The runtime adds each call to the fiber set before it returns the Promise, so
`close()` always waits for it. `close()` sets the closed flag synchronously,
waits for the fiber set to empty, and then closes the scope. The single
asynchronous runner accepts only an effect that can’t fail, needs no
services, and produces an `Exit`. The facade turns an expected failure back
into its original rejection value and never turns it into a defect.

The scope guarantees one release of the store, after the work that uses it.
It can’t tell you whether QMD returned correct results, whether a hit matches
your SQLite record, whether `manifest.json` is written in Oh’s
[canonical JSON](../spec/v1/canonical-json.md), or whether a new retry policy
would be safe. Keep the domain checks and the race tests that cover those
questions.

Run `bun test ./src/semantic.test.ts` for the lifecycle and search-result
regressions. Then run `bun run check:effect`. It runs the architecture checker
in `scripts/check-effect-architecture.ts` and that checker’s tests, which feed
it sample programs it must accept and others it must reject. The checker reads
the code through the compiler API of the pinned TypeScript 5.9.3 and does not
patch the compiler. `bun run check` includes it.

The checker’s policy names each governed file and its role. `modules` lists
the lifecycle files, `adapters` lists the files allowed to do native I/O, and
`runtimeRoots` lists the files allowed to run programs. It skips `scripts`
and `tests/fixtures`. Each finding prints as `file:line rule: message`.

| Rule | What it rejects |
| --- | --- |
| `floating-effect` | An Effect that is created but never returned, composed, or run by the code that created it |
| `unused-effect` | An Effect assigned to a variable that is never used or exported |
| `unclassified-module` | A production file that uses Effect without a role in the policy |
| `runtime-owner` | A runner such as `Effect.runPromise` or `Effect.runSync`, or a `ManagedRuntime.make` or `Runtime.make` call, outside a runtime root |
| `explicit-channel` | An error or requirement type of `any` or `unknown` |
| `explicit-any` | Any explicit `any` in a governed file |
| `effect-assertion` | A type assertion on an Effect value |
| `erased-failure` | `orDie`, `orDieWith`, `ignore`, or `ignoreLogged`, which drop an expected failure or turn it into a defect |
| `javascript-effect-catch` | A JavaScript `catch` around a `yield*` in an Effect generator, where it can’t see Effect failures |
| `native-import` | An import of a native I/O module, such as `node:*`, `bun`, or `fs`, outside an adapter |
| `native-constructor` | `new Promise`, `new Date`, `new Worker`, or `new AbortController` outside an adapter |
| `ambient-io` | Global I/O, timers, the clock, or randomness, such as `fetch`, `setTimeout`, `Date.now`, or `Math.random`, outside an adapter |
| `ambient-config` | `process.env` outside an adapter |
| `suppression` | `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, or a comment that turns Effect diagnostics off |
| `policy-source`, `policy-role` | A policy entry for a file the compiler can’t find, or an adapter or runtime root missing from `modules` |

These rules catch common mistakes. They don’t prove that JavaScript code is
pure or that a caller is authorized. A reviewer other than the author must
approve any change to the policy or the checker, and tests have to show that
the work runs, which the checker can’t.

Effect 3.22.1 is a pinned development dependency. The build bundles it into
`dist/semantic.js`, and its MIT license notice is in `LICENSE`. No other built
entry point includes the local semantic backend, and QMD is imported only when
a store is needed. Rebuild `dist/` and commit it with your source change, then
run `bun run check`, which includes the packed-package check
(`bun run test:package`) and the portable Node checks (`bun run test:node` and
`bun run test:types:node`).
