/** Explicit paid entry point: one reviewed launch, one campaign/native store,
 * immutable first responses, and two bounded phases. No default or CLI dispatch. */
import { lstat, mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { loadLocomoJudgeProfile } from "./evolution-locomo-judge";
import { openEvolutionStore, type EvolutionStore } from "./evolution-store";
import { invokeEvolutionRequest, type EvolutionCredential } from "./evolution-transport";
import { executePairedMemoryBatches } from "./paired-memory-study";
import { LOCOMO_WINDOW_LIMITS, locomoWindowOutcomeReceipt, locomoWindowResultReceipt, makeLocomoWindowJudgePlan, parseLocomoWindowScorer, parseLocomoWindowSource,
  verifyLocomoWindowPlan, type LocomoWindowJob, type LocomoWindowJudgePlan, type LocomoWindowOutcome,
  type LocomoWindowPlan, type LocomoWindowResult } from "./locomo-window-study";

const ROOT = resolve(import.meta.dir, "../..");
const CANARY_BYTES = 256 * 1024;
export type LocomoWindowLaunch = Readonly<{ protocol: "oh.locomo-window-launch.v1";
  sourcePin: EvolutionPin; scorerPin: EvolutionPin; planPin: EvolutionPin; campaignPin: EvolutionPin;
  checkpoint: string; reviewer: string; approved: true; scope: "reader-judge";
  maximumNewSpendMicros: number; maximumPhysicalCalls: number; canaryQuestionCount: 2 }>;
function fail(reason: string): never { throw new Error(`LoCoMo window launch: ${reason}.`); }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const json = (raw: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
function integer(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}
export function parseLocomoWindowLaunch(value: unknown): LocomoWindowLaunch {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "sourcePin", "scorerPin", "planPin", "campaignPin",
    "checkpoint", "reviewer", "approved", "scope", "maximumNewSpendMicros", "maximumPhysicalCalls", "canaryQuestionCount"])
    || value.protocol !== "oh.locomo-window-launch.v1" || value.scope !== "reader-judge" || value.approved !== true
    || typeof value.checkpoint !== "string" || !/^[a-f0-9]{40}$/.test(value.checkpoint)
    || typeof value.reviewer !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(value.reviewer)
    || !integer(value.maximumNewSpendMicros, LOCOMO_WINDOW_LIMITS.campaignMicros)
    || !integer(value.maximumPhysicalCalls, LOCOMO_WINDOW_LIMITS.maximumPhysicalCalls)
    || value.canaryQuestionCount !== 2) fail("reviewed launch receipt");
  return Object.freeze({ protocol: value.protocol, sourcePin: evolutionPin(value.sourcePin), scorerPin: evolutionPin(value.scorerPin),
    planPin: evolutionPin(value.planPin), campaignPin: evolutionPin(value.campaignPin), checkpoint: value.checkpoint,
    reviewer: value.reviewer, approved: true, scope: "reader-judge", maximumNewSpendMicros: value.maximumNewSpendMicros,
    maximumPhysicalCalls: value.maximumPhysicalCalls, canaryQuestionCount: 2 });
}
function cleanCheckpoint(expected: string): void {
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const status = Bun.spawnSync(["git", "status", "--porcelain=v1", "--untracked-files=normal"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (head.exitCode !== 0 || status.exitCode !== 0 || head.stdout.toString().trim() !== expected || status.stdout.length !== 0) fail("reviewed clean checkpoint changed");
}
async function writePrivate(path: string, value: unknown, maximum: number): Promise<void> {
  const body = `${canonicalJson(value)}\n`; if (Buffer.byteLength(body) > maximum) fail("private artifact bound");
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
}
async function readPrivate(path: string, maximum: number): Promise<unknown> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum || (stat.mode & 0o077) !== 0
    || await realpath(path) !== path) fail("private artifact custody");
  const raw = await readFile(path); if (raw.length > maximum) fail("private artifact grew beyond bound"); return json(raw);
}

/** Local receipt custody only; caller has already acquired the native store lock.
 * Explicit resume can fill never-admitted jobs, never retry an occupied request. */
