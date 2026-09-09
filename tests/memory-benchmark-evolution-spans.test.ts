import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { prepareEvolutionCorpus } from "../scripts/benchmarks/evolution-retrieval";
import { createOhSourceSpanPacker, OH_SPAN_POLICY, OH_SPAN_POOL_VARIANT, prepareOhSourceSpanCorpus,
  renderOhSourceSpan, sourceSentenceWindows } from "../scripts/benchmarks/evolution-spans";

const nativeFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw new Error("Test forbids provider/network calls."); },
  { preconnect() { throw new Error("Test forbids network preconnect."); } }); });
afterAll(() => { globalThis.fetch = nativeFetch; });
const corpus: Corpus = { id: "span-corpus", groupId: "span-group", turns: [
  { id: "t1", sessionId: "s1", sessionIndex: 0, date: "2025-01-01", speaker: "user",
    text: "😺 We moved to Montréal. My kayak is violet. It has a blue paddle. I bought it in May." },
  { id: "t2", sessionId: "s1", sessionIndex: 1, date: "2025-01-02", speaker: "assistant",
    text: "A violet kayak is memorable. You can clean its paddle with water." },
  { id: "t3", sessionId: "s2", date: "2025-02-01", speaker: "user", text: "My bicycle is yellow. It has a basket." },
] };
function reseal(value: any) {
  for (const span of value.spans) { const { id: _ignored, ...payload } = span; span.id = canonicalSha256(payload); }
  const { resultSha256: _ignored, ...payload } = value;
  value.resultSha256 = canonicalSha256(payload);
  return value;
}

