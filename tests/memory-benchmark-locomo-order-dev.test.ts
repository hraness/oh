import { expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import type { EvolutionCampaign, EvolutionPin } from "../scripts/benchmarks/evolution-budget";
import { loadLocomoJudgeProfile } from "../scripts/benchmarks/evolution-locomo-judge";
import { parseEvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { LOCOMO_ORDER_DEV_ARMS, LOCOMO_ORDER_DEV_POPULATION_COUNTS, locomoOrderDevJudgeReservation,
  makeLocomoOrderDevJudgePlan, makeLocomoOrderDevPlan, parseLocomoOrderDevScorer,
  parseLocomoOrderDevSource, selectLocomoOrderDevIds, verifyLocomoOrderDevPlan,
  type LocomoOrderDevOutcome, type LocomoOrderDevPlanInput, type LocomoOrderDevSource } from "../scripts/benchmarks/locomo-order-dev";
import { restoreSelectedSourceOrder } from "../scripts/benchmarks/locomo-order-dev-source";
import { decideLocomoOrderDev } from "../scripts/benchmarks/locomo-order-dev-report";
import { renderTurn } from "../scripts/benchmarks/retrieval";

const pin = (name: string): EvolutionPin => ({ path: `/fixture/${name}`, sha256: sha256Hex(name) });
function source(identical = false): LocomoOrderDevSource {
  const population = Object.entries(LOCOMO_ORDER_DEV_POPULATION_COUNTS).flatMap(([groupId, count]) =>
    Array.from({ length: count }, (_, i) => ({ questionId: `${groupId}:${i}`, groupId })));
  const groups = new Map(population.map(row => [row.questionId, row.groupId]));
  return { protocol: "oh.locomo-order-dev-source.v1", datasetSha256: sha256Hex("dataset"),
    captureSha256: sha256Hex("capture"), selectionPolicySha256: sha256Hex("policy"), population,
    questions: selectLocomoOrderDevIds(population).map(id => ({ id, groupId: groups.get(id)!, question: `What fact for ${id}?`,
      questionDate: "2023-05-01", contexts: LOCOMO_ORDER_DEV_ARMS.map((armId, i) => {
        const text = `${id} ${identical ? "AB" : ["AB", "BA", "CD", "DC"][i]}`;
        return { armId, text, contextSha256: sha256Hex(text), turnIds: i % 2 ? ["D1:2", "D1:1"] : ["D1:1", "D1:2"] };
      }) })) };
}
function input(value = source()): LocomoOrderDevPlanInput {
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "order-dev-fixture",
    storeDirectory: "/fixture/store", approval: "Offline synthetic only", additionalBudgetMicros: 15_000_000,
    maximumCalls: 3840, historicalExposureMicros: 0, historicalLedgers: [{ ...pin("history"), bytes: 0 }], authAuthority: pin("authority") };
  return { source: value, sourcePin: pin("source"), scorerPin: pin("scorer"), campaignPin: pin("campaign"), campaign };
}

test("development draw is fixed, order independent and exactly 80 questions per group", () => {
  const value = source(), ids = selectLocomoOrderDevIds(value.population);
  expect(selectLocomoOrderDevIds([...value.population].reverse())).toEqual(ids);
  expect(ids).toHaveLength(160);
  expect(ids.filter(id => id.startsWith("conv-49:"))).toHaveLength(80);
  expect(ids.filter(id => id.startsWith("conv-50:"))).toHaveLength(80);
  expect(() => selectLocomoOrderDevIds(value.population.slice(1))).toThrow();
  expect(() => selectLocomoOrderDevIds(value.population.map((q, i) => i === 0 ? { ...q, groupId: "conv-26" } : q))).toThrow();
});

test("reader source rejects gold, changed draw, membership and UTF-8 volume", () => {
  const value = source(); expect(Object.isFrozen(parseLocomoOrderDevSource(value))).toBeTrue();
  const mutate = (f: (v: any) => void) => { const v = structuredClone(value); f(v); expect(() => parseLocomoOrderDevSource(v)).toThrow(); };
  mutate(v => { v.questions[0].answer = "GOLD_ONLY"; });
  mutate(v => { v.questions.reverse(); });
  mutate(v => { v.questions[0].contexts[1].turnIds = ["D1:1", "D1:3"]; });
  mutate(v => { const c = v.questions[0].contexts[1]; c.text += "é"; c.contextSha256 = sha256Hex(c.text); });
  mutate(v => { v.questions[0].contexts[2].text = "é".repeat(6001); });
});

test("source ordering preserves exact selected source text, Unicode bytes and sparse membership", () => {
  const turns = [1, 2, 3, 4].map(i => ({ id: `D1:${i}`, date: `2023-05-0${i}`, sessionId: "session-1",
    speaker: i % 2 ? "Person A" : "Person B", text: `évidence ${i} 🧠` }));
  const original = { turnIds: ["D1:4", "D1:1", "D1:3"], context: [turns[3]!, turns[0]!, turns[2]!].map(renderTurn).join("\n\n") };
  const sorted = restoreSelectedSourceOrder({ turns }, original);
  expect(sorted.turnIds).toEqual(["D1:1", "D1:3", "D1:4"]);
  expect(sorted.context).toBe([turns[0]!, turns[2]!, turns[3]!].map(renderTurn).join("\n\n"));
  expect(Buffer.byteLength(sorted.context)).toBe(Buffer.byteLength(original.context));
  expect(restoreSelectedSourceOrder({ turns }, sorted)).toEqual(sorted);
  expect(original.turnIds).toEqual(["D1:4", "D1:1", "D1:3"]);
  expect(() => restoreSelectedSourceOrder({ turns }, { ...original, context: original.context.replace("évidence", "rewritten") })).toThrow("text");
  expect(() => restoreSelectedSourceOrder({ turns }, { ...original, turnIds: ["D1:4", "D1:4"] })).toThrow("bound");
  expect(() => restoreSelectedSourceOrder({ turns }, { context: "", turnIds: ["missing"] })).toThrow("unknown");
  expect(() => restoreSelectedSourceOrder({ turns }, { context: "é".repeat(6001), turnIds: [] })).toThrow("bound");
});

test("full four-arm plan reserves every possible judge with no outcome-dependent fallback", () => {
  const inputs = input(), plan = makeLocomoOrderDevPlan(inputs);
  expect(plan.cases).toHaveLength(1920); expect(plan.readerJobs).toHaveLength(1920);
  expect(plan.maximumPhysicalCalls).toBe(3840);
  expect(plan.maximumJudgeReservationMicros).toBe(1920 * locomoOrderDevJudgeReservation());
  expect(plan.maximumReservationMicros).toBe(plan.maximumReaderReservationMicros + plan.maximumJudgeReservationMicros);
  expect(verifyLocomoOrderDevPlan(plan, inputs)).toEqual(plan);
  expect(() => makeLocomoOrderDevPlan({ ...inputs, campaign: { ...inputs.campaign, additionalBudgetMicros: 14_999_999 } })).toThrow("fixed");
  expect(() => verifyLocomoOrderDevPlan({ ...plan, cases: plan.cases.slice(1) }, inputs)).toThrow("reconstruct");
  expect(plan.readerJobs[0]!.request.body).toMatchObject({ model: "openai/gpt-4o-mini", temperature: 0, max_tokens: 2048 });
  expect(canonicalJson(plan)).not.toContain("GOLD_ONLY");
  const shared = makeLocomoOrderDevPlan(input(source(true)));
  expect(shared.readerJobs).toHaveLength(480); expect(shared.cases).toHaveLength(1920);
  expect(new Set(shared.readerJobs.map(job => job.repeat))).toEqual(new Set([0, 1, 2]));
  for (const groupId of ["conv-49", "conv-50"]) for (const arm of LOCOMO_ORDER_DEV_ARMS) {
    const cells = plan.cases.filter(cell => cell.groupId === groupId), positions = [0, 0, 0, 0];
    cells.forEach((cell, i) => { if (cell.armId === arm) positions[i % 4]!++; });
    expect(positions).toEqual([60, 60, 60, 60]);
  }
});

test("native judge shares exact prompts across four arms and repeats, with gold only in judge requests", async () => {
  const value = source(), plan = makeLocomoOrderDevPlan(input(value));
  const scorer = parseLocomoOrderDevScorer({ protocol: "oh.locomo-order-dev-scorer.v1", datasetSha256: value.datasetSha256,
    sourceSha256: canonicalSha256(value), questions: value.questions.map(q => ({ id: q.id, corpusId: q.groupId, category: "locomo:1",
      question: q.question, answer: "GOLD_ONLY fact", unanswerable: false })) }, value);
  const outcomes: LocomoOrderDevOutcome[] = plan.readerJobs.map(job => {
    const response = parseEvolutionResponse(Buffer.from(JSON.stringify({ model: job.request.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "same answer" } }],
      usage: { prompt_tokens: 100, completion_tokens: 4, total_tokens: 104 },
      providerMetadata: { gateway: { routing: { finalProvider: job.request.provider, originalModelId: job.request.model,
        canonicalSlug: job.request.model, resolvedProviderApiModelId: "gpt-4o-mini" } } } })), job.request);
    return { jobKey: job.key, disposition: response.status, response, failure: null, chargeMicros: response.usage.micros, serviceMs: 1 };
  });
  const rubric = await loadLocomoJudgeProfile(), judge = makeLocomoOrderDevJudgePlan(plan, scorer, outcomes, rubric);
  expect(judge.judgeCases).toHaveLength(1920); expect(judge.judgeJobs).toHaveLength(160);
  expect(judge.judgeJobs.every(job => job.repeat === 0)).toBeTrue();
  expect(canonicalJson(judge.judgeJobs[0]!.request)).toContain("GOLD_ONLY");
  expect(() => makeLocomoOrderDevJudgePlan(plan, scorer, outcomes.slice(1), rubric)).toThrow("complete");
  const huge = outcomes.map(o => ({ ...o, response: { ...o.response!, answer: "x".repeat(24001) } }));
  const bounded = makeLocomoOrderDevJudgePlan(plan, scorer, huge, rubric);
  expect(bounded.judgeJobs).toHaveLength(0);
  expect(bounded.judgeCases.every(c => c.disposition === "judge-input-bound")).toBeTrue();
});

