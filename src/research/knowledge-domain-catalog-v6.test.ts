import { describe, expect, test } from "bun:test";
import { spongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import { spongeKnowledgeDomainCatalogV6, SPONGE_KNOWLEDGE_EXTENSION_PACK_IDS_V6 } from "./knowledge-domain-catalog-v6";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "./knowledge-vocabulary-pack-v1";

describe("independent ontology depth catalog v6", () => {
  test("preserves the complete published V5 declarations and historical lineage", async () => {
    const [previous, catalog] = await Promise.all([spongeKnowledgeDomainCatalogV5(), spongeKnowledgeDomainCatalogV6()]);
    expect(String(previous.lock.lockSha256)).toBe("ad2f239537cd14021102a12c7e870c1a27fb695e4a51c123f6a7d28bbca0a2bd");
    expect(catalog.historicalPacks).toEqual(previous.historicalPacks);
    expect(catalog.packs.filter(pack => previous.packs.some(old => old.packId === pack.packId))).toEqual([...previous.packs]);
    expect(catalog.packs).toHaveLength(23);
    expect(String(catalog.lock.lockSha256)).toBe("bbe7945e131128390b872d0fa05428f0ada30912d97ce61ca224b424bec93c1f");
    expect(catalog.lock.lockSha256).not.toBe(previous.lock.lockSha256);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.packs)).toBe(true);
  });

  test("each extension resolves independently without selecting another new extension", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV6();
    const extensions = [catalog.measurementResultsPack, catalog.monetaryValuesPack, catalog.contentOccurrencesPack];
    expect(extensions.map(pack => pack.packId)).toEqual([...SPONGE_KNOWLEDGE_EXTENSION_PACK_IDS_V6]);
    for (const pack of extensions) {
      const result = await resolveKnowledgeVocabularyPacksV1({ manifests: catalog.packs, roots: [knowledgeVocabularyPackPinV1(pack)] });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("Extension dependency closure failed.");
      expect(result.value.packs.filter(item => extensions.some(extension => extension.packId === item.packId)))
        .toEqual([pack]);
      expect(pack.previousManifestSha256).toBeNull();
      expect(pack.revision).toBe(1);
      expect(result.value.lock.roots).toEqual([knowledgeVocabularyPackPinV1(pack)]);
    }
  });

  test("resolves the whole catalog to the same canonical lock regardless of supplied order", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV6();
    const result = await resolveKnowledgeVocabularyPacksV1({ manifests: [...catalog.packs].reverse(), roots: catalog.lock.roots });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Full catalog dependency closure failed.");
    expect(result.value.lock).toEqual(catalog.lock);
  });
});
