# Derived projections

Oh projections are reproducible, non-authoritative views over one exact graph
snapshot. The runtime exposes the same typed rule, query, identity, and result
contract through `@hraness/oh/projection` without changing the V1 graph record,
operation, canonical JSON, or SQLite formats.

## Derived status

A projection result has `authority: "derived"`. Its tuples and proof trees are
cache output. They MUST NOT be interpreted as graph assertions, review
decisions, accepted knowledge, or operation history. An application that wants
to retain a conclusion MUST create and review new graph records through its
ordinary write path.

The projection module imports no SQLite runtime. A caller supplies an exact
snapshot assembled from the store it selected, so the same contract works in a Node 24 serverless process, a local agent, or an application-owned
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
Duplicate relation tuples are merged and keep the union of their source
records. The dataset identity covers:

- the snapshot digest;
- a fact-pack ID and revision;
- the SHA-256 digest of the application-owned extractor implementation; and
- the canonical ordered fact set.

Oh supplies structural `oh.record(key, kind, digest)` and
`oh.dependency(key, dependency)` facts. Domain packs may emit richer relations.
Their extractor digest and every source record stay explicit. The
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
The projection identity also covers the selected engine and resolved evaluation
limits, so results created with different engines, proof budgets, or work
budgets cannot share a cache identity.

## Evaluation limits

The implementation checks these hard limits before or during work:

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
| Tuple-unification work units per evaluation | 16,777,216 |
| Returned query rows | 65,536 |
| Proof depth | 128 |
| Proof nodes per row | 4,096 |
| Proof nodes across returned rows | 65,536 |
| Canonical result bytes | 16 MiB |

A caller may request smaller derived-tuple, round, proof-depth, proof-node, and
global tuple-unification work limits. The global work counter spans every rule,
round, and the final query, including unsuccessful candidate matches. Exceeding
a work limit fails the evaluation and returns no result. Result construction
also stops before the aggregate proof-node or canonical-byte limits. A query’s
declared output limit or the result-byte limit returns a canonical prefix, sets
`stats.truncated: true`, and lists `query-limit` or `result-bytes` in
`stats.truncationReasons`.

## Proofs

Each returned row carries one proof for each literal in one canonical supporting
query-body match. `supportCount` reports how many complete matches produced the
same projected value tuple. V1 does not serialize every alternate witness. A fact leaf names its relation, tuple, and exact source record
references. A derived node names the rule ID and digest and recursively contains
its premises. Depth and cycle guards emit an explicit `truncated` node. If a
node or byte budget ends between sibling premises, the enclosing derived node
sets `premisesTruncated: true`. If it ends between query-body proofs, the row
sets `proofsTruncated: true`.
`stats.proofsTruncated` reports either form across all returned rows. A proof
shows how the evaluator, within its limits, derived a tuple from the supplied
bytes. It does not show that a proposition is true.

## Parsing cached results

Projection declarations and cache output are untrusted exchange data. The
`parseOhProjectionRulePackV1`, `parseOhProjectionQueryV1`, and
`parseOhProjectionIdentityV1` parsers reject unknown keys and invalid digest
preimages. `parseOhProjectionProofV1` additionally applies the public proof
depth, node, tuple, source, atom-byte, and aggregate-byte limits before
returning a proof tree.

`parseOhProjectionResultV1` is the parser for cached results. It verifies the
result digest; canonical row and source order; `supportCount`; proof-node,
work-unit, relation, match, round, and byte totals; every proof and result
truncation marker; and all declared evaluation limits. It also recomputes the
engine and evaluation digests and requires them to match the projection
identity. A valid SHA-256 string by itself is not enough to make an envelope
acceptable. Cache readers SHOULD pass the projection digest they requested as
the parser’s second argument. An internally consistent envelope does not prove
that a cache returned the requested identity.

The discovery manifest publishes machine-readable schemas for rule packs,
queries, identities, and result envelopes. JSON Schema describes the exchange
shape and static maxima. The runtime parsers are normative for canonical
ordering, digest preimages, aggregate budgets, and cross-field consistency that
the schemas cannot express.

## Cache invalidation

`projectionSha256` covers the current contract, snapshot, dataset, rule pack,
query, engine, resolved evaluation limits, and positive-Datalog semantics. A cached
result is reusable only when that digest is unchanged. Any snapshot, dataset,
rule-pack, query, engine, or evaluation-limit change has `kind: "full-rebuild"` and
lists the changed identities. V1 does not claim incremental deletion or
cross-snapshot maintenance.

## Optional Suss equivalence check

`@hraness/oh/projection-suss` supports exactly
`@suss/datalog@0.20.0` as an optional peer. It encodes every JSON primitive atom
into canonical JSON text, evaluates the positive rules with Suss, and compares
every complete relation to the Oh reference semantics. It returns only after
exact set agreement.

Suss’s public evaluator does not expose an execution-budget hook. Before calling
it, the adapter runs the reference evaluator with its limits, then computes a
conservative finite-domain upper bound on new tuples in rule-head relations and
refuses a program it cannot prove will stay under the requested derived-tuple
limit. It compares Suss’s complete result to the reference materialization and
uses the reference witnesses for canonical proof construction. This adapter
measures compatibility. It does not measure performance. Refusal does not disable the built-in
evaluator.
