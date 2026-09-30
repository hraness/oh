#!/usr/bin/env bun
import { terminalIntro } from "./cli-intro";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, join } from "node:path";
import { lstat, readFile } from "node:fs/promises";

import { bareScreen, commandHelp, OH_COMMANDS, OH_HELP_TOPICS, rootHelp } from "./cli-help";
import { renderImport, renderInit, renderList, renderLog, renderPut, renderRecord, renderSearch,
  renderTombstone, renderVerify } from "./cli-render";
import { closestMatch, detectAudience, sym } from "./cli-style";

import { canonicalJson, opaqueId, parseCanonicalInstantV1, safeCode, type JsonValue } from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import { OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1, createKnowledgeGraphRecordV1,
  type KnowledgeGraphRecordKindV1, type KnowledgeGraphRecordV1 } from "./graph";
import { renderOhRecallV1, resolveRelativeDateWindowV1 } from "./recall";
import { OH_SQLITE_SCHEMA_VERSION } from "./sqlite/migrations";
import { createOhSyncBundleV1, OH_SYNC_BUNDLE_MAX_BYTES_V1, parseOhSyncBundleV1 } from "./sync-model";

import { OH_PACKAGE_VERSION } from "./cli-version";
export { OH_PACKAGE_VERSION } from "./cli-version";

/** A problem with how the command was typed: exit 2 and point at the command's help. */
export class OhUsageError extends TypeError {
  constructor(message: string, readonly next?: string) { super(message); this.name = "OhUsageError"; }
}

/** A failure with a known next step, such as a missing record (exit 3) or store (exit 1). */
export class OhCliError extends Error {
  constructor(message: string, readonly code: string, readonly next: string, readonly exitCode: number) {
    super(message); this.name = "OhCliError";
  }
}

type ParsedArguments = { json: boolean; options: Map<string, string[]>; positionals: string[] };
type ValidatedInvocation = Readonly<{
  databasePath: string;
  putRecord: KnowledgeGraphRecordV1 | null;
  spaceId: string;
  syncBundle: NonNullable<ReturnType<typeof parseOhSyncBundleV1>> | null;
}>;

const KNOWN_OPTIONS = new Set([
  "actor", "after", "as-of", "author-log", "db", "depends-on", "expected-generation", "file",
  "json", "key", "kind", "limit", "mode", "operation", "space", "value",
]);
/** The CLI renders recall under one fixed byte budget; the SDK renderer accepts any budget up to its limit. */
const RECALL_RENDER_BUDGET_BYTES = 96_000;
const GLOBAL_OPTIONS = ["db", "space"] as const;
const MUTATION_OPTIONS = ["actor", "expected-generation", "operation"] as const;

function unknownOption(option: string): OhUsageError {
  const guess = closestMatch(option.replace(/^-+/u, ""), [...KNOWN_OPTIONS]);
  return new OhUsageError(`Unknown option "${option}".${guess === undefined ? "" : ` Did you mean "--${guess}"?`}`);
}

/**
 * `--json` alone asks for JSON output. `oh put` still reads `--json VALUE` as
 * the record value, as it did before `--value` existed.
 */
function parseArguments(arguments_: readonly string[], command?: string): ParsedArguments {
  const options = new Map<string, string[]>();
  const positionals: string[] = [];
  let json = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] as string;
    if (!argument.startsWith("--")) {
      if (argument.startsWith("-") && argument !== "-") throw unknownOption(argument);
      positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
    const next = equals === -1 ? arguments_[index + 1] : argument.slice(equals + 1);
    if (!KNOWN_OPTIONS.has(name)) throw unknownOption(`--${name}`);
    if (name === "json" && (command !== "put" || (equals === -1 && (next === undefined || next.startsWith("--"))))) {
      if (equals !== -1) throw new OhUsageError("--json takes no value.");
      json = true;
      continue;
    }
    if (next === undefined || next.length === 0 || (equals === -1 && next.startsWith("--"))) {
      throw new OhUsageError(`Option --${name} needs a value.`);
    }
    if (equals === -1) index += 1;
    const current = options.get(name) ?? [];
    if (name !== "depends-on" && current.length !== 0) {
      throw new OhUsageError(`Option --${name} may appear only once.`);
    }
    options.set(name, [...current, next]);
  }
  return { json, options, positionals };
}

