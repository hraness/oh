import { expect, test } from "bun:test";
import fc from "fast-check";
import { createKnowledgeWikidataImportPreviewV1, isKnowledgeWikidataEntityIdV1 } from "./knowledge-wikidata-import-v1";
import {
  createKnowledgeWikidataImportPreviewV2, verifyKnowledgeWikidataImportPreviewV2,
  canonicalKnowledgeWikidataImportPreviewV2, isKnowledgeWikidataEntityIdV2,
  KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2, type KnowledgeWikidataImportInputV2,
} from "./knowledge-wikidata-import-v2";

/** Synthetic adversarial specimens, separate from the frozen live source corpus. */
function inputForClaims(claims: unknown, properties: KnowledgeWikidataImportInputV2["properties"] = "all-present"): KnowledgeWikidataImportInputV2 {
  return { v: 2, mappingVersion: "source-identities.v1", properties, captures: [{
    requestedId: "Q1", resolvedId: "Q1", sourceUri: "https://www.wikidata.org/wiki/Special:EntityData/Q1.json",
    capturedAt: "2026-09-13T00:00:00.000Z", redirects: [], coverage: { kind: "complete-entity" },
    body: JSON.stringify({ type: "item", id: "Q1", lastrevid: 12, claims }),
  }] };
}
function statement(property: string, datatype: string, datavalue: unknown, suffix = "a") {
  return { id: `Q1$${property}-${suffix}`, type: "statement", rank: "normal",
    mainsnak: { property, snaktype: "value", datatype, datavalue } };
}
const entity = (id: string, kind: string) => ({ type: "wikibase-entityid", value: { id, "entity-type": kind } });
const specimens = {
  "wikibase-item": entity("Q2", "item"), "wikibase-property": entity("P2", "property"),
  "wikibase-lexeme": entity("L2", "lexeme"), "wikibase-form": entity("L2-F1", "form"),
  "wikibase-sense": entity("L2-S1", "sense"), "entity-schema": entity("E1", "entity-schema"),
  "string": { type: "string", value: "cafe\u0301" }, "external-id": { type: "string", value: "0000-0001" },
  "url": { type: "string", value: "https://example.org/" }, "commonsMedia": { type: "string", value: "Example.jpg" },
  "math": { type: "string", value: "x^2" }, "musical-notation": { type: "string", value: "c'4" },
  "geo-shape": { type: "string", value: "Data:Example.map" }, "tabular-data": { type: "string", value: "Data:Example.tab" },
  "monolingualtext": { type: "monolingualtext", value: { language: "es", text: "caballo" } },
  "quantity": { type: "quantity", value: { amount: "+12345678901234567890.25", lowerBound: "+12345678901234567890.20", upperBound: "+12345678901234567890.30", unit: "http://www.wikidata.org/entity/Q11573" } },
  "time": { type: "time", value: { time: "-0044-00-00T00:00:00Z", precision: 9, timezone: 0, before: 1, after: 2, calendarmodel: "http://www.wikidata.org/entity/Q1985786" } },
  "globe-coordinate": { type: "globecoordinate", value: { latitude: 12, longitude: 20, altitude: null, precision: 0.01, globe: "http://www.wikidata.org/entity/Q111" } },
};

test("all eighteen current datatypes retain exact values under arbitrary source property identities", async () => {
  const entries = Object.entries(specimens);
  expect(entries).toHaveLength(18);
  const input = inputForClaims(Object.fromEntries(entries.map(([datatype, datavalue], i) => [`P${i + 1}`, [statement(`P${i + 1}`, datatype, datavalue)]])));
  const result = await createKnowledgeWikidataImportPreviewV2(input);
  if (!result.ok) throw new Error(result.error.field);
  expect(result.value.omissions).toEqual([]);
  expect(result.value.sourceAssertions).toHaveLength(18);
  const snaks = result.value.records.filter(record => record.kind === "snak");
  expect(snaks.every(record => record.value.kind === "typed-source-value")).toBe(true);
  for (const [datatype, datavalue] of entries) {
    expect(snaks.find(record => record.value.kind === "typed-source-value" && record.value.datatype === datatype)?.value)
      .toEqual({ kind: "typed-source-value", datatype, datavalue });
  }
  for (const assertion of result.value.sourceAssertions) {
    expect(assertion.predicate.uri).toBe(`http://www.wikidata.org/entity/${assertion.predicate.propertyId}`);
    expect(assertion.subject.uri).toBe("http://www.wikidata.org/entity/Q1");
    expect(assertion.interpretation).toBe("source-asserted");
    expect(assertion.eligibleForAdmission).toBe(false);
  }
  expect(result.value.sources[0]?.body).toBe(input.captures[0]?.body);
  expect(await verifyKnowledgeWikidataImportPreviewV2(JSON.parse(canonicalKnowledgeWikidataImportPreviewV2(result.value)), input)).toEqual(result);
});

