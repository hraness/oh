// Purpose: proof-carrying deductive retrieval — a benchmark retrieval arm that
// selects evidence turns by DERIVATION, not term frequency. Per-session
// `algal.memory.v1` shards project mechanical facts only (speaker, session,
// date, lowercase content tokens, capitalized mention entities). Each question
// injects `question-term` / `question-entity` / `in-scope` facts (all parsed
// mechanically from the question text), then a fixed positive-Datalog program
// derives `hit-any(turn, marker)` rows — a token marker for term hits, a
// `k:`-prefixed marker for structural hits (speaker, scope, bridge); every
// row's proof DAG terminates in real store-record digests and is
// replay-verified before scoring.
// No labels, no paid calls, no embeddings, no inferred semantics — the edge
// over bm25 is purely structural: distinct-term coverage, speaker linkage
// (a speaker's own turns never contain their name as a token), session date
// scoping (the date lives in metadata, outside FTS reach), and entity
// co-occurrence bridging. Candidates pack under the shared byte budget as
// five-turn windows around the top derivations, then session-round-robin
// directed fill of every remaining positive derivation.
//
// Systems exported: "deductive" (derivation-only ranking) and
// "deductive-union" (derived candidates first, bm25 order fills the rest).

import { Database } from "bun:sqlite";
import { canonicalSha256 } from "../../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { OhSqliteStore } from "../../src/sqlite/store";
import type { Corpus, Turn } from "./datasets";
import { pack, queryTerms, renderTurn, type Retrieved, type RetrievalBudget } from "./retrieval";
import { query as datalogQuery, verify as datalogVerify, type Snapshot } from "./memory-datalog";
import { validateRulePack } from "./consistency-rules";
import { parseEvolutionInstant } from "./evolution-dates";

export const DEDUCTIVE_RETRIEVAL_PROTOCOL = "oh.deductive-retrieval.v1" as const;

export const DEDUCTIVE_SYSTEMS = ["deductive", "deductive-union"] as const;
export type DeductiveSystem = (typeof DEDUCTIVE_SYSTEMS)[number];

function fail(message: string): never {
  throw new TypeError(`deductive retrieval: ${message}`);
}

/* Question parsing — all mechanical, declared here so a reviewer can audit the
 * exact surface the derivation sees. */
const STOP = new Set(("a an the is are was were be been being do does did have has had "
  + "what which who whom whose when where why how can could would should will shall "
  + "of to in on at for from by with about as and or that this these those it its "
  + "i me my we our you your he him his she her they them their please tell according "
  + "much many any some any someone something anything everything everyone").split(" "));
const MONTHS = "january february march april may june july august september october november december"
  .split(" ");

/* Directional date cues: a cue word whose date phrase begins within 60 chars
 * of its end turns the date scope into a one-sided bound ("before August 3,
 * 2023" scopes sessions at or before that day — the evidence for such
 * questions lives before the bound, never inside it). The closest cue–date
 * pair wins; `as of`/`until` bound the reference point itself. */
const DIRECTIONAL_CUES: readonly { cue: RegExp; direction: "before" | "after" }[] = [
  { cue: /\b(?:before|prior to|earlier than|until|as of)\b/g, direction: "before" },
  { cue: /\b(?:after|since|later than|following)\b/g, direction: "after" },
];
/* Post-cue date grammar: `August 3, 2023`, `16 November 2023`,
 * `4th October, 2023`, `November 2023`, or a bare `2023`. */
const MONTH_RE = "january|february|march|april|may|june|july|august|september|october|november|december";
const DIRECTIONAL_DATE = new RegExp(
  `(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+)?(${MONTH_RE})(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?\\s*,?\\s*((?:19|20)\\d{2})`);
const DIRECTIONAL_YEAR = /\b((?:19|20)\d{2})\b/;

export type ParsedQuestion = Readonly<{
  terms: readonly string[];
  entities: readonly string[];
  scopeMonths: readonly string[];
  scopeYears: readonly string[];
  /** One-sided date bound from a directional cue ("before August 3, 2023",
   * "after his trip in August 2023", "as of November 2023"). `month`/`day`
   * are null at coarser granularity; both null means no directional cue. */
  scopeDirection: "before" | "after" | null;
  scopeBound: Readonly<{ year: number; month: number | null; day: number | null }> | null;
  /** Temporal direction cue: "first/earliest" asks for the earliest match,
   * "last/latest/recent/current" the latest. `null` = no ordering cue. */
  chronology: "asc" | "desc" | null;
}>;

