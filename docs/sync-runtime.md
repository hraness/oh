# Sync runtime ownership

The complete fast-forward sync loop and libSQL transport setup/read/write
orchestration use bundled Effect 3.22.1. `synchronizeOhStoreV1` and
`createLibSqlOperationSyncTransportV1` retain their public Promise interfaces and
original rejection values. Consumers do not install a required runtime package.

`sync-model.ts` contains the existing canonical parsing, byte limits and bundle
construction. These helper bodies and exchanged bytes are unchanged. The public
facade deliberately re-exports only the original API. SQLite port and CLI codec
imports use the model directly, so pure codec use does not import a runner.

`SyncStore`, `SyncTransport` and `LibSqlSyncClient` are named local services.
`sync-platform.ts` adapts the caller's store and transport; it does not close those
borrowed resources. Each local import and sync-state update remains one
synchronous store call, including its original SQL transaction. There is no yield
inside an atomic import. Programs retain exact-head confirmation after remote
awaits, the largest fitting prefix, bounded rounds, conflict refusal and explicit
caller-owned replay. They add no automatic request or command retry.

The libSQL initialization state holds one Deferred for one shared attempt.
Concurrent callers receive that attempt's exact success, failure or defect. A
failed attempt clears the cache for a later call; already admitted waiters keep
its original result. The initialization attempt and its waiters drain before
interruption. This preserves the previous Promise API and does not promise to
preempt a foreign client call. Independent sync invocations are not serialized;
store compare-and-swap remains authoritative.

Expected store, transport, validation, conflict and round-limit failures have
explicit tags. Foreign causes are retained only to reproduce the existing public
rejection identity, never serialized or logged. The runtime runner accepts a
closed total Exit; defects remain separate until the Promise facade projects them.

The root API and SDK export sync operations, so their emitted graphs now include
the bundled runtime. This is a deliberate package-size tradeoff; portable pure
store/projection and codec-only graphs must remain separate. Package checks inspect
the actual shipped graph. Public declaration closures must not require Effect.

`bun run check:effect` admits the exact program, adapter and runner modules and
keeps the ordinary TypeScript compiler and all domain tests. Lifecycle regressions
cover shared initialization success/failure/retry, non-Error rejection identity,
construction failures returning rejected Promises, and defective response getters.
Existing sync tests remain the oracle for canonical bytes, atomic rollback,
conflicts, bounded pagination and exact-head settlement. Final package and release
gates remain mandatory after convergence.
