import { describe, expect, test } from "bun:test";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { frozenWindow } from "../scripts/benchmarks/deductive-frozen-control";
import { prepareWindowIndex, selectWindowPolicies, WINDOW_ARMS,
  WINDOW_POLICY } from "../scripts/benchmarks/deductive-window-probe";
import { pack } from "../scripts/benchmarks/retrieval";

const corpus: Corpus = { id: "window-fixture", groupId: "window-fixture",
  turns: Array.from({ length: 80 }, (_, index) => ({ id: `t${String(index).padStart(2, "0")}`,
    sessionId: "repeated-session-name", sessionIndex: Math.floor(index / 20),
    date: "1 May 2023", speaker: index % 2 ? "Sam" : "Evan",
    text: index % 7 === 0 ? "Hiking beside mountains café 🏔️. ".repeat(14)
      : `A conversation about watercolor painting number ${index}. `.repeat(4) })) };
const vector = Array.from({ length: 20 }, (_, rank) => corpus.turns[Math.floor(rank / 5) * 20 + rank % 5 * 3]!.id);

describe("development window policy matrix", () => {
  test("baseline is byte-identical and every arm packs whole original turns under 12KB", () => {
    const selected = selectWindowPolicies(corpus, prepareWindowIndex(corpus), "What did Evan say about hiking?", vector);
    expect([...selected.keys()]).toEqual(WINDOW_ARMS);
    expect(selected.get("vector-window")).toEqual(frozenWindow(corpus, vector));
    for (const got of selected.values()) {
      expect(Buffer.byteLength(got.context)).toBeLessThanOrEqual(12_000);
      const replay = pack(got.turnIds.map((id) => ({ turn: corpus.turns.find((turn) => turn.id === id)! })), 12_000);
      expect(got.context).toBe(replay.context);
      expect(got.turnIds).toEqual(replay.turnIds);
    }
  });

  test("anchor-first arms preserve all twenty seed ranks before neighbors", () => {
    const selected = selectWindowPolicies(corpus, prepareWindowIndex(corpus), "Which paintings did Sam mention?", vector);
    for (const arm of ["anchors-ring-2", "anchors-ring-4", "anchors-query-4", "anchors-query-density-4"] as const) {
      expect(selected.get(arm)!.turnIds.slice(0, 20)).toEqual(vector);
    }
  });

  test("candidate expansion never crosses session occurrences or radius four", () => {
    const seeds = corpus.turns.slice(0, 20).map((turn) => turn.id);
    const selected = selectWindowPolicies(corpus, prepareWindowIndex(corpus), "What happened?", seeds);
    for (const got of selected.values()) for (const id of got.turnIds) {
      expect(corpus.turns.find((turn) => turn.id === id)!.sessionIndex).toBe(0);
    }
    const index = prepareWindowIndex(corpus);
    const spread = selectWindowPolicies(corpus, index, "What did Evan say?", vector);
    for (const got of spread.values()) for (const id of got.turnIds) {
      const position = index.positionOf.get(id)!;
      expect(vector.some((seed) => {
        const seedPosition = index.positionOf.get(seed)!;
        return Math.abs(seedPosition - position) <= 4
          && corpus.turns[seedPosition]!.sessionIndex === corpus.turns[position]!.sessionIndex;
      })).toBe(true);
    }
  });

  test("fixed policies are deterministic, reject incomplete ranks, and have no gold input", () => {
    const index = prepareWindowIndex(corpus);
    expect(selectWindowPolicies(corpus, index, "How does Evan paint?", vector))
      .toEqual(selectWindowPolicies(corpus, index, "How does Evan paint?", vector));
    expect(() => selectWindowPolicies(corpus, index, "Question", vector.slice(1))).toThrow("complete unique top-20");
    expect(() => selectWindowPolicies(corpus, index, "Question", [...vector.slice(0, 19), vector[0]!]))
      .toThrow("complete unique top-20");
    expect(WINDOW_POLICY.corpora).toEqual(["conv-49", "conv-50"]);
  });
});
