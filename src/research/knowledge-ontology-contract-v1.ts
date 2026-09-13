import { canonicalJson, type JsonValue } from "./document-domain";
import {
  parseCanonicalInstantV1,
  parseSha256Hex,
  sha256Text,
  utf8ByteLength,
  type Sha256Hex,
} from "./integrity-domain";
import {
  SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1,
  parseKnowledgeActivityV1,
  parseKnowledgeAssertionV1,
  parseKnowledgeContextV1,
  parseKnowledgeEditionId,
  parseKnowledgeEntityId,
  parseKnowledgeEntityV1,
  parseKnowledgeEvidenceLinkV1,
  parseKnowledgeInquiryV1,
  parseKnowledgeInquiryId,
  parseKnowledgeEditionV1,
  parseKnowledgeSchemaRefV1,
  parseKnowledgeStatementV1,
  parseKnowledgeValueV1,
  parseKnowledgeViewSpecV1,
  verifyKnowledgeValueV1,
  type KnowledgeActivityV1,
  type KnowledgeAssertionV1,
  type KnowledgeContextV1,
  type KnowledgeEditionV1,
  type KnowledgeEntityId,
  type KnowledgeEntityV1,
  type KnowledgeEvidenceBearingV1,
  type KnowledgeEvidenceLinkV1,
  type KnowledgeInquiryId,
  type KnowledgeInquiryV1,
  type KnowledgeOntologyIssueCode,
  type KnowledgeOntologyResult,
  type KnowledgeSchemaRefV1,
  type KnowledgeStatementV1,
  type KnowledgeHumanReviewReceiptV1,
  type KnowledgeSynthesisCandidateV1,
  type KnowledgeTemporalValueV1,
  type KnowledgeValueV1,
  type KnowledgeViewSpecV1,
} from "./knowledge-ontology-v1";
import { hasExactKeys, isPlainRecord } from "./unknown";

function success<T>(value: T): KnowledgeOntologyResult<T> {
  return { ok: true, value };
}

function failure<T>(
  field: string,
  code: KnowledgeOntologyIssueCode = "invalid-input",
): KnowledgeOntologyResult<T> {
  return { error: { code, field }, ok: false };
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}

function canonicalKey(value: unknown): string {
  return canonicalJson(asJson(value));
}

function compareCanonical(left: unknown, right: unknown): number {
  const leftKey = canonicalKey(left);
  const rightKey = canonicalKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function orderedUnique<T>(
  values: readonly T[],
  key: (value: T) => string = canonicalKey,
): boolean {
  return values.every((value, index) => index === 0
    || key(values[index - 1] as T) < key(value));
}

function sortedUnique<T>(
  values: readonly T[],
  key: (value: T) => string = canonicalKey,
): readonly T[] | null {
  const sorted = [...values].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return orderedUnique(sorted, key) ? sorted : null;
}

function boundedText(value: unknown, maximumBytes = 16_384): string | null {
  if (typeof value !== "string" || value.length === 0
    || value.normalize("NFC") !== value || utf8ByteLength(value) > maximumBytes) return null;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)
      || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff)) return null;
  }
  return value;
}

function safeCode(value: unknown, maximumLength = 128): string | null {
  return typeof value === "string" && value.length <= maximumLength
      && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u.test(value)
    ? value
    : null;
}

function languageTag(value: unknown): string | null {
  return typeof value === "string" && value.length <= 64
      && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value)
    ? value
    : null;
}

function positiveInteger(value: unknown, allowZero = false): number | null {
  return Number.isSafeInteger(value) && !Object.is(value, -0)
      && (value as number) >= (allowZero ? 0 : 1)
    ? value as number
    : null;
}

function parseShaArray(value: unknown, maximum = 4_096): readonly Sha256Hex[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const parsed = value.map(parseSha256Hex);
  return parsed.every((item) => item !== null)
      && orderedUnique(parsed as Sha256Hex[], (item) => item)
    ? parsed as Sha256Hex[]
    : null;
}

function parseRefArray(value: unknown, maximum = 512): readonly KnowledgeSchemaRefV1[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const parsed: KnowledgeSchemaRefV1[] = [];
  for (const item of value) {
    const ref = parseKnowledgeSchemaRefV1(item);
    if (!ref.ok) return null;
    parsed.push(ref.value);
  }
  return orderedUnique(parsed) ? parsed : null;
}

function sameRef(left: KnowledgeSchemaRefV1, right: KnowledgeSchemaRefV1): boolean {
  return canonicalKey(left) === canonicalKey(right);
}

function parseCanonicalDecimal(value: unknown): string | null {
  return typeof value === "string" && value.length <= 1_024 && value !== "-0"
      && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value)
    ? value
    : null;
}

function compareDecimals(left: string, right: string): number {
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
    const magnitude = BigInt(`${value.integer}${value.fraction.padEnd(scale, "0")}`);
    return value.negative ? -magnitude : magnitude;
  };
  const leftScaled = scaled(leftParts);
  const rightScaled = scaled(rightParts);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

export type KnowledgeLocalizedTextV1 = Readonly<{
  language: string;
  text: string;
  v: 1;
}>;

function parseLocalizedTexts(value: unknown): readonly KnowledgeLocalizedTextV1[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return null;
  const parsed: KnowledgeLocalizedTextV1[] = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["language", "text", "v"])
      || item["v"] !== 1) return null;
    const language = languageTag(item["language"]);
    const text = boundedText(item["text"]);
    if (language === null || text === null) return null;
    parsed.push({ language, text, v: 1 });
  }
  return orderedUnique(parsed) ? parsed : null;
}

export type KnowledgeSchemaIdentityV1 = Readonly<{
  code: string;
  namespace: string;
  revision: number;
  v: 1;
}>;

function parseSchemaIdentity(value: unknown): KnowledgeSchemaIdentityV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["code", "namespace", "revision", "v"])
    || value["v"] !== 1) return null;
  const code = safeCode(value["code"]);
  const namespace = safeCode(value["namespace"]);
  const revision = positiveInteger(value["revision"]);
  return code === null || namespace === null || revision === null
    ? null : { code, namespace, revision, v: 1 };
}

function refForIdentity(identity: KnowledgeSchemaIdentityV1, digest: Sha256Hex): KnowledgeSchemaRefV1 {
  return {
    code: identity.code,
    namespace: identity.namespace,
    revision: identity.revision,
    schemaSha256: digest,
    v: 1,
  };
}

export type KnowledgeValueKindV1 = KnowledgeValueV1["kind"];

export type KnowledgeValueRangeV1 =
  | Readonly<{ kind: "any"; v: 1 }>
  | Readonly<{
    kind: "value-kinds";
    v: 1;
    valueKinds: readonly KnowledgeValueKindV1[];
  }>
  | Readonly<{
    concepts: readonly KnowledgeSchemaRefV1[];
    kind: "entity-concepts";
    v: 1;
  }>
  | Readonly<{
    kind: "numeric";
    lowerBound: string | null;
    unit: KnowledgeSchemaRefV1 | null;
    upperBound: string | null;
    v: 1;
  }>
  | Readonly<{
    kind: "text";
    languages: readonly string[] | null;
    maximumBytes: number;
    v: 1;
  }>
  | Readonly<{
    kind: "enum";
    v: 1;
    values: readonly KnowledgeValueV1[];
  }>;

const KNOWLEDGE_VALUE_KINDS_V1: readonly KnowledgeValueKindV1[] = [
  "boolean", "decimal", "duration", "entity", "extension", "geometry", "identifier",
  "integer", "interval", "list", "media", "quantity", "recurrence", "set", "string",
  "text", "time", "uri",
];

export function parseKnowledgeValueRangeV1(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeValueRangeV1> {
  if (!isPlainRecord(value) || value["v"] !== 1) return failure("valueRange");
  switch (value["kind"]) {
    case "any":
      return hasExactKeys(value, ["kind", "v"])
        ? success({ kind: "any", v: 1 }) : failure("valueRange");
    case "value-kinds": {
      if (!hasExactKeys(value, ["kind", "v", "valueKinds"])
        || !Array.isArray(value["valueKinds"]) || value["valueKinds"].length === 0) {
        return failure("valueRange");
      }
      const kinds = value["valueKinds"].filter((item): item is KnowledgeValueKindV1 =>
        KNOWLEDGE_VALUE_KINDS_V1.some((candidate) => candidate === item));
      return kinds.length === value["valueKinds"].length
          && orderedUnique(kinds, (item) => item)
        ? success({ kind: "value-kinds", v: 1, valueKinds: kinds })
        : failure("valueKinds", "noncanonical-input");
    }
    case "entity-concepts": {
      if (!hasExactKeys(value, ["concepts", "kind", "v"])) return failure("valueRange");
      const concepts = parseRefArray(value["concepts"]);
      return concepts !== null && concepts.length > 0
        ? success({ concepts, kind: "entity-concepts", v: 1 })
        : failure("concepts");
    }
    case "numeric": {
      if (!hasExactKeys(value, ["kind", "lowerBound", "unit", "upperBound", "v"])) {
        return failure("valueRange");
      }
      const lowerBound = value["lowerBound"] === null
        ? null : parseCanonicalDecimal(value["lowerBound"]);
      const upperBound = value["upperBound"] === null
        ? null : parseCanonicalDecimal(value["upperBound"]);
      const unit = value["unit"] === null ? null : parseKnowledgeSchemaRefV1(value["unit"]);
      if ((value["lowerBound"] !== null && lowerBound === null)
        || (value["upperBound"] !== null && upperBound === null)
        || (value["unit"] !== null && (unit === null || !unit.ok))
        || (lowerBound !== null && upperBound !== null
          && compareDecimals(lowerBound, upperBound) > 0)) return failure("valueRange");
      return success({ kind: "numeric", lowerBound,
        unit: unit === null || !unit.ok ? null : unit.value, upperBound, v: 1 });
    }
    case "text": {
      if (!hasExactKeys(value, ["kind", "languages", "maximumBytes", "v"])) {
        return failure("valueRange");
      }
      const maximumBytes = positiveInteger(value["maximumBytes"]);
      let languages: readonly string[] | null = null;
      if (value["languages"] !== null) {
        if (!Array.isArray(value["languages"])) return failure("languages");
        const parsed = value["languages"].map(languageTag);
        if (parsed.some((item) => item === null)
          || !orderedUnique(parsed as string[], (item) => item)) return failure("languages");
        languages = parsed as string[];
      }
      return maximumBytes === null
        ? failure("maximumBytes")
        : success({ kind: "text", languages, maximumBytes, v: 1 });
    }
    case "enum": {
      if (!hasExactKeys(value, ["kind", "v", "values"]) || !Array.isArray(value["values"])
        || value["values"].length === 0 || value["values"].length > 256) {
        return failure("valueRange");
      }
      const values: KnowledgeValueV1[] = [];
      for (const item of value["values"]) {
        const parsed = parseKnowledgeValueV1(item);
        if (!parsed.ok) return failure("values");
        values.push(parsed.value);
      }
      return orderedUnique(values)
        ? success({ kind: "enum", v: 1, values })
        : failure("values", "noncanonical-input");
    }
    default:
      return failure("valueRange");
  }
}

export type KnowledgeVocabularyRevisionV1 = Readonly<{
  canonicalizerSha256: Sha256Hex;
  labels: readonly KnowledgeLocalizedTextV1[];
  namespace: string;
  ownerEntityId: KnowledgeEntityId;
  previousRevisionSha256: Sha256Hex | null;
  revision: number;
  revisionSha256: Sha256Hex;
  state: "private" | "public" | "retired" | "shared";
  v: 1;
}>;

export type KnowledgeVocabularyRevisionInputV1 = Omit<
  KnowledgeVocabularyRevisionV1,
  "revisionSha256"
>;

function parseVocabularyInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeVocabularyRevisionInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "canonicalizerSha256", "labels", "namespace", "ownerEntityId",
    "previousRevisionSha256", "revision", "state", "v",
  ]) || value["v"] !== 1) return failure("vocabulary");
  const canonicalizerSha256 = parseSha256Hex(value["canonicalizerSha256"]);
  const labels = parseLocalizedTexts(value["labels"]);
  const namespace = safeCode(value["namespace"]);
  const ownerEntityId = parseKnowledgeEntityId(value["ownerEntityId"]);
  const previousRevisionSha256 = value["previousRevisionSha256"] === null
    ? null : parseSha256Hex(value["previousRevisionSha256"]);
  const revision = positiveInteger(value["revision"]);
  const state = value["state"];
  return canonicalizerSha256 !== null && labels !== null && namespace !== null
      && ownerEntityId !== null
      && (value["previousRevisionSha256"] === null || previousRevisionSha256 !== null)
      && revision !== null && ((revision === 1) === (previousRevisionSha256 === null))
      && (state === "private" || state === "public" || state === "retired" || state === "shared")
    ? success({ canonicalizerSha256, labels, namespace, ownerEntityId,
        previousRevisionSha256, revision, state, v: 1 })
    : failure("vocabulary");
}