export async function prepareLocomoWindowAttempt(input: Readonly<{ storeDirectory: string; launchPin: EvolutionPin;
  launch: LocomoWindowLaunch; plan: LocomoWindowPlan; mode: "new" | "resume"; phase: "reader" | "judge"; readerResultPin?: EvolutionPin }>) {
  if (!["new", "resume"].includes(input.mode) || !["reader", "judge"].includes(input.phase)) fail("explicit mode and phase required");
  const { launchPin, launch, plan, phase } = input, directory = join(input.storeDirectory, `locomo-window-${phase}-v1`);
  const readerResultPin = input.readerResultPin === undefined ? null : evolutionPin(input.readerResultPin);
  if ((phase === "judge") !== (readerResultPin !== null)) fail("judge requires reader result pin; reader forbids it");
  const identity = { protocol: "oh.locomo-window-started.v1", phase, launchPin, launch, planSha256: plan.planSha256, readerResultPin };
  if (input.mode === "new") {
    await mkdir(directory, { mode: 0o700 }); if (await realpath(directory) !== directory) fail("private run directory alias");
    await writePrivate(join(directory, "started.json"), identity, 32 * 1024);
  } else {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || await realpath(directory) !== directory) fail("resume directory custody");
    if (!same(await readPrivate(join(directory, "started.json"), 32 * 1024), identity)) fail("resume identity changed");
  }
  const files = await readdir(directory), pattern = /^attempt-0[0-7]\.(?:started|canary|result)\.json$/;
  if (files.some(name => name !== "started.json" && !pattern.test(name))) fail("unexpected run artifact");
  const previous = files.filter(name => /^attempt-0[0-7]\.started\.json$/.test(name)).sort();
  if (previous.length >= LOCOMO_WINDOW_LIMITS.attempts || previous.some((name, index) => name !== `attempt-${String(index).padStart(2, "0")}.started.json`)) fail("attempt limit or sequence");
  for (const name of files.filter(name => name !== "started.json")) {
    const index = Number(name.slice(8, 10)); if (index >= previous.length) fail("orphan attempt artifact");
    const value = await readPrivate(join(directory, name), name.endsWith(".started.json") ? 32 * 1024
      : name.endsWith(".canary.json") ? CANARY_BYTES : LOCOMO_WINDOW_LIMITS.resultBytes);
    const firstMode = index === 0 && isPlainRecord(value) && value.mode === "new" ? "new" : "resume";
    if (name.endsWith(".started.json") && (!isPlainRecord(value)
      || !same(value, { protocol: "oh.locomo-window-attempt.v1", phase, attempt: index, mode: firstMode, launchPin, planSha256: plan.planSha256 }))) fail("attempt identity changed");
  }
  const attempt = previous.length, prefix = join(directory, `attempt-${String(attempt).padStart(2, "0")}`);
  await writePrivate(`${prefix}.started.json`, { protocol: "oh.locomo-window-attempt.v1", phase, attempt, mode: input.mode, launchPin, planSha256: plan.planSha256 }, 32 * 1024);
  return Object.freeze({ directory, attempt, prefix });
}

/** Finalize only already-captured verifiable bytes. The unknown first dispatch
 * remains charged and blocks further admission; no network occurs in recovery. */
export function collectLocomoWindowOutcomes(jobs: readonly LocomoWindowJob[], store: EvolutionStore): readonly LocomoWindowOutcome[] {
  return Object.freeze(jobs.map(job => {
    let entry = store.lookup(job.request, job.repeat);
    if (entry.kind === "occupied" && entry.status === "captured") {
      try { store.finalize(job.request, job.repeat); } catch { /* Preserve the complete original reservation. */ }
      entry = store.lookup(job.request, job.repeat);
    }
    if (entry.kind === "hit") return { jobKey: job.key, disposition: entry.result.status, response: entry.result,
      failure: null, chargeMicros: entry.result.usage.micros, serviceMs: store.readServiceMs(job.request, job.repeat) };
    if (entry.kind === "miss") return { jobKey: job.key, disposition: "unattempted" as const, response: null, failure: null, chargeMicros: 0, serviceMs: null };
    return { jobKey: job.key, disposition: "unresolved" as const, response: null,
      failure: store.readAttemptFailure(job.request, job.repeat), chargeMicros: job.request.reservationMicros,
      serviceMs: entry.status === "captured" ? store.readServiceMs(job.request, job.repeat) : null };
  }));
}
function assertLedgerCoverage(outcomes: readonly LocomoWindowOutcome[], store: EvolutionStore): void {
  const ledger = store.summary();
  if (new Set(outcomes.map(row => row.jobKey)).size !== outcomes.length
    || ledger.calls !== outcomes.filter(row => row.disposition !== "unattempted").length
    || ledger.exposureMicros !== outcomes.reduce((sum, row) => sum + row.chargeMicros, 0)
    || ledger.unresolvedMicros !== outcomes.filter(row => row.disposition === "unresolved").reduce((sum, row) => sum + row.chargeMicros, 0)) fail("unexplained native ledger jobs or exposure");
}

