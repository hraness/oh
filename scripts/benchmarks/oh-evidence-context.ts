import { canonicalSha256, sha256Hex, utf8ByteLength } from "../../src/canonical";
import type { OhAuthorLogRecordViewV1, OhAuthorLogViewV1 } from "../../src/author-log";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { compareKeys } from "../../src/recall";
import type { Turn } from "./datasets";
import { evolutionInstant } from "./evolution-dates";

/** Gold-free adapter: only whitelisted source fields, explicit dependencies and native retrieval ranks enter. */
export const OH_EVIDENCE_CONTEXT_PROTOCOL_V1 = "oh.evidence-context.v1" as const;
const MAX_TURNS = 8192, MAX_BYTES = 32 * 1024 * 1024, MAX_LISTS = 16;
export type OhEvidenceSourcePositionV1 = Readonly<{ turnId: string; sessionOrder: number; turnOrder: number }>;
export type OhEvidenceDependencyV1 = Readonly<{ turnId: string; sourceTurnIds: readonly string[] }>;
export type OhEvidenceProjectedTurnV1 = Readonly<{ turn: Turn; record: KnowledgeGraphRecordV1;
  sourceIndex: number; sessionOrder: number; turnOrder: number; session: string; dependencies: readonly string[] }>;
export type OhEvidenceSourceProjectionV1 = Readonly<{
  protocol: "oh.evidence-source-projection.v1";
  records: readonly KnowledgeGraphRecordV1[];
  turns: readonly OhEvidenceProjectedTurnV1[];
  byTurnId: ReadonlyMap<string, OhEvidenceProjectedTurnV1>;
  view: OhAuthorLogViewV1;
  sessionOrder: (session: string) => number | null;
}>;
export type OhNativeRankListV1 = Readonly<{ source: string; kind: "lexical" | "vector"; stage: "native";
  hits: readonly Readonly<{ turnId: string; rank: number }>[] }>;
export type OhFusedAnchorV1 = Readonly<{ turnId: string; score: number;
  ranks: readonly Readonly<{ source: string; kind: "lexical" | "vector"; rank: number }>[] }>;
export type OhEvidenceContextV1 = Readonly<{
  protocol: typeof OH_EVIDENCE_CONTEXT_PROTOCOL_V1;
  context: string; contextBytes: number; contextSha256: string;
  turnIds: readonly string[]; recordKeys: readonly string[];
  anchors: readonly OhFusedAnchorV1[];
  bundles: readonly Readonly<{ anchorTurnId: string; turnIds: readonly string[]; included: boolean }>[];
  omittedForBudget: number;
}>;

function bounded(value: unknown, bytes: number, label: string, empty = false): string {
  if (typeof value !== "string" || (!empty && value.length === 0) || utf8ByteLength(value) > bytes) {
    throw new TypeError(`Invalid evidence ${label}.`);
  }
  return value;
}
function integer(value: unknown, maximum: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new RangeError(`Invalid evidence ${label}.`);
  }
  return value as number;
}
/** Freeze the lookup surface too: freezing a Map would leave set/delete/clear usable. */
function immutableLookup<K, V>(source: Map<K, V>): ReadonlyMap<K, V> {
  const view: ReadonlyMap<K, V> = Object.freeze({
    get size() { return source.size; },
    get: (key: K) => source.get(key), has: (key: K) => source.has(key),
    entries: () => source.entries(), keys: () => source.keys(), values: () => source.values(),
    [Symbol.iterator]: () => source[Symbol.iterator](),
    forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) {
      source.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
  });
  return view;
}

/**
 * Corpus turns are in source order. `sessionIndex` is the outer session occurrence,
 * never a turn ordinal. Within each occurrence we count the actual array positions.
 * Callers with shuffled storage can supply complete explicit source positions.
 * Dependencies are source IDs supplied by the caller, never inferred from text or labels.
 */
