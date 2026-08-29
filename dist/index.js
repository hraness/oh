// @bun
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
  #sealed = false;
  register(codec) {
    if (this.#sealed)
      throw new TypeError("The codec registry is sealed.");
    if (this.#codecs.has(codec.kind))
      throw new TypeError(`A codec is already registered for ${codec.kind}.`);
    this.#codecs.set(codec.kind, Object.freeze({ kind: codec.kind, parse: codec.parse }));
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
  parseRequired(kind, value) {
    const codec = this.#codecs.get(kind);
    if (codec === undefined)
      return null;
    try {
      const parsed = codec.parse(value);
      if (parsed === null)
        return null;
      canonicalJson(parsed);
      return parsed;
    } catch {
      return null;
    }
  }
  seal() {
    this.#sealed = true;
    return this;
  }
  get sealed() {
    return this.#sealed;
  }
}

// src/operation.ts
var OH_OPERATION_MAX_BYTES_V1 = 64 * 1024 * 1024;
function parsePayload(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "actorId",
    "changes",
    "contractId",
    "graphRevisionSha256",
    "instant",
    "operationId",
    "parentOperationSha256",
    "recordsSha256",
    "sequence",
    "spaceId",
    "v"
  ]) || value.v !== 1 || value.contractId !== OH_CONTRACT_ID_V1 || !Array.isArray(value.changes))
    return null;
  const actorId = safeCode(value.actorId);
  const operationId = safeCode(value.operationId);
  const spaceId = safeCode(value.spaceId);
  const graphRevisionSha256 = parseSha256Hex(value.graphRevisionSha256);
  const parentOperationSha256 = value.parentOperationSha256 === null ? null : parseSha256Hex(value.parentOperationSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const instant = parseCanonicalInstantV1(value.instant);
  const sequence = Number.isSafeInteger(value.sequence) && value.sequence > 0 ? value.sequence : null;
  let changes;
  try {
    changes = canonicalKnowledgeGraphChangesV1(value.changes);
  } catch {
    return null;
  }
  if (changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation)
    return null;
  return actorId !== null && operationId !== null && spaceId !== null && graphRevisionSha256 !== null && recordsSha256 !== null && instant !== null && sequence !== null && (value.parentOperationSha256 === null || parentOperationSha256 !== null) && sequence === 1 === (parentOperationSha256 === null) ? {
    actorId,
    changes,
    contractId: OH_CONTRACT_ID_V1,
    graphRevisionSha256,
    instant,
    operationId,
    parentOperationSha256,
    recordsSha256,
    sequence,
    spaceId,
    v: 1
  } : null;
}
function createOhOperationV1(input) {
  const payload = parsePayload(input);
  if (payload === null)
    throw new TypeError("Invalid Oh operation payload.");
  const operation = { ...payload, operationSha256: canonicalSha256(payload) };
  if (Buffer.byteLength(canonicalJson(operation), "utf8") > OH_OPERATION_MAX_BYTES_V1) {
    throw new RangeError("Oh operation exceeds its canonical byte limit.");
  }
  return operation;
}
function parseOhOperationV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "operationSha256"))
    return null;
  const operationSha256 = parseSha256Hex(value.operationSha256);
  const { operationSha256: _digest, ...input } = value;
  const payload = parsePayload(input);
  return operationSha256 !== null && payload !== null && Buffer.byteLength(canonicalJson({ ...payload, operationSha256 }), "utf8") <= OH_OPERATION_MAX_BYTES_V1 && canonicalSha256(payload) === operationSha256 ? { ...payload, operationSha256 } : null;
}

