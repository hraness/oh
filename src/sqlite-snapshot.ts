import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REQUEST_BYTES = 4096;
const MAX_RESPONSE_BYTES = 4096;
const SQLITE_HEADER_BYTES = 16;
const SPAWN_TIMEOUT_MS = 120_000;

export type SnapshotOptions = Readonly<{
  sourcePath: string;
  outputDirectory: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}>;

type SnapshotRequest = Readonly<{
  sourcePath: string;
  outputDirectory: string;
  maxFileBytes: number;
  maxTotalBytes: number;
}>;

export type Snapshot = Readonly<{
  databasePath: string;
  walPath: string | null;
  journalPath: string | null;
  totalBytes: number;
}>;

export type SnapshotErrorDetails = Readonly<{
  error: string;
  [key: string]: unknown;
}>;

export class SnapshotSidecarNotFoundError extends Error {
  override readonly name: "SnapshotSidecarNotFoundError";
  constructor(
    readonly platform: string,
    readonly arch: string,
    readonly binaryPath: string,
  ) {
    super(`oh-sqlite-cli sidecar not found for ${platform}-${arch} at ${binaryPath}`);
    this.name = "SnapshotSidecarNotFoundError";
  }
}

export class SnapshotTimeoutError extends Error {
  override readonly name: "SnapshotTimeoutError";
  constructor(readonly timeoutMs: number) {
    super(`oh-sqlite-cli sidecar did not respond within ${timeoutMs} ms`);
    this.name = "SnapshotTimeoutError";
  }
}

export class SnapshotProtocolError extends Error {
  override readonly name: "SnapshotProtocolError";
  constructor(
    readonly reason: unknown,
    readonly stdout: string,
  ) {
    super(`oh-sqlite-cli produced unparseable output: ${String(reason)}`);
    this.name = "SnapshotProtocolError";
  }
}

export class SnapshotError extends Error {
  override readonly name: "SnapshotError";
  constructor(
    readonly code: string,
    readonly details: SnapshotErrorDetails,
  ) {
    super(`oh-sqlite-cli snapshot failed: ${code}`);
    this.name = "SnapshotError";
  }
}

function currentPlatformArch(): { platform: string; arch: string } {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") return { platform: "darwin", arch: "arm64" };
  if (platform === "darwin" && arch === "x64") return { platform: "darwin", arch: "x64" };
  if (platform === "linux" && arch === "x64") return { platform: "linux", arch: "x64" };
  throw new Error(`Unsupported platform for oh-sqlite-cli sidecar: ${platform}-${arch}`);
}

function artifactBaseDirectory(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(modulePath);
  const base = moduleDir.endsWith("/src") || moduleDir.endsWith("\\src")
    ? resolve(moduleDir, "..", "dist")
    : moduleDir;
  return resolve(base, "rust-artifacts", "oh-sqlite");
}

export function sidecarBinaryPath(
  platform = currentPlatformArch().platform,
  arch = currentPlatformArch().arch,
): string {
  const base = process.env.HRANESS_OH_SQLITE_CLI_PATH
    ? dirname(process.env.HRANESS_OH_SQLITE_CLI_PATH)
    : artifactBaseDirectory();
  return process.env.HRANESS_OH_SQLITE_CLI_PATH
    ? resolve(process.env.HRANESS_OH_SQLITE_CLI_PATH)
    : resolve(base, `${platform}-${arch}`, "oh-sqlite-cli");
}

function boundInteger(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new TypeError(`byte limit must be an integer from 1 through ${maximum}`);
  }
  return result;
}

function boundedRequest(options: SnapshotOptions): SnapshotRequest {
  const sourcePath = typeof options.sourcePath === "string" ? options.sourcePath : "";
  const outputDirectory = typeof options.outputDirectory === "string" ? options.outputDirectory : "";
  if (!isAbsolute(sourcePath)) throw new TypeError("sourcePath must be absolute");
  if (!isAbsolute(outputDirectory)) throw new TypeError("outputDirectory must be absolute");
  const maxFileBytes = boundInteger(options.maxFileBytes, 16 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
  const maxTotalBytes = boundInteger(options.maxTotalBytes, 64 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER);
  const request: SnapshotRequest = {
    sourcePath,
    outputDirectory,
    maxFileBytes,
    maxTotalBytes,
  };
  return request;
}

async function runSidecar(binaryPath: string, requestJson: string): Promise<string> {
  const child = spawn(binaryPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  return new Promise((resolvePromise, rejectPromise) => {
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error: unknown, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === null) resolvePromise(value ?? "");
      else rejectPromise(error);
    };
    const failProtocol = (reason: unknown) => {
      child.kill("SIGKILL");
      finish(new SnapshotProtocolError(reason, Buffer.concat(stdout).toString("utf8")));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new SnapshotTimeoutError(SPAWN_TIMEOUT_MS));
    }, SPAWN_TIMEOUT_MS);

    child.once("error", (error) => finish(error));
    child.stdin.once("error", (error) => finish(error));
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_RESPONSE_BYTES) {
        failProtocol(new Error("response exceeds maximum length"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_RESPONSE_BYTES) failProtocol(new Error("stderr exceeds maximum length"));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      const output = Buffer.concat(stdout).toString("utf8");
      if (code !== 0 || signal !== null) {
        finish(new SnapshotProtocolError(new Error(`oh-sqlite-cli exited with code ${code ?? "unknown"}`), output));
        return;
      }
      const newline = output.indexOf("\n");
      if (newline < 0 || output.slice(newline + 1).trim().length !== 0) {
        finish(new SnapshotProtocolError(new Error("response must be exactly one JSON line"), output));
        return;
      }
      finish(null, output.slice(0, newline));
    });

    child.stdin.end(`${requestJson}\n`);
  });
}

