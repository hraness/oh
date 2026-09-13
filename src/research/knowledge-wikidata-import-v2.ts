import { canonicalJson, parseJsonValue, type JsonValue } from "./document-domain";
import { sha256Text, type Sha256Hex } from "./integrity-domain";
import { parseCanonicalInstantV1, utf8ByteLength } from "./integrity-domain";
import { hasExactDataKeys, isJsonRecord, isPlainRecord, type JsonRecord } from "./unknown";
import { knowledgeDeclarativeJson } from "./knowledge-declarative-json";

/** V2 adds all-present selection and source-addressed assertions; the published V1 engine stays frozen.
 * Provider metadata remains caller asserted. EntitySchema references are preserved; EntitySchema documents are not Wikibase entity JSON. */
export const KNOWLEDGE_WIKIDATA_IMPORTER_V2 = "sponge.wikidata-json-import.v2";
export const KNOWLEDGE_WIKIDATA_DATATYPES_V2 = Object.freeze([
  "commonsMedia", "entity-schema", "external-id", "geo-shape", "globe-coordinate", "math", "monolingualtext",
  "musical-notation", "quantity", "string", "tabular-data", "time", "url", "wikibase-form", "wikibase-item",
  "wikibase-lexeme", "wikibase-property", "wikibase-sense",
] as const);
/** This classifies preservation support only, never semantic completeness or truth. */
export function knowledgeWikidataDatatypeSupportV2(datatype: string): "typed-source-value" | "opaque-source-value" {
  return KNOWLEDGE_WIKIDATA_DATATYPES_V2.some(known => known === datatype) ? "typed-source-value" : "opaque-source-value";
}
export const KNOWLEDGE_WIKIDATA_PROPERTY_GROUP_LIMIT_V2 = 4_096;
export const KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2 = Object.freeze({ maxBytes: 64 * 1024 * 1024,
  maxDepth: 64, maxNodes: 1_000_000, maxArrayItems: 250_000 } as const);
/** Accessor-safe raw JSON transport, with the same budget used before creating and verifying previews. */
export function boundedKnowledgeWikidataPreviewJsonV2(value: unknown): JsonValue | undefined {
  return knowledgeDeclarativeJson(value, KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2.maxBytes,
    { ...KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2, preserveStrings: true, preserveObjectKeys: true });
}
export const KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2 = Object.freeze({
  maxEntities: 100, maxStatements: 1_000, maxRecords: 4_096, maxSourceBytes: 8 * 1_024 * 1_024,
} as const);
export type KnowledgeWikidataImportBoundsV2 = Readonly<{
  maxEntities: number; maxStatements: number; maxRecords: number; maxSourceBytes: number;
}>;
export type KnowledgeWikidataImportResultV2<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{
    code: "invalid-input" | "invalid-source" | "input-bound" | "integrity-mismatch";
    field: string; retryable: false;
  }> }>;
export type KnowledgeWikidataSourceCoverageV2 =
  | Readonly<{ kind: "complete-entity" }>
  | Readonly<{ kind: "selected-properties"; properties: readonly string[] }>
  | Readonly<{ kind: "partial"; reason: string }>;
export type KnowledgeWikidataCaptureInputV2 = Readonly<{
  requestedId: string; resolvedId: string; sourceUri: string; capturedAt: string;
  body: string; redirects: readonly Readonly<{ from: string; to: string }>[];
  coverage: KnowledgeWikidataSourceCoverageV2;
}>;
export type KnowledgeWikidataImportInputV2 = Readonly<{
  v: 2; captures: readonly KnowledgeWikidataCaptureInputV2[];
  properties: readonly string[] | "all-present"; mappingVersion: string;
  bounds?: KnowledgeWikidataImportBoundsV2;
}>;
export type KnowledgeWikidataSelectorV2 =
  | Readonly<{ kind: "metadata"; entityId: string; path: readonly (string | number)[] }>
  | Readonly<{
    kind: "statement"; entityId: string; propertyId: string; statementId: string;
    statementIndex: number;
    location: Readonly<{ kind: "statement" }> | Readonly<{ kind: "main" }>
      | Readonly<{ kind: "qualifier"; propertyId: string; snakIndex: number }>
      | Readonly<{
        kind: "reference"; referenceIndex: number; referenceHash: string | null;
        propertyId: string; snakIndex: number;
      }>;
  }>;
