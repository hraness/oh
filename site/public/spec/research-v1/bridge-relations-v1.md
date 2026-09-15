# Cross-domain bridge relations v1

`oh research catalog-v5` composes the additive `sponge.bridge-relations` pack on
 top of catalog-v3. The pack makes fourteen common cross-domain joins explicit:

- offers to products and price records
- assays to methods and findings
- placements to articles or editions
- event series to member events
- tracks to recordings
- financial listings to venues or places
- state snapshots to simulations
- trajectories to attempts
- tasks to goals
- profile projections to accounts
- role assignments to organizations
- lexemes to language systems

The pack also defines a `price` concept as a local information-resource
 descriptor. Bridge ranges remain entity-concept ranges and may include more
than one compatible endpoint where the source record does not distinguish
between alternatives. No relation infers identity, ownership, authorization,
truth, chronology, availability, or completeness. Qualifiers and evidence are
still required for those claims.

Catalog-v3, all prior packs, and their manifest digests are unchanged. The
pack is private and requires host installation plus proposal review before
admission.
