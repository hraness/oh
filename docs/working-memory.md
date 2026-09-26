# Give an agent working memory

An agent can take notes in a working store that your host can wipe, read
answers that combine those notes with a reviewed store (Oh calls it canonical)
pinned at one head, and
propose notes for review. Only host code, never the agent, decides what enters
the reviewed store. This guide sets up the working store, composes it with the
reviewed store through `@hraness/oh/memory`, and pages through answers.

Both stores use the same record and operation format as any Oh space; they
differ in how long the data lives and who may change it.

## Open a working store

Working memory uses the same V1 graph and operation bytes as any space, with a
lifecycle the host controls. The host chooses the realm (the tenant or scope
the space is bound to) and keeps that choice. Application code receives the
promise-based store; the host keeps the object that can purge a working space
away from agent tools. A tool that a model calls should offer validating write
methods and size-limited queries, and never the generic `commit` or change
feed.

This example uses the direct libSQL store with three credentials: one for
creating the schema at deploy time, one for the running app, and one for a
separate purge worker. Each `createClient` call opens a network connection to
your database.

```ts
import { createClient } from "@libsql/client";
import {
  bootstrapOhLibSqlAuthorityV1,
  createOhLibSqlStoreAuthorityV1,
  purgeOhLibSqlWorkingSpaceV1,
} from "@hraness/oh/libsql";
import { OH_WORKING_STORE_PROFILE_V1 } from "@hraness/oh/store";

// Run once during deployment with a short-lived schema credential.
const schemaClient = createClient({
  authToken: process.env.OH_SCHEMA_TOKEN!,
  url: process.env.OH_DATABASE_URL!,
});
await bootstrapOhLibSqlAuthorityV1(schemaClient);
schemaClient.close();

// Runtime opens verify the schema and execute no DDL.
const runtimeClient = createClient({
  authToken: process.env.OH_RUNTIME_TOKEN!,
  url: process.env.OH_DATABASE_URL!,
});
const authority = await createOhLibSqlStoreAuthorityV1(runtimeClient, {
  profile: OH_WORKING_STORE_PROFILE_V1,
  realmId: "tenant:example/thread:research",
  spaceId: "thread:research",
});

const store = authority.store;
console.log(await store.head());

// A separately held purge worker either purges the exact existing binding or
// writes an empty-head tombstone when creation never completed. It cannot
// create a space or binding, and a delayed creator cannot revive the space.
const purgeClient = createClient({
  authToken: process.env.OH_PURGE_TOKEN!,
  url: process.env.OH_DATABASE_URL!,
});
await purgeOhLibSqlWorkingSpaceV1(purgeClient, {
  closeClient: true,
  profile: OH_WORKING_STORE_PROFILE_V1,
  realmId: "tenant:example/thread:research",
  spaceId: "thread:research",
});
```

The working profile turns off operation replication. Dependency-closure
export (a record plus everything it depends on) stays available for reviewed
adoption. `purgeWorkingSpace` exists only on `authority.host`; do not expose
that object or raw database credentials through a model tool. The
[store-port specification](../spec/v1/store.md) defines snapshots, the change
feed, codec ingress, closure export, and purge.

The Bun SQLite store has the same shape.
`createOhSqliteStoreAuthorityV1({ path, profile, realmId, spaceId })` from
`@hraness/oh/sqlite` returns `{ host, store }`; the profile defaults to
canonical, the realm to `realm:<space>`, and the space to `default`. With the
canonical profile, `authority.host.replication` offers two calls:

- `exportBundle({ after, through, limit })` returns the largest prefix of
  operations that fits in one bundle, with the change feed’s `from`, `to`,
  `through`, and `hasMore` values so the receiver can check what it got.
- `importBundle({ bundle, expectedHead })` parses the whole bundle strictly and
  applies it in one transaction.

Replication never appears on `authority.store`, and it is `null` for working
profiles. A long-running host can export a bundle, close the local store while
it does network I/O, then reopen, check the head again, and import in one
step.

## Purge a working space

Purging deletes a working space’s records, operations, and binding and leaves
a small permanent record of the purge, its receipt, so the space cannot be
recreated under the same binding. A canonical space cannot be purged; asking throws `OhProfileError`
(“This host handle is not bound to a purgeable working profile.”).

- **SQLite:** `authority.host.purgeWorkingSpace({ purgedAt })` purges once,
  closes the store, and returns the receipt. Calling it again returns the same
  receipt.
