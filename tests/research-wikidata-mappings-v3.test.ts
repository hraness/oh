import { expect, test } from "bun:test";
import { readWikidataInventorySourcesV1 } from "../scripts/capture-wikidata-inventory";
import { spongeKnowledgeWikidataMappingCatalogV3, KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V3 } from "../src/research/knowledge-wikidata-mappings-v3";
import { KNOWLEDGE_WIKIDATA_DATATYPES_V2 } from "../src/research/knowledge-wikidata-import-v2";

const directory = new URL("../spec/research-v1/wikidata/2026-09-13", import.meta.url).pathname;

test("V3 preserves a data-driven, source-pinned set of high-value non-item properties", async () => {
  const sources = await readWikidataInventorySourcesV1(directory);
  const catalog = await spongeKnowledgeWikidataMappingCatalogV3();
  expect(catalog.v).toBe(3);
  expect(catalog.mappingVersion).toBe(KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V3);
  expect(catalog.reviewedMappings).toHaveLength(15);
  expect(catalog.preservedProperties).toHaveLength(16);
  const seen = new Set<string>();
  for (const mapping of catalog.preservedProperties) {
    expect(seen.has(mapping.source.propertyId)).toBe(false);
    seen.add(mapping.source.propertyId);
    expect(KNOWLEDGE_WIKIDATA_DATATYPES_V2).toContain(mapping.source.datatype);
    expect(mapping.coverage).toBe("preserved-only");
    expect(mapping.target).toBeNull();
    expect(mapping.v).toBe(3);
    expect(mapping.observedStatements).toBeGreaterThan(0);
    expect(mapping.rationale.length).toBeGreaterThan(20);
    const captured = sources.find(source => source.key === `entity-${mapping.source.propertyId}`);
    expect(captured?.bodySha256).toBe(mapping.source.captureSha256);
    const property = JSON.parse(captured!.body).entities[mapping.source.propertyId];
    expect(property.lastrevid).toBe(mapping.source.revision);
    expect(property.datatype).toBe(mapping.source.datatype);
  }
});

test("V3 is deterministic and does not mutate V2 reviewed mappings", async () => {
  const first = await spongeKnowledgeWikidataMappingCatalogV3();
  const second = await spongeKnowledgeWikidataMappingCatalogV3();
  expect(second).toEqual(first);
  expect(first.reviewedMappings.every(mapping => mapping.v === 2)).toBe(true);
});
