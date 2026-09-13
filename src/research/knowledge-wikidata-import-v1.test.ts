import { expect, test } from "bun:test";
import { sha256Text } from "./integrity-domain";
import {
  KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1, canonicalKnowledgeWikidataImportPreviewV1,
  createKnowledgeWikidataImportPreviewV1, verifyKnowledgeWikidataImportPreviewV1,
  parseKnowledgeWikidataImportInputV1,
  type KnowledgeWikidataImportInputV1,
} from "./knowledge-wikidata-import-v1";

test("foreign array accessors and overridden iterators never execute while raw string code points survive", async () => {
  let executions = 0;
  const input = wikidataFixtureInput();
  const getter = [input.captures[0]];
  Object.defineProperty(getter, "0", { enumerable: true, get: () => { executions++; return input.captures[0]; } });
  const iterator = ["P1"];
  Object.defineProperty(iterator, Symbol.iterator, { value: () => { executions++; throw new Error("Do not execute."); } });
  const methods = [...input.captures];
  Object.defineProperty(methods, "map", { value: () => { executions++; throw new Error("Do not execute."); } });
  for (const value of [{ ...input, captures: getter }, { ...input, properties: iterator }, { ...input, captures: methods }]) {
    expect(parseKnowledgeWikidataImportInputV1(value)).toBeNull();
  }
  const body = input.captures[0]!.body.replace("horse", "cafe\u0301");
  const parsed = parseKnowledgeWikidataImportInputV1({ ...input, captures: [{ ...input.captures[0], body }] });
  expect(parsed?.captures[0]?.body).toBe(body);
  const preview = await createKnowledgeWikidataImportPreviewV1(input);
  if (!preview.ok) throw new Error("Invalid fixture.");
  expect((await verifyKnowledgeWikidataImportPreviewV1({ ...preview.value, records: getter }, input)).ok).toBe(false);
  expect(executions).toBe(0);
});

/** Synthetic Wikibase JSON; no live provider qualification is implied. */
export function wikidataFixtureInput(): KnowledgeWikidataImportInputV1 {
  const unknown = { snaktype: "somevalue", property: "P2", datatype: "wikibase-item" };
  const noValue = { snaktype: "novalue", property: "P3", datatype: "string" };
  const item = { id: "Q1", type: "item", lastrevid: 123,
    labels: { en: { language: "en", value: "horse" }, es: { language: "es", value: "caballo" } },
    aliases: { en: [{ language: "en", value: "domestic horse" }, { language: "en", value: "equine" }] },
    descriptions: { en: { language: "en", value: "synthetic fixture" } },
    sitelinks: { enwiki: { site: "enwiki", title: "Horse", badges: ["Q2"] } },
    claims: { P1: [
      { id: "Q1$statement-a", type: "statement", rank: "normal",
        mainsnak: { snaktype: "value", property: "P1", datatype: "wikibase-item",
          datavalue: { type: "wikibase-entityid", value: { "entity-type": "item", "numeric-id": 2, id: "Q2" } } },
        qualifiers: { P2: [unknown, unknown], P3: [noValue] }, "qualifiers-order": ["P3", "P2"],
        references: [{ hash: "ref-a", snaks: { P2: [unknown], P3: [noValue] }, "snaks-order": ["P3", "P2"] },
          { hash: "ref-a", snaks: { P2: [unknown] }, "snaks-order": ["P2"] }] },
      { id: "Q1$statement-b", type: "statement", rank: "preferred",
        mainsnak: { snaktype: "somevalue", property: "P1", datatype: "wikibase-item" } },
      { id: "Q1$statement-c", type: "statement", rank: "deprecated",
        mainsnak: { snaktype: "novalue", property: "P1", datatype: "wikibase-item" } }],
      P9: [{ id: "Q1$excluded", type: "statement", rank: "normal", mainsnak: noValue }] } };
  return { v: 1, mappingVersion: "raw-preservation.v1", properties: ["P1", "P8"],
    captures: [{ requestedId: "Q9", resolvedId: "Q1", sourceUri: "https://www.wikidata.org/wiki/Special:EntityData/Q9.json",
      capturedAt: "2026-09-13T00:00:00.000Z", body: JSON.stringify({ entities: { Q1: item } }, null, 2),
      redirects: [{ from: "Q9", to: "Q1" }], coverage: { kind: "complete-entity" } }] };
}