export type KnowledgeWikidataPreservedValueV2 =
  | Readonly<{ kind: "absence"; state: "somevalue" | "novalue";
    captureSha256: Sha256Hex; occurrence: KnowledgeWikidataSelectorV2 }>
  | Readonly<{ kind: "typed-source-value"; datatype: string; datavalue: JsonValue }>
  | Readonly<{ kind: "unsupported"; reason: "unknown-datatype" | "invalid-datavalue";
    datatype: string | null; raw: JsonValue }>;
export type KnowledgeWikidataRecordV2 = Readonly<{
  captureSha256: Sha256Hex; selector: KnowledgeWikidataSelectorV2; raw: JsonValue;
}> & (
  | Readonly<{ kind: "metadata" }>
  | Readonly<{ kind: "statement"; rank: "normal" | "preferred" | "deprecated" }>
  | Readonly<{ kind: "snak"; value: KnowledgeWikidataPreservedValueV2 }>
);
export type KnowledgeWikidataMappingCandidateV2 = Readonly<{
  captureSha256: Sha256Hex; selector: KnowledgeWikidataSelectorV2; propertyId: string;
  status: "requires-property-mapping" | "unsupported-value";
  value: KnowledgeWikidataPreservedValueV2;
  normalization: "none"; eligibleForAdmission: false;
  diagnostics: readonly ("property-mapping-required" | "unsupported-source-value"
    | "time-normalization-unsupported" | "coordinate-normalization-unsupported"
    | "quantity-unit-mapping-required")[];
}>;
export type KnowledgeWikidataOmissionV2 = Readonly<{
  captureIndex: number; entityId: string; propertyId: string | null;
  reason: "entity-bound" | "source-byte-bound" | "statement-bound" | "record-bound"
    | "property-not-selected" | "invalid-statement-group" | "invalid-metadata";
  count: number;
}>;
export type KnowledgeWikidataCoverageV2 = Readonly<{
  captureSha256: Sha256Hex; entityId: string; propertyId: string;
  observedStatements: number; retainedStatements: number;
  status: "complete-in-asserted-source" | "incomplete";
  sourceCoverage: "caller-asserted"; definitiveAnswer: false;
}>;
export type KnowledgeWikidataSourceReceiptV2 = KnowledgeWikidataCaptureInputV2 & Readonly<{
  captureSha256: Sha256Hex; sourceBytes: number; revision: number;
  serialization: "wikibase-json-v1"; provenanceStatus: "caller-asserted";
  license: Readonly<{ id: "CC0-1.0"; scope: "wikidata-structured-data-only";
    uri: "https://creativecommons.org/publicdomain/zero/1.0/" }>;
}>;

/** A foreign predicate remains addressable without being mapped to any local vocabulary. */
export type KnowledgeWikidataSourceAssertionV2 = Readonly<{
  subject: Readonly<{ entityId: string; uri: string }>;
  predicate: Readonly<{ propertyId: string; uri: string }>;
  captureSha256: Sha256Hex;
  selector: Extract<KnowledgeWikidataSelectorV2, { kind: "statement" }>;
  rank: "normal" | "preferred" | "deprecated";
  rawStatement: JsonValue;
  interpretation: "source-asserted";
  eligibleForAdmission: false;
}>;

export type KnowledgeWikidataImportPreviewV2 = Readonly<{
  v: 2; kind: "wikidata-import-preview"; provider: "wikidata";
  importerVersion: typeof KNOWLEDGE_WIKIDATA_IMPORTER_V2; mappingVersion: string;
  status: "unadmitted"; disclosure: "private"; identityResolution: "candidate-only";
  properties: readonly string[] | "all-present"; bounds: KnowledgeWikidataImportBoundsV2;
  sources: readonly KnowledgeWikidataSourceReceiptV2[];
  identityCandidates: readonly Readonly<{
    requestedId: string; resolvedId: string; revision: number; captureSha256: Sha256Hex;
    redirects: KnowledgeWikidataCaptureInputV2["redirects"]; localIdentity: null;
  }>[];
  records: readonly KnowledgeWikidataRecordV2[];
  mappingCandidates: readonly KnowledgeWikidataMappingCandidateV2[];
  sourceAssertions: readonly KnowledgeWikidataSourceAssertionV2[];
  coverage: readonly KnowledgeWikidataCoverageV2[];
  omissions: readonly KnowledgeWikidataOmissionV2[];
  cursor: Readonly<{ kind: "retry-with-selection"; captureIndices: readonly number[] }> | null;
  previewSha256: Sha256Hex;
}>;

