/** Retrieval-only command for third-party memory harnesses (MemEval shape).
 * Reads one normalized conversation, prepares an Oh corpus and prints the packed context for one question.
 * No model, provider or network call; optional local semantic retrieval needs the pinned QMD package. */
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { canonicalSha256 } from "../../src/canonical";
import type { Corpus, Turn } from "./datasets";
import { EVOLUTION_RETRIEVAL_SYSTEMS, prepareEvolutionCorpus, type EvolutionRetrievalSystem } from "./evolution-retrieval";

export type MemEvalQuery = Readonly<{ conv: string; question: string; system: EvolutionRetrievalSystem; topK: number; maxBytes: number; cacheDir?: string }>;
function fail(reason: string): never { throw new TypeError(`MemEval CLI: ${reason}.`); }
const MAX_CONV_BYTES = 64 * 1024 * 1024;

export function parseMemEvalArgs(args: readonly string[]): MemEvalQuery {
  if (args[0] !== "query") fail("expected query");
  const allowed = ["conv", "question", "system", "top-k", "max-bytes", "cache-dir"], flags = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!flag?.startsWith("--") || value === undefined || flags.has(flag.slice(2)) || !allowed.includes(flag.slice(2))) fail("unknown, duplicate or missing argument");
    flags.set(flag.slice(2), value);
  }
  for (const required of ["conv", "question"]) if (!flags.has(required)) fail(`--${required} required`);
  const conv = flags.get("conv")!, question = flags.get("question")!, system = flags.get("system") ?? "oh-semantic";
  if (!isAbsolute(conv) || conv.includes("\0")) fail("absolute conversation path required");
  if (!question.length || question.length > 16_384) fail("question length");
  if (!(EVOLUTION_RETRIEVAL_SYSTEMS as readonly string[]).includes(system)) fail("unknown retrieval system");
  const integer = (name: string, fallback: number, maximum: number) => {
    const raw = flags.get(name); if (raw === undefined) return fallback;
    if (!/^[1-9]\d{0,7}$/.test(raw) || Number(raw) > maximum) fail(`invalid --${name}`); return Number(raw);
  };
  const cacheDir = flags.get("cache-dir");
  if (cacheDir !== undefined && (!isAbsolute(cacheDir) || cacheDir.includes("\0"))) fail("absolute cache directory required");
  return { conv: resolve(conv), question, system: system as EvolutionRetrievalSystem, topK: integer("top-k", 100, 100),
    maxBytes: integer("max-bytes", 96_000, 4_000_000), ...(cacheDir === undefined ? {} : { cacheDir: resolve(cacheDir) }) };
}

/** MemEval normalizes one LongMemEval question into `session_N` turn lists with `session_N_date_time` strings.
 * Turns keep haystack order inside a session and are sorted by date string across sessions, matching the dataset parser. */
export function memEvalConversationCorpus(value: unknown): Corpus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("conversation object required");
  const record = value as Record<string, unknown>, turns: Turn[] = [], sessions: number[] = [];
  for (const key of Object.keys(record)) { const m = /^session_(\d{1,4})$/.exec(key); if (m && Array.isArray(record[key])) sessions.push(Number(m[1])); }
  if (!sessions.length || sessions.length > 1_000) fail("between 1 and 1000 sessions required");
  sessions.sort((a, b) => a - b);
  for (const [index, n] of sessions.entries()) {
    const date = record[`session_${n}_date_time`], list = record[`session_${n}`] as unknown[];
    if (typeof date !== "string" || !date.length || date.length > 256) fail(`session_${n} date`);
    if (list.length > 8_192) fail("session length");
    for (const [turnIndex, raw] of list.entries()) {
      if (typeof raw !== "object" || raw === null) fail("turn object");
      const turn = raw as Record<string, unknown>, speaker = turn.speaker, text = turn.text;
      if (typeof speaker !== "string" || !speaker.length || speaker.length > 64 || typeof text !== "string") fail("turn speaker/text");
      if (text.length > 1_000_000) fail("turn text length");
      turns.push({ id: `session_${n}:${turnIndex}`, sessionId: `session_${n}`, sessionIndex: index, date, speaker, text });
    }
  }
  if (!turns.length) fail("no turns");
  turns.sort((left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : 0);
  const qa = Array.isArray(record.qa) && record.qa.length && typeof (record.qa[0] as Record<string, unknown>)?.question_id === "string"
    ? String((record.qa[0] as Record<string, unknown>).question_id) : null;
  const id = qa && /^[A-Za-z0-9_-]{1,128}$/.test(qa) ? qa : `conv-${canonicalSha256(turns).slice(0, 16)}`;
  return { id, groupId: id.replace(/_abs$/, ""), turns };
}

export async function memEvalContext(query: MemEvalQuery): Promise<string> {
  const raw = await readFile(query.conv);
  if (raw.length > MAX_CONV_BYTES) fail("conversation exceeds 64 MiB");
  const corpus = memEvalConversationCorpus(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)));
  const semantic = query.system === "oh-semantic" || query.system === "oh-hybrid";
  if (semantic) { const optionalQmd: string = "@tobilu/qmd"; await import(optionalQmd); }
  const prepared = await prepareEvolutionCorpus(corpus, semantic ? { semanticCacheDirectory: query.cacheDir ?? resolve(process.cwd(), ".cache/memeval-semantic") } : {});
  try {
    const result = await prepared.retrieve(query.question, { id: `${query.system}-${query.topK}-${query.maxBytes}`, system: query.system,
      budget: { topK: query.topK, contextBytes: query.maxBytes } });
    return result.context;
  } finally { await prepared.close(); }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === "--help") {
    console.log("Oh retrieval for third-party memory harnesses.\nquery --conv ABS --question TEXT [--system oh-semantic|oh-hybrid|oh-keyword|bm25-window|...] [--top-k 100] [--max-bytes 96000] [--cache-dir ABS]\nPrints the packed context to stdout. No model or provider call.");
  } else {
    const query = parseMemEvalArgs(args);
    process.stdout.write(await memEvalContext(query));
  }
}
