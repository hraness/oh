/** Explicit development-only execution. Native requests, storage and transport stay
 * shared; the frozen eight-conversation study and its protocol remain unchanged. */
import { lstat, mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, hasExactKeys, isPlainRecord } from "../../src/canonical";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { loadLocomoJudgeProfile } from "./evolution-locomo-judge";
import { openEvolutionStore, type EvolutionStore } from "./evolution-store";
import { invokeEvolutionRequest, type EvolutionCredential } from "./evolution-transport";
import { runLabPaidQueue } from "./lab-paid-queue";
import { LOCOMO_WINDOW_CODE_FILES } from "./locomo-window-report";
import { collectLocomoWindowOutcomes } from "./locomo-window-study-run";
import { locomoWindowOutcomeReceipt, type LocomoWindowJob, type LocomoWindowOutcome } from "./locomo-window-study";
import { LOCOMO_ORDER_DEV_LIMITS, locomoOrderDevResultReceipt, makeLocomoOrderDevJudgePlan, parseLocomoOrderDevScorer,
  parseLocomoOrderDevSource, verifyLocomoOrderDevPlan, type LocomoOrderDevJudgePlan,
  type LocomoOrderDevPlan, type LocomoOrderDevResult } from "./locomo-order-dev";

const ROOT = resolve(import.meta.dir, "../..");
const LIMIT = Object.freeze({ source: LOCOMO_ORDER_DEV_LIMITS.sourceBytes, plan: LOCOMO_ORDER_DEV_LIMITS.planBytes, result: LOCOMO_ORDER_DEV_LIMITS.resultBytes,
  launch: 64 * 1024, canary: 256 * 1024, code: 8 * 1024 ** 2, attempts: 8, jobs: 1920,
  spend: 15_000_000, calls: 3840, priorTask: 2_692_061, task: 25_000_000 });
export const LOCOMO_ORDER_DEV_CODE_FILES = Object.freeze([...LOCOMO_WINDOW_CODE_FILES,
  "scripts/benchmarks/locomo-order-dev.ts", "scripts/benchmarks/locomo-order-dev-source.ts",
  "scripts/benchmarks/locomo-order-dev-report.ts", "scripts/benchmarks/locomo-order-dev-run.ts",
  "scripts/benchmarks/lab-paid-queue.ts"]);
export type LocomoOrderDevLaunch = Readonly<{ protocol: "oh.locomo-order-dev-launch.v1";
  sourcePin: EvolutionPin; scorerPin: EvolutionPin; planPin: EvolutionPin; campaignPin: EvolutionPin;
  codePins: readonly EvolutionPin[]; checkpoint: string; reviewer: string; approved: true;
  scope: "reader-judge"; maximumNewSpendMicros: number; maximumPhysicalCalls: number; canaryQuestionCount: 2 }>;
