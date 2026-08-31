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

// src/libsql.ts
var OH_LIBSQL_STORE_LIMITS_V1 = Object.freeze({
  changesPerCommit: 64,
  changeFeedLimit: 7,
  dependenciesPerCommit: 512,
  historyBytes: 4 * 1024 * 1024,
  historyOperations: 16384,
  operationBytes: 512 * 1024,
  providerResponseBytes: 9000000,
  snapshotComponentBytes: 6 * 1024 * 1024
});
var AUTHORITY_SCHEMA_NAME = "oh.libsql-authority.v1";
var AUTHORITY_SCHEMA_VERSION = 1;
var EMPTY_RECORDS_SHA2562 = canonicalSha256([]);
var PURGE_ROW_SELECT = `SELECT space_id, binding_sha256, prior_operation_sha256,
  prior_sequence, purged_at, receipt_sha256, receipt_json
  FROM oh_authority_purges WHERE space_id = ?`;
var BINDING_ROW_SELECT = `SELECT space_id, realm_id, profile_id, profile_kind,
  profile_sha256, binding_sha256, binding_json FROM oh_authority_bindings WHERE space_id = ?`;
var SPACE_PURGE_PROOF_SELECT = `SELECT generation, graph_revision_sha256, head_operation_sha256,
  records_sha256, sequence, contract_id FROM oh_authority_spaces WHERE space_id = ?`;
var OPERATION_ROW_COLUMNS = `operation_sha256, space_id, sequence, operation_id,
  parent_operation_sha256, graph_revision_sha256, records_sha256, operation_json, instant`;
var OPERATION_RESPONSE_BYTES = `2 * length(CAST(operation.operation_json AS BLOB))
  + 2 * (length(operation.operation_sha256) + length(operation.space_id)
    + length(operation.operation_id) + coalesce(length(operation.parent_operation_sha256), 0)
    + length(operation.graph_revision_sha256) + length(operation.records_sha256)
    + length(operation.instant)) + 512`;
var RECORD_RESPONSE_BYTES = `2 * length(CAST(record.record_json AS BLOB))
  + 2 * (length(record.record_key) + length(record.kind) + length(record.record_sha256)
    + length(record.operation_sha256)) + 384`;
var DEPENDENCY_RESPONSE_BYTES = `2 * (length(dependency.record_key)
  + length(dependency.dependency_key)) + 192`;
var OPERATION_RECORD_RESPONSE_BYTES = `2 * (length(materialized.space_id)
  + length(materialized.operation_sha256) + length(materialized.record_key)
  + length(materialized.change_kind) + length(materialized.record_sha256)) + 320`;