function failure<T>(field: string, code: "invalid-input" | "invalid-source" | "input-bound"
  | "integrity-mismatch" = "invalid-input"): KnowledgeWikidataImportResultV2<T> {
  return { ok: false, error: { code, field, retryable: false } };
}
function asJson(value: unknown): JsonValue { return value as JsonValue; }
function boundedText(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && utf8ByteLength(value) <= max
    && value.normalize("NFC") === value && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
}
export function isKnowledgeWikidataEntityIdV2(value: unknown): value is string {
  return typeof value === "string" && /^(?:Q[1-9][0-9]*|P[1-9][0-9]*|E[1-9][0-9]*|L[1-9][0-9]*(?:-[FS][1-9][0-9]*)?)$/u.test(value)
    && value.length <= 64;
}
function propertyId(value: unknown): value is string {
  return isKnowledgeWikidataEntityIdV2(value) && value.startsWith("P");
}
function properties(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > 256 || !value.every(propertyId)
    || new Set(value).size !== value.length) return null;
  return [...value].sort();
}
function parseCoverage(value: unknown): KnowledgeWikidataSourceCoverageV2 | null {
  if (!isPlainRecord(value)) return null;
  if (value["kind"] === "complete-entity" && hasExactDataKeys(value, ["kind"])) {
    return { kind: "complete-entity" };
  }
  if (value["kind"] === "selected-properties" && hasExactDataKeys(value, ["kind", "properties"])) {
    const selected = properties(value["properties"]);
    return selected === null ? null : { kind: "selected-properties", properties: selected };
  }
  if (value["kind"] === "partial" && hasExactDataKeys(value, ["kind", "reason"])
    && boundedText(value["reason"])) return { kind: "partial", reason: value["reason"] };
  return null;
}
function parseCapture(value: unknown): KnowledgeWikidataCaptureInputV2 | null {
  if (!isPlainRecord(value) || !hasExactDataKeys(value,
    ["requestedId", "resolvedId", "sourceUri", "capturedAt", "body", "redirects", "coverage"])
    || !isKnowledgeWikidataEntityIdV2(value["requestedId"])
    || !isKnowledgeWikidataEntityIdV2(value["resolvedId"])
    || !boundedText(value["sourceUri"], 4_096)
    || parseCanonicalInstantV1(value["capturedAt"]) === null
    || typeof value["body"] !== "string"
    || !Array.isArray(value["redirects"]) || value["redirects"].length > 16) return null;
  let url: URL;
  try { url = new URL(value["sourceUri"]); } catch { return null; }
  if (url.origin !== "https://www.wikidata.org" || url.username || url.password || url.hash
    || !(url.pathname === "/w/api.php"
      || /^\/wiki\/Special:EntityData\/(?:Q|P|L)[1-9][0-9]*(?:-[FS][1-9][0-9]*)?\.json$/u.test(url.pathname))) return null;
  const redirects: { from: string; to: string }[] = [];
  let last = value["requestedId"];
  const seen = new Set([last]);
  for (const redirect of value["redirects"]) {
    if (!isPlainRecord(redirect) || !hasExactDataKeys(redirect, ["from", "to"])
      || redirect["from"] !== last || !isKnowledgeWikidataEntityIdV2(redirect["to"])
      || seen.has(redirect["to"])) return null;
    redirects.push({ from: last, to: redirect["to"] });
    last = redirect["to"];
    seen.add(last);
  }
  const coverage = parseCoverage(value["coverage"]);
  if (last !== value["resolvedId"] || coverage === null) return null;
  return { requestedId: value["requestedId"], resolvedId: value["resolvedId"],
    sourceUri: value["sourceUri"], capturedAt: value["capturedAt"] as string,
    body: value["body"], redirects, coverage };
}
export function parseKnowledgeWikidataImportInputV2(value: unknown): KnowledgeWikidataImportInputV2 | null {
  // Preserve captured string code points while stripping executable object/array behavior.
  value = knowledgeDeclarativeJson(value, 2 * KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2.maxSourceBytes,
    { preserveStrings: true, maxDepth: 12 });
  if (!isPlainRecord(value) || !hasExactDataKeys(value,
    Object.hasOwn(value, "bounds") ? ["v", "captures", "properties", "mappingVersion", "bounds"]
      : ["v", "captures", "properties", "mappingVersion"])
    || value["v"] !== 2 || !boundedText(value["mappingVersion"])
    || !Array.isArray(value["captures"]) || value["captures"].length === 0
    || value["captures"].length > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2.maxEntities) return null;
  const selected = value["properties"] === "all-present" ? "all-present" : properties(value["properties"]);
  const captures = value["captures"].map(parseCapture);
  if (selected === null || captures.some((capture) => capture === null)) return null;
  let bounds: KnowledgeWikidataImportBoundsV2 = KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2;
  if (Object.hasOwn(value, "bounds")) {
    const candidate = value["bounds"];
    if (!isPlainRecord(candidate) || !hasExactDataKeys(candidate, Object.keys(bounds))) return null;
    for (const [key, maximum] of Object.entries(bounds)) {
      const item = candidate[key];
      if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 1 || item > maximum) return null;
    }
    bounds = { maxEntities: candidate["maxEntities"] as number,
      maxStatements: candidate["maxStatements"] as number, maxRecords: candidate["maxRecords"] as number,
      maxSourceBytes: candidate["maxSourceBytes"] as number };
  }
  return { v: 2, captures: captures as KnowledgeWikidataCaptureInputV2[],
    properties: selected, mappingVersion: value["mappingVersion"], bounds };
}
function parseEntity(body: string, resolvedId: string): JsonRecord | null {
  let foreign: unknown;
  try { foreign = JSON.parse(body) as unknown; } catch { return null; }
  const parsed = parseJsonValue(foreign, { maxDepth: 48, maxNodes: 250_000 });
  if (!parsed.ok || !isJsonRecord(parsed.value)) return null;
  const root = parsed.value;
  const entity = isJsonRecord(root["entities"]) ? root["entities"][resolvedId] : root;
  if (!isJsonRecord(entity) || entity["id"] !== resolvedId
    || typeof entity["lastrevid"] !== "number" || !Number.isSafeInteger(entity["lastrevid"])
    || entity["lastrevid"] < 1 || !(entity["type"] === "item" && resolvedId.startsWith("Q")
      || entity["type"] === "property" && resolvedId.startsWith("P")
      || entity["type"] === "lexeme" && /^L[1-9][0-9]*$/u.test(resolvedId))) return null;
  return entity;
}
function decimal(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1_024
    && /^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}
