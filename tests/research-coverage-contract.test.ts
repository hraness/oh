import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import manifest from "../spec/research-v1/coverage-v2.json";
import {
  spongeKnowledgeDomainCatalogV2, spongeKnowledgeWikidataMappingCatalogV1,
  KNOWLEDGE_WIKIDATA_DATATYPES_V2, KNOWLEDGE_WIKIDATA_PROPERTY_GROUP_LIMIT_V2,
  KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2, createKnowledgeWikidataImportPreviewV2,
} from "../src/research";

test("the public coverage manifest identifies implemented profiles without replacing the V1 packet", async () => {
  const catalog = await spongeKnowledgeDomainCatalogV2();
  const mappings = await spongeKnowledgeWikidataMappingCatalogV1();
  expect(manifest.catalog.packs).toBe(catalog.packs.length);
  expect(manifest.catalog.schemas).toBe(catalog.schemas.length);
  expect(manifest.catalog.shapes).toBe(catalog.packs.flatMap(pack => pack.shapes).length);
  expect(manifest.catalog.units).toBe(catalog.schemas.filter(schema => schema.kind === "unit").length);
  expect(manifest.catalog.lockSha256).toBe(catalog.lock.lockSha256);
  expect(manifest.wikidata.propertyGroupLimit).toBe(KNOWLEDGE_WIKIDATA_PROPERTY_GROUP_LIMIT_V2);
  expect(manifest.wikidata.previewLimits).toEqual(KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2);
  expect(manifest.wikidata.datatypes).toBe(KNOWLEDGE_WIKIDATA_DATATYPES_V2.length);
  expect(manifest.wikidata.mappingCatalogSha256).toBe(mappings.catalogSha256);
  expect(manifest.wikidata.mappedProperties).toEqual(mappings.mappings.map(mapping => mapping.source.propertyId));
  expect(manifest.wikidata.semanticCompleteness).toBe("not-claimed");
  expect(manifest.packetContract).toBe("oh.research-packet.v1");
  for (const path of [manifest.specification, manifest.legacyManifest, manifest.wikidata.inventory, manifest.wikidata.coverage]) {
    expect(await Bun.file(new URL(`../spec/research-v1/${path}`, import.meta.url)).exists()).toBe(true);
  }
});

test("the documented synthetic V2 capture request executes without claiming source completeness", async () => {
  const documentation = await readFile(new URL("../spec/research-v1/coverage-v2.md", import.meta.url), "utf8");
  const example = documentation.match(/```json\n([\s\S]*?)\n```/u)?.[1];
  expect(example).toBeDefined();
  const result = await createKnowledgeWikidataImportPreviewV2(JSON.parse(example!));
  if (!result.ok) throw new Error(result.error.field);
  expect(result.value.sources[0]?.coverage.kind).toBe("partial");
  expect(result.value.sourceAssertions).toEqual([]);
  expect(result.value.status).toBe("unadmitted");
});