export function parseQuestion(question: string): ParsedQuestion {
  if (typeof question !== "string" || Buffer.byteLength(question) > 16_384) fail("invalid question");
  const terms = queryTerms(question, true);
  const entities = [...new Set(question.match(/\b[A-Z][a-z]{2,19}\b/g) ?? [])]
    .map((token) => token.toLowerCase()).filter((token) => !STOP.has(token)).slice(0, 8);
  const lower = question.toLowerCase();
  const scopeMonths = MONTHS.filter((month) => new RegExp(`\\b${month}\\b`).test(lower));
  const scopeYears = [...new Set(lower.match(/\b(19|20)\d{2}\b/g) ?? [])].slice(0, 4);
  const chronology = /\b(last|latest|recent|recently|current|currently|now|today)\b/i.test(question) ? "desc" as const
    : /\b(first|earliest|originally|initially|began|started)\b/i.test(question) ? "asc" as const : null;
  // Directional bound: nearest cue–date pair wins. A nonexistent date
  // ("February 30") is rejected rather than rolled over by Date.UTC.
  let scopeDirection: ParsedQuestion["scopeDirection"] = null;
  let scopeBound: ParsedQuestion["scopeBound"] = null;
  let bestGap = 60;
  for (const { cue, direction } of DIRECTIONAL_CUES) {
    for (const cueMatch of lower.matchAll(cue)) {
      const start = cueMatch.index! + cueMatch[0].length;
      const window = lower.slice(start, start + 60);
      const dated = DIRECTIONAL_DATE.exec(window);
      const bare = dated === null ? DIRECTIONAL_YEAR.exec(window) : null;
      const match = dated ?? bare;
      if (match === null || match.index >= bestGap) continue;
      const dayRaw = dated?.[1] ?? dated?.[3];
      const bound = dated !== null
        ? { year: Number(dated[4]), month: MONTHS.indexOf(dated[2]!) + 1,
            day: dayRaw === undefined ? null : Number(dayRaw) }
        : { year: Number(bare![1]), month: null, day: null };
      if (bound.day !== null) {
        const probe = new Date(Date.UTC(bound.year, bound.month! - 1, bound.day));
        if (probe.getUTCMonth() !== bound.month! - 1 || probe.getUTCDate() !== bound.day) continue;
      }
      bestGap = match.index;
      scopeDirection = direction;
      scopeBound = Object.freeze(bound);
    }
  }
  return Object.freeze({ terms, entities,
    // A date scope binds only when the question carries a real month+year or
    // bare-year constraint — single months alone are too weak to restrict on.
    scopeMonths: scopeYears.length > 0 ? Object.freeze(scopeMonths.slice(0, 4)) : Object.freeze([]),
    scopeYears: Object.freeze(scopeYears), scopeDirection, scopeBound, chronology });
}

/** The fixed retrieval rule program evaluated once per shard. `hit-any(T, X)`
 * folds all mechanisms into one relation: a term row carries the matched
 * question token; a structural row carries a `k:`-prefixed kind literal
 * (`k:` can never collide with a token — the token grammar excludes `:`). */
const RETRIEVAL_RULES = {
  contract: "algal.query.v1" as const,
  rules: [
    { id: "hit-term", head: { relation: "hit-any", terms: [{ var: "t" }, { var: "x" }] },
      body: [{ relation: "states", terms: [{ var: "t" }, "token", { var: "x" }] },
             { relation: "question-term", terms: [{ var: "x" }] }] },
    { id: "hit-speaker", head: { relation: "hit-any", terms: [{ var: "t" }, "k:speaker"] },
      body: [{ relation: "states", terms: [{ var: "t" }, "speaker", { var: "s" }] },
             { relation: "question-entity", terms: [{ var: "s" }] }] },
    { id: "hit-scoped", head: { relation: "hit-any", terms: [{ var: "t" }, "k:scoped"] },
      body: [{ relation: "states", terms: [{ var: "t" }, "session", { var: "se" }] },
             { relation: "in-scope", terms: [{ var: "se" }] }] },
    { id: "co-entity", head: { relation: "co-entity", terms: [{ var: "x" }] },
      body: [{ relation: "states", terms: [{ var: "t2" }, "entity", { var: "q" }] },
             { relation: "states", terms: [{ var: "t2" }, "entity", { var: "x" }] },
             { relation: "question-entity", terms: [{ var: "q" }] }] },
    { id: "hit-bridge", head: { relation: "hit-any", terms: [{ var: "t" }, "k:bridge"] },
      body: [{ relation: "states", terms: [{ var: "t" }, "entity", { var: "x" }] },
             { relation: "co-entity", terms: [{ var: "x" }] }] },
  ],
};