function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function entityValue(value: JsonValue): boolean {
  if (!isJsonRecord(value)) return false;
  const id = value["id"];
  const kind = value["entity-type"];
  const numericId = value["numeric-id"];
  if (id !== undefined) {
    if (!isKnowledgeWikidataEntityIdV2(id)) return false;
    const expected = id.startsWith("Q") ? "item" : id.startsWith("P") ? "property"
      : id.startsWith("E") ? "entity-schema" : id.includes("-F") ? "form" : id.includes("-S") ? "sense" : "lexeme";
    if (kind !== expected) return false;
    return numericId === undefined || (typeof numericId === "number"
      && Number.isSafeInteger(numericId) && numericId > 0
      && !id.includes("-") && id.slice(1) === String(numericId));
  }
  return (kind === "item" || kind === "property" || kind === "lexeme" || kind === "entity-schema")
    && typeof numericId === "number" && Number.isSafeInteger(numericId) && numericId > 0;
}
function supportedDatavalue(datatype: string, datavalue: JsonRecord): boolean | null {
  const value = datavalue["value"];
  if (value === undefined) return false;
  const type = datavalue["type"];
  if (["wikibase-item", "wikibase-property", "wikibase-lexeme", "wikibase-form", "wikibase-sense", "entity-schema"].includes(datatype)) {
    return type === "wikibase-entityid" && entityValue(value)
      && isJsonRecord(value) && (datatype === "entity-schema" ? value["entity-type"] === "entity-schema" : datatype === `wikibase-${String(value["entity-type"])}`);
  }
  if (["string", "external-id", "url", "commonsMedia", "math", "musical-notation", "geo-shape", "tabular-data"].includes(datatype)) {
    return type === "string" && typeof value === "string";
  }
  if (!isJsonRecord(value)) return ["quantity", "time", "globe-coordinate", "monolingualtext"].includes(datatype) ? false : null;
  if (datatype === "monolingualtext") return type === "monolingualtext"
    && typeof value["language"] === "string" && typeof value["text"] === "string";
  if (datatype === "quantity") return type === "quantity" && decimal(value["amount"])
    && typeof value["unit"] === "string"
    && (value["lowerBound"] === undefined || value["lowerBound"] === null || decimal(value["lowerBound"]))
    && (value["upperBound"] === undefined || value["upperBound"] === null || decimal(value["upperBound"]));
  if (datatype === "time") return type === "time" && typeof value["time"] === "string"
    && /^[+-][0-9]{4,16}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u.test(value["time"])
    && typeof value["calendarmodel"] === "string"
    && ["timezone", "before", "after", "precision"].every((key) => Number.isSafeInteger(value[key]))
    && (value["before"] as number) >= 0 && (value["after"] as number) >= 0
    && (value["precision"] as number) >= 0 && (value["precision"] as number) <= 14;
  if (datatype === "globe-coordinate") return type === "globecoordinate"
    && finiteNumber(value["latitude"]) && finiteNumber(value["longitude"])
    && Math.abs(value["latitude"]) <= 90 && Math.abs(value["longitude"]) <= 180
    && (value["altitude"] === null || finiteNumber(value["altitude"]))
    && (value["precision"] === null || finiteNumber(value["precision"]) && value["precision"] >= 0)
    && typeof value["globe"] === "string";
  return null;
}
function preserveValue(raw: JsonRecord, selector: KnowledgeWikidataSelectorV2,
  captureSha256: Sha256Hex): KnowledgeWikidataPreservedValueV2 {
  const state = raw["snaktype"];
  if ((state === "somevalue" || state === "novalue") && raw["datavalue"] === undefined) {
    return { kind: "absence", state, captureSha256, occurrence: selector };
  }
  const datatype = typeof raw["datatype"] === "string" ? raw["datatype"] : null;
  const datavalue = raw["datavalue"];
  const supported = datatype !== null && isJsonRecord(datavalue)
    ? supportedDatavalue(datatype, datavalue) : false;
  if (state === "value" && datatype !== null && datavalue !== undefined && supported === true) {
    return { kind: "typed-source-value", datatype, datavalue };
  }
  return { kind: "unsupported", reason: supported === null ? "unknown-datatype" : "invalid-datavalue",
    datatype, raw };
}

