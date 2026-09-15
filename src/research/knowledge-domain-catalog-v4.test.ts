import { describe, expect, test } from "bun:test";
import { spongeKnowledgeDomainCatalogV3 } from "./knowledge-domain-catalog-v3";
import { spongeKnowledgeDomainCatalogV4 } from "./knowledge-domain-catalog-v4";
import { parseKnowledgeGraphRecordV1, type KnowledgePredicateRevisionV1 } from "./knowledge-ontology-contract-v1";

describe("identity-context vocabulary pack", () => {
  test("adds broad typed identity, time, location, evidence, value and provenance records", async () => {
    const [v3, v4] = await Promise.all([spongeKnowledgeDomainCatalogV3(), spongeKnowledgeDomainCatalogV4()]);
    expect(v4.identityContextPack.packId).toBe("sponge.identity-context");
    expect(v4.packs).toHaveLength(v3.packs.length + 1);
    expect(v4.identityContextPack.schemas.filter(schema => schema.kind === "concept")).toHaveLength(8);
    expect(v4.identityContextPack.schemas.filter(schema => schema.kind === "predicate").length).toBeGreaterThanOrEqual(24);
    expect(v4.identityContextPack.vocabulary.state).toBe("private");
    expect(v4.identityContextPack.schemas.every(schema => schema.reviewDecisionSha256 === null)).toBe(true);
    expect(v4.identityContextPack.migrationNotes).toContain("No identifier equality");
  });

  test("keeps V3 pack and lock bytes stable while resolving V4 dependencies", async () => {
    const [v3, v4] = await Promise.all([spongeKnowledgeDomainCatalogV3(), spongeKnowledgeDomainCatalogV4()]);
    expect(v4.sourceRelationsPack.manifestSha256).toBe(v3.sourceRelationsPack.manifestSha256);
    expect(v4.foundationPack.manifestSha256).toBe(v3.foundationPack.manifestSha256);
    expect(v4.identityContextPack.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ packId: "sponge.foundation" }),
      expect.objectContaining({ packId: "sponge.reference" }),
      expect.objectContaining({ packId: "sponge.core" }),
    ]));
    expect(v4.lock.packs).toHaveLength(v3.lock.packs.length + 1);
    for (const schema of v4.identityContextPack.schemas) expect((await parseKnowledgeGraphRecordV1("schema", schema)).ok).toBe(true);
    for (const shape of v4.identityContextPack.shapes) expect((await parseKnowledgeGraphRecordV1("shape", shape)).ok).toBe(true);
  });

  test("retains open-world distinctions for identity and provenance predicates", async () => {
    const catalog = await spongeKnowledgeDomainCatalogV4();
    const pack = catalog.identityContextPack;
    const predicate = (code: string): KnowledgePredicateRevisionV1 | undefined => pack.schemas.find((schema): schema is KnowledgePredicateRevisionV1 => schema.kind === "predicate" && schema.identity.code === code);
    expect(predicate("claims-identity-of")?.range).toEqual(expect.objectContaining({ kind: "entity-concepts" }));
    expect(predicate("has-identifier")?.range).toEqual({ kind: "value-kinds", valueKinds: ["identifier"], v: 1 });
    expect(predicate("activity-time")?.range).toEqual({ kind: "value-kinds", valueKinds: ["time"], v: 1 });
    expect(predicate("activity-actor")?.range).toEqual(expect.objectContaining({ kind: "entity-concepts" }));
    expect(predicate("supports-claim")?.domainConcepts.map(ref => ref.code)).toEqual(["evidence-bundle", "evidence-item"]);
    for (const code of ["evidence-bundle", "evidence-item"]) {
      expect(pack.shapes.find(shape => shape.shape.code === code)?.rules.some(rule => rule.predicate.code === "supports-claim")).toBe(true);
    }
    expect(pack.shapes.every(shape => shape.closed === false)).toBe(true);
  });
});
