import { describe, expect, test } from "bun:test";
import { spongeKnowledgeDomainCatalogV4 } from "./knowledge-domain-catalog-v4";
import { spongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import { bridgeRelationDefinitions } from "./knowledge-bridge-relations";
import { parseKnowledgeGraphRecordV1 } from "./knowledge-ontology-contract-v1";
import { readFile } from "node:fs/promises";
import { sha256Text } from "./integrity-domain";

const expected = new Map([
  ["offer-for-product", ["offer", "product"]],
  ["offer-has-price", ["offer", "price"]],
  ["assay-uses-method", ["assay", "method"]],
  ["assay-produces-result", ["assay", "finding"]],
  ["placement-in-article", ["placement", "article", "edition"]],
  ["series-has-member-event", ["event-series", "event"]],
  ["track-has-recording", ["track", "recording"]],
  ["listing-at-venue", ["listing", "organization", "place"]],
  ["snapshot-of-simulation", ["state-snapshot", "simulation"]],
  ["trajectory-has-attempt", ["trajectory", "attempt"]],
  ["task-pursues-goal", ["task", "goal"]],
  ["profile-for-account", ["profile-projection", "account"]],
  ["role-assignment-at-organization", ["role-assignment", "organization"]],
  ["lexeme-in-language-system", ["lexeme", "language-system"]],
]);

describe("qualified bridge-relations catalog v5", () => {
  test("machine discovery reaches the bridge pack and its source pin matches the published guide", async () => {
    const guide = await readFile(new URL("../../spec/research-v1/bridge-relations-v1.md", import.meta.url), "utf8");
    const discovery = JSON.parse(await readFile(new URL("../../spec/research-v1/bridge-relations-v1.json", import.meta.url), "utf8"));
    const factories = { spongeKnowledgeDomainCatalogV4, spongeKnowledgeDomainCatalogV5 };
    const factory = factories[discovery.catalog.factory as keyof typeof factories];
    expect(typeof factory).toBe("function");
    const pack = (await factory()).packs.find(item => item.packId === discovery.catalog.additionalPack);
    expect(pack).toBeDefined();
    expect(pack?.revision).toBe(discovery.catalog.additionalPackRevision);
    expect(pack?.sources[0]?.contentSha256).toBe(await sha256Text(guide));
    expect(pack?.schemas.filter(item => item.kind === "predicate").map(item => item.identity.code).sort()).toEqual(discovery.relations.toSorted());
  });
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
    const profile = pack.schemas.find(schema => schema.identity.code === "profile-for-account");
    if (profile?.kind !== "predicate") throw new Error("Missing profile/account bridge.");
    expect(profile.domainConcepts.map(ref => ref.code)).toEqual(["profile-projection", "public-profile-document"]);
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
