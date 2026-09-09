import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, parseLocomo, parseLongMemEval, selectQuestions } from "./datasets";
import { codeIdentity, writeJson } from "./io";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { projectEvolutionRunnerInput, selectEvolutionPartition, validateEvolutionDatasetManifest } from "./evolution-dataset";
import { EVOLUTION_PROFILES, type EvolutionProfileId, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { isEvolutionSpanVariant } from "./evolution-variants";
import { isEvolutionV3Treatment, parseEvolutionTreatment, type EvolutionTreatment } from "./evolution-treatments-v3";
import { makeEvolutionExperimentContextPlan, makeEvolutionReaderPlan, validateEvolutionReaderPlan, validateEvolutionAnyContextPlan,
  validateEvolutionContextPlanSources, type EvolutionAnyContextPlan, type EvolutionReaderPlan } from "./evolution-plan";
import { openEvolutionStore, validateEvolutionAttemptFailure, type EvolutionAttemptFailure, type EvolutionStore } from "./evolution-store";
import { invokeEvolutionRequest, type EvolutionCredential } from "./evolution-transport";
import { runLabPaidQueue } from "./lab-paid-queue";
import { loadJudgeProfile } from "./judge";
import { makeEvolutionJudgePlan, validateEvolutionJudgePlan, type EvolutionJudgePlan, type EvolutionJudgeProfileId } from "./evolution-judge";
import { buildEvolutionReport } from "./evolution-report";

export type EvolutionRunConfig = Readonly<{ protocol: "oh.memory.evolution-run.v1" | "oh.memory.evolution-run.v2" | "oh.memory.evolution-run.v3"; dataset: "longmemeval-s" | "locomo";
  datasetPin: EvolutionPin; manifestPin: EvolutionPin; campaignPin: EvolutionPin; limit: number; seed: number;
  variants: readonly EvolutionTreatment[]; readers: readonly EvolutionProfileId[];
  judge: EvolutionJudgeProfileId; directory: string; storeDirectory: string;
  concurrency: number }>;
function fail(reason: string): never { throw new TypeError(`Evolution runner: ${reason}.`); }
function positive(value: unknown, max: number): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= max; }
function path(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0") || resolve(value) !== value) fail("absolute output path required");
  return value;
}
export function parseEvolutionRunConfig(value: unknown): EvolutionRunConfig {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "dataset", "datasetPin", "manifestPin", "campaignPin", "limit", "seed",
    "variants", "readers", "judge", "directory", "storeDirectory", "concurrency"]) || !["oh.memory.evolution-run.v1", "oh.memory.evolution-run.v2", "oh.memory.evolution-run.v3"].includes(String(value.protocol))
    || !["longmemeval-s", "locomo"].includes(String(value.dataset)) || !positive(value.limit, 2000) || !positive(value.seed, 1_000_000)
    || !positive(value.concurrency, 12) || !Array.isArray(value.variants) || value.variants.length < 1 || value.variants.length > 32
    || !Array.isArray(value.readers) || value.readers.length < 1 || value.readers.length > 8
    || !["gpt4o-gateway-judge", "gpt4o-official-snapshot-judge", "gpt4o-gateway-native-rubric-judge-v1"].includes(String(value.judge))) fail("invalid explicit configuration");
  const variants = value.variants.map(parseEvolutionTreatment);
  const v3 = variants.some(isEvolutionV3Treatment);
  if (v3 !== (value.protocol === "oh.memory.evolution-run.v3")) fail("new fixed mechanisms and full history require explicit run V3");
  if (!v3 && variants.some(v => !isEvolutionV3Treatment(v) && isEvolutionSpanVariant(v)) !== (value.protocol === "oh.memory.evolution-run.v2")) fail("span treatments require explicit run V2; native-only configurations remain V1");
  const readers = value.readers.map((r: unknown) => {
    if (typeof r !== "string" || !r.endsWith("-reader") || !Object.hasOwn(EVOLUTION_PROFILES, r)) fail("invalid reader profile");
    return r as EvolutionProfileId;
  });
  if (variants.some(v => v.system === "full-history") && readers.some(r => !["gpt5-nano-reader", "gpt5-nano-medium-reader", "gpt5-nano-high-reader", "gpt5-mini-reader"].includes(r))) fail("full-history V2 requests support nano and mini only");
  if (new Set(variants.map(v => v.id)).size !== variants.length || new Set(readers).size !== readers.length) fail("duplicate variant or reader");
  if (value.limit * variants.length * readers.length > 100_000) fail("reader matrix exceeds the complete-coverage bound");
  const datasetPin = evolutionPin(value.datasetPin), manifestPin = evolutionPin(value.manifestPin), campaignPin = evolutionPin(value.campaignPin);
  const directory = path(value.directory), storeDirectory = path(value.storeDirectory);
  if (directory === storeDirectory || directory.startsWith(storeDirectory + "/") || storeDirectory.startsWith(directory + "/")) fail("run and campaign store paths overlap");
  if (datasetPin.sha256 !== DATASETS[value.dataset as "longmemeval-s" | "locomo"].sha256) fail("dataset source does not match pinned official release");
  return { protocol: value.protocol as EvolutionRunConfig["protocol"], dataset: value.dataset as "longmemeval-s" | "locomo", datasetPin, manifestPin, campaignPin,
    limit: value.limit, seed: value.seed, variants, readers, judge: value.judge as EvolutionRunConfig["judge"], directory, storeDirectory, concurrency: value.concurrency };
}
async function json(pin: EvolutionPin, maximum = 128 * 1024 * 1024): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readEvolutionPin(pin, maximum)));
}
async function configInput(pin: EvolutionPin) { return parseEvolutionRunConfig(await json(pin, 1024 * 1024)); }
async function selected(config: EvolutionRunConfig) {
  const raw = await readEvolutionPin(config.datasetPin, DATASETS[config.dataset].bytes);
  if (raw.length !== DATASETS[config.dataset].bytes) fail("dataset length changed");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  const dataset = config.dataset === "locomo" ? parseLocomo(value) : parseLongMemEval(value);
  const manifest = validateEvolutionDatasetManifest(dataset, await json(config.manifestPin));
  if (manifest.sourceSha256 !== config.datasetPin.sha256 || manifest.revision !== DATASETS[config.dataset].revision
    || manifest.dataset !== config.dataset) fail("manifest/source disagreement");
  return { dataset: selectQuestions(selectEvolutionPartition(dataset, manifest, "development"), config.limit, config.seed), manifest };
}
export const EVOLUTION_CONTEXT_SOURCE_FILES = ["scripts/benchmarks/evolution-retrieval.ts", "scripts/benchmarks/retrieval.ts",
  "scripts/benchmarks/evolution-dataset.ts", "scripts/benchmarks/evolution-plan.ts", "scripts/benchmarks/evolution-spans.ts",
  "scripts/benchmarks/evolution-variants.ts", "scripts/benchmarks/evolution-plan-v3.ts", "scripts/benchmarks/evolution-treatments-v3.ts",
  "scripts/benchmarks/evolution-spans-prototype.ts", "scripts/benchmarks/evolution-full-history.ts", "package.json", "bun.lock"] as const;
