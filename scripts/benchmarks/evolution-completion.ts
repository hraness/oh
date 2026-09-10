/** Source-only completion experiment. No search, index construction, model calls or ledger access.
 * Callers authenticate parent artifact pins. This module proves current source identity and
 * deterministic packing; a matching digest alone does not prove search execution custody. */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../../src/graph";
import type { Corpus, Turn } from "./datasets";
import { createEvolutionContextSourceValidator, type EvolutionRetrievalResult, type EvolutionRetrievalVariant, type EvolutionSourceIdentity } from "./evolution-retrieval";
import { renderTurn } from "./retrieval";

export const EVOLUTION_COMPLETION_POLICY = Object.freeze({
  protocol: "oh.memory.evolution-completion-policy.v1" as const,
  prefixSystem: "oh-focused-window" as const, prefixTopK: 100, prefixByteLimit: 96_000,
  poolTopK: 100, poolByteLimit: 96_000, maximumPoolTurns: 100, maximumPrefixTurns: 300,
  completionByteLimit: 24_000, contextByteLimit: 120_000, maximumAppendedTurns: 400,
  bundleOrder: "occurrence-opener-hit-previous-next" as const,
  admission: "atomic-missing-whole-turn-bundle" as const,
  outputOrder: "unchanged-prefix-then-pool-ranked-bundles" as const,
  separator: "\n\n", sourceUnit: "whole-turn" as const,
  poolScope: "authenticated-budgeted-retrieval-result" as const,
});
export const EVOLUTION_COMPLETION_MODES = ["lexical", "semantic"] as const;
export type EvolutionCompletionMode = typeof EVOLUTION_COMPLETION_MODES[number];
export type EvolutionCompletionParent = Readonly<{ variant: EvolutionRetrievalVariant;
  result: EvolutionRetrievalResult; expectedResultSha256: string }>;
export type EvolutionCompletionQuestion = Readonly<{ question: string; questionDate: string }>;
export type EvolutionCompletionInputs = Readonly<{ question: EvolutionCompletionQuestion; mode: EvolutionCompletionMode;
  prefix: EvolutionCompletionParent; pool: EvolutionCompletionParent }>;
export type EvolutionCompletionDecision = Readonly<{ hitTurnId: string; missingTurnIds: readonly string[];
  status: "appended" | "already-present" | "omitted-for-budget" }>;