// src/sync.ts
var OH_SYNC_PROTOCOL_V1 = "oh.sync.v1";
function createOhSyncBundleV1(spaceId, operations) {
  const parsedSpaceId = safeCode(spaceId);
  if (parsedSpaceId === null || operations.length > 1000)
    throw new TypeError("Invalid sync bundle.");
  let priorSequence = null;
  let priorSha256 = null;
  const parsed = [];
  for (const candidate of operations) {
    const operation = parseOhOperationV1(candidate);
    if (operation === null || operation.spaceId !== parsedSpaceId || priorSequence !== null && operation.sequence !== priorSequence + 1 || priorSequence !== null && operation.parentOperationSha256 !== priorSha256) {
      throw new TypeError("Sync operations must form one ordered chain.");
    }
    parsed.push(operation);
    priorSequence = operation.sequence;
    priorSha256 = operation.operationSha256;
  }
  const payload = {
    contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    operations: parsed,
    protocol: OH_SYNC_PROTOCOL_V1,
    spaceId: parsedSpaceId,
    v: 1
  };
  return { ...payload, bundleSha256: canonicalSha256(payload) };
}
function parseOhSyncBundleV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["bundleSha256", "contractSha256", "operations", "protocol", "spaceId", "v"]) || value.protocol !== OH_SYNC_PROTOCOL_V1 || value.v !== 1 || !Array.isArray(value.operations))
    return null;
  const bundleSha256 = parseSha256Hex(value.bundleSha256);
  const contractSha256 = parseSha256Hex(value.contractSha256);
  if (bundleSha256 === null || contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256)
    return null;
  try {
    const created = createOhSyncBundleV1(value.spaceId, value.operations);
    return created.bundleSha256 === bundleSha256 ? { ...created, bundleSha256 } : null;
  } catch {
    return null;
  }
}
async function synchronizeOhStoreV1(store, transport, options = {}) {
  const batchSize = options.batchSize ?? 100;
  const maximumRounds = options.maximumRounds ?? 100;
  const remoteId = safeCode(options.remoteId ?? "default");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000 || !Number.isSafeInteger(maximumRounds) || maximumRounds < 1 || maximumRounds > 1e4 || remoteId === null)
    throw new TypeError("Invalid sync options.");
  await transport.handshake(OH_CONTRACT_MANIFEST_V1);
  let pulled = 0;
  let pushed = 0;
  for (let round = 1;round <= maximumRounds; round += 1) {
    const local = store.head();
    const remote = await transport.head(store.spaceId);
    if (local.sequence === remote.sequence) {
      if (local.operationSha256 !== remote.operationSha256) {
        throw new Error("Sync conflict: equal sequence numbers have different heads.");
      }
      store.updateSyncState(remoteId, {
        pulledSequence: local.sequence,
        pushedSequence: local.sequence,
        remoteHeadSha256: remote.operationSha256
      });
      return { head: remote, pulled, pushed, rounds: round, v: 1 };
    }
    if (local.sequence < remote.sequence) {
      const bundle = parseOhSyncBundleV1(await transport.pull(store.spaceId, local.sequence, batchSize));
      if (bundle === null || bundle.operations.length === 0 || bundle.operations[0]?.sequence !== local.sequence + 1 || bundle.operations[0]?.parentOperationSha256 !== local.operationSha256) {
        throw new Error("Sync conflict: remote history does not extend the local head.");
      }
      for (const operation of bundle.operations) {
        store.importOperation(operation);
        pulled += 1;
      }
    } else {
      const operations = store.exportOperations(remote.sequence, batchSize);
      if (operations.length === 0 || operations[0]?.sequence !== remote.sequence + 1 || operations[0]?.parentOperationSha256 !== remote.operationSha256) {
        throw new Error("Sync conflict: local history does not extend the remote head.");
      }
      const head = await transport.push(createOhSyncBundleV1(store.spaceId, operations));
      if (head.sequence !== operations.at(-1)?.sequence || head.operationSha256 !== operations.at(-1)?.operationSha256) {
        throw new Error("The sync transport acknowledged a different head.");
      }
      pushed += operations.length;
    }
  }
  throw new Error("Sync did not settle within maximumRounds.");
}
function rowValue(row, key, index) {
  return Array.isArray(row) ? row[index] : row[key];
}
function createLibSqlOperationSyncTransportV1(client) {
  let ready = null;
  const setup = async (manifest) => {
    if (parseOhContractManifestV1(manifest) === null)
      throw new Error("Unsupported contract manifest.");
    await client.batch([
      { sql: `CREATE TABLE IF NOT EXISTS oh_sync_contracts (
        contract_id TEXT PRIMARY KEY, contract_sha256 TEXT NOT NULL, manifest_json TEXT NOT NULL
      ) STRICT` },
      { sql: `CREATE TABLE IF NOT EXISTS oh_sync_operations (
        space_id TEXT NOT NULL, sequence INTEGER NOT NULL, operation_sha256 TEXT NOT NULL UNIQUE,
        operation_json TEXT NOT NULL, PRIMARY KEY(space_id, sequence)
      ) STRICT` },
      {
        sql: "INSERT INTO oh_sync_contracts(contract_id, contract_sha256, manifest_json) VALUES (?, ?, ?) ON CONFLICT(contract_id) DO NOTHING",
        args: [manifest.contractId, manifest.contractSha256, canonicalJson(manifest)]
      }
    ], "write");
    const result = await client.execute({
      sql: "SELECT contract_sha256, manifest_json FROM oh_sync_contracts WHERE contract_id = ?",
      args: [manifest.contractId]
    });
    const row = result.rows[0];
    if (row === undefined || rowValue(row, "contract_sha256", 0) !== manifest.contractSha256 || rowValue(row, "manifest_json", 1) !== canonicalJson(manifest)) {
      throw new Error("Remote contract manifest mismatch.");
    }
  };
  const ensure = (manifest = OH_CONTRACT_MANIFEST_V1) => {
    ready ??= setup(manifest).catch((error) => {
      ready = null;
      throw error;
    });
    return ready;
  };
  const head = async (spaceId) => {
    await ensure();
    const result = await client.execute({ sql: `SELECT sequence, operation_sha256 FROM oh_sync_operations
      WHERE space_id = ? ORDER BY sequence DESC LIMIT 1`, args: [spaceId] });
    const row = result.rows[0];
    if (row === undefined)
      return { operationSha256: null, sequence: 0, v: 1 };
    const sequence = Number(rowValue(row, "sequence", 0));
    const operationSha256 = parseSha256Hex(rowValue(row, "operation_sha256", 1));
    if (!Number.isSafeInteger(sequence) || sequence < 1 || operationSha256 === null)
      throw new Error("Invalid remote head.");
    return { operationSha256, sequence, v: 1 };
  };
  return {
    handshake: async (manifest) => {
      const parsed = parseOhContractManifestV1(manifest);
      if (parsed === null)
        throw new Error("Unsupported contract manifest.");
      await ensure(parsed);
    },
    head,
    pull: async (spaceId, afterSequence, limit) => {
      await ensure();
      const result = await client.execute({ sql: `SELECT operation_json FROM oh_sync_operations
        WHERE space_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`, args: [spaceId, afterSequence, limit] });
      const operations = result.rows.map((row) => {
        const json = rowValue(row, "operation_json", 0);
        if (typeof json !== "string")
          throw new Error("Invalid remote operation JSON.");
        const operation = parseOhOperationV1(JSON.parse(json));
        if (operation === null || canonicalJson(operation) !== json)
          throw new Error("Invalid remote operation.");
        return operation;
      });
      return createOhSyncBundleV1(spaceId, operations);
    },
    push: async (value) => {
      await ensure();
      const bundle = parseOhSyncBundleV1(value);
      if (bundle === null)
        throw new Error("Invalid outgoing sync bundle.");
      if (bundle.operations.length === 0)
        return head(bundle.spaceId);
      const remote = await head(bundle.spaceId);
      const first = bundle.operations[0];
      const last = bundle.operations.at(-1);
      if (remote.sequence === last.sequence && remote.operationSha256 === last.operationSha256)
        return remote;
      if (first.sequence !== remote.sequence + 1 || first.parentOperationSha256 !== remote.operationSha256) {
        throw new Error("Sync conflict: pushed history does not extend the remote head.");
      }
      await client.batch(bundle.operations.map((operation) => ({
        sql: "INSERT INTO oh_sync_operations(space_id, sequence, operation_sha256, operation_json) VALUES (?, ?, ?, ?)",
        args: [bundle.spaceId, operation.sequence, operation.operationSha256, canonicalJson(operation)]
      })), "write");
      return { operationSha256: last.operationSha256, sequence: last.sequence, v: 1 };
    }
  };
}
// src/store.ts
class OhConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "OhConflictError";
  }
}

class OhIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "OhIntegrityError";
  }
}

class OhDependencyError extends Error {
  constructor(message) {
    super(message);
    this.name = "OhDependencyError";
  }
}

class OhProfileError extends Error {
  constructor(message) {
    super(message);
    this.name = "OhProfileError";
  }
}
var OH_CANONICAL_STORE_PROFILE_V1 = createOhStoreProfileV1({
  applicationProfileSha256: null,
  capabilities: {
    changesSince: true,
    dependencyClosureExport: true,
    exactSnapshots: true,
    operationReplication: true,
    semanticBundleCommit: true,
    v: 1,
    wholeSpacePurge: false
  },
  profileId: "oh.store.canonical.v1",
  profileKind: "canonical",
  v: 1
});
var OH_WORKING_STORE_PROFILE_V1 = createOhStoreProfileV1({
  applicationProfileSha256: null,
  capabilities: {
    changesSince: true,
    dependencyClosureExport: true,
    exactSnapshots: true,
    operationReplication: false,
    semanticBundleCommit: true,
    v: 1,
    wholeSpacePurge: true
  },
  profileId: "oh.store.working.v1",
  profileKind: "working",
  v: 1
});
var OH_DEPENDENCY_CLOSURE_LIMITS_V1 = Object.freeze({
  bytes: 64 * 1024 * 1024,
  records: 8192,
  roots: 1024
});

