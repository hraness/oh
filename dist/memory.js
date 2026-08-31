// src/canonical.ts
import { createHash, randomBytes } from "node:crypto";

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
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const length = lengthDescriptor?.value;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
        throw new OhValidationError("non-json-property", path, "array has an invalid length descriptor");
      }
      const ownKeys2 = Reflect.ownKeys(value);
      if (!ownKeys2.includes("length") || ownKeys2.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) {
        throw new OhValidationError("non-json-property", path, "array has non-index properties");
      }
      const elements = [];
      for (let index = 0;index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined) {
          throw new OhValidationError("sparse-array", `${path}[${index}]`, "must not contain holes");
        }
        if (!descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
          throw new OhValidationError("non-json-property", `${path}[${index}]`, "must be an enumerable data property");
        }
        elements.push(descriptor.value);
      }
      const encoded = elements.map((element, index) => encodeCanonical(element, `${path}[${index}]`, ancestors));
      return `[${encoded.join(",")}]`;
    }
    if (!isPlainRecord(value)) {
      throw new OhValidationError("non-plain-object", path, "must be a plain object");
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== "string")) {
      throw new OhValidationError("non-json-property", path, "object has a symbol property");
    }
    const entries = [];
    const keys = ownKeys;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new OhValidationError("non-json-property", `${path}.${key}`, "must be an enumerable data property");
      }
      entries.push([key, descriptor.value]);
    }
    entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    const encodedEntries = entries.map(([key, entryValue]) => {
      assertUnicodeScalarString(key, `${path}.<key>`);
      return `${JSON.stringify(key)}:${encodeCanonical(entryValue, `${path}.${key}`, ancestors)}`;
    });
    return `{${encodedEntries.join(",")}}`;
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
var KNOWLEDGE_GRAPH_RECORD_KEYS_V1 = [
  "dependencies",
  "key",
  "kind",
  "recordSha256",
  "v",
  "value"
];
function exactKnowledgeGraphRecordEnvelopeV1(value) {
  try {
    if (!isPlainRecord(value))
      return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== KNOWLEDGE_GRAPH_RECORD_KEYS_V1.length || ownKeys.some((key) => typeof key !== "string") || KNOWLEDGE_GRAPH_RECORD_KEYS_V1.some((key) => !ownKeys.includes(key)))
      return null;
    const detached = {};
    for (const key of KNOWLEDGE_GRAPH_RECORD_KEYS_V1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined)
        return null;
      detached[key] = descriptor.value;
    }
    return detached;
  } catch {
    return null;
  }
}
function exactGraphDependenciesV1(value) {
  try {
    if (!Array.isArray(value))
      return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord)
      return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || !ownKeys.includes("length") || ownKeys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)))
      return null;
    const detached = [];
    for (let index = 0;index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined)
        return null;
      detached.push(descriptor.value);
    }
    return detached;
  } catch {
    return null;
  }
}
function recordKey(value) {
  return typeof value === "string" && value.length <= 512 && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function createKnowledgeGraphRecordV1(input) {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["dependencies", "key", "kind", "v", "value"]) || input.v !== 1)
    throw new TypeError("Invalid graph record input.");
  const dependencyInput = exactGraphDependenciesV1(input.dependencies);
  if (dependencyInput === null)
    throw new TypeError("Invalid graph record dependencies.");
  const key = recordKey(input.key);
  const kind = OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.find((candidate) => candidate === input.kind);
  if (key === null || kind === undefined)
    throw new TypeError("Invalid graph record identity.");
  const dependencies = dependencyInput.map(recordKey);
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
  const envelope = exactKnowledgeGraphRecordEnvelopeV1(value);
  if (envelope === null)
    return null;
  const recordSha256 = parseSha256Hex(envelope.recordSha256);
  const input = {
    dependencies: envelope.dependencies,
    key: envelope.key,
    kind: envelope.kind,
    v: envelope.v,
    value: envelope.value
  };
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

