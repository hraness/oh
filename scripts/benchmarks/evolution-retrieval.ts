import { Database } from "bun:sqlite";
import { isAbsolute, join } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { OH_RECALL_RENDERER_V1, recallOhV1, renderOhRecallV1, resolveRelativeDateWindowV1,
  type OhRecallRecordViewV1, type OhRecallViewV1, type OhRecallWindowV1 } from "../../src/recall";
import { searchOhV1 } from "../../src/search";
import { OH_EMBEDDING_PROFILE_V1, OhQmdSemanticBackendV1, type OhSemanticSearchBackendV1 } from "../../src/semantic";
import { OhSqliteStore } from "../../src/sqlite/store";
import type { Corpus, Turn } from "./datasets";
import { evolutionInstant, evolutionQuestionInstant } from "./evolution-dates";
import { pack, queryTerms, renderTurn, type RetrievalBudget } from "./retrieval";

export const EVOLUTION_RETRIEVAL_SYSTEMS = ["bm25-window", "bm25-session", "oh-keyword",
  "oh-keyword-window", "oh-focused", "oh-focused-window", "oh-focused-window-opening",
  "oh-semantic", "oh-hybrid", "bm25-facets", "oh-facets", "oh-recall", "oh-recall-mq", "oh-recall-mq-dw"] as const;
/** Recall systems render through the product recall renderer and emit the V2 result protocol. */
export const EVOLUTION_RECALL_SYSTEMS = ["oh-recall", "oh-recall-mq", "oh-recall-mq-dw"] as const;
export type EvolutionRetrievalSystem = typeof EVOLUTION_RETRIEVAL_SYSTEMS[number];
export type EvolutionRecallSystem = typeof EVOLUTION_RECALL_SYSTEMS[number];
export type EvolutionRetrievalVariant = Readonly<{ id: string; system: EvolutionRetrievalSystem; budget: RetrievalBudget }>;
export type EvolutionRecallVariant = Readonly<{ id: string; system: EvolutionRecallSystem; budget: RetrievalBudget }>;
export type EvolutionLegacyVariant = Readonly<{ id: string; system: Exclude<EvolutionRetrievalSystem, EvolutionRecallSystem>; budget: RetrievalBudget }>;
export function isEvolutionRecallSystem(system: string): system is EvolutionRecallSystem {
  return (EVOLUTION_RECALL_SYSTEMS as readonly string[]).includes(system);
}
/** Protocols defined over V1 whole-turn results refuse a recall variant or result instead of misreading it. */
export function evolutionLegacyVariant(variant: EvolutionRetrievalVariant): EvolutionLegacyVariant {
  if (isEvolutionRecallSystem(variant.system)) throw new TypeError("Evolution recall systems need a context plan that carries the question date.");
  return variant as EvolutionLegacyVariant;
}
export function evolutionLegacyResult(result: EvolutionAnyRetrievalResult): EvolutionRetrievalResult {
  if (result.protocol !== "oh.evolution-retrieval.v1") throw new TypeError("Evolution recall results are not admitted by this V1 whole-turn protocol.");
  return result;
}
/** Systems whose prepared identity and source validation carry the semantic profile. */
export function evolutionSystemUsesSemantic(system: string): boolean {
  return system === "oh-semantic" || system === "oh-hybrid" || isEvolutionRecallSystem(system);
}
export type EvolutionSourceIdentity = Readonly<{ turnId: string; sessionId: string; key: string; recordSha256: string }>;
export type EvolutionPreparedIdentity = Readonly<{ protocol: "oh.evolution-prepared.v1"; corpusId: string;
  corpusSha256: string; sourceRecordsSha256: string; sourceRecordCount: number;
  semanticProfileSha256: string | null; preparedSha256: string }>;
export type EvolutionRetrievalResult = Readonly<{ protocol: "oh.evolution-retrieval.v1"; preparedSha256: string;
  variantSha256: string; querySha256: string; context: string; contextSha256: string; contextBytes: number;
  turnIds: readonly string[]; sessionIds: readonly string[]; sources: readonly EvolutionSourceIdentity[];
  omittedForBudget: number; facets: readonly string[]; coveredFacets: readonly number[];
  coverageKind: "lexical-clause" | null; resultSha256: string }>;
/** V2 keeps turnIds/sessionIds/sources describing raw turns; `derived` is reserved for derived records (empty here). */
export type EvolutionRetrievalResultV2 = Readonly<{ protocol: "oh.evolution-retrieval.v2"; preparedSha256: string;
  variantSha256: string; querySha256: string; asOf: string | null; renderer: typeof OH_RECALL_RENDERER_V1;
  queries: readonly string[]; window: OhRecallWindowV1 | null; context: string; contextSha256: string; contextBytes: number;
  turnIds: readonly string[]; sessionIds: readonly string[]; sources: readonly EvolutionSourceIdentity[];
  derived: readonly never[]; omittedForBudget: number; resultSha256: string }>;
