/** Two-stage evidence-selection development lane on frozen dev100 context pins, with reader-matched controls
 * on every configured retrieval pin and all repeats inside one campaign store via the store repeat index.
 * It reads existing V1 context plans by pin (no retrieval rerun), uses the canonical request/store/transport
 * and has no hidden dispatcher. Promotion is decided elsewhere; this report is descriptive. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import type { Question } from "./datasets";
import type { EvolutionRunnerInput } from "./evolution-dataset";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { codeIdentity } from "./io";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import { validateEvolutionContextPlanSources, type EvolutionContextPlan } from "./evolution-plan";
import { readSelectorLaneSource, SELECTOR_LANE_SOURCE_MAX_BYTES } from "./evolution-selector-lane";
import { EVOLUTION_QUESTION_SHAPE_ROUTER_V1, auditEvolutionQuestionShapeRouter, routeEvolutionQuestionShapeV1, type EvolutionQuestionShapeDecision } from "./evolution-question-shape";
import { OH_SELECTOR_POLICY_V2, evolutionTwoStageProfiles, makeEvolutionTwoStageAnswerRequest, prepareEvolutionTwoStage,
  type EvolutionTwoStagePool, type EvolutionTwoStageSelection, type EvolutionTwoStageSelectionPlan, type EvolutionTwoStageSelectorProfile } from "./evolution-two-stage";
import { EVOLUTION_PROFILES, evolutionReaderContract, evolutionReaderProfileId, makeEvolutionRequest, parseEvolutionResponse, type EvolutionProfileId, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { evolutionAnswerMessages } from "./evolution-reader-contracts";
import { openEvolutionStore, type EvolutionStore, type EvolutionAttemptFailure } from "./evolution-store";
import { invokeEvolutionRequest, type EvolutionCredential } from "./evolution-transport";
import { buildJudgePrompt, loadJudgeProfile } from "./judge";
import { EVOLUTION_LME_NATIVE_REFERENCE, scoreEvolutionJudgeDecision } from "./evolution-judge";

const PROTOCOL = "oh.memory.two-stage-experiment.v1" as const;
const JUDGE = "gpt4o-gateway-native-rubric-16-judge-v1" as const;
const PROFILES = evolutionTwoStageProfiles();
export const EVOLUTION_TWO_STAGE_ARM_IDS = ["single-call-eac", "calibration-only", "two-stage-routed", "two-stage-all", "two-stage-routed-nano", "two-stage-all-nano"] as const;
export type EvolutionTwoStageArmId = typeof EVOLUTION_TWO_STAGE_ARM_IDS[number];
type ArmSpec = Readonly<{ kind: "single"; reader: EvolutionProfileId }> | Readonly<{ kind: "two-stage"; selector: EvolutionTwoStageSelectorProfile; routed: boolean }>;
export const EVOLUTION_TWO_STAGE_ARMS: Readonly<Record<EvolutionTwoStageArmId, ArmSpec>> = freezeEvolutionCompletion({
  "single-call-eac": { kind: "single", reader: evolutionReaderProfileId("gpt5-mini-reader", "explicit-abstention-composition-v1") },
  "calibration-only": { kind: "single", reader: PROFILES.fallback },
  "two-stage-routed": { kind: "two-stage", selector: PROFILES.primary, routed: true },
  "two-stage-all": { kind: "two-stage", selector: PROFILES.primary, routed: false },
  "two-stage-routed-nano": { kind: "two-stage", selector: PROFILES.ablation, routed: true },
  // The nano counterpart of two-stage-all: the whole matrix can run with the nano selector and mini answerers under a smaller cap.
  "two-stage-all-nano": { kind: "two-stage", selector: PROFILES.ablation, routed: false },
});
export const EVOLUTION_TWO_STAGE_CONTROL_ARM: EvolutionTwoStageArmId = "single-call-eac";
export const EVOLUTION_TWO_STAGE_TEMPORAL_CATEGORY = "temporal-reasoning";
type Phase = "select" | "answer" | "judge";
export type EvolutionTwoStageLaneConfig = Readonly<{ protocol: typeof PROTOCOL; partition: "development"; sourcePin: EvolutionPin; contextPin: EvolutionPin;
  scorerPin: EvolutionPin; campaignPin: EvolutionPin; executionSourceSha256: string; contextPlanSha256: string; variantIds: readonly string[];
  questionIds: readonly string[]; arms: readonly EvolutionTwoStageArmId[]; repeats: number; maximumNewCalls: number; concurrency: number }>;
type PreparedSelection = Readonly<{ questionId: string; variantId: string; selectorProfile: EvolutionTwoStageSelectorProfile;
  plan: EvolutionTwoStageSelectionPlan | null; preparationFailure: "selection-input-rejected" | null }>;
type PlannedCase = Readonly<{ questionId: string; variantId: string; arm: EvolutionTwoStageArmId; repeat: number; routed: boolean;
  selectorProfile: EvolutionTwoStageSelectorProfile | null; selectionPlanSha256: string | null }>;
export type EvolutionTwoStageLanePlan = Readonly<{ protocol: "oh.memory.two-stage-experiment-plan.v1"; configSha256: string; inputSha256: string;
  contextPlanSha256: string; retrievalSourceSha256: string; executionSourceSha256: string; policySha256: string; routerSha256: string;
  pools: readonly Readonly<{ questionId: string; variantId: string; poolResultSha256: string; contextSha256: string; turnCount: number }>[];
  routes: readonly Readonly<{ questionId: string; shape: EvolutionQuestionShapeDecision["shape"]; routed: boolean; matchedRules: readonly string[] }>[];
  selections: readonly PreparedSelection[]; cases: readonly PlannedCase[]; maximumPhysicalCalls: number;
  reservationBounds: Readonly<{ selectionMicros: number; answerMicros: number; judgeMicros: number; totalMicros: number; meaning: string }>; planSha256: string }>;
type Attempt = Readonly<{ phase: Phase; repeat: number; request: EvolutionRequest; response: EvolutionResponse | null; failure: EvolutionAttemptFailure | null;
  notRun: "admission-stopped" | "call-limit" | "admission-rejected" | null; cached: boolean; newlyOccupied: boolean; serviceMs: number | null }>;
type SelectorStatus = "not-applicable" | "preparation-failed" | "not-run" | "unresolved" | "completed";
type Status = "preparation-failed" | "not-run" | "failed" | "completed";
type Case = { questionId: string; variantId: string; arm: EvolutionTwoStageArmId; repeat: number; routed: boolean;
  selectorProfile: EvolutionTwoStageSelectorProfile | null; selectionRequestSha256: string | null; selectorStatus: SelectorStatus;
  memory: "full-context" | "selected" | "fallback"; fallbackReason: string | null; selectedTurnCount: number | null; selectedContextSha256: string | null;
  reader: EvolutionProfileId | null; answerRequestSha256: string | null; readerStatus: Status | "skipped-selector";
  judgeRequestSha256: string | null; judgeStatus: Status | "skipped-reader"; score: 0 | 1 };
export type EvolutionTwoStagePhasePlan = Readonly<{ protocol: "oh.memory.two-stage-phase-plan.v1"; phase: "answer" | "judge"; parentPlanSha256: string;
  cases: readonly Readonly<{ questionId: string; variantId: string; arm: EvolutionTwoStageArmId; repeat: number; requestSha256: string | null }>[];
  requests: readonly EvolutionRequest[]; planSha256: string }>;
function fail(reason: string): never { throw new TypeError(`Two-stage lane: ${reason}.`); }
const same = (a: unknown, b: unknown, reason: string) => { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); };
const integer = (v: unknown, max: number, min = 1): v is number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max;
function record(v: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(v) || !hasExactKeys(v, keys)) fail(`${label} shape`); return v;
}
function text(v: unknown, max: number, empty = false): string {
  if (typeof v !== "string" || (!empty && !v.trim()) || Buffer.byteLength(v) > max || /\p{Surrogate}/u.test(v)) fail("bounded text"); return v;
}
async function json(pin: EvolutionPin, maximum: number): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readEvolutionPin(pin, maximum)));
}
const attemptKey = (requestSha256: string, repeat: number) => `${requestSha256}:${repeat}`;
export function parseEvolutionTwoStageLaneConfig(value: unknown): EvolutionTwoStageLaneConfig {
  boundEvolutionCompletionWire(value, 65_536);
  const v = record(value, ["protocol", "partition", "sourcePin", "contextPin", "scorerPin", "campaignPin", "executionSourceSha256", "contextPlanSha256",
    "variantIds", "questionIds", "arms", "repeats", "maximumNewCalls", "concurrency"], "config");
  if (v.protocol !== PROTOCOL || v.partition !== "development" || parseSha256Hex(v.executionSourceSha256) === null || parseSha256Hex(v.contextPlanSha256) === null
    || !integer(v.repeats, 3) || !integer(v.maximumNewCalls, 12_000, 0) || !integer(v.concurrency, 12)
    || !Array.isArray(v.questionIds) || v.questionIds.length !== 100 || !Array.isArray(v.variantIds) || v.variantIds.length < 1 || v.variantIds.length > 2
    || !Array.isArray(v.arms) || v.arms.length < 1 || v.arms.length > EVOLUTION_TWO_STAGE_ARM_IDS.length) fail("fixed development100 configuration");
  const questionIds = v.questionIds.map(q => text(q, 512)); if (new Set(questionIds).size !== 100) fail("distinct question IDs");
  const variantIds = v.variantIds.map(id => text(id, 512)); if (new Set(variantIds).size !== variantIds.length) fail("distinct variant IDs");
  const arms = v.arms.map(a => { if (!(EVOLUTION_TWO_STAGE_ARM_IDS as readonly unknown[]).includes(a)) fail("closed arm"); return a as EvolutionTwoStageArmId; });
  if (new Set(arms).size !== arms.length) fail("distinct arms");
  const sourcePin = evolutionPin(v.sourcePin), contextPin = evolutionPin(v.contextPin), scorerPin = evolutionPin(v.scorerPin), campaignPin = evolutionPin(v.campaignPin);
  if (new Set([sourcePin.path, contextPin.path, scorerPin.path, campaignPin.path]).size !== 4) fail("distinct pin roles");
  return { protocol: PROTOCOL, partition: "development", sourcePin, contextPin, scorerPin, campaignPin, executionSourceSha256: v.executionSourceSha256 as string,
    contextPlanSha256: v.contextPlanSha256 as string, variantIds, questionIds, arms, repeats: v.repeats, maximumNewCalls: v.maximumNewCalls, concurrency: v.concurrency };
}
async function inputs(configPin: EvolutionPin) {
  const config = parseEvolutionTwoStageLaneConfig(await json(configPin, 65_536)), source = await codeIdentity();
  if (source.sourceSha256 !== config.executionSourceSha256 || source.bun !== "1.3.14"
    || !source.files.some(f => f.path === "scripts/benchmarks/evolution-two-stage-lane.ts")
    || !source.files.some(f => f.path === "scripts/benchmarks/evolution-two-stage.ts")
    || !source.files.some(f => f.path === "scripts/benchmarks/evolution-question-shape.ts")) fail("execution source or runtime pin");
  const input = await readSelectorLaneSource(config.sourcePin);
  same(input.questions.map(q => q.id), config.questionIds, "exact ordered development selection");
  const contextValue = await json(config.contextPin, 128 * 1024 * 1024);
  boundEvolutionCompletionWire(contextValue, 128 * 1024 * 1024, 2_000_000);
  if (!isPlainRecord(contextValue) || contextValue.protocol !== OH_SELECTOR_POLICY_V2.poolProtocol || contextValue.planSha256 !== config.contextPlanSha256) fail("pinned V1 context plan identity");
  const context = contextValue as unknown as EvolutionContextPlan;
  validateEvolutionContextPlanSources(context, input);
  const variants = config.variantIds.map(id => {
    const variant = context.variants.find(v => v.id === id);
    if (!variant || !OH_SELECTOR_POLICY_V2.poolVariants.some(p => p.system === variant.system && p.topK === variant.budget.topK && p.contextBytes === variant.budget.contextBytes)) fail("fixed pool variant");
    return variant;
  });
  return { config, source, input, context, variants };
}
function compile(data: Awaited<ReturnType<typeof inputs>>): EvolutionTwoStageLanePlan {
  const { config, input, context, variants } = data;
  const factories = new Map(input.corpora.map(c => [c.id, prepareEvolutionTwoStage({ ...c, groupId: c.id })]));
  const routes = input.questions.map(q => { const d = routeEvolutionQuestionShapeV1(q.question); return { questionId: q.id, shape: d.shape, routed: d.routed, matchedRules: d.matchedRules }; });
  const routed = new Map(routes.map(r => [r.questionId, r.routed]));
  const poolFor = (questionId: string, variantId: string): EvolutionTwoStagePool => {
    const variant = variants.find(v => v.id === variantId)!, result = context.cases.find(c => c.questionId === questionId && c.variantId === variantId)!.result;
    return { variant, result, expectedResultSha256: result.resultSha256 };
  };
  const pools = input.questions.flatMap(q => variants.map(v => { const p = poolFor(q.id, v.id);
    return { questionId: q.id, variantId: v.id, poolResultSha256: p.result.resultSha256, contextSha256: p.result.contextSha256, turnCount: p.result.turnIds.length }; }));
  const needed = new Map<string, Readonly<{ questionId: string; variantId: string; selectorProfile: EvolutionTwoStageSelectorProfile }>>();
  const cases: PlannedCase[] = [];
  for (const q of input.questions) for (const v of variants) for (const arm of config.arms) for (let repeat = 0; repeat < config.repeats; repeat++) {
    const spec = EVOLUTION_TWO_STAGE_ARMS[arm], isRouted = routed.get(q.id)!;
    const selects = spec.kind === "two-stage" && (!spec.routed || isRouted);
    if (selects && spec.kind === "two-stage") needed.set(JSON.stringify([q.id, v.id, spec.selector]), { questionId: q.id, variantId: v.id, selectorProfile: spec.selector });
    cases.push({ questionId: q.id, variantId: v.id, arm, repeat, routed: isRouted, selectorProfile: selects && spec.kind === "two-stage" ? spec.selector : null, selectionPlanSha256: null });
  }
  const selections = [...needed.values()].map((n): PreparedSelection => {
    const q = input.questions.find(q => q.id === n.questionId)!;
    let plan: EvolutionTwoStageSelectionPlan | null = null;
    try { plan = factories.get(q.corpusId)!.makeSelectionPlan(q, poolFor(n.questionId, n.variantId), n.selectorProfile); } catch (e) { if (!(e instanceof TypeError)) throw e; }
    return { ...n, plan, preparationFailure: plan === null ? "selection-input-rejected" : null };
  });
  const planSha = new Map(selections.map(s => [JSON.stringify([s.questionId, s.variantId, s.selectorProfile]), s.plan?.planSha256 ?? null]));
  const bound = cases.map(c => ({ ...c, selectionPlanSha256: c.selectorProfile === null ? null : planSha.get(JSON.stringify([c.questionId, c.variantId, c.selectorProfile])) ?? null }));
  const selectionRequests = selections.flatMap(s => s.plan ? [s.plan.request] : []);
  const selectionMicros = config.repeats * selectionRequests.reduce((s, r) => s + r.reservationMicros, 0);
  // A selected context is a subset of its pool, so the full pool context under each candidate reader bounds every stage-2 request.
  const answerCeiling = new Map<string, number>();
  for (const q of input.questions) for (const v of variants) {
    const pool = poolFor(q.id, v.id).result, readers = new Set<EvolutionProfileId>([PROFILES.answer, PROFILES.fallback]);
    for (const arm of config.arms) { const spec = EVOLUTION_TWO_STAGE_ARMS[arm]; if (spec.kind === "single") readers.add(spec.reader); }
    answerCeiling.set(JSON.stringify([q.id, v.id]), Math.max(...[...readers].map(reader =>
      makeEvolutionRequest(reader, evolutionAnswerMessages(q, pool.context, evolutionReaderContract(reader))).reservationMicros)));
  }
  const answerMicros = cases.reduce((s, c) => s + answerCeiling.get(JSON.stringify([c.questionId, c.variantId]))!, 0);
  const judgeProfile = EVOLUTION_PROFILES[JUDGE];
  const judgePerRequest = Math.ceil((judgeProfile.contextWindow * Math.max(...judgeProfile.prices.map(p => Math.max(p.input, p.cacheWrite)))
    + judgeProfile.maxOutputTokens * Math.max(...judgeProfile.prices.map(p => p.output))) / 1000);
  const judgeMicros = cases.length * judgePerRequest;
  const payload = { protocol: "oh.memory.two-stage-experiment-plan.v1" as const, configSha256: canonicalSha256(config), inputSha256: canonicalSha256(input),
    contextPlanSha256: context.planSha256, retrievalSourceSha256: context.retrievalSourceSha256, executionSourceSha256: config.executionSourceSha256,
    policySha256: canonicalSha256(OH_SELECTOR_POLICY_V2), routerSha256: canonicalSha256(EVOLUTION_QUESTION_SHAPE_ROUTER_V1), pools, routes, selections, cases: bound,
    maximumPhysicalCalls: selectionRequests.length * config.repeats + cases.length * 2,
    reservationBounds: { selectionMicros, answerMicros, judgeMicros, totalMicros: selectionMicros + answerMicros + judgeMicros,
      meaning: "Selection exact prepared reservations per repeat; answer per-case maximum over candidate readers on the full pool context (a selection is a subset of its pool); judge conservative whole profile-window rate ceiling. Ceilings, not expected spend or authority: every actual request reserves its own public computed amount under the campaign cap." } };
  return { ...payload, planSha256: canonicalSha256(payload) };
}
export async function prepareEvolutionTwoStageLane(configPin: EvolutionPin): Promise<EvolutionTwoStageLanePlan> {
  const data = await inputs(configPin), plan = compile(data);
  await Promise.all([readEvolutionPin(configPin), readEvolutionPin(data.config.contextPin, 128 * 1024 * 1024), readEvolutionPin(data.config.sourcePin, SELECTOR_LANE_SOURCE_MAX_BYTES)]);
  return plan;
}
function authenticate(store: EvolutionStore, attempt: Attempt): EvolutionResponse | null {
  const current = store.lookup(attempt.request, attempt.repeat);
  if (attempt.response !== null) {
    if (current.kind !== "hit") fail("settled response missing"); same(current.result, attempt.response, "store response changed");
    const parsed = parseEvolutionResponse(store.readRaw(attempt.request, attempt.repeat), attempt.request); same(parsed, attempt.response, "raw response changed"); return parsed;
  }
  if (attempt.failure !== null) same(store.readAttemptFailure(attempt.request, attempt.repeat), attempt.failure, "charged failure changed");
  else if (current.kind !== "miss") fail("unreported occupied request"); return null;
}
function accounting(values: readonly Attempt[]) {
  const attempts = [...new Map(values.map(a => [attemptKey(a.request.requestSha256, a.repeat), a])).values()];
  return { physicalRequests: attempts.length, occupiedRequests: attempts.filter(a => a.response !== null || a.failure !== null).length,
    newlyOccupied: attempts.filter(a => a.newlyOccupied).length, cacheHits: attempts.filter(a => a.cached).length,
    completed: attempts.filter(a => a.response?.status === "completed").length,
    failed: attempts.filter(a => a.failure !== null || a.response !== null && a.response.status !== "completed").length,
    notRun: attempts.filter(a => a.notRun !== null).length, confirmedMicros: attempts.reduce((s, a) => s + (a.response?.usage.micros ?? 0), 0),
    unresolvedMicros: attempts.reduce((s, a) => s + (a.failure?.reservationMicros ?? 0), 0),
    exposureMicros: attempts.reduce((s, a) => s + (a.response?.usage.micros ?? a.failure?.reservationMicros ?? 0), 0),
    originalServiceMs: attempts.reduce((s, a) => s + (a.serviceMs ?? 0), 0), missingServiceTimes: attempts.filter(a => a.serviceMs === null).length };
}
/** Labels are opened only after the complete selection/answer matrix drains. */
async function scorer(pin: EvolutionPin, input: EvolutionRunnerInput): Promise<ReadonlyMap<string, Question>> {
  const value = record(await json(pin, 32 * 1024 * 1024), ["protocol", "inputSha256", "questions"], "scorer");
  if (value.protocol !== "oh.memory.source-selector-scoring-input.v1" || value.inputSha256 !== canonicalSha256(input)
    || !Array.isArray(value.questions) || value.questions.length !== 100) fail("separate scoring input selection");
  const rows = value.questions.map(v => {
    const q = record(v, ["id", "corpusId", "question", "questionDate", "answer", "category", "unanswerable", "evidenceSessionIds", "evidenceTurnIds"], "scoring question");
    const source = input.questions.find(s => s.id === q.id); if (!source) fail("foreign scoring question");
    same({ id: q.id, corpusId: q.corpusId, question: q.question, questionDate: q.questionDate }, source, "scoring source changed");
    if (typeof q.unanswerable !== "boolean" || !Array.isArray(q.evidenceSessionIds) || !Array.isArray(q.evidenceTurnIds)
      || q.evidenceSessionIds.length > 8192 || q.evidenceTurnIds.length > 8192) fail("scoring labels");
    return { ...source, answer: text(q.answer, 16_384, true), category: text(q.category, 512), unanswerable: q.unanswerable,
      evidenceSessionIds: q.evidenceSessionIds.map(v => text(v, 512)), evidenceTurnIds: q.evidenceTurnIds.map(v => text(v, 512)) };
  });
  if (new Set(rows.map(q => q.id)).size !== 100) fail("duplicate scoring question"); return new Map(rows.map(q => [q.id, q]));
}
const majority = (scores: readonly number[]) => scores.length > 0 && scores.reduce((s, x) => s + x, 0) * 2 > scores.length ? 1 : 0;
const mean = (scores: readonly number[]) => scores.length === 0 ? 0 : scores.reduce((s, x) => s + x, 0) / scores.length;
export async function runEvolutionTwoStageLane(options: Readonly<{ configPin: EvolutionPin; planPin: EvolutionPin; credential: EvolutionCredential;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>; stopped?: () => boolean; onPhasePrepared?: (plan: EvolutionTwoStagePhasePlan) => Promise<void> }>) {
  const started = performance.now(), data = await inputs(options.configPin), { config, input, source } = data, plan = compile(data);
  if (options.fetcher === undefined && source.dirty) fail("paid execution requires clean committed source");
  same(await json(options.planPin, 128 * 1024 * 1024), plan, "prepared plan changed");
  const authority = await verifyEvolutionCampaign(config.campaignPin);
  if (options.credential.kind !== "gateway-oidc") fail("selected campaign OIDC required"); same(options.credential.auth, authority.auth, "selected identity");
  const store = await openEvolutionStore({ directory: authority.campaign.storeDirectory, campaign: authority.campaign });
  const before = store.summary(), attempts = new Map<string, Attempt>(), inflight = new Map<string, Promise<Attempt>>();
  let newCalls = 0, stopped = false;
  const stop = () => { stopped = true; }; process.on("SIGINT", stop); process.on("SIGTERM", stop);
  async function execute(phase: Phase, request: EvolutionRequest, repeat: number): Promise<Attempt> {
    const key = attemptKey(request.requestSha256, repeat), present = inflight.get(key); if (present) return present;
    const pending = (async () => {
      const initial = store.lookup(request, repeat); let notRun: Attempt["notRun"] = null;
      if (initial.kind === "miss" && (stopped || options.stopped?.())) notRun = "admission-stopped";
      else if (initial.kind === "miss" && newCalls >= config.maximumNewCalls) notRun = "call-limit";
      if (initial.kind === "miss" && notRun === null) newCalls++;
      if (notRun === null) try { await invokeEvolutionRequest({ request, store, credential: options.credential, repeat,
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }), stopped: () => stopped || !!options.stopped?.() }); }
      catch { if (store.lookup(request, repeat).kind === "miss") { notRun = "admission-rejected"; stopped = true; } }
      const current = store.lookup(request, repeat), response = current.kind === "hit" ? current.result : null;
      const failure = current.kind === "occupied" ? store.readAttemptFailure(request, repeat) : null; if (failure !== null) stopped = true;
      const value: Attempt = { phase, repeat, request, response, failure, notRun, cached: initial.kind !== "miss",
        newlyOccupied: initial.kind === "miss" && current.kind !== "miss",
        serviceMs: current.kind === "miss" || current.kind === "occupied" && current.status === "reserved" ? null : store.readServiceMs(request, repeat) };
      authenticate(store, value); attempts.set(key, value); return value;
    })(); inflight.set(key, pending); return pending;
  }
  async function parallel<T>(items: readonly T[], run: (item: T) => Promise<void>) {
    let cursor = 0;
    const results = await Promise.allSettled(Array.from({ length: Math.min(config.concurrency, items.length) }, async () => {
      while (cursor < items.length) await run(items[cursor++]!);
    })); const rejected = results.find(r => r.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
  }
  const cases: Case[] = [], phasePlans: EvolutionTwoStagePhasePlan[] = [];
  async function freezePhase(phase: "answer" | "judge", requests: ReadonlyMap<string, EvolutionRequest>) {
    const key = phase === "answer" ? "answerRequestSha256" : "judgeRequestSha256";
    const payload = { protocol: "oh.memory.two-stage-phase-plan.v1" as const, phase, parentPlanSha256: plan.planSha256,
      cases: cases.map(c => ({ questionId: c.questionId, variantId: c.variantId, arm: c.arm, repeat: c.repeat, requestSha256: c[key] })), requests: [...requests.values()] };
    const frozen = freezeEvolutionCompletion({ ...payload, planSha256: canonicalSha256(payload) });
    phasePlans.push(frozen); await options.onPhasePrepared?.(frozen);
  }
  try {
    const factories = new Map(input.corpora.map(c => [c.id, prepareEvolutionTwoStage({ ...c, groupId: c.id })]));
    const poolFor = (questionId: string, variantId: string): EvolutionTwoStagePool => {
      const variant = data.variants.find(v => v.id === variantId)!, result = data.context.cases.find(c => c.questionId === questionId && c.variantId === variantId)!.result;
      return { variant, result, expectedResultSha256: result.resultSha256 };
    };
    const selectionKey = (s: Pick<PreparedSelection, "questionId" | "variantId" | "selectorProfile">, repeat: number) => JSON.stringify([s.questionId, s.variantId, s.selectorProfile, repeat]);
    const selectionJobs = plan.selections.flatMap(s => Array.from({ length: config.repeats }, (_, repeat) => ({ selection: s, repeat })));
    const selected = new Map<string, EvolutionTwoStageSelection>();
    const reconstruct = (s: PreparedSelection, repeat: number): EvolutionTwoStageSelection => {
      const q = input.questions.find(q => q.id === s.questionId)!, attempt = attempts.get(attemptKey(s.plan!.request.requestSha256, repeat))!;
      const response = authenticate(store, attempt); if (!response) fail("selection response unavailable");
      return factories.get(q.corpusId)!.reconstruct(q, poolFor(s.questionId, s.variantId), s.plan, store.readRaw(s.plan!.request, repeat), response);
    };
    await parallel(selectionJobs, async ({ selection, repeat }) => {
      if (!selection.plan) return;
      const attempt = await execute("select", selection.plan.request, repeat);
      if (authenticate(store, attempt) === null) return;
      selected.set(selectionKey(selection, repeat), reconstruct(selection, repeat));
    });
    for (const p of plan.cases) {
      const selection = p.selectorProfile === null ? undefined : plan.selections.find(s => s.questionId === p.questionId && s.variantId === p.variantId && s.selectorProfile === p.selectorProfile)!;
      const outcome = selection === undefined ? undefined : selected.get(selectionKey(selection, p.repeat));
      const attempt = selection?.plan ? attempts.get(attemptKey(selection.plan.request.requestSha256, p.repeat)) : undefined;
      const selectorStatus: SelectorStatus = selection === undefined ? "not-applicable" : !selection.plan ? "preparation-failed"
        : outcome !== undefined ? "completed" : attempt?.notRun !== null && attempt?.notRun !== undefined ? "not-run" : "unresolved";
      cases.push({ questionId: p.questionId, variantId: p.variantId, arm: p.arm, repeat: p.repeat, routed: p.routed, selectorProfile: p.selectorProfile,
        selectionRequestSha256: selection?.plan?.request.requestSha256 ?? null, selectorStatus,
        memory: outcome === undefined ? "full-context" : outcome.kind === "selected" ? "selected" : "fallback",
        fallbackReason: outcome?.kind === "fallback" ? outcome.reason : null,
        selectedTurnCount: outcome?.kind === "selected" ? outcome.context.turnIds.length : null,
        selectedContextSha256: outcome?.kind === "selected" ? outcome.context.contextSha256 : null,
        reader: null, answerRequestSha256: null, readerStatus: selection !== undefined && outcome === undefined ? "skipped-selector" : "not-run",
        judgeRequestSha256: null, judgeStatus: "skipped-reader", score: 0 });
    }
    const answerRequests = new Map<string, EvolutionRequest>();
    for (const c of cases) {
      if (c.readerStatus === "skipped-selector") continue;
      const q = input.questions.find(q => q.id === c.questionId)!, pool = poolFor(c.questionId, c.variantId), spec = EVOLUTION_TWO_STAGE_ARMS[c.arm];
      let request: EvolutionRequest;
      try {
        if (spec.kind === "single") request = makeEvolutionRequest(spec.reader, evolutionAnswerMessages(q, pool.result.context, evolutionReaderContract(spec.reader)));
        else if (c.selectorProfile === null) request = makeEvolutionRequest(PROFILES.fallback, evolutionAnswerMessages(q, pool.result.context, evolutionReaderContract(PROFILES.fallback)));
        else {
          const selection = plan.selections.find(s => s.questionId === c.questionId && s.variantId === c.variantId && s.selectorProfile === c.selectorProfile)!;
          const outcome = reconstruct(selection, c.repeat); same(outcome, selected.get(selectionKey(selection, c.repeat)), "shared selection changed");
          request = makeEvolutionTwoStageAnswerRequest(q, pool.result, outcome);
        }
      } catch (e) { if (!(e instanceof TypeError)) throw e; c.readerStatus = "preparation-failed"; continue; }
      c.reader = request.profileId; c.answerRequestSha256 = request.requestSha256; answerRequests.set(request.requestSha256, request);
    }
    await freezePhase("answer", answerRequests);
    await parallel(cases, async c => {
      if (c.answerRequestSha256 === null) return;
      const attempt = await execute("answer", answerRequests.get(c.answerRequestSha256)!, c.repeat), response = authenticate(store, attempt);
      c.readerStatus = attempt.notRun !== null ? "not-run" : response?.status === "completed" ? "completed" : "failed";
    });
    const questions = await scorer(config.scorerPin, input), rubric = await loadJudgeProfile();
    if (rubric.sha256 !== EVOLUTION_LME_NATIVE_REFERENCE.parityRubricSha256) fail("native rubric pin changed");
    const judgeRequests = new Map<string, EvolutionRequest>();
    for (const c of cases) {
      if (c.readerStatus !== "completed") continue;
      const response = authenticate(store, attempts.get(attemptKey(c.answerRequestSha256!, c.repeat))!); if (response?.status !== "completed" || response.answer === null) fail("reader changed before scorer");
      let request: EvolutionRequest;
      try { request = makeEvolutionRequest(JUDGE, [{ role: "user", content: buildJudgePrompt(questions.get(c.questionId)!, response.answer, rubric) }]); }
      catch (e) { if (!(e instanceof TypeError)) throw e; c.judgeStatus = "preparation-failed"; continue; }
      c.judgeRequestSha256 = request.requestSha256; judgeRequests.set(request.requestSha256, request);
    }
    await freezePhase("judge", judgeRequests);
    await parallel(cases, async c => {
      if (c.judgeRequestSha256 === null) return;
      const attempt = await execute("judge", judgeRequests.get(c.judgeRequestSha256)!, c.repeat), judged = authenticate(store, attempt);
      c.judgeStatus = attempt.notRun !== null ? "not-run" : judged?.status === "completed" ? "completed" : "failed";
      c.score = c.judgeStatus === "completed" ? scoreEvolutionJudgeDecision(JUDGE, judged!.answer) ?? 0 : 0;
    });
    for (const a of attempts.values()) authenticate(store, a);
    await Promise.all([readEvolutionPin(options.configPin), readEvolutionPin(options.planPin, 128 * 1024 * 1024), readEvolutionPin(config.contextPin, 128 * 1024 * 1024),
      readEvolutionPin(config.sourcePin, SELECTOR_LANE_SOURCE_MAX_BYTES), readEvolutionPin(config.scorerPin, 32 * 1024 * 1024), readEvolutionPin(config.campaignPin)]);
    if ((await codeIdentity()).sourceSha256 !== source.sourceSha256) fail("execution source changed");
    const physical = [...attempts.values()].sort((a, b) => attemptKey(a.request.requestSha256, a.repeat) < attemptKey(b.request.requestSha256, b.repeat) ? -1 : 1);
    const total = accounting(physical), after = store.summary();
    if (after.calls - before.calls !== total.newlyOccupied) fail("admission reconciliation");
    const preparationFailedCases = cases.filter(c => c.selectorStatus === "preparation-failed" || c.readerStatus === "preparation-failed" || c.judgeStatus === "preparation-failed").length;
    const complete = plan.selections.every(s => s.plan !== null) && preparationFailedCases === 0 && physical.every(a => a.response !== null || a.failure !== null);
    const categories = [...new Set([...questions.values()].map(q => q.category))].sort();
    const perQuestion = (arm: EvolutionTwoStageArmId, variantId: string) => input.questions.map(q => {
      const scores = cases.filter(c => c.arm === arm && c.variantId === variantId && c.questionId === q.id).sort((a, b) => a.repeat - b.repeat).map(c => c.score);
      return { questionId: q.id, category: questions.get(q.id)!.category, scores, mean: mean(scores), majority: majority(scores) };
    });
    const summaries = config.arms.flatMap(arm => config.variantIds.map(variantId => {
      const rows = cases.filter(c => c.arm === arm && c.variantId === variantId), byQuestion = perQuestion(arm, variantId);
      const keys = new Set(rows.flatMap(c => [c.selectionRequestSha256, c.answerRequestSha256, c.judgeRequestSha256].filter((id): id is string => id !== null).map(id => attemptKey(id, c.repeat))));
      // The fallback rate is over completed selections only, so an interrupted run is not understated by not-run or unresolved selections.
      const planned = rows.filter(c => c.selectorProfile !== null), completedSelections = rows.filter(c => c.selectorStatus === "completed"), fallbacks = rows.filter(c => c.memory === "fallback");
      const latency = rows.map(c => {
        if (c.judgeStatus !== "completed") return null;
        const times = [...new Set([c.selectionRequestSha256, c.answerRequestSha256!, c.judgeRequestSha256!].filter((id): id is string => id !== null))].map(id => attempts.get(attemptKey(id, c.repeat))!.serviceMs);
        return times.some(t => t === null) ? null : times.reduce<number>((s, t) => s + t!, 0);
      });
      return { arm, variantId, denominator: 100, repeats: config.repeats, logicalCases: rows.length,
        perRepeat: Array.from({ length: config.repeats }, (_, r) => rows.filter(c => c.repeat === r).reduce((s, c) => s + c.score, 0)),
        meanCorrect: byQuestion.reduce((s, q) => s + q.mean, 0), majorityCorrect: byQuestion.reduce((s, q) => s + q.majority, 0),
        failedCases: rows.filter(c => c.judgeStatus !== "completed").length,
        routedQuestions: input.questions.filter(q => plan.routes.find(r => r.questionId === q.id)!.routed).length,
        selectionsPlanned: planned.length, selectionsCompleted: completedSelections.length, selected: rows.filter(c => c.memory === "selected").length, fallbacks: fallbacks.length,
        fallbackRate: completedSelections.length === 0 ? null : fallbacks.length / completedSelections.length,
        fallbackReasons: Object.fromEntries([...new Set(fallbacks.map(c => c.fallbackReason!))].sort().map(r => [r, fallbacks.filter(c => c.fallbackReason === r).length])),
        selectedTurnCounts: rows.flatMap(c => c.selectedTurnCount === null ? [] : [c.selectedTurnCount]),
        statuses: Object.fromEntries((["selectorStatus", "readerStatus", "judgeStatus"] as const).map(key => [key,
          Object.fromEntries([...new Set(rows.map(c => c[key]))].sort().map(status => [status, rows.filter(c => c[key] === status).length]))])),
        accounting: accounting(physical.filter(a => keys.has(attemptKey(a.request.requestSha256, a.repeat)))), originalEndToEndServiceMs: latency,
        categories: categories.map(category => { const subset = byQuestion.filter(q => q.category === category);
          return { category, denominator: subset.length, meanCorrect: subset.reduce((s, q) => s + q.mean, 0), majorityCorrect: subset.reduce((s, q) => s + q.majority, 0) }; }),
        perQuestion: byQuestion.map(q => ({ questionId: q.questionId, scores: q.scores, mean: q.mean, majority: q.majority })) };
    }));
    const control = config.arms.includes(EVOLUTION_TWO_STAGE_CONTROL_ARM) ? EVOLUTION_TWO_STAGE_CONTROL_ARM : null;
    const paired = control === null ? [] : config.arms.filter(arm => arm !== control).flatMap(arm => config.variantIds.map(variantId => {
      const left = perQuestion(control, variantId), right = perQuestion(arm, variantId), summary = summaries.find(s => s.arm === arm && s.variantId === variantId)!;
      const deltas = input.questions.map((q, i) => ({ questionId: q.id, category: left[i]!.category, majorityDelta: right[i]!.majority - left[i]!.majority, meanDelta: right[i]!.mean - left[i]!.mean }));
      const temporal = deltas.filter(d => d.category === EVOLUTION_TWO_STAGE_TEMPORAL_CATEGORY);
      const majorityDelta = deltas.reduce((s, d) => s + d.majorityDelta, 0), losses = deltas.filter(d => d.majorityDelta < 0).length;
      const temporalDelta = temporal.reduce((s, d) => s + d.majorityDelta, 0);
      const rule = arm === "calibration-only" ? { minimumMajorityDelta: 2, maximumRegressions: 1 } : { minimumMajorityDelta: 3, maximumRegressions: 2 };
      const fallbackOk = summary.fallbackRate === null || summary.fallbackRate <= OH_SELECTOR_POLICY_V2.fallbackRateGate;
      return { arm, control, variantId, denominator: 100, majorityDelta, meanDelta: deltas.reduce((s, d) => s + d.meanDelta, 0),
        wins: deltas.filter(d => d.majorityDelta > 0).length, losses, ties: deltas.filter(d => d.majorityDelta === 0).length,
        temporal: { category: EVOLUTION_TWO_STAGE_TEMPORAL_CATEGORY, denominator: temporal.length, majorityDelta: temporalDelta },
        gate: { rule: { ...rule, temporalNotWorse: true, fallbackRateAtMost: OH_SELECTOR_POLICY_V2.fallbackRateGate, statistic: "majority-of-repeats paired against the control on the same pin" },
          majorityDeltaOk: majorityDelta >= rule.minimumMajorityDelta, regressionsOk: losses <= rule.maximumRegressions, temporalOk: temporalDelta >= 0, fallbackOk,
          descriptivePass: complete && config.repeats === 3 && majorityDelta >= rule.minimumMajorityDelta && losses <= rule.maximumRegressions && temporalDelta >= 0 && fallbackOk,
          meaning: "Descriptive gate arithmetic only. Promotion additionally requires complete 3-repeat coverage, the pre-committed predicted-flip check, the analysis plan's paired bootstrap and the noise-floor power caveat; a miss is not established, not no effect." },
        deltas: deltas.map(d => ({ questionId: d.questionId, majorityDelta: d.majorityDelta, meanDelta: d.meanDelta })) };
    }));
    const memoryDelta = config.variantIds.length === 2 ? config.arms.map(arm => {
      const [a, b] = config.variantIds.map(v => summaries.find(s => s.arm === arm && s.variantId === v)!);
      return { arm, minuend: a!.variantId, subtrahend: b!.variantId, majorityDelta: a!.majorityCorrect - b!.majorityCorrect, meanDelta: a!.meanCorrect - b!.meanCorrect };
    }) : null;
    const routerAudit = auditEvolutionQuestionShapeRouter(input.questions.map(q => ({ id: q.id, question: q.question, category: questions.get(q.id)!.category })));
    const payload = { protocol: "oh.memory.two-stage-lane-report.v1" as const, configPin: options.configPin, planPin: options.planPin,
      sourcePin: config.sourcePin, contextPin: config.contextPin, scorerPin: config.scorerPin, campaignPin: config.campaignPin,
      executionSourceSha256: source.sourceSha256, retrievalSourceSha256: plan.retrievalSourceSha256, contextPlanSha256: plan.contextPlanSha256, planSha256: plan.planSha256,
      policySha256: plan.policySha256, routerSha256: plan.routerSha256, arms: config.arms.map(arm => ({ arm, ...EVOLUTION_TWO_STAGE_ARMS[arm] })), variantIds: config.variantIds,
      repeats: config.repeats, judge: JUDGE, rubricSha256: rubric.sha256, scoringRule: "native-contains-yes",
      qualification: "Fixed exposed100 development comparison on pinned contexts; Gateway native16 rubric alias, not official snapshot or full-release accuracy. Formatting gains are alias-only until re-judged under the official snapshot profile.",
      complete, status: complete ? "complete" : "incomplete", stopped, denominator: 100,
      coverage: { completeCaseAccounting: true, completeAttemptCoverage: complete, logicalCases: cases.length, preparationFailedCases, occupiedRequests: total.occupiedRequests, notRunRequests: total.notRun },
      routes: plan.routes, routerAudit, cases, phasePlans, attempts: physical, total,
      phases: Object.fromEntries((["select", "answer", "judge"] as const).map(phase => [phase, accounting(physical.filter(a => a.phase === phase))])),
      summaries, paired, memoryDelta, campaignBefore: before, campaignAfter: after, wallMs: performance.now() - started,
      accountingMeaning: "Physical (request, repeat) pairs deduplicate globally in one campaign store. Unrouted and fallback cases of two-stage arms share the calibration-only control's physical answer requests, so arm totals must not be added. Invalid, skipped and missing cases score zero and stay in the denominator. Unresolved attempts retain their full original reservations.",
      latencyMeaning: "Original captured selection + answer + judge service time, including on replay; wall time reported separately." };
    return { ...payload, reportSha256: canonicalSha256(payload) };
  } finally {
    await Promise.allSettled(inflight.values()); process.off("SIGINT", stop); process.off("SIGTERM", stop); await store.close();
  }
}
