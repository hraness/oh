import { afterEach, describe, expect, test } from "bun:test";
import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { makeCloneMemChoiceMessages, selectCloneMemReaderQuestions } from "../scripts/benchmarks/clonemem-dataset";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";
import { EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID, EVOLUTION_PROFILES, makeEvolutionRequest,
  type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore, type EvolutionRaw } from "../scripts/benchmarks/evolution-store";
import { collectPairedMemoryResult, executePairedMemoryBatches, makePairedMemoryPlan, pairedMemoryPublicSummary,
  parsePairedMemorySource, partitionPairedMemoryCanary, PAIRED_MEMORY_LIMITS, reconcilePairedMemoryStore, selectPairedMemoryIds,
  validatePairedMemoryResult, verifyPairedMemoryPlan, type PairedMemoryPlanInput, type PairedMemorySource } from "../scripts/benchmarks/paired-memory-study";
import { parsePairedMemoryLaunch, preparePairedMemoryAttempt } from "../scripts/benchmarks/paired-memory-study-run";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await realpath(await mkdtemp(join(tmpdir(), "oh-paired-memory-"))); roots.push(path); return path; }
const pin = (name: string) => ({ path: `/fixture/${name}`, sha256: sha256Hex(name) });
function campaign(storeDirectory = "/fixture/store"): EvolutionCampaign {
  return { protocol: "oh.memory.evolution-campaign.v1", campaignId: "paired-fixture", storeDirectory,
    approval: "Offline test fixture; no provider calls", additionalBudgetMicros: 20_000_000, maximumCalls: 1800,
    historicalExposureMicros: 0, historicalLedgers: [{ ...pin("history"), bytes: 0 }], authAuthority: pin("auth") };
}
function source(count = 3, identicalArms = false): PairedMemorySource {
  const population = Array.from({ length: Math.max(count, 12) }, (_, index) => ({ questionId: `p${index % 3}:q${index}`, groupId: `p${index % 3}` }));
  const selected = selectPairedMemoryIds(population, 17, count);
  return { protocol: "oh.memory.paired-source.v1", datasetRevision: "753d8a97fd78f4ee25af398a0f0c8d981a6be304",
    selection: { algorithm: "clonemem-balanced-sha256-v1", seed: 17, population, count }, arms: ["vector", "oh-hybrid"],
    questions: selected.map(id => ({ id, groupId: population.find(row => row.questionId === id)!.groupId,
      question: `Which event happened for ${id}?`, questionDate: "", personName: "Fixture Person",
      choices: [{ id: "A", text: "First" }, { id: "B", text: "Second" }],
      contexts: [{ armId: "vector", text: `PRIVATE memory ${id}: first trace.` },
        { armId: "oh-hybrid", text: `PRIVATE memory ${id}: ${identicalArms ? "first" : "second"} trace.` }] })) };
}
function input(value = source(), storeDirectory?: string): PairedMemoryPlanInput {
  return { source: value, sourcePin: pin("source"), promptPin: pin("prompt"), scorerPin: pin("scorer"),
    campaignPin: pin("campaign"), campaign: campaign(storeDirectory), readerProfile: EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID,
    renderMessages: (question, context) => makeCloneMemChoiceMessages({ ...question, id: "unused", localId: "unused", personId: "unused" }, context) };
}
function raw(request: EvolutionRequest, finishReason = "stop"): EvolutionRaw {
  const body = Buffer.from(JSON.stringify({ model: request.model,
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content: "A" } }],
    usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 },
    providerMetadata: { gateway: { routing: { finalProvider: request.provider, originalModelId: request.model,
      canonicalSlug: request.model, resolvedProviderApiModelId: "gpt-4o-mini" } } } }));
  return { httpStatus: 200, complete: true, receivedBytes: body.length, body, error: null, serviceMs: 12 };
}

