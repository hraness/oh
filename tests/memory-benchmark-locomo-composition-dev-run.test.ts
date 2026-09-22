import { afterEach, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import type { EvolutionCampaign, EvolutionPin } from "../scripts/benchmarks/evolution-budget";
import { loadLocomoJudgeProfile } from "../scripts/benchmarks/evolution-locomo-judge";
import type { EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore, type EvolutionRaw } from "../scripts/benchmarks/evolution-store";
import { collectLocomoWindowOutcomes } from "../scripts/benchmarks/locomo-window-study-run";
import { LOCOMO_COMPOSITION_DEV_ARMS, LOCOMO_COMPOSITION_DEV_POPULATION_COUNTS, locomoCompositionDevResultReceipt, makeLocomoCompositionDevJudgePlan,
  makeLocomoCompositionDevPlan, parseLocomoCompositionDevScorer, selectLocomoCompositionDevIds,
  type LocomoCompositionDevPlanInput, type LocomoCompositionDevResult, type LocomoCompositionDevSource } from "../scripts/benchmarks/locomo-composition-dev";
import { LOCOMO_COMPOSITION_DEV_CODE_FILES, authenticateLocomoCompositionDevResult, executeLocomoCompositionDevJobs,
  parseLocomoCompositionDevLaunch, prepareLocomoCompositionDevAttempt, runLocomoCompositionDevStudy,
  type LocomoCompositionDevLaunch } from "../scripts/benchmarks/locomo-composition-dev-run";

const ROOT = resolve(import.meta.dir, "..");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await realpath(await mkdtemp(join(tmpdir(), "oh-composition-dev-"))); roots.push(path); return path; }
const pin = (name: string): EvolutionPin => ({ path: `/fixture/${name}`, sha256: sha256Hex(name) });
function campaign(storeDirectory = "/fixture/store"): EvolutionCampaign {
  return { protocol: "oh.memory.evolution-campaign.v1", campaignId: "locomo-composition-dev-fixture", storeDirectory,
    approval: "Offline fixture only", additionalBudgetMicros: 8_000_000, maximumCalls: 1920,
    historicalExposureMicros: 0, historicalLedgers: [{ ...pin("history"), bytes: 0 }], authAuthority: pin("authority") };
}
function source(): LocomoCompositionDevSource {
  const population = Object.entries(LOCOMO_COMPOSITION_DEV_POPULATION_COUNTS).flatMap(([groupId, count]) =>
    Array.from({ length: count }, (_, index) => ({ questionId: `${groupId}:${index}`, groupId })));
  const groups = new Map(population.map(row => [row.questionId, row.groupId]));
  return { protocol: "oh.locomo-composition-dev-source.v1", datasetSha256: sha256Hex("fixture dataset"),
    captureSha256: sha256Hex("fixture capture"), selectionPolicySha256: sha256Hex("fixture policy"), population,
    questions: selectLocomoCompositionDevIds(population).map(id => ({ id, groupId: groups.get(id)!, question: `Fact for ${id}?`, questionDate: "2023-05-01",
      contexts: LOCOMO_COMPOSITION_DEV_ARMS.map(armId => { const text = `Private context ${id}`;
        return { armId, text, contextSha256: sha256Hex(text), turnIds: ["D1:1"] }; }) })) };
}
function input(value = source(), storeDirectory?: string): LocomoCompositionDevPlanInput {
  return { source: value, sourcePin: pin("source"), scorerPin: pin("scorer"), campaignPin: pin("campaign"), campaign: campaign(storeDirectory) };
}
function launch(inputs: LocomoCompositionDevPlanInput): LocomoCompositionDevLaunch {
  return parseLocomoCompositionDevLaunch({ protocol: "oh.locomo-composition-dev-launch.v1", sourcePin: inputs.sourcePin, scorerPin: inputs.scorerPin,
    planPin: pin("plan"), campaignPin: inputs.campaignPin, codePins: LOCOMO_COMPOSITION_DEV_CODE_FILES.map(path => ({ path: join(ROOT, path), sha256: sha256Hex(path) })),
    checkpoint: "0".repeat(40), reviewer: "independent-fixture-review", approved: true, scope: "reader-judge",
    maximumNewSpendMicros: 8_000_000, maximumPhysicalCalls: 1920, canaryQuestionCount: 2 });
}
function raw(request: EvolutionRequest, answer = "synthetic answer", finish = "stop"): EvolutionRaw {
  const body = Buffer.from(JSON.stringify({ model: request.model,
    choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 100, completion_tokens: 4, total_tokens: 104 }, providerMetadata: { gateway: { routing: {
      finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model, resolvedProviderApiModelId: "gpt-4o-mini" } } } }));
  return { httpStatus: 200, body, complete: true, receivedBytes: body.length, error: null, serviceMs: 10 };
}
async function files(path: string) {
  return async (name: string, value: unknown): Promise<EvolutionPin> => {
    const bytes = typeof value === "string" ? value : canonicalJson(value) + "\n", file = join(path, name);
    await writeFile(file, bytes, { mode: 0o600, flag: "wx" }); return { path: file, sha256: sha256Hex(bytes) };
  };
}
async function pinnedCode() { return Promise.all(LOCOMO_COMPOSITION_DEV_CODE_FILES.map(async name => {
  const path = join(ROOT, name); return { path, sha256: sha256Hex(await readFile(path)) };
})); }

