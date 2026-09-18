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
import { dirname, isAbsolute, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";
var MAX_REQUEST_BYTES = 4096;
var MAX_RESPONSE_BYTES = 4096;
var SQLITE_HEADER_BYTES = 16;
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
  return process.env.HRANESS_OH_SQLITE_CLI_PATH ? resolve(process.env.HRANESS_OH_SQLITE_CLI_PATH) : resolve(base, `${platform}-${arch}`, "oh-sqlite-cli");
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
  if (!isAbsolute(sourcePath))
    throw new TypeError("sourcePath must be absolute");
  if (!isAbsolute(outputDirectory))
    throw new TypeError("outputDirectory must be absolute");
  const maxFileBytes = boundInteger(options.maxFileBytes, 16 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
  const maxTotalBytes = boundInteger(options.maxTotalBytes, 64 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
  const request = {
    sourcePath,
    outputDirectory,
    maxFileBytes,
    maxTotalBytes
  };
  return request;
}
async function runSidecar(binaryPath, requestJson) {
  const child = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  return new Promise((resolvePromise, rejectPromise) => {
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timer);
      if (error === null)
        resolvePromise(value ?? "");
      else
        rejectPromise(error);
    };
    const failProtocol = (reason) => {
      child.kill("SIGKILL");
      finish(new SnapshotProtocolError(reason, Buffer.concat(stdout).toString("utf8")));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new SnapshotTimeoutError(SPAWN_TIMEOUT_MS));
    }, SPAWN_TIMEOUT_MS);
    child.once("error", (error) => finish(error));
    child.stdin.once("error", (error) => finish(error));
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_RESPONSE_BYTES) {
        failProtocol(new Error("response exceeds maximum length"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_RESPONSE_BYTES)
        failProtocol(new Error("stderr exceeds maximum length"));
    });
    child.once("close", (code, signal) => {
      if (settled)
        return;
      const output = Buffer.concat(stdout).toString("utf8");
      if (code !== 0 || signal !== null) {
        finish(new SnapshotProtocolError(new Error(`oh-sqlite-cli exited with code ${code ?? "unknown"}`), output));
        return;
      }
      const newline = output.indexOf(`
`);
      if (newline < 0 || output.slice(newline + 1).trim().length !== 0) {
        finish(new SnapshotProtocolError(new Error("response must be exactly one JSON line"), output));
        return;
      }
      finish(null, output.slice(0, newline));
    });
    child.stdin.end(`${requestJson}
`);
  });
}
function isSnapshotError(value) {
  return typeof value === "object" && value !== null && typeof value.error === "string";
}
async function snapshotDatabase(options) {
  const request = boundedRequest(options);
  const requestJson = JSON.stringify(request);
  if (Buffer.byteLength(requestJson, "utf8") > MAX_REQUEST_BYTES) {
    throw new TypeError("snapshot request exceeds maximum length");
  }
  const { platform, arch } = currentPlatformArch();
  const binaryPath = sidecarBinaryPath(platform, arch);
  try {
    if (!(await stat(binaryPath)).isFile())
      throw new Error("sidecar is not a file");
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof Error && error.message === "sidecar is not a file")) {
      throw error;
    }
    throw new SnapshotSidecarNotFoundError(platform, arch, binaryPath);
  }
  await mkdir(request.outputDirectory, { recursive: true });
  return parseSnapshotResponse(await runSidecar(binaryPath, requestJson), request);
}
function containedPath(path, outputDirectory) {
  if (!isAbsolute(path))
    return false;
  const rel = relative(resolve(outputDirectory), resolve(path));
  return rel.length > 0 && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function parseSnapshotResponse(stdout, request) {
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
  const keys = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).sort() : [];
  if (keys.join(",") !== "databasePath,journalPath,totalBytes,walPath" || typeof candidate.databasePath !== "string" || !containedPath(candidate.databasePath, request.outputDirectory) || candidate.walPath !== null && (typeof candidate.walPath !== "string" || candidate.walPath !== `${candidate.databasePath}-wal`) || candidate.journalPath !== null && (typeof candidate.journalPath !== "string" || candidate.journalPath !== `${candidate.databasePath}-journal`) || !Number.isSafeInteger(candidate.totalBytes) || candidate.totalBytes < SQLITE_HEADER_BYTES || candidate.totalBytes > request.maxTotalBytes) {
    throw new SnapshotProtocolError(new Error("invalid snapshot fields"), stdout);
  }
  return Object.freeze({
    databasePath: candidate.databasePath,
    walPath: candidate.walPath,
    journalPath: candidate.journalPath,
    totalBytes: candidate.totalBytes
  });
}
function snapshotDatabaseSync(options) {
  const request = boundedRequest(options);
  const requestJson = JSON.stringify(request);
  if (Buffer.byteLength(requestJson, "utf8") > MAX_REQUEST_BYTES) {
    throw new TypeError("snapshot request exceeds maximum length");
  }
  const { platform, arch } = currentPlatformArch();
  const binaryPath = sidecarBinaryPath(platform, arch);
  try {
    if (!statSync(binaryPath).isFile())
      throw new Error("sidecar is not a file");
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof Error && error.message === "sidecar is not a file")) {
      throw error;
    }
    throw new SnapshotSidecarNotFoundError(platform, arch, binaryPath);
  }
  mkdirSync(request.outputDirectory, { recursive: true });
  const result = spawnSync(binaryPath, [], {
    input: `${requestJson}
`,
    timeout: SPAWN_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: MAX_RESPONSE_BYTES
  });
  if (result.error !== undefined && result.error !== null) {
    if (result.error.code === "ETIMEDOUT") {
      throw new SnapshotTimeoutError(SPAWN_TIMEOUT_MS);
    }
    throw new SnapshotProtocolError(result.error, result.stdout ?? "");
  }
  if (result.status !== 0) {
    throw new SnapshotProtocolError(new Error(`oh-sqlite-cli exited with code ${result.status ?? "unknown"}`), result.stdout ?? "");
  }
  const stdout = result.stdout ?? "";
  const newline = stdout.indexOf(`
`);
  if (newline < 0 || stdout.slice(newline + 1).trim().length !== 0) {
    throw new SnapshotProtocolError(new Error("response must be exactly one JSON line"), stdout);
  }
  return parseSnapshotResponse(stdout.slice(0, newline), request);
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