function one(parsed: ParsedArguments, name: string, fallback?: string): string | undefined {
  const values = parsed.options.get(name);
  return values?.[0] ?? fallback;
}

function integer(value: string | undefined, name: string, minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new OhUsageError(`--${name} must be a canonical integer from ${minimum} through ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new OhUsageError(`--${name} must be a canonical integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function assertAllowedOptions(parsed: ParsedArguments, allowed: readonly string[]): void {
  const admitted = new Set(allowed);
  for (const name of parsed.options.keys()) {
    if (!admitted.has(name)) throw new OhUsageError(`Option --${name} is not valid for this command.`);
  }
}

function assertPositionals(parsed: ParsedArguments, minimum: number, maximum = minimum): void {
  if (parsed.positionals.length < minimum || parsed.positionals.length > maximum) {
    throw new OhUsageError(`This command needs ${minimum === maximum ? String(minimum) : `${minimum} through ${maximum}`} positional argument${maximum === 1 ? "" : "s"}.`);
  }
}

function parsedSafeCode(value: string | undefined, label: string, maximum = 128): string {
  const parsed = safeCode(value, maximum);
  if (parsed === null) throw new OhUsageError(`${label} is invalid.`);
  return parsed;
}

function validateCommon(parsed: ParsedArguments): Pick<ValidatedInvocation, "databasePath" | "spaceId"> {
  const databasePath = one(parsed, "db", ".oh/oh.sqlite") as string;
  if (databasePath.length === 0 || databasePath.length > 4096 || databasePath.includes("\0")) {
    throw new OhUsageError("--db is invalid.");
  }
  return { databasePath, spaceId: parsedSafeCode(one(parsed, "space", "default"), "--space") };
}

function validateMutation(parsed: ParsedArguments): void {
  if (parsed.options.has("actor")) parsedSafeCode(one(parsed, "actor"), "--actor");
  if (parsed.options.has("operation")) parsedSafeCode(one(parsed, "operation"), "--operation");
  integer(one(parsed, "expected-generation"), "expected-generation");
}

async function validateInvocation(command: string, parsed: ParsedArguments): Promise<ValidatedInvocation> {
  let putRecord: KnowledgeGraphRecordV1 | null = null;
  let syncBundle: ValidatedInvocation["syncBundle"] = null;
  if (command === "contract") {
    assertAllowedOptions(parsed, GLOBAL_OPTIONS);
    assertPositionals(parsed, 0);
    return { ...validateCommon(parsed), putRecord, syncBundle };
  }
  if (command === "init" || command === "verify") {
    assertAllowedOptions(parsed, GLOBAL_OPTIONS);
    assertPositionals(parsed, 0);
  } else if (command === "get") {
    assertAllowedOptions(parsed, GLOBAL_OPTIONS);
    assertPositionals(parsed, 1);
    parsedSafeCode(parsed.positionals[0], "Record key", 512);
  } else if (command === "list") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "kind", "limit"]);
    assertPositionals(parsed, 0);
    const kind = one(parsed, "kind") as KnowledgeGraphRecordKindV1 | undefined;
    if (kind !== undefined && !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind)) {
      throw new OhUsageError("Unknown record kind.");
    }
    integer(one(parsed, "limit"), "limit", 1, 1000);
  } else if (command === "log") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "limit"]);
    assertPositionals(parsed, 0);
    integer(one(parsed, "limit"), "limit", 1, 1000);
  } else if (command === "search") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "limit", "mode"]);
    assertPositionals(parsed, 1, 1024);
    const query = parsed.positionals.join(" ");
    const mode = one(parsed, "mode", "keyword");
    if (query.trim().length === 0 || query.length > 4096
      || (mode !== "keyword" && mode !== "semantic" && mode !== "hybrid")) {
      throw new OhUsageError("search needs a bounded query and a valid mode.");
    }
    integer(one(parsed, "limit"), "limit", 1, 100);
  } else if (command === "recall") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "as-of", "author-log", "limit", "mode"]);
    assertPositionals(parsed, 1, 1024);
    const author = one(parsed, "author-log");
    if (author !== undefined && (author.length > 64 || /[\r\n]/u.test(author))) {
      throw new OhUsageError("--author-log needs one author name of at most 64 characters.");
    }
    const query = parsed.positionals.join(" ");
    const mode = one(parsed, "mode", "keyword");
    if (query.trim().length === 0 || query.length > 4096
      || (mode !== "keyword" && mode !== "semantic" && mode !== "hybrid")) {
      throw new OhUsageError("recall needs a bounded query and a valid mode.");
    }
    const asOf = one(parsed, "as-of");
    if (asOf !== undefined && parseCanonicalInstantV1(asOf) === null) throw new OhUsageError("--as-of needs a canonical UTC instant.");
    integer(one(parsed, "limit"), "limit", 1, 100);
  } else if (command === "put") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, ...MUTATION_OPTIONS,
      "depends-on", "file", "json", "key", "kind", "value"]);
    assertPositionals(parsed, 0);
    validateMutation(parsed);
    const key = parsedSafeCode(one(parsed, "key"), "--key", 512);
    const kind = one(parsed, "kind") as KnowledgeGraphRecordKindV1 | undefined;
    if (parsed.options.has("value") && parsed.options.has("json")) {
      throw new OhUsageError("Give the value once, with --value or --file.");
    }
    const inline = one(parsed, "value") ?? one(parsed, "json");
    const file = one(parsed, "file");
    if (kind === undefined || !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind)) {
      const guess = kind === undefined ? undefined : closestMatch(kind, OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1);
      throw new OhUsageError(kind === undefined ? "put needs --kind." : `Unknown record kind "${kind}".${guess === undefined ? "" : ` Did you mean "${guess}"?`}`);
    }
    if ((inline === undefined) === (file === undefined)) {
      throw new OhUsageError("put needs exactly one of --value or --file.");
    }
    const dependencies = (parsed.options.get("depends-on") ?? [])
      .map((dependency) => parsedSafeCode(dependency, "--depends-on", 512)).sort();
    const value = parseValue(inline ?? await readValueFile(file as string), inline === undefined ? "The file" : "The --value text");
    putRecord = createKnowledgeGraphRecordV1({ dependencies, key, kind, v: 1, value });
  } else if (command === "tombstone") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, ...MUTATION_OPTIONS]);
    assertPositionals(parsed, 1);
    parsedSafeCode(parsed.positionals[0], "Record key", 512);
    validateMutation(parsed);
  } else if (command === "sync") {
    assertPositionals(parsed, 1);
    const action = parsed.positionals[0];
    if (action === "export") {
      assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "after", "limit"]);
      integer(one(parsed, "after"), "after");
      integer(one(parsed, "limit"), "limit", 1, 1000);
    } else if (action === "import") {
      assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, "file"]);
      const file = one(parsed, "file");
      if (file === undefined) throw new OhUsageError("sync import needs --file.");
      syncBundle = parseOhSyncBundleV1(await readSyncBundleFile(file));
      if (syncBundle === null) throw new OhUsageError("Invalid sync bundle.");
    } else {
      throw new OhUsageError("sync needs export or import.");
    }
  } else {
    throw unknownCommand(command);
  }
  const common = validateCommon(parsed);
  if (syncBundle !== null && syncBundle.spaceId !== common.spaceId) {
    throw new OhUsageError("Invalid sync bundle.");
  }
  return { ...common, putRecord, syncBundle };
}