export async function createKnowledgeVocabularyRevisionV1(
  input: KnowledgeVocabularyRevisionInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeVocabularyRevisionV1>> {
  const parsed = parseVocabularyInput(input);
  return parsed.ok
    ? success({ ...parsed.value, revisionSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeVocabularyRevisionV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeVocabularyRevisionV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "revisionSha256")) {
    return failure("vocabulary");
  }
  const revisionSha256 = parseSha256Hex(value["revisionSha256"]);
  const input = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "revisionSha256"),
  );
  const parsed = parseVocabularyInput(input);
  if (revisionSha256 === null || !parsed.ok) return failure("vocabulary");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === revisionSha256
    ? success({ ...parsed.value, revisionSha256 })
    : failure("revisionSha256", "digest-mismatch");
}

type KnowledgeSchemaRevisionBaseV1 = Readonly<{
  definitions: readonly KnowledgeLocalizedTextV1[];
  identity: KnowledgeSchemaIdentityV1;
  labels: readonly KnowledgeLocalizedTextV1[];
  previousRevisionSha256: Sha256Hex | null;
  reviewDecisionSha256: Sha256Hex | null;
  v: 1;
  vocabularySha256: Sha256Hex;
}>;

export type KnowledgeConceptRevisionInputV1 = KnowledgeSchemaRevisionBaseV1 & Readonly<{
  broader: readonly KnowledgeSchemaRefV1[];
  kind: "concept";
}>;

export type KnowledgePredicateRevisionInputV1 = KnowledgeSchemaRevisionBaseV1 & Readonly<{
  domainConcepts: readonly KnowledgeSchemaRefV1[];
  inversePredicate: KnowledgeSchemaRefV1 | null;
  kind: "predicate";
  qualifierPredicates: readonly KnowledgeSchemaRefV1[];
  range: KnowledgeValueRangeV1;
}>;

export type KnowledgeUnitRevisionInputV1 = KnowledgeSchemaRevisionBaseV1 & Readonly<{
  dimension: string;
  kind: "unit";
  offset: string;
  scale: string;
  symbol: string;
}>;

export type KnowledgeMappingRevisionInputV1 = KnowledgeSchemaRevisionBaseV1 & Readonly<{
  kind: "mapping";
  mappingActivitySha256: Sha256Hex;
  mappingPolicySha256: Sha256Hex;
  relation: "broader" | "close" | "exact" | "narrower" | "related" | "transformable";
  source: KnowledgeSchemaRefV1;
  target: KnowledgeSchemaRefV1;
}>;

export type KnowledgeSchemaRevisionInputV1 =
  | KnowledgeConceptRevisionInputV1
  | KnowledgeMappingRevisionInputV1
  | KnowledgePredicateRevisionInputV1
  | KnowledgeUnitRevisionInputV1;

export type KnowledgeSchemaRevisionV1 = KnowledgeSchemaRevisionInputV1 & Readonly<{
  ref: KnowledgeSchemaRefV1;
  revisionSha256: Sha256Hex;
}>;

export type KnowledgeConceptRevisionV1 = Extract<KnowledgeSchemaRevisionV1, { kind: "concept" }>;
export type KnowledgePredicateRevisionV1 = Extract<KnowledgeSchemaRevisionV1, { kind: "predicate" }>;
export type KnowledgeUnitRevisionV1 = Extract<KnowledgeSchemaRevisionV1, { kind: "unit" }>;
export type KnowledgeMappingRevisionV1 = Extract<KnowledgeSchemaRevisionV1, { kind: "mapping" }>;

function parseSchemaRevisionBase(
  value: Readonly<Record<string, unknown>>,
): KnowledgeSchemaRevisionBaseV1 | null {
  const definitions = parseLocalizedTexts(value["definitions"]);
  const identity = parseSchemaIdentity(value["identity"]);
  const labels = parseLocalizedTexts(value["labels"]);
  const previousRevisionSha256 = value["previousRevisionSha256"] === null
    ? null : parseSha256Hex(value["previousRevisionSha256"]);
  const reviewDecisionSha256 = value["reviewDecisionSha256"] === null
    ? null : parseSha256Hex(value["reviewDecisionSha256"]);
  const vocabularySha256 = parseSha256Hex(value["vocabularySha256"]);
  return definitions !== null && identity !== null && labels !== null
      && (value["previousRevisionSha256"] === null || previousRevisionSha256 !== null)
      && (value["reviewDecisionSha256"] === null || reviewDecisionSha256 !== null)
      && vocabularySha256 !== null
      && ((identity.revision === 1) === (previousRevisionSha256 === null))
    ? { definitions, identity, labels, previousRevisionSha256,
        reviewDecisionSha256, v: 1, vocabularySha256 }
    : null;
}

function parseSchemaRevisionInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeSchemaRevisionInputV1> {
  if (!isPlainRecord(value) || value["v"] !== 1) return failure("schemaRevision");
  const base = parseSchemaRevisionBase(value);
  if (base === null) return failure("schemaRevision");
  switch (value["kind"]) {
    case "concept": {
      if (!hasExactKeys(value, ["broader", "definitions", "identity", "kind", "labels",
        "previousRevisionSha256", "reviewDecisionSha256", "v", "vocabularySha256"])) {
        return failure("schemaRevision");
      }
      const broader = parseRefArray(value["broader"]);
      return broader === null ? failure("broader")
        : success({ ...base, broader, kind: "concept" });
    }
    case "predicate": {
      if (!hasExactKeys(value, ["definitions", "domainConcepts", "identity",
        "inversePredicate", "kind", "labels", "previousRevisionSha256",
        "qualifierPredicates", "range", "reviewDecisionSha256", "v",
        "vocabularySha256"])) return failure("schemaRevision");
      const domainConcepts = parseRefArray(value["domainConcepts"]);
      const inversePredicate = value["inversePredicate"] === null
        ? null : parseKnowledgeSchemaRefV1(value["inversePredicate"]);
      const qualifierPredicates = parseRefArray(value["qualifierPredicates"]);
      const range = parseKnowledgeValueRangeV1(value["range"]);
      return domainConcepts !== null && qualifierPredicates !== null && range.ok
          && (value["inversePredicate"] === null
            || (inversePredicate !== null && inversePredicate.ok))
        ? success({ ...base, domainConcepts,
            inversePredicate: inversePredicate === null || !inversePredicate.ok
              ? null : inversePredicate.value,
            kind: "predicate", qualifierPredicates, range: range.value })
        : failure("schemaRevision");
    }
    case "unit": {
      if (!hasExactKeys(value, ["definitions", "dimension", "identity", "kind", "labels",
        "offset", "previousRevisionSha256", "reviewDecisionSha256", "scale", "symbol",
        "v", "vocabularySha256"])) return failure("schemaRevision");
      const dimension = safeCode(value["dimension"]);
      const offset = parseCanonicalDecimal(value["offset"]);
      const scale = parseCanonicalDecimal(value["scale"]);
      const symbol = boundedText(value["symbol"], 256);
      return dimension !== null && offset !== null && scale !== null && scale !== "0"
          && symbol !== null
        ? success({ ...base, dimension, kind: "unit", offset, scale, symbol })
        : failure("schemaRevision");
    }
    case "mapping": {
      if (!hasExactKeys(value, ["definitions", "identity", "kind", "labels",
        "mappingActivitySha256", "mappingPolicySha256", "previousRevisionSha256", "relation",
        "reviewDecisionSha256", "source", "target", "v", "vocabularySha256"])) {
        return failure("schemaRevision");
      }
      const mappingActivitySha256 = parseSha256Hex(value["mappingActivitySha256"]);
      const mappingPolicySha256 = parseSha256Hex(value["mappingPolicySha256"]);
      const relation = value["relation"];
      const source = parseKnowledgeSchemaRefV1(value["source"]);
      const target = parseKnowledgeSchemaRefV1(value["target"]);
      return mappingActivitySha256 !== null && mappingPolicySha256 !== null
          && (relation === "broader" || relation === "close" || relation === "exact"
            || relation === "narrower" || relation === "related"
            || relation === "transformable") && source.ok && target.ok
          && !sameRef(source.value, target.value)
        ? success({ ...base, kind: "mapping", mappingActivitySha256,
            mappingPolicySha256, relation, source: source.value, target: target.value })
        : failure("schemaRevision");
    }
    default:
      return failure("schemaRevision");
  }
}

export async function createKnowledgeSchemaRevisionV1(
  input: KnowledgeSchemaRevisionInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeSchemaRevisionV1>> {
  const parsed = parseSchemaRevisionInput(input);
  if (!parsed.ok) return parsed;
  const revisionSha256 = await sha256Text(canonicalKey(parsed.value));
  return success({ ...parsed.value, ref: refForIdentity(parsed.value.identity, revisionSha256),
    revisionSha256 });
}

export async function parseKnowledgeSchemaRevisionV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeSchemaRevisionV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "ref")
    || !Object.hasOwn(value, "revisionSha256")) return failure("schemaRevision");
  const ref = parseKnowledgeSchemaRefV1(value["ref"]);
  const revisionSha256 = parseSha256Hex(value["revisionSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(
    ([key]) => key !== "ref" && key !== "revisionSha256",
  ));
  const parsed = parseSchemaRevisionInput(input);
  if (!ref.ok || revisionSha256 === null || !parsed.ok) return failure("schemaRevision");
  const expected = await sha256Text(canonicalKey(parsed.value));
  const expectedRef = refForIdentity(parsed.value.identity, expected);
  return expected === revisionSha256 && sameRef(ref.value, expectedRef)
    ? success({ ...parsed.value, ref: ref.value, revisionSha256 })
    : failure("revisionSha256", "digest-mismatch");
}

export function verifyKnowledgeSchemaEvolutionV1(
  revisions: readonly KnowledgeSchemaRevisionV1[],
): KnowledgeOntologyResult<readonly KnowledgeSchemaRevisionV1[]> {
  if (revisions.length === 0 || revisions.length > 1_024) return failure("revisions");
  const ordered = [...revisions].sort((left, right) => left.identity.revision - right.identity.revision);
  const first = ordered[0] as KnowledgeSchemaRevisionV1;
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index] as KnowledgeSchemaRevisionV1;
    const previous = index === 0 ? null : ordered[index - 1] as KnowledgeSchemaRevisionV1;
    if (current.kind !== first.kind || current.identity.code !== first.identity.code
      || current.identity.namespace !== first.identity.namespace
      || current.identity.revision !== index + 1
      || current.previousRevisionSha256 !== previous?.revisionSha256 && previous !== null
      || (previous === null && current.previousRevisionSha256 !== null)) {
      return failure("revisions", "dependency-missing");
    }
  }
  return success(ordered);
}

export const SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1 = [
  "create", "merge", "quarantine", "rekey", "split", "tombstone",
] as const;
export type KnowledgeIdentityOperationKindV1 =
  (typeof SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1)[number];

