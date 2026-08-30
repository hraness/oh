#!/usr/bin/env bun
import { readFile } from "node:fs/promises";

import { canonicalJson, opaqueId, safeCode, type JsonValue } from "./canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import { OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1, createKnowledgeGraphRecordV1,
  type KnowledgeGraphRecordKindV1, type KnowledgeGraphRecordV1 } from "./graph";
import { Oh } from "./sdk";
import { OH_SQLITE_SCHEMA_VERSION } from "./sqlite/migrations";
import { createOhSyncBundleV1, parseOhSyncBundleV1 } from "./sync";

export const OH_PACKAGE_VERSION = "0.2.0" as const;

type ParsedArguments = { options: Map<string, string[]>; positionals: string[] };
type ValidatedInvocation = Readonly<{
  databasePath: string;
  putRecord: KnowledgeGraphRecordV1 | null;
  spaceId: string;
  syncBundle: NonNullable<ReturnType<typeof parseOhSyncBundleV1>> | null;
}>;

const KNOWN_OPTIONS = new Set([
  "actor", "after", "db", "depends-on", "expected-generation", "file",
  "json", "key", "kind", "limit", "mode", "operation", "space",
]);
const GLOBAL_OPTIONS = ["db", "space"] as const;
const MUTATION_OPTIONS = ["actor", "expected-generation", "operation"] as const;

function parseArguments(arguments_: readonly string[]): ParsedArguments {
  const options = new Map<string, string[]>();
  const positionals: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index] as string;
    if (!argument.startsWith("--")) {
      if (argument.startsWith("-")) throw new TypeError(`Unknown option: ${argument}`);
      positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
    const next = equals === -1 ? arguments_[index + 1] : argument.slice(equals + 1);
    if (!KNOWN_OPTIONS.has(name)) throw new TypeError(`Unknown option: --${name}`);
    if (next === undefined || next.length === 0 || (equals === -1 && next.startsWith("--"))) {
      throw new TypeError(`Option --${name} needs a value.`);
    }
    if (equals === -1) index += 1;
    const current = options.get(name) ?? [];
    if (name !== "depends-on" && current.length !== 0) {
      throw new TypeError(`Option --${name} may appear only once.`);
    }
    options.set(name, [...current, next]);
  }
  return { options, positionals };
}

function one(parsed: ParsedArguments, name: string, fallback?: string): string | undefined {
  const values = parsed.options.get(name);
  return values?.[0] ?? fallback;
}

function integer(value: string | undefined, name: string, minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`--${name} must be a canonical integer from ${minimum} through ${maximum}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`--${name} must be a canonical integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function assertAllowedOptions(parsed: ParsedArguments, allowed: readonly string[]): void {
  const admitted = new Set(allowed);
  for (const name of parsed.options.keys()) {
    if (!admitted.has(name)) throw new TypeError(`Option --${name} is not valid for this command.`);
  }
}

function assertPositionals(parsed: ParsedArguments, minimum: number, maximum = minimum): void {
  if (parsed.positionals.length < minimum || parsed.positionals.length > maximum) {
    throw new TypeError(`This command needs ${minimum === maximum ? String(minimum) : `${minimum} through ${maximum}`} positional argument${maximum === 1 ? "" : "s"}.`);
  }
}

function parsedSafeCode(value: string | undefined, label: string, maximum = 128): string {
  const parsed = safeCode(value, maximum);
  if (parsed === null) throw new TypeError(`${label} is invalid.`);
  return parsed;
}

function validateCommon(parsed: ParsedArguments): Pick<ValidatedInvocation, "databasePath" | "spaceId"> {
  const databasePath = one(parsed, "db", ".oh/oh.sqlite") as string;
  if (databasePath.length === 0 || databasePath.length > 4096 || databasePath.includes("\0")) {
    throw new TypeError("--db is invalid.");
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
      throw new TypeError("Unknown record kind.");
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
      throw new TypeError("search needs a bounded query and a valid mode.");
    }
    integer(one(parsed, "limit"), "limit", 1, 100);
  } else if (command === "put") {
    assertAllowedOptions(parsed, [...GLOBAL_OPTIONS, ...MUTATION_OPTIONS,
      "depends-on", "file", "json", "key", "kind"]);
    assertPositionals(parsed, 0);
    validateMutation(parsed);
    const key = parsedSafeCode(one(parsed, "key"), "--key", 512);
    const kind = one(parsed, "kind") as KnowledgeGraphRecordKindV1 | undefined;
    const inline = one(parsed, "json");
    const file = one(parsed, "file");
    if (kind === undefined || !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind)
      || (inline === undefined) === (file === undefined)) {
      throw new TypeError("put needs --key, a valid --kind, and exactly one of --json or --file.");
    }
    const dependencies = (parsed.options.get("depends-on") ?? [])
      .map((dependency) => parsedSafeCode(dependency, "--depends-on", 512)).sort();
    const value = JSON.parse(inline ?? await readFile(file as string, "utf8")) as JsonValue;
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
      if (file === undefined) throw new TypeError("sync import needs --file.");
      syncBundle = parseOhSyncBundleV1(JSON.parse(await readFile(file, "utf8")));
      if (syncBundle === null) throw new TypeError("Invalid sync bundle.");
    } else {
      throw new TypeError("sync needs export or import.");
    }
  } else {
    throw new TypeError(`Unknown command: ${command}`);
  }
  const common = validateCommon(parsed);
  if (syncBundle !== null && syncBundle.spaceId !== common.spaceId) {
    throw new TypeError("Invalid sync bundle.");
  }
  return { ...common, putRecord, syncBundle };
}

