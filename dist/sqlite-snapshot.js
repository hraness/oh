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

// src/sqlite-snapshot.ts
import { spawn, spawnSync } from "child_process";
import { mkdirSync, statSync } from "fs";
import { mkdir, stat } from "fs/promises";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
var MAX_REQUEST_BYTES = 4096;
var MAX_RESPONSE_BYTES = 4096;
var SPAWN_TIMEOUT_MS = 120000;

class SnapshotSidecarNotFoundError extends Error {
  platform;
  arch;
  binaryPath;
  name;
  constructor(platform, arch, binaryPath) {
    super(`oh-sqlite-cli sidecar not found for ${platform}-${arch} at ${binaryPath}`);
    this.platform = platform;
    this.arch = arch;
    this.binaryPath = binaryPath;
    this.name = "SnapshotSidecarNotFoundError";
  }
}

class SnapshotTimeoutError extends Error {
  timeoutMs;
  name;
  constructor(timeoutMs) {
    super(`oh-sqlite-cli sidecar did not respond within ${timeoutMs} ms`);
    this.timeoutMs = timeoutMs;
    this.name = "SnapshotTimeoutError";
  }
}

class SnapshotProtocolError extends Error {
  reason;
  stdout;
  name;
  constructor(reason, stdout) {
    super(`oh-sqlite-cli produced unparseable output: ${String(reason)}`);
    this.reason = reason;
    this.stdout = stdout;
    this.name = "SnapshotProtocolError";
  }
}

