#!/usr/bin/env bun
// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/canonical.ts
import { createHash, randomBytes } from "crypto";
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
var OhValidationError;
var init_canonical = __esm(() => {
  OhValidationError = class OhValidationError extends Error {
    code;
    path;
    constructor(code, path, message) {
      super(`${path}: ${message}`);
      this.name = "OhValidationError";
      this.code = code;
      this.path = path;
    }
  };
});

// src/graph.ts
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
var OH_GRAPH_FORMAT_VERSION_V1 = 1, OH_GRAPH_LIMITS_V1, OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1, KNOWLEDGE_GRAPH_RECORD_KEYS_V1;
var init_graph = __esm(() => {
  init_canonical();
  OH_GRAPH_LIMITS_V1 = Object.freeze({
    changesPerOperation: 8192,
    dependenciesPerRecord: 4096,
    recordBytes: 1024 * 1024,
    recordsPerSnapshot: 65536
  });
  OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 = Object.freeze([
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
  KNOWLEDGE_GRAPH_RECORD_KEYS_V1 = [
    "dependencies",
    "key",
    "kind",
    "recordSha256",
    "v",
    "value"
  ];
});

// src/ontology.ts
var OH_ONTOLOGY_VERSION_V1 = "1.0.0", OH_CONTRACT_ID_V1 = "oh.ontology.v1", OH_KNOWLEDGE_LIMITS_V1;
var init_ontology = __esm(() => {
  OH_KNOWLEDGE_LIMITS_V1 = Object.freeze({
    dimensions: 64,
    listValues: 256,
    qualifiers: 128,
    statementBytes: 256 * 1024,
    textBytes: 64 * 1024
  });
});

// src/schema.ts
var OH_SCHEMA_FORMAT_VERSION_V1 = 1;
var init_schema = () => {};

// src/contract.ts
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
var manifestPayload, OH_CONTRACT_MANIFEST_V1;
var init_contract = __esm(() => {
  init_canonical();
  init_graph();
  init_ontology();
  init_schema();
  manifestPayload = Object.freeze({
    contractId: OH_CONTRACT_ID_V1,
    graphFormatVersion: OH_GRAPH_FORMAT_VERSION_V1,
    ontologyVersion: OH_ONTOLOGY_VERSION_V1,
    recordKinds: OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
    schemaFormatVersion: OH_SCHEMA_FORMAT_VERSION_V1,
    v: 1
  });
  OH_CONTRACT_MANIFEST_V1 = Object.freeze({
    ...manifestPayload,
    contractSha256: canonicalSha256(manifestPayload)
  });
});

// src/search.ts
async function searchOhV1(input) {
  const limit = input.limit ?? 10;
  const mode = input.mode ?? "keyword";
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("Search limit must be 1 through 100.");
  const keyword = mode === "semantic" ? [] : input.store.searchKeyword(input.query, Math.min(100, limit * 3));
  let semantic = [];
  const diagnostics = [];
  if (mode !== "keyword") {
    if (input.backend === undefined) {
      diagnostics.push({ code: "semantic-unavailable", message: "No local semantic backend is configured.", v: 1 });
    } else {
      try {
        semantic = await input.backend.search(input.query, Math.min(100, limit * 3), input.store);
      } catch (error) {
        diagnostics.push({
          code: "semantic-unavailable",
          message: error instanceof Error ? error.message : "Local semantic search failed.",
          v: 1
        });
      }
    }
  }
  const byKey = new Map;
  const add = (key, lane, rank, laneScore) => {
    const contribution = (lane === "keyword" ? 2 : 1) / (60 + rank);
    const current = byKey.get(key) ?? { evidence: [], score: 0 };
    current.evidence.push({ lane, rank, score: laneScore, v: 1 });
    current.score += contribution;
    byKey.set(key, current);
  };
  keyword.forEach((result, index) => add(result.key, "keyword", index + 1, result.score));
  semantic.forEach((result, index) => add(result.key, "semantic", index + 1, result.score));
  const results = [];
  for (const [key, rank] of [...byKey.entries()].sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0]))) {
    const record = input.store.get(key);
    if (record === null)
      continue;
    results.push({ evidence: rank.evidence, record, score: rank.score, v: 1 });
    if (results.length === limit)
      break;
  }
  return { diagnostics, mode, results, v: 1 };
}

// src/recall.ts
function bounded(value, maximumBytes, label) {
  if (typeof value !== "string" || value.length === 0 || utf8ByteLength(value) > maximumBytes) {
    throw new TypeError(`Recall ${label} must be nonempty text of at most ${maximumBytes} bytes.`);
  }
  return value;
}
function instantOrNull(value, label) {
  if (value === null)
    return null;
  const instant = parseCanonicalInstantV1(value);
  if (instant === null)
    throw new TypeError(`Recall ${label} must be null or a canonical UTC instant.`);
  return instant;
}
function checkedWindow(value) {
  if (value === undefined || value === null)
    return null;
  if (typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Recall window must be an object.");
  const window = value;
  const keys = Object.keys(window).sort();
  if (keys.join(",") !== "since,until,v" || window.v !== 1)
    throw new TypeError("Recall window needs exactly since, until, and v.");
  const since = parseCanonicalInstantV1(window.since), until = parseCanonicalInstantV1(window.until);
  if (since === null || until === null || since > until)
    throw new TypeError("Recall window needs canonical since <= until.");
  return { since, until, v: 1 };
}
function checkedView(value) {
  if (value === undefined)
    return defaultOhRecallViewV1;
  if (typeof value !== "function")
    throw new TypeError("Recall view must be a function.");
  return value;
}
function checkedRecordView(view, record) {
  const result = view(record);
  if (typeof result !== "object" || result === null || Array.isArray(result))
    throw new TypeError("Recall view must return an object.");
  const candidate = result;
  if (Object.keys(candidate).sort().join(",") !== "instant,order,session,text") {
    throw new TypeError("Recall view needs exactly instant, order, session, and text.");
  }
  const instant = instantOrNull(candidate.instant, "view instant");
  if (candidate.order !== null && !Number.isSafeInteger(candidate.order))
    throw new TypeError("Recall view order must be null or an integer.");
  if (typeof candidate.session !== "string" || candidate.session.length === 0 || utf8ByteLength(candidate.session) > 512) {
    throw new TypeError("Recall view session must be nonempty text of at most 512 bytes.");
  }
  if (typeof candidate.text !== "string" || utf8ByteLength(candidate.text) > OH_RECALL_LIMITS_V1.maximumBudgetBytes) {
    throw new TypeError(`Recall view text exceeds ${OH_RECALL_LIMITS_V1.maximumBudgetBytes} bytes.`);
  }
  return { instant, order: candidate.order, session: candidate.session, text: candidate.text };
}
function defaultOhRecallViewV1(record) {
  const value = record.value;
  const object = typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  const observedAt = object === null ? null : parseCanonicalInstantV1(object.observedAt);
  const session = object !== null && typeof object.sessionId === "string" && object.sessionId.length > 0 && utf8ByteLength(object.sessionId) <= 512 ? object.sessionId : record.key;
  const text = object !== null && typeof object.text === "string" ? object.text : canonicalJson(value);
  return { instant: observedAt, order: null, session, text };
}
function compareInstants(left, right) {
  if (left === right)
    return 0;
  if (left === null)
    return 1;
  if (right === null)
    return -1;
  return left < right ? -1 : 1;
}
function compareOrders(left, right) {
  if (left === right)
    return 0;
  if (left === null)
    return 1;
  if (right === null)
    return -1;
  return left - right;
}
async function recallOhV1(input) {
  if (!Array.isArray(input.queries) || input.queries.length < 1 || input.queries.length > OH_RECALL_LIMITS_V1.maximumQueries) {
    throw new RangeError(`Recall needs 1 through ${OH_RECALL_LIMITS_V1.maximumQueries} queries.`);
  }
  const queries = input.queries.map((query) => bounded(query, OH_RECALL_LIMITS_V1.maximumQueryBytes, "query"));
  if (new Set(queries).size !== queries.length)
    throw new TypeError("Recall queries must be distinct.");
  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OH_RECALL_LIMITS_V1.maximumLimit) {
    throw new RangeError(`Recall limit must be 1 through ${OH_RECALL_LIMITS_V1.maximumLimit}.`);
  }
  const mode = input.mode ?? "keyword";
  if (mode !== "keyword" && mode !== "semantic" && mode !== "hybrid")
    throw new TypeError("Recall mode must be keyword, semantic, or hybrid.");
  const asOf = instantOrNull(input.asOf, "asOf"), window = checkedWindow(input.window), view = checkedView(input.view);
  const fused = new Map;
  const diagnostics = [];
  const add = (record, evidence) => {
    const current = fused.get(record.key) ?? { evidence: [], record, score: 0 };
    current.evidence.push(evidence);
    current.score += 1 / (OH_RECALL_LIMITS_V1.rrfConstant + evidence.rank);
    fused.set(record.key, current);
  };
  for (const [index, query] of queries.entries()) {
    const response = await searchOhV1({ ...input.backend === undefined ? {} : { backend: input.backend }, limit, mode, query, store: input.store });
    diagnostics.push(...response.diagnostics);
    response.results.forEach((result, position) => {
      add(result.record, { lane: "query", query: index, rank: position + 1, score: result.score, v: 1 });
    });
  }
  if (window !== null) {
    let scanned = [];
    try {
      scanned = input.store.snapshotRecords(OH_RECALL_LIMITS_V1.maximumScannedRecords);
    } catch (error) {
      diagnostics.push({
        code: "window-unavailable",
        message: error instanceof Error ? error.message : "The window lane could not scan the current records.",
        v: 1
      });
    }
    const dated = scanned.flatMap((record) => {
      const viewed = checkedRecordView(view, record);
      return viewed.instant !== null && viewed.instant >= window.since && viewed.instant <= window.until ? [{ record, viewed }] : [];
    }).sort((left, right) => compareInstants(left.viewed.instant, right.viewed.instant) || compareOrders(left.viewed.order, right.viewed.order) || left.record.key.localeCompare(right.record.key));
    dated.slice(0, limit).forEach((entry, position) => {
      const rank = position + 1;
      add(entry.record, { lane: "window", query: null, rank, score: 1 / (OH_RECALL_LIMITS_V1.rrfConstant + rank), v: 1 });
    });
  }
  const results = [...fused.entries()].sort((left, right) => right[1].score - left[1].score || left[0].localeCompare(right[0])).map(([, entry]) => ({ evidence: entry.evidence, record: entry.record, score: entry.score, v: 1 }));
  return { asOf, diagnostics, mode, queries, results, window, v: 1 };
}
function dayNumber(instant) {
  return Math.floor(Date.parse(instant) / DAY_MS);
}
function dayStart(day) {
  return new Date(day * DAY_MS).toISOString();
}
function dayEnd(day) {
  return new Date(day * DAY_MS + DAY_MS - 1).toISOString();
}
function weekdayOf(day) {
  return new Date(day * DAY_MS).getUTCDay();
}
function mondayOf(day) {
  return day - (weekdayOf(day) + 6) % 7;
}
function formatDay(day) {
  const date = new Date(day * DAY_MS);
  const pad = (value) => value.toString().padStart(2, "0");
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} (${WEEKDAY_LABELS[date.getUTCDay()]})`;
}
function shiftDay(day, unit, count) {
  if (unit === "day")
    return day + count;
  if (unit === "week")
    return day + count * 7;
  const date = new Date(day * DAY_MS);
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + (unit === "month" ? count : 12 * count);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)) / DAY_MS);
}
function windowFor(rule, count, weekday, unit, asOfDay) {
  const date = new Date(asOfDay * DAY_MS), year = date.getUTCFullYear(), month = date.getUTCMonth();
  switch (rule.kind) {
    case "day":
      return [asOfDay + rule.offset, asOfDay + rule.offset];
    case "around": {
      const target = shiftDay(asOfDay, rule.unit, rule.sign * count);
      return [target - rule.toleranceDays, target + rule.toleranceDays];
    }
    case "week": {
      const monday = mondayOf(asOfDay) + rule.offset * 7;
      return [monday, monday + 6];
    }
    case "month":
      return [Math.floor(Date.UTC(year, month + rule.offset, 1) / DAY_MS), Math.floor(Date.UTC(year, month + rule.offset + 1, 0) / DAY_MS)];
    case "year":
      return [Math.floor(Date.UTC(year + rule.offset, 0, 1) / DAY_MS), Math.floor(Date.UTC(year + rule.offset, 11, 31) / DAY_MS)];
    case "weekend": {
      const saturday = mondayOf(asOfDay) + rule.offset * 7 + 5;
      return [saturday, saturday + 1];
    }
    case "past":
      return [shiftDay(asOfDay, unit, -count), asOfDay];
    case "weekday": {
      const target = weekday, current = weekdayOf(asOfDay);
      if (rule.offset < 0) {
        const back = (current - target + 7) % 7 || 7;
        return [asOfDay - back, asOfDay - back];
      }
      if (rule.offset > 0) {
        const forward = (target - current + 7) % 7 || 7;
        return [asOfDay + forward, asOfDay + forward];
      }
      const day = mondayOf(asOfDay) + (target + 6) % 7;
      return [day, day];
    }
  }
}
function resolveRelativeDateWindowV1(query, asOf) {
  const text = bounded(query, OH_RECALL_LIMITS_V1.maximumQueryBytes, "query").normalize("NFC").toLowerCase();
  const asOfInstant = parseCanonicalInstantV1(asOf);
  if (asOfInstant === null)
    throw new TypeError("Recall asOf must be a canonical UTC instant.");
  const numbers = OH_RECALL_DATE_GRAMMAR_V1.numbers;
  const numberPattern = `(\\d{1,3}|${Object.keys(numbers).join("|")})`;
  const weekdayPattern = `(${WEEKDAY_NAMES.join("|")})`, unitPattern = "(day|week|month|year)";
  const found = [];
  for (const rule2 of OH_RECALL_DATE_GRAMMAR_V1.rules) {
    const source = rule2.pattern.replace("(NUMBER)", numberPattern).replace("(WEEKDAY)", weekdayPattern).replace("(UNIT)", unitPattern);
    for (const match of text.matchAll(new RegExp(source, "gu"))) {
      const capture = match[1] ?? "";
      let count2 = 0, weekday2 = null, unit2 = null;
      if (rule2.kind === "weekday")
        weekday2 = WEEKDAY_NAMES.indexOf(capture);
      else if (rule2.kind === "around" || rule2.kind === "past") {
        count2 = capture.length === 0 && rule2.kind === "past" ? 1 : /^\d+$/u.test(capture) ? Number(capture) : numbers[capture] ?? 0;
        if (count2 < 1)
          continue;
        if (rule2.kind === "past")
          unit2 = match[2] ?? null;
      }
      const start = match.index ?? 0;
      found.push({ expression: match[0], rule: rule2, count: count2, weekday: weekday2, unit: unit2, start, end: start + match[0].length });
    }
  }
  const outer = found.filter((item) => !found.some((other) => other !== item && other.start <= item.start && other.end >= item.end && other.end - other.start > item.end - item.start));
  const distinct = new Map(outer.map((item) => [`${item.rule.id}:${item.count}:${item.weekday ?? ""}:${item.unit ?? ""}`, item]));
  if (distinct.size !== 1)
    return null;
  const [{ expression, rule, count, weekday, unit }] = [...distinct.values()];
  const [first, last] = windowFor(rule, count, weekday, unit, dayNumber(asOfInstant));
  return { expression, rule: rule.id, since: dayStart(first), until: dayEnd(last), v: 1 };
}
function offsetLabel(days) {
  if (days === 0)
    return "the day of the question";
  const count = Math.abs(days), unit = count === 1 ? "day" : "days";
  return `${count} ${unit} ${days < 0 ? "before" : "after"} the question`;
}
function gapMarker(days) {
  if (days < 14)
    return `[${days} ${days === 1 ? "day" : "days"} later]`;
  if (days < 61) {
    const weeks = Math.floor(days / 7);
    return `[${weeks} ${weeks === 1 ? "week" : "weeks"} later]`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `[${months} ${months === 1 ? "month" : "months"} later]`;
  }
  const years = Math.floor(days / 365);
  return `[${years} ${years === 1 ? "year" : "years"} later]`;
}
function compose(selected, asOf) {
  if (asOf === null)
    return { blocks: selected.map((item) => item.view.text), keys: selected.map((item) => item.key) };
  const sessions = new Map;
  for (const item of selected) {
    const members = sessions.get(item.view.session);
    if (members === undefined)
      sessions.set(item.view.session, [item]);
    else
      members.push(item);
  }
  const compareMembers = (left, right) => compareInstants(left.view.instant, right.view.instant) || compareOrders(left.view.order, right.view.order) || left.index - right.index;
  const grouped = [...sessions.entries()].map(([session, members]) => {
    const sorted = [...members].sort(compareMembers);
    return { instant: sorted[0]?.view.instant ?? null, members: sorted, session };
  });
  const dated = grouped.filter((group) => group.instant !== null).sort((left, right) => compareInstants(left.instant, right.instant) || left.session.localeCompare(right.session));
  const undated = grouped.filter((group) => group.instant === null);
  const asOfDay = dayNumber(asOf);
  const blocks = [`Question date: ${formatDay(asOfDay)}`], keys = [];
  let previousDay = null;
  for (const group of dated) {
    const day = dayNumber(group.instant);
    if (previousDay !== null && day - previousDay >= 1)
      blocks.push(gapMarker(day - previousDay));
    previousDay = day;
    blocks.push(`Date: ${formatDay(day)}, ${offsetLabel(day - asOfDay)}
${group.members.map((item) => item.view.text).join(`

`)}`);
    keys.push(...group.members.map((item) => item.key));
  }
  for (const group of undated) {
    blocks.push(`Date: unknown
${group.members.map((item) => item.view.text).join(`

`)}`);
    keys.push(...group.members.map((item) => item.key));
  }
  return { blocks, keys };
}
function composedBytes(blocks) {
  let bytes = 0;
  for (const [index, block] of blocks.entries())
    bytes += utf8ByteLength(block) + (index === 0 ? 0 : 2);
  return bytes;
}
function renderOhRecallV1(input, options) {
  if (!Array.isArray(input.results) || input.results.length > OH_RECALL_LIMITS_V1.maximumRenderedResults) {
    throw new RangeError(`Recall rendering accepts at most ${OH_RECALL_LIMITS_V1.maximumRenderedResults} results.`);
  }
  const asOf = instantOrNull(options.asOf, "asOf"), view = checkedView(options.view), budget = options.budgetBytes;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > OH_RECALL_LIMITS_V1.maximumBudgetBytes) {
    throw new RangeError(`Recall budget must be 1 through ${OH_RECALL_LIMITS_V1.maximumBudgetBytes} bytes.`);
  }
  const seen = new Set, selected = [];
  let omitted = 0, layout = compose([], asOf);
  for (const [index, result] of input.results.entries()) {
    const record = result.record;
    if (typeof record !== "object" || record === null || typeof record.key !== "string")
      throw new TypeError("Recall rendering needs records.");
    if (seen.has(record.key))
      continue;
    seen.add(record.key);
    const candidate = { index, key: record.key, view: checkedRecordView(view, record) };
    const attempt = compose([...selected, candidate], asOf);
    if (composedBytes(attempt.blocks) > budget) {
      omitted += 1;
      continue;
    }
    selected.push(candidate);
    layout = attempt;
  }
  const text = selected.length === 0 ? "" : layout.blocks.join(`

`);
  return { bytes: utf8ByteLength(text), keys: layout.keys, omitted, renderer: OH_RECALL_RENDERER_V1, text, v: 1 };
}
var OH_RECALL_LIMITS_V1, OH_RECALL_RENDERER_V1 = "oh.recall-render.v1", WEEKDAY_NAMES, WEEKDAY_LABELS, DAY_MS = 86400000, OH_RECALL_DATE_GRAMMAR_V1;
var init_recall = __esm(() => {
  init_canonical();
  OH_RECALL_LIMITS_V1 = Object.freeze({
    maximumQueries: 6,
    maximumQueryBytes: 16384,
    maximumLimit: 100,
    maximumRenderedResults: 8192,
    maximumBudgetBytes: 4000000,
    maximumScannedRecords: 65536,
    rrfConstant: 60,
    v: 1
  });
  WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  OH_RECALL_DATE_GRAMMAR_V1 = Object.freeze({
    id: "oh.recall-date-grammar.v1",
    timeZone: "UTC",
    weekStart: "monday",
    numbers: Object.freeze({
      a: 1,
      an: 1,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12
    }),
    weekdays: WEEKDAY_NAMES,
    rules: Object.freeze([
      { id: "today", pattern: "\\btoday\\b", kind: "day", offset: 0 },
      { id: "yesterday", pattern: "\\byesterday\\b", kind: "day", offset: -1 },
      { id: "tomorrow", pattern: "\\btomorrow\\b", kind: "day", offset: 1 },
      { id: "days-ago", pattern: "\\b(NUMBER) days? ago\\b", kind: "around", unit: "day", sign: -1, toleranceDays: 0 },
      { id: "weeks-ago", pattern: "\\b(NUMBER) weeks? ago\\b", kind: "around", unit: "week", sign: -1, toleranceDays: 3 },
      { id: "months-ago", pattern: "\\b(NUMBER) months? ago\\b", kind: "around", unit: "month", sign: -1, toleranceDays: 15 },
      { id: "years-ago", pattern: "\\b(NUMBER) years? ago\\b", kind: "around", unit: "year", sign: -1, toleranceDays: 45 },
      { id: "in-days", pattern: "\\bin (NUMBER) days?\\b", kind: "around", unit: "day", sign: 1, toleranceDays: 0 },
      { id: "in-weeks", pattern: "\\bin (NUMBER) weeks?\\b", kind: "around", unit: "week", sign: 1, toleranceDays: 3 },
      { id: "in-months", pattern: "\\bin (NUMBER) months?\\b", kind: "around", unit: "month", sign: 1, toleranceDays: 15 },
      { id: "in-years", pattern: "\\bin (NUMBER) years?\\b", kind: "around", unit: "year", sign: 1, toleranceDays: 45 },
      { id: "last-week", pattern: "\\blast week\\b", kind: "week", offset: -1 },
      { id: "this-week", pattern: "\\bthis week\\b", kind: "week", offset: 0 },
      { id: "next-week", pattern: "\\bnext week\\b", kind: "week", offset: 1 },
      { id: "last-month", pattern: "\\blast month\\b", kind: "month", offset: -1 },
      { id: "this-month", pattern: "\\bthis month\\b", kind: "month", offset: 0 },
      { id: "next-month", pattern: "\\bnext month\\b", kind: "month", offset: 1 },
      { id: "last-year", pattern: "\\blast year\\b", kind: "year", offset: -1 },
      { id: "this-year", pattern: "\\bthis year\\b", kind: "year", offset: 0 },
      { id: "next-year", pattern: "\\bnext year\\b", kind: "year", offset: 1 },
      { id: "last-weekend", pattern: "\\blast weekend\\b", kind: "weekend", offset: -1 },
      { id: "this-weekend", pattern: "\\bthis weekend\\b", kind: "weekend", offset: 0 },
      { id: "next-weekend", pattern: "\\bnext weekend\\b", kind: "weekend", offset: 1 },
      { id: "past-span", pattern: "\\b(?:in|over|during|within) the (?:last|past) (?:(NUMBER) )?(UNIT)s?\\b", kind: "past" },
      { id: "last-weekday", pattern: "\\blast (WEEKDAY)\\b", kind: "weekday", offset: -1 },
      { id: "this-weekday", pattern: "\\bthis (WEEKDAY)\\b", kind: "weekday", offset: 0 },
      { id: "next-weekday", pattern: "\\bnext (WEEKDAY)\\b", kind: "weekday", offset: 1 }
    ]),
    v: 1
  });
});

// src/sqlite/migrations.ts
function applyOhSqliteMigrations(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS oh_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    migration_sha256 TEXT NOT NULL CHECK(length(migration_sha256) = 64),
    applied_at TEXT NOT NULL
  ) STRICT`);
  const select = database.query("SELECT name, migration_sha256 FROM oh_migrations WHERE version = ?");
  const insert = database.query("INSERT INTO oh_migrations(version, name, migration_sha256, applied_at) VALUES (?, ?, ?, ?)");
  for (const migration of OH_SQLITE_MIGRATIONS) {
    const digest = sha256Hex(migration.sql);
    database.exec("BEGIN IMMEDIATE");
    try {
      const existing = select.get(migration.version);
      if (existing !== null) {
        if (existing.name !== migration.name || existing.migration_sha256 !== digest) {
          throw new Error(`SQLite migration ${migration.version} does not match the applied migration.`);
        }
      } else {
        database.exec(migration.sql);
        insert.run(migration.version, migration.name, digest, canonicalNow());
      }
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }
}
var OH_SQLITE_SCHEMA_VERSION = 2, OH_SQLITE_MIGRATIONS;
var init_migrations = __esm(() => {
  init_canonical();
  OH_SQLITE_MIGRATIONS = Object.freeze([
    Object.freeze({
      name: "0001_oh_core",
      version: 1,
      sql: `
CREATE TABLE oh_contracts (
  contract_id TEXT PRIMARY KEY,
  contract_sha256 TEXT NOT NULL CHECK(length(contract_sha256) = 64),
  manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE oh_spaces (
  space_id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES oh_contracts(contract_id),
  generation INTEGER NOT NULL CHECK(generation >= 0),
  head_operation_sha256 TEXT CHECK(head_operation_sha256 IS NULL OR length(head_operation_sha256) = 64),
  graph_revision_sha256 TEXT CHECK(graph_revision_sha256 IS NULL OR length(graph_revision_sha256) = 64),
  records_sha256 TEXT NOT NULL CHECK(length(records_sha256) = 64),
  sequence INTEGER NOT NULL CHECK(sequence >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(generation = sequence),
  CHECK((sequence = 0) = (head_operation_sha256 IS NULL)),
  CHECK((sequence = 0) = (graph_revision_sha256 IS NULL))
) STRICT;

CREATE TABLE oh_operations (
  operation_sha256 TEXT PRIMARY KEY CHECK(length(operation_sha256) = 64),
  space_id TEXT NOT NULL REFERENCES oh_spaces(space_id),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  operation_id TEXT NOT NULL,
  parent_operation_sha256 TEXT CHECK(parent_operation_sha256 IS NULL OR length(parent_operation_sha256) = 64),
  graph_revision_sha256 TEXT NOT NULL CHECK(length(graph_revision_sha256) = 64),
  records_sha256 TEXT NOT NULL CHECK(length(records_sha256) = 64),
  operation_json TEXT NOT NULL CHECK(json_valid(operation_json)),
  instant TEXT NOT NULL,
  UNIQUE(space_id, sequence),
  UNIQUE(space_id, operation_id)
) STRICT;

CREATE TABLE oh_operation_records (
  operation_sha256 TEXT NOT NULL REFERENCES oh_operations(operation_sha256),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  record_key TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK(change_kind IN ('put', 'tombstone')),
  record_sha256 TEXT CHECK(record_sha256 IS NULL OR length(record_sha256) = 64),
  PRIMARY KEY(operation_sha256, ordinal),
  UNIQUE(operation_sha256, record_key)
) STRICT;

CREATE TABLE oh_records (
  space_id TEXT NOT NULL REFERENCES oh_spaces(space_id),
  record_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  record_sha256 TEXT NOT NULL CHECK(length(record_sha256) = 64),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  operation_sha256 TEXT NOT NULL REFERENCES oh_operations(operation_sha256),
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  PRIMARY KEY(space_id, record_key)
) STRICT;

CREATE TABLE oh_dependencies (
  space_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  dependency_key TEXT NOT NULL,
  PRIMARY KEY(space_id, record_key, dependency_key),
  FOREIGN KEY(space_id, record_key) REFERENCES oh_records(space_id, record_key) ON DELETE CASCADE,
  FOREIGN KEY(space_id, dependency_key) REFERENCES oh_records(space_id, record_key)
) STRICT;

CREATE TABLE oh_sync_outbox (
  space_id TEXT NOT NULL REFERENCES oh_spaces(space_id),
  sequence INTEGER NOT NULL,
  operation_sha256 TEXT NOT NULL REFERENCES oh_operations(operation_sha256),
  PRIMARY KEY(space_id, sequence),
  UNIQUE(operation_sha256)
) STRICT;

CREATE TABLE oh_sync_state (
  remote_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES oh_spaces(space_id),
  pulled_sequence INTEGER NOT NULL CHECK(pulled_sequence >= 0),
  pushed_sequence INTEGER NOT NULL CHECK(pushed_sequence >= 0),
  remote_head_sha256 TEXT CHECK(remote_head_sha256 IS NULL OR length(remote_head_sha256) = 64),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(remote_id, space_id)
) STRICT;

CREATE TABLE oh_search_documents (
  space_id TEXT NOT NULL,
  record_key TEXT NOT NULL,
  record_sha256 TEXT NOT NULL CHECK(length(record_sha256) = 64),
  text TEXT NOT NULL,
  PRIMARY KEY(space_id, record_key),
  FOREIGN KEY(space_id, record_key) REFERENCES oh_records(space_id, record_key) ON DELETE CASCADE
) STRICT;

CREATE VIRTUAL TABLE oh_search_fts USING fts5(
  space_id UNINDEXED,
  record_key UNINDEXED,
  text,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE INDEX oh_operations_space_sequence ON oh_operations(space_id, sequence);
CREATE INDEX oh_records_space_kind ON oh_records(space_id, kind, record_key);
CREATE INDEX oh_dependencies_dependency ON oh_dependencies(space_id, dependency_key);
`
    }),
    Object.freeze({
      name: "0002_store_realms",
      version: 2,
      sql: `
CREATE TABLE oh_space_bindings (
  space_id TEXT PRIMARY KEY REFERENCES oh_spaces(space_id),
  realm_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_kind TEXT NOT NULL CHECK(profile_kind IN ('canonical', 'working')),
  profile_sha256 TEXT NOT NULL CHECK(length(profile_sha256) = 64),
  binding_sha256 TEXT NOT NULL UNIQUE CHECK(length(binding_sha256) = 64),
  binding_json TEXT NOT NULL CHECK(json_valid(binding_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE oh_space_purges (
  space_id TEXT PRIMARY KEY,
  binding_sha256 TEXT NOT NULL CHECK(length(binding_sha256) = 64),
  prior_operation_sha256 TEXT CHECK(prior_operation_sha256 IS NULL OR length(prior_operation_sha256) = 64),
  prior_sequence INTEGER NOT NULL CHECK(prior_sequence >= 0),
  purged_at TEXT NOT NULL,
  receipt_sha256 TEXT NOT NULL UNIQUE CHECK(length(receipt_sha256) = 64),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json))
) STRICT;
`
    })
  ]);
});

// src/errors.ts
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
function isOhIntegrityError(value) {
  return hasNativeErrorBrand(value, OH_INTEGRITY_ERROR_BRAND_V1);
}
function isOhDependencyError(value) {
  return hasNativeErrorBrand(value, OH_DEPENDENCY_ERROR_BRAND_V1);
}
function isOhProfileError(value) {
  return hasNativeErrorBrand(value, OH_PROFILE_ERROR_BRAND_V1);
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
var OH_OPERATION_SIZE_ERROR_CODE_V1 = "oh.operation-size.v1", OH_CONFLICT_ERROR_BRAND_V1, OH_DEPENDENCY_ERROR_BRAND_V1, OH_INTEGRITY_ERROR_BRAND_V1, OH_OPERATION_SIZE_ERROR_BRAND_V1, OH_PROFILE_ERROR_BRAND_V1, OhConflictError, OhIntegrityError, OhDependencyError, OhProfileError, OhOperationSizeError;
var init_errors = __esm(() => {
  OH_CONFLICT_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhConflictError/v1");
  OH_DEPENDENCY_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhDependencyError/v1");
  OH_INTEGRITY_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhIntegrityError/v1");
  OH_OPERATION_SIZE_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhOperationSizeError/v1");
  OH_PROFILE_ERROR_BRAND_V1 = Symbol.for("@hraness/oh/OhProfileError/v1");
  OhConflictError = class OhConflictError extends Error {
    static [Symbol.hasInstance](value) {
      return this === OhConflictError ? isOhConflictError(value) : hasNativeSubclassInstance(this, value);
    }
    constructor(message) {
      super(message);
      this.name = "OhConflictError";
      brandNativeError(this, OH_CONFLICT_ERROR_BRAND_V1);
    }
  };
  OhIntegrityError = class OhIntegrityError extends Error {
    static [Symbol.hasInstance](value) {
      return this === OhIntegrityError ? isOhIntegrityError(value) : hasNativeSubclassInstance(this, value);
    }
    constructor(message) {
      super(message);
      this.name = "OhIntegrityError";
      brandNativeError(this, OH_INTEGRITY_ERROR_BRAND_V1);
    }
  };
  OhDependencyError = class OhDependencyError extends Error {
    static [Symbol.hasInstance](value) {
      return this === OhDependencyError ? isOhDependencyError(value) : hasNativeSubclassInstance(this, value);
    }
    constructor(message) {
      super(message);
      this.name = "OhDependencyError";
      brandNativeError(this, OH_DEPENDENCY_ERROR_BRAND_V1);
    }
  };
  OhProfileError = class OhProfileError extends Error {
    static [Symbol.hasInstance](value) {
      return this === OhProfileError ? isOhProfileError(value) : hasNativeSubclassInstance(this, value);
    }
    constructor(message) {
      super(message);
      this.name = "OhProfileError";
      brandNativeError(this, OH_PROFILE_ERROR_BRAND_V1);
    }
  };
  OhOperationSizeError = class OhOperationSizeError extends RangeError {
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
  };
});

// src/operation.ts
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
var OH_OPERATION_MAX_BYTES_V1;
var init_operation = __esm(() => {
  init_canonical();
  init_errors();
  init_ontology();
  init_graph();
  init_graph();
  OH_OPERATION_MAX_BYTES_V1 = 64 * 1024 * 1024;
});

// src/sync-model.ts
import { isProxy } from "util/types";
function exactDataRecordV1(value, expectedKeys) {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value))
      return null;
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if (prototype !== Object.prototype && prototype !== null || keys.length !== expectedKeys.length || keys.some((key) => typeof key !== "string") || expectedKeys.some((key) => !keys.includes(key)))
      return null;
    const detached = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined)
        return null;
      Object.defineProperty(detached, key, {
        configurable: false,
        enumerable: true,
        value: descriptor.value,
        writable: false
      });
    }
    return detached;
  } catch {
    return null;
  }
}
function exactDataArrayV1(value, maximumLength, clone = true) {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value))
      return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > maximumLength)
      return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length)))
      return null;
    const detached = clone ? [] : null;
    for (let index = 0;index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined)
        return null;
      detached?.push(descriptor.value);
    }
    return detached ?? value;
  } catch {
    return null;
  }
}
function stagedSyncOperationV1(value, bundleBudget) {
  const operation = exactDataRecordV1(value, OH_OPERATION_KEYS_V1);
  if (operation === null || operation.v !== 1 || operation.contractId !== OH_CONTRACT_ID_V1 || safeCode(operation.actorId) === null || safeCode(operation.operationId) === null || safeCode(operation.spaceId) === null || parseCanonicalInstantV1(operation.instant) === null || parseSha256Hex(operation.operationSha256) === null || parseSha256Hex(operation.graphRevisionSha256) === null || parseSha256Hex(operation.recordsSha256) === null)
    return null;
  const parentOperationSha256 = operation.parentOperationSha256 === null ? null : parseSha256Hex(operation.parentOperationSha256);
  const sequence = Number.isSafeInteger(operation.sequence) && operation.sequence > 0 ? operation.sequence : null;
  if (sequence === null || operation.parentOperationSha256 !== null && parentOperationSha256 === null || sequence === 1 !== (parentOperationSha256 === null))
    return null;
  const changes = exactDataArrayV1(operation.changes, OH_GRAPH_LIMITS_V1.changesPerOperation, false);
  if (changes === null || changes.length === 0)
    return null;
  const aggregateDataBudget = {
    bytes: 0,
    maximumBytes: OH_OPERATION_MAX_BYTES_V1,
    maximumNodes: OH_SYNC_INGRESS_OPERATION_NODES_V1,
    nodes: 0
  };
  for (const change of changes) {
    const put = exactDataRecordV1(change, OH_PUT_CHANGE_KEYS_V1);
    if (put !== null && put.kind === "put" && put.v === 1) {
      const record = exactDataRecordV1(put.record, OH_RECORD_KEYS_V1);
      if (record === null)
        return null;
      const valuePreflight = preflightSyncIngressValueV1(record.value, aggregateDataBudget);
      const dependenciesPreflight = preflightSyncIngressDependenciesV1(record.dependencies, aggregateDataBudget);
      if (valuePreflight === null || dependenciesPreflight === null)
        return null;
      continue;
    }
    const tombstone = exactDataRecordV1(change, OH_TOMBSTONE_CHANGE_KEYS_V1);
    if (tombstone === null || tombstone.kind !== "tombstone" || tombstone.v !== 1)
      return null;
  }
  const detached = boundedSyncIngressV1(operation, {
    maximumBytes: OH_OPERATION_MAX_BYTES_V1,
    maximumDepth: OH_SYNC_INGRESS_OPERATION_DEPTH_V1,
    maximumNodes: OH_SYNC_INGRESS_OPERATION_NODES_V1
  }, bundleBudget, true);
  return detached === null ? null : detached.value;
}
function canonicalStringBytesV1(value, maximumBytes) {
  if (value.length + 2 > maximumBytes)
    throw new RangeError("String exceeds its canonical byte budget.");
  let bytes = 2;
  for (let index = 0;index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343))
        throw new TypeError("Invalid Unicode string.");
      bytes += 4;
      index += 1;
    } else if (code >= 56320 && code <= 57343) {
      throw new TypeError("Invalid Unicode string.");
    } else if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) {
      bytes += 2;
    } else if (code <= 31) {
      bytes += 6;
    } else if (code <= 127) {
      bytes += 1;
    } else if (code <= 2047) {
      bytes += 2;
    } else {
      bytes += 3;
    }
    if (bytes > maximumBytes)
      throw new RangeError("String exceeds its canonical byte budget.");
  }
  return bytes;
}
function boundedSyncIngressV1(value, limits, aggregate, clone) {
  const ancestors = new Set;
  const budget = {
    bytes: 0,
    maximumBytes: limits.maximumBytes,
    maximumNodes: limits.maximumNodes,
    nodes: 0
  };
  const canSpendBytes = (count) => budget.bytes + count <= budget.maximumBytes && (aggregate === null || aggregate.bytes + count <= aggregate.maximumBytes);
  const spendBytes = (count) => {
    if (!canSpendBytes(count))
      throw new RangeError("Sync ingress exceeds its canonical byte budget.");
    budget.bytes += count;
    if (aggregate !== null)
      aggregate.bytes += count;
  };
  const canSpendNodes = (count) => budget.nodes + count <= budget.maximumNodes && (aggregate === null || aggregate.nodes + count <= aggregate.maximumNodes);
  const spendNode = () => {
    if (!canSpendNodes(1))
      throw new RangeError("Sync ingress exceeds its node budget.");
    budget.nodes += 1;
    if (aggregate !== null)
      aggregate.nodes += 1;
  };
  const detach = (candidate, depth) => {
    if (depth > limits.maximumDepth)
      throw new RangeError("Sync ingress exceeds its depth budget.");
    spendNode();
    if (candidate === null) {
      spendBytes(4);
      return candidate;
    }
    if (typeof candidate === "boolean") {
      spendBytes(candidate ? 4 : 5);
      return candidate;
    }
    if (typeof candidate === "string") {
      spendBytes(canonicalStringBytesV1(candidate, Math.min(budget.maximumBytes - budget.bytes, aggregate === null ? Number.MAX_SAFE_INTEGER : aggregate.maximumBytes - aggregate.bytes)));
      return candidate;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate) || Object.is(candidate, -0))
        throw new TypeError("Invalid number.");
      spendBytes(utf8ByteLength(canonicalJson(candidate)));
      return candidate;
    }
    if (typeof candidate !== "object" || isProxy(candidate))
      throw new TypeError("Invalid data value.");
    if (ancestors.has(candidate))
      throw new TypeError("Cyclic data value.");
    ancestors.add(candidate);
    try {
      if (Array.isArray(candidate)) {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(candidate, "length");
        const length = lengthDescriptor?.value;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || !canSpendNodes(length) || !canSpendBytes(2 + Math.max(0, length - 1) + length)) {
          throw new TypeError("Invalid or over-budget data array.");
        }
        const keys2 = Reflect.ownKeys(candidate);
        if (keys2.length !== length + 1 || !keys2.includes("length") || keys2.some((key) => key !== "length" && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) {
          throw new TypeError("Invalid data array.");
        }
        spendBytes(2 + Math.max(0, length - 1));
        const detached2 = clone ? [] : null;
        for (let index = 0;index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(candidate, String(index));
          if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
            throw new TypeError("Invalid data array entry.");
          }
          const item = detach(descriptor.value, depth + 1);
          detached2?.push(item);
        }
        return detached2 === null ? candidate : Object.freeze(detached2);
      }
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Invalid data object.");
      }
      let containerBytes = 2;
      let properties = 0;
      for (const key in candidate) {
        if (!Object.hasOwn(candidate, key))
          continue;
        properties += 1;
        if (!canSpendNodes(properties))
          throw new RangeError("Sync ingress exceeds its node budget.");
        const remainingBytes = Math.min(budget.maximumBytes - budget.bytes - containerBytes - properties, aggregate === null ? Number.MAX_SAFE_INTEGER : aggregate.maximumBytes - aggregate.bytes - containerBytes - properties);
        containerBytes += (properties === 1 ? 0 : 1) + canonicalStringBytesV1(key, remainingBytes) + 1;
        if (!canSpendBytes(containerBytes + properties)) {
          throw new RangeError("Sync ingress exceeds its canonical byte budget.");
        }
      }
      const keys = Reflect.ownKeys(candidate);
      if (keys.length !== properties || keys.some((key) => typeof key !== "string")) {
        throw new TypeError("Invalid data object.");
      }
      spendBytes(containerBytes);
      const detached = clone ? Object.create(null) : null;
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
        if (descriptor === undefined || !descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
          throw new TypeError("Invalid data property.");
        }
        const item = detach(descriptor.value, depth + 1);
        if (detached !== null) {
          Object.defineProperty(detached, key, {
            configurable: false,
            enumerable: true,
            value: item,
            writable: false
          });
        }
      }
      return detached === null ? candidate : Object.freeze(detached);
    } finally {
      ancestors.delete(candidate);
    }
  };
  try {
    return Object.freeze({ value: detach(value, 0) });
  } catch {
    return null;
  }
}
function preflightSyncIngressValueV1(value, aggregate) {
  return boundedSyncIngressV1(value, {
    maximumBytes: OH_GRAPH_LIMITS_V1.recordBytes,
    maximumDepth: OH_SYNC_INGRESS_VALUE_DEPTH_V1,
    maximumNodes: OH_SYNC_INGRESS_VALUE_NODES_V1
  }, aggregate, false);
}
function preflightSyncIngressDependenciesV1(value, aggregate) {
  try {
    if (typeof value !== "object" || value === null || isProxy(value) || !Array.isArray(value)) {
      return null;
    }
    const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > OH_GRAPH_LIMITS_V1.dependenciesPerRecord)
      return null;
    const maximumBytes = length === 0 ? 2 : 1 + length * 515;
    return boundedSyncIngressV1(value, {
      maximumBytes,
      maximumDepth: 1,
      maximumNodes: length + 1
    }, aggregate, false);
  } catch {
    return null;
  }
}
function syncIngressBundleBudgetV1(spaceId) {
  const emptyBundle = {
    bundleSha256: "0".repeat(64),
    contractSha256: OH_CONTRACT_MANIFEST_V1.contractSha256,
    operations: [],
    protocol: OH_SYNC_PROTOCOL_V1,
    spaceId,
    v: 1
  };
  return {
    bytes: utf8ByteLength(canonicalJson(emptyBundle)),
    maximumBytes: OH_SYNC_BUNDLE_MAX_BYTES_V1,
    maximumNodes: OH_SYNC_INGRESS_BUNDLE_NODES_V1,
    nodes: 7
  };
}
function spendSyncIngressBudgetV1(budget, bytes, nodes = 0) {
  if (budget.bytes + bytes > budget.maximumBytes || budget.nodes + nodes > budget.maximumNodes)
    return false;
  budget.bytes += bytes;
  budget.nodes += nodes;
  return true;
}
function measureSyncOperationV1(operation) {
  const measurement = {
    bytes: 0,
    maximumBytes: OH_OPERATION_MAX_BYTES_V1,
    maximumNodes: OH_SYNC_INGRESS_OPERATION_NODES_V1,
    nodes: 0
  };
  return boundedSyncIngressV1(operation, {
    maximumBytes: OH_OPERATION_MAX_BYTES_V1,
    maximumDepth: OH_SYNC_INGRESS_OPERATION_DEPTH_V1,
    maximumNodes: OH_SYNC_INGRESS_OPERATION_NODES_V1
  }, measurement, false) === null ? null : measurement;
}
function buildOhSyncBundleV1(parsedSpaceId, operations, largestFittingPrefix) {
  let priorSequence = null;
  let priorSha256 = null;
  const parsed = [];
  const bundleBudget = syncIngressBundleBudgetV1(parsedSpaceId);
  for (const candidate of operations) {
    const operation = parseOhOperationV1(candidate);
    if (operation === null || operation.spaceId !== parsedSpaceId || priorSequence !== null && operation.sequence !== priorSequence + 1 || priorSequence !== null && operation.parentOperationSha256 !== priorSha256) {
      throw new TypeError("Sync operations must form one ordered chain.");
    }
    const measurement = measureSyncOperationV1(operation);
    if (measurement === null) {
      throw new RangeError("Sync operation exceeds its canonical byte, node, or depth limit.");
    }
    if (!spendSyncIngressBudgetV1(bundleBudget, measurement.bytes + (parsed.length === 0 ? 0 : 1), measurement.nodes)) {
      if (largestFittingPrefix && parsed.length > 0)
        break;
      throw new RangeError("Sync bundle exceeds its canonical byte or node limit.");
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
function parseSyncHeadRefEnvelopeV1(value) {
  const operationSha256 = value.operationSha256 === null ? null : parseSha256Hex(value.operationSha256);
  const sequence = Number.isSafeInteger(value.sequence) && value.sequence >= 0 && !Object.is(value.sequence, -0) ? value.sequence : null;
  return sequence !== null && (value.operationSha256 === null || operationSha256 !== null) && sequence === 0 === (operationSha256 === null) ? { operationSha256, sequence } : null;
}
function parseOhSyncHeadV1(value) {
  const envelope = exactDataRecordV1(value, OH_SYNC_HEAD_KEYS_V1);
  if (envelope === null || envelope.v !== 1)
    return null;
  const reference = parseSyncHeadRefEnvelopeV1(envelope);
  return reference === null ? null : { ...reference, v: 1 };
}
function createOhSyncBundleV1(spaceId, operations, options = {}) {
  const parsedSpaceId = safeCode(spaceId);
  const largestFittingPrefix = options.largestFittingPrefix ?? false;
  if (parsedSpaceId === null || operations.length > OH_SYNC_BUNDLE_MAX_OPERATIONS_V1 || typeof largestFittingPrefix !== "boolean") {
    throw new TypeError("Invalid sync bundle.");
  }
  return buildOhSyncBundleV1(parsedSpaceId, operations, largestFittingPrefix);
}
function parseOhSyncBundleV1(value) {
  const envelope = exactDataRecordV1(value, OH_SYNC_BUNDLE_KEYS_V1);
  if (envelope === null || envelope.protocol !== OH_SYNC_PROTOCOL_V1 || envelope.v !== 1)
    return null;
  const bundleSha256 = parseSha256Hex(envelope.bundleSha256);
  const contractSha256 = parseSha256Hex(envelope.contractSha256);
  const spaceId = safeCode(envelope.spaceId);
  if (bundleSha256 === null || contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256 || spaceId === null)
    return null;
  const operations = exactDataArrayV1(envelope.operations, OH_SYNC_BUNDLE_MAX_OPERATIONS_V1);
  if (operations === null)
    return null;
  const detachedOperations = [];
  const bundleBudget = syncIngressBundleBudgetV1(spaceId);
  for (const operation of operations) {
    if (detachedOperations.length > 0 && !spendSyncIngressBudgetV1(bundleBudget, 1))
      return null;
    const detached = stagedSyncOperationV1(operation, bundleBudget);
    if (detached === null)
      return null;
    detachedOperations.push(detached);
  }
  try {
    const created = createOhSyncBundleV1(spaceId, detachedOperations);
    if (detachedOperations.some((operation, index) => canonicalJson(operation) !== canonicalJson(created.operations[index])))
      return null;
    return created.bundleSha256 === bundleSha256 ? { ...created, bundleSha256 } : null;
  } catch {
    return null;
  }
}
var OH_SYNC_PROTOCOL_V1 = "oh.sync.v1", OH_SYNC_BUNDLE_MAX_OPERATIONS_V1 = 1000, OH_SYNC_BUNDLE_KEYS_V1, OH_SYNC_HEAD_KEYS_V1, OH_OPERATION_KEYS_V1, OH_PUT_CHANGE_KEYS_V1, OH_TOMBSTONE_CHANGE_KEYS_V1, OH_RECORD_KEYS_V1, OH_SYNC_INGRESS_VALUE_DEPTH_V1 = 128, OH_SYNC_INGRESS_VALUE_NODES_V1, OH_SYNC_INGRESS_OPERATION_DEPTH_V1, OH_SYNC_INGRESS_OPERATION_NODES_V1, OH_SYNC_BUNDLE_MAX_BYTES_V1, OH_SYNC_INGRESS_BUNDLE_NODES_V1;
var init_sync_model = __esm(() => {
  init_canonical();
  init_contract();
  init_graph();
  init_ontology();
  init_operation();
  OH_SYNC_BUNDLE_KEYS_V1 = [
    "bundleSha256",
    "contractSha256",
    "operations",
    "protocol",
    "spaceId",
    "v"
  ];
  OH_SYNC_HEAD_KEYS_V1 = ["operationSha256", "sequence", "v"];
  OH_OPERATION_KEYS_V1 = [
    "actorId",
    "changes",
    "contractId",
    "graphRevisionSha256",
    "instant",
    "operationId",
    "operationSha256",
    "parentOperationSha256",
    "recordsSha256",
    "sequence",
    "spaceId",
    "v"
  ];
  OH_PUT_CHANGE_KEYS_V1 = ["kind", "record", "v"];
  OH_TOMBSTONE_CHANGE_KEYS_V1 = ["key", "kind", "priorSha256", "v"];
  OH_RECORD_KEYS_V1 = ["dependencies", "key", "kind", "recordSha256", "v", "value"];
  OH_SYNC_INGRESS_VALUE_NODES_V1 = OH_GRAPH_LIMITS_V1.recordBytes;
  OH_SYNC_INGRESS_OPERATION_DEPTH_V1 = OH_SYNC_INGRESS_VALUE_DEPTH_V1 + 4;
  OH_SYNC_INGRESS_OPERATION_NODES_V1 = OH_OPERATION_MAX_BYTES_V1;
  OH_SYNC_BUNDLE_MAX_BYTES_V1 = OH_OPERATION_MAX_BYTES_V1 + 4 * 1024;
  OH_SYNC_INGRESS_BUNDLE_NODES_V1 = OH_SYNC_INGRESS_OPERATION_NODES_V1 + 4 * 1024;
});

// src/store.ts
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
var OH_CANONICAL_STORE_PROFILE_V1, OH_WORKING_STORE_PROFILE_V1, OH_DEPENDENCY_CLOSURE_LIMITS_V1, OhPurgedSpaceError, EMPTY_RECORDS_SHA256;
var init_store = __esm(() => {
  init_canonical();
  init_contract();
  init_graph();
  init_errors();
  init_errors();
  init_operation();
  OH_CANONICAL_STORE_PROFILE_V1 = createOhStoreProfileV1({
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
  OH_WORKING_STORE_PROFILE_V1 = createOhStoreProfileV1({
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
  OH_DEPENDENCY_CLOSURE_LIMITS_V1 = Object.freeze({
    bytes: 64 * 1024 * 1024,
    records: 8192,
    roots: 1024
  });
  OhPurgedSpaceError = class OhPurgedSpaceError extends Error {
    receipt;
    constructor(receipt) {
      super(`Oh space ${receipt.spaceId} was purged at ${receipt.purgedAt}.`);
      this.name = "OhPurgedSpaceError";
      this.receipt = receipt;
    }
  };
  EMPTY_RECORDS_SHA256 = canonicalSha256([]);
});

// src/sqlite/runtime.ts
function macosSqliteLibraryCandidates() {
  return MACOS_SQLITE_LIBRARY_CANDIDATES;
}
function createOhSqliteRuntime(dependencies) {
  let customLibrary = null;
  if (dependencies.platform === "darwin") {
    for (const candidate of macosSqliteLibraryCandidates()) {
      if (!dependencies.exists(candidate))
        continue;
      try {
        if (!dependencies.setCustomSQLite(candidate))
          continue;
        customLibrary = candidate;
        break;
      } catch {}
    }
  }
  return Object.freeze({
    customLibrary,
    open: (path) => dependencies.open(path, { create: true, strict: true })
  });
}
var MACOS_SQLITE_LIBRARY_CANDIDATES;
var init_runtime = __esm(() => {
  MACOS_SQLITE_LIBRARY_CANDIDATES = Object.freeze([
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib"
  ]);
});

// src/sqlite/driver.ts
import { existsSync } from "fs";
import { Database } from "bun:sqlite";
function openOhSqliteDatabase(path) {
  const database = SQLITE_RUNTIME.open(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA trusted_schema = OFF");
  return database;
}
function withImmediateTransaction(database, work) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}
function withReadTransaction(database, work) {
  database.exec("BEGIN");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}
var SQLITE_RUNTIME;
var init_driver = __esm(() => {
  init_runtime();
  SQLITE_RUNTIME = createOhSqliteRuntime({
    exists: existsSync,
    open: (path, options) => new Database(path, options),
    platform: process.platform,
    setCustomSQLite: (path) => Database.setCustomSQLite(path)
  });
});

// src/sqlite/store.ts
import { mkdirSync } from "fs";
import { dirname } from "path";
function parseStoredOperationRow(row, expected = {}) {
  let value;
  try {
    value = JSON.parse(row.operation_json);
  } catch {
    throw new OhIntegrityError("A stored operation is not JSON.");
  }
  const operation = parseOhOperationV1(value);
  if (operation === null || canonicalJson(operation) !== row.operation_json || row.operation_sha256 !== operation.operationSha256 || row.space_id !== operation.spaceId || row.sequence !== operation.sequence || row.operation_id !== operation.operationId || row.parent_operation_sha256 !== operation.parentOperationSha256 || row.graph_revision_sha256 !== operation.graphRevisionSha256 || row.records_sha256 !== operation.recordsSha256 || row.instant !== operation.instant || expected.spaceId !== undefined && operation.spaceId !== expected.spaceId || expected.operationId !== undefined && operation.operationId !== expected.operationId || expected.operationSha256 !== undefined && operation.operationSha256 !== expected.operationSha256) {
    throw new OhIntegrityError("Stored operation columns do not match their canonical envelope.");
  }
  return operation;
}
function parseStoredBindingRow(row, expectedSpaceId) {
  let value;
  try {
    value = JSON.parse(row.binding_json);
  } catch {
    throw new OhIntegrityError("A store binding is not JSON.");
  }
  const binding = parseOhStoreBindingV1(value);
  if (binding === null || canonicalJson(binding) !== row.binding_json || binding.spaceId !== expectedSpaceId || row.space_id !== binding.spaceId || row.realm_id !== binding.realmId || row.profile_id !== binding.profile.profileId || row.profile_kind !== binding.profile.profileKind || row.profile_sha256 !== binding.profile.profileSha256 || row.binding_sha256 !== binding.bindingSha256) {
    throw new OhIntegrityError("Stored binding columns do not match their canonical envelope.");
  }
  return binding;
}
function parseStoredPurgeRow(row, expectedSpaceId) {
  let value;
  try {
    value = JSON.parse(row.receipt_json);
  } catch {
    throw new OhIntegrityError("A purge receipt is not JSON.");
  }
  const receipt = parseOhSpacePurgeReceiptV1(value);
  if (receipt === null || canonicalJson(receipt) !== row.receipt_json || receipt.spaceId !== expectedSpaceId || row.space_id !== receipt.spaceId || row.binding_sha256 !== receipt.bindingSha256 || row.prior_operation_sha256 !== receipt.priorHead.operationSha256 || row.prior_sequence !== receipt.priorHead.sequence || row.purged_at !== receipt.purgedAt || row.receipt_sha256 !== receipt.receiptSha256) {
    throw new OhIntegrityError("Stored purge columns do not match their canonical receipt.");
  }
  return receipt;
}
function parseHead(row) {
  const operationSha256 = row.head_operation_sha256 === null ? null : parseSha256Hex(row.head_operation_sha256);
  const graphRevisionSha256 = row.graph_revision_sha256 === null ? null : parseSha256Hex(row.graph_revision_sha256);
  const recordsSha256 = parseSha256Hex(row.records_sha256);
  if (row.head_operation_sha256 !== null && operationSha256 === null || row.graph_revision_sha256 !== null && graphRevisionSha256 === null || recordsSha256 === null) {
    throw new OhIntegrityError("The stored space head contains an invalid digest.");
  }
  return {
    generation: row.generation,
    graphRevisionSha256,
    operationSha256,
    recordsSha256,
    sequence: row.sequence,
    v: 1
  };
}
function extractSearchText(value, maximumBytes = 1024 * 1024) {
  const parts = [];
  let bytes = 0;
  const visit = (candidate, depth) => {
    if (depth > 32 || bytes >= maximumBytes)
      return;
    if (typeof candidate === "string") {
      const remaining = maximumBytes - bytes;
      const text = Buffer.from(candidate, "utf8").subarray(0, remaining).toString("utf8");
      if (text.length > 0) {
        parts.push(text);
        bytes += Buffer.byteLength(text, "utf8") + 1;
      }
    } else if (typeof candidate === "number" || typeof candidate === "boolean") {
      const text = String(candidate);
      parts.push(text);
      bytes += text.length + 1;
    } else if (Array.isArray(candidate)) {
      for (const item of candidate)
        visit(item, depth + 1);
    } else if (candidate !== null) {
      for (const [key, item] of Object.entries(candidate)) {
        parts.push(key);
        bytes += key.length + 1;
        visit(item, depth + 1);
      }
    }
  };
  visit(value, 0);
  return parts.join(" ").normalize("NFC");
}
function normalizeLimit(value, fallback = 50, maximum = 1000) {
  if (value === undefined)
    return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`limit must be an integer from 1 through ${maximum}.`);
  }
  return value;
}
function exactHeadRef(left, right) {
  return left.sequence === right.sequence && left.operationSha256 === right.operationSha256;
}
function ftsQuery(value) {
  const normalized = boundedText(value.normalize("NFC"), 4096);
  if (normalized === null)
    return null;
  const tokens = normalized.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}/gu)?.slice(0, 16) ?? [];
  return tokens.length === 0 ? null : tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
}

class OhSqliteStore {
  database;
  spaceId;
  #closed = false;
  constructor(options = {}) {
    const spaceId = safeCode(options.spaceId ?? "default");
    if (spaceId === null)
      throw new TypeError("Invalid space ID.");
    if (options.database !== undefined && options.path !== undefined) {
      throw new TypeError("Pass either a database or a path, not both.");
    }
    const path = options.path ?? "oh.sqlite";
    if (options.database === undefined && path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true });
    this.database = options.database ?? openOhSqliteDatabase(path);
    this.spaceId = spaceId;
    applyOhSqliteMigrations(this.database);
    this.#registerContract();
    this.ensureSpace();
  }
  #assertOpen() {
    if (this.#closed)
      throw new Error("The Oh store is closed.");
  }
  #assertOperationReplication() {
    const binding = this.binding();
    if (binding !== null && !binding.profile.capabilities.operationReplication) {
      throw new OhProfileError("This bound store profile forbids operation replication.");
    }
  }
  #registerContract() {
    const manifestJson = canonicalJson(OH_CONTRACT_MANIFEST_V1);
    this.database.query(`INSERT INTO oh_contracts(contract_id, contract_sha256, manifest_json, created_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(contract_id) DO NOTHING`).run(OH_CONTRACT_ID_V1, OH_CONTRACT_MANIFEST_V1.contractSha256, manifestJson, canonicalNow());
    const existing = this.database.query("SELECT contract_sha256, manifest_json FROM oh_contracts WHERE contract_id = ?").get(OH_CONTRACT_ID_V1);
    if (existing === null || existing.contract_sha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256 || existing.manifest_json !== manifestJson) {
      throw new OhIntegrityError("The stored contract manifest differs from this runtime.");
    }
  }
  ensureSpace() {
    this.#assertOpen();
    return withImmediateTransaction(this.database, () => {
      const purged = this.database.query(`SELECT ${PURGE_COLUMNS} FROM oh_space_purges WHERE space_id = ?`).get(this.spaceId);
      if (purged !== null) {
        throw new OhPurgedSpaceError(parseStoredPurgeRow(purged, this.spaceId));
      }
      const now = canonicalNow();
      this.database.query(`INSERT INTO oh_spaces(
        space_id, contract_id, generation, head_operation_sha256, graph_revision_sha256,
        records_sha256, sequence, created_at, updated_at
      ) VALUES (?, ?, 0, NULL, NULL, ?, 0, ?, ?) ON CONFLICT(space_id) DO NOTHING`).run(this.spaceId, OH_CONTRACT_ID_V1, EMPTY_RECORDS_SHA2562, now, now);
      return this.head();
    });
  }
  bind(bindingValue) {
    this.#assertOpen();
    const binding = parseOhStoreBindingV1(bindingValue);
    if (binding === null || binding.spaceId !== this.spaceId) {
      throw new OhProfileError("The store binding does not identify this space.");
    }
    const bindingJson = canonicalJson(binding);
    this.database.query(`INSERT INTO oh_space_bindings(
      space_id, realm_id, profile_id, profile_kind, profile_sha256,
      binding_sha256, binding_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(space_id) DO NOTHING`).run(this.spaceId, binding.realmId, binding.profile.profileId, binding.profile.profileKind, binding.profile.profileSha256, binding.bindingSha256, bindingJson, canonicalNow());
    const row = this.database.query(`SELECT ${BINDING_COLUMNS} FROM oh_space_bindings WHERE space_id = ?`).get(this.spaceId);
    if (row === null)
      throw new OhIntegrityError("The persisted store binding disappeared.");
    const persisted = parseStoredBindingRow(row, this.spaceId);
    if (canonicalJson(persisted) !== bindingJson) {
      throw new OhProfileError("The space is already bound to a different realm or profile.");
    }
    return binding;
  }
  binding() {
    this.#assertOpen();
    const row = this.database.query(`SELECT ${BINDING_COLUMNS} FROM oh_space_bindings WHERE space_id = ?`).get(this.spaceId);
    if (row === null)
      return null;
    return parseStoredBindingRow(row, this.spaceId);
  }
  head() {
    this.#assertOpen();
    const row = this.database.query(`SELECT generation, graph_revision_sha256,
      head_operation_sha256, records_sha256, sequence FROM oh_spaces WHERE space_id = ?`).get(this.spaceId);
    if (row === null)
      throw new OhIntegrityError("The requested space does not exist.");
    return parseHead(row);
  }
  #loadRecords() {
    const rows = this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? ORDER BY record_key").all(this.spaceId);
    const records = new Map;
    for (const row of rows) {
      let value;
      try {
        value = JSON.parse(row.record_json);
      } catch {
        throw new OhIntegrityError("A stored record is not JSON.");
      }
      if (canonicalJson(value) !== row.record_json)
        throw new OhIntegrityError("A stored record is not canonical JSON.");
      const record = parseKnowledgeGraphRecordV1(value);
      if (record === null || records.has(record.key))
        throw new OhIntegrityError("A stored graph record is invalid.");
      records.set(record.key, record);
    }
    return records;
  }
  #transition(head, changes, operationId, records = this.#loadRecords()) {
    for (const change of changes) {
      if (change.kind === "put") {
        records.set(change.record.key, change.record);
      } else {
        const prior = records.get(change.key);
        if (prior === undefined || prior.recordSha256 !== change.priorSha256) {
          throw new OhConflictError(`The prior digest for ${change.key} does not match the current record.`);
        }
        records.delete(change.key);
      }
    }
    if (records.size > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
      throw new RangeError("Graph transition exceeds its record snapshot limit.");
    }
    for (const record of records.values()) {
      for (const dependency of record.dependencies) {
        if (!records.has(dependency))
          throw new OhDependencyError(`Missing dependency ${dependency} for ${record.key}.`);
      }
    }
    const refs = [...records.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(knowledgeGraphRecordRefV1);
    const recordsSha256 = canonicalSha256(refs);
    const graphRevisionSha256 = graphRevisionSha256V1({
      changes,
      operationId,
      parentGraphRevisionSha256: head.graphRevisionSha256,
      recordsSha256,
      revision: head.sequence + 1
    });
    return { graphRevisionSha256, records, recordsSha256 };
  }
  #assertCurrentHeadAuthority(head) {
    const summary = this.database.query(`SELECT count(*) AS count, min(sequence) AS minimum, max(sequence) AS maximum
       FROM oh_operations WHERE space_id = ?`).get(this.spaceId);
    if (summary === null || summary.count !== head.sequence || head.sequence === 0 && (summary.minimum !== null || summary.maximum !== null) || head.sequence > 0 && (summary.minimum !== 1 || summary.maximum !== head.sequence)) {
      throw new OhIntegrityError("The operation history does not exactly cover the current space head.");
    }
    if (head.sequence === 0)
      return;
    if (head.operationSha256 === null)
      throw new OhIntegrityError("A nonempty space head has no operation digest.");
    const row = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations WHERE space_id = ? AND sequence = ?`).get(this.spaceId, head.sequence);
    if (row === null)
      throw new OhIntegrityError("The current space head operation is missing.");
    const operation = parseStoredOperationRow(row, {
      spaceId: this.spaceId,
      operationSha256: head.operationSha256
    });
    if (operation.sequence !== head.sequence || operation.graphRevisionSha256 !== head.graphRevisionSha256 || operation.recordsSha256 !== head.recordsSha256) {
      throw new OhIntegrityError("The current space head differs from its canonical operation.");
    }
  }
  #assertOperationReachable(operation, head) {
    if (operation.sequence < 1 || operation.sequence > head.sequence) {
      throw new OhIntegrityError("A stored idempotent operation is not reachable from the current head.");
    }
    const rows = this.database.query(`SELECT ${OPERATION_COLUMNS}
      FROM oh_operations WHERE space_id = ? AND sequence >= ? AND sequence <= ? ORDER BY sequence`).all(this.spaceId, operation.sequence, head.sequence);
    if (rows.length !== head.sequence - operation.sequence + 1) {
      throw new OhIntegrityError("A stored idempotent operation has an incomplete path to the current head.");
    }
    let priorSha256 = operation.parentOperationSha256;
    for (let index = 0;index < rows.length; index += 1) {
      const row = rows[index];
      if (row === undefined) {
        throw new OhIntegrityError("A stored idempotent operation is not on the current authority chain.");
      }
      const reachable = parseStoredOperationRow(row, { spaceId: this.spaceId });
      if (reachable.sequence !== operation.sequence + index || reachable.parentOperationSha256 !== priorSha256 || index === 0 && reachable.operationSha256 !== operation.operationSha256) {
        throw new OhIntegrityError("A stored idempotent operation is not on the current authority chain.");
      }
      priorSha256 = reachable.operationSha256;
    }
    if (priorSha256 !== head.operationSha256) {
      throw new OhIntegrityError("A stored idempotent operation does not reach the current head digest.");
    }
  }
  #persist(operation) {
    this.database.query(`INSERT INTO oh_operations(operation_sha256, space_id, sequence,
      operation_id, parent_operation_sha256, graph_revision_sha256, records_sha256,
      operation_json, instant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(operation.operationSha256, this.spaceId, operation.sequence, operation.operationId, operation.parentOperationSha256, operation.graphRevisionSha256, operation.recordsSha256, canonicalJson(operation), operation.instant);
    const changedKeys = operation.changes.map((change) => change.kind === "put" ? change.record.key : change.key);
    const deleteDependencies = this.database.query("DELETE FROM oh_dependencies WHERE space_id = ? AND record_key = ?");
    for (const key of changedKeys)
      deleteDependencies.run(this.spaceId, key);
    const insertOperationRecord = this.database.query(`INSERT INTO oh_operation_records(
      operation_sha256, ordinal, record_key, change_kind, record_sha256) VALUES (?, ?, ?, ?, ?)`);
    const upsertRecord = this.database.query(`INSERT INTO oh_records(space_id, record_key, kind,
      record_sha256, record_json, operation_sha256, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id, record_key) DO UPDATE SET kind = excluded.kind,
      record_sha256 = excluded.record_sha256, record_json = excluded.record_json,
      operation_sha256 = excluded.operation_sha256, sequence = excluded.sequence`);
    const deleteRecord = this.database.query("DELETE FROM oh_records WHERE space_id = ? AND record_key = ?");
    const deleteSearch = this.database.query("DELETE FROM oh_search_documents WHERE space_id = ? AND record_key = ?");
    const deleteFts = this.database.query("DELETE FROM oh_search_fts WHERE space_id = ? AND record_key = ?");
    const upsertSearch = this.database.query(`INSERT INTO oh_search_documents(space_id, record_key,
      record_sha256, text) VALUES (?, ?, ?, ?) ON CONFLICT(space_id, record_key) DO UPDATE SET
      record_sha256 = excluded.record_sha256, text = excluded.text`);
    const insertFts = this.database.query("INSERT INTO oh_search_fts(space_id, record_key, text) VALUES (?, ?, ?)");
    for (const [ordinal, change] of operation.changes.entries()) {
      const key = change.kind === "put" ? change.record.key : change.key;
      const digest = change.kind === "put" ? change.record.recordSha256 : change.priorSha256;
      insertOperationRecord.run(operation.operationSha256, ordinal, key, change.kind, digest);
      deleteFts.run(this.spaceId, key);
      deleteSearch.run(this.spaceId, key);
      if (change.kind === "put") {
        const recordJson = canonicalJson(change.record);
        upsertRecord.run(this.spaceId, key, change.record.kind, change.record.recordSha256, recordJson, operation.operationSha256, operation.sequence);
        const text = `${key} ${change.record.kind} ${extractSearchText(change.record.value)}`;
        upsertSearch.run(this.spaceId, key, change.record.recordSha256, text);
        insertFts.run(this.spaceId, key, text);
      } else
        deleteRecord.run(this.spaceId, key);
    }
    const insertDependency = this.database.query("INSERT INTO oh_dependencies(space_id, record_key, dependency_key) VALUES (?, ?, ?)");
    for (const change of operation.changes) {
      if (change.kind === "put") {
        for (const dependency of change.record.dependencies)
          insertDependency.run(this.spaceId, change.record.key, dependency);
      }
    }
    this.database.query("INSERT INTO oh_sync_outbox(space_id, sequence, operation_sha256) VALUES (?, ?, ?)").run(this.spaceId, operation.sequence, operation.operationSha256);
    const updated = this.database.query(`UPDATE oh_spaces SET generation = ?, head_operation_sha256 = ?,
      graph_revision_sha256 = ?, records_sha256 = ?, sequence = ?, updated_at = ?
      WHERE space_id = ? AND generation = ? AND head_operation_sha256 IS ?`).run(operation.sequence, operation.operationSha256, operation.graphRevisionSha256, operation.recordsSha256, operation.sequence, operation.instant, this.spaceId, operation.sequence - 1, operation.parentOperationSha256);
    if (updated.changes !== 1)
      throw new OhConflictError("The space head changed while committing.");
  }
  commit(input) {
    this.#assertOpen();
    const actorId = safeCode(input.actorId);
    const operationId = safeCode(input.operationId);
    const maximumOperationBytes = input.maximumOperationBytes ?? OH_OPERATION_MAX_BYTES_V1;
    if (actorId === null || operationId === null || !Number.isSafeInteger(maximumOperationBytes) || maximumOperationBytes < 1 || maximumOperationBytes > OH_OPERATION_MAX_BYTES_V1) {
      throw new TypeError("Invalid actor, operation ID, or operation byte bound.");
    }
    const changes = canonicalKnowledgeGraphChangesV1(input.changes);
    if (changes.length === 0 || changes.length > 8192)
      throw new TypeError("A commit needs 1 through 8192 changes.");
    return withImmediateTransaction(this.database, () => {
      const head = this.head();
      this.#assertCurrentHeadAuthority(head);
      const duplicate = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations WHERE space_id = ? AND operation_id = ?`).get(this.spaceId, operationId);
      if (duplicate !== null) {
        const existing = parseStoredOperationRow(duplicate, { operationId, spaceId: this.spaceId });
        this.#assertOperationReachable(existing, head);
        if (existing.actorId !== actorId || canonicalJson(existing.changes) !== canonicalJson(changes)) {
          throw new OhConflictError("The operation ID is already bound to different content.");
        }
        const operationBytes = Buffer.byteLength(canonicalJson(existing), "utf8");
        if (operationBytes > maximumOperationBytes) {
          throw new OhOperationSizeError(operationBytes, maximumOperationBytes);
        }
        return existing;
      }
      if (head.generation !== input.expectedHead.generation || head.operationSha256 !== input.expectedHead.operationSha256) {
        throw new OhConflictError("The expected head does not match the current space head.");
      }
      const transition = this.#transition(head, changes, operationId);
      const operation = createOhOperationV1({
        actorId,
        changes,
        contractId: OH_CONTRACT_ID_V1,
        graphRevisionSha256: transition.graphRevisionSha256,
        instant: input.instant ?? canonicalNow(),
        operationId,
        parentOperationSha256: head.operationSha256,
        recordsSha256: transition.recordsSha256,
        sequence: head.sequence + 1,
        spaceId: this.spaceId,
        v: 1
      }, {
        maximumOperationBytes
      });
      this.#persist(operation);
      return operation;
    });
  }
  importOperation(value) {
    this.#assertOpen();
    this.#assertOperationReplication();
    const operation = parseOhOperationV1(value);
    if (operation === null || operation.spaceId !== this.spaceId)
      throw new OhIntegrityError("Invalid imported operation.");
    const result = this.importOperations({
      expectedHead: {
        operationSha256: operation.parentOperationSha256,
        sequence: operation.sequence - 1
      },
      operations: [operation]
    });
    return { imported: result.imported === 1, operation };
  }
  importOperations(input) {
    this.#assertOpen();
    this.#assertOperationReplication();
    const expectedHead = parseOhHeadRefV1(input.expectedHead);
    if (expectedHead === null || !Array.isArray(input.operations) || input.operations.length > 1000) {
      throw new TypeError("Invalid operation import interval.");
    }
    const operations = input.operations.map((value) => {
      const operation = parseOhOperationV1(value);
      if (operation === null || operation.spaceId !== this.spaceId) {
        throw new OhIntegrityError("Invalid imported operation.");
      }
      return operation;
    });
    let prior = expectedHead;
    for (const operation of operations) {
      if (operation.sequence !== prior.sequence + 1 || operation.parentOperationSha256 !== prior.operationSha256) {
        throw new OhConflictError("Imported operations do not extend the expected head.");
      }
      prior = { operationSha256: operation.operationSha256, sequence: operation.sequence };
    }
    return withImmediateTransaction(this.database, () => {
      const current = this.head();
      this.#assertCurrentHeadAuthority(current);
      this.#headAt(expectedHead);
      if (!exactHeadRef(current, expectedHead)) {
        if (operations.length === 0 || current.sequence < prior.sequence) {
          throw new OhConflictError("The imported operation interval does not extend the local head.");
        }
        for (const operation of operations) {
          const row = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations WHERE space_id = ? AND sequence = ?`).get(this.spaceId, operation.sequence);
          if (row === null)
            throw new OhIntegrityError("An imported replay is missing from the authority chain.");
          const existing = parseStoredOperationRow(row, { spaceId: this.spaceId });
          if (existing.operationSha256 !== operation.operationSha256) {
            throw new OhConflictError("The imported operation interval diverges from the local authority chain.");
          }
          if (canonicalJson(existing) !== canonicalJson(operation)) {
            throw new OhIntegrityError("An operation digest is bound to different bytes.");
          }
        }
        this.#assertOperationReachable(operations[operations.length - 1], current);
        return { head: current, imported: 0, status: "already-present", v: 1 };
      }
      if (operations.length === 0) {
        return { head: current, imported: 0, status: "already-present", v: 1 };
      }
      const records = this.#loadRecords();
      let head = current;
      for (const operation of operations) {
        const duplicate = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations WHERE space_id = ? AND operation_id = ?`).get(this.spaceId, operation.operationId);
        if (duplicate !== null) {
          throw new OhConflictError("An imported operation ID is already bound on the local authority chain.");
        }
        const transition = this.#transition(head, operation.changes, operation.operationId, records);
        if (transition.recordsSha256 !== operation.recordsSha256 || transition.graphRevisionSha256 !== operation.graphRevisionSha256) {
          throw new OhIntegrityError("An imported operation does not reproduce its declared graph head.");
        }
        this.#persist(operation);
        head = {
          generation: operation.sequence,
          graphRevisionSha256: operation.graphRevisionSha256,
          operationSha256: operation.operationSha256,
          recordsSha256: operation.recordsSha256,
          sequence: operation.sequence,
          v: 1
        };
      }
      return { head, imported: operations.length, status: "imported", v: 1 };
    });
  }
  exportOperations(afterSequence = 0, limit = 1000) {
    this.#assertOpen();
    this.#assertOperationReplication();
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0)
      throw new RangeError("afterSequence must be nonnegative.");
    const boundedLimit = normalizeLimit(limit);
    const rows = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations
       WHERE space_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`).all(this.spaceId, afterSequence, boundedLimit);
    return rows.map((row) => parseStoredOperationRow(row, { spaceId: this.spaceId }));
  }
  #headAt(reference) {
    const parsed = parseOhHeadRefV1(reference);
    if (parsed === null)
      throw new TypeError("Invalid Oh head reference.");
    if (parsed.sequence === 0)
      return emptyOhHeadV1();
    const row = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations WHERE space_id = ? AND sequence = ?`).get(this.spaceId, parsed.sequence);
    if (row === null)
      throw new OhConflictError("The requested head is not present in this space.");
    const operation = parseStoredOperationRow(row, { spaceId: this.spaceId });
    if (operation.spaceId !== this.spaceId || operation.sequence !== parsed.sequence || operation.operationSha256 !== parsed.operationSha256) {
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
  snapshotAtHead(options = {}) {
    this.#assertOpen();
    const maximumRecords = options.maximumRecords ?? OH_GRAPH_LIMITS_V1.recordsPerSnapshot;
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
      throw new RangeError(`maximumRecords must be an integer from 1 through ${OH_GRAPH_LIMITS_V1.recordsPerSnapshot}.`);
    }
    return withReadTransaction(this.database, () => {
      const current = this.head();
      const target = options.head === undefined ? current : this.#headAt(options.head);
      if (target.sequence > current.sequence)
        throw new OhConflictError("The requested head is ahead of this space.");
      const rows = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations
         WHERE space_id = ? AND sequence <= ? ORDER BY sequence`).all(this.spaceId, target.sequence);
      const operations = rows.map((row) => parseStoredOperationRow(row, { spaceId: this.spaceId }));
      const snapshot = replayOhOperationsV1(this.spaceId, operations, maximumRecords);
      if (snapshot.head.operationSha256 !== target.operationSha256 || snapshot.head.recordsSha256 !== target.recordsSha256) {
        throw new OhIntegrityError("Operation replay does not reproduce the requested head.");
      }
      return snapshot;
    });
  }
  changesSince(fromValue, options = {}) {
    this.#assertOpen();
    const from = parseOhHeadRefV1(fromValue);
    if (from === null)
      throw new TypeError("Invalid change-feed cursor.");
    const limit = normalizeLimit(options.limit, 100, 1000);
    return withReadTransaction(this.database, () => {
      const current = this.head();
      const fromHead = this.#headAt(from);
      const through = options.through === undefined ? current : this.#headAt(options.through);
      if (fromHead.sequence > through.sequence || through.sequence > current.sequence) {
        throw new OhConflictError("The change-feed bounds do not identify one local history prefix.");
      }
      const rows = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations
         WHERE space_id = ? AND sequence > ? AND sequence <= ?
         ORDER BY sequence LIMIT ?`).all(this.spaceId, fromHead.sequence, through.sequence, limit + 1);
      const parsed = rows.map((row) => parseStoredOperationRow(row, { spaceId: this.spaceId }));
      if (parsed.length > limit + 1)
        throw new OhIntegrityError("The change feed exceeded its requested page bound.");
      const hasMore = parsed.length > limit;
      const operations = parsed.slice(0, limit);
      let prior = fromHead;
      for (const operation of parsed) {
        if (operation.sequence !== prior.sequence + 1 || operation.parentOperationSha256 !== prior.operationSha256) {
          throw new OhIntegrityError("The change feed contains a gap or fork.");
        }
        prior = { operationSha256: operation.operationSha256, sequence: operation.sequence };
      }
      if (!hasMore && (prior.sequence !== through.sequence || prior.operationSha256 !== through.operationSha256)) {
        throw new OhIntegrityError("The change feed does not reach its pinned through head.");
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
    });
  }
  exportDependencyClosure(input) {
    const binding = parseOhStoreBindingV1(input.binding);
    if (binding === null || binding.spaceId !== this.spaceId || canonicalJson(this.binding()) !== canonicalJson(binding)) {
      throw new OhProfileError("Dependency closure export requires the exact persisted store binding.");
    }
    if (!binding.profile.capabilities.dependencyClosureExport) {
      throw new OhProfileError("This store profile does not permit dependency-closure export.");
    }
    const snapshot = this.snapshotAtHead({
      ...input.head === undefined ? {} : { head: input.head },
      ...input.maximumRecords === undefined ? {} : { maximumRecords: input.maximumRecords }
    });
    return createOhDependencyClosureV1({
      binding,
      ...input.maximumRecords === undefined ? {} : { maximumRecords: input.maximumRecords },
      roots: input.roots,
      snapshot
    });
  }
  get(key) {
    this.#assertOpen();
    const parsedKey = safeCode(key, 512);
    if (parsedKey === null)
      throw new TypeError("Invalid record key.");
    const row = this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? AND record_key = ?").get(this.spaceId, parsedKey);
    if (row === null)
      return null;
    const record = parseKnowledgeGraphRecordV1(JSON.parse(row.record_json));
    if (record === null || canonicalJson(record) !== row.record_json)
      throw new OhIntegrityError("The stored record is invalid.");
    return record;
  }
  list(options = {}) {
    this.#assertOpen();
    const limit = normalizeLimit(options.limit);
    const rows = options.kind === undefined ? this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? ORDER BY record_key LIMIT ?").all(this.spaceId, limit) : this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? AND kind = ? ORDER BY record_key LIMIT ?").all(this.spaceId, options.kind, limit);
    return rows.map((row) => {
      const record = parseKnowledgeGraphRecordV1(JSON.parse(row.record_json));
      if (record === null || canonicalJson(record) !== row.record_json) {
        throw new OhIntegrityError("The stored record is invalid.");
      }
      return record;
    });
  }
  snapshotRecords(maximum = OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
    this.#assertOpen();
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > OH_GRAPH_LIMITS_V1.recordsPerSnapshot) {
      throw new RangeError(`maximum must be an integer from 1 through ${OH_GRAPH_LIMITS_V1.recordsPerSnapshot}.`);
    }
    const count = this.database.query("SELECT count(*) AS count FROM oh_records WHERE space_id = ?").get(this.spaceId)?.count ?? 0;
    if (count > maximum)
      throw new RangeError(`The graph contains ${count} records, above the requested snapshot bound.`);
    return this.database.query("SELECT record_json FROM oh_records WHERE space_id = ? ORDER BY record_key").all(this.spaceId).map((row) => {
      const record = parseKnowledgeGraphRecordV1(JSON.parse(row.record_json));
      if (record === null || canonicalJson(record) !== row.record_json) {
        throw new OhIntegrityError("The stored record is invalid.");
      }
      return record;
    });
  }
  log(limit = 50) {
    this.#assertOpen();
    const rows = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations
       WHERE space_id = ? ORDER BY sequence DESC LIMIT ?`).all(this.spaceId, normalizeLimit(limit));
    return rows.map((row) => parseStoredOperationRow(row, { spaceId: this.spaceId }));
  }
  searchKeyword(query, limit = 20) {
    this.#assertOpen();
    const match = ftsQuery(query);
    if (match === null)
      return [];
    const rows = this.database.query(`SELECT r.record_key,
      r.kind, r.record_sha256, bm25(oh_search_fts) AS rank,
      snippet(oh_search_fts, 2, '', '', ' \u2026 ', 24) AS snippet
      FROM oh_search_fts JOIN oh_records r
      ON r.space_id = oh_search_fts.space_id AND r.record_key = oh_search_fts.record_key
      WHERE oh_search_fts MATCH ? AND oh_search_fts.space_id = ?
      ORDER BY rank, r.record_key LIMIT ?`).all(match, this.spaceId, normalizeLimit(limit, 20, 100));
    return rows.map((row) => {
      const digest = parseSha256Hex(row.record_sha256);
      if (digest === null)
        throw new OhIntegrityError("Search returned an invalid record digest.");
      return {
        key: row.record_key,
        kind: row.kind,
        recordSha256: digest,
        score: 1 / (1 + Math.max(0, row.rank)),
        snippet: row.snippet,
        v: 1
      };
    });
  }
  syncState(remoteId) {
    this.#assertOpen();
    const id = safeCode(remoteId);
    if (id === null)
      throw new TypeError("Invalid remote ID.");
    const row = this.database.query("SELECT pulled_sequence, pushed_sequence, remote_head_sha256 FROM oh_sync_state WHERE remote_id = ? AND space_id = ?").get(id, this.spaceId);
    const digest = row?.remote_head_sha256 === null || row === null ? null : parseSha256Hex(row.remote_head_sha256);
    if (row !== null && row.remote_head_sha256 !== null && digest === null)
      throw new OhIntegrityError("Invalid remote head digest.");
    return { pulledSequence: row?.pulled_sequence ?? 0, pushedSequence: row?.pushed_sequence ?? 0, remoteHeadSha256: digest };
  }
  updateSyncState(remoteId, state) {
    this.#assertOpen();
    const id = safeCode(remoteId);
    if (id === null || !Number.isSafeInteger(state.pulledSequence) || state.pulledSequence < 0 || !Number.isSafeInteger(state.pushedSequence) || state.pushedSequence < 0)
      throw new TypeError("Invalid sync state.");
    this.database.query(`INSERT INTO oh_sync_state(remote_id, space_id, pulled_sequence,
      pushed_sequence, remote_head_sha256, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(remote_id, space_id) DO UPDATE SET pulled_sequence = excluded.pulled_sequence,
      pushed_sequence = excluded.pushed_sequence, remote_head_sha256 = excluded.remote_head_sha256,
      updated_at = excluded.updated_at`).run(id, this.spaceId, state.pulledSequence, state.pushedSequence, state.remoteHeadSha256, canonicalNow());
  }
  verifyReplay() {
    this.#assertOpen();
    const integrity = this.database.query("PRAGMA integrity_check").get();
    if (integrity?.integrity_check !== "ok")
      throw new OhIntegrityError("SQLite integrity_check failed.");
    const foreignKeyViolations = this.database.query("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length !== 0) {
      throw new OhIntegrityError("SQLite foreign_key_check failed.");
    }
    const storedCount = this.database.query("SELECT count(*) AS count FROM oh_operations WHERE space_id = ?").get(this.spaceId)?.count ?? 0;
    const operations = this.database.query(`SELECT ${OPERATION_COLUMNS} FROM oh_operations WHERE space_id = ? ORDER BY sequence`).all(this.spaceId).map((row) => parseStoredOperationRow(row, { spaceId: this.spaceId }));
    if (operations.length !== storedCount)
      throw new OhIntegrityError("Operation count changed during verification.");
    return this.#verifyOperations(operations);
  }
  #verifyOperations(operations) {
    const records = new Map;
    const materializedBy = new Map;
    const operationIds = new Set;
    let head = {
      generation: 0,
      graphRevisionSha256: null,
      operationSha256: null,
      recordsSha256: EMPTY_RECORDS_SHA2562,
      sequence: 0,
      v: 1
    };
    for (const operation of operations) {
      if (operation.spaceId !== this.spaceId || operation.sequence !== head.sequence + 1 || operation.parentOperationSha256 !== head.operationSha256 || operationIds.has(operation.operationId))
        throw new OhIntegrityError("Operation replay chain is broken.");
      operationIds.add(operation.operationId);
      for (const change of operation.changes) {
        if (change.kind === "put") {
          records.set(change.record.key, change.record);
          materializedBy.set(change.record.key, {
            operationSha256: operation.operationSha256,
            sequence: operation.sequence
          });
        } else {
          const prior = records.get(change.key);
          if (prior?.recordSha256 !== change.priorSha256)
            throw new OhIntegrityError("Replay tombstone does not match its prior record.");
          records.delete(change.key);
          materializedBy.delete(change.key);
        }
      }
      for (const record of records.values()) {
        if (record.dependencies.some((dependency) => !records.has(dependency)))
          throw new OhIntegrityError("Replay has a missing dependency.");
      }
      const refs = [...records.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(knowledgeGraphRecordRefV1);
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
    const storedRows = this.database.query(`SELECT record_key, kind, record_sha256, record_json, operation_sha256, sequence
       FROM oh_records WHERE space_id = ? ORDER BY record_key`).all(this.spaceId);
    if (storedRows.length !== records.size || storedRows.some((row) => {
      const record = records.get(row.record_key);
      const provenance = materializedBy.get(row.record_key);
      return record === undefined || record.kind !== row.kind || record.recordSha256 !== row.record_sha256 || canonicalJson(record) !== row.record_json || provenance === undefined || provenance.operationSha256 !== row.operation_sha256 || provenance.sequence !== row.sequence;
    }))
      throw new OhIntegrityError("Materialized records do not match operation replay.");
    const storedDependencies = this.database.query(`SELECT record_key, dependency_key FROM oh_dependencies
      WHERE space_id = ? ORDER BY record_key, dependency_key`).all(this.spaceId);
    const expectedDependencies = [...records.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).flatMap((record) => record.dependencies.map((dependency) => ({ dependency_key: dependency, record_key: record.key })));
    if (canonicalJson(storedDependencies) !== canonicalJson(expectedDependencies)) {
      throw new OhIntegrityError("Materialized dependencies do not match operation replay.");
    }
    const expectedSearchDocuments = [...records.values()].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map((record) => ({
      record_key: record.key,
      record_sha256: record.recordSha256,
      text: `${record.key} ${record.kind} ${extractSearchText(record.value)}`
    }));
    const storedSearchDocuments = this.database.query(`SELECT record_key, record_sha256, text FROM oh_search_documents
      WHERE space_id = ? ORDER BY record_key`).all(this.spaceId);
    if (canonicalJson(storedSearchDocuments) !== canonicalJson(expectedSearchDocuments)) {
      throw new OhIntegrityError("Materialized search documents do not match operation replay.");
    }
    const expectedSearchFts = expectedSearchDocuments.map(({ record_key, text }) => ({ record_key, text }));
    const storedSearchFts = this.database.query(`SELECT record_key, text FROM oh_search_fts
      WHERE space_id = ? ORDER BY record_key, text, rowid`).all(this.spaceId);
    if (canonicalJson(storedSearchFts) !== canonicalJson(expectedSearchFts)) {
      throw new OhIntegrityError("Materialized full-text search rows do not match operation replay.");
    }
    const storedOperationRecords = this.database.query(`SELECT materialized.operation_sha256, materialized.ordinal, materialized.record_key,
        materialized.change_kind, materialized.record_sha256
      FROM oh_operation_records AS materialized
      JOIN oh_operations AS operation ON operation.operation_sha256 = materialized.operation_sha256
      WHERE operation.space_id = ? ORDER BY operation.sequence, materialized.ordinal`).all(this.spaceId);
    const expectedOperationRecords = operations.flatMap((operation) => operation.changes.map((change, ordinal) => ({
      change_kind: change.kind,
      operation_sha256: operation.operationSha256,
      ordinal,
      record_key: change.kind === "put" ? change.record.key : change.key,
      record_sha256: change.kind === "put" ? change.record.recordSha256 : change.priorSha256
    })));
    if (canonicalJson(storedOperationRecords) !== canonicalJson(expectedOperationRecords)) {
      throw new OhIntegrityError("Materialized operation records do not match operation replay.");
    }
    if (canonicalJson(head) !== canonicalJson(this.head()))
      throw new OhIntegrityError("The stored head does not match operation replay.");
    return { head, operations: operations.length, records: records.size, sqliteIntegrity: "ok", v: 1 };
  }
  contract() {
    return { manifest: OH_CONTRACT_MANIFEST_V1, sqliteSchemaVersion: OH_SQLITE_SCHEMA_VERSION };
  }
  purgeWorkingSpace(bindingValue, purgedAt = canonicalNow()) {
    this.#assertOpen();
    const binding = parseOhStoreBindingV1(bindingValue);
    if (binding === null || binding.spaceId !== this.spaceId || binding.profile.profileKind !== "working" || !binding.profile.capabilities.wholeSpacePurge) {
      throw new OhProfileError("Whole-space purge requires a bound working profile.");
    }
    return withImmediateTransaction(this.database, () => {
      const row = this.database.query(`SELECT ${BINDING_COLUMNS} FROM oh_space_bindings WHERE space_id = ?`).get(this.spaceId);
      if (row === null) {
        throw new OhProfileError("Whole-space purge requires the exact persisted store binding.");
      }
      const persistedBinding = parseStoredBindingRow(row, this.spaceId);
      if (canonicalJson(persistedBinding) !== canonicalJson(binding)) {
        throw new OhProfileError("Whole-space purge requires the exact persisted store binding.");
      }
      const receipt = createOhSpacePurgeReceiptV1({ binding, priorHead: this.head(), purgedAt });
      this.database.query(`INSERT INTO oh_space_purges(space_id, binding_sha256,
        prior_operation_sha256, prior_sequence, purged_at, receipt_sha256, receipt_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(this.spaceId, binding.bindingSha256, receipt.priorHead.operationSha256, receipt.priorHead.sequence, receipt.purgedAt, receipt.receiptSha256, canonicalJson(receipt));
      this.database.query("DELETE FROM oh_search_fts WHERE space_id = ?").run(this.spaceId);
      this.database.query("DELETE FROM oh_search_documents WHERE space_id = ?").run(this.spaceId);
      this.database.query("DELETE FROM oh_dependencies WHERE space_id = ?").run(this.spaceId);
      this.database.query(`DELETE FROM oh_operation_records WHERE operation_sha256 IN
        (SELECT operation_sha256 FROM oh_operations WHERE space_id = ?)`).run(this.spaceId);
      this.database.query("DELETE FROM oh_sync_outbox WHERE space_id = ?").run(this.spaceId);
      this.database.query("DELETE FROM oh_sync_state WHERE space_id = ?").run(this.spaceId);
      this.database.query("DELETE FROM oh_records WHERE space_id = ?").run(this.spaceId);
      this.database.query("DELETE FROM oh_operations WHERE space_id = ?").run(this.spaceId);
      this.database.query("DELETE FROM oh_space_bindings WHERE space_id = ?").run(this.spaceId);
      this.database.query("DELETE FROM oh_spaces WHERE space_id = ?").run(this.spaceId);
      const directTables = [
        "oh_spaces",
        "oh_space_bindings",
        "oh_operations",
        "oh_records",
        "oh_dependencies",
        "oh_search_documents",
        "oh_sync_outbox",
        "oh_sync_state"
      ];
      for (const table of directTables) {
        const count = this.database.query(`SELECT count(*) AS count FROM ${table} WHERE space_id = ?`).get(this.spaceId)?.count;
        if (count !== 0)
          throw new OhIntegrityError(`Space purge left rows in ${table}.`);
      }
      const operationRecords = this.database.query(`SELECT count(*) AS count
        FROM oh_operation_records AS materialized JOIN oh_operations AS operation
          ON operation.operation_sha256 = materialized.operation_sha256
        WHERE operation.space_id = ?`).get(this.spaceId)?.count;
      const searchRows = this.database.query("SELECT count(*) AS count FROM oh_search_fts WHERE space_id = ?").get(this.spaceId)?.count;
      if (operationRecords !== 0 || searchRows !== 0) {
        throw new OhIntegrityError("Space purge left derived private payload rows.");
      }
      const receiptRow = this.database.query(`SELECT ${PURGE_COLUMNS} FROM oh_space_purges WHERE space_id = ?`).get(this.spaceId);
      if (receiptRow === null || canonicalJson(parseStoredPurgeRow(receiptRow, this.spaceId)) !== canonicalJson(receipt)) {
        throw new OhIntegrityError("The stored purge receipt differs from the requested purge.");
      }
      return receipt;
    });
  }
  close() {
    if (this.#closed)
      return;
    this.database.close(false);
    this.#closed = true;
  }
}
var EMPTY_RECORDS_SHA2562, OPERATION_COLUMNS = `operation_sha256, space_id, sequence, operation_id,
  parent_operation_sha256, graph_revision_sha256, records_sha256, operation_json, instant`, BINDING_COLUMNS = `space_id, realm_id, profile_id, profile_kind, profile_sha256,
  binding_sha256, binding_json`, PURGE_COLUMNS = `space_id, binding_sha256, prior_operation_sha256, prior_sequence,
  purged_at, receipt_sha256, receipt_json`;
var init_store2 = __esm(() => {
  init_canonical();
  init_contract();
  init_graph();
  init_ontology();
  init_operation();
  init_store();
  init_driver();
  init_migrations();
  EMPTY_RECORDS_SHA2562 = canonicalSha256([]);
});

// node_modules/effect/dist/esm/Function.js
function pipe(a, ab, bc, cd, de, ef, fg, gh, hi) {
  switch (arguments.length) {
    case 1:
      return a;
    case 2:
      return ab(a);
    case 3:
      return bc(ab(a));
    case 4:
      return cd(bc(ab(a)));
    case 5:
      return de(cd(bc(ab(a))));
    case 6:
      return ef(de(cd(bc(ab(a)))));
    case 7:
      return fg(ef(de(cd(bc(ab(a))))));
    case 8:
      return gh(fg(ef(de(cd(bc(ab(a)))))));
    case 9:
      return hi(gh(fg(ef(de(cd(bc(ab(a))))))));
    default: {
      let ret = arguments[0];
      for (let i = 1;i < arguments.length; i++) {
        ret = arguments[i](ret);
      }
      return ret;
    }
  }
}
var isFunction = (input) => typeof input === "function", dual = function(arity, body) {
  if (typeof arity === "function") {
    return function() {
      if (arity(arguments)) {
        return body.apply(this, arguments);
      }
      return (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function(a, b) {
        if (arguments.length >= 2) {
          return body(a, b);
        }
        return function(self) {
          return body(self, a);
        };
      };
    case 3:
      return function(a, b, c) {
        if (arguments.length >= 3) {
          return body(a, b, c);
        }
        return function(self) {
          return body(self, a, b);
        };
      };
    case 4:
      return function(a, b, c, d) {
        if (arguments.length >= 4) {
          return body(a, b, c, d);
        }
        return function(self) {
          return body(self, a, b, c);
        };
      };
    case 5:
      return function(a, b, c, d, e) {
        if (arguments.length >= 5) {
          return body(a, b, c, d, e);
        }
        return function(self) {
          return body(self, a, b, c, d);
        };
      };
    default:
      return function() {
        if (arguments.length >= arity) {
          return body.apply(this, arguments);
        }
        const args = arguments;
        return function(self) {
          return body(self, ...args);
        };
      };
  }
}, identity = (a) => a, constant = (value) => () => value, constTrue, constFalse, constNull, constUndefined, constVoid;
var init_Function = __esm(() => {
  constTrue = /* @__PURE__ */ constant(true);
  constFalse = /* @__PURE__ */ constant(false);
  constNull = /* @__PURE__ */ constant(null);
  constUndefined = /* @__PURE__ */ constant(undefined);
  constVoid = constUndefined;
});

// node_modules/effect/dist/esm/Equivalence.js
var make = (isEquivalent) => (self, that) => self === that || isEquivalent(self, that), mapInput, array = (item) => make((self, that) => {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0;i < self.length; i++) {
    const isEq = item(self[i], that[i]);
    if (!isEq) {
      return false;
    }
  }
  return true;
});
var init_Equivalence = __esm(() => {
  init_Function();
  mapInput = /* @__PURE__ */ dual(2, (self, f) => make((x, y) => self(f(x), f(y))));
});

// node_modules/effect/dist/esm/internal/doNotation.js
var let_ = (map) => dual(3, (self, name, f) => map(self, (a) => ({
  ...a,
  [name]: f(a)
}))), bindTo = (map) => dual(2, (self, name) => map(self, (a) => ({
  [name]: a
}))), bind = (map, flatMap) => dual(3, (self, name, f) => flatMap(self, (a) => map(f(a), (b) => ({
  ...a,
  [name]: b
}))));
var init_doNotation = __esm(() => {
  init_Function();
});

// node_modules/effect/dist/esm/GlobalValue.js
var globalStoreId = `effect/GlobalValue`, globalStore, globalValue = (id, compute) => {
  if (!globalStore) {
    globalThis[globalStoreId] ??= new Map;
    globalStore = globalThis[globalStoreId];
  }
  if (!globalStore.has(id)) {
    globalStore.set(id, compute());
  }
  return globalStore.get(id);
};

// node_modules/effect/dist/esm/Predicate.js
var isString = (input) => typeof input === "string", isNumber = (input) => typeof input === "number", isBigInt = (input) => typeof input === "bigint", isFunction2, isRecordOrArray = (input) => typeof input === "object" && input !== null, isObject = (input) => isRecordOrArray(input) || isFunction2(input), hasProperty, isTagged, isNullable = (input) => input === null || input === undefined, isIterable = (input) => typeof input === "string" || hasProperty(input, Symbol.iterator), isPromiseLike = (input) => hasProperty(input, "then") && isFunction2(input.then);
var init_Predicate = __esm(() => {
  init_Function();
  isFunction2 = isFunction;
  hasProperty = /* @__PURE__ */ dual(2, (self, property) => isObject(self) && (property in self));
  isTagged = /* @__PURE__ */ dual(2, (self, tag) => hasProperty(self, "_tag") && self["_tag"] === tag);
});

// node_modules/effect/dist/esm/internal/errors.js
var getBugErrorMessage = (message) => `BUG: ${message} - please report an issue at https://github.com/Effect-TS/effect/issues`;

// node_modules/effect/dist/esm/Utils.js
class PCGRandom {
  _state;
  constructor(seedHi, seedLo, incHi, incLo) {
    if (isNullable(seedLo) && isNullable(seedHi)) {
      seedLo = Math.random() * 4294967295 >>> 0;
      seedHi = 0;
    } else if (isNullable(seedLo)) {
      seedLo = seedHi;
      seedHi = 0;
    }
    if (isNullable(incLo) && isNullable(incHi)) {
      incLo = this._state ? this._state[3] : defaultIncLo;
      incHi = this._state ? this._state[2] : defaultIncHi;
    } else if (isNullable(incLo)) {
      incLo = incHi;
      incHi = 0;
    }
    this._state = new Int32Array([0, 0, incHi >>> 0, ((incLo || 0) | 1) >>> 0]);
    this._next();
    add64(this._state, this._state[0], this._state[1], seedHi >>> 0, seedLo >>> 0);
    this._next();
    return this;
  }
  getState() {
    return [this._state[0], this._state[1], this._state[2], this._state[3]];
  }
  setState(state) {
    this._state[0] = state[0];
    this._state[1] = state[1];
    this._state[2] = state[2];
    this._state[3] = state[3] | 1;
  }
  integer(max) {
    return Math.round(this.number() * Number.MAX_SAFE_INTEGER) % max;
  }
  number() {
    const hi = (this._next() & 67108863) * 1;
    const lo = (this._next() & 134217727) * 1;
    return (hi * BIT_27 + lo) / BIT_53;
  }
  _next() {
    const oldHi = this._state[0] >>> 0;
    const oldLo = this._state[1] >>> 0;
    mul64(this._state, oldHi, oldLo, MUL_HI, MUL_LO);
    add64(this._state, this._state[0], this._state[1], this._state[2], this._state[3]);
    let xsHi = oldHi >>> 18;
    let xsLo = (oldLo >>> 18 | oldHi << 14) >>> 0;
    xsHi = (xsHi ^ oldHi) >>> 0;
    xsLo = (xsLo ^ oldLo) >>> 0;
    const xorshifted = (xsLo >>> 27 | xsHi << 5) >>> 0;
    const rot = oldHi >>> 27;
    const rot2 = (-rot >>> 0 & 31) >>> 0;
    return (xorshifted >>> rot | xorshifted << rot2) >>> 0;
  }
}
function mul64(out, aHi, aLo, bHi, bLo) {
  let c1 = (aLo >>> 16) * (bLo & 65535) >>> 0;
  let c0 = (aLo & 65535) * (bLo >>> 16) >>> 0;
  let lo = (aLo & 65535) * (bLo & 65535) >>> 0;
  let hi = (aLo >>> 16) * (bLo >>> 16) + ((c0 >>> 16) + (c1 >>> 16)) >>> 0;
  c0 = c0 << 16 >>> 0;
  lo = lo + c0 >>> 0;
  if (lo >>> 0 < c0 >>> 0) {
    hi = hi + 1 >>> 0;
  }
  c1 = c1 << 16 >>> 0;
  lo = lo + c1 >>> 0;
  if (lo >>> 0 < c1 >>> 0) {
    hi = hi + 1 >>> 0;
  }
  hi = hi + Math.imul(aLo, bHi) >>> 0;
  hi = hi + Math.imul(aHi, bLo) >>> 0;
  out[0] = hi;
  out[1] = lo;
}
function add64(out, aHi, aLo, bHi, bLo) {
  let hi = aHi + bHi >>> 0;
  const lo = aLo + bLo >>> 0;
  if (lo >>> 0 < aLo >>> 0) {
    hi = hi + 1 | 0;
  }
  out[0] = hi;
  out[1] = lo;
}
function yieldWrapGet(self) {
  if (typeof self === "object" && self !== null && YieldWrapTypeId in self) {
    return self[YieldWrapTypeId]();
  }
  throw new Error(getBugErrorMessage("yieldWrapGet"));
}
var GenKindTypeId, isGenKind = (u) => isObject(u) && (GenKindTypeId in u), GenKindImpl, SingleShotGen, adapter = () => function() {
  let x = arguments[0];
  for (let i = 1;i < arguments.length; i++) {
    x = arguments[i](x);
  }
  return new GenKindImpl(x);
}, defaultIncHi = 335903614, defaultIncLo = 4150755663, MUL_HI, MUL_LO, BIT_53 = 9007199254740992, BIT_27 = 134217728, YieldWrapTypeId, YieldWrap, structuralRegionState, standard, forced, isNotOptimizedAway, internalCall, genConstructor, isGeneratorFunction = (u) => isObject(u) && u.constructor === genConstructor;
var init_Utils = __esm(() => {
  init_Function();
  init_Predicate();
  GenKindTypeId = /* @__PURE__ */ Symbol.for("effect/Gen/GenKind");
  GenKindImpl = class GenKindImpl {
    value;
    constructor(value) {
      this.value = value;
    }
    get _F() {
      return identity;
    }
    get _R() {
      return (_) => _;
    }
    get _O() {
      return (_) => _;
    }
    get _E() {
      return (_) => _;
    }
    [GenKindTypeId] = GenKindTypeId;
    [Symbol.iterator]() {
      return new SingleShotGen(this);
    }
  };
  SingleShotGen = class SingleShotGen {
    self;
    called = false;
    constructor(self) {
      this.self = self;
    }
    next(a) {
      return this.called ? {
        value: a,
        done: true
      } : (this.called = true, {
        value: this.self,
        done: false
      });
    }
    return(a) {
      return {
        value: a,
        done: true
      };
    }
    throw(e) {
      throw e;
    }
    [Symbol.iterator]() {
      return new SingleShotGen(this.self);
    }
  };
  MUL_HI = 1481765933 >>> 0;
  MUL_LO = 1284865837 >>> 0;
  YieldWrapTypeId = /* @__PURE__ */ Symbol.for("effect/Utils/YieldWrap");
  YieldWrap = class YieldWrap {
    #value;
    constructor(value) {
      this.#value = value;
    }
    [YieldWrapTypeId]() {
      return this.#value;
    }
  };
  structuralRegionState = /* @__PURE__ */ globalValue("effect/Utils/isStructuralRegion", () => ({
    enabled: false,
    tester: undefined
  }));
  standard = {
    effect_internal_function: (body) => {
      return body();
    }
  };
  forced = {
    effect_internal_function: (body) => {
      try {
        return body();
      } finally {}
    }
  };
  isNotOptimizedAway = /* @__PURE__ */ standard.effect_internal_function(() => new Error().stack)?.includes("effect_internal_function") === true;
  internalCall = isNotOptimizedAway ? standard.effect_internal_function : forced.effect_internal_function;
  genConstructor = function* () {}.constructor;
});

// node_modules/effect/dist/esm/Hash.js
var randomHashCache, symbol, hash = (self) => {
  if (structuralRegionState.enabled === true) {
    return 0;
  }
  switch (typeof self) {
    case "number":
      return number(self);
    case "bigint":
      return string(self.toString(10));
    case "boolean":
      return string(String(self));
    case "symbol":
      return string(String(self));
    case "string":
      return string(self);
    case "undefined":
      return string("undefined");
    case "function":
    case "object": {
      if (self === null) {
        return string("null");
      } else if (self instanceof Date) {
        if (Number.isNaN(self.getTime())) {
          return string("Invalid Date");
        }
        return hash(self.toISOString());
      } else if (self instanceof URL) {
        return hash(self.href);
      } else if (isHash(self)) {
        return self[symbol]();
      } else {
        return random(self);
      }
    }
    default:
      throw new Error(`BUG: unhandled typeof ${typeof self} - please report an issue at https://github.com/Effect-TS/effect/issues`);
  }
}, random = (self) => {
  if (!randomHashCache.has(self)) {
    randomHashCache.set(self, number(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)));
  }
  return randomHashCache.get(self);
}, combine = (b) => (self) => self * 53 ^ b, optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824, isHash = (u) => hasProperty(u, symbol), number = (n) => {
  if (n !== n || n === Infinity) {
    return 0;
  }
  let h = n | 0;
  if (h !== n) {
    h ^= n * 4294967295;
  }
  while (n > 4294967295) {
    h ^= n /= 4294967295;
  }
  return optimize(h);
}, string = (str) => {
  let h = 5381, i = str.length;
  while (i) {
    h = h * 33 ^ str.charCodeAt(--i);
  }
  return optimize(h);
}, structureKeys = (o, keys) => {
  let h = 12289;
  for (let i = 0;i < keys.length; i++) {
    h ^= pipe(string(keys[i]), combine(hash(o[keys[i]])));
  }
  return optimize(h);
}, structure = (o) => structureKeys(o, Object.keys(o)), array2 = (arr) => {
  let h = 6151;
  for (let i = 0;i < arr.length; i++) {
    h = pipe(h, combine(hash(arr[i])));
  }
  return optimize(h);
}, cached = function() {
  if (arguments.length === 1) {
    const self2 = arguments[0];
    return function(hash3) {
      Object.defineProperty(self2, symbol, {
        value() {
          return hash3;
        },
        enumerable: false
      });
      return hash3;
    };
  }
  const self = arguments[0];
  const hash2 = arguments[1];
  Object.defineProperty(self, symbol, {
    value() {
      return hash2;
    },
    enumerable: false
  });
  return hash2;
};
var init_Hash = __esm(() => {
  init_Function();
  init_Predicate();
  init_Utils();
  randomHashCache = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Hash/randomHashCache"), () => new WeakMap);
  symbol = /* @__PURE__ */ Symbol.for("effect/Hash");
});

// node_modules/effect/dist/esm/Equal.js
function equals() {
  if (arguments.length === 1) {
    return (self) => compareBoth(self, arguments[0]);
  }
  return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
  if (self === that) {
    return true;
  }
  const selfType = typeof self;
  if (selfType !== typeof that) {
    return false;
  }
  if (selfType === "object" || selfType === "function") {
    if (self !== null && that !== null) {
      if (isEqual(self) && isEqual(that)) {
        if (hash(self) === hash(that) && self[symbol2](that)) {
          return true;
        } else {
          return structuralRegionState.enabled && structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
        }
      } else if (self instanceof Date && that instanceof Date) {
        const t1 = self.getTime();
        const t2 = that.getTime();
        return t1 === t2 || Number.isNaN(t1) && Number.isNaN(t2);
      } else if (self instanceof URL && that instanceof URL) {
        return self.href === that.href;
      }
    }
    if (structuralRegionState.enabled) {
      if (self === null || that === null) {
        return false;
      }
      if (Array.isArray(self) && Array.isArray(that)) {
        return self.length === that.length && self.every((v, i) => compareBoth(v, that[i]));
      }
      if (Object.getPrototypeOf(self) === Object.prototype && Object.getPrototypeOf(that) === Object.prototype) {
        const keysSelf = Object.keys(self);
        const keysThat = Object.keys(that);
        if (keysSelf.length === keysThat.length) {
          for (const key of keysSelf) {
            if (!((key in that) && compareBoth(self[key], that[key]))) {
              return structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
            }
          }
          return true;
        }
      }
      return structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
    }
  }
  return structuralRegionState.enabled && structuralRegionState.tester ? structuralRegionState.tester(self, that) : false;
}
var symbol2, isEqual = (u) => hasProperty(u, symbol2), equivalence = () => equals;
var init_Equal = __esm(() => {
  init_Hash();
  init_Predicate();
  init_Utils();
  symbol2 = /* @__PURE__ */ Symbol.for("effect/Equal");
});

// node_modules/effect/dist/esm/Inspectable.js
var NodeInspectSymbol, toJSON = (x) => {
  try {
    if (hasProperty(x, "toJSON") && isFunction2(x["toJSON"]) && x["toJSON"].length === 0) {
      return x.toJSON();
    } else if (Array.isArray(x)) {
      return x.map(toJSON);
    }
  } catch {
    return {};
  }
  return redact(x);
}, format = (x) => JSON.stringify(x, null, 2), BaseProto, toStringUnknown = (u, whitespace = 2) => {
  if (typeof u === "string") {
    return u;
  }
  try {
    return typeof u === "object" ? stringifyCircular(u, whitespace) : String(u);
  } catch {
    return String(u);
  }
}, stringifyCircular = (obj, whitespace) => {
  let cache = [];
  const retVal = JSON.stringify(obj, (_key, value) => typeof value === "object" && value !== null ? cache.includes(value) ? undefined : cache.push(value) && (redactableState.fiberRefs !== undefined && isRedactable(value) ? value[symbolRedactable](redactableState.fiberRefs) : value) : value, whitespace);
  cache = undefined;
  return retVal;
}, symbolRedactable, isRedactable = (u) => typeof u === "object" && u !== null && (symbolRedactable in u), redactableState, withRedactableContext = (context, f) => {
  const prev = redactableState.fiberRefs;
  redactableState.fiberRefs = context;
  try {
    return f();
  } finally {
    redactableState.fiberRefs = prev;
  }
}, redact = (u) => {
  if (isRedactable(u) && redactableState.fiberRefs !== undefined) {
    return u[symbolRedactable](redactableState.fiberRefs);
  }
  return u;
};
var init_Inspectable = __esm(() => {
  init_Predicate();
  NodeInspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
  BaseProto = {
    toJSON() {
      return toJSON(this);
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    toString() {
      return format(this.toJSON());
    }
  };
  symbolRedactable = /* @__PURE__ */ Symbol.for("effect/Inspectable/Redactable");
  redactableState = /* @__PURE__ */ globalValue("effect/Inspectable/redactableState", () => ({
    fiberRefs: undefined
  }));
});

// node_modules/effect/dist/esm/Pipeable.js
var pipeArguments = (self, args) => {
  switch (args.length) {
    case 0:
      return self;
    case 1:
      return args[0](self);
    case 2:
      return args[1](args[0](self));
    case 3:
      return args[2](args[1](args[0](self)));
    case 4:
      return args[3](args[2](args[1](args[0](self))));
    case 5:
      return args[4](args[3](args[2](args[1](args[0](self)))));
    case 6:
      return args[5](args[4](args[3](args[2](args[1](args[0](self))))));
    case 7:
      return args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))));
    case 8:
      return args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self))))))));
    case 9:
      return args[8](args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))))));
    default: {
      let ret = self;
      for (let i = 0, len = args.length;i < len; i++) {
        ret = args[i](ret);
      }
      return ret;
    }
  }
};
var init_Pipeable = () => {};

// node_modules/effect/dist/esm/internal/opCodes/effect.js
var OP_ASYNC = "Async", OP_COMMIT = "Commit", OP_FAILURE = "Failure", OP_ON_FAILURE = "OnFailure", OP_ON_SUCCESS = "OnSuccess", OP_ON_SUCCESS_AND_FAILURE = "OnSuccessAndFailure", OP_SUCCESS = "Success", OP_SYNC = "Sync", OP_TAG = "Tag", OP_UPDATE_RUNTIME_FLAGS = "UpdateRuntimeFlags", OP_WHILE = "While", OP_ITERATOR = "Iterator", OP_WITH_RUNTIME = "WithRuntime", OP_YIELD = "Yield", OP_REVERT_FLAGS = "RevertFlags";

// node_modules/effect/dist/esm/internal/version.js
var moduleVersion = "3.22.1", getCurrentVersion = () => moduleVersion;

// node_modules/effect/dist/esm/internal/effectable.js
var EffectTypeId, StreamTypeId, SinkTypeId, ChannelTypeId, effectVariance, sinkVariance, channelVariance, EffectPrototype, StructuralPrototype, CommitPrototype, StructuralCommitPrototype, Base;
var init_effectable = __esm(() => {
  init_Equal();
  init_Hash();
  init_Pipeable();
  init_Utils();
  EffectTypeId = /* @__PURE__ */ Symbol.for("effect/Effect");
  StreamTypeId = /* @__PURE__ */ Symbol.for("effect/Stream");
  SinkTypeId = /* @__PURE__ */ Symbol.for("effect/Sink");
  ChannelTypeId = /* @__PURE__ */ Symbol.for("effect/Channel");
  effectVariance = {
    _R: (_) => _,
    _E: (_) => _,
    _A: (_) => _,
    _V: /* @__PURE__ */ getCurrentVersion()
  };
  sinkVariance = {
    _A: (_) => _,
    _In: (_) => _,
    _L: (_) => _,
    _E: (_) => _,
    _R: (_) => _
  };
  channelVariance = {
    _Env: (_) => _,
    _InErr: (_) => _,
    _InElem: (_) => _,
    _InDone: (_) => _,
    _OutErr: (_) => _,
    _OutElem: (_) => _,
    _OutDone: (_) => _
  };
  EffectPrototype = {
    [EffectTypeId]: effectVariance,
    [StreamTypeId]: effectVariance,
    [SinkTypeId]: sinkVariance,
    [ChannelTypeId]: channelVariance,
    [symbol2](that) {
      return this === that;
    },
    [symbol]() {
      return cached(this, random(this));
    },
    [Symbol.iterator]() {
      return new SingleShotGen(new YieldWrap(this));
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  StructuralPrototype = {
    [symbol]() {
      return cached(this, structure(this));
    },
    [symbol2](that) {
      const selfKeys = Object.keys(this);
      const thatKeys = Object.keys(that);
      if (selfKeys.length !== thatKeys.length) {
        return false;
      }
      for (const key of selfKeys) {
        if (!((key in that) && equals(this[key], that[key]))) {
          return false;
        }
      }
      return true;
    }
  };
  CommitPrototype = {
    ...EffectPrototype,
    _op: OP_COMMIT
  };
  StructuralCommitPrototype = {
    ...CommitPrototype,
    ...StructuralPrototype
  };
  Base = /* @__PURE__ */ function() {
    function Base2() {}
    Base2.prototype = CommitPrototype;
    return Base2;
  }();
});

// node_modules/effect/dist/esm/internal/option.js
var TypeId, CommonProto, SomeProto, NoneHash, NoneProto, isOption = (input) => hasProperty(input, TypeId), isNone = (fa) => fa._tag === "None", isSome = (fa) => fa._tag === "Some", none, some = (value) => {
  const a = Object.create(SomeProto);
  a.value = value;
  return a;
};
var init_option = __esm(() => {
  init_Equal();
  init_Hash();
  init_Inspectable();
  init_Predicate();
  init_effectable();
  TypeId = /* @__PURE__ */ Symbol.for("effect/Option");
  CommonProto = {
    ...EffectPrototype,
    [TypeId]: {
      _A: (_) => _
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    toString() {
      return format(this.toJSON());
    }
  };
  SomeProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
    _tag: "Some",
    _op: "Some",
    [symbol2](that) {
      return isOption(that) && isSome(that) && equals(this.value, that.value);
    },
    [symbol]() {
      return cached(this, combine(hash(this._tag))(hash(this.value)));
    },
    toJSON() {
      return {
        _id: "Option",
        _tag: this._tag,
        value: toJSON(this.value)
      };
    }
  });
  NoneHash = /* @__PURE__ */ hash("None");
  NoneProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
    _tag: "None",
    _op: "None",
    [symbol2](that) {
      return isOption(that) && isNone(that);
    },
    [symbol]() {
      return NoneHash;
    },
    toJSON() {
      return {
        _id: "Option",
        _tag: this._tag
      };
    }
  });
  none = /* @__PURE__ */ Object.create(NoneProto);
});

// node_modules/effect/dist/esm/internal/either.js
var TypeId2, CommonProto2, RightProto, LeftProto, isEither = (input) => hasProperty(input, TypeId2), isLeft = (ma) => ma._tag === "Left", isRight = (ma) => ma._tag === "Right", left = (left2) => {
  const a = Object.create(LeftProto);
  a.left = left2;
  return a;
}, right = (right2) => {
  const a = Object.create(RightProto);
  a.right = right2;
  return a;
}, getLeft = (self) => isRight(self) ? none : some(self.left), getRight = (self) => isLeft(self) ? none : some(self.right);
var init_either = __esm(() => {
  init_Equal();
  init_Hash();
  init_Inspectable();
  init_Predicate();
  init_effectable();
  init_option();
  TypeId2 = /* @__PURE__ */ Symbol.for("effect/Either");
  CommonProto2 = {
    ...EffectPrototype,
    [TypeId2]: {
      _R: (_) => _
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    toString() {
      return format(this.toJSON());
    }
  };
  RightProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
    _tag: "Right",
    _op: "Right",
    [symbol2](that) {
      return isEither(that) && isRight(that) && equals(this.right, that.right);
    },
    [symbol]() {
      return combine(hash(this._tag))(hash(this.right));
    },
    toJSON() {
      return {
        _id: "Either",
        _tag: this._tag,
        right: toJSON(this.right)
      };
    }
  });
  LeftProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
    _tag: "Left",
    _op: "Left",
    [symbol2](that) {
      return isEither(that) && isLeft(that) && equals(this.left, that.left);
    },
    [symbol]() {
      return combine(hash(this._tag))(hash(this.left));
    },
    toJSON() {
      return {
        _id: "Either",
        _tag: this._tag,
        left: toJSON(this.left)
      };
    }
  });
});

// node_modules/effect/dist/esm/Either.js
var right2, left2, isLeft2, isRight2, match, merge;
var init_Either = __esm(() => {
  init_Function();
  init_either();
  right2 = right;
  left2 = left;
  isLeft2 = isLeft;
  isRight2 = isRight;
  match = /* @__PURE__ */ dual(2, (self, {
    onLeft,
    onRight
  }) => isLeft2(self) ? onLeft(self.left) : onRight(self.right));
  merge = /* @__PURE__ */ match({
    onLeft: identity,
    onRight: identity
  });
});

// node_modules/effect/dist/esm/internal/array.js
var isNonEmptyArray = (self) => self.length > 0;

// node_modules/effect/dist/esm/Order.js
var make2 = (compare) => (self, that) => self === that ? 0 : compare(self, that), number2, mapInput2, greaterThan = (O) => dual(2, (self, that) => O(self, that) === 1);
var init_Order = __esm(() => {
  init_Function();
  number2 = /* @__PURE__ */ make2((self, that) => self < that ? -1 : 1);
  mapInput2 = /* @__PURE__ */ dual(2, (self, f) => make2((b1, b2) => self(f(b1), f(b2))));
});

// node_modules/effect/dist/esm/Option.js
var exports_Option = {};
__export(exports_Option, {
  zipWith: () => zipWith,
  zipRight: () => zipRight,
  zipLeft: () => zipLeft,
  void: () => void_,
  toRefinement: () => toRefinement,
  toArray: () => toArray,
  tap: () => tap,
  some: () => some2,
  reduceCompact: () => reduceCompact,
  productMany: () => productMany,
  product: () => product,
  partitionMap: () => partitionMap,
  orElseSome: () => orElseSome,
  orElseEither: () => orElseEither,
  orElse: () => orElse,
  none: () => none2,
  mergeWith: () => mergeWith,
  match: () => match2,
  map: () => map,
  liftThrowable: () => liftThrowable,
  liftPredicate: () => liftPredicate,
  liftNullable: () => liftNullable,
  lift2: () => lift2,
  let: () => let_2,
  isSome: () => isSome2,
  isOption: () => isOption2,
  isNone: () => isNone2,
  getRight: () => getRight2,
  getOrder: () => getOrder,
  getOrUndefined: () => getOrUndefined,
  getOrThrowWith: () => getOrThrowWith,
  getOrThrow: () => getOrThrow,
  getOrNull: () => getOrNull,
  getOrElse: () => getOrElse,
  getLeft: () => getLeft2,
  getEquivalence: () => getEquivalence,
  gen: () => gen,
  fromNullable: () => fromNullable,
  fromIterable: () => fromIterable,
  flatten: () => flatten,
  flatMapNullable: () => flatMapNullable,
  flatMap: () => flatMap,
  firstSomeOf: () => firstSomeOf,
  filterMap: () => filterMap,
  filter: () => filter,
  exists: () => exists,
  containsWith: () => containsWith,
  contains: () => contains,
  composeK: () => composeK,
  bindTo: () => bindTo2,
  bind: () => bind2,
  asVoid: () => asVoid,
  as: () => as,
  ap: () => ap,
  andThen: () => andThen,
  all: () => all,
  TypeId: () => TypeId3,
  Do: () => Do
});
var TypeId3, none2 = () => none, some2, isOption2, isNone2, isSome2, match2, toRefinement = (f) => (a) => isSome2(f(a)), fromIterable = (collection) => {
  for (const a of collection) {
    return some2(a);
  }
  return none2();
}, getRight2, getLeft2, getOrElse, orElse, orElseSome, orElseEither, firstSomeOf = (collection) => {
  let out = none2();
  for (out of collection) {
    if (isSome2(out)) {
      return out;
    }
  }
  return out;
}, fromNullable = (nullableValue) => nullableValue == null ? none2() : some2(nullableValue), liftNullable = (f) => (...a) => fromNullable(f(...a)), getOrNull, getOrUndefined, liftThrowable = (f) => (...a) => {
  try {
    return some2(f(...a));
  } catch {
    return none2();
  }
}, getOrThrowWith, getOrThrow, map, as, asVoid, void_, flatMap, andThen, flatMapNullable, flatten, zipRight, zipLeft, composeK, tap, product = (self, that) => isSome2(self) && isSome2(that) ? some2([self.value, that.value]) : none2(), productMany = (self, collection) => {
  if (isNone2(self)) {
    return none2();
  }
  const out = [self.value];
  for (const o of collection) {
    if (isNone2(o)) {
      return none2();
    }
    out.push(o.value);
  }
  return some2(out);
}, all = (input) => {
  if (Symbol.iterator in input) {
    const out2 = [];
    for (const o of input) {
      if (isNone2(o)) {
        return none2();
      }
      out2.push(o.value);
    }
    return some2(out2);
  }
  const out = {};
  for (const key of Object.keys(input)) {
    const o = input[key];
    if (isNone2(o)) {
      return none2();
    }
    out[key] = o.value;
  }
  return some2(out);
}, zipWith, ap, reduceCompact, toArray = (self) => isNone2(self) ? [] : [self.value], partitionMap, filterMap, filter, getEquivalence = (isEquivalent) => make((x, y) => isNone2(x) ? isNone2(y) : isNone2(y) ? false : isEquivalent(x.value, y.value)), getOrder = (O) => make2((self, that) => isSome2(self) ? isSome2(that) ? O(self.value, that.value) : 1 : -1), lift2 = (f) => dual(2, (self, that) => zipWith(self, that, f)), liftPredicate, containsWith = (isEquivalent) => dual(2, (self, a) => isNone2(self) ? false : isEquivalent(self.value, a)), _equivalence, contains, exists, bindTo2, let_2, bind2, Do, adapter2, gen = (...args) => {
  const f = args.length === 1 ? args[0] : args[1].bind(args[0]);
  const iterator = f(adapter2);
  let state = iterator.next();
  while (!state.done) {
    const current = isGenKind(state.value) ? state.value.value : yieldWrapGet(state.value);
    if (isNone2(current)) {
      return current;
    }
    state = iterator.next(current.value);
  }
  return some2(state.value);
}, mergeWith = (f) => (o1, o2) => {
  if (isNone2(o1)) {
    return o2;
  } else if (isNone2(o2)) {
    return o1;
  }
  return some2(f(o1.value, o2.value));
};
var init_Option = __esm(() => {
  init_Equal();
  init_Equivalence();
  init_Function();
  init_doNotation();
  init_either();
  init_option();
  init_Order();
  init_Utils();
  TypeId3 = /* @__PURE__ */ Symbol.for("effect/Option");
  some2 = some;
  isOption2 = isOption;
  isNone2 = isNone;
  isSome2 = isSome;
  match2 = /* @__PURE__ */ dual(2, (self, {
    onNone,
    onSome
  }) => isNone2(self) ? onNone() : onSome(self.value));
  getRight2 = getRight;
  getLeft2 = getLeft;
  getOrElse = /* @__PURE__ */ dual(2, (self, onNone) => isNone2(self) ? onNone() : self.value);
  orElse = /* @__PURE__ */ dual(2, (self, that) => isNone2(self) ? that() : self);
  orElseSome = /* @__PURE__ */ dual(2, (self, onNone) => isNone2(self) ? some2(onNone()) : self);
  orElseEither = /* @__PURE__ */ dual(2, (self, that) => isNone2(self) ? map(that(), right) : map(self, left));
  getOrNull = /* @__PURE__ */ getOrElse(constNull);
  getOrUndefined = /* @__PURE__ */ getOrElse(constUndefined);
  getOrThrowWith = /* @__PURE__ */ dual(2, (self, onNone) => {
    if (isSome2(self)) {
      return self.value;
    }
    throw onNone();
  });
  getOrThrow = /* @__PURE__ */ getOrThrowWith(() => new Error("getOrThrow called on a None"));
  map = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : some2(f(self.value)));
  as = /* @__PURE__ */ dual(2, (self, b) => map(self, () => b));
  asVoid = /* @__PURE__ */ as(undefined);
  void_ = /* @__PURE__ */ some2(undefined);
  flatMap = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : f(self.value));
  andThen = /* @__PURE__ */ dual(2, (self, f) => flatMap(self, (a) => {
    const b = isFunction(f) ? f(a) : f;
    return isOption2(b) ? b : some2(b);
  }));
  flatMapNullable = /* @__PURE__ */ dual(2, (self, f) => isNone2(self) ? none2() : fromNullable(f(self.value)));
  flatten = /* @__PURE__ */ flatMap(identity);
  zipRight = /* @__PURE__ */ dual(2, (self, that) => flatMap(self, () => that));
  zipLeft = /* @__PURE__ */ dual(2, (self, that) => tap(self, () => that));
  composeK = /* @__PURE__ */ dual(2, (afb, bfc) => (a) => flatMap(afb(a), bfc));
  tap = /* @__PURE__ */ dual(2, (self, f) => flatMap(self, (a) => map(f(a), () => a)));
  zipWith = /* @__PURE__ */ dual(3, (self, that, f) => map(product(self, that), ([a, b]) => f(a, b)));
  ap = /* @__PURE__ */ dual(2, (self, that) => zipWith(self, that, (f, a) => f(a)));
  reduceCompact = /* @__PURE__ */ dual(3, (self, b, f) => {
    let out = b;
    for (const oa of self) {
      if (isSome2(oa)) {
        out = f(out, oa.value);
      }
    }
    return out;
  });
  partitionMap = /* @__PURE__ */ dual(2, (self, f) => {
    if (isNone2(self)) {
      return [none2(), none2()];
    }
    const e = f(self.value);
    return isLeft(e) ? [some2(e.left), none2()] : [none2(), some2(e.right)];
  });
  filterMap = flatMap;
  filter = /* @__PURE__ */ dual(2, (self, predicate) => filterMap(self, (b) => predicate(b) ? some(b) : none));
  liftPredicate = /* @__PURE__ */ dual(2, (b, predicate) => predicate(b) ? some2(b) : none2());
  _equivalence = /* @__PURE__ */ equivalence();
  contains = /* @__PURE__ */ containsWith(_equivalence);
  exists = /* @__PURE__ */ dual(2, (self, refinement) => isNone2(self) ? false : refinement(self.value));
  bindTo2 = /* @__PURE__ */ bindTo(map);
  let_2 = /* @__PURE__ */ let_(map);
  bind2 = /* @__PURE__ */ bind(map, flatMap);
  Do = /* @__PURE__ */ some2({});
  adapter2 = /* @__PURE__ */ adapter();
});

// node_modules/effect/dist/esm/Tuple.js
var make3 = (...elements) => elements;
var init_Tuple = () => {};

// node_modules/effect/dist/esm/Array.js
var allocate = (n) => new Array(n), makeBy, fromIterable2 = (collection) => Array.isArray(collection) ? collection : Array.from(collection), ensure = (self) => Array.isArray(self) ? self : [self], prepend, append, appendAll, isEmptyArray = (self) => self.length === 0, isEmptyReadonlyArray, isNonEmptyArray2, isNonEmptyReadonlyArray, isOutOfBounds = (i, as2) => i < 0 || i >= as2.length, clamp = (i, as2) => Math.floor(Math.min(Math.max(0, i), as2.length)), get, unsafeGet, head, headNonEmpty, last = (self) => isNonEmptyReadonlyArray(self) ? some2(lastNonEmpty(self)) : none2(), lastNonEmpty = (self) => self[self.length - 1], tailNonEmpty = (self) => self.slice(1), spanIndex = (self, predicate) => {
  let i = 0;
  for (const a of self) {
    if (!predicate(a, i)) {
      break;
    }
    i++;
  }
  return i;
}, span, drop, reverse = (self) => Array.from(self).reverse(), sort, zip, zipWith2, _equivalence2, splitAt, splitNonEmptyAt, copy = (self) => self.slice(), unionWith, union, empty = () => [], of = (a) => [a], map2, flatMap2, flatten2, filterMap2, partitionMap2, getSomes, reduce, reduceRight, unfold = (b, f) => {
  const out = [];
  let next = b;
  let o;
  while (isSome2(o = f(next))) {
    const [a, b2] = o.value;
    out.push(a);
    next = b2;
  }
  return out;
}, getEquivalence2, dedupeWith, dedupe = (self) => dedupeWith(self, equivalence()), join;
var init_Array = __esm(() => {
  init_Either();
  init_Equal();
  init_Equivalence();
  init_Function();
  init_Option();
  init_Tuple();
  makeBy = /* @__PURE__ */ dual(2, (n, f) => {
    const max = Math.max(1, Math.floor(n));
    const out = new Array(max);
    for (let i = 0;i < max; i++) {
      out[i] = f(i);
    }
    return out;
  });
  prepend = /* @__PURE__ */ dual(2, (self, head) => [head, ...self]);
  append = /* @__PURE__ */ dual(2, (self, last) => [...self, last]);
  appendAll = /* @__PURE__ */ dual(2, (self, that) => fromIterable2(self).concat(fromIterable2(that)));
  isEmptyReadonlyArray = isEmptyArray;
  isNonEmptyArray2 = isNonEmptyArray;
  isNonEmptyReadonlyArray = isNonEmptyArray;
  get = /* @__PURE__ */ dual(2, (self, index) => {
    const i = Math.floor(index);
    return isOutOfBounds(i, self) ? none2() : some2(self[i]);
  });
  unsafeGet = /* @__PURE__ */ dual(2, (self, index) => {
    const i = Math.floor(index);
    if (isOutOfBounds(i, self)) {
      throw new Error(`Index ${i} out of bounds`);
    }
    return self[i];
  });
  head = /* @__PURE__ */ get(0);
  headNonEmpty = /* @__PURE__ */ unsafeGet(0);
  span = /* @__PURE__ */ dual(2, (self, predicate) => splitAt(self, spanIndex(self, predicate)));
  drop = /* @__PURE__ */ dual(2, (self, n) => {
    const input = fromIterable2(self);
    return input.slice(clamp(n, input), input.length);
  });
  sort = /* @__PURE__ */ dual(2, (self, O) => {
    const out = Array.from(self);
    out.sort(O);
    return out;
  });
  zip = /* @__PURE__ */ dual(2, (self, that) => zipWith2(self, that, make3));
  zipWith2 = /* @__PURE__ */ dual(3, (self, that, f) => {
    const as2 = fromIterable2(self);
    const bs = fromIterable2(that);
    if (isNonEmptyReadonlyArray(as2) && isNonEmptyReadonlyArray(bs)) {
      const out = [f(headNonEmpty(as2), headNonEmpty(bs))];
      const len = Math.min(as2.length, bs.length);
      for (let i = 1;i < len; i++) {
        out[i] = f(as2[i], bs[i]);
      }
      return out;
    }
    return [];
  });
  _equivalence2 = /* @__PURE__ */ equivalence();
  splitAt = /* @__PURE__ */ dual(2, (self, n) => {
    const input = Array.from(self);
    const _n = Math.floor(n);
    if (isNonEmptyReadonlyArray(input)) {
      if (_n >= 1) {
        return splitNonEmptyAt(input, _n);
      }
      return [[], input];
    }
    return [input, []];
  });
  splitNonEmptyAt = /* @__PURE__ */ dual(2, (self, n) => {
    const _n = Math.max(1, Math.floor(n));
    return _n >= self.length ? [copy(self), []] : [prepend(self.slice(1, _n), headNonEmpty(self)), self.slice(_n)];
  });
  unionWith = /* @__PURE__ */ dual(3, (self, that, isEquivalent) => {
    const a = fromIterable2(self);
    const b = fromIterable2(that);
    if (isNonEmptyReadonlyArray(a)) {
      if (isNonEmptyReadonlyArray(b)) {
        const dedupe = dedupeWith(isEquivalent);
        return dedupe(appendAll(a, b));
      }
      return a;
    }
    return b;
  });
  union = /* @__PURE__ */ dual(2, (self, that) => unionWith(self, that, _equivalence2));
  map2 = /* @__PURE__ */ dual(2, (self, f) => self.map(f));
  flatMap2 = /* @__PURE__ */ dual(2, (self, f) => {
    if (isEmptyReadonlyArray(self)) {
      return [];
    }
    const out = [];
    for (let i = 0;i < self.length; i++) {
      const inner = f(self[i], i);
      for (let j = 0;j < inner.length; j++) {
        out.push(inner[j]);
      }
    }
    return out;
  });
  flatten2 = /* @__PURE__ */ flatMap2(identity);
  filterMap2 = /* @__PURE__ */ dual(2, (self, f) => {
    const as2 = fromIterable2(self);
    const out = [];
    for (let i = 0;i < as2.length; i++) {
      const o = f(as2[i], i);
      if (isSome2(o)) {
        out.push(o.value);
      }
    }
    return out;
  });
  partitionMap2 = /* @__PURE__ */ dual(2, (self, f) => {
    const left3 = [];
    const right3 = [];
    const as2 = fromIterable2(self);
    for (let i = 0;i < as2.length; i++) {
      const e = f(as2[i], i);
      if (isLeft2(e)) {
        left3.push(e.left);
      } else {
        right3.push(e.right);
      }
    }
    return [left3, right3];
  });
  getSomes = /* @__PURE__ */ filterMap2(identity);
  reduce = /* @__PURE__ */ dual(3, (self, b, f) => fromIterable2(self).reduce((b2, a, i) => f(b2, a, i), b));
  reduceRight = /* @__PURE__ */ dual(3, (self, b, f) => fromIterable2(self).reduceRight((b2, a, i) => f(b2, a, i), b));
  getEquivalence2 = array;
  dedupeWith = /* @__PURE__ */ dual(2, (self, isEquivalent) => {
    const input = fromIterable2(self);
    if (isNonEmptyReadonlyArray(input)) {
      const out = [headNonEmpty(input)];
      const rest = tailNonEmpty(input);
      for (const r of rest) {
        if (out.every((a) => !isEquivalent(r, a))) {
          out.push(r);
        }
      }
      return out;
    }
    return [];
  });
  join = /* @__PURE__ */ dual(2, (self, sep) => fromIterable2(self).join(sep));
});

// node_modules/effect/dist/esm/Chunk.js
function copy2(src, srcPos, dest, destPos, len) {
  for (let i = srcPos;i < Math.min(src.length, srcPos + len); i++) {
    dest[destPos + i - srcPos] = src[i];
  }
  return dest;
}
var TypeId4, emptyArray, getEquivalence3 = (isEquivalent) => make((self, that) => self.length === that.length && toReadonlyArray(self).every((value, i) => isEquivalent(value, unsafeGet2(that, i)))), _equivalence3, ChunkProto, makeChunk = (backing) => {
  const chunk = Object.create(ChunkProto);
  chunk.backing = backing;
  switch (backing._tag) {
    case "IEmpty": {
      chunk.length = 0;
      chunk.depth = 0;
      chunk.left = chunk;
      chunk.right = chunk;
      break;
    }
    case "IConcat": {
      chunk.length = backing.left.length + backing.right.length;
      chunk.depth = 1 + Math.max(backing.left.depth, backing.right.depth);
      chunk.left = backing.left;
      chunk.right = backing.right;
      break;
    }
    case "IArray": {
      chunk.length = backing.array.length;
      chunk.depth = 0;
      chunk.left = _empty;
      chunk.right = _empty;
      break;
    }
    case "ISingleton": {
      chunk.length = 1;
      chunk.depth = 0;
      chunk.left = _empty;
      chunk.right = _empty;
      break;
    }
    case "ISlice": {
      chunk.length = backing.length;
      chunk.depth = backing.chunk.depth + 1;
      chunk.left = _empty;
      chunk.right = _empty;
      break;
    }
  }
  return chunk;
}, isChunk = (u) => hasProperty(u, TypeId4), _empty, empty2 = () => _empty, make4 = (...as2) => unsafeFromNonEmptyArray(as2), of2 = (a) => makeChunk({
  _tag: "ISingleton",
  a
}), fromIterable3 = (self) => isChunk(self) ? self : unsafeFromArray(fromIterable2(self)), copyToArray = (self, array3, initial) => {
  switch (self.backing._tag) {
    case "IArray": {
      copy2(self.backing.array, 0, array3, initial, self.length);
      break;
    }
    case "IConcat": {
      copyToArray(self.left, array3, initial);
      copyToArray(self.right, array3, initial + self.left.length);
      break;
    }
    case "ISingleton": {
      array3[initial] = self.backing.a;
      break;
    }
    case "ISlice": {
      let i = 0;
      let j = initial;
      while (i < self.length) {
        array3[j] = unsafeGet2(self, i);
        i += 1;
        j += 1;
      }
      break;
    }
  }
}, toReadonlyArray_ = (self) => {
  switch (self.backing._tag) {
    case "IEmpty": {
      return emptyArray;
    }
    case "IArray": {
      return self.backing.array;
    }
    default: {
      const arr = new Array(self.length);
      copyToArray(self, arr, 0);
      self.backing = {
        _tag: "IArray",
        array: arr
      };
      self.left = _empty;
      self.right = _empty;
      self.depth = 0;
      return arr;
    }
  }
}, toReadonlyArray, reverseChunk = (self) => {
  switch (self.backing._tag) {
    case "IEmpty":
    case "ISingleton":
      return self;
    case "IArray": {
      return makeChunk({
        _tag: "IArray",
        array: reverse(self.backing.array)
      });
    }
    case "IConcat": {
      return makeChunk({
        _tag: "IConcat",
        left: reverse2(self.backing.right),
        right: reverse2(self.backing.left)
      });
    }
    case "ISlice":
      return unsafeFromArray(reverse(toReadonlyArray(self)));
  }
}, reverse2, get2, unsafeFromArray = (self) => self.length === 0 ? empty2() : self.length === 1 ? of2(self[0]) : makeChunk({
  _tag: "IArray",
  array: self
}), unsafeFromNonEmptyArray = (self) => unsafeFromArray(self), unsafeGet2, append2, prepend2, drop2, appendAll2, isEmpty = (self) => self.length === 0, isNonEmpty = (self) => self.length > 0, head2, unsafeHead = (self) => unsafeGet2(self, 0), headNonEmpty2, tailNonEmpty2 = (self) => drop2(self, 1);
var init_Chunk = __esm(() => {
  init_Array();
  init_Equal();
  init_Equivalence();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Pipeable();
  init_Predicate();
  TypeId4 = /* @__PURE__ */ Symbol.for("effect/Chunk");
  emptyArray = [];
  _equivalence3 = /* @__PURE__ */ getEquivalence3(equals);
  ChunkProto = {
    [TypeId4]: {
      _A: (_) => _
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "Chunk",
        values: toReadonlyArray(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    [symbol2](that) {
      return isChunk(that) && _equivalence3(this, that);
    },
    [symbol]() {
      return cached(this, array2(toReadonlyArray(this)));
    },
    [Symbol.iterator]() {
      switch (this.backing._tag) {
        case "IArray": {
          return this.backing.array[Symbol.iterator]();
        }
        case "IEmpty": {
          return emptyArray[Symbol.iterator]();
        }
        default: {
          return toReadonlyArray(this)[Symbol.iterator]();
        }
      }
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  _empty = /* @__PURE__ */ makeChunk({
    _tag: "IEmpty"
  });
  toReadonlyArray = toReadonlyArray_;
  reverse2 = reverseChunk;
  get2 = /* @__PURE__ */ dual(2, (self, index) => index < 0 || index >= self.length ? none2() : some2(unsafeGet2(self, index)));
  unsafeGet2 = /* @__PURE__ */ dual(2, (self, index) => {
    switch (self.backing._tag) {
      case "IEmpty": {
        throw new Error(`Index out of bounds`);
      }
      case "ISingleton": {
        if (index !== 0) {
          throw new Error(`Index out of bounds`);
        }
        return self.backing.a;
      }
      case "IArray": {
        if (index >= self.length || index < 0) {
          throw new Error(`Index out of bounds`);
        }
        return self.backing.array[index];
      }
      case "IConcat": {
        return index < self.left.length ? unsafeGet2(self.left, index) : unsafeGet2(self.right, index - self.left.length);
      }
      case "ISlice": {
        return unsafeGet2(self.backing.chunk, index + self.backing.offset);
      }
    }
  });
  append2 = /* @__PURE__ */ dual(2, (self, a) => appendAll2(self, of2(a)));
  prepend2 = /* @__PURE__ */ dual(2, (self, elem) => appendAll2(of2(elem), self));
  drop2 = /* @__PURE__ */ dual(2, (self, n) => {
    if (n <= 0) {
      return self;
    } else if (n >= self.length) {
      return _empty;
    } else {
      switch (self.backing._tag) {
        case "ISlice": {
          return makeChunk({
            _tag: "ISlice",
            chunk: self.backing.chunk,
            offset: self.backing.offset + n,
            length: self.backing.length - n
          });
        }
        case "IConcat": {
          if (n > self.left.length) {
            return drop2(self.right, n - self.left.length);
          }
          return makeChunk({
            _tag: "IConcat",
            left: drop2(self.left, n),
            right: self.right
          });
        }
        default: {
          return makeChunk({
            _tag: "ISlice",
            chunk: self,
            offset: n,
            length: self.length - n
          });
        }
      }
    }
  });
  appendAll2 = /* @__PURE__ */ dual(2, (self, that) => {
    if (self.backing._tag === "IEmpty") {
      return that;
    }
    if (that.backing._tag === "IEmpty") {
      return self;
    }
    const diff = that.depth - self.depth;
    if (Math.abs(diff) <= 1) {
      return makeChunk({
        _tag: "IConcat",
        left: self,
        right: that
      });
    } else if (diff < -1) {
      if (self.left.depth >= self.right.depth) {
        const nr = appendAll2(self.right, that);
        return makeChunk({
          _tag: "IConcat",
          left: self.left,
          right: nr
        });
      } else {
        const nrr = appendAll2(self.right.right, that);
        if (nrr.depth === self.depth - 3) {
          const nr = makeChunk({
            _tag: "IConcat",
            left: self.right.left,
            right: nrr
          });
          return makeChunk({
            _tag: "IConcat",
            left: self.left,
            right: nr
          });
        } else {
          const nl = makeChunk({
            _tag: "IConcat",
            left: self.left,
            right: self.right.left
          });
          return makeChunk({
            _tag: "IConcat",
            left: nl,
            right: nrr
          });
        }
      }
    } else {
      if (that.right.depth >= that.left.depth) {
        const nl = appendAll2(self, that.left);
        return makeChunk({
          _tag: "IConcat",
          left: nl,
          right: that.right
        });
      } else {
        const nll = appendAll2(self, that.left.left);
        if (nll.depth === that.depth - 3) {
          const nl = makeChunk({
            _tag: "IConcat",
            left: nll,
            right: that.left.right
          });
          return makeChunk({
            _tag: "IConcat",
            left: nl,
            right: that.right
          });
        } else {
          const nr = makeChunk({
            _tag: "IConcat",
            left: that.left.right,
            right: that.right
          });
          return makeChunk({
            _tag: "IConcat",
            left: nll,
            right: nr
          });
        }
      }
    }
  });
  head2 = /* @__PURE__ */ get2(0);
  headNonEmpty2 = unsafeHead;
});

// node_modules/effect/dist/esm/internal/hashMap/config.js
var SIZE = 5, BUCKET_SIZE, MASK, MAX_INDEX_NODE, MIN_ARRAY_NODE;
var init_config = __esm(() => {
  BUCKET_SIZE = /* @__PURE__ */ Math.pow(2, SIZE);
  MASK = BUCKET_SIZE - 1;
  MAX_INDEX_NODE = BUCKET_SIZE / 2;
  MIN_ARRAY_NODE = BUCKET_SIZE / 4;
});

// node_modules/effect/dist/esm/internal/hashMap/bitwise.js
function popcount(x) {
  x -= x >> 1 & 1431655765;
  x = (x & 858993459) + (x >> 2 & 858993459);
  x = x + (x >> 4) & 252645135;
  x += x >> 8;
  x += x >> 16;
  return x & 127;
}
function hashFragment(shift, h) {
  return h >>> shift & MASK;
}
function toBitmap(x) {
  return 1 << x;
}
function fromBitmap(bitmap, bit) {
  return popcount(bitmap & bit - 1);
}
var init_bitwise = __esm(() => {
  init_config();
});

// node_modules/effect/dist/esm/internal/stack.js
var make5 = (value, previous) => ({
  value,
  previous
});

// node_modules/effect/dist/esm/internal/hashMap/array.js
function arrayUpdate(mutate, at, v, arr) {
  let out = arr;
  if (!mutate) {
    const len = arr.length;
    out = new Array(len);
    for (let i = 0;i < len; ++i)
      out[i] = arr[i];
  }
  out[at] = v;
  return out;
}
function arraySpliceOut(mutate, at, arr) {
  const newLen = arr.length - 1;
  let i = 0;
  let g = 0;
  let out = arr;
  if (mutate) {
    i = g = at;
  } else {
    out = new Array(newLen);
    while (i < at)
      out[g++] = arr[i++];
  }
  ++i;
  while (i <= newLen)
    out[g++] = arr[i++];
  if (mutate) {
    out.length = newLen;
  }
  return out;
}
function arraySpliceIn(mutate, at, v, arr) {
  const len = arr.length;
  if (mutate) {
    let i2 = len;
    while (i2 >= at)
      arr[i2--] = arr[i2];
    arr[at] = v;
    return arr;
  }
  let i = 0, g = 0;
  const out = new Array(len + 1);
  while (i < at)
    out[g++] = arr[i++];
  out[at] = v;
  while (i < len)
    out[++g] = arr[i++];
  return out;
}

// node_modules/effect/dist/esm/internal/hashMap/node.js
class EmptyNode {
  _tag = "EmptyNode";
  modify(edit, _shift, f, hash2, key, size) {
    const v = f(none2());
    if (isNone2(v))
      return new EmptyNode;
    ++size.value;
    return new LeafNode(edit, hash2, key, v);
  }
}
function isEmptyNode(a) {
  return isTagged(a, "EmptyNode");
}
function isLeafNode(node) {
  return isEmptyNode(node) || node._tag === "LeafNode" || node._tag === "CollisionNode";
}
function canEditNode(node, edit) {
  return isEmptyNode(node) ? false : edit === node.edit;
}

class LeafNode {
  edit;
  hash;
  key;
  value;
  _tag = "LeafNode";
  constructor(edit, hash2, key, value) {
    this.edit = edit;
    this.hash = hash2;
    this.key = key;
    this.value = value;
  }
  modify(edit, shift, f, hash2, key, size) {
    if (equals(key, this.key)) {
      const v2 = f(this.value);
      if (v2 === this.value)
        return this;
      else if (isNone2(v2)) {
        --size.value;
        return new EmptyNode;
      }
      if (canEditNode(this, edit)) {
        this.value = v2;
        return this;
      }
      return new LeafNode(edit, hash2, key, v2);
    }
    const v = f(none2());
    if (isNone2(v))
      return this;
    ++size.value;
    return mergeLeaves(edit, shift, this.hash, this, hash2, new LeafNode(edit, hash2, key, v));
  }
}

class CollisionNode {
  edit;
  hash;
  children;
  _tag = "CollisionNode";
  constructor(edit, hash2, children) {
    this.edit = edit;
    this.hash = hash2;
    this.children = children;
  }
  modify(edit, shift, f, hash2, key, size) {
    if (hash2 === this.hash) {
      const canEdit = canEditNode(this, edit);
      const list = this.updateCollisionList(canEdit, edit, this.hash, this.children, f, key, size);
      if (list === this.children)
        return this;
      return list.length > 1 ? new CollisionNode(edit, this.hash, list) : list[0];
    }
    const v = f(none2());
    if (isNone2(v))
      return this;
    ++size.value;
    return mergeLeaves(edit, shift, this.hash, this, hash2, new LeafNode(edit, hash2, key, v));
  }
  updateCollisionList(mutate, edit, hash2, list, f, key, size) {
    const len = list.length;
    for (let i = 0;i < len; ++i) {
      const child = list[i];
      if ("key" in child && equals(key, child.key)) {
        const value = child.value;
        const newValue2 = f(value);
        if (newValue2 === value)
          return list;
        if (isNone2(newValue2)) {
          --size.value;
          return arraySpliceOut(mutate, i, list);
        }
        return arrayUpdate(mutate, i, new LeafNode(edit, hash2, key, newValue2), list);
      }
    }
    const newValue = f(none2());
    if (isNone2(newValue))
      return list;
    ++size.value;
    return arrayUpdate(mutate, len, new LeafNode(edit, hash2, key, newValue), list);
  }
}

class IndexedNode {
  edit;
  mask;
  children;
  _tag = "IndexedNode";
  constructor(edit, mask, children) {
    this.edit = edit;
    this.mask = mask;
    this.children = children;
  }
  modify(edit, shift, f, hash2, key, size) {
    const mask = this.mask;
    const children = this.children;
    const frag = hashFragment(shift, hash2);
    const bit = toBitmap(frag);
    const indx = fromBitmap(mask, bit);
    const exists2 = mask & bit;
    const canEdit = canEditNode(this, edit);
    if (!exists2) {
      const _newChild = new EmptyNode().modify(edit, shift + SIZE, f, hash2, key, size);
      if (!_newChild)
        return this;
      return children.length >= MAX_INDEX_NODE ? expand(edit, frag, _newChild, mask, children) : new IndexedNode(edit, mask | bit, arraySpliceIn(canEdit, indx, _newChild, children));
    }
    const current = children[indx];
    const child = current.modify(edit, shift + SIZE, f, hash2, key, size);
    if (current === child)
      return this;
    let bitmap = mask;
    let newChildren;
    if (isEmptyNode(child)) {
      bitmap &= ~bit;
      if (!bitmap)
        return new EmptyNode;
      if (children.length <= 2 && isLeafNode(children[indx ^ 1])) {
        return children[indx ^ 1];
      }
      newChildren = arraySpliceOut(canEdit, indx, children);
    } else {
      newChildren = arrayUpdate(canEdit, indx, child, children);
    }
    if (canEdit) {
      this.mask = bitmap;
      this.children = newChildren;
      return this;
    }
    return new IndexedNode(edit, bitmap, newChildren);
  }
}

class ArrayNode {
  edit;
  size;
  children;
  _tag = "ArrayNode";
  constructor(edit, size, children) {
    this.edit = edit;
    this.size = size;
    this.children = children;
  }
  modify(edit, shift, f, hash2, key, size) {
    let count = this.size;
    const children = this.children;
    const frag = hashFragment(shift, hash2);
    const child = children[frag];
    const newChild = (child || new EmptyNode).modify(edit, shift + SIZE, f, hash2, key, size);
    if (child === newChild)
      return this;
    const canEdit = canEditNode(this, edit);
    let newChildren;
    if (isEmptyNode(child) && !isEmptyNode(newChild)) {
      ++count;
      newChildren = arrayUpdate(canEdit, frag, newChild, children);
    } else if (!isEmptyNode(child) && isEmptyNode(newChild)) {
      --count;
      if (count <= MIN_ARRAY_NODE) {
        return pack(edit, count, frag, children);
      }
      newChildren = arrayUpdate(canEdit, frag, new EmptyNode, children);
    } else {
      newChildren = arrayUpdate(canEdit, frag, newChild, children);
    }
    if (canEdit) {
      this.size = count;
      this.children = newChildren;
      return this;
    }
    return new ArrayNode(edit, count, newChildren);
  }
}
function pack(edit, count, removed, elements) {
  const children = new Array(count - 1);
  let g = 0;
  let bitmap = 0;
  for (let i = 0, len = elements.length;i < len; ++i) {
    if (i !== removed) {
      const elem = elements[i];
      if (elem && !isEmptyNode(elem)) {
        children[g++] = elem;
        bitmap |= 1 << i;
      }
    }
  }
  return new IndexedNode(edit, bitmap, children);
}
function expand(edit, frag, child, bitmap, subNodes) {
  const arr = [];
  let bit = bitmap;
  let count = 0;
  for (let i = 0;bit; ++i) {
    if (bit & 1)
      arr[i] = subNodes[count++];
    bit >>>= 1;
  }
  arr[frag] = child;
  return new ArrayNode(edit, count + 1, arr);
}
function mergeLeavesInner(edit, shift, h1, n1, h2, n2) {
  if (h1 === h2)
    return new CollisionNode(edit, h1, [n2, n1]);
  const subH1 = hashFragment(shift, h1);
  const subH2 = hashFragment(shift, h2);
  if (subH1 === subH2) {
    return (child) => new IndexedNode(edit, toBitmap(subH1) | toBitmap(subH2), [child]);
  } else {
    const children = subH1 < subH2 ? [n1, n2] : [n2, n1];
    return new IndexedNode(edit, toBitmap(subH1) | toBitmap(subH2), children);
  }
}
function mergeLeaves(edit, shift, h1, n1, h2, n2) {
  let stack = undefined;
  let currentShift = shift;
  while (true) {
    const res = mergeLeavesInner(edit, currentShift, h1, n1, h2, n2);
    if (typeof res === "function") {
      stack = make5(res, stack);
      currentShift = currentShift + SIZE;
    } else {
      let final = res;
      while (stack != null) {
        final = stack.value(final);
        stack = stack.previous;
      }
      return final;
    }
  }
}
var init_node = __esm(() => {
  init_Equal();
  init_Option();
  init_Predicate();
  init_bitwise();
  init_config();
});

// node_modules/effect/dist/esm/internal/hashMap.js
var HashMapSymbolKey = "effect/HashMap", HashMapTypeId, HashMapProto, makeImpl = (editable, edit, root, size) => {
  const map3 = Object.create(HashMapProto);
  map3._editable = editable;
  map3._edit = edit;
  map3._root = root;
  map3._size = size;
  return map3;
}, HashMapIterator, applyCont = (cont) => cont ? visitLazyChildren(cont[0], cont[1], cont[2], cont[3], cont[4]) : none2(), visitLazy = (node, f, cont = undefined) => {
  switch (node._tag) {
    case "LeafNode": {
      if (isSome2(node.value)) {
        return some2({
          value: f(node.key, node.value.value),
          cont
        });
      }
      return applyCont(cont);
    }
    case "CollisionNode":
    case "ArrayNode":
    case "IndexedNode": {
      const children = node.children;
      return visitLazyChildren(children.length, children, 0, f, cont);
    }
    default: {
      return applyCont(cont);
    }
  }
}, visitLazyChildren = (len, children, i, f, cont) => {
  while (i < len) {
    const child = children[i++];
    if (child && !isEmptyNode(child)) {
      return visitLazy(child, f, [len, children, i, f, cont]);
    }
  }
  return applyCont(cont);
}, _empty2, empty3 = () => _empty2, fromIterable4 = (entries) => {
  const map3 = beginMutation(empty3());
  for (const entry of entries) {
    set(map3, entry[0], entry[1]);
  }
  return endMutation(map3);
}, isHashMap = (u) => hasProperty(u, HashMapTypeId), isEmpty2 = (self) => self && isEmptyNode(self._root), get3, getHash, has, set, setTree, keys = (self) => new HashMapIterator(self, (key) => key), size = (self) => self._size, beginMutation = (self) => makeImpl(true, self._edit + 1, self._root, self._size), endMutation = (self) => {
  self._editable = false;
  return self;
}, mutate, modifyAt, modifyHash, remove2, map3, forEach, reduce2;
var init_hashMap = __esm(() => {
  init_Equal();
  init_Function();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Pipeable();
  init_Predicate();
  init_bitwise();
  init_config();
  init_node();
  HashMapTypeId = /* @__PURE__ */ Symbol.for(HashMapSymbolKey);
  HashMapProto = {
    [HashMapTypeId]: HashMapTypeId,
    [Symbol.iterator]() {
      return new HashMapIterator(this, (k, v) => [k, v]);
    },
    [symbol]() {
      let hash2 = hash(HashMapSymbolKey);
      for (const item of this) {
        hash2 ^= pipe(hash(item[0]), combine(hash(item[1])));
      }
      return cached(this, hash2);
    },
    [symbol2](that) {
      if (isHashMap(that)) {
        if (that._size !== this._size) {
          return false;
        }
        for (const item of this) {
          const elem = pipe(that, getHash(item[0], hash(item[0])));
          if (isNone2(elem)) {
            return false;
          } else {
            if (!equals(item[1], elem.value)) {
              return false;
            }
          }
        }
        return true;
      }
      return false;
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "HashMap",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  HashMapIterator = class HashMapIterator {
    map;
    f;
    v;
    constructor(map3, f) {
      this.map = map3;
      this.f = f;
      this.v = visitLazy(this.map._root, this.f, undefined);
    }
    next() {
      if (isNone2(this.v)) {
        return {
          done: true,
          value: undefined
        };
      }
      const v0 = this.v.value;
      this.v = applyCont(v0.cont);
      return {
        done: false,
        value: v0.value
      };
    }
    [Symbol.iterator]() {
      return new HashMapIterator(this.map, this.f);
    }
  };
  _empty2 = /* @__PURE__ */ makeImpl(false, 0, /* @__PURE__ */ new EmptyNode, 0);
  get3 = /* @__PURE__ */ dual(2, (self, key) => getHash(self, key, hash(key)));
  getHash = /* @__PURE__ */ dual(3, (self, key, hash2) => {
    let node = self._root;
    let shift = 0;
    while (true) {
      switch (node._tag) {
        case "LeafNode": {
          return equals(key, node.key) ? node.value : none2();
        }
        case "CollisionNode": {
          if (hash2 === node.hash) {
            const children = node.children;
            for (let i = 0, len = children.length;i < len; ++i) {
              const child = children[i];
              if ("key" in child && equals(key, child.key)) {
                return child.value;
              }
            }
          }
          return none2();
        }
        case "IndexedNode": {
          const frag = hashFragment(shift, hash2);
          const bit = toBitmap(frag);
          if (node.mask & bit) {
            node = node.children[fromBitmap(node.mask, bit)];
            shift += SIZE;
            break;
          }
          return none2();
        }
        case "ArrayNode": {
          node = node.children[hashFragment(shift, hash2)];
          if (node) {
            shift += SIZE;
            break;
          }
          return none2();
        }
        default:
          return none2();
      }
    }
  });
  has = /* @__PURE__ */ dual(2, (self, key) => isSome2(getHash(self, key, hash(key))));
  set = /* @__PURE__ */ dual(3, (self, key, value) => modifyAt(self, key, () => some2(value)));
  setTree = /* @__PURE__ */ dual(3, (self, newRoot, newSize) => {
    if (self._editable) {
      self._root = newRoot;
      self._size = newSize;
      return self;
    }
    return newRoot === self._root ? self : makeImpl(self._editable, self._edit, newRoot, newSize);
  });
  mutate = /* @__PURE__ */ dual(2, (self, f) => {
    const transient = beginMutation(self);
    f(transient);
    return endMutation(transient);
  });
  modifyAt = /* @__PURE__ */ dual(3, (self, key, f) => modifyHash(self, key, hash(key), f));
  modifyHash = /* @__PURE__ */ dual(4, (self, key, hash2, f) => {
    const size2 = {
      value: self._size
    };
    const newRoot = self._root.modify(self._editable ? self._edit : NaN, 0, f, hash2, key, size2);
    return pipe(self, setTree(newRoot, size2.value));
  });
  remove2 = /* @__PURE__ */ dual(2, (self, key) => modifyAt(self, key, none2));
  map3 = /* @__PURE__ */ dual(2, (self, f) => reduce2(self, empty3(), (map4, value, key) => set(map4, key, f(value, key))));
  forEach = /* @__PURE__ */ dual(2, (self, f) => reduce2(self, undefined, (_, value, key) => f(value, key)));
  reduce2 = /* @__PURE__ */ dual(3, (self, zero, f) => {
    const root = self._root;
    if (root._tag === "LeafNode") {
      return isSome2(root.value) ? f(zero, root.value.value, root.key) : zero;
    }
    if (root._tag === "EmptyNode") {
      return zero;
    }
    const toVisit = [root.children];
    let children;
    while (children = toVisit.pop()) {
      for (let i = 0, len = children.length;i < len; ) {
        const child = children[i++];
        if (child && !isEmptyNode(child)) {
          if (child._tag === "LeafNode") {
            if (isSome2(child.value)) {
              zero = f(zero, child.value.value, child.key);
            }
          } else {
            toVisit.push(child.children);
          }
        }
      }
    }
    return zero;
  });
});

// node_modules/effect/dist/esm/internal/hashSet.js
var HashSetSymbolKey = "effect/HashSet", HashSetTypeId, HashSetProto, makeImpl2 = (keyMap) => {
  const set2 = Object.create(HashSetProto);
  set2._keyMap = keyMap;
  return set2;
}, isHashSet = (u) => hasProperty(u, HashSetTypeId), _empty3, empty4 = () => _empty3, fromIterable5 = (elements) => {
  const set2 = beginMutation2(empty4());
  for (const value of elements) {
    add(set2, value);
  }
  return endMutation2(set2);
}, make6 = (...elements) => {
  const set2 = beginMutation2(empty4());
  for (const value of elements) {
    add(set2, value);
  }
  return endMutation2(set2);
}, has2, size2 = (self) => size(self._keyMap), beginMutation2 = (self) => makeImpl2(beginMutation(self._keyMap)), endMutation2 = (self) => {
  self._keyMap._editable = false;
  return self;
}, mutate2, add, remove3, difference2, union2, map4, flatMap3, forEach2, reduce3;
var init_hashSet = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Pipeable();
  init_Predicate();
  init_hashMap();
  HashSetTypeId = /* @__PURE__ */ Symbol.for(HashSetSymbolKey);
  HashSetProto = {
    [HashSetTypeId]: HashSetTypeId,
    [Symbol.iterator]() {
      return keys(this._keyMap);
    },
    [symbol]() {
      return cached(this, combine(hash(this._keyMap))(hash(HashSetSymbolKey)));
    },
    [symbol2](that) {
      if (isHashSet(that)) {
        return size(this._keyMap) === size(that._keyMap) && equals(this._keyMap, that._keyMap);
      }
      return false;
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "HashSet",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  _empty3 = /* @__PURE__ */ makeImpl2(/* @__PURE__ */ empty3());
  has2 = /* @__PURE__ */ dual(2, (self, value) => has(self._keyMap, value));
  mutate2 = /* @__PURE__ */ dual(2, (self, f) => {
    const transient = beginMutation2(self);
    f(transient);
    return endMutation2(transient);
  });
  add = /* @__PURE__ */ dual(2, (self, value) => self._keyMap._editable ? (set(value, true)(self._keyMap), self) : makeImpl2(set(value, true)(self._keyMap)));
  remove3 = /* @__PURE__ */ dual(2, (self, value) => self._keyMap._editable ? (remove2(value)(self._keyMap), self) : makeImpl2(remove2(value)(self._keyMap)));
  difference2 = /* @__PURE__ */ dual(2, (self, that) => mutate2(self, (set2) => {
    for (const value of that) {
      remove3(set2, value);
    }
  }));
  union2 = /* @__PURE__ */ dual(2, (self, that) => mutate2(empty4(), (set2) => {
    forEach2(self, (value) => add(set2, value));
    for (const value of that) {
      add(set2, value);
    }
  }));
  map4 = /* @__PURE__ */ dual(2, (self, f) => mutate2(empty4(), (set2) => {
    forEach2(self, (a) => {
      const b = f(a);
      if (!has2(set2, b)) {
        add(set2, b);
      }
    });
  }));
  flatMap3 = /* @__PURE__ */ dual(2, (self, f) => mutate2(empty4(), (set2) => {
    forEach2(self, (a) => {
      for (const b of f(a)) {
        if (!has2(set2, b)) {
          add(set2, b);
        }
      }
    });
  }));
  forEach2 = /* @__PURE__ */ dual(2, (self, f) => forEach(self._keyMap, (_, k) => f(k)));
  reduce3 = /* @__PURE__ */ dual(3, (self, zero, f) => reduce2(self._keyMap, zero, (z, _, a) => f(z, a)));
});

// node_modules/effect/dist/esm/HashSet.js
var empty5, fromIterable6, make7, has3, size3, add2, remove4, difference3, union3, map5, flatMap4, reduce4;
var init_HashSet = __esm(() => {
  init_hashSet();
  empty5 = empty4;
  fromIterable6 = fromIterable5;
  make7 = make6;
  has3 = has2;
  size3 = size2;
  add2 = add;
  remove4 = remove3;
  difference3 = difference2;
  union3 = union2;
  map5 = map4;
  flatMap4 = flatMap3;
  reduce4 = reduce3;
});

// node_modules/effect/dist/esm/internal/opCodes/cause.js
var OP_DIE = "Die", OP_EMPTY = "Empty", OP_FAIL = "Fail", OP_INTERRUPT = "Interrupt", OP_PARALLEL = "Parallel", OP_SEQUENTIAL = "Sequential";

// node_modules/effect/dist/esm/internal/cause.js
var CauseSymbolKey = "effect/Cause", CauseTypeId, variance, proto, empty6, fail = (error) => {
  const o = Object.create(proto);
  o._tag = OP_FAIL;
  o.error = error;
  return o;
}, die = (defect) => {
  const o = Object.create(proto);
  o._tag = OP_DIE;
  o.defect = defect;
  return o;
}, interrupt = (fiberId) => {
  const o = Object.create(proto);
  o._tag = OP_INTERRUPT;
  o.fiberId = fiberId;
  return o;
}, parallel = (left3, right3) => {
  const o = Object.create(proto);
  o._tag = OP_PARALLEL;
  o.left = left3;
  o.right = right3;
  return o;
}, sequential = (left3, right3) => {
  const o = Object.create(proto);
  o._tag = OP_SEQUENTIAL;
  o.left = left3;
  o.right = right3;
  return o;
}, isCause = (u) => hasProperty(u, CauseTypeId), isEmptyType = (self) => self._tag === OP_EMPTY, isFailType = (self) => self._tag === OP_FAIL, isDieType = (self) => self._tag === OP_DIE, isInterruptType = (self) => self._tag === OP_INTERRUPT, isSequentialType = (self) => self._tag === OP_SEQUENTIAL, isParallelType = (self) => self._tag === OP_PARALLEL, size4 = (self) => reduceWithContext(self, undefined, SizeCauseReducer), isEmpty3 = (self) => {
  if (self._tag === OP_EMPTY) {
    return true;
  }
  return reduce5(self, true, (acc, cause) => {
    switch (cause._tag) {
      case OP_EMPTY: {
        return some2(acc);
      }
      case OP_DIE:
      case OP_FAIL:
      case OP_INTERRUPT: {
        return some2(false);
      }
      default: {
        return none2();
      }
    }
  });
}, isFailure = (self) => isSome2(failureOption(self)), isDie = (self) => isSome2(dieOption(self)), isInterrupted = (self) => isSome2(interruptOption(self)), isInterruptedOnly = (self) => reduceWithContext(undefined, IsInterruptedOnlyCauseReducer)(self), failures = (self) => reverse2(reduce5(self, empty2(), (list, cause) => cause._tag === OP_FAIL ? some2(pipe(list, prepend2(cause.error))) : none2())), defects = (self) => reverse2(reduce5(self, empty2(), (list, cause) => cause._tag === OP_DIE ? some2(pipe(list, prepend2(cause.defect))) : none2())), interruptors = (self) => reduce5(self, empty5(), (set2, cause) => cause._tag === OP_INTERRUPT ? some2(pipe(set2, add2(cause.fiberId))) : none2()), failureOption = (self) => find(self, (cause) => cause._tag === OP_FAIL ? some2(cause.error) : none2()), failureOrCause = (self) => {
  const option = failureOption(self);
  switch (option._tag) {
    case "None": {
      return right2(self);
    }
    case "Some": {
      return left2(option.value);
    }
  }
}, dieOption = (self) => find(self, (cause) => cause._tag === OP_DIE ? some2(cause.defect) : none2()), flipCauseOption = (self) => match3(self, {
  onEmpty: some2(empty6),
  onFail: map(fail),
  onDie: (defect) => some2(die(defect)),
  onInterrupt: (fiberId) => some2(interrupt(fiberId)),
  onSequential: mergeWith(sequential),
  onParallel: mergeWith(parallel)
}), interruptOption = (self) => find(self, (cause) => cause._tag === OP_INTERRUPT ? some2(cause.fiberId) : none2()), keepDefects = (self) => match3(self, {
  onEmpty: none2(),
  onFail: () => none2(),
  onDie: (defect) => some2(die(defect)),
  onInterrupt: () => none2(),
  onSequential: mergeWith(sequential),
  onParallel: mergeWith(parallel)
}), keepDefectsAndElectFailures = (self) => match3(self, {
  onEmpty: none2(),
  onFail: (failure) => some2(die(failure)),
  onDie: (defect) => some2(die(defect)),
  onInterrupt: () => none2(),
  onSequential: mergeWith(sequential),
  onParallel: mergeWith(parallel)
}), linearize = (self) => match3(self, {
  onEmpty: empty5(),
  onFail: (error) => make7(fail(error)),
  onDie: (defect) => make7(die(defect)),
  onInterrupt: (fiberId) => make7(interrupt(fiberId)),
  onSequential: (leftSet, rightSet) => flatMap4(leftSet, (leftCause) => map5(rightSet, (rightCause) => sequential(leftCause, rightCause))),
  onParallel: (leftSet, rightSet) => flatMap4(leftSet, (leftCause) => map5(rightSet, (rightCause) => parallel(leftCause, rightCause)))
}), stripFailures = (self) => match3(self, {
  onEmpty: empty6,
  onFail: () => empty6,
  onDie: die,
  onInterrupt: interrupt,
  onSequential: sequential,
  onParallel: parallel
}), electFailures = (self) => match3(self, {
  onEmpty: empty6,
  onFail: die,
  onDie: die,
  onInterrupt: interrupt,
  onSequential: sequential,
  onParallel: parallel
}), stripSomeDefects, as2, map6, flatMap5, flatten3 = (self) => flatMap5(self, identity), andThen2, contains3, causeEquals = (left3, right3) => {
  let leftStack = of2(left3);
  let rightStack = of2(right3);
  while (isNonEmpty(leftStack) && isNonEmpty(rightStack)) {
    const [leftParallel, leftSequential] = pipe(headNonEmpty2(leftStack), reduce5([empty5(), empty2()], ([parallel2, sequential2], cause) => {
      const [par, seq] = evaluateCause(cause);
      return some2([pipe(parallel2, union3(par)), pipe(sequential2, appendAll2(seq))]);
    }));
    const [rightParallel, rightSequential] = pipe(headNonEmpty2(rightStack), reduce5([empty5(), empty2()], ([parallel2, sequential2], cause) => {
      const [par, seq] = evaluateCause(cause);
      return some2([pipe(parallel2, union3(par)), pipe(sequential2, appendAll2(seq))]);
    }));
    if (!equals(leftParallel, rightParallel)) {
      return false;
    }
    leftStack = leftSequential;
    rightStack = rightSequential;
  }
  return true;
}, flattenCause = (cause) => {
  return flattenCauseLoop(of2(cause), empty2());
}, flattenCauseLoop = (causes, flattened) => {
  while (true) {
    const [parallel2, sequential2] = pipe(causes, reduce([empty5(), empty2()], ([parallel3, sequential3], cause) => {
      const [par, seq] = evaluateCause(cause);
      return [pipe(parallel3, union3(par)), pipe(sequential3, appendAll2(seq))];
    }));
    const updated = size3(parallel2) > 0 ? pipe(flattened, prepend2(parallel2)) : flattened;
    if (isEmpty(sequential2)) {
      return reverse2(updated);
    }
    causes = sequential2;
    flattened = updated;
  }
  throw new Error(getBugErrorMessage("Cause.flattenCauseLoop"));
}, find, filter4, evaluateCause = (self) => {
  let cause = self;
  const stack = [];
  let _parallel = empty5();
  let _sequential = empty2();
  while (cause !== undefined) {
    switch (cause._tag) {
      case OP_EMPTY: {
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause = stack.pop();
        break;
      }
      case OP_FAIL: {
        _parallel = add2(_parallel, make4(cause._tag, cause.error));
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause = stack.pop();
        break;
      }
      case OP_DIE: {
        _parallel = add2(_parallel, make4(cause._tag, cause.defect));
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause = stack.pop();
        break;
      }
      case OP_INTERRUPT: {
        _parallel = add2(_parallel, make4(cause._tag, cause.fiberId));
        if (stack.length === 0) {
          return [_parallel, _sequential];
        }
        cause = stack.pop();
        break;
      }
      case OP_SEQUENTIAL: {
        switch (cause.left._tag) {
          case OP_EMPTY: {
            cause = cause.right;
            break;
          }
          case OP_SEQUENTIAL: {
            cause = sequential(cause.left.left, sequential(cause.left.right, cause.right));
            break;
          }
          case OP_PARALLEL: {
            cause = parallel(sequential(cause.left.left, cause.right), sequential(cause.left.right, cause.right));
            break;
          }
          default: {
            _sequential = prepend2(_sequential, cause.right);
            cause = cause.left;
            break;
          }
        }
        break;
      }
      case OP_PARALLEL: {
        stack.push(cause.right);
        cause = cause.left;
        break;
      }
    }
  }
  throw new Error(getBugErrorMessage("Cause.evaluateCauseLoop"));
}, SizeCauseReducer, IsInterruptedOnlyCauseReducer, FilterCauseReducer = (predicate) => ({
  emptyCase: () => empty6,
  failCase: (_, error) => fail(error),
  dieCase: (_, defect) => die(defect),
  interruptCase: (_, fiberId) => interrupt(fiberId),
  sequentialCase: (_, left3, right3) => {
    if (predicate(left3)) {
      if (predicate(right3)) {
        return sequential(left3, right3);
      }
      return left3;
    }
    if (predicate(right3)) {
      return right3;
    }
    return empty6;
  },
  parallelCase: (_, left3, right3) => {
    if (predicate(left3)) {
      if (predicate(right3)) {
        return parallel(left3, right3);
      }
      return left3;
    }
    if (predicate(right3)) {
      return right3;
    }
    return empty6;
  }
}), OP_SEQUENTIAL_CASE = "SequentialCase", OP_PARALLEL_CASE = "ParallelCase", match3, reduce5, reduceWithContext, pretty = (cause, options) => {
  if (isInterruptedOnly(cause)) {
    return "All fibers interrupted without errors.";
  }
  return prettyErrors(cause).map(function(e) {
    if (options?.renderErrorCause !== true || e.cause === undefined) {
      return e.stack;
    }
    return `${e.stack} {
${renderErrorCause(e.cause, "  ")}
}`;
  }).join(`
`);
}, renderErrorCause = (cause, prefix) => {
  const lines = cause.stack.split(`
`);
  let stack = `${prefix}[cause]: ${lines[0]}`;
  for (let i = 1, len = lines.length;i < len; i++) {
    stack += `
${prefix}${lines[i]}`;
  }
  if (cause.cause) {
    stack += ` {
${renderErrorCause(cause.cause, `${prefix}  `)}
${prefix}}`;
  }
  return stack;
}, makePrettyError = (originalError) => {
  const originalErrorIsObject = typeof originalError === "object" && originalError !== null;
  const prevLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 1;
  const error = new Error(prettyErrorMessage(originalError), originalErrorIsObject && "cause" in originalError && typeof originalError.cause !== "undefined" ? {
    cause: makePrettyError(originalError.cause)
  } : undefined);
  Error.stackTraceLimit = prevLimit;
  if (error.message === "") {
    error.message = "An error has occurred";
  }
  Error.stackTraceLimit = prevLimit;
  error.name = originalError instanceof Error ? originalError.name : "Error";
  if (originalErrorIsObject) {
    if (spanSymbol in originalError) {
      error.span = originalError[spanSymbol];
    }
    Object.keys(originalError).forEach((key) => {
      if (!(key in error)) {
        error[key] = originalError[key];
      }
    });
  }
  error.stack = prettyErrorStack(`${error.name}: ${error.message}`, originalError instanceof Error && originalError.stack ? originalError.stack : "", error.span);
  return error;
}, prettyErrorMessage = (u) => {
  if (typeof u === "string") {
    return u;
  }
  if (typeof u === "object" && u !== null && u instanceof Error) {
    return u.message;
  }
  try {
    if (hasProperty(u, "toString") && isFunction2(u["toString"]) && u["toString"] !== Object.prototype.toString && u["toString"] !== globalThis.Array.prototype.toString) {
      return u["toString"]();
    }
  } catch {}
  return stringifyCircular(u);
}, locationRegex, spanToTrace, prettyErrorStack = (message, stack, span2) => {
  const out = [message];
  const lines = stack.startsWith(message) ? stack.slice(message.length).split(`
`) : stack.split(`
`);
  for (let i = 1;i < lines.length; i++) {
    if (lines[i].includes(" at new BaseEffectError") || lines[i].includes(" at new YieldableError")) {
      i++;
      continue;
    }
    if (lines[i].includes("Generator.next")) {
      break;
    }
    if (lines[i].includes("effect_internal_function")) {
      break;
    }
    out.push(lines[i].replace(/at .*effect_instruction_i.*\((.*)\)/, "at $1").replace(/EffectPrimitive\.\w+/, "<anonymous>"));
  }
  if (span2) {
    let current = span2;
    let i = 0;
    while (current && current._tag === "Span" && i < 10) {
      const stackFn = spanToTrace.get(current);
      if (typeof stackFn === "function") {
        const stack2 = stackFn();
        if (typeof stack2 === "string") {
          const locationMatchAll = stack2.matchAll(locationRegex);
          let match4 = false;
          for (const [, location] of locationMatchAll) {
            match4 = true;
            out.push(`    at ${current.name} (${location})`);
          }
          if (!match4) {
            out.push(`    at ${current.name} (${stack2.replace(/^at /, "")})`);
          }
        } else {
          out.push(`    at ${current.name}`);
        }
      } else {
        out.push(`    at ${current.name}`);
      }
      current = getOrUndefined(current.parent);
      i++;
    }
  }
  return out.join(`
`);
}, spanSymbol, prettyErrors = (cause) => reduceWithContext(cause, undefined, {
  emptyCase: () => [],
  dieCase: (_, unknownError) => {
    return [makePrettyError(unknownError)];
  },
  failCase: (_, error) => {
    return [makePrettyError(error)];
  },
  interruptCase: () => [],
  parallelCase: (_, l, r) => [...l, ...r],
  sequentialCase: (_, l, r) => [...l, ...r]
});
var init_cause = __esm(() => {
  init_Array();
  init_Chunk();
  init_Either();
  init_Equal();
  init_Function();
  init_Hash();
  init_HashSet();
  init_Inspectable();
  init_Option();
  init_Pipeable();
  init_Predicate();
  CauseTypeId = /* @__PURE__ */ Symbol.for(CauseSymbolKey);
  variance = {
    _E: (_) => _
  };
  proto = {
    [CauseTypeId]: variance,
    [symbol]() {
      return pipe(hash(CauseSymbolKey), combine(hash(flattenCause(this))), cached(this));
    },
    [symbol2](that) {
      return isCause(that) && causeEquals(this, that);
    },
    pipe() {
      return pipeArguments(this, arguments);
    },
    toJSON() {
      switch (this._tag) {
        case "Empty":
          return {
            _id: "Cause",
            _tag: this._tag
          };
        case "Die":
          return {
            _id: "Cause",
            _tag: this._tag,
            defect: toJSON(this.defect)
          };
        case "Interrupt":
          return {
            _id: "Cause",
            _tag: this._tag,
            fiberId: this.fiberId.toJSON()
          };
        case "Fail":
          return {
            _id: "Cause",
            _tag: this._tag,
            failure: toJSON(this.error)
          };
        case "Sequential":
        case "Parallel":
          return {
            _id: "Cause",
            _tag: this._tag,
            left: toJSON(this.left),
            right: toJSON(this.right)
          };
      }
    },
    toString() {
      return pretty(this);
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  empty6 = /* @__PURE__ */ (() => {
    const o = /* @__PURE__ */ Object.create(proto);
    o._tag = OP_EMPTY;
    return o;
  })();
  stripSomeDefects = /* @__PURE__ */ dual(2, (self, pf) => match3(self, {
    onEmpty: some2(empty6),
    onFail: (error) => some2(fail(error)),
    onDie: (defect) => {
      const option = pf(defect);
      return isSome2(option) ? none2() : some2(die(defect));
    },
    onInterrupt: (fiberId) => some2(interrupt(fiberId)),
    onSequential: mergeWith(sequential),
    onParallel: mergeWith(parallel)
  }));
  as2 = /* @__PURE__ */ dual(2, (self, error) => map6(self, () => error));
  map6 = /* @__PURE__ */ dual(2, (self, f) => flatMap5(self, (e) => fail(f(e))));
  flatMap5 = /* @__PURE__ */ dual(2, (self, f) => match3(self, {
    onEmpty: empty6,
    onFail: (error) => f(error),
    onDie: (defect) => die(defect),
    onInterrupt: (fiberId) => interrupt(fiberId),
    onSequential: (left3, right3) => sequential(left3, right3),
    onParallel: (left3, right3) => parallel(left3, right3)
  }));
  andThen2 = /* @__PURE__ */ dual(2, (self, f) => isFunction2(f) ? flatMap5(self, f) : flatMap5(self, () => f));
  contains3 = /* @__PURE__ */ dual(2, (self, that) => {
    if (that._tag === OP_EMPTY || self === that) {
      return true;
    }
    return reduce5(self, false, (accumulator, cause) => {
      return some2(accumulator || causeEquals(cause, that));
    });
  });
  find = /* @__PURE__ */ dual(2, (self, pf) => {
    const stack = [self];
    while (stack.length > 0) {
      const item = stack.pop();
      const option = pf(item);
      switch (option._tag) {
        case "None": {
          switch (item._tag) {
            case OP_SEQUENTIAL:
            case OP_PARALLEL: {
              stack.push(item.right);
              stack.push(item.left);
              break;
            }
          }
          break;
        }
        case "Some": {
          return option;
        }
      }
    }
    return none2();
  });
  filter4 = /* @__PURE__ */ dual(2, (self, predicate) => reduceWithContext(self, undefined, FilterCauseReducer(predicate)));
  SizeCauseReducer = {
    emptyCase: () => 0,
    failCase: () => 1,
    dieCase: () => 1,
    interruptCase: () => 1,
    sequentialCase: (_, left3, right3) => left3 + right3,
    parallelCase: (_, left3, right3) => left3 + right3
  };
  IsInterruptedOnlyCauseReducer = {
    emptyCase: constTrue,
    failCase: constFalse,
    dieCase: constFalse,
    interruptCase: constTrue,
    sequentialCase: (_, left3, right3) => left3 && right3,
    parallelCase: (_, left3, right3) => left3 && right3
  };
  match3 = /* @__PURE__ */ dual(2, (self, {
    onDie,
    onEmpty,
    onFail,
    onInterrupt,
    onParallel,
    onSequential
  }) => {
    return reduceWithContext(self, undefined, {
      emptyCase: () => onEmpty,
      failCase: (_, error) => onFail(error),
      dieCase: (_, defect) => onDie(defect),
      interruptCase: (_, fiberId) => onInterrupt(fiberId),
      sequentialCase: (_, left3, right3) => onSequential(left3, right3),
      parallelCase: (_, left3, right3) => onParallel(left3, right3)
    });
  });
  reduce5 = /* @__PURE__ */ dual(3, (self, zero, pf) => {
    let accumulator = zero;
    let cause = self;
    const causes = [];
    while (cause !== undefined) {
      const option = pf(accumulator, cause);
      accumulator = isSome2(option) ? option.value : accumulator;
      switch (cause._tag) {
        case OP_SEQUENTIAL: {
          causes.push(cause.right);
          cause = cause.left;
          break;
        }
        case OP_PARALLEL: {
          causes.push(cause.right);
          cause = cause.left;
          break;
        }
        default: {
          cause = undefined;
          break;
        }
      }
      if (cause === undefined && causes.length > 0) {
        cause = causes.pop();
      }
    }
    return accumulator;
  });
  reduceWithContext = /* @__PURE__ */ dual(3, (self, context, reducer) => {
    const input = [self];
    const output = [];
    while (input.length > 0) {
      const cause = input.pop();
      switch (cause._tag) {
        case OP_EMPTY: {
          output.push(right2(reducer.emptyCase(context)));
          break;
        }
        case OP_FAIL: {
          output.push(right2(reducer.failCase(context, cause.error)));
          break;
        }
        case OP_DIE: {
          output.push(right2(reducer.dieCase(context, cause.defect)));
          break;
        }
        case OP_INTERRUPT: {
          output.push(right2(reducer.interruptCase(context, cause.fiberId)));
          break;
        }
        case OP_SEQUENTIAL: {
          input.push(cause.right);
          input.push(cause.left);
          output.push(left2({
            _tag: OP_SEQUENTIAL_CASE
          }));
          break;
        }
        case OP_PARALLEL: {
          input.push(cause.right);
          input.push(cause.left);
          output.push(left2({
            _tag: OP_PARALLEL_CASE
          }));
          break;
        }
      }
    }
    const accumulator = [];
    while (output.length > 0) {
      const either = output.pop();
      switch (either._tag) {
        case "Left": {
          switch (either.left._tag) {
            case OP_SEQUENTIAL_CASE: {
              const left3 = accumulator.pop();
              const right3 = accumulator.pop();
              const value = reducer.sequentialCase(context, left3, right3);
              accumulator.push(value);
              break;
            }
            case OP_PARALLEL_CASE: {
              const left3 = accumulator.pop();
              const right3 = accumulator.pop();
              const value = reducer.parallelCase(context, left3, right3);
              accumulator.push(value);
              break;
            }
          }
          break;
        }
        case "Right": {
          accumulator.push(either.right);
          break;
        }
      }
    }
    if (accumulator.length === 0) {
      throw new Error("BUG: Cause.reduceWithContext - please report an issue at https://github.com/Effect-TS/effect/issues");
    }
    return accumulator.pop();
  });
  locationRegex = /\((.*)\)/g;
  spanToTrace = /* @__PURE__ */ globalValue("effect/Tracer/spanToTrace", () => new WeakMap);
  spanSymbol = /* @__PURE__ */ Symbol.for("effect/SpanAnnotation");
});

// node_modules/effect/dist/esm/internal/context.js
var TagTypeId, ReferenceTypeId, STMSymbolKey = "effect/STM", STMTypeId, TagProto, ReferenceProto, makeGenericTag = (key) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error;
  Error.stackTraceLimit = limit;
  const tag = Object.create(TagProto);
  Object.defineProperty(tag, "stack", {
    get() {
      return creationError.stack;
    }
  });
  tag.key = key;
  return tag;
}, Tag = (id) => () => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error;
  Error.stackTraceLimit = limit;
  function TagClass() {}
  Object.setPrototypeOf(TagClass, TagProto);
  TagClass.key = id;
  Object.defineProperty(TagClass, "stack", {
    get() {
      return creationError.stack;
    }
  });
  return TagClass;
}, Reference = () => (id, options) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error;
  Error.stackTraceLimit = limit;
  function ReferenceClass() {}
  Object.setPrototypeOf(ReferenceClass, ReferenceProto);
  ReferenceClass.key = id;
  ReferenceClass.defaultValue = options.defaultValue;
  Object.defineProperty(ReferenceClass, "stack", {
    get() {
      return creationError.stack;
    }
  });
  return ReferenceClass;
}, TypeId5, ContextProto, makeContext = (unsafeMap) => {
  const context = Object.create(ContextProto);
  context.unsafeMap = unsafeMap;
  return context;
}, serviceNotFoundError = (tag) => {
  const error = new Error(`Service not found${tag.key ? `: ${String(tag.key)}` : ""}`);
  if (tag.stack) {
    const lines = tag.stack.split(`
`);
    if (lines.length > 2) {
      const afterAt = lines[2].match(/at (.*)/);
      if (afterAt) {
        error.message = error.message + ` (defined at ${afterAt[1]})`;
      }
    }
  }
  if (error.stack) {
    const lines = error.stack.split(`
`);
    lines.splice(1, 3);
    error.stack = lines.join(`
`);
  }
  return error;
}, isContext = (u) => hasProperty(u, TypeId5), isTag = (u) => hasProperty(u, TagTypeId), isReference = (u) => hasProperty(u, ReferenceTypeId), _empty4, empty7 = () => _empty4, make8 = (tag, service) => makeContext(new Map([[tag.key, service]])), add3, defaultValueCache, getDefaultValue = (tag) => {
  if (defaultValueCache.has(tag.key)) {
    return defaultValueCache.get(tag.key);
  }
  const value = tag.defaultValue();
  defaultValueCache.set(tag.key, value);
  return value;
}, unsafeGetReference = (self, tag) => {
  return self.unsafeMap.has(tag.key) ? self.unsafeMap.get(tag.key) : getDefaultValue(tag);
}, unsafeGet3, get4, getOrElse2, getOption, merge2, mergeAll = (...ctxs) => {
  const map7 = new Map;
  for (let i = 0;i < ctxs.length; i++) {
    ctxs[i].unsafeMap.forEach((value, key) => {
      map7.set(key, value);
    });
  }
  return makeContext(map7);
}, pick = (...tags) => (self) => {
  const tagSet = new Set(tags.map((_) => _.key));
  const newEnv = new Map;
  for (const [tag, s] of self.unsafeMap.entries()) {
    if (tagSet.has(tag)) {
      newEnv.set(tag, s);
    }
  }
  return makeContext(newEnv);
}, omit = (...tags) => (self) => {
  const newEnv = new Map(self.unsafeMap);
  for (const tag of tags) {
    newEnv.delete(tag.key);
  }
  return makeContext(newEnv);
};
var init_context = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Pipeable();
  init_Predicate();
  init_effectable();
  init_option();
  TagTypeId = /* @__PURE__ */ Symbol.for("effect/Context/Tag");
  ReferenceTypeId = /* @__PURE__ */ Symbol.for("effect/Context/Reference");
  STMTypeId = /* @__PURE__ */ Symbol.for(STMSymbolKey);
  TagProto = {
    ...EffectPrototype,
    _op: "Tag",
    [STMTypeId]: effectVariance,
    [TagTypeId]: {
      _Service: (_) => _,
      _Identifier: (_) => _
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "Tag",
        key: this.key,
        stack: this.stack
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    of(self) {
      return self;
    },
    context(self) {
      return make8(this, self);
    }
  };
  ReferenceProto = {
    ...TagProto,
    [ReferenceTypeId]: ReferenceTypeId
  };
  TypeId5 = /* @__PURE__ */ Symbol.for("effect/Context");
  ContextProto = {
    [TypeId5]: {
      _Services: (_) => _
    },
    [symbol2](that) {
      if (isContext(that)) {
        if (this.unsafeMap.size === that.unsafeMap.size) {
          for (const k of this.unsafeMap.keys()) {
            if (!that.unsafeMap.has(k) || !equals(this.unsafeMap.get(k), that.unsafeMap.get(k))) {
              return false;
            }
          }
          return true;
        }
      }
      return false;
    },
    [symbol]() {
      return cached(this, number(this.unsafeMap.size));
    },
    pipe() {
      return pipeArguments(this, arguments);
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "Context",
        services: Array.from(this.unsafeMap).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  _empty4 = /* @__PURE__ */ makeContext(/* @__PURE__ */ new Map);
  add3 = /* @__PURE__ */ dual(3, (self, tag, service) => {
    const map7 = new Map(self.unsafeMap);
    map7.set(tag.key, service);
    return makeContext(map7);
  });
  defaultValueCache = /* @__PURE__ */ globalValue("effect/Context/defaultValueCache", () => new Map);
  unsafeGet3 = /* @__PURE__ */ dual(2, (self, tag) => {
    if (!self.unsafeMap.has(tag.key)) {
      if (ReferenceTypeId in tag)
        return getDefaultValue(tag);
      throw serviceNotFoundError(tag);
    }
    return self.unsafeMap.get(tag.key);
  });
  get4 = unsafeGet3;
  getOrElse2 = /* @__PURE__ */ dual(3, (self, tag, orElse2) => {
    if (!self.unsafeMap.has(tag.key)) {
      return isReference(tag) ? getDefaultValue(tag) : orElse2();
    }
    return self.unsafeMap.get(tag.key);
  });
  getOption = /* @__PURE__ */ dual(2, (self, tag) => {
    if (!self.unsafeMap.has(tag.key)) {
      return isReference(tag) ? some(getDefaultValue(tag)) : none;
    }
    return some(self.unsafeMap.get(tag.key));
  });
  merge2 = /* @__PURE__ */ dual(2, (self, that) => {
    const map7 = new Map(self.unsafeMap);
    for (const [tag, s] of that.unsafeMap) {
      map7.set(tag, s);
    }
    return makeContext(map7);
  });
});

// node_modules/effect/dist/esm/Context.js
var exports_Context = {};
__export(exports_Context, {
  unsafeMake: () => unsafeMake,
  unsafeGet: () => unsafeGet4,
  pick: () => pick2,
  omit: () => omit2,
  mergeAll: () => mergeAll2,
  merge: () => merge3,
  make: () => make9,
  isTag: () => isTag2,
  isReference: () => isReference2,
  isContext: () => isContext2,
  getOrElse: () => getOrElse3,
  getOption: () => getOption2,
  get: () => get5,
  empty: () => empty8,
  add: () => add4,
  TagTypeId: () => TagTypeId2,
  Tag: () => Tag2,
  ReferenceTypeId: () => ReferenceTypeId2,
  Reference: () => Reference2,
  GenericTag: () => GenericTag
});
var TagTypeId2, ReferenceTypeId2, GenericTag, unsafeMake, isContext2, isTag2, isReference2, empty8, make9, add4, get5, getOrElse3, unsafeGet4, getOption2, merge3, mergeAll2, pick2, omit2, Tag2, Reference2;
var init_Context = __esm(() => {
  init_context();
  TagTypeId2 = TagTypeId;
  ReferenceTypeId2 = ReferenceTypeId;
  GenericTag = makeGenericTag;
  unsafeMake = makeContext;
  isContext2 = isContext;
  isTag2 = isTag;
  isReference2 = isReference;
  empty8 = empty7;
  make9 = make8;
  add4 = add3;
  get5 = get4;
  getOrElse3 = getOrElse2;
  unsafeGet4 = unsafeGet3;
  getOption2 = getOption;
  merge3 = merge2;
  mergeAll2 = mergeAll;
  pick2 = pick;
  omit2 = omit;
  Tag2 = Tag;
  Reference2 = Reference;
});

// node_modules/effect/dist/esm/Duration.js
var TypeId6, bigint0, bigint24, bigint60, bigint1e3, bigint1e6, bigint1e9, DURATION_REGEX, decode = (input) => {
  if (isDuration(input)) {
    return input;
  } else if (isNumber(input)) {
    return millis(input);
  } else if (isBigInt(input)) {
    return nanos(input);
  } else if (Array.isArray(input) && input.length === 2 && input.every(isNumber)) {
    if (input[0] === -Infinity || input[1] === -Infinity || Number.isNaN(input[0]) || Number.isNaN(input[1])) {
      return zero;
    }
    if (input[0] === Infinity || input[1] === Infinity) {
      return infinity;
    }
    return nanos(BigInt(Math.round(input[0] * 1e9)) + BigInt(Math.round(input[1])));
  } else if (isString(input)) {
    const match4 = DURATION_REGEX.exec(input);
    if (match4) {
      const [_, valueStr, unit] = match4;
      const value = Number(valueStr);
      switch (unit) {
        case "nano":
        case "nanos":
          return nanos(BigInt(valueStr));
        case "micro":
        case "micros":
          return micros(BigInt(valueStr));
        case "milli":
        case "millis":
          return millis(value);
        case "second":
        case "seconds":
          return seconds(value);
        case "minute":
        case "minutes":
          return minutes(value);
        case "hour":
        case "hours":
          return hours(value);
        case "day":
        case "days":
          return days(value);
        case "week":
        case "weeks":
          return weeks(value);
      }
    }
  }
  throw new Error("Invalid DurationInput");
}, zeroValue, infinityValue, DurationProto, make10 = (input) => {
  const duration = Object.create(DurationProto);
  if (isNumber(input)) {
    if (isNaN(input) || input <= 0) {
      duration.value = zeroValue;
    } else if (!Number.isFinite(input)) {
      duration.value = infinityValue;
    } else if (!Number.isInteger(input)) {
      duration.value = {
        _tag: "Nanos",
        nanos: BigInt(Math.round(input * 1e6))
      };
    } else {
      duration.value = {
        _tag: "Millis",
        millis: input
      };
    }
  } else if (input <= bigint0) {
    duration.value = zeroValue;
  } else {
    duration.value = {
      _tag: "Nanos",
      nanos: input
    };
  }
  return duration;
}, isDuration = (u) => hasProperty(u, TypeId6), isZero = (self) => {
  switch (self.value._tag) {
    case "Millis": {
      return self.value.millis === 0;
    }
    case "Nanos": {
      return self.value.nanos === bigint0;
    }
    case "Infinity": {
      return false;
    }
  }
}, zero, infinity, nanos = (nanos2) => make10(nanos2), micros = (micros2) => make10(micros2 * bigint1e3), millis = (millis2) => make10(millis2), seconds = (seconds2) => make10(seconds2 * 1000), minutes = (minutes2) => make10(minutes2 * 60000), hours = (hours2) => make10(hours2 * 3600000), days = (days2) => make10(days2 * 86400000), weeks = (weeks2) => make10(weeks2 * 604800000), toMillis = (self) => match4(self, {
  onMillis: (millis2) => millis2,
  onNanos: (nanos2) => Number(nanos2) / 1e6
}), unsafeToNanos = (self) => {
  const _self = decode(self);
  switch (_self.value._tag) {
    case "Infinity":
      throw new Error("Cannot convert infinite duration to nanos");
    case "Nanos":
      return _self.value.nanos;
    case "Millis":
      return BigInt(Math.round(_self.value.millis * 1e6));
  }
}, toHrTime = (self) => {
  const _self = decode(self);
  switch (_self.value._tag) {
    case "Infinity":
      return [Infinity, 0];
    case "Nanos":
      return [Number(_self.value.nanos / bigint1e9), Number(_self.value.nanos % bigint1e9)];
    case "Millis":
      return [Math.floor(_self.value.millis / 1000), Math.round(_self.value.millis % 1000 * 1e6)];
  }
}, match4, matchWith, Equivalence = (self, that) => matchWith(self, that, {
  onMillis: (self2, that2) => self2 === that2,
  onNanos: (self2, that2) => self2 === that2
}), lessThanOrEqualTo, greaterThanOrEqualTo, equals2, parts = (self) => {
  const duration = decode(self);
  if (duration.value._tag === "Infinity") {
    return {
      days: Infinity,
      hours: Infinity,
      minutes: Infinity,
      seconds: Infinity,
      millis: Infinity,
      nanos: Infinity
    };
  }
  const nanos2 = unsafeToNanos(duration);
  const ms = nanos2 / bigint1e6;
  const sec = ms / bigint1e3;
  const min = sec / bigint60;
  const hr = min / bigint60;
  const days2 = hr / bigint24;
  return {
    days: Number(days2),
    hours: Number(hr % bigint24),
    minutes: Number(min % bigint60),
    seconds: Number(sec % bigint60),
    millis: Number(ms % bigint1e3),
    nanos: Number(nanos2 % bigint1e6)
  };
}, format2 = (self) => {
  const duration = decode(self);
  if (duration.value._tag === "Infinity") {
    return "Infinity";
  }
  if (isZero(duration)) {
    return "0";
  }
  const fragments = parts(duration);
  const pieces = [];
  if (fragments.days !== 0) {
    pieces.push(`${fragments.days}d`);
  }
  if (fragments.hours !== 0) {
    pieces.push(`${fragments.hours}h`);
  }
  if (fragments.minutes !== 0) {
    pieces.push(`${fragments.minutes}m`);
  }
  if (fragments.seconds !== 0) {
    pieces.push(`${fragments.seconds}s`);
  }
  if (fragments.millis !== 0) {
    pieces.push(`${fragments.millis}ms`);
  }
  if (fragments.nanos !== 0) {
    pieces.push(`${fragments.nanos}ns`);
  }
  return pieces.join(" ");
};
var init_Duration = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Pipeable();
  init_Predicate();
  TypeId6 = /* @__PURE__ */ Symbol.for("effect/Duration");
  bigint0 = /* @__PURE__ */ BigInt(0);
  bigint24 = /* @__PURE__ */ BigInt(24);
  bigint60 = /* @__PURE__ */ BigInt(60);
  bigint1e3 = /* @__PURE__ */ BigInt(1000);
  bigint1e6 = /* @__PURE__ */ BigInt(1e6);
  bigint1e9 = /* @__PURE__ */ BigInt(1e9);
  DURATION_REGEX = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/;
  zeroValue = {
    _tag: "Millis",
    millis: 0
  };
  infinityValue = {
    _tag: "Infinity"
  };
  DurationProto = {
    [TypeId6]: TypeId6,
    [symbol]() {
      return cached(this, structure(this.value));
    },
    [symbol2](that) {
      return isDuration(that) && equals2(this, that);
    },
    toString() {
      return `Duration(${format2(this)})`;
    },
    toJSON() {
      switch (this.value._tag) {
        case "Millis":
          return {
            _id: "Duration",
            _tag: "Millis",
            millis: this.value.millis
          };
        case "Nanos":
          return {
            _id: "Duration",
            _tag: "Nanos",
            hrtime: toHrTime(this)
          };
        case "Infinity":
          return {
            _id: "Duration",
            _tag: "Infinity"
          };
      }
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  zero = /* @__PURE__ */ make10(0);
  infinity = /* @__PURE__ */ make10(Infinity);
  match4 = /* @__PURE__ */ dual(2, (self, options) => {
    const _self = decode(self);
    switch (_self.value._tag) {
      case "Nanos":
        return options.onNanos(_self.value.nanos);
      case "Infinity":
        return options.onMillis(Infinity);
      case "Millis":
        return options.onMillis(_self.value.millis);
    }
  });
  matchWith = /* @__PURE__ */ dual(3, (self, that, options) => {
    const _self = decode(self);
    const _that = decode(that);
    if (_self.value._tag === "Infinity" || _that.value._tag === "Infinity") {
      return options.onMillis(toMillis(_self), toMillis(_that));
    } else if (_self.value._tag === "Nanos" || _that.value._tag === "Nanos") {
      const selfNanos = _self.value._tag === "Nanos" ? _self.value.nanos : BigInt(Math.round(_self.value.millis * 1e6));
      const thatNanos = _that.value._tag === "Nanos" ? _that.value.nanos : BigInt(Math.round(_that.value.millis * 1e6));
      return options.onNanos(selfNanos, thatNanos);
    }
    return options.onMillis(_self.value.millis, _that.value.millis);
  });
  lessThanOrEqualTo = /* @__PURE__ */ dual(2, (self, that) => matchWith(self, that, {
    onMillis: (self2, that2) => self2 <= that2,
    onNanos: (self2, that2) => self2 <= that2
  }));
  greaterThanOrEqualTo = /* @__PURE__ */ dual(2, (self, that) => matchWith(self, that, {
    onMillis: (self2, that2) => self2 >= that2,
    onNanos: (self2, that2) => self2 >= that2
  }));
  equals2 = /* @__PURE__ */ dual(2, (self, that) => Equivalence(decode(self), decode(that)));
});

// node_modules/effect/dist/esm/MutableRef.js
var TypeId7, MutableRefProto, make11 = (value) => {
  const ref = Object.create(MutableRefProto);
  ref.current = value;
  return ref;
}, compareAndSet, get6 = (self) => self.current, set2;
var init_MutableRef = __esm(() => {
  init_Equal();
  init_Function();
  init_Inspectable();
  init_Pipeable();
  TypeId7 = /* @__PURE__ */ Symbol.for("effect/MutableRef");
  MutableRefProto = {
    [TypeId7]: TypeId7,
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "MutableRef",
        current: toJSON(this.current)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  compareAndSet = /* @__PURE__ */ dual(3, (self, oldValue, newValue) => {
    if (equals(oldValue, self.current)) {
      self.current = newValue;
      return true;
    }
    return false;
  });
  set2 = /* @__PURE__ */ dual(2, (self, value) => {
    self.current = value;
    return self;
  });
});

// node_modules/effect/dist/esm/internal/fiberId.js
var FiberIdSymbolKey = "effect/FiberId", FiberIdTypeId, OP_NONE = "None", OP_RUNTIME = "Runtime", OP_COMPOSITE = "Composite", emptyHash, None, Runtime, Composite, none3, isFiberId = (self) => hasProperty(self, FiberIdTypeId), combine2, ids = (self) => {
  switch (self._tag) {
    case OP_NONE: {
      return empty5();
    }
    case OP_RUNTIME: {
      return make7(self.id);
    }
    case OP_COMPOSITE: {
      return pipe(ids(self.left), union3(ids(self.right)));
    }
  }
}, _fiberCounter, threadName = (self) => {
  const identifiers = Array.from(ids(self)).map((n) => `#${n}`).join(",");
  return identifiers;
}, unsafeMake2 = () => {
  const id = get6(_fiberCounter);
  pipe(_fiberCounter, set2(id + 1));
  return new Runtime(id, Date.now());
};
var init_fiberId = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_HashSet();
  init_Inspectable();
  init_MutableRef();
  init_Predicate();
  FiberIdTypeId = /* @__PURE__ */ Symbol.for(FiberIdSymbolKey);
  emptyHash = /* @__PURE__ */ string(`${FiberIdSymbolKey}-${OP_NONE}`);
  None = class None {
    [FiberIdTypeId] = FiberIdTypeId;
    _tag = OP_NONE;
    id = -1;
    startTimeMillis = -1;
    [symbol]() {
      return emptyHash;
    }
    [symbol2](that) {
      return isFiberId(that) && that._tag === OP_NONE;
    }
    toString() {
      return format(this.toJSON());
    }
    toJSON() {
      return {
        _id: "FiberId",
        _tag: this._tag
      };
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  Runtime = class Runtime {
    id;
    startTimeMillis;
    [FiberIdTypeId] = FiberIdTypeId;
    _tag = OP_RUNTIME;
    constructor(id, startTimeMillis) {
      this.id = id;
      this.startTimeMillis = startTimeMillis;
    }
    [symbol]() {
      return cached(this, string(`${FiberIdSymbolKey}-${this._tag}-${this.id}-${this.startTimeMillis}`));
    }
    [symbol2](that) {
      return isFiberId(that) && that._tag === OP_RUNTIME && this.id === that.id && this.startTimeMillis === that.startTimeMillis;
    }
    toString() {
      return format(this.toJSON());
    }
    toJSON() {
      return {
        _id: "FiberId",
        _tag: this._tag,
        id: this.id,
        startTimeMillis: this.startTimeMillis
      };
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  Composite = class Composite {
    left;
    right;
    [FiberIdTypeId] = FiberIdTypeId;
    _tag = OP_COMPOSITE;
    constructor(left3, right3) {
      this.left = left3;
      this.right = right3;
    }
    _hash;
    [symbol]() {
      return pipe(string(`${FiberIdSymbolKey}-${this._tag}`), combine(hash(this.left)), combine(hash(this.right)), cached(this));
    }
    [symbol2](that) {
      return isFiberId(that) && that._tag === OP_COMPOSITE && equals(this.left, that.left) && equals(this.right, that.right);
    }
    toString() {
      return format(this.toJSON());
    }
    toJSON() {
      return {
        _id: "FiberId",
        _tag: this._tag,
        left: toJSON(this.left),
        right: toJSON(this.right)
      };
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
  };
  none3 = /* @__PURE__ */ new None;
  combine2 = /* @__PURE__ */ dual(2, (self, that) => {
    if (self._tag === OP_NONE) {
      return that;
    }
    if (that._tag === OP_NONE) {
      return self;
    }
    return new Composite(self, that);
  });
  _fiberCounter = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Fiber/Id/_fiberCounter"), () => make11(0));
});

// node_modules/effect/dist/esm/FiberId.js
var none4, combine3, ids2, threadName2, unsafeMake3;
var init_FiberId = __esm(() => {
  init_fiberId();
  none4 = none3;
  combine3 = combine2;
  ids2 = ids;
  threadName2 = threadName;
  unsafeMake3 = unsafeMake2;
});

// node_modules/effect/dist/esm/HashMap.js
var empty9, fromIterable7, isEmpty4, get7, set3, keys2, mutate3, modifyAt2, map7, forEach3, reduce6;
var init_HashMap = __esm(() => {
  init_hashMap();
  empty9 = empty3;
  fromIterable7 = fromIterable4;
  isEmpty4 = isEmpty2;
  get7 = get3;
  set3 = set;
  keys2 = keys;
  mutate3 = mutate;
  modifyAt2 = modifyAt;
  map7 = map3;
  forEach3 = forEach;
  reduce6 = reduce2;
});

// node_modules/effect/dist/esm/List.js
var TypeId8, toArray2 = (self) => fromIterable2(self), getEquivalence4 = (isEquivalent) => mapInput(getEquivalence2(isEquivalent), toArray2), _equivalence4, ConsProto, makeCons = (head3, tail) => {
  const cons = Object.create(ConsProto);
  cons.head = head3;
  cons.tail = tail;
  return cons;
}, NilHash, NilProto, _Nil, isList = (u) => hasProperty(u, TypeId8), isNil = (self) => self._tag === "Nil", isCons = (self) => self._tag === "Cons", nil = () => _Nil, cons = (head3, tail) => makeCons(head3, tail), empty10, of3 = (value) => makeCons(value, _Nil), appendAll3, prepend3, prependAll, reduce7, reverse3 = (self) => {
  let result = empty10();
  let these = self;
  while (!isNil(these)) {
    result = prepend3(result, these.head);
    these = these.tail;
  }
  return result;
};
var init_List = __esm(() => {
  init_Array();
  init_Equal();
  init_Equivalence();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Pipeable();
  init_Predicate();
  TypeId8 = /* @__PURE__ */ Symbol.for("effect/List");
  _equivalence4 = /* @__PURE__ */ getEquivalence4(equals);
  ConsProto = {
    [TypeId8]: TypeId8,
    _tag: "Cons",
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "List",
        _tag: "Cons",
        values: toArray2(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    [symbol2](that) {
      return isList(that) && this._tag === that._tag && _equivalence4(this, that);
    },
    [symbol]() {
      return cached(this, array2(toArray2(this)));
    },
    [Symbol.iterator]() {
      let done = false;
      let self = this;
      return {
        next() {
          if (done) {
            return this.return();
          }
          if (self._tag === "Nil") {
            done = true;
            return this.return();
          }
          const value = self.head;
          self = self.tail;
          return {
            done,
            value
          };
        },
        return(value) {
          if (!done) {
            done = true;
          }
          return {
            done: true,
            value
          };
        }
      };
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  NilHash = /* @__PURE__ */ string("Nil");
  NilProto = {
    [TypeId8]: TypeId8,
    _tag: "Nil",
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "List",
        _tag: "Nil"
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    [symbol]() {
      return NilHash;
    },
    [symbol2](that) {
      return isList(that) && this._tag === that._tag;
    },
    [Symbol.iterator]() {
      return {
        next() {
          return {
            done: true,
            value: undefined
          };
        }
      };
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  _Nil = /* @__PURE__ */ Object.create(NilProto);
  empty10 = nil;
  appendAll3 = /* @__PURE__ */ dual(2, (self, that) => prependAll(that, self));
  prepend3 = /* @__PURE__ */ dual(2, (self, element) => cons(element, self));
  prependAll = /* @__PURE__ */ dual(2, (self, prefix) => {
    if (isNil(self)) {
      return prefix;
    } else if (isNil(prefix)) {
      return self;
    } else {
      const result = makeCons(prefix.head, self);
      let curr = result;
      let that = prefix.tail;
      while (!isNil(that)) {
        const temp = makeCons(that.head, self);
        curr.tail = temp;
        curr = temp;
        that = that.tail;
      }
      return result;
    }
  });
  reduce7 = /* @__PURE__ */ dual(3, (self, zero2, f) => {
    let acc = zero2;
    let these = self;
    while (!isNil(these)) {
      acc = f(acc, these.head);
      these = these.tail;
    }
    return acc;
  });
});

// node_modules/effect/dist/esm/internal/data.js
var ArrayProto, Structural, struct = (as3) => Object.assign(Object.create(StructuralPrototype), as3);
var init_data = __esm(() => {
  init_Equal();
  init_Hash();
  init_effectable();
  ArrayProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(Array.prototype), {
    [symbol]() {
      return cached(this, array2(this));
    },
    [symbol2](that) {
      if (Array.isArray(that) && this.length === that.length) {
        return this.every((v, i) => equals(v, that[i]));
      } else {
        return false;
      }
    }
  });
  Structural = /* @__PURE__ */ function() {
    function Structural2(args) {
      if (args) {
        Object.assign(this, args);
      }
    }
    Structural2.prototype = StructuralPrototype;
    return Structural2;
  }();
});

// node_modules/effect/dist/esm/internal/differ/contextPatch.js
function variance2(a) {
  return a;
}
var ContextPatchTypeId, PatchProto, EmptyProto, _empty5, empty11 = () => _empty5, AndThenProto, makeAndThen = (first, second) => {
  const o = Object.create(AndThenProto);
  o.first = first;
  o.second = second;
  return o;
}, AddServiceProto, makeAddService = (key, service) => {
  const o = Object.create(AddServiceProto);
  o.key = key;
  o.service = service;
  return o;
}, RemoveServiceProto, makeRemoveService = (key) => {
  const o = Object.create(RemoveServiceProto);
  o.key = key;
  return o;
}, UpdateServiceProto, makeUpdateService = (key, update) => {
  const o = Object.create(UpdateServiceProto);
  o.key = key;
  o.update = update;
  return o;
}, diff = (oldValue, newValue) => {
  const missingServices = new Map(oldValue.unsafeMap);
  let patch = empty11();
  for (const [tag, newService] of newValue.unsafeMap.entries()) {
    if (missingServices.has(tag)) {
      const old = missingServices.get(tag);
      missingServices.delete(tag);
      if (!equals(old, newService)) {
        patch = combine4(makeUpdateService(tag, () => newService))(patch);
      }
    } else {
      missingServices.delete(tag);
      patch = combine4(makeAddService(tag, newService))(patch);
    }
  }
  for (const [tag] of missingServices.entries()) {
    patch = combine4(makeRemoveService(tag))(patch);
  }
  return patch;
}, combine4, patch;
var init_contextPatch = __esm(() => {
  init_Chunk();
  init_Equal();
  init_Function();
  init_context();
  init_data();
  ContextPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferContextPatch");
  PatchProto = {
    ...Structural.prototype,
    [ContextPatchTypeId]: {
      _Value: variance2,
      _Patch: variance2
    }
  };
  EmptyProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
    _tag: "Empty"
  });
  _empty5 = /* @__PURE__ */ Object.create(EmptyProto);
  AndThenProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
    _tag: "AndThen"
  });
  AddServiceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
    _tag: "AddService"
  });
  RemoveServiceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
    _tag: "RemoveService"
  });
  UpdateServiceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto), {
    _tag: "UpdateService"
  });
  combine4 = /* @__PURE__ */ dual(2, (self, that) => makeAndThen(self, that));
  patch = /* @__PURE__ */ dual(2, (self, context) => {
    if (self._tag === "Empty") {
      return context;
    }
    let wasServiceUpdated = false;
    let patches = of2(self);
    const updatedContext = new Map(context.unsafeMap);
    while (isNonEmpty(patches)) {
      const head3 = headNonEmpty2(patches);
      const tail = tailNonEmpty2(patches);
      switch (head3._tag) {
        case "Empty": {
          patches = tail;
          break;
        }
        case "AddService": {
          updatedContext.set(head3.key, head3.service);
          patches = tail;
          break;
        }
        case "AndThen": {
          patches = prepend2(prepend2(tail, head3.second), head3.first);
          break;
        }
        case "RemoveService": {
          updatedContext.delete(head3.key);
          patches = tail;
          break;
        }
        case "UpdateService": {
          updatedContext.set(head3.key, head3.update(updatedContext.get(head3.key)));
          wasServiceUpdated = true;
          patches = tail;
          break;
        }
      }
    }
    if (!wasServiceUpdated) {
      return makeContext(updatedContext);
    }
    const map8 = new Map;
    for (const [tag] of context.unsafeMap) {
      if (updatedContext.has(tag)) {
        map8.set(tag, updatedContext.get(tag));
        updatedContext.delete(tag);
      }
    }
    for (const [tag, s] of updatedContext) {
      map8.set(tag, s);
    }
    return makeContext(map8);
  });
});

// node_modules/effect/dist/esm/internal/differ/hashSetPatch.js
function variance3(a) {
  return a;
}
var HashSetPatchTypeId, PatchProto2, EmptyProto2, _empty6, empty12 = () => _empty6, AndThenProto2, makeAndThen2 = (first, second) => {
  const o = Object.create(AndThenProto2);
  o.first = first;
  o.second = second;
  return o;
}, AddProto, makeAdd = (value) => {
  const o = Object.create(AddProto);
  o.value = value;
  return o;
}, RemoveProto, makeRemove = (value) => {
  const o = Object.create(RemoveProto);
  o.value = value;
  return o;
}, diff2 = (oldValue, newValue) => {
  const [removed, patch2] = reduce4([oldValue, empty12()], ([set4, patch3], value) => {
    if (has3(value)(set4)) {
      return [remove4(value)(set4), patch3];
    }
    return [set4, combine5(makeAdd(value))(patch3)];
  })(newValue);
  return reduce4(patch2, (patch3, value) => combine5(makeRemove(value))(patch3))(removed);
}, combine5, patch2;
var init_hashSetPatch = __esm(() => {
  init_Chunk();
  init_Function();
  init_HashSet();
  init_data();
  HashSetPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferHashSetPatch");
  PatchProto2 = {
    ...Structural.prototype,
    [HashSetPatchTypeId]: {
      _Value: variance3,
      _Key: variance3,
      _Patch: variance3
    }
  };
  EmptyProto2 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
    _tag: "Empty"
  });
  _empty6 = /* @__PURE__ */ Object.create(EmptyProto2);
  AndThenProto2 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
    _tag: "AndThen"
  });
  AddProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
    _tag: "Add"
  });
  RemoveProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto2), {
    _tag: "Remove"
  });
  combine5 = /* @__PURE__ */ dual(2, (self, that) => makeAndThen2(self, that));
  patch2 = /* @__PURE__ */ dual(2, (self, oldValue) => {
    if (self._tag === "Empty") {
      return oldValue;
    }
    let set4 = oldValue;
    let patches = of2(self);
    while (isNonEmpty(patches)) {
      const head3 = headNonEmpty2(patches);
      const tail = tailNonEmpty2(patches);
      switch (head3._tag) {
        case "Empty": {
          patches = tail;
          break;
        }
        case "AndThen": {
          patches = prepend2(head3.first)(prepend2(head3.second)(tail));
          break;
        }
        case "Add": {
          set4 = add2(head3.value)(set4);
          patches = tail;
          break;
        }
        case "Remove": {
          set4 = remove4(head3.value)(set4);
          patches = tail;
        }
      }
    }
    return set4;
  });
});

// node_modules/effect/dist/esm/internal/differ/readonlyArrayPatch.js
function variance4(a) {
  return a;
}
var ReadonlyArrayPatchTypeId, PatchProto3, EmptyProto3, _empty7, empty13 = () => _empty7, AndThenProto3, makeAndThen3 = (first, second) => {
  const o = Object.create(AndThenProto3);
  o.first = first;
  o.second = second;
  return o;
}, AppendProto, makeAppend = (values3) => {
  const o = Object.create(AppendProto);
  o.values = values3;
  return o;
}, SliceProto, makeSlice = (from, until) => {
  const o = Object.create(SliceProto);
  o.from = from;
  o.until = until;
  return o;
}, UpdateProto, makeUpdate = (index, patch3) => {
  const o = Object.create(UpdateProto);
  o.index = index;
  o.patch = patch3;
  return o;
}, diff3 = (options) => {
  let i = 0;
  let patch3 = empty13();
  while (i < options.oldValue.length && i < options.newValue.length) {
    const oldElement = options.oldValue[i];
    const newElement = options.newValue[i];
    const valuePatch = options.differ.diff(oldElement, newElement);
    if (!equals(valuePatch, options.differ.empty)) {
      patch3 = combine6(patch3, makeUpdate(i, valuePatch));
    }
    i = i + 1;
  }
  if (i < options.oldValue.length) {
    patch3 = combine6(patch3, makeSlice(0, i));
  }
  if (i < options.newValue.length) {
    patch3 = combine6(patch3, makeAppend(drop(i)(options.newValue)));
  }
  return patch3;
}, combine6, patch3;
var init_readonlyArrayPatch = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_data();
  ReadonlyArrayPatchTypeId = /* @__PURE__ */ Symbol.for("effect/DifferReadonlyArrayPatch");
  PatchProto3 = {
    ...Structural.prototype,
    [ReadonlyArrayPatchTypeId]: {
      _Value: variance4,
      _Patch: variance4
    }
  };
  EmptyProto3 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
    _tag: "Empty"
  });
  _empty7 = /* @__PURE__ */ Object.create(EmptyProto3);
  AndThenProto3 = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
    _tag: "AndThen"
  });
  AppendProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
    _tag: "Append"
  });
  SliceProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
    _tag: "Slice"
  });
  UpdateProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(PatchProto3), {
    _tag: "Update"
  });
  combine6 = /* @__PURE__ */ dual(2, (self, that) => makeAndThen3(self, that));
  patch3 = /* @__PURE__ */ dual(3, (self, oldValue, differ) => {
    if (self._tag === "Empty") {
      return oldValue;
    }
    let readonlyArray = oldValue.slice();
    let patches = of(self);
    while (isNonEmptyArray2(patches)) {
      const head3 = headNonEmpty(patches);
      const tail = tailNonEmpty(patches);
      switch (head3._tag) {
        case "Empty": {
          patches = tail;
          break;
        }
        case "AndThen": {
          tail.unshift(head3.first, head3.second);
          patches = tail;
          break;
        }
        case "Append": {
          for (const value of head3.values) {
            readonlyArray.push(value);
          }
          patches = tail;
          break;
        }
        case "Slice": {
          readonlyArray = readonlyArray.slice(head3.from, head3.until);
          patches = tail;
          break;
        }
        case "Update": {
          readonlyArray[head3.index] = differ.patch(head3.patch, readonlyArray[head3.index]);
          patches = tail;
          break;
        }
      }
    }
    return readonlyArray;
  });
});

// node_modules/effect/dist/esm/internal/differ.js
var DifferTypeId, DifferProto, make14 = (params) => {
  const differ = Object.create(DifferProto);
  differ.empty = params.empty;
  differ.diff = params.diff;
  differ.combine = params.combine;
  differ.patch = params.patch;
  return differ;
}, environment = () => make14({
  empty: empty11(),
  combine: (first, second) => combine4(second)(first),
  diff: (oldValue, newValue) => diff(oldValue, newValue),
  patch: (patch4, oldValue) => patch(oldValue)(patch4)
}), hashSet = () => make14({
  empty: empty12(),
  combine: (first, second) => combine5(second)(first),
  diff: (oldValue, newValue) => diff2(oldValue, newValue),
  patch: (patch4, oldValue) => patch2(oldValue)(patch4)
}), readonlyArray = (differ) => make14({
  empty: empty13(),
  combine: (first, second) => combine6(first, second),
  diff: (oldValue, newValue) => diff3({
    oldValue,
    newValue,
    differ
  }),
  patch: (patch4, oldValue) => patch3(patch4, oldValue, differ)
}), update = () => updateWith((_, a) => a), updateWith = (f) => make14({
  empty: identity,
  combine: (first, second) => {
    if (first === identity) {
      return second;
    }
    if (second === identity) {
      return first;
    }
    return (a) => second(first(a));
  },
  diff: (oldValue, newValue) => {
    if (equals(oldValue, newValue)) {
      return identity;
    }
    return constant(newValue);
  },
  patch: (patch4, oldValue) => f(oldValue, patch4(oldValue))
});
var init_differ = __esm(() => {
  init_Equal();
  init_Function();
  init_Pipeable();
  init_contextPatch();
  init_hashSetPatch();
  init_readonlyArrayPatch();
  DifferTypeId = /* @__PURE__ */ Symbol.for("effect/Differ");
  DifferProto = {
    [DifferTypeId]: {
      _P: identity,
      _V: identity
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/runtimeFlagsPatch.js
var BIT_MASK = 255, BIT_SHIFT = 8, active = (patch4) => patch4 & BIT_MASK, enabled = (patch4) => patch4 >> BIT_SHIFT & BIT_MASK, make15 = (active2, enabled2) => (active2 & BIT_MASK) + ((enabled2 & active2 & BIT_MASK) << BIT_SHIFT), empty14, enable = (flag) => make15(flag, flag), disable = (flag) => make15(flag, 0), exclude, andThen3, invert = (n) => ~n >>> 0 & BIT_MASK;
var init_runtimeFlagsPatch = __esm(() => {
  init_Function();
  empty14 = /* @__PURE__ */ make15(0, 0);
  exclude = /* @__PURE__ */ dual(2, (self, flag) => make15(active(self) & ~flag, enabled(self)));
  andThen3 = /* @__PURE__ */ dual(2, (self, that) => self | that);
});

// node_modules/effect/dist/esm/internal/runtimeFlags.js
var None2 = 0, Interruption, OpSupervision, RuntimeMetrics, WindDown, CooperativeYielding, cooperativeYielding = (self) => isEnabled(self, CooperativeYielding), disable2, enable2, interruptible = (self) => interruption(self) && !windDown(self), interruption = (self) => isEnabled(self, Interruption), isEnabled, make16 = (...flags) => flags.reduce((a, b) => a | b, 0), none5, runtimeMetrics = (self) => isEnabled(self, RuntimeMetrics), windDown = (self) => isEnabled(self, WindDown), diff4, patch4, differ;
var init_runtimeFlags = __esm(() => {
  init_Function();
  init_differ();
  init_runtimeFlagsPatch();
  Interruption = 1 << 0;
  OpSupervision = 1 << 1;
  RuntimeMetrics = 1 << 2;
  WindDown = 1 << 4;
  CooperativeYielding = 1 << 5;
  disable2 = /* @__PURE__ */ dual(2, (self, flag) => self & ~flag);
  enable2 = /* @__PURE__ */ dual(2, (self, flag) => self | flag);
  isEnabled = /* @__PURE__ */ dual(2, (self, flag) => (self & flag) !== 0);
  none5 = /* @__PURE__ */ make16(None2);
  diff4 = /* @__PURE__ */ dual(2, (self, that) => make15(self ^ that, that));
  patch4 = /* @__PURE__ */ dual(2, (self, patch5) => self & (invert(active(patch5)) | enabled(patch5)) | active(patch5) & enabled(patch5));
  differ = /* @__PURE__ */ make14({
    empty: empty14,
    diff: (oldValue, newValue) => diff4(oldValue, newValue),
    combine: (first, second) => andThen3(second)(first),
    patch: (_patch, oldValue) => patch4(oldValue, _patch)
  });
});

// node_modules/effect/dist/esm/RuntimeFlagsPatch.js
var empty15, enable3, disable3, exclude2;
var init_RuntimeFlagsPatch = __esm(() => {
  init_runtimeFlagsPatch();
  empty15 = empty14;
  enable3 = enable;
  disable3 = disable;
  exclude2 = exclude;
});

// node_modules/effect/dist/esm/internal/blockedRequests.js
var empty16, par = (self, that) => ({
  _tag: "Par",
  left: self,
  right: that
}), seq = (self, that) => ({
  _tag: "Seq",
  left: self,
  right: that
}), single = (dataSource, blockedRequest) => ({
  _tag: "Single",
  dataSource,
  blockedRequest
}), flatten4 = (self) => {
  let current = of3(self);
  let updated = empty10();
  while (true) {
    const [parallel2, sequential2] = reduce7(current, [parallelCollectionEmpty(), empty10()], ([parallel3, sequential3], blockedRequest) => {
      const [par2, seq2] = step(blockedRequest);
      return [parallelCollectionCombine(parallel3, par2), appendAll3(sequential3, seq2)];
    });
    updated = merge4(updated, parallel2);
    if (isNil(sequential2)) {
      return reverse3(updated);
    }
    current = sequential2;
  }
  throw new Error("BUG: BlockedRequests.flatten - please report an issue at https://github.com/Effect-TS/effect/issues");
}, step = (requests) => {
  let current = requests;
  let parallel2 = parallelCollectionEmpty();
  let stack = empty10();
  let sequential2 = empty10();
  while (true) {
    switch (current._tag) {
      case "Empty": {
        if (isNil(stack)) {
          return [parallel2, sequential2];
        }
        current = stack.head;
        stack = stack.tail;
        break;
      }
      case "Par": {
        stack = cons(current.right, stack);
        current = current.left;
        break;
      }
      case "Seq": {
        const left3 = current.left;
        const right3 = current.right;
        switch (left3._tag) {
          case "Empty": {
            current = right3;
            break;
          }
          case "Par": {
            const l = left3.left;
            const r = left3.right;
            current = par(seq(l, right3), seq(r, right3));
            break;
          }
          case "Seq": {
            const l = left3.left;
            const r = left3.right;
            current = seq(l, seq(r, right3));
            break;
          }
          case "Single": {
            current = left3;
            sequential2 = cons(right3, sequential2);
            break;
          }
        }
        break;
      }
      case "Single": {
        parallel2 = parallelCollectionAdd(parallel2, current);
        if (isNil(stack)) {
          return [parallel2, sequential2];
        }
        current = stack.head;
        stack = stack.tail;
        break;
      }
    }
  }
  throw new Error("BUG: BlockedRequests.step - please report an issue at https://github.com/Effect-TS/effect/issues");
}, merge4 = (sequential2, parallel2) => {
  if (isNil(sequential2)) {
    return of3(parallelCollectionToSequentialCollection(parallel2));
  }
  if (parallelCollectionIsEmpty(parallel2)) {
    return sequential2;
  }
  const seqHeadKeys = sequentialCollectionKeys(sequential2.head);
  const parKeys = parallelCollectionKeys(parallel2);
  if (seqHeadKeys.length === 1 && parKeys.length === 1 && equals(seqHeadKeys[0], parKeys[0])) {
    return cons(sequentialCollectionCombine(sequential2.head, parallelCollectionToSequentialCollection(parallel2)), sequential2.tail);
  }
  return cons(parallelCollectionToSequentialCollection(parallel2), sequential2);
}, EntryTypeId, EntryImpl, blockedRequestVariance, makeEntry = (options) => new EntryImpl(options.request, options.result, options.listeners, options.ownerId, options.state), RequestBlockParallelTypeId, parallelVariance, ParallelImpl, parallelCollectionEmpty = () => new ParallelImpl(empty9()), parallelCollectionAdd = (self, blockedRequest) => new ParallelImpl(modifyAt2(self.map, blockedRequest.dataSource, (_) => orElseSome(map(_, append2(blockedRequest.blockedRequest)), () => of2(blockedRequest.blockedRequest)))), parallelCollectionCombine = (self, that) => new ParallelImpl(reduce6(self.map, that.map, (map8, value, key) => set3(map8, key, match2(get7(map8, key), {
  onNone: () => value,
  onSome: (other) => appendAll2(value, other)
})))), parallelCollectionIsEmpty = (self) => isEmpty4(self.map), parallelCollectionKeys = (self) => Array.from(keys2(self.map)), parallelCollectionToSequentialCollection = (self) => sequentialCollectionMake(map7(self.map, (x) => of2(x))), SequentialCollectionTypeId, sequentialVariance, SequentialImpl, sequentialCollectionMake = (map8) => new SequentialImpl(map8), sequentialCollectionCombine = (self, that) => new SequentialImpl(reduce6(that.map, self.map, (map8, value, key) => set3(map8, key, match2(get7(map8, key), {
  onNone: () => empty2(),
  onSome: (a) => appendAll2(a, value)
})))), sequentialCollectionKeys = (self) => Array.from(keys2(self.map)), sequentialCollectionToChunk = (self) => Array.from(self.map);
var init_blockedRequests = __esm(() => {
  init_Chunk();
  init_Equal();
  init_HashMap();
  init_List();
  init_Option();
  empty16 = {
    _tag: "Empty"
  };
  EntryTypeId = /* @__PURE__ */ Symbol.for("effect/RequestBlock/Entry");
  EntryImpl = class EntryImpl {
    request;
    result;
    listeners;
    ownerId;
    state;
    [EntryTypeId] = blockedRequestVariance;
    constructor(request, result, listeners, ownerId, state) {
      this.request = request;
      this.result = result;
      this.listeners = listeners;
      this.ownerId = ownerId;
      this.state = state;
    }
  };
  blockedRequestVariance = {
    _R: (_) => _
  };
  RequestBlockParallelTypeId = /* @__PURE__ */ Symbol.for("effect/RequestBlock/RequestBlockParallel");
  parallelVariance = {
    _R: (_) => _
  };
  ParallelImpl = class ParallelImpl {
    map;
    [RequestBlockParallelTypeId] = parallelVariance;
    constructor(map8) {
      this.map = map8;
    }
  };
  SequentialCollectionTypeId = /* @__PURE__ */ Symbol.for("effect/RequestBlock/RequestBlockSequential");
  sequentialVariance = {
    _R: (_) => _
  };
  SequentialImpl = class SequentialImpl {
    map;
    [SequentialCollectionTypeId] = sequentialVariance;
    constructor(map8) {
      this.map = map8;
    }
  };
});

// node_modules/effect/dist/esm/internal/opCodes/deferred.js
var OP_STATE_PENDING = "Pending", OP_STATE_DONE = "Done";

// node_modules/effect/dist/esm/internal/deferred.js
var DeferredSymbolKey = "effect/Deferred", DeferredTypeId, deferredVariance, pending = (joiners) => {
  return {
    _tag: OP_STATE_PENDING,
    joiners
  };
}, done = (effect) => {
  return {
    _tag: OP_STATE_DONE,
    effect
  };
};
var init_deferred = __esm(() => {
  DeferredTypeId = /* @__PURE__ */ Symbol.for(DeferredSymbolKey);
  deferredVariance = {
    _E: (_) => _,
    _A: (_) => _
  };
});

// node_modules/effect/dist/esm/internal/singleShotGen.js
var SingleShotGen2;
var init_singleShotGen = __esm(() => {
  SingleShotGen2 = class SingleShotGen2 {
    self;
    called = false;
    constructor(self) {
      this.self = self;
    }
    next(a) {
      return this.called ? {
        value: a,
        done: true
      } : (this.called = true, {
        value: this.self,
        done: false
      });
    }
    return(a) {
      return {
        value: a,
        done: true
      };
    }
    throw(e) {
      throw e;
    }
    [Symbol.iterator]() {
      return new SingleShotGen2(this.self);
    }
  };
});

// node_modules/effect/dist/esm/internal/core.js
class RevertFlags {
  patch;
  op;
  _op = OP_REVERT_FLAGS;
  constructor(patch5, op) {
    this.patch = patch5;
    this.op = op;
  }
}
var blocked = (blockedRequests, _continue) => {
  const effect = new EffectPrimitive("Blocked");
  effect.effect_instruction_i0 = blockedRequests;
  effect.effect_instruction_i1 = _continue;
  return effect;
}, runRequestBlock = (blockedRequests) => {
  const effect = new EffectPrimitive("RunBlocked");
  effect.effect_instruction_i0 = blockedRequests;
  return effect;
}, EffectTypeId2, EffectPrimitive, EffectPrimitiveFailure, EffectPrimitiveSuccess, isEffect = (u) => hasProperty(u, EffectTypeId2), withFiberRuntime = (withRuntime) => {
  const effect = new EffectPrimitive(OP_WITH_RUNTIME);
  effect.effect_instruction_i0 = withRuntime;
  return effect;
}, acquireUseRelease, as3, asVoid2 = (self) => as3(self, undefined), custom = function() {
  const wrapper = new EffectPrimitive(OP_COMMIT);
  switch (arguments.length) {
    case 2: {
      wrapper.effect_instruction_i0 = arguments[0];
      wrapper.commit = arguments[1];
      break;
    }
    case 3: {
      wrapper.effect_instruction_i0 = arguments[0];
      wrapper.effect_instruction_i1 = arguments[1];
      wrapper.commit = arguments[2];
      break;
    }
    case 4: {
      wrapper.effect_instruction_i0 = arguments[0];
      wrapper.effect_instruction_i1 = arguments[1];
      wrapper.effect_instruction_i2 = arguments[2];
      wrapper.commit = arguments[3];
      break;
    }
    default: {
      throw new Error(getBugErrorMessage("you're not supposed to end up here"));
    }
  }
  return wrapper;
}, unsafeAsync = (register, blockingOn = none4) => {
  const effect = new EffectPrimitive(OP_ASYNC);
  let cancelerRef = undefined;
  effect.effect_instruction_i0 = (resume) => {
    cancelerRef = register(resume);
  };
  effect.effect_instruction_i1 = blockingOn;
  return onInterrupt(effect, (_) => isEffect(cancelerRef) ? cancelerRef : void_2);
}, asyncInterrupt = (register, blockingOn = none4) => suspend(() => unsafeAsync(register, blockingOn)), async_ = (resume, blockingOn = none4) => {
  return custom(resume, function() {
    let backingResume = undefined;
    let pendingEffect = undefined;
    function proxyResume(effect2) {
      if (backingResume) {
        backingResume(effect2);
      } else if (pendingEffect === undefined) {
        pendingEffect = effect2;
      }
    }
    const effect = new EffectPrimitive(OP_ASYNC);
    effect.effect_instruction_i0 = (resume2) => {
      backingResume = resume2;
      if (pendingEffect) {
        resume2(pendingEffect);
      }
    };
    effect.effect_instruction_i1 = blockingOn;
    let cancelerRef = undefined;
    let controllerRef = undefined;
    if (this.effect_instruction_i0.length !== 1) {
      controllerRef = new AbortController;
      cancelerRef = internalCall(() => this.effect_instruction_i0(proxyResume, controllerRef.signal));
    } else {
      cancelerRef = internalCall(() => this.effect_instruction_i0(proxyResume));
    }
    return cancelerRef || controllerRef ? onInterrupt(effect, (_) => {
      if (controllerRef) {
        controllerRef.abort();
      }
      return cancelerRef ?? void_2;
    }) : effect;
  });
}, catchAllCause, catchAll, catchIf, catchSome, checkInterruptible = (f) => withFiberRuntime((_, status) => f(interruption(status.runtimeFlags))), originalSymbol, originalInstance = (obj) => {
  if (hasProperty(obj, originalSymbol)) {
    return obj[originalSymbol];
  }
  return obj;
}, capture = (obj, span2) => {
  if (isSome2(span2)) {
    return new Proxy(obj, {
      has(target, p) {
        return p === spanSymbol || p === originalSymbol || p in target;
      },
      get(target, p) {
        if (p === spanSymbol) {
          return span2.value;
        }
        if (p === originalSymbol) {
          return obj;
        }
        return target[p];
      }
    });
  }
  return obj;
}, die2 = (defect) => isObject(defect) && !(spanSymbol in defect) ? withFiberRuntime((fiber) => failCause(die(capture(defect, currentSpanFromFiber(fiber))))) : failCause(die(defect)), dieMessage = (message) => failCauseSync(() => die(new RuntimeException(message))), dieSync = (evaluate) => flatMap7(sync(evaluate), die2), either2 = (self) => matchEffect(self, {
  onFailure: (e) => succeed(left2(e)),
  onSuccess: (a) => succeed(right2(a))
}), exit = (self) => matchCause(self, {
  onFailure: exitFailCause,
  onSuccess: exitSucceed
}), fail2 = (error) => isObject(error) && !(spanSymbol in error) ? withFiberRuntime((fiber) => failCause(fail(capture(error, currentSpanFromFiber(fiber))))) : failCause(fail(error)), failSync = (evaluate) => flatMap7(sync(evaluate), fail2), failCause = (cause) => {
  const effect = new EffectPrimitiveFailure(OP_FAILURE);
  effect.effect_instruction_i0 = cause;
  return effect;
}, failCauseSync = (evaluate) => flatMap7(sync(evaluate), failCause), fiberId, fiberIdWith = (f) => withFiberRuntime((state) => f(state.id())), flatMap7, andThen4, step2 = (self) => {
  const effect = new EffectPrimitive("OnStep");
  effect.effect_instruction_i0 = self;
  return effect;
}, flatten5 = (self) => flatMap7(self, identity), flip = (self) => matchEffect(self, {
  onFailure: succeed,
  onSuccess: fail2
}), matchCause, matchCauseEffect, matchEffect, forEachSequential, forEachSequentialDiscard, if_, interrupt2, interruptWith = (fiberId2) => failCause(interrupt(fiberId2)), interruptible2 = (self) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = enable3(Interruption);
  effect.effect_instruction_i1 = () => self;
  return effect;
}, interruptibleMask = (f) => custom(f, function() {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = enable3(Interruption);
  effect.effect_instruction_i1 = (oldFlags) => interruption(oldFlags) ? internalCall(() => this.effect_instruction_i0(interruptible2)) : internalCall(() => this.effect_instruction_i0(uninterruptible));
  return effect;
}), intoDeferred, map8, mapBoth, mapError, onError, onExit, onInterrupt, orElse2, orDie = (self) => orDieWith(self, identity), orDieWith, partitionMap3, runtimeFlags, succeed = (value) => {
  const effect = new EffectPrimitiveSuccess(OP_SUCCESS);
  effect.effect_instruction_i0 = value;
  return effect;
}, suspend = (evaluate) => {
  const effect = new EffectPrimitive(OP_COMMIT);
  effect.commit = evaluate;
  return effect;
}, sync = (thunk) => {
  const effect = new EffectPrimitive(OP_SYNC);
  effect.effect_instruction_i0 = thunk;
  return effect;
}, tap2, transplant = (f) => withFiberRuntime((state) => {
  const scopeOverride = state.getFiberRef(currentForkScopeOverride);
  const scope = pipe(scopeOverride, getOrElse(() => state.scope()));
  return f(fiberRefLocally(currentForkScopeOverride, some2(scope)));
}), attemptOrElse, uninterruptible = (self) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = disable3(Interruption);
  effect.effect_instruction_i1 = () => self;
  return effect;
}, uninterruptibleMask = (f) => custom(f, function() {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = disable3(Interruption);
  effect.effect_instruction_i1 = (oldFlags) => interruption(oldFlags) ? internalCall(() => this.effect_instruction_i0(interruptible2)) : internalCall(() => this.effect_instruction_i0(uninterruptible));
  return effect;
}), void_2, updateRuntimeFlags = (patch5) => {
  const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
  effect.effect_instruction_i0 = patch5;
  effect.effect_instruction_i1 = undefined;
  return effect;
}, whenEffect, whileLoop = (options) => {
  const effect = new EffectPrimitive(OP_WHILE);
  effect.effect_instruction_i0 = options.while;
  effect.effect_instruction_i1 = options.body;
  effect.effect_instruction_i2 = options.step;
  return effect;
}, fromIterator = (iterator) => suspend(() => {
  const effect = new EffectPrimitive(OP_ITERATOR);
  effect.effect_instruction_i0 = iterator();
  return effect;
}), gen2 = function() {
  const f = arguments.length === 1 ? arguments[0] : arguments[1].bind(arguments[0]);
  return fromIterator(() => f(pipe));
}, fnUntraced = (body, ...pipeables) => Object.defineProperty(pipeables.length === 0 ? function(...args) {
  return fromIterator(() => body.apply(this, args));
} : function(...args) {
  let effect = fromIterator(() => body.apply(this, args));
  for (const x of pipeables) {
    effect = x(effect, ...args);
  }
  return effect;
}, "length", {
  value: body.length,
  configurable: true
}), withConcurrency, withRequestBatching, withRuntimeFlags, withTracerEnabled, withTracerTiming, yieldNow = (options) => {
  const effect = new EffectPrimitive(OP_YIELD);
  return typeof options?.priority !== "undefined" ? withSchedulingPriority(effect, options.priority) : effect;
}, zip2, zipLeft2, zipRight2, zipWith3, never, interruptFiber = (self) => flatMap7(fiberId, (fiberId2) => pipe(self, interruptAsFiber(fiberId2))), interruptAsFiber, logLevelAll, logLevelFatal, logLevelError, logLevelWarning, logLevelInfo, logLevelDebug, logLevelTrace, logLevelNone, FiberRefSymbolKey = "effect/FiberRef", FiberRefTypeId, fiberRefVariance, fiberRefGet = (self) => withFiberRuntime((fiber) => exitSucceed(fiber.getFiberRef(self))), fiberRefGetWith, fiberRefSet, fiberRefModify, fiberRefLocally, fiberRefLocallyWith, fiberRefUnsafeMake = (initial, options) => fiberRefUnsafeMakePatch(initial, {
  differ: update(),
  fork: options?.fork ?? identity,
  join: options?.join
}), fiberRefUnsafeMakeHashSet = (initial) => {
  const differ2 = hashSet();
  return fiberRefUnsafeMakePatch(initial, {
    differ: differ2,
    fork: differ2.empty
  });
}, fiberRefUnsafeMakeReadonlyArray = (initial) => {
  const differ2 = readonlyArray(update());
  return fiberRefUnsafeMakePatch(initial, {
    differ: differ2,
    fork: differ2.empty
  });
}, fiberRefUnsafeMakeContext = (initial) => {
  const differ2 = environment();
  return fiberRefUnsafeMakePatch(initial, {
    differ: differ2,
    fork: differ2.empty
  });
}, fiberRefUnsafeMakePatch = (initial, options) => {
  const _fiberRef = {
    ...CommitPrototype,
    [FiberRefTypeId]: fiberRefVariance,
    initial,
    commit() {
      return fiberRefGet(this);
    },
    diff: (oldValue, newValue) => options.differ.diff(oldValue, newValue),
    combine: (first, second) => options.differ.combine(first, second),
    patch: (patch5) => (oldValue) => options.differ.patch(patch5, oldValue),
    fork: options.fork,
    join: options.join ?? ((_, n) => n)
  };
  return _fiberRef;
}, fiberRefUnsafeMakeRuntimeFlags = (initial) => fiberRefUnsafeMakePatch(initial, {
  differ,
  fork: differ.empty
}), currentContext, currentSchedulingPriority, currentMaxOpsBeforeYield, currentLogAnnotations, currentLogLevel, currentLogSpan, withSchedulingPriority, withMaxOpsBeforeYield, currentConcurrency, currentRequestBatching, currentUnhandledErrorLogLevel, currentVersionMismatchErrorLogLevel, withUnhandledErrorLogLevel, currentMetricLabels, metricLabels, currentForkScopeOverride, currentInterruptedCause, currentTracerEnabled, currentTracerTimingEnabled, currentTracerSpanAnnotations, currentTracerSpanLinks, ScopeTypeId, CloseableScopeTypeId, scopeAddFinalizer = (self, finalizer) => self.addFinalizer(() => asVoid2(finalizer)), scopeAddFinalizerExit = (self, finalizer) => self.addFinalizer(finalizer), scopeClose = (self, exit2) => self.close(exit2), scopeFork = (self, strategy) => self.fork(strategy), causeSquash = (self) => {
  return causeSquashWith(identity)(self);
}, causeSquashWith, YieldableError, makeException = (proto2, tag) => {

  class Base2 extends YieldableError {
    _tag = tag;
  }
  Object.assign(Base2.prototype, proto2);
  Base2.prototype.name = tag;
  return Base2;
}, RuntimeExceptionTypeId, RuntimeException, isRuntimeException = (u) => hasProperty(u, RuntimeExceptionTypeId), InterruptedExceptionTypeId, InterruptedException, isInterruptedException = (u) => hasProperty(u, InterruptedExceptionTypeId), IllegalArgumentExceptionTypeId, IllegalArgumentException, isIllegalArgumentException = (u) => hasProperty(u, IllegalArgumentExceptionTypeId), NoSuchElementExceptionTypeId, NoSuchElementException, isNoSuchElementException = (u) => hasProperty(u, NoSuchElementExceptionTypeId), InvalidPubSubCapacityExceptionTypeId, InvalidPubSubCapacityException, ExceededCapacityExceptionTypeId, ExceededCapacityException, isExceededCapacityException = (u) => hasProperty(u, ExceededCapacityExceptionTypeId), TimeoutExceptionTypeId, TimeoutException, timeoutExceptionFromDuration = (duration) => new TimeoutException(`Operation timed out after '${format2(duration)}'`), isTimeoutException = (u) => hasProperty(u, TimeoutExceptionTypeId), UnknownExceptionTypeId, UnknownException, isUnknownException = (u) => hasProperty(u, UnknownExceptionTypeId), exitIsExit = (u) => isEffect(u) && ("_tag" in u) && (u._tag === "Success" || u._tag === "Failure"), exitIsFailure = (self) => self._tag === "Failure", exitIsSuccess = (self) => self._tag === "Success", exitIsInterrupted = (self) => {
  switch (self._tag) {
    case OP_FAILURE:
      return isInterrupted(self.effect_instruction_i0);
    case OP_SUCCESS:
      return false;
  }
}, exitAs, exitAsVoid = (self) => exitAs(self, undefined), exitCauseOption = (self) => {
  switch (self._tag) {
    case OP_FAILURE:
      return some2(self.effect_instruction_i0);
    case OP_SUCCESS:
      return none2();
  }
}, exitCollectAll = (exits, options) => exitCollectAllInternal(exits, options?.parallel ? parallel : sequential), exitDie = (defect) => exitFailCause(die(defect)), exitExists, exitFail = (error) => exitFailCause(fail(error)), exitFailCause = (cause) => {
  const effect = new EffectPrimitiveFailure(OP_FAILURE);
  effect.effect_instruction_i0 = cause;
  return effect;
}, exitFlatMap, exitFlatMapEffect, exitFlatten = (self) => pipe(self, exitFlatMap(identity)), exitForEachEffect, exitFromEither = (either3) => {
  switch (either3._tag) {
    case "Left":
      return exitFail(either3.left);
    case "Right":
      return exitSucceed(either3.right);
  }
}, exitFromOption = (option) => {
  switch (option._tag) {
    case "None":
      return exitFail(undefined);
    case "Some":
      return exitSucceed(option.value);
  }
}, exitGetOrElse, exitInterrupt = (fiberId2) => exitFailCause(interrupt(fiberId2)), exitMap, exitMapBoth, exitMapError, exitMapErrorCause, exitMatch, exitMatchEffect, exitSucceed = (value) => {
  const effect = new EffectPrimitiveSuccess(OP_SUCCESS);
  effect.effect_instruction_i0 = value;
  return effect;
}, exitVoid, exitZip, exitZipLeft, exitZipRight, exitZipPar, exitZipParLeft, exitZipParRight, exitZipWith, exitCollectAllInternal = (exits, combineCauses) => {
  const list = fromIterable3(exits);
  if (!isNonEmpty(list)) {
    return none2();
  }
  return pipe(tailNonEmpty2(list), reduce(pipe(headNonEmpty2(list), exitMap(of2)), (accumulator, current) => pipe(accumulator, exitZipWith(current, {
    onSuccess: (list2, value) => pipe(list2, prepend2(value)),
    onFailure: combineCauses
  }))), exitMap(reverse2), exitMap((chunk) => toReadonlyArray(chunk)), some2);
}, deferredUnsafeMake = (fiberId2) => {
  const _deferred = {
    ...CommitPrototype,
    [DeferredTypeId]: deferredVariance,
    state: make11(pending([])),
    commit() {
      return deferredAwait(this);
    },
    blockingOn: fiberId2
  };
  return _deferred;
}, deferredMake = () => flatMap7(fiberId, (id) => deferredMakeAs(id)), deferredMakeAs = (fiberId2) => sync(() => deferredUnsafeMake(fiberId2)), deferredAwait = (self) => asyncInterrupt((resume) => {
  const state = get6(self.state);
  switch (state._tag) {
    case OP_STATE_DONE: {
      return resume(state.effect);
    }
    case OP_STATE_PENDING: {
      state.joiners.push(resume);
      return deferredInterruptJoiner(self, resume);
    }
  }
}, self.blockingOn), deferredComplete, deferredCompleteWith, deferredDone, deferredFailCause, deferredInterrupt = (self) => flatMap7(fiberId, (fiberId2) => deferredCompleteWith(self, interruptWith(fiberId2))), deferredSucceed, deferredUnsafeDone = (self, effect) => {
  const state = get6(self.state);
  if (state._tag === OP_STATE_PENDING) {
    set2(self.state, done(effect));
    for (let i = 0, len = state.joiners.length;i < len; i++) {
      state.joiners[i](effect);
    }
  }
}, deferredInterruptJoiner = (self, joiner) => sync(() => {
  const state = get6(self.state);
  if (state._tag === OP_STATE_PENDING) {
    const index = state.joiners.indexOf(joiner);
    if (index >= 0) {
      state.joiners.splice(index, 1);
    }
  }
}), constContext, context = () => constContext, contextWithEffect = (f) => flatMap7(context(), f), provideContext, provideSomeContext, mapInputContext, filterEffectOrElse, filterEffectOrFail, currentSpanFromFiber = (fiber) => {
  const span2 = fiber.currentSpan;
  return span2 !== undefined && span2._tag === "Span" ? some2(span2) : none2();
}, NoopSpanProto, noopSpan = (options) => Object.assign(Object.create(NoopSpanProto), options);
var init_core = __esm(() => {
  init_Array();
  init_Chunk();
  init_Context();
  init_Duration();
  init_Either();
  init_Equal();
  init_FiberId();
  init_Function();
  init_Hash();
  init_HashMap();
  init_Inspectable();
  init_List();
  init_MutableRef();
  init_Option();
  init_Pipeable();
  init_Predicate();
  init_RuntimeFlagsPatch();
  init_Utils();
  init_cause();
  init_deferred();
  init_differ();
  init_effectable();
  init_runtimeFlags();
  init_singleShotGen();
  EffectTypeId2 = /* @__PURE__ */ Symbol.for("effect/Effect");
  EffectPrimitive = class EffectPrimitive {
    _op;
    effect_instruction_i0 = undefined;
    effect_instruction_i1 = undefined;
    effect_instruction_i2 = undefined;
    trace = undefined;
    [EffectTypeId2] = effectVariance;
    constructor(_op) {
      this._op = _op;
    }
    [symbol2](that) {
      return this === that;
    }
    [symbol]() {
      return cached(this, random(this));
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
    toJSON() {
      return {
        _id: "Effect",
        _op: this._op,
        effect_instruction_i0: toJSON(this.effect_instruction_i0),
        effect_instruction_i1: toJSON(this.effect_instruction_i1),
        effect_instruction_i2: toJSON(this.effect_instruction_i2)
      };
    }
    toString() {
      return format(this.toJSON());
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
    [Symbol.iterator]() {
      return new SingleShotGen2(new YieldWrap(this));
    }
  };
  EffectPrimitiveFailure = class EffectPrimitiveFailure {
    _op;
    effect_instruction_i0 = undefined;
    effect_instruction_i1 = undefined;
    effect_instruction_i2 = undefined;
    trace = undefined;
    [EffectTypeId2] = effectVariance;
    constructor(_op) {
      this._op = _op;
      this._tag = _op;
    }
    [symbol2](that) {
      return exitIsExit(that) && that._op === "Failure" && equals(this.effect_instruction_i0, that.effect_instruction_i0);
    }
    [symbol]() {
      return pipe(string(this._tag), combine(hash(this.effect_instruction_i0)), cached(this));
    }
    get cause() {
      return this.effect_instruction_i0;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
    toJSON() {
      return {
        _id: "Exit",
        _tag: this._op,
        cause: this.cause.toJSON()
      };
    }
    toString() {
      return format(this.toJSON());
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
    [Symbol.iterator]() {
      return new SingleShotGen2(new YieldWrap(this));
    }
  };
  EffectPrimitiveSuccess = class EffectPrimitiveSuccess {
    _op;
    effect_instruction_i0 = undefined;
    effect_instruction_i1 = undefined;
    effect_instruction_i2 = undefined;
    trace = undefined;
    [EffectTypeId2] = effectVariance;
    constructor(_op) {
      this._op = _op;
      this._tag = _op;
    }
    [symbol2](that) {
      return exitIsExit(that) && that._op === "Success" && equals(this.effect_instruction_i0, that.effect_instruction_i0);
    }
    [symbol]() {
      return pipe(string(this._tag), combine(hash(this.effect_instruction_i0)), cached(this));
    }
    get value() {
      return this.effect_instruction_i0;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
    toJSON() {
      return {
        _id: "Exit",
        _tag: this._op,
        value: toJSON(this.value)
      };
    }
    toString() {
      return format(this.toJSON());
    }
    [NodeInspectSymbol]() {
      return this.toJSON();
    }
    [Symbol.iterator]() {
      return new SingleShotGen2(new YieldWrap(this));
    }
  };
  acquireUseRelease = /* @__PURE__ */ dual(3, (acquire, use, release) => uninterruptibleMask((restore) => flatMap7(acquire, (a) => flatMap7(exit(suspend(() => restore(use(a)))), (exit) => {
    return suspend(() => release(a, exit)).pipe(matchCauseEffect({
      onFailure: (cause) => {
        switch (exit._tag) {
          case OP_FAILURE:
            return failCause(sequential(exit.effect_instruction_i0, cause));
          case OP_SUCCESS:
            return failCause(cause);
        }
      },
      onSuccess: () => exit
    }));
  }))));
  as3 = /* @__PURE__ */ dual(2, (self, value) => flatMap7(self, () => succeed(value)));
  catchAllCause = /* @__PURE__ */ dual(2, (self, f) => {
    const effect = new EffectPrimitive(OP_ON_FAILURE);
    effect.effect_instruction_i0 = self;
    effect.effect_instruction_i1 = f;
    return effect;
  });
  catchAll = /* @__PURE__ */ dual(2, (self, f) => matchEffect(self, {
    onFailure: f,
    onSuccess: succeed
  }));
  catchIf = /* @__PURE__ */ dual(3, (self, predicate, f) => catchAllCause(self, (cause) => {
    const either2 = failureOrCause(cause);
    switch (either2._tag) {
      case "Left":
        return predicate(either2.left) ? f(either2.left) : failCause(cause);
      case "Right":
        return failCause(either2.right);
    }
  }));
  catchSome = /* @__PURE__ */ dual(2, (self, pf) => catchAllCause(self, (cause) => {
    const either2 = failureOrCause(cause);
    switch (either2._tag) {
      case "Left":
        return pipe(pf(either2.left), getOrElse(() => failCause(cause)));
      case "Right":
        return failCause(either2.right);
    }
  }));
  originalSymbol = /* @__PURE__ */ Symbol.for("effect/OriginalAnnotation");
  fiberId = /* @__PURE__ */ withFiberRuntime((state) => succeed(state.id()));
  flatMap7 = /* @__PURE__ */ dual(2, (self, f) => {
    const effect = new EffectPrimitive(OP_ON_SUCCESS);
    effect.effect_instruction_i0 = self;
    effect.effect_instruction_i1 = f;
    return effect;
  });
  andThen4 = /* @__PURE__ */ dual(2, (self, f) => flatMap7(self, (a) => {
    const b = typeof f === "function" ? f(a) : f;
    if (isEffect(b)) {
      return b;
    } else if (isPromiseLike(b)) {
      return unsafeAsync((resume) => {
        b.then((a2) => resume(succeed(a2)), (e) => resume(fail2(new UnknownException(e, "An unknown error occurred in Effect.andThen"))));
      });
    }
    return succeed(b);
  }));
  matchCause = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
    onFailure: (cause) => succeed(options.onFailure(cause)),
    onSuccess: (a) => succeed(options.onSuccess(a))
  }));
  matchCauseEffect = /* @__PURE__ */ dual(2, (self, options) => {
    const effect = new EffectPrimitive(OP_ON_SUCCESS_AND_FAILURE);
    effect.effect_instruction_i0 = self;
    effect.effect_instruction_i1 = options.onFailure;
    effect.effect_instruction_i2 = options.onSuccess;
    return effect;
  });
  matchEffect = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
    onFailure: (cause) => {
      const defects2 = defects(cause);
      if (defects2.length > 0) {
        return failCause(electFailures(cause));
      }
      const failures2 = failures(cause);
      if (failures2.length > 0) {
        return options.onFailure(unsafeHead(failures2));
      }
      return failCause(cause);
    },
    onSuccess: options.onSuccess
  }));
  forEachSequential = /* @__PURE__ */ dual(2, (self, f) => suspend(() => {
    const arr = fromIterable2(self);
    const ret = allocate(arr.length);
    let i = 0;
    return as3(whileLoop({
      while: () => i < arr.length,
      body: () => f(arr[i], i),
      step: (b) => {
        ret[i++] = b;
      }
    }), ret);
  }));
  forEachSequentialDiscard = /* @__PURE__ */ dual(2, (self, f) => suspend(() => {
    const arr = fromIterable2(self);
    let i = 0;
    return whileLoop({
      while: () => i < arr.length,
      body: () => f(arr[i], i),
      step: () => {
        i++;
      }
    });
  }));
  if_ = /* @__PURE__ */ dual((args) => typeof args[0] === "boolean" || isEffect(args[0]), (self, options) => isEffect(self) ? flatMap7(self, (b) => b ? options.onTrue() : options.onFalse()) : self ? options.onTrue() : options.onFalse());
  interrupt2 = /* @__PURE__ */ flatMap7(fiberId, (fiberId2) => interruptWith(fiberId2));
  intoDeferred = /* @__PURE__ */ dual(2, (self, deferred) => uninterruptibleMask((restore) => flatMap7(exit(restore(self)), (exit2) => deferredDone(deferred, exit2))));
  map8 = /* @__PURE__ */ dual(2, (self, f) => flatMap7(self, (a) => sync(() => f(a))));
  mapBoth = /* @__PURE__ */ dual(2, (self, options) => matchEffect(self, {
    onFailure: (e) => failSync(() => options.onFailure(e)),
    onSuccess: (a) => sync(() => options.onSuccess(a))
  }));
  mapError = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (cause) => {
      const either3 = failureOrCause(cause);
      switch (either3._tag) {
        case "Left": {
          return failSync(() => f(either3.left));
        }
        case "Right": {
          return failCause(either3.right);
        }
      }
    },
    onSuccess: succeed
  }));
  onError = /* @__PURE__ */ dual(2, (self, cleanup) => onExit(self, (exit2) => exitIsSuccess(exit2) ? void_2 : cleanup(exit2.effect_instruction_i0)));
  onExit = /* @__PURE__ */ dual(2, (self, cleanup) => uninterruptibleMask((restore) => matchCauseEffect(restore(self), {
    onFailure: (cause1) => {
      const result = exitFailCause(cause1);
      return matchCauseEffect(cleanup(result), {
        onFailure: (cause2) => exitFailCause(sequential(cause1, cause2)),
        onSuccess: () => result
      });
    },
    onSuccess: (success) => {
      const result = exitSucceed(success);
      return zipRight2(cleanup(result), result);
    }
  })));
  onInterrupt = /* @__PURE__ */ dual(2, (self, cleanup) => onExit(self, exitMatch({
    onFailure: (cause) => isInterruptedOnly(cause) ? asVoid2(cleanup(interruptors(cause))) : void_2,
    onSuccess: () => void_2
  })));
  orElse2 = /* @__PURE__ */ dual(2, (self, that) => attemptOrElse(self, that, succeed));
  orDieWith = /* @__PURE__ */ dual(2, (self, f) => matchEffect(self, {
    onFailure: (e) => die2(f(e)),
    onSuccess: succeed
  }));
  partitionMap3 = partitionMap2;
  runtimeFlags = /* @__PURE__ */ withFiberRuntime((_, status) => succeed(status.runtimeFlags));
  tap2 = /* @__PURE__ */ dual((args) => args.length === 3 || args.length === 2 && !(isObject(args[1]) && ("onlyEffect" in args[1])), (self, f) => flatMap7(self, (a) => {
    const b = typeof f === "function" ? f(a) : f;
    if (isEffect(b)) {
      return as3(b, a);
    } else if (isPromiseLike(b)) {
      return unsafeAsync((resume) => {
        b.then((_) => resume(succeed(a)), (e) => resume(fail2(new UnknownException(e, "An unknown error occurred in Effect.tap"))));
      });
    }
    return succeed(a);
  }));
  attemptOrElse = /* @__PURE__ */ dual(3, (self, that, onSuccess) => matchCauseEffect(self, {
    onFailure: (cause) => {
      const defects2 = defects(cause);
      if (defects2.length > 0) {
        return failCause(getOrThrow(keepDefectsAndElectFailures(cause)));
      }
      return that();
    },
    onSuccess
  }));
  void_2 = /* @__PURE__ */ succeed(undefined);
  whenEffect = /* @__PURE__ */ dual(2, (self, condition) => flatMap7(condition, (b) => {
    if (b) {
      return pipe(self, map8(some2));
    }
    return succeed(none2());
  }));
  withConcurrency = /* @__PURE__ */ dual(2, (self, concurrency) => fiberRefLocally(self, currentConcurrency, concurrency));
  withRequestBatching = /* @__PURE__ */ dual(2, (self, requestBatching) => fiberRefLocally(self, currentRequestBatching, requestBatching));
  withRuntimeFlags = /* @__PURE__ */ dual(2, (self, update2) => {
    const effect = new EffectPrimitive(OP_UPDATE_RUNTIME_FLAGS);
    effect.effect_instruction_i0 = update2;
    effect.effect_instruction_i1 = () => self;
    return effect;
  });
  withTracerEnabled = /* @__PURE__ */ dual(2, (effect, enabled2) => fiberRefLocally(effect, currentTracerEnabled, enabled2));
  withTracerTiming = /* @__PURE__ */ dual(2, (effect, enabled2) => fiberRefLocally(effect, currentTracerTimingEnabled, enabled2));
  zip2 = /* @__PURE__ */ dual(2, (self, that) => flatMap7(self, (a) => map8(that, (b) => [a, b])));
  zipLeft2 = /* @__PURE__ */ dual(2, (self, that) => flatMap7(self, (a) => as3(that, a)));
  zipRight2 = /* @__PURE__ */ dual(2, (self, that) => flatMap7(self, () => that));
  zipWith3 = /* @__PURE__ */ dual(3, (self, that, f) => flatMap7(self, (a) => map8(that, (b) => f(a, b))));
  never = /* @__PURE__ */ asyncInterrupt(() => {
    const interval = setInterval(() => {}, 2 ** 31 - 1);
    return sync(() => clearInterval(interval));
  });
  interruptAsFiber = /* @__PURE__ */ dual(2, (self, fiberId2) => flatMap7(self.interruptAsFork(fiberId2), () => self.await));
  logLevelAll = {
    _tag: "All",
    syslog: 0,
    label: "ALL",
    ordinal: Number.MIN_SAFE_INTEGER,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelFatal = {
    _tag: "Fatal",
    syslog: 2,
    label: "FATAL",
    ordinal: 50000,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelError = {
    _tag: "Error",
    syslog: 3,
    label: "ERROR",
    ordinal: 40000,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelWarning = {
    _tag: "Warning",
    syslog: 4,
    label: "WARN",
    ordinal: 30000,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelInfo = {
    _tag: "Info",
    syslog: 6,
    label: "INFO",
    ordinal: 20000,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelDebug = {
    _tag: "Debug",
    syslog: 7,
    label: "DEBUG",
    ordinal: 1e4,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelTrace = {
    _tag: "Trace",
    syslog: 7,
    label: "TRACE",
    ordinal: 0,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  logLevelNone = {
    _tag: "None",
    syslog: 7,
    label: "OFF",
    ordinal: Number.MAX_SAFE_INTEGER,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  FiberRefTypeId = /* @__PURE__ */ Symbol.for(FiberRefSymbolKey);
  fiberRefVariance = {
    _A: (_) => _
  };
  fiberRefGetWith = /* @__PURE__ */ dual(2, (self, f) => flatMap7(fiberRefGet(self), f));
  fiberRefSet = /* @__PURE__ */ dual(2, (self, value) => fiberRefModify(self, () => [undefined, value]));
  fiberRefModify = /* @__PURE__ */ dual(2, (self, f) => withFiberRuntime((state) => {
    const [b, a] = f(state.getFiberRef(self));
    state.setFiberRef(self, a);
    return succeed(b);
  }));
  fiberRefLocally = /* @__PURE__ */ dual(3, (use, self, value) => acquireUseRelease(zipLeft2(fiberRefGet(self), fiberRefSet(self, value)), () => use, (oldValue) => fiberRefSet(self, oldValue)));
  fiberRefLocallyWith = /* @__PURE__ */ dual(3, (use, self, f) => fiberRefGetWith(self, (a) => fiberRefLocally(use, self, f(a))));
  currentContext = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentContext"), () => fiberRefUnsafeMakeContext(empty8()));
  currentSchedulingPriority = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentSchedulingPriority"), () => fiberRefUnsafeMake(0));
  currentMaxOpsBeforeYield = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentMaxOpsBeforeYield"), () => fiberRefUnsafeMake(2048));
  currentLogAnnotations = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLogAnnotation"), () => fiberRefUnsafeMake(empty9()));
  currentLogLevel = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLogLevel"), () => fiberRefUnsafeMake(logLevelInfo));
  currentLogSpan = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLogSpan"), () => fiberRefUnsafeMake(empty10()));
  withSchedulingPriority = /* @__PURE__ */ dual(2, (self, scheduler) => fiberRefLocally(self, currentSchedulingPriority, scheduler));
  withMaxOpsBeforeYield = /* @__PURE__ */ dual(2, (self, scheduler) => fiberRefLocally(self, currentMaxOpsBeforeYield, scheduler));
  currentConcurrency = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentConcurrency"), () => fiberRefUnsafeMake("unbounded"));
  currentRequestBatching = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentRequestBatching"), () => fiberRefUnsafeMake(true));
  currentUnhandledErrorLogLevel = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentUnhandledErrorLogLevel"), () => fiberRefUnsafeMake(some2(logLevelDebug)));
  currentVersionMismatchErrorLogLevel = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/versionMismatchErrorLogLevel"), () => fiberRefUnsafeMake(some2(logLevelWarning)));
  withUnhandledErrorLogLevel = /* @__PURE__ */ dual(2, (self, level) => fiberRefLocally(self, currentUnhandledErrorLogLevel, level));
  currentMetricLabels = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentMetricLabels"), () => fiberRefUnsafeMakeReadonlyArray(empty()));
  metricLabels = /* @__PURE__ */ fiberRefGet(currentMetricLabels);
  currentForkScopeOverride = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentForkScopeOverride"), () => fiberRefUnsafeMake(none2(), {
    fork: () => none2(),
    join: (parent, _) => parent
  }));
  currentInterruptedCause = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentInterruptedCause"), () => fiberRefUnsafeMake(empty6, {
    fork: () => empty6,
    join: (parent, _) => parent
  }));
  currentTracerEnabled = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerEnabled"), () => fiberRefUnsafeMake(true));
  currentTracerTimingEnabled = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerTiming"), () => fiberRefUnsafeMake(true));
  currentTracerSpanAnnotations = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerSpanAnnotations"), () => fiberRefUnsafeMake(empty9()));
  currentTracerSpanLinks = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentTracerSpanLinks"), () => fiberRefUnsafeMake(empty2()));
  ScopeTypeId = /* @__PURE__ */ Symbol.for("effect/Scope");
  CloseableScopeTypeId = /* @__PURE__ */ Symbol.for("effect/CloseableScope");
  causeSquashWith = /* @__PURE__ */ dual(2, (self, f) => {
    const option = pipe(self, failureOption, map(f));
    switch (option._tag) {
      case "None": {
        return pipe(defects(self), head2, match2({
          onNone: () => {
            const interrupts = fromIterable2(interruptors(self)).flatMap((fiberId2) => fromIterable2(ids2(fiberId2)).map((id) => `#${id}`));
            return new InterruptedException(interrupts ? `Interrupted by fibers: ${interrupts.join(", ")}` : undefined);
          },
          onSome: identity
        }));
      }
      case "Some": {
        return option.value;
      }
    }
  });
  YieldableError = /* @__PURE__ */ function() {

    class YieldableError2 extends globalThis.Error {
      commit() {
        return fail2(this);
      }
      toJSON() {
        const obj = {
          ...this
        };
        if (this.message)
          obj.message = this.message;
        if (this.cause)
          obj.cause = this.cause;
        return obj;
      }
      [NodeInspectSymbol]() {
        if (this.toString !== globalThis.Error.prototype.toString) {
          return this.stack ? `${this.toString()}
${this.stack.split(`
`).slice(1).join(`
`)}` : this.toString();
        } else if ("Bun" in globalThis) {
          return pretty(fail(this), {
            renderErrorCause: true
          });
        }
        return this;
      }
    }
    Object.assign(YieldableError2.prototype, StructuralCommitPrototype);
    return YieldableError2;
  }();
  RuntimeExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/RuntimeException");
  RuntimeException = /* @__PURE__ */ makeException({
    [RuntimeExceptionTypeId]: RuntimeExceptionTypeId
  }, "RuntimeException");
  InterruptedExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/InterruptedException");
  InterruptedException = /* @__PURE__ */ makeException({
    [InterruptedExceptionTypeId]: InterruptedExceptionTypeId
  }, "InterruptedException");
  IllegalArgumentExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/IllegalArgument");
  IllegalArgumentException = /* @__PURE__ */ makeException({
    [IllegalArgumentExceptionTypeId]: IllegalArgumentExceptionTypeId
  }, "IllegalArgumentException");
  NoSuchElementExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/NoSuchElement");
  NoSuchElementException = /* @__PURE__ */ makeException({
    [NoSuchElementExceptionTypeId]: NoSuchElementExceptionTypeId
  }, "NoSuchElementException");
  InvalidPubSubCapacityExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/InvalidPubSubCapacityException");
  InvalidPubSubCapacityException = /* @__PURE__ */ makeException({
    [InvalidPubSubCapacityExceptionTypeId]: InvalidPubSubCapacityExceptionTypeId
  }, "InvalidPubSubCapacityException");
  ExceededCapacityExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/ExceededCapacityException");
  ExceededCapacityException = /* @__PURE__ */ makeException({
    [ExceededCapacityExceptionTypeId]: ExceededCapacityExceptionTypeId
  }, "ExceededCapacityException");
  TimeoutExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/Timeout");
  TimeoutException = /* @__PURE__ */ makeException({
    [TimeoutExceptionTypeId]: TimeoutExceptionTypeId
  }, "TimeoutException");
  UnknownExceptionTypeId = /* @__PURE__ */ Symbol.for("effect/Cause/errors/UnknownException");
  UnknownException = /* @__PURE__ */ function() {

    class UnknownException2 extends YieldableError {
      _tag = "UnknownException";
      error;
      constructor(cause, message) {
        super(message ?? "An unknown error occurred", {
          cause
        });
        this.error = cause;
      }
    }
    Object.assign(UnknownException2.prototype, {
      [UnknownExceptionTypeId]: UnknownExceptionTypeId,
      name: "UnknownException"
    });
    return UnknownException2;
  }();
  exitAs = /* @__PURE__ */ dual(2, (self, value) => {
    switch (self._tag) {
      case OP_FAILURE: {
        return exitFailCause(self.effect_instruction_i0);
      }
      case OP_SUCCESS: {
        return exitSucceed(value);
      }
    }
  });
  exitExists = /* @__PURE__ */ dual(2, (self, refinement) => {
    switch (self._tag) {
      case OP_FAILURE:
        return false;
      case OP_SUCCESS:
        return refinement(self.effect_instruction_i0);
    }
  });
  exitFlatMap = /* @__PURE__ */ dual(2, (self, f) => {
    switch (self._tag) {
      case OP_FAILURE: {
        return exitFailCause(self.effect_instruction_i0);
      }
      case OP_SUCCESS: {
        return f(self.effect_instruction_i0);
      }
    }
  });
  exitFlatMapEffect = /* @__PURE__ */ dual(2, (self, f) => {
    switch (self._tag) {
      case OP_FAILURE: {
        return succeed(exitFailCause(self.effect_instruction_i0));
      }
      case OP_SUCCESS: {
        return f(self.effect_instruction_i0);
      }
    }
  });
  exitForEachEffect = /* @__PURE__ */ dual(2, (self, f) => {
    switch (self._tag) {
      case OP_FAILURE: {
        return succeed(exitFailCause(self.effect_instruction_i0));
      }
      case OP_SUCCESS: {
        return exit(f(self.effect_instruction_i0));
      }
    }
  });
  exitGetOrElse = /* @__PURE__ */ dual(2, (self, orElse3) => {
    switch (self._tag) {
      case OP_FAILURE:
        return orElse3(self.effect_instruction_i0);
      case OP_SUCCESS:
        return self.effect_instruction_i0;
    }
  });
  exitMap = /* @__PURE__ */ dual(2, (self, f) => {
    switch (self._tag) {
      case OP_FAILURE:
        return exitFailCause(self.effect_instruction_i0);
      case OP_SUCCESS:
        return exitSucceed(f(self.effect_instruction_i0));
    }
  });
  exitMapBoth = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => {
    switch (self._tag) {
      case OP_FAILURE:
        return exitFailCause(pipe(self.effect_instruction_i0, map6(onFailure)));
      case OP_SUCCESS:
        return exitSucceed(onSuccess(self.effect_instruction_i0));
    }
  });
  exitMapError = /* @__PURE__ */ dual(2, (self, f) => {
    switch (self._tag) {
      case OP_FAILURE:
        return exitFailCause(pipe(self.effect_instruction_i0, map6(f)));
      case OP_SUCCESS:
        return exitSucceed(self.effect_instruction_i0);
    }
  });
  exitMapErrorCause = /* @__PURE__ */ dual(2, (self, f) => {
    switch (self._tag) {
      case OP_FAILURE:
        return exitFailCause(f(self.effect_instruction_i0));
      case OP_SUCCESS:
        return exitSucceed(self.effect_instruction_i0);
    }
  });
  exitMatch = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => {
    switch (self._tag) {
      case OP_FAILURE:
        return onFailure(self.effect_instruction_i0);
      case OP_SUCCESS:
        return onSuccess(self.effect_instruction_i0);
    }
  });
  exitMatchEffect = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => {
    switch (self._tag) {
      case OP_FAILURE:
        return onFailure(self.effect_instruction_i0);
      case OP_SUCCESS:
        return onSuccess(self.effect_instruction_i0);
    }
  });
  exitVoid = /* @__PURE__ */ exitSucceed(undefined);
  exitZip = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
    onSuccess: (a, a2) => [a, a2],
    onFailure: sequential
  }));
  exitZipLeft = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
    onSuccess: (a, _) => a,
    onFailure: sequential
  }));
  exitZipRight = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
    onSuccess: (_, a2) => a2,
    onFailure: sequential
  }));
  exitZipPar = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
    onSuccess: (a, a2) => [a, a2],
    onFailure: parallel
  }));
  exitZipParLeft = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
    onSuccess: (a, _) => a,
    onFailure: parallel
  }));
  exitZipParRight = /* @__PURE__ */ dual(2, (self, that) => exitZipWith(self, that, {
    onSuccess: (_, a2) => a2,
    onFailure: parallel
  }));
  exitZipWith = /* @__PURE__ */ dual(3, (self, that, {
    onFailure,
    onSuccess
  }) => {
    switch (self._tag) {
      case OP_FAILURE: {
        switch (that._tag) {
          case OP_SUCCESS:
            return exitFailCause(self.effect_instruction_i0);
          case OP_FAILURE: {
            return exitFailCause(onFailure(self.effect_instruction_i0, that.effect_instruction_i0));
          }
        }
      }
      case OP_SUCCESS: {
        switch (that._tag) {
          case OP_SUCCESS:
            return exitSucceed(onSuccess(self.effect_instruction_i0, that.effect_instruction_i0));
          case OP_FAILURE:
            return exitFailCause(that.effect_instruction_i0);
        }
      }
    }
  });
  deferredComplete = /* @__PURE__ */ dual(2, (self, effect) => intoDeferred(effect, self));
  deferredCompleteWith = /* @__PURE__ */ dual(2, (self, effect) => sync(() => {
    const state = get6(self.state);
    switch (state._tag) {
      case OP_STATE_DONE: {
        return false;
      }
      case OP_STATE_PENDING: {
        set2(self.state, done(effect));
        for (let i = 0, len = state.joiners.length;i < len; i++) {
          state.joiners[i](effect);
        }
        return true;
      }
    }
  }));
  deferredDone = /* @__PURE__ */ dual(2, (self, exit2) => deferredCompleteWith(self, exit2));
  deferredFailCause = /* @__PURE__ */ dual(2, (self, cause) => deferredCompleteWith(self, failCause(cause)));
  deferredSucceed = /* @__PURE__ */ dual(2, (self, value) => deferredCompleteWith(self, succeed(value)));
  constContext = /* @__PURE__ */ withFiberRuntime((fiber) => exitSucceed(fiber.currentContext));
  provideContext = /* @__PURE__ */ dual(2, (self, context2) => fiberRefLocally(currentContext, context2)(self));
  provideSomeContext = /* @__PURE__ */ dual(2, (self, context2) => fiberRefLocallyWith(currentContext, (parent) => merge3(parent, context2))(self));
  mapInputContext = /* @__PURE__ */ dual(2, (self, f) => contextWithEffect((context2) => provideContext(self, f(context2))));
  filterEffectOrElse = /* @__PURE__ */ dual(2, (self, options) => flatMap7(self, (a) => flatMap7(options.predicate(a), (pass) => pass ? succeed(a) : options.orElse(a))));
  filterEffectOrFail = /* @__PURE__ */ dual(2, (self, options) => filterEffectOrElse(self, {
    predicate: options.predicate,
    orElse: (a) => fail2(options.orFailWith(a))
  }));
  NoopSpanProto = {
    _tag: "Span",
    spanId: "noop",
    traceId: "noop",
    sampled: false,
    status: {
      _tag: "Ended",
      startTime: /* @__PURE__ */ BigInt(0),
      endTime: /* @__PURE__ */ BigInt(0),
      exit: exitVoid
    },
    attributes: /* @__PURE__ */ new Map,
    links: [],
    kind: "internal",
    attribute() {},
    event() {},
    end() {},
    addLinks() {}
  };
});

// node_modules/effect/dist/esm/Cause.js
var exports_Cause = {};
__export(exports_Cause, {
  stripSomeDefects: () => stripSomeDefects2,
  stripFailures: () => stripFailures2,
  squashWith: () => squashWith,
  squash: () => squash,
  size: () => size5,
  sequential: () => sequential2,
  reduceWithContext: () => reduceWithContext2,
  reduce: () => reduce8,
  prettyErrors: () => prettyErrors2,
  pretty: () => pretty2,
  parallel: () => parallel2,
  originalError: () => originalError,
  match: () => match5,
  map: () => map9,
  linearize: () => linearize2,
  keepDefects: () => keepDefects2,
  isUnknownException: () => isUnknownException2,
  isTimeoutException: () => isTimeoutException2,
  isSequentialType: () => isSequentialType2,
  isRuntimeException: () => isRuntimeException2,
  isParallelType: () => isParallelType2,
  isNoSuchElementException: () => isNoSuchElementException2,
  isInterruptedOnly: () => isInterruptedOnly2,
  isInterruptedException: () => isInterruptedException2,
  isInterrupted: () => isInterrupted2,
  isInterruptType: () => isInterruptType2,
  isIllegalArgumentException: () => isIllegalArgumentException2,
  isFailure: () => isFailure2,
  isFailType: () => isFailType2,
  isExceededCapacityException: () => isExceededCapacityException2,
  isEmptyType: () => isEmptyType2,
  isEmpty: () => isEmpty6,
  isDieType: () => isDieType2,
  isDie: () => isDie2,
  isCause: () => isCause2,
  interruptors: () => interruptors2,
  interruptOption: () => interruptOption2,
  interrupt: () => interrupt3,
  flipCauseOption: () => flipCauseOption2,
  flatten: () => flatten6,
  flatMap: () => flatMap8,
  find: () => find2,
  filter: () => filter6,
  failures: () => failures2,
  failureOrCause: () => failureOrCause2,
  failureOption: () => failureOption2,
  fail: () => fail3,
  empty: () => empty17,
  dieOption: () => dieOption2,
  die: () => die3,
  defects: () => defects2,
  contains: () => contains4,
  as: () => as4,
  andThen: () => andThen5,
  YieldableError: () => YieldableError2,
  UnknownExceptionTypeId: () => UnknownExceptionTypeId2,
  UnknownException: () => UnknownException2,
  TimeoutExceptionTypeId: () => TimeoutExceptionTypeId2,
  TimeoutException: () => TimeoutException2,
  RuntimeExceptionTypeId: () => RuntimeExceptionTypeId2,
  RuntimeException: () => RuntimeException2,
  NoSuchElementExceptionTypeId: () => NoSuchElementExceptionTypeId2,
  NoSuchElementException: () => NoSuchElementException2,
  InvalidPubSubCapacityExceptionTypeId: () => InvalidPubSubCapacityExceptionTypeId2,
  InterruptedExceptionTypeId: () => InterruptedExceptionTypeId2,
  InterruptedException: () => InterruptedException2,
  IllegalArgumentExceptionTypeId: () => IllegalArgumentExceptionTypeId2,
  IllegalArgumentException: () => IllegalArgumentException2,
  ExceededCapacityExceptionTypeId: () => ExceededCapacityExceptionTypeId2,
  ExceededCapacityException: () => ExceededCapacityException2,
  CauseTypeId: () => CauseTypeId2
});
var CauseTypeId2, RuntimeExceptionTypeId2, InterruptedExceptionTypeId2, IllegalArgumentExceptionTypeId2, NoSuchElementExceptionTypeId2, InvalidPubSubCapacityExceptionTypeId2, ExceededCapacityExceptionTypeId2, TimeoutExceptionTypeId2, UnknownExceptionTypeId2, YieldableError2, empty17, fail3, die3, interrupt3, parallel2, sequential2, isCause2, isEmptyType2, isFailType2, isDieType2, isInterruptType2, isSequentialType2, isParallelType2, size5, isEmpty6, isFailure2, isDie2, isInterrupted2, isInterruptedOnly2, failures2, defects2, interruptors2, failureOption2, failureOrCause2, flipCauseOption2, dieOption2, interruptOption2, keepDefects2, linearize2, stripFailures2, stripSomeDefects2, as4, map9, flatMap8, andThen5, flatten6, contains4, squash, squashWith, find2, filter6, match5, reduce8, reduceWithContext2, InterruptedException2, isInterruptedException2, IllegalArgumentException2, isIllegalArgumentException2, NoSuchElementException2, isNoSuchElementException2, RuntimeException2, isRuntimeException2, TimeoutException2, isTimeoutException2, UnknownException2, isUnknownException2, ExceededCapacityException2, isExceededCapacityException2, pretty2, prettyErrors2, originalError;
var init_Cause = __esm(() => {
  init_cause();
  init_core();
  CauseTypeId2 = CauseTypeId;
  RuntimeExceptionTypeId2 = RuntimeExceptionTypeId;
  InterruptedExceptionTypeId2 = InterruptedExceptionTypeId;
  IllegalArgumentExceptionTypeId2 = IllegalArgumentExceptionTypeId;
  NoSuchElementExceptionTypeId2 = NoSuchElementExceptionTypeId;
  InvalidPubSubCapacityExceptionTypeId2 = InvalidPubSubCapacityExceptionTypeId;
  ExceededCapacityExceptionTypeId2 = ExceededCapacityExceptionTypeId;
  TimeoutExceptionTypeId2 = TimeoutExceptionTypeId;
  UnknownExceptionTypeId2 = UnknownExceptionTypeId;
  YieldableError2 = YieldableError;
  empty17 = empty6;
  fail3 = fail;
  die3 = die;
  interrupt3 = interrupt;
  parallel2 = parallel;
  sequential2 = sequential;
  isCause2 = isCause;
  isEmptyType2 = isEmptyType;
  isFailType2 = isFailType;
  isDieType2 = isDieType;
  isInterruptType2 = isInterruptType;
  isSequentialType2 = isSequentialType;
  isParallelType2 = isParallelType;
  size5 = size4;
  isEmpty6 = isEmpty3;
  isFailure2 = isFailure;
  isDie2 = isDie;
  isInterrupted2 = isInterrupted;
  isInterruptedOnly2 = isInterruptedOnly;
  failures2 = failures;
  defects2 = defects;
  interruptors2 = interruptors;
  failureOption2 = failureOption;
  failureOrCause2 = failureOrCause;
  flipCauseOption2 = flipCauseOption;
  dieOption2 = dieOption;
  interruptOption2 = interruptOption;
  keepDefects2 = keepDefects;
  linearize2 = linearize;
  stripFailures2 = stripFailures;
  stripSomeDefects2 = stripSomeDefects;
  as4 = as2;
  map9 = map6;
  flatMap8 = flatMap5;
  andThen5 = andThen2;
  flatten6 = flatten3;
  contains4 = contains3;
  squash = causeSquash;
  squashWith = causeSquashWith;
  find2 = find;
  filter6 = filter4;
  match5 = match3;
  reduce8 = reduce5;
  reduceWithContext2 = reduceWithContext;
  InterruptedException2 = InterruptedException;
  isInterruptedException2 = isInterruptedException;
  IllegalArgumentException2 = IllegalArgumentException;
  isIllegalArgumentException2 = isIllegalArgumentException;
  NoSuchElementException2 = NoSuchElementException;
  isNoSuchElementException2 = isNoSuchElementException;
  RuntimeException2 = RuntimeException;
  isRuntimeException2 = isRuntimeException;
  TimeoutException2 = TimeoutException;
  isTimeoutException2 = isTimeoutException;
  UnknownException2 = UnknownException;
  isUnknownException2 = isUnknownException;
  ExceededCapacityException2 = ExceededCapacityException;
  isExceededCapacityException2 = isExceededCapacityException;
  pretty2 = pretty;
  prettyErrors2 = prettyErrors;
  originalError = originalInstance;
});

// node_modules/effect/dist/esm/Deferred.js
var _await, done2, interrupt4, unsafeMake4;
var init_Deferred = __esm(() => {
  init_core();
  _await = deferredAwait;
  done2 = deferredDone;
  interrupt4 = deferredInterrupt;
  unsafeMake4 = deferredUnsafeMake;
});

// node_modules/effect/dist/esm/internal/clock.js
var ClockSymbolKey = "effect/Clock", ClockTypeId, clockTag, MAX_TIMER_MILLIS, globalClockScheduler, performanceNowNanos, processOrPerformanceNow, ClockImpl, make18 = () => new ClockImpl;
var init_clock = __esm(() => {
  init_Context();
  init_Duration();
  init_Function();
  init_core();
  ClockTypeId = /* @__PURE__ */ Symbol.for(ClockSymbolKey);
  clockTag = /* @__PURE__ */ GenericTag("effect/Clock");
  MAX_TIMER_MILLIS = 2 ** 31 - 1;
  globalClockScheduler = {
    unsafeSchedule(task, duration) {
      const millis2 = toMillis(duration);
      if (millis2 > MAX_TIMER_MILLIS) {
        return constFalse;
      }
      let completed = false;
      const handle = setTimeout(() => {
        completed = true;
        task();
      }, millis2);
      return () => {
        clearTimeout(handle);
        return !completed;
      };
    }
  };
  performanceNowNanos = /* @__PURE__ */ function() {
    const bigint1e62 = /* @__PURE__ */ BigInt(1e6);
    if (typeof performance === "undefined" || typeof performance.now !== "function") {
      return () => BigInt(Date.now()) * bigint1e62;
    }
    let origin;
    return () => {
      if (origin === undefined) {
        origin = BigInt(Date.now()) * bigint1e62 - BigInt(Math.round(performance.now() * 1e6));
      }
      return origin + BigInt(Math.round(performance.now() * 1e6));
    };
  }();
  processOrPerformanceNow = /* @__PURE__ */ function() {
    const processHrtime = typeof process === "object" && "hrtime" in process && typeof process.hrtime.bigint === "function" ? process.hrtime : undefined;
    if (!processHrtime) {
      return performanceNowNanos;
    }
    const origin = /* @__PURE__ */ performanceNowNanos() - /* @__PURE__ */ processHrtime.bigint();
    return () => origin + processHrtime.bigint();
  }();
  ClockImpl = class ClockImpl {
    [ClockTypeId] = ClockTypeId;
    unsafeCurrentTimeMillis() {
      return Date.now();
    }
    unsafeCurrentTimeNanos() {
      return processOrPerformanceNow();
    }
    currentTimeMillis = /* @__PURE__ */ sync(() => this.unsafeCurrentTimeMillis());
    currentTimeNanos = /* @__PURE__ */ sync(() => this.unsafeCurrentTimeNanos());
    scheduler() {
      return succeed(globalClockScheduler);
    }
    sleep(duration) {
      return async_((resume) => {
        const canceler = globalClockScheduler.unsafeSchedule(() => resume(void_2), duration);
        return asVoid2(sync(canceler));
      });
    }
  };
});

// node_modules/effect/dist/esm/Number.js
var Order;
var init_Number = __esm(() => {
  init_Order();
  Order = number2;
});

// node_modules/effect/dist/esm/RegExp.js
var escape = (string2) => string2.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
var init_RegExp = () => {};

// node_modules/effect/dist/esm/internal/opCodes/configError.js
var OP_AND = "And", OP_OR = "Or", OP_INVALID_DATA = "InvalidData", OP_MISSING_DATA = "MissingData", OP_SOURCE_UNAVAILABLE = "SourceUnavailable", OP_UNSUPPORTED = "Unsupported";

// node_modules/effect/dist/esm/internal/configError.js
var ConfigErrorSymbolKey = "effect/ConfigError", ConfigErrorTypeId, proto2, And = (self, that) => {
  const error = Object.create(proto2);
  error._op = OP_AND;
  error.left = self;
  error.right = that;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      return `${this.left} and ${this.right}`;
    }
  });
  Object.defineProperty(error, "message", {
    enumerable: false,
    get() {
      return this.toString();
    }
  });
  return error;
}, Or = (self, that) => {
  const error = Object.create(proto2);
  error._op = OP_OR;
  error.left = self;
  error.right = that;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      return `${this.left} or ${this.right}`;
    }
  });
  Object.defineProperty(error, "message", {
    enumerable: false,
    get() {
      return this.toString();
    }
  });
  return error;
}, InvalidData = (path, message, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_INVALID_DATA;
  error.path = path;
  error.message = message;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Invalid data at ${path2}: "${this.message}")`;
    }
  });
  return error;
}, MissingData = (path, message, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_MISSING_DATA;
  error.path = path;
  error.message = message;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Missing data at ${path2}: "${this.message}")`;
    }
  });
  return error;
}, SourceUnavailable = (path, message, cause, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_SOURCE_UNAVAILABLE;
  error.path = path;
  error.message = message;
  error.cause = cause;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Source unavailable at ${path2}: "${this.message}")`;
    }
  });
  return error;
}, Unsupported = (path, message, options = {
  pathDelim: "."
}) => {
  const error = Object.create(proto2);
  error._op = OP_UNSUPPORTED;
  error.path = path;
  error.message = message;
  Object.defineProperty(error, "toString", {
    enumerable: false,
    value() {
      const path2 = pipe(this.path, join(options.pathDelim));
      return `(Unsupported operation at ${path2}: "${this.message}")`;
    }
  });
  return error;
}, prefixed, reduceWithContext3;
var init_configError = __esm(() => {
  init_Array();
  init_Either();
  init_Function();
  ConfigErrorTypeId = /* @__PURE__ */ Symbol.for(ConfigErrorSymbolKey);
  proto2 = {
    _tag: "ConfigError",
    [ConfigErrorTypeId]: ConfigErrorTypeId
  };
  prefixed = /* @__PURE__ */ dual(2, (self, prefix) => {
    switch (self._op) {
      case OP_AND: {
        return And(prefixed(self.left, prefix), prefixed(self.right, prefix));
      }
      case OP_OR: {
        return Or(prefixed(self.left, prefix), prefixed(self.right, prefix));
      }
      case OP_INVALID_DATA: {
        return InvalidData([...prefix, ...self.path], self.message);
      }
      case OP_MISSING_DATA: {
        return MissingData([...prefix, ...self.path], self.message);
      }
      case OP_SOURCE_UNAVAILABLE: {
        return SourceUnavailable([...prefix, ...self.path], self.message, self.cause);
      }
      case OP_UNSUPPORTED: {
        return Unsupported([...prefix, ...self.path], self.message);
      }
    }
  });
  reduceWithContext3 = /* @__PURE__ */ dual(3, (self, context2, reducer) => {
    const input = [self];
    const output = [];
    while (input.length > 0) {
      const error = input.pop();
      switch (error._op) {
        case OP_AND: {
          input.push(error.right);
          input.push(error.left);
          output.push(left2({
            _op: "AndCase"
          }));
          break;
        }
        case OP_OR: {
          input.push(error.right);
          input.push(error.left);
          output.push(left2({
            _op: "OrCase"
          }));
          break;
        }
        case OP_INVALID_DATA: {
          output.push(right2(reducer.invalidDataCase(context2, error.path, error.message)));
          break;
        }
        case OP_MISSING_DATA: {
          output.push(right2(reducer.missingDataCase(context2, error.path, error.message)));
          break;
        }
        case OP_SOURCE_UNAVAILABLE: {
          output.push(right2(reducer.sourceUnavailableCase(context2, error.path, error.message, error.cause)));
          break;
        }
        case OP_UNSUPPORTED: {
          output.push(right2(reducer.unsupportedCase(context2, error.path, error.message)));
          break;
        }
      }
    }
    const accumulator = [];
    while (output.length > 0) {
      const either3 = output.pop();
      switch (either3._op) {
        case "Left": {
          switch (either3.left._op) {
            case "AndCase": {
              const left3 = accumulator.pop();
              const right3 = accumulator.pop();
              const value = reducer.andCase(context2, left3, right3);
              accumulator.push(value);
              break;
            }
            case "OrCase": {
              const left3 = accumulator.pop();
              const right3 = accumulator.pop();
              const value = reducer.orCase(context2, left3, right3);
              accumulator.push(value);
              break;
            }
          }
          break;
        }
        case "Right": {
          accumulator.push(either3.right);
          break;
        }
      }
    }
    if (accumulator.length === 0) {
      throw new Error("BUG: ConfigError.reduceWithContext - please report an issue at https://github.com/Effect-TS/effect/issues");
    }
    return accumulator.pop();
  });
});

// node_modules/effect/dist/esm/internal/configProvider/pathPatch.js
var empty18, patch5;
var init_pathPatch = __esm(() => {
  init_Array();
  init_Either();
  init_Function();
  init_List();
  init_Option();
  init_configError();
  empty18 = {
    _tag: "Empty"
  };
  patch5 = /* @__PURE__ */ dual(2, (path, patch6) => {
    let input = of3(patch6);
    let output = path;
    while (isCons(input)) {
      const patch7 = input.head;
      switch (patch7._tag) {
        case "Empty": {
          input = input.tail;
          break;
        }
        case "AndThen": {
          input = cons(patch7.first, cons(patch7.second, input.tail));
          break;
        }
        case "MapName": {
          output = map2(output, patch7.f);
          input = input.tail;
          break;
        }
        case "Nested": {
          output = prepend(output, patch7.name);
          input = input.tail;
          break;
        }
        case "Unnested": {
          const containsName = pipe(head(output), contains(patch7.name));
          if (containsName) {
            output = tailNonEmpty(output);
            input = input.tail;
          } else {
            return left2(MissingData(output, `Expected ${patch7.name} to be in path in ConfigProvider#unnested`));
          }
          break;
        }
      }
    }
    return right2(output);
  });
});

// node_modules/effect/dist/esm/internal/opCodes/config.js
var OP_CONSTANT = "Constant", OP_FAIL2 = "Fail", OP_FALLBACK = "Fallback", OP_DESCRIBED = "Described", OP_LAZY = "Lazy", OP_MAP_OR_FAIL = "MapOrFail", OP_NESTED = "Nested", OP_PRIMITIVE = "Primitive", OP_REDACTED = "Redacted", OP_SEQUENCE = "Sequence", OP_HASHMAP = "HashMap", OP_ZIP_WITH = "ZipWith";

// node_modules/effect/dist/esm/internal/configProvider.js
var concat = (l, r) => [...l, ...r], ConfigProviderSymbolKey = "effect/ConfigProvider", ConfigProviderTypeId, configProviderTag, FlatConfigProviderSymbolKey = "effect/ConfigProviderFlat", FlatConfigProviderTypeId, make20 = (options) => ({
  [ConfigProviderTypeId]: ConfigProviderTypeId,
  pipe() {
    return pipeArguments(this, arguments);
  },
  ...options
}), makeFlat = (options) => ({
  [FlatConfigProviderTypeId]: FlatConfigProviderTypeId,
  patch: options.patch,
  load: (path, config, split = true) => options.load(path, config, split),
  enumerateChildren: options.enumerateChildren
}), fromFlat = (flat) => make20({
  load: (config) => flatMap7(fromFlatLoop(flat, empty(), config, false), (chunk) => match2(head(chunk), {
    onNone: () => fail2(MissingData(empty(), `Expected a single value having structure: ${config}`)),
    onSome: succeed
  })),
  flattened: flat
}), fromEnv = (options) => {
  const {
    pathDelim,
    seqDelim
  } = Object.assign({}, {
    pathDelim: "_",
    seqDelim: ","
  }, options);
  const makePathString = (path) => pipe(path, join(pathDelim));
  const unmakePathString = (pathString) => pathString.split(pathDelim);
  const getEnv = () => typeof process !== "undefined" && ("env" in process) && typeof process.env === "object" ? process.env : {};
  const load = (path, primitive, split = true) => {
    const pathString = makePathString(path);
    const current = getEnv();
    const valueOpt = pathString in current ? some2(current[pathString]) : none2();
    return pipe(valueOpt, mapError(() => MissingData(path, `Expected ${pathString} to exist in the process context`)), flatMap7((value) => parsePrimitive(value, path, primitive, seqDelim, split)));
  };
  const enumerateChildren = (path) => sync(() => {
    const current = getEnv();
    const keys3 = Object.keys(current);
    const keyPaths = keys3.map((value) => unmakePathString(value.toUpperCase()));
    const filteredKeyPaths = keyPaths.filter((keyPath) => {
      for (let i = 0;i < path.length; i++) {
        const pathComponent = pipe(path, unsafeGet(i));
        const currentElement = keyPath[i];
        if (currentElement === undefined || pathComponent !== currentElement) {
          return false;
        }
      }
      return true;
    }).flatMap((keyPath) => keyPath.slice(path.length, path.length + 1));
    return fromIterable6(filteredKeyPaths);
  });
  return fromFlat(makeFlat({
    load,
    enumerateChildren,
    patch: empty18
  }));
}, extend = (leftDef, rightDef, left3, right3) => {
  const leftPad = unfold(left3.length, (index) => index >= right3.length ? none2() : some2([leftDef(index), index + 1]));
  const rightPad = unfold(right3.length, (index) => index >= left3.length ? none2() : some2([rightDef(index), index + 1]));
  const leftExtension = concat(left3, leftPad);
  const rightExtension = concat(right3, rightPad);
  return [leftExtension, rightExtension];
}, appendConfigPath = (path, config) => {
  let op = config;
  if (op._tag === "Nested") {
    const out = path.slice();
    while (op._tag === "Nested") {
      out.push(op.name);
      op = op.config;
    }
    return out;
  }
  return path;
}, RedactedConfigErrorReducer, redactConfigError = (error) => reduceWithContext3(error, undefined, RedactedConfigErrorReducer), fromFlatLoop = (flat, prefix, config, split) => {
  const op = config;
  switch (op._tag) {
    case OP_CONSTANT: {
      return succeed(of(op.value));
    }
    case OP_DESCRIBED: {
      return suspend(() => fromFlatLoop(flat, prefix, op.config, split));
    }
    case OP_FAIL2: {
      return fail2(MissingData(prefix, op.message));
    }
    case OP_FALLBACK: {
      return pipe(suspend(() => fromFlatLoop(flat, prefix, op.first, split)), catchAll((error1) => {
        if (op.condition(error1)) {
          return pipe(fromFlatLoop(flat, prefix, op.second, split), catchAll((error2) => fail2(Or(error1, error2))));
        }
        return fail2(error1);
      }));
    }
    case OP_LAZY: {
      return suspend(() => fromFlatLoop(flat, prefix, op.config(), split));
    }
    case OP_MAP_OR_FAIL: {
      return suspend(() => pipe(fromFlatLoop(flat, prefix, op.original, split), flatMap7(forEachSequential((a) => pipe(op.mapOrFail(a), mapError(prefixed(appendConfigPath(prefix, op.original))))))));
    }
    case OP_NESTED: {
      return suspend(() => fromFlatLoop(flat, concat(prefix, of(op.name)), op.config, split));
    }
    case OP_PRIMITIVE: {
      return pipe(patch5(prefix, flat.patch), flatMap7((prefix2) => pipe(flat.load(prefix2, op, split), flatMap7((values3) => {
        if (values3.length === 0) {
          const name = pipe(last(prefix2), getOrElse(() => "<n/a>"));
          return fail2(MissingData([], `Expected ${op.description} with name ${name}`));
        }
        return succeed(values3);
      }))));
    }
    case OP_REDACTED: {
      return suspend(() => pipe(fromFlatLoop(flat, prefix, op.original, split), mapError(redactConfigError), map8(map2(op.redact))));
    }
    case OP_SEQUENCE: {
      return pipe(patch5(prefix, flat.patch), flatMap7((patchedPrefix) => pipe(flat.enumerateChildren(patchedPrefix), flatMap7(indicesFrom), flatMap7((indices) => {
        if (indices.length === 0) {
          return suspend(() => map8(fromFlatLoop(flat, prefix, op.config, true), of));
        }
        return pipe(forEachSequential(indices, (index) => fromFlatLoop(flat, append(prefix, `[${index}]`), op.config, true)), map8((chunkChunk) => {
          const flattened = flatten2(chunkChunk);
          if (flattened.length === 0) {
            return of(empty());
          }
          return of(flattened);
        }));
      }))));
    }
    case OP_HASHMAP: {
      return suspend(() => pipe(patch5(prefix, flat.patch), flatMap7((prefix2) => pipe(flat.enumerateChildren(prefix2), flatMap7((keys3) => {
        return pipe(keys3, forEachSequential((key) => fromFlatLoop(flat, concat(prefix2, of(key)), op.valueConfig, split)), map8((matrix) => {
          if (matrix.length === 0) {
            return of(empty9());
          }
          return pipe(transpose(matrix), map2((values3) => fromIterable7(zip(fromIterable2(keys3), values3))));
        }));
      })))));
    }
    case OP_ZIP_WITH: {
      return suspend(() => pipe(fromFlatLoop(flat, prefix, op.left, split), either2, flatMap7((left3) => pipe(fromFlatLoop(flat, prefix, op.right, split), either2, flatMap7((right3) => {
        if (isLeft2(left3) && isLeft2(right3)) {
          return fail2(And(left3.left, right3.left));
        }
        if (isLeft2(left3) && isRight2(right3)) {
          return fail2(left3.left);
        }
        if (isRight2(left3) && isLeft2(right3)) {
          return fail2(right3.left);
        }
        if (isRight2(left3) && isRight2(right3)) {
          const path = pipe(prefix, join("."));
          const fail4 = fromFlatLoopFail(prefix, path);
          const [lefts, rights] = extend(fail4, fail4, pipe(left3.right, map2(right2)), pipe(right3.right, map2(right2)));
          return pipe(lefts, zip(rights), forEachSequential(([left4, right4]) => pipe(zip2(left4, right4), map8(([left5, right5]) => op.zip(left5, right5)))));
        }
        throw new Error("BUG: ConfigProvider.fromFlatLoop - please report an issue at https://github.com/Effect-TS/effect/issues");
      })))));
    }
  }
}, fromFlatLoopFail = (prefix, path) => (index) => left2(MissingData(prefix, `The element at index ${index} in a sequence at path "${path}" was missing`)), splitPathString = (text, delim) => {
  const split = text.split(new RegExp(`\\s*${escape(delim)}\\s*`));
  return split;
}, parsePrimitive = (text, path, primitive, delimiter, split) => {
  if (!split) {
    return pipe(primitive.parse(text), mapBoth({
      onFailure: prefixed(path),
      onSuccess: of
    }));
  }
  return pipe(splitPathString(text, delimiter), forEachSequential((char) => primitive.parse(char.trim())), mapError(prefixed(path)));
}, transpose = (array3) => {
  return Object.keys(array3[0]).map((column) => array3.map((row) => row[column]));
}, indicesFrom = (quotedIndices) => pipe(forEachSequential(quotedIndices, parseQuotedIndex), mapBoth({
  onFailure: () => empty(),
  onSuccess: sort(Order)
}), either2, map8(merge)), QUOTED_INDEX_REGEX, parseQuotedIndex = (str) => {
  const match7 = str.match(QUOTED_INDEX_REGEX);
  if (match7 !== null) {
    const matchedIndex = match7[2];
    return pipe(matchedIndex !== undefined && matchedIndex.length > 0 ? some2(matchedIndex) : none2(), flatMap(parseInteger));
  }
  return none2();
}, parseInteger = (str) => {
  const parsedIndex = Number.parseInt(str);
  return Number.isNaN(parsedIndex) ? none2() : some2(parsedIndex);
};
var init_configProvider = __esm(() => {
  init_Array();
  init_Context();
  init_Either();
  init_Function();
  init_HashMap();
  init_HashSet();
  init_Number();
  init_Option();
  init_Pipeable();
  init_RegExp();
  init_configError();
  init_pathPatch();
  init_core();
  ConfigProviderTypeId = /* @__PURE__ */ Symbol.for(ConfigProviderSymbolKey);
  configProviderTag = /* @__PURE__ */ GenericTag("effect/ConfigProvider");
  FlatConfigProviderTypeId = /* @__PURE__ */ Symbol.for(FlatConfigProviderSymbolKey);
  RedactedConfigErrorReducer = {
    andCase: (_, left3, right3) => And(left3, right3),
    orCase: (_, left3, right3) => Or(left3, right3),
    invalidDataCase: (_, path) => InvalidData(path, "<redacted>"),
    missingDataCase: (_, path) => MissingData(path, "<redacted>"),
    sourceUnavailableCase: (_, path, _message, cause) => SourceUnavailable(path, "<redacted>", cause),
    unsupportedCase: (_, path) => Unsupported(path, "<redacted>")
  };
  QUOTED_INDEX_REGEX = /^(\[(\d+)\])$/;
});

// node_modules/effect/dist/esm/internal/defaultServices/console.js
var TypeId9, consoleTag, defaultConsole;
var init_console = __esm(() => {
  init_Context();
  init_core();
  TypeId9 = /* @__PURE__ */ Symbol.for("effect/Console");
  consoleTag = /* @__PURE__ */ GenericTag("effect/Console");
  defaultConsole = {
    [TypeId9]: TypeId9,
    assert(condition, ...args) {
      return sync(() => {
        console.assert(condition, ...args);
      });
    },
    clear: /* @__PURE__ */ sync(() => {
      console.clear();
    }),
    count(label) {
      return sync(() => {
        console.count(label);
      });
    },
    countReset(label) {
      return sync(() => {
        console.countReset(label);
      });
    },
    debug(...args) {
      return sync(() => {
        console.debug(...args);
      });
    },
    dir(item, options) {
      return sync(() => {
        console.dir(item, options);
      });
    },
    dirxml(...args) {
      return sync(() => {
        console.dirxml(...args);
      });
    },
    error(...args) {
      return sync(() => {
        console.error(...args);
      });
    },
    group(options) {
      return options?.collapsed ? sync(() => console.groupCollapsed(options?.label)) : sync(() => console.group(options?.label));
    },
    groupEnd: /* @__PURE__ */ sync(() => {
      console.groupEnd();
    }),
    info(...args) {
      return sync(() => {
        console.info(...args);
      });
    },
    log(...args) {
      return sync(() => {
        console.log(...args);
      });
    },
    table(tabularData, properties) {
      return sync(() => {
        console.table(tabularData, properties);
      });
    },
    time(label) {
      return sync(() => console.time(label));
    },
    timeEnd(label) {
      return sync(() => console.timeEnd(label));
    },
    timeLog(label, ...args) {
      return sync(() => {
        console.timeLog(label, ...args);
      });
    },
    trace(...args) {
      return sync(() => {
        console.trace(...args);
      });
    },
    warn(...args) {
      return sync(() => {
        console.warn(...args);
      });
    },
    unsafe: console
  };
});

// node_modules/effect/dist/esm/internal/random.js
var RandomSymbolKey = "effect/Random", RandomTypeId, randomTag, RandomImpl, shuffleWith = (elements, nextIntBounded) => {
  return suspend(() => pipe(sync(() => Array.from(elements)), flatMap7((buffer) => {
    const numbers = [];
    for (let i = buffer.length;i >= 2; i = i - 1) {
      numbers.push(i);
    }
    return pipe(numbers, forEachSequentialDiscard((n) => pipe(nextIntBounded(n), map8((k) => swap(buffer, n - 1, k)))), as3(fromIterable3(buffer)));
  })));
}, swap = (buffer, index1, index2) => {
  const tmp = buffer[index1];
  buffer[index1] = buffer[index2];
  buffer[index2] = tmp;
  return buffer;
}, make21 = (seed) => new RandomImpl(hash(seed)), FixedRandomImpl, fixed = (values3) => new FixedRandomImpl(values3);
var init_random = __esm(() => {
  init_Chunk();
  init_Context();
  init_Function();
  init_Hash();
  init_Utils();
  init_core();
  RandomTypeId = /* @__PURE__ */ Symbol.for(RandomSymbolKey);
  randomTag = /* @__PURE__ */ GenericTag("effect/Random");
  RandomImpl = class RandomImpl {
    seed;
    [RandomTypeId] = RandomTypeId;
    PRNG;
    constructor(seed) {
      this.seed = seed;
      this.PRNG = new PCGRandom(seed);
    }
    get next() {
      return sync(() => this.PRNG.number());
    }
    get nextBoolean() {
      return map8(this.next, (n) => n > 0.5);
    }
    get nextInt() {
      return sync(() => this.PRNG.integer(Number.MAX_SAFE_INTEGER));
    }
    nextRange(min2, max2) {
      return map8(this.next, (n) => (max2 - min2) * n + min2);
    }
    nextIntBetween(min2, max2) {
      return sync(() => this.PRNG.integer(max2 - min2) + min2);
    }
    shuffle(elements) {
      return shuffleWith(elements, (n) => this.nextIntBetween(0, n));
    }
  };
  FixedRandomImpl = class FixedRandomImpl {
    values;
    [RandomTypeId] = RandomTypeId;
    index = 0;
    constructor(values3) {
      this.values = values3;
      if (values3.length === 0) {
        throw new Error("Requires at least one value");
      }
    }
    getNextValue() {
      const value = this.values[this.index];
      this.index = (this.index + 1) % this.values.length;
      return value;
    }
    get next() {
      return sync(() => {
        const value = this.getNextValue();
        if (typeof value === "number") {
          return Math.max(0, Math.min(1, value));
        }
        return hash(value) / 2147483647;
      });
    }
    get nextBoolean() {
      return sync(() => {
        const value = this.getNextValue();
        if (typeof value === "boolean") {
          return value;
        }
        return hash(value) % 2 === 0;
      });
    }
    get nextInt() {
      return sync(() => {
        const value = this.getNextValue();
        if (typeof value === "number" && Number.isFinite(value)) {
          return Math.round(value);
        }
        return Math.abs(hash(value));
      });
    }
    nextRange(min2, max2) {
      return map8(this.next, (n) => (max2 - min2) * n + min2);
    }
    nextIntBetween(min2, max2) {
      return sync(() => {
        const value = this.getNextValue();
        if (typeof value === "number" && Number.isFinite(value)) {
          return Math.max(min2, Math.min(max2 - 1, Math.round(value)));
        }
        const hash2 = Math.abs(hash(value));
        return min2 + hash2 % (max2 - min2);
      });
    }
    shuffle(elements) {
      return shuffleWith(elements, (n) => this.nextIntBetween(0, n));
    }
  };
});

// node_modules/effect/dist/esm/internal/tracer.js
class NativeSpan {
  name;
  parent;
  context;
  startTime;
  kind;
  _tag = "Span";
  spanId;
  traceId = "native";
  sampled = true;
  status;
  attributes;
  events = [];
  links;
  constructor(name, parent, context2, links, startTime, kind) {
    this.name = name;
    this.parent = parent;
    this.context = context2;
    this.startTime = startTime;
    this.kind = kind;
    this.status = {
      _tag: "Started",
      startTime
    };
    this.attributes = new Map;
    this.traceId = parent._tag === "Some" ? parent.value.traceId : randomHexString(32);
    this.spanId = randomHexString(16);
    this.links = Array.from(links);
  }
  end(endTime, exit2) {
    this.status = {
      _tag: "Ended",
      endTime,
      exit: exit2,
      startTime: this.status.startTime
    };
  }
  attribute(key, value) {
    this.attributes.set(key, value);
  }
  event(name, startTime, attributes) {
    this.events.push([name, startTime, attributes ?? {}]);
  }
  addLinks(links) {
    this.links.push(...links);
  }
}
var TracerTypeId, make22 = (options) => ({
  [TracerTypeId]: TracerTypeId,
  ...options
}), tracerTag, spanTag, randomHexString, nativeTracer, addSpanStackTrace = (options) => {
  if (options?.captureStackTrace === false) {
    return options;
  } else if (options?.captureStackTrace !== undefined && typeof options.captureStackTrace !== "boolean") {
    return options;
  }
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 3;
  const traceError = new Error;
  Error.stackTraceLimit = limit;
  let cache = false;
  return {
    ...options,
    captureStackTrace: () => {
      if (cache !== false) {
        return cache;
      }
      if (traceError.stack !== undefined) {
        const stack = traceError.stack.split(`
`);
        if (stack[3] !== undefined) {
          cache = stack[3].trim();
          return cache;
        }
      }
    }
  };
}, DisablePropagation;
var init_tracer = __esm(() => {
  init_Context();
  init_Function();
  TracerTypeId = /* @__PURE__ */ Symbol.for("effect/Tracer");
  tracerTag = /* @__PURE__ */ GenericTag("effect/Tracer");
  spanTag = /* @__PURE__ */ GenericTag("effect/ParentSpan");
  randomHexString = /* @__PURE__ */ function() {
    const characters = "abcdef0123456789";
    const charactersLength = characters.length;
    return function(length) {
      let result = "";
      for (let i = 0;i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
      }
      return result;
    };
  }();
  nativeTracer = /* @__PURE__ */ make22({
    span: (name, parent, context2, links, startTime, kind) => new NativeSpan(name, parent, context2, links, startTime, kind),
    context: (f) => f()
  });
  DisablePropagation = /* @__PURE__ */ Reference2()("effect/Tracer/DisablePropagation", {
    defaultValue: constFalse
  });
});

// node_modules/effect/dist/esm/internal/defaultServices.js
var liveServices, currentServices, sleep = (duration) => {
  const decodedDuration = decode(duration);
  return clockWith((clock) => clock.sleep(decodedDuration));
}, defaultServicesWith = (f) => withFiberRuntime((fiber) => f(fiber.currentDefaultServices)), clockWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(clockTag.key))), currentTimeMillis, currentTimeNanos, withClock, withConfigProvider, configProviderWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(configProviderTag.key))), randomWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(randomTag.key))), withRandom, tracerWith = (f) => defaultServicesWith((services) => f(services.unsafeMap.get(tracerTag.key))), withTracer;
var init_defaultServices = __esm(() => {
  init_Context();
  init_Duration();
  init_Function();
  init_clock();
  init_configProvider();
  init_core();
  init_console();
  init_random();
  init_tracer();
  liveServices = /* @__PURE__ */ pipe(/* @__PURE__ */ empty8(), /* @__PURE__ */ add4(clockTag, /* @__PURE__ */ make18()), /* @__PURE__ */ add4(consoleTag, defaultConsole), /* @__PURE__ */ add4(randomTag, /* @__PURE__ */ make21(/* @__PURE__ */ Math.random())), /* @__PURE__ */ add4(configProviderTag, /* @__PURE__ */ fromEnv()), /* @__PURE__ */ add4(tracerTag, nativeTracer));
  currentServices = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/DefaultServices/currentServices"), () => fiberRefUnsafeMakeContext(liveServices));
  currentTimeMillis = /* @__PURE__ */ clockWith((clock) => clock.currentTimeMillis);
  currentTimeNanos = /* @__PURE__ */ clockWith((clock) => clock.currentTimeNanos);
  withClock = /* @__PURE__ */ dual(2, (effect, c) => fiberRefLocallyWith(currentServices, add4(clockTag, c))(effect));
  withConfigProvider = /* @__PURE__ */ dual(2, (self, provider) => fiberRefLocallyWith(currentServices, add4(configProviderTag, provider))(self));
  withRandom = /* @__PURE__ */ dual(2, (effect, value) => fiberRefLocallyWith(currentServices, add4(randomTag, value))(effect));
  withTracer = /* @__PURE__ */ dual(2, (effect, value) => fiberRefLocallyWith(currentServices, add4(tracerTag, value))(effect));
});

// node_modules/effect/dist/esm/Boolean.js
var not = (self) => !self;
var init_Boolean = () => {};

// node_modules/effect/dist/esm/Effectable.js
var EffectPrototype2, CommitPrototype2, Base2, Class;
var init_Effectable = __esm(() => {
  init_effectable();
  EffectPrototype2 = EffectPrototype;
  CommitPrototype2 = CommitPrototype;
  Base2 = Base;
  Class = class Class extends Base2 {
  };
});

// node_modules/effect/dist/esm/internal/executionStrategy.js
var OP_SEQUENTIAL2 = "Sequential", OP_PARALLEL2 = "Parallel", OP_PARALLEL_N = "ParallelN", sequential3, parallel3, parallelN = (parallelism) => ({
  _tag: OP_PARALLEL_N,
  parallelism
}), isSequential = (self) => self._tag === OP_SEQUENTIAL2, isParallel = (self) => self._tag === OP_PARALLEL2;
var init_executionStrategy = __esm(() => {
  sequential3 = {
    _tag: OP_SEQUENTIAL2
  };
  parallel3 = {
    _tag: OP_PARALLEL2
  };
});

// node_modules/effect/dist/esm/ExecutionStrategy.js
var sequential4, parallel4, parallelN2;
var init_ExecutionStrategy = __esm(() => {
  init_executionStrategy();
  sequential4 = sequential3;
  parallel4 = parallel3;
  parallelN2 = parallelN;
});

// node_modules/effect/dist/esm/internal/fiberRefs.js
function unsafeMake5(fiberRefLocals) {
  return new FiberRefsImpl(fiberRefLocals);
}
function empty19() {
  return unsafeMake5(new Map);
}
var FiberRefsSym, FiberRefsImpl, findAncestor = (_ref, _parentStack, _childStack, _childModified = false) => {
  const ref = _ref;
  let parentStack = _parentStack;
  let childStack = _childStack;
  let childModified = _childModified;
  let ret = undefined;
  while (ret === undefined) {
    if (isNonEmptyReadonlyArray(parentStack) && isNonEmptyReadonlyArray(childStack)) {
      const parentFiberId = headNonEmpty(parentStack)[0];
      const parentAncestors = tailNonEmpty(parentStack);
      const childFiberId = headNonEmpty(childStack)[0];
      const childRefValue = headNonEmpty(childStack)[1];
      const childAncestors = tailNonEmpty(childStack);
      if (parentFiberId.startTimeMillis < childFiberId.startTimeMillis) {
        childStack = childAncestors;
        childModified = true;
      } else if (parentFiberId.startTimeMillis > childFiberId.startTimeMillis) {
        parentStack = parentAncestors;
      } else {
        if (parentFiberId.id < childFiberId.id) {
          childStack = childAncestors;
          childModified = true;
        } else if (parentFiberId.id > childFiberId.id) {
          parentStack = parentAncestors;
        } else {
          ret = [childRefValue, childModified];
        }
      }
    } else {
      ret = [ref.initial, true];
    }
  }
  return ret;
}, joinAs, forkAs, unsafeForkAs = (self, map10, fiberId2) => {
  self.locals.forEach((stack, fiberRef) => {
    const oldValue = stack[0][1];
    const newValue = fiberRef.patch(fiberRef.fork)(oldValue);
    if (equals(oldValue, newValue)) {
      map10.set(fiberRef, stack);
    } else {
      map10.set(fiberRef, [[fiberId2, newValue], ...stack]);
    }
  });
}, fiberRefs = (self) => fromIterable6(self.locals.keys()), setAll = (self) => forEachSequentialDiscard(fiberRefs(self), (fiberRef) => fiberRefSet(fiberRef, getOrDefault(self, fiberRef))), delete_, get8, getOrDefault, updateAs, unsafeUpdateAs = (locals, fiberId2, fiberRef, value) => {
  const oldStack = locals.get(fiberRef) ?? [];
  let newStack;
  if (isNonEmptyReadonlyArray(oldStack)) {
    const [currentId, currentValue] = headNonEmpty(oldStack);
    if (currentId[symbol2](fiberId2)) {
      if (equals(currentValue, value)) {
        return;
      } else {
        newStack = [[fiberId2, value], ...oldStack.slice(1)];
      }
    } else {
      newStack = [[fiberId2, value], ...oldStack];
    }
  } else {
    newStack = [[fiberId2, value]];
  }
  locals.set(fiberRef, newStack);
}, updateManyAs;
var init_fiberRefs = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_HashSet();
  init_Option();
  init_Pipeable();
  init_core();
  FiberRefsSym = /* @__PURE__ */ Symbol.for("effect/FiberRefs");
  FiberRefsImpl = class FiberRefsImpl {
    locals;
    [FiberRefsSym] = FiberRefsSym;
    constructor(locals) {
      this.locals = locals;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  joinAs = /* @__PURE__ */ dual(3, (self, fiberId2, that) => {
    const parentFiberRefs = new Map(self.locals);
    that.locals.forEach((childStack, fiberRef) => {
      const childValue = childStack[0][1];
      if (!childStack[0][0][symbol2](fiberId2)) {
        if (!parentFiberRefs.has(fiberRef)) {
          if (equals(childValue, fiberRef.initial)) {
            return;
          }
          parentFiberRefs.set(fiberRef, [[fiberId2, fiberRef.join(fiberRef.initial, childValue)]]);
          return;
        }
        const parentStack = parentFiberRefs.get(fiberRef);
        const [ancestor, wasModified] = findAncestor(fiberRef, parentStack, childStack);
        if (wasModified) {
          const patch6 = fiberRef.diff(ancestor, childValue);
          const oldValue = parentStack[0][1];
          const newValue = fiberRef.join(oldValue, fiberRef.patch(patch6)(oldValue));
          if (!equals(oldValue, newValue)) {
            let newStack;
            const parentFiberId = parentStack[0][0];
            if (parentFiberId[symbol2](fiberId2)) {
              newStack = [[parentFiberId, newValue], ...parentStack.slice(1)];
            } else {
              newStack = [[fiberId2, newValue], ...parentStack];
            }
            parentFiberRefs.set(fiberRef, newStack);
          }
        }
      }
    });
    return new FiberRefsImpl(parentFiberRefs);
  });
  forkAs = /* @__PURE__ */ dual(2, (self, childId) => {
    const map10 = new Map;
    unsafeForkAs(self, map10, childId);
    return new FiberRefsImpl(map10);
  });
  delete_ = /* @__PURE__ */ dual(2, (self, fiberRef) => {
    const locals = new Map(self.locals);
    locals.delete(fiberRef);
    return new FiberRefsImpl(locals);
  });
  get8 = /* @__PURE__ */ dual(2, (self, fiberRef) => {
    if (!self.locals.has(fiberRef)) {
      return none2();
    }
    return some2(headNonEmpty(self.locals.get(fiberRef))[1]);
  });
  getOrDefault = /* @__PURE__ */ dual(2, (self, fiberRef) => pipe(get8(self, fiberRef), getOrElse(() => fiberRef.initial)));
  updateAs = /* @__PURE__ */ dual(2, (self, {
    fiberId: fiberId2,
    fiberRef,
    value
  }) => {
    if (self.locals.size === 0) {
      return new FiberRefsImpl(new Map([[fiberRef, [[fiberId2, value]]]]));
    }
    const locals = new Map(self.locals);
    unsafeUpdateAs(locals, fiberId2, fiberRef, value);
    return new FiberRefsImpl(locals);
  });
  updateManyAs = /* @__PURE__ */ dual(2, (self, {
    entries: entries2,
    forkAs: forkAs2
  }) => {
    if (self.locals.size === 0) {
      return new FiberRefsImpl(new Map(entries2));
    }
    const locals = new Map(self.locals);
    if (forkAs2 !== undefined) {
      unsafeForkAs(self, locals, forkAs2);
    }
    entries2.forEach(([fiberRef, values3]) => {
      if (values3.length === 1) {
        unsafeUpdateAs(locals, values3[0][0], fiberRef, values3[0][1]);
      } else {
        values3.forEach(([fiberId2, value]) => {
          unsafeUpdateAs(locals, fiberId2, fiberRef, value);
        });
      }
    });
    return new FiberRefsImpl(locals);
  });
});

// node_modules/effect/dist/esm/FiberRefs.js
var get9, getOrDefault2, joinAs2, setAll2, updateManyAs2, empty20;
var init_FiberRefs = __esm(() => {
  init_fiberRefs();
  get9 = get8;
  getOrDefault2 = getOrDefault;
  joinAs2 = joinAs;
  setAll2 = setAll;
  updateManyAs2 = updateManyAs;
  empty20 = empty19;
});

// node_modules/effect/dist/esm/internal/fiberRefs/patch.js
var OP_EMPTY2 = "Empty", OP_ADD = "Add", OP_REMOVE = "Remove", OP_UPDATE = "Update", OP_AND_THEN = "AndThen", empty21, diff5 = (oldValue, newValue) => {
  const missingLocals = new Map(oldValue.locals);
  let patch6 = empty21;
  for (const [fiberRef, pairs] of newValue.locals.entries()) {
    const newValue2 = headNonEmpty(pairs)[1];
    const old = missingLocals.get(fiberRef);
    if (old !== undefined) {
      const oldValue2 = headNonEmpty(old)[1];
      if (!equals(oldValue2, newValue2)) {
        patch6 = combine7({
          _tag: OP_UPDATE,
          fiberRef,
          patch: fiberRef.diff(oldValue2, newValue2)
        })(patch6);
      }
    } else {
      patch6 = combine7({
        _tag: OP_ADD,
        fiberRef,
        value: newValue2
      })(patch6);
    }
    missingLocals.delete(fiberRef);
  }
  for (const [fiberRef] of missingLocals.entries()) {
    patch6 = combine7({
      _tag: OP_REMOVE,
      fiberRef
    })(patch6);
  }
  return patch6;
}, combine7, patch6;
var init_patch = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_fiberRefs();
  empty21 = {
    _tag: OP_EMPTY2
  };
  combine7 = /* @__PURE__ */ dual(2, (self, that) => ({
    _tag: OP_AND_THEN,
    first: self,
    second: that
  }));
  patch6 = /* @__PURE__ */ dual(3, (self, fiberId2, oldValue) => {
    let fiberRefs2 = oldValue;
    let patches = of(self);
    while (isNonEmptyReadonlyArray(patches)) {
      const head3 = headNonEmpty(patches);
      const tail = tailNonEmpty(patches);
      switch (head3._tag) {
        case OP_EMPTY2: {
          patches = tail;
          break;
        }
        case OP_ADD: {
          fiberRefs2 = updateAs(fiberRefs2, {
            fiberId: fiberId2,
            fiberRef: head3.fiberRef,
            value: head3.value
          });
          patches = tail;
          break;
        }
        case OP_REMOVE: {
          fiberRefs2 = delete_(fiberRefs2, head3.fiberRef);
          patches = tail;
          break;
        }
        case OP_UPDATE: {
          const value = getOrDefault(fiberRefs2, head3.fiberRef);
          fiberRefs2 = updateAs(fiberRefs2, {
            fiberId: fiberId2,
            fiberRef: head3.fiberRef,
            value: head3.fiberRef.patch(head3.patch)(value)
          });
          patches = tail;
          break;
        }
        case OP_AND_THEN: {
          patches = prepend(head3.first)(prepend(head3.second)(tail));
          break;
        }
      }
    }
    return fiberRefs2;
  });
});

// node_modules/effect/dist/esm/FiberRefsPatch.js
var diff6, patch7;
var init_FiberRefsPatch = __esm(() => {
  init_patch();
  diff6 = diff5;
  patch7 = patch6;
});

// node_modules/effect/dist/esm/internal/fiberStatus.js
var FiberStatusSymbolKey = "effect/FiberStatus", FiberStatusTypeId, OP_DONE = "Done", OP_RUNNING = "Running", OP_SUSPENDED = "Suspended", DoneHash, Done, Running, Suspended, done3, running = (runtimeFlags2) => new Running(runtimeFlags2), suspended = (runtimeFlags2, blockingOn) => new Suspended(runtimeFlags2, blockingOn), isFiberStatus = (u) => hasProperty(u, FiberStatusTypeId), isDone = (self) => self._tag === OP_DONE;
var init_fiberStatus = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Predicate();
  FiberStatusTypeId = /* @__PURE__ */ Symbol.for(FiberStatusSymbolKey);
  DoneHash = /* @__PURE__ */ string(`${FiberStatusSymbolKey}-${OP_DONE}`);
  Done = class Done {
    [FiberStatusTypeId] = FiberStatusTypeId;
    _tag = OP_DONE;
    [symbol]() {
      return DoneHash;
    }
    [symbol2](that) {
      return isFiberStatus(that) && that._tag === OP_DONE;
    }
  };
  Running = class Running {
    runtimeFlags;
    [FiberStatusTypeId] = FiberStatusTypeId;
    _tag = OP_RUNNING;
    constructor(runtimeFlags2) {
      this.runtimeFlags = runtimeFlags2;
    }
    [symbol]() {
      return pipe(hash(FiberStatusSymbolKey), combine(hash(this._tag)), combine(hash(this.runtimeFlags)), cached(this));
    }
    [symbol2](that) {
      return isFiberStatus(that) && that._tag === OP_RUNNING && this.runtimeFlags === that.runtimeFlags;
    }
  };
  Suspended = class Suspended {
    runtimeFlags;
    blockingOn;
    [FiberStatusTypeId] = FiberStatusTypeId;
    _tag = OP_SUSPENDED;
    constructor(runtimeFlags2, blockingOn) {
      this.runtimeFlags = runtimeFlags2;
      this.blockingOn = blockingOn;
    }
    [symbol]() {
      return pipe(hash(FiberStatusSymbolKey), combine(hash(this._tag)), combine(hash(this.runtimeFlags)), combine(hash(this.blockingOn)), cached(this));
    }
    [symbol2](that) {
      return isFiberStatus(that) && that._tag === OP_SUSPENDED && this.runtimeFlags === that.runtimeFlags && equals(this.blockingOn, that.blockingOn);
    }
  };
  done3 = /* @__PURE__ */ new Done;
});

// node_modules/effect/dist/esm/FiberStatus.js
var done4, running2, suspended2, isDone2;
var init_FiberStatus = __esm(() => {
  init_fiberStatus();
  done4 = done3;
  running2 = running;
  suspended2 = suspended;
  isDone2 = isDone;
});

// node_modules/effect/dist/esm/LogLevel.js
var All, Fatal, Error2, Warning, Info, Debug, Trace, None3, Order2, greaterThan2, fromLiteral = (literal) => {
  switch (literal) {
    case "All":
      return All;
    case "Debug":
      return Debug;
    case "Error":
      return Error2;
    case "Fatal":
      return Fatal;
    case "Info":
      return Info;
    case "Trace":
      return Trace;
    case "None":
      return None3;
    case "Warning":
      return Warning;
  }
};
var init_LogLevel = __esm(() => {
  init_Function();
  init_core();
  init_Number();
  init_Order();
  All = logLevelAll;
  Fatal = logLevelFatal;
  Error2 = logLevelError;
  Warning = logLevelWarning;
  Info = logLevelInfo;
  Debug = logLevelDebug;
  Trace = logLevelTrace;
  None3 = logLevelNone;
  Order2 = /* @__PURE__ */ pipe(Order, /* @__PURE__ */ mapInput2((level) => level.ordinal));
  greaterThan2 = /* @__PURE__ */ greaterThan(Order2);
});

// node_modules/effect/dist/esm/Micro.js
function defaultEvaluate(_fiber) {
  return exitDie2(`Micro.evaluate: Not implemented`);
}

class MicroSchedulerDefault {
  tasks = [];
  running = false;
  scheduleTask(task, _priority) {
    this.tasks.push(task);
    if (!this.running) {
      this.running = true;
      setImmediate(this.afterScheduled);
    }
  }
  afterScheduled = () => {
    this.running = false;
    this.runTasks();
  };
  runTasks() {
    const tasks = this.tasks;
    this.tasks = [];
    for (let i = 0, len = tasks.length;i < len; i++) {
      tasks[i]();
    }
  }
  shouldYield(fiber) {
    return fiber.currentOpCount >= fiber.getRef(MaxOpsBeforeYield);
  }
  flush() {
    while (this.tasks.length > 0) {
      this.runTasks();
    }
  }
}
var TypeId10, MicroExitTypeId, MicroCauseTypeId, microCauseVariance, MicroCauseImpl, Die, causeDie = (defect, traces = []) => new Die(defect, traces), Interrupt, causeInterrupt = (traces = []) => new Interrupt(traces), causeIsInterrupt = (self) => self._tag === "Interrupt", MicroFiberTypeId, fiberVariance, MicroFiberImpl, fiberMiddleware, identifier, args, evaluate, successCont, failureCont, ensureCont, Yield, microVariance, MicroProto, makePrimitiveProto = (options) => ({
  ...MicroProto,
  [identifier]: options.op,
  [evaluate]: options.eval ?? defaultEvaluate,
  [successCont]: options.contA,
  [failureCont]: options.contE,
  [ensureCont]: options.ensure
}), makePrimitive = (options) => {
  const Proto = makePrimitiveProto(options);
  return function() {
    const self = Object.create(Proto);
    self[args] = options.single === false ? arguments : arguments[0];
    return self;
  };
}, makeExit = (options) => {
  const Proto = {
    ...makePrimitiveProto(options),
    [MicroExitTypeId]: MicroExitTypeId,
    _tag: options.op,
    get [options.prop]() {
      return this[args];
    },
    toJSON() {
      return {
        _id: "MicroExit",
        _tag: options.op,
        [options.prop]: this[args]
      };
    },
    [symbol2](that) {
      return isMicroExit(that) && that._tag === options.op && equals(this[args], that[args]);
    },
    [symbol]() {
      return cached(this, combine(string(options.op))(hash(this[args])));
    }
  };
  return function(value) {
    const self = Object.create(Proto);
    self[args] = value;
    self[successCont] = undefined;
    self[failureCont] = undefined;
    self[ensureCont] = undefined;
    return self;
  };
}, succeed2, failCause2, yieldNowWith, yieldNow2, void_3, withMicroFiber, flatMap9, OnSuccessProto, isMicroExit = (u) => hasProperty(u, MicroExitTypeId), exitSucceed2, exitFailCause2, exitInterrupt2, exitDie2 = (defect) => exitFailCause2(causeDie(defect)), exitVoid2, setImmediate, updateContext, provideContext2, MaxOpsBeforeYield, CurrentScheduler, matchCauseEffect2, OnSuccessAndFailureProto, onExit2, setInterruptible, interruptible3 = (self) => withMicroFiber((fiber) => {
  if (fiber.interruptible)
    return self;
  fiber.interruptible = true;
  fiber._stack.push(setInterruptible(false));
  if (fiber._interrupted)
    return exitInterrupt2;
  return self;
}), uninterruptibleMask2 = (f) => withMicroFiber((fiber) => {
  if (!fiber.interruptible)
    return f(identity);
  fiber.interruptible = false;
  fiber._stack.push(setInterruptible(true));
  return f(interruptible3);
}), runFork = (effect, options) => {
  const fiber = new MicroFiberImpl(CurrentScheduler.context(options?.scheduler ?? new MicroSchedulerDefault));
  fiber.evaluate(effect);
  if (options?.signal) {
    if (options.signal.aborted) {
      fiber.unsafeInterrupt();
    } else {
      const abort = () => fiber.unsafeInterrupt();
      options.signal.addEventListener("abort", abort, {
        once: true
      });
      fiber.addObserver(() => options.signal.removeEventListener("abort", abort));
    }
  }
  return fiber;
};
var init_Micro = __esm(() => {
  init_Context();
  init_Effectable();
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_context();
  init_Pipeable();
  init_Predicate();
  init_Utils();
  TypeId10 = /* @__PURE__ */ Symbol.for("effect/Micro");
  MicroExitTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroExit");
  MicroCauseTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroCause");
  microCauseVariance = {
    _E: identity
  };
  MicroCauseImpl = class MicroCauseImpl extends globalThis.Error {
    _tag;
    traces;
    [MicroCauseTypeId];
    constructor(_tag, originalError2, traces) {
      const causeName = `MicroCause.${_tag}`;
      let name;
      let message;
      let stack;
      if (originalError2 instanceof globalThis.Error) {
        name = `(${causeName}) ${originalError2.name}`;
        message = originalError2.message;
        const messageLines = message.split(`
`).length;
        stack = originalError2.stack ? `(${causeName}) ${originalError2.stack.split(`
`).slice(0, messageLines + 3).join(`
`)}` : `${name}: ${message}`;
      } else {
        name = causeName;
        message = toStringUnknown(originalError2, 0);
        stack = `${name}: ${message}`;
      }
      if (traces.length > 0) {
        stack += `
    ${traces.join(`
    `)}`;
      }
      super(message);
      this._tag = _tag;
      this.traces = traces;
      this[MicroCauseTypeId] = microCauseVariance;
      this.name = name;
      this.stack = stack;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
    toString() {
      return this.stack;
    }
    [NodeInspectSymbol]() {
      return this.stack;
    }
  };
  Die = class Die extends MicroCauseImpl {
    defect;
    constructor(defect, traces = []) {
      super("Die", defect, traces);
      this.defect = defect;
    }
  };
  Interrupt = class Interrupt extends MicroCauseImpl {
    constructor(traces = []) {
      super("Interrupt", "interrupted", traces);
    }
  };
  MicroFiberTypeId = /* @__PURE__ */ Symbol.for("effect/Micro/MicroFiber");
  fiberVariance = {
    _A: identity,
    _E: identity
  };
  MicroFiberImpl = class MicroFiberImpl {
    context;
    interruptible;
    [MicroFiberTypeId];
    _stack = [];
    _observers = [];
    _exit;
    _children;
    currentOpCount = 0;
    constructor(context2, interruptible3 = true) {
      this.context = context2;
      this.interruptible = interruptible3;
      this[MicroFiberTypeId] = fiberVariance;
    }
    getRef(ref) {
      return unsafeGetReference(this.context, ref);
    }
    addObserver(cb) {
      if (this._exit) {
        cb(this._exit);
        return constVoid;
      }
      this._observers.push(cb);
      return () => {
        const index = this._observers.indexOf(cb);
        if (index >= 0) {
          this._observers.splice(index, 1);
        }
      };
    }
    _interrupted = false;
    unsafeInterrupt() {
      if (this._exit) {
        return;
      }
      this._interrupted = true;
      if (this.interruptible) {
        this.evaluate(exitInterrupt2);
      }
    }
    unsafePoll() {
      return this._exit;
    }
    evaluate(effect) {
      if (this._exit) {
        return;
      } else if (this._yielded !== undefined) {
        const yielded = this._yielded;
        this._yielded = undefined;
        yielded();
      }
      const exit2 = this.runLoop(effect);
      if (exit2 === Yield) {
        return;
      }
      const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
      if (interruptChildren !== undefined) {
        return this.evaluate(flatMap9(interruptChildren, () => exit2));
      }
      this._exit = exit2;
      for (let i = 0;i < this._observers.length; i++) {
        this._observers[i](exit2);
      }
      this._observers.length = 0;
    }
    runLoop(effect) {
      let yielding = false;
      let current = effect;
      this.currentOpCount = 0;
      try {
        while (true) {
          this.currentOpCount++;
          if (!yielding && this.getRef(CurrentScheduler).shouldYield(this)) {
            yielding = true;
            const prev = current;
            current = flatMap9(yieldNow2, () => prev);
          }
          current = current[evaluate](this);
          if (current === Yield) {
            const yielded = this._yielded;
            if (MicroExitTypeId in yielded) {
              this._yielded = undefined;
              return yielded;
            }
            return Yield;
          }
        }
      } catch (error) {
        if (!hasProperty(current, evaluate)) {
          return exitDie2(`MicroFiber.runLoop: Not a valid effect: ${String(current)}`);
        }
        return exitDie2(error);
      }
    }
    getCont(symbol3) {
      while (true) {
        const op = this._stack.pop();
        if (!op)
          return;
        const cont = op[ensureCont] && op[ensureCont](this);
        if (cont)
          return {
            [symbol3]: cont
          };
        if (op[symbol3])
          return op;
      }
    }
    _yielded = undefined;
    yieldWith(value) {
      this._yielded = value;
      return Yield;
    }
    children() {
      return this._children ??= new Set;
    }
  };
  fiberMiddleware = /* @__PURE__ */ globalValue("effect/Micro/fiberMiddleware", () => ({
    interruptChildren: undefined
  }));
  identifier = /* @__PURE__ */ Symbol.for("effect/Micro/identifier");
  args = /* @__PURE__ */ Symbol.for("effect/Micro/args");
  evaluate = /* @__PURE__ */ Symbol.for("effect/Micro/evaluate");
  successCont = /* @__PURE__ */ Symbol.for("effect/Micro/successCont");
  failureCont = /* @__PURE__ */ Symbol.for("effect/Micro/failureCont");
  ensureCont = /* @__PURE__ */ Symbol.for("effect/Micro/ensureCont");
  Yield = /* @__PURE__ */ Symbol.for("effect/Micro/Yield");
  microVariance = {
    _A: identity,
    _E: identity,
    _R: identity
  };
  MicroProto = {
    ...EffectPrototype2,
    _op: "Micro",
    [TypeId10]: microVariance,
    pipe() {
      return pipeArguments(this, arguments);
    },
    [Symbol.iterator]() {
      return new SingleShotGen(new YieldWrap(this));
    },
    toJSON() {
      return {
        _id: "Micro",
        op: this[identifier],
        ...args in this ? {
          args: this[args]
        } : undefined
      };
    },
    toString() {
      return format(this);
    },
    [NodeInspectSymbol]() {
      return format(this);
    }
  };
  succeed2 = /* @__PURE__ */ makeExit({
    op: "Success",
    prop: "value",
    eval(fiber) {
      const cont = fiber.getCont(successCont);
      return cont ? cont[successCont](this[args], fiber) : fiber.yieldWith(this);
    }
  });
  failCause2 = /* @__PURE__ */ makeExit({
    op: "Failure",
    prop: "cause",
    eval(fiber) {
      let cont = fiber.getCont(failureCont);
      while (causeIsInterrupt(this[args]) && cont && fiber.interruptible) {
        cont = fiber.getCont(failureCont);
      }
      return cont ? cont[failureCont](this[args], fiber) : fiber.yieldWith(this);
    }
  });
  yieldNowWith = /* @__PURE__ */ makePrimitive({
    op: "Yield",
    eval(fiber) {
      let resumed = false;
      fiber.getRef(CurrentScheduler).scheduleTask(() => {
        if (resumed)
          return;
        fiber.evaluate(exitVoid2);
      }, this[args] ?? 0);
      return fiber.yieldWith(() => {
        resumed = true;
      });
    }
  });
  yieldNow2 = /* @__PURE__ */ yieldNowWith(0);
  void_3 = /* @__PURE__ */ succeed2(undefined);
  withMicroFiber = /* @__PURE__ */ makePrimitive({
    op: "WithMicroFiber",
    eval(fiber) {
      return this[args](fiber);
    }
  });
  flatMap9 = /* @__PURE__ */ dual(2, (self, f) => {
    const onSuccess = Object.create(OnSuccessProto);
    onSuccess[args] = self;
    onSuccess[successCont] = f;
    return onSuccess;
  });
  OnSuccessProto = /* @__PURE__ */ makePrimitiveProto({
    op: "OnSuccess",
    eval(fiber) {
      fiber._stack.push(this);
      return this[args];
    }
  });
  exitSucceed2 = succeed2;
  exitFailCause2 = failCause2;
  exitInterrupt2 = /* @__PURE__ */ exitFailCause2(/* @__PURE__ */ causeInterrupt());
  exitVoid2 = /* @__PURE__ */ exitSucceed2(undefined);
  setImmediate = "setImmediate" in globalThis ? globalThis.setImmediate : (f) => setTimeout(f, 0);
  updateContext = /* @__PURE__ */ dual(2, (self, f) => withMicroFiber((fiber) => {
    const prev = fiber.context;
    fiber.context = f(prev);
    return onExit2(self, () => {
      fiber.context = prev;
      return void_3;
    });
  }));
  provideContext2 = /* @__PURE__ */ dual(2, (self, provided) => updateContext(self, merge3(provided)));
  MaxOpsBeforeYield = class MaxOpsBeforeYield extends (/* @__PURE__ */ Reference2()("effect/Micro/currentMaxOpsBeforeYield", {
    defaultValue: () => 2048
  })) {
  };
  CurrentScheduler = class CurrentScheduler extends (/* @__PURE__ */ Reference2()("effect/Micro/currentScheduler", {
    defaultValue: () => new MicroSchedulerDefault
  })) {
  };
  matchCauseEffect2 = /* @__PURE__ */ dual(2, (self, options) => {
    const primitive = Object.create(OnSuccessAndFailureProto);
    primitive[args] = self;
    primitive[successCont] = options.onSuccess;
    primitive[failureCont] = options.onFailure;
    return primitive;
  });
  OnSuccessAndFailureProto = /* @__PURE__ */ makePrimitiveProto({
    op: "OnSuccessAndFailure",
    eval(fiber) {
      fiber._stack.push(this);
      return this[args];
    }
  });
  onExit2 = /* @__PURE__ */ dual(2, (self, f) => uninterruptibleMask2((restore) => matchCauseEffect2(restore(self), {
    onFailure: (cause) => flatMap9(f(exitFailCause2(cause)), () => failCause2(cause)),
    onSuccess: (a) => flatMap9(f(exitSucceed2(a)), () => succeed2(a))
  })));
  setInterruptible = /* @__PURE__ */ makePrimitive({
    op: "SetInterruptible",
    ensure(fiber) {
      fiber.interruptible = this[args];
      if (fiber._interrupted && fiber.interruptible) {
        return () => exitInterrupt2;
      }
    }
  });
});

// node_modules/effect/dist/esm/Readable.js
var TypeId11, Proto;
var init_Readable = __esm(() => {
  init_Pipeable();
  TypeId11 = /* @__PURE__ */ Symbol.for("effect/Readable");
  Proto = {
    [TypeId11]: TypeId11,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/ref.js
var RefTypeId, refVariance, RefImpl, unsafeMake6 = (value) => new RefImpl(make11(value)), make23 = (value) => sync(() => unsafeMake6(value)), get10 = (self) => self.get, set4, getAndSet, modify3, update2;
var init_ref = __esm(() => {
  init_Effectable();
  init_Function();
  init_MutableRef();
  init_Readable();
  init_core();
  RefTypeId = /* @__PURE__ */ Symbol.for("effect/Ref");
  refVariance = {
    _A: (_) => _
  };
  RefImpl = class RefImpl extends Class {
    ref;
    commit() {
      return this.get;
    }
    [RefTypeId] = refVariance;
    [TypeId11] = TypeId11;
    constructor(ref) {
      super();
      this.ref = ref;
      this.get = sync(() => get6(this.ref));
    }
    get;
    modify(f) {
      return sync(() => {
        const current = get6(this.ref);
        const [b, a] = f(current);
        if (current !== a) {
          set2(a)(this.ref);
        }
        return b;
      });
    }
  };
  set4 = /* @__PURE__ */ dual(2, (self, value) => self.modify(() => [undefined, value]));
  getAndSet = /* @__PURE__ */ dual(2, (self, value) => self.modify((a) => [a, value]));
  modify3 = /* @__PURE__ */ dual(2, (self, f) => self.modify(f));
  update2 = /* @__PURE__ */ dual(2, (self, f) => self.modify((a) => [undefined, f(a)]));
});

// node_modules/effect/dist/esm/Ref.js
var make24, get11, getAndSet2, update3;
var init_Ref = __esm(() => {
  init_ref();
  make24 = make23;
  get11 = get10;
  getAndSet2 = getAndSet;
  update3 = update2;
});

// node_modules/effect/dist/esm/Scheduler.js
class SchedulerRunner {
  scheduleDrain;
  running = false;
  tasks = /* @__PURE__ */ new PriorityBuckets;
  constructor(scheduleDrain) {
    this.scheduleDrain = scheduleDrain;
  }
  starveInternal = (depth) => {
    const tasks = this.tasks.buckets;
    this.tasks.buckets = [];
    for (const [_, toRun] of tasks) {
      for (let i = 0;i < toRun.length; i++) {
        toRun[i]();
      }
    }
    if (this.tasks.buckets.length === 0) {
      this.running = false;
    } else {
      this.starve(depth);
    }
  };
  starve(depth = 0) {
    this.scheduleDrain(depth, this.starveInternal);
  }
  scheduleTask(task, priority) {
    this.tasks.scheduleTask(task, priority);
    if (!this.running) {
      this.running = true;
      this.starve();
    }
  }
  static cached(scheduleDrain) {
    const fallback = new SchedulerRunner(scheduleDrain);
    const runners = new WeakMap;
    return (fiber) => {
      if (fiber === undefined) {
        return fallback;
      }
      let runner = runners.get(fiber);
      if (runner === undefined) {
        runner = new SchedulerRunner(scheduleDrain);
        runners.set(fiber, runner);
      }
      return runner;
    };
  }
}

class PriorityBuckets {
  buckets = [];
  scheduleTask(task, priority) {
    const length = this.buckets.length;
    let bucket = undefined;
    let index = 0;
    for (;index < length; index++) {
      if (this.buckets[index][0] <= priority) {
        bucket = this.buckets[index];
      } else {
        break;
      }
    }
    if (bucket && bucket[0] === priority) {
      bucket[1].push(task);
    } else if (index === length) {
      this.buckets.push([priority, [task]]);
    } else {
      this.buckets.splice(index, 0, [priority, [task]]);
    }
  }
}

class MixedScheduler {
  maxNextTickBeforeTimer;
  getRunner = /* @__PURE__ */ SchedulerRunner.cached((depth, drain) => {
    if (depth >= this.maxNextTickBeforeTimer) {
      setTimeout(() => drain(0), 0);
    } else {
      Promise.resolve(undefined).then(() => drain(depth + 1));
    }
  });
  constructor(maxNextTickBeforeTimer) {
    this.maxNextTickBeforeTimer = maxNextTickBeforeTimer;
  }
  shouldYield(fiber) {
    return fiber.currentOpCount > fiber.getFiberRef(currentMaxOpsBeforeYield) ? fiber.getFiberRef(currentSchedulingPriority) : false;
  }
  scheduleTask(task, priority, fiber) {
    this.getRunner(fiber).scheduleTask(task, priority);
  }
}

class SyncScheduler {
  tasks = /* @__PURE__ */ new PriorityBuckets;
  deferred = false;
  scheduleTask(task, priority, fiber) {
    if (this.deferred) {
      defaultScheduler.scheduleTask(task, priority, fiber);
    } else {
      this.tasks.scheduleTask(task, priority);
    }
  }
  shouldYield(fiber) {
    return fiber.currentOpCount > fiber.getFiberRef(currentMaxOpsBeforeYield) ? fiber.getFiberRef(currentSchedulingPriority) : false;
  }
  flush() {
    while (this.tasks.buckets.length > 0) {
      const tasks = this.tasks.buckets;
      this.tasks.buckets = [];
      for (const [_, toRun] of tasks) {
        for (let i = 0;i < toRun.length; i++) {
          toRun[i]();
        }
      }
    }
    this.deferred = true;
  }
}
var defaultScheduler, currentScheduler, withScheduler;
var init_Scheduler = __esm(() => {
  init_Function();
  init_core();
  defaultScheduler = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Scheduler/defaultScheduler"), () => new MixedScheduler(2048));
  currentScheduler = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentScheduler"), () => fiberRefUnsafeMake(defaultScheduler));
  withScheduler = /* @__PURE__ */ dual(2, (self, scheduler) => fiberRefLocally(self, currentScheduler, scheduler));
});

// node_modules/effect/dist/esm/internal/completedRequestMap.js
var currentRequestMap;
var init_completedRequestMap = __esm(() => {
  init_core();
  currentRequestMap = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentRequestMap"), () => fiberRefUnsafeMake(new Map));
});

// node_modules/effect/dist/esm/internal/concurrency.js
var match8 = (concurrency, sequential5, unbounded, bounded2) => {
  switch (concurrency) {
    case undefined:
      return sequential5();
    case "unbounded":
      return unbounded();
    case "inherit":
      return fiberRefGetWith(currentConcurrency, (concurrency2) => concurrency2 === "unbounded" ? unbounded() : concurrency2 > 1 ? bounded2(concurrency2) : sequential5());
    default:
      return concurrency > 1 ? bounded2(concurrency) : sequential5();
  }
}, matchSimple = (concurrency, sequential5, concurrent) => {
  switch (concurrency) {
    case undefined:
      return sequential5();
    case "unbounded":
      return concurrent();
    case "inherit":
      return fiberRefGetWith(currentConcurrency, (concurrency2) => concurrency2 === "unbounded" || concurrency2 > 1 ? concurrent() : sequential5());
    default:
      return concurrency > 1 ? concurrent() : sequential5();
  }
};
var init_concurrency = __esm(() => {
  init_core();
});

// node_modules/effect/dist/esm/Clock.js
var sleep2, currentTimeMillis2, currentTimeNanos2, clockWith2, Clock;
var init_Clock = __esm(() => {
  init_clock();
  init_defaultServices();
  sleep2 = sleep;
  currentTimeMillis2 = currentTimeMillis;
  currentTimeNanos2 = currentTimeNanos;
  clockWith2 = clockWith;
  Clock = clockTag;
});

// node_modules/effect/dist/esm/internal/logSpan.js
var make25 = (label, startTime) => ({
  label,
  startTime
}), formatLabel = (key) => key.replace(/[\s="]/g, "_"), render = (now) => (self) => {
  const label = formatLabel(self.label);
  return `${label}=${now - self.startTime}ms`;
};

// node_modules/effect/dist/esm/LogSpan.js
var make26;
var init_LogSpan = __esm(() => {
  make26 = make25;
});

// node_modules/effect/dist/esm/Tracer.js
var tracerWith2;
var init_Tracer = __esm(() => {
  init_defaultServices();
  tracerWith2 = tracerWith;
});

// node_modules/effect/dist/esm/internal/metric/label.js
var MetricLabelSymbolKey = "effect/MetricLabel", MetricLabelTypeId, MetricLabelImpl, make27 = (key, value) => {
  return new MetricLabelImpl(key, value);
}, isMetricLabel = (u) => hasProperty(u, MetricLabelTypeId);
var init_label = __esm(() => {
  init_Equal();
  init_Hash();
  init_Pipeable();
  init_Predicate();
  MetricLabelTypeId = /* @__PURE__ */ Symbol.for(MetricLabelSymbolKey);
  MetricLabelImpl = class MetricLabelImpl {
    key;
    value;
    [MetricLabelTypeId] = MetricLabelTypeId;
    _hash;
    constructor(key, value) {
      this.key = key;
      this.value = value;
      this._hash = string(MetricLabelSymbolKey + this.key + this.value);
    }
    [symbol]() {
      return this._hash;
    }
    [symbol2](that) {
      return isMetricLabel(that) && this.key === that.key && this.value === that.value;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/core-effect.js
var annotateLogs, asSome = (self) => map8(self, some2), asSomeError = (self) => mapError(self, some2), try_ = (arg) => {
  let evaluate2;
  let onFailure = undefined;
  if (typeof arg === "function") {
    evaluate2 = arg;
  } else {
    evaluate2 = arg.try;
    onFailure = arg.catch;
  }
  return suspend(() => {
    try {
      return succeed(internalCall(evaluate2));
    } catch (error) {
      return fail2(onFailure ? internalCall(() => onFailure(error)) : new UnknownException(error, "An unknown error occurred in Effect.try"));
    }
  });
}, _catch, catchAllDefect, catchSomeCause, catchSomeDefect, catchTag, catchTags, cause = (self) => matchCause(self, {
  onFailure: identity,
  onSuccess: () => empty6
}), clockWith3, clock, delay, descriptorWith = (f) => withFiberRuntime((state, status) => f({
  id: state.id(),
  status,
  interruptors: interruptors(state.getFiberRef(currentInterruptedCause))
})), allowInterrupt, descriptor, diffFiberRefs = (self) => summarized(self, fiberRefs2, diff5), diffFiberRefsAndRuntimeFlags = (self) => summarized(self, zip2(fiberRefs2, runtimeFlags), ([refs, flags], [refsNew, flagsNew]) => [diff5(refs, refsNew), diff4(flags, flagsNew)]), Do2, bind3, bindTo3, let_3, dropUntil, dropWhile, contextWith = (f) => map8(context(), f), eventually = (self) => orElse2(self, () => flatMap7(yieldNow(), () => eventually(self))), filterMap4, filterOrDie, filterOrDieMessage, filterOrElse, liftPredicate2, filterOrFail, findFirst3, findLoop = (iterator, index, f, value) => flatMap7(f(value, index), (result) => {
  if (result) {
    return succeed(some2(value));
  }
  const next = iterator.next();
  if (!next.done) {
    return findLoop(iterator, index + 1, f, next.value);
  }
  return succeed(none2());
}), firstSuccessOf = (effects) => suspend(() => {
  const list = fromIterable3(effects);
  if (!isNonEmpty(list)) {
    return dieSync(() => new IllegalArgumentException(`Received an empty collection of effects`));
  }
  return pipe(tailNonEmpty2(list), reduce(headNonEmpty2(list), (left3, right3) => orElse2(left3, () => right3)));
}), flipWith, match9, every4, forAllLoop = (iterator, index, f) => {
  const next = iterator.next();
  return next.done ? succeed(true) : flatMap7(f(next.value, index), (b) => b ? forAllLoop(iterator, index + 1, f) : succeed(b));
}, forever = (self) => {
  const loop = flatMap7(flatMap7(self, () => yieldNow()), () => loop);
  return loop;
}, fiberRefs2, head3 = (self) => flatMap7(self, (as5) => {
  const iterator = as5[Symbol.iterator]();
  const next = iterator.next();
  if (next.done) {
    return fail2(new NoSuchElementException);
  }
  return succeed(next.value);
}), ignore = (self) => match9(self, {
  onFailure: constVoid,
  onSuccess: constVoid
}), ignoreLogged = (self) => matchCauseEffect(self, {
  onFailure: (cause2) => logDebug(cause2, "An error was silently ignored because it is not anticipated to be useful"),
  onSuccess: () => void_2
}), inheritFiberRefs = (childFiberRefs) => updateFiberRefs((parentFiberId, parentFiberRefs) => joinAs2(parentFiberRefs, parentFiberId, childFiberRefs)), isFailure3 = (self) => match9(self, {
  onFailure: constTrue,
  onSuccess: constFalse
}), isSuccess = (self) => match9(self, {
  onFailure: constFalse,
  onSuccess: constTrue
}), iterate = (initial, options) => suspend(() => {
  if (options.while(initial)) {
    return flatMap7(options.body(initial), (z2) => iterate(z2, options));
  }
  return succeed(initial);
}), logWithLevel = (level) => (...message) => {
  const levelOption = fromNullable(level);
  let cause2 = undefined;
  for (let i = 0, len = message.length;i < len; i++) {
    const msg = message[i];
    if (isCause(msg)) {
      if (cause2 !== undefined) {
        cause2 = sequential(cause2, msg);
      } else {
        cause2 = msg;
      }
      message = [...message.slice(0, i), ...message.slice(i + 1)];
      i--;
    }
  }
  if (cause2 === undefined) {
    cause2 = empty6;
  }
  return withFiberRuntime((fiberState) => {
    fiberState.log(message, cause2, levelOption);
    return void_2;
  });
}, log, logTrace, logDebug, logInfo, logWarning, logError, logFatal, withLogSpan, logAnnotations, loop = (initial, options) => options.discard ? loopDiscard(initial, options.while, options.step, options.body) : map8(loopInternal(initial, options.while, options.step, options.body), fromIterable2), loopInternal = (initial, cont, inc, body) => suspend(() => cont(initial) ? flatMap7(body(initial), (a) => map8(loopInternal(inc(initial), cont, inc, body), prepend3(a))) : sync(() => empty10())), loopDiscard = (initial, cont, inc, body) => suspend(() => cont(initial) ? flatMap7(body(initial), () => loopDiscard(inc(initial), cont, inc, body)) : void_2), mapAccum2, mapErrorCause, memoize = (self) => pipe(deferredMake(), flatMap7((deferred) => pipe(diffFiberRefsAndRuntimeFlags(self), intoDeferred(deferred), once, map8((complete) => zipRight2(complete, pipe(deferredAwait(deferred), flatMap7(([patch8, a]) => as3(zip2(patchFiberRefs(patch8[0]), updateRuntimeFlags(patch8[1])), a)))))))), merge5 = (self) => matchEffect(self, {
  onFailure: (e) => succeed(e),
  onSuccess: succeed
}), negate = (self) => map8(self, (b) => !b), none6 = (self) => flatMap7(self, (option) => {
  switch (option._tag) {
    case "None":
      return void_2;
    case "Some":
      return fail2(new NoSuchElementException);
  }
}), once = (self) => map8(make24(true), (ref) => asVoid2(whenEffect(self, getAndSet2(ref, false)))), option = (self) => matchEffect(self, {
  onFailure: () => succeed(none2()),
  onSuccess: (a) => succeed(some2(a))
}), orElseFail, orElseSucceed, parallelErrors = (self) => matchCauseEffect(self, {
  onFailure: (cause2) => {
    const errors = fromIterable2(failures(cause2));
    return errors.length === 0 ? failCause(cause2) : fail2(errors);
  },
  onSuccess: succeed
}), patchFiberRefs = (patch8) => updateFiberRefs((fiberId2, fiberRefs3) => pipe(patch8, patch6(fiberId2, fiberRefs3))), promise = (evaluate2) => evaluate2.length >= 1 ? async_((resolve, signal) => {
  try {
    evaluate2(signal).then((a) => resolve(succeed(a)), (e) => resolve(die2(e)));
  } catch (e) {
    resolve(die2(e));
  }
}) : async_((resolve) => {
  try {
    evaluate2().then((a) => resolve(succeed(a)), (e) => resolve(die2(e)));
  } catch (e) {
    resolve(die2(e));
  }
}), provideService, provideServiceEffect, random2, reduce9, reduceRight2, reduceWhile, reduceWhileLoop = (iterator, index, state, predicate, f) => {
  const next = iterator.next();
  if (!next.done && predicate(state)) {
    return flatMap7(f(state, next.value, index), (nextState) => reduceWhileLoop(iterator, index + 1, nextState, predicate, f));
  }
  return succeed(state);
}, repeatN, repeatNLoop = (self, n) => flatMap7(self, (a) => n <= 0 ? succeed(a) : zipRight2(yieldNow(), repeatNLoop(self, n - 1))), sandbox = (self) => matchCauseEffect(self, {
  onFailure: fail2,
  onSuccess: succeed
}), setFiberRefs = (fiberRefs3) => suspend(() => setAll2(fiberRefs3)), sleep3, succeedNone, succeedSome = (value) => succeed(some2(value)), summarized, tagMetrics, labelMetrics, takeUntil, takeWhile, tapBoth, tapDefect, tapError, tapErrorTag, tapErrorCause, timed = (self) => timedWith(self, currentTimeNanos2), timedWith, tracerWith3, tracer, tryPromise = (arg) => {
  let evaluate2;
  let catcher = undefined;
  if (typeof arg === "function") {
    evaluate2 = arg;
  } else {
    evaluate2 = arg.try;
    catcher = arg.catch;
  }
  const fail4 = (e) => catcher ? failSync(() => catcher(e)) : fail2(new UnknownException(e, "An unknown error occurred in Effect.tryPromise"));
  if (evaluate2.length >= 1) {
    return async_((resolve, signal) => {
      try {
        evaluate2(signal).then((a) => resolve(succeed(a)), (e) => resolve(fail4(e)));
      } catch (e) {
        resolve(fail4(e));
      }
    });
  }
  return async_((resolve) => {
    try {
      evaluate2().then((a) => resolve(succeed(a)), (e) => resolve(fail4(e)));
    } catch (e) {
      resolve(fail4(e));
    }
  });
}, tryMap, tryMapPromise, unless, unlessEffect, unsandbox = (self) => mapErrorCause(self, flatten3), updateFiberRefs = (f) => withFiberRuntime((state) => {
  state.setFiberRefs(f(state.id(), state.getFiberRefs()));
  return void_2;
}), updateService, when, whenFiberRef, whenRef, withMetric, serviceFunctionEffect = (getService, f) => (...args2) => flatMap7(getService, (a) => f(a)(...args2)), serviceFunction = (getService, f) => (...args2) => map8(getService, (a) => f(a)(...args2)), serviceFunctions = (getService) => new Proxy({}, {
  get(_target, prop, _receiver) {
    return (...args2) => flatMap7(getService, (s) => s[prop](...args2));
  }
}), serviceConstants = (getService) => new Proxy({}, {
  get(_target, prop, _receiver) {
    return flatMap7(getService, (s) => isEffect(s[prop]) ? s[prop] : succeed(s[prop]));
  }
}), serviceMembers = (getService) => ({
  functions: serviceFunctions(getService),
  constants: serviceConstants(getService)
}), serviceOption = (tag) => map8(context(), getOption2(tag)), serviceOptional = (tag) => flatMap7(context(), getOption2(tag)), annotateCurrentSpan = function() {
  const args2 = arguments;
  return ignore(flatMap7(currentPropagatedSpan, (span2) => sync(() => {
    if (typeof args2[0] === "string") {
      span2.attribute(args2[0], args2[1]);
    } else {
      for (const key in args2[0]) {
        span2.attribute(key, args2[0][key]);
      }
    }
  })));
}, linkSpanCurrent = function() {
  const args2 = arguments;
  const links = Array.isArray(args2[0]) ? args2[0] : [{
    _tag: "SpanLink",
    span: args2[0],
    attributes: args2[1] ?? {}
  }];
  return ignore(flatMap7(currentSpan, (span2) => sync(() => span2.addLinks(links))));
}, annotateSpans, currentParentSpan, currentSpan, currentPropagatedSpan, linkSpans, bigint02, filterDisablePropagation, unsafeMakeSpan = (fiber, name, options) => {
  const disablePropagation = !fiber.getFiberRef(currentTracerEnabled) || options.context && get5(options.context, DisablePropagation);
  const context2 = fiber.getFiberRef(currentContext);
  const parent = options.parent ? some2(options.parent) : options.root ? none2() : filterDisablePropagation(getOption2(context2, spanTag));
  let span2;
  if (disablePropagation) {
    span2 = noopSpan({
      name,
      parent,
      context: add4(options.context ?? empty8(), DisablePropagation, true)
    });
  } else {
    const services = fiber.getFiberRef(currentServices);
    const tracer2 = get5(services, tracerTag);
    const clock2 = get5(services, Clock);
    const timingEnabled = fiber.getFiberRef(currentTracerTimingEnabled);
    const fiberRefs3 = fiber.getFiberRefs();
    const annotationsFromEnv = get9(fiberRefs3, currentTracerSpanAnnotations);
    const linksFromEnv = get9(fiberRefs3, currentTracerSpanLinks);
    const links = linksFromEnv._tag === "Some" ? options.links !== undefined ? [...toReadonlyArray(linksFromEnv.value), ...options.links ?? []] : toReadonlyArray(linksFromEnv.value) : options.links ?? empty();
    span2 = tracer2.span(name, parent, options.context ?? empty8(), links, timingEnabled ? clock2.unsafeCurrentTimeNanos() : bigint02, options.kind ?? "internal", options);
    if (annotationsFromEnv._tag === "Some") {
      forEach3(annotationsFromEnv.value, (value, key) => span2.attribute(key, value));
    }
    if (options.attributes !== undefined) {
      Object.entries(options.attributes).forEach(([k, v]) => span2.attribute(k, v));
    }
  }
  if (typeof options.captureStackTrace === "function") {
    spanToTrace.set(span2, options.captureStackTrace);
  }
  return span2;
}, makeSpan = (name, options) => {
  options = addSpanStackTrace(options);
  return withFiberRuntime((fiber) => succeed(unsafeMakeSpan(fiber, name, options)));
}, spanAnnotations, spanLinks, endSpan = (span2, exit2, clock2, timingEnabled) => sync(() => {
  if (span2.status._tag === "Ended") {
    return;
  }
  if (exitIsFailure(exit2) && spanToTrace.has(span2)) {
    span2.attribute("code.stacktrace", spanToTrace.get(span2)());
  }
  span2.end(timingEnabled ? clock2.unsafeCurrentTimeNanos() : bigint02, exit2);
}), useSpan = (name, ...args2) => {
  const options = addSpanStackTrace(args2.length === 1 ? undefined : args2[0]);
  const evaluate2 = args2[args2.length - 1];
  return withFiberRuntime((fiber) => {
    const span2 = unsafeMakeSpan(fiber, name, options);
    const timingEnabled = fiber.getFiberRef(currentTracerTimingEnabled);
    const clock2 = get5(fiber.getFiberRef(currentServices), clockTag);
    return onExit(evaluate2(span2), (exit2) => endSpan(span2, exit2, clock2, timingEnabled));
  });
}, withParentSpan, withSpan = function() {
  const dataFirst = typeof arguments[0] !== "string";
  const name = dataFirst ? arguments[1] : arguments[0];
  const options = addSpanStackTrace(dataFirst ? arguments[2] : arguments[1]);
  if (dataFirst) {
    const self = arguments[0];
    return useSpan(name, options, (span2) => withParentSpan(self, span2));
  }
  return (self) => useSpan(name, options, (span2) => withParentSpan(self, span2));
}, functionWithSpan = (options) => function() {
  let captureStackTrace = options.captureStackTrace ?? false;
  if (options.captureStackTrace !== false) {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const error = new Error;
    Error.stackTraceLimit = limit;
    let cache = false;
    captureStackTrace = () => {
      if (cache !== false) {
        return cache;
      }
      if (error.stack) {
        const stack = error.stack.trim().split(`
`);
        cache = stack.slice(2).join(`
`).trim();
        return cache;
      }
    };
  }
  return suspend(() => {
    const opts = typeof options.options === "function" ? options.options.apply(null, arguments) : options.options;
    return withSpan(suspend(() => internalCall(() => options.body.apply(this, arguments))), opts.name, {
      ...opts,
      captureStackTrace
    });
  });
}, fromNullable2 = (value) => value == null ? fail2(new NoSuchElementException) : succeed(value), optionFromOptional = (self) => catchAll(map8(self, some2), (error) => isNoSuchElementException(error) ? succeedNone : fail2(error));
var init_core_effect = __esm(() => {
  init_Array();
  init_Chunk();
  init_Clock();
  init_Context();
  init_Duration();
  init_FiberRefs();
  init_Function();
  init_HashMap();
  init_HashSet();
  init_List();
  init_LogLevel();
  init_LogSpan();
  init_Option();
  init_Predicate();
  init_Ref();
  init_Tracer();
  init_Utils();
  init_cause();
  init_clock();
  init_core();
  init_defaultServices();
  init_doNotation();
  init_patch();
  init_label();
  init_runtimeFlags();
  init_tracer();
  annotateLogs = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), function() {
    const args2 = arguments;
    return fiberRefLocallyWith(args2[0], currentLogAnnotations, typeof args2[1] === "string" ? set3(args2[1], args2[2]) : (annotations) => Object.entries(args2[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations));
  });
  _catch = /* @__PURE__ */ dual(3, (self, tag, options) => catchAll(self, (e) => {
    if (hasProperty(e, tag) && e[tag] === options.failure) {
      return options.onFailure(e);
    }
    return fail2(e);
  }));
  catchAllDefect = /* @__PURE__ */ dual(2, (self, f) => catchAllCause(self, (cause) => {
    const option = find(cause, (_) => isDieType(_) ? some2(_) : none2());
    switch (option._tag) {
      case "None": {
        return failCause(cause);
      }
      case "Some": {
        return f(option.value.defect);
      }
    }
  }));
  catchSomeCause = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (cause) => {
      const option = f(cause);
      switch (option._tag) {
        case "None": {
          return failCause(cause);
        }
        case "Some": {
          return option.value;
        }
      }
    },
    onSuccess: succeed
  }));
  catchSomeDefect = /* @__PURE__ */ dual(2, (self, pf) => catchAllCause(self, (cause) => {
    const option = find(cause, (_) => isDieType(_) ? some2(_) : none2());
    switch (option._tag) {
      case "None": {
        return failCause(cause);
      }
      case "Some": {
        const optionEffect = pf(option.value.defect);
        return optionEffect._tag === "Some" ? optionEffect.value : failCause(cause);
      }
    }
  }));
  catchTag = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, ...args2) => {
    const f = args2[args2.length - 1];
    let predicate;
    if (args2.length === 2) {
      predicate = isTagged(args2[0]);
    } else {
      predicate = (e) => {
        const tag = hasProperty(e, "_tag") ? e["_tag"] : undefined;
        if (!tag)
          return false;
        for (let i = 0;i < args2.length - 1; i++) {
          if (args2[i] === tag)
            return true;
        }
        return false;
      };
    }
    return catchIf(self, predicate, f);
  });
  catchTags = /* @__PURE__ */ dual(2, (self, cases) => {
    let keys3;
    return catchIf(self, (e) => {
      keys3 ??= Object.keys(cases);
      return hasProperty(e, "_tag") && isString(e["_tag"]) && keys3.includes(e["_tag"]);
    }, (e) => cases[e["_tag"]](e));
  });
  clockWith3 = clockWith2;
  clock = /* @__PURE__ */ clockWith3(succeed);
  delay = /* @__PURE__ */ dual(2, (self, duration) => zipRight2(sleep2(duration), self));
  allowInterrupt = /* @__PURE__ */ descriptorWith((descriptor) => size3(descriptor.interruptors) > 0 ? interrupt2 : void_2);
  descriptor = /* @__PURE__ */ descriptorWith(succeed);
  Do2 = /* @__PURE__ */ succeed({});
  bind3 = /* @__PURE__ */ bind(map8, flatMap7);
  bindTo3 = /* @__PURE__ */ bindTo(map8);
  let_3 = /* @__PURE__ */ let_(map8);
  dropUntil = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let next;
    let dropping = succeed(false);
    let i = 0;
    while ((next = iterator.next()) && !next.done) {
      const a = next.value;
      const index = i++;
      dropping = flatMap7(dropping, (bool) => {
        if (bool) {
          builder.push(a);
          return succeed(true);
        }
        return predicate(a, index);
      });
    }
    return map8(dropping, () => builder);
  }));
  dropWhile = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let next;
    let dropping = succeed(true);
    let i = 0;
    while ((next = iterator.next()) && !next.done) {
      const a = next.value;
      const index = i++;
      dropping = flatMap7(dropping, (d) => map8(d ? predicate(a, index) : succeed(false), (b) => {
        if (!b) {
          builder.push(a);
        }
        return b;
      }));
    }
    return map8(dropping, () => builder);
  }));
  filterMap4 = /* @__PURE__ */ dual(2, (elements, pf) => map8(forEachSequential(elements, identity), filterMap2(pf)));
  filterOrDie = /* @__PURE__ */ dual(3, (self, predicate, orDieWith2) => filterOrElse(self, predicate, (a) => dieSync(() => orDieWith2(a))));
  filterOrDieMessage = /* @__PURE__ */ dual(3, (self, predicate, message) => filterOrElse(self, predicate, () => dieMessage(message)));
  filterOrElse = /* @__PURE__ */ dual(3, (self, predicate, orElse3) => flatMap7(self, (a) => predicate(a) ? succeed(a) : orElse3(a)));
  liftPredicate2 = /* @__PURE__ */ dual(3, (self, predicate, orFailWith) => suspend(() => predicate(self) ? succeed(self) : fail2(orFailWith(self))));
  filterOrFail = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, predicate, orFailWith) => filterOrElse(self, predicate, (a) => orFailWith === undefined ? fail2(new NoSuchElementException) : failSync(() => orFailWith(a))));
  findFirst3 = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const next = iterator.next();
    if (!next.done) {
      return findLoop(iterator, 0, predicate, next.value);
    }
    return succeed(none2());
  }));
  flipWith = /* @__PURE__ */ dual(2, (self, f) => flip(f(flip(self))));
  match9 = /* @__PURE__ */ dual(2, (self, options) => matchEffect(self, {
    onFailure: (e) => succeed(options.onFailure(e)),
    onSuccess: (a) => succeed(options.onSuccess(a))
  }));
  every4 = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => forAllLoop(elements[Symbol.iterator](), 0, predicate)));
  fiberRefs2 = /* @__PURE__ */ withFiberRuntime((state) => succeed(state.getFiberRefs()));
  log = /* @__PURE__ */ logWithLevel();
  logTrace = /* @__PURE__ */ logWithLevel(Trace);
  logDebug = /* @__PURE__ */ logWithLevel(Debug);
  logInfo = /* @__PURE__ */ logWithLevel(Info);
  logWarning = /* @__PURE__ */ logWithLevel(Warning);
  logError = /* @__PURE__ */ logWithLevel(Error2);
  logFatal = /* @__PURE__ */ logWithLevel(Fatal);
  withLogSpan = /* @__PURE__ */ dual(2, (effect, label) => flatMap7(currentTimeMillis2, (now) => fiberRefLocallyWith(effect, currentLogSpan, prepend3(make26(label, now)))));
  logAnnotations = /* @__PURE__ */ fiberRefGet(currentLogAnnotations);
  mapAccum2 = /* @__PURE__ */ dual(3, (elements, initial, f) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let result = succeed(initial);
    let next;
    let i = 0;
    while (!(next = iterator.next()).done) {
      const index = i++;
      const value = next.value;
      result = flatMap7(result, (state) => map8(f(state, value, index), ([z, b]) => {
        builder.push(b);
        return z;
      }));
    }
    return map8(result, (z) => [z, builder]);
  }));
  mapErrorCause = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (c) => failCauseSync(() => f(c)),
    onSuccess: succeed
  }));
  orElseFail = /* @__PURE__ */ dual(2, (self, evaluate2) => orElse2(self, () => failSync(evaluate2)));
  orElseSucceed = /* @__PURE__ */ dual(2, (self, evaluate2) => orElse2(self, () => sync(evaluate2)));
  provideService = /* @__PURE__ */ dual(3, (self, tag, service) => contextWithEffect((env) => provideContext(self, add4(env, tag, service))));
  provideServiceEffect = /* @__PURE__ */ dual(3, (self, tag, effect) => contextWithEffect((env) => flatMap7(effect, (service) => provideContext(self, pipe(env, add4(tag, service))))));
  random2 = /* @__PURE__ */ randomWith(succeed);
  reduce9 = /* @__PURE__ */ dual(3, (elements, zero2, f) => fromIterable2(elements).reduce((acc, el, i) => flatMap7(acc, (a) => f(a, el, i)), succeed(zero2)));
  reduceRight2 = /* @__PURE__ */ dual(3, (elements, zero2, f) => fromIterable2(elements).reduceRight((acc, el, i) => flatMap7(acc, (a) => f(el, a, i)), succeed(zero2)));
  reduceWhile = /* @__PURE__ */ dual(3, (elements, zero2, options) => flatMap7(sync(() => elements[Symbol.iterator]()), (iterator) => reduceWhileLoop(iterator, 0, zero2, options.while, options.body)));
  repeatN = /* @__PURE__ */ dual(2, (self, n) => suspend(() => repeatNLoop(self, n)));
  sleep3 = sleep2;
  succeedNone = /* @__PURE__ */ succeed(/* @__PURE__ */ none2());
  summarized = /* @__PURE__ */ dual(3, (self, summary, f) => flatMap7(summary, (start) => flatMap7(self, (value) => map8(summary, (end) => [f(start, end), value]))));
  tagMetrics = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), function() {
    return labelMetrics(arguments[0], typeof arguments[1] === "string" ? [make27(arguments[1], arguments[2])] : Object.entries(arguments[1]).map(([k, v]) => make27(k, v)));
  });
  labelMetrics = /* @__PURE__ */ dual(2, (self, labels) => fiberRefLocallyWith(self, currentMetricLabels, (old) => union(old, labels)));
  takeUntil = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let next;
    let effect = succeed(false);
    let i = 0;
    while ((next = iterator.next()) && !next.done) {
      const a = next.value;
      const index = i++;
      effect = flatMap7(effect, (bool) => {
        if (bool) {
          return succeed(true);
        }
        builder.push(a);
        return predicate(a, index);
      });
    }
    return map8(effect, () => builder);
  }));
  takeWhile = /* @__PURE__ */ dual(2, (elements, predicate) => suspend(() => {
    const iterator = elements[Symbol.iterator]();
    const builder = [];
    let next;
    let taking = succeed(true);
    let i = 0;
    while ((next = iterator.next()) && !next.done) {
      const a = next.value;
      const index = i++;
      taking = flatMap7(taking, (taking2) => pipe(taking2 ? predicate(a, index) : succeed(false), map8((bool) => {
        if (bool) {
          builder.push(a);
        }
        return bool;
      })));
    }
    return map8(taking, () => builder);
  }));
  tapBoth = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => matchCauseEffect(self, {
    onFailure: (cause2) => {
      const either3 = failureOrCause(cause2);
      switch (either3._tag) {
        case "Left": {
          return zipRight2(onFailure(either3.left), failCause(cause2));
        }
        case "Right": {
          return failCause(cause2);
        }
      }
    },
    onSuccess: (a) => as3(onSuccess(a), a)
  }));
  tapDefect = /* @__PURE__ */ dual(2, (self, f) => catchAllCause(self, (cause2) => match2(keepDefects(cause2), {
    onNone: () => failCause(cause2),
    onSome: (a) => zipRight2(f(a), failCause(cause2))
  })));
  tapError = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (cause2) => {
      const either3 = failureOrCause(cause2);
      switch (either3._tag) {
        case "Left":
          return zipRight2(f(either3.left), failCause(cause2));
        case "Right":
          return failCause(cause2);
      }
    },
    onSuccess: succeed
  }));
  tapErrorTag = /* @__PURE__ */ dual(3, (self, k, f) => tapError(self, (e) => {
    if (isTagged(e, k)) {
      return f(e);
    }
    return void_2;
  }));
  tapErrorCause = /* @__PURE__ */ dual(2, (self, f) => matchCauseEffect(self, {
    onFailure: (cause2) => zipRight2(f(cause2), failCause(cause2)),
    onSuccess: succeed
  }));
  timedWith = /* @__PURE__ */ dual(2, (self, nanos2) => summarized(self, nanos2, (start, end) => nanos(end - start)));
  tracerWith3 = tracerWith2;
  tracer = /* @__PURE__ */ tracerWith3(succeed);
  tryMap = /* @__PURE__ */ dual(2, (self, options) => flatMap7(self, (a) => try_({
    try: () => options.try(a),
    catch: options.catch
  })));
  tryMapPromise = /* @__PURE__ */ dual(2, (self, options) => flatMap7(self, (a) => tryPromise({
    try: options.try.length >= 1 ? (signal) => options.try(a, signal) : () => options.try(a),
    catch: options.catch
  })));
  unless = /* @__PURE__ */ dual(2, (self, condition) => suspend(() => condition() ? succeedNone : asSome(self)));
  unlessEffect = /* @__PURE__ */ dual(2, (self, condition) => flatMap7(condition, (b) => b ? succeedNone : asSome(self)));
  updateService = /* @__PURE__ */ dual(3, (self, tag, f) => mapInputContext(self, (context2) => add4(context2, tag, f(unsafeGet4(context2, tag)))));
  when = /* @__PURE__ */ dual(2, (self, condition) => suspend(() => condition() ? map8(self, some2) : succeed(none2())));
  whenFiberRef = /* @__PURE__ */ dual(3, (self, fiberRef, predicate) => flatMap7(fiberRefGet(fiberRef), (s) => predicate(s) ? map8(self, (a) => [s, some2(a)]) : succeed([s, none2()])));
  whenRef = /* @__PURE__ */ dual(3, (self, ref, predicate) => flatMap7(get11(ref), (s) => predicate(s) ? map8(self, (a) => [s, some2(a)]) : succeed([s, none2()])));
  withMetric = /* @__PURE__ */ dual(2, (self, metric) => metric(self));
  annotateSpans = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), function() {
    const args2 = arguments;
    return fiberRefLocallyWith(args2[0], currentTracerSpanAnnotations, typeof args2[1] === "string" ? set3(args2[1], args2[2]) : (annotations) => Object.entries(args2[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations));
  });
  currentParentSpan = /* @__PURE__ */ serviceOptional(spanTag);
  currentSpan = /* @__PURE__ */ flatMap7(/* @__PURE__ */ context(), (context2) => {
    const span2 = context2.unsafeMap.get(spanTag.key);
    return span2 !== undefined && span2._tag === "Span" ? succeed(span2) : fail2(new NoSuchElementException);
  });
  currentPropagatedSpan = /* @__PURE__ */ flatMap7(/* @__PURE__ */ context(), (context2) => {
    const span2 = filterDisablePropagation(getOption2(context2, spanTag));
    return span2._tag === "Some" && span2.value._tag === "Span" ? succeed(span2.value) : fail2(new NoSuchElementException);
  });
  linkSpans = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, span2, attributes) => fiberRefLocallyWith(self, currentTracerSpanLinks, append2({
    _tag: "SpanLink",
    span: span2,
    attributes: attributes ?? {}
  })));
  bigint02 = /* @__PURE__ */ BigInt(0);
  filterDisablePropagation = /* @__PURE__ */ flatMap((span2) => get5(span2.context, DisablePropagation) ? span2._tag === "Span" ? filterDisablePropagation(span2.parent) : none2() : some2(span2));
  spanAnnotations = /* @__PURE__ */ fiberRefGet(currentTracerSpanAnnotations);
  spanLinks = /* @__PURE__ */ fiberRefGet(currentTracerSpanLinks);
  withParentSpan = /* @__PURE__ */ dual(2, (self, span2) => provideService(self, spanTag, span2));
});

// node_modules/effect/dist/esm/Exit.js
var exports_Exit = {};
__export(exports_Exit, {
  zipWith: () => zipWith4,
  zipRight: () => zipRight3,
  zipParRight: () => zipParRight,
  zipParLeft: () => zipParLeft,
  zipPar: () => zipPar,
  zipLeft: () => zipLeft3,
  zip: () => zip3,
  void: () => void_4,
  succeed: () => succeed3,
  matchEffect: () => matchEffect2,
  match: () => match10,
  mapErrorCause: () => mapErrorCause2,
  mapError: () => mapError2,
  mapBoth: () => mapBoth2,
  map: () => map10,
  isSuccess: () => isSuccess2,
  isInterrupted: () => isInterrupted3,
  isFailure: () => isFailure4,
  isExit: () => isExit,
  interrupt: () => interrupt5,
  getOrElse: () => getOrElse5,
  fromOption: () => fromOption2,
  fromEither: () => fromEither,
  forEachEffect: () => forEachEffect,
  flatten: () => flatten7,
  flatMapEffect: () => flatMapEffect,
  flatMap: () => flatMap10,
  failCause: () => failCause3,
  fail: () => fail4,
  exists: () => exists2,
  die: () => die4,
  causeOption: () => causeOption,
  asVoid: () => asVoid3,
  as: () => as5,
  all: () => all2
});
var isExit, isFailure4, isSuccess2, isInterrupted3, as5, asVoid3, causeOption, all2, die4, exists2, fail4, failCause3, flatMap10, flatMapEffect, flatten7, forEachEffect, fromEither, fromOption2, getOrElse5, interrupt5, map10, mapBoth2, mapError2, mapErrorCause2, match10, matchEffect2, succeed3, void_4, zip3, zipLeft3, zipRight3, zipPar, zipParLeft, zipParRight, zipWith4;
var init_Exit = __esm(() => {
  init_core();
  isExit = exitIsExit;
  isFailure4 = exitIsFailure;
  isSuccess2 = exitIsSuccess;
  isInterrupted3 = exitIsInterrupted;
  as5 = exitAs;
  asVoid3 = exitAsVoid;
  causeOption = exitCauseOption;
  all2 = exitCollectAll;
  die4 = exitDie;
  exists2 = exitExists;
  fail4 = exitFail;
  failCause3 = exitFailCause;
  flatMap10 = exitFlatMap;
  flatMapEffect = exitFlatMapEffect;
  flatten7 = exitFlatten;
  forEachEffect = exitForEachEffect;
  fromEither = exitFromEither;
  fromOption2 = exitFromOption;
  getOrElse5 = exitGetOrElse;
  interrupt5 = exitInterrupt;
  map10 = exitMap;
  mapBoth2 = exitMapBoth;
  mapError2 = exitMapError;
  mapErrorCause2 = exitMapErrorCause;
  match10 = exitMatch;
  matchEffect2 = exitMatchEffect;
  succeed3 = exitSucceed;
  void_4 = exitVoid;
  zip3 = exitZip;
  zipLeft3 = exitZipLeft;
  zipRight3 = exitZipRight;
  zipPar = exitZipPar;
  zipParLeft = exitZipParLeft;
  zipParRight = exitZipParRight;
  zipWith4 = exitZipWith;
});

// node_modules/effect/dist/esm/internal/fiberMessage.js
var OP_INTERRUPT_SIGNAL = "InterruptSignal", OP_STATEFUL = "Stateful", OP_RESUME = "Resume", OP_YIELD_NOW = "YieldNow", interruptSignal = (cause2) => ({
  _tag: OP_INTERRUPT_SIGNAL,
  cause: cause2
}), stateful = (onFiber) => ({
  _tag: OP_STATEFUL,
  onFiber
}), resume = (effect) => ({
  _tag: OP_RESUME,
  effect
}), yieldNow3 = () => ({
  _tag: OP_YIELD_NOW
});

// node_modules/effect/dist/esm/internal/fiberScope.js
var FiberScopeSymbolKey = "effect/FiberScope", FiberScopeTypeId, Global, Local, unsafeMake7 = (fiber) => {
  return new Local(fiber.id(), fiber);
}, globalScope;
var init_fiberScope = __esm(() => {
  init_FiberId();
  FiberScopeTypeId = /* @__PURE__ */ Symbol.for(FiberScopeSymbolKey);
  Global = class Global {
    [FiberScopeTypeId] = FiberScopeTypeId;
    fiberId = none4;
    roots = /* @__PURE__ */ new Set;
    add(_runtimeFlags, child) {
      this.roots.add(child);
      child.addObserver(() => {
        this.roots.delete(child);
      });
    }
  };
  Local = class Local {
    fiberId;
    parent;
    [FiberScopeTypeId] = FiberScopeTypeId;
    constructor(fiberId2, parent) {
      this.fiberId = fiberId2;
      this.parent = parent;
    }
    add(_runtimeFlags, child) {
      this.parent.tell(stateful((parentFiber) => {
        parentFiber.addChild(child);
        child.addObserver(() => {
          parentFiber.removeChild(child);
        });
      }));
    }
  };
  globalScope = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberScope/Global"), () => new Global);
});

// node_modules/effect/dist/esm/internal/fiber.js
var FiberSymbolKey = "effect/Fiber", FiberTypeId, fiberVariance2, fiberProto, RuntimeFiberSymbolKey = "effect/Fiber", RuntimeFiberTypeId, isRuntimeFiber = (self) => (RuntimeFiberTypeId in self), _await2 = (self) => self.await, inheritAll = (self) => self.inheritAll, interruptAllAs, interruptAsFork, join2 = (self) => zipLeft2(flatten5(self.await), self.inheritAll), _never, currentFiberURI = "effect/FiberCurrent";
var init_fiber = __esm(() => {
  init_FiberId();
  init_Function();
  init_Option();
  init_Pipeable();
  init_core();
  init_effectable();
  FiberTypeId = /* @__PURE__ */ Symbol.for(FiberSymbolKey);
  fiberVariance2 = {
    _E: (_) => _,
    _A: (_) => _
  };
  fiberProto = {
    [FiberTypeId]: fiberVariance2,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  RuntimeFiberTypeId = /* @__PURE__ */ Symbol.for(RuntimeFiberSymbolKey);
  interruptAllAs = /* @__PURE__ */ dual(2, /* @__PURE__ */ fnUntraced(function* (fibers, fiberId2) {
    for (const fiber of fibers) {
      if (isRuntimeFiber(fiber)) {
        fiber.unsafeInterruptAsFork(fiberId2);
        continue;
      }
      yield* fiber.interruptAsFork(fiberId2);
    }
    for (const fiber of fibers) {
      if (isRuntimeFiber(fiber) && fiber.unsafePoll()) {
        continue;
      }
      yield* fiber.await;
    }
  }));
  interruptAsFork = /* @__PURE__ */ dual(2, (self, fiberId2) => self.interruptAsFork(fiberId2));
  _never = {
    ...CommitPrototype,
    commit() {
      return join2(this);
    },
    ...fiberProto,
    id: () => none4,
    await: never,
    children: /* @__PURE__ */ succeed([]),
    inheritAll: never,
    poll: /* @__PURE__ */ succeed(/* @__PURE__ */ none2()),
    interruptAsFork: () => never
  };
});

// node_modules/effect/dist/esm/internal/logger.js
var LoggerSymbolKey = "effect/Logger", LoggerTypeId, loggerVariance, makeLogger = (log2) => ({
  [LoggerTypeId]: loggerVariance,
  log: log2,
  pipe() {
    return pipeArguments(this, arguments);
  }
}), none7, textOnly, format3 = (quoteValue, whitespace) => ({
  annotations,
  cause: cause2,
  date,
  fiberId: fiberId2,
  logLevel,
  message,
  spans
}) => {
  const formatValue = (value) => value.match(textOnly) ? value : quoteValue(value);
  const format4 = (label, value) => `${formatLabel(label)}=${formatValue(value)}`;
  const append3 = (label, value) => " " + format4(label, value);
  let out = format4("timestamp", date.toISOString());
  out += append3("level", logLevel.label);
  out += append3("fiber", threadName(fiberId2));
  const messages = ensure(message);
  for (let i = 0;i < messages.length; i++) {
    out += append3("message", toStringUnknown(messages[i], whitespace));
  }
  if (!isEmptyType(cause2)) {
    out += append3("cause", pretty(cause2, {
      renderErrorCause: true
    }));
  }
  for (const span2 of spans) {
    out += " " + render(date.getTime())(span2);
  }
  for (const [label, value] of annotations) {
    out += append3(label, toStringUnknown(value, whitespace));
  }
  return out;
}, escapeDoubleQuotes = (s) => `"${s.replace(/\\([\s\S])|(")/g, "\\$1$2")}"`, stringLogger, colors, logLevelColors, hasProcessStdout, processStdoutIsTTY, hasProcessStdoutOrDeno;
var init_logger = __esm(() => {
  init_Array();
  init_Function();
  init_Inspectable();
  init_Pipeable();
  init_cause();
  init_fiberId();
  LoggerTypeId = /* @__PURE__ */ Symbol.for(LoggerSymbolKey);
  loggerVariance = {
    _Message: (_) => _,
    _Output: (_) => _
  };
  none7 = {
    [LoggerTypeId]: loggerVariance,
    log: constVoid,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  textOnly = /^[^\s"=]*$/;
  stringLogger = /* @__PURE__ */ makeLogger(/* @__PURE__ */ format3(escapeDoubleQuotes));
  colors = {
    bold: "1",
    red: "31",
    green: "32",
    yellow: "33",
    blue: "34",
    cyan: "36",
    white: "37",
    gray: "90",
    black: "30",
    bgBrightRed: "101"
  };
  logLevelColors = {
    None: [],
    All: [],
    Trace: [colors.gray],
    Debug: [colors.blue],
    Info: [colors.green],
    Warning: [colors.yellow],
    Error: [colors.red],
    Fatal: [colors.bgBrightRed, colors.black]
  };
  hasProcessStdout = typeof process === "object" && process !== null && typeof process.stdout === "object" && process.stdout !== null;
  processStdoutIsTTY = hasProcessStdout && process.stdout.isTTY === true;
  hasProcessStdoutOrDeno = hasProcessStdout || "Deno" in globalThis;
});

// node_modules/effect/dist/esm/internal/metric/boundaries.js
var MetricBoundariesSymbolKey = "effect/MetricBoundaries", MetricBoundariesTypeId, MetricBoundariesImpl, isMetricBoundaries = (u) => hasProperty(u, MetricBoundariesTypeId), fromIterable8 = (iterable) => {
  const values3 = pipe(iterable, appendAll(of2(Number.POSITIVE_INFINITY)), dedupe);
  return new MetricBoundariesImpl(values3);
}, exponential = (options) => pipe(makeBy(options.count - 1, (i) => options.start * Math.pow(options.factor, i)), unsafeFromArray, fromIterable8);
var init_boundaries = __esm(() => {
  init_Array();
  init_Chunk();
  init_Equal();
  init_Function();
  init_Hash();
  init_Pipeable();
  init_Predicate();
  MetricBoundariesTypeId = /* @__PURE__ */ Symbol.for(MetricBoundariesSymbolKey);
  MetricBoundariesImpl = class MetricBoundariesImpl {
    values;
    [MetricBoundariesTypeId] = MetricBoundariesTypeId;
    constructor(values3) {
      this.values = values3;
      this._hash = pipe(string(MetricBoundariesSymbolKey), combine(array2(this.values)));
    }
    _hash;
    [symbol]() {
      return this._hash;
    }
    [symbol2](u) {
      return isMetricBoundaries(u) && equals(this.values, u.values);
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/metric/keyType.js
var MetricKeyTypeSymbolKey = "effect/MetricKeyType", MetricKeyTypeTypeId, CounterKeyTypeSymbolKey = "effect/MetricKeyType/Counter", CounterKeyTypeTypeId, FrequencyKeyTypeSymbolKey = "effect/MetricKeyType/Frequency", FrequencyKeyTypeTypeId, GaugeKeyTypeSymbolKey = "effect/MetricKeyType/Gauge", GaugeKeyTypeTypeId, HistogramKeyTypeSymbolKey = "effect/MetricKeyType/Histogram", HistogramKeyTypeTypeId, SummaryKeyTypeSymbolKey = "effect/MetricKeyType/Summary", SummaryKeyTypeTypeId, metricKeyTypeVariance, CounterKeyType, HistogramKeyType, counter = (options) => new CounterKeyType(options?.incremental ?? false, options?.bigint ?? false), histogram = (boundaries) => {
  return new HistogramKeyType(boundaries);
}, isCounterKey = (u) => hasProperty(u, CounterKeyTypeTypeId), isFrequencyKey = (u) => hasProperty(u, FrequencyKeyTypeTypeId), isGaugeKey = (u) => hasProperty(u, GaugeKeyTypeTypeId), isHistogramKey = (u) => hasProperty(u, HistogramKeyTypeTypeId), isSummaryKey = (u) => hasProperty(u, SummaryKeyTypeTypeId);
var init_keyType = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Pipeable();
  init_Predicate();
  MetricKeyTypeTypeId = /* @__PURE__ */ Symbol.for(MetricKeyTypeSymbolKey);
  CounterKeyTypeTypeId = /* @__PURE__ */ Symbol.for(CounterKeyTypeSymbolKey);
  FrequencyKeyTypeTypeId = /* @__PURE__ */ Symbol.for(FrequencyKeyTypeSymbolKey);
  GaugeKeyTypeTypeId = /* @__PURE__ */ Symbol.for(GaugeKeyTypeSymbolKey);
  HistogramKeyTypeTypeId = /* @__PURE__ */ Symbol.for(HistogramKeyTypeSymbolKey);
  SummaryKeyTypeTypeId = /* @__PURE__ */ Symbol.for(SummaryKeyTypeSymbolKey);
  metricKeyTypeVariance = {
    _In: (_) => _,
    _Out: (_) => _
  };
  CounterKeyType = class CounterKeyType {
    incremental;
    bigint;
    [MetricKeyTypeTypeId] = metricKeyTypeVariance;
    [CounterKeyTypeTypeId] = CounterKeyTypeTypeId;
    constructor(incremental, bigint) {
      this.incremental = incremental;
      this.bigint = bigint;
      this._hash = string(CounterKeyTypeSymbolKey);
    }
    _hash;
    [symbol]() {
      return this._hash;
    }
    [symbol2](that) {
      return isCounterKey(that);
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  HistogramKeyType = class HistogramKeyType {
    boundaries;
    [MetricKeyTypeTypeId] = metricKeyTypeVariance;
    [HistogramKeyTypeTypeId] = HistogramKeyTypeTypeId;
    constructor(boundaries) {
      this.boundaries = boundaries;
      this._hash = pipe(string(HistogramKeyTypeSymbolKey), combine(hash(this.boundaries)));
    }
    _hash;
    [symbol]() {
      return this._hash;
    }
    [symbol2](that) {
      return isHistogramKey(that) && equals(this.boundaries, that.boundaries);
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/metric/key.js
var MetricKeySymbolKey = "effect/MetricKey", MetricKeyTypeId, metricKeyVariance, arrayEquivilence, MetricKeyImpl, isMetricKey = (u) => hasProperty(u, MetricKeyTypeId), counter2 = (name, options) => new MetricKeyImpl(name, counter(options), fromNullable(options?.description)), histogram2 = (name, boundaries, description) => new MetricKeyImpl(name, histogram(boundaries), fromNullable(description)), taggedWithLabels;
var init_key = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_Hash();
  init_Option();
  init_Pipeable();
  init_Predicate();
  init_keyType();
  MetricKeyTypeId = /* @__PURE__ */ Symbol.for(MetricKeySymbolKey);
  metricKeyVariance = {
    _Type: (_) => _
  };
  arrayEquivilence = /* @__PURE__ */ getEquivalence2(equals);
  MetricKeyImpl = class MetricKeyImpl {
    name;
    keyType;
    description;
    tags;
    [MetricKeyTypeId] = metricKeyVariance;
    constructor(name, keyType, description, tags = []) {
      this.name = name;
      this.keyType = keyType;
      this.description = description;
      this.tags = tags;
      this._hash = pipe(string(this.name + this.description), combine(hash(this.keyType)), combine(array2(this.tags)));
    }
    _hash;
    [symbol]() {
      return this._hash;
    }
    [symbol2](u) {
      return isMetricKey(u) && this.name === u.name && equals(this.keyType, u.keyType) && equals(this.description, u.description) && arrayEquivilence(this.tags, u.tags);
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  taggedWithLabels = /* @__PURE__ */ dual(2, (self, extraTags) => extraTags.length === 0 ? self : new MetricKeyImpl(self.name, self.keyType, self.description, union(self.tags, extraTags)));
});

// node_modules/effect/dist/esm/MutableHashMap.js
class BucketIterator {
  backing;
  constructor(backing) {
    this.backing = backing;
  }
  currentBucket;
  next() {
    if (this.currentBucket === undefined) {
      const result2 = this.backing.next();
      if (result2.done) {
        return result2;
      }
      this.currentBucket = result2.value[Symbol.iterator]();
    }
    const result = this.currentBucket.next();
    if (result.done) {
      this.currentBucket = undefined;
      return this.next();
    }
    return result;
  }
}
var TypeId12, MutableHashMapProto, MutableHashMapIterator, empty22 = () => {
  const self = Object.create(MutableHashMapProto);
  self.referential = new Map;
  self.buckets = new Map;
  self.bucketsSize = 0;
  return self;
}, get12, getFromBucket = (self, bucket, key, remove5 = false) => {
  for (let i = 0, len = bucket.length;i < len; i++) {
    if (key[symbol2](bucket[i][0])) {
      const value = bucket[i][1];
      if (remove5) {
        bucket.splice(i, 1);
        self.bucketsSize--;
      }
      return some2(value);
    }
  }
  return none2();
}, has4, set5, removeFromBucket = (self, bucket, key) => {
  for (let i = 0, len = bucket.length;i < len; i++) {
    if (key[symbol2](bucket[i][0])) {
      bucket.splice(i, 1);
      self.bucketsSize--;
      return;
    }
  }
}, remove5, size6 = (self) => {
  return self.referential.size + self.bucketsSize;
};
var init_MutableHashMap = __esm(() => {
  init_Equal();
  init_Function();
  init_Hash();
  init_Inspectable();
  init_Option();
  init_Pipeable();
  TypeId12 = /* @__PURE__ */ Symbol.for("effect/MutableHashMap");
  MutableHashMapProto = {
    [TypeId12]: TypeId12,
    [Symbol.iterator]() {
      return new MutableHashMapIterator(this);
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "MutableHashMap",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  MutableHashMapIterator = class MutableHashMapIterator {
    self;
    referentialIterator;
    bucketIterator;
    constructor(self) {
      this.self = self;
      this.referentialIterator = self.referential[Symbol.iterator]();
    }
    next() {
      if (this.bucketIterator !== undefined) {
        return this.bucketIterator.next();
      }
      const result = this.referentialIterator.next();
      if (result.done) {
        this.bucketIterator = new BucketIterator(this.self.buckets.values());
        return this.next();
      }
      return result;
    }
    [Symbol.iterator]() {
      return new MutableHashMapIterator(this.self);
    }
  };
  get12 = /* @__PURE__ */ dual(2, (self, key) => {
    if (isEqual(key) === false) {
      return self.referential.has(key) ? some2(self.referential.get(key)) : none2();
    }
    const hash2 = key[symbol]();
    const bucket = self.buckets.get(hash2);
    if (bucket === undefined) {
      return none2();
    }
    return getFromBucket(self, bucket, key);
  });
  has4 = /* @__PURE__ */ dual(2, (self, key) => isSome2(get12(self, key)));
  set5 = /* @__PURE__ */ dual(3, (self, key, value) => {
    if (isEqual(key) === false) {
      self.referential.set(key, value);
      return self;
    }
    const hash2 = key[symbol]();
    const bucket = self.buckets.get(hash2);
    if (bucket === undefined) {
      self.buckets.set(hash2, [[key, value]]);
      self.bucketsSize++;
      return self;
    }
    removeFromBucket(self, bucket, key);
    bucket.push([key, value]);
    self.bucketsSize++;
    return self;
  });
  remove5 = /* @__PURE__ */ dual(2, (self, key) => {
    if (isEqual(key) === false) {
      self.referential.delete(key);
      return self;
    }
    const hash2 = key[symbol]();
    const bucket = self.buckets.get(hash2);
    if (bucket === undefined) {
      return self;
    }
    removeFromBucket(self, bucket, key);
    if (bucket.length === 0) {
      self.buckets.delete(hash2);
    }
    return self;
  });
});

// node_modules/effect/dist/esm/internal/metric/state.js
var MetricStateSymbolKey = "effect/MetricState", MetricStateTypeId, CounterStateSymbolKey = "effect/MetricState/Counter", CounterStateTypeId, FrequencyStateSymbolKey = "effect/MetricState/Frequency", FrequencyStateTypeId, GaugeStateSymbolKey = "effect/MetricState/Gauge", GaugeStateTypeId, HistogramStateSymbolKey = "effect/MetricState/Histogram", HistogramStateTypeId, SummaryStateSymbolKey = "effect/MetricState/Summary", SummaryStateTypeId, metricStateVariance, CounterState, arrayEquals, FrequencyState, GaugeState, HistogramState, SummaryState, counter3 = (count) => new CounterState(count), frequency2 = (occurrences) => {
  return new FrequencyState(occurrences);
}, gauge2 = (count) => new GaugeState(count), histogram3 = (options) => new HistogramState(options.buckets, options.count, options.min, options.max, options.sum), summary2 = (options) => new SummaryState(options.error, options.quantiles, options.count, options.min, options.max, options.sum), isCounterState = (u) => hasProperty(u, CounterStateTypeId), isFrequencyState = (u) => hasProperty(u, FrequencyStateTypeId), isGaugeState = (u) => hasProperty(u, GaugeStateTypeId), isHistogramState = (u) => hasProperty(u, HistogramStateTypeId), isSummaryState = (u) => hasProperty(u, SummaryStateTypeId);
var init_state = __esm(() => {
  init_Array();
  init_Equal();
  init_Function();
  init_Hash();
  init_Pipeable();
  init_Predicate();
  MetricStateTypeId = /* @__PURE__ */ Symbol.for(MetricStateSymbolKey);
  CounterStateTypeId = /* @__PURE__ */ Symbol.for(CounterStateSymbolKey);
  FrequencyStateTypeId = /* @__PURE__ */ Symbol.for(FrequencyStateSymbolKey);
  GaugeStateTypeId = /* @__PURE__ */ Symbol.for(GaugeStateSymbolKey);
  HistogramStateTypeId = /* @__PURE__ */ Symbol.for(HistogramStateSymbolKey);
  SummaryStateTypeId = /* @__PURE__ */ Symbol.for(SummaryStateSymbolKey);
  metricStateVariance = {
    _A: (_) => _
  };
  CounterState = class CounterState {
    count;
    [MetricStateTypeId] = metricStateVariance;
    [CounterStateTypeId] = CounterStateTypeId;
    constructor(count) {
      this.count = count;
    }
    [symbol]() {
      return pipe(hash(CounterStateSymbolKey), combine(hash(this.count)), cached(this));
    }
    [symbol2](that) {
      return isCounterState(that) && this.count === that.count;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  arrayEquals = /* @__PURE__ */ getEquivalence2(equals);
  FrequencyState = class FrequencyState {
    occurrences;
    [MetricStateTypeId] = metricStateVariance;
    [FrequencyStateTypeId] = FrequencyStateTypeId;
    constructor(occurrences) {
      this.occurrences = occurrences;
    }
    _hash;
    [symbol]() {
      return pipe(string(FrequencyStateSymbolKey), combine(array2(fromIterable2(this.occurrences.entries()))), cached(this));
    }
    [symbol2](that) {
      return isFrequencyState(that) && arrayEquals(fromIterable2(this.occurrences.entries()), fromIterable2(that.occurrences.entries()));
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  GaugeState = class GaugeState {
    value;
    [MetricStateTypeId] = metricStateVariance;
    [GaugeStateTypeId] = GaugeStateTypeId;
    constructor(value) {
      this.value = value;
    }
    [symbol]() {
      return pipe(hash(GaugeStateSymbolKey), combine(hash(this.value)), cached(this));
    }
    [symbol2](u) {
      return isGaugeState(u) && this.value === u.value;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  HistogramState = class HistogramState {
    buckets;
    count;
    min;
    max;
    sum;
    [MetricStateTypeId] = metricStateVariance;
    [HistogramStateTypeId] = HistogramStateTypeId;
    constructor(buckets, count, min2, max2, sum) {
      this.buckets = buckets;
      this.count = count;
      this.min = min2;
      this.max = max2;
      this.sum = sum;
    }
    [symbol]() {
      return pipe(hash(HistogramStateSymbolKey), combine(hash(this.buckets)), combine(hash(this.count)), combine(hash(this.min)), combine(hash(this.max)), combine(hash(this.sum)), cached(this));
    }
    [symbol2](that) {
      return isHistogramState(that) && equals(this.buckets, that.buckets) && this.count === that.count && this.min === that.min && this.max === that.max && this.sum === that.sum;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  SummaryState = class SummaryState {
    error;
    quantiles;
    count;
    min;
    max;
    sum;
    [MetricStateTypeId] = metricStateVariance;
    [SummaryStateTypeId] = SummaryStateTypeId;
    constructor(error, quantiles, count, min2, max2, sum) {
      this.error = error;
      this.quantiles = quantiles;
      this.count = count;
      this.min = min2;
      this.max = max2;
      this.sum = sum;
    }
    [symbol]() {
      return pipe(hash(SummaryStateSymbolKey), combine(hash(this.error)), combine(hash(this.quantiles)), combine(hash(this.count)), combine(hash(this.min)), combine(hash(this.max)), combine(hash(this.sum)), cached(this));
    }
    [symbol2](that) {
      return isSummaryState(that) && this.error === that.error && equals(this.quantiles, that.quantiles) && this.count === that.count && this.min === that.min && this.max === that.max && this.sum === that.sum;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
});

// node_modules/effect/dist/esm/internal/metric/hook.js
var MetricHookSymbolKey = "effect/MetricHook", MetricHookTypeId, metricHookVariance, make28 = (options) => ({
  [MetricHookTypeId]: metricHookVariance,
  pipe() {
    return pipeArguments(this, arguments);
  },
  ...options
}), bigint03, counter4 = (key) => {
  let sum = key.keyType.bigint ? bigint03 : 0;
  const canUpdate = key.keyType.incremental ? key.keyType.bigint ? (value) => value >= bigint03 : (value) => value >= 0 : (_value) => true;
  const update4 = (value) => {
    if (canUpdate(value)) {
      sum = sum + value;
    }
  };
  return make28({
    get: () => counter3(sum),
    update: update4,
    modify: update4
  });
}, frequency3 = (key) => {
  const values3 = new Map;
  for (const word of key.keyType.preregisteredWords) {
    values3.set(word, 0);
  }
  const update4 = (word) => {
    const slotCount = values3.get(word) ?? 0;
    values3.set(word, slotCount + 1);
  };
  return make28({
    get: () => frequency2(values3),
    update: update4,
    modify: update4
  });
}, gauge3 = (_key, startAt) => {
  let value = startAt;
  return make28({
    get: () => gauge2(value),
    update: (v) => {
      value = v;
    },
    modify: (v) => {
      value = value + v;
    }
  });
}, histogram4 = (key) => {
  const bounds = key.keyType.boundaries.values;
  const size7 = bounds.length;
  const values3 = new Uint32Array(size7 + 1);
  const boundaries = new Float64Array(size7);
  let count = 0;
  let sum = 0;
  let min2 = Number.MAX_VALUE;
  let max2 = Number.MIN_VALUE;
  pipe(bounds, sort(Order), map2((n, i) => {
    boundaries[i] = n;
  }));
  const update4 = (value) => {
    let from = 0;
    let to = size7;
    while (from !== to) {
      const mid = Math.floor(from + (to - from) / 2);
      const boundary = boundaries[mid];
      if (value <= boundary) {
        to = mid;
      } else {
        from = mid;
      }
      if (to === from + 1) {
        if (value <= boundaries[from]) {
          to = from;
        } else {
          from = to;
        }
      }
    }
    values3[from] = values3[from] + 1;
    count = count + 1;
    sum = sum + value;
    if (value < min2) {
      min2 = value;
    }
    if (value > max2) {
      max2 = value;
    }
  };
  const getBuckets = () => {
    const builder = allocate(size7);
    let cumulated = 0;
    for (let i = 0;i < size7; i++) {
      const boundary = boundaries[i];
      const value = values3[i];
      cumulated = cumulated + value;
      builder[i] = [boundary, cumulated];
    }
    return builder;
  };
  return make28({
    get: () => histogram3({
      buckets: getBuckets(),
      count,
      min: min2,
      max: max2,
      sum
    }),
    update: update4,
    modify: update4
  });
}, summary3 = (key) => {
  const {
    error,
    maxAge,
    maxSize,
    quantiles
  } = key.keyType;
  const sortedQuantiles = pipe(quantiles, sort(Order));
  const values3 = allocate(maxSize);
  let head4 = 0;
  let count = 0;
  let sum = 0;
  let min2 = 0;
  let max2 = 0;
  const snapshot = (now) => {
    const builder = [];
    let i = 0;
    while (i !== maxSize - 1) {
      const item = values3[i];
      if (item != null) {
        const [t, v] = item;
        const age = millis(now - t);
        if (greaterThanOrEqualTo(age, zero) && lessThanOrEqualTo(age, maxAge)) {
          builder.push(v);
        }
      }
      i = i + 1;
    }
    return calculateQuantiles(error, sortedQuantiles, sort(builder, Order));
  };
  const observe = (value, timestamp) => {
    if (maxSize > 0) {
      head4 = head4 + 1;
      const target = head4 % maxSize;
      values3[target] = [timestamp, value];
    }
    min2 = count === 0 ? value : Math.min(min2, value);
    max2 = count === 0 ? value : Math.max(max2, value);
    count = count + 1;
    sum = sum + value;
  };
  return make28({
    get: () => summary2({
      error,
      quantiles: snapshot(Date.now()),
      count,
      min: min2,
      max: max2,
      sum
    }),
    update: ([value, timestamp]) => observe(value, timestamp),
    modify: ([value, timestamp]) => observe(value, timestamp)
  });
}, calculateQuantiles = (error, sortedQuantiles, sortedSamples) => {
  const sampleCount = sortedSamples.length;
  if (!isNonEmptyReadonlyArray(sortedQuantiles)) {
    return empty();
  }
  const head4 = sortedQuantiles[0];
  const tail = sortedQuantiles.slice(1);
  const resolvedHead = resolveQuantile(error, sampleCount, none2(), 0, head4, sortedSamples);
  const resolved = of(resolvedHead);
  tail.forEach((quantile) => {
    resolved.push(resolveQuantile(error, sampleCount, resolvedHead.value, resolvedHead.consumed, quantile, resolvedHead.rest));
  });
  return map2(resolved, (rq) => [rq.quantile, rq.value]);
}, resolveQuantile = (error, sampleCount, current, consumed, quantile, rest) => {
  let error_1 = error;
  let sampleCount_1 = sampleCount;
  let current_1 = current;
  let consumed_1 = consumed;
  let quantile_1 = quantile;
  let rest_1 = rest;
  let error_2 = error;
  let sampleCount_2 = sampleCount;
  let current_2 = current;
  let consumed_2 = consumed;
  let quantile_2 = quantile;
  let rest_2 = rest;
  while (true) {
    if (!isNonEmptyReadonlyArray(rest_1)) {
      return {
        quantile: quantile_1,
        value: none2(),
        consumed: consumed_1,
        rest: []
      };
    }
    if (quantile_1 === 1) {
      return {
        quantile: quantile_1,
        value: some2(lastNonEmpty(rest_1)),
        consumed: consumed_1 + rest_1.length,
        rest: []
      };
    }
    const headValue = headNonEmpty(rest_1);
    const sameHead = span(rest_1, (n) => n === headValue);
    const desired = quantile_1 * sampleCount_1;
    const allowedError = error_1 / 2 * desired;
    const candConsumed = consumed_1 + sameHead[0].length;
    const candError = Math.abs(candConsumed - desired);
    if (candConsumed < desired - allowedError) {
      error_2 = error_1;
      sampleCount_2 = sampleCount_1;
      current_2 = head(rest_1);
      consumed_2 = candConsumed;
      quantile_2 = quantile_1;
      rest_2 = sameHead[1];
      error_1 = error_2;
      sampleCount_1 = sampleCount_2;
      current_1 = current_2;
      consumed_1 = consumed_2;
      quantile_1 = quantile_2;
      rest_1 = rest_2;
      continue;
    }
    if (candConsumed > desired + allowedError) {
      const valueToReturn = isNone2(current_1) ? some2(headValue) : current_1;
      return {
        quantile: quantile_1,
        value: valueToReturn,
        consumed: consumed_1,
        rest: rest_1
      };
    }
    switch (current_1._tag) {
      case "None": {
        error_2 = error_1;
        sampleCount_2 = sampleCount_1;
        current_2 = head(rest_1);
        consumed_2 = candConsumed;
        quantile_2 = quantile_1;
        rest_2 = sameHead[1];
        error_1 = error_2;
        sampleCount_1 = sampleCount_2;
        current_1 = current_2;
        consumed_1 = consumed_2;
        quantile_1 = quantile_2;
        rest_1 = rest_2;
        continue;
      }
      case "Some": {
        const prevError = Math.abs(desired - current_1.value);
        if (candError < prevError) {
          error_2 = error_1;
          sampleCount_2 = sampleCount_1;
          current_2 = head(rest_1);
          consumed_2 = candConsumed;
          quantile_2 = quantile_1;
          rest_2 = sameHead[1];
          error_1 = error_2;
          sampleCount_1 = sampleCount_2;
          current_1 = current_2;
          consumed_1 = consumed_2;
          quantile_1 = quantile_2;
          rest_1 = rest_2;
          continue;
        }
        return {
          quantile: quantile_1,
          value: some2(current_1.value),
          consumed: consumed_1,
          rest: rest_1
        };
      }
    }
  }
  throw new Error("BUG: MetricHook.resolveQuantiles - please report an issue at https://github.com/Effect-TS/effect/issues");
};
var init_hook = __esm(() => {
  init_Array();
  init_Duration();
  init_Function();
  init_Number();
  init_Option();
  init_Pipeable();
  init_state();
  MetricHookTypeId = /* @__PURE__ */ Symbol.for(MetricHookSymbolKey);
  metricHookVariance = {
    _In: (_) => _,
    _Out: (_) => _
  };
  bigint03 = /* @__PURE__ */ BigInt(0);
});

// node_modules/effect/dist/esm/internal/metric/pair.js
var MetricPairSymbolKey = "effect/MetricPair", MetricPairTypeId, metricPairVariance, unsafeMake8 = (metricKey, metricState) => {
  return {
    [MetricPairTypeId]: metricPairVariance,
    metricKey,
    metricState,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
};
var init_pair = __esm(() => {
  init_Pipeable();
  MetricPairTypeId = /* @__PURE__ */ Symbol.for(MetricPairSymbolKey);
  metricPairVariance = {
    _Type: (_) => _
  };
});

// node_modules/effect/dist/esm/internal/metric/registry.js
var MetricRegistrySymbolKey = "effect/MetricRegistry", MetricRegistryTypeId, MetricRegistryImpl, make29 = () => {
  return new MetricRegistryImpl;
};
var init_registry = __esm(() => {
  init_Function();
  init_MutableHashMap();
  init_Option();
  init_hook();
  init_keyType();
  init_pair();
  MetricRegistryTypeId = /* @__PURE__ */ Symbol.for(MetricRegistrySymbolKey);
  MetricRegistryImpl = class MetricRegistryImpl {
    [MetricRegistryTypeId] = MetricRegistryTypeId;
    map = /* @__PURE__ */ empty22();
    snapshot() {
      const result = [];
      for (const [key, hook] of this.map) {
        result.push(unsafeMake8(key, hook.get()));
      }
      return result;
    }
    get(key) {
      const hook = pipe(this.map, get12(key), getOrUndefined);
      if (hook == null) {
        if (isCounterKey(key.keyType)) {
          return this.getCounter(key);
        }
        if (isGaugeKey(key.keyType)) {
          return this.getGauge(key);
        }
        if (isFrequencyKey(key.keyType)) {
          return this.getFrequency(key);
        }
        if (isHistogramKey(key.keyType)) {
          return this.getHistogram(key);
        }
        if (isSummaryKey(key.keyType)) {
          return this.getSummary(key);
        }
        throw new Error("BUG: MetricRegistry.get - unknown MetricKeyType - please report an issue at https://github.com/Effect-TS/effect/issues");
      } else {
        return hook;
      }
    }
    getCounter(key) {
      let value = pipe(this.map, get12(key), getOrUndefined);
      if (value == null) {
        const counter5 = counter4(key);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set5(key, counter5));
        }
        value = counter5;
      }
      return value;
    }
    getFrequency(key) {
      let value = pipe(this.map, get12(key), getOrUndefined);
      if (value == null) {
        const frequency4 = frequency3(key);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set5(key, frequency4));
        }
        value = frequency4;
      }
      return value;
    }
    getGauge(key) {
      let value = pipe(this.map, get12(key), getOrUndefined);
      if (value == null) {
        const gauge4 = gauge3(key, key.keyType.bigint ? BigInt(0) : 0);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set5(key, gauge4));
        }
        value = gauge4;
      }
      return value;
    }
    getHistogram(key) {
      let value = pipe(this.map, get12(key), getOrUndefined);
      if (value == null) {
        const histogram5 = histogram4(key);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set5(key, histogram5));
        }
        value = histogram5;
      }
      return value;
    }
    getSummary(key) {
      let value = pipe(this.map, get12(key), getOrUndefined);
      if (value == null) {
        const summary4 = summary3(key);
        if (!pipe(this.map, has4(key))) {
          pipe(this.map, set5(key, summary4));
        }
        value = summary4;
      }
      return value;
    }
  };
});

// node_modules/effect/dist/esm/internal/metric.js
var MetricSymbolKey = "effect/Metric", MetricTypeId, metricVariance, globalMetricRegistry, make30 = function(keyType, unsafeUpdate, unsafeValue, unsafeModify) {
  const metric = Object.assign((effect) => tap2(effect, (a) => update4(metric, a)), {
    [MetricTypeId]: metricVariance,
    keyType,
    unsafeUpdate,
    unsafeValue,
    unsafeModify,
    register() {
      this.unsafeValue([]);
      return this;
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  });
  return metric;
}, counter5 = (name, options) => fromMetricKey(counter2(name, options)), fromMetricKey = (key) => {
  let untaggedHook;
  const hookCache = new WeakMap;
  const hook = (extraTags) => {
    if (extraTags.length === 0) {
      if (untaggedHook !== undefined) {
        return untaggedHook;
      }
      untaggedHook = globalMetricRegistry.get(key);
      return untaggedHook;
    }
    let hook2 = hookCache.get(extraTags);
    if (hook2 !== undefined) {
      return hook2;
    }
    hook2 = globalMetricRegistry.get(taggedWithLabels(key, extraTags));
    hookCache.set(extraTags, hook2);
    return hook2;
  };
  return make30(key.keyType, (input, extraTags) => hook(extraTags).update(input), (extraTags) => hook(extraTags).get(), (input, extraTags) => hook(extraTags).modify(input));
}, histogram5 = (name, boundaries, description) => fromMetricKey(histogram2(name, boundaries, description)), tagged, taggedWithLabels2, update4;
var init_metric = __esm(() => {
  init_Array();
  init_Function();
  init_Pipeable();
  init_core();
  init_key();
  init_label();
  init_registry();
  MetricTypeId = /* @__PURE__ */ Symbol.for(MetricSymbolKey);
  metricVariance = {
    _Type: (_) => _,
    _In: (_) => _,
    _Out: (_) => _
  };
  globalMetricRegistry = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Metric/globalMetricRegistry"), () => make29());
  tagged = /* @__PURE__ */ dual(3, (self, key, value) => taggedWithLabels2(self, [make27(key, value)]));
  taggedWithLabels2 = /* @__PURE__ */ dual(2, (self, extraTags) => {
    return make30(self.keyType, (input, extraTags1) => self.unsafeUpdate(input, union(extraTags, extraTags1)), (extraTags1) => self.unsafeValue(union(extraTags, extraTags1)), (input, extraTags1) => self.unsafeModify(input, union(extraTags, extraTags1)));
  });
  update4 = /* @__PURE__ */ dual(2, (self, input) => fiberRefGetWith(currentMetricLabels, (tags) => sync(() => self.unsafeUpdate(input, tags))));
});

// node_modules/effect/dist/esm/internal/request.js
class Listeners {
  count = 0;
  observers = /* @__PURE__ */ new Set;
  interrupted = false;
  addObserver(f) {
    this.observers.add(f);
  }
  removeObserver(f) {
    this.observers.delete(f);
  }
  increment() {
    this.count++;
    this.observers.forEach((f) => f(this.count));
  }
  decrement() {
    this.count--;
    this.observers.forEach((f) => f(this.count));
  }
}
var RequestSymbolKey = "effect/Request", RequestTypeId, requestVariance, RequestPrototype, isRequest = (u) => hasProperty(u, RequestTypeId), complete;
var init_request = __esm(() => {
  init_Function();
  init_Predicate();
  init_completedRequestMap();
  init_core();
  init_effectable();
  RequestTypeId = /* @__PURE__ */ Symbol.for(RequestSymbolKey);
  requestVariance = {
    _E: (_) => _,
    _A: (_) => _
  };
  RequestPrototype = {
    ...StructuralPrototype,
    [RequestTypeId]: requestVariance
  };
  complete = /* @__PURE__ */ dual(2, (self, result) => fiberRefGetWith(currentRequestMap, (map11) => sync(() => {
    if (map11.has(self)) {
      const entry = map11.get(self);
      if (!entry.state.completed) {
        entry.state.completed = true;
        deferredUnsafeDone(entry.result, result);
      }
    }
  })));
});

// node_modules/effect/dist/esm/internal/supervisor.js
var SupervisorSymbolKey = "effect/Supervisor", SupervisorTypeId, supervisorVariance, ProxySupervisor, Zip, isZip = (self) => hasProperty(self, SupervisorTypeId) && isTagged(self, "Zip"), Track, Const, unsafeTrack = () => {
  return new Track;
}, track, fromEffect = (effect) => {
  return new Const(effect);
}, none8;
var init_supervisor = __esm(() => {
  init_Function();
  init_Predicate();
  init_core();
  SupervisorTypeId = /* @__PURE__ */ Symbol.for(SupervisorSymbolKey);
  supervisorVariance = {
    _T: (_) => _
  };
  ProxySupervisor = class ProxySupervisor {
    underlying;
    value0;
    [SupervisorTypeId] = supervisorVariance;
    constructor(underlying, value0) {
      this.underlying = underlying;
      this.value0 = value0;
    }
    get value() {
      return this.value0;
    }
    onStart(context2, effect, parent, fiber) {
      this.underlying.onStart(context2, effect, parent, fiber);
    }
    onEnd(value, fiber) {
      this.underlying.onEnd(value, fiber);
    }
    onEffect(fiber, effect) {
      this.underlying.onEffect(fiber, effect);
    }
    onSuspend(fiber) {
      this.underlying.onSuspend(fiber);
    }
    onResume(fiber) {
      this.underlying.onResume(fiber);
    }
    map(f) {
      return new ProxySupervisor(this, pipe(this.value, map8(f)));
    }
    zip(right3) {
      return new Zip(this, right3);
    }
  };
  Zip = class Zip {
    left;
    right;
    _tag = "Zip";
    [SupervisorTypeId] = supervisorVariance;
    constructor(left3, right3) {
      this.left = left3;
      this.right = right3;
    }
    get value() {
      return zip2(this.left.value, this.right.value);
    }
    onStart(context2, effect, parent, fiber) {
      this.left.onStart(context2, effect, parent, fiber);
      this.right.onStart(context2, effect, parent, fiber);
    }
    onEnd(value, fiber) {
      this.left.onEnd(value, fiber);
      this.right.onEnd(value, fiber);
    }
    onEffect(fiber, effect) {
      this.left.onEffect(fiber, effect);
      this.right.onEffect(fiber, effect);
    }
    onSuspend(fiber) {
      this.left.onSuspend(fiber);
      this.right.onSuspend(fiber);
    }
    onResume(fiber) {
      this.left.onResume(fiber);
      this.right.onResume(fiber);
    }
    map(f) {
      return new ProxySupervisor(this, pipe(this.value, map8(f)));
    }
    zip(right3) {
      return new Zip(this, right3);
    }
  };
  Track = class Track {
    [SupervisorTypeId] = supervisorVariance;
    fibers = /* @__PURE__ */ new Set;
    get value() {
      return sync(() => Array.from(this.fibers));
    }
    onStart(_context, _effect, _parent, fiber) {
      this.fibers.add(fiber);
    }
    onEnd(_value, fiber) {
      this.fibers.delete(fiber);
    }
    onEffect(_fiber, _effect) {}
    onSuspend(_fiber) {}
    onResume(_fiber) {}
    map(f) {
      return new ProxySupervisor(this, pipe(this.value, map8(f)));
    }
    zip(right3) {
      return new Zip(this, right3);
    }
    onRun(execution, _fiber) {
      return execution();
    }
  };
  Const = class Const {
    effect;
    [SupervisorTypeId] = supervisorVariance;
    constructor(effect) {
      this.effect = effect;
    }
    get value() {
      return this.effect;
    }
    onStart(_context, _effect, _parent, _fiber) {}
    onEnd(_value, _fiber) {}
    onEffect(_fiber, _effect) {}
    onSuspend(_fiber) {}
    onResume(_fiber) {}
    map(f) {
      return new ProxySupervisor(this, pipe(this.value, map8(f)));
    }
    zip(right3) {
      return new Zip(this, right3);
    }
    onRun(execution, _fiber) {
      return execution();
    }
  };
  track = /* @__PURE__ */ sync(unsafeTrack);
  none8 = /* @__PURE__ */ globalValue("effect/Supervisor/none", () => fromEffect(void_2));
});

// node_modules/effect/dist/esm/Differ.js
var make31;
var init_Differ = __esm(() => {
  init_differ();
  make31 = make14;
});

// node_modules/effect/dist/esm/internal/supervisor/patch.js
var OP_EMPTY3 = "Empty", OP_ADD_SUPERVISOR = "AddSupervisor", OP_REMOVE_SUPERVISOR = "RemoveSupervisor", OP_AND_THEN2 = "AndThen", empty23, combine8 = (self, that) => {
  return {
    _tag: OP_AND_THEN2,
    first: self,
    second: that
  };
}, patch8 = (self, supervisor) => {
  return patchLoop(supervisor, of2(self));
}, patchLoop = (_supervisor, _patches) => {
  let supervisor = _supervisor;
  let patches = _patches;
  while (isNonEmpty(patches)) {
    const head4 = headNonEmpty2(patches);
    switch (head4._tag) {
      case OP_EMPTY3: {
        patches = tailNonEmpty2(patches);
        break;
      }
      case OP_ADD_SUPERVISOR: {
        supervisor = supervisor.zip(head4.supervisor);
        patches = tailNonEmpty2(patches);
        break;
      }
      case OP_REMOVE_SUPERVISOR: {
        supervisor = removeSupervisor(supervisor, head4.supervisor);
        patches = tailNonEmpty2(patches);
        break;
      }
      case OP_AND_THEN2: {
        patches = prepend2(head4.first)(prepend2(head4.second)(tailNonEmpty2(patches)));
        break;
      }
    }
  }
  return supervisor;
}, removeSupervisor = (self, that) => {
  if (equals(self, that)) {
    return none8;
  } else {
    if (isZip(self)) {
      return removeSupervisor(self.left, that).zip(removeSupervisor(self.right, that));
    } else {
      return self;
    }
  }
}, toSet2 = (self) => {
  if (equals(self, none8)) {
    return empty5();
  } else {
    if (isZip(self)) {
      return pipe(toSet2(self.left), union3(toSet2(self.right)));
    } else {
      return make7(self);
    }
  }
}, diff7 = (oldValue, newValue) => {
  if (equals(oldValue, newValue)) {
    return empty23;
  }
  const oldSupervisors = toSet2(oldValue);
  const newSupervisors = toSet2(newValue);
  const added = pipe(newSupervisors, difference3(oldSupervisors), reduce4(empty23, (patch9, supervisor) => combine8(patch9, {
    _tag: OP_ADD_SUPERVISOR,
    supervisor
  })));
  const removed = pipe(oldSupervisors, difference3(newSupervisors), reduce4(empty23, (patch9, supervisor) => combine8(patch9, {
    _tag: OP_REMOVE_SUPERVISOR,
    supervisor
  })));
  return combine8(added, removed);
}, differ2;
var init_patch2 = __esm(() => {
  init_Chunk();
  init_Differ();
  init_Equal();
  init_Function();
  init_HashSet();
  init_supervisor();
  empty23 = {
    _tag: OP_EMPTY3
  };
  differ2 = /* @__PURE__ */ make31({
    empty: empty23,
    patch: patch8,
    combine: combine8,
    diff: diff7
  });
});

// node_modules/effect/dist/esm/internal/fiberRuntime.js
var fiberStarted, fiberActive, fiberSuccesses, fiberFailures, fiberLifetimes, EvaluationSignalContinue = "Continue", EvaluationSignalDone = "Done", EvaluationSignalYieldNow = "Yield", runtimeFiberVariance, absurd = (_) => {
  throw new Error(`BUG: FiberRuntime - ${toStringUnknown(_)} - please report an issue at https://github.com/Effect-TS/effect/issues`);
}, YieldedOp, yieldedOpChannel, contOpSuccess, drainQueueWhileRunningTable, runBlockedRequests = (self) => forEachSequentialDiscard(flatten4(self), (requestsByRequestResolver) => forEachConcurrentDiscard(sequentialCollectionToChunk(requestsByRequestResolver), ([dataSource, sequential5]) => {
  const map11 = new Map;
  const arr = [];
  for (const block of sequential5) {
    arr.push(toReadonlyArray(block));
    for (const entry of block) {
      map11.set(entry.request, entry);
    }
  }
  const flat = arr.flat();
  return fiberRefLocally(invokeWithInterrupt(dataSource.runAll(arr), flat, () => flat.forEach((entry) => {
    entry.listeners.interrupted = true;
  })), currentRequestMap, map11);
}, false, false)), _version, FiberRuntime, currentMinimumLogLevel, loggerWithConsoleLog = (self) => makeLogger((opts) => {
  const services = getOrDefault2(opts.context, currentServices);
  get5(services, consoleTag).unsafe.log(self.log(opts));
}), defaultLogger, tracerLogger, currentLoggers, annotateLogsScoped = function() {
  if (typeof arguments[0] === "string") {
    return fiberRefLocallyScopedWith(currentLogAnnotations, set3(arguments[0], arguments[1]));
  }
  const entries2 = Object.entries(arguments[0]);
  return fiberRefLocallyScopedWith(currentLogAnnotations, mutate3((annotations) => {
    for (let i = 0;i < entries2.length; i++) {
      const [key, value] = entries2[i];
      set3(annotations, key, value);
    }
    return annotations;
  }));
}, whenLogLevel, acquireRelease, acquireReleaseInterruptible, addFinalizer = (finalizer) => withFiberRuntime((runtime2) => {
  const acquireRefs = runtime2.getFiberRefs();
  const acquireFlags = disable2(runtime2.currentRuntimeFlags, Interruption);
  return flatMap7(scope, (scope) => scopeAddFinalizerExit(scope, (exit2) => withFiberRuntime((runtimeFinalizer) => {
    const preRefs = runtimeFinalizer.getFiberRefs();
    const preFlags = runtimeFinalizer.currentRuntimeFlags;
    const patchRefs = diff6(preRefs, acquireRefs);
    const patchFlags = diff4(preFlags, acquireFlags);
    const inverseRefs = diff6(acquireRefs, preRefs);
    runtimeFinalizer.setFiberRefs(patch7(patchRefs, runtimeFinalizer.id(), acquireRefs));
    return ensuring(withRuntimeFlags(finalizer(exit2), patchFlags), sync(() => {
      runtimeFinalizer.setFiberRefs(patch7(inverseRefs, runtimeFinalizer.id(), runtimeFinalizer.getFiberRefs()));
    }));
  })));
}), daemonChildren = (self) => {
  const forkScope = fiberRefLocally(currentForkScopeOverride, some2(globalScope));
  return forkScope(self);
}, _existsParFound, exists3, existsLoop = (iterator, index, f) => {
  const next = iterator.next();
  if (next.done) {
    return succeed(false);
  }
  return flatMap7(f(next.value, index), (b) => b ? succeed(b) : existsLoop(iterator, index + 1, f));
}, filter7, allResolveInput = (input) => {
  if (Array.isArray(input) || isIterable(input)) {
    return [input, none2()];
  }
  const keys3 = Object.keys(input);
  const size7 = keys3.length;
  return [keys3.map((k) => input[k]), some2((values3) => {
    const res = {};
    for (let i = 0;i < size7; i++) {
      res[keys3[i]] = values3[i];
    }
    return res;
  })];
}, allValidate = (effects, reconcile, options) => {
  const eitherEffects = [];
  for (const effect of effects) {
    eitherEffects.push(either2(effect));
  }
  return flatMap7(forEach4(eitherEffects, identity, {
    concurrency: options?.concurrency,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), (eithers) => {
    const none9 = none2();
    const size7 = eithers.length;
    const errors = new Array(size7);
    const successes = new Array(size7);
    let errored = false;
    for (let i = 0;i < size7; i++) {
      const either3 = eithers[i];
      if (either3._tag === "Left") {
        errors[i] = some2(either3.left);
        errored = true;
      } else {
        successes[i] = either3.right;
        errors[i] = none9;
      }
    }
    if (errored) {
      return reconcile._tag === "Some" ? fail2(reconcile.value(errors)) : fail2(errors);
    } else if (options?.discard) {
      return void_2;
    }
    return reconcile._tag === "Some" ? succeed(reconcile.value(successes)) : succeed(successes);
  });
}, allEither = (effects, reconcile, options) => {
  const eitherEffects = [];
  for (const effect of effects) {
    eitherEffects.push(either2(effect));
  }
  if (options?.discard) {
    return forEach4(eitherEffects, identity, {
      concurrency: options?.concurrency,
      batching: options?.batching,
      discard: true,
      concurrentFinalizers: options?.concurrentFinalizers
    });
  }
  return map8(forEach4(eitherEffects, identity, {
    concurrency: options?.concurrency,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), (eithers) => reconcile._tag === "Some" ? reconcile.value(eithers) : eithers);
}, all3 = (arg, options) => {
  const [effects, reconcile] = allResolveInput(arg);
  if (options?.mode === "validate") {
    return allValidate(effects, reconcile, options);
  } else if (options?.mode === "either") {
    return allEither(effects, reconcile, options);
  }
  return options?.discard !== true && reconcile._tag === "Some" ? map8(forEach4(effects, identity, options), reconcile.value) : forEach4(effects, identity, options);
}, allWith = (options) => (arg) => all3(arg, options), allSuccesses = (elements, options) => map8(all3(fromIterable2(elements).map(exit), options), filterMap2((exit2) => exitIsSuccess(exit2) ? some2(exit2.effect_instruction_i0) : none2())), replicate, replicateEffect, forEach4, forEachParUnbounded = (self, f, batching) => suspend(() => {
  const as6 = fromIterable2(self);
  const array3 = new Array(as6.length);
  const fn = (a, i) => flatMap7(f(a, i), (b) => sync(() => array3[i] = b));
  return zipRight2(forEachConcurrentDiscard(as6, fn, batching, false), succeed(array3));
}), forEachConcurrentDiscard = (self, f, batching, processAll, n) => uninterruptibleMask((restore) => transplant((graft) => withFiberRuntime((parent) => {
  let todos = Array.from(self).reverse();
  let target = todos.length;
  if (target === 0) {
    return void_2;
  }
  let counter6 = 0;
  let interrupted = false;
  const fibersCount = n ? Math.min(todos.length, n) : todos.length;
  const fibers = new Set;
  const results = new Array;
  const interruptAll = () => fibers.forEach((fiber) => {
    fiber.currentScheduler.scheduleTask(() => {
      fiber.unsafeInterruptAsFork(parent.id());
    }, 0, fiber);
  });
  const startOrder = new Array;
  const joinOrder = new Array;
  const residual = new Array;
  const collectExits = () => {
    const exits = results.filter(({
      exit: exit2
    }) => exit2._tag === "Failure").sort((a, b) => a.index < b.index ? -1 : a.index === b.index ? 0 : 1).map(({
      exit: exit2
    }) => exit2);
    if (exits.length === 0) {
      exits.push(exitVoid);
    }
    return exits;
  };
  const runFiber = (eff, interruptImmediately = false) => {
    const runnable = uninterruptible(graft(eff));
    const fiber = unsafeForkUnstarted(runnable, parent, parent.currentRuntimeFlags, globalScope);
    parent.currentScheduler.scheduleTask(() => {
      if (interruptImmediately) {
        fiber.unsafeInterruptAsFork(parent.id());
      }
      fiber.resume(runnable);
    }, 0, fiber);
    return fiber;
  };
  const onInterruptSignal = () => {
    if (!processAll) {
      target -= todos.length;
      todos = [];
    }
    interrupted = true;
    interruptAll();
  };
  const stepOrExit = batching ? step2 : exit;
  const processingFiber = runFiber(async_((resume2) => {
    const pushResult = (res, index) => {
      if (res._op === "Blocked") {
        residual.push(res);
      } else {
        results.push({
          index,
          exit: res
        });
        if (res._op === "Failure" && !interrupted) {
          onInterruptSignal();
        }
      }
    };
    const next = () => {
      if (todos.length > 0) {
        const a = todos.pop();
        let index = counter6++;
        const returnNextElement = () => {
          const a2 = todos.pop();
          index = counter6++;
          return flatMap7(yieldNow(), () => flatMap7(stepOrExit(restore(f(a2, index))), onRes));
        };
        const onRes = (res) => {
          if (todos.length > 0) {
            pushResult(res, index);
            if (todos.length > 0) {
              return returnNextElement();
            }
          }
          return succeed(res);
        };
        const todo = flatMap7(stepOrExit(restore(f(a, index))), onRes);
        const fiber = runFiber(todo);
        startOrder.push(fiber);
        fibers.add(fiber);
        if (interrupted) {
          fiber.currentScheduler.scheduleTask(() => {
            fiber.unsafeInterruptAsFork(parent.id());
          }, 0, fiber);
        }
        fiber.addObserver((wrapped) => {
          let exit2;
          if (wrapped._op === "Failure") {
            exit2 = wrapped;
          } else {
            exit2 = wrapped.effect_instruction_i0;
          }
          joinOrder.push(fiber);
          fibers.delete(fiber);
          pushResult(exit2, index);
          if (results.length === target) {
            resume2(succeed(getOrElse(exitCollectAll(collectExits(), {
              parallel: true
            }), () => exitVoid)));
          } else if (residual.length + results.length === target) {
            const exits = collectExits();
            const requests = residual.map((blocked2) => blocked2.effect_instruction_i0).reduce(par);
            resume2(succeed(blocked(requests, forEachConcurrentDiscard([getOrElse(exitCollectAll(exits, {
              parallel: true
            }), () => exitVoid), ...residual.map((blocked2) => blocked2.effect_instruction_i1)], (i) => i, batching, true, n))));
          } else {
            next();
          }
        });
      }
    };
    for (let i = 0;i < fibersCount; i++) {
      next();
    }
  }));
  return asVoid2(onExit(flatten5(restore(join2(processingFiber))), exitMatch({
    onFailure: (cause2) => {
      onInterruptSignal();
      const target2 = residual.length + 1;
      const concurrency = Math.min(typeof n === "number" ? n : residual.length, residual.length);
      const toPop = Array.from(residual);
      return async_((cb) => {
        const exits = [];
        let count = 0;
        let index = 0;
        const check = (index2, hitNext) => (exit2) => {
          exits[index2] = exit2;
          count++;
          if (count === target2) {
            cb(exitSucceed(exitFailCause(cause2)));
          }
          if (toPop.length > 0 && hitNext) {
            next();
          }
        };
        const next = () => {
          runFiber(toPop.pop(), true).addObserver(check(index, true));
          index++;
        };
        processingFiber.addObserver(check(index, false));
        index++;
        for (let i = 0;i < concurrency; i++) {
          next();
        }
      });
    },
    onSuccess: () => forEachSequential(joinOrder, (f2) => f2.inheritAll)
  })));
}))), forEachParN = (self, n, f, batching) => suspend(() => {
  const as6 = fromIterable2(self);
  const array3 = new Array(as6.length);
  const fn = (a, i) => map8(f(a, i), (b) => array3[i] = b);
  return zipRight2(forEachConcurrentDiscard(as6, fn, batching, false, n), succeed(array3));
}), fork = (self) => withFiberRuntime((state, status) => succeed(unsafeFork(self, state, status.runtimeFlags))), forkDaemon = (self) => forkWithScopeOverride(self, globalScope), forkWithErrorHandler, unsafeFork = (effect, parentFiber, parentRuntimeFlags, overrideScope = null) => {
  const childFiber = unsafeMakeChildFiber(effect, parentFiber, parentRuntimeFlags, overrideScope);
  childFiber.resume(effect);
  return childFiber;
}, unsafeForkUnstarted = (effect, parentFiber, parentRuntimeFlags, overrideScope = null) => {
  const childFiber = unsafeMakeChildFiber(effect, parentFiber, parentRuntimeFlags, overrideScope);
  return childFiber;
}, unsafeMakeChildFiber = (effect, parentFiber, parentRuntimeFlags, overrideScope = null) => {
  const childId = unsafeMake3();
  const parentFiberRefs = parentFiber.getFiberRefs();
  const childFiberRefs = forkAs(parentFiberRefs, childId);
  const childFiber = new FiberRuntime(childId, childFiberRefs, parentRuntimeFlags);
  const childContext = getOrDefault(childFiberRefs, currentContext);
  const supervisor = childFiber.currentSupervisor;
  supervisor.onStart(childContext, effect, some2(parentFiber), childFiber);
  childFiber.addObserver((exit2) => supervisor.onEnd(exit2, childFiber));
  const parentScope = overrideScope !== null ? overrideScope : pipe(parentFiber.getFiberRef(currentForkScopeOverride), getOrElse(() => parentFiber.scope()));
  parentScope.add(parentRuntimeFlags, childFiber);
  return childFiber;
}, forkWithScopeOverride = (self, scopeOverride) => withFiberRuntime((parentFiber, parentStatus) => succeed(unsafeFork(self, parentFiber, parentStatus.runtimeFlags, scopeOverride))), mergeAll3, partition3, validateAll, raceAll = (all4) => withFiberRuntime((state, status) => async_((resume2) => {
  const fibers = new Set;
  let winner;
  let failures3 = empty6;
  const interruptAll = () => {
    for (const fiber of fibers) {
      fiber.unsafeInterruptAsFork(state.id());
    }
  };
  let latch = false;
  let empty24 = true;
  for (const self of all4) {
    empty24 = false;
    const fiber = unsafeFork(interruptible2(self), state, status.runtimeFlags);
    fibers.add(fiber);
    fiber.addObserver((exit2) => {
      fibers.delete(fiber);
      if (!winner) {
        if (exit2._tag === "Success") {
          latch = true;
          winner = fiber;
          failures3 = empty6;
          interruptAll();
        } else {
          failures3 = parallel(exit2.cause, failures3);
        }
      }
      if (latch && fibers.size === 0) {
        resume2(winner ? zipRight2(inheritAll(winner), winner.unsafePoll()) : failCause(failures3));
      }
    });
    if (winner)
      break;
  }
  if (empty24) {
    return resume2(dieSync(() => new IllegalArgumentException(`Received an empty collection of effects`)));
  }
  latch = true;
  return interruptAllAs(fibers, state.id());
})), reduceEffect, parallelFinalizers = (self) => contextWithEffect((context2) => match2(getOption2(context2, scopeTag), {
  onNone: () => self,
  onSome: (scope) => {
    switch (scope.strategy._tag) {
      case "Parallel":
        return self;
      case "Sequential":
      case "ParallelN":
        return flatMap7(scopeFork(scope, parallel4), (inner) => scopeExtend(self, inner));
    }
  }
})), parallelNFinalizers = (parallelism) => (self) => contextWithEffect((context2) => match2(getOption2(context2, scopeTag), {
  onNone: () => self,
  onSome: (scope) => {
    if (scope.strategy._tag === "ParallelN" && scope.strategy.parallelism === parallelism) {
      return self;
    }
    return flatMap7(scopeFork(scope, parallelN2(parallelism)), (inner) => scopeExtend(self, inner));
  }
})), finalizersMask = (strategy) => (self) => finalizersMaskInternal(strategy, true)(self), finalizersMaskInternal = (strategy, concurrentFinalizers) => (self) => contextWithEffect((context2) => match2(getOption2(context2, scopeTag), {
  onNone: () => self(identity),
  onSome: (scope) => {
    if (concurrentFinalizers === true) {
      const patch9 = strategy._tag === "Parallel" ? parallelFinalizers : strategy._tag === "Sequential" ? sequentialFinalizers : parallelNFinalizers(strategy.parallelism);
      switch (scope.strategy._tag) {
        case "Parallel":
          return patch9(self(parallelFinalizers));
        case "Sequential":
          return patch9(self(sequentialFinalizers));
        case "ParallelN":
          return patch9(self(parallelNFinalizers(scope.strategy.parallelism)));
      }
    } else {
      return self(identity);
    }
  }
})), scopeWith = (f) => flatMap7(scopeTag, f), scopedWith = (f) => flatMap7(scopeMake(), (scope) => onExit(f(scope), (exit2) => scope.close(exit2))), scopedEffect = (effect) => flatMap7(scopeMake(), (scope) => scopeUse(effect, scope)), sequentialFinalizers = (self) => contextWithEffect((context2) => match2(getOption2(context2, scopeTag), {
  onNone: () => self,
  onSome: (scope) => {
    switch (scope.strategy._tag) {
      case "Sequential":
        return self;
      case "Parallel":
      case "ParallelN":
        return flatMap7(scopeFork(scope, sequential4), (inner) => scopeExtend(self, inner));
    }
  }
})), tagMetricsScoped = (key, value) => labelMetricsScoped([make27(key, value)]), labelMetricsScoped = (labels) => fiberRefLocallyScopedWith(currentMetricLabels, (old) => union(old, labels)), using, validate, validateWith, validateFirst, withClockScoped = (c) => fiberRefLocallyScopedWith(currentServices, add4(clockTag, c)), withRandomScoped = (value) => fiberRefLocallyScopedWith(currentServices, add4(randomTag, value)), withConfigProviderScoped = (provider) => fiberRefLocallyScopedWith(currentServices, add4(configProviderTag, provider)), withEarlyRelease = (self) => scopeWith((parent) => flatMap7(scopeFork(parent, sequential3), (child) => pipe(self, scopeExtend(child), map8((value) => [fiberIdWith((fiberId2) => scopeClose(child, exitInterrupt(fiberId2))), value])))), zipOptions, zipLeftOptions, zipRightOptions, zipWithOptions, withRuntimeFlagsScoped = (update5) => {
  if (update5 === empty15) {
    return void_2;
  }
  return pipe(runtimeFlags, flatMap7((runtimeFlags2) => {
    const updatedRuntimeFlags = patch4(runtimeFlags2, update5);
    const revertRuntimeFlags = diff4(updatedRuntimeFlags, runtimeFlags2);
    return pipe(updateRuntimeFlags(update5), zipRight2(addFinalizer(() => updateRuntimeFlags(revertRuntimeFlags))), asVoid2);
  }), uninterruptible);
}, scopeTag, scope, scopeUnsafeAddFinalizer = (scope2, fin) => {
  if (scope2.state._tag === "Open") {
    scope2.state.finalizers.set({}, fin);
  }
}, ScopeImplProto, scopeUnsafeMake = (strategy = sequential3) => {
  const scope2 = Object.create(ScopeImplProto);
  scope2.strategy = strategy;
  scope2.state = {
    _tag: "Open",
    finalizers: new Map
  };
  return scope2;
}, scopeMake = (strategy = sequential3) => sync(() => scopeUnsafeMake(strategy)), scopeExtend, scopeUse, fiberRefUnsafeMakeSupervisor = (initial) => fiberRefUnsafeMakePatch(initial, {
  differ: differ2,
  fork: empty23
}), fiberRefLocallyScoped, fiberRefLocallyScopedWith, currentRuntimeFlags, currentSupervisor, fiberAwaitAll = (fibers) => forEach4(fibers, _await2), fiberAll = (fibers) => {
  const _fiberAll = {
    ...CommitPrototype2,
    commit() {
      return join2(this);
    },
    [FiberTypeId]: fiberVariance2,
    id: () => fromIterable2(fibers).reduce((id, fiber) => combine3(id, fiber.id()), none4),
    await: exit(forEachParUnbounded(fibers, (fiber) => flatten5(fiber.await), false)),
    children: map8(forEachParUnbounded(fibers, (fiber) => fiber.children, false), flatten2),
    inheritAll: forEachSequentialDiscard(fibers, (fiber) => fiber.inheritAll),
    poll: map8(forEachSequential(fibers, (fiber) => fiber.poll), reduceRight(some2(exitSucceed(new Array)), (optionB, optionA) => {
      switch (optionA._tag) {
        case "None": {
          return none2();
        }
        case "Some": {
          switch (optionB._tag) {
            case "None": {
              return none2();
            }
            case "Some": {
              return some2(exitZipWith(optionA.value, optionB.value, {
                onSuccess: (a, chunk2) => [a, ...chunk2],
                onFailure: parallel
              }));
            }
          }
        }
      }
    })),
    interruptAsFork: (fiberId2) => forEachSequentialDiscard(fibers, (fiber) => fiber.interruptAsFork(fiberId2))
  };
  return _fiberAll;
}, raceWith, disconnect = (self) => uninterruptibleMask((restore) => fiberIdWith((fiberId2) => flatMap7(forkDaemon(restore(self)), (fiber) => pipe(restore(join2(fiber)), onInterrupt(() => pipe(fiber, interruptAsFork(fiberId2))))))), race, raceFibersWith, completeRace = (winner, loser, cont, ab, cb) => {
  if (compareAndSet(true, false)(ab)) {
    cb(cont(winner, loser));
  }
}, ensuring, invokeWithInterrupt = (self, entries2, onInterrupt2) => fiberIdWith((id) => ensuring(flatMap7(forkDaemon(interruptible2(self)), (processing) => async_((cb) => {
  const counts = entries2.map((_) => _.listeners.count);
  const checkDone = () => {
    if (counts.every((count) => count === 0)) {
      if (entries2.every((_) => {
        if (_.result.state.current._tag === "Pending") {
          return true;
        } else if (_.result.state.current._tag === "Done" && exitIsExit(_.result.state.current.effect) && _.result.state.current.effect._tag === "Failure" && isInterrupted(_.result.state.current.effect.cause)) {
          return true;
        } else {
          return false;
        }
      })) {
        cleanup.forEach((f) => f());
        onInterrupt2?.();
        cb(interruptFiber(processing));
      }
    }
  };
  processing.addObserver((exit2) => {
    cleanup.forEach((f) => f());
    cb(exit2);
  });
  const cleanup = entries2.map((r, i) => {
    const observer = (count) => {
      counts[i] = count;
      checkDone();
    };
    r.listeners.addObserver(observer);
    return () => r.listeners.removeObserver(observer);
  });
  checkDone();
  return sync(() => {
    cleanup.forEach((f) => f());
  });
})), suspend(() => {
  const residual = entries2.flatMap((entry) => {
    if (!entry.state.completed) {
      return [entry];
    }
    return [];
  });
  return forEachSequentialDiscard(residual, (entry) => complete(entry.request, exitInterrupt(id)));
}))), makeSpanScoped = (name, options) => {
  options = addSpanStackTrace(options);
  return uninterruptible(withFiberRuntime((fiber) => {
    const scope2 = unsafeGet4(fiber.getFiberRef(currentContext), scopeTag);
    const span2 = unsafeMakeSpan(fiber, name, options);
    const timingEnabled = fiber.getFiberRef(currentTracerTimingEnabled);
    const clock_ = get5(fiber.getFiberRef(currentServices), clockTag);
    return as3(scopeAddFinalizerExit(scope2, (exit2) => endSpan(span2, exit2, clock_, timingEnabled)), span2);
  }));
}, withTracerScoped = (value) => fiberRefLocallyScopedWith(currentServices, add4(tracerTag, value)), withSpanScoped = function() {
  const dataFirst = typeof arguments[0] !== "string";
  const name = dataFirst ? arguments[1] : arguments[0];
  const options = addSpanStackTrace(dataFirst ? arguments[2] : arguments[1]);
  if (dataFirst) {
    const self = arguments[0];
    return flatMap7(makeSpanScoped(name, addSpanStackTrace(options)), (span2) => provideService(self, spanTag, span2));
  }
  return (self) => flatMap7(makeSpanScoped(name, addSpanStackTrace(options)), (span2) => provideService(self, spanTag, span2));
};
var init_fiberRuntime = __esm(() => {
  init_Array();
  init_Boolean();
  init_Chunk();
  init_Context();
  init_Effectable();
  init_ExecutionStrategy();
  init_FiberId();
  init_FiberRefs();
  init_FiberRefsPatch();
  init_FiberStatus();
  init_Function();
  init_HashMap();
  init_HashSet();
  init_Inspectable();
  init_LogLevel();
  init_Micro();
  init_MutableRef();
  init_Option();
  init_Pipeable();
  init_Predicate();
  init_Ref();
  init_RuntimeFlagsPatch();
  init_Scheduler();
  init_Utils();
  init_blockedRequests();
  init_cause();
  init_clock();
  init_completedRequestMap();
  init_concurrency();
  init_configProvider();
  init_core_effect();
  init_core();
  init_defaultServices();
  init_console();
  init_executionStrategy();
  init_fiber();
  init_fiberRefs();
  init_fiberScope();
  init_logger();
  init_metric();
  init_boundaries();
  init_label();
  init_random();
  init_request();
  init_runtimeFlags();
  init_runtimeFlags();
  init_supervisor();
  init_patch2();
  init_tracer();
  fiberStarted = /* @__PURE__ */ counter5("effect_fiber_started", {
    incremental: true
  });
  fiberActive = /* @__PURE__ */ counter5("effect_fiber_active");
  fiberSuccesses = /* @__PURE__ */ counter5("effect_fiber_successes", {
    incremental: true
  });
  fiberFailures = /* @__PURE__ */ counter5("effect_fiber_failures", {
    incremental: true
  });
  fiberLifetimes = /* @__PURE__ */ tagged(/* @__PURE__ */ histogram5("effect_fiber_lifetimes", /* @__PURE__ */ exponential({
    start: 0.5,
    factor: 2,
    count: 35
  })), "time_unit", "milliseconds");
  runtimeFiberVariance = {
    _E: (_) => _,
    _A: (_) => _
  };
  YieldedOp = /* @__PURE__ */ Symbol.for("effect/internal/fiberRuntime/YieldedOp");
  yieldedOpChannel = /* @__PURE__ */ globalValue("effect/internal/fiberRuntime/yieldedOpChannel", () => ({
    currentOp: null
  }));
  contOpSuccess = {
    [OP_ON_SUCCESS]: (_, cont, value) => {
      return internalCall(() => cont.effect_instruction_i1(value));
    },
    ["OnStep"]: (_, _cont, value) => {
      return exitSucceed(exitSucceed(value));
    },
    [OP_ON_SUCCESS_AND_FAILURE]: (_, cont, value) => {
      return internalCall(() => cont.effect_instruction_i2(value));
    },
    [OP_REVERT_FLAGS]: (self, cont, value) => {
      self.patchRuntimeFlags(self.currentRuntimeFlags, cont.patch);
      if (interruptible(self.currentRuntimeFlags) && self.isInterrupted()) {
        return exitFailCause(self.getInterruptedCause());
      } else {
        return exitSucceed(value);
      }
    },
    [OP_WHILE]: (self, cont, value) => {
      internalCall(() => cont.effect_instruction_i2(value));
      if (internalCall(() => cont.effect_instruction_i0())) {
        self.pushStack(cont);
        return internalCall(() => cont.effect_instruction_i1());
      } else {
        return void_2;
      }
    },
    [OP_ITERATOR]: (self, cont, value) => {
      while (true) {
        const state = internalCall(() => cont.effect_instruction_i0.next(value));
        if (state.done) {
          return exitSucceed(state.value);
        }
        const primitive = yieldWrapGet(state.value);
        if (!exitIsExit(primitive)) {
          self.pushStack(cont);
          return primitive;
        } else if (primitive._tag === "Failure") {
          return primitive;
        }
        value = primitive.value;
      }
    }
  };
  drainQueueWhileRunningTable = {
    [OP_INTERRUPT_SIGNAL]: (self, runtimeFlags2, cur, message) => {
      self.processNewInterruptSignal(message.cause);
      return interruptible(runtimeFlags2) ? exitFailCause(message.cause) : cur;
    },
    [OP_RESUME]: (_self, _runtimeFlags, _cur, _message) => {
      throw new Error("It is illegal to have multiple concurrent run loops in a single fiber");
    },
    [OP_STATEFUL]: (self, runtimeFlags2, cur, message) => {
      message.onFiber(self, running2(runtimeFlags2));
      return cur;
    },
    [OP_YIELD_NOW]: (_self, _runtimeFlags, cur, _message) => {
      return flatMap7(yieldNow(), () => cur);
    }
  };
  _version = /* @__PURE__ */ getCurrentVersion();
  FiberRuntime = class FiberRuntime extends Class {
    [FiberTypeId] = fiberVariance2;
    [RuntimeFiberTypeId] = runtimeFiberVariance;
    _fiberRefs;
    _fiberId;
    _queue = /* @__PURE__ */ new Array;
    _children = null;
    _observers = /* @__PURE__ */ new Array;
    _running = false;
    _stack = [];
    _asyncInterruptor = null;
    _asyncBlockingOn = null;
    _exitValue = null;
    _steps = [];
    _isYielding = false;
    currentRuntimeFlags;
    currentOpCount = 0;
    currentSupervisor;
    currentScheduler;
    currentTracer;
    currentSpan;
    currentContext;
    currentDefaultServices;
    constructor(fiberId2, fiberRefs0, runtimeFlags0) {
      super();
      this.currentRuntimeFlags = runtimeFlags0;
      this._fiberId = fiberId2;
      this._fiberRefs = fiberRefs0;
      if (runtimeMetrics(runtimeFlags0)) {
        const tags = this.getFiberRef(currentMetricLabels);
        fiberStarted.unsafeUpdate(1, tags);
        fiberActive.unsafeUpdate(1, tags);
      }
      this.refreshRefCache();
    }
    commit() {
      return join2(this);
    }
    id() {
      return this._fiberId;
    }
    resume(effect) {
      this.tell(resume(effect));
    }
    get status() {
      return this.ask((_, status) => status);
    }
    get runtimeFlags() {
      return this.ask((state, status) => {
        if (isDone2(status)) {
          return state.currentRuntimeFlags;
        }
        return status.runtimeFlags;
      });
    }
    scope() {
      return unsafeMake7(this);
    }
    get children() {
      return this.ask((fiber) => Array.from(fiber.getChildren()));
    }
    getChildren() {
      if (this._children === null) {
        this._children = new Set;
      }
      return this._children;
    }
    getInterruptedCause() {
      return this.getFiberRef(currentInterruptedCause);
    }
    fiberRefs() {
      return this.ask((fiber) => fiber.getFiberRefs());
    }
    ask(f) {
      return suspend(() => {
        const deferred = deferredUnsafeMake(this._fiberId);
        this.tell(stateful((fiber, status) => {
          deferredUnsafeDone(deferred, sync(() => f(fiber, status)));
        }));
        return deferredAwait(deferred);
      });
    }
    tell(message) {
      this._queue.push(message);
      if (!this._running) {
        this._running = true;
        this.drainQueueLaterOnExecutor();
      }
    }
    get await() {
      return async_((resume2) => {
        const cb = (exit2) => resume2(succeed(exit2));
        if (this._exitValue !== null) {
          cb(this._exitValue);
          return;
        }
        this.tell(stateful((fiber, _) => {
          if (fiber._exitValue !== null) {
            cb(this._exitValue);
          } else {
            fiber.addObserver(cb);
          }
        }));
        return sync(() => this.tell(stateful((fiber, _) => {
          fiber.removeObserver(cb);
        })));
      }, this.id());
    }
    get inheritAll() {
      return withFiberRuntime((parentFiber, parentStatus) => {
        const parentFiberId = parentFiber.id();
        const parentFiberRefs = parentFiber.getFiberRefs();
        const parentRuntimeFlags = parentStatus.runtimeFlags;
        const childFiberRefs = this.getFiberRefs();
        const updatedFiberRefs = joinAs(parentFiberRefs, parentFiberId, childFiberRefs);
        parentFiber.setFiberRefs(updatedFiberRefs);
        const updatedRuntimeFlags = parentFiber.getFiberRef(currentRuntimeFlags);
        const patch9 = pipe(diff4(parentRuntimeFlags, updatedRuntimeFlags), exclude2(Interruption), exclude2(WindDown));
        return updateRuntimeFlags(patch9);
      });
    }
    get poll() {
      return sync(() => fromNullable(this._exitValue));
    }
    unsafePoll() {
      return this._exitValue;
    }
    interruptAsFork(fiberId2) {
      return sync(() => this.tell(interruptSignal(interrupt(fiberId2))));
    }
    unsafeInterruptAsFork(fiberId2) {
      this.tell(interruptSignal(interrupt(fiberId2)));
    }
    addObserver(observer) {
      if (this._exitValue !== null) {
        observer(this._exitValue);
      } else {
        this._observers.push(observer);
      }
    }
    removeObserver(observer) {
      this._observers = this._observers.filter((o) => o !== observer);
    }
    getFiberRefs() {
      this.setFiberRef(currentRuntimeFlags, this.currentRuntimeFlags);
      return this._fiberRefs;
    }
    unsafeDeleteFiberRef(fiberRef) {
      this._fiberRefs = delete_(this._fiberRefs, fiberRef);
    }
    getFiberRef(fiberRef) {
      if (this._fiberRefs.locals.has(fiberRef)) {
        return this._fiberRefs.locals.get(fiberRef)[0][1];
      }
      return fiberRef.initial;
    }
    setFiberRef(fiberRef, value) {
      this._fiberRefs = updateAs(this._fiberRefs, {
        fiberId: this._fiberId,
        fiberRef,
        value
      });
      this.refreshRefCache();
    }
    refreshRefCache() {
      this.currentDefaultServices = this.getFiberRef(currentServices);
      this.currentTracer = this.currentDefaultServices.unsafeMap.get(tracerTag.key);
      this.currentSupervisor = this.getFiberRef(currentSupervisor);
      this.currentScheduler = this.getFiberRef(currentScheduler);
      this.currentContext = this.getFiberRef(currentContext);
      this.currentSpan = this.currentContext.unsafeMap.get(spanTag.key);
    }
    setFiberRefs(fiberRefs3) {
      this._fiberRefs = fiberRefs3;
      this.refreshRefCache();
    }
    addChild(child) {
      this.getChildren().add(child);
    }
    removeChild(child) {
      this.getChildren().delete(child);
    }
    transferChildren(scope) {
      const children = this._children;
      this._children = null;
      if (children !== null && children.size > 0) {
        for (const child of children) {
          if (child._exitValue === null) {
            scope.add(this.currentRuntimeFlags, child);
          }
        }
      }
    }
    drainQueueOnCurrentThread() {
      let recurse = true;
      while (recurse) {
        let evaluationSignal = EvaluationSignalContinue;
        const prev = globalThis[currentFiberURI];
        globalThis[currentFiberURI] = this;
        try {
          while (evaluationSignal === EvaluationSignalContinue) {
            evaluationSignal = this._queue.length === 0 ? EvaluationSignalDone : this.evaluateMessageWhileSuspended(this._queue.splice(0, 1)[0]);
          }
        } finally {
          this._running = false;
          globalThis[currentFiberURI] = prev;
        }
        if (this._queue.length > 0 && !this._running) {
          this._running = true;
          if (evaluationSignal === EvaluationSignalYieldNow) {
            this.drainQueueLaterOnExecutor();
            recurse = false;
          } else {
            recurse = true;
          }
        } else {
          recurse = false;
        }
      }
    }
    drainQueueLaterOnExecutor() {
      this.currentScheduler.scheduleTask(this.run, this.getFiberRef(currentSchedulingPriority), this);
    }
    drainQueueWhileRunning(runtimeFlags2, cur0) {
      let cur = cur0;
      while (this._queue.length > 0) {
        const message = this._queue.splice(0, 1)[0];
        cur = drainQueueWhileRunningTable[message._tag](this, runtimeFlags2, cur, message);
      }
      return cur;
    }
    isInterrupted() {
      return !isEmpty3(this.getFiberRef(currentInterruptedCause));
    }
    addInterruptedCause(cause2) {
      const oldSC = this.getFiberRef(currentInterruptedCause);
      this.setFiberRef(currentInterruptedCause, sequential(oldSC, cause2));
    }
    processNewInterruptSignal(cause2) {
      this.addInterruptedCause(cause2);
      this.sendInterruptSignalToAllChildren();
    }
    sendInterruptSignalToAllChildren() {
      if (this._children === null || this._children.size === 0) {
        return false;
      }
      let told = false;
      for (const child of this._children) {
        child.tell(interruptSignal(interrupt(this.id())));
        told = true;
      }
      return told;
    }
    interruptAllChildren() {
      if (this.sendInterruptSignalToAllChildren()) {
        const it = this._children.values();
        this._children = null;
        let isDone3 = false;
        const body = () => {
          const next = it.next();
          if (!next.done) {
            return asVoid2(next.value.await);
          } else {
            return sync(() => {
              isDone3 = true;
            });
          }
        };
        return whileLoop({
          while: () => !isDone3,
          body,
          step: () => {}
        });
      }
      return null;
    }
    reportExitValue(exit2) {
      if (runtimeMetrics(this.currentRuntimeFlags)) {
        const tags = this.getFiberRef(currentMetricLabels);
        const startTimeMillis = this.id().startTimeMillis;
        const endTimeMillis = Date.now();
        fiberLifetimes.unsafeUpdate(endTimeMillis - startTimeMillis, tags);
        fiberActive.unsafeUpdate(-1, tags);
        switch (exit2._tag) {
          case OP_SUCCESS: {
            fiberSuccesses.unsafeUpdate(1, tags);
            break;
          }
          case OP_FAILURE: {
            fiberFailures.unsafeUpdate(1, tags);
            break;
          }
        }
      }
      if (exit2._tag === "Failure") {
        const level = this.getFiberRef(currentUnhandledErrorLogLevel);
        if (!isInterruptedOnly(exit2.cause) && level._tag === "Some") {
          this.log("Fiber terminated with an unhandled error", exit2.cause, level);
        }
      }
    }
    setExitValue(exit2) {
      this._exitValue = exit2;
      this.reportExitValue(exit2);
      for (let i = this._observers.length - 1;i >= 0; i--) {
        this._observers[i](exit2);
      }
      this._observers = [];
    }
    getLoggers() {
      return this.getFiberRef(currentLoggers);
    }
    log(message, cause2, overrideLogLevel) {
      const logLevel = isSome2(overrideLogLevel) ? overrideLogLevel.value : this.getFiberRef(currentLogLevel);
      const minimumLogLevel = this.getFiberRef(currentMinimumLogLevel);
      if (greaterThan2(minimumLogLevel, logLevel)) {
        return;
      }
      const spans = this.getFiberRef(currentLogSpan);
      const annotations = this.getFiberRef(currentLogAnnotations);
      const loggers = this.getLoggers();
      const contextMap = this.getFiberRefs();
      if (size3(loggers) > 0) {
        const clockService = get5(this.getFiberRef(currentServices), clockTag);
        const date = new Date(clockService.unsafeCurrentTimeMillis());
        withRedactableContext(contextMap, () => {
          for (const logger of loggers) {
            logger.log({
              fiberId: this.id(),
              logLevel,
              message,
              cause: cause2,
              context: contextMap,
              spans,
              annotations,
              date
            });
          }
        });
      }
    }
    evaluateMessageWhileSuspended(message) {
      switch (message._tag) {
        case OP_YIELD_NOW: {
          return EvaluationSignalYieldNow;
        }
        case OP_INTERRUPT_SIGNAL: {
          this.processNewInterruptSignal(message.cause);
          if (this._asyncInterruptor !== null) {
            this._asyncInterruptor(exitFailCause(message.cause));
            this._asyncInterruptor = null;
          }
          return EvaluationSignalContinue;
        }
        case OP_RESUME: {
          this._asyncInterruptor = null;
          this._asyncBlockingOn = null;
          this.evaluateEffect(message.effect);
          return EvaluationSignalContinue;
        }
        case OP_STATEFUL: {
          message.onFiber(this, this._exitValue !== null ? done4 : suspended2(this.currentRuntimeFlags, this._asyncBlockingOn));
          return EvaluationSignalContinue;
        }
        default: {
          return absurd(message);
        }
      }
    }
    evaluateEffect(effect0) {
      this.currentSupervisor.onResume(this);
      try {
        let effect = interruptible(this.currentRuntimeFlags) && this.isInterrupted() ? exitFailCause(this.getInterruptedCause()) : effect0;
        while (effect !== null) {
          const eff = effect;
          const exit2 = this.runLoop(eff);
          if (exit2 === YieldedOp) {
            const op = yieldedOpChannel.currentOp;
            yieldedOpChannel.currentOp = null;
            if (op._op === OP_YIELD) {
              if (cooperativeYielding(this.currentRuntimeFlags)) {
                this.tell(yieldNow3());
                this.tell(resume(exitVoid));
                effect = null;
              } else {
                effect = exitVoid;
              }
            } else if (op._op === OP_ASYNC) {
              effect = null;
            }
          } else {
            this.currentRuntimeFlags = pipe(this.currentRuntimeFlags, enable2(WindDown));
            const interruption2 = this.interruptAllChildren();
            if (interruption2 !== null) {
              effect = flatMap7(interruption2, () => exit2);
            } else {
              if (this._queue.length === 0) {
                this.setExitValue(exit2);
              } else {
                this.tell(resume(exit2));
              }
              effect = null;
            }
          }
        }
      } finally {
        this.currentSupervisor.onSuspend(this);
      }
    }
    start(effect) {
      if (!this._running) {
        this._running = true;
        const prev = globalThis[currentFiberURI];
        globalThis[currentFiberURI] = this;
        try {
          this.evaluateEffect(effect);
        } finally {
          this._running = false;
          globalThis[currentFiberURI] = prev;
          if (this._queue.length > 0) {
            this.drainQueueLaterOnExecutor();
          }
        }
      } else {
        this.tell(resume(effect));
      }
    }
    startFork(effect) {
      this.tell(resume(effect));
    }
    patchRuntimeFlags(oldRuntimeFlags, patch9) {
      const newRuntimeFlags = patch4(oldRuntimeFlags, patch9);
      globalThis[currentFiberURI] = this;
      this.currentRuntimeFlags = newRuntimeFlags;
      return newRuntimeFlags;
    }
    initiateAsync(runtimeFlags2, asyncRegister) {
      let alreadyCalled = false;
      const callback = (effect) => {
        if (!alreadyCalled) {
          alreadyCalled = true;
          this.tell(resume(effect));
        }
      };
      if (interruptible(runtimeFlags2)) {
        this._asyncInterruptor = callback;
      }
      try {
        asyncRegister(callback);
      } catch (e) {
        callback(failCause(die(e)));
      }
    }
    pushStack(cont) {
      this._stack.push(cont);
      if (cont._op === "OnStep") {
        this._steps.push({
          refs: this.getFiberRefs(),
          flags: this.currentRuntimeFlags
        });
      }
    }
    popStack() {
      const item = this._stack.pop();
      if (item) {
        if (item._op === "OnStep") {
          this._steps.pop();
        }
        return item;
      }
      return;
    }
    getNextSuccessCont() {
      let frame = this.popStack();
      while (frame) {
        if (frame._op !== OP_ON_FAILURE) {
          return frame;
        }
        frame = this.popStack();
      }
    }
    getNextFailCont() {
      let frame = this.popStack();
      while (frame) {
        if (frame._op !== OP_ON_SUCCESS && frame._op !== OP_WHILE && frame._op !== OP_ITERATOR) {
          return frame;
        }
        frame = this.popStack();
      }
    }
    [OP_TAG](op) {
      return sync(() => unsafeGet4(this.currentContext, op));
    }
    ["Left"](op) {
      return fail2(op.left);
    }
    ["None"](_) {
      return fail2(new NoSuchElementException);
    }
    ["Right"](op) {
      return exitSucceed(op.right);
    }
    ["Some"](op) {
      return exitSucceed(op.value);
    }
    ["Micro"](op) {
      return unsafeAsync((microResume) => {
        let resume2 = microResume;
        const fiber = runFork(provideContext2(op, this.currentContext));
        fiber.addObserver((exit2) => {
          if (exit2._tag === "Success") {
            return resume2(exitSucceed(exit2.value));
          }
          switch (exit2.cause._tag) {
            case "Interrupt": {
              return resume2(exitFailCause(interrupt(none4)));
            }
            case "Fail": {
              return resume2(fail2(exit2.cause.error));
            }
            case "Die": {
              return resume2(die2(exit2.cause.defect));
            }
          }
        });
        return unsafeAsync((abortResume) => {
          resume2 = (_) => {
            abortResume(void_2);
          };
          fiber.unsafeInterrupt();
        });
      });
    }
    [OP_SYNC](op) {
      const value = internalCall(() => op.effect_instruction_i0());
      const cont = this.getNextSuccessCont();
      if (cont !== undefined) {
        if (!(cont._op in contOpSuccess)) {
          absurd(cont);
        }
        return contOpSuccess[cont._op](this, cont, value);
      } else {
        yieldedOpChannel.currentOp = exitSucceed(value);
        return YieldedOp;
      }
    }
    [OP_SUCCESS](op) {
      const oldCur = op;
      const cont = this.getNextSuccessCont();
      if (cont !== undefined) {
        if (!(cont._op in contOpSuccess)) {
          absurd(cont);
        }
        return contOpSuccess[cont._op](this, cont, oldCur.effect_instruction_i0);
      } else {
        yieldedOpChannel.currentOp = oldCur;
        return YieldedOp;
      }
    }
    [OP_FAILURE](op) {
      const cause2 = op.effect_instruction_i0;
      const cont = this.getNextFailCont();
      if (cont !== undefined) {
        switch (cont._op) {
          case OP_ON_FAILURE:
          case OP_ON_SUCCESS_AND_FAILURE: {
            if (!(interruptible(this.currentRuntimeFlags) && this.isInterrupted())) {
              return internalCall(() => cont.effect_instruction_i1(cause2));
            } else {
              return exitFailCause(stripFailures(cause2));
            }
          }
          case "OnStep": {
            if (!(interruptible(this.currentRuntimeFlags) && this.isInterrupted())) {
              return exitSucceed(exitFailCause(cause2));
            } else {
              return exitFailCause(stripFailures(cause2));
            }
          }
          case OP_REVERT_FLAGS: {
            this.patchRuntimeFlags(this.currentRuntimeFlags, cont.patch);
            if (interruptible(this.currentRuntimeFlags) && this.isInterrupted()) {
              return exitFailCause(sequential(cause2, this.getInterruptedCause()));
            } else {
              return exitFailCause(cause2);
            }
          }
          default: {
            absurd(cont);
          }
        }
      } else {
        yieldedOpChannel.currentOp = exitFailCause(cause2);
        return YieldedOp;
      }
    }
    [OP_WITH_RUNTIME](op) {
      return internalCall(() => op.effect_instruction_i0(this, running2(this.currentRuntimeFlags)));
    }
    ["Blocked"](op) {
      const refs = this.getFiberRefs();
      const flags = this.currentRuntimeFlags;
      if (this._steps.length > 0) {
        const frames = [];
        const snap = this._steps[this._steps.length - 1];
        let frame = this.popStack();
        while (frame && frame._op !== "OnStep") {
          frames.push(frame);
          frame = this.popStack();
        }
        this.setFiberRefs(snap.refs);
        this.currentRuntimeFlags = snap.flags;
        const patchRefs = diff6(snap.refs, refs);
        const patchFlags = diff4(snap.flags, flags);
        return exitSucceed(blocked(op.effect_instruction_i0, withFiberRuntime((newFiber) => {
          while (frames.length > 0) {
            newFiber.pushStack(frames.pop());
          }
          newFiber.setFiberRefs(patch7(newFiber.id(), newFiber.getFiberRefs())(patchRefs));
          newFiber.currentRuntimeFlags = patch4(patchFlags)(newFiber.currentRuntimeFlags);
          return op.effect_instruction_i1;
        })));
      }
      return uninterruptibleMask((restore) => flatMap7(forkDaemon(runRequestBlock(op.effect_instruction_i0)), () => restore(op.effect_instruction_i1)));
    }
    ["RunBlocked"](op) {
      return runBlockedRequests(op.effect_instruction_i0);
    }
    [OP_UPDATE_RUNTIME_FLAGS](op) {
      const updateFlags = op.effect_instruction_i0;
      const oldRuntimeFlags = this.currentRuntimeFlags;
      const newRuntimeFlags = patch4(oldRuntimeFlags, updateFlags);
      if (interruptible(newRuntimeFlags) && this.isInterrupted()) {
        return exitFailCause(this.getInterruptedCause());
      } else {
        this.patchRuntimeFlags(this.currentRuntimeFlags, updateFlags);
        if (op.effect_instruction_i1) {
          const revertFlags = diff4(newRuntimeFlags, oldRuntimeFlags);
          this.pushStack(new RevertFlags(revertFlags, op));
          return internalCall(() => op.effect_instruction_i1(oldRuntimeFlags));
        } else {
          return exitVoid;
        }
      }
    }
    [OP_ON_SUCCESS](op) {
      this.pushStack(op);
      return op.effect_instruction_i0;
    }
    ["OnStep"](op) {
      this.pushStack(op);
      return op.effect_instruction_i0;
    }
    [OP_ON_FAILURE](op) {
      this.pushStack(op);
      return op.effect_instruction_i0;
    }
    [OP_ON_SUCCESS_AND_FAILURE](op) {
      this.pushStack(op);
      return op.effect_instruction_i0;
    }
    [OP_ASYNC](op) {
      this._asyncBlockingOn = op.effect_instruction_i1;
      this.initiateAsync(this.currentRuntimeFlags, op.effect_instruction_i0);
      yieldedOpChannel.currentOp = op;
      return YieldedOp;
    }
    [OP_YIELD](op) {
      this._isYielding = false;
      yieldedOpChannel.currentOp = op;
      return YieldedOp;
    }
    [OP_WHILE](op) {
      const check = op.effect_instruction_i0;
      const body = op.effect_instruction_i1;
      if (check()) {
        this.pushStack(op);
        return body();
      } else {
        return exitVoid;
      }
    }
    [OP_ITERATOR](op) {
      return contOpSuccess[OP_ITERATOR](this, op, undefined);
    }
    [OP_COMMIT](op) {
      return internalCall(() => op.commit());
    }
    runLoop(effect0) {
      let cur = effect0;
      this.currentOpCount = 0;
      while (true) {
        if ((this.currentRuntimeFlags & OpSupervision) !== 0) {
          this.currentSupervisor.onEffect(this, cur);
        }
        if (this._queue.length > 0) {
          cur = this.drainQueueWhileRunning(this.currentRuntimeFlags, cur);
        }
        if (!this._isYielding) {
          this.currentOpCount += 1;
          const shouldYield = this.currentScheduler.shouldYield(this);
          if (shouldYield !== false) {
            this._isYielding = true;
            this.currentOpCount = 0;
            const oldCur = cur;
            cur = flatMap7(yieldNow({
              priority: shouldYield
            }), () => oldCur);
          }
        }
        try {
          cur = this.currentTracer.context(() => {
            if (_version !== cur[EffectTypeId2]._V) {
              const level = this.getFiberRef(currentVersionMismatchErrorLogLevel);
              if (level._tag === "Some") {
                const effectVersion = cur[EffectTypeId2]._V;
                this.log(`Executing an Effect versioned ${effectVersion} with a Runtime of version ${getCurrentVersion()}, you may want to dedupe the effect dependencies, you can use the language service plugin to detect this at compile time: https://github.com/Effect-TS/language-service`, empty6, level);
              }
            }
            return this[cur._op](cur);
          }, this);
          if (cur === YieldedOp) {
            const op = yieldedOpChannel.currentOp;
            if (op._op === OP_YIELD || op._op === OP_ASYNC) {
              return YieldedOp;
            }
            yieldedOpChannel.currentOp = null;
            return op._op === OP_SUCCESS || op._op === OP_FAILURE ? op : exitFailCause(die(op));
          }
        } catch (e) {
          if (cur !== YieldedOp && !hasProperty(cur, "_op") || !(cur._op in this)) {
            cur = dieMessage(`Not a valid effect: ${toStringUnknown(cur)}`);
          } else if (isInterruptedException(e)) {
            cur = exitFailCause(sequential(die(e), interrupt(none4)));
          } else {
            cur = die2(e);
          }
        }
      }
    }
    run = () => {
      this.drainQueueOnCurrentThread();
    };
  };
  currentMinimumLogLevel = /* @__PURE__ */ globalValue("effect/FiberRef/currentMinimumLogLevel", () => fiberRefUnsafeMake(fromLiteral("Info")));
  defaultLogger = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Logger/defaultLogger"), () => loggerWithConsoleLog(stringLogger));
  tracerLogger = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/Logger/tracerLogger"), () => makeLogger(({
    annotations,
    cause: cause2,
    context: context2,
    fiberId: fiberId2,
    logLevel,
    message
  }) => {
    const span2 = filterDisablePropagation(getOption2(getOrDefault(context2, currentContext), spanTag));
    if (span2._tag === "None" || span2.value._tag === "ExternalSpan") {
      return;
    }
    const clockService = unsafeGet4(getOrDefault(context2, currentServices), clockTag);
    const attributes = {};
    for (const [key, value] of annotations) {
      attributes[key] = value;
    }
    attributes["effect.fiberId"] = threadName2(fiberId2);
    attributes["effect.logLevel"] = logLevel.label;
    if (cause2 !== null && cause2._tag !== "Empty") {
      attributes["effect.cause"] = pretty(cause2, {
        renderErrorCause: true
      });
    }
    span2.value.event(toStringUnknown(Array.isArray(message) && message.length === 1 ? message[0] : message), clockService.unsafeCurrentTimeNanos(), attributes);
  }));
  currentLoggers = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentLoggers"), () => fiberRefUnsafeMakeHashSet(make7(defaultLogger, tracerLogger)));
  whenLogLevel = /* @__PURE__ */ dual(2, (effect, level) => {
    const requiredLogLevel = typeof level === "string" ? fromLiteral(level) : level;
    return withFiberRuntime((fiberState) => {
      const minimumLogLevel = fiberState.getFiberRef(currentMinimumLogLevel);
      if (greaterThan2(minimumLogLevel, requiredLogLevel)) {
        return succeed(none2());
      }
      return map8(effect, some2);
    });
  });
  acquireRelease = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (acquire, release) => uninterruptible(tap2(acquire, (a) => addFinalizer((exit2) => release(a, exit2)))));
  acquireReleaseInterruptible = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (acquire, release) => ensuring(acquire, addFinalizer((exit2) => release(exit2))));
  _existsParFound = /* @__PURE__ */ Symbol.for("effect/Effect/existsPar/found");
  exists3 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]) && !isEffect(args2[0]), (elements, predicate, options) => matchSimple(options?.concurrency, () => suspend(() => existsLoop(elements[Symbol.iterator](), 0, predicate)), () => matchEffect(forEach4(elements, (a, i) => if_(predicate(a, i), {
    onTrue: () => fail2(_existsParFound),
    onFalse: () => void_2
  }), options), {
    onFailure: (e) => e === _existsParFound ? succeed(true) : fail2(e),
    onSuccess: () => succeed(false)
  })));
  filter7 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]) && !isEffect(args2[0]), (elements, predicate, options) => {
    const predicate_ = options?.negate ? (a, i) => map8(predicate(a, i), not) : predicate;
    return matchSimple(options?.concurrency, () => suspend(() => fromIterable2(elements).reduceRight((effect, a, i) => zipWith3(effect, suspend(() => predicate_(a, i)), (list, b) => b ? [a, ...list] : list), sync(() => new Array))), () => map8(forEach4(elements, (a, i) => map8(predicate_(a, i), (b) => b ? some2(a) : none2()), options), getSomes));
  });
  replicate = /* @__PURE__ */ dual(2, (self, n) => Array.from({
    length: n
  }, () => self));
  replicateEffect = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, n, options) => all3(replicate(self, n), options));
  forEach4 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (self, f, options) => withFiberRuntime((r) => {
    const isRequestBatchingEnabled = options?.batching === true || options?.batching === "inherit" && r.getFiberRef(currentRequestBatching);
    if (options?.discard) {
      return match8(options.concurrency, () => finalizersMaskInternal(sequential4, options?.concurrentFinalizers)((restore) => isRequestBatchingEnabled ? forEachConcurrentDiscard(self, (a, i) => restore(f(a, i)), true, false, 1) : forEachSequentialDiscard(self, (a, i) => restore(f(a, i)))), () => finalizersMaskInternal(parallel4, options?.concurrentFinalizers)((restore) => forEachConcurrentDiscard(self, (a, i) => restore(f(a, i)), isRequestBatchingEnabled, false)), (n) => finalizersMaskInternal(parallelN2(n), options?.concurrentFinalizers)((restore) => forEachConcurrentDiscard(self, (a, i) => restore(f(a, i)), isRequestBatchingEnabled, false, n)));
    }
    return match8(options?.concurrency, () => finalizersMaskInternal(sequential4, options?.concurrentFinalizers)((restore) => isRequestBatchingEnabled ? forEachParN(self, 1, (a, i) => restore(f(a, i)), true) : forEachSequential(self, (a, i) => restore(f(a, i)))), () => finalizersMaskInternal(parallel4, options?.concurrentFinalizers)((restore) => forEachParUnbounded(self, (a, i) => restore(f(a, i)), isRequestBatchingEnabled)), (n) => finalizersMaskInternal(parallelN2(n), options?.concurrentFinalizers)((restore) => forEachParN(self, n, (a, i) => restore(f(a, i)), isRequestBatchingEnabled)));
  }));
  forkWithErrorHandler = /* @__PURE__ */ dual(2, (self, handler) => fork(onError(self, (cause2) => {
    const either3 = failureOrCause(cause2);
    switch (either3._tag) {
      case "Left":
        return handler(either3.left);
      case "Right":
        return failCause(either3.right);
    }
  })));
  mergeAll3 = /* @__PURE__ */ dual((args2) => isFunction2(args2[2]), (elements, zero2, f, options) => matchSimple(options?.concurrency, () => fromIterable2(elements).reduce((acc, a, i) => zipWith3(acc, a, (acc2, a2) => f(acc2, a2, i)), succeed(zero2)), () => flatMap7(make24(zero2), (acc) => flatMap7(forEach4(elements, (effect, i) => flatMap7(effect, (a) => update3(acc, (b) => f(b, a, i))), options), () => get11(acc)))));
  partition3 = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (elements, f, options) => pipe(forEach4(elements, (a, i) => either2(f(a, i)), options), map8((chunk2) => partitionMap3(chunk2, identity))));
  validateAll = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (elements, f, options) => flatMap7(partition3(elements, f, {
    concurrency: options?.concurrency,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), ([es, bs]) => isNonEmptyArray2(es) ? fail2(es) : options?.discard ? void_2 : succeed(bs)));
  reduceEffect = /* @__PURE__ */ dual((args2) => isIterable(args2[0]) && !isEffect(args2[0]), (elements, zero2, f, options) => matchSimple(options?.concurrency, () => fromIterable2(elements).reduce((acc, a, i) => zipWith3(acc, a, (acc2, a2) => f(acc2, a2, i)), zero2), () => suspend(() => pipe(mergeAll3([zero2, ...elements], none2(), (acc, elem, i) => {
    switch (acc._tag) {
      case "None": {
        return some2(elem);
      }
      case "Some": {
        return some2(f(acc.value, elem, i));
      }
    }
  }, options), map8((option2) => {
    switch (option2._tag) {
      case "None": {
        throw new Error("BUG: Effect.reduceEffect - please report an issue at https://github.com/Effect-TS/effect/issues");
      }
      case "Some": {
        return option2.value;
      }
    }
  })))));
  using = /* @__PURE__ */ dual(2, (self, use) => scopedWith((scope) => flatMap7(scopeExtend(self, scope), use)));
  validate = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => validateWith(self, that, (a, b) => [a, b], options));
  validateWith = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, f, options) => flatten5(zipWithOptions(exit(self), exit(that), (ea, eb) => exitZipWith(ea, eb, {
    onSuccess: f,
    onFailure: (ca, cb) => options?.concurrent ? parallel(ca, cb) : sequential(ca, cb)
  }), options)));
  validateFirst = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (elements, f, options) => flip(forEach4(elements, (a, i) => flip(f(a, i)), options)));
  zipOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => zipWithOptions(self, that, (a, b) => [a, b], options));
  zipLeftOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => {
    if (options?.concurrent !== true && (options?.batching === undefined || options.batching === false)) {
      return zipLeft2(self, that);
    }
    return zipWithOptions(self, that, (a, _) => a, options);
  });
  zipRightOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, options) => {
    if (options?.concurrent !== true && (options?.batching === undefined || options.batching === false)) {
      return zipRight2(self, that);
    }
    return zipWithOptions(self, that, (_, b) => b, options);
  });
  zipWithOptions = /* @__PURE__ */ dual((args2) => isEffect(args2[1]), (self, that, f, options) => map8(all3([self, that], {
    concurrency: options?.concurrent ? 2 : 1,
    batching: options?.batching,
    concurrentFinalizers: options?.concurrentFinalizers
  }), ([a, a2]) => f(a, a2)));
  scopeTag = /* @__PURE__ */ GenericTag("effect/Scope");
  scope = scopeTag;
  ScopeImplProto = {
    [ScopeTypeId]: ScopeTypeId,
    [CloseableScopeTypeId]: CloseableScopeTypeId,
    pipe() {
      return pipeArguments(this, arguments);
    },
    fork(strategy) {
      return sync(() => {
        const newScope = scopeUnsafeMake(strategy);
        if (this.state._tag === "Closed") {
          newScope.state = this.state;
          return newScope;
        }
        const key = {};
        const fin = (exit2) => newScope.close(exit2);
        this.state.finalizers.set(key, fin);
        scopeUnsafeAddFinalizer(newScope, (_) => sync(() => {
          if (this.state._tag === "Open") {
            this.state.finalizers.delete(key);
          }
        }));
        return newScope;
      });
    },
    close(exit2) {
      return suspend(() => {
        if (this.state._tag === "Closed") {
          return void_2;
        }
        const finalizers = Array.from(this.state.finalizers.values()).reverse();
        this.state = {
          _tag: "Closed",
          exit: exit2
        };
        if (finalizers.length === 0) {
          return void_2;
        }
        return isSequential(this.strategy) ? pipe(forEachSequential(finalizers, (fin) => exit(fin(exit2))), flatMap7((results) => pipe(exitCollectAll(results), map(exitAsVoid), getOrElse(() => exitVoid)))) : isParallel(this.strategy) ? pipe(forEachParUnbounded(finalizers, (fin) => exit(fin(exit2)), false), flatMap7((results) => pipe(exitCollectAll(results, {
          parallel: true
        }), map(exitAsVoid), getOrElse(() => exitVoid)))) : pipe(forEachParN(finalizers, this.strategy.parallelism, (fin) => exit(fin(exit2)), false), flatMap7((results) => pipe(exitCollectAll(results, {
          parallel: true
        }), map(exitAsVoid), getOrElse(() => exitVoid))));
      });
    },
    addFinalizer(fin) {
      return suspend(() => {
        if (this.state._tag === "Closed") {
          return fin(this.state.exit);
        }
        this.state.finalizers.set({}, fin);
        return void_2;
      });
    }
  };
  scopeExtend = /* @__PURE__ */ dual(2, (effect, scope2) => mapInputContext(effect, merge3(make9(scopeTag, scope2))));
  scopeUse = /* @__PURE__ */ dual(2, (effect, scope2) => pipe(effect, scopeExtend(scope2), onExit((exit2) => scope2.close(exit2))));
  fiberRefLocallyScoped = /* @__PURE__ */ dual(2, (self, value) => asVoid2(acquireRelease(flatMap7(fiberRefGet(self), (oldValue) => as3(fiberRefSet(self, value), oldValue)), (oldValue) => fiberRefSet(self, oldValue))));
  fiberRefLocallyScopedWith = /* @__PURE__ */ dual(2, (self, f) => fiberRefGetWith(self, (a) => fiberRefLocallyScoped(self, f(a))));
  currentRuntimeFlags = /* @__PURE__ */ fiberRefUnsafeMakeRuntimeFlags(none5);
  currentSupervisor = /* @__PURE__ */ fiberRefUnsafeMakeSupervisor(none8);
  raceWith = /* @__PURE__ */ dual(3, (self, other, options) => raceFibersWith(self, other, {
    onSelfWin: (winner, loser) => flatMap7(winner.await, (exit2) => {
      switch (exit2._tag) {
        case OP_SUCCESS: {
          return flatMap7(winner.inheritAll, () => options.onSelfDone(exit2, loser));
        }
        case OP_FAILURE: {
          return options.onSelfDone(exit2, loser);
        }
      }
    }),
    onOtherWin: (winner, loser) => flatMap7(winner.await, (exit2) => {
      switch (exit2._tag) {
        case OP_SUCCESS: {
          return flatMap7(winner.inheritAll, () => options.onOtherDone(exit2, loser));
        }
        case OP_FAILURE: {
          return options.onOtherDone(exit2, loser);
        }
      }
    })
  }));
  race = /* @__PURE__ */ dual(2, (self, that) => fiberIdWith((parentFiberId) => raceWith(self, that, {
    onSelfDone: (exit2, right3) => exitMatchEffect(exit2, {
      onFailure: (cause2) => pipe(join2(right3), mapErrorCause((cause22) => parallel(cause2, cause22))),
      onSuccess: (value) => pipe(right3, interruptAsFiber(parentFiberId), as3(value))
    }),
    onOtherDone: (exit2, left3) => exitMatchEffect(exit2, {
      onFailure: (cause2) => pipe(join2(left3), mapErrorCause((cause22) => parallel(cause22, cause2))),
      onSuccess: (value) => pipe(left3, interruptAsFiber(parentFiberId), as3(value))
    })
  })));
  raceFibersWith = /* @__PURE__ */ dual(3, (self, other, options) => withFiberRuntime((parentFiber, parentStatus) => {
    const parentRuntimeFlags = parentStatus.runtimeFlags;
    const raceIndicator = make11(true);
    const leftFiber = unsafeMakeChildFiber(self, parentFiber, parentRuntimeFlags, options.selfScope);
    const rightFiber = unsafeMakeChildFiber(other, parentFiber, parentRuntimeFlags, options.otherScope);
    return async_((cb) => {
      leftFiber.addObserver(() => completeRace(leftFiber, rightFiber, options.onSelfWin, raceIndicator, cb));
      rightFiber.addObserver(() => completeRace(rightFiber, leftFiber, options.onOtherWin, raceIndicator, cb));
      leftFiber.startFork(self);
      rightFiber.startFork(other);
    }, combine3(leftFiber.id(), rightFiber.id()));
  }));
  ensuring = /* @__PURE__ */ dual(2, (self, finalizer) => uninterruptibleMask((restore) => matchCauseEffect(restore(self), {
    onFailure: (cause1) => matchCauseEffect(finalizer, {
      onFailure: (cause2) => failCause(sequential(cause1, cause2)),
      onSuccess: () => failCause(cause1)
    }),
    onSuccess: (a) => as3(finalizer, a)
  })));
});

// node_modules/effect/dist/esm/internal/schedule/interval.js
var IntervalSymbolKey = "effect/ScheduleInterval", IntervalTypeId, empty24, make32 = (startMillis, endMillis) => {
  if (startMillis > endMillis) {
    return empty24;
  }
  return {
    [IntervalTypeId]: IntervalTypeId,
    startMillis,
    endMillis
  };
}, lessThan2, min2, isEmpty7 = (self) => {
  return self.startMillis >= self.endMillis;
}, intersect, after = (startMilliseconds) => {
  return make32(startMilliseconds, Number.POSITIVE_INFINITY);
};
var init_interval = __esm(() => {
  init_Function();
  IntervalTypeId = /* @__PURE__ */ Symbol.for(IntervalSymbolKey);
  empty24 = {
    [IntervalTypeId]: IntervalTypeId,
    startMillis: 0,
    endMillis: 0
  };
  lessThan2 = /* @__PURE__ */ dual(2, (self, that) => min2(self, that) === self);
  min2 = /* @__PURE__ */ dual(2, (self, that) => {
    if (self.endMillis <= that.startMillis)
      return self;
    if (that.endMillis <= self.startMillis)
      return that;
    if (self.startMillis < that.startMillis)
      return self;
    if (that.startMillis < self.startMillis)
      return that;
    if (self.endMillis <= that.endMillis)
      return self;
    return that;
  });
  intersect = /* @__PURE__ */ dual(2, (self, that) => {
    const start = Math.max(self.startMillis, that.startMillis);
    const end = Math.min(self.endMillis, that.endMillis);
    return make32(start, end);
  });
});

// node_modules/effect/dist/esm/ScheduleInterval.js
var empty25, lessThan3, isEmpty8, intersect2, after2;
var init_ScheduleInterval = __esm(() => {
  init_interval();
  empty25 = empty24;
  lessThan3 = lessThan2;
  isEmpty8 = isEmpty7;
  intersect2 = intersect;
  after2 = after;
});

// node_modules/effect/dist/esm/internal/schedule/intervals.js
var IntervalsSymbolKey = "effect/ScheduleIntervals", IntervalsTypeId, make34 = (intervals) => {
  return {
    [IntervalsTypeId]: IntervalsTypeId,
    intervals
  };
}, intersect3, intersectLoop = (_left, _right, _acc) => {
  let left3 = _left;
  let right3 = _right;
  let acc = _acc;
  while (isNonEmpty(left3) && isNonEmpty(right3)) {
    const interval = pipe(headNonEmpty2(left3), intersect2(headNonEmpty2(right3)));
    const intervals = isEmpty8(interval) ? acc : pipe(acc, prepend2(interval));
    if (pipe(headNonEmpty2(left3), lessThan3(headNonEmpty2(right3)))) {
      left3 = tailNonEmpty2(left3);
    } else {
      right3 = tailNonEmpty2(right3);
    }
    acc = intervals;
  }
  return make34(reverse2(acc));
}, start = (self) => {
  return pipe(self.intervals, head2, getOrElse(() => empty25)).startMillis;
}, end = (self) => {
  return pipe(self.intervals, head2, getOrElse(() => empty25)).endMillis;
}, lessThan4, isNonEmpty3 = (self) => {
  return isNonEmpty(self.intervals);
};
var init_intervals = __esm(() => {
  init_Chunk();
  init_Function();
  init_Option();
  init_ScheduleInterval();
  IntervalsTypeId = /* @__PURE__ */ Symbol.for(IntervalsSymbolKey);
  intersect3 = /* @__PURE__ */ dual(2, (self, that) => intersectLoop(self.intervals, that.intervals, empty2()));
  lessThan4 = /* @__PURE__ */ dual(2, (self, that) => start(self) < start(that));
});

// node_modules/effect/dist/esm/ScheduleIntervals.js
var make35, intersect4, start2, end2, lessThan5, isNonEmpty4;
var init_ScheduleIntervals = __esm(() => {
  init_intervals();
  make35 = make34;
  intersect4 = intersect3;
  start2 = start;
  end2 = end;
  lessThan5 = lessThan4;
  isNonEmpty4 = isNonEmpty3;
});

// node_modules/effect/dist/esm/internal/schedule/decision.js
var OP_CONTINUE = "Continue", OP_DONE2 = "Done", _continue = (intervals) => {
  return {
    _tag: OP_CONTINUE,
    intervals
  };
}, continueWith = (interval) => {
  return {
    _tag: OP_CONTINUE,
    intervals: make35(of2(interval))
  };
}, done5, isContinue = (self) => {
  return self._tag === OP_CONTINUE;
}, isDone3 = (self) => {
  return self._tag === OP_DONE2;
};
var init_decision = __esm(() => {
  init_Chunk();
  init_ScheduleIntervals();
  done5 = {
    _tag: OP_DONE2
  };
});

// node_modules/effect/dist/esm/ScheduleDecision.js
var _continue2, continueWith2, done6, isContinue2, isDone4;
var init_ScheduleDecision = __esm(() => {
  init_decision();
  _continue2 = _continue;
  continueWith2 = continueWith;
  done6 = done5;
  isContinue2 = isContinue;
  isDone4 = isDone3;
});

// node_modules/effect/dist/esm/Scope.js
var Scope, close, fork2;
var init_Scope = __esm(() => {
  init_core();
  init_fiberRuntime();
  Scope = scopeTag;
  close = scopeClose;
  fork2 = scopeFork;
});

// node_modules/effect/dist/esm/internal/effect/circular.js
class Semaphore {
  permits;
  waiters = /* @__PURE__ */ new Set;
  taken = 0;
  constructor(permits) {
    this.permits = permits;
  }
  get free() {
    return this.permits - this.taken;
  }
  take = (n) => asyncInterrupt((resume2) => {
    if (this.free < n) {
      const observer = () => {
        if (this.free < n)
          return;
        this.waiters.delete(observer);
        resume2(suspend(() => {
          if (this.free < n)
            return this.take(n);
          this.taken += n;
          return succeed(n);
        }));
      };
      this.waiters.add(observer);
      return sync(() => {
        this.waiters.delete(observer);
      });
    }
    resume2(suspend(() => {
      if (this.free < n)
        return this.take(n);
      this.taken += n;
      return succeed(n);
    }));
  });
  updateTakenUnsafe(fiber, f) {
    this.taken = f(this.taken);
    if (this.waiters.size > 0) {
      fiber.getFiberRef(currentScheduler).scheduleTask(() => {
        const iter = this.waiters.values();
        let item = iter.next();
        while (item.done === false && this.free > 0) {
          item.value();
          item = iter.next();
        }
      }, fiber.getFiberRef(currentSchedulingPriority), fiber);
    }
    return succeed(this.free);
  }
  updateTaken(f) {
    return withFiberRuntime((fiber) => this.updateTakenUnsafe(fiber, f));
  }
  resize = (permits) => asVoid2(withFiberRuntime((fiber) => {
    this.permits = permits;
    if (this.free < 0) {
      return void_2;
    }
    return this.updateTakenUnsafe(fiber, (taken) => taken);
  }));
  release = (n) => this.updateTaken((taken) => taken - n);
  releaseAll = /* @__PURE__ */ this.updateTaken((_) => 0);
  withPermits = (n) => (self) => uninterruptibleMask((restore) => flatMap7(restore(this.take(n)), (permits) => ensuring(restore(self), this.release(permits))));
  withPermitsIfAvailable = (n) => (self) => uninterruptibleMask((restore) => suspend(() => {
    if (this.free < n) {
      return succeedNone;
    }
    this.taken += n;
    return ensuring(restore(asSome(self)), this.release(n));
  }));
}
var unsafeMakeSemaphore = (permits) => new Semaphore(permits), makeSemaphore = (permits) => sync(() => unsafeMakeSemaphore(permits)), Latch, unsafeMakeLatch = (open) => new Latch(open ?? false), makeLatch = (open) => sync(() => unsafeMakeLatch(open)), awaitAllChildren = (self) => ensuringChildren(self, fiberAwaitAll), cached2, cachedInvalidateWithTTL, computeCachedValue = (self, timeToLive, start3) => {
  const timeToLiveMillis = toMillis(decode(timeToLive));
  return pipe(deferredMake(), tap2((deferred) => intoDeferred(self, deferred)), map8((deferred) => some2([start3 + timeToLiveMillis, deferred])));
}, getCachedValue = (self, timeToLive, cache) => uninterruptibleMask((restore) => pipe(clockWith3((clock2) => clock2.currentTimeMillis), flatMap7((time) => updateSomeAndGetEffectSynchronized(cache, (option2) => {
  switch (option2._tag) {
    case "None": {
      return some2(computeCachedValue(self, timeToLive, time));
    }
    case "Some": {
      const [end3] = option2.value;
      return end3 - time <= 0 ? some2(computeCachedValue(self, timeToLive, time)) : none2();
    }
  }
})), flatMap7((option2) => isNone2(option2) ? dieMessage("BUG: Effect.cachedInvalidate - please report an issue at https://github.com/Effect-TS/effect/issues") : restore(deferredAwait(option2.value[1]))))), invalidateCache = (cache) => set4(cache, none2()), ensuringChild, ensuringChildren, forkAll, forkIn, forkScoped = (self) => scopeWith((scope2) => forkIn(self, scope2)), fromFiber = (fiber) => join2(fiber), fromFiberEffect = (fiber) => suspend(() => flatMap7(fiber, join2)), memoKeySymbol, Key, cachedFunction = (f, eq) => {
  return pipe(sync(() => empty22()), flatMap7(makeSynchronized), map8((ref) => (a) => pipe(ref.modifyEffect((map11) => {
    const result = pipe(map11, get12(new Key(a, eq)));
    if (isNone2(result)) {
      return pipe(deferredMake(), tap2((deferred) => pipe(diffFiberRefs(f(a)), intoDeferred(deferred), fork)), map8((deferred) => [deferred, pipe(map11, set5(new Key(a, eq), deferred))]));
    }
    return succeed([result.value, map11]);
  }), flatMap7(deferredAwait), flatMap7(([patch9, b]) => pipe(patchFiberRefs(patch9), as3(b))))));
}, raceFirst, supervised, timeout, timeoutFail, timeoutFailCause, timeoutOption, timeoutTo, SynchronizedSymbolKey = "effect/Ref/SynchronizedRef", SynchronizedTypeId, synchronizedVariance, SynchronizedImpl, makeSynchronized = (value) => sync(() => unsafeMakeSynchronized(value)), unsafeMakeSynchronized = (value) => {
  const ref = unsafeMake6(value);
  const sem = unsafeMakeSemaphore(1);
  return new SynchronizedImpl(ref, sem.withPermits(1));
}, updateSomeAndGetEffectSynchronized, bindAll;
var init_circular = __esm(() => {
  init_Duration();
  init_Effectable();
  init_Equal();
  init_Function();
  init_Hash();
  init_MutableHashMap();
  init_Option();
  init_Predicate();
  init_Readable();
  init_Scheduler();
  init_core_effect();
  init_core();
  init_fiber();
  init_fiberRuntime();
  init_fiberScope();
  init_ref();
  init_supervisor();
  Latch = class Latch extends Class {
    isOpen;
    waiters = [];
    scheduled = false;
    constructor(isOpen) {
      super();
      this.isOpen = isOpen;
    }
    commit() {
      return this.await;
    }
    unsafeSchedule(fiber) {
      if (this.scheduled || this.waiters.length === 0) {
        return void_2;
      }
      this.scheduled = true;
      fiber.currentScheduler.scheduleTask(this.flushWaiters, fiber.getFiberRef(currentSchedulingPriority), fiber);
      return void_2;
    }
    flushWaiters = () => {
      this.scheduled = false;
      const waiters = this.waiters;
      this.waiters = [];
      for (let i = 0;i < waiters.length; i++) {
        waiters[i](exitVoid);
      }
    };
    open = /* @__PURE__ */ withFiberRuntime((fiber) => {
      if (this.isOpen) {
        return void_2;
      }
      this.isOpen = true;
      return this.unsafeSchedule(fiber);
    });
    unsafeOpen() {
      if (this.isOpen)
        return;
      this.isOpen = true;
      this.flushWaiters();
    }
    release = /* @__PURE__ */ withFiberRuntime((fiber) => {
      if (this.isOpen) {
        return void_2;
      }
      return this.unsafeSchedule(fiber);
    });
    await = /* @__PURE__ */ asyncInterrupt((resume2) => {
      if (this.isOpen) {
        return resume2(void_2);
      }
      this.waiters.push(resume2);
      return sync(() => {
        const index = this.waiters.indexOf(resume2);
        if (index !== -1) {
          this.waiters.splice(index, 1);
        }
      });
    });
    unsafeClose() {
      this.isOpen = false;
    }
    close = /* @__PURE__ */ sync(() => {
      this.isOpen = false;
    });
    whenOpen = (self) => {
      return zipRight2(this.await, self);
    };
  };
  cached2 = /* @__PURE__ */ dual(2, (self, timeToLive) => map8(cachedInvalidateWithTTL(self, timeToLive), (tuple) => tuple[0]));
  cachedInvalidateWithTTL = /* @__PURE__ */ dual(2, (self, timeToLive) => {
    const duration = decode(timeToLive);
    return flatMap7(context(), (env) => map8(makeSynchronized(none2()), (cache) => [provideContext(getCachedValue(self, duration, cache), env), invalidateCache(cache)]));
  });
  ensuringChild = /* @__PURE__ */ dual(2, (self, f) => ensuringChildren(self, (children) => f(fiberAll(children))));
  ensuringChildren = /* @__PURE__ */ dual(2, (self, children) => flatMap7(track, (supervisor) => pipe(supervised(self, supervisor), ensuring(flatMap7(supervisor.value, children)))));
  forkAll = /* @__PURE__ */ dual((args2) => isIterable(args2[0]), (effects, options) => options?.discard ? forEachSequentialDiscard(effects, fork) : map8(forEachSequential(effects, fork), fiberAll));
  forkIn = /* @__PURE__ */ dual(2, (self, scope2) => withFiberRuntime((parent, parentStatus) => {
    const scopeImpl = scope2;
    const fiber = unsafeFork(self, parent, parentStatus.runtimeFlags, globalScope);
    if (scopeImpl.state._tag === "Open") {
      const finalizer = () => fiberIdWith((fiberId2) => equals(fiberId2, fiber.id()) ? void_2 : asVoid2(interruptFiber(fiber)));
      const key = {};
      scopeImpl.state.finalizers.set(key, finalizer);
      fiber.addObserver(() => {
        if (scopeImpl.state._tag === "Closed")
          return;
        scopeImpl.state.finalizers.delete(key);
      });
    } else {
      fiber.unsafeInterruptAsFork(parent.id());
    }
    return succeed(fiber);
  }));
  memoKeySymbol = /* @__PURE__ */ Symbol.for("effect/Effect/memoizeFunction.key");
  Key = class Key {
    a;
    eq;
    [memoKeySymbol] = memoKeySymbol;
    constructor(a, eq) {
      this.a = a;
      this.eq = eq;
    }
    [symbol2](that) {
      if (hasProperty(that, memoKeySymbol)) {
        if (this.eq) {
          return this.eq(this.a, that.a);
        } else {
          return equals(this.a, that.a);
        }
      }
      return false;
    }
    [symbol]() {
      return this.eq ? 0 : cached(this, hash(this.a));
    }
  };
  raceFirst = /* @__PURE__ */ dual(2, (self, that) => pipe(exit(self), race(exit(that)), (effect) => flatten5(effect)));
  supervised = /* @__PURE__ */ dual(2, (self, supervisor) => {
    const supervise = fiberRefLocallyWith(currentSupervisor, (s) => s.zip(supervisor));
    return supervise(self);
  });
  timeout = /* @__PURE__ */ dual(2, (self, duration) => timeoutFail(self, {
    onTimeout: () => timeoutExceptionFromDuration(duration),
    duration
  }));
  timeoutFail = /* @__PURE__ */ dual(2, (self, {
    duration,
    onTimeout
  }) => flatten5(timeoutTo(self, {
    onTimeout: () => failSync(onTimeout),
    onSuccess: succeed,
    duration
  })));
  timeoutFailCause = /* @__PURE__ */ dual(2, (self, {
    duration,
    onTimeout
  }) => flatten5(timeoutTo(self, {
    onTimeout: () => failCauseSync(onTimeout),
    onSuccess: succeed,
    duration
  })));
  timeoutOption = /* @__PURE__ */ dual(2, (self, duration) => timeoutTo(self, {
    duration,
    onSuccess: some2,
    onTimeout: none2
  }));
  timeoutTo = /* @__PURE__ */ dual(2, (self, {
    duration,
    onSuccess,
    onTimeout
  }) => fiberIdWith((parentFiberId) => uninterruptibleMask((restore) => raceFibersWith(exit(restore(self)), interruptible2(sleep3(duration)), {
    onSelfWin: (winner, loser) => flatMap7(winner.await, (exit2) => {
      const selfExit = exitFlatten(exit2);
      if (selfExit._tag === "Success") {
        return flatMap7(winner.inheritAll, () => as3(interruptAsFiber(loser, parentFiberId), onSuccess(selfExit.value)));
      } else {
        return flatMap7(interruptAsFiber(loser, parentFiberId), () => exitFailCause(selfExit.cause));
      }
    }),
    onOtherWin: (winner, loser) => flatMap7(winner.await, (exit2) => {
      if (exit2._tag === "Success") {
        return flatMap7(winner.inheritAll, () => as3(interruptAsFiber(loser, parentFiberId), onTimeout()));
      } else {
        return flatMap7(interruptAsFiber(loser, parentFiberId), () => exitFailCause(exit2.cause));
      }
    }),
    otherScope: globalScope
  }))));
  SynchronizedTypeId = /* @__PURE__ */ Symbol.for(SynchronizedSymbolKey);
  synchronizedVariance = {
    _A: (_) => _
  };
  SynchronizedImpl = class SynchronizedImpl extends Class {
    ref;
    withLock;
    [SynchronizedTypeId] = synchronizedVariance;
    [RefTypeId] = refVariance;
    [TypeId11] = TypeId11;
    constructor(ref, withLock) {
      super();
      this.ref = ref;
      this.withLock = withLock;
      this.get = get10(this.ref);
    }
    get;
    commit() {
      return this.get;
    }
    modify(f) {
      return this.modifyEffect((a) => succeed(f(a)));
    }
    modifyEffect(f) {
      return this.withLock(pipe(flatMap7(get10(this.ref), f), flatMap7(([b, a]) => as3(set4(this.ref, a), b))));
    }
  };
  updateSomeAndGetEffectSynchronized = /* @__PURE__ */ dual(2, (self, pf) => self.modifyEffect((value) => {
    const result = pf(value);
    switch (result._tag) {
      case "None": {
        return succeed([value, value]);
      }
      case "Some": {
        return map8(result.value, (a) => [a, a]);
      }
    }
  }));
  bindAll = /* @__PURE__ */ dual((args2) => isEffect(args2[0]), (self, f, options) => flatMap7(self, (a) => all3(f(a), options).pipe(map8((record) => Object.assign({}, a, record)))));
});

// node_modules/effect/dist/esm/internal/managedRuntime/circular.js
var TypeId13;
var init_circular2 = __esm(() => {
  TypeId13 = /* @__PURE__ */ Symbol.for("effect/ManagedRuntime");
});

// node_modules/effect/dist/esm/internal/opCodes/layer.js
var OP_EXTEND_SCOPE = "ExtendScope", OP_FOLD = "Fold", OP_FRESH = "Fresh", OP_FROM_EFFECT = "FromEffect", OP_SCOPED = "Scoped", OP_SUSPEND = "Suspend", OP_PROVIDE = "Provide", OP_PROVIDE_MERGE = "ProvideMerge", OP_MERGE_ALL = "MergeAll", OP_ZIP_WITH2 = "ZipWith";

// node_modules/effect/dist/esm/Fiber.js
var interruptAs;
var init_Fiber = __esm(() => {
  init_core();
  interruptAs = interruptAsFiber;
});

// node_modules/effect/dist/esm/internal/runtime.js
class RuntimeImpl {
  context;
  runtimeFlags;
  fiberRefs;
  constructor(context2, runtimeFlags2, fiberRefs3) {
    this.context = context2;
    this.runtimeFlags = runtimeFlags2;
    this.fiberRefs = fiberRefs3;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
}
var makeDual = (f) => function() {
  if (arguments.length === 1) {
    const runtime2 = arguments[0];
    return (effect, ...args2) => f(runtime2, effect, ...args2);
  }
  return f.apply(this, arguments);
}, unsafeFork2, unsafeRunCallback, unsafeRunSync, AsyncFiberExceptionImpl, asyncFiberException = (fiber) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  const error = new AsyncFiberExceptionImpl(fiber);
  Error.stackTraceLimit = limit;
  return error;
}, FiberFailureId, FiberFailureCauseId, FiberFailureImpl, fiberFailure = (cause2) => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  const error = new FiberFailureImpl(cause2);
  Error.stackTraceLimit = limit;
  return error;
}, fastPath = (effect) => {
  const op = effect;
  switch (op._op) {
    case "Failure":
    case "Success": {
      return op;
    }
    case "Left": {
      return exitFail(op.left);
    }
    case "Right": {
      return exitSucceed(op.right);
    }
    case "Some": {
      return exitSucceed(op.value);
    }
    case "None": {
      return exitFail(new NoSuchElementException);
    }
  }
}, unsafeRunSyncExit, unsafeRunPromise, unsafeRunPromiseExit, make36 = (options) => new RuntimeImpl(options.context, options.runtimeFlags, options.fiberRefs), runtime2 = () => withFiberRuntime((state, status) => succeed(new RuntimeImpl(state.getFiberRef(currentContext), status.runtimeFlags, state.getFiberRefs()))), defaultRuntimeFlags, defaultRuntime, unsafeRunEffect, unsafeForkEffect, unsafeRunPromiseEffect, unsafeRunPromiseExitEffect, unsafeRunSyncEffect, unsafeRunSyncExitEffect, asyncEffect = (register) => suspend(() => {
  let cleanup = undefined;
  return flatMap7(deferredMake(), (deferred) => flatMap7(runtime2(), (runtime3) => uninterruptibleMask((restore) => zipRight2(fork(restore(matchCauseEffect(register((cb) => unsafeRunCallback(runtime3)(intoDeferred(cb, deferred))), {
    onFailure: (cause2) => deferredFailCause(deferred, cause2),
    onSuccess: (cleanup_) => {
      cleanup = cleanup_;
      return void_2;
    }
  }))), restore(onInterrupt(deferredAwait(deferred), () => cleanup ?? void_2))))));
});
var init_runtime2 = __esm(() => {
  init_Context();
  init_Equal();
  init_Exit();
  init_Fiber();
  init_FiberId();
  init_FiberRefs();
  init_Function();
  init_Inspectable();
  init_Option();
  init_Pipeable();
  init_Scheduler();
  init_Scope();
  init_cause();
  init_core();
  init_executionStrategy();
  init_fiberRuntime();
  init_fiberScope();
  init_runtimeFlags();
  init_supervisor();
  unsafeFork2 = /* @__PURE__ */ makeDual((runtime2, self, options) => {
    const fiberId2 = unsafeMake3();
    const fiberRefUpdates = [[currentContext, [[fiberId2, runtime2.context]]]];
    if (options?.scheduler) {
      fiberRefUpdates.push([currentScheduler, [[fiberId2, options.scheduler]]]);
    }
    let fiberRefs3 = updateManyAs2(runtime2.fiberRefs, {
      entries: fiberRefUpdates,
      forkAs: fiberId2
    });
    if (options?.updateRefs) {
      fiberRefs3 = options.updateRefs(fiberRefs3, fiberId2);
    }
    const fiberRuntime = new FiberRuntime(fiberId2, fiberRefs3, runtime2.runtimeFlags);
    let effect = self;
    if (options?.scope) {
      effect = flatMap7(fork2(options.scope, sequential3), (closeableScope) => zipRight2(scopeAddFinalizer(closeableScope, fiberIdWith((id) => equals(id, fiberRuntime.id()) ? void_2 : interruptAsFiber(fiberRuntime, id))), onExit(self, (exit2) => close(closeableScope, exit2))));
    }
    const supervisor = fiberRuntime.currentSupervisor;
    if (supervisor !== none8) {
      supervisor.onStart(runtime2.context, effect, none2(), fiberRuntime);
      fiberRuntime.addObserver((exit2) => supervisor.onEnd(exit2, fiberRuntime));
    }
    globalScope.add(runtime2.runtimeFlags, fiberRuntime);
    if (options?.immediate === false) {
      fiberRuntime.resume(effect);
    } else {
      fiberRuntime.start(effect);
    }
    return fiberRuntime;
  });
  unsafeRunCallback = /* @__PURE__ */ makeDual((runtime2, effect, options = {}) => {
    const fiberRuntime = unsafeFork2(runtime2, effect, options);
    if (options.onExit) {
      fiberRuntime.addObserver((exit2) => {
        options.onExit(exit2);
      });
    }
    return (id, cancelOptions) => unsafeRunCallback(runtime2)(pipe(fiberRuntime, interruptAs(id ?? none4)), {
      ...cancelOptions,
      onExit: cancelOptions?.onExit ? (exit2) => cancelOptions.onExit(flatten7(exit2)) : undefined
    });
  });
  unsafeRunSync = /* @__PURE__ */ makeDual((runtime2, effect) => {
    const result = unsafeRunSyncExit(runtime2)(effect);
    if (result._tag === "Failure") {
      throw fiberFailure(result.effect_instruction_i0);
    }
    return result.effect_instruction_i0;
  });
  AsyncFiberExceptionImpl = class AsyncFiberExceptionImpl extends Error {
    fiber;
    _tag = "AsyncFiberException";
    constructor(fiber) {
      super(`Fiber #${fiber.id().id} cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work`);
      this.fiber = fiber;
      this.name = this._tag;
      this.stack = this.message;
    }
  };
  FiberFailureId = /* @__PURE__ */ Symbol.for("effect/Runtime/FiberFailure");
  FiberFailureCauseId = /* @__PURE__ */ Symbol.for("effect/Runtime/FiberFailure/Cause");
  FiberFailureImpl = class FiberFailureImpl extends Error {
    [FiberFailureId];
    [FiberFailureCauseId];
    constructor(cause2) {
      const head4 = prettyErrors(cause2)[0];
      super(head4?.message || "An error has occurred");
      this[FiberFailureId] = FiberFailureId;
      this[FiberFailureCauseId] = cause2;
      this.name = head4 ? `(FiberFailure) ${head4.name}` : "FiberFailure";
      if (head4?.stack) {
        this.stack = head4.stack;
      }
    }
    toJSON() {
      return {
        _id: "FiberFailure",
        cause: this[FiberFailureCauseId].toJSON()
      };
    }
    toString() {
      return "(FiberFailure) " + pretty(this[FiberFailureCauseId], {
        renderErrorCause: true
      });
    }
    [NodeInspectSymbol]() {
      return this.toString();
    }
  };
  unsafeRunSyncExit = /* @__PURE__ */ makeDual((runtime2, effect) => {
    const op = fastPath(effect);
    if (op) {
      return op;
    }
    const scheduler = new SyncScheduler;
    const fiberRuntime = unsafeFork2(runtime2)(effect, {
      scheduler
    });
    scheduler.flush();
    const result = fiberRuntime.unsafePoll();
    if (result) {
      return result;
    }
    return exitDie(capture(asyncFiberException(fiberRuntime), currentSpanFromFiber(fiberRuntime)));
  });
  unsafeRunPromise = /* @__PURE__ */ makeDual((runtime2, effect, options) => unsafeRunPromiseExit(runtime2, effect, options).then((result) => {
    switch (result._tag) {
      case OP_SUCCESS: {
        return result.effect_instruction_i0;
      }
      case OP_FAILURE: {
        throw fiberFailure(result.effect_instruction_i0);
      }
    }
  }));
  unsafeRunPromiseExit = /* @__PURE__ */ makeDual((runtime2, effect, options) => new Promise((resolve) => {
    const op = fastPath(effect);
    if (op) {
      resolve(op);
    }
    const fiber = unsafeFork2(runtime2)(effect);
    fiber.addObserver((exit2) => {
      resolve(exit2);
    });
    if (options?.signal !== undefined) {
      if (options.signal.aborted) {
        fiber.unsafeInterruptAsFork(fiber.id());
      } else {
        options.signal.addEventListener("abort", () => {
          fiber.unsafeInterruptAsFork(fiber.id());
        }, {
          once: true
        });
      }
    }
  }));
  defaultRuntimeFlags = /* @__PURE__ */ make16(Interruption, CooperativeYielding, RuntimeMetrics);
  defaultRuntime = /* @__PURE__ */ make36({
    context: /* @__PURE__ */ empty8(),
    runtimeFlags: defaultRuntimeFlags,
    fiberRefs: /* @__PURE__ */ empty20()
  });
  unsafeRunEffect = /* @__PURE__ */ unsafeRunCallback(defaultRuntime);
  unsafeForkEffect = /* @__PURE__ */ unsafeFork2(defaultRuntime);
  unsafeRunPromiseEffect = /* @__PURE__ */ unsafeRunPromise(defaultRuntime);
  unsafeRunPromiseExitEffect = /* @__PURE__ */ unsafeRunPromiseExit(defaultRuntime);
  unsafeRunSyncEffect = /* @__PURE__ */ unsafeRunSync(defaultRuntime);
  unsafeRunSyncExitEffect = /* @__PURE__ */ unsafeRunSyncExit(defaultRuntime);
});

// node_modules/effect/dist/esm/internal/synchronizedRef.js
var modifyEffect;
var init_synchronizedRef = __esm(() => {
  init_Function();
  modifyEffect = /* @__PURE__ */ dual(2, (self, f) => self.modifyEffect(f));
});

// node_modules/effect/dist/esm/internal/layer.js
function fromEffectContext(effect) {
  const fromEffect3 = Object.create(proto3);
  fromEffect3._op_layer = OP_FROM_EFFECT;
  fromEffect3.effect = effect;
  return fromEffect3;
}
var LayerSymbolKey = "effect/Layer", LayerTypeId, layerVariance, proto3, MemoMapTypeIdKey = "effect/Layer/MemoMap", MemoMapTypeId, CurrentMemoMap, isLayer = (u) => hasProperty(u, LayerTypeId), isFresh = (self) => {
  return self._op_layer === OP_FRESH;
}, MemoMapImpl, makeMemoMap, unsafeMakeMemoMap = () => new MemoMapImpl(unsafeMakeSynchronized(new Map)), build = (self) => scopeWith((scope2) => buildWithScope(self, scope2)), buildWithScope, buildWithMemoMap, makeBuilder = (self, scope2, inMemoMap = false) => {
  const op = self;
  switch (op._op_layer) {
    case "Locally": {
      return sync(() => (memoMap) => op.f(memoMap.getOrElseMemoize(op.self, scope2)));
    }
    case "ExtendScope": {
      return sync(() => (memoMap) => scopeWith((scope3) => memoMap.getOrElseMemoize(op.layer, scope3)));
    }
    case "Fold": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.layer, scope2), matchCauseEffect({
        onFailure: (cause2) => memoMap.getOrElseMemoize(op.failureK(cause2), scope2),
        onSuccess: (value) => memoMap.getOrElseMemoize(op.successK(value), scope2)
      })));
    }
    case "Fresh": {
      return sync(() => (_) => pipe(op.layer, buildWithScope(scope2)));
    }
    case "FromEffect": {
      return inMemoMap ? sync(() => (_) => op.effect) : sync(() => (memoMap) => memoMap.getOrElseMemoize(self, scope2));
    }
    case "Provide": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.first, scope2), flatMap7((env) => pipe(memoMap.getOrElseMemoize(op.second, scope2), provideContext(env)))));
    }
    case "Scoped": {
      return inMemoMap ? sync(() => (_) => scopeExtend(op.effect, scope2)) : sync(() => (memoMap) => memoMap.getOrElseMemoize(self, scope2));
    }
    case "Suspend": {
      return sync(() => (memoMap) => memoMap.getOrElseMemoize(op.evaluate(), scope2));
    }
    case "ProvideMerge": {
      return sync(() => (memoMap) => pipe(memoMap.getOrElseMemoize(op.first, scope2), zipWith3(memoMap.getOrElseMemoize(op.second, scope2), op.zipK)));
    }
    case "ZipWith": {
      return gen2(function* () {
        const parallelScope = yield* scopeFork(scope2, parallel3);
        const firstScope = yield* scopeFork(parallelScope, sequential3);
        const secondScope = yield* scopeFork(parallelScope, sequential3);
        return (memoMap) => pipe(memoMap.getOrElseMemoize(op.first, firstScope), zipWithOptions(memoMap.getOrElseMemoize(op.second, secondScope), op.zipK, {
          concurrent: true
        }));
      });
    }
    case "MergeAll": {
      const layers = op.layers;
      return map8(scopeFork(scope2, parallel3), (parallelScope) => (memoMap) => {
        const contexts = new Array(layers.length);
        return map8(forEachConcurrentDiscard(layers, fnUntraced(function* (layer, i) {
          const scope3 = yield* scopeFork(parallelScope, sequential3);
          const context2 = yield* memoMap.getOrElseMemoize(layer, scope3);
          contexts[i] = context2;
        }), false, false), () => mergeAll2(...contexts));
      });
    }
  }
}, catchAll2, catchAllCause2, die5 = (defect) => failCause4(die3(defect)), dieSync2 = (evaluate2) => failCauseSync2(() => die3(evaluate2())), discard = (self) => map11(self, () => empty8()), context2 = () => fromEffectContext(context()), extendScope = (self) => {
  const extendScope2 = Object.create(proto3);
  extendScope2._op_layer = OP_EXTEND_SCOPE;
  extendScope2.layer = self;
  return extendScope2;
}, fail5 = (error) => failCause4(fail3(error)), failSync2 = (evaluate2) => failCauseSync2(() => fail3(evaluate2())), failCause4 = (cause2) => fromEffectContext(failCause(cause2)), failCauseSync2 = (evaluate2) => fromEffectContext(failCauseSync(evaluate2)), flatMap11, flatten8, fresh = (self) => {
  const fresh2 = Object.create(proto3);
  fresh2._op_layer = OP_FRESH;
  fresh2.layer = self;
  return fresh2;
}, fromEffect2, fromEffectDiscard = (effect) => fromEffectContext(map8(effect, () => empty8())), fiberRefLocally2, locallyEffect, fiberRefLocallyWith2, fiberRefLocallyScoped2 = (self, value) => scopedDiscard(fiberRefLocallyScoped(self, value)), fiberRefLocallyScopedWith2 = (self, value) => scopedDiscard(fiberRefLocallyScopedWith(self, value)), fromFunction = (tagA, tagB, f) => fromEffectContext(map8(tagA, (a) => make9(tagB, f(a)))), launch = (self) => scopedEffect(zipRight2(scopeWith((scope2) => pipe(self, buildWithScope(scope2))), never)), mock = function() {
  if (arguments.length === 1) {
    return (service) => mockImpl(arguments[0], service);
  }
  return mockImpl(arguments[0], arguments[1]);
}, mockImpl = (tag, service) => succeed4(tag, new Proxy({
  ...service
}, {
  get(target, prop, _receiver) {
    if (prop in target) {
      return target[prop];
    }
    const prevLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const error = new Error(`${tag.key}: Unimplemented method "${prop.toString()}"`);
    Error.stackTraceLimit = prevLimit;
    error.name = "UnimplementedError";
    return makeUnimplemented(error);
  },
  has: constTrue
})), makeUnimplemented = (error) => {
  const dead = die2(error);
  function unimplemented() {
    return dead;
  }
  Object.assign(unimplemented, dead);
  Object.setPrototypeOf(unimplemented, Object.getPrototypeOf(dead));
  return unimplemented;
}, map11, mapError3, matchCause2, match11, memoize2 = (self) => scopeWith((scope2) => map8(memoize(buildWithScope(self, scope2)), fromEffectContext)), merge6, mergeAll4 = (...layers) => {
  const mergeAll5 = Object.create(proto3);
  mergeAll5._op_layer = OP_MERGE_ALL;
  mergeAll5.layers = layers;
  return mergeAll5;
}, orDie2 = (self) => catchAll2(self, (defect) => die5(defect)), orElse3, passthrough = (self) => merge6(context2(), self), project, retry, retryLoop = (self, schedule, stateTag, state) => {
  return pipe(self, catchAll2((error) => pipe(retryUpdate(schedule, stateTag, error, state), flatMap11((env) => fresh(retryLoop(self, schedule, stateTag, pipe(env, get5(stateTag)).state))))));
}, retryUpdate = (schedule, stateTag, error, state) => {
  return fromEffect2(stateTag, pipe(currentTimeMillis2, flatMap7((now) => pipe(schedule.step(now, error, state), flatMap7(([state2, _, decision]) => isDone4(decision) ? fail2(error) : pipe(sleep2(millis(start2(decision.intervals) - now)), as3({
    state: state2
  })))))));
}, scoped, scopedDiscard = (effect) => scopedContext(pipe(effect, as3(empty8()))), scopedContext = (effect) => {
  const scoped2 = Object.create(proto3);
  scoped2._op_layer = OP_SCOPED;
  scoped2.effect = effect;
  return scoped2;
}, scope2, service = (tag) => fromEffect2(tag, tag), succeed4, succeedContext = (context3) => {
  return fromEffectContext(succeed(context3));
}, empty27, suspend2 = (evaluate2) => {
  const suspend3 = Object.create(proto3);
  suspend3._op_layer = OP_SUSPEND;
  suspend3.evaluate = evaluate2;
  return suspend3;
}, sync2, syncContext = (evaluate2) => {
  return fromEffectContext(sync(evaluate2));
}, tap3, tapError2, tapErrorCause2, toRuntime = (self) => pipe(scopeWith((scope3) => buildWithScope(self, scope3)), flatMap7((context3) => pipe(runtime2(), provideContext(context3)))), toRuntimeWithMemoMap, provide, provideMerge, zipWith5, unwrapEffect = (self) => {
  const tag = GenericTag("effect/Layer/unwrapEffect/Layer.Layer<R1, E1, A>");
  return flatMap11(fromEffect2(tag, self), (context3) => get5(context3, tag));
}, unwrapScoped = (self) => {
  const tag = GenericTag("effect/Layer/unwrapScoped/Layer.Layer<R1, E1, A>");
  return flatMap11(scoped(tag, self), (context3) => get5(context3, tag));
}, annotateLogs2, annotateSpans2, withSpan2 = function() {
  const dataFirst = typeof arguments[0] !== "string";
  const name = dataFirst ? arguments[1] : arguments[0];
  const options = addSpanStackTrace(dataFirst ? arguments[2] : arguments[1]);
  if (dataFirst) {
    const self = arguments[0];
    return unwrapScoped(map8(options?.onEnd ? tap2(makeSpanScoped(name, options), (span2) => addFinalizer((exit2) => options.onEnd(span2, exit2))) : makeSpanScoped(name, options), (span2) => withParentSpan2(self, span2)));
  }
  return (self) => unwrapScoped(map8(options?.onEnd ? tap2(makeSpanScoped(name, options), (span2) => addFinalizer((exit2) => options.onEnd(span2, exit2))) : makeSpanScoped(name, options), (span2) => withParentSpan2(self, span2)));
}, withParentSpan2, provideSomeLayer, provideSomeRuntime, effect_provide;
var init_layer = __esm(() => {
  init_Cause();
  init_Clock();
  init_Context();
  init_Duration();
  init_FiberRefsPatch();
  init_Function();
  init_HashMap();
  init_Pipeable();
  init_Predicate();
  init_ScheduleDecision();
  init_ScheduleIntervals();
  init_Scope();
  init_core_effect();
  init_core();
  init_circular();
  init_executionStrategy();
  init_fiberRuntime();
  init_circular2();
  init_ref();
  init_runtime2();
  init_runtimeFlags();
  init_synchronizedRef();
  init_tracer();
  LayerTypeId = /* @__PURE__ */ Symbol.for(LayerSymbolKey);
  layerVariance = {
    _RIn: (_) => _,
    _E: (_) => _,
    _ROut: (_) => _
  };
  proto3 = {
    [LayerTypeId]: layerVariance,
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  MemoMapTypeId = /* @__PURE__ */ Symbol.for(MemoMapTypeIdKey);
  CurrentMemoMap = /* @__PURE__ */ Reference2()("effect/Layer/CurrentMemoMap", {
    defaultValue: () => unsafeMakeMemoMap()
  });
  MemoMapImpl = class MemoMapImpl {
    ref;
    [MemoMapTypeId];
    constructor(ref) {
      this.ref = ref;
      this[MemoMapTypeId] = MemoMapTypeId;
    }
    getOrElseMemoize(layer, scope2) {
      return pipe(modifyEffect(this.ref, (map11) => {
        const inMap = map11.get(layer);
        if (inMap !== undefined) {
          const [acquire, release] = inMap;
          const cached3 = pipe(acquire, flatMap7(([patch9, b]) => pipe(patchFiberRefs(patch9), as3(b))), onExit(exitMatch({
            onFailure: () => void_2,
            onSuccess: () => scopeAddFinalizerExit(scope2, release)
          })));
          return succeed([cached3, map11]);
        }
        return pipe(make23(0), flatMap7((observers) => pipe(deferredMake(), flatMap7((deferred) => pipe(make23(() => void_2), map8((finalizerRef) => {
          const resource = uninterruptibleMask((restore) => pipe(scopeMake(), flatMap7((innerScope) => pipe(restore(flatMap7(makeBuilder(layer, innerScope, true), (f) => diffFiberRefs(f(this)))), exit, flatMap7((exit2) => {
            switch (exit2._tag) {
              case OP_FAILURE: {
                return pipe(deferredFailCause(deferred, exit2.effect_instruction_i0), zipRight2(scopeClose(innerScope, exit2)), zipRight2(failCause(exit2.effect_instruction_i0)));
              }
              case OP_SUCCESS: {
                return pipe(set4(finalizerRef, (exit3) => pipe(scopeClose(innerScope, exit3), whenEffect(modify3(observers, (n) => [n === 1, n - 1])), asVoid2)), zipRight2(update2(observers, (n) => n + 1)), zipRight2(scopeAddFinalizerExit(scope2, (exit3) => pipe(sync(() => map11.delete(layer)), zipRight2(get10(finalizerRef)), flatMap7((finalizer) => finalizer(exit3))))), zipRight2(deferredSucceed(deferred, exit2.effect_instruction_i0)), as3(exit2.effect_instruction_i0[1]));
              }
            }
          })))));
          const memoized = [pipe(deferredAwait(deferred), onExit(exitMatchEffect({
            onFailure: () => void_2,
            onSuccess: () => update2(observers, (n) => n + 1)
          }))), (exit2) => pipe(get10(finalizerRef), flatMap7((finalizer) => finalizer(exit2)))];
          return [resource, isFresh(layer) ? map11 : map11.set(layer, memoized)];
        }))))));
      }), flatten5);
    }
  };
  makeMemoMap = /* @__PURE__ */ suspend(() => map8(makeSynchronized(new Map), (ref) => new MemoMapImpl(ref)));
  buildWithScope = /* @__PURE__ */ dual(2, (self, scope2) => flatMap7(makeMemoMap, (memoMap) => buildWithMemoMap(self, memoMap, scope2)));
  buildWithMemoMap = /* @__PURE__ */ dual(3, (self, memoMap, scope2) => flatMap7(makeBuilder(self, scope2), (run) => provideService(run(memoMap), CurrentMemoMap, memoMap)));
  catchAll2 = /* @__PURE__ */ dual(2, (self, onFailure) => match11(self, {
    onFailure,
    onSuccess: succeedContext
  }));
  catchAllCause2 = /* @__PURE__ */ dual(2, (self, onFailure) => matchCause2(self, {
    onFailure,
    onSuccess: succeedContext
  }));
  flatMap11 = /* @__PURE__ */ dual(2, (self, f) => match11(self, {
    onFailure: fail5,
    onSuccess: f
  }));
  flatten8 = /* @__PURE__ */ dual(2, (self, tag) => flatMap11(self, get5(tag)));
  fromEffect2 = /* @__PURE__ */ dual(2, (a, b) => {
    const tagFirst = isTag2(a);
    const tag = tagFirst ? a : b;
    const effect = tagFirst ? b : a;
    return fromEffectContext(map8(effect, (service) => make9(tag, service)));
  });
  fiberRefLocally2 = /* @__PURE__ */ dual(3, (self, ref, value) => locallyEffect(self, fiberRefLocally(ref, value)));
  locallyEffect = /* @__PURE__ */ dual(2, (self, f) => {
    const locally = Object.create(proto3);
    locally._op_layer = "Locally";
    locally.self = self;
    locally.f = f;
    return locally;
  });
  fiberRefLocallyWith2 = /* @__PURE__ */ dual(3, (self, ref, value) => locallyEffect(self, fiberRefLocallyWith(ref, value)));
  map11 = /* @__PURE__ */ dual(2, (self, f) => flatMap11(self, (context3) => succeedContext(f(context3))));
  mapError3 = /* @__PURE__ */ dual(2, (self, f) => catchAll2(self, (error) => failSync2(() => f(error))));
  matchCause2 = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => {
    const fold = Object.create(proto3);
    fold._op_layer = OP_FOLD;
    fold.layer = self;
    fold.failureK = onFailure;
    fold.successK = onSuccess;
    return fold;
  });
  match11 = /* @__PURE__ */ dual(2, (self, {
    onFailure,
    onSuccess
  }) => matchCause2(self, {
    onFailure: (cause2) => {
      const failureOrCause3 = failureOrCause2(cause2);
      switch (failureOrCause3._tag) {
        case "Left": {
          return onFailure(failureOrCause3.left);
        }
        case "Right": {
          return failCause4(failureOrCause3.right);
        }
      }
    },
    onSuccess
  }));
  merge6 = /* @__PURE__ */ dual(2, (self, that) => zipWith5(self, that, (a, b) => merge3(a, b)));
  orElse3 = /* @__PURE__ */ dual(2, (self, that) => catchAll2(self, that));
  project = /* @__PURE__ */ dual(4, (self, tagA, tagB, f) => map11(self, (context3) => make9(tagB, f(unsafeGet4(context3, tagA)))));
  retry = /* @__PURE__ */ dual(2, (self, schedule) => suspend2(() => {
    const stateTag = GenericTag("effect/Layer/retry/{ state: unknown }");
    return pipe(succeed4(stateTag, {
      state: schedule.initial
    }), flatMap11((env) => retryLoop(self, schedule, stateTag, pipe(env, get5(stateTag)).state)));
  }));
  scoped = /* @__PURE__ */ dual(2, (a, b) => {
    const tagFirst = isTag2(a);
    const tag = tagFirst ? a : b;
    const effect = tagFirst ? b : a;
    return scopedContext(map8(effect, (service) => make9(tag, service)));
  });
  scope2 = /* @__PURE__ */ scopedContext(/* @__PURE__ */ map8(/* @__PURE__ */ acquireRelease(/* @__PURE__ */ scopeMake(), (scope3, exit2) => scope3.close(exit2)), (scope3) => make9(Scope, scope3)));
  succeed4 = /* @__PURE__ */ dual(2, (a, b) => {
    const tagFirst = isTag2(a);
    const tag = tagFirst ? a : b;
    const resource = tagFirst ? b : a;
    return fromEffectContext(succeed(make9(tag, resource)));
  });
  empty27 = /* @__PURE__ */ succeedContext(/* @__PURE__ */ empty8());
  sync2 = /* @__PURE__ */ dual(2, (a, b) => {
    const tagFirst = isTag2(a);
    const tag = tagFirst ? a : b;
    const evaluate2 = tagFirst ? b : a;
    return fromEffectContext(sync(() => make9(tag, evaluate2())));
  });
  tap3 = /* @__PURE__ */ dual(2, (self, f) => flatMap11(self, (context3) => fromEffectContext(as3(f(context3), context3))));
  tapError2 = /* @__PURE__ */ dual(2, (self, f) => catchAll2(self, (e) => fromEffectContext(flatMap7(f(e), () => fail2(e)))));
  tapErrorCause2 = /* @__PURE__ */ dual(2, (self, f) => catchAllCause2(self, (cause2) => fromEffectContext(flatMap7(f(cause2), () => failCause(cause2)))));
  toRuntimeWithMemoMap = /* @__PURE__ */ dual(2, (self, memoMap) => flatMap7(scopeWith((scope3) => buildWithMemoMap(self, memoMap, scope3)), (context3) => pipe(runtime2(), provideContext(context3))));
  provide = /* @__PURE__ */ dual(2, (self, that) => suspend2(() => {
    const provideTo = Object.create(proto3);
    provideTo._op_layer = OP_PROVIDE;
    provideTo.first = Object.create(proto3, {
      _op_layer: {
        value: OP_PROVIDE_MERGE,
        enumerable: true
      },
      first: {
        value: context2(),
        enumerable: true
      },
      second: {
        value: Array.isArray(that) ? mergeAll4(...that) : that
      },
      zipK: {
        value: (a, b) => pipe(a, merge3(b))
      }
    });
    provideTo.second = self;
    return provideTo;
  }));
  provideMerge = /* @__PURE__ */ dual(2, (that, self) => {
    const zipWith5 = Object.create(proto3);
    zipWith5._op_layer = OP_PROVIDE_MERGE;
    zipWith5.first = self;
    zipWith5.second = provide(that, self);
    zipWith5.zipK = (a, b) => {
      return pipe(a, merge3(b));
    };
    return zipWith5;
  });
  zipWith5 = /* @__PURE__ */ dual(3, (self, that, f) => suspend2(() => {
    const zipWith6 = Object.create(proto3);
    zipWith6._op_layer = OP_ZIP_WITH2;
    zipWith6.first = self;
    zipWith6.second = that;
    zipWith6.zipK = f;
    return zipWith6;
  }));
  annotateLogs2 = /* @__PURE__ */ dual((args2) => isLayer(args2[0]), function() {
    const args2 = arguments;
    return fiberRefLocallyWith2(args2[0], currentLogAnnotations, typeof args2[1] === "string" ? set3(args2[1], args2[2]) : (annotations) => Object.entries(args2[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations));
  });
  annotateSpans2 = /* @__PURE__ */ dual((args2) => isLayer(args2[0]), function() {
    const args2 = arguments;
    return fiberRefLocallyWith2(args2[0], currentTracerSpanAnnotations, typeof args2[1] === "string" ? set3(args2[1], args2[2]) : (annotations) => Object.entries(args2[1]).reduce((acc, [key, value]) => set3(acc, key, value), annotations));
  });
  withParentSpan2 = /* @__PURE__ */ dual(2, (self, span2) => provide(self, succeedContext(make9(spanTag, span2))));
  provideSomeLayer = /* @__PURE__ */ dual(2, (self, layer) => scopedWith((scope3) => flatMap7(buildWithScope(layer, scope3), (context3) => provideSomeContext(self, context3))));
  provideSomeRuntime = /* @__PURE__ */ dual(2, (self, rt) => {
    const patchRefs = diff6(defaultRuntime.fiberRefs, rt.fiberRefs);
    const patchFlags = diff4(defaultRuntime.runtimeFlags, rt.runtimeFlags);
    return uninterruptibleMask((restore) => withFiberRuntime((fiber) => {
      const oldContext = fiber.getFiberRef(currentContext);
      const oldRefs = fiber.getFiberRefs();
      const newRefs = patch7(fiber.id(), oldRefs)(patchRefs);
      const oldFlags = fiber.currentRuntimeFlags;
      const newFlags = patch4(patchFlags)(oldFlags);
      const rollbackRefs = diff6(newRefs, oldRefs);
      const rollbackFlags = diff4(newFlags, oldFlags);
      fiber.setFiberRefs(newRefs);
      fiber.currentRuntimeFlags = newFlags;
      return ensuring(provideSomeContext(restore(self), merge3(oldContext, rt.context)), withFiberRuntime((fiber2) => {
        fiber2.setFiberRefs(patch7(fiber2.id(), fiber2.getFiberRefs())(rollbackRefs));
        fiber2.currentRuntimeFlags = patch4(rollbackFlags)(fiber2.currentRuntimeFlags);
        return void_2;
      }));
    }));
  });
  effect_provide = /* @__PURE__ */ dual(2, (self, source) => {
    if (Array.isArray(source)) {
      return provideSomeLayer(self, mergeAll4(...source));
    } else if (isLayer(source)) {
      return provideSomeLayer(self, source);
    } else if (isContext2(source)) {
      return provideSomeContext(self, source);
    } else if (TypeId13 in source) {
      return flatMap7(source.runtimeEffect, (rt) => provideSomeRuntime(self, rt));
    } else {
      return provideSomeRuntime(self, source);
    }
  });
});

// node_modules/effect/dist/esm/internal/console.js
var console2, consoleWith = (f) => fiberRefGetWith(currentServices, (services) => f(get5(services, consoleTag))), withConsole, withConsoleScoped = (console3) => fiberRefLocallyScopedWith(currentServices, add4(consoleTag, console3));
var init_console2 = __esm(() => {
  init_Context();
  init_Function();
  init_core();
  init_defaultServices();
  init_console();
  init_fiberRuntime();
  console2 = /* @__PURE__ */ map8(/* @__PURE__ */ fiberRefGet(currentServices), /* @__PURE__ */ get5(consoleTag));
  withConsole = /* @__PURE__ */ dual(2, (effect, value) => fiberRefLocallyWith(effect, currentServices, add4(consoleTag, value)));
});

// node_modules/effect/dist/esm/Random.js
var fixed2;
var init_Random = __esm(() => {
  init_random();
  fixed2 = fixed;
});

// node_modules/effect/dist/esm/internal/schedule.js
var ScheduleSymbolKey = "effect/Schedule", ScheduleTypeId, isSchedule = (u) => hasProperty(u, ScheduleTypeId), ScheduleDriverSymbolKey = "effect/ScheduleDriver", ScheduleDriverTypeId, defaultIterationMetadata, CurrentIterationMetadata, scheduleVariance, scheduleDriverVariance, ScheduleImpl, updateInfo = (iterationMetaRef, now, input, output) => update2(iterationMetaRef, (prev) => prev.recurrence === 0 ? {
  now,
  input,
  output,
  recurrence: prev.recurrence + 1,
  elapsed: zero,
  elapsedSincePrevious: zero,
  start: now
} : {
  now,
  input,
  output,
  recurrence: prev.recurrence + 1,
  elapsed: millis(now - prev.start),
  elapsedSincePrevious: millis(now - prev.now),
  start: prev.start
}), ScheduleDriverImpl, makeWithState = (initial, step3) => new ScheduleImpl(initial, step3), asVoid4 = (self) => map12(self, constVoid), check, checkEffect, driver = (self) => pipe(make23([none2(), self.initial]), map8((ref) => new ScheduleDriverImpl(self, ref))), intersect5, intersectWith, intersectWithLoop = (self, that, input, lState, out, lInterval, rState, out2, rInterval, f) => {
  const combined = f(lInterval, rInterval);
  if (isNonEmpty4(combined)) {
    return succeed([[lState, rState], [out, out2], _continue2(combined)]);
  }
  if (pipe(lInterval, lessThan5(rInterval))) {
    return flatMap7(self.step(end2(lInterval), input, lState), ([lState2, out3, decision]) => {
      if (isDone4(decision)) {
        return succeed([[lState2, rState], [out3, out2], done6]);
      }
      return intersectWithLoop(self, that, input, lState2, out3, decision.intervals, rState, out2, rInterval, f);
    });
  }
  return flatMap7(that.step(end2(rInterval), input, rState), ([rState2, out22, decision]) => {
    if (isDone4(decision)) {
      return succeed([[lState, rState2], [out, out22], done6]);
    }
    return intersectWithLoop(self, that, input, lState, out, lInterval, rState2, out22, decision.intervals, f);
  });
}, map12, mapEffect, passthrough2 = (self) => makeWithState(self.initial, (now, input, state) => pipe(self.step(now, input, state), map8(([state2, _, decision]) => [state2, input, decision]))), recurs = (n) => whileOutput(forever2, (out) => out < n), unfold2 = (initial, f) => makeWithState(initial, (now, _, state) => sync(() => [f(state), state, continueWith2(after2(now))])), untilInputEffect, whileInputEffect, whileOutput, ScheduleDefectTypeId, ScheduleDefect, isScheduleDefect = (u) => hasProperty(u, ScheduleDefectTypeId), scheduleDefectWrap = (self) => catchAll(self, (e) => die2(new ScheduleDefect(e))), scheduleDefectRefailCause = (cause2) => match2(find(cause2, (_) => isDieType(_) && isScheduleDefect(_.defect) ? some2(_.defect) : none2()), {
  onNone: () => cause2,
  onSome: (error) => fail(error.error)
}), scheduleDefectRefail = (effect) => catchAllCause(effect, (cause2) => failCause(scheduleDefectRefailCause(cause2))), repeat_Effect, repeat_combined, repeatOrElse_Effect, repeatOrElseEffectLoop = (self, driver2, orElse4, value) => matchEffect(driver2.next(value), {
  onFailure: () => orDie(driver2.last),
  onSuccess: (b) => matchEffect(self, {
    onFailure: (error) => orElse4(error, some2(b)),
    onSuccess: (value2) => repeatOrElseEffectLoop(self, driver2, orElse4, value2)
  })
}), retry_Effect, retry_combined, fromRetryOptions = (options) => {
  const base = options.schedule ?? forever2;
  const withWhile = options.while ? whileInputEffect(base, (e) => {
    const applied = options.while(e);
    if (typeof applied === "boolean") {
      return succeed(applied);
    }
    return scheduleDefectWrap(applied);
  }) : base;
  const withUntil = options.until ? untilInputEffect(withWhile, (e) => {
    const applied = options.until(e);
    if (typeof applied === "boolean") {
      return succeed(applied);
    }
    return scheduleDefectWrap(applied);
  }) : withWhile;
  return options.times !== undefined ? intersect5(withUntil, recurs(options.times)) : withUntil;
}, retryOrElse_Effect, retryOrElse_EffectLoop = (self, driver2, orElse4) => {
  return catchAll(self, (e) => matchEffect(driver2.next(e), {
    onFailure: () => pipe(driver2.last, orDie, flatMap7((out) => orElse4(e, out))),
    onSuccess: () => retryOrElse_EffectLoop(self, driver2, orElse4)
  }));
}, schedule_Effect, scheduleFrom_Effect, scheduleFrom_EffectLoop = (self, initial, driver2) => matchEffect(driver2.next(initial), {
  onFailure: () => orDie(driver2.last),
  onSuccess: () => flatMap7(self, (a) => scheduleFrom_EffectLoop(self, a, driver2))
}), forever2, once2, scheduleForked;
var init_schedule = __esm(() => {
  init_Clock();
  init_Context();
  init_Duration();
  init_Function();
  init_Option();
  init_Pipeable();
  init_Predicate();
  init_ScheduleDecision();
  init_ScheduleInterval();
  init_ScheduleIntervals();
  init_cause();
  init_core_effect();
  init_core();
  init_circular();
  init_ref();
  ScheduleTypeId = /* @__PURE__ */ Symbol.for(ScheduleSymbolKey);
  ScheduleDriverTypeId = /* @__PURE__ */ Symbol.for(ScheduleDriverSymbolKey);
  defaultIterationMetadata = {
    start: 0,
    now: 0,
    input: undefined,
    output: undefined,
    elapsed: zero,
    elapsedSincePrevious: zero,
    recurrence: 0
  };
  CurrentIterationMetadata = /* @__PURE__ */ Reference2()("effect/Schedule/CurrentIterationMetadata", {
    defaultValue: () => defaultIterationMetadata
  });
  scheduleVariance = {
    _Out: (_) => _,
    _In: (_) => _,
    _R: (_) => _
  };
  scheduleDriverVariance = {
    _Out: (_) => _,
    _In: (_) => _,
    _R: (_) => _
  };
  ScheduleImpl = class ScheduleImpl {
    initial;
    step;
    [ScheduleTypeId] = scheduleVariance;
    constructor(initial, step3) {
      this.initial = initial;
      this.step = step3;
    }
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  ScheduleDriverImpl = class ScheduleDriverImpl {
    schedule;
    ref;
    [ScheduleDriverTypeId] = scheduleDriverVariance;
    constructor(schedule, ref) {
      this.schedule = schedule;
      this.ref = ref;
    }
    get state() {
      return map8(get10(this.ref), (tuple) => tuple[1]);
    }
    get last() {
      return flatMap7(get10(this.ref), ([element, _]) => {
        switch (element._tag) {
          case "None": {
            return failSync(() => new NoSuchElementException);
          }
          case "Some": {
            return succeed(element.value);
          }
        }
      });
    }
    iterationMeta = /* @__PURE__ */ unsafeMake6(defaultIterationMetadata);
    get reset() {
      return set4(this.ref, [none2(), this.schedule.initial]).pipe(zipLeft2(set4(this.iterationMeta, defaultIterationMetadata)));
    }
    next(input) {
      return pipe(map8(get10(this.ref), (tuple) => tuple[1]), flatMap7((state) => pipe(currentTimeMillis2, flatMap7((now) => pipe(suspend(() => this.schedule.step(now, input, state)), flatMap7(([state2, out, decision]) => {
        const setState = set4(this.ref, [some2(out), state2]);
        if (isDone4(decision)) {
          return setState.pipe(zipRight2(fail2(none2())));
        }
        const millis2 = start2(decision.intervals) - now;
        if (millis2 <= 0) {
          return setState.pipe(zipRight2(updateInfo(this.iterationMeta, now, input, out)), as3(out));
        }
        const duration = millis(millis2);
        return pipe(setState, zipRight2(updateInfo(this.iterationMeta, now, input, out)), zipRight2(sleep3(duration)), as3(out));
      }))))));
    }
  };
  check = /* @__PURE__ */ dual(2, (self, test) => checkEffect(self, (input, out) => sync(() => test(input, out))));
  checkEffect = /* @__PURE__ */ dual(2, (self, test) => makeWithState(self.initial, (now, input, state) => flatMap7(self.step(now, input, state), ([state2, out, decision]) => {
    if (isDone4(decision)) {
      return succeed([state2, out, done6]);
    }
    return map8(test(input, out), (cont) => cont ? [state2, out, decision] : [state2, out, done6]);
  })));
  intersect5 = /* @__PURE__ */ dual(2, (self, that) => intersectWith(self, that, intersect4));
  intersectWith = /* @__PURE__ */ dual(3, (self, that, f) => makeWithState([self.initial, that.initial], (now, input, state) => pipe(zipWith3(self.step(now, input, state[0]), that.step(now, input, state[1]), (a, b) => [a, b]), flatMap7(([[lState, out, lDecision], [rState, out2, rDecision]]) => {
    if (isContinue2(lDecision) && isContinue2(rDecision)) {
      return intersectWithLoop(self, that, input, lState, out, lDecision.intervals, rState, out2, rDecision.intervals, f);
    }
    return succeed([[lState, rState], [out, out2], done6]);
  }))));
  map12 = /* @__PURE__ */ dual(2, (self, f) => mapEffect(self, (out) => sync(() => f(out))));
  mapEffect = /* @__PURE__ */ dual(2, (self, f) => makeWithState(self.initial, (now, input, state) => flatMap7(self.step(now, input, state), ([state2, out, decision]) => map8(f(out), (out2) => [state2, out2, decision]))));
  untilInputEffect = /* @__PURE__ */ dual(2, (self, f) => checkEffect(self, (input, _) => negate(f(input))));
  whileInputEffect = /* @__PURE__ */ dual(2, (self, f) => checkEffect(self, (input, _) => f(input)));
  whileOutput = /* @__PURE__ */ dual(2, (self, f) => check(self, (_, out) => f(out)));
  ScheduleDefectTypeId = /* @__PURE__ */ Symbol.for("effect/Schedule/ScheduleDefect");
  ScheduleDefect = class ScheduleDefect {
    error;
    [ScheduleDefectTypeId];
    constructor(error) {
      this.error = error;
      this[ScheduleDefectTypeId] = ScheduleDefectTypeId;
    }
  };
  repeat_Effect = /* @__PURE__ */ dual(2, (self, schedule) => repeatOrElse_Effect(self, schedule, (e, _) => fail2(e)));
  repeat_combined = /* @__PURE__ */ dual(2, (self, options) => {
    if (isSchedule(options)) {
      return repeat_Effect(self, options);
    }
    const base = options.schedule ?? passthrough2(forever2);
    const withWhile = options.while ? whileInputEffect(base, (a) => {
      const applied = options.while(a);
      if (typeof applied === "boolean") {
        return succeed(applied);
      }
      return scheduleDefectWrap(applied);
    }) : base;
    const withUntil = options.until ? untilInputEffect(withWhile, (a) => {
      const applied = options.until(a);
      if (typeof applied === "boolean") {
        return succeed(applied);
      }
      return scheduleDefectWrap(applied);
    }) : withWhile;
    const withTimes = options.times ? intersect5(withUntil, recurs(options.times)).pipe(map12((intersectionPair) => intersectionPair[0])) : withUntil;
    return scheduleDefectRefail(repeat_Effect(self, withTimes));
  });
  repeatOrElse_Effect = /* @__PURE__ */ dual(3, (self, schedule, orElse4) => flatMap7(driver(schedule), (driver2) => matchEffect(self, {
    onFailure: (error) => orElse4(error, none2()),
    onSuccess: (value) => repeatOrElseEffectLoop(provideServiceEffect(self, CurrentIterationMetadata, get10(driver2.iterationMeta)), driver2, (error, option2) => provideServiceEffect(orElse4(error, option2), CurrentIterationMetadata, get10(driver2.iterationMeta)), value)
  })));
  retry_Effect = /* @__PURE__ */ dual(2, (self, policy) => retryOrElse_Effect(self, policy, (e, _) => fail2(e)));
  retry_combined = /* @__PURE__ */ dual(2, (self, options) => {
    if (isSchedule(options)) {
      return retry_Effect(self, options);
    }
    return scheduleDefectRefail(retry_Effect(self, fromRetryOptions(options)));
  });
  retryOrElse_Effect = /* @__PURE__ */ dual(3, (self, policy, orElse4) => flatMap7(driver(policy), (driver2) => retryOrElse_EffectLoop(provideServiceEffect(self, CurrentIterationMetadata, get10(driver2.iterationMeta)), driver2, (e, out) => provideServiceEffect(orElse4(e, out), CurrentIterationMetadata, get10(driver2.iterationMeta)))));
  schedule_Effect = /* @__PURE__ */ dual(2, (self, schedule) => scheduleFrom_Effect(self, undefined, schedule));
  scheduleFrom_Effect = /* @__PURE__ */ dual(3, (self, initial, schedule) => flatMap7(driver(schedule), (driver2) => scheduleFrom_EffectLoop(provideServiceEffect(self, CurrentIterationMetadata, get10(driver2.iterationMeta)), initial, driver2)));
  forever2 = /* @__PURE__ */ unfold2(0, (n) => n + 1);
  once2 = /* @__PURE__ */ asVoid4(/* @__PURE__ */ recurs(1));
  scheduleForked = /* @__PURE__ */ dual(2, (self, schedule) => forkScoped(schedule_Effect(self, schedule)));
});

// node_modules/effect/dist/esm/internal/executionPlan.js
var withExecutionPlan, scheduleFromStep = (step3, first) => {
  if (!first) {
    return fromRetryOptions({
      schedule: step3.schedule ? step3.schedule : step3.attempts ? undefined : once2,
      times: step3.attempts,
      while: step3.while
    });
  } else if (step3.attempts === 1 || !(step3.schedule || step3.attempts)) {
    return;
  }
  return fromRetryOptions({
    schedule: step3.schedule,
    while: step3.while,
    times: step3.attempts ? step3.attempts - 1 : undefined
  });
};
var init_executionPlan = __esm(() => {
  init_Either();
  init_Function();
  init_core();
  init_layer();
  init_schedule();
  withExecutionPlan = /* @__PURE__ */ dual(2, (effect, plan) => suspend(() => {
    let i = 0;
    let result;
    return flatMap7(whileLoop({
      while: () => i < plan.steps.length && (result === undefined || isLeft2(result)),
      body: () => {
        const step3 = plan.steps[i];
        let nextEffect = effect_provide(effect, step3.provide);
        if (result) {
          let attempted = false;
          const wrapped = nextEffect;
          nextEffect = suspend(() => {
            if (attempted)
              return wrapped;
            attempted = true;
            return result;
          });
          nextEffect = scheduleDefectRefail(retry_Effect(nextEffect, scheduleFromStep(step3, false)));
        } else {
          const schedule = scheduleFromStep(step3, true);
          nextEffect = schedule ? scheduleDefectRefail(retry_Effect(nextEffect, schedule)) : nextEffect;
        }
        return either2(nextEffect);
      },
      step: (either3) => {
        result = either3;
        i++;
      }
    }), () => result);
  }));
});

// node_modules/effect/dist/esm/MutableList.js
var TypeId14, MutableListProto, makeNode = (value) => ({
  value,
  removed: false,
  prev: undefined,
  next: undefined
}), empty28 = () => {
  const list = Object.create(MutableListProto);
  list.head = undefined;
  list.tail = undefined;
  list._length = 0;
  return list;
}, isEmpty9 = (self) => length(self) === 0, length = (self) => self._length, append3, shift = (self) => {
  const head4 = self.head;
  if (head4 !== undefined) {
    remove6(self, head4);
    return head4.value;
  }
  return;
}, remove6 = (self, node) => {
  if (node.removed) {
    return;
  }
  node.removed = true;
  if (node.prev !== undefined && node.next !== undefined) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  } else if (node.prev !== undefined) {
    self.tail = node.prev;
    node.prev.next = undefined;
  } else if (node.next !== undefined) {
    self.head = node.next;
    node.next.prev = undefined;
  } else {
    self.tail = undefined;
    self.head = undefined;
  }
  if (self._length > 0) {
    self._length -= 1;
  }
};
var init_MutableList = __esm(() => {
  init_Function();
  init_Inspectable();
  init_Pipeable();
  TypeId14 = /* @__PURE__ */ Symbol.for("effect/MutableList");
  MutableListProto = {
    [TypeId14]: TypeId14,
    [Symbol.iterator]() {
      let done7 = false;
      let head4 = this.head;
      return {
        next() {
          if (done7) {
            return this.return();
          }
          if (head4 == null) {
            done7 = true;
            return this.return();
          }
          const value = head4.value;
          head4 = head4.next;
          return {
            done: done7,
            value
          };
        },
        return(value) {
          if (!done7) {
            done7 = true;
          }
          return {
            done: true,
            value
          };
        }
      };
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "MutableList",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  append3 = /* @__PURE__ */ dual(2, (self, value) => {
    const node = makeNode(value);
    if (self.head === undefined) {
      self.head = node;
    }
    if (self.tail === undefined) {
      self.tail = node;
    } else {
      self.tail.next = node;
      node.prev = self.tail;
      self.tail = node;
    }
    self._length += 1;
    return self;
  });
});

// node_modules/effect/dist/esm/MutableQueue.js
var TypeId15, EmptyMutableQueue, MutableQueueProto, make37 = (capacity) => {
  const queue = Object.create(MutableQueueProto);
  queue.queue = empty28();
  queue.capacity = capacity;
  return queue;
}, unbounded = () => make37(undefined), offer, poll;
var init_MutableQueue = __esm(() => {
  init_Function();
  init_Inspectable();
  init_MutableList();
  init_Pipeable();
  TypeId15 = /* @__PURE__ */ Symbol.for("effect/MutableQueue");
  EmptyMutableQueue = /* @__PURE__ */ Symbol.for("effect/mutable/MutableQueue/Empty");
  MutableQueueProto = {
    [TypeId15]: TypeId15,
    [Symbol.iterator]() {
      return Array.from(this.queue)[Symbol.iterator]();
    },
    toString() {
      return format(this.toJSON());
    },
    toJSON() {
      return {
        _id: "MutableQueue",
        values: Array.from(this).map(toJSON)
      };
    },
    [NodeInspectSymbol]() {
      return this.toJSON();
    },
    pipe() {
      return pipeArguments(this, arguments);
    }
  };
  offer = /* @__PURE__ */ dual(2, (self, value) => {
    const queueLength = length(self.queue);
    if (self.capacity !== undefined && queueLength === self.capacity) {
      return false;
    }
    append3(value)(self.queue);
    return true;
  });
  poll = /* @__PURE__ */ dual(2, (self, def) => {
    if (isEmpty9(self.queue)) {
      return def;
    }
    return shift(self.queue);
  });
});

// node_modules/effect/dist/esm/internal/cache.js
class KeySetImpl {
  head = undefined;
  tail = undefined;
  add(key) {
    if (key !== this.tail) {
      if (this.tail === undefined) {
        this.head = key;
        this.tail = key;
      } else {
        const previous = key.previous;
        const next = key.next;
        if (next !== undefined) {
          key.next = undefined;
          if (previous !== undefined) {
            previous.next = next;
            next.previous = previous;
          } else {
            this.head = next;
            this.head.previous = undefined;
          }
        }
        this.tail.next = key;
        key.previous = this.tail;
        this.tail = key;
      }
    }
  }
  remove() {
    const key = this.head;
    if (key !== undefined) {
      const next = key.next;
      if (next !== undefined) {
        key.next = undefined;
        this.head = next;
        this.head.previous = undefined;
      } else {
        this.head = undefined;
        this.tail = undefined;
      }
    }
    return key;
  }
}
var complete2 = (key, exit2, entryStats, timeToLiveMillis) => struct({
  _tag: "Complete",
  key,
  exit: exit2,
  entryStats,
  timeToLiveMillis
}), pending2 = (key, deferred) => struct({
  _tag: "Pending",
  key,
  deferred
}), refreshing = (deferred, complete3) => struct({
  _tag: "Refreshing",
  deferred,
  complete: complete3
}), MapKeyTypeId, MapKeyImpl, makeMapKey = (current) => new MapKeyImpl(current), isMapKey = (u) => hasProperty(u, MapKeyTypeId), makeKeySet = () => new KeySetImpl, makeCacheState = (map13, keys3, accesses, updating, hits, misses) => ({
  map: map13,
  keys: keys3,
  accesses,
  updating,
  hits,
  misses
}), initialCacheState = () => makeCacheState(empty22(), makeKeySet(), unbounded(), make11(false), 0, 0), CacheSymbolKey = "effect/Cache", CacheTypeId, cacheVariance, ConsumerCacheSymbolKey = "effect/ConsumerCache", ConsumerCacheTypeId, consumerCacheVariance, makeCacheStats = (options) => options, makeEntryStats = (loadedMillis) => ({
  loadedMillis
}), CacheImpl, unsafeMakeWith = (capacity, lookup, timeToLive) => new CacheImpl(capacity, empty8(), none3, lookup, (exit2) => decode(timeToLive(exit2)));
var init_cache = __esm(() => {
  init_Context();
  init_Deferred();
  init_Duration();
  init_Either();
  init_Equal();
  init_Exit();
  init_Function();
  init_Hash();
  init_MutableHashMap();
  init_MutableQueue();
  init_MutableRef();
  init_Option();
  init_Predicate();
  init_core_effect();
  init_core();
  init_data();
  init_fiberId();
  MapKeyTypeId = /* @__PURE__ */ Symbol.for("effect/Cache/MapKey");
  MapKeyImpl = class MapKeyImpl {
    current;
    [MapKeyTypeId] = MapKeyTypeId;
    previous = undefined;
    next = undefined;
    constructor(current) {
      this.current = current;
    }
    [symbol]() {
      return pipe(hash(this.current), combine(hash(this.previous)), combine(hash(this.next)), cached(this));
    }
    [symbol2](that) {
      if (this === that) {
        return true;
      }
      return isMapKey(that) && equals(this.current, that.current) && equals(this.previous, that.previous) && equals(this.next, that.next);
    }
  };
  CacheTypeId = /* @__PURE__ */ Symbol.for(CacheSymbolKey);
  cacheVariance = {
    _Key: (_) => _,
    _Error: (_) => _,
    _Value: (_) => _
  };
  ConsumerCacheTypeId = /* @__PURE__ */ Symbol.for(ConsumerCacheSymbolKey);
  consumerCacheVariance = {
    _Key: (_) => _,
    _Error: (_) => _,
    _Value: (_) => _
  };
  CacheImpl = class CacheImpl {
    capacity;
    context;
    fiberId;
    lookup;
    timeToLive;
    [CacheTypeId] = cacheVariance;
    [ConsumerCacheTypeId] = consumerCacheVariance;
    cacheState;
    constructor(capacity, context3, fiberId2, lookup, timeToLive) {
      this.capacity = capacity;
      this.context = context3;
      this.fiberId = fiberId2;
      this.lookup = lookup;
      this.timeToLive = timeToLive;
      this.cacheState = initialCacheState();
    }
    get(key) {
      return map8(this.getEither(key), merge);
    }
    get cacheStats() {
      return sync(() => makeCacheStats({
        hits: this.cacheState.hits,
        misses: this.cacheState.misses,
        size: size6(this.cacheState.map)
      }));
    }
    getOption(key) {
      return suspend(() => match2(get12(this.cacheState.map, key), {
        onNone: () => {
          const mapKey = makeMapKey(key);
          this.trackAccess(mapKey);
          this.trackMiss();
          return succeed(none2());
        },
        onSome: (value) => this.resolveMapValue(value)
      }));
    }
    getOptionComplete(key) {
      return suspend(() => match2(get12(this.cacheState.map, key), {
        onNone: () => {
          const mapKey = makeMapKey(key);
          this.trackAccess(mapKey);
          this.trackMiss();
          return succeed(none2());
        },
        onSome: (value) => this.resolveMapValue(value, true)
      }));
    }
    contains(key) {
      return sync(() => has4(this.cacheState.map, key));
    }
    entryStats(key) {
      return sync(() => {
        const option2 = get12(this.cacheState.map, key);
        if (isSome2(option2)) {
          switch (option2.value._tag) {
            case "Complete": {
              const loaded = option2.value.entryStats.loadedMillis;
              return some2(makeEntryStats(loaded));
            }
            case "Pending": {
              return none2();
            }
            case "Refreshing": {
              const loaded = option2.value.complete.entryStats.loadedMillis;
              return some2(makeEntryStats(loaded));
            }
          }
        }
        return none2();
      });
    }
    getEither(key) {
      return suspend(() => {
        const k = key;
        let mapKey = undefined;
        let deferred = undefined;
        let value = getOrUndefined(get12(this.cacheState.map, k));
        if (value === undefined) {
          deferred = unsafeMake4(this.fiberId);
          mapKey = makeMapKey(k);
          if (has4(this.cacheState.map, k)) {
            value = getOrUndefined(get12(this.cacheState.map, k));
          } else {
            set5(this.cacheState.map, k, pending2(mapKey, deferred));
          }
        }
        if (value === undefined) {
          this.trackAccess(mapKey);
          this.trackMiss();
          return map8(this.lookupValueOf(key, deferred), right2);
        } else {
          return flatMap7(this.resolveMapValue(value), match2({
            onNone: () => this.getEither(key),
            onSome: (value2) => succeed(left2(value2))
          }));
        }
      });
    }
    invalidate(key) {
      return sync(() => {
        remove5(this.cacheState.map, key);
      });
    }
    invalidateWhen(key, when2) {
      return sync(() => {
        const value = get12(this.cacheState.map, key);
        if (isSome2(value) && value.value._tag === "Complete") {
          if (value.value.exit._tag === "Success") {
            if (when2(value.value.exit.value)) {
              remove5(this.cacheState.map, key);
            }
          }
        }
      });
    }
    get invalidateAll() {
      return sync(() => {
        this.cacheState.map = empty22();
      });
    }
    refresh(key) {
      return clockWith3((clock2) => suspend(() => {
        const k = key;
        const deferred = unsafeMake4(this.fiberId);
        let value = getOrUndefined(get12(this.cacheState.map, k));
        if (value === undefined) {
          if (has4(this.cacheState.map, k)) {
            value = getOrUndefined(get12(this.cacheState.map, k));
          } else {
            set5(this.cacheState.map, k, pending2(makeMapKey(k), deferred));
          }
        }
        if (value === undefined) {
          return asVoid2(this.lookupValueOf(key, deferred));
        } else {
          switch (value._tag) {
            case "Complete": {
              if (this.hasExpired(clock2, value.timeToLiveMillis)) {
                const found = getOrUndefined(get12(this.cacheState.map, k));
                if (equals(found, value)) {
                  remove5(this.cacheState.map, k);
                }
                return asVoid2(this.get(key));
              }
              return pipe(this.lookupValueOf(key, deferred), when(() => {
                const current = getOrUndefined(get12(this.cacheState.map, k));
                if (equals(current, value)) {
                  const mapValue = refreshing(deferred, value);
                  set5(this.cacheState.map, k, mapValue);
                  return true;
                }
                return false;
              }), asVoid2);
            }
            case "Pending": {
              return _await(value.deferred);
            }
            case "Refreshing": {
              return _await(value.deferred);
            }
          }
        }
      }));
    }
    set(key, value) {
      return clockWith3((clock2) => sync(() => {
        const now = clock2.unsafeCurrentTimeMillis();
        const k = key;
        const lookupResult = succeed3(value);
        const mapValue = complete2(makeMapKey(k), lookupResult, makeEntryStats(now), now + toMillis(decode(this.timeToLive(lookupResult))));
        set5(this.cacheState.map, k, mapValue);
      }));
    }
    get size() {
      return sync(() => {
        return size6(this.cacheState.map);
      });
    }
    get values() {
      return sync(() => {
        const values3 = [];
        for (const entry of this.cacheState.map) {
          if (entry[1]._tag === "Complete" && entry[1].exit._tag === "Success") {
            values3.push(entry[1].exit.value);
          }
        }
        return values3;
      });
    }
    get entries() {
      return sync(() => {
        const values3 = [];
        for (const entry of this.cacheState.map) {
          if (entry[1]._tag === "Complete" && entry[1].exit._tag === "Success") {
            values3.push([entry[0], entry[1].exit.value]);
          }
        }
        return values3;
      });
    }
    get keys() {
      return sync(() => {
        const keys3 = [];
        for (const entry of this.cacheState.map) {
          if (entry[1]._tag === "Complete" && entry[1].exit._tag === "Success") {
            keys3.push(entry[0]);
          }
        }
        return keys3;
      });
    }
    resolveMapValue(value, ignorePending = false) {
      return clockWith3((clock2) => {
        switch (value._tag) {
          case "Complete": {
            this.trackAccess(value.key);
            if (this.hasExpired(clock2, value.timeToLiveMillis)) {
              remove5(this.cacheState.map, value.key.current);
              return succeed(none2());
            }
            this.trackHit();
            return map8(value.exit, some2);
          }
          case "Pending": {
            this.trackAccess(value.key);
            this.trackHit();
            if (ignorePending) {
              return succeed(none2());
            }
            return map8(_await(value.deferred), some2);
          }
          case "Refreshing": {
            this.trackAccess(value.complete.key);
            this.trackHit();
            if (this.hasExpired(clock2, value.complete.timeToLiveMillis)) {
              if (ignorePending) {
                return succeed(none2());
              }
              return map8(_await(value.deferred), some2);
            }
            return map8(value.complete.exit, some2);
          }
        }
      });
    }
    trackHit() {
      this.cacheState.hits = this.cacheState.hits + 1;
    }
    trackMiss() {
      this.cacheState.misses = this.cacheState.misses + 1;
    }
    trackAccess(key) {
      offer(this.cacheState.accesses, key);
      if (compareAndSet(this.cacheState.updating, false, true)) {
        let loop2 = true;
        while (loop2) {
          const key2 = poll(this.cacheState.accesses, EmptyMutableQueue);
          if (key2 === EmptyMutableQueue) {
            loop2 = false;
          } else {
            this.cacheState.keys.add(key2);
          }
        }
        let size9 = size6(this.cacheState.map);
        loop2 = size9 > this.capacity;
        while (loop2) {
          const key2 = this.cacheState.keys.remove();
          if (key2 !== undefined) {
            if (has4(this.cacheState.map, key2.current)) {
              remove5(this.cacheState.map, key2.current);
              size9 = size9 - 1;
              loop2 = size9 > this.capacity;
            }
          } else {
            loop2 = false;
          }
        }
        set2(this.cacheState.updating, false);
      }
    }
    hasExpired(clock2, timeToLiveMillis) {
      return clock2.unsafeCurrentTimeMillis() > timeToLiveMillis;
    }
    lookupValueOf(input, deferred) {
      return clockWith3((clock2) => suspend(() => {
        const key = input;
        return pipe(this.lookup(input), provideContext(this.context), exit, flatMap7((exit2) => {
          const now = clock2.unsafeCurrentTimeMillis();
          const stats = makeEntryStats(now);
          const value = complete2(makeMapKey(key), exit2, stats, now + toMillis(decode(this.timeToLive(exit2))));
          set5(this.cacheState.map, key, value);
          return zipRight2(done2(deferred, exit2), exit2);
        }), onInterrupt(() => zipRight2(interrupt4(deferred), sync(() => {
          remove5(this.cacheState.map, key);
        }))));
      }));
    }
  };
});

// node_modules/effect/dist/esm/internal/query.js
var currentCache, currentCacheEnabled, fromRequest = (request, dataSource) => flatMap7(isEffect(dataSource) ? dataSource : succeed(dataSource), (ds) => fiberIdWith((id) => {
  const proxy = new Proxy(request, {});
  return fiberRefGetWith(currentCacheEnabled, (cacheEnabled) => {
    if (cacheEnabled) {
      const cached3 = fiberRefGetWith(currentCache, (cache) => flatMap7(cache.getEither(proxy), (orNew) => {
        switch (orNew._tag) {
          case "Left": {
            if (orNew.left.listeners.interrupted) {
              return flatMap7(cache.invalidateWhen(proxy, (entry) => entry.handle === orNew.left.handle), () => cached3);
            }
            orNew.left.listeners.increment();
            return uninterruptibleMask((restore) => flatMap7(exit(blocked(empty16, restore(deferredAwait(orNew.left.handle)))), (exit2) => {
              orNew.left.listeners.decrement();
              return exit2;
            }));
          }
          case "Right": {
            orNew.right.listeners.increment();
            return uninterruptibleMask((restore) => flatMap7(exit(blocked(single(ds, makeEntry({
              request: proxy,
              result: orNew.right.handle,
              listeners: orNew.right.listeners,
              ownerId: id,
              state: {
                completed: false
              }
            })), restore(deferredAwait(orNew.right.handle)))), () => {
              orNew.right.listeners.decrement();
              return deferredAwait(orNew.right.handle);
            }));
          }
        }
      }));
      return cached3;
    }
    const listeners = new Listeners;
    listeners.increment();
    return flatMap7(deferredMake(), (ref) => ensuring(blocked(single(ds, makeEntry({
      request: proxy,
      result: ref,
      listeners,
      ownerId: id,
      state: {
        completed: false
      }
    })), deferredAwait(ref)), sync(() => listeners.decrement())));
  });
})), cacheRequest = (request, result) => {
  return fiberRefGetWith(currentCacheEnabled, (cacheEnabled) => {
    if (cacheEnabled) {
      return fiberRefGetWith(currentCache, (cache) => flatMap7(cache.getEither(request), (orNew) => {
        switch (orNew._tag) {
          case "Left": {
            return void_2;
          }
          case "Right": {
            return deferredComplete(orNew.right.handle, result);
          }
        }
      }));
    }
    return void_2;
  });
}, withRequestCaching, withRequestCache;
var init_query = __esm(() => {
  init_Duration();
  init_Function();
  init_blockedRequests();
  init_cache();
  init_core();
  init_fiberRuntime();
  init_request();
  currentCache = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentCache"), () => fiberRefUnsafeMake(unsafeMakeWith(65536, () => map8(deferredMake(), (handle) => ({
    listeners: new Listeners,
    handle
  })), () => seconds(60))));
  currentCacheEnabled = /* @__PURE__ */ globalValue(/* @__PURE__ */ Symbol.for("effect/FiberRef/currentCacheEnabled"), () => fiberRefUnsafeMake(false));
  withRequestCaching = /* @__PURE__ */ dual(2, (self, strategy) => fiberRefLocally(self, currentCacheEnabled, strategy));
  withRequestCache = /* @__PURE__ */ dual(2, (self, cache) => fiberRefLocally(self, currentCache, cache));
});

// node_modules/effect/dist/esm/Request.js
var isRequest2;
var init_Request = __esm(() => {
  init_request();
  isRequest2 = isRequest;
});

// node_modules/effect/dist/esm/Effect.js
var exports_Effect = {};
__export(exports_Effect, {
  zipWith: () => zipWith6,
  zipRight: () => zipRight4,
  zipLeft: () => zipLeft4,
  zip: () => zip5,
  yieldNow: () => yieldNow4,
  withUnhandledErrorLogLevel: () => withUnhandledErrorLogLevel2,
  withTracerTiming: () => withTracerTiming2,
  withTracerScoped: () => withTracerScoped2,
  withTracerEnabled: () => withTracerEnabled2,
  withTracer: () => withTracer2,
  withSpanScoped: () => withSpanScoped2,
  withSpan: () => withSpan3,
  withSchedulingPriority: () => withSchedulingPriority2,
  withScheduler: () => withScheduler2,
  withRuntimeFlagsPatchScoped: () => withRuntimeFlagsPatchScoped,
  withRuntimeFlagsPatch: () => withRuntimeFlagsPatch,
  withRequestCaching: () => withRequestCaching2,
  withRequestCache: () => withRequestCache2,
  withRequestBatching: () => withRequestBatching2,
  withRandomScoped: () => withRandomScoped2,
  withRandomFixed: () => withRandomFixed,
  withRandom: () => withRandom2,
  withParentSpan: () => withParentSpan3,
  withMetric: () => withMetric2,
  withMaxOpsBeforeYield: () => withMaxOpsBeforeYield2,
  withLogSpan: () => withLogSpan2,
  withFiberRuntime: () => withFiberRuntime2,
  withExecutionPlan: () => withExecutionPlan2,
  withEarlyRelease: () => withEarlyRelease2,
  withConsoleScoped: () => withConsoleScoped2,
  withConsole: () => withConsole2,
  withConfigProviderScoped: () => withConfigProviderScoped2,
  withConfigProvider: () => withConfigProvider2,
  withConcurrency: () => withConcurrency2,
  withClockScoped: () => withClockScoped2,
  withClock: () => withClock2,
  whileLoop: () => whileLoop2,
  whenRef: () => whenRef2,
  whenLogLevel: () => whenLogLevel2,
  whenFiberRef: () => whenFiberRef2,
  whenEffect: () => whenEffect2,
  when: () => when2,
  void: () => _void,
  validateWith: () => validateWith2,
  validateFirst: () => validateFirst2,
  validateAll: () => validateAll2,
  validate: () => validate2,
  using: () => using2,
  useSpan: () => useSpan2,
  updateService: () => updateService2,
  updateFiberRefs: () => updateFiberRefs2,
  unsandbox: () => unsandbox2,
  unsafeMakeSemaphore: () => unsafeMakeSemaphore2,
  unsafeMakeLatch: () => unsafeMakeLatch2,
  unlessEffect: () => unlessEffect2,
  unless: () => unless2,
  uninterruptibleMask: () => uninterruptibleMask3,
  uninterruptible: () => uninterruptible2,
  tryPromise: () => tryPromise2,
  tryMapPromise: () => tryMapPromise2,
  tryMap: () => tryMap2,
  try: () => try_2,
  transposeOption: () => transposeOption,
  transposeMapOption: () => transposeMapOption,
  transplant: () => transplant2,
  tracerWith: () => tracerWith4,
  tracer: () => tracer2,
  timeoutTo: () => timeoutTo2,
  timeoutOption: () => timeoutOption2,
  timeoutFailCause: () => timeoutFailCause2,
  timeoutFail: () => timeoutFail2,
  timeout: () => timeout2,
  timedWith: () => timedWith2,
  timed: () => timed2,
  tapErrorTag: () => tapErrorTag2,
  tapErrorCause: () => tapErrorCause3,
  tapError: () => tapError3,
  tapDefect: () => tapDefect2,
  tapBoth: () => tapBoth2,
  tap: () => tap4,
  takeWhile: () => takeWhile2,
  takeUntil: () => takeUntil2,
  tagMetricsScoped: () => tagMetricsScoped2,
  tagMetrics: () => tagMetrics2,
  sync: () => sync3,
  suspend: () => suspend3,
  supervised: () => supervised2,
  summarized: () => summarized2,
  succeedSome: () => succeedSome2,
  succeedNone: () => succeedNone2,
  succeed: () => succeed6,
  step: () => step3,
  spanLinks: () => spanLinks2,
  spanAnnotations: () => spanAnnotations2,
  sleep: () => sleep4,
  setFiberRefs: () => setFiberRefs2,
  serviceOptional: () => serviceOptional2,
  serviceOption: () => serviceOption2,
  serviceMembers: () => serviceMembers2,
  serviceFunctions: () => serviceFunctions2,
  serviceFunctionEffect: () => serviceFunctionEffect2,
  serviceFunction: () => serviceFunction2,
  serviceConstants: () => serviceConstants2,
  sequentialFinalizers: () => sequentialFinalizers2,
  scopedWith: () => scopedWith2,
  scoped: () => scoped2,
  scopeWith: () => scopeWith2,
  scope: () => scope3,
  scheduleFrom: () => scheduleFrom,
  scheduleForked: () => scheduleForked2,
  schedule: () => schedule,
  sandbox: () => sandbox2,
  runtime: () => runtime3,
  runSyncExit: () => runSyncExit,
  runSync: () => runSync,
  runRequestBlock: () => runRequestBlock2,
  runPromiseExit: () => runPromiseExit,
  runPromise: () => runPromise,
  runFork: () => runFork2,
  runCallback: () => runCallback,
  retryOrElse: () => retryOrElse,
  retry: () => retry2,
  request: () => request,
  replicateEffect: () => replicateEffect2,
  replicate: () => replicate2,
  repeatOrElse: () => repeatOrElse,
  repeatN: () => repeatN2,
  repeat: () => repeat,
  reduceWhile: () => reduceWhile2,
  reduceRight: () => reduceRight3,
  reduceEffect: () => reduceEffect2,
  reduce: () => reduce10,
  randomWith: () => randomWith2,
  random: () => random3,
  raceWith: () => raceWith2,
  raceFirst: () => raceFirst2,
  raceAll: () => raceAll2,
  race: () => race2,
  provideServiceEffect: () => provideServiceEffect2,
  provideService: () => provideService2,
  provide: () => provide2,
  promise: () => promise2,
  patchRuntimeFlags: () => patchRuntimeFlags,
  patchFiberRefs: () => patchFiberRefs2,
  partition: () => partition4,
  parallelFinalizers: () => parallelFinalizers2,
  parallelErrors: () => parallelErrors2,
  orElseSucceed: () => orElseSucceed2,
  orElseFail: () => orElseFail2,
  orElse: () => orElse4,
  orDieWith: () => orDieWith2,
  orDie: () => orDie3,
  optionFromOptional: () => optionFromOptional2,
  option: () => option2,
  once: () => once3,
  onInterrupt: () => onInterrupt2,
  onExit: () => onExit3,
  onError: () => onError2,
  none: () => none9,
  never: () => never2,
  negate: () => negate2,
  metricLabels: () => metricLabels2,
  mergeAll: () => mergeAll5,
  merge: () => merge7,
  matchEffect: () => matchEffect3,
  matchCauseEffect: () => matchCauseEffect3,
  matchCause: () => matchCause3,
  match: () => match12,
  mapInputContext: () => mapInputContext2,
  mapErrorCause: () => mapErrorCause3,
  mapError: () => mapError4,
  mapBoth: () => mapBoth3,
  mapAccum: () => mapAccum3,
  map: () => map13,
  makeSpanScoped: () => makeSpanScoped2,
  makeSpan: () => makeSpan2,
  makeSemaphore: () => makeSemaphore2,
  makeLatch: () => makeLatch2,
  loop: () => loop2,
  logWithLevel: () => logWithLevel2,
  logWarning: () => logWarning2,
  logTrace: () => logTrace2,
  logInfo: () => logInfo2,
  logFatal: () => logFatal2,
  logError: () => logError2,
  logDebug: () => logDebug2,
  logAnnotations: () => logAnnotations2,
  log: () => log2,
  locallyWith: () => locallyWith,
  locallyScopedWith: () => locallyScopedWith,
  locallyScoped: () => locallyScoped,
  locally: () => locally,
  linkSpans: () => linkSpans2,
  linkSpanCurrent: () => linkSpanCurrent2,
  liftPredicate: () => liftPredicate3,
  let: () => let_4,
  labelMetricsScoped: () => labelMetricsScoped2,
  labelMetrics: () => labelMetrics2,
  iterate: () => iterate2,
  isSuccess: () => isSuccess3,
  isFailure: () => isFailure5,
  isEffect: () => isEffect2,
  intoDeferred: () => intoDeferred2,
  interruptibleMask: () => interruptibleMask2,
  interruptible: () => interruptible4,
  interruptWith: () => interruptWith2,
  interrupt: () => interrupt6,
  inheritFiberRefs: () => inheritFiberRefs2,
  ignoreLogged: () => ignoreLogged2,
  ignore: () => ignore2,
  if: () => if_2,
  head: () => head4,
  getRuntimeFlags: () => getRuntimeFlags,
  getFiberRefs: () => getFiberRefs,
  gen: () => gen3,
  functionWithSpan: () => functionWithSpan2,
  fromNullable: () => fromNullable3,
  fromFiberEffect: () => fromFiberEffect2,
  fromFiber: () => fromFiber2,
  forkWithErrorHandler: () => forkWithErrorHandler2,
  forkScoped: () => forkScoped2,
  forkIn: () => forkIn2,
  forkDaemon: () => forkDaemon2,
  forkAll: () => forkAll2,
  fork: () => fork3,
  forever: () => forever3,
  forEach: () => forEach5,
  fnUntraced: () => fnUntraced2,
  fn: () => fn,
  flipWith: () => flipWith2,
  flip: () => flip2,
  flatten: () => flatten9,
  flatMap: () => flatMap12,
  firstSuccessOf: () => firstSuccessOf2,
  findFirst: () => findFirst4,
  finalizersMask: () => finalizersMask2,
  filterOrFail: () => filterOrFail2,
  filterOrElse: () => filterOrElse2,
  filterOrDieMessage: () => filterOrDieMessage2,
  filterOrDie: () => filterOrDie2,
  filterMap: () => filterMap5,
  filterEffectOrFail: () => filterEffectOrFail2,
  filterEffectOrElse: () => filterEffectOrElse2,
  filter: () => filter8,
  fiberIdWith: () => fiberIdWith2,
  fiberId: () => fiberId2,
  failSync: () => failSync3,
  failCauseSync: () => failCauseSync3,
  failCause: () => failCause6,
  fail: () => fail7,
  exit: () => exit2,
  exists: () => exists4,
  every: () => every5,
  eventually: () => eventually2,
  ensuringChildren: () => ensuringChildren2,
  ensuringChild: () => ensuringChild2,
  ensuring: () => ensuring2,
  ensureSuccessType: () => ensureSuccessType,
  ensureRequirementsType: () => ensureRequirementsType,
  ensureErrorType: () => ensureErrorType,
  either: () => either3,
  dropWhile: () => dropWhile2,
  dropUntil: () => dropUntil2,
  disconnect: () => disconnect2,
  diffFiberRefs: () => diffFiberRefs2,
  dieSync: () => dieSync3,
  dieMessage: () => dieMessage2,
  die: () => die6,
  descriptorWith: () => descriptorWith2,
  descriptor: () => descriptor2,
  delay: () => delay2,
  daemonChildren: () => daemonChildren2,
  custom: () => custom2,
  currentSpan: () => currentSpan2,
  currentPropagatedSpan: () => currentPropagatedSpan2,
  currentParentSpan: () => currentParentSpan2,
  contextWithEffect: () => contextWithEffect2,
  contextWith: () => contextWith2,
  context: () => context3,
  consoleWith: () => consoleWith2,
  console: () => console3,
  configProviderWith: () => configProviderWith2,
  clockWith: () => clockWith4,
  clock: () => clock2,
  checkInterruptible: () => checkInterruptible2,
  cause: () => cause2,
  catchTags: () => catchTags2,
  catchTag: () => catchTag2,
  catchSomeDefect: () => catchSomeDefect2,
  catchSomeCause: () => catchSomeCause2,
  catchSome: () => catchSome2,
  catchIf: () => catchIf2,
  catchAllDefect: () => catchAllDefect2,
  catchAllCause: () => catchAllCause3,
  catchAll: () => catchAll3,
  catch: () => _catch2,
  cachedWithTTL: () => cachedWithTTL,
  cachedInvalidateWithTTL: () => cachedInvalidateWithTTL2,
  cachedFunction: () => cachedFunction2,
  cached: () => cached3,
  cacheRequestResult: () => cacheRequestResult,
  blocked: () => blocked2,
  bindTo: () => bindTo4,
  bindAll: () => bindAll2,
  bind: () => bind4,
  awaitAllChildren: () => awaitAllChildren2,
  asyncEffect: () => asyncEffect2,
  async: () => async,
  asVoid: () => asVoid5,
  asSomeError: () => asSomeError2,
  asSome: () => asSome2,
  as: () => as6,
  ap: () => ap2,
  annotateSpans: () => annotateSpans3,
  annotateLogsScoped: () => annotateLogsScoped2,
  annotateLogs: () => annotateLogs3,
  annotateCurrentSpan: () => annotateCurrentSpan2,
  andThen: () => andThen6,
  allowInterrupt: () => allowInterrupt2,
  allWith: () => allWith2,
  allSuccesses: () => allSuccesses2,
  all: () => all4,
  addFinalizer: () => addFinalizer2,
  acquireUseRelease: () => acquireUseRelease2,
  acquireReleaseInterruptible: () => acquireReleaseInterruptible2,
  acquireRelease: () => acquireRelease2,
  Tag: () => Tag3,
  Service: () => Service,
  EffectTypeId: () => EffectTypeId3,
  Do: () => Do3
});
function defineLength(length2, fn2) {
  return Object.defineProperty(fn2, "length", {
    value: length2,
    configurable: true
  });
}
function fnApply(options) {
  let effect;
  let fnError = undefined;
  if (isGeneratorFunction(options.body)) {
    effect = fromIterator(() => options.body.apply(options.self, options.args));
  } else {
    try {
      effect = options.body.apply(options.self, options.args);
    } catch (error) {
      fnError = error;
      effect = die6(error);
    }
  }
  if (options.pipeables.length > 0) {
    try {
      for (const x of options.pipeables) {
        effect = x(effect, ...options.args);
      }
    } catch (error) {
      effect = fnError ? failCause6(sequential(die(fnError), die(error))) : die6(error);
    }
  }
  let cache = false;
  const captureStackTrace = () => {
    if (cache !== false) {
      return cache;
    }
    if (options.errorCall.stack) {
      const stackDef = options.errorDef.stack.trim().split(`
`);
      const stackCall = options.errorCall.stack.trim().split(`
`);
      let endStackDef = stackDef.slice(2).join(`
`).trim();
      if (!endStackDef.includes(`(`)) {
        endStackDef = endStackDef.replace(/at (.*)/, "at ($1)");
      }
      let endStackCall = stackCall.slice(2).join(`
`).trim();
      if (!endStackCall.includes(`(`)) {
        endStackCall = endStackCall.replace(/at (.*)/, "at ($1)");
      }
      cache = `${endStackDef}
${endStackCall}`;
      return cache;
    }
  };
  const opts = options.spanOptions && "captureStackTrace" in options.spanOptions ? options.spanOptions : {
    captureStackTrace,
    ...options.spanOptions
  };
  return withSpan3(effect, options.spanName, opts);
}
var EffectTypeId3, isEffect2, cachedWithTTL, cachedInvalidateWithTTL2, cached3, cachedFunction2, once3, all4, allWith2, allSuccesses2, dropUntil2, dropWhile2, takeUntil2, takeWhile2, every5, exists4, filter8, filterMap5, findFirst4, forEach5, head4, mergeAll5, partition4, reduce10, reduceWhile2, reduceRight3, reduceEffect2, replicate2, replicateEffect2, validateAll2, validateFirst2, async, asyncEffect2, custom2, withFiberRuntime2, fail7, failSync3, failCause6, failCauseSync3, die6, dieMessage2, dieSync3, gen3, never2, none9, promise2, succeed6, succeedNone2, succeedSome2, suspend3, sync3, _void, yieldNow4, _catch2, catchAll3, catchAllCause3, catchAllDefect2, catchIf2, catchSome2, catchSomeCause2, catchSomeDefect2, catchTag2, catchTags2, cause2, eventually2, ignore2, ignoreLogged2, parallelErrors2, sandbox2, retry2, withExecutionPlan2, retryOrElse, try_2, tryMap2, tryMapPromise2, tryPromise2, unsandbox2, allowInterrupt2, checkInterruptible2, disconnect2, interrupt6, interruptWith2, interruptible4, interruptibleMask2, onInterrupt2, uninterruptible2, uninterruptibleMask3, liftPredicate3, as6, asSome2, asSomeError2, asVoid5, flip2, flipWith2, map13, mapAccum3, mapBoth3, mapError4, mapErrorCause3, merge7, negate2, acquireRelease2, acquireReleaseInterruptible2, acquireUseRelease2, addFinalizer2, ensuring2, onError2, onExit3, parallelFinalizers2, sequentialFinalizers2, finalizersMask2, scope3, scopeWith2, scopedWith2, scoped2, using2, withEarlyRelease2, awaitAllChildren2, daemonChildren2, descriptor2, descriptorWith2, diffFiberRefs2, ensuringChild2, ensuringChildren2, fiberId2, fiberIdWith2, fork3, forkDaemon2, forkAll2, forkIn2, forkScoped2, forkWithErrorHandler2, fromFiber2, fromFiberEffect2, supervised2, transplant2, withConcurrency2, withScheduler2, withSchedulingPriority2, withMaxOpsBeforeYield2, clock2, clockWith4, withClockScoped2, withClock2, console3, consoleWith2, withConsoleScoped2, withConsole2, delay2, sleep4, timed2, timedWith2, timeout2, timeoutOption2, timeoutFail2, timeoutFailCause2, timeoutTo2, configProviderWith2, withConfigProvider2, withConfigProviderScoped2, context3, contextWith2, contextWithEffect2, mapInputContext2, provide2, provideService2, provideServiceEffect2, serviceFunction2, serviceFunctionEffect2, serviceFunctions2, serviceConstants2, serviceMembers2, serviceOption2, serviceOptional2, updateService2, Do3, bind4, bindAll2, bindTo4, let_4, option2, either3, exit2, intoDeferred2, if_2, filterOrDie2, filterOrDieMessage2, filterOrElse2, filterOrFail2, filterEffectOrElse2, filterEffectOrFail2, unless2, unlessEffect2, when2, whenEffect2, whenFiberRef2, whenRef2, flatMap12, andThen6, flatten9, race2, raceAll2, raceFirst2, raceWith2, summarized2, tap4, tapBoth2, tapDefect2, tapError3, tapErrorTag2, tapErrorCause3, forever3, iterate2, loop2, repeat, repeatN2, repeatOrElse, schedule, scheduleForked2, scheduleFrom, whileLoop2, getFiberRefs, inheritFiberRefs2, locally, locallyWith, locallyScoped, locallyScopedWith, patchFiberRefs2, setFiberRefs2, updateFiberRefs2, isFailure5, isSuccess3, match12, matchCause3, matchCauseEffect3, matchEffect3, log2, logWithLevel2 = (level, ...message) => logWithLevel(level)(...message), logTrace2, logDebug2, logInfo2, logWarning2, logError2, logFatal2, withLogSpan2, annotateLogs3, annotateLogsScoped2, logAnnotations2, withUnhandledErrorLogLevel2, whenLogLevel2, orDie3, orDieWith2, orElse4, orElseFail2, orElseSucceed2, firstSuccessOf2, random3, randomWith2, withRandom2, withRandomFixed, withRandomScoped2, runtime3, getRuntimeFlags, patchRuntimeFlags, withRuntimeFlagsPatch, withRuntimeFlagsPatchScoped, tagMetrics2, labelMetrics2, tagMetricsScoped2, labelMetricsScoped2, metricLabels2, withMetric2, unsafeMakeSemaphore2, makeSemaphore2, unsafeMakeLatch2, makeLatch2, runFork2, runCallback, runPromise, runPromiseExit, runSync, runSyncExit, validate2, validateWith2, zip5, zipLeft4, zipRight4, zipWith6, ap2, blocked2, runRequestBlock2, step3, request, cacheRequestResult, withRequestBatching2, withRequestCaching2, withRequestCache2, tracer2, tracerWith4, withTracer2, withTracerScoped2, withTracerEnabled2, withTracerTiming2, annotateSpans3, annotateCurrentSpan2, currentSpan2, currentPropagatedSpan2, currentParentSpan2, spanAnnotations2, spanLinks2, linkSpans2, linkSpanCurrent2, makeSpan2, makeSpanScoped2, useSpan2, withSpan3, functionWithSpan2, withSpanScoped2, withParentSpan3, fromNullable3, optionFromOptional2, transposeOption = (self) => {
  return isNone(self) ? succeedNone2 : map13(self.value, some);
}, transposeMapOption, makeTagProxy = (TagClass) => {
  const cache = new Map;
  return new Proxy(TagClass, {
    get(target, prop, receiver) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      if (cache.has(prop)) {
        return cache.get(prop);
      }
      const fn = (...args2) => andThen4(target, (s) => {
        if (typeof s[prop] === "function") {
          cache.set(prop, (...args3) => andThen4(target, (s2) => s2[prop](...args3)));
          return s[prop](...args2);
        }
        cache.set(prop, andThen4(target, (s2) => s2[prop]));
        return s[prop];
      });
      const cn = andThen4(target, (s) => s[prop]);
      Object.assign(fn, cn);
      const apply = fn.apply;
      const bind5 = fn.bind;
      const call = fn.call;
      const proto4 = Object.setPrototypeOf({}, Object.getPrototypeOf(cn));
      proto4.apply = apply;
      proto4.bind = bind5;
      proto4.call = call;
      Object.setPrototypeOf(fn, proto4);
      cache.set(prop, fn);
      return fn;
    }
  });
}, Tag3 = (id) => () => {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const creationError = new Error;
  Error.stackTraceLimit = limit;
  function TagClass() {}
  Object.setPrototypeOf(TagClass, TagProto);
  TagClass.key = id;
  Object.defineProperty(TagClass, "use", {
    get() {
      return (body) => andThen4(this, body);
    }
  });
  Object.defineProperty(TagClass, "stack", {
    get() {
      return creationError.stack;
    }
  });
  return makeTagProxy(TagClass);
}, Service = function() {
  return function() {
    const [id, maker] = arguments;
    const proxy = "accessors" in maker ? maker["accessors"] : false;
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const creationError = new Error;
    Error.stackTraceLimit = limit;
    let patchState = "unchecked";
    const TagClass = function(service2) {
      if (patchState === "unchecked") {
        const proto4 = Object.getPrototypeOf(service2);
        if (proto4 === Object.prototype || proto4 === null) {
          patchState = "plain";
        } else {
          const selfProto = Object.getPrototypeOf(this);
          Object.setPrototypeOf(selfProto, proto4);
          patchState = "patched";
        }
      }
      if (patchState === "plain") {
        Object.assign(this, service2);
      } else if (patchState === "patched") {
        Object.setPrototypeOf(service2, Object.getPrototypeOf(this));
        return service2;
      }
    };
    TagClass.prototype._tag = id;
    Object.defineProperty(TagClass, "make", {
      get() {
        return (service2) => new this(service2);
      }
    });
    Object.defineProperty(TagClass, "use", {
      get() {
        return (body) => andThen4(this, body);
      }
    });
    TagClass.key = id;
    Object.assign(TagClass, TagProto);
    Object.defineProperty(TagClass, "stack", {
      get() {
        return creationError.stack;
      }
    });
    const hasDeps = "dependencies" in maker && maker.dependencies.length > 0;
    const layerName = hasDeps ? "DefaultWithoutDependencies" : "Default";
    let layerCache;
    let isFunction3 = false;
    if ("effect" in maker) {
      isFunction3 = typeof maker.effect === "function";
      Object.defineProperty(TagClass, layerName, {
        get() {
          if (isFunction3) {
            return function() {
              return fromEffect2(TagClass, map13(maker.effect.apply(null, arguments), (_) => new this(_)));
            }.bind(this);
          }
          return layerCache ??= fromEffect2(TagClass, map13(maker.effect, (_) => new this(_)));
        }
      });
    } else if ("scoped" in maker) {
      isFunction3 = typeof maker.scoped === "function";
      Object.defineProperty(TagClass, layerName, {
        get() {
          if (isFunction3) {
            return function() {
              return scoped(TagClass, map13(maker.scoped.apply(null, arguments), (_) => new this(_)));
            }.bind(this);
          }
          return layerCache ??= scoped(TagClass, map13(maker.scoped, (_) => new this(_)));
        }
      });
    } else if ("sync" in maker) {
      Object.defineProperty(TagClass, layerName, {
        get() {
          return layerCache ??= sync2(TagClass, () => new this(maker.sync()));
        }
      });
    } else {
      Object.defineProperty(TagClass, layerName, {
        get() {
          return layerCache ??= succeed4(TagClass, new this(maker.succeed));
        }
      });
    }
    if (hasDeps) {
      let layerWithDepsCache;
      Object.defineProperty(TagClass, "Default", {
        get() {
          if (isFunction3) {
            return function() {
              return provide(this.DefaultWithoutDependencies.apply(null, arguments), maker.dependencies);
            };
          }
          return layerWithDepsCache ??= provide(this.DefaultWithoutDependencies, maker.dependencies);
        }
      });
    }
    return proxy === true ? makeTagProxy(TagClass) : TagClass;
  };
}, fn = function(nameOrBody, ...pipeables) {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 2;
  const errorDef = new Error;
  Error.stackTraceLimit = limit;
  if (typeof nameOrBody !== "string") {
    return defineLength(nameOrBody.length, function(...args2) {
      const limit2 = Error.stackTraceLimit;
      Error.stackTraceLimit = 2;
      const errorCall = new Error;
      Error.stackTraceLimit = limit2;
      return fnApply({
        self: this,
        body: nameOrBody,
        args: args2,
        pipeables,
        spanName: "<anonymous>",
        spanOptions: {
          context: DisablePropagation.context(true)
        },
        errorDef,
        errorCall
      });
    });
  }
  const name = nameOrBody;
  const options = pipeables[0];
  return (body, ...pipeables2) => defineLength(body.length, {
    [name](...args2) {
      const limit2 = Error.stackTraceLimit;
      Error.stackTraceLimit = 2;
      const errorCall = new Error;
      Error.stackTraceLimit = limit2;
      return fnApply({
        self: this,
        body,
        args: args2,
        pipeables: pipeables2,
        spanName: name,
        spanOptions: options,
        errorDef,
        errorCall
      });
    }
  }[name]);
}, fnUntraced2, ensureSuccessType = () => (effect) => effect, ensureErrorType = () => (effect) => effect, ensureRequirementsType = () => (effect) => effect;
var init_Effect = __esm(() => {
  init_Function();
  init_cause();
  init_console2();
  init_context();
  init_core_effect();
  init_core();
  init_defaultServices();
  init_circular();
  init_executionPlan();
  init_fiberRuntime();
  init_layer();
  init_option();
  init_query();
  init_runtime2();
  init_schedule();
  init_tracer();
  init_Random();
  init_Request();
  init_Scheduler();
  init_Utils();
  EffectTypeId3 = EffectTypeId2;
  isEffect2 = isEffect;
  cachedWithTTL = cached2;
  cachedInvalidateWithTTL2 = cachedInvalidateWithTTL;
  cached3 = memoize;
  cachedFunction2 = cachedFunction;
  once3 = once;
  all4 = all3;
  allWith2 = allWith;
  allSuccesses2 = allSuccesses;
  dropUntil2 = dropUntil;
  dropWhile2 = dropWhile;
  takeUntil2 = takeUntil;
  takeWhile2 = takeWhile;
  every5 = every4;
  exists4 = exists3;
  filter8 = filter7;
  filterMap5 = filterMap4;
  findFirst4 = findFirst3;
  forEach5 = forEach4;
  head4 = head3;
  mergeAll5 = mergeAll3;
  partition4 = partition3;
  reduce10 = reduce9;
  reduceWhile2 = reduceWhile;
  reduceRight3 = reduceRight2;
  reduceEffect2 = reduceEffect;
  replicate2 = replicate;
  replicateEffect2 = replicateEffect;
  validateAll2 = validateAll;
  validateFirst2 = validateFirst;
  async = async_;
  asyncEffect2 = asyncEffect;
  custom2 = custom;
  withFiberRuntime2 = withFiberRuntime;
  fail7 = fail2;
  failSync3 = failSync;
  failCause6 = failCause;
  failCauseSync3 = failCauseSync;
  die6 = die2;
  dieMessage2 = dieMessage;
  dieSync3 = dieSync;
  gen3 = gen2;
  never2 = never;
  none9 = none6;
  promise2 = promise;
  succeed6 = succeed;
  succeedNone2 = succeedNone;
  succeedSome2 = succeedSome;
  suspend3 = suspend;
  sync3 = sync;
  _void = void_2;
  yieldNow4 = yieldNow;
  _catch2 = _catch;
  catchAll3 = catchAll;
  catchAllCause3 = catchAllCause;
  catchAllDefect2 = catchAllDefect;
  catchIf2 = catchIf;
  catchSome2 = catchSome;
  catchSomeCause2 = catchSomeCause;
  catchSomeDefect2 = catchSomeDefect;
  catchTag2 = catchTag;
  catchTags2 = catchTags;
  cause2 = cause;
  eventually2 = eventually;
  ignore2 = ignore;
  ignoreLogged2 = ignoreLogged;
  parallelErrors2 = parallelErrors;
  sandbox2 = sandbox;
  retry2 = retry_combined;
  withExecutionPlan2 = withExecutionPlan;
  retryOrElse = retryOrElse_Effect;
  try_2 = try_;
  tryMap2 = tryMap;
  tryMapPromise2 = tryMapPromise;
  tryPromise2 = tryPromise;
  unsandbox2 = unsandbox;
  allowInterrupt2 = allowInterrupt;
  checkInterruptible2 = checkInterruptible;
  disconnect2 = disconnect;
  interrupt6 = interrupt2;
  interruptWith2 = interruptWith;
  interruptible4 = interruptible2;
  interruptibleMask2 = interruptibleMask;
  onInterrupt2 = onInterrupt;
  uninterruptible2 = uninterruptible;
  uninterruptibleMask3 = uninterruptibleMask;
  liftPredicate3 = liftPredicate2;
  as6 = as3;
  asSome2 = asSome;
  asSomeError2 = asSomeError;
  asVoid5 = asVoid2;
  flip2 = flip;
  flipWith2 = flipWith;
  map13 = map8;
  mapAccum3 = mapAccum2;
  mapBoth3 = mapBoth;
  mapError4 = mapError;
  mapErrorCause3 = mapErrorCause;
  merge7 = merge5;
  negate2 = negate;
  acquireRelease2 = acquireRelease;
  acquireReleaseInterruptible2 = acquireReleaseInterruptible;
  acquireUseRelease2 = acquireUseRelease;
  addFinalizer2 = addFinalizer;
  ensuring2 = ensuring;
  onError2 = onError;
  onExit3 = onExit;
  parallelFinalizers2 = parallelFinalizers;
  sequentialFinalizers2 = sequentialFinalizers;
  finalizersMask2 = finalizersMask;
  scope3 = scope;
  scopeWith2 = scopeWith;
  scopedWith2 = scopedWith;
  scoped2 = scopedEffect;
  using2 = using;
  withEarlyRelease2 = withEarlyRelease;
  awaitAllChildren2 = awaitAllChildren;
  daemonChildren2 = daemonChildren;
  descriptor2 = descriptor;
  descriptorWith2 = descriptorWith;
  diffFiberRefs2 = diffFiberRefs;
  ensuringChild2 = ensuringChild;
  ensuringChildren2 = ensuringChildren;
  fiberId2 = fiberId;
  fiberIdWith2 = fiberIdWith;
  fork3 = fork;
  forkDaemon2 = forkDaemon;
  forkAll2 = forkAll;
  forkIn2 = forkIn;
  forkScoped2 = forkScoped;
  forkWithErrorHandler2 = forkWithErrorHandler;
  fromFiber2 = fromFiber;
  fromFiberEffect2 = fromFiberEffect;
  supervised2 = supervised;
  transplant2 = transplant;
  withConcurrency2 = withConcurrency;
  withScheduler2 = withScheduler;
  withSchedulingPriority2 = withSchedulingPriority;
  withMaxOpsBeforeYield2 = withMaxOpsBeforeYield;
  clock2 = clock;
  clockWith4 = clockWith3;
  withClockScoped2 = withClockScoped;
  withClock2 = withClock;
  console3 = console2;
  consoleWith2 = consoleWith;
  withConsoleScoped2 = withConsoleScoped;
  withConsole2 = withConsole;
  delay2 = delay;
  sleep4 = sleep3;
  timed2 = timed;
  timedWith2 = timedWith;
  timeout2 = timeout;
  timeoutOption2 = timeoutOption;
  timeoutFail2 = timeoutFail;
  timeoutFailCause2 = timeoutFailCause;
  timeoutTo2 = timeoutTo;
  configProviderWith2 = configProviderWith;
  withConfigProvider2 = withConfigProvider;
  withConfigProviderScoped2 = withConfigProviderScoped;
  context3 = context;
  contextWith2 = contextWith;
  contextWithEffect2 = contextWithEffect;
  mapInputContext2 = mapInputContext;
  provide2 = effect_provide;
  provideService2 = provideService;
  provideServiceEffect2 = provideServiceEffect;
  serviceFunction2 = serviceFunction;
  serviceFunctionEffect2 = serviceFunctionEffect;
  serviceFunctions2 = serviceFunctions;
  serviceConstants2 = serviceConstants;
  serviceMembers2 = serviceMembers;
  serviceOption2 = serviceOption;
  serviceOptional2 = serviceOptional;
  updateService2 = updateService;
  Do3 = Do2;
  bind4 = bind3;
  bindAll2 = bindAll;
  bindTo4 = bindTo3;
  let_4 = let_3;
  option2 = option;
  either3 = either2;
  exit2 = exit;
  intoDeferred2 = intoDeferred;
  if_2 = if_;
  filterOrDie2 = filterOrDie;
  filterOrDieMessage2 = filterOrDieMessage;
  filterOrElse2 = filterOrElse;
  filterOrFail2 = filterOrFail;
  filterEffectOrElse2 = filterEffectOrElse;
  filterEffectOrFail2 = filterEffectOrFail;
  unless2 = unless;
  unlessEffect2 = unlessEffect;
  when2 = when;
  whenEffect2 = whenEffect;
  whenFiberRef2 = whenFiberRef;
  whenRef2 = whenRef;
  flatMap12 = flatMap7;
  andThen6 = andThen4;
  flatten9 = flatten5;
  race2 = race;
  raceAll2 = raceAll;
  raceFirst2 = raceFirst;
  raceWith2 = raceWith;
  summarized2 = summarized;
  tap4 = tap2;
  tapBoth2 = tapBoth;
  tapDefect2 = tapDefect;
  tapError3 = tapError;
  tapErrorTag2 = tapErrorTag;
  tapErrorCause3 = tapErrorCause;
  forever3 = forever;
  iterate2 = iterate;
  loop2 = loop;
  repeat = repeat_combined;
  repeatN2 = repeatN;
  repeatOrElse = repeatOrElse_Effect;
  schedule = schedule_Effect;
  scheduleForked2 = scheduleForked;
  scheduleFrom = scheduleFrom_Effect;
  whileLoop2 = whileLoop;
  getFiberRefs = fiberRefs2;
  inheritFiberRefs2 = inheritFiberRefs;
  locally = fiberRefLocally;
  locallyWith = fiberRefLocallyWith;
  locallyScoped = fiberRefLocallyScoped;
  locallyScopedWith = fiberRefLocallyScopedWith;
  patchFiberRefs2 = patchFiberRefs;
  setFiberRefs2 = setFiberRefs;
  updateFiberRefs2 = updateFiberRefs;
  isFailure5 = isFailure3;
  isSuccess3 = isSuccess;
  match12 = match9;
  matchCause3 = matchCause;
  matchCauseEffect3 = matchCauseEffect;
  matchEffect3 = matchEffect;
  log2 = log;
  logTrace2 = logTrace;
  logDebug2 = logDebug;
  logInfo2 = logInfo;
  logWarning2 = logWarning;
  logError2 = logError;
  logFatal2 = logFatal;
  withLogSpan2 = withLogSpan;
  annotateLogs3 = annotateLogs;
  annotateLogsScoped2 = annotateLogsScoped;
  logAnnotations2 = logAnnotations;
  withUnhandledErrorLogLevel2 = withUnhandledErrorLogLevel;
  whenLogLevel2 = whenLogLevel;
  orDie3 = orDie;
  orDieWith2 = orDieWith;
  orElse4 = orElse2;
  orElseFail2 = orElseFail;
  orElseSucceed2 = orElseSucceed;
  firstSuccessOf2 = firstSuccessOf;
  random3 = random2;
  randomWith2 = randomWith;
  withRandom2 = withRandom;
  withRandomFixed = /* @__PURE__ */ dual(2, (effect, values3) => withRandom2(effect, fixed2(values3)));
  withRandomScoped2 = withRandomScoped;
  runtime3 = runtime2;
  getRuntimeFlags = runtimeFlags;
  patchRuntimeFlags = updateRuntimeFlags;
  withRuntimeFlagsPatch = withRuntimeFlags;
  withRuntimeFlagsPatchScoped = withRuntimeFlagsScoped;
  tagMetrics2 = tagMetrics;
  labelMetrics2 = labelMetrics;
  tagMetricsScoped2 = tagMetricsScoped;
  labelMetricsScoped2 = labelMetricsScoped;
  metricLabels2 = metricLabels;
  withMetric2 = withMetric;
  unsafeMakeSemaphore2 = unsafeMakeSemaphore;
  makeSemaphore2 = makeSemaphore;
  unsafeMakeLatch2 = unsafeMakeLatch;
  makeLatch2 = makeLatch;
  runFork2 = unsafeForkEffect;
  runCallback = unsafeRunEffect;
  runPromise = unsafeRunPromiseEffect;
  runPromiseExit = unsafeRunPromiseExitEffect;
  runSync = unsafeRunSyncEffect;
  runSyncExit = unsafeRunSyncExitEffect;
  validate2 = validate;
  validateWith2 = validateWith;
  zip5 = zipOptions;
  zipLeft4 = zipLeftOptions;
  zipRight4 = zipRightOptions;
  zipWith6 = zipWithOptions;
  ap2 = /* @__PURE__ */ dual(2, (self, that) => zipWith6(self, that, (f, a) => f(a)));
  blocked2 = blocked;
  runRequestBlock2 = runRequestBlock;
  step3 = step2;
  request = /* @__PURE__ */ dual((args2) => isRequest2(args2[0]), fromRequest);
  cacheRequestResult = cacheRequest;
  withRequestBatching2 = withRequestBatching;
  withRequestCaching2 = withRequestCaching;
  withRequestCache2 = withRequestCache;
  tracer2 = tracer;
  tracerWith4 = tracerWith;
  withTracer2 = withTracer;
  withTracerScoped2 = withTracerScoped;
  withTracerEnabled2 = withTracerEnabled;
  withTracerTiming2 = withTracerTiming;
  annotateSpans3 = annotateSpans;
  annotateCurrentSpan2 = annotateCurrentSpan;
  currentSpan2 = currentSpan;
  currentPropagatedSpan2 = currentPropagatedSpan;
  currentParentSpan2 = currentParentSpan;
  spanAnnotations2 = spanAnnotations;
  spanLinks2 = spanLinks;
  linkSpans2 = linkSpans;
  linkSpanCurrent2 = linkSpanCurrent;
  makeSpan2 = makeSpan;
  makeSpanScoped2 = makeSpanScoped;
  useSpan2 = useSpan;
  withSpan3 = withSpan;
  functionWithSpan2 = functionWithSpan;
  withSpanScoped2 = withSpanScoped;
  withParentSpan3 = withParentSpan;
  fromNullable3 = fromNullable2;
  optionFromOptional2 = optionFromOptional;
  transposeMapOption = /* @__PURE__ */ dual(2, (self, f) => isNone(self) ? succeedNone2 : map13(f(self.value), some));
  fnUntraced2 = fnUntraced;
});

// node_modules/effect/dist/esm/internal/layer/circular.js
var setConfigProvider = (configProvider) => scopedDiscard(withConfigProviderScoped(configProvider)), parentSpan = (span2) => succeedContext(make9(spanTag, span2)), span2 = (name, options) => {
  options = addSpanStackTrace(options);
  return scoped(spanTag, options?.onEnd ? tap2(makeSpanScoped(name, options), (span3) => addFinalizer((exit3) => options.onEnd(span3, exit3))) : makeSpanScoped(name, options));
}, setTracer = (tracer3) => scopedDiscard(withTracerScoped(tracer3));
var init_circular3 = __esm(() => {
  init_Context();
  init_core();
  init_fiberRuntime();
  init_layer();
  init_tracer();
});

// node_modules/effect/dist/esm/Layer.js
var exports_Layer = {};
__export(exports_Layer, {
  zipWith: () => zipWith7,
  withSpan: () => withSpan4,
  withParentSpan: () => withParentSpan4,
  updateService: () => updateService3,
  unwrapScoped: () => unwrapScoped2,
  unwrapEffect: () => unwrapEffect2,
  toRuntimeWithMemoMap: () => toRuntimeWithMemoMap2,
  toRuntime: () => toRuntime2,
  tapErrorCause: () => tapErrorCause4,
  tapError: () => tapError4,
  tap: () => tap5,
  syncContext: () => syncContext2,
  sync: () => sync4,
  suspend: () => suspend4,
  succeedContext: () => succeedContext2,
  succeed: () => succeed7,
  span: () => span3,
  setVersionMismatchErrorLogLevel: () => setVersionMismatchErrorLogLevel,
  setUnhandledErrorLogLevel: () => setUnhandledErrorLogLevel,
  setTracerTiming: () => setTracerTiming,
  setTracerEnabled: () => setTracerEnabled,
  setTracer: () => setTracer2,
  setScheduler: () => setScheduler,
  setRequestCaching: () => setRequestCaching,
  setRequestCache: () => setRequestCache,
  setRequestBatching: () => setRequestBatching,
  setRandom: () => setRandom,
  setConfigProvider: () => setConfigProvider2,
  setClock: () => setClock,
  service: () => service2,
  scopedDiscard: () => scopedDiscard2,
  scopedContext: () => scopedContext2,
  scoped: () => scoped3,
  scope: () => scope4,
  retry: () => retry3,
  provideMerge: () => provideMerge2,
  provide: () => provide3,
  project: () => project2,
  passthrough: () => passthrough3,
  parentSpan: () => parentSpan2,
  orElse: () => orElse5,
  orDie: () => orDie4,
  mock: () => mock2,
  mergeAll: () => mergeAll6,
  merge: () => merge8,
  memoize: () => memoize3,
  matchCause: () => matchCause4,
  match: () => match13,
  mapError: () => mapError5,
  map: () => map14,
  makeMemoMap: () => makeMemoMap2,
  locallyWith: () => locallyWith2,
  locallyScoped: () => locallyScoped2,
  locallyEffect: () => locallyEffect2,
  locally: () => locally2,
  launch: () => launch2,
  isLayer: () => isLayer2,
  isFresh: () => isFresh2,
  function: () => fromFunction2,
  fresh: () => fresh2,
  flatten: () => flatten10,
  flatMap: () => flatMap13,
  fiberRefLocallyScopedWith: () => fiberRefLocallyScopedWith3,
  failSync: () => failSync4,
  failCauseSync: () => failCauseSync4,
  failCause: () => failCause7,
  fail: () => fail8,
  extendScope: () => extendScope2,
  ensureSuccessType: () => ensureSuccessType2,
  ensureRequirementsType: () => ensureRequirementsType2,
  ensureErrorType: () => ensureErrorType2,
  empty: () => empty29,
  effectDiscard: () => effectDiscard,
  effectContext: () => effectContext,
  effect: () => effect,
  discard: () => discard2,
  dieSync: () => dieSync4,
  die: () => die7,
  context: () => context4,
  catchAllCause: () => catchAllCause4,
  catchAll: () => catchAll4,
  buildWithScope: () => buildWithScope2,
  buildWithMemoMap: () => buildWithMemoMap2,
  build: () => build2,
  annotateSpans: () => annotateSpans4,
  annotateLogs: () => annotateLogs4,
  MemoMapTypeId: () => MemoMapTypeId2,
  LayerTypeId: () => LayerTypeId2,
  CurrentMemoMap: () => CurrentMemoMap2
});
var LayerTypeId2, MemoMapTypeId2, CurrentMemoMap2, isLayer2, isFresh2, annotateLogs4, annotateSpans4, build2, buildWithScope2, catchAll4, catchAllCause4, context4, die7, dieSync4, discard2, effect, effectDiscard, effectContext, empty29, extendScope2, fail8, failSync4, failCause7, failCauseSync4, flatMap13, flatten10, fresh2, mock2, fromFunction2, launch2, map14, mapError5, match13, matchCause4, memoize3, merge8, mergeAll6, orDie4, orElse5, passthrough3, project2, locallyEffect2, locally2, locallyWith2, locallyScoped2, fiberRefLocallyScopedWith3, retry3, scope4, scoped3, scopedDiscard2, scopedContext2, service2, succeed7, succeedContext2, suspend4, sync4, syncContext2, tap5, tapError4, tapErrorCause4, toRuntime2, toRuntimeWithMemoMap2, provide3, provideMerge2, zipWith7, unwrapEffect2, unwrapScoped2, setClock = (clock3) => scopedDiscard2(fiberRefLocallyScopedWith(currentServices, add4(clockTag, clock3))), setConfigProvider2, parentSpan2, setRandom = (random4) => scopedDiscard2(fiberRefLocallyScopedWith(currentServices, add4(randomTag, random4))), setRequestBatching = (requestBatching) => scopedDiscard2(fiberRefLocallyScoped(currentRequestBatching, requestBatching)), setRequestCaching = (requestCaching) => scopedDiscard2(fiberRefLocallyScoped(currentCacheEnabled, requestCaching)), setRequestCache = (cache) => scopedDiscard2(isEffect(cache) ? flatMap7(cache, (x) => fiberRefLocallyScoped(currentCache, x)) : fiberRefLocallyScoped(currentCache, cache)), setScheduler = (scheduler) => scopedDiscard2(fiberRefLocallyScoped(currentScheduler, scheduler)), span3, setTracer2, setTracerEnabled = (enabled2) => scopedDiscard2(fiberRefLocallyScoped(currentTracerEnabled, enabled2)), setTracerTiming = (enabled2) => scopedDiscard2(fiberRefLocallyScoped(currentTracerTimingEnabled, enabled2)), setUnhandledErrorLogLevel = (level) => scopedDiscard2(fiberRefLocallyScoped(currentUnhandledErrorLogLevel, level)), setVersionMismatchErrorLogLevel = (level) => scopedDiscard2(fiberRefLocallyScoped(currentVersionMismatchErrorLogLevel, level)), withSpan4, withParentSpan4, makeMemoMap2, buildWithMemoMap2, updateService3, ensureSuccessType2 = () => (layer) => layer, ensureErrorType2 = () => (layer) => layer, ensureRequirementsType2 = () => (layer) => layer;
var init_Layer = __esm(() => {
  init_Context();
  init_Function();
  init_clock();
  init_core();
  init_defaultServices();
  init_fiberRuntime();
  init_layer();
  init_circular3();
  init_query();
  init_random();
  init_Scheduler();
  LayerTypeId2 = LayerTypeId;
  MemoMapTypeId2 = MemoMapTypeId;
  CurrentMemoMap2 = CurrentMemoMap;
  isLayer2 = isLayer;
  isFresh2 = isFresh;
  annotateLogs4 = annotateLogs2;
  annotateSpans4 = annotateSpans2;
  build2 = build;
  buildWithScope2 = buildWithScope;
  catchAll4 = catchAll2;
  catchAllCause4 = catchAllCause2;
  context4 = context2;
  die7 = die5;
  dieSync4 = dieSync2;
  discard2 = discard;
  effect = fromEffect2;
  effectDiscard = fromEffectDiscard;
  effectContext = fromEffectContext;
  empty29 = empty27;
  extendScope2 = extendScope;
  fail8 = fail5;
  failSync4 = failSync2;
  failCause7 = failCause4;
  failCauseSync4 = failCauseSync2;
  flatMap13 = flatMap11;
  flatten10 = flatten8;
  fresh2 = fresh;
  mock2 = mock;
  fromFunction2 = fromFunction;
  launch2 = launch;
  map14 = map11;
  mapError5 = mapError3;
  match13 = match11;
  matchCause4 = matchCause2;
  memoize3 = memoize2;
  merge8 = merge6;
  mergeAll6 = mergeAll4;
  orDie4 = orDie2;
  orElse5 = orElse3;
  passthrough3 = passthrough;
  project2 = project;
  locallyEffect2 = locallyEffect;
  locally2 = fiberRefLocally2;
  locallyWith2 = fiberRefLocallyWith2;
  locallyScoped2 = fiberRefLocallyScoped2;
  fiberRefLocallyScopedWith3 = fiberRefLocallyScopedWith2;
  retry3 = retry;
  scope4 = scope2;
  scoped3 = scoped;
  scopedDiscard2 = scopedDiscard;
  scopedContext2 = scopedContext;
  service2 = service;
  succeed7 = succeed4;
  succeedContext2 = succeedContext;
  suspend4 = suspend2;
  sync4 = sync2;
  syncContext2 = syncContext;
  tap5 = tap3;
  tapError4 = tapError2;
  tapErrorCause4 = tapErrorCause2;
  toRuntime2 = toRuntime;
  toRuntimeWithMemoMap2 = toRuntimeWithMemoMap;
  provide3 = provide;
  provideMerge2 = provideMerge;
  zipWith7 = zipWith5;
  unwrapEffect2 = unwrapEffect;
  unwrapScoped2 = unwrapScoped;
  setConfigProvider2 = setConfigProvider;
  parentSpan2 = parentSpan;
  span3 = span2;
  setTracer2 = setTracer;
  withSpan4 = withSpan2;
  withParentSpan4 = withParentSpan2;
  makeMemoMap2 = makeMemoMap;
  buildWithMemoMap2 = buildWithMemoMap;
  updateService3 = /* @__PURE__ */ dual(3, (layer, tag, f) => provide3(layer, map14(context4(), (c) => add4(c, tag, f(unsafeGet4(c, tag))))));
});

// node_modules/effect/dist/esm/index.js
var init_esm = __esm(() => {
  init_Cause();
  init_Context();
  init_Deferred();
  init_Effect();
  init_Exit();
  init_Layer();
  init_Option();
  init_Ref();
});

// src/sync-platform.ts
function storeCall(operation) {
  return exports_Effect.try({ try: operation, catch: (cause3) => ({ _tag: "StoreFailure", cause: cause3 }) });
}
function transportCall(operation) {
  return exports_Effect.tryPromise({
    try: operation,
    catch: (cause3) => ({ _tag: "TransportFailure", cause: cause3 })
  });
}
function syncStoreLive(store) {
  return exports_Layer.succeed(SyncStore, {
    spaceId: store.spaceId,
    head: storeCall(() => store.head()),
    importOperations: (input) => storeCall(() => store.importOperations(input)),
    changesSince: (head5, options) => storeCall(() => store.changesSince(head5, options)),
    updateSyncState: (remoteId, state) => storeCall(() => store.updateSyncState(remoteId, state))
  });
}
function syncTransportLive(transport) {
  return exports_Layer.succeed(SyncTransport, {
    handshake: (manifest) => transportCall(() => transport.handshake(manifest)),
    head: (spaceId) => transportCall(() => transport.head(spaceId)),
    pull: (spaceId, afterSequence, limit) => transportCall(() => transport.pull(spaceId, afterSequence, limit)),
    push: (bundle) => transportCall(() => transport.push(bundle))
  });
}
var SyncTransport, SyncStore, LibSqlSyncClient;
var init_sync_platform = __esm(() => {
  init_esm();
  SyncTransport = class SyncTransport extends exports_Context.Tag("@hraness/oh/SyncTransport")() {
  };
  SyncStore = class SyncStore extends exports_Context.Tag("@hraness/oh/SyncStore")() {
  };
  LibSqlSyncClient = class LibSqlSyncClient extends exports_Context.Tag("@hraness/oh/LibSqlSyncClient")() {
  };
});

// src/sync-program.ts
function synchronize(options = {}) {
  return exports_Effect.gen(function* () {
    const store = yield* SyncStore;
    const transport = yield* SyncTransport;
    const batchSize = options.batchSize ?? 100;
    const maximumRounds = options.maximumRounds ?? 100;
    const remoteId = safeCode(options.remoteId ?? "default");
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000 || !Number.isSafeInteger(maximumRounds) || maximumRounds < 1 || maximumRounds > 1e4 || remoteId === null)
      return yield* exports_Effect.fail({ _tag: "ValidationFailure", cause: new TypeError("Invalid sync options.") });
    yield* transport.handshake(OH_CONTRACT_MANIFEST_V1);
    let pulled = 0;
    let pushed = 0;
    const settled = (head5, rounds) => exports_Effect.gen(function* () {
      yield* store.updateSyncState(remoteId, {
        pulledSequence: head5.sequence,
        pushedSequence: head5.sequence,
        remoteHeadSha256: head5.operationSha256
      });
      return { head: head5, pulled, pushed, rounds, v: 1 };
    });
    for (let round = 1;round <= maximumRounds; round += 1) {
      const remote = parseOhSyncHeadV1(yield* transport.head(store.spaceId));
      if (remote === null)
        return yield* exports_Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport returned an invalid head.") });
      const local = yield* store.head;
      if (local.sequence === remote.sequence) {
        if (local.operationSha256 !== remote.operationSha256) {
          return yield* exports_Effect.fail({ _tag: "SyncConflict", cause: new Error("Sync conflict: equal sequence numbers have different heads.") });
        }
        return yield* settled(remote, round);
      }
      if (local.sequence < remote.sequence) {
        const bundle = parseOhSyncBundleV1(yield* transport.pull(store.spaceId, local.sequence, batchSize));
        const terminal = bundle?.operations.at(-1);
        if (bundle === null || bundle.operations.length === 0 || bundle.operations.length > batchSize || bundle.spaceId !== store.spaceId || bundle.operations[0]?.sequence !== local.sequence + 1 || bundle.operations[0]?.parentOperationSha256 !== local.operationSha256 || terminal === undefined || terminal.sequence > remote.sequence || terminal.sequence === remote.sequence && terminal.operationSha256 !== remote.operationSha256) {
          return yield* exports_Effect.fail({ _tag: "SyncConflict", cause: new Error("Sync conflict: remote history does not extend the local head.") });
        }
        yield* store.importOperations({
          expectedHead: {
            operationSha256: local.operationSha256,
            sequence: local.sequence
          },
          operations: bundle.operations
        });
        pulled += bundle.operations.length;
        const afterPull = yield* store.head;
        if (afterPull.sequence === remote.sequence && afterPull.operationSha256 === remote.operationSha256) {
          const confirmed = parseOhSyncHeadV1(yield* transport.head(store.spaceId));
          if (confirmed === null)
            return yield* exports_Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport returned an invalid head.") });
          const confirmedLocal = yield* store.head;
          if (confirmed.sequence === remote.sequence && confirmed.operationSha256 === remote.operationSha256 && confirmedLocal.sequence === confirmed.sequence && confirmedLocal.operationSha256 === confirmed.operationSha256) {
            return yield* settled(confirmed, round);
          }
        }
      } else {
        const candidates = (yield* store.changesSince({
          operationSha256: remote.operationSha256,
          sequence: remote.sequence
        }, {
          limit: batchSize,
          through: {
            operationSha256: local.operationSha256,
            sequence: local.sequence
          }
        })).operations;
        if (candidates.length === 0 || candidates[0]?.sequence !== remote.sequence + 1 || candidates[0]?.parentOperationSha256 !== remote.operationSha256) {
          return yield* exports_Effect.fail({ _tag: "SyncConflict", cause: new Error("Sync conflict: local history does not extend the remote head.") });
        }
        const bundle = createOhSyncBundleV1(store.spaceId, candidates, {
          largestFittingPrefix: true
        });
        const operations = bundle.operations;
        const head5 = parseOhSyncHeadV1(yield* transport.push(bundle));
        if (head5 === null)
          return yield* exports_Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport returned an invalid push head.") });
        if (head5.sequence !== operations.at(-1)?.sequence || head5.operationSha256 !== operations.at(-1)?.operationSha256) {
          return yield* exports_Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport acknowledged a different head.") });
        }
        pushed += operations.length;
        const afterPush = yield* store.head;
        if (afterPush.sequence === head5.sequence && afterPush.operationSha256 === head5.operationSha256) {
          const confirmed = parseOhSyncHeadV1(yield* transport.head(store.spaceId));
          if (confirmed === null)
            return yield* exports_Effect.fail({ _tag: "ValidationFailure", cause: new Error("The sync transport returned an invalid head.") });
          const confirmedLocal = yield* store.head;
          if (confirmed.sequence === head5.sequence && confirmed.operationSha256 === head5.operationSha256 && confirmedLocal.sequence === confirmed.sequence && confirmedLocal.operationSha256 === confirmed.operationSha256) {
            return yield* settled(confirmed, round);
          }
        }
      }
    }
    return yield* exports_Effect.fail({ _tag: "RoundLimit", cause: new Error("Sync did not settle within maximumRounds.") });
  });
}
var init_sync_program = __esm(() => {
  init_esm();
  init_canonical();
  init_contract();
  init_sync_model();
  init_sync_platform();
});

// src/sync-runtime.ts
async function runClosed(program) {
  const result = await exports_Effect.runPromise(program);
  if (exports_Exit.isSuccess(result))
    return result.value;
  const expected = exports_Cause.failureOption(result.cause);
  if (exports_Option.isSome(expected))
    throw expected.value.cause;
  throw exports_Cause.squash(result.cause);
}
function runSyncBoundary(store, transport, options) {
  return runClosed(synchronize(options).pipe(exports_Effect.provide(exports_Layer.merge(syncStoreLive(store), syncTransportLive(transport))), exports_Effect.exit));
}
var init_sync_runtime = __esm(() => {
  init_esm();
  init_sync_platform();
  init_sync_program();
});

// src/sync.ts
async function synchronizeOhStoreV1(store, transport, options = {}) {
  return await runSyncBoundary(store, transport, options);
}
var init_sync = __esm(() => {
  init_sync_runtime();
});

// src/sdk.ts
var exports_sdk = {};
__export(exports_sdk, {
  resolveRelativeDateWindowV1: () => resolveRelativeDateWindowV1,
  renderOhRecallV1: () => renderOhRecallV1,
  recallOhV1: () => recallOhV1,
  defaultOhRecallViewV1: () => defaultOhRecallViewV1,
  Oh: () => Oh,
  OH_RECALL_RENDERER_V1: () => OH_RECALL_RENDERER_V1,
  OH_RECALL_LIMITS_V1: () => OH_RECALL_LIMITS_V1,
  OH_RECALL_DATE_GRAMMAR_V1: () => OH_RECALL_DATE_GRAMMAR_V1
});

class Oh {
  store;
  semanticBackend;
  #closed = false;
  constructor(store, semanticBackend) {
    this.store = store;
    this.semanticBackend = semanticBackend;
  }
  static open(options = {}) {
    return new Oh(new OhSqliteStore({
      path: options.databasePath ?? ".oh/oh.sqlite",
      ...options.spaceId === undefined ? {} : { spaceId: options.spaceId }
    }), options.semanticBackend);
  }
  head() {
    return this.store.head();
  }
  put(input) {
    const record = createKnowledgeGraphRecordV1({
      dependencies: [...input.dependencies ?? []].sort(),
      key: input.key,
      kind: input.kind,
      v: 1,
      value: input.value
    });
    const head5 = this.store.head();
    return this.store.commit({
      actorId: input.actorId ?? "agent.local",
      changes: [{ kind: "put", record, v: 1 }],
      expectedHead: input.expectedHead ?? head5,
      ...input.instant === undefined ? {} : { instant: input.instant },
      operationId: input.operationId ?? opaqueId("op_")
    });
  }
  tombstone(input) {
    const current = this.store.get(input.key);
    if (current === null)
      throw new Error(`No record exists at ${input.key}.`);
    const head5 = this.store.head();
    return this.store.commit({
      actorId: input.actorId ?? "agent.local",
      changes: [{ key: input.key, kind: "tombstone", priorSha256: current.recordSha256, v: 1 }],
      expectedHead: input.expectedHead ?? head5,
      ...input.instant === undefined ? {} : { instant: input.instant },
      operationId: input.operationId ?? opaqueId("op_")
    });
  }
  get(key) {
    return this.store.get(key);
  }
  list(options) {
    return this.store.list(options);
  }
  async indexSemantic() {
    if (this.semanticBackend === undefined)
      throw new Error("No local semantic backend is configured.");
    return await this.semanticBackend.index(this.store.snapshotRecords());
  }
  async search(query, options = {}) {
    return await searchOhV1({
      ...this.semanticBackend === undefined ? {} : { backend: this.semanticBackend },
      ...options.limit === undefined ? {} : { limit: options.limit },
      ...options.mode === undefined ? {} : { mode: options.mode },
      query,
      store: this.store
    });
  }
  async recall(queries, options = {}) {
    return await recallOhV1({
      ...this.semanticBackend === undefined ? {} : { backend: this.semanticBackend },
      asOf: options.asOf ?? null,
      ...options.limit === undefined ? {} : { limit: options.limit },
      ...options.mode === undefined ? {} : { mode: options.mode },
      ...options.window === undefined ? {} : { window: options.window },
      queries: typeof queries === "string" ? [queries] : queries,
      store: this.store
    });
  }
  async sync(transport, options) {
    return await synchronizeOhStoreV1(this.store, transport, options);
  }
  verify() {
    return this.store.verifyReplay();
  }
  async close() {
    if (this.#closed)
      return;
    this.#closed = true;
    try {
      await this.semanticBackend?.close();
    } finally {
      this.store.close();
    }
  }
}
var init_sdk = __esm(() => {
  init_canonical();
  init_graph();
  init_recall();
  init_store2();
  init_sync();
  init_recall();
});

// src/cli.ts
init_canonical();
init_contract();
init_graph();
init_recall();
init_migrations();
init_sync_model();
import { lstat, readFile } from "fs/promises";
var OH_PACKAGE_VERSION = "0.4.3";
var KNOWN_OPTIONS = new Set([
  "actor",
  "after",
  "as-of",
  "db",
  "depends-on",
  "expected-generation",
  "file",
  "json",
  "key",
  "kind",
  "limit",
  "mode",
  "operation",
  "space"
]);
var RECALL_RENDER_BUDGET_BYTES = 96000;
var GLOBAL_OPTIONS = ["db", "space"];
var MUTATION_OPTIONS = ["actor", "expected-generation", "operation"];
function parseArguments(arguments_) {
  const options = new Map;
  const positionals = [];
  for (let index = 0;index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) {
      if (argument.startsWith("-"))
        throw new TypeError(`Unknown option: ${argument}`);
      positionals.push(argument);
      continue;
    }
    const equals3 = argument.indexOf("=");
    const name = equals3 === -1 ? argument.slice(2) : argument.slice(2, equals3);
    const next = equals3 === -1 ? arguments_[index + 1] : argument.slice(equals3 + 1);
    if (!KNOWN_OPTIONS.has(name))
      throw new TypeError(`Unknown option: --${name}`);
    if (next === undefined || next.length === 0 || equals3 === -1 && next.startsWith("--")) {
      throw new TypeError(`Option --${name} needs a value.`);
    }
    if (equals3 === -1)
      index += 1;
    const current = options.get(name) ?? [];
    if (name !== "depends-on" && current.length !== 0) {
      throw new TypeError(`Option --${name} may appear only once.`);
    }
    options.set(name, [...current, next]);
  }
  return { options, positionals };
}
function one(parsed, name, fallback) {
  const values3 = parsed.options.get(name);
  return values3?.[0] ?? fallback;
}
function integer(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined)
    return;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`--${name} must be a canonical integer from ${minimum} through ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`--${name} must be a canonical integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}
function assertAllowedOptions(parsed, allowed) {
  const admitted = new Set(allowed);
  for (const name of parsed.options.keys()) {
    if (!admitted.has(name))
      throw new TypeError(`Option --${name} is not valid for this command.`);
  }
}
function assertPositionals(parsed, minimum, maximum = minimum) {
  if (parsed.positionals.length < minimum || parsed.positionals.length > maximum) {
    throw new TypeError(`This command needs ${minimum === maximum ? String(minimum) : `${minimum} through ${maximum}`} positional argument${maximum === 1 ? "" : "s"}.`);
  }
}
function parsedSafeCode(value, label, maximum = 128) {
  const parsed = safeCode(value, maximum);
  if (parsed === null)
    throw new TypeError(`${label} is invalid.`);
  return parsed;
}
function validateCommon(parsed) {
  const databasePath = one(parsed, "db", ".oh/oh.sqlite");
  if (databasePath.length === 0 || databasePath.length > 4096 || databasePath.includes("\x00")) {
    throw new TypeError("--db is invalid.");
  }
  return { databasePath, spaceId: parsedSafeCode(one(parsed, "space", "default"), "--space") };
}
function validateMutation(parsed) {
  if (parsed.options.has("actor"))
    parsedSafeCode(one(parsed, "actor"), "--actor");
  if (parsed.options.has("operation"))
    parsedSafeCode(one(parsed, "operation"), "--operation");
  integer(one(parsed, "expected-generation"), "expected-generation");
}
async function validateInvocation(command, parsed) {
  let putRecord = null;
  let syncBundle = null;
  if (command === "contract") {
    assertAllowedOptions(parsed, GLOBAL_OPTIONS);
    assertPositionals(parsed, 0);
    return { ...validateCommon(parsed), putRecord, syncBundle };
  }
  if (command === "init" || command === "verify") {
    assertAllowedOptions(parsed, GLOBAL_OPTIONS);
    assertPositionals(parsed, 0);
  } else if (command === "get") {
    assertAllowedOptions(parsed, GLOBAL_OPTIONS);
    assertPositionals(parsed, 1);
    parsedSafeCode(parsed.positionals[0], "Record key", 512);
  } else if (command === "list") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "kind", "limit"]);
    assertPositionals(parsed, 0);
    const kind = one(parsed, "kind");
    if (kind !== undefined && !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind)) {
      throw new TypeError("Unknown record kind.");
    }
    integer(one(parsed, "limit"), "limit", 1, 1000);
  } else if (command === "log") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "limit"]);
    assertPositionals(parsed, 0);
    integer(one(parsed, "limit"), "limit", 1, 1000);
  } else if (command === "search") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "limit", "mode"]);
    assertPositionals(parsed, 1, 1024);
    const query = parsed.positionals.join(" ");
    const mode = one(parsed, "mode", "keyword");
    if (query.trim().length === 0 || query.length > 4096 || mode !== "keyword" && mode !== "semantic" && mode !== "hybrid") {
      throw new TypeError("search needs a bounded query and a valid mode.");
    }
    integer(one(parsed, "limit"), "limit", 1, 100);
  } else if (command === "recall") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "as-of", "limit", "mode"]);
    assertPositionals(parsed, 1, 1024);
    const query = parsed.positionals.join(" ");
    const mode = one(parsed, "mode", "keyword");
    if (query.trim().length === 0 || query.length > 4096 || mode !== "keyword" && mode !== "semantic" && mode !== "hybrid") {
      throw new TypeError("recall needs a bounded query and a valid mode.");
    }
    const asOf = one(parsed, "as-of");
    if (asOf !== undefined && parseCanonicalInstantV1(asOf) === null)
      throw new TypeError("--as-of needs a canonical UTC instant.");
    integer(one(parsed, "limit"), "limit", 1, 100);
  } else if (command === "put") {
    assertAllowedOptions(parsed, [
      ...GLOBAL_OPTIONS,
      ...MUTATION_OPTIONS,
      "depends-on",
      "file",
      "json",
      "key",
      "kind"
    ]);
    assertPositionals(parsed, 0);
    validateMutation(parsed);
    const key = parsedSafeCode(one(parsed, "key"), "--key", 512);
    const kind = one(parsed, "kind");
    const inline = one(parsed, "json");
    const file = one(parsed, "file");
    if (kind === undefined || !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind) || inline === undefined === (file === undefined)) {
      throw new TypeError("put needs --key, a valid --kind, and exactly one of --json or --file.");
    }
    const dependencies = (parsed.options.get("depends-on") ?? []).map((dependency) => parsedSafeCode(dependency, "--depends-on", 512)).sort();
    const value = JSON.parse(inline ?? await readFile(file, "utf8"));
    putRecord = createKnowledgeGraphRecordV1({ dependencies, key, kind, v: 1, value });
  } else if (command === "tombstone") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, ...MUTATION_OPTIONS]);
    assertPositionals(parsed, 1);
    parsedSafeCode(parsed.positionals[0], "Record key", 512);
    validateMutation(parsed);
  } else if (command === "sync") {
    assertPositionals(parsed, 1);
    const action = parsed.positionals[0];
    if (action === "export") {
      assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "after", "limit"]);
      integer(one(parsed, "after"), "after");
      integer(one(parsed, "limit"), "limit", 1, 1000);
    } else if (action === "import") {
      assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "file"]);
      const file = one(parsed, "file");
      if (file === undefined)
        throw new TypeError("sync import needs --file.");
      syncBundle = parseOhSyncBundleV1(await readSyncBundleFile(file));
      if (syncBundle === null)
        throw new TypeError("Invalid sync bundle.");
    } else {
      throw new TypeError("sync needs export or import.");
    }
  } else {
    throw new TypeError(`Unknown command: ${command}`);
  }
  const common = validateCommon(parsed);
  if (syncBundle !== null && syncBundle.spaceId !== common.spaceId) {
    throw new TypeError("Invalid sync bundle.");
  }
  return { ...common, putRecord, syncBundle };
}
function print(value) {
  process.stdout.write(`${canonicalJson(value)}
`);
}
async function readSyncBundleFile(path) {
  const maximumFileBytes = OH_SYNC_BUNDLE_MAX_BYTES_V1 + 1;
  const metadata = await lstat(path);
  if (!metadata.isFile() || !Number.isSafeInteger(metadata.size) || metadata.size > maximumFileBytes) {
    throw new RangeError(`Sync bundle file must be a regular file of at most ${maximumFileBytes} bytes.`);
  }
  const contents = await readFile(path);
  if (contents.byteLength > maximumFileBytes) {
    throw new RangeError(`Sync bundle file must be at most ${maximumFileBytes} bytes.`);
  }
  return JSON.parse(contents.toString("utf8"));
}
var HELP = `oh ${OH_PACKAGE_VERSION}

Usage:
  oh init [--db PATH] [--space ID]
  oh put --kind KIND --key KEY (--json JSON | --file PATH) [--depends-on KEY]
  oh get KEY
  oh list [--kind KIND] [--limit N]
  oh log [--limit N]
  oh search QUERY [--mode keyword|semantic|hybrid] [--limit N]
  oh recall QUERY [--as-of INSTANT] [--mode keyword|semantic|hybrid] [--limit N]
  oh tombstone KEY
  oh verify
  oh sync export [--after N] [--limit N]
  oh sync import --file PATH
  oh contract
  oh version

Global options: --db PATH (default .oh/oh.sqlite), --space ID (default default)
Mutation options: --actor ID, --operation ID, --expected-generation N
`;
async function runOhCli(arguments_) {
  const command = arguments_[0];
  if (command === undefined || command === "help" || command === "--help") {
    if (arguments_.length > 1)
      throw new TypeError("help does not accept arguments or options.");
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "version" || command === "--version") {
    if (arguments_.length !== 1)
      throw new TypeError("version does not accept arguments or options.");
    process.stdout.write(`${OH_PACKAGE_VERSION}
`);
    return 0;
  }
  const parsed = parseArguments(arguments_.slice(1));
  const validated = await validateInvocation(command, parsed);
  if (command === "contract") {
    print({ manifest: OH_CONTRACT_MANIFEST_V1, sqliteSchemaVersion: OH_SQLITE_SCHEMA_VERSION, v: 1 });
    return 0;
  }
  const { Oh: Oh2 } = await Promise.resolve().then(() => (init_sdk(), exports_sdk));
  const oh = Oh2.open({ databasePath: validated.databasePath, spaceId: validated.spaceId });
  try {
    if (command === "init") {
      print({ head: oh.head(), spaceId: oh.store.spaceId, v: 1 });
      return 0;
    }
    if (command === "put") {
      const record = validated.putRecord;
      if (record === null)
        throw new TypeError("Invalid prepared put command.");
      const head5 = oh.head();
      const expectedGeneration = integer(one(parsed, "expected-generation"), "expected-generation");
      const operation = oh.store.commit({
        actorId: one(parsed, "actor", "agent.local"),
        changes: [{ kind: "put", record, v: 1 }],
        expectedHead: {
          generation: expectedGeneration ?? head5.generation,
          operationSha256: head5.operationSha256
        },
        operationId: one(parsed, "operation") ?? opaqueId("op_")
      });
      print(operation);
      return 0;
    }
    if (command === "tombstone") {
      const key = parsed.positionals[0];
      if (key === undefined || parsed.positionals.length !== 1)
        throw new TypeError("tombstone needs one record key.");
      const head5 = oh.head();
      const expectedGeneration = integer(one(parsed, "expected-generation"), "expected-generation");
      const record = oh.get(key);
      if (record === null)
        return 3;
      const operation = oh.store.commit({
        actorId: one(parsed, "actor", "agent.local"),
        changes: [{ key, kind: "tombstone", priorSha256: record.recordSha256, v: 1 }],
        expectedHead: { generation: expectedGeneration ?? head5.generation, operationSha256: head5.operationSha256 },
        operationId: one(parsed, "operation") ?? opaqueId("op_")
      });
      print(operation);
      return 0;
    }
    if (command === "get") {
      const key = parsed.positionals[0];
      if (key === undefined || parsed.positionals.length !== 1)
        throw new TypeError("get needs one record key.");
      const record = oh.get(key);
      if (record === null)
        return 3;
      print(record);
      return 0;
    }
    if (command === "list") {
      const kind = one(parsed, "kind");
      if (kind !== undefined && !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind))
        throw new TypeError("Unknown record kind.");
      const limit = integer(one(parsed, "limit"), "limit");
      print({ records: oh.list({ ...kind === undefined ? {} : { kind }, ...limit === undefined ? {} : { limit } }), v: 1 });
      return 0;
    }
    if (command === "log") {
      print({ operations: oh.store.log(integer(one(parsed, "limit"), "limit")), v: 1 });
      return 0;
    }
    if (command === "search") {
      const query = parsed.positionals.join(" ");
      const mode = one(parsed, "mode", "keyword");
      if (query.length === 0 || mode !== "keyword" && mode !== "semantic" && mode !== "hybrid")
        throw new TypeError("search needs a query and a valid mode.");
      const limit = integer(one(parsed, "limit"), "limit");
      print(await oh.search(query, { ...limit === undefined ? {} : { limit }, mode }));
      return 0;
    }
    if (command === "recall") {
      const query = parsed.positionals.join(" ");
      const mode = one(parsed, "mode", "keyword");
      if (query.length === 0 || mode !== "keyword" && mode !== "semantic" && mode !== "hybrid")
        throw new TypeError("recall needs a query and a valid mode.");
      const limit = integer(one(parsed, "limit"), "limit");
      const asOf = parseCanonicalInstantV1(one(parsed, "as-of"));
      const resolved = asOf === null ? null : resolveRelativeDateWindowV1(query, asOf);
      const window = resolved === null ? null : { since: resolved.since, until: resolved.until, v: 1 };
      const recall = await oh.recall(query, { asOf, ...limit === undefined ? {} : { limit }, mode, window });
      print({ recall, rendering: renderOhRecallV1(recall, { asOf, budgetBytes: RECALL_RENDER_BUDGET_BYTES }), v: 1 });
      return 0;
    }
    if (command === "verify") {
      print(oh.verify());
      return 0;
    }
    if (command === "sync") {
      const action = parsed.positionals[0];
      if (action === "export") {
        const after3 = integer(one(parsed, "after"), "after") ?? 0;
        const limit = integer(one(parsed, "limit"), "limit") ?? 1000;
        print(createOhSyncBundleV1(oh.store.spaceId, oh.store.exportOperations(after3, limit), {
          largestFittingPrefix: true
        }));
        return 0;
      }
      if (action === "import") {
        const bundle = validated.syncBundle;
        if (bundle === null)
          throw new TypeError("Invalid prepared sync import command.");
        const first = bundle.operations[0];
        if (first === undefined) {
          print({ head: oh.head(), imported: 0, v: 1 });
          return 0;
        }
        const imported = oh.store.importOperations({
          expectedHead: {
            operationSha256: first.parentOperationSha256,
            sequence: first.sequence - 1
          },
          operations: bundle.operations
        });
        print({ head: imported.head, imported: imported.imported, v: 1 });
        return 0;
      }
      throw new TypeError("sync needs export or import.");
    }
    throw new TypeError(`Unknown command: ${command}`);
  } finally {
    await oh.close();
  }
}
if (import.meta.main) {
  runOhCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`oh: ${error instanceof Error ? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
export {
  runOhCli,
  OH_PACKAGE_VERSION
};
