import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { codeIdentity, loadDataset, ROOT } from "./io";
import { DATASETS, selectQuestions, selectSplit } from "./datasets";
import { loadReservedReaderDataset, RESERVED_READER_QUALIFICATION } from "./lab-reserved-evaluation";
import { qualifyGatewayOIDC } from "./gateway-study-v3";
import { readGatewayStudyFile, writeGatewayStudyJson } from "./gateway-study-store-v3";
import { verifyPinnedLabPaidBudgetInput } from "./lab-paid-budget";
import { runLabPaidQueue } from "./lab-paid-queue";
import { pairedBootstrap } from "./metrics";
import type { LabPaidReaderPlan } from "./lab-paid-plan";
import type { LabGpt5MiniReaderProfileSelector, LabReaderResult } from "./lab-reader-profile";
import { labReaderProfileLedgerExposure, openLabReaderProfileCustody } from "./lab-reader-profile-custody";
import { reserveReaderJudge, parseReaderJudge, type LabReaderJudgeRequest, type LabReaderJudgeResult } from "./lab-reader-profile-judge";
import { invokeLabReaderJudge } from "./lab-reader-profile-transport-union";
import { replayLegacyLabPaidJudge } from "./lab-reader-profile-legacy-judge";
import { makeLabReaderProfilePlan, validateLabReaderProfilePlan, type LabReaderProfileVariantPair } from "./lab-reader-profile-plan";
import { makeLabReaderProfileJudgePlan, scoreLabReaderProfileJudgePlan } from "./lab-reader-profile-scoring";

const PROTOCOL = "oh.memory.lab-reader-profile-run.v1" as const;
const QUALIFICATION = "Fixed seed-17, 100-question LongMemEval development comparison. GPT-5 mini/OpenAI Gateway alias with minimal reasoning and 2048 output tokens; unchanged parent retrieval and messages. Frozen GPT-4o judge; reader length failures remain in the denominator. Reuse only byte-identical cached judgments. Timing excludes preparation, authentication and initial preflight. No held-out or superiority claim.";
const qualification = (profile: LabGpt5MiniReaderProfileSelector | undefined, evaluation?: "reserved-100-v1") => evaluation === "reserved-100-v1" ? RESERVED_READER_QUALIFICATION : profile === "medium"
  ? QUALIFICATION.replace("minimal reasoning and 2048 output tokens", "medium reasoning and 8192 output tokens (including reasoning)") : QUALIFICATION;
export type LabReaderProfilePin = Readonly<{ path: string; sha256: string }>;
export type LabReaderProfileRunConfig = Readonly<{ budgetPin: LabReaderProfilePin; parentPin: LabReaderProfilePin;
  legacyDirectory: string; legacyLedger: LabReaderProfilePin & Readonly<{ bytes: number }>;
  evaluation?: "reserved-100-v1"; readerProfile?: LabGpt5MiniReaderProfileSelector; variantPair?: LabReaderProfileVariantPair; directory: string; output: string; planPath: string; maxUsd: number; maxCalls: number; concurrency: number }>;
type Command = Readonly<{ mode: "prepare"; configPin: LabReaderProfilePin }>
  | Readonly<{ mode: "run"; configPin: LabReaderProfilePin; paid: true; planSha256: string; maxUsd: number }>;
