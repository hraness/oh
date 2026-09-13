// src/research/document-domain.ts
function isRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isJsonArray(value) {
  return Array.isArray(value);
}
function parseJsonValue(value, limits = {}) {
  const maxDepth = limits.maxDepth ?? 64;
  const maxNodes = limits.maxNodes ?? 40000;
  let nodes = 0;
  function visit(candidate, depth) {
    nodes += 1;
    if (nodes > maxNodes || depth > maxDepth)
      return;
    if (candidate === null || typeof candidate === "boolean" || typeof candidate === "string") {
      return candidate;
    }
    if (typeof candidate === "number") {
      return Number.isFinite(candidate) ? candidate : undefined;
    }
    if (Array.isArray(candidate)) {
      const result = [];
      for (const item of candidate) {
        const parsed2 = visit(item, depth + 1);
        if (parsed2 === undefined)
          return;
        result.push(parsed2);
      }
      return result;
    }
    if (!isRecord(candidate))
      return;
    const entries = [];
    for (const key of Object.keys(candidate).sort()) {
      const parsed2 = visit(candidate[key], depth + 1);
      if (parsed2 === undefined)
        return;
      entries.push([key, parsed2]);
    }
    return Object.fromEntries(entries);
  }
  const parsed = visit(value, 0);
  return parsed === undefined ? { ok: false, error: "invalid-title" } : { ok: true, value: parsed };
}
function canonicalJson(value) {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value);
  if (isJsonArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

// src/research/integrity-domain.ts
var SPONGE_SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
var SPONGE_CANONICAL_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
var utf8 = new TextEncoder;
function compareUtf16CodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function parseSha256Hex(value) {
  return typeof value === "string" && SPONGE_SHA256_HEX_PATTERN.test(value) ? value : null;
}
function parseCanonicalInstantV1(value) {
  if (typeof value !== "string" || !SPONGE_CANONICAL_INSTANT_PATTERN.test(value))
    return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null;
}
function utf8ByteLength(value) {
  return utf8.encode(value).byteLength;
}
async function sha256Hex(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256Text(value) {
  return sha256Hex(utf8.encode(value));
}

// src/research/unknown.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isJsonRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function exactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function hasExactDataKeys(value, expectedKeys) {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string"))
    return false;
  const expected = new Set(expectedKeys);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!expected.has(key) || descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
      return false;
  }
  return true;
}

// src/research/knowledge-ontology-v1.ts
var SPONGE_KNOWLEDGE_LIMITS_V1 = Object.freeze({
  acceptedPurposes: 32,
  contexts: 128,
  dimensions: 64,
  evidence: 1024,
  extensionBytes: 64 * 1024,
  geometryPoints: 4096,
  listValues: 256,
  passages: 512,
  qualifiers: 128,
  references: 2048,
  statementBytes: 256 * 1024,
  textBytes: 64 * 1024
});
var SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1 = "public-encyclopedia";
var SPONGE_KNOWLEDGE_KERNEL_CONCEPTS_V1 = [
  {
    code: "entity",
    description: "A stable identity anchor for something that can be referred to.",
    label: "Entity"
  },
  {
    code: "statement",
    description: "An immutable proposition with a subject, predicate, object, and qualifiers.",
    label: "Statement"
  },
  {
    code: "assertion",
    description: "An attributable stance toward a statement for a particular purpose.",
    label: "Assertion"
  },
  {
    code: "evidence",
    description: "A typed account of how a source or observation bears on an assertion.",
    label: "Evidence"
  },
  {
    code: "context",
    description: "The time, place, language, perspective, or scenario in which knowledge applies.",
    label: "Context"
  },
  {
    code: "inquiry",
    description: "A human question and the durable trail of investigation it creates.",
    label: "Inquiry"
  },
  {
    code: "projection",
    description: "A reproducible view or immutable edition derived from exact knowledge and policy.",
    label: "Projection"
  }
];
function success(value) {
  return { ok: true, value };
}
function failure(field, code = "invalid-input") {
  return { error: { code, field }, ok: false };
}
function boundedText(value, maximumUtf8Bytes = SPONGE_KNOWLEDGE_LIMITS_V1.textBytes) {
  if (typeof value !== "string" || value.length === 0 || value.normalize("NFC") !== value || utf8ByteLength(value) > maximumUtf8Bytes)
    return null;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code >= 11 && code <= 12 || code >= 14 && code <= 31 || code >= 127 && code <= 159 || code >= 55296 && code <= 57343)
      return null;
  }
  return value;
}
function safeCode(value, maximumLength = 96) {
  return typeof value === "string" && value.length <= maximumLength && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function languageTag(value) {
  return typeof value === "string" && value.length <= 64 && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value) ? value : null;
}
function positiveInteger(value, allowZero = false) {
  return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= (allowZero ? 0 : 1) ? value : null;
}
function parseOpaqueId(value, prefix) {
  return typeof value === "string" && new RegExp(`^${prefix}[a-z0-9]{24}$`, "u").test(value) ? value : null;
}
function parseKnowledgeEntityId(value) {
  return parseOpaqueId(value, "kent_");
}
function parseKnowledgeAssertionId(value) {
  return parseOpaqueId(value, "kast_");
}
function parseKnowledgeEvidenceId(value) {
  return parseOpaqueId(value, "kevd_");
}
function parseKnowledgeInquiryId(value) {
  return parseOpaqueId(value, "kinq_");
}
function parseKnowledgeEditionId(value) {
  return parseOpaqueId(value, "kedn_");
}
var SPONGE_KNOWLEDGE_ENTITY_STATES_V1 = [
  "active",
  "quarantined",
  "redirected",
  "tombstoned"
];
function parseKnowledgeEntityV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "entityId",
    "identityOperationId",
    "identityRevision",
    "redirectEntityId",
    "state",
    "v"
  ]) || value["v"] !== 1)
    return failure("entity");
  const entityId = parseKnowledgeEntityId(value["entityId"]);
  const identityOperationId = safeCode(value["identityOperationId"], 128);
  const identityRevision = positiveInteger(value["identityRevision"]);
  const redirectEntityId = value["redirectEntityId"] === null ? null : parseKnowledgeEntityId(value["redirectEntityId"]);
  const state = SPONGE_KNOWLEDGE_ENTITY_STATES_V1.find((candidate) => candidate === value["state"]);
  return entityId !== null && identityOperationId !== null && identityRevision !== null && (value["redirectEntityId"] === null || redirectEntityId !== null) && state !== undefined && state === "redirected" === (redirectEntityId !== null) && redirectEntityId !== entityId ? success({
    entityId,
    identityOperationId,
    identityRevision,
    redirectEntityId,
    state,
    v: 1
  }) : failure("entity");
}
function asJson(value) {
  return value;
}
function canonicalKey(value) {
  return canonicalJson(asJson(value));
}
function isOrderedUnique(values, key = canonicalKey) {
  return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value));
}
function sortedUnique(values, key = canonicalKey) {
  const sorted = [...values].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (!isOrderedUnique(sorted, key))
    throw new Error("Duplicate canonical value.");
  return sorted;
}
function parseKnowledgeSchemaRefV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["code", "namespace", "revision", "schemaSha256", "v"]) || value["v"] !== 1)
    return failure("schemaRef");
  const code = safeCode(value["code"]);
  const namespace = safeCode(value["namespace"], 128);
  const revision = positiveInteger(value["revision"]);
  const schemaSha256 = parseSha256Hex(value["schemaSha256"]);
  return code !== null && namespace !== null && revision !== null && schemaSha256 !== null ? success({ code, namespace, revision, schemaSha256, v: 1 }) : failure("schemaRef");
}
var CANONICAL_INTEGER = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u;
var CANONICAL_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u;
function canonicalInteger(value) {
  return typeof value === "string" && value.length <= 1024 && CANONICAL_INTEGER.test(value) ? value : null;
}
function canonicalDecimal(value) {
  return typeof value === "string" && value.length <= 1024 && value !== "-0" && CANONICAL_DECIMAL.test(value) ? value : null;
}
function compareCanonicalDecimals(left, right) {
  const parts = (value) => {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [integer = "0", fraction = ""] = unsigned.split(".");
    return { fraction, integer, negative };
  };
  const leftParts = parts(left);
  const rightParts = parts(right);
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const scaled = (value) => {
    const digits = BigInt(`${value.integer}${value.fraction.padEnd(scale, "0")}`);
    return value.negative ? -digits : digits;
  };
  const leftScaled = scaled(leftParts);
  const rightScaled = scaled(rightParts);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}