// src/schema.ts
var OH_SCHEMA_FORMAT_VERSION_V1 = 1;

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
  const operationIds = new Set;
  let head = emptyOhHeadV1();
  for (const value of values) {
    const operation = parseOhOperationV1(value);
    if (operation === null || operation.spaceId !== parsedSpaceId || operation.sequence !== head.sequence + 1 || operation.parentOperationSha256 !== head.operationSha256 || operationIds.has(operation.operationId)) {
      throw new OhIntegrityError("Operation replay chain is broken.");
    }
    operationIds.add(operation.operationId);
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
function closureRecords(available, roots, maximumRecords, maximumBytes = OH_DEPENDENCY_CLOSURE_LIMITS_V1.bytes - 64 * 1024) {
  const selected = new Map;
  const pending = [...roots];
  let selectedBytes = 0;
  while (pending.length > 0) {
    const key = pending.pop();
    if (selected.has(key))
      continue;
    const record = available.get(key);
    if (record === undefined)
      throw new OhDependencyError(`Dependency closure record ${key} is missing.`);
    selectedBytes += Buffer.byteLength(canonicalJson(record), "utf8") + 1;
    if (selectedBytes > maximumBytes)
      throw new RangeError("Dependency closure exceeds its canonical byte bound.");
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
function verifyOhDependencyClosureAgainstV1(value, expected) {
  const binding = parseOhStoreBindingV1(expected.binding);
  const head = parseOhHeadV1(expected.head);
  if (binding === null || head === null)
    return { ok: false, reason: "invalid-expectation" };
  const closure = parseOhDependencyClosureV1(value);
  if (closure === null)
    return { ok: false, reason: "invalid-closure" };
  if (closure.binding.bindingSha256 !== binding.bindingSha256)
    return { ok: false, reason: "binding-mismatch" };
  if (canonicalJson(closure.head) !== canonicalJson(head))
    return { ok: false, reason: "head-mismatch" };
  return { closure, ok: true, verification: "expected-authority-and-head" };
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

// src/memory.ts
import { createHmac, randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";

// src/memory-pages.ts
var OH_MEMORY_PAGE_FORMAT_V1 = "oh.memory-page.v1";
var OH_MEMORY_PAGE_MARKDOWN_EXTENSION_V1 = ".oh.md";
var OH_MEMORY_PAGE_LIMITS_V1 = Object.freeze({
  bodyBytes: 512 * 1024,
  fileBytes: 1024 * 1024,
  frontmatterLines: 18 + OH_GRAPH_LIMITS_V1.dependenciesPerRecord + 5 * 128,
  languageBytes: 255,
  sourceTitleBytes: 1024,
  sourceUrlBytes: 4096,
  sources: 128,
  summaryBytes: 8192,
  titleBytes: 512,
  valueBytes: 768 * 1024
});
function singleLineText(value, maximumBytes) {
  const parsed = boundedText(value, maximumBytes);
  return parsed !== null && !/[\r\n\u0085\u2028\u2029]/u.test(parsed) ? parsed : null;
}
function exactDataRecord(value, keys) {
  try {
    if (!isPlainRecord(value))
      return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string") || keys.some((key) => !ownKeys.includes(key)))
      return null;
    const detached = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined)
        return null;
      detached[key] = descriptor.value;
    }
    return detached;
  } catch {
    return null;
  }
}
function exactDataArray(value, maximumLength) {
  try {
    if (!Array.isArray(value))
      return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maximumLength)
      return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || ownKeys.some((key) => typeof key !== "string") || !ownKeys.includes("length"))
      return null;
    const detached = [];
    for (let index = 0;index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined)
        return null;
      detached.push(descriptor.value);
    }
    return detached;
  } catch {
    return null;
  }
}
function parseLanguage(value) {
  if (value === null)
    return null;
  return typeof value === "string" && utf8ByteLength(value) <= OH_MEMORY_PAGE_LIMITS_V1.languageBytes && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(value) ? value : undefined;
}
function parseCanonicalSourceUrl(value) {
  if (typeof value !== "string" || value.normalize("NFC") !== value || utf8ByteLength(value) > OH_MEMORY_PAGE_LIMITS_V1.sourceUrlBytes)
    return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:" || url.username !== "" || url.password !== "" || url.href !== value)
      return null;
    for (let index = value.indexOf("%");index >= 0; index = value.indexOf("%", index + 3)) {
      const encoded = value.slice(index + 1, index + 3);
      if (!/^[0-9A-F]{2}$/u.test(encoded))
        return null;
      const decoded = String.fromCharCode(Number.parseInt(encoded, 16));
      if (/^[A-Za-z0-9._~-]$/u.test(decoded))
        return null;
    }
    return value;
  } catch {
    return null;
  }
}
function parseSource(value) {
  const source = exactDataRecord(value, ["contentSha256", "observedAt", "title", "url", "v"]);
  if (source === null || source.v !== 1)
    return null;
  const contentSha256 = parseSha256Hex(source.contentSha256);
  const observedAt = parseCanonicalInstantV1(source.observedAt);
  const title = singleLineText(source.title, OH_MEMORY_PAGE_LIMITS_V1.sourceTitleBytes);
  const url = parseCanonicalSourceUrl(source.url);
  return contentSha256 !== null && observedAt !== null && title !== null && url !== null ? { contentSha256, observedAt, title, url, v: 1 } : null;
}
function parseProvenance(value) {
  const provenance = exactDataRecord(value, ["actorId", "attestationSha256", "attestedAt", "kind", "v"]);
  if (provenance === null || provenance.kind !== "host-attested" || provenance.v !== 1)
    return null;
  const actorId = safeCode(provenance.actorId);
  const attestationSha256 = parseSha256Hex(provenance.attestationSha256);
  const attestedAt = parseCanonicalInstantV1(provenance.attestedAt);
  return actorId !== null && attestationSha256 !== null && attestedAt !== null ? { actorId, attestationSha256, attestedAt, kind: "host-attested", v: 1 } : null;
}
function parseOhMemoryPageValueV1(value) {
  const page = exactDataRecord(value, [
    "body",
    "createdAt",
    "format",
    "language",
    "provenance",
    "sources",
    "summary",
    "title",
    "updatedAt",
    "v"
  ]);
  if (page === null || page.format !== OH_MEMORY_PAGE_FORMAT_V1 || page.v !== 1)
    return null;
  const sourceValues = exactDataArray(page.sources, OH_MEMORY_PAGE_LIMITS_V1.sources);
  if (sourceValues === null)
    return null;
  const body = boundedText(page.body, OH_MEMORY_PAGE_LIMITS_V1.bodyBytes);
  const createdAt = parseCanonicalInstantV1(page.createdAt);
  const language = parseLanguage(page.language);
  const provenance = parseProvenance(page.provenance);
  const sources = sourceValues.map(parseSource);
  const summary = boundedText(page.summary, OH_MEMORY_PAGE_LIMITS_V1.summaryBytes);
  const title = singleLineText(page.title, OH_MEMORY_PAGE_LIMITS_V1.titleBytes);
  const updatedAt = parseCanonicalInstantV1(page.updatedAt);
  if (body === null || createdAt === null || language === undefined || provenance === null || sources.some((source) => source === null) || summary === null || title === null || updatedAt === null) {
    return null;
  }
  const parsedSources = sources;
  if (!orderedUnique(parsedSources, (source) => source.url) || Date.parse(createdAt) > Date.parse(updatedAt) || Date.parse(updatedAt) > Date.parse(provenance.attestedAt) || parsedSources.some((source) => Date.parse(source.observedAt) > Date.parse(updatedAt)))
    return null;
  const parsed = {
    body,
    createdAt,
    format: OH_MEMORY_PAGE_FORMAT_V1,
    language,
    provenance,
    sources: parsedSources,
    summary,
    title,
    updatedAt,
    v: 1
  };
  return utf8ByteLength(canonicalJson(parsed)) <= OH_MEMORY_PAGE_LIMITS_V1.valueBytes ? parsed : null;
}
function createOhMemoryPageValueV1(value) {
  const parsed = parseOhMemoryPageValueV1(value);
  if (parsed === null)
    throw new TypeError("Invalid Oh memory page value.");
  return parsed;
}
function createOhMemoryPageRecordV1(input) {
  const parsedInput = exactDataRecord(input, ["dependencies", "key", "value"]);
  if (parsedInput === null) {
    throw new TypeError("Invalid Oh memory page record input.");
  }
  const value = createOhMemoryPageValueV1(parsedInput.value);
  const record = createKnowledgeGraphRecordV1({
    dependencies: parsedInput.dependencies,
    key: parsedInput.key,
    kind: "edition",
    v: 1,
    value
  });
  return { ...record, kind: "edition", value };
}
function parseOhMemoryPageRecordV1(value) {
  const envelope = exactDataRecord(value, [
    "dependencies",
    "key",
    "kind",
    "recordSha256",
    "v",
    "value"
  ]);
  if (envelope === null)
    return null;
  const record = parseKnowledgeGraphRecordV1(envelope);
  if (record === null || record.kind !== "edition")
    return null;
  const page = parseOhMemoryPageValueV1(record.value);
  return page === null ? null : { ...record, kind: "edition", value: page };
}
var OH_MEMORY_PAGE_RECORD_CODEC_V1 = Object.freeze({
  kind: "edition",
  parse(value) {
    return parseOhMemoryPageValueV1(value);
  }
});
function scalar(value) {
  return JSON.stringify(value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}
function dependencyPrefix(index) {
  return `dependency-${index.toString().padStart(4, "0")}`;
}
function sourcePrefix(index) {
  return `source-${index.toString().padStart(3, "0")}`;
}
function markdownEntries(record) {
  const page = record.value;
  const entries = [
    ["format", page.format],
    ["record-v", record.v],
    ["record-kind", record.kind],
    ["record-key", record.key],
    ["record-sha256", record.recordSha256],
    ["dependency-count", record.dependencies.length]
  ];
  record.dependencies.forEach((dependency, index) => {
    entries.push([`${dependencyPrefix(index)}-key`, dependency]);
  });
  entries.push(["page-v", page.v], ["title", page.title], ["summary", page.summary], ["language", page.language], ["created-at", page.createdAt], ["updated-at", page.updatedAt], ["provenance-kind", page.provenance.kind], ["provenance-v", page.provenance.v], ["provenance-actor-id", page.provenance.actorId], ["provenance-attested-at", page.provenance.attestedAt], ["provenance-attestation-sha256", page.provenance.attestationSha256], ["source-count", page.sources.length]);
  page.sources.forEach((source, index) => {
    const prefix = sourcePrefix(index);
    entries.push([`${prefix}-v`, source.v], [`${prefix}-url`, source.url], [`${prefix}-title`, source.title], [`${prefix}-observed-at`, source.observedAt], [`${prefix}-content-sha256`, source.contentSha256]);
  });
  return entries;
}
function renderOhMemoryPageMarkdownV1(value) {
  const record = parseOhMemoryPageRecordV1(value);
  if (record === null)
    throw new TypeError("Invalid Oh memory page record.");
  const frontmatter = markdownEntries(record).map(([key, item]) => `${key}: ${scalar(item)}`).join(`
`);
  const rendered = `---
${frontmatter}
---
${record.value.body}`;
  if (utf8ByteLength(rendered) > OH_MEMORY_PAGE_LIMITS_V1.fileBytes) {
    throw new RangeError("Oh memory page Markdown exceeds its byte limit.");
  }
  return rendered;
}
function parseFrontmatterLine(line) {
  const separator = line.indexOf(": ");
  if (separator < 1 || !/^[a-z][a-z0-9-]*$/u.test(line.slice(0, separator)))
    return null;
  const key = line.slice(0, separator);
  const encoded = line.slice(separator + 2);
  let value;
  try {
    value = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (value !== null && typeof value !== "string" && typeof value !== "number" || typeof value === "number" && !Number.isFinite(value) || scalar(value) !== encoded)
    return null;
  return [key, value];
}
function parseOhMemoryPageMarkdownV1(text) {
  if (typeof text !== "string" || utf8ByteLength(text) > OH_MEMORY_PAGE_LIMITS_V1.fileBytes || !text.startsWith(`---
`))
    return null;
  const closing = text.indexOf(`
---
`, 4);
  if (closing < 0)
    return null;
  const frontmatter = text.slice(4, closing);
  let frontmatterLines = 1;
  for (let index = frontmatter.indexOf(`
`);index >= 0; index = frontmatter.indexOf(`
`, index + 1)) {
    frontmatterLines += 1;
    if (frontmatterLines > OH_MEMORY_PAGE_LIMITS_V1.frontmatterLines)
      return null;
  }
  const lines = frontmatter.split(`
`);
  const entries = lines.map(parseFrontmatterLine);
  if (entries.some((entry) => entry === null) || entries.length < 18)
    return null;
  const parsedEntries = entries;
  const dependencyCount = parsedEntries[5]?.[1];
  if (!Number.isSafeInteger(dependencyCount) || dependencyCount < 0 || dependencyCount > OH_GRAPH_LIMITS_V1.dependenciesPerRecord)
    return null;
  const pageOffset = 6 + dependencyCount;
  const sourceCount = parsedEntries[pageOffset + 11]?.[1];
  if (!Number.isSafeInteger(sourceCount) || sourceCount < 0 || sourceCount > OH_MEMORY_PAGE_LIMITS_V1.sources)
    return null;
  const expectedKeys = [
    "format",
    "record-v",
    "record-kind",
    "record-key",
    "record-sha256",
    "dependency-count",
    ...Array.from({ length: dependencyCount }, (_, index) => `${dependencyPrefix(index)}-key`),
    "page-v",
    "title",
    "summary",
    "language",
    "created-at",
    "updated-at",
    "provenance-kind",
    "provenance-v",
    "provenance-actor-id",
    "provenance-attested-at",
    "provenance-attestation-sha256",
    "source-count",
    ...Array.from({ length: sourceCount }, (_, index) => {
      const prefix = sourcePrefix(index);
      return [
        `${prefix}-v`,
        `${prefix}-url`,
        `${prefix}-title`,
        `${prefix}-observed-at`,
        `${prefix}-content-sha256`
      ];
    }).flat()
  ];
  if (parsedEntries.length !== expectedKeys.length || parsedEntries.some(([key], index) => key !== expectedKeys[index]))
    return null;
  const dependencies = Array.from({ length: dependencyCount }, (_, index) => parsedEntries[6 + index]?.[1]);
  const sources = [];
  for (let index = 0;index < sourceCount; index += 1) {
    const offset = pageOffset + 12 + index * 5;
    sources.push({
      v: parsedEntries[offset]?.[1],
      url: parsedEntries[offset + 1]?.[1],
      title: parsedEntries[offset + 2]?.[1],
      observedAt: parsedEntries[offset + 3]?.[1],
      contentSha256: parsedEntries[offset + 4]?.[1]
    });
  }
  const page = parseOhMemoryPageValueV1({
    body: text.slice(closing + 5),
    createdAt: parsedEntries[pageOffset + 4]?.[1],
    format: parsedEntries[0]?.[1],
    language: parsedEntries[pageOffset + 3]?.[1],
    provenance: {
      actorId: parsedEntries[pageOffset + 8]?.[1],
      attestationSha256: parsedEntries[pageOffset + 10]?.[1],
      attestedAt: parsedEntries[pageOffset + 9]?.[1],
      kind: parsedEntries[pageOffset + 6]?.[1],
      v: parsedEntries[pageOffset + 7]?.[1]
    },
    sources,
    summary: parsedEntries[pageOffset + 2]?.[1],
    title: parsedEntries[pageOffset + 1]?.[1],
    updatedAt: parsedEntries[pageOffset + 5]?.[1],
    v: parsedEntries[pageOffset]?.[1]
  });
  if (page === null || parsedEntries[1]?.[1] !== 1 || parsedEntries[2]?.[1] !== "edition" || typeof parsedEntries[3]?.[1] !== "string" || typeof parsedEntries[4]?.[1] !== "string" || dependencies.some((dependency) => typeof dependency !== "string"))
    return null;
  let record;
  try {
    record = createOhMemoryPageRecordV1({
      dependencies,
      key: parsedEntries[3][1],
      value: page
    });
  } catch {
    return null;
  }
  return record.recordSha256 === parsedEntries[4][1] && renderOhMemoryPageMarkdownV1(record) === text ? record : null;
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
  resultBytes: 16 * 1024 * 1024,
  rounds: 1024,
  rules: 1024,
  sourcesPerFact: 64,
  totalProofNodes: 65536,
  variables: 256,
  workUnits: 16777216
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
  const engine = safeCode(input.engine ?? OH_PROJECTION_INTERNAL_ENGINE_V1, 256);
  if (engine === null)
    throw new TypeError("Invalid projection engine identity.");
  const evaluation = { ...resolveEvaluationOptions(input.options ?? {}), v: 1 };
  const payload = {
    contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    datasetSha256: dataset.datasetSha256,
    engineSha256: canonicalSha256({ engine, v: 1 }),
    evaluationSha256: canonicalSha256(evaluation),
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
    "engineSha256",
    "evaluationSha256",
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
  const engineSha256 = parseSha256Hex(value.engineSha256);
  const evaluationSha256 = parseSha256Hex(value.evaluationSha256);
  const projectionSha256 = parseSha256Hex(value.projectionSha256);
  const querySha256 = parseSha256Hex(value.querySha256);
  const rulePackSha256 = parseSha256Hex(value.rulePackSha256);
  const snapshotSha256 = parseSha256Hex(value.snapshotSha256);
  if (contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256 || datasetSha256 === null || engineSha256 === null || evaluationSha256 === null || projectionSha256 === null || querySha256 === null || rulePackSha256 === null || snapshotSha256 === null)
    return null;
  const payload = {
    contractSha256,
    datasetSha256,
    engineSha256,
    evaluationSha256,
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
  if (parsedPrevious.engineSha256 !== parsedNext.engineSha256)
    reasons.push("engine-changed");
  if (parsedPrevious.evaluationSha256 !== parsedNext.evaluationSha256)
    reasons.push("evaluation-changed");
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
function consumeWorkUnit(budget) {
  if (budget.units >= budget.maximum)
    throw new RangeError("Projection exceeds its work-unit bound.");
  budget.units += 1;
}
function matchBody(relations, body, maximumMatches, work) {
  let matches = [{ binding: new Map, premises: [] }];
  for (const literal of body) {
    const next = [];
    const candidates = relationTuples(relations, literal.relation);
    for (const match of matches) {
      for (const candidate of candidates) {
        consumeWorkUnit(work);
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
      for (const match of matchBody(relations, rule.body, OH_PROJECTION_LIMITS_V1.queryMatches, input.work)) {
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
  const resolved = {
    maximumDerivedTuples: boundedOption(options.maximumDerivedTuples, OH_PROJECTION_LIMITS_V1.derivedTuples, OH_PROJECTION_LIMITS_V1.derivedTuples, "maximumDerivedTuples"),
    maximumProofDepth: boundedOption(options.maximumProofDepth, 32, OH_PROJECTION_LIMITS_V1.proofDepth, "maximumProofDepth"),
    maximumProofNodes: boundedOption(options.maximumProofNodes, 1024, OH_PROJECTION_LIMITS_V1.proofNodes, "maximumProofNodes"),
    maximumResultBytes: boundedOption(options.maximumResultBytes, OH_PROJECTION_LIMITS_V1.resultBytes, OH_PROJECTION_LIMITS_V1.resultBytes, "maximumResultBytes"),
    maximumRounds: boundedOption(options.maximumRounds, OH_PROJECTION_LIMITS_V1.rounds, OH_PROJECTION_LIMITS_V1.rounds, "maximumRounds"),
    maximumTotalProofNodes: boundedOption(options.maximumTotalProofNodes, OH_PROJECTION_LIMITS_V1.totalProofNodes, OH_PROJECTION_LIMITS_V1.totalProofNodes, "maximumTotalProofNodes"),
    maximumWorkUnits: boundedOption(options.maximumWorkUnits, OH_PROJECTION_LIMITS_V1.workUnits, OH_PROJECTION_LIMITS_V1.workUnits, "maximumWorkUnits")
  };
  if (resolved.maximumResultBytes < 64 * 1024) {
    throw new RangeError("maximumResultBytes must be at least 65536.");
  }
  return resolved;
}
function reserveResultBytes(budget, value) {
  const bytes = utf8ByteLength(canonicalJson(value));
  if (budget.bytes + bytes > budget.maximumBytes)
    return false;
  budget.bytes += bytes;
  return true;
}
function reserveProofNode(budget, options, envelope) {
  if (budget.nodes >= options.maximumProofNodes || budget.result.nodes >= options.maximumTotalProofNodes || !reserveResultBytes(budget.result, envelope))
    return false;
  budget.nodes += 1;
  budget.result.nodes += 1;
  return true;
}
function proofForReference(relations, reference, budget, options, depth, visiting) {
  if (depth >= options.maximumProofDepth) {
    const proof = {
      kind: "truncated",
      reason: "depth",
      relation: reference.relation,
      tuple: reference.tuple,
      v: 1
    };
    return reserveProofNode(budget, options, proof) ? proof : null;
  }
  const identity = referenceKey(reference);
  if (visiting.has(identity)) {
    const proof = {
      kind: "truncated",
      reason: "cycle",
      relation: reference.relation,
      tuple: reference.tuple,
      v: 1
    };
    return reserveProofNode(budget, options, proof) ? proof : null;
  }
  const state = relations.get(reference.relation)?.get(tupleKey(reference.tuple));
  if (state === undefined)
    throw new Error("Projection proof references a tuple outside the materialized result.");
  if (state.witness.kind === "fact") {
    const proof = {
      kind: "fact",
      relation: reference.relation,
      sources: state.witness.sources,
      tuple: reference.tuple,
      v: 1
    };
    return reserveProofNode(budget, options, proof) ? proof : null;
  }
  const envelope = {
    kind: "derived",
    premises: [],
    premisesTruncated: false,
    relation: reference.relation,
    ruleId: state.witness.rule.ruleId,
    ruleSha256: state.witness.rule.ruleSha256,
    tuple: reference.tuple,
    v: 1
  };
  if (!reserveProofNode(budget, options, envelope))
    return null;
  visiting.add(identity);
  try {
    const premises = [];
    let premisesTruncated = false;
    for (const premise of state.witness.premises) {
      const proof = proofForReference(relations, premise, budget, options, depth + 1, visiting);
      if (proof === null) {
        premisesTruncated = true;
        break;
      }
      premises.push(proof);
    }
    return {
      kind: "derived",
      premises,
      premisesTruncated,
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
function proofIsTruncated(proof) {
  return proof.kind === "truncated" || proof.kind === "derived" && (proof.premisesTruncated || proof.premises.some(proofIsTruncated));
}
function reserveProjectionParseBytes(budget, value) {
  const bytes = utf8ByteLength(canonicalJson(value));
  if (budget.bytes + bytes > budget.maximumBytes)
    return false;
  budget.bytes += bytes;
  return true;
}
function parseProjectionFactSource(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["key", "recordSha256", "v"]) || value.v !== 1) {
    return null;
  }
  const key = safeCode(value.key, 512);
  const recordSha256 = parseSha256Hex(value.recordSha256);
  return key === null || recordSha256 === null ? null : { key, recordSha256, v: 1 };
}
function parseProjectionProofWithBudget(value, budget, depth) {
  if (depth > budget.maximumDepth || budget.nodes >= budget.maximumNodes || !isPlainRecord(value) || value.v !== 1)
    return null;
  const relation = projectionName(value.relation);
  const parsedTuple = tuple(value.tuple);
  if (relation === null || parsedTuple === null)
    return null;
  if (value.kind === "fact") {
    if (!hasExactKeys(value, ["kind", "relation", "sources", "tuple", "v"]) || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > OH_PROJECTION_LIMITS_V1.sourcesPerFact)
      return null;
    const sources = value.sources.map(parseProjectionFactSource);
    if (sources.some((source) => source === null))
      return null;
    const parsedSources = sources;
    if (!orderedUnique(parsedSources, (source) => source.key))
      return null;
    const proof = {
      kind: "fact",
      relation,
      sources: parsedSources,
      tuple: parsedTuple,
      v: 1
    };
    if (!reserveProjectionParseBytes(budget, proof))
      return null;
    budget.nodes += 1;
    return proof;
  }
  if (value.kind === "truncated") {
    if (!hasExactKeys(value, ["kind", "reason", "relation", "tuple", "v"]) || value.reason !== "cycle" && value.reason !== "depth" && value.reason !== "nodes")
      return null;
    const reason = value.reason;
    const proof = {
      kind: "truncated",
      reason,
      relation,
      tuple: parsedTuple,
      v: 1
    };
    if (!reserveProjectionParseBytes(budget, proof))
      return null;
    budget.nodes += 1;
    return proof;
  }
  if (value.kind !== "derived" || !hasExactKeys(value, [
    "kind",
    "premises",
    "premisesTruncated",
    "relation",
    "ruleId",
    "ruleSha256",
    "tuple",
    "v"
  ]) || !Array.isArray(value.premises) || value.premises.length > OH_PROJECTION_LIMITS_V1.literalsPerRule || typeof value.premisesTruncated !== "boolean")
    return null;
  const ruleId = projectionName(value.ruleId);
  const ruleSha256 = parseSha256Hex(value.ruleSha256);
  if (ruleId === null || ruleSha256 === null || !value.premisesTruncated && value.premises.length === 0 || value.premisesTruncated && value.premises.length === OH_PROJECTION_LIMITS_V1.literalsPerRule) {
    return null;
  }
  const skeleton = {
    kind: "derived",
    premises: [],
    premisesTruncated: value.premisesTruncated,
    relation,
    ruleId,
    ruleSha256,
    tuple: parsedTuple,
    v: 1
  };
  if (!reserveProjectionParseBytes(budget, skeleton))
    return null;
  budget.nodes += 1;
  const premises = [];
  for (const premise of value.premises) {
    const parsed = parseProjectionProofWithBudget(premise, budget, depth + 1);
    if (parsed === null)
      return null;
    premises.push(parsed);
  }
  return { ...skeleton, premises };
}
function parseOhProjectionProofV1(value) {
  try {
    const budget = {
      bytes: 0,
      maximumBytes: OH_PROJECTION_LIMITS_V1.resultBytes,
      maximumDepth: OH_PROJECTION_LIMITS_V1.proofDepth,
      maximumNodes: OH_PROJECTION_LIMITS_V1.proofNodes,
      nodes: 0
    };
    const proof = parseProjectionProofWithBudget(value, budget, 0);
    return proof !== null && utf8ByteLength(canonicalJson(proof)) <= budget.maximumBytes ? proof : null;
  } catch {
    return null;
  }
}
function parseProjectionEvaluation(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "maximumDerivedTuples",
    "maximumProofDepth",
    "maximumProofNodes",
    "maximumResultBytes",
    "maximumRounds",
    "maximumTotalProofNodes",
    "maximumWorkUnits",
    "v"
  ]) || value.v !== 1)
    return null;
  const maximumDerivedTuples = positiveInteger(value.maximumDerivedTuples, OH_PROJECTION_LIMITS_V1.derivedTuples);
  const maximumProofDepth = positiveInteger(value.maximumProofDepth, OH_PROJECTION_LIMITS_V1.proofDepth);
  const maximumProofNodes = positiveInteger(value.maximumProofNodes, OH_PROJECTION_LIMITS_V1.proofNodes);
  const maximumResultBytes = positiveInteger(value.maximumResultBytes, OH_PROJECTION_LIMITS_V1.resultBytes);
  const maximumRounds = positiveInteger(value.maximumRounds, OH_PROJECTION_LIMITS_V1.rounds);
  const maximumTotalProofNodes = positiveInteger(value.maximumTotalProofNodes, OH_PROJECTION_LIMITS_V1.totalProofNodes);
  const maximumWorkUnits = positiveInteger(value.maximumWorkUnits, OH_PROJECTION_LIMITS_V1.workUnits);
  if (maximumDerivedTuples === null || maximumProofDepth === null || maximumProofNodes === null || maximumResultBytes === null || maximumResultBytes < 64 * 1024 || maximumRounds === null || maximumTotalProofNodes === null || maximumWorkUnits === null)
    return null;
  return {
    maximumDerivedTuples,
    maximumProofDepth,
    maximumProofNodes,
    maximumResultBytes,
    maximumRounds,
    maximumTotalProofNodes,
    maximumWorkUnits,
    v: 1
  };
}
function parseProjectionResultRow(value, evaluation, resultBudget) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["proofs", "proofsTruncated", "supportCount", "values", "v"]) || value.v !== 1 || !Array.isArray(value.proofs) || value.proofs.length > OH_PROJECTION_LIMITS_V1.queryLiterals || typeof value.proofsTruncated !== "boolean")
    return null;
  const values = tuple(value.values);
  const supportCount = positiveInteger(value.supportCount, OH_PROJECTION_LIMITS_V1.queryMatches);
  if (values === null || supportCount === null || !value.proofsTruncated && value.proofs.length === 0)
    return null;
  if (!reserveProjectionParseBytes(resultBudget, {
    proofs: [],
    proofsTruncated: value.proofsTruncated,
    supportCount,
    values,
    v: 1
  }))
    return null;
  const before = resultBudget.nodes;
  resultBudget.maximumNodes = Math.min(resultBudget.maximumNodes, before + evaluation.maximumProofNodes);
  const proofs = [];
  for (const proof of value.proofs) {
    const parsed = parseProjectionProofWithBudget(proof, resultBudget, 0);
    if (parsed === null)
      return null;
    proofs.push(parsed);
  }
  resultBudget.maximumNodes = evaluation.maximumTotalProofNodes;
  const containsTruncation = proofs.some(proofIsTruncated);
  if (!value.proofsTruncated && containsTruncation || value.proofsTruncated && proofs.length === OH_PROJECTION_LIMITS_V1.queryLiterals && !containsTruncation)
    return null;
  return {
    nodes: resultBudget.nodes - before,
    row: { proofs, proofsTruncated: value.proofsTruncated, supportCount, values, v: 1 }
  };
}
function parseOhProjectionResultV1(value, expectedProjectionSha256) {
  try {
    if (!isPlainRecord(value) || !hasExactKeys(value, [
      "authority",
      "cache",
      "engine",
      "evaluation",
      "identity",
      "resultSha256",
      "rows",
      "stats",
      "v"
    ]) || value.v !== 1 || value.authority !== "derived" || !isPlainRecord(value.cache) || !hasExactKeys(value.cache, ["strategy", "v"]) || value.cache.strategy !== "full-rebuild" || value.cache.v !== 1 || !Array.isArray(value.rows) || value.rows.length > OH_PROJECTION_LIMITS_V1.queryResults || !isPlainRecord(value.stats) || !hasExactKeys(value.stats, [
      "baseFacts",
      "derivedFacts",
      "proofNodes",
      "proofsTruncated",
      "queryMatches",
      "relations",
      "rounds",
      "truncated",
      "truncationReasons",
      "v",
      "workUnits"
    ]) || value.stats.v !== 1 || !Array.isArray(value.stats.truncationReasons) || typeof value.stats.proofsTruncated !== "boolean" || typeof value.stats.truncated !== "boolean")
      return null;
    const engine = safeCode(value.engine, 256);
    const evaluation = parseProjectionEvaluation(value.evaluation);
    const identity = parseOhProjectionIdentityV1(value.identity);
    const resultSha256 = parseSha256Hex(value.resultSha256);
    const expected = expectedProjectionSha256 === undefined ? undefined : parseSha256Hex(expectedProjectionSha256);
    if (engine === null || evaluation === null || identity === null || resultSha256 === null || expectedProjectionSha256 !== undefined && expected === null || expected !== undefined && identity.projectionSha256 !== expected || identity.engineSha256 !== canonicalSha256({ engine, v: 1 }) || identity.evaluationSha256 !== canonicalSha256(evaluation))
      return null;
    const baseFacts = nonnegativeInteger(value.stats.baseFacts);
    const derivedFacts = nonnegativeInteger(value.stats.derivedFacts);
    const proofNodes = nonnegativeInteger(value.stats.proofNodes);
    const queryMatches = nonnegativeInteger(value.stats.queryMatches);
    const relations = nonnegativeInteger(value.stats.relations);
    const rounds = nonnegativeInteger(value.stats.rounds);
    const workUnits = nonnegativeInteger(value.stats.workUnits);
    if (baseFacts === null || baseFacts > OH_PROJECTION_LIMITS_V1.facts || derivedFacts === null || derivedFacts > evaluation.maximumDerivedTuples || proofNodes === null || proofNodes > evaluation.maximumTotalProofNodes || queryMatches === null || queryMatches > OH_PROJECTION_LIMITS_V1.queryMatches || relations === null || relations > OH_PROJECTION_LIMITS_V1.relations || rounds === null || rounds > evaluation.maximumRounds || workUnits === null || workUnits > evaluation.maximumWorkUnits || relations > baseFacts + derivedFacts || rounds > derivedFacts || rounds === 0 !== (derivedFacts === 0) || queryMatches > workUnits)
      return null;
    const truncationReasons = value.stats.truncationReasons;
    if (truncationReasons.length > 2 || !orderedUnique(truncationReasons, (reason) => reason === "query-limit" ? "0" : reason === "result-bytes" ? "1" : "x") || truncationReasons.some((reason) => reason !== "query-limit" && reason !== "result-bytes") || value.stats.truncated !== truncationReasons.length > 0)
      return null;
    const budget = {
      bytes: 0,
      maximumBytes: evaluation.maximumResultBytes,
      maximumDepth: evaluation.maximumProofDepth,
      maximumNodes: evaluation.maximumTotalProofNodes,
      nodes: 0
    };
    const rows = [];
    let supportCount = 0;
    for (const row of value.rows) {
      const parsed = parseProjectionResultRow(row, evaluation, budget);
      if (parsed === null)
        return null;
      rows.push(parsed.row);
      supportCount += parsed.row.supportCount;
      if (supportCount > queryMatches)
        return null;
    }
    if (!orderedUnique(rows, (row) => canonicalJson(row.values)) || budget.nodes !== proofNodes || value.stats.proofsTruncated !== rows.some((row) => row.proofsTruncated) || (value.stats.truncated ? supportCount >= queryMatches : supportCount !== queryMatches))
      return null;
    const reasons = truncationReasons;
    const payload = {
      authority: "derived",
      cache: { strategy: "full-rebuild", v: 1 },
      engine,
      evaluation,
      identity,
      rows,
      stats: {
        baseFacts,
        derivedFacts,
        proofNodes,
        proofsTruncated: value.stats.proofsTruncated,
        queryMatches,
        relations,
        rounds,
        truncated: value.stats.truncated,
        truncationReasons: reasons,
        v: 1,
        workUnits
      },
      v: 1
    };
    const serialized = canonicalJson(payload);
    return utf8ByteLength(serialized) <= evaluation.maximumResultBytes && sha256Hex(serialized) === resultSha256 ? { ...payload, resultSha256 } : null;
  } catch {
    return null;
  }
}
function buildProjectionResult(input) {
  const matches = matchBody(input.materialized.relations, input.query.where, OH_PROJECTION_LIMITS_V1.queryMatches, input.work);
  const byValues = new Map;
  for (const match of matches) {
    const values = input.query.find.map((name) => match.binding.get(name));
    const key = tupleKey(values);
    const existing = byValues.get(key);
    if (existing === undefined)
      byValues.set(key, { match, supportCount: 1 });
    else
      byValues.set(key, { match: compareCanonical(match.premises, existing.match.premises) < 0 ? match : existing.match, supportCount: existing.supportCount + 1 });
  }
  const ordered = [...byValues.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const resultBudget = {
    bytes: 0,
    maximumBytes: input.options.maximumResultBytes - 64 * 1024,
    nodes: 0
  };
  const rows = [];
  let resultBytesTruncated = false;
  for (const [key, support] of ordered.slice(0, input.query.limit)) {
    const values = JSON.parse(key);
    if (!reserveResultBytes(resultBudget, {
      proofs: [],
      proofsTruncated: false,
      supportCount: support.supportCount,
      values,
      v: 1
    })) {
      resultBytesTruncated = true;
      break;
    }
    const budget = { nodes: 0, result: resultBudget };
    const proofs = [];
    for (const premise of support.match.premises) {
      const proof = proofForReference(input.materialized.relations, premise, budget, input.options, 0, new Set);
      if (proof === null)
        break;
      proofs.push(proof);
    }
    const proofsTruncated = proofs.length !== support.match.premises.length || proofs.some(proofIsTruncated);
    rows.push({ proofs, proofsTruncated, supportCount: support.supportCount, values, v: 1 });
  }
  const queryLimitTruncated = ordered.length > input.query.limit;
  const truncationReasons = [
    ...queryLimitTruncated ? ["query-limit"] : [],
    ...resultBytesTruncated ? ["result-bytes"] : []
  ];
  const truncated = truncationReasons.length > 0;
  const identity = createOhProjectionIdentityV1({
    dataset: input.dataset,
    query: input.query,
    engine: input.engine,
    options: input.options,
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
      proofNodes: resultBudget.nodes,
      proofsTruncated: rows.some((row) => row.proofsTruncated),
      queryMatches: matches.length,
      relations: input.materialized.relations.size,
      rounds: input.materialized.rounds,
      truncated,
      truncationReasons,
      v: 1,
      workUnits: input.work.units
    },
    v: 1
  };
  const serialized = canonicalJson(payload);
  if (utf8ByteLength(serialized) > input.options.maximumResultBytes) {
    throw new RangeError("Projection result exceeds its canonical byte bound.");
  }
  return { ...payload, resultSha256: sha256Hex(serialized) };
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
  const work = { maximum: options.maximumWorkUnits, units: 0 };
  const materialized = materializeNaive({
    dataset,
    maximumDerivedTuples: options.maximumDerivedTuples,
    maximumRounds: options.maximumRounds,
    rulePack,
    work
  });
  return buildProjectionResult({
    dataset,
    engine: OH_PROJECTION_INTERNAL_ENGINE_V1,
    materialized,
    options,
    query,
    rulePack,
    snapshot,
    work
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
  const work = { maximum: options.maximumWorkUnits, units: 0 };
  const witnessMaterialization = materializeNaive({
    dataset,
    maximumDerivedTuples: options.maximumDerivedTuples,
    maximumRounds: options.maximumRounds,
    rulePack,
    work
  });
  const external = input.materialize({
    dataset,
    maximumDerivedTuples: options.maximumDerivedTuples,
    maximumRounds: options.maximumRounds,
    query,
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
    snapshot,
    work
  });
}
function createOhProjectionRecordFactsV1(records, options = {}) {
  if (records.length > OH_GRAPH_LIMITS_V1.recordsPerSnapshot)
    throw new RangeError("Too many records for projection facts.");
  const parsedRecords = [...records].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map((candidate) => {
    const record = parseKnowledgeGraphRecordV1(candidate);
    if (record === null)
      throw new TypeError("Invalid graph record for projection facts.");
    return record;
  });
  let projectedFactCount = 0;
  for (const record of parsedRecords) {
    if (options.includeRecords !== false)
      projectedFactCount += 1;
    if (options.includeDependencies !== false)
      projectedFactCount += record.dependencies.length;
    if (projectedFactCount > OH_PROJECTION_LIMITS_V1.facts) {
      throw new RangeError("Structural projection exceeds its fact bound.");
    }
  }
  const facts = [];
  for (const record of parsedRecords) {
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

// src/memory.ts
var OH_MEMORY_FORMAT_VERSION_V1 = 1;
var OH_MEMORY_CONFLICT_POLICY_V1 = "visible-conflicts.v1";
var OH_MEMORY_LIMITS_V1 = Object.freeze({
  explainCapabilityEntryBytes: 32 * 1024 * 1024,
  explainCapabilities: 256,
  explainCapabilityLifetimeMs: 15 * 60 * 1000,
  explainCapabilityTotalBytes: 64 * 1024 * 1024,
  factsPerRecordPerExtractor: 512,
  maximumExtractorInvocations: 262144,
  maximumExtractors: 32,
  maximumNominationRoutes: 64,
  maximumPrograms: 128,
  maximumRecordsPerLane: 8192,
  maximumSyntheticRecords: 16384,
  rememberBytes: 8 * 1024 * 1024,
  resultBytes: 32 * 1024 * 1024,
  snapshotBytesPerLane: 32 * 1024 * 1024,
  relationsPerExtractor: 64
});
var memoryFactPackPayload = Object.freeze({
  factPackId: "oh.memory.composite-facts",
  factPackRevision: 1,
  relations: Object.freeze(["memory.agreement", "memory.conflict", "memory.dependency", "memory.record"]),
  semantics: OH_PROJECTION_SEMANTICS_V1,
  v: 1
});
var OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1 = Object.freeze({
  ...memoryFactPackPayload,
  extractorSha256: canonicalSha256(memoryFactPackPayload)
});
var OH_MEMORY_QUERY_LIMITS_V2 = Object.freeze({
  bindingBytes: 64 * 1024,
  bindings: 32,
  continuationBytes: 4 * 1024,
  continuationKeyMaximumBytes: 64,
  continuationKeyMinimumBytes: 32,
  maximumPageBytes: 8 * 1024 * 1024,
  maximumPageRows: 256,
  maximumProgramRows: OH_PROJECTION_LIMITS_V1.queryResults,
  minimumPageBytes: 64 * 1024,
  requestBytes: 80 * 1024
});
var builtInFactPolicy = Object.freeze({
  extractorSha256: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.extractorSha256,
  factPackId: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.factPackId,
  kind: "built-in",
  v: 1
});
function immutableClone(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => immutableClone(item)));
  }
  if (value !== null && typeof value === "object") {
    if (!isPlainRecord(value))
      throw new TypeError("Memory output contains a non-JSON object.");
    const cloned = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(cloned, key, {
        configurable: false,
        enumerable: true,
        value: immutableClone(value[key]),
        writable: false
      });
    }
    return Object.freeze(cloned);
  }
  return value;
}
function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function exactHead(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}
function authorityId(value) {
  const parsed = safeCode(value, 128);
  if (parsed === null)
    throw new TypeError("Invalid memory authority ID.");
  return parsed;
}
function bindingFor(store, expected, lane) {
  const binding = parseOhStoreBindingV1(store.binding);
  if (binding === null || binding.bindingSha256 !== parseSha256Hex(expected)) {
    throw new OhIntegrityError(`The ${lane} store is not the host-bound authority.`);
  }
  if (binding.profile.profileKind !== lane) {
    throw new OhProfileError(`The ${lane} memory lane has the wrong store profile.`);
  }
  return binding;
}
function laneIdentity(value) {
  return Object.freeze({
    authorityId: value.authorityId,
    bindingSha256: value.binding.bindingSha256,
    datasetSha256: value.dataset.datasetSha256,
    head: value.snapshot.head,
    lane: value.lane,
    snapshotSha256: value.projectionSnapshot.snapshotSha256,
    v: 1
  });
}
function datasetForSnapshot(binding, snapshot) {
  const projectionSnapshot = createOhProjectionSnapshotV1({
    head: snapshot.head,
    records: snapshot.records,
    spaceId: binding.spaceId
  });
  const dataset = createOhProjectionDatasetV1({
    extractorSha256: canonicalSha256({ extractor: "oh.memory.lane-structural", v: 1 }),
    factPackId: "oh.memory.lane-structural",
    factPackRevision: 1,
    facts: createOhProjectionRecordFactsV1(snapshot.records),
    snapshot: projectionSnapshot
  });
  return { dataset, projectionSnapshot };
}
async function readLane(authority, lane, expectedHead) {
  const returnedHead = expectedHead ?? await authority.store.head();
  const head = parseOhHeadV1(immutableClone(returnedHead));
  if (head === null)
    throw new OhIntegrityError(`The ${lane} store returned an invalid head.`);
  const returnedSnapshot = await authority.store.snapshot({
    head: { operationSha256: head.operationSha256, sequence: head.sequence },
    maximumRecords: OH_MEMORY_LIMITS_V1.maximumRecordsPerLane
  });
  if (!isPlainRecord(returnedSnapshot) || !hasExactKeys(returnedSnapshot, ["head", "records", "v"]) || returnedSnapshot.v !== 1 || !Array.isArray(returnedSnapshot.records)) {
    throw new OhIntegrityError(`The ${lane} store returned an invalid snapshot envelope.`);
  }
  const detached = immutableClone(returnedSnapshot);
  const detachedHead = parseOhHeadV1(detached.head);
  if (detachedHead === null)
    throw new OhIntegrityError(`The ${lane} store returned an invalid snapshot head.`);
  const snapshot = immutableClone({
    head: detachedHead,
    records: detached.records,
    v: 1
  });
  if (!exactHead(snapshot.head, head)) {
    throw new OhIntegrityError(`The ${lane} snapshot differs from its pinned head.`);
  }
  if (utf8ByteLength(canonicalJson(snapshot)) > OH_MEMORY_LIMITS_V1.snapshotBytesPerLane) {
    throw new RangeError(`The ${lane} memory snapshot exceeds its canonical byte bound.`);
  }
  const projected = datasetForSnapshot(authority.binding, snapshot);
  return Object.freeze({
    authorityId: authority.authorityId,
    binding: authority.binding,
    dataset: projected.dataset,
    lane,
    projectionSnapshot: projected.projectionSnapshot,
    snapshot
  });
}
function syntheticKey(lane, recordSha256) {
  return `memory-source:${lane}:${recordSha256}`;
}
function createSyntheticSources(lanes) {
  const sources = new Map;
  for (const lane of lanes) {
    for (const physicalRecord of lane.snapshot.records) {
      const key = syntheticKey(lane.lane, physicalRecord.recordSha256);
      const record = createKnowledgeGraphRecordV1({
        dependencies: [],
        key,
        kind: "view",
        v: 1,
        value: {
          authorityId: lane.authorityId,
          bindingSha256: lane.binding.bindingSha256,
          key: physicalRecord.key,
          lane: lane.lane,
          recordSha256: physicalRecord.recordSha256,
          snapshotSha256: lane.projectionSnapshot.snapshotSha256,
          v: 1
        }
      });
      const physical = Object.freeze({
        authorityId: lane.authorityId,
        bindingSha256: lane.binding.bindingSha256,
        head: lane.snapshot.head,
        key: physicalRecord.key,
        lane: lane.lane,
        recordSha256: physicalRecord.recordSha256,
        snapshotSha256: lane.projectionSnapshot.snapshotSha256,
        v: 1
      });
      if (sources.has(key))
        throw new OhIntegrityError("A memory lane contains a duplicate source digest.");
      sources.set(key, Object.freeze({ physical, record }));
    }
  }
  if (sources.size > OH_MEMORY_LIMITS_V1.maximumSyntheticRecords) {
    throw new RangeError("The composite memory snapshot has too many records.");
  }
  const records = [...sources.values()].map(({ record }) => record).sort((left, right) => compareText(left.key, right.key));
  return { records, sources };
}
function sourceFor(sources, lane, record) {
  const source = sources.get(syntheticKey(lane, record.recordSha256));
  if (source === undefined)
    throw new OhIntegrityError("A composite memory source is missing.");
  return [{ key: source.record.key, recordSha256: source.record.recordSha256, v: 1 }];
}
function createCompositeDataset(canonical, working, extractors) {
  const synthetic = createSyntheticSources([canonical, working]);
  const extractorInvocations = synthetic.records.length * extractors.length;
  if (extractorInvocations > OH_MEMORY_LIMITS_V1.maximumExtractorInvocations) {
    throw new RangeError("The composite memory extractor invocation count exceeds its explicit bound.");
  }
  const facts = [];
  const factDigests = new Set;
  const factPolicies = new Map;
  const addFact = (fact, policy) => {
    if (facts.length >= OH_PROJECTION_LIMITS_V1.facts) {
      throw new RangeError("The composite memory fact set exceeds its explicit bound.");
    }
    if (factDigests.has(fact.factSha256)) {
      throw new OhIntegrityError("A memory fact extractor emitted the same exact fact twice.");
    }
    const priorPolicy = factPolicies.get(fact.relation);
    if (priorPolicy !== undefined && canonicalJson(priorPolicy) !== canonicalJson(policy)) {
      throw new OhIntegrityError("A memory relation has more than one fact policy.");
    }
    facts.push(fact);
    factDigests.add(fact.factSha256);
    factPolicies.set(fact.relation, policy);
  };
  const byLane = new Map([
    ["canonical", new Map(canonical.snapshot.records.map((record) => [record.key, record]))],
    ["working", new Map(working.snapshot.records.map((record) => [record.key, record]))]
  ]);
  for (const lane of [canonical, working]) {
    for (const record of lane.snapshot.records) {
      const extractorRecord = immutableClone(record);
      const source = sourceFor(synthetic.sources, lane.lane, record);
      addFact(createOhProjectionFactV1({
        relation: "memory.record",
        sources: source,
        tuple: [lane.lane, record.key, record.kind, record.recordSha256]
      }), builtInFactPolicy);
      for (const dependency of record.dependencies) {
        addFact(createOhProjectionFactV1({
          relation: "memory.dependency",
          sources: source,
          tuple: [lane.lane, record.key, dependency]
        }), builtInFactPolicy);
      }
      for (const extractor of extractors) {
        const declared = extractor.extract(Object.freeze({ lane: lane.lane, record: extractorRecord }));
        if (!Array.isArray(declared) || declared.length > OH_MEMORY_LIMITS_V1.factsPerRecordPerExtractor) {
          throw new RangeError("A memory fact extractor exceeded its per-record bound.");
        }
        for (const fact of declared) {
          if (!isPlainRecord(fact) || !hasExactKeys(fact, ["relation", "tuple", "v"]) || fact.v !== 1 || !Array.isArray(fact.tuple) || typeof fact.relation !== "string" || !extractor.relations.includes(fact.relation)) {
            throw new TypeError("A memory fact extractor returned an invalid or reserved fact.");
          }
          addFact(createOhProjectionFactV1({ relation: fact.relation, sources: source, tuple: fact.tuple }), Object.freeze({
            extractorId: extractor.extractorId,
            extractorSha256: extractor.extractorSha256,
            kind: "domain",
            v: 1
          }));
        }
      }
    }
  }
  const conflicts = [];
  const canonicalByKey = byLane.get("canonical");
  const workingByKey = byLane.get("working");
  for (const key of [...canonicalByKey.keys()].filter((candidate) => workingByKey.has(candidate)).sort()) {
    const canonicalRecord = canonicalByKey.get(key);
    const workingRecord = workingByKey.get(key);
    const sources = [
      ...sourceFor(synthetic.sources, "canonical", canonicalRecord),
      ...sourceFor(synthetic.sources, "working", workingRecord)
    ];
    if (canonicalRecord.recordSha256 === workingRecord.recordSha256) {
      addFact(createOhProjectionFactV1({
        relation: "memory.agreement",
        sources,
        tuple: [key, canonicalRecord.recordSha256]
      }), builtInFactPolicy);
    } else {
      addFact(createOhProjectionFactV1({
        relation: "memory.conflict",
        sources,
        tuple: [key, canonicalRecord.recordSha256, workingRecord.recordSha256]
      }), builtInFactPolicy);
      conflicts.push(Object.freeze({
        canonicalRecordSha256: canonicalRecord.recordSha256,
        key,
        v: 1,
        workingRecordSha256: workingRecord.recordSha256
      }));
    }
  }
  const recordRefs = synthetic.records.map(knowledgeGraphRecordRefV1).sort((left, right) => compareText(left.key, right.key));
  const sourceIdentity = {
    canonical: laneIdentity(canonical),
    conflictPolicy: OH_MEMORY_CONFLICT_POLICY_V1,
    recordRefs,
    v: 1,
    working: laneIdentity(working)
  };
  const head = Object.freeze({
    generation: 1,
    graphRevisionSha256: canonicalSha256({ kind: "oh.memory.composite-graph", sourceIdentity }),
    operationSha256: canonicalSha256({ kind: "oh.memory.composite-operation", sourceIdentity }),
    recordsSha256: canonicalSha256(recordRefs),
    sequence: 1,
    v: 1
  });
  const snapshot = createOhProjectionSnapshotV1({
    head,
    records: synthetic.records,
    spaceId: "oh.memory.composite"
  });
  const dataset = createOhProjectionDatasetV1({
    extractorSha256: canonicalSha256({
      builtIn: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.extractorSha256,
      extensions: extractors.map(({ extractorId, extractorSha256, relations }) => ({
        extractorId,
        extractorSha256,
        relations
      })),
      v: 1
    }),
    factPackId: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.factPackId,
    factPackRevision: OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1.factPackRevision,
    facts,
    snapshot
  });
  return Object.freeze({
    conflicts: Object.freeze(conflicts),
    dataset,
    factPolicies,
    snapshot,
    sources: synthetic.sources
  });
}
function mapProof(proof, sources, factPolicies) {
  if (proof.kind === "truncated")
    return Object.freeze({ ...proof });
  if (proof.kind === "derived") {
    return Object.freeze({
      ...proof,
      premises: Object.freeze(proof.premises.map((premise) => mapProof(premise, sources, factPolicies)))
    });
  }
  const physical = proof.sources.map((source) => {
    const mapped = sources.get(source.key);
    if (mapped === undefined || mapped.record.recordSha256 !== source.recordSha256) {
      throw new OhIntegrityError("A projection proof has no exact physical memory source.");
    }
    return mapped.physical;
  }).sort((left, right) => compareText(canonicalJson(left), canonicalJson(right)));
  const factPolicy = factPolicies.get(proof.relation);
  if (factPolicy === undefined)
    throw new OhIntegrityError("A projection proof has no memory fact policy.");
  return Object.freeze({
    factPolicy,
    kind: "fact",
    relation: proof.relation,
    sources: Object.freeze(physical),
    tuple: proof.tuple,
    v: 1
  });
}
function collectLanes(proof, lanes) {
  if (proof.kind === "truncated")
    return true;
  if (proof.kind === "fact") {
    for (const source of proof.sources)
      lanes.add(source.lane);
    return false;
  }
  let unknown = proof.premisesTruncated;
  for (const premise of proof.premises)
    unknown = collectLanes(premise, lanes) || unknown;
  return unknown;
}
function publicRow(row, proofs) {
  const lanes = new Set;
  let unknown = row.proofsTruncated;
  for (const proof of proofs)
    unknown = collectLanes(proof, lanes) || unknown;
  const premiseLanes = [...lanes].sort();
  const premiseAuthority = unknown || premiseLanes.length === 0 ? "unknown" : premiseLanes.includes("working") ? "working" : "canonical";
  const payload = {
    premiseAuthority,
    premiseLanes,
    proofsTruncated: row.proofsTruncated,
    supportCount: row.supportCount,
    v: 1,
    values: row.values
  };
  return Object.freeze({ ...payload, resultRowSha256: canonicalSha256(payload) });
}
function resolvePrograms(programs) {
  if (programs.length < 1 || programs.length > OH_MEMORY_LIMITS_V1.maximumPrograms) {
    throw new RangeError("Memory requires a bounded nonempty named program registry.");
  }
  const resolved = new Map;
  for (const program of programs) {
    const programId = safeCode(program.programId, 128);
    const purpose = safeCode(program.purpose, 256);
    const query = parseOhProjectionQueryV1(program.query);
    const rulePack = parseOhProjectionRulePackV1(program.rulePack);
    if (programId === null || purpose === null || query === null || rulePack === null || resolved.has(programId)) {
      throw new TypeError("Invalid or duplicate named memory program.");
    }
    resolved.set(programId, immutableClone({ ...program.evaluation === undefined ? {} : { evaluation: { ...program.evaluation } }, programId, purpose, query, rulePack }));
  }
  return resolved;
}
function resolveExtractors(extractors) {
  if (extractors.length > OH_MEMORY_LIMITS_V1.maximumExtractors) {
    throw new RangeError("The memory domain extractor registry is too large.");
  }
  const claimedRelations = new Set;
  const resolved = extractors.map((extractor) => {
    const extractorId = safeCode(extractor.extractorId, 128);
    const extractorSha256 = parseSha256Hex(extractor.extractorSha256);
    if (extractorId === null || extractorSha256 === null || typeof extractor.extract !== "function" || !Array.isArray(extractor.relations) || extractor.relations.length < 1 || extractor.relations.length > OH_MEMORY_LIMITS_V1.relationsPerExtractor) {
      throw new TypeError("Invalid memory domain fact extractor.");
    }
    const relations = extractor.relations.map((relation) => safeCode(relation, 128)).sort();
    if (relations.some((relation) => relation === null || relation.startsWith("memory.") || relation.startsWith("oh.")) || new Set(relations).size !== relations.length) {
      throw new TypeError("A memory domain fact extractor has invalid or reserved relations.");
    }
    for (const relation of relations) {
      if (claimedRelations.has(relation)) {
        throw new TypeError("Memory domain fact extractor relations must have one owner.");
      }
      claimedRelations.add(relation);
    }
    return Object.freeze({
      extract: extractor.extract,
      extractorId,
      extractorSha256,
      relations: Object.freeze(relations)
    });
  }).sort((left, right) => compareText(left.extractorId, right.extractorId));
  if (new Set(resolved.map(({ extractorId }) => extractorId)).size !== resolved.length) {
    throw new TypeError("Duplicate memory domain fact extractor ID.");
  }
  return Object.freeze(resolved);
}
function resolveNominationRoutes(routes) {
  if (routes.length > OH_MEMORY_LIMITS_V1.maximumNominationRoutes) {
    throw new RangeError("The memory nomination route registry is too large.");
  }
  const resolved = new Map;
  for (const route of routes) {
    const nominationId = safeCode(route.nominationId, 128);
    const destinationPurpose = safeCode(route.destinationPurpose, 256);
    if (nominationId === null || destinationPurpose === null || resolved.has(nominationId)) {
      throw new TypeError("Invalid or duplicate memory nomination route.");
    }
    resolved.set(nominationId, Object.freeze({ destinationPurpose, nominationId }));
  }
  return resolved;
}
function parseQueryRequest(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["programId", "v"]) || value.v !== 1)
    throw new TypeError("Invalid named memory query.");
  const programId = safeCode(value.programId, 128);
  if (programId === null)
    throw new TypeError("Invalid named memory query identity.");
  return { programId };
}
function parseExplainRequest(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["resultSha256", "row", "token", "v"]) || value.v !== 1 || typeof value.token !== "string" || value.token.length !== 43 || !Number.isSafeInteger(value.row) || value.row < 0) {
    throw new TypeError("Invalid memory explanation request.");
  }
  const resultSha256 = parseSha256Hex(value.resultSha256);
  if (resultSha256 === null)
    throw new TypeError("Invalid memory explanation result identity.");
  return { resultSha256, row: value.row, token: value.token };
}
function parseNominationRequest(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["nominationId", "roots", "v"]) || value.v !== 1 || !Array.isArray(value.roots) || value.roots.length < 1 || value.roots.length > OH_DEPENDENCY_CLOSURE_LIMITS_V1.roots) {
    throw new TypeError("Invalid memory nomination request.");
  }
  const nominationId = safeCode(value.nominationId, 128);
  const roots = value.roots.map((root) => safeCode(root, 512)).sort();
  if (nominationId === null || roots.some((root) => root === null) || new Set(roots).size !== roots.length)
    throw new TypeError("Invalid memory nomination identity.");
  return { nominationId, roots };
}
function isoInstant(date) {
  const value = date.toISOString();
  if (parseCanonicalInstantV1(value) === null)
    throw new TypeError("The memory clock returned an invalid instant.");
  return value;
}
function clockMilliseconds(now) {
  const milliseconds = now().getTime();
  if (!Number.isFinite(milliseconds))
    throw new TypeError("The memory clock returned an invalid date.");
  return milliseconds;
}
function monotonicMilliseconds(now) {
  const milliseconds = now();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new TypeError("The memory monotonic clock returned an invalid value.");
  }
  return milliseconds;
}
async function createOhMemoryAgentV1(options) {
  const memoryActorId = safeCode(options.actorId, 128);
  if (memoryActorId === null)
    throw new TypeError("Invalid host-bound memory actor ID.");
  const canonicalStore = options.canonical.store;
  const workingStore = options.working.store;
  const workingCodecs = options.working.codecs;
  const canonicalAuthorityId = authorityId(options.canonical.authorityId);
  const workingAuthorityId = authorityId(options.working.authorityId);
  if (canonicalAuthorityId === workingAuthorityId) {
    throw new OhProfileError("Working and canonical memory must be distinct physical authorities.");
  }
  const canonicalBinding = bindingFor(canonicalStore, options.canonical.expectedBindingSha256, "canonical");
  const workingBinding = bindingFor(workingStore, options.working.expectedBindingSha256, "working");
  const expectedCanonicalHead = parseOhHeadV1(options.canonical.expectedHead);
  if (expectedCanonicalHead === null)
    throw new TypeError("Invalid pinned canonical memory head.");
  const programs = resolvePrograms(options.programs);
  const extractors = resolveExtractors(options.extractors ?? []);
  const nominationRoutes = resolveNominationRoutes(options.nominationRoutes ?? []);
  const ingress = new OhSemanticBundleIngressV1(workingStore, workingCodecs);
  const now = options.now ?? (() => new Date);
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const capabilityLifetime = options.explainCapabilityLifetimeMs ?? OH_MEMORY_LIMITS_V1.explainCapabilityLifetimeMs;
  if (!Number.isSafeInteger(capabilityLifetime) || capabilityLifetime < 1000 || capabilityLifetime > 60 * 60 * 1000) {
    throw new RangeError("Invalid memory explanation capability lifetime.");
  }
  const canonical = await readLane({
    authorityId: canonicalAuthorityId,
    binding: canonicalBinding,
    store: canonicalStore
  }, "canonical", expectedCanonicalHead);
  const explanations = new Map;
  let explanationBytes = 0;
  let lastMonotonicMs = -1;
  let lastWallClockMs = Number.NEGATIVE_INFINITY;
  const wallClock = () => {
    const milliseconds = clockMilliseconds(now);
    if (milliseconds < lastWallClockMs)
      throw new OhProfileError("The memory wall clock regressed.");
    lastWallClockMs = milliseconds;
    return milliseconds;
  };
  const monotonicClock = () => {
    const milliseconds = monotonicMilliseconds(monotonicNow);
    if (milliseconds < lastMonotonicMs)
      throw new OhProfileError("The memory monotonic clock regressed.");
    lastMonotonicMs = milliseconds;
    return milliseconds;
  };
  const deleteExplanation = (token) => {
    const stored = explanations.get(token);
    if (stored !== undefined && explanations.delete(token))
      explanationBytes -= stored.bytes;
  };
  const remember = async (value) => {
    if (utf8ByteLength(canonicalJson(value)) > OH_MEMORY_LIMITS_V1.rememberBytes) {
      throw new RangeError("The memory semantic bundle exceeds its canonical byte bound.");
    }
    if (!isPlainRecord(value) || !hasExactKeys(value, ["expectedHead", "puts", "requestId", "tombstones", "v"]) || value.v !== 1) {
      throw new TypeError("Invalid memory remember request.");
    }
    const requestId = safeCode(value.requestId, 128);
    if (requestId === null)
      throw new TypeError("Invalid memory remember request identity.");
    const operationId = `memory_${canonicalSha256({
      actorId: memoryActorId,
      bindingSha256: workingBinding.bindingSha256,
      requestId,
      v: 1
    }).slice(0, 48)}`;
    const operation = await ingress.commit({
      actorId: memoryActorId,
      expectedHead: value.expectedHead,
      instant: isoInstant(new Date(wallClock())),
      operationId,
      puts: value.puts,
      tombstones: value.tombstones,
      v: 1
    });
    const head = {
      generation: operation.sequence,
      graphRevisionSha256: operation.graphRevisionSha256,
      operationSha256: operation.operationSha256,
      recordsSha256: operation.recordsSha256,
      sequence: operation.sequence,
      v: 1
    };
    const payload = {
      actorId: operation.actorId,
      authorityId: workingAuthorityId,
      bindingSha256: workingBinding.bindingSha256,
      head,
      instant: operation.instant,
      lane: "working",
      operationSha256: operation.operationSha256,
      requestId,
      status: "committed",
      v: 1
    };
    return immutableClone({ ...payload, receiptSha256: canonicalSha256(payload) });
  };
  const query = async (value) => {
    const request = parseQueryRequest(value);
    const program = programs.get(request.programId);
    if (program === undefined)
      throw new TypeError("Unknown named memory program.");
    const working = await readLane({
      authorityId: workingAuthorityId,
      binding: workingBinding,
      store: workingStore
    }, "working");
    const composite = createCompositeDataset(canonical, working, extractors);
    const projection = evaluateOhProjectionV1({
      dataset: composite.dataset,
      ...program.evaluation === undefined ? {} : { options: program.evaluation },
      query: program.query,
      rulePack: program.rulePack,
      snapshot: composite.snapshot
    });
    const identityPayload = {
      canonical: laneIdentity(canonical),
      compositeDatasetSha256: composite.dataset.datasetSha256,
      conflictPolicy: OH_MEMORY_CONFLICT_POLICY_V1,
      evaluationSha256: projection.identity.evaluationSha256,
      programId: program.programId,
      projectionSha256: projection.identity.projectionSha256,
      purpose: program.purpose,
      querySha256: program.query.querySha256,
      rulePackSha256: program.rulePack.rulePackSha256,
      v: 1,
      working: laneIdentity(working)
    };
    const identity = immutableClone({
      ...identityPayload,
      memorySha256: canonicalSha256(identityPayload)
    });
    const proofs = immutableClone(projection.rows.map((row) => row.proofs.map((proof) => mapProof(proof, composite.sources, composite.factPolicies))));
    const rows = immutableClone(projection.rows.map((row, index) => publicRow(row, proofs[index])));
    const resultPayload = immutableClone({
      authority: "derived",
      conflicts: composite.conflicts,
      identity,
      projectionResultSha256: projection.resultSha256,
      rows,
      v: 1
    });
    const resultSha256 = canonicalSha256(resultPayload);
    const issuedAt = wallClock();
    const issuedAtMonotonic = monotonicClock();
    const expiresAtMs = issuedAt + capabilityLifetime;
    const expiresAtMonotonicMs = issuedAtMonotonic + capabilityLifetime;
    const expiresAt = isoInstant(new Date(expiresAtMs));
    for (const [existingToken, stored] of explanations) {
      if (issuedAtMonotonic >= stored.expiresAtMonotonicMs)
        deleteExplanation(existingToken);
    }
    const storedPayload = immutableClone({ expiresAtMonotonicMs, identity, proofs, resultSha256, rows });
    const storedBytes = utf8ByteLength(canonicalJson(storedPayload)) + 128;
    if (storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityEntryBytes || storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityTotalBytes) {
      throw new RangeError("The memory explanation exceeds its retained capability bound.");
    }
    while (explanations.size >= OH_MEMORY_LIMITS_V1.explainCapabilities || explanationBytes + storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityTotalBytes) {
      const oldest = explanations.keys().next().value;
      if (oldest === undefined)
        break;
      deleteExplanation(oldest);
    }
    let token = randomBytes2(32).toString("base64url");
    while (explanations.has(token))
      token = randomBytes2(32).toString("base64url");
    explanations.set(token, immutableClone({ ...storedPayload, bytes: storedBytes }));
    explanationBytes += storedBytes;
    const result = immutableClone({
      ...resultPayload,
      explainCapability: { expiresAt, token, v: 1 },
      resultSha256
    });
    if (utf8ByteLength(canonicalJson(result)) > OH_MEMORY_LIMITS_V1.resultBytes) {
      deleteExplanation(token);
      throw new RangeError("The composite memory result exceeds its canonical byte bound.");
    }
    return result;
  };
  const explain = async (value) => {
    const request = parseExplainRequest(value);
    const stored = explanations.get(request.token);
    const currentTime = monotonicClock();
    if (stored === undefined || stored.resultSha256 !== request.resultSha256 || currentTime >= stored.expiresAtMonotonicMs) {
      deleteExplanation(request.token);
      throw new OhProfileError("The memory explanation capability is absent, expired, or misbound.");
    }
    const row = stored.rows[request.row];
    const proofs = stored.proofs[request.row];
    if (row === undefined || proofs === undefined)
      throw new RangeError("The explanation row is out of bounds.");
    const payload = {
      authority: "derived",
      identity: stored.identity,
      premiseAuthority: row.premiseAuthority,
      premiseLanes: row.premiseLanes,
      proofs,
      proofsTruncated: row.proofsTruncated,
      resultRowSha256: row.resultRowSha256,
      resultSha256: stored.resultSha256,
      supportCount: row.supportCount,
      v: 1,
      values: row.values
    };
    return immutableClone({ ...payload, explanationSha256: canonicalSha256(payload) });
  };
  const nominate = async (value) => {
    const request = parseNominationRequest(value);
    const route = nominationRoutes.get(request.nominationId);
    if (route === undefined)
      throw new TypeError("Unknown named memory nomination route.");
    const head = parseOhHeadV1(immutableClone(await workingStore.head()));
    if (head === null)
      throw new OhIntegrityError("The working nomination store returned an invalid head.");
    const closure = await workingStore.exportDependencyClosure({ head: {
      operationSha256: head.operationSha256,
      sequence: head.sequence
    }, roots: request.roots });
    const verified = verifyOhDependencyClosureAgainstV1(closure, { binding: workingBinding, head });
    if (!verified.ok)
      throw new OhIntegrityError("The working nomination closure failed exact verification.");
    if (canonicalJson(verified.closure.roots) !== canonicalJson(request.roots)) {
      throw new OhIntegrityError("The working nomination closure substituted different roots.");
    }
    const source = Object.freeze({
      authorityId: workingAuthorityId,
      bindingSha256: workingBinding.bindingSha256,
      head,
      lane: "working",
      v: 1
    });
    const payload = {
      closure: verified.closure,
      destinationPurpose: route.destinationPurpose,
      nominationId: route.nominationId,
      source,
      status: "prepared",
      v: 1
    };
    return immutableClone({ ...payload, nominationSha256: canonicalSha256(payload) });
  };
  return Object.freeze({ explain, nominate, query, remember });
}
function ownDataKeysV2(value, maximum, label) {
  if (!isPlainRecord(value))
    throw new TypeError(`${label} must be a plain data object.`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > maximum)
    throw new RangeError(`${label} has too many entries.`);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new TypeError(`${label} must have only string data properties.`);
  }
  const keys = ownKeys;
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label} must have only enumerable data properties.`);
    }
  }
  return keys;
}
function continuationKeyV2(value) {
  if (value === undefined)
    return Uint8Array.from(randomBytes2(32));
  if (!(value instanceof Uint8Array) || value.byteLength < OH_MEMORY_QUERY_LIMITS_V2.continuationKeyMinimumBytes || value.byteLength > OH_MEMORY_QUERY_LIMITS_V2.continuationKeyMaximumBytes) {
    throw new RangeError("The V2 memory continuation key must be 32 through 64 raw bytes.");
  }
  return Uint8Array.from(value);
}
function positiveBounded(value, maximum, label, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}
function resolveEvaluationV2(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "maximumDerivedTuples",
    "maximumProofDepth",
    "maximumProofNodes",
    "maximumResultBytes",
    "maximumRounds",
    "maximumTotalProofNodes",
    "maximumWorkUnits"
  ])) {
    throw new TypeError("A V2 memory program must declare every projection evaluation limit.");
  }
  return Object.freeze({
    maximumDerivedTuples: positiveBounded(value.maximumDerivedTuples, OH_PROJECTION_LIMITS_V1.derivedTuples, "maximumDerivedTuples"),
    maximumProofDepth: positiveBounded(value.maximumProofDepth, OH_PROJECTION_LIMITS_V1.proofDepth, "maximumProofDepth"),
    maximumProofNodes: positiveBounded(value.maximumProofNodes, OH_PROJECTION_LIMITS_V1.proofNodes, "maximumProofNodes"),
    maximumResultBytes: positiveBounded(value.maximumResultBytes, OH_PROJECTION_LIMITS_V1.resultBytes, "maximumResultBytes", 64 * 1024),
    maximumRounds: positiveBounded(value.maximumRounds, OH_PROJECTION_LIMITS_V1.rounds, "maximumRounds"),
    maximumTotalProofNodes: positiveBounded(value.maximumTotalProofNodes, OH_PROJECTION_LIMITS_V1.totalProofNodes, "maximumTotalProofNodes"),
    maximumWorkUnits: positiveBounded(value.maximumWorkUnits, OH_PROJECTION_LIMITS_V1.workUnits, "maximumWorkUnits")
  });
}
function resolveProgramsV2(programs) {
  if (!Array.isArray(programs) || programs.length < 1 || programs.length > OH_MEMORY_LIMITS_V1.maximumPrograms) {
    throw new RangeError("Memory requires a bounded nonempty V2 named program registry.");
  }
  const resolved = new Map;
  for (const candidate of programs) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, [
      "evaluation",
      "maximumPageBytes",
      "maximumRows",
      "pageSize",
      "parameters",
      "programId",
      "purpose",
      "query",
      "rulePack",
      "v"
    ]) || candidate.v !== 2 || !Array.isArray(candidate.parameters)) {
      throw new TypeError("Invalid V2 named memory program.");
    }
    const programId = safeCode(candidate.programId, 128);
    const purpose = safeCode(candidate.purpose, 256);
    const query = parseOhProjectionQueryV1(candidate.query);
    const rulePack = parseOhProjectionRulePackV1(candidate.rulePack);
    const evaluation = resolveEvaluationV2(candidate.evaluation);
    const maximumRows = positiveBounded(candidate.maximumRows, OH_MEMORY_QUERY_LIMITS_V2.maximumProgramRows, "maximumRows");
    const pageSize = positiveBounded(candidate.pageSize, Math.min(maximumRows, OH_MEMORY_QUERY_LIMITS_V2.maximumPageRows), "pageSize");
    const maximumPageBytes = positiveBounded(candidate.maximumPageBytes, OH_MEMORY_QUERY_LIMITS_V2.maximumPageBytes, "maximumPageBytes", OH_MEMORY_QUERY_LIMITS_V2.minimumPageBytes);
    if (programId === null || purpose === null || query === null || rulePack === null || resolved.has(programId) || query.limit !== maximumRows || candidate.parameters.length > OH_MEMORY_QUERY_LIMITS_V2.bindings) {
      throw new TypeError("Invalid or duplicate V2 named memory program.");
    }
    const parameters = candidate.parameters.map((parameter) => safeCode(parameter, 128)).sort();
    if (parameters.some((parameter) => parameter === null) || new Set(parameters).size !== parameters.length) {
      throw new TypeError("A V2 memory program has invalid or duplicate parameters.");
    }
    const queryVariables = new Set(query.where.flatMap((literal) => literal.terms.flatMap((term) => term.kind === "variable" ? [term.name] : [])));
    if (parameters.some((parameter) => !queryVariables.has(parameter) || query.find.includes(parameter))) {
      throw new TypeError("V2 parameters must be query-body variables that are not projected outputs.");
    }
    const detachedParameters = Object.freeze(parameters);
    const programPayload = {
      evaluation,
      maximumPageBytes,
      maximumRows,
      pageSize,
      parameters: detachedParameters,
      programId,
      purpose,
      querySha256: query.querySha256,
      rulePackSha256: rulePack.rulePackSha256,
      v: 2
    };
    const program = immutableClone({
      evaluation,
      maximumPageBytes,
      maximumRows,
      pageSize,
      parameters: detachedParameters,
      programId,
      programSha256: canonicalSha256(programPayload),
      purpose,
      query,
      rulePack,
      v: 2
    });
    resolved.set(programId, program);
  }
  return resolved;
}
function parsePrimitiveBindingV2(value) {
  if (value !== null && typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string")
    throw new TypeError("Memory bindings must be JSON primitives.");
  if (typeof value === "string" && value.length > OH_PROJECTION_LIMITS_V1.atomBytes) {
    throw new RangeError("A memory binding exceeds the projection atom byte bound.");
  }
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
    throw new TypeError("Memory bindings must be canonical finite JSON numbers.");
  }
  const serialized = canonicalJson(value);
  if (utf8ByteLength(serialized) > OH_PROJECTION_LIMITS_V1.atomBytes) {
    throw new RangeError("A memory binding exceeds the projection atom byte bound.");
  }
  return value;
}
function parseQueryRequestV2(value) {
  let keys;
  try {
    keys = ownDataKeysV2(value, 4, "The parameterized memory query");
  } catch {
    throw new TypeError("Invalid parameterized memory query.");
  }
  if (keys.length !== 4 || !["bindings", "continuation", "programId", "v"].every((key) => keys.includes(key))) {
    throw new TypeError("Invalid parameterized memory query.");
  }
  const record = value;
  if (record.v !== 2 || record.continuation !== null && typeof record.continuation !== "string") {
    throw new TypeError("Invalid parameterized memory query.");
  }
  const programId = safeCode(record.programId, 128);
  if (programId === null)
    throw new TypeError("Invalid parameterized memory query identity.");
  const continuation = record.continuation;
  if (typeof continuation === "string" && (continuation.length < 1 || continuation.length > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes || utf8ByteLength(continuation) > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes)) {
    throw new RangeError("The memory continuation exceeds its byte bound.");
  }
  const bindingKeys = ownDataKeysV2(record.bindings, OH_MEMORY_QUERY_LIMITS_V2.bindings, "The parameterized memory query bindings");
  const bindingRecord = record.bindings;
  const bindings = {};
  for (const key of bindingKeys) {
    if (safeCode(key, 128) === null)
      throw new TypeError("Invalid memory binding name.");
    bindings[key] = parsePrimitiveBindingV2(bindingRecord[key]);
  }
  const boundedRequest = { bindings, continuation, programId, v: 2 };
  if (utf8ByteLength(canonicalJson(boundedRequest)) > OH_MEMORY_QUERY_LIMITS_V2.requestBytes) {
    throw new RangeError("The parameterized memory query exceeds its canonical byte bound.");
  }
  return { bindingsValue: immutableClone(bindings), continuation, programId };
}
function parseBindingsV2(value, parameters) {
  if (!isPlainRecord(value) || !hasExactKeys(value, parameters)) {
    throw new TypeError("Memory query bindings must exactly match the host-declared parameters.");
  }
  const bindings = {};
  for (const parameter of parameters)
    bindings[parameter] = value[parameter];
  if (utf8ByteLength(canonicalJson(bindings)) > OH_MEMORY_QUERY_LIMITS_V2.bindingBytes) {
    throw new RangeError("Memory query bindings exceed their canonical byte bound.");
  }
  const detached = immutableClone(bindings);
  return Object.freeze({
    bindings: detached,
    bindingsSha256: canonicalSha256({ bindings: detached, parameters, v: 2 })
  });
}
function bindQueryV2(query, bindings) {
  const where = query.where.map((literal) => createOhProjectionLiteralV1({
    relation: literal.relation,
    terms: literal.terms.map((term) => term.kind === "variable" && Object.hasOwn(bindings, term.name) ? ohProjectionConstantV1(bindings[term.name]) : term)
  }));
  return createOhProjectionQueryV1({
    find: query.find,
    limit: query.limit,
    queryId: query.queryId,
    where
  });
}
function publicRowV2(row, proofs) {
  const lanes = new Set;
  let unknown = row.proofsTruncated;
  for (const proof of proofs)
    unknown = collectLanes(proof, lanes) || unknown;
  const premiseLanes = [...lanes].sort();
  const premiseAuthority = unknown || premiseLanes.length === 0 ? "unknown" : premiseLanes.includes("working") ? "working" : "canonical";
  const payload = {
    premiseAuthority,
    premiseLanes,
    proofsTruncated: row.proofsTruncated,
    supportCount: row.supportCount,
    v: 2,
    values: row.values
  };
  return Object.freeze({ ...payload, resultRowSha256: canonicalSha256(payload) });
}
function continuationHmacV2(key, value) {
  return createHmac("sha256", key).update("oh.memory.continuation.v2\x00", "utf8").update(canonicalJson(value), "utf8").digest();
}
function encodeContinuationV2(value, key) {
  const identity = immutableClone(value);
  const continuationSha256 = canonicalSha256(identity);
  const signed = immutableClone({ ...identity, continuationSha256 });
  const envelope = immutableClone({
    ...signed,
    continuationHmacSha256: continuationHmacV2(key, signed).toString("hex")
  });
  const continuation = Buffer.from(canonicalJson(envelope), "utf8").toString("base64url");
  if (utf8ByteLength(continuation) > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes) {
    throw new RangeError("The issued memory continuation exceeds its byte bound.");
  }
  return Object.freeze({ continuation, continuationSha256 });
}
function parseContinuationV2(value, key) {
  if (value.length < 1 || utf8ByteLength(value) > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes || !/^[A-Za-z0-9_-]+$/u.test(value))
    throw new TypeError("Invalid memory continuation encoding.");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || bytes.byteLength > OH_MEMORY_QUERY_LIMITS_V2.continuationBytes) {
    throw new TypeError("Invalid memory continuation encoding.");
  }
  const text = bytes.toString("utf8");
  let decoded;
  try {
    decoded = JSON.parse(text);
  } catch {
    throw new TypeError("Invalid memory continuation JSON.");
  }
  if (!isPlainRecord(decoded) || !hasExactKeys(decoded, [
    "bindingsSha256",
    "continuationHmacSha256",
    "continuationSha256",
    "memorySha256",
    "nextOffset",
    "pageSize",
    "programSha256",
    "projectionResultSha256",
    "totalRows",
    "v"
  ]) || decoded.v !== 2)
    throw new TypeError("Invalid memory continuation payload.");
  const bindingsSha256 = parseSha256Hex(decoded.bindingsSha256);
  const continuationHmacSha256 = parseSha256Hex(decoded.continuationHmacSha256);
  const continuationSha256 = parseSha256Hex(decoded.continuationSha256);
  const memorySha256 = parseSha256Hex(decoded.memorySha256);
  const programSha256 = parseSha256Hex(decoded.programSha256);
  const projectionResultSha256 = parseSha256Hex(decoded.projectionResultSha256);
  if (bindingsSha256 === null || continuationHmacSha256 === null || continuationSha256 === null || memorySha256 === null || programSha256 === null || projectionResultSha256 === null || !Number.isSafeInteger(decoded.nextOffset) || decoded.nextOffset < 1 || decoded.nextOffset > OH_MEMORY_QUERY_LIMITS_V2.maximumProgramRows || !Number.isSafeInteger(decoded.pageSize) || decoded.pageSize < 1 || decoded.pageSize > OH_MEMORY_QUERY_LIMITS_V2.maximumPageRows || !Number.isSafeInteger(decoded.totalRows) || decoded.totalRows < 1 || decoded.totalRows > OH_MEMORY_QUERY_LIMITS_V2.maximumProgramRows || decoded.nextOffset >= decoded.totalRows || decoded.nextOffset % decoded.pageSize !== 0) {
    throw new TypeError("Invalid memory continuation identity.");
  }
  const identity = {
    bindingsSha256,
    memorySha256,
    nextOffset: decoded.nextOffset,
    pageSize: decoded.pageSize,
    programSha256,
    projectionResultSha256,
    totalRows: decoded.totalRows,
    v: 2
  };
  const signed = { ...identity, continuationSha256 };
  const envelope = { ...signed, continuationHmacSha256 };
  if (canonicalJson(envelope) !== text)
    throw new TypeError("Invalid memory continuation payload.");
  const expectedHmac = continuationHmacV2(key, signed);
  const receivedHmac = Buffer.from(continuationHmacSha256, "hex");
  if (!timingSafeEqual(expectedHmac, receivedHmac)) {
    throw new OhIntegrityError("The memory continuation is not an issued capability.");
  }
  if (canonicalSha256(identity) !== continuationSha256) {
    throw new OhIntegrityError("The memory continuation digest is invalid.");
  }
  return Object.freeze(signed);
}
function parseExplainRequestV2(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["pageRow", "resultSha256", "token", "v"]) || value.v !== 2 || typeof value.token !== "string" || value.token.length !== 43 || !Number.isSafeInteger(value.pageRow) || value.pageRow < 0) {
    throw new TypeError("Invalid V2 memory explanation request.");
  }
  const resultSha256 = parseSha256Hex(value.resultSha256);
  if (resultSha256 === null)
    throw new TypeError("Invalid V2 memory explanation result identity.");
  return { pageRow: value.pageRow, resultSha256, token: value.token };
}
async function createOhMemoryAgentV2(options) {
  const memoryActorId = safeCode(options.actorId, 128);
  if (memoryActorId === null)
    throw new TypeError("Invalid host-bound memory actor ID.");
  const continuationKey = continuationKeyV2(options.continuationKey);
  const canonicalStore = options.canonical.store;
  const workingStore = options.working.store;
  const workingCodecs = options.working.codecs;
  const canonicalAuthorityId = authorityId(options.canonical.authorityId);
  const workingAuthorityId = authorityId(options.working.authorityId);
  if (canonicalAuthorityId === workingAuthorityId) {
    throw new OhProfileError("Working and canonical memory must be distinct physical authorities.");
  }
  const canonicalBinding = bindingFor(canonicalStore, options.canonical.expectedBindingSha256, "canonical");
  const workingBinding = bindingFor(workingStore, options.working.expectedBindingSha256, "working");
  const expectedCanonicalHead = parseOhHeadV1(options.canonical.expectedHead);
  if (expectedCanonicalHead === null)
    throw new TypeError("Invalid pinned canonical memory head.");
  const programs = resolveProgramsV2(options.programs);
  const extractors = resolveExtractors(options.extractors ?? []);
  const nominationRoutes = resolveNominationRoutes(options.nominationRoutes ?? []);
  const ingress = new OhSemanticBundleIngressV1(workingStore, workingCodecs);
  const now = options.now ?? (() => new Date);
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const capabilityLifetime = options.explainCapabilityLifetimeMs ?? OH_MEMORY_LIMITS_V1.explainCapabilityLifetimeMs;
  if (!Number.isSafeInteger(capabilityLifetime) || capabilityLifetime < 1000 || capabilityLifetime > 60 * 60 * 1000) {
    throw new RangeError("Invalid memory explanation capability lifetime.");
  }
  const canonical = await readLane({
    authorityId: canonicalAuthorityId,
    binding: canonicalBinding,
    store: canonicalStore
  }, "canonical", expectedCanonicalHead);
  const explanations = new Map;
  let explanationBytes = 0;
  let lastMonotonicMs = -1;
  let lastWallClockMs = Number.NEGATIVE_INFINITY;
  const wallClock = () => {
    const milliseconds = clockMilliseconds(now);
    if (milliseconds < lastWallClockMs)
      throw new OhProfileError("The memory wall clock regressed.");
    lastWallClockMs = milliseconds;
    return milliseconds;
  };
  const monotonicClock = () => {
    const milliseconds = monotonicMilliseconds(monotonicNow);
    if (milliseconds < lastMonotonicMs)
      throw new OhProfileError("The memory monotonic clock regressed.");
    lastMonotonicMs = milliseconds;
    return milliseconds;
  };
  const deleteExplanation = (token) => {
    const stored = explanations.get(token);
    if (stored !== undefined && explanations.delete(token))
      explanationBytes -= stored.bytes;
  };
  const remember = async (value) => {
    if (utf8ByteLength(canonicalJson(value)) > OH_MEMORY_LIMITS_V1.rememberBytes) {
      throw new RangeError("The memory semantic bundle exceeds its canonical byte bound.");
    }
    if (!isPlainRecord(value) || !hasExactKeys(value, ["expectedHead", "puts", "requestId", "tombstones", "v"]) || value.v !== 1) {
      throw new TypeError("Invalid memory remember request.");
    }
    const requestId = safeCode(value.requestId, 128);
    if (requestId === null)
      throw new TypeError("Invalid memory remember request identity.");
    const operationId = `memory_${canonicalSha256({
      actorId: memoryActorId,
      bindingSha256: workingBinding.bindingSha256,
      requestId,
      v: 1
    }).slice(0, 48)}`;
    const operation = await ingress.commit({
      actorId: memoryActorId,
      expectedHead: value.expectedHead,
      instant: isoInstant(new Date(wallClock())),
      operationId,
      puts: value.puts,
      tombstones: value.tombstones,
      v: 1
    });
    const head = {
      generation: operation.sequence,
      graphRevisionSha256: operation.graphRevisionSha256,
      operationSha256: operation.operationSha256,
      recordsSha256: operation.recordsSha256,
      sequence: operation.sequence,
      v: 1
    };
    const payload = {
      actorId: operation.actorId,
      authorityId: workingAuthorityId,
      bindingSha256: workingBinding.bindingSha256,
      head,
      instant: operation.instant,
      lane: "working",
      operationSha256: operation.operationSha256,
      requestId,
      status: "committed",
      v: 1
    };
    return immutableClone({ ...payload, receiptSha256: canonicalSha256(payload) });
  };
  const query = async (value) => {
    const request = parseQueryRequestV2(value);
    const program = programs.get(request.programId);
    if (program === undefined)
      throw new TypeError("Unknown named V2 memory program.");
    const bound = parseBindingsV2(request.bindingsValue, program.parameters);
    const requestedContinuation = request.continuation === null ? null : parseContinuationV2(request.continuation, continuationKey);
    if (requestedContinuation !== null && (requestedContinuation.bindingsSha256 !== bound.bindingsSha256 || requestedContinuation.pageSize !== program.pageSize || requestedContinuation.programSha256 !== program.programSha256 || requestedContinuation.totalRows > program.maximumRows || requestedContinuation.nextOffset >= requestedContinuation.totalRows || requestedContinuation.nextOffset % program.pageSize !== 0)) {
      throw new OhIntegrityError("The memory continuation does not match this exact program, binding, and page identity.");
    }
    const boundQuery = bindQueryV2(program.query, bound.bindings);
    const working = await readLane({
      authorityId: workingAuthorityId,
      binding: workingBinding,
      store: workingStore
    }, "working");
    const composite = createCompositeDataset(canonical, working, extractors);
    const projection = evaluateOhProjectionV1({
      dataset: composite.dataset,
      options: program.evaluation,
      query: boundQuery,
      rulePack: program.rulePack,
      snapshot: composite.snapshot
    });
    if (projection.stats.truncated) {
      const reasons = projection.stats.truncationReasons.join(", ");
      throw new RangeError(`The V2 memory projection was truncated (${reasons}); no page was returned.`);
    }
    if (projection.rows.length > program.maximumRows) {
      throw new RangeError("The V2 memory projection exceeds its host-declared row bound.");
    }
    const identityPayload = {
      bindings: bound.bindings,
      bindingsSha256: bound.bindingsSha256,
      boundQuerySha256: boundQuery.querySha256,
      canonical: laneIdentity(canonical),
      compositeDatasetSha256: composite.dataset.datasetSha256,
      conflictPolicy: OH_MEMORY_CONFLICT_POLICY_V1,
      evaluationSha256: projection.identity.evaluationSha256,
      programId: program.programId,
      programSha256: program.programSha256,
      projectionSha256: projection.identity.projectionSha256,
      purpose: program.purpose,
      rulePackSha256: program.rulePack.rulePackSha256,
      templateQuerySha256: program.query.querySha256,
      v: 2,
      working: laneIdentity(working)
    };
    const identity = immutableClone({
      ...identityPayload,
      memorySha256: canonicalSha256(identityPayload)
    });
    if (requestedContinuation !== null && (requestedContinuation.memorySha256 !== identity.memorySha256 || requestedContinuation.projectionResultSha256 !== projection.resultSha256)) {
      throw new OhIntegrityError("The memory continuation does not match this exact source and projection identity.");
    }
    if (requestedContinuation !== null && (requestedContinuation.totalRows !== projection.rows.length || requestedContinuation.nextOffset >= projection.rows.length || requestedContinuation.nextOffset % program.pageSize !== 0)) {
      throw new OhIntegrityError("The memory continuation does not match this exact row identity.");
    }
    const start = requestedContinuation?.nextOffset ?? 0;
    const endExclusive = Math.min(start + program.pageSize, projection.rows.length);
    const projectionRows = projection.rows.slice(start, endExclusive);
    const proofs = immutableClone(projectionRows.map((row) => row.proofs.map((proof) => mapProof(proof, composite.sources, composite.factPolicies))));
    const rows = immutableClone(projectionRows.map((row, index) => publicRowV2(row, proofs[index])));
    const hasMore = endExclusive < projection.rows.length;
    const page = immutableClone({
      completeness: hasMore ? "partial" : "complete",
      endExclusive,
      hasMore,
      maximumPageBytes: program.maximumPageBytes,
      pageSize: program.pageSize,
      returnedRows: rows.length,
      start,
      totalRows: projection.rows.length,
      truncation: { reasons: [], truncated: false, v: 2 },
      v: 2
    });
    const issuedContinuation = hasMore ? encodeContinuationV2({
      bindingsSha256: bound.bindingsSha256,
      memorySha256: identity.memorySha256,
      nextOffset: endExclusive,
      pageSize: program.pageSize,
      programSha256: program.programSha256,
      projectionResultSha256: projection.resultSha256,
      totalRows: projection.rows.length,
      v: 2
    }, continuationKey) : null;
    const continuation = issuedContinuation?.continuation ?? null;
    const continuationSha256 = issuedContinuation?.continuationSha256 ?? null;
    const conflicts = immutableClone({
      count: composite.conflicts.length,
      conflictsSha256: canonicalSha256(composite.conflicts),
      v: 2
    });
    const resultIdentityPayload = immutableClone({
      authority: "derived",
      conflicts,
      continuationSha256,
      identity,
      page,
      projectionResultSha256: projection.resultSha256,
      rows,
      v: 2
    });
    const resultSha256 = canonicalSha256(resultIdentityPayload);
    const resultPayload = immutableClone({ ...resultIdentityPayload, continuation });
    const issuedAt = wallClock();
    const issuedAtMonotonic = monotonicClock();
    const expiresAtMs = issuedAt + capabilityLifetime;
    const expiresAtMonotonicMs = issuedAtMonotonic + capabilityLifetime;
    const expiresAt = isoInstant(new Date(expiresAtMs));
    const pageBytePreflight = {
      ...resultPayload,
      explainCapability: { expiresAt, token: "A".repeat(43), v: 2 },
      resultSha256
    };
    if (utf8ByteLength(canonicalJson(pageBytePreflight)) > program.maximumPageBytes) {
      throw new RangeError("The V2 memory page exceeds its host-declared canonical byte bound.");
    }
    for (const [existingToken, stored] of explanations) {
      if (issuedAtMonotonic >= stored.expiresAtMonotonicMs)
        deleteExplanation(existingToken);
    }
    const storedPayload = immutableClone({
      expiresAtMonotonicMs,
      identity,
      page,
      proofs,
      resultSha256,
      rows
    });
    const storedBytes = utf8ByteLength(canonicalJson(storedPayload)) + 128;
    if (storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityEntryBytes || storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityTotalBytes) {
      throw new RangeError("The V2 memory explanation exceeds its retained capability bound.");
    }
    while (explanations.size >= OH_MEMORY_LIMITS_V1.explainCapabilities || explanationBytes + storedBytes > OH_MEMORY_LIMITS_V1.explainCapabilityTotalBytes) {
      const oldest = explanations.keys().next().value;
      if (oldest === undefined)
        break;
      deleteExplanation(oldest);
    }
    let token = randomBytes2(32).toString("base64url");
    while (explanations.has(token))
      token = randomBytes2(32).toString("base64url");
    explanations.set(token, immutableClone({ ...storedPayload, bytes: storedBytes }));
    explanationBytes += storedBytes;
    const result = immutableClone({
      ...resultPayload,
      explainCapability: { expiresAt, token, v: 2 },
      resultSha256
    });
    if (utf8ByteLength(canonicalJson(result)) > program.maximumPageBytes) {
      deleteExplanation(token);
      throw new RangeError("The V2 memory page exceeds its host-declared canonical byte bound.");
    }
    return result;
  };
  const explain = async (value) => {
    const request = parseExplainRequestV2(value);
    const stored = explanations.get(request.token);
    const currentTime = monotonicClock();
    if (stored === undefined || stored.resultSha256 !== request.resultSha256 || currentTime >= stored.expiresAtMonotonicMs) {
      deleteExplanation(request.token);
      throw new OhProfileError("The V2 memory explanation capability is absent, expired, or misbound.");
    }
    const row = stored.rows[request.pageRow];
    const proofs = stored.proofs[request.pageRow];
    if (row === undefined || proofs === undefined)
      throw new RangeError("The explanation page row is out of bounds.");
    const payload = {
      authority: "derived",
      identity: stored.identity,
      page: stored.page,
      pageRow: request.pageRow,
      premiseAuthority: row.premiseAuthority,
      premiseLanes: row.premiseLanes,
      proofs,
      proofsTruncated: row.proofsTruncated,
      resultRowSha256: row.resultRowSha256,
      resultSha256: stored.resultSha256,
      supportCount: row.supportCount,
      v: 2,
      values: row.values
    };
    return immutableClone({ ...payload, explanationSha256: canonicalSha256(payload) });
  };
  const nominate = async (value) => {
    const request = parseNominationRequest(value);
    const route = nominationRoutes.get(request.nominationId);
    if (route === undefined)
      throw new TypeError("Unknown named memory nomination route.");
    const head = parseOhHeadV1(immutableClone(await workingStore.head()));
    if (head === null)
      throw new OhIntegrityError("The working nomination store returned an invalid head.");
    const closure = await workingStore.exportDependencyClosure({ head: {
      operationSha256: head.operationSha256,
      sequence: head.sequence
    }, roots: request.roots });
    const verified = verifyOhDependencyClosureAgainstV1(closure, { binding: workingBinding, head });
    if (!verified.ok)
      throw new OhIntegrityError("The working nomination closure failed exact verification.");
    if (canonicalJson(verified.closure.roots) !== canonicalJson(request.roots)) {
      throw new OhIntegrityError("The working nomination closure substituted different roots.");
    }
    const source = Object.freeze({
      authorityId: workingAuthorityId,
      bindingSha256: workingBinding.bindingSha256,
      head,
      lane: "working",
      v: 1
    });
    const payload = {
      closure: verified.closure,
      destinationPurpose: route.destinationPurpose,
      nominationId: route.nominationId,
      source,
      status: "prepared",
      v: 1
    };
    return immutableClone({ ...payload, nominationSha256: canonicalSha256(payload) });
  };
  return Object.freeze({ explain, nominate, query, remember });
}
export {
  renderOhMemoryPageMarkdownV1,
  parseOhMemoryPageValueV1,
  parseOhMemoryPageRecordV1,
  parseOhMemoryPageMarkdownV1,
  createOhMemoryPageValueV1,
  createOhMemoryPageRecordV1,
  createOhMemoryAgentV2,
  createOhMemoryAgentV1,
  OH_MEMORY_QUERY_LIMITS_V2,
  OH_MEMORY_PAGE_RECORD_CODEC_V1,
  OH_MEMORY_PAGE_MARKDOWN_EXTENSION_V1,
  OH_MEMORY_PAGE_LIMITS_V1,
  OH_MEMORY_PAGE_FORMAT_V1,
  OH_MEMORY_LIMITS_V1,
  OH_MEMORY_FORMAT_VERSION_V1,
  OH_MEMORY_CONFLICT_POLICY_V1,
  OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1
};
