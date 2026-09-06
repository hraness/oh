import { describe, expect, test } from "bun:test";

import { DATASETS, type Question } from "../scripts/benchmarks/datasets";
import { buildJudgePrompt, createJudgeMemo, exactJudgeAbstention, loadJudgeProfile, parseJudgeDecision, parseJudgeInput } from "../scripts/benchmarks/judge";
import { PilotBudget } from "../scripts/benchmarks/model";

const question: Question = { id: "q-1", corpusId: "q-1", category: "knowledge-update", question: "Where do I live?",
  questionDate: "2023/05/10 (Wed) 12:00", answer: "Paris", unanswerable: false, evidenceTurnIds: [], evidenceSessionIds: [] };

function report() {
  return { protocol: "oh.memory-benchmark.v1", manifest: { command: "answer", dataset: "longmemeval-s", split: "dev", seed: 17,
    source: { sha256: DATASETS["longmemeval-s"].sha256 }, code: { sourceSha256: "a".repeat(64) },
    selectedQuestions: [question.id], systems: ["no-memory", "oh-window"] },
    provider: { reader: "openai/gpt-4.1", transport: "vercel-gateway", snapshotPinned: false },
    rows: [{ questionId: question.id, corpusId: question.corpusId, category: question.category, system: "no-memory",
      status: "completed", prediction: "None" }, { questionId: question.id, corpusId: question.corpusId,
      category: question.category, system: "oh-window", status: "completed", prediction: "Paris" }] };
}

describe("semantic judge boundaries", () => {
  test("uses attributable native prompts, including preference, update, temporal, and abstention rules", async () => {
    const profile = await loadJudgeProfile();
    expect(profile.profileId).toBe("longmemeval.native-judge-prompts.v1");
    expect(buildJudgePrompt(question, "Paris", profile)).toContain("previous information along with an updated answer");
    expect(buildJudgePrompt({ ...question, category: "single-session-preference" }, "Paris", profile)).toContain("Rubric: Paris");
    expect(buildJudgePrompt({ ...question, category: "temporal-reasoning" }, "Paris", profile)).toContain("off-by-one errors");
    expect(buildJudgePrompt({ ...question, unanswerable: true }, "None", profile)).toContain("unanswerable question");
    expect(buildJudgePrompt({ ...question, category: "locomo:2" }, "Paris", profile)).not.toContain("off-by-one errors");
  });

  test("does not reinterpret placeholders contained in questions or model answers", async () => {
    const profile = await loadJudgeProfile();
    const prompt = buildJudgePrompt({ ...question, question: "What does {response} mean?", answer: "{question}" }, "{answer}", profile);
    expect(prompt).toContain("Question: What does {response} mean?");
    expect(prompt).toContain("Correct Answer: {question}");
    expect(prompt).toContain("Model Response: {answer}");
  });

  test("requires an entire yes/no verdict rather than a substring", () => {
    expect(parseJudgeDecision("Yes.\n")).toBe(1);
    expect(parseJudgeDecision("NO")).toBe(0);
    expect(parseJudgeDecision("yesterday")).toBeNull();
    expect(parseJudgeDecision("yes, but no")).toBeNull();
    expect(parseJudgeDecision(1)).toBeNull();
  });

  test("joins predictions to pinned source questions without trusting report-supplied gold", () => {
    const value = report();
    const parsed = parseJudgeInput(value, "longmemeval-s", "dev", [question]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[1]?.question.answer).toBe("Paris");
    expect(() => parseJudgeInput(value, "locomo", "dev", [question])).toThrow();
    expect(() => parseJudgeInput(value, "longmemeval-s", "test", [question])).toThrow();
    expect(() => parseJudgeInput({ ...value, rows: [value.rows[0], value.rows[0]] }, "longmemeval-s", "dev", [question])).toThrow();
    expect(() => parseJudgeInput({ ...value, rows: value.rows.slice(1) }, "longmemeval-s", "dev", [question])).toThrow();
    expect(() => parseJudgeInput(value, "longmemeval-s", "dev", [])).toThrow();
    expect(() => parseJudgeInput({ ...value, manifest: { ...value.manifest, source: { sha256: "b".repeat(64) } } },
      "longmemeval-s", "dev", [question])).toThrow();
  });

  test("makes identical prompts share one verdict and one physical request", async () => {
    let calls = 0;
    const memo = createJudgeMemo(async (_prompt: string) => ++calls);
    const first = memo("same question, reference, and answer");
    const second = memo("same question, reference, and answer");
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(await first.result).toBe(1);
    expect(await second.result).toBe(1);
    expect(await memo("different answer").result).toBe(2);
    expect(calls).toBe(2);
  });

  test("does not retry a failed identical judge request", async () => {
    let calls = 0;
    const memo = createJudgeMemo(async (_prompt: string) => { calls += 1; throw new Error("known failure"); });
    await expect(memo("same").result).rejects.toThrow("known failure");
    const replay = memo("same");
    expect(replay.reused).toBe(true);
    await expect(replay.result).rejects.toThrow("known failure");
    expect(calls).toBe(1);
  });

  test("recognizes exact LoCoMo abstentions without forgiving fabricated answers", async () => {
    const unanswerable = { ...question, category: "locomo:5", unanswerable: true, answer: "" };
    expect(exactJudgeAbstention(unanswerable, "None")).toBe(true);
    expect(exactJudgeAbstention(unanswerable, "None, but actually Paris")).toBe(false);
    expect(exactJudgeAbstention(question, "None")).toBe(false);
    expect(buildJudgePrompt(unanswerable, "I cannot tell", await loadJudgeProfile()))
      .toContain("The conversation does not provide an answer to this question.");
  });

  test("bounds the smaller GPT-4o context before any request is dispatched", () => {
    const budget = new PilotBudget({ maxUsd: 10, maxCalls: 1 });
    expect(() => budget.reserve(128_000, "openai/gpt-4o", 10)).toThrow("context bound");
    expect(budget.summary.reservedCalls).toBe(0);
  });
});