type Phase = "reader" | "judge";
type Job = LocomoWindowJob;
type Outcome = LocomoWindowOutcome;
function fail(reason: string): never { throw Error(`LoCoMo order development: ${reason}.`); }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const decode = (raw: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
const complete = (rows: readonly Outcome[]) => rows.every(row => !["unresolved", "unattempted"].includes(row.disposition));
const boundedInteger = (n: unknown, maximum: number): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= maximum;

export function parseLocomoOrderDevLaunch(value: unknown): LocomoOrderDevLaunch {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "sourcePin", "scorerPin", "planPin", "campaignPin", "codePins",
    "checkpoint", "reviewer", "approved", "scope", "maximumNewSpendMicros", "maximumPhysicalCalls", "canaryQuestionCount"])
    || value.protocol !== "oh.locomo-order-dev-launch.v1" || value.approved !== true || value.scope !== "reader-judge"
    || typeof value.checkpoint !== "string" || !/^[a-f0-9]{40}$/.test(value.checkpoint)
    || typeof value.reviewer !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(value.reviewer)
    || !boundedInteger(value.maximumNewSpendMicros, LIMIT.spend) || LIMIT.priorTask + value.maximumNewSpendMicros > LIMIT.task
    || !boundedInteger(value.maximumPhysicalCalls, LIMIT.calls) || value.canaryQuestionCount !== 2
    || !Array.isArray(value.codePins) || value.codePins.length !== LOCOMO_ORDER_DEV_CODE_FILES.length) fail("reviewed launch bounds or identity");
  const codePins = value.codePins.map(evolutionPin);
  if (codePins.some((pin, index) => pin.path !== join(ROOT, LOCOMO_ORDER_DEV_CODE_FILES[index]!))) fail("exact code inventory required");
  const roles = [value.sourcePin, value.scorerPin, value.planPin, value.campaignPin].map(evolutionPin);
  if (new Set([...roles, ...codePins].map(pin => pin.path)).size !== roles.length + codePins.length) fail("aliased launch roles");
  return Object.freeze({ protocol: value.protocol, sourcePin: roles[0]!, scorerPin: roles[1]!, planPin: roles[2]!, campaignPin: roles[3]!,
    codePins: Object.freeze(codePins), checkpoint: value.checkpoint, reviewer: value.reviewer, approved: true, scope: "reader-judge",
    maximumNewSpendMicros: value.maximumNewSpendMicros, maximumPhysicalCalls: value.maximumPhysicalCalls, canaryQuestionCount: 2 });
}
function cleanCheckpoint(expected: string): void {
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const status = Bun.spawnSync(["git", "status", "--porcelain=v1", "--untracked-files=normal"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (head.exitCode !== 0 || status.exitCode !== 0 || head.stdout.toString().trim() !== expected || status.stdout.length !== 0) fail("reviewed clean checkpoint changed");
}
async function writeNew(path: string, value: unknown, maximum: number) {
  const body = canonicalJson(value) + "\n"; if (Buffer.byteLength(body) > maximum) fail("private receipt byte bound");
  const file = await open(path, "wx", 0o600); try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
}
async function privateJson(path: string, maximum: number): Promise<unknown> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > maximum
    || await realpath(path) !== path) fail("private receipt custody");
  const raw = await readFile(path); if (raw.length > maximum) fail("private receipt grew"); return decode(raw);
}

/** Called under the native store lock. An identity-only crash can resume attempt
 * zero; every occupied request remains governed by the original native store. */
export async function prepareLocomoOrderDevAttempt(input: Readonly<{ storeDirectory: string; launchPin: EvolutionPin;
  launch: LocomoOrderDevLaunch; plan: LocomoOrderDevPlan; mode: "new" | "resume"; phase: Phase; readerResultPin?: EvolutionPin }>) {
  const { phase, mode, plan, launchPin, launch } = input;
  if (!["reader", "judge"].includes(phase) || !["new", "resume"].includes(mode)
    || (phase === "judge") !== (input.readerResultPin !== undefined)) fail("explicit phase, mode and reader receipt required");
  const readerResultPin = input.readerResultPin === undefined ? null : evolutionPin(input.readerResultPin);
  const directory = join(input.storeDirectory, `locomo-order-dev-${phase}-v1`);
  const identity = { protocol: "oh.locomo-order-dev-started.v1", phase, launchPin, launch, planSha256: plan.planSha256, readerResultPin };
  if (mode === "new") { await mkdir(directory, { mode: 0o700 }); await writeNew(join(directory, "started.json"), identity, LIMIT.launch); }
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || await realpath(directory) !== directory
    || !same(await privateJson(join(directory, "started.json"), LIMIT.launch), identity)) fail("resume identity or directory changed");
  const files = await readdir(directory), pattern = /^attempt-0[0-7]\.(started|canary|result)\.json$/;
  if (files.some(name => name !== "started.json" && !pattern.test(name))) fail("unexpected attempt artifact");
  const previous = files.filter(name => name.endsWith(".started.json")).sort();
  if (previous.length >= LIMIT.attempts || previous.some((name, i) => name !== `attempt-0${i}.started.json`)) fail("attempt sequence or limit");
  for (const name of files.filter(name => name !== "started.json")) {
    const index = Number(name.slice(8, 10)); if (index >= previous.length) fail("orphan attempt artifact");
    const value = await privateJson(join(directory, name), name.endsWith(".started.json") ? LIMIT.launch : name.endsWith(".canary.json") ? LIMIT.canary : LIMIT.result);
    if (name.endsWith(".started.json")) {
      const expectedMode = index === 0 && isPlainRecord(value) && value.mode === "new" ? "new" : "resume";
      if (!same(value, { protocol: "oh.locomo-order-dev-attempt.v1", phase, attempt: index, mode: expectedMode, launchPin, planSha256: plan.planSha256 })) fail("attempt identity changed");
    }
  }
  const attempt = previous.length, prefix = join(directory, `attempt-0${attempt}`);
  await writeNew(`${prefix}.started.json`, { protocol: "oh.locomo-order-dev-attempt.v1", phase, attempt, mode, launchPin, planSha256: plan.planSha256 }, LIMIT.launch);
  return Object.freeze({ directory, attempt, prefix });
}