test("launch closes new budget, code inventory, role aliases and protocol without widening historical contracts", () => {
  const original = launch(input()); expect(original.codePins).toHaveLength(LOCOMO_COMPOSITION_DEV_CODE_FILES.length);
  for (const bad of [ { maximumNewSpendMicros: 8_000_001 }, { maximumPhysicalCalls: 1921 },
    { codePins: original.codePins.slice(1) }, { codePins: [...original.codePins].reverse() },
    { scorerPin: original.sourcePin }, { protocol: "oh.locomo-window-launch.v1" }, { canaryQuestionCount: 1 } ]) {
    expect(() => parseLocomoCompositionDevLaunch({ ...original, ...bad })).toThrow();
  }
});

test("four-wide queue covers 960 jobs and drains owned work before an ambiguous call stops admission", async () => {
  const jobs = makeLocomoCompositionDevPlan(input()).readerJobs; expect(jobs).toHaveLength(960);
  let count = 0; expect(await executeLocomoCompositionDevJobs(jobs, async () => { count++; return { status: "truncated" }; })).toBeTrue(); expect(count).toBe(960);
  const called: string[] = [], drained: string[] = []; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const work = executeLocomoCompositionDevJobs(jobs.slice(0, 12), async (job, stopped) => {
    called.push(job.key); if (job === jobs[0]) throw Error("ambiguous first response");
    await pending; expect(stopped()).toBeTrue(); drained.push(job.key);
  });
  await Promise.resolve(); release(); expect(await work).toBeFalse(); expect(called).toHaveLength(4); expect(drained).toHaveLength(3);
  expect(await executeLocomoCompositionDevJobs(jobs, async () => { throw Error("must not run"); }, () => true)).toBeFalse();
  await expect(executeLocomoCompositionDevJobs([...jobs, jobs[0]!], async () => {})).rejects.toThrow("job bound");
});

test("resume preserves phase/source identity, handles identity-only crashes and bounds attempts", async () => {
  const path = await directory(), inputs = input(source(), path), plan = makeLocomoCompositionDevPlan(inputs), approved = launch(inputs);
  const parameters = { storeDirectory: path, launchPin: pin("launch"), launch: approved, plan, phase: "reader" as const };
  const first = await prepareLocomoCompositionDevAttempt({ ...parameters, mode: "new" });
  await rm(`${first.prefix}.started.json`);
  const resumed = await prepareLocomoCompositionDevAttempt({ ...parameters, mode: "resume" }); expect(resumed.attempt).toBe(0);
  const originalBytes = await readFile(`${resumed.prefix}.started.json`);
  for (let index = 1; index < 8; index++) expect((await prepareLocomoCompositionDevAttempt({ ...parameters, mode: "resume" })).attempt).toBe(index);
  expect(await readFile(`${resumed.prefix}.started.json`)).toEqual(originalBytes);
  expect((await lstat(`${resumed.prefix}.started.json`)).mode & 0o777).toBe(0o600);
  await expect(prepareLocomoCompositionDevAttempt({ ...parameters, mode: "resume" })).rejects.toThrow("sequence or limit");
  await expect(prepareLocomoCompositionDevAttempt({ ...parameters, mode: "resume", launchPin: pin("changed") })).rejects.toThrow("identity");
  await expect(prepareLocomoCompositionDevAttempt({ ...parameters, mode: "new", phase: "judge" })).rejects.toThrow("reader receipt");
});

test("native recovery retains unknown reservations and exposes every unattempted cell without retry", async () => {
  const path = await directory(), inputs = input(source(), path), jobs = makeLocomoCompositionDevPlan(inputs).readerJobs.slice(0, 4);
  let store = await openEvolutionStore({ directory: path, campaign: inputs.campaign });
  for (const job of jobs.slice(0, 2)) { store.admit(job.request, job.repeat); store.capture(job.request, raw(job.request), job.repeat); }
  const occupied = jobs[2]!; store.admit(occupied.request, occupied.repeat); await store.close();
  store = await openEvolutionStore({ directory: path, campaign: inputs.campaign });
  try {
    expect(collectLocomoWindowOutcomes(jobs, store).map(row => row.disposition)).toEqual(["completed", "completed", "unresolved", "unattempted"]);
    expect(store.summary().calls).toBe(3); expect(store.summary().unresolvedMicros).toBe(occupied.request.reservationMicros);
    expect(() => store.admit(occupied.request, occupied.repeat)).toThrow("cannot be retried");
  } finally { await store.close(); }
});

