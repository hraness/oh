import {
  boundedText,
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  orderedUnique,
  parseCanonicalInstantV1,
  parseSha256Hex,
  safeCode,
  sha256Hex,
  sortUnique,
  type Sha256Hex,
} from "./canonical";

export const OH_ONTOLOGY_VERSION_V1 = "1.0.0" as const;
export const OH_CONTRACT_ID_V1 = "oh.ontology.v1" as const;

export const OH_KNOWLEDGE_LIMITS_V1 = Object.freeze({
  dimensions: 64,
  listValues: 256,
  qualifiers: 128,
  statementBytes: 256 * 1024,
  textBytes: 64 * 1024,
});

export const OH_KNOWLEDGE_KERNEL_CONCEPTS_V1 = [
  { code: "entity", description: "A stable identity anchor for something that can be referred to.", label: "Entity" },
  { code: "statement", description: "An immutable proposition with a subject, predicate, object, and qualifiers.", label: "Statement" },
  { code: "assertion", description: "An attributable stance toward a statement.", label: "Assertion" },
  { code: "evidence", description: "A typed account of how an observation bears on an assertion.", label: "Evidence" },
  { code: "context", description: "The scenario and dimensions in which knowledge applies.", label: "Context" },
  { code: "inquiry", description: "A question and its durable investigation trail.", label: "Inquiry" },
  { code: "projection", description: "A reproducible view derived from exact knowledge.", label: "Projection" },
] as const;

export type KnowledgeOntologyIssueCode =
  | "dependency-missing"
  | "digest-mismatch"
  | "invalid-input"
  | "limit-exceeded"
  | "noncanonical-input";

export type KnowledgeOntologyResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ error: Readonly<{ code: KnowledgeOntologyIssueCode; field: string }>; ok: false }>;

function success<T>(value: T): KnowledgeOntologyResult<T> { return { ok: true, value }; }
function failure<T>(field: string, code: KnowledgeOntologyIssueCode = "invalid-input"): KnowledgeOntologyResult<T> {
  return { error: { code, field }, ok: false };
}

declare const entityIdBrand: unique symbol;
declare const assertionIdBrand: unique symbol;
declare const evidenceIdBrand: unique symbol;
declare const inquiryIdBrand: unique symbol;
export type KnowledgeEntityId = string & { readonly [entityIdBrand]: "KnowledgeEntityId" };
export type KnowledgeAssertionId = string & { readonly [assertionIdBrand]: "KnowledgeAssertionId" };
export type KnowledgeEvidenceId = string & { readonly [evidenceIdBrand]: "KnowledgeEvidenceId" };
export type KnowledgeInquiryId = string & { readonly [inquiryIdBrand]: "KnowledgeInquiryId" };

function parseOpaqueId<T extends string>(value: unknown, prefix: string): T | null {
  return typeof value === "string" && new RegExp(`^${prefix}[a-z0-9]{24}$`, "u").test(value)
    ? value as T : null;
}
export function parseKnowledgeEntityId(value: unknown): KnowledgeEntityId | null {
  return parseOpaqueId<KnowledgeEntityId>(value, "kent_");
}
export function parseKnowledgeAssertionId(value: unknown): KnowledgeAssertionId | null {
  return parseOpaqueId<KnowledgeAssertionId>(value, "kast_");
}
export function parseKnowledgeEvidenceId(value: unknown): KnowledgeEvidenceId | null {
  return parseOpaqueId<KnowledgeEvidenceId>(value, "kevd_");
}
export function parseKnowledgeInquiryId(value: unknown): KnowledgeInquiryId | null {
  return parseOpaqueId<KnowledgeInquiryId>(value, "kinq_");
}

export const OH_KNOWLEDGE_ENTITY_STATES_V1 = ["active", "quarantined", "redirected", "tombstoned"] as const;
export type KnowledgeEntityStateV1 = (typeof OH_KNOWLEDGE_ENTITY_STATES_V1)[number];
export type KnowledgeEntityV1 = Readonly<{
  entityId: KnowledgeEntityId;
  identityOperationId: string;
  identityRevision: number;
  redirectEntityId: KnowledgeEntityId | null;
  state: KnowledgeEntityStateV1;
  v: 1;
}>;

