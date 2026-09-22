/** Pinned CloneMem adapter. Retrieval receives only trace and question fields;
 * multiple-choice keys and evidence references are projected into a separate scorer.
 * Native prompt/rendering adapted from AvatarMemory/CloneMemBench (Apache-2.0),
 * revision 753d8a97fd78f4ee25af398a0f0c8d981a6be304, eval/run_generation.py. */
import { lstat, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import sourcePin from "../../benchmarks/profiles/clonemem-source-v1.json";
import { ROOT, writeNew } from "./io";
import type { Message } from "./model";

export const CLONEMEM_SOURCE = sourcePin;
export const CLONEMEM_CACHE = join(ROOT, ".cache/benchmarks/clonemem-source", sourcePin.revision);
export const CLONEMEM_PRIMARY_PERSON_IDS = Object.freeze(sourcePin.files
  .filter(file => file.personId !== sourcePin.excludedPrimaryPersonId).map(file => file.personId).sort());
export type CloneMemTrace = Readonly<{ id: string; medium: string; date: string; content: string }>;
export type CloneMemChoice = Readonly<{ id: string; text: string }>;
export type CloneMemQuery = Readonly<{ id: string; localId: string; personId: string;
  question: string; questionDate: string }>;
export type CloneMemReaderQuestion = CloneMemQuery & Readonly<{ personName: string; choices: readonly CloneMemChoice[] }>;
export type CloneMemMemory = Readonly<{ personId: string; personName: string; traces: readonly CloneMemTrace[] }>;
export type CloneMemScorerRow = Readonly<{ questionId: string; personId: string; category: string;
  correctChoiceId: string; evidenceGroups: readonly (readonly string[])[] }>;
export type CloneMemProjection = Readonly<{ memory: CloneMemMemory; queries: readonly CloneMemQuery[];
  readerQuestions: readonly CloneMemReaderQuestion[]; scorer: readonly CloneMemScorerRow[];
  sourceSha256: string; retrievalSha256: string; readerSha256: string; scorerSha256: string }>;

function fail(reason: string): never { throw new TypeError(`CloneMem: ${reason}.`); }
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value) || !hasExactKeys(value, [...keys])) fail("unexpected record fields");
  return value;
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== "string" || value.length > maximum || Buffer.byteLength(value) > maximum
    || /\p{Surrogate}/u.test(value) || (!empty && value.trim().length === 0)) fail("bounded scalar text required");
  return value;
}
function list(value: unknown, maximum: number, empty = false): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || (!empty && value.length === 0)) fail("array bound");
  return value;
}
function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) fail("duplicate identity");
}

/** Released traces are naive ISO seconds; six primary questions append Z.
 * Treat both spellings as UTC explicitly, avoiding host timezone dependence
 * and upstream Python's naive/aware comparison failure on the latter six. */
export function cloneMemTimestamp(value: string): number {
  if (typeof value !== "string") fail("timestamp grammar");
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z?$/.exec(value);
  if (parts === null) fail("timestamp grammar");
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number) as [number, number, number, number, number, number];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) fail("timestamp calendar");
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second, 0);
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) fail("timestamp calendar");
  return instant.getTime();
}

/** Native temporal admission precedes indexing and candidate limits. Never
 * index later traces and filter a short result list after retrieval. */
export function eligibleCloneMemMemory(memory: CloneMemMemory, questionDate: string): CloneMemMemory {
  const cutoff = cloneMemTimestamp(questionDate);
  return { personId: memory.personId, personName: memory.personName,
    traces: memory.traces.filter(trace => cloneMemTimestamp(trace.date) <= cutoff) };
}

/** The actual release uses qa_items and evidence[].digital_trace_ids. The
 * released scorer's related_media_id spelling is normalized explicitly here. */
