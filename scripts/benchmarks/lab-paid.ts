import { parseArgs } from "node:util";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, selectQuestions, selectSplit, type DatasetName } from "./datasets";
import { ROOT, codeIdentity, loadDataset, writeJson } from "./io";
import { labVariants, type LabSystem } from "./lab";
import { verifyPinnedLabPaidBudgetInput } from "./lab-paid-budget";
import type { LabReaderPolicy } from "./lab-paid-reader";
import { openLabPaidCache } from "./lab-paid-cache";
import { executeLabPaidPhase } from "./lab-paid-executor";
import { makeLabPaidReaderPlan, makeLabPaidJudgePlan, scoreLabPaidJudgePlan, validateLabPaidReaderPlan,
  type LabPaidReaderPlan, type LabPaidScoredCase } from "./lab-paid-plan";
import { GATEWAY_STUDY_PROFILES, GatewayStudyBudget, gatewayStudyLedgerExposure } from "./gateway-study-transport-v3";
import { GATEWAY_READER_FAILURE_V6_POLICY_SHA256 } from "./gateway-study-transport-v6";
import { readGatewayStudyFile } from "./gateway-study-store-v3";
import { qualifyGatewayOIDC } from "./gateway-study-v3";
import { loadJudgeProfile } from "./judge";
import { pairedBootstrap } from "./metrics";

const PROFILE = "oh.memory-development-paid.v1" as const;
const CACHE = resolve(ROOT, ".cache/benchmarks/lab-paid");
type Pin = Readonly<{ path: string; sha256: string }>;
type Code = Awaited<ReturnType<typeof codeIdentity>>;
type Plan = Readonly<{ profile: typeof PROFILE; createdAt: string; cacheDirectory: string;
  dataset: "locomo" | "longmemeval-s"; datasetSha256: string; split: "dev"; seed: 17; limit: number;
  selectedQuestions: readonly string[]; selectedGroups: readonly string[]; selectionSha256: string;
  budgetInput: Pin; budgetFingerprint: string; source: Code; namespaceSha256: string;
  reader: LabPaidReaderPlan }>;
