# Experimental composite agent memory

`@hraness/oh/experimental/memory` is the first consumer-facing composition of
the stable store and projection contracts. It is experimental API, not a new
ontology or a third storage authority.

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

The returned object exposes only `remember`, `query`, `explain`, and
`nominate`. It has no generic commit, store selection, path, sync, rule
registration, canonical write, or purge operation.

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
at most 64 MiB of explanation evidence. A trusted store still constructs the
snapshot before returning it, and a trusted synchronous fact extractor can
consume time or temporary memory before it returns. Provider response limits,
host storage quotas, callback review, isolation, deadlines, and cancellation
remain application responsibilities.

Suss is an optional differential evaluator behind the separate projection
compatibility subpath. The memory facade uses the package-owned bounded
reference evaluator. Cozo is neither evaluated nor loaded.
