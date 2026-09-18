import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  snapshotDatabase,
  sidecarBinaryPath,
  SnapshotError,
  SnapshotSidecarNotFoundError,
} from "./sqlite-snapshot";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");

async function ensureSidecarPath(): Promise<string> {
  const envPath = process.env.HRANESS_OH_SQLITE_CLI_PATH;
  if (envPath !== undefined && envPath.length > 0) {
    return envPath;
  }

  const defaultPath = sidecarBinaryPath();
  try {
    await stat(defaultPath);
    return defaultPath;
  } catch {
    // Build a native sidecar for the current host so tests can exercise it.
    const root = import.meta.dir.endsWith("/src") || import.meta.dir.endsWith("\\src")
      ? join(import.meta.dir, "..", "rust")
      : join(import.meta.dir, "..", "rust");
    const result = await $`cd ${root} && cargo build --release -p oh-sqlite-cli`.quiet();
    if (result.exitCode !== 0) {
      throw new Error(`Failed to build oh-sqlite-cli for tests: ${result.stderr}`);
    }
    const nativePath = join(root, "target", "release", "oh-sqlite-cli");
    await stat(nativePath);
    return nativePath;
  }
}

describe("sqlite-snapshot loader", () => {
  const originalEnv = process.env.HRANESS_OH_SQLITE_CLI_PATH;
  let tempDirectories: string[] = [];

  beforeAll(async () => {
    process.env.HRANESS_OH_SQLITE_CLI_PATH = await ensureSidecarPath();
  }, 120000);

  afterAll(async () => {
    if (originalEnv === undefined) {
      delete process.env.HRANESS_OH_SQLITE_CLI_PATH;
    } else {
      process.env.HRANESS_OH_SQLITE_CLI_PATH = originalEnv;
    }
    for (const dir of tempDirectories) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Cleanup is best-effort; tests already completed.
      }
    }
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "oh-sqlite-snapshot-test-"));
    tempDirectories.push(dir);
    return dir;
  }

  async function makeSqliteFile(path: string): Promise<void> {
    const body = Buffer.concat([SQLITE_MAGIC, Buffer.alloc(512 - SQLITE_MAGIC.length)]);
    await writeFile(path, body);
  }

  test("sidecarBinaryPath resolves default host artifact path", () => {
    const realPath = process.env.HRANESS_OH_SQLITE_CLI_PATH;
    delete process.env.HRANESS_OH_SQLITE_CLI_PATH;
    try {
      const path = sidecarBinaryPath("darwin", "arm64");
      expect(path).toContain("rust-artifacts/oh-sqlite/darwin-arm64/oh-sqlite-cli");
    } finally {
      if (realPath !== undefined) {
        process.env.HRANESS_OH_SQLITE_CLI_PATH = realPath;
      }
    }
  });

  test("snapshotDatabase isolates a valid SQLite file", async () => {
    const root = await makeTempDir();
    const source = join(root, "source.db");
    const output = join(root, "out");
    await makeSqliteFile(source);

    const snapshot = await snapshotDatabase({ sourcePath: source, outputDirectory: output });
    expect(snapshot.databasePath).toContain("source.db");
    expect(snapshot.walPath).toBeNull();
    expect(snapshot.journalPath).toBeNull();
    expect(snapshot.totalBytes).toBe(512);
  });

  test("snapshotDatabase throws SnapshotError for an invalid SQLite header", async () => {
    const root = await makeTempDir();
    const source = join(root, "bad.db");
    const output = join(root, "out");
    await writeFile(source, "not sqlite");

    await expect(snapshotDatabase({ sourcePath: source, outputDirectory: output }))
      .rejects
      .toBeInstanceOf(SnapshotError);
  });

  test("snapshotDatabase throws SnapshotSidecarNotFoundError for a missing binary", async () => {
    const root = await makeTempDir();
    const source = join(root, "missing.db");
    const output = join(root, "out");
    await makeSqliteFile(source);

    const realPath = process.env.HRANESS_OH_SQLITE_CLI_PATH;
    process.env.HRANESS_OH_SQLITE_CLI_PATH = join(root, "no-such-binary");
    try {
      await expect(snapshotDatabase({ sourcePath: source, outputDirectory: output }))
        .rejects
        .toBeInstanceOf(SnapshotSidecarNotFoundError);
    } finally {
      if (realPath === undefined) {
        delete process.env.HRANESS_OH_SQLITE_CLI_PATH;
      } else {
        process.env.HRANESS_OH_SQLITE_CLI_PATH = realPath;
      }
    }
  });
});
