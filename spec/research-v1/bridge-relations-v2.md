# Cross-domain bridge relations v2

`oh research catalog-v9` includes revision 2 of `sponge.bridge-relations`.
The pack makes fourteen common cross-domain joins explicit:

- offers to products and price records
- assays to methods and findings
- placements to articles or editions
- event series to member events
- tracks to recordings
- financial listings to trading venue places or their operating organizations
- state snapshots to simulations
- trajectories to attempts
- tasks to goals
- public profile documents or profile projections to accounts
- role assignments to organizations
- lexemes to language systems

The pack also defines a `price` concept as a local information-resource
descriptor. Bridge ranges are entity-concept ranges and may include more than
one compatible endpoint where the source record does not distinguish between
alternatives. No relation infers identity, ownership, authorization, truth,
chronology, availability, or completeness; those claims need their own
qualifiers and evidence. A venue operator and its physical place keep separate
identities, and an account association does not prove control of the account
or the identity of a person.

Revision 2 has the same concepts, predicates, definitions, and query as
revision 1, which `oh research catalog-v5` introduced. Its schema references
point at revision 2 of this pack, and its manifest pins this guide. The pack
depends on the same 19 packs as revision 1. It is private: a host must install
it and review each proposal before accepting a claim that uses it.