function nonnegativeDecimal(value) {
  const parsed = canonicalDecimal(value);
  return parsed !== null && !parsed.startsWith("-") ? parsed : null;
}
function parseQuantityUncertainty(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["kind", "minus", "plus", "v"]) || value["v"] !== 1 || value["kind"] !== "absolute" && value["kind"] !== "relative")
    return null;
  const minus = nonnegativeDecimal(value["minus"]);
  const plus = nonnegativeDecimal(value["plus"]);
  return minus === null || plus === null ? null : { kind: value["kind"], minus, plus, v: 1 };
}
function temporalLexeme(value, precision) {
  if (typeof value !== "string" || value.length > 64)
    return null;
  const valid = precision === "year" ? /^-?(?:0|[1-9][0-9]{0,8})$/u.test(value) : precision === "month" ? /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])$/u.test(value) : precision === "day" ? /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/u.test(value) : precision === "minute" ? /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u.test(value) : precision === "second" ? /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/u.test(value) : /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}$/u.test(value);
  return valid ? value : null;
}
function parseTemporalValue(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "calendar",
    "certainty",
    "earliest",
    "kind",
    "latest",
    "precision",
    "timezone",
    "v",
    "value"
  ]) || value["kind"] !== "time" || value["v"] !== 1)
    return null;
  const precision = value["precision"];
  if (precision !== "year" && precision !== "month" && precision !== "day" && precision !== "minute" && precision !== "second" && precision !== "millisecond")
    return null;
  const calendar = parseKnowledgeSchemaRefV1(value["calendar"]);
  const certainty = value["certainty"];
  const temporal = temporalLexeme(value["value"], precision);
  const earliest = value["earliest"] === null ? null : temporalLexeme(value["earliest"], precision);
  const latest = value["latest"] === null ? null : temporalLexeme(value["latest"], precision);
  const timezone = value["timezone"] === null ? null : typeof value["timezone"] === "string" && /^(?:Z|[+-](?:0[0-9]|1[0-4]):[0-5][0-9])$/u.test(value["timezone"]) ? value["timezone"] : null;
  if (!calendar.ok || temporal === null || value["earliest"] !== null && earliest === null || value["latest"] !== null && latest === null || value["timezone"] !== null && timezone === null || timezone !== null && (precision === "year" || precision === "month" || precision === "day") || certainty !== "after" && certainty !== "approximate" && certainty !== "before" && certainty !== "between" && certainty !== "exact" || certainty === "exact" && (earliest !== null || latest !== null) || certainty === "before" && (earliest !== null || latest === null) || certainty === "after" && (earliest === null || latest !== null) || certainty === "between" && (earliest === null || latest === null) || earliest !== null && latest !== null && compareCanonicalTemporalLexemes(earliest, latest) > 0)
    return null;
  return {
    calendar: calendar.value,
    certainty,
    earliest,
    kind: "time",
    latest,
    precision,
    timezone,
    v: 1,
    value: temporal
  };
}
function compareCanonicalTemporalLexemes(left, right) {
  const normalize = (value) => {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const separator = unsigned.indexOf("-");
    const year = separator === -1 ? unsigned : unsigned.slice(0, separator);
    const rest = separator === -1 ? "" : unsigned.slice(separator);
    const paddedYear = year.padStart(9, "0");
    return `${negative ? "0" : "1"}:${negative ? paddedYear.split("").map((digit) => 9 - Number(digit)).join("") : paddedYear}${rest}`;
  };
  const leftKey = normalize(left);
  const rightKey = normalize(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
function canonicalDuration(value) {
  return typeof value === "string" && value.length <= 128 && /^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/u.test(value) ? value : null;
}
function canonicalRecurrenceRule(value) {
  if (typeof value !== "string" || value.length > 2048 || value.length === 0)
    return null;
  const parts = value.split(";");
  const keys = [];
  for (const part of parts) {
    const match = /^([A-Z][A-Z0-9_]*)=([A-Z0-9,+-]+)$/u.exec(part);
    if (match === null)
      return null;
    keys.push(match[1]);
  }
  return isOrderedUnique(keys, (item) => item) && keys.includes("FREQ") ? value : null;
}
function parseGeometryPoint(value) {
  if (!Array.isArray(value) || value.length !== 2 && value.length !== 3)
    return null;
  const coordinates = value.map(canonicalDecimal);
  if (coordinates.some((coordinate) => coordinate === null))
    return null;
  return coordinates;
}
function mediaType(value) {
  return typeof value === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value) ? value : null;
}
function canonicalUri(value) {
  if (typeof value !== "string" || value.length > 4096)
    return null;
  try {
    const uri = new URL(value);
    return uri.username === "" && uri.password === "" && uri.protocol !== "javascript:" && uri.protocol !== "data:" && uri.protocol !== "vbscript:" && uri.protocol !== "file:" && uri.href === value ? value : null;
  } catch {
    return null;
  }
}
function parseKnowledgeValueInternal(value, depth) {
  if (!isPlainRecord(value) || value["v"] !== 1 || depth > 8)
    return null;
  switch (value["kind"]) {
    case "entity": {
      if (!hasExactKeys(value, ["entityId", "kind", "v"]))
        return null;
      const entityId = parseKnowledgeEntityId(value["entityId"]);
      return entityId === null ? null : { entityId, kind: "entity", v: 1 };
    }
    case "text": {
      if (!hasExactKeys(value, ["kind", "language", "text", "v"]))
        return null;
      const language = languageTag(value["language"]);
      const text = boundedText(value["text"]);
      return language === null || text === null ? null : { kind: "text", language, text, v: 1 };
    }
    case "string": {
      const parsedValue = boundedText(value["value"]);
      return hasExactKeys(value, ["kind", "v", "value"]) && parsedValue !== null ? { kind: "string", v: 1, value: parsedValue } : null;
    }
    case "boolean":
      return hasExactKeys(value, ["kind", "v", "value"]) && typeof value["value"] === "boolean" ? { kind: "boolean", v: 1, value: value["value"] } : null;
    case "integer": {
      const integer = canonicalInteger(value["value"]);
      return hasExactKeys(value, ["kind", "v", "value"]) && integer !== null ? { kind: "integer", v: 1, value: integer } : null;
    }
    case "decimal": {
      const decimal = canonicalDecimal(value["value"]);
      return hasExactKeys(value, ["kind", "v", "value"]) && decimal !== null ? { kind: "decimal", v: 1, value: decimal } : null;
    }
    case "quantity": {
      if (!hasExactKeys(value, [
        "kind",
        "lowerBound",
        "uncertainty",
        "unit",
        "upperBound",
        "v",
        "value"
      ]))
        return null;
      const parsedValue = canonicalDecimal(value["value"]);
      const lowerBound = value["lowerBound"] === null ? null : canonicalDecimal(value["lowerBound"]);
      const upperBound = value["upperBound"] === null ? null : canonicalDecimal(value["upperBound"]);
      const uncertainty = value["uncertainty"] === null ? null : parseQuantityUncertainty(value["uncertainty"]);
      const unit = parseKnowledgeSchemaRefV1(value["unit"]);
      return parsedValue !== null && (value["lowerBound"] === null || lowerBound !== null) && (value["upperBound"] === null || upperBound !== null) && (value["uncertainty"] === null || uncertainty !== null) && (lowerBound === null || compareCanonicalDecimals(lowerBound, parsedValue) <= 0) && (upperBound === null || compareCanonicalDecimals(parsedValue, upperBound) <= 0) && unit.ok ? {
        kind: "quantity",
        lowerBound,
        uncertainty,
        unit: unit.value,
        upperBound,
        v: 1,
        value: parsedValue
      } : null;
    }
    case "time":
      return parseTemporalValue(value);
    case "interval": {
      if (!hasExactKeys(value, ["end", "kind", "start", "v"]))
        return null;
      const start = value["start"] === null ? null : parseTemporalValue(value["start"]);
      const end = value["end"] === null ? null : parseTemporalValue(value["end"]);
      return (value["start"] === null || start !== null) && (value["end"] === null || end !== null) && (start !== null || end !== null) && !(start !== null && end !== null && start.precision === end.precision && canonicalKey(start.calendar) === canonicalKey(end.calendar) && compareCanonicalTemporalLexemes(start.value, end.value) > 0) ? { end, kind: "interval", start, v: 1 } : null;
    }
    case "duration": {
      const iso8601 = canonicalDuration(value["iso8601"]);
      return hasExactKeys(value, ["iso8601", "kind", "v"]) && iso8601 !== null ? { iso8601, kind: "duration", v: 1 } : null;
    }
    case "recurrence": {
      if (!hasExactKeys(value, ["calendar", "kind", "rule", "startsAt", "v"])) {
        return null;
      }
      const calendar = parseKnowledgeSchemaRefV1(value["calendar"]);
      const rule = canonicalRecurrenceRule(value["rule"]);
      const startsAt = value["startsAt"] === null ? null : parseTemporalValue(value["startsAt"]);
      return calendar.ok && rule !== null && (value["startsAt"] === null || startsAt !== null) ? { calendar: calendar.value, kind: "recurrence", rule, startsAt, v: 1 } : null;
    }
    case "geometry": {
      if (!hasExactKeys(value, [
        "coordinates",
        "crs",
        "geometryType",
        "kind",
        "precisionMeters",
        "v"
      ]) || !Array.isArray(value["coordinates"]) || value["coordinates"].length > SPONGE_KNOWLEDGE_LIMITS_V1.geometryPoints) {
        return null;
      }
      const coordinates = value["coordinates"].map(parseGeometryPoint);
      const crs = parseKnowledgeSchemaRefV1(value["crs"]);
      const geometryType = value["geometryType"];
      const precisionMeters = value["precisionMeters"] === null ? null : nonnegativeDecimal(value["precisionMeters"]);
      if (!crs.ok || coordinates.some((point) => point === null) || value["precisionMeters"] !== null && precisionMeters === null || geometryType !== "point" && geometryType !== "line-string" && geometryType !== "polygon")
        return null;
      const points = coordinates;
      if (geometryType === "point" && points.length !== 1 || geometryType === "line-string" && points.length < 2 || geometryType === "polygon" && (points.length < 4 || canonicalKey(points[0]) !== canonicalKey(points.at(-1))))
        return null;
      return {
        coordinates: points,
        crs: crs.value,
        geometryType,
        kind: "geometry",
        precisionMeters,
        v: 1
      };
    }
    case "uri": {
      const uri = canonicalUri(value["uri"]);
      return hasExactKeys(value, ["kind", "uri", "v"]) && uri !== null ? { kind: "uri", uri, v: 1 } : null;
    }
    case "identifier": {
      if (!hasExactKeys(value, ["kind", "scheme", "v", "value"]))
        return null;
      const scheme = parseKnowledgeSchemaRefV1(value["scheme"]);
      const identifier = boundedText(value["value"], 4096);
      return scheme.ok && identifier !== null ? { kind: "identifier", scheme: scheme.value, v: 1, value: identifier } : null;
    }
    case "media": {
      if (!hasExactKeys(value, [
        "kind",
        "mediaType",
        "sourceEntityId",
        "sourceSha256",
        "v"
      ]))
        return null;
      const parsedMediaType = mediaType(value["mediaType"]);
      const sourceEntityId = parseKnowledgeEntityId(value["sourceEntityId"]);
      const sourceSha256 = parseSha256Hex(value["sourceSha256"]);
      return parsedMediaType !== null && sourceEntityId !== null && sourceSha256 !== null ? { kind: "media", mediaType: parsedMediaType, sourceEntityId, sourceSha256, v: 1 } : null;
    }
    case "list":
    case "set": {
      if (!hasExactKeys(value, ["kind", "v", "values"]) || !Array.isArray(value["values"]) || value["values"].length > SPONGE_KNOWLEDGE_LIMITS_V1.listValues)
        return null;
      const values = [];
      for (const child of value["values"]) {
        const parsed = parseKnowledgeValueInternal(child, depth + 1);
        if (parsed === null)
          return null;
        values.push(parsed);
      }
      if (value["kind"] === "set" && !isOrderedUnique(values))
        return null;
      return { kind: value["kind"], v: 1, values };
    }
    case "extension": {
      if (!hasExactKeys(value, [
        "canonicalizerSha256",
        "canonicalValue",
        "kind",
        "mediaType",
        "schema",
        "v",
        "valueSha256"
      ]))
        return null;
      const canonicalizerSha256 = parseSha256Hex(value["canonicalizerSha256"]);
      const canonicalValue = boundedText(value["canonicalValue"], SPONGE_KNOWLEDGE_LIMITS_V1.extensionBytes);
      const parsedMediaType = mediaType(value["mediaType"]);
      const schema = parseKnowledgeSchemaRefV1(value["schema"]);
      const valueSha256 = parseSha256Hex(value["valueSha256"]);
      return canonicalizerSha256 !== null && canonicalValue !== null && parsedMediaType !== null && schema.ok && valueSha256 !== null ? {
        canonicalizerSha256,
        canonicalValue,
        kind: "extension",
        mediaType: parsedMediaType,
        schema: schema.value,
        v: 1,
        valueSha256
      } : null;
    }
    default:
      return null;
  }
}
function parseKnowledgeValueV1(value) {
  const parsed = parseKnowledgeValueInternal(value, 0);
  return parsed === null ? failure("value") : success(parsed);
}
async function verifyKnowledgeValueV1(value) {
  const parsed = parseKnowledgeValueV1(value);
  if (!parsed.ok)
    return parsed;
  if (parsed.value.kind === "extension") {
    const expected = await sha256Text(parsed.value.canonicalValue);
    if (expected !== parsed.value.valueSha256) {
      return failure("valueSha256", "digest-mismatch");
    }
  }
  if (parsed.value.kind === "list" || parsed.value.kind === "set") {
    for (const child of parsed.value.values) {
      const verified = await verifyKnowledgeValueV1(child);
      if (!verified.ok)
        return verified;
    }
  }
  return success(parsed.value);
}
function parseDimension(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["predicate", "v", "value"]) || value["v"] !== 1)
    return null;
  const predicate = parseKnowledgeSchemaRefV1(value["predicate"]);
  const parsedValue = parseKnowledgeValueV1(value["value"]);
  return predicate.ok && parsedValue.ok ? { predicate: predicate.value, v: 1, value: parsedValue.value } : null;
}
var SPONGE_KNOWLEDGE_SCENARIOS_V1 = [
  "actual",
  "counterfactual",
  "hypothetical",
  "planned"
];
function parseContextInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["dimensions", "scenario", "v"]) || value["v"] !== 1 || !Array.isArray(value["dimensions"]))
    return failure("context");
  if (value["dimensions"].length > SPONGE_KNOWLEDGE_LIMITS_V1.dimensions) {
    return failure("dimensions", "limit-exceeded");
  }
  const scenario = SPONGE_KNOWLEDGE_SCENARIOS_V1.find((candidate) => candidate === value["scenario"]);
  const dimensions = [];
  for (const item of value["dimensions"]) {
    const parsed = parseDimension(item);
    if (parsed === null)
      return failure("dimensions");
    dimensions.push(parsed);
  }
  return scenario === undefined ? failure("scenario") : success({ dimensions, scenario, v: 1 });
}
async function createKnowledgeContextV1(input) {
  const parsed = parseContextInput(input);
  if (!parsed.ok)
    return parsed;
  for (const dimension of parsed.value.dimensions) {
    const verified = await verifyKnowledgeValueV1(dimension.value);
    if (!verified.ok)
      return failure(verified.error.field, verified.error.code);
  }
  let dimensions;
  try {
    dimensions = sortedUnique(parsed.value.dimensions);
  } catch {
    return failure("dimensions", "noncanonical-input");
  }
  const payload = { ...parsed.value, dimensions };
  return success({
    ...payload,
    contextSha256: await sha256Text(canonicalKey(payload))
  });
}
async function parseKnowledgeContextV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "contextSha256",
    "dimensions",
    "scenario",
    "v"
  ]))
    return failure("context");
  const contextSha256 = parseSha256Hex(value["contextSha256"]);
  const input = parseContextInput({
    dimensions: value["dimensions"],
    scenario: value["scenario"],
    v: value["v"]
  });
  if (contextSha256 === null || !input.ok)
    return failure("context");
  if (!isOrderedUnique(input.value.dimensions)) {
    return failure("dimensions", "noncanonical-input");
  }
  for (const dimension of input.value.dimensions) {
    const verified = await verifyKnowledgeValueV1(dimension.value);
    if (!verified.ok)
      return failure(verified.error.field, verified.error.code);
  }
  const expected = await sha256Text(canonicalKey(input.value));
  return expected === contextSha256 ? success({ ...input.value, contextSha256 }) : failure("contextSha256", "digest-mismatch");
}
function parseStatementInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "object",
    "predicate",
    "qualifiers",
    "subject",
    "v"
  ]) || value["v"] !== 1 || !Array.isArray(value["qualifiers"])) {
    return failure("statement");
  }
  if (value["qualifiers"].length > SPONGE_KNOWLEDGE_LIMITS_V1.qualifiers) {
    return failure("qualifiers", "limit-exceeded");
  }
  const object = parseKnowledgeValueV1(value["object"]);
  const predicate = parseKnowledgeSchemaRefV1(value["predicate"]);
  const subject = parseKnowledgeEntityId(value["subject"]);
  const qualifiers = [];
  for (const item of value["qualifiers"]) {
    const parsed = parseDimension(item);
    if (parsed === null)
      return failure("qualifiers");
    qualifiers.push(parsed);
  }
  return object.ok && predicate.ok && subject !== null ? success({ object: object.value, predicate: predicate.value, qualifiers, subject, v: 1 }) : failure("statement");
}
async function createKnowledgeStatementV1(input) {
  const parsed = parseStatementInput(input);
  if (!parsed.ok)
    return parsed;
  const verifiedObject = await verifyKnowledgeValueV1(parsed.value.object);
  if (!verifiedObject.ok) {
    return failure(verifiedObject.error.field, verifiedObject.error.code);
  }
  for (const qualifier of parsed.value.qualifiers) {
    const verified = await verifyKnowledgeValueV1(qualifier.value);
    if (!verified.ok)
      return failure(verified.error.field, verified.error.code);
  }
  let qualifiers;
  try {
    qualifiers = sortedUnique(parsed.value.qualifiers);
  } catch {
    return failure("qualifiers", "noncanonical-input");
  }
  const payload = { ...parsed.value, qualifiers };
  const encoded = canonicalKey(payload);
  if (utf8ByteLength(encoded) > SPONGE_KNOWLEDGE_LIMITS_V1.statementBytes) {
    return failure("statement", "limit-exceeded");
  }
  return success({ ...payload, statementSha256: await sha256Text(encoded) });
}
async function parseKnowledgeStatementV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "object",
    "predicate",
    "qualifiers",
    "statementSha256",
    "subject",
    "v"
  ]))
    return failure("statement");
  const statementSha256 = parseSha256Hex(value["statementSha256"]);
  const input = parseStatementInput({
    object: value["object"],
    predicate: value["predicate"],
    qualifiers: value["qualifiers"],
    subject: value["subject"],
    v: value["v"]
  });
  if (statementSha256 === null || !input.ok)
    return failure("statement");
  if (!isOrderedUnique(input.value.qualifiers)) {
    return failure("qualifiers", "noncanonical-input");
  }
  const verifiedValue = await verifyKnowledgeValueV1(input.value.object);
  if (!verifiedValue.ok)
    return verifiedValue;
  for (const qualifier of input.value.qualifiers) {
    const verified = await verifyKnowledgeValueV1(qualifier.value);
    if (!verified.ok)
      return failure(verified.error.field, verified.error.code);
  }
  const expected = await sha256Text(canonicalKey(input.value));
  return expected === statementSha256 ? success({ ...input.value, statementSha256 }) : failure("statementSha256", "digest-mismatch");
}
function parseAgentRef(value) {
  if (!isPlainRecord(value) || value["v"] !== 1)
    return null;
  if (value["kind"] === "entity" && hasExactKeys(value, ["entityId", "kind", "v"])) {
    const entityId = parseKnowledgeEntityId(value["entityId"]);
    return entityId === null ? null : { entityId, kind: "entity", v: 1 };
  }
  if (value["kind"] === "model" && hasExactKeys(value, [
    "kind",
    "model",
    "receiptSha256",
    "v"
  ])) {
    const model = parseKnowledgeSchemaRefV1(value["model"]);
    const receiptSha256 = parseSha256Hex(value["receiptSha256"]);
    return model.ok && receiptSha256 !== null ? { kind: "model", model: model.value, receiptSha256, v: 1 } : null;
  }
  if (value["kind"] === "system" && hasExactKeys(value, [
    "authority",
    "kind",
    "receiptSha256",
    "v"
  ])) {
    const authority = parseKnowledgeSchemaRefV1(value["authority"]);
    const receiptSha256 = parseSha256Hex(value["receiptSha256"]);
    return authority.ok && receiptSha256 !== null ? { authority: authority.value, kind: "system", receiptSha256, v: 1 } : null;
  }
  return null;
}
var SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1 = [
  "extraction",
  "human-entry",
  "human-review",
  "import",
  "model-proposal",
  "normalization",
  "publication",
  "resolution",
  "transformation"
];
function parseActivityInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "actor",
    "inputSha256s",
    "kind",
    "occurredAt",
    "outputSha256s",
    "policySha256",
    "tool",
    "v"
  ]) || value["v"] !== 1)
    return failure("activity");
  const actor = parseAgentRef(value["actor"]);
  const inputSha256s = parseShaArray(value["inputSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const kind = SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1.find((candidate) => candidate === value["kind"]);
  const occurredAt = parseCanonicalInstantV1(value["occurredAt"]);
  const outputSha256s = parseShaArray(value["outputSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const policySha256 = parseSha256Hex(value["policySha256"]);
  const tool = value["tool"] === null ? null : parseKnowledgeSchemaRefV1(value["tool"]);
  const toolValue = tool === null ? null : tool.ok ? tool.value : null;
  return actor !== null && inputSha256s !== null && kind !== undefined && occurredAt !== null && outputSha256s !== null && policySha256 !== null && (value["tool"] === null || toolValue !== null) ? success({
    actor,
    inputSha256s,
    kind,
    occurredAt,
    outputSha256s,
    policySha256,
    tool: toolValue,
    v: 1
  }) : failure("activity");
}
async function createKnowledgeActivityV1(input) {
  const parsed = parseActivityInput(input);
  return parsed.ok ? success({ ...parsed.value, activitySha256: await sha256Text(canonicalKey(parsed.value)) }) : parsed;
}
async function parseKnowledgeActivityV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "activitySha256")) {
    return failure("activity");
  }
  const activitySha256 = parseSha256Hex(value["activitySha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "activitySha256"));
  const parsed = parseActivityInput(input);
  if (activitySha256 === null || !parsed.ok)
    return failure("activity");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === activitySha256 ? success({ ...parsed.value, activitySha256 }) : failure("activitySha256", "digest-mismatch");
}
var SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1 = [
  "questions",
  "refutes",
  "reports",
  "supports",
  "undetermined"
];
var SPONGE_KNOWLEDGE_ASSERTION_STATES_V1 = [
  "accepted-for-purpose",
  "disputed",
  "proposed",
  "reviewed",
  "superseded",
  "withdrawn"
];
function parseStringCodes(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum)
    return null;
  const parsed = value.map((item) => safeCode(item));
  if (parsed.some((item) => item === null))
    return null;
  const codes = parsed;
  return isOrderedUnique(codes, (item) => item) ? codes : null;
}
function parseAssertionInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "acceptedPurposes",
    "assertionId",
    "assertor",
    "confidence",
    "contextSha256",
    "provenanceActivitySha256",
    "reviewActivitySha256",
    "stance",
    "state",
    "statementSha256",
    "v"
  ]) || value["v"] !== 1)
    return failure("assertion");
  const acceptedPurposes = parseStringCodes(value["acceptedPurposes"], SPONGE_KNOWLEDGE_LIMITS_V1.acceptedPurposes);
  const assertionId = parseKnowledgeAssertionId(value["assertionId"]);
  const assertor = parseAgentRef(value["assertor"]);
  const confidence = value["confidence"] === null ? null : parseKnowledgeSchemaRefV1(value["confidence"]);
  const confidenceValue = confidence === null ? null : confidence.ok ? confidence.value : null;
  const contextSha256 = value["contextSha256"] === null ? null : parseSha256Hex(value["contextSha256"]);
  const provenanceActivitySha256 = parseSha256Hex(value["provenanceActivitySha256"]);
  const reviewActivitySha256 = value["reviewActivitySha256"] === null ? null : parseSha256Hex(value["reviewActivitySha256"]);
  const stance = SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1.find((candidate) => candidate === value["stance"]);
  const state = SPONGE_KNOWLEDGE_ASSERTION_STATES_V1.find((candidate) => candidate === value["state"]);
  const statementSha256 = parseSha256Hex(value["statementSha256"]);
  if (acceptedPurposes === null || assertionId === null || assertor === null || value["confidence"] !== null && confidenceValue === null || value["contextSha256"] !== null && contextSha256 === null || provenanceActivitySha256 === null || value["reviewActivitySha256"] !== null && reviewActivitySha256 === null || stance === undefined || state === undefined || statementSha256 === null)
    return failure("assertion");
  if (assertor.kind === "model" && (state !== "proposed" || acceptedPurposes.length !== 0 || reviewActivitySha256 !== null))
    return failure("assertor", "authority-violation");
  if (state === "accepted-for-purpose" !== acceptedPurposes.length > 0 || state !== "proposed" && reviewActivitySha256 === null)
    return failure("state", "authority-violation");
  return success({
    acceptedPurposes,
    assertionId,
    assertor,
    confidence: confidenceValue,
    contextSha256,
    provenanceActivitySha256,
    reviewActivitySha256,
    stance,
    state,
    statementSha256,
    v: 1
  });
}
async function createKnowledgeAssertionV1(input) {
  const parsed = parseAssertionInput(input);
  return parsed.ok ? success({ ...parsed.value, assertionSha256: await sha256Text(canonicalKey(parsed.value)) }) : parsed;
}
async function parseKnowledgeAssertionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "assertionSha256")) {
    return failure("assertion");
  }
  const assertionSha256 = parseSha256Hex(value["assertionSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "assertionSha256"));
  const parsed = parseAssertionInput(input);
  if (assertionSha256 === null || !parsed.ok)
    return failure("assertion");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === assertionSha256 ? success({ ...parsed.value, assertionSha256 }) : failure("assertionSha256", "digest-mismatch");
}
var SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1 = [
  "background",
  "contradicts",
  "corroborates",
  "direct-observation",
  "method",
  "quotation",
  "registry-record",
  "supports"
];
function parseEvidenceInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "assertionSha256",
    "bearing",
    "disclosure",
    "evidenceId",
    "observationSha256",
    "provenanceActivitySha256",
    "selector",
    "sourceEntityId",
    "v"
  ]) || value["v"] !== 1)
    return failure("evidence");
  const assertionSha256 = parseSha256Hex(value["assertionSha256"]);
  const bearing = SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1.find((candidate) => candidate === value["bearing"]);
  const disclosure = value["disclosure"];
  const evidenceId = parseKnowledgeEvidenceId(value["evidenceId"]);
  const observationSha256 = value["observationSha256"] === null ? null : parseSha256Hex(value["observationSha256"]);
  const provenanceActivitySha256 = parseSha256Hex(value["provenanceActivitySha256"]);
  const selector = value["selector"] === null ? null : boundedText(value["selector"], 8192);
  const sourceEntityId = value["sourceEntityId"] === null ? null : parseKnowledgeEntityId(value["sourceEntityId"]);
  return assertionSha256 !== null && bearing !== undefined && (disclosure === "private" || disclosure === "public" || disclosure === "shared") && evidenceId !== null && (value["observationSha256"] === null || observationSha256 !== null) && provenanceActivitySha256 !== null && (value["selector"] === null || selector !== null) && (value["sourceEntityId"] === null || sourceEntityId !== null) && (observationSha256 !== null || sourceEntityId !== null) ? success({
    assertionSha256,
    bearing,
    disclosure,
    evidenceId,
    observationSha256,
    provenanceActivitySha256,
    selector,
    sourceEntityId,
    v: 1
  }) : failure("evidence");
}
async function createKnowledgeEvidenceLinkV1(input) {
  const parsed = parseEvidenceInput(input);
  return parsed.ok ? success({ ...parsed.value, evidenceSha256: await sha256Text(canonicalKey(parsed.value)) }) : parsed;
}
async function parseKnowledgeEvidenceLinkV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "evidenceSha256")) {
    return failure("evidence");
  }
  const evidenceSha256 = parseSha256Hex(value["evidenceSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "evidenceSha256"));
  const parsed = parseEvidenceInput(input);
  if (evidenceSha256 === null || !parsed.ok)
    return failure("evidence");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === evidenceSha256 ? success({ ...parsed.value, evidenceSha256 }) : failure("evidenceSha256", "digest-mismatch");
}
var inquiryRequiredKeys = [
  "answerForm",
  "authorEntityId",
  "contextSha256",
  "createdAt",
  "inquiryId",
  "language",
  "parentInquiryIds",
  "privacy",
  "question",
  "status",
  "v"
];
function parseInquiryInput(value) {
  if (!isPlainRecord(value))
    return failure("inquiry");
  const hasParentEdition = Object.hasOwn(value, "parentEditionId");
  if (!hasExactKeys(value, hasParentEdition ? [...inquiryRequiredKeys, "parentEditionId"] : inquiryRequiredKeys) || value["v"] !== 1 || !Array.isArray(value["parentInquiryIds"])) {
    return failure("inquiry");
  }
  const answerForm = safeCode(value["answerForm"]);
  const authorEntityId = parseKnowledgeEntityId(value["authorEntityId"]);
  const contextSha256 = value["contextSha256"] === null ? null : parseSha256Hex(value["contextSha256"]);
  const createdAt = parseCanonicalInstantV1(value["createdAt"]);
  const inquiryId = parseKnowledgeInquiryId(value["inquiryId"]);
  const language = languageTag(value["language"]);
  const parentEditionId = hasParentEdition && value["parentEditionId"] !== null ? parseKnowledgeEditionId(value["parentEditionId"]) : null;
  const parentInquiryIds = value["parentInquiryIds"].map(parseKnowledgeInquiryId);
  const privacy = value["privacy"];
  const question = boundedText(value["question"], 16384);
  const status = value["status"];
  return answerForm !== null && authorEntityId !== null && (value["contextSha256"] === null || contextSha256 !== null) && createdAt !== null && inquiryId !== null && language !== null && (!hasParentEdition || value["parentEditionId"] === null || parentEditionId !== null) && parentInquiryIds.every((item) => item !== null) && isOrderedUnique(parentInquiryIds, (item) => item) && (privacy === "private" || privacy === "public" || privacy === "shared") && question !== null && (status === "abandoned" || status === "open" || status === "paused" || status === "resolved") ? success({
    answerForm,
    authorEntityId,
    contextSha256,
    createdAt,
    inquiryId,
    language,
    parentEditionId,
    parentInquiryIds,
    privacy,
    question,
    status,
    v: 1
  }) : failure("inquiry");
}
function inquiryDigestInput(input) {
  const { parentEditionId, ...rest } = input;
  return parentEditionId === null ? rest : input;
}
async function createKnowledgeInquiryV1(input) {
  const parsed = parseInquiryInput(input);
  return parsed.ok ? success({
    ...parsed.value,
    inquirySha256: await sha256Text(canonicalKey(inquiryDigestInput(parsed.value)))
  }) : parsed;
}
async function parseKnowledgeInquiryV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "inquirySha256")) {
    return failure("inquiry");
  }
  const inquirySha256 = parseSha256Hex(value["inquirySha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "inquirySha256"));
  const parsed = parseInquiryInput(input);
  if (inquirySha256 === null || !parsed.ok)
    return failure("inquiry");
  const expected = await sha256Text(canonicalKey(inquiryDigestInput(parsed.value)));
  return expected === inquirySha256 ? success({ ...parsed.value, inquirySha256 }) : failure("inquirySha256", "digest-mismatch");
}
function schemaRefs(value) {
  if (!Array.isArray(value) || value.length > 512)
    return null;
  const parsed = [];
  for (const item of value) {
    const ref = parseKnowledgeSchemaRefV1(item);
    if (!ref.ok)
      return null;
    parsed.push(ref.value);
  }
  return isOrderedUnique(parsed) ? parsed : null;
}
function parseShapeInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "allowedPredicates",
    "extends",
    "requiredEvidenceBearings",
    "requiredPredicates",
    "shape",
    "v"
  ]) || value["v"] !== 1)
    return failure("shape");
  const allowedPredicates = value["allowedPredicates"] === null ? null : schemaRefs(value["allowedPredicates"]);
  const extended = schemaRefs(value["extends"]);
  const requiredEvidenceBearings = Array.isArray(value["requiredEvidenceBearings"]) ? value["requiredEvidenceBearings"].filter((item) => SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1.some((candidate) => candidate === item)) : [];
  const requiredPredicates = schemaRefs(value["requiredPredicates"]);
  const shape = parseKnowledgeSchemaRefV1(value["shape"]);
  if (value["allowedPredicates"] !== null && allowedPredicates === null || extended === null || requiredPredicates === null || !shape.ok || !Array.isArray(value["requiredEvidenceBearings"]) || requiredEvidenceBearings.length !== value["requiredEvidenceBearings"].length || !isOrderedUnique(requiredEvidenceBearings, (item) => item))
    return failure("shape");
  if (allowedPredicates !== null) {
    const allowed = new Set(allowedPredicates.map(canonicalKey));
    if (requiredPredicates.some((predicate) => !allowed.has(canonicalKey(predicate)))) {
      return failure("requiredPredicates", "authority-violation");
    }
  }
  return success({
    allowedPredicates,
    extends: extended,
    requiredEvidenceBearings,
    requiredPredicates,
    shape: shape.value,
    v: 1
  });
}
async function createKnowledgeShapeV1(input) {
  const parsed = parseShapeInput(input);
  return parsed.ok ? success({ ...parsed.value, shapeSha256: await sha256Text(canonicalKey(parsed.value)) }) : parsed;
}
async function parseKnowledgeShapeV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "shapeSha256")) {
    return failure("shape");
  }
  const shapeSha256 = parseSha256Hex(value["shapeSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "shapeSha256"));
  const parsed = parseShapeInput(input);
  if (shapeSha256 === null || !parsed.ok)
    return failure("shape");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === shapeSha256 ? success({ ...parsed.value, shapeSha256 }) : failure("shapeSha256", "digest-mismatch");
}
function parseShaArray(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum)
    return null;
  const parsed = value.map(parseSha256Hex);
  return parsed.every((item) => item !== null) && isOrderedUnique(parsed, (item) => item) ? parsed : null;
}
function parseViewSpecInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "audience",
    "budgets",
    "excludedContextSha256s",
    "includedContextSha256s",
    "language",
    "policySha256s",
    "root",
    "shapes",
    "v",
    "viewForm",
    "vocabularies"
  ]) || value["v"] !== 1 || !isPlainRecord(value["budgets"]) || !isPlainRecord(value["policySha256s"]) || !isPlainRecord(value["root"])) {
    return failure("viewSpec");
  }
  const audience = safeCode(value["audience"]);
  const budgets = value["budgets"];
  const parsedBudgets = hasExactKeys(budgets, ["bytes", "depth", "sources"]) ? {
    bytes: positiveInteger(budgets["bytes"]),
    depth: positiveInteger(budgets["depth"]),
    sources: positiveInteger(budgets["sources"])
  } : null;
  const excludedContextSha256s = parseShaArray(value["excludedContextSha256s"], 512);
  const includedContextSha256s = parseShaArray(value["includedContextSha256s"], 512);
  const language = languageTag(value["language"]);
  const policies = value["policySha256s"];
  const policySha256s = hasExactKeys(policies, ["dispute", "evidence", "rights", "traversal"]) ? {
    dispute: parseSha256Hex(policies["dispute"]),
    evidence: parseSha256Hex(policies["evidence"]),
    rights: parseSha256Hex(policies["rights"]),
    traversal: parseSha256Hex(policies["traversal"])
  } : null;
  const root = value["root"];
  const parsedRoot = root["kind"] === "entity" && hasExactKeys(root, ["entityId", "kind"]) ? (() => {
    const entityId = parseKnowledgeEntityId(root["entityId"]);
    return entityId === null ? null : { entityId, kind: "entity" };
  })() : root["kind"] === "inquiry" && hasExactKeys(root, ["inquiryId", "kind"]) ? (() => {
    const inquiryId = parseKnowledgeInquiryId(root["inquiryId"]);
    return inquiryId === null ? null : { inquiryId, kind: "inquiry" };
  })() : null;
  const shapes = schemaRefs(value["shapes"]);
  const viewForm = safeCode(value["viewForm"]);
  const vocabularies = schemaRefs(value["vocabularies"]);
  return audience !== null && parsedBudgets !== null && parsedBudgets.bytes !== null && parsedBudgets.depth !== null && parsedBudgets.sources !== null && excludedContextSha256s !== null && includedContextSha256s !== null && language !== null && policySha256s !== null && policySha256s.dispute !== null && policySha256s.evidence !== null && policySha256s.rights !== null && policySha256s.traversal !== null && parsedRoot !== null && shapes !== null && viewForm !== null && vocabularies !== null ? success({
    audience,
    budgets: parsedBudgets,
    excludedContextSha256s,
    includedContextSha256s,
    language,
    policySha256s,
    root: parsedRoot,
    shapes,
    v: 1,
    viewForm,
    vocabularies
  }) : failure("viewSpec");
}
async function createKnowledgeViewSpecV1(input) {
  const parsed = parseViewSpecInput(input);
  return parsed.ok ? success({ ...parsed.value, viewSpecSha256: await sha256Text(canonicalKey(parsed.value)) }) : parsed;
}
async function parseKnowledgeViewSpecV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "viewSpecSha256")) {
    return failure("viewSpec");
  }
  const viewSpecSha256 = parseSha256Hex(value["viewSpecSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "viewSpecSha256"));
  const parsed = parseViewSpecInput(input);
  if (viewSpecSha256 === null || !parsed.ok)
    return failure("viewSpec");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === viewSpecSha256 ? success({ ...parsed.value, viewSpecSha256 }) : failure("viewSpecSha256", "digest-mismatch");
}
function parsePassage(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "authorship",
    "supportStatementSha256s",
    "text",
    "v"
  ]) || value["v"] !== 1)
    return null;
  const authorship = value["authorship"];
  const supportStatementSha256s = parseShaArray(value["supportStatementSha256s"], 512);
  const text = boundedText(value["text"]);
  return (authorship === "human" || authorship === "model") && supportStatementSha256s !== null && text !== null ? { authorship, supportStatementSha256s, text, v: 1 } : null;
}
function parseCandidateInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "assertionSha256s",
    "canonicalOutputSha256",
    "editionId",
    "evidenceSha256s",
    "generationReceiptSha256",
    "identityReceiptSha256",
    "inputGraphRevisionSha256",
    "passages",
    "purpose",
    "rightsReceiptSha256",
    "statementSha256s",
    "unresolvedStatementSha256s",
    "v",
    "viewSpecSha256"
  ]) || value["v"] !== 1 || !Array.isArray(value["passages"]))
    return failure("candidate");
  const assertionSha256s = parseShaArray(value["assertionSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const canonicalOutputSha256 = parseSha256Hex(value["canonicalOutputSha256"]);
  const editionId = parseKnowledgeEditionId(value["editionId"]);
  const evidenceSha256s = parseShaArray(value["evidenceSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.evidence);
  const generationReceiptSha256 = value["generationReceiptSha256"] === null ? null : parseSha256Hex(value["generationReceiptSha256"]);
  const identityReceiptSha256 = parseSha256Hex(value["identityReceiptSha256"]);
  const inputGraphRevisionSha256 = parseSha256Hex(value["inputGraphRevisionSha256"]);
  const passages = value["passages"].map(parsePassage);
  const rightsReceiptSha256 = parseSha256Hex(value["rightsReceiptSha256"]);
  const statementSha256s = parseShaArray(value["statementSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const unresolvedStatementSha256s = parseShaArray(value["unresolvedStatementSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const viewSpecSha256 = parseSha256Hex(value["viewSpecSha256"]);
  const parsedPassages = passages;
  return assertionSha256s !== null && canonicalOutputSha256 !== null && editionId !== null && evidenceSha256s !== null && (value["generationReceiptSha256"] === null || generationReceiptSha256 !== null) && identityReceiptSha256 !== null && inputGraphRevisionSha256 !== null && passages.length <= SPONGE_KNOWLEDGE_LIMITS_V1.passages && passages.length > 0 && passages.every((passage) => passage !== null) && value["purpose"] === SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1 && rightsReceiptSha256 !== null && statementSha256s !== null && unresolvedStatementSha256s !== null && viewSpecSha256 !== null && parsedPassages.every((passage) => passage !== null && passage.supportStatementSha256s.length > 0 && passage.supportStatementSha256s.every((sha256) => statementSha256s.includes(sha256))) && unresolvedStatementSha256s.every((sha256) => statementSha256s.includes(sha256)) && parsedPassages.some((passage) => passage?.authorship === "model") === (generationReceiptSha256 !== null) ? success({
    assertionSha256s,
    canonicalOutputSha256,
    editionId,
    evidenceSha256s,
    generationReceiptSha256,
    identityReceiptSha256,
    inputGraphRevisionSha256,
    passages,
    purpose: SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1,
    rightsReceiptSha256,
    statementSha256s,
    unresolvedStatementSha256s,
    v: 1,
    viewSpecSha256
  }) : failure("candidate");
}
async function createKnowledgeSynthesisCandidateV1(input) {
  const parsed = parseCandidateInput(input);
  return parsed.ok ? success({ ...parsed.value, candidateSha256: await sha256Text(canonicalKey(parsed.value)) }) : parsed;
}
async function parseKnowledgeSynthesisCandidateV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "candidateSha256")) {
    return failure("candidate");
  }
  const candidateSha256 = parseSha256Hex(value["candidateSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "candidateSha256"));
  const parsed = parseCandidateInput(input);
  if (candidateSha256 === null || !parsed.ok)
    return failure("candidate");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === candidateSha256 ? success({ ...parsed.value, candidateSha256 }) : failure("candidateSha256", "digest-mismatch");
}
function parseHumanReviewReceiptInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "candidateSha256",
    "decisionSha256",
    "outcome",
    "policySha256",
    "purpose",
    "reviewedAt",
    "reviewerEntityId",
    "v"
  ]) || value["v"] !== 1)
    return failure("humanReviewReceipt");
  const candidateSha256 = parseSha256Hex(value["candidateSha256"]);
  const decisionSha256 = parseSha256Hex(value["decisionSha256"]);
  const policySha256 = parseSha256Hex(value["policySha256"]);
  const reviewedAt = parseCanonicalInstantV1(value["reviewedAt"]);
  const reviewerEntityId = parseKnowledgeEntityId(value["reviewerEntityId"]);
  return candidateSha256 !== null && decisionSha256 !== null && value["outcome"] === "accept" && policySha256 !== null && value["purpose"] === SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1 && reviewedAt !== null && reviewerEntityId !== null ? success({
    candidateSha256,
    decisionSha256,
    outcome: "accept",
    policySha256,
    purpose: SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1,
    reviewedAt,
    reviewerEntityId,
    v: 1
  }) : failure("humanReviewReceipt");
}
async function createKnowledgeHumanReviewReceiptV1(input) {
  const parsed = parseHumanReviewReceiptInput(input);
  return parsed.ok ? success({ ...parsed.value, receiptSha256: await sha256Text(canonicalKey(parsed.value)) }) : parsed;
}
async function parseKnowledgeHumanReviewReceiptV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "receiptSha256")) {
    return failure("humanReviewReceipt");
  }
  const receiptSha256 = parseSha256Hex(value["receiptSha256"]);
  const parsed = parseHumanReviewReceiptInput(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "receiptSha256")));
  if (receiptSha256 === null || !parsed.ok)
    return failure("humanReviewReceipt");
  return await sha256Text(canonicalKey(parsed.value)) === receiptSha256 ? success({ ...parsed.value, receiptSha256 }) : failure("receiptSha256", "digest-mismatch");
}
function parseEditionInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "candidateSha256",
    "dependencyManifestSha256",
    "editionId",
    "humanReviewReceiptSha256",
    "inputGraphRevisionSha256",
    "purpose",
    "reviewDecisionSha256",
    "v"
  ]) || value["v"] !== 1)
    return failure("edition");
  const candidateSha256 = parseSha256Hex(value["candidateSha256"]);
  const dependencyManifestSha256 = parseSha256Hex(value["dependencyManifestSha256"]);
  const editionId = parseKnowledgeEditionId(value["editionId"]);
  const humanReviewReceiptSha256 = parseSha256Hex(value["humanReviewReceiptSha256"]);
  const inputGraphRevisionSha256 = parseSha256Hex(value["inputGraphRevisionSha256"]);
  const reviewDecisionSha256 = parseSha256Hex(value["reviewDecisionSha256"]);
  return candidateSha256 !== null && dependencyManifestSha256 !== null && editionId !== null && humanReviewReceiptSha256 !== null && inputGraphRevisionSha256 !== null && value["purpose"] === SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1 && reviewDecisionSha256 !== null ? success({
    candidateSha256,
    dependencyManifestSha256,
    editionId,
    humanReviewReceiptSha256,
    inputGraphRevisionSha256,
    purpose: SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1,
    reviewDecisionSha256,
    v: 1
  }) : failure("edition");
}
async function createKnowledgeEditionV1(input) {
  const parsed = parseEditionInput(input);
  return parsed.ok ? success({ ...parsed.value, editionSha256: await sha256Text(canonicalKey(parsed.value)) }) : parsed;
}
async function parseKnowledgeEditionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "editionSha256")) {
    return failure("edition");
  }
  const editionSha256 = parseSha256Hex(value["editionSha256"]);
  const parsed = parseEditionInput(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "editionSha256")));
  if (editionSha256 === null || !parsed.ok)
    return failure("edition");
  return await sha256Text(canonicalKey(parsed.value)) === editionSha256 ? success({ ...parsed.value, editionSha256 }) : failure("editionSha256", "digest-mismatch");
}
function parseEditionReleaseInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "authorityAckReceiptSha256",
    "candidateSha256",
    "completionReceiptSha256",
    "dependencyManifestSha256",
    "editionId",
    "editionSha256",
    "humanReviewReceiptSha256",
    "inputGraphRevisionSha256",
    "operationId",
    "outputGraphRevisionSha256",
    "publishedAt",
    "purpose",
    "v"
  ]) || value["v"] !== 1) {
    return failure("editionRelease");
  }
  const authorityAckReceiptSha256 = parseSha256Hex(value["authorityAckReceiptSha256"]);
  const candidateSha256 = parseSha256Hex(value["candidateSha256"]);
  const completionReceiptSha256 = parseSha256Hex(value["completionReceiptSha256"]);
  const dependencyManifestSha256 = parseSha256Hex(value["dependencyManifestSha256"]);
  const editionId = parseKnowledgeEditionId(value["editionId"]);
  const editionSha256 = parseSha256Hex(value["editionSha256"]);
  const humanReviewReceiptSha256 = parseSha256Hex(value["humanReviewReceiptSha256"]);
  const inputGraphRevisionSha256 = parseSha256Hex(value["inputGraphRevisionSha256"]);
  const operationId = safeCode(value["operationId"], 128);
  const outputGraphRevisionSha256 = parseSha256Hex(value["outputGraphRevisionSha256"]);
  const publishedAt = parseCanonicalInstantV1(value["publishedAt"]);
  return authorityAckReceiptSha256 !== null && candidateSha256 !== null && completionReceiptSha256 !== null && dependencyManifestSha256 !== null && editionId !== null && editionSha256 !== null && humanReviewReceiptSha256 !== null && inputGraphRevisionSha256 !== null && operationId !== null && outputGraphRevisionSha256 !== null && outputGraphRevisionSha256 !== inputGraphRevisionSha256 && publishedAt !== null && value["purpose"] === SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1 ? success({
    authorityAckReceiptSha256,
    candidateSha256,
    completionReceiptSha256,
    dependencyManifestSha256,
    editionId,
    editionSha256,
    humanReviewReceiptSha256,
    inputGraphRevisionSha256,
    operationId,
    outputGraphRevisionSha256,
    publishedAt,
    purpose: SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1,
    v: 1
  }) : failure("editionRelease");
}
async function createKnowledgeEditionReleaseV1(input) {
  const parsed = parseEditionReleaseInput(input);
  return parsed.ok ? success({ ...parsed.value, releaseSha256: await sha256Text(canonicalKey(parsed.value)) }) : parsed;
}
async function parseKnowledgeEditionReleaseV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "releaseSha256")) {
    return failure("editionRelease");
  }
  const releaseSha256 = parseSha256Hex(value["releaseSha256"]);
  const parsed = parseEditionReleaseInput(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "releaseSha256")));
  if (releaseSha256 === null || !parsed.ok)
    return failure("editionRelease");
  return await sha256Text(canonicalKey(parsed.value)) === releaseSha256 ? success({ ...parsed.value, releaseSha256 }) : failure("releaseSha256", "digest-mismatch");
}