describe("standalone native Oh source-span adapter", () => {
  test("uses actual native keyword candidates, produces immutable exact UTF-8 source spans, and reuses preparation", async () => {
    const prepared = await prepareOhSourceSpanCorpus(corpus);
    try {
      const first = await prepared.retrieve("What color is the kayak?");
      expect(first.pool.variantSha256).toBe(canonicalSha256(OH_SPAN_POOL_VARIANT));
      expect(first.pool.omittedForBudget).toBe(0);
      expect(first.result.context).toContain("My kayak is violet.");
      expect(first.result.contextBytes).toBeLessThanOrEqual(24_000);
      expect(first.result.context).toBe(first.result.spans.map(renderOhSourceSpan).join("\n\n"));
      for (const span of first.result.spans) {
        const source = corpus.turns.find(turn => turn.id === span.turnId)!;
        expect(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(source.text).subarray(span.startByte, span.endByte))).toBe(span.text);
        expect(span.sourceTextSha256).toBe(sha256Hex(source.text));
        expect(span.date).toBe(source.date); expect(span.speaker).toBe(source.speaker);
        expect(span.sessionIndex).toBe(source.sessionIndex ?? null);
        expect(span.endByte - span.startByte).toBeLessThanOrEqual(OH_SPAN_POLICY.maximumSpanBytes);
      }
      expect(Object.isFrozen(first.result)).toBe(true);
      expect(Object.isFrozen(first.result.spans[0])).toBe(true);
      const builds = prepared.stats.spans.segmentationBuilds;
      const second = await prepared.retrieve("What color is the kayak?");
      expect(second.result).toEqual(first.result);
      expect(prepared.stats.spans.segmentationBuilds).toBe(builds);
      expect(prepared.stats.native).toEqual({ rawIndexBuilds: 1, sessionIndexBuilds: 1, authorityBuilds: 1, semanticIndexBuilds: 0, queryCount: 2 });
      expect(prepared.validate(JSON.parse(JSON.stringify(first.result)), first.pool, "What color is the kayak?")).toEqual(first.result);
    } finally { await prepared.close(); }
    await expect(prepared.retrieve("kayak")).rejects.toThrow("closed");
  });

  test("keeps bounded adjacent text, hard-splits oversized sentences on UTF-8 boundaries, and never overlaps packed spans", async () => {
    const value = "前言。 " + "🙂 café ".repeat(450) + ". Kayak evidence follows. It is violet. Last sentence.";
    const windows = sourceSentenceWindows(value), bytes = Buffer.from(value);
    expect(windows.length).toBeGreaterThan(4);
    expect(windows.some(w => w.range.startByte < w.range.focusStartByte)).toBe(true);
    expect(windows.some(w => w.range.endByte > w.range.focusEndByte)).toBe(true);
    for (const window of windows) {
      expect(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(window.range.startByte, window.range.endByte))).toBe(window.text);
      expect(window.range.endByte - window.range.startByte).toBeLessThanOrEqual(2048);
    }
    const prepared = await prepareOhSourceSpanCorpus({ id: "long", groupId: "long", turns: [{ ...corpus.turns[0]!, text: value }] });
    try {
      const { result } = await prepared.retrieve("kayak violet café", 8000);
      expect(result.context).toContain("It is violet.");
      for (const [i, span] of result.spans.entries()) for (const other of result.spans.slice(i + 1)) {
        expect(span.endByte <= other.startByte || other.endByte <= span.startByte).toBe(true);
      }
    } finally { await prepared.close(); }
  });

  test("includes all rendering overhead in byte budgets and preserves empty retrieval", async () => {
    const native = await prepareEvolutionCorpus(corpus), packer = createOhSourceSpanPacker(corpus);
    try {
      const pool = await native.retrieve("kayak", OH_SPAN_POOL_VARIANT);
      const full = packer.pack("kayak", pool);
      expect(full.spans.length).toBeGreaterThan(0);
      const oneSpanBytes = Buffer.byteLength(renderOhSourceSpan(full.spans[0]!));
      for (const budget of [1, oneSpanBytes - 1, oneSpanBytes, 500, 24000]) {
        const result = packer.pack("kayak", pool, { contextBytes: budget });
        expect(result.contextBytes).toBe(Buffer.byteLength(result.context));
        expect(result.contextBytes).toBeLessThanOrEqual(budget);
        expect(packer.validate(result, pool, "kayak", { contextBytes: budget })).toEqual(result);
        if (budget !== 24000) expect(() => packer.validate(result, pool, "kayak")).toThrow("planned limit");
      }
      expect(packer.pack("kayak", pool, { contextBytes: 1 }).spans).toEqual([]);
      const empty = await native.retrieve("???", OH_SPAN_POOL_VARIANT);
      expect(packer.pack("???", empty).context).toBe("");
      expect(() => packer.pack("kayak", pool, { contextBytes: 0 })).toThrow("byte limit");
      expect(() => packer.pack("kayak", pool, { contextBytes: 96_001 })).toThrow("byte limit");
      expect(() => packer.pack("kayak", pool, { contextBytes: 100, extra: 1 } as never)).toThrow("option");
    } finally { await native.close(); }
  });

  test("rejects resealed fabricated text, offsets, metadata, stale source records, and unmatched query/pool identities", async () => {
    const prepared = await prepareOhSourceSpanCorpus(corpus);
    try {
      const { pool, result } = await prepared.retrieve("kayak");
      for (const change of [
        (r: any) => { r.spans[0].text = "Fabricated answer."; },
        (r: any) => { r.spans[0].startByte += 1; },
        (r: any) => { r.spans[0].recordSha256 = sha256Hex("stale record"); },
        (r: any) => { r.spans[0].sourceTextSha256 = sha256Hex("stale text"); },
        (r: any) => { r.spans[0].date = "2099-01-01"; },
        (r: any) => { r.spans[0].speaker = "invented speaker"; },
        (r: any) => { r.spans[0].sessionIndex = 999; },
        (r: any) => { r.spans[0].key = "edition:turn-99999"; },
        (r: any) => { r.spans[0].turnId = "not-in-pool"; },
        (r: any) => { r.spans[0].extra = true; },
        (r: any) => { r.spans.push(structuredClone(r.spans[0])); },
        (r: any) => { r.context = "A different rendered answer"; r.contextBytes = Buffer.byteLength(r.context); r.contextSha256 = sha256Hex(r.context); },
        (r: any) => { r.turnIds = []; },
        (r: any) => { r.sessionIds = ["invented-session"]; },
        (r: any) => { r.poolResultSha256 = sha256Hex("different pool"); },
        (r: any) => { r.policySha256 = sha256Hex("different policy"); },
        (r: any) => { r.contextByteLimit = 96_000; },
        (r: any) => { r.extra = true; },
        (r: any) => { r.protocol = "future"; },
      ]) {
        const changed = structuredClone(result); change(changed);
        expect(() => prepared.validate(reseal(changed), pool, "kayak")).toThrow();
      }
      expect(() => prepared.validate(result, pool, "bicycle")).toThrow("pool");
      const changedSource = { ...corpus, turns: corpus.turns.map(turn => ({ ...turn, text: turn.text + " Source changed." })) };
      expect(() => createOhSourceSpanPacker(changedSource).validate(result, pool, "kayak")).toThrow("source identity");
    } finally { await prepared.close(); }
  });

  test("labels never enter retrieval or segmentation and caller mutations cannot alter the prepared snapshot", async () => {
    const changed = { ...corpus, turns: corpus.turns.map(turn => ({ ...turn })) };
    for (const source of [changed, ...changed.turns]) for (const key of ["answer", "evidenceSessionIds", "has_answer", "category"]) {
      Object.defineProperty(source, key, { get() { throw new Error("gold field accessed"); }, enumerable: true });
    }
    const prepared = await prepareOhSourceSpanCorpus(changed);
    try {
      changed.turns[0]!.text = "A different source.";
      const { result } = await prepared.retrieve("kayak violet");
      expect(result.context).toContain("My kayak is violet.");
      expect(result.context).not.toContain("A different source.");
    } finally { await prepared.close(); }
    expect(() => sourceSentenceWindows("x.\n".repeat(8193))).toThrow("sentence count");
    expect(() => sourceSentenceWindows("\ud800")).toThrow("UTF-8");
  });

  test("never mislabels a byte-truncated native pool as the complete top100 candidate pool", async () => {
    const large: Corpus = { id: "large", groupId: "large", turns: Array.from({ length: 9 }, (_, i) => ({
      id: `large-${i}`, sessionId: `s-${i}`, date: "2025", speaker: "user", text: "Kayak " + "x".repeat(499_990) })) };
    const prepared = await prepareOhSourceSpanCorpus(large);
    try { await expect(prepared.retrieve("kayak")).rejects.toThrow("complete native"); }
    finally { await prepared.close(); }
  });
});
