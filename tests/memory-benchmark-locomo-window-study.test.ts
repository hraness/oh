import { afterEach, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import type { EvolutionCampaign, EvolutionPin } from "../scripts/benchmarks/evolution-budget";
import { loadLocomoJudgeProfile } from "../scripts/benchmarks/evolution-locomo-judge";
import { parseEvolutionResponse, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore, type EvolutionRaw } from "../scripts/benchmarks/evolution-store";
import { LOCOMO_WINDOW_ARMS, LOCOMO_WINDOW_POPULATION_COUNTS, locomoWindowJudgeReservation, locomoWindowResultReceipt,
  makeLocomoWindowJudgePlan, makeLocomoWindowPlan, parseLocomoWindowScorer, parseLocomoWindowSource,
  selectLocomoWindowIds, verifyLocomoWindowPlan, type LocomoWindowOutcome, type LocomoWindowPlan,
  type LocomoWindowPlanInput, type LocomoWindowResult, type LocomoWindowSource } from "../scripts/benchmarks/locomo-window-study";
import { authenticateLocomoWindowResult, collectLocomoWindowOutcomes, executeLocomoWindowJobs,
  parseLocomoWindowLaunch, prepareLocomoWindowAttempt, type LocomoWindowLaunch } from "../scripts/benchmarks/locomo-window-study-run";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const value = await realpath(await mkdtemp(join(tmpdir(), "oh-locomo-window-"))); roots.push(value); return value; }
const pin = (name: string): EvolutionPin => ({ path: `/fixture/${name}`, sha256: sha256Hex(name) });
function campaign(storeDirectory = "/fixture/store"): EvolutionCampaign {
  return { protocol: "oh.memory.evolution-campaign.v1", campaignId: "locomo-window-fixture", storeDirectory,
    approval: "Offline fixture; no provider calls", additionalBudgetMicros: 20_000_000, maximumCalls: 3600,
    historicalExposureMicros: 0, historicalLedgers: [{ ...pin("history"), bytes: 0 }], authAuthority: pin("authority") };
}
function source(identical = false): LocomoWindowSource {
  const population = Object.entries(LOCOMO_WINDOW_POPULATION_COUNTS).flatMap(([groupId, count]) =>
    Array.from({ length: count }, (_, index) => ({ questionId: `${groupId}:${index}`, groupId })));
  const groups = new Map(population.map(row => [row.questionId, row.groupId]));
  return { protocol: "oh.locomo-window-source.v1", datasetSha256: sha256Hex("fixture dataset"),
    confirmationRowsSha256: sha256Hex("fixture confirmation"), selectionPolicySha256: sha256Hex("fixture fixed policy"), population,
    questions: selectLocomoWindowIds(population, 300).map(id => ({ id, groupId: groups.get(id)!, question: `Which fact belongs to ${id}?`,
      questionDate: "2023-05-01", contexts: LOCOMO_WINDOW_ARMS.map((armId, index) => {
        const text = `PRIVATE ${id}: ${identical ? "same" : index} source turn.`;
        return { armId, text, contextSha256: sha256Hex(text), turnIds: ["D1:1"] };
      }) })) };
}
function input(value = source(), storeDirectory?: string): LocomoWindowPlanInput {
  return { source: value, sourcePin: pin("source"), scorerPin: pin("scorer"), campaignPin: pin("campaign"), campaign: campaign(storeDirectory) };
}
function scorer(value: LocomoWindowSource) {
  return parseLocomoWindowScorer({ protocol: "oh.locomo-window-scorer.v1", datasetSha256: value.datasetSha256,
    sourceSha256: canonicalSha256(value), questions: value.questions.map(question => ({ id: question.id, corpusId: question.groupId,
      category: "locomo:1", question: question.question, answer: "GOLD_ONLY correct fact", unanswerable: false })) }, value);
}
function raw(request: EvolutionRequest, answer = "correct fact", finish = "stop"): EvolutionRaw {
  const body = Buffer.from(JSON.stringify({ model: request.model,
    choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 100, completion_tokens: 4, total_tokens: 104 }, providerMetadata: { gateway: { routing: {
      finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model, resolvedProviderApiModelId: "gpt-4o-mini" } } } }));
  return { httpStatus: 200, body, complete: true, receivedBytes: body.length, error: null, serviceMs: 10 };
}
function outcomes(plan: LocomoWindowPlan, answer = "correct fact"): LocomoWindowOutcome[] {
  return plan.readerJobs.map(job => { const response = parseEvolutionResponse(raw(job.request, answer).body, job.request);
    return { jobKey: job.key, disposition: response.status, response, failure: null, chargeMicros: response.usage.micros, serviceMs: 10 }; });
}
function launch(inputs: LocomoWindowPlanInput): LocomoWindowLaunch {
  return parseLocomoWindowLaunch({ protocol: "oh.locomo-window-launch.v1", sourcePin: inputs.sourcePin,
    scorerPin: inputs.scorerPin, planPin: pin("plan"), campaignPin: inputs.campaignPin, checkpoint: "a".repeat(40),
    reviewer: "independent-fixture-review", approved: true, scope: "reader-judge", maximumNewSpendMicros: 20_000_000,
    maximumPhysicalCalls: 3600, canaryQuestionCount: 2 });
}

