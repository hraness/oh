# Composite agent memory

`@hraness/oh/memory` is the stable consumer-facing composition of the store and
projection contracts. It is an application authority boundary, not a new
ontology or a third storage authority. The former
`@hraness/oh/experimental/memory` path remains an export-compatible alias.

## One kernel, two authorities

A host MUST bind two distinct physical authorities before it creates the
facade:

- a working-profile store, writable only through codec-enforced semantic
  bundles; and
- a canonical-profile store pinned at one exact host-selected head and never
  writable through the returned agent object.

The host supplies opaque authority IDs plus the exact expected binding digests.
The factory rejects equal authority IDs, a binding mismatch, or the wrong
profile. Authority IDs identify custody in results without revealing a database
path, URL, credential, or purge handle. An Oh space, a semantic context, a
runtime tenant/session, and a physical authority remain different boundaries.
The host also binds the working actor, every named program's purpose, and every
named nomination route. None of those authority-bearing labels comes from
agent input.

`createOhMemoryAuthorityV1` returns separate `agent` and `host` objects. The
agent exposes only `remember`, `query`, `explain`, and `nominate`. It has no
generic commit, store selection, path, sync, rule registration, canonical
write, adoption, rollover, or purge operation. The host object exposes only
serialized canonical-head rollover and reviewed nomination adoption. The
lower-level V1 and V2 agent factories remain available for hosts that already
own an equivalent control plane.

`remember` accepts only an expected working head, semantic puts and tombstones,
and an idempotency request ID. The facade supplies its host-bound actor, uses
its non-regressing host clock, derives the operation ID, and returns an
immutable, locator-free receipt with the working authority ID, binding digest,
resulting complete head, operation digest, actor, and actual instant. It never
returns raw operation changes or accepts a caller-asserted actor or timestamp.

## Composite projection

Every query reads the current working head and the factory-pinned canonical
head. It builds a disposable composite dataset with lane-tagged
`memory.record` and `memory.dependency` facts. Equal logical keys with different
record digests produce an explicit `memory.conflict` fact and result entry;
working data never shadows canonical data by recency. Equal digests produce
`memory.agreement`.

Trusted host code may register digest-identified domain fact extractors. Each
extractor declares a disjoint set of relations it owns. The facade supplies a
deeply immutable record and its exact physical source, bounds invocation and
output counts, and forbids custom ownership of reserved `memory.*` or `oh.*`
relations. Every fact proof identifies the built-in fact pack or exact domain
extractor ID and digest that emitted it. Trusted host code also registers a
bounded set of parsed rule-pack/query pairs and their fixed purposes under
names. Agent input selects a name; it cannot submit a purpose, rule, query AST,
or inert validity label.

The composite identity binds:

- both opaque authority IDs, binding digests, complete heads, projection
  snapshots, and lane dataset digests;
- the composite fact dataset;
- the named program, exact rule pack and query;
- evaluation and engine identity inherited from the projection result;
- the host-bound program purpose and fixed visible-conflict policy.

Changing any of these values produces a different memory digest and a full
rebuild. Results and proofs remain `derived`. A rule cannot upgrade the
authority of its premises. Each public row is labeled from its visible physical
premise lanes; a truncated or missing witness is `unknown` rather than
silently canonical. Returned result, row, value, proof, source, and receipt
graphs are detached and deeply immutable, so a caller cannot mutate bytes after
their digest or explanation capability is issued.

## Parameterized pagination (V2)

`createOhMemoryAgentV2` is an additive query surface. It does not
change a V1 request, result, digest preimage, factory, or type. Its `remember`
and `nominate` methods continue to use the V1 semantic-bundle and nomination
contracts. Only its `query` and `explain` envelopes use V2.

A V2 named program is still entirely host-owned. In addition to the fixed
purpose, rule pack, query, and extractor registry, the host declares:

