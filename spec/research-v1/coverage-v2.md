# Wikidata coverage and qualified research profiles

The optional research profile can preserve a source property before an agent has
mapped it to a local vocabulary. Qualified domain profiles then constrain the
meaning of selected local relations. These are separate guarantees: neither a
complete property inventory nor a successful type check establishes that a
research answer is complete or true.

## Preserve unfamiliar properties

With package version 0.6.0, pass a V2 capture request to
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

This synthetic example exercises the request format without asserting any real
Wikidata content. For research, supply actual captures using the
[V1 capture fields](README.md). Each capture must contain the original JSON string, source URL, capture date,
requested and resolved identities, redirect chain, and an explicit source
coverage declaration. The importer performs no network access.

`all-present` visits every property group present in each retained entity,
including a lexeme's forms and senses. An explicit array still selects particular
properties. The existing source, entity, statement and record bounds apply;
whole property groups that do not fit are recorded in the omission ledger.
A hard input limit of 4,096 observed or explicitly selected property groups
across the request also bounds empty groups and coverage metadata; a request
exceeding it receives an input-bound error. Expanded previews must also fit
64 MiB, one million JSON nodes, depth 64 and 250,000 items per array before
they can be emitted. Creation and verification apply the same transport budget.
The cursor identifies source captures to retry with a smaller selection.
A missing property in an all-present import is not a declaration of absence.

Each retained `sourceAssertions` entry carries the original Wikidata subject and
property URIs, statement selector and GUID, rank, source capture digest and full
statement JSON. Qualifier and reference group boundaries remain in that JSON.
An unfamiliar P identifier needs no local predicate to be retained. Source
identities do not merge local entities, and a preferred rank does not make a
statement accepted or credible.

All 18 current datatypes have typed source preservation, including EntitySchema
references. Unknown future datatypes and invalid known values retain opaque
source data and a diagnostic. EntitySchema documents are not accepted as
Wikibase entity JSON. Quantities keep source units and bounds; dates keep signed
years, calendar and precision; coordinates keep their globe and angular
precision. Preservation does not silently convert any of these values.

V1 preview requests, identity grammar, canonical bytes and verification remain
unchanged. V2 previews have a distinct importer identity and digest. Always verify
a transported preview against the original request, including bodies omitted by
the chosen output bounds. A caller-supplied `mappingVersion` is provenance text,
not authority to normalize or admit a claim.

## Inspect reviewed source mappings

`oh research wikidata-mappings` returns three mappings tied to captured P31,
P279 and P361 property revisions and exact local predicate digests.
`oh research wikidata-mapping-preview --file captures.json` accepts the original
V2 request and returns candidates for those source-attribution relations.
Other retained statements, unknown values and explicit absence receive mapping
gaps. The preview identifies its source-preview and mapping-catalog digests.

The corresponding portable functions are `spongeKnowledgeWikidataMappingCatalogV1`,
`createKnowledgeWikidataMappingPreviewV1` and `verifyKnowledgeWikidataMappingPreviewV1`.
Candidates retain the full source statement, foreign subject and object identities,
rank and references. They require local identity resolution, compilation under
installed schemas and proposal review. They perform no inference or normalization.
The gap count covers retained main statements; read the source omission ledger
separately before drawing any coverage conclusion.

## Use qualified domain revisions

`oh research catalog-v2` and `spongeKnowledgeDomainCatalogV2()` return the current
catalog and its exact historical packs. `oh research catalog` and
`spongeKnowledgeDomainCatalog()` retain the original catalogue.

The new catalogue retains the original core and reference packs, adds the
`sponge.foundation` pack, and advances the 14 domain packs to revision 2.
For example, `sponge.music/records` revision 2 requires a performance as its
object; an entity typed only as a biological taxon fails proposal compilation.
Language forms, tested samples, financial instruments and other relations have
corresponding domain and object checks. Deliberately broad relations such as
cultural allusions have an explicit explanation in the range notes.

An entity may have multiple concepts. These profiles do not impose a mutually
exclusive classification of the world. A schema revision is checked against its
exact digest; a label or unqualified code cannot select a different meaning.
Each changed definition links to its predecessor digest. Existing assertions
retain their original schema references.

The foundation includes explicit units for mass, length, duration, temperature,
ratios and counts; calendar and coordinate-system descriptors; Wikidata, DOI and
ORCID identifier schemes; and context, measurement and version relations. Unit
descriptors define scale and offset without performing conversions. A unit label
alone cannot authorize a calendar, globe or currency conversion.

Source-asserted instance membership, subclass and part-whole relations are
separate predicates. They do not infer local concept membership, transitive
instance membership or entity equality. Wikidata property constraints remain
attributed source guidance; their exceptions cannot be replaced by an automatic
universal rule.

## Install and evolve

A catalogue is available data, not an installation receipt. A host must authorize
the selected space and exact lock, verify dependencies, and materialize the
selected declarations and their historical predecessor declarations. Retain old
schemas alongside new ones. An upgrade must not rewrite an existing assertion,
change an old digest or retype an entity silently.

The standalone V1 shape evaluator matches direct accepted memberships; it does
not expand concept ancestry. Consumers using broad-family shape rules must
supply the relevant accepted memberships explicitly.

Proposal compilation uses the exact installed schemas and authorized entities.
The shapes check supplied relations without requiring a complete description of
every entity. Passing these checks prepares a proposal. Identity decisions,
claim acceptance, current rights and publication remain separate host actions.

## Measure coverage

The [pinned inventory](wikidata/2026-09-13/inventory.json) records a completed
property-page traversal during a stated capture window, together with source
hashes and each property's retrieved datatype and revision. It is not a globally
atomic database snapshot. The frozen source corpus keeps selected property
constraints and class neighborhoods for deterministic replay.

The executable checks distinguish property inventory coverage, datatype
preservation, source-group retention, local relation validation and historical
compatibility. A property can be covered by generic preservation without having
a curated semantic mapping. Partial captures and omitted groups stay visible.
These checks are not deep research benchmark scores, nor do they certify an
agent's interpretation, vendor trust, private-contact erasure or a complete
answer to an open research question.

The source model follows Wikidata's [JSON datatype encodings](https://www.wikidata.org/wiki/Wikidata:Data_formats/JSON_datatype_encodings),
[basic membership distinctions](https://www.wikidata.org/wiki/Help:Basic_membership_properties)
and [property constraint guidance](https://www.wikidata.org/wiki/Help:Property_constraints_portal).
