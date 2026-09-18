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

// src/artifact-manifest.ts
import { readFile } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";
var IDENTITY = /^[a-z0-9][a-z0-9._-]{0,126}$/u;
var SHA256_HEX = /^[0-9a-f]{64}$/u;
var RELATIVE_FILE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;
var MAX_ARTIFACTS = 64;
var MAX_FILES = 32;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function boundedString(value, pattern) {
  return typeof value === "string" && pattern.test(value) ? value : null;
}
function parseFiles(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES)
    return null;
  const files = [];
  for (const item of value) {
    const file = boundedString(item, RELATIVE_FILE);
    if (file === null || file.includes("..") || isAbsolute(file))
      return null;
    files.push(file);
  }
  return files;
}
function parseEntry(value) {
  if (!isRecord(value))
    return null;
  const engine = boundedString(value.engine, IDENTITY);
  const abi = boundedString(value.abi, IDENTITY);
  const crate = boundedString(value.crate, IDENTITY);
  const kind = value.kind;
  const target = boundedString(value.target, IDENTITY);
  const files = parseFiles(value.files);
  const primary = boundedString(value.primary, RELATIVE_FILE);
  const sha256 = boundedString(value.sha256, SHA256_HEX);
  const bytes = value.bytes;
  const maxInputBytes = value.maxInputBytes;
  if (engine === null || abi === null || crate === null || target === null || files === null || primary === null || sha256 === null || kind !== "wasm-pack" && kind !== "cargo-wasm" && kind !== "cargo-native" || !files.includes(primary) || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1 || !(maxInputBytes === null || typeof maxInputBytes === "number" && Number.isSafeInteger(maxInputBytes) && maxInputBytes >= 1))
    return null;
  return Object.freeze({
    engine,
    abi,
    crate,
    kind,
    target,
    files,
    primary,
    sha256,
    bytes,
    maxInputBytes
  });
}
function parseOhRustArtifactManifest(value) {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.artifacts))
    return null;
  if (value.artifacts.length < 1 || value.artifacts.length > MAX_ARTIFACTS)
    return null;
  const artifacts = [];
  const identities = new Set;
  for (const item of value.artifacts) {
    const entry = parseEntry(item);
    if (entry === null)
      return null;
    const identity = `${entry.abi}\x00${entry.target}\x00${entry.primary}`;
    if (identities.has(identity))
      return null;
    identities.add(identity);
    artifacts.push(entry);
  }
  return Object.freeze({ version: 1, artifacts: Object.freeze(artifacts) });
}
function manifestPath() {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(modulePath);
  const base = moduleDir.endsWith("/src") || moduleDir.endsWith("\\src") ? resolve(moduleDir, "..", "dist") : moduleDir;
  return resolve(base, "rust-artifacts", "manifest.json");
}
async function loadOhRustArtifactManifest() {
  try {
    const text = await readFile(manifestPath(), "utf8");
    if (text.length > 1048576)
      return null;
    return parseOhRustArtifactManifest(JSON.parse(text));
  } catch {
    return null;
  }
}
function findOhRustArtifact(manifest, abi, target) {
  for (const entry of manifest.artifacts) {
    if (entry.abi === abi && (target === undefined || entry.target === target))
      return entry;
  }
  return null;
}
export {
  parseOhRustArtifactManifest,
  loadOhRustArtifactManifest,
  findOhRustArtifact
};
