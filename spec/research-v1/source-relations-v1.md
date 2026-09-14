# Source relationships

Package 0.7.0 adds twelve reviewed, source-attributed relationships in the
optional `sponge.source-relations` revision-1 pack. The open research package
owns these definitions and their verification; Sponge can install and review
them in its workbench. No Sponge account or hosted agent is required to use
the portable package.

`spongeKnowledgeDomainCatalogV3()` and `oh research catalog-v3` compose this pack
with all existing packs: 18 packs, 239 schemas, 40 optional shapes and 10 unit
descriptors. Existing pack revisions, dependency pins and schema digests are
unchanged. The new pack declares broad entity-to-entity predicates and accepts
the existing reference and foundation context qualifiers. It adds no mandatory
shape and does not require a complete description of an entity.

## Reviewed mappings

`spongeKnowledgeWikidataMappingCatalogV2()` and
`oh research wikidata-mappings-v2` return the fifteen pinned mappings. P31,
P279 and P361 keep their exact foundation target references. The following
properties target new `source-asserted-…` predicates in `sponge.source-relations`:

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

P175 points from a work or role to its performer. It cannot be substituted for
the local `sponge.music/performs` predicate, which points from a performance
to a work or arrangement. Likewise, P629 retains its source union instead of
silently narrowing it to `sponge.foundation/version-of`.

Every mapping pins the property datatype, revision and SHA-256 of a complete
property response in the [frozen corpus](wikidata/2026-09-13/sources.jsonl.gz).
The source descriptors preserve Wikidata's CC0 license and capture locator.
Property constraints are source evidence, not executable local policy. This
selection expands useful relationships; it does not establish MECE class
coverage or a complete semantic translation of Wikidata.

## Preview and review

`createKnowledgeWikidataMappingPreviewV2(input)` and
`oh research wikidata-mapping-preview-v2 --file captures.json` accept the
original V2 capture request. `verifyKnowledgeWikidataMappingPreviewV2(preview,
input)` rebuilds both source evidence and exact mappings before comparing
canonical bytes. The mapping catalog and preview have wire version 2; the
source-preserving importer remains version 2 and the research packet remains
version 1. The [machine manifest](source-relations-v1.json) pins their identities.

Only retained main statements with valid item-valued snaks yield relationship
candidates. Each carries the complete source assertion, including its capture,
selector, original rank, raw qualifiers, their order and separate reference
groups. Qualifier and reference snaks do not become extra main relationships.
Duplicate statement GUIDs in different properties or captures remain distinct.

Unknown properties and non-item values produce explicit gaps. Some-value and
no-value snaks stay in source evidence without fabricating item identities.
Missing properties, omitted groups and retained no-value statements are
different conditions. Consult `createKnowledgeWikidataImportPreviewV2` for the
coverage and omission ledger alongside this mapping preview; its digest binds
that exact source preview. Counts cover retained main statements only.

Candidates always have `normalization: "none"`, `eligibleForAdmission: false`
and `status: "requires-local-identity-and-proposal-review"`. Preferred rank,
caller-supplied mapping labels and source prose grant no authority. Installing
the pack, selecting local identities, compiling a proposal and accepting it
remain explicit host operations. Source-to-local mappings do not manufacture
local entity memberships, merge identities, apply unit conversions or publish
private evidence.

## Compatibility and limits

The original catalog, catalog V2, mapping V1 and their CLI variants remain
available with identical bytes. New callers opt into the new functions or
command names; replay never upgrades an old preview implicitly. Existing
source importer, preview byte/node/depth limits, file bounds and host response
limits remain unchanged. No migration or source reacquisition is needed for
the added declarations.