export type EvolutionAnyRetrievalResult = EvolutionRetrievalResult | EvolutionRetrievalResultV2;
/** The V2 validator re-derives queries, the question instant and the date window from the question and the recall system. */
export type EvolutionResultQuestion = Readonly<{ question: string; questionDate: string; system: EvolutionRecallSystem }>;
export type EvolutionPreparationStats = Readonly<{ rawIndexBuilds: number; sessionIndexBuilds: number;
  authorityBuilds: number; semanticIndexBuilds: number; queryCount: number }>;
export type EvolutionPreparedCorpus = Readonly<{ identity: EvolutionPreparedIdentity;
  stats: EvolutionPreparationStats;
  retrieve(question: string, variant: EvolutionRecallVariant, questionDate: string): Promise<EvolutionRetrievalResultV2>;
  retrieve(question: string, variant: EvolutionLegacyVariant, questionDate?: string): Promise<EvolutionRetrievalResult>;
  retrieve(question: string, variant: EvolutionRetrievalVariant, questionDate?: string): Promise<EvolutionAnyRetrievalResult>;
  close(): Promise<void> }>;

/** The whole question first, then the focused term form and bounded lexical clauses; distinct, at most six. */
export function evolutionRecallQueries(question: string, system: EvolutionRecallSystem): readonly string[] {
  bounded(question, 16_384, "question");
  if (system === "oh-recall") return Object.freeze([question]);
  const focused = queryTerms(question, true).join(" ");
  return Object.freeze([...new Set([question, focused, ...evolutionQuestionFacets(question)].filter(Boolean))].slice(0, 6));
}
/** The date window is a question-text rule applied only by the `-dw` system and only under a question instant. */
export function evolutionRecallWindow(question: string, system: EvolutionRecallSystem, asOf: string | null): OhRecallWindowV1 | null {
  if (system !== "oh-recall-mq-dw" || asOf === null) return null;
  const resolved = resolveRelativeDateWindowV1(question, asOf);
  return resolved === null ? null : { since: resolved.since, until: resolved.until, v: 1 };
}
/** Raw turn view for the recall renderer: source order within a session occurrence, raw rendered line unchanged.
 * Every turn date must parse under the declared benchmark grammars; recall systems fail closed on an unknown date. */
export function evolutionTurnView(turn: Turn, index: number): OhRecallRecordViewV1 {
  return { instant: evolutionInstant(turn.date, "turn date"), order: index,
    session: JSON.stringify([turn.sessionId, turn.sessionIndex ?? null]), text: renderTurn(turn) };
}

export class EvolutionSemanticUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "EvolutionSemanticUnavailableError"; }
}

function bounded(value: unknown, maximum: number, label: string, empty = false): string {
  if (typeof value !== "string" || (!empty && value.length === 0) || Buffer.byteLength(value) > maximum) {
    throw new TypeError(`Invalid evolution ${label}.`);
  }
  return value;
}
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

/** Whitelist source fields before detachment; gold or extra-property getters are never read. */
function detachCorpus(input: Corpus): Corpus {
  const id = bounded(input.id, 512, "corpus ID"), groupId = bounded(input.groupId, 512, "group ID");
  if (!Array.isArray(input.turns) || input.turns.length < 1 || input.turns.length > 8192) {
    throw new RangeError("Evolution corpus must contain 1–8192 turns.");
  }
  let bytes = 0;
  const turns = input.turns.map((turn): Turn => {
    const sessionIndex = turn.sessionIndex;
    if (sessionIndex !== undefined && (!Number.isSafeInteger(sessionIndex) || sessionIndex < 0)) {
      throw new TypeError("Invalid evolution session occurrence.");
    }
    const detached = { id: bounded(turn.id, 512, "turn ID"), sessionId: bounded(turn.sessionId, 512, "session ID"),
      ...(sessionIndex === undefined ? {} : { sessionIndex }), date: bounded(turn.date, 256, "date", true),
      speaker: bounded(turn.speaker, 512, "speaker"), text: bounded(turn.text, 524_288, "turn text", true) };
    bytes += Buffer.byteLength(canonicalJson(detached));
    if (bytes > 32 * 1024 * 1024) throw new RangeError("Evolution corpus exceeds 32 MiB.");
    return immutable(detached);
  });
  if (new Set(turns.map(turn => turn.id)).size !== turns.length) throw new TypeError("Duplicate evolution turn ID.");
  return immutable({ id, groupId, turns });
}

