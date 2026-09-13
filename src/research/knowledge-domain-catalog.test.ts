import { describe, expect, test } from "bun:test";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { knowledgeDomainSchemaByRef, spongeKnowledgeDomainCatalog, SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS } from "./knowledge-domain-catalog";
import { evaluateKnowledgeShapeV1, parseKnowledgeGraphRecordV1 } from "./knowledge-ontology-contract-v1";
import { parseKnowledgeEntityId } from "./knowledge-ontology-v1";

describe("available builtin domain catalog", () => {
  test("covers fourteen composable domains without changing the canonical core or claiming installation", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    const core = await spongeCoreKnowledgeCatalogV1();
    expect(SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS).toHaveLength(14);
    expect(catalog.packs).toHaveLength(16);
    expect(catalog.corePack.vocabulary).toEqual(core.vocabulary);
    expect(catalog.corePack.schemas.map((schema) => schema.revisionSha256).sort()).toEqual(core.schemas.map((schema) => schema.revisionSha256).sort());
    expect(core.rightsPolicy.humanReviewRequiredFor).toEqual(["identity", "public-encyclopedia", "schema"]);
    for (const pack of catalog.packs.filter((item) => SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS.includes(item.packId))) {
      expect(pack.vocabulary.state).toBe("private");
      expect(pack.vocabulary.ownerEntityId).toBe(core.vocabulary.ownerEntityId);
      expect(pack.schemas.filter((schema) => schema.kind === "concept").length).toBeGreaterThanOrEqual(4);
      expect(pack.schemas.filter((schema) => schema.kind === "predicate").length).toBeGreaterThanOrEqual(4);
      expect(pack.schemas.every((schema) => schema.reviewDecisionSha256 === null)).toBe(true);
      expect(pack.shapes).toHaveLength(1);
      expect(pack.examples).toHaveLength(1);
      expect(pack.sources[0]?.license).toBe("MIT");
      expect(pack.schemas.some((schema) => schema.kind === "mapping")).toBe(false);
    }
  });

  test("all schema, vocabulary and executable shape records pass the existing graph ingress", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    for (const pack of catalog.packs) {
      expect((await parseKnowledgeGraphRecordV1("vocabulary", pack.vocabulary)).ok).toBe(true);
      for (const schema of pack.schemas) {
        expect((await parseKnowledgeGraphRecordV1("schema", schema)).ok).toBe(true);
        expect(knowledgeDomainSchemaByRef(catalog, schema.ref)).toEqual(schema);
        expect(knowledgeDomainSchemaByRef(catalog, { ...schema.ref, revision: schema.ref.revision + 1 })).toBeNull();
      }
      for (const shape of pack.shapes) expect((await parseKnowledgeGraphRecordV1("shape", shape)).ok).toBe(true);
    }
  });

  test("domain predicates explicitly admit shared qualifiers with typed time, place and attribution ranges", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    const qualifiers = catalog.referencePack.schemas.filter(schema => schema.kind === "predicate");
    expect(qualifiers.map(schema => schema.identity.code)).toEqual([
      "at-time", "language-context", "method-context", "place-context", "population-context", "source-context", "valid-during",
    ]);
    expect(qualifiers.find(schema => schema.identity.code === "at-time")?.range).toEqual({ kind: "value-kinds", valueKinds: ["time"], v: 1 });
    expect(qualifiers.find(schema => schema.identity.code === "valid-during")?.range).toEqual({ kind: "value-kinds", valueKinds: ["interval"], v: 1 });
    for (const code of ["language-context", "method-context", "place-context", "population-context", "source-context"]) {
      expect(qualifiers.find(schema => schema.identity.code === code)?.range.kind).toBe("entity-concepts");
    }
    for (const pack of catalog.packs.filter(item => SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS.includes(item.packId))) {
      for (const schema of pack.schemas.filter(item => item.kind === "predicate")) {
        expect(schema.qualifierPredicates.map(ref => ref.schemaSha256).sort()).toEqual(qualifiers.map(item => item.revisionSha256).sort());
      }
      expect(pack.dependencies).toContainEqual(expect.objectContaining({ packId: catalog.referencePack.packId, manifestSha256: catalog.referencePack.manifestSha256 }));
    }
  });

  test("a real executable profile diagnoses a missing required relation", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    const shape = catalog.packs.find((pack) => pack.packId === "sponge.language")?.shapes[0];
    const entityId = parseKnowledgeEntityId(`kent_${"e".repeat(24)}`);
    if (shape === undefined || entityId === null) throw new Error("Missing fixture.");
    const result = await evaluateKnowledgeShapeV1({ assertions: [], disclosure: "private", entityId, evidence: [], memberships: [], purpose: "private-research", rightsDecisions: [], rootShape: shape.shape, shapes: [shape], statements: [] });
    expect(result.passed).toBe(false);
    expect(result.violations.map((violation) => violation.code)).toContain("cardinality-minimum");
  });

  test("keeps essential distinctions separate and navigational broader relations anchored in core", async () => {
    const catalog = await spongeKnowledgeDomainCatalog();
    const required = {
      "sponge.language": ["lexeme", "form", "sense", "translation-of-sense"],
      "sponge.organizations": ["announcement", "transaction", "completion"],
      "sponge.substances": ["molecular-identity", "product", "batch", "sample", "assay", "offer"],
      "sponge.music": ["musical-work", "performance", "recording", "release", "track"],
      "sponge.software": ["model-version", "configuration", "dataset-version", "benchmark-protocol", "run"],
      "sponge.people": ["public-profile-document", "source-contact-record", "profile-projection"],
    };
    for (const [packId, codes] of Object.entries(required)) {
      for (const code of codes) expect(catalog.packs.find((pack) => pack.packId === packId)?.schemas.map((schema) => schema.identity.code)).toContain(code);
    }
    for (const schema of catalog.schemas.filter((item) => item.identity.namespace !== "sponge.core")) {
      if (schema.kind === "concept") expect(schema.broader.every((ref) => ref.namespace === "sponge.core")).toBe(true);
    }
  });
});
