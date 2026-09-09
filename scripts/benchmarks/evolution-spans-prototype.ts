/**
 * Private prototype for source-span follow-up mechanisms. It deliberately has a new
 * protocol and leaves evolution-spans.ts V1 policy/result bytes untouched.
 */
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import type { Corpus, Turn } from "./datasets";
import { createEvolutionContextSourceValidator, type EvolutionRetrievalResult } from "./evolution-retrieval";
import { queryTerms } from "./retrieval";
import { sourceSentenceWindows } from "./evolution-spans";

export const OH_SPAN_PROTOTYPE_VARIANTS = Object.freeze([
  "focused-pool", "continuation", "diverse",
] as const);
export type OhSpanPrototypeVariant = typeof OH_SPAN_PROTOTYPE_VARIANTS[number];
export const OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT = Object.freeze({ id: "oh-span-prototype-focused-pool-v2", system: "oh-focused" as const,
  budget: Object.freeze({ topK: 100, contextBytes: 4_000_000 }) });
export const OH_SPAN_PROTOTYPE_POLICY = Object.freeze({
  protocol: "oh.evolution-source-span-policy.v2-prototype" as const,
  contextBytes: 48_000, topK: 100, unitBytes: 512, maximumRangeBytes: 2_048,
  maximumSpans: 128, maximumPoolWindows: 65_536, maximumCachedWindows: 65_536, focusedPool: true,
  variants: Object.freeze({
    "focused-pool": Object.freeze({ continuation: false, maxRangesPerTurn: null, maxRangesPerSession: null }),
    continuation: Object.freeze({ continuation: true, maxRangesPerTurn: null, maxRangesPerSession: null }),
    diverse: Object.freeze({ continuation: false, maxRangesPerTurn: 2, maxRangesPerSession: 4 }),
  }),
});

type Range = Readonly<{ startByte: number; endByte: number; focusStartByte: number; focusEndByte: number }>;
type Window = Readonly<{ range: Range; text: string; length: number; terms: ReadonlyMap<string, number> }>;
export type OhPrototypeSpan = Readonly<{ id: string; turnId: string; sessionId: string; sessionIndex: number | null;
  date: string; speaker: string; sourceTextSha256: string; startByte: number; endByte: number; focusStartByte: number; focusEndByte: number; text: string }>;
export type OhPrototypeResult = Readonly<{ protocol: "oh.evolution-source-spans.v2-prototype"; variant: OhSpanPrototypeVariant;
  policySha256: string; preparedSha256: string; poolResultSha256: string; querySha256: string; contextByteLimit: number;
  context: string; contextSha256: string; contextBytes: number; spans: readonly OhPrototypeSpan[]; turnIds: readonly string[];
  sessionIds: readonly string[]; resultSha256: string }>;

type Source = Readonly<{ turn: Turn; bytes: Buffer; sourceTextSha256: string }>;
function fail(message: string): never { throw new TypeError(`Oh source span prototype: ${message}.`); }
function freeze<T>(value: T): T { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
function rangeKey(value: Range): string { return `${value.startByte}:${value.endByte}:${value.focusStartByte}:${value.focusEndByte}`; }
function render(span: OhPrototypeSpan): string { return `[source ${JSON.stringify({ turnId: span.turnId, sessionId: span.sessionId, sessionIndex: span.sessionIndex, date: span.date, speaker: span.speaker, startByte: span.startByte, endByte: span.endByte })}]\n${span.text}`; }
function boundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > maximum
    || new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(value)) !== value) fail(`invalid ${label}`);
  return value;
}
function compatiblePool(pool: EvolutionRetrievalResult, variant: OhSpanPrototypeVariant, question: string): void {
  if (pool.variantSha256 !== canonicalSha256(OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT) || pool.turnIds.length > OH_SPAN_PROTOTYPE_POLICY.topK
    || pool.contextBytes > 4_000_000 || pool.omittedForBudget !== 0 || pool.coverageKind !== null
    || pool.querySha256 !== sha256Hex(question)) fail("requires complete focused native top100 pool");
  // This adapter does not rank: callers supply a source-validated focused native pool.
  if (variant !== "focused-pool" && variant !== "continuation" && variant !== "diverse") fail("unknown prototype variant");
}
function words(value: string): string[] { return value.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }
function makeWindows(turn: Turn): readonly Window[] {
  return sourceSentenceWindows(turn.text).map(window => {
    const terms = new Map<string, number>();
    for (const term of words(window.text)) terms.set(term, (terms.get(term) ?? 0) + 1);
    return { ...window, terms };
  });
}
function validCorpus(input: Corpus): readonly Turn[] {
  if (!Array.isArray(input.turns) || input.turns.length < 1 || input.turns.length > 8192) fail("invalid corpus");
  let totalBytes = 0;
  const turns = input.turns.map(turn => {
    if (typeof turn.id !== "string" || typeof turn.sessionId !== "string" || typeof turn.date !== "string" || typeof turn.speaker !== "string" || typeof turn.text !== "string"
      || !turn.id || !turn.sessionId || Buffer.byteLength(turn.text) > 524_288 || new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(turn.text)) !== turn.text
      || turn.sessionIndex !== undefined && (!Number.isSafeInteger(turn.sessionIndex) || turn.sessionIndex < 0)) fail("invalid source turn");
    const clean = { id: turn.id, sessionId: turn.sessionId, date: turn.date, speaker: turn.speaker, text: turn.text, ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }) };
    totalBytes += Buffer.byteLength(canonicalJson(clean));
    if (totalBytes > 32 * 1024 * 1024) fail("corpus exceeds 32 MiB");
    return clean;
  });
  if (new Set(turns.map(turn => turn.id)).size !== turns.length) fail("duplicate source turn");
  return turns;
}

