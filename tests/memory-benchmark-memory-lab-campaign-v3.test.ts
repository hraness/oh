import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical";
import { CAMPAIGN_V3, sha, parseConfig, planArms, readerInputUpperBound, type CampaignConfig, type Observation, type Plan, type Task } from "../scripts/benchmarks/memory-lab/campaign-contract-v3";
import { advance, createPlan, getRun, initialize, propose, readState, reviewPlan, saveAssessment, sourcePins, transaction } from "../scripts/benchmarks/memory-lab/campaign-store-v3";
import { assessRun, executeRun, recoverAbandonedExecution } from "../scripts/benchmarks/memory-lab/campaign-execute-v3";
import { confirmationAlpha, evaluate, signPValue } from "../scripts/benchmarks/memory-lab/campaign-evaluate-v3";

import { composeOhAuthorLogContextV1 } from "../scripts/benchmarks/oh-author-log-context";
import { projectOhEvidenceTurnsV1 } from "../scripts/benchmarks/oh-evidence-context";
import { verifyContexts } from "../scripts/benchmarks/memory-lab/campaign-context-v3";
import { parseTaskInput } from "../scripts/benchmarks/memory-lab/campaign-contract-v3";
import { prepareApiRequest } from "../scripts/benchmarks/memory-lab/api-transport";
import { evolutionAnswerMessages } from "../scripts/benchmarks/evolution-reader-contracts";

const dirs: string[] = [], oldKey = process.env.VERTEX_API_KEY, oldXai = process.env.XAI_API_KEY;
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (oldKey === undefined) delete process.env.VERTEX_API_KEY; else process.env.VERTEX_API_KEY = oldKey;
  if (oldXai === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = oldXai; });