function print(value: unknown): void { process.stdout.write(`${canonicalJson(value)}\n`); }

function unknownCommand(command: string): OhUsageError {
  const guess = closestMatch(command, OH_COMMANDS);
  return new OhUsageError(`Unknown command "${command}".${guess === undefined ? "" : ` Did you mean "${guess}"?`}`, "oh --help");
}

function parseValue(text: string, label: string): JsonValue {
  try { return JSON.parse(text) as JsonValue; }
  catch { throw new OhUsageError(`${label} isn't valid JSON.`); }
}

async function readValueFile(path: string): Promise<string> {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new OhUsageError(`No file at ${path}.`);
    throw error;
  }
}

async function readSyncBundleFile(path: string): Promise<unknown> {
  // `sync export` writes one terminal LF after the bounded canonical bundle.
  const maximumFileBytes = OH_SYNC_BUNDLE_MAX_BYTES_V1 + 1;
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new OhUsageError(`No file at ${path}.`);
    throw error;
  });
  if (!metadata.isFile() || !Number.isSafeInteger(metadata.size)
    || metadata.size > maximumFileBytes) {
    throw new RangeError(`Sync bundle file must be a regular file of at most ${maximumFileBytes} bytes.`);
  }
  const contents = await readFile(path);
  if (contents.byteLength > maximumFileBytes) {
    throw new RangeError(`Sync bundle file must be at most ${maximumFileBytes} bytes.`);
  }
  return parseValue(contents.toString("utf8"), "The bundle file");
}

