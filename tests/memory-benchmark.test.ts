import { describe, expect, test } from "bun:test";

import { parseLocomo, parseLongMemEval, selectSplit, selectQuestions } from "../scripts/benchmarks/datasets";
import { evidenceMetrics, pairedBootstrap, tokenF1 } from "../scripts/benchmarks/metrics";
import { createRetrievers, renderTurn } from "../scripts/benchmarks/retrieval";
import { runRetrieval } from "../scripts/benchmarks/runner";

function locomo(id = "conversation-a") {
  return {
    sample_id: id,
    conversation: {
      speaker_a: "Ada", speaker_b: "Bea",
      session_1_date_time: "9:00 am on 7 May, 2023",
      session_1: [
        { dia_id: "D1:1", speaker: "Ada", text: "My bicycle is purple." },
        { dia_id: "D1:2", speaker: "Bea", text: "I prefer green bicycles." },
      ],
      session_2_date_time: "10:00 am on 9 May, 2023",
      session_2: [{ dia_id: "D2:1", speaker: "Ada", text: "It is now orange.", blip_caption: "An orange bicycle." }],
    },
    qa: [
      { question: "What color is Ada's bicycle?", answer: "orange", category: 4, evidence: ["D2:1"] },
      { question: "Where did Ada buy a submarine?", adversarial_answer: "Atlantis", category: 5, evidence: [] },
    ],
    event_summary: { secret: "GOLD_EVENT_SENTINEL" },
    observation: { secret: "GOLD_OBSERVATION_SENTINEL" },
    session_summary: { secret: "GOLD_SUMMARY_SENTINEL" },
  };
}

function longmem(id = "question-a") {
  return {
    question_id: id, question_type: "knowledge-update", question: "How many bicycles?", answer: 0,
    question_date: "2023/05/10 (Wed) 12:00",
    haystack_session_ids: ["session-b", "session-a"],
    haystack_dates: ["2023/05/09 (Tue) 10:00", "2023/05/07 (Sun) 09:00"],
    haystack_sessions: [
      [{ role: "user", content: "I sold my bicycle.", has_answer: true }],
      [{ role: "assistant", content: "You have one bicycle." }],
    ],
    answer_session_ids: ["session-b"],
  };
}

describe("benchmark data boundaries", () => {
  test("ingests only raw conversation inputs, preserving dates, speakers, and captions", () => {
    const data = parseLocomo([locomo()]);
    expect(data.corpora[0]?.turns).toHaveLength(3);
    expect(data.corpora[0]?.turns[0]?.date).toBe("9:00 am on 7 May, 2023");
    expect(data.corpora[0]?.turns[2]?.text).toContain("An orange bicycle.");
    expect(JSON.stringify(data.corpora)).not.toContain("GOLD_");
    expect(JSON.stringify(data.corpora)).not.toContain("adversarial_answer");
    expect(JSON.stringify(data.corpora)).not.toContain("evidence");
    expect(data.questions[1]).toMatchObject({ unanswerable: true, answer: "" });
    expect(data.questions[0]?.category).toBe("locomo:4");
  });

  test("normalizes only unambiguous evidence syntax and keeps raw annotations outside memory", () => {
    const original = locomo();
    const evidence = ["(D1:1); D01:02", "D2:1 D9:99", "D:11:26"];
    const changed = parseLocomo([{ ...original, qa: [{ ...original.qa[0], evidence }, original.qa[1]] }]);
    expect(changed.corpora).toEqual(parseLocomo([original]).corpora);
    expect(changed.questions[0]?.rawEvidenceTurnIds).toEqual(evidence);
    expect(changed.questions[0]?.evidenceTurnIds).toEqual(["D1:1", "D1:2", "D2:1", "D9:99", "D:11:26"]);
    expect(JSON.stringify(changed.corpora)).not.toContain("D9:99");
  });

  test("separates LongMemEval answer-location labels and retains numeric zero and question time", () => {
    const data = parseLongMemEval([longmem()]);
    expect(data.questions[0]).toMatchObject({ answer: "0", questionDate: "2023/05/10 (Wed) 12:00",
      evidenceSessionIds: ["session-b"], evidenceTurnIds: ["session-b:0"] });
    expect(JSON.stringify(data.corpora)).not.toContain("has_answer");
    expect(data.corpora[0]?.turns.map((turn) => turn.speaker)).toContain("assistant");
    expect(data.corpora[0]?.turns.map((turn) => turn.sessionId)).toEqual(["session-a", "session-b"]);
    expect(parseLongMemEval([longmem("question-a_abs")]).questions[0]?.unanswerable).toBe(true);
  });

  test("rejects malformed, duplicate, or inconsistent input rather than silently dropping it", () => {
    expect(() => parseLocomo([locomo(), locomo()])).toThrow("duplicate");
    expect(() => parseLocomo([{ ...locomo(), qa: [{ question: "q", category: 4 }] }])).toThrow();
    expect(() => parseLongMemEval([{ ...longmem(), haystack_dates: [] }])).toThrow();
    expect(() => parseLongMemEval([{ ...longmem(), answer: {} }])).toThrow();
    expect(() => parseLocomo([])).toThrow();
  });

  test("keeps every conversation and abstention family entirely inside one split", () => {
    const data = parseLocomo(Array.from({ length: 10 }, (_, index) => locomo(`c-${index}`)));
    const dev = selectSplit(data, "dev", 17);
    const heldout = selectSplit(data, "test", 17);
    const devIds = new Set(dev.corpora.map((corpus) => corpus.id));
    expect(devIds.size).toBe(2);
    expect(heldout.corpora).toHaveLength(8);
    expect(heldout.questions.every((question) => !devIds.has(question.corpusId))).toBe(true);
    expect(selectSplit(data, "dev", 17)).toEqual(dev);
    expect(dev.questions.length + heldout.questions.length).toBe(data.questions.length);
    const families = parseLongMemEval(Array.from({ length: 10 }, (_, index) => [
      longmem(`q-${index}`), longmem(`q-${index}_abs`),
    ]).flat());
    const selected = selectSplit(families, "dev", 17);
    for (const question of selected.questions) {
      const family = question.corpusId.replace(/_abs$/, "");
      expect(selected.corpora.filter((corpus) => corpus.groupId === family)).toHaveLength(2);
    }
  });

  test("pilot selection is deterministic, category-balanced, and independent of answers", () => {
    const data = parseLocomo(Array.from({ length: 5 }, (_, index) => locomo(`c-${index}`)));
    const chosen = selectQuestions(data, 4, 17);
    expect(chosen.questions).toHaveLength(4);
    expect(new Set(chosen.questions.map((question) => question.category)).size).toBe(2);
    expect(selectQuestions(data, 4, 17)).toEqual(chosen);
  });
});

