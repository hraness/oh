import { expect, test } from "bun:test";
import { readWikidataInventorySourcesV1 } from "../scripts/capture-wikidata-inventory";
import { spongeKnowledgeDomainCatalogV2 } from "../src/research/knowledge-domain-catalog-v2";
import { createKnowledgeWikidataImportPreviewV2 } from "../src/research/knowledge-wikidata-import-v2";
import {
  spongeKnowledgeWikidataMappingCatalogV1, createKnowledgeWikidataMappingPreviewV1,
  verifyKnowledgeWikidataMappingPreviewV1,
} from "../src/research/knowledge-wikidata-mappings-v1";

const directory = new URL("../spec/research-v1/wikidata/2026-09-13", import.meta.url).pathname;
function statement(property: string, id = `Q1$${property}`, datatype = "wikibase-item") {
  return { id, type: "statement", rank: "normal", mainsnak: { property, datatype, snaktype: "value",
    datavalue: { type: "wikibase-entityid", value: { id: "Q5", "entity-type": "item", "numeric-id": 5 } } } };
}
function input(claims: unknown) {
  return { v: 2, properties: "all-present", mappingVersion: "arbitrary-caller-label",
    captures: [{ requestedId: "Q1", resolvedId: "Q1", sourceUri: "https://www.wikidata.org/w/api.php",
      capturedAt: "2026-09-13T00:00:00.000Z", redirects: [], coverage: { kind: "complete-entity" },
      body: JSON.stringify({ type: "item", id: "Q1", lastrevid: 10, claims }) }] };
}

test("every reviewed attribution mapping pins a real captured property revision and an exact local predicate", async () => {
  const sources = await readWikidataInventorySourcesV1(directory);
  const mappingCatalog = await spongeKnowledgeWikidataMappingCatalogV1();
  const domain = await spongeKnowledgeDomainCatalogV2();
  expect(mappingCatalog.mappings).toHaveLength(3);
  const targets = new Set<string>();
  for (const mapping of mappingCatalog.mappings) {
    const captured = sources.find(source => source.key === `entity-${mapping.source.propertyId}`);
    expect(captured?.bodySha256).toBe(mapping.source.captureSha256);
    const property = JSON.parse(captured!.body).entities[mapping.source.propertyId];
    expect(property.lastrevid).toBe(mapping.source.revision);
    expect(property.datatype).toBe(mapping.source.datatype);
    expect(domain.schemas.some(schema => schema.revisionSha256 === mapping.target.schemaSha256 && schema.kind === "predicate")).toBe(true);
    expect(mapping.localMembershipInference).toBe(false);
    expect(mapping.identityMerge).toBe(false);
    targets.add(mapping.target.code);
  }
  expect([...targets].sort()).toEqual(["source-asserted-instance-of", "source-asserted-part-of", "source-asserted-subclass-of"]);
});

test("instance, subclass and part statements project separately without deriving identities or memberships", async () => {
  const request = input(Object.fromEntries(["P31", "P279", "P361", "P999999"].map(property => [property, [statement(property)]])));
  const preview = await createKnowledgeWikidataMappingPreviewV1(request);
  if (!preview.ok) throw new Error(preview.error.field);
  expect(preview.value.candidates).toHaveLength(3);
  expect(preview.value.gaps).toHaveLength(1);
  expect(preview.value.candidates.every(candidate => candidate.status === "requires-local-identity-and-proposal-review"
    && !candidate.eligibleForAdmission && candidate.normalization === "none")).toBe(true);
  expect(preview.value.candidates.map(candidate => candidate.object.uri)).toEqual(Array(3).fill("http://www.wikidata.org/entity/Q5"));
  const source = await createKnowledgeWikidataImportPreviewV2(request);
  if (!source.ok) throw new Error(source.error.field);
  expect(preview.value.sourcePreviewSha256).toBe(source.value.previewSha256);
  expect(await verifyKnowledgeWikidataMappingPreviewV1(JSON.parse(JSON.stringify(preview.value)), request)).toEqual(preview);
  expect((await verifyKnowledgeWikidataMappingPreviewV1({ ...preview.value, gaps: [] }, request)).ok).toBe(false);
});

test("duplicate source GUIDs in different properties cannot substitute a valid value for an invalid one", async () => {
  const request = input({ P279: [statement("P279", "Q1$duplicate", "string")], P31: [statement("P31", "Q1$duplicate")] });
  const preview = await createKnowledgeWikidataMappingPreviewV1(request);
  if (!preview.ok) throw new Error(preview.error.field);
  expect(preview.value.candidates.map(candidate => candidate.mapping.source.propertyId)).toEqual(["P31"]);
  expect(preview.value.gaps[0]?.reason).toBe("source-value-not-an-item");
});

test("absence is preserved as a mapping gap and source constraints do not install local policy", async () => {
  const request = input({ P31: [{ ...statement("P31"), mainsnak: { property: "P31", snaktype: "somevalue", datatype: "wikibase-item" } }],
    P2302: [statement("P2302")] });
  const preview = await createKnowledgeWikidataMappingPreviewV1(request);
  if (!preview.ok) throw new Error(preview.error.field);
  expect(preview.value.candidates).toEqual([]);
  expect(preview.value.gaps.map(gap => gap.reason).sort()).toEqual(["property-not-mapped", "source-value-not-an-item"]);
});


test("raw JSON extension keys remain verifiable after mapping without changing prototypes", async () => {
  const raw = statement("P31");
  const extra: unknown = JSON.parse('{"constructor":"source","__proto__":{"marker":true},"prototype":[0]}');
  const request = input({ P31: [{ ...raw, extensions: extra }] });
  const result = await createKnowledgeWikidataMappingPreviewV1(request);
  if (!result.ok) throw new Error(result.error.field);
  expect(result.value.candidates).toHaveLength(1);
  expect(await verifyKnowledgeWikidataMappingPreviewV1(JSON.parse(JSON.stringify(result.value)), request)).toEqual(result);
  expect(Object.prototype).not.toHaveProperty("marker");
});
