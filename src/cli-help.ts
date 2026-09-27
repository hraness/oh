// Help text for the oh CLI (SPEC § D2, § D3). The bare screen and root help
// stay short; every command has its own block for `oh <command> --help`.

import { OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1 } from "./graph";

/** Oh's one-line description from the portfolio registry, wrapped to 80 columns. */
export const OH_DESCRIPTION = `Oh is open-source memory for agents that stores each fact with its sources
and every change in a history you can replay.`;

export const OH_COMMANDS = [
  "init", "put", "get", "list", "log", "search", "recall", "tombstone", "verify",
  "sync", "contract", "version", "research", "support", "help",
] as const;

function wrap(words: readonly string[], indent: string, width = 80): string {
  const lines: string[] = [];
  let line = indent;
  for (const word of words) {
    const next = line.trim() === "" ? `${indent}${word}` : `${line} ${word}`;
    if (next.length > width && line.trim() !== "") {
      lines.push(line);
      line = `${indent}${word}`;
    } else line = next;
  }
  if (line.trim() !== "") lines.push(line);
  return lines.join("\n");
}

const KINDS = wrap(OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1.map((kind, index, all) =>
  index === all.length - 1 ? kind : `${kind},`), "  ");

export function bareScreen(version: string): string {
  return `${OH_DESCRIPTION}

Start here
  oh init                      Create a store in .oh/oh.sqlite
  oh put --kind entity --key entity:ada --value '{"name":"Ada"}'
                               Save a record
  oh get entity:ada            Print one record
  oh search Ada                Find records by keyword
  oh verify                    Replay the history and check the store

All commands: oh --help · Command help: oh help <command>
oh ${version}
`;
}

export function rootHelp(): string {
  return `Usage: oh <command> [options]

${OH_DESCRIPTION}

Start here
  oh init                      Create the store and its space
  oh put [options]             Save a record (oh put --help)
  oh get <key>                 Print one record
  oh search <query>            Find records by keyword
  oh verify                    Replay the history and check the store

Read
  oh list                      List current records
  oh log                       List recent changes
  oh recall <question>         Find records for a question, with dates like
                               "last week" read against --as-of

Change
  oh tombstone <key>           Remove a record; its history stays in the log
  oh sync export               Print the changes as a bundle for another store
  oh sync import --file <path> Apply a bundle made by oh sync export

More
  oh contract                  Print the data format versions this build uses
  oh version                   Print the version
  oh research                  Offline research tools (oh research --help)

Options
  --db <path>       Store file (default .oh/oh.sqlite)
  --space <id>      Space in the store (default "default")
  --json            Print JSON (the default when an agent runs oh)
  -h, --help        Show help (also: oh <command> --help)
  -V, --version     Show the version

Optional support: oh support · Turn off: HRANESS_SUPPORT=off
`;
}

const STORE_OPTIONS = `  --db <path>       Store file (default .oh/oh.sqlite)
  --space <id>      Space in the store (default "default")
  --json            Print JSON`;

const WRITE_OPTIONS = `  --actor <id>      Name recorded with the change (default agent.local)
  --operation <id>  Reuse the same ID to retry a write safely
  --expected-generation <n>
                    Write only if the space is still at generation n`;