const now = () => Date.parse("2026-09-30T06:00:00Z");
function setup({ screenCriterion = "cluster-sign" as CampaignConfig["screenCriterion"], maxCalls = 1000, campaignCalls = 1000, expiresAt = "2099-01-01T00:00:00Z", evidenceMode = "offline-synthetic" as CampaignConfig["evidenceMode"] } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "oh-campaign-v3-"))); dirs.push(dir);
  const root = join(dir, "lab"), cache = join(dir, "cache"); mkdirSync(cache, { mode: 0o700 });
  const ref = (name: string, value: unknown) => { const path = join(dir, name), raw = JSON.stringify(value); writeFileSync(path, raw, { mode: 0o600 }); return { path, sha256: sha256Hex(raw) }; };
  const budget = ref("budget.json", { protocol: "oh.memory-lab-api-budget.v1", maxUsd: 25, maxCalls: campaignCalls, expiresAt: "2026-12-31T23:00:00Z", ledgerPath: join(cache, "api.jsonl") });
  const templates = ref("templates.json", { templates: { nugget: "RUBRIC: <rubric_item> RESPONSE: <llm_response>", extraction: "Extract <input_text>" } });
  const tasks: Task[] = [];
  const contextPolicies = [{ id: "reserve24", logReserveBytes: 24000 }, { id: "reserve96", logReserveBytes: 96000 }];
  const rankingProfileSha256 = "a".repeat(64);
  const turns = Array.from({ length: 80 }, (_, i) => ({ id: `turn${i}`, sessionId: "invented", date: "2026-09-29T00:00:00.000Z", speaker: i % 2 ? "assistant" : "user", text: `Evidence ${i}: ` + "invented fact ".repeat(320) }));
  const source = ref("source.json", { protocol: "oh.memory-lab-source.v1", turns });
  const rankings = (["lexical", "vector"] as const).map(kind => ({ source: kind === "lexical" ? "bm25-native" : "oh-vector-native", kind, stage: "native" as const, hits: turns.map((t, i) => ({ turnId: t.id, rank: i + 1 })) }));
  const contexts = contextPolicies.map(policy => { const rendered = composeOhAuthorLogContextV1({ projection: projectOhEvidenceTurnsV1(turns), rankings },
    { asOf: "2026-09-30T00:00:00.000Z", budgetBytes: 180000, retrievedBytes: 96000, logReserveBytes: policy.logReserveBytes, topK: 100, previousTurns: 1, nextTurns: 1, rrfK: 60 });
    return { policyId: policy.id, context: rendered.context, sha256: rendered.contextSha256 }; });
  function add(id: string, cluster: string, pool: Task["pool"], guard = false, expected: 0 | 1 | null = null) {
    const question = `${guard ? "GUARD" : "TARGET"} ${id}?`;
    const ranking = ref(id + ".ranks.json", { protocol: "oh.memory-lab-native-ranks.v1", sourceSha256: source.sha256, querySha256: sha256Hex(question), profileSha256: rankingProfileSha256, rankings });
    const input = ref(id + ".json", { question, questionDate: "2026-09-30T00:00:00.000Z", source: pool === "control" ? null : source, ranking: pool === "control" ? null : ranking,
      contexts: pool === "control" ? contextPolicies.map(policy => ({ policyId: policy.id, context: "Invented control.", sha256: sha256Hex("Invented control.") })) : contexts,
      rubric: guard ? ["SECRET-GOLD-GUARD"] : ["SECRET-GOLD-one", "SECRET-GOLD-two"], controlAnswer: pool === "control" ? expected === 1 ? "RIGHT" : "WRONG" : null });
    tasks.push({ id, cluster, category: guard ? "abstention" : "knowledge_update", pool, exposure: pool === "control" ? "invented-control" : "exposed-development", input, maxJudgeCalls: guard ? 1 : 2, expected });
  }
  for (let i = 0; i < 4; i++) add(`control${i}`, `control${i}`, "control", true, i < 2 ? 1 : 0);
  for (let i = 0; i < 3; i++) { add(`s${i}`, `screen${i}`, "screen"); add(`g${i}`, `guard${i}`, "screen", true); }
  for (let batch = 0; batch < 3; batch++) for (let i = 0; i < 7; i++) {
    add(`c${batch}t${i}`, `c${batch}target${i}`, "confirmation"); add(`c${batch}g${i}`, `c${batch}guard${i}`, "confirmation", true);
  }
  const config: CampaignConfig = { protocol: CAMPAIGN_V3, id: "test", owner: "author", evidenceMode, api: { budgetPath: budget.path,
    reader: { id: "reader", model: "gemini-3.8-flash", keyEnv: "VERTEX_API_KEY", maximumOutput: 4096 },
    judge: { id: "judge", model: "grok-4.7", keyEnv: "XAI_API_KEY", maximumOutput: 2048 } }, budget, templates, tasks,
    maxPlans: 30, maxProposals: 32, maxConfirmationAttempts: 3, maxCalls, expiresAt, minimumEffect: 0.03, guardMargin: 0.03,
    screenAlpha: 0.125, aaMaximumMeanAbsoluteDelta: 0.02, sourcePins: sourcePins(), screenCriterion, contextPolicies, rankingProfileSha256, maximumAnswerJsonBytes: 4096 };
  initialize(root, config, { id: "baseline", instruction: "LEVEL0", contextPolicyId: "reserve24" });
  process.env.VERTEX_API_KEY = "synthetic-key"; process.env.XAI_API_KEY = "synthetic-xai";
  return { root, config, dir, ref, ledger: join(cache, "api.jsonl") };
}
function spec(id: string, kind: Plan["kind"], candidateId: string | null = null, parentScreen: string | null = null, batch = 0) {
  const targetIds = kind === "controls" ? [0, 1, 2, 3].map(i => `control${i}`) : kind === "confirmation" ? Array.from({ length: 7 }, (_, i) => `c${batch}t${i}`) : ["s0", "s1", "s2"];
  const guardIds = kind === "controls" ? [] : kind === "confirmation" ? Array.from({ length: 7 }, (_, i) => `c${batch}g${i}`) : ["g0", "g1", "g2"];
  return { id, kind, candidateId, parentScreen, targetIds, guardIds, maxCalls: kind === "controls" ? 4 : kind === "confirmation" ? 105 : 30,
    repeats: 1, sampleSizeRationale: "Invented machinery test only: seven independent clusters can reach both alpha spending thresholds; no empirical power claim." };
}
function reviewed(root: string, value: ReturnType<typeof spec>) {
  const run = createPlan(root, value); reviewPlan(root, run.plan.id, { reviewer: "independent-reviewer", planSha256: run.planSha256, approved: true, notes: "Independent synthetic fixture review." }); return run.plan;
}
function proposal(root: string, id: string, mechanism = id) {
  const s = readState(root); return propose(root, { treatment: { id, instruction: id.toUpperCase(), contextPolicyId: "reserve96" }, parentRevision: s.champion.revision, parentKey: s.champion.treatment.semanticKey,
    author: "author", mechanism, hypothesis: "A distinct reusable mechanism changes the selected behavior.", evidence: ["invented fixture"], disconfirmingTest: "No paired gain or quality regression rejects it.", strategy: "explore" });
}
function observations(plan: Plan, gain = 0): Observation[] { return plan.tasks.flatMap(t => Array.from({ length: plan.repeats }, (_, repeat) =>
  planArms(plan).map(arm => ({ taskId: t.id, arm, repeat, status: "scored" as const, score: plan.kind === "controls" ? t.expected : 0.4 + (arm === "candidate" && plan.targetIds.includes(t.id) ? gain : 0), reason: null }))).flat()); }