class PropertyGroupBoundError extends Error {}
type Group = Readonly<{ entityId: string; propertyId: string; raw: JsonValue }>;
type Extracted = Readonly<{ metadata: readonly KnowledgeWikidataRecordV2[];
  groups: readonly Group[]; invalidMetadata: number }>;
function extract(entity: JsonRecord, captureSha256: Sha256Hex, selected: readonly string[] | "all-present", maximumGroups: number): Extracted {
  const metadata: KnowledgeWikidataRecordV2[] = [];
  const groups: Group[] = [];
  let invalidMetadata = 0;
  function addGroup(group: Group): void {
    if (groups.length >= maximumGroups) throw new PropertyGroupBoundError();
    groups.push(group);
  }
  function addMetadata(entityId: string, path: readonly (string | number)[], raw: JsonValue): void {
    metadata.push({ kind: "metadata", captureSha256, selector: { kind: "metadata", entityId, path }, raw });
  }
  function visit(record: JsonRecord, path: readonly (string | number)[], entityId: string): void {
    const terms = ["labels", "descriptions", "aliases", "sitelinks", "lemmas", "representations", "glosses"];
    for (const field of terms) {
      const values = record[field];
      if (values === undefined) continue;
      if (!isJsonRecord(values)) { invalidMetadata += 1; continue; }
      for (const language of Object.keys(values).sort()) {
        const item = values[language];
        if (item === undefined) continue;
        if (field === "aliases") {
          if (!Array.isArray(item)) { invalidMetadata += 1; continue; }
          item.forEach((alias: JsonValue, index: number) => {
            addMetadata(entityId, [...path, field, language, index], alias);
          });
        } else addMetadata(entityId, [...path, field, language], item);
      }
    }
    for (const field of ["language", "lexicalCategory", "grammaticalFeatures", "datatype"]) {
      if (record[field] !== undefined) addMetadata(entityId, [...path, field], record[field]);
    }
    const claims = record["claims"];
    const presentProperties = new Set<string>();
    if (claims !== undefined) {
      if (!isJsonRecord(claims)) invalidMetadata += 1;
      else for (const id of Object.keys(claims).sort()) {
        if (propertyId(id) && claims[id] !== undefined) {
          addGroup({ entityId, propertyId: id, raw: claims[id] });
          presentProperties.add(id);
        }
        else invalidMetadata += 1;
      }
    }
    for (const id of selected === "all-present" ? [] : selected) {
      if (!presentProperties.has(id)) {
        addGroup({ entityId, propertyId: id, raw: claims === undefined || isJsonRecord(claims) ? [] : null });
      }
    }
    for (const field of ["forms", "senses"]) {
      const members = record[field];
      if (members === undefined) continue;
      if (!Array.isArray(members)) { invalidMetadata += 1; continue; }
      const seen = new Set<string>();
      members.forEach((member: JsonValue, index: number) => {
        if (!isJsonRecord(member) || !isKnowledgeWikidataEntityIdV2(member["id"])
          || !member["id"].startsWith(`${entityId}-${field === "forms" ? "F" : "S"}`)
          || seen.has(member["id"])) { invalidMetadata += 1; return; }
        seen.add(member["id"]);
        addMetadata(member["id"], [...path, field, index, "id"], member["id"]);
        visit(member, [...path, field, index], member["id"]);
      });
    }
  }
  visit(entity, [], entity["id"] as string);
  return { metadata, groups, invalidMetadata };
}
function groupRecords(group: Group, captureSha256: Sha256Hex): readonly KnowledgeWikidataRecordV2[] | null {
  if (!Array.isArray(group.raw)) return null;
  const result: KnowledgeWikidataRecordV2[] = [];
  const ids = new Set<string>();
  for (let statementIndex = 0; statementIndex < group.raw.length; statementIndex += 1) {
    const statement: JsonValue | undefined = group.raw[statementIndex];
    if (!isJsonRecord(statement) || statement["type"] !== "statement"
      || !boundedText(statement["id"], 256) || statement["id"].slice(0, group.entityId.length + 1).toUpperCase() !== `${group.entityId}$`
      || ids.has(statement["id"]) || !isJsonRecord(statement["mainsnak"])
      || statement["mainsnak"]["property"] !== group.propertyId
      || !["normal", "preferred", "deprecated"].includes(String(statement["rank"]))) return null;
    ids.add(statement["id"]);
    const base = { kind: "statement" as const, entityId: group.entityId, propertyId: group.propertyId,
      statementId: statement["id"], statementIndex };
    result.push({ kind: "statement", captureSha256, raw: statement,
      selector: { ...base, location: { kind: "statement" } },
      rank: statement["rank"] as "normal" | "preferred" | "deprecated" });
    function addSnak(raw: JsonValue, location: Extract<KnowledgeWikidataSelectorV2,
      { kind: "statement" }>["location"]): boolean {
      if (!isJsonRecord(raw) || !propertyId(raw["property"])
        || !["value", "somevalue", "novalue"].includes(String(raw["snaktype"]))) return false;
      const selector: KnowledgeWikidataSelectorV2 = { ...base, location };
      result.push({ kind: "snak", captureSha256, raw, selector, value: preserveValue(raw, selector, captureSha256) });
      return true;
    }
    if (!addSnak(statement["mainsnak"], { kind: "main" })) return null;
    const qualifiers = statement["qualifiers"];
    if (qualifiers !== undefined) {
      if (!isJsonRecord(qualifiers)) return null;
      for (const id of Object.keys(qualifiers).sort()) {
        const snaks = qualifiers[id];
        if (!propertyId(id) || !Array.isArray(snaks)) return null;
        for (let snakIndex = 0; snakIndex < snaks.length; snakIndex += 1) {
          const snak: JsonValue = snaks[snakIndex] as JsonValue;
          if (!isJsonRecord(snak) || snak["property"] !== id
            || !addSnak(snak, { kind: "qualifier", propertyId: id, snakIndex })) return null;
        }
      }
    }
    const references = statement["references"];
    if (references !== undefined) {
      if (!Array.isArray(references)) return null;
      for (let referenceIndex = 0; referenceIndex < references.length; referenceIndex += 1) {
        const reference: JsonValue = references[referenceIndex] as JsonValue;
        if (!isJsonRecord(reference) || !isJsonRecord(reference["snaks"])
          || !(reference["hash"] === undefined || typeof reference["hash"] === "string")) return null;
        for (const id of Object.keys(reference["snaks"]).sort()) {
          const snaks = reference["snaks"][id];
          if (!propertyId(id) || !Array.isArray(snaks)) return null;
          for (let snakIndex = 0; snakIndex < snaks.length; snakIndex += 1) {
            const snak: JsonValue = snaks[snakIndex] as JsonValue;
            if (!isJsonRecord(snak) || snak["property"] !== id || !addSnak(snak, { kind: "reference",
              referenceIndex, referenceHash: typeof reference["hash"] === "string" ? reference["hash"] : null,
              propertyId: id, snakIndex })) return null;
          }
        }
      }
    }
  }
  return result;
}

