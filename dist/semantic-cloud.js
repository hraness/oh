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

// src/semantic.ts
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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
function normalizeOhEmbeddingV1(vector) {
  if (vector.length !== OH_EMBEDDING_PROFILE_V1.dimensions || vector.some((component) => !Number.isFinite(component))) {
    throw new TypeError(`Embedding vectors must contain ${OH_EMBEDDING_PROFILE_V1.dimensions} finite values.`);
  }
  const scale = vector.reduce((maximum, component) => Math.max(maximum, Math.abs(component)), 0);
  if (scale === 0)
    throw new TypeError("Embedding vectors must have nonzero magnitude.");
  const scaledMagnitude = Math.sqrt(vector.reduce((sum, component) => {
    const scaled = component / scale;
    return sum + scaled * scaled;
  }, 0));
  if (!Number.isFinite(scaledMagnitude) || scaledMagnitude === 0) {
    throw new TypeError("Embedding vectors must have finite nonzero magnitude.");
  }
  const normalized = vector.map((component) => component / scale / scaledMagnitude);
  if (normalized.some((component) => !Number.isFinite(component))) {
    throw new TypeError("Embedding vectors must normalize to finite values.");
  }
  return normalized;
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

// src/cloudflare-embedding.ts
var cloudflareEmbeddingProfilePayload = Object.freeze({
  dimensions: 768,
  distance: "cosine",
  documentFormat: "title: {title} | text: {content}",
  inputUtf8Bytes: 448,
  model: "@cf/google/embeddinggemma-300m",
  normalization: "l2",
  profileId: "oh.cloudflare.embeddinggemma.v1",
  provider: "cloudflare.workers-ai",
  queryFormat: "task: search result | query: {query}",
  v: 1
});
var OH_CLOUDFLARE_EMBEDDING_PROFILE_V1 = Object.freeze({
  ...cloudflareEmbeddingProfilePayload,
  profileSha256: canonicalSha256(cloudflareEmbeddingProfilePayload)
});
var semanticRendererPayload = Object.freeze({
  documentFormat: cloudflareEmbeddingProfilePayload.documentFormat,
  inputUtf8Bytes: cloudflareEmbeddingProfilePayload.inputUtf8Bytes,
  rendererId: "oh.embedding-input.utf8-chunks.v1",
  split: "unicode-scalar-greedy",
  v: 1
});
var OH_SEMANTIC_RENDERER_V1 = Object.freeze({
  ...semanticRendererPayload,
  rendererSha256: canonicalSha256(semanticRendererPayload)
});
var OH_CLOUDFLARE_EMBEDDING_LIMITS_V1 = Object.freeze({
  batchInputs: 32,
  deadlineMs: 30000,
  documentBytes: 8 * 1024 * 1024,
  inputUtf8Bytes: 448,
  responseBytes: 8 * 1024 * 1024,
  renderedChunks: 256,
  titleBytes: 16 * 1024
});

class OhCloudflareEmbeddingError extends Error {
  code;
  status;
  constructor(code, message, status = null) {
    super(message);
    this.name = "OhCloudflareEmbeddingError";
    this.code = code;
    this.status = status;
  }
}
var renderedEmbeddingInputs = new WeakSet;
function formattedInput(kind, input) {
  const utf8Bytes = utf8ByteLength(input);
  if (utf8Bytes > OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes) {
    throw new OhCloudflareEmbeddingError("invalid-input", `A formatted embedding input exceeds ${OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes} UTF-8 bytes.`);
  }
  const rendered = {
    input,
    inputSha256: sha256Hex(input),
    kind,
    utf8Bytes,
    v: 1
  };
  renderedEmbeddingInputs.add(rendered);
  return Object.freeze(rendered);
}
function renderOhCloudflareEmbeddingQueryV1(query) {
  const parsed = boundedText(query, OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes);
  if (parsed === null) {
    throw new OhCloudflareEmbeddingError("invalid-input", "An embedding query must be bounded NFC text.");
  }
  return formattedInput("query", `task: search result | query: ${parsed}`);
}
function prefixForTitle(title) {
  return `title: ${title} | text: `;
}
function renderOhCloudflareEmbeddingDocumentV1(input) {
  const title = boundedText(input.title, OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.titleBytes);
  const content = input.content === "" ? "" : boundedText(input.content, OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.documentBytes);
  const maximumChunks = input.maximumChunks ?? OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.renderedChunks;
  if (title === null || content === null || !Number.isSafeInteger(maximumChunks) || maximumChunks < 1 || maximumChunks > OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.renderedChunks) {
    throw new OhCloudflareEmbeddingError("invalid-input", "A semantic document needs bounded NFC title/content and a valid chunk limit.");
  }
  const sourceUtf8Bytes = utf8ByteLength(content);
  const prefix = prefixForTitle(title);
  const capacity = OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes - utf8ByteLength(prefix);
  if (capacity < 1) {
    return Object.freeze({
      chunks: Object.freeze([]),
      diagnostic: Object.freeze({
        code: "oversize-prefix",
        maximumChunks,
        omittedUtf8Bytes: sourceUtf8Bytes,
        v: 1
      }),
      sourceUtf8Bytes,
      status: "oversize",
      v: 1
    });
  }
  const chunks = [];
  let cursor = 0;
  let emittedBytes = 0;
  chunks:
    while ((cursor < content.length || content.length === 0 && chunks.length === 0) && chunks.length < maximumChunks) {
      const start = cursor;
      let bytes = 0;
      while (cursor < content.length) {
        const codePoint = content.codePointAt(cursor);
        if (codePoint === undefined)
          break;
        const scalar = String.fromCodePoint(codePoint);
        const scalarBytes = utf8ByteLength(scalar);
        if (bytes + scalarBytes > capacity)
          break;
        bytes += scalarBytes;
        cursor += scalar.length;
      }
      if (cursor === start && content.length > 0) {
        break chunks;
      }
      const chunkContent = content.slice(start, cursor);
      const rendered = formattedInput("document", `${prefix}${chunkContent}`);
      chunks.push(Object.freeze({
        content: chunkContent,
        input: rendered,
        ordinal: chunks.length,
        title,
        v: 1
      }));
      emittedBytes += bytes;
    }
  const omittedUtf8Bytes = sourceUtf8Bytes - emittedBytes;
  const partial = cursor < content.length;
  const oversize = partial && chunks.length === 0;
  return Object.freeze({
    chunks: Object.freeze(chunks),
    diagnostic: partial ? Object.freeze({
      code: oversize ? "oversize-prefix" : "partial",
      maximumChunks,
      omittedUtf8Bytes,
      v: 1
    }) : null,
    sourceUtf8Bytes,
    status: oversize ? "oversize" : partial ? "partial" : "complete",
    v: 1
  });
}
function exactPositiveInteger(value, maximum, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} must be an integer from 1 through ${maximum}.`);
  }
  return value;
}
async function boundedResponseText(response, maximumBytes) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximumBytes) {
      throw new OhCloudflareEmbeddingError("invalid-response", "The embedding response exceeds its byte limit.");
    }
  }
  if (response.body === null)
    return "";
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done)
        break;
      size += next.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new OhCloudflareEmbeddingError("invalid-response", "The embedding response exceeds its byte limit.");
      }
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
function parseCloudflareVectors(value, count) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an invalid envelope.");
  }
  const envelope = value;
  if (envelope.success !== true || typeof envelope.result !== "object" || envelope.result === null || Array.isArray(envelope.result)) {
    throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an unsuccessful envelope.");
  }
  const result = envelope.result;
  if (!Array.isArray(result.data) || result.data.length !== count || !Array.isArray(result.shape) || result.shape.length !== 2 || result.shape[0] !== count || result.shape[1] !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions) {
    throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an incompatible shape.");
  }
  const vectors = result.data.map((candidate) => {
    if (!Array.isArray(candidate) || candidate.length !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions || candidate.some((component) => typeof component !== "number" || !Number.isFinite(component))) {
      throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an invalid vector.");
    }
    try {
      return Object.freeze([...normalizeOhEmbeddingV1(candidate)]);
    } catch {
      throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned an invalid vector.");
    }
  });
  return Object.freeze(vectors);
}

class OhCloudflareEmbeddingClientV1 {
  profile = OH_CLOUDFLARE_EMBEDDING_PROFILE_V1;
  #accountId;
  #apiToken;
  #deadlineMs;
  #fetch;
  #maximumBatchInputs;
  #maximumResponseBytes;
  constructor(options) {
    if (!/^[a-f0-9]{32}$/iu.test(options.accountId) || options.apiToken.length < 16 || options.apiToken.length > 4096 || /[\r\n]/u.test(options.apiToken)) {
      throw new OhCloudflareEmbeddingError("invalid-input", "Cloudflare credentials are malformed.");
    }
    this.#accountId = options.accountId.toLowerCase();
    this.#apiToken = options.apiToken;
    this.#deadlineMs = exactPositiveInteger(options.deadlineMs ?? 15000, OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.deadlineMs, "deadlineMs");
    this.#maximumBatchInputs = exactPositiveInteger(options.maximumBatchInputs ?? 16, OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.batchInputs, "maximumBatchInputs");
    this.#maximumResponseBytes = exactPositiveInteger(options.maximumResponseBytes ?? OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.responseBytes, OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.responseBytes, "maximumResponseBytes");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }
  async embed(inputs, options = {}) {
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > this.#maximumBatchInputs) {
      throw new OhCloudflareEmbeddingError("invalid-input", `An embedding batch must contain 1 through ${this.#maximumBatchInputs} inputs.`);
    }
    const text = inputs.map((candidate) => {
      if (!renderedEmbeddingInputs.has(candidate) || candidate.v !== 1 || candidate.kind !== "document" && candidate.kind !== "query" || candidate.utf8Bytes !== utf8ByteLength(candidate.input) || candidate.utf8Bytes > OH_CLOUDFLARE_EMBEDDING_LIMITS_V1.inputUtf8Bytes || parseSha256Hex(candidate.inputSha256) === null || candidate.inputSha256 !== sha256Hex(candidate.input)) {
        throw new OhCloudflareEmbeddingError("invalid-input", "A rendered embedding input is invalid.");
      }
      return candidate.input;
    });
    const deadline = AbortSignal.timeout(this.#deadlineMs);
    const signal = options.signal === undefined ? deadline : AbortSignal.any([options.signal, deadline]);
    let response;
    try {
      response = await this.#fetch(`https://api.cloudflare.com/client/v4/accounts/${this.#accountId}/ai/run/${OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.model}`, {
        body: JSON.stringify({ text }),
        headers: {
          authorization: `Bearer ${this.#apiToken}`,
          "content-type": "application/json"
        },
        method: "POST",
        redirect: "error",
        signal
      });
    } catch {
      if (signal.aborted) {
        throw new OhCloudflareEmbeddingError("aborted", "The embedding request was aborted.");
      }
      throw new OhCloudflareEmbeddingError("provider-unavailable", "The embedding provider is unavailable.");
    }
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {}
      throw new OhCloudflareEmbeddingError("provider-unavailable", `The embedding provider rejected the request with HTTP ${response.status}.`, response.status);
    }
    let value;
    try {
      value = JSON.parse(await boundedResponseText(response, this.#maximumResponseBytes));
    } catch (error) {
      if (error instanceof OhCloudflareEmbeddingError)
        throw error;
      if (signal.aborted) {
        throw new OhCloudflareEmbeddingError("aborted", "The embedding request was aborted.");
      }
      throw new OhCloudflareEmbeddingError("invalid-response", "The embedding provider returned invalid JSON.");
    }
    return parseCloudflareVectors(value, inputs.length);
  }
}
// src/libsql-semantic.ts
var OH_LIBSQL_SEMANTIC_LIMITS_V1 = Object.freeze({
  chunksPerDocument: 64,
  chunksPerGeneration: 4096,
  documentsPerGeneration: 512,
  embeddingBatch: 16,
  searchLimit: 100,
  searchPage: 128
});

