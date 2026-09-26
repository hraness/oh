# Fast-forward sync

One sync call brings a local Oh store and a remote to the same head by pulling
or pushing operations until both sides match. It works when one history
extends the other. When the histories have diverged, the call rejects with a
conflict and overwrites neither side, which leaves the merge to your
application.

You start a sync with `oh.sync(transport, options)` on the SDK’s `Oh` object,
or with `synchronizeOhStoreV1(store, transport, options)` from
`@hraness/oh/sync`. A *transport* is any object with the four methods of
`OhOperationSyncTransportV1`: `handshake`, `head`, `pull`, and `push`.
`createLibSqlOperationSyncTransportV1(client)` builds one on a libSQL or Turso
database. The [sync specification](../spec/v1/sync.md) defines the bundle
format, the handshake, and each round.

Both functions return Promises that reject with the original error values.
Inside, the sync loop and the libSQL transport are
[Effect](https://effect.website) programs. Effect is a TypeScript library for
asynchronous code whose types list what a program can fail with and what it
depends on. Effect 3.22.1 is bundled into the package, so there is nothing
extra to install.

## Sync with libSQL or Turso

`@libsql/client` is an optional peer dependency. Install it:

```sh
bun add @libsql/client@^0.17.4
```

Then create the client, wrap it in a transport, and sync:

```ts
import { createClient } from "@libsql/client";
import { Oh } from "@hraness/oh/sdk";
import { createLibSqlOperationSyncTransportV1 } from "@hraness/oh/sync";

const client = createClient({
  authToken: process.env.TURSO_AUTH_TOKEN!,
  url: process.env.TURSO_DATABASE_URL!,
});
const oh = Oh.open();

try {
  const transport = createLibSqlOperationSyncTransportV1(client);
  const result = await oh.sync(transport, { remoteId: "research-cloud" });
  console.log(result);
} finally {
  await oh.close();
  client.close();
}
```

Close the client yourself after `oh.close()` resolves, as the `finally` block
does. `oh.close()` waits for sync calls in progress, which may be using the
client, and neither it nor the transport closes the client.

The transport uses only the client’s `execute` and `batch` methods (the
`LibSqlClientV1` shape). On first use it creates two tables in the remote
database if they don’t exist yet, so the client’s credential needs permission
to create tables. `oh_sync_operations` holds the operation log.
`oh_sync_contracts` holds a copy of `OH_CONTRACT_MANIFEST_V1`, a constant that
names the graph format, ontology, schema format, and record kinds this release
of Oh uses and carries a digest of its contents. Semantic search files and
vectors never go to the remote.

## What happens during one call

The result is `{ head, pulled, pushed, rounds, v: 1 }`: the head both sides
reached, how many operations moved each way, and how many rounds it took.

- Sync checks its options first. `batchSize` defaults to 100 and accepts one
  through 1,000. `maximumRounds` defaults to 100 and accepts one through
  10,000. `remoteId` defaults to `"default"` and names the remote in the
  store’s sync state. An invalid value rejects with `TypeError` and the
  message `Invalid sync options.`
- It calls `handshake` with `OH_CONTRACT_MANIFEST_V1`. The libSQL transport
  rejects a remote that holds a different copy with the message
  `Remote contract manifest mismatch.`
- Each round reads the remote head, then the local head. If they are the same
  operation, sync records that head in the store’s sync state for `remoteId`
  and resolves.
- A local store that is behind pulls up to `batchSize` operations after the
  local head and imports them. A store that is ahead pushes up to `batchSize`
  operations after the remote head, as many as fit in one bundle: at most
  1,000 operations and 64 MiB plus 4 KiB.
- After a pull or push that reaches the other side’s head, sync reads both
  heads again and finishes in that round only if they match exactly. You don’t
  need to leave a spare round in `maximumRounds` for this check.
- Nothing is retried. A failed store or transport call rejects the sync with
  that call’s original error.

Sync’s own checks reject with an `Error` and one of these messages:

| Message | What went wrong |
| --- | --- |
| `Sync conflict: equal sequence numbers have different heads.` | Both sides have the same number of operations but different histories. |
| `Sync conflict: remote history does not extend the local head.` | A pulled page is malformed, empty, larger than `batchSize`, for another space, not right after the local head, or past or in conflict with the remote head. |
| `Sync conflict: local history does not extend the remote head.` | The local store’s page of operations to push is empty or doesn’t start right after the remote head. |
| `The sync transport returned an invalid head.` | `head` returned something that isn’t a valid sync head. |
| `The sync transport returned an invalid push head.` | `push` returned something that isn’t a valid sync head. |
| `The sync transport acknowledged a different head.` | `push` acknowledged a head other than the last operation it was sent. |
| `Sync did not settle within maximumRounds.` | The heads didn’t meet within `maximumRounds` rounds. |

When the local store is ahead and the histories have diverged, the SQLite
store rejects before sync’s push check, with `OhConflictError` and the message
`The requested sequence identifies a different operation head.`

If a sync fails partway, you decide whether to run it again. Operations it
already imported or pushed stay where they are, and the next call starts from
the heads it finds. The libSQL transport accepts a repeated push of operations
it already holds, even if another writer has added more since, after checking
that every sequence number, digest, and operation matches the stored rows. A
missing or different row rejects the push with a `Sync conflict:` message, and
so does a push that no longer follows the remote head because another writer
pushed first.

## Concurrent calls and store transactions

- Sync calls aren’t queued. Two calls on the same store can run at once. The
  store checks each import against the head that sync read, inside one SQL
  transaction. If the local head has moved since, a page whose operations are
  all already in the local history counts as present, and any other page
  rejects with `OhConflictError`.
- Each import and each sync-state update is one synchronous store call with
  its own SQL transaction. Sync never pauses inside that transaction, so no
  other code runs partway through an import, and an invalid operation later in
  a pulled page rolls back the whole page.
- The store stays open while sync waits on the network. If your application
  needs to record network effects whose outcome is unknown, the
  [specification](../spec/v1/sync.md#sync-rounds) describes splitting capture,
  network exchange, and import into separate steps.
- `synchronizeOhStoreV1` borrows the store and the transport and closes
  neither. `oh.sync` runs as one of the calls `oh.close()` waits for. After
  they finish, `oh.close()` closes the semantic backend, the rerank backend,
  and the store. One failure rejects `close()` with that error. Several reject
  it with an `AggregateError` whose message is `Oh resource release failed.`

## First use of the libSQL transport

`createLibSqlOperationSyncTransportV1` sends nothing when you call it. The
first `handshake`, `head`, `pull`, or `push` creates the tables and checks the
stored copy of `OH_CONTRACT_MANIFEST_V1`.

- Calls that arrive during that setup share one attempt, and each gets its
  result: the same success, the same error value, or the same unexpected
  thrown value.
- If the attempt fails, every call waiting on it rejects with that failure,
  and the next call starts a new attempt.
- Setup and the calls waiting on it can’t be interrupted partway. Each one runs
  until the attempt has a result, and Oh doesn’t cancel a client call that is
  in progress.
- A pull asks for one through 1,000 operations after a sequence number of zero
  or more. A response with more rows than requested rejects, each operation’s
  JSON must fit the 64 MiB operation limit before Oh parses it, and the query
  returns only the longest run of operations that fits in one bundle.

## Inside the sync runtime

This part is for contributors. Programs describe the work, one file supplies
the store, transport, and client, and one file runs everything.

| File | Role |
| --- | --- |
| `src/sync.ts` | The public functions. It re-exports only the public API from the model. |
| `src/sync-model.ts` | Head and bundle parsing, byte limits, `createOhSyncBundleV1`, and the public types, with no Effect code. The SQLite entry point and the CLI import it directly, so code that only reads or writes bundles never loads Effect. |
| `src/sync-program.ts` | `synchronize(options)`, the round loop. |
| `src/sync-libsql-program.ts` | `makeLibSqlSyncTransport`: setup, `head`, `pull`, and `push` on libSQL. |
| `src/sync-platform.ts` | The `SyncStore`, `SyncTransport`, and `LibSqlSyncClient` services and their layers, `syncStoreLive(store)`, `syncTransportLive(transport)`, and `libSqlSyncClientLive(client)`. |
| `src/sync-runtime.ts` | `runSyncBoundary` and `makeLibSqlSyncBoundary`, the only code that runs programs. |

A few Effect terms apply. A *service* is a dependency requested by its tag, and
a *layer* supplies it. A `Ref` is a mutable cell that fibers, meaning running
programs, can update safely. A `Deferred` is a value that is set once and that
any number of fibers can wait for. The transport keeps one `Deferred` for the
current setup attempt in a `Ref`, and `ensure` runs uninterruptibly. A failed
attempt resets the `Ref` so that a later call can try again. A *defect* is an
unexpected throw, and an `Exit` records how a program ended.

The store layer wraps each synchronous store method in `Effect.try` and never
yields inside it, so the SQL transaction runs to the end in one step. Keep
that property, the exact-head checks after each network wait, the
largest-fitting push, the round limit, and the refusal to merge. Add no
automatic retry.

Failures carry one of five tags: `StoreFailure`, `TransportFailure`,
`ValidationFailure`, `SyncConflict`, and `RoundLimit`. Each holds the original
value only so that the Promise can reject with it. Never serialize or log
those values. `runClosed` accepts only a program that can’t fail, needs no
services, and produces an `Exit`. It rejects with the original value of a
tagged failure and with the thrown value of a defect, and it keeps the two
apart until then.

Run `bun test src/sync.test.ts src/sync-lifecycle.test.ts`. The five tests in
`src/sync-lifecycle.test.ts` cover a failed shared setup that rejects every
waiting call before a later call retries, concurrent setups that run once, and
a handshake that rejects with a non-`Error` value, which reaches the caller
unchanged and isn’t retried. In the other two, a store whose `spaceId` getter
throws still produces a rejected Promise instead of a synchronous throw, and a
setup response whose `rows` getter throws rejects both waiting calls with the
thrown value and lets the next call start over. The tests in
`src/sync.test.ts` are the reference for the bytes that sync sends and
receives, rollback, conflicts, pagination, and exact-head checks.

Then run `bun run check:effect`. The architecture checker governs the four
sync modules, allows native I/O only in `src/sync-platform.ts`, and lets only
`src/sync-runtime.ts` run programs. It reads the code with the stock
TypeScript compiler and adds to the tests without replacing any of them.
Finish with `bun run test:package` and `bun run check`.

The root entry point and `@hraness/oh/sdk` export sync, so `dist/index.js` and
`dist/sdk.js` bundle Effect along with `dist/sync.js`, and so does
`dist/cli.js`, which loads the SDK. That extra size is deliberate.
`@hraness/oh/store`, `@hraness/oh/sqlite`, and `@hraness/oh/projection` don’t
contain Effect. The SQLite entry point reads and writes sync bundles through
`src/sync-model.ts` alone, which keeps Effect out of `@hraness/oh/sqlite`. No
public type declaration imports Effect. `bun run test:package` fails if Effect
is missing from any of the eight built files that should bundle it or appears
in any other built file.