export type KnowledgeIdentityAssignmentV1 = Readonly<{
  fromEntityId: KnowledgeEntityId;
  toEntityIds: readonly KnowledgeEntityId[];
  v: 1;
}>;

export type KnowledgeIdentityOperationV1 = Readonly<{
  activitySha256: Sha256Hex;
  assignments: readonly KnowledgeIdentityAssignmentV1[];
  kind: KnowledgeIdentityOperationKindV1;
  occurredAt: string;
  operationId: string;
  operationSha256: Sha256Hex;
  postimageEntities: readonly KnowledgeEntityV1[];
  postimageSha256: Sha256Hex;
  preimageEntities: readonly KnowledgeEntityV1[];
  preimageSha256: Sha256Hex;
  v: 1;
}>;

export type KnowledgeIdentityOperationInputV1 = Omit<
  KnowledgeIdentityOperationV1,
  "operationSha256" | "postimageSha256" | "preimageSha256"
>;

function parseEntity(value: unknown): KnowledgeEntityV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["entityId", "identityOperationId",
    "identityRevision", "redirectEntityId", "state", "v"]) || value["v"] !== 1) return null;
  const entityId = parseKnowledgeEntityId(value["entityId"]);
  const identityOperationId = safeCode(value["identityOperationId"]);
  const identityRevision = positiveInteger(value["identityRevision"]);
  const redirectEntityId = value["redirectEntityId"] === null
    ? null : parseKnowledgeEntityId(value["redirectEntityId"]);
  const state = value["state"];
  return entityId !== null && identityOperationId !== null && identityRevision !== null
      && (value["redirectEntityId"] === null || redirectEntityId !== null)
      && (state === "active" || state === "quarantined" || state === "redirected"
        || state === "tombstoned")
      && ((state === "redirected") === (redirectEntityId !== null))
      && redirectEntityId !== entityId
    ? { entityId, identityOperationId, identityRevision, redirectEntityId, state, v: 1 }
    : null;
}

function parseEntityArray(value: unknown): readonly KnowledgeEntityV1[] | null {
  if (!Array.isArray(value) || value.length > 1_024) return null;
  const entities = value.map(parseEntity);
  return entities.every((entity) => entity !== null)
      && orderedUnique(entities as KnowledgeEntityV1[], (entity) => entity.entityId)
    ? entities as KnowledgeEntityV1[]
    : null;
}

function parseAssignments(value: unknown): readonly KnowledgeIdentityAssignmentV1[] | null {
  if (!Array.isArray(value) || value.length > 1_024) return null;
  const assignments: KnowledgeIdentityAssignmentV1[] = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["fromEntityId", "toEntityIds", "v"])
      || item["v"] !== 1 || !Array.isArray(item["toEntityIds"])) return null;
    const fromEntityId = parseKnowledgeEntityId(item["fromEntityId"]);
    const toEntityIds = item["toEntityIds"].map(parseKnowledgeEntityId);
    if (fromEntityId === null || toEntityIds.length === 0
      || toEntityIds.some((entityId) => entityId === null)
      || !orderedUnique(toEntityIds as KnowledgeEntityId[], (entityId) => entityId)) return null;
    assignments.push({ fromEntityId, toEntityIds: toEntityIds as KnowledgeEntityId[], v: 1 });
  }
  return orderedUnique(assignments, (assignment) => assignment.fromEntityId)
    ? assignments : null;
}

function identityOperationLaw(
  value: Omit<KnowledgeIdentityOperationInputV1, "activitySha256" | "occurredAt" | "v">,
): boolean {
  const preimageById = new Map(value.preimageEntities.map((entity) => [entity.entityId, entity]));
  const postimageById = new Map(value.postimageEntities.map((entity) => [entity.entityId, entity]));
  const assignmentById = new Map(value.assignments.map((assignment) =>
    [assignment.fromEntityId, assignment]));
  if (preimageById.size !== value.preimageEntities.length
    || postimageById.size !== value.postimageEntities.length
    || assignmentById.size !== value.assignments.length) return false;
  if (value.postimageEntities.some((entity) =>
    entity.identityOperationId !== value.operationId)) return false;
  for (const before of value.preimageEntities) {
    const after = postimageById.get(before.entityId);
    if (after === undefined || after.identityRevision !== before.identityRevision + 1
      || !assignmentById.has(before.entityId)) return false;
  }
  for (const after of value.postimageEntities) {
    if (!preimageById.has(after.entityId) && after.identityRevision !== 1) return false;
  }
  const assignedTargets = new Set(value.assignments.flatMap((assignment) => assignment.toEntityIds));
  const newIds = value.postimageEntities
    .filter((entity) => !preimageById.has(entity.entityId))
    .map((entity) => entity.entityId);
  if (value.kind !== "create" && newIds.some((entityId) => !assignedTargets.has(entityId))) {
    return false;
  }
  switch (value.kind) {
    case "create":
      return value.preimageEntities.length === 0 && value.postimageEntities.length === 1
        && value.assignments.length === 0
        && value.postimageEntities[0]?.state === "active"
        && value.postimageEntities[0]?.identityRevision === 1;
    case "merge": {
      if (value.preimageEntities.length < 2 || value.assignments.length !== value.preimageEntities.length
        || newIds.length !== 0) return false;
      const targets = new Set(value.assignments.flatMap((assignment) => assignment.toEntityIds));
      if (targets.size !== 1) return false;
      const targetId = [...targets][0];
      if (targetId === undefined || !preimageById.has(targetId)) return false;
      return value.postimageEntities.every((entity) => entity.entityId === targetId
        ? entity.state === "active" && entity.redirectEntityId === null
        : entity.state === "redirected" && entity.redirectEntityId === targetId);
    }
    case "split": {
      if (value.preimageEntities.length !== 1 || value.assignments.length !== 1
        || newIds.length < 2) return false;
      const before = value.preimageEntities[0] as KnowledgeEntityV1;
      const assignment = value.assignments[0] as KnowledgeIdentityAssignmentV1;
      const oldAfter = postimageById.get(before.entityId);
      return assignment.fromEntityId === before.entityId
        && assignment.toEntityIds.length === newIds.length
        && assignment.toEntityIds.every((entityId) => newIds.includes(entityId))
        && oldAfter?.state === "tombstoned"
        && newIds.every((entityId) => postimageById.get(entityId)?.state === "active");
    }
    case "rekey": {
      if (value.preimageEntities.length !== 1 || value.assignments.length !== 1
        || newIds.length !== 1) return false;
      const before = value.preimageEntities[0] as KnowledgeEntityV1;
      const replacement = newIds[0] as KnowledgeEntityId;
      const assignment = value.assignments[0] as KnowledgeIdentityAssignmentV1;
      return assignment.fromEntityId === before.entityId
        && assignment.toEntityIds.length === 1 && assignment.toEntityIds[0] === replacement
        && postimageById.get(before.entityId)?.state === "redirected"
        && postimageById.get(before.entityId)?.redirectEntityId === replacement
        && postimageById.get(replacement)?.state === "active";
    }
    case "quarantine":
    case "tombstone": {
      if (value.preimageEntities.length !== 1 || value.postimageEntities.length !== 1
        || value.assignments.length !== 1) return false;
      const before = value.preimageEntities[0] as KnowledgeEntityV1;
      const after = value.postimageEntities[0] as KnowledgeEntityV1;
      const assignment = value.assignments[0] as KnowledgeIdentityAssignmentV1;
      return before.entityId === after.entityId && assignment.fromEntityId === before.entityId
        && assignment.toEntityIds.length === 1 && assignment.toEntityIds[0] === before.entityId
        && after.state === (value.kind === "quarantine" ? "quarantined" : "tombstoned");
    }
  }
}

async function canonicalIdentityInput(
  input: KnowledgeIdentityOperationInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeIdentityOperationInputV1 & Readonly<{
  postimageSha256: Sha256Hex;
  preimageSha256: Sha256Hex;
}>>> {
  const activitySha256 = parseSha256Hex(input.activitySha256);
  const assignments = sortedUnique(input.assignments, (assignment) => assignment.fromEntityId);
  const kind = SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1.find(
    (candidate) => candidate === input.kind,
  );
  const occurredAt = parseCanonicalInstantV1(input.occurredAt);
  const operationId = safeCode(input.operationId);
  const postimageEntities = sortedUnique(input.postimageEntities, (entity) => entity.entityId);
  const preimageEntities = sortedUnique(input.preimageEntities, (entity) => entity.entityId);
  if (activitySha256 === null || assignments === null || kind === undefined
    || occurredAt === null || operationId === null || postimageEntities === null
    || preimageEntities === null) return failure("identityOperation");
  const canonicalAssignments = assignments.map((assignment) => {
    const toEntityIds = sortedUnique(assignment.toEntityIds, (entityId) => entityId);
    return toEntityIds === null ? null : { ...assignment, toEntityIds };
  });
  if (canonicalAssignments.some((assignment) => assignment === null)) {
    return failure("assignments", "noncanonical-input");
  }
  const canonical = {
    activitySha256,
    assignments: canonicalAssignments as KnowledgeIdentityAssignmentV1[],
    kind,
    occurredAt,
    operationId,
    postimageEntities,
    preimageEntities,
    v: 1 as const,
  };
  if (!identityOperationLaw(canonical)) return failure("identityOperation", "authority-violation");
  return success({ ...canonical,
    postimageSha256: await sha256Text(canonicalKey(postimageEntities)),
    preimageSha256: await sha256Text(canonicalKey(preimageEntities)) });
}

export async function createKnowledgeIdentityOperationV1(
  input: KnowledgeIdentityOperationInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeIdentityOperationV1>> {
  const canonical = await canonicalIdentityInput(input);
  if (!canonical.ok) return canonical;
  const operationPayload = canonical.value;
  return success({ ...operationPayload,
    operationSha256: await sha256Text(canonicalKey(operationPayload)) });
}

export async function parseKnowledgeIdentityOperationV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeIdentityOperationV1>> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["activitySha256", "assignments", "kind",
    "occurredAt", "operationId", "operationSha256", "postimageEntities",
    "postimageSha256", "preimageEntities", "preimageSha256", "v"]) || value["v"] !== 1) {
    return failure("identityOperation");
  }
  const operationSha256 = parseSha256Hex(value["operationSha256"]);
  const postimageSha256 = parseSha256Hex(value["postimageSha256"]);
  const preimageSha256 = parseSha256Hex(value["preimageSha256"]);
  const assignments = parseAssignments(value["assignments"]);
  const postimageEntities = parseEntityArray(value["postimageEntities"]);
  const preimageEntities = parseEntityArray(value["preimageEntities"]);
  if (operationSha256 === null || postimageSha256 === null || preimageSha256 === null
    || assignments === null || postimageEntities === null || preimageEntities === null) {
    return failure("identityOperation");
  }
  const canonical = await canonicalIdentityInput({
    activitySha256: value["activitySha256"] as Sha256Hex,
    assignments,
    kind: value["kind"] as KnowledgeIdentityOperationKindV1,
    occurredAt: value["occurredAt"] as string,
    operationId: value["operationId"] as string,
    postimageEntities,
    preimageEntities,
    v: 1,
  });
  if (!canonical.ok || canonical.value.preimageSha256 !== preimageSha256
    || canonical.value.postimageSha256 !== postimageSha256) {
    return failure("preimageSha256", "digest-mismatch");
  }
  const expected = await sha256Text(canonicalKey(canonical.value));
  return expected === operationSha256
    ? success({ ...canonical.value, operationSha256 })
    : failure("operationSha256", "digest-mismatch");
}