test("fixed balanced draw is input-order independent and its only smaller draw is the exact 120 prefix", () => {
  const value = source(), selected = selectLocomoWindowIds(value.population, 300);
  expect(selectLocomoWindowIds([...value.population].reverse(), 300)).toEqual(selected);
  expect(selectLocomoWindowIds(value.population, 120)).toEqual(selected.slice(0, 120));
  const group = new Map(value.population.map(row => [row.questionId, row.groupId]));
  expect(Object.keys(LOCOMO_WINDOW_POPULATION_COUNTS).map(id => selected.filter(q => group.get(q) === id).length).sort()).toEqual([37, 37, 37, 37, 38, 38, 38, 38]);
  expect(Object.keys(LOCOMO_WINDOW_POPULATION_COUNTS).map(id => selected.slice(0, 120).filter(q => group.get(q) === id).length)).toEqual([15, 15, 15, 15, 15, 15, 15, 15]);
  const wrong = value.population.map((row, index) => index === 0 ? { ...row, groupId: "conv-30" } : row);
  expect(() => selectLocomoWindowIds(wrong, 300)).toThrow("population counts");
});

test("reader projection rejects gold, altered context hashes, wrong populations and changed draw order", () => {
  const value = source(); expect(Object.isFrozen(parseLocomoWindowSource(value).questions[0]!.contexts)).toBeTrue();
  const mutate = (change: (value: any) => void) => { const copy = structuredClone(value); change(copy); expect(() => parseLocomoWindowSource(copy)).toThrow(); };
  mutate(row => { row.questions[0].answer = "GOLD_ONLY"; });
  mutate(row => { row.questions[0].category = "locomo:1"; });
  mutate(row => { row.questions[0].contexts[0].text += " edited"; });
  mutate(row => { row.questions[0].contexts[0].text = "é".repeat(6001); });
  mutate(row => { row.questions.reverse(); });
  mutate(row => { row.population.pop(); });
  mutate(row => { row.questions[0].contexts.reverse(); });
});

test("matched legacy profiles reserve every reader and a worst-case judge before selecting the cost-only fallback", () => {
  const inputs = input(), plan = makeLocomoWindowPlan(inputs);
  expect(plan.questionIds).toHaveLength(300); expect(plan.cases).toHaveLength(1800); expect(plan.readerJobs).toHaveLength(1800);
  expect(locomoWindowJudgeReservation()).toBe(4215);
  expect(plan.maximumJudgeReservationMicros).toBe(1800 * 4215);
  expect(plan.maximumReservationMicros).toBe(plan.maximumReaderReservationMicros + plan.maximumJudgeReservationMicros);
  expect(plan.maximumPhysicalCalls).toBe(3600);
  for (const job of plan.readerJobs.slice(0, 6)) {
    expect(job.request.body).toMatchObject({ model: "openai/gpt-4o-mini", temperature: 0, max_tokens: 2048 });
    expect(JSON.stringify(job.request.body)).not.toContain("GOLD_ONLY");
  }
  const fallback = makeLocomoWindowPlan({ ...inputs, campaign: { ...inputs.campaign, additionalBudgetMicros: plan.maximumReservationMicros - 1 } });
  expect(fallback.selection).toBe("cost-only-prefix-120"); expect(fallback.questionIds).toEqual(plan.questionIds.slice(0, 120));
  expect(() => makeLocomoWindowPlan({ ...inputs, campaign: { ...inputs.campaign, maximumCalls: 3599 } })).toThrow("complete bound");
  expect(() => makeLocomoWindowPlan({ ...inputs, campaign: { ...inputs.campaign, additionalBudgetMicros: 1 } })).toThrow("neither");
  expect(verifyLocomoWindowPlan(plan, inputs)).toEqual(plan);
  expect(() => verifyLocomoWindowPlan({ ...plan, maximumReservationMicros: plan.maximumReservationMicros - 1 }, inputs)).toThrow("reconstruct");
  const shared = makeLocomoWindowPlan(input(source(true)));
  expect(shared.cases).toHaveLength(1800); expect(shared.readerJobs).toHaveLength(900);
  expect(new Set(shared.readerJobs.map(job => job.repeat))).toEqual(new Set([0, 1, 2]));
});

