/** Paid entry point for the new paired protocol. No CLI/default dispatch is provided:
 * the dataset adapter must supply the exact pinned native prompt and an independently
 * reviewed launch receipt after a clean checkpoint. This module never loads gold. */
import { lstat, mkdir, open, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonicalJson, canonicalSha256, hasExactKeys, isPlainRecord } from "../../src/canonical";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { openEvolutionStore, type EvolutionStore } from "./evolution-store";
import { invokeEvolutionRequest } from "./evolution-transport";
import { collectPairedMemoryResult, executePairedMemoryBatches, pairedMemoryPublicSummary, partitionPairedMemoryCanary, PAIRED_MEMORY_LIMITS, reconcilePairedMemoryStore, verifyPairedMemoryPlan,
  type PairedMemoryJob, type PairedMemoryPlan, type PairedMemoryReader, type PairedMemoryRenderer,
  type PairedMemoryResult } from "./paired-memory-study";

const ROOT = resolve(import.meta.dir, "../..");
export type PairedMemoryLaunch = Readonly<{ protocol: "oh.memory.paired-launch.v1";
  planPin: EvolutionPin; sourcePin: EvolutionPin; promptPin: EvolutionPin; scorerPin: EvolutionPin;
  campaignPin: EvolutionPin; checkpoint: string; reviewer: string; approved: true;
  scope: "reader-only"; maximumNewSpendMicros: number; maximumPhysicalCalls: number; canaryQuestionCount: 2 }>;
function fail(reason: string): never { throw new Error(`Paired memory launch: ${reason}.`); }
function json(raw: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
function equal(a: unknown, b: unknown): boolean { return canonicalJson(a) === canonicalJson(b); }

export function parsePairedMemoryLaunch(value: unknown): PairedMemoryLaunch {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "planPin", "sourcePin", "promptPin", "scorerPin", "campaignPin", "checkpoint", "reviewer", "approved", "scope", "maximumNewSpendMicros", "maximumPhysicalCalls", "canaryQuestionCount"])
    || value.protocol !== "oh.memory.paired-launch.v1" || value.approved !== true || value.scope !== "reader-only"
    || typeof value.checkpoint !== "string" || !/^[a-f0-9]{40}$/.test(value.checkpoint)
    || typeof value.reviewer !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(value.reviewer)
    || typeof value.maximumNewSpendMicros !== "number" || !Number.isSafeInteger(value.maximumNewSpendMicros)
    || value.maximumNewSpendMicros < 1 || value.maximumNewSpendMicros > PAIRED_MEMORY_LIMITS.campaignMicros
    || typeof value.maximumPhysicalCalls !== "number" || !Number.isSafeInteger(value.maximumPhysicalCalls)
    || value.maximumPhysicalCalls < 1 || value.maximumPhysicalCalls > 1800 || value.canaryQuestionCount !== 2) fail("invalid reviewed launch receipt");
  return Object.freeze({ protocol: value.protocol, planPin: evolutionPin(value.planPin), sourcePin: evolutionPin(value.sourcePin),
    promptPin: evolutionPin(value.promptPin), scorerPin: evolutionPin(value.scorerPin), campaignPin: evolutionPin(value.campaignPin),
    checkpoint: value.checkpoint, reviewer: value.reviewer, approved: true, scope: "reader-only",
    maximumNewSpendMicros: value.maximumNewSpendMicros, maximumPhysicalCalls: value.maximumPhysicalCalls, canaryQuestionCount: 2 });
}

function cleanCheckpoint(expected: string): void {
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const status = Bun.spawnSync(["git", "status", "--porcelain=v1", "--untracked-files=normal"], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  if (head.exitCode !== 0 || status.exitCode !== 0 || head.stdout.toString().trim() !== expected || status.stdout.length !== 0) fail("reviewed clean code checkpoint changed");
}
async function writePrivate(path: string, value: unknown, maximum: number): Promise<void> {
  const encoded = `${canonicalJson(value)}\n`;
  if (Buffer.byteLength(encoded) > maximum) fail("private artifact bound");
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(encoded); await file.sync(); } finally { await file.close(); }
}
async function readPrivate(path: string, maximum: number): Promise<unknown> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximum || (stat.mode & 0o077) !== 0
    || await realpath(path) !== path) fail("private artifact type, alias, mode or bound");
  const raw = await readFile(path);
  if (raw.length > maximum) fail("private artifact grew beyond bound");
  return json(raw);
}

