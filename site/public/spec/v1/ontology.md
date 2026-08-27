# Ontology V1

Ontology V1 is identified by `oh.ontology.v1` and version `1.0.0`. Its contract
manifest digest is
`e53ae573c2af417082be9f554d0f6f3e317f054daf745181f462608e3f622594`.

## Kernel concepts

| Concept | Meaning |
| --- | --- |
| Entity | A stable identity anchor for something that can be referred to. |
| Statement | An immutable proposition with a subject, predicate, object, and qualifiers. |
| Assertion | An attributable stance toward a statement. |
| Evidence | A typed account of how an observation bears on an assertion. |
| Context | The scenario and dimensions in which knowledge applies. |
| Inquiry | A question and its durable investigation trail. |
| Projection | A reproducible view derived from exact knowledge. |

The kernel separates a proposition from a person's stance toward it, evidence
from the assertion it bears on, and authored knowledge from a derived view.
Product vocabularies can refine these concepts without changing the graph
envelope.

## Identities

V1 retains four opaque identity grammars:

| Identity | Pattern |
| --- | --- |
| Entity | `kent_[a-z0-9]{24}` |
| Assertion | `kast_[a-z0-9]{24}` |
| Evidence | `kevd_[a-z0-9]{24}` |
| Inquiry | `kinq_[a-z0-9]{24}` |

These identifiers are opaque. A consumer MUST NOT infer time, authorship, or
ordering from their suffixes.

Schema references contain the exact `namespace`, `code`, positive `revision`,
`schemaSha256`, and `v: 1`. Namespaces and codes use lowercase safe-code
segments separated by `.`, `_`, `:`, `/`, or `-`.

## Values

A `KnowledgeValueV1` is one of:

- an entity reference;
- NFC text with a lowercase BCP 47-style language tag;
- a bounded string or boolean;
- a canonical integer or decimal represented as a string;
- a canonical absolute URI without credentials and without the `data`, `file`,
  or `javascript` scheme;
- a list that preserves order;
- a set in strict canonical order with no duplicates; or
- an extension bound to a schema, canonicalizer digest, canonical value, media
  type, and value digest.

Lists and sets contain at most 256 values and nest at most eight levels.
General text is at most 65,536 UTF-8 bytes.

## Contexts, statements, and inquiries

A context contains at most 64 canonically ordered, unique predicate-value
dimensions and one scenario: `actual`, `counterfactual`, `hypothetical`, or
`planned`. `contextSha256` binds the complete context payload.

A statement binds an entity subject, schema predicate, typed object, and at
most 128 canonically ordered, unique qualifiers. Its canonical payload is at
most 262,144 UTF-8 bytes. `statementSha256` binds that payload.

An inquiry binds its opaque ID, author entity, question, answer form, language,
privacy, status, optional context digest, creation instant, and ordered parent
inquiry IDs. The creation instant uses exact UTC millisecond form such as
`2026-08-27T12:00:00.000Z`.

## Errors

Ontology parsers return a field and one stable issue class:
`dependency-missing`, `digest-mismatch`, `invalid-input`, `limit-exceeded`, or
`noncanonical-input`. A result identifies a contract failure, not whether the
underlying research claim is true.