test("judge planning reuses byte-identical prompts across arms and all reader repeats, at judge repeat zero", async () => {
  const value = source(), plan = makeLocomoWindowPlan(input(value)), native = outcomes(plan), rubric = await loadLocomoJudgeProfile();
  const judged = makeLocomoWindowJudgePlan(plan, scorer(value), native, rubric);
  expect(judged.judgeCases).toHaveLength(1800); expect(judged.judgeJobs).toHaveLength(300);
  expect(judged.judgeJobs.every(job => job.repeat === 0 && job.request.body.max_tokens === 512)).toBeTrue();
  expect(new Set(judged.judgeCases.slice(0, 6).map(cell => cell.judgeJobKey)).size).toBe(1);
  const first = plan.readerJobs[0]!, escaped = parseEvolutionResponse(raw(first.request, "\u0001".repeat(4000)).body, first.request);
  const second = plan.readerJobs[1]!, truncated = parseEvolutionResponse(raw(second.request, "partial", "length").body, second.request);
  native[0] = { ...native[0]!, response: escaped, disposition: escaped.status, chargeMicros: escaped.usage.micros };
  native[1] = { ...native[1]!, response: truncated, disposition: truncated.status, chargeMicros: truncated.usage.micros };
  const bounded = makeLocomoWindowJudgePlan(plan, scorer(value), native, rubric);
  expect(bounded.judgeCases.filter(cell => cell.disposition === "judge-input-bound")).toHaveLength(1);
  expect(bounded.judgeCases.filter(cell => cell.disposition === "reader-failure")).toHaveLength(1);
  expect(bounded.judgeCases).toHaveLength(plan.cases.length);
  expect(() => makeLocomoWindowJudgePlan(plan, scorer(value), native.slice(1), rubric)).toThrow("complete authenticated");
});

test("four-wide execution stops unknown dispatches, drains owned calls and retains known model failures", async () => {
  const jobs = makeLocomoWindowPlan(input()).readerJobs.slice(0, 8), called: string[] = [], drained: string[] = [];
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  const work = executeLocomoWindowJobs(jobs, async (job, stopped) => {
    called.push(job.key); if (job === jobs[0]) throw new Error("unverifiable first response");
    await pending; expect(stopped()).toBeTrue(); drained.push(job.key);
  });
  await Promise.resolve(); release(); expect(await work).toBeFalse(); expect(called).toHaveLength(4); expect(drained).toHaveLength(3);
  let known = 0; expect(await executeLocomoWindowJobs(jobs, async () => { known++; return { status: "truncated" }; })).toBeTrue(); expect(known).toBe(8);
});

test("native recovery settles captured bytes and never reissues reserved or unverifiable first responses", async () => {
  const path = await directory(), inputs = input(source(), path), jobs = makeLocomoWindowPlan(inputs).readerJobs.slice(0, 5);
  let store = await openEvolutionStore({ directory: path, campaign: inputs.campaign });
  const hashes = new Map<string, string>();
  for (const job of jobs.slice(0, 2)) { store.admit(job.request, job.repeat); store.capture(job.request, raw(job.request), job.repeat);
    hashes.set(job.key, sha256Hex(store.readRaw(job.request, job.repeat))); }
  const unresolved = jobs[2]!; store.admit(unresolved.request, unresolved.repeat);
  const bad = jobs[3]!; store.admit(bad.request, bad.repeat); store.capture(bad.request,
    { httpStatus: null, body: new Uint8Array(), complete: false, receivedBytes: 0, error: "network" }, bad.repeat);
  await store.close(); store = await openEvolutionStore({ directory: path, campaign: inputs.campaign });
  try {
    const rows = collectLocomoWindowOutcomes(jobs, store);
    expect(rows.map(row => row.disposition)).toEqual(["completed", "completed", "unresolved", "unresolved", "unattempted"]);
    expect(store.summary().unresolvedMicros).toBe(unresolved.request.reservationMicros + bad.request.reservationMicros);
    for (const job of jobs.slice(0, 2)) expect(String(sha256Hex(store.readRaw(job.request, job.repeat)))).toBe(hashes.get(job.key)!);
    expect(() => store.admit(unresolved.request, unresolved.repeat)).toThrow("cannot be retried");
    expect(store.summary().calls).toBe(4);
  } finally { await store.close(); }
});

