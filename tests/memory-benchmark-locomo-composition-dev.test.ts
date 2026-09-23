import { expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import type { EvolutionCampaign, EvolutionPin } from "../scripts/benchmarks/evolution-budget";
import { loadLocomoJudgeProfile } from "../scripts/benchmarks/evolution-locomo-judge";
import { EVOLUTION_PROFILES, evolutionReaderProfileId, parseEvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { EVOLUTION_READER_CONTRACTS } from "../scripts/benchmarks/evolution-reader-contracts";
import { selectLocomoOrderDevIds } from "../scripts/benchmarks/locomo-order-dev";
import { LOCOMO_COMPOSITION_DEV_ARMS, LOCOMO_COMPOSITION_DEV_POPULATION_COUNTS, LOCOMO_COMPOSITION_DEV_READER_PROFILES,
  LOCOMO_COMPOSITION_DEV_TASK_BUDGET, decideLocomoCompositionDev, locomoCompositionDevJudgeReservation,
  locomoCompositionDevResultReceipt, makeLocomoCompositionDevJudgePlan, makeLocomoCompositionDevPlan,
  parseLocomoCompositionDevScorer, parseLocomoCompositionDevSource, selectLocomoCompositionDevIds,
  verifyLocomoCompositionDevPlan, type LocomoCompositionDevOutcome, type LocomoCompositionDevPlanInput,
  type LocomoCompositionDevResult, type LocomoCompositionDevSource } from "../scripts/benchmarks/locomo-composition-dev";

const pin = (name: string): EvolutionPin => ({ path: `/fixture/${name}`, sha256: sha256Hex(name) });
function source(): LocomoCompositionDevSource {
  const population = Object.entries(LOCOMO_COMPOSITION_DEV_POPULATION_COUNTS).flatMap(([groupId, count]) =>
    Array.from({ length: count }, (_, i) => ({ questionId: `${groupId}:${i}`, groupId })));
  const groups = new Map(population.map(row => [row.questionId, row.groupId]));
  return { protocol: "oh.locomo-composition-dev-source.v1", datasetSha256: sha256Hex("dataset"),
    captureSha256: sha256Hex("capture"), selectionPolicySha256: sha256Hex("policy"), population,
    questions: selectLocomoCompositionDevIds(population).map(id => ({ id, groupId: groups.get(id)!, question: `What fact for ${id}?`,
      questionDate: "2023-05-01", contexts: LOCOMO_COMPOSITION_DEV_ARMS.map(armId => {
        const text = `${id} évidence 🧠`;
        return { armId, text, contextSha256: sha256Hex(text), turnIds: ["D1:2", "D1:1"] };
      }) })) };
}
function input(value = source()): LocomoCompositionDevPlanInput {
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "composition-dev-fixture",
    storeDirectory: "/fixture/store", approval: "Offline synthetic only", additionalBudgetMicros: 8_000_000,
    maximumCalls: 1920, historicalExposureMicros: 0, historicalLedgers: [{ ...pin("history"), bytes: 0 }], authAuthority: pin("authority") };
  return { source: value, sourcePin: pin("source"), scorerPin: pin("scorer"), campaignPin: pin("campaign"), campaign };
}
function fixture() {
  const value = source(), plan = makeLocomoCompositionDevPlan(input(value));
  const scorer = parseLocomoCompositionDevScorer({ protocol: "oh.locomo-composition-dev-scorer.v1", datasetSha256: value.datasetSha256,
    sourceSha256: canonicalSha256(value), questions: value.questions.map((q, i) => ({ id: q.id, corpusId: q.groupId, category: i % 4 === 0 ? "locomo:2" : "locomo:1",
      question: q.question, answer: "GOLD_ONLY fact", unanswerable: false })) }, value);
  const outcomes: LocomoCompositionDevOutcome[] = plan.readerJobs.map(job => {
    const response = parseEvolutionResponse(Buffer.from(JSON.stringify({ model: job.request.model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "same answer" } }],
      usage: { prompt_tokens: 100, completion_tokens: 4, total_tokens: 104 },
      providerMetadata: { gateway: { routing: { finalProvider: job.request.provider, originalModelId: job.request.model,
        canonicalSlug: job.request.model, resolvedProviderApiModelId: "gpt-4o-mini" } } } })), job.request);
    return { jobKey: job.key, disposition: response.status, response, failure: null, chargeMicros: response.usage.micros, serviceMs: 1 };
  });
  return { value, plan, scorer, outcomes };
}

