import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1 } from "../../src/graph";
import type { Corpus, Turn } from "./datasets";
import { queryTerms } from "./retrieval";
import { createEvolutionContextSourceValidator, prepareEvolutionCorpus, type EvolutionRetrievalResult } from "./evolution-retrieval";

export const OH_SPAN_POLICY = Object.freeze({ protocol: "oh.evolution-source-span-policy.v1" as const,
  segmentation: "ascii-sentence-boundary-utf8-chunks-v1" as const, unitBytes: 512, focusUnits: 2, adjacentUnits: 1,
  maximumSpanBytes: 2048, maximumSpans: 128, maximumPoolWindows: 65_536, maximumCachedWindows: 65_536,
  ranking: "bm25-over-source-windows-v1" as const, k1: 1.2, b: 0.75 });
export const OH_SPAN_POOL_VARIANT = Object.freeze({ id: "oh-span-candidate-pool-v1", system: "oh-keyword" as const,
  budget: Object.freeze({ topK: 100, contextBytes: 4_000_000 }) });
export type OhSourceSpan = Readonly<{ id: string; turnId: string; sessionId: string; sessionIndex: number | null;
  date: string; speaker: string; key: string; recordSha256: string; sourceTextSha256: string;
  startByte: number; endByte: number; focusStartByte: number; focusEndByte: number; text: string }>;
export type OhSourceSpanResult = Readonly<{ protocol: "oh.evolution-source-spans.v1"; preparedSha256: string;
  querySha256: string; poolResultSha256: string; policySha256: string; contextByteLimit: number;
  context: string; contextSha256: string; contextBytes: number; spans: readonly OhSourceSpan[];
  turnIds: readonly string[]; sessionIds: readonly string[]; resultSha256: string }>;
type Range = Readonly<{ startByte: number; endByte: number; focusStartByte: number; focusEndByte: number }>;
type Window = Readonly<{ range: Range; text: string; terms: ReadonlyMap<string, number>; length: number }>;
type CurrentTurn = Readonly<{ turn: Turn; key: string; recordSha256: string; bytes: Buffer; sourceTextSha256: string }>;

function fail(message: string): never { throw new TypeError(`Oh source spans: ${message}.`); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.length) || Buffer.byteLength(value) > maximum
    || new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value)) !== value) fail("invalid bounded UTF-8 source text");
  return value;
}
/** Only source fields are read; unknown/gold getters cannot enter the packer. */
function sourceCorpus(input: Corpus): Corpus {
  if (!Array.isArray(input.turns) || input.turns.length < 1 || input.turns.length > 8192) fail("invalid turn count");
  let total = 0;
  const turns = input.turns.map(turn => {
    if (turn.sessionIndex !== undefined && (!Number.isSafeInteger(turn.sessionIndex) || turn.sessionIndex < 0)) fail("invalid session occurrence");
    const clean: Turn = { id: text(turn.id, 512), sessionId: text(turn.sessionId, 512), date: text(turn.date, 256, true),
      speaker: text(turn.speaker, 512), text: text(turn.text, 524_288, true),
      ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }) };
    total += Buffer.byteLength(canonicalJson(clean));
    if (total > 32 * 1024 * 1024) fail("corpus exceeds 32 MiB");
    return clean;
  });
  if (new Set(turns.map(turn => turn.id)).size !== turns.length) fail("duplicate turn ID");
  return freeze({ id: text(input.id, 512), groupId: text(input.groupId, 512), turns });
}
function words(value: string): string[] { return value.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }
function integer(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum && !Object.is(value, -0);
}
function limit(value: unknown): number { if (!integer(value, 96_000) || value < 1) fail("context byte limit must be 1–96000"); return value; }
function rangeKey(r: Range): string { return `${r.startByte}:${r.endByte}:${r.focusStartByte}:${r.focusEndByte}`; }

/** Exact byte ranges, including original whitespace. Oversized sentences are split only at UTF-8 boundaries.
 * This deliberately does not claim linguistic sentence resolution for abbreviations or quotations. */