/** Pure source-only packer; callers must supply an independently authenticated focused native pool. */
export function createOhSourceSpanPrototype(input: Corpus) {
  const turns = validCorpus(input), validatePool = createEvolutionContextSourceValidator({ id: input.id, groupId: input.groupId, turns });
  const sources = new Map(turns.map(turn => [turn.id, { turn, bytes: Buffer.from(turn.text), sourceTextSha256: sha256Hex(turn.text) } satisfies Source]));
  const windowsByTurn = new Map<string, readonly Window[]>();
  let cachedWindows = 0;
  const windowsFor = (turnId: string): readonly Window[] => {
    let windows = windowsByTurn.get(turnId);
    if (windows === undefined) {
      windows = makeWindows(sources.get(turnId)!.turn);
      if (cachedWindows + windows.length > OH_SPAN_PROTOTYPE_POLICY.maximumCachedWindows) fail("cached source window count exceeds bound");
      windowsByTurn.set(turnId, windows); cachedWindows += windows.length;
    }
    return windows;
  };
  const policySha256 = canonicalSha256(OH_SPAN_PROTOTYPE_POLICY);
  const span = (source: Source, range: Range): OhPrototypeSpan => {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes.subarray(range.startByte, range.endByte));
    const payload = { turnId: source.turn.id, sessionId: source.turn.sessionId, sessionIndex: source.turn.sessionIndex ?? null, date: source.turn.date, speaker: source.turn.speaker,
      sourceTextSha256: source.sourceTextSha256, ...range, text };
    return freeze({ ...payload, id: canonicalSha256(payload) });
  };
  const continuationRange = (source: Source, base: Window): Range => {
    const end = windowsFor(source.turn.id).filter(window => window.range.endByte >= base.range.endByte
      && window.range.endByte - base.range.startByte <= OH_SPAN_PROTOTYPE_POLICY.maximumRangeBytes)
      .reduce((latest, window) => Math.max(latest, window.range.endByte), base.range.endByte);
    return { ...base.range, endByte: end };
  };
  const validate = (value: unknown, pool: EvolutionRetrievalResult, questionInput: string): OhPrototypeResult => {
    const question = boundedText(questionInput, 16_384, "question"); validatePool(pool);
    if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "variant", "policySha256", "preparedSha256", "poolResultSha256", "querySha256",
      "contextByteLimit", "context", "contextSha256", "contextBytes", "spans", "turnIds", "sessionIds", "resultSha256"])
      || (value.variant !== "focused-pool" && value.variant !== "continuation" && value.variant !== "diverse")) fail("invalid result contract");
    const result = value as unknown as OhPrototypeResult;
    compatiblePool(pool, result.variant, question);
    if (result.protocol !== "oh.evolution-source-spans.v2-prototype" || result.policySha256 !== policySha256 || result.preparedSha256 !== pool.preparedSha256
      || result.poolResultSha256 !== pool.resultSha256 || result.querySha256 !== pool.querySha256 || result.contextByteLimit !== 48_000
      || typeof result.context !== "string" || !Number.isSafeInteger(result.contextBytes) || result.contextBytes < 0 || Object.is(result.contextBytes, -0)
      || parseSha256Hex(result.contextSha256) === null || parseSha256Hex(result.resultSha256) === null
      || !Array.isArray(result.spans) || result.spans.length > 128 || !Array.isArray(result.turnIds) || result.turnIds.length > 128
      || !Array.isArray(result.sessionIds) || result.sessionIds.length > 128) fail("result identity or bounds");
    const poolIds = new Set(pool.turnIds), ranges = new Map<string, Range[]>();
    for (const candidate of result.spans) {
      const item = candidate as unknown as OhPrototypeSpan;
      if (!isPlainRecord(item) || !hasExactKeys(item, ["id", "turnId", "sessionId", "sessionIndex", "date", "speaker", "sourceTextSha256", "startByte", "endByte", "focusStartByte", "focusEndByte", "text"])
        || typeof item.turnId !== "string" || !item.turnId.length || Buffer.byteLength(item.turnId) > 512 || typeof item.id !== "string" || parseSha256Hex(item.id) === null
        || typeof item.sourceTextSha256 !== "string" || parseSha256Hex(item.sourceTextSha256) === null || typeof item.text !== "string"
        || !item.text.length || Buffer.byteLength(item.text) > OH_SPAN_PROTOTYPE_POLICY.maximumRangeBytes
        || new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(item.text)) !== item.text) fail("invalid source span");
      const source = sources.get(item.turnId);
      if (source === undefined || !poolIds.has(item.turnId)) fail("invalid or outside-pool source span");
      const windows = windowsFor(item.turnId), key = rangeKey(item as Range);
      if (typeof item.sessionId !== "string"
        || typeof item.date !== "string" || typeof item.speaker !== "string"
        || item.sourceTextSha256 !== source.sourceTextSha256 || item.sessionId !== source.turn.sessionId
        || item.sessionIndex !== (source.turn.sessionIndex ?? null) || item.date !== source.turn.date || item.speaker !== source.turn.speaker
        || !Number.isSafeInteger(item.startByte) || !Number.isSafeInteger(item.endByte) || !Number.isSafeInteger(item.focusStartByte) || !Number.isSafeInteger(item.focusEndByte)
        || item.startByte < 0 || item.endByte > source.bytes.length || item.startByte >= item.endByte || item.focusStartByte < item.startByte || item.focusEndByte > item.endByte || item.focusStartByte >= item.focusEndByte || item.endByte - item.startByte > 2_048
        || result.variant !== "continuation" && !windows.some(window => rangeKey(window.range) === key)
        || result.variant === "continuation" && !windows.some(window => window.range.startByte === item.startByte
          && window.range.focusStartByte === item.focusStartByte && window.range.focusEndByte === item.focusEndByte
          && rangeKey(continuationRange(source, window)) === key)) fail("source provenance or range changed");
      const rendered = span(source, { startByte: item.startByte, endByte: item.endByte, focusStartByte: item.focusStartByte, focusEndByte: item.focusEndByte });
      if (canonicalSha256(rendered) !== canonicalSha256(item)) fail("span bytes changed");
      const earlier = ranges.get(item.turnId) ?? [];
      if (earlier.some(range => item.startByte < range.endByte && range.startByte < item.endByte)) fail("overlapping ranges");
      earlier.push(item); ranges.set(item.turnId, earlier);
    }
    const context = result.spans.map(render).join("\n\n"), { resultSha256, ...payload } = result;
    if (context !== result.context || Buffer.byteLength(context) !== result.contextBytes || result.contextBytes > 48_000 || sha256Hex(context) !== result.contextSha256
      || result.turnIds.some(id => typeof id !== "string" || Buffer.byteLength(id) > 512) || result.sessionIds.some(id => typeof id !== "string" || Buffer.byteLength(id) > 512)
      || canonicalSha256([...new Set(result.spans.map(item => item.turnId))]) !== canonicalSha256(result.turnIds)
      || canonicalSha256([...new Set(result.spans.map(item => item.sessionId))]) !== canonicalSha256(result.sessionIds)
      || canonicalSha256(payload) !== resultSha256) fail("rendering or digest changed");
    const rules = OH_SPAN_PROTOTYPE_POLICY.variants[result.variant], turnCounts = new Map<string, number>(), sessionCounts = new Map<string, number>();
    for (const item of result.spans) {
      turnCounts.set(item.turnId, (turnCounts.get(item.turnId) ?? 0) + 1); sessionCounts.set(item.sessionId, (sessionCounts.get(item.sessionId) ?? 0) + 1);
      if (rules.maxRangesPerTurn !== null && turnCounts.get(item.turnId)! > rules.maxRangesPerTurn
        || rules.maxRangesPerSession !== null && sessionCounts.get(item.sessionId)! > rules.maxRangesPerSession) fail("variant source-diversity bound");
    }
    return freeze(structuredClone(result));
  };
  const pack = (variant: OhSpanPrototypeVariant, question: string, pool: EvolutionRetrievalResult): OhPrototypeResult => {
    const checkedQuestion = boundedText(question, 16_384, "question"); validatePool(pool); compatiblePool(pool, variant, checkedQuestion);
    const terms = queryTerms(checkedQuestion, true), candidates: Array<{ source: Source; poolRank: number; window: Window; score: number }> = [];
    for (const [poolRank, turnId] of pool.turnIds.entries()) for (const window of windowsFor(turnId)) {
      candidates.push({ source: sources.get(turnId)!, poolRank, window, score: 0 });
      if (candidates.length > OH_SPAN_PROTOTYPE_POLICY.maximumPoolWindows) fail("candidate window count exceeds bound");
    }
    const mean = candidates.reduce((sum, candidate) => sum + candidate.window.length, 0) / Math.max(1, candidates.length);
    const df = new Map(terms.map(term => [term, candidates.filter(candidate => candidate.window.terms.has(term)).length]));
    for (const candidate of candidates) for (const term of terms) {
      const tf = candidate.window.terms.get(term) ?? 0; if (!tf) continue;
      candidate.score += Math.log(1 + (candidates.length - df.get(term)! + .5) / (df.get(term)! + .5)) * tf * 2.2 / (tf + 1.2 * (.25 + .75 * candidate.window.length / Math.max(1, mean)));
    }
    candidates.sort((a, b) => b.score - a.score || a.poolRank - b.poolRank || a.window.range.startByte - b.window.range.startByte);
    const selected: OhPrototypeSpan[] = [], ranges = new Map<string, Range[]>(), turnCount = new Map<string, number>(), sessionCount = new Map<string, number>(), covered = new Set<string>(); let bytes = 0;
    while (candidates.length && selected.length < 128) {
      const rules = OH_SPAN_PROTOTYPE_POLICY.variants[variant];
      const viable = candidates.filter(candidate => {
        const source = candidate.source, prior = ranges.get(source.turn.id) ?? [];
        return candidate.score > 0
          && (rules.maxRangesPerTurn === null || (turnCount.get(source.turn.id) ?? 0) < rules.maxRangesPerTurn)
          && (rules.maxRangesPerSession === null || (sessionCount.get(source.turn.sessionId) ?? 0) < rules.maxRangesPerSession)
          && !prior.some(item => candidate.window.range.startByte < item.endByte && item.startByte < candidate.window.range.endByte);
      });
      if (!viable.length) break;
      const candidate = variant === "diverse" ? viable.sort((a, b) => {
        const gain = (value: typeof a) => terms.filter(term => !covered.has(term) && (value.window.terms.get(term) ?? 0) > 0).length;
        return gain(b) - gain(a) || b.score - a.score || a.poolRank - b.poolRank || a.window.range.startByte - b.window.range.startByte;
      })[0]! : viable[0]!;
      const index = candidates.indexOf(candidate); candidates.splice(index, 1);
      const source = candidate.source;
      if (rules.maxRangesPerTurn !== null && (turnCount.get(source.turn.id) ?? 0) >= rules.maxRangesPerTurn) continue;
      if (rules.maxRangesPerSession !== null && (sessionCount.get(source.turn.sessionId) ?? 0) >= rules.maxRangesPerSession) continue;
      let range = candidate.window.range;
      if (rules.continuation) range = continuationRange(source, candidate.window);
      const prior = ranges.get(source.turn.id) ?? [];
      if (prior.some(item => range.startByte < item.endByte && item.startByte < range.endByte)) continue;
      const item = span(source, range), needed = Buffer.byteLength(render(item)) + (selected.length ? 2 : 0);
      if (bytes + needed > 48_000) continue;
      selected.push(item); prior.push(range); ranges.set(source.turn.id, prior); bytes += needed;
      turnCount.set(source.turn.id, (turnCount.get(source.turn.id) ?? 0) + 1); sessionCount.set(source.turn.sessionId, (sessionCount.get(source.turn.sessionId) ?? 0) + 1);
      for (const term of terms) if ((candidate.window.terms.get(term) ?? 0) > 0) covered.add(term);
    }
    const context = selected.map(render).join("\n\n"), payload = { protocol: "oh.evolution-source-spans.v2-prototype" as const, variant, policySha256,
      preparedSha256: pool.preparedSha256, poolResultSha256: pool.resultSha256, querySha256: sha256Hex(checkedQuestion), contextByteLimit: 48_000,
      context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context), spans: selected,
      turnIds: [...new Set(selected.map(item => item.turnId))], sessionIds: [...new Set(selected.map(item => item.sessionId))] };
    return validate({ ...payload, resultSha256: canonicalSha256(payload) }, pool, checkedQuestion);
  };
  return Object.freeze({ policy: OH_SPAN_PROTOTYPE_POLICY, pack, validate, get stats() {
    return Object.freeze({ cachedTurns: windowsByTurn.size, cachedWindows });
  } });
}
