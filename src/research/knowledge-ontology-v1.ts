import { canonicalJson, type JsonValue } from "./document-domain";
import {
  parseCanonicalInstantV1,
  parseSha256Hex,
  sha256Text,
  utf8ByteLength,
  type Sha256Hex,
} from "./integrity-domain";
import { hasExactKeys, isPlainRecord } from "./unknown";

declare const knowledgeEntityIdBrand: unique symbol;
declare const knowledgeAssertionIdBrand: unique symbol;
declare const knowledgeEvidenceIdBrand: unique symbol;
declare const knowledgeInquiryIdBrand: unique symbol;
declare const knowledgeEditionIdBrand: unique symbol;

export type KnowledgeEntityId = string & {
  readonly [knowledgeEntityIdBrand]: "KnowledgeEntityId";
};
export type KnowledgeAssertionId = string & {
  readonly [knowledgeAssertionIdBrand]: "KnowledgeAssertionId";
};
export type KnowledgeEvidenceId = string & {
  readonly [knowledgeEvidenceIdBrand]: "KnowledgeEvidenceId";
};
export type KnowledgeInquiryId = string & {
  readonly [knowledgeInquiryIdBrand]: "KnowledgeInquiryId";
};
export type KnowledgeEditionId = string & {
  readonly [knowledgeEditionIdBrand]: "KnowledgeEditionId";
};

export const SPONGE_KNOWLEDGE_LIMITS_V1 = Object.freeze({
  acceptedPurposes: 32,
  contexts: 128,
  dimensions: 64,
  evidence: 1_024,
  extensionBytes: 64 * 1_024,
  geometryPoints: 4_096,
  listValues: 256,
  passages: 512,
  qualifiers: 128,
  references: 2_048,
  statementBytes: 256 * 1_024,
  textBytes: 64 * 1_024,
});

/** The single purpose under which a synthesis may become a public edition. */
export const SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1 = "public-encyclopedia" as const;

export const SPONGE_KNOWLEDGE_KERNEL_CONCEPTS_V1 = [
  {
    code: "entity",
    description: "A stable identity anchor for something that can be referred to.",
    label: "Entity",
  },
  {
    code: "statement",
    description: "An immutable proposition with a subject, predicate, object, and qualifiers.",
    label: "Statement",
  },
  {
    code: "assertion",
    description: "An attributable stance toward a statement for a particular purpose.",
    label: "Assertion",
  },
  {
    code: "evidence",
    description: "A typed account of how a source or observation bears on an assertion.",
    label: "Evidence",
  },
  {
    code: "context",
    description: "The time, place, language, perspective, or scenario in which knowledge applies.",
    label: "Context",
  },
  {
    code: "inquiry",
    description: "A human question and the durable trail of investigation it creates.",
    label: "Inquiry",
  },
  {
    code: "projection",
    description: "A reproducible view or immutable edition derived from exact knowledge and policy.",
    label: "Projection",
  },
] as const;

export type KnowledgeOntologyIssueCode =
  | "authority-violation"
  | "cycle-detected"
  | "dependency-missing"
  | "digest-mismatch"
  | "invalid-input"
  | "limit-exceeded"
  | "noncanonical-input"
  | "truncated";

export type KnowledgeOntologyResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
    error: Readonly<{ code: KnowledgeOntologyIssueCode; field: string }>;
    ok: false;
  }>;

function success<T>(value: T): KnowledgeOntologyResult<T> {
  return { ok: true, value };
}

function failure<T>(
  field: string,
  code: KnowledgeOntologyIssueCode = "invalid-input",
): KnowledgeOntologyResult<T> {
  return { error: { code, field }, ok: false };
}

function boundedText(
  value: unknown,
  maximumUtf8Bytes = SPONGE_KNOWLEDGE_LIMITS_V1.textBytes,
): string | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.normalize("NFC") !== value
    || utf8ByteLength(value) > maximumUtf8Bytes
  ) return null;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code <= 8
      || (code >= 11 && code <= 12)
      || (code >= 14 && code <= 31)
      || (code >= 127 && code <= 159)
      || (code >= 0xd800 && code <= 0xdfff)
    ) return null;
  }
  return value;
}

function safeCode(value: unknown, maximumLength = 96): string | null {
  return typeof value === "string"
      && value.length <= maximumLength
      && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u.test(value)
    ? value
    : null;
}

function languageTag(value: unknown): string | null {
  return typeof value === "string"
      && value.length <= 64
      && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value)
    ? value
    : null;
}

function positiveInteger(value: unknown, allowZero = false): number | null {
  return Number.isSafeInteger(value)
      && !Object.is(value, -0)
      && (value as number) >= (allowZero ? 0 : 1)
    ? value as number
    : null;
}

function parseOpaqueId<T extends string>(
  value: unknown,
  prefix: string,
): T | null {
  return typeof value === "string"
      && new RegExp(`^${prefix}[a-z0-9]{24}$`, "u").test(value)
    ? value as T
    : null;
}

export function parseKnowledgeEntityId(value: unknown): KnowledgeEntityId | null {
  return parseOpaqueId<KnowledgeEntityId>(value, "kent_");
}

export function parseKnowledgeAssertionId(
  value: unknown,
): KnowledgeAssertionId | null {
  return parseOpaqueId<KnowledgeAssertionId>(value, "kast_");
}

export function parseKnowledgeEvidenceId(
  value: unknown,
): KnowledgeEvidenceId | null {
  return parseOpaqueId<KnowledgeEvidenceId>(value, "kevd_");
}

export function parseKnowledgeInquiryId(
  value: unknown,
): KnowledgeInquiryId | null {
  return parseOpaqueId<KnowledgeInquiryId>(value, "kinq_");
}

export function parseKnowledgeEditionId(
  value: unknown,
): KnowledgeEditionId | null {
  return parseOpaqueId<KnowledgeEditionId>(value, "kedn_");
}

export const SPONGE_KNOWLEDGE_ENTITY_STATES_V1 = [
  "active", "quarantined", "redirected", "tombstoned",
] as const;
export type KnowledgeEntityStateV1 =
  (typeof SPONGE_KNOWLEDGE_ENTITY_STATES_V1)[number];

export type KnowledgeEntityV1 = Readonly<{
  entityId: KnowledgeEntityId;
  identityOperationId: string;
  identityRevision: number;
  redirectEntityId: KnowledgeEntityId | null;
  state: KnowledgeEntityStateV1;
  v: 1;
}>;

export function parseKnowledgeEntityV1(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeEntityV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "entityId", "identityOperationId", "identityRevision",
    "redirectEntityId", "state", "v",
  ]) || value["v"] !== 1) return failure("entity");
  const entityId = parseKnowledgeEntityId(value["entityId"]);
  const identityOperationId = safeCode(value["identityOperationId"], 128);
  const identityRevision = positiveInteger(value["identityRevision"]);
  const redirectEntityId = value["redirectEntityId"] === null
    ? null
    : parseKnowledgeEntityId(value["redirectEntityId"]);
  const state = SPONGE_KNOWLEDGE_ENTITY_STATES_V1.find(
    (candidate) => candidate === value["state"],
  );
  return entityId !== null && identityOperationId !== null
      && identityRevision !== null
      && (value["redirectEntityId"] === null || redirectEntityId !== null)
      && state !== undefined
      && ((state === "redirected") === (redirectEntityId !== null))
      && redirectEntityId !== entityId
    ? success({ entityId, identityOperationId, identityRevision,
      redirectEntityId, state, v: 1 })
    : failure("entity");
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function canonicalKey(value: unknown): string {
  return canonicalJson(asJson(value));
}

function isOrderedUnique<T>(
  values: readonly T[],
  key: (value: T) => string = canonicalKey,
): boolean {
  return values.every((value, index) => (
    index === 0 || key(values[index - 1] as T) < key(value)
  ));
}

function sortedUnique<T>(values: readonly T[], key = canonicalKey): readonly T[] {
  const sorted = [...values].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (!isOrderedUnique(sorted, key)) throw new Error("Duplicate canonical value.");
  return sorted;
}

export type KnowledgeSchemaRefV1 = Readonly<{
  code: string;
  namespace: string;
  revision: number;
  schemaSha256: Sha256Hex;
  v: 1;
}>;

export function parseKnowledgeSchemaRefV1(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeSchemaRefV1> {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, ["code", "namespace", "revision", "schemaSha256", "v"])
    || value["v"] !== 1
  ) return failure("schemaRef");
  const code = safeCode(value["code"]);
  const namespace = safeCode(value["namespace"], 128);
  const revision = positiveInteger(value["revision"]);
  const schemaSha256 = parseSha256Hex(value["schemaSha256"]);
  return code !== null && namespace !== null && revision !== null
      && schemaSha256 !== null
    ? success({ code, namespace, revision, schemaSha256, v: 1 })
    : failure("schemaRef");
}

export type KnowledgeTemporalPrecisionV1 =
  | "day"
  | "minute"
  | "millisecond"
  | "month"
  | "second"
  | "year";

export type KnowledgeTemporalValueV1 = Readonly<{
  calendar: KnowledgeSchemaRefV1;
  certainty: "after" | "approximate" | "before" | "between" | "exact";
  earliest: string | null;
  kind: "time";
  latest: string | null;
  precision: KnowledgeTemporalPrecisionV1;
  timezone: string | null;
  v: 1;
  value: string;
}>;

