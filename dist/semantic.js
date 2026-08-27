// @bun
// src/semantic.ts
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import { join, resolve } from "path";

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

// src/semantic.ts
var OH_EMBEDDING_PROFILE_V1 = Object.freeze({
  dimensions: 768,
  distance: "cosine",
  documentation: "https://ai.google.dev/gemma/docs/embeddinggemma",
  documentFormat: "title: {title} | text: {content}",
  engine: "@tobilu/qmd@2.5.3",
  model: "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
  normalization: "l2",
  queryFormat: "task: search result | query: {query}",
  v: 1
});
function formatOhEmbeddingQueryV1(query) {
  return `task: search result | query: ${query}`;
}
function formatOhEmbeddingDocumentV1(title, content) {
  return `title: ${title} | text: ${content}`;
}
function normalizeOhEmbeddingV1(vector) {
  if (vector.length !== OH_EMBEDDING_PROFILE_V1.dimensions || vector.some((component) => !Number.isFinite(component))) {
    throw new TypeError(`Embedding vectors must contain ${OH_EMBEDDING_PROFILE_V1.dimensions} finite values.`);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, component) => sum + component * component, 0));
  if (magnitude === 0)
    throw new TypeError("Embedding vectors must have nonzero magnitude.");
  return vector.map((component) => component / magnitude);
}
function cosineSimilarityV1(left, right) {
  const normalizedLeft = normalizeOhEmbeddingV1(left);
  const normalizedRight = normalizeOhEmbeddingV1(right);
  return normalizedLeft.reduce((sum, component, index) => sum + component * normalizedRight[index], 0);
}
var qmdModuleSpecifier = "@tobilu/qmd";
async function defaultQmdStoreFactory(options) {
  let module;
  try {
    module = await import(qmdModuleSpecifier);
  } catch {
    throw new Error("Semantic search needs the optional @tobilu/qmd@2.5.3 package.");
  }
  const createStore = module.createStore;
  if (typeof createStore !== "function")
    throw new Error("The installed QMD package has no compatible createStore export.");
  return await createStore(options);
}
function recordDocument(record) {
  return `# ${record.key}

kind: ${record.kind}

${canonicalJson(record.value)}
`;
}
var QMD_VECTOR_RESULT_KEYS = [
  "body",
  "bodyLength",
  "chunkPos",
  "collectionName",
  "context",
  "displayPath",
  "docid",
  "filepath",
  "hash",
  "modifiedAt",
  "score",
  "source",
  "title"
];
function semanticManifest(entries) {
  const immutableEntries = {};
  for (const [filename, entry] of Object.entries(entries)) {
    immutableEntries[filename] = Object.freeze({ ...entry });
  }
  return Object.freeze({
    entries: Object.freeze(immutableEntries),
    profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1),
    v: 1
  });
}
function parseQmdVectorResult(value) {
  if (!isPlainRecord(value) || !hasExactKeys(value, QMD_VECTOR_RESULT_KEYS))
    return null;
  const pathMatch = typeof value.filepath === "string" ? /^qmd:\/\/oh\/([a-f0-9]{64}\.md)$/u.exec(value.filepath) : null;
  const filename = pathMatch?.[1];
  const hash = parseSha256Hex(value.hash);
  const title = safeCode(value.title, 512);
  if (filename === undefined || value.displayPath !== `oh/${filename}` || value.collectionName !== "oh" || value.source !== "vec" || value.context !== null || value.modifiedAt !== "" || hash === null || value.docid !== hash.slice(0, 6) || title === null || typeof value.body !== "string" || typeof value.bodyLength !== "number" || !Number.isSafeInteger(value.bodyLength) || value.bodyLength < 0 || value.bodyLength > OH_GRAPH_LIMITS_V1.recordBytes + 4096 || value.body.length !== value.bodyLength || hash !== sha256Hex(value.body) || typeof value.chunkPos !== "number" || !Number.isSafeInteger(value.chunkPos) || value.chunkPos < 0 || typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) {
    return null;
  }
  return { body: value.body, filename, hash, score: value.score, title };
}
function parseQmdVectorResults(value) {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("QMD returned an invalid vector result batch.");
  }
  return value.map(parseQmdVectorResult).filter((result) => result !== null);
}