function isSnapshotError(value: unknown): value is SnapshotErrorDetails {
  return (
    typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>).error === "string"
  );
}

/**
 * Isolate a SQLite database and its WAL/journal sidecars using the product-neutral
 * oh-sqlite-cli sidecar binary shipped with this package.
 *
 * The original source files are never modified. On success the returned paths point
 * to the private copies inside `outputDirectory`.
 */
export async function snapshotDatabase(options: SnapshotOptions): Promise<Snapshot> {
  const request = boundedRequest(options);
  const requestJson = JSON.stringify(request);
  if (Buffer.byteLength(requestJson, "utf8") > MAX_REQUEST_BYTES) {
    throw new TypeError("snapshot request exceeds maximum length");
  }

  const { platform, arch } = currentPlatformArch();
  const binaryPath = sidecarBinaryPath(platform, arch);
  try {
    if (!(await stat(binaryPath)).isFile()) throw new Error("sidecar is not a file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof Error && error.message === "sidecar is not a file")) {
      throw error;
    }
    throw new SnapshotSidecarNotFoundError(platform, arch, binaryPath);
  }

  await mkdir(request.outputDirectory, { recursive: true });
  return parseSnapshotResponse(await runSidecar(binaryPath, requestJson), request);
}

function containedPath(path: string, outputDirectory: string): boolean {
  if (!isAbsolute(path)) return false;
  const rel = relative(resolve(outputDirectory), resolve(path));
  return rel.length > 0 && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function parseSnapshotResponse(stdout: string, request: SnapshotRequest): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new SnapshotProtocolError(error, stdout);
  }

  if (isSnapshotError(parsed)) {
    throw new SnapshotError(parsed.error, parsed);
  }

  const candidate = parsed as Record<string, unknown>;
  const keys = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? Object.keys(parsed).sort()
    : [];
  if (
    keys.join(",") !== "databasePath,journalPath,totalBytes,walPath"
    || typeof candidate.databasePath !== "string"
    || !containedPath(candidate.databasePath, request.outputDirectory)
    || (candidate.walPath !== null && (typeof candidate.walPath !== "string"
      || candidate.walPath !== `${candidate.databasePath}-wal`))
    || (candidate.journalPath !== null && (typeof candidate.journalPath !== "string"
      || candidate.journalPath !== `${candidate.databasePath}-journal`))
    || !Number.isSafeInteger(candidate.totalBytes)
    || (candidate.totalBytes as number) < SQLITE_HEADER_BYTES
    || (candidate.totalBytes as number) > request.maxTotalBytes
  ) {
    throw new SnapshotProtocolError(new Error("invalid snapshot fields"), stdout);
  }

  return Object.freeze({
    databasePath: candidate.databasePath,
    walPath: candidate.walPath as string | null,
    journalPath: candidate.journalPath as string | null,
    totalBytes: candidate.totalBytes as number,
  });
}

/**
 * Synchronous variant of {@link snapshotDatabase}. Useful for callers that need
 * a blocking, single-process snapshot for a small database.
 */
export function snapshotDatabaseSync(options: SnapshotOptions): Snapshot {
  const request = boundedRequest(options);
  const requestJson = JSON.stringify(request);
  if (Buffer.byteLength(requestJson, "utf8") > MAX_REQUEST_BYTES) {
    throw new TypeError("snapshot request exceeds maximum length");
  }

  const { platform, arch } = currentPlatformArch();
  const binaryPath = sidecarBinaryPath(platform, arch);
  try {
    if (!statSync(binaryPath).isFile()) throw new Error("sidecar is not a file");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof Error && error.message === "sidecar is not a file")) {
      throw error;
    }
    throw new SnapshotSidecarNotFoundError(platform, arch, binaryPath);
  }

  mkdirSync(request.outputDirectory, { recursive: true });
  const result = spawnSync(binaryPath, [], {
    input: `${requestJson}\n`,
    timeout: SPAWN_TIMEOUT_MS,
    encoding: "utf8",
    maxBuffer: MAX_RESPONSE_BYTES,
  });

  if (result.error !== undefined && result.error !== null) {
    if ((result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      throw new SnapshotTimeoutError(SPAWN_TIMEOUT_MS);
    }
    throw new SnapshotProtocolError(result.error, result.stdout ?? "");
  }
  if (result.status !== 0) {
    throw new SnapshotProtocolError(new Error(`oh-sqlite-cli exited with code ${result.status ?? "unknown"}`), result.stdout ?? "");
  }

  const stdout = result.stdout ?? "";
  const newline = stdout.indexOf("\n");
  if (newline < 0 || stdout.slice(newline + 1).trim().length !== 0) {
    throw new SnapshotProtocolError(new Error("response must be exactly one JSON line"), stdout);
  }
  return parseSnapshotResponse(stdout.slice(0, newline), request);
}