export function projectOhEvidenceTurnsV1(input: readonly Turn[], options: Readonly<{
  positions?: readonly OhEvidenceSourcePositionV1[]; dependencies?: readonly OhEvidenceDependencyV1[];
}> = {}): OhEvidenceSourceProjectionV1 {
  if (!Array.isArray(input) || input.length > MAX_TURNS) throw new RangeError("Evidence accepts at most 8192 source turns.");
  let bytes = 0;
  const turns = input.map((source): Turn => {
    const sessionIndex = source.sessionIndex;
    if (sessionIndex !== undefined) integer(sessionIndex, Number.MAX_SAFE_INTEGER, "session occurrence");
    const turn = Object.freeze({ id: bounded(source.id, 512, "turn ID"), sessionId: bounded(source.sessionId, 512, "session ID"),
      ...(sessionIndex === undefined ? {} : { sessionIndex }), date: bounded(source.date, 256, "date", true),
      speaker: bounded(source.speaker, 64, "speaker"), text: bounded(source.text, 524_288, "turn text", true) });
    bytes += utf8ByteLength(turn.text) + utf8ByteLength(turn.id) + utf8ByteLength(turn.sessionId) + 1024;
    if (bytes > MAX_BYTES) throw new RangeError("Evidence corpus exceeds 32 MiB.");
    return turn;
  });
  const ids = new Set(turns.map(turn => turn.id));
  if (ids.size !== turns.length) throw new TypeError("Duplicate evidence turn ID.");
  const positions = new Map<string, OhEvidenceSourcePositionV1>();
  if (options.positions !== undefined) {
    if (!Array.isArray(options.positions) || options.positions.length !== turns.length) throw new TypeError("Evidence positions must cover every turn.");
    for (const position of options.positions) {
      if (!ids.has(position.turnId) || positions.has(position.turnId)) throw new TypeError("Unknown or duplicate evidence position.");
      positions.set(position.turnId, { turnId: position.turnId,
        sessionOrder: integer(position.sessionOrder, Number.MAX_SAFE_INTEGER, "session order"),
        turnOrder: integer(position.turnOrder, Number.MAX_SAFE_INTEGER, "turn order") });
    }
  }
  const dependencies = new Map<string, readonly string[]>();
  if (options.dependencies !== undefined) {
    if (!Array.isArray(options.dependencies) || options.dependencies.length > turns.length) throw new RangeError("Too many evidence dependency groups.");
    for (const entry of options.dependencies) {
      if (!ids.has(entry.turnId) || dependencies.has(entry.turnId) || !Array.isArray(entry.sourceTurnIds)
        || entry.sourceTurnIds.length > 4096 || new Set(entry.sourceTurnIds).size !== entry.sourceTurnIds.length
        || entry.sourceTurnIds.some((id: unknown) => typeof id !== "string" || !ids.has(id) || id === entry.turnId)) throw new TypeError("Invalid evidence dependency.");
      dependencies.set(entry.turnId, Object.freeze([...entry.sourceTurnIds]));
    }
  }
  const keys = new Map(turns.map(turn => [turn.id, `edition:turn-${canonicalSha256(turn.id).slice(0, 32)}`]));
  const sessionCounts = new Map<string, number>(), sessionOrders = new Map<string, number>(), sessionsAtOrder = new Map<number, string>();
  const occupiedPositions = new Set<string>();
  const views = new Map<string, OhAuthorLogRecordViewV1>();
  const projected = turns.map((turn, sourceIndex): OhEvidenceProjectedTurnV1 => {
    const session = bounded(JSON.stringify([turn.sessionId, turn.sessionIndex ?? null]), 512, "rendered session ID");
    const position = positions.get(turn.id);
    const sessionOrder = position?.sessionOrder ?? turn.sessionIndex ?? sessionOrders.get(session) ?? sourceIndex;
    const turnOrder = position?.turnOrder ?? sessionCounts.get(session) ?? 0;
    if (sessionOrders.has(session) && sessionOrders.get(session) !== sessionOrder) throw new TypeError("Inconsistent source session order.");
    if (sessionsAtOrder.has(sessionOrder) && sessionsAtOrder.get(sessionOrder) !== session) throw new TypeError("Duplicate source session order.");
    const occupied = JSON.stringify([session, turnOrder]);
    if (occupiedPositions.has(occupied)) throw new TypeError("Duplicate source turn order.");
    occupiedPositions.add(occupied); sessionOrders.set(session, sessionOrder); sessionsAtOrder.set(sessionOrder, session); sessionCounts.set(session, turnOrder + 1);
    const instant = turn.date === "" ? null : evolutionInstant(turn.date, "source date");
    const sourceDependencies = dependencies.get(turn.id) ?? Object.freeze([]);
    // Keep the versioned turn value explicit: no misleading sessionIndex field.
    const record = createKnowledgeGraphRecordV1({ key: keys.get(turn.id)!, kind: "edition", v: 1,
      dependencies: sourceDependencies.map(id => keys.get(id)!).sort(compareKeys),
      value: { protocol: "oh.evidence-source-turn.v1", sourceTurnId: turn.id, observedAt: instant,
        sessionId: session, sourceSessionOrder: sessionOrder, turnIndex: turnOrder, speaker: turn.speaker, text: turn.text } });
    Object.freeze(record.dependencies); Object.freeze(record.value); Object.freeze(record);
    views.set(record.key, Object.freeze({ instant, order: turnOrder, session, speaker: turn.speaker, text: turn.text }));
    return Object.freeze({ turn, record, sourceIndex, sessionOrder, turnOrder, session, dependencies: sourceDependencies });
  }).sort((a, b) => a.sessionOrder - b.sessionOrder || compareKeys(a.session, b.session) || a.turnOrder - b.turnOrder);
  const view: OhAuthorLogViewV1 = record => {
    const result = views.get(record.key);
    if (result === undefined) throw new TypeError("Unknown projected source record.");
    return result;
  };
  return Object.freeze({ protocol: "oh.evidence-source-projection.v1", records: Object.freeze(projected.map(item => item.record)),
    turns: Object.freeze(projected), byTurnId: immutableLookup(new Map(projected.map(item => [item.turn.id, item]))), view,
    sessionOrder: (session: string) => sessionOrders.get(session) ?? null });
}