/** Four owned workers drain on error or signal. Known model failures return
 * normally and stay in the denominator; ambiguous dispatches stop admission. */
export async function executeLocomoOrderDevJobs(jobs: readonly Job[], invoke: (job: Job, stopped: () => boolean) => Promise<unknown>,
  externalStopped: () => boolean = () => false): Promise<boolean> {
  if (jobs.length > LIMIT.jobs || new Set(jobs.map(job => job.key)).size !== jobs.length) fail("physical job bound or duplicates");
  let failed = false; const stopped = () => failed || externalStopped();
  const result = await runLabPaidQueue(jobs, { concurrency: 4, stopped, execute: async job => {
    try { return await invoke(job, stopped); } catch (error) { failed = true; throw error; }
  } });
  return !stopped() && result.errors.length === 0 && result.pendingKeys.length === 0;
}
function coverage(rows: readonly Outcome[], store: EvolutionStore) {
  const ledger = store.summary();
  if (new Set(rows.map(row => row.jobKey)).size !== rows.length || ledger.calls !== rows.filter(row => row.disposition !== "unattempted").length
    || ledger.exposureMicros !== rows.reduce((sum, row) => sum + row.chargeMicros, 0)
    || ledger.unresolvedMicros !== rows.filter(row => row.disposition === "unresolved").reduce((sum, row) => sum + row.chargeMicros, 0)) fail("unexplained native jobs or charges");
}
async function dispatch(jobs: readonly Job[], store: EvolutionStore, credential: EvolutionCredential, stopped: () => boolean) {
  const rows = collectLocomoWindowOutcomes(jobs, store);
  if (rows.some(row => row.disposition === "unresolved")) return false;
  return executeLocomoOrderDevJobs(jobs.filter((_, index) => rows[index]!.disposition === "unattempted"),
    (job, stopped) => invokeEvolutionRequest({ request: job.request, repeat: job.repeat, store, credential, stopped }), stopped);
}
async function readStudy(pin: EvolutionPin) {
  const launchPin = evolutionPin(pin), launch = parseLocomoOrderDevLaunch(decode(await readEvolutionPin(launchPin, LIMIT.launch)));
  await Promise.all(launch.codePins.map(pin => readEvolutionPin(pin, LIMIT.code)));
  const authority = await verifyEvolutionCampaign(launch.campaignPin), campaign = authority.campaign;
  if (campaign.additionalBudgetMicros > launch.maximumNewSpendMicros || campaign.maximumCalls > launch.maximumPhysicalCalls) fail("campaign exceeds reviewed launch");
  const source = parseLocomoOrderDevSource(decode(await readEvolutionPin(launch.sourcePin, LIMIT.source)));
  // Bind scorer bytes without decoding or exposing gold to the reader phase.
  await readEvolutionPin(launch.scorerPin, LIMIT.source);
  const plan = verifyLocomoOrderDevPlan(decode(await readEvolutionPin(launch.planPin, LIMIT.plan)), {
    source, sourcePin: launch.sourcePin, scorerPin: launch.scorerPin, campaignPin: launch.campaignPin, campaign });
  if (plan.maximumReservationMicros > launch.maximumNewSpendMicros || plan.maximumPhysicalCalls > launch.maximumPhysicalCalls) fail("complete matrix exceeds launch");
  return { launchPin, launch, authority, campaign, source, plan, rubric: await loadLocomoJudgeProfile() };
}
function resultOf(phase: Phase, plan: LocomoOrderDevPlan, readers: readonly Outcome[], judge: LocomoOrderDevJudgePlan | null,
  judges: readonly Outcome[], halt: LocomoOrderDevResult["halt"], ledger: LocomoOrderDevResult["ledger"]): LocomoOrderDevResult {
  const payload = { protocol: "oh.locomo-order-dev-result.v1" as const, phase, planSha256: plan.planSha256, scorerSha256: plan.scorerPin.sha256,
    readerOutcomes: readers, judgePlanSha256: judge?.judgePlanSha256 ?? null, judgeCases: judge?.judgeCases ?? [], judgeJobs: judge?.judgeJobs ?? [],
    judgeOutcomes: judges, halt, ledger };
  return { ...payload, resultSha256: locomoOrderDevResultReceipt(payload).resultSha256 };
}
async function verifyReaders(pin: EvolutionPin, plan: LocomoOrderDevPlan, rows: readonly Outcome[], store: EvolutionStore) {
  if (!complete(rows)) fail("judge requires complete resolved readers");
  const current = store.summary(), exposure = rows.reduce((sum, row) => sum + row.chargeMicros, 0);
  const ledger = { ...current, calls: rows.length, exposureMicros: exposure, confirmedMicros: exposure, unresolvedMicros: 0,
    combinedExposureMicros: current.historicalExposureMicros + exposure };
  if (!same(decode(await readEvolutionPin(pin, LIMIT.result)), locomoOrderDevResultReceipt(resultOf("reader", plan, rows, null, [], "none", ledger)))) fail("reader receipt differs from native evidence");
}

