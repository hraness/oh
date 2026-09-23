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

// src/rerank.ts
import { createHash as createHash2 } from "crypto";
import { open, realpath, stat } from "fs/promises";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

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
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function canonicalSha256(value) {
  return sha256Hex(canonicalJson(value));
}
function parseSha256Hex(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : null;
}
function safeCode(value, maximumLength = 128) {
  return typeof value === "string" && value.length <= maximumLength && /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(value) ? value : null;
}
function orderedUnique(values, key) {
  return values.every((value, index) => index === 0 || key(values[index - 1]) < key(value));
}

// src/rerank-model.ts
var OH_RERANK_PROFILE_V1 = Object.freeze({
  contextSize: 4096,
  engine: "@tobilu/qmd@2.5.3 LlamaCpp.rerank",
  language: "en",
  lexicalQuery: "normalized original query stem",
  model: "Qwen3-Reranker-0.6B Q8_0 GGUF",
  modelSha256: "22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48",
  modelRevision: "a02f48bb4f057028298c21fa033da2b30d7742d5",
  normalization: "NFC; en-US lowercase; token regex; first-occurrence deduplication; fixed stopword removal; first16",
  ranking: "score descending, then ASCII key ascending",
  semanticQuery: "unchanged original query stem",
  v: 1
});
var OH_RERANK_LIMITS_V1 = Object.freeze({
  defaultPoolSize: 30,
  maximumDocumentBytes: 65536,
  maximumDocuments: 128,
  maximumPoolSize: 60,
  maximumQueryBytes: 16384,
  minimumPoolSize: 1
});
var OH_RERANK_STOPWORDS_V1 = Object.freeze("a an and are as at be been being but by can could did do does doing for from had has have having he her hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves s t ve ll re d m don isn aren wasn weren".split(" "));
var stopwordSet = new Set(OH_RERANK_STOPWORDS_V1);
function normalizeOhRerankLexicalQueryV1(query) {
  if (typeof query !== "string" || Buffer.byteLength(query) > OH_RERANK_LIMITS_V1.maximumQueryBytes || /\p{Surrogate}/u.test(query) || query.includes("\x00")) {
    throw new TypeError("Rerank lexical query must be a bounded string.");
  }
  return [...new Set(query.normalize("NFC").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}/gu) ?? [])].filter((token) => !stopwordSet.has(token)).slice(0, 16).join(" ");
}
function parseOhRerankQueryV1(query) {
  if (typeof query !== "string" || Buffer.byteLength(query) > OH_RERANK_LIMITS_V1.maximumQueryBytes || /\p{Surrogate}/u.test(query) || query.includes("\x00") || query.trim().length === 0) {
    throw new TypeError("Rerank query must be a bounded nonempty string.");
  }
  return query;
}
function validText(value, maximumBytes) {
  return typeof value === "string" && Buffer.byteLength(value) <= maximumBytes && !/\p{Surrogate}/u.test(value) && !value.includes("\x00");
}
function parseOhRerankDocumentsV1(documents) {
  if (!Array.isArray(documents) || documents.length > OH_RERANK_LIMITS_V1.maximumDocuments) {
    throw new TypeError("Rerank accepts at most 128 documents.");
  }
  const seen = new Set;
  const parsed = [];
  for (const document of documents) {
    if (!isPlainRecord(document) || !hasExactKeys(document, ["key", "text", "v"]) || document.v !== 1 || !validText(document.key, 512) || document.key.length === 0 || !validText(document.text, OH_RERANK_LIMITS_V1.maximumDocumentBytes) || seen.has(document.key))
      throw new TypeError("Rerank document identity or byte bound failed.");
    seen.add(document.key);
    parsed.push({ key: document.key, text: document.text, v: 1 });
  }
  return parsed;
}
function parseOhRerankResultsV1(results, keys) {
  if (!Array.isArray(results) || results.length > OH_RERANK_LIMITS_V1.maximumDocuments || results.length !== keys.size)
    throw new TypeError("Rerank must score every submitted document once.");
  const seen = new Set;
  const parsed = [];
  for (const result of results) {
    if (!isPlainRecord(result) || !hasExactKeys(result, ["key", "score", "v"]) || result.v !== 1 || !validText(result.key, 512) || !keys.has(result.key) || typeof result.score !== "number" || !Number.isFinite(result.score) || seen.has(result.key)) {
      throw new TypeError("Rerank result coverage or score bound failed.");
    }
    seen.add(result.key);
    parsed.push({ key: result.key, score: result.score, v: 1 });
  }
  return parsed;
}

