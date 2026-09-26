# Graph and operation contract V1

The graph format version is `1`. The graph keeps canonical JSON records under
stable logical keys and logs every change in a content-addressed chain of
operations.

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
non-reflexive, and present in the snapshot that results from the operation.

The V1 record kinds are:

```text
activity assertion context dependency-manifest edition entity evidence
identity-operation inquiry inquiry-event review-decision rights-decision
schema shape statement type-membership view vocabulary
```

The `value` is any canonical JSON value. A registered codec MAY impose a
stricter value contract for a kind. A codec adds validation on top of the
generic envelope parser and does not change the envelope format on the wire.

## Changes

A put change contains `{ "kind": "put", "record": ..., "v": 1 }`. A
tombstone contains the logical key and the exact digest of the prior record:
`{ "key": ..., "kind": "tombstone", "priorSha256": ..., "v": 1 }`. Changes in
an operation MUST be sorted by logical key and unique. A tombstone fails if
its prior digest does not match the current record.

One operation contains one through 8,192 changes. Each record has at most
4,096 dependencies and a value of at most 1,048,576 canonical UTF-8 bytes. A
snapshot holds at most 65,536 records.

## Graph revisions

A graph revision contains the canonical changes, the stable operation ID, the
parent graph revision digest, the sorted complete record references, the
complete record-set digest, a positive revision number, and the revision
digest. Replaying a revision chain MUST reject gaps, forks, duplicate
operation IDs, false record snapshots, missing dependencies, and digest
mismatches.

Each record reference contains `dependencies`, `key`, `kind`, `sha256`, and
`v`. Dependencies are ordered, unique, non-reflexive keys. The complete
reference set therefore carries enough information to reject a tombstone that
would leave an unchanged record with a missing dependency. `recordsSha256`
hashes the ordered complete reference array. `graphRevisionSha256` hashes the
canonical transition fields listed under
[digest preimages](canonical-json.md#digest-preimages). The record references
enter that digest only through `recordsSha256`, so its preimage does not
repeat `recordRefs`.

Creators, parsers, reducers, and stores MUST reject a resulting snapshot above
65,536 records, including growth accumulated across multiple operations.

## Operations

An operation adds the actor ID, contract ID, canonical UTC instant, parent
operation digest (`parentOperationSha256`), space ID, and sequence to the
graph transition. The first operation has sequence one and a null parent
operation digest. Each later operation increments the sequence by one and
carries the digest of the operation before it.

`operationId` makes a writer’s commit idempotent. Reusing it with the same
actor and changes returns the existing operation. Reusing it for different
content is a conflict.

The complete operation is at most 67,108,864 bytes. Its `operationSha256`
hashes the payload without that field.

## Concurrency

A commit supplies the expected generation and operation digest. The store
acquires an immediate transaction, reads the current head, computes the full
transition, appends the operation, materializes records and dependencies, and
moves the head with compare-and-swap. If the expected head is stale, the
commit fails and changes nothing.
