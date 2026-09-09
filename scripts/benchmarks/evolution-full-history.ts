import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../../src/graph";
import type { Corpus, Turn } from "./datasets";
import type { EvolutionPreparedIdentity, EvolutionSourceIdentity } from "./evolution-retrieval";
import { renderTurn } from "./retrieval";

/** An immutable scientific control. There is no query, topK, or truncation budget. */
export const EVOLUTION_FULL_HISTORY_POLICY = Object.freeze({
  protocol: "oh.evolution-full-history-policy.v1" as const,
  selection: "every-corpus-turn" as const,
  sourceOrder: "input-corpus-order" as const,
  rendering: "legacy-render-turn-with-two-newline-separators-v1" as const,
  maximumTurns: 8192, maximumTurnBytes: 524_288,
  maximumCorpusBytes: 32 * 1024 * 1024, maximumContextBytes: 32 * 1024 * 1024,
});

export type EvolutionFullHistoryResult = Readonly<{
  protocol: "oh.evolution-full-history.v1";
  policySha256: string; preparedSha256: string; corpusId: string; corpusSha256: string;
  sourceRecordsSha256: string; sourceRecordCount: number;
  context: string; contextSha256: string; contextBytes: number;
  turnIds: readonly string[]; sessionIds: readonly string[]; sources: readonly EvolutionSourceIdentity[];
  omittedForBudget: 0; resultSha256: string;
}>;
export type EvolutionFullHistorySource = Readonly<{
  identity: EvolutionPreparedIdentity; result: EvolutionFullHistoryResult;
  validate(value: unknown): EvolutionFullHistoryResult;
}>;

function fail(message: string): never { throw new TypeError(`Evolution full history: ${message}.`); }
function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function text(value: unknown, maximum: number, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || Buffer.byteLength(value) > maximum
    || new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value)) !== value) fail(`invalid ${label}`);
  return value;
}
function integer(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0 && value <= maximum;
}
function digest(value: unknown): value is string { return typeof value === "string" && parseSha256Hex(value) !== null; }
function recordKey(index: number): string { return `edition:turn-${String(index).padStart(5, "0")}`; }

/** Source fields are whitelisted. Extra fields, including gold-shaped getters, are never read.
 * Preserve the dataset projection's exact order: LongMemEval's parser already performs
 * its stable chronological sort. Sorting again here would change source identity. */
function sourceCorpus(value: unknown): Corpus {
  if (!isPlainRecord(value)) fail("invalid source corpus");
  const id = text(value.id, 512, "corpus ID"), groupId = text(value.groupId, 512, "group ID"), inputTurns = value.turns;
  if (!Array.isArray(inputTurns) || inputTurns.length < 1 || inputTurns.length > EVOLUTION_FULL_HISTORY_POLICY.maximumTurns) fail("invalid turn count");
  const turns: Turn[] = [], ids = new Set<string>(); let bytes = 0;
  for (const value of inputTurns) {
    if (!isPlainRecord(value)) fail("invalid source turn");
    const sessionIndex = value.sessionIndex;
    if (sessionIndex !== undefined && !integer(sessionIndex, Number.MAX_SAFE_INTEGER)) fail("invalid session occurrence");
    const turn: Turn = {
      id: text(value.id, 512, "turn ID"), sessionId: text(value.sessionId, 512, "session ID"),
      ...(sessionIndex === undefined ? {} : { sessionIndex }), date: text(value.date, 256, "date", true),
      speaker: text(value.speaker, 512, "speaker"), text: text(value.text, EVOLUTION_FULL_HISTORY_POLICY.maximumTurnBytes, "turn text", true),
    };
    if (ids.has(turn.id)) fail("duplicate turn ID");
    ids.add(turn.id); bytes += Buffer.byteLength(canonicalJson(turn));
    if (bytes > EVOLUTION_FULL_HISTORY_POLICY.maximumCorpusBytes) fail("source corpus byte limit exceeded");
    turns.push(turn);
  }
  return immutable({ id, groupId, turns });
}

function preparedIdentity(corpusId: string, corpusSha256: string, sourceRecordsSha256: string, sourceRecordCount: number): EvolutionPreparedIdentity {
  const payload = { protocol: "oh.evolution-prepared.v1" as const, corpusId, corpusSha256, sourceRecordsSha256,
    sourceRecordCount, semanticProfileSha256: null };
  return immutable({ ...payload, preparedSha256: canonicalSha256(payload) });
}

/** Bounded internal shape/digest validation only. Use the source-bound factory's
 * validate method to prove that this is every current turn of a selected corpus. */