export async function verifyKnowledgeIdentityOperationAgainstHeadsV1(
  operation: KnowledgeIdentityOperationV1,
  currentHeads: readonly KnowledgeEntityV1[],
): Promise<KnowledgeOntologyResult<KnowledgeIdentityOperationV1>> {
  const heads = sortedUnique(currentHeads, (entity) => entity.entityId);
  if (heads === null || heads.length !== operation.preimageEntities.length
    || canonicalKey(heads) !== canonicalKey(operation.preimageEntities)
    || await sha256Text(canonicalKey(heads)) !== operation.preimageSha256) {
    return failure("preimageEntities", "authority-violation");
  }
  return success(operation);
}

export type KnowledgeTypeMembershipV1 = Readonly<{
  assertionSha256: Sha256Hex;
  concept: KnowledgeSchemaRefV1;
  contextSha256: Sha256Hex | null;
  entityId: KnowledgeEntityId;
  membershipSha256: Sha256Hex;
  validDuring: Readonly<{
    end: KnowledgeTemporalValueV1 | null;
    start: KnowledgeTemporalValueV1 | null;
    v: 1;
  }> | null;
  v: 1;
}>;

export type KnowledgeTypeMembershipInputV1 = Omit<KnowledgeTypeMembershipV1, "membershipSha256">;

function parseTypeMembershipInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeTypeMembershipInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["assertionSha256", "concept",
    "contextSha256", "entityId", "validDuring", "v"]) || value["v"] !== 1) {
    return failure("typeMembership");
  }
  const assertionSha256 = parseSha256Hex(value["assertionSha256"]);
  const concept = parseKnowledgeSchemaRefV1(value["concept"]);
  const contextSha256 = value["contextSha256"] === null
    ? null : parseSha256Hex(value["contextSha256"]);
  const entityId = parseKnowledgeEntityId(value["entityId"]);
  let validDuring: KnowledgeTypeMembershipInputV1["validDuring"] = null;
  if (value["validDuring"] !== null) {
    const interval = parseKnowledgeValueV1({
      ...(value["validDuring"] as Readonly<Record<string, unknown>>), kind: "interval",
    });
    if (!interval.ok || interval.value.kind !== "interval") return failure("validDuring");
    validDuring = { end: interval.value.end, start: interval.value.start, v: 1 };
  }
  return assertionSha256 !== null && concept.ok
      && (value["contextSha256"] === null || contextSha256 !== null) && entityId !== null
    ? success({ assertionSha256, concept: concept.value, contextSha256, entityId,
        validDuring, v: 1 })
    : failure("typeMembership");
}

export async function createKnowledgeTypeMembershipV1(
  input: KnowledgeTypeMembershipInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeTypeMembershipV1>> {
  const parsed = parseTypeMembershipInput(input);
  return parsed.ok
    ? success({ ...parsed.value, membershipSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeTypeMembershipV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeTypeMembershipV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "membershipSha256")) {
    return failure("typeMembership");
  }
  const membershipSha256 = parseSha256Hex(value["membershipSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(
    ([key]) => key !== "membershipSha256",
  ));
  const parsed = parseTypeMembershipInput(input);
  if (membershipSha256 === null || !parsed.ok) return failure("typeMembership");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === membershipSha256
    ? success({ ...parsed.value, membershipSha256 })
    : failure("membershipSha256", "digest-mismatch");
}

export const SPONGE_KNOWLEDGE_DISCLOSURES_V1 = [
  "export", "model", "private", "public", "search", "shared",
] as const;
export type KnowledgeDisclosureV1 = (typeof SPONGE_KNOWLEDGE_DISCLOSURES_V1)[number];

export type KnowledgeRightsDecisionV1 = Readonly<{
  actorEntityId: KnowledgeEntityId;
  allowedDisclosures: readonly KnowledgeDisclosureV1[];
  decidedAt: string;
  decisionSha256: Sha256Hex;
  policySha256: Sha256Hex;
  purposes: readonly string[];
  subjectSha256: Sha256Hex;
  v: 1;
}>;

export type KnowledgeRightsDecisionInputV1 = Omit<KnowledgeRightsDecisionV1, "decisionSha256">;

function parseRightsDecisionInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeRightsDecisionInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["actorEntityId", "allowedDisclosures",
    "decidedAt", "policySha256", "purposes", "subjectSha256", "v"])
    || value["v"] !== 1 || !Array.isArray(value["allowedDisclosures"])
    || !Array.isArray(value["purposes"])) return failure("rightsDecision");
  const actorEntityId = parseKnowledgeEntityId(value["actorEntityId"]);
  const allowedDisclosures = value["allowedDisclosures"].filter(
    (item): item is KnowledgeDisclosureV1 =>
      SPONGE_KNOWLEDGE_DISCLOSURES_V1.some((candidate) => candidate === item),
  );
  const decidedAt = parseCanonicalInstantV1(value["decidedAt"]);
  const policySha256 = parseSha256Hex(value["policySha256"]);
  const purposes = value["purposes"].map((purpose) => safeCode(purpose));
  const subjectSha256 = parseSha256Hex(value["subjectSha256"]);
  return actorEntityId !== null
      && allowedDisclosures.length === value["allowedDisclosures"].length
      && allowedDisclosures.includes("private")
      && orderedUnique(allowedDisclosures, (item) => item)
      && decidedAt !== null && policySha256 !== null && purposes.length > 0
      && purposes.every((purpose) => purpose !== null)
      && orderedUnique(purposes as string[], (item) => item) && subjectSha256 !== null
    ? success({ actorEntityId, allowedDisclosures, decidedAt, policySha256,
        purposes: purposes as string[], subjectSha256, v: 1 })
    : failure("rightsDecision");
}

export async function createKnowledgeRightsDecisionV1(
  input: KnowledgeRightsDecisionInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeRightsDecisionV1>> {
  const parsed = parseRightsDecisionInput(input);
  return parsed.ok
    ? success({ ...parsed.value, decisionSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeRightsDecisionV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeRightsDecisionV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "decisionSha256")) {
    return failure("rightsDecision");
  }
  const decisionSha256 = parseSha256Hex(value["decisionSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(
    ([key]) => key !== "decisionSha256",
  ));
  const parsed = parseRightsDecisionInput(input);
  if (decisionSha256 === null || !parsed.ok) return failure("rightsDecision");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === decisionSha256
    ? success({ ...parsed.value, decisionSha256 })
    : failure("decisionSha256", "digest-mismatch");
}

export function effectiveKnowledgeRightsV1(input: Readonly<{
  decisions: readonly KnowledgeRightsDecisionV1[];
  purpose: string;
  subjectSha256: Sha256Hex;
}>): readonly KnowledgeDisclosureV1[] {
  const decisions = input.decisions.filter((decision) =>
    decision.subjectSha256 === input.subjectSha256 && decision.purposes.includes(input.purpose));
  if (decisions.length === 0) return ["private"];
  return SPONGE_KNOWLEDGE_DISCLOSURES_V1.filter((disclosure) =>
    decisions.every((decision) => decision.allowedDisclosures.includes(disclosure)));
}

export const SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1 = [
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
  "vocabulary",
] as const;

export type KnowledgeReviewSubjectKindV1 =
  (typeof SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1)[number];

export type KnowledgeReviewDecisionV1 = Readonly<{
  decidedAt: string;
  decisionSha256: Sha256Hex;
  outcome: "accept" | "reject" | "request-changes" | "withdraw";
  policySha256: Sha256Hex;
  purpose: string;
  reviewerEntityId: KnowledgeEntityId;
  subjectKind: KnowledgeReviewSubjectKindV1;
  subjectSha256: Sha256Hex;
  supersedesDecisionSha256: Sha256Hex | null;
  v: 1;
}>;

export type KnowledgeReviewDecisionInputV1 = Omit<KnowledgeReviewDecisionV1, "decisionSha256">;

function parseReviewDecisionInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeReviewDecisionInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["decidedAt", "outcome", "policySha256",
    "purpose", "reviewerEntityId", "subjectKind", "subjectSha256",
    "supersedesDecisionSha256", "v"]) || value["v"] !== 1) {
    return failure("reviewDecision");
  }
  const decidedAt = parseCanonicalInstantV1(value["decidedAt"]);
  const outcome = value["outcome"];
  const policySha256 = parseSha256Hex(value["policySha256"]);
  const purpose = safeCode(value["purpose"]);
  const reviewerEntityId = parseKnowledgeEntityId(value["reviewerEntityId"]);
  const subjectKind = SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1.find(
    (candidate) => candidate === value["subjectKind"],
  );
  const subjectSha256 = parseSha256Hex(value["subjectSha256"]);
  const supersedesDecisionSha256 = value["supersedesDecisionSha256"] === null
    ? null : parseSha256Hex(value["supersedesDecisionSha256"]);
  return decidedAt !== null
      && (outcome === "accept" || outcome === "reject" || outcome === "request-changes"
        || outcome === "withdraw") && policySha256 !== null && purpose !== null
      && reviewerEntityId !== null
      && subjectKind !== undefined
      && subjectSha256 !== null
      && (value["supersedesDecisionSha256"] === null || supersedesDecisionSha256 !== null)
    ? success({ decidedAt, outcome, policySha256, purpose, reviewerEntityId,
        subjectKind, subjectSha256, supersedesDecisionSha256, v: 1 })
    : failure("reviewDecision");
}

export async function createKnowledgeReviewDecisionV1(
  input: KnowledgeReviewDecisionInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeReviewDecisionV1>> {
  const parsed = parseReviewDecisionInput(input);
  return parsed.ok
    ? success({ ...parsed.value, decisionSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeReviewDecisionV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeReviewDecisionV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "decisionSha256")) {
    return failure("reviewDecision");
  }
  const decisionSha256 = parseSha256Hex(value["decisionSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(
    ([key]) => key !== "decisionSha256",
  ));
  const parsed = parseReviewDecisionInput(input);
  if (decisionSha256 === null || !parsed.ok) return failure("reviewDecision");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === decisionSha256
    ? success({ ...parsed.value, decisionSha256 })
    : failure("decisionSha256", "digest-mismatch");
}

export function effectiveKnowledgeReviewV1(input: Readonly<{
  decisions: readonly KnowledgeReviewDecisionV1[];
  purpose: string;
  subjectKind: KnowledgeReviewDecisionV1["subjectKind"];
  subjectSha256: Sha256Hex;
}>): KnowledgeReviewDecisionV1 | null {
  const candidates = input.decisions.filter((decision) =>
    decision.purpose === input.purpose && decision.subjectKind === input.subjectKind
      && decision.subjectSha256 === input.subjectSha256);
  if (candidates.length === 0) return null;
  const byDigest = new Map(candidates.map((decision) => [decision.decisionSha256, decision]));
  const superseded = new Set(candidates.flatMap((decision) =>
    decision.supersedesDecisionSha256 === null ? [] : [decision.supersedesDecisionSha256]));
  const heads = candidates.filter((decision) => !superseded.has(decision.decisionSha256));
  if (heads.length !== 1) return null;
  let cursor: KnowledgeReviewDecisionV1 | undefined = heads[0];
  const visited = new Set<Sha256Hex>();
  while (cursor !== undefined && cursor.supersedesDecisionSha256 !== null) {
    if (visited.has(cursor.decisionSha256)) return null;
    visited.add(cursor.decisionSha256);
    cursor = byDigest.get(cursor.supersedesDecisionSha256);
    if (cursor === undefined) return null;
  }
  return heads[0] ?? null;
}

export type KnowledgeShapeCardinalityV1 = Readonly<{
  maximum: number | null;
  minimum: number;
  v: 1;
}>;

export type KnowledgeShapePropertyRuleV1 = Readonly<{
  allowedDisclosures: readonly KnowledgeDisclosureV1[];
  cardinality: KnowledgeShapeCardinalityV1;
  predicate: KnowledgeSchemaRefV1;
  purpose: string;
  range: KnowledgeValueRangeV1;
  requiredEvidenceBearings: readonly KnowledgeEvidenceBearingV1[];
  severity: "error" | "warning";
  v: 1;
}>;

export type KnowledgeExecutableShapeV1 = Readonly<{
  appliesToConcepts: readonly KnowledgeSchemaRefV1[];
  closed: boolean;
  extends: readonly KnowledgeSchemaRefV1[];
  maximumInheritanceDepth: number;
  rules: readonly KnowledgeShapePropertyRuleV1[];
  shape: KnowledgeSchemaRefV1;
  shapeSha256: Sha256Hex;
  v: 1;
}>;

export type KnowledgeExecutableShapeInputV1 = Omit<KnowledgeExecutableShapeV1, "shapeSha256">;

function parseCardinality(value: unknown): KnowledgeShapeCardinalityV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["maximum", "minimum", "v"])
    || value["v"] !== 1) return null;
  const maximum = value["maximum"] === null ? null : positiveInteger(value["maximum"], true);
  const minimum = positiveInteger(value["minimum"], true);
  return minimum !== null && (value["maximum"] === null || maximum !== null)
      && (maximum === null || minimum <= maximum)
    ? { maximum, minimum, v: 1 }
    : null;
}