export function parseKnowledgeEntityV1(value: unknown): KnowledgeOntologyResult<KnowledgeEntityV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["entityId", "identityOperationId", "identityRevision",
    "redirectEntityId", "state", "v"]) || value.v !== 1) return failure("entity");
  const entityId = parseKnowledgeEntityId(value.entityId);
  const identityOperationId = safeCode(value.identityOperationId);
  const identityRevision = Number.isSafeInteger(value.identityRevision) && (value.identityRevision as number) > 0
    ? value.identityRevision as number : null;
  const redirectEntityId = value.redirectEntityId === null ? null : parseKnowledgeEntityId(value.redirectEntityId);
  const state = OH_KNOWLEDGE_ENTITY_STATES_V1.find((candidate) => candidate === value.state);
  return entityId !== null && identityOperationId !== null && identityRevision !== null
      && (value.redirectEntityId === null || redirectEntityId !== null) && state !== undefined
      && ((state === "redirected") === (redirectEntityId !== null)) && redirectEntityId !== entityId
    ? success({ entityId, identityOperationId, identityRevision, redirectEntityId, state, v: 1 })
    : failure("entity");
}

export type KnowledgeSchemaRefV1 = Readonly<{
  code: string;
  namespace: string;
  revision: number;
  schemaSha256: Sha256Hex;
  v: 1;
}>;

export function parseKnowledgeSchemaRefV1(value: unknown): KnowledgeOntologyResult<KnowledgeSchemaRefV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["code", "namespace", "revision", "schemaSha256", "v"])
    || value.v !== 1) return failure("schemaRef");
  const code = safeCode(value.code);
  const namespace = safeCode(value.namespace);
  const revision = Number.isSafeInteger(value.revision) && (value.revision as number) > 0
    ? value.revision as number : null;
  const schemaSha256 = parseSha256Hex(value.schemaSha256);
  return code !== null && namespace !== null && revision !== null && schemaSha256 !== null
    ? success({ code, namespace, revision, schemaSha256, v: 1 }) : failure("schemaRef");
}

export type KnowledgeValueV1 =
  | Readonly<{ entityId: KnowledgeEntityId; kind: "entity"; v: 1 }>
  | Readonly<{ kind: "text"; language: string; text: string; v: 1 }>
  | Readonly<{ kind: "string"; v: 1; value: string }>
  | Readonly<{ kind: "boolean"; v: 1; value: boolean }>
  | Readonly<{ kind: "integer" | "decimal"; v: 1; value: string }>
  | Readonly<{ kind: "uri"; uri: string; v: 1 }>
  | Readonly<{ kind: "list" | "set"; v: 1; values: readonly KnowledgeValueV1[] }>
  | Readonly<{
    canonicalizerSha256: Sha256Hex;
    canonicalValue: string;
    kind: "extension";
    mediaType: string;
    schema: KnowledgeSchemaRefV1;
    v: 1;
    valueSha256: Sha256Hex;
  }>;

const INTEGER = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u;
const DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u;