function inputForEntity(entity: unknown): KnowledgeWikidataImportInputV1 {
  const base = wikidataFixtureInput();
  return { ...base, properties: ["P1"], captures: [{ ...base.captures[0]!,
    requestedId: "L1", resolvedId: "L1", redirects: [], body: JSON.stringify(entity),
    sourceUri: "https://www.wikidata.org/wiki/Special:EntityData/L1.json" }] };
}

test("retains exact source bytes, revisions, redirects, complete statement groups and occurrence scopes", async () => {
  const input = wikidataFixtureInput();
  const result = await createKnowledgeWikidataImportPreviewV1(input);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const preview = result.value;
  expect(preview.sources[0]?.body).toBe(input.captures[0]?.body);
  expect(preview.sources[0]?.captureSha256).toBe(await sha256Text(input.captures[0]!.body));
  expect(preview.sources[0]?.revision).toBe(123);
  expect(preview.sources[0]?.provenanceStatus).toBe("caller-asserted");
  expect(preview.identityCandidates[0]?.redirects).toEqual([{ from: "Q9", to: "Q1" }]);
  expect(preview.identityCandidates[0]?.localIdentity).toBeNull();
  expect(preview.records.filter((record) => record.kind === "statement").map((record) => record.rank))
    .toEqual(["normal", "preferred", "deprecated"]);
  expect(preview.records.filter((record) => record.kind === "metadata")).toHaveLength(6);
  const absence = preview.records.filter((record) => record.kind === "snak" && record.value.kind === "absence");
  expect(absence).toHaveLength(8);
  expect(new Set(absence.map((record) => JSON.stringify(record.selector))).size).toBe(8);
  expect(absence.filter((record) => record.selector.kind === "statement"
    && record.selector.location.kind === "reference")).toHaveLength(3);
  expect(preview.mappingCandidates.every((candidate) => candidate.eligibleForAdmission === false)).toBe(true);
  expect(preview.coverage.find((row) => row.propertyId === "P8"))
    .toMatchObject({ observedStatements: 0, retainedStatements: 0, definitiveAnswer: false });
  const roundTrip: unknown = JSON.parse(canonicalKnowledgeWikidataImportPreviewV1(preview));
  expect(await verifyKnowledgeWikidataImportPreviewV1(roundTrip, input)).toEqual(result);
});

test("lexeme metadata uses paths without statement GUIDs, and form and sense statement owners are retained", async () => {
  const result = await createKnowledgeWikidataImportPreviewV1(inputForEntity({
    id: "L1", type: "lexeme", lastrevid: 8, language: "Q2", lexicalCategory: "Q3", claims: {},
    lemmas: { en: { language: "en", value: "horse" }, de: { language: "de", value: "Pferd" } },
    forms: [{ id: "L1-F1", representations: { en: { language: "en", value: "horses" } },
      grammaticalFeatures: ["Q4"], claims: { P1: [{ id: "L1-F1$claim", type: "statement", rank: "normal",
        mainsnak: { property: "P1", snaktype: "somevalue" } }] } }],
    senses: [{ id: "L1-S1", glosses: { en: { language: "en", value: "the animal" } }, claims: {} }],
  }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const metadata = result.value.records.filter((record) => record.kind === "metadata");
  expect(metadata).toHaveLength(9);
  expect(metadata.every((record) => !Object.hasOwn(record.selector, "statementId"))).toBe(true);
  expect(metadata.some((record) => JSON.stringify(record.selector)
    .includes('"path":["senses",0,"glosses","en"]'))).toBe(true);
  expect(result.value.records.find((record) => record.kind === "snak")?.selector.entityId).toBe("L1-F1");
});

test("statement and record bounds omit whole property groups and round-trip bounded previews", async () => {
  const input = { ...wikidataFixtureInput(), bounds: { ...KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1, maxStatements: 2 } };
  const result = await createKnowledgeWikidataImportPreviewV1(input);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.records.every((record) => record.kind === "metadata")).toBe(true);
  expect(result.value.coverage.find((row) => row.propertyId === "P1"))
    .toMatchObject({ status: "incomplete", retainedStatements: 0, observedStatements: 3 });
  expect(result.value.omissions.some((row) => row.reason === "statement-bound")).toBe(true);
  expect(result.value.cursor).toEqual({ kind: "retry-with-selection", captureIndices: [0] });
  expect(await verifyKnowledgeWikidataImportPreviewV1(result.value, input)).toEqual(result);
});

test("source bounds retain no oversized source and provide a retry cursor", async () => {
  const input = { ...wikidataFixtureInput(), bounds: { ...KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1, maxSourceBytes: 10 } };
  const result = await createKnowledgeWikidataImportPreviewV1(input);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.sources).toHaveLength(0);
  expect(result.value.omissions[0]?.reason).toBe("source-byte-bound");
  expect(await verifyKnowledgeWikidataImportPreviewV1(result.value, input)).toEqual(result);
});

