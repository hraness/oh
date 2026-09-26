# How memory host calls run

Only trusted host code changes what your agent sees in canonical memory, the
reviewed memory it reads. `createOhMemoryAuthorityV1` returns an authority: an
object with an `agent` for your model and a `host` for your own code. The
`host` has two methods, `advanceCanonical` and `adoptNomination`, and they run
one at a time. The agent moves to a newer version of canonical memory only
after Oh has proven the history leading to it and loaded its snapshot, and a
host call that fails leaves the agent where it was.

Canonical memory is the store you pass as the `canonical` option, opened with a
canonical profile such as `OH_CANONICAL_STORE_PROFILE_V1`. It holds the memory
your application has reviewed and accepted. The store you pass as `working`
holds what the agent remembers as it works. A *head* identifies one operation
in a store’s history, and the agent reads canonical memory at one pinned head.
The [memory specification](../spec/v1/memory.md#stable-host-control) defines
each request, result, and limit on this page.

Both host methods return Promises that reject with the original error values.
Inside, each call is an [Effect](https://effect.website) program. Effect is a
TypeScript library for asynchronous code that records in its types which
failures a program can produce and which services it needs.
`@hraness/oh/memory` bundles Effect 3.22.1, so you don’t install it.

## One host call at a time

Each authority object has one queue for host calls, and both methods share it.
Agent calls never wait in it.

- Oh copies and validates your request when you call the method, before the
  call waits for its turn. Changing the request object afterwards doesn’t
  change the call. A malformed request rejects right away, for example with
  `TypeError` and the message `Invalid canonical memory advance request.`
- Host calls run one at a time, and calls that are waiting start in the order
  they arrived.
- A call keeps its turn until its store calls have finished, the new head is
  proven, and the agent has moved to it. The turn can’t be interrupted
  partway, so the next call never starts while a store call from the one
  before it is running.
- A call that fails gives up its turn, and the next call runs normally.

Oh installs a new head by building a new agent at that head, which reads and
checks the head’s snapshot, and only then moving the pin and pointing
`authority.agent` at the new agent together. The `authority.agent` object
itself never changes: each of its methods forwards the call to the agent at
the current pin. A query that has already started keeps the head it began with.
Every agent that one authority builds shares a single explanation cache,
limited to 256 entries and 64 MiB, and the same clock state. An explanation
issued before an advance therefore keeps pointing at its original result, and
the cache limits count across every head.

## What the authority borrows

- You open both stores and pass them in. The authority borrows them: it has no
  `close` method and never closes or purges either store. Close them yourself
  when you’re done with the authority.
- The two stores must be different. An *authority ID* (`authorityId`) is the
  label you give each store, and results show it in place of a path, URL, or
  credential. Equal authority IDs reject with `OhProfileError` and the message
  `Working and canonical memory must be distinct physical authorities.`
- Host calls read the canonical store with `head`, `snapshot`, and
  `changesSince`, and write to it with `commit`. From the working store they
  only request `exportDependencyClosure`.
- The `agent` object has only `remember`, `query`, `explain`, and `nominate`.
  Give a model tool `authority.agent`. Never give it `authority.host`, either
  store, or the options you passed to `createOhMemoryAuthorityV1`.

## Move the pin forward

When another writer adds to the canonical store, the agent keeps reading its
pinned head until a host call moves the pin.
`advanceCanonical({ expectedHead, nextHead, v: 1 })` moves it to a head you
choose.

- If `expectedHead` isn’t the current pin, the call rejects with
  `OhConflictError` and the message
  `The expected canonical memory head does not match the current pin.`
- If `nextHead` equals the pin, it resolves with `status: "unchanged"`.
- A `nextHead` whose sequence number isn’t higher than the pin’s rejects with
  `OhConflictError` and the message
  `The next canonical memory head is not a descendant of the current pin.`
- Otherwise Oh reads the canonical change feed from the pin to `nextHead`,
  checks that each operation follows the one before it, and installs
  `nextHead`. The result has `status: "advanced"`. A gap or a malformed page
  in the change feed, or a feed that doesn’t end at `nextHead`, rejects with
  `OhIntegrityError`. Errors from the store pass through unchanged: the SQLite
  store, for example, rejects a `nextHead` that isn’t in its history with
  `OhConflictError`.

One call proves at most 16,384 operations, read in at most 64 pages of up to
1,000 operations and 64 MiB each. These values are in
`OH_MEMORY_AUTHORITY_LIMITS_V1`. Oh measures the distance before its first
read and rejects a longer advance with `RangeError` and the message
`The canonical memory advance exceeds its total proof bound; advance in host-reviewed chunks.`
If the store returns pages so short that 64 of them don’t reach `nextHead`,
the call also rejects with `RangeError`. Cover a longer history with several
calls. Any failure leaves the pin where it was.

The result is a receipt, `OhMemoryCanonicalAdvanceReceiptV1`: a frozen record
with the authority ID, the binding digest that identifies the canonical
store’s space, realm, and profile, the prior and new heads, the status, and
`receiptSha256`, a SHA-256 digest of those fields.

## Adopt a nomination

`agent.nominate` proposes records from working memory. After your application
reviews the proposal, call
`adoptNomination({ expectedCanonicalHead, nomination, replacements, v: 1 })`
to write it into canonical memory. `replacements` is optional. Oh checks the
request in this order:

- The nomination’s route and destination purpose must match an entry in the
  `nominationRoutes` you registered. Otherwise the call rejects with
  `OhProfileError` and the message
  `The memory nomination is not bound to this adoption route.`
- It must come from your working store and its binding. Otherwise it rejects
  with `OhProfileError` and the message
  `The memory nomination is not from the bound working authority.`
- The working store must re-export the same dependency closure, byte for byte,
  at the nomination’s source head. Otherwise it rejects with
  `OhIntegrityError` and the message
  `The working authority did not re-export the nominated closure exactly.`
- Oh reads the canonical store’s current head, which may be ahead of the pin.

A nominated record missing from canonical memory becomes a put, and one that
is there with the same digest needs nothing. A record there with a different
digest is a conflict unless `replacements` names its key and the canonical
digest you reviewed, and one request can carry at most 128 replacements. The
[specification](../spec/v1/memory.md#stable-host-control) gives the full
replacement rules. When every nominated record is already in place, the call
resolves with `status: "already-present"` and writes nothing.

Oh writes only when `expectedCanonicalHead`, the pin, and the store’s current
head are the same. Otherwise the call resolves with `"already-present"` if
every nominated record is in place at the current head, moving the pin there,
and rejects with `OhMemoryAdoptionConflictError` if not.

Before it writes, Oh checks that canonical memory would stay within 8,192
records and 32 MiB, rejecting a larger result with `RangeError`. Then it makes
one compare-and-swap commit: the store applies it only if its head is the one
Oh read, and rejects it with `OhConflictError` otherwise. The operation ID is
`memory_adopt_` followed by 48 hexadecimal characters derived from the
adoption actor, the canonical binding, the nomination digest, and the prior
head, so the same request against the same pin always gets the same ID.

A blocking conflict stops the whole adoption before any write. The call
rejects with `OhMemoryAdoptionConflictError`, a subclass of `OhConflictError`
with the message
`The nominated records conflict with the current canonical memory head.` Its
`conflict` property holds the expected and actual heads, the total number of
conflicts, up to 128 of them sorted by key, a `truncated` flag that is `true`
when some were left out, and `conflictsSha256`, a digest of the full list.

## When the commit doesn’t come back cleanly

Within one call, Oh sends the adoption commit once and never retries it.

- If the commit rejects with `OhConflictError`, Oh rereads the canonical head.
  If the store holds every nominated record with its nominated digest, the
  call resolves with `"already-present"` and installs that head. Otherwise it
  rejects with `OhMemoryAdoptionConflictError`.
- Any other failure, including a reply lost after the write landed, rejects
  with the original error and leaves the pin where it was. Send the same
  request again. If the records are in place, it resolves with
  `"already-present"` and installs the current head, without a second write.
  If a later write changed one of those records in the meantime, it rejects
  with `OhMemoryAdoptionConflictError`.
- After a successful commit, Oh checks that the returned operation is the one
  it sent, or rejects with `OhIntegrityError` and the message
  `The canonical authority returned a different adoption operation.` Then it
  rereads the head. If nothing else has been written, it installs the new
  head and resolves with `"adopted"`. If another write has landed after the
  adoption, Oh proves the path through the adoption and checks the records at
  the later head. If they match, it installs that head and resolves with
  `"already-present"`. If the later write changed one of them, it rejects with
  `OhMemoryAdoptionConflictError`.

The result is an `OhMemoryAdoptionReceiptV1` with the adoption actor, the
authority ID, the binding digest, the nomination digest, the prior and new
heads, the status, and `receiptSha256`. Its `operationSha256` holds the
adoption operation’s digest when the status is `"adopted"` and `null` when it
is `"already-present"`.

## Changing the host code

These notes are for contributors. The host methods are Effect programs, and
one file runs them.

| File | Role |
| --- | --- |
| `src/memory.ts` | The public exports. `createOhMemoryAuthorityV1` returns a Promise. |
| `src/memory-core.ts` | The V1 and V2 agent code for `query`, `remember`, `explain`, and `nominate`, the request parsers, receipts, limits, and `createOhMemoryRuntimeV2`, which builds the clock and explanation state that agents share. |
| `src/memory-authority-program.ts` | `makeMemoryAuthority`: the host queue, `advanceCanonical`, and `adoptNomination`. |
| `src/memory-authority-platform.ts` | The `MemoryAuthorityConfig`, `CanonicalMemoryStore`, and `WorkingMemorySource` services, the `memoryAuthorityLive(options)` layer, and the failure tags. |
| `src/memory-authority-runtime.ts` | The runtime bridge. It freezes the `agent` and `host` objects, parses host requests before they wait, and runs each program. |

In Effect’s vocabulary, a program asks for a *service* by its tag and a
*layer* provides it. A *semaphore* limits how many fibers, meaning running
programs, can hold it at once. The host queue is one semaphore with a single
permit, `hostOrder`, and each host call runs as
`withPermits(1)(Effect.uninterruptible(...))`. A *defect* is an unexpected
throw, and an `Exit` records how a program ended.

The layer reads your options once, before the first store call. It builds the
canonical store service with `head`, `snapshot`, `changesSince`, and `commit`,
and the working source with `exportDependencyClosure` alone. Neither service
can close or purge a store. `createOhMemoryRuntimeV2(options)` runs once per
authority, and every agent the authority builds reuses its result. The test
“shares explanation eviction and monotonic clock state across canonical
generations” covers that.

Store and validation errors become tagged failures: `MemoryConflict` for
`OhConflictError`, `MemoryIntegrity` for `OhIntegrityError`, `MemoryProfile`
for `OhProfileError`, `MemoryValidation` for `TypeError`, `MemoryCapacity` for
`RangeError`, and `MemoryForeign` for anything else. Only `MemoryConflict` from
the adoption commit leads to reconciliation. Every other failure passes
through unchanged, and nothing is retried. The runtime bridge rejects with the
original value of an expected failure and with the thrown value of a defect.

Run `bun test src/memory.test.ts`. It covers races on in-memory SQLite stores,
replays and refusals, hostile input and capacity limits, and explanations from
an older head. One test fails the first advance with a value that isn’t an
`Error`, and the request queued behind it, whose input object the caller
changed after the call, still runs with its original values and succeeds.
Then run `bun run check:effect` for the architecture checker,
`bun run test:package` for the packed package, `bun run test:node` for the
built entry points under Node, and `bun run check`, which includes all of
them. The checker governs the three `memory-authority` files, allows native
I/O in the platform and runtime files, and lets only the runtime file run
programs.

The build bundles Effect into `dist/memory.js`, and the public type
declarations don’t mention it. `@hraness/oh/memory-page`,
`@hraness/oh/projection`, and `@hraness/oh/store` don’t contain Effect.
`bun run test:package` packs the package, installs it into an empty project,
checks that every export and its type declarations are present, and fails if
Effect is missing from any of the eight built files that should bundle it or
appears in any other.