const DEFAULT_DATABASE = ".oh/oh.sqlite";

/** Quote a shell word only when it needs it, for next-step commands. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** The --db and --space options the person typed, repeated in next-step commands. */
function scopeFlags(parsed: ParsedArguments): string {
  return ["db", "space"].flatMap((name) => {
    const value = one(parsed, name);
    return value === undefined ? [] : [` --${name} ${shellWord(value)}`];
  }).join("");
}

type Output = Readonly<{ json: boolean; human: boolean; quiet: boolean }>;

function outputFor(json: boolean): Output {
  // TODO(df-0.8): use detectAudience from @hraness/desktop-foundation.
  const audience = detectAudience();
  return { human: audience === "human", json: json || audience === "agent", quiet: audience === "quiet" };
}

const style = () => ({ env: process.env, stream: process.stdout });
function hint(output: Output, next: string): void {
  if (output.human && !output.json) process.stderr.write(`Next: ${next}\n`);
}
function warn(output: Output, message: string): void {
  if (!output.json) process.stderr.write(`${sym("warn", process.stderr)} ${message}\n`);
}

function warnAboutMode(output: Output, mode: string | undefined): void {
  if (mode === "semantic") warn(output, "Semantic search isn't available in the CLI, so there are no results. Use keyword search instead.");
  if (mode === "hybrid") warn(output, "Semantic search isn't available in the CLI; showing keyword results only.");
}

function wantsHelp(arguments_: readonly string[]): boolean {
  return arguments_.includes("--help") || arguments_.includes("-h");
}

function printHelp(arguments_: readonly string[]): number | undefined {
  const [command, ...rest] = arguments_;
  const intro = () => terminalIntro({ isTTY: process.stdout.isTTY, columns: process.stdout.columns, term: process.env.TERM });
  if (command === undefined) {
    process.stdout.write(`${intro()}${bareScreen(OH_PACKAGE_VERSION)}`);
    return 0;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    if (rest.length > 1) throw new OhUsageError("help takes at most one command.", "oh --help");
    const topic = rest[0];
    if (topic === undefined) { process.stdout.write(`${intro()}${rootHelp()}`); return 0; }
    const text = commandHelp(topic);
    if (text === undefined) {
      const guess = closestMatch(topic, OH_HELP_TOPICS);
      throw new OhUsageError(`No help for "${topic}".${guess === undefined ? "" : ` Did you mean "${guess}"?`}`, "oh --help");
    }
    process.stdout.write(text);
    return 0;
  }
  if (command === "research" && (rest.length === 0 || rest[0] === "help" || wantsHelp(rest.slice(0, 1)))) {
    process.stdout.write(commandHelp("research") as string);
    return 0;
  }
  if (command !== "research" && wantsHelp(rest)) {
    const text = commandHelp(command);
    if (text === undefined) throw unknownCommand(command);
    process.stdout.write(text);
    return 0;
  }
  return undefined;
}

