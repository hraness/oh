# Identity and context vocabulary pack V1

`sponge.identity-context` is an additive private vocabulary pack composed by
`spongeKnowledgeDomainCatalogV4()`. It provides small, reusable records for
identity claims, identifier schemes, temporal records, location records,
evidence bundles/items, typed values and provenance activities.

The pack is deliberately open world. It permits multiple compatible
identifiers, descriptions and provenance paths to coexist. Relations are
source-scoped descriptions and do not merge entities, establish truth,
completeness, access rights, publication rights, unit conversion or coordinate
conversion. Hosts still choose their installed packs and apply their own review
and rights policies.

The pack depends on `sponge.core`, `sponge.foundation` and `sponge.reference`.
`catalog-v4` preserves the exact V1–V3 pack manifests and adds one new lock
root. The pack is private and unreviewed by default; installation and proposal
acceptance remain explicit host operations.