type Runtime = Readonly<{ oidcToken: string; fetcher?: NonNullable<Parameters<typeof invokeLabReaderJudge>[0]["fetcher"]>; stopped?: () => boolean }>;
function fail(reason: string): never { throw new TypeError(`Lab reader profile run: ${reason}.`); }
function digest(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("invalid digest"); return value; }
function path(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0") || !isAbsolute(value) || resolve(value) !== value) fail("noncanonical absolute path");
  return value;
}
function integer(value: unknown, maximum: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= maximum; }
function usd(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 40 && Number.isSafeInteger(value * 1_000_000); }
function pin(value: unknown): LabReaderProfilePin {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["path", "sha256"])) fail("invalid file pin");
  return Object.freeze({ path: path(value.path), sha256: digest(value.sha256) });
}
function same(a: unknown, b: unknown, reason: string) { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); }
function inside(child: string, parent: string) { return child === parent || child.startsWith(parent + sep); }
/** The private config selects data and bounded limits, a closed reader profile, never code, credentials, arbitrary model parameters or an alternate judge. */
export function parseLabReaderProfileRunConfig(value: unknown): LabReaderProfileRunConfig {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["budgetPin", "parentPin", "legacyDirectory", "legacyLedger", "directory", "output", "planPath", "maxUsd", "maxCalls", "concurrency", ...("readerProfile" in value ? ["readerProfile"] : []), ...("variantPair" in value ? ["variantPair"] : []), ...("evaluation" in value ? ["evaluation"] : [])])
    || "evaluation" in value && value.evaluation !== "reserved-100-v1"
    || value.evaluation === "reserved-100-v1" && (value.readerProfile !== "medium" || value.variantPair !== "window-24kb-96kb" || value.maxCalls !== 400 || value.maxUsd !== 27)
    || "readerProfile" in value && value.readerProfile !== "minimal" && value.readerProfile !== "medium"
    || "variantPair" in value && value.variantPair !== "window-hybrid-24kb" && value.variantPair !== "window-24kb-96kb"
    || !usd(value.maxUsd) || !integer(value.maxCalls, 400) || !integer(value.concurrency, 12)
    || !isPlainRecord(value.legacyLedger) || !hasExactKeys(value.legacyLedger, ["path", "sha256", "bytes"])
    || typeof value.legacyLedger.bytes !== "number" || !Number.isSafeInteger(value.legacyLedger.bytes)
    || value.legacyLedger.bytes < 0 || Object.is(value.legacyLedger.bytes, -0) || value.legacyLedger.bytes > 32 * 1024 * 1024) fail("invalid bounded config");
  const config = { budgetPin: pin(value.budgetPin), parentPin: pin(value.parentPin), legacyDirectory: path(value.legacyDirectory),
    legacyLedger: Object.freeze({ ...pin({ path: value.legacyLedger.path, sha256: value.legacyLedger.sha256 }), bytes: value.legacyLedger.bytes }),
    directory: path(value.directory), output: path(value.output), planPath: path(value.planPath), maxUsd: value.maxUsd, maxCalls: value.maxCalls, concurrency: value.concurrency,
    ...("evaluation" in value ? { evaluation: value.evaluation as "reserved-100-v1" } : {}),
    ...("readerProfile" in value ? { readerProfile: value.readerProfile as LabGpt5MiniReaderProfileSelector } : {}),
    ...("variantPair" in value ? { variantPair: value.variantPair as LabReaderProfileVariantPair } : {}) };
  if (config.legacyLedger.path !== join(config.legacyDirectory, "ledger.jsonl")) fail("legacy ledger path binding");
  const outputs = [config.planPath, config.output, ...[".started.json", ".readers.json", ".judges.json"].map(suffix => config.output + suffix)];
  const files = [config.budgetPin.path, config.parentPin.path, config.legacyLedger.path, ...outputs];
  if (new Set(files).size !== files.length || files.some(p => inside(p, config.directory))
    || inside(config.directory, config.legacyDirectory) || inside(config.legacyDirectory, config.directory)
    || outputs.some(p => inside(p, config.legacyDirectory)) || files.some(p => inside(config.directory, p))) fail("overlapping input or output paths");
  return Object.freeze(config);
}
export function parseLabReaderProfileRunArgs(args: readonly string[]): Command {
  const mode = args[0]; if (mode !== "prepare" && mode !== "run") fail("expected prepare or run");
  const flags = new Map<string, string>(); let paid = false;
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === "--paid") { if (paid) fail("duplicate paid flag"); paid = true; continue; }
    if (!["--config", "--config-sha256", "--plan-sha256", "--max-usd"].includes(flag) || flags.has(flag)
      || args[i + 1] === undefined || args[i + 1]!.startsWith("--")) fail("unknown, duplicate or missing argument");
    flags.set(flag, args[++i]!);
  }
  const configPin = pin({ path: flags.get("--config"), sha256: flags.get("--config-sha256") });
  if (mode === "prepare") { if (paid || flags.size !== 2) fail("prepare accepts only the config pin"); return { mode, configPin }; }
  const amount = flags.get("--max-usd") ?? "";
  if (!paid || flags.size !== 4 || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount) || !usd(Number(amount))) fail("run requires paid and explicit bounded max-usd");
  return { mode, configPin, paid: true, planSha256: digest(flags.get("--plan-sha256")), maxUsd: Number(amount) };
}
async function pinnedBytes(input: LabReaderProfilePin, maximum = 32 * 1024 * 1024, bytes?: number) {
  if (await realpath(input.path) !== input.path) fail("pinned path alias");
  const raw = await readGatewayStudyFile(input.path, maximum);
  if (sha256Hex(raw) !== input.sha256 || bytes !== undefined && raw.byteLength !== bytes) fail("pinned input changed");
  return raw;
}
async function pinnedJson(input: LabReaderProfilePin, maximum?: number): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await pinnedBytes(input, maximum)));
}
async function privateDirectory(directory: string) {
  const s = await lstat(directory);
  if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o777) !== 0o700 || s.uid !== process.getuid?.() || await realpath(directory) !== directory) fail("private directory custody");
}
async function absent(file: string) {
  try { await lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  fail("occupied output or run directory");
}
async function implementationPins() {
  const modules = ["lab-reader-profile-run", "lab-reader-profile", "lab-reader-profile-custody", "lab-reader-profile-judge",
    "lab-reader-profile-transport", "lab-reserved-selection", "lab-reserved-evaluation", "lab-reader-profile-transport-union", "lab-reader-profile-legacy-judge", "lab-reader-profile-plan", "lab-reader-profile-scoring"];
  return Promise.all([...modules.map(name => ({ path: `scripts/benchmarks/${name}.ts`, file: join(import.meta.dir, `${name}.ts`) })),
    { path: "benchmarks/results/longmemeval-superiority-selection-v1.json", file: join(ROOT, "benchmarks/results/longmemeval-superiority-selection-v1.json") },
    { path: "benchmarks/profiles/longmemeval-judge-v1.json", file: join(ROOT, "benchmarks/profiles/longmemeval-judge-v1.json") }]
    .map(async entry => ({ path: entry.path, sha256: sha256Hex(await readFile(entry.file)) })));
}
export function reservedPairedOutcomes(scores: readonly { questionId: string; variant: string; correct: number }[]) {
  const ids = [...new Set(scores.map(c => c.questionId))];
  if (ids.length !== 100 || scores.length !== 200) fail("reserved complete paired matrix");
  let wins = 0, losses = 0, ties = 0;
  for (const id of ids) {
    const rows = scores.filter(c => c.questionId === id);
    const left = rows.find(c => c.variant === "bm25-window:k20:b24000");
    const right = rows.find(c => c.variant === "bm25-window:k100:b96000");
    if (rows.length !== 2 || left === undefined || right === undefined || ![left.correct, right.correct].every(c => c === 0 || c === 1)) fail("reserved paired aliases");
    if (right.correct > left.correct) wins++; else if (right.correct < left.correct) losses++; else ties++;
  }
  return { questions: 100, wins, losses, ties, differencePercentagePoints: wins - losses };
}
function ledgerEvents(raw: Uint8Array) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  if (text !== "" && !text.endsWith("\n")) fail("partial ledger line");
  const events: unknown[] = text === "" ? [] : text.slice(0, -1).split("\n").map(line => JSON.parse(line));
  const exposureMicros = labReaderProfileLedgerExposure(events);
  return { exposureMicros, newCalls: events.filter(e => (e as { kind: string }).kind === "reserved").length,
    settledCalls: events.filter(e => (e as { kind: string }).kind === "settled").length };
}