const QUERY_PROGRAM = validateRulePack({
  ...RETRIEVAL_RULES,
  query: { relation: "hit-any", terms: [{ var: "t" }, { var: "x" }] },
});
export const RETRIEVAL_PROGRAM_SHA256 = canonicalSha256(QUERY_PROGRAM);

/** Per-corpus deductive index: real Oh store records (provenance digests) plus
 * per-session `algal.memory.v1` shards of mechanical facts. */
/** Per-shard projection summary used for sound pruning: a shard derives no
 * `hit-any` row unless some rule body can fire, and every body requires a
 * question-fact join (term ∩ tokens, entity ∩ entities-or-speakers, or the
 * session ∈ in-scope). Shards failing all three contribute zero rows. */
export interface ShardSummary {
  readonly tokens: ReadonlySet<string>;
  readonly entities: ReadonlySet<string>;
  readonly speakers: ReadonlySet<string>;
}

export function prepareDeductive(corpus: Corpus): {
  readonly records: readonly KnowledgeGraphRecordV1[];
  readonly shards: ReadonlyMap<string, Snapshot>;
  readonly summaries: ReadonlyMap<string, ShardSummary>;
  readonly sessionDates: ReadonlyMap<string, string>;
  readonly positionOf: ReadonlyMap<string, number>;
  readonly documentFrequency: ReadonlyMap<string, number>;
  readonly store: OhSqliteStore;
  readonly fts: Database;
} {
  const records = corpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({
    dependencies: [], key: `edition:turn-${index.toString().padStart(5, "0")}`, kind: "edition", v: 1,
    value: { ...turn },
  }));
  const store = new OhSqliteStore({ path: ":memory:", spaceId: `ded-ret-${corpus.id}`.slice(0, 120) });
  try {
    for (let start = 0; start < records.length;) {
      const changes: Array<{ kind: "put"; record: KnowledgeGraphRecordV1; v: 1 }> = [];
      while (start + changes.length < records.length && changes.length < 512) {
        changes.push({ kind: "put", record: records[start + changes.length]!, v: 1 });
      }
      store.commit({ actorId: "deductive.retrieval", expectedHead: store.head(),
        operationId: `op_dedret_${start}`, instant: "2026-01-01T00:00:00.000Z", changes });
      start += changes.length;
    }
  } catch (error) { store.close(); throw error; }

  const positionOf = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  const sessionDates = new Map<string, string>();
  const bySession = new Map<string, Turn[]>();
  for (const turn of corpus.turns) {
    if (!sessionDates.has(turn.sessionId)) sessionDates.set(turn.sessionId, turn.date);
    const list = bySession.get(turn.sessionId) ?? [];
    list.push(turn);
    bySession.set(turn.sessionId, list);
  }

  const shards = new Map<string, Snapshot>();
  const summaries = new Map<string, ShardSummary>();
  const documentFrequency = new Map<string, number>();
  for (const [sessionId, turns] of [...bySession.entries()].sort()) {
    const facts: Snapshot["facts"][number][] = [];
    const summary = { tokens: new Set<string>(), entities: new Set<string>(), speakers: new Set<string>() };
    for (const turn of turns) {
      const source = `sha256:${records[positionOf.get(turn.id)!]!.recordSha256}`;
      const entity = `turn:${turn.id}`;
      const push = (relation: string, tuple: (string | number | boolean | null)[]) =>
        facts.push({ relation, tuple, sources: [source] });
      const speaker = turn.speaker.toLowerCase();
      summary.speakers.add(speaker);
      push("states", [entity, "speaker", speaker]);
      push("states", [entity, "session", turn.sessionId]);
      push("states", [entity, "date", turn.date]);
      push("states-at", [entity, "said-at", turn.date, turn.date]);
      const seen = new Set<string>();
      for (const match of turn.text.toLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,31}/gu)) {
        const token = match[0];
        if (STOP.has(token) || seen.has(token)) continue;
        seen.add(token);
        summary.tokens.add(token);
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
        push("states", [entity, "token", token]);
        if (seen.size >= 48) break;
      }
      const entities = new Set<string>();
      for (const match of turn.text.matchAll(/\b[A-Z][a-z]{2,19}\b/g)) {
        const name = match[0].toLowerCase();
        if (STOP.has(name) || name === speaker || entities.has(name)) continue;
        entities.add(name);
        summary.entities.add(name);
        push("states", [entity, "entity", name]);
        if (entities.size >= 8) break;
      }
    }
    shards.set(sessionId, { contract: "algal.memory.v1" as const,
      facts: Object.freeze(facts) as unknown as Snapshot["facts"] });
    summaries.set(sessionId, Object.freeze({ tokens: summary.tokens,
      entities: summary.entities, speakers: summary.speakers }));
  }

  const fts = new Database(":memory:");
  try {
    fts.run("CREATE VIRTUAL TABLE passages USING fts5(turn_index UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')");
    const insert = fts.prepare("INSERT INTO passages (turn_index, text) VALUES (?, ?)");
    fts.transaction(() => corpus.turns.forEach((turn, index) => insert.run(index, renderTurn(turn))))();
  } catch (error) { store.close(); fts.close(); throw error; }

  return { records, shards, summaries, sessionDates, positionOf,
    documentFrequency, store, fts };
}