class OhQmdSemanticBackendV1 {
  profile = OH_EMBEDDING_PROFILE_V1;
  #cacheDirectory;
  #databasePath;
  #factory;
  #manifest = semanticManifest({});
  #manifestLoad = null;
  #store = null;
  #storeClose = null;
  #closure = null;
  #indexQueue = Promise.resolve();
  #activeSearches = new Set;
  #closed = false;
  constructor(options) {
    this.#cacheDirectory = resolve(options.cacheDirectory);
    this.#databasePath = resolve(options.databasePath ?? join(this.#cacheDirectory, "qmd.sqlite"));
    this.#factory = options.storeFactory ?? defaultQmdStoreFactory;
  }
  async#open() {
    if (this.#closed)
      throw new Error("The semantic backend is closed.");
    this.#store ??= this.#initializeStore();
    const store = await this.#store;
    if (this.#closed) {
      await this.#closeStore(store);
      throw new Error("The semantic backend is closed.");
    }
    return store;
  }
  async#initializeStore() {
    const documents = join(this.#cacheDirectory, "documents");
    await mkdir(documents, { recursive: true });
    await this.#loadManifest();
    if (this.#closed)
      throw new Error("The semantic backend is closed.");
    const store = await this.#factory({
      dbPath: this.#databasePath,
      config: {
        collections: { oh: { path: documents, pattern: "*.md" } },
        models: { embed: OH_EMBEDDING_PROFILE_V1.model }
      }
    });
    if (this.#closed) {
      await this.#closeStore(store);
      throw new Error("The semantic backend is closed.");
    }
    return store;
  }
  #closeStore(store) {
    this.#storeClose ??= Promise.resolve().then(() => store.close());
    return this.#storeClose;
  }
  #loadManifest() {
    this.#manifestLoad ??= this.#readManifest();
    return this.#manifestLoad;
  }
  async#readManifest() {
    let text;
    try {
      text = await readFile(join(this.#cacheDirectory, "manifest.json"), "utf8");
    } catch (error) {
      if (error.code === "ENOENT")
        return;
      throw error;
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("The semantic manifest is not JSON.");
    }
    if (canonicalJson(value) !== text || !isPlainRecord(value) || !hasExactKeys(value, ["entries", "profileSha256", "v"]) || value.v !== 1 || value.profileSha256 !== canonicalSha256(OH_EMBEDDING_PROFILE_V1) || !isPlainRecord(value.entries) || Object.keys(value.entries).length > 65536)
      throw new Error("The semantic manifest is incompatible or invalid.");
    const entries = {};
    for (const [filename, candidate] of Object.entries(value.entries)) {
      if (!/^[a-f0-9]{64}\.md$/u.test(filename) || !isPlainRecord(candidate) || !hasExactKeys(candidate, ["key", "recordSha256"]))
        throw new Error("The semantic manifest has an invalid entry.");
      const key = safeCode(candidate.key, 512);
      const recordSha256 = parseSha256Hex(candidate.recordSha256);
      if (key === null || recordSha256 === null || filename !== `${sha256Hex(key)}.md`) {
        throw new Error("The semantic manifest entry identity is invalid.");
      }
      entries[filename] = { key, recordSha256 };
    }
    this.#manifest = semanticManifest(entries);
  }
  index(records) {
    if (records.length > 65536) {
      return Promise.reject(new RangeError("A semantic snapshot may contain at most 65,536 records."));
    }
    if (this.#closed)
      return Promise.reject(new Error("The semantic backend is closed."));
    const snapshot = [...records];
    const operation = this.#indexQueue.then(() => this.#indexSnapshot(snapshot));
    this.#indexQueue = operation.then(() => {
      return;
    }, () => {
      return;
    });
    return operation;
  }
  async#indexSnapshot(records) {
    if (this.#closed)
      throw new Error("The semantic backend is closed.");
    const documents = join(this.#cacheDirectory, "documents");
    await mkdir(documents, { recursive: true });
    await this.#loadManifest();
    const entries = {};
    for (const record of records) {
      const filename = `${sha256Hex(record.key)}.md`;
      entries[filename] = { key: record.key, recordSha256: record.recordSha256 };
      const path = join(documents, filename);
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, recordDocument(record), { encoding: "utf8", mode: 384 });
      await rename(temporary, path);
    }
    const retained = new Set(Object.keys(entries));
    for (const filename of await readdir(documents)) {
      if (/^[a-f0-9]{64}\.md$/u.test(filename) && !retained.has(filename))
        await unlink(join(documents, filename));
    }
    const nextManifest = semanticManifest(entries);
    const store = await this.#open();
    await store.update({ collections: ["oh"] });
    await store.embed({ collection: "oh", model: OH_EMBEDDING_PROFILE_V1.model });
    const manifestPath = join(this.#cacheDirectory, "manifest.json");
    const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
    await writeFile(temporaryManifest, canonicalJson(nextManifest), { encoding: "utf8", mode: 384 });
    await rename(temporaryManifest, manifestPath);
    this.#manifest = nextManifest;
    return { indexed: records.length, v: 1 };
  }
  search(query, limit, authority) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return Promise.reject(new RangeError("Semantic limit must be 1 through 100."));
    }
    if (this.#closed)
      return Promise.reject(new Error("The semantic backend is closed."));
    const operation = this.#searchSnapshot(query, limit, authority);
    this.#activeSearches.add(operation);
    operation.then(() => {
      this.#activeSearches.delete(operation);
    }, () => {
      this.#activeSearches.delete(operation);
    });
    return operation;
  }
  async#searchSnapshot(query, limit, authority) {
    const store = await this.#open();
    const manifest = this.#manifest;
    const results = parseQmdVectorResults(await store.searchVector(query, { collection: "oh", limit: Math.min(100, limit * 3) }));
    const output = [];
    const seen = new Set;
    for (const result of results) {
      const entry = manifest.entries[result.filename];
      if (entry === undefined || result.title !== entry.key || seen.has(entry.key))
        continue;
      const current = authority.get(entry.key);
      if (current === null || current.recordSha256 !== entry.recordSha256)
        continue;
      const expectedDocument = recordDocument(current);
      if (result.body !== expectedDocument || result.hash !== sha256Hex(expectedDocument))
        continue;
      seen.add(entry.key);
      output.push({ key: entry.key, recordSha256: entry.recordSha256, score: result.score, v: 1 });
      if (output.length === limit)
        break;
    }
    return output;
  }
  async#finishClose() {
    await this.#indexQueue;
    await Promise.allSettled([...this.#activeSearches]);
    if (this.#store === null)
      return;
    try {
      const store = await this.#store;
      await this.#closeStore(store);
    } catch {
      if (this.#storeClose !== null)
        await this.#storeClose;
    }
  }
  close() {
    this.#closed = true;
    this.#closure ??= this.#finishClose();
    return this.#closure;
  }
}
export {
  normalizeOhEmbeddingV1,
  formatOhEmbeddingQueryV1,
  formatOhEmbeddingDocumentV1,
  cosineSimilarityV1,
  OhQmdSemanticBackendV1,
  OH_EMBEDDING_PROFILE_V1
};