function qualify(root: string) { for (const kind of ["controls", "aa"] as const) { const p = reviewed(root, spec(kind, kind)); saveAssessment(root, p.id, observations(p)); advance(root, p.id); } }
function mockProvider(calls: string[] = [], badJudge = false): typeof fetch {
  return Object.assign(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init!.body)); const gemini = String(url).includes("googleapis"); calls.push(gemini ? "reader" : "judge");
    if (gemini) {
      const question = body.contents[0].parts[0].text as string; expect(question).not.toContain("SECRET-GOLD");
      const answer = question.includes("GUARD") ? "GUARD-OK" : body.systemInstruction.parts[0].text;
      return Response.json({ modelVersion: "gemini-3.8-flash", candidates: [{ finishReason: "STOP", content: { parts: [{ text: answer }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5, thoughtsTokenCount: 0, totalTokenCount: 25 } });
    }
    const prompt = body.input.at(-1).content[0].text as string;
    const score = prompt.includes("GUARD-OK") || prompt.includes("RIGHT") || prompt.includes("LEVEL2") || (prompt.includes("LEVEL1") && prompt.includes("SECRET-GOLD-one")) ? 1 : 0;
    return Response.json({ model: "grok-4.7", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: badJudge ? "invalid judgment" : JSON.stringify({ score }) }] }],
      usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25, output_tokens_details: { reasoning_tokens: 0 }, num_server_side_tools_used: 0, num_sources_used: 0 } });
  }, { preconnect: fetch.preconnect });
}

test("pure evaluator retains planned failures, exact thresholds and cluster denominator", () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1"); const p = reviewed(s.root, spec("screen1", "screen", "level1"));
  expect(evaluate(p, observations(p, 0.03), 0.02).status).toBe("PASS");
  expect(evaluate(p, observations(p, 0.0299999), 0.02).status).toBe("REJECT");
  expect(evaluate(p, observations(p, -0.2), 0.02).status).toBe("REJECT");
  expect(evaluate(p, observations(p, 0.2).slice(1), 0.02)).toMatchObject({ status: "INCOMPLETE", planned: 12, complete: 11 });
  const invalid = observations(p, 0.2); invalid[0]!.score = Number.NaN;
  expect(evaluate(p, invalid, 0.02).status).toBe("INCOMPLETE");
  expect(() => evaluate(p, [...observations(p), observations(p)[0]!], 0.02)).toThrow("duplicate");
  expect(signPValue([1, 1, 1]).pValue).toBe(0.125); expect(signPValue([1, -1, 1]).pValue).toBe(0.5);
  expect(signPValue([0, 0]).pValue).toBe(1); expect(confirmationAlpha(2)).toBe(0.0125);
});

test("actual identical-treatment A/A fails if it would pass a screen, and gates candidates", () => {
  const s = setup(); proposal(s.root, "level1"); expect(() => createPlan(s.root, spec("early", "screen", "level1"))).toThrow("latest grader controls must pass and advance");
  const control = reviewed(s.root, spec("controls", "controls")); saveAssessment(s.root, control.id, observations(control)); advance(s.root, control.id);
  const aa = reviewed(s.root, spec("aa", "aa")); const result = saveAssessment(s.root, aa.id, observations(aa, 0.05));
  expect(result).toMatchObject({ status: "REJECT", wouldPass: true }); advance(s.root, aa.id);
  expect(readState(s.root).qualifications.aa).toBeNull(); expect(() => createPlan(s.root, spec("blocked", "screen", "level1"))).toThrow("A/A");
  expect(() => evaluate({ ...aa, candidate: { ...aa.candidate, instruction: "different" } }, observations(aa), 0.02)).toThrow("identical");
});

test("queued research is wider than the active three-mechanism beam; stale lineage and self review fail", () => {
  const s = setup(); qualify(s.root); for (let i = 0; i < 5; i++) proposal(s.root, `candidate${i}`);
  expect(readState(s.root).candidates.filter(c => c.status === "queued")).toHaveLength(5);
  for (let i = 0; i < 3; i++) reviewed(s.root, spec(`screen${i}`, "screen", `candidate${i}`));
  expect(() => createPlan(s.root, spec("fourth", "screen", "candidate3"))).toThrow("three");
  const run = getRun(readState(s.root), "screen0");
  expect(() => reviewPlan(s.root, "screen0", { reviewer: "author", planSha256: run.planSha256, approved: true, notes: "self" })).toThrow("independent");
});

test("fresh confirmation requires passing parent, unused clusters, sample floor and a persistent trial budget", () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1");
  expect(() => createPlan(s.root, spec("no-parent", "confirmation", "level1", "missing"))).toThrow("passing");
  const p = reviewed(s.root, spec("screen", "screen", "level1")); saveAssessment(s.root, p.id, observations(p, 0.2)); advance(s.root, p.id);
  const small = spec("too-small", "confirmation", "level1", "screen"); small.targetIds = small.targetIds.slice(0, 3);
  expect(() => createPlan(s.root, small)).toThrow("insufficient"); expect(readState(s.root).confirmationAttempts).toBe(0);
  const confirm = reviewed(s.root, spec("confirm", "confirmation", "level1", "screen")); expect(confirm.analysis.alpha).toBe(0.025);
  expect(() => createPlan(s.root, spec("reused", "confirmation", "level1", "screen"))).toThrow("already allocated");
});

