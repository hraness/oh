// Text output for people (SPEC § D7). Agents and --json get canonical JSON
// instead; these renderers never decide which one to use.

import type { KnowledgeGraphRecordV1 } from "./graph";
import type { OhOperationV1 } from "./operation";
import type { OhSearchResponseV1 } from "./search";
import { sym, type Env, type Stream } from "./cli-style";

type Head = Readonly<{ generation: number }>;
type Output = Readonly<{ stream: Stream; env: Env }>;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function renderInit(databasePath: string, spaceId: string, head: Head, output: Output): string {
  return `${sym("ok", output.stream, output.env)} Store ready at ${databasePath}, space ${spaceId}, generation ${head.generation}.\n`;
}

export function renderPut(key: string, head: Head, output: Output): string {
  return `${sym("ok", output.stream, output.env)} Saved ${key} (generation ${head.generation}).\n`;
}

export function renderTombstone(key: string, head: Head, output: Output): string {
  return `${sym("ok", output.stream, output.env)} Removed ${key} (generation ${head.generation}). Its history stays in the log.\n`;
}

export function renderRecord(record: KnowledgeGraphRecordV1): string {
  const lines = [`${record.key} (${record.kind})`, JSON.stringify(record.value, null, 2)];
  if (record.dependencies.length !== 0) lines.push(`Depends on: ${record.dependencies.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

function columns(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, index) => { widths[index] = Math.max(widths[index] ?? 0, cell.length); });
  return rows.map((row) => row.map((cell, index) => index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))
    .join("  ")).join("\n") + "\n";
}

export function renderList(records: readonly KnowledgeGraphRecordV1[], spaceId: string): string {
  if (records.length === 0) return `No records in space ${spaceId}.\n`;
  return columns(records.map((record) => [record.key, record.kind]));
}

function describeChanges(operation: OhOperationV1): string {
  return operation.changes.map((change) => change.kind === "put"
    ? `put ${change.record.key}` : `tombstone ${change.key}`).join(", ");
}

export function renderLog(operations: readonly OhOperationV1[], spaceId: string): string {
  if (operations.length === 0) return `No changes in space ${spaceId} yet.\n`;
  return columns(operations.map((operation) => [
    `#${operation.sequence}`, operation.instant, operation.actorId, describeChanges(operation),
  ]));
}

export function renderSearch(query: string, response: OhSearchResponseV1): string {
  if (response.results.length === 0) return `No records match "${query}".\n`;
  return columns(response.results.map((result, index) => [`${index + 1}.`, result.record.key, result.record.kind]));
}

export function renderVerify(result: Readonly<{ head: Head; operations: number; records: number }>, output: Output): string {
  return `${sym("ok", output.stream, output.env)} Store checked: ${plural(result.records, "record")} and ${plural(result.operations, "change")} replay to the same state (generation ${result.head.generation}).\n`;
}

export function renderImport(imported: number, head: Head, output: Output): string {
  return imported === 0
    ? `${sym("ok", output.stream, output.env)} Nothing to import; the store already has these changes.\n`
    : `${sym("ok", output.stream, output.env)} Imported ${plural(imported, "change")} (generation ${head.generation}).\n`;
}
