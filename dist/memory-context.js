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
var OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 = Object.freeze([
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
]);
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
// src/errors.ts
var OH_OPERATION_SIZE_ERROR_CODE_V1 = "oh.operation-size.v1";
var OH_CONFLICT_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhConflictError/v1");
var OH_DEPENDENCY_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhDependencyError/v1");
var OH_INTEGRITY_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhIntegrityError/v1");
var OH_OPERATION_SIZE_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhOperationSizeError/v1");
var OH_PROFILE_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhProfileError/v1");
function immutableOwnValue(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.get === undefined && descriptor.set === undefined && descriptor.configurable === false && descriptor.writable === false ? descriptor.value : undefined;
}
function brandNativeError(value, brand) {
  Object.defineProperty(value, brand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false
  });
}
function hasNativeErrorBrand(value, brand) {
  try {
    return Error.isError(value) && immutableOwnValue(value, brand) === true;
  } catch {
    return false;
  }
}
function hasNativeSubclassInstance(constructor, value) {
  return Function.prototype[Symbol.hasInstance].call(constructor, value);
}
function isOhConflictError(value) {
  return hasNativeErrorBrand(value, OH_CONFLICT_ERROR_BRAND_V1);
}

class OhConflictError extends Error {
  static [Symbol.hasInstance](value) {
    return this === OhConflictError ? isOhConflictError(value) : hasNativeSubclassInstance(this, value);
  }
  constructor(message) {
    super(message);
    this.name = "OhConflictError";
    brandNativeError(this, OH_CONFLICT_ERROR_BRAND_V1);
  }
}
function isOhIntegrityError(value) {
  return hasNativeErrorBrand(value, OH_INTEGRITY_ERROR_BRAND_V1);
}

class OhIntegrityError extends Error {
  static [Symbol.hasInstance](value) {
    return this === OhIntegrityError ? isOhIntegrityError(value) : hasNativeSubclassInstance(this, value);
  }
  constructor(message) {
    super(message);
    this.name = "OhIntegrityError";
    brandNativeError(this, OH_INTEGRITY_ERROR_BRAND_V1);
  }
}
function isOhDependencyError(value) {
  return hasNativeErrorBrand(value, OH_DEPENDENCY_ERROR_BRAND_V1);
}

class OhDependencyError extends Error {
  static [Symbol.hasInstance](value) {
    return this === OhDependencyError ? isOhDependencyError(value) : hasNativeSubclassInstance(this, value);
  }
  constructor(message) {
    super(message);
    this.name = "OhDependencyError";
    brandNativeError(this, OH_DEPENDENCY_ERROR_BRAND_V1);
  }
}
function isOhProfileError(value) {
  return hasNativeErrorBrand(value, OH_PROFILE_ERROR_BRAND_V1);
}

class OhProfileError extends Error {
  static [Symbol.hasInstance](value) {
    return this === OhProfileError ? isOhProfileError(value) : hasNativeSubclassInstance(this, value);
  }
  constructor(message) {
    super(message);
    this.name = "OhProfileError";
    brandNativeError(this, OH_PROFILE_ERROR_BRAND_V1);
  }
}
function isOhOperationSizeError(value) {
  try {
    if (!Error.isError(value) || !(value instanceof RangeError))
      return false;
    const operationBytes = immutableOwnValue(value, "operationBytes");
    const maximumOperationBytes = immutableOwnValue(value, "maximumOperationBytes");
    return immutableOwnValue(value, OH_OPERATION_SIZE_ERROR_BRAND_V1) === true && immutableOwnValue(value, "code") === OH_OPERATION_SIZE_ERROR_CODE_V1 && Number.isSafeInteger(operationBytes) && operationBytes > 0 && Number.isSafeInteger(maximumOperationBytes) && maximumOperationBytes > 0 && operationBytes > maximumOperationBytes;
  } catch {
    return false;
  }
}