class OhLibSqlSemanticError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "OhLibSqlSemanticError";
    this.code = code;
  }
}
var SCHEMA_NAME = "oh.libsql-semantic-cache.v1";
var SCHEMA_VERSION = 1;
var VECTOR_BYTES = OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions * 4;
var SCHEMA_TABLE = `CREATE TABLE IF NOT EXISTS oh_semantic_schemas (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;
var SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS oh_semantic_vectors (
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    vector_sha256 TEXT NOT NULL,
    vector BLOB NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(profile_sha256, renderer_sha256, input_sha256)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_generations (
    authority_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    authority_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    membership_sha256 TEXT NOT NULL,
    generation_sha256 TEXT NOT NULL UNIQUE,
    document_count INTEGER NOT NULL CHECK(document_count >= 0),
    chunk_count INTEGER NOT NULL CHECK(chunk_count >= 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY(authority_id, generation)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_memberships (
    authority_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    generation_sha256 TEXT NOT NULL,
    record_key TEXT NOT NULL,
    record_sha256 TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    input_sha256 TEXT NOT NULL,
    PRIMARY KEY(authority_id, generation, record_key, ordinal)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_heads (
    authority_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    authority_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    membership_sha256 TEXT NOT NULL,
    generation_sha256 TEXT NOT NULL,
    published_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_purges (
    authority_id TEXT PRIMARY KEY,
    purged_at TEXT NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS oh_semantic_memberships_generation
    ON oh_semantic_memberships(authority_id, generation, record_key, ordinal)`,
  `CREATE INDEX IF NOT EXISTS oh_semantic_memberships_input
    ON oh_semantic_memberships(input_sha256)`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_vectors_no_update
    BEFORE UPDATE ON oh_semantic_vectors
    BEGIN SELECT RAISE(ABORT, 'Oh semantic vectors are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_generations_no_update
    BEFORE UPDATE ON oh_semantic_generations
    BEGIN SELECT RAISE(ABORT, 'Oh semantic generations are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_no_update
    BEFORE UPDATE ON oh_semantic_memberships
    BEGIN SELECT RAISE(ABORT, 'Oh semantic memberships are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_generations_purge_guard
    BEFORE INSERT ON oh_semantic_generations
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_purge_guard
    BEFORE INSERT ON oh_semantic_memberships
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_published_guard
    BEFORE INSERT ON oh_semantic_memberships
    WHEN EXISTS (SELECT 1 FROM oh_semantic_heads
      WHERE authority_id = NEW.authority_id AND generation = NEW.generation)
      AND NOT EXISTS (SELECT 1 FROM oh_semantic_memberships
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND record_key = NEW.record_key AND record_sha256 = NEW.record_sha256
          AND ordinal = NEW.ordinal AND input_sha256 = NEW.input_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic generation is published'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_heads_insert_purge_guard
    BEFORE INSERT ON oh_semantic_heads
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_heads_update_purge_guard
    BEFORE UPDATE ON oh_semantic_heads
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_purges_no_update
    BEFORE UPDATE ON oh_semantic_purges
    BEGIN SELECT RAISE(ABORT, 'Oh semantic purge markers are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_purges_no_delete
    BEFORE DELETE ON oh_semantic_purges
    BEGIN SELECT RAISE(ABORT, 'Oh semantic purge markers are immutable'); END`
]);
function normalizedSchemaSql(sql) {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\b/giu, "").replace(/\s+/gu, " ").trim();
}
function expectedSchemaObject(statement) {
  const match = /^CREATE\s+(TABLE|INDEX|TRIGGER)(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z0-9_]+)/iu.exec(statement.trim());
  if (match === null)
    throw new Error("Invalid compiled semantic schema statement.");
  const declared = match[1]?.toLowerCase();
  const type = declared === "index" ? "index" : declared === "trigger" ? "trigger" : "table";
  const name = match[2];
  const owner = type === "table" ? name : /\bON\s+([a-z0-9_]+)/iu.exec(statement)?.[1];
  if (owner === undefined)
    throw new Error("Invalid compiled semantic schema owner.");
  return { name, sql: normalizedSchemaSql(statement), tableName: owner, type };
}
var EXPECTED_SCHEMA_OBJECTS = Object.freeze([SCHEMA_TABLE, ...SCHEMA_STATEMENTS].map(expectedSchemaObject).sort((left, right) => canonicalJson([left.type, left.name]).localeCompare(canonicalJson([right.type, right.name]))));
var SCHEMA_SHA256 = canonicalSha256(EXPECTED_SCHEMA_OBJECTS);
function rowValue(row, key, index) {
  return Array.isArray(row) ? row[index] : row[key];
}
function integer(value) {
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : null;
  }
  return null;
}
function rowsAffected(result) {
  return typeof result.rowsAffected === "number" && Number.isSafeInteger(result.rowsAffected) && result.rowsAffected >= 0 ? result.rowsAffected : 0;
}
function parseAuthorityId(value) {
  const parsed = safeCode(value, 256);
  if (parsed === null)
    throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic authority ID.");
  return parsed;
}
function parseRecordKey(value) {
  const parsed = safeCode(value, 512);
  if (parsed === null)
    throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic record key.");
  return parsed;
}
function parseGeneration(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic authority generation.");
  }
  return value;
}
function parseDigest(value, label) {
  const digest = parseSha256Hex(value);
  if (digest === null)
    throw new OhLibSqlSemanticError("invalid-input", `Invalid ${label} digest.`);
  return digest;
}
function parseInstant(value) {
  const instant = parseCanonicalInstantV1(value);
  if (instant === null)
    throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic instant.");
  return instant;
}
async function schemaObjects(client) {
  const result = await client.execute(`SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND (name GLOB 'oh_semantic_*' OR tbl_name GLOB 'oh_semantic_*')
    ORDER BY type, name`);
  return result.rows.map((row) => {
    const type = rowValue(row, "type", 0);
    const name = rowValue(row, "name", 1);
    const tableName = rowValue(row, "tbl_name", 2);
    const sql = rowValue(row, "sql", 3);
    if (type !== "index" && type !== "table" && type !== "trigger" || typeof name !== "string" || typeof tableName !== "string" || typeof sql !== "string") {
      throw new OhLibSqlSemanticError("integrity", "The semantic schema inventory is malformed.");
    }
    const schemaType = type;
    return { name, sql: normalizedSchemaSql(sql), tableName, type: schemaType };
  }).sort((left, right) => canonicalJson([left.type, left.name]).localeCompare(canonicalJson([right.type, right.name])));
}
async function verifySchema(client) {
  let marker;
  try {
    marker = await client.execute({
      args: [SCHEMA_VERSION],
      sql: "SELECT name, schema_sha256 FROM oh_semantic_schemas WHERE version = ?"
    });
  } catch {
    throw new OhLibSqlSemanticError("schema-unavailable", "The semantic cache schema is unavailable.");
  }
  const row = marker.rows[0];
  if (marker.rows.length !== 1 || row === undefined || rowValue(row, "name", 0) !== SCHEMA_NAME || rowValue(row, "schema_sha256", 1) !== SCHEMA_SHA256) {
    throw new OhLibSqlSemanticError("schema-unavailable", "The semantic cache schema marker is invalid.");
  }
  if (canonicalJson(await schemaObjects(client)) !== canonicalJson(EXPECTED_SCHEMA_OBJECTS)) {
    throw new OhLibSqlSemanticError("integrity", "The semantic cache schema has drifted.");
  }
}
async function bootstrapOhLibSqlSemanticCacheV1(client, options = {}) {
  const appliedAt = parseInstant(options.appliedAt ?? canonicalNow());
  const existing = await schemaObjects(client);
  if (existing.length === 0) {
    await client.batch([
      { sql: SCHEMA_TABLE },
      ...SCHEMA_STATEMENTS.map((sql) => ({ sql })),
      {
        args: [SCHEMA_VERSION, SCHEMA_NAME, SCHEMA_SHA256, appliedAt],
        sql: `INSERT INTO oh_semantic_schemas(version, name, schema_sha256, applied_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(version) DO NOTHING`
      }
    ], "write");
  } else if (canonicalJson(existing) !== canonicalJson(EXPECTED_SCHEMA_OBJECTS)) {
    throw new OhLibSqlSemanticError("integrity", "Refusing to bless a partial or drifted semantic schema.");
  }
  await verifySchema(client);
  return Object.freeze({ schemaSha256: SCHEMA_SHA256, schemaVersion: 1, v: 1 });
}
function vectorBytes(vector) {
  const normalized = normalizeOhEmbeddingV1(vector);
  const bytes = new Uint8Array(VECTOR_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const [index, component] of normalized.entries())
    view.setFloat32(index * 4, component, true);
  return bytes;
}
function storedBytes(value) {
  if (value instanceof Uint8Array)
    return new Uint8Array(value);
  if (value instanceof ArrayBuffer)
    return new Uint8Array(value.slice(0));
  return null;
}
function decodeVector(value, expectedSha256) {
  const bytes = storedBytes(value);
  const digest = parseSha256Hex(expectedSha256);
  if (bytes === null || bytes.byteLength !== VECTOR_BYTES || digest === null || sha256Hex(bytes) !== digest) {
    throw new OhLibSqlSemanticError("integrity", "A cached semantic vector is corrupt.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = Array.from({ length: OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions }, (_, index) => view.getFloat32(index * 4, true));
  try {
    return Object.freeze([...normalizeOhEmbeddingV1(vector)]);
  } catch {
    throw new OhLibSqlSemanticError("integrity", "A cached semantic vector is invalid.");
  }
}
function prepareGeneration(input) {
  const authorityId = parseAuthorityId(input.authorityId);
  const authoritySha256 = parseDigest(input.authoritySha256, "authority");
  const generation = parseGeneration(input.generation);
  const createdAt = parseInstant(input.createdAt ?? canonicalNow());
  const maximumChunks = input.maximumChunksPerDocument ?? OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerDocument;
  if (!Number.isSafeInteger(maximumChunks) || maximumChunks < 1 || maximumChunks > OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerDocument || !Array.isArray(input.documents) || input.documents.length < 1 || input.documents.length > OH_LIBSQL_SEMANTIC_LIMITS_V1.documentsPerGeneration) {
    throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic generation bounds.");
  }
  const documents = input.documents.map((document) => {
    if (document.v !== 1)
      throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic document version.");
    return {
      ...document,
      key: parseRecordKey(document.key),
      recordSha256: parseDigest(document.recordSha256, "record")
    };
  }).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  if (new Set(documents.map(({ key }) => key)).size !== documents.length) {
    throw new OhLibSqlSemanticError("invalid-input", "Semantic document keys must be unique.");
  }
  const memberships = [];
  for (const document of documents) {
    const rendered = renderOhCloudflareEmbeddingDocumentV1({
      content: document.content,
      maximumChunks,
      title: document.title
    });
    if (rendered.status !== "complete") {
      throw new OhLibSqlSemanticError("invalid-input", "A semantic document exceeds the complete renderer bound.");
    }
    for (const chunk of rendered.chunks) {
      memberships.push(Object.freeze({
        input: chunk.input,
        inputSha256: chunk.input.inputSha256,
        ordinal: chunk.ordinal,
        recordKey: document.key,
        recordSha256: document.recordSha256
      }));
    }
  }
  if (memberships.length < 1 || memberships.length > OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerGeneration) {
    throw new OhLibSqlSemanticError("invalid-input", "The semantic generation exceeds its chunk bound.");
  }
  const membershipSha256 = canonicalSha256(memberships.map((membership) => ({
    inputSha256: membership.inputSha256,
    ordinal: membership.ordinal,
    recordKey: membership.recordKey,
    recordSha256: membership.recordSha256
  })));
  const generationSha256 = canonicalSha256({
    authorityId,
    authoritySha256,
    chunkCount: memberships.length,
    documentCount: documents.length,
    generation,
    membershipSha256,
    profileSha256: OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
    rendererSha256: OH_SEMANTIC_RENDERER_V1.rendererSha256,
    v: 1
  });
  return Object.freeze({
    authorityId,
    authoritySha256,
    chunkCount: memberships.length,
    createdAt,
    documentCount: documents.length,
    generation,
    generationSha256,
    membershipSha256,
    memberships: Object.freeze(memberships)
  });
}
function parseStoredGeneration(row) {
  const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
  const generation = integer(rowValue(row, "generation", 1));
  const authoritySha256 = parseSha256Hex(rowValue(row, "authority_sha256", 2));
  const profileSha256 = parseSha256Hex(rowValue(row, "profile_sha256", 3));
  const rendererSha256 = parseSha256Hex(rowValue(row, "renderer_sha256", 4));
  const membershipSha256 = parseSha256Hex(rowValue(row, "membership_sha256", 5));
  const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 6));
  const documentCount = integer(rowValue(row, "document_count", 7));
  const chunkCount = integer(rowValue(row, "chunk_count", 8));
  const createdAtValue = rowValue(row, "created_at", 9);
  const createdAt = parseCanonicalInstantV1(createdAtValue);
  if (authorityId === null || generation === null || generation < 0 || authoritySha256 === null || profileSha256 === null || rendererSha256 === null || membershipSha256 === null || generationSha256 === null || documentCount === null || documentCount < 1 || documentCount > OH_LIBSQL_SEMANTIC_LIMITS_V1.documentsPerGeneration || chunkCount === null || chunkCount < 1 || chunkCount > OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerGeneration || createdAt === null) {
    throw new OhLibSqlSemanticError("integrity", "A stored semantic generation is invalid.");
  }
  return Object.freeze({
    authorityId,
    authoritySha256,
    chunkCount,
    createdAt,
    documentCount,
    generation,
    generationSha256,
    membershipSha256,
    profileSha256,
    rendererSha256
  });
}
function generationMatches(left, right) {
  return left.authorityId === right.authorityId && left.authoritySha256 === right.authoritySha256 && left.chunkCount === right.chunkCount && left.documentCount === right.documentCount && left.generation === right.generation && left.generationSha256 === right.generationSha256 && left.membershipSha256 === right.membershipSha256 && left.profileSha256 === OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256 && left.rendererSha256 === OH_SEMANTIC_RENDERER_V1.rendererSha256;
}
function parseStoredHead(row) {
  const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
  const generation = integer(rowValue(row, "generation", 1));
  const authoritySha256 = parseSha256Hex(rowValue(row, "authority_sha256", 2));
  const profileSha256 = parseSha256Hex(rowValue(row, "profile_sha256", 3));
  const rendererSha256 = parseSha256Hex(rowValue(row, "renderer_sha256", 4));
  const membershipSha256 = parseSha256Hex(rowValue(row, "membership_sha256", 5));
  const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 6));
  const publishedAtValue = rowValue(row, "published_at", 7);
  const publishedAt = parseCanonicalInstantV1(publishedAtValue);
  if (authorityId === null || generation === null || generation < 0 || authoritySha256 === null || profileSha256 === null || rendererSha256 === null || membershipSha256 === null || generationSha256 === null || publishedAt === null) {
    throw new OhLibSqlSemanticError("integrity", "A stored semantic head is invalid.");
  }
  return Object.freeze({
    authorityId,
    authoritySha256,
    generation,
    generationSha256,
    membershipSha256,
    profileSha256,
    publishedAt,
    rendererSha256
  });
}
function headMatchesGeneration(head, generation) {
  return head.authorityId === generation.authorityId && head.authoritySha256 === generation.authoritySha256 && head.generation === generation.generation && head.generationSha256 === generation.generationSha256 && head.membershipSha256 === generation.membershipSha256 && head.profileSha256 === generation.profileSha256 && head.rendererSha256 === generation.rendererSha256;
}
var GENERATION_SELECT = `SELECT authority_id, generation, authority_sha256,
  profile_sha256, renderer_sha256, membership_sha256, generation_sha256,
  document_count, chunk_count, created_at
  FROM oh_semantic_generations WHERE authority_id = ? AND generation = ?`;
var HEAD_SELECT = `SELECT authority_id, generation, authority_sha256,
  profile_sha256, renderer_sha256, membership_sha256, generation_sha256, published_at
  FROM oh_semantic_heads WHERE authority_id = ?`;
async function readGeneration(client, authorityId, generation) {
  const result = await client.execute({ args: [authorityId, generation], sql: GENERATION_SELECT });
  if (result.rows.length > 1)
    throw new OhLibSqlSemanticError("integrity", "Duplicate semantic generations.");
  const row = result.rows[0];
  return row === undefined ? null : parseStoredGeneration(row);
}
async function readHead(client, authorityId) {
  const result = await client.execute({ args: [authorityId], sql: HEAD_SELECT });
  if (result.rows.length > 1)
    throw new OhLibSqlSemanticError("integrity", "Duplicate semantic heads.");
  const row = result.rows[0];
  return row === undefined ? null : parseStoredHead(row);
}
async function readPurge(client, authorityId) {
  const result = await client.execute({
    args: [authorityId],
    sql: "SELECT purged_at FROM oh_semantic_purges WHERE authority_id = ?"
  });
  if (result.rows.length > 1)
    throw new OhLibSqlSemanticError("integrity", "Duplicate semantic purge markers.");
  const row = result.rows[0];
  if (row === undefined)
    return null;
  const purgedAt = parseCanonicalInstantV1(rowValue(row, "purged_at", 0));
  if (purgedAt === null)
    throw new OhLibSqlSemanticError("integrity", "The semantic purge marker is invalid.");
  return purgedAt;
}
async function readMemberships(client, generation) {
  const memberships = [];
  for (let offset = 0;offset < generation.chunkCount; offset += OH_LIBSQL_SEMANTIC_LIMITS_V1.searchPage) {
    const result = await client.execute({
      args: [
        generation.authorityId,
        generation.generation,
        OH_LIBSQL_SEMANTIC_LIMITS_V1.searchPage,
        offset
      ],
      sql: `SELECT generation_sha256, record_key, record_sha256, ordinal, input_sha256
        FROM oh_semantic_memberships
        WHERE authority_id = ? AND generation = ?
        ORDER BY record_key, ordinal LIMIT ? OFFSET ?`
    });
    for (const row of result.rows) {
      const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 0));
      const recordKey2 = safeCode(rowValue(row, "record_key", 1), 512);
      const recordSha256 = parseSha256Hex(rowValue(row, "record_sha256", 2));
      const ordinal = integer(rowValue(row, "ordinal", 3));
      const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 4));
      if (generationSha256 !== generation.generationSha256 || recordKey2 === null || recordSha256 === null || ordinal === null || ordinal < 0 || ordinal >= OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerDocument || inputSha256 === null) {
        throw new OhLibSqlSemanticError("integrity", "A semantic generation membership is invalid.");
      }
      memberships.push(Object.freeze({ inputSha256, ordinal, recordKey: recordKey2, recordSha256 }));
    }
  }
  if (memberships.length !== generation.chunkCount || canonicalSha256(memberships.map((membership) => ({
    inputSha256: membership.inputSha256,
    ordinal: membership.ordinal,
    recordKey: membership.recordKey,
    recordSha256: membership.recordSha256
  }))) !== generation.membershipSha256) {
    throw new OhLibSqlSemanticError("integrity", "A semantic generation membership digest is invalid.");
  }
  return Object.freeze(memberships);
}
async function readVectors(client, inputSha256s) {
  const vectors = new Map;
  for (let offset = 0;offset < inputSha256s.length; offset += 64) {
    const page = inputSha256s.slice(offset, offset + 64);
    if (page.length === 0)
      continue;
    const placeholders = page.map(() => "?").join(", ");
    const result = await client.execute({
      args: [
        OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
        OH_SEMANTIC_RENDERER_V1.rendererSha256,
        ...page
      ],
      sql: `SELECT input_sha256, vector_sha256, vector FROM oh_semantic_vectors
        WHERE profile_sha256 = ? AND renderer_sha256 = ?
          AND input_sha256 IN (${placeholders}) ORDER BY input_sha256`
    });
    for (const row of result.rows) {
      const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 0));
      const vectorSha256 = parseSha256Hex(rowValue(row, "vector_sha256", 1));
      if (inputSha256 === null || vectorSha256 === null || !page.includes(inputSha256) || vectors.has(inputSha256)) {
        throw new OhLibSqlSemanticError("integrity", "A cached semantic vector identity is invalid.");
      }
      const bytes = storedBytes(rowValue(row, "vector", 2));
      if (bytes === null) {
        throw new OhLibSqlSemanticError("integrity", "A cached semantic vector is corrupt.");
      }
      decodeVector(bytes, vectorSha256);
      vectors.set(inputSha256, Object.freeze({
        bytes,
        inputSha256,
        vectorSha256
      }));
    }
  }
  return vectors;
}
function validateEmbeddingClient(client) {
  if (client.profile.profileSha256 !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256) {
    throw new OhLibSqlSemanticError("invalid-input", "The embedding client profile is incompatible.");
  }
}

class OhLibSqlSemanticCacheV1 {
  #client;
  #closeClient;
  #closed = false;
  constructor(client, closeClient) {
    this.#client = client;
    this.#closeClient = closeClient;
  }
  static async open(client, closeClient) {
    await verifySchema(client);
    return new OhLibSqlSemanticCacheV1(client, closeClient);
  }
  #open() {
    if (this.#closed)
      throw new OhLibSqlSemanticError("schema-unavailable", "The semantic cache is closed.");
  }
  async close() {
    if (this.#closed)
      return;
    this.#closed = true;
    if (this.#closeClient)
      this.#client.close?.();
  }
  async publishedHead(input) {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    if (await readPurge(this.#client, authorityId) !== null)
      return null;
    const head = await readHead(this.#client, authorityId);
    if (head === null)
      return null;
    const generation = await readGeneration(this.#client, authorityId, head.generation);
    if (generation === null || !headMatchesGeneration(head, generation)) {
      if (await readPurge(this.#client, authorityId) !== null)
        return null;
      throw new OhLibSqlSemanticError("integrity", "The semantic published head does not match its immutable generation.");
    }
    if (await readPurge(this.#client, authorityId) !== null)
      return null;
    const finalHead = await readHead(this.#client, authorityId);
    if (finalHead === null) {
      if (await readPurge(this.#client, authorityId) !== null)
        return null;
      throw new OhLibSqlSemanticError("integrity", "The semantic published head disappeared during its read.");
    }
    if (canonicalJson(finalHead) !== canonicalJson(head)) {
      throw new OhLibSqlSemanticError("conflict", "The semantic published head changed during its read.");
    }
    return Object.freeze({ ...head, v: 1 });
  }
  async stage(input) {
    this.#open();
    validateEmbeddingClient(input.embeddingClient);
    const prepared = prepareGeneration(input);
    if (await readPurge(this.#client, prepared.authorityId) !== null) {
      throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
    }
    const uniqueInputs = new Map;
    for (const membership of prepared.memberships)
      uniqueInputs.set(membership.inputSha256, membership.input);
    const orderedInputs = [...uniqueInputs.entries()].sort(([left], [right]) => left < right ? -1 : 1);
    const existingVectors = await readVectors(this.#client, orderedInputs.map(([digest]) => digest));
    const missing = orderedInputs.filter(([digest]) => !existingVectors.has(digest));
    const candidateVectors = new Map(existingVectors);
    for (let offset = 0;offset < missing.length; offset += OH_LIBSQL_SEMANTIC_LIMITS_V1.embeddingBatch) {
      const page = missing.slice(offset, offset + OH_LIBSQL_SEMANTIC_LIMITS_V1.embeddingBatch);
      const vectors = await input.embeddingClient.embed(page.map(([, rendered]) => rendered), input.signal === undefined ? {} : { signal: input.signal });
      if (vectors.length !== page.length) {
        throw new OhLibSqlSemanticError("integrity", "The embedding client returned a mismatched vector batch.");
      }
      for (const [index, [inputSha256]] of page.entries()) {
        const vector = vectors[index];
        if (vector === undefined)
          throw new OhLibSqlSemanticError("integrity", "A semantic vector is missing.");
        const bytes = vectorBytes(vector);
        const vectorSha256 = sha256Hex(bytes);
        decodeVector(bytes, vectorSha256);
        candidateVectors.set(inputSha256, Object.freeze({ bytes, inputSha256, vectorSha256 }));
      }
    }
    const statements = [{
      args: [
        prepared.authorityId,
        prepared.generation,
        prepared.authoritySha256,
        OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
        OH_SEMANTIC_RENDERER_V1.rendererSha256,
        prepared.membershipSha256,
        prepared.generationSha256,
        prepared.documentCount,
        prepared.chunkCount,
        prepared.createdAt,
        prepared.authorityId
      ],
      sql: `INSERT INTO oh_semantic_generations(authority_id, generation,
        authority_sha256, profile_sha256, renderer_sha256, membership_sha256,
        generation_sha256, document_count, chunk_count, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
        ON CONFLICT DO NOTHING`
    }];
    for (const [inputSha256] of orderedInputs) {
      const candidate = candidateVectors.get(inputSha256);
      if (candidate === undefined) {
        throw new OhLibSqlSemanticError("integrity", "A semantic vector candidate is missing.");
      }
      statements.push({
        args: [
          OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
          OH_SEMANTIC_RENDERER_V1.rendererSha256,
          inputSha256,
          candidate.vectorSha256,
          candidate.bytes,
          prepared.createdAt,
          prepared.authorityId,
          prepared.generation,
          prepared.generationSha256,
          prepared.authorityId
        ],
        sql: `INSERT INTO oh_semantic_vectors(profile_sha256, renderer_sha256,
          input_sha256, vector_sha256, vector, created_at)
          SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM oh_semantic_generations
            WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
          ON CONFLICT DO NOTHING`
      });
    }
    for (const membership of prepared.memberships) {
      statements.push({
        args: [
          prepared.authorityId,
          prepared.generation,
          prepared.generationSha256,
          membership.recordKey,
          membership.recordSha256,
          membership.ordinal,
          membership.inputSha256,
          prepared.authorityId,
          prepared.generation,
          prepared.generationSha256,
          prepared.authorityId
        ],
        sql: `INSERT INTO oh_semantic_memberships(authority_id, generation,
          generation_sha256, record_key, record_sha256, ordinal, input_sha256)
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM oh_semantic_generations
            WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
          ON CONFLICT DO NOTHING`
      });
    }
    await this.#client.batch(statements, "write");
    const completeVectors = await readVectors(this.#client, orderedInputs.map(([digest]) => digest));
    if (completeVectors.size !== orderedInputs.length) {
      if (await readPurge(this.#client, prepared.authorityId) !== null) {
        throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
      }
      throw new OhLibSqlSemanticError("integrity", "The semantic vector cache did not converge.");
    }
    const stored = await readGeneration(this.#client, prepared.authorityId, prepared.generation);
    if (await readPurge(this.#client, prepared.authorityId) !== null) {
      throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
    }
    if (stored === null || !generationMatches(stored, prepared)) {
      throw new OhLibSqlSemanticError("conflict", "The semantic generation identity conflicts.");
    }
    const memberships = await readMemberships(this.#client, stored);
    if (canonicalJson(memberships) !== canonicalJson(prepared.memberships.map((membership) => ({
      inputSha256: membership.inputSha256,
      ordinal: membership.ordinal,
      recordKey: membership.recordKey,
      recordSha256: membership.recordSha256
    })))) {
      throw new OhLibSqlSemanticError("conflict", "The semantic generation membership conflicts.");
    }
    return Object.freeze({
      authorityId: prepared.authorityId,
      chunks: prepared.chunkCount,
      documents: prepared.documentCount,
      embedded: missing.length,
      generation: prepared.generation,
      generationSha256: prepared.generationSha256,
      membershipSha256: prepared.membershipSha256,
      reused: orderedInputs.length - missing.length,
      status: "staged",
      v: 1
    });
  }
  async publish(input) {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    const generationNumber = parseGeneration(input.generation);
    const expected = input.expectedPublishedGeneration === null ? null : parseGeneration(input.expectedPublishedGeneration);
    const publishedAt = parseInstant(input.publishedAt ?? canonicalNow());
    if (await readPurge(this.#client, authorityId) !== null) {
      throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
    }
    const generation = await readGeneration(this.#client, authorityId, generationNumber);
    if (generation === null) {
      throw new OhLibSqlSemanticError("conflict", "The semantic generation is not staged.");
    }
    await readMemberships(this.#client, generation);
    const before = await readHead(this.#client, authorityId);
    if (before !== null && headMatchesGeneration(before, generation)) {
      return Object.freeze({
        authorityId,
        generation: generationNumber,
        generationSha256: generation.generationSha256,
        published: false,
        v: 1
      });
    }
    if (before === null !== (expected === null) || before !== null && before.generation !== expected || before !== null && generationNumber < before.generation) {
      throw new OhLibSqlSemanticError("conflict", "The semantic published-head precondition failed.");
    }
    let result;
    const values = [
      generation.authorityId,
      generation.generation,
      generation.authoritySha256,
      generation.profileSha256,
      generation.rendererSha256,
      generation.membershipSha256,
      generation.generationSha256,
      publishedAt
    ];
    if (expected === null) {
      result = await this.#client.execute({
        args: [
          ...values,
          generation.authorityId,
          generation.generation,
          generation.generationSha256,
          authorityId,
          authorityId
        ],
        sql: `INSERT INTO oh_semantic_heads(authority_id, generation,
          authority_sha256, profile_sha256, renderer_sha256, membership_sha256,
          generation_sha256, published_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM oh_semantic_generations
            WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_heads WHERE authority_id = ?)
          ON CONFLICT DO NOTHING`
      });
    } else {
      result = await this.#client.execute({
        args: [
          generation.generation,
          generation.authoritySha256,
          generation.profileSha256,
          generation.rendererSha256,
          generation.membershipSha256,
          generation.generationSha256,
          publishedAt,
          authorityId,
          expected,
          generation.authorityId,
          generation.generation,
          generation.generationSha256,
          authorityId
        ],
        sql: `UPDATE oh_semantic_heads SET generation = ?, authority_sha256 = ?,
          profile_sha256 = ?, renderer_sha256 = ?, membership_sha256 = ?,
          generation_sha256 = ?, published_at = ?
          WHERE authority_id = ? AND generation = ?
            AND EXISTS (SELECT 1 FROM oh_semantic_generations
              WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)`
      });
    }
    if (await readPurge(this.#client, authorityId) !== null) {
      throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
    }
    const after = await readHead(this.#client, authorityId);
    if (after === null || !headMatchesGeneration(after, generation)) {
      throw new OhLibSqlSemanticError("conflict", "The semantic published head did not converge.");
    }
    return Object.freeze({
      authorityId,
      generation: generationNumber,
      generationSha256: generation.generationSha256,
      published: rowsAffected(result) > 0,
      v: 1
    });
  }
  async search(input) {
    this.#open();
    validateEmbeddingClient(input.embeddingClient);
    const authorityId = parseAuthorityId(input.authority.authorityId);
    const authoritySha256 = parseDigest(input.authority.authoritySha256, "authority");
    const authorityGeneration = parseGeneration(input.authority.generation);
    const limit = input.limit ?? 10;
    if (input.authority.v !== 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > OH_LIBSQL_SEMANTIC_LIMITS_V1.searchLimit || !Array.isArray(input.authority.records) || input.authority.records.length > OH_LIBSQL_SEMANTIC_LIMITS_V1.documentsPerGeneration) {
      throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic search authority or limit.");
    }
    const records = new Map;
    for (const record of input.authority.records) {
      const key = parseRecordKey(record.key);
      const recordSha256 = parseDigest(record.recordSha256, "record");
      if (records.has(key))
        throw new OhLibSqlSemanticError("invalid-input", "Duplicate authority record key.");
      records.set(key, recordSha256);
    }
    if (await readPurge(this.#client, authorityId) !== null)
      return Object.freeze([]);
    const head = await readHead(this.#client, authorityId);
    if (head === null || head.authoritySha256 !== authoritySha256 || head.generation !== authorityGeneration || head.profileSha256 !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256 || head.rendererSha256 !== OH_SEMANTIC_RENDERER_V1.rendererSha256) {
      return Object.freeze([]);
    }
    const generation = await readGeneration(this.#client, authorityId, authorityGeneration);
    if (generation === null || !headMatchesGeneration(head, generation))
      return Object.freeze([]);
    const renderedQuery = renderOhCloudflareEmbeddingQueryV1(input.query);
    const queryVectors = await input.embeddingClient.embed([renderedQuery], input.signal === undefined ? {} : { signal: input.signal });
    const queryVector = queryVectors[0];
    if (queryVectors.length !== 1 || queryVector === undefined) {
      throw new OhLibSqlSemanticError("integrity", "The query embedding response is invalid.");
    }
    const normalizedQuery = normalizeOhEmbeddingV1(queryVector);
    const best = new Map;
    let scanned = 0;
    for (let offset = 0;offset < generation.chunkCount; offset += OH_LIBSQL_SEMANTIC_LIMITS_V1.searchPage) {
      const result = await this.#client.execute({
        args: [
          OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
          OH_SEMANTIC_RENDERER_V1.rendererSha256,
          authorityId,
          authorityGeneration,
          OH_LIBSQL_SEMANTIC_LIMITS_V1.searchPage,
          offset
        ],
        sql: `SELECT membership.generation_sha256, membership.record_key,
          membership.record_sha256, membership.ordinal, membership.input_sha256,
          vector.vector_sha256, vector.vector
          FROM oh_semantic_memberships AS membership
          JOIN oh_semantic_vectors AS vector
            ON vector.input_sha256 = membership.input_sha256
            AND vector.profile_sha256 = ? AND vector.renderer_sha256 = ?
          WHERE membership.authority_id = ? AND membership.generation = ?
          ORDER BY membership.record_key, membership.ordinal LIMIT ? OFFSET ?`
      });
      for (const row of result.rows) {
        scanned += 1;
        const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 0));
        const key = safeCode(rowValue(row, "record_key", 1), 512);
        const recordSha256 = parseSha256Hex(rowValue(row, "record_sha256", 2));
        const ordinal = integer(rowValue(row, "ordinal", 3));
        const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 4));
        const vectorSha256 = parseSha256Hex(rowValue(row, "vector_sha256", 5));
        if (generationSha256 !== generation.generationSha256 || key === null || recordSha256 === null || ordinal === null || ordinal < 0 || ordinal >= OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerDocument || inputSha256 === null || vectorSha256 === null) {
          throw new OhLibSqlSemanticError("integrity", "A semantic search row is invalid.");
        }
        if (records.get(key) !== recordSha256)
          continue;
        const vector = decodeVector(rowValue(row, "vector", 6), vectorSha256);
        let score = 0;
        for (let index = 0;index < normalizedQuery.length; index += 1) {
          score += normalizedQuery[index] * vector[index];
        }
        score = Math.max(-1, Math.min(1, score));
        const previous = best.get(key);
        if (previous === undefined || score > previous.score || score === previous.score && ordinal < previous.chunkOrdinal) {
          best.set(key, Object.freeze({ chunkOrdinal: ordinal, key, recordSha256, score, v: 1 }));
        }
      }
    }
    if (scanned !== generation.chunkCount) {
      throw new OhLibSqlSemanticError("integrity", "The semantic search scan is incomplete.");
    }
    const finalHead = await readHead(this.#client, authorityId);
    if (finalHead === null || canonicalJson(finalHead) !== canonicalJson(head) || await readPurge(this.#client, authorityId) !== null)
      return Object.freeze([]);
    return Object.freeze([...best.values()].sort((left, right) => right.score - left.score || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)).slice(0, limit));
  }
  async purgeAuthority(input) {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    const requestedAt = parseInstant(input.purgedAt ?? canonicalNow());
    const previous = await readPurge(this.#client, authorityId);
    const results = await this.#client.batch([
      {
        args: [authorityId, requestedAt],
        sql: `INSERT INTO oh_semantic_purges(authority_id, purged_at)
          VALUES (?, ?) ON CONFLICT DO NOTHING`
      },
      { args: [authorityId], sql: "DELETE FROM oh_semantic_heads WHERE authority_id = ?" },
      { args: [authorityId], sql: "DELETE FROM oh_semantic_memberships WHERE authority_id = ?" },
      { args: [authorityId], sql: "DELETE FROM oh_semantic_generations WHERE authority_id = ?" },
      {
        sql: `DELETE FROM oh_semantic_vectors AS vector
          WHERE NOT EXISTS (SELECT 1 FROM oh_semantic_memberships AS membership
            WHERE membership.input_sha256 = vector.input_sha256)`
      }
    ], "write");
    const purgedAt = await readPurge(this.#client, authorityId);
    if (purgedAt === null || previous !== null && purgedAt !== previous) {
      throw new OhLibSqlSemanticError("integrity", "The semantic purge did not converge.");
    }
    if (await readHead(this.#client, authorityId) !== null || (await this.#client.execute({
      args: [authorityId, authorityId],
      sql: `SELECT authority_id FROM oh_semantic_generations WHERE authority_id = ?
          UNION ALL SELECT authority_id FROM oh_semantic_memberships WHERE authority_id = ? LIMIT 1`
    })).rows.length !== 0) {
      throw new OhLibSqlSemanticError("integrity", "The semantic authority purge is incomplete.");
    }
    return Object.freeze({
      authorityId,
      generations: rowsAffected(results[3] ?? { rows: [] }),
      memberships: rowsAffected(results[2] ?? { rows: [] }),
      orphanVectors: rowsAffected(results[4] ?? { rows: [] }),
      purgedAt,
      v: 1
    });
  }
}
async function openOhLibSqlSemanticCacheV1(client, options = {}) {
  return await OhLibSqlSemanticCacheV1.open(client, options.closeClient ?? false);
}
export {
  renderOhCloudflareEmbeddingQueryV1,
  renderOhCloudflareEmbeddingDocumentV1,
  openOhLibSqlSemanticCacheV1,
  bootstrapOhLibSqlSemanticCacheV1,
  OhLibSqlSemanticError,
  OhLibSqlSemanticCacheV1,
  OhCloudflareEmbeddingError,
  OhCloudflareEmbeddingClientV1,
  OH_SEMANTIC_RENDERER_V1,
  OH_LIBSQL_SEMANTIC_LIMITS_V1,
  OH_CLOUDFLARE_EMBEDDING_PROFILE_V1,
  OH_CLOUDFLARE_EMBEDDING_LIMITS_V1
};