test("future datatypes and malformed known values remain explicit unsupported evidence", async () => {
  const input = inputForClaims({ P1: [statement("P1", "future-datatype", { type: "future", value: { nested: [1, 2] } })],
    P2: [statement("P2", "entity-schema", entity("Q1", "item"))] });
  const result = await createKnowledgeWikidataImportPreviewV2(input);
  if (!result.ok) throw new Error(result.error.field);
  expect(result.value.sourceAssertions).toHaveLength(2);
  expect(result.value.mappingCandidates.map(candidate => candidate.status)).toEqual(["unsupported-value", "unsupported-value"]);
  expect(result.value.mappingCandidates.every(candidate => !candidate.eligibleForAdmission)).toBe(true);
});

test("all-present spans more than the old selected-property limit with complete omission accounting", async () => {
  const claims = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`P${i + 1}`, [statement(`P${i + 1}`, "string", { type: "string", value: `${i}` })]]));
  const input = inputForClaims(claims);
  const full = await createKnowledgeWikidataImportPreviewV2(input);
  if (!full.ok) throw new Error(full.error.field);
  expect(full.value.sourceAssertions).toHaveLength(300);
  expect(full.value.coverage).toHaveLength(300);
  expect(full.value.omissions).toEqual([]);
  const limited = await createKnowledgeWikidataImportPreviewV2({ ...input, bounds: { ...KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2, maxStatements: 10 } });
  if (!limited.ok) throw new Error(limited.error.field);
  expect(limited.value.sourceAssertions).toHaveLength(10);
  expect(limited.value.omissions.reduce((sum, omission) => sum + omission.count, 0)).toBe(290);
  expect(limited.value.coverage.every(row => !row.definitiveAnswer)).toBe(true);
  expect(limited.value.cursor?.captureIndices).toEqual([0]);
});

test("V1 remains readable and distinct; V2 selection never changes V1 identity grammar", async () => {
  const input = inputForClaims({ P1: [statement("P1", "string", { type: "string", value: "same" })] }, ["P1"]);
  const old = await createKnowledgeWikidataImportPreviewV1({ ...input, v: 1 });
  const current = await createKnowledgeWikidataImportPreviewV2(input);
  expect(old.ok && current.ok).toBe(true);
  if (old.ok && current.ok) {
    expect(old.value.records).toEqual(current.value.records);
    expect(old.value.previewSha256).not.toBe(current.value.previewSha256);
    expect((await verifyKnowledgeWikidataImportPreviewV2(old.value, input)).ok).toBe(false);
  }
  expect(isKnowledgeWikidataEntityIdV1("E1")).toBe(false);
  expect(isKnowledgeWikidataEntityIdV2("E1")).toBe(true);
});

test("ranks, qualifiers and reference group boundaries remain attached to each source assertion", async () => {
  const value = statement("P31", "wikibase-item", entity("Q5", "item"));
  const raw = { ...value, rank: "deprecated", qualifiers: { P580: [{ snaktype: "somevalue", property: "P580" }] },
    references: [{ hash: "one", snaks: { P854: [{ snaktype: "novalue", property: "P854" }] } },
      { hash: "two", snaks: { P854: [{ snaktype: "somevalue", property: "P854" }] } }] };
  const result = await createKnowledgeWikidataImportPreviewV2(inputForClaims({ P31: [raw] }));
  if (!result.ok) throw new Error(result.error.field);
  expect<unknown>(result.value.sourceAssertions[0]?.rawStatement).toEqual(raw);
  expect(result.value.sourceAssertions[0]?.rank).toBe("deprecated");
  expect(new Set(result.value.records.filter(record => record.kind === "snak").map(record => JSON.stringify(record.selector))).size).toBe(4);
});