test("partial capture assertions cannot claim full property coverage", async () => {
  const input = wikidataFixtureInput();
  const result = await createKnowledgeWikidataImportPreviewV1({ ...input,
    captures: input.captures.map((capture) => ({ ...capture, coverage: { kind: "partial", reason: "upstream-truncated" } })) });
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.coverage.every((row) => row.status === "incomplete")).toBe(true);
});

test("time, exact quantity and non-Earth angular coordinates are preserved without invented conversion", async () => {
  const values = [
    { datatype: "time", datavalue: { type: "time", value: { time: "-0000000044-00-00T00:00:00Z", timezone: 0,
      before: 0, after: 0, precision: 8, calendarmodel: "http://www.wikidata.org/entity/Q1985786" } } },
    { datatype: "time", datavalue: { type: "time", value: { time: "+2026-09-13T03:00:00Z", timezone: 0,
      before: 0, after: 0, precision: 12, calendarmodel: "http://www.wikidata.org/entity/Q1985727" } } },
    { datatype: "quantity", datavalue: { type: "quantity", value: { amount: "+10000000000000000000.0001",
      lowerBound: "+10000000000000000000.0000", upperBound: "+10000000000000000000.0002", unit: "1" } } },
    { datatype: "globe-coordinate", datavalue: { type: "globecoordinate", value: { latitude: 1.2,
      longitude: 3.4, altitude: null, precision: 0.01, globe: "http://www.wikidata.org/entity/Q111" } } },
    { datatype: "future-datatype", datavalue: { type: "future-value", value: { raw: "unmapped" } } },
  ];
  const result = await createKnowledgeWikidataImportPreviewV1(inputForEntity({ id: "L1", type: "lexeme", lastrevid: 9,
    claims: { P1: values.map((value, index) => ({ id: `L1$${index}`, type: "statement", rank: "normal",
      mainsnak: { ...value, snaktype: "value", property: "P1" } })) } }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.mappingCandidates.map((candidate) => candidate.value.kind))
    .toEqual(["typed-source-value", "typed-source-value", "typed-source-value", "typed-source-value", "unsupported"]);
  expect(result.value.mappingCandidates[0]?.diagnostics).toContain("time-normalization-unsupported");
  expect(result.value.mappingCandidates[3]?.diagnostics).toContain("coordinate-normalization-unsupported");
  expect(result.value.mappingCandidates.every((candidate) => candidate.normalization === "none")).toBe(true);
});

test("invalid boundaries, redirect chains and revisions fail without trusting extra authority fields", async () => {
  const input = wikidataFixtureInput();
  for (const invalid of [
    { ...input, bounds: { ...KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1, maxRecords: 0 } },
    { ...input, bounds: { ...KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1, maxEntities: 101 } },
    { ...input, accepted: true },
    { ...input, captures: [{ ...input.captures[0], redirects: [] }] },
    { ...input, captures: [{ ...input.captures[0], sourceUri: "https://evil.example/data" }] },
    { ...input, captures: [{ ...input.captures[0], body: '{"id":"Q1","type":"item","lastrevid":0}' }] },
    { ...input, captures: [{ ...input.captures[0], body: '{"id":"Q1","type":"item","lastrevid":1,"claims":[]}' }] },
  ]) expect((await createKnowledgeWikidataImportPreviewV1(invalid)).ok).toBe(false);
  const result = await createKnowledgeWikidataImportPreviewV1(input);
  expect(result.ok).toBe(true);
  if (result.ok) expect((await verifyKnowledgeWikidataImportPreviewV1({ ...result.value, status: "accepted" }, input)).ok).toBe(false);
});