function parseShapeRules(value: unknown): readonly KnowledgeShapePropertyRuleV1[] | null {
  if (!Array.isArray(value) || value.length > 1_024) return null;
  const rules: KnowledgeShapePropertyRuleV1[] = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["allowedDisclosures", "cardinality",
      "predicate", "purpose", "range", "requiredEvidenceBearings", "severity", "v"])
      || item["v"] !== 1 || !Array.isArray(item["allowedDisclosures"])
      || !Array.isArray(item["requiredEvidenceBearings"])) return null;
    const allowedDisclosures = item["allowedDisclosures"].filter(
      (disclosure): disclosure is KnowledgeDisclosureV1 =>
        SPONGE_KNOWLEDGE_DISCLOSURES_V1.some((candidate) => candidate === disclosure),
    );
    const cardinality = parseCardinality(item["cardinality"]);
    const predicate = parseKnowledgeSchemaRefV1(item["predicate"]);
    const purpose = safeCode(item["purpose"]);
    const range = parseKnowledgeValueRangeV1(item["range"]);
    const requiredEvidenceBearings = item["requiredEvidenceBearings"].filter(
      (bearing): bearing is KnowledgeEvidenceBearingV1 =>
        SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1.some((candidate) => candidate === bearing),
    );
    const severity = item["severity"];
    if (allowedDisclosures.length === 0
      || allowedDisclosures.length !== item["allowedDisclosures"].length
      || !orderedUnique(allowedDisclosures, (disclosure) => disclosure)
      || cardinality === null || !predicate.ok || purpose === null || !range.ok
      || requiredEvidenceBearings.length !== item["requiredEvidenceBearings"].length
      || !orderedUnique(requiredEvidenceBearings, (bearing) => bearing)
      || (severity !== "error" && severity !== "warning")) return null;
    rules.push({ allowedDisclosures, cardinality, predicate: predicate.value, purpose,
      range: range.value, requiredEvidenceBearings, severity, v: 1 });
  }
  return orderedUnique(rules, (rule) => canonicalKey({
    predicate: rule.predicate, purpose: rule.purpose,
  })) ? rules : null;
}

function parseExecutableShapeInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeExecutableShapeInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["appliesToConcepts", "closed", "extends",
    "maximumInheritanceDepth", "rules", "shape", "v"]) || value["v"] !== 1) {
    return failure("shape");
  }
  const appliesToConcepts = parseRefArray(value["appliesToConcepts"]);
  const closed = value["closed"];
  const extended = parseRefArray(value["extends"]);
  const maximumInheritanceDepth = positiveInteger(value["maximumInheritanceDepth"]);
  const rules = parseShapeRules(value["rules"]);
  const shape = parseKnowledgeSchemaRefV1(value["shape"]);
  return appliesToConcepts !== null && typeof closed === "boolean" && extended !== null
      && maximumInheritanceDepth !== null && maximumInheritanceDepth <= 64
      && rules !== null && shape.ok
      && !extended.some((candidate) => sameRef(candidate, shape.value))
    ? success({ appliesToConcepts, closed, extends: extended, maximumInheritanceDepth,
        rules, shape: shape.value, v: 1 })
    : failure("shape");
}

export async function createKnowledgeExecutableShapeV1(
  input: KnowledgeExecutableShapeInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeExecutableShapeV1>> {
  const parsed = parseExecutableShapeInput(input);
  return parsed.ok
    ? success({ ...parsed.value, shapeSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeExecutableShapeV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeExecutableShapeV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "shapeSha256")) return failure("shape");
  const shapeSha256 = parseSha256Hex(value["shapeSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(
    ([key]) => key !== "shapeSha256",
  ));
  const parsed = parseExecutableShapeInput(input);
  if (shapeSha256 === null || !parsed.ok) return failure("shape");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === shapeSha256
    ? success({ ...parsed.value, shapeSha256 })
    : failure("shapeSha256", "digest-mismatch");
}

export type KnowledgeShapeViolationCodeV1 =
  | "cardinality-maximum"
  | "cardinality-minimum"
  | "closed-predicate"
  | "evidence-missing"
  | "privacy-denied"
  | "range-mismatch"
  | "shape-cycle"
  | "shape-missing"
  | "shape-resource-limit"
  | "type-membership-missing";

export type KnowledgeShapeViolationV1 = Readonly<{
  code: KnowledgeShapeViolationCodeV1;
  predicate: KnowledgeSchemaRefV1 | null;
  severity: "error" | "warning";
  statementSha256: Sha256Hex | null;
  v: 1;
}>;

export type KnowledgeShapeEvaluationV1 = Readonly<{
  complete: boolean;
  evaluatedShapeSha256s: readonly Sha256Hex[];
  passed: boolean;
  truncation: "cycle" | "resource-limit" | null;
  v: 1;
  violations: readonly KnowledgeShapeViolationV1[];
}>;

function disclosureMatchesEvidence(
  disclosure: KnowledgeDisclosureV1,
  evidence: KnowledgeEvidenceLinkV1,
): boolean {
  if (disclosure === "private") return true;
  if (disclosure === "shared") return evidence.disclosure !== "private";
  return evidence.disclosure === "public";
}

function acceptedAssertionForPurpose(
  assertions: readonly KnowledgeAssertionV1[],
  statementSha256: Sha256Hex,
  purpose: string,
): KnowledgeAssertionV1 | null {
  return assertions.find((assertion) => assertion.statementSha256 === statementSha256
    && assertion.state === "accepted-for-purpose"
    && assertion.acceptedPurposes.includes(purpose)) ?? null;
}

async function valueMatchesRange(
  value: KnowledgeValueV1,
  range: KnowledgeValueRangeV1,
  input: Readonly<{
    assertions: readonly KnowledgeAssertionV1[];
    memberships: readonly KnowledgeTypeMembershipV1[];
    purpose: string;
  }>,
): Promise<boolean> {
  if (!(await verifyKnowledgeValueV1(value)).ok) return false;
  switch (range.kind) {
    case "any":
      return true;
    case "value-kinds":
      return range.valueKinds.includes(value.kind);
    case "entity-concepts":
      return value.kind === "entity" && input.memberships.some((membership) =>
        membership.entityId === value.entityId
          && range.concepts.some((concept) => sameRef(concept, membership.concept))
          && input.assertions.some((assertion) => assertion.assertionSha256 === membership.assertionSha256
            && assertion.state === "accepted-for-purpose"
            && assertion.acceptedPurposes.includes(input.purpose)));
    case "numeric": {
      const numeric = value.kind === "decimal" || value.kind === "integer"
        ? value.value
        : value.kind === "quantity" ? value.value : null;
      if (numeric === null) return false;
      if (range.unit !== null
        && (value.kind !== "quantity" || !sameRef(value.unit, range.unit))) return false;
      return (range.lowerBound === null || compareDecimals(numeric, range.lowerBound) >= 0)
        && (range.upperBound === null || compareDecimals(numeric, range.upperBound) <= 0);
    }
    case "text":
      return value.kind === "text" && utf8ByteLength(value.text) <= range.maximumBytes
        && (range.languages === null || range.languages.includes(value.language));
    case "enum":
      return range.values.some((candidate) => canonicalKey(candidate) === canonicalKey(value));
  }
}

function shapeViolation(
  code: KnowledgeShapeViolationCodeV1,
  rule: KnowledgeShapePropertyRuleV1 | null,
  statementSha256: Sha256Hex | null = null,
): KnowledgeShapeViolationV1 {
  return { code, predicate: rule?.predicate ?? null, severity: rule?.severity ?? "error",
    statementSha256, v: 1 };
}

export async function evaluateKnowledgeShapeV1(input: Readonly<{
  assertions: readonly KnowledgeAssertionV1[];
  disclosure: KnowledgeDisclosureV1;
  entityId: KnowledgeEntityId;
  evidence: readonly KnowledgeEvidenceLinkV1[];
  memberships: readonly KnowledgeTypeMembershipV1[];
  purpose: string;
  rightsDecisions: readonly KnowledgeRightsDecisionV1[];
  rootShape: KnowledgeSchemaRefV1;
  shapes: readonly KnowledgeExecutableShapeV1[];
  statements: readonly KnowledgeStatementV1[];
}>): Promise<KnowledgeShapeEvaluationV1> {
  const byRef = new Map(input.shapes.map((shape) => [canonicalKey(shape.shape), shape]));
  const root = byRef.get(canonicalKey(input.rootShape));
  if (root === undefined) {
    const violations = [shapeViolation("shape-missing", null)];
    return { complete: false, evaluatedShapeSha256s: [], passed: false,
      truncation: null, v: 1, violations };
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const resolved: KnowledgeExecutableShapeV1[] = [];
  let truncation: KnowledgeShapeEvaluationV1["truncation"] = null;
  let missing = false;
  const visit = (shape: KnowledgeExecutableShapeV1, depth: number): void => {
    const key = canonicalKey(shape.shape);
    if (visited.has(key) || truncation !== null || missing) return;
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
      const parent = byRef.get(canonicalKey(parentRef));
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
    const violations = [shapeViolation(
      truncation === "cycle" ? "shape-cycle"
        : truncation === "resource-limit" ? "shape-resource-limit" : "shape-missing",
      null,
    )];
    return { complete: false, evaluatedShapeSha256s: resolved.map((shape) => shape.shapeSha256),
      passed: false, truncation, v: 1, violations };
  }
  const ruleByPredicate = new Map<string, KnowledgeShapePropertyRuleV1>();
  for (const shape of resolved) {
    for (const rule of shape.rules) {
      const key = canonicalKey({ predicate: rule.predicate, purpose: rule.purpose });
      const prior = ruleByPredicate.get(key);
      if (prior !== undefined && canonicalKey(prior) !== canonicalKey(rule)) {
        return { complete: false, evaluatedShapeSha256s: resolved.map((item) => item.shapeSha256),
          passed: false, truncation: "resource-limit", v: 1,
          violations: [shapeViolation("shape-resource-limit", rule)] };
      }
      ruleByPredicate.set(key, rule);
    }
  }
  const violations: KnowledgeShapeViolationV1[] = [];
  const acceptedStatements = input.statements.filter((statement) => statement.subject === input.entityId
    && acceptedAssertionForPurpose(input.assertions, statement.statementSha256, input.purpose) !== null);
  const applicableMembership = input.memberships.some((membership) =>
    membership.entityId === input.entityId
      && root.appliesToConcepts.some((concept) => sameRef(concept, membership.concept))
      && input.assertions.some((assertion) => assertion.assertionSha256 === membership.assertionSha256
        && assertion.state === "accepted-for-purpose"
        && assertion.acceptedPurposes.includes(input.purpose)));
  if (root.appliesToConcepts.length > 0 && !applicableMembership) {
    violations.push(shapeViolation("type-membership-missing", null));
  }
  for (const rule of ruleByPredicate.values()) {
    if (rule.purpose !== input.purpose) continue;
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
      if (!rule.allowedDisclosures.includes(input.disclosure)
        || !effectiveKnowledgeRightsV1({ decisions: input.rightsDecisions,
          purpose: input.purpose, subjectSha256: statement.statementSha256 })
          .includes(input.disclosure)) {
        violations.push(shapeViolation("privacy-denied", rule, statement.statementSha256));
      }
      const assertion = acceptedAssertionForPurpose(
        input.assertions, statement.statementSha256, input.purpose,
      );
      if (assertion === null) continue;
      const supportingEvidence = input.evidence.filter((link) =>
        link.assertionSha256 === assertion.assertionSha256
          && disclosureMatchesEvidence(input.disclosure, link)
          && effectiveKnowledgeRightsV1({ decisions: input.rightsDecisions,
            purpose: input.purpose, subjectSha256: link.evidenceSha256 })
            .includes(input.disclosure));
      if (rule.requiredEvidenceBearings.some((bearing) =>
        !supportingEvidence.some((link) => link.bearing === bearing))) {
        violations.push(shapeViolation("evidence-missing", rule, statement.statementSha256));
      }
    }
  }
  if (resolved.some((shape) => shape.closed)) {
    for (const statement of acceptedStatements) {
      if (!ruleByPredicate.has(canonicalKey({
        predicate: statement.predicate, purpose: input.purpose,
      }))) {
        violations.push(shapeViolation("closed-predicate", null, statement.statementSha256));
      }
    }
  }
  const canonicalViolations = [...violations].sort((left, right) => {
    const leftKey = canonicalKey(left);
    const rightKey = canonicalKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return { complete: true,
    evaluatedShapeSha256s: resolved.map((shape) => shape.shapeSha256).sort(),
    passed: !canonicalViolations.some((violation) => violation.severity === "error"),
    truncation: null, v: 1, violations: canonicalViolations };
}

export const SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 = [
  "activity", "assertion", "context", "dependency-manifest", "edition", "entity",
  "evidence", "identity-operation", "inquiry", "inquiry-event", "review-decision",
  "rights-decision", "schema", "shape", "statement", "type-membership", "view",
  "vocabulary",
] as const;
export type KnowledgeGraphRecordKindV1 =
  (typeof SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1)[number];

export type KnowledgeGraphRecordRefV1 = Readonly<{
  kind: KnowledgeGraphRecordKindV1;
  sha256: Sha256Hex;
  v: 1;
}>;

function parseGraphRecordRefs(
  value: unknown,
  maximum = 65_536,
): readonly KnowledgeGraphRecordRefV1[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const refs: KnowledgeGraphRecordRefV1[] = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["kind", "sha256", "v"])
      || item["v"] !== 1) return null;
    const kind = SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find(
      (candidate) => candidate === item["kind"],
    );
    const sha256 = parseSha256Hex(item["sha256"]);
    if (kind === undefined || sha256 === null) return null;
    refs.push({ kind, sha256, v: 1 });
  }
  return orderedUnique(refs) ? refs : null;
}