- the exact query-body variables that may receive parameters;
- every projection evaluation limit;
- the maximum complete result row count;
- a page size of at most 256 rows; and
- a canonical byte ceiling for each outward page.

The host query limit MUST equal the declared maximum row count. A parameter
variable MUST occur in the query body and MUST NOT be a projected output
variable. Agent input supplies one exact object of bounded JSON primitive
values for those names plus a program ID and either `null` or a continuation.
It cannot supply a purpose, rule, query AST, evaluator option, page size, or
source selector. Binding substitutes constants only into the fixed query body;
the rules and projected output remain the registered program.

The V2 identity includes the canonical bindings and their digest, the template
and bound query digests, the complete program digest, and the same physical
source and projection identities as V1. Thus a parameter value is part of both
the projection identity and the memory identity, not an unrecorded filter.
This supports a host extractor that emits bounded primitive value chunks while
a named program binds `lane` and `key` and projects only chunk position and
chunk content. Each chunk remains subject to the V1 16 KiB atom limit and the
extractor's existing count and source rules.

The evaluator computes one canonical, ordered result no larger than the
host-declared row limit before it selects a page. A projection `query-limit` or
`result-bytes` truncation returns no page. The outward page reports its start,
end, configured and returned row counts, total rows, `hasMore`, `complete` or
`partial` status, and explicit empty truncation evidence. Its configured slice
must fit the host-declared page byte ceiling; the facade fails closed instead
of silently shortening the slice. Every returned page therefore has
`truncation.truncated: false`; `partial` means more exact pages exist, not that
the projection is incomplete. Proof-budget truncation remains visible on
the affected row as `proofsTruncated` and yields `unknown` premise authority,
as in V1.

A continuation is an authenticated bearer cursor, not knowledge authority. Its
canonical envelope contains an unsigned cursor identity, a public
`continuationSha256` digest of that identity, and a domain-separated
HMAC-SHA-256. The identity binds the next offset to the exact program, bindings,
complete projection result, page size, total row count, and composite memory
identity. The HMAC makes only host-issued offsets usable; recomputing the public
digest does not issue a cursor. The envelope is authenticated, not encrypted,
and the same token can be replayed for the same exact page.

By default the facade generates a private random continuation key, so its
cursors are scoped to that facade instance. A host that must reconstruct the
facade or route a cursor to another replica supplies the same 32 through 64 raw
key bytes through `continuationKey`; the factory clones those bytes. The host
keeps that key out of agent input and persisted results. Changing the key
invalidates outstanding cursors.

The request parser first establishes an exact shallow envelope, a bounded
primitive binding map, and bounded strings before canonical serialization.
After resolving the registered program and exact bindings, it authenticates a
continuation and checks its program, binding, page-size, range, and alignment
before reading the working store, invoking extractors, evaluating rules, or
mapping proofs. Every valid continued call then rereads the current working
head and rebuilds the projection. A head, source, result, or row-count change
fails before proof mapping rather than mixing pages from two snapshots.

`OhMemoryContinuationError` is the exact public discriminator for a supplied
cursor that cannot be decoded, authenticated, or rebound to the current exact
identity. It extends `OhIntegrityError`, carries
`code: "memory-continuation"`, and classifies `reason` as `encoding`,
`authentication`, or `identity`. Store verification, projection evaluation,
extractor, and other runtime failures retain their original error types; the
facade does not relabel them as continuation failures.

An outward result publishes `continuationSha256` beside the opaque token, or
`null` beside `null` on the final page. `resultSha256` commits that deterministic
digest instead of the key-dependent token, so the same exact result identity is
stable across signing keys. The actual token still counts toward the outward
page-byte ceiling. A V2 explanation capability retains only its exact outward
page and mapped physical proofs, and requires that page's result digest and
page-local row index.

## Explanations and nominations