const COMMAND_HELP: Readonly<Record<string, string>> = {
  init: `Usage: oh init [options]

Create the store file and its space if they don't exist yet, then print the
space's current generation. Running it again changes nothing.

Options
${STORE_OPTIONS}

Example
  oh init --db research.db
`,
  put: `Usage: oh put --kind <kind> --key <key> (--value <json> | --file <path>)

Save a record. A record with the same key is replaced, and the change is
added to the history.

Options
  --kind <kind>     Record kind (see below)
  --key <key>       Record key, such as entity:ada
  --value <json>    The record's value as JSON
  --file <path>     Read the value from a JSON file instead
  --depends-on <key>
                    A record this one depends on (repeatable)
${WRITE_OPTIONS}
${STORE_OPTIONS}

Record kinds
${KINDS}

Example
  oh put --kind entity --key entity:ada --value '{"name":"Ada Lovelace"}'
`,
  get: `Usage: oh get <key> [options]

Print one record. Exits 3 when no current record has that key.

Options
${STORE_OPTIONS}

Example
  oh get entity:ada
`,
  list: `Usage: oh list [options]

List current records, 50 at a time unless you pass --limit.

Options
  --kind <kind>     Only records of this kind
  --limit <n>       How many to list, 1 to 1000 (default 50)
${STORE_OPTIONS}

Example
  oh list --kind entity
`,
  log: `Usage: oh log [options]

List the most recent changes in the history, newest first.

Options
  --limit <n>       How many to list, 1 to 1000 (default 50)
${STORE_OPTIONS}

Example
  oh log --limit 10
`,
  search: `Usage: oh search <query> [options]

Find records by keyword.

Options
  --limit <n>       How many results, 1 to 100 (default 10)
${STORE_OPTIONS}

Example
  oh search "mathematician"
`,
  recall: `Usage: oh recall <question> [options]

Find records for a question and print them as text for a model to read.
With --as-of, dates such as "last week" in the question narrow the results.

Options
  --as-of <instant> The question's date, a UTC instant with milliseconds,
                    such as 2026-01-08T12:00:00.000Z
  --limit <n>       How many results, 1 to 100 (default 10)
  --author-log <name>
                    Print every message whose speaker is <name>, in date
                    order, followed by the other speakers' matching records
${STORE_OPTIONS}

Examples
  oh recall "what did Ada build last week" --as-of 2026-01-08T12:00:00.000Z
  oh recall "where do I live" --as-of 2026-01-08T12:00:00.000Z --author-log user
`,
  tombstone: `Usage: oh tombstone <key> [options]

Remove a record. Its earlier versions stay in the history. Exits 3 when no
current record has that key.

Options
${WRITE_OPTIONS}
${STORE_OPTIONS}

Example
  oh tombstone entity:ada
`,
  verify: `Usage: oh verify [options]

Check the store: run SQLite's integrity checks and replay every change in the
history to confirm it produces the same records.

Options
${STORE_OPTIONS}

Example
  oh verify --db research.db
`,
  sync: `Usage: oh sync export [options]
       oh sync import --file <path> [options]

Copy changes between stores. export prints a bundle of changes as JSON;
import checks a bundle and applies all of it or none of it.

Options
  --after <n>       export: start after change number n (default 0)
  --limit <n>       export: at most n changes, 1 to 1000 (default 1000)
  --file <path>     import: the bundle file
  --db <path>       Store file (default .oh/oh.sqlite)
  --space <id>      Space in the store (default "default")
  --json            Print JSON (import)

Example
  oh sync export --db a.db > changes.json
  oh sync import --db b.db --file changes.json
`,
  contract: `Usage: oh contract

Print, as JSON, the data format versions this build of Oh reads and writes.
A store made by a different format version won't open.
`,
  version: `Usage: oh version [--json]

Print the version. Same as oh --version.
`,
  research: `Usage: oh research <command> [--file <path>]

Offline research tools. They read no store and use no network, and print
JSON.

Catalogs
  oh research catalog-v9                  The knowledge domain catalog
  oh research wikidata-mappings-v3        The Wikidata mapping catalog

Check and prepare
  oh research validate-draft --file <path>
                                          Check a knowledge proposal draft
  oh research prepare-packet --file <path>
                                          Build a research packet
  oh research verify-packet --file <path> Check a research packet
  oh research wikidata-preview --file <path>
                                          Preview a Wikidata import
  oh research wikidata-mapping-preview-v2 --file <path>
                                          Preview a Wikidata mapping

Earlier catalog and preview versions (catalog through catalog-v8,
wikidata-mappings, wikidata-mappings-v2, wikidata-mapping-preview) still
work for existing scripts.
`,
};

/** Per-command help, or undefined when `command` has none. */
export function commandHelp(command: string): string | undefined {
  return Object.hasOwn(COMMAND_HELP, command) ? COMMAND_HELP[command] : undefined;
}

export const OH_HELP_TOPICS = Object.freeze(Object.keys(COMMAND_HELP));