function parseKnowledgeValueInternal(value: unknown, depth: number): KnowledgeValueV1 | null {
  if (!isPlainRecord(value) || value.v !== 1 || depth > 8) return null;
  switch (value.kind) {
    case "entity": {
      if (!hasExactKeys(value, ["entityId", "kind", "v"])) return null;
      const entityId = parseKnowledgeEntityId(value.entityId);
      return entityId === null ? null : { entityId, kind: "entity", v: 1 };
    }
    case "text": {
      if (!hasExactKeys(value, ["kind", "language", "text", "v"])) return null;
      const language = typeof value.language === "string"
          && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value.language)
        ? value.language : null;
      const text = boundedText(value.text);
      return language !== null && text !== null ? { kind: "text", language, text, v: 1 } : null;
    }
    case "string": {
      const parsed = boundedText(value.value);
      return hasExactKeys(value, ["kind", "v", "value"]) && parsed !== null
        ? { kind: "string", v: 1, value: parsed } : null;
    }
    case "boolean":
      return hasExactKeys(value, ["kind", "v", "value"]) && typeof value.value === "boolean"
        ? { kind: "boolean", v: 1, value: value.value } : null;
    case "integer":
    case "decimal": {
      const valid = typeof value.value === "string" && value.value.length <= 1024
        && (value.kind === "integer" ? INTEGER.test(value.value) : DECIMAL.test(value.value) && value.value !== "-0");
      return hasExactKeys(value, ["kind", "v", "value"]) && valid
        ? { kind: value.kind, v: 1, value: value.value as string } : null;
    }
    case "uri": {
      if (!hasExactKeys(value, ["kind", "uri", "v"]) || typeof value.uri !== "string" || value.uri.length > 4096) return null;
      try {
        const url = new URL(value.uri);
        return url.href === value.uri && url.username === "" && url.password === ""
            && !["data:", "file:", "javascript:"].includes(url.protocol)
          ? { kind: "uri", uri: value.uri, v: 1 } : null;
      } catch { return null; }
    }
    case "list":
    case "set": {
      if (!hasExactKeys(value, ["kind", "v", "values"]) || !Array.isArray(value.values)
        || value.values.length > OH_KNOWLEDGE_LIMITS_V1.listValues) return null;
      const values: KnowledgeValueV1[] = [];
      for (const item of value.values) {
        const parsed = parseKnowledgeValueInternal(item, depth + 1);
        if (parsed === null) return null;
        values.push(parsed);
      }
      if (value.kind === "set" && !orderedUnique(values, canonicalJson)) return null;
      return { kind: value.kind, v: 1, values };
    }
    case "extension": {
      if (!hasExactKeys(value, ["canonicalizerSha256", "canonicalValue", "kind", "mediaType", "schema", "v", "valueSha256"])) return null;
      const canonicalizerSha256 = parseSha256Hex(value.canonicalizerSha256);
      const canonicalValue = boundedText(value.canonicalValue, 64 * 1024);
      const mediaType = typeof value.mediaType === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value.mediaType)
        ? value.mediaType : null;
      const schema = parseKnowledgeSchemaRefV1(value.schema);
      const valueSha256 = parseSha256Hex(value.valueSha256);
      return canonicalizerSha256 !== null && canonicalValue !== null && mediaType !== null && schema.ok && valueSha256 !== null
        ? { canonicalizerSha256, canonicalValue, kind: "extension", mediaType, schema: schema.value, v: 1, valueSha256 }
        : null;
    }
    default: return null;
  }
}

export function parseKnowledgeValueV1(value: unknown): KnowledgeOntologyResult<KnowledgeValueV1> {
  const parsed = parseKnowledgeValueInternal(value, 0);
  return parsed === null ? failure("value") : success(parsed);
}

export function verifyKnowledgeValueV1(value: KnowledgeValueV1): KnowledgeOntologyResult<KnowledgeValueV1> {
  const parsed = parseKnowledgeValueV1(value);
  if (!parsed.ok) return parsed;
  if (parsed.value.kind === "extension" && sha256Hex(parsed.value.canonicalValue) !== parsed.value.valueSha256) {
    return failure("valueSha256", "digest-mismatch");
  }
  if (parsed.value.kind === "list" || parsed.value.kind === "set") {
    for (const child of parsed.value.values) {
      const verified = verifyKnowledgeValueV1(child);
      if (!verified.ok) return verified;
    }
  }
  return success(parsed.value);
}

export type KnowledgeDimensionV1 = Readonly<{ predicate: KnowledgeSchemaRefV1; v: 1; value: KnowledgeValueV1 }>;

function parseDimension(value: unknown): KnowledgeDimensionV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["predicate", "v", "value"]) || value.v !== 1) return null;
  const predicate = parseKnowledgeSchemaRefV1(value.predicate);
  const parsedValue = parseKnowledgeValueV1(value.value);
  return predicate.ok && parsedValue.ok ? { predicate: predicate.value, v: 1, value: parsedValue.value } : null;
}

export type KnowledgeContextV1 = Readonly<{
  contextSha256: Sha256Hex;
  dimensions: readonly KnowledgeDimensionV1[];
  scenario: "actual" | "counterfactual" | "hypothetical" | "planned";
  v: 1;
}>;
export type KnowledgeContextInputV1 = Omit<KnowledgeContextV1, "contextSha256">;