/** Each batch finishes before another can be admitted. The first bad/unknown response
 * closes admission immediately; already admitted first attempts are captured and drained. */
async function phase(jobs: readonly PairedMemoryJob[], store: EvolutionStore,
  credential: Parameters<typeof invokeEvolutionRequest>[0]["credential"], stopped: () => boolean): Promise<boolean> {
  return executePairedMemoryBatches(jobs, async (job, stopped) =>
    (await invokeEvolutionRequest({ request: job.request, repeat: job.repeat, store, credential, stopped })).result, stopped);
}

/** Local artifact custody only, exported to exercise interrupted/stale-started handling
 * without provider access. The live entry point first locks/verifies the native store. */
export async function preparePairedMemoryAttempt(input: Readonly<{ storeDirectory: string; launchPin: EvolutionPin;
  launch: PairedMemoryLaunch; plan: PairedMemoryPlan; mode: "new" | "resume" }>) {
  if (!["new", "resume"].includes(input.mode)) fail("explicit new or resume mode required");
  const { launchPin, launch, plan } = input, directory = join(input.storeDirectory, "paired-memory-run-v1"), planSha256 = canonicalSha256(plan);
  const identity = { protocol: "oh.memory.paired-started.v1", launchPin,
    launch, planSha256, maximumReservationMicros: plan.maximumReservationMicros, maximumPhysicalCalls: plan.maximumPhysicalCalls };
  if (input.mode === "new") {
    await mkdir(directory, { mode: 0o700 });
    if (await realpath(directory) !== directory) fail("private run directory alias");
    await writePrivate(join(directory, "started.json"), identity, 32 * 1024);
  } else {
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || await realpath(directory) !== directory) fail("resume private directory bounds");
    if (!equal(await readPrivate(join(directory, "started.json"), 32 * 1024), identity)) fail("resume identity changed");
  }
  const files = await readdir(directory);
  if (files.some(name => name !== "started.json" && !/^attempt-0[0-7]\.(?:started|canary|result|summary)\.json$/.test(name))) fail("unrecognized run artifact");
  const previous = files.filter(name => /^attempt-0[0-7]\.started\.json$/.test(name)).sort();
  if (previous.length >= PAIRED_MEMORY_LIMITS.attempts || previous.some((name, index) => name !== `attempt-${String(index).padStart(2, "0")}.started.json`)) fail("explicit attempt bound or sequence");
  for (const name of files.filter(name => name !== "started.json")) {
    const index = Number(name.slice(8, 10));
    if (index >= previous.length) fail("orphan attempt artifact");
    const value = await readPrivate(join(directory, name), name.endsWith(".result.json") || name.endsWith(".canary.json")
      ? PAIRED_MEMORY_LIMITS.resultBytes : 32 * 1024);
    const firstMode = index === 0 && isPlainRecord(value) && value.mode === "new" ? "new" : "resume";
    if (name.endsWith(".started.json") && !equal(value, { protocol: "oh.memory.paired-attempt.v1", attempt: index,
      mode: firstMode, launchPin, planSha256 })) fail("prior attempt identity changed");
  }
  const attempt = previous.length, prefix = join(directory, `attempt-${String(attempt).padStart(2, "0")}`);
  await writePrivate(`${prefix}.started.json`, { protocol: "oh.memory.paired-attempt.v1", attempt, mode: input.mode,
    launchPin, planSha256 }, 32 * 1024);
  return Object.freeze({ directory, attempt, prefix, planSha256 });
}

/** One private run directory per campaign; at most eight explicit same-identity attempts.
 * The native SQLite ledger holds bounded raw responses. Additional private artifacts
 * are immutable identity and per-attempt started/canary/result/summary receipts: <=32.6 MiB.
 * Campaign ancestry and this plan's complete upper bound are checked before dispatch.
 * An operator/root still owns the $25 task-wide total; this campaign cannot exceed $20. */
