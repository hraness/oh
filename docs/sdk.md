# Call Oh from TypeScript

By the end of this guide you can open a space from TypeScript, write one or
several records under a head you have checked, read them back, close cleanly,
and tell each Oh error apart. The `Oh` class in `@hraness/oh/sdk` wraps the
local SQLite store and runs on Bun. For Node 24 or a serverless function, pick
an entry point from [Choose an entry point](#choose-an-entry-point).

## Open a space

`Oh.open(options)` is synchronous. You can leave out any option:

| Option | Default | What it sets |
| --- | --- | --- |
| `databasePath` | `".oh/oh.sqlite"` | The SQLite file. |
| `spaceId` | `"default"` | The space inside that file. |
| `semanticBackend` | none | A local embedding backend; see [Search and recall](search.md). |
| `rerankBackend` | none | A local reranker; see [Search and recall](search.md). |

Opening writes to disk. Oh creates the parent directory, the database file,
and the space if they are missing, and runs SQLite in WAL mode, so `-wal` and
`-shm` files appear next to the database while it is open. It then compares the
contract stored in the file with the one compiled into the runtime and throws
`OhIntegrityError` (“The stored contract manifest differs from this runtime.”)
if they differ. A space that was purged throws `OhPurgedSpaceError`.

## Read and write records

| Method | Returns |
| --- | --- |
| `oh.head()` | The current head. |
| `oh.get(key)` | The record at `key`, or `null`. |
| `oh.list({ kind, limit })` | Records in key order; `limit` defaults to 50, up to 1,000. |
| `oh.put({ key, kind, value, … })` | The committed operation. |
| `oh.tombstone({ key, … })` | The committed operation. |
| `oh.verify()` | The replay result. |
| `oh.store.log(limit)` | Operations, newest first; `limit` defaults to 50, up to 1,000. |

A head has six fields: `generation`, `graphRevisionSha256`,
`operationSha256`, `recordsSha256`, `sequence`, and `v`. In an empty space
`operationSha256` is `null` and `sequence` is 0.

`put` and `tombstone` accept `actorId` (default `"agent.local"`),
`operationId` (default a random `op_` ID), `expectedHead`, and `instant`.
Without `expectedHead`, the SDK reads the head just before it writes, which
only protects you from writers that land in that instant. Pass the head you
read before deciding on the change when other writers matter. `put` also takes
`dependencies`, which it sorts, and `tombstone` fails with an ordinary `Error`
such as `No record exists at entity:ada-lovelace.` when the key is empty.

Keys match `^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$` and are at most 512
characters; actor, operation, and space IDs follow the same grammar and are at
most 128. There are 18 record kinds: `activity`, `assertion`, `context`,
`dependency-manifest`, `edition`, `entity`, `evidence`, `identity-operation`,
`inquiry`, `inquiry-event`, `review-decision`, `rights-decision`, `schema`,
`shape`, `statement`, `type-membership`, `view`, and `vocabulary`. A record
value is at most 1 MiB with at most 4,096 dependencies; the byte encoding is in
[Canonical JSON and digests](../spec/v1/canonical-json.md).

`verify()` runs SQLite’s `integrity_check` and `foreign_key_check`, then
replays every operation and compares the result with the stored records. It
returns `{ head, operations, records, sqliteIntegrity: "ok", v: 1 }` or throws
`OhIntegrityError`.

### Write several records at once

`oh.store.commit` applies several changes as one operation. Build each record
with `createKnowledgeGraphRecordV1` from the root entry point:

```ts
import { createKnowledgeGraphRecordV1 } from "@hraness/oh";
import { Oh } from "@hraness/oh/sdk";

const oh = Oh.open();

try {
  const source = createKnowledgeGraphRecordV1({
    dependencies: [],
    key: "entity:trial-report",
    kind: "entity",
    v: 1,
    value: { title: "Trial report" },
  });
  const edition = createKnowledgeGraphRecordV1({
    dependencies: ["entity:trial-report"],
    key: "edition:trial-report-v1",
    kind: "edition",
    v: 1,
    value: { version: 1 },
  });
  const operation = oh.store.commit({
    actorId: "agent.local",
    changes: [
      { kind: "put", record: source, v: 1 },
      { kind: "put", record: edition, v: 1 },
    ],
    expectedHead: oh.head(),
    operationId: "op_import_trial_report",
  });
  console.log(operation.sequence);
} finally {
  await oh.close();
}
```

A commit carries 1 through 8,192 changes, and the space holds at most 65,536
records afterward. Every change lands in one `BEGIN IMMEDIATE` transaction,
or none does:

- Sending the same operation ID again with the same actor and changes returns
  the stored operation, so a retry after a lost reply is safe. The same ID
  with different content throws `OhConflictError` (“The operation ID is
  already bound to different content.”).
- A head that moved throws `OhConflictError` (“The expected head does not
  match the current space head.”).
- A tombstone’s `priorSha256` must match the current record, or the commit
  throws `OhConflictError` naming the key.
- A dependency that is missing once the operation applies throws
  `OhDependencyError` (“Missing dependency X for Y.”).
- A host can pass `maximumOperationBytes` to cap the encoded operation. A
  larger one throws `OhOperationSizeError` before anything is written.

## Search, recall, and sync

`oh.search`, `oh.recall`, and `oh.indexSemantic` are covered in
[Search and recall](search.md). `oh.sync(transport, options)` is covered in
[Fast-forward sync](sync-runtime.md). All three are asynchronous, and `close`
waits for them.

## Close the space

`await oh.close()` waits for every search, recall, index, and sync call in
flight to settle, then closes the semantic backend, the reranker, and the
store, in that order. Calling it again returns the same promise. If one step
fails, that error is rethrown; if several fail, they arrive together in an
`AggregateError` (“Oh resource release failed.”). Any call after `close`
fails with “Oh is closed.”

## Handle errors

| Error | Guard | Thrown when |
| --- | --- | --- |
| `OhConflictError` | `isOhConflictError` | The head moved, an operation ID was reused for other content, or a prior digest is stale. |
| `OhIntegrityError` | `isOhIntegrityError` | The stored contract differs, SQLite reports damage, or replay disagrees. |
| `OhDependencyError` | `isOhDependencyError` | A record points at a key that does not exist. |
| `OhProfileError` | `isOhProfileError` | A store profile forbids the call, such as purging a canonical space. |
| `OhOperationSizeError` | `isOhOperationSizeError` | An operation is larger than the host’s byte cap. |
| `OhValidationError` | none | Input fails a contract check; it carries `code` and `path`. |
| `OhPurgedSpaceError` | none | The space was purged; it carries the purge `receipt`. |

Do not retry an `OhConflictError` unchanged. Read the new head and records,
decide whether your change applies to what you find, and submit a new operation.

The five guarded classes keep their `instanceof` identity across separately
bundled Oh entry points. Each carries a brand under
`Symbol.for("@hraness/oh/<Name>/v1")` that cannot be reconfigured or
overwritten, and the guards accept a caught value only when it is a native
error with that brand. Copying a name or prototype onto a plain object does not
pass.

`OhOperationSizeError` extends `RangeError`. It has the code
`oh.operation-size.v1` (exported as `OH_OPERATION_SIZE_ERROR_CODE_V1`), the
`operationBytes` and `maximumOperationBytes` that were compared, and a message
such as `The 70000-byte operation exceeds the host-declared 65536-byte
canonical bound.`

The memory entry point adds two subclasses.
`OhMemoryContinuationError` extends `OhIntegrityError` with the code
`memory-continuation` and a `reason` of `authentication`, `encoding`, or
`identity`. `OhMemoryAdoptionConflictError` extends `OhConflictError` and
carries a `conflict` report with the expected and actual heads and the
conflicting keys. See [Give an agent working memory](working-memory.md).

A divergent sync history is reported as an ordinary `Error` whose message starts
with `Sync conflict:`.

## Choose an entry point

The package has no required dependencies. Three peers are optional:
`@libsql/client` (0.17.4 or newer, below 1), `@suss/datalog` (exactly
0.20.0), and `@tobilu/qmd` (exactly 2.5.3). The test suite runs every entry
point on Bun; the ones marked below also run under Node 24.

| Entry point | Use it for | Tested under |
| --- | --- | --- |
| `@hraness/oh` | Canonical JSON, contract, ontology, schema, graph, operation, store, sync, and observation helpers. | Bun |
| `@hraness/oh/sdk` | The `Oh` class in this guide. | Bun |
| `@hraness/oh/store` | The runtime-neutral promise interface and store profiles. | Bun and Node 24 |
| `@hraness/oh/sqlite` | The local SQLite store and `createOhSqliteStoreAuthorityV1`. | Bun |
| `@hraness/oh/libsql` | A direct libSQL or Turso store; see [Direct libSQL store](libsql-runtime.md). | Bun and Node 24 |
| `@hraness/oh/sync` | Sync transports; see [Fast-forward sync](sync-runtime.md). | Bun |
| `@hraness/oh/semantic` | The optional local embedding backend. | Bun |
| `@hraness/oh/rerank` | The optional local reranker. | Bun |
| `@hraness/oh/semantic-cloud` | The hosted embedding client and libSQL vector cache. | Bun and Node 24 |
| `@hraness/oh/memory` | Working and reviewed memory; see [Give an agent working memory](working-memory.md). | Bun and Node 24 |
| `@hraness/oh/memory-page` | Page records and `.oh.md` files; see [Memory pages](memory-pages.md). | Bun and Node 24 |
| `@hraness/oh/projection` | Recursive rules over one head; see [Derive facts with rules](projections.md). | Bun and Node 24 |
| `@hraness/oh/projection-suss` | The same rules, evaluated again with Suss for comparison. | Bun and Node 24 |
| `@hraness/oh/research` | The research profile; see [The research profile](research-profile.md). | Bun and Node 24 |
| `@hraness/oh/research-store` | Validated research packets in a store. | Bun and Node 24 |

`@hraness/oh/experimental/memory` and `@hraness/oh/experimental/projection-suss`
load the same files as `@hraness/oh/memory` and `@hraness/oh/projection-suss`.
They exist for older imports; new code should use the stable paths.
