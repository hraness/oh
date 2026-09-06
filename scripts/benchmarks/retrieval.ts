import { Database } from "bun:sqlite";

import { canonicalSha256, isPlainRecord } from "../../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { searchOhV1 } from "../../src/search";
import { OhSqliteStore } from "../../src/sqlite/store";
import type { Corpus, Turn } from "./datasets";
import { buildExtractionChunks, type MemoryUnit } from "./units";

export const SYSTEMS = ["no-memory", "recent", "full-context", "bm25", "bm25-focused", "bm25-window", "bm25-anchor-window",
  "oh-keyword", "oh-focused", "oh-window", "oh-anchor-window", "bm25-block", "oh-block", "bm25-fact-turns", "oh-fact-turns",
  "bm25-fact", "oh-fact"] as const;
export const DEFAULT_SYSTEMS = SYSTEMS.filter((system) => !system.endsWith("fact") && !system.endsWith("fact-turns")
  && !system.endsWith("anchor-window"));
export type System = typeof SYSTEMS[number];
export type RetrievalBudget = Readonly<{ topK: number; contextBytes: number }>;
export type UnitIndexIngestion = Readonly<{ units: number; buildMs: number }>;
export type Retrieved = Readonly<{
  context: string; turnIds: readonly string[]; sessionIds: readonly string[]; recordDigests: readonly string[];
  budgetExempt: boolean; omittedForBudget: number;
  evidenceKind?: "derived-unit"; supportTurnIds?: readonly string[];
}>;

export function benchmarkBaseline(systems: readonly System[]): System {
  const priorities: readonly System[] = ["bm25-window", "bm25-fact", "bm25-fact-turns", "bm25-block", "bm25-focused", "bm25-anchor-window"];
  const baseline = priorities.find((system) => systems.includes(system)) ?? systems[0];
  if (baseline === undefined) throw new TypeError("A benchmark requires at least one system.");
  return baseline;
}

export function benchmarkOrder(systems: readonly System[], questionIndex: number): readonly System[] {
  if (systems.length === 0 || !Number.isSafeInteger(questionIndex) || questionIndex < 0) throw new TypeError("Invalid benchmark order.");
  const offset = questionIndex % systems.length;
  return [...systems.slice(offset), ...systems.slice(0, offset)];
}

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

type IndexedUnit = Readonly<{ id: string; text: string; date: string; sessionId: string; sessionIndex?: number;
  sourceTurnIds: readonly string[] }>;

export function blockUnits(corpus: Corpus): readonly IndexedUnit[] {
  return buildExtractionChunks(corpus, { maxTurns: 6, maxBytes: 1_500 }).map((chunk) => ({
    id: `block-${canonicalSha256({ id: chunk.id, turns: chunk.turns })}`, text: chunk.turns.map(renderTurn).join("\n"),
    date: chunk.date, sessionId: chunk.sessionId, ...(chunk.sessionIndex === undefined ? {} : { sessionIndex: chunk.sessionIndex }),
    sourceTurnIds: [...new Set(chunk.turns.map((turn) => turn.id))],
  }));
}

