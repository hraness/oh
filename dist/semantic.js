// @bun
// src/semantic.ts
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "fs/promises";
import { basename, join, resolve } from "path";

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
function qmdResultFilename(file) {
  if (typeof file !== "string")
    return null;
  if (file.startsWith("qmd://")) {
    let url;
    try {
      url = new URL(file);
    } catch {
      return null;
    }
    if (url.protocol !== "qmd:" || url.hostname !== "oh" || url.search !== "" || url.hash !== "")
      return null;
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
    if (!/^\/[a-f0-9]{64}\.md$/u.test(path))
      return null;
    return path.slice(1);
  }
  const filename = basename(file);
  return /^[a-f0-9]{64}\.md$/u.test(filename) ? filename : null;
}

class OhQmdSemanticBackendV1 {
  profile = OH_EMBEDDING_PROFILE_V1;
  #cacheDirectory;
  #databasePath;
  #factory;
  #manifest = { entries: {}, profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1), v: 1 };
  #manifestLoaded = false;
  #store = null;
  #closed = false;
  constructor(options) {
    this.#cacheDirectory = resolve(options.cacheDirectory);
    this.#databasePath = resolve(options.databasePath ?? join(this.#cacheDirectory, "qmd.sqlite"));
    this.#factory = options.storeFactory ?? defaultQmdStoreFactory;
  }
  async#open() {
    if (this.#closed)
      throw new Error("The semantic backend is closed.");
    const documents = join(this.#cacheDirectory, "documents");
    await mkdir(documents, { recursive: true });
    await this.#loadManifest();
    this.#store ??= this.#factory({
      dbPath: this.#databasePath,
      config: {
        collections: { oh: { path: documents, pattern: "*.md" } },
        models: { embed: OH_EMBEDDING_PROFILE_V1.model }
      }
    });
    return this.#store;
  }
  async#loadManifest() {
    if (this.#manifestLoaded)
      return;
    this.#manifestLoaded = true;
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
    this.#manifest = { entries, profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1), v: 1 };
  }
  async index(records) {
    if (records.length > 65536)
      throw new RangeError("A semantic snapshot may contain at most 65,536 records.");
    const documents = join(this.#cacheDirectory, "documents");
    await mkdir(documents, { recursive: true });
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
    this.#manifest = { entries, profileSha256: canonicalSha256(OH_EMBEDDING_PROFILE_V1), v: 1 };
    this.#manifestLoaded = true;
    const manifestPath = join(this.#cacheDirectory, "manifest.json");
    const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
    await writeFile(temporaryManifest, canonicalJson(this.#manifest), { encoding: "utf8", mode: 384 });
    await rename(temporaryManifest, manifestPath);
    const store = await this.#open();
    await store.update({ collections: ["oh"] });
    await store.embed({ collection: "oh", model: OH_EMBEDDING_PROFILE_V1.model });
    return { indexed: records.length, v: 1 };
  }
  async search(query, limit, authority) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError("Semantic limit must be 1 through 100.");
    const store = await this.#open();
    const results = await store.searchVector(query, { collection: "oh", limit: Math.min(100, limit * 3) });
    const output = [];
    const seen = new Set;
    for (const result of results) {
      const filename = qmdResultFilename(result.file);
      if (filename === null)
        continue;
      const entry = this.#manifest.entries[filename];
      if (entry === undefined || seen.has(entry.key) || !Number.isFinite(result.score) || result.score < 0 || result.score > 1)
        continue;
      const current = authority.get(entry.key);
      if (current === null || current.recordSha256 !== entry.recordSha256)
        continue;
      seen.add(entry.key);
      output.push({ key: entry.key, recordSha256: entry.recordSha256, score: result.score, v: 1 });
      if (output.length === limit)
        break;
    }
    return output;
  }
  async close() {
    if (this.#closed)
      return;
    this.#closed = true;
    if (this.#store !== null)
      await (await this.#store).close();
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