test("explicit resume handles identity-only crashes without changing phase, source or prior receipts", async () => {
  const path = await directory(), inputs = input(source(), path), plan = makeLocomoWindowPlan(inputs), approved = launch(inputs);
  const first = await prepareLocomoWindowAttempt({ storeDirectory: path, launchPin: pin("launch"), launch: approved, plan, mode: "new", phase: "reader" });
  await rm(`${first.prefix}.started.json`); // Crash after the global identity but before the first attempt receipt.
  const resumed = await prepareLocomoWindowAttempt({ storeDirectory: path, launchPin: pin("launch"), launch: approved, plan, mode: "resume", phase: "reader" });
  expect(resumed.attempt).toBe(0);
  const next = await prepareLocomoWindowAttempt({ storeDirectory: path, launchPin: pin("launch"), launch: approved, plan, mode: "resume", phase: "reader" });
  expect(next.attempt).toBe(1); expect((await lstat(`${resumed.prefix}.started.json`)).mode & 0o777).toBe(0o600);
  await expect(prepareLocomoWindowAttempt({ storeDirectory: path, launchPin: pin("changed"), launch: approved, plan, mode: "resume", phase: "reader" })).rejects.toThrow("identity changed");
  await expect(prepareLocomoWindowAttempt({ storeDirectory: path, launchPin: pin("launch"), launch: approved, plan, mode: "new", phase: "judge" })).rejects.toThrow("reader result pin");
});

test("offline report authentication reconstructs a complete native store and rejects a rewritten result", async () => {
  const path = await directory();
  const writePin = async (name: string, value: unknown): Promise<EvolutionPin> => {
    const text = typeof value === "string" ? value : `${canonicalJson(value)}\n`, file = join(path, name);
    await writeFile(file, text, { mode: 0o600, flag: "wx" }); return { path: file, sha256: sha256Hex(text) };
  };
  const value = source(true), gold = scorer(value), authority = await writePin("authority.json", {
    schema: "oh.gateway-v3-authority.v1", project: "oh", scope: "hraness", environment: "development" });
  const history = await writePin("history.jsonl", ""), storeDirectory = join(path, "native-store");
  const budget: EvolutionCampaign = { ...campaign(storeDirectory), additionalBudgetMicros: 5_000_000,
    authAuthority: authority, historicalLedgers: [{ ...history, bytes: 0 }] };
  const inputs: LocomoWindowPlanInput = { source: value, sourcePin: await writePin("source.json", value), scorerPin: await writePin("scorer.json", gold),
    campaignPin: await writePin("campaign.json", budget), campaign: budget };
  const plan = makeLocomoWindowPlan(inputs); expect(plan.questionIds).toHaveLength(120);
  const approved = { ...launch(inputs), planPin: await writePin("plan.json", plan) };
  const launchPin = await writePin("launch.json", approved), rubric = await loadLocomoJudgeProfile();
  const store = await openEvolutionStore({ directory: storeDirectory, campaign: budget });
  let result: LocomoWindowResult;
  try {
    for (const job of plan.readerJobs) { store.admit(job.request, job.repeat); store.capture(job.request, raw(job.request), job.repeat); store.finalize(job.request, job.repeat); }
    const readerOutcomes = collectLocomoWindowOutcomes(plan.readerJobs, store), judge = makeLocomoWindowJudgePlan(plan, gold, readerOutcomes, rubric);
    for (const job of judge.judgeJobs) { store.admit(job.request, job.repeat); store.capture(job.request, raw(job.request, "CORRECT"), job.repeat); store.finalize(job.request, job.repeat); }
    const payload = { protocol: "oh.locomo-window-result.v1" as const, phase: "judge" as const, planSha256: plan.planSha256, scorerSha256: inputs.scorerPin.sha256,
      readerOutcomes, judgePlanSha256: judge.judgePlanSha256, judgeCases: judge.judgeCases, judgeJobs: judge.judgeJobs,
      judgeOutcomes: collectLocomoWindowOutcomes(judge.judgeJobs, store), halt: "none" as const, ledger: store.summary() };
    result = { ...payload, resultSha256: locomoWindowResultReceipt(payload).resultSha256 };
  } finally { await store.close(); }
  const resultPin = await writePin("result.json", locomoWindowResultReceipt(result!));
  const authenticated = await authenticateLocomoWindowResult({ launchPin, resultPin });
  expect(authenticated.result).toEqual(result!); expect(authenticated.plan.questionIds).toHaveLength(120);
  const changed = { ...result!, judgeOutcomes: result!.judgeOutcomes.map((outcome, index) => index === 0
    ? { ...outcome, response: { ...outcome.response!, answer: "WRONG" } } : outcome) };
  const { resultSha256: _, ...payload } = changed;
  const changedPin = await writePin("changed-result.json", locomoWindowResultReceipt(payload));
  await expect(authenticateLocomoWindowResult({ launchPin, resultPin: changedPin })).rejects.toThrow("native evidence");
  expect(await readFile(resultPin.path, "utf8")).not.toContain("CORRECT");
});