var AUTHORITY_SCHEMA_TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS oh_authority_schemas (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;
var AUTHORITY_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS oh_authority_contracts (
    contract_id TEXT PRIMARY KEY,
    contract_sha256 TEXT NOT NULL,
    manifest_json TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_spaces (
    space_id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    head_operation_sha256 TEXT,
    graph_revision_sha256 TEXT,
    records_sha256 TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK(generation = sequence)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_operations (
    operation_sha256 TEXT PRIMARY KEY,
    space_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    operation_id TEXT NOT NULL,
    parent_operation_sha256 TEXT,
    graph_revision_sha256 TEXT NOT NULL,
    records_sha256 TEXT NOT NULL,
    operation_json TEXT NOT NULL,
    instant TEXT NOT NULL,
    UNIQUE(space_id, sequence),
    UNIQUE(space_id, operation_id)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_operation_records (
    space_id TEXT NOT NULL,
    operation_sha256 TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    record_key TEXT NOT NULL,
    change_kind TEXT NOT NULL CHECK(change_kind IN ('put', 'tombstone')),
    record_sha256 TEXT NOT NULL,
    PRIMARY KEY(operation_sha256, ordinal),
    UNIQUE(operation_sha256, record_key)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_records (
    space_id TEXT NOT NULL,
    record_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    record_sha256 TEXT NOT NULL,
    record_json TEXT NOT NULL,
    operation_sha256 TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK(sequence > 0),
    PRIMARY KEY(space_id, record_key)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_dependencies (
    space_id TEXT NOT NULL,
    record_key TEXT NOT NULL,
    dependency_key TEXT NOT NULL,
    PRIMARY KEY(space_id, record_key, dependency_key)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_bindings (
    space_id TEXT PRIMARY KEY,
    realm_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    profile_kind TEXT NOT NULL CHECK(profile_kind IN ('canonical', 'working')),
    profile_sha256 TEXT NOT NULL,
    binding_sha256 TEXT NOT NULL UNIQUE,
    binding_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_purges (
    space_id TEXT PRIMARY KEY,
    binding_sha256 TEXT NOT NULL,
    prior_operation_sha256 TEXT,
    prior_sequence INTEGER NOT NULL CHECK(prior_sequence >= 0),
    purged_at TEXT NOT NULL,
    receipt_sha256 TEXT NOT NULL UNIQUE,
    receipt_json TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_authority_commit_guards (
    value TEXT NOT NULL CHECK(value = 'ok')
  ) STRICT`,
  "CREATE INDEX IF NOT EXISTS oh_authority_operations_space_sequence ON oh_authority_operations(space_id, sequence)",
  "CREATE INDEX IF NOT EXISTS oh_authority_records_space_kind ON oh_authority_records(space_id, kind, record_key)",
  "CREATE INDEX IF NOT EXISTS oh_authority_dependencies_dependency ON oh_authority_dependencies(space_id, dependency_key)",
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operations_no_update
    BEFORE UPDATE ON oh_authority_operations
    BEGIN SELECT RAISE(ABORT, 'Oh authority operations are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operations_guard_delete
    BEFORE DELETE ON oh_authority_operations
    WHEN NOT EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = OLD.space_id)
    BEGIN SELECT RAISE(ABORT, 'Oh authority operations require a purge receipt'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operation_records_no_update
    BEFORE UPDATE ON oh_authority_operation_records
    BEGIN SELECT RAISE(ABORT, 'Oh authority operation records are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operation_records_guard_insert
    BEFORE INSERT ON oh_authority_operation_records
    WHEN NOT EXISTS (SELECT 1 FROM oh_authority_operations
      WHERE operation_sha256 = NEW.operation_sha256 AND space_id = NEW.space_id)
    BEGIN SELECT RAISE(ABORT, 'Oh authority operation record has no owning operation'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_operation_records_guard_delete
    BEFORE DELETE ON oh_authority_operation_records
    WHEN NOT EXISTS (SELECT 1 FROM oh_authority_operations AS operation
      JOIN oh_authority_purges AS purge ON purge.space_id = operation.space_id
      WHERE operation.operation_sha256 = OLD.operation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh authority operation records require a purge receipt'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_purges_immutable_update
    BEFORE UPDATE ON oh_authority_purges
    BEGIN SELECT RAISE(ABORT, 'Oh authority purge receipts are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_authority_purges_immutable_delete
    BEFORE DELETE ON oh_authority_purges
    BEGIN SELECT RAISE(ABORT, 'Oh authority purge receipts are immutable'); END`
]);
function normalizedSchemaSql(sql) {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\b/giu, "").replace(/\s+/gu, " ").trim();
}
function expectedSchemaObject(statement) {
  const match = /^CREATE\s+(TABLE|INDEX|TRIGGER)(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z0-9_]+)/iu.exec(statement.trim());
  if (match === null)
    throw new Error("Invalid compiled authority schema statement.");
  const declaredType = match[1]?.toLowerCase();
  const type = declaredType === "index" ? "index" : declaredType === "trigger" ? "trigger" : "table";
  const name = match[2];
  const tableMatch = type === "index" || type === "trigger" ? /\bON\s+([a-z0-9_]+)/iu.exec(statement) : null;
  const tableName = type === "table" ? name : tableMatch?.[1];
  if (tableName === undefined)
    throw new Error("Invalid compiled authority index statement.");
  return { name, sql: normalizedSchemaSql(statement), tableName, type };
}
var AUTHORITY_SCHEMA_OBJECTS = Object.freeze([AUTHORITY_SCHEMA_TABLE_STATEMENT, ...AUTHORITY_SCHEMA_STATEMENTS].map(expectedSchemaObject).sort((left, right) => canonicalJson([left.type, left.name]).localeCompare(canonicalJson([right.type, right.name]))));
var AUTHORITY_SCHEMA_SHA256 = canonicalSha256(AUTHORITY_SCHEMA_OBJECTS);
function rowValue(row, key, index) {
  return Array.isArray(row) ? row[index] : row[key];
}
function integer(value) {
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}
function normalizeLimit(value, fallback = 100, maximum = 1000) {
  const limit = value ?? fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new RangeError(`limit must be an integer from 1 through ${maximum}.`);
  }
  return limit;
}
function parseOperationJson(value) {
  if (typeof value !== "string")
    throw new OhIntegrityError("A stored operation is not JSON text.");
  let parsedValue;
  try {
    parsedValue = JSON.parse(value);
  } catch {
    throw new OhIntegrityError("A stored operation is not JSON.");
  }
  const operation = parseOhOperationV1(parsedValue);
  if (operation === null || canonicalJson(operation) !== value) {
    throw new OhIntegrityError("A stored operation is invalid.");
  }
  return operation;
}
function parseOperationRow(row, expected = {}) {
  const operation = parseOperationJson(rowValue(row, "operation_json", 7));
  if (rowValue(row, "operation_sha256", 0) !== operation.operationSha256 || rowValue(row, "space_id", 1) !== operation.spaceId || integer(rowValue(row, "sequence", 2)) !== operation.sequence || rowValue(row, "operation_id", 3) !== operation.operationId || rowValue(row, "parent_operation_sha256", 4) !== operation.parentOperationSha256 || rowValue(row, "graph_revision_sha256", 5) !== operation.graphRevisionSha256 || rowValue(row, "records_sha256", 6) !== operation.recordsSha256 || rowValue(row, "instant", 8) !== operation.instant || expected.spaceId !== undefined && operation.spaceId !== expected.spaceId || expected.operationId !== undefined && operation.operationId !== expected.operationId || expected.operationSha256 !== undefined && operation.operationSha256 !== expected.operationSha256) {
    throw new OhIntegrityError("Remote operation columns do not match their canonical envelope.");
  }
  return operation;
}
function parseBindingRow(row, expectedSpaceId) {
  const json = rowValue(row, "binding_json", 6);
  if (typeof json !== "string")
    throw new OhIntegrityError("A remote store binding is not JSON text.");
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new OhIntegrityError("A remote store binding is not JSON.");
  }
  const binding = parseOhStoreBindingV1(value);
  if (binding === null || canonicalJson(binding) !== json || binding.spaceId !== expectedSpaceId || rowValue(row, "space_id", 0) !== binding.spaceId || rowValue(row, "realm_id", 1) !== binding.realmId || rowValue(row, "profile_id", 2) !== binding.profile.profileId || rowValue(row, "profile_kind", 3) !== binding.profile.profileKind || rowValue(row, "profile_sha256", 4) !== binding.profile.profileSha256 || rowValue(row, "binding_sha256", 5) !== binding.bindingSha256) {
    throw new OhIntegrityError("Remote binding columns do not match their canonical envelope.");
  }
  return binding;
}
function parsePurgeReceiptRow(row, expectedSpaceId, expectedBindingSha256) {
  const json = rowValue(row, "receipt_json", 6);
  if (typeof json !== "string")
    throw new OhIntegrityError("A remote purge receipt is invalid.");
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new OhIntegrityError("A remote purge receipt is invalid.");
  }
  const receipt = parseOhSpacePurgeReceiptV1(value);
  if (receipt === null || canonicalJson(receipt) !== json) {
    throw new OhIntegrityError("A remote purge receipt is invalid.");
  }
  if (receipt.spaceId !== expectedSpaceId || expectedBindingSha256 !== undefined && receipt.bindingSha256 !== expectedBindingSha256 || rowValue(row, "space_id", 0) !== receipt.spaceId || rowValue(row, "binding_sha256", 1) !== receipt.bindingSha256 || rowValue(row, "prior_operation_sha256", 2) !== receipt.priorHead.operationSha256 || integer(rowValue(row, "prior_sequence", 3)) !== receipt.priorHead.sequence || rowValue(row, "purged_at", 4) !== receipt.purgedAt || rowValue(row, "receipt_sha256", 5) !== receipt.receiptSha256) {
    throw new OhIntegrityError("Remote purge columns do not match their canonical receipt.");
  }
  return receipt;
}
function parseHeadRow(row) {
  const generation = integer(rowValue(row, "generation", 0));
  const graphValue = rowValue(row, "graph_revision_sha256", 1);
  const operationValue = rowValue(row, "head_operation_sha256", 2);
  const recordsSha256 = parseSha256Hex(rowValue(row, "records_sha256", 3));
  const sequence = integer(rowValue(row, "sequence", 4));
  const graphRevisionSha256 = graphValue === null ? null : parseSha256Hex(graphValue);
  const operationSha256 = operationValue === null ? null : parseSha256Hex(operationValue);
  if (generation === null || sequence === null || generation !== sequence || recordsSha256 === null || graphValue !== null && graphRevisionSha256 === null || operationValue !== null && operationSha256 === null || sequence === 0 !== (operationSha256 === null) || sequence === 0 !== (graphRevisionSha256 === null)) {
    throw new OhIntegrityError("The remote authority contains an invalid head.");
  }
  return { generation, graphRevisionSha256, operationSha256, recordsSha256, sequence, v: 1 };
}
async function queryOne(client, statement) {
  return (await client.execute(statement)).rows[0] ?? null;
}
async function verifyAuthoritySchemaObjects(client) {
  const rows = (await client.execute({ sql: `SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND (name = 'oh_authority_schemas' OR name GLOB 'oh_authority_*'
      OR tbl_name GLOB 'oh_authority_*')
    ORDER BY type, name` })).rows;
  const actual = rows.map((row) => {
    const type = rowValue(row, "type", 0);
    const name = rowValue(row, "name", 1);
    const tableName = rowValue(row, "tbl_name", 2);
    const sql = rowValue(row, "sql", 3);
    if (type !== "table" && type !== "index" && type !== "trigger" || typeof name !== "string" || typeof tableName !== "string" || typeof sql !== "string") {
      throw new OhIntegrityError("The installed libSQL authority has an invalid schema object.");
    }
    return { name, sql: normalizedSchemaSql(sql), tableName, type };
  });
  if (canonicalJson(actual) !== canonicalJson(AUTHORITY_SCHEMA_OBJECTS)) {
    throw new OhIntegrityError("The installed libSQL authority objects differ from this runtime.");
  }
}
async function verifyAuthoritySchema(client) {
  const installed = await queryOne(client, { sql: `SELECT name, schema_sha256
    FROM oh_authority_schemas WHERE version = ?`, args: [AUTHORITY_SCHEMA_VERSION] });
  if (installed === null || rowValue(installed, "name", 0) !== AUTHORITY_SCHEMA_NAME || rowValue(installed, "schema_sha256", 1) !== AUTHORITY_SCHEMA_SHA256) {
    throw new OhIntegrityError("The installed libSQL authority schema differs from this runtime.");
  }
  const contract = await queryOne(client, { sql: `SELECT contract_sha256, manifest_json
    FROM oh_authority_contracts WHERE contract_id = ?`, args: [OH_CONTRACT_MANIFEST_V1.contractId] });
  if (contract === null || rowValue(contract, "contract_sha256", 0) !== OH_CONTRACT_MANIFEST_V1.contractSha256 || rowValue(contract, "manifest_json", 1) !== canonicalJson(OH_CONTRACT_MANIFEST_V1)) {
    throw new OhIntegrityError("The remote authority contract differs from this runtime.");
  }
  await verifyAuthoritySchemaObjects(client);
}
async function bootstrapOhLibSqlAuthorityV1(client) {
  const existingObjects = (await client.execute({ sql: `SELECT name FROM sqlite_schema
    WHERE sql IS NOT NULL AND (name = 'oh_authority_schemas' OR name GLOB 'oh_authority_*'
      OR tbl_name GLOB 'oh_authority_*')` })).rows;
  if (existingObjects.length > 0) {
    if (!existingObjects.some((row) => rowValue(row, "name", 0) === "oh_authority_schemas")) {
      throw new OhIntegrityError("Refusing to bootstrap over preexisting Oh authority objects.");
    }
    await verifyAuthoritySchema(client);
    return { schemaSha256: AUTHORITY_SCHEMA_SHA256, schemaVersion: 1, v: 1 };
  }
  const setup = [AUTHORITY_SCHEMA_TABLE_STATEMENT, ...AUTHORITY_SCHEMA_STATEMENTS].map((sql) => ({ sql }));
  setup.push({
    sql: `INSERT INTO oh_authority_schemas(version, name, schema_sha256, applied_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(version) DO NOTHING`,
    args: [AUTHORITY_SCHEMA_VERSION, AUTHORITY_SCHEMA_NAME, AUTHORITY_SCHEMA_SHA256, canonicalNow()]
  });
  setup.push({ sql: `INSERT INTO oh_authority_contracts(contract_id, contract_sha256, manifest_json)
    VALUES (?, ?, ?) ON CONFLICT(contract_id) DO NOTHING`, args: [
    OH_CONTRACT_MANIFEST_V1.contractId,
    OH_CONTRACT_MANIFEST_V1.contractSha256,
    canonicalJson(OH_CONTRACT_MANIFEST_V1)
  ] });
  await client.batch(setup, "write");
  await verifyAuthoritySchema(client);
  return { schemaSha256: AUTHORITY_SCHEMA_SHA256, schemaVersion: 1, v: 1 };
}
async function initializeSpace(client, binding) {
  const purged = await queryOne(client, {
    sql: PURGE_ROW_SELECT,
    args: [binding.spaceId]
  });
  if (purged !== null)
    throw new OhPurgedSpaceError(parsePurgeReceiptRow(purged, binding.spaceId, binding.bindingSha256));
  const now = canonicalNow();
  try {
    await client.batch([
      {
        sql: `INSERT INTO oh_authority_spaces(space_id, contract_id, generation,
      head_operation_sha256, graph_revision_sha256, records_sha256, sequence, created_at, updated_at)
      SELECT ?, ?, 0, NULL, NULL, ?, 0, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ?)
      ON CONFLICT(space_id) DO NOTHING`,
        args: [
          binding.spaceId,
          OH_CONTRACT_MANIFEST_V1.contractId,
          EMPTY_RECORDS_SHA2562,
          now,
          now,
          binding.spaceId
        ]
      },
      {
        sql: `INSERT INTO oh_authority_bindings(space_id, realm_id, profile_id, profile_kind,
      profile_sha256, binding_sha256, binding_json, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ?)
        AND EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
      ON CONFLICT(space_id) DO NOTHING`,
        args: [
          binding.spaceId,
          binding.realmId,
          binding.profile.profileId,
          binding.profile.profileKind,
          binding.profile.profileSha256,
          binding.bindingSha256,
          canonicalJson(binding),
          now,
          binding.spaceId,
          binding.spaceId
        ]
      },
      {
        sql: `INSERT INTO oh_authority_commit_guards(value)
      SELECT 'invalid' WHERE EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ?)
        OR NOT EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
        OR NOT EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ? AND binding_sha256 = ?)`,
        args: [binding.spaceId, binding.spaceId, binding.spaceId, binding.bindingSha256]
      }
    ], "write");
  } catch (error) {
    const raced = await queryOne(client, {
      sql: PURGE_ROW_SELECT,
      args: [binding.spaceId]
    });
    if (raced !== null)
      throw new OhPurgedSpaceError(parsePurgeReceiptRow(raced, binding.spaceId, binding.bindingSha256));
    const persisted2 = await queryOne(client, { sql: BINDING_ROW_SELECT, args: [binding.spaceId] });
    if (persisted2 !== null && canonicalJson(parseBindingRow(persisted2, binding.spaceId)) !== canonicalJson(binding)) {
      throw new OhProfileError("The remote space is already bound to a different realm or profile.");
    }
    throw error;
  }
  const persisted = await queryOne(client, { sql: BINDING_ROW_SELECT, args: [binding.spaceId] });
  if (persisted === null) {
    const raced = await queryOne(client, {
      sql: PURGE_ROW_SELECT,
      args: [binding.spaceId]
    });
    if (raced !== null)
      throw new OhPurgedSpaceError(parsePurgeReceiptRow(raced, binding.spaceId, binding.bindingSha256));
    throw new OhIntegrityError("The remote space has no persisted binding after initialization.");
  }
  if (canonicalJson(parseBindingRow(persisted, binding.spaceId)) !== canonicalJson(binding)) {
    throw new OhProfileError("The remote space is already bound to a different realm or profile.");
  }
}
async function requireExistingSpace(client, binding) {
  const results = await client.batch([
    { sql: BINDING_ROW_SELECT, args: [binding.spaceId] },
    {
      sql: `SELECT generation, graph_revision_sha256, head_operation_sha256,
      records_sha256, sequence, contract_id FROM oh_authority_spaces WHERE space_id = ?`,
      args: [binding.spaceId]
    },
    { sql: PURGE_ROW_SELECT, args: [binding.spaceId] }
  ], "read");
  if (results.length !== 3) {
    throw new OhIntegrityError("The remote authority returned an incomplete existing-space proof.");
  }
  const [bindingResult, spaceResult, purgeResult] = results;
  const purgeRow = purgeResult.rows[0];
  if (purgeRow !== undefined) {
    throw new OhPurgedSpaceError(parsePurgeReceiptRow(purgeRow, binding.spaceId, binding.bindingSha256));
  }
  const bindingRow = bindingResult.rows[0];
  const spaceRow = spaceResult.rows[0];
  if (bindingRow === undefined || spaceRow === undefined) {
    throw new OhIntegrityError("The requested remote Oh space does not already exist.");
  }
  const persisted = parseBindingRow(bindingRow, binding.spaceId);
  if (canonicalJson(persisted) !== canonicalJson(binding)) {
    throw new OhProfileError("The remote space is bound to a different realm or profile.");
  }
  if (rowValue(spaceRow, "contract_id", 5) !== OH_CONTRACT_MANIFEST_V1.contractId) {
    throw new OhIntegrityError("The existing remote space uses a different Oh contract.");
  }
  parseHeadRow(spaceRow);
}
var PURGE_PAYLOAD_TABLES = [
  "oh_authority_spaces",
  "oh_authority_bindings",
  "oh_authority_operations",
  "oh_authority_operation_records",
  "oh_authority_records",
  "oh_authority_dependencies"
];
async function assertRemotePurgeComplete(client, binding, expected) {
  const results = await client.batch([
    { sql: PURGE_ROW_SELECT, args: [binding.spaceId] },
    ...PURGE_PAYLOAD_TABLES.map((table) => ({
      sql: `SELECT count(*) AS count FROM ${table} WHERE space_id = ?`,
      args: [binding.spaceId]
    })),
    { sql: `SELECT count(*) AS count FROM oh_authority_operation_records AS materialized
      LEFT JOIN oh_authority_operations AS operation
        ON operation.operation_sha256 = materialized.operation_sha256
      WHERE operation.operation_sha256 IS NULL OR operation.space_id <> materialized.space_id` }
  ], "read");
  const receiptRow = results[0]?.rows[0];
  if (receiptRow === undefined || canonicalJson(parsePurgeReceiptRow(receiptRow, binding.spaceId, binding.bindingSha256)) !== canonicalJson(expected)) {
    throw new OhIntegrityError("The remote purge receipt differs from the requested purge.");
  }
  for (let index = 0;index < PURGE_PAYLOAD_TABLES.length; index += 1) {
    const countRow = results[index + 1]?.rows[0];
    if (countRow === undefined || integer(rowValue(countRow, "count", 0)) !== 0) {
      throw new OhIntegrityError(`Remote purge left rows in ${PURGE_PAYLOAD_TABLES[index]}.`);
    }
  }
  const orphanRow = results[PURGE_PAYLOAD_TABLES.length + 1]?.rows[0];
  if (orphanRow === undefined || integer(rowValue(orphanRow, "count", 0)) !== 0) {
    throw new OhIntegrityError("Remote purge left an orphaned or cross-space operation record.");
  }
}

class OhLibSqlStoreV1 {
  binding;
  #client;
  #closeClient;
  #closed = false;
  #purged = null;
  constructor(client, binding, closeClient) {
    this.#client = client;
    this.binding = binding;
    this.#closeClient = closeClient;
  }
  #assertOpen() {
    if (this.#purged !== null)
      throw new OhPurgedSpaceError(this.#purged);
    if (this.#closed)
      throw new Error("The Oh libSQL store is closed.");
  }
  async head() {
    this.#assertOpen();
    const row = await queryOne(this.#client, {
      sql: `SELECT generation, graph_revision_sha256,
      head_operation_sha256, records_sha256, sequence FROM oh_authority_spaces WHERE space_id = ?`,
      args: [this.binding.spaceId]
    });
    if (row === null) {
      const purged = await this.#readPurge();
      if (purged !== null) {
        this.#purged = purged;
        throw new OhPurgedSpaceError(purged);
      }
      throw new OhIntegrityError("The remote Oh space does not exist.");
    }
    return parseHeadRow(row);
  }
  async#readPurge() {
    const row = await queryOne(this.#client, {
      sql: PURGE_ROW_SELECT,
      args: [this.binding.spaceId]
    });
    if (row === null)
      return null;
    return parsePurgeReceiptRow(row, this.binding.spaceId, this.binding.bindingSha256);
  }
  async#headAt(reference) {
    const parsed = parseOhHeadRefV1(reference);
    if (parsed === null)
      throw new TypeError("Invalid Oh head reference.");
    if (parsed.sequence === 0)
      return emptyOhHeadV1();
    const row = await queryOne(this.#client, { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
      WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, parsed.sequence] });
    if (row === null)
      throw new OhConflictError("The requested head is not present in this space.");
    const operation = parseOperationRow(row, { spaceId: this.binding.spaceId });
    if (operation.spaceId !== this.binding.spaceId || operation.sequence !== parsed.sequence || operation.operationSha256 !== parsed.operationSha256) {
      throw new OhConflictError("The requested sequence identifies a different operation head.");
    }
    return {
      generation: operation.sequence,
      graphRevisionSha256: operation.graphRevisionSha256,
      operationSha256: operation.operationSha256,
      recordsSha256: operation.recordsSha256,
      sequence: operation.sequence,
      v: 1
    };
  }
  async#currentMaterializedSnapshot(expectedHead, maximumRecords) {
    const provenancePredicate = `operation.space_id = ? AND (operation.operation_sha256 IS ?
      OR operation.operation_sha256 IN (SELECT record.operation_sha256
        FROM oh_authority_records AS record WHERE record.space_id = ?))`;
    const results = await this.#client.batch([
      { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] },
      {
        sql: `SELECT
          (SELECT count(*) FROM (SELECT DISTINCT operation.operation_sha256
            FROM oh_authority_operations AS operation WHERE ${provenancePredicate})) AS provenance_count,
          (SELECT coalesce(sum(bytes), 0) FROM (SELECT DISTINCT operation.operation_sha256,
            ${OPERATION_RESPONSE_BYTES} AS bytes FROM oh_authority_operations AS operation
            WHERE ${provenancePredicate})) AS provenance_bytes,
          (SELECT count(*) FROM oh_authority_records WHERE space_id = ?) AS record_count,
          (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0) FROM oh_authority_records AS record
            WHERE record.space_id = ?) AS record_bytes,
          (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
            FROM oh_authority_dependencies AS dependency
            WHERE dependency.space_id = ?) AS dependency_bytes`,
        args: [
          this.binding.spaceId,
          expectedHead.operationSha256,
          this.binding.spaceId,
          this.binding.spaceId,
          expectedHead.operationSha256,
          this.binding.spaceId,
          this.binding.spaceId,
          this.binding.spaceId,
          this.binding.spaceId
        ]
      },
      { sql: `SELECT record_key, kind, record_sha256, record_json, operation_sha256, sequence
        FROM oh_authority_records AS record WHERE record.space_id = ?
          AND (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0)
            FROM oh_authority_records AS record WHERE record.space_id = ?) <= ? ORDER BY record_key`, args: [
        this.binding.spaceId,
        this.binding.spaceId,
        OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes
      ] },
      {
        sql: `SELECT record_key, dependency_key FROM oh_authority_dependencies
        AS dependency WHERE dependency.space_id = ?
          AND (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
            FROM oh_authority_dependencies AS dependency WHERE dependency.space_id = ?) <= ?
        ORDER BY record_key, dependency_key`,
        args: [this.binding.spaceId, this.binding.spaceId, OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes]
      },
      {
        sql: `SELECT ${OPERATION_ROW_COLUMNS}
        FROM oh_authority_operations AS operation
        WHERE ${provenancePredicate}
          AND (SELECT coalesce(sum(bytes), 0) FROM (SELECT DISTINCT candidate.operation_sha256,
            ${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")} AS bytes
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND (candidate.operation_sha256 IS ?
              OR candidate.operation_sha256 IN (SELECT record.operation_sha256
                FROM oh_authority_records AS record WHERE record.space_id = ?)))) <= ?
        ORDER BY operation.sequence`,
        args: [
          this.binding.spaceId,
          expectedHead.operationSha256,
          this.binding.spaceId,
          this.binding.spaceId,
          expectedHead.operationSha256,
          this.binding.spaceId,
          OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes
        ]
      },
      { sql: `SELECT count(*) AS count, min(sequence) AS minimum, max(sequence) AS maximum
        FROM oh_authority_operations WHERE space_id = ?`, args: [this.binding.spaceId] }
    ], "read");
    if (results.length !== 6)
      throw new OhIntegrityError("The remote authority returned an incomplete snapshot batch.");
    const [headResult, sizeResult, recordResult, dependencyResult, provenanceResult, historyResult] = results;
    const headRow = headResult.rows[0];
    if (headRow === undefined) {
      const purge = await this.#readPurge();
      if (purge !== null) {
        this.#purged = purge;
        throw new OhPurgedSpaceError(purge);
      }
      throw new OhIntegrityError("The remote Oh space disappeared while reading its snapshot.");
    }
    const head = parseHeadRow(headRow);
    if (canonicalJson(head) !== canonicalJson(expectedHead)) {
      throw new OhConflictError("The remote space head changed while reading its current snapshot.");
    }
    const size = sizeResult.rows[0];
    const provenanceOperations = size === undefined ? null : integer(rowValue(size, "provenance_count", 0));
    const provenanceBytes = size === undefined ? null : integer(rowValue(size, "provenance_bytes", 1));
    const recordCount = size === undefined ? null : integer(rowValue(size, "record_count", 2));
    const recordBytes = size === undefined ? null : integer(rowValue(size, "record_bytes", 3));
    const dependencyBytes = size === undefined ? null : integer(rowValue(size, "dependency_bytes", 4));
    if (provenanceOperations === null || provenanceBytes === null || recordCount === null || recordBytes === null || dependencyBytes === null || provenanceOperations > OH_LIBSQL_STORE_LIMITS_V1.historyOperations || provenanceBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes || recordBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes || dependencyBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes) {
      throw new RangeError("The current libSQL materialization exceeds its provider-safe response bounds.");
    }
    if (recordResult.rows.length !== recordCount || provenanceResult.rows.length !== provenanceOperations) {
      throw new OhIntegrityError("The provider-safe snapshot queries omitted bounded authority rows.");
    }
    const history = historyResult.rows[0];
    const operationCount = history === undefined ? null : integer(rowValue(history, "count", 0));
    const minimumValue = history === undefined ? undefined : rowValue(history, "minimum", 1);
    const maximumValue = history === undefined ? undefined : rowValue(history, "maximum", 2);
    const minimumSequence = history === undefined ? null : integer(rowValue(history, "minimum", 1));
    const maximumSequence = history === undefined ? null : integer(rowValue(history, "maximum", 2));
    if (operationCount !== head.sequence || head.sequence === 0 && (minimumValue !== null || maximumValue !== null) || head.sequence > 0 && (minimumSequence !== 1 || maximumSequence !== head.sequence)) {
      throw new OhIntegrityError("The remote operation history does not exactly cover its current head.");
    }
    if (recordResult.rows.length > maximumRecords) {
      throw new RangeError("The remote graph exceeds the requested record snapshot bound.");
    }
    const provenanceBySha256 = new Map;
    for (const row of provenanceResult.rows) {
      const operation = parseOperationRow(row, { spaceId: this.binding.spaceId });
      if (provenanceBySha256.has(operation.operationSha256)) {
        throw new OhIntegrityError("A current materialization provenance operation is invalid.");
      }
      provenanceBySha256.set(operation.operationSha256, operation);
    }
    if (provenanceBySha256.size !== provenanceOperations || head.operationSha256 !== null && !provenanceBySha256.has(head.operationSha256)) {
      throw new OhIntegrityError("The current materialization omitted required provenance operations.");
    }
    if (head.sequence > 0) {
      const terminal = head.operationSha256 === null ? undefined : provenanceBySha256.get(head.operationSha256);
      if (terminal === undefined || terminal.sequence !== head.sequence || terminal.graphRevisionSha256 !== head.graphRevisionSha256 || terminal.recordsSha256 !== head.recordsSha256) {
        throw new OhIntegrityError("The remote space head differs from its terminal canonical operation.");
      }
    }
    const materialized = recordResult.rows.map((row) => {
      const json = rowValue(row, "record_json", 3);
      if (typeof json !== "string")
        throw new OhIntegrityError("A materialized remote record is not JSON text.");
      let value;
      try {
        value = JSON.parse(json);
      } catch {
        throw new OhIntegrityError("A materialized remote record is invalid.");
      }
      const record = parseKnowledgeGraphRecordV1(value);
      const operationSha256 = parseSha256Hex(rowValue(row, "operation_sha256", 4));
      const sequence = integer(rowValue(row, "sequence", 5));
      if (record === null || canonicalJson(record) !== json || operationSha256 === null || sequence === null || sequence < 1 || sequence > head.sequence || rowValue(row, "record_key", 0) !== record.key || rowValue(row, "kind", 1) !== record.kind || rowValue(row, "record_sha256", 2) !== record.recordSha256) {
        throw new OhIntegrityError("A materialized remote record is invalid.");
      }
      const provenance = provenanceBySha256.get(operationSha256);
      if (provenance === undefined || provenance.sequence !== sequence || !provenance.changes.some((change) => change.kind === "put" && canonicalJson(change.record) === json)) {
        throw new OhIntegrityError("A materialized remote record has no exact canonical provenance put.");
      }
      return { record, sequence };
    });
    const records = materialized.map(({ record }) => record);
    if (canonicalSha256(records.map(knowledgeGraphRecordRefV1)) !== head.recordsSha256) {
      throw new OhIntegrityError("Materialized remote records do not reproduce the current head.");
    }
    const dependencyRows = dependencyResult.rows.map((row) => ({
      dependency_key: rowValue(row, "dependency_key", 1),
      record_key: rowValue(row, "record_key", 0)
    }));
    const expectedDependencies = records.flatMap((record) => record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })));
    if (canonicalJson(dependencyRows) !== canonicalJson(expectedDependencies)) {
      throw new OhIntegrityError("Materialized remote dependencies do not match their record envelopes.");
    }
    return { head, records, v: 1 };
  }
  async snapshot(options = {}) {
    this.#assertOpen();
    const current = await this.head();
    const target = options.head === undefined ? current : await this.#headAt(options.head);
    if (target.sequence > current.sequence)
      throw new OhConflictError("The requested head is ahead of this space.");
    const maximumRecords = options.maximumRecords ?? OH_GRAPH_LIMITS_V1.recordsPerSnapshot;
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
      throw new RangeError(`maximumRecords must be an integer from 1 through ${OH_GRAPH_LIMITS_V1.recordsPerSnapshot}.`);
    }
    if (target.operationSha256 === current.operationSha256) {
      return await this.#currentMaterializedSnapshot(current, maximumRecords);
    }
    if (target.sequence > OH_LIBSQL_STORE_LIMITS_V1.historyOperations) {
      throw new RangeError("The requested libSQL history exceeds its operation replay bound.");
    }
    const historyResults = await this.#client.batch([
      {
        sql: `SELECT count(*) AS count, min(operation.sequence) AS minimum,
          max(operation.sequence) AS maximum,
          coalesce(sum(length(CAST(operation.operation_json AS BLOB))), 0) AS canonical_bytes,
          coalesce(sum(${OPERATION_RESPONSE_BYTES}), 0) AS response_bytes
        FROM oh_authority_operations AS operation
        WHERE operation.space_id = ? AND operation.sequence <= ?`,
        args: [this.binding.spaceId, target.sequence]
      },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations AS operation
        WHERE operation.space_id = ? AND operation.sequence <= ?
          AND (SELECT coalesce(sum(length(CAST(candidate.operation_json AS BLOB))), 0)
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
          AND (SELECT coalesce(sum(${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")}), 0)
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
        ORDER BY operation.sequence`, args: [
        this.binding.spaceId,
        target.sequence,
        this.binding.spaceId,
        target.sequence,
        OH_LIBSQL_STORE_LIMITS_V1.historyBytes,
        this.binding.spaceId,
        target.sequence,
        OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes
      ] },
      { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] }
    ], "read");
    if (historyResults.length !== 3) {
      throw new OhIntegrityError("The remote authority returned an incomplete history batch.");
    }
    const [historySizeResult, historyRowResult, purgeResult] = historyResults;
    const historySizeRow = historySizeResult.rows[0];
    const historyBytes = historySizeRow === undefined ? null : integer(rowValue(historySizeRow, "canonical_bytes", 3));
    const responseBytes = historySizeRow === undefined ? null : integer(rowValue(historySizeRow, "response_bytes", 4));
    if (historyBytes === null || historyBytes > OH_LIBSQL_STORE_LIMITS_V1.historyBytes || responseBytes === null || responseBytes > OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes) {
      throw new RangeError("The requested libSQL history exceeds its provider-safe replay bounds.");
    }
    const historyCount = historySizeRow === undefined ? null : integer(rowValue(historySizeRow, "count", 0));
    const minimumSequence = historySizeRow === undefined ? null : integer(rowValue(historySizeRow, "minimum", 1));
    const maximumSequence = historySizeRow === undefined ? null : integer(rowValue(historySizeRow, "maximum", 2));
    if (historyCount !== target.sequence || target.sequence === 0 && (rowValue(historySizeRow, "minimum", 1) !== null || rowValue(historySizeRow, "maximum", 2) !== null) || target.sequence > 0 && (minimumSequence !== 1 || maximumSequence !== target.sequence) || historyRowResult.rows.length !== historyCount) {
      const purgeRow = purgeResult.rows[0];
      if (purgeRow !== undefined) {
        const purge = parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256);
        this.#purged = purge;
        throw new OhPurgedSpaceError(purge);
      }
      throw new OhIntegrityError("The remote operation history does not exactly cover the requested head.");
    }
    const operations = historyRowResult.rows.map((row) => parseOperationRow(row, { spaceId: this.binding.spaceId }));
    const snapshot = replayOhOperationsV1(this.binding.spaceId, operations, maximumRecords);
    if (snapshot.head.operationSha256 !== target.operationSha256 || snapshot.head.recordsSha256 !== target.recordsSha256) {
      throw new OhIntegrityError("Remote operation replay does not reproduce the requested head.");
    }
    return snapshot;
  }
  async changesSince(fromValue, options = {}) {
    this.#assertOpen();
    const from = parseOhHeadRefV1(fromValue);
    if (from === null)
      throw new TypeError("Invalid change-feed cursor.");
    const requestedThrough = options.through === undefined ? undefined : parseOhHeadRefV1(options.through);
    if (requestedThrough === null)
      throw new TypeError("Invalid change-feed through head.");
    const limit = normalizeLimit(options.limit, OH_LIBSQL_STORE_LIMITS_V1.changeFeedLimit, OH_LIBSQL_STORE_LIMITS_V1.changeFeedLimit);
    const throughSequence = requestedThrough?.sequence ?? null;
    const results = await this.#client.batch([
      { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, from.sequence] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, throughSequence] },
      { sql: `SELECT count(*) AS count, coalesce(sum(response_bytes), 0) AS response_bytes FROM (
          SELECT ${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")} AS response_bytes
          FROM oh_authority_operations AS candidate
          WHERE candidate.space_id = ? AND candidate.sequence > ?
            AND candidate.sequence <= coalesce(?,
              (SELECT sequence FROM oh_authority_spaces WHERE space_id = ?))
          ORDER BY candidate.sequence LIMIT ?
        )`, args: [
        this.binding.spaceId,
        from.sequence,
        throughSequence,
        this.binding.spaceId,
        limit + 1
      ] },
      {
        sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        AS operation WHERE operation.space_id = ? AND operation.sequence > ?
          AND operation.sequence <= coalesce(?,
            (SELECT sequence FROM oh_authority_spaces WHERE space_id = ?))
          AND (SELECT coalesce(sum(response_bytes), 0) FROM (
            SELECT ${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")} AS response_bytes
            FROM oh_authority_operations AS candidate
            WHERE candidate.space_id = ? AND candidate.sequence > ?
              AND candidate.sequence <= coalesce(?,
                (SELECT sequence FROM oh_authority_spaces WHERE space_id = ?))
            ORDER BY candidate.sequence LIMIT ?
          )) <= ?
        ORDER BY operation.sequence LIMIT ?`,
        args: [
          this.binding.spaceId,
          from.sequence,
          throughSequence,
          this.binding.spaceId,
          this.binding.spaceId,
          from.sequence,
          throughSequence,
          this.binding.spaceId,
          limit + 1,
          OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes,
          limit + 1
        ]
      },
      { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] }
    ], "read");
    if (results.length !== 6)
      throw new OhIntegrityError("The remote authority returned an incomplete change-feed batch.");
    const [currentResult, fromResult, throughResult, pageSizeResult, pageResult, purgeResult] = results;
    const currentRow = currentResult.rows[0];
    if (currentRow === undefined) {
      const purgeRow = purgeResult.rows[0];
      if (purgeRow !== undefined) {
        const purge = parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256);
        this.#purged = purge;
        throw new OhPurgedSpaceError(purge);
      }
      throw new OhIntegrityError("The remote Oh space disappeared while reading its change feed.");
    }
    const current = parseHeadRow(currentRow);
    const resolveHead = (reference, result) => {
      if (reference.sequence === 0)
        return emptyOhHeadV1();
      const row = result.rows[0];
      if (row === undefined)
        throw new OhConflictError("A requested change-feed head is not present in this space.");
      const operation = parseOperationRow(row, { spaceId: this.binding.spaceId });
      if (operation.spaceId !== this.binding.spaceId || operation.sequence !== reference.sequence || operation.operationSha256 !== reference.operationSha256) {
        throw new OhConflictError("A requested change-feed sequence identifies a different operation head.");
      }
      return {
        generation: operation.sequence,
        graphRevisionSha256: operation.graphRevisionSha256,
        operationSha256: operation.operationSha256,
        recordsSha256: operation.recordsSha256,
        sequence: operation.sequence,
        v: 1
      };
    };
    const fromHead = resolveHead(from, fromResult);
    const through = requestedThrough === undefined ? current : resolveHead(requestedThrough, throughResult);
    if (fromHead.sequence > through.sequence || through.sequence > current.sequence) {
      throw new OhConflictError("The change-feed bounds do not identify one remote history prefix.");
    }
    const pageSizeRow = pageSizeResult.rows[0];
    const pageCount = pageSizeRow === undefined ? null : integer(rowValue(pageSizeRow, "count", 0));
    const pageResponseBytes = pageSizeRow === undefined ? null : integer(rowValue(pageSizeRow, "response_bytes", 1));
    if (pageCount === null || pageCount > limit + 1 || pageResponseBytes === null) {
      throw new OhIntegrityError("The remote change feed returned invalid response bounds.");
    }
    if (pageResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes) {
      throw new RangeError("The requested change-feed page exceeds its provider response bound.");
    }
    const parsed = pageResult.rows.map((row) => parseOperationRow(row, { spaceId: this.binding.spaceId }));
    if (parsed.length !== pageCount) {
      throw new OhIntegrityError("The remote change feed omitted provider-bounded rows.");
    }
    const hasMore = parsed.length > limit;
    const operations = parsed.slice(0, limit);
    let prior = fromHead;
    for (const operation of parsed) {
      if (operation.spaceId !== this.binding.spaceId || operation.sequence !== prior.sequence + 1 || operation.parentOperationSha256 !== prior.operationSha256) {
        throw new OhIntegrityError("The remote change feed contains a gap or fork.");
      }
      prior = { operationSha256: operation.operationSha256, sequence: operation.sequence };
    }
    if (!hasMore && (prior.sequence !== through.sequence || prior.operationSha256 !== through.operationSha256)) {
      throw new OhIntegrityError("The remote change feed does not reach its pinned through head.");
    }
    const last = operations.at(-1);
    const to = last === undefined ? { operationSha256: fromHead.operationSha256, sequence: fromHead.sequence } : { operationSha256: last.operationSha256, sequence: last.sequence };
    return {
      from: { operationSha256: fromHead.operationSha256, sequence: fromHead.sequence },
      hasMore,
      operations,
      through,
      to,
      v: 1
    };
  }
  async#assertMaterializedSnapshot(snapshot) {
    if (snapshot.head.sequence > OH_LIBSQL_STORE_LIMITS_V1.historyOperations) {
      throw new RangeError("The libSQL authority exceeds its explicit verification operation bound.");
    }
    const verificationResults = await this.#client.batch([
      { sql: `SELECT * FROM (WITH bounded_operation AS (
            SELECT * FROM oh_authority_operations
            WHERE space_id = ? AND sequence <= ?
          ) SELECT count(*) AS operation_count, min(operation.sequence) AS minimum,
            max(operation.sequence) AS maximum,
            coalesce(sum(length(CAST(operation.operation_json AS BLOB))), 0) AS canonical_bytes,
            coalesce(sum(${OPERATION_RESPONSE_BYTES}), 0) AS operation_response_bytes,
            (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0)
              FROM oh_authority_records AS record WHERE record.space_id = ?) AS record_response_bytes,
            (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
              FROM oh_authority_dependencies AS dependency
              WHERE dependency.space_id = ?) AS dependency_response_bytes,
            (SELECT coalesce(sum(${OPERATION_RECORD_RESPONSE_BYTES}), 0)
              FROM oh_authority_operation_records AS materialized
              JOIN bounded_operation AS owner
                ON owner.operation_sha256 = materialized.operation_sha256) AS operation_record_response_bytes
          FROM bounded_operation AS operation)`, args: [
        this.binding.spaceId,
        snapshot.head.sequence,
        this.binding.spaceId,
        this.binding.spaceId
      ] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS}
          FROM oh_authority_operations AS operation
          WHERE operation.space_id = ? AND operation.sequence <= ?
            AND (SELECT coalesce(sum(length(CAST(candidate.operation_json AS BLOB))), 0)
              FROM oh_authority_operations AS candidate
              WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
            AND (SELECT coalesce(sum(${OPERATION_RESPONSE_BYTES.replaceAll("operation.", "candidate.")}), 0)
              FROM oh_authority_operations AS candidate
              WHERE candidate.space_id = ? AND candidate.sequence <= ?) <= ?
          ORDER BY operation.sequence`, args: [
        this.binding.spaceId,
        snapshot.head.sequence,
        this.binding.spaceId,
        snapshot.head.sequence,
        OH_LIBSQL_STORE_LIMITS_V1.historyBytes,
        this.binding.spaceId,
        snapshot.head.sequence,
        OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes
      ] },
      { sql: `SELECT record_key, kind, record_sha256, record_json, operation_sha256, sequence
          FROM oh_authority_records AS record WHERE record.space_id = ?
            AND (SELECT coalesce(sum(${RECORD_RESPONSE_BYTES}), 0)
              FROM oh_authority_records AS record WHERE record.space_id = ?) <= ?
          ORDER BY record.record_key`, args: [
        this.binding.spaceId,
        this.binding.spaceId,
        OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes
      ] },
      { sql: `SELECT record_key, dependency_key FROM oh_authority_dependencies AS dependency
          WHERE dependency.space_id = ?
            AND (SELECT coalesce(sum(${DEPENDENCY_RESPONSE_BYTES}), 0)
              FROM oh_authority_dependencies AS dependency WHERE dependency.space_id = ?) <= ?
          ORDER BY dependency.record_key, dependency.dependency_key`, args: [
        this.binding.spaceId,
        this.binding.spaceId,
        OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes
      ] },
      { sql: `SELECT materialized.space_id, materialized.operation_sha256, materialized.ordinal,
          materialized.record_key, materialized.change_kind, materialized.record_sha256
          FROM oh_authority_operation_records AS materialized
          JOIN oh_authority_operations AS operation
            ON operation.operation_sha256 = materialized.operation_sha256
          WHERE operation.space_id = ? AND operation.sequence <= ?
            AND (SELECT coalesce(sum(${OPERATION_RECORD_RESPONSE_BYTES}), 0)
              FROM oh_authority_operation_records AS materialized
              JOIN oh_authority_operations AS owner
                ON owner.operation_sha256 = materialized.operation_sha256
              WHERE owner.space_id = ? AND owner.sequence <= ?) <= ?
          ORDER BY operation.sequence, materialized.ordinal`, args: [
        this.binding.spaceId,
        snapshot.head.sequence,
        this.binding.spaceId,
        snapshot.head.sequence,
        OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes
      ] },
      { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
          FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] }
    ], "read");
    if (verificationResults.length !== 6) {
      throw new OhIntegrityError("The remote authority returned an incomplete verification batch.");
    }
    const [sizeResult, operationResult, recordResult, dependencyResult, operationRecordResult, headResult] = verificationResults;
    const sizeRow = sizeResult.rows[0];
    const operationCount = sizeRow === undefined ? null : integer(rowValue(sizeRow, "operation_count", 0));
    const minimumValue = sizeRow === undefined ? undefined : rowValue(sizeRow, "minimum", 1);
    const maximumValue = sizeRow === undefined ? undefined : rowValue(sizeRow, "maximum", 2);
    const minimumSequence = sizeRow === undefined ? null : integer(rowValue(sizeRow, "minimum", 1));
    const maximumSequence = sizeRow === undefined ? null : integer(rowValue(sizeRow, "maximum", 2));
    const historyBytes = sizeRow === undefined ? null : integer(rowValue(sizeRow, "canonical_bytes", 3));
    const operationResponseBytes = sizeRow === undefined ? null : integer(rowValue(sizeRow, "operation_response_bytes", 4));
    const recordResponseBytes = sizeRow === undefined ? null : integer(rowValue(sizeRow, "record_response_bytes", 5));
    const dependencyResponseBytes = sizeRow === undefined ? null : integer(rowValue(sizeRow, "dependency_response_bytes", 6));
    const operationRecordResponseBytes = sizeRow === undefined ? null : integer(rowValue(sizeRow, "operation_record_response_bytes", 7));
    if (historyBytes === null || historyBytes > OH_LIBSQL_STORE_LIMITS_V1.historyBytes || operationResponseBytes === null || operationResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.providerResponseBytes || recordResponseBytes === null || recordResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes || dependencyResponseBytes === null || dependencyResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes || operationRecordResponseBytes === null || operationRecordResponseBytes > OH_LIBSQL_STORE_LIMITS_V1.snapshotComponentBytes) {
      throw new RangeError("The libSQL authority exceeds its provider-safe verification bounds.");
    }
    if (operationCount !== snapshot.head.sequence || snapshot.head.sequence === 0 && (minimumValue !== null || maximumValue !== null) || snapshot.head.sequence > 0 && (minimumSequence !== 1 || maximumSequence !== snapshot.head.sequence) || operationResult.rows.length !== operationCount) {
      throw new OhIntegrityError("The remote operation history does not exactly cover its verified head.");
    }
    const headRow = headResult.rows[0];
    if (headRow === undefined)
      throw new OhIntegrityError("The remote authority lost its head during verification.");
    if (canonicalJson(parseHeadRow(headRow)) !== canonicalJson(snapshot.head)) {
      throw new OhConflictError("The remote authority head changed during verification.");
    }
    const operations = operationResult.rows.map((row) => {
      return parseOperationRow(row, { spaceId: this.binding.spaceId });
    });
    const replayed = replayOhOperationsV1(this.binding.spaceId, operations);
    if (canonicalJson(replayed) !== canonicalJson(snapshot)) {
      throw new OhIntegrityError("Remote operation replay changed during materialization verification.");
    }
    const materializedBy = new Map;
    for (const operation of operations) {
      for (const change of operation.changes) {
        const key = change.kind === "put" ? change.record.key : change.key;
        if (change.kind === "put")
          materializedBy.set(key, { operationSha256: operation.operationSha256, sequence: operation.sequence });
        else
          materializedBy.delete(key);
      }
    }
    const records = recordResult.rows.map((row) => {
      const json = rowValue(row, "record_json", 3);
      if (typeof json !== "string")
        throw new OhIntegrityError("A materialized remote record is not JSON text.");
      let value;
      try {
        value = JSON.parse(json);
      } catch {
        throw new OhIntegrityError("A materialized remote record is invalid.");
      }
      const record = parseKnowledgeGraphRecordV1(value);
      const provenance = record === null ? undefined : materializedBy.get(record.key);
      if (record === null || canonicalJson(record) !== json || rowValue(row, "record_key", 0) !== record.key || rowValue(row, "kind", 1) !== record.kind || rowValue(row, "record_sha256", 2) !== record.recordSha256 || provenance === undefined || rowValue(row, "operation_sha256", 4) !== provenance.operationSha256 || integer(rowValue(row, "sequence", 5)) !== provenance.sequence) {
        throw new OhIntegrityError("A materialized remote record differs from operation replay.");
      }
      return record;
    });
    if (canonicalJson(records) !== canonicalJson(snapshot.records)) {
      throw new OhIntegrityError("Remote materialized records do not match operation replay.");
    }
    const dependencyRows = dependencyResult.rows.map((row) => ({
      dependency_key: rowValue(row, "dependency_key", 1),
      record_key: rowValue(row, "record_key", 0)
    }));
    const expectedDependencies = snapshot.records.flatMap((record) => record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })));
    if (canonicalJson(dependencyRows) !== canonicalJson(expectedDependencies)) {
      throw new OhIntegrityError("Remote materialized dependencies do not match operation replay.");
    }
    const operationRecordRows = operationRecordResult.rows.map((row) => ({
      change_kind: rowValue(row, "change_kind", 4),
      operation_sha256: rowValue(row, "operation_sha256", 1),
      ordinal: integer(rowValue(row, "ordinal", 2)),
      record_key: rowValue(row, "record_key", 3),
      record_sha256: rowValue(row, "record_sha256", 5),
      space_id: rowValue(row, "space_id", 0)
    }));
    const expectedOperationRecords = operations.flatMap((operation) => operation.changes.map((change, ordinal) => ({
      change_kind: change.kind,
      operation_sha256: operation.operationSha256,
      ordinal,
      record_key: change.kind === "put" ? change.record.key : change.key,
      record_sha256: change.kind === "put" ? change.record.recordSha256 : change.priorSha256,
      space_id: this.binding.spaceId
    })));
    if (canonicalJson(operationRecordRows) !== canonicalJson(expectedOperationRecords)) {
      throw new OhIntegrityError("Remote operation-record rows do not match operation replay.");
    }
  }
  async#operationById(operationId) {
    const row = await queryOne(this.#client, { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
      WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId] });
    if (row === null)
      return null;
    return parseOperationRow(row, { operationId, spaceId: this.binding.spaceId });
  }
  async#commitPreflight(operationId) {
    const results = await this.#client.batch([
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId] },
      { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] },
      { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] }
    ], "read");
    if (results.length !== 3)
      throw new OhIntegrityError("The remote authority returned an incomplete commit preflight.");
    const [duplicateResult, headResult, purgeResult] = results;
    const headRow = headResult.rows[0];
    if (headRow === undefined) {
      const purgeRow = purgeResult.rows[0];
      if (purgeRow !== undefined) {
        const purge = parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256);
        this.#purged = purge;
        throw new OhPurgedSpaceError(purge);
      }
      throw new OhIntegrityError("The remote space disappeared during commit preflight.");
    }
    const duplicateRow = duplicateResult.rows[0];
    return { current: parseHeadRow(headRow), duplicate: duplicateRow === undefined ? null : parseOperationRow(duplicateRow, { operationId, spaceId: this.binding.spaceId }) };
  }
  async#assertOperationReachable(operation, expectedHead) {
    if (operation.sequence < 1 || operation.sequence > expectedHead.sequence) {
      throw new OhIntegrityError("A remote idempotent operation is not reachable from the current head.");
    }
    const results = await this.#client.batch([
      { sql: `SELECT * FROM (WITH RECURSIVE authority_chain(sequence, operation_sha256) AS (
          SELECT sequence, operation_sha256 FROM oh_authority_operations
          WHERE space_id = ? AND sequence = ? AND operation_sha256 = ?
          UNION ALL
          SELECT candidate.sequence, candidate.operation_sha256
          FROM oh_authority_operations AS candidate
          JOIN authority_chain AS prior
            ON candidate.space_id = ? AND candidate.sequence = prior.sequence + 1
              AND candidate.parent_operation_sha256 = prior.operation_sha256
          WHERE candidate.sequence <= ?
        ) SELECT count(*) AS count, min(sequence) AS minimum, max(sequence) AS maximum,
          (SELECT operation_sha256 FROM authority_chain ORDER BY sequence DESC LIMIT 1) AS terminal_sha256
        FROM authority_chain)`, args: [
        this.binding.spaceId,
        operation.sequence,
        operation.operationSha256,
        this.binding.spaceId,
        expectedHead.sequence
      ] },
      { sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
        WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, expectedHead.sequence] },
      { sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
        FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] },
      { sql: PURGE_ROW_SELECT, args: [this.binding.spaceId] }
    ], "read");
    if (results.length !== 4)
      throw new OhIntegrityError("The remote authority returned an incomplete reachability proof.");
    const [chainResult, terminalResult, headResult, purgeResult] = results;
    const headRow = headResult.rows[0];
    if (headRow === undefined) {
      const purgeRow = purgeResult.rows[0];
      if (purgeRow !== undefined) {
        const purge = parsePurgeReceiptRow(purgeRow, this.binding.spaceId, this.binding.bindingSha256);
        this.#purged = purge;
        throw new OhPurgedSpaceError(purge);
      }
      throw new OhIntegrityError("The remote space disappeared during an idempotency proof.");
    }
    const current = parseHeadRow(headRow);
    if (canonicalJson(current) !== canonicalJson(expectedHead)) {
      throw new OhConflictError("The remote space head changed during an idempotency proof.");
    }
    const chain = chainResult.rows[0];
    const count = chain === undefined ? null : integer(rowValue(chain, "count", 0));
    const minimum = chain === undefined ? null : integer(rowValue(chain, "minimum", 1));
    const maximum = chain === undefined ? null : integer(rowValue(chain, "maximum", 2));
    const terminalSha256 = chain === undefined ? null : rowValue(chain, "terminal_sha256", 3);
    if (count !== expectedHead.sequence - operation.sequence + 1 || minimum !== operation.sequence || maximum !== expectedHead.sequence || terminalSha256 !== expectedHead.operationSha256) {
      throw new OhIntegrityError("A remote idempotent operation has no exact path to the current head.");
    }
    const terminalRow = terminalResult.rows[0];
    if (terminalRow === undefined || expectedHead.operationSha256 === null) {
      throw new OhIntegrityError("The remote current head operation is missing.");
    }
    const terminal = parseOperationRow(terminalRow, {
      operationSha256: expectedHead.operationSha256,
      spaceId: this.binding.spaceId
    });
    if (terminal.sequence !== expectedHead.sequence || terminal.graphRevisionSha256 !== expectedHead.graphRevisionSha256 || terminal.recordsSha256 !== expectedHead.recordsSha256) {
      throw new OhIntegrityError("The remote space head differs from its terminal canonical operation.");
    }
  }
  async commit(input) {
    this.#assertOpen();
    const actorId = safeCode(input.actorId);
    const operationId = safeCode(input.operationId);
    const changes = canonicalKnowledgeGraphChangesV1(input.changes);
    if (actorId === null || operationId === null || changes.length === 0)
      throw new TypeError("Invalid Oh commit input.");
    if (changes.length > OH_LIBSQL_STORE_LIMITS_V1.changesPerCommit) {
      throw new RangeError("A direct libSQL commit exceeds its change-count bound.");
    }
    const dependencies = changes.reduce((count, change) => count + (change.kind === "put" ? change.record.dependencies.length : 0), 0);
    if (dependencies > OH_LIBSQL_STORE_LIMITS_V1.dependenciesPerCommit) {
      throw new RangeError("A direct libSQL commit exceeds its dependency-count bound.");
    }
    const { current, duplicate } = await this.#commitPreflight(operationId);
    if (duplicate !== null) {
      await this.#assertOperationReachable(duplicate, current);
      if (duplicate.actorId !== actorId || canonicalJson(duplicate.changes) !== canonicalJson(changes)) {
        throw new OhConflictError("The operation ID is already bound to different content.");
      }
      return duplicate;
    }
    if (!Number.isSafeInteger(input.expectedHead.generation) || input.expectedHead.generation < 0 || current.generation !== input.expectedHead.generation || current.operationSha256 !== input.expectedHead.operationSha256) {
      throw new OhConflictError("The expected head does not match the current remote space head.");
    }
    const snapshot = await this.#currentMaterializedSnapshot(current, OH_GRAPH_LIMITS_V1.recordsPerSnapshot);
    const transition = transitionOhSnapshotV1({
      actorId,
      changes,
      instant: input.instant ?? canonicalNow(),
      operationId,
      snapshot,
      spaceId: this.binding.spaceId
    });
    const operation = transition.operation;
    if (utf8ByteLength(canonicalJson(operation)) > OH_LIBSQL_STORE_LIMITS_V1.operationBytes) {
      throw new RangeError("A direct libSQL operation exceeds its canonical byte bound.");
    }
    const existsOperation = "EXISTS (SELECT 1 FROM oh_authority_operations WHERE operation_sha256 = ?)";
    const statements = [{
      sql: `INSERT INTO oh_authority_operations(operation_sha256, space_id, sequence,
        operation_id, parent_operation_sha256, graph_revision_sha256, records_sha256,
        operation_json, instant)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM oh_authority_spaces
          WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ?)`,
      args: [
        operation.operationSha256,
        this.binding.spaceId,
        operation.sequence,
        operation.operationId,
        operation.parentOperationSha256,
        operation.graphRevisionSha256,
        operation.recordsSha256,
        canonicalJson(operation),
        operation.instant,
        this.binding.spaceId,
        current.generation,
        current.operationSha256
      ]
    }];
    for (const [ordinal, change] of operation.changes.entries()) {
      const key = change.kind === "put" ? change.record.key : change.key;
      const digest = change.kind === "put" ? change.record.recordSha256 : change.priorSha256;
      statements.push({
        sql: `INSERT INTO oh_authority_operation_records(space_id, operation_sha256,
        ordinal, record_key, change_kind, record_sha256)
        SELECT ?, ?, ?, ?, ?, ? WHERE ${existsOperation}`,
        args: [
          this.binding.spaceId,
          operation.operationSha256,
          ordinal,
          key,
          change.kind,
          digest,
          operation.operationSha256
        ]
      });
      statements.push({ sql: `DELETE FROM oh_authority_dependencies WHERE space_id = ? AND record_key = ?
        AND ${existsOperation}`, args: [this.binding.spaceId, key, operation.operationSha256] });
      if (change.kind === "put") {
        statements.push({
          sql: `INSERT INTO oh_authority_records(space_id, record_key, kind,
          record_sha256, record_json, operation_sha256, sequence)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${existsOperation}
          ON CONFLICT(space_id, record_key) DO UPDATE SET kind = excluded.kind,
          record_sha256 = excluded.record_sha256, record_json = excluded.record_json,
          operation_sha256 = excluded.operation_sha256, sequence = excluded.sequence`,
          args: [
            this.binding.spaceId,
            key,
            change.record.kind,
            change.record.recordSha256,
            canonicalJson(change.record),
            operation.operationSha256,
            operation.sequence,
            operation.operationSha256
          ]
        });
      } else {
        statements.push({
          sql: `DELETE FROM oh_authority_records WHERE space_id = ? AND record_key = ?
          AND record_sha256 = ? AND ${existsOperation}`,
          args: [this.binding.spaceId, key, change.priorSha256, operation.operationSha256]
        });
      }
    }
    for (const change of operation.changes) {
      if (change.kind !== "put")
        continue;
      for (const dependency of change.record.dependencies) {
        statements.push({
          sql: `INSERT INTO oh_authority_dependencies(space_id, record_key, dependency_key)
          SELECT ?, ?, ? WHERE ${existsOperation}`,
          args: [this.binding.spaceId, change.record.key, dependency, operation.operationSha256]
        });
      }
    }
    statements.push({
      sql: `UPDATE oh_authority_spaces SET generation = ?, head_operation_sha256 = ?,
      graph_revision_sha256 = ?, records_sha256 = ?, sequence = ?, updated_at = ?
      WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ? AND ${existsOperation}`,
      args: [
        operation.sequence,
        operation.operationSha256,
        operation.graphRevisionSha256,
        operation.recordsSha256,
        operation.sequence,
        operation.instant,
        this.binding.spaceId,
        current.generation,
        current.operationSha256,
        operation.operationSha256
      ]
    });
    statements.push({
      sql: `INSERT INTO oh_authority_commit_guards(value)
      SELECT 'invalid' WHERE NOT EXISTS (SELECT 1 FROM oh_authority_spaces
        WHERE space_id = ? AND generation = ? AND head_operation_sha256 = ?)`,
      args: [this.binding.spaceId, operation.sequence, operation.operationSha256]
    });
    statements.push({ sql: `SELECT ${OPERATION_ROW_COLUMNS} FROM oh_authority_operations
      WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId] });
    statements.push({ sql: `SELECT generation, graph_revision_sha256, head_operation_sha256, records_sha256, sequence
      FROM oh_authority_spaces WHERE space_id = ?`, args: [this.binding.spaceId] });
    let writeResults;
    try {
      writeResults = await this.#client.batch(statements, "write");
    } catch (error) {
      const raced = await this.#operationById(operationId);
      const head = await this.head();
      if (raced !== null && raced.actorId === actorId && canonicalJson(raced.changes) === canonicalJson(changes)) {
        await this.#assertOperationReachable(raced, head);
        return raced;
      }
      if (head.operationSha256 !== current.operationSha256) {
        throw new OhConflictError("The remote space head changed while committing.");
      }
      throw error;
    }
    if (writeResults.length !== statements.length) {
      throw new OhIntegrityError("The remote authority returned an incomplete commit result batch.");
    }
    const persistedRow = writeResults.at(-2)?.rows[0];
    const persistedHeadRow = writeResults.at(-1)?.rows[0];
    if (persistedRow === undefined || persistedHeadRow === undefined) {
      throw new OhIntegrityError("The remote authority omitted its persisted commit result.");
    }
    const persisted = parseOperationRow(persistedRow, { operationId, spaceId: this.binding.spaceId });
    const persistedHead = parseHeadRow(persistedHeadRow);
    if (canonicalJson(persisted) !== canonicalJson(operation) || persistedHead.operationSha256 !== operation.operationSha256 || persistedHead.sequence !== operation.sequence || persistedHead.graphRevisionSha256 !== operation.graphRevisionSha256 || persistedHead.recordsSha256 !== operation.recordsSha256) {
      throw new OhIntegrityError("The remote authority did not persist the committed operation exactly.");
    }
    return persisted;
  }
  async exportDependencyClosure(input) {
    if (!this.binding.profile.capabilities.dependencyClosureExport) {
      throw new OhProfileError("This remote profile does not permit dependency-closure export.");
    }
    const snapshot = await this.snapshot({
      ...input.head === undefined ? {} : { head: input.head },
      ...input.maximumRecords === undefined ? {} : { maximumRecords: input.maximumRecords }
    });
    return createOhDependencyClosureV1({
      binding: this.binding,
      ...input.maximumRecords === undefined ? {} : { maximumRecords: input.maximumRecords },
      roots: input.roots,
      snapshot
    });
  }
  async verify() {
    this.#assertOpen();
    const snapshot = await this.snapshot();
    await this.#assertMaterializedSnapshot(snapshot);
    return {
      head: snapshot.head,
      integrity: "verified",
      operations: snapshot.head.sequence,
      records: snapshot.records.length,
      v: 1
    };
  }
  async#assertPurgeComplete(expected) {
    await assertRemotePurgeComplete(this.#client, this.binding, expected);
  }
  async purgeWorkingSpace(purgedAt) {
    this.#assertOpen();
    if (this.binding.profile.profileKind !== "working" || !this.binding.profile.capabilities.wholeSpacePurge) {
      throw new OhProfileError("Whole-space purge requires a bound working profile.");
    }
    for (let attempt = 0;attempt < 3; attempt += 1) {
      const existing = await this.#readPurge();
      if (existing !== null) {
        await this.#assertPurgeComplete(existing);
        this.#purged = existing;
        return existing;
      }
      const head = await this.head();
      const receipt = createOhSpacePurgeReceiptV1({ binding: this.binding, priorHead: head, purgedAt });
      const receiptExists = "EXISTS (SELECT 1 FROM oh_authority_purges WHERE space_id = ? AND receipt_sha256 = ?)";
      const statements = [{
        sql: `INSERT INTO oh_authority_purges(space_id,
        binding_sha256, prior_operation_sha256, prior_sequence, purged_at, receipt_sha256, receipt_json)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM oh_authority_spaces
          WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ?)
          AND EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ? AND binding_sha256 = ?)`,
        args: [
          this.binding.spaceId,
          this.binding.bindingSha256,
          head.operationSha256,
          head.sequence,
          receipt.purgedAt,
          receipt.receiptSha256,
          canonicalJson(receipt),
          this.binding.spaceId,
          head.generation,
          head.operationSha256,
          this.binding.spaceId,
          this.binding.bindingSha256
        ]
      }];
      const guardedDelete = (table) => ({
        sql: `DELETE FROM ${table} WHERE space_id = ? AND ${receiptExists}`,
        args: [this.binding.spaceId, this.binding.spaceId, receipt.receiptSha256]
      });
      statements.push({
        sql: `DELETE FROM oh_authority_operation_records
        WHERE operation_sha256 IN (SELECT operation_sha256 FROM oh_authority_operations WHERE space_id = ?)
          AND ${receiptExists}`,
        args: [this.binding.spaceId, this.binding.spaceId, receipt.receiptSha256]
      });
      statements.push(guardedDelete("oh_authority_dependencies"));
      statements.push(guardedDelete("oh_authority_records"));
      statements.push(guardedDelete("oh_authority_operations"));
      statements.push(guardedDelete("oh_authority_bindings"));
      statements.push(guardedDelete("oh_authority_spaces"));
      statements.push({
        sql: `INSERT INTO oh_authority_commit_guards(value)
        SELECT 'invalid' WHERE EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_operations WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_operation_records WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_operation_records AS materialized
            LEFT JOIN oh_authority_operations AS operation
              ON operation.operation_sha256 = materialized.operation_sha256
            WHERE operation.operation_sha256 IS NULL OR operation.space_id <> materialized.space_id)
          OR EXISTS (SELECT 1 FROM oh_authority_records WHERE space_id = ?)
          OR EXISTS (SELECT 1 FROM oh_authority_dependencies WHERE space_id = ?)
          OR NOT ${receiptExists}`,
        args: [
          this.binding.spaceId,
          this.binding.spaceId,
          this.binding.spaceId,
          this.binding.spaceId,
          this.binding.spaceId,
          this.binding.spaceId,
          this.binding.spaceId,
          receipt.receiptSha256
        ]
      });
      try {
        await this.#client.batch(statements, "write");
      } catch {
        const raced = await this.#readPurge();
        if (raced !== null) {
          await this.#assertPurgeComplete(raced);
          this.#purged = raced;
          return raced;
        }
        continue;
      }
      const persisted = await this.#readPurge();
      if (persisted !== null) {
        await this.#assertPurgeComplete(persisted);
        this.#purged = persisted;
        return persisted;
      }
    }
    throw new OhConflictError("The remote working space changed repeatedly while purging.");
  }
  async close() {
    if (this.#closed)
      return;
    this.#closed = true;
    if (this.#closeClient)
      this.#client.close?.();
  }
}
function bindOhLibSqlStoreAuthorityV1(client, binding, profile, closeClient) {
  const authority = new OhLibSqlStoreV1(client, binding, closeClient);
  const store = Object.freeze({
    binding,
    changesSince: (from, changeOptions) => authority.changesSince(from, changeOptions),
    close: () => authority.close(),
    commit: (input) => authority.commit(input),
    exportDependencyClosure: (input) => authority.exportDependencyClosure(input),
    head: () => authority.head(),
    snapshot: (snapshotOptions) => authority.snapshot(snapshotOptions),
    verify: () => authority.verify()
  });
  let purge = null;
  const host = Object.freeze({
    binding,
    purgeWorkingSpace: async (input) => {
      if (profile.profileKind !== "working" || !profile.capabilities.wholeSpacePurge) {
        throw new OhProfileError("This host handle is not bound to a purgeable working profile.");
      }
      if (purge !== null)
        return purge;
      purge = await authority.purgeWorkingSpace(input.purgedAt ?? canonicalNow());
      return purge;
    }
  });
  return Object.freeze({ host, store });
}
async function createOhLibSqlStoreAuthorityV1(client, options = {}) {
  const profile = parseOhStoreProfileV1(options.profile ?? OH_CANONICAL_STORE_PROFILE_V1);
  if (profile === null)
    throw new TypeError("Invalid libSQL store profile.");
  const spaceId = options.spaceId ?? "default";
  const binding = createOhStoreBindingV1({
    profile,
    realmId: options.realmId ?? `realm:${spaceId}`,
    spaceId,
    v: 1
  });
  await verifyAuthoritySchema(client);
  await initializeSpace(client, binding);
  return bindOhLibSqlStoreAuthorityV1(client, binding, profile, options.closeClient ?? false);
}
async function openExistingOhLibSqlStoreAuthorityV1(client, options = {}) {
  const profile = parseOhStoreProfileV1(options.profile ?? OH_CANONICAL_STORE_PROFILE_V1);
  if (profile === null)
    throw new TypeError("Invalid libSQL store profile.");
  const spaceId = options.spaceId ?? "default";
  const binding = createOhStoreBindingV1({
    profile,
    realmId: options.realmId ?? `realm:${spaceId}`,
    spaceId,
    v: 1
  });
  await verifyAuthoritySchema(client);
  await requireExistingSpace(client, binding);
  return bindOhLibSqlStoreAuthorityV1(client, binding, profile, options.closeClient ?? false);
}
async function purgeOhLibSqlWorkingSpaceV1(client, options = {}) {
  const closeClient = options.closeClient ?? false;
  try {
    const profile = parseOhStoreProfileV1(options.profile ?? OH_WORKING_STORE_PROFILE_V1);
    if (profile === null)
      throw new TypeError("Invalid libSQL store profile.");
    if (profile.profileKind !== "working" || !profile.capabilities.wholeSpacePurge) {
      throw new OhProfileError("Whole-space purge requires a bound working profile.");
    }
    const spaceId = options.spaceId ?? "default";
    const binding = createOhStoreBindingV1({
      profile,
      realmId: options.realmId ?? `realm:${spaceId}`,
      spaceId,
      v: 1
    });
    const purgedAt = options.purgedAt ?? canonicalNow();
    await verifyAuthoritySchema(client);
    for (let attempt = 0;attempt < 3; attempt += 1) {
      const proof = await client.batch([
        { sql: BINDING_ROW_SELECT, args: [binding.spaceId] },
        { sql: SPACE_PURGE_PROOF_SELECT, args: [binding.spaceId] },
        { sql: PURGE_ROW_SELECT, args: [binding.spaceId] }
      ], "read");
      if (proof.length !== 3) {
        throw new OhIntegrityError("The remote authority returned an incomplete purge proof.");
      }
      const [bindingResult, spaceResult, purgeResult] = proof;
      const existingPurge = purgeResult.rows[0];
      if (existingPurge !== undefined) {
        const receipt2 = parsePurgeReceiptRow(existingPurge, binding.spaceId, binding.bindingSha256);
        await assertRemotePurgeComplete(client, binding, receipt2);
        return receipt2;
      }
      const bindingRow = bindingResult.rows[0];
      const spaceRow = spaceResult.rows[0];
      if (bindingRow === undefined !== (spaceRow === undefined)) {
        throw new OhIntegrityError("The remote authority has only half of its space binding.");
      }
      if (bindingRow !== undefined && spaceRow !== undefined) {
        const persisted2 = parseBindingRow(bindingRow, binding.spaceId);
        if (canonicalJson(persisted2) !== canonicalJson(binding)) {
          throw new OhProfileError("The remote space is bound to a different realm or profile.");
        }
        if (rowValue(spaceRow, "contract_id", 5) !== OH_CONTRACT_MANIFEST_V1.contractId) {
          throw new OhIntegrityError("The existing remote space uses a different Oh contract.");
        }
        parseHeadRow(spaceRow);
        const authority = new OhLibSqlStoreV1(client, binding, false);
        return await authority.purgeWorkingSpace(purgedAt);
      }
      const receipt = createOhSpacePurgeReceiptV1({
        binding,
        priorHead: emptyOhHeadV1(),
        purgedAt
      });
      const receiptJson = canonicalJson(receipt);
      try {
        await client.batch([
          {
            sql: `INSERT INTO oh_authority_purges(space_id, binding_sha256,
            prior_operation_sha256, prior_sequence, purged_at, receipt_sha256, receipt_json)
            SELECT ?, ?, NULL, 0, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
              AND NOT EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ?)
            ON CONFLICT(space_id) DO NOTHING`,
            args: [
              binding.spaceId,
              binding.bindingSha256,
              receipt.purgedAt,
              receipt.receiptSha256,
              receiptJson,
              binding.spaceId,
              binding.spaceId
            ]
          },
          {
            sql: `INSERT INTO oh_authority_commit_guards(value)
            SELECT 'invalid' WHERE EXISTS (SELECT 1 FROM oh_authority_spaces WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_bindings WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_operations WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_operation_records WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_records WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_dependencies WHERE space_id = ?)
              OR EXISTS (SELECT 1 FROM oh_authority_operation_records AS materialized
                LEFT JOIN oh_authority_operations AS operation
                  ON operation.operation_sha256 = materialized.operation_sha256
                WHERE operation.operation_sha256 IS NULL
                  OR operation.space_id <> materialized.space_id)
              OR NOT EXISTS (SELECT 1 FROM oh_authority_purges
                WHERE space_id = ? AND receipt_sha256 = ?)`,
            args: [
              binding.spaceId,
              binding.spaceId,
              binding.spaceId,
              binding.spaceId,
              binding.spaceId,
              binding.spaceId,
              binding.spaceId,
              receipt.receiptSha256
            ]
          }
        ], "write");
      } catch (error) {
        const recovery = await client.batch([
          { sql: BINDING_ROW_SELECT, args: [binding.spaceId] },
          { sql: SPACE_PURGE_PROOF_SELECT, args: [binding.spaceId] },
          { sql: PURGE_ROW_SELECT, args: [binding.spaceId] }
        ], "read");
        if (recovery.length !== 3) {
          throw new OhIntegrityError("The remote authority returned an incomplete purge recovery proof.");
        }
        const raced = recovery[2]?.rows[0];
        if (raced !== undefined) {
          const persisted2 = parsePurgeReceiptRow(raced, binding.spaceId, binding.bindingSha256);
          await assertRemotePurgeComplete(client, binding, persisted2);
          return persisted2;
        }
        if (recovery[0]?.rows[0] !== undefined || recovery[1]?.rows[0] !== undefined)
          continue;
        throw error;
      }
      const persisted = await queryOne(client, { sql: PURGE_ROW_SELECT, args: [binding.spaceId] });
      if (persisted === null)
        continue;
      const exact = parsePurgeReceiptRow(persisted, binding.spaceId, binding.bindingSha256);
      await assertRemotePurgeComplete(client, binding, exact);
      return exact;
    }
    throw new OhConflictError("The remote working space changed repeatedly while fencing purge.");
  } finally {
    if (closeClient)
      client.close?.();
  }
}
export {
  purgeOhLibSqlWorkingSpaceV1,
  openExistingOhLibSqlStoreAuthorityV1,
  createOhLibSqlStoreAuthorityV1,
  bootstrapOhLibSqlAuthorityV1,
  OH_LIBSQL_STORE_LIMITS_V1
};