test("production executor and native ledger exercise two successive synthetic promotions without replay", async () => {
  const s = setup(), calls: string[] = [], fetcher = mockProvider(calls);
  for (const kind of ["controls", "aa"] as const) {
    const p = reviewed(s.root, spec(kind, kind)); await executeRun(s.root, p.id, { fetcher, now }); expect((await assessRun(s.root, p.id)).status).toBe("PASS"); advance(s.root, p.id);
  }
  const aaStages = readdirSync(join(s.root, "runs", "aa")).filter(x => x.endsWith("reader.intent.json")); expect(aaStages).toHaveLength(12);
  for (let generation = 1; generation <= 2; generation++) {
    const id = `level${generation}`; proposal(s.root, id);
    for (const kind of ["screen", "confirmation"] as const) {
      const runId = `${kind}${generation}`, p = reviewed(s.root, spec(runId, kind, id, kind === "confirmation" ? `screen${generation}` : null, generation - 1));
      await executeRun(s.root, p.id, { fetcher, now }); expect((await assessRun(s.root, p.id)).status).toBe("PASS"); advance(s.root, p.id);
    }
  }
  const state = readState(s.root); expect(state.promotions).toHaveLength(2); expect(state.champion.revision).toBe(2);
  expect(state.startingBaseline.instruction).toBe("LEVEL0"); expect(state.config.evidenceMode).toBe("offline-synthetic");
  const before = calls.length; expect(await executeRun(s.root, "screen1", { fetcher, now })).toMatchObject({ reused: true, calls: 0 }); expect(calls.length).toBe(before);
  expect(advance(s.root, "confirmation2").status).toBe("already-advanced");
}, 30_000);

test("captured reader and judge stages survive interruption, including the native/local receipt gap", async () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1"); const p = reviewed(s.root, spec("resume", "screen", "level1"));
  const calls: string[] = [], fetcher = mockProvider(calls); let stopped = false;
  await expect(executeRun(s.root, p.id, { fetcher, now, afterProviderCapture: key => { if (!stopped && key.endsWith("reader")) { stopped = true; throw new Error("crash after native capture"); } } })).rejects.toThrow("crash");
  expect(calls).toEqual(["reader"]);
  let judgeStop = false;
  await expect(executeRun(s.root, p.id, { fetcher, now, afterStage: key => { if (!judgeStop && key.endsWith("judge-0")) { judgeStop = true; throw new Error("crash after judge"); } } })).rejects.toThrow("crash");
  expect(calls).toEqual(["reader", "judge"]);
  await executeRun(s.root, p.id, { fetcher, now }); expect(calls).toHaveLength(30); expect((await assessRun(s.root, p.id)).status).toBe("PASS");
});

test("unknown native effects block new execution and known malformed judges are incomplete", async () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1"); const p = reviewed(s.root, spec("unknown", "screen", "level1")); let calls = 0;
  const broken = Object.assign(async () => { calls++; throw new Error("connection lost"); }, { preconnect: fetch.preconnect }) as typeof fetch;
  await expect(executeRun(s.root, p.id, { fetcher: broken, now })).rejects.toThrow("connection lost");
  await expect(executeRun(s.root, p.id, { fetcher: broken, now })).rejects.toThrow("unknown"); expect(calls).toBe(1);
  const other = setup(); const control = reviewed(other.root, spec("controls", "controls")); await executeRun(other.root, control.id, { fetcher: mockProvider([], true), now });
  expect((await assessRun(other.root, control.id)).status).toBe("INCOMPLETE"); expect(() => advance(other.root, control.id)).toThrow("incomplete");
});

test("all runs share the native cap, finite plan allocation, and immutable pins", async () => {
  const s = setup({ campaignCalls: 3 }), p = reviewed(s.root, spec("controls", "controls")), calls: string[] = [];
  await expect(executeRun(s.root, p.id, { fetcher: mockProvider(calls), now })).rejects.toThrow("limit"); expect(calls).toHaveLength(3);
  await expect(executeRun(s.root, p.id, { fetcher: mockProvider(calls), now })).rejects.toThrow("limit"); expect(calls).toHaveLength(3);
  const capped = setup({ maxCalls: 4 }); reviewed(capped.root, spec("controls", "controls")); expect(() => createPlan(capped.root, spec("more", "controls"))).toThrow("allocation");
  writeFileSync(s.config.tasks[0]!.input.path, "changed"); await expect(executeRun(s.root, p.id, { fetcher: mockProvider(), now })).rejects.toThrow("pin changed");
});