export function createKnowledgeContextV1(input: KnowledgeContextInputV1): KnowledgeOntologyResult<KnowledgeContextV1> {
  if (!isPlainRecord(input) || input.v !== 1 || !Array.isArray(input.dimensions)
    || input.dimensions.length > OH_KNOWLEDGE_LIMITS_V1.dimensions
    || !["actual", "counterfactual", "hypothetical", "planned"].includes(input.scenario)) return failure("context");
  const dimensions: KnowledgeDimensionV1[] = [];
  for (const item of input.dimensions) {
    const parsed = parseDimension(item);
    if (parsed === null) return failure("dimensions");
    const verified = verifyKnowledgeValueV1(parsed.value);
    if (!verified.ok) return verified;
    dimensions.push(parsed);
  }
  let canonicalDimensions: readonly KnowledgeDimensionV1[];
  try { canonicalDimensions = sortUnique(dimensions, canonicalJson); } catch { return failure("dimensions", "noncanonical-input"); }
  const payload = { dimensions: canonicalDimensions, scenario: input.scenario, v: 1 as const };
  return success({ ...payload, contextSha256: canonicalSha256(payload) });
}

export function parseKnowledgeContextV1(value: unknown): KnowledgeOntologyResult<KnowledgeContextV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["contextSha256", "dimensions", "scenario", "v"])) return failure("context");
  const digest = parseSha256Hex(value.contextSha256);
  if (digest === null) return failure("contextSha256");
  const created = createKnowledgeContextV1({ dimensions: value.dimensions as KnowledgeDimensionV1[], scenario: value.scenario as KnowledgeContextInputV1["scenario"], v: value.v as 1 });
  return created.ok && created.value.contextSha256 === digest && canonicalJson(created.value.dimensions) === canonicalJson(value.dimensions)
    ? success({ ...created.value, contextSha256: digest }) : failure("contextSha256", "digest-mismatch");
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

export function createKnowledgeStatementV1(input: KnowledgeStatementInputV1): KnowledgeOntologyResult<KnowledgeStatementV1> {
  const object = parseKnowledgeValueV1(input.object);
  const predicate = parseKnowledgeSchemaRefV1(input.predicate);
  const subject = parseKnowledgeEntityId(input.subject);
  if (input.v !== 1 || !object.ok || !predicate.ok || subject === null || !Array.isArray(input.qualifiers)
    || input.qualifiers.length > OH_KNOWLEDGE_LIMITS_V1.qualifiers) return failure("statement");
  const verifiedObject = verifyKnowledgeValueV1(object.value);
  if (!verifiedObject.ok) return verifiedObject;
  const qualifiers: KnowledgeDimensionV1[] = [];
  for (const item of input.qualifiers) {
    const parsed = parseDimension(item);
    if (parsed === null) return failure("qualifiers");
    const verified = verifyKnowledgeValueV1(parsed.value);
    if (!verified.ok) return verified;
    qualifiers.push(parsed);
  }
  let canonicalQualifiers: readonly KnowledgeDimensionV1[];
  try { canonicalQualifiers = sortUnique(qualifiers, canonicalJson); } catch { return failure("qualifiers", "noncanonical-input"); }
  const payload = { object: object.value, predicate: predicate.value, qualifiers: canonicalQualifiers, subject, v: 1 as const };
  if (Buffer.byteLength(canonicalJson(payload), "utf8") > OH_KNOWLEDGE_LIMITS_V1.statementBytes) return failure("statement", "limit-exceeded");
  return success({ ...payload, statementSha256: canonicalSha256(payload) });
}

export function parseKnowledgeStatementV1(value: unknown): KnowledgeOntologyResult<KnowledgeStatementV1> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["object", "predicate", "qualifiers", "statementSha256", "subject", "v"])) return failure("statement");
  const digest = parseSha256Hex(value.statementSha256);
  const created = createKnowledgeStatementV1(value as unknown as KnowledgeStatementInputV1);
  return digest !== null && created.ok && created.value.statementSha256 === digest
      && canonicalJson(created.value.qualifiers) === canonicalJson(value.qualifiers)
    ? success({ ...created.value, statementSha256: digest }) : failure("statementSha256", "digest-mismatch");
}

export type KnowledgeAgentRefV1 =
  | Readonly<{ entityId: KnowledgeEntityId; kind: "entity"; v: 1 }>
  | Readonly<{ kind: "model"; model: KnowledgeSchemaRefV1; receiptSha256: Sha256Hex; v: 1 }>
  | Readonly<{ authority: KnowledgeSchemaRefV1; kind: "system"; receiptSha256: Sha256Hex; v: 1 }>;

