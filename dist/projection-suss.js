// @bun
// src/projection-suss.ts
import {
  Database,
  constant,
  evaluate,
  lit,
  rule,
  variable
} from "@suss/datalog";

// src/canonical.ts
import { createHash, randomBytes } from "crypto";

class OhValidationError extends Error {
  code;
  path;
  constructor(code, path, message) {
    super(`${path}: ${message}`);
    this.name = "OhValidationError";
    this.code = code;
    this.path = path;
  }
}
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function assertUnicodeScalarString(value, path) {
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343)) {
        throw new OhValidationError("invalid-unicode", path, "contains an unpaired surrogate");
      }
      index += 1;
    } else if (code >= 56320 && code <= 57343) {
      throw new OhValidationError("invalid-unicode", path, "contains an unpaired surrogate");
    }
  }
}
function encodeCanonical(value, path, ancestors) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "string") {
    assertUnicodeScalarString(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new OhValidationError("non-json-number", path, "must be finite");
    }
    if (Object.is(value, -0)) {
      throw new OhValidationError("noncanonical-number", path, "negative zero is not canonical");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === null) {
    throw new OhValidationError("non-json-value", path, `cannot encode ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new OhValidationError("cycle", path, "contains a cycle");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const encoded = [];
      for (let index = 0;index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new OhValidationError("sparse-array", `${path}[${index}]`, "must not contain holes");
        }
        encoded.push(encodeCanonical(value[index], `${path}[${index}]`, ancestors));
      }
      const extraKeys = Reflect.ownKeys(value).filter((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length));
      if (extraKeys.length > 0) {
        throw new OhValidationError("non-json-property", path, "array has non-index properties");
      }
      return `[${encoded.join(",")}]`;
    }
    if (!isPlainRecord(value)) {
      throw new OhValidationError("non-plain-object", path, "must be a plain object");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new OhValidationError("non-json-property", path, "object has a symbol property");
    }
    const keys = ownKeys;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new OhValidationError("non-json-property", `${path}.${key}`, "must be an enumerable data property");
      }
    }
    keys.sort();
    const entries = keys.map((key) => {
      assertUnicodeScalarString(key, `${path}.<key>`);
      return `${JSON.stringify(key)}:${encodeCanonical(value[key], `${path}.${key}`, ancestors)}`;
    });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
function canonicalJson(value) {
  return encodeCanonical(value, "$", new Set);
}
function parseCanonicalJson(text, maximumBytes = 16 * 1024 * 1024) {
  if (utf8ByteLength(text) > maximumBytes) {
    throw new OhValidationError("limit-exceeded", "$", "canonical JSON exceeds its byte limit");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new OhValidationError("invalid-json", "$", "is not valid JSON");
  }
  if (canonicalJson(value) !== text) {
    throw new OhValidationError("noncanonical-json", "$", "keys or values are not canonical");
  }
  return value;
}
function utf8ByteLength(value) {
  return Buffer.byteLength(value, "utf8");
}
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function canonicalSha256(value) {
  return sha256Hex(canonicalJson(value));
}
function parseSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}
function parseCanonicalInstantV1(value) {
  if (typeof value !== "string" || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u.test(value)) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : null;
}
function canonicalNow() {
  return new Date().toISOString();
}
function opaqueId(prefix) {
  if (!/^[a-z][a-z0-9_]{1,15}$/u.test(prefix)) {
    throw new OhValidationError("invalid-prefix", "prefix", "must be a short lowercase code");
  }
  return `${prefix}${randomBytes(12).toString("hex")}`;
}
function safeCode(value, maximumLength = 128) {
  return typeof value === "string" && value.length <= maximumLength && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function boundedText(value, maximumBytes = 64 * 1024) {
  if (typeof value !== "string" || value.length === 0 || value.normalize("NFC") !== value || utf8ByteLength(value) > maximumBytes)
    return null;
  try {
    assertUnicodeScalarString(value, "$text");
  } catch {
    return null;
  }
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code >= 11 && code <= 12 || code >= 14 && code <= 31 || code >= 127 && code <= 159)
      return null;
  }
  return value;
}
function orderedUnique(values, key) {
  return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value));
}
function sortUnique(values, key) {
  const sorted = [...values].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  if (!orderedUnique(sorted, key)) {
    throw new OhValidationError("duplicate", "$", "contains duplicate canonical values");
  }
  return sorted;
}

// src/graph.ts
var OH_GRAPH_FORMAT_VERSION_V1 = 1;
var OH_GRAPH_LIMITS_V1 = Object.freeze({
  changesPerOperation: 8192,
  dependenciesPerRecord: 4096,
  recordBytes: 1024 * 1024,
  recordsPerSnapshot: 65536
});
var OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 = [
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
function recordKey(value) {
  return typeof value === "string" && value.length <= 512 && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function createKnowledgeGraphRecordV1(input) {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["dependencies", "key", "kind", "v", "value"]) || input.v !== 1 || !Array.isArray(input.dependencies))
    throw new TypeError("Invalid graph record input.");
  const key = recordKey(input.key);
  const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === input.kind);
  if (key === null || kind === undefined || input.dependencies.length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord)
    throw new TypeError("Invalid graph record identity.");
  const dependencies = input.dependencies.map(recordKey);
  if (dependencies.some((dependency) => dependency === null) || !orderedUnique(dependencies, String) || dependencies.includes(key)) {
    throw new TypeError("Graph dependencies must be ordered, unique, and non-reflexive.");
  }
  const valueJson = canonicalJson(input.value);
  if (Buffer.byteLength(valueJson, "utf8") > OH_GRAPH_LIMITS_V1.recordBytes) {
    throw new RangeError("Graph record value exceeds its canonical byte limit.");
  }
  const payload = { dependencies, key, kind, v: 1, value: input.value };
  return { ...payload, recordSha256: canonicalSha256(payload) };
}
function parseKnowledgeGraphRecordV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "recordSha256"))
    return null;
  const recordSha256 = parseSha256Hex(value.recordSha256);
  const { recordSha256: _digest, ...input } = value;
  try {
    const created = createKnowledgeGraphRecordV1(input);
    return recordSha256 !== null && created.recordSha256 === recordSha256 ? { ...created, recordSha256 } : null;
  } catch {
    return null;
  }
}
function knowledgeGraphRecordRefV1(record) {
  return {
    dependencies: record.dependencies,
    key: record.key,
    kind: record.kind,
    sha256: record.recordSha256,
    v: 1
  };
}
function changeKey(change) {
  return change.kind === "put" ? change.record.key : change.key;
}
function canonicalKnowledgeGraphChangesV1(changes) {
  const normalized = [];
  for (const change of changes) {
    if (!isPlainRecord(change) || change.v !== 1)
      throw new TypeError("Invalid graph change.");
    if (change.kind === "put") {
      const record = parseKnowledgeGraphRecordV1(change.record);
      if (record === null)
        throw new TypeError("Invalid graph record in change.");
      normalized.push({ kind: "put", record, v: 1 });
    } else if (change.kind === "tombstone") {
      const key = recordKey(change.key);
      const priorSha256 = parseSha256Hex(change.priorSha256);
      if (key === null || priorSha256 === null)
        throw new TypeError("Invalid graph tombstone.");
      normalized.push({ key, kind: "tombstone", priorSha256, v: 1 });
    } else
      throw new TypeError("Unknown graph change kind.");
  }
  return sortUnique(normalized, changeKey);
}
function graphRevisionSha256V1(input) {
  const changes = canonicalKnowledgeGraphChangesV1(input.changes);
  const operationId = safeCode(input.operationId);
  const parentGraphRevisionSha256 = input.parentGraphRevisionSha256 === null ? null : parseSha256Hex(input.parentGraphRevisionSha256);
  const recordsSha256 = parseSha256Hex(input.recordsSha256);
  const revision = Number.isSafeInteger(input.revision) && input.revision > 0 ? input.revision : null;
  if (changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation || operationId === null || recordsSha256 === null || revision === null || input.parentGraphRevisionSha256 !== null && parentGraphRevisionSha256 === null || revision === 1 !== (parentGraphRevisionSha256 === null)) {
    throw new TypeError("Invalid graph revision digest input.");
  }
  return canonicalSha256({ changes, operationId, parentGraphRevisionSha256, recordsSha256, revision, v: 1 });
}
function createKnowledgeGraphRevisionV1(input) {
  if (input.parent !== null && parseKnowledgeGraphRevisionV1(input.parent) === null) {
    throw new TypeError("Invalid parent graph revision.");
  }
  const operationId = safeCode(input.operationId);
  const changes = canonicalKnowledgeGraphChangesV1(input.changes);
  if (operationId === null || changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation)
    throw new TypeError("Invalid graph revision.");
  const byKey = new Map((input.parent?.recordRefs ?? []).map((ref) => [ref.key, ref]));
  for (const change of changes) {
    if (change.kind === "put") {
      for (const dependency of change.record.dependencies) {
        if (!byKey.has(dependency) && !changes.some((candidate) => candidate.kind === "put" && candidate.record.key === dependency)) {
          throw new TypeError(`Missing graph dependency: ${dependency}`);
        }
      }
      byKey.set(change.record.key, knowledgeGraphRecordRefV1(change.record));
    } else {
      const prior = byKey.get(change.key);
      if (prior === undefined || prior.sha256 !== change.priorSha256)
        throw new TypeError("Tombstone prior digest does not match.");
      byKey.delete(change.key);
    }
  }
  if (byKey.size > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    throw new RangeError("Graph revision exceeds its record snapshot limit.");
  }
  for (const ref of byKey.values()) {
    if (ref.dependencies.some((dependency) => !byKey.has(dependency))) {
      throw new TypeError(`Missing graph dependency after revision: ${ref.key}`);
    }
  }
  const recordRefs = [...byKey.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  const recordsSha256 = canonicalSha256(recordRefs);
  const payload = {
    changes,
    operationId,
    parentGraphRevisionSha256: input.parent?.graphRevisionSha256 ?? null,
    recordRefs,
    recordsSha256,
    revision: (input.parent?.revision ?? 0) + 1,
    v: 1
  };
  return { ...payload, graphRevisionSha256: graphRevisionSha256V1(payload) };
}
function parseKnowledgeGraphRevisionV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "changes",
    "graphRevisionSha256",
    "operationId",
    "parentGraphRevisionSha256",
    "recordRefs",
    "recordsSha256",
    "revision",
    "v"
  ]) || value.v !== 1 || !Array.isArray(value.changes) || !Array.isArray(value.recordRefs) || value.recordRefs.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot)
    return null;
  const graphRevisionSha256 = parseSha256Hex(value.graphRevisionSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const parentGraphRevisionSha256 = value.parentGraphRevisionSha256 === null ? null : parseSha256Hex(value.parentGraphRevisionSha256);
  const operationId = safeCode(value.operationId);
  const revision = Number.isSafeInteger(value.revision) && value.revision > 0 ? value.revision : null;
  let changes;
  try {
    changes = canonicalKnowledgeGraphChangesV1(value.changes);
  } catch {
    return null;
  }
  const refs = [];
  for (const item of value.recordRefs) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["dependencies", "key", "kind", "sha256", "v"]) || item.v !== 1 || !Array.isArray(item.dependencies))
      return null;
    const dependencies = item.dependencies.map(recordKey);
    const key = recordKey(item.key);
    const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === item.kind);
    const sha256 = parseSha256Hex(item.sha256);
    if (key === null || kind === undefined || sha256 === null || dependencies.some((dependency) => dependency === null) || dependencies.length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord || !orderedUnique(dependencies, String) || dependencies.includes(key))
      return null;
    refs.push({ dependencies, key, kind, sha256, v: 1 });
  }
  if (graphRevisionSha256 === null || recordsSha256 === null || operationId === null || revision === null || value.parentGraphRevisionSha256 !== null && parentGraphRevisionSha256 === null || !orderedUnique(refs, (ref) => ref.key) || canonicalSha256(refs) !== recordsSha256)
    return null;
  const keys = new Set(refs.map((ref) => ref.key));
  if (refs.some((ref) => ref.dependencies.some((dependency) => !keys.has(dependency))))
    return null;
  const payload = {
    changes,
    operationId,
    parentGraphRevisionSha256,
    recordRefs: refs,
    recordsSha256,
    revision,
    v: 1
  };
  try {
    return graphRevisionSha256V1(payload) === graphRevisionSha256 ? { ...payload, graphRevisionSha256 } : null;
  } catch {
    return null;
  }
}
function reduceKnowledgeGraphRevisionsV1(revisions) {
  if (revisions.length === 0 || revisions.length > 65536)
    return null;
  const ordered = [...revisions].sort((left, right) => left.revision - right.revision);
  let parent = null;
  const operationIds = new Set;
  for (const candidate of ordered) {
    const current = parseKnowledgeGraphRevisionV1(candidate);
    if (current === null || current.revision !== (parent?.revision ?? 0) + 1 || current.parentGraphRevisionSha256 !== (parent?.graphRevisionSha256 ?? null) || operationIds.has(current.operationId))
      return null;
    try {
      const rebuilt = createKnowledgeGraphRevisionV1({ changes: current.changes, operationId: current.operationId, parent });
      if (rebuilt.graphRevisionSha256 !== current.graphRevisionSha256)
        return null;
    } catch {
      return null;
    }
    operationIds.add(current.operationId);
    parent = current;
  }
  return parent;
}

// src/ontology.ts
var OH_ONTOLOGY_VERSION_V1 = "1.0.0";
var OH_CONTRACT_ID_V1 = "oh.ontology.v1";
var OH_KNOWLEDGE_LIMITS_V1 = Object.freeze({
  dimensions: 64,
  listValues: 256,
  qualifiers: 128,
  statementBytes: 256 * 1024,
  textBytes: 64 * 1024
});
var OH_KNOWLEDGE_KERNEL_CONCEPTS_V1 = [
  { code: "entity", description: "A stable identity anchor for something that can be referred to.", label: "Entity" },
  { code: "statement", description: "An immutable proposition with a subject, predicate, object, and qualifiers.", label: "Statement" },
  { code: "assertion", description: "An attributable stance toward a statement.", label: "Assertion" },
  { code: "evidence", description: "A typed account of how an observation bears on an assertion.", label: "Evidence" },
  { code: "context", description: "The scenario and dimensions in which knowledge applies.", label: "Context" },
  { code: "inquiry", description: "A question and its durable investigation trail.", label: "Inquiry" },
  { code: "projection", description: "A reproducible view derived from exact knowledge.", label: "Projection" }
];
function success(value) {
  return { ok: true, value };
}
function failure(field, code = "invalid-input") {
  return { error: { code, field }, ok: false };
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
var OH_KNOWLEDGE_ENTITY_STATES_V1 = ["active", "quarantined", "redirected", "tombstoned"];
function parseKnowledgeEntityV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "entityId",
    "identityOperationId",
    "identityRevision",
    "redirectEntityId",
    "state",
    "v"
  ]) || value.v !== 1)
    return failure("entity");
  const entityId = parseKnowledgeEntityId(value.entityId);
  const identityOperationId = safeCode(value.identityOperationId);
  const identityRevision = Number.isSafeInteger(value.identityRevision) && value.identityRevision > 0 ? value.identityRevision : null;
  const redirectEntityId = value.redirectEntityId === null ? null : parseKnowledgeEntityId(value.redirectEntityId);
  const state = OH_KNOWLEDGE_ENTITY_STATES_V1.find((candidate) => candidate === value.state);
  return entityId !== null && identityOperationId !== null && identityRevision !== null && (value.redirectEntityId === null || redirectEntityId !== null) && state !== undefined && state === "redirected" === (redirectEntityId !== null) && redirectEntityId !== entityId ? success({ entityId, identityOperationId, identityRevision, redirectEntityId, state, v: 1 }) : failure("entity");
}
function parseKnowledgeSchemaRefV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["code", "namespace", "revision", "schemaSha256", "v"]) || value.v !== 1)
    return failure("schemaRef");
  const code = safeCode(value.code);
  const namespace = safeCode(value.namespace);
  const revision = Number.isSafeInteger(value.revision) && value.revision > 0 ? value.revision : null;
  const schemaSha256 = parseSha256Hex(value.schemaSha256);
  return code !== null && namespace !== null && revision !== null && schemaSha256 !== null ? success({ code, namespace, revision, schemaSha256, v: 1 }) : failure("schemaRef");
}
var INTEGER = /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u;
var DECIMAL = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u;
function parseKnowledgeValueInternal(value, depth) {
  if (!isPlainRecord(value) || value.v !== 1 || depth > 8)
    return null;
  switch (value.kind) {
    case "entity": {
      if (!hasExactKeys(value, ["entityId", "kind", "v"]))
        return null;
      const entityId = parseKnowledgeEntityId(value.entityId);
      return entityId === null ? null : { entityId, kind: "entity", v: 1 };
    }
    case "text": {
      if (!hasExactKeys(value, ["kind", "language", "text", "v"]))
        return null;
      const language = typeof value.language === "string" && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value.language) ? value.language : null;
      const text = boundedText(value.text);
      return language !== null && text !== null ? { kind: "text", language, text, v: 1 } : null;
    }
    case "string": {
      const parsed = boundedText(value.value);
      return hasExactKeys(value, ["kind", "v", "value"]) && parsed !== null ? { kind: "string", v: 1, value: parsed } : null;
    }
    case "boolean":
      return hasExactKeys(value, ["kind", "v", "value"]) && typeof value.value === "boolean" ? { kind: "boolean", v: 1, value: value.value } : null;
    case "integer":
    case "decimal": {
      const valid = typeof value.value === "string" && value.value.length <= 1024 && (value.kind === "integer" ? INTEGER.test(value.value) : DECIMAL.test(value.value) && value.value !== "-0");
      return hasExactKeys(value, ["kind", "v", "value"]) && valid ? { kind: value.kind, v: 1, value: value.value } : null;
    }
    case "uri": {
      if (!hasExactKeys(value, ["kind", "uri", "v"]) || typeof value.uri !== "string" || value.uri.length > 4096)
        return null;
      try {
        const url = new URL(value.uri);
        return url.href === value.uri && url.username === "" && url.password === "" && !["data:", "file:", "javascript:"].includes(url.protocol) ? { kind: "uri", uri: value.uri, v: 1 } : null;
      } catch {
        return null;
      }
    }
    case "list":
    case "set": {
      if (!hasExactKeys(value, ["kind", "v", "values"]) || !Array.isArray(value.values) || value.values.length > OH_KNOWLEDGE_LIMITS_V1.listValues)
        return null;
      const values = [];
      for (const item of value.values) {
        const parsed = parseKnowledgeValueInternal(item, depth + 1);
        if (parsed === null)
          return null;
        values.push(parsed);
      }
      if (value.kind === "set" && !orderedUnique(values, canonicalJson))
        return null;
      return { kind: value.kind, v: 1, values };
    }
    case "extension": {
      if (!hasExactKeys(value, ["canonicalizerSha256", "canonicalValue", "kind", "mediaType", "schema", "v", "valueSha256"]))
        return null;
      const canonicalizerSha256 = parseSha256Hex(value.canonicalizerSha256);
      const canonicalValue = boundedText(value.canonicalValue, 64 * 1024);
      const mediaType = typeof value.mediaType === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(value.mediaType) ? value.mediaType : null;
      const schema = parseKnowledgeSchemaRefV1(value.schema);
      const valueSha256 = parseSha256Hex(value.valueSha256);
      return canonicalizerSha256 !== null && canonicalValue !== null && mediaType !== null && schema.ok && valueSha256 !== null ? { canonicalizerSha256, canonicalValue, kind: "extension", mediaType, schema: schema.value, v: 1, valueSha256 } : null;
    }
    default:
      return null;
  }
}
function parseKnowledgeValueV1(value) {
  const parsed = parseKnowledgeValueInternal(value, 0);
  return parsed === null ? failure("value") : success(parsed);
}
function verifyKnowledgeValueV1(value) {
  const parsed = parseKnowledgeValueV1(value);
  if (!parsed.ok)
    return parsed;
  if (parsed.value.kind === "extension" && sha256Hex(parsed.value.canonicalValue) !== parsed.value.valueSha256) {
    return failure("valueSha256", "digest-mismatch");
  }
  if (parsed.value.kind === "list" || parsed.value.kind === "set") {
    for (const child of parsed.value.values) {
      const verified = verifyKnowledgeValueV1(child);
      if (!verified.ok)
        return verified;
    }
  }
  return success(parsed.value);
}
function parseDimension(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["predicate", "v", "value"]) || value.v !== 1)
    return null;
  const predicate = parseKnowledgeSchemaRefV1(value.predicate);
  const parsedValue = parseKnowledgeValueV1(value.value);
  return predicate.ok && parsedValue.ok ? { predicate: predicate.value, v: 1, value: parsedValue.value } : null;
}
function createKnowledgeContextV1(input) {
  if (!isPlainRecord(input) || input.v !== 1 || !Array.isArray(input.dimensions) || input.dimensions.length > OH_KNOWLEDGE_LIMITS_V1.dimensions || !["actual", "counterfactual", "hypothetical", "planned"].includes(input.scenario))
    return failure("context");
  const dimensions = [];
  for (const item of input.dimensions) {
    const parsed = parseDimension(item);
    if (parsed === null)
      return failure("dimensions");
    const verified = verifyKnowledgeValueV1(parsed.value);
    if (!verified.ok)
      return verified;
    dimensions.push(parsed);
  }
  let canonicalDimensions;
  try {
    canonicalDimensions = sortUnique(dimensions, canonicalJson);
  } catch {
    return failure("dimensions", "noncanonical-input");
  }
  const payload = { dimensions: canonicalDimensions, scenario: input.scenario, v: 1 };
  return success({ ...payload, contextSha256: canonicalSha256(payload) });
}
function parseKnowledgeContextV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["contextSha256", "dimensions", "scenario", "v"]))
    return failure("context");
  const digest = parseSha256Hex(value.contextSha256);
  if (digest === null)
    return failure("contextSha256");
  const created = createKnowledgeContextV1({ dimensions: value.dimensions, scenario: value.scenario, v: value.v });
  return created.ok && created.value.contextSha256 === digest && canonicalJson(created.value.dimensions) === canonicalJson(value.dimensions) ? success({ ...created.value, contextSha256: digest }) : failure("contextSha256", "digest-mismatch");
}
function createKnowledgeStatementV1(input) {
  const object = parseKnowledgeValueV1(input.object);
  const predicate = parseKnowledgeSchemaRefV1(input.predicate);
  const subject = parseKnowledgeEntityId(input.subject);
  if (input.v !== 1 || !object.ok || !predicate.ok || subject === null || !Array.isArray(input.qualifiers) || input.qualifiers.length > OH_KNOWLEDGE_LIMITS_V1.qualifiers)
    return failure("statement");
  const verifiedObject = verifyKnowledgeValueV1(object.value);
  if (!verifiedObject.ok)
    return verifiedObject;
  const qualifiers = [];
  for (const item of input.qualifiers) {
    const parsed = parseDimension(item);
    if (parsed === null)
      return failure("qualifiers");
    const verified = verifyKnowledgeValueV1(parsed.value);
    if (!verified.ok)
      return verified;
    qualifiers.push(parsed);
  }
  let canonicalQualifiers;
  try {
    canonicalQualifiers = sortUnique(qualifiers, canonicalJson);
  } catch {
    return failure("qualifiers", "noncanonical-input");
  }
  const payload = { object: object.value, predicate: predicate.value, qualifiers: canonicalQualifiers, subject, v: 1 };
  if (Buffer.byteLength(canonicalJson(payload), "utf8") > OH_KNOWLEDGE_LIMITS_V1.statementBytes)
    return failure("statement", "limit-exceeded");
  return success({ ...payload, statementSha256: canonicalSha256(payload) });
}
function parseKnowledgeStatementV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["object", "predicate", "qualifiers", "statementSha256", "subject", "v"]))
    return failure("statement");
  const digest = parseSha256Hex(value.statementSha256);
  const created = createKnowledgeStatementV1(value);
  return digest !== null && created.ok && created.value.statementSha256 === digest && canonicalJson(created.value.qualifiers) === canonicalJson(value.qualifiers) ? success({ ...created.value, statementSha256: digest }) : failure("statementSha256", "digest-mismatch");
}
function parseKnowledgeAgentRefV1(value) {
  if (!isPlainRecord(value) || value.v !== 1)
    return null;
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
    return authority.ok && receiptSha256 !== null ? { authority: authority.value, kind: "system", receiptSha256, v: 1 } : null;
  }
  return null;
}
function parseDigestArray(value, maximum = 2048) {
  if (!Array.isArray(value) || value.length > maximum)
    return null;
  const digests = value.map(parseSha256Hex);
  return digests.every((digest) => digest !== null) && orderedUnique(digests, String) ? digests : null;
}
var OH_KNOWLEDGE_ACTIVITY_KINDS_V1 = [
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
  ]) || value.v !== 1)
    return null;
  const actor = parseKnowledgeAgentRefV1(value.actor);
  const inputSha256s = parseDigestArray(value.inputSha256s);
  const kind = OH_KNOWLEDGE_ACTIVITY_KINDS_V1.find((candidate) => candidate === value.kind);
  const occurredAt = parseCanonicalInstantV1(value.occurredAt);
  const outputSha256s = parseDigestArray(value.outputSha256s);
  const policySha256 = parseSha256Hex(value.policySha256);
  const tool = value.tool === null ? null : parseKnowledgeSchemaRefV1(value.tool);
  const parsedTool = tool === null ? null : tool.ok ? tool.value : null;
  return actor !== null && inputSha256s !== null && kind !== undefined && occurredAt !== null && outputSha256s !== null && policySha256 !== null && (value.tool === null || parsedTool !== null) ? { actor, inputSha256s, kind, occurredAt, outputSha256s, policySha256, tool: parsedTool, v: 1 } : null;
}
function createKnowledgeActivityV1(input) {
  const parsed = parseActivityInput(input);
  return parsed === null ? failure("activity") : success({ ...parsed, activitySha256: canonicalSha256(parsed) });
}
function parseKnowledgeActivityV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "activitySha256"))
    return failure("activity");
  const activitySha256 = parseSha256Hex(value.activitySha256);
  const { activitySha256: _digest, ...input } = value;
  const parsed = parseActivityInput(input);
  return activitySha256 !== null && parsed !== null && canonicalSha256(parsed) === activitySha256 ? success({ ...parsed, activitySha256 }) : failure("activitySha256", "digest-mismatch");
}
var OH_KNOWLEDGE_ASSERTION_STANCES_V1 = ["questions", "refutes", "reports", "supports", "undetermined"];
var OH_KNOWLEDGE_ASSERTION_STATES_V1 = [
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
  const codes = value.map((item) => safeCode(item));
  return codes.every((code) => code !== null) && orderedUnique(codes, String) ? codes : null;
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
  ]) || value.v !== 1)
    return null;
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
  if (acceptedPurposes === null || assertionId === null || assertor === null || value.confidence !== null && parsedConfidence === null || value.contextSha256 !== null && contextSha256 === null || provenanceActivitySha256 === null || value.reviewActivitySha256 !== null && reviewActivitySha256 === null || stance === undefined || state === undefined || statementSha256 === null)
    return null;
  if (assertor.kind === "model" && (state !== "proposed" || acceptedPurposes.length !== 0 || reviewActivitySha256 !== null))
    return null;
  if (state === "accepted-for-purpose" !== acceptedPurposes.length > 0 || state !== "proposed" && reviewActivitySha256 === null)
    return null;
  return {
    acceptedPurposes,
    assertionId,
    assertor,
    confidence: parsedConfidence,
    contextSha256,
    provenanceActivitySha256,
    reviewActivitySha256,
    stance,
    state,
    statementSha256,
    v: 1
  };
}
function createKnowledgeAssertionV1(input) {
  const parsed = parseAssertionInput(input);
  return parsed === null ? failure("assertion") : success({ ...parsed, assertionSha256: canonicalSha256(parsed) });
}
function parseKnowledgeAssertionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "assertionSha256"))
    return failure("assertion");
  const assertionSha256 = parseSha256Hex(value.assertionSha256);
  const { assertionSha256: _digest, ...input } = value;
  const parsed = parseAssertionInput(input);
  return assertionSha256 !== null && parsed !== null && canonicalSha256(parsed) === assertionSha256 ? success({ ...parsed, assertionSha256 }) : failure("assertionSha256", "digest-mismatch");
}
var OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1 = [
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
  ]) || value.v !== 1)
    return null;
  const assertionSha256 = parseSha256Hex(value.assertionSha256);
  const bearing = OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1.find((candidate) => candidate === value.bearing);
  const evidenceId = parseKnowledgeEvidenceId(value.evidenceId);
  const observationSha256 = value.observationSha256 === null ? null : parseSha256Hex(value.observationSha256);
  const provenanceActivitySha256 = parseSha256Hex(value.provenanceActivitySha256);
  const selector = value.selector === null ? null : boundedText(value.selector, 8192);
  const sourceEntityId = value.sourceEntityId === null ? null : parseKnowledgeEntityId(value.sourceEntityId);
  return assertionSha256 !== null && bearing !== undefined && (value.disclosure === "private" || value.disclosure === "public" || value.disclosure === "shared") && evidenceId !== null && (value.observationSha256 === null || observationSha256 !== null) && provenanceActivitySha256 !== null && (value.selector === null || selector !== null) && (value.sourceEntityId === null || sourceEntityId !== null) && (observationSha256 !== null || sourceEntityId !== null) ? {
    assertionSha256,
    bearing,
    disclosure: value.disclosure,
    evidenceId,
    observationSha256,
    provenanceActivitySha256,
    selector,
    sourceEntityId,
    v: 1
  } : null;
}
function createKnowledgeEvidenceLinkV1(input) {
  const parsed = parseEvidenceInput(input);
  return parsed === null ? failure("evidence") : success({ ...parsed, evidenceSha256: canonicalSha256(parsed) });
}
function parseKnowledgeEvidenceLinkV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "evidenceSha256"))
    return failure("evidence");
  const evidenceSha256 = parseSha256Hex(value.evidenceSha256);
  const { evidenceSha256: _digest, ...input } = value;
  const parsed = parseEvidenceInput(input);
  return evidenceSha256 !== null && parsed !== null && canonicalSha256(parsed) === evidenceSha256 ? success({ ...parsed, evidenceSha256 }) : failure("evidenceSha256", "digest-mismatch");
}
function createKnowledgeInquiryV1(input) {
  const answerForm = safeCode(input.answerForm);
  const authorEntityId = parseKnowledgeEntityId(input.authorEntityId);
  const contextSha256 = input.contextSha256 === null ? null : parseSha256Hex(input.contextSha256);
  const createdAt = parseCanonicalInstantV1(input.createdAt);
  const inquiryId = parseKnowledgeInquiryId(input.inquiryId);
  const language = typeof input.language === "string" && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(input.language) ? input.language : null;
  const parents = Array.isArray(input.parentInquiryIds) ? input.parentInquiryIds.map(parseKnowledgeInquiryId) : null;
  const question = boundedText(input.question, 16384);
  if (input.v !== 1 || answerForm === null || authorEntityId === null || input.contextSha256 !== null && contextSha256 === null || createdAt === null || inquiryId === null || language === null || parents === null || parents.some((item) => item === null) || !orderedUnique(parents, String) || !["private", "public", "shared"].includes(input.privacy) || question === null || !["abandoned", "open", "paused", "resolved"].includes(input.status))
    return failure("inquiry");
  const payload = {
    answerForm,
    authorEntityId,
    contextSha256,
    createdAt,
    inquiryId,
    language,
    parentInquiryIds: parents,
    privacy: input.privacy,
    question,
    status: input.status,
    v: 1
  };
  return success({ ...payload, inquirySha256: canonicalSha256(payload) });
}
function parseKnowledgeInquiryV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "inquirySha256"))
    return failure("inquiry");
  const digest = parseSha256Hex(value.inquirySha256);
  const { inquirySha256: _digest, ...input } = value;
  const created = createKnowledgeInquiryV1(input);
  return digest !== null && created.ok && created.value.inquirySha256 === digest ? success({ ...created.value, inquirySha256: digest }) : failure("inquirySha256", "digest-mismatch");
}

// src/schema.ts
var OH_SCHEMA_FORMAT_VERSION_V1 = 1;
var OH_SCHEMA_KINDS_V1 = ["concept", "mapping", "predicate", "shape", "unit", "vocabulary"];
function parseLocalizedTexts(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128)
    return null;
  const output = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["language", "text", "v"]) || item.v !== 1)
      return null;
    const language = typeof item.language === "string" && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(item.language) ? item.language : null;
    const text = boundedText(item.text, 16384);
    if (language === null || text === null)
      return null;
    output.push({ language, text, v: 1 });
  }
  return orderedUnique(output, canonicalJson) ? output : null;
}
function parseSchemaInput(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "body",
    "code",
    "compatibility",
    "description",
    "kind",
    "labels",
    "namespace",
    "previousSchemaSha256",
    "revision",
    "v"
  ]) || value.v !== 1 || !isPlainRecord(value.body))
    return null;
  try {
    canonicalJson(value.body);
  } catch {
    return null;
  }
  const code = safeCode(value.code);
  const namespace = safeCode(value.namespace);
  const kind = OH_SCHEMA_KINDS_V1.find((candidate) => candidate === value.kind);
  const labels = parseLocalizedTexts(value.labels);
  const description = parseLocalizedTexts(value.description);
  const previousSchemaSha256 = value.previousSchemaSha256 === null ? null : parseSha256Hex(value.previousSchemaSha256);
  const revision = Number.isSafeInteger(value.revision) && value.revision > 0 ? value.revision : null;
  const compatibility = value.compatibility === "additive" || value.compatibility === "breaking" ? value.compatibility : null;
  return code !== null && namespace !== null && kind !== undefined && labels !== null && description !== null && (value.previousSchemaSha256 === null || previousSchemaSha256 !== null) && revision !== null && compatibility !== null && revision === 1 === (previousSchemaSha256 === null) && (revision !== 1 || compatibility === "additive") ? {
    body: value.body,
    code,
    compatibility,
    description,
    kind,
    labels,
    namespace,
    previousSchemaSha256,
    revision,
    v: 1
  } : null;
}
function createKnowledgeSchemaRevisionV1(input) {
  const parsed = parseSchemaInput(input);
  if (parsed === null)
    throw new TypeError("Invalid schema revision input.");
  return { ...parsed, schemaSha256: canonicalSha256(parsed) };
}
function parseKnowledgeSchemaRevisionV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "schemaSha256"))
    return null;
  const schemaSha256 = parseSha256Hex(value.schemaSha256);
  const { schemaSha256: _digest, ...input } = value;
  const parsed = parseSchemaInput(input);
  return schemaSha256 !== null && parsed !== null && canonicalSha256(parsed) === schemaSha256 ? { ...parsed, schemaSha256 } : null;
}
function knowledgeSchemaRefV1(schema) {
  return {
    code: schema.code,
    namespace: schema.namespace,
    revision: schema.revision,
    schemaSha256: schema.schemaSha256,
    v: 1
  };
}
function additiveBodyRetainsPrior(prior, next) {
  return Object.entries(prior).every(([key, value]) => Object.hasOwn(next, key) && canonicalJson(next[key]) === canonicalJson(value));
}
function verifyKnowledgeSchemaEvolutionV1(prior, next) {
  if (parseKnowledgeSchemaRevisionV1(prior) === null || parseKnowledgeSchemaRevisionV1(next) === null) {
    return { ok: false, reason: "invalid-schema" };
  }
  if (prior.namespace !== next.namespace || prior.code !== next.code || prior.kind !== next.kind) {
    return { ok: false, reason: "identity-changed" };
  }
  if (next.revision !== prior.revision + 1 || next.previousSchemaSha256 !== prior.schemaSha256) {
    return { ok: false, reason: "chain-broken" };
  }
  if (next.compatibility === "additive" && !additiveBodyRetainsPrior(prior.body, next.body)) {
    return { ok: false, reason: "false-additive-claim" };
  }
  return { ok: true };
}
function createKnowledgeVocabularyRevisionV1(input) {
  const namespace = safeCode(input.namespace);
  if (namespace === null || input.v !== 1 || !Number.isSafeInteger(input.revision) || input.revision < 1 || !Array.isArray(input.schemaRefs) || input.schemaRefs.length > 65536) {
    throw new TypeError("Invalid vocabulary revision input.");
  }
  const refs = [];
  for (const candidate of input.schemaRefs) {
    const parsed = parseKnowledgeSchemaRefV1(candidate);
    if (!parsed.ok || parsed.value.namespace !== namespace)
      throw new TypeError("Invalid vocabulary schema reference.");
    refs.push(parsed.value);
  }
  if (!orderedUnique(refs, canonicalJson))
    throw new TypeError("Vocabulary schema references must be ordered and unique.");
  const payload = { namespace, revision: input.revision, schemaRefs: refs, v: 1 };
  return { ...payload, vocabularySha256: canonicalSha256(payload) };
}
function parseKnowledgeVocabularyRevisionV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["namespace", "revision", "schemaRefs", "v", "vocabularySha256"]))
    return null;
  const digest = parseSha256Hex(value.vocabularySha256);
  try {
    const created = createKnowledgeVocabularyRevisionV1({
      namespace: value.namespace,
      revision: value.revision,
      schemaRefs: value.schemaRefs,
      v: value.v
    });
    return digest !== null && created.vocabularySha256 === digest ? { ...created, vocabularySha256: digest } : null;
  } catch {
    return null;
  }
}

// src/contract.ts
var manifestPayload = Object.freeze({
  contractId: OH_CONTRACT_ID_V1,
  graphFormatVersion: OH_GRAPH_FORMAT_VERSION_V1,
  ontologyVersion: OH_ONTOLOGY_VERSION_V1,
  recordKinds: OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  schemaFormatVersion: OH_SCHEMA_FORMAT_VERSION_V1,
  v: 1
});
var OH_CONTRACT_MANIFEST_V1 = Object.freeze({
  ...manifestPayload,
  contractSha256: canonicalSha256(manifestPayload)
});
function parseOhContractManifestV1(value) {
  try {
    return canonicalJson(value) === canonicalJson(OH_CONTRACT_MANIFEST_V1) ? OH_CONTRACT_MANIFEST_V1 : null;
  } catch {
    return null;
  }
}

class OhRecordCodecRegistry {
  #codecs = new Map;
  register(codec) {
    if (this.#codecs.has(codec.kind))
      throw new TypeError(`A codec is already registered for ${codec.kind}.`);
    this.#codecs.set(codec.kind, codec);
    return this;
  }
  parse(kind, value) {
    const codec = this.#codecs.get(kind);
    if (codec !== undefined)
      return codec.parse(value);
    try {
      canonicalJson(value);
      return value;
    } catch {
      return null;
    }
  }
  has(kind) {
    return this.#codecs.has(kind);
  }
}

// src/projection.ts
var OH_PROJECTION_FORMAT_VERSION_V1 = 1;
var OH_PROJECTION_SEMANTICS_V1 = "oh.projection.positive-datalog.v1";
var OH_PROJECTION_INTERNAL_ENGINE_V1 = "oh.naive.positive.v1";
var OH_PROJECTION_LIMITS_V1 = Object.freeze({
  arity: 32,
  atomBytes: 16 * 1024,
  derivedTuples: 262144,
  facts: 262144,
  literalsPerRule: 64,
  proofDepth: 128,
  proofNodes: 4096,
  queryLiterals: 64,
  queryMatches: 262144,
  queryResults: 65536,
  relations: 4096,
  rounds: 1024,
  rules: 1024,
  sourcesPerFact: 64,
  variables: 256
});
var recordFactExtractorPayloadV1 = {
  factPackId: "oh.record-facts",
  factPackRevision: 1,
  relations: ["oh.dependency", "oh.record"],
  semantics: OH_PROJECTION_SEMANTICS_V1,
  v: 1
};
var OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1 = Object.freeze({
  ...recordFactExtractorPayloadV1,
  extractorSha256: canonicalSha256(recordFactExtractorPayloadV1)
});
function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function positiveInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : null;
}
function projectionName(value, maximumLength = 128) {
  return safeCode(value, maximumLength);
}
function compareCanonical(left, right) {
  const leftKey = canonicalJson(left);
  const rightKey = canonicalJson(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
function compareProjectionFacts(left, right) {
  return compareCanonical([left.relation, left.tuple], [right.relation, right.tuple]);
}
var INVALID_PROJECTION_ATOM = Symbol("invalid-projection-atom");
function atom(value) {
  if (value !== null && typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") {
    return INVALID_PROJECTION_ATOM;
  }
  try {
    const encoded = canonicalJson(value);
    return utf8ByteLength(encoded) <= OH_PROJECTION_LIMITS_V1.atomBytes ? value : INVALID_PROJECTION_ATOM;
  } catch {
    return INVALID_PROJECTION_ATOM;
  }
}
function tuple(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > OH_PROJECTION_LIMITS_V1.arity)
    return null;
  const parsed = value.map(atom);
  return parsed.some((item) => item === INVALID_PROJECTION_ATOM) ? null : parsed;
}
function parseRecordRef(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["dependencies", "key", "kind", "sha256", "v"]) || value.v !== 1 || !Array.isArray(value.dependencies))
    return null;
  const key = safeCode(value.key, 512);
  const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === value.kind);
  const sha256 = parseSha256Hex(value.sha256);
  const dependencies = value.dependencies.map((dependency) => safeCode(dependency, 512));
  if (key === null || kind === undefined || sha256 === null || dependencies.length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord || dependencies.some((dependency) => dependency === null) || !orderedUnique(dependencies, String) || dependencies.includes(key))
    return null;
  return { dependencies, key, kind, sha256, v: 1 };
}
function createOhProjectionSnapshotV1(input) {
  const spaceId = projectionName(input.spaceId);
  const generation = nonnegativeInteger(input.head.generation);
  const sequence = nonnegativeInteger(input.head.sequence);
  const operationSha256 = input.head.operationSha256 === null ? null : parseSha256Hex(input.head.operationSha256);
  const graphRevisionSha256 = input.head.graphRevisionSha256 === null ? null : parseSha256Hex(input.head.graphRevisionSha256);
  const declaredRecordsSha256 = parseSha256Hex(input.head.recordsSha256);
  if (spaceId === null || generation === null || sequence === null || generation !== sequence || input.head.operationSha256 !== null && operationSha256 === null || input.head.graphRevisionSha256 !== null && graphRevisionSha256 === null || sequence === 0 !== (operationSha256 === null) || sequence === 0 !== (graphRevisionSha256 === null) || declaredRecordsSha256 === null || input.records.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    throw new TypeError("Invalid projection snapshot head.");
  }
  const records = input.records.map(parseKnowledgeGraphRecordV1);
  if (records.some((record) => record === null))
    throw new TypeError("Invalid record in projection snapshot.");
  const recordRefs = sortUnique(records.map(knowledgeGraphRecordRefV1), (reference) => reference.key);
  const recordsSha256 = canonicalSha256(recordRefs);
  if (recordsSha256 !== declaredRecordsSha256) {
    throw new TypeError("Projection snapshot records do not reproduce the declared head.");
  }
  const keys = new Set(recordRefs.map((reference) => reference.key));
  if (recordRefs.some((reference) => reference.dependencies.some((dependency) => !keys.has(dependency)))) {
    throw new TypeError("Projection snapshot has a missing record dependency.");
  }
  const payload = {
    contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    generation,
    graphRevisionSha256,
    operationSha256,
    recordRefs,
    recordsSha256,
    sequence,
    spaceId,
    v: 1
  };
  return { ...payload, snapshotSha256: canonicalSha256(payload) };
}
function parseOhProjectionSnapshotV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "contractSha256",
    "generation",
    "graphRevisionSha256",
    "operationSha256",
    "recordRefs",
    "recordsSha256",
    "sequence",
    "snapshotSha256",
    "spaceId",
    "v"
  ]) || value.v !== 1 || !Array.isArray(value.recordRefs) || value.recordRefs.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot)
    return null;
  const contractSha256 = parseSha256Hex(value.contractSha256);
  const generation = nonnegativeInteger(value.generation);
  const sequence = nonnegativeInteger(value.sequence);
  const graphRevisionSha256 = value.graphRevisionSha256 === null ? null : parseSha256Hex(value.graphRevisionSha256);
  const operationSha256 = value.operationSha256 === null ? null : parseSha256Hex(value.operationSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const snapshotSha256 = parseSha256Hex(value.snapshotSha256);
  const spaceId = projectionName(value.spaceId);
  const recordRefs = value.recordRefs.map(parseRecordRef);
  if (contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256 || generation === null || sequence === null || generation !== sequence || spaceId === null || recordsSha256 === null || snapshotSha256 === null || value.graphRevisionSha256 !== null && graphRevisionSha256 === null || value.operationSha256 !== null && operationSha256 === null || sequence === 0 !== (operationSha256 === null) || sequence === 0 !== (graphRevisionSha256 === null) || recordRefs.some((reference) => reference === null))
    return null;
  const refs = recordRefs;
  if (!orderedUnique(refs, (reference) => reference.key) || canonicalSha256(refs) !== recordsSha256)
    return null;
  const keys = new Set(refs.map((reference) => reference.key));
  if (refs.some((reference) => reference.dependencies.some((dependency) => !keys.has(dependency))))
    return null;
  const payload = {
    contractSha256,
    generation,
    graphRevisionSha256,
    operationSha256,
    recordRefs: refs,
    recordsSha256,
    sequence,
    spaceId,
    v: 1
  };
  return canonicalSha256(payload) === snapshotSha256 ? { ...payload, snapshotSha256 } : null;
}
function createOhProjectionFactV1(input) {
  const relation = projectionName(input.relation);
  const parsedTuple = tuple(input.tuple);
  if (relation === null || parsedTuple === null || input.sources.length < 1 || input.sources.length > OH_PROJECTION_LIMITS_V1.sourcesPerFact) {
    throw new TypeError("Invalid projection fact.");
  }
  const sources = input.sources.map((source) => {
    if (!isPlainRecord(source) || !hasExactKeys(source, ["key", "recordSha256", "v"]) || source.v !== 1) {
      throw new TypeError("Invalid projection fact source.");
    }
    const key = safeCode(source.key, 512);
    const recordSha256 = parseSha256Hex(source.recordSha256);
    if (key === null || recordSha256 === null)
      throw new TypeError("Invalid projection fact source.");
    return { key, recordSha256, v: 1 };
  }).sort(compareCanonical);
  if (!orderedUnique(sources, (source) => source.key)) {
    throw new TypeError("Projection fact sources must have unique record keys.");
  }
  const payload = { relation, sources, tuple: parsedTuple, v: 1 };
  return { ...payload, factSha256: canonicalSha256(payload) };
}
function parseOhProjectionFactV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["factSha256", "relation", "sources", "tuple", "v"]) || value.v !== 1 || !Array.isArray(value.sources) || !Array.isArray(value.tuple))
    return null;
  const factSha256 = parseSha256Hex(value.factSha256);
  try {
    const fact = createOhProjectionFactV1({
      relation: value.relation,
      sources: value.sources,
      tuple: value.tuple
    });
    return factSha256 !== null && fact.factSha256 === factSha256 ? fact : null;
  } catch {
    return null;
  }
}
function mergeProjectionFacts(facts) {
  const grouped = new Map;
  for (const fact of facts) {
    const identity = canonicalJson([fact.relation, fact.tuple]);
    let group = grouped.get(identity);
    if (group === undefined) {
      group = { relation: fact.relation, sources: new Map, tuple: fact.tuple };
      grouped.set(identity, group);
    }
    for (const source of fact.sources) {
      const existing = group.sources.get(source.key);
      if (existing !== undefined && existing.recordSha256 !== source.recordSha256) {
        throw new TypeError("One fact source key is bound to multiple record digests.");
      }
      group.sources.set(source.key, source);
    }
  }
  return [...grouped.values()].map((group) => createOhProjectionFactV1({
    relation: group.relation,
    sources: [...group.sources.values()],
    tuple: group.tuple
  })).sort(compareProjectionFacts);
}
function createOhProjectionDatasetV1(input) {
  const snapshot = parseOhProjectionSnapshotV1(input.snapshot);
  const extractorSha256 = parseSha256Hex(input.extractorSha256);
  const factPackId = projectionName(input.factPackId);
  const factPackRevision = positiveInteger(input.factPackRevision);
  if (snapshot === null || extractorSha256 === null || factPackId === null || factPackRevision === null || input.facts.length > OH_PROJECTION_LIMITS_V1.facts)
    throw new TypeError("Invalid projection dataset.");
  const parsedFacts = input.facts.map(parseOhProjectionFactV1);
  if (parsedFacts.some((fact) => fact === null))
    throw new TypeError("Invalid fact in projection dataset.");
  const facts = mergeProjectionFacts(parsedFacts);
  if (facts.length > OH_PROJECTION_LIMITS_V1.facts)
    throw new RangeError("Projection dataset has too many facts.");
  const refs = new Map(snapshot.recordRefs.map((reference) => [reference.key, reference.sha256]));
  for (const fact of facts) {
    for (const source of fact.sources) {
      if (refs.get(source.key) !== source.recordSha256) {
        throw new TypeError("Projection fact source is not present at the exact input snapshot.");
      }
    }
  }
  const factPackPayload = {
    extractorSha256,
    factPackId,
    factPackRevision,
    semantics: OH_PROJECTION_SEMANTICS_V1,
    v: 1
  };
  const factPackSha256 = canonicalSha256(factPackPayload);
  const factsSha256 = canonicalSha256(facts);
  const payload = {
    extractorSha256,
    factPackId,
    factPackRevision,
    factPackSha256,
    facts,
    factsSha256,
    snapshotSha256: snapshot.snapshotSha256,
    v: 1
  };
  return { ...payload, datasetSha256: canonicalSha256(payload) };
}
function parseOhProjectionDatasetV1(value, snapshot) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "datasetSha256",
    "extractorSha256",
    "factPackId",
    "factPackRevision",
    "factPackSha256",
    "facts",
    "factsSha256",
    "snapshotSha256",
    "v"
  ]) || value.v !== 1 || !Array.isArray(value.facts))
    return null;
  const datasetSha256 = parseSha256Hex(value.datasetSha256);
  const declaredFactPackSha256 = parseSha256Hex(value.factPackSha256);
  const declaredFactsSha256 = parseSha256Hex(value.factsSha256);
  try {
    const dataset = createOhProjectionDatasetV1({
      extractorSha256: value.extractorSha256,
      factPackId: value.factPackId,
      factPackRevision: value.factPackRevision,
      facts: value.facts,
      snapshot
    });
    return datasetSha256 !== null && declaredFactPackSha256 === dataset.factPackSha256 && declaredFactsSha256 === dataset.factsSha256 && value.snapshotSha256 === dataset.snapshotSha256 && dataset.datasetSha256 === datasetSha256 ? dataset : null;
  } catch {
    return null;
  }
}
function ohProjectionVariableV1(name) {
  const parsed = projectionName(name);
  if (parsed === null)
    throw new TypeError("Invalid projection variable name.");
  return { kind: "variable", name: parsed, v: 1 };
}
function ohProjectionConstantV1(value) {
  const parsed = atom(value);
  if (parsed === INVALID_PROJECTION_ATOM)
    throw new TypeError("Invalid projection constant.");
  return { kind: "constant", v: 1, value: parsed };
}
function createOhProjectionLiteralV1(input) {
  const relation = projectionName(input.relation);
  if (relation === null || input.terms.length < 1 || input.terms.length > OH_PROJECTION_LIMITS_V1.arity) {
    throw new TypeError("Invalid projection literal.");
  }
  const terms = input.terms.map((term) => parseOhProjectionTermV1(term));
  if (terms.some((term) => term === null))
    throw new TypeError("Invalid term in projection literal.");
  return { relation, terms, v: 1 };
}
function parseOhProjectionTermV1(value) {
  if (!isPlainRecord(value) || value.v !== 1)
    return null;
  if (value.kind === "variable" && hasExactKeys(value, ["kind", "name", "v"])) {
    const name = projectionName(value.name);
    return name === null ? null : { kind: "variable", name, v: 1 };
  }
  if (value.kind === "constant" && hasExactKeys(value, ["kind", "v", "value"])) {
    const parsed = atom(value.value);
    return parsed === INVALID_PROJECTION_ATOM ? null : { kind: "constant", v: 1, value: parsed };
  }
  return null;
}
function parseOhProjectionLiteralV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["relation", "terms", "v"]) || value.v !== 1 || !Array.isArray(value.terms))
    return null;
  try {
    return createOhProjectionLiteralV1({
      relation: value.relation,
      terms: value.terms
    });
  } catch {
    return null;
  }
}
function literalVariables(literal) {
  return literal.terms.flatMap((term) => term.kind === "variable" ? [term.name] : []);
}
function createOhProjectionRuleV1(input) {
  const ruleId = projectionName(input.ruleId);
  const head = parseOhProjectionLiteralV1(input.head);
  if (ruleId === null || head === null || input.body.length < 1 || input.body.length > OH_PROJECTION_LIMITS_V1.literalsPerRule)
    throw new TypeError("Invalid projection rule.");
  const body = input.body.map(parseOhProjectionLiteralV1);
  if (body.some((literal) => literal === null))
    throw new TypeError("Invalid body literal in projection rule.");
  const bound = new Set(body.flatMap(literalVariables));
  if (literalVariables(head).some((variable) => !bound.has(variable)) || bound.size > OH_PROJECTION_LIMITS_V1.variables) {
    throw new TypeError("Every projection rule head variable must be bound in its body.");
  }
  const payload = { body, head, ruleId, v: 1 };
  return { ...payload, ruleSha256: canonicalSha256(payload) };
}
function parseOhProjectionRuleV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["body", "head", "ruleId", "ruleSha256", "v"]) || value.v !== 1 || !Array.isArray(value.body))
    return null;
  const ruleSha256 = parseSha256Hex(value.ruleSha256);
  try {
    const rule = createOhProjectionRuleV1({
      body: value.body,
      head: value.head,
      ruleId: value.ruleId
    });
    return ruleSha256 !== null && rule.ruleSha256 === ruleSha256 ? rule : null;
  } catch {
    return null;
  }
}
function createOhProjectionRulePackV1(input) {
  const rulePackId = projectionName(input.rulePackId);
  const rulePackRevision = positiveInteger(input.rulePackRevision);
  if (rulePackId === null || rulePackRevision === null || input.rules.length < 1 || input.rules.length > OH_PROJECTION_LIMITS_V1.rules)
    throw new TypeError("Invalid projection rule pack.");
  const parsedRules = input.rules.map(parseOhProjectionRuleV1);
  if (parsedRules.some((rule) => rule === null))
    throw new TypeError("Invalid rule in projection rule pack.");
  const rules = sortUnique(parsedRules, (rule) => rule.ruleId);
  const rulesSha256 = canonicalSha256(rules);
  const payload = {
    rulePackId,
    rulePackRevision,
    rules,
    rulesSha256,
    semantics: OH_PROJECTION_SEMANTICS_V1,
    v: 1
  };
  return { ...payload, rulePackSha256: canonicalSha256(payload) };
}
function parseOhProjectionRulePackV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "rulePackId",
    "rulePackRevision",
    "rulePackSha256",
    "rules",
    "rulesSha256",
    "semantics",
    "v"
  ]) || value.v !== 1 || value.semantics !== OH_PROJECTION_SEMANTICS_V1 || !Array.isArray(value.rules))
    return null;
  const rulePackSha256 = parseSha256Hex(value.rulePackSha256);
  const rulesSha256 = parseSha256Hex(value.rulesSha256);
  try {
    const pack = createOhProjectionRulePackV1({
      rulePackId: value.rulePackId,
      rulePackRevision: value.rulePackRevision,
      rules: value.rules
    });
    return rulePackSha256 === pack.rulePackSha256 && rulesSha256 === pack.rulesSha256 ? pack : null;
  } catch {
    return null;
  }
}
function createOhProjectionQueryV1(input) {
  const queryId = projectionName(input.queryId);
  const limit = positiveInteger(input.limit ?? 1000, OH_PROJECTION_LIMITS_V1.queryResults);
  if (queryId === null || limit === null || input.find.length < 1 || input.find.length > OH_PROJECTION_LIMITS_V1.arity || input.where.length < 1 || input.where.length > OH_PROJECTION_LIMITS_V1.queryLiterals)
    throw new TypeError("Invalid projection query.");
  const find = input.find.map((name) => projectionName(name));
  const where = input.where.map(parseOhProjectionLiteralV1);
  if (find.some((name) => name === null) || !orderedUnique([...find].sort(), String) || where.some((literal) => literal === null))
    throw new TypeError("Invalid projection query variables or literals.");
  const bound = new Set(where.flatMap(literalVariables));
  if (find.some((name) => !bound.has(name)) || bound.size > OH_PROJECTION_LIMITS_V1.variables) {
    throw new TypeError("Every projected query variable must be bound in the query body.");
  }
  const payload = {
    find,
    limit,
    queryId,
    where,
    v: 1
  };
  return { ...payload, querySha256: canonicalSha256(payload) };
}
function parseOhProjectionQueryV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["find", "limit", "queryId", "querySha256", "where", "v"]) || value.v !== 1 || !Array.isArray(value.find) || !Array.isArray(value.where))
    return null;
  const querySha256 = parseSha256Hex(value.querySha256);
  try {
    const query = createOhProjectionQueryV1({
      find: value.find,
      limit: value.limit,
      queryId: value.queryId,
      where: value.where
    });
    return querySha256 !== null && query.querySha256 === querySha256 ? query : null;
  } catch {
    return null;
  }
}
function createOhProjectionIdentityV1(input) {
  const snapshot = parseOhProjectionSnapshotV1(input.snapshot);
  const dataset = snapshot === null ? null : parseOhProjectionDatasetV1(input.dataset, snapshot);
  const query = parseOhProjectionQueryV1(input.query);
  const rulePack = parseOhProjectionRulePackV1(input.rulePack);
  if (snapshot === null || dataset === null || query === null || rulePack === null) {
    throw new TypeError("Invalid projection identity input.");
  }
  const payload = {
    contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    datasetSha256: dataset.datasetSha256,
    querySha256: query.querySha256,
    rulePackSha256: rulePack.rulePackSha256,
    semantics: OH_PROJECTION_SEMANTICS_V1,
    snapshotSha256: snapshot.snapshotSha256,
    v: 1
  };
  return { ...payload, projectionSha256: canonicalSha256(payload) };
}
function parseOhProjectionIdentityV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "contractSha256",
    "datasetSha256",
    "projectionSha256",
    "querySha256",
    "rulePackSha256",
    "semantics",
    "snapshotSha256",
    "v"
  ]) || value.v !== 1 || value.semantics !== OH_PROJECTION_SEMANTICS_V1)
    return null;
  const contractSha256 = parseSha256Hex(value.contractSha256);
  const datasetSha256 = parseSha256Hex(value.datasetSha256);
  const projectionSha256 = parseSha256Hex(value.projectionSha256);
  const querySha256 = parseSha256Hex(value.querySha256);
  const rulePackSha256 = parseSha256Hex(value.rulePackSha256);
  const snapshotSha256 = parseSha256Hex(value.snapshotSha256);
  if (contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256 || datasetSha256 === null || projectionSha256 === null || querySha256 === null || rulePackSha256 === null || snapshotSha256 === null)
    return null;
  const payload = {
    contractSha256,
    datasetSha256,
    querySha256,
    rulePackSha256,
    semantics: OH_PROJECTION_SEMANTICS_V1,
    snapshotSha256,
    v: 1
  };
  return canonicalSha256(payload) === projectionSha256 ? { ...payload, projectionSha256 } : null;
}
function invalidationForOhProjectionV1(previous, next) {
  const parsedPrevious = parseOhProjectionIdentityV1(previous);
  const parsedNext = parseOhProjectionIdentityV1(next);
  if (parsedPrevious === null || parsedNext === null)
    throw new TypeError("Invalid projection identity.");
  if (parsedPrevious.projectionSha256 === parsedNext.projectionSha256)
    return { kind: "reusable", v: 1 };
  const reasons = [];
  if (parsedPrevious.snapshotSha256 !== parsedNext.snapshotSha256)
    reasons.push("snapshot-changed");
  if (parsedPrevious.datasetSha256 !== parsedNext.datasetSha256)
    reasons.push("dataset-changed");
  if (parsedPrevious.rulePackSha256 !== parsedNext.rulePackSha256)
    reasons.push("rule-pack-changed");
  if (parsedPrevious.querySha256 !== parsedNext.querySha256)
    reasons.push("query-changed");
  return { kind: "full-rebuild", reasons, v: 1 };
}
function tupleKey(value) {
  return canonicalJson(value);
}
function referenceKey(reference) {
  return canonicalJson([reference.relation, reference.tuple]);
}
function relationTuples(relations, relation) {
  return [...relations.get(relation)?.values() ?? []].sort((left, right) => compareCanonical(left.tuple, right.tuple));
}
function setArity(arities, relation, arity) {
  const existing = arities.get(relation);
  if (existing !== undefined && existing !== arity) {
    throw new TypeError(`Projection relation ${relation} is used with conflicting arities.`);
  }
  arities.set(relation, arity);
  if (arities.size > OH_PROJECTION_LIMITS_V1.relations)
    throw new RangeError("Projection uses too many relations.");
}
function validateProgramArities(dataset, rulePack, query) {
  const arities = new Map;
  for (const fact of dataset.facts)
    setArity(arities, fact.relation, fact.tuple.length);
  for (const rule of rulePack.rules) {
    setArity(arities, rule.head.relation, rule.head.terms.length);
    for (const literal of rule.body)
      setArity(arities, literal.relation, literal.terms.length);
  }
  for (const literal of query.where)
    setArity(arities, literal.relation, literal.terms.length);
}
function sameAtom(left, right) {
  return left === right;
}
function unifyLiteral(literal, state, binding) {
  const next = new Map(binding);
  for (let index = 0;index < literal.terms.length; index += 1) {
    const term = literal.terms[index];
    const value = state.tuple[index];
    if (term.kind === "constant") {
      if (!sameAtom(term.value, value))
        return null;
      continue;
    }
    if (next.has(term.name)) {
      if (!sameAtom(next.get(term.name), value))
        return null;
    } else
      next.set(term.name, value);
  }
  return next;
}
function matchBody(relations, body, maximumMatches) {
  let matches = [{ binding: new Map, premises: [] }];
  for (const literal of body) {
    const next = [];
    const candidates = relationTuples(relations, literal.relation);
    for (const match of matches) {
      for (const candidate of candidates) {
        const binding = unifyLiteral(literal, candidate, match.binding);
        if (binding === null)
          continue;
        next.push({ binding, premises: [...match.premises, {
          relation: literal.relation,
          tuple: candidate.tuple
        }] });
        if (next.length > maximumMatches)
          throw new RangeError("Projection join exceeds its match bound.");
      }
    }
    matches = next;
    if (matches.length === 0)
      break;
  }
  return matches;
}
function instantiateHead(head, binding) {
  return head.terms.map((term) => term.kind === "constant" ? term.value : binding.get(term.name));
}
function canonicalWitness(witness) {
  if (witness.kind === "fact")
    return canonicalJson(witness);
  return canonicalJson({ kind: witness.kind, premises: witness.premises, ruleSha256: witness.rule.ruleSha256 });
}
function materializeNaive(input) {
  const relations = new Map;
  for (const fact of input.dataset.facts) {
    let relation = relations.get(fact.relation);
    if (relation === undefined) {
      relation = new Map;
      relations.set(fact.relation, relation);
    }
    relation.set(tupleKey(fact.tuple), { tuple: fact.tuple, witness: { kind: "fact", sources: fact.sources } });
  }
  let derivedFacts = 0;
  let rounds = 0;
  while (true) {
    const candidates = new Map;
    for (const rule of input.rulePack.rules) {
      for (const match of matchBody(relations, rule.body, OH_PROJECTION_LIMITS_V1.queryMatches)) {
        const derivedTuple = instantiateHead(rule.head, match.binding);
        const relation = relations.get(rule.head.relation);
        const key = tupleKey(derivedTuple);
        if (relation?.has(key) === true)
          continue;
        const state = {
          tuple: derivedTuple,
          witness: { kind: "derived", premises: match.premises, rule }
        };
        const identity = referenceKey({ relation: rule.head.relation, tuple: derivedTuple });
        const existing = candidates.get(identity);
        if (existing === undefined || canonicalWitness(state.witness) < canonicalWitness(existing.state.witness)) {
          candidates.set(identity, { relation: rule.head.relation, state });
        }
      }
    }
    if (candidates.size === 0)
      break;
    if (rounds >= input.maximumRounds)
      throw new RangeError("Projection exceeds its evaluation round bound.");
    if (derivedFacts + candidates.size > input.maximumDerivedTuples) {
      throw new RangeError("Projection exceeds its derived tuple bound.");
    }
    const ordered = [...candidates.values()].sort((left, right) => compareCanonical([left.relation, left.state.tuple], [right.relation, right.state.tuple]));
    for (const candidate of ordered) {
      let relation = relations.get(candidate.relation);
      if (relation === undefined) {
        relation = new Map;
        relations.set(candidate.relation, relation);
      }
      relation.set(tupleKey(candidate.state.tuple), candidate.state);
    }
    derivedFacts += candidates.size;
    rounds += 1;
  }
  return { baseFacts: input.dataset.facts.length, derivedFacts, relations, rounds };
}
function boundedOption(value, fallback, maximum, label) {
  const parsed = positiveInteger(value ?? fallback, maximum);
  if (parsed === null)
    throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`);
  return parsed;
}
function resolveEvaluationOptions(options) {
  return {
    maximumDerivedTuples: boundedOption(options.maximumDerivedTuples, OH_PROJECTION_LIMITS_V1.derivedTuples, OH_PROJECTION_LIMITS_V1.derivedTuples, "maximumDerivedTuples"),
    maximumProofDepth: boundedOption(options.maximumProofDepth, 32, OH_PROJECTION_LIMITS_V1.proofDepth, "maximumProofDepth"),
    maximumProofNodes: boundedOption(options.maximumProofNodes, 1024, OH_PROJECTION_LIMITS_V1.proofNodes, "maximumProofNodes"),
    maximumRounds: boundedOption(options.maximumRounds, OH_PROJECTION_LIMITS_V1.rounds, OH_PROJECTION_LIMITS_V1.rounds, "maximumRounds")
  };
}
function proofForReference(relations, reference, budget, options, depth, visiting) {
  if (budget.nodes >= options.maximumProofNodes)
    return null;
  if (budget.nodes === options.maximumProofNodes - 1) {
    budget.nodes += 1;
    return { kind: "truncated", reason: "nodes", relation: reference.relation, tuple: reference.tuple, v: 1 };
  }
  budget.nodes += 1;
  if (depth >= options.maximumProofDepth) {
    return { kind: "truncated", reason: "depth", relation: reference.relation, tuple: reference.tuple, v: 1 };
  }
  const identity = referenceKey(reference);
  if (visiting.has(identity)) {
    return { kind: "truncated", reason: "cycle", relation: reference.relation, tuple: reference.tuple, v: 1 };
  }
  const state = relations.get(reference.relation)?.get(tupleKey(reference.tuple));
  if (state === undefined)
    throw new Error("Projection proof references a tuple outside the materialized result.");
  if (state.witness.kind === "fact") {
    return {
      kind: "fact",
      relation: reference.relation,
      sources: state.witness.sources,
      tuple: reference.tuple,
      v: 1
    };
  }
  visiting.add(identity);
  try {
    const premises = [];
    for (const premise of state.witness.premises) {
      const proof = proofForReference(relations, premise, budget, options, depth + 1, visiting);
      if (proof === null)
        break;
      premises.push(proof);
    }
    return {
      kind: "derived",
      premises,
      relation: reference.relation,
      ruleId: state.witness.rule.ruleId,
      ruleSha256: state.witness.rule.ruleSha256,
      tuple: reference.tuple,
      v: 1
    };
  } finally {
    visiting.delete(identity);
  }
}
function buildProjectionResult(input) {
  const matches = matchBody(input.materialized.relations, input.query.where, OH_PROJECTION_LIMITS_V1.queryMatches);
  const byValues = new Map;
  for (const match of matches) {
    const values = input.query.find.map((name) => match.binding.get(name));
    const key = tupleKey(values);
    const existing = byValues.get(key);
    if (existing === undefined || compareCanonical(match.premises, existing.premises) < 0)
      byValues.set(key, match);
  }
  const ordered = [...byValues.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const truncated = ordered.length > input.query.limit;
  const rows = ordered.slice(0, input.query.limit).map(([key, match]) => {
    const values = JSON.parse(key);
    const budget = { nodes: 0 };
    const proofs = [];
    for (const premise of match.premises) {
      const proof = proofForReference(input.materialized.relations, premise, budget, input.options, 0, new Set);
      if (proof === null)
        break;
      proofs.push(proof);
    }
    return { proofs, values, v: 1 };
  });
  const identity = createOhProjectionIdentityV1({
    dataset: input.dataset,
    query: input.query,
    rulePack: input.rulePack,
    snapshot: input.snapshot
  });
  const payload = {
    authority: "derived",
    cache: { strategy: "full-rebuild", v: 1 },
    engine: input.engine,
    evaluation: { ...input.options, v: 1 },
    identity,
    rows,
    stats: {
      baseFacts: input.materialized.baseFacts,
      derivedFacts: input.materialized.derivedFacts,
      queryMatches: matches.length,
      relations: input.materialized.relations.size,
      rounds: input.materialized.rounds,
      truncated,
      v: 1
    },
    v: 1
  };
  return { ...payload, resultSha256: canonicalSha256(payload) };
}
function evaluateOhProjectionV1(input) {
  const snapshot = parseOhProjectionSnapshotV1(input.snapshot);
  const dataset = snapshot === null ? null : parseOhProjectionDatasetV1(input.dataset, snapshot);
  const rulePack = parseOhProjectionRulePackV1(input.rulePack);
  const query = parseOhProjectionQueryV1(input.query);
  if (snapshot === null || dataset === null || rulePack === null || query === null) {
    throw new TypeError("Invalid projection snapshot, dataset, rule pack, or query.");
  }
  const options = resolveEvaluationOptions(input.options ?? {});
  validateProgramArities(dataset, rulePack, query);
  const materialized = materializeNaive({
    dataset,
    maximumDerivedTuples: options.maximumDerivedTuples,
    maximumRounds: options.maximumRounds,
    rulePack
  });
  return buildProjectionResult({
    dataset,
    engine: OH_PROJECTION_INTERNAL_ENGINE_V1,
    materialized,
    options,
    query,
    rulePack,
    snapshot
  });
}
function evaluateOhProjectionWithMaterializerV1(input) {
  const snapshot = parseOhProjectionSnapshotV1(input.snapshot);
  const dataset = snapshot === null ? null : parseOhProjectionDatasetV1(input.dataset, snapshot);
  const rulePack = parseOhProjectionRulePackV1(input.rulePack);
  const query = parseOhProjectionQueryV1(input.query);
  const engine = safeCode(input.engine, 256);
  if (snapshot === null || dataset === null || rulePack === null || query === null || engine === null) {
    throw new TypeError("Invalid projection adapter input.");
  }
  const options = resolveEvaluationOptions(input.options ?? {});
  validateProgramArities(dataset, rulePack, query);
  const external = input.materialize({
    dataset,
    maximumDerivedTuples: options.maximumDerivedTuples,
    maximumRounds: options.maximumRounds,
    query,
    rulePack
  });
  const witnessMaterialization = materializeNaive({
    dataset,
    maximumDerivedTuples: options.maximumDerivedTuples,
    maximumRounds: options.maximumRounds,
    rulePack
  });
  const externalCanonical = new Map;
  for (const [relationName, tuples] of external.relationFacts) {
    const relation = projectionName(relationName);
    if (relation === null || tuples.length > OH_PROJECTION_LIMITS_V1.facts + options.maximumDerivedTuples) {
      throw new TypeError("Projection adapter returned an invalid relation.");
    }
    const parsed = tuples.map(tuple);
    if (parsed.some((value) => value === null))
      throw new TypeError("Projection adapter returned an invalid tuple.");
    const keys = [];
    for (const value of parsed) {
      if (value === null)
        throw new TypeError("Projection adapter returned an invalid tuple.");
      keys.push(tupleKey(value));
    }
    externalCanonical.set(relation, [...new Set(keys)].sort());
  }
  const expectedCanonical = new Map([...witnessMaterialization.relations.entries()].map(([relation, states]) => [relation, [...states.values()].map((state) => tupleKey(state.tuple)).sort()]));
  const relationNames = [...new Set([...externalCanonical.keys(), ...expectedCanonical.keys()])].sort();
  for (const relation of relationNames) {
    if (canonicalJson(externalCanonical.get(relation) ?? []) !== canonicalJson(expectedCanonical.get(relation) ?? [])) {
      throw new Error(`Projection adapter disagrees with Oh semantics for relation ${relation}.`);
    }
  }
  return buildProjectionResult({
    dataset,
    engine,
    materialized: witnessMaterialization,
    options,
    query,
    rulePack,
    snapshot
  });
}
function createOhProjectionRecordFactsV1(records, options = {}) {
  if (records.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot)
    throw new RangeError("Too many records for projection facts.");
  const facts = [];
  for (const candidate of [...records].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)) {
    const record = parseKnowledgeGraphRecordV1(candidate);
    if (record === null)
      throw new TypeError("Invalid graph record for projection facts.");
    const source = [{ key: record.key, recordSha256: record.recordSha256, v: 1 }];
    if (options.includeRecords !== false) {
      facts.push(createOhProjectionFactV1({
        relation: "oh.record",
        sources: source,
        tuple: [record.key, record.kind, record.recordSha256]
      }));
    }
    if (options.includeDependencies !== false) {
      for (const dependency of record.dependencies) {
        facts.push(createOhProjectionFactV1({
          relation: "oh.dependency",
          sources: source,
          tuple: [record.key, dependency]
        }));
      }
    }
  }
  return facts.sort(compareProjectionFacts);
}
function isOhProjectionRecordKindV1(value) {
  return OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.some((kind) => kind === value);
}

// src/projection-suss.ts
var OH_PROJECTION_SUSS_VERSION_V1 = "0.20.0";
var OH_PROJECTION_SUSS_ENGINE_V1 = "suss.datalog.v0-20-0.equivalence";
function encodeAtom(value) {
  return canonicalJson(value);
}
function decodeAtom(value) {
  if (typeof value !== "string")
    throw new TypeError("Suss returned a non-encoded projection atom.");
  const decoded = parseCanonicalJson(value, 16 * 1024);
  if (decoded !== null && typeof decoded === "object") {
    throw new TypeError("Suss returned a non-atomic projection value.");
  }
  return decoded;
}
function sussTerm(term) {
  return term.kind === "constant" ? constant(encodeAtom(term.value)) : variable(term.name);
}
function sussLiteral(literal) {
  return lit(literal.relation, ...literal.terms.map(sussTerm));
}
function sussRule(input) {
  return rule(input.head.relation, input.head.terms.map(sussTerm), input.body.map(sussLiteral), input.ruleId);
}
function projectionDomainSize(dataset, rulePack, query) {
  const atoms = new Set;
  for (const fact of dataset.facts)
    for (const value of fact.tuple)
      atoms.add(encodeAtom(value));
  const addTerms = (literal) => {
    for (const term of literal.terms)
      if (term.kind === "constant")
        atoms.add(encodeAtom(term.value));
  };
  for (const item of rulePack.rules) {
    addTerms(item.head);
    for (const literal of item.body)
      addTerms(literal);
  }
  for (const literal of query.where)
    addTerms(literal);
  return atoms.size;
}
function assertConservativeOutputBound(input) {
  const domainSize = BigInt(projectionDomainSize(input.dataset, input.rulePack, input.query));
  const heads = new Map;
  for (const item of input.rulePack.rules)
    heads.set(item.head.relation, item.head.terms.length);
  let possible = 0n;
  const maximum = BigInt(input.maximumDerivedTuples + input.dataset.facts.length);
  for (const arity of heads.values()) {
    possible += domainSize ** BigInt(arity);
    if (possible > maximum) {
      throw new RangeError("The Suss equivalence adapter cannot prove the requested derived-tuple bound before evaluation; use the bounded Oh evaluator.");
    }
  }
}
function evaluateOhProjectionWithSussV1(input) {
  return evaluateOhProjectionWithMaterializerV1({
    dataset: input.dataset,
    engine: OH_PROJECTION_SUSS_ENGINE_V1,
    ...input.options === undefined ? {} : { options: input.options },
    query: input.query,
    rulePack: input.rulePack,
    snapshot: input.snapshot,
    materialize: (program) => {
      assertConservativeOutputBound(program);
      const database = new Database;
      for (const fact of program.dataset.facts) {
        database.add(fact.relation, fact.tuple.map(encodeAtom));
      }
      evaluate(database, program.rulePack.rules.map(sussRule));
      const relationFacts = new Map;
      for (const relation of database.relationNames()) {
        relationFacts.set(relation, database.facts(relation).map((values) => values.map(decodeAtom)));
      }
      return { relationFacts };
    }
  });
}
export {
  evaluateOhProjectionWithSussV1,
  OH_PROJECTION_SUSS_VERSION_V1,
  OH_PROJECTION_SUSS_ENGINE_V1
};
