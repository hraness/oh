# Wikidata coverage and qualified research profiles

The optional research profile can keep a source property before an agent has
mapped it to a local vocabulary. Qualified domain profiles are the revision 2
domain packs, first published in catalog V2. In them, every relation between
entities declares the concepts it accepts as its object. These are separate
guarantees. Neither a complete property inventory nor a successful type check
establishes that a research answer is complete or true.

## Preserve unfamiliar properties

From package version 0.6.1, pass a V2 capture request to
`createKnowledgeWikidataImportPreviewV2` or `oh research wikidata-preview`:

```json
{
  "v": 2,
  "mappingVersion": "my-research-preservation.v1",
  "properties": "all-present",
  "captures": [{
    "requestedId": "Q1",
    "resolvedId": "Q1",
    "sourceUri": "https://www.wikidata.org/wiki/Special:EntityData/Q1.json",
    "capturedAt": "2026-09-13T00:00:00.000Z",
    "redirects": [],
    "coverage": { "kind": "partial", "reason": "Synthetic documentation example" },
    "body": "{\"id\":\"Q1\",\"type\":\"item\",\"lastrevid\":1,\"claims\":{}}"
  }]
}
```

This synthetic example exercises the request format and makes no claim about
Q1's content on Wikidata. For research, supply captured responses using the
[V1 capture fields](README.md#preserve-a-captured-wikidata-revision). Each
capture must contain the original JSON string, source URL, capture date,
requested and resolved identities, redirect chain, and a coverage declaration.
The importer performs no network access.

`all-present` visits every property group present in each kept entity,
including a lexeme's forms and senses. An array selects particular properties.
The V1 limits on source bytes, entities, statements, and records also apply. A
property group that does not fit is omitted whole and recorded in the omission
ledger. A request may hold at most 4,096 property groups, counting both
observed groups and explicitly selected groups. The limit also covers empty
groups and coverage metadata. A request over the limit fails with the error
code `input-bound`. An expanded preview must also fit within 64 MiB, 1,000,000
JSON nodes, a depth of 64, and 250,000 items per array before it can be
emitted. Creation and verification apply the same size budget. When a limit
causes an omission, the `retry-with-selection` cursor lists the captures to
retry with a smaller selection. A missing property in an `all-present` import
is not a declaration of absence.

Each kept `sourceAssertions` entry carries the original Wikidata subject and
property URIs, statement selector and GUID, rank, source capture digest, and
full statement JSON. The separation between qualifier groups and reference
groups stays in that JSON. An unfamiliar P identifier needs no local predicate
to be kept. Source identities do not merge local entities, and a preferred rank
does not make a statement accepted or credible.

All 18 datatypes in `KNOWLEDGE_WIKIDATA_DATATYPES_V2`, including EntitySchema
references, are classified `typed-source-value`. Datatypes added to Wikidata
later, and invalid values of known datatypes, keep opaque source data and a
diagnostic. EntitySchema documents are not accepted as Wikibase entity JSON.
Quantities keep source units and upper and lower bounds. Dates keep signed
years, calendar, and precision. Coordinates keep their globe and angular
precision. Preservation converts none of these values.

V1 preview requests, identity grammar, canonical bytes, and verification are
fixed. V2 previews have a distinct importer identity and digest. Always verify
a transported preview against the original request, including bodies omitted
by the chosen output limits. A caller-supplied `mappingVersion` is provenance
text. It does not permit anyone to normalize or accept a claim.

## Inspect reviewed source mappings

`oh research wikidata-mappings` returns three mappings tied to captured P31,
P279, and P361 property revisions and to the digests of their local predicates.
`oh research wikidata-mapping-preview --file captures.json` accepts the original
V2 request and returns candidates for those source-attribution relations.
Other kept statements, unknown values, and no-value statements receive the
mapping gaps `property-not-mapped` or `source-value-not-an-item`. The preview
names the digests of its source preview and mapping catalog.

The corresponding portable functions are `spongeKnowledgeWikidataMappingCatalogV1`,
`createKnowledgeWikidataMappingPreviewV1`, and `verifyKnowledgeWikidataMappingPreviewV1`.
Candidates keep the full source statement, foreign subject and object
identities, rank, and references. They require local identity resolution,
compilation under installed schemas, and proposal review. The mapping preview
performs no inference or normalization. The gap count covers the
`retained-main-statements` scope. Read the source omission ledger separately
before drawing any coverage conclusion.

## Use qualified domain revisions

`oh research catalog-v2` and `spongeKnowledgeDomainCatalogV2()` return catalog
V2 plus `historicalPacks`, which holds the 16 V1 packs. `oh research catalog`
and `spongeKnowledgeDomainCatalog()` return the V1 catalog.

Catalog V2 keeps the V1 core and reference packs, adds the `sponge.foundation`
pack, and moves the 14 domain packs to revision 2. For example,
`sponge.music/records` revision 2 requires a performance as its object; an
entity typed only as a biological taxon fails proposal compilation. Language
forms, tested samples, financial instruments, and other relations have
corresponding domain and object checks. Some relations, such as cultural
allusions, are broad by design, and their range notes explain why.

An entity may have multiple concepts. These profiles do not impose a mutually
exclusive classification of the world. A schema revision is verified against its
digest, so a label or unqualified code cannot select a different meaning. Each
changed definition links to its predecessor digest. Assertions made under an
earlier revision keep their original schema references.

The foundation includes explicit units for mass, length, duration, temperature,
ratios, and counts; calendar and coordinate-system descriptors; Wikidata, DOI,
and ORCID identifier schemes; and context, measurement, and version relations.
Unit descriptors define scale and offset without performing conversions. A unit
label alone cannot authorize a calendar, globe, or currency conversion.

Source-asserted instance membership, subclass, and part-whole relations are
separate predicates. They do not infer local concept membership, transitive
instance membership, or entity equality. Wikidata property constraints stay
attributed source guidance. An automatic universal rule cannot replace their
exceptions.

## Install and evolve

A catalog is available data; its presence does not mean anything is installed.
A host must authorize the selected space and lock, verify dependencies, and
materialize the selected declarations and the declarations they replaced. Keep
earlier schemas alongside later ones. An upgrade must not rewrite a stored
assertion, change an earlier digest, or retype an entity silently.

The standalone V1 shape evaluator matches direct accepted memberships; it does
not expand concept ancestry. Consumers using broad-family shape rules must
supply the relevant accepted memberships explicitly.

Proposal compilation uses the installed schemas and authorized entities named
in its context. The shapes check the relations supplied without requiring a
complete description of every entity. Passing these checks prepares a
proposal. Identity decisions, claim acceptance, current rights, and publication
are separate host actions.

## Measure coverage

The [pinned inventory](wikidata/2026-09-13/inventory.json) records a completed
traversal of the property pages during a stated capture window, together with
source hashes and each property's retrieved datatype and revision. It is not a
single atomic snapshot of the database. The frozen source corpus keeps selected
property constraints and class neighborhoods for deterministic replay.

The executable checks measure five things separately: property inventory
coverage, datatype preservation, retention of source groups, validation of
local relations, and compatibility with earlier versions. Generic preservation
can cover a property that has no curated semantic mapping. Partial captures and
omitted groups stay visible. These checks are not deep research benchmark
scores. They do not certify an agent's interpretation, vendor trust, erasure of
private contacts, or a complete answer to an open research question.

The source model follows Wikidata's [JSON datatype encodings](https://www.wikidata.org/wiki/Wikidata:Data_formats/JSON_datatype_encodings),
[basic membership distinctions](https://www.wikidata.org/wiki/Help:Basic_membership_properties),
and [property constraint guidance](https://www.wikidata.org/wiki/Help:Property_constraints_portal).
