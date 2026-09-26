# Composite agent memory

`@hraness/oh/memory` is the stable entry point for agent memory. It combines
the store and projection contracts so that a host can give an agent memory over
two stores without handing the agent either store. It defines no ontology of
its own and adds no third store. The subpath `@hraness/oh/experimental/memory`
exports the same module.

## Working and canonical stores

The facade works over two physical authorities. A physical authority is one Oh
store together with the database behind it.

A host MUST bind two distinct physical authorities before it creates the
facade:

- a working-profile store, which the agent writes only through semantic
  bundles that the host’s codecs check; and
- a canonical-profile store, pinned at one exact head that the host selects,
  which the returned agent object never writes.

For each store, the host supplies an opaque authority ID and the exact binding
digest it expects. The binding digest, `bindingSha256`, identifies the store’s
contract, profile, realm, and space. The factory rejects two equal authority
IDs, a binding digest that does not match, and a store with the wrong profile.
Results name each store by its authority ID, so they need not reveal a database
path, URL, credential, or purge handle. An Oh space, a semantic context, a
runtime tenant or session, and a physical authority are separate scopes.

The host also binds the actor that writes working memory, the purpose of every
named program, and every named nomination route. None of these labels comes
from agent input.

## Agent and host objects

`createOhMemoryAuthorityV1` returns two separate objects, `agent` and `host`.
The agent has only four methods: `remember`, `query`, `explain`, and
`nominate`. It has no generic commit, store selection, path, sync, rule
registration, canonical write, adoption, rollover, or purge operation. The host
object has two methods, and it runs their calls one at a time.
`advanceCanonical` moves the canonical pin to a later head, which this page
calls a rollover. `adoptNomination` writes reviewed nominated records into the
canonical store. Hosts that already run equivalent control code can use the
lower-level factories, `createOhMemoryAgentV1` and `createOhMemoryAgentV2`,
instead.

`remember` accepts exactly an expected working head, semantic puts and
tombstones, and a `requestId` that makes the call idempotent. The facade
supplies the actor that the host bound and takes the time from the host clock.
If that clock moves backward, the call fails with `OhProfileError`. The facade
derives the operation ID from the actor, the working binding, and the request
ID. It returns an immutable receipt, `OhMemoryRememberReceiptV1`, that contains
no database locator. The receipt names the working `authorityId`, the
`bindingSha256`, the resulting complete `head`, the `operationSha256`, the
`actorId`, the `instant` of the write, and the `requestId`, and it carries its
own `receiptSha256`. A complete head is the full `OhHeadV1`: the sequence, the
generation, and the operation, record, and graph revision digests. `remember`
never returns the raw operation changes, and it never accepts an actor or a
timestamp from the caller.

## Querying both stores

The factory reads the canonical snapshot once, at the pinned head, when it
builds the agent. Every query reads the working store at its current head. From
the two snapshots, the query builds a composite dataset that it discards
afterward. The dataset holds `memory.record` and `memory.dependency` facts.
Each fact starts with its lane, `canonical` or `working`, which names the store
the record came from.

When both stores hold the same key with different record digests, the dataset
gets a `memory.conflict` fact. Working data never hides canonical data for being
more recent. When the digests are equal, the dataset gets a `memory.agreement`
fact. A V1 result lists each conflict. A V2 result reports the number of
conflicts and their digest, `conflictsSha256`.

Trusted host code may register domain fact extractors, each identified by an ID
and a digest. Each extractor declares the relations it owns, and no two
extractors own the same relation. The facade passes an extractor a deeply
immutable record and its lane, and it attaches the record’s exact source to
every fact the extractor emits. The facade limits how many times extractors run
and how many facts they emit. An extractor cannot own a reserved `memory.*` or
`oh.*` relation. Every fact proof names what emitted it: the built-in fact pack,
or the exact domain extractor ID and digest.

Trusted host code also registers a limited set of named programs. Each program
is a parsed rule pack and query with a fixed purpose. Agent input selects a
program by name. It cannot submit a purpose, rule, query AST, or validity label.