type Derived = Readonly<{ turnId: string; sessionId: string; terms: ReadonlySet<string>;
  speaker: boolean; scoped: boolean; sessionCoverage: number;
  bridges: number; proofs: readonly string[] }>;

/** Derive question-relevant turn candidates across all session shards. Every
 * returned row was replay-verified; `proofs` carries the row proof digests so
 * the caller can audit exactly which facts produced each candidate. */
export function deriveCandidates(prepared: ReturnType<typeof prepareDeductive>,
  question: ParsedQuestion): readonly Derived[] {
  const inScope = new Set<string>();
  const bound = question.scopeBound;
  if (bound !== null && question.scopeDirection !== null) {
    // Directional bound: the bound period itself stays in-scope (a session on
    // the bound day may discuss the event), sessions strictly on the wrong
    // side are out. Granularity widens to month/year when the question omits
    // the day ("after his trip in August 2023" keeps August in-scope).
    const start = Date.UTC(bound.year, (bound.month ?? 1) - 1, bound.day ?? 1);
    const end = bound.day !== null
      ? Date.UTC(bound.year, bound.month! - 1, bound.day, 23, 59, 59, 999)
      : bound.month !== null
        ? Date.UTC(bound.year, bound.month, 0, 23, 59, 59, 999)
        : Date.UTC(bound.year, 11, 31, 23, 59, 59, 999);
    for (const [sessionId, date] of prepared.sessionDates) {
      const instant = parseEvolutionInstant(date);
      if (instant === null) continue;
      const time = Date.parse(instant);
      if ((question.scopeDirection === "before" && time <= end)
        || (question.scopeDirection === "after" && time >= start)) inScope.add(sessionId);
    }
  } else if (question.scopeYears.length > 0) {
    for (const [sessionId, date] of prepared.sessionDates) {
      const lower = date.toLowerCase();
      const yearHit = question.scopeYears.some((year) => lower.includes(year));
      const monthHit = question.scopeMonths.length === 0
        || question.scopeMonths.some((month) => lower.includes(month));
      if (yearHit && monthHit) inScope.add(sessionId);
    }
  }
  const questionDigest = `sha256:${canonicalSha256({ protocol: DEDUCTIVE_RETRIEVAL_PROTOCOL,
    terms: question.terms, entities: question.entities,
    scope: [...inScope].sort(),
    ...(question.scopeDirection === null ? {}
      : { scopeDirection: question.scopeDirection,
          scopeBound: question.scopeBound === null ? null
            : [question.scopeBound.year, question.scopeBound.month, question.scopeBound.day] }) })}`;
  const questionFacts: Snapshot["facts"][number][] = [
    ...question.terms.map((term) => ({ relation: "question-term", tuple: [term], sources: [questionDigest] })),
    ...question.entities.map((entity) => ({ relation: "question-entity", tuple: [entity], sources: [questionDigest] })),
    ...[...inScope].map((sessionId) => ({ relation: "in-scope", tuple: [sessionId], sources: [questionDigest] })),
  ];
  const termSet = new Set(question.terms);
  const entitySet = new Set(question.entities);
  // Sound pruning: a shard contributes rows only if some rule body can fire.
  const activeShards = [...prepared.shards.entries()].filter(([sessionId, snapshot]) => {
    if (snapshot.facts.length + questionFacts.length > 2_048) {
      fail(`shard ${sessionId} plus question facts exceeds the 2048-fact snapshot bound`);
    }
    const summary = prepared.summaries.get(sessionId)!;
    if (inScope.has(sessionId)) return true;
    for (const term of termSet) if (summary.tokens.has(term)) return true;
    for (const entity of entitySet) {
      if (summary.entities.has(entity) || summary.speakers.has(entity)) return true;
    }
    return false;
  });
  const byTurn = new Map<string, { terms: Set<string>; speaker: boolean; scoped: boolean;
    bridges: number; proofs: string[] }>();
  for (const [, snapshot] of activeShards) {
    const withQuestion: Snapshot = { contract: "algal.memory.v1",
      facts: [...snapshot.facts, ...questionFacts] };
    const result = datalogQuery(withQuestion, QUERY_PROGRAM, { evaluation: "indexed" });
    if (!datalogVerify(withQuestion, QUERY_PROGRAM, result)) fail("hit-any result failed replay verification");
    for (const row of result.rows) {
      const turnId = String(row.tuple[0]).replace(/^turn:/, "");
      const entry = byTurn.get(turnId) ?? { terms: new Set<string>(), speaker: false, scoped: false, bridges: 0, proofs: [] };
      const marker = row.tuple[1];
      if (marker === "k:speaker") entry.speaker = true;
      else if (marker === "k:scoped") entry.scoped = true;
      else if (marker === "k:bridge") entry.bridges += 1;
      else entry.terms.add(String(marker));
      entry.proofs.push(row.proof);
      byTurn.set(turnId, entry);
    }
  }
  const turnToSession = new Map<string, string>();
  for (const record of prepared.records) {
    const value = record.value as { id?: unknown; sessionId?: unknown };
    if (typeof value.id === "string" && typeof value.sessionId === "string") {
      turnToSession.set(value.id, value.sessionId);
    }
  }
  // Session coverage: the union of question terms hit by any turn in the same
  // session — derived from the proven rows themselves, no extra evaluation.
  const sessionTerms = new Map<string, Set<string>>();
  for (const [turnId, entry] of byTurn) {
    const sessionId = turnToSession.get(turnId);
    if (sessionId === undefined) continue;
    const set = sessionTerms.get(sessionId) ?? new Set<string>();
    for (const term of entry.terms) set.add(term);
    sessionTerms.set(sessionId, set);
  }
  return [...byTurn.entries()].map(([turnId, entry]) => Object.freeze({
    turnId, sessionId: turnToSession.get(turnId) ?? "",
    terms: entry.terms, speaker: entry.speaker, scoped: entry.scoped,
    sessionCoverage: sessionTerms.get(turnToSession.get(turnId) ?? "")?.size ?? 0,
    bridges: entry.bridges, proofs: Object.freeze(entry.proofs) }));
}