export function validateEvolutionFullHistoryResult(value: unknown): EvolutionFullHistoryResult {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "policySha256", "preparedSha256", "corpusId", "corpusSha256",
    "sourceRecordsSha256", "sourceRecordCount", "context", "contextSha256", "contextBytes", "turnIds", "sessionIds", "sources", "omittedForBudget", "resultSha256"])
    || value.protocol !== "oh.evolution-full-history.v1" || value.policySha256 !== canonicalSha256(EVOLUTION_FULL_HISTORY_POLICY)
    || !digest(value.preparedSha256) || !digest(value.corpusSha256) || !digest(value.sourceRecordsSha256)
    || !digest(value.contextSha256) || !digest(value.resultSha256)
    || !integer(value.sourceRecordCount, EVOLUTION_FULL_HISTORY_POLICY.maximumTurns) || value.sourceRecordCount < 1
    || !integer(value.contextBytes, EVOLUTION_FULL_HISTORY_POLICY.maximumContextBytes)
    || value.omittedForBudget !== 0 || Object.is(value.omittedForBudget, -0)
    || !Array.isArray(value.turnIds) || value.turnIds.length !== value.sourceRecordCount
    || !Array.isArray(value.sources) || value.sources.length !== value.sourceRecordCount
    || !Array.isArray(value.sessionIds) || value.sessionIds.length < 1 || value.sessionIds.length > value.sourceRecordCount) fail("invalid result contract");
  text(value.corpusId, 512, "result corpus ID");
  text(value.context, EVOLUTION_FULL_HISTORY_POLICY.maximumContextBytes, "context", true);
  const result = value as unknown as EvolutionFullHistoryResult;
  const ids = new Set<string>();
  for (const [index, source] of result.sources.entries()) {
    if (!isPlainRecord(source) || !hasExactKeys(source, ["turnId", "sessionId", "key", "recordSha256"])
      || source.key !== recordKey(index) || !digest(source.recordSha256)) fail("invalid source identity");
    text(source.turnId, 512, "source turn ID"); text(source.sessionId, 512, "source session ID");
    if (source.turnId !== result.turnIds[index] || ids.has(source.turnId)) fail("source membership or order changed");
    ids.add(source.turnId);
  }
  for (const sessionId of result.sessionIds) text(sessionId, 512, "result session ID");
  const sourceRecordsSha256 = canonicalSha256(result.sources.map(({ key, recordSha256 }) => ({ key, recordSha256 })));
  const identity = preparedIdentity(result.corpusId, result.corpusSha256, sourceRecordsSha256, result.sourceRecordCount);
  const { resultSha256, ...payload } = result;
  if (result.sourceRecordsSha256 !== sourceRecordsSha256 || result.preparedSha256 !== identity.preparedSha256
    || canonicalSha256([...new Set(result.sources.map(source => source.sessionId))]) !== canonicalSha256(result.sessionIds)
    || Buffer.byteLength(result.context) !== result.contextBytes || sha256Hex(result.context) !== result.contextSha256
    || canonicalSha256(payload) !== resultSha256) fail("result rendering or digest changed");
  return immutable(structuredClone(result));
}

/** Build all source records once, with no index or provider work. Reuse result and
 * validator across every question/reader of this corpus. Limits reject, never truncate. */
export function createEvolutionFullHistorySource(input: Corpus): EvolutionFullHistorySource {
  const corpus = sourceCorpus(input);
  const records = corpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({ v: 1, kind: "edition", dependencies: [],
    key: recordKey(index), value: { ...turn } }));
  const sources: EvolutionSourceIdentity[] = corpus.turns.map((turn, index) => ({ turnId: turn.id, sessionId: turn.sessionId,
    key: records[index]!.key, recordSha256: records[index]!.recordSha256 }));
  const sourceRecordsSha256 = canonicalSha256(sources.map(({ key, recordSha256 }) => ({ key, recordSha256 })));
  const identity = preparedIdentity(corpus.id, canonicalSha256(corpus), sourceRecordsSha256, sources.length);
  const context = corpus.turns.map(renderTurn).join("\n\n");
  const payload = { protocol: "oh.evolution-full-history.v1" as const, policySha256: canonicalSha256(EVOLUTION_FULL_HISTORY_POLICY),
    preparedSha256: identity.preparedSha256, corpusId: identity.corpusId, corpusSha256: identity.corpusSha256,
    sourceRecordsSha256, sourceRecordCount: sources.length, context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context),
    turnIds: corpus.turns.map(turn => turn.id), sessionIds: [...new Set(corpus.turns.map(turn => turn.sessionId))], sources, omittedForBudget: 0 as const };
  const result = validateEvolutionFullHistoryResult({ ...payload, resultSha256: canonicalSha256(payload) });
  return Object.freeze({ identity, result, validate(value: unknown) {
    const checked = validateEvolutionFullHistoryResult(value);
    if (checked.resultSha256 !== result.resultSha256) fail("result differs from the complete current source corpus");
    return checked;
  } });
}