function fail(message: string): never { throw new Error(`Paid lab: ${message}.`); }
function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function integer(value: string | undefined, fallback: number, maximum: number): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) fail("invalid numeric bound");
  return n;
}
async function occupied(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function readPinned(pin: Pin, maximum = 64 * 1024 * 1024): Promise<unknown> {
  if (resolve(pin.path) !== pin.path || await realpath(pin.path) !== pin.path || !digest(pin.sha256)) fail("invalid canonical pin");
  const raw = await readGatewayStudyFile(pin.path, maximum);
  if (sha256Hex(raw) !== pin.sha256) fail("pinned bytes changed");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
}
function namespaceWithJudge(verification: Awaited<ReturnType<typeof verifyPinnedLabPaidBudgetInput>>, budgetDescriptor: Pin, judgeProfileSha256: string) {
  return canonicalSha256({ profile: "oh.lab-paid-cache-namespace.v1", auth: verification.auth,
    budgetDescriptorSha256: budgetDescriptor.sha256, cacheProfile: "oh.memory-gateway-lab-cache.v1",
    transport: "oh.memory-gateway-transport.v6", readerPolicy: GATEWAY_READER_FAILURE_V6_POLICY_SHA256,
    profiles: GATEWAY_STUDY_PROFILES, judgeProfileSha256 });
}
async function namespace(verification: Awaited<ReturnType<typeof verifyPinnedLabPaidBudgetInput>>, budgetDescriptor: Pin) {
  return namespaceWithJudge(verification, budgetDescriptor, (await loadJudgeProfile()).sha256);
}
function planValue(value: unknown): Plan {
  const keys = ["profile", "createdAt", "cacheDirectory", "dataset", "datasetSha256", "split", "seed", "limit",
    "selectedQuestions", "selectedGroups", "selectionSha256", "budgetInput", "budgetFingerprint", "source", "namespaceSha256", "reader"];
  if (!isPlainRecord(value) || !hasExactKeys(value, keys) || value.profile !== PROFILE || value.cacheDirectory !== CACHE
    || value.dataset !== "locomo" && value.dataset !== "longmemeval-s" || value.split !== "dev" || value.seed !== 17
    || !Number.isSafeInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 100
    || !Array.isArray(value.selectedQuestions) || value.selectedQuestions.length > 100
    || !Array.isArray(value.selectedGroups) || value.selectedGroups.length > 100
    || !digest(value.datasetSha256) || !digest(value.selectionSha256) || !digest(value.budgetFingerprint) || !digest(value.namespaceSha256)
    || !isPlainRecord(value.source) || !digest(value.source.sourceSha256) || !isPlainRecord(value.reader)
    || !isPlainRecord(value.budgetInput) || !hasExactKeys(value.budgetInput, ["path", "sha256"])
    || typeof value.budgetInput.path !== "string" || !digest(value.budgetInput.sha256)) fail("invalid bounded development plan");
  return value as unknown as Plan; // The reader validator and pinned dataset check every case before cache admission.
}
async function selection(name: Plan["dataset"], limit: number) {
  return selectQuestions(selectSplit(await loadDataset(name as DatasetName), "dev", 17), limit, 17);
}
export function summarizeLabPaidScores(cases: readonly LabPaidScoredCase[], variants: readonly string[]) {
  if (!cases.length || !variants.length) fail("complete nonempty score matrix required");
  const questions = [...new Set(cases.map(c => c.questionId))];
  if (cases.length !== questions.length * variants.length
    || new Set(cases.map(c => JSON.stringify([c.questionId, c.variant]))).size !== cases.length
    || cases.some(c => !variants.includes(c.variant) || c.correct !== 0 && c.correct !== 1)) fail("incomplete or duplicate score matrix");
  const byVariant = Object.fromEntries(variants.map(variant => {
    const rows = cases.filter(c => c.variant === variant);
    return [variant, { questions: rows.length, correct: rows.reduce((sum, c) => sum + c.correct, 0),
      accuracy: rows.reduce((sum, c) => sum + c.correct, 0) / rows.length,
      readerFailures: rows.filter(c => c.status === "terminal-reader-failure").length }];
  }));
  const baseline = variants[0]!;
  const pairs = Object.fromEntries(variants.slice(1).map(variant => [variant, pairedBootstrap(questions.map(questionId => {
    const left = cases.find(c => c.questionId === questionId && c.variant === baseline)!;
    const right = cases.find(c => c.questionId === questionId && c.variant === variant)!;
    if (left.groupId !== right.groupId) fail("paired group drift");
    return { cluster: left.groupId, left: left.correct, right: right.correct };
  }), 17)]));
  return { baseline, byVariant, pairedDevelopmentBootstrap: pairs, independentGroups: new Set(cases.map(c => c.groupId)).size,
    qualification: "Complete paired development scores including failures; tuning evidence, not held-out superiority. Small group counts limit intervals." };
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    help: { type: "boolean" }, paid: { type: "boolean" }, dataset: { type: "string" }, limit: { type: "string" },
    systems: { type: "string" }, "reader-policy": { type: "string" }, "top-k": { type: "string" }, "context-bytes": { type: "string" },
    "budget-input": { type: "string" }, "budget-sha256": { type: "string" }, output: { type: "string" },
    plan: { type: "string" }, "plan-sha256": { type: "string" }, "max-usd": { type: "string" },
    "max-calls": { type: "string" }, concurrency: { type: "string" } } });
  if (values.help) { console.log(`Usage: bun run bench:lab:paid prepare|run [options]
prepare --dataset locomo|longmemeval-s --limit 8 --systems bm25-window,bm25-session
  --reader-policy legacy-v1|question-last-v1
  --top-k 20 --context-bytes 24000 --budget-input PATH --budget-sha256 SHA --output PATH
run --paid --plan PATH --plan-sha256 SHA --max-usd TOTAL_AMENDMENT_CAP
  --max-calls 48 --concurrency 4 --output PATH
Preparation is offline. Run uses selected-project VERCEL_OIDC_TOKEN; no API-key fallback.
One fixed shared cache under .cache/benchmarks/lab-paid retains every first response.
All descendants count under the original $40 amendment cap; max-usd is not extra per run.
Only root may dispatch. Keep frozen runners paused; they cannot see this new cache ledger.
New output files are required. Do not retry occupied incomplete requests or reset the cache.`); return; }
  if (positionals.length !== 1 || !["prepare", "run"].includes(positionals[0]!) || !values.output) fail("select prepare/run and a new output path; see --help");
  const output = resolve(values.output);
  if (await occupied(output) || await occupied(output + ".started.json")
    || await occupied(output + ".judges.json")) fail("output already occupied");
  const allowed = positionals[0] === "prepare"
    ? new Set(["output", "dataset", "limit", "systems", "reader-policy", "top-k", "context-bytes", "budget-input", "budget-sha256"])
    : new Set(["output", "paid", "plan", "plan-sha256", "max-usd", "max-calls", "concurrency"]);
  if (Object.keys(values).some(key => !allowed.has(key))) fail("option does not apply to this action");
  if (positionals[0] === "prepare") {
    if (!values["budget-input"] || !digest(values["budget-sha256"])) fail("explicit pinned budget input required");
    const name = values.dataset ?? "longmemeval-s";
    if (name !== "locomo" && name !== "longmemeval-s") fail("development dataset required");
    const limit = integer(values.limit, 8, 100), source = await codeIdentity();
    const budgetInput = { path: resolve(values["budget-input"]), sha256: values["budget-sha256"] };
    const verified = await verifyPinnedLabPaidBudgetInput(budgetInput), namespaceSha256 = await namespace(verified, budgetInput);
    const dataset = await selection(name, limit);
    const variants = labVariants((values.systems ?? "bm25-window,bm25-session").split(",") as LabSystem[],
      [integer(values["top-k"], 20, 100)], [integer(values["context-bytes"], 24000, 4_000_000)]);
    const readerPolicy = values["reader-policy"] ?? "legacy-v1";
    if (readerPolicy !== "legacy-v1" && readerPolicy !== "question-last-v1") fail("unknown reader policy");
    const reader = await makeLabPaidReaderPlan(dataset, variants, namespaceSha256, readerPolicy as LabReaderPolicy);
    const plan: Plan = { profile: PROFILE, createdAt: new Date().toISOString(), cacheDirectory: CACHE,
      dataset: name, datasetSha256: DATASETS[name].sha256, split: "dev", seed: 17, limit,
      selectedQuestions: dataset.questions.map(q => q.id), selectedGroups: [...new Set(dataset.corpora.map(c => c.groupId))],
      selectionSha256: canonicalSha256(dataset.questions.map(q => q.id)), budgetInput, budgetFingerprint: verified.fingerprint,
      source, namespaceSha256, reader };
    await verified.recheck();
    if ((await codeIdentity()).sourceSha256 !== source.sourceSha256) fail("source changed during preparation");
    await writeJson(output, plan);
    console.log(JSON.stringify({ output, sha256: sha256Hex(await Bun.file(output).bytes()),
      questions: dataset.questions.length, cases: reader.cases.length, distinctReaderRequests: reader.jobs.length, modelCalls: 0 }));
    return;
  }
  if (values.paid !== true || !values.plan || !digest(values["plan-sha256"]) || !values["max-usd"] || !values["max-calls"]) fail("explicit --paid, pinned plan and spending/call limits required");
  const planPin = { path: resolve(values.plan), sha256: values["plan-sha256"] };
  const plan = planValue(await readPinned(planPin)), before = await codeIdentity();
  if (before.sourceSha256 !== plan.source.sourceSha256 || DATASETS[plan.dataset].sha256 !== plan.datasetSha256) fail("prepared source or dataset changed");
  const verified = await verifyPinnedLabPaidBudgetInput(plan.budgetInput);
  if (verified.fingerprint !== plan.budgetFingerprint || await namespace(verified, plan.budgetInput) !== plan.namespaceSha256
    || plan.reader.namespaceSha256 !== plan.namespaceSha256) fail("budget or cache namespace changed");
  const dataset = await selection(plan.dataset, plan.limit);
  if (canonicalSha256(dataset.questions.map(q => q.id)) !== plan.selectionSha256
    || canonicalSha256(dataset.questions.map(q => q.id)) !== canonicalSha256(plan.selectedQuestions)
    || canonicalSha256([...new Set(dataset.corpora.map(c => c.groupId))]) !== canonicalSha256(plan.selectedGroups)) fail("selection changed");
  validateLabPaidReaderPlan(dataset, plan.reader);
  const maxUsd = Number(values["max-usd"]), maxCalls = integer(values["max-calls"], 48, 10_000), concurrency = integer(values.concurrency, 4, 12);
  if (!Number.isFinite(maxUsd) || maxUsd > 40 || maxUsd <= 0) fail("total amendment cap must be at most $40");
  await mkdir(CACHE, { recursive: true, mode: 0o700 });
  const cache = await openLabPaidCache({ directory: CACHE, namespaceSha256: plan.namespaceSha256 });
  let stopped = false;
  const stop = () => { stopped = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const startedAt = new Date().toISOString(), started = performance.now();
  let budget: GatewayStudyBudget | undefined, readerResult: Awaited<ReturnType<typeof executeLabPaidPhase>> | undefined;
  let judgeResult: Awaited<ReturnType<typeof executeLabPaidPhase>> | undefined;
  let scores: readonly LabPaidScoredCase[] | undefined, failure: string | null = null;
  try {
    budget = new GatewayStudyBudget({ maxUsd, maxCalls, priorExposureMicros: verified.priorExposureMicros + cache.exposure });
    await writeJson(output + ".started.json", { profile: PROFILE, startedAt, pid: process.pid, planPin,
      namespaceSha256: plan.namespaceSha256, budget: budget.summary, concurrency });
    const oidcToken = process.env.VERCEL_OIDC_TOKEN ?? "";
    const options = { cache, budget, concurrency, oidcToken,
      qualify: () => { qualifyGatewayOIDC(oidcToken, verified.auth); }, stopped: () => stopped };
    readerResult = await executeLabPaidPhase({ ...options, requests: plan.reader.jobs.map(j => j.request) });
    if (readerResult.complete) {
      const judges = await makeLabPaidJudgePlan(dataset, plan.reader, readerResult.responses);
      if (namespaceWithJudge(verified, plan.budgetInput, judges.judgeProfileSha256) !== plan.namespaceSha256) fail("judge policy changed before dispatch");
      await writeJson(output + ".judges.json", judges);
      judgeResult = await executeLabPaidPhase({ ...options, requests: judges.jobs.map(j => j.request) });
      if (judgeResult.complete) scores = scoreLabPaidJudgePlan(judges, judgeResult.responses);
    }
    if (Math.round(budget.summary.accountedUsd * 1_000_000) !== verified.priorExposureMicros + gatewayStudyLedgerExposure(cache.events)) fail("shared ledger accounting differs from admission budget");
  } catch (error) { failure = error instanceof Error ? error.message : "Unknown paid-run failure"; }
  finally {
    try { await cache.close(); } catch (error) { failure = error instanceof Error ? error.message : "Cache close failed"; }
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    try { await verified.recheck();
      if (await namespace(verified, plan.budgetInput) !== plan.namespaceSha256) fail("judge policy changed during model execution");
      if ((await codeIdentity()).sourceSha256 !== before.sourceSha256) fail("source changed during model execution"); }
    catch (error) { failure = error instanceof Error ? error.message : "Final identity verification failed"; }
  }
  const phase = (value: typeof readerResult) => value === undefined ? null : ({ complete: value.complete,
    requested: value.requestedKeys.length, cached: value.cachedKeys.length, returned: value.responses.size,
    processingStarted: value.execution.startedKeys.length, pending: value.execution.pendingKeys.length,
    errors: value.execution.errors.map(e => ({ key: e.key, message: e.error instanceof Error ? e.error.message : "Unknown request failure" })) });
  const complete = failure === null && scores !== undefined;
  const report = { profile: PROFILE, status: complete ? "completed" : "incomplete", startedAt, finishedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started, planPin, namespaceSha256: plan.namespaceSha256, dataset: plan.dataset,
    selectionSha256: plan.selectionSha256, source: before, concurrency,
    readerPolicy: plan.reader.profile === "oh.lab-paid-reader-plan.v1" ? "legacy-v1" : plan.reader.readerPolicy, plannedCases: plan.reader.cases.length,
    reader: phase(readerResult), judge: phase(judgeResult), budget: budget?.summary ?? null, failure,
    scores: complete ? scores : null, summary: complete ? summarizeLabPaidScores(scores!, plan.reader.variants.map(v => v.id)) : null,
    qualification: "Only completed full matrices have scores. Processing-started counts include admission rejections; use ledger reservations for conservative request exposure. Provider aliases are not pinned snapshots. No retry of occupied requests. Frozen dispatch remains paused until this ledger is included in its budget." };
  await writeJson(output, report);
  console.log(JSON.stringify({ output, status: report.status, elapsedMs: report.elapsedMs, reader: report.reader, judge: report.judge,
    budget: report.budget, summary: report.summary, failure }, null, 2));
  if (!complete) process.exitCode = 1;
}
if (import.meta.main) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Paid lab failed."); process.exitCode = 1; });
