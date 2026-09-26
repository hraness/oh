# Wikidata mapping catalog V3

`sponge.wikidata-source-mappings.v3` extends the reviewed item-valued mappings in V2 with a source-pinned preservation ledger. The ledger lists literal, temporal, coordinate, media, identifier, and additional item-valued properties observed in the frozen 2026-09-13 corpus.

Each `preservedProperties` entry records the Wikidata property ID, datatype, source revision, and body digest, plus an observed statement count and a rationale. Its `coverage` is always `preserved-only` and its `target` is always `null`. A raw DOI, coordinate, quantity, date, URL, media filename, ticker, chemical formula, or version string can be addressed and queried as source evidence. The catalog does not normalize it into a local predicate, identity, unit, coordinate reference system (CRS), or external authority.

The catalog covers P18, P625, P2048, P348, P356, P571, P577, P580, P582, P747, P155, P156, P231, P249, P274, and P854. All entries are pinned to `spec/research-v1/wikidata/2026-09-13/preservation-coverage.json`. Tests verify each entry's revision, datatype, and body digest, that entries are unique, and that the catalog hash is deterministic.

Use `oh research wikidata-mappings-v3` to inspect the catalog. Consumers that need to map these values to local predicates must add a separately reviewed mapping with an explicit local target and evidence that accounts for the datatype. V3 leaves V1 and V2 previews as they are and does not authorize accepting any claim.