test("reader launch hashes but never decodes gold and rejects code drift before opening any native store", async () => {
  const path = await directory(), write = await files(path), value = source();
  const authority = await write("auth.json", { schema: "oh.gateway-v3-authority.v1", project: "oh", scope: "hraness", environment: "development" });
  const history = await write("history.jsonl", ""), budget = { ...campaign(join(path, "store")), authAuthority: authority, historicalLedgers: [{ ...history, bytes: 0 }] };
  const inputs = { source: value, sourcePin: await write("source.json", value), scorerPin: await write("scorer.json", "NOT PARSEABLE GOLD JSON"),
    campaignPin: await write("campaign.json", budget), campaign: budget };
  const plan = makeLocomoCompositionDevPlan(inputs), approved = { ...launch(inputs), planPin: await write("plan.json", plan), codePins: await pinnedCode() };
  const launchPin = await write("launch.json", approved);
  await expect(runLocomoCompositionDevStudy({ launchPin, token: "", mode: "new", phase: "reader" })).rejects.toThrow("clean checkpoint");
  await expect(lstat(budget.storeDirectory)).rejects.toThrow();
  const changedPin = await write("changed-launch.json", { ...approved, codePins: approved.codePins.map((pin, index) => index === 0 ? { ...pin, sha256: "0".repeat(64) } : pin) });
  await expect(runLocomoCompositionDevStudy({ launchPin: changedPin, token: "", mode: "new", phase: "reader" })).rejects.toThrow("pinned content changed");
  await expect(lstat(budget.storeDirectory)).rejects.toThrow();
});

test("native report authentication rebuilds both prompt arms, global judge dedup and compact hashes", async () => {
  const path = await directory(), write = await files(path), value = source();
  const gold = parseLocomoCompositionDevScorer({ protocol: "oh.locomo-composition-dev-scorer.v1", datasetSha256: value.datasetSha256,
    sourceSha256: canonicalSha256(value), questions: value.questions.map(q => ({ id: q.id, corpusId: q.groupId, category: "locomo:1",
      question: q.question, answer: "GOLD_ONLY", unanswerable: false })) }, value);
  const authority = await write("auth.json", { schema: "oh.gateway-v3-authority.v1", project: "oh", scope: "hraness", environment: "development" });
  const history = await write("history.jsonl", ""), budget = { ...campaign(join(path, "store")), authAuthority: authority, historicalLedgers: [{ ...history, bytes: 0 }] };
  const inputs = { source: value, sourcePin: await write("source.json", value), scorerPin: await write("scorer.json", gold),
    campaignPin: await write("campaign.json", budget), campaign: budget };
  const plan = makeLocomoCompositionDevPlan(inputs), approved = { ...launch(inputs), planPin: await write("plan.json", plan), codePins: await pinnedCode() };
  expect(plan.cases).toHaveLength(960); expect(plan.readerJobs).toHaveLength(960);
  const launchPin = await write("launch.json", approved), rubric = await loadLocomoJudgeProfile();
  const store = await openEvolutionStore({ directory: budget.storeDirectory, campaign: budget });
  let result!: LocomoCompositionDevResult;
  try {
    for (const job of plan.readerJobs) { store.admit(job.request, job.repeat); store.capture(job.request, raw(job.request), job.repeat); store.finalize(job.request, job.repeat); }
    const readerOutcomes = collectLocomoWindowOutcomes(plan.readerJobs, store), judge = makeLocomoCompositionDevJudgePlan(plan, gold, readerOutcomes, rubric);
    expect(judge.judgeCases).toHaveLength(960); expect(judge.judgeJobs).toHaveLength(160); expect(judge.judgeJobs.every(job => job.repeat === 0)).toBeTrue();
    for (const job of judge.judgeJobs) { store.admit(job.request, job.repeat); store.capture(job.request, raw(job.request, "CORRECT"), job.repeat); store.finalize(job.request, job.repeat); }
    const payload = { protocol: "oh.locomo-composition-dev-result.v1" as const, phase: "judge" as const, planSha256: plan.planSha256,
      scorerSha256: inputs.scorerPin.sha256, readerOutcomes, judgePlanSha256: judge.judgePlanSha256, judgeCases: judge.judgeCases,
      judgeJobs: judge.judgeJobs, judgeOutcomes: collectLocomoWindowOutcomes(judge.judgeJobs, store), halt: "none" as const, ledger: store.summary() };
    result = { ...payload, resultSha256: locomoCompositionDevResultReceipt(payload).resultSha256 };
  } finally { await store.close(); }
  const resultPin = await write("result.json", locomoCompositionDevResultReceipt(result));
  expect((await authenticateLocomoCompositionDevResult({ launchPin, resultPin })).result).toEqual(result);
  expect(await readFile(resultPin.path, "utf8")).not.toContain("CORRECT"); expect(await readFile(resultPin.path, "utf8")).not.toContain("GOLD_ONLY");
  const { resultSha256: _, ...payload } = result;
  const changed = { ...payload, judgeOutcomes: result.judgeOutcomes.map((row, index) => index === 0 ? { ...row, response: { ...row.response!, answer: "WRONG" } } : row) };
  const alteredPin = await write("altered.json", locomoCompositionDevResultReceipt(changed));
  await expect(authenticateLocomoCompositionDevResult({ launchPin, resultPin: alteredPin })).rejects.toThrow("native evidence");
  await expect(lstat(join(budget.storeDirectory, "active.lock"))).rejects.toThrow();
}, 20_000);
