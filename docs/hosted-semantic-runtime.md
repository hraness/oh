# Hosted semantic cache V2 lifecycle

`openOhLibSqlSemanticCacheV2` gives you a cache of semantic search vectors for
Oh records, stored in a libSQL database. Opening it checks the schema and
never creates one. Closing it waits for every call already under way,
including one blocked on the embedding provider, and closes your libSQL client
only if you asked it to.

The cache holds derived data that you can rebuild from your Oh records. It
groups vectors by authority: the set of Oh records that one `authorityId`
names, such as `thread:research/epoch:1`. Each call also names an isolation
scope with an `isolationSha256` digest, which Oh derives from the authority ID
when you leave it out. A scope belongs to a single authority, and one
authority can reserve several. Vectors are stored per scope, so identical text
in two scopes is embedded and stored twice, and purging an authority deletes
only the vectors in its own scopes. Scopes keep data apart but don’t encrypt
it.

You pass an `OhCloudflareEmbeddingClientV1` to `stage` and `search`, and that
client computes the vectors with Cloudflare Workers AI. The cache and the
client both come from `@hraness/oh/semantic-cloud`. The
[hosted semantic cache V2 specification](../spec/v2/semantic-cloud.md) defines
the tables, digests, isolation rules, and purge records.

Each method returns a Promise. Behind it runs an
[Effect](https://effect.website) program. Effect is a TypeScript library for
asynchronous code whose types list the failures a program can produce and the
services it needs. The package bundles Effect 3.22.1, so you don’t install it,
and no public type refers to it. The V1 cache from the same entry point and
the Cloudflare embedding client are Promise code that doesn’t use Effect.

## Create the schema, then open

Run `bootstrapOhLibSqlSemanticCacheV2(client)` once, with a credential that
can create tables. Bootstrap looks only at the cache’s own tables, indexes,
and triggers, whose names start with `oh_semantic_`, so other tables in the
database don’t affect it. When it finds none, it creates the V2 schema. On a
V2 database it checks the schema and returns. On a V1 database it upgrades, as
described below, and it resumes an upgrade that stopped partway. Any other set
of `oh_semantic_` objects makes it reject with code `integrity` and the
message `Refusing to bless a partial or drifted semantic V2 schema.` It
resolves to `{ schemaSha256, schemaVersion: 2, v: 2 }`. Bootstrap borrows the
client for that one run and never closes it.

`openOhLibSqlSemanticCacheV2(client, { closeClient })` reads the schema marker
and compares the cache’s tables, indexes, and triggers with the V2 schema
before it returns a cache. It never creates or repairs a table. When the check
fails, open rejects with an `OhLibSqlSemanticV2Error`:

| `code` | Message | Cause |
| --- | --- | --- |
| `schema-unavailable` | `The semantic cache schema is unavailable.` | The marker table can’t be read, for example because bootstrap never ran. |
| `schema-unavailable` | `The semantic cache schema marker is invalid.` | There is no V2 marker row, as in a V1 database, or it names a different schema or digest. |
| `schema-unavailable` | `The semantic V2 cache upgrade is still materializing purge custody.` | An upgrade from V1 hasn’t finished. Run bootstrap again. |
| `integrity` | `The semantic cache schema has drifted.` | The cache’s tables, indexes, or triggers differ from the V2 schema. |

A failed open never closes your client, even with `closeClient: true`, and an
open that hasn’t resolved hasn’t taken the client over. After a failed open,
use the client again or close it yourself.

## Who closes your libSQL client

- `closeClient` defaults to `false`. The cache borrows the client and never
  closes it. Close the client yourself after `cache.close()` resolves; until
  you do, the client stays open.
- With `closeClient: true`, the cache takes over the client when open
  succeeds. After the calls in flight finish, it calls the client’s `close`
  method once. The client type declares `close` as synchronous, but if it
  returns a Promise, the cache waits for that Promise too.

## What `close()` waits for

`close()` marks the cache closed before it returns. From then on, every call
rejects with an `OhLibSqlSemanticV2Error` whose `code` is
`schema-unavailable` and whose message is `The semantic cache is closed.`,
before it sends any SQL or embedding request. Then the cache drains: it waits
for each call it accepted earlier to finish, whether that call succeeds or
fails, and only then closes the client, if you opened the cache with
`closeClient: true`.

A call counts as finished when its whole workflow is done:

- A `stage` call waiting on the embedding provider gets its vectors, writes
  them, and resolves before the client closes.
- A `publish` whose compare-and-swap write has reached the database waits for
  the reply and for the reads that confirm the new head.
- A `purgeAuthority` call in progress runs to the end, including its
  tombstone, the permanent row that stops the same `authorityId` from being
  staged or published again.

The cache doesn’t queue calls or retry them. Calls run side by side, and the
database decides races between them through SQL transactions, generation
digests, purge tombstones, and compare-and-swap on the published head. With
compare-and-swap, `publish` moves the head only if it points at the generation
you passed as `expectedPublishedGeneration` when the write runs. When you pass
`null`, the write succeeds only if the authority has no published head.

Every `close()` call shares one outcome, including a call made from inside the
client’s own `close` method, so the client closes at most once. If closing
the client fails, every `close()` call rejects with that same error value.
Close has no timeout: a call that never finishes keeps `close()` waiting.

## Rejections keep the original value

Each Promise rejects with the value that caused the failure, unchanged. If your
libSQL client rejects with `undefined`, `null`, or `false`, the call rejects
with that same value. A call that fails while the cache is closing rejects
with its own error. `close()` doesn’t take on that error: it rejects only if
closing the client fails, and then with that failure.

## Upgrade a V1 database

V1 and V2 caches use the same table names, so a database holds one or the
other. You can upgrade a V1 database to V2. You can’t open a V2 database as V1
or downgrade it.

1. Stop `stage`, `publish`, `publishedHead`, and `search` calls on every V1
   cache open on the database. An open V1 cache doesn’t turn into a V2 cache.
2. Run `bootstrapOhLibSqlSemanticCacheV2(client)`.
3. If bootstrap rejects or your process stops before it resolves, run it
   again. It picks up where the last run stopped.
4. Open the V2 cache, then stage and publish each authority again.

The upgrade discards every V1 published head, generation, membership, and
vector. V1 stores each vector once and shares it between authorities, while V2
keeps each authority’s vectors apart and can’t work out after the fact which
authority a shared vector belongs to. The upgrade keeps every V1 purge
tombstone, so a purged authority ID stays purged. Each tombstone becomes a V2
purge receipt, the permanent record of a purge, with `countsRecorded: false`
because V1 kept no counts. A V1 `purgeAuthority` call can race the upgrade: a
purge that commits before the upgrade begins is carried over, and one that
reaches the new tables can’t report success.

Bootstrap upgrades in steps you can interrupt:

- One write transaction copies every V1 tombstone into a transition table,
  drops the V1 tables, and creates the V2 tables without the V2 schema marker.
- Bootstrap converts the copied tombstones in pages, one transaction per page.
  A crash before a page commits changes nothing, and a crash after it is safe
  to replay.
- A last transaction writes the V2 schema marker and drops the transition
  table. Until it commits, open rejects with the unfinished-upgrade error from
  the table above.
- Bootstraps that run at the same time converge on one transition table and
  the same result.
- If the first transaction fails, bootstrap inspects the tables. It checks and
  accepts a finished V2 schema, and it continues a transition in progress.
  Anything else rejects with code `integrity` and the message
  `The semantic V1-to-V2 transition did not begin atomically.`
- If a later step fails, bootstrap succeeds when the schema turns out to be
  finished V2, for example because another bootstrap completed it. Otherwise
  it rejects with the original error.

## Embedding requests

`stage` and `search` send text to Cloudflare Workers AI through the
`OhCloudflareEmbeddingClientV1` you pass as `embeddingClient`. The cache calls
the client’s `embed` method, waits for its Promise to finish, and adds no
retry. The client’s own checks apply:

- It accepts only inputs produced by Oh’s renderer, each at most 448 UTF-8
  bytes, and embeds them with one fixed profile,
  `oh.cloudflare.embeddinggemma.v1`, which uses the
  `@cf/google/embeddinggemma-300m` model.
- A batch holds one through `maximumBatchInputs` inputs: 16 by default and 32
  at most. When it stages, the cache embeds only inputs that have no stored
  vector yet, at most 16 per `embed` call. A search embeds its query alone.
  With `maximumBatchInputs` below 16, a stage that needs more vectors than
  that rejects with code `invalid-input`.
- Each request has a deadline, `deadlineMs`, of 15,000 milliseconds by default
  and 30,000 at most. The client combines it with the `signal` you pass to
  `stage` or `search`.
- The client sends one `POST` with `redirect: "error"` and never retries it.
- It reads at most `maximumResponseBytes` of the response. That option
  defaults to 8 MiB, which is also the largest value it accepts.
- On an HTTP error status, it cancels the response body when it can, then
  rejects with an `OhCloudflareEmbeddingError` whose `code` is
  `provider-unavailable` and whose message names the status, such as
  `The embedding provider rejected the request with HTTP 503.` The other codes
  are `aborted`, `invalid-response`, and `invalid-input`. No error message
  includes the provider’s response body.

`OH_CLOUDFLARE_EMBEDDING_LIMITS_V1` holds these maximums, along with the
renderer’s limits on title size, document size, and chunks per document.

Closing the cache doesn’t abort a request. To stop one, abort the `signal` you
passed. If the `fetch` behind the client ignores the abort, the cache waits
until the request ends, and `close()` waits with it.

## Timestamps

`stage`, `publish`, `purgeAuthority`, and `bootstrapOhLibSqlSemanticCacheV2`
each take an optional instant: `createdAt`, `publishedAt`, `purgedAt`, and
`appliedAt`. The cache checks a value you pass, uses it, and doesn’t read the
clock for it. When you leave it out, the call reads the clock once, before its
first write.

`purgeAuthority` resolves to an `OhSemanticPurgeResultV2`, the purge receipt.
It records the purge time, the published generation if there was one, how
many generations, memberships, and vectors the purge deleted, how many
isolation scopes the authority had reserved, and digests that identify the
purge. The scopes stay reserved after the purge. Calling `purgeAuthority`
again for an authority that is already purged returns the first receipt, with
its original `purgedAt`. That call doesn’t read the clock and ignores the
`purgedAt` you pass. `purgeReceipt({ authorityId })` returns the same receipt
without deleting anything, or `null` if the authority hasn’t been purged. In
both cases the isolation digest you pass, or the one Oh derives, must match
the one the purge recorded, or the call rejects with code `conflict` and the
message `The semantic purge isolation conflicts.`

## Working on the V2 cache

This section is for contributors. The V2 code is split so that one file runs
programs and one file talks to libSQL, the clock, and the embedding client.

| File | Role |
| --- | --- |
| `src/libsql-semantic-v2.ts` | The public class and functions. They return Promises and expose no Effect types. |
| `src/libsql-semantic-v2-model.ts` | Schema literals, digest rules, row parsers, public values, and `OH_LIBSQL_SEMANTIC_LIMITS_V2`. |
| `src/libsql-semantic-v2-program.ts` | The workflows: schema checks, bootstrap and the V1 upgrade, stage, publish, search, purge, and receipt reads. |
| `src/libsql-semantic-v2-platform.ts` | The services `SemanticCacheSql`, `SemanticCacheClock`, and `SemanticCacheEmbedding`, with the live layers `semanticCacheSqlLive(client)`, `semanticCacheClockLive`, and `semanticCacheEmbeddingLive`. |
| `src/libsql-semantic-v2-runtime.ts` | The runtime: the only file that starts programs. |

In Effect terms, a program asks for a *service* by its tag, and a *layer*
supplies the live implementation. A *runtime* runs programs with a set of
layers, and a `ManagedRuntime` is one you create and dispose of yourself. Each
running program is a *fiber*. A *defect* is an unexpected throw, kept apart
from the failures a program declares, and an `Exit` records whether a program
succeeded or failed.

The runtime file creates one `ManagedRuntime` per opened cache, never one per
call, and disposes of it after `close()` finishes or when open fails. Open
runs the schema check uninterruptibly, and the cache takes over the client
only after that check succeeds. Bootstrap runs one uninterruptible program
with its own layers and borrows the client for that run.

Before a call starts, the runtime checks the closed flag and counts the call
in. The count drops when the call’s workflow ends, success or failure.
`close()` sets the flag synchronously, stores its Promise before anything can
call the client’s `close`, waits for the count to reach zero, and then closes
the client if the cache took it over. Each accepted workflow runs with
`Effect.uninterruptible`, so interrupting its fiber can’t end the call while a
SQL request, an embedding request, or the rereads after a write are in
progress. An interrupted fiber is never treated as proof that a request
stopped.

The platform wraps every thrown or rejected value in a private failure tagged
`SemanticCacheDomain` for an `OhLibSqlSemanticV2Error`,
`SemanticCacheEmbedding` for an `OhCloudflareEmbeddingError`, or
`SemanticCacheForeign` for anything else. The wrapper holds the original value
only so that the Promise can reject with it. The runtime checks whether a
failure is present rather than whether its value is truthy, so `undefined`,
`null`, and `false` reject as themselves. Don’t log or serialize the wrapped
values. A defect stays a defect, and the Promise rejects with the thrown
value. Bootstrap’s recovery code inspects the complete `Exit` of each
attempt, so a failed schema check gets the same recovery as a failed write,
and when recovery can’t show that the schema converged, the original failure
is raised again.

The lifecycle code decides when calls start and when the client closes. It
must not change what the cache stores or returns: SQL order and arguments,
transaction modes, schema bytes, digest inputs, isolation scopes, result
order, purge receipts, or the rules for which call may publish a head.

Run `bun test src/libsql-semantic.test.ts src/libsql-semantic-v2.test.ts
src/cloudflare-embedding.test.ts`, then `bun run check:effect` and
`bun run check`. The V1 and V2 SQL and digest fixtures, the upgrade crash and
race tests, and the isolation and purge tests define what the cache stores and
returns, and a lifecycle change must pass them unchanged. The lifecycle tests
in `src/libsql-semantic-v2.test.ts` hold a native call open during close,
reject with `undefined`, `null`, and `false`, cover borrowed clients and
failed opens, wait for the rereads after a compare-and-swap write, and replace
the clock layer. `bun run check:effect` runs the architecture checker, whose
rules are listed in the
[local semantic backend lifecycle](semantic-lifecycle.md#change-the-lifecycle-code).
Its policy lists the public, program, platform, and runtime files as governed
modules, the platform and runtime files as adapters that may do native I/O,
and the runtime file as this cache’s runtime root.

The build bundles Effect 3.22.1 into `dist/semantic-cloud.js`. The type
declarations for `@hraness/oh/semantic-cloud` don’t import Effect, so
TypeScript users don’t need it installed. Effect stays out of the code for
canonical JSON, the portable store, memory pages, rule evaluation, and SQLite,
and the built `@hraness/oh/store`, `@hraness/oh/sqlite`,
`@hraness/oh/memory-page`, and `@hraness/oh/projection` entry points don’t
contain it. `bun run test:package` packs the package and fails if Effect is
missing from any of the eight built files that should bundle it,
`dist/semantic-cloud.js` among them, or appears in any other built file. The
same check limits the archive to 64 MiB and its contents to 1,000 files,
64 MiB unpacked, and 4 MiB in any one file.