// src/research/knowledge-ontology-contract-v1.ts
function success2(value) {
  return { ok: true, value };
}
function failure2(field, code = "invalid-input") {
  return { error: { code, field }, ok: false };
}
function asJson2(value) {
  return value;
}
function canonicalKey2(value) {
  return canonicalJson(asJson2(value));
}
function compareCanonical(left, right) {
  const leftKey = canonicalKey2(left);
  const rightKey = canonicalKey2(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
function orderedUnique(values, key = canonicalKey2) {
  return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value));
}
function sortedUnique2(values, key = canonicalKey2) {
  const sorted = [...values].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return orderedUnique(sorted, key) ? sorted : null;
}
function boundedText2(value, maximumBytes = 16384) {
  if (typeof value !== "string" || value.length === 0 || value.normalize("NFC") !== value || utf8ByteLength(value) > maximumBytes)
    return null;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code >= 11 && code <= 12 || code >= 14 && code <= 31 || code >= 127 && code <= 159 || code >= 55296 && code <= 57343)
      return null;
  }
  return value;
}
function safeCode2(value, maximumLength = 128) {
  return typeof value === "string" && value.length <= maximumLength && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function languageTag2(value) {
  return typeof value === "string" && value.length <= 64 && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value) ? value : null;
}
function positiveInteger2(value, allowZero = false) {
  return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= (allowZero ? 0 : 1) ? value : null;
}
function parseShaArray2(value, maximum = 4096) {
  if (!Array.isArray(value) || value.length > maximum)
    return null;
  const parsed = value.map(parseSha256Hex);
  return parsed.every((item) => item !== null) && orderedUnique(parsed, (item) => item) ? parsed : null;
}
function parseRefArray(value, maximum = 512) {
  if (!Array.isArray(value) || value.length > maximum)
    return null;
  const parsed = [];
  for (const item of value) {
    const ref = parseKnowledgeSchemaRefV1(item);
    if (!ref.ok)
      return null;
    parsed.push(ref.value);
  }
  return orderedUnique(parsed) ? parsed : null;
}
function sameRef(left, right) {
  return canonicalKey2(left) === canonicalKey2(right);
}
function parseCanonicalDecimal(value) {
  return typeof value === "string" && value.length <= 1024 && value !== "-0" && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value) ? value : null;
}
function compareDecimals(left, right) {
  const parts = (value) => {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [integer = "0", fraction = ""] = unsigned.split(".");
    return { fraction, integer, negative };
  };
  const leftParts = parts(left);
  const rightParts = parts(right);
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const scaled = (value) => {
    const magnitude = BigInt(`${value.integer}${value.fraction.padEnd(scale, "0")}`);
    return value.negative ? -magnitude : magnitude;
  };
  const leftScaled = scaled(leftParts);
  const rightScaled = scaled(rightParts);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}