/** Test seams replace historical authority verification and dataset loading only. The CLI always uses the production defaults. */
export function createLabReaderProfileRunner(dependencies: Readonly<{ verifyBudget?: typeof verifyPinnedLabPaidBudgetInput; loadDataset?: typeof loadDataset }> = {}) {
  const verifyBudget = dependencies.verifyBudget ?? verifyPinnedLabPaidBudgetInput, load = dependencies.loadDataset ?? loadDataset;
  async function inputs(configPin: LabReaderProfilePin) {
    const fixedPin = pin(configPin), config = parseLabReaderProfileRunConfig(await pinnedJson(fixedPin, 1024 * 1024));
    if ([config.budgetPin.path, config.parentPin.path, config.legacyLedger.path, config.planPath, config.output,
      ...[".started.json", ".readers.json", ".judges.json"].map(s => config.output + s)].includes(fixedPin.path)
      || inside(fixedPin.path, config.directory)) fail("config path overlaps run roles");
    for (const directory of new Set([dirname(config.directory), dirname(config.output), dirname(config.planPath), config.legacyDirectory])) await privateDirectory(directory);
    await absent(join(config.legacyDirectory, "active.lock"));
    ledgerEvents(await pinnedBytes(config.legacyLedger, 32 * 1024 * 1024, config.legacyLedger.bytes));
    const ancestry = await verifyBudget(config.budgetPin), parent = await pinnedJson(config.parentPin);
    const reserved = config.evaluation === "reserved-100-v1";
    if (!isPlainRecord(parent) || parent.dataset !== "longmemeval-s" || parent.datasetSha256 !== DATASETS["longmemeval-s"].sha256
      || parent.split !== (reserved ? "test" : "dev") || parent.seed !== 17 || parent.limit !== 100
      || reserved && parent.evaluation !== config.evaluation || !reserved && "evaluation" in parent) fail("fixed parent dataset selection required");
    const loaded = await load("longmemeval-s");
    const locked = reserved ? await loadReservedReaderDataset(loaded) : null;
    const dataset = locked?.dataset ?? selectQuestions(selectSplit(loaded, "dev", 17), 100, 17);
    if (locked !== null) same(parent.selection, locked.selection, "reserved selection identity changed");
    if (dataset.questions.length !== 100 || canonicalSha256(dataset.questions.map(q => q.id)) !== parent.selectionSha256) fail("parent question order or count changed");
    const namespaceSha256 = canonicalSha256({ protocol: PROTOCOL, configPin: fixedPin, budgetPin: config.budgetPin, parentPin: config.parentPin });
    const reader = makeLabReaderProfilePlan(dataset, parent.reader as LabPaidReaderPlan, namespaceSha256, config.readerProfile, config.variantPair);
    return { configPin: fixedPin, config, ancestry, dataset, parent: parent.reader as LabPaidReaderPlan, namespaceSha256, reader };
  }
  async function prepare(configPin: LabReaderProfilePin) {
    const context = await inputs(configPin), { config, ancestry } = context;
    await absent(config.directory); await absent(config.planPath);
    const source = await codeIdentity(), implementation = await implementationPins();
    const plan = { protocol: PROTOCOL, configPin: context.configPin, config, budgetFingerprint: ancestry.fingerprint,
      source, implementation, namespaceSha256: context.namespaceSha256, reader: context.reader, qualification: qualification(config.readerProfile, config.evaluation) };
    await ancestry.recheck(); await pinnedBytes(context.configPin); await pinnedBytes(config.parentPin);
    await pinnedBytes(config.legacyLedger, 32 * 1024 * 1024, config.legacyLedger.bytes);
    same(await implementationPins(), implementation, "preparation implementation changed");
    same((await codeIdentity()).sourceSha256, source.sourceSha256, "preparation source changed");
    const planPin = await writeGatewayStudyJson(config.planPath, plan);
    return { status: "prepared" as const, planSha256: planPin.sha256, cases: context.reader.cases.length,
      physicalReaderJobs: context.reader.jobs.length, priorExposureMicros: ancestry.priorExposureMicros, modelCalls: 0 };
  }
  async function run(command: Extract<Command, { mode: "run" }>, runtime: Runtime) {
    if (command.paid !== true || !usd(command.maxUsd)) fail("explicit paid confirmation required");
    const context = await inputs(command.configPin), { config, ancestry, dataset, parent } = context;
    if (command.maxUsd !== config.maxUsd) fail("explicit max-usd differs from pinned config");
    const planPin = { path: config.planPath, sha256: digest(command.planSha256) }, plan = await pinnedJson(planPin);
    if (!isPlainRecord(plan) || !hasExactKeys(plan, ["protocol", "configPin", "config", "budgetFingerprint", "source", "implementation", "namespaceSha256", "reader", "qualification"])
      || !isPlainRecord(plan.source) || typeof plan.source.sourceSha256 !== "string") fail("prepared plan shape");
    for (const [a, b] of [[plan.protocol, PROTOCOL], [plan.configPin, context.configPin], [plan.config, config], [plan.budgetFingerprint, ancestry.fingerprint],
      [plan.namespaceSha256, context.namespaceSha256], [plan.reader, context.reader], [plan.qualification, qualification(config.readerProfile, config.evaluation)]]) same(a, b, "prepared plan binding");
    validateLabReaderProfilePlan(dataset, context.reader, parent);
    let stopped = false; const stop = () => { stopped = true; }; const isStopped = () => stopped || runtime.stopped?.() === true;
    const checkPins = async () => {
      await ancestry.recheck(); await pinnedBytes(context.configPin); await pinnedBytes(planPin); await pinnedBytes(config.parentPin);
      await pinnedBytes(config.legacyLedger, 32 * 1024 * 1024, config.legacyLedger.bytes); await absent(join(config.legacyDirectory, "active.lock"));
      same(await implementationPins(), plan.implementation, "implementation changed");
      same((await codeIdentity()).sourceSha256, (plan.source as { sourceSha256: string }).sourceSha256, "source changed");
    };
    const qualify = async () => {
      if (isStopped()) fail("admission stopped");
      qualifyGatewayOIDC(runtime.oidcToken, ancestry.auth); await ancestry.recheck(); await pinnedBytes(context.configPin);
      same(await implementationPins(), plan.implementation, "implementation changed before dispatch");
    };
    await checkPins(); await qualify();
    for (const file of [config.directory, config.output, ...[".started.json", ".readers.json", ".judges.json"].map(s => config.output + s)]) await absent(file);
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    const startedAt = new Date().toISOString(), began = performance.now();
    let cache: Awaited<ReturnType<typeof openLabReaderProfileCustody<LabReaderJudgeRequest, ReturnType<typeof reserveReaderJudge>, Parameters<typeof parseReaderJudge>[2], LabReaderJudgeResult>>> | undefined;
    let failure: string | null = null, scores: ReturnType<typeof scoreLabReaderProfileJudgePlan> | null = null;
    const phases: { phase: "reader" | "judge"; planned: number; completed: number; elapsedMs: number;
      legacyHits: string[]; pendingKeys: readonly string[]; failedKeys: string[] }[] = [];
    try {
      await mkdir(config.directory, { mode: 0o700 });
      await writeGatewayStudyJson(config.output + ".started.json", { startedAt, planSha256: planPin.sha256, pid: process.pid,
        maxUsd: config.maxUsd, maxCalls: config.maxCalls, concurrency: config.concurrency, priorExposureMicros: ancestry.priorExposureMicros });
      cache = await openLabReaderProfileCustody({ directory: config.directory, namespaceSha256: context.namespaceSha256, ancestry,
        maxUsd: config.maxUsd, maxCalls: config.maxCalls, reserve: reserveReaderJudge, parse: parseReaderJudge });
      async function phase(name: "reader" | "judge", jobs: readonly { key: string; request: LabReaderJudgeRequest }[]) {
        const start = performance.now(), legacyHits = new Set<string>(); await checkPins();
        const queued = await runLabPaidQueue(jobs, { concurrency: config.concurrency, stopped: isStopped, execute: async job => {
          try {
            await qualify();
            if (name === "judge" && config.evaluation === undefined) {
              if (!("phase" in job.request) || job.request.phase !== "judge") fail("judge phase mismatch");
              const old = await replayLegacyLabPaidJudge({ directory: config.legacyDirectory, ledger: config.legacyLedger, request: job.request });
              if (old.kind === "hit") { legacyHits.add(job.key); return old.result; }
            }
            return (await invokeLabReaderJudge({ request: job.request, cache: cache!, oidcToken: runtime.oidcToken, qualify,
              ...(runtime.fetcher === undefined ? {} : { fetcher: runtime.fetcher }) })).result;
          } catch (error) { stop(); throw error; }
        } });
        phases.push({ phase: name, planned: jobs.length, completed: queued.results.size, elapsedMs: performance.now() - start,
          legacyHits: jobs.filter(j => legacyHits.has(j.key)).map(j => j.key), pendingKeys: queued.pendingKeys, failedKeys: queued.errors.map(e => e.key) });
        await checkPins();
        if (queued.results.size !== jobs.length || queued.errors.length !== 0) fail("incomplete phase; first responses retained");
        return queued.results;
      }
      const readers = await phase("reader", context.reader.jobs);
      await writeGatewayStudyJson(config.output + ".readers.json", { readerPlanSha256: context.reader.planSha256, responses: [...readers] });
      const judges = await makeLabReaderProfileJudgePlan(dataset, context.reader, readers as ReadonlyMap<string, LabReaderResult>, parent);
      await writeGatewayStudyJson(config.output + ".judges.json", judges);
      const judgments = await phase("judge", judges.jobs);
      scores = scoreLabReaderProfileJudgePlan(judges, judgments);
    } catch { failure = "execution-failed"; }
    finally {
      try { await cache?.close(); await checkPins(); } catch { failure = "final-custody-failed"; }
      process.off("SIGINT", stop); process.off("SIGTERM", stop);
    }
    let accounting: ReturnType<typeof ledgerEvents> | null = null;
    try {
      accounting = ledgerEvents(await readGatewayStudyFile(join(config.directory, "ledger.jsonl"), 32 * 1024 * 1024));
      if (accounting.exposureMicros !== cache?.localExposureMicros || accounting.newCalls !== cache.newCalls
        || accounting.newCalls > config.maxCalls || ancestry.priorExposureMicros + accounting.exposureMicros > Math.floor(config.maxUsd * 1_000_000)) fail("durable accounting mismatch");
      await checkPins();
    } catch { failure = "final-accounting-failed"; }
    const complete = failure === null && scores !== null && scores.length === 200 && accounting !== null && accounting.newCalls === accounting.settledCalls;
    const variants = context.reader.variants;
    const byVariant = complete ? Object.fromEntries(variants.map(variant => { const rows = scores!.filter(c => c.variant === variant);
      return [variant, { questions: rows.length, correct: rows.reduce((sum, c) => sum + c.correct, 0), readerFailures: rows.filter(c => c.status === "terminal-reader-failure").length }]; })) : null;
    const paired = complete && config.evaluation === undefined ? pairedBootstrap(dataset.questions.map(q => { const rows = variants.map(v => scores!.find(c => c.questionId === q.id && c.variant === v)!);
      return { cluster: rows[0]!.groupId, left: rows[0]!.correct, right: rows[1]!.correct }; }), 17) : null;
    await writeGatewayStudyJson(config.output, { protocol: PROTOCOL, startedAt, finishedAt: new Date().toISOString(), elapsedMs: performance.now() - began,
      planSha256: planPin.sha256, status: complete ? "completed" : "incomplete", failure, accounting,
      exposureMicros: accounting === null ? null : ancestry.priorExposureMicros + accounting.exposureMicros,
      phases, scores: complete ? scores : null, byVariant, pairedDevelopmentBootstrap: paired,
      ...(config.evaluation === undefined ? {} : { evaluation: config.evaluation, pairedReservedOutcomes: complete ? reservedPairedOutcomes(scores!) : null }), qualification: qualification(config.readerProfile, config.evaluation) });
    return { status: complete ? "completed" as const : "incomplete" as const, planSha256: planPin.sha256, cases: complete ? scores!.length : 0,
      newCalls: accounting?.newCalls ?? null, settledCalls: accounting?.settledCalls ?? null,
      localExposureMicros: accounting?.exposureMicros ?? null, legacyHits: phases.reduce((sum, p) => sum + p.legacyHits.length, 0) };
  }
  return { prepare, run };
}