test("foreign input and tampering cannot manufacture source authority", async () => {
  await fc.assert(fc.asyncProperty(fc.jsonValue(), async foreign => {
    expect((await createKnowledgeWikidataImportPreviewV2(foreign)).ok).toBe(false);
  }), { numRuns: 75 });
  const input = inputForClaims({ P1: [statement("P1", "string", { type: "string", value: "x" })] });
  const result = await createKnowledgeWikidataImportPreviewV2(input);
  if (!result.ok) throw new Error(result.error.field);
  const forged = { ...result.value, sourceAssertions: result.value.sourceAssertions.map(assertion => ({ ...assertion, eligibleForAdmission: true })) };
  expect((await verifyKnowledgeWikidataImportPreviewV2(forged, input)).ok).toBe(false);
  let executed = false;
  const hostile = { ...input, get properties() { executed = true; return "all-present"; } };
  expect((await createKnowledgeWikidataImportPreviewV2(hostile)).ok).toBe(false);
  expect(executed).toBe(false);
});


test("historical lowercase statement prefixes retain their exact source GUID bytes", async () => {
  const raw = { ...statement("P31", "wikibase-item", entity("Q5", "item")), id: "q1$3ff6552a-41f7-0650-dbf3-8b6be2d8dc9a" };
  const input = inputForClaims({ P31: [raw] }, ["P31"]);
  const current = await createKnowledgeWikidataImportPreviewV2(input);
  if (!current.ok) throw new Error(current.error.field);
  expect(current.value.omissions).toEqual([]);
  expect(current.value.sourceAssertions[0]?.selector.statementId).toBe(raw.id);
  expect<unknown>(current.value.sourceAssertions[0]?.rawStatement).toEqual(raw);
  const legacy = await createKnowledgeWikidataImportPreviewV1({ ...input, v: 1 });
  if (!legacy.ok) throw new Error(legacy.error.field);
  expect(legacy.value.omissions[0]?.reason).toBe("invalid-statement-group");
});


test("all-present bounds empty property groups before generating an unverifiable coverage ledger", async () => {
  const claims = Object.fromEntries(Array.from({ length: 8_200 }, (_, index) => [`P${index + 1}`, []]));
  const rejected = await createKnowledgeWikidataImportPreviewV2(inputForClaims(claims));
  expect(rejected).toEqual({ ok: false, error: { code: "input-bound", field: "captures.0.property-groups", retryable: false } });
  const bounded = inputForClaims(Object.fromEntries(Object.entries(claims).slice(0, 4_096)));
  const accepted = await createKnowledgeWikidataImportPreviewV2(bounded);
  if (!accepted.ok) throw new Error(accepted.error.field);
  expect(accepted.value.coverage).toHaveLength(4_096);
  expect(await verifyKnowledgeWikidataImportPreviewV2(accepted.value, bounded)).toEqual(accepted);
});


test("future source JSON keys and wide arrays survive accessor-safe transport verification", async () => {
  const raw = JSON.parse('{"constructor":"source","__proto__":{"marker":true},"prototype":[]}');
  raw.prototype = Array(8200).fill(1);
  const request = inputForClaims({ P1: [statement("P1", "future-type", { type: "future", value: raw })] });
  const result = await createKnowledgeWikidataImportPreviewV2(request);
  if (!result.ok) throw new Error(result.error.field);
  expect(result.value.sourceAssertions).toHaveLength(1);
  expect(await verifyKnowledgeWikidataImportPreviewV2(JSON.parse(canonicalKnowledgeWikidataImportPreviewV2(result.value)), request)).toEqual(result);
  expect(Object.prototype).not.toHaveProperty("marker");
});


test("expanded source projections are bounded before creation rather than failing their own verifier", async () => {
  for (const count of [100_000, 205_000]) {
    const request = inputForClaims({ P31: [statement("P31", "wikibase-item", {
      type: "wikibase-entityid", value: { id: "Q5", "entity-type": "item", extra: Array(count).fill(1) },
    })] });
    const result = await createKnowledgeWikidataImportPreviewV2(request);
    if (count === 205_000) expect(result).toEqual({ ok: false, error: { code: "input-bound", field: "preview", retryable: false } });
    else {
      if (!result.ok) throw new Error(result.error.field);
      expect((await verifyKnowledgeWikidataImportPreviewV2(result.value, request)).ok).toBe(true);
    }
  }
});