export async function runLocomoOrderDevStudy(input: Readonly<{ launchPin: EvolutionPin; token: string; mode: "new" | "resume";
  phase: Phase; readerResultPin?: EvolutionPin }>) {
  if (!["reader", "judge"].includes(input.phase) || !["new", "resume"].includes(input.mode)
    || (input.phase === "judge") !== (input.readerResultPin !== undefined)) fail("explicit phase, mode and reader receipt required");
  const { launchPin, launch, authority, campaign, source, plan, rubric } = await readStudy(input.launchPin);
  cleanCheckpoint(launch.checkpoint);
  const store = await openEvolutionStore({ directory: campaign.storeDirectory, campaign });
  let interrupted = false, finished = false; const stop = () => { interrupted = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    let readers = collectLocomoWindowOutcomes(plan.readerJobs, store), halt: LocomoOrderDevResult["halt"] = "none";
    if (input.phase === "reader") { coverage(readers, store); if (input.mode === "new" && store.summary().calls !== 0) fail("new run requires unused store"); }
    else { await verifyReaders(input.readerResultPin!, plan, readers, store); if (input.mode === "new" && store.summary().calls !== readers.length) fail("judge phase already occupied"); }
    const attempt = await prepareLocomoOrderDevAttempt({ storeDirectory: campaign.storeDirectory, launchPin, launch, plan,
      mode: input.mode, phase: input.phase, ...(input.readerResultPin === undefined ? {} : { readerResultPin: input.readerResultPin }) });
    const credential: EvolutionCredential = { kind: "gateway-oidc", token: input.token, auth: authority.auth };
    if (readers.some(row => row.disposition === "unresolved")) halt = "preexisting-unresolved";
    if (interrupted) halt = "interrupted";
    if (input.phase === "reader" && halt === "none") {
      cleanCheckpoint(launch.checkpoint); await readStudy(launchPin);
      const ids = new Set(plan.canaryQuestionIds), keys = new Set(plan.cases.filter(cell => ids.has(cell.questionId)).map(cell => cell.readerJobKey));
      const canary = plan.readerJobs.filter(job => keys.has(job.key));
      let passed = await dispatch(canary, store, credential, () => interrupted);
      const outcomes = collectLocomoWindowOutcomes(canary, store); passed = passed && outcomes.every(row => row.disposition === "completed");
      await writeNew(`${attempt.prefix}.canary.json`, { protocol: "oh.locomo-order-dev-canary.v1", planSha256: plan.planSha256,
        criterion: "completed-native-reader-responses-only; no-answer-quality-check", passed, outcomes: outcomes.map(locomoWindowOutcomeReceipt) }, LIMIT.canary);
      if (!passed) halt = interrupted ? "interrupted" : "canary-failure";
      else {
        cleanCheckpoint(launch.checkpoint); await readStudy(launchPin);
        if (!await dispatch(plan.readerJobs.filter(job => !keys.has(job.key)), store, credential, () => interrupted)) halt = interrupted ? "interrupted" : "reader-failure";
      }
    }
    readers = collectLocomoWindowOutcomes(plan.readerJobs, store);
    let judge: LocomoOrderDevJudgePlan | null = null;
    if (input.phase === "judge") {
      const scorer = parseLocomoOrderDevScorer(decode(await readEvolutionPin(launch.scorerPin, LIMIT.source)), source);
      judge = makeLocomoOrderDevJudgePlan(plan, scorer, readers, rubric);
      const prior = collectLocomoWindowOutcomes(judge.judgeJobs, store); coverage([...readers, ...prior], store);
      if (prior.some(row => row.disposition === "unresolved")) halt = "preexisting-unresolved";
      if (halt === "none") {
        cleanCheckpoint(launch.checkpoint); await readStudy(launchPin);
        if (!await dispatch(judge.judgeJobs, store, credential, () => interrupted)) halt = interrupted ? "interrupted" : "judge-failure";
      }
    }
    const judges = collectLocomoWindowOutcomes(judge?.judgeJobs ?? [], store); coverage([...readers, ...judges], store);
    if (interrupted) halt = "interrupted";
    cleanCheckpoint(launch.checkpoint); await readStudy(launchPin);
    if (input.readerResultPin !== undefined) await readEvolutionPin(input.readerResultPin, LIMIT.result);
    const result = resultOf(input.phase, plan, readers, judge, judges, halt, store.summary()), resultPath = `${attempt.prefix}.result.json`;
    await writeNew(resultPath, locomoOrderDevResultReceipt(result), LIMIT.result);
    finished = true;
    return Object.freeze({ directory: attempt.directory, attempt: attempt.attempt, resultPath, result });
  } finally {
    try { await store.close(); if (finished) { cleanCheckpoint(launch.checkpoint); await readStudy(launchPin); } }
    finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
  }
}