export type KnowledgeQuantityUncertaintyV1 = Readonly<{
  kind: "absolute" | "relative";
  minus: string;
  plus: string;
  v: 1;
}>;

export type KnowledgeGeometryPointV1 = readonly [string, string]
  | readonly [string, string, string];

export type KnowledgeValueV1 =
  | Readonly<{ entityId: KnowledgeEntityId; kind: "entity"; v: 1 }>
  | Readonly<{ kind: "text"; language: string; text: string; v: 1 }>
  | Readonly<{ kind: "string"; v: 1; value: string }>
  | Readonly<{ kind: "boolean"; v: 1; value: boolean }>
  | Readonly<{ kind: "integer"; v: 1; value: string }>
  | Readonly<{ kind: "decimal"; v: 1; value: string }>
  | Readonly<{
    kind: "quantity";
    lowerBound: string | null;
    uncertainty: KnowledgeQuantityUncertaintyV1 | null;
    unit: KnowledgeSchemaRefV1;
    upperBound: string | null;
    v: 1;
    value: string;
  }>
  | KnowledgeTemporalValueV1
  | Readonly<{
    end: KnowledgeTemporalValueV1 | null;
    kind: "interval";
    start: KnowledgeTemporalValueV1 | null;
    v: 1;
  }>
  | Readonly<{ iso8601: string; kind: "duration"; v: 1 }>
  | Readonly<{
    calendar: KnowledgeSchemaRefV1;
    kind: "recurrence";
    rule: string;
    startsAt: KnowledgeTemporalValueV1 | null;
    v: 1;
  }>
  | Readonly<{
    coordinates: readonly KnowledgeGeometryPointV1[];
    crs: KnowledgeSchemaRefV1;
    geometryType: "line-string" | "point" | "polygon";
    kind: "geometry";
    precisionMeters: string | null;
    v: 1;
  }>
  | Readonly<{ kind: "uri"; uri: string; v: 1 }>
  | Readonly<{
    kind: "identifier";
    scheme: KnowledgeSchemaRefV1;
    v: 1;
    value: string;
  }>
  | Readonly<{
    kind: "media";
    mediaType: string;
    sourceEntityId: KnowledgeEntityId;
    sourceSha256: Sha256Hex;
    v: 1;
  }>
  | Readonly<{ kind: "list"; v: 1; values: readonly KnowledgeValueV1[] }>
  | Readonly<{ kind: "set"; v: 1; values: readonly KnowledgeValueV1[] }>
  | Readonly<{
    canonicalizerSha256: Sha256Hex;
    canonicalValue: string;
    kind: "extension";
    mediaType: string;
    schema: KnowledgeSchemaRefV1;
    v: 1;
    valueSha256: Sha256Hex;
  }>;

const CANONICAL_INTEGER = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u;
const CANONICAL_DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u;

function canonicalInteger(value: unknown): string | null {
  return typeof value === "string" && value.length <= 1_024
      && CANONICAL_INTEGER.test(value)
    ? value
    : null;
}

function canonicalDecimal(value: unknown): string | null {
  return typeof value === "string" && value.length <= 1_024
      && value !== "-0" && CANONICAL_DECIMAL.test(value)
    ? value
    : null;
}

function compareCanonicalDecimals(left: string, right: string): number {
  const parts = (value: string) => {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [integer = "0", fraction = ""] = unsigned.split(".");
    return { fraction, integer, negative };
  };
  const leftParts = parts(left);
  const rightParts = parts(right);
  const scale = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const scaled = (value: ReturnType<typeof parts>) => {
    const digits = BigInt(`${value.integer}${value.fraction.padEnd(scale, "0")}`);
    return value.negative ? -digits : digits;
  };
  const leftScaled = scaled(leftParts);
  const rightScaled = scaled(rightParts);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

function nonnegativeDecimal(value: unknown): string | null {
  const parsed = canonicalDecimal(value);
  return parsed !== null && !parsed.startsWith("-") ? parsed : null;
}

function parseQuantityUncertainty(value: unknown): KnowledgeQuantityUncertaintyV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["kind", "minus", "plus", "v"])
    || value["v"] !== 1
    || (value["kind"] !== "absolute" && value["kind"] !== "relative")) return null;
  const minus = nonnegativeDecimal(value["minus"]);
  const plus = nonnegativeDecimal(value["plus"]);
  return minus === null || plus === null
    ? null
    : { kind: value["kind"], minus, plus, v: 1 };
}

function temporalLexeme(value: unknown, precision: KnowledgeTemporalPrecisionV1): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const valid = precision === "year"
    ? /^-?(?:0|[1-9][0-9]{0,8})$/u.test(value)
    : precision === "month"
      ? /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])$/u.test(value)
      : precision === "day"
        ? /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/u.test(value)
        : precision === "minute"
          ? /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u.test(value)
          : precision === "second"
            ? /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/u.test(value)
            : /^-?(?:0|[1-9][0-9]{0,8})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}$/u.test(value);
  return valid ? value : null;
}

function parseTemporalValue(value: unknown): KnowledgeTemporalValueV1 | null {
  if (
    !isPlainRecord(value)
    || !hasExactKeys(value, [
      "calendar", "certainty", "earliest", "kind", "latest", "precision",
      "timezone", "v", "value",
    ])
    || value["kind"] !== "time"
    || value["v"] !== 1
  ) return null;
  const precision = value["precision"];
  if (
    precision !== "year" && precision !== "month" && precision !== "day"
    && precision !== "minute" && precision !== "second" && precision !== "millisecond"
  ) return null;
  const calendar = parseKnowledgeSchemaRefV1(value["calendar"]);
  const certainty = value["certainty"];
  const temporal = temporalLexeme(value["value"], precision);
  const earliest = value["earliest"] === null
    ? null : temporalLexeme(value["earliest"], precision);
  const latest = value["latest"] === null
    ? null : temporalLexeme(value["latest"], precision);
  const timezone = value["timezone"] === null
    ? null
    : typeof value["timezone"] === "string"
        && /^(?:Z|[+-](?:0[0-9]|1[0-4]):[0-5][0-9])$/u.test(value["timezone"])
      ? value["timezone"]
      : null;
  if (!calendar.ok || temporal === null
    || (value["earliest"] !== null && earliest === null)
    || (value["latest"] !== null && latest === null)
    || (value["timezone"] !== null && timezone === null)
    || (timezone !== null && (precision === "year" || precision === "month" || precision === "day"))
    || (certainty !== "after" && certainty !== "approximate" && certainty !== "before"
      && certainty !== "between" && certainty !== "exact")
    || (certainty === "exact" && (earliest !== null || latest !== null))
    || (certainty === "before" && (earliest !== null || latest === null))
    || (certainty === "after" && (earliest === null || latest !== null))
    || (certainty === "between" && (earliest === null || latest === null))
    || (earliest !== null && latest !== null
      && compareCanonicalTemporalLexemes(earliest, latest) > 0)) return null;
  return { calendar: calendar.value, certainty, earliest, kind: "time", latest,
    precision, timezone, v: 1, value: temporal };
}

function compareCanonicalTemporalLexemes(left: string, right: string): number {
  const normalize = (value: string) => {
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

function canonicalDuration(value: unknown): string | null {
  return typeof value === "string" && value.length <= 128
      && /^-?P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+(?:\.\d+)?S)?)?$/u.test(value)
    ? value
    : null;
}

function canonicalRecurrenceRule(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048 || value.length === 0) return null;
  const parts = value.split(";");
  const keys: string[] = [];
  for (const part of parts) {
    const match = /^([A-Z][A-Z0-9_]*)=([A-Z0-9,+-]+)$/u.exec(part);
    if (match === null) return null;
    keys.push(match[1] as string);
  }
  return isOrderedUnique(keys, (item) => item) && keys.includes("FREQ") ? value : null;
}

function parseGeometryPoint(value: unknown): KnowledgeGeometryPointV1 | null {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) return null;
  const coordinates = value.map(canonicalDecimal);
  if (coordinates.some((coordinate) => coordinate === null)) return null;
  return coordinates as unknown as KnowledgeGeometryPointV1;
}

function mediaType(value: unknown): string | null {
  return typeof value === "string"
      && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value)
    ? value
    : null;
}

function canonicalUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4_096) return null;
  try {
    const uri = new URL(value);
    return uri.username === "" && uri.password === ""
        && uri.protocol !== "javascript:" && uri.protocol !== "data:"
        && uri.protocol !== "file:" && uri.href === value
      ? value
      : null;
  } catch {
    return null;
  }
}

