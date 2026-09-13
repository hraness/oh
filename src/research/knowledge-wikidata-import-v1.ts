import { canonicalJson, parseJsonValue, type JsonValue } from "./document-domain";
import { sha256Text, type Sha256Hex } from "./integrity-domain";
import { parseCanonicalInstantV1, utf8ByteLength } from "./integrity-domain";
import { hasExactDataKeys, isJsonRecord, isPlainRecord, type JsonRecord } from "./unknown";
import { knowledgeDeclarativeJson } from "./knowledge-declarative-json";

/** An offline, unadmitted evidence preview. Provider metadata is caller asserted. */
export const KNOWLEDGE_WIKIDATA_IMPORTER_V1 = "sponge.wikidata-json-import.v1";
export const KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1 = Object.freeze({
  maxEntities: 100, maxStatements: 1_000, maxRecords: 4_096, maxSourceBytes: 8 * 1_024 * 1_024,
} as const);
export type KnowledgeWikidataImportBoundsV1 = Readonly<{
  maxEntities: number; maxStatements: number; maxRecords: number; maxSourceBytes: number;
}>;
export type KnowledgeWikidataImportResultV1<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{
    code: "invalid-input" | "invalid-source" | "input-bound" | "integrity-mismatch";
    field: string; retryable: false;
  }> }>;
export type KnowledgeWikidataSourceCoverageV1 =
  | Readonly<{ kind: "complete-entity" }>
  | Readonly<{ kind: "selected-properties"; properties: readonly string[] }>
  | Readonly<{ kind: "partial"; reason: string }>;
export type KnowledgeWikidataCaptureInputV1 = Readonly<{
  requestedId: string; resolvedId: string; sourceUri: string; capturedAt: string;
  body: string; redirects: readonly Readonly<{ from: string; to: string }>[];
  coverage: KnowledgeWikidataSourceCoverageV1;
}>;
export type KnowledgeWikidataImportInputV1 = Readonly<{
  v: 1; captures: readonly KnowledgeWikidataCaptureInputV1[];
  properties: readonly string[]; mappingVersion: string;
  bounds?: KnowledgeWikidataImportBoundsV1;
}>;
export type KnowledgeWikidataSelectorV1 =
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
export type KnowledgeWikidataPreservedValueV1 =
  | Readonly<{ kind: "absence"; state: "somevalue" | "novalue";
    captureSha256: Sha256Hex; occurrence: KnowledgeWikidataSelectorV1 }>
  | Readonly<{ kind: "typed-source-value"; datatype: string; datavalue: JsonValue }>
  | Readonly<{ kind: "unsupported"; reason: "unknown-datatype" | "invalid-datavalue";
    datatype: string | null; raw: JsonValue }>;
export type KnowledgeWikidataRecordV1 = Readonly<{
  captureSha256: Sha256Hex; selector: KnowledgeWikidataSelectorV1; raw: JsonValue;
}> & (
  | Readonly<{ kind: "metadata" }>
  | Readonly<{ kind: "statement"; rank: "normal" | "preferred" | "deprecated" }>
  | Readonly<{ kind: "snak"; value: KnowledgeWikidataPreservedValueV1 }>
);
export type KnowledgeWikidataMappingCandidateV1 = Readonly<{
  captureSha256: Sha256Hex; selector: KnowledgeWikidataSelectorV1; propertyId: string;
  status: "requires-property-mapping" | "unsupported-value";
  value: KnowledgeWikidataPreservedValueV1;
  normalization: "none"; eligibleForAdmission: false;
  diagnostics: readonly ("property-mapping-required" | "unsupported-source-value"
    | "time-normalization-unsupported" | "coordinate-normalization-unsupported"
    | "quantity-unit-mapping-required")[];
}>;
export type KnowledgeWikidataOmissionV1 = Readonly<{
  captureIndex: number; entityId: string; propertyId: string | null;
  reason: "entity-bound" | "source-byte-bound" | "statement-bound" | "record-bound"
    | "property-not-selected" | "invalid-statement-group" | "invalid-metadata";
  count: number;
}>;
export type KnowledgeWikidataCoverageV1 = Readonly<{
  captureSha256: Sha256Hex; entityId: string; propertyId: string;
  observedStatements: number; retainedStatements: number;
  status: "complete-in-asserted-source" | "incomplete";
  sourceCoverage: "caller-asserted"; definitiveAnswer: false;
}>;
export type KnowledgeWikidataSourceReceiptV1 = KnowledgeWikidataCaptureInputV1 & Readonly<{
  captureSha256: Sha256Hex; sourceBytes: number; revision: number;
  serialization: "wikibase-json-v1"; provenanceStatus: "caller-asserted";
  license: Readonly<{ id: "CC0-1.0"; scope: "wikidata-structured-data-only";
    uri: "https://creativecommons.org/publicdomain/zero/1.0/" }>;
}>;
export type KnowledgeWikidataImportPreviewV1 = Readonly<{
  v: 1; kind: "wikidata-import-preview"; provider: "wikidata";
  importerVersion: typeof KNOWLEDGE_WIKIDATA_IMPORTER_V1; mappingVersion: string;
  status: "unadmitted"; disclosure: "private"; identityResolution: "candidate-only";
  properties: readonly string[]; bounds: KnowledgeWikidataImportBoundsV1;
  sources: readonly KnowledgeWikidataSourceReceiptV1[];
  identityCandidates: readonly Readonly<{
    requestedId: string; resolvedId: string; revision: number; captureSha256: Sha256Hex;
    redirects: KnowledgeWikidataCaptureInputV1["redirects"]; localIdentity: null;
  }>[];
  records: readonly KnowledgeWikidataRecordV1[];
  mappingCandidates: readonly KnowledgeWikidataMappingCandidateV1[];
  coverage: readonly KnowledgeWikidataCoverageV1[];
  omissions: readonly KnowledgeWikidataOmissionV1[];
  cursor: Readonly<{ kind: "retry-with-selection"; captureIndices: readonly number[] }> | null;
  previewSha256: Sha256Hex;
}>;

