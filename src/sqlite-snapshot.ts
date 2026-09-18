import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const MAX_REQUEST_BYTES = 4096;
const MAX_RESPONSE_BYTES = 4096;
const SPAWN_TIMEOUT_MS = 120_000;

export type SnapshotOptions = Readonly<{
  sourcePath: string;
  outputDirectory: string;
  maxFileBytes?: number;
  maxTotalBytes?: number;
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
    ? process.env.HRANESS_OH_SQLITE_CLI_PATH
    : resolve(base, `${platform}-${arch}`, "oh-sqlite-cli");
}

function boundInteger(value: number | undefined, fallback: number, maximum: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new TypeError(`byte limit must be an integer from 1 through ${maximum}`);
  }
  return result;
}

function boundedRequest(options: SnapshotOptions): Record<string, unknown> {
  const sourcePath = typeof options.sourcePath === "string" ? options.sourcePath : "";
  const outputDirectory = typeof options.outputDirectory === "string" ? options.outputDirectory : "";
  if (sourcePath.length === 0) throw new TypeError("sourcePath is required");
  if (outputDirectory.length === 0) throw new TypeError("outputDirectory is required");
  const request: Record<string, unknown> = {
    sourcePath,
    outputDirectory,
    maxFileBytes: boundInteger(options.maxFileBytes, 16 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER),
    maxTotalBytes: boundInteger(options.maxTotalBytes, 64 * 1024 * 1024 * 1024, Number.MAX_SAFE_INTEGER),
  };
  return request;
}

async function readLine(stream: Readable | null): Promise<string> {
  if (stream === null) throw new SnapshotProtocolError(new Error("stdout is not available"), "");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_RESPONSE_BYTES) {
      throw new SnapshotProtocolError(new Error("response exceeds maximum length"), "");
    }
    chunks.push(chunk);
    if (chunk.includes("\n")) break;
  }
  const combined = Buffer.concat(chunks);
  const newline = combined.indexOf("\n");
  const line = combined.subarray(0, newline >= 0 ? newline : combined.length).toString("utf8");
  return line;
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
    timeout: SPAWN_TIMEOUT_MS,
  });

  child.stdin.write(requestJson);
  child.stdin.write("\n");
  child.stdin.end();

  const stdout = await Promise.race([
    readLine(child.stdout),
    new Promise<never>((_, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code !== 0) reject(new Error(`oh-sqlite-cli exited with code ${code}`));
      });
      setTimeout(() => reject(new SnapshotTimeoutError(SPAWN_TIMEOUT_MS)), SPAWN_TIMEOUT_MS);
    }),
  ]);

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
  if (
    typeof candidate.databasePath !== "string"
    || (candidate.walPath !== null && typeof candidate.walPath !== "string")
    || (candidate.journalPath !== null && typeof candidate.journalPath !== "string")
    || typeof candidate.totalBytes !== "number"
  ) {
    throw new SnapshotProtocolError(new Error("missing snapshot fields"), stdout);
  }

  return Object.freeze({
    databasePath: candidate.databasePath,
    walPath: candidate.walPath ?? null,
    journalPath: candidate.journalPath ?? null,
    totalBytes: candidate.totalBytes,
  });
}

function parseSnapshotResponse(stdout: string): Snapshot {
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
  if (
    typeof candidate.databasePath !== "string"
    || (candidate.walPath !== null && typeof candidate.walPath !== "string")
    || (candidate.journalPath !== null && typeof candidate.journalPath !== "string")
    || typeof candidate.totalBytes !== "number"
  ) {
    throw new SnapshotProtocolError(new Error("missing snapshot fields"), stdout);
  }

  return Object.freeze({
    databasePath: candidate.databasePath,
    walPath: candidate.walPath ?? null,
    journalPath: candidate.journalPath ?? null,
    totalBytes: candidate.totalBytes,
  });
}

/**
 * Synchronous variant of {@link snapshotDatabase}. Useful for callers that need
 * a blocking, single-process snapshot for a small database.
 */
export function snapshotDatabaseSync(options: SnapshotOptions): Snapshot {
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
    input: `${requestJson}\n`,
    timeout: SPAWN_TIMEOUT_MS,
    encoding: "utf8",
  });

  if (result.error !== undefined && result.error !== null) {
    throw new SnapshotProtocolError(result.error, result.stdout ?? "");
  }
  if (result.status !== 0) {
    throw new SnapshotProtocolError(new Error(`oh-sqlite-cli exited with code ${result.status ?? "unknown"}`), result.stdout ?? "");
  }

  const stdout = result.stdout ?? "";
  const newline = stdout.indexOf("\n");
  const line = newline >= 0 ? stdout.slice(0, newline) : stdout;
  return parseSnapshotResponse(line);
}