export type KnowledgeGraphRevisionV1 = Readonly<{
  additions: readonly KnowledgeGraphRecordRefV1[];
  graphRevisionSha256: Sha256Hex;
  operationId: string;
  parentGraphRevisionSha256: Sha256Hex | null;
  recordRefs: readonly KnowledgeGraphRecordRefV1[];
  recordsSha256: Sha256Hex;
  revision: number;
  v: 1;
}>;

export async function createKnowledgeGraphRevisionV1(input: Readonly<{
  additions: readonly KnowledgeGraphRecordRefV1[];
  operationId: string;
  parent: KnowledgeGraphRevisionV1 | null;
}>): Promise<KnowledgeOntologyResult<KnowledgeGraphRevisionV1>> {
  const operationId = safeCode(input.operationId);
  const additions = sortedUnique(input.additions);
  if (operationId === null || additions === null || additions.length === 0
    || additions.length > 8_192) return failure("graphRevision");
  const priorRefs = input.parent?.recordRefs ?? [];
  const byKey = new Map(priorRefs.map((ref) => [canonicalKey(ref), ref]));
  for (const ref of additions) byKey.set(canonicalKey(ref), ref);
  const recordRefs = [...byKey.values()].sort((left, right) => {
    const leftKey = canonicalKey(left);
    const rightKey = canonicalKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (recordRefs.length > 65_536) return failure("recordRefs", "limit-exceeded");
  const recordsSha256 = await sha256Text(canonicalKey(recordRefs));
  const payload = {
    additions,
    operationId,
    parentGraphRevisionSha256: input.parent?.graphRevisionSha256 ?? null,
    recordRefs,
    recordsSha256,
    revision: (input.parent?.revision ?? 0) + 1,
    v: 1 as const,
  };
  return success({ ...payload, graphRevisionSha256: await sha256Text(canonicalKey(payload)) });
}

export async function parseKnowledgeGraphRevisionV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeGraphRevisionV1>> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["additions", "graphRevisionSha256",
    "operationId", "parentGraphRevisionSha256", "recordRefs", "recordsSha256",
    "revision", "v"]) || value["v"] !== 1) return failure("graphRevision");
  const additions = parseGraphRecordRefs(value["additions"], 8_192);
  const graphRevisionSha256 = parseSha256Hex(value["graphRevisionSha256"]);
  const operationId = safeCode(value["operationId"]);
  const parentGraphRevisionSha256 = value["parentGraphRevisionSha256"] === null
    ? null : parseSha256Hex(value["parentGraphRevisionSha256"]);
  const recordRefs = parseGraphRecordRefs(value["recordRefs"]);
  const recordsSha256 = parseSha256Hex(value["recordsSha256"]);
  const revision = positiveInteger(value["revision"]);
  if (additions === null || additions.length === 0 || graphRevisionSha256 === null
    || operationId === null
    || (value["parentGraphRevisionSha256"] !== null && parentGraphRevisionSha256 === null)
    || recordRefs === null || recordsSha256 === null || revision === null
    || ((revision === 1) !== (parentGraphRevisionSha256 === null))
    || additions.some((addition) =>
      !recordRefs.some((ref) => canonicalKey(ref) === canonicalKey(addition)))) {
    return failure("graphRevision");
  }
  const expectedRecords = await sha256Text(canonicalKey(recordRefs));
  const payload = { additions, operationId, parentGraphRevisionSha256, recordRefs,
    recordsSha256, revision, v: 1 as const };
  const expectedRevision = await sha256Text(canonicalKey(payload));
  return expectedRecords === recordsSha256 && expectedRevision === graphRevisionSha256
    ? success({ ...payload, graphRevisionSha256 })
    : failure("graphRevisionSha256", "digest-mismatch");
}

export function graphRevisionRetainsEvidenceV1(
  prior: KnowledgeGraphRevisionV1,
  next: KnowledgeGraphRevisionV1,
): boolean {
  if (next.parentGraphRevisionSha256 !== prior.graphRevisionSha256) return false;
  const nextKeys = new Set(next.recordRefs.map(canonicalKey));
  return prior.recordRefs.every((ref) => nextKeys.has(canonicalKey(ref)));
}

export async function reduceKnowledgeGraphRevisionsV1(
  revisions: readonly KnowledgeGraphRevisionV1[],
): Promise<KnowledgeOntologyResult<KnowledgeGraphRevisionV1>> {
  if (revisions.length === 0 || revisions.length > 65_536) return failure("graphRevisions");
  const ordered = [...revisions].sort((left, right) => left.revision - right.revision);
  const operationIds = new Set<string>();
  let parent: KnowledgeGraphRevisionV1 | null = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index] as KnowledgeGraphRevisionV1;
    const parsed = await parseKnowledgeGraphRevisionV1(current);
    if (!parsed.ok || current.revision !== index + 1
      || current.parentGraphRevisionSha256 !== parent?.graphRevisionSha256 && parent !== null
      || (parent === null && current.parentGraphRevisionSha256 !== null)
      || operationIds.has(current.operationId)) {
      return failure("graphRevisions", "dependency-missing");
    }
    const expectedByKey = new Map((parent?.recordRefs ?? []).map((ref) =>
      [canonicalKey(ref), ref]));
    for (const addition of current.additions) expectedByKey.set(canonicalKey(addition), addition);
    const expectedRefs = [...expectedByKey.values()].sort(compareCanonical);
    if (canonicalKey(expectedRefs) !== canonicalKey(current.recordRefs)) {
      return failure("graphRevisions", "dependency-missing");
    }
    operationIds.add(current.operationId);
    parent = parsed.value;
  }
  return success(parent as KnowledgeGraphRevisionV1);
}

export const SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1 = [
  "abandoned", "evidence-added", "gap-identified", "paused", "plan-proposed",
  "question-refined", "resolved", "resumed", "reviewed", "source-added",
  "statement-proposed",
] as const;
export type KnowledgeInquiryEventKindV1 =
  (typeof SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1)[number];

export type KnowledgeInquiryEventV1 = Readonly<{
  actorEntityId: KnowledgeEntityId;
  eventSha256: Sha256Hex;
  inputRefs: readonly KnowledgeGraphRecordRefV1[];
  inquiryId: KnowledgeInquiryId;
  kind: KnowledgeInquiryEventKindV1;
  note: string | null;
  occurredAt: string;
  outputRefs: readonly KnowledgeGraphRecordRefV1[];
  parentEventSha256: Sha256Hex | null;
  sequence: number;
  v: 1;
}>;

export type KnowledgeInquiryEventInputV1 = Omit<KnowledgeInquiryEventV1, "eventSha256">;

export type KnowledgeInquiryTransitionEventKindV1 =
  | "abandoned"
  | "paused"
  | "resolved"
  | "resumed";

/**
 * Resolves the only legal lifecycle edge for a requested status. A repeated
 * target is not an event, and terminal inquiries cannot be reopened.
 */
export function knowledgeInquiryTransitionEventKindV1(
  current: KnowledgeInquiryV1["status"],
  target: KnowledgeInquiryV1["status"],
): KnowledgeInquiryTransitionEventKindV1 | null {
  if (current === "open" && target === "paused") return "paused";
  if (current === "paused" && target === "open") return "resumed";
  if ((current === "open" || current === "paused") && target === "resolved") {
    return "resolved";
  }
  if ((current === "open" || current === "paused") && target === "abandoned") {
    return "abandoned";
  }
  return null;
}

export function knowledgeInquiryTransitionNoteV1(
  kind: KnowledgeInquiryTransitionEventKindV1,
): string {
  switch (kind) {
    case "abandoned": return "Inquiry abandoned.";
    case "paused": return "Inquiry paused.";
    case "resolved": return "Inquiry resolved.";
    case "resumed": return "Inquiry resumed.";
  }
}

function parseInquiryEventInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeInquiryEventInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["actorEntityId", "inputRefs", "inquiryId",
    "kind", "note", "occurredAt", "outputRefs", "parentEventSha256", "sequence", "v"])
    || value["v"] !== 1) return failure("inquiryEvent");
  const actorEntityId = parseKnowledgeEntityId(value["actorEntityId"]);
  const inputRefs = parseGraphRecordRefs(value["inputRefs"], 2_048);
  const inquiryId = parseKnowledgeInquiryId(value["inquiryId"]);
  const kind = SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1.find(
    (candidate) => candidate === value["kind"],
  );
  const note = value["note"] === null ? null : boundedText(value["note"]);
  const occurredAt = parseCanonicalInstantV1(value["occurredAt"]);
  const outputRefs = parseGraphRecordRefs(value["outputRefs"], 2_048);
  const parentEventSha256 = value["parentEventSha256"] === null
    ? null : parseSha256Hex(value["parentEventSha256"]);
  const sequence = positiveInteger(value["sequence"]);
  return actorEntityId !== null && inputRefs !== null && inquiryId !== null
      && kind !== undefined && (value["note"] === null || note !== null)
      && occurredAt !== null && outputRefs !== null
      && (value["parentEventSha256"] === null || parentEventSha256 !== null)
      && sequence !== null && ((sequence === 1) === (parentEventSha256 === null))
      && (note !== null || inputRefs.length > 0 || outputRefs.length > 0)
    ? success({ actorEntityId, inputRefs, inquiryId, kind, note, occurredAt,
        outputRefs, parentEventSha256, sequence, v: 1 })
    : failure("inquiryEvent");
}

