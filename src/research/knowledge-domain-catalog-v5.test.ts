import { describe, expect, test } from "bun:test";
import { spongeKnowledgeDomainCatalogV4 } from "./knowledge-domain-catalog-v4";
import { spongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import { bridgeRelationDefinitions } from "./knowledge-bridge-relations";
import { parseKnowledgeGraphRecordV1 } from "./knowledge-ontology-contract-v1";

const expected = new Map([
  ["offer-for-product", ["offer", "product"]],
  ["offer-has-price", ["offer", "price"]],
  ["assay-uses-method", ["assay", "method"]],
  ["assay-produces-result", ["assay", "finding"]],
  ["placement-in-article", ["placement", "article", "edition"]],
  ["series-has-member-event", ["event-series", "event"]],
  ["track-has-recording", ["track", "recording"]],
  ["listing-at-venue", ["listing", "place"]],
  ["snapshot-of-simulation", ["state-snapshot", "simulation"]],
  ["trajectory-has-attempt", ["trajectory", "attempt"]],
  ["task-pursues-goal", ["task", "goal"]],
  ["profile-for-account", ["profile-projection", "account"]],
  ["role-assignment-at-organization", ["role-assignment", "organization"]],
  ["lexeme-in-language-system", ["lexeme", "language-system"]],
]);

describe("qualified bridge-relations catalog v5", () => {
  test("adds all requested cross-domain paths as open entity predicates", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV5();
    const pack = catalog.bridgeRelationsPack;
    expect(pack.packId).toBe("sponge.bridge-relations");
    expect(pack.schemas).toHaveLength(15);
    expect(pack.schemas.filter(schema => schema.kind === "predicate")).toHaveLength(14);
    expect(pack.schemas.find(schema => schema.identity.code === "price")?.kind).toBe("concept");
    for (const [code, endpoints] of expected) {
      const predicate = pack.schemas.find(schema => schema.kind === "predicate" && schema.identity.code === code);
      if (predicate === undefined || predicate.kind !== "predicate") throw new Error(`Missing bridge predicate ${code}.`);
      expect(predicate.domainConcepts[0]?.code).toBe(endpoints[0]);
      expect(predicate.range.kind).toBe("entity-concepts");
      expect(predicate.range.kind === "entity-concepts" ? predicate.range.concepts.map(ref => ref.code).sort() : []).toEqual(endpoints.slice(1).sort());
    }
    expect(bridgeRelationDefinitions.map(item => item[0])).toEqual([...expected.keys()] as typeof bridgeRelationDefinitions[number][0][]);
  });

  test("leaves prior catalog identities and digests untouched", async () => {
    const [v4, v5] = await Promise.all([spongeKnowledgeDomainCatalogV4(), spongeKnowledgeDomainCatalogV5()]);
    expect(v5.packs.filter(pack => pack.packId !== "sponge.bridge-relations").map(pack => [pack.packId, pack.manifestSha256])).toEqual(v4.packs.map(pack => [pack.packId, pack.manifestSha256]));
    expect(v5.bridgeRelationsPack.dependencies.map(pin => pin.packId)).toContain("sponge.identity-context");
  });

  test("all bridge schemas pass the existing graph ingress", async () => {
    const pack = (await spongeKnowledgeDomainCatalogV5()).bridgeRelationsPack;
    expect((await parseKnowledgeGraphRecordV1("vocabulary", pack.vocabulary)).ok).toBe(true);
    for (const schema of pack.schemas) expect((await parseKnowledgeGraphRecordV1("schema", schema)).ok).toBe(true);
  });
});