export function projectCloneMem(value: unknown, rawSha256: string): CloneMemProjection {
  if (!/^[a-f0-9]{64}$/.test(rawSha256)) fail("source digest");
  const root = record(value, ["person_name", "person_id", "context", "qa_items"]);
  const personId = text(root.person_id, 128), personName = text(root.person_name, 512);
  const traces = list(root.context, 2_000).map(raw => {
    const trace = record(raw, ["id", "medium", "event_date", "content"]);
    const date = text(trace.event_date, 512);
    cloneMemTimestamp(date);
    return { id: text(trace.id, 256), medium: text(trace.medium, 256),
      date, content: text(trace.content, 65_536) };
  });
  unique(traces.map(trace => trace.id));
  const traceIds = new Set(traces.map(trace => trace.id));
  const queries: CloneMemQuery[] = [], readerQuestions: CloneMemReaderQuestion[] = [], scorer: CloneMemScorerRow[] = [];
  for (const raw of list(root.qa_items, 512)) {
    const item = record(raw, ["id", "question", "question_type", "question_time", "answer", "dimension",
      "digital_trace_ids", "evidence", "choices", "correct_choice_id"]);
    const localId = text(item.id, 256);
    const questionDate = text(item.question_time, 512);
    cloneMemTimestamp(questionDate);
    const query = { id: `${personId}:${localId}`, localId, personId,
      question: text(item.question, 16_384), questionDate };
    const choices = list(item.choices, 8).map(rawChoice => {
      const choice = record(rawChoice, ["id", "text"]);
      const id = text(choice.id, 16);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) fail("choice ID grammar");
      return { id, text: text(choice.text, 16_384) };
    });
    unique(choices.map(choice => choice.id.trim().toUpperCase()));
    const correctChoiceId = text(item.correct_choice_id, 16).trim().toUpperCase();
    if (!choices.some(choice => choice.id.trim().toUpperCase() === correctChoiceId)) fail("unknown correct choice");
    const evidenceGroups = list(item.evidence, 256, true).map(rawEvidence => {
      const evidence = record(rawEvidence, ["statement", "digital_trace_ids"]);
      text(evidence.statement, 65_536, true);
      const ids = list(evidence.digital_trace_ids, 2_000, true).map(id => text(id, 256));
      if (ids.some(id => !traceIds.has(id))) fail("unknown evidence reference");
      return [...new Set(ids)];
    });
    queries.push(query);
    readerQuestions.push({ ...query, personName, choices });
    scorer.push({ questionId: query.id, personId, category: text(item.question_type, 256), correctChoiceId, evidenceGroups });
  }
  unique(queries.map(query => query.id));
  const memory = { personId, personName, traces };
  return { memory, queries, readerQuestions, scorer, sourceSha256: rawSha256,
    retrievalSha256: canonicalSha256({ memory, queries }), readerSha256: canonicalSha256(readerQuestions),
    scorerSha256: canonicalSha256(scorer) };
}

export async function readCloneMemPersona(personId: string): Promise<CloneMemProjection> {
  const pin = sourcePin.files.find(file => file.personId === personId);
  if (pin === undefined) fail("unknown pinned persona");
  const path = join(CLONEMEM_CACHE, basename(pin.path));
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== pin.bytes) fail("source type or pinned byte count");
  const bytes = await readFile(path);
  if (bytes.length !== pin.bytes || sha256Hex(bytes) !== pin.sha256) fail("source checksum");
  const projected = projectCloneMem(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), pin.sha256);
  if (projected.memory.personId !== pin.personId || projected.memory.traces.length !== pin.traces
    || projected.queries.length !== pin.questions) fail("source identity or count");
  return projected;
}

