# Schema evolution V1

Oh stores product meaning as content-addressed schema and vocabulary records.
The envelope remains generic while each namespace owns the interpretation of
its concepts, predicates, shapes, mappings, units, and vocabularies.

## Schema identity

A schema revision has a stable `namespace`, `code`, and `kind`. V1 kinds are
`concept`, `mapping`, `predicate`, `shape`, `unit`, and `vocabulary`. A positive
revision and `schemaSha256` identify one immutable body.

The revision also includes:

- `body`, a canonical JSON object owned by the schema;
- nonempty, canonically ordered localized `labels` and `description` entries;
- `compatibility`, either `additive` or `breaking`; and
- `previousSchemaSha256`, which is null only for revision one.

Revision one MUST declare `additive`. Later revisions MUST advance by exactly
one and bind the immediately prior digest.

## Additive claims

An additive revision MUST retain every top-level key from the prior body with
the exact same canonical JSON value. It may add new top-level keys. Changing or
removing a prior value requires `breaking`.

This law is deliberately mechanical. It prevents a schema author from labeling
an incompatible byte change as additive. A domain may impose stricter semantic
compatibility rules in its codec.

## Vocabulary revisions

A vocabulary revision binds one namespace, positive revision, and no more than
65,536 schema references from that same namespace. References MUST be in
strict canonical order and unique. `vocabularySha256` hashes the payload
without the digest field.

## Evolution procedure

1. Parse and verify the prior immutable revision.
2. Create the next revision with the prior digest and the correct compatibility
   classification.
3. Run the mechanical evolution check.
4. Publish the new schema record without rewriting the prior record.
5. Update dependent graph records explicitly when they adopt the new schema.

Schema revision is separate from Oh's envelope version. A breaking product
schema does not automatically require a new graph format, while a changed
graph field always does.
