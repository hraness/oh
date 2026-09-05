import { Database } from "bun:sqlite";

import { isPlainRecord } from "../../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { searchOhV1 } from "../../src/search";
import { OhSqliteStore } from "../../src/sqlite/store";
import type { Corpus, Turn } from "./datasets";

export const SYSTEMS = ["no-memory", "recent", "full-context", "bm25", "bm25-focused", "bm25-window",
  "oh-keyword", "oh-focused", "oh-window"] as const;
export type System = typeof SYSTEMS[number];
export type RetrievalBudget = Readonly<{ topK: number; contextBytes: number }>;
export type Retrieved = Readonly<{
  context: string; turnIds: readonly string[]; sessionIds: readonly string[]; recordDigests: readonly string[];
  budgetExempt: boolean; omittedForBudget: number;
}>;

const stopwords = new Set(("a an the is are was were be been being do does did have has had "
  + "what which who whom whose when where why how can could would should will shall "
  + "of to in on at for from by with about as and or that this these those it its "
  + "i me my we our you your he him his she her they them their please tell according").split(" "));

export function queryTerms(query: string, focused = false): string[] {
  const terms = [...new Set(query.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
  const selected = focused ? terms.filter((term) => !stopwords.has(term)) : terms;
  return (selected.length ? selected : terms).slice(0, 16);
}

export function renderTurn(turn: Turn): string {
  return `[${turn.id}] [${turn.date}] ${turn.speaker}: ${turn.text}`;
}

function fromRecord(record: KnowledgeGraphRecordV1): Turn {
  const value = record.value;
  if (!isPlainRecord(value) || !["id", "sessionId", "date", "speaker", "text"]
    .every((key) => typeof value[key] === "string")) throw new TypeError("Invalid benchmark turn record.");
  if (value.sessionIndex !== undefined && (!Number.isSafeInteger(value.sessionIndex) || Number(value.sessionIndex) < 0)) {
    throw new TypeError("Invalid benchmark session occurrence.");
  }
  return { id: value.id as string, sessionId: value.sessionId as string, date: value.date as string,
    ...(value.sessionIndex === undefined ? {} : { sessionIndex: value.sessionIndex as number }),
    speaker: value.speaker as string, text: value.text as string };
}

type Candidate = Readonly<{ turn: Turn; digest?: string }>;

export function pack(candidates: readonly Candidate[], contextBytes: number, budgetExempt = false): Retrieved {
  const seen = new Set<string>();
  const selected: Candidate[] = [];
  const parts: string[] = [];
  let bytes = 0;
  let omittedForBudget = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate.turn.id)) continue;
    seen.add(candidate.turn.id);
    const rendered = renderTurn(candidate.turn);
    const needed = Buffer.byteLength(rendered) + (parts.length ? 2 : 0);
    if (!budgetExempt && bytes + needed > contextBytes) { omittedForBudget += 1; continue; }
    bytes += needed;
    parts.push(rendered);
    selected.push(candidate);
  }
  return { context: parts.join("\n\n"), turnIds: selected.map(({ turn }) => turn.id),
    sessionIds: [...new Set(selected.map(({ turn }) => turn.sessionId))],
    recordDigests: selected.flatMap(({ digest }) => digest ? [digest] : []), budgetExempt, omittedForBudget };
}

export function createRetrievers(corpus: Corpus) {
  const ohStart = performance.now();
  const store = new OhSqliteStore({ path: ":memory:", spaceId: "benchmark" });
  const bm25 = new Database(":memory:");
  const records = corpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({
    dependencies: [], key: `edition:turn-${index.toString().padStart(5, "0")}`, kind: "edition", v: 1,
    value: { ...turn },
  }));
  let ohIngestMs: number;
  let bm25IngestMs: number;
  try {
    for (let index = 0; index < records.length; index += 128) {
      store.commit({ actorId: "benchmark.ingest", expectedHead: store.head(), operationId: `op_benchmark_${index}`,
        instant: "2026-01-01T00:00:00.000Z",
        changes: records.slice(index, index + 128).map((record) => ({ kind: "put", record, v: 1 })) });
    }
    ohIngestMs = performance.now() - ohStart;
    const bm25Start = performance.now();
    bm25.run("CREATE VIRTUAL TABLE passages USING fts5(turn_index UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')");
    const insert = bm25.prepare("INSERT INTO passages (turn_index, text) VALUES (?, ?)");
    bm25.transaction(() => corpus.turns.forEach((turn, index) => insert.run(index, renderTurn(turn))))();
    bm25IngestMs = performance.now() - bm25Start;
  } catch (error) { store.close(); bm25.close(); throw error; }
  const positions = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  const rawCandidates = corpus.turns.map((turn) => ({ turn }));
  const ohCandidate = (index: number): Candidate => {
    const record = store.get(records[index]!.key);
    if (record === null) throw new Error("Benchmark record is missing from current Oh authority.");
    return { turn: fromRecord(record), digest: record.recordSha256 };
  };
  return {
    ohIngestMs, bm25IngestMs,
    fullContextBytes: Buffer.byteLength(pack(rawCandidates, 0, true).context),
    async retrieve(system: System, query: string, budget: RetrievalBudget): Promise<Retrieved> {
      if (!Number.isSafeInteger(budget.topK) || budget.topK < 1 || budget.topK > 100
        || !Number.isSafeInteger(budget.contextBytes) || budget.contextBytes < 1 || budget.contextBytes > 4_000_000) {
        throw new RangeError("Invalid retrieval budget.");
      }
      if (!SYSTEMS.includes(system)) throw new TypeError("Unknown retrieval system.");
      if (system === "no-memory") return pack([], budget.contextBytes);
      if (system === "full-context") return pack(rawCandidates, budget.contextBytes, true);
      if (system === "recent") return pack([...rawCandidates].reverse(), budget.contextBytes);
      const focused = system.endsWith("focused") || system.endsWith("window");
      const terms = queryTerms(query, focused);
      let candidates: Candidate[];
      if (system.startsWith("oh-")) {
        const result = await searchOhV1({ store, query: focused ? terms.join(" ") : query,
          mode: "keyword", limit: budget.topK });
        candidates = result.results.map(({ record }) => ({ turn: fromRecord(record), digest: record.recordSha256 }));
      } else {
        const match = terms.map((term) => `"${term}"`).join(" OR ");
        const hits = match ? bm25.query<{ turn_index: number }, [string, number]>(
          "SELECT turn_index FROM passages WHERE passages MATCH ? ORDER BY bm25(passages), turn_index LIMIT ?",
        ).all(match, budget.topK) : [];
        candidates = hits.map((hit) => rawCandidates[hit.turn_index]!);
      }
      if (system.endsWith("window")) {
        candidates = candidates.flatMap((candidate) => {
          const position = positions.get(candidate.turn.id)!;
          const neighbors = [position - 1, position + 1].filter((index) =>
            corpus.turns[index]?.sessionId === candidate.turn.sessionId
            && corpus.turns[index]?.sessionIndex === candidate.turn.sessionIndex);
          return [candidate, ...neighbors.map((index) => system.startsWith("oh-")
            ? ohCandidate(index) : rawCandidates[index]!)];
        });
      }
      return pack(candidates, budget.contextBytes);
    },
    close() { store.close(); bm25.close(); },
  };
}