/** Declared scoring: IDF-weighted distinct-term coverage (exact conjunction —
 * every matched term counts once, rare terms weigh more) as the base;
 * speaker and scope multiply the base because conjunction is the deductive
 * edge (a speaker's own turns never name them; a session's date never appears
 * in its text). Session coverage and bridge hits are additive fallbacks for
 * zero-term candidates. A bound date scope demotes out-of-scope turns. */
export function scoreDerived(derived: Derived, question: ParsedQuestion,
  documentFrequency: ReadonlyMap<string, number>, totalTurns: number,
  bridgeWeight = 0.3): number {
  const idf = (term: string) => Math.log(1 + totalTurns / Math.max(1, documentFrequency.get(term) ?? 0));
  const base = [...derived.terms].reduce((sum, term) => sum + idf(term), 0);
  const conjunction = 1 + (derived.speaker ? 0.5 : 0)
    + (question.scopeYears.length > 0 && derived.scoped ? 0.5 : 0);
  // Structural evidence is positive on its own (additive floor), not just a
  // multiplier of term coverage — a speaker's turn inside a scoped session is
  // a real candidate even with zero shared tokens.
  let score = base * conjunction
    + (derived.speaker ? 1 : 0)
    + (question.scopeYears.length > 0 && derived.scoped ? 1.5 : 0)
    + derived.sessionCoverage * 0.5
    + Math.min(derived.bridges, 3) * bridgeWeight;
  if (question.scopeYears.length > 0 && !derived.scoped) score *= 0.2;
  return score;
}