// src/rerank.ts
var TEMPLATE_OVERHEAD = 512;
var MAXIMUM_MODEL_BYTES = 1073741824;
var qmdModuleSpecifier = "@tobilu/qmd";
function localPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > 4096 || value.includes("\x00") || /\p{Surrogate}/u.test(value) || !isAbsolute(value) && /^[a-z][a-z\d+.-]*:/iu.test(value)) {
    throw new TypeError("The rerank " + label + " must be a bounded local path.");
  }
  return resolve(value);
}
function fileIdentity(value) {
  return [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(":");
}
async function verifyModel(path) {
  const actual = await realpath(path), target = await stat(actual);
  if (!target.isFile() || target.size < 1 || target.size > MAXIMUM_MODEL_BYTES) {
    throw new Error("The rerank model must be a regular local file of at most 1 GiB.");
  }
  const file = await open(actual, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAXIMUM_MODEL_BYTES) {
      throw new Error("The rerank model must be a regular local file of at most 1 GiB.");
    }
    const hash = createHash2("sha256"), buffer = Buffer.alloc(65536);
    let bytes = 0;
    while (bytes <= before.size) {
      const count = (await file.read(buffer, 0, Math.min(buffer.length, before.size - bytes + 1), bytes)).bytesRead;
      if (count === 0)
        break;
      bytes += count;
      if (bytes > before.size)
        throw new Error("The rerank model changed during verification.");
      hash.update(buffer.subarray(0, count));
    }
    const identity = fileIdentity(before);
    if (bytes !== before.size || hash.digest("hex") !== OH_RERANK_PROFILE_V1.modelSha256) {
      throw new Error("The local rerank model does not match the pinned SHA-256.");
    }
    if (identity !== fileIdentity(await file.stat()) || identity !== fileIdentity(await stat(actual))) {
      throw new Error("The rerank model changed during verification.");
    }
    return { path: actual, identity };
  } finally {
    await file.close();
  }
}
async function qmdConstructor() {
  let packagePath;
  try {
    packagePath = join(dirname(fileURLToPath(import.meta.resolve(qmdModuleSpecifier))), "..", "package.json");
  } catch {
    throw new Error("Reranking needs the optional @tobilu/qmd@2.5.3 package.");
  }
  const file = await open(packagePath, "r");
  let metadata;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 65536)
      throw new Error("The QMD package metadata exceeds its byte bound.");
    const buffer = Buffer.alloc(65537);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = (await file.read(buffer, bytes, buffer.length - bytes, bytes)).bytesRead;
      if (count === 0)
        break;
      bytes += count;
    }
    if (bytes > 65536)
      throw new Error("The QMD package metadata exceeds its byte bound.");
    metadata = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
  } finally {
    await file.close();
  }
  if (!isPlainRecord(metadata) || metadata.name !== "@tobilu/qmd" || metadata.version !== "2.5.3") {
    throw new Error("Reranking requires exactly @tobilu/qmd@2.5.3.");
  }
  const module = await import(pathToFileURL(join(dirname(packagePath), "dist", "llm.js")).href);
  const LlamaCpp = module.LlamaCpp;
  if (typeof LlamaCpp !== "function")
    throw new Error("The installed QMD package has no compatible LlamaCpp export.");
  const profile = LlamaCpp;
  if (profile.RERANK_CONTEXT_SIZE !== OH_RERANK_PROFILE_V1.contextSize || profile.RERANK_TEMPLATE_OVERHEAD !== TEMPLATE_OVERHEAD) {
    throw new Error("The QMD rerank context or template budget differs from the pinned profile.");
  }
  return LlamaCpp;
}
function tokenCount(tokens) {
  if (!Array.isArray(tokens))
    throw new Error("The rerank engine returned invalid tokenizer output.");
  return tokens.length;
}