Query returns an opaque, random, short-lived explanation capability bound to
that exact deterministic result. Its expiry uses a non-regressing monotonic
clock; the wall-clock instant is display metadata. A capability may explain
multiple rows until expiry or eviction. Count, per-entry bytes, and aggregate
retained evidence are bounded. `explain` also requires the exact result digest
and row index. It maps every projection fact witness back to an authority ID,
binding digest, complete pinned head, lane, original record key and digest. A
wrong, expired, evicted, or result-mismatched capability fails closed.

`nominate` selects one host-registered route by opaque name, then exports and
re-verifies an exact dependency closure and exact requested root set from the
current working head. Its
output is only a content-addressed `prepared` proposal for that route's fixed
destination purpose. It does not sync the working operation chain, mutate the
canonical store, import a derived tuple, grant rights, record a review, or turn
a proposed assertion into reviewed knowledge. Destination-owned application
code must perform those steps under its own policy and compare-and-swap head.

## Stable host control

`createOhMemoryAuthorityV1` wraps the V2 agent and binds a separate adoption
actor. Both host methods accept `unknown`, require exact versioned envelopes,
and execute serially. A model-facing adapter MUST receive only `authority.agent`;
it MUST NOT receive `authority.host`, either physical store, or the authority
factory options.

`advanceCanonical` requires the current complete pinned head and a complete
next head. An equal next head returns an immutable `unchanged` receipt. A later
head is accepted only after the canonical change feed proves an uninterrupted
path from the current pin and an exact bounded snapshot reproduces the complete
next head. The returned `advanced` receipt binds the authority ID, binding
digest, prior head, and new head. A stale expected head, earlier head, missing
operation, fork, changed binding, malformed page, or snapshot mismatch fails
without changing the pin. One call proves at most 16,384 operations and at most
64 change-feed pages. The total operation bound is checked before the first
fetch; hosts MUST advance a longer reachable history in reviewed chunks.

Each query captures the current agent instance before its first asynchronous
read. A rollover therefore cannot mix canonical snapshots into an in-flight
query. All reconstructed agent generations share one explanation registry,
byte accounting, wall-clock guard, and monotonic-clock guard. An existing
explanation capability therefore continues to refer to its original result,
while the 256-entry and 64 MiB eviction limits and expiry order remain global
across rollover. Every reconstructed instance also uses the same private
continuation key. A continuation issued before rollover still authenticates,
then fails its exact memory-identity check if either source head changed.

`adoptNomination` requires an exact expected canonical head and a parsed
`OhMemoryNominationV1`. It verifies the host-registered nomination route,
destination purpose, working authority ID, and binding digest. It then asks the
actual bound working store to re-export the dependency closure at the
nomination's exact source head and requires byte equality with the proposal.
This prevents a detached, substituted, or stale capsule from becoming a write
request merely because its own digest is valid.

At the current canonical snapshot, an absent nominated record becomes a put and
an equal record digest is already present. A different digest remains a strict
conflict unless trusted host code supplies a `replacements` claim for that exact
logical key and exact prior canonical record digest. A request may carry at most
128 claims. Every claim has the exact keys `expectedPriorRecordSha256`, `key`,
and `v`; keys must be unique and must name a record in the verified nomination.
A missing, stale, or wrong claim for a record that still needs replacement is a
conflict. A claim for an absent canonical key is also a conflict rather than
permission to insert it. Every supplied claim is validated even when that key
is already at its nominated digest. An exact replay checks such claims against
the request's exact reviewed expected head, preserving idempotence without
silently accepting an invented or stale extra claim. A claim conflict reported
against an already-equal current record therefore carries equal canonical and
nominated digests. With no invalid claim, the record remains eligible for the
existing idempotent `already-present` reconciliation.