async function retrievalIdentity() {
  const source = await codeIdentity();
  const files = source.files.filter(f => f.path.startsWith("src/") || (EVOLUTION_CONTEXT_SOURCE_FILES as readonly string[]).includes(f.path));
  return canonicalSha256({ files, bun: Bun.version });
}
async function contextFor(config: EvolutionRunConfig, selection?: Awaited<ReturnType<typeof selected>>) {
  const file = join(config.directory, "contexts.json"), stat = Bun.file(file);
  if (!await stat.exists() || stat.size > 128 * 1024 * 1024) fail("missing or oversized context plan");
  const context = validateEvolutionAnyContextPlan(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await stat.bytes())) as EvolutionAnyContextPlan);
  const projected = projectEvolutionRunnerInput((selection ?? await selected(config)).dataset);
  if (context.manifestSha256 !== config.manifestPin.sha256 || context.retrievalSourceSha256 !== await retrievalIdentity()
    || canonicalSha256(context.variants) !== canonicalSha256(config.variants)
    || context.inputSha256 !== canonicalSha256(projected)
    || canonicalSha256(context.questions) !== canonicalSha256(projected.questions)) fail("prepared context source/configuration/selection mismatch");
  if (context.protocol.slice(-2) !== config.protocol.slice(-2)) fail("context plan version differs from run configuration");
  validateEvolutionContextPlanSources(context, projected);
  return context;
}
export async function prepareEvolution(configPin: EvolutionPin) {
  const config = await configInput(configPin), input = await selected(config), started = performance.now();
  const context = await makeEvolutionExperimentContextPlan({ dataset: projectEvolutionRunnerInput(input.dataset), variants: config.variants,
    manifestSha256: config.manifestPin.sha256, retrievalSourceSha256: await retrievalIdentity() });
  await readEvolutionPin(configPin); await readEvolutionPin(config.manifestPin);
  if (Buffer.byteLength(JSON.stringify(context.plan, null, 2) + "\n") > 128 * 1024 * 1024) fail("context plan exceeds 128 MiB; reduce the explicit selection or treatments");
  const contextPath = join(config.directory, "contexts.json"); await writeJson(contextPath, context.plan);
  await writeJson(join(config.directory, "preparation.json"), { protocol: "oh.memory.evolution-preparation.v1", configPin,
    contextPlanSha256: context.plan.planSha256, timing: context.timing, wallMs: performance.now() - started, modelCalls: 0 });
  return { status: "prepared", contextPath, contextFileSha256: sha256Hex(await readFile(contextPath)), contexts: context.plan.cases.length, modelCalls: 0 };
}
export async function prepareEvolutionReaders(configPin: EvolutionPin, contextPin: EvolutionPin) {
  const config = await configInput(configPin), context = await contextFor(config), pinned = await json(contextPin);
  if (canonicalSha256(context) !== canonicalSha256(pinned)) fail("context pin differs from config-bound context");
  const plan = makeEvolutionReaderPlan(context, config.readers), planPath = join(config.directory, "readers.json");
  if (Buffer.byteLength(JSON.stringify(plan, null, 2) + "\n") > 128 * 1024 * 1024) fail("reader plan exceeds 128 MiB; reduce the explicit selection or treatments");
  await writeJson(planPath, plan);
  return { status: "readers-prepared", planPath, planFileSha256: sha256Hex(await readFile(planPath)), cases: plan.cases.length,
    physicalRequests: plan.requests.length, maximumReservationMicros: plan.requests.reduce((s, r) => s + r.reservationMicros, 0), modelCalls: 0 };
}
export type EvolutionPhaseOutput = Readonly<{ protocol: "oh.memory.evolution-phase.v1"; phase: "reader" | "judge"; planSha256: string;
  responses: readonly Readonly<{ requestSha256: string; response: EvolutionResponse }>[];
  failures?: readonly EvolutionAttemptFailure[]; complete: boolean }>;