class OhQmdRerankBackendV1 {
  profile = OH_RERANK_PROFILE_V1;
  #options;
  #engine;
  #loading;
  #release;
  #closing;
  #closed = false;
  #pending = Promise.resolve();
  constructor(options) {
    this.#options = {
      modelPath: localPath(options.modelPath, "model path"),
      ...options.modelCacheDir === undefined ? {} : { modelCacheDir: localPath(options.modelCacheDir, "model cache directory") }
    };
  }
  #dispose() {
    return this.#release ??= Promise.resolve().then(async () => {
      await this.#engine?.dispose();
    });
  }
  async#initialize() {
    const verified = await verifyModel(this.#options.modelPath);
    const LlamaCpp = await qmdConstructor();
    const engine = new LlamaCpp({
      inactivityTimeoutMs: 0,
      modelCacheDir: this.#options.modelCacheDir ?? dirname(verified.path),
      rerankModel: verified.path
    });
    this.#engine = engine;
    try {
      if (engine.rerankModelName !== verified.path)
        throw new Error("The rerank engine changed the local model path.");
      await engine.ensureLlama(false);
      const model = await engine.ensureRerankModel();
      const contexts = await engine.ensureRerankContexts();
      if (await realpath(model._modelPath) !== verified.path || fileIdentity(await stat(verified.path)) !== verified.identity) {
        throw new Error("The loaded rerank model differs from the verified local file.");
      }
      if (typeof model.tokenize !== "function" || !Array.isArray(contexts) || contexts.length < 1 || contexts.length > 4 || contexts.some((context) => context?._llamaContext?.contextSize !== OH_RERANK_PROFILE_V1.contextSize || typeof context?._getEvaluationInput !== "function")) {
        throw new Error("The rerank engine needs compatible 4096-token contexts.");
      }
      return { engine, model, contexts, modelPath: verified.path };
    } catch (error) {
      await this.#dispose();
      throw error;
    }
  }
  rerank(query, documents) {
    if (this.#closed)
      return Promise.reject(new Error("The rerank backend is closed."));
    let parsedQuery, parsedDocuments;
    try {
      parsedQuery = parseOhRerankQueryV1(query);
      parsedDocuments = parseOhRerankDocumentsV1(documents);
    } catch (error) {
      return Promise.reject(error);
    }
    if (parsedDocuments.length === 0)
      return Promise.resolve([]);
    const operation = this.#pending.then(async () => {
      const { engine, model, contexts, modelPath } = await (this.#loading ??= this.#initialize());
      const queryTokens = tokenCount(model.tokenize(parsedQuery));
      const documentBudget = OH_RERANK_PROFILE_V1.contextSize - TEMPLATE_OVERHEAD - queryTokens;
      if (documentBudget < 0)
        throw new RangeError("The complete rerank query exceeds the 4096-token context; truncation is disabled.");
      for (const document of parsedDocuments) {
        if (tokenCount(model.tokenize(document.text)) > documentBudget || contexts.some((context) => tokenCount(context._getEvaluationInput(parsedQuery, document.text)) >= OH_RERANK_PROFILE_V1.contextSize)) {
          throw new RangeError("A complete rerank query/document pair exceeds the 4096-token context; truncation is disabled.");
        }
      }
      const raw = await engine.rerank(parsedQuery, parsedDocuments.map((document) => ({ file: document.key, text: document.text })));
      if (!isPlainRecord(raw) || !hasExactKeys(raw, ["results", "model"]) || raw.model !== modelPath || !Array.isArray(raw.results) || raw.results.length !== parsedDocuments.length) {
        throw new Error("The rerank engine returned an invalid result envelope.");
      }
      const scored = [];
      for (const row of raw.results) {
        if (!isPlainRecord(row) || !hasExactKeys(row, ["file", "index", "score"]) || typeof row.file !== "string" || !Number.isSafeInteger(row.index) || parsedDocuments[row.index]?.key !== row.file || typeof row.score !== "number" || !Number.isFinite(row.score) || row.score < 0 || row.score > 1) {
          throw new TypeError("The rerank engine returned an invalid score row.");
        }
        scored.push({ key: row.file, score: row.score, v: 1 });
      }
      const parsed = parseOhRerankResultsV1(scored, new Set(parsedDocuments.map((document) => document.key)));
      return [...parsed].sort((left, right) => right.score - left.score || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
    });
    this.#pending = operation.catch(() => {});
    return operation;
  }
  close() {
    if (this.#closing !== undefined)
      return this.#closing;
    this.#closed = true;
    this.#closing = this.#pending.then(() => this.#dispose());
    return this.#closing;
  }
}
export {
  normalizeOhRerankLexicalQueryV1,
  OhQmdRerankBackendV1,
  OH_RERANK_STOPWORDS_V1,
  OH_RERANK_PROFILE_V1,
  OH_RERANK_LIMITS_V1
};
