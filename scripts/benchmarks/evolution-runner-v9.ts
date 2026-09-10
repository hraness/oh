/** V9 runner lane: explicit-selection studies with indexed repeats, candidate/control systems, a declared reader
 * date policy and a derived-record pin slot. `evolution.ts` dispatches V9 configurations here and passes its
 * retrieval identity; the V1-V8 paths are untouched. Paid execution keys every campaign-store attempt by
 * (request, repeat) so a repeat is a distinct predeclared first attempt, never a retry. */
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, parseLocomo, parseLongMemEval, selectQuestions, type Dataset } from "./datasets";
import { codeIdentity, writeJson } from "./io";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { selectEvolutionPartition, validateEvolutionDatasetManifest, type EvolutionRunnerInput } from "./evolution-dataset";
import { evolutionJudgeJobsV9, loadEvolutionJudgeRubricV9, makeEvolutionJudgePlanV9, validateEvolutionJudgePlanV9, type EvolutionJudgePlanV9 } from "./evolution-judge-v9";
import { EVOLUTION_PROFILES, type EvolutionProfileId, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { makeEvolutionContextPlan, validateEvolutionContextPlan, type EvolutionContextPlan } from "./evolution-plan";
import { assertEvolutionContextBindingV9, evolutionContextBindingV9, makeEvolutionContextPlanV9, rebindEvolutionBasePlan, rebindEvolutionContextPlanV9,
  validateEvolutionContextPlanV9Envelope, validateEvolutionContextPlanV9Sources, type EvolutionContextPlanV9, type EvolutionRebindParent } from "./evolution-plan-v9";
import { parseEvolutionReaderDatePolicy, projectEvolutionRunnerInputV9, type EvolutionReaderDatePolicy } from "./evolution-reader-date-policy";
import { evolutionReaderJobsV2, makeEvolutionReaderPlanV2, validateEvolutionReaderPlanV2, type EvolutionPhysicalJob, type EvolutionReaderPlanV2 } from "./evolution-reader-plan-v2";
import { EVOLUTION_PHASE_V2_PROTOCOL, buildEvolutionReportV9, evolutionPhaseAttemptsV9 } from "./evolution-report-v9";
import { evolutionSystemUsesSemantic, isEvolutionDerivedSystem, type EvolutionRetrievalVariant } from "./evolution-retrieval";
import { evolutionObserveDatasetRouterAudit, prepareEvolutionDerivedCorpora, type EvolutionDerivedCorpora } from "./evolution-derived";
import { OBSERVE_LANE_ARTIFACT_MAX_BYTES, parseObserveLaneArtifact } from "./evolution-observe-lane";
import { openEvolutionStore, type EvolutionAttemptFailure, type EvolutionStore } from "./evolution-store";
import { assertEvolutionStudyV9Configuration, parseEvolutionV9Variant, selectEvolutionStudyV9Shard, validateEvolutionStudyV9Artifacts,
  EVOLUTION_V9_JUDGES, type EvolutionStudyV9Authorization, type EvolutionV9Judge } from "./evolution-study-v9";
import { invokeEvolutionRequest, type EvolutionCredential } from "./evolution-transport";
import { EVOLUTION_PAID_QUEUE_V2_PROTOCOL, runLabPaidQueueV2 } from "./lab-paid-queue";

export const EVOLUTION_RUN_V9_PROTOCOL = "oh.memory.evolution-run.v9" as const;
export const EVOLUTION_PREPARATION_V9_PROTOCOL = "oh.memory.evolution-preparation.v9" as const;
export const EVOLUTION_REBIND_V9_PROTOCOL = "oh.memory.evolution-preparation-rebind.v9" as const;
export const EVOLUTION_REBIND_DEVELOPMENT_PROTOCOL = "oh.memory.evolution-preparation-rebind.v2" as const;
export type EvolutionRunConfigV9 = Readonly<{ protocol: typeof EVOLUTION_RUN_V9_PROTOCOL; dataset: "longmemeval-s" | "locomo";
  datasetPin: EvolutionPin; manifestPin: EvolutionPin; campaignPin: EvolutionPin; studyPin: EvolutionPin; scopePin: EvolutionPin; shardId: string;
  limit: number; variants: readonly EvolutionRetrievalVariant[]; readers: readonly EvolutionProfileId[]; judge: EvolutionV9Judge;
  repeats: number; judgeRepeats: number; readerDatePolicy: EvolutionReaderDatePolicy; derivedRecordsPin: EvolutionPin | null;
  directory: string; storeDirectory: string; concurrency: 24 | 32; semanticCacheDirectory: string }>;
/** A development V4 configuration whose whole-turn V1 contexts may be rebound under the current retrieval identity. */
export type EvolutionRebindableDevelopmentConfig = Readonly<{ protocol: "oh.memory.evolution-run.v4"; dataset: "longmemeval-s" | "locomo";
  datasetPin: EvolutionPin; manifestPin: EvolutionPin; limit: number; seed: number; variants: readonly unknown[]; directory: string; derivedRecordsPin?: EvolutionPin }>;
export type EvolutionRetrievalIdentity = () => Promise<string>;
/** Runtime seams. `evolution.ts` passes the bare retrieval identity, so production always resolves the official dataset
 * pin and dispatches through the real transport on a clean committed tree. Offline qualification injects a synthetic
 * `source` (the pinned manifest is still read and validated against it) and a `fetcher`; an injected fetcher, as in the
 * selector and fact-card lanes, also lifts the clean-tree requirement because no provider is reached. */
export type EvolutionV9Environment = Readonly<{ identity: EvolutionRetrievalIdentity;
  source?: (config: Readonly<{ dataset: "longmemeval-s" | "locomo"; datasetPin: EvolutionPin }>) => Promise<Dataset>;
  fetcher?: (url: string, init: RequestInit) => Promise<Response> }>;
export type EvolutionV9Runtime = EvolutionRetrievalIdentity | EvolutionV9Environment;
const environment = (runtime: EvolutionV9Runtime): EvolutionV9Environment => typeof runtime === "function" ? { identity: runtime } : runtime;
export type EvolutionPhaseOutputV9 = Readonly<{ protocol: typeof EVOLUTION_PHASE_V2_PROTOCOL; phase: "reader" | "judge"; planSha256: string;
  responses: readonly Readonly<{ requestSha256: string; repeat: number; response: EvolutionResponse }>[];
  failures: readonly EvolutionAttemptFailure[]; complete: boolean }>;
const CONFIG_KEYS = ["protocol", "dataset", "datasetPin", "manifestPin", "campaignPin", "studyPin", "scopePin", "shardId", "limit", "variants", "readers", "judge",
  "repeats", "judgeRepeats", "readerDatePolicy", "derivedRecordsPin", "directory", "storeDirectory", "concurrency", "semanticCacheDirectory"] as const;
function fail(reason: string): never { throw new TypeError(`Evolution runner V9: ${reason}.`); }
const same = (a: unknown, b: unknown) => canonicalSha256(a) === canonicalSha256(b);
function path(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\0") || resolve(value) !== value) fail("absolute output path required");
  return value;
}
function count(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail("integer bound");
  return value as number;
}
const inside = (candidate: string, root: string) => candidate === root || candidate.startsWith(root + "/");
const overlaps = (a: string, b: string) => inside(a, b) || inside(b, a);
function decode(bytes: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
async function json(pin: EvolutionPin, maximum = 128 * 1024 * 1024): Promise<unknown> { return decode(await readEvolutionPin(pin, maximum)); }

export function parseEvolutionRunConfigV9(value: unknown): EvolutionRunConfigV9 {
  if (!isPlainRecord(value) || !hasExactKeys(value, CONFIG_KEYS) || value.protocol !== EVOLUTION_RUN_V9_PROTOCOL
    || typeof value.dataset !== "string" || !["longmemeval-s", "locomo"].includes(value.dataset) || typeof value.shardId !== "string" || !/^shard-\d{3}$/.test(value.shardId)
    || !(EVOLUTION_V9_JUDGES as readonly unknown[]).includes(value.judge) || (value.concurrency !== 24 && value.concurrency !== 32)
    || !Array.isArray(value.variants) || value.variants.length !== 2 || !Array.isArray(value.readers) || value.readers.length < 1 || value.readers.length > 4) fail("invalid explicit V9 configuration");
  const dataset = value.dataset as EvolutionRunConfigV9["dataset"], variants = value.variants.map(parseEvolutionV9Variant);
  if (variants[0]!.id === variants[1]!.id) fail("control and candidate require distinct identifiers");
  const readers = value.readers.map((r: unknown) => {
    if (typeof r !== "string" || !r.endsWith("-reader") || !Object.hasOwn(EVOLUTION_PROFILES, r)) fail("invalid reader profile");
    return r as EvolutionProfileId;
  });
  if (new Set(readers).size !== readers.length) fail("duplicate reader");
  const limit = count(value.limit, 1, 260), repeats = count(value.repeats, 1, 3), judgeRepeats = count(value.judgeRepeats, 1, 3);
  if (limit * variants.length * readers.length * repeats > 100_000) fail("reader matrix exceeds the complete-coverage bound");
  const datasetPin = evolutionPin(value.datasetPin), manifestPin = evolutionPin(value.manifestPin), campaignPin = evolutionPin(value.campaignPin);
  const studyPin = evolutionPin(value.studyPin), scopePin = evolutionPin(value.scopePin);
  const derivedRecordsPin = value.derivedRecordsPin === null ? null : evolutionPin(value.derivedRecordsPin);
  if (variants.some(v => isEvolutionDerivedSystem(v.system)) !== (derivedRecordsPin !== null)) fail("derived systems and the derived-record pin require each other");
  if (datasetPin.sha256 !== DATASETS[dataset].sha256) fail("dataset source does not match pinned official release");
  const directory = path(value.directory), storeDirectory = path(value.storeDirectory), semanticCacheDirectory = path(value.semanticCacheDirectory);
  const roots = [directory, storeDirectory, semanticCacheDirectory];
  for (let i = 0; i < roots.length; i++) for (let j = i + 1; j < roots.length; j++) if (overlaps(roots[i]!, roots[j]!)) fail("run, store and cache paths overlap");
  for (const pin of [datasetPin, manifestPin, campaignPin, studyPin, scopePin, ...(derivedRecordsPin === null ? [] : [derivedRecordsPin])]) {
    if (roots.some(root => inside(pin.path, root))) fail("pinned input overlaps mutable output, store or cache");
  }
  return Object.freeze({ protocol: EVOLUTION_RUN_V9_PROTOCOL, dataset, datasetPin, manifestPin, campaignPin, studyPin, scopePin, shardId: value.shardId, limit, variants, readers,
    judge: value.judge as EvolutionV9Judge, repeats, judgeRepeats, readerDatePolicy: parseEvolutionReaderDatePolicy(value.readerDatePolicy), derivedRecordsPin,
    directory, storeDirectory, concurrency: value.concurrency, semanticCacheDirectory });
}
/** A pre-read audit over the selected evaluation questions, containing no question text or answers. */
export async function writeEvolutionObserveRouterAudit(directory: string, dataset: Dataset): Promise<void> {
  await writeJson(join(directory, "observe-router-audit.json"), evolutionObserveDatasetRouterAudit(dataset));
}
export async function validateEvolutionObserveRouterAudit(directory: string, dataset: Dataset): Promise<void> {
  const file = Bun.file(join(directory, "observe-router-audit.json"));
  if (!await file.exists() || file.size > 4 * 1024 * 1024) fail("missing or oversized pre-read observation router audit");
  if (!same(decode(await file.bytes()), evolutionObserveDatasetRouterAudit(dataset))) fail("pre-read observation router audit differs from selected questions");
}

async function configInput(pin: EvolutionPin): Promise<EvolutionRunConfigV9> { return parseEvolutionRunConfigV9(await json(pin, 1024 * 1024)); }
/** Reads and parses a pinned observations artifact and rebuilds its records for exactly the selected corpora; every reload re-derives. */
export async function loadEvolutionDerivedCorpora(pin: EvolutionPin | null | undefined, corpora: EvolutionRunnerInput["corpora"]): Promise<EvolutionDerivedCorpora | undefined> {
  if (pin === null || pin === undefined) return undefined;
  const artifact = parseObserveLaneArtifact(await json(pin, OBSERVE_LANE_ARTIFACT_MAX_BYTES));
  return prepareEvolutionDerivedCorpora({ artifactSha256: pin.sha256, artifact, corpora });
}

/** Every reload re-authenticates study, scope and manifest bytes against the configuration's pins. */
export async function loadEvolutionStudyV9Authorization(config: EvolutionRunConfigV9): Promise<EvolutionStudyV9Authorization> {
  const authorization = validateEvolutionStudyV9Artifacts({ studyBytes: await readEvolutionPin(config.studyPin, 4 * 1024 * 1024),
    scopeBytes: await readEvolutionPin(config.scopePin, 8 * 1024 * 1024), manifestBytes: await readEvolutionPin(config.manifestPin, 8 * 1024 * 1024) });
  if (authorization.studySha256 !== config.studyPin.sha256 || authorization.scopeFileSha256 !== config.scopePin.sha256) fail("study artifact byte identity");
  assertEvolutionStudyV9Configuration(config, authorization, config.shardId);
  return authorization;
}
async function officialSource(config: Readonly<{ dataset: "longmemeval-s" | "locomo"; datasetPin: EvolutionPin }>): Promise<Dataset> {
  const raw = await readEvolutionPin(config.datasetPin, DATASETS[config.dataset].bytes);
  if (raw.length !== DATASETS[config.dataset].bytes) fail("dataset length changed");
  const value = decode(raw);
  return config.dataset === "locomo" ? parseLocomo(value) : parseLongMemEval(value);
}
async function loadSource(config: Readonly<{ dataset: "longmemeval-s" | "locomo"; datasetPin: EvolutionPin; manifestPin: EvolutionPin }>, source: EvolutionV9Environment["source"]) {
  const dataset = await (source ?? officialSource)(config);
  const manifest = validateEvolutionDatasetManifest(dataset, await json(config.manifestPin));
  if (manifest.sourceSha256 !== config.datasetPin.sha256 || manifest.revision !== DATASETS[config.dataset].revision || manifest.dataset !== config.dataset) fail("manifest/source disagreement");
  return { dataset, manifest };
}
export async function selectEvolutionV9(config: EvolutionRunConfigV9, source?: EvolutionV9Environment["source"]) {
  const { dataset, manifest } = await loadSource(config, source), authorization = await loadEvolutionStudyV9Authorization(config);
  return { dataset: selectEvolutionStudyV9Shard(dataset, manifest, authorization, config.shardId), manifest, authorization };
}
type SelectionV9 = Awaited<ReturnType<typeof selectEvolutionV9>>;
export function projectEvolutionSelectionV9(dataset: Dataset, config: Pick<EvolutionRunConfigV9, "readerDatePolicy">): EvolutionRunnerInput {
  return projectEvolutionRunnerInputV9(dataset, config.readerDatePolicy);
}
async function contextFor(config: EvolutionRunConfigV9, env: EvolutionV9Environment, selection?: SelectionV9) {
  const { identity } = env, file = join(config.directory, "contexts.json"), stat = Bun.file(file);
  if (!await stat.exists() || stat.size > 128 * 1024 * 1024) fail("missing or oversized context plan");
  const context = validateEvolutionContextPlanV9Envelope(decode(await stat.bytes()));
  const input = selection ?? await selectEvolutionV9(config, env.source), projected = projectEvolutionSelectionV9(input.dataset, config);
  if (context.manifestSha256 !== config.manifestPin.sha256 || context.retrievalSourceSha256 !== await identity()
    || !same(context.variants, config.variants) || context.inputSha256 !== canonicalSha256(projected)
    || !same(context.questions, projected.questions)) fail("prepared context source/configuration/selection mismatch");
  assertEvolutionContextBindingV9(context, input.authorization, config.shardId);
  validateEvolutionContextPlanV9Sources(context, projected, await loadEvolutionDerivedCorpora(config.derivedRecordsPin, projected.corpora));
  if (config.derivedRecordsPin !== null) await validateEvolutionObserveRouterAudit(config.directory, input.dataset);
  return context;
}
function boundedPlanBytes(plan: unknown, label: string): void {
  if (Buffer.byteLength(JSON.stringify(plan, null, 2) + "\n") > 128 * 1024 * 1024) fail(`${label} exceeds 128 MiB; reduce the explicit selection`);
}

/** Fresh preparation: retrieval for the control and candidate over the exact shard. A declared derived-record pin is
 * rebuilt into observation records that reach only the derived arms; the prepared identity carries the artifact digest. */
export async function prepareEvolutionV9(configPin: EvolutionPin, runtime: EvolutionV9Runtime) {
  const env = environment(runtime), { identity } = env;
  const config = await configInput(configPin), input = await selectEvolutionV9(config, env.source), started = performance.now();
  const { study } = input.authorization, retrievalSourceSha256 = await identity();
  if (study.retrievalSourceSha256 !== retrievalSourceSha256) fail("study retrieval source changed before preparation");
  if (study.retrievalProvenance !== null) fail("a rebound study reuses parent contexts through rebind, not fresh preparation");
  const dataset = projectEvolutionSelectionV9(input.dataset, config);
  const derived = await loadEvolutionDerivedCorpora(config.derivedRecordsPin, dataset.corpora), derivedOption = derived === undefined ? {} : { derived };
  if (config.variants.some(v => evolutionSystemUsesSemantic(v.system))) { const optionalQmd: string = "@tobilu/qmd"; await import(optionalQmd); }
  const base = await makeEvolutionContextPlan({ dataset, variants: config.variants, manifestSha256: config.manifestPin.sha256, retrievalSourceSha256,
    semanticCacheDirectory: config.semanticCacheDirectory, ...derivedOption });
  const plan = makeEvolutionContextPlanV9({ dataset, basePlan: base.plan, binding: evolutionContextBindingV9(input.authorization, config.shardId), ...derivedOption });
  await readEvolutionPin(configPin); await readEvolutionPin(config.manifestPin, 8 * 1024 * 1024);
  if (config.derivedRecordsPin !== null) await readEvolutionPin(config.derivedRecordsPin, OBSERVE_LANE_ARTIFACT_MAX_BYTES);
  const reloaded = await loadEvolutionStudyV9Authorization(config);
  if (await identity() !== retrievalSourceSha256) fail("source changed during preparation");
  assertEvolutionContextBindingV9(plan, reloaded, config.shardId);
  boundedPlanBytes(plan, "context plan");
  if (config.derivedRecordsPin !== null && config.derivedRecordsPin !== undefined) await writeEvolutionObserveRouterAudit(config.directory, input.dataset);
  const contextPath = join(config.directory, "contexts.json"); await writeJson(contextPath, plan);
  await writeJson(join(config.directory, "preparation.json"), { protocol: EVOLUTION_PREPARATION_V9_PROTOCOL, configPin, contextPlanSha256: plan.planSha256,
    retrievalSourceSha256, readerDatePolicySha256: plan.readerDatePolicySha256, timing: base.timing, wallMs: performance.now() - started, modelCalls: 0 });
  return { status: "prepared", contextPath, contextFileSha256: sha256Hex(await readFile(contextPath)), contexts: plan.cases.length, modelCalls: 0 };
}

/** Reuse a parent's exact retrieval (a V1 development plan, a V7 release wrapper or a V9 wrapper) under a V9 study
 * that declares its provenance. No index, retrieval, embedding or provider call. */
export async function rebindEvolutionV9(configPin: EvolutionPin, contextPin: EvolutionPin, runtime: EvolutionV9Runtime) {
  const env = environment(runtime), { identity } = env;
  const config = await configInput(configPin), started = performance.now(), input = await selectEvolutionV9(config, env.source);
  const dataset = projectEvolutionSelectionV9(input.dataset, config), retrievalSourceSha256 = await identity();
  const parent = await json(contextPin) as EvolutionRebindParent, derived = await loadEvolutionDerivedCorpora(config.derivedRecordsPin, dataset.corpora);
  const plan = rebindEvolutionContextPlanV9({ dataset, parent, authorization: input.authorization, shardId: config.shardId, retrievalSourceSha256,
    ...(derived === undefined ? {} : { derived }) });
  await readEvolutionPin(configPin); await readEvolutionPin(contextPin, 128 * 1024 * 1024); await readEvolutionPin(config.manifestPin, 8 * 1024 * 1024);
  if (config.derivedRecordsPin !== null) await readEvolutionPin(config.derivedRecordsPin, OBSERVE_LANE_ARTIFACT_MAX_BYTES);
  const reloaded = await loadEvolutionStudyV9Authorization(config);
  if (await identity() !== retrievalSourceSha256) fail("source changed during rebind");
  assertEvolutionContextBindingV9(plan, reloaded, config.shardId);
  boundedPlanBytes(plan, "context plan");
  if (config.derivedRecordsPin !== null && config.derivedRecordsPin !== undefined) await writeEvolutionObserveRouterAudit(config.directory, input.dataset);
  const contextPath = join(config.directory, "contexts.json"); await writeJson(contextPath, plan);
  await writeJson(join(config.directory, "preparation.json"), { protocol: EVOLUTION_REBIND_V9_PROTOCOL, configPin, parentContextPin: contextPin,
    parentProtocol: parent.protocol, parentPlanSha256: parent.planSha256, parentRetrievalSourceSha256: parent.retrievalSourceSha256,
    parentStudySha256: input.authorization.study.retrievalProvenance!.parentStudySha256, contextPlanSha256: plan.planSha256, basePlanSha256: plan.basePlan.planSha256,
    retrievalSourceSha256, readerDatePolicySha256: plan.readerDatePolicySha256, wallMs: performance.now() - started, modelCalls: 0 });
  return { status: "rebound", contextPath, contextFileSha256: sha256Hex(await readFile(contextPath)), contexts: plan.cases.length, parentPlanSha256: parent.planSha256, modelCalls: 0 };
}

/** Rebind a development V4 configuration's own whole-turn V1 contexts after a source identity change. The parent must
 * have been prepared for the same manifest, variants and development selection; only `retrievalSourceSha256` moves. */
export async function rebindEvolutionDevelopment(config: EvolutionRebindableDevelopmentConfig, configPin: EvolutionPin, contextPin: EvolutionPin, runtime: EvolutionV9Runtime) {
  if (config.protocol !== "oh.memory.evolution-run.v4") fail("development rebind requires a V4 configuration");
  const env = environment(runtime), { identity } = env;
  const started = performance.now(), { dataset, manifest } = await loadSource(config, env.source);
  const selection = selectQuestions(selectEvolutionPartition(dataset, manifest, "development"), config.limit, config.seed);
  const projected = projectEvolutionRunnerInputV9(selection, "question-date"), retrievalSourceSha256 = await identity();
  const parent = await json(contextPin) as EvolutionContextPlan;
  if (!isPlainRecord(parent) || parent.protocol !== "oh.memory.evolution-context-plan.v1") fail("development rebind requires a whole-turn V1 parent context");
  const base = validateEvolutionContextPlan(parent);
  if (base.manifestSha256 !== config.manifestPin.sha256 || !same(base.variants, config.variants)) fail("parent manifest or variants differ from the configuration");
  if (base.retrievalSourceSha256 === retrievalSourceSha256) fail("parent already carries the current retrieval source");
  const derived = await loadEvolutionDerivedCorpora(config.derivedRecordsPin, projected.corpora);
  const plan = rebindEvolutionBasePlan({ base, dataset: projected, retrievalSourceSha256, ...(derived === undefined ? {} : { derived }) });
  await readEvolutionPin(configPin); await readEvolutionPin(contextPin, 128 * 1024 * 1024); await readEvolutionPin(config.manifestPin, 8 * 1024 * 1024);
  if (config.derivedRecordsPin !== undefined) await readEvolutionPin(config.derivedRecordsPin, OBSERVE_LANE_ARTIFACT_MAX_BYTES);
  if (await identity() !== retrievalSourceSha256) fail("source changed during rebind");
  boundedPlanBytes(plan, "context plan");
  if (config.derivedRecordsPin !== undefined) await writeEvolutionObserveRouterAudit(config.directory, selection);
  const contextPath = join(config.directory, "contexts.json"); await writeJson(contextPath, plan);
  await writeJson(join(config.directory, "preparation.json"), { protocol: EVOLUTION_REBIND_DEVELOPMENT_PROTOCOL, configPin, parentContextPin: contextPin,
    parentPlanSha256: base.planSha256, parentRetrievalSourceSha256: base.retrievalSourceSha256, contextPlanSha256: plan.planSha256, retrievalSourceSha256,
    wallMs: performance.now() - started, modelCalls: 0 });
  return { status: "rebound", contextPath, contextFileSha256: sha256Hex(await readFile(contextPath)), contexts: plan.cases.length, parentPlanSha256: base.planSha256, modelCalls: 0 };
}

export async function prepareEvolutionReadersV9(configPin: EvolutionPin, contextPin: EvolutionPin, runtime: EvolutionV9Runtime) {
  const config = await configInput(configPin), context = await contextFor(config, environment(runtime)), pinned = await json(contextPin);
  if (canonicalSha256(context) !== canonicalSha256(pinned)) fail("context pin differs from config-bound context");
  const plan = makeEvolutionReaderPlanV2(context, config.readers, config.repeats), planPath = join(config.directory, "readers.json");
  boundedPlanBytes(plan, "reader plan");
  await writeJson(planPath, plan);
  const jobs = evolutionReaderJobsV2(plan);
  return { status: "readers-prepared", planPath, planFileSha256: sha256Hex(await readFile(planPath)), cases: plan.cases.length, physicalRequests: plan.requests.length,
    physicalJobs: jobs.length, maximumReservationMicros: jobs.reduce((s, j) => s + j.request.reservationMicros, 0), modelCalls: 0 };
}
function authenticateReaderJobs(store: EvolutionStore, reader: EvolutionReaderPlanV2, value: unknown) {
  const jobs = evolutionReaderJobsV2(reader), { responses, failures } = evolutionPhaseAttemptsV9(value, "reader", reader.planSha256, jobs);
  for (const job of jobs) {
    const cached = store.lookup(job.request, job.repeat), response = responses.get(job.key);
    if (failures.has(job.key)) {
      if (canonicalSha256(store.readAttemptFailure(job.request, job.repeat)) !== canonicalSha256(failures.get(job.key))) fail("failed reader does not match occupied campaign evidence");
    } else if (cached.kind !== "hit" || response === undefined || canonicalSha256(cached.result) !== canonicalSha256(response)) fail("reader receipt does not match captured campaign evidence");
  }
  return { responses, failures };
}
async function judgePlanFor(config: EvolutionRunConfigV9, store: EvolutionStore, selection: SelectionV9, contextPlan: EvolutionContextPlanV9,
  readerPlanPin: EvolutionPin, readerOutputPin: EvolutionPin): Promise<EvolutionJudgePlanV9> {
  const readerPlan = validateEvolutionReaderPlanV2(await json(readerPlanPin) as EvolutionReaderPlanV2, contextPlan);
  if (!same(readerPlan.readerProfiles, config.readers) || readerPlan.repeats !== config.repeats) fail("reader plan differs from the configuration");
  const attempts = authenticateReaderJobs(store, readerPlan, await json(readerOutputPin));
  return makeEvolutionJudgePlanV9({ contextPlan, readerPlan, ...attempts, dataset: selection.dataset, profile: config.judge,
    rubric: await loadEvolutionJudgeRubricV9(config.judge), judgeRepeats: config.judgeRepeats, readerOutputSha256: readerOutputPin.sha256 });
}
export async function prepareEvolutionJudgesV9(configPin: EvolutionPin, readerPlanPin: EvolutionPin, readerOutputPin: EvolutionPin, runtime: EvolutionV9Runtime) {
  const env = environment(runtime);
  const config = await configInput(configPin), selection = await selectEvolutionV9(config, env.source), contextPlan = await contextFor(config, env, selection);
  const authority = await verifyEvolutionCampaign(config.campaignPin), store = await openEvolutionStore({ directory: config.storeDirectory, campaign: authority.campaign });
  let plan: EvolutionJudgePlanV9;
  try { plan = await judgePlanFor(config, store, selection, contextPlan, readerPlanPin, readerOutputPin); } finally { await store.close(); }
  await writeJson(join(config.directory, "judge-inputs.json"), { readerPlanPin, readerOutputPin });
  const output = join(config.directory, "judges.json"); boundedPlanBytes(plan, "judge plan"); await writeJson(output, plan);
  return { status: "judges-prepared", output, planFileSha256: sha256Hex(await readFile(output)), cases: plan.cases.length,
    physicalRequests: plan.requests.length, physicalJobs: evolutionJudgeJobsV9(plan).length, modelCalls: 0 };
}
async function authenticatePreparedJudge(config: EvolutionRunConfigV9, store: EvolutionStore, plan: EvolutionJudgePlanV9, env: EvolutionV9Environment) {
  const file = Bun.file(join(config.directory, "judge-inputs.json"));
  if (!await file.exists() || file.size > 1024 * 1024) fail("missing judge input pins");
  const pins: unknown = JSON.parse(await file.text());
  if (!isPlainRecord(pins) || !hasExactKeys(pins, ["readerPlanPin", "readerOutputPin"])) fail("invalid judge input pins");
  const readerOutputPin = evolutionPin(pins.readerOutputPin), readerPlanPin = evolutionPin(pins.readerPlanPin);
  if (readerOutputPin.sha256 !== plan.readerOutputSha256) fail("judge reader receipt pin changed");
  const selection = await selectEvolutionV9(config, env.source), contextPlan = await contextFor(config, env, selection);
  const expected = await judgePlanFor(config, store, selection, contextPlan, readerPlanPin, readerOutputPin);
  if (canonicalSha256(expected) !== canonicalSha256(plan)) fail("judge plan differs from complete authenticated reader evidence");
}

/** Drain a bounded set of (request, repeat) jobs through the exclusive campaign store. Hits and captured first
 * responses are reused; misses are admitted up to `maxNewCalls`; unresolved occupied jobs project as failures. */
export async function runEvolutionJobsV9(input: Readonly<{ store: EvolutionStore; jobs: readonly EvolutionPhysicalJob[]; credential: EvolutionCredential;
  concurrency: 24 | 32; maxNewCalls: number; stopped?: () => boolean; fetcher?: (url: string, init: RequestInit) => Promise<Response> }>) {
  const { store } = input, responses = new Map<string, EvolutionResponse>(), failures = new Map<string, EvolutionAttemptFailure>();
  const pending: EvolutionPhysicalJob[] = [];
  if (!Number.isSafeInteger(input.maxNewCalls) || input.maxNewCalls < 0 || Object.is(input.maxNewCalls, -0) || input.maxNewCalls > 20_000) fail("explicit call bound required");
  if (new Set(input.jobs.map(j => j.key)).size !== input.jobs.length) fail("duplicate physical jobs");
  for (const job of input.jobs) {
    const cached = store.lookup(job.request, job.repeat);
    if (cached.kind === "hit") responses.set(job.key, cached.result);
    else if (cached.kind === "occupied") {
      try {
        if (cached.status !== "captured") throw new Error("unresolved");
        responses.set(job.key, store.finalize(job.request, job.repeat));
      } catch { /* The drained phase projects the occupied attempt separately from a verified response. */ }
    } else pending.push(job);
  }
  let admissionAttempts = 0;
  const stopped = input.stopped ?? (() => false);
  const execution = await runLabPaidQueueV2(pending.slice(0, input.maxNewCalls), { protocol: EVOLUTION_PAID_QUEUE_V2_PROTOCOL, concurrency: input.concurrency, stopped,
    execute: async (job: EvolutionPhysicalJob) => {
      admissionAttempts++;
      const invoked = await invokeEvolutionRequest({ request: job.request, store, credential: input.credential, repeat: job.repeat, stopped,
        ...(input.fetcher === undefined ? {} : { fetcher: input.fetcher }) });
      responses.set(job.key, invoked.result); return { key: job.key, status: invoked.result.status };
    } });
  // Only inspect unresolved attempts after every admitted job has drained; misses remain incomplete.
  for (const job of input.jobs) if (!responses.has(job.key) && store.lookup(job.request, job.repeat).kind === "occupied") failures.set(job.key, store.readAttemptFailure(job.request, job.repeat));
  return { responses, failures, admissionAttempts, errors: execution.errors.filter(e => !failures.has(e.key)).map(e => ({ key: e.key, error: "first-response-or-admission-failure" })) };
}

export async function executeEvolutionPhaseV9(input: Readonly<{ configPin: EvolutionPin; planPin: EvolutionPin; phase: "reader" | "judge"; maxUsd: number; maxNewCalls: number;
  credential: EvolutionCredential; output: string; identity: EvolutionV9Runtime }>) {
  const env = environment(input.identity);
  const config = await configInput(input.configPin), authority = await verifyEvolutionCampaign(config.campaignPin);
  if (!Number.isSafeInteger(input.maxUsd * 1_000_000) || input.maxUsd * 1_000_000 !== authority.campaign.additionalBudgetMicros
    || !Number.isSafeInteger(input.maxNewCalls) || input.maxNewCalls < 0 || Object.is(input.maxNewCalls, -0) || input.maxNewCalls > 20_000) fail("explicit spending/call bound differs from campaign");
  if (input.credential.kind === "gateway-oidc" && canonicalSha256(input.credential.auth) !== canonicalSha256(authority.auth)) fail("selected OIDC identity mismatch");
  const plan = await json(input.planPin) as EvolutionReaderPlanV2 | EvolutionJudgePlanV9;
  let jobs: readonly EvolutionPhysicalJob[], planSha256: string;
  if (input.phase === "reader") {
    const reader = validateEvolutionReaderPlanV2(plan as EvolutionReaderPlanV2, await contextFor(config, env));
    if (reader.manifestSha256 !== config.manifestPin.sha256 || !same(reader.readerProfiles, config.readers) || reader.repeats !== config.repeats) fail("reader plan/config identity mismatch");
    jobs = evolutionReaderJobsV2(reader); planSha256 = reader.planSha256;
  } else {
    const judge = validateEvolutionJudgePlanV9(plan as EvolutionJudgePlanV9);
    if (judge.profile !== config.judge || judge.judgeRepeats !== config.judgeRepeats) fail("judge treatment changed");
    jobs = evolutionJudgeJobsV9(judge); planSha256 = judge.planSha256;
  }
  const source = await codeIdentity();
  if ((env.fetcher === undefined && source.dirty) || source.bun !== "1.3.14") fail("paid execution requires clean committed Bun1.3.14 source");
  const outputPath = path(input.output);
  if (!outputPath.startsWith(config.directory + "/")) fail("phase output must be inside its shard directory");
  if ([input.configPin.path, input.planPin.path, config.datasetPin.path, config.manifestPin.path, config.campaignPin.path, config.studyPin.path, config.scopePin.path,
    ...(config.derivedRecordsPin === null ? [] : [config.derivedRecordsPin.path])].includes(outputPath) || inside(outputPath, config.storeDirectory)) fail("output overlaps pinned input or campaign store");
  await mkdir(dirname(outputPath), { mode: 0o700, recursive: true });
  const output = await open(outputPath, "wx", 0o600);
  await output.writeFile(JSON.stringify({ protocol: "oh.memory.evolution-started.v2", phase: input.phase, planSha256, sourceSha256: source.sourceSha256 }) + "\n");
  await output.sync();
  let store: EvolutionStore;
  try { store = await openEvolutionStore({ directory: config.storeDirectory, campaign: authority.campaign }); }
  catch (error) { await output.close(); throw error; }
  let stopped = false; const stop = () => { stopped = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const started = performance.now(), initial = store.summary();
  let responses = new Map<string, EvolutionResponse>(), failures = new Map<string, EvolutionAttemptFailure>();
  const errors: Array<{ key: string | null; error: string }> = [];
  let admissionAttempts = 0, verified = false;
  try {
    if (input.phase === "judge") await authenticatePreparedJudge(config, store, plan as EvolutionJudgePlanV9, env);
    const run = await runEvolutionJobsV9({ store, jobs, credential: input.credential, concurrency: config.concurrency, maxNewCalls: input.maxNewCalls, stopped: () => stopped,
      ...(env.fetcher === undefined ? {} : { fetcher: env.fetcher }) });
    responses = run.responses; failures = run.failures; admissionAttempts = run.admissionAttempts;
    await readEvolutionPin(input.planPin, 128 * 1024 * 1024); await readEvolutionPin(input.configPin); await verifyEvolutionCampaign(config.campaignPin);
    await loadEvolutionStudyV9Authorization(config);
    if ((await codeIdentity()).sourceSha256 !== source.sourceSha256) fail("source changed during phase");
    errors.push(...run.errors);
    verified = true;
  } catch { errors.push({ key: null, error: "phase-validation-failed" }); }
  let budget: ReturnType<EvolutionStore["summary"]> | null = null;
  try { budget = store.summary(); } catch { verified = false; errors.push({ key: null, error: "final-store-verification-failed" }); }
  const result: EvolutionPhaseOutputV9 = { protocol: EVOLUTION_PHASE_V2_PROTOCOL, phase: input.phase, planSha256,
    responses: jobs.flatMap(j => { const response = responses.get(j.key); return response ? [{ requestSha256: j.request.requestSha256, repeat: j.repeat, response }] : []; }),
    failures: jobs.flatMap(j => { const failure = failures.get(j.key); return failure ? [failure] : []; }),
    complete: verified && responses.size + failures.size === jobs.length && errors.length === 0 };
  const receipt = { ...result, source, executionPolicy: { protocol: EVOLUTION_PAID_QUEUE_V2_PROTOCOL, concurrency: config.concurrency, repeatKeyed: true },
    configPin: input.configPin, planPin: input.planPin, campaignSha256: authority.campaignSha256, admissionAttempts, errors, initialBudget: initial, budget,
    wallMs: performance.now() - started, interrupted: stopped, verified };
  try { await output.truncate(0); await output.write(JSON.stringify(receipt, null, 2) + "\n", 0, "utf8"); await output.sync(); }
  finally { process.off("SIGINT", stop); process.off("SIGTERM", stop); await output.close(); await store.close(); }
  return { status: result.complete ? "completed" : "incomplete", cases: responses.size + failures.size, verifiedResponses: responses.size, failedAttempts: failures.size,
    required: jobs.length, admissionAttempts, errors: errors.length, budget, output: input.output };
}

export async function reportEvolutionV9(input: Readonly<{ configPin: EvolutionPin; readerPlanPin: EvolutionPin; judgePlanPin: EvolutionPin; readerOutputPin: EvolutionPin;
  judgeOutputPin: EvolutionPin; output: string; identity: EvolutionV9Runtime }>) {
  const env = environment(input.identity);
  const config = await configInput(input.configPin), selection = await selectEvolutionV9(config, env.source), contextPlan = await contextFor(config, env, selection);
  const derived = await loadEvolutionDerivedCorpora(config.derivedRecordsPin, projectEvolutionSelectionV9(selection.dataset, config).corpora);
  const authority = await verifyEvolutionCampaign(config.campaignPin), store = await openEvolutionStore({ directory: config.storeDirectory, campaign: authority.campaign });
  try {
    const settled = (request: EvolutionRequest, response: EvolutionResponse, repeat: number) => {
      const cached = store.lookup(request, repeat);
      if (cached.kind !== "hit" || canonicalSha256(cached.result) !== canonicalSha256(response)) fail("report does not match settled first-response evidence");
    };
    const report = await buildEvolutionReportV9({ ...(derived === undefined ? {} : { derived }), dataset: selection.dataset, manifestBytes: await readEvolutionPin(config.manifestPin, 128 * 1024 * 1024), manifestSha256: config.manifestPin.sha256,
      contextPlan, readerPlan: await json(input.readerPlanPin) as EvolutionReaderPlanV2, judgePlan: await json(input.judgePlanPin) as EvolutionJudgePlanV9,
      readerOutputBytes: await readEvolutionPin(input.readerOutputPin, 128 * 1024 * 1024), judgeOutputBytes: await readEvolutionPin(input.judgeOutputPin, 128 * 1024 * 1024),
      judgeOutputSha256: input.judgeOutputPin.sha256,
      loadRawResponse: async (request, response, repeat) => { settled(request, response, repeat); return store.readRaw(request, repeat); },
      loadAttemptFailure: async (request, repeat) => store.readAttemptFailure(request, repeat),
      loadServiceMs: async (request, response, repeat) => { settled(request, response, repeat); return store.readServiceMs(request, repeat); },
      study: { studyBytes: await readEvolutionPin(config.studyPin, 4 * 1024 * 1024), scopeBytes: await readEvolutionPin(config.scopePin, 8 * 1024 * 1024),
        shardId: config.shardId, campaignSha256: authority.campaignSha256 } });
    const reportPath = path(input.output);
    if (!reportPath.startsWith(config.directory + "/")) fail("report output must be inside its shard directory");
    await writeJson(reportPath, report);
    return { status: "reported", output: input.output, modelCalls: 0, budget: store.summary() };
  } finally { await store.close(); }
}