describe("bounded paired memory reader study", () => {
  test("uses a distinct official-choice profile without changing legacy settings or message shape", () => {
    const request = makeEvolutionRequest(EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID, [{ role: "user", content: "Choose A or B." }]);
    expect(request.body).toMatchObject({ model: "openai/gpt-4o-mini", temperature: 0.1, max_tokens: 512, stream: false, store: false });
    expect(request.profileSha256).toBe(canonicalSha256(EVOLUTION_PROFILES[EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID]));
    expect(EVOLUTION_PROFILES["gpt4o-mini-reader"]).toMatchObject({ maxOutputTokens: 2048, settings: { temperature: 0 } });
    expect(() => makeEvolutionRequest("gpt4o-mini-reader", [{ role: "user", content: "Choose A or B." }])).toThrow("prompt shape");
    expect(() => makeEvolutionRequest(EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID,
      [{ role: "system", content: "Choose" }, { role: "user", content: "A or B" }])).toThrow("prompt shape");
  });

  test("exactly reproduces the predeclared native persona-balanced sample, including nested 100/300 draws", () => {
    const value = source(300), native = value.selection.population.map(row => ({ id: row.questionId, localId: row.questionId,
      personId: row.groupId, question: "fixture", questionDate: "", personName: "fixture", choices: [] }));
    const selected = selectPairedMemoryIds(value.selection.population, 17, 300);
    expect(selected).toEqual(selectCloneMemReaderQuestions(native, 300, 17).map(row => row.id));
    expect(selectPairedMemoryIds([...value.selection.population].reverse(), 17, 100)).toEqual(selected.slice(0, 100));
    expect(new Set(value.questions.slice(0, 3).map(row => row.groupId)).size).toBe(3);
    expect(() => selectPairedMemoryIds([...value.selection.population, value.selection.population[0]!], 17, 100)).toThrow();
  });

  test("rejects gold fields, changed eligibility/order/groups, oversized raw context and altered choices", () => {
    const original = source();
    const mutate = (change: (value: any) => void) => { const value = structuredClone(original); change(value); expect(() => parsePairedMemorySource(value)).toThrow(); };
    mutate(value => { value.questions[0].correctChoiceId = "A"; });
    mutate(value => { value.questions[0].evidence = ["trace-1"]; });
    mutate(value => { value.questions.reverse(); });
    mutate(value => { value.questions[0].groupId = "another"; });
    mutate(value => { value.questions[0].choices[0].correct = true; });
    mutate(value => { value.questions[0].choices[1].id = "a"; });
    mutate(value => { value.questions[0].contexts[0].text = "é".repeat(PAIRED_MEMORY_LIMITS.contextBytes / 2 + 1); });
    mutate(value => { value.questions[0].contexts.reverse(); });
    expect(Object.isFrozen(parsePairedMemorySource(original).questions[0]!.choices)).toBeTrue();
  });

  test("freezes exact physical/logical coverage and cost with identical-context reuse explicitly counted", () => {
    const inputs = input(), plan = makePairedMemoryPlan(inputs);
    expect(plan.cases).toHaveLength(18); expect(plan.jobs).toHaveLength(18);
    expect(plan.maximumReservationMicros).toBe(plan.jobs.reduce((sum, job) => sum + job.request.reservationMicros, 0));
    expect(plan.additionalJudgeReservationMicros).toBe(0);
    expect(new Set(plan.jobs.map(job => job.repeat))).toEqual(new Set([0, 1, 2]));
    expect(makePairedMemoryPlan(input(source(3, true))).jobs).toHaveLength(9);
    expect(verifyPairedMemoryPlan(structuredClone(plan), inputs)).toEqual(plan);
    for (const change of [
      (value: any) => { value.cases.pop(); }, (value: any) => { value.jobs[0].repeat = 4; },
      (value: any) => { value.jobs[0].request.body.messages[0].content += " changed"; },
      (value: any) => { value.maximumReservationMicros--; }, (value: any) => { value.scorerPin.sha256 = "f".repeat(64); },
    ]) { const altered = structuredClone(plan); change(altered); expect(() => verifyPairedMemoryPlan(altered, inputs)).toThrow("reconstruct"); }
    expect(() => makePairedMemoryPlan({ ...inputs, campaign: { ...inputs.campaign, additionalBudgetMicros: plan.maximumReservationMicros - 1 } })).toThrow("complete-plan");
    expect(() => makePairedMemoryPlan({ ...inputs, campaign: { ...inputs.campaign, additionalBudgetMicros: 20_000_001 } })).toThrow("study cap");
    expect(() => makePairedMemoryPlan({ ...inputs, campaign: { ...inputs.campaign, maximumCalls: 17 } })).toThrow("call cap");
  });

  test("canary is the same first two questions, all arms/repeats, and never enters the remainder again", async () => {
    const plan = makePairedMemoryPlan(input(source(4))), split = partitionPairedMemoryCanary(plan), called: string[] = [];
    expect(split.canary).toHaveLength(12); expect(split.remainder).toHaveLength(12);
    const invoke = async (job: typeof plan.jobs[number]) => { called.push(job.key); return { status: "completed" as const }; };
    expect(await executePairedMemoryBatches(split.canary, invoke)).toBeTrue();
    expect(await executePairedMemoryBatches(split.remainder, invoke)).toBeTrue();
    expect(called).toEqual(plan.jobs.map(job => job.key)); expect(new Set(called).size).toBe(24);
  });

  test("unverifiable first response halts new admissions and drains the bounded in-flight batch without retry", async () => {
    const plan = makePairedMemoryPlan(input(source(4))), calls: string[] = [], captured: string[] = [];
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const work = executePairedMemoryBatches(plan.jobs, async (job, stopped) => {
      calls.push(job.key);
      if (job === plan.jobs[0]) throw new Error("unknown first response");
      await pending; expect(stopped()).toBeTrue(); captured.push(job.key); return { status: "completed" };
    });
    await Promise.resolve(); release();
    expect(await work).toBeFalse(); expect(calls).toHaveLength(4); expect(captured).toHaveLength(3);
    expect(new Set(calls).size).toBe(4);
    const truncated: string[] = [];
    expect(await executePairedMemoryBatches(plan.jobs, async job => { truncated.push(job.key); return { status: "truncated" }; })).toBeFalse();
    expect(truncated).toHaveLength(4);
  });

  test("ledger custody yields exact failure-inclusive denominators and a content-free public allowlist", async () => {
    const path = await directory(), inputs = input(source(3), path), plan = makePairedMemoryPlan(inputs);
    const store = await openEvolutionStore({ directory: path, campaign: inputs.campaign });
    try {
      const complete = plan.jobs[0]!, unknown = plan.jobs[1]!, truncated = plan.jobs[2]!;
      store.admit(complete.request, complete.repeat); store.capture(complete.request, raw(complete.request), complete.repeat); store.finalize(complete.request, complete.repeat);
      store.admit(unknown.request, unknown.repeat);
      store.admit(truncated.request, truncated.repeat); store.capture(truncated.request, raw(truncated.request, "length"), truncated.repeat); store.finalize(truncated.request, truncated.repeat);
      const result = collectPairedMemoryResult(plan, store, "reader-failure");
      validatePairedMemoryResult(plan, result);
      const scores = plan.cases.map(cell => ({ questionId: cell.questionId, armId: cell.armId, repeat: cell.repeat, score: (cell.jobKey === complete.key ? 1 : 0) as 0 | 1 }));
      const summary = pairedMemoryPublicSummary(plan, result);
      expect(summary.logicalCases).toBe(18); expect(summary.ledger.calls).toBe(3);
      expect(summary.matrixComplete).toBeFalse(); expect(summary.allResponsesCompleted).toBeFalse();
      expect(summary.arms.reduce((sum, arm) => sum + arm.cases, 0)).toBe(18);
      expect(summary.arms.every(arm => arm.correct === null)).toBeTrue();
      expect(summary.arms.reduce((sum, arm) => sum + arm.unattempted, 0)).toBe(15);
      expect(summary.ledger.unresolvedMicros).toBe(unknown.request.reservationMicros);
      const encoded = JSON.stringify(summary);
      for (const secret of ["PRIVATE", "Fixture Person", "questionId", "contexts", "answerSha256", "/fixture/"]) expect(encoded).not.toContain(secret);
      expect(() => pairedMemoryPublicSummary(plan, result, scores.slice(1))).toThrow("denominator");
      expect(() => pairedMemoryPublicSummary(plan, result, scores)).toThrow("complete matrix");
      expect(() => validatePairedMemoryResult(plan, { ...result, outcomes: result.outcomes.slice(1) })).toThrow("coverage");
      const extra = makeEvolutionRequest(EVOLUTION_CLONEMEM_CHOICE_READER_PROFILE_ID, [{ role: "user", content: "Unexplained request" }]);
      store.admit(extra);
      expect(() => pairedMemoryPublicSummary(plan, collectPairedMemoryResult(plan, store, "reader-failure"))).toThrow("unexplained physical");
    } finally { await store.close(); }
  });

  test("explicit recovery settles a captured prefix and issues only never-reserved jobs with unchanged repeats", async () => {
    const path = await directory(), inputs = input(source(3), path), plan = makePairedMemoryPlan(inputs);
    const first = await openEvolutionStore({ directory: path, campaign: inputs.campaign });
    const originalRaw = new Map<string, string>();
    for (const job of plan.jobs.slice(0, 4)) {
      first.admit(job.request, job.repeat); first.capture(job.request, raw(job.request), job.repeat);
      originalRaw.set(job.key, sha256Hex(first.readRaw(job.request, job.repeat)));
      if (job !== plan.jobs[3]) first.finalize(job.request, job.repeat);
    }
    await first.close();
    const resumed = await openEvolutionStore({ directory: path, campaign: inputs.campaign }), calls: string[] = [];
    try {
      const state = reconcilePairedMemoryStore(plan, resumed);
      expect(state.blocked).toBeFalse(); expect(state.unissued).toHaveLength(14);
      expect(state.result.ledger.calls).toBe(4); expect(state.result.ledger.unresolvedMicros).toBe(0);
      expect(await executePairedMemoryBatches(state.unissued, async job => {
        calls.push(job.key); resumed.admit(job.request, job.repeat); resumed.capture(job.request, raw(job.request), job.repeat);
        return resumed.finalize(job.request, job.repeat);
      })).toBeTrue();
      expect(calls).toEqual(plan.jobs.slice(4).map(job => job.key));
      for (const job of plan.jobs.slice(0, 4)) expect(sha256Hex(resumed.readRaw(job.request, job.repeat))).toBe(originalRaw.get(job.key));
      const summary = pairedMemoryPublicSummary(plan, collectPairedMemoryResult(plan, resumed, "none"));
      expect(summary.ledger.calls).toBe(18); expect(summary.matrixComplete).toBeTrue(); expect(summary.allResponsesCompleted).toBeTrue();
    } finally { await resumed.close(); }
  });

  test("reserved or unverifiable captured prefixes block recovery without another provider attempt", async () => {
    for (const captured of [false, true]) {
      const path = await directory(), inputs = input(source(3), path), plan = makePairedMemoryPlan(inputs);
      const store = await openEvolutionStore({ directory: path, campaign: inputs.campaign });
      try {
        const job = plan.jobs[0]!; store.admit(job.request, job.repeat);
        if (captured) store.capture(job.request, { httpStatus: null, body: new Uint8Array(), complete: false,
          receivedBytes: 0, error: "network" }, job.repeat);
        const before = store.summary(), state = reconcilePairedMemoryStore(plan, store);
        expect(state.blocked).toBeTrue(); expect(store.summary()).toEqual(before);
        expect(state.result.outcomes[0]!.disposition).toBe("unresolved");
        expect(state.unissued.some(candidate => candidate.key === job.key)).toBeFalse();
        expect(store.summary().calls).toBe(1);
      } finally { await store.close(); }
    }
  });

  test("known settled reader failures outside the canary remain scored zero and are never reissued", async () => {
    const path = await directory(), inputs = input(source(3), path), plan = makePairedMemoryPlan(inputs);
    const store = await openEvolutionStore({ directory: path, campaign: inputs.campaign });
    try {
      for (const job of plan.jobs.slice(0, 13)) {
        store.admit(job.request, job.repeat); store.capture(job.request, raw(job.request, job === plan.jobs[12] ? "length" : "stop"), job.repeat);
        store.finalize(job.request, job.repeat);
      }
      const state = reconcilePairedMemoryStore(plan, store), calls: string[] = [];
      expect(state.blocked).toBeFalse(); expect(state.unissued).toHaveLength(5);
      await executePairedMemoryBatches(state.unissued, async job => {
        calls.push(job.key); store.admit(job.request, job.repeat); store.capture(job.request, raw(job.request), job.repeat);
        return store.finalize(job.request, job.repeat);
      });
      expect(calls).not.toContain(plan.jobs[12]!.key);
      const result = collectPairedMemoryResult(plan, store, "reader-failure");
      const scores = plan.cases.map(cell => ({ questionId: cell.questionId, armId: cell.armId, repeat: cell.repeat,
        score: (cell.jobKey === plan.jobs[12]!.key ? 0 : 1) as 0 | 1 }));
      const summary = pairedMemoryPublicSummary(plan, result, scores);
      expect(summary.matrixComplete).toBeTrue(); expect(summary.allResponsesCompleted).toBeFalse();
      expect(summary.arms.reduce((sum, arm) => sum + arm.correct!, 0)).toBe(17);
      scores[12]!.score = 1;
      expect(() => pairedMemoryPublicSummary(plan, result, scores)).toThrow("failure scored nonzero");
    } finally { await store.close(); }
  });

  test("same-pin resume preserves private receipts, rejects stale identity, and survives the pre-attempt crash edge", async () => {
    const path = await directory(), plan = makePairedMemoryPlan(input(source(3), path)), launchPin = pin("launch");
    const launch = parsePairedMemoryLaunch({ protocol: "oh.memory.paired-launch.v1", planPin: pin("plan"), sourcePin: plan.sourcePin,
      promptPin: plan.promptPin, scorerPin: plan.scorerPin, campaignPin: plan.campaignPin, checkpoint: "a".repeat(40),
      reviewer: "independent-reviewer", approved: true, scope: "reader-only", maximumNewSpendMicros: 20_000_000,
      maximumPhysicalCalls: 1800, canaryQuestionCount: 2 });
    const args = { storeDirectory: path, launchPin, launch, plan };
    const first = await preparePairedMemoryAttempt({ ...args, mode: "new" });
    const identity = await readFile(join(first.directory, "started.json"));
    expect((await lstat(`${first.prefix}.started.json`)).mode & 0o777).toBe(0o600);
    await expect(preparePairedMemoryAttempt({ ...args, mode: "resume", launchPin: pin("changed-launch") })).rejects.toThrow("identity changed");
    await expect(preparePairedMemoryAttempt({ ...args, mode: "resume", launch: { ...launch, checkpoint: "b".repeat(40) } })).rejects.toThrow("identity changed");
    // Simulate interruption after global identity but before any attempt receipt/provider admission.
    await rm(`${first.prefix}.started.json`);
    const recoveredFirst = await preparePairedMemoryAttempt({ ...args, mode: "resume" });
    expect(recoveredFirst.attempt).toBe(0);
    const second = await preparePairedMemoryAttempt({ ...args, mode: "resume" });
    expect(second.attempt).toBe(1);
    expect(await readFile(join(first.directory, "started.json"))).toEqual(identity);
    for (let index = 2; index < 8; index++) expect((await preparePairedMemoryAttempt({ ...args, mode: "resume" })).attempt).toBe(index);
    await expect(preparePairedMemoryAttempt({ ...args, mode: "resume" })).rejects.toThrow("attempt bound");
  });

  test("an external stop closes admission but drains already-started first responses", async () => {
    const plan = makePairedMemoryPlan(input(source(3))), calls: string[] = [], completed: string[] = [];
    let stopped = false, release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const work = executePairedMemoryBatches(plan.jobs, async job => {
      calls.push(job.key); await pending; completed.push(job.key); return { status: "completed" };
    }, () => stopped);
    expect(calls).toHaveLength(4); stopped = true; release();
    expect(await work).toBeFalse(); expect(completed).toEqual(calls); expect(calls).toHaveLength(4);
  });

  test("reviewed launch receipts are exact-role, bounded, reader-only and tied to a clean commit", () => {
    const launch = { protocol: "oh.memory.paired-launch.v1", planPin: pin("plan"), sourcePin: pin("source"), promptPin: pin("prompt"),
      scorerPin: pin("scorer"), campaignPin: pin("campaign"), checkpoint: "a".repeat(40), reviewer: "independent-reviewer",
      approved: true, scope: "reader-only", maximumNewSpendMicros: 20_000_000, maximumPhysicalCalls: 1800, canaryQuestionCount: 2 };
    expect(parsePairedMemoryLaunch(launch)).toEqual(launch);
    for (const change of [{ approved: false }, { checkpoint: "dirty" }, { maximumNewSpendMicros: 25_000_000 },
      { maximumPhysicalCalls: 1801 }, { scope: "reader-and-judge" }, { retry: true }]) {
      expect(() => parsePairedMemoryLaunch({ ...launch, ...change })).toThrow();
    }
  });
});