/** RRF uses native 1-based ranks; duplicate ranks/IDs fail instead of silently increasing a source's vote. */
export function fuseOhNativeRanksV1(lists: readonly OhNativeRankListV1[], k = 60): readonly OhFusedAnchorV1[] {
  integer(k, 1_000_000, "fusion constant");
  if (!Array.isArray(lists) || lists.length > MAX_LISTS) throw new RangeError("Evidence accepts at most 16 rank lists.");
  const sources = new Set<string>(), fused = new Map<string, { turnId: string; score: number;
    ranks: { source: string; kind: "lexical" | "vector"; rank: number }[] }>();
  // Source order is canonical, including floating-point accumulation.
  const checked = lists.map(list => {
    const source = bounded(list.source, 128, "rank source");
    if (sources.has(source) || list.stage !== "native" || (list.kind !== "lexical" && list.kind !== "vector")
      || !Array.isArray(list.hits) || list.hits.length > MAX_TURNS) throw new TypeError("Expected distinct bounded native rank lists.");
    sources.add(source);
    return { source, kind: list.kind, hits: list.hits };
  }).sort((a, b) => compareKeys(a.source, b.source));
  for (const list of checked) {
    const seenIds = new Set<string>(), seenRanks = new Set<number>();
    for (const hit of list.hits) {
      const turnId = bounded(hit.turnId, 512, "rank turn ID"), rank = integer(hit.rank, MAX_TURNS, "native rank", 1);
      if (seenIds.has(turnId) || seenRanks.has(rank)) throw new TypeError("Duplicate native turn or rank.");
      seenIds.add(turnId); seenRanks.add(rank);
      const entry = fused.get(turnId) ?? { turnId, score: 0, ranks: [] };
      entry.score += 1 / (k + rank); entry.ranks.push({ source: list.source, kind: list.kind, rank }); fused.set(turnId, entry);
    }
  }
  return Object.freeze([...fused.values()].sort((a, b) => b.score - a.score || compareKeys(a.turnId, b.turnId))
    .map(entry => Object.freeze({ ...entry, ranks: Object.freeze(entry.ranks.map(rank => Object.freeze(rank))) })));
}

