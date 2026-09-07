# Hosted semantic V2 ownership

The hosted V2 cache runs schema verification and V1-to-V2 bootstrap, staging,
CAS publication, search, purge and receipt reads as native Effect programs.
The public `OhLibSqlSemanticCacheV2` class and bootstrap/open functions retain
their Promise and DTO interfaces. The parallel V1 cache and the Cloudflare
embedding client retain their existing implementations.

`libsql-semantic-v2-model.ts` holds the unchanged schema literals, digest rules,
row parsers and public values. `libsql-semantic-v2-program.ts` composes complete
workflows directly. The product-local SQL, clock and embedding Tags have named
live layers in `libsql-semantic-v2-platform.ts`. Only the runtime bridge starts
programs; it creates one ManagedRuntime for each opened cache, not for each
query. Standalone bootstrap borrows its client for one complete program.

## Native lifetime and close

Open verifies the installed schema before returning a cache. It never silently
bootstraps a database. Ownership transfers only after verification succeeds:
failed or still-pending open does not close the caller's native client, even
when `closeClient: true` was requested. This preserves the previous acquisition
contract. V1 traffic must still be quiesced before V2 bootstrap.

Calling `close()` raises the admission fence synchronously. Every subsequent
operation rejects with the existing closed-cache error before SQL or embedding
work begins. Operations admitted earlier retain their whole workflow through
native settlement and any subsequent validation or reconciliation. Independent
operations remain concurrent; this owner does not serialize or retry them.
SQL transactions, exact generation identity, tombstones and CAS still arbitrate
their outcomes.

After drain, an owned client is closed once. If its structural synchronous
`close` method actually returns a thenable, that settlement is also joined.
A borrowed client is never closed. Concurrent and later close calls observe the
same settled close outcome, including its original failure value. The shared
Promise is installed before invoking native close, so synchronous reentry cannot
start a second close.

Drain and shared close failure are intentional lifecycle strengthenings: the old
V2 close immediately fenced the object and called owned native close without
joining admitted operations or a returned thenable. This change does not alter
SQL order, arguments, transaction mode, schema bytes, digest preimages, epochs,
isolation, result ordering, purge receipts or publication authority.

An operation failure belongs to that operation's Promise. A later close failure
belongs to close; neither substitutes for the other. Private tagged failures
retain original rejection values, including `undefined`, `null` and `false`.
The public bridge projects the original value by presence, not truthiness.
Unexpected defects remain defects internally. Existing schema-convergence
handlers observe complete Exits so their previous recovery decisions also apply
to a failing verification; an unsuccessful reconciliation preserves the original
Cause. Do not log or serialize private causes.

## Embedding and time

The embedding port joins the existing client's complete native `embed` Promise.
It does not bypass rendered-input provenance, fixed profile or response limits,
sanitized error projection, provider deadlines or caller signals. Bad HTTP
status still performs best-effort body cancellation before its sanitized error.
There is no POST retry. Closing the cache does not introduce a new abort signal.
If a foreign provider ignores cancellation, the cache still waits for its actual
settlement; scope interruption is not evidence that it stopped.

Default timestamps come from the injected clock at the original evaluation
point. Caller-supplied instants do not sample the clock. Existing purge receipts
replay without evaluating a newly supplied timestamp or sampling a new one.

## Verification and package boundary

The existing V1/V2 SQL and digest fixtures, transition crash/race tests, isolation
and purge tests remain independent oracles. V2 ownership tests additionally hold
real native adapter seams during close, exercise falsey rejection values, verify
borrowed and failed-open ownership, preserve CAS rereads, and inject the clock.
Run `bun test src/libsql-semantic.test.ts src/libsql-semantic-v2.test.ts
src/cloudflare-embedding.test.ts`, then `bun run check:effect` and the repository
aggregate under the host scheduler where required.

Effect 3.22.1 is bundled into the hosted `semantic-cloud` entry. Its public
declaration closure does not require Effect. Canonical codecs, the portable
store, page and projection graphs and SQLite stay outside this runtime graph.
The exact module policy and packed graph check admit only this additional
runtime entry; archive bounds and all other graph assertions remain unchanged.