function checkedVariant(input: EvolutionRetrievalVariant): EvolutionRetrievalVariant {
  const id = bounded(input.id, 512, "variant ID");
  if (!EVOLUTION_RETRIEVAL_SYSTEMS.includes(input.system)) throw new TypeError("Unknown evolution retrieval system.");
  const { topK, contextBytes } = input.budget;
  if (!Number.isSafeInteger(topK) || topK < 1 || topK > 400 || !Number.isSafeInteger(contextBytes)
    || contextBytes < 1 || contextBytes > 4_000_000) throw new RangeError("Invalid evolution retrieval budget.");
  return immutable({ id, system: input.system, budget: { topK, contextBytes } });
}

/** A bounded lexical clause splitter, not a semantic planner or a benchmark-category router. */
export function evolutionQuestionFacets(question: string): readonly string[] {
  bounded(question, 16_384, "question");
  const clauses = question.split(/\s+(?:and|versus|vs\.?|compared (?:with|to))\s+|[;?]/iu)
    .map(clause => queryTerms(clause, true).join(" ")).filter(Boolean);
  return Object.freeze([...new Set(clauses)].slice(0, 4));
}

function preparedIdentity(corpus: Corpus, records: readonly KnowledgeGraphRecordV1[], semantic: boolean): EvolutionPreparedIdentity {
  const payload = { protocol: "oh.evolution-prepared.v1" as const, corpusId: corpus.id, corpusSha256: canonicalSha256(corpus),
    sourceRecordsSha256: canonicalSha256(records.map(record => ({ key: record.key, recordSha256: record.recordSha256 }))),
    sourceRecordCount: records.length, semanticProfileSha256: semantic ? canonicalSha256(OH_EMBEDDING_PROFILE_V1) : null };
  return immutable({ ...payload, preparedSha256: canonicalSha256(payload) });
}
function corpusRecords(corpus: Corpus): readonly KnowledgeGraphRecordV1[] {
  return immutable(corpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({ dependencies: [],
    key: `edition:turn-${index.toString().padStart(5, "0")}`, kind: "edition", v: 1, value: { ...turn } })));
}
function distinctiveFacetTerms(facets: readonly string[]): readonly (readonly string[])[] {
  const facetTerms = facets.map(facet => new Set(queryTerms(facet, true)));
  return facetTerms.map((terms, f) => {
    const unique = [...terms].filter(term => !facetTerms.some((other, i) => i !== f && other.has(term)));
    return unique.length ? unique : [...terms];
  });
}
function lexicalFacetCoverage(facets: readonly string[], turns: readonly Turn[]): number[] {
  const terms = new Set(turns.flatMap(turn => queryTermsForCoverage(turn.text)));
  return distinctiveFacetTerms(facets).flatMap((facet, f) => facet.some(term => terms.has(term)) ? [f] : []);
}

/** Cheap source-only cache verification. Build once per corpus and reuse across result rows.
 * This proves current source rendering/provenance, not that search chose the optimal ranked subset. */
