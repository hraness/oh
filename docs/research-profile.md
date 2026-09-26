# The research profile

The research profile gives research tools a shared set of record types for
sources, claims, measurements, prices, credits, and citations, so two
independent hosts can read each other’s records. It turns source captures,
including Wikidata, into proposals that keep every source identity and digest.
It ships as two optional entry points, `@hraness/oh/research` and
`@hraness/oh/research-store`, and a set of `oh research` commands. Requires
0.5.0 or newer.

## Start with the catalog

```sh
oh research catalog
```

This prints every definition in the first catalog: 16 packs of vocabularies
and 182 schemas, including 14 domain vocabularies (agent work, body, culture,
editorial, finance, formal systems, language, music, natural world,
organizations, people, research, software, and substances). It opens no
database, reads no credentials, and makes no network call.

The profile adds values with declared types, compiles proposals that keep
their sources, verifies Wikidata captures offline, and stores research packets
after validating them. It
does not cover all of Wikidata, and a preserved Wikidata property is not
always mapped to a local relation. Your host supplies authorization, the
vocabularies it installs, and its review and publication policy.

## Catalogs by version

Each catalog adds packs and keeps every earlier catalog’s declarations and
lock digests byte for byte, so a record written against catalog V3 reads the
same under catalog V8. Every catalog command prints canonical JSON and takes
no arguments.

| Command | Requires | Packs | Schemas | Adds |
| --- | --- | --- | --- | --- |
| `oh research catalog` | 0.5.0 | 16 | 182 | Core, reference, and 14 domain packs. |
| `oh research catalog-v2` | 0.6.1 | 17 | 227 | Qualified domain revisions, explicit units and identity schemes (`sponge.foundation`). |
| `oh research catalog-v3` | 0.7.1 | 18 | 239 | Twelve source attributions (`sponge.source-relations`). |
| `oh research catalog-v4` | 0.8.1 | 19 | 278 | Identity and context records (`sponge.identity-context`). |
| `oh research catalog-v5` | 0.8.1 | 20 | 293 | Fourteen cross-domain joins (`sponge.bridge-relations`). |
| `oh research catalog-v6` | 0.9.0 | 23 | 336 | Measurement results, monetary values, and content occurrences. |
| `oh research catalog-v7` | 0.10.0 | 24 | 341 | Dated participation roles and credits. |
| `oh research catalog-v8` | 0.10.3 | 30 | 429 | Six research-evidence vocabularies. |

Catalog V7 holds 24 packs and 341 schemas.

## What each catalog adds

**V2.** Domain revisions carry a qualifier, quantities name their units, and
identifiers name their scheme. It comes with an importer that requires every
listed Wikidata property to be present. The
[coverage guide](../spec/research-v1/coverage-v2.md) explains how sources are
kept, how relation types are checked, how older catalogs stay compatible, and
which properties are pinned.

**V3.** A separate source-relations pack records twelve kinds of source
attribution. The [source relations guide](../spec/research-v1/source-relations-v1.md)
lists them and their limits.

**V4 and V5.** V4 adds identity and context records
([identity and context](../spec/research-v1/identity-context-v1.md)). V5 adds
the `sponge.bridge-relations` pack with fourteen explicit joins across domains:
offers, assays, editorial placements, event series, music, finance,
simulations, agent work, profiles, organizations, and language. The
[bridge relations guide](../spec/research-v1/bridge-relations-v1.md) describes
their open ranges and what needs review before use.

**V6.** Three profiles you can adopt separately.
[Measurement results](../spec/research-v1/measurement-results-v1.md) name the
model version, metric, and dataset split.
[Monetary values and quotes](../spec/research-v1/monetary-values-v1.md) keep an
exact decimal amount, currency, and quantity basis.
[Content occurrences](../spec/research-v1/content-occurrences-v1.md) name the
source version that contains a text or cultural work. These links do not infer
that two measurements are comparable, that a price is current, or that one
work influenced another.

**V7.** [Participation roles](../spec/research-v1/participation-roles-v1.md)
record dated assignments and credits. A participation record ties a person’s
or organization’s role to the exact recording, edition, or other credited
subject, with its source evidence, and organization assignments can use the
same role descriptors. The listed query paths are guidance; they do not run
joins or infer employment, ownership, or rights.

**V8.** Six optional vocabularies for research evidence:

- [Temporal roles](../spec/research-v1/temporal-roles-v1.md) name a record’s
  event, observation, availability, entry, and review times.
- [Evidence grading](../spec/research-v1/evidence-grading-v1.md) holds a
  graded stratum, tier, and corroboration state under stated criteria.
- [Citations](../spec/research-v1/citation-v1.md) bind a claim to a verbatim
  selector in a stored payload.
- [Research operations](../spec/research-v1/research-ops-v1.md) record a
  search that found nothing within a stated scope, monitor runs, rejections,
  and review events.
- [Source quality](../spec/research-v1/source-quality-v1.md) records measured
  scorecards.
- [Source policy](../spec/research-v1/source-policy-v1.md) records what each
  source may be used for.

Every one of these stays attributed to whoever recorded it. A grade is not a
review decision, corroboration is not truth, a search that found nothing is not
proof that nothing exists, and a policy record grants no permission.

## Wikidata mappings and file commands

| Command | Requires | What it does |
| --- | --- | --- |
| `oh research wikidata-mappings` | 0.6.1 | Prints three mappings: P31, P279, and P361. |
| `oh research wikidata-mappings-v2` | 0.7.1 | Prints fifteen mappings: those three plus the twelve source attributions. |
| `oh research wikidata-mappings-v3` | 0.8.1 | Prints a ledger of 16 properties kept as source data without a local mapping. |
| `oh research wikidata-mapping-preview --file PATH` | 0.6.1 | Previews how a capture maps under V1. |
| `oh research wikidata-mapping-preview-v2 --file PATH` | 0.7.1 | Previews how a capture maps under V2. |
| `oh research wikidata-preview --file PATH` | 0.5.0 | Verifies a capture offline; a `v: 2` capture uses the V2 importer. |
| `oh research validate-draft --file PATH` | 0.5.0 | Checks a draft against the catalog. |
| `oh research prepare-packet --file PATH` | 0.5.0 | Builds and validates a research packet. |
| `oh research verify-packet --file PATH` | 0.5.0 | Verifies a packet. |

The file commands read one regular file of at most 16 MiB and refuse a
symbolic link. They print canonical JSON of at most 16 MiB and never open a
store, read credentials, or use the network.

A packet holds at most 1,024 records, each at most 1 MiB with at most 4,096
dependencies, built from at most 8 MiB of source JSON, and the packet itself
is at most 16 MiB. A store snapshot used with packets holds at most 8,192
records. Packets are not suitable for secrets or personal data you may need to
erase, because records and their digests are kept in the history.

The [research profile specification](../spec/research-v1/README.md) defines
the formats, limits, and the path from a source to the store.
