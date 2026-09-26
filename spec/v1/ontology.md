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

The kernel separates a proposition from an attributable stance toward it,
evidence from the assertion it bears on, and authored knowledge from a derived
view. Product vocabularies can refine these concepts without changing the
graph envelope.

## Identities

V1 defines four opaque identity grammars:

| Identity | Pattern |
| --- | --- |
| Entity | `kent_[a-z0-9]{24}` |
| Assertion | `kast_[a-z0-9]{24}` |
| Evidence | `kevd_[a-z0-9]{24}` |
| Inquiry | `kinq_[a-z0-9]{24}` |

These identifiers are opaque. A consumer MUST NOT infer time, authorship, or
ordering from their suffixes.

Schema references contain the exact `namespace`, `code`, positive `revision`,
`schemaSha256`, and `v: 1`. A namespace or code begins with a lowercase
letter, contains at most 128 characters, and uses lowercase alphanumeric
segments separated by `.`, `_`, `:`, `/`, or `-`.

## Values

A `KnowledgeValueV1` is one of:

- an entity reference;
- NFC text with a lowercase BCP 47-style language tag;
- a string within the general text limit, or a boolean;
- a canonical integer or decimal represented as a string;
- a canonical absolute URI without credentials and without the `data`, `file`,
  or `javascript` scheme;
- a list that preserves order;
- a set in strict canonical order with no duplicates; or
- an extension that carries a schema reference, a canonicalizer digest, a
  canonical value, a media type, and a value digest.

Lists and sets contain at most 256 values and nest at most eight levels.
General text is at most 65,536 UTF-8 bytes.

## Contexts, statements, and inquiries

A context contains at most 64 canonically ordered, unique predicate-value
dimensions and one scenario: `actual`, `counterfactual`, `hypothetical`, or
`planned`. `contextSha256` is the digest of the complete context payload.

A statement contains an entity subject, a schema predicate, a typed object,
and at most 128 canonically ordered, unique qualifiers. Its canonical payload
is at most 262,144 UTF-8 bytes. `statementSha256` is the digest of that
payload.

An inquiry records its opaque ID, author entity, question, answer form,
language, privacy, status, optional context digest, creation instant, and
ordered parent inquiry IDs. `inquirySha256` is the digest of the complete
inquiry payload. The creation instant uses the exact UTC millisecond form,
such as `2026-08-27T12:00:00.000Z`.

## Errors

A failed ontology parse returns an `error` with the `field` that failed and
one stable issue `code`: `dependency-missing`, `digest-mismatch`,
`invalid-input`, `limit-exceeded`, or `noncanonical-input`. An issue reports a
contract failure. It does not judge whether the underlying research claim is
true.
