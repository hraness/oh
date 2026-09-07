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
const EFFECT_RUNTIME_GRAPHS = new Set([
  "dist/cli.js", "dist/index.js", "dist/sdk.js", "dist/semantic.js", "dist/sync.js", "dist/memory.js", "dist/libsql.js", "dist/semantic-cloud.js",
]);
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
    if (packagePath.startsWith("dist/") && extension === ".js") {
      // Check shipped bytes: sync is part of the root/SDK/CLI surface, while
      // pure store, SQLite codec, projection and page graphs stay independent.
      const includesEffectRuntime = source.includes("effect/Effect");
      if (includesEffectRuntime !== EFFECT_RUNTIME_GRAPHS.has(packagePath)) {
        problems.push(`${packagePath} violates the reviewed Effect runtime graph boundary`);
      }
    }
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
    await writeFile(join(consumer, "operation-size-identity.mjs"), `
import { Database } from "bun:sqlite";
import { createKnowledgeGraphRecordV1 } from "@hraness/oh";
import {
  bootstrapOhLibSqlAuthorityV1,
  createOhLibSqlStoreAuthorityV1,
} from "@hraness/oh/libsql";
import {
  isOhConflictError,
  isOhDependencyError,
  isOhIntegrityError,
  isOhOperationSizeError,
  isOhProfileError,
  OH_CANONICAL_STORE_PROFILE_V1,
  OH_OPERATION_SIZE_ERROR_CODE_V1,
  OhConflictError,
  OhDependencyError,
  OhIntegrityError,
  OhOperationSizeError,
  OhProfileError,
} from "@hraness/oh/store";
import {
  OhConflictError as SqliteOhConflictError,
  OhDependencyError as SqliteOhDependencyError,
  OhIntegrityError as SqliteOhIntegrityError,
  OhProfileError as SqliteOhProfileError,
  OhSqliteStore,
} from "@hraness/oh/sqlite";

class SqliteCompatibleClient {
  database = new Database(":memory:", { strict: true });

  #execute(statement) {
    const sql = typeof statement === "string" ? statement : statement.sql;
    const args = typeof statement === "string" ? [] : statement.args ?? [];
    const bindings = args.map((value) => value instanceof Date
      ? value.toISOString() : value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    if (/^\\s*(?:SELECT|PRAGMA)\\b/iu.test(sql)) {
      return { rows: this.database.query(sql).all(...bindings) };
    }
    const result = this.database.query(sql).run(...bindings);
    return { rows: [], rowsAffected: result.changes };
  }

  async execute(statement) { return this.#execute(statement); }

  async batch(statements) {
    return this.database.transaction((items) => items.map((statement) => this.#execute(statement)))(statements);
  }

  close() { this.database.close(); }
}

const record = createKnowledgeGraphRecordV1({
  dependencies: [], key: "entity:bounded", kind: "entity", v: 1, value: { name: "Bounded" },
});
function assertSizeError(error, source) {
  if (!(error instanceof OhOperationSizeError) || !isOhOperationSizeError(error)
    || error.code !== OH_OPERATION_SIZE_ERROR_CODE_V1
    || error.maximumOperationBytes !== 1 || error.operationBytes <= 1) {
    throw new Error(source + " did not preserve the packed cross-entrypoint size-error identity.");
  }
}

const sqlite = new OhSqliteStore({ path: ":memory:", spaceId: "package-size-sqlite" });
let sqliteError;
try {
  sqlite.commit({ actorId: "package.smoke", changes: [{ kind: "put", record, v: 1 }],
    expectedHead: sqlite.head(), maximumOperationBytes: 1, operationId: "op_sqlite_bounded" });
} catch (error) { sqliteError = error; }
assertSizeError(sqliteError, "SQLite");
if (sqlite.head().sequence !== 0 || sqlite.exportOperations().length !== 0) {
  throw new Error("SQLite size refusal changed durable state.");
}

const staleHead = sqlite.head();
sqlite.commit({ actorId: "package.smoke", changes: [{ kind: "put", record, v: 1 }],
  expectedHead: staleHead, operationId: "op_sqlite_conflict_first" });
let sqliteConflict;
try {
  sqlite.commit({ actorId: "package.smoke", changes: [{ kind: "put", record, v: 1 }],
    expectedHead: staleHead, operationId: "op_sqlite_conflict_second" });
} catch (error) { sqliteConflict = error; }
if (!(sqliteConflict instanceof SqliteOhConflictError)
  || !(sqliteConflict instanceof OhConflictError)
  || !isOhConflictError(sqliteConflict)
  || sqliteConflict.message !== "The expected head does not match the current space head.") {
  throw new Error("A packed SQLite conflict lost its store-entrypoint error identity.");
}
sqlite.close();

for (const [error, ErrorClass, guard, label] of [
  [new SqliteOhConflictError("conflict"), OhConflictError, isOhConflictError, "conflict"],
  [new SqliteOhIntegrityError("integrity"), OhIntegrityError, isOhIntegrityError, "integrity"],
  [new SqliteOhDependencyError("dependency"), OhDependencyError, isOhDependencyError, "dependency"],
  [new SqliteOhProfileError("profile"), OhProfileError, isOhProfileError, "profile"],
]) {
  if (!(error instanceof ErrorClass) || !guard(error) || error.message !== label) {
    throw new Error("A packed SQLite core error lost its store-entrypoint identity.");
  }
}

const client = new SqliteCompatibleClient();
await bootstrapOhLibSqlAuthorityV1(client);
const authority = await createOhLibSqlStoreAuthorityV1(client, {
  profile: OH_CANONICAL_STORE_PROFILE_V1,
  realmId: "realm:package-size-libsql",
  spaceId: "package-size-libsql",
});
let libsqlError;
try {
  await authority.store.commit({ actorId: "package.smoke", changes: [{ kind: "put", record, v: 1 }],
    expectedHead: await authority.store.head(), maximumOperationBytes: 1,
    operationId: "op_libsql_bounded" });
} catch (error) { libsqlError = error; }
assertSizeError(libsqlError, "libSQL");
if ((await authority.store.head()).sequence !== 0) {
  throw new Error("libSQL size refusal changed durable state.");
}
await authority.store.close();
client.close();

const copied = Object.create(RangeError.prototype);
Object.defineProperties(copied, {
  [Symbol.for("@hraness/oh/OhOperationSizeError/v1")]: {
    configurable: false, value: true, writable: false,
  },
  code: { configurable: false, value: OH_OPERATION_SIZE_ERROR_CODE_V1, writable: false },
  maximumOperationBytes: { configurable: false, value: 1, writable: false },
  operationBytes: { configurable: false, value: 2, writable: false },
});
if (copied instanceof OhOperationSizeError || isOhOperationSizeError(copied)) {
  throw new Error("A copied plain object forged the size-error discriminator.");
}
`, { mode: 0o600 });
    await run([process.execPath, "run", "./operation-size-identity.mjs"], consumer);
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