/** Reuse the established four-wide stop/drain loop. Authenticated model failures
 * are retained zero-score observations; transport/custody failures stop admission. */
export async function executeLocomoWindowJobs(jobs: readonly LocomoWindowJob[],
  invoke: (job: LocomoWindowJob, stopped: () => boolean) => Promise<unknown>, stopped: () => boolean = () => false): Promise<boolean> {
  return executePairedMemoryBatches(jobs, async (job, halted) => { await invoke(job, halted); return { status: "completed" }; }, stopped);
}
async function phase(jobs: readonly LocomoWindowJob[], store: EvolutionStore, credential: EvolutionCredential, stopped: () => boolean) {
  const outcomes = collectLocomoWindowOutcomes(jobs, store);
  if (outcomes.some(row => row.disposition === "unresolved")) return false;
  return executeLocomoWindowJobs(jobs.filter((_, index) => outcomes[index]!.disposition === "unattempted"),
    (job, stopped) => invokeEvolutionRequest({ request: job.request, repeat: job.repeat, store, credential, stopped }), stopped);
}

async function pinnedStudy(input: EvolutionPin) {
  const launchPin = evolutionPin(input), launch = parseLocomoWindowLaunch(json(await readEvolutionPin(launchPin, 32 * 1024)));
  const authority = await verifyEvolutionCampaign(launch.campaignPin), campaign = authority.campaign;
  if (campaign.additionalBudgetMicros > launch.maximumNewSpendMicros || campaign.maximumCalls > launch.maximumPhysicalCalls) fail("campaign exceeds launch bounds");
  const source = parseLocomoWindowSource(json(await readEvolutionPin(launch.sourcePin, LOCOMO_WINDOW_LIMITS.sourceBytes)));
  await readEvolutionPin(launch.scorerPin, LOCOMO_WINDOW_LIMITS.sourceBytes);
  const plan = verifyLocomoWindowPlan(json(await readEvolutionPin(launch.planPin, LOCOMO_WINDOW_LIMITS.planBytes)), {
    source, sourcePin: launch.sourcePin, scorerPin: launch.scorerPin, campaignPin: launch.campaignPin, campaign });
  if (plan.maximumReservationMicros > launch.maximumNewSpendMicros || plan.maximumPhysicalCalls > launch.maximumPhysicalCalls) fail("complete bound exceeds launch");
  return { launchPin, launch, authority, campaign, source, plan, rubric: await loadLocomoJudgeProfile() };
}
function resultOf(phase: LocomoWindowResult["phase"], plan: LocomoWindowPlan, readerOutcomes: readonly LocomoWindowOutcome[],
  judge: LocomoWindowJudgePlan | null, judgeOutcomes: readonly LocomoWindowOutcome[], halt: LocomoWindowResult["halt"],
  ledger: LocomoWindowResult["ledger"]): LocomoWindowResult {
  const payload = { protocol: "oh.locomo-window-result.v1" as const, phase, planSha256: plan.planSha256, scorerSha256: plan.scorerPin.sha256,
    readerOutcomes, judgePlanSha256: judge?.judgePlanSha256 ?? null, judgeCases: judge?.judgeCases ?? [], judgeJobs: judge?.judgeJobs ?? [],
    judgeOutcomes, halt, ledger };
  return { ...payload, resultSha256: locomoWindowResultReceipt(payload).resultSha256 };
}
function complete(outcomes: readonly LocomoWindowOutcome[]) {
  return outcomes.every(row => row.disposition !== "unattempted" && row.disposition !== "unresolved");
}
async function verifyReaderResult(pin: EvolutionPin, plan: LocomoWindowPlan, outcomes: readonly LocomoWindowOutcome[], store: EvolutionStore) {
  if (!complete(outcomes)) fail("judge requires every reader attempted and resolved");
  const current = store.summary(), exposure = outcomes.reduce((sum, row) => sum + row.chargeMicros, 0);
  const ledger = { ...current, calls: outcomes.length, exposureMicros: exposure, confirmedMicros: exposure, unresolvedMicros: 0,
    combinedExposureMicros: current.historicalExposureMicros + exposure };
  if (!same(json(await readEvolutionPin(pin, LOCOMO_WINDOW_LIMITS.resultBytes)),
    locomoWindowResultReceipt(resultOf("reader", plan, outcomes, null, [], "none", ledger)))) fail("reader receipt does not match settled native evidence");
}