function parseLocalizedTexts(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128)
    return null;
  const parsed = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["language", "text", "v"]) || item["v"] !== 1)
      return null;
    const language = languageTag2(item["language"]);
    const text = boundedText2(item["text"]);
    if (language === null || text === null)
      return null;
    parsed.push({ language, text, v: 1 });
  }
  return orderedUnique(parsed) ? parsed : null;
}
function parseSchemaIdentity(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["code", "namespace", "revision", "v"]) || value["v"] !== 1)
    return null;
  const code = safeCode2(value["code"]);
  const namespace = safeCode2(value["namespace"]);
  const revision = positiveInteger2(value["revision"]);
  return code === null || namespace === null || revision === null ? null : { code, namespace, revision, v: 1 };
}
function refForIdentity(identity, digest) {
  return {
    code: identity.code,
    namespace: identity.namespace,
    revision: identity.revision,
    schemaSha256: digest,
    v: 1
  };
}
var KNOWLEDGE_VALUE_KINDS_V1 = [
  "boolean",
  "decimal",
  "duration",
  "entity",
  "extension",
  "geometry",
  "identifier",
  "integer",
  "interval",
  "list",
  "media",
  "quantity",
  "recurrence",
  "set",
  "string",
  "text",
  "time",
  "uri"
];
function parseKnowledgeValueRangeV1(value) {
  if (!isPlainRecord(value) || value["v"] !== 1)
    return failure2("valueRange");
  switch (value["kind"]) {
    case "any":
      return hasExactKeys(value, ["kind", "v"]) ? success2({ kind: "any", v: 1 }) : failure2("valueRange");
    case "value-kinds": {
      if (!hasExactKeys(value, ["kind", "v", "valueKinds"]) || !Array.isArray(value["valueKinds"]) || value["valueKinds"].length === 0) {
        return failure2("valueRange");
      }
      const kinds = value["valueKinds"].filter((item) => KNOWLEDGE_VALUE_KINDS_V1.some((candidate) => candidate === item));
      return kinds.length === value["valueKinds"].length && orderedUnique(kinds, (item) => item) ? success2({ kind: "value-kinds", v: 1, valueKinds: kinds }) : failure2("valueKinds", "noncanonical-input");
    }
    case "entity-concepts": {
      if (!hasExactKeys(value, ["concepts", "kind", "v"]))
        return failure2("valueRange");
      const concepts = parseRefArray(value["concepts"]);
      return concepts !== null && concepts.length > 0 ? success2({ concepts, kind: "entity-concepts", v: 1 }) : failure2("concepts");
    }
    case "numeric": {
      if (!hasExactKeys(value, ["kind", "lowerBound", "unit", "upperBound", "v"])) {
        return failure2("valueRange");
      }
      const lowerBound = value["lowerBound"] === null ? null : parseCanonicalDecimal(value["lowerBound"]);
      const upperBound = value["upperBound"] === null ? null : parseCanonicalDecimal(value["upperBound"]);
      const unit = value["unit"] === null ? null : parseKnowledgeSchemaRefV1(value["unit"]);
      if (value["lowerBound"] !== null && lowerBound === null || value["upperBound"] !== null && upperBound === null || value["unit"] !== null && (unit === null || !unit.ok) || lowerBound !== null && upperBound !== null && compareDecimals(lowerBound, upperBound) > 0)
        return failure2("valueRange");
      return success2({
        kind: "numeric",
        lowerBound,
        unit: unit === null || !unit.ok ? null : unit.value,
        upperBound,
        v: 1
      });
    }
    case "text": {
      if (!hasExactKeys(value, ["kind", "languages", "maximumBytes", "v"])) {
        return failure2("valueRange");
      }
      const maximumBytes = positiveInteger2(value["maximumBytes"]);
      let languages = null;
      if (value["languages"] !== null) {
        if (!Array.isArray(value["languages"]))
          return failure2("languages");
        const parsed = value["languages"].map(languageTag2);
        if (parsed.some((item) => item === null) || !orderedUnique(parsed, (item) => item))
          return failure2("languages");
        languages = parsed;
      }
      return maximumBytes === null ? failure2("maximumBytes") : success2({ kind: "text", languages, maximumBytes, v: 1 });
    }
    case "enum": {
      if (!hasExactKeys(value, ["kind", "v", "values"]) || !Array.isArray(value["values"]) || value["values"].length === 0 || value["values"].length > 256) {
        return failure2("valueRange");
      }
      const values = [];
      for (const item of value["values"]) {
        const parsed = parseKnowledgeValueV1(item);
        if (!parsed.ok)
          return failure2("values");
        values.push(parsed.value);
      }
      return orderedUnique(values) ? success2({ kind: "enum", v: 1, values }) : failure2("values", "noncanonical-input");
    }
    default:
      return failure2("valueRange");
  }
}
function parseVocabularyInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "canonicalizerSha256",
    "labels",
    "namespace",
    "ownerEntityId",
    "previousRevisionSha256",
    "revision",
    "state",
    "v"
  ]) || value["v"] !== 1)
    return failure2("vocabulary");
  const canonicalizerSha256 = parseSha256Hex(value["canonicalizerSha256"]);
  const labels = parseLocalizedTexts(value["labels"]);
  const namespace = safeCode2(value["namespace"]);
  const ownerEntityId = parseKnowledgeEntityId(value["ownerEntityId"]);
  const previousRevisionSha256 = value["previousRevisionSha256"] === null ? null : parseSha256Hex(value["previousRevisionSha256"]);
  const revision = positiveInteger2(value["revision"]);
  const state = value["state"];
  return canonicalizerSha256 !== null && labels !== null && namespace !== null && ownerEntityId !== null && (value["previousRevisionSha256"] === null || previousRevisionSha256 !== null) && revision !== null && revision === 1 === (previousRevisionSha256 === null) && (state === "private" || state === "public" || state === "retired" || state === "shared") ? success2({
    canonicalizerSha256,
    labels,
    namespace,
    ownerEntityId,
    previousRevisionSha256,
    revision,
    state,
    v: 1
  }) : failure2("vocabulary");
}
async function createKnowledgeVocabularyRevisionV1(input) {
  const parsed = parseVocabularyInput(input);
  return parsed.ok ? success2({ ...parsed.value, revisionSha256: await sha256Text(canonicalKey2(parsed.value)) }) : parsed;
}
async function parseKnowledgeVocabularyRevisionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "revisionSha256")) {
    return failure2("vocabulary");
  }
  const revisionSha256 = parseSha256Hex(value["revisionSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "revisionSha256"));
  const parsed = parseVocabularyInput(input);
  if (revisionSha256 === null || !parsed.ok)
    return failure2("vocabulary");
  const expected = await sha256Text(canonicalKey2(parsed.value));
  return expected === revisionSha256 ? success2({ ...parsed.value, revisionSha256 }) : failure2("revisionSha256", "digest-mismatch");
}
function parseSchemaRevisionBase(value) {
  const definitions = parseLocalizedTexts(value["definitions"]);
  const identity = parseSchemaIdentity(value["identity"]);
  const labels = parseLocalizedTexts(value["labels"]);
  const previousRevisionSha256 = value["previousRevisionSha256"] === null ? null : parseSha256Hex(value["previousRevisionSha256"]);
  const reviewDecisionSha256 = value["reviewDecisionSha256"] === null ? null : parseSha256Hex(value["reviewDecisionSha256"]);
  const vocabularySha256 = parseSha256Hex(value["vocabularySha256"]);
  return definitions !== null && identity !== null && labels !== null && (value["previousRevisionSha256"] === null || previousRevisionSha256 !== null) && (value["reviewDecisionSha256"] === null || reviewDecisionSha256 !== null) && vocabularySha256 !== null && identity.revision === 1 === (previousRevisionSha256 === null) ? {
    definitions,
    identity,
    labels,
    previousRevisionSha256,
    reviewDecisionSha256,
    v: 1,
    vocabularySha256
  } : null;
}
function parseSchemaRevisionInput(value) {
  if (!isPlainRecord(value) || value["v"] !== 1)
    return failure2("schemaRevision");
  const base = parseSchemaRevisionBase(value);
  if (base === null)
    return failure2("schemaRevision");
  switch (value["kind"]) {
    case "concept": {
      if (!hasExactKeys(value, [
        "broader",
        "definitions",
        "identity",
        "kind",
        "labels",
        "previousRevisionSha256",
        "reviewDecisionSha256",
        "v",
        "vocabularySha256"
      ])) {
        return failure2("schemaRevision");
      }
      const broader = parseRefArray(value["broader"]);
      return broader === null ? failure2("broader") : success2({ ...base, broader, kind: "concept" });
    }
    case "predicate": {
      if (!hasExactKeys(value, [
        "definitions",
        "domainConcepts",
        "identity",
        "inversePredicate",
        "kind",
        "labels",
        "previousRevisionSha256",
        "qualifierPredicates",
        "range",
        "reviewDecisionSha256",
        "v",
        "vocabularySha256"
      ]))
        return failure2("schemaRevision");
      const domainConcepts = parseRefArray(value["domainConcepts"]);
      const inversePredicate = value["inversePredicate"] === null ? null : parseKnowledgeSchemaRefV1(value["inversePredicate"]);
      const qualifierPredicates = parseRefArray(value["qualifierPredicates"]);
      const range = parseKnowledgeValueRangeV1(value["range"]);
      return domainConcepts !== null && qualifierPredicates !== null && range.ok && (value["inversePredicate"] === null || inversePredicate !== null && inversePredicate.ok) ? success2({
        ...base,
        domainConcepts,
        inversePredicate: inversePredicate === null || !inversePredicate.ok ? null : inversePredicate.value,
        kind: "predicate",
        qualifierPredicates,
        range: range.value
      }) : failure2("schemaRevision");
    }
    case "unit": {
      if (!hasExactKeys(value, [
        "definitions",
        "dimension",
        "identity",
        "kind",
        "labels",
        "offset",
        "previousRevisionSha256",
        "reviewDecisionSha256",
        "scale",
        "symbol",
        "v",
        "vocabularySha256"
      ]))
        return failure2("schemaRevision");
      const dimension = safeCode2(value["dimension"]);
      const offset = parseCanonicalDecimal(value["offset"]);
      const scale = parseCanonicalDecimal(value["scale"]);
      const symbol = boundedText2(value["symbol"], 256);
      return dimension !== null && offset !== null && scale !== null && scale !== "0" && symbol !== null ? success2({ ...base, dimension, kind: "unit", offset, scale, symbol }) : failure2("schemaRevision");
    }
    case "mapping": {
      if (!hasExactKeys(value, [
        "definitions",
        "identity",
        "kind",
        "labels",
        "mappingActivitySha256",
        "mappingPolicySha256",
        "previousRevisionSha256",
        "relation",
        "reviewDecisionSha256",
        "source",
        "target",
        "v",
        "vocabularySha256"
      ])) {
        return failure2("schemaRevision");
      }
      const mappingActivitySha256 = parseSha256Hex(value["mappingActivitySha256"]);
      const mappingPolicySha256 = parseSha256Hex(value["mappingPolicySha256"]);
      const relation = value["relation"];
      const source = parseKnowledgeSchemaRefV1(value["source"]);
      const target = parseKnowledgeSchemaRefV1(value["target"]);
      return mappingActivitySha256 !== null && mappingPolicySha256 !== null && (relation === "broader" || relation === "close" || relation === "exact" || relation === "narrower" || relation === "related" || relation === "transformable") && source.ok && target.ok && !sameRef(source.value, target.value) ? success2({
        ...base,
        kind: "mapping",
        mappingActivitySha256,
        mappingPolicySha256,
        relation,
        source: source.value,
        target: target.value
      }) : failure2("schemaRevision");
    }
    default:
      return failure2("schemaRevision");
  }
}
async function createKnowledgeSchemaRevisionV1(input) {
  const parsed = parseSchemaRevisionInput(input);
  if (!parsed.ok)
    return parsed;
  const revisionSha256 = await sha256Text(canonicalKey2(parsed.value));
  return success2({
    ...parsed.value,
    ref: refForIdentity(parsed.value.identity, revisionSha256),
    revisionSha256
  });
}
async function parseKnowledgeSchemaRevisionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "ref") || !Object.hasOwn(value, "revisionSha256"))
    return failure2("schemaRevision");
  const ref = parseKnowledgeSchemaRefV1(value["ref"]);
  const revisionSha256 = parseSha256Hex(value["revisionSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "ref" && key !== "revisionSha256"));
  const parsed = parseSchemaRevisionInput(input);
  if (!ref.ok || revisionSha256 === null || !parsed.ok)
    return failure2("schemaRevision");
  const expected = await sha256Text(canonicalKey2(parsed.value));
  const expectedRef = refForIdentity(parsed.value.identity, expected);
  return expected === revisionSha256 && sameRef(ref.value, expectedRef) ? success2({ ...parsed.value, ref: ref.value, revisionSha256 }) : failure2("revisionSha256", "digest-mismatch");
}
function verifyKnowledgeSchemaEvolutionV1(revisions) {
  if (revisions.length === 0 || revisions.length > 1024)
    return failure2("revisions");
  const ordered = [...revisions].sort((left, right) => left.identity.revision - right.identity.revision);
  const first = ordered[0];
  for (let index = 0;index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = index === 0 ? null : ordered[index - 1];
    if (current.kind !== first.kind || current.identity.code !== first.identity.code || current.identity.namespace !== first.identity.namespace || current.identity.revision !== index + 1 || current.previousRevisionSha256 !== previous?.revisionSha256 && previous !== null || previous === null && current.previousRevisionSha256 !== null) {
      return failure2("revisions", "dependency-missing");
    }
  }
  return success2(ordered);
}
var SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1 = [
  "create",
  "merge",
  "quarantine",
  "rekey",
  "split",
  "tombstone"
];
function parseEntity(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "entityId",
    "identityOperationId",
    "identityRevision",
    "redirectEntityId",
    "state",
    "v"
  ]) || value["v"] !== 1)
    return null;
  const entityId = parseKnowledgeEntityId(value["entityId"]);
  const identityOperationId = safeCode2(value["identityOperationId"]);
  const identityRevision = positiveInteger2(value["identityRevision"]);
  const redirectEntityId = value["redirectEntityId"] === null ? null : parseKnowledgeEntityId(value["redirectEntityId"]);
  const state = value["state"];
  return entityId !== null && identityOperationId !== null && identityRevision !== null && (value["redirectEntityId"] === null || redirectEntityId !== null) && (state === "active" || state === "quarantined" || state === "redirected" || state === "tombstoned") && state === "redirected" === (redirectEntityId !== null) && redirectEntityId !== entityId ? { entityId, identityOperationId, identityRevision, redirectEntityId, state, v: 1 } : null;
}
function parseEntityArray(value) {
  if (!Array.isArray(value) || value.length > 1024)
    return null;
  const entities = value.map(parseEntity);
  return entities.every((entity) => entity !== null) && orderedUnique(entities, (entity) => entity.entityId) ? entities : null;
}
function parseAssignments(value) {
  if (!Array.isArray(value) || value.length > 1024)
    return null;
  const assignments = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["fromEntityId", "toEntityIds", "v"]) || item["v"] !== 1 || !Array.isArray(item["toEntityIds"]))
      return null;
    const fromEntityId = parseKnowledgeEntityId(item["fromEntityId"]);
    const toEntityIds = item["toEntityIds"].map(parseKnowledgeEntityId);
    if (fromEntityId === null || toEntityIds.length === 0 || toEntityIds.some((entityId) => entityId === null) || !orderedUnique(toEntityIds, (entityId) => entityId))
      return null;
    assignments.push({ fromEntityId, toEntityIds, v: 1 });
  }
  return orderedUnique(assignments, (assignment) => assignment.fromEntityId) ? assignments : null;
}
function identityOperationLaw(value) {
  const preimageById = new Map(value.preimageEntities.map((entity) => [entity.entityId, entity]));
  const postimageById = new Map(value.postimageEntities.map((entity) => [entity.entityId, entity]));
  const assignmentById = new Map(value.assignments.map((assignment) => [assignment.fromEntityId, assignment]));
  if (preimageById.size !== value.preimageEntities.length || postimageById.size !== value.postimageEntities.length || assignmentById.size !== value.assignments.length)
    return false;
  if (value.postimageEntities.some((entity) => entity.identityOperationId !== value.operationId))
    return false;
  for (const before of value.preimageEntities) {
    const after = postimageById.get(before.entityId);
    if (after === undefined || after.identityRevision !== before.identityRevision + 1 || !assignmentById.has(before.entityId))
      return false;
  }
  for (const after of value.postimageEntities) {
    if (!preimageById.has(after.entityId) && after.identityRevision !== 1)
      return false;
  }
  const assignedTargets = new Set(value.assignments.flatMap((assignment) => assignment.toEntityIds));
  const newIds = value.postimageEntities.filter((entity) => !preimageById.has(entity.entityId)).map((entity) => entity.entityId);
  if (value.kind !== "create" && newIds.some((entityId) => !assignedTargets.has(entityId))) {
    return false;
  }
  switch (value.kind) {
    case "create":
      return value.preimageEntities.length === 0 && value.postimageEntities.length === 1 && value.assignments.length === 0 && value.postimageEntities[0]?.state === "active" && value.postimageEntities[0]?.identityRevision === 1;
    case "merge": {
      if (value.preimageEntities.length < 2 || value.assignments.length !== value.preimageEntities.length || newIds.length !== 0)
        return false;
      const targets = new Set(value.assignments.flatMap((assignment) => assignment.toEntityIds));
      if (targets.size !== 1)
        return false;
      const targetId = [...targets][0];
      if (targetId === undefined || !preimageById.has(targetId))
        return false;
      return value.postimageEntities.every((entity) => entity.entityId === targetId ? entity.state === "active" && entity.redirectEntityId === null : entity.state === "redirected" && entity.redirectEntityId === targetId);
    }
    case "split": {
      if (value.preimageEntities.length !== 1 || value.assignments.length !== 1 || newIds.length < 2)
        return false;
      const before = value.preimageEntities[0];
      const assignment = value.assignments[0];
      const oldAfter = postimageById.get(before.entityId);
      return assignment.fromEntityId === before.entityId && assignment.toEntityIds.length === newIds.length && assignment.toEntityIds.every((entityId) => newIds.includes(entityId)) && oldAfter?.state === "tombstoned" && newIds.every((entityId) => postimageById.get(entityId)?.state === "active");
    }
    case "rekey": {
      if (value.preimageEntities.length !== 1 || value.assignments.length !== 1 || newIds.length !== 1)
        return false;
      const before = value.preimageEntities[0];
      const replacement = newIds[0];
      const assignment = value.assignments[0];
      return assignment.fromEntityId === before.entityId && assignment.toEntityIds.length === 1 && assignment.toEntityIds[0] === replacement && postimageById.get(before.entityId)?.state === "redirected" && postimageById.get(before.entityId)?.redirectEntityId === replacement && postimageById.get(replacement)?.state === "active";
    }
    case "quarantine":
    case "tombstone": {
      if (value.preimageEntities.length !== 1 || value.postimageEntities.length !== 1 || value.assignments.length !== 1)
        return false;
      const before = value.preimageEntities[0];
      const after = value.postimageEntities[0];
      const assignment = value.assignments[0];
      return before.entityId === after.entityId && assignment.fromEntityId === before.entityId && assignment.toEntityIds.length === 1 && assignment.toEntityIds[0] === before.entityId && after.state === (value.kind === "quarantine" ? "quarantined" : "tombstoned");
    }
  }
}
async function canonicalIdentityInput(input) {
  const activitySha256 = parseSha256Hex(input.activitySha256);
  const assignments = sortedUnique2(input.assignments, (assignment) => assignment.fromEntityId);
  const kind = SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1.find((candidate) => candidate === input.kind);
  const occurredAt = parseCanonicalInstantV1(input.occurredAt);
  const operationId = safeCode2(input.operationId);
  const postimageEntities = sortedUnique2(input.postimageEntities, (entity) => entity.entityId);
  const preimageEntities = sortedUnique2(input.preimageEntities, (entity) => entity.entityId);
  if (activitySha256 === null || assignments === null || kind === undefined || occurredAt === null || operationId === null || postimageEntities === null || preimageEntities === null)
    return failure2("identityOperation");
  const canonicalAssignments = assignments.map((assignment) => {
    const toEntityIds = sortedUnique2(assignment.toEntityIds, (entityId) => entityId);
    return toEntityIds === null ? null : { ...assignment, toEntityIds };
  });
  if (canonicalAssignments.some((assignment) => assignment === null)) {
    return failure2("assignments", "noncanonical-input");
  }
  const canonical = {
    activitySha256,
    assignments: canonicalAssignments,
    kind,
    occurredAt,
    operationId,
    postimageEntities,
    preimageEntities,
    v: 1
  };
  if (!identityOperationLaw(canonical))
    return failure2("identityOperation", "authority-violation");
  return success2({
    ...canonical,
    postimageSha256: await sha256Text(canonicalKey2(postimageEntities)),
    preimageSha256: await sha256Text(canonicalKey2(preimageEntities))
  });
}
async function createKnowledgeIdentityOperationV1(input) {
  const canonical = await canonicalIdentityInput(input);
  if (!canonical.ok)
    return canonical;
  const operationPayload = canonical.value;
  return success2({
    ...operationPayload,
    operationSha256: await sha256Text(canonicalKey2(operationPayload))
  });
}
async function parseKnowledgeIdentityOperationV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "activitySha256",
    "assignments",
    "kind",
    "occurredAt",
    "operationId",
    "operationSha256",
    "postimageEntities",
    "postimageSha256",
    "preimageEntities",
    "preimageSha256",
    "v"
  ]) || value["v"] !== 1) {
    return failure2("identityOperation");
  }
  const operationSha256 = parseSha256Hex(value["operationSha256"]);
  const postimageSha256 = parseSha256Hex(value["postimageSha256"]);
  const preimageSha256 = parseSha256Hex(value["preimageSha256"]);
  const assignments = parseAssignments(value["assignments"]);
  const postimageEntities = parseEntityArray(value["postimageEntities"]);
  const preimageEntities = parseEntityArray(value["preimageEntities"]);
  if (operationSha256 === null || postimageSha256 === null || preimageSha256 === null || assignments === null || postimageEntities === null || preimageEntities === null) {
    return failure2("identityOperation");
  }
  const canonical = await canonicalIdentityInput({
    activitySha256: value["activitySha256"],
    assignments,
    kind: value["kind"],
    occurredAt: value["occurredAt"],
    operationId: value["operationId"],
    postimageEntities,
    preimageEntities,
    v: 1
  });
  if (!canonical.ok || canonical.value.preimageSha256 !== preimageSha256 || canonical.value.postimageSha256 !== postimageSha256) {
    return failure2("preimageSha256", "digest-mismatch");
  }
  const expected = await sha256Text(canonicalKey2(canonical.value));
  return expected === operationSha256 ? success2({ ...canonical.value, operationSha256 }) : failure2("operationSha256", "digest-mismatch");
}
async function verifyKnowledgeIdentityOperationAgainstHeadsV1(operation, currentHeads) {
  const heads = sortedUnique2(currentHeads, (entity) => entity.entityId);
  if (heads === null || heads.length !== operation.preimageEntities.length || canonicalKey2(heads) !== canonicalKey2(operation.preimageEntities) || await sha256Text(canonicalKey2(heads)) !== operation.preimageSha256) {
    return failure2("preimageEntities", "authority-violation");
  }
  return success2(operation);
}
function parseTypeMembershipInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "assertionSha256",
    "concept",
    "contextSha256",
    "entityId",
    "validDuring",
    "v"
  ]) || value["v"] !== 1) {
    return failure2("typeMembership");
  }
  const assertionSha256 = parseSha256Hex(value["assertionSha256"]);
  const concept = parseKnowledgeSchemaRefV1(value["concept"]);
  const contextSha256 = value["contextSha256"] === null ? null : parseSha256Hex(value["contextSha256"]);
  const entityId = parseKnowledgeEntityId(value["entityId"]);
  let validDuring = null;
  if (value["validDuring"] !== null) {
    const interval = parseKnowledgeValueV1({
      ...value["validDuring"],
      kind: "interval"
    });
    if (!interval.ok || interval.value.kind !== "interval")
      return failure2("validDuring");
    validDuring = { end: interval.value.end, start: interval.value.start, v: 1 };
  }
  return assertionSha256 !== null && concept.ok && (value["contextSha256"] === null || contextSha256 !== null) && entityId !== null ? success2({
    assertionSha256,
    concept: concept.value,
    contextSha256,
    entityId,
    validDuring,
    v: 1
  }) : failure2("typeMembership");
}
async function createKnowledgeTypeMembershipV1(input) {
  const parsed = parseTypeMembershipInput(input);
  return parsed.ok ? success2({ ...parsed.value, membershipSha256: await sha256Text(canonicalKey2(parsed.value)) }) : parsed;
}
async function parseKnowledgeTypeMembershipV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "membershipSha256")) {
    return failure2("typeMembership");
  }
  const membershipSha256 = parseSha256Hex(value["membershipSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "membershipSha256"));
  const parsed = parseTypeMembershipInput(input);
  if (membershipSha256 === null || !parsed.ok)
    return failure2("typeMembership");
  const expected = await sha256Text(canonicalKey2(parsed.value));
  return expected === membershipSha256 ? success2({ ...parsed.value, membershipSha256 }) : failure2("membershipSha256", "digest-mismatch");
}
var SPONGE_KNOWLEDGE_DISCLOSURES_V1 = [
  "export",
  "model",
  "private",
  "public",
  "search",
  "shared"
];
function parseRightsDecisionInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "actorEntityId",
    "allowedDisclosures",
    "decidedAt",
    "policySha256",
    "purposes",
    "subjectSha256",
    "v"
  ]) || value["v"] !== 1 || !Array.isArray(value["allowedDisclosures"]) || !Array.isArray(value["purposes"]))
    return failure2("rightsDecision");
  const actorEntityId = parseKnowledgeEntityId(value["actorEntityId"]);
  const allowedDisclosures = value["allowedDisclosures"].filter((item) => SPONGE_KNOWLEDGE_DISCLOSURES_V1.some((candidate) => candidate === item));
  const decidedAt = parseCanonicalInstantV1(value["decidedAt"]);
  const policySha256 = parseSha256Hex(value["policySha256"]);
  const purposes = value["purposes"].map((purpose) => safeCode2(purpose));
  const subjectSha256 = parseSha256Hex(value["subjectSha256"]);
  return actorEntityId !== null && allowedDisclosures.length === value["allowedDisclosures"].length && allowedDisclosures.includes("private") && orderedUnique(allowedDisclosures, (item) => item) && decidedAt !== null && policySha256 !== null && purposes.length > 0 && purposes.every((purpose) => purpose !== null) && orderedUnique(purposes, (item) => item) && subjectSha256 !== null ? success2({
    actorEntityId,
    allowedDisclosures,
    decidedAt,
    policySha256,
    purposes,
    subjectSha256,
    v: 1
  }) : failure2("rightsDecision");
}
async function createKnowledgeRightsDecisionV1(input) {
  const parsed = parseRightsDecisionInput(input);
  return parsed.ok ? success2({ ...parsed.value, decisionSha256: await sha256Text(canonicalKey2(parsed.value)) }) : parsed;
}
async function parseKnowledgeRightsDecisionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "decisionSha256")) {
    return failure2("rightsDecision");
  }
  const decisionSha256 = parseSha256Hex(value["decisionSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "decisionSha256"));
  const parsed = parseRightsDecisionInput(input);
  if (decisionSha256 === null || !parsed.ok)
    return failure2("rightsDecision");
  const expected = await sha256Text(canonicalKey2(parsed.value));
  return expected === decisionSha256 ? success2({ ...parsed.value, decisionSha256 }) : failure2("decisionSha256", "digest-mismatch");
}
function effectiveKnowledgeRightsV1(input) {
  const decisions = input.decisions.filter((decision) => decision.subjectSha256 === input.subjectSha256 && decision.purposes.includes(input.purpose));
  if (decisions.length === 0)
    return ["private"];
  return SPONGE_KNOWLEDGE_DISCLOSURES_V1.filter((disclosure) => decisions.every((decision) => decision.allowedDisclosures.includes(disclosure)));
}
var SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1 = [
  "activity",
  "assertion",
  "context",
  "entity",
  "evidence",
  "identity-operation",
  "inquiry",
  "inquiry-event",
  "schema",
  "shape",
  "statement",
  "synthesis-candidate",
  "type-membership",
  "view",
  "vocabulary"
];
function parseReviewDecisionInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "decidedAt",
    "outcome",
    "policySha256",
    "purpose",
    "reviewerEntityId",
    "subjectKind",
    "subjectSha256",
    "supersedesDecisionSha256",
    "v"
  ]) || value["v"] !== 1) {
    return failure2("reviewDecision");
  }
  const decidedAt = parseCanonicalInstantV1(value["decidedAt"]);
  const outcome = value["outcome"];
  const policySha256 = parseSha256Hex(value["policySha256"]);
  const purpose = safeCode2(value["purpose"]);
  const reviewerEntityId = parseKnowledgeEntityId(value["reviewerEntityId"]);
  const subjectKind = SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1.find((candidate) => candidate === value["subjectKind"]);
  const subjectSha256 = parseSha256Hex(value["subjectSha256"]);
  const supersedesDecisionSha256 = value["supersedesDecisionSha256"] === null ? null : parseSha256Hex(value["supersedesDecisionSha256"]);
  return decidedAt !== null && (outcome === "accept" || outcome === "reject" || outcome === "request-changes" || outcome === "withdraw") && policySha256 !== null && purpose !== null && reviewerEntityId !== null && subjectKind !== undefined && subjectSha256 !== null && (value["supersedesDecisionSha256"] === null || supersedesDecisionSha256 !== null) ? success2({
    decidedAt,
    outcome,
    policySha256,
    purpose,
    reviewerEntityId,
    subjectKind,
    subjectSha256,
    supersedesDecisionSha256,
    v: 1
  }) : failure2("reviewDecision");
}
async function createKnowledgeReviewDecisionV1(input) {
  const parsed = parseReviewDecisionInput(input);
  return parsed.ok ? success2({ ...parsed.value, decisionSha256: await sha256Text(canonicalKey2(parsed.value)) }) : parsed;
}
async function parseKnowledgeReviewDecisionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "decisionSha256")) {
    return failure2("reviewDecision");
  }
  const decisionSha256 = parseSha256Hex(value["decisionSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "decisionSha256"));
  const parsed = parseReviewDecisionInput(input);
  if (decisionSha256 === null || !parsed.ok)
    return failure2("reviewDecision");
  const expected = await sha256Text(canonicalKey2(parsed.value));
  return expected === decisionSha256 ? success2({ ...parsed.value, decisionSha256 }) : failure2("decisionSha256", "digest-mismatch");
}
function effectiveKnowledgeReviewV1(input) {
  const candidates = input.decisions.filter((decision) => decision.purpose === input.purpose && decision.subjectKind === input.subjectKind && decision.subjectSha256 === input.subjectSha256);
  if (candidates.length === 0)
    return null;
  const byDigest = new Map(candidates.map((decision) => [decision.decisionSha256, decision]));
  const superseded = new Set(candidates.flatMap((decision) => decision.supersedesDecisionSha256 === null ? [] : [decision.supersedesDecisionSha256]));
  const heads = candidates.filter((decision) => !superseded.has(decision.decisionSha256));
  if (heads.length !== 1)
    return null;
  let cursor = heads[0];
  const visited = new Set;
  while (cursor !== undefined && cursor.supersedesDecisionSha256 !== null) {
    if (visited.has(cursor.decisionSha256))
      return null;
    visited.add(cursor.decisionSha256);
    cursor = byDigest.get(cursor.supersedesDecisionSha256);
    if (cursor === undefined)
      return null;
  }
  return heads[0] ?? null;
}
function parseCardinality(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["maximum", "minimum", "v"]) || value["v"] !== 1)
    return null;
  const maximum = value["maximum"] === null ? null : positiveInteger2(value["maximum"], true);
  const minimum = positiveInteger2(value["minimum"], true);
  return minimum !== null && (value["maximum"] === null || maximum !== null) && (maximum === null || minimum <= maximum) ? { maximum, minimum, v: 1 } : null;
}
function parseShapeRules(value) {
  if (!Array.isArray(value) || value.length > 1024)
    return null;
  const rules = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, [
      "allowedDisclosures",
      "cardinality",
      "predicate",
      "purpose",
      "range",
      "requiredEvidenceBearings",
      "severity",
      "v"
    ]) || item["v"] !== 1 || !Array.isArray(item["allowedDisclosures"]) || !Array.isArray(item["requiredEvidenceBearings"]))
      return null;
    const allowedDisclosures = item["allowedDisclosures"].filter((disclosure) => SPONGE_KNOWLEDGE_DISCLOSURES_V1.some((candidate) => candidate === disclosure));
    const cardinality = parseCardinality(item["cardinality"]);
    const predicate = parseKnowledgeSchemaRefV1(item["predicate"]);
    const purpose = safeCode2(item["purpose"]);
    const range = parseKnowledgeValueRangeV1(item["range"]);
    const requiredEvidenceBearings = item["requiredEvidenceBearings"].filter((bearing) => SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1.some((candidate) => candidate === bearing));
    const severity = item["severity"];
    if (allowedDisclosures.length === 0 || allowedDisclosures.length !== item["allowedDisclosures"].length || !orderedUnique(allowedDisclosures, (disclosure) => disclosure) || cardinality === null || !predicate.ok || purpose === null || !range.ok || requiredEvidenceBearings.length !== item["requiredEvidenceBearings"].length || !orderedUnique(requiredEvidenceBearings, (bearing) => bearing) || severity !== "error" && severity !== "warning")
      return null;
    rules.push({
      allowedDisclosures,
      cardinality,
      predicate: predicate.value,
      purpose,
      range: range.value,
      requiredEvidenceBearings,
      severity,
      v: 1
    });
  }
  return orderedUnique(rules, (rule) => canonicalKey2({
    predicate: rule.predicate,
    purpose: rule.purpose
  })) ? rules : null;
}
function parseExecutableShapeInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "appliesToConcepts",
    "closed",
    "extends",
    "maximumInheritanceDepth",
    "rules",
    "shape",
    "v"
  ]) || value["v"] !== 1) {
    return failure2("shape");
  }
  const appliesToConcepts = parseRefArray(value["appliesToConcepts"]);
  const closed = value["closed"];
  const extended = parseRefArray(value["extends"]);
  const maximumInheritanceDepth = positiveInteger2(value["maximumInheritanceDepth"]);
  const rules = parseShapeRules(value["rules"]);
  const shape = parseKnowledgeSchemaRefV1(value["shape"]);
  return appliesToConcepts !== null && typeof closed === "boolean" && extended !== null && maximumInheritanceDepth !== null && maximumInheritanceDepth <= 64 && rules !== null && shape.ok && !extended.some((candidate) => sameRef(candidate, shape.value)) ? success2({
    appliesToConcepts,
    closed,
    extends: extended,
    maximumInheritanceDepth,
    rules,
    shape: shape.value,
    v: 1
  }) : failure2("shape");
}
async function createKnowledgeExecutableShapeV1(input) {
  const parsed = parseExecutableShapeInput(input);
  return parsed.ok ? success2({ ...parsed.value, shapeSha256: await sha256Text(canonicalKey2(parsed.value)) }) : parsed;
}
async function parseKnowledgeExecutableShapeV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "shapeSha256"))
    return failure2("shape");
  const shapeSha256 = parseSha256Hex(value["shapeSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "shapeSha256"));
  const parsed = parseExecutableShapeInput(input);
  if (shapeSha256 === null || !parsed.ok)
    return failure2("shape");
  const expected = await sha256Text(canonicalKey2(parsed.value));
  return expected === shapeSha256 ? success2({ ...parsed.value, shapeSha256 }) : failure2("shapeSha256", "digest-mismatch");
}
function disclosureMatchesEvidence(disclosure, evidence) {
  if (disclosure === "private")
    return true;
  if (disclosure === "shared")
    return evidence.disclosure !== "private";
  return evidence.disclosure === "public";
}
function acceptedAssertionForPurpose(assertions, statementSha256, purpose) {
  return assertions.find((assertion) => assertion.statementSha256 === statementSha256 && assertion.state === "accepted-for-purpose" && assertion.acceptedPurposes.includes(purpose)) ?? null;
}
async function valueMatchesRange(value, range, input) {
  if (!(await verifyKnowledgeValueV1(value)).ok)
    return false;
  switch (range.kind) {
    case "any":
      return true;
    case "value-kinds":
      return range.valueKinds.includes(value.kind);
    case "entity-concepts":
      return value.kind === "entity" && input.memberships.some((membership) => membership.entityId === value.entityId && range.concepts.some((concept) => sameRef(concept, membership.concept)) && input.assertions.some((assertion) => assertion.assertionSha256 === membership.assertionSha256 && assertion.state === "accepted-for-purpose" && assertion.acceptedPurposes.includes(input.purpose)));
    case "numeric": {
      const numeric = value.kind === "decimal" || value.kind === "integer" ? value.value : value.kind === "quantity" ? value.value : null;
      if (numeric === null)
        return false;
      if (range.unit !== null && (value.kind !== "quantity" || !sameRef(value.unit, range.unit)))
        return false;
      return (range.lowerBound === null || compareDecimals(numeric, range.lowerBound) >= 0) && (range.upperBound === null || compareDecimals(numeric, range.upperBound) <= 0);
    }
    case "text":
      return value.kind === "text" && utf8ByteLength(value.text) <= range.maximumBytes && (range.languages === null || range.languages.includes(value.language));
    case "enum":
      return range.values.some((candidate) => canonicalKey2(candidate) === canonicalKey2(value));
  }
}
function shapeViolation(code, rule, statementSha256 = null) {
  return {
    code,
    predicate: rule?.predicate ?? null,
    severity: rule?.severity ?? "error",
    statementSha256,
    v: 1
  };
}
async function evaluateKnowledgeShapeV1(input) {
  const byRef = new Map(input.shapes.map((shape) => [canonicalKey2(shape.shape), shape]));
  const root = byRef.get(canonicalKey2(input.rootShape));
  if (root === undefined) {
    const violations2 = [shapeViolation("shape-missing", null)];
    return {
      complete: false,
      evaluatedShapeSha256s: [],
      passed: false,
      truncation: null,
      v: 1,
      violations: violations2
    };
  }
  const visiting = new Set;
  const visited = new Set;
  const resolved = [];
  let truncation = null;
  let missing = false;
  const visit = (shape, depth) => {
    const key = canonicalKey2(shape.shape);
    if (visited.has(key) || truncation !== null || missing)
      return;
    if (visiting.has(key)) {
      truncation = "cycle";
      return;
    }
    if (depth > root.maximumInheritanceDepth || visited.size >= 256) {
      truncation = "resource-limit";
      return;
    }
    visiting.add(key);
    for (const parentRef of shape.extends) {
      const parent = byRef.get(canonicalKey2(parentRef));
      if (parent === undefined) {
        missing = true;
        break;
      }
      visit(parent, depth + 1);
    }
    visiting.delete(key);
    if (truncation === null && !missing) {
      visited.add(key);
      resolved.push(shape);
    }
  };
  visit(root, 0);
  if (truncation !== null || missing) {
    const violations2 = [shapeViolation(truncation === "cycle" ? "shape-cycle" : truncation === "resource-limit" ? "shape-resource-limit" : "shape-missing", null)];
    return {
      complete: false,
      evaluatedShapeSha256s: resolved.map((shape) => shape.shapeSha256),
      passed: false,
      truncation,
      v: 1,
      violations: violations2
    };
  }
  const ruleByPredicate = new Map;
  for (const shape of resolved) {
    for (const rule of shape.rules) {
      const key = canonicalKey2({ predicate: rule.predicate, purpose: rule.purpose });
      const prior = ruleByPredicate.get(key);
      if (prior !== undefined && canonicalKey2(prior) !== canonicalKey2(rule)) {
        return {
          complete: false,
          evaluatedShapeSha256s: resolved.map((item) => item.shapeSha256),
          passed: false,
          truncation: "resource-limit",
          v: 1,
          violations: [shapeViolation("shape-resource-limit", rule)]
        };
      }
      ruleByPredicate.set(key, rule);
    }
  }
  const violations = [];
  const acceptedStatements = input.statements.filter((statement) => statement.subject === input.entityId && acceptedAssertionForPurpose(input.assertions, statement.statementSha256, input.purpose) !== null);
  const applicableMembership = input.memberships.some((membership) => membership.entityId === input.entityId && root.appliesToConcepts.some((concept) => sameRef(concept, membership.concept)) && input.assertions.some((assertion) => assertion.assertionSha256 === membership.assertionSha256 && assertion.state === "accepted-for-purpose" && assertion.acceptedPurposes.includes(input.purpose)));
  if (root.appliesToConcepts.length > 0 && !applicableMembership) {
    violations.push(shapeViolation("type-membership-missing", null));
  }
  for (const rule of ruleByPredicate.values()) {
    if (rule.purpose !== input.purpose)
      continue;
    const statements = acceptedStatements.filter((statement) => sameRef(statement.predicate, rule.predicate));
    if (statements.length < rule.cardinality.minimum) {
      violations.push(shapeViolation("cardinality-minimum", rule));
    }
    if (rule.cardinality.maximum !== null && statements.length > rule.cardinality.maximum) {
      violations.push(shapeViolation("cardinality-maximum", rule));
    }
    for (const statement of statements) {
      if (!await valueMatchesRange(statement.object, rule.range, input)) {
        violations.push(shapeViolation("range-mismatch", rule, statement.statementSha256));
      }
      if (!rule.allowedDisclosures.includes(input.disclosure) || !effectiveKnowledgeRightsV1({
        decisions: input.rightsDecisions,
        purpose: input.purpose,
        subjectSha256: statement.statementSha256
      }).includes(input.disclosure)) {
        violations.push(shapeViolation("privacy-denied", rule, statement.statementSha256));
      }
      const assertion = acceptedAssertionForPurpose(input.assertions, statement.statementSha256, input.purpose);
      if (assertion === null)
        continue;
      const supportingEvidence = input.evidence.filter((link) => link.assertionSha256 === assertion.assertionSha256 && disclosureMatchesEvidence(input.disclosure, link) && effectiveKnowledgeRightsV1({
        decisions: input.rightsDecisions,
        purpose: input.purpose,
        subjectSha256: link.evidenceSha256
      }).includes(input.disclosure));
      if (rule.requiredEvidenceBearings.some((bearing) => !supportingEvidence.some((link) => link.bearing === bearing))) {
        violations.push(shapeViolation("evidence-missing", rule, statement.statementSha256));
      }
    }
  }
  if (resolved.some((shape) => shape.closed)) {
    for (const statement of acceptedStatements) {
      if (!ruleByPredicate.has(canonicalKey2({
        predicate: statement.predicate,
        purpose: input.purpose
      }))) {
        violations.push(shapeViolation("closed-predicate", null, statement.statementSha256));
      }
    }
  }
  const canonicalViolations = [...violations].sort((left, right) => {
    const leftKey = canonicalKey2(left);
    const rightKey = canonicalKey2(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return {
    complete: true,
    evaluatedShapeSha256s: resolved.map((shape) => shape.shapeSha256).sort(),
    passed: !canonicalViolations.some((violation) => violation.severity === "error"),
    truncation: null,
    v: 1,
    violations: canonicalViolations
  };
}
var SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 = [
  "activity",
  "assertion",
  "context",
  "dependency-manifest",
  "edition",
  "entity",
  "evidence",
  "identity-operation",
  "inquiry",
  "inquiry-event",
  "review-decision",
  "rights-decision",
  "schema",
  "shape",
  "statement",
  "type-membership",
  "view",
  "vocabulary"
];
function parseGraphRecordRefs(value, maximum = 65536) {
  if (!Array.isArray(value) || value.length > maximum)
    return null;
  const refs = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["kind", "sha256", "v"]) || item["v"] !== 1)
      return null;
    const kind = SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === item["kind"]);
    const sha256 = parseSha256Hex(item["sha256"]);
    if (kind === undefined || sha256 === null)
      return null;
    refs.push({ kind, sha256, v: 1 });
  }
  return orderedUnique(refs) ? refs : null;
}
async function createKnowledgeGraphRevisionV1(input) {
  const operationId = safeCode2(input.operationId);
  const additions = sortedUnique2(input.additions);
  if (operationId === null || additions === null || additions.length === 0 || additions.length > 8192)
    return failure2("graphRevision");
  const priorRefs = input.parent?.recordRefs ?? [];
  const byKey = new Map(priorRefs.map((ref) => [canonicalKey2(ref), ref]));
  for (const ref of additions)
    byKey.set(canonicalKey2(ref), ref);
  const recordRefs = [...byKey.values()].sort((left, right) => {
    const leftKey = canonicalKey2(left);
    const rightKey = canonicalKey2(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (recordRefs.length > 65536)
    return failure2("recordRefs", "limit-exceeded");
  const recordsSha256 = await sha256Text(canonicalKey2(recordRefs));
  const payload = {
    additions,
    operationId,
    parentGraphRevisionSha256: input.parent?.graphRevisionSha256 ?? null,
    recordRefs,
    recordsSha256,
    revision: (input.parent?.revision ?? 0) + 1,
    v: 1
  };
  return success2({ ...payload, graphRevisionSha256: await sha256Text(canonicalKey2(payload)) });
}
async function parseKnowledgeGraphRevisionV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "additions",
    "graphRevisionSha256",
    "operationId",
    "parentGraphRevisionSha256",
    "recordRefs",
    "recordsSha256",
    "revision",
    "v"
  ]) || value["v"] !== 1)
    return failure2("graphRevision");
  const additions = parseGraphRecordRefs(value["additions"], 8192);
  const graphRevisionSha256 = parseSha256Hex(value["graphRevisionSha256"]);
  const operationId = safeCode2(value["operationId"]);
  const parentGraphRevisionSha256 = value["parentGraphRevisionSha256"] === null ? null : parseSha256Hex(value["parentGraphRevisionSha256"]);
  const recordRefs = parseGraphRecordRefs(value["recordRefs"]);
  const recordsSha256 = parseSha256Hex(value["recordsSha256"]);
  const revision = positiveInteger2(value["revision"]);
  if (additions === null || additions.length === 0 || graphRevisionSha256 === null || operationId === null || value["parentGraphRevisionSha256"] !== null && parentGraphRevisionSha256 === null || recordRefs === null || recordsSha256 === null || revision === null || revision === 1 !== (parentGraphRevisionSha256 === null) || additions.some((addition) => !recordRefs.some((ref) => canonicalKey2(ref) === canonicalKey2(addition)))) {
    return failure2("graphRevision");
  }
  const expectedRecords = await sha256Text(canonicalKey2(recordRefs));
  const payload = {
    additions,
    operationId,
    parentGraphRevisionSha256,
    recordRefs,
    recordsSha256,
    revision,
    v: 1
  };
  const expectedRevision = await sha256Text(canonicalKey2(payload));
  return expectedRecords === recordsSha256 && expectedRevision === graphRevisionSha256 ? success2({ ...payload, graphRevisionSha256 }) : failure2("graphRevisionSha256", "digest-mismatch");
}
function graphRevisionRetainsEvidenceV1(prior, next) {
  if (next.parentGraphRevisionSha256 !== prior.graphRevisionSha256)
    return false;
  const nextKeys = new Set(next.recordRefs.map(canonicalKey2));
  return prior.recordRefs.every((ref) => nextKeys.has(canonicalKey2(ref)));
}
async function reduceKnowledgeGraphRevisionsV1(revisions) {
  if (revisions.length === 0 || revisions.length > 65536)
    return failure2("graphRevisions");
  const ordered = [...revisions].sort((left, right) => left.revision - right.revision);
  const operationIds = new Set;
  let parent = null;
  for (let index = 0;index < ordered.length; index += 1) {
    const current = ordered[index];
    const parsed = await parseKnowledgeGraphRevisionV1(current);
    if (!parsed.ok || current.revision !== index + 1 || current.parentGraphRevisionSha256 !== parent?.graphRevisionSha256 && parent !== null || parent === null && current.parentGraphRevisionSha256 !== null || operationIds.has(current.operationId)) {
      return failure2("graphRevisions", "dependency-missing");
    }
    const expectedByKey = new Map((parent?.recordRefs ?? []).map((ref) => [canonicalKey2(ref), ref]));
    for (const addition of current.additions)
      expectedByKey.set(canonicalKey2(addition), addition);
    const expectedRefs = [...expectedByKey.values()].sort(compareCanonical);
    if (canonicalKey2(expectedRefs) !== canonicalKey2(current.recordRefs)) {
      return failure2("graphRevisions", "dependency-missing");
    }
    operationIds.add(current.operationId);
    parent = parsed.value;
  }
  return success2(parent);
}
var SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1 = [
  "abandoned",
  "evidence-added",
  "gap-identified",
  "paused",
  "plan-proposed",
  "question-refined",
  "resolved",
  "resumed",
  "reviewed",
  "source-added",
  "statement-proposed"
];
function knowledgeInquiryTransitionEventKindV1(current, target) {
  if (current === "open" && target === "paused")
    return "paused";
  if (current === "paused" && target === "open")
    return "resumed";
  if ((current === "open" || current === "paused") && target === "resolved") {
    return "resolved";
  }
  if ((current === "open" || current === "paused") && target === "abandoned") {
    return "abandoned";
  }
  return null;
}
function knowledgeInquiryTransitionNoteV1(kind) {
  switch (kind) {
    case "abandoned":
      return "Inquiry abandoned.";
    case "paused":
      return "Inquiry paused.";
    case "resolved":
      return "Inquiry resolved.";
    case "resumed":
      return "Inquiry resumed.";
  }
}
function parseInquiryEventInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "actorEntityId",
    "inputRefs",
    "inquiryId",
    "kind",
    "note",
    "occurredAt",
    "outputRefs",
    "parentEventSha256",
    "sequence",
    "v"
  ]) || value["v"] !== 1)
    return failure2("inquiryEvent");
  const actorEntityId = parseKnowledgeEntityId(value["actorEntityId"]);
  const inputRefs = parseGraphRecordRefs(value["inputRefs"], 2048);
  const inquiryId = parseKnowledgeInquiryId(value["inquiryId"]);
  const kind = SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1.find((candidate) => candidate === value["kind"]);
  const note = value["note"] === null ? null : boundedText2(value["note"]);
  const occurredAt = parseCanonicalInstantV1(value["occurredAt"]);
  const outputRefs = parseGraphRecordRefs(value["outputRefs"], 2048);
  const parentEventSha256 = value["parentEventSha256"] === null ? null : parseSha256Hex(value["parentEventSha256"]);
  const sequence = positiveInteger2(value["sequence"]);
  return actorEntityId !== null && inputRefs !== null && inquiryId !== null && kind !== undefined && (value["note"] === null || note !== null) && occurredAt !== null && outputRefs !== null && (value["parentEventSha256"] === null || parentEventSha256 !== null) && sequence !== null && sequence === 1 === (parentEventSha256 === null) && (note !== null || inputRefs.length > 0 || outputRefs.length > 0) ? success2({
    actorEntityId,
    inputRefs,
    inquiryId,
    kind,
    note,
    occurredAt,
    outputRefs,
    parentEventSha256,
    sequence,
    v: 1
  }) : failure2("inquiryEvent");
}
async function createKnowledgeInquiryEventV1(input) {
  const inputRefs = sortedUnique2(input.inputRefs);
  const outputRefs = sortedUnique2(input.outputRefs);
  if (inputRefs === null || outputRefs === null)
    return failure2("inquiryEvent");
  const parsed = parseInquiryEventInput({ ...input, inputRefs, outputRefs });
  return parsed.ok ? success2({ ...parsed.value, eventSha256: await sha256Text(canonicalKey2(parsed.value)) }) : parsed;
}
async function parseKnowledgeInquiryEventV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "eventSha256")) {
    return failure2("inquiryEvent");
  }
  const eventSha256 = parseSha256Hex(value["eventSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "eventSha256"));
  const parsed = parseInquiryEventInput(input);
  if (eventSha256 === null || !parsed.ok)
    return failure2("inquiryEvent");
  const expected = await sha256Text(canonicalKey2(parsed.value));
  return expected === eventSha256 ? success2({ ...parsed.value, eventSha256 }) : failure2("eventSha256", "digest-mismatch");
}
async function reduceKnowledgeInquiryEventsV1(inquiry, events) {
  if (inquiry.status !== "open")
    return failure2("inquiry.status", "invalid-input");
  if (events.length > 16384)
    return failure2("events", "limit-exceeded");
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  let parent = null;
  let status = inquiry.status;
  const gaps = new Map;
  for (let index = 0;index < ordered.length; index += 1) {
    const event = ordered[index];
    const parsed = await parseKnowledgeInquiryEventV1(event);
    if (!parsed.ok || event.inquiryId !== inquiry.inquiryId || event.sequence !== index + 1 || event.parentEventSha256 !== parent)
      return failure2("events", "dependency-missing");
    const transition = event.kind === "paused" || event.kind === "resumed" || event.kind === "resolved" || event.kind === "abandoned" ? knowledgeInquiryTransitionEventKindV1(status, event.kind === "resumed" ? "open" : event.kind === "paused" ? "paused" : event.kind) : null;
    if (event.kind === "paused" || event.kind === "resumed" || event.kind === "resolved" || event.kind === "abandoned") {
      if (transition !== event.kind)
        return failure2("events", "invalid-input");
      status = event.kind === "resumed" ? "open" : event.kind;
    } else if (status !== "open") {
      return failure2("events", "invalid-input");
    }
    parent = event.eventSha256;
    if (event.kind === "gap-identified") {
      for (const ref of event.outputRefs)
        gaps.set(canonicalKey2(ref), ref);
    }
    if (event.kind === "reviewed" || event.kind === "resolved") {
      for (const ref of event.inputRefs)
        gaps.delete(canonicalKey2(ref));
    }
  }
  const payload = {
    eventSha256s: ordered.map((event) => event.eventSha256),
    gapRefs: [...gaps.values()].sort(compareCanonical),
    inquiryId: inquiry.inquiryId,
    status,
    v: 1
  };
  return success2({ ...payload, trailSha256: await sha256Text(canonicalKey2(payload)) });
}
function parseManifestInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "activitySha256s",
    "assertionSha256s",
    "candidateSha256",
    "canonicalOutputSha256",
    "contextSha256s",
    "editionId",
    "evidenceSha256s",
    "generationReceiptSha256",
    "humanReviewReceiptSha256",
    "identityReceiptSha256",
    "inputGraphRevisionSha256",
    "purpose",
    "reviewDecisionSha256s",
    "rightsDecisionSha256s",
    "rightsReceiptSha256",
    "schemaRevisionSha256s",
    "statementSha256s",
    "v",
    "viewSpecSha256"
  ]) || value["v"] !== 1)
    return failure2("dependencyManifest");
  const activitySha256s = parseShaArray2(value["activitySha256s"]);
  const assertionSha256s = parseShaArray2(value["assertionSha256s"]);
  const candidateSha256 = parseSha256Hex(value["candidateSha256"]);
  const canonicalOutputSha256 = parseSha256Hex(value["canonicalOutputSha256"]);
  const contextSha256s = parseShaArray2(value["contextSha256s"]);
  const editionId = parseKnowledgeEditionId(value["editionId"]);
  const evidenceSha256s = parseShaArray2(value["evidenceSha256s"]);
  const generationReceiptSha256 = value["generationReceiptSha256"] === null ? null : parseSha256Hex(value["generationReceiptSha256"]);
  const inputGraphRevisionSha256 = parseSha256Hex(value["inputGraphRevisionSha256"]);
  const humanReviewReceiptSha256 = parseSha256Hex(value["humanReviewReceiptSha256"]);
  const identityReceiptSha256 = parseSha256Hex(value["identityReceiptSha256"]);
  const reviewDecisionSha256s = parseShaArray2(value["reviewDecisionSha256s"]);
  const rightsDecisionSha256s = parseShaArray2(value["rightsDecisionSha256s"]);
  const rightsReceiptSha256 = parseSha256Hex(value["rightsReceiptSha256"]);
  const schemaRevisionSha256s = parseShaArray2(value["schemaRevisionSha256s"]);
  const statementSha256s = parseShaArray2(value["statementSha256s"]);
  const viewSpecSha256 = parseSha256Hex(value["viewSpecSha256"]);
  return activitySha256s !== null && assertionSha256s !== null && candidateSha256 !== null && canonicalOutputSha256 !== null && contextSha256s !== null && editionId !== null && evidenceSha256s !== null && (value["generationReceiptSha256"] === null || generationReceiptSha256 !== null) && inputGraphRevisionSha256 !== null && humanReviewReceiptSha256 !== null && identityReceiptSha256 !== null && value["purpose"] === "public-encyclopedia" && reviewDecisionSha256s !== null && reviewDecisionSha256s.length > 0 && rightsDecisionSha256s !== null && rightsDecisionSha256s.length > 0 && rightsReceiptSha256 !== null && schemaRevisionSha256s !== null && schemaRevisionSha256s.length > 0 && statementSha256s !== null && viewSpecSha256 !== null ? success2({
    activitySha256s,
    assertionSha256s,
    candidateSha256,
    canonicalOutputSha256,
    contextSha256s,
    editionId,
    evidenceSha256s,
    generationReceiptSha256,
    humanReviewReceiptSha256,
    identityReceiptSha256,
    inputGraphRevisionSha256,
    purpose: "public-encyclopedia",
    reviewDecisionSha256s,
    rightsDecisionSha256s,
    rightsReceiptSha256,
    schemaRevisionSha256s,
    statementSha256s,
    v: 1,
    viewSpecSha256
  }) : failure2("dependencyManifest");
}
async function createKnowledgeEditionDependencyManifestV1(input) {
  const parsed = parseManifestInput(input);
  return parsed.ok ? success2({ ...parsed.value, manifestSha256: await sha256Text(canonicalKey2(parsed.value)) }) : parsed;
}
async function parseKnowledgeEditionDependencyManifestV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "manifestSha256")) {
    return failure2("dependencyManifest");
  }
  const manifestSha256 = parseSha256Hex(value["manifestSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "manifestSha256"));
  const parsed = parseManifestInput(input);
  if (manifestSha256 === null || !parsed.ok)
    return failure2("dependencyManifest");
  const expected = await sha256Text(canonicalKey2(parsed.value));
  return expected === manifestSha256 ? success2({ ...parsed.value, manifestSha256 }) : failure2("manifestSha256", "digest-mismatch");
}
function verifyKnowledgeEditionDependencyCompletenessV1(input) {
  const { candidate, edition, humanReviewReceipt, manifest } = input;
  const required = [
    manifest.inputGraphRevisionSha256,
    manifest.identityReceiptSha256,
    manifest.candidateSha256,
    manifest.canonicalOutputSha256,
    manifest.viewSpecSha256,
    manifest.humanReviewReceiptSha256,
    manifest.rightsReceiptSha256,
    ...manifest.generationReceiptSha256 === null ? [] : [manifest.generationReceiptSha256],
    ...manifest.activitySha256s,
    ...manifest.assertionSha256s,
    ...manifest.contextSha256s,
    ...manifest.evidenceSha256s,
    ...manifest.reviewDecisionSha256s,
    ...manifest.rightsDecisionSha256s,
    ...manifest.schemaRevisionSha256s,
    ...manifest.statementSha256s
  ];
  const candidateSupport = candidate.passages.flatMap((passage) => passage.supportStatementSha256s);
  const exact = edition.editionId === manifest.editionId && candidate.editionId === manifest.editionId && edition.dependencyManifestSha256 === manifest.manifestSha256 && edition.candidateSha256 === candidate.candidateSha256 && edition.candidateSha256 === manifest.candidateSha256 && edition.inputGraphRevisionSha256 === manifest.inputGraphRevisionSha256 && candidate.inputGraphRevisionSha256 === manifest.inputGraphRevisionSha256 && candidate.identityReceiptSha256 === manifest.identityReceiptSha256 && candidate.canonicalOutputSha256 === manifest.canonicalOutputSha256 && candidate.viewSpecSha256 === manifest.viewSpecSha256 && candidate.generationReceiptSha256 === manifest.generationReceiptSha256 && edition.humanReviewReceiptSha256 === manifest.humanReviewReceiptSha256 && edition.reviewDecisionSha256 === humanReviewReceipt.decisionSha256 && manifest.reviewDecisionSha256s.includes(edition.reviewDecisionSha256) && humanReviewReceipt.candidateSha256 === candidate.candidateSha256 && humanReviewReceipt.receiptSha256 === manifest.humanReviewReceiptSha256 && candidate.rightsReceiptSha256 === manifest.rightsReceiptSha256 && canonicalKey2(candidate.assertionSha256s) === canonicalKey2(manifest.assertionSha256s) && canonicalKey2(candidate.evidenceSha256s) === canonicalKey2(manifest.evidenceSha256s) && canonicalKey2(candidate.statementSha256s) === canonicalKey2(manifest.statementSha256s) && candidateSupport.every((sha256) => manifest.statementSha256s.includes(sha256)) && candidate.unresolvedStatementSha256s.every((sha256) => manifest.statementSha256s.includes(sha256));
  return exact && required.every((sha256) => input.availableSha256s.has(sha256)) ? success2(manifest) : failure2("dependencyManifest", "dependency-missing");
}
function validTraversalBudget(value) {
  return positiveInteger2(value.bytes) !== null && positiveInteger2(value.depth, true) !== null && positiveInteger2(value.edges) !== null && positiveInteger2(value.nodes) !== null && positiveInteger2(value.work) !== null;
}
function traverseKnowledgeGraphV1(input) {
  if (!validTraversalBudget(input.budget) || input.edges.length > 1e6) {
    return failure2("traversalBudget");
  }
  const authorizedByStatement = new Map;
  for (const edge of input.edges) {
    if (!input.authorizedStatementSha256s.has(edge.statementSha256))
      continue;
    const prior = authorizedByStatement.get(edge.statementSha256);
    if (prior !== undefined && canonicalKey2(prior) !== canonicalKey2(edge)) {
      return failure2("edges", "authority-violation");
    }
    authorizedByStatement.set(edge.statementSha256, edge);
  }
  const authorizedEdges = [...authorizedByStatement.values()].sort(compareCanonical);
  const outgoing = new Map;
  for (const edge of authorizedEdges) {
    const bucket = outgoing.get(edge.fromEntityId) ?? [];
    bucket.push(edge);
    outgoing.set(edge.fromEntityId, bucket);
  }
  const visited = new Set([input.rootEntityId]);
  const queued = new Set([input.rootEntityId]);
  const queue = [
    { depth: 0, entityId: input.rootEntityId }
  ];
  const selected = [];
  const frontier = new Set;
  const truncations = new Set;
  let bytes = 0;
  let work = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined)
      break;
    const edges = outgoing.get(current.entityId) ?? [];
    if (current.depth >= input.budget.depth && edges.some((edge) => !visited.has(edge.toEntityId))) {
      truncations.add("depth-budget");
      frontier.add(current.entityId);
      continue;
    }
    for (const edge of edges) {
      if (work >= input.budget.work) {
        truncations.add("work-budget");
        frontier.add(current.entityId);
        break;
      }
      work += 1;
      if (selected.length >= input.budget.edges) {
        truncations.add("edge-budget");
        frontier.add(current.entityId);
        break;
      }
      const encodedBytes = utf8ByteLength(canonicalKey2(edge));
      if (bytes + encodedBytes > input.budget.bytes) {
        truncations.add("byte-budget");
        frontier.add(current.entityId);
        break;
      }
      const discoversNode = !visited.has(edge.toEntityId);
      if (discoversNode && visited.size >= input.budget.nodes) {
        truncations.add("node-budget");
        frontier.add(edge.toEntityId);
        continue;
      }
      selected.push(edge);
      bytes += encodedBytes;
      if (discoversNode) {
        visited.add(edge.toEntityId);
        if (!queued.has(edge.toEntityId)) {
          queued.add(edge.toEntityId);
          queue.push({ depth: current.depth + 1, entityId: edge.toEntityId });
        }
      }
    }
  }
  const result = {
    complete: truncations.size === 0,
    edges: selected,
    frontierEntityIds: [...frontier].sort(),
    nodeEntityIds: [...visited].sort(),
    truncations: [...truncations].sort(),
    v: 1,
    work
  };
  return success2(result);
}
function parsedGraphRecord(kind, recordSha256, value) {
  return success2({ kind, recordSha256, value, v: 1 });
}
async function parseKnowledgeGraphRecordV1(kind, value) {
  switch (kind) {
    case "activity": {
      const parsed = await parseKnowledgeActivityV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.activitySha256, parsed.value);
    }
    case "assertion": {
      const parsed = await parseKnowledgeAssertionV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.assertionSha256, parsed.value);
    }
    case "context": {
      const parsed = await parseKnowledgeContextV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.contextSha256, parsed.value);
    }
    case "dependency-manifest": {
      const parsed = await parseKnowledgeEditionDependencyManifestV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.manifestSha256, parsed.value);
    }
    case "edition": {
      const parsed = await parseKnowledgeEditionV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.editionSha256, parsed.value);
    }
    case "entity": {
      const parsed = parseKnowledgeEntityV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      const recordSha256 = await sha256Text(canonicalKey2(parsed.value));
      return parsedGraphRecord(kind, recordSha256, parsed.value);
    }
    case "evidence": {
      const parsed = await parseKnowledgeEvidenceLinkV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.evidenceSha256, parsed.value);
    }
    case "identity-operation": {
      const parsed = await parseKnowledgeIdentityOperationV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.operationSha256, parsed.value);
    }
    case "inquiry": {
      const parsed = await parseKnowledgeInquiryV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.inquirySha256, parsed.value);
    }
    case "inquiry-event": {
      const parsed = await parseKnowledgeInquiryEventV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.eventSha256, parsed.value);
    }
    case "review-decision": {
      const parsed = await parseKnowledgeReviewDecisionV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.decisionSha256, parsed.value);
    }
    case "rights-decision": {
      const parsed = await parseKnowledgeRightsDecisionV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.decisionSha256, parsed.value);
    }
    case "schema": {
      const parsed = await parseKnowledgeSchemaRevisionV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.revisionSha256, parsed.value);
    }
    case "shape": {
      const parsed = await parseKnowledgeExecutableShapeV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.shapeSha256, parsed.value);
    }
    case "statement": {
      const parsed = await parseKnowledgeStatementV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.statementSha256, parsed.value);
    }
    case "type-membership": {
      const parsed = await parseKnowledgeTypeMembershipV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.membershipSha256, parsed.value);
    }
    case "view": {
      const parsed = await parseKnowledgeViewSpecV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.viewSpecSha256, parsed.value);
    }
    case "vocabulary": {
      const parsed = await parseKnowledgeVocabularyRevisionV1(value);
      if (!parsed.ok)
        return failure2(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.revisionSha256, parsed.value);
    }
    default: {
      const exhaustive = kind;
      return failure2(`recordKind:${String(exhaustive)}`);
    }
  }
}
var SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1 = [
  "activity",
  "context",
  "review-decision",
  "rights-decision",
  "statement",
  "type-membership",
  "view"
];
function callerRecordKey(value) {
  return typeof value === "string" && value.length <= 512 && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function knowledgeGraphRecordKeyV1(kind, value, requiredCallerRecordKey) {
  const explicit = callerRecordKey(requiredCallerRecordKey);
  switch (kind) {
    case "activity":
    case "context":
    case "review-decision":
    case "rights-decision":
    case "statement":
    case "type-membership":
    case "view":
      return explicit === null ? failure2("recordKey") : success2(`${kind}:${explicit}`);
    case "assertion":
      return success2(`assertion:${value.assertionId}`);
    case "dependency-manifest":
      return success2(`dependency-manifest:${value.editionId}`);
    case "edition":
      return success2(`edition:${value.editionId}`);
    case "entity":
      return success2(`entity:${value.entityId}`);
    case "evidence":
      return success2(`evidence:${value.evidenceId}`);
    case "identity-operation":
      return success2(`identity-operation:${value.operationId}`);
    case "inquiry":
      return success2(`inquiry:${value.inquiryId}`);
    case "inquiry-event": {
      const event = value;
      return success2(`inquiry-event:${event.inquiryId}:${String(event.sequence)}`);
    }
    case "schema": {
      const identity = value.identity;
      return success2(`schema:${identity.namespace}:${identity.code}:${String(identity.revision)}`);
    }
    case "shape": {
      const ref = value.shape;
      return success2(`shape:${ref.namespace}:${ref.code}:${String(ref.revision)}`);
    }
    case "vocabulary": {
      const vocabulary = value;
      return success2(`vocabulary:${vocabulary.namespace}:${String(vocabulary.revision)}`);
    }
    default: {
      const exhaustive = kind;
      return failure2(`recordKind:${String(exhaustive)}`);
    }
  }
}

// src/research/knowledge-declarative-json.ts
function knowledgeDeclarativeJson(value, maximumBytes = 2097152, options = {}) {
  let nodes = 0;
  let bytes = 0;
  function reserve(count) {
    bytes += count;
    return bytes <= maximumBytes;
  }
  function copy(item, depth) {
    if (++nodes > (options.maxNodes ?? 1e5) || depth > (options.maxDepth ?? 24))
      return;
    if (item === null || typeof item === "boolean")
      return reserve(item === null ? 4 : item ? 4 : 5) ? item : undefined;
    if (typeof item === "string") {
      return item.length <= maximumBytes && reserve(utf8ByteLength(JSON.stringify(item))) && (options.preserveStrings === true || item.normalize("NFC") === item && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ud800-\udfff]/u.test(item)) ? item : undefined;
    }
    if (typeof item === "number")
      return Number.isFinite(item) && reserve(String(item).length) ? item : undefined;
    if (Array.isArray(item)) {
      if (item.length > (options.maxArrayItems ?? 8192) || Reflect.ownKeys(item).length !== item.length + 1 || !reserve(2 + Math.max(0, item.length - 1)))
        return;
      const result2 = [];
      for (let index = 0;index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable)
          return;
        const child = copy(descriptor.value, depth + 1);
        if (child === undefined)
          return;
        result2.push(child);
      }
      return result2;
    }
    if (!isPlainRecord(item))
      return;
    const keys = Object.keys(item);
    if (!hasExactDataKeys(item, keys) || !reserve(2 + Math.max(0, keys.length - 1)))
      return;
    const result = Object.create(null);
    for (const key of keys) {
      if (options.preserveObjectKeys !== true && (key === "__proto__" || key === "constructor" || key === "prototype") || key.length > maximumBytes || !reserve(utf8ByteLength(JSON.stringify(key)) + 1))
        return;
      const child = copy(item[key], depth + 1);
      if (child === undefined)
        return;
      result[key] = child;
    }
    return result;
  }
  try {
    const result = copy(value, 0);
    return result !== undefined && utf8ByteLength(canonicalJson(result)) <= maximumBytes ? result : undefined;
  } catch {
    return;
  }
}
function freezeKnowledgeDeclaration(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value))
      freezeKnowledgeDeclaration(child);
    Object.freeze(value);
  }
  return value;
}