function failure<T>(field: string, code: "invalid-input" | "invalid-source" | "input-bound"
  | "integrity-mismatch" = "invalid-input"): KnowledgeWikidataImportResultV1<T> {
  return { ok: false, error: { code, field, retryable: false } };
}
function asJson(value: unknown): JsonValue { return value as JsonValue; }
function boundedText(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.length > 0 && utf8ByteLength(value) <= max
    && value.normalize("NFC") === value && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
}
export function isKnowledgeWikidataEntityIdV1(value: unknown): value is string {
  return typeof value === "string" && /^(?:Q[1-9][0-9]*|P[1-9][0-9]*|L[1-9][0-9]*(?:-[FS][1-9][0-9]*)?)$/u.test(value)
    && value.length <= 64;
}
function propertyId(value: unknown): value is string {
  return isKnowledgeWikidataEntityIdV1(value) && value.startsWith("P");
}
function properties(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > 256 || !value.every(propertyId)
    || new Set(value).size !== value.length) return null;
  return [...value].sort();
}
function parseCoverage(value: unknown): KnowledgeWikidataSourceCoverageV1 | null {
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
function parseCapture(value: unknown): KnowledgeWikidataCaptureInputV1 | null {
  if (!isPlainRecord(value) || !hasExactDataKeys(value,
    ["requestedId", "resolvedId", "sourceUri", "capturedAt", "body", "redirects", "coverage"])
    || !isKnowledgeWikidataEntityIdV1(value["requestedId"])
    || !isKnowledgeWikidataEntityIdV1(value["resolvedId"])
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
      || redirect["from"] !== last || !isKnowledgeWikidataEntityIdV1(redirect["to"])
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
export function parseKnowledgeWikidataImportInputV1(value: unknown): KnowledgeWikidataImportInputV1 | null {
  // Preserve captured string code points while stripping executable object/array behavior.
  value = knowledgeDeclarativeJson(value, 2 * KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxSourceBytes,
    { preserveStrings: true, maxDepth: 12 });
  if (!isPlainRecord(value) || !hasExactDataKeys(value,
    Object.hasOwn(value, "bounds") ? ["v", "captures", "properties", "mappingVersion", "bounds"]
      : ["v", "captures", "properties", "mappingVersion"])
    || value["v"] !== 1 || !boundedText(value["mappingVersion"])
    || !Array.isArray(value["captures"]) || value["captures"].length === 0
    || value["captures"].length > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxEntities) return null;
  const selected = properties(value["properties"]);
  const captures = value["captures"].map(parseCapture);
  if (selected === null || captures.some((capture) => capture === null)) return null;
  let bounds: KnowledgeWikidataImportBoundsV1 = KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1;
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
  return { v: 1, captures: captures as KnowledgeWikidataCaptureInputV1[],
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
    if (!isKnowledgeWikidataEntityIdV1(id)) return false;
    const expected = id.startsWith("Q") ? "item" : id.startsWith("P") ? "property"
      : id.includes("-F") ? "form" : id.includes("-S") ? "sense" : "lexeme";
    if (kind !== expected) return false;
    return numericId === undefined || (typeof numericId === "number"
      && Number.isSafeInteger(numericId) && numericId > 0
      && !id.includes("-") && id.slice(1) === String(numericId));
  }
  return (kind === "item" || kind === "property" || kind === "lexeme")
    && typeof numericId === "number" && Number.isSafeInteger(numericId) && numericId > 0;
}
function supportedDatavalue(datatype: string, datavalue: JsonRecord): boolean | null {
  const value = datavalue["value"];
  if (value === undefined) return false;
  const type = datavalue["type"];
  if (["wikibase-item", "wikibase-property", "wikibase-lexeme", "wikibase-form", "wikibase-sense"].includes(datatype)) {
    return type === "wikibase-entityid" && entityValue(value)
      && isJsonRecord(value) && datatype === `wikibase-${String(value["entity-type"])}`;
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
function preserveValue(raw: JsonRecord, selector: KnowledgeWikidataSelectorV1,
  captureSha256: Sha256Hex): KnowledgeWikidataPreservedValueV1 {
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

type Group = Readonly<{ entityId: string; propertyId: string; raw: JsonValue }>;
type Extracted = Readonly<{ metadata: readonly KnowledgeWikidataRecordV1[];
  groups: readonly Group[]; invalidMetadata: number }>;
function extract(entity: JsonRecord, captureSha256: Sha256Hex, selected: readonly string[]): Extracted {
  const metadata: KnowledgeWikidataRecordV1[] = [];
  const groups: Group[] = [];
  let invalidMetadata = 0;
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
    if (claims !== undefined) {
      if (!isJsonRecord(claims)) invalidMetadata += 1;
      else for (const id of Object.keys(claims).sort()) {
        if (propertyId(id) && claims[id] !== undefined) groups.push({ entityId, propertyId: id, raw: claims[id] });
        else invalidMetadata += 1;
      }
    }
    for (const id of selected) {
      if (!groups.some((group) => group.entityId === entityId && group.propertyId === id)) {
        groups.push({ entityId, propertyId: id, raw: claims === undefined || isJsonRecord(claims) ? [] : null });
      }
    }
    for (const field of ["forms", "senses"]) {
      const members = record[field];
      if (members === undefined) continue;
      if (!Array.isArray(members)) { invalidMetadata += 1; continue; }
      const seen = new Set<string>();
      members.forEach((member: JsonValue, index: number) => {
        if (!isJsonRecord(member) || !isKnowledgeWikidataEntityIdV1(member["id"])
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
function groupRecords(group: Group, captureSha256: Sha256Hex): readonly KnowledgeWikidataRecordV1[] | null {
  if (!Array.isArray(group.raw)) return null;
  const result: KnowledgeWikidataRecordV1[] = [];
  const ids = new Set<string>();
  for (let statementIndex = 0; statementIndex < group.raw.length; statementIndex += 1) {
    const statement: JsonValue | undefined = group.raw[statementIndex];
    if (!isJsonRecord(statement) || statement["type"] !== "statement"
      || !boundedText(statement["id"], 256) || !statement["id"].startsWith(`${group.entityId}$`)
      || ids.has(statement["id"]) || !isJsonRecord(statement["mainsnak"])
      || statement["mainsnak"]["property"] !== group.propertyId
      || !["normal", "preferred", "deprecated"].includes(String(statement["rank"]))) return null;
    ids.add(statement["id"]);
    const base = { kind: "statement" as const, entityId: group.entityId, propertyId: group.propertyId,
      statementId: statement["id"], statementIndex };
    result.push({ kind: "statement", captureSha256, raw: statement,
      selector: { ...base, location: { kind: "statement" } },
      rank: statement["rank"] as "normal" | "preferred" | "deprecated" });
    function addSnak(raw: JsonValue, location: Extract<KnowledgeWikidataSelectorV1,
      { kind: "statement" }>["location"]): boolean {
      if (!isJsonRecord(raw) || !propertyId(raw["property"])
        || !["value", "somevalue", "novalue"].includes(String(raw["snaktype"]))) return false;
      const selector: KnowledgeWikidataSelectorV1 = { ...base, location };
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

export async function createKnowledgeWikidataImportPreviewV1(
  foreign: unknown,
): Promise<KnowledgeWikidataImportResultV1<KnowledgeWikidataImportPreviewV1>> {
  const input = parseKnowledgeWikidataImportInputV1(foreign);
  if (input === null) return failure("input");
  // Hard input admission bounds apply before JSON parsing; smaller selected bounds yield a ledger.
  if (input.captures.some((capture) => capture.body.length > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxSourceBytes)
    || input.captures.reduce((sum, capture) => sum + utf8ByteLength(capture.body), 0)
      > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxSourceBytes) return failure("captures.body", "input-bound");
  const bounds = input.bounds ?? KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1;
  const sources: KnowledgeWikidataSourceReceiptV1[] = [];
  const records: KnowledgeWikidataRecordV1[] = [];
  const coverage: KnowledgeWikidataCoverageV1[] = [];
  const omissions: KnowledgeWikidataOmissionV1[] = [];
  const retry = new Set<number>();
  let sourceBytes = 0;
  let statements = 0;
  const seenCaptures = new Set<string>();
  for (let captureIndex = 0; captureIndex < input.captures.length; captureIndex += 1) {
    const capture = input.captures[captureIndex] as KnowledgeWikidataCaptureInputV1;
    const bytes = utf8ByteLength(capture.body);
    const omit = (entityId: string, propertyId: string | null,
      reason: KnowledgeWikidataOmissionV1["reason"], count: number): void => {
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
    const source: KnowledgeWikidataSourceReceiptV1 = { ...capture, captureSha256, sourceBytes: bytes,
      revision: entity["lastrevid"] as number, serialization: "wikibase-json-v1",
      provenanceStatus: "caller-asserted", license: { id: "CC0-1.0", scope: "wikidata-structured-data-only",
        uri: "https://creativecommons.org/publicdomain/zero/1.0/" } };
    sources.push(source);
    sourceBytes += bytes;
    const extracted = extract(entity, captureSha256, input.properties);
    if (extracted.invalidMetadata > 0) omit(capture.resolvedId, null, "invalid-metadata", extracted.invalidMetadata);
    if (records.length + extracted.metadata.length <= bounds.maxRecords) records.push(...extracted.metadata);
    else omit(capture.resolvedId, null, "record-bound", extracted.metadata.length);
    for (const group of extracted.groups) {
      const observedStatements = Array.isArray(group.raw) ? group.raw.length : 0;
      if (!input.properties.includes(group.propertyId)) {
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
  const mappingCandidates: KnowledgeWikidataMappingCandidateV1[] = records.flatMap((record) => {
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
  const payload = { v: 1 as const, kind: "wikidata-import-preview" as const, provider: "wikidata" as const,
    importerVersion: KNOWLEDGE_WIKIDATA_IMPORTER_V1 as typeof KNOWLEDGE_WIKIDATA_IMPORTER_V1, mappingVersion: input.mappingVersion,
    status: "unadmitted" as const, disclosure: "private" as const, identityResolution: "candidate-only" as const,
    properties: input.properties, bounds, sources, identityCandidates: sources.map((source) => ({
      requestedId: source.requestedId, resolvedId: source.resolvedId, revision: source.revision,
      captureSha256: source.captureSha256, redirects: source.redirects, localIdentity: null,
    })), records, mappingCandidates, coverage, omissions,
    cursor: retry.size === 0 ? null : { kind: "retry-with-selection" as const, captureIndices: [...retry] } };
  return { ok: true, value: { ...payload, previewSha256: await sha256Text(canonicalJson(asJson(payload))) } };
}

/** Canonical transport preserves raw captures as strings; it grants no admission or disclosure rights. */
export function canonicalKnowledgeWikidataImportPreviewV1(value: KnowledgeWikidataImportPreviewV1): string {
  return canonicalJson(asJson(value));
}

/** Rebuild from the original import request, including source bodies omitted by selected bounds. */
export async function verifyKnowledgeWikidataImportPreviewV1(
  foreign: unknown,
  input: unknown,
): Promise<KnowledgeWikidataImportResultV1<KnowledgeWikidataImportPreviewV1>> {
  const rebuilt = await createKnowledgeWikidataImportPreviewV1(input);
  if (!rebuilt.ok) return rebuilt;
  const parsed = knowledgeDeclarativeJson(foreign, 8 * KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxSourceBytes,
    { preserveStrings: true, maxDepth: 64, maxNodes: 1_000_000 });
  if (parsed === undefined || canonicalJson(parsed) !== canonicalKnowledgeWikidataImportPreviewV1(rebuilt.value)) {
    return failure("preview", "integrity-mismatch");
  }
  return rebuilt;
}