export async function runOhCli(arguments_: readonly string[]): Promise<number> {
  const helped = printHelp(arguments_);
  if (helped !== undefined) return helped;
  const command = arguments_[0] as string;
  if (command === "version" || command === "--version" || command === "-V") {
    const json = arguments_.length === 2 && arguments_[1] === "--json";
    if (arguments_.length !== (json ? 2 : 1)) throw new OhUsageError("version takes no arguments.", "oh --version");
    if (json) print({ name: "oh", version: OH_PACKAGE_VERSION });
    else process.stdout.write(`oh ${OH_PACKAGE_VERSION}\n`);
    return 0;
  }
  if (command === "research") {
    const { runOhResearchCli } = await import("./research-cli");
    try { return await runOhResearchCli(arguments_.slice(1)); }
    catch (error) {
      if (error instanceof TypeError && !(error instanceof OhUsageError)) throw new OhUsageError(error.message, "oh research --help");
      throw error;
    }
  }
  const parsed = parseArguments(arguments_.slice(1), command);
  const validated = await validateInvocation(command, parsed);
  if (command === "contract") {
    print({ manifest: OH_CONTRACT_MANIFEST_V1, sqliteSchemaVersion: OH_SQLITE_SCHEMA_VERSION, v: 1 });
    return 0;
  }
  const output = outputFor(parsed.json);
  const scope = scopeFlags(parsed);
  // Reads never create a store: only init, put and sync import may.
  const creates = command === "init" || command === "put" || (command === "sync" && parsed.positionals[0] === "import");
  if (!creates && validated.databasePath !== ":memory:" && !existsSync(validated.databasePath)) {
    throw new OhCliError(`No Oh store at ${validated.databasePath}.`, "no_store",
      validated.databasePath === DEFAULT_DATABASE ? "oh init" : `oh init --db ${shellWord(validated.databasePath)}`, 1);
  }
  const missing = (key: string) => new OhCliError(`No record named "${key}" in space ${validated.spaceId}.`,
    "not_found", `oh list${scope}`, 3);
  // Static commands and invalid input need no store or sync runtime.
  const { Oh } = await import("./sdk");
  const oh = Oh.open({ databasePath: validated.databasePath, spaceId: validated.spaceId });
  try {
    if (command === "init") {
      const head = oh.head();
      if (output.json) print({ head, spaceId: oh.store.spaceId, v: 1 });
      else process.stdout.write(renderInit(validated.databasePath, oh.store.spaceId, head, style()));
      hint(output, `oh put --kind entity --key entity:ada --value '{"name":"Ada"}'${scope}`);
      return 0;
    }
    if (command === "put") {
      const record = validated.putRecord;
      if (record === null) throw new OhUsageError("Invalid prepared put command.");
      const head = oh.head();
      const expectedGeneration = integer(one(parsed, "expected-generation"), "expected-generation");
      const operation = oh.store.commit({ actorId: one(parsed, "actor", "agent.local") as string,
        changes: [{ kind: "put", record, v: 1 }], expectedHead: { generation: expectedGeneration ?? head.generation,
          operationSha256: head.operationSha256 }, operationId: one(parsed, "operation") ?? opaqueId("op_") });
      if (output.json) print(operation);
      else process.stdout.write(renderPut(record.key, oh.head(), style()));
      hint(output, `oh get ${shellWord(record.key)}${scope}`);
      return 0;
    }
    if (command === "tombstone") {
      const key = parsed.positionals[0];
      if (key === undefined || parsed.positionals.length !== 1) throw new OhUsageError("tombstone needs one record key.");
      const head = oh.head();
      const expectedGeneration = integer(one(parsed, "expected-generation"), "expected-generation");
      const record = oh.get(key);
      if (record === null) throw missing(key);
      const operation = oh.store.commit({ actorId: one(parsed, "actor", "agent.local") as string,
        changes: [{ key, kind: "tombstone", priorSha256: record.recordSha256, v: 1 }],
        expectedHead: { generation: expectedGeneration ?? head.generation, operationSha256: head.operationSha256 },
        operationId: one(parsed, "operation") ?? opaqueId("op_") });
      if (output.json) print(operation);
      else process.stdout.write(renderTombstone(key, oh.head(), style()));
      return 0;
    }
    if (command === "get") {
      const key = parsed.positionals[0];
      if (key === undefined || parsed.positionals.length !== 1) throw new OhUsageError("get needs one record key.");
      const record = oh.get(key);
      if (record === null) throw missing(key);
      if (output.json) print(record);
      else process.stdout.write(renderRecord(record));
      return 0;
    }
    if (command === "list") {
      const kind = one(parsed, "kind") as KnowledgeGraphRecordKindV1 | undefined;
      if (kind !== undefined && !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind)) throw new OhUsageError("Unknown record kind.");
      const limit = integer(one(parsed, "limit"), "limit");
      const records = oh.list({ ...(kind === undefined ? {} : { kind }), ...(limit === undefined ? {} : { limit }) });
      if (output.json) print({ records, v: 1 });
      else process.stdout.write(renderList(records, oh.store.spaceId));
      if (records.length === 0) hint(output, `oh put --help`);
      return 0;
    }
    if (command === "log") {
      const operations = oh.store.log(integer(one(parsed, "limit"), "limit"));
      if (output.json) print({ operations, v: 1 });
      else process.stdout.write(renderLog(operations, oh.store.spaceId));
      return 0;
    }
    if (command === "search") {
      const query = parsed.positionals.join(" ");
      const mode = one(parsed, "mode", "keyword");
      if (query.length === 0 || (mode !== "keyword" && mode !== "semantic" && mode !== "hybrid")) throw new OhUsageError("search needs a query and a valid mode.");
      const limit = integer(one(parsed, "limit"), "limit");
      const response = await oh.search(query, { ...(limit === undefined ? {} : { limit }), mode });
      warnAboutMode(output, mode);
      if (output.json) print(response);
      else process.stdout.write(renderSearch(query, response));
      return 0;
    }
    if (command === "recall") {
      const query = parsed.positionals.join(" ");
      const mode = one(parsed, "mode", "keyword");
      if (query.length === 0 || (mode !== "keyword" && mode !== "semantic" && mode !== "hybrid")) throw new OhUsageError("recall needs a query and a valid mode.");
      const limit = integer(one(parsed, "limit"), "limit");
      const asOf = parseCanonicalInstantV1(one(parsed, "as-of"));
      const author = one(parsed, "author-log");
      if (author !== undefined) {
        const rendering = await oh.authorLog(query, { asOf, author, ...(limit === undefined ? {} : { limit }), mode });
        warnAboutMode(output, mode);
        if (output.json) print({ rendering, v: 1 });
        else process.stdout.write(`${rendering.text.replace(/\n*$/u, "")}\n`);
        return 0;
      }
      const resolved = asOf === null ? null : resolveRelativeDateWindowV1(query, asOf);
      const window = resolved === null ? null : { since: resolved.since, until: resolved.until, v: 1 as const };
      const recall = await oh.recall(query, { asOf, ...(limit === undefined ? {} : { limit }), mode, window });
      const rendering = renderOhRecallV1(recall, { asOf, budgetBytes: RECALL_RENDER_BUDGET_BYTES });
      warnAboutMode(output, mode);
      if (output.json) print({ recall, rendering, v: 1 });
      else process.stdout.write(rendering.text === "" ? `No records match "${query}".\n` : `${rendering.text.replace(/\n*$/u, "")}\n`);
      return 0;
    }
    if (command === "verify") {
      const verification = oh.verify();
      if (output.json) print(verification);
      else process.stdout.write(renderVerify(verification, style()));
      return 0;
    }
    if (command === "sync") {
      const action = parsed.positionals[0];
      if (action === "export") {
        const after = integer(one(parsed, "after"), "after") ?? 0;
        const limit = integer(one(parsed, "limit"), "limit") ?? 1000;
        // The bundle is a file format, so it is JSON for every audience.
        print(createOhSyncBundleV1(oh.store.spaceId, oh.store.exportOperations(after, limit), {
          largestFittingPrefix: true,
        })); return 0;
      }
      if (action === "import") {
        const bundle = validated.syncBundle;
        if (bundle === null) throw new OhUsageError("Invalid prepared sync import command.");
        const first = bundle.operations[0];
        if (first === undefined) {
          const head = oh.head();
          if (output.json) print({ head, imported: 0, v: 1 });
          else process.stdout.write(renderImport(0, head, style()));
          return 0;
        }
        const imported = oh.store.importOperations({
          expectedHead: {
            operationSha256: first.parentOperationSha256,
            sequence: first.sequence - 1,
          },
          operations: bundle.operations,
        });
        if (output.json) print({ head: imported.head, imported: imported.imported, v: 1 });
        else process.stdout.write(renderImport(imported.imported, imported.head, style()));
        return 0;
      }
      throw new OhUsageError("sync needs export or import.");
    }
    throw unknownCommand(command);
  } finally {
    await oh.close();
  }
}