test("composition reuses the exact old metadata draw, without selection by category or result", () => {
  const value = source();
  expect(selectLocomoCompositionDevIds(value.population)).toEqual(selectLocomoOrderDevIds(value.population));
  expect(selectLocomoCompositionDevIds([...value.population].reverse())).toEqual(value.questions.map(q => q.id));
  expect(value.questions).toHaveLength(160);
  for (const group of ["conv-49", "conv-50"]) expect(value.questions.filter(q => q.groupId === group)).toHaveLength(80);
  expect(() => selectLocomoCompositionDevIds(value.population.slice(1))).toThrow();
});

test("source rejects gold, draw changes and any context byte or ordered-ID difference", () => {
  const value = source(); expect(Object.isFrozen(parseLocomoCompositionDevSource(value))).toBeTrue();
  const mutate = (f: (v: any) => void) => { const v = structuredClone(value); f(v); expect(() => parseLocomoCompositionDevSource(v)).toThrow(); };
  mutate(v => { v.questions[0].answer = "GOLD_ONLY"; });
  mutate(v => { v.questions[0].category = "locomo:2"; });
  mutate(v => { v.questions.reverse(); });
  mutate(v => { v.questions[0].contexts[1].turnIds.reverse(); });
  mutate(v => { v.questions[0].contexts[1].turnIds = ["D1:2", "D1:3"]; });
  mutate(v => { const c = v.questions[0].contexts[1]; c.text = c.text.replace("é", "è"); c.contextSha256 = sha256Hex(c.text); });
  mutate(v => { v.questions[0].contexts[1].armId = "anchors-query-4"; });
  mutate(v => { for (const c of v.questions[0].contexts) { c.text = "é".repeat(6001); c.contextSha256 = sha256Hex(c.text); } });
});

test("both existing reader profiles bind exact instructions while provider parameters and user bytes stay identical", () => {
  const value = source(), plan = makeLocomoCompositionDevPlan(input(value));
  expect(plan.readerProfiles).toEqual(LOCOMO_COMPOSITION_DEV_READER_PROFILES);
  expect(plan.readerProfiles.map(p => p.profileId)).toEqual(["gpt4o-mini-reader", "gpt4o-mini-composition-v1-reader"]);
  expect(evolutionReaderProfileId("gpt4o-mini-reader", "composition-v1")).toBe("gpt4o-mini-composition-v1-reader");
  const jobs = new Map(plan.readerJobs.map(job => [job.key, job]));
  const cells = plan.cases.filter(c => c.questionId === plan.questionIds[0] && c.repeat === 0);
  const baseline = jobs.get(cells.find(c => c.armId === "vector-window")!.readerJobKey)!.request;
  const candidate = jobs.get(cells.find(c => c.armId === "vector-window-composition")!.readerJobKey)!.request;
  expect(baseline.body.messages[1]).toEqual(candidate.body.messages[1]);
  expect(baseline.body.messages[0]!.content).toBe(EVOLUTION_READER_CONTRACTS["legacy-v1"].instruction);
  expect(candidate.body.messages[0]!.content).toBe(EVOLUTION_READER_CONTRACTS["composition-v1"].instruction);
  const { messages: _baselineMessages, ...baselineBody } = baseline.body;
  const { messages: _candidateMessages, ...candidateBody } = candidate.body;
  expect(candidateBody).toEqual(baselineBody);
  expect(candidateBody).toMatchObject({ model: "openai/gpt-4o-mini", temperature: 0, max_tokens: 2048 });
  for (const binding of plan.readerProfiles) {
    expect(binding.profileSha256).toBe(canonicalSha256(EVOLUTION_PROFILES[binding.profileId]));
    expect(binding.instructionSha256).toBe(EVOLUTION_READER_CONTRACTS[binding.contractId].instructionSha256);
    expect(plan.readerJobs.filter(j => j.request.profileId === binding.profileId)).toHaveLength(480);
  }
  expect(canonicalJson(plan)).not.toContain("GOLD_ONLY");
  expect(candidate.requestSha256).not.toBe(baseline.requestSha256);
  const tampered = structuredClone(plan) as any;
  tampered.readerProfiles[1].profileId = "gpt5-mini-reader";
  const { planSha256: _hash, ...payload } = tampered; tampered.planSha256 = canonicalSha256(payload);
  expect(() => verifyLocomoCompositionDevPlan(tampered, input(value))).toThrow("reconstruct");
});