export async function runPairedMemoryStudy(input: Readonly<{ launchPin: EvolutionPin;
  renderMessages: PairedMemoryRenderer; readerProfile: PairedMemoryReader; token: string; mode: "new" | "resume" }>) {
  if (!["new", "resume"].includes(input.mode)) fail("explicit new or resume mode required");
  const launchPin = evolutionPin(input.launchPin), launch = parsePairedMemoryLaunch(json(await readEvolutionPin(launchPin, 32 * 1024)));
  cleanCheckpoint(launch.checkpoint);
  const verified = await verifyEvolutionCampaign(launch.campaignPin), campaign = verified.campaign;
  if (campaign.additionalBudgetMicros > launch.maximumNewSpendMicros || campaign.maximumCalls > launch.maximumPhysicalCalls) fail("campaign exceeds reviewed launch");
  const source = json(await readEvolutionPin(launch.sourcePin, PAIRED_MEMORY_LIMITS.sourceBytes));
  await readEvolutionPin(launch.promptPin); await readEvolutionPin(launch.scorerPin);
  const plan = verifyPairedMemoryPlan(json(await readEvolutionPin(launch.planPin, PAIRED_MEMORY_LIMITS.planBytes)), {
    source, sourcePin: launch.sourcePin, promptPin: launch.promptPin, scorerPin: launch.scorerPin,
    campaignPin: launch.campaignPin, campaign, readerProfile: input.readerProfile, renderMessages: input.renderMessages,
  });
  for (const role of ["sourcePin", "promptPin", "scorerPin", "campaignPin"] as const) if (!equal(plan[role], launch[role])) fail("launch role pin differs from plan");
  if (plan.questionIds.length < 2 || plan.maximumReservationMicros > launch.maximumNewSpendMicros
    || plan.maximumPhysicalCalls > launch.maximumPhysicalCalls) fail("canary size or complete reservation");
  const store = await openEvolutionStore({ directory: campaign.storeDirectory, campaign });
  let interrupted = false;
  const stopAdmission = () => { interrupted = true; };
  process.on("SIGINT", stopAdmission); process.on("SIGTERM", stopAdmission);
  try {
    if (input.mode === "new" && store.summary().calls !== 0) fail("new run requires a never-used campaign store");
    const { directory, attempt, prefix, planSha256 } = await preparePairedMemoryAttempt({ storeDirectory: campaign.storeDirectory,
      launchPin, launch, plan, mode: input.mode });
    // Every occupied physical key is reconciled before any new admissions, including resumed runs.
    const before = reconcilePairedMemoryStore(plan, store);
    let halt: PairedMemoryResult["halt"] = "none";
    if (before.blocked) halt = "preexisting-unresolved";
    else if (interrupted) halt = "interrupted";
    else {
      const credential = { kind: "gateway-oidc" as const, token: input.token, auth: verified.auth };
      const { canary: canaryJobs, remainder } = partitionPairedMemoryCanary(plan);
      const misses = new Set(before.unissued.map(job => job.key));
      const priorCanaryFailure = canaryJobs.some(job => {
        const entry = store.lookup(job.request, job.repeat);
        return entry.kind === "hit" && entry.result.status !== "completed";
      });
      cleanCheckpoint(launch.checkpoint); await readEvolutionPin(launchPin, 32 * 1024);
      const passed = !priorCanaryFailure && await phase(canaryJobs.filter(job => misses.has(job.key)), store, credential, () => interrupted);
      const canary = collectPairedMemoryResult(plan, store, passed ? "none" : "canary-failure");
      await writePrivate(`${prefix}.canary.json`, { protocol: "oh.memory.paired-canary.v1", planSha256,
        questionCount: 2, logicalCases: 12, physicalJobs: canaryJobs.length, passed, criterion: "all-native-responses-completed; no-answer-correctness-check",
        result: canary }, PAIRED_MEMORY_LIMITS.resultBytes);
      if (!passed) halt = interrupted ? "interrupted" : "canary-failure";
      else {
        cleanCheckpoint(launch.checkpoint); await readEvolutionPin(launchPin, 32 * 1024);
        if (!await phase(remainder.filter(job => misses.has(job.key)), store, credential, () => interrupted)) halt = interrupted ? "interrupted" : "reader-failure";
      }
    }
    let result = collectPairedMemoryResult(plan, store, halt);
    if (halt === "none" && result.outcomes.some(outcome => outcome.disposition !== "completed")) {
      halt = "reader-failure"; result = collectPairedMemoryResult(plan, store, halt);
    }
    const summary = pairedMemoryPublicSummary(plan, result);
    await writePrivate(`${prefix}.result.json`, result, PAIRED_MEMORY_LIMITS.resultBytes);
    await writePrivate(`${prefix}.summary.json`, summary, 32 * 1024);
    return Object.freeze({ directory, attempt, result, summary });
  } finally {
    try { await store.close(); }
    finally { process.off("SIGINT", stopAdmission); process.off("SIGTERM", stopAdmission); }
  }
}
