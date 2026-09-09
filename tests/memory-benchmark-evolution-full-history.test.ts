import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { parseLongMemEval, type Corpus } from "../scripts/benchmarks/datasets";
import { createEvolutionFullHistorySource, EVOLUTION_FULL_HISTORY_POLICY, validateEvolutionFullHistoryResult } from "../scripts/benchmarks/evolution-full-history";
import { EVOLUTION_RETRIEVAL_SYSTEMS, prepareEvolutionCorpus } from "../scripts/benchmarks/evolution-retrieval";
import { pack } from "../scripts/benchmarks/retrieval";

const nativeFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw new Error("network forbidden"); }, { preconnect() { throw new Error("network forbidden"); } }); });
afterAll(() => { globalThis.fetch = nativeFetch; });

const corpus: Corpus = { id: "complete", groupId: "complete", turns: [
  { id: "s#0:0", sessionId: "s", sessionIndex: 0, date: "2025-01-01", speaker: "user", text: "Earlier source.\n🦀日本語 é café." },
  { id: "s#0:1", sessionId: "s", sessionIndex: 0, date: "2025-01-01", speaker: "assistant", text: "Earlier assistant source." },
  { id: "s#1:0", sessionId: "s", sessionIndex: 1, date: "2025-01-02", speaker: "user", text: "Later occurrence of the same session ID." },
] };
const seal = (value: any) => { const { resultSha256, ...payload } = value; value.resultSha256 = canonicalSha256(payload); return value; };