function parseKnowledgeAgentRefV1(value: unknown): KnowledgeAgentRefV1 | null {
  if (!isPlainRecord(value) || value.v !== 1) return null;
  if (value.kind === "entity" && hasExactKeys(value, ["entityId", "kind", "v"])) {
    const entityId = parseKnowledgeEntityId(value.entityId);
    return entityId === null ? null : { entityId, kind: "entity", v: 1 };
  }
  if (value.kind === "model" && hasExactKeys(value, ["kind", "model", "receiptSha256", "v"])) {
    const model = parseKnowledgeSchemaRefV1(value.model);
    const receiptSha256 = parseSha256Hex(value.receiptSha256);
    return model.ok && receiptSha256 !== null ? { kind: "model", model: model.value, receiptSha256, v: 1 } : null;
  }
  if (value.kind === "system" && hasExactKeys(value, ["authority", "kind", "receiptSha256", "v"])) {
    const authority = parseKnowledgeSchemaRefV1(value.authority);
    const receiptSha256 = parseSha256Hex(value.receiptSha256);
    return authority.ok && receiptSha256 !== null
      ? { authority: authority.value, kind: "system", receiptSha256, v: 1 } : null;
  }
  return null;
}

function parseDigestArray(value: unknown, maximum = 2048): readonly Sha256Hex[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const digests = value.map(parseSha256Hex);
  return digests.every((digest) => digest !== null) && orderedUnique(digests as Sha256Hex[], String)
    ? digests as Sha256Hex[] : null;
}

export const OH_KNOWLEDGE_ACTIVITY_KINDS_V1 = [
  "extraction", "human-entry", "human-review", "import", "model-proposal",
  "normalization", "publication", "resolution", "transformation",
] as const;
export type KnowledgeActivityKindV1 = (typeof OH_KNOWLEDGE_ACTIVITY_KINDS_V1)[number];
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

function parseActivityInput(value: unknown): KnowledgeActivityInputV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["actor", "inputSha256s", "kind", "occurredAt",
    "outputSha256s", "policySha256", "tool", "v"]) || value.v !== 1) return null;
  const actor = parseKnowledgeAgentRefV1(value.actor);
  const inputSha256s = parseDigestArray(value.inputSha256s);
  const kind = OH_KNOWLEDGE_ACTIVITY_KINDS_V1.find((candidate) => candidate === value.kind);
  const occurredAt = parseCanonicalInstantV1(value.occurredAt);
  const outputSha256s = parseDigestArray(value.outputSha256s);
  const policySha256 = parseSha256Hex(value.policySha256);
  const tool = value.tool === null ? null : parseKnowledgeSchemaRefV1(value.tool);
  const parsedTool = tool === null ? null : tool.ok ? tool.value : null;
  return actor !== null && inputSha256s !== null && kind !== undefined && occurredAt !== null
      && outputSha256s !== null && policySha256 !== null && (value.tool === null || parsedTool !== null)
    ? { actor, inputSha256s, kind, occurredAt, outputSha256s, policySha256, tool: parsedTool, v: 1 }
    : null;
}

export function createKnowledgeActivityV1(input: KnowledgeActivityInputV1): KnowledgeOntologyResult<KnowledgeActivityV1> {
  const parsed = parseActivityInput(input);
  return parsed === null ? failure("activity") : success({ ...parsed, activitySha256: canonicalSha256(parsed) });
}

export function parseKnowledgeActivityV1(value: unknown): KnowledgeOntologyResult<KnowledgeActivityV1> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "activitySha256")) return failure("activity");
  const activitySha256 = parseSha256Hex(value.activitySha256);
  const { activitySha256: _digest, ...input } = value;
  const parsed = parseActivityInput(input);
  return activitySha256 !== null && parsed !== null && canonicalSha256(parsed) === activitySha256
    ? success({ ...parsed, activitySha256 }) : failure("activitySha256", "digest-mismatch");
}

export const OH_KNOWLEDGE_ASSERTION_STANCES_V1 = ["questions", "refutes", "reports", "supports", "undetermined"] as const;
export type KnowledgeAssertionStanceV1 = (typeof OH_KNOWLEDGE_ASSERTION_STANCES_V1)[number];
export const OH_KNOWLEDGE_ASSERTION_STATES_V1 = [
  "accepted-for-purpose", "disputed", "proposed", "reviewed", "superseded", "withdrawn",
] as const;
export type KnowledgeAssertionStateV1 = (typeof OH_KNOWLEDGE_ASSERTION_STATES_V1)[number];
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
  const codes = value.map((item) => safeCode(item));
  return codes.every((code) => code !== null) && orderedUnique(codes as string[], String)
    ? codes as string[] : null;
}

