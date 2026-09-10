import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memEvalConversationCorpus, memEvalContext, parseMemEvalArgs } from "../scripts/benchmarks/memeval-cli";

const conv = {
  qa: [{ question: "What breed is my dog?", answer: "beagle", category: "single-session-user", question_id: "synthetic_1_abs" }],
  session_2: [{ speaker: "user", text: "The weather in Boston is terrible today.", dia_id: "s2_0" }, { speaker: "assistant", text: "Sorry to hear that.", dia_id: "s2_1" }],
  session_2_date_time: "2023/05/22 (Mon) 10:00",
  session_1: [{ speaker: "user", text: "I adopted a beagle named Lola last week.", dia_id: "s1_0" }, { speaker: "assistant", text: "Congratulations on adopting Lola!", dia_id: "s1_1" }],
  session_1_date_time: "2023/05/20 (Sat) 02:21",
};

test("MemEval conversations map to an Oh corpus with ordered sessions, dated turns and the question identity", () => {
  const corpus = memEvalConversationCorpus(conv);
  expect(corpus.id).toBe("synthetic_1_abs"); expect(corpus.groupId).toBe("synthetic_1");
  expect(corpus.turns.map(t => t.id)).toEqual(["session_1:0", "session_1:1", "session_2:0", "session_2:1"]);
  expect(corpus.turns.map(t => t.sessionIndex)).toEqual([0, 0, 1, 1]);
  expect(corpus.turns[0]).toEqual({ id: "session_1:0", sessionId: "session_1", sessionIndex: 0, date: "2023/05/20 (Sat) 02:21", speaker: "user", text: "I adopted a beagle named Lola last week." });
  const { qa: _qa, ...anonymous } = conv;
  expect(memEvalConversationCorpus(anonymous).id).toMatch(/^conv-[0-9a-f]{16}$/);
  for (const bad of [[], null, { session_1: [] }, { session_1: [{ speaker: "user", text: "x" }] }, { ...conv, session_1_date_time: "" }, { ...conv, session_1: [{ speaker: "", text: "x" }] }]) {
    expect(() => memEvalConversationCorpus(bad)).toThrow();
  }
});

test("query arguments are strict and BM25 retrieval prints a packed dated context without any provider call", async () => {
  const root = await mkdtemp(join(tmpdir(), "oh-memeval-"));
  try {
    const file = join(root, "conv.json"); await writeFile(file, JSON.stringify(conv));
    const query = parseMemEvalArgs(["query", "--conv", file, "--question", "Tell me about Lola the beagle", "--system", "bm25-window", "--top-k", "10", "--max-bytes", "4000"]);
    expect(query).toEqual({ conv: file, question: "Tell me about Lola the beagle", system: "bm25-window", topK: 10, maxBytes: 4000 });
    expect(parseMemEvalArgs(["query", "--conv", file, "--question", "q"]).system).toBe("oh-semantic");
    for (const bad of [["prepare"], ["query", "--conv", "relative.json", "--question", "q"], ["query", "--question", "q"], ["query", "--conv", file],
      ["query", "--conv", file, "--question", "q", "--system", "vector-db"], ["query", "--conv", file, "--question", "q", "--top-k", "0"],
      ["query", "--conv", file, "--question", "q", "--top-k", "101"], ["query", "--conv", file, "--question", "q", "--cache-dir", "cache"],
      ["query", "--conv", file, "--question", "q", "--conv", file]]) expect(() => parseMemEvalArgs(bad)).toThrow();
    const context = await memEvalContext(query);
    expect(context).toContain("[session_1:0] [2023/05/20 (Sat) 02:21] user: I adopted a beagle named Lola last week.");
    expect(context).not.toContain("Boston");
    expect(await memEvalContext({ ...query, question: "zzzz qqqq" })).toBe("");
  } finally { await rm(root, { recursive: true, force: true }); }
});