// src/research/research-packet.ts
var OH_RESEARCH_PACKET_PROFILE_V1 = "oh.research-packet.v1";
var OH_RESEARCH_PACKET_LIMITS_V1 = Object.freeze({
  records: 1024,
  sourceBytes: 8 * 1024 * 1024,
  packetBytes: 16 * 1024 * 1024,
  recordBytes: 1024 * 1024,
  dependenciesPerRecord: 4096
});
var prepared = new WeakSet;
var callerKinds = new Set(SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1);
function json(value) {
  return canonicalJson(value);
}
function fail(message) {
  throw new TypeError(`Invalid research packet: ${message}`);
}
function ohResearchRecordKeyV1(kind, sourceSha256, sourceBindingSha256) {
  if (!SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind) || parseSha256Hex(sourceSha256) === null || parseSha256Hex(sourceBindingSha256) === null)
    fail("record key");
  return `research.v1/${sourceBindingSha256}/${kind}/${sourceSha256}`;
}
function isPreparedOhResearchPacketV1(value) {
  return typeof value === "object" && value !== null && prepared.has(value);
}
function references(source) {
  const value = source.value;
  const result = [];
  const add = (candidate, expectedKind = null) => {
    if (candidate === null || candidate === undefined)
      return;
    const sha256 = parseSha256Hex(candidate);
    if (sha256 === null)
      fail("dependency digest");
    if (sha256 !== source.recordSha256)
      result.push({ sha256, expectedKind });
  };
  const many = (candidate, expectedKind = null) => {
    if (!Array.isArray(candidate))
      fail("dependency list");
    for (const item of candidate)
      add(item, expectedKind);
  };
  switch (source.kind) {
    case "activity":
      many(value["inputSha256s"]);
      many(value["outputSha256s"]);
      break;
    case "assertion":
      add(value["statementSha256"], "statement");
      add(value["provenanceActivitySha256"], "activity");
      add(value["reviewActivitySha256"], "activity");
      add(value["contextSha256"], "context");
      break;
    case "dependency-manifest":
      for (const [field, kind] of [
        ["activitySha256s", "activity"],
        ["assertionSha256s", "assertion"],
        ["contextSha256s", "context"],
        ["evidenceSha256s", "evidence"],
        ["reviewDecisionSha256s", "review-decision"],
        ["rightsDecisionSha256s", "rights-decision"],
        ["schemaRevisionSha256s", "schema"],
        ["statementSha256s", "statement"]
      ])
        many(value[field], kind);
      add(value["viewSpecSha256"], "view");
      break;
    case "edition":
      add(value["dependencyManifestSha256"], "dependency-manifest");
      add(value["reviewDecisionSha256"], "review-decision");
      break;
    case "evidence":
      add(value["assertionSha256"], "assertion");
      add(value["provenanceActivitySha256"], "activity");
      break;
    case "identity-operation":
      add(value["activitySha256"], "activity");
      break;
    case "inquiry":
      add(value["contextSha256"], "context");
      break;
    case "inquiry-event":
      add(value["parentEventSha256"], "inquiry-event");
      for (const ref of [...value["inputRefs"], ...value["outputRefs"]]) {
        if (isPlainRecord(ref))
          add(ref["sha256"], ref["kind"]);
      }
      break;
    case "review-decision":
      if (value["subjectKind"] !== "synthesis-candidate")
        add(value["subjectSha256"], value["subjectKind"]);
      add(value["supersedesDecisionSha256"], "review-decision");
      break;
    case "rights-decision":
      add(value["subjectSha256"]);
      break;
    case "schema":
      add(value["previousRevisionSha256"], "schema");
      add(value["reviewDecisionSha256"], "review-decision");
      add(value["vocabularySha256"], "vocabulary");
      add(value["mappingActivitySha256"], "activity");
      break;
    case "type-membership":
      add(value["assertionSha256"], "assertion");
      add(value["contextSha256"], "context");
      break;
    case "vocabulary":
      add(value["previousRevisionSha256"], "vocabulary");
      break;
    case "view":
      many(value["includedContextSha256s"], "context");
      many(value["excludedContextSha256s"], "context");
      break;
    case "context":
    case "entity":
    case "shape":
    case "statement":
      break;
  }
  function visit(item) {
    if (Array.isArray(item)) {
      for (const child of item)
        visit(child);
      return;
    }
    if (!isPlainRecord(item))
      return;
    if (hasExactDataKeys(item, ["code", "namespace", "revision", "schemaSha256", "v"])) {
      const sha256 = parseSha256Hex(item["schemaSha256"]);
      if (sha256 === null)
        fail("schema reference");
      if (sha256 !== source.recordSha256)
        result.push({ sha256, expectedKind: "schema", schemaRef: item });
      return;
    }
    for (const child of Object.values(item))
      visit(child);
  }
  visit(source.value);
  if (result.length > OH_RESEARCH_PACKET_LIMITS_V1.dependenciesPerRecord)
    fail("dependency bound");
  return result;
}
async function prepareOhResearchPacketV1(foreign) {
  const input = knowledgeDeclarativeJson(foreign, OH_RESEARCH_PACKET_LIMITS_V1.sourceBytes, { maxDepth: 64, maxNodes: 500000 });
  if (!isPlainRecord(input) || !hasExactDataKeys(input, ["records"]) || !Array.isArray(input["records"]) || input["records"].length < 1 || input["records"].length > OH_RESEARCH_PACKET_LIMITS_V1.records)
    fail("input bounds");
  const sources = [];
  const bySha = new Map;
  for (const candidate of input["records"]) {
    if (!isPlainRecord(candidate))
      fail("source record");
    const hasCallerKey = Object.hasOwn(candidate, "callerRecordKey");
    if (!hasExactDataKeys(candidate, hasCallerKey ? ["callerRecordKey", "kind", "value"] : ["kind", "value"]))
      fail("source keys");
    const kind = SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((kind2) => kind2 === candidate["kind"]);
    if (kind === undefined || hasCallerKey !== callerKinds.has(kind))
      fail("source kind or caller key");
    const parsed = await parseKnowledgeGraphRecordV1(kind, candidate["value"]);
    if (!parsed.ok || json(parsed.value.value) !== json(candidate["value"]))
      fail("source codec or canonical bytes");
    const key = knowledgeGraphRecordKeyV1(kind, parsed.value.value, candidate["callerRecordKey"]);
    if (!key.ok)
      fail("source logical key");
    const source = {
      kind,
      recordKey: key.value,
      recordSha256: parsed.value.recordSha256,
      value: parsed.value.value
    };
    if (bySha.has(source.recordSha256))
      fail("duplicate source digest");
    bySha.set(source.recordSha256, source);
    sources.push(source);
  }
  const bindings = sources.map(({ kind, recordKey, recordSha256 }) => ({ kind, recordKey, recordSha256 })).sort((a, b) => json(a) < json(b) ? -1 : 1);
  const sourceBindingSha256 = await sha256Text(json({ profile: OH_RESEARCH_PACKET_PROFILE_V1, bindings, v: 1 }));
  const keys = new Map;
  for (const source of sources)
    keys.set(source.recordSha256, ohResearchRecordKeyV1(source.kind, source.recordSha256, sourceBindingSha256));
  const records = [];
  for (const source of sources) {
    const dependencies = new Set;
    for (const ref of references(source)) {
      const target = bySha.get(ref.sha256);
      if (target === undefined)
        fail(`missing dependency ${ref.sha256}`);
      if (ref.expectedKind !== null && target.kind !== ref.expectedKind)
        fail("dependency kind");
      if (ref.schemaRef !== undefined && (!isPlainRecord(target.value) || json(target.value["ref"]) !== json(ref.schemaRef)))
        fail("exact schema reference");
      dependencies.add(keys.get(target.recordSha256));
    }
    const value = { profile: OH_RESEARCH_PACKET_PROFILE_V1, source, v: 1 };
    if (utf8ByteLength(json(value)) > OH_RESEARCH_PACKET_LIMITS_V1.recordBytes)
      fail("record bytes");
    const payload2 = {
      dependencies: [...dependencies].sort(),
      key: keys.get(source.recordSha256),
      kind: source.kind,
      v: 1,
      value
    };
    records.push({ ...payload2, recordSha256: await sha256Text(json(payload2)) });
  }
  records.sort((a, b) => a.key < b.key ? -1 : 1);
  const payload = {
    profile: OH_RESEARCH_PACKET_PROFILE_V1,
    dependencyPolicy: "explicit-source-digests-and-schema-refs.v1",
    authority: "unasserted",
    sourceBindingSha256,
    records,
    v: 1
  };
  const packet = { ...payload, packetSha256: await sha256Text(json(payload)) };
  if (utf8ByteLength(json(packet)) > OH_RESEARCH_PACKET_LIMITS_V1.packetBytes)
    fail("packet bytes");
  const canonicalPacket = JSON.parse(json(packet));
  freezeKnowledgeDeclaration(canonicalPacket);
  prepared.add(canonicalPacket);
  return canonicalPacket;
}
async function verifyOhResearchPacketV1(foreign) {
  try {
    const packet = knowledgeDeclarativeJson(foreign, OH_RESEARCH_PACKET_LIMITS_V1.packetBytes, { maxDepth: 72, maxNodes: 750000 });
    if (!isPlainRecord(packet) || !hasExactDataKeys(packet, ["authority", "dependencyPolicy", "packetSha256", "profile", "sourceBindingSha256", "records", "v"]) || !Array.isArray(packet["records"]) || packet["records"].length > OH_RESEARCH_PACKET_LIMITS_V1.records)
      return null;
    const records = packet["records"].map((record) => {
      if (!isPlainRecord(record) || !isPlainRecord(record["value"]))
        fail("envelope");
      const value = record["value"];
      if (!hasExactDataKeys(value, ["profile", "source", "v"]) || !isPlainRecord(value["source"]))
        fail("source wrapper");
      const source = value["source"];
      if (!hasExactDataKeys(source, ["kind", "recordKey", "recordSha256", "value"]))
        fail("source envelope");
      const kind = source["kind"];
      return { kind, value: source["value"], ...callerKinds.has(kind) ? { callerRecordKey: typeof source["recordKey"] === "string" ? source["recordKey"].slice(String(source["kind"]).length + 1) : undefined } : {} };
    });
    const expected = await prepareOhResearchPacketV1({ records });
    return json(expected) === json(packet) ? expected : null;
  } catch {
    return null;
  }
}