export function createEvolutionContextSourceValidator(input: Corpus, options: Readonly<{ semantic?: boolean; derivedRecords?: readonly never[] }> = {}) {
  if (options.semantic !== undefined && typeof options.semantic !== "boolean") throw new TypeError("Invalid semantic source identity.");
  if (options.derivedRecords !== undefined && (!Array.isArray(options.derivedRecords) || options.derivedRecords.length !== 0)) {
    throw new TypeError("Evolution derived records are not admitted by this validator version.");
  }
  const corpus = detachCorpus(input), records = corpusRecords(corpus), identity = preparedIdentity(corpus, records, options.semantic === true);
  const positions = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  const byKey = new Map(records.map((record, index) => [record.key, index]));
  const turnView: OhRecallViewV1 = record => {
    const index = byKey.get(record.key);
    if (index === undefined || records[index]!.recordSha256 !== record.recordSha256) throw new TypeError("Evolution recall rendering saw a foreign record.");
    return evolutionTurnView(corpus.turns[index]!, index);
  };
  /** V2: the renderer sees the question instant, so the validator must receive the question to re-render. */
  const validateV2 = (value: Record<string, unknown>, question: EvolutionResultQuestion | undefined): void => {
    const fail = (): never => { throw new TypeError("Evolution context source identity or rendering mismatch."); };
    if (question === undefined || typeof question.question !== "string" || typeof question.questionDate !== "string"
      || !isEvolutionRecallSystem(question.system)) {
      throw new TypeError("Evolution V2 context validation requires the question, its date, and the recall system.");
    }
    if (!hasExactKeys(value, ["protocol", "preparedSha256", "variantSha256", "querySha256", "asOf", "renderer", "queries", "window", "context",
      "contextSha256", "contextBytes", "turnIds", "sessionIds", "sources", "derived", "omittedForBudget", "resultSha256"])
      || value.protocol !== "oh.evolution-retrieval.v2" || value.preparedSha256 !== identity.preparedSha256
      || parseSha256Hex(value.variantSha256) === null || value.querySha256 !== sha256Hex(question.question)
      || value.renderer !== OH_RECALL_RENDERER_V1 || !Array.isArray(value.queries) || value.queries.length < 1 || value.queries.length > 6
      || value.queries.some(query => typeof query !== "string" || query.length === 0 || Buffer.byteLength(query) > 16_384)
      || typeof value.context !== "string" || Buffer.byteLength(value.context) > 4_000_000
      || !Number.isSafeInteger(value.contextBytes) || value.contextBytes !== Buffer.byteLength(value.context)
      || !Array.isArray(value.turnIds) || value.turnIds.length > corpus.turns.length
      || value.turnIds.some(id => typeof id !== "string" || !positions.has(id)) || new Set(value.turnIds).size !== value.turnIds.length
      || !Array.isArray(value.sources) || value.sources.length !== value.turnIds.length
      || !Array.isArray(value.sessionIds) || value.sessionIds.length > value.turnIds.length || value.sessionIds.some(id => typeof id !== "string")
      || !Array.isArray(value.derived) || value.derived.length !== 0
      || typeof value.omittedForBudget !== "number" || !Number.isSafeInteger(value.omittedForBudget)
      || value.omittedForBudget < 0 || value.omittedForBudget > 8192) fail();
    const asOf = evolutionQuestionInstant(question.questionDate);
    if (value.asOf !== asOf) fail();
    if (canonicalSha256(value.queries) !== canonicalSha256(evolutionRecallQueries(question.question, question.system))
      || canonicalSha256(value.window) !== canonicalSha256(evolutionRecallWindow(question.question, question.system, asOf))) fail();
    const selected = (value.turnIds as readonly string[]).map(id => positions.get(id)!);
    const turns = selected.map(index => corpus.turns[index]!);
    const expectedSources = selected.map(index => ({ turnId: corpus.turns[index]!.id, sessionId: corpus.turns[index]!.sessionId,
      key: records[index]!.key, recordSha256: records[index]!.recordSha256 }));
    // The rendering re-derives from source with an unbounded budget: the selected set is already within its variant budget.
    const rendering = renderOhRecallV1({ results: selected.map(index => ({ record: records[index]! })) },
      { asOf, budgetBytes: 4_000_000, view: turnView });
    const { resultSha256, ...payload } = value;
    if (rendering.omitted !== 0 || rendering.text !== value.context || sha256Hex(rendering.text) !== value.contextSha256
      || canonicalSha256(rendering.keys) !== canonicalSha256(selected.map(index => records[index]!.key))
      || canonicalSha256(expectedSources) !== canonicalSha256(value.sources)
      || canonicalSha256([...new Set(turns.map(turn => turn.sessionId))]) !== canonicalSha256(value.sessionIds)
      || canonicalSha256(payload) !== resultSha256) fail();
  };
  return (value: EvolutionAnyRetrievalResult, question?: EvolutionResultQuestion): void => {
    if (isPlainRecord(value) && value.protocol === "oh.evolution-retrieval.v2") { validateV2(value, question); return; }
    const fail = (): never => { throw new TypeError("Evolution context source identity or rendering mismatch."); };
    if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "preparedSha256", "variantSha256", "querySha256", "context", "contextSha256",
      "contextBytes", "turnIds", "sessionIds", "sources", "omittedForBudget", "facets", "coveredFacets", "coverageKind", "resultSha256"])
      || value.protocol !== "oh.evolution-retrieval.v1" || value.preparedSha256 !== identity.preparedSha256
      || parseSha256Hex(value.variantSha256) === null || parseSha256Hex(value.querySha256) === null
      || typeof value.context !== "string" || Buffer.byteLength(value.context) > 4_000_000
      || !Number.isSafeInteger(value.contextBytes) || value.contextBytes !== Buffer.byteLength(value.context)
      || !Array.isArray(value.turnIds) || value.turnIds.length > corpus.turns.length
      || value.turnIds.some(id => typeof id !== "string" || !positions.has(id)) || new Set(value.turnIds).size !== value.turnIds.length
      || !Array.isArray(value.sources) || value.sources.length !== value.turnIds.length
      || !Array.isArray(value.sessionIds) || value.sessionIds.length > value.turnIds.length || value.sessionIds.some(id => typeof id !== "string")
      || !Number.isSafeInteger(value.omittedForBudget) || value.omittedForBudget < 0 || value.omittedForBudget > corpus.turns.length
      || !Array.isArray(value.facets) || value.facets.length > 4
      || value.facets.some(facet => typeof facet !== "string" || facet.length === 0 || Buffer.byteLength(facet) > 16_384)
      || new Set(value.facets).size !== value.facets.length || !Array.isArray(value.coveredFacets) || value.coveredFacets.length > value.facets.length
      || value.coveredFacets.some(facet => !Number.isSafeInteger(facet) || facet < 0 || facet >= value.facets.length)
      || ![null, "lexical-clause"].includes(value.coverageKind)
      || value.coverageKind === null && (value.facets.length !== 0 || value.coveredFacets.length !== 0)) fail();
    const selected = value.turnIds.map(id => positions.get(id)!);
    const turns = selected.map(index => corpus.turns[index]!);
    const expectedSources = selected.map(index => ({ turnId: corpus.turns[index]!.id, sessionId: corpus.turns[index]!.sessionId,
      key: records[index]!.key, recordSha256: records[index]!.recordSha256 }));
    const context = turns.map(renderTurn).join("\n\n");
    const { resultSha256, ...payload } = value;
    if (context !== value.context || sha256Hex(context) !== value.contextSha256
      || canonicalSha256(expectedSources) !== canonicalSha256(value.sources)
      || canonicalSha256([...new Set(turns.map(turn => turn.sessionId))]) !== canonicalSha256(value.sessionIds)
      || canonicalSha256(lexicalFacetCoverage(value.facets, turns)) !== canonicalSha256(value.coveredFacets)
      || canonicalSha256(payload) !== resultSha256) fail();
  };
}

