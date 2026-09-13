import { describe, expect, test } from "bun:test";

import {
  parseKnowledgeGraphRecordV1,
  parseKnowledgeSchemaRevisionV1,
  parseKnowledgeVocabularyRevisionV1,
} from "./knowledge-ontology-contract-v1";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";

describe("Sponge core knowledge catalog V1", () => {
  test("is deterministic, open-ended, and independent of the retired four-kind prototype", async () => {
    const first = await spongeCoreKnowledgeCatalogV1();
    const second = await spongeCoreKnowledgeCatalogV1();
    expect(second).toEqual(first);
    expect(first.concepts.map((concept) => concept.identity.code)).toContainAllValues([
      "entity", "agent", "person", "organization", "account", "place", "event",
      "process", "artifact", "concept", "information-resource", "source", "work",
      "inquiry",
    ]);
    expect(first.predicates.map((predicate) => predicate.identity.code)).toContainAllValues([
      "name", "description", "identifier", "same-as", "part-of", "related-to",
      "located-in", "about", "cites", "authored-by", "derived-from",
      "created-by", "start-time", "end-time", "object", "published-date",
      "source-type", "title",
    ]);
    expect(first.rightsPolicy).toMatchObject({
      defaultDisclosure: "private",
      humanReviewRequiredFor: ["identity", "public-encyclopedia", "schema"],
      purposes: ["public-encyclopedia"],
      publicRequiresEvidence: true,
    });
    expect(first.vocabularySetSha256).toHaveLength(64);
  });

  test("round-trips every vocabulary and schema record through the strict graph ingress", async () => {
    const catalog = await spongeCoreKnowledgeCatalogV1();
    expect(await parseKnowledgeVocabularyRevisionV1(catalog.vocabulary)).toEqual({
      ok: true,
      value: catalog.vocabulary,
    });
    expect((await parseKnowledgeGraphRecordV1("vocabulary", catalog.vocabulary)).ok)
      .toBe(true);
    for (const schema of catalog.schemas) {
      expect(await parseKnowledgeSchemaRevisionV1(schema)).toEqual({
        ok: true,
        value: schema,
      });
      expect((await parseKnowledgeGraphRecordV1("schema", schema)).ok).toBe(true);
    }
  });

  test("keeps every non-root concept connected to the generic entity lattice", async () => {
    const catalog = await spongeCoreKnowledgeCatalogV1();
    const concepts = new Map(catalog.concepts.map((concept) => [
      concept.identity.code,
      concept,
    ]));
    expect(concepts.get("entity")?.broader).toEqual([]);
    for (const concept of catalog.concepts) {
      if (concept.identity.code === "entity") continue;
      expect(concept.broader).toHaveLength(1);
      const broader = concept.broader[0];
      expect(broader).toBeDefined();
      expect(concepts.has(broader?.code ?? "")).toBe(true);
    }
  });
});
