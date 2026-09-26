# Source relationships

Package 0.7.1 added 12 reviewed, source-attributed relationships in the
optional `sponge.source-relations` revision 1 pack. The open research package
publishes and verifies these definitions. Sponge can install and review them in
its workbench. The portable package requires no Sponge account or hosted agent.

`spongeKnowledgeDomainCatalogV3()` and `oh research catalog-v3` compose this pack
with all earlier packs: 18 packs, 239 schemas, 40 optional shapes, and 10 unit
descriptors. The earlier pack revisions, dependency pins, and schema digests
keep their published bytes. The pack declares broad entity-to-entity
predicates and accepts the context qualifiers from the reference and foundation
packs. It adds no mandatory shape and does not require a complete description
of an entity.

## Reviewed mappings

`spongeKnowledgeWikidataMappingCatalogV2()` and
`oh research wikidata-mappings-v2` return the 15 pinned mappings. P31, P279,
and P361 keep the same `sponge.foundation` targets as mapping catalog V1. The
following properties target `source-asserted-…` predicates in
`sponge.source-relations`:

| Property | Predicate suffix | Meaning that is not inferred |
| --- | --- | --- |
| P527 | has-part | Inverse or transitive composition |
| P50 | author | Ownership, rights or general creation |
| P170 | creator | Authorship, ownership or rights |
| P921 | main-subject | Support for a claim about the topic |
| P144 | based-on | Identity, equivalence or causal proof |
| P629 | version-edition-or-translation-of | A choice among the three alternatives |
| P407 | language-of-work-or-name | A person's spoken language or translation between senses |
| P136 | genre | Local class membership or a topic relation |
| P175 | performer | A performance or recording entity |
| P414 | stock-exchange | Instrument, listing or ticker identities or current tradability |
| P703 | found-in-taxon | An assay, prevalence, efficacy, safety or vendor assessment |
| P277 | programmed-in | A deployed runtime or benchmark configuration |

P175 points from a work or role to its performer. It cannot stand in for the
local `sponge.music/performs` predicate, which points from a performance to a
work or arrangement. Likewise, P629 keeps the source's union of three
alternatives. The mapping does not narrow it to `sponge.foundation/version-of`.

Every mapping pins the property datatype, revision, and SHA-256 of the whole
property response in the [frozen corpus](wikidata/2026-09-13/sources.jsonl.gz).
The source descriptors keep Wikidata's CC0 license and capture locator.
Property constraints are source evidence, not executable local policy. This
selection adds useful relationships. It does not make the class coverage MECE
(mutually exclusive and collectively exhaustive) or translate all of Wikidata's
meaning.

## Preview and review

`createKnowledgeWikidataMappingPreviewV2(input)` and
`oh research wikidata-mapping-preview-v2 --file captures.json` accept the
original V2 capture request.
`verifyKnowledgeWikidataMappingPreviewV2(preview, input)` rebuilds both the
source evidence and the mappings before comparing canonical bytes. The mapping
catalog and preview have wire version 2. The source-preserving importer is
version 2, and the research packet is version 1. The
[machine manifest](source-relations-v1.json) pins their identities.

Only kept main statements with valid item-valued snaks yield relationship
candidates. Each candidate carries the whole source assertion, including its
capture, selector, original rank, raw qualifiers, their order, and separate
reference groups. Qualifier and reference snaks do not become extra main
relationships. Statements that share a GUID across different properties or
captures stay distinct.

Unknown properties and non-item values produce explicit gaps. Some-value and
no-value snaks stay in source evidence, and the preview invents no item
identity for them. A missing property, an omitted group, and a kept no-value
statement are different conditions. Read the coverage and omission ledger from
`createKnowledgeWikidataImportPreviewV2` alongside this mapping preview. The
mapping preview's digest binds that source preview. Counts cover the
`retained-main-statements` scope only.

Candidates always have `normalization: "none"`, `eligibleForAdmission: false`,
and `status: "requires-local-identity-and-proposal-review"`. The
`eligibleForAdmission: false` value means a candidate cannot enter a local
graph directly. Preferred rank, caller-supplied mapping labels, and source
prose grant no authority. Installing the pack, selecting local identities,
compiling a proposal, and accepting it are explicit host operations. Mappings
from source to local predicates do not create local entity memberships, merge
identities, apply unit conversions, or publish private evidence.

## Compatibility and limits

The original catalog, catalog V2, mapping catalog V1, and their CLI commands
stay available with identical bytes. Callers opt in to the V3 catalog and the
V2 mapping functions or command names. Replay never upgrades an earlier preview
implicitly. The source importer, the byte, node, and depth limits on previews,
the file limits, and the host response limits are the same as before. The
added declarations need no migration and no second acquisition of sources.