- **libSQL:** the same call on the `host` object of a libSQL store, or
  `purgeOhLibSqlWorkingSpaceV1` from a separate worker as in the example above.
  The worker needs no permission to create spaces. When the space was never
  created, it writes a receipt with an empty head so a late creator cannot
  bring the space back. [Direct libSQL store](libsql-runtime.md#purge-a-working-space)
  describes the retries and error messages.

## Compose working and reviewed memory

`@hraness/oh/memory` runs the Oh kernel twice, once per store, with no separate
memory database format. Trusted host code supplies:

- two distinct store handles, working and canonical (the reviewed store), and
  the binding digest expected for each;
- one exact canonical head to pin answers to;
- sealed working codecs, which decide what the agent may write;
- fact extractors, each identified by digest;
- closed lists of named projection programs (the queries the agent may run)
  and nomination routes (where proposals may go).

A host that must fit canonical history into a narrower encrypted transport
can set `maximumCanonicalOperationBytes`. Each canonical operation is measured
before its compare-and-swap write; working-store capacity is unaffected. A
larger operation fails before any write with an `OhOperationSizeError`, a
`RangeError` subtype carrying the actual and configured byte counts and the
code `oh.operation-size.v1`. `isOhOperationSizeError` recognizes it across Oh
entry points and rejects a plain object that copied its fields.

`createOhMemoryAuthorityV1` returns an `agent` object with only `remember`,
`query`, `explain`, and `nominate`, and a separate `host` object for moving
the canonical pin and adopting reviewed proposals. In the example below,
`canonical`, `working`, `codecs`, and `projectDependenciesProgramV2` are
values your host defines, and `reviewedCanonicalHead`, `revisedNomination`,
and `reviewedRecord` come from your own review step:

```ts
import { createOhMemoryAuthorityV1 } from "@hraness/oh/memory";

const memory = await createOhMemoryAuthorityV1({
  actorId: "research.memory-agent",
  adoptionActorId: "research.memory-reviewer",
  canonical: {
    authorityId: "project-reviewed",
    expectedBindingSha256: canonical.store.binding.bindingSha256,
    expectedHead: await canonical.store.head(),
    store: canonical.store,
  },
  nominationRoutes: [{
    destinationPurpose: "kb.review",
    nominationId: "knowledge-review",
  }],
  programs: [projectDependenciesProgramV2],
  working: {
    authorityId: "thread-working",
    codecs,
    expectedBindingSha256: working.store.binding.bindingSha256,
    store: working.store,
  },
});

const result = await memory.agent.query({
  bindings: {},
  continuation: null,
  programId: "project.dependencies",
  v: 2,
});

const nomination = await memory.agent.nominate({
  nominationId: "knowledge-review",
  roots: ["edition:reviewed-summary"],
  v: 1,
});
await memory.host.adoptNomination({
  expectedCanonicalHead: result.identity.canonical.head,
  nomination,
  v: 1,
});

// To replace an existing key, trusted host code must prove the reviewed
// canonical digest. Omit replacements to retain strict insert-only adoption.
await memory.host.adoptNomination({
  expectedCanonicalHead: reviewedCanonicalHead,
  nomination: revisedNomination,
  replacements: [{
    expectedPriorRecordSha256: reviewedRecord.recordSha256,
    key: reviewedRecord.key,
    v: 1,
  }],
  v: 1,
});
```

- `remember` writes working records through the sealed codecs.
- `query` runs one named program and returns rows. Each row says whether its
  premises came from the canonical store, the working store, or an unknown
  source, and how many proofs support it. The result also counts conflicts
  under the `visible-conflicts.v1` policy and issues an explanation token.
- `explain` takes that token, the `resultSha256`, and a row index, and returns
  the proof. A token that is missing, expired, or issued for another result
  throws `OhProfileError`.
- `nominate` packages working records and everything they depend on as a
  proposal for one host-approved route.

### Adopt a nomination

`adoptNomination` parses the whole proposal, checks its route and working
store, and re-exports the records from the nominated working head. Then, for
each record:

- a key absent from the canonical store is inserted;
- a key already at the same digest is left alone;
- a key at a different digest fails, unless host code lists it in
  `replacements` with the reviewed prior digest. A list holds at most 128
  replacements.

A missing, stale, wrong, duplicate, or absent-key claim fails the whole call
with no partial write. Every claim is checked, including claims for keys
already at their nominated digest, and a replay of the same adoption checks
them against its reviewed head. Inserts and replacements share one
compare-and-swap operation using the ordinary record-change format. Before
committing, the authority checks that the canonical snapshot stays within
8,192 records and 32 MiB. Afterward it re-reads the head, so a duplicate
operation or a later writer cannot make it install an out-of-date head. A
stale expected head succeeds only when the current snapshot already holds
every nominated digest. Conflicts arrive as `OhMemoryAdoptionConflictError`
with a report of the heads and conflicting keys.

### Move the canonical pin

`advanceCanonical({ expectedHead, nextHead, v: 1 })` moves the pin from its
current head to the same head or a descendant in the canonical operation
chain. One call checks at most 16,384 operations over at most 64 pages; advance
longer histories in reviewed steps. Host calls run one at a time. A query in
flight keeps the pin it started with, explanation tokens survive the move in
one shared 64 MiB cache, and an old continuation stops working because the
memory identity changed. [How memory host calls run](memory-runtime.md)
covers the queue, borrowed stores, and recovery when a commit reply is lost.

### Input handling

Every method copies unknown JSON input through plain data properties before it
checks it. Getters, symbols, proxies, sparse arrays, and non-JSON values fail,
and the call uses only the copied bytes. The copy stops at 128 levels of
nesting, 65,536 entries per object or array, and 1,048,576 values in total,
and counts canonical bytes before copying each child.

## Page through results

A query evaluates the complete result, within its limits, before returning the
first page. The agent may bind only the primitive parameters the host
declared; it cannot choose sources, rules, purpose, page size, or evaluation
limits. Each program fixes its own limits on derived tuples, proof depth and
size, result bytes, rounds, and work, along with its page size, row count, and
page bytes.

A page reports its start, end, total rows, whether more remain, and how
complete it is. To read the next one, pass the issued `continuation` back
unchanged to the same named query, and keep it out of logs. The continuation
key is 32 to 64 bytes. When a continuation cannot be used,
`OhMemoryContinuationError` says why in `reason`: `encoding`,
`authentication`, or `identity`; start the query again. Other store and rule
failures keep their original types.

`@hraness/oh/experimental/memory` loads the same code for older imports; new
integrations should use `@hraness/oh/memory`. The
[memory specification](../spec/v1/memory.md) defines the stores, conflicts,
paging, and lifecycle in full.