test("score tampering and stale champion promotion cannot rewrite accepted history", async () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1"); const p = reviewed(s.root, spec("screen", "screen", "level1"));
  await executeRun(s.root, p.id, { fetcher: mockProvider(), now }); await assessRun(s.root, p.id); advance(s.root, p.id);
  const file = join(s.root, "runs", p.id, "observations.json"), rows = JSON.parse(readFileSync(file, "utf8")); rows[0].score = 0.99; writeFileSync(file, JSON.stringify(rows));
  await expect(assessRun(s.root, p.id)).rejects.toThrow("saved observations");
  const first = reviewed(s.root, spec("confirm1", "confirmation", "level1", "screen", 0));
  const stale = reviewed(s.root, spec("confirm2", "confirmation", "level1", "screen", 1));
  saveAssessment(s.root, first.id, observations(first, 0.2)); saveAssessment(s.root, stale.id, observations(stale, 0.2)); advance(s.root, first.id);
  expect(() => advance(s.root, stale.id)).toThrow("compare-and-swap"); expect(readState(s.root).promotions).toHaveLength(1);
});


test("explicit lock recovery proves the same owner dead and refuses unresolved effects", async () => {
  const s = setup(), p = reviewed(s.root, spec("controls", "controls"));
  await executeRun(s.root, p.id, { fetcher: mockProvider(), now });
  const local = join(s.root, "execution.lock"), native = s.ledger + ".lock", deadPid = 2147483646;
  writeFileSync(local, JSON.stringify({ pid: process.pid, run: p.id, planSha256: sha(p) }));
  expect(() => recoverAbandonedExecution(s.root)).toThrow("alive"); expect(existsSync(local)).toBeTrue();
  writeFileSync(local, JSON.stringify({ pid: deadPid, run: p.id, planSha256: sha(p) }));
  writeFileSync(native, JSON.stringify({ pid: deadPid, protocol: "oh.memory-lab-api.v1", budgetSha256: s.config.budget.sha256 }));
  expect(recoverAbandonedExecution(s.root)).toMatchObject({ effectsReplayed: 0, ledgerModified: false });
  expect(existsSync(local)).toBeFalse(); expect(existsSync(native)).toBeFalse();
  writeFileSync(join(s.root, "state.lock"), JSON.stringify({ pid: deadPid }));
  expect(recoverAbandonedExecution(s.root)).toMatchObject({ recoveredState: true, effectsReplayed: 0 });
  expect(existsSync(join(s.root, "state.lock"))).toBeFalse();
  const t = setup(), q = reviewed(t.root, spec("controls", "controls"));
  const broken = Object.assign(async () => { throw new Error("unknown"); }, { preconnect: fetch.preconnect }) as typeof fetch;
  await expect(executeRun(t.root, q.id, { fetcher: broken, now })).rejects.toThrow("unknown");
  writeFileSync(join(t.root, "execution.lock"), JSON.stringify({ pid: deadPid, run: q.id, planSha256: sha(q) }));
  writeFileSync(t.ledger + ".lock", JSON.stringify({ pid: deadPid, protocol: "oh.memory-lab-api.v1", budgetSha256: t.config.budget.sha256 }));
  expect(() => recoverAbandonedExecution(t.root)).toThrow("unknown provider outcomes"); expect(existsSync(t.ledger + ".lock")).toBeTrue();
});


test("live score injection, renamed fresh input and noisy confirmation guards fail closed", () => {
  const live = setup({ evidenceMode: "live" }), controls = reviewed(live.root, spec("controls", "controls"));
  expect(() => saveAssessment(live.root, controls.id, observations(controls))).toThrow("native provider evidence");
  const duplicated = structuredClone(live.config); duplicated.tasks[5]!.input = duplicated.tasks[4]!.input;
  expect(() => initialize(join(live.dir, "duplicate"), duplicated, { id: "baseline", instruction: "LEVEL0", contextPolicyId: "reserve24" })).toThrow("duplicate semantic input");
  const s = setup(); qualify(s.root); proposal(s.root, "level1"); const screen = reviewed(s.root, spec("screen", "screen", "level1"));
  saveAssessment(s.root, screen.id, observations(screen, 0.2)); advance(s.root, screen.id);
  const confirm = reviewed(s.root, spec("confirm", "confirmation", "level1", "screen"));
  const rows = observations(confirm, 0.2); rows.find(r => r.taskId === "c0g0" && r.arm === "candidate")!.score = 0;
  rows.find(r => r.taskId === "c0g1" && r.arm === "candidate")!.score = 0.8;
  expect(evaluate(confirm, rows, 0.02)).toMatchObject({ status: "REJECT", guardDelta: 0, guardLowerBound: -0.4, guardEstimand: "cluster-median" });
});

test("a narrower v3 campaign expiry stops new native dispatch while settled evidence remains replayable", async () => {
  const expiry = new Date(Date.now() + 60_000).toISOString(), s = setup({ expiresAt: expiry });
  const p = reviewed(s.root, spec("controls", "controls")), calls: string[] = []; let virtualNow = Date.parse(expiry) - 1000;
  await expect(executeRun(s.root, p.id, { fetcher: mockProvider(calls), now: () => virtualNow,
    afterProviderCapture: () => { virtualNow = Date.parse(expiry); } })).rejects.toThrow("expired before dispatch");
  expect(calls).toHaveLength(1); expect((await assessRun(s.root, p.id)).status).toBe("INCOMPLETE");
});

