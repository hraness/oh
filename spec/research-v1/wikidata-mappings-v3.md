# Wikidata mapping catalog V3

`oh.wikidata-source-mappings.v3` extends the reviewed item-valued mappings in V2 with a source-pinned preservation ledger for high-value literal, temporal, coordinate, media, and identifier properties observed in the frozen 2026-09-13 corpus.

Each `preservedProperties` entry records the Wikidata property ID, exact datatype, source revision and body digest, plus an observed statement count and a rationale. Its `coverage` is always `preserved-only` and `target` is always `null`. This is intentional: a raw DOI, coordinate, quantity, date, URL, media filename, ticker, chemical formula, or version string is addressable and queryable as source evidence, but is not silently normalized into a local predicate, identity, unit, CRS, or external authority.

The catalog currently covers P18, P625, P2048, P348, P356, P571, P577, P580, P582, P747, P155, P156, P231, P249, P274, and P854. All entries are pinned to `spec/research-v1/wikidata/2026-09-13/preservation-coverage.json`; tests verify revision, datatype, body digest, uniqueness, and deterministic catalog hashing.

Use `oh research wikidata-mappings-v3` to inspect the catalog. Consumers that need semantic projections must add a separately reviewed mapping with an explicit local target and datatype-aware evidence. V3 does not change V1/V2 previews or grant admission authority.
