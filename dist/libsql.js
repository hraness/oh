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

// src/libsql.ts
var AUTHORITY_SCHEMA_NAME = "oh.libsql-authority.v1";
var AUTHORITY_SCHEMA_VERSION = 1;
var EMPTY_RECORDS_SHA2562 = canonicalSha256([]);
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
  "CREATE INDEX IF NOT EXISTS oh_authority_dependencies_dependency ON oh_authority_dependencies(space_id, dependency_key)"
]);
var AUTHORITY_SCHEMA_SHA256 = canonicalSha256(AUTHORITY_SCHEMA_STATEMENTS);
function rowValue(row, key, index) {
  return Array.isArray(row) ? row[index] : row[key];
}
function integer(value) {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
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
}
async function bootstrapOhLibSqlAuthorityV1(client) {
  await client.execute(`CREATE TABLE IF NOT EXISTS oh_authority_schemas (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    schema_sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = await queryOne(client, { sql: `SELECT name, schema_sha256
    FROM oh_authority_schemas WHERE version = ?`, args: [AUTHORITY_SCHEMA_VERSION] });
  if (applied !== null && (rowValue(applied, "name", 0) !== AUTHORITY_SCHEMA_NAME || rowValue(applied, "schema_sha256", 1) !== AUTHORITY_SCHEMA_SHA256)) {
    throw new OhIntegrityError("The installed libSQL authority schema differs from this runtime.");
  }
  const setup = AUTHORITY_SCHEMA_STATEMENTS.map((sql) => ({ sql }));
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
    sql: "SELECT receipt_json FROM oh_authority_purges WHERE space_id = ?",
    args: [binding.spaceId]
  });
  if (purged !== null) {
    const json = rowValue(purged, "receipt_json", 0);
    if (typeof json !== "string")
      throw new OhIntegrityError("A remote purge receipt is invalid.");
    const receipt = parseOhSpacePurgeReceiptV1(JSON.parse(json));
    if (receipt === null || canonicalJson(receipt) !== json)
      throw new OhIntegrityError("A remote purge receipt is invalid.");
    throw new OhPurgedSpaceError(receipt);
  }
  const now = canonicalNow();
  await client.batch([
    {
      sql: `INSERT INTO oh_authority_spaces(space_id, contract_id, generation,
      head_operation_sha256, graph_revision_sha256, records_sha256, sequence, created_at, updated_at)
      VALUES (?, ?, 0, NULL, NULL, ?, 0, ?, ?) ON CONFLICT(space_id) DO NOTHING`,
      args: [binding.spaceId, OH_CONTRACT_MANIFEST_V1.contractId, EMPTY_RECORDS_SHA2562, now, now]
    },
    {
      sql: `INSERT INTO oh_authority_bindings(space_id, realm_id, profile_id, profile_kind,
      profile_sha256, binding_sha256, binding_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(space_id) DO NOTHING`,
      args: [
        binding.spaceId,
        binding.realmId,
        binding.profile.profileId,
        binding.profile.profileKind,
        binding.profile.profileSha256,
        binding.bindingSha256,
        canonicalJson(binding),
        now
      ]
    }
  ], "write");
  const persisted = await queryOne(client, {
    sql: "SELECT binding_json FROM oh_authority_bindings WHERE space_id = ?",
    args: [binding.spaceId]
  });
  if (persisted === null || rowValue(persisted, "binding_json", 0) !== canonicalJson(binding)) {
    throw new OhProfileError("The remote space is already bound to a different realm or profile.");
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
      sql: "SELECT receipt_json FROM oh_authority_purges WHERE space_id = ?",
      args: [this.binding.spaceId]
    });
    if (row === null)
      return null;
    const json = rowValue(row, "receipt_json", 0);
    if (typeof json !== "string")
      throw new OhIntegrityError("A remote purge receipt is invalid.");
    const receipt = parseOhSpacePurgeReceiptV1(JSON.parse(json));
    if (receipt === null || canonicalJson(receipt) !== json)
      throw new OhIntegrityError("A remote purge receipt is invalid.");
    return receipt;
  }
  async#headAt(reference) {
    const parsed = parseOhHeadRefV1(reference);
    if (parsed === null)
      throw new TypeError("Invalid Oh head reference.");
    if (parsed.sequence === 0)
      return emptyOhHeadV1();
    const row = await queryOne(this.#client, { sql: `SELECT operation_json FROM oh_authority_operations
      WHERE space_id = ? AND sequence = ?`, args: [this.binding.spaceId, parsed.sequence] });
    if (row === null)
      throw new OhConflictError("The requested head is not present in this space.");
    const operation = parseOperationJson(rowValue(row, "operation_json", 0));
    if (operation.operationSha256 !== parsed.operationSha256) {
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
  async snapshot(options = {}) {
    this.#assertOpen();
    const current = await this.head();
    const target = options.head === undefined ? current : await this.#headAt(options.head);
    if (target.sequence > current.sequence)
      throw new OhConflictError("The requested head is ahead of this space.");
    const rows = (await this.#client.execute({ sql: `SELECT operation_json FROM oh_authority_operations
      WHERE space_id = ? AND sequence <= ? ORDER BY sequence`, args: [this.binding.spaceId, target.sequence] })).rows;
    const operations = rows.map((row) => parseOperationJson(rowValue(row, "operation_json", 0)));
    const snapshot = replayOhOperationsV1(this.binding.spaceId, operations, options.maximumRecords);
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
    const limit = normalizeLimit(options.limit);
    const current = await this.head();
    const fromHead = await this.#headAt(from);
    const through = options.through === undefined ? current : await this.#headAt(options.through);
    if (fromHead.sequence > through.sequence || through.sequence > current.sequence) {
      throw new OhConflictError("The change-feed bounds do not identify one remote history prefix.");
    }
    const rows = (await this.#client.execute({
      sql: `SELECT operation_json FROM oh_authority_operations
      WHERE space_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence LIMIT ?`,
      args: [this.binding.spaceId, fromHead.sequence, through.sequence, limit + 1]
    })).rows;
    const parsed = rows.map((row) => parseOperationJson(rowValue(row, "operation_json", 0)));
    const hasMore = parsed.length > limit;
    const operations = parsed.slice(0, limit);
    let prior = fromHead;
    for (const operation of operations) {
      if (operation.sequence !== prior.sequence + 1 || operation.parentOperationSha256 !== prior.operationSha256) {
        throw new OhIntegrityError("The remote change feed contains a gap or fork.");
      }
      prior = { operationSha256: operation.operationSha256, sequence: operation.sequence };
    }
    return {
      from: { operationSha256: fromHead.operationSha256, sequence: fromHead.sequence },
      hasMore,
      operations,
      through,
      to: prior,
      v: 1
    };
  }
  async#assertMaterializedSnapshot(snapshot) {
    const rows = (await this.#client.execute({ sql: `SELECT record_json FROM oh_authority_records
      WHERE space_id = ? ORDER BY record_key`, args: [this.binding.spaceId] })).rows;
    const records = rows.map((row) => {
      const json = rowValue(row, "record_json", 0);
      if (typeof json !== "string")
        throw new OhIntegrityError("A materialized remote record is not JSON text.");
      const parsed = parseKnowledgeGraphRecordV1(JSON.parse(json));
      if (parsed === null || canonicalJson(parsed) !== json)
        throw new OhIntegrityError("A materialized remote record is invalid.");
      return parsed;
    });
    if (canonicalJson(records) !== canonicalJson(snapshot.records)) {
      throw new OhIntegrityError("Remote materialized records do not match operation replay.");
    }
    const dependencyRows = (await this.#client.execute({
      sql: `SELECT record_key, dependency_key
      FROM oh_authority_dependencies WHERE space_id = ? ORDER BY record_key, dependency_key`,
      args: [this.binding.spaceId]
    })).rows.map((row) => ({
      dependency_key: rowValue(row, "dependency_key", 1),
      record_key: rowValue(row, "record_key", 0)
    }));
    const expectedDependencies = snapshot.records.flatMap((record) => record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })));
    if (canonicalJson(dependencyRows) !== canonicalJson(expectedDependencies)) {
      throw new OhIntegrityError("Remote materialized dependencies do not match operation replay.");
    }
  }
  async#operationById(operationId) {
    const row = await queryOne(this.#client, { sql: `SELECT operation_json FROM oh_authority_operations
      WHERE space_id = ? AND operation_id = ?`, args: [this.binding.spaceId, operationId] });
    return row === null ? null : parseOperationJson(rowValue(row, "operation_json", 0));
  }
  async commit(input) {
    this.#assertOpen();
    const actorId = safeCode(input.actorId);
    const operationId = safeCode(input.operationId);
    const changes = canonicalKnowledgeGraphChangesV1(input.changes);
    if (actorId === null || operationId === null || changes.length === 0)
      throw new TypeError("Invalid Oh commit input.");
    const duplicate = await this.#operationById(operationId);
    if (duplicate !== null) {
      if (duplicate.actorId !== actorId || canonicalJson(duplicate.changes) !== canonicalJson(changes)) {
        throw new OhConflictError("The operation ID is already bound to different content.");
      }
      return duplicate;
    }
    const current = await this.head();
    if (!Number.isSafeInteger(input.expectedHead.generation) || input.expectedHead.generation < 0 || current.generation !== input.expectedHead.generation || current.operationSha256 !== input.expectedHead.operationSha256) {
      throw new OhConflictError("The expected head does not match the current remote space head.");
    }
    const snapshot = await this.snapshot({ head: current });
    await this.#assertMaterializedSnapshot(snapshot);
    const transition = transitionOhSnapshotV1({
      actorId,
      changes,
      instant: input.instant ?? canonicalNow(),
      operationId,
      snapshot,
      spaceId: this.binding.spaceId
    });
    const operation = transition.operation;
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
        sql: `INSERT INTO oh_authority_operation_records(operation_sha256,
        ordinal, record_key, change_kind, record_sha256)
        SELECT ?, ?, ?, ?, ? WHERE ${existsOperation}`,
        args: [operation.operationSha256, ordinal, key, change.kind, digest, operation.operationSha256]
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
    try {
      await this.#client.batch(statements, "write");
    } catch (error) {
      const raced = await this.#operationById(operationId);
      if (raced !== null && raced.actorId === actorId && canonicalJson(raced.changes) === canonicalJson(changes))
        return raced;
      const head = await this.head();
      if (head.operationSha256 !== current.operationSha256) {
        throw new OhConflictError("The remote space head changed while committing.");
      }
      throw error;
    }
    const persisted = await this.#operationById(operationId);
    if (persisted === null || canonicalJson(persisted) !== canonicalJson(operation)) {
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
    const countRow = await queryOne(this.#client, { sql: `SELECT count(*) AS count
      FROM oh_authority_operations WHERE space_id = ?`, args: [this.binding.spaceId] });
    const operations = countRow === null ? null : integer(rowValue(countRow, "count", 0));
    if (operations === null || operations !== snapshot.head.sequence) {
      throw new OhIntegrityError("Remote operation count does not match its head.");
    }
    return {
      head: snapshot.head,
      integrity: "verified",
      operations,
      records: snapshot.records.length,
      v: 1
    };
  }
  async purgeWorkingSpace(purgedAt) {
    this.#assertOpen();
    if (this.binding.profile.profileKind !== "working" || !this.binding.profile.capabilities.wholeSpacePurge) {
      throw new OhProfileError("Whole-space purge requires a bound working profile.");
    }
    for (let attempt = 0;attempt < 3; attempt += 1) {
      const existing = await this.#readPurge();
      if (existing !== null) {
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
        sql: `DELETE FROM oh_authority_operation_records WHERE operation_sha256 IN
        (SELECT operation_sha256 FROM oh_authority_operations WHERE space_id = ?)
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
          OR NOT ${receiptExists}`,
        args: [this.binding.spaceId, this.binding.spaceId, receipt.receiptSha256]
      });
      try {
        await this.#client.batch(statements, "write");
      } catch {
        const raced = await this.#readPurge();
        if (raced !== null) {
          this.#purged = raced;
          return raced;
        }
        continue;
      }
      const persisted = await this.#readPurge();
      if (persisted !== null) {
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
  const authority = new OhLibSqlStoreV1(client, binding, options.closeClient ?? false);
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
export {
  createOhLibSqlStoreAuthorityV1,
  bootstrapOhLibSqlAuthorityV1
};