function parseKnowledgeValueInternal(
  value: unknown,
  depth: number,
): KnowledgeValueV1 | null {
  if (!isPlainRecord(value) || value["v"] !== 1 || depth > 8) return null;
  switch (value["kind"]) {
    case "entity": {
      if (!hasExactKeys(value, ["entityId", "kind", "v"])) return null;
      const entityId = parseKnowledgeEntityId(value["entityId"]);
      return entityId === null ? null : { entityId, kind: "entity", v: 1 };
    }
    case "text": {
      if (!hasExactKeys(value, ["kind", "language", "text", "v"])) return null;
      const language = languageTag(value["language"]);
      const text = boundedText(value["text"]);
      return language === null || text === null
        ? null
        : { kind: "text", language, text, v: 1 };
    }
    case "string": {
      const parsedValue = boundedText(value["value"]);
      return hasExactKeys(value, ["kind", "v", "value"]) && parsedValue !== null
        ? { kind: "string", v: 1, value: parsedValue }
        : null;
    }
    case "boolean":
      return hasExactKeys(value, ["kind", "v", "value"])
          && typeof value["value"] === "boolean"
        ? { kind: "boolean", v: 1, value: value["value"] }
        : null;
    case "integer": {
      const integer = canonicalInteger(value["value"]);
      return hasExactKeys(value, ["kind", "v", "value"]) && integer !== null
        ? { kind: "integer", v: 1, value: integer }
        : null;
    }
    case "decimal": {
      const decimal = canonicalDecimal(value["value"]);
      return hasExactKeys(value, ["kind", "v", "value"]) && decimal !== null
        ? { kind: "decimal", v: 1, value: decimal }
        : null;
    }
    case "quantity": {
      if (!hasExactKeys(value, [
        "kind", "lowerBound", "uncertainty", "unit", "upperBound", "v", "value",
      ])) return null;
      const parsedValue = canonicalDecimal(value["value"]);
      const lowerBound = value["lowerBound"] === null
        ? null
        : canonicalDecimal(value["lowerBound"]);
      const upperBound = value["upperBound"] === null
        ? null
        : canonicalDecimal(value["upperBound"]);
      const uncertainty = value["uncertainty"] === null
        ? null
        : parseQuantityUncertainty(value["uncertainty"]);
      const unit = parseKnowledgeSchemaRefV1(value["unit"]);
      return parsedValue !== null
          && (value["lowerBound"] === null || lowerBound !== null)
          && (value["upperBound"] === null || upperBound !== null)
          && (value["uncertainty"] === null || uncertainty !== null)
          && (lowerBound === null || compareCanonicalDecimals(lowerBound, parsedValue) <= 0)
          && (upperBound === null || compareCanonicalDecimals(parsedValue, upperBound) <= 0)
          && unit.ok
        ? { kind: "quantity", lowerBound, uncertainty, unit: unit.value,
            upperBound, v: 1, value: parsedValue }
        : null;
    }
    case "time":
      return parseTemporalValue(value);
    case "interval": {
      if (!hasExactKeys(value, ["end", "kind", "start", "v"])) return null;
      const start = value["start"] === null ? null : parseTemporalValue(value["start"]);
      const end = value["end"] === null ? null : parseTemporalValue(value["end"]);
      return (value["start"] === null || start !== null)
          && (value["end"] === null || end !== null)
          && (start !== null || end !== null)
          && !(start !== null && end !== null
            && start.precision === end.precision
            && canonicalKey(start.calendar) === canonicalKey(end.calendar)
            && compareCanonicalTemporalLexemes(start.value, end.value) > 0)
        ? { end, kind: "interval", start, v: 1 }
        : null;
    }
    case "duration": {
      const iso8601 = canonicalDuration(value["iso8601"]);
      return hasExactKeys(value, ["iso8601", "kind", "v"]) && iso8601 !== null
        ? { iso8601, kind: "duration", v: 1 }
        : null;
    }
    case "recurrence": {
      if (!hasExactKeys(value, ["calendar", "kind", "rule", "startsAt", "v"])) {
        return null;
      }
      const calendar = parseKnowledgeSchemaRefV1(value["calendar"]);
      const rule = canonicalRecurrenceRule(value["rule"]);
      const startsAt = value["startsAt"] === null
        ? null : parseTemporalValue(value["startsAt"]);
      return calendar.ok && rule !== null
          && (value["startsAt"] === null || startsAt !== null)
        ? { calendar: calendar.value, kind: "recurrence", rule, startsAt, v: 1 }
        : null;
    }
    case "geometry": {
      if (!hasExactKeys(value, [
        "coordinates", "crs", "geometryType", "kind", "precisionMeters", "v",
      ]) || !Array.isArray(value["coordinates"])
        || value["coordinates"].length > SPONGE_KNOWLEDGE_LIMITS_V1.geometryPoints) {
        return null;
      }
      const coordinates = value["coordinates"].map(parseGeometryPoint);
      const crs = parseKnowledgeSchemaRefV1(value["crs"]);
      const geometryType = value["geometryType"];
      const precisionMeters = value["precisionMeters"] === null
        ? null : nonnegativeDecimal(value["precisionMeters"]);
      if (!crs.ok || coordinates.some((point) => point === null)
        || (value["precisionMeters"] !== null && precisionMeters === null)
        || (geometryType !== "point" && geometryType !== "line-string"
          && geometryType !== "polygon")) return null;
      const points = coordinates as KnowledgeGeometryPointV1[];
      if ((geometryType === "point" && points.length !== 1)
        || (geometryType === "line-string" && points.length < 2)
        || (geometryType === "polygon" && (points.length < 4
          || canonicalKey(points[0]) !== canonicalKey(points.at(-1))))) return null;
      return { coordinates: points, crs: crs.value, geometryType, kind: "geometry",
        precisionMeters, v: 1 };
    }
    case "uri": {
      const uri = canonicalUri(value["uri"]);
      return hasExactKeys(value, ["kind", "uri", "v"]) && uri !== null
        ? { kind: "uri", uri, v: 1 }
        : null;
    }
    case "identifier": {
      if (!hasExactKeys(value, ["kind", "scheme", "v", "value"])) return null;
      const scheme = parseKnowledgeSchemaRefV1(value["scheme"]);
      const identifier = boundedText(value["value"], 4_096);
      return scheme.ok && identifier !== null
        ? { kind: "identifier", scheme: scheme.value, v: 1, value: identifier }
        : null;
    }
    case "media": {
      if (!hasExactKeys(value, [
        "kind", "mediaType", "sourceEntityId", "sourceSha256", "v",
      ])) return null;
      const parsedMediaType = mediaType(value["mediaType"]);
      const sourceEntityId = parseKnowledgeEntityId(value["sourceEntityId"]);
      const sourceSha256 = parseSha256Hex(value["sourceSha256"]);
      return parsedMediaType !== null && sourceEntityId !== null && sourceSha256 !== null
        ? { kind: "media", mediaType: parsedMediaType, sourceEntityId, sourceSha256, v: 1 }
        : null;
    }
    case "list":
    case "set": {
      if (!hasExactKeys(value, ["kind", "v", "values"])
        || !Array.isArray(value["values"])
        || value["values"].length > SPONGE_KNOWLEDGE_LIMITS_V1.listValues) return null;
      const values: KnowledgeValueV1[] = [];
      for (const child of value["values"]) {
        const parsed = parseKnowledgeValueInternal(child, depth + 1);
        if (parsed === null) return null;
        values.push(parsed);
      }
      if (value["kind"] === "set" && !isOrderedUnique(values)) return null;
      return { kind: value["kind"], v: 1, values };
    }
    case "extension": {
      if (!hasExactKeys(value, [
        "canonicalizerSha256", "canonicalValue", "kind", "mediaType", "schema",
        "v", "valueSha256",
      ])) return null;
      const canonicalizerSha256 = parseSha256Hex(value["canonicalizerSha256"]);
      const canonicalValue = boundedText(
        value["canonicalValue"],
        SPONGE_KNOWLEDGE_LIMITS_V1.extensionBytes,
      );
      const parsedMediaType = mediaType(value["mediaType"]);
      const schema = parseKnowledgeSchemaRefV1(value["schema"]);
      const valueSha256 = parseSha256Hex(value["valueSha256"]);
      return canonicalizerSha256 !== null && canonicalValue !== null
          && parsedMediaType !== null && schema.ok && valueSha256 !== null
        ? { canonicalizerSha256, canonicalValue, kind: "extension",
            mediaType: parsedMediaType, schema: schema.value, v: 1, valueSha256 }
        : null;
    }
    default:
      return null;
  }
}

export function parseKnowledgeValueV1(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeValueV1> {
  const parsed = parseKnowledgeValueInternal(value, 0);
  return parsed === null ? failure("value") : success(parsed);
}

export async function verifyKnowledgeValueV1(
  value: KnowledgeValueV1,
): Promise<KnowledgeOntologyResult<KnowledgeValueV1>> {
  const parsed = parseKnowledgeValueV1(value);
  if (!parsed.ok) return parsed;
  if (parsed.value.kind === "extension") {
    const expected = await sha256Text(parsed.value.canonicalValue);
    if (expected !== parsed.value.valueSha256) {
      return failure("valueSha256", "digest-mismatch");
    }
  }
  if (parsed.value.kind === "list" || parsed.value.kind === "set") {
    for (const child of parsed.value.values) {
      const verified = await verifyKnowledgeValueV1(child);
      if (!verified.ok) return verified;
    }
  }
  return success(parsed.value);
}

export type KnowledgeDimensionV1 = Readonly<{
  predicate: KnowledgeSchemaRefV1;
  v: 1;
  value: KnowledgeValueV1;
}>;

function parseDimension(value: unknown): KnowledgeDimensionV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["predicate", "v", "value"])
    || value["v"] !== 1) return null;
  const predicate = parseKnowledgeSchemaRefV1(value["predicate"]);
  const parsedValue = parseKnowledgeValueV1(value["value"]);
  return predicate.ok && parsedValue.ok
    ? { predicate: predicate.value, v: 1, value: parsedValue.value }
    : null;
}

