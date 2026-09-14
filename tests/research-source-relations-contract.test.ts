import { expect, test } from "bun:test";
import manifest from "../spec/research-v1/source-relations-v1.json";
import { spongeKnowledgeDomainCatalogV3, spongeKnowledgeWikidataMappingCatalogV2 } from "../src/research";

test("source relationship discovery pins the implemented catalog without claiming semantic completeness", async () => {
  const catalog = await spongeKnowledgeDomainCatalogV3();
  const mappings = await spongeKnowledgeWikidataMappingCatalogV2();
  expect(manifest.catalog.packs).toBe(catalog.packs.length);
  expect(manifest.catalog.schemas).toBe(catalog.schemas.length);
  expect(manifest.catalog.shapes).toBe(catalog.packs.flatMap(pack => pack.shapes).length);
  expect(manifest.catalog.units).toBe(catalog.schemas.filter(schema => schema.kind === "unit").length);
  expect(manifest.catalog.lockSha256).toBe(catalog.lock.lockSha256);
  expect(manifest.catalog.additionalPack).toBe(catalog.sourceRelationsPack.packId);
  expect(manifest.catalog.additionalPackRevision).toBe(catalog.sourceRelationsPack.revision);
  expect(manifest.wikidata.mappingCatalogSha256).toBe(mappings.catalogSha256);
  expect(manifest.wikidata.mappingVersion).toBe(mappings.mappingVersion);
  expect(manifest.wikidata.mappedProperties).toEqual(mappings.mappings.map(mapping => mapping.source.propertyId));
  expect(manifest.wikidata.semanticCompleteness).toBe("not-claimed");
  expect(manifest.wikidata.authority).toBe("unadmitted");
  expect(manifest.packetContract).toBe("oh.research-packet.v1");
  for (const path of [manifest.specification, manifest.previousCoverage, manifest.wikidata.sourceCorpus]) {
    expect(await Bun.file(new URL(`../spec/research-v1/${path}`, import.meta.url)).exists()).toBe(true);
  }
});