describe("honest benchmark metrics", () => {
  test("uses multiset overlap and does not treat refusal substrings as correct answers", () => {
    expect(tokenF1("red red", "red")).toBeCloseTo(2 / 3);
    expect(tokenF1("The orange bicycle.", "orange bicycle")).toBe(1);
    expect(tokenF1("unknown but the answer is Atlantis", "")).toBe(0);
    expect(tokenF1("None", "")).toBe(1);
    expect(tokenF1("None", "the")).toBe(0);
    expect(tokenF1(".", "")).toBe(0);
    expect(tokenF1("", "")).toBe(0);
    expect(tokenF1("none of these; Atlantis", "")).toBe(0);
    expect(tokenF1("0", "0")).toBe(1);
  });

  test("does not award evidence recall to missing annotations or unanswerable questions", () => {
    const [question, unanswerable] = parseLocomo([locomo()]).questions;
    expect(evidenceMetrics(question!, ["D2:1"], ["session_2"])).toMatchObject({
      turnRecall: 1, allTurns: 1, reciprocalRank: 1,
    });
    expect(evidenceMetrics(question!, ["D1:1"], ["session_1"]).turnRecall).toBe(0);
    expect(evidenceMetrics(unanswerable!, [], []).turnRecall).toBeNull();
    expect(evidenceMetrics({ ...question!, evidenceTurnIds: [], evidenceSessionIds: [] }, [], [])
      .turnRecall).toBeNull();
    expect(evidenceMetrics({ ...question!, evidenceTurnIds: ["D2:1", "missing"] },
      ["D2:1"], ["session_2"]).turnRecall).toBe(0.5);
  });

  test("paired bootstrap resamples conversations, not correlated questions", () => {
    const observations = Array.from({ length: 20 }, (_, index) => ({
      cluster: `c-${index % 4}`, left: 0.25, right: 0.75,
    }));
    const interval = pairedBootstrap(observations, 17, 200);
    expect(interval).toEqual({ clusters: 4, delta: 0.5, lower: 0.5, upper: 0.5, samples: 200 });
    expect(pairedBootstrap(observations, 17, 200)).toEqual(interval);
    expect(pairedBootstrap([], 17, 200)).toBeNull();
    expect(pairedBootstrap([{ cluster: "one", left: 0, right: 1 }], 17, 200)).toBeNull();
  });
});