class OhOperationSizeError extends RangeError {
  static [Symbol.hasInstance](value) {
    return this === OhOperationSizeError ? isOhOperationSizeError(value) : hasNativeSubclassInstance(this, value);
  }
  constructor(operationBytes, maximumOperationBytes) {
    if (!Number.isSafeInteger(operationBytes) || operationBytes < 1 || !Number.isSafeInteger(maximumOperationBytes) || maximumOperationBytes < 1 || operationBytes <= maximumOperationBytes) {
      throw new TypeError("Invalid Oh operation size refusal.");
    }
    super(`The ${operationBytes}-byte operation exceeds the host-declared ${maximumOperationBytes}-byte canonical bound.`);
    this.name = "OhOperationSizeError";
    Object.defineProperties(this, {
      [OH_OPERATION_SIZE_ERROR_BRAND_V1]: {
        configurable: false,
        enumerable: false,
        value: true,
        writable: false
      },
      code: {
        configurable: false,
        enumerable: true,
        value: OH_OPERATION_SIZE_ERROR_CODE_V1,
        writable: false
      },
      maximumOperationBytes: {
        configurable: false,
        enumerable: true,
        value: maximumOperationBytes,
        writable: false
      },
      operationBytes: {
        configurable: false,
        enumerable: true,
        value: operationBytes,
        writable: false
      }
    });
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
function createOhOperationV1(input, options = {}) {
  const maximumOperationBytes = options.maximumOperationBytes ?? OH_OPERATION_MAX_BYTES_V1;
  if (!Number.isSafeInteger(maximumOperationBytes) || maximumOperationBytes < 1 || maximumOperationBytes > OH_OPERATION_MAX_BYTES_V1) {
    throw new TypeError("Invalid Oh operation byte bound.");
  }
  const payload = parsePayload(input);
  if (payload === null)
    throw new TypeError("Invalid Oh operation payload.");
  const operation = { ...payload, operationSha256: canonicalSha256(payload) };
  const operationBytes = Buffer.byteLength(canonicalJson(operation), "utf8");
  if (operationBytes > maximumOperationBytes) {
    throw new OhOperationSizeError(operationBytes, maximumOperationBytes);
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
var OH_RECORD_REVISIONS_LIMITS_V1 = Object.freeze({
  changesPerKey: 65536,
  operationsPerRead: 1000
});
function parseOhRecordRevisionChangeV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["kind", "recordSha256", "sequence", "v"]) || value.v !== 1 || value.kind !== "put" && value.kind !== "tombstone")
    return null;
  const recordSha256 = parseSha256Hex(value.recordSha256);
  const sequence = Number.isSafeInteger(value.sequence) && value.sequence > 0 ? value.sequence : null;
  return recordSha256 !== null && sequence !== null ? { kind: value.kind, recordSha256, sequence, v: 1 } : null;
}
function reduceOhRecordRevisionsV1(input) {
  if (!isPlainRecord(input) || !hasExactKeys(input, ["changes", "fromSequence", "key", "through", "truncated"]) || !Array.isArray(input.changes)) {
    throw new TypeError("Invalid record revision input.");
  }
  const key = safeCode(input.key, 512);
  const through = Number.isSafeInteger(input.through) && input.through >= 0 ? input.through : null;
  const fromSequence = Number.isSafeInteger(input.fromSequence) && input.fromSequence >= 0 ? input.fromSequence : null;
  if (key === null || through === null || fromSequence === null || typeof input.truncated !== "boolean") {
    throw new TypeError("Invalid record revision input.");
  }
  if (fromSequence > 0 && through > 0 && fromSequence > through) {
    throw new RangeError("A record revision read cannot start after the sequence it was read through.");
  }
  const truncated = input.truncated || through > 0 && fromSequence !== 1;
  if (input.changes.length > OH_RECORD_REVISIONS_LIMITS_V1.changesPerKey) {
    throw new RangeError(`A record revision read accepts at most ${OH_RECORD_REVISIONS_LIMITS_V1.changesPerKey} changes.`);
  }
  const parsed = [];
  const sequences = new Set;
  for (const value of input.changes) {
    const change = parseOhRecordRevisionChangeV1(value);
    if (change === null)
      throw new TypeError("Invalid record revision change.");
    if (change.sequence > through)
      throw new RangeError("A record revision change is ahead of its through sequence.");
    if (sequences.has(change.sequence))
      throw new TypeError("A record key has two changes at one sequence.");
    sequences.add(change.sequence);
    parsed.push(change);
  }
  parsed.sort((left, right) => left.sequence - right.sequence);
  const digests = new Set;
  let puts = 0;
  let tombstones = 0;
  let idempotentPuts = 0;
  let priorPutDigest = null;
  for (const change of parsed) {
    if (change.kind === "put") {
      puts += 1;
      digests.add(change.recordSha256);
      if (priorPutDigest === change.recordSha256)
        idempotentPuts += 1;
      priorPutDigest = change.recordSha256;
    } else {
      tombstones += 1;
      priorPutDigest = null;
    }
  }
  const latest = parsed.at(-1) ?? null;
  return {
    changes: parsed.length,
    distinctPutDigests: digests.size,
    idempotentPuts,
    key,
    latestKind: latest === null ? null : latest.kind,
    latestSequence: latest?.sequence ?? null,
    oldestObservedSequence: parsed[0]?.sequence ?? null,
    puts,
    revisions: puts === 0 ? 0 : puts - 1,
    through,
    tombstones,
    truncated,
    v: 1
  };
}
function ohRecordRevisionChangesFromOperationsV1(input) {
  if (!isPlainRecord(input) || !Array.isArray(input.operations)) {
    throw new TypeError("Invalid record revision operation input.");
  }
  const key = safeCode(input.key, 512);
  const spaceId = safeCode(input.spaceId);
  if (key === null)
    throw new TypeError("Invalid record key.");
  if (spaceId === null)
    throw new TypeError("Invalid space ID.");
  if (input.operations.length > OH_RECORD_REVISIONS_LIMITS_V1.operationsPerRead) {
    throw new RangeError(`A record revision read accepts at most ${OH_RECORD_REVISIONS_LIMITS_V1.operationsPerRead} operations.`);
  }
  const changes = [];
  let prior = null;
  let first = 0;
  for (const value of input.operations) {
    const operation = parseOhOperationV1(value);
    if (operation === null)
      throw new OhIntegrityError("A revision source operation is invalid.");
    if (prior === null)
      first = operation.sequence;
    if (operation.spaceId !== spaceId) {
      throw new TypeError(`A revision source operation belongs to ${operation.spaceId}, not ${spaceId}.`);
    }
    if (prior !== null && (operation.sequence !== prior.sequence + 1 || operation.parentOperationSha256 !== prior.operationSha256)) {
      throw new TypeError("Record revision operations must be one contiguous run in sequence order.");
    }
    prior = operation;
    for (const change of operation.changes) {
      if (change.kind === "put" && change.record.key === key) {
        changes.push({ kind: "put", recordSha256: change.record.recordSha256, sequence: operation.sequence, v: 1 });
      } else if (change.kind === "tombstone" && change.key === key) {
        changes.push({ kind: "tombstone", recordSha256: change.priorSha256, sequence: operation.sequence, v: 1 });
      }
    }
  }
  return { changes, fromSequence: prior === null ? 0 : first };
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
  }, input.maximumOperationBytes === undefined ? {} : {
    maximumOperationBytes: input.maximumOperationBytes
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

// src/memory-context.ts
import { createHmac, randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";
var OH_MEMORY_CONTEXT_FORMAT_VERSION_V1 = 1;
var OH_MEMORY_CONTEXT_LANES_V1 = Object.freeze(["canonical", "working"]);
var OH_MEMORY_CONTEXT_LIMITS_V1 = Object.freeze({
  bindings: 2,
  changeFeedPage: 1000,
  continuationBytes: 4 * 1024,
  continuationKeyBytes: 32,
  detailedIndices: 1024,
  leafFetchesPerRead: 128,
  leaves: 4096,
  pageBytes: 1024 * 1024,
  pageItems: 64,
  poolBytes: 8 * 1024 * 1024,
  scannedBytes: 8 * 1024 * 1024,
  searchMatches: 256,
  searchPatternBytes: 512,
  summariesPerGeneration: 2048,
  summaryBodyBytes: 32 * 1024,
  summaryChildren: 2
});
var OH_MEMORY_CONTEXT_CONTINUATION_LIFETIME_MS_V1 = 15 * 60 * 1000;

class OhMemoryContextError extends OhIntegrityError {
  constructor(reason, message) {
    super(message);
    this.name = "OhMemoryContextError";
    Object.defineProperty(this, "reason", {
      configurable: false,
      enumerable: true,
      value: reason,
      writable: false
    });
  }
}

class OhMemoryContextContinuationError extends OhIntegrityError {
  constructor(reason, message) {
    super(message);
    this.name = "OhMemoryContextContinuationError";
    Object.defineProperties(this, {
      code: { configurable: false, enumerable: true, value: "memory-context-continuation", writable: false },
      reason: { configurable: false, enumerable: true, value: reason, writable: false }
    });
  }
}
function contextError(reason, message) {
  throw new OhMemoryContextError(reason, message);
}
function laneOf(value) {
  return value === "canonical" || value === "working" ? value : null;
}
function positiveInt(value, maximum, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}
function digestList(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum)
    return null;
  const digests = [];
  for (const entry of value) {
    const digest = parseSha256Hex(entry);
    if (digest === null)
      return null;
    digests.push(digest);
  }
  return digests;
}
function parseLeaf(value, label) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "changeIndex",
    "instant",
    "key",
    "kind",
    "lane",
    "live",
    "operationSha256",
    "parentOperationSha256",
    "recordSha256",
    "sequence",
    "v"
  ]) || value.v !== 1 || value.kind !== "put" && value.kind !== "tombstone" || typeof value.live !== "boolean") {
    throw new TypeError(`${label} is not a memory-context leaf.`);
  }
  const instant = parseCanonicalInstantV1(value.instant);
  const key = safeCode(value.key, 512);
  const lane = laneOf(value.lane);
  const operationSha256 = parseSha256Hex(value.operationSha256);
  const parentOperationSha256 = value.parentOperationSha256 === null ? null : parseSha256Hex(value.parentOperationSha256);
  const recordSha256 = parseSha256Hex(value.recordSha256);
  const changeIndex = positiveInt(value.changeIndex, OH_GRAPH_LIMITS_V1.changesPerOperation - 1);
  const sequence = positiveInt(value.sequence, Number.MAX_SAFE_INTEGER, 1);
  if (instant === null || key === null || lane === null || operationSha256 === null || recordSha256 === null || changeIndex === null || sequence === null || value.parentOperationSha256 === null !== (sequence === 1)) {
    throw new TypeError(`${label} has an invalid identity.`);
  }
  return Object.freeze({
    changeIndex,
    instant,
    key,
    kind: value.kind,
    lane,
    live: value.live,
    operationSha256,
    parentOperationSha256,
    recordSha256,
    sequence,
    v: 1
  });
}
function ohMemoryContextLeafSha256V1(leaf) {
  return canonicalSha256(leaf);
}
function parseLaneBinding(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["bindingSha256", "head", "lane"])) {
    throw new TypeError("A lane binding must carry exactly bindingSha256, head, and lane.");
  }
  const bindingSha256 = parseSha256Hex(value.bindingSha256);
  const head = parseOhHeadV1(value.head);
  const lane = laneOf(value.lane);
  if (bindingSha256 === null || head === null || lane === null) {
    throw new TypeError("Invalid memory-context lane binding.");
  }
  return Object.freeze({ bindingSha256, head, lane });
}
function leafOrder(leaf) {
  return `${leaf.instant} ${leaf.lane} ${String(leaf.sequence).padStart(16, "0")} ` + `${String(leaf.changeIndex).padStart(8, "0")}`;
}
function ohMemoryContextHistorySha256V1(history) {
  return canonicalSha256(history);
}
function parseOhMemoryContextHistoryV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["bindings", "leaves", "v"]) || value.v !== 1 || !Array.isArray(value.bindings) || !Array.isArray(value.leaves) || value.bindings.length < 1 || value.bindings.length > OH_MEMORY_CONTEXT_LIMITS_V1.bindings || value.leaves.length > OH_MEMORY_CONTEXT_LIMITS_V1.leaves) {
    throw new TypeError("Invalid memory-context history envelope.");
  }
  const bindings = value.bindings.map(parseLaneBinding);
  if (!orderedUnique(bindings, (binding) => binding.lane)) {
    throw new TypeError("Memory-context lane bindings must be unique and ordered.");
  }
  const lanes = new Set(bindings.map((binding) => binding.lane));
  const heads = new Map(bindings.map((binding) => [binding.lane, binding.head]));
  const leaves = value.leaves.map((leaf, index) => parseLeaf(leaf, `leaves[${index}]`));
  for (const [index, leaf] of leaves.entries()) {
    if (!lanes.has(leaf.lane)) {
      throw new TypeError(`leaves[${index}] names a lane the capture does not bind.`);
    }
    if (leaf.sequence > heads.get(leaf.lane).sequence) {
      throw new TypeError(`leaves[${index}] is ahead of its captured head.`);
    }
    if (index > 0 && leafOrder(leaves[index - 1]) >= leafOrder(leaf)) {
      throw new TypeError("Memory-context leaves must be in canonical merge order.");
    }
    if (leaf.kind === "tombstone" && leaf.live) {
      throw new TypeError("A tombstone leaf cannot be live at the captured head.");
    }
  }
  return Object.freeze({
    bindings: Object.freeze(bindings),
    leaves: Object.freeze(leaves),
    v: 1
  });
}
function sourcesDigest(leaves, start, end) {
  return canonicalSha256(leaves.slice(start, end).map((leaf) => canonicalSha256(leaf)));
}
function createOhMemoryContextNodeV1(history, start, end) {
  const length = end - start;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > history.leaves.length || length < 1 || (length & length - 1) !== 0 || start % length !== 0) {
    throw new RangeError("A memory-context node must be an aligned power-of-two leaf range.");
  }
  return Object.freeze({
    end,
    historySha256: ohMemoryContextHistorySha256V1(history),
    sourcesSha256: sourcesDigest(history.leaves, start, end),
    start,
    v: 1
  });
}
function ohMemoryContextNodeSha256V1(node) {
  return canonicalSha256(node);
}
function parseOhMemoryContextNodeV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "end",
    "historySha256",
    "sourcesSha256",
    "start",
    "v"
  ]) || value.v !== 1)
    throw new TypeError("Invalid memory-context node.");
  const historySha256 = parseSha256Hex(value.historySha256);
  const sourcesSha256 = parseSha256Hex(value.sourcesSha256);
  const start = positiveInt(value.start, OH_MEMORY_CONTEXT_LIMITS_V1.leaves);
  const end = positiveInt(value.end, OH_MEMORY_CONTEXT_LIMITS_V1.leaves, 1);
  if (historySha256 === null || sourcesSha256 === null || start === null || end === null) {
    throw new TypeError("Invalid memory-context node identity.");
  }
  return Object.freeze({ end, historySha256, sourcesSha256, start, v: 1 });
}
function ohMemoryContextSummarySha256V1(summary) {
  return canonicalSha256(summary);
}
function parseOhMemoryContextSummaryV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "body",
    "childrenSha256s",
    "historySha256",
    "nodeSha256",
    "policySha256",
    "promptSha256",
    "sourcesSha256",
    "summarizerSha256",
    "v"
  ]) || value.v !== 1)
    throw new TypeError("Invalid memory-context summary envelope.");
  const historySha256 = parseSha256Hex(value.historySha256);
  const nodeSha256 = parseSha256Hex(value.nodeSha256);
  const policySha256 = parseSha256Hex(value.policySha256);
  const promptSha256 = parseSha256Hex(value.promptSha256);
  const sourcesSha256 = parseSha256Hex(value.sourcesSha256);
  const summarizerSha256 = parseSha256Hex(value.summarizerSha256);
  const childrenSha256s = digestList(value.childrenSha256s, OH_MEMORY_CONTEXT_LIMITS_V1.summaryChildren);
  if (typeof value.body !== "string" || value.body.length === 0 || utf8ByteLength(value.body) > OH_MEMORY_CONTEXT_LIMITS_V1.summaryBodyBytes || value.body !== value.body.normalize("NFC")) {
    throw new TypeError("Invalid memory-context summary body.");
  }
  if (historySha256 === null || nodeSha256 === null || policySha256 === null || promptSha256 === null || sourcesSha256 === null || summarizerSha256 === null || childrenSha256s === null) {
    throw new TypeError("Invalid memory-context summary lineage.");
  }
  return Object.freeze({
    body: value.body,
    childrenSha256s: Object.freeze([...childrenSha256s]),
    historySha256,
    nodeSha256,
    policySha256,
    promptSha256,
    sourcesSha256,
    summarizerSha256,
    v: 1
  });
}
function ohMemoryContextGenerationSha256V1(generation) {
  return canonicalSha256(generation);
}
function parseOhMemoryContextGenerationV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "generation",
    "historySha256",
    "policySha256",
    "promptSha256",
    "summarizerSha256",
    "summaries",
    "v"
  ]) || value.v !== 1 || !Array.isArray(value.summaries) || value.summaries.length > OH_MEMORY_CONTEXT_LIMITS_V1.summariesPerGeneration) {
    throw new TypeError("Invalid memory-context generation envelope.");
  }
  const generation = positiveInt(value.generation, Number.MAX_SAFE_INTEGER);
  const historySha256 = parseSha256Hex(value.historySha256);
  const policySha256 = parseSha256Hex(value.policySha256);
  const promptSha256 = parseSha256Hex(value.promptSha256);
  const summarizerSha256 = parseSha256Hex(value.summarizerSha256);
  const summaries = [];
  for (const [index, entry] of value.summaries.entries()) {
    if (!isPlainRecord(entry) || !hasExactKeys(entry, ["nodeSha256", "summarySha256"])) {
      throw new TypeError(`Invalid memory-context generation entry ${index}.`);
    }
    const nodeSha256 = parseSha256Hex(entry.nodeSha256);
    const summarySha256 = parseSha256Hex(entry.summarySha256);
    if (nodeSha256 === null || summarySha256 === null) {
      throw new TypeError(`Invalid memory-context generation entry ${index}.`);
    }
    summaries.push({ nodeSha256, summarySha256 });
  }
  if (!orderedUnique(summaries, (entry) => entry.nodeSha256)) {
    throw new TypeError("Generation entries must be unique and ordered by node digest.");
  }
  if (generation === null || historySha256 === null || policySha256 === null || promptSha256 === null || summarizerSha256 === null) {
    throw new TypeError("Invalid memory-context generation identity.");
  }
  return Object.freeze({
    generation,
    historySha256,
    policySha256,
    promptSha256,
    summarizerSha256,
    summaries: Object.freeze(summaries),
    v: 1
  });
}
function parseOhMemoryContextPoolV1(history, value) {
  const historySha256 = ohMemoryContextHistorySha256V1(history);
  if (!isPlainRecord(value) || !hasExactKeys(value, ["generation", "nodes", "summaries"]) || !Array.isArray(value.nodes) || !Array.isArray(value.summaries) || value.nodes.length > OH_MEMORY_CONTEXT_LIMITS_V1.summariesPerGeneration || value.summaries.length > OH_MEMORY_CONTEXT_LIMITS_V1.summariesPerGeneration || utf8ByteLength(canonicalJson(value)) > OH_MEMORY_CONTEXT_LIMITS_V1.poolBytes) {
    throw new TypeError("Invalid memory-context derivative pool.");
  }
  const generation = parseOhMemoryContextGenerationV1(value.generation);
  if (generation.historySha256 !== historySha256) {
    throw new OhMemoryContextError("integrity", "Derivative generation belongs to another history.");
  }
  const nodes = new Map;
  for (const candidate of value.nodes) {
    const parsed = parseOhMemoryContextNodeV1(candidate);
    const recomputed = createOhMemoryContextNodeV1(history, parsed.start, parsed.end);
    if (canonicalJson(parsed) !== canonicalJson(recomputed) || ohMemoryContextNodeSha256V1(parsed) !== ohMemoryContextNodeSha256V1(recomputed)) {
      throw new OhMemoryContextError("integrity", "A derivative node does not match its history range.");
    }
    nodes.set(ohMemoryContextNodeSha256V1(parsed), parsed);
  }
  const summaries = new Map;
  for (const candidate of value.summaries) {
    const parsed = parseOhMemoryContextSummaryV1(candidate);
    const node = nodes.get(parsed.nodeSha256);
    if (parsed.historySha256 !== historySha256 || node === undefined || parsed.sourcesSha256 !== node.sourcesSha256 || parsed.promptSha256 !== generation.promptSha256 || parsed.policySha256 !== generation.policySha256 || parsed.summarizerSha256 !== generation.summarizerSha256) {
      throw new OhMemoryContextError("integrity", "A summary does not match its node's sources or recipe.");
    }
    if (parsed.childrenSha256s.length !== 0 && !(node.end - node.start > 1 && parsed.childrenSha256s.length === 2)) {
      throw new OhMemoryContextError("integrity", "A summary lists children only for a multi-leaf node, and then exactly two.");
    }
    summaries.set(ohMemoryContextSummarySha256V1(parsed), parsed);
  }
  for (const parsed of summaries.values()) {
    if (parsed.childrenSha256s.length === 0)
      continue;
    const parentNode = nodes.get(parsed.nodeSha256);
    const mid = (parentNode.start + parentNode.end) / 2;
    const halves = new Set;
    for (const child of parsed.childrenSha256s) {
      const childSummary = summaries.get(child);
      const childNode = childSummary === undefined ? undefined : nodes.get(childSummary.nodeSha256);
      if (childNode === undefined || childNode.end - childNode.start !== mid - parentNode.start || childNode.start !== parentNode.start && childNode.start !== mid) {
        throw new OhMemoryContextError("integrity", "A summary child does not cover a node half.");
      }
      halves.add(childNode.start === parentNode.start ? "left" : "right");
    }
    if (halves.size !== parsed.childrenSha256s.length) {
      throw new OhMemoryContextError("integrity", "Summary children must cover both node halves.");
    }
  }
  for (const entry of generation.summaries) {
    const summary = summaries.get(entry.summarySha256);
    if (summary === undefined || !nodes.has(entry.nodeSha256) || summary.nodeSha256 !== entry.nodeSha256) {
      throw new OhMemoryContextError("integrity", "A generation entry lacks its summary or node.");
    }
  }
  return Object.freeze({
    generation,
    nodes: Object.freeze([...nodes.values()]),
    summaries: Object.freeze([...summaries.values()])
  });
}
function parseOhMemoryContextAccessV1(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    "historySha256",
    "indices",
    "lanes",
    "revision",
    "state",
    "v"
  ]) || value.v !== 1 || value.state !== "active" && value.state !== "revoked") {
    throw new TypeError("Invalid memory-context access record.");
  }
  const historySha256 = parseSha256Hex(value.historySha256);
  const revision = positiveInt(value.revision, Number.MAX_SAFE_INTEGER);
  const indices = value.indices === null ? null : Array.isArray(value.indices) && value.indices.length <= OH_MEMORY_CONTEXT_LIMITS_V1.leaves && value.indices.every((index) => positiveInt(index, OH_MEMORY_CONTEXT_LIMITS_V1.leaves - 1) !== null) && orderedUnique(value.indices, (index) => String(index).padStart(16, "0")) ? Object.freeze([...value.indices]) : null;
  const lanes = value.lanes === null ? null : Array.isArray(value.lanes) && value.lanes.length >= 1 && value.lanes.length <= OH_MEMORY_CONTEXT_LIMITS_V1.bindings && value.lanes.every((lane) => laneOf(lane) !== null) && orderedUnique(value.lanes, (lane) => lane) ? Object.freeze([...value.lanes]) : null;
  if (historySha256 === null || revision === null || value.indices !== null && indices === null || value.lanes !== null && lanes === null) {
    throw new TypeError("Invalid memory-context access record.");
  }
  return Object.freeze({ historySha256, indices, lanes, revision, state: value.state, v: 1 });
}
function ohMemoryContextRefSha256V1(ref) {
  return canonicalSha256(ref);
}
async function resolveLaneHead(store, ref) {
  const parsed = parseOhHeadRefV1(ref);
  if (parsed === null)
    throw new TypeError("Invalid memory-context capture bound.");
  const page = await store.changesSince({ operationSha256: null, sequence: 0 }, { limit: 1, through: parsed });
  return page.through;
}
async function captureOhMemoryContextV1(lanes) {
  if (!isPlainRecord(lanes))
    throw new TypeError("Invalid memory-context capture input.");
  const keys = Reflect.ownKeys(lanes);
  if (keys.length < 1 || keys.length > OH_MEMORY_CONTEXT_LIMITS_V1.bindings || keys.some((key) => laneOf(key) === null)) {
    throw new TypeError("Capture requires one or two known lanes.");
  }
  const bindings = [];
  const leaves = [];
  for (const lane of OH_MEMORY_CONTEXT_LANES_V1) {
    const bound = lanes[lane];
    if (bound === undefined)
      continue;
    if (!isPlainRecord(bound))
      throw new TypeError(`Invalid ${lane} capture bound.`);
    const boundKeys = Reflect.ownKeys(bound);
    if (!boundKeys.includes("store") || boundKeys.some((key) => !["from", "store", "through"].includes(key))) {
      throw new TypeError(`Invalid ${lane} capture bound.`);
    }
    const store = bound.store;
    if (store === null || typeof store !== "object" || typeof store.changesSince !== "function" || typeof store.snapshot !== "function" || typeof store.head !== "function" || store.binding?.profile?.profileKind !== lane) {
      throw new TypeError(`The ${lane} capture requires an ${lane}-profile OhStoreV1 handle.`);
    }
    const head = bound.through === undefined ? parseOhHeadV1(await store.head()) : await resolveLaneHead(store, bound.through);
    if (head === null)
      throw new OhMemoryContextError("stale", `The ${lane} store returned an invalid head.`);
    const fromRef = bound.from === undefined ? { operationSha256: null, sequence: 0 } : parseOhHeadRefV1(bound.from);
    if (fromRef === null)
      throw new TypeError(`Invalid ${lane} from bound.`);
    const operations = [];
    let cursor = fromRef;
    for (;; ) {
      const page = await store.changesSince(cursor, {
        limit: OH_MEMORY_CONTEXT_LIMITS_V1.changeFeedPage,
        through: { operationSha256: head.operationSha256, sequence: head.sequence }
      });
      operations.push(...page.operations);
      if (!page.hasMore)
        break;
      cursor = page.to;
      if (operations.length > OH_MEMORY_CONTEXT_LIMITS_V1.leaves) {
        throw new RangeError(`The ${lane} capture exceeds its operation bound.`);
      }
    }
    const snapshot = await store.snapshot({ head: {
      operationSha256: head.operationSha256,
      sequence: head.sequence
    } });
    const liveDigests = new Map(snapshot.records.map((record) => [record.key, record.recordSha256]));
    for (const operation of operations) {
      for (const [changeIndex, change] of operation.changes.entries()) {
        if (leaves.length >= OH_MEMORY_CONTEXT_LIMITS_V1.leaves) {
          throw new RangeError(`The ${lane} capture exceeds its leaf bound.`);
        }
        if (change.kind === "put") {
          leaves.push(Object.freeze({
            changeIndex,
            instant: operation.instant,
            key: change.record.key,
            kind: "put",
            lane,
            live: liveDigests.get(change.record.key) === change.record.recordSha256,
            operationSha256: operation.operationSha256,
            parentOperationSha256: operation.parentOperationSha256,
            recordSha256: change.record.recordSha256,
            sequence: operation.sequence,
            v: 1
          }));
        } else {
          leaves.push(Object.freeze({
            changeIndex,
            instant: operation.instant,
            key: change.key,
            kind: "tombstone",
            lane,
            live: false,
            operationSha256: operation.operationSha256,
            parentOperationSha256: operation.parentOperationSha256,
            recordSha256: change.priorSha256,
            sequence: operation.sequence,
            v: 1
          }));
        }
      }
    }
    bindings.push(Object.freeze({ bindingSha256: store.binding.bindingSha256, head, lane }));
  }
  leaves.sort((left, right) => {
    const order = leafOrder(left);
    const other = leafOrder(right);
    return order < other ? -1 : order > other ? 1 : 0;
  });
  return parseOhMemoryContextHistoryV1({ bindings, leaves, v: 1 });
}
function ohMemoryContextCoverV1(leafCount, recentLeaves, detailedIndices = []) {
  const size = positiveInt(leafCount, OH_MEMORY_CONTEXT_LIMITS_V1.leaves);
  const recent = positiveInt(recentLeaves, OH_MEMORY_CONTEXT_LIMITS_V1.leaves);
  if (size === null || recent === null)
    throw new RangeError("Invalid cover bounds.");
  if (detailedIndices.length > OH_MEMORY_CONTEXT_LIMITS_V1.detailedIndices || detailedIndices.some((index) => positiveInt(index, size - 1) === null)) {
    throw new RangeError("Invalid detailed leaf selection.");
  }
  const detailed = new Set(detailedIndices);
  const result = [];
  const visit = (start2, end) => {
    const length = end - start2;
    let forced = false;
    for (let index = start2;index < end; index += 1) {
      if (detailed.has(index)) {
        forced = true;
        break;
      }
    }
    if (length === 1 || !forced && end <= size - recent && length <= size - end) {
      result.push({ start: start2, end });
      return;
    }
    const middle = (start2 + end) / 2;
    visit(start2, middle);
    visit(middle, end);
  };
  let start = 0;
  for (let length = OH_MEMORY_CONTEXT_LIMITS_V1.leaves;length >= 1; length /= 2) {
    if (start + length <= size) {
      visit(start, start + length);
      start += length;
    }
  }
  return Object.freeze(result);
}
function emptyGeneration(historySha256) {
  return Object.freeze({
    generation: 0,
    historySha256,
    policySha256: canonicalSha256("oh.memory-context.no-policy"),
    promptSha256: canonicalSha256("oh.memory-context.no-prompt"),
    summarizerSha256: canonicalSha256("oh.memory-context.no-summarizer"),
    summaries: Object.freeze([]),
    v: 1
  });
}
function createOhMemoryContextHostV1(options) {
  if (!isPlainRecord(options) || typeof options.resolveAccess !== "function") {
    throw new TypeError("A memory-context host requires an access resolver.");
  }
  const optionKeys = Reflect.ownKeys(options);
  if (optionKeys.some((key2) => ![
    "canonical",
    "continuationKey",
    "continuationLifetimeMs",
    "monotonicNow",
    "resolveAccess",
    "working"
  ].includes(key2))) {
    throw new TypeError("Unknown memory-context host option.");
  }
  const key = options.continuationKey === undefined ? Uint8Array.from(randomBytes2(OH_MEMORY_CONTEXT_LIMITS_V1.continuationKeyBytes)) : options.continuationKey;
  if (!(key instanceof Uint8Array) || key.byteLength !== OH_MEMORY_CONTEXT_LIMITS_V1.continuationKeyBytes) {
    throw new RangeError("The memory-context continuation key must be exactly 32 raw bytes.");
  }
  const lifetime = options.continuationLifetimeMs ?? OH_MEMORY_CONTEXT_CONTINUATION_LIFETIME_MS_V1;
  if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > 24 * 60 * 60 * 1000) {
    throw new RangeError("Invalid memory-context continuation lifetime.");
  }
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  if (typeof monotonicNow !== "function")
    throw new TypeError("Invalid monotonic clock.");
  const lanes = new Map;
  for (const lane of OH_MEMORY_CONTEXT_LANES_V1) {
    const bound = options[lane];
    if (bound === undefined)
      continue;
    if (!isPlainRecord(bound) || !hasExactKeys(bound, ["expectedBindingSha256", "store"]) || parseSha256Hex(bound.expectedBindingSha256) === null || bound.store === null || typeof bound.store !== "object" || typeof bound.store.changesSince !== "function") {
      throw new TypeError(`Invalid ${lane} memory-context lane.`);
    }
    if (bound.store.binding.bindingSha256 !== bound.expectedBindingSha256) {
      throw new OhMemoryContextError("stale", `The ${lane} store is not the host-bound authority.`);
    }
    if (bound.store.binding.profile.profileKind !== lane) {
      throw new OhMemoryContextError("stale", `The ${lane} lane has the wrong store profile.`);
    }
    lanes.set(lane, { expectedBindingSha256: bound.expectedBindingSha256, store: bound.store });
  }
  if (lanes.size === 0)
    throw new TypeError("A memory-context host needs at least one lane.");
  const histories = new Map;
  const registered = new Map;
  const revokedRefs = new Set;
  function historyEntry(entry) {
    const found = histories.get(entry.ref.historySha256);
    if (found === undefined)
      contextError("integrity", "Unknown memory-context history.");
    return found;
  }
  function accessFor(entry) {
    if (entry.revoked || revokedRefs.has(entry.refSha256)) {
      contextError("authorization", "The memory-context grant was revoked.");
    }
    const access = parseOhMemoryContextAccessV1(options.resolveAccess(entry.ref));
    if (access.historySha256 !== entry.ref.historySha256) {
      contextError("integrity", "The access record belongs to another history.");
    }
    if (access.state !== "active") {
      contextError("authorization", "The memory-context grant is not active.");
    }
    return {
      record: access,
      indices: access.indices === null ? null : new Set(access.indices),
      lanes: access.lanes === null ? null : new Set(access.lanes)
    };
  }
  function laneStore(entry, lane) {
    const binding = historyEntry(entry).bindings.get(lane);
    const bound = lanes.get(lane);
    if (binding === undefined || bound === undefined) {
      contextError("authorization", `The ${lane} lane is not part of this history.`);
    }
    if (bound.store.binding.bindingSha256 !== binding.bindingSha256) {
      contextError("stale", `The ${lane} store binding changed since capture.`);
    }
    return bound.store;
  }
  function permitted(access, index, leaf) {
    return (access.indices === null || access.indices.has(index)) && (access.lanes === null || access.lanes.has(leaf.lane));
  }
  function capturedThrough(entry, lane) {
    const head = entry.bindings.get(lane).head;
    return { operationSha256: head.operationSha256, sequence: head.sequence };
  }
  async function probeLanes(entry) {
    for (const binding of historyEntry(entry).bindings.values()) {
      const store = laneStore(entry, binding.lane);
      try {
        await store.changesSince({ operationSha256: binding.head.operationSha256, sequence: binding.head.sequence }, { limit: 1 });
      } catch (error) {
        if (error instanceof OhMemoryContextError)
          throw error;
        contextError("availability", `The ${binding.lane} lane's captured head is no longer available.`);
      }
    }
  }
  async function fetchLeafRecord(entry, access, index) {
    const { history } = historyEntry(entry);
    const leaf = history.leaves[index];
    if (leaf === undefined || !permitted(access, index, leaf)) {
      contextError("authorization", "The leaf is outside the current grant.");
    }
    const store = laneStore(entry, leaf.lane);
    let page;
    try {
      page = await store.changesSince({ operationSha256: leaf.parentOperationSha256, sequence: leaf.sequence - 1 }, { limit: 1, through: capturedThrough(historyEntry(entry), leaf.lane) });
    } catch (error) {
      if (error instanceof OhMemoryContextError)
        throw error;
      contextError("availability", "The leaf's source operation is no longer available.");
    }
    const operation = page.operations[0];
    if (page.operations.length !== 1 || operation === undefined || operation.operationSha256 !== leaf.operationSha256) {
      contextError("stale", "The leaf's source operation does not match the capture.");
    }
    const change = operation.changes[leaf.changeIndex];
    if (change === undefined)
      contextError("integrity", "The leaf's change is missing.");
    if (change.kind !== leaf.kind) {
      contextError("integrity", "The leaf's change kind changed since capture.");
    }
    if (change.kind === "tombstone") {
      if (change.key !== leaf.key || change.priorSha256 !== leaf.recordSha256) {
        contextError("integrity", "The leaf's tombstone changed since capture.");
      }
      return null;
    }
    const record = parseKnowledgeGraphRecordV1(change.record);
    if (record === null || record.recordSha256 !== leaf.recordSha256 || record.key !== leaf.key) {
      contextError("integrity", "The leaf's record changed since capture.");
    }
    return record;
  }
  function lanesInRange(entry, start, end) {
    const lanesSeen = new Set;
    for (let index = start;index < end; index += 1) {
      lanesSeen.add(entry.history.leaves[index].lane);
    }
    return [...lanesSeen].sort();
  }
  function allPermitted(entry, access, start, end) {
    const { history } = historyEntry(entry);
    for (let index = start;index < end; index += 1) {
      if (!permitted(access, index, history.leaves[index]))
        return false;
    }
    return true;
  }
  async function itemFor(entry, access, node, fetched, fetchBudget) {
    const { history } = historyEntry(entry);
    const nodeSha256 = ohMemoryContextNodeSha256V1(node);
    const base = {
      end: node.end,
      lanes: lanesInRange(historyEntry(entry), node.start, node.end),
      nodeSha256,
      start: node.start
    };
    if (node.end - node.start === 1) {
      const index = node.start;
      const leaf = history.leaves[index];
      if (!permitted(access, index, leaf)) {
        return Object.freeze({ ...base, kind: "pending", reason: "unpermitted" });
      }
      if (fetchBudget.remaining <= 0) {
        contextError("budget", "The page exceeds its original-read allowance.");
      }
      fetchBudget.remaining -= 1;
      let record = fetched.get(index);
      if (record === undefined) {
        record = await fetchLeafRecord(entry, access, index);
        fetched.set(index, record);
      }
      return Object.freeze({ kind: "leaf", leaf, leafIndex: index, record });
    }
    const summary = entry.summariesByNode.get(nodeSha256);
    if (summary === undefined) {
      return Object.freeze({ ...base, kind: "pending", reason: "missing-summary" });
    }
    if (!allPermitted(entry, access, node.start, node.end)) {
      return Object.freeze({ ...base, kind: "pending", reason: "unpermitted" });
    }
    return Object.freeze({
      ...base,
      kind: "summary",
      childrenSha256s: summary.childrenSha256s,
      summarySha256: ohMemoryContextSummarySha256V1(summary),
      text: summary.body
    });
  }
  function encodeContinuation(payload, key2) {
    const cursorSha256 = canonicalSha256(payload);
    const signed = { ...payload, cursorSha256 };
    const envelope = { ...signed, cursorHmacSha256: createHmac("sha256", key2).update("oh.memory-context.continuation.v1\x00", "utf8").update(canonicalJson(signed), "utf8").digest().toString("hex") };
    const continuation = Buffer.from(canonicalJson(envelope), "utf8").toString("base64url");
    if (utf8ByteLength(continuation) > OH_MEMORY_CONTEXT_LIMITS_V1.continuationBytes) {
      throw new RangeError("The issued memory-context continuation exceeds its byte bound.");
    }
    return continuation;
  }
  function parseContinuation(value, entry, surface, key2) {
    if (value === undefined || value === null)
      return null;
    if (typeof value !== "string" || value.length < 1 || utf8ByteLength(value) > OH_MEMORY_CONTEXT_LIMITS_V1.continuationBytes || !/^[A-Za-z0-9_-]+$/u.test(value)) {
      throw new OhMemoryContextContinuationError("encoding", "Invalid memory-context continuation.");
    }
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value || bytes.byteLength > OH_MEMORY_CONTEXT_LIMITS_V1.continuationBytes) {
      throw new OhMemoryContextContinuationError("encoding", "Invalid memory-context continuation.");
    }
    const text = bytes.toString("utf8");
    let decoded;
    try {
      decoded = JSON.parse(text);
    } catch {
      throw new OhMemoryContextContinuationError("encoding", "Invalid memory-context continuation JSON.");
    }
    if (!isPlainRecord(decoded) || !hasExactKeys(decoded, [
      "cursorHmacSha256",
      "cursorSha256",
      "expiresAtMonotonicMs",
      "generationSha256",
      "historySha256",
      "nextOffset",
      "nodeSha256",
      "refSha256",
      "selectionSha256",
      "surface",
      "v"
    ]) || decoded.v !== 1 || canonicalJson(decoded) !== text) {
      throw new OhMemoryContextContinuationError("encoding", "Invalid memory-context continuation payload.");
    }
    const cursorHmacSha256 = parseSha256Hex(decoded.cursorHmacSha256);
    const cursorSha256 = parseSha256Hex(decoded.cursorSha256);
    const generationSha256 = parseSha256Hex(decoded.generationSha256);
    const historySha256 = parseSha256Hex(decoded.historySha256);
    const refSha256 = parseSha256Hex(decoded.refSha256);
    const selectionSha256 = parseSha256Hex(decoded.selectionSha256);
    const nodeSha256 = decoded.nodeSha256 === null ? null : parseSha256Hex(decoded.nodeSha256);
    const expiresAtMonotonicMs = typeof decoded.expiresAtMonotonicMs === "number" && Number.isFinite(decoded.expiresAtMonotonicMs) ? decoded.expiresAtMonotonicMs : null;
    const nextOffset = positiveInt(decoded.nextOffset, OH_MEMORY_CONTEXT_LIMITS_V1.leaves, 1);
    if (cursorHmacSha256 === null || cursorSha256 === null || generationSha256 === null || historySha256 === null || refSha256 === null || selectionSha256 === null || expiresAtMonotonicMs === null || nextOffset === null || decoded.nodeSha256 === null !== (nodeSha256 === null) || decoded.surface !== "expand" && decoded.surface !== "overview") {
      throw new OhMemoryContextContinuationError("identity", "Invalid memory-context continuation identity.");
    }
    const payload = {
      expiresAtMonotonicMs,
      generationSha256,
      historySha256,
      nextOffset,
      nodeSha256,
      refSha256,
      selectionSha256,
      surface: decoded.surface,
      v: 1
    };
    const signed = { ...payload, cursorSha256 };
    if (canonicalSha256(payload) !== cursorSha256) {
      throw new OhMemoryContextContinuationError("identity", "The memory-context continuation digest is invalid.");
    }
    const expectedHmac = createHmac("sha256", key2).update("oh.memory-context.continuation.v1\x00", "utf8").update(canonicalJson(signed), "utf8").digest();
    if (!timingSafeEqual(expectedHmac, Buffer.from(cursorHmacSha256, "hex"))) {
      throw new OhMemoryContextContinuationError("authentication", "The memory-context continuation is not an issued capability.");
    }
    if (payload.surface !== surface) {
      throw new OhMemoryContextContinuationError("identity", "The memory-context continuation belongs to another surface.");
    }
    if (monotonicNow() >= expiresAtMonotonicMs) {
      throw new OhMemoryContextContinuationError("expired", "The memory-context continuation has expired.");
    }
    if (refSha256 !== entry.refSha256 || historySha256 !== entry.ref.historySha256 || generationSha256 !== ohMemoryContextGenerationSha256V1(entry.generation)) {
      throw new OhMemoryContextContinuationError("identity", "The memory-context continuation belongs to another view.");
    }
    return Object.freeze({ ...payload, cursorSha256 });
  }
  function nodeFor(entry, start, end) {
    const { history } = historyEntry(entry);
    const candidate = createOhMemoryContextNodeV1(history, start, end);
    const digest = ohMemoryContextNodeSha256V1(candidate);
    if (!entry.nodes.has(digest))
      entry.nodes.set(digest, candidate);
    return candidate;
  }
  function parseRef(value) {
    if (!isPlainRecord(value) || !hasExactKeys(value, ["historySha256", "v"]) || value.v !== 1 || parseSha256Hex(value.historySha256) === null) {
      throw new TypeError("Invalid memory-context reference.");
    }
    return Object.freeze({ historySha256: value.historySha256, v: 1 });
  }
  function readerFor(entry) {
    return Object.freeze({
      async expand(nodeSha256, expandOptions = {}) {
        if (!isPlainRecord(expandOptions) || Reflect.ownKeys(expandOptions).some((key2) => key2 !== "continuation")) {
          throw new TypeError("Unknown expand option.");
        }
        const access = accessFor(entry);
        const digest = parseSha256Hex(nodeSha256);
        if (digest === null)
          throw new TypeError("Invalid memory-context node digest.");
        const node = entry.nodes.get(digest);
        if (node === undefined) {
          contextError("integrity", "The node is not part of this captured history.");
        }
        await probeLanes(entry);
        const continuation = parseContinuation(expandOptions?.continuation, entry, "expand", key);
        if (continuation !== null && continuation.nodeSha256 !== digest) {
          throw new OhMemoryContextContinuationError("identity", "The continuation expands another node.");
        }
        const children = node.end - node.start === 1 ? [node] : [
          nodeFor(entry, node.start, (node.start + node.end) / 2),
          nodeFor(entry, (node.start + node.end) / 2, node.end)
        ];
        const fetched = new Map;
        const fetchBudget = { remaining: OH_MEMORY_CONTEXT_LIMITS_V1.leafFetchesPerRead };
        const items = [];
        for (const child of children) {
          items.push(await itemFor(entry, access, child, fetched, fetchBudget));
        }
        return Object.freeze({
          items: Object.freeze(items),
          nodeSha256: digest,
          status: items.some((item) => item.kind === "pending") ? "incomplete" : "complete",
          v: 1
        });
      },
      async inspect() {
        accessFor(entry);
        await probeLanes(entry);
        const { history } = historyEntry(entry);
        const heads = {};
        for (const binding of history.bindings)
          heads[binding.lane] = binding.head;
        return Object.freeze({
          generationSha256: ohMemoryContextGenerationSha256V1(entry.generation),
          heads,
          historySha256: entry.ref.historySha256,
          leaves: history.leaves.length,
          v: 1
        });
      },
      async overview(overviewOptions = {}) {
        if (!isPlainRecord(overviewOptions) || Reflect.ownKeys(overviewOptions).some((key2) => ![
          "continuation",
          "detailedIndices",
          "limits",
          "recentLeaves"
        ].includes(key2))) {
          throw new TypeError("Unknown overview option.");
        }
        const access = accessFor(entry);
        await probeLanes(entry);
        const { history } = historyEntry(entry);
        const recentLeaves = overviewOptions.recentLeaves ?? entry.recentLeaves;
        if (positiveInt(recentLeaves, OH_MEMORY_CONTEXT_LIMITS_V1.leaves) === null) {
          throw new RangeError("Invalid recent-leaf count.");
        }
        const requested = overviewOptions.detailedIndices === undefined ? [] : overviewOptions.detailedIndices;
        if (requested.length > OH_MEMORY_CONTEXT_LIMITS_V1.detailedIndices) {
          throw new RangeError("The detailed selection exceeds its bound.");
        }
        const detailed = new Set(entry.detailedIndices);
        for (const index of requested) {
          if (positiveInt(index, history.leaves.length - 1) === null) {
            throw new RangeError("A detailed leaf index is outside the capture.");
          }
          detailed.add(index);
        }
        if (detailed.size > OH_MEMORY_CONTEXT_LIMITS_V1.detailedIndices) {
          throw new RangeError("The combined detailed selection exceeds its bound.");
        }
        const requestedLimits = overviewOptions.limits;
        if (requestedLimits !== undefined && !isPlainRecord(requestedLimits)) {
          throw new TypeError("Invalid read limits.");
        }
        const maxItems = requestedLimits?.maxItems === undefined ? OH_MEMORY_CONTEXT_LIMITS_V1.pageItems : positiveInt(requestedLimits.maxItems, OH_MEMORY_CONTEXT_LIMITS_V1.pageItems, 1);
        const maxBytes = requestedLimits?.maxBytes === undefined ? OH_MEMORY_CONTEXT_LIMITS_V1.pageBytes : positiveInt(requestedLimits.maxBytes, OH_MEMORY_CONTEXT_LIMITS_V1.pageBytes, 1);
        if (maxItems === null || maxBytes === null) {
          throw new RangeError("Read limits exceed the memory-context bounds.");
        }
        const selectionSha256 = canonicalSha256({
          detailed: [...detailed].sort((a, b) => a - b),
          maxBytes,
          maxItems,
          recentLeaves
        });
        const continuation = parseContinuation(overviewOptions.continuation, entry, "overview", key);
        if (continuation !== null && continuation.selectionSha256 !== selectionSha256) {
          throw new OhMemoryContextContinuationError("identity", "The continuation selects a different overview.");
        }
        const cover = ohMemoryContextCoverV1(history.leaves.length, recentLeaves, [...detailed]);
        const startIndex = continuation?.nextOffset ?? 0;
        const startRange = cover.findIndex((range) => range.start >= startIndex);
        if (startIndex !== 0 && startIndex !== history.leaves.length && (startRange < 0 || cover[startRange].start !== startIndex)) {
          throw new OhMemoryContextContinuationError("identity", "The continuation offset does not align to a range.");
        }
        const fetched = new Map;
        const fetchBudget = { remaining: OH_MEMORY_CONTEXT_LIMITS_V1.leafFetchesPerRead };
        const items = [];
        let bytes = 0;
        let end = startIndex;
        for (let index = startRange < 0 ? cover.length : startRange;index < cover.length; index += 1) {
          if (items.length >= maxItems)
            break;
          const range = cover[index];
          const item = await itemFor(entry, access, nodeFor(entry, range.start, range.end), fetched, fetchBudget);
          bytes += utf8ByteLength(canonicalJson(item));
          if (bytes > maxBytes && items.length > 0)
            break;
          items.push(item);
          end = range.end;
        }
        const complete = end >= history.leaves.length;
        const generationSha256 = ohMemoryContextGenerationSha256V1(entry.generation);
        const continuationOut = complete ? null : encodeContinuation({
          expiresAtMonotonicMs: monotonicNow() + lifetime,
          generationSha256,
          historySha256: entry.ref.historySha256,
          nextOffset: end,
          nodeSha256: null,
          refSha256: entry.refSha256,
          selectionSha256,
          surface: "overview",
          v: 1
        }, key);
        return Object.freeze({
          binding: Object.freeze({
            generationSha256,
            historySha256: entry.ref.historySha256,
            selectionSha256
          }),
          continuation: continuationOut,
          end,
          items: Object.freeze(items),
          start: startIndex,
          status: complete ? "complete" : "partial",
          v: 1
        });
      },
      async read(leafIndex) {
        const access = accessFor(entry);
        const { history } = historyEntry(entry);
        const index = positiveInt(leafIndex, OH_MEMORY_CONTEXT_LIMITS_V1.leaves - 1);
        if (index === null || index >= history.leaves.length) {
          throw new RangeError("The leaf index is outside the capture.");
        }
        const record = await fetchLeafRecord(entry, access, index);
        return Object.freeze({ leaf: history.leaves[index], leafIndex: index, record, v: 1 });
      },
      async search(searchOptions) {
        const access = accessFor(entry);
        const { history } = historyEntry(entry);
        if (!isPlainRecord(searchOptions) || Reflect.ownKeys(searchOptions).some((key2) => !["flags", "pattern"].includes(key2)) || !Object.hasOwn(searchOptions, "pattern")) {
          throw new TypeError("A memory-context search requires a pattern and optional flags only.");
        }
        const raw = searchOptions;
        if (typeof raw.pattern !== "string" || raw.pattern.length === 0 || utf8ByteLength(raw.pattern) > OH_MEMORY_CONTEXT_LIMITS_V1.searchPatternBytes) {
          throw new RangeError("The search pattern exceeds its byte bound.");
        }
        if (raw.flags !== undefined && (typeof raw.flags !== "string" || !/^[imsuvy]*$/u.test(raw.flags))) {
          throw new TypeError("Invalid search flags.");
        }
        const flags = raw.flags === undefined ? "" : raw.flags;
        let pattern;
        try {
          pattern = new RegExp(raw.pattern, flags.includes("g") ? flags : `g${flags}`);
        } catch {
          throw new TypeError("Invalid search pattern.");
        }
        const matches = [];
        let scannedBytes = 0;
        let denied = 0;
        let complete = true;
        for (const [index, leaf] of history.leaves.entries()) {
          if (!permitted(access, index, leaf)) {
            denied += 1;
            continue;
          }
          if (leaf.kind !== "put")
            continue;
          const store = laneStore(entry, leaf.lane);
          let operation;
          try {
            const page = await store.changesSince({ operationSha256: leaf.parentOperationSha256, sequence: leaf.sequence - 1 }, { limit: 1, through: capturedThrough(historyEntry(entry), leaf.lane) });
            operation = page.operations[0];
          } catch {
            contextError("availability", "A leaf's source operation is no longer available.");
          }
          if (operation === undefined || operation.operationSha256 !== leaf.operationSha256) {
            contextError("stale", "A leaf's source operation does not match the capture.");
          }
          const change = operation.changes[leaf.changeIndex];
          if (change === undefined || change.kind !== "put") {
            contextError("integrity", "A leaf's source change is missing.");
          }
          const record = parseKnowledgeGraphRecordV1(change.record);
          if (record === null || record.recordSha256 !== leaf.recordSha256) {
            contextError("integrity", "A leaf's record changed since capture.");
          }
          const text = canonicalJson(record);
          scannedBytes += utf8ByteLength(text);
          if (scannedBytes > OH_MEMORY_CONTEXT_LIMITS_V1.scannedBytes) {
            complete = false;
            break;
          }
          for (const match of text.matchAll(pattern)) {
            matches.push(Object.freeze({
              end: match.index + match[0].length,
              key: leaf.key,
              lane: leaf.lane,
              leafIndex: index,
              recordSha256: leaf.recordSha256,
              start: match.index
            }));
            if (matches.length >= OH_MEMORY_CONTEXT_LIMITS_V1.searchMatches) {
              complete = false;
              break;
            }
          }
          if (!complete)
            break;
        }
        return Object.freeze({
          complete,
          denied,
          matches: Object.freeze(matches),
          scannedBytes,
          v: 1
        });
      }
    });
  }
  return Object.freeze({
    async admit(historyValue, admitOptions = {}) {
      if (!isPlainRecord(admitOptions) || Reflect.ownKeys(admitOptions).some((key2) => ![
        "derivatives",
        "detailedIndices",
        "recentLeaves"
      ].includes(key2))) {
        throw new TypeError("Unknown admit option.");
      }
      const history = parseOhMemoryContextHistoryV1(historyValue);
      for (const binding of history.bindings) {
        const bound = lanes.get(binding.lane);
        if (bound === undefined) {
          contextError("authorization", `The ${binding.lane} lane is not admitted on this host.`);
        }
        if (bound.store.binding.bindingSha256 !== binding.bindingSha256) {
          contextError("stale", `The ${binding.lane} store binding changed since capture.`);
        }
        try {
          await bound.store.changesSince({ operationSha256: binding.head.operationSha256, sequence: binding.head.sequence }, { limit: 1 });
        } catch (error) {
          if (error instanceof OhMemoryContextError)
            throw error;
          contextError("stale", `The captured ${binding.lane} head is not in this store's history.`);
        }
      }
      const recentLeaves = admitOptions.recentLeaves ?? 8;
      if (positiveInt(recentLeaves, OH_MEMORY_CONTEXT_LIMITS_V1.leaves) === null) {
        throw new RangeError("Invalid recent-leaf count.");
      }
      const detailed = admitOptions.detailedIndices === undefined ? [] : admitOptions.detailedIndices;
      if (detailed.length > OH_MEMORY_CONTEXT_LIMITS_V1.detailedIndices || detailed.some((index) => positiveInt(index, history.leaves.length - 1) === null) || new Set(detailed).size !== detailed.length || !orderedUnique([...detailed], (index) => String(index).padStart(16, "0"))) {
        throw new RangeError("Invalid detailed leaf selection.");
      }
      const ref = Object.freeze({
        historySha256: ohMemoryContextHistorySha256V1(history),
        v: 1
      });
      const refSha256 = ohMemoryContextRefSha256V1(ref);
      const resolverAccess = parseOhMemoryContextAccessV1(options.resolveAccess(ref));
      if (resolverAccess.historySha256 !== ref.historySha256) {
        contextError("integrity", "The access resolver returned another history's grant.");
      }
      if (resolverAccess.state !== "active") {
        contextError("authorization", "The memory-context grant is not active.");
      }
      const existing = registered.get(refSha256);
      if (existing !== undefined && !existing.revoked)
        return existing.ref;
      if (revokedRefs.has(refSha256)) {
        contextError("authorization", "The memory-context grant was revoked.");
      }
      const nodes = new Map;
      for (let length = 1;length <= OH_MEMORY_CONTEXT_LIMITS_V1.leaves; length *= 2) {
        for (let start = 0;start + length <= history.leaves.length; start += length) {
          const node = createOhMemoryContextNodeV1(history, start, start + length);
          nodes.set(ohMemoryContextNodeSha256V1(node), node);
        }
      }
      histories.set(ref.historySha256, {
        bindings: new Map(history.bindings.map((binding) => [binding.lane, binding])),
        history
      });
      const summaries = new Map;
      const summariesByNode = new Map;
      let generation = emptyGeneration(ref.historySha256);
      if (admitOptions.derivatives !== undefined) {
        const pool = parseOhMemoryContextPoolV1(history, admitOptions.derivatives);
        if (pool.generation.generation !== 0) {
          contextError("integrity", "Admission requires derivative generation 0.");
        }
        generation = pool.generation;
        for (const node of pool.nodes)
          nodes.set(ohMemoryContextNodeSha256V1(node), node);
        for (const summary of pool.summaries) {
          summaries.set(ohMemoryContextSummarySha256V1(summary), summary);
        }
        for (const entryItem of generation.summaries) {
          summariesByNode.set(entryItem.nodeSha256, summaries.get(entryItem.summarySha256));
        }
      }
      registered.set(refSha256, {
        detailedIndices: Object.freeze([...detailed]),
        generation,
        nodes,
        recentLeaves,
        ref,
        refSha256,
        revoked: false,
        summaries,
        summariesByNode
      });
      return ref;
    },
    bind(refValue) {
      const ref = parseRef(refValue);
      const entry = registered.get(ohMemoryContextRefSha256V1(ref));
      if (entry === undefined) {
        contextError("authorization", "The memory-context reference was never admitted.");
      }
      return readerFor(entry);
    },
    async publishDerivatives(refValue, poolValue, expected) {
      const ref = parseRef(refValue);
      const entry = registered.get(ohMemoryContextRefSha256V1(ref));
      if (entry === undefined) {
        contextError("authorization", "The memory-context reference was never admitted.");
      }
      accessFor(entry);
      const { history } = historyEntry(entry);
      const pool = parseOhMemoryContextPoolV1(history, poolValue);
      const expectedSha256 = parseSha256Hex(expected);
      if (expectedSha256 === null)
        throw new TypeError("Invalid expected generation digest.");
      const currentSha256 = ohMemoryContextGenerationSha256V1(entry.generation);
      const candidateSha256 = ohMemoryContextGenerationSha256V1(pool.generation);
      if (candidateSha256 === currentSha256)
        return currentSha256;
      if (expectedSha256 !== currentSha256) {
        contextError("stale", "The expected derivative generation does not match the current one.");
      }
      if (pool.generation.generation !== entry.generation.generation + 1) {
        contextError("stale", "A derivative generation must advance the counter by exactly one.");
      }
      for (const node of pool.nodes)
        entry.nodes.set(ohMemoryContextNodeSha256V1(node), node);
      for (const summary of pool.summaries) {
        entry.summaries.set(ohMemoryContextSummarySha256V1(summary), summary);
      }
      entry.summariesByNode = new Map(pool.generation.summaries.map((entryItem) => [entryItem.nodeSha256, entry.summaries.get(entryItem.summarySha256)]));
      entry.generation = pool.generation;
      return candidateSha256;
    },
    revoke(refValue) {
      const ref = parseRef(refValue);
      const refSha256 = ohMemoryContextRefSha256V1(ref);
      revokedRefs.add(refSha256);
      const entry = registered.get(refSha256);
      if (entry !== undefined)
        entry.revoked = true;
    }
  });
}
export {
  parseOhMemoryContextSummaryV1,
  parseOhMemoryContextPoolV1,
  parseOhMemoryContextNodeV1,
  parseOhMemoryContextHistoryV1,
  parseOhMemoryContextGenerationV1,
  parseOhMemoryContextAccessV1,
  ohMemoryContextSummarySha256V1,
  ohMemoryContextRefSha256V1,
  ohMemoryContextNodeSha256V1,
  ohMemoryContextLeafSha256V1,
  ohMemoryContextHistorySha256V1,
  ohMemoryContextGenerationSha256V1,
  ohMemoryContextCoverV1,
  createOhMemoryContextNodeV1,
  createOhMemoryContextHostV1,
  captureOhMemoryContextV1,
  OhMemoryContextError,
  OhMemoryContextContinuationError,
  OH_MEMORY_CONTEXT_LIMITS_V1,
  OH_MEMORY_CONTEXT_LANES_V1,
  OH_MEMORY_CONTEXT_FORMAT_VERSION_V1,
  OH_MEMORY_CONTEXT_CONTINUATION_LIFETIME_MS_V1
};