/** The full selection pipeline up to (but excluding) byte packing: parsed
 * question, derived rows, merged ranking, chosen seeds, and the ordered
 * candidate list pack() will consume. Exported so miss analysis audits the
 * exact same stages the retriever runs — no duplicated logic. */
export function deductivePlan(corpus: Corpus, prepared: ReturnType<typeof prepareDeductive>,
  system: DeductiveSystem, question: string, budget: RetrievalBudget,
  options: Readonly<{ sessionCap?: number; windowRadius?: number;
    diverseFill?: boolean; bridgeWeight?: number }> = {}): {
    readonly parsed: ParsedQuestion; readonly derived: readonly Derived[];
    readonly seeds: readonly { turnId: string; score: number; bm25: number }[];
    readonly candidates: readonly { turn: Turn; digest?: string }[];
  } {
  if (!DEDUCTIVE_SYSTEMS.includes(system)) fail(`unknown deductive system ${system}`);
  const parsed = parseQuestion(question);
  const derived = deriveCandidates(prepared, parsed);
  const totalTurns = corpus.turns.length;
  const scores = new Map(derived.map((row) =>
    [row.turnId, scoreDerived(row, parsed, prepared.documentFrequency, totalTurns,
      options.bridgeWeight ?? 0.3)]));
  // Chronology ordering: a "first/last" cue breaks score ties by the turn's
  // real instant (parsed under the declared benchmark grammars), so the
  // earliest or latest derivation surfaces first.
  const instantOf = new Map<string, number>();
  if (parsed.chronology !== null) {
    for (const row of derived) {
      const index = prepared.positionOf.get(row.turnId);
      if (index === undefined) continue;
      const instant = parseEvolutionInstant(corpus.turns[index]!.date);
      if (instant !== null) instantOf.set(row.turnId, Date.parse(instant));
    }
  }
  const chrono = (turnId: string): number => {
    const instant = instantOf.get(turnId) ?? 0;
    return parsed.chronology === "asc" ? instant : -instant;
  };
  const positions = prepared.positionOf;
  const candidateOf = (turnId: string) => {
    const index = positions.get(turnId);
    if (index === undefined) return undefined;
    const record = prepared.store.get(prepared.records[index]!.key);
    if (record === null) return undefined;
    const value = record.value as Turn;
    return { turn: { id: value.id, sessionId: value.sessionId,
      ...(value.sessionIndex === undefined ? {} : { sessionIndex: value.sessionIndex }),
      date: value.date, speaker: value.speaker, text: value.text },
      digest: record.recordSha256 };
  };
  const bm25Order = (limit: number): number[] => {
    const terms = queryTerms(question, true);
    const match = terms.map((term) => `"${term}"`).join(" OR ");
    return match ? prepared.fts.query<{ turn_index: number }, [string, number]>(
      "SELECT turn_index FROM passages WHERE passages MATCH ? ORDER BY bm25(passages), turn_index LIMIT ?",
    ).all(match, limit).map((hit) => hit.turn_index) : [];
  };
  // Pure `deductive` returns positive derivations only: a score ≤ 0 means the
  // turn is out-of-scope or supported solely by mechanisms that fired empty.
  const ordered: { turnId: string; score: number; bm25: number }[] = derived
    .map((row) => ({ turnId: row.turnId, score: scores.get(row.turnId)!, bm25: -1 }))
    .filter((row) => system === "deductive-union" || row.score > 0)
    .sort((a, b) => b.score - a.score || chrono(a.turnId) - chrono(b.turnId)
      || String(a.turnId).localeCompare(String(b.turnId)));
  const bm25Ranked = bm25Order(Math.max(budget.topK, 64));
  bm25Ranked.forEach((index, rank) => {
    const turnId = corpus.turns[index]!.id;
    const existing = ordered.find((row) => row.turnId === turnId);
    if (existing !== undefined) existing.bm25 = rank;
    else if (system === "deductive-union") ordered.push({ turnId, score: 0, bm25: rank });
  });
  const merged = system === "deductive-union"
    ? ordered.sort((a, b) => (b.score - a.score) || chrono(a.turnId) - chrono(b.turnId)
        || (a.bm25 === -1 ? 64 : a.bm25) - (b.bm25 === -1 ? 64 : b.bm25)
        || String(a.turnId).localeCompare(String(b.turnId)))
    : ordered;
  // Multi-evidence questions need seed diversity, not one dense cluster: cap
  // seeds per session, then backfill by score so the budget still fills.
  const sessionCap = options.sessionCap;
  const sessionOf = (turnId: string): string => {
    const index = positions.get(turnId);
    return index === undefined ? "" : corpus.turns[index]!.sessionId;
  };
  let seeds = merged.slice(0, budget.topK);
  if (sessionCap !== undefined && sessionCap > 0) {
    const counts = new Map<string, number>();
    const capped: typeof merged = [], overflow: typeof merged = [];
    for (const row of merged) {
      const session = sessionOf(row.turnId);
      const n = counts.get(session) ?? 0;
      if (n < sessionCap) { counts.set(session, n + 1); capped.push(row); }
      else overflow.push(row);
    }
    seeds = [...capped, ...overflow].slice(0, budget.topK);
  }
  const seedIds = new Set(seeds.map((row) => row.turnId));
  // Radius 2 (five-turn windows) is the declared default — one turn narrower
  // than a six-turn retrieval block, tuned on the dev split only. Every seed
  // widens fully: probes showed restricting tail-seed windows and shrinking
  // radius on spread evidence both lose more recall than they save.
  const radius = options.windowRadius ?? 2;
  if (!Number.isSafeInteger(radius) || radius < 0 || radius > 8) fail("invalid windowRadius");
  const candidates = seeds.flatMap(({ turnId }) => {
    const candidate = candidateOf(turnId);
    if (candidate === undefined) return [];
    const position = positions.get(turnId)!;
    const neighbors = Array.from({ length: radius * 2 + 1 }, (_, i) => position - radius + i)
      .filter((index) => index !== position
        && corpus.turns[index]?.sessionId === candidate.turn.sessionId
        && corpus.turns[index]?.sessionIndex === candidate.turn.sessionIndex)
      .flatMap((index) => {
        const neighbor = candidateOf(corpus.turns[index]!.id);
        return neighbor === undefined ? [] : [neighbor];
      });
    return [candidate, ...neighbors];
  });
  // Directed session fill: every remaining positive derivation — in ANY
  // session, not only seeded ones — appended after the windows. Default is
  // round-robin across sessions (the best remaining derivation per session,
  // cycling): enumeration evidence is spread thin across sessions, and a
  // fresh session's top derivation beats the same session's fifth. Adjacency
  // near a hit is stronger evidence than a weak distant derivation, so
  // windows pack first; the fill is the expansion bm25 cannot express
  // because it sees no per-turn derived coverage.
  const inWindow = new Set(candidates.map((c) => c.turn.id));
  const fillRows = merged
    .filter((row) => !seedIds.has(row.turnId) && !inWindow.has(row.turnId)
      && (scores.get(row.turnId) ?? 0) > 0);
  const fillOrdered = options.diverseFill !== false
    ? (() => {
        const bySession = new Map<string, typeof fillRows>();
        for (const row of fillRows) {
          const session = sessionOf(row.turnId);
          const list = bySession.get(session) ?? [];
          list.push(row);
          bySession.set(session, list);
        }
        const queues = [...bySession.values()];
        const out: typeof fillRows = [];
        for (let depth = 0; queues.some((queue) => depth < queue.length); depth++) {
          for (const queue of queues) if (depth < queue.length) out.push(queue[depth]!);
        }
        return out;
      })()
    : fillRows;
  const sessionFill = fillOrdered
    .flatMap((row) => {
      const candidate = candidateOf(row.turnId);
      return candidate === undefined ? [] : [candidate];
    })
    .slice(0, budget.topK);
  return { parsed, derived, seeds, candidates: [...candidates, ...sessionFill] };
}

export function deductiveRetrieve(corpus: Corpus, prepared: ReturnType<typeof prepareDeductive>,
  system: DeductiveSystem, question: string, budget: RetrievalBudget,
  options: Readonly<{ sessionCap?: number; windowRadius?: number;
    diverseFill?: boolean; bridgeWeight?: number }> = {}): Retrieved {
  const plan = deductivePlan(corpus, prepared, system, question, budget, options);
  return pack(plan.candidates, budget.contextBytes);
}