describe("complete full-history source control", () => {
  test("matches legacy chronological rendering and native canonical source identities", async () => {
    const parsed = parseLongMemEval([{ question_id: "chronological", question_type: "temporal-reasoning", question: "Synthetic question", question_date: "2025-02-01", answer: "synthetic", answer_session_ids: [],
      haystack_session_ids: ["repeated", "repeated", "third"], haystack_dates: ["2025-01-02", "2025-01-01", "2025-01-01"],
      haystack_sessions: [[{ role: "user", content: "Later" }], [{ role: "user", content: "Earlier" }, { role: "assistant", content: "Same session" }], [{ role: "user", content: "Tied date" }]],
    }]).corpora[0]!;
    const full = createEvolutionFullHistorySource(parsed), legacy = pack(parsed.turns.map(turn => ({ turn })), 1, true);
    expect(full.result.turnIds).toEqual(["repeated#1:0", "repeated#1:1", "third:0", "repeated#0:0"]);
    expect(full.result.context).toBe(legacy.context);
    expect(full.result.sessionIds).toEqual(legacy.sessionIds);
    expect(full.result.contextBytes).toBe(Buffer.byteLength(legacy.context));
    expect(full.result.omittedForBudget).toBe(0);
    const native = await prepareEvolutionCorpus(parsed);
    try { expect(full.identity).toEqual(native.identity); }
    finally { await native.close(); }
    expect(full.validate(JSON.parse(JSON.stringify(full.result)))).toEqual(full.result);
  });

  test("includes every turn beyond top100 or ordinary context budgets and stays outside retrieval genes", () => {
    const wide: Corpus = { id: "wide", groupId: "wide", turns: Array.from({ length: 130 }, (_, index) => ({ id: `t${index}`, sessionId: `s${index}`, date: "2025", speaker: index % 2 ? "assistant" : "user", text: `${index}: ${"context ".repeat(60)}` })) };
    const full = createEvolutionFullHistorySource(wide);
    expect(full.result.sourceRecordCount).toBe(130);
    expect(full.result.turnIds).toEqual(wide.turns.map(turn => turn.id));
    expect(full.result.contextBytes).toBeGreaterThan(48_000);
    expect(full.result.context).toContain("129: context");
    expect(full.result.sources[129]!.key).toBe("edition:turn-00129");
    expect(Object.keys(full.result)).not.toContain("topK");
    expect(Object.keys(full.result)).not.toContain("querySha256");
    expect((EVOLUTION_RETRIEVAL_SYSTEMS as readonly string[]).includes("full-history")).toBeFalse();
    const subset = createEvolutionFullHistorySource({ ...wide, turns: wide.turns.slice(0, 100) });
    expect(validateEvolutionFullHistoryResult(subset.result)).toEqual(subset.result);
    expect(() => full.validate(subset.result)).toThrow("complete current source");
  });

  test("preserves supplied order and rejects resealed reordered, stale, or different corpus results", () => {
    const full = createEvolutionFullHistorySource(corpus);
    const reversed = { ...corpus, turns: [...corpus.turns].reverse() };
    const reordered = createEvolutionFullHistorySource(reversed);
    expect(reordered.result.context).toBe(pack(reversed.turns.map(turn => ({ turn })), 0, true).context);
    expect(() => full.validate(reordered.result)).toThrow("complete current source");
    for (const change of [
      (value: any) => { value.turns[2].text += " changed"; },
      (value: any) => { value.turns[2].speaker = "assistant"; },
      (value: any) => { value.turns[2].date = "2025-01-03"; },
      (value: any) => { value.turns[2].sessionIndex = 99; },
      (value: any) => { value.groupId = "different"; },
      (value: any) => { value.id = "different"; },
    ]) {
      const changed = structuredClone(corpus); change(changed);
      expect(() => createEvolutionFullHistorySource(changed).validate(full.result)).toThrow();
    }
  });

  test("rejects resealed source/metadata/text/omission claims and unknown keys", () => {
    const full = createEvolutionFullHistorySource(corpus);
    for (const change of [
      (value: any) => { value.context += " invented"; value.contextBytes = Buffer.byteLength(value.context); value.contextSha256 = sha256Hex(value.context); },
      (value: any) => { value.sourceRecordCount--; },
      (value: any) => { value.sources[0].recordSha256 = "f".repeat(64); },
      (value: any) => { value.sources[0].key = "edition:turn-00001"; },
      (value: any) => { value.sources[0].answer = "forged"; },
      (value: any) => { value.omittedForBudget = 1; },
      (value: any) => { value.answer = "forged"; },
      (value: any) => { value.turnIds[0] = value.turnIds[1]; },
      (value: any) => { value.sessionIds.push("invented"); },
      (value: any) => { value.policySha256 = "f".repeat(64); },
    ]) {
      const changed = structuredClone(full.result); change(changed);
      expect(() => full.validate(seal(changed))).toThrow();
    }
    expect(() => validateEvolutionFullHistoryResult(null)).toThrow();
    expect(() => validateEvolutionFullHistoryResult([])).toThrow();
  });

  test("projects source fields without touching gold getters and snapshots mutable input", () => {
    const guarded: any = structuredClone(corpus);
    for (const object of [guarded, ...guarded.turns]) for (const key of ["answer", "question", "question_type", "has_answer", "evidenceTurnIds"]) {
      Object.defineProperty(object, key, { enumerable: true, get() { throw new Error("gold accessed"); } });
    }
    const full = createEvolutionFullHistorySource(guarded), before = JSON.stringify(full.result);
    guarded.turns[0].text = "changed after preparation";
    expect(JSON.stringify(full.result)).toBe(before);
    expect(full.result.context).toContain("🦀日本語 é café.");
    expect(Object.isFrozen(full.result)).toBeTrue();
    expect(Object.isFrozen(full.result.sources[0])).toBeTrue();
    expect(Object.isFrozen(full.result.turnIds)).toBeTrue();
    expect(full.validate(full.result)).toEqual(full.result);
  });

  test("enforces bounded, canonical input and rejects overflow without truncation", () => {
    for (const change of [
      (value: any) => { value.turns = []; },
      (value: any) => { value.turns = Array(8193).fill(value.turns[0]); },
      (value: any) => { value.turns[1].id = value.turns[0].id; },
      (value: any) => { value.turns[0].text = "a".repeat(EVOLUTION_FULL_HISTORY_POLICY.maximumTurnBytes + 1); },
      (value: any) => { value.turns[0].id = "a".repeat(513); },
      (value: any) => { value.turns[0].text = "\ud800"; },
      (value: any) => { value.turns[0].date = "\ud800"; },
      (value: any) => { value.turns[0].sessionIndex = -0; },
      (value: any) => { value.turns[0].sessionIndex = 0.1; },
    ]) {
      const changed = structuredClone(corpus); change(changed);
      expect(() => createEvolutionFullHistorySource(changed)).toThrow();
    }
    const oversized = { ...corpus, turns: Array.from({ length: 65 }, (_, index) => ({ ...corpus.turns[0]!, id: `large-${index}`, text: "a".repeat(524_288) })) };
    expect(() => createEvolutionFullHistorySource(oversized)).toThrow("source corpus byte limit");
    const empty = createEvolutionFullHistorySource({ ...corpus, turns: [{ ...corpus.turns[0]!, text: "", date: "" }] });
    expect(empty.result.sourceRecordCount).toBe(1);
    expect(empty.result.context).toBe(pack([{ turn: { ...corpus.turns[0]!, text: "", date: "" } }], 0, true).context);
  });
});