if (import.meta.main && process.argv.length === 3 && process.argv[2] === "--help") {
  console.log(`Usage: bun run bench:lab:profile prepare --config PATH --config-sha256 SHA
       bun run bench:lab:profile run --config PATH --config-sha256 SHA --paid --plan-sha256 SHA --max-usd TOTAL
The hashed private config fixes the parent/budget/legacy-ledger pins, new output paths,
maxUsd (cumulative, at most 40), maxCalls (at most 400), and concurrency (at most 12).
Optional readerProfile is minimal (default, 2048) or medium (8192 including reasoning).
Optional variantPair is window-hybrid-24kb (default) or window-24kb-96kb.
Preparation makes zero model calls. Run requires selected-project VERCEL_OIDC_TOKEN.
Default: fixed 100-question LongMemEval development sample, seed 17.
Optional evaluation reserved-100-v1 locks 100 reserved families, medium/wide pair,
400 calls and 27 USD cumulative ceiling; no historical judge reuse or development bootstrap interval.
Never retry or reset occupied first responses. Carry every previous ledger once.
See benchmarks/DEVELOPMENT.md for config fields, custody, budget and result limits.`);
} else if (import.meta.main) {
  try {
    const command = parseLabReaderProfileRunArgs(process.argv.slice(2)), runner = createLabReaderProfileRunner();
    const result = command.mode === "prepare" ? await runner.prepare(command.configPin)
      : await runner.run(command, { oidcToken: process.env.VERCEL_OIDC_TOKEN ?? "" });
    console.log(JSON.stringify(result));
    if (result.status === "incomplete") process.exitCode = 1;
  } catch { console.error(JSON.stringify({ status: "rejected", modelCalls: null })); process.exitCode = 1; }
}