describe("isolated memory retrieval", () => {
  test("can reserve context for ranked anchors before adding lengthy neighbors", async () => {
    const turns = [
      { id: "a", sessionId: "one", date: "2026-01-01", speaker: "Ada", text: "orbital amber" },
      { id: "b", sessionId: "one", date: "2026-01-01", speaker: "Bea", text: "unrelated background ".repeat(30) },
      { id: "c", sessionId: "two", date: "2026-01-02", speaker: "Ada", text: "orbital cobalt" },
    ];
    const contextBytes = Buffer.byteLength(`${renderTurn(turns[0]!)}\n\n${renderTurn(turns[1]!)}`);
    const memory = createRetrievers({ id: "anchor-test", groupId: "anchor-test", turns });
    try {
      expect((await memory.retrieve("oh-window", "orbital", { topK: 2, contextBytes })).turnIds).toEqual(["a", "b"]);
      for (const system of ["oh-anchor-window", "bm25-anchor-window"] as const) {
        const result = await memory.retrieve(system, "orbital", { topK: 2, contextBytes });
        expect(result.turnIds).toEqual(["a", "c"]);
        expect(Buffer.byteLength(result.context)).toBeLessThanOrEqual(contextBytes);
      }
    } finally { memory.close(); }
  });

  test("rotates baseline order across independent one-question corpora", async () => {
    const data = parseLongMemEval([longmem("first"), longmem("second")]);
    const report = await runRetrieval(data, ["no-memory", "bm25-focused"], { topK: 2, contextBytes: 2_000 }, 17);
    expect(report.rows.map((row) => row.system)).toEqual(["no-memory", "bm25-focused", "bm25-focused", "no-memory"]);
  });

  test("preserves repeated native session IDs without merging occurrences or crossing their boundaries", async () => {
    const data = parseLongMemEval([{ ...longmem(), haystack_session_ids: ["shared", "shared"],
      haystack_dates: ["2023/05/09 (Tue) 10:00", "2023/05/09 (Tue) 10:00"],
      haystack_sessions: [[{ role: "user", content: "tangerine", has_answer: true }],
        [{ role: "user", content: "dolphin" }]], answer_session_ids: ["shared"] }]);
    expect(data.corpora[0]?.turns.map((turn) => turn.id)).toEqual(["shared#0:0", "shared#1:0"]);
    expect(data.questions[0]?.evidenceTurnIds).toEqual(["shared#0:0"]);
    expect(data.questions[0]?.evidenceSessionIds).toEqual(["shared"]);
    const retrievers = createRetrievers(data.corpora[0]!);
    try {
      const result = await retrievers.retrieve("oh-window", "tangerine", { topK: 1, contextBytes: 2_000 });
      expect(result.turnIds).toEqual(["shared#0:0"]);
    } finally { retrievers.close(); }
  });

  test("exercises real Oh keyword search with bounded complete turns and no production paths", async () => {
    const corpus = parseLocomo([locomo()]).corpora[0]!;
    const retrievers = createRetrievers(corpus);
    try {
      const hits = await retrievers.retrieve("oh-keyword", "orange bicycle", { topK: 10, contextBytes: 2_000 });
      expect(hits.turnIds).toContain("D2:1");
      expect(hits.context).toContain("9 May, 2023");
      expect(hits.recordDigests.length).toBe(hits.turnIds.length);
      expect(hits.recordDigests.every((digest) => /^[0-9a-f]{64}$/.test(digest))).toBe(true);
      const tiny = await retrievers.retrieve("oh-keyword", "orange bicycle", { topK: 10, contextBytes: 1 });
      expect(tiny.context).toBe("");
      expect(tiny.turnIds).toEqual([]);
      const none = await retrievers.retrieve("no-memory", "orange", { topK: 10, contextBytes: 2_000 });
      expect(none.turnIds).toEqual([]);
      const full = await retrievers.retrieve("full-context", "orange", { topK: 1, contextBytes: 1 });
      expect(full.turnIds).toHaveLength(3);
      expect(full.budgetExempt).toBe(true);
    } finally { retrievers.close(); }
  });

  test("cannot cross conversation boundaries and keeps duplicate text under distinct IDs", async () => {
    const corpus = parseLocomo([locomo()]).corpora[0]!;
    const other = { ...corpus, id: "other", turns: corpus.turns.map((turn) => ({ ...turn, text: "zebra" })) };
    const left = createRetrievers(corpus);
    const right = createRetrievers(other);
    try {
      expect((await left.retrieve("oh-keyword", "zebra", { topK: 10, contextBytes: 2_000 })).turnIds).toEqual([]);
      expect((await right.retrieve("oh-keyword", "zebra", { topK: 10, contextBytes: 2_000 })).turnIds).toHaveLength(3);
    } finally { left.close(); right.close(); }
  });
});