export function validateEvolutionContextSources(corpus: Corpus, result: EvolutionAnyRetrievalResult,
  options: Readonly<{ semantic?: boolean; question?: EvolutionResultQuestion }> = {}): void {
  const { question, ...rest } = options;
  createEvolutionContextSourceValidator(corpus, rest)(result, question);
}

/** The prepared object owns the optional backend; do not share a mutable QMD collection across corpora. */
export async function prepareEvolutionCorpus(input: Corpus, options: Readonly<{
  semanticBackend?: OhSemanticSearchBackendV1; semanticCacheDirectory?: string;
}> = {}): Promise<EvolutionPreparedCorpus> {
  if (options.semanticBackend !== undefined && options.semanticCacheDirectory !== undefined) {
    throw new TypeError("Select either an evolution semantic backend or a cache directory.");
  }
  if (options.semanticCacheDirectory !== undefined && !isAbsolute(options.semanticCacheDirectory)) {
    throw new TypeError("Evolution semantic cache directory must be absolute.");
  }
  const corpus = detachCorpus(input), turns = corpus.turns;
  const records = corpusRecords(corpus);
  const corpusSha256 = canonicalSha256(corpus), profileSha256 = canonicalSha256(OH_EMBEDDING_PROFILE_V1);
  let backend = options.semanticBackend;
  if (backend !== undefined && canonicalSha256(backend.profile) !== profileSha256) {
    throw new TypeError("Evolution requires the pinned Oh semantic profile.");
  }
  if (options.semanticCacheDirectory !== undefined) {
    backend = new OhQmdSemanticBackendV1({ cacheDirectory: join(options.semanticCacheDirectory, corpusSha256) });
  }
  const identity = preparedIdentity(corpus, records, backend !== undefined);
  const sources = records.map((record, index) => immutable({ turnId: turns[index]!.id,
    sessionId: turns[index]!.sessionId, key: record.key, recordSha256: record.recordSha256 }));
  const byKey = new Map(records.map((record, index) => [record.key, index]));
  const byTurn = new Map(turns.map((turn, index) => [turn.id, index]));
  const sessions: number[][] = [], occurrences = new Map<string, number[]>();
  const occurrenceKey = (turn: Turn) => JSON.stringify([turn.sessionId, turn.sessionIndex ?? null]);
  turns.forEach((turn, index) => {
    const key = occurrenceKey(turn);
    let session = occurrences.get(key);
    if (session === undefined) { session = []; sessions.push(session); occurrences.set(key, session); }
    session.push(index);
  });
  const openings = new Map([...occurrences].map(([key, indices]) => [key,
    indices.find(index => turns[index]!.speaker.toLowerCase() === "user") ?? indices[0]!]));
  const database = new Database(":memory:");
  try {
    database.run("CREATE VIRTUAL TABLE passages USING fts5(turn_index UNINDEXED, text, tokenize='unicode61 remove_diacritics 2')");
    database.run("CREATE VIRTUAL TABLE sessions USING fts5(text, tokenize='unicode61 remove_diacritics 2')");
    const passage = database.prepare("INSERT INTO passages (turn_index, text) VALUES (?, ?)");
    const session = database.prepare("INSERT INTO sessions (rowid, text) VALUES (?, ?)");
    database.transaction(() => {
      turns.forEach((turn, index) => passage.run(index, renderTurn(turn)));
      sessions.forEach((indices, index) => session.run(index + 1, indices.map(i => renderTurn(turns[i]!)).join("\n\n")));
    })();
  } catch (error) { database.close(); await backend?.close(); throw error; }
  const stats = { rawIndexBuilds: 1, sessionIndexBuilds: 1, authorityBuilds: 0, semanticIndexBuilds: 0, queryCount: 0 };
  let authority: OhSqliteStore | undefined, authorityHeadSha256: string | undefined;
  let semanticReady: Promise<void> | undefined, closing = false, closeResult: Promise<void> | undefined;
  const active = new Set<Promise<EvolutionAnyRetrievalResult>>();

  function ensureAuthority(): OhSqliteStore {
    if (authority !== undefined) return authority;
    const store = new OhSqliteStore({ path: ":memory:", spaceId: "evolution" });
    try {
      for (let start = 0; start < records.length;) {
        const changes: Array<{ kind: "put"; record: KnowledgeGraphRecordV1; v: 1 }> = [];
        let bytes = 2;
        while (start + changes.length < records.length && changes.length < 512) {
          const change = { kind: "put" as const, record: records[start + changes.length]!, v: 1 as const };
          const size = Buffer.byteLength(canonicalJson(change)) + 1;
          if (changes.length && bytes + size > 4 * 1024 * 1024) break;
          changes.push(change); bytes += size;
        }
        store.commit({ actorId: "evolution.prepare", changes, expectedHead: store.head(),
          instant: "2026-01-01T00:00:00.000Z", operationId: `op_evolution_${start}` });
        start += changes.length;
      }
      authorityHeadSha256 = canonicalSha256(store.head());
      authority = store; stats.authorityBuilds += 1;
      return store;
    } catch (error) { store.close(); throw error; }
  }
  function currentSources(indices: readonly number[]): void {
    if (authority === undefined) return;
    if (canonicalSha256(authority.head()) !== authorityHeadSha256) throw new Error("Evolution prepared authority changed.");
    for (const index of indices) {
      if (authority.get(records[index]!.key)?.recordSha256 !== records[index]!.recordSha256) {
        throw new Error("Evolution source digest is no longer current.");
      }
    }
  }
  const neighbors = (index: number): number[] => [index - 1, index + 1].filter(i => turns[i] !== undefined
    && turns[i]!.sessionId === turns[index]!.sessionId && turns[i]!.sessionIndex === turns[index]!.sessionIndex);
  /** Add the opening user message once per represented occurrence. Admission
   * of an opener and its first retained candidate is atomic: an opener cannot
   * displace the source that introduced it. Later displacement remains a
   * measured tradeoff of this explicitly selected experiment. */
  function packOpeningIndices(candidates: readonly number[], budget: number) {
    const selected: number[] = [], seen = new Set<number>(), represented = new Set<string>();
    let bytes = 0, omittedForBudget = 0;
    const size = (index: number) => Buffer.byteLength(renderTurn(turns[index]!));
    const add = (index: number) => { bytes += size(index) + (selected.length ? 2 : 0); selected.push(index); seen.add(index); };
    for (const index of candidates) {
      if (seen.has(index)) continue;
      seen.add(index);
      const needed = size(index) + (selected.length ? 2 : 0);
      if (bytes + needed > budget) { omittedForBudget++; continue; }
      const key = occurrenceKey(turns[index]!), opening = openings.get(key)!;
      if (!represented.has(key) && opening !== index && !seen.has(opening)) {
        // The two messages need one separator between them, as well as the
        // separator from any preceding context. A rejected opener stays omitted.
        if (bytes + needed + size(opening) + 2 <= budget) add(opening);
        else { seen.add(opening); omittedForBudget++; }
      }
      add(index); represented.add(key);
    }
    return { indices: selected, omittedForBudget };
  }
  function rawRank(question: string, topK: number, wholeSession = false): number[] {
    const match = queryTerms(question, true).map(term => `"${term}"`).join(" OR ");
    if (!match) return [];
    if (wholeSession) return database.query<{ id: number }, [string, number]>(
      "SELECT rowid AS id FROM sessions WHERE sessions MATCH ? ORDER BY bm25(sessions), rowid LIMIT ?",
    ).all(match, topK).flatMap(hit => sessions[hit.id - 1]!);
    return database.query<{ turn_index: number }, [string, number]>(
      "SELECT turn_index FROM passages WHERE passages MATCH ? ORDER BY bm25(passages), turn_index LIMIT ?",
    ).all(match, topK).map(hit => hit.turn_index);
  }
  /** Authority plus the digest-checked optional backend, with the semantic index built once for the first non-keyword read. */
  async function searchSurface(mode: "keyword" | "semantic" | "hybrid"): Promise<Readonly<{ store: OhSqliteStore; checkedBackend: OhSemanticSearchBackendV1 | undefined }>> {
    if (mode !== "keyword" && backend === undefined) throw new EvolutionSemanticUnavailableError("Oh semantic backend is not configured.");
    const store = ensureAuthority();
    currentSources([]);
    if (mode !== "keyword") {
      semanticReady ??= (async () => {
        try {
          const indexed = await backend!.index(records);
          if (indexed.indexed !== records.length || indexed.v !== 1) throw new Error("Incomplete semantic index.");
          stats.semanticIndexBuilds += 1;
        } catch (error) { throw new EvolutionSemanticUnavailableError(`Oh semantic indexing failed: ${error instanceof Error ? error.message : "unknown error"}`); }
      })();
      await semanticReady;
    }
    // searchOhV1 rejoins by key; validate the optional backend's digest before that join too.
    const checkedBackend: OhSemanticSearchBackendV1 | undefined = backend === undefined ? undefined : {
      profile: backend.profile, index: records => backend!.index(records), close: () => backend!.close(),
      async search(query, limit, current) {
        const hits = await backend!.search(query, limit, current);
        if (!Array.isArray(hits) || hits.length > 100) throw new Error("Unbounded semantic results.");
        for (const hit of hits) {
          const index = byKey.get(hit.key);
          if (index === undefined || hit.v !== 1 || !Number.isFinite(hit.score)
            || hit.recordSha256 !== records[index]!.recordSha256
            || current.get(hit.key)?.recordSha256 !== hit.recordSha256) {
            throw new Error("Semantic result is not the current prepared source.");
          }
        }
        return hits;
      },
    };
    return { store, checkedBackend };
  }
  function sourceIndex(record: KnowledgeGraphRecordV1): number {
    const index = byKey.get(record.key);
    if (index === undefined || record.recordSha256 !== records[index]!.recordSha256) {
      throw new Error("Oh search returned a different evolution source.");
    }
    return index;
  }
  async function ohRank(question: string, topK: number, mode: "keyword" | "semantic" | "hybrid"): Promise<number[]> {
    const { store, checkedBackend } = await searchSurface(mode);
    const response = await searchOhV1({ store, query: question, limit: topK, mode,
      ...(checkedBackend === undefined ? {} : { backend: checkedBackend }) });
    currentSources([]);
    if (response.diagnostics.length) throw new EvolutionSemanticUnavailableError("Oh semantic search failed; a keyword fallback is not an evaluated semantic result.");
    return response.results.map(result => sourceIndex(result.record));
  }
  const turnView: OhRecallViewV1 = record => evolutionTurnView(turns[sourceIndex(record)]!, sourceIndex(record));
  /** Recall systems: semantic-mode V1 searches per query, fused by reciprocal rank, cut to topK, rendered chronologically. */
  async function recall(question: string, variant: EvolutionRecallVariant, questionDate: string): Promise<EvolutionRetrievalResultV2> {
    const topK = variant.budget.topK;
    if (topK > 100) throw new RangeError("Evolution recall systems keep the 1 through 100 search limit for every query.");
    const asOf = evolutionQuestionInstant(questionDate);
    const queries = evolutionRecallQueries(question, variant.system), window = evolutionRecallWindow(question, variant.system, asOf);
    const { store, checkedBackend } = await searchSurface("semantic");
    const response = await recallOhV1({ store, backend: checkedBackend!, limit: topK, mode: "semantic", queries, asOf, window, view: turnView });
    currentSources([]);
    if (response.diagnostics.length) throw new EvolutionSemanticUnavailableError("Oh recall failed; a partial lane is not an evaluated recall result.");
    const indices = response.results.map(result => sourceIndex(result.record)).slice(0, topK);
    currentSources(indices);
    const rendering = renderOhRecallV1({ results: indices.map(index => ({ record: records[index]! })) },
      { asOf, budgetBytes: variant.budget.contextBytes, view: turnView });
    const selected = rendering.keys.map(key => byKey.get(key)!);
    const payload = { protocol: "oh.evolution-retrieval.v2" as const, preparedSha256: identity.preparedSha256,
      variantSha256: canonicalSha256(variant), querySha256: sha256Hex(question), asOf, renderer: OH_RECALL_RENDERER_V1,
      queries, window, context: rendering.text, contextSha256: sha256Hex(rendering.text), contextBytes: rendering.bytes,
      turnIds: selected.map(index => turns[index]!.id), sessionIds: [...new Set(selected.map(index => turns[index]!.sessionId))],
      sources: selected.map(index => sources[index]!), derived: [] as never[], omittedForBudget: rendering.omitted };
    return immutable({ ...payload, resultSha256: canonicalSha256(payload) });
  }
  async function retrieve(questionInput: string, variantInput: EvolutionRetrievalVariant, questionDate?: string): Promise<EvolutionAnyRetrievalResult> {
    const question = bounded(questionInput, 16_384, "question"), variant = checkedVariant(variantInput);
    stats.queryCount += 1;
    if (isEvolutionRecallSystem(variant.system)) {
      if (typeof questionDate !== "string") throw new TypeError("Evolution recall systems require the question date.");
      return recall(question, { ...variant, system: variant.system }, questionDate);
    }
    const isFacets = variant.system.endsWith("facets"), facets = isFacets ? evolutionQuestionFacets(question) : [];
    const topK = variant.budget.topK;
    let indices: number[], coveredFacets: number[] = [], openingOmissions: number | undefined;
    if (isFacets) {
      const rank = variant.system === "oh-facets" ? (q: string) => ohRank(q, topK, "keyword") : async (q: string) => rawRank(q, topK);
      const rankings = await Promise.all([rank(queryTerms(question, true).join(" ")), ...facets.map(rank)]);
      const union = [...new Set(rankings.flat())];
      const distinctive = distinctiveFacetTerms(facets);
      const lexical = new Map(union.map(index => {
        const terms = new Set(queryTermsForCoverage(turns[index]!.text));
        return [index, distinctive.flatMap((termsForFacet, f) => termsForFacet.some(term => terms.has(term)) ? [f] : [])];
      }));
      const selected: number[] = [], covered = new Set<number>();
      let bytes = 0;
      for (;;) {
        let best: number | undefined, bestGain = 0;
        for (const index of union) {
          if (selected.includes(index)) continue;
          const gain = lexical.get(index)!.filter(f => !covered.has(f)).length;
          const size = Buffer.byteLength(renderTurn(turns[index]!)) + (selected.length ? 2 : 0);
          if (gain > bestGain && bytes + size <= variant.budget.contextBytes) { best = index; bestGain = gain; }
        }
        if (best === undefined) break;
        bytes += Buffer.byteLength(renderTurn(turns[best]!)) + (selected.length ? 2 : 0);
        selected.push(best); lexical.get(best)!.forEach(f => covered.add(f));
      }
      // Coverage anchors consume no reserved session quota; remaining sources retain rank order.
      indices = [...selected, ...union.flatMap(index => [index, ...neighbors(index)])];
      const preview = pack(indices.map(index => ({ turn: turns[index]!, digest: records[index]!.recordSha256 })), variant.budget.contextBytes);
      coveredFacets = lexicalFacetCoverage(facets, preview.turnIds.map(id => turns[byTurn.get(id)!]!));
    } else if (variant.system === "bm25-window") indices = rawRank(question, topK).flatMap(index => [index, ...neighbors(index)]);
    else if (variant.system === "bm25-session") indices = rawRank(question, topK, true);
    else if (variant.system === "oh-keyword-window" || variant.system === "oh-focused" || variant.system === "oh-focused-window"
      || variant.system === "oh-focused-window-opening") {
      // Isolate query focusing and conversation adjacency while keeping native Oh ranking.
      const focused = variant.system !== "oh-keyword-window";
      const hits = await ohRank(focused ? queryTerms(question, true).join(" ") : question, topK, "keyword");
      indices = variant.system === "oh-focused" ? hits : hits.flatMap(index => [index, ...neighbors(index)]);
      if (variant.system === "oh-focused-window-opening") {
        const completed = packOpeningIndices(indices, variant.budget.contextBytes);
        indices = completed.indices; openingOmissions = completed.omittedForBudget;
      }
    }
    else indices = await ohRank(question, topK, variant.system === "oh-keyword" ? "keyword" : variant.system === "oh-semantic" ? "semantic" : "hybrid");
    currentSources(indices);
    const packed = pack(indices.map(index => ({ turn: turns[index]!, digest: records[index]!.recordSha256 })), variant.budget.contextBytes);
    const payload = { protocol: "oh.evolution-retrieval.v1" as const, preparedSha256: identity.preparedSha256,
      variantSha256: canonicalSha256(variant), querySha256: sha256Hex(question), context: packed.context,
      contextSha256: sha256Hex(packed.context), contextBytes: Buffer.byteLength(packed.context),
      turnIds: packed.turnIds, sessionIds: packed.sessionIds, sources: packed.turnIds.map(id => sources[byTurn.get(id)!]!),
      omittedForBudget: openingOmissions ?? packed.omittedForBudget, facets, coveredFacets, coverageKind: isFacets ? "lexical-clause" as const : null };
    return immutable({ ...payload, resultSha256: canonicalSha256(payload) });
  }
  return Object.freeze({ identity,
    get stats() { return Object.freeze({ ...stats }); },
    retrieve: ((question: string, variant: EvolutionRetrievalVariant, questionDate?: string) => {
      if (closing) return Promise.reject(new Error("Evolution prepared corpus is closed."));
      const pending = retrieve(question, variant, questionDate); active.add(pending);
      void pending.then(() => active.delete(pending), () => active.delete(pending));
      return pending;
    }) as EvolutionPreparedCorpus["retrieve"],
    close() {
      closing = true;
      closeResult ??= (async () => {
        await Promise.allSettled([...active]);
        try { await backend?.close(); } finally { database.close(); authority?.close(); }
      })();
      return closeResult;
    },
  });
}

function queryTermsForCoverage(text: string): string[] {
  return text.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