class OhPurgedSpaceError extends Error {
  receipt;
  constructor(receipt) {
    super(`Oh space ${receipt.spaceId} was purged at ${receipt.purgedAt}.`);
    this.name = "OhPurgedSpaceError";
    this.receipt = receipt;
  }
}
var EMPTY_RECORDS_SHA256 = canonicalSha256([]);
function emptyOhHeadV1() {
  return {
    generation: 0,
    graphRevisionSha256: null,
    operationSha256: null,
    recordsSha256: EMPTY_RECORDS_SHA256,
    sequence: 0,
    v: 1
  };
}
function parseOhHeadV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "generation",
    "graphRevisionSha256",
    "operationSha256",
    "recordsSha256",
    "sequence",
    "v"
  ]) || value.v !== 1)
    return null;
  const graphRevisionSha256 = value.graphRevisionSha256 === null ? null : parseSha256Hex(value.graphRevisionSha256);
  const operationSha256 = value.operationSha256 === null ? null : parseSha256Hex(value.operationSha256);
  const recordsSha256 = parseSha256Hex(value.recordsSha256);
  const generation = Number.isSafeInteger(value.generation) && value.generation >= 0 ? value.generation : null;
  const sequence = Number.isSafeInteger(value.sequence) && value.sequence >= 0 ? value.sequence : null;
  return generation !== null && sequence !== null && generation === sequence && recordsSha256 !== null && (value.graphRevisionSha256 === null || graphRevisionSha256 !== null) && (value.operationSha256 === null || operationSha256 !== null) && sequence === 0 === (operationSha256 === null) && sequence === 0 === (graphRevisionSha256 === null) ? { generation, graphRevisionSha256, operationSha256, recordsSha256, sequence, v: 1 } : null;
}
function parseOhHeadRefV1(value) {
  const complete = parseOhHeadV1(value);
  if (complete !== null) {
    return { operationSha256: complete.operationSha256, sequence: complete.sequence };
  }
  if (!isPlainRecord(value) || !hasExactKeys(value, ["operationSha256", "sequence"]))
    return null;
  const operationSha256 = value.operationSha256 === null ? null : parseSha256Hex(value.operationSha256);
  const sequence = Number.isSafeInteger(value.sequence) && value.sequence >= 0 ? value.sequence : null;
  return sequence !== null && (value.operationSha256 === null || operationSha256 !== null) && sequence === 0 === (operationSha256 === null) ? { operationSha256, sequence } : null;
}
function parseCapabilities(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "changesSince",
    "dependencyClosureExport",
    "exactSnapshots",
    "operationReplication",
    "semanticBundleCommit",
    "v",
    "wholeSpacePurge"
  ]) || value.changesSince !== true || value.dependencyClosureExport !== true || value.exactSnapshots !== true || typeof value.operationReplication !== "boolean" || value.semanticBundleCommit !== true || value.v !== 1 || typeof value.wholeSpacePurge !== "boolean")
    return null;
  return {
    changesSince: true,
    dependencyClosureExport: true,
    exactSnapshots: true,
    operationReplication: value.operationReplication,
    semanticBundleCommit: true,
    v: 1,
    wholeSpacePurge: value.wholeSpacePurge
  };
}
function createOhStoreProfileV1(input) {
  if (!isPlainRecord(input) || !hasExactKeys(input, [
    "applicationProfileSha256",
    "capabilities",
    "profileId",
    "profileKind",
    "v"
  ]) || input.v !== 1)
    throw new TypeError("Invalid Oh store profile input.");
  const profileId = safeCode(input.profileId);
  const applicationProfileSha256 = input.applicationProfileSha256 === null ? null : parseSha256Hex(input.applicationProfileSha256);
  const capabilities = parseCapabilities(input.capabilities);
  if (profileId === null || capabilities === null || input.applicationProfileSha256 !== null && applicationProfileSha256 === null || input.profileKind !== "canonical" && input.profileKind !== "working") {
    throw new TypeError("Invalid Oh store profile input.");
  }
  if (input.profileKind === "working" && (capabilities.operationReplication || !capabilities.wholeSpacePurge)) {
    throw new OhProfileError("A working profile must disable operation replication and permit whole-space purge.");
  }
  if (input.profileKind === "canonical" && capabilities.wholeSpacePurge) {
    throw new OhProfileError("A canonical profile cannot permit whole-space purge.");
  }
  const payload = {
    applicationProfileSha256,
    capabilities: Object.freeze(capabilities),
    profileId,
    profileKind: input.profileKind,
    v: 1
  };
  return Object.freeze({ ...payload, profileSha256: canonicalSha256(payload) });
}
function parseOhStoreProfileV1(value) {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "profileSha256"))
    return null;
  const digest = parseSha256Hex(value.profileSha256);
  const { profileSha256: _profileSha256, ...input } = value;
  try {
    const created = createOhStoreProfileV1(input);
    return digest !== null && created.profileSha256 === digest ? created : null;
  } catch {
    return null;
  }
}
function createOhStoreBindingV1(input) {
  const profile = parseOhStoreProfileV1(input.profile);
  const realmId = safeCode(input.realmId);
  const spaceId = safeCode(input.spaceId);
  if (input.v !== 1 || profile === null || realmId === null || spaceId === null) {
    throw new TypeError("Invalid Oh store binding input.");
  }
  const payload = {
    contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    profile,
    realmId,
    spaceId,
    v: 1
  };
  return Object.freeze({ ...payload, bindingSha256: canonicalSha256(payload) });
}
function parseOhStoreBindingV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "bindingSha256",
    "contractSha256",
    "profile",
    "realmId",
    "spaceId",
    "v"
  ]) || value.v !== 1 || value.contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256)
    return null;
  const bindingSha256 = parseSha256Hex(value.bindingSha256);
  const profile = parseOhStoreProfileV1(value.profile);
  try {
    if (bindingSha256 === null || profile === null)
      return null;
    const created = createOhStoreBindingV1({
      profile,
      realmId: value.realmId,
      spaceId: value.spaceId,
      v: 1
    });
    return created.bindingSha256 === bindingSha256 ? created : null;
  } catch {
    return null;
  }
}
function sortedRecords(records) {
  return [...records].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
function verifyDependencies(records) {
  for (const record of records.values()) {
    for (const dependency of record.dependencies) {
      if (!records.has(dependency))
        throw new OhDependencyError(`Missing dependency ${dependency} for ${record.key}.`);
    }
  }
}
function replayOhOperationsV1(spaceId, values, maximumRecords = OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
  const parsedSpaceId = safeCode(spaceId);
  if (parsedSpaceId === null || !Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    throw new TypeError("Invalid operation replay input.");
  }
  const records = new Map;
  let head = emptyOhHeadV1();
  for (const value of values) {
    const operation = parseOhOperationV1(value);
    if (operation === null || operation.spaceId !== parsedSpaceId || operation.sequence !== head.sequence + 1 || operation.parentOperationSha256 !== head.operationSha256) {
      throw new OhIntegrityError("Operation replay chain is broken.");
    }
    for (const change of operation.changes) {
      if (change.kind === "put")
        records.set(change.record.key, change.record);
      else {
        const prior = records.get(change.key);
        if (prior?.recordSha256 !== change.priorSha256) {
          throw new OhIntegrityError("Replay tombstone does not match its prior record.");
        }
        records.delete(change.key);
      }
    }
    if (records.size > maximumRecords)
      throw new RangeError("Operation replay exceeds its record bound.");
    verifyDependencies(records);
    const refs = sortedRecords(records.values()).map(knowledgeGraphRecordRefV1);
    const recordsSha256 = canonicalSha256(refs);
    const graphRevisionSha256 = graphRevisionSha256V1({
      changes: operation.changes,
      operationId: operation.operationId,
      parentGraphRevisionSha256: head.graphRevisionSha256,
      recordsSha256,
      revision: operation.sequence
    });
    if (recordsSha256 !== operation.recordsSha256 || graphRevisionSha256 !== operation.graphRevisionSha256) {
      throw new OhIntegrityError("Replay does not reproduce an operation head.");
    }
    head = {
      generation: operation.sequence,
      graphRevisionSha256,
      operationSha256: operation.operationSha256,
      recordsSha256,
      sequence: operation.sequence,
      v: 1
    };
  }
  return { head, records: sortedRecords(records.values()), v: 1 };
}
function transitionOhSnapshotV1(input) {
  const actorId = safeCode(input.actorId);
  const operationId = safeCode(input.operationId);
  const spaceId = safeCode(input.spaceId);
  const instant = parseCanonicalInstantV1(input.instant);
  const changes = canonicalKnowledgeGraphChangesV1(input.changes);
  if (actorId === null || operationId === null || spaceId === null || instant === null || changes.length === 0 || changes.length > OH_GRAPH_LIMITS_V1.changesPerOperation) {
    throw new TypeError("Invalid graph transition input.");
  }
  const head = parseOhHeadV1(input.snapshot.head);
  if (input.snapshot.v !== 1 || head === null || !Array.isArray(input.snapshot.records)) {
    throw new OhIntegrityError("The transition snapshot is invalid.");
  }
  const records = new Map;
  for (const value of input.snapshot.records) {
    const record = parseKnowledgeGraphRecordV1(value);
    if (record === null || records.has(record.key)) {
      throw new OhIntegrityError("The transition snapshot contains an invalid record.");
    }
    records.set(record.key, record);
  }
  verifyDependencies(records);
  const priorRecordsSha256 = canonicalSha256(sortedRecords(records.values()).map(knowledgeGraphRecordRefV1));
  if (priorRecordsSha256 !== head.recordsSha256) {
    throw new OhIntegrityError("The transition snapshot does not reproduce its head.");
  }
  for (const change of changes) {
    if (change.kind === "put")
      records.set(change.record.key, change.record);
    else {
      const prior = records.get(change.key);
      if (prior === undefined || prior.recordSha256 !== change.priorSha256) {
        throw new OhConflictError(`The prior digest for ${change.key} does not match the snapshot.`);
      }
      records.delete(change.key);
    }
  }
  if (records.size > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    throw new RangeError("Graph transition exceeds its record snapshot limit.");
  }
  verifyDependencies(records);
  const nextRecords = sortedRecords(records.values());
  const recordsSha256 = canonicalSha256(nextRecords.map(knowledgeGraphRecordRefV1));
  const graphRevisionSha256 = graphRevisionSha256V1({
    changes,
    operationId,
    parentGraphRevisionSha256: head.graphRevisionSha256,
    recordsSha256,
    revision: head.sequence + 1
  });
  const operation = createOhOperationV1({
    actorId,
    changes,
    contractId: OH_CONTRACT_MANIFEST_V1.contractId,
    graphRevisionSha256,
    instant,
    operationId,
    parentOperationSha256: head.operationSha256,
    recordsSha256,
    sequence: head.sequence + 1,
    spaceId,
    v: 1
  });
  const nextHead = {
    generation: operation.sequence,
    graphRevisionSha256,
    operationSha256: operation.operationSha256,
    recordsSha256,
    sequence: operation.sequence,
    v: 1
  };
  return { operation, snapshot: { head: nextHead, records: nextRecords, v: 1 } };
}
function normalizeRoots(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > OH_DEPENDENCY_CLOSURE_LIMITS_V1.roots) {
    throw new RangeError(`A dependency closure needs 1 through ${OH_DEPENDENCY_CLOSURE_LIMITS_V1.roots} roots.`);
  }
  const roots = values.map((value) => safeCode(value, 512));
  if (roots.some((value) => value === null))
    throw new TypeError("Invalid dependency closure root.");
  const sorted = [...roots].sort();
  if (sorted.some((value, index) => index > 0 && sorted[index - 1] === value)) {
    throw new TypeError("Dependency closure roots must be unique.");
  }
  return sorted;
}
function closureRecords(available, roots, maximumRecords) {
  const selected = new Map;
  const pending = [...roots];
  while (pending.length > 0) {
    const key = pending.pop();
    if (selected.has(key))
      continue;
    const record = available.get(key);
    if (record === undefined)
      throw new OhDependencyError(`Dependency closure record ${key} is missing.`);
    selected.set(key, record);
    if (selected.size > maximumRecords)
      throw new RangeError("Dependency closure exceeds its record bound.");
    pending.push(...record.dependencies);
  }
  return sortedRecords(selected.values());
}
function createOhDependencyClosureV1(input) {
  const binding = parseOhStoreBindingV1(input.binding);
  const head = parseOhHeadV1(input.snapshot.head);
  const maximumRecords = input.maximumRecords ?? OH_DEPENDENCY_CLOSURE_LIMITS_V1.records;
  if (binding === null || head === null || !Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > OH_DEPENDENCY_CLOSURE_LIMITS_V1.records) {
    throw new TypeError("Invalid dependency closure input.");
  }
  const roots = normalizeRoots(input.roots);
  const available = new Map;
  for (const value of input.snapshot.records) {
    const record = parseKnowledgeGraphRecordV1(value);
    if (record === null || available.has(record.key))
      throw new OhIntegrityError("Snapshot contains an invalid record.");
    available.set(record.key, record);
  }
  const recordsSha256 = canonicalSha256(sortedRecords(available.values()).map(knowledgeGraphRecordRefV1));
  if (recordsSha256 !== head.recordsSha256)
    throw new OhIntegrityError("Snapshot records do not reproduce its head.");
  const records = closureRecords(available, roots, maximumRecords);
  const payload = { binding, head, records, roots, v: 1 };
  const closure = { ...payload, closureSha256: canonicalSha256(payload) };
  if (Buffer.byteLength(canonicalJson(closure), "utf8") > OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes) {
    throw new RangeError("Dependency closure exceeds its canonical byte bound.");
  }
  return Object.freeze(closure);
}
function parseOhDependencyClosureV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "binding",
    "closureSha256",
    "head",
    "records",
    "roots",
    "v"
  ]) || value.v !== 1 || !Array.isArray(value.records) || !Array.isArray(value.roots) || value.records.length > OH_DEPENDENCY_CLOSURE_LIMITS_V1.records)
    return null;
  const binding = parseOhStoreBindingV1(value.binding);
  const head = parseOhHeadV1(value.head);
  const closureSha256 = parseSha256Hex(value.closureSha256);
  if (binding === null || head === null || closureSha256 === null)
    return null;
  const records = new Map;
  for (const item of value.records) {
    const record = parseKnowledgeGraphRecordV1(item);
    if (record === null || records.has(record.key))
      return null;
    records.set(record.key, record);
  }
  try {
    const roots = normalizeRoots(value.roots);
    if (canonicalJson(roots) !== canonicalJson(value.roots))
      return null;
    const exact = closureRecords(records, roots, OH_DEPENDENCY_CLOSURE_LIMITS_V1.records);
    if (canonicalJson(exact) !== canonicalJson(value.records))
      return null;
    const payload = { binding, head, records: exact, roots, v: 1 };
    const parsed = { ...payload, closureSha256 };
    return canonicalSha256(payload) === closureSha256 && Buffer.byteLength(canonicalJson(parsed), "utf8") <= OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes ? Object.freeze(parsed) : null;
  } catch {
    return null;
  }
}
function verifyOhDependencyClosureV1(value) {
  const closure = parseOhDependencyClosureV1(value);
  return closure === null ? { ok: false, reason: "invalid-closure" } : { closure, ok: true };
}
function createOhSpacePurgeReceiptV1(input) {
  const binding = parseOhStoreBindingV1(input.binding);
  const priorHead = parseOhHeadV1(input.priorHead);
  const purgedAt = parseCanonicalInstantV1(input.purgedAt);
  if (binding === null || priorHead === null || purgedAt === null || binding.profile.profileKind !== "working" || !binding.profile.capabilities.wholeSpacePurge) {
    throw new OhProfileError("Only a bound working realm can produce a purge receipt.");
  }
  const payload = {
    bindingSha256: binding.bindingSha256,
    priorHead,
    purgedAt,
    spaceId: binding.spaceId,
    v: 1
  };
  return Object.freeze({ ...payload, receiptSha256: canonicalSha256(payload) });
}
function parseOhSpacePurgeReceiptV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "bindingSha256",
    "priorHead",
    "purgedAt",
    "receiptSha256",
    "spaceId",
    "v"
  ]) || value.v !== 1)
    return null;
  const bindingSha256 = parseSha256Hex(value.bindingSha256);
  const priorHead = parseOhHeadV1(value.priorHead);
  const purgedAt = parseCanonicalInstantV1(value.purgedAt);
  const receiptSha256 = parseSha256Hex(value.receiptSha256);
  const spaceId = safeCode(value.spaceId);
  if (bindingSha256 === null || priorHead === null || purgedAt === null || receiptSha256 === null || spaceId === null)
    return null;
  const payload = { bindingSha256, priorHead, purgedAt, spaceId, v: 1 };
  return canonicalSha256(payload) === receiptSha256 ? Object.freeze({ ...payload, receiptSha256 }) : null;
}

