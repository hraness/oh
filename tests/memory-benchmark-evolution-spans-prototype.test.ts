import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { prepareEvolutionCorpus } from "../scripts/benchmarks/evolution-retrieval";
import { createOhSourceSpanPrototype, OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT } from "../scripts/benchmarks/evolution-spans-prototype";

const nativeFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw new Error("network forbidden"); }, { preconnect() { throw new Error("network forbidden"); } }); });
afterAll(() => { globalThis.fetch = nativeFetch; });
const corpus: Corpus = { id: "prototype", groupId: "prototype", turns: [
  { id: "t1", sessionId: "s1", sessionIndex: 0, date: "2025-01-01", speaker: "user", text: `Anchor evidence. ${"filler ".repeat(270)}Required continuation detail.` },
  { id: "t2", sessionId: "s1", sessionIndex: 1, date: "2025-01-02", speaker: "assistant", text: "Anchor evidence is repeated, but a separate source may be useful." },
  { id: "t3", sessionId: "s2", date: "2025-01-03", speaker: "user", text: "Required detail is blue and exact." },
] };
const diverseCorpus: Corpus = { id: "prototype-diverse", groupId: "prototype", turns: Array.from({ length: 8 }, (_, index) => ({
  id: `d${index}`, sessionId: `s${Math.floor(index / 2)}`, sessionIndex: index, date: `2025-02-${String(index + 1).padStart(2, "0")}`,
  speaker: index % 2 ? "assistant" : "user", text: `Anchor evidence ${"detail ".repeat(340)}`,
})) };

describe("private source-span V2 prototype", () => {
  test("uses only an authenticated focused native pool and preserves V1 separately", async () => {
    const native = await prepareEvolutionCorpus(corpus), prototype = createOhSourceSpanPrototype(corpus);
    try {
      const pool = await native.retrieve("anchor required detail", OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT);
      const result = prototype.pack("focused-pool", "anchor required detail", pool);
      expect(result.protocol).toBe("oh.evolution-source-spans.v2-prototype");
      expect(result.policySha256).toBe(canonicalSha256(prototype.policy));
      expect(result.contextByteLimit).toBe(48_000);
      expect(result.contextBytes).toBeLessThanOrEqual(48_000);
      expect(prototype.pack("focused-pool", "anchor required detail", pool)).toEqual(result);
      expect(prototype.validate(JSON.parse(JSON.stringify(result)), pool, "anchor required detail")).toEqual(result);
      const rawPool = await native.retrieve("anchor required detail", { ...OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT, system: "oh-keyword" });
      expect(() => prototype.pack("focused-pool", "anchor required detail", rawPool)).toThrow("focused native");
    } finally { await native.close(); }
  });

  test("continuation is bounded and source-exact while diverse packing caps turn/session repetition", async () => {
    const native = await prepareEvolutionCorpus(corpus), prototype = createOhSourceSpanPrototype(corpus);
    try {
      const pool = await native.retrieve("anchor", OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT);
      const continued = prototype.pack("continuation", "anchor", pool), diverse = prototype.pack("diverse", "anchor", pool);
      expect(continued.spans.some(span => span.endByte - span.startByte > 1536)).toBeTrue();
      expect(continued.context).toContain("Required continuation detail.");
      for (const span of continued.spans) {
        const source = corpus.turns.find(turn => turn.id === span.turnId)!;
        expect(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(source.text).subarray(span.startByte, span.endByte))).toBe(span.text);
      }
      const byTurn = new Map<string, number>(), bySession = new Map<string, number>();
      for (const span of diverse.spans) { byTurn.set(span.turnId, (byTurn.get(span.turnId) ?? 0) + 1); bySession.set(span.sessionId, (bySession.get(span.sessionId) ?? 0) + 1); }
      expect([...byTurn.values()].every(value => value <= 2)).toBeTrue();
      expect([...bySession.values()].every(value => value <= 4)).toBeTrue();
    } finally { await native.close(); }
  });

  test("diverse packing enforces its source caps on a pool large enough to exercise them", async () => {
    const native = await prepareEvolutionCorpus(diverseCorpus), prototype = createOhSourceSpanPrototype(diverseCorpus);
    try {
      const pool = await native.retrieve("anchor detail", OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT), result = prototype.pack("diverse", "anchor detail", pool);
      const byTurn = new Map<string, number>(), bySession = new Map<string, number>();
      for (const span of result.spans) {
        byTurn.set(span.turnId, (byTurn.get(span.turnId) ?? 0) + 1);
        bySession.set(span.sessionId, (bySession.get(span.sessionId) ?? 0) + 1);
      }
      expect(result.spans.length).toBeGreaterThanOrEqual(8);
      expect([...byTurn.values()].some(value => value === 2)).toBeTrue();
      expect([...bySession.values()].some(value => value === 4)).toBeTrue();
      expect([...byTurn.values()].every(value => value <= 2)).toBeTrue();
      expect([...bySession.values()].every(value => value <= 4)).toBeTrue();
    } finally { await native.close(); }
  });

  test("binds the native query, exact result contract, and declared policy replay", async () => {
    const source: Corpus = { id: "prototype-replay", groupId: "prototype-replay", turns: [
      { id: "r1", sessionId: "rs", date: "2025-04-01", speaker: "user", text: "Anchor detail ".repeat(1_100) },
    ] };
    const native = await prepareEvolutionCorpus(source), prototype = createOhSourceSpanPrototype(source);
    const reseal = (value: any) => { const { resultSha256, ...payload } = value; return { ...value, resultSha256: canonicalSha256(payload) }; };
    try {
      expect(prototype.stats.cachedTurns).toBe(0);
      const pool = await native.retrieve("anchor detail", OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT);
      expect(prototype.stats.cachedTurns).toBe(0);
      const focused = prototype.pack("focused-pool", "anchor detail", pool);
      expect(focused.spans.length).toBeGreaterThan(4);
      expect(() => prototype.pack("focused-pool", "wrong question", pool)).toThrow("focused native");
      expect(() => prototype.pack("focused-pool", "x".repeat(16_385), pool)).toThrow("question");
      expect(() => prototype.validate(reseal({ ...structuredClone(focused), variant: "diverse" }), pool, "anchor detail")).toThrow("source-diversity");
      expect(() => prototype.validate(reseal({ ...structuredClone(focused), answer: "forged" }), pool, "anchor detail")).toThrow("result contract");
    } finally { await native.close(); }
  });

  test("rejects fabricated range/text/provenance and does not access gold-shaped fields", async () => {
    const guarded: any = structuredClone(corpus);
    Object.defineProperty(guarded, "answer", { enumerable: true, get() { throw new Error("gold accessed"); } });
    const native = await prepareEvolutionCorpus(guarded), prototype = createOhSourceSpanPrototype(guarded);
    try {
      const pool = await native.retrieve("anchor required detail", OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT), result = prototype.pack("continuation", "anchor required detail", pool);
      for (const change of [(x: any) => { x.spans[0].text = "forged"; }, (x: any) => { x.spans[0].endByte -= 1; }, (x: any) => { x.spans[0].date = "2099"; }]) {
        const changed: any = structuredClone(result); change(changed); for (const span of changed.spans) { const { id, ...payload } = span; span.id = canonicalSha256(payload); }
        const { resultSha256, ...payload } = changed; changed.resultSha256 = canonicalSha256(payload);
        expect(() => prototype.validate(changed, pool, "anchor required detail")).toThrow();
      }
    } finally { await native.close(); }
  });
});
