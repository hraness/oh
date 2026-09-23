import { constants } from "node:fs";
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
import { gunzipSync } from "node:zlib";
import { deriveWikidataInventoryV1, WIKIDATA_INVENTORY_LIMITS_V1, wikidataSourceSha256V1 } from "./capture-wikidata-inventory";
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
const REVIEWED_BINARY_EXTENSIONS = new Set([".wasm"]);
const DATABASE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
// This is one reviewed source corpus, not a general compressed-file allowance.
const REVIEWED_WIKIDATA_ARCHIVE = "spec/research-v1/wikidata/2026-09-13/sources.jsonl.gz";
const REVIEWED_WIKIDATA_ARCHIVE_SHA256 = "4bfbadee1d0a352e7269feb24b09fa2cf000e25ace9cbaaadb8bcf037a739610";
const MAXIMUM_EXPANDED_WIKIDATA_BYTES = 10_342_838;
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

function forbiddenTextProblems(source: string): string[] {
  return FORBIDDEN_TEXT.filter((rule) => rule.pattern.test(source)).map((rule) => `contains ${rule.label}`);
}

/** Content audit only: package admission also requires the exact path and compressed-byte digest below. */
export function auditWikidataCorpusContent(compressed: Uint8Array): number {
  if (compressed.byteLength === 0 || compressed.byteLength > MAXIMUM_FILE_BYTES) {
    throw new Error("Wikidata corpus exceeds its compressed byte bound");
  }
  let expanded: Buffer;
  try {
    expanded = gunzipSync(compressed, { maxOutputLength: MAXIMUM_EXPANDED_WIKIDATA_BYTES });
  } catch (cause) {
    throw new Error("Wikidata corpus is invalid gzip or exceeds its expanded byte bound", { cause });
  }
  if (expanded.byteLength > MAXIMUM_EXPANDED_WIKIDATA_BYTES) {
    throw new Error("Wikidata corpus exceeds its expanded byte bound");
  }
  const source = new TextDecoder("utf-8", { fatal: true }).decode(expanded);
  if (!source.endsWith("\n")) throw new Error("Wikidata corpus must end in a newline");
  const lines = source.slice(0, -1).split("\n");
  if (lines.length > WIKIDATA_INVENTORY_LIMITS_V1.sources) throw new Error("Wikidata corpus exceeds its source count bound");
  const sources: unknown[] = lines.map((line) => JSON.parse(line) as unknown);
  // Verify source envelopes, body bytes/hashes, API provenance, and the complete traversal offline.
  deriveWikidataInventoryV1(sources);
  const problems = forbiddenTextProblems(source);
  for (const value of sources) {
    const body = record(value, "Wikidata source").body;
    if (typeof body !== "string") throw new Error("Wikidata source body must be text");
    // Scan the original response too, so JSONL string escaping cannot hide a match.
    problems.push(...forbiddenTextProblems(body));
  }
  if (problems.length > 0) throw new Error([...new Set(problems)].sort().join("; "));
  return expanded.byteLength;
}

async function readReviewedWikidataArchive(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const information = await handle.stat();
    if (!information.isFile() || information.size <= 0 || information.size > MAXIMUM_FILE_BYTES) {
      throw new Error("Wikidata corpus is not a bounded regular file");
    }
    const output = Buffer.alloc(information.size + 1);
    let length = 0;
    while (length < output.length) {
      const { bytesRead } = await handle.read(output, length, output.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== information.size) throw new Error("Wikidata corpus changed while reading");
    const compressed = output.subarray(0, length);
    if (wikidataSourceSha256V1(compressed) !== REVIEWED_WIKIDATA_ARCHIVE_SHA256) {
      throw new Error("Wikidata corpus does not match its reviewed SHA-256");
    }
    return compressed;
  } finally {
    await handle.close();
  }
}

