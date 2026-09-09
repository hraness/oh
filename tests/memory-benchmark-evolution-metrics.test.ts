import { describe, expect, test } from "bun:test";
import { normalizeLocomoAnswer, scoreEvolutionEvidence, scoreLocomoF1, stemLocomoNltkPorter,
  summarizeEvolutionPairs, summarizeEvolutionScores, type EvolutionMetricCase, type EvolutionScore } from "../scripts/benchmarks/evolution-metrics";

describe("LoCoMo F1 rubric", () => {
  test("normalizes the official extra conjunction, ASCII punctuation and Unicode word boundaries", () => {
    expect(normalizeLocomoAnswer("The cat, and an apple's skin!")).toBe("cat apples skin");
    expect(normalizeLocomoAnswer("thé andy and 彼the人")).toBe("thé andy 彼the人");
    expect(normalizeLocomoAnswer(" A\u0085cat\u001c AND dog ")).toBe("cat dog");
    expect(normalizeLocomoAnswer("\ufeffcat")).toBe("\ufeffcat");
  });
  test("uses NLTK-specific irregular and suffix behavior, not generic Porter", () => {
    const examples: Record<string, string> = {
      skies: "sky", dying: "die", lying: "lie", tying: "tie", news: "news", innings: "inning", outings: "outing", canning: "canning",
      proceed: "proceed", exceed: "exceed", succeed: "succeed", dies: "die", flies: "fli", died: "die", spied: "spi", enjoy: "enjoy",
      spy: "spi", happy: "happi", feed: "feed", agreed: "agre", hopping: "hop", filing: "file", falling: "fall", hiss: "hiss",
      relational: "relat", conditional: "condit", hopeful: "hope", controll: "control", roll: "roll", caresses: "caress", ponies: "poni",
      SKIES: "ski", Dying: "dy", "İS": "i̇s", "éing": "éing", "💡ies": "💡ie",
    };
    for (const [word, stem] of Object.entries(examples)) expect(stemLocomoNltkPorter(word)).toBe(stem);
  });
  test("counts repeated tokens and returns zero for two empty normalized answers", () => {
    expect(scoreLocomoF1({ category: "locomo:4", answer: "cat cat dog" }, "cat dog")).toBeCloseTo(0.8, 12);
    expect(scoreLocomoF1({ category: "locomo:4", answer: "the and" }, "a")).toBe(0);
    expect(scoreLocomoF1({ category: "locomo:2", answer: "running quickly" }, "runs quickly")).toBe(1);
  });
  test("multi-hop averages per-gold-subanswer best F1 without penalizing extra comma guesses", () => {
    expect(scoreLocomoF1({ category: "locomo:1", answer: "cat, red dog" }, "cat, dog, unrelated")).toBeCloseTo(5 / 6, 12);
    expect(scoreLocomoF1({ category: "locomo:1", answer: "cat, dog" }, "cat")).toBe(0.5);
  });
  test("open-domain takes the first semicolon answer, other categories do not", () => {
    expect(scoreLocomoF1({ category: "locomo:3", answer: "cat; dog" }, "cat")).toBe(1);
    expect(scoreLocomoF1({ category: "locomo:4", answer: "cat; dog" }, "cat")).toBeCloseTo(2 / 3, 12);
  });
  test("retains the official adversarial phrase rule and rejects foreign categories", () => {
    expect(scoreLocomoF1({ category: "locomo:5", answer: "" }, "That was NOT MENTIONED.")).toBe(1);
    expect(scoreLocomoF1({ category: "locomo:5", answer: "" }, "I don't know.")).toBe(0);
    expect(() => scoreLocomoF1({ category: "multi-session", answer: "cat" }, "cat")).toThrow("LoCoMo category");
    expect(() => scoreLocomoF1({ category: "locomo:1", answer: "x,".repeat(400) }, "x,".repeat(400))).toThrow("bound");
  });
});

const cases: readonly EvolutionMetricCase[] = [
  { id: "a", groupId: "family-a", historyId: "same-conversation", category: "recall" },
  { id: "b", groupId: "family-a", historyId: "same-conversation", category: "recall" },
  { id: "c", groupId: "family-b", historyId: "same-conversation", category: "temporal" },
  { id: "d", groupId: "family-c", historyId: "other-conversation", category: "temporal" },
];
const scores = (values: readonly number[]): EvolutionScore[] => values.map((score, i) => ({ id: cases[i]!.id, score, failed: false }));

describe("evolution metrics remain separate and paired", () => {
  test("empty evidence is unscored, not perfect recall or an answer correctness score", () => {
    expect(scoreEvolutionEvidence([], ["t1"])).toEqual({ expected: 0, found: 0, recall: null, all: null });
    expect(scoreEvolutionEvidence(["t1", "t2", "t2"], ["t1", "t1"])).toEqual({ expected: 2, found: 1, recall: 0.5, all: false });
  });
  test("retains explicit failures in answer denominators", () => {
    const results = scores([1, 0, 1, 0]); results[3] = { ...results[3]!, failed: true };
    const result = summarizeEvolutionScores(cases, results, "judge-accuracy");
    expect(result.overall).toEqual({ cases: 4, scored: 4, unscored: 0, failed: 1, mean: 0.5, declaredGroups: 3, declaredHistories: 2 });
    expect(result.byHistory.find(h => h.id === "same-conversation")!.cases).toBe(3);
    expect(result.qualification).toContain("no independent-sample count");
    expect(() => summarizeEvolutionScores(cases, results.slice(1), "judge-accuracy")).toThrow("missing");
    expect(() => summarizeEvolutionScores(cases, [{ id: "a", score: 1, failed: true }, ...results.slice(1)], "judge-accuracy")).toThrow("failed result");
  });
  test("paired wins/losses match by ID rather than array position and preserve shared history", () => {
    const result = summarizeEvolutionPairs(cases, scores([1, 1, 0, 0]), scores([0, 1, 1, 0]).reverse(), "judge-accuracy");
    expect(result.paired).toEqual({ cases: 4, scored: 4, unscored: 0, wins: 1, losses: 1, ties: 2, meanDelta: 0, declaredGroups: 3, declaredHistories: 2 });
    expect(result.byCategory.find(c => c.id === "recall")!.meanDelta).toBe(0.5);
    expect(result.byHistory.find(h => h.id === "same-conversation")!.meanDelta).toBe(0);
  });
  test("requires matched retrieval eligibility and does not allow fractional judge accuracy", () => {
    const left = scores([1, 0, 1, 0]); left[0] = { ...left[0]!, score: null };
    expect(summarizeEvolutionScores(cases, left, "evidence-recall").overall.scored).toBe(3);
    expect(() => summarizeEvolutionPairs(cases, left, scores([1, 0, 1, 0]), "evidence-recall")).toThrow("different eligibility");
    expect(() => summarizeEvolutionScores(cases, left, "judge-accuracy")).toThrow("every eligible score");
    expect(() => summarizeEvolutionScores(cases, scores([0.5, 0, 1, 0]), "judge-accuracy")).toThrow("fractional");
    expect(summarizeEvolutionScores(cases, scores([0.5, 0, 1, 0]), "locomo-f1").overall.mean).toBe(0.375);
  });
});
