import { expect, test } from "bun:test";
import fc from "fast-check";
import {
  KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1, canonicalKnowledgeWikidataImportPreviewV1,
  createKnowledgeWikidataImportPreviewV1, verifyKnowledgeWikidataImportPreviewV1,
} from "./knowledge-wikidata-import-v1";

function inputWithClaims(count: number, bound: number) {
  return { v: 1, mappingVersion: "synthetic.v1", properties: ["P1"],
    bounds: { ...KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1, maxStatements: bound }, captures: [{
      requestedId: "Q1", resolvedId: "Q1", sourceUri: "https://www.wikidata.org/wiki/Special:EntityData/Q1.json",
      capturedAt: "2026-09-13T00:00:00.000Z", redirects: [], coverage: { kind: "complete-entity" },
      body: JSON.stringify({ id: "Q1", type: "item", lastrevid: 1, claims: {
        P1: Array.from({ length: count }, (_, index) => ({ type: "statement", id: `Q1$${index}`, rank: "normal",
          mainsnak: { snaktype: "somevalue", property: "P1" },
          qualifiers: { P2: [{ snaktype: "somevalue", property: "P2" }, { snaktype: "somevalue", property: "P2" }] },
          references: [{ snaks: { P2: [{ snaktype: "novalue", property: "P2" }] } }],
        })),
      } }),
    }] };
}

test("every accepted preview has a stable canonical round trip and unique absence occurrences", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 30 }), async (count) => {
    const input = inputWithClaims(count, 100);
    const result = await createKnowledgeWikidataImportPreviewV1(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const encoded = canonicalKnowledgeWikidataImportPreviewV1(result.value);
    const decoded: unknown = JSON.parse(encoded);
    const verified = await verifyKnowledgeWikidataImportPreviewV1(decoded, input);
    expect(verified).toEqual(result);
    expect(canonicalKnowledgeWikidataImportPreviewV1(result.value)).toBe(encoded);
    const absences = result.value.records.filter((record) => record.kind === "snak" && record.value.kind === "absence");
    expect(absences).toHaveLength(count * 4);
    expect(new Set(absences.map((record) => JSON.stringify(record.selector))).size).toBe(count * 4);
  }), { numRuns: 50 });
});

test("no bound yields a partial selected property group", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }),
    async (count, bound) => {
      const input = inputWithClaims(count, bound);
      const result = await createKnowledgeWikidataImportPreviewV1(input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.records.filter((record) => record.kind === "statement"))
        .toHaveLength(count <= bound ? count : 0);
      expect(result.value.coverage[0]?.status).toBe(count <= bound ? "complete-in-asserted-source" : "incomplete");
      expect(result.value.coverage[0]?.definitiveAnswer).toBe(false);
      expect(await verifyKnowledgeWikidataImportPreviewV1(result.value, input)).toEqual(result);
    }), { numRuns: 60 });
});

test("hostile foreign values never manufacture import authority", async () => {
  await fc.assert(fc.asyncProperty(fc.jsonValue(), async (foreign) => {
    const result = await createKnowledgeWikidataImportPreviewV1(foreign);
    expect(result.ok).toBe(false);
  }), { numRuns: 100 });
});