export function sourceSentenceWindows(value: string): readonly Window[] {
  text(value, 524_288, true);
  const bytes = Buffer.from(value), sentenceEnds: number[] = [];
  let bytePosition = 0;
  for (let offset = 0; offset < value.length;) {
    const character = String.fromCodePoint(value.codePointAt(offset)!);
    offset += character.length; bytePosition += Buffer.byteLength(character);
    if (character === "\n" || /[.!?]/u.test(character) && (offset === value.length || /\s/u.test(value[offset]!))) sentenceEnds.push(bytePosition);
  }
  if (sentenceEnds[sentenceEnds.length - 1] !== bytes.length) sentenceEnds.push(bytes.length);
  const units: Array<{ startByte: number; endByte: number }> = [];
  let cursor = 0;
  for (const sentenceEnd of sentenceEnds) while (cursor < sentenceEnd) {
    let end = Math.min(sentenceEnd, cursor + OH_SPAN_POLICY.unitBytes);
    while (end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    if (end <= cursor) fail("invalid UTF-8 window boundary");
    units.push({ startByte: cursor, endByte: end }); cursor = end;
    if (units.length > 8192) fail("source sentence count exceeds bound");
  }
  const seen = new Set<string>(), windows: Window[] = [];
  for (let i = 0; i < units.length; i++) {
    const startByte = units[Math.max(0, i - OH_SPAN_POLICY.adjacentUnits)]!.startByte;
    const endByte = units[Math.min(units.length - 1, i + OH_SPAN_POLICY.focusUnits - 1 + OH_SPAN_POLICY.adjacentUnits)]!.endByte;
    const identity = `${startByte}:${endByte}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const range: Range = { startByte, endByte, focusStartByte: units[i]!.startByte,
      focusEndByte: units[Math.min(units.length - 1, i + OH_SPAN_POLICY.focusUnits - 1)]!.endByte };
    const windowText = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(startByte, endByte));
    const tokens = words(windowText), terms = new Map<string, number>();
    for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
    windows.push({ range, text: windowText, terms, length: tokens.length });
  }
  return windows;
}

/** Metadata is serialized with escapes; quoted source bytes are not normalized or regenerated. */
export function renderOhSourceSpan(span: OhSourceSpan): string {
  return `[source ${JSON.stringify({ turnId: span.turnId, sessionId: span.sessionId, sessionIndex: span.sessionIndex,
    date: span.date, speaker: span.speaker, startByte: span.startByte, endByte: span.endByte })}]\n${span.text}`;
}

export function createOhSourceSpanPacker(input: Corpus) {
  const corpus = sourceCorpus(input), validatePoolSource = createEvolutionContextSourceValidator(corpus);
  const records = corpus.turns.map((turn, i) => createKnowledgeGraphRecordV1({ v: 1, kind: "edition", dependencies: [],
    key: `edition:turn-${String(i).padStart(5, "0")}`, value: { ...turn } }));
  const current = new Map<string, CurrentTurn>(corpus.turns.map((turn, i) => [turn.id, { turn, key: records[i]!.key,
    recordSha256: records[i]!.recordSha256, bytes: Buffer.from(turn.text), sourceTextSha256: sha256Hex(turn.text) }]));
  const windowsByTurn = new Map<string, readonly Window[]>();
  let segmentationBuilds = 0, cachedWindows = 0;
  const windowsFor = (turnId: string): readonly Window[] => {
    let windows = windowsByTurn.get(turnId);
    if (windows === undefined) {
      windows = sourceSentenceWindows(current.get(turnId)!.turn.text);
      if (cachedWindows + windows.length > OH_SPAN_POLICY.maximumCachedWindows) fail("cached source window count exceeds bound");
      windowsByTurn.set(turnId, windows); segmentationBuilds++; cachedWindows += windows.length;
    }
    return windows;
  };
  function checkedPool(question: string, pool: EvolutionRetrievalResult) {
    text(question, 16_384); validatePoolSource(pool);
    if (pool.variantSha256 !== canonicalSha256(OH_SPAN_POOL_VARIANT) || pool.querySha256 !== sha256Hex(question)
      || pool.contextBytes > OH_SPAN_POOL_VARIANT.budget.contextBytes || pool.omittedForBudget !== 0
      || pool.turnIds.length > 100 || pool.coverageKind !== null) fail("requires complete native Oh keyword top100 pool");
  }
  function makeSpan(turnId: string, window: Window): OhSourceSpan {
    const c = current.get(turnId)!;
    const payload = { turnId, sessionId: c.turn.sessionId, sessionIndex: c.turn.sessionIndex ?? null, date: c.turn.date,
      speaker: c.turn.speaker, key: c.key, recordSha256: c.recordSha256, sourceTextSha256: c.sourceTextSha256,
      ...window.range, text: window.text };
    return freeze({ ...payload, id: canonicalSha256(payload) });
  }
  function validate(value: unknown, pool: EvolutionRetrievalResult, question: string,
    options: Readonly<{ contextBytes?: number }> = {}): OhSourceSpanResult {
    checkedPool(question, pool);
    if (!isPlainRecord(options) || Object.keys(options).some(key => key !== "contextBytes")) fail("unknown validation option");
    const expectedBudget = limit(options.contextBytes ?? 24_000);
    if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "preparedSha256", "querySha256", "poolResultSha256", "policySha256",
      "contextByteLimit", "context", "contextSha256", "contextBytes", "spans", "turnIds", "sessionIds", "resultSha256"])
      || value.protocol !== "oh.evolution-source-spans.v1" || value.preparedSha256 !== pool.preparedSha256
      || value.querySha256 !== pool.querySha256 || value.poolResultSha256 !== pool.resultSha256
      || value.policySha256 !== canonicalSha256(OH_SPAN_POLICY) || !Array.isArray(value.spans) || value.spans.length > OH_SPAN_POLICY.maximumSpans
      || typeof value.context !== "string" || !integer(value.contextBytes, 96_000) || parseSha256Hex(value.contextSha256) === null
      || !Array.isArray(value.turnIds) || value.turnIds.length > OH_SPAN_POLICY.maximumSpans
      || value.turnIds.some(id => typeof id !== "string" || Buffer.byteLength(id) > 512)
      || !Array.isArray(value.sessionIds) || value.sessionIds.length > value.turnIds.length
      || value.sessionIds.some(id => typeof id !== "string" || Buffer.byteLength(id) > 512)) fail("invalid span-result contract");
    const budget = limit(value.contextByteLimit);
    if (budget !== expectedBudget) fail("context byte limit differs from the planned limit");
    const selected: OhSourceSpan[] = [], ranges = new Map<string, Range[]>();
    const poolIds = new Set(pool.turnIds);
    for (const item of value.spans) {
      if (!isPlainRecord(item) || !hasExactKeys(item, ["id", "turnId", "sessionId", "sessionIndex", "date", "speaker", "key", "recordSha256",
        "sourceTextSha256", "startByte", "endByte", "focusStartByte", "focusEndByte", "text"])
        || typeof item.turnId !== "string" || !poolIds.has(item.turnId)) fail("invalid or outside-pool source span");
      const source = current.get(item.turnId)!;
      const { startByte, endByte, focusStartByte, focusEndByte } = item;
      if (!integer(startByte, source.bytes.length) || !integer(endByte, source.bytes.length)
        || !integer(focusStartByte, source.bytes.length) || !integer(focusEndByte, source.bytes.length)
        || startByte >= endByte || focusStartByte >= focusEndByte || startByte > focusStartByte || focusEndByte > endByte
        || endByte - startByte > OH_SPAN_POLICY.maximumSpanBytes) fail("invalid UTF-8 source offsets");
      const window = windowsFor(item.turnId).find(w => rangeKey(w.range) === rangeKey(item as unknown as Range));
      if (window === undefined || canonicalSha256(makeSpan(item.turnId, window)) !== canonicalSha256(item)) fail("stale digest, metadata, or nonverbatim source span");
      const earlier = ranges.get(item.turnId) ?? [];
      if (earlier.some(r => startByte < r.endByte && r.startByte < endByte)) fail("overlapping source spans");
      earlier.push(item as unknown as Range); ranges.set(item.turnId, earlier); selected.push(item as unknown as OhSourceSpan);
    }
    const context = selected.map(renderOhSourceSpan).join("\n\n"), { resultSha256, ...payload } = value;
    if (value.context !== context || value.contextBytes !== Buffer.byteLength(context) || value.contextBytes > budget
      || value.contextSha256 !== sha256Hex(context) || canonicalSha256(payload) !== resultSha256
      || canonicalSha256([...new Set(selected.map(s => s.turnId))]) !== canonicalSha256(value.turnIds)
      || canonicalSha256([...new Set(selected.map(s => s.sessionId))]) !== canonicalSha256(value.sessionIds)) fail("context rendering or result identity mismatch");
    return freeze(structuredClone(value)) as OhSourceSpanResult;
  }
  function pack(question: string, pool: EvolutionRetrievalResult, options: Readonly<{ contextBytes?: number }> = {}): OhSourceSpanResult {
    checkedPool(question, pool);
    if (!isPlainRecord(options) || Object.keys(options).some(key => key !== "contextBytes")) fail("unknown packing option");
    const budget = limit(options.contextBytes ?? 24_000), terms = queryTerms(question, true);
    const candidates: Array<{ turnId: string; poolRank: number; window: Window; score: number }> = [];
    pool.turnIds.forEach((turnId, poolRank) => {
      for (const window of windowsFor(turnId)) {
        candidates.push({ turnId, poolRank, window, score: 0 });
        if (candidates.length > OH_SPAN_POLICY.maximumPoolWindows) fail("candidate window count exceeds bound");
      }
    });
    const averageLength = candidates.reduce((sum, c) => sum + c.window.length, 0) / Math.max(1, candidates.length);
    const df = new Map(terms.map(term => [term, candidates.filter(c => c.window.terms.has(term)).length]));
    for (const candidate of candidates) for (const term of terms) {
      const tf = candidate.window.terms.get(term) ?? 0;
      if (tf === 0) continue;
      const idf = Math.log(1 + (candidates.length - df.get(term)! + 0.5) / (df.get(term)! + 0.5));
      candidate.score += idf * tf * (OH_SPAN_POLICY.k1 + 1) / (tf + OH_SPAN_POLICY.k1 *
        (1 - OH_SPAN_POLICY.b + OH_SPAN_POLICY.b * candidate.window.length / Math.max(1, averageLength)));
    }
    candidates.sort((a, b) => b.score - a.score || a.poolRank - b.poolRank || a.window.range.startByte - b.window.range.startByte);
    const spans: OhSourceSpan[] = [], ranges = new Map<string, Range[]>();
    let bytes = 0;
    for (const candidate of candidates) {
      if (candidate.score <= 0 || spans.length === OH_SPAN_POLICY.maximumSpans) break;
      const earlier = ranges.get(candidate.turnId) ?? [], range = candidate.window.range;
      if (earlier.some(r => range.startByte < r.endByte && r.startByte < range.endByte)) continue;
      const span = makeSpan(candidate.turnId, candidate.window), needed = Buffer.byteLength(renderOhSourceSpan(span)) + (spans.length ? 2 : 0);
      if (bytes + needed > budget) continue;
      spans.push(span); bytes += needed; earlier.push(range); ranges.set(candidate.turnId, earlier);
    }
    const context = spans.map(renderOhSourceSpan).join("\n\n");
    const payload = { protocol: "oh.evolution-source-spans.v1" as const, preparedSha256: pool.preparedSha256,
      querySha256: pool.querySha256, poolResultSha256: pool.resultSha256, policySha256: canonicalSha256(OH_SPAN_POLICY),
      contextByteLimit: budget, context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context), spans,
      turnIds: [...new Set(spans.map(s => s.turnId))], sessionIds: [...new Set(spans.map(s => s.sessionId))] };
    return validate({ ...payload, resultSha256: canonicalSha256(payload) }, pool, question, { contextBytes: budget });
  }
  return Object.freeze({ pack, validate, get stats() { return Object.freeze({ segmentationBuilds, cachedTurns: windowsByTurn.size, cachedWindows }); } });
}

/** Convenience facade owns its native index. Generic runner integration may instead share a prepared pool and this pure packer. */
export async function prepareOhSourceSpanCorpus(input: Corpus) {
  const corpus = sourceCorpus(input), native = await prepareEvolutionCorpus(corpus), packer = createOhSourceSpanPacker(corpus);
  return Object.freeze({ identity: native.identity, async retrieve(question: string, contextBytes = 24_000) {
    const pool = await native.retrieve(question, OH_SPAN_POOL_VARIANT);
    return Object.freeze({ pool, result: packer.pack(question, pool, { contextBytes }) });
  }, validate: packer.validate, get stats() { return Object.freeze({ native: native.stats, spans: packer.stats }); }, close: () => native.close() });
}
