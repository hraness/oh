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
  const baseCounts = new Map;
  for (const fact of input.dataset.facts) {
    if (heads.has(fact.relation))
      baseCounts.set(fact.relation, (baseCounts.get(fact.relation) ?? 0) + 1);
  }
  let possible = 0n;
  const maximum = BigInt(input.maximumDerivedTuples);
  for (const [relation, arity] of heads) {
    const relationSpace = domainSize ** BigInt(arity);
    const existing = BigInt(baseCounts.get(relation) ?? 0);
    possible += relationSpace > existing ? relationSpace - existing : 0n;
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