export { parseJsonValue, canonicalJson, SPONGE_SHA256_HEX_PATTERN, SPONGE_CANONICAL_INSTANT_PATTERN, compareUtf16CodeUnits, parseSha256Hex, parseCanonicalInstantV1, utf8ByteLength, sha256Hex, sha256Text, isRecord2 as isRecord, isJsonRecord, isPlainRecord, exactKeys, hasExactDataKeys, SPONGE_KNOWLEDGE_LIMITS_V1, SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1, SPONGE_KNOWLEDGE_KERNEL_CONCEPTS_V1, parseKnowledgeEntityId, parseKnowledgeAssertionId, parseKnowledgeEvidenceId, parseKnowledgeInquiryId, parseKnowledgeEditionId, SPONGE_KNOWLEDGE_ENTITY_STATES_V1, parseKnowledgeEntityV1, parseKnowledgeSchemaRefV1, parseKnowledgeValueV1, verifyKnowledgeValueV1, SPONGE_KNOWLEDGE_SCENARIOS_V1, createKnowledgeContextV1, parseKnowledgeContextV1, createKnowledgeStatementV1, parseKnowledgeStatementV1, SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1, createKnowledgeActivityV1, parseKnowledgeActivityV1, SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1, SPONGE_KNOWLEDGE_ASSERTION_STATES_V1, createKnowledgeAssertionV1, parseKnowledgeAssertionV1, SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1, createKnowledgeEvidenceLinkV1, parseKnowledgeEvidenceLinkV1, createKnowledgeInquiryV1, parseKnowledgeInquiryV1, createKnowledgeShapeV1, parseKnowledgeShapeV1, createKnowledgeViewSpecV1, parseKnowledgeViewSpecV1, createKnowledgeSynthesisCandidateV1, parseKnowledgeSynthesisCandidateV1, createKnowledgeHumanReviewReceiptV1, parseKnowledgeHumanReviewReceiptV1, createKnowledgeEditionV1, parseKnowledgeEditionV1, createKnowledgeEditionReleaseV1, parseKnowledgeEditionReleaseV1, parseKnowledgeValueRangeV1, createKnowledgeVocabularyRevisionV1, parseKnowledgeVocabularyRevisionV1, createKnowledgeSchemaRevisionV1, parseKnowledgeSchemaRevisionV1, verifyKnowledgeSchemaEvolutionV1, SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1, createKnowledgeIdentityOperationV1, parseKnowledgeIdentityOperationV1, verifyKnowledgeIdentityOperationAgainstHeadsV1, createKnowledgeTypeMembershipV1, parseKnowledgeTypeMembershipV1, SPONGE_KNOWLEDGE_DISCLOSURES_V1, createKnowledgeRightsDecisionV1, parseKnowledgeRightsDecisionV1, effectiveKnowledgeRightsV1, SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1, createKnowledgeReviewDecisionV1, parseKnowledgeReviewDecisionV1, effectiveKnowledgeReviewV1, createKnowledgeExecutableShapeV1, parseKnowledgeExecutableShapeV1, evaluateKnowledgeShapeV1, SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1, createKnowledgeGraphRevisionV1, parseKnowledgeGraphRevisionV1, graphRevisionRetainsEvidenceV1, reduceKnowledgeGraphRevisionsV1, SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1, knowledgeInquiryTransitionEventKindV1, knowledgeInquiryTransitionNoteV1, createKnowledgeInquiryEventV1, parseKnowledgeInquiryEventV1, reduceKnowledgeInquiryEventsV1, createKnowledgeEditionDependencyManifestV1, parseKnowledgeEditionDependencyManifestV1, verifyKnowledgeEditionDependencyCompletenessV1, traverseKnowledgeGraphV1, parseKnowledgeGraphRecordV1, SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1, knowledgeGraphRecordKeyV1, knowledgeDeclarativeJson, freezeKnowledgeDeclaration, OH_RESEARCH_PACKET_PROFILE_V1, OH_RESEARCH_PACKET_LIMITS_V1, ohResearchRecordKeyV1, isPreparedOhResearchPacketV1, prepareOhResearchPacketV1, verifyOhResearchPacketV1 };