/**
 * Fuse once, then expand same-session neighbors and the transitive explicit source
 * dependencies of every member. Admit each complete bundle or none of its new turns.
 * Shared support is charged once; raw turns are never sliced to fit the byte budget.
 */
export function packOhEvidenceContextV1(input: Readonly<{ projection: OhEvidenceSourceProjectionV1; rankings: readonly OhNativeRankListV1[] }>,
  options: Readonly<{ contextBytes: number; topK?: number; previousTurns?: number; nextTurns?: number; rrfK?: number }>): OhEvidenceContextV1 {
  const budget = integer(options.contextBytes, 4_000_000, "context budget"), topK = integer(options.topK ?? 400, MAX_TURNS, "anchor limit", 1);
  const previous = integer(options.previousTurns ?? 1, 32, "previous turns"), next = integer(options.nextTurns ?? 1, 32, "next turns");
  const fused = fuseOhNativeRanksV1(input.rankings, options.rrfK);
  const projection = input.projection;
  for (const anchor of fused) if (!projection.byTurnId.has(anchor.turnId)) throw new TypeError("Native rank names an unknown source turn.");
  const anchors = fused.slice(0, topK), sessions = new Map<string, OhEvidenceProjectedTurnV1[]>();
  const sessionPositions = new Map<string, number>(), rendered = new Map<string, string>();
  for (const item of projection.turns) {
    const members = sessions.get(item.session) ?? [];
    sessionPositions.set(item.turn.id, members.length); members.push(item); sessions.set(item.session, members);
    rendered.set(item.turn.id, `[${item.turn.id}] [${item.turn.date}] ${item.turn.speaker}: ${item.turn.text}`);
  }
  const selected = new Set<string>(), bundles: { anchorTurnId: string; turnIds: readonly string[]; included: boolean }[] = [];
  let bytes = 0;
  for (const anchor of anchors) {
    const item = projection.byTurnId.get(anchor.turnId)!, members = sessions.get(item.session)!, position = sessionPositions.get(anchor.turnId)!;
    const closure = new Set<string>(), pending = members.slice(Math.max(0, position - previous), position + next + 1).map(member => member.turn.id);
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (closure.has(id)) continue;
      closure.add(id);
      const source = projection.byTurnId.get(id);
      if (source === undefined) throw new TypeError("Evidence support names an unknown source turn.");
      pending.push(...source.dependencies);
    }
    const turnIds = projection.turns.filter(source => closure.has(source.turn.id)).map(source => source.turn.id);
    const additions = turnIds.filter(id => !selected.has(id));
    const addedBytes = additions.reduce((sum, id) => sum + utf8ByteLength(rendered.get(id)!), 0)
      + 2 * (additions.length === 0 ? 0 : additions.length - (selected.size === 0 ? 1 : 0));
    const included = bytes + addedBytes <= budget;
    if (included) { for (const id of additions) selected.add(id); bytes += addedBytes; }
    bundles.push({ anchorTurnId: anchor.turnId, turnIds: Object.freeze(turnIds), included });
  }
  const kept = projection.turns.filter(item => selected.has(item.turn.id)), context = kept.map(item => rendered.get(item.turn.id)!).join("\n\n");
  if (utf8ByteLength(context) !== bytes || bytes > budget) throw new Error("Evidence packing byte accounting mismatch.");
  return Object.freeze({ protocol: OH_EVIDENCE_CONTEXT_PROTOCOL_V1, context, contextBytes: bytes, contextSha256: sha256Hex(context),
    turnIds: Object.freeze(kept.map(item => item.turn.id)), recordKeys: Object.freeze(kept.map(item => item.record.key)),
    anchors: Object.freeze(anchors), bundles: Object.freeze(bundles.map(bundle => Object.freeze(bundle))),
    omittedForBudget: bundles.filter(bundle => !bundle.included).length });
}