class OhSemanticBundleIngressV1 {
  #codecs;
  #store;
  constructor(store, codecs) {
    this.#store = store;
    this.#codecs = codecs.seal();
  }
  async commit(value) {
    if (!isPlainRecord(value) || !hasExactKeys(value, [
      "actorId",
      "expectedHead",
      "instant",
      "operationId",
      "puts",
      "tombstones",
      "v"
    ]) || value.v !== 1 || !Array.isArray(value.puts) || !Array.isArray(value.tombstones) || value.puts.length + value.tombstones.length < 1 || value.puts.length + value.tombstones.length > OH_GRAPH_LIMITS_V1.changesPerOperation) {
      throw new TypeError("Invalid semantic bundle.");
    }
    const actorId = safeCode(value.actorId);
    const operationId = safeCode(value.operationId);
    const expected = value.expectedHead;
    const instant = value.instant === null ? undefined : parseCanonicalInstantV1(value.instant);
    if (actorId === null || operationId === null || !isPlainRecord(expected) || !hasExactKeys(expected, ["generation", "operationSha256"]) || !Number.isSafeInteger(expected.generation) || expected.generation < 0 || expected.operationSha256 !== null && parseSha256Hex(expected.operationSha256) === null || expected.generation === 0 !== (expected.operationSha256 === null) || value.instant !== null && instant === null)
      throw new TypeError("Invalid semantic bundle identity.");
    const changes = [];
    for (const item of value.puts) {
      if (!isPlainRecord(item) || !hasExactKeys(item, ["dependencies", "key", "kind", "v", "value"]) || item.v !== 1 || !Array.isArray(item.dependencies) || !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.some((kind) => kind === item.kind)) {
        throw new TypeError("Invalid semantic bundle put.");
      }
      const parsed = this.#codecs.parseRequired(item.kind, item.value);
      if (parsed === null)
        throw new TypeError(`The ${String(item.kind)} codec rejected a semantic value.`);
      const record = createKnowledgeGraphRecordV1({
        dependencies: item.dependencies,
        key: item.key,
        kind: item.kind,
        v: 1,
        value: parsed
      });
      changes.push({ kind: "put", record, v: 1 });
    }
    for (const item of value.tombstones) {
      if (!isPlainRecord(item) || !hasExactKeys(item, ["key", "priorSha256", "v"]) || item.v !== 1) {
        throw new TypeError("Invalid semantic bundle tombstone.");
      }
      const priorSha256 = parseSha256Hex(item.priorSha256);
      if (typeof item.key !== "string" || priorSha256 === null)
        throw new TypeError("Invalid semantic bundle tombstone.");
      changes.push({ key: item.key, kind: "tombstone", priorSha256, v: 1 });
    }
    const canonical = canonicalKnowledgeGraphChangesV1(changes);
    return await this.#store.commit({
      actorId,
      changes: canonical,
      expectedHead: {
        generation: expected.generation,
        operationSha256: expected.operationSha256
      },
      ...typeof instant === "string" ? { instant } : {},
      operationId
    });
  }
}
export {
  verifyOhDependencyClosureV1,
  verifyKnowledgeValueV1,
  verifyKnowledgeSchemaEvolutionV1,
  utf8ByteLength,
  transitionOhSnapshotV1,
  synchronizeOhStoreV1,
  sortUnique,
  sha256Hex,
  safeCode,
  replayOhOperationsV1,
  reduceKnowledgeGraphRevisionsV1,
  parseSha256Hex,
  parseOhSyncBundleV1,
  parseOhStoreProfileV1,
  parseOhStoreBindingV1,
  parseOhSpacePurgeReceiptV1,
  parseOhOperationV1,
  parseOhHeadV1,
  parseOhHeadRefV1,
  parseOhDependencyClosureV1,
  parseOhContractManifestV1,
  parseKnowledgeVocabularyRevisionV1,
  parseKnowledgeValueV1,
  parseKnowledgeStatementV1,
  parseKnowledgeSchemaRevisionV1,
  parseKnowledgeSchemaRefV1,
  parseKnowledgeInquiryV1,
  parseKnowledgeInquiryId,
  parseKnowledgeGraphRevisionV1,
  parseKnowledgeGraphRecordV1,
  parseKnowledgeEvidenceLinkV1,
  parseKnowledgeEvidenceId,
  parseKnowledgeEntityV1,
  parseKnowledgeEntityId,
  parseKnowledgeContextV1,
  parseKnowledgeAssertionV1,
  parseKnowledgeAssertionId,
  parseKnowledgeActivityV1,
  parseCanonicalJson,
  parseCanonicalInstantV1,
  orderedUnique,
  opaqueId,
  knowledgeSchemaRefV1,
  knowledgeGraphRecordRefV1,
  isPlainRecord,
  hasExactKeys,
  graphRevisionSha256V1,
  emptyOhHeadV1,
  createOhSyncBundleV1,
  createOhStoreProfileV1,
  createOhStoreBindingV1,
  createOhSpacePurgeReceiptV1,
  createOhOperationV1,
  createOhDependencyClosureV1,
  createLibSqlOperationSyncTransportV1,
  createKnowledgeVocabularyRevisionV1,
  createKnowledgeStatementV1,
  createKnowledgeSchemaRevisionV1,
  createKnowledgeInquiryV1,
  createKnowledgeGraphRevisionV1,
  createKnowledgeGraphRecordV1,
  createKnowledgeEvidenceLinkV1,
  createKnowledgeContextV1,
  createKnowledgeAssertionV1,
  createKnowledgeActivityV1,
  canonicalSha256,
  canonicalNow,
  canonicalKnowledgeGraphChangesV1,
  canonicalJson,
  boundedText,
  OhValidationError,
  OhSemanticBundleIngressV1,
  OhRecordCodecRegistry,
  OhPurgedSpaceError,
  OhProfileError,
  OhIntegrityError,
  OhDependencyError,
  OhConflictError,
  OH_WORKING_STORE_PROFILE_V1,
  OH_SYNC_PROTOCOL_V1,
  OH_SCHEMA_KINDS_V1,
  OH_SCHEMA_FORMAT_VERSION_V1,
  OH_OPERATION_MAX_BYTES_V1,
  OH_ONTOLOGY_VERSION_V1,
  OH_KNOWLEDGE_LIMITS_V1,
  OH_KNOWLEDGE_KERNEL_CONCEPTS_V1,
  OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1,
  OH_KNOWLEDGE_ENTITY_STATES_V1,
  OH_KNOWLEDGE_ASSERTION_STATES_V1,
  OH_KNOWLEDGE_ASSERTION_STANCES_V1,
  OH_KNOWLEDGE_ACTIVITY_KINDS_V1,
  OH_GRAPH_LIMITS_V1,
  OH_GRAPH_FORMAT_VERSION_V1,
  OH_DEPENDENCY_CLOSURE_LIMITS_V1,
  OH_CONTRACT_MANIFEST_V1,
  OH_CONTRACT_ID_V1,
  OH_CANONICAL_STORE_PROFILE_V1
};