export const SPONGE_KNOWLEDGE_SCENARIOS_V1 = [
  "actual", "counterfactual", "hypothetical", "planned",
] as const;
export type KnowledgeScenarioV1 = (typeof SPONGE_KNOWLEDGE_SCENARIOS_V1)[number];

export type KnowledgeContextV1 = Readonly<{
  contextSha256: Sha256Hex;
  dimensions: readonly KnowledgeDimensionV1[];
  scenario: KnowledgeScenarioV1;
  v: 1;
}>;
export type KnowledgeContextInputV1 = Omit<KnowledgeContextV1, "contextSha256">;

function parseContextInput(value: unknown): KnowledgeOntologyResult<KnowledgeContextInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["dimensions", "scenario", "v"])
    || value["v"] !== 1 || !Array.isArray(value["dimensions"])) return failure("context");
  if (value["dimensions"].length > SPONGE_KNOWLEDGE_LIMITS_V1.dimensions) {
    return failure("dimensions", "limit-exceeded");
  }
  const scenario = SPONGE_KNOWLEDGE_SCENARIOS_V1.find(
    (candidate) => candidate === value["scenario"],
  );
  const dimensions: KnowledgeDimensionV1[] = [];
  for (const item of value["dimensions"]) {
    const parsed = parseDimension(item);
    if (parsed === null) return failure("dimensions");
    dimensions.push(parsed);
  }
  return scenario === undefined
    ? failure("scenario")
    : success({ dimensions, scenario, v: 1 });
}

export async function createKnowledgeContextV1(
  input: KnowledgeContextInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeContextV1>> {
  const parsed = parseContextInput(input);
  if (!parsed.ok) return parsed;
  for (const dimension of parsed.value.dimensions) {
    const verified = await verifyKnowledgeValueV1(dimension.value);
    if (!verified.ok) return failure(verified.error.field, verified.error.code);
  }
  let dimensions: readonly KnowledgeDimensionV1[];
  try {
    dimensions = sortedUnique(parsed.value.dimensions);
  } catch {
    return failure("dimensions", "noncanonical-input");
  }
  const payload: KnowledgeContextInputV1 = { ...parsed.value, dimensions };
  return success({
    ...payload,
    contextSha256: await sha256Text(canonicalKey(payload)),
  });
}

export async function parseKnowledgeContextV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeContextV1>> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "contextSha256", "dimensions", "scenario", "v",
  ])) return failure("context");
  const contextSha256 = parseSha256Hex(value["contextSha256"]);
  const input = parseContextInput({
    dimensions: value["dimensions"], scenario: value["scenario"], v: value["v"],
  });
  if (contextSha256 === null || !input.ok) return failure("context");
  if (!isOrderedUnique(input.value.dimensions)) {
    return failure("dimensions", "noncanonical-input");
  }
  for (const dimension of input.value.dimensions) {
    const verified = await verifyKnowledgeValueV1(dimension.value);
    if (!verified.ok) return failure(verified.error.field, verified.error.code);
  }
  const expected = await sha256Text(canonicalKey(input.value));
  return expected === contextSha256
    ? success({ ...input.value, contextSha256 })
    : failure("contextSha256", "digest-mismatch");
}

export type KnowledgeStatementV1 = Readonly<{
  object: KnowledgeValueV1;
  predicate: KnowledgeSchemaRefV1;
  qualifiers: readonly KnowledgeDimensionV1[];
  statementSha256: Sha256Hex;
  subject: KnowledgeEntityId;
  v: 1;
}>;
export type KnowledgeStatementInputV1 = Omit<KnowledgeStatementV1, "statementSha256">;

function parseStatementInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeStatementInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "object", "predicate", "qualifiers", "subject", "v",
  ]) || value["v"] !== 1 || !Array.isArray(value["qualifiers"])) {
    return failure("statement");
  }
  if (value["qualifiers"].length > SPONGE_KNOWLEDGE_LIMITS_V1.qualifiers) {
    return failure("qualifiers", "limit-exceeded");
  }
  const object = parseKnowledgeValueV1(value["object"]);
  const predicate = parseKnowledgeSchemaRefV1(value["predicate"]);
  const subject = parseKnowledgeEntityId(value["subject"]);
  const qualifiers: KnowledgeDimensionV1[] = [];
  for (const item of value["qualifiers"]) {
    const parsed = parseDimension(item);
    if (parsed === null) return failure("qualifiers");
    qualifiers.push(parsed);
  }
  return object.ok && predicate.ok && subject !== null
    ? success({ object: object.value, predicate: predicate.value, qualifiers, subject, v: 1 })
    : failure("statement");
}

export async function createKnowledgeStatementV1(
  input: KnowledgeStatementInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeStatementV1>> {
  const parsed = parseStatementInput(input);
  if (!parsed.ok) return parsed;
  const verifiedObject = await verifyKnowledgeValueV1(parsed.value.object);
  if (!verifiedObject.ok) {
    return failure(verifiedObject.error.field, verifiedObject.error.code);
  }
  for (const qualifier of parsed.value.qualifiers) {
    const verified = await verifyKnowledgeValueV1(qualifier.value);
    if (!verified.ok) return failure(verified.error.field, verified.error.code);
  }
  let qualifiers: readonly KnowledgeDimensionV1[];
  try {
    qualifiers = sortedUnique(parsed.value.qualifiers);
  } catch {
    return failure("qualifiers", "noncanonical-input");
  }
  const payload: KnowledgeStatementInputV1 = { ...parsed.value, qualifiers };
  const encoded = canonicalKey(payload);
  if (utf8ByteLength(encoded) > SPONGE_KNOWLEDGE_LIMITS_V1.statementBytes) {
    return failure("statement", "limit-exceeded");
  }
  return success({ ...payload, statementSha256: await sha256Text(encoded) });
}

export async function parseKnowledgeStatementV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeStatementV1>> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "object", "predicate", "qualifiers", "statementSha256", "subject", "v",
  ])) return failure("statement");
  const statementSha256 = parseSha256Hex(value["statementSha256"]);
  const input = parseStatementInput({
    object: value["object"], predicate: value["predicate"],
    qualifiers: value["qualifiers"], subject: value["subject"], v: value["v"],
  });
  if (statementSha256 === null || !input.ok) return failure("statement");
  if (!isOrderedUnique(input.value.qualifiers)) {
    return failure("qualifiers", "noncanonical-input");
  }
  const verifiedValue = await verifyKnowledgeValueV1(input.value.object);
  if (!verifiedValue.ok) return verifiedValue;
  for (const qualifier of input.value.qualifiers) {
    const verified = await verifyKnowledgeValueV1(qualifier.value);
    if (!verified.ok) return failure(verified.error.field, verified.error.code);
  }
  const expected = await sha256Text(canonicalKey(input.value));
  return expected === statementSha256
    ? success({ ...input.value, statementSha256 })
    : failure("statementSha256", "digest-mismatch");
}

export type KnowledgeAgentRefV1 =
  | Readonly<{ entityId: KnowledgeEntityId; kind: "entity"; v: 1 }>
  | Readonly<{
    kind: "model";
    model: KnowledgeSchemaRefV1;
    receiptSha256: Sha256Hex;
    v: 1;
  }>
  | Readonly<{
    authority: KnowledgeSchemaRefV1;
    kind: "system";
    receiptSha256: Sha256Hex;
    v: 1;
  }>;

function parseAgentRef(value: unknown): KnowledgeAgentRefV1 | null {
  if (!isPlainRecord(value) || value["v"] !== 1) return null;
  if (value["kind"] === "entity" && hasExactKeys(value, ["entityId", "kind", "v"])) {
    const entityId = parseKnowledgeEntityId(value["entityId"]);
    return entityId === null ? null : { entityId, kind: "entity", v: 1 };
  }
  if (value["kind"] === "model" && hasExactKeys(value, [
    "kind", "model", "receiptSha256", "v",
  ])) {
    const model = parseKnowledgeSchemaRefV1(value["model"]);
    const receiptSha256 = parseSha256Hex(value["receiptSha256"]);
    return model.ok && receiptSha256 !== null
      ? { kind: "model", model: model.value, receiptSha256, v: 1 }
      : null;
  }
  if (value["kind"] === "system" && hasExactKeys(value, [
    "authority", "kind", "receiptSha256", "v",
  ])) {
    const authority = parseKnowledgeSchemaRefV1(value["authority"]);
    const receiptSha256 = parseSha256Hex(value["receiptSha256"]);
    return authority.ok && receiptSha256 !== null
      ? { authority: authority.value, kind: "system", receiptSha256, v: 1 }
      : null;
  }
  return null;
}

export const SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1 = [
  "extraction", "human-entry", "human-review", "import", "model-proposal",
  "normalization", "publication", "resolution", "transformation",
] as const;
export type KnowledgeActivityKindV1 =
  (typeof SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1)[number];

export type KnowledgeActivityV1 = Readonly<{
  activitySha256: Sha256Hex;
  actor: KnowledgeAgentRefV1;
  inputSha256s: readonly Sha256Hex[];
  kind: KnowledgeActivityKindV1;
  occurredAt: string;
  outputSha256s: readonly Sha256Hex[];
  policySha256: Sha256Hex;
  tool: KnowledgeSchemaRefV1 | null;
  v: 1;
}>;
export type KnowledgeActivityInputV1 = Omit<KnowledgeActivityV1, "activitySha256">;