function authenticateReaderResponses(store: EvolutionStore, reader: EvolutionReaderPlan, value: unknown) {
  const { responses, failures } = evolutionPhaseAttempts(value, "reader", reader.planSha256, reader.requests);
  for (const request of reader.requests) {
    const cached = store.lookup(request), response = responses.get(request.requestSha256);
    if (failures.has(request.requestSha256)) {
      if (canonicalSha256(store.readAttemptFailure(request)) !== canonicalSha256(failures.get(request.requestSha256))) fail("failed reader does not match occupied campaign evidence");
    } else if (cached.kind !== "hit" || response === undefined || canonicalSha256(cached.result) !== canonicalSha256(response)) fail("reader receipt does not match captured campaign evidence");
  }
  return { responses, failures };
}
export async function executeEvolutionPhase(input: Readonly<{ configPin: EvolutionPin; planPin: EvolutionPin;
  phase: "reader" | "judge"; maxUsd: number; maxNewCalls: number; credential: EvolutionCredential; output: string }>) {
  const config = await configInput(input.configPin), authority = await verifyEvolutionCampaign(config.campaignPin);
  if (!Number.isSafeInteger(input.maxUsd * 1_000_000) || input.maxUsd * 1_000_000 !== authority.campaign.additionalBudgetMicros
    || !Number.isSafeInteger(input.maxNewCalls) || input.maxNewCalls < 0 || Object.is(input.maxNewCalls, -0)
    || input.maxNewCalls > 20_000) fail("explicit spending/call bound differs from campaign");
  if (input.credential.kind === "gateway-oidc" && canonicalSha256(input.credential.auth) !== canonicalSha256(authority.auth)) fail("selected OIDC identity mismatch");
  const plan = await json(input.planPin) as EvolutionReaderPlan | EvolutionJudgePlan;
  const requests = input.phase === "reader" ? validateEvolutionReaderPlan(plan as EvolutionReaderPlan, await contextFor(config)).requests : validateEvolutionJudgePlan(plan as EvolutionJudgePlan).requests;
  const planSha256 = plan.planSha256;
  if (input.phase === "reader" && ((plan as EvolutionReaderPlan).manifestSha256 !== config.manifestPin.sha256
    || canonicalSha256((plan as EvolutionReaderPlan).readerProfiles) !== canonicalSha256(config.readers))) fail("reader plan/config identity mismatch");
  if (input.phase === "judge" && (plan as EvolutionJudgePlan).profile !== config.judge) fail("judge treatment changed");
  const source = await codeIdentity(); if (source.dirty || source.bun !== "1.3.14") fail("paid execution requires clean committed Bun1.3.14 source");
  const outputPath = path(input.output);
  if ([input.configPin.path, input.planPin.path, config.datasetPin.path, config.manifestPin.path, config.campaignPin.path].includes(outputPath)
    || outputPath === config.storeDirectory || outputPath.startsWith(config.storeDirectory + "/")) fail("output overlaps pinned input or campaign store");
  await mkdir(dirname(outputPath), { mode: 0o700, recursive: true });
  const output = await open(outputPath, "wx", 0o600);
  await output.writeFile(JSON.stringify({ protocol: "oh.memory.evolution-started.v1", phase: input.phase, planSha256, sourceSha256: source.sourceSha256 }) + "\n");
  await output.sync();
  let store: EvolutionStore;
  try { store = await openEvolutionStore({ directory: config.storeDirectory, campaign: authority.campaign }); }
  catch (error) { await output.close(); throw error; }
  let stopped = false; const stop = () => { stopped = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const started = performance.now(), responses = new Map<string, EvolutionResponse>(), failures = new Map<string, EvolutionAttemptFailure>(), initial = store.summary();
  const errors: Array<{ key: string | null; error: string }> = [];
  let admissionAttempts = 0, verified = false;
  try {
    if (input.phase === "judge") await authenticatePreparedJudge(config, store, plan as EvolutionJudgePlan);
    const pending: Array<{ key: string; request: EvolutionRequest }> = [];
    for (const request of requests) {
      const cached = store.lookup(request);
      if (cached.kind === "hit") responses.set(request.requestSha256, cached.result);
      else if (cached.kind === "occupied") {
        try {
          if (cached.status !== "captured") throw new Error("unresolved");
          responses.set(request.requestSha256, store.finalize(request));
        } catch { /* The drained phase will project the occupied attempt separately from a verified response. */ }
      } else pending.push({ key: request.requestSha256, request });
    }
    const execution = await runLabPaidQueue(pending.slice(0, input.maxNewCalls), { concurrency: config.concurrency, stopped: () => stopped,
      execute: async job => {
        admissionAttempts++;
        const invoked = await invokeEvolutionRequest({ request: job.request, store, credential: input.credential, stopped: () => stopped });
        responses.set(job.key, invoked.result); return { requestSha256: job.key, status: invoked.result.status };
      } });
    // Only inspect unresolved attempts after every admitted job has drained; misses remain incomplete.
    for (const request of requests) if (!responses.has(request.requestSha256) && store.lookup(request).kind === "occupied") {
      failures.set(request.requestSha256, store.readAttemptFailure(request));
    }
    await readEvolutionPin(input.planPin, 128 * 1024 * 1024); await readEvolutionPin(input.configPin); await verifyEvolutionCampaign(config.campaignPin);
    if ((await codeIdentity()).sourceSha256 !== source.sourceSha256) fail("source changed during phase");
    errors.push(...execution.errors.filter(e => !failures.has(e.key)).map(e => ({ key: e.key, error: "first-response-or-admission-failure" })));
    verified = true;
  } catch { errors.push({ key: null, error: "phase-validation-failed" }); }
  let budget: ReturnType<EvolutionStore["summary"]> | null = null;
  try { budget = store.summary(); } catch { verified = false; errors.push({ key: null, error: "final-store-verification-failed" }); }
  const result: EvolutionPhaseOutput = { protocol: "oh.memory.evolution-phase.v1", phase: input.phase, planSha256,
    responses: requests.flatMap(r => { const response = responses.get(r.requestSha256); return response ? [{ requestSha256: r.requestSha256, response }] : []; }),
    failures: requests.flatMap(r => { const failure = failures.get(r.requestSha256); return failure ? [failure] : []; }),
    complete: verified && responses.size + failures.size === requests.length && errors.length === 0 };
  const receipt = { ...result, source, configPin: input.configPin, planPin: input.planPin, campaignSha256: authority.campaignSha256,
    admissionAttempts, errors, initialBudget: initial, budget, wallMs: performance.now() - started, interrupted: stopped, verified };
  try { await output.truncate(0); await output.write(JSON.stringify(receipt, null, 2) + "\n", 0, "utf8"); await output.sync(); }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); await output.close(); await store.close(); }
  return { status: result.complete ? "completed" : "incomplete", cases: responses.size + failures.size, verifiedResponses: responses.size,
    failedAttempts: failures.size, required: requests.length,
    admissionAttempts, errors: errors.length, budget, output: input.output };
}
export function evolutionPhaseResponses(value: unknown, phase: "reader" | "judge", planSha256: string): Map<string, EvolutionResponse> {
  if (!isPlainRecord(value) || value.protocol !== "oh.memory.evolution-phase.v1" || value.phase !== phase || value.planSha256 !== planSha256
    || value.complete !== true || !Array.isArray(value.responses)) fail("complete matching phase receipt required");
  const result = new Map<string, EvolutionResponse>();
  for (const row of value.responses) {
    if (!isPlainRecord(row) || typeof row.requestSha256 !== "string" || !isPlainRecord(row.response) || result.has(row.requestSha256)
      || row.response.requestSha256 !== row.requestSha256) fail("invalid or duplicate response identity");
    result.set(row.requestSha256, row.response as EvolutionResponse);
  }
  return result;
}
export function evolutionPhaseAttempts(value: unknown, phase: "reader" | "judge", planSha256: string, requests: readonly EvolutionRequest[]) {
  const responses = evolutionPhaseResponses(value, phase, planSha256);
  const expected = new Map(requests.map(request => [request.requestSha256, request]));
  if (expected.size !== requests.length || !isPlainRecord(value) || value.failures !== undefined && !Array.isArray(value.failures)) fail("invalid attempted-request matrix");
  const rows = (value.failures ?? []) as unknown[];
  if (rows.length > requests.length || responses.size + rows.length !== requests.length
    || [...responses.keys()].some(key => !expected.has(key))) fail("incomplete attempted-request coverage");
  const failures = new Map<string, EvolutionAttemptFailure>();
  for (const row of rows) {
    if (!isPlainRecord(row) || typeof row.requestSha256 !== "string") fail("invalid failed-attempt receipt");
    const request = expected.get(row.requestSha256);
    if (request === undefined || responses.has(row.requestSha256) || failures.has(row.requestSha256)) fail("duplicate or foreign failed attempt");
    failures.set(row.requestSha256, validateEvolutionAttemptFailure(row, request));
  }
  return { responses, failures };
}
export async function prepareEvolutionJudges(configPin: EvolutionPin, readerPlanPin: EvolutionPin, readerOutputPin: EvolutionPin) {
  const config = await configInput(configPin), selection = await selected(config), contextPlan = await contextFor(config, selection);
  const readerPlan = validateEvolutionReaderPlan(await json(readerPlanPin) as EvolutionReaderPlan, contextPlan);
  const authority = await verifyEvolutionCampaign(config.campaignPin), store = await openEvolutionStore({ directory: config.storeDirectory, campaign: authority.campaign });
  let plan: EvolutionJudgePlan;
  try {
    const attempts = authenticateReaderResponses(store, readerPlan, await json(readerOutputPin));
    plan = makeEvolutionJudgePlan({ contextPlan, readerPlan, ...attempts, dataset: selection.dataset,
      profile: config.judge, rubric: await loadJudgeProfile(), readerOutputSha256: readerOutputPin.sha256 });
  } finally { await store.close(); }
  await writeJson(join(config.directory, "judge-inputs.json"), { readerPlanPin, readerOutputPin });
  const output = join(config.directory, "judges.json"); await writeJson(output, plan);
  return { status: "judges-prepared", output, planFileSha256: sha256Hex(await readFile(output)), cases: plan.cases.length,
    physicalRequests: plan.requests.length, modelCalls: 0 };
}
async function authenticatePreparedJudge(config: EvolutionRunConfig, store: EvolutionStore, plan: EvolutionJudgePlan) {
  const file = Bun.file(join(config.directory, "judge-inputs.json"));
  if (!await file.exists() || file.size > 1024 * 1024) fail("missing judge input pins");
  const pins: unknown = JSON.parse(await file.text());
  if (!isPlainRecord(pins) || !hasExactKeys(pins, ["readerPlanPin", "readerOutputPin"])) fail("invalid judge input pins");
  const readerOutputPin = evolutionPin(pins.readerOutputPin), readerPlanPin = evolutionPin(pins.readerPlanPin);
  if (readerOutputPin.sha256 !== plan.readerOutputSha256) fail("judge reader receipt pin changed");
  const selection = await selected(config), contextPlan = await contextFor(config, selection);
  const readerPlan = validateEvolutionReaderPlan(await json(readerPlanPin) as EvolutionReaderPlan, contextPlan);
  const attempts = authenticateReaderResponses(store, readerPlan, await json(readerOutputPin));
  const expected = makeEvolutionJudgePlan({ contextPlan, readerPlan, ...attempts, dataset: selection.dataset,
    profile: config.judge, rubric: await loadJudgeProfile(), readerOutputSha256: readerOutputPin.sha256 });
  if (canonicalSha256(expected) !== canonicalSha256(plan)) fail("judge plan differs from complete authenticated reader evidence");
}
export async function reportEvolution(input: Readonly<{ configPin: EvolutionPin; readerPlanPin: EvolutionPin;
  judgePlanPin: EvolutionPin; readerOutputPin: EvolutionPin; judgeOutputPin: EvolutionPin; output: string }>) {
  const config = await configInput(input.configPin), selection = await selected(config), contextPlan = await contextFor(config, selection);
  const authority = await verifyEvolutionCampaign(config.campaignPin), store = await openEvolutionStore({ directory: config.storeDirectory, campaign: authority.campaign });
  try {
    const report = await buildEvolutionReport({ dataset: selection.dataset,
      manifestBytes: await readEvolutionPin(config.manifestPin, 128 * 1024 * 1024), manifestSha256: config.manifestPin.sha256, contextPlan,
      readerPlan: await json(input.readerPlanPin) as EvolutionReaderPlan, judgePlan: await json(input.judgePlanPin) as EvolutionJudgePlan,
      readerOutputBytes: await readEvolutionPin(input.readerOutputPin, 128 * 1024 * 1024),
      judgeOutputBytes: await readEvolutionPin(input.judgeOutputPin, 128 * 1024 * 1024), judgeOutputSha256: input.judgeOutputPin.sha256,
      loadRawResponse: async (request, response) => {
        const cached = store.lookup(request);
        if (cached.kind !== "hit" || canonicalSha256(cached.result) !== canonicalSha256(response)) fail("report does not match settled first-response evidence");
        return store.readRaw(request);
      },
      loadAttemptFailure: async request => store.readAttemptFailure(request),
      loadServiceMs: async (request, response) => {
        const cached = store.lookup(request);
        if (cached.kind !== "hit" || canonicalSha256(cached.result) !== canonicalSha256(response)) fail("report does not match settled first-response evidence");
        return store.readServiceMs(request);
      } });
    await writeJson(path(input.output), report);
    return { status: "reported", output: input.output, modelCalls: 0, budget: store.summary() };
  } finally { await store.close(); }
}