function print(value: unknown): void { process.stdout.write(`${canonicalJson(value)}\n`); }

const HELP = `oh ${OH_PACKAGE_VERSION}

Usage:
  oh init [--db PATH] [--space ID]
  oh put --kind KIND --key KEY (--json JSON | --file PATH) [--depends-on KEY]
  oh get KEY
  oh list [--kind KIND] [--limit N]
  oh log [--limit N]
  oh search QUERY [--mode keyword|semantic|hybrid] [--limit N]
  oh tombstone KEY
  oh verify
  oh sync export [--after N] [--limit N]
  oh sync import --file PATH
  oh contract
  oh version

Global options: --db PATH (default .oh/oh.sqlite), --space ID (default default)
Mutation options: --actor ID, --operation ID, --expected-generation N
`;

export async function runOhCli(arguments_: readonly string[]): Promise<number> {
  const command = arguments_[0];
  if (command === undefined || command === "help" || command === "--help") {
    if (arguments_.length > 1) throw new TypeError("help does not accept arguments or options.");
    process.stdout.write(HELP);
    return 0;
  }
  if (command === "version" || command === "--version") {
    if (arguments_.length !== 1) throw new TypeError("version does not accept arguments or options.");
    process.stdout.write(`${OH_PACKAGE_VERSION}\n`);
    return 0;
  }
  const parsed = parseArguments(arguments_.slice(1));
  const validated = await validateInvocation(command, parsed);
  if (command === "contract") {
    print({ manifest: OH_CONTRACT_MANIFEST_V1, sqliteSchemaVersion: OH_SQLITE_SCHEMA_VERSION, v: 1 });
    return 0;
  }
  const oh = Oh.open({ databasePath: validated.databasePath, spaceId: validated.spaceId });
  try {
    if (command === "init") { print({ head: oh.head(), spaceId: oh.store.spaceId, v: 1 }); return 0; }
    if (command === "put") {
      const record = validated.putRecord;
      if (record === null) throw new TypeError("Invalid prepared put command.");
      const head = oh.head();
      const expectedGeneration = integer(one(parsed, "expected-generation"), "expected-generation");
      const operation = oh.store.commit({ actorId: one(parsed, "actor", "agent.local") as string,
        changes: [{ kind: "put", record, v: 1 }], expectedHead: { generation: expectedGeneration ?? head.generation,
          operationSha256: head.operationSha256 }, operationId: one(parsed, "operation") ?? opaqueId("op_") });
      print(operation); return 0;
    }
    if (command === "tombstone") {
      const key = parsed.positionals[0];
      if (key === undefined || parsed.positionals.length !== 1) throw new TypeError("tombstone needs one record key.");
      const head = oh.head();
      const expectedGeneration = integer(one(parsed, "expected-generation"), "expected-generation");
      const record = oh.get(key);
      if (record === null) return 3;
      const operation = oh.store.commit({ actorId: one(parsed, "actor", "agent.local") as string,
        changes: [{ key, kind: "tombstone", priorSha256: record.recordSha256, v: 1 }],
        expectedHead: { generation: expectedGeneration ?? head.generation, operationSha256: head.operationSha256 },
        operationId: one(parsed, "operation") ?? opaqueId("op_") });
      print(operation); return 0;
    }
    if (command === "get") {
      const key = parsed.positionals[0];
      if (key === undefined || parsed.positionals.length !== 1) throw new TypeError("get needs one record key.");
      const record = oh.get(key);
      if (record === null) return 3;
      print(record); return 0;
    }
    if (command === "list") {
      const kind = one(parsed, "kind") as KnowledgeGraphRecordKindV1 | undefined;
      if (kind !== undefined && !OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.includes(kind)) throw new TypeError("Unknown record kind.");
      const limit = integer(one(parsed, "limit"), "limit");
      print({ records: oh.list({ ...(kind === undefined ? {} : { kind }), ...(limit === undefined ? {} : { limit }) }), v: 1 });
      return 0;
    }
    if (command === "log") { print({ operations: oh.store.log(integer(one(parsed, "limit"), "limit")), v: 1 }); return 0; }
    if (command === "search") {
      const query = parsed.positionals.join(" ");
      const mode = one(parsed, "mode", "keyword");
      if (query.length === 0 || (mode !== "keyword" && mode !== "semantic" && mode !== "hybrid")) throw new TypeError("search needs a query and a valid mode.");
      const limit = integer(one(parsed, "limit"), "limit");
      print(await oh.search(query, { ...(limit === undefined ? {} : { limit }), mode })); return 0;
    }
    if (command === "verify") { print(oh.verify()); return 0; }
    if (command === "sync") {
      const action = parsed.positionals[0];
      if (action === "export") {
        const after = integer(one(parsed, "after"), "after") ?? 0;
        const limit = integer(one(parsed, "limit"), "limit") ?? 1000;
        print(createOhSyncBundleV1(oh.store.spaceId, oh.store.exportOperations(after, limit))); return 0;
      }
      if (action === "import") {
        const bundle = validated.syncBundle;
        if (bundle === null) throw new TypeError("Invalid prepared sync import command.");
        let imported = 0;
        for (const operation of bundle.operations) if (oh.store.importOperation(operation).imported) imported += 1;
        print({ head: oh.head(), imported, v: 1 }); return 0;
      }
      throw new TypeError("sync needs export or import.");
    }
    throw new TypeError(`Unknown command: ${command}`);
  } finally {
    await oh.close();
  }
}

if (import.meta.main) {
  runOhCli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`oh: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