/** Root owns review, the concrete roster, selected OIDC credential, and task-wide
 * budget. Each phase closes the native store before its caller receives a receipt. */
export async function runLocomoWindowStudy(input: Readonly<{ launchPin: EvolutionPin; token: string; mode: "new" | "resume";
  phase: "reader" | "judge"; readerResultPin?: EvolutionPin }>) {
  if (!["reader", "judge"].includes(input.phase) || !["new", "resume"].includes(input.mode)
    || (input.phase === "judge") !== (input.readerResultPin !== undefined)) fail("explicit phase, mode and reader receipt required");
  const { launchPin, launch, authority, campaign, source, plan, rubric } = await pinnedStudy(input.launchPin);
  cleanCheckpoint(launch.checkpoint);
  const store = await openEvolutionStore({ directory: campaign.storeDirectory, campaign });
  let interrupted = false; const stop = () => { interrupted = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    let readerOutcomes = collectLocomoWindowOutcomes(plan.readerJobs, store);
    if (input.phase === "reader") {
      assertLedgerCoverage(readerOutcomes, store);
      if (input.mode === "new" && store.summary().calls !== 0) fail("new reader run requires unused native store");
    } else {
      await verifyReaderResult(input.readerResultPin!, plan, readerOutcomes, store);
      if (input.mode === "new" && store.summary().calls !== readerOutcomes.length) fail("new judge phase already has occupied judge jobs");
    }
    const { directory, attempt, prefix } = await prepareLocomoWindowAttempt({ storeDirectory: campaign.storeDirectory, launchPin, launch, plan,
      mode: input.mode, phase: input.phase, ...(input.readerResultPin === undefined ? {} : { readerResultPin: input.readerResultPin }) });
    let halt: LocomoWindowResult["halt"] = "none", judge: LocomoWindowJudgePlan | null = null;
    const credential = { kind: "gateway-oidc" as const, token: input.token, auth: authority.auth };
    const canaryIds = new Set(plan.canaryQuestionIds), canaryKeys = new Set(plan.cases.filter(cell => canaryIds.has(cell.questionId)).map(cell => cell.readerJobKey));
    if (readerOutcomes.some(row => row.disposition === "unresolved")) halt = "preexisting-unresolved";
    else if (interrupted) halt = "interrupted";
    else if (input.phase === "reader") {
      cleanCheckpoint(launch.checkpoint); await readEvolutionPin(launchPin, 32 * 1024);
      const canaryJobs = plan.readerJobs.filter(job => canaryKeys.has(job.key));
      let passed = await phase(canaryJobs, store, credential, () => interrupted);
      const canaryOutcomes = collectLocomoWindowOutcomes(canaryJobs, store);
      passed = passed && canaryOutcomes.every(row => row.disposition === "completed");
      await writePrivate(`${prefix}.canary.json`, { protocol: "oh.locomo-window-canary.v1", planSha256: plan.planSha256,
        criterion: "completed-native-reader-responses-only; no-answer-quality-check", passed,
        outcomes: canaryOutcomes.map(locomoWindowOutcomeReceipt) }, CANARY_BYTES);
      if (!passed) halt = interrupted ? "interrupted" : "canary-failure";
      else if (!await phase(plan.readerJobs.filter(job => !canaryKeys.has(job.key)), store, credential, () => interrupted)) halt = interrupted ? "interrupted" : "reader-failure";
    }
    readerOutcomes = collectLocomoWindowOutcomes(plan.readerJobs, store);
    if (input.phase === "judge" && complete(readerOutcomes)) {
      // Gold enters only after all reader first responses are settled.
      const scorer = parseLocomoWindowScorer(json(await readEvolutionPin(launch.scorerPin, LOCOMO_WINDOW_LIMITS.sourceBytes)), source);
      judge = makeLocomoWindowJudgePlan(plan, scorer, readerOutcomes, rubric);
      const priorJudges = collectLocomoWindowOutcomes(judge.judgeJobs, store);
      assertLedgerCoverage([...readerOutcomes, ...priorJudges], store);
      if (priorJudges.some(row => row.disposition === "unresolved")) halt = "preexisting-unresolved";
      if (halt === "none") {
        cleanCheckpoint(launch.checkpoint); await readEvolutionPin(launchPin, 32 * 1024);
        if (!await phase(judge.judgeJobs, store, credential, () => interrupted)) halt = interrupted ? "interrupted" : "judge-failure";
      }
    }
    const judgeOutcomes = collectLocomoWindowOutcomes(judge?.judgeJobs ?? [], store);
    assertLedgerCoverage([...readerOutcomes, ...judgeOutcomes], store);
    if (interrupted) halt = "interrupted";
    cleanCheckpoint(launch.checkpoint);
    await Promise.all([readEvolutionPin(launchPin, 32 * 1024), readEvolutionPin(launch.sourcePin, LOCOMO_WINDOW_LIMITS.sourceBytes),
      readEvolutionPin(launch.scorerPin, LOCOMO_WINDOW_LIMITS.sourceBytes), readEvolutionPin(launch.planPin, LOCOMO_WINDOW_LIMITS.planBytes),
      verifyEvolutionCampaign(launch.campaignPin)]);
    const result = resultOf(input.phase, plan, readerOutcomes, judge, judgeOutcomes, halt, store.summary());
    await writePrivate(`${prefix}.result.json`, locomoWindowResultReceipt(result), LOCOMO_WINDOW_LIMITS.resultBytes);
    return Object.freeze({ directory, attempt, resultPath: `${prefix}.result.json`, result });
  } finally {
    try { await store.close(); } finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); }
  }
}