test("full 960-case plan reserves 960 worst-case judges, balances dispatch and fails oversized complete cost", () => {
  const inputs = input(), plan = makeLocomoCompositionDevPlan(inputs);
  expect(plan.cases).toHaveLength(960); expect(plan.readerJobs).toHaveLength(960);
  expect(plan.maximumPhysicalCalls).toBe(1920);
  expect(plan.maximumJudgeReservationMicros).toBe(960 * locomoCompositionDevJudgeReservation());
  expect(plan.maximumReservationMicros).toBe(plan.maximumReaderReservationMicros + plan.maximumJudgeReservationMicros);
  expect(plan.maximumReservationMicros).toBeLessThanOrEqual(8_000_000);
  expect(verifyLocomoCompositionDevPlan(plan, inputs)).toEqual(plan);
  expect(() => makeLocomoCompositionDevPlan({ ...inputs, campaign: { ...inputs.campaign, additionalBudgetMicros: 8_000_001 } })).toThrow("fixed");
  expect(() => makeLocomoCompositionDevPlan({ ...inputs, campaign: { ...inputs.campaign, maximumCalls: 1921 } })).toThrow("fixed");
  expect(() => verifyLocomoCompositionDevPlan({ ...plan, cases: plan.cases.slice(1) }, inputs)).toThrow("reconstruct");
  expect(new Set(plan.readerJobs.map(job => job.repeat))).toEqual(new Set([0, 1, 2]));
  for (const groupId of ["conv-49", "conv-50"]) for (const arm of LOCOMO_COMPOSITION_DEV_ARMS) {
    const cells = plan.cases.filter(cell => cell.groupId === groupId), positions = [0, 0];
    cells.forEach((cell, i) => { if (cell.armId === arm) positions[i % 2]!++; });
    expect(positions).toEqual([120, 120]);
  }
  expect(LOCOMO_COMPOSITION_DEV_TASK_BUDGET).toEqual({ authorizedMicros: 25_000_000, priorCompletedMicros: 3_759_317,
    newCampaignMaximumMicros: 8_000_000, maximumTaskMicros: 11_759_317, unallocatedMicros: 13_240_683 });
  const oversized = { ...source(), questions: source().questions.map(q => ({ ...q, question: `${q.id} ${"x".repeat(16000)}`,
    contexts: q.contexts.map(c => ({ ...c, text: "x".repeat(12000), contextSha256: sha256Hex("x".repeat(12000)) })) })) };
  expect(() => makeLocomoCompositionDevPlan(input(oversized))).toThrow("full predeclared matrix");
});

test("native judge shares exact prompts across both reader profiles and repeats, with gold only after capture", async () => {
  const { plan, scorer, outcomes } = fixture(), rubric = await loadLocomoJudgeProfile();
  const judge = makeLocomoCompositionDevJudgePlan(plan, scorer, outcomes, rubric);
  expect(judge.judgeCases).toHaveLength(960); expect(judge.judgeJobs).toHaveLength(160);
  expect(judge.judgeJobs.every(job => job.repeat === 0)).toBeTrue();
  expect(canonicalJson(judge.judgeJobs[0]!.request)).toContain("GOLD_ONLY");
  expect(() => makeLocomoCompositionDevJudgePlan(plan, scorer, outcomes.slice(1), rubric)).toThrow("complete");
  const stale = outcomes.map((o, i) => i ? o : { ...o, response: { ...o.response!, profileSha256: sha256Hex("other profile") } });
  expect(() => makeLocomoCompositionDevJudgePlan(plan, scorer, stale, rubric)).toThrow("profile binding");
  const unresolved = outcomes.map((o, i) => i ? o : { ...o, disposition: "unresolved" as const });
  expect(() => makeLocomoCompositionDevJudgePlan(plan, scorer, unresolved, rubric)).toThrow("complete");
  const refused = outcomes.map((o, i) => i ? o : { ...o, disposition: "refused" as const,
    response: { ...o.response!, status: "refused" as const, answer: null } });
  const failures = makeLocomoCompositionDevJudgePlan(plan, scorer, refused, rubric);
  expect(failures.judgeCases).toHaveLength(960);
  expect(failures.judgeCases.filter(c => c.disposition === "reader-failure")).toHaveLength(1);
  const huge = outcomes.map(o => ({ ...o, response: { ...o.response!, answer: "x".repeat(24001) } }));
  const bounded = makeLocomoCompositionDevJudgePlan(plan, scorer, huge, rubric);
  expect(bounded.judgeJobs).toHaveLength(0);
  expect(bounded.judgeCases.every(c => c.disposition === "judge-input-bound")).toBeTrue();
});

