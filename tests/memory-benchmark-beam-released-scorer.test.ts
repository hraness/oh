import { describe, expect, test } from "bun:test";
import { BEAM_RELEASED_SCORER_LIMITS_V1, bindBeamReleasedScorerTemplatesV1, kendallTauBV1,
  stepBeamReleasedScoreV1 } from "../scripts/benchmarks/beam-released-scorer-v1";

const templates = bindBeamReleasedScorerTemplatesV1({ nugget: "Judge <rubric_item> against <llm_response>. Question: <question>.",
  extraction: "Split <input_text> for <question>." }, "invented");
const input = (category: string, rubric: string[], answer = "ANSWER", question = "Q?") => ({ category, rubric, answer, question, templates });
function run(value: ReturnType<typeof input>, replies: string[]) {
  const outcome = stepBeamReleasedScoreV1(value, replies);
  if (outcome.status === "request") throw new Error(`unexpected request ${outcome.index}`);
  return outcome;
}
const judged = (value: ReturnType<typeof input>, reply: string) => run(value, [reply]);

describe("released BEAM scorer port (invented templates and replies)", () => {
  test("binds released templates only by digest and records invented use", () => {
    expect(() => bindBeamReleasedScorerTemplatesV1({ nugget: templates.nugget, extraction: templates.extraction })).toThrow("digest mismatch");
    expect(templates.mode).toBe("invented");
    expect(judged(input("abstention", ["alpha"]), '{"score": 1}').templatesMode).toBe("invented");
    expect(() => stepBeamReleasedScoreV1({ ...input("abstention", ["alpha"]), templates: { ...templates, mode: "released" } }, [])).toThrow("digest mismatch");
    expect(() => stepBeamReleasedScoreV1({ ...input("abstention", ["alpha"]), templates: { ...templates, nugget: "changed <rubric_item>" } }, [])).toThrow("binding changed");
  });

  test("nugget categories send one judgment per item with Python replace semantics and int() truncation", () => {
    const value = input("knowledge_update", ["alpha <llm_response>", "beta"]);
    const first = stepBeamReleasedScoreV1(value, []);
    expect(first.status === "request" && first.request.kind).toBe("nugget");
    expect(first.status === "request" && first.request.messages).toEqual([{ role: "user", content: "Judge alpha ANSWER against ANSWER. Question: <question>." }]);
    const outcome = run(value, ['{"score": 1}', '```json\n{"score": 0.5}\n```']);
    expect(outcome).toMatchObject({ status: "scored", calls: 2, result: { llm_judge_score: 0.5 } });
    expect(outcome.status === "scored" && Object.keys(outcome.result)).toEqual(["llm_judge_score"]);
  });

  test("replies are parsed as the released code parses them and never coerced", () => {
    const nugget = input("temporal_reasoning", ["alpha"]);
    // Python strip() removes U+001C..U+001F; without it this reply would fall through to the lazy regex and fail.
    for (const [reply, score] of [['{"score": "1"}', 1], ['{"score": true}', 1], ['Verdict: {"score": 1} thanks', 1], ["\u001c{\"score\": 1, \"note\": \"}\"}\u001f", 1],
      ['{"score": -0.5}', 0], ['{"score": 1, "score": 0}', 0], ['{"score": "1_0"}', 10]] as const) {
      expect(judged(nugget, reply)).toMatchObject({ status: "scored", result: { llm_judge_score: score } });
    }
    for (const [reply, reason] of [['{"score": "0.5"}', "int()"], ["not json", "json_repair"], ['{"reason": "none"}', "int()"],
      ["[1, 2]", "int()"], ['{"score": NaN}', "only Python accepts"], ['{"score": 12345678901234567890}', "int()"]] as const) {
      const outcome = judged(nugget, reply);
      expect(outcome.status).toBe("failed");
      expect(outcome.status === "failed" && outcome.reason).toContain(reason);
    }
  });

  test("event ordering sends the discarded extraction, greedy equivalence checks, then float judgments", () => {
    const value = input("event_ordering", ["A", "B", "C"], "B\n\nA\nX", "Which order?");
    const replies = ["ignored facts", "NO", "Yes, same", "no", "nope", "YES", "NO", '{"score": "0.5"}', '{"score": 1}', '{"score": 0}'];
    const requests = replies.map((_, index) => stepBeamReleasedScoreV1(value, replies.slice(0, index)))
      .map(step => step.status === "request" ? step.request : null);
    expect(requests[0]).toMatchObject({ kind: "extraction", messages: [{ role: "user", content: "Split B\n\nA\nX for Which order?." }] });
    const pairs = requests.slice(1, 7).map(request => request!.messages[1]!.content.match(/^First snippet: (.*) \n\n {23}Second snippet: (.*)\n {20}$/su)!.slice(1));
    expect(pairs).toEqual([["A", "B"], ["B", "B"], ["A", ""], ["C", ""], ["A", "A"], ["C", "X"]]);
    expect(requests[1]!.messages[0]!.content).toContain("You are a binary classifier.");
    expect(requests.slice(7).map(request => request!.kind)).toEqual(["nugget", "nugget", "nugget"]);
    const outcome = run(value, replies);
    const precision = 0.5, recall = 2 / 3, f1 = 2 * precision * recall / (precision + recall);
    const tauNorm = (kendallTauBV1([1, 2, 3, 6, 6], [3, 1, 6, 2, 4]) + 1) / 2;
    expect(outcome).toMatchObject({ status: "scored", calls: 10 });
    expect(outcome.status === "scored" && outcome.result).toEqual({ precision, recall, f1, tau_norm: tauNorm, final_score: tauNorm * f1, llm_judge_score: 0.5 });
  });

  test("an unmatched line equal to an item counts as that item; singleton ranks give a tagged NaN", () => {
    const outcome = run(input("event_ordering", ["A"], "A\nA"), ["facts", "NO", "YES", '{"score": "nan"}']);
    expect(outcome.status === "scored" && outcome.result).toEqual({ precision: 1, recall: 1, f1: 1, tau_norm: { nonFinite: "nan" },
      final_score: { nonFinite: "nan" }, llm_judge_score: { nonFinite: "nan" } });
  });

  test("Kendall tau-b matches pinned SciPy values, including ties and degenerate inputs", () => {
    expect(kendallTauBV1([1, 2, 3, 6, 6], [3, 1, 6, 2, 4])).toBe(0.10540925533894596);
    expect(kendallTauBV1([1, 2, 3, 4], [1, 2, 4, 3])).toBe(0.6666666666666669);
    expect(kendallTauBV1([1, 1, 2, 3], [2, 1, 3, 3])).toBe(0.7999999999999999);
    expect(kendallTauBV1([1, 2, 3], [3, 2, 1])).toBe(-1);
    for (const [x, y] of [[[], []], [[1], [1]], [[2, 2, 2], [1, 2, 3]]] as const) expect(kendallTauBV1(x, y)).toBeNaN();
  });

  test("replay is deterministic, binds its transcript and refuses surplus replies", () => {
    const value = input("summarization", ["alpha", "beta"]);
    const a = run(value, ['{"score": 1}', '{"score": 0}']), b = run(value, ['{"score": 1}', '{"score": 0}']);
    expect(a).toEqual(b);
    expect(a.requestSha256s).toHaveLength(2);
    expect(run(value, ['{"score": 1}', '{"score": 1}']).transcriptSha256).not.toBe(a.transcriptSha256);
    expect(() => stepBeamReleasedScoreV1(value, ['{"score": 1}', '{"score": 0}', '{"score": 1}'])).toThrow("more replies");
    expect(Object.isFrozen(a)).toBeTrue();
  });

  test("bounds inputs; an empty rubric fails where the released reducer divides by zero", () => {
    expect(run(input("abstention", []), [])).toMatchObject({ status: "failed", calls: 0 });
    expect(run(input("event_ordering", []), ["facts"])).toMatchObject({ status: "failed", calls: 1 });
    const long = input("event_ordering", ["a", "b", "c", "d", "e"], Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join("\n"));
    expect(run(long, [])).toMatchObject({ status: "failed", calls: 0, reason: "worst-case event call count exceeds the bound" });
    expect(() => stepBeamReleasedScoreV1(input("abstention", Array.from({ length: BEAM_RELEASED_SCORER_LIMITS_V1.rubricItems + 1 }, () => "x")), [])).toThrow("rubric");
    expect(() => stepBeamReleasedScoreV1(input("overall", ["x"]), [])).toThrow("category");
    expect(() => stepBeamReleasedScoreV1(input("abstention", ["x"]), [42])).toThrow("reply");
    expect(() => stepBeamReleasedScoreV1(input("abstention", ["x"], "\ud800"), [])).toThrow();
  });
});