Any blocking conflict aborts every insert and replacement. Otherwise adoption
uses a deterministic operation ID derived from the host-bound adoption actor,
canonical binding, nomination digest, and exact prior complete head. The head
component preserves exact replay while allowing the same nomination to be
reviewed and adopted again after a later canonical overwrite or tombstone.
Before writing, it applies every
changed nominated record to the pinned snapshot and rejects a result over 8,192
records or 32 MiB. It then performs one compare-and-swap commit with no merge
retry. Replacement claims are host-side admission evidence, not new operation
fields: the existing operation binds the exact parent head and complete changed
records, so the persisted V1 graph and operation bytes need no new shape. After
the commit returns, the authority reads and proves the current physical head.
It installs the returned head only when that is still the physical head; a
reachable duplicate operation or later write is reconciled against the later
exact snapshot. A stale expected head or already-ahead physical head may return
`already-present` only when that current snapshot contains every nominated key
at its exact nominated digest. This remains one compare-and-swap commit;
reconciliation never retries it.

An adoption conflict reports the expected and actual complete heads, total
conflict count, whether the outward list was truncated, and at most 128 entries
sorted by key. Each entry carries the nominated digest and the current
canonical digest or `null` when the key is absent. `conflictsSha256` commits the
complete sorted conflict set, including entries beyond the outward bound. The
structured conflict is deeply immutable. Conflict handling and stale
idempotency never overwrite a canonical record. The optional replacement path
does not perform last-write-wins reconciliation: only the exact reviewed head
and exact per-key prior digests authorize the single compare-and-swap.

Every `unknown` request on the stable agent and host surfaces is recursively
detached through enumerable data-property descriptors once at method entry.
Accessors are never invoked; symbols, non-data properties, sparse arrays,
non-JSON values, and proxies fail closed. Validation, canonical byte bounds,
digests, and execution all consume that same frozen detached graph. Bound store
responses are detached under the same rule before they are parsed or compared.
Traversal admits at most 128 nested levels, 65,536 entries in one container,
and 1,048,576 value nodes overall. It counts canonical UTF-8 bytes as it
traverses and rejects an over-bound array before enumerating or cloning its
entries; final canonical serialization must reproduce the incremental byte
count.

## Memory pages and retrieval

A memory page is an application profile for an ordinary `edition` record. Its
bounded title, summary, Markdown body, exact source observations, and
host-attested provenance are authoritative record content. The optional
canonical `.oh.md` rendering is a self-contained one-record interchange file;
it does not introduce another database or operation format. This gives agents
a readable, diffable artifact without making Markdown syntax the hidden source
of graph authority.

Memory pages deliberately contain no model, vector, score, index generation,
or provider field. The local embedding backend and the hosted semantic cache
derive disposable indexes from the same current record digests under different
profiles. A host may expose semantic recall as an additional convenience, but
it MUST preserve exact `remember`, Datalog `query`, `explain`, and `nominate`
semantics when retrieval is unavailable. Search hits are rejoined to current
authority digests and remain retrieval evidence, not accepted facts.

## Lifecycle and custody boundary

Oh deliberately does not choose a tenant, session, retention deadline,
physical database, credential, scheduler, or backup policy. The application
host owns those lifecycle controls and retains the separate working store host
object. Purge removes a working authority through that host-only
capability; tombstoning is not erasure because operation history retains prior
bytes. Database credentials or same-UID filesystem access remain outside this
API boundary.

The facade requests at most 8,192 records per lane, rejects a lane snapshot
over 32 MiB, rejects a remember request over 8 MiB, bounds extractor
invocations and emitted facts, limits the public result to 32 MiB, and retains
at most 64 MiB of explanation evidence across every canonical generation. The
same record and byte ceilings are applied to a prospective adoption snapshot
before its only compare-and-swap. A trusted store still constructs the snapshot
before returning it, and a trusted synchronous fact extractor can consume time
or temporary memory before it returns. Provider response limits, host storage
quotas, callback review, isolation, deadlines, and cancellation remain
application responsibilities.

Suss is an optional differential evaluator behind the separate projection
compatibility subpath. The memory facade uses the package-owned bounded
reference evaluator. Cozo is neither evaluated nor loaded.