export function parseEvolutionArgs(args: readonly string[]) {
  const command = args[0];
  const extras: Record<string, readonly string[]> = { prepare: [], readers: ["context", "context-sha256"],
    "judge-plan": ["reader-plan", "reader-plan-sha256", "reader-output", "reader-output-sha256"],
    "run-reader": ["plan", "plan-sha256", "max-usd", "max-new-calls", "output"],
    "run-judge": ["plan", "plan-sha256", "max-usd", "max-new-calls", "output"],
    report: ["reader-plan", "reader-plan-sha256", "judge-plan", "judge-plan-sha256", "reader-output", "reader-output-sha256", "judge-output", "judge-output-sha256", "output"] };
  if (command === undefined || !Object.hasOwn(extras, command)) fail("unknown command");
  const allowed = ["config", "config-sha256", ...extras[command]!], flags = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--") || flags.has(flag.slice(2)) || !allowed.includes(flag.slice(2))) fail("unknown, duplicate or missing command argument");
    flags.set(flag.slice(2), value);
  }
  if (flags.size !== allowed.length) fail("missing required command argument");
  for (const name of allowed.filter(name => name.endsWith("-sha256"))) evolutionPin({ path: flags.get(name.slice(0, -7)), sha256: flags.get(name) });
  if (command.startsWith("run-")) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(flags.get("max-usd")!) || Number(flags.get("max-usd")) <= 0
      || !/^(?:0|[1-9]\d*)$/.test(flags.get("max-new-calls")!) || Number(flags.get("max-new-calls")) > 20_000) fail("invalid explicit paid bounds");
    path(flags.get("output"));
  }
  return { command, flags };
}
async function main(args: readonly string[]) {
  if (!args.length || args[0] === "--help") {
    console.log("Oh memory evolution development runner\nprepare | readers | judge-plan | run-reader | run-judge | report\nAll commands require --config ABS --config-sha256 SHA. readers requires --context ABS --context-sha256 SHA. judge-plan requires --reader-plan ABS --reader-plan-sha256 SHA --reader-output ABS --reader-output-sha256 SHA. run phases require --plan ABS --plan-sha256 SHA --max-usd CAP --max-new-calls N --output ABS. report requires reader-plan, judge-plan, reader-output, judge-output pins and --output ABS. Paid phases use selected VERCEL_OIDC_TOKEN or BENCHMARK_OPENAI_API_KEY and one pinned campaign ledger. No automatic retries; frozen studies remain closed."); return;
  }
  const { command, flags } = parseEvolutionArgs(args);
  const pin = (name: string) => evolutionPin({ path: flags.get(name), sha256: flags.get(name + "-sha256") });
  const configPin = pin("config"); let result: unknown;
  if (command === "prepare") result = await prepareEvolution(configPin);
  else if (command === "readers") result = await prepareEvolutionReaders(configPin, pin("context"));
  else if (command === "judge-plan") result = await prepareEvolutionJudges(configPin, pin("reader-plan"), pin("reader-output"));
  else if (command === "report") result = await reportEvolution({ configPin, readerPlanPin: pin("reader-plan"), judgePlanPin: pin("judge-plan"),
    readerOutputPin: pin("reader-output"), judgeOutputPin: pin("judge-output"), output: path(flags.get("output")) });
  else if (command === "run-reader" || command === "run-judge") {
    const config = await configInput(configPin), authority = await verifyEvolutionCampaign(config.campaignPin);
    const direct = command === "run-judge" && config.judge === "gpt4o-official-snapshot-judge";
    const credential: EvolutionCredential = direct ? { kind: "benchmark-openai-key", token: process.env.BENCHMARK_OPENAI_API_KEY ?? "" }
      : { kind: "gateway-oidc", token: process.env.VERCEL_OIDC_TOKEN ?? "", auth: authority.auth };
    result = await executeEvolutionPhase({ configPin, planPin: pin("plan"), phase: command === "run-reader" ? "reader" : "judge", credential,
      maxUsd: Number(flags.get("max-usd")), maxNewCalls: Number(flags.get("max-new-calls")), output: path(flags.get("output")) });
  } else fail("unknown command");
  console.log(JSON.stringify(result));
}
if (import.meta.main) { try { await main(process.argv.slice(2)); } catch (error) {
  console.error(error instanceof Error ? error.message : "Evolution runner failed; inspect preserved evidence."); process.exitCode = 1;
} }