test("compact phase identity changes with a native answer and never serializes answer text", () => {
  const { plan, outcomes } = fixture();
  const payload: Omit<LocomoCompositionDevResult, "resultSha256"> = {
    protocol: "oh.locomo-composition-dev-result.v1", phase: "reader", planSha256: plan.planSha256, scorerSha256: plan.scorerPin.sha256,
    readerOutcomes: outcomes, judgePlanSha256: null, judgeCases: [], judgeJobs: [], judgeOutcomes: [], halt: "none",
    ledger: { calls: 960, exposureMicros: 960, confirmedMicros: 960, unresolvedMicros: 0, additionalBudgetMicros: 8_000_000,
      maximumCalls: 1920, historicalExposureMicros: 0, combinedExposureMicros: 960 } };
  const receipt = locomoCompositionDevResultReceipt(payload);
  expect(receipt.protocol).toBe("oh.locomo-composition-dev-receipt.v1");
  expect(canonicalJson(receipt)).not.toContain("same answer");
  const changed = { ...payload, readerOutcomes: outcomes.map((o, i) => i ? o : { ...o, response: { ...o.response!, answer: "different answer" } }) };
  expect(locomoCompositionDevResultReceipt(changed).resultSha256).not.toBe(receipt.resultSha256);
  expect(() => locomoCompositionDevResultReceipt({ ...changed, resultSha256: receipt.resultSha256 })).toThrow("digest changed");
  expect(() => locomoCompositionDevResultReceipt({ ...payload, readerOutcomes: [...outcomes, outcomes[0]!] })).toThrow("matrix bound");
});

test("advancement requires three points overall, both nonnegative groups, positive temporal effect and complete clean judging", () => {
  const input = { overallDelta: 0.03, groupDeltas: [{ groupId: "conv-49", delta: 0 }, { groupId: "conv-50", delta: 0.06 }],
    temporalDelta: 1 / 117, temporalQuestions: 39, matrixComplete: true, readerFailureCases: 0, judgeOnlyFailureCases: 0 };
  expect(decideLocomoCompositionDev(input)).toMatchObject({ advanceToSeparateConfirmation: true,
    confirmedImprovement: false, externalFrameworkSuperiority: false });
  expect(decideLocomoCompositionDev({ ...input, overallDelta: 0.03 - 5e-13 }).advanceToSeparateConfirmation).toBeTrue();
  expect(decideLocomoCompositionDev({ ...input, overallDelta: 0.03 - 2e-12 }).advanceToSeparateConfirmation).toBeFalse();
  expect(decideLocomoCompositionDev({ ...input, matrixComplete: false }).advanceToSeparateConfirmation).toBeFalse();
  expect(decideLocomoCompositionDev({ ...input, readerFailureCases: 1 }).advanceToSeparateConfirmation).toBeFalse();
  expect(decideLocomoCompositionDev({ ...input, judgeOnlyFailureCases: 1 }).advanceToSeparateConfirmation).toBeFalse();
  expect(decideLocomoCompositionDev({ ...input, groupDeltas: [{ groupId: "conv-49", delta: -0.001 },
    { groupId: "conv-50", delta: 0.061 }] }).advanceToSeparateConfirmation).toBeFalse();
  for (const temporalDelta of [-0.01, 0, 1e-12]) expect(decideLocomoCompositionDev({ ...input, temporalDelta }).advanceToSeparateConfirmation).toBeFalse();
  for (const temporalQuestions of [0, -1, 0.5, 161, NaN]) expect(() => decideLocomoCompositionDev({ ...input, temporalQuestions })).toThrow();
  expect(() => decideLocomoCompositionDev({ ...input, temporalDelta: Infinity })).toThrow();
  expect(() => decideLocomoCompositionDev({ ...input, overallDelta: NaN })).toThrow();
  expect(() => decideLocomoCompositionDev({ ...input, groupDeltas: input.groupDeltas.slice(1) })).toThrow();
});
