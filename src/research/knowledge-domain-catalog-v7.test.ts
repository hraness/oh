import { describe, expect, test } from "bun:test";
import { spongeKnowledgeDomainCatalogV6 } from "./knowledge-domain-catalog-v6";
import { spongeKnowledgeDomainCatalogV7 } from "./knowledge-domain-catalog-v7";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1 } from "./knowledge-vocabulary-pack-v1";

describe("participation roles catalog v7", () => {
  test("retains the exact V6 catalog and stays within the host declaration budget", async () => {
    const [previous, catalog] = await Promise.all([spongeKnowledgeDomainCatalogV6(), spongeKnowledgeDomainCatalogV7()]);
    expect(String(previous.lock.lockSha256)).toBe("bbe7945e131128390b872d0fa05428f0ada30912d97ce61ca224b424bec93c1f");
    expect(catalog.historicalPacks).toEqual(previous.historicalPacks);
    expect(catalog.packs.filter(pack => pack.packId !== "sponge.participation-roles")).toEqual([...previous.packs]);
    expect(catalog.packs).toHaveLength(24);
    expect(catalog.lock.roots).toHaveLength(21);
    expect(catalog.schemas).toHaveLength(341);
    const retained = new Set([...catalog.historicalPacks, ...catalog.packs]
      .flatMap(pack => pack.schemas.map(schema => schema.revisionSha256)));
    expect(retained.size).toBe(477);
    expect(retained.size).toBeLessThan(512);
    expect(catalog.lock.lockSha256).not.toBe(previous.lock.lockSha256);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.participationRolesPack.schemas)).toBe(true);
  });

  test("resolves the role profile without silently selecting unrelated V6 extensions", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV7();
    const pack = catalog.participationRolesPack;
    const result = await resolveKnowledgeVocabularyPacksV1({ manifests: catalog.packs, roots: [knowledgeVocabularyPackPinV1(pack)] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Participation dependency resolution failed.");
    expect(result.value.lock.roots).toEqual([knowledgeVocabularyPackPinV1(pack)]);
    expect(result.value.packs).toHaveLength(21);
    expect(result.value.packs.some(item => ["sponge.measurement-results", "sponge.monetary-values", "sponge.content-occurrences"].includes(item.packId))).toBe(false);
    expect(pack.schemas).toHaveLength(5);
    expect(pack.previousManifestSha256).toBeNull();
    expect(pack.revision).toBe(1);
    const reversed = await resolveKnowledgeVocabularyPacksV1({ manifests: [...catalog.packs].reverse(), roots: catalog.lock.roots });
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) throw new Error("Catalog resolution failed.");
    expect(reversed.value.lock).toEqual(catalog.lock);
  });
});