function parseAssertionInput(value: unknown): KnowledgeAssertionInputV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["acceptedPurposes", "assertionId", "assertor",
    "confidence", "contextSha256", "provenanceActivitySha256", "reviewActivitySha256", "stance",
    "state", "statementSha256", "v"]) || value.v !== 1) return null;
  const acceptedPurposes = parseStringCodes(value.acceptedPurposes, 32);
  const assertionId = parseKnowledgeAssertionId(value.assertionId);
  const assertor = parseKnowledgeAgentRefV1(value.assertor);
  const confidence = value.confidence === null ? null : parseKnowledgeSchemaRefV1(value.confidence);
  const parsedConfidence = confidence === null ? null : confidence.ok ? confidence.value : null;
  const contextSha256 = value.contextSha256 === null ? null : parseSha256Hex(value.contextSha256);
  const provenanceActivitySha256 = parseSha256Hex(value.provenanceActivitySha256);
  const reviewActivitySha256 = value.reviewActivitySha256 === null ? null : parseSha256Hex(value.reviewActivitySha256);
  const stance = OH_KNOWLEDGE_ASSERTION_STANCES_V1.find((candidate) => candidate === value.stance);
  const state = OH_KNOWLEDGE_ASSERTION_STATES_V1.find((candidate) => candidate === value.state);
  const statementSha256 = parseSha256Hex(value.statementSha256);
  if (acceptedPurposes === null || assertionId === null || assertor === null
    || (value.confidence !== null && parsedConfidence === null)
    || (value.contextSha256 !== null && contextSha256 === null)
    || provenanceActivitySha256 === null
    || (value.reviewActivitySha256 !== null && reviewActivitySha256 === null)
    || stance === undefined || state === undefined || statementSha256 === null) return null;
  if (assertor.kind === "model" && (state !== "proposed" || acceptedPurposes.length !== 0 || reviewActivitySha256 !== null)) return null;
  if ((state === "accepted-for-purpose") !== (acceptedPurposes.length > 0)
    || (state !== "proposed" && reviewActivitySha256 === null)) return null;
  return { acceptedPurposes, assertionId, assertor, confidence: parsedConfidence, contextSha256,
    provenanceActivitySha256, reviewActivitySha256, stance, state, statementSha256, v: 1 };
}

export function createKnowledgeAssertionV1(input: KnowledgeAssertionInputV1): KnowledgeOntologyResult<KnowledgeAssertionV1> {
  const parsed = parseAssertionInput(input);
  return parsed === null ? failure("assertion") : success({ ...parsed, assertionSha256: canonicalSha256(parsed) });
}

export function parseKnowledgeAssertionV1(value: unknown): KnowledgeOntologyResult<KnowledgeAssertionV1> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "assertionSha256")) return failure("assertion");
  const assertionSha256 = parseSha256Hex(value.assertionSha256);
  const { assertionSha256: _digest, ...input } = value;
  const parsed = parseAssertionInput(input);
  return assertionSha256 !== null && parsed !== null && canonicalSha256(parsed) === assertionSha256
    ? success({ ...parsed, assertionSha256 }) : failure("assertionSha256", "digest-mismatch");
}

export const OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1 = [
  "background", "contradicts", "corroborates", "direct-observation", "method",
  "quotation", "registry-record", "supports",
] as const;
export type KnowledgeEvidenceBearingV1 = (typeof OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1)[number];
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

function parseEvidenceInput(value: unknown): KnowledgeEvidenceLinkInputV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["assertionSha256", "bearing", "disclosure",
    "evidenceId", "observationSha256", "provenanceActivitySha256", "selector", "sourceEntityId", "v"])
    || value.v !== 1) return null;
  const assertionSha256 = parseSha256Hex(value.assertionSha256);
  const bearing = OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1.find((candidate) => candidate === value.bearing);
  const evidenceId = parseKnowledgeEvidenceId(value.evidenceId);
  const observationSha256 = value.observationSha256 === null ? null : parseSha256Hex(value.observationSha256);
  const provenanceActivitySha256 = parseSha256Hex(value.provenanceActivitySha256);
  const selector = value.selector === null ? null : boundedText(value.selector, 8192);
  const sourceEntityId = value.sourceEntityId === null ? null : parseKnowledgeEntityId(value.sourceEntityId);
  return assertionSha256 !== null && bearing !== undefined
      && (value.disclosure === "private" || value.disclosure === "public" || value.disclosure === "shared")
      && evidenceId !== null && (value.observationSha256 === null || observationSha256 !== null)
      && provenanceActivitySha256 !== null && (value.selector === null || selector !== null)
      && (value.sourceEntityId === null || sourceEntityId !== null)
      && (observationSha256 !== null || sourceEntityId !== null)
    ? { assertionSha256, bearing, disclosure: value.disclosure, evidenceId, observationSha256,
        provenanceActivitySha256, selector, sourceEntityId, v: 1 }
    : null;
}