function parseActivityInput(value: unknown): KnowledgeOntologyResult<KnowledgeActivityInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "actor", "inputSha256s", "kind", "occurredAt", "outputSha256s",
    "policySha256", "tool", "v",
  ]) || value["v"] !== 1) return failure("activity");
  const actor = parseAgentRef(value["actor"]);
  const inputSha256s = parseShaArray(value["inputSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const kind = SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1.find(
    (candidate) => candidate === value["kind"],
  );
  const occurredAt = parseCanonicalInstantV1(value["occurredAt"]);
  const outputSha256s = parseShaArray(value["outputSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const policySha256 = parseSha256Hex(value["policySha256"]);
  const tool = value["tool"] === null ? null : parseKnowledgeSchemaRefV1(value["tool"]);
  const toolValue = tool === null ? null : tool.ok ? tool.value : null;
  return actor !== null && inputSha256s !== null && kind !== undefined
      && occurredAt !== null && outputSha256s !== null && policySha256 !== null
      && (value["tool"] === null || toolValue !== null)
    ? success({ actor, inputSha256s, kind, occurredAt, outputSha256s,
      policySha256, tool: toolValue, v: 1 })
    : failure("activity");
}

export async function createKnowledgeActivityV1(
  input: KnowledgeActivityInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeActivityV1>> {
  const parsed = parseActivityInput(input);
  return parsed.ok
    ? success({ ...parsed.value, activitySha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeActivityV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeActivityV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "activitySha256")) {
    return failure("activity");
  }
  const activitySha256 = parseSha256Hex(value["activitySha256"]);
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "activitySha256"),
  );
  const parsed = parseActivityInput(input);
  if (activitySha256 === null || !parsed.ok) return failure("activity");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === activitySha256
    ? success({ ...parsed.value, activitySha256 })
    : failure("activitySha256", "digest-mismatch");
}

export const SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1 = [
  "questions", "refutes", "reports", "supports", "undetermined",
] as const;
export type KnowledgeAssertionStanceV1 =
  (typeof SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1)[number];

export const SPONGE_KNOWLEDGE_ASSERTION_STATES_V1 = [
  "accepted-for-purpose", "disputed", "proposed", "reviewed", "superseded",
  "withdrawn",
] as const;
export type KnowledgeAssertionStateV1 =
  (typeof SPONGE_KNOWLEDGE_ASSERTION_STATES_V1)[number];

export type KnowledgeAssertionV1 = Readonly<{
  acceptedPurposes: readonly string[];
  assertionId: KnowledgeAssertionId;
  assertionSha256: Sha256Hex;
  assertor: KnowledgeAgentRefV1;
  confidence: KnowledgeSchemaRefV1 | null;
  contextSha256: Sha256Hex | null;
  provenanceActivitySha256: Sha256Hex;
  reviewActivitySha256: Sha256Hex | null;
  stance: KnowledgeAssertionStanceV1;
  state: KnowledgeAssertionStateV1;
  statementSha256: Sha256Hex;
  v: 1;
}>;
export type KnowledgeAssertionInputV1 = Omit<KnowledgeAssertionV1, "assertionSha256">;

function parseStringCodes(value: unknown, maximum: number): readonly string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const parsed = value.map((item) => safeCode(item));
  if (parsed.some((item) => item === null)) return null;
  const codes = parsed as string[];
  return isOrderedUnique(codes, (item) => item) ? codes : null;
}

function parseAssertionInput(value: unknown): KnowledgeOntologyResult<KnowledgeAssertionInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "acceptedPurposes", "assertionId", "assertor", "confidence", "contextSha256",
    "provenanceActivitySha256", "reviewActivitySha256", "stance", "state",
    "statementSha256", "v",
  ]) || value["v"] !== 1) return failure("assertion");
  const acceptedPurposes = parseStringCodes(
    value["acceptedPurposes"], SPONGE_KNOWLEDGE_LIMITS_V1.acceptedPurposes,
  );
  const assertionId = parseKnowledgeAssertionId(value["assertionId"]);
  const assertor = parseAgentRef(value["assertor"]);
  const confidence = value["confidence"] === null
    ? null
    : parseKnowledgeSchemaRefV1(value["confidence"]);
  const confidenceValue = confidence === null
    ? null
    : confidence.ok ? confidence.value : null;
  const contextSha256 = value["contextSha256"] === null
    ? null
    : parseSha256Hex(value["contextSha256"]);
  const provenanceActivitySha256 = parseSha256Hex(value["provenanceActivitySha256"]);
  const reviewActivitySha256 = value["reviewActivitySha256"] === null
    ? null
    : parseSha256Hex(value["reviewActivitySha256"]);
  const stance = SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1.find(
    (candidate) => candidate === value["stance"],
  );
  const state = SPONGE_KNOWLEDGE_ASSERTION_STATES_V1.find(
    (candidate) => candidate === value["state"],
  );
  const statementSha256 = parseSha256Hex(value["statementSha256"]);
  if (
    acceptedPurposes === null || assertionId === null || assertor === null
    || (value["confidence"] !== null && confidenceValue === null)
    || (value["contextSha256"] !== null && contextSha256 === null)
    || provenanceActivitySha256 === null
    || (value["reviewActivitySha256"] !== null && reviewActivitySha256 === null)
    || stance === undefined || state === undefined || statementSha256 === null
  ) return failure("assertion");
  if (
    assertor.kind === "model"
    && (state !== "proposed" || acceptedPurposes.length !== 0 || reviewActivitySha256 !== null)
  ) return failure("assertor", "authority-violation");
  if (
    (state === "accepted-for-purpose") !== (acceptedPurposes.length > 0)
    || (state !== "proposed" && reviewActivitySha256 === null)
  ) return failure("state", "authority-violation");
  return success({
    acceptedPurposes, assertionId, assertor, confidence: confidenceValue,
    contextSha256, provenanceActivitySha256, reviewActivitySha256, stance, state,
    statementSha256, v: 1,
  });
}

export async function createKnowledgeAssertionV1(
  input: KnowledgeAssertionInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeAssertionV1>> {
  const parsed = parseAssertionInput(input);
  return parsed.ok
    ? success({ ...parsed.value, assertionSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeAssertionV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeAssertionV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "assertionSha256")) {
    return failure("assertion");
  }
  const assertionSha256 = parseSha256Hex(value["assertionSha256"]);
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "assertionSha256"),
  );
  const parsed = parseAssertionInput(input);
  if (assertionSha256 === null || !parsed.ok) return failure("assertion");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === assertionSha256
    ? success({ ...parsed.value, assertionSha256 })
    : failure("assertionSha256", "digest-mismatch");
}

export const SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1 = [
  "background", "contradicts", "corroborates", "direct-observation", "method",
  "quotation", "registry-record", "supports",
] as const;
export type KnowledgeEvidenceBearingV1 =
  (typeof SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1)[number];

export type KnowledgeEvidenceLinkV1 = Readonly<{
  assertionSha256: Sha256Hex;
  bearing: KnowledgeEvidenceBearingV1;
  disclosure: "private" | "public" | "shared";
  evidenceId: KnowledgeEvidenceId;
  evidenceSha256: Sha256Hex;
  observationSha256: Sha256Hex | null;
  provenanceActivitySha256: Sha256Hex;
  selector: string | null;
  sourceEntityId: KnowledgeEntityId | null;
  v: 1;
}>;
export type KnowledgeEvidenceLinkInputV1 = Omit<KnowledgeEvidenceLinkV1, "evidenceSha256">;

function parseEvidenceInput(value: unknown): KnowledgeOntologyResult<KnowledgeEvidenceLinkInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "assertionSha256", "bearing", "disclosure", "evidenceId", "observationSha256",
    "provenanceActivitySha256", "selector", "sourceEntityId", "v",
  ]) || value["v"] !== 1) return failure("evidence");
  const assertionSha256 = parseSha256Hex(value["assertionSha256"]);
  const bearing = SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1.find(
    (candidate) => candidate === value["bearing"],
  );
  const disclosure = value["disclosure"];
  const evidenceId = parseKnowledgeEvidenceId(value["evidenceId"]);
  const observationSha256 = value["observationSha256"] === null
    ? null : parseSha256Hex(value["observationSha256"]);
  const provenanceActivitySha256 = parseSha256Hex(value["provenanceActivitySha256"]);
  const selector = value["selector"] === null
    ? null : boundedText(value["selector"], 8_192);
  const sourceEntityId = value["sourceEntityId"] === null
    ? null : parseKnowledgeEntityId(value["sourceEntityId"]);
  return assertionSha256 !== null && bearing !== undefined
      && (disclosure === "private" || disclosure === "public" || disclosure === "shared")
      && evidenceId !== null
      && (value["observationSha256"] === null || observationSha256 !== null)
      && provenanceActivitySha256 !== null
      && (value["selector"] === null || selector !== null)
      && (value["sourceEntityId"] === null || sourceEntityId !== null)
      && (observationSha256 !== null || sourceEntityId !== null)
    ? success({ assertionSha256, bearing, disclosure, evidenceId, observationSha256,
      provenanceActivitySha256, selector, sourceEntityId, v: 1 })
    : failure("evidence");
}