export type EvolutionCompletionResult = Readonly<{
  protocol: "oh.memory.evolution-source-completion.v1"; mode: EvolutionCompletionMode; policySha256: string;
  corpusId: string; corpusSha256: string; questionSha256: string; querySha256: string;
  prefixResultSha256: string; prefixPreparedSha256: string; prefixVariantSha256: string;
  poolResultSha256: string; poolPreparedSha256: string; poolVariantSha256: string;
  poolTurnCount: number; poolOmittedForBudget: number;
  prefixContextSha256: string; prefixContextBytes: number; prefixTurnCount: number;
  completionByteLimit: 24_000; contextByteLimit: 120_000; appendedBytes: number;
  appendedTurnIds: readonly string[]; decisions: readonly EvolutionCompletionDecision[];
  context: string; contextSha256: string; contextBytes: number;
  turnIds: readonly string[]; sessionIds: readonly string[]; sources: readonly EvolutionSourceIdentity[];
  resultSha256: string;
}>;
const POLICY_SHA = canonicalSha256(EVOLUTION_COMPLETION_POLICY);
function fail(message: string): never { throw new TypeError(`Evolution completion: ${message}.`); }
export function freezeEvolutionCompletion<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freezeEvolutionCompletion(child); Object.freeze(value); }
  return value;
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== "string" || !empty && value.length === 0 || Buffer.byteLength(value) > maximum
    || /\p{Surrogate}/u.test(value)) fail("bounded UTF-8 text required");
  return value;
}
const uint = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0) && v <= max;
const digest = (v: unknown) => { if (parseSha256Hex(v) === null) fail("digest required"); };
/** Whitelist before copying: gold-shaped source properties/getters are never inspected. */
export function projectEvolutionCompletionCorpus(value: unknown): Corpus {
  if (!isPlainRecord(value) || !Array.isArray(value.turns) || value.turns.length < 1 || value.turns.length > 8192) fail("source corpus bounds");
  const id = text(value.id, 512), groupId = text(value.groupId, 512); let bytes = 0;
  const turns = value.turns.map((value): Turn => {
    if (!isPlainRecord(value)) fail("source turn object");
    const sessionIndex = value.sessionIndex;
    if (sessionIndex !== undefined && !uint(sessionIndex, Number.MAX_SAFE_INTEGER)) fail("source occurrence");
    const turn = { id: text(value.id, 512), sessionId: text(value.sessionId, 512), ...(sessionIndex === undefined ? {} : { sessionIndex }),
      date: text(value.date, 256, true), speaker: text(value.speaker, 512), text: text(value.text, 524_288, true) };
    bytes += Buffer.byteLength(canonicalJson(turn)); if (bytes > 32 * 1024 * 1024) fail("source corpus exceeds32MiB");
    return turn;
  });
  if (new Set(turns.map(t => t.id)).size !== turns.length) fail("duplicate source turn");
  return freezeEvolutionCompletion({ id, groupId, turns });
}
export function projectEvolutionCompletionQuestion(value: unknown): EvolutionCompletionQuestion {
  if (!isPlainRecord(value)) fail("question object");
  return Object.freeze({ question: text(value.question, 16_384), questionDate: text(value.questionDate, 256, true) });
}
/** Apply bounds before canonical hashing or cloning untrusted result/plan values. */
export function boundEvolutionCompletionWire(value: unknown, maximumBytes: number, maximumNodes = 30_000): void {
  const pending: Array<readonly [unknown, number]> = [[value, 0]]; let nodes = 0, bytes = 0;
  const addBytes = (count: number) => { bytes += count; if (bytes > maximumBytes) fail("wire byte bound"); };
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (++nodes > maximumNodes || depth > 16) fail("wire structure bound");
    if (typeof item === "string") addBytes(Buffer.byteLength(item));
    else if (item !== null && typeof item === "object") {
      if (!Array.isArray(item) && !isPlainRecord(item)) fail("plain wire object required");
      if (Array.isArray(item) && item.length + pending.length + nodes > maximumNodes) fail("wire item bound");
      const keys = Object.keys(item); if (keys.length + pending.length + nodes > maximumNodes) fail("wire item bound");
      if (Array.isArray(item) && keys.length !== item.length) fail("dense wire array required");
      for (const key of keys) {
        addBytes(Buffer.byteLength(key));
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!("value" in descriptor)) fail("wire accessor forbidden");
        pending.push([descriptor.value, depth + 1]);
      }
    } else if (item !== null && !(typeof item === "number" && Number.isFinite(item)) && typeof item !== "boolean") fail("JSON wire primitive required");
  }
}
const RESULT_KEYS = ["protocol", "mode", "policySha256", "corpusId", "corpusSha256", "questionSha256", "querySha256",
  "prefixResultSha256", "prefixPreparedSha256", "prefixVariantSha256", "poolResultSha256", "poolPreparedSha256", "poolVariantSha256",
  "poolTurnCount", "poolOmittedForBudget", "prefixContextSha256", "prefixContextBytes", "prefixTurnCount", "completionByteLimit",
  "contextByteLimit", "appendedBytes", "appendedTurnIds", "decisions", "context", "contextSha256", "contextBytes", "turnIds", "sessionIds", "sources", "resultSha256"];
/** Shape and hash validation only. Admission must also reconstruct against current
 * corpus bytes and independently pinned original parent artifacts via factory.validate. */
