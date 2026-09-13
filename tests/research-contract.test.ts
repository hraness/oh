import { expect, test } from "bun:test";
import manifest from "../spec/research-v1/manifest.json";
import schema from "../spec/research-v1/packet.schema.json";
import { OH_RESEARCH_PACKET_LIMITS_V1, OH_RESEARCH_PACKET_PROFILE_V1, SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS,
  spongeKnowledgeDomainCatalog } from "../src/research";

test("public research contract pins the implemented admission bounds and original catalog", async () => {
  expect(manifest.profile).toBe(OH_RESEARCH_PACKET_PROFILE_V1);
  expect(manifest.limits).toEqual(OH_RESEARCH_PACKET_LIMITS_V1);
  expect(schema.properties.records.maxItems).toBe(OH_RESEARCH_PACKET_LIMITS_V1.records);
  expect(schema.properties.profile.const).toBe(manifest.profile);
  const catalog = await spongeKnowledgeDomainCatalog();
  expect(catalog.schemas).toHaveLength(manifest.catalog.schemaDefinitions);
  expect(SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS).toHaveLength(manifest.catalog.domainPacks);
  expect(catalog.packs).toHaveLength(manifest.catalog.domainPacks + 2);
  expect(catalog.lock.lockSha256).toBe(manifest.catalog.lockSha256);
  expect(manifest.authority).toBe("unasserted");
});