export async function createKnowledgeEvidenceLinkV1(
  input: KnowledgeEvidenceLinkInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeEvidenceLinkV1>> {
  const parsed = parseEvidenceInput(input);
  return parsed.ok
    ? success({ ...parsed.value, evidenceSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeEvidenceLinkV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeEvidenceLinkV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "evidenceSha256")) {
    return failure("evidence");
  }
  const evidenceSha256 = parseSha256Hex(value["evidenceSha256"]);
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "evidenceSha256"),
  );
  const parsed = parseEvidenceInput(input);
  if (evidenceSha256 === null || !parsed.ok) return failure("evidence");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === evidenceSha256
    ? success({ ...parsed.value, evidenceSha256 })
    : failure("evidenceSha256", "digest-mismatch");
}

export type KnowledgeInquiryV1 = Readonly<{
  answerForm: string;
  authorEntityId: KnowledgeEntityId;
  contextSha256: Sha256Hex | null;
  createdAt: string;
  inquiryId: KnowledgeInquiryId;
  inquirySha256: Sha256Hex;
  language: string;
  /**
   * The released edition this question builds on. Records written before the
   * field existed omit it; a null value is left out of the digest so their
   * `inquirySha256` is unchanged.
   */
  parentEditionId: KnowledgeEditionId | null;
  parentInquiryIds: readonly KnowledgeInquiryId[];
  privacy: "private" | "public" | "shared";
  question: string;
  status: "abandoned" | "open" | "paused" | "resolved";
  v: 1;
}>;
export type KnowledgeInquiryInputV1 = Omit<KnowledgeInquiryV1, "inquirySha256" | "parentEditionId">
  & Readonly<{ parentEditionId?: KnowledgeEditionId | null }>;

const inquiryRequiredKeys = [
  "answerForm", "authorEntityId", "contextSha256", "createdAt", "inquiryId",
  "language", "parentInquiryIds", "privacy", "question", "status", "v",
] as const;

type ParsedInquiryInput = Omit<KnowledgeInquiryV1, "inquirySha256">;

function parseInquiryInput(value: unknown): KnowledgeOntologyResult<ParsedInquiryInput> {
  if (!isPlainRecord(value)) return failure("inquiry");
  const hasParentEdition = Object.hasOwn(value, "parentEditionId");
  if (!hasExactKeys(value, hasParentEdition
    ? [...inquiryRequiredKeys, "parentEditionId"]
    : inquiryRequiredKeys) || value["v"] !== 1 || !Array.isArray(value["parentInquiryIds"])) {
    return failure("inquiry");
  }
  const answerForm = safeCode(value["answerForm"]);
  const authorEntityId = parseKnowledgeEntityId(value["authorEntityId"]);
  const contextSha256 = value["contextSha256"] === null
    ? null : parseSha256Hex(value["contextSha256"]);
  const createdAt = parseCanonicalInstantV1(value["createdAt"]);
  const inquiryId = parseKnowledgeInquiryId(value["inquiryId"]);
  const language = languageTag(value["language"]);
  const parentEditionId = hasParentEdition && value["parentEditionId"] !== null
    ? parseKnowledgeEditionId(value["parentEditionId"]) : null;
  const parentInquiryIds = value["parentInquiryIds"].map(parseKnowledgeInquiryId);
  const privacy = value["privacy"];
  const question = boundedText(value["question"], 16_384);
  const status = value["status"];
  return answerForm !== null && authorEntityId !== null
      && (value["contextSha256"] === null || contextSha256 !== null)
      && createdAt !== null && inquiryId !== null && language !== null
      && (!hasParentEdition || value["parentEditionId"] === null || parentEditionId !== null)
      && parentInquiryIds.every((item) => item !== null)
      && isOrderedUnique(parentInquiryIds as KnowledgeInquiryId[], (item) => item)
      && (privacy === "private" || privacy === "public" || privacy === "shared")
      && question !== null
      && (status === "abandoned" || status === "open" || status === "paused" || status === "resolved")
    ? success({ answerForm, authorEntityId, contextSha256, createdAt, inquiryId,
      language, parentEditionId,
      parentInquiryIds: parentInquiryIds as KnowledgeInquiryId[], privacy,
      question, status, v: 1 })
    : failure("inquiry");
}

/** A null parent edition is omitted so pre-existing Inquiry digests stay valid. */
function inquiryDigestInput(input: ParsedInquiryInput): unknown {
  const { parentEditionId, ...rest } = input;
  return parentEditionId === null ? rest : input;
}

export async function createKnowledgeInquiryV1(
  input: KnowledgeInquiryInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeInquiryV1>> {
  const parsed = parseInquiryInput(input);
  return parsed.ok
    ? success({
      ...parsed.value,
      inquirySha256: await sha256Text(canonicalKey(inquiryDigestInput(parsed.value))),
    })
    : parsed;
}

export async function parseKnowledgeInquiryV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeInquiryV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "inquirySha256")) {
    return failure("inquiry");
  }
  const inquirySha256 = parseSha256Hex(value["inquirySha256"]);
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "inquirySha256"),
  );
  const parsed = parseInquiryInput(input);
  if (inquirySha256 === null || !parsed.ok) return failure("inquiry");
  const expected = await sha256Text(canonicalKey(inquiryDigestInput(parsed.value)));
  return expected === inquirySha256
    ? success({ ...parsed.value, inquirySha256 })
    : failure("inquirySha256", "digest-mismatch");
}

export type KnowledgeShapeV1 = Readonly<{
  allowedPredicates: readonly KnowledgeSchemaRefV1[] | null;
  extends: readonly KnowledgeSchemaRefV1[];
  requiredEvidenceBearings: readonly KnowledgeEvidenceBearingV1[];
  requiredPredicates: readonly KnowledgeSchemaRefV1[];
  shape: KnowledgeSchemaRefV1;
  shapeSha256: Sha256Hex;
  v: 1;
}>;
export type KnowledgeShapeInputV1 = Omit<KnowledgeShapeV1, "shapeSha256">;

function schemaRefs(value: unknown): readonly KnowledgeSchemaRefV1[] | null {
  if (!Array.isArray(value) || value.length > 512) return null;
  const parsed: KnowledgeSchemaRefV1[] = [];
  for (const item of value) {
    const ref = parseKnowledgeSchemaRefV1(item);
    if (!ref.ok) return null;
    parsed.push(ref.value);
  }
  return isOrderedUnique(parsed) ? parsed : null;
}

function parseShapeInput(value: unknown): KnowledgeOntologyResult<KnowledgeShapeInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "allowedPredicates", "extends", "requiredEvidenceBearings", "requiredPredicates",
    "shape", "v",
  ]) || value["v"] !== 1) return failure("shape");
  const allowedPredicates = value["allowedPredicates"] === null
    ? null : schemaRefs(value["allowedPredicates"]);
  const extended = schemaRefs(value["extends"]);
  const requiredEvidenceBearings = Array.isArray(value["requiredEvidenceBearings"])
    ? value["requiredEvidenceBearings"].filter((item): item is KnowledgeEvidenceBearingV1 =>
      SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1.some((candidate) => candidate === item))
    : [];
  const requiredPredicates = schemaRefs(value["requiredPredicates"]);
  const shape = parseKnowledgeSchemaRefV1(value["shape"]);
  if (
    (value["allowedPredicates"] !== null && allowedPredicates === null)
    || extended === null || requiredPredicates === null || !shape.ok
    || !Array.isArray(value["requiredEvidenceBearings"])
    || requiredEvidenceBearings.length !== value["requiredEvidenceBearings"].length
    || !isOrderedUnique(requiredEvidenceBearings, (item) => item)
  ) return failure("shape");
  if (allowedPredicates !== null) {
    const allowed = new Set(allowedPredicates.map(canonicalKey));
    if (requiredPredicates.some((predicate) => !allowed.has(canonicalKey(predicate)))) {
      return failure("requiredPredicates", "authority-violation");
    }
  }
  return success({ allowedPredicates, extends: extended, requiredEvidenceBearings,
    requiredPredicates, shape: shape.value, v: 1 });
}

export async function createKnowledgeShapeV1(
  input: KnowledgeShapeInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeShapeV1>> {
  const parsed = parseShapeInput(input);
  return parsed.ok
    ? success({ ...parsed.value, shapeSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeShapeV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeShapeV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "shapeSha256")) {
    return failure("shape");
  }
  const shapeSha256 = parseSha256Hex(value["shapeSha256"]);
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "shapeSha256"),
  );
  const parsed = parseShapeInput(input);
  if (shapeSha256 === null || !parsed.ok) return failure("shape");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === shapeSha256
    ? success({ ...parsed.value, shapeSha256 })
    : failure("shapeSha256", "digest-mismatch");
}

export type KnowledgeViewSpecV1 = Readonly<{
  audience: string;
  budgets: Readonly<{ bytes: number; depth: number; sources: number }>;
  excludedContextSha256s: readonly Sha256Hex[];
  includedContextSha256s: readonly Sha256Hex[];
  language: string;
  policySha256s: Readonly<{
    dispute: Sha256Hex;
    evidence: Sha256Hex;
    rights: Sha256Hex;
    traversal: Sha256Hex;
  }>;
  root: Readonly<{ entityId: KnowledgeEntityId; kind: "entity" }>
    | Readonly<{ inquiryId: KnowledgeInquiryId; kind: "inquiry" }>;
  shapes: readonly KnowledgeSchemaRefV1[];
  v: 1;
  viewForm: string;
  viewSpecSha256: Sha256Hex;
  vocabularies: readonly KnowledgeSchemaRefV1[];
}>;
export type KnowledgeViewSpecInputV1 = Omit<KnowledgeViewSpecV1, "viewSpecSha256">;