test("a policy-only proposal changes native reader contexts with identical instructions and no gold", async () => {
  const s = setup(); qualify(s.root); const state = readState(s.root);
  const candidate = propose(s.root, { treatment: { id: "reserve-only", instruction: "LEVEL0", contextPolicyId: "reserve96" },
    parentRevision: 0, parentKey: state.champion.treatment.semanticKey, author: "author", mechanism: "reserve", hypothesis: "Packing only.",
    evidence: ["invented"], disconfirmingTest: "No gain.", strategy: "explore" });
  expect(candidate.treatment.semanticKey).not.toBe(state.champion.treatment.semanticKey);
  const p = reviewed(s.root, spec("reserve", "screen", "reserve-only")), readers: string[] = [], mock = mockProvider();
  const fetcher = Object.assign(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (String(url).includes("googleapis")) { const b = JSON.parse(String(init!.body)); expect(b.systemInstruction.parts[0].text).toBe("LEVEL0"); readers.push(b.contents[0].parts[0].text); }
    return mock(url, init);
  }, { preconnect: fetch.preconnect });
  await executeRun(s.root, p.id, { fetcher, now });
  expect(readers).toHaveLength(12); expect(readers[0]).not.toBe(readers[1]);
  expect(readers.every(r => !r.includes("SECRET-GOLD"))).toBeTrue();
});

test("context replay rejects forged context, missing policy, wrong rank provenance and changed source", () => {
  const s = setup(), task = s.config.tasks.find(t => t.id === "s0")!, raw = JSON.parse(readFileSync(task.input.path, "utf8"));
  const input = parseTaskInput(raw, task); expect(() => verifyContexts(s.config, input)).not.toThrow();
  const forged = structuredClone(input); forged.contexts[0]!.context += "Injected evidence."; forged.contexts[0]!.sha256 = sha256Hex(forged.contexts[0]!.context);
  expect(() => verifyContexts(s.config, forged)).toThrow("differs from source");
  expect(() => verifyContexts(s.config, { ...input, contexts: input.contexts.slice(1) })).toThrow("denominator");
  const ranks = JSON.parse(readFileSync(input.ranking!.path, "utf8")); ranks.querySha256 = "f".repeat(64);
  expect(() => verifyContexts(s.config, { ...input, ranking: s.ref("bad-ranks.json", ranks) })).toThrow("provenance");
  writeFileSync(input.source!.path, "changed"); expect(() => verifyContexts(s.config, input)).toThrow("pin changed");
});

test("repeat observations retain complete denominators without adding independent clusters", () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1");
  const p = reviewed(s.root, { ...spec("repeat", "screen", "level1"), repeats: 3, maxCalls: 90 });
  const rows = observations(p, 0.2), a = evaluate(p, rows, 0.02);
  expect(a).toMatchObject({ planned: 36, complete: 36, targetClusters: 3, informativeClusters: 3, pValue: 0.125 });
  expect(evaluate(p, rows.slice(1), 0.02).status).toBe("INCOMPLETE");
  expect(() => evaluate(p, [...rows, rows[0]!], 0.02)).toThrow("duplicate");
  expect(() => createPlan(s.root, { ...spec("insufficient-cap", "aa"), repeats: 2 })).toThrow("denominator");
});

test("escaped JSON answer ceiling fails without truncating or making judge calls and replays without dispatch", async () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1"); const p = reviewed(s.root, spec("envelope", "screen", "level1"));
  const calls: string[] = [], mock = mockProvider(calls);
  const fetcher = Object.assign(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await mock(url, init); if (!String(url).includes("googleapis")) return response;
    const body = await response.json(); body.candidates[0].content.parts[0].text = '"'.repeat(2050); return Response.json(body);
  }, { preconnect: fetch.preconnect });
  await executeRun(s.root, p.id, { fetcher, now }); expect(calls).toEqual(Array(12).fill("reader"));
  expect(await assessRun(s.root, p.id)).toMatchObject({ status: "INCOMPLETE", planned: 12, complete: 0 });
  expect(await executeRun(s.root, p.id, { fetcher, now })).toMatchObject({ reused: true, calls: 0 }); expect(calls).toHaveLength(12);
});

