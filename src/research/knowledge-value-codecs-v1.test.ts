import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { parseSha256Hex } from "./integrity-domain";
import { parseKnowledgeValueV1, verifyKnowledgeValueV1, type KnowledgeOntologyResult } from "./knowledge-ontology-v1";
import { createKnowledgePreservedValueV1, isKnowledgeLanguageTagV1, parseKnowledgePreservedValuePayloadV1, parseKnowledgePreservedValueV1 } from "./knowledge-value-codecs-v1";
function unwrap<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(result.error.field);
  return result.value;
}
const captureSha256 = (() => { const value = parseSha256Hex("a".repeat(64)); if (value === null) throw new Error("Invalid digest."); return value; })();
const time = { after: 2, before: 1, calendarmodel: "http://www.wikidata.org/entity/Q1985786", kind: "wikibase-time", precision: 8, serialization: "wikibase-json-v1", time: "-0044-00-00T00:00:00Z", timezone: 0, v: 1 } as const;
const coordinate = { altitude: null, globe: "http://www.wikidata.org/entity/Q111", kind: "globe-coordinate", latitude: "12.000", longitude: "-40.5", precision: "1e-7", serialization: "wikibase-json-v1", v: 1 } as const;

describe("approved source-preservation codecs", () => {
  test("round-trips BCE/coarse time, non-Earth angular precision, and full language tags without normalization", async () => {
    const fixtures = [time, coordinate, { kind: "language-text", language: "zh-Hant-TW", text: "馬", v: 1 }, { kind: "language-text", language: "en-US-u-ca-gregory-x-source", text: "horse", v: 1 }, { captureSha256, kind: "missing-value", occurrence: "Q1$guid/references/0/snaks/P2/1", state: "novalue", v: 1 }] as const;
    for (const payload of fixtures) {
      const extension = unwrap(await createKnowledgePreservedValueV1(payload));
      expect(parseKnowledgeValueV1(extension).ok).toBe(true);
      expect((await verifyKnowledgeValueV1(extension)).ok).toBe(true);
      expect(await parseKnowledgePreservedValueV1(JSON.parse(JSON.stringify(extension)))).toEqual({ ok: true, value: payload });
      expect(Object.isFrozen(extension)).toBe(true);
    }
  });

  test("different existential occurrences never collapse and no-value never becomes absence", async () => {
    const values = [];
    for (const occurrence of ["Q1$guid/mainsnak", "Q1$guid/qualifiers/P2/0", "Q1$guid/qualifiers/P2/1", "Q1$guid/references/0/snaks/P2/0"]) {
      for (const state of ["somevalue", "novalue"]) {
        values.push(unwrap(await createKnowledgePreservedValueV1({ captureSha256, kind: "missing-value", occurrence, state, v: 1 })).valueSha256);
      }
    }
    expect(new Set(values).size).toBe(8);
    expect(parseKnowledgePreservedValuePayloadV1({ captureSha256, kind: "missing-value", occurrence: "", state: "somevalue", v: 1 }).ok).toBe(false);
    expect(parseKnowledgePreservedValuePayloadV1(null).ok).toBe(false);
  });

  test("recognizes BCP 47 syntax while preserving original case and rejects ambiguous duplicate subtags", () => {
    for (const language of ["en", "zh-Hant-TW", "sr-Latn-RS", "es-419", "de-CH-1901", "en-a-aaa-b-bbb-x-local", "x-private", "i-klingon", "sgn-BE-FR"]) expect(isKnowledgeLanguageTagV1(language)).toBe(true);
    for (const language of ["", "english_US", "en--US", "en-a", "en-a-aaa-a-bbb", "de-1901-1901", "x", "en-x", "en-123456789"]) expect(isKnowledgeLanguageTagV1(language)).toBe(false);
  });

  test("validates exact coordinate bounds without rounding and pins serialization and temporal precision", () => {
    for (const change of [{ latitude: "90.000000000000000000001" }, { longitude: "-180.0000000000000001" }, { precision: "-0.01" }, { precision: "1e9999" }, { serialization: "rdf" }, { precisionMeters: "1" }]) expect(parseKnowledgePreservedValuePayloadV1({ ...coordinate, ...change }).ok).toBe(false);
    for (const change of [{ precision: 11 }, { precision: 15 }, { before: -1 }, { time: "-0044-99-01T00:00:00Z" }, { serialization: "wikibase-rdf-v1" }]) expect(parseKnowledgePreservedValuePayloadV1({ ...time, ...change }).ok).toBe(false);
    expect(parseKnowledgePreservedValuePayloadV1({ ...coordinate, latitude: "90", longitude: "-180" }).ok).toBe(true);
  });

  test("rejects digest-valid values relabeled with another codec/schema and noncanonical source JSON", async () => {
    const extension = unwrap(await createKnowledgePreservedValueV1(time));
    const other = unwrap(await createKnowledgePreservedValueV1(coordinate));
    expect((await parseKnowledgePreservedValueV1({ ...extension, schema: other.schema })).ok).toBe(false);
    expect((await parseKnowledgePreservedValueV1({ ...extension, canonicalizerSha256: other.valueSha256 })).ok).toBe(false);
    expect((await parseKnowledgePreservedValueV1({ ...extension, mediaType: "application/json" })).ok).toBe(false);
    expect((await parseKnowledgePreservedValueV1({ ...extension, canonicalValue: `${extension.canonicalValue} ` })).ok).toBe(false);
    expect((await parseKnowledgePreservedValueV1({ ...extension, valueSha256: "f".repeat(64) })).ok).toBe(false);
  });

  test("bounds hostile inputs and preserves stable round trips for generated exact coordinates", async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: -90, max: 90 }), fc.integer({ min: -180, max: 180 }), async (latitude, longitude) => {
      const payload = { ...coordinate, latitude: String(latitude), longitude: String(longitude) };
      const extension = unwrap(await createKnowledgePreservedValueV1(payload));
      expect(unwrap(await parseKnowledgePreservedValueV1(extension))).toEqual(payload);
      expect(unwrap(await createKnowledgePreservedValueV1(payload))).toEqual(extension);
    }), { numRuns: 30 });
    await fc.assert(fc.asyncProperty(fc.jsonValue(), async (value) => { expect((await parseKnowledgePreservedValueV1(value)).ok).toBe(false); }), { numRuns: 30 });
  });
});
