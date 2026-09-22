import { describe, expect, test } from "bun:test";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { createDeductiveDerivation, deductivePlan, deductiveRetrieve,
  prepareDeductive, type PreparedDeductiveDerivation } from "../scripts/benchmarks/deductive-retrieval";
import { createKnowledgeGraphRecordV1 } from "../src/graph";

const corpus: Corpus = {
  id: "derivation-reuse", groupId: "derivation-reuse",
  turns: [
    { id: "a:0", sessionId: "a", date: "1:00 pm on 1 May, 2023", speaker: "Evan",
      text: "I hiked beside Granite Peak with Sam." },
    { id: "a:1", sessionId: "a", date: "1:00 pm on 1 May, 2023", speaker: "Sam",
      text: "The trail past Granite Peak had a waterfall." },
    { id: "b:0", sessionId: "b", date: "1:00 pm on 1 June, 2023", speaker: "Evan",
      text: "I bought a Prius and drove home." },
    { id: "b:1", sessionId: "b", date: "1:00 pm on 1 June, 2023", speaker: "Sam",
      text: "I enjoy painting mountains in watercolor." },
  ],
};
const question = "What did Evan say about Granite Peak before June 2023?";
const budget = { topK: 2, contextBytes: 800 };
const semFacts = [{ relation: "sem-near", tuple: ["turn:b:1"],
  sources: ["sha256:" + "1".repeat(64)] }];

function withPrepared(run: (prepared: ReturnType<typeof prepareDeductive>) => void): void {
  const prepared = prepareDeductive(corpus);
  try { run(prepared); } finally { prepared.store.close(); prepared.fts.close(); }
}

describe("explicit deductive derivation reuse", () => {
  test("both mechanical arms preserve every proof, ranking, and packed byte", () => {
    withPrepared((prepared) => {
      const derivation = createDeductiveDerivation(prepared, question);
      for (const system of ["deductive", "deductive-union"] as const) {
        expect(deductivePlan(corpus, prepared, system, question, budget, { derivation }))
          .toEqual(deductivePlan(corpus, prepared, system, question, budget));
        expect(deductiveRetrieve(corpus, prepared, system, question, budget, { derivation }))
          .toEqual(deductiveRetrieve(corpus, prepared, system, question, budget));
      }
      // Ranking/packing options are downstream of the pinned derivation.
      const options = { sessionCap: 1, windowRadius: 0, bridgeWeight: 1.2 };
      expect(deductivePlan(corpus, prepared, "deductive", question, budget, { ...options, derivation }))
        .toEqual(deductivePlan(corpus, prepared, "deductive", question, budget, options));
    });
  });

  test("semantic reuse preserves proofs and requires exact semantic inputs", () => {
    withPrepared((prepared) => {
      const derivation = createDeductiveDerivation(prepared, question, { facts: semFacts });
      expect(deductivePlan(corpus, prepared, "deductive-semantic", question, budget,
        { derivation, semFacts })).toEqual(deductivePlan(corpus, prepared,
          "deductive-semantic", question, budget, { semFacts }));
      expect(() => deductivePlan(corpus, prepared, "deductive", question, budget, { derivation }))
        .toThrow("prepared derivation inputs changed");
      expect(() => deductivePlan(corpus, prepared, "deductive-semantic", question, budget,
        { derivation, semFacts: [{ ...semFacts[0]!, sources: ["sha256:" + "2".repeat(64)] }] }))
        .toThrow("prepared derivation inputs changed");
    });
  });

  test("returned rows cannot poison the privately frozen derivation", () => {
    withPrepared((prepared) => {
      const derivation = createDeductiveDerivation(prepared, question);
      const first = deductivePlan(corpus, prepared, "deductive", question, budget, { derivation });
      const original = deductivePlan(corpus, prepared, "deductive", question, budget);
      (first.derived[0]!.terms as Set<string>).clear();
      expect(() => (first.derived[0]!.proofs as string[]).push("forged")).toThrow();
      expect(deductivePlan(corpus, prepared, "deductive", question, budget, { derivation }))
        .toEqual(original);
      expect(Object.isFrozen(derivation)).toBe(true);
      expect(Object.keys(derivation)).toEqual([]);
    });
  });

  test("rejects a changed question, different prepared source, or forged handle", () => {
    withPrepared((prepared) => {
      const derivation = createDeductiveDerivation(prepared, question);
      expect(() => deductivePlan(corpus, prepared, "deductive", question + " now", budget,
        { derivation })).toThrow("prepared derivation inputs changed");
      withPrepared((different) => {
        expect(() => deductivePlan(corpus, different, "deductive", question, budget,
          { derivation })).toThrow("prepared derivation inputs changed");
      });
      expect(() => deductivePlan(corpus, prepared, "deductive", question, budget,
        { derivation: {} as PreparedDeductiveDerivation })).toThrow("prepared derivation inputs changed");
    });
  });

  test("rejects changed snapshot facts, pruning metadata, dates, positions, and record sources", () => {
    const mutations: ((prepared: ReturnType<typeof prepareDeductive>) => void)[] = [
      (prepared) => { prepared.shards.get("a")!.facts[0]!.sources[0] = "sha256:" + "3".repeat(64); },
      (prepared) => { (prepared.summaries.get("a")!.tokens as Set<string>).add("forged"); },
      (prepared) => { (prepared.sessionDates as Map<string, string>).set("a", "2024-01-01"); },
      (prepared) => { (prepared.positionOf as Map<string, number>).set("a:0", 1); },
      (prepared) => { (prepared.records as unknown[])[0] = prepared.records[1]; },
    ];
    for (const mutate of mutations) withPrepared((prepared) => {
      const derivation = createDeductiveDerivation(prepared, question);
      mutate(prepared);
      expect(() => deductivePlan(corpus, prepared, "deductive", question, budget, { derivation }))
        .toThrow("prepared derivation inputs changed");
    });
  });

  test("rejects a changed authoritative store head", () => {
    withPrepared((prepared) => {
      const derivation = createDeductiveDerivation(prepared, question);
      const record = createKnowledgeGraphRecordV1({ dependencies: [], key: "edition:added",
        kind: "edition", v: 1, value: { text: "new authoritative record" } });
      prepared.store.commit({ actorId: "derivation.test", expectedHead: prepared.store.head(),
        operationId: "op_derivation_mutation", instant: "2026-01-02T00:00:00.000Z",
        changes: [{ kind: "put", record, v: 1 }] });
      expect(() => deductivePlan(corpus, prepared, "deductive", question, budget, { derivation }))
        .toThrow("prepared derivation inputs changed");
    });
  });
});