export async function createKnowledgeWikidataImportPreviewV2(
  foreign: unknown,
): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataImportPreviewV2>> {
  const input = parseKnowledgeWikidataImportInputV2(foreign);
  if (input === null) return failure("input");
  // Hard input admission bounds apply before JSON parsing; smaller selected bounds yield a ledger.
  if (input.captures.some((capture) => capture.body.length > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2.maxSourceBytes)
    || input.captures.reduce((sum, capture) => sum + utf8ByteLength(capture.body), 0)
      > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2.maxSourceBytes) return failure("captures.body", "input-bound");
  const bounds = input.bounds ?? KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2;
  const sources: KnowledgeWikidataSourceReceiptV2[] = [];
  const records: KnowledgeWikidataRecordV2[] = [];
  const coverage: KnowledgeWikidataCoverageV2[] = [];
  const omissions: KnowledgeWikidataOmissionV2[] = [];
  const retry = new Set<number>();
  let sourceBytes = 0;
  let statements = 0;
  let propertyGroups = 0;
  const seenCaptures = new Set<string>();
  for (let captureIndex = 0; captureIndex < input.captures.length; captureIndex += 1) {
    const capture = input.captures[captureIndex] as KnowledgeWikidataCaptureInputV2;
    const bytes = utf8ByteLength(capture.body);
    const omit = (entityId: string, propertyId: string | null,
      reason: KnowledgeWikidataOmissionV2["reason"], count: number): void => {
      omissions.push({ captureIndex, entityId, propertyId, reason, count });
      if (reason !== "property-not-selected" && reason !== "invalid-metadata"
        && reason !== "invalid-statement-group") retry.add(captureIndex);
    };
    if (sources.length >= bounds.maxEntities || sourceBytes + bytes > bounds.maxSourceBytes) {
      omit(capture.resolvedId, null, sources.length >= bounds.maxEntities ? "entity-bound" : "source-byte-bound", 1);
      continue;
    }
    const entity = parseEntity(capture.body, capture.resolvedId);
    if (entity === null) return failure(`captures.${captureIndex}.body`, "invalid-source");
    if (entity["claims"] !== undefined && !isJsonRecord(entity["claims"])) {
      return failure(`captures.${captureIndex}.body.claims`, "invalid-source");
    }
    const captureSha256 = await sha256Text(capture.body);
    const captureKey = `${capture.requestedId}:${capture.resolvedId}:${captureSha256}`;
    if (seenCaptures.has(captureKey)) return failure(`captures.${captureIndex}`, "invalid-source");
    seenCaptures.add(captureKey);
    const source: KnowledgeWikidataSourceReceiptV2 = { ...capture, captureSha256, sourceBytes: bytes,
      revision: entity["lastrevid"] as number, serialization: "wikibase-json-v1",
      provenanceStatus: "caller-asserted", license: { id: "CC0-1.0", scope: "wikidata-structured-data-only",
        uri: "https://creativecommons.org/publicdomain/zero/1.0/" } };
    sources.push(source);
    sourceBytes += bytes;
    let extracted: Extracted;
    try { extracted = extract(entity, captureSha256, input.properties, KNOWLEDGE_WIKIDATA_PROPERTY_GROUP_LIMIT_V2 - propertyGroups); }
    catch (error) {
      if (error instanceof PropertyGroupBoundError) return failure(`captures.${captureIndex}.property-groups`, "input-bound");
      throw error;
    }
    propertyGroups += extracted.groups.length;
    if (extracted.invalidMetadata > 0) omit(capture.resolvedId, null, "invalid-metadata", extracted.invalidMetadata);
    if (records.length + extracted.metadata.length <= bounds.maxRecords) records.push(...extracted.metadata);
    else omit(capture.resolvedId, null, "record-bound", extracted.metadata.length);
    for (const group of extracted.groups) {
      const observedStatements = Array.isArray(group.raw) ? group.raw.length : 0;
      if (input.properties !== "all-present" && !input.properties.includes(group.propertyId)) {
        omit(group.entityId, group.propertyId, "property-not-selected", observedStatements);
        continue;
      }
      const groupValues = groupRecords(group, captureSha256);
      let retainedStatements = 0;
      let retained = false;
      if (groupValues === null) omit(group.entityId, group.propertyId, "invalid-statement-group", observedStatements);
      else if (statements + observedStatements > bounds.maxStatements) omit(group.entityId, group.propertyId,
        "statement-bound", observedStatements);
      else if (records.length + groupValues.length > bounds.maxRecords) omit(group.entityId, group.propertyId,
        "record-bound", groupValues.length);
      else {
        records.push(...groupValues); retainedStatements = observedStatements; retained = true;
        statements += observedStatements;
      }
      const assertedComplete = capture.coverage.kind === "complete-entity"
        || capture.coverage.kind === "selected-properties" && capture.coverage.properties.includes(group.propertyId);
      coverage.push({ captureSha256, entityId: group.entityId, propertyId: group.propertyId,
        observedStatements, retainedStatements, status: retained && assertedComplete
          ? "complete-in-asserted-source" : "incomplete", sourceCoverage: "caller-asserted", definitiveAnswer: false });
    }
  }
  const mappingCandidates: KnowledgeWikidataMappingCandidateV2[] = records.flatMap((record) => {
    if (record.kind !== "snak" || record.selector.kind !== "statement") return [];
    const property = record.selector.location.kind === "qualifier" || record.selector.location.kind === "reference"
      ? record.selector.location.propertyId : record.selector.propertyId;
    return [{ captureSha256: record.captureSha256, selector: record.selector, propertyId: property,
      status: record.value.kind === "unsupported" ? "unsupported-value" as const : "requires-property-mapping" as const,
      value: record.value, normalization: "none" as const, eligibleForAdmission: false as const,
      diagnostics: record.value.kind === "unsupported" ? ["unsupported-source-value" as const]
        : ["property-mapping-required" as const,
          ...(record.value.kind === "typed-source-value" && record.value.datatype === "time"
            ? ["time-normalization-unsupported" as const] : []),
          ...(record.value.kind === "typed-source-value" && record.value.datatype === "globe-coordinate"
            ? ["coordinate-normalization-unsupported" as const] : []),
          ...(record.value.kind === "typed-source-value" && record.value.datatype === "quantity"
            ? ["quantity-unit-mapping-required" as const] : [])] }];
  });
  const sourceAssertions: KnowledgeWikidataSourceAssertionV2[] = records.flatMap((record) => {
    if (record.kind !== "statement" || record.selector.kind !== "statement") return [];
    return [{ subject: { entityId: record.selector.entityId, uri: `http://www.wikidata.org/entity/${record.selector.entityId}` },
      predicate: { propertyId: record.selector.propertyId, uri: `http://www.wikidata.org/entity/${record.selector.propertyId}` },
      captureSha256: record.captureSha256, selector: record.selector, rank: record.rank,
      rawStatement: record.raw, interpretation: "source-asserted" as const, eligibleForAdmission: false as const }];
  });
  const payload = { v: 2 as const, kind: "wikidata-import-preview" as const, provider: "wikidata" as const,
    importerVersion: KNOWLEDGE_WIKIDATA_IMPORTER_V2 as typeof KNOWLEDGE_WIKIDATA_IMPORTER_V2, mappingVersion: input.mappingVersion,
    status: "unadmitted" as const, disclosure: "private" as const, identityResolution: "candidate-only" as const,
    properties: input.properties, bounds, sources, identityCandidates: sources.map((source) => ({
      requestedId: source.requestedId, resolvedId: source.resolvedId, revision: source.revision,
      captureSha256: source.captureSha256, redirects: source.redirects, localIdentity: null,
    })), records, mappingCandidates, sourceAssertions, coverage, omissions,
    cursor: retry.size === 0 ? null : { kind: "retry-with-selection" as const, captureIndices: [...retry] } };
  // Include the final digest field in the structural budget before hashing. Its width is fixed.
  if (boundedKnowledgeWikidataPreviewJsonV2({ ...payload, previewSha256: "0".repeat(64) }) === undefined) {
    return failure("preview", "input-bound");
  }
  return { ok: true, value: { ...payload, previewSha256: await sha256Text(canonicalJson(asJson(payload))) } };
}

/** Canonical transport preserves raw captures as strings; it grants no admission or disclosure rights. */
export function canonicalKnowledgeWikidataImportPreviewV2(value: KnowledgeWikidataImportPreviewV2): string {
  return canonicalJson(asJson(value));
}

/** Rebuild from the original import request, including source bodies omitted by selected bounds. */
export async function verifyKnowledgeWikidataImportPreviewV2(
  foreign: unknown,
  input: unknown,
): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataImportPreviewV2>> {
  const rebuilt = await createKnowledgeWikidataImportPreviewV2(input);
  if (!rebuilt.ok) return rebuilt;
  const parsed = boundedKnowledgeWikidataPreviewJsonV2(foreign);
  if (parsed === undefined || canonicalJson(parsed) !== canonicalKnowledgeWikidataImportPreviewV2(rebuilt.value)) {
    return failure("preview", "integrity-mismatch");
  }
  return rebuilt;
}
