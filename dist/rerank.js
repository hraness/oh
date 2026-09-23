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
import { createRequire } from "module";
import { join } from "path";

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
function parseOhRerankDocumentsV1(documents) {
  if (!Array.isArray(documents) || documents.length > OH_RERANK_LIMITS_V1.maximumDocuments) {
    throw new TypeError("Rerank accepts at most 128 documents.");
  }
  const seen = new Set;
  return documents.map((document) => {
    if (!isPlainRecord(document) || typeof document.key !== "string" || document.key.length === 0 || document.key.length > 512 || typeof document.text !== "string" || Buffer.byteLength(document.text) > OH_RERANK_LIMITS_V1.maximumDocumentBytes || !seen.add(document.key))
      throw new TypeError("Rerank document identity or byte bound failed.");
    return { key: document.key, text: document.text, v: 1 };
  });
}
function parseOhRerankResultsV1(results, keys) {
  if (!Array.isArray(results) || results.length !== keys.size)
    throw new TypeError("Rerank must score every submitted document once.");
  const seen = new Set;
  return results.map((result) => {
    if (!isPlainRecord(result) || typeof result.key !== "string" || !keys.has(result.key) || typeof result.score !== "number" || !Number.isFinite(result.score) || !seen.add(result.key)) {
      throw new TypeError("Rerank result coverage or score bound failed.");
    }
    return { key: result.key, score: result.score, v: 1 };
  });
}

// src/rerank.ts
class OhQmdRerankBackendV1 {
  profile = OH_RERANK_PROFILE_V1;
  #options;
  #engine;
  #closed = false;
  #pending = Promise.resolve();
  constructor(options) {
    if (typeof options.modelPath !== "string" || options.modelPath.length === 0 || options.modelPath.length > 4096 || options.modelPath.includes("\x00"))
      throw new TypeError("The rerank model path must be a bounded local path.");
    if (options.modelCacheDir !== undefined && (typeof options.modelCacheDir !== "string" || options.modelCacheDir.length === 0 || options.modelCacheDir.length > 4096 || options.modelCacheDir.includes("\x00")))
      throw new TypeError("The rerank model cache directory must be a bounded local path.");
    this.#options = options;
  }
  async#load() {
    if (this.#engine !== undefined)
      return this.#engine;
    let module;
    try {
      const require2 = createRequire(import.meta.url);
      const packageJson = require2.resolve("@tobilu/qmd/package.json");
      module = await import(join(packageJson, "..", "dist", "llm.js"));
    } catch {
      throw new Error("Reranking needs the optional @tobilu/qmd@2.5.3 package.");
    }
    const LlamaCpp = module.LlamaCpp;
    if (typeof LlamaCpp !== "function")
      throw new Error("The installed QMD package has no compatible LlamaCpp export.");
    const engine = new LlamaCpp({
      inactivityTimeoutMs: 0,
      modelCacheDir: this.#options.modelCacheDir,
      rerankModel: this.#options.modelPath
    });
    await engine.ensureLlama(false);
    const contexts = await engine.ensureRerankContexts();
    if (contexts.length < 1 || contexts[0]._llamaContext.contextSize !== OH_RERANK_PROFILE_V1.contextSize) {
      await engine.dispose().catch(() => {});
      throw new Error(`The rerank engine context size is not ${OH_RERANK_PROFILE_V1.contextSize}.`);
    }
    this.#engine = engine;
    return engine;
  }
  rerank(query, documents) {
    if (this.#closed)
      return Promise.reject(new Error("The rerank backend is closed."));
    const parsedQuery = parseOhRerankQueryV1(query);
    const parsedDocuments = parseOhRerankDocumentsV1(documents);
    if (parsedDocuments.length === 0)
      return Promise.resolve([]);
    const operation = this.#pending.then(async () => {
      const engine = await this.#load();
      const raw = await engine.rerank(parsedQuery, parsedDocuments.map((document) => ({ file: document.key, text: document.text })));
      const results = raw.results;
      if (!Array.isArray(results))
        throw new Error("The rerank engine returned an invalid result envelope.");
      const keys = new Set(parsedDocuments.map((document) => document.key));
      const scored = results.map((value) => {
        if (value === null || typeof value !== "object")
          throw new TypeError("The rerank engine returned an invalid score row.");
        const row = value;
        const key = typeof row.file === "string" ? row.file : typeof row.key === "string" ? row.key : undefined;
        const score = typeof row.score === "number" ? row.score : Number.NaN;
        return { key, score, v: 1 };
      });
      const parsed = parseOhRerankResultsV1(scored.map((row) => ({ key: row.key ?? "", score: row.score, v: 1 })), keys);
      return [...parsed].sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
    });
    this.#pending = operation.catch(() => {});
    return operation;
  }
  async close() {
    if (this.#closed)
      return;
    this.#closed = true;
    await this.#pending.catch(() => {});
    if (this.#engine !== undefined)
      await this.#engine.dispose();
  }
}
export {
  normalizeOhRerankLexicalQueryV1,
  OhQmdRerankBackendV1,
  OH_RERANK_STOPWORDS_V1,
  OH_RERANK_PROFILE_V1,
  OH_RERANK_LIMITS_V1
};