export function validateEvolutionCompletionResultEnvelope(value: unknown, input: EvolutionCompletionInputs): EvolutionCompletionResult {
  if (!isPlainRecord(value) || !hasExactKeys(value, RESULT_KEYS)) fail("exact completion result required");
  boundEvolutionCompletionWire(value, 2_000_000);
  const r = value as unknown as EvolutionCompletionResult, prefix = input.prefix.result, pool = input.pool.result;
  for (const d of [r.corpusSha256, r.resultSha256, r.contextSha256, r.prefixResultSha256, r.poolResultSha256]) digest(d);
  text(r.corpusId, 512);
  if (r.protocol !== "oh.memory.evolution-source-completion.v1" || r.mode !== input.mode || r.policySha256 !== POLICY_SHA
    || r.questionSha256 !== canonicalSha256(projectEvolutionCompletionQuestion(input.question)) || r.querySha256 !== sha256Hex(input.question.question)
    || r.prefixResultSha256 !== input.prefix.expectedResultSha256 || r.poolResultSha256 !== input.pool.expectedResultSha256
    || r.prefixPreparedSha256 !== prefix.preparedSha256 || r.poolPreparedSha256 !== pool.preparedSha256
    || r.prefixVariantSha256 !== prefix.variantSha256 || r.poolVariantSha256 !== pool.variantSha256
    || r.prefixContextSha256 !== prefix.contextSha256 || r.prefixContextBytes !== prefix.contextBytes || r.prefixTurnCount !== prefix.turnIds.length
    || r.poolTurnCount !== pool.turnIds.length || r.poolOmittedForBudget !== pool.omittedForBudget
    || r.completionByteLimit !== 24_000 || r.contextByteLimit !== 120_000 || !uint(r.appendedBytes, 24_000)
    || !uint(r.contextBytes, 120_000) || r.contextBytes !== r.prefixContextBytes + r.appendedBytes
    || typeof r.context !== "string" || !r.context.startsWith(prefix.context) || Buffer.byteLength(r.context) !== r.contextBytes || sha256Hex(r.context) !== r.contextSha256
    || !Array.isArray(r.appendedTurnIds) || r.appendedTurnIds.length > 400 || !Array.isArray(r.turnIds) || r.turnIds.length > 700
    || !Array.isArray(r.sources) || r.sources.length !== r.turnIds.length || !Array.isArray(r.sessionIds)
    || canonicalSha256(r.turnIds) !== canonicalSha256([...prefix.turnIds, ...r.appendedTurnIds]) || new Set(r.turnIds).size !== r.turnIds.length
    || !Array.isArray(r.decisions) || r.decisions.length !== pool.turnIds.length) fail("completion envelope binding or bounds");
  r.turnIds.forEach(id => text(id, 512));
  for (const [i, source] of r.sources.entries()) {
    if (!isPlainRecord(source) || !hasExactKeys(source, ["turnId", "sessionId", "key", "recordSha256"]) || source.turnId !== r.turnIds[i]
      || typeof source.key !== "string" || !/^edition:turn-[0-9]{5}$/.test(source.key)) fail("source identity shape");
    text(source.sessionId, 512); digest(source.recordSha256);
  }
  if (canonicalSha256(r.sources.slice(0, prefix.sources.length)) !== canonicalSha256(prefix.sources)
    || canonicalSha256(r.sessionIds) !== canonicalSha256([...new Set(r.sources.map(s => s.sessionId))])) fail("prefix or session identity drift");
  for (const [i, decision] of r.decisions.entries()) {
    if (!isPlainRecord(decision) || !hasExactKeys(decision, ["hitTurnId", "missingTurnIds", "status"]) || decision.hitTurnId !== pool.turnIds[i]
      || typeof decision.status !== "string" || !["appended", "already-present", "omitted-for-budget"].includes(decision.status) || !Array.isArray(decision.missingTurnIds)
      || decision.missingTurnIds.length > 4 || new Set(decision.missingTurnIds).size !== decision.missingTurnIds.length
      || (decision.status === "already-present") !== (decision.missingTurnIds.length === 0)) fail("completion decision shape");
    decision.missingTurnIds.forEach(id => text(id, 512));
  }
  const { resultSha256, ...payload } = r;
  if (canonicalSha256(payload) !== resultSha256) fail("completion result digest");
  return r;
}
/** Construct once per source corpus and reuse across questions/modes. No index is built. */
export function createEvolutionSourceCompletion(input: Corpus) {
  const corpus = projectEvolutionCompletionCorpus(input), corpusSha256 = canonicalSha256(corpus);
  const validateLexical = createEvolutionContextSourceValidator(corpus);
  let validateSemantic: ReturnType<typeof createEvolutionContextSourceValidator> | undefined;
  const byId = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  const sourceRows = corpus.turns.map((turn, index): EvolutionSourceIdentity => {
    const record = createKnowledgeGraphRecordV1({ dependencies: [], key: `edition:turn-${index.toString().padStart(5, "0")}`, kind: "edition", v: 1, value: { ...turn } });
    return { turnId: turn.id, sessionId: turn.sessionId, key: record.key, recordSha256: record.recordSha256 };
  });
  const rendered = corpus.turns.map(renderTurn), occurrences = new Map<string, number[]>();
  const occurrence = (index: number) => { const t = corpus.turns[index]!; return JSON.stringify([t.sessionId, t.sessionIndex ?? null]); };
  corpus.turns.forEach((_, index) => { const key = occurrence(index), found = occurrences.get(key) ?? []; found.push(index); occurrences.set(key, found); });
  const openings = new Map([...occurrences].map(([key, indices]) => [key, indices.find(i => corpus.turns[i]!.speaker.toLowerCase() === "user") ?? indices[0]!]));
  function parent(value: EvolutionCompletionParent, role: "prefix" | EvolutionCompletionMode, querySha256: string): EvolutionCompletionParent {
    if (!isPlainRecord(value) || !hasExactKeys(value, ["variant", "result", "expectedResultSha256"])) fail("exact parent binding required");
    boundEvolutionCompletionWire(value, 2_000_000);
    digest(value.expectedResultSha256);
    const v = value.variant, r = value.result, system = role === "prefix" ? "oh-focused-window" : role === "lexical" ? "oh-focused" : "oh-semantic";
    if (!isPlainRecord(v) || !hasExactKeys(v, ["id", "system", "budget"]) || typeof v.id !== "string"
      || !/^[a-z0-9][a-z0-9:-]{0,99}$/.test(v.id) || v.system !== system || !isPlainRecord(v.budget)
      || !hasExactKeys(v.budget, ["topK", "contextBytes"]) || v.budget.topK !== 100 || v.budget.contextBytes !== 96_000
      || !isPlainRecord(r) || r.resultSha256 !== value.expectedResultSha256 || r.variantSha256 !== canonicalSha256(v)
      || r.querySha256 !== querySha256 || r.contextBytes > 96_000 || r.coverageKind !== null
      || !Array.isArray(r.turnIds) || r.turnIds.length > (role === "prefix" ? 300 : 100)) fail("parent query, mode, fixed cap or result pin mismatch");
    if (role === "semantic") { validateSemantic ??= createEvolutionContextSourceValidator(corpus, { semantic: true }); validateSemantic(r); }
    else validateLexical(r);
    return value;
  }
  function pack(input: EvolutionCompletionInputs): EvolutionCompletionResult {
    if (!isPlainRecord(input) || !hasExactKeys(input, ["question", "mode", "prefix", "pool"]) || !EVOLUTION_COMPLETION_MODES.includes(input.mode)) fail("exact completion inputs required");
    const question = projectEvolutionCompletionQuestion(input.question), querySha256 = sha256Hex(question.question);
    const prefix = parent(input.prefix, "prefix", querySha256), pool = parent(input.pool, input.mode, querySha256);
    const selected = new Set(prefix.result.turnIds), appended: number[] = [], decisions: EvolutionCompletionDecision[] = [];
    let appendedBytes = 0;
    for (const id of pool.result.turnIds) {
      const index = byId.get(id)!, key = occurrence(index);
      const candidates = [...new Set([openings.get(key)!, index, ...[index - 1, index + 1].filter(i => i >= 0 && i < corpus.turns.length && occurrence(i) === key)])];
      const missing = candidates.filter(i => !selected.has(corpus.turns[i]!.id));
      const missingTurnIds = missing.map(i => corpus.turns[i]!.id);
      if (!missing.length) { decisions.push({ hitTurnId: id, missingTurnIds, status: "already-present" }); continue; }
      const required = missing.reduce((sum, i, n) => sum + Buffer.byteLength(rendered[i]!) + (selected.size > 0 || n > 0 ? 2 : 0), 0);
      if (appendedBytes + required > EVOLUTION_COMPLETION_POLICY.completionByteLimit) { decisions.push({ hitTurnId: id, missingTurnIds, status: "omitted-for-budget" }); continue; }
      appendedBytes += required; missing.forEach(i => { selected.add(corpus.turns[i]!.id); appended.push(i); });
      decisions.push({ hitTurnId: id, missingTurnIds, status: "appended" });
    }
    const suffix = appended.map(i => rendered[i]!).join("\n\n"), context = prefix.result.context + (suffix && prefix.result.context ? "\n\n" : "") + suffix;
    const turnIds = [...prefix.result.turnIds, ...appended.map(i => corpus.turns[i]!.id)], sources = turnIds.map(id => sourceRows[byId.get(id)!]!);
    const payload = { protocol: "oh.memory.evolution-source-completion.v1" as const, mode: input.mode, policySha256: POLICY_SHA,
      corpusId: corpus.id, corpusSha256, questionSha256: canonicalSha256(question), querySha256,
      prefixResultSha256: prefix.result.resultSha256, prefixPreparedSha256: prefix.result.preparedSha256, prefixVariantSha256: prefix.result.variantSha256,
      poolResultSha256: pool.result.resultSha256, poolPreparedSha256: pool.result.preparedSha256, poolVariantSha256: pool.result.variantSha256,
      poolTurnCount: pool.result.turnIds.length, poolOmittedForBudget: pool.result.omittedForBudget,
      prefixContextSha256: prefix.result.contextSha256, prefixContextBytes: prefix.result.contextBytes, prefixTurnCount: prefix.result.turnIds.length,
      completionByteLimit: 24_000 as const, contextByteLimit: 120_000 as const, appendedBytes, appendedTurnIds: appended.map(i => corpus.turns[i]!.id), decisions,
      context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context), turnIds, sessionIds: [...new Set(sources.map(s => s.sessionId))], sources };
    if (payload.contextBytes !== prefix.result.contextBytes + appendedBytes || appendedBytes > 24_000 || payload.contextBytes > 120_000 || appended.length > 400) fail("internal completion budget");
    return freezeEvolutionCompletion({ ...payload, resultSha256: canonicalSha256(payload) });
  }
  function validate(input: EvolutionCompletionInputs, value: unknown): EvolutionCompletionResult {
    if (!isPlainRecord(value) || !hasExactKeys(value, RESULT_KEYS)) fail("exact completion result required");
    boundEvolutionCompletionWire(value, 2_000_000);
    const expected = pack(input);
    if (canonicalSha256(value) !== canonicalSha256(expected)) fail("result differs from authenticated parents, current source or deterministic packing");
    return expected;
  }
  return Object.freeze({ corpusId: corpus.id, corpusSha256, sourceRecordCount: corpus.turns.length, pack, validate });
}