export async function createKnowledgeInquiryEventV1(
  input: KnowledgeInquiryEventInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeInquiryEventV1>> {
  const inputRefs = sortedUnique(input.inputRefs);
  const outputRefs = sortedUnique(input.outputRefs);
  if (inputRefs === null || outputRefs === null) return failure("inquiryEvent");
  const parsed = parseInquiryEventInput({ ...input, inputRefs, outputRefs });
  return parsed.ok
    ? success({ ...parsed.value, eventSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeInquiryEventV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeInquiryEventV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "eventSha256")) {
    return failure("inquiryEvent");
  }
  const eventSha256 = parseSha256Hex(value["eventSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(
    ([key]) => key !== "eventSha256",
  ));
  const parsed = parseInquiryEventInput(input);
  if (eventSha256 === null || !parsed.ok) return failure("inquiryEvent");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === eventSha256
    ? success({ ...parsed.value, eventSha256 })
    : failure("eventSha256", "digest-mismatch");
}

export type KnowledgeInquiryTrailV1 = Readonly<{
  eventSha256s: readonly Sha256Hex[];
  gapRefs: readonly KnowledgeGraphRecordRefV1[];
  inquiryId: KnowledgeInquiryId;
  status: KnowledgeInquiryV1["status"];
  trailSha256: Sha256Hex;
  v: 1;
}>;

export async function reduceKnowledgeInquiryEventsV1(
  inquiry: KnowledgeInquiryV1,
  events: readonly KnowledgeInquiryEventV1[],
): Promise<KnowledgeOntologyResult<KnowledgeInquiryTrailV1>> {
  if (inquiry.status !== "open") return failure("inquiry.status", "invalid-input");
  if (events.length > 16_384) return failure("events", "limit-exceeded");
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  let parent: Sha256Hex | null = null;
  let status: KnowledgeInquiryV1["status"] = inquiry.status;
  const gaps = new Map<string, KnowledgeGraphRecordRefV1>();
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index] as KnowledgeInquiryEventV1;
    const parsed = await parseKnowledgeInquiryEventV1(event);
    if (!parsed.ok || event.inquiryId !== inquiry.inquiryId || event.sequence !== index + 1
      || event.parentEventSha256 !== parent) return failure("events", "dependency-missing");
    const transition: KnowledgeInquiryTransitionEventKindV1 | null =
      event.kind === "paused" || event.kind === "resumed"
        || event.kind === "resolved" || event.kind === "abandoned"
      ? knowledgeInquiryTransitionEventKindV1(status, event.kind === "resumed" ? "open"
        : event.kind === "paused" ? "paused" : event.kind)
      : null;
    if (event.kind === "paused" || event.kind === "resumed"
      || event.kind === "resolved" || event.kind === "abandoned") {
      if (transition !== event.kind) return failure("events", "invalid-input");
      status = event.kind === "resumed" ? "open" : event.kind;
    } else if (status !== "open") {
      return failure("events", "invalid-input");
    }
    parent = event.eventSha256;
    if (event.kind === "gap-identified") {
      for (const ref of event.outputRefs) gaps.set(canonicalKey(ref), ref);
    }
    if (event.kind === "reviewed" || event.kind === "resolved") {
      for (const ref of event.inputRefs) gaps.delete(canonicalKey(ref));
    }
  }
  const payload = {
    eventSha256s: ordered.map((event) => event.eventSha256),
    gapRefs: [...gaps.values()].sort(compareCanonical),
    inquiryId: inquiry.inquiryId,
    status,
    v: 1 as const,
  };
  return success({ ...payload, trailSha256: await sha256Text(canonicalKey(payload)) });
}

export type KnowledgeEditionDependencyManifestV1 = Readonly<{
  activitySha256s: readonly Sha256Hex[];
  assertionSha256s: readonly Sha256Hex[];
  candidateSha256: Sha256Hex;
  canonicalOutputSha256: Sha256Hex;
  contextSha256s: readonly Sha256Hex[];
  editionId: KnowledgeEditionV1["editionId"];
  evidenceSha256s: readonly Sha256Hex[];
  generationReceiptSha256: Sha256Hex | null;
  inputGraphRevisionSha256: Sha256Hex;
  humanReviewReceiptSha256: Sha256Hex;
  identityReceiptSha256: Sha256Hex;
  manifestSha256: Sha256Hex;
  purpose: "public-encyclopedia";
  reviewDecisionSha256s: readonly Sha256Hex[];
  rightsDecisionSha256s: readonly Sha256Hex[];
  rightsReceiptSha256: Sha256Hex;
  schemaRevisionSha256s: readonly Sha256Hex[];
  statementSha256s: readonly Sha256Hex[];
  v: 1;
  viewSpecSha256: Sha256Hex;
}>;

export type KnowledgeEditionDependencyManifestInputV1 = Omit<
  KnowledgeEditionDependencyManifestV1,
  "manifestSha256"
>;

function parseManifestInput(
  value: unknown,
): KnowledgeOntologyResult<KnowledgeEditionDependencyManifestInputV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["activitySha256s", "assertionSha256s",
    "candidateSha256", "canonicalOutputSha256", "contextSha256s", "editionId",
    "evidenceSha256s", "generationReceiptSha256", "humanReviewReceiptSha256",
    "identityReceiptSha256", "inputGraphRevisionSha256", "purpose",
    "reviewDecisionSha256s", "rightsDecisionSha256s",
    "rightsReceiptSha256", "schemaRevisionSha256s", "statementSha256s", "v",
    "viewSpecSha256"]) || value["v"] !== 1) return failure("dependencyManifest");
  const activitySha256s = parseShaArray(value["activitySha256s"]);
  const assertionSha256s = parseShaArray(value["assertionSha256s"]);
  const candidateSha256 = parseSha256Hex(value["candidateSha256"]);
  const canonicalOutputSha256 = parseSha256Hex(value["canonicalOutputSha256"]);
  const contextSha256s = parseShaArray(value["contextSha256s"]);
  const editionId = parseKnowledgeEditionId(value["editionId"]);
  const evidenceSha256s = parseShaArray(value["evidenceSha256s"]);
  const generationReceiptSha256 = value["generationReceiptSha256"] === null
    ? null : parseSha256Hex(value["generationReceiptSha256"]);
  const inputGraphRevisionSha256 = parseSha256Hex(value["inputGraphRevisionSha256"]);
  const humanReviewReceiptSha256 = parseSha256Hex(value["humanReviewReceiptSha256"]);
  const identityReceiptSha256 = parseSha256Hex(value["identityReceiptSha256"]);
  const reviewDecisionSha256s = parseShaArray(value["reviewDecisionSha256s"]);
  const rightsDecisionSha256s = parseShaArray(value["rightsDecisionSha256s"]);
  const rightsReceiptSha256 = parseSha256Hex(value["rightsReceiptSha256"]);
  const schemaRevisionSha256s = parseShaArray(value["schemaRevisionSha256s"]);
  const statementSha256s = parseShaArray(value["statementSha256s"]);
  const viewSpecSha256 = parseSha256Hex(value["viewSpecSha256"]);
  return activitySha256s !== null && assertionSha256s !== null
      && candidateSha256 !== null && canonicalOutputSha256 !== null
      && contextSha256s !== null
      && editionId !== null && evidenceSha256s !== null
      && (value["generationReceiptSha256"] === null || generationReceiptSha256 !== null)
      && inputGraphRevisionSha256 !== null && humanReviewReceiptSha256 !== null
      && identityReceiptSha256 !== null && value["purpose"] === "public-encyclopedia"
      && reviewDecisionSha256s !== null && reviewDecisionSha256s.length > 0
      && rightsDecisionSha256s !== null && rightsDecisionSha256s.length > 0
      && rightsReceiptSha256 !== null
      && schemaRevisionSha256s !== null && schemaRevisionSha256s.length > 0
      && statementSha256s !== null && viewSpecSha256 !== null
    ? success({ activitySha256s, assertionSha256s, candidateSha256,
        canonicalOutputSha256, contextSha256s, editionId, evidenceSha256s,
        generationReceiptSha256, humanReviewReceiptSha256, identityReceiptSha256,
        inputGraphRevisionSha256, purpose: "public-encyclopedia",
        reviewDecisionSha256s, rightsDecisionSha256s, rightsReceiptSha256,
        schemaRevisionSha256s, statementSha256s, v: 1, viewSpecSha256 })
    : failure("dependencyManifest");
}

export async function createKnowledgeEditionDependencyManifestV1(
  input: KnowledgeEditionDependencyManifestInputV1,
): Promise<KnowledgeOntologyResult<KnowledgeEditionDependencyManifestV1>> {
  const parsed = parseManifestInput(input);
  return parsed.ok
    ? success({ ...parsed.value, manifestSha256: await sha256Text(canonicalKey(parsed.value)) })
    : parsed;
}

export async function parseKnowledgeEditionDependencyManifestV1(
  value: unknown,
): Promise<KnowledgeOntologyResult<KnowledgeEditionDependencyManifestV1>> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "manifestSha256")) {
    return failure("dependencyManifest");
  }
  const manifestSha256 = parseSha256Hex(value["manifestSha256"]);
  const input = Object.fromEntries(Object.entries(value).filter(
    ([key]) => key !== "manifestSha256",
  ));
  const parsed = parseManifestInput(input);
  if (manifestSha256 === null || !parsed.ok) return failure("dependencyManifest");
  const expected = await sha256Text(canonicalKey(parsed.value));
  return expected === manifestSha256
    ? success({ ...parsed.value, manifestSha256 })
    : failure("manifestSha256", "digest-mismatch");
}

export function verifyKnowledgeEditionDependencyCompletenessV1(input: Readonly<{
  availableSha256s: ReadonlySet<Sha256Hex>;
  candidate: KnowledgeSynthesisCandidateV1;
  edition: KnowledgeEditionV1;
  humanReviewReceipt: KnowledgeHumanReviewReceiptV1;
  manifest: KnowledgeEditionDependencyManifestV1;
}>): KnowledgeOntologyResult<KnowledgeEditionDependencyManifestV1> {
  const { candidate, edition, humanReviewReceipt, manifest } = input;
  const required = [manifest.inputGraphRevisionSha256, manifest.identityReceiptSha256,
    manifest.candidateSha256, manifest.canonicalOutputSha256, manifest.viewSpecSha256,
    manifest.humanReviewReceiptSha256,
    manifest.rightsReceiptSha256,
    ...(manifest.generationReceiptSha256 === null ? [] : [manifest.generationReceiptSha256]),
    ...manifest.activitySha256s,
    ...manifest.assertionSha256s, ...manifest.contextSha256s, ...manifest.evidenceSha256s,
    ...manifest.reviewDecisionSha256s, ...manifest.rightsDecisionSha256s,
    ...manifest.schemaRevisionSha256s, ...manifest.statementSha256s];
  const candidateSupport = candidate.passages.flatMap((passage) =>
    passage.supportStatementSha256s);
  const exact = edition.editionId === manifest.editionId
    && candidate.editionId === manifest.editionId
    && edition.dependencyManifestSha256 === manifest.manifestSha256
    && edition.candidateSha256 === candidate.candidateSha256
    && edition.candidateSha256 === manifest.candidateSha256
    && edition.inputGraphRevisionSha256 === manifest.inputGraphRevisionSha256
    && candidate.inputGraphRevisionSha256 === manifest.inputGraphRevisionSha256
    && candidate.identityReceiptSha256 === manifest.identityReceiptSha256
    && candidate.canonicalOutputSha256 === manifest.canonicalOutputSha256
    && candidate.viewSpecSha256 === manifest.viewSpecSha256
    && candidate.generationReceiptSha256 === manifest.generationReceiptSha256
    && edition.humanReviewReceiptSha256 === manifest.humanReviewReceiptSha256
    && edition.reviewDecisionSha256 === humanReviewReceipt.decisionSha256
    && manifest.reviewDecisionSha256s.includes(edition.reviewDecisionSha256)
    && humanReviewReceipt.candidateSha256 === candidate.candidateSha256
    && humanReviewReceipt.receiptSha256 === manifest.humanReviewReceiptSha256
    && candidate.rightsReceiptSha256 === manifest.rightsReceiptSha256
    && canonicalKey(candidate.assertionSha256s) === canonicalKey(manifest.assertionSha256s)
    && canonicalKey(candidate.evidenceSha256s) === canonicalKey(manifest.evidenceSha256s)
    && canonicalKey(candidate.statementSha256s) === canonicalKey(manifest.statementSha256s)
    && candidateSupport.every((sha256) => manifest.statementSha256s.includes(sha256))
    && candidate.unresolvedStatementSha256s.every((sha256) =>
      manifest.statementSha256s.includes(sha256));
  return exact && required.every((sha256) => input.availableSha256s.has(sha256))
    ? success(manifest)
    : failure("dependencyManifest", "dependency-missing");
}

