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

// src/canonical-rust.ts
function decodeString(value) {
  if (typeof value !== "string")
    throw new TypeError("canonical_json must return a string");
  return value;
}
async function tryLoadWasm(moduleUrl, wasmUrl) {
  try {
    const wasm = await import(moduleUrl.href);
    const buffer = await Bun.file(wasmUrl).arrayBuffer();
    wasm.initSync({ module: buffer });
    return wasm;
  } catch {
    return null;
  }
}
async function loadWasmModule() {
  return await tryLoadWasm(new URL("../rust-artifacts/oh-canonical-wasm/oh_canonical_wasm.js", import.meta.url), new URL("../rust-artifacts/oh-canonical-wasm/oh_canonical_wasm_bg.wasm", import.meta.url)) ?? await tryLoadWasm(new URL("../rust/oh-canonical-wasm/pkg/oh_canonical_wasm.js", import.meta.url), new URL("../rust/oh-canonical-wasm/pkg/oh_canonical_wasm_bg.wasm", import.meta.url));
}
async function loadCanonicalRustTextEngine() {
  const wasm = await loadWasmModule();
  if (wasm === null) {
    return {
      canonicalJson: (text) => canonicalJson(JSON.parse(text)),
      canonicalSha256: (text) => canonicalSha256(JSON.parse(text)),
      implementation: "typescript"
    };
  }
  return {
    canonicalJson: (text) => decodeString(wasm.canonical_json(text)),
    canonicalSha256: (text) => decodeString(wasm.canonical_sha256(text)),
    implementation: "rust-wasm"
  };
}
export {
  loadCanonicalRustTextEngine
};
