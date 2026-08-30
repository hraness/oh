# Oh specification

This directory is the versioned public contract for Oh. It defines the
canonical bytes, ontology identities, graph envelopes, schema revisions,
SQLite and direct libSQL authority, operation sync, store profiles, and local
embedding profile that independent implementations need to interoperate.

[`manifest.json`](manifest.json) is the discovery document. V1 is current and
binds these versions:

| Component | Version |
| --- | --- |
| Ontology | `1.0.0` |
| Contract ID | `oh.ontology.v1` |
| Graph format | `1` |
| Schema format | `1` |
| SQLite schema | `2` |
| Sync protocol | `oh.sync.v1` |
| Embedding profile | `1` |
| Projection semantics | `oh.projection.positive-datalog.v1` |
| Composite memory | `experimental v1` |

## V1 documents

- [Canonical JSON and digests](v1/canonical-json.md)
- [Ontology](v1/ontology.md)
- [Schema evolution](v1/schema-evolution.md)
- [Graph and operations](v1/graph.md)
- [SQLite storage](v1/storage.md)
- [Store ports, profiles, and direct libSQL authority](v1/store.md)
- [Sync protocol](v1/sync.md)
- [Local embedding profile](v1/embedding.md)
- [Derived projections](v1/projection.md)
- [Experimental composite agent memory](v1/memory.md)
- [Compatibility and migration](v1/migration.md)

Machine-readable V1 artifacts:

- [`contract.json`](v1/contract.json)
- [`ontology.json`](v1/ontology.json)
- [`embedding-profile.json`](v1/embedding-profile.json)
- [`contract.schema.json`](v1/contract.schema.json)
- [`record.schema.json`](v1/record.schema.json)
- [`schema-revision.schema.json`](v1/schema-revision.schema.json)
- [`operation.schema.json`](v1/operation.schema.json)
- [`sync-bundle.schema.json`](v1/sync-bundle.schema.json)
- [`projection-rule-pack.schema.json`](v1/projection-rule-pack.schema.json)
- [`projection-query.schema.json`](v1/projection-query.schema.json)
- [`projection-identity.schema.json`](v1/projection-identity.schema.json)
- [`projection-result.schema.json`](v1/projection-result.schema.json)

## Conformance

The words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY state interoperability
requirements. JSON Schemas validate exchange structure. The narrative
documents and runtime parsers also define canonical order, digest preimages,
byte limits, dependency laws, and replay behavior that JSON Schema cannot
express.

An implementation conforms to V1 only when it reproduces exact canonical JSON
and digests, rejects malformed or noncanonical input, preserves ordered
operation history, and passes the same replay laws. Accepting more input is not
conformance when the extra input changes persisted or exchanged bytes.

## Versioning

An existing version is immutable. A change to serialized keys, accepted value
grammar, ordering, a digest preimage, a record kind, a limit, migration SQL, or
protocol meaning needs a new version. New convenience APIs may retain the
current contract when they produce the same checked bytes.

Schema records inside an Oh graph have their own namespace, code, revision, and
content digest. Their evolution rules are separate from the version of the Oh
envelope itself.
