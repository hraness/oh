# Graph and operation contract V1

The graph format version is `1`. It stores canonical JSON records behind stable
logical keys and records every change in a content-addressed operation chain.

## Record envelope

```json
{
  "dependencies": [],
  "key": "entity:ada-lovelace",
  "kind": "entity",
  "recordSha256": "<64 lowercase hex characters>",
  "v": 1,
  "value": { "name": "Ada Lovelace" }
}
```

A logical key begins with a lowercase letter, contains at most 512 characters,
and uses lowercase alphanumeric segments separated by `.`, `_`, `:`, `/`, or
`-`. Dependencies use the same grammar. They MUST be strictly ordered, unique,
non-reflexive, and present after the operation settles.

V1 record kinds are:

```text
activity assertion context dependency-manifest edition entity evidence
identity-operation inquiry inquiry-event review-decision rights-decision
schema shape statement type-membership view vocabulary
```

The `value` is arbitrary canonical JSON. A registered codec MAY impose a
stricter value contract for a kind. The generic envelope parser remains the
wire boundary.

## Changes

A put change contains `{ "kind": "put", "record": ..., "v": 1 }`. A
tombstone contains the logical key and exact prior record digest. Changes in an
operation MUST be sorted by logical key and unique. A tombstone fails if its
prior digest does not match the current record.

One operation contains 1 through 8,192 changes. Each record has no more than
4,096 dependencies and a value no larger than 1,048,576 canonical UTF-8 bytes.
A bounded snapshot contains no more than 65,536 records under the V1 graph
limit.

## Graph revisions

A graph revision binds the canonical changes, stable operation ID, parent graph
revision digest, sorted complete record references, complete record-set digest,
positive revision, and revision digest. Replaying a revision chain MUST reject
gaps, forks, duplicate operation IDs, false record snapshots, missing
dependencies, and digest mismatches.

Each record reference contains `dependencies`, `key`, `kind`, `sha256`, and
`v`. Dependencies are ordered, unique, non-reflexive keys. The complete
reference set therefore carries enough information to reject a tombstone that
would strand an unchanged record. `recordsSha256` hashes the ordered complete
reference array. `graphRevisionSha256` hashes the canonical transition fields
listed in [`canonical-json.md`](canonical-json.md); `recordRefs` are bound
through `recordsSha256` and are not duplicated in that digest preimage.

Creators, parsers, reducers, and stores MUST reject a resulting snapshot above
65,536 records, including growth accumulated across multiple operations.

## Operations

An operation adds the actor ID, contract ID, canonical UTC instant, operation
chain, space ID, and sequence to the graph transition. Sequence starts at one
with a null parent operation digest. Every later operation increments sequence
by one and binds the prior operation digest.

`operationId` gives a writer idempotency. Reusing it with the same actor and
changes returns the existing operation. Reusing it for different content is a
conflict.

The complete operation is at most 67,108,864 bytes. Its `operationSha256`
hashes the payload without that field.

## Concurrency

A commit supplies the expected generation and operation digest. The store
acquires an immediate transaction, reads the current head, computes the full
transition, appends the operation, materializes records and dependencies, and
moves the head with compare-and-swap. A stale expected head fails without a
partial mutation.