The composite identity of a result covers:

- for each store, its authority ID, binding digest, complete head, projection
  snapshot, and dataset digest;
- the composite fact dataset;
- the named program, with its exact rule pack and query;
- the evaluation and engine identity from the projection result; and
- the program purpose that the host bound, and the fixed conflict policy,
  `visible-conflicts.v1`.

Changing any of these values changes the memory digest, `memorySha256`. Query
results and explanations carry `authority: "derived"`. A rule cannot give its
conclusions more authority than its premises have. Each row reports
`premiseLanes`, the lanes of its visible premises, and a `premiseAuthority`
label. The label is `working` when any visible premise comes from the working
store, and `canonical` when every premise comes from the canonical store. It is
`unknown` when a proof was truncated or no premise is visible, so a missing
witness never makes a row canonical.

Every returned result, row, value, proof, source, and receipt is a detached,
deeply immutable copy. A caller therefore cannot change its bytes after the
facade computes its digest or issues an explanation capability for it.

## Parameterized pagination (V2)

`createOhMemoryAgentV2` adds parameterized, paged queries. It does not alter
any V1 request, result, digest preimage, factory, or type. Its `remember` and
`nominate` methods use the V1 semantic-bundle and nomination contracts. Only
its `query` and `explain` envelopes use V2.

The host owns every part of a V2 named program. Besides the fixed purpose, rule
pack, query, and extractor registry, the host declares:

- `parameters`, the exact query-body variables that may receive parameters;
- `evaluation`, every projection evaluation limit;
- `maximumRows`, the maximum number of rows in the complete result;
- `pageSize`, at most 256 rows; and
- `maximumPageBytes`, the canonical byte limit for each returned page.

The host query limit MUST equal the declared maximum row count. A parameter
variable MUST occur in the query body and MUST NOT be a projected output
variable. Agent input supplies a program ID, one exact object that maps those
parameter names to JSON primitive values within fixed size limits, and either
`null` or a continuation. It cannot supply a purpose, rule, query AST,
evaluator option, page size, or source selector. Binding substitutes constants
into the fixed query body only. The rules and the projected output stay exactly
as the host registered them.

The V2 identity records the canonical bindings and their digest, the digests of
the template and bound queries, and the complete program digest. It also
records the same store and projection identities as V1. A parameter value is
therefore part of both the projection identity and the memory identity. A host
extractor can use this to split a value into primitive chunks, while a named
program binds `lane` and `key` and projects only each chunk’s position and
content. Each chunk is subject to the V1 16 KiB atom limit and to the
extractor’s count and source rules.

The evaluator computes one canonical, ordered result, no larger than the host’s
row limit, before it selects a page. If the projection truncates the result
for `query-limit` or `result-bytes`, the query returns no page. The returned
`page` reports `start`, `endExclusive`, `pageSize`, `returnedRows`,
`totalRows`, `hasMore`, `maximumPageBytes`, `completeness` (`complete` or
`partial`), and a `truncation` object that is always empty. Its configured
slice must fit the host’s page byte limit. If it does not, the query fails; the
facade never shortens the slice. Every returned page therefore has
`truncation.truncated: false`. `partial` means that more exact pages follow;
the projection itself is complete. When the proof budget truncates a row’s
proofs, that row reports `proofsTruncated: true` and `premiseAuthority:
"unknown"`, as in V1.

A continuation is an authenticated bearer cursor. Whoever holds it can request
the next page of that exact result from the agent, and it grants no other
access. Its canonical envelope contains an unsigned cursor identity, a public
digest of that identity, `continuationSha256`, and a domain-separated
HMAC-SHA-256. The identity ties the next offset to the exact program, bindings,
complete projection result, page size, total row count, and composite memory
identity. The HMAC key stays with the facade, so only offsets that the facade
issued are usable. Recomputing the public digest does not produce a valid
cursor. The envelope is authenticated but not encrypted. The same token can be
replayed for the same exact page.