/** Offline report trust boundary. It reconstructs every native response and
 * judge request, proves complete ledger coverage, and authenticates the exact
 * pinned judge-phase receipt. Documentation edits do not require a clean HEAD. */
export async function authenticateLocomoWindowResult(input: Readonly<{ launchPin: EvolutionPin; resultPin: EvolutionPin }>) {
  const prepared = await pinnedStudy(input.launchPin), { launch, campaign, source, plan, rubric } = prepared;
  const expected = json(await readEvolutionPin(input.resultPin, LOCOMO_WINDOW_LIMITS.resultBytes));
  const store = await openEvolutionStore({ directory: campaign.storeDirectory, campaign });
  try {
    const readerOutcomes = collectLocomoWindowOutcomes(plan.readerJobs, store);
    if (!complete(readerOutcomes)) fail("incomplete native reader matrix");
    const scorer = parseLocomoWindowScorer(json(await readEvolutionPin(launch.scorerPin, LOCOMO_WINDOW_LIMITS.sourceBytes)), source);
    const judge = makeLocomoWindowJudgePlan(plan, scorer, readerOutcomes, rubric);
    const judgeOutcomes = collectLocomoWindowOutcomes(judge.judgeJobs, store);
    if (!complete(judgeOutcomes)) fail("incomplete native judge matrix");
    assertLedgerCoverage([...readerOutcomes, ...judgeOutcomes], store);
    const result = resultOf("judge", plan, readerOutcomes, judge, judgeOutcomes, "none", store.summary());
    if (!same(expected, locomoWindowResultReceipt(result))) fail("judge receipt does not match complete native evidence");
    await Promise.all([readEvolutionPin(input.launchPin, 32 * 1024), readEvolutionPin(input.resultPin, LOCOMO_WINDOW_LIMITS.resultBytes),
      readEvolutionPin(launch.sourcePin, LOCOMO_WINDOW_LIMITS.sourceBytes), readEvolutionPin(launch.scorerPin, LOCOMO_WINDOW_LIMITS.sourceBytes),
      readEvolutionPin(launch.planPin, LOCOMO_WINDOW_LIMITS.planBytes)]);
    return Object.freeze({ launch, source, scorer, plan, rubric, result });
  } finally { await store.close(); }
}