class SnapshotError extends Error {
  code;
  details;
  name;
  constructor(code, details) {
    super(`oh-sqlite-cli snapshot failed: ${code}`);
    this.code = code;
    this.details = details;
    this.name = "SnapshotError";
  }
}
function currentPlatformArch() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64")
    return { platform: "darwin", arch: "arm64" };
  if (platform === "darwin" && arch === "x64")
    return { platform: "darwin", arch: "x64" };
  if (platform === "linux" && arch === "x64")
    return { platform: "linux", arch: "x64" };
  throw new Error(`Unsupported platform for oh-sqlite-cli sidecar: ${platform}-${arch}`);
}
function artifactBaseDirectory() {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(modulePath);
  const base = moduleDir.endsWith("/src") || moduleDir.endsWith("\\src") ? resolve(moduleDir, "..", "dist") : moduleDir;
  return resolve(base, "rust-artifacts", "oh-sqlite");
}
function sidecarBinaryPath(platform = currentPlatformArch().platform, arch = currentPlatformArch().arch) {
  const base = process.env.HRANESS_OH_SQLITE_CLI_PATH ? dirname(process.env.HRANESS_OH_SQLITE_CLI_PATH) : artifactBaseDirectory();
  return process.env.HRANESS_OH_SQLITE_CLI_PATH ? process.env.HRANESS_OH_SQLITE_CLI_PATH : resolve(base, `${platform}-${arch}`, "oh-sqlite-cli");
}
function boundInteger(value, fallback, maximum) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new TypeError(`byte limit must be an integer from 1 through ${maximum}`);
  }
  return result;
}
function boundedRequest(options) {
  const sourcePath = typeof options.sourcePath === "string" ? options.sourcePath : "";
  const outputDirectory = typeof options.outputDirectory === "string" ? options.outputDirectory : "";
  if (sourcePath.length === 0)
    throw new TypeError("sourcePath is required");
  if (outputDirectory.length === 0)
    throw new TypeError("outputDirectory is required");
  const request = {
    sourcePath,
    outputDirectory,
    maxFileBytes: boundInteger(options.maxFileBytes, 16 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER),
    maxTotalBytes: boundInteger(options.maxTotalBytes, 64 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER)
  };
  return request;
}
async function readLine(stream) {
  if (stream === null)
    throw new SnapshotProtocolError(new Error("stdout is not available"), "");
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > MAX_RESPONSE_BYTES) {
      throw new SnapshotProtocolError(new Error("response exceeds maximum length"), "");
    }
    chunks.push(chunk);
    if (chunk.includes(`
`))
      break;
  }
  const combined = Buffer.concat(chunks);
  const newline = combined.indexOf(`
`);
  const line = combined.subarray(0, newline >= 0 ? newline : combined.length).toString("utf8");
  return line;
}
function isSnapshotError(value) {
  return typeof value === "object" && value !== null && typeof value.error === "string";
}
async function snapshotDatabase(options) {
  const { platform, arch } = currentPlatformArch();
  const binaryPath = sidecarBinaryPath(platform, arch);
  try {
    await stat(binaryPath);
  } catch {
    throw new SnapshotSidecarNotFoundError(platform, arch, binaryPath);
  }
  await mkdir(options.outputDirectory, { recursive: true });
  const request = boundedRequest(options);
  const requestJson = JSON.stringify(request);
  if (Buffer.byteLength(requestJson, "utf8") > MAX_REQUEST_BYTES) {
    throw new TypeError("snapshot request exceeds maximum length");
  }
  const child = spawn(binaryPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: SPAWN_TIMEOUT_MS
  });
  child.stdin.write(requestJson);
  child.stdin.write(`
`);
  child.stdin.end();
  const stdout = await Promise.race([
    readLine(child.stdout),
    new Promise((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code !== 0)
          reject(new Error(`oh-sqlite-cli exited with code ${code}`));
      });
      setTimeout(() => reject(new SnapshotTimeoutError(SPAWN_TIMEOUT_MS)), SPAWN_TIMEOUT_MS);
    })
  ]);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new SnapshotProtocolError(error, stdout);
  }
  if (isSnapshotError(parsed)) {
    throw new SnapshotError(parsed.error, parsed);
  }
  const candidate = parsed;
  if (typeof candidate.databasePath !== "string" || candidate.walPath !== null && typeof candidate.walPath !== "string" || candidate.journalPath !== null && typeof candidate.journalPath !== "string" || typeof candidate.totalBytes !== "number") {
    throw new SnapshotProtocolError(new Error("missing snapshot fields"), stdout);
  }
  return Object.freeze({
    databasePath: candidate.databasePath,
    walPath: candidate.walPath ?? null,
    journalPath: candidate.journalPath ?? null,
    totalBytes: candidate.totalBytes
  });
}
function parseSnapshotResponse(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new SnapshotProtocolError(error, stdout);
  }
  if (isSnapshotError(parsed)) {
    throw new SnapshotError(parsed.error, parsed);
  }
  const candidate = parsed;
  if (typeof candidate.databasePath !== "string" || candidate.walPath !== null && typeof candidate.walPath !== "string" || candidate.journalPath !== null && typeof candidate.journalPath !== "string" || typeof candidate.totalBytes !== "number") {
    throw new SnapshotProtocolError(new Error("missing snapshot fields"), stdout);
  }
  return Object.freeze({
    databasePath: candidate.databasePath,
    walPath: candidate.walPath ?? null,
    journalPath: candidate.journalPath ?? null,
    totalBytes: candidate.totalBytes
  });
}
function snapshotDatabaseSync(options) {
  const { platform, arch } = currentPlatformArch();
  const binaryPath = sidecarBinaryPath(platform, arch);
  try {
    statSync(binaryPath);
  } catch {
    throw new SnapshotSidecarNotFoundError(platform, arch, binaryPath);
  }
  mkdirSync(options.outputDirectory, { recursive: true });
  const request = boundedRequest(options);
  const requestJson = JSON.stringify(request);
  if (Buffer.byteLength(requestJson, "utf8") > MAX_REQUEST_BYTES) {
    throw new TypeError("snapshot request exceeds maximum length");
  }
  const result = spawnSync(binaryPath, [], {
    input: `${requestJson}
`,
    timeout: SPAWN_TIMEOUT_MS,
    encoding: "utf8"
  });
  if (result.error !== undefined && result.error !== null) {
    throw new SnapshotProtocolError(result.error, result.stdout ?? "");
  }
  if (result.status !== 0) {
    throw new SnapshotProtocolError(new Error(`oh-sqlite-cli exited with code ${result.status ?? "unknown"}`), result.stdout ?? "");
  }
  const stdout = result.stdout ?? "";
  const newline = stdout.indexOf(`
`);
  const line = newline >= 0 ? stdout.slice(0, newline) : stdout;
  return parseSnapshotResponse(line);
}
export {
  snapshotDatabaseSync,
  snapshotDatabase,
  sidecarBinaryPath,
  SnapshotTimeoutError,
  SnapshotSidecarNotFoundError,
  SnapshotProtocolError,
  SnapshotError
};