test("development advancement requires the fixed effect, both groups, complete work and no judge failures", () => {
  const input = { overallDelta: 0.02, groupDeltas: [{ groupId: "conv-49", delta: 0 }, { groupId: "conv-50", delta: 0.04 }],
    matrixComplete: true, judgeOnlyFailureCases: 0 };
  expect(decideLocomoOrderDev(input)).toMatchObject({ advanceToSeparateConfirmation: true, confirmedImprovement: false,
    externalFrameworkSuperiority: false });
  expect(decideLocomoOrderDev({ ...input, overallDelta: 0.019999 }).advanceToSeparateConfirmation).toBeFalse();
  expect(decideLocomoOrderDev({ ...input, matrixComplete: false }).advanceToSeparateConfirmation).toBeFalse();
  expect(decideLocomoOrderDev({ ...input, judgeOnlyFailureCases: 1 }).advanceToSeparateConfirmation).toBeFalse();
  expect(decideLocomoOrderDev({ ...input, groupDeltas: [{ groupId: "conv-49", delta: -0.001 },
    { groupId: "conv-50", delta: 0.041 }] }).advanceToSeparateConfirmation).toBeFalse();
  expect(() => decideLocomoOrderDev({ ...input, overallDelta: NaN })).toThrow();
  expect(() => decideLocomoOrderDev({ ...input, groupDeltas: input.groupDeltas.slice(1) })).toThrow();
});
