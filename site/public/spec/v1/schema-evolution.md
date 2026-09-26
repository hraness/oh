# Schema evolution V1

Oh stores product meaning as content-addressed schema and vocabulary records.
The envelope is generic. Each namespace defines how its concepts, predicates,
shapes, mappings, units, and vocabularies are interpreted.

## Schema identity

A schema revision has a stable `namespace`, `code`, and `kind`. The V1 kinds
are `concept`, `mapping`, `predicate`, `shape`, `unit`, and `vocabulary`. A
positive revision and `schemaSha256` identify one immutable body.

The revision also includes:

- `body`, a canonical JSON object whose meaning the schema defines;
- nonempty, canonically ordered localized `labels` and `description` entries;
- `compatibility`, either `additive` or `breaking`; and
- `previousSchemaSha256`, which is null only for revision one.

Revision one MUST declare `additive`. Later revisions MUST advance by exactly
one and bind the immediately prior digest.

## Additive claims

An additive revision MUST retain every top-level key from the prior body with
the exact same canonical JSON value. It may add top-level keys. Changing or
removing a prior value requires `breaking`.

The check compares canonical JSON values and nothing else. It prevents a
schema author from labeling an incompatible byte change as additive. A domain
can impose stricter semantic compatibility rules in its codec.

## Vocabulary revisions

A vocabulary revision contains one namespace, a positive revision, and at most
65,536 schema references from that same namespace. References MUST be in
strict canonical order and unique. `vocabularySha256` hashes the payload
without the digest field.

## Evolution procedure

1. Parse and verify the prior immutable revision.
2. Create the next revision with the prior digest and the correct compatibility
   classification.
3. Run the evolution check, `verifyKnowledgeSchemaEvolutionV1`.
4. Publish the next schema record without rewriting the prior record.
5. Update dependent graph records explicitly when they adopt the next schema.

Schema revisions are versioned separately from Oh’s envelope. A breaking
product schema does not require a new graph format. A changed graph field
always does.
