import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { publicReleaseEnvironment } from "./release-process-environment";
import { runBoundedProcess } from "./run-bounded-process";

const PACKAGE_NAME = "@hraness/oh";
const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const MAXIMUM_ARCHIVE_BYTES = 64 * 1_024 * 1_024;
const MAXIMUM_FILES = 1_000;
const MAXIMUM_UNPACKED_BYTES = 64 * 1_024 * 1_024;
const MAXIMUM_FILE_BYTES = 4 * 1_024 * 1_024;
const EXPECTED_TOP_LEVEL = new Set(["LICENSE", "README.md", "dist", "package.json", "skills", "spec", "src"]);
const TEXT_EXTENSIONS = new Set([
  "", ".css", ".js", ".json", ".map", ".md", ".mjs", ".sh", ".sql", ".ts", ".txt", ".yaml", ".yml",
]);
const DATABASE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const FORBIDDEN_TEXT = [
  { label: "developer home path", pattern: /\/(?:Users|home)\/[A-Za-z0-9._-]+\//u },
  { label: "task-local temporary path", pattern: /\/private\/tmp\/[A-Za-z0-9._/-]+/u },
  { label: "private key material", pattern: /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/u },
  { label: "GitHub access token", pattern: /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/u },
  { label: "OpenAI-style secret", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u },
  { label: "Slack access token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/u },
] as const;

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function within(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

function packagePaths(value: unknown, label: string): string[] {
  if (typeof value === "string") return value.startsWith("./") ? [value.slice(2)] : [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain package-relative paths.`);
  }
  return Object.entries(value).flatMap(([key, nested]) => packagePaths(nested, `${label}.${key}`));
}

async function startsWithSqliteHeader(path: string): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(16);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytesRead === bytes.length && bytes.toString("utf8") === "SQLite format 3\u0000";
  } finally {
    await handle.close();
  }
}

async function scanPackage(root: string): Promise<void> {
  const problems: string[] = [];
  let files = 0;
  let bytes = 0;
  const topLevel = new Set<string>();
  async function visit(path: string): Promise<void> {
    const information = await lstat(path);
    const packagePath = relative(root, path).split(sep).join("/") || ".";
    if (packagePath !== ".") topLevel.add(packagePath.split("/", 1)[0] ?? "");
    if (information.isSymbolicLink()) {
      problems.push(`${packagePath} is a symlink`);
      return;
    }
    if (information.isDirectory()) {
      for (const entry of (await readdir(path, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(join(path, entry.name));
      }
      return;
    }
    if (!information.isFile()) {
      problems.push(`${packagePath} is not a regular file`);
      return;
    }
    files += 1;
    bytes += information.size;
    if (information.size > MAXIMUM_FILE_BYTES) problems.push(`${packagePath} exceeds the per-file size bound`);
    if (files > MAXIMUM_FILES || bytes > MAXIMUM_UNPACKED_BYTES) {
      throw new Error("Packed package exceeded its finite inventory bound.");
    }
    const extension = extname(path).toLowerCase();
    if (DATABASE_EXTENSIONS.has(extension) || await startsWithSqliteHeader(path)) {
      problems.push(`${packagePath} contains a database artifact`);
    }
    if ([".env", ".npmrc"].includes(basename(path))) {
      problems.push(`${packagePath} contains a private configuration artifact`);
    }
    if (!TEXT_EXTENSIONS.has(extension) && basename(path) !== "LICENSE") {
      problems.push(`${packagePath} has an unreviewed file extension`);
      return;
    }
    const source = await readFile(path, "utf8");
    for (const rule of FORBIDDEN_TEXT) {
      if (rule.pattern.test(source)) problems.push(`${packagePath} contains ${rule.label}`);
    }
  }
  await visit(root);
  if ([...topLevel].sort().join("\n") !== [...EXPECTED_TOP_LEVEL].sort().join("\n")) {
    problems.push("top-level packed inventory is not exact");
  }
  if (problems.length > 0) {
    throw new Error(`Packed public boundary failed:\n${[...new Set(problems)].sort().join("\n")}`);
  }
}

async function run(command: readonly string[], cwd: string, capture = false): Promise<string> {
  const result = await runBoundedProcess(command, {
    cwd,
    env: publicReleaseEnvironment({ CI: "true", NO_COLOR: "1" }),
    stderrBytes: 1_024 * 1_024,
    stdoutBytes: 1_024 * 1_024,
    timeoutMs: 120_000,
  });
  if (result.exitCode !== 0) throw new Error(`Package smoke subprocess failed (${String(result.exitCode)}); diagnostics redacted.`);
  return result.stdout.toString("utf8");
}

async function requirePublishedPaths(packageRoot: string, manifest: JsonRecord): Promise<void> {
  const paths = [
    ...packagePaths(record(manifest.bin, "installed package.json bin"), "installed package.json bin"),
    ...packagePaths(record(manifest.exports, "installed package.json exports"), "installed package.json exports"),
  ];
  for (const path of [...new Set(paths)].sort()) {
    const target = resolve(packageRoot, path);
    if (!within(packageRoot, target)) throw new Error(`Published path escapes the package: ${path}`);
    await access(target);
  }
}

export async function packageSmoke(suppliedArchive?: string): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), "oh-package-smoke-"));
  try {
    const archive = suppliedArchive === undefined ? join(work, "package.tgz") : resolve(suppliedArchive);
    const consumer = join(work, "consumer");
    const cache = join(work, "cache");
    await Promise.all([mkdir(consumer), mkdir(cache)]);
    if (suppliedArchive === undefined) {
      await run([
        process.execPath,
        "pm",
        "pack",
        "--filename",
        archive,
        "--ignore-scripts",
        "--quiet",
      ], PACKAGE_ROOT);
    }
    const archiveInformation = await stat(archive);
    if (!archiveInformation.isFile() || archiveInformation.size <= 0
      || archiveInformation.size > MAXIMUM_ARCHIVE_BYTES) {
      throw new Error("Packed archive is not one finite regular file.");
    }
    await writeFile(
      join(consumer, "package.json"),
      `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await run([
      process.execPath,
      "add",
      archive,
      "--ignore-scripts",
      "--offline",
      "--cache-dir",
      cache,
      "--backend",
      "copyfile",
    ], consumer);

    const packageRoot = await realpath(join(consumer, "node_modules", "@hraness", "oh"));
    await scanPackage(packageRoot);
    const manifest = record(
      JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as unknown,
      "installed package.json",
    );
    if (
      manifest.name !== PACKAGE_NAME
      || typeof manifest.version !== "string"
      || !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u.test(manifest.version)
      || manifest.license !== "MIT"
      || manifest.private !== false
      || manifest.dependencies !== undefined
    ) throw new Error("Packed package identity, license, or dependency boundary is invalid.");
    const publishConfig = record(manifest.publishConfig, "installed package.json publishConfig");
    if (
      publishConfig.access !== "public"
      || publishConfig.provenance !== true
      || publishConfig.registry !== "https://registry.npmjs.org"
    ) throw new Error("Packed package is not pinned to public provenance-bearing npm publication.");
    await requirePublishedPaths(packageRoot, manifest);

    const cli = join(packageRoot, "dist", "cli.js");
    const help = await run([process.execPath, cli, "--help"], consumer, true);
    const installedBinHelp = await run([
      join(consumer, "node_modules", ".bin", "oh"), "--help",
    ], consumer, true);
    const version = await run([process.execPath, cli, "--version"], consumer, true);
    if (
      !help.includes("Usage:\n  oh init")
      || installedBinHelp !== help
      || version !== `${manifest.version}\n`
    ) {
      throw new Error("Packed CLI help or version does not match the manifest.");
    }
    const database = join(work, "synthetic.sqlite");
    await run([process.execPath, cli, "init", "--db", database], consumer, true);
    const verification = JSON.parse(await run([
      process.execPath, cli, "verify", "--db", database,
    ], consumer, true)) as Readonly<{ sqliteIntegrity?: unknown; v?: unknown }>;
    if (verification.sqliteIntegrity !== "ok" || verification.v !== 1) {
      throw new Error("Packed CLI failed its isolated synthetic database check.");
    }

    await run([
      process.execPath,
      "-e",
      "for (const p of ['@hraness/oh','@hraness/oh/sdk','@hraness/oh/store','@hraness/oh/libsql','@hraness/oh/sqlite','@hraness/oh/sync','@hraness/oh/semantic','@hraness/oh/semantic-cloud','@hraness/oh/memory','@hraness/oh/memory-page','@hraness/oh/projection','@hraness/oh/experimental/memory']) await import(p)",
    ], consumer);
    await run([
      "node",
      "--input-type=module",
      "-e",
      "for (const p of ['@hraness/oh/store','@hraness/oh/libsql','@hraness/oh/semantic-cloud','@hraness/oh/memory','@hraness/oh/memory-page','@hraness/oh/projection','@hraness/oh/experimental/memory']) await import(p)",
    ], consumer);
    console.log(`Verified packed ${PACKAGE_NAME}@${String(manifest.version)} without private artifacts.`);
  } finally {
    await rm(work, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  const [archive, extra] = process.argv.slice(2);
  if (extra !== undefined) throw new Error("Usage: package-smoke.ts [ARTIFACT.tgz]");
  await packageSmoke(archive);
}
