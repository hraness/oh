import { describe, expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { BEAM_RELEASED_CATEGORIES_V1, BEAM_RELEASED_REPORTER_PIN_V1, BEAM_RELEASED_RESULTS_LIMITS_V1,
  createBeamReleasedResultsPlanV1, reduceBeamReleasedResultsV1, type BeamReleasedCategoryV1,
  type BeamReleasedResultsPlanV1 } from "../scripts/benchmarks/beam-released-results-v1";

type Question = { history: string; question: string; category: BeamReleasedCategoryV1 };
const POLICY = "a".repeat(64);
const capture = (label: string) => canonicalSha256({ capture: label });
function planInput(questions: Question[], arms = ["oh"], repeats = 1) {
  return { scorePolicySha256: POLICY, arms, repeats, questions, requests: arms.flatMap(arm => questions.flatMap(q =>
    Array.from({ length: repeats }, (_, repeat) => ({ arm, history: q.history, question: q.question, repeat,
      requestSha256: canonicalSha256({ arm, ...q, repeat }) })))) };
}
const request = (plan: BeamReleasedResultsPlanV1, arm: string, question: string, repeat: number) =>
  plan.requests.find(row => row.arm === arm && row.question === question && row.repeat === repeat)!;
function scored(plan: BeamReleasedResultsPlanV1, arm: string, question: string, value: number | object, repeat = 0, event?: Record<string, unknown>) {
  const row = request(plan, arm, question, repeat), q = plan.questions.find(item => item.question === question)!;
  const result = q.category === "event_ordering"
    ? { tau_norm: value, final_score: 0, f1: 0, precision: 0, recall: 0, llm_judge_score: 0, ...event } : { llm_judge_score: value };
  return { arm, history: row.history, question, repeat, requestSha256: row.requestSha256, scorePolicySha256: POLICY,
    category: q.category, status: "scored", captureSha256: capture(`${arm}/${question}/${repeat}`), result };
}
const allTen = (history: string, reversed = false): Question[] =>
  (reversed ? [...BEAM_RELEASED_CATEGORIES_V1].reverse() : BEAM_RELEASED_CATEGORIES_V1).map(category => ({ history, question: `${category}:0`, category }));
const panelOf = (result: ReturnType<typeof reduceBeamReleasedResultsV1>, arm = "oh") => result.arms.find(row => row.arm === arm)!;
const categoryOf = (result: ReturnType<typeof reduceBeamReleasedResultsV1>, name: BeamReleasedCategoryV1, arm = "oh") =>
  panelOf(result, arm).categories.find(row => row.category === name)!;

describe("BEAM released result projection (invented data only)", () => {
  test("keys all ten columns by category identity, not by declaration or object key order", () => {
    const plan = createBeamReleasedResultsPlanV1(planInput(allTen("1", true)));
    const observations = plan.questions.map(q => {
      const value = (BEAM_RELEASED_CATEGORIES_V1.indexOf(q.category) + 1) / 16;
      const row = scored(plan, "oh", q.question, value);
      return Object.fromEntries(Object.entries(row).reverse());
    });
    const result = reduceBeamReleasedResultsV1(plan, observations.reverse());
    expect(result.columns).toEqual([...BEAM_RELEASED_CATEGORIES_V1]);
    expect(result.releasedCompatible).toBeTrue();
    expect(result.complete).toBeTrue();
    expect(panelOf(result).releasedPanel).toEqual(BEAM_RELEASED_CATEGORIES_V1.map((_, index) => (index + 1) / 16));
    expect(result.reporter).toEqual(BEAM_RELEASED_REPORTER_PIN_V1);
    const { resultSha256, ...payload } = result;
    expect(resultSha256).toBe(canonicalSha256(payload));
    expect(Object.isFrozen(result.arms[0]!.categories[0])).toBeTrue();
  });

  test("gives histories equal weight, unlike a question-weighted mean", () => {
    const questions: Question[] = [{ history: "1", question: "s1", category: "summarization" },
      ...["s2", "s3", "s4"].map(question => ({ history: "2", question, category: "summarization" as const }))];
    const plan = createBeamReleasedResultsPlanV1(planInput(questions));
    const result = reduceBeamReleasedResultsV1(plan, [scored(plan, "oh", "s1", 1), ...["s2", "s3", "s4"].map(q => scored(plan, "oh", q, 0))]);
    const summary = categoryOf(result, "summarization");
    expect(summary).toMatchObject({ status: "finite", histories: 2, questions: 4, cells: 4, releasedMean: 0.5, questionWeightedMean: 0.25 });
    expect(summary.historyMeans).toEqual([{ history: "1", questions: 1, mean: 1 }, { history: "2", questions: 3, mean: 0 }]);
    expect(result.releasedCompatible).toBeFalse();
    expect(panelOf(result).releasedPanel).toBeNull();
  });

  test("averages repeats within a question before any other reduction", () => {
    const questions: Question[] = [{ history: "1", question: "k0", category: "knowledge_update" }, { history: "1", question: "k1", category: "knowledge_update" }];
    const one = createBeamReleasedResultsPlanV1(planInput(questions));
    const single = reduceBeamReleasedResultsV1(one, [scored(one, "oh", "k0", 0.25), scored(one, "oh", "k1", 0.75)]);
    const two = createBeamReleasedResultsPlanV1(planInput(questions, ["oh"], 2));
    const same = reduceBeamReleasedResultsV1(two, [0, 1].flatMap(r => [scored(two, "oh", "k0", 0.25, r), scored(two, "oh", "k1", 0.75, r)]));
    const varied = reduceBeamReleasedResultsV1(two, [scored(two, "oh", "k0", 0, 0), scored(two, "oh", "k0", 0.5, 1),
      scored(two, "oh", "k1", 1, 0), scored(two, "oh", "k1", 0.5, 1)]);
    for (const result of [single, same, varied]) expect(categoryOf(result, "knowledge_update").releasedMean).toBe(0.5);
    expect(categoryOf(same, "knowledge_update").cells).toBe(4);
    expect(same.planSha256).not.toBe(single.planSha256);
  });

  test("projects event tau_norm and keeps the other event metrics as diagnostics", () => {
    const plan = createBeamReleasedResultsPlanV1(planInput([{ history: "1", question: "e0", category: "event_ordering" }]));
    const result = reduceBeamReleasedResultsV1(plan, [scored(plan, "oh", "e0", 0.75, 0,
      { final_score: 0.3, f1: 0.4, precision: 0.5, recall: 0.25, llm_judge_score: 0.125 })]);
    expect(categoryOf(result, "event_ordering").releasedMean).toBe(0.75);
    expect(panelOf(result).eventDiagnostics).toEqual({ final_score: 0.3, f1: 0.4, precision: 0.5, recall: 0.25, llm_judge_score: 0.125 });
    const judgeOnly = createBeamReleasedResultsPlanV1(planInput([{ history: "1", question: "a0", category: "abstention" }]));
    expect(panelOf(reduceBeamReleasedResultsV1(judgeOnly, [scored(judgeOnly, "oh", "a0", 1)])).eventDiagnostics).toBeNull();
  });

  test("keeps singleton and empty event non-finites tagged with their capture digest", () => {
    const plan = createBeamReleasedResultsPlanV1(planInput([{ history: "1", question: "e0", category: "event_ordering" },
      { history: "2", question: "e1", category: "event_ordering" }]));
    const result = reduceBeamReleasedResultsV1(plan, [scored(plan, "oh", "e0", { nonFinite: "nan" }, 0, { final_score: { nonFinite: "nan" } }),
      scored(plan, "oh", "e1", 1, 0, { final_score: 1 })]);
    const events = categoryOf(result, "event_ordering");
    expect(events.status).toBe("non-finite");
    expect(events.releasedMean).toEqual({ nonFinite: "nan" });
    expect(events.historyMeans).toEqual([{ history: "1", questions: 1, mean: { nonFinite: "nan" } }, { history: "2", questions: 1, mean: 1 }]);
    expect(result.complete).toBeTrue();
    expect(result.counts).toMatchObject({ scored: 2, nonFinite: 1 });
    expect(result.nonFinite).toEqual([{ arm: "oh", history: "1", question: "e0", repeat: 0, captureSha256: capture("oh/e0/0"), value: { nonFinite: "nan" } }]);
    expect(panelOf(result).eventDiagnostics!.final_score).toEqual({ nonFinite: "nan" });
    expect(events.questionWeightedMean).toEqual({ nonFinite: "nan" });
    expect(panelOf(result).releasedPanel).toBeNull();
  });

  test("reports absent, unresolved and failed cells without dropping or zeroing them", () => {
    const questions: Question[] = ["t0", "t1", "t2", "t3"].map((question, index) => ({ history: String(index + 1), question, category: "temporal_reasoning" }));
    const plan = createBeamReleasedResultsPlanV1(planInput(questions, ["oh", "sm"]));
    const base = { scorePolicySha256: POLICY, category: "temporal_reasoning" };
    const t1 = request(plan, "oh", "t1", 0), t2 = request(plan, "oh", "t2", 0);
    const result = reduceBeamReleasedResultsV1(plan, [scored(plan, "oh", "t0", 1),
      { ...base, arm: "oh", history: "2", question: "t1", repeat: 0, requestSha256: t1.requestSha256, status: "unresolved", reason: "Provider outcome unknown at deadline" },
      { ...base, arm: "oh", history: "3", question: "t2", repeat: 0, requestSha256: t2.requestSha256, status: "failed", captureSha256: capture("bad"), reason: "Judge reply had no parsable score" },
      ...questions.map(q => scored(plan, "sm", q.question, 0.5))]);
    expect(result.complete).toBeFalse();
    expect(result.counts).toEqual({ planned: 8, observed: 7, scored: 5, nonFinite: 0, unresolved: 1, failed: 1, missing: 1 });
    expect(result.missing).toEqual([{ arm: "oh", history: "4", question: "t3", repeat: 0 }]);
    expect(result.unresolved).toEqual([{ arm: "oh", history: "2", question: "t1", repeat: 0, reason: "Provider outcome unknown at deadline" }]);
    expect(result.failed).toEqual([{ arm: "oh", history: "3", question: "t2", repeat: 0, captureSha256: capture("bad"), reason: "Judge reply had no parsable score" }]);
    expect(categoryOf(result, "temporal_reasoning")).toMatchObject({ status: "incomplete", releasedMean: null, questionWeightedMean: null });
    expect(categoryOf(result, "temporal_reasoning").historyMeans.map(row => row.mean)).toEqual([1, null, null, null]);
    expect(categoryOf(result, "temporal_reasoning", "sm")).toMatchObject({ status: "finite", releasedMean: 0.5 });
    expect(() => reduceBeamReleasedResultsV1(plan, [scored(plan, "oh", "t0", 1), scored(plan, "oh", "t0", 1)])).toThrow("duplicate observed cell");
  });

  test("rejects changed score policy, request identity, category, plan digest and foreign cells", () => {
    const plan = createBeamReleasedResultsPlanV1(planInput([{ history: "1", question: "p0", category: "preference_following" }]));
    const good = scored(plan, "oh", "p0", 1);
    expect(reduceBeamReleasedResultsV1(plan, [good]).complete).toBeTrue();
    for (const [change, message] of [
      [{ scorePolicySha256: "b".repeat(64) }, "score policy mismatch"], [{ requestSha256: "c".repeat(64) }, "request identity mismatch"],
      [{ category: "abstention" }, "unexpected category assignment"], [{ arm: "other" }, "foreign observed cell"],
      [{ question: "p9" }, "foreign observed cell"], [{ repeat: 1 }, "repeat index bound"], [{ status: "pending" }, "explicit cell status"],
    ] as const) expect(() => reduceBeamReleasedResultsV1(plan, [{ ...good, ...change }])).toThrow(message);
    expect(() => reduceBeamReleasedResultsV1({ ...plan, planSha256: "d".repeat(64) }, [good])).toThrow("plan digest mismatch");
    expect(() => reduceBeamReleasedResultsV1({ ...plan, repeats: 2 }, [good])).toThrow();
    const { captureSha256: _, ...uncaptured } = good;
    expect(() => reduceBeamReleasedResultsV1(plan, [uncaptured])).toThrow("unexpected or missing fields");
    expect(() => reduceBeamReleasedResultsV1(plan, [{ ...good, reason: "extra" }])).toThrow("unexpected or missing fields");
  });

  test("marks an empty category explicitly and withholds the full released panel", () => {
    const questions = allTen("1").filter(q => q.category !== "instruction_following");
    const plan = createBeamReleasedResultsPlanV1(planInput(questions));
    const result = reduceBeamReleasedResultsV1(plan, questions.map(q => scored(plan, "oh", q.question, 1)));
    expect(categoryOf(result, "instruction_following")).toEqual({ category: "instruction_following", status: "empty", histories: 0,
      questions: 0, cells: 0, historyMeans: [], releasedMean: null, questionWeightedMean: null });
    expect(result.complete).toBeTrue();
    expect(result.releasedCompatible).toBeFalse();
    expect(panelOf(result).releasedPanel).toBeNull();
    const partial = createBeamReleasedResultsPlanV1(planInput([...allTen("1"), { history: "2", question: "x", category: "abstention" }]));
    expect(reduceBeamReleasedResultsV1(partial, partial.questions.map(q => scored(partial, "oh", q.question, 1))).releasedCompatible).toBeFalse();
  });

  test("averages histories with Python 3.12 compensated sum but questions with sequential addition", () => {
    const across = Array.from({ length: 10 }, (_, index): Question => ({ history: String(index + 1), question: `m${index}`, category: "multi_session_reasoning" }));
    const plan = createBeamReleasedResultsPlanV1(planInput(across));
    const result = categoryOf(reduceBeamReleasedResultsV1(plan, across.map(q => scored(plan, "oh", q.question, 0.1))), "multi_session_reasoning");
    expect(result.releasedMean).toBe(0.1);
    expect(result.questionWeightedMean).toBe(0.09999999999999999);
    const within = across.map(q => ({ ...q, history: "1" }));
    const one = createBeamReleasedResultsPlanV1(planInput(within));
    expect(categoryOf(reduceBeamReleasedResultsV1(one, within.map(q => scored(one, "oh", q.question, 0.1))), "multi_session_reasoning").releasedMean)
      .toBe(0.09999999999999999);
  });

  test("bounds plan size and rejects malformed identifiers, scalars and accessors", () => {
    const question = (index: number): Question => ({ history: "1", question: `q${index}`, category: "information_extraction" });
    const { arms, repeats, questions: maximumQuestions, cells } = BEAM_RELEASED_RESULTS_LIMITS_V1;
    expect(() => createBeamReleasedResultsPlanV1(planInput([question(0)], Array.from({ length: arms + 1 }, (_, index) => `arm${index}`)))).toThrow("array length bound");
    for (const count of [0, repeats + 1, 1.5]) expect(() => createBeamReleasedResultsPlanV1(planInput([question(0)], ["oh"], count))).toThrow("repeat count bound");
    expect(() => createBeamReleasedResultsPlanV1({ ...planInput([question(0)]), questions: Array.from({ length: maximumQuestions + 1 }, (_, index) => question(index)) })).toThrow("array length bound");
    const wide = Array.from({ length: maximumQuestions }, (_, index) => question(index));
    expect(() => createBeamReleasedResultsPlanV1({ ...planInput([question(0)]), arms: Array.from({ length: arms }, (_, index) => `arm${index}`), repeats: 3, questions: wide }))
      .toThrow("cell bound exceeded");
    expect(arms * maximumQuestions * 3).toBeGreaterThan(cells);
    for (const bad of ["", " arm", "a".repeat(129), "arm/1", "ärm"]) expect(() => createBeamReleasedResultsPlanV1(planInput([question(0)], [bad]))).toThrow();
    const base = planInput([question(0), question(1)]);
    expect(() => createBeamReleasedResultsPlanV1({ ...base, requests: base.requests.slice(1) })).toThrow("array length bound");
    expect(() => createBeamReleasedResultsPlanV1({ ...base, requests: [base.requests[0], base.requests[0]] })).toThrow("duplicate planned cell");
    expect(() => createBeamReleasedResultsPlanV1({ ...base, questions: [question(0), question(0)] })).toThrow("duplicate question");
    expect(() => createBeamReleasedResultsPlanV1({ ...base, extra: true })).toThrow("unexpected or missing fields");
    const plan = createBeamReleasedResultsPlanV1(base);
    for (const value of ["0.5", true, null, 1.5, -0.25, -0, Number.NaN, Number.POSITIVE_INFINITY, { nonFinite: "NaN" }, { nonFinite: "nan", note: 1 }, {}]) {
      expect(() => reduceBeamReleasedResultsV1(plan, [scored(plan, "oh", "q0", value as number)])).toThrow();
    }
    expect(() => reduceBeamReleasedResultsV1(plan, Array.from({ length: 3 }, () => scored(plan, "oh", "q0", 1)))).toThrow("array length bound");
    let read = false;
    const accessor = scored(plan, "oh", "q0", 1);
    Object.defineProperty(accessor, "status", { enumerable: true, get: () => { read = true; return "scored"; } });
    expect(() => reduceBeamReleasedResultsV1(plan, [accessor])).toThrow("data fields"); expect(read).toBeFalse();
    const failed = { ...scored(plan, "oh", "q0", 1), status: "failed", reason: "x".repeat(513) } as Record<string, unknown>;
    delete failed.result;
    expect(() => reduceBeamReleasedResultsV1(plan, [failed])).toThrow("bounded reason");
  });
});