export async function scanPackage(root: string): Promise<void> {
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
    if (files > MAXIMUM_FILES || bytes > MAXIMUM_UNPACKED_BYTES) {
      throw new Error("Packed package exceeded its finite inventory bound.");
    }
    if (information.size > MAXIMUM_FILE_BYTES) {
      problems.push(`${packagePath} exceeds the per-file size bound`);
      return;
    }
    const extension = extname(path).toLowerCase();
    if (DATABASE_EXTENSIONS.has(extension) || await startsWithSqliteHeader(path)) {
      problems.push(`${packagePath} contains a database artifact`);
    }
    if ([".env", ".npmrc"].includes(basename(path))) {
      problems.push(`${packagePath} contains a private configuration artifact`);
    }
    if (REVIEWED_BINARY_EXTENSIONS.has(extension)) {
      return;
    }
    // Native SQLite sidecars are compiled binaries and may contain build-path
    // strings from the Rust toolchain that are not part of the package contract.
    if (packagePath.startsWith("dist/rust-artifacts/oh-sqlite/") && packagePath.endsWith("/oh-sqlite-cli")) {
      return;
    }
    if (packagePath === REVIEWED_WIKIDATA_ARCHIVE) {
      try {
        bytes += auditWikidataCorpusContent(await readReviewedWikidataArchive(path));
      } catch (error) {
        problems.push(`${packagePath}: ${error instanceof Error ? error.message : "Wikidata corpus audit failed"}`);
      }
      if (bytes > MAXIMUM_UNPACKED_BYTES) throw new Error("Packed package exceeded its finite inventory bound.");
      return;
    }
    if (!TEXT_EXTENSIONS.has(extension) && basename(path) !== "LICENSE") {
      problems.push(`${packagePath} has an unreviewed file extension`);
      return;
    }
    const source = await readFile(path, "utf8");
    if (packagePath.startsWith("dist/") && extension === ".js") {
      const includesSupportRuntime = source.includes("hraness-support-protocol-v1");
      if (includesSupportRuntime !== (packagePath === "dist/cli.js")) {
        problems.push(`${packagePath} violates the standalone support runtime boundary`);
      }
      // Check shipped bytes: sync is part of the root/SDK/CLI surface, while
      // pure store, SQLite codec, projection and page graphs stay independent.
      const includesEffectRuntime = source.includes("effect/Effect");
      if (includesEffectRuntime !== EFFECT_RUNTIME_GRAPHS.has(packagePath)) {
        problems.push(`${packagePath} violates the reviewed Effect runtime graph boundary`);
      }
    }
    problems.push(...forbiddenTextProblems(source).map((problem) => `${packagePath} ${problem}`));
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

    // The Suss adapter statically imports its optional peer. Its aliases must
    // resolve in the dependency-free consumer without evaluating that module.
    const peers = record(manifest.peerDependencies, "installed optional peers");
    const peerMetadata = record(record(manifest.peerDependenciesMeta, "installed peer metadata")["@suss/datalog"], "Suss peer metadata");
    const exports = record(manifest.exports, "installed exports");
    if (peers["@suss/datalog"] !== "0.20.0" || peerMetadata.optional !== true) {
      throw new Error("The packed Suss adapter lost its exact optional-peer boundary.");
    }
    for (const name of ["./projection-suss", "./experimental/projection-suss"]) {
      const target = record(exports[name], "installed Suss alias");
      if (target.import !== "./dist/projection-suss.js" || target.types !== "./dist/projection-suss.d.ts") {
        throw new Error("The packed Suss aliases must share their shipped runtime and declaration entry.");
      }
    }
    const sussAliasResolution = "if (import.meta.resolve('@hraness/oh/projection-suss') !== import.meta.resolve('@hraness/oh/experimental/projection-suss')) throw new Error('Packed Suss aliases differ.');";

    const cli = join(packageRoot, "dist", "cli.js");
    const help = await run([process.execPath, cli, "--help"], consumer, true);
    const installedBinHelp = await run([
      join(consumer, "node_modules", ".bin", "oh"), "--help",
    ], consumer, true);
    const version = await run([process.execPath, cli, "--version"], consumer, true);
    const protocol = JSON.parse(await run([process.execPath, cli, "support", "protocol", "--json"], consumer, true)) as {
      offer?: { product?: { id?: unknown }; actions?: { kind?: unknown }[] };
      commands?: { protocol?: unknown };
    };
    if (protocol.offer?.product?.id !== "oh-computer"
      || protocol.offer.actions?.map(action => action.kind).join() !== "support"
      || JSON.stringify(protocol.commands?.protocol) !== JSON.stringify([process.execPath, cli, "support", "protocol", "--json"])) {
      throw new Error("Packed standalone support protocol lost its product or executable identity.");
    }
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
      "for (const p of ['@hraness/oh','@hraness/oh/sdk','@hraness/oh/store','@hraness/oh/libsql','@hraness/oh/sqlite','@hraness/oh/sync','@hraness/oh/semantic','@hraness/oh/rerank','@hraness/oh/semantic-cloud','@hraness/oh/memory','@hraness/oh/memory-page','@hraness/oh/projection','@hraness/oh/experimental/memory','@hraness/oh/research','@hraness/oh/research-store']) await import(p)",
    ], consumer);
    await run([process.execPath, "-e", sussAliasResolution], consumer);
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
      "for (const p of ['@hraness/oh/store','@hraness/oh/libsql','@hraness/oh/semantic-cloud','@hraness/oh/memory','@hraness/oh/memory-page','@hraness/oh/projection','@hraness/oh/experimental/memory','@hraness/oh/research','@hraness/oh/research-store']) await import(p)",
    ], consumer);
    await run(["node", "--input-type=module", "-e", sussAliasResolution], consumer);
    await writeFile(join(consumer, "research-profile.mjs"), `
import assert from "node:assert/strict";
import * as research from "@hraness/oh/research";
import { createOhResearchPacketCodecRegistryV1 } from "@hraness/oh/research-store";
const entity = { entityId: "kent_aaaaaaaaaaaaaaaaaaaaaaaa", identityOperationId: "identity.packed-fixture",
  identityRevision: 1, redirectEntityId: null, state: "active", v: 1 };
const source = await research.parseKnowledgeGraphRecordV1("entity", entity);
assert.equal(source.ok, true);
const packet = await research.prepareOhResearchPacketV1({ records: [{ kind: "entity", value: entity }] });
assert.equal(packet.authority, "unasserted");
assert.equal(packet.records[0].value.source.recordSha256, source.value.recordSha256);
assert.notEqual(packet.records[0].recordSha256, source.value.recordSha256);
assert.deepEqual(createOhResearchPacketCodecRegistryV1(packet).parseRequired("entity", packet.records[0].value), packet.records[0].value);
const copy = structuredClone(packet);
assert.throws(() => createOhResearchPacketCodecRegistryV1(copy), /Prepare or verify/);
const verified = await research.verifyOhResearchPacketV1(copy);
assert.notEqual(verified, null);
assert.equal(createOhResearchPacketCodecRegistryV1(verified).sealed, true);
copy.records[0].value.source.value.identityRevision = 2;
assert.equal(await research.verifyOhResearchPacketV1(copy), null);
`, { mode: 0o600 });
    await run(["node", "./research-profile.mjs"], consumer);
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
