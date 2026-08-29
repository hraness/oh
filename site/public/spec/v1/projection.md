# Derived projections

Oh projections are reproducible, non-authoritative views over one exact graph
snapshot. The runtime exposes the same typed rule, query, identity, and result
contract through `@hraness/oh/projection` without changing the V1 graph record,
operation, canonical JSON, or SQLite formats.

## Authority boundary

A projection result has `authority: "derived"`. Its tuples and proof trees are
cache output. They MUST NOT be interpreted as graph assertions, review
decisions, accepted knowledge, or operation history. An application that wants
to retain a conclusion MUST create and review new graph records through its
ordinary authority path.

The projection module imports no SQLite runtime. A caller supplies an exact
snapshot assembled from the authority it selected. This keeps the same contract
usable in a Node 24 serverless process, a local agent, or an application-owned
remote-store adapter.

## Exact input identity

`createOhProjectionSnapshotV1` accepts a space ID, current head, and complete
record snapshot. It:

1. parses every record under the unchanged V1 graph contract;
2. sorts record references by logical key;
3. recomputes `recordsSha256` and requires it to equal the head;
4. checks dependency closure; and
5. hashes the contract digest, space, head, and record references into
   `snapshotSha256`.

A fact is one relation tuple plus one or more exact source record keys and
digests. A dataset rejects a source that is not current at its snapshot.
Duplicate relation tuples are coalesced and retain the union of their source
records. The dataset identity binds:

- the snapshot digest;
- a fact-pack ID and revision;
- the SHA-256 digest of the application-owned extractor implementation; and
- the canonical ordered fact set.

Oh supplies structural `oh.record(key, kind, digest)` and
`oh.dependency(key, dependency)` facts. Domain packs may emit richer relations,
but their extractor digest and every source record remain explicit. The
package-owned structural extractor profile is published as
`OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1`.

## Positive rule semantics

A term is a variable or a JSON primitive constant. A literal names one relation
and an ordered term list. A rule has one head and a nonempty conjunction of
positive body literals. Every head variable MUST occur in its body. Relation
arity MUST be consistent across base facts, rule heads, rule bodies, and the
query.

The V1 projection evaluator implements finite, positive Datalog with set
semantics and synchronous naïve fixpoint rounds. It supports recursive rules.
It does not support negation, aggregation, arithmetic, function symbols, or
callbacks inside rules. Unknown objects are parsed with exact keys, so an
unsupported operator fails rather than being ignored.

Rule packs are sorted by rule ID and content-addressed. A query declares an
ordered `find` variable list, a nonempty positive body, and an output limit.
Query results use set semantics and sort tuples by canonical JSON. Declaration,
fact, and insertion order do not affect rule-pack identity or output bytes.

## Evaluation limits

The implementation checks hard ceilings before or during work:

| Item | Maximum |
| --- | ---: |
| Tuple arity | 32 |
| Canonical bytes per atom | 16 KiB |
| Base facts | 262,144 |
| Derived tuples | 262,144 |
| Rules | 1,024 |
| Body literals per rule | 64 |
| Evaluation rounds | 1,024 |
| Join matches per rule or query body | 262,144 |
| Returned query rows | 65,536 |
| Proof depth | 128 |
| Proof nodes per row | 4,096 |

A caller may request smaller derived-tuple, round, proof-depth, and proof-node
bounds. Exceeding a work bound fails closed. A query's declared output limit
returns the first canonical tuples and reports `stats.truncated: true` when more
distinct answers exist.

## Proofs

Each returned row carries one proof for each query-body match. A fact leaf names
its relation, tuple, and exact source record references. A derived node names
the rule ID and digest and recursively contains its premises. Depth, node, and
cycle guards emit an explicit `truncated` node. A proof establishes how the
bounded evaluator derived a tuple from the supplied bytes; it does not establish
that a proposition is true.

## Cache invalidation

`projectionSha256` binds the current contract, snapshot, dataset, rule pack,
query, and positive-Datalog semantics. A cached result is reusable only when
that digest is unchanged. Any snapshot, dataset, rule-pack, or query change has
`kind: "full-rebuild"` and lists the changed identities. V1 does not claim
incremental deletion or cross-snapshot maintenance.

## Optional Suss equivalence lane

`@hraness/oh/experimental/projection-suss` supports exactly
`@suss/datalog@0.20.0` as an optional peer. It encodes every JSON primitive atom
into canonical JSON text, evaluates the positive rules with Suss, and compares
every complete relation to the Oh reference semantics. It returns only after
exact set agreement.

Suss's public evaluator does not expose an execution-budget hook. Before calling
it, the adapter computes a conservative finite-domain upper bound and refuses a
program it cannot prove will remain under the requested derived-tuple ceiling.
It then runs the bounded reference evaluator for equivalence and canonical proof
construction. This lane evaluates compatibility, not performance. Refusal does
not disable the built-in evaluator.