function parseShaArray(value: unknown, maximum: number): readonly Sha256Hex[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const parsed = value.map(parseSha256Hex);
  return parsed.every((item) => item !== null)
      && isOrderedUnique(parsed as Sha256Hex[], (item) => item)
    ? parsed as Sha256Hex[]
    : null;
}

function parseViewSpecInput(value: unknown): KnowledgeOntologyResult<KnowledgeViewSpecInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "audience", "budgets", "excludedContextSha256s", "includedContextSha256s",
    "language", "policySha256s", "root", "shapes", "v", "viewForm", "vocabularies",
  ]) || value["v"] !== 1 || !isPlainRecord(value["budgets"])
    || !isPlainRecord(value["policySha256s"]) || !isPlainRecord(value["root"])) {
    return failure("viewSpec");
  }
  const audience = safeCode(value["audience"]);
  const budgets = value["budgets"];
  const parsedBudgets = hasExactKeys(budgets, ["bytes", "depth", "sources"])
    ? { bytes: positiveInteger(budgets["bytes"]), depth: positiveInteger(budgets["depth"]),
      sources: positiveInteger(budgets["sources"]) }
    : null;
  const excludedContextSha256s = parseShaArray(value["excludedContextSha256s"], 512);
  const includedContextSha256s = parseShaArray(value["includedContextSha256s"], 512);
  const language = languageTag(value["language"]);
  const policies = value["policySha256s"];
  const policySha256s = hasExactKeys(policies, ["dispute", "evidence", "rights", "traversal"])
    ? { dispute: parseSha256Hex(policies["dispute"]), evidence: parseSha256Hex(policies["evidence"]),
      rights: parseSha256Hex(policies["rights"]), traversal: parseSha256Hex(policies["traversal"]) }
    : null;
  const root = value["root"];
  const parsedRoot = root["kind"] === "entity" && hasExactKeys(root, ["entityId", "kind"])
    ? (() => { const entityId = parseKnowledgeEntityId(root["entityId"]); return entityId === null ? null : { entityId, kind: "entity" as const }; })()
    : root["kind"] === "inquiry" && hasExactKeys(root, ["inquiryId", "kind"])
      ? (() => { const inquiryId = parseKnowledgeInquiryId(root["inquiryId"]); return inquiryId === null ? null : { inquiryId, kind: "inquiry" as const }; })()
      : null;
  const shapes = schemaRefs(value["shapes"]);
  const viewForm = safeCode(value["viewForm"]);
  const vocabularies = schemaRefs(value["vocabularies"]);
  return audience !== null && parsedBudgets !== null
      && parsedBudgets.bytes !== null && parsedBudgets.depth !== null && parsedBudgets.sources !== null
      && excludedContextSha256s !== null && includedContextSha256s !== null
      && language !== null && policySha256s !== null
      && policySha256s.dispute !== null && policySha256s.evidence !== null
      && policySha256s.rights !== null && policySha256s.traversal !== null
      && parsedRoot !== null && shapes !== null && viewForm !== null && vocabularies !== null
    ? success({ audience, budgets: parsedBudgets as KnowledgeViewSpecInputV1["budgets"],
      excludedContextSha256s, includedContextSha256s, language,
      policySha256s: policySha256s as KnowledgeViewSpecInputV1["policySha256s"],
      root: parsedRoot, shapes, v: 1, viewForm, vocabularies })
    : failure("viewSpec");
}

export async function createKnowledgeViewSpecV1(
  input: KnowledgeViewSpecInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeViewSpecV1>> {
  const parsed = parseViewSpecInput(input);
  return parsed.ok
    ? success({ ...parsed.value, viewSpecSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeViewSpecV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeViewSpecV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "viewSpecSha256")) {
    return failure("viewSpec");
  }
  const viewSpecSha256 = parseSha256Hex(value["viewSpecSha256"]);
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "viewSpecSha256"),
  );
  const parsed = parseViewSpecInput(input);
  if (viewSpecSha256 === null || !parsed.ok) return failure("viewSpec");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === viewSpecSha256
    ? success({ ...parsed.value, viewSpecSha256 })
    : failure("viewSpecSha256", "digest-mismatch");
}

export type KnowledgeSynthesisPassageV1 = Readonly<{
  authorship: "human" | "model";
  supportStatementSha256s: readonly Sha256Hex[];
  text: string;
  v: 1;
}>;

/**
 * Immutable, server-built review subject. A candidate owns the prose and its
 * complete semantic support set. It deliberately has no human review receipt,
 * edition digest, output graph, or publication clock, so reviewing it cannot
 * create a cryptographic cycle.
 */
export type KnowledgeSynthesisCandidateV1 = Readonly<{
  assertionSha256s: readonly Sha256Hex[];
  candidateSha256: Sha256Hex;
  canonicalOutputSha256: Sha256Hex;
  editionId: KnowledgeEditionId;
  evidenceSha256s: readonly Sha256Hex[];
  generationReceiptSha256: Sha256Hex | null;
  identityReceiptSha256: Sha256Hex;
  inputGraphRevisionSha256: Sha256Hex;
  passages: readonly KnowledgeSynthesisPassageV1[];
  purpose: typeof SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1;
  rightsReceiptSha256: Sha256Hex;
  statementSha256s: readonly Sha256Hex[];
  unresolvedStatementSha256s: readonly Sha256Hex[];
  v: 1;
  viewSpecSha256: Sha256Hex;
}>;
export type KnowledgeSynthesisCandidateInputV1 = Omit<
  KnowledgeSynthesisCandidateV1,
  "candidateSha256"
>;

/** A compact attestation to one accepted human review decision. */
export type KnowledgeHumanReviewReceiptV1 = Readonly<{
  candidateSha256: Sha256Hex;
  decisionSha256: Sha256Hex;
  outcome: "accept";
  policySha256: Sha256Hex;
  purpose: typeof SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1;
  receiptSha256: Sha256Hex;
  reviewedAt: string;
  reviewerEntityId: KnowledgeEntityId;
  v: 1;
}>;
export type KnowledgeHumanReviewReceiptInputV1 = Omit<
  KnowledgeHumanReviewReceiptV1,
  "receiptSha256"
>;

/**
 * The semantic record appended by the final edition operation. Prose remains
 * in the reviewed candidate; publication state remains in the later release.
 */
export type KnowledgeEditionV1 = Readonly<{
  candidateSha256: Sha256Hex;
  dependencyManifestSha256: Sha256Hex;
  editionId: KnowledgeEditionId;
  editionSha256: Sha256Hex;
  humanReviewReceiptSha256: Sha256Hex;
  inputGraphRevisionSha256: Sha256Hex;
  purpose: typeof SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1;
  reviewDecisionSha256: Sha256Hex;
  v: 1;
}>;
export type KnowledgeEditionInputV1 = Omit<KnowledgeEditionV1, "editionSha256">;

/**
 * Post-commit publication artifact. Only the authority boundary may choose
 * publishedAt; neither a candidate nor an edition operation can predeclare it.
 */
export type KnowledgeEditionReleaseV1 = Readonly<{
  authorityAckReceiptSha256: Sha256Hex;
  candidateSha256: Sha256Hex;
  completionReceiptSha256: Sha256Hex;
  dependencyManifestSha256: Sha256Hex;
  editionId: KnowledgeEditionId;
  editionSha256: Sha256Hex;
  humanReviewReceiptSha256: Sha256Hex;
  inputGraphRevisionSha256: Sha256Hex;
  operationId: string;
  outputGraphRevisionSha256: Sha256Hex;
  publishedAt: string;
  purpose: typeof SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1;
  releaseSha256: Sha256Hex;
  v: 1;
}>;
export type KnowledgeEditionReleaseInputV1 = Omit<
  KnowledgeEditionReleaseV1,
  "releaseSha256"
>;

function parsePassage(value: unknown): KnowledgeSynthesisPassageV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "authorship", "supportStatementSha256s", "text", "v",
  ]) || value["v"] !== 1) return null;
  const authorship = value["authorship"];
  const supportStatementSha256s = parseShaArray(value["supportStatementSha256s"], 512);
  const text = boundedText(value["text"]);
  return (authorship === "human" || authorship === "model")
      && supportStatementSha256s !== null && text !== null
    ? { authorship, supportStatementSha256s, text, v: 1 }
    : null;
}

function parseCandidateInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeSynthesisCandidateInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "assertionSha256s", "canonicalOutputSha256", "editionId", "evidenceSha256s",
    "generationReceiptSha256", "identityReceiptSha256", "inputGraphRevisionSha256",
    "passages", "purpose", "rightsReceiptSha256", "statementSha256s",
    "unresolvedStatementSha256s", "v", "viewSpecSha256",
  ]) || value["v"] !== 1 || !Array.isArray(value["passages"])) return failure("candidate");
  const assertionSha256s = parseShaArray(value["assertionSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const canonicalOutputSha256 = parseSha256Hex(value["canonicalOutputSha256"]);
  const editionId = parseKnowledgeEditionId(value["editionId"]);
  const evidenceSha256s = parseShaArray(value["evidenceSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.evidence);
  const generationReceiptSha256 = value["generationReceiptSha256"] === null
    ? null : parseSha256Hex(value["generationReceiptSha256"]);
  const identityReceiptSha256 = parseSha256Hex(value["identityReceiptSha256"]);
  const inputGraphRevisionSha256 = parseSha256Hex(value["inputGraphRevisionSha256"]);
  const passages = value["passages"].map(parsePassage);
  const rightsReceiptSha256 = parseSha256Hex(value["rightsReceiptSha256"]);
  const statementSha256s = parseShaArray(value["statementSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const unresolvedStatementSha256s = parseShaArray(value["unresolvedStatementSha256s"], SPONGE_KNOWLEDGE_LIMITS_V1.references);
  const viewSpecSha256 = parseSha256Hex(value["viewSpecSha256"]);
  const parsedPassages = passages as Array<KnowledgeSynthesisPassageV1 | null>;
  return assertionSha256s !== null && canonicalOutputSha256 !== null && editionId !== null
      && evidenceSha256s !== null
      && (value["generationReceiptSha256"] === null || generationReceiptSha256 !== null)
      && identityReceiptSha256 !== null && inputGraphRevisionSha256 !== null
      && passages.length <= SPONGE_KNOWLEDGE_LIMITS_V1.passages
      && passages.length > 0 && passages.every((passage) => passage !== null)
      && value["purpose"] === SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1
      && rightsReceiptSha256 !== null && statementSha256s !== null
      && unresolvedStatementSha256s !== null && viewSpecSha256 !== null
      && parsedPassages.every((passage) => passage !== null
        && passage.supportStatementSha256s.length > 0
        && passage.supportStatementSha256s.every((sha256) => statementSha256s.includes(sha256)))
      && unresolvedStatementSha256s.every((sha256) => statementSha256s.includes(sha256))
      && (parsedPassages.some((passage) => passage?.authorship === "model")
        === (generationReceiptSha256 !== null))
    ? success({ assertionSha256s, canonicalOutputSha256, editionId, evidenceSha256s,
      generationReceiptSha256, identityReceiptSha256, inputGraphRevisionSha256,
      passages: passages as KnowledgeSynthesisPassageV1[],
      purpose: SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1, rightsReceiptSha256,
      statementSha256s, unresolvedStatementSha256s, v: 1, viewSpecSha256 })
    : failure("candidate");
}

export async function createKnowledgeSynthesisCandidateV1(
  input: KnowledgeSynthesisCandidateInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeSynthesisCandidateV1>> {
  const parsed = parseCandidateInput(input);
  return parsed.ok
    ? success({ ...parsed.value, candidateSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeSynthesisCandidateV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeSynthesisCandidateV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "candidateSha256")) {
    return failure("candidate");
  }
  const candidateSha256 = parseSha256Hex(value["candidateSha256"]);
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "candidateSha256"),
  );
  const parsed = parseCandidateInput(input);
  if (candidateSha256 === null || !parsed.ok) return failure("candidate");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === candidateSha256
    ? success({ ...parsed.value, candidateSha256 })
    : failure("candidateSha256", "digest-mismatch");
}

function parseHumanReviewReceiptInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeHumanReviewReceiptInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["candidateSha256", "decisionSha256",
    "outcome", "policySha256", "purpose", "reviewedAt", "reviewerEntityId", "v"])
    || value["v"] !== 1) return failure("humanReviewReceipt");
  const candidateSha256 = parseSha256Hex(value["candidateSha256"]);
  const decisionSha256 = parseSha256Hex(value["decisionSha256"]);
  const policySha256 = parseSha256Hex(value["policySha256"]);
  const reviewedAt = parseCanonicalInstantV1(value["reviewedAt"]);
  const reviewerEntityId = parseKnowledgeEntityId(value["reviewerEntityId"]);
  return candidateSha256 !== null && decisionSha256 !== null
      && value["outcome"] === "accept" && policySha256 !== null
      && value["purpose"] === SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1
      && reviewedAt !== null && reviewerEntityId !== null
    ? success({ candidateSha256, decisionSha256, outcome: "accept", policySha256,
        purpose: SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1, reviewedAt, reviewerEntityId, v: 1 })
    : failure("humanReviewReceipt");
}

export async function createKnowledgeHumanReviewReceiptV1(
  input: KnowledgeHumanReviewReceiptInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeHumanReviewReceiptV1>> {
  const parsed = parseHumanReviewReceiptInput(input);
  return parsed.ok
    ? success({ ...parsed.value, receiptSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeHumanReviewReceiptV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeHumanReviewReceiptV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "receiptSha256")) {
    return failure("humanReviewReceipt");
  }
  const receiptSha256 = parseSha256Hex(value["receiptSha256"]);
  const parsed = parseHumanReviewReceiptInput(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "receiptSha256"),
  ));
  if (receiptSha256 === null || !parsed.ok) return failure("humanReviewReceipt");
  return await sha256Text(canonicalKey(parsed.value)) === receiptSha256
    ? success({ ...parsed.value, receiptSha256 })
    : failure("receiptSha256", "digest-mismatch");
}

function parseEditionInput(value: unknown): KnowledgeOntologyResult<KnowledgeEditionInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["candidateSha256",
    "dependencyManifestSha256", "editionId", "humanReviewReceiptSha256",
    "inputGraphRevisionSha256", "purpose", "reviewDecisionSha256", "v"])
    || value["v"] !== 1) return failure("edition");
  const candidateSha256 = parseSha256Hex(value["candidateSha256"]);
  const dependencyManifestSha256 = parseSha256Hex(value["dependencyManifestSha256"]);
  const editionId = parseKnowledgeEditionId(value["editionId"]);
  const humanReviewReceiptSha256 = parseSha256Hex(value["humanReviewReceiptSha256"]);
  const inputGraphRevisionSha256 = parseSha256Hex(value["inputGraphRevisionSha256"]);
  const reviewDecisionSha256 = parseSha256Hex(value["reviewDecisionSha256"]);
  return candidateSha256 !== null && dependencyManifestSha256 !== null
      && editionId !== null && humanReviewReceiptSha256 !== null
      && inputGraphRevisionSha256 !== null
      && value["purpose"] === SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1
      && reviewDecisionSha256 !== null
    ? success({ candidateSha256, dependencyManifestSha256, editionId,
        humanReviewReceiptSha256, inputGraphRevisionSha256,
        purpose: SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1, reviewDecisionSha256, v: 1 })
    : failure("edition");
}

export async function createKnowledgeEditionV1(
  input: KnowledgeEditionInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeEditionV1>> {
  const parsed = parseEditionInput(input);
  return parsed.ok
    ? success({ ...parsed.value, editionSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeEditionV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeEditionV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "editionSha256")) {
    return failure("edition");
  }
  const editionSha256 = parseSha256Hex(value["editionSha256"]);
  const parsed = parseEditionInput(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "editionSha256"),
  ));
  if (editionSha256 === null || !parsed.ok) return failure("edition");
  return await sha256Text(canonicalKey(parsed.value)) === editionSha256
    ? success({ ...parsed.value, editionSha256 })
    : failure("editionSha256", "digest-mismatch");
}

function parseEditionReleaseInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeEditionReleaseInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["authorityAckReceiptSha256",
    "candidateSha256", "completionReceiptSha256", "dependencyManifestSha256",
    "editionId", "editionSha256", "humanReviewReceiptSha256",
    "inputGraphRevisionSha256", "operationId", "outputGraphRevisionSha256",
    "publishedAt", "purpose", "v"]) || value["v"] !== 1) {
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
  return authorityAckReceiptSha256 !== null && candidateSha256 !== null
      && completionReceiptSha256 !== null && dependencyManifestSha256 !== null
      && editionId !== null && editionSha256 !== null
      && humanReviewReceiptSha256 !== null && inputGraphRevisionSha256 !== null
      && operationId !== null && outputGraphRevisionSha256 !== null
      && outputGraphRevisionSha256 !== inputGraphRevisionSha256 && publishedAt !== null
      && value["purpose"] === SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1
    ? success({ authorityAckReceiptSha256, candidateSha256, completionReceiptSha256,
        dependencyManifestSha256, editionId, editionSha256,
        humanReviewReceiptSha256, inputGraphRevisionSha256, operationId,
        outputGraphRevisionSha256, publishedAt,
        purpose: SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1, v: 1 })
    : failure("editionRelease");
}

export async function createKnowledgeEditionReleaseV1(
  input: KnowledgeEditionReleaseInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeEditionReleaseV1>> {
  const parsed = parseEditionReleaseInput(input);
  return parsed.ok
    ? success({ ...parsed.value, releaseSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeEditionReleaseV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeEditionReleaseV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "releaseSha256")) {
    return failure("editionRelease");
  }
  const releaseSha256 = parseSha256Hex(value["releaseSha256"]);
  const parsed = parseEditionReleaseInput(Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "releaseSha256"),
  ));
  if (releaseSha256 === null || !parsed.ok) return failure("editionRelease");
  return await sha256Text(canonicalKey(parsed.value)) === releaseSha256
    ? success({ ...parsed.value, releaseSha256 })
    : failure("releaseSha256", "digest-mismatch");
}