export type KnowledgeGraphEdgeV1 = Readonly<{
  fromEntityId: KnowledgeEntityId;
  predicate: KnowledgeSchemaRefV1;
  statementSha256: Sha256Hex;
  toEntityId: KnowledgeEntityId;
  v: 1;
}>;

export type KnowledgeGraphTraversalBudgetV1 = Readonly<{
  bytes: number;
  depth: number;
  edges: number;
  nodes: number;
  work: number;
}>;

export type KnowledgeGraphTraversalTruncationV1 =
  | "byte-budget"
  | "depth-budget"
  | "edge-budget"
  | "node-budget"
  | "work-budget";

export type KnowledgeGraphTraversalV1 = Readonly<{
  complete: boolean;
  edges: readonly KnowledgeGraphEdgeV1[];
  frontierEntityIds: readonly KnowledgeEntityId[];
  nodeEntityIds: readonly KnowledgeEntityId[];
  truncations: readonly KnowledgeGraphTraversalTruncationV1[];
  v: 1;
  work: number;
}>;

function validTraversalBudget(value: KnowledgeGraphTraversalBudgetV1): boolean {
  return positiveInteger(value.bytes) !== null && positiveInteger(value.depth, true) !== null
    && positiveInteger(value.edges) !== null && positiveInteger(value.nodes) !== null
    && positiveInteger(value.work) !== null;
}

export function traverseKnowledgeGraphV1(input: Readonly<{
  authorizedStatementSha256s: ReadonlySet<Sha256Hex>;
  budget: KnowledgeGraphTraversalBudgetV1;
  edges: readonly KnowledgeGraphEdgeV1[];
  rootEntityId: KnowledgeEntityId;
}>): KnowledgeOntologyResult<KnowledgeGraphTraversalV1> {
  if (!validTraversalBudget(input.budget) || input.edges.length > 1_000_000) {
    return failure("traversalBudget");
  }
  const authorizedByStatement = new Map<Sha256Hex, KnowledgeGraphEdgeV1>();
  for (const edge of input.edges) {
    if (!input.authorizedStatementSha256s.has(edge.statementSha256)) continue;
    const prior = authorizedByStatement.get(edge.statementSha256);
    if (prior !== undefined && canonicalKey(prior) !== canonicalKey(edge)) {
      return failure("edges", "authority-violation");
    }
    authorizedByStatement.set(edge.statementSha256, edge);
  }
  const authorizedEdges = [...authorizedByStatement.values()]
    .sort(compareCanonical);
  const outgoing = new Map<KnowledgeEntityId, KnowledgeGraphEdgeV1[]>();
  for (const edge of authorizedEdges) {
    const bucket = outgoing.get(edge.fromEntityId) ?? [];
    bucket.push(edge);
    outgoing.set(edge.fromEntityId, bucket);
  }
  const visited = new Set<KnowledgeEntityId>([input.rootEntityId]);
  const queued = new Set<KnowledgeEntityId>([input.rootEntityId]);
  const queue: Array<Readonly<{ depth: number; entityId: KnowledgeEntityId }>> = [
    { depth: 0, entityId: input.rootEntityId },
  ];
  const selected: KnowledgeGraphEdgeV1[] = [];
  const frontier = new Set<KnowledgeEntityId>();
  const truncations = new Set<KnowledgeGraphTraversalTruncationV1>();
  let bytes = 0;
  let work = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const edges = outgoing.get(current.entityId) ?? [];
    if (current.depth >= input.budget.depth && edges.some((edge) =>
      !visited.has(edge.toEntityId))) {
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
      const encodedBytes = utf8ByteLength(canonicalKey(edge));
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
    v: 1 as const,
    work,
  };
  return success(result);
}

export type KnowledgeGraphRecordValueByKindV1 = Readonly<{
  activity: KnowledgeActivityV1;
  assertion: KnowledgeAssertionV1;
  context: KnowledgeContextV1;
  "dependency-manifest": KnowledgeEditionDependencyManifestV1;
  edition: KnowledgeEditionV1;
  entity: KnowledgeEntityV1;
  evidence: KnowledgeEvidenceLinkV1;
  "identity-operation": KnowledgeIdentityOperationV1;
  inquiry: KnowledgeInquiryV1;
  "inquiry-event": KnowledgeInquiryEventV1;
  "review-decision": KnowledgeReviewDecisionV1;
  "rights-decision": KnowledgeRightsDecisionV1;
  schema: KnowledgeSchemaRevisionV1;
  shape: KnowledgeExecutableShapeV1;
  statement: KnowledgeStatementV1;
  "type-membership": KnowledgeTypeMembershipV1;
  view: KnowledgeViewSpecV1;
  vocabulary: KnowledgeVocabularyRevisionV1;
}>;

export type ParsedKnowledgeGraphRecordV1<
  K extends KnowledgeGraphRecordKindV1 = KnowledgeGraphRecordKindV1,
> = Readonly<{
  kind: K;
  recordSha256: Sha256Hex;
  value: KnowledgeGraphRecordValueByKindV1[K];
  v: 1;
}>;

function parsedGraphRecord<K extends KnowledgeGraphRecordKindV1>(
  kind: K,
  recordSha256: Sha256Hex,
  value: KnowledgeGraphRecordValueByKindV1[K],
): KnowledgeOntologyResult<ParsedKnowledgeGraphRecordV1<K>> {
  return success({ kind, recordSha256, value, v: 1 });
}

/**
 * The one semantic ingress for durable graph records. Each branch delegates to
 * the record's authoritative strict parser; embedded record digests are
 * recomputed there. Entity is the only identity record without an embedded
 * content digest, so its exact canonical bytes are hashed here.
 */
export async function parseKnowledgeGraphRecordV1<K extends KnowledgeGraphRecordKindV1>(
  kind: K,
  value: unknown,
): Promise<KnowledgeOntologyResult<ParsedKnowledgeGraphRecordV1<K>>> {
  switch (kind) {
    case "activity": {
      const parsed = await parseKnowledgeActivityV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.activitySha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "assertion": {
      const parsed = await parseKnowledgeAssertionV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.assertionSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "context": {
      const parsed = await parseKnowledgeContextV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.contextSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "dependency-manifest": {
      const parsed = await parseKnowledgeEditionDependencyManifestV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.manifestSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "edition": {
      const parsed = await parseKnowledgeEditionV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.editionSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "entity": {
      const parsed = parseKnowledgeEntityV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      const recordSha256 = await sha256Text(canonicalKey(parsed.value));
      return parsedGraphRecord(kind, recordSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "evidence": {
      const parsed = await parseKnowledgeEvidenceLinkV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.evidenceSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "identity-operation": {
      const parsed = await parseKnowledgeIdentityOperationV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.operationSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "inquiry": {
      const parsed = await parseKnowledgeInquiryV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.inquirySha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "inquiry-event": {
      const parsed = await parseKnowledgeInquiryEventV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.eventSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "review-decision": {
      const parsed = await parseKnowledgeReviewDecisionV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.decisionSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "rights-decision": {
      const parsed = await parseKnowledgeRightsDecisionV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.decisionSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "schema": {
      const parsed = await parseKnowledgeSchemaRevisionV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.revisionSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "shape": {
      const parsed = await parseKnowledgeExecutableShapeV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.shapeSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "statement": {
      const parsed = await parseKnowledgeStatementV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.statementSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "type-membership": {
      const parsed = await parseKnowledgeTypeMembershipV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.membershipSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "view": {
      const parsed = await parseKnowledgeViewSpecV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.viewSpecSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    case "vocabulary": {
      const parsed = await parseKnowledgeVocabularyRevisionV1(value);
      if (!parsed.ok) return failure(parsed.error.field, parsed.error.code);
      return parsedGraphRecord(kind, parsed.value.revisionSha256,
        parsed.value as KnowledgeGraphRecordValueByKindV1[K]);
    }
    default: {
      const exhaustive: never = kind;
      return failure(`recordKind:${String(exhaustive)}`);
    }
  }
}

export const SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1 = [
  "activity", "context", "review-decision", "rights-decision", "statement",
  "type-membership", "view",
] as const satisfies readonly KnowledgeGraphRecordKindV1[];

function callerRecordKey(value: unknown): string | null {
  return typeof value === "string" && value.length <= 512
      && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value)
    ? value
    : null;
}

/**
 * Produces the logical, replay-stable key used beside the authoritative content
 * digest. Records without a natural semantic ID deliberately require a caller
 * key; accepting a digest as their logical key would hide idempotency mistakes.
 */
export function knowledgeGraphRecordKeyV1<K extends KnowledgeGraphRecordKindV1>(
  kind: K,
  value: KnowledgeGraphRecordValueByKindV1[K],
  requiredCallerRecordKey?: string,
): KnowledgeOntologyResult<string> {
  const explicit = callerRecordKey(requiredCallerRecordKey);
  switch (kind) {
    case "activity":
    case "context":
    case "review-decision":
    case "rights-decision":
    case "statement":
    case "type-membership":
    case "view":
      return explicit === null ? failure("recordKey") : success(`${kind}:${explicit}`);
    case "assertion":
      return success(`assertion:${(value as KnowledgeAssertionV1).assertionId}`);
    case "dependency-manifest":
      return success(`dependency-manifest:${
        (value as KnowledgeEditionDependencyManifestV1).editionId}`);
    case "edition":
      return success(`edition:${(value as KnowledgeEditionV1).editionId}`);
    case "entity":
      return success(`entity:${(value as KnowledgeEntityV1).entityId}`);
    case "evidence":
      return success(`evidence:${(value as KnowledgeEvidenceLinkV1).evidenceId}`);
    case "identity-operation":
      return success(`identity-operation:${
        (value as KnowledgeIdentityOperationV1).operationId}`);
    case "inquiry":
      return success(`inquiry:${(value as KnowledgeInquiryV1).inquiryId}`);
    case "inquiry-event": {
      const event = value as KnowledgeInquiryEventV1;
      return success(`inquiry-event:${event.inquiryId}:${String(event.sequence)}`);
    }
    case "schema": {
      const identity = (value as KnowledgeSchemaRevisionV1).identity;
      return success(`schema:${identity.namespace}:${identity.code}:${String(identity.revision)}`);
    }
    case "shape": {
      const ref = (value as KnowledgeExecutableShapeV1).shape;
      return success(`shape:${ref.namespace}:${ref.code}:${String(ref.revision)}`);
    }
    case "vocabulary": {
      const vocabulary = value as KnowledgeVocabularyRevisionV1;
      return success(`vocabulary:${vocabulary.namespace}:${String(vocabulary.revision)}`);
    }
    default: {
      const exhaustive: never = kind;
      return failure(`recordKind:${String(exhaustive)}`);
    }
  }
}
