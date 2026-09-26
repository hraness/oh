# Direct libSQL store

`createOhLibSqlStoreAuthorityV1` opens an Oh space whose current records and
append-only operation log live in a libSQL or Turso database. Oh never resends
a commit. When a write’s reply goes missing, Oh reads the database to find out
what happened, and `store.close()` waits for that work to end before it closes
your client. It closes the client only if you ask it to.

The API calls this database an *authority* because the store reads and writes
the space’s current records and operation log there directly. The
[sync transport](sync-runtime.md), by comparison, copies operations between a
local store and libSQL. Oh accepts any client with the `execute` and `batch`
methods of `@libsql/client`, an optional peer dependency (`>=0.17.4 <1`). The
[store specification](../spec/v1/store.md#direct-libsql-authority) covers the
tables, limits, snapshots, and change feeds.

The functions and store methods return Promises and reject with the original
error values. Inside, each public call runs as one
[Effect](https://effect.website) program. Effect is a TypeScript library for
asynchronous code whose types spell out the failures a program can produce and
the services it depends on. `@hraness/oh/libsql` bundles Effect 3.22.1, so you
don’t add it as a dependency.

## Set up the schema before you open

Run `bootstrapOhLibSqlAuthorityV1(client)` once, in a deployment or migration
step, with a short-lived credential that can create tables. It is the only
function that creates schema objects, and it resolves to
`{ schemaSha256, schemaVersion: 1, v: 1 }`. On a database that already has the
schema, it checks the schema and returns. If it finds `oh_authority_` objects
without the schema table, it rejects with `OhIntegrityError` and the message
`Refusing to bootstrap over preexisting Oh authority objects.`

Opening never creates tables, so your runtime credential needs no permission to
change the schema. Both open functions check the schema marker, the exact set
of tables, indexes, and triggers, and the copy of `OH_CONTRACT_MANIFEST_V1`
that bootstrap stored. That constant names the graph format, ontology, schema
format, and record kinds this release of Oh uses, and carries a digest of its
contents. If you skip bootstrap, open rejects and leaves the database
untouched. If the schema or the stored copy differs from what this release
expects, open rejects with `OhIntegrityError`.

- `createOhLibSqlStoreAuthorityV1(client, options)` reads the space and creates
  it, with its binding, when it doesn’t exist. A binding records the space’s
  realm and profile. If the space exists with a different realm or profile,
  open rejects with `OhProfileError` and the message
  `The remote space is already bound to a different realm or profile.`
- `openExistingOhLibSqlStoreAuthorityV1(client, options)` only reads. It
  rejects a missing, purged, or differently bound space and never writes
  during open, so a reader or purge worker can use a credential without
  permission to create spaces.

The options are `spaceId` (default `"default"`), `realmId` (default
`realm:` followed by the space ID), `profile` (default
`OH_CANONICAL_STORE_PROFILE_V1`), and `closeClient` (default `false`). An
invalid profile rejects with `TypeError` and the message
`Invalid libSQL store profile.` A failed open never closes your client.

Both functions resolve to `{ store, host }`. The `store` object has `binding`,
`head`, `snapshot`, `changesSince`, `commit`, `exportDependencyClosure`,
`verify`, and `close`. The `host` object has `binding` and `purgeWorkingSpace`,
and it is kept separate so that the object you give an agent can’t purge the
space. Don’t expose `host`, or your database credentials, through a model tool.

## How close finishes

`store.close()` marks both `store` and `host` closed before it returns. After
that, every call rejects with an `Error` whose message is
`The Oh libSQL store is closed.`, or with `OhPurgedSpaceError` if the space has
been purged. Then the store drains: each call it accepted earlier runs to the
end, including the checks on the database’s reply and any rereads after a
failed write. Only then does Oh close the client, and only if you opened the
store with `closeClient: true`.

- The store doesn’t queue calls. Two commits made against the same head both
  reach the database, and compare-and-swap picks the winner: a commit applies
  only if the space head matches its `expectedHead`. The other commit rejects
  with `OhConflictError`.
- With `closeClient` left at `false`, the store borrows the client and never
  closes it. Close it yourself after `store.close()` resolves.
- With `closeClient: true`, Oh calls the client’s `close` method once. It
  calls it synchronously and doesn’t wait for a Promise the method returns.
- Every `store.close()` call returns the same Promise, including a call made
  from inside the client’s own `close`. If the client’s `close` throws, that
  Promise rejects with the thrown value.
- A failed call and a failed close keep their own errors. The call rejects
  with its original value, and `close()` rejects with the close failure.
- Close has no timeout. A libSQL request that never returns keeps `close()`
  waiting.

## When a commit’s reply goes missing

A commit writes in one libSQL transaction guarded by compare-and-swap. If that
write rejects, Oh doesn’t send it again. It reads the operation by its
`operationId`, and then the current head:

- If the operation is there with the same actor and changes, the commit landed
  and only its reply was lost. Oh checks that the head reaches the operation
  and resolves with it.
- If the head moved, the commit rejects with `OhConflictError` and the message
  `The remote space head changed while committing.`
- Otherwise the commit rejects with the original error.

You can retry an uncertain commit yourself. Calling `commit` again with the
same `operationId`, actor, and changes returns the stored operation without a
second write. The same `operationId` with different content rejects with
`OhConflictError` and the message
`The operation ID is already bound to different content.`

When you pass `instant` to `commit`, Oh uses it and doesn’t read the clock.
Otherwise it reads the current time when it builds the operation.
`createOhLibSqlStoreAuthorityV1` also reads the clock once each time it opens,
for the creation time of a space it creates, and
`bootstrapOhLibSqlAuthorityV1` reads it only when it creates the schema.

## Purge a working space

Only a space opened with a working profile, such as
`OH_WORKING_STORE_PROFILE_V1`, can be purged. A purge deletes the space’s
records, operations, and binding, and leaves a purge receipt,
`OhSpacePurgeReceiptV1`: a small permanent row with the space ID, the
binding’s digest, the head before the purge, the purge time, and
`receiptSha256`, a digest of those fields. A later open rejects with an
`OhPurgedSpaceError` whose `receipt` property holds that receipt, instead of
recreating the space.

`host.purgeWorkingSpace({ purgedAt })` purges the space you opened. On a
canonical profile, such as `OH_CANONICAL_STORE_PROFILE_V1`, it rejects with
`OhProfileError` and the message
`This host handle is not bound to a purgeable working profile.` Otherwise it
tries up to three times:

- If a purge receipt already exists, it checks that the purge is complete and
  returns that receipt.
- If not, it reads the head and runs one transaction that writes a receipt and
  deletes the space’s rows, but only if the head and binding still match. It
  then reads the receipt back, checks the purge, and returns the receipt.
- If that transaction fails, it returns a receipt that another purge wrote in
  the meantime, after the same check. With no receipt, it tries again.

After three tries without a receipt, it rejects with `OhConflictError` and the
message `The remote working space changed repeatedly while purging.` Calling
it again on the same handle returns the same receipt, and later calls on the
store reject with `OhPurgedSpaceError`.

`purgeOhLibSqlWorkingSpaceV1(client, options)` is for a separate purge worker
that never opens the store. Its profile defaults to
`OH_WORKING_STORE_PROFILE_V1`, and a canonical profile rejects with
`OhProfileError` and the message
`Whole-space purge requires a bound working profile.` If the space exists with
the same binding, the worker purges it. A space bound to a different realm or
profile rejects with `OhProfileError`. If the space was never created, the
worker writes a purge receipt with an empty head, so that a creator that
arrives late can’t bring the space back. Its credential needs no permission
to create spaces or bindings. After three attempts that don’t converge, it
rejects with `OhConflictError` and the message
`The remote working space changed repeatedly while fencing purge.`

The worker borrows the client unless you pass `closeClient: true`. With
`closeClient: true`, it closes the client after the purge whether the purge
succeeded or failed, like a `finally` block. If both the purge and the close
fail, it rejects with the close failure. Both purge routes take an optional
`purgedAt` and read the clock only when you leave it out.

## Contributing to the libSQL runtime

The code is split so that one file runs programs and one file calls your
client.

| File | Role |
| --- | --- |
| `src/libsql.ts` | The public functions. They return Promises and re-export the public types and `OH_LIBSQL_STORE_LIMITS_V1`. |
| `src/libsql-model.ts` | Public types, schema statements, limits, digests of [canonical JSON](../spec/v1/canonical-json.md), and row validators. |
| `src/libsql-program.ts` | The workflows: bootstrap, open, head and snapshot reads, change feeds, commit with its replay and recovery, verification, and purge. Store methods compose Effects directly. |
| `src/libsql-platform.ts` | The `LibSqlAuthorityClient` service, tag `@hraness/oh/LibSqlAuthorityClient`, and its live layer, `libSqlAuthorityClientLive(client)`. |
| `src/libsql-runtime.ts` | The runtime bridge: the only file that runs programs, once per public call and never once per SQL statement. |

In Effect terms, a program asks for a *service* by its tag, and a *layer*
supplies the implementation. A *fiber* is one running program. A *defect* is
an unexpected throw, kept apart from the failures a program declares, and an
`Exit` records how a program ended.

`LibSqlAuthorityClient` wraps your client and the wall clock. Its `execute` and
`batch` run uninterruptibly, so an interrupted fiber waits for the client’s
Promise, and a write in progress can’t drop out of the store’s view. It sends
each batch as one transaction, never splits a batch, and retries nothing.
Keep each batch’s SQL, argument order, transaction mode, compare-and-swap
guards, and result checks as they are. `close` calls the client’s `close`
synchronously, and `currentInstant` reads the current time through
`canonicalNow`.

The store keeps a count of accepted calls and one drain signal. A call checks
the closed flag and joins the count before it starts, and it leaves the count
when its whole workflow ends, reconciliation included. `close()` sets the flag
without awaiting anything first, stores its Promise before the client’s
`close` can run, waits for the count to reach zero, and then closes the client
if `closeClient` is `true`. The flag covers the `host` object too.

The platform sorts every thrown or rejected value into a tagged failure:
`LibSqlConflict` for `OhConflictError`, `LibSqlDependency` for
`OhDependencyError`, `LibSqlIntegrity` for `OhIntegrityError`, `LibSqlProfile`
for `OhProfileError`, `LibSqlPurged` for `OhPurgedSpaceError`,
`LibSqlCapacity` for `OhOperationSizeError` or `RangeError`,
`LibSqlValidation` for `TypeError`, and `LibSqlForeign` for anything else. A
call on a closed store fails with `LibSqlClosed`. Each tagged failure holds
the original value only so that the Promise can reject with it. Any other
throw stays a defect until the runtime bridge rejects the Promise with the
thrown value. The standalone purge collects its result as an `Exit`, closes
the client if `closeClient` is `true`, and only then resolves or rejects,
which is how a close failure takes precedence.

Run `bun test src/libsql.test.ts src/libsql-lifecycle.test.ts`. The lifetime
tests in `src/libsql.test.ts` use an in-memory SQLite database that applies
each batch as one transaction. They cover two concurrent commits with one
compare-and-swap winner, a call still running when close begins, a failed
write whose recovery finishes before a failing close, a lost reply recovered
without a second write, borrowed clients, a close made from inside the
client’s own `close`, and the order of errors in a standalone purge.
`src/libsql-lifecycle.test.ts` covers an interruption that waits for the
native transaction to finish, and failures kept apart from defects. The tests
for tampered rows, replay, purge, schema checks, and provider response limits
define correct behavior, and a change must pass them as written. Then run
`bun run check:effect` for the architecture checker, `bun run typecheck`,
`bun run test:package` and `bun run test:node` for the packed package and its
Node build, and `bun run check`, which includes all of them.

The build bundles Effect 3.22.1 into `dist/libsql.js`. Effect is a development
dependency, so the package asks you to install nothing for it. `dist/libsql.js`
doesn’t include the hosted semantic cache, and the `@hraness/oh/store`,
`@hraness/oh/sqlite`, `@hraness/oh/memory-page`, and `@hraness/oh/projection`
entry points don’t contain Effect. `bun run test:package` fails if Effect is
missing from any of the eight built files that should bundle it or appears in
any other built file.