test("default reader bound blocks all calls while an explicit bound admits the identical request", async () => {
  const s = setup(), instruction = "x".repeat(32768);
  function plan(root: string) {
    qualify(root); const state = readState(root);
    propose(root, { treatment: { id: "too-long", instruction, contextPolicyId: "reserve96" }, parentRevision: 0,
      parentKey: state.champion.treatment.semanticKey, author: "author", mechanism: "oversize", hypothesis: "Invented.", evidence: ["fixture"], disconfirmingTest: "Fail.", strategy: "explore" });
    return reviewed(root, spec("oversize", "screen", "too-long"));
  }
  const p = plan(s.root), calls: string[] = [];
  const input = parseTaskInput(JSON.parse(readFileSync(p.tasks[0]!.input.path, "utf8")), p.tasks[0]!);
  const user = evolutionAnswerMessages({ question: input.question, questionDate: input.questionDate }, input.contexts.find(c => c.policyId === "reserve96")!.context, "task-complete-v10")[1]!;
  const request = prepareApiRequest(s.config.api.reader, [{ role: "system", content: instruction }, user]);
  expect(request.inputUpperBound).toBeGreaterThan(200000); expect(request.inputUpperBound).toBeLessThanOrEqual(262144);
  await expect(executeRun(s.root, p.id, { fetcher: mockProvider(calls), now })).rejects.toThrow("200000-byte");
  expect(calls).toHaveLength(0); expect(existsSync(s.ledger)).toBeFalse();
  const explicitRoot = join(s.dir, "explicit");
  initialize(explicitRoot, { ...s.config, maximumReaderInputUpperBound: 262144 }, { id: "baseline", instruction: "LEVEL0", contextPolicyId: "reserve24" });
  const explicit = plan(explicitRoot), readerRequests: string[] = [], mock = mockProvider(calls);
  expect(explicit.candidate).toEqual(p.candidate); expect(explicit.tasks).toEqual(p.tasks);
  expect(explicit.executionKey).not.toBe(p.executionKey);
  const fetcher = Object.assign(async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await mock(url, init); if (!String(url).includes("googleapis")) return response;
    readerRequests.push(String(init!.body)); const body = await response.json();
    body.candidates[0].content.parts[0].text = "RIGHT"; return Response.json(body);
  }, { preconnect: fetch.preconnect });
  await executeRun(explicitRoot, explicit.id, { fetcher, now });
  expect(calls).toHaveLength(30); expect(readerRequests).toHaveLength(12); expect(readerRequests).toContain(request.raw);
});

test("reader bounds reject invalid values and preserve omitted config identity", () => {
  const s = setup(), parsed = parseConfig(s.config);
  expect(readerInputUpperBound(parsed)).toBe(200000); expect(Object.hasOwn(parsed, "maximumReaderInputUpperBound")).toBeFalse();
  expect(sha(parsed)).toBe(sha(s.config));
  for (const value of [1, 200000, 262144]) {
    const explicit = parseConfig({ ...s.config, maximumReaderInputUpperBound: value });
    expect(readerInputUpperBound(explicit)).toBe(value); expect(sha(explicit)).not.toBe(sha(parsed));
  }
  for (const value of [0, -1, 200000.5, 262145, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "262144", null, undefined]) {
    expect(() => parseConfig({ ...s.config, maximumReaderInputUpperBound: value })).toThrow("integer outside bound");
  }
  expect(() => parseConfig({ ...s.config, maximumReaderInputUpperBound: 262144, unexpected: true })).toThrow("unexpected or missing fields");
});

test("a changed reader bound invalidates the reviewed execution identity before dispatch", async () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1"); const p = reviewed(s.root, spec("pinned", "screen", "level1")), calls: string[] = [];
  transaction(s.root, state => { state.config.maximumReaderInputUpperBound = 262144; });
  await expect(executeRun(s.root, p.id, { fetcher: mockProvider(calls), now })).rejects.toThrow("execution config changed");
  expect(calls).toHaveLength(0); expect(existsSync(s.ledger)).toBeFalse();
});

test("a later challenger beating champion but losing to original cannot promote", () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1");
  for (const kind of ["screen", "confirmation"] as const) { const p = reviewed(s.root, spec(kind + "1", kind, "level1", kind === "confirmation" ? "screen1" : null)); saveAssessment(s.root, p.id, observations(p, 0.2)); advance(s.root, p.id); }
  proposal(s.root, "level2"); const screen = reviewed(s.root, spec("screen2", "screen", "level2")); saveAssessment(s.root, screen.id, observations(screen, 0.2)); advance(s.root, screen.id);
  const p = reviewed(s.root, spec("confirm2", "confirmation", "level2", "screen2", 1)), rows = observations(p, 0.2);
  for (const row of rows) if (row.arm === "original" && p.targetIds.includes(row.taskId)) row.score = 0.9;
  expect(planArms(p)).toEqual(["baseline", "candidate", "original"]);
  const a = saveAssessment(s.root, p.id, rows); expect(a.status).toBe("REJECT"); expect(a.reasons.some(r => r.startsWith("original:"))).toBeTrue();
  advance(s.root, p.id); expect(readState(s.root).champion.revision).toBe(1);
});

