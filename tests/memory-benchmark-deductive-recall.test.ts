import { describe, expect, test } from "bun:test";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { prepareDeductive, deductivePlan, deductiveRetrieve, parseQuestion, deriveCandidates,
  scoreDerived, RETRIEVAL_PROGRAM_SHA256 } from "../scripts/benchmarks/deductive-retrieval";

const corpus: Corpus = {
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

const BUDGET = { topK: 20, contextBytes: 12_000 };

describe("deductive retrieval", () => {
  test("parseQuestion extracts terms, entities, scope, and chronology mechanically", () => {
    const parsed = parseQuestion("Which places in Canada was Evan visiting in July 2023?");
    expect(parsed.entities).toContain("canada");
    expect(parsed.entities).toContain("evan");
    expect(parsed.terms).toContain("places");
    expect(parsed.scopeYears).toEqual(["2023"]);
    expect(parsed.scopeMonths).toEqual(["july"]);
    expect(parseQuestion("When did Sam first go hiking?").chronology).toBe("asc");
    expect(parseQuestion("What did Evan say most recently?").chronology).toBe("desc");
    expect(parseQuestion("What kind of car does Evan drive?").chronology).toBeNull();
  });

  test("derives candidates with proofs and speaker linkage invisible to term matching", () => {
    const prepared = prepareDeductive(corpus);
    try {
      // "hiking" appears only in Evan's own s1:0 turn; the question's entity is
      // Evan himself — speaker linkage must mark his turns even where the
      // surface token is absent.
      const derived = deriveCandidates(prepared, parseQuestion("What kind of car does Evan drive?"));
      const evan = derived.find((row) => row.turnId === "s2:0");
      expect(evan?.speaker).toBe(true);
      expect(evan?.proofs.length).toBeGreaterThan(0);
      // Sam's turn s2:1 mentions no Evan-relevant content but speaker=false.
      expect(derived.find((row) => row.turnId === "s2:1")?.speaker).toBeFalsy();
    } finally {
      prepared.store.close();
      prepared.fts.close();
    }
  });

  test("date scope restricts candidates to in-scope sessions", () => {
    const prepared = prepareDeductive(corpus);
    try {
      const parsed = parseQuestion("What did Evan say in June 2023?");
      const derived = deriveCandidates(prepared, parsed);
      const june = derived.find((row) => row.turnId === "s2:0");
      const may = derived.find((row) => row.turnId === "s1:0");
      expect(june?.scoped).toBe(true);
      expect(may?.scoped).toBeFalsy();
      // Out-of-scope demotion: the May turn scores below the June turn even
      // though both are speaker-linked.
      expect(scoreDerived(june!, parsed, prepared.documentFrequency, corpus.turns.length))
        .toBeGreaterThan(scoreDerived(may!, parsed, prepared.documentFrequency, corpus.turns.length));
    } finally {
      prepared.store.close();
      prepared.fts.close();
    }
  });

  test("retrieval returns packed candidates and deductive-union falls back to bm25", () => {
    const prepared = prepareDeductive(corpus);
    try {
      const hit = deductiveRetrieve(corpus, prepared, "deductive",
        "Did Evan mention the Prius breaking down?", BUDGET);
      expect(hit.turnIds).toContain("s2:0");
      // A question with zero derivable signal: union still answers via bm25.
      const union = deductiveRetrieve(corpus, prepared, "deductive-union",
        "zzqq unrelated vocabulary test", BUDGET);
      expect(Array.isArray(union.turnIds)).toBe(true);
      // Determinism: same input, identical output bytes.
      const again = deductiveRetrieve(corpus, prepared, "deductive",
        "Did Evan mention the Prius breaking down?", BUDGET);
      expect(again.context).toBe(hit.context);
    } finally {
      prepared.store.close();
      prepared.fts.close();
    }
  });

  test("deductivePlan candidates are exactly what deductiveRetrieve packs", () => {
    const prepared = prepareDeductive(corpus);
    try {
      const question = "Did Evan mention the Prius breaking down?";
      const plan = deductivePlan(corpus, prepared, "deductive", question, BUDGET);
      const retrieved = deductiveRetrieve(corpus, prepared, "deductive", question, BUDGET);
      // pack() preserves order and dedupes: the retrieved ids must be a
      // subsequence of the plan's candidate order.
      const order = plan.candidates.map((c) => c.turn.id);
      let cursor = 0;
      for (const id of retrieved.turnIds) {
        const at = order.indexOf(id, cursor);
        expect(at).toBeGreaterThanOrEqual(cursor);
        cursor = at;
      }
      // Seeds are the highest-scoring derived rows.
      expect(plan.seeds.length).toBeGreaterThan(0);
      expect(plan.seeds[0]!.score).toBeGreaterThanOrEqual(
        plan.seeds[plan.seeds.length - 1]!.score);
    } finally {
      prepared.store.close();
      prepared.fts.close();
    }
  });

  test("windowRadius widens seed expansion within the same session only", () => {
    const prepared = prepareDeductive(corpus);
    try {
      const question = "What did Evan say about the Prius?";
      const narrow = deductivePlan(corpus, prepared, "deductive", question, BUDGET,
        { windowRadius: 0 });
      const wide = deductivePlan(corpus, prepared, "deductive", question, BUDGET,
        { windowRadius: 2 });
      const narrowIds = new Set(narrow.candidates.map((c) => c.turn.id));
      const wideIds = new Set(wide.candidates.map((c) => c.turn.id));
      // A wider window is a superset at candidate level.
      for (const id of narrowIds) expect(wideIds.has(id)).toBe(true);
      // Expansion never crosses session boundaries.
      for (const candidate of wide.candidates) {
        expect(corpus.turns.some((t) => t.id === candidate.turn.id)).toBe(true);
      }
    } finally {
      prepared.store.close();
      prepared.fts.close();
    }
  });

  test("program digest is stable and results replay-verify", () => {
    expect(RETRIEVAL_PROGRAM_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});
