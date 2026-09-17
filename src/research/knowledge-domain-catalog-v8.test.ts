import { describe, expect, test } from "bun:test";
import { spongeKnowledgeDomainCatalogV7 } from "./knowledge-domain-catalog-v7";
import { spongeKnowledgeDomainCatalogV8, SPONGE_KNOWLEDGE_EXTENSION_PACK_IDS_V8 } from "./knowledge-domain-catalog-v8";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "./knowledge-vocabulary-pack-v1";

const NEW_PACKS = new Set<string>(SPONGE_KNOWLEDGE_EXTENSION_PACK_IDS_V8);

describe("research evidence catalog v8", () => {
  test("retains the exact V7 catalog and stays within the host declaration budget", async () => {
    const [previous, catalog] = await Promise.all([spongeKnowledgeDomainCatalogV7(), spongeKnowledgeDomainCatalogV8()]);
    expect(String(previous.lock.lockSha256)).toBe("b0dbb248459686a97ae371a7aa6f9682c8bf27f2d5892a2921cedc9bdf1db523");
    expect(catalog.historicalPacks).toEqual(previous.historicalPacks);
    expect(catalog.packs.filter(pack => !NEW_PACKS.has(pack.packId))).toEqual([...previous.packs]);
    expect(catalog.packs).toHaveLength(30);
    expect(catalog.lock.roots).toHaveLength(27);
    expect(catalog.schemas).toHaveLength(429);
    const retained = new Set([...catalog.historicalPacks, ...catalog.packs]
      .flatMap(pack => pack.schemas.map(schema => schema.revisionSha256)));
    expect(retained.size).toBe(565);
    expect(catalog.lock.lockSha256).not.toBe(previous.lock.lockSha256);
    expect(Object.isFrozen(catalog)).toBe(true);
    for (const pack of [catalog.temporalRolesPack, catalog.evidenceGradingPack, catalog.citationPack,
      catalog.researchOpsPack, catalog.sourceQualityPack, catalog.sourcePolicyPack]) {
      expect(Object.isFrozen(pack.schemas)).toBe(true);
      expect(pack.previousManifestSha256).toBeNull();
      expect(pack.revision).toBe(1);
    }
  }, 30_000);

  test("resolves each new pack's exact dependency closure and ignores order", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV8();
    const closures: Record<string, number> = {
      "sponge.temporal-roles": 4, "sponge.evidence-grading": 9, "sponge.citation": 4,
      "sponge.research-ops": 5, "sponge.source-quality": 4, "sponge.source-policy": 4,
    };
    for (const [packId, expected] of Object.entries(closures)) {
      const pack = catalog.packs.find(item => item.packId === packId);
      if (pack === undefined) throw new Error(`Missing catalog-v8 pack ${packId}.`);
      const result = await resolveKnowledgeVocabularyPacksV1({ manifests: catalog.packs, roots: [knowledgeVocabularyPackPinV1(pack)] });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`Dependency resolution failed for ${packId}.`);
      expect(result.value.packs).toHaveLength(expected);
      expect(result.value.lock.roots).toEqual([knowledgeVocabularyPackPinV1(pack)]);
    }
    const reversed = await resolveKnowledgeVocabularyPacksV1({ manifests: [...catalog.packs].reverse(), roots: catalog.lock.roots });
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) throw new Error("Catalog resolution failed.");
    expect(reversed.value.lock).toEqual(catalog.lock);
  }, 60_000);
});