test("A/A repeat noise cannot cancel across paired measurements", () => {
  const s = setup(), controls = reviewed(s.root, spec("controls", "controls")); saveAssessment(s.root, controls.id, observations(controls)); advance(s.root, controls.id);
  const p = reviewed(s.root, { ...spec("aa", "aa"), repeats: 2, maxCalls: 60 }), rows = observations(p);
  for (const row of rows) if (row.arm === "candidate") row.score = row.repeat === 0 ? 0.6 : 0.2;
  const a = evaluate(p, rows, 0.02); expect(a.targetDelta).toBeCloseTo(0); expect(a.meanAbsoluteDelta).toBeCloseTo(0.2); expect(a.status).toBe("REJECT");
});

test("development screening may advance one improving cluster but confirmation still requires independent signs", () => {
  const s = setup({ screenCriterion: "development-effect" }); qualify(s.root); proposal(s.root, "level1");
  const screen = reviewed(s.root, spec("screen", "screen", "level1")), rows = observations(screen);
  rows.find(r => r.taskId === "s0" && r.arm === "candidate")!.score = 0.8;
  expect(saveAssessment(s.root, screen.id, rows)).toMatchObject({ status: "PASS", pValue: 0.5, informativeClusters: 1 }); advance(s.root, screen.id);
  expect(readState(s.root).champion.revision).toBe(0);
  const confirm = reviewed(s.root, spec("confirm", "confirmation", "level1", "screen")), confirmRows = observations(confirm);
  confirmRows.find(r => r.taskId === "c0t0" && r.arm === "candidate")!.score = 0.8;
  expect(saveAssessment(s.root, confirm.id, confirmRows)).toMatchObject({ status: "REJECT", pValue: 0.5, informativeClusters: 1 });
  advance(s.root, confirm.id); expect(readState(s.root).champion.revision).toBe(0);
});

test("A/A evaluates the selected development-effect screen even without a significant sign test", () => {
  const s = setup({ screenCriterion: "development-effect" }), controls = reviewed(s.root, spec("controls", "controls")); saveAssessment(s.root, controls.id, observations(controls)); advance(s.root, controls.id);
  const aa = reviewed(s.root, spec("aa", "aa")), rows = observations(aa); rows.find(r => r.taskId === "s0" && r.arm === "candidate")!.score = 0.7;
  expect(evaluate(aa, rows, 0.1)).toMatchObject({ status: "REJECT", wouldPass: true, pValue: 0.5 });
});

for (const kind of ["controls", "aa"] as const) test(`latest planned or failed ${kind} invalidates earlier qualification at planning, dispatch and advancement`, async () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1"); const screen = reviewed(s.root, spec("screen", "screen", "level1"));
  saveAssessment(s.root, screen.id, observations(screen, 0.2));
  const replacement = reviewed(s.root, spec("replacement", kind)), calls: string[] = [];
  expect(readState(s.root).qualifications[kind]).toBeNull();
  expect(() => createPlan(s.root, spec("blocked", "screen", "level1"))).toThrow("latest");
  await expect(executeRun(s.root, screen.id, { fetcher: mockProvider(calls), now })).rejects.toThrow("latest"); expect(calls).toHaveLength(0);
  expect(() => advance(s.root, screen.id)).toThrow("latest");
  const failed = observations(replacement, 0.2); if (kind === "controls") failed[0]!.score = 0;
  expect(saveAssessment(s.root, replacement.id, failed).status).toBe("REJECT");
  expect(() => advance(s.root, screen.id)).toThrow("latest"); // Failure cannot be hidden by leaving it unadvanced.
  advance(s.root, replacement.id); expect(readState(s.root).qualifications[kind]).toBeNull();
  expect(() => advance(s.root, screen.id)).toThrow("latest");
});

test("requalification blocks subsequent live stages but historical captured scores still replay", async () => {
  const s = setup(); qualify(s.root); proposal(s.root, "level1"); const p = reviewed(s.root, spec("screen", "screen", "level1"));
  const calls: string[] = []; let interrupted = false;
  await expect(executeRun(s.root, p.id, { fetcher: mockProvider(calls), now, afterStage: () => {
    if (!interrupted) { interrupted = true; reviewed(s.root, spec("new-controls", "controls")); }
  } })).rejects.toThrow("latest"); expect(calls).toEqual(["reader"]);
  const controls = getRun(readState(s.root), "new-controls").plan;
  await executeRun(s.root, controls.id, { fetcher: mockProvider(calls), now }); await assessRun(s.root, controls.id); advance(s.root, controls.id);
  expect(readState(s.root).qualifications.aa).toBeNull();
  const aa = reviewed(s.root, spec("new-aa", "aa"));
  await executeRun(s.root, aa.id, { fetcher: mockProvider(calls), now }); await assessRun(s.root, aa.id); advance(s.root, aa.id);
  await executeRun(s.root, p.id, { fetcher: mockProvider(calls), now }); expect(calls).toHaveLength(64);
  reviewed(s.root, spec("later-controls", "controls"));
  expect((await assessRun(s.root, p.id)).status).toBe("PASS"); expect(calls).toHaveLength(64);
  expect(() => advance(s.root, p.id)).toThrow("latest");
}, 30_000);