export function createUnitIndex(corpus: Corpus, units: readonly IndexedUnit[], sources: readonly KnowledgeGraphRecordV1[], authority: OhSqliteStore) {
  const positions = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  const sourceBindings = units.map((unit) => unit.sourceTurnIds.map((id) => {
    const index = positions.get(id);
    if (index === undefined) throw new Error("Unit references a different corpus.");
    return { key: sources[index]!.key, digest: sources[index]!.recordSha256 };
  }));
  const turns: Turn[] = units.map((unit) => ({ id: unit.id, sessionId: unit.sessionId,
    ...(unit.sessionIndex === undefined ? {} : { sessionIndex: unit.sessionIndex }), date: unit.date, speaker: "Memory",
    text: `${unit.text}\nSources: ${unit.sourceTurnIds.map((id) => `[${id}]`).join(" ")}` }));
  const records = turns.map((turn, index) => createKnowledgeGraphRecordV1({ v: 1, kind: "edition",
    key: `edition:unit-${index.toString().padStart(5, "0")}`, dependencies: [],
    value: { ...turn, sourceBindings: sourceBindings[index]! } }));
  const store = new OhSqliteStore({ path: ":memory:", spaceId: "benchmark-units" });
  const bm25 = new Database(":memory:");
  const byKey = new Map(records.map((record, index) => [record.key, index]));
  try {
    for (let index = 0; index < records.length; index += 128) store.commit({ actorId: "benchmark.units", expectedHead: store.head(),
      operationId: `op_units_${index}`, instant: "2026-01-01T00:00:00.000Z",
      changes: records.slice(index, index + 128).map((record) => ({ kind: "put", record, v: 1 })) });
    bm25.run("CREATE VIRTUAL TABLE units USING fts5(unit_index UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')");
    const insert = bm25.prepare("INSERT INTO units (unit_index, text) VALUES (?, ?)");
    bm25.transaction(() => turns.forEach((turn, index) => insert.run(index, renderTurn(turn))))();
  } catch (error) { store.close(); bm25.close(); throw error; }
  return {
    async retrieve(system: System, query: string, budget: RetrievalBudget): Promise<Retrieved> {
      const terms = queryTerms(query, true);
      let indices: number[];
      if (system.startsWith("oh-")) {
        const found = await searchOhV1({ store, query: terms.join(" "), mode: "keyword", limit: budget.topK });
        indices = found.results.map(({ record }) => byKey.get(record.key)!);
      } else {
        const match = terms.map((term) => `"${term}"`).join(" OR ");
        indices = match ? bm25.query<{ unit_index: number }, [string, number]>(
          "SELECT unit_index FROM units WHERE units MATCH ? ORDER BY bm25(units), unit_index LIMIT ?",
        ).all(match, budget.topK).map((hit) => hit.unit_index) : [];
      }
      const validated = indices.flatMap((index) => {
        const current = sourceBindings[index]!.map((source) => authority.get(source.key));
        if (current.some((record, offset) => record?.recordSha256 !== sourceBindings[index]![offset]!.digest)) return [];
        const unitRecord = store.get(records[index]!.key);
        if (unitRecord === null) return [];
        return [{ index, unit: { turn: fromRecord(unitRecord), digest: unitRecord.recordSha256 },
          sources: current.map((record) => ({ turn: fromRecord(record!), digest: record!.recordSha256 })) }];
      });
      if (system.endsWith("fact")) {
        const packed = pack(validated.map((item) => item.unit), budget.contextBytes);
        const selected = new Set(packed.turnIds);
        return { ...packed, turnIds: [], evidenceKind: "derived-unit",
          supportTurnIds: [...new Set(validated.filter((item) => selected.has(item.unit.turn.id))
            .flatMap((item) => units[item.index]!.sourceTurnIds))] };
      }
      return pack(validated.flatMap((item) => item.sources), budget.contextBytes);
    },
    close() { store.close(); bm25.close(); },
  };
}

export function createRetrievers(corpus: Corpus, memoryUnits?: readonly MemoryUnit[]) {
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
  let blocks: ReturnType<typeof createUnitIndex> | undefined;
  let facts: ReturnType<typeof createUnitIndex> | undefined;
  const unitIndexes: { blocks?: UnitIndexIngestion; facts?: UnitIndexIngestion } = {};
  const prepare = (systems: readonly System[]) => {
    if (systems.some((system) => system.endsWith("block")) && blocks === undefined) {
      const started = performance.now();
      const units = blockUnits(corpus);
      blocks = createUnitIndex(corpus, units, records, store);
      unitIndexes.blocks = { units: units.length, buildMs: performance.now() - started };
    }
    if (systems.some((system) => system.endsWith("fact") || system.endsWith("fact-turns")) && facts === undefined) {
      if (memoryUnits === undefined) throw new Error("Fact retrieval requires a verified --units extraction report.");
      const started = performance.now();
      const units = memoryUnits.map((unit) => {
        for (const support of unit.supports) {
          const index = positions.get(support.turnId);
          if (index === undefined || !support.quote || !corpus.turns[index]!.text.includes(support.quote)) {
            throw new Error("Memory unit does not have valid source support.");
          }
        }
        return { ...unit, sourceTurnIds: [...new Set(unit.supports.map((support) => support.turnId))] };
      });
      facts = createUnitIndex(corpus, units, records, store);
      unitIndexes.facts = { units: units.length, buildMs: performance.now() - started };
    }
    return { ...unitIndexes };
  };
  const ohCandidate = (index: number): Candidate => {
    const record = store.get(records[index]!.key);
    if (record === null) throw new Error("Benchmark record is missing from current Oh authority.");
    return { turn: fromRecord(record), digest: record.recordSha256 };
  };
  return {
    ohIngestMs, bm25IngestMs, prepare,
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
      if (system.endsWith("block")) {
        prepare([system]);
        return blocks!.retrieve(system, query, budget);
      }
      if (system.endsWith("fact") || system.endsWith("fact-turns")) {
        prepare([system]);
        return facts!.retrieve(system, query, budget);
      }
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
        const neighbors = (candidate: Candidate): Candidate[] => {
          const position = positions.get(candidate.turn.id)!;
          return [position - 1, position + 1].filter((index) =>
            corpus.turns[index]?.sessionId === candidate.turn.sessionId
            && corpus.turns[index]?.sessionIndex === candidate.turn.sessionIndex)
            .map((index) => system.startsWith("oh-") ? ohCandidate(index) : rawCandidates[index]!);
        };
        candidates = system.endsWith("anchor-window") ? [...candidates, ...candidates.flatMap(neighbors)]
          : candidates.flatMap((candidate) => [candidate, ...neighbors(candidate)]);
      }
      return pack(candidates, budget.contextBytes);
    },
    close() { blocks?.close(); facts?.close(); store.close(); bm25.close(); },
  };
}