By default, each agent or authority generates its own private random
continuation key, so its cursors work only with that object. A host that must
rebuild the facade, or route a cursor to another replica, supplies the same 32
through 64 raw key bytes as `continuationKey`, and the factory copies those
bytes. The host keeps that key out of agent input and persisted results.
Changing the key invalidates every outstanding cursor.

The request parser first detaches the request under the limits in
[Request handling](#request-handling). It then checks the exact envelope keys,
`bindings`, `continuation`, `programId`, and `v`, and the size limits for
bindings, strings, and the whole request. After it resolves the registered
program and the exact bindings, it authenticates any continuation and checks
its program, bindings, page size, range, and alignment. All of these checks run
before the facade reads the working store, invokes extractors, evaluates rules,
or maps proofs. Every valid continued call then rereads the current working
head and rebuilds the projection. If the head, a source, the result, or the row
count has changed, the call fails before proof mapping, so no caller receives
pages from two different snapshots.

The facade throws `OhMemoryContinuationError` when a supplied cursor cannot be
decoded, authenticated, or matched to the current exact identity. The error
extends `OhIntegrityError`, carries `code: "memory-continuation"`, and sets
`reason` to `encoding`, `authentication`, or `identity`. Store verification,
projection evaluation, extractor, and other runtime failures keep their own
error types, and the facade never reports them as continuation failures.

Each result returns the opaque `continuation` token with its
`continuationSha256`, and on the final page both are `null`. The field
`resultSha256` commits that deterministic digest. It excludes the token, which
depends on the key, so a result has the same `resultSha256` under any
continuation key. The
token’s bytes count toward the page byte limit. A V2 explanation capability
keeps only its exact returned page and the mapped proofs. A V2 `explain` call
requires that page’s result digest and a row index within the page, `pageRow`.

## Explanations and nominations

Each query result includes an explanation capability: an opaque, random,
short-lived token bound to that exact deterministic result. The facade measures
its expiry with a monotonic clock and fails with `OhProfileError` if that clock
moves backward. The wall-clock `expiresAt` value is for display only. A
capability can explain several rows until it expires or is evicted. The facade
limits the number of capabilities, the bytes each one retains, and the total
evidence retained. `explain` requires the token, the exact result digest, and a
row index. It fails when the token is unknown, expired, or evicted, and when
the result digest does not match, which also revokes the capability.

The query maps every projection fact witness back to the store record behind
it, and `explain` returns those proofs. Each source names the authority ID,
binding digest, complete head, lane, snapshot digest, and original record key
and digest. For the canonical store, the head is the pinned head. For the
working store, it is the head that the query read.

`nominate` proposes working records for the canonical store. The agent selects
one route that the host registered, by its opaque name. The facade exports the
exact requested roots and their dependency closure from the current working
head, then verifies the export again. The result is a content-addressed
proposal with `status: "prepared"` for the route’s fixed destination purpose.
It does not sync the working operation chain, mutate the canonical store,
import a derived tuple, grant rights, record a review, or turn a proposed
assertion into reviewed knowledge. Application code at the destination must
perform those steps under its own policy and compare-and-swap head.

## Stable host control

`createOhMemoryAuthorityV1` wraps the V2 agent and binds the actor for adoption
writes, `adoptionActorId`. Both host methods accept `unknown` input, require
exact versioned envelopes, and run one call at a time. A model-facing adapter
MUST receive only `authority.agent`; it MUST NOT receive `authority.host`,
either physical store, or the authority factory options.

`advanceCanonical` requires the current complete pinned head and a complete
next head. If the next head equals the pinned head, it returns an immutable
receipt with `status: "unchanged"`. It accepts a later head only when the
canonical change feed shows an unbroken chain of operations from the current
pin to that head, and a snapshot at that head, within the snapshot limits,
reproduces its `recordsSha256`. It then returns a receipt with
`status: "advanced"` that names the authority ID, binding digest, `priorHead`,
and `head`. A stale expected head, an earlier head, a missing operation, a
fork, a changed binding, a malformed page, or a snapshot mismatch fails without
moving the pin. One call proves at most 16,384 operations and at most 64
change-feed pages. The authority checks the total operation count before the
first fetch; hosts MUST advance a longer reachable history in reviewed chunks.

Each query captures the current agent before its first asynchronous read, so a
rollover cannot mix two canonical snapshots into one query. A rollover builds a
fresh agent at the later head. All agents that one authority builds share one
explanation registry, one byte count, and one guard each for the wall clock and
the monotonic clock. An explanation capability issued before a rollover
therefore refers to its original result. The limits of 256 capabilities and
64 MiB, and the expiry order, apply across every rollover. These agents also
share one private continuation key. A continuation issued before a rollover
authenticates, and then fails its exact memory-identity check if either store’s
head has moved.

`adoptNomination` requires an exact expected canonical head and a parsed
`OhMemoryNominationV1`. It checks the nomination’s route, destination purpose,
working authority ID, and binding digest against what the host registered and
bound. It then asks the bound working store to export the dependency closure
again at the nomination’s exact source head, and it requires the export to
match the proposal byte for byte. A dependency-closure capsule that is detached,
substituted, or stale therefore cannot become a write request just because its
own digest is valid.

Adoption compares each nominated record with the current canonical snapshot. A
record whose key is absent there becomes a put. A record with an equal digest is
already present. A record with a different digest is a strict conflict unless
trusted host code supplies a `replacements` claim for that exact logical key
and exact prior canonical record digest. A request may carry at most 128
claims. Every claim has the exact keys `expectedPriorRecordSha256`, `key`, and
`v`; keys must be unique and must name a record in the verified nomination.

A missing, stale, or wrong claim for a record that needs replacement is a
conflict. A claim for a key that is absent from the canonical store is also a
conflict, and it never grants permission to insert that key. The authority
checks every supplied claim, even when its key already has the nominated
digest. An exact replay checks such claims against the reviewed expected head
in the request, so replays stay idempotent and an invented or stale extra claim
is rejected. A claim conflict reported against a record that already matches
therefore carries equal canonical and nominated digests. When no claim is
invalid, adoption can report that record as `already-present`, which keeps
replays idempotent.

Any blocking conflict aborts every insert and replacement. Otherwise adoption
derives a deterministic operation ID from the adoption actor, the canonical
binding, the nomination digest, and the exact prior complete head. Because the
ID includes the prior head, an exact replay produces the same ID, and the same
nomination can be reviewed and adopted again after a later canonical overwrite
or tombstone.

Before writing, the authority applies every changed nominated record to the
pinned snapshot and rejects a result over 8,192 records or 32 MiB. It then
performs one compare-and-swap commit with no merge retry. The host checks
replacement claims before the write, and the operation does not store them.
The V1 operation binds the exact parent head and the complete changed records,
so the stored graph and operation bytes keep their V1 format.

After the commit returns, the authority reads the current physical head and
proves it. When that head is the one the commit produced, the authority installs
it as the pin and returns a receipt with `status: "adopted"`. When a duplicate
operation or a later write has moved the head, the authority checks the later
exact snapshot instead. The same check applies when the expected head is stale
or the physical head was already ahead of the pin. In these cases the authority
returns `already-present`, with `operationSha256: null`, only when that
snapshot contains every nominated key at its exact nominated digest. It
installs the later head as the pin when that head differs from the pin.
Otherwise it reports a conflict. Each adoption makes at most one
compare-and-swap commit, and reconciliation never retries it.

A host may set `maximumCanonicalOperationBytes` when it creates the authority.
The value is an integer from 1 through the V1 operation limit,
`OH_OPERATION_MAX_BYTES_V1`, which is also the default. The store commit, in
SQLite or libSQL, builds and hashes the exact operation. It rejects the
operation before anything is written when its canonical UTF-8 bytes exceed that
limit. An application can use this to make every canonical operation it
commits fit a future encrypted transport, without lowering the separate limit
for working memory. Exact idempotent replays are subject to the same limit.
The rejection is an `OhOperationSizeError`, a `RangeError` subtype exported
from the package root and `@hraness/oh/store`. It reports the exact operation
size, `operationBytes`, and the configured `maximumOperationBytes`. A host can
therefore tell this rejection apart from a failure after the write, whose
outcome is uncertain.

An adoption conflict throws `OhMemoryAdoptionConflictError`. Its `conflict`
reports the expected and actual complete heads, the total conflict count,
whether the reported list was truncated, and at most 128 entries sorted by key.
Each entry carries the nominated digest and the current canonical digest, or
`null` when the key is absent. `conflictsSha256` commits the complete sorted
conflict set, including entries beyond the 128 reported. The structured
conflict is deeply immutable. Neither conflict handling nor a stale idempotent
replay ever overwrites a canonical record. The optional replacement path never
settles a conflict in favor of the last write. Only the exact reviewed head and
the exact prior digest of each key authorize the single compare-and-swap.

## Request handling

Every method on the stable agent and host objects accepts `unknown` input and
detaches it once, at method entry, into a frozen copy. Detachment walks
enumerable data-property descriptors recursively and never invokes an accessor.
Symbols, non-data properties, sparse arrays, non-JSON values, and proxies make
the call fail. Validation, canonical byte limits, digests, and execution all
use that same frozen copy. The facade detaches responses from the bound stores
under the same rule before it parses or compares them. Detachment accepts at
most 128 nested levels, 65,536 entries in one container, and 1,048,576 value
nodes overall. It counts canonical UTF-8 bytes as it goes and rejects an array
over the limit before it enumerates or copies the array’s entries; final
canonical serialization must reproduce the incremental byte count.

## Memory pages and retrieval

A [memory page](memory-page.md) is an application profile for an ordinary
`edition` record. Its title, summary, Markdown body, exact source observations,
and host-supplied provenance (`kind: "host-attested"`) are the record’s
content, each within the page limits. The optional canonical `.oh.md` rendering
is a self-contained file for one record, and it adds no database or operation
format. Agents get a file they can read and diff, and the graph trusts the
record, whose digest the file must reproduce.

Memory pages contain no model, vector, score, index generation, or provider
field. The local embedding backend and the hosted semantic cache each build
their own index from the same current record digests, under different
profiles, and either index can be deleted and rebuilt. A host may expose
semantic recall as an additional convenience, but it MUST preserve exact
`remember`, Datalog `query`, `explain`, and `nominate` semantics when retrieval
is unavailable. Search joins each hit to the current record digest. A hit is
retrieval evidence and does not become an accepted fact.

## Lifecycle and limits

Oh does not choose a tenant, session, retention deadline, physical database,
credential, scheduler, or backup policy. The application host owns those
lifecycle controls and keeps the working store’s separate host object. Purge,
a method only that host object has, removes a working authority. A tombstone
does not erase data, because the operation history keeps the prior bytes. This
API does not protect against code that holds database credentials or has
filesystem access as the same user.

The facade requests at most 8,192 records from each store and rejects a store
snapshot over 32 MiB. It rejects a `remember` request over 8 MiB and limits how
often extractors run and how many facts they emit. It limits a V1 query result
to 32 MiB, and the program’s `maximumPageBytes`, from 64 KiB through 8 MiB,
limits a V2 page. It retains at most 64 MiB of explanation evidence across
every rollover. Adoption applies the same record and byte limits to the
prospective canonical snapshot before its only compare-and-swap. A trusted
store builds the snapshot before returning it, and a trusted synchronous fact
extractor can use time or temporary memory before it returns; these limits
apply only afterward. Provider response limits, host storage quotas, callback
review, isolation, deadlines, and cancellation are the application’s
responsibility.

Suss is an optional evaluator that checks results against Oh’s reference
semantics, available from the separate subpath `@hraness/oh/projection-suss`.
The memory facade uses only Oh’s own reference evaluator,
`evaluateOhProjectionV1`. The facade never loads or runs Cozo.