type DescribedError = Readonly<{ code: string; exitCode: number; message: string; next: string }>;

function sentence(message: string): string {
  const text = message.trim();
  return /[.!?"]$/u.test(text) ? text : `${text}.`;
}

/** One sentence, one next command and an exit status for any error (SPEC § D5). */
export function describeOhCliError(error: unknown, arguments_: readonly string[]): DescribedError {
  const command = arguments_[0];
  const helpFor = command !== undefined && commandHelp(command) !== undefined ? `oh ${command} --help` : "oh --help";
  if (error instanceof OhCliError) {
    return { code: error.code, exitCode: error.exitCode, message: sentence(error.message), next: error.next };
  }
  if (error instanceof OhUsageError) {
    return { code: "usage", exitCode: 2, message: sentence(error.message), next: error.next ?? helpFor };
  }
  return { code: "failed", exitCode: 1, message: sentence(error instanceof Error ? error.message : String(error)), next: helpFor };
}

/** `--json` as the output flag. In `oh put`, `--json VALUE` is the record value instead. */
function asksForJson(arguments_: readonly string[]): boolean {
  return arguments_.some((argument, index) => argument === "--json" && (arguments_[0] !== "put"
    || arguments_[index + 1] === undefined || arguments_[index + 1]!.startsWith("--")));
}

/** The support command prefix: `oh` when the first `oh` on PATH runs this file, else the full path. */
export function supportCommandPrefix(script = process.argv[1] ?? "", path = process.env.PATH ?? ""): string[] {
  const fallback = [process.execPath, script];
  let target: string;
  try { target = realpathSync(script); } catch { return fallback; }
  for (const directory of path.split(delimiter)) {
    if (directory === "") continue;
    let found: string;
    try { found = realpathSync(join(directory, "oh")); } catch { continue; }
    // The shell runs the first `oh`; a later match would not be what `oh` means.
    return found === target ? ["oh"] : fallback;
  }
  return fallback;
}

export async function runOhMain(): Promise<void> {
  const args = process.argv.slice(2);
  // A closed pipe (`oh list | head -1`) is a normal way to stop reading.
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  const { runOhSupportCommand, showOhSupportInvitation, standaloneSupportEnvironment } = await import("./support");
  const options = { env: standaloneSupportEnvironment(), command: supportCommandPrefix() };
  const run = async () => {
    if (args[0] === "support") return runOhSupportCommand(args.slice(1), options);
    const code = await runOhCli(args);
    await showOhSupportInvitation(args, code, options);
    return code;
  };
  await run().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    const described = describeOhCliError(error, args);
    if (asksForJson(args) || detectAudience() === "agent") {
      print({ error: { code: described.code, message: described.message, next: described.next }, ok: false });
    } else {
      process.stderr.write(`${sym("fail", process.stderr)} ${described.message}\n${sym("next", process.stderr)} ${described.next}\n`);
      if (process.env.HRANESS_DEBUG === "1" && error instanceof Error && error.stack !== undefined) {
        process.stderr.write(`  code: ${described.code}\n${error.stack}\n`);
      }
    }
    process.exitCode = described.exitCode;
  });
}

// Source execution stays manual and retains dependency-free discovery. The
// packaged executable enters through cli-entry.ts before loading this module.
if (import.meta.main) await runOhMain();
