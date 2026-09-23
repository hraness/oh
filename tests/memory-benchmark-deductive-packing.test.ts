import { describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import type { Corpus, Turn } from "../scripts/benchmarks/datasets";
import { orderedWindowPlan, vectorWindowRetrieve } from "../scripts/benchmarks/deductive-packing";
import { DEDUCTIVE_SYSTEMS, deductivePlan, deductiveRetrieve,
  prepareDeductive } from "../scripts/benchmarks/deductive-retrieval";
import { renderTurn } from "../scripts/benchmarks/retrieval";

// Same fixed corpus as the existing deductive-recall fixture. The fingerprint
// below was captured from the unmodified selection implementation before its
// extraction; it includes seeds, duplicate candidates, record digests and the
// complete packed result, not just an accuracy summary.
const fixture: Corpus = {
  id: "test-corpus", groupId: "test-corpus",
  turns: [
    { id: "s1:0", sessionId: "s1", date: "1:00 pm on 1 May, 2023", speaker: "Evan",
      text: "I just got back from a hiking trip with my family." },
    { id: "s1:1", sessionId: "s1", date: "1:00 pm on 1 May, 2023", speaker: "Sam",
      text: "Nice! How was the trail near Granite Peak?" },
    { id: "s1:2", sessionId: "s1", date: "1:00 pm on 1 May, 2023", speaker: "Evan",
      text: "The trail was steep but the view was worth it." },
    { id: "s2:0", sessionId: "s2", date: "2:00 pm on 10 June, 2023", speaker: "Evan",
      text: "My new Prius broke down on the highway yesterday." },
    { id: "s2:1", sessionId: "s2", date: "2:00 pm on 10 June, 2023", speaker: "Sam",
      text: "That is frustrating. Did you call a tow truck?" },
    { id: "s3:0", sessionId: "s3", date: "3:00 pm on 20 July, 2023", speaker: "Sam",
      text: "I started watercolor painting classes last week." },
  ],
};

function source(turns: readonly Turn[]) {
  const corpus: Corpus = { id: "packing", groupId: "packing", turns };
  const positionOf = new Map(turns.map((turn, index) => [turn.id, index]));
  const candidateOf = (id: string) => {
    const index = positionOf.get(id);
    return index === undefined ? undefined : { turn: turns[index]!, digest: `digest-${id}` };
  };
  return { corpus, positionOf, candidateOf };
}

function turn(id: string, sessionId: string, sessionIndex = 0): Turn {
  return { id, sessionId, sessionIndex, date: "2023-05-01", speaker: "Alex", text: `Text ${id} — café.` };
}

describe("shared deductive and vector packing", () => {
  test("preserves all 48 pre-extraction fixture outputs byte for byte", () => {
    const prepared = prepareDeductive(fixture);
    try {
      const rows = [];
      for (const question of ["Did Evan mention the Prius breaking down?",
        "What did Sam say before June 15, 2023?", "What did Evan first discuss?",
        "zzqq unrelated vocabulary test"]) {
        for (const system of DEDUCTIVE_SYSTEMS) {
          for (const options of [{}, { windowRadius: 0 }, { sessionCap: 1, diverseFill: false },
            { semFacts: [{ relation: "sem-near", tuple: ["turn:s3:0"],
              sources: ["sha256:" + "0".repeat(64)] }] }]) {
            const budget = { topK: 2, contextBytes: 330 };
            const plan = deductivePlan(fixture, prepared, system, question, budget, options);
            rows.push({ question, system, options, seeds: plan.seeds, candidates: plan.candidates,
              result: deductiveRetrieve(fixture, prepared, system, question, budget, options) });
          }
        }
      }
      expect(rows).toHaveLength(48);
      expect(canonicalSha256(rows)).toBe("dce96e344d870b5c821948f3389a8df3669ebccff7e35a803b12d48fdb066322");
    } finally { prepared.store.close(); prepared.fts.close(); }
  });

  test("expands seed-first within the same session occurrence and respects exact UTF-8 bytes", () => {
    const input = source([turn("a0", "a"), turn("a1", "a"), turn("a2", "a"),
      turn("a3", "a", 1), turn("b0", "b")]);
    const ranking = [{ turnId: "a1", score: 0.8 }];
    const retrieved = vectorWindowRetrieve(input.corpus, input.positionOf, ranking,
      { topK: 20, contextBytes: 12_000 }, input.candidateOf);
    expect(retrieved.turnIds).toEqual(["a1", "a0", "a2"]);
    expect(retrieved.recordDigests).toEqual(["digest-a1", "digest-a0", "digest-a2"]);
    const exactBytes = Buffer.byteLength(renderTurn(input.corpus.turns[1]!));
    const bounded = vectorWindowRetrieve(input.corpus, input.positionOf, ranking,
      { topK: 20, contextBytes: exactBytes }, input.candidateOf);
    expect(bounded.turnIds).toEqual(["a1"]);
    expect(Buffer.byteLength(bounded.context)).toBe(exactBytes);
    expect(bounded.omittedForBudget).toBe(2);
  });

  test("matches twenty seeds plus twenty fills and never invents absent tail ranks", () => {
    const input = source(Array.from({ length: 50 }, (_, i) => turn(`t${i}`, `s${i}`)));
    const ranked = input.corpus.turns.map((item, i) => ({ turnId: item.id, score: 1 - i / 100 }));
    const budget = { topK: 20, contextBytes: 12_000 };
    const full = vectorWindowRetrieve(input.corpus, input.positionOf, ranked, budget, input.candidateOf);
    expect(full.turnIds).toEqual(ranked.slice(0, 40).map((item) => item.turnId));
    const frozen20 = vectorWindowRetrieve(input.corpus, input.positionOf, ranked.slice(0, 20),
      budget, input.candidateOf);
    expect(frozen20.turnIds).toEqual(ranked.slice(0, 20).map((item) => item.turnId));
  });

  test("fills across sessions in rank-preserving rounds, with explicit positive eligibility", () => {
    const input = source([turn("a0", "a"), turn("a1", "a"), turn("a2", "a"),
      turn("b0", "b"), turn("b1", "b"), turn("b2", "b"), turn("c0", "c")]);
    const ordered = ["a0", "b0", "c0", "a1", "a2", "b1", "b2"]
      .map((turnId) => ({ turnId, score: turnId === "c0" ? 0 : 1 }));
    const plan = orderedWindowPlan({ ...input, ordered, topK: 2,
      canFill: (row) => row.score > 0, options: { windowRadius: 0 } });
    expect(plan.candidates.map((item) => item.turn.id)).toEqual(["a0", "b0", "a1", "b1"]);
    const linear = orderedWindowPlan({ ...input, ordered, topK: 2,
      canFill: (row) => row.score > 0, options: { windowRadius: 0, diverseFill: false } });
    expect(linear.candidates.map((item) => item.turn.id)).toEqual(["a0", "b0", "a1", "a2"]);
  });

  test("session cap changes seeds without losing overflow and skips unavailable candidates", () => {
    const input = source([turn("a0", "a"), turn("a1", "a"), turn("a2", "a"),
      turn("b0", "b"), turn("c0", "c")]);
    const ordered = ["a0", "a1", "a2", "b0", "c0"].map((turnId) => ({ turnId }));
    const plan = orderedWindowPlan({ ...input, ordered, topK: 3, canFill: () => true,
      candidateOf: (id) => id === "a1" ? undefined : input.candidateOf(id),
      options: { windowRadius: 0, sessionCap: 1 } });
    expect(plan.seeds.map((row) => row.turnId)).toEqual(["a0", "b0", "c0"]);
    expect(plan.candidates.map((item) => item.turn.id)).toEqual(["a0", "b0", "c0", "a2"]);
  });

  test("union lexical fallback can seed but cannot fill as a positive derivation", () => {
    const padding = Array.from({ length: 50 }, (_, i) => `token${i}`).join(" ");
    const corpus: Corpus = { id: "fallback", groupId: "fallback", turns: [
      { ...turn("a0", "a"), text: `${padding} zucchini` },
      { ...turn("b0", "b"), text: `${padding} zucchini` },
    ] };
    const prepared = prepareDeductive(corpus);
    try {
      const budget = { topK: 1, contextBytes: 12_000 };
      const union = deductivePlan(corpus, prepared, "deductive-union", "zucchini", budget,
        { windowRadius: 0 });
      expect(union.derived).toEqual([]);
      expect(union.seeds).toHaveLength(1);
      expect(union.seeds[0]!.score).toBe(0);
      expect(union.candidates).toHaveLength(1);
      expect(deductiveRetrieve(corpus, prepared, "deductive", "zucchini", budget).turnIds).toEqual([]);
    } finally { prepared.store.close(); prepared.fts.close(); }
  });

  test("rejects an invalid window radius without changing the previous rejection", () => {
    const input = source([turn("a0", "a")]);
    for (const windowRadius of [-1, 0.5, 9, Number.NaN]) {
      expect(() => orderedWindowPlan({ ...input, ordered: [{ turnId: "a0" }],
        topK: 1, canFill: () => true, options: { windowRadius } }))
        .toThrow("deductive retrieval: invalid windowRadius");
    }
  });
});