export function createKnowledgeEvidenceLinkV1(input: KnowledgeEvidenceLinkInputV1): KnowledgeOntologyResult<KnowledgeEvidenceLinkV1> {
  const parsed = parseEvidenceInput(input);
  return parsed === null ? failure("evidence") : success({ ...parsed, evidenceSha256: canonicalSha256(parsed) });
}

export function parseKnowledgeEvidenceLinkV1(value: unknown): KnowledgeOntologyResult<KnowledgeEvidenceLinkV1> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "evidenceSha256")) return failure("evidence");
  const evidenceSha256 = parseSha256Hex(value.evidenceSha256);
  const { evidenceSha256: _digest, ...input } = value;
  const parsed = parseEvidenceInput(input);
  return evidenceSha256 !== null && parsed !== null && canonicalSha256(parsed) === evidenceSha256
    ? success({ ...parsed, evidenceSha256 }) : failure("evidenceSha256", "digest-mismatch");
}

export type KnowledgeInquiryV1 = Readonly<{
  answerForm: string;
  authorEntityId: KnowledgeEntityId;
  contextSha256: Sha256Hex | null;
  createdAt: string;
  inquiryId: KnowledgeInquiryId;
  inquirySha256: Sha256Hex;
  language: string;
  parentInquiryIds: readonly KnowledgeInquiryId[];
  privacy: "private" | "public" | "shared";
  question: string;
  status: "abandoned" | "open" | "paused" | "resolved";
  v: 1;
}>;
export type KnowledgeInquiryInputV1 = Omit<KnowledgeInquiryV1, "inquirySha256">;

export function createKnowledgeInquiryV1(input: KnowledgeInquiryInputV1): KnowledgeOntologyResult<KnowledgeInquiryV1> {
  const answerForm = safeCode(input.answerForm);
  const authorEntityId = parseKnowledgeEntityId(input.authorEntityId);
  const contextSha256 = input.contextSha256 === null ? null : parseSha256Hex(input.contextSha256);
  const createdAt = parseCanonicalInstantV1(input.createdAt);
  const inquiryId = parseKnowledgeInquiryId(input.inquiryId);
  const language = typeof input.language === "string" && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(input.language)
    ? input.language : null;
  const parents = Array.isArray(input.parentInquiryIds) ? input.parentInquiryIds.map(parseKnowledgeInquiryId) : null;
  const question = boundedText(input.question, 16_384);
  if (input.v !== 1 || answerForm === null || authorEntityId === null
    || (input.contextSha256 !== null && contextSha256 === null) || createdAt === null || inquiryId === null
    || language === null || parents === null || parents.some((item) => item === null)
    || !orderedUnique(parents as KnowledgeInquiryId[], String)
    || !["private", "public", "shared"].includes(input.privacy) || question === null
    || !["abandoned", "open", "paused", "resolved"].includes(input.status)) return failure("inquiry");
  const payload = { answerForm, authorEntityId, contextSha256, createdAt, inquiryId, language,
    parentInquiryIds: parents as KnowledgeInquiryId[], privacy: input.privacy, question, status: input.status, v: 1 as const };
  return success({ ...payload, inquirySha256: canonicalSha256(payload) });
}

export function parseKnowledgeInquiryV1(value: unknown): KnowledgeOntologyResult<KnowledgeInquiryV1> {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "inquirySha256")) return failure("inquiry");
  const digest = parseSha256Hex(value.inquirySha256);
  const { inquirySha256: _digest, ...input } = value;
  const created = createKnowledgeInquiryV1(input as unknown as KnowledgeInquiryInputV1);
  return digest !== null && created.ok && created.value.inquirySha256 === digest
    ? success({ ...created.value, inquirySha256: digest }) : failure("inquirySha256", "digest-mismatch");
}
