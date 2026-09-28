import { describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { analyzeBeamPairedScoresV1, createBeamPairedAnalysisPlanV1, signFlipBeamPairedV1 } from "../scripts/benchmarks/beam-paired-scores-v1";
import { createBeamReleasedResultsPlanV1, type BeamReleasedCategoryV1 } from "../scripts/benchmarks/beam-released-results-v1";

const POLICY = "a".repeat(64);
type Values = Record<string, Record<string, readonly [number, number] | "nan">>;
/** values[history][category] = [oh, sm] judge or tau values; event categories use tau_norm. */
function scenario(values: Values, drop: string[] = []) {
  const questions = Object.entries(values).flatMap(([history, byCategory]) => Object.keys(byCategory)
    .map(category => ({ history, question: `${history}:${category}`, category: category as BeamReleasedCategoryV1 })));
  const releasedPlan = createBeamReleasedResultsPlanV1({ scorePolicySha256: POLICY, arms: ["oh", "sm"], repeats: 1, questions,
    requests: ["oh", "sm"].flatMap(arm => questions.map(q => ({ arm, history: q.history, question: q.question, repeat: 0, requestSha256: canonicalSha256({ arm, q }) }))) });
  const observations = releasedPlan.requests.filter(r => !drop.includes(`${r.arm}/${r.question}`)).map(r => {
    const q = releasedPlan.questions.find(item => item.question === r.question)!, cell = values[q.history]![q.category]!;
    const value = cell === "nan" ? { nonFinite: "nan" } : cell[r.arm === "oh" ? 0 : 1];
    const result = q.category === "event_ordering" ? { tau_norm: value, final_score: 0, f1: 0, precision: 0, recall: 0, llm_judge_score: 0 } : { llm_judge_score: value };
    return { ...r, scorePolicySha256: POLICY, category: q.category, status: "scored", captureSha256: canonicalSha256({ r }), result };
  });
  return { releasedPlan, observations };
}
const plan = (releasedPlanSha256: string, families: { family: string; histories: string[] }[], overrides: Record<string, unknown> = {}) =>
  createBeamPairedAnalysisPlanV1({ releasedPlanSha256, candidate: "oh", comparator: "sm", categories: [{ category: "abstention", weight: 1 }],
    families, resamples: 2_000, seed: 17, alpha: 0.05, superiorityMargin: 0, ...overrides });
const singletons = (histories: string[]) => histories.map(history => ({ family: history, histories: [history] }));
const perHistory = (entries: Record<string, readonly [number, number]>): Values =>
  Object.fromEntries(Object.entries(entries).map(([history, pair]) => [history, { abstention: pair }]));

describe("family-aware paired analysis of released BEAM scores (invented panels)", () => {
  test("decides superiority only when the family bootstrap lower bound clears the margin", () => {
    const { releasedPlan, observations } = scenario(perHistory({ h1: [0.7, 0.5], h2: [0.6, 0.5], h3: [0.8, 0.5], h4: [0.7, 0.5], h5: [0.6, 0.5] }));
    const result = analyzeBeamPairedScoresV1(releasedPlan, observations, plan(releasedPlan.planSha256, singletons(["h1", "h2", "h3", "h4", "h5"])));
    if (result.status !== "decided") throw new Error("expected a decision");
    expect(result.estimate).toBeCloseTo(0.18, 12);
    expect(result.decision).toBe("superior");
    expect(result.bootstrap.lowerBound).toBeGreaterThan(0);
    expect(result.signFlip).toEqual({ method: "exact", assignments: 32, pValue: 1 / 32, agreesWithDecision: true });
    const strict = analyzeBeamPairedScoresV1(releasedPlan, observations, plan(releasedPlan.planSha256, singletons(["h1", "h2", "h3", "h4", "h5"]), { superiorityMargin: 0.25 }));
    expect(strict.status === "decided" && strict.decision).toBe("not-superior");
    expect(analyzeBeamPairedScoresV1(releasedPlan, observations, plan(releasedPlan.planSha256, singletons(["h1", "h2", "h3", "h4", "h5"])))).toEqual(result);
  });

  test("families resample as whole units and weight their histories equally", () => {
    const { releasedPlan, observations } = scenario(perHistory({ h1: [1, 0], h2: [1, 0], h3: [1, 0], h4: [0, 1] }));
    const grouped = analyzeBeamPairedScoresV1(releasedPlan, observations, plan(releasedPlan.planSha256,
      [{ family: "A", histories: ["h1", "h2", "h3"] }, { family: "B", histories: ["h4"] }]));
    const separate = analyzeBeamPairedScoresV1(releasedPlan, observations, plan(releasedPlan.planSha256, singletons(["h1", "h2", "h3", "h4"])));
    expect(grouped.status === "decided" && grouped.estimate).toBe(0);
    expect(separate.status === "decided" && separate.estimate).toBe(0.5);
    expect(grouped.status === "decided" && grouped.families.map(family => family.difference)).toEqual([1, -1]);
  });

  test("declared category weights combine each history before any averaging", () => {
    const values: Values = { h1: { abstention: [1, 0], summarization: [0, 0] }, h2: { abstention: [1, 0], summarization: [0, 0] } };
    const { releasedPlan, observations } = scenario(values);
    const result = analyzeBeamPairedScoresV1(releasedPlan, observations, plan(releasedPlan.planSha256, singletons(["h1", "h2"]),
      { categories: [{ category: "abstention", weight: 3 }, { category: "summarization", weight: 1 }] }));
    expect(result.status === "decided" && result.estimate).toBe(0.75);
    expect(result.status === "decided" && result.descriptiveCategoryDifferences).toEqual([{ category: "abstention", weight: 3, difference: 1 },
      { category: "summarization", weight: 1, difference: 0 }]);
  });

  test("blocks on an incomplete panel, a non-finite mean or an absent category", () => {
    const base = perHistory({ h1: [0.9, 0.1], h2: [0.9, 0.1] });
    const missing = scenario(base, ["oh/h2:abstention"]);
    const incomplete = analyzeBeamPairedScoresV1(missing.releasedPlan, missing.observations, plan(missing.releasedPlan.planSha256, singletons(["h1", "h2"])));
    expect(incomplete).toMatchObject({ status: "blocked", reasons: ["released panel incomplete: 1 missing, 0 unresolved, 0 failed"] });
    const nan = scenario({ h1: { event_ordering: [0.9, 0.1] }, h2: { event_ordering: "nan" } });
    const nonFinite = analyzeBeamPairedScoresV1(nan.releasedPlan, nan.observations, plan(nan.releasedPlan.planSha256, singletons(["h1", "h2"]),
      { categories: [{ category: "event_ordering", weight: 1 }] }));
    expect(nonFinite.status).toBe("blocked");
    expect(nonFinite.status === "blocked" && nonFinite.reasons).toContain("oh event_ordering mean for history h2 is not finite");
    const partial = scenario({ h1: { abstention: [1, 0], summarization: [1, 0] }, h2: { abstention: [1, 0] } });
    const absent = analyzeBeamPairedScoresV1(partial.releasedPlan, partial.observations, plan(partial.releasedPlan.planSha256, singletons(["h1", "h2"]),
      { categories: [{ category: "abstention", weight: 1 }, { category: "summarization", weight: 1 }] }));
    expect(absent).toMatchObject({ status: "blocked", reasons: ["summarization is absent from history h2"] });
  });

  test("rejects plans that do not bind, partition or bound the analysis", () => {
    const { releasedPlan, observations } = scenario(perHistory({ h1: [1, 0], h2: [1, 0] }));
    const run = (families: { family: string; histories: string[] }[], overrides: Record<string, unknown> = {}) =>
      () => analyzeBeamPairedScoresV1(releasedPlan, observations, plan(releasedPlan.planSha256, families, overrides));
    expect(run(singletons(["h1", "h3"]))).toThrow("partition");
    expect(run([{ family: "A", histories: ["h1", "h2"] }, { family: "B", histories: ["h2"] }])).toThrow("one family");
    expect(run(singletons(["h1", "h2"]), { candidate: "other" })).toThrow("planned arms");
    expect(() => analyzeBeamPairedScoresV1(releasedPlan, observations, plan("b".repeat(64), singletons(["h1", "h2"])))).toThrow("different released plan");
    for (const overrides of [{ resamples: 999 }, { alpha: 0.5 }, { superiorityMargin: -0.1 }, { seed: -1 },
      { categories: [{ category: "abstention", weight: 0 }] }, { categories: [{ category: "abstention", weight: 1 }, { category: "abstention", weight: 2 }] }]) {
      expect(run(singletons(["h1", "h2"]), overrides)).toThrow();
    }
    expect(run(singletons(["h1"]))).toThrow("list bound");
    const frozen = plan(releasedPlan.planSha256, singletons(["h1", "h2"]));
    expect(() => analyzeBeamPairedScoresV1(releasedPlan, observations, { ...frozen, alpha: 0.1 })).toThrow("digest mismatch");
  });

  test("the sign-flip test is exact up to twenty families and seeded Monte Carlo above", () => {
    const differences = [0.3, -0.1, 0.2, 0.05, -0.2, 0.15, 0.1, -0.05];
    let atLeast = 0;
    for (let mask = 0; mask < 256; mask += 1) {
      const sum = differences.reduce((total, value, index) => total + ((mask >> index) & 1 ? -value : value), 0);
      if (sum >= differences.reduce((total, value) => total + value, 0) - 1e-12) atLeast += 1;
    }
    expect(signFlipBeamPairedV1(differences, 0, 1_000, 5)).toEqual({ method: "exact", assignments: 256, pValue: atLeast / 256 });
    const many = Array.from({ length: 25 }, (_, index) => (index % 3) * 0.05);
    const a = signFlipBeamPairedV1(many, 0, 5_000, 9);
    expect(a.method).toBe("monte-carlo");
    expect(a).toEqual(signFlipBeamPairedV1(many, 0, 5_000, 9));
    expect(a.pValue).toBeGreaterThan(0);
    expect(signFlipBeamPairedV1([0, 0, 0], 0, 1_000, 1).pValue).toBe(1);
  });
});
