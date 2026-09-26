# Identity and context vocabulary pack V1

`sponge.identity-context` is an additive private vocabulary pack composed by
`spongeKnowledgeDomainCatalogV4()`. It provides small, reusable records for
identity claims, identifier schemes, temporal records, location records,
evidence bundles and items, value records, and provenance activities.

The pack is open-world by design. It lets several compatible identifiers,
descriptions, and provenance paths coexist. Its relations describe what a
source states. They do not merge entities or establish truth, completeness,
access rights, publication rights, unit conversion, or coordinate conversion.
Hosts choose which packs to install and apply their own review and rights
policies.

The pack depends on `sponge.core`, `sponge.foundation`, and `sponge.reference`.
`catalog-v4` leaves the V1 through V3 pack manifests byte for byte as published
and adds one lock root, `sponge.identity-context`. The pack is private and
unreviewed by default. Installing it and accepting proposals are explicit host
operations.