/** Offline native authentication reconstructs all responses and exact judge requests.
 * Code pins remain mandatory; unrelated documentation changes need no clean HEAD. */
export async function authenticateLocomoOrderDevResult(input: Readonly<{ launchPin: EvolutionPin; resultPin: EvolutionPin }>) {
  const { launch, campaign, source, plan, rubric } = await readStudy(input.launchPin);
  const expected = decode(await readEvolutionPin(input.resultPin, LIMIT.result));
  const store = await openEvolutionStore({ directory: campaign.storeDirectory, campaign });
  try {
    const readers = collectLocomoWindowOutcomes(plan.readerJobs, store); if (!complete(readers)) fail("incomplete native readers");
    const scorer = parseLocomoOrderDevScorer(decode(await readEvolutionPin(launch.scorerPin, LIMIT.source)), source);
    const judge = makeLocomoOrderDevJudgePlan(plan, scorer, readers, rubric), judges = collectLocomoWindowOutcomes(judge.judgeJobs, store);
    if (!complete(judges)) fail("incomplete native judges"); coverage([...readers, ...judges], store);
    const result = resultOf("judge", plan, readers, judge, judges, "none", store.summary());
    if (!same(expected, locomoOrderDevResultReceipt(result))) fail("result differs from complete native evidence");
    await readStudy(input.launchPin); await readEvolutionPin(input.resultPin, LIMIT.result);
    return Object.freeze({ launch, source, scorer, plan, rubric, result });
  } finally { await store.close(); }
}