/** Explicit acquisition only. No evaluation or reader construction downloads. */
export async function fetchCloneMemPrimary(): Promise<void> {
  for (const pin of sourcePin.files.filter(file => CLONEMEM_PRIMARY_PERSON_IDS.includes(file.personId))) {
    const path = join(CLONEMEM_CACHE, basename(pin.path));
    try { await lstat(path); await readCloneMemPersona(pin.personId); continue; }
    catch (error) { if (!(isPlainRecord(error) && error.code === "ENOENT")
      && !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    const response = await fetch(`https://raw.githubusercontent.com/AvatarMemory/CloneMemBench/${sourcePin.revision}/${pin.path}`,
      { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || response.body === null) fail(`download HTTP ${response.status}`);
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > pin.bytes) fail("download exceeded pinned size");
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    const bytes = Buffer.concat(chunks, size);
    if (size !== pin.bytes || sha256Hex(bytes) !== pin.sha256) fail("download checksum");
    projectCloneMem(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), pin.sha256);
    await writeNew(path, bytes);
  }
}

/** Native sequential whole-trace rendering, without subquestion decomposition. */
export function renderCloneMemEvidence(memory: CloneMemMemory, rankedIds: readonly string[], k = 10): string {
  if (!Number.isSafeInteger(k) || k < 1 || k > 100 || rankedIds.length > 2_000) fail("ranking bounds");
  unique(rankedIds);
  const traces = new Map(memory.traces.map(trace => [trace.id, trace]));
  return rankedIds.slice(0, k).map((id, index) => {
    const trace = traces.get(id);
    if (trace === undefined) fail("unknown ranked trace");
    return `---- idx ${index + 1} ----\n${trace.content.trim()}`;
  }).join("\n\n");
}

/** Exact upstream choice prompt, including its original wording. */
export function makeCloneMemChoiceMessages(question: Pick<CloneMemReaderQuestion, "question" | "personName" | "choices">, evidenceText: string): readonly Message[] {
  text(evidenceText, 96 * 1024, true);
  const choices = question.choices.map(choice => `${choice.id}. ${choice.text}`).join("\n");
  return [{ role: "user", content: `You are playing the role of ${question.personName}, answering some questions on his behalf. Your answers must be strictly based on the provided reference memories (from ${question.personName} himself/herself). Respond with only the option ID (e.g., A, B, C, D).

Memories:
${evidenceText}

Question: ${question.question}

Options:
${choices}

Correct Option ID:` }];
}

/** Native flat union recall. Cut ranks before deduplication, matching upstream. */
export function cloneMemRecallAtK(row: CloneMemScorerRow, rankedIds: readonly string[], k = 10): number | null {
  if (!Number.isSafeInteger(k) || k < 1 || k > 100 || rankedIds.length > 2_000) fail("scoring rank bound");
  const gold = new Set(row.evidenceGroups.flat()), retrieved = new Set(rankedIds.slice(0, k));
  return gold.size === 0 ? null : [...gold].filter(id => retrieved.has(id)).length / gold.size;
}
export function cloneMemChoiceCorrect(row: CloneMemScorerRow, prediction: string | null): number {
  return prediction !== null && Buffer.byteLength(prediction) <= 16_384
    && prediction.trim().toUpperCase() === row.correctChoiceId.trim().toUpperCase() ? 1 : 0;
}

/** Predeclared source-only persona-balanced draw. Never sees categories or keys. */
export function selectCloneMemReaderQuestions(questions: readonly CloneMemReaderQuestion[], count: number, seed = 17): readonly CloneMemReaderQuestion[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > questions.length || count > 300) fail("selection count");
  unique(questions.map(question => question.id));
  const rank = (id: string) => sha256Hex(`oh.clonemem.reader-draw.v1:${seed}:${id}`);
  const compare = (a: string, b: string) => rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0;
  const groups = [...new Set(questions.map(question => question.personId))].sort(compare);
  const byGroup = new Map(groups.map(group => [group, questions.filter(question => question.personId === group)
    .sort((a, b) => compare(a.id, b.id))]));
  const selected: CloneMemReaderQuestion[] = [];
  for (let index = 0; selected.length < count; index++) for (const group of groups) {
    const question = byGroup.get(group)![index];
    if (question !== undefined) selected.push(question);
    if (selected.length === count) break;
  }
  return selected;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "fetch") await fetchCloneMemPrimary();
  else if (args.length === 1 && args[0] === "inspect") {
    const counts = [];
    for (const personId of CLONEMEM_PRIMARY_PERSON_IDS) {
      const value = await readCloneMemPersona(personId);
      counts.push({ personId, traces: value.memory.traces.length, questions: value.queries.length,
        sourceSha256: value.sourceSha256, retrievalSha256: value.retrievalSha256, scorerSha256: value.scorerSha256 });
    }
    console.log(JSON.stringify({ protocol: "oh.clonemem-admission.v1", revision: sourcePin.revision, counts }, null, 2));
  } else if (args.length === 1 && args[0] === "--help") console.log("bun run scripts/benchmarks/clonemem-dataset.ts fetch|inspect\nFetch pins nine primary English personas; inspect emits only counts and hashes. Neither command evaluates performance.");
  else fail("use fetch, inspect or --help");
}
