/** Fixed development matrix using the existing canonical request/store/transport. No hidden dispatcher. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import type { Question } from "./datasets";
import type { EvolutionRunnerInput } from "./evolution-dataset";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { codeIdentity } from "./io";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion, type EvolutionCompletionParent } from "./evolution-completion";
import { validateEvolutionContextPlanSources, type EvolutionContextPlan } from "./evolution-plan";
import { readSelectorLaneSource, SELECTOR_LANE_SOURCE_MAX_BYTES } from "./evolution-selector-lane";
import { EVOLUTION_FACT_CARD_POLICY, prepareEvolutionFactCards, renderEvolutionFactCards, type EvolutionFactCardPlan, type EvolutionFactCardCapture, type EvolutionFactCardContext } from "./evolution-fact-cards";
import { EVOLUTION_PROFILES, evolutionReaderContract, makeEvolutionRequest, parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { evolutionAnswerMessages } from "./evolution-reader-contracts";
import { openEvolutionStore, type EvolutionStore, type EvolutionAttemptFailure } from "./evolution-store";
import { invokeEvolutionRequest, type EvolutionCredential } from "./evolution-transport";
import { buildJudgePrompt, loadJudgeProfile } from "./judge";
import { EVOLUTION_LME_NATIVE_REFERENCE, scoreEvolutionJudgeDecision } from "./evolution-judge";

const READER = EVOLUTION_FACT_CARD_POLICY.finalizer, JUDGE = EVOLUTION_FACT_CARD_POLICY.judge;
const ARMS = ["quote-cards", "quote-cards-ops"] as const;
type Arm = typeof ARMS[number];
type Phase = "extractor" | "reader" | "judge";
export type EvolutionFactCardLaneConfig = Readonly<{ protocol: "oh.memory.fact-card-experiment.v1";
  partition: "development"; sourcePin: EvolutionPin; contextPin: EvolutionPin; scorerPin: EvolutionPin;
  campaignPin: EvolutionPin; executionSourceSha256: string; variantId: string; questionIds: readonly string[];
  maximumNewCalls: number; concurrency: number }>;
type PreparedCase = Readonly<{ questionId: string; parent: EvolutionCompletionParent;
  extractor: EvolutionFactCardPlan | null; preparationFailure: "extractor-input-rejected" | null }>;
export type EvolutionFactCardLanePlan = Readonly<{ protocol: "oh.memory.fact-card-experiment-plan.v1";
  configSha256: string; inputSha256: string; contextPlanSha256: string; retrievalSourceSha256: string;
  executionSourceSha256: string; policySha256: string; cases: readonly PreparedCase[];
  maximumPhysicalCalls: number; reservationBounds: Readonly<{ extractorMicros: number; readerMicros: number;
    judgeMicros: number; totalMicros: number; meaning: string }>; planSha256: string }>;
type Attempt = Readonly<{ phase: Phase; request: EvolutionRequest; response: EvolutionResponse | null;
  failure: EvolutionAttemptFailure | null; notRun: "admission-stopped" | "call-limit" | "admission-rejected" | null;
  cached: boolean; newlyOccupied: boolean; serviceMs: number | null }>;
type Status = "preparation-failed" | "not-run" | "failed" | "completed";
type Case = { questionId: string; arm: Arm; captureSha256: string | null; context: EvolutionFactCardContext | null;
  extractorRequestSha256: string | null; extractorStatus: Status; readerRequestSha256: string | null;
  readerStatus: Status | "skipped-extractor"; judgeRequestSha256: string | null; judgeStatus: Status | "skipped-reader"; score: 0 | 1 };
export type EvolutionFactCardPhasePlan = Readonly<{ protocol: "oh.memory.fact-card-phase-plan.v1";
  phase: "reader" | "judge"; parentPlanSha256: string;
  cases: readonly Readonly<{ questionId: string; arm: Arm; requestSha256: string | null }>[];
  requests: readonly EvolutionRequest[]; planSha256: string }>;
function fail(reason: string): never { throw new TypeError(`Fact-card lane: ${reason}.`); }
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
export function parseEvolutionFactCardLaneConfig(value: unknown): EvolutionFactCardLaneConfig {
  boundEvolutionCompletionWire(value, 65_536);
  const v = record(value, ["protocol", "partition", "sourcePin", "contextPin", "scorerPin", "campaignPin", "executionSourceSha256", "variantId", "questionIds", "maximumNewCalls", "concurrency"], "config");
  if (v.protocol !== "oh.memory.fact-card-experiment.v1" || v.partition !== "development" || parseSha256Hex(v.executionSourceSha256) === null
    || !integer(v.maximumNewCalls, 500, 0) || !integer(v.concurrency, 12) || !Array.isArray(v.questionIds) || v.questionIds.length !== 100) fail("fixed development100 configuration");
  const questionIds = v.questionIds.map(q => text(q, 512)); if (new Set(questionIds).size !== 100) fail("distinct question IDs");
  const sourcePin = evolutionPin(v.sourcePin), contextPin = evolutionPin(v.contextPin), scorerPin = evolutionPin(v.scorerPin), campaignPin = evolutionPin(v.campaignPin);
  if (new Set([sourcePin.path, contextPin.path, scorerPin.path, campaignPin.path]).size !== 4) fail("distinct pin roles");
  return { protocol: "oh.memory.fact-card-experiment.v1", partition: "development", sourcePin, contextPin, scorerPin, campaignPin,
    executionSourceSha256: v.executionSourceSha256 as string, variantId: text(v.variantId, 512), questionIds, maximumNewCalls: v.maximumNewCalls, concurrency: v.concurrency };
}
async function inputs(configPin: EvolutionPin) {
  const config = parseEvolutionFactCardLaneConfig(await json(configPin, 65_536)), source = await codeIdentity();
  if (source.sourceSha256 !== config.executionSourceSha256 || source.bun !== "1.3.14"
    || !source.files.some(f => f.path === "scripts/benchmarks/evolution-fact-card-lane.ts")) fail("execution source or runtime pin");
  const input = await readSelectorLaneSource(config.sourcePin);
  same(input.questions.map(q => q.id), config.questionIds, "exact ordered development selection");
  const contextValue = await json(config.contextPin, 128 * 1024 * 1024);
  boundEvolutionCompletionWire(contextValue, 128 * 1024 * 1024, 2_000_000);
  if (!isPlainRecord(contextValue) || contextValue.protocol !== "oh.memory.evolution-context-plan.v1") fail("original V1 semantic context plan required");
  const context = contextValue as unknown as EvolutionContextPlan;
  validateEvolutionContextPlanSources(context, input);
  const variant = context.variants.find(v => v.id === config.variantId);
  if (!variant || variant.system !== "oh-semantic" || variant.budget.topK !== 100 || variant.budget.contextBytes !== 96_000) fail("fixed semantic context variant");
  return { config, source, input, context, variant };
}
function compile(data: Awaited<ReturnType<typeof inputs>>): EvolutionFactCardLanePlan {
  const { config, input, context, variant } = data;
  const factories = new Map(input.corpora.map(c => [c.id, prepareEvolutionFactCards({ ...c, groupId: c.id })]));
  const cases = input.questions.map((q): PreparedCase => {
    const result = context.cases.find(c => c.questionId === q.id && c.variantId === variant.id)!.result;
    const parent = { variant, result, expectedResultSha256: result.resultSha256 };
    let extractor: EvolutionFactCardPlan | null = null;
    try { extractor = factories.get(q.corpusId)!.makePlan(q, parent); } catch (e) { if (!(e instanceof TypeError)) throw e; }
    return { questionId: q.id, parent, extractor, preparationFailure: extractor === null ? "extractor-input-rejected" : null };
  });
  const extractorRequests = [...new Map(cases.flatMap(c => c.extractor ? [[c.extractor.request.requestSha256, c.extractor.request] as const] : [])).values()];
  const extractorMicros = extractorRequests.reduce((s, r) => s + r.reservationMicros, 0);
  // Control characters give the maximum per-byte JSON escape expansion at both prompt layers.
  const readerMicros = 2 * input.questions.reduce((s, q) => s + makeEvolutionRequest(READER,
    evolutionAnswerMessages(q, "\u0001".repeat(EVOLUTION_FACT_CARD_POLICY.contextByteLimit), evolutionReaderContract(READER))).reservationMicros, 0);
  const judgeProfile = EVOLUTION_PROFILES[JUDGE];
  const judgePerRequest = Math.ceil((judgeProfile.contextWindow * Math.max(...judgeProfile.prices.map(p => Math.max(p.input, p.cacheWrite)))
    + judgeProfile.maxOutputTokens * Math.max(...judgeProfile.prices.map(p => p.output))) / 1000);
  const judgeMicros = input.questions.length * 2 * judgePerRequest;
  const payload = { protocol: "oh.memory.fact-card-experiment-plan.v1" as const, configSha256: canonicalSha256(config), inputSha256: canonicalSha256(input),
    contextPlanSha256: context.planSha256, retrievalSourceSha256: context.retrievalSourceSha256, executionSourceSha256: config.executionSourceSha256,
    policySha256: canonicalSha256(EVOLUTION_FACT_CARD_POLICY), cases, maximumPhysicalCalls: input.questions.length * 5,
    reservationBounds: { extractorMicros, readerMicros, judgeMicros, totalMicros: extractorMicros + readerMicros + judgeMicros,
      meaning: "Extractor exact prepared reservations at8192 output tokens; reader maximum escaped16KiB context; judge conservative whole profile-window rate ceiling. These are ceilings, not expected spend or authority. Every actual downstream request reserves its own public computed amount under the same campaign cap." } };
  return { ...payload, planSha256: canonicalSha256(payload) };
}
export async function prepareEvolutionFactCardLane(configPin: EvolutionPin): Promise<EvolutionFactCardLanePlan> {
  const data = await inputs(configPin), plan = compile(data);
  await Promise.all([readEvolutionPin(configPin), readEvolutionPin(data.config.contextPin, 128 * 1024 * 1024), readEvolutionPin(data.config.sourcePin, SELECTOR_LANE_SOURCE_MAX_BYTES)]);
  return plan;
}
function authenticate(store: EvolutionStore, attempt: Attempt): EvolutionResponse | null {
  const current = store.lookup(attempt.request);
  if (attempt.response !== null) {
    if (current.kind !== "hit") fail("settled response missing"); same(current.result, attempt.response, "store response changed");
    const parsed = parseEvolutionResponse(store.readRaw(attempt.request), attempt.request); same(parsed, attempt.response, "raw response changed"); return parsed;
  }
  if (attempt.failure !== null) same(store.readAttemptFailure(attempt.request), attempt.failure, "charged failure changed");
  else if (current.kind !== "miss") fail("unreported occupied request"); return null;
}
function accounting(values: readonly Attempt[]) {
  const attempts = [...new Map(values.map(a => [a.request.requestSha256, a])).values()];
  return { physicalRequests: attempts.length, occupiedRequests: attempts.filter(a => a.response !== null || a.failure !== null).length,
    newlyOccupied: attempts.filter(a => a.newlyOccupied).length, cacheHits: attempts.filter(a => a.cached).length,
    completed: attempts.filter(a => a.response?.status === "completed").length,
    failed: attempts.filter(a => a.failure !== null || a.response !== null && a.response.status !== "completed").length,
    notRun: attempts.filter(a => a.notRun !== null).length, confirmedMicros: attempts.reduce((s, a) => s + (a.response?.usage.micros ?? 0), 0),
    unresolvedMicros: attempts.reduce((s, a) => s + (a.failure?.reservationMicros ?? 0), 0),
    exposureMicros: attempts.reduce((s, a) => s + (a.response?.usage.micros ?? a.failure?.reservationMicros ?? 0), 0),
    originalServiceMs: attempts.reduce((s, a) => s + (a.serviceMs ?? 0), 0), missingServiceTimes: attempts.filter(a => a.serviceMs === null).length };
}
/** Labels are opened only after the complete extractor/finalizer matrix drains. */
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
export async function runEvolutionFactCardLane(options: Readonly<{ configPin: EvolutionPin; planPin: EvolutionPin;
  credential: EvolutionCredential; fetcher?: (url: string, init: RequestInit) => Promise<Response>; stopped?: () => boolean;
  onPhasePrepared?: (plan: EvolutionFactCardPhasePlan) => Promise<void> }>) {
  const started = performance.now(), data = await inputs(options.configPin), { config, input, source } = data, plan = compile(data);
  if (options.fetcher === undefined && source.dirty) fail("paid execution requires clean committed source");
  same(await json(options.planPin, 128 * 1024 * 1024), plan, "prepared plan changed");
  const authority = await verifyEvolutionCampaign(config.campaignPin);
  if (options.credential.kind !== "gateway-oidc") fail("selected campaign OIDC required"); same(options.credential.auth, authority.auth, "selected identity");
  const store = await openEvolutionStore({ directory: authority.campaign.storeDirectory, campaign: authority.campaign });
  const before = store.summary(), attempts = new Map<string, Attempt>(), inflight = new Map<string, Promise<Attempt>>();
  let newCalls = 0, stopped = false;
  const stop = () => { stopped = true; }; process.on("SIGINT", stop); process.on("SIGTERM", stop);
  async function execute(phase: Phase, request: EvolutionRequest): Promise<Attempt> {
    const key = request.requestSha256, present = inflight.get(key); if (present) return present;
    const pending = (async () => {
      const initial = store.lookup(request); let notRun: Attempt["notRun"] = null;
      if (initial.kind === "miss" && (stopped || options.stopped?.())) notRun = "admission-stopped";
      else if (initial.kind === "miss" && newCalls >= config.maximumNewCalls) notRun = "call-limit";
      if (initial.kind === "miss" && notRun === null) newCalls++;
      if (notRun === null) try { await invokeEvolutionRequest({ request, store, credential: options.credential,
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }), stopped: () => stopped || !!options.stopped?.() }); }
      catch { if (store.lookup(request).kind === "miss") { notRun = "admission-rejected"; stopped = true; } }
      const current = store.lookup(request), response = current.kind === "hit" ? current.result : null;
      const failure = current.kind === "occupied" ? store.readAttemptFailure(request) : null; if (failure !== null) stopped = true;
      const value: Attempt = { phase, request, response, failure, notRun, cached: initial.kind !== "miss",
        newlyOccupied: initial.kind === "miss" && current.kind !== "miss",
        serviceMs: current.kind === "miss" || current.kind === "occupied" && current.status === "reserved" ? null : store.readServiceMs(request) };
      authenticate(store, value); attempts.set(key, value); return value;
    })(); inflight.set(key, pending); return pending;
  }
  async function parallel<T>(items: readonly T[], run: (item: T) => Promise<void>) {
    let cursor = 0;
    const results = await Promise.allSettled(Array.from({ length: Math.min(config.concurrency, items.length) }, async () => {
      while (cursor < items.length) await run(items[cursor++]!);
    })); const rejected = results.find(r => r.status === "rejected"); if (rejected?.status === "rejected") throw rejected.reason;
  }
  const cases: Case[] = [], captures = new Map<string, EvolutionFactCardCapture>(), phasePlans: EvolutionFactCardPhasePlan[] = [];
  async function freezePhase(phase: "reader" | "judge", requests: ReadonlyMap<string, EvolutionRequest>) {
    const key = phase === "reader" ? "readerRequestSha256" : "judgeRequestSha256";
    const payload = { protocol: "oh.memory.fact-card-phase-plan.v1" as const, phase, parentPlanSha256: plan.planSha256,
      cases: cases.map(c => ({ questionId: c.questionId, arm: c.arm, requestSha256: c[key] })), requests: [...requests.values()] };
    const frozen = freezeEvolutionCompletion({ ...payload, planSha256: canonicalSha256(payload) });
    phasePlans.push(frozen); await options.onPhasePrepared?.(frozen);
  }
  try {
    const factories = new Map(input.corpora.map(c => [c.id, prepareEvolutionFactCards({ ...c, groupId: c.id })]));
    const reconstruct = (p: PreparedCase): EvolutionFactCardCapture => {
      const q = input.questions.find(q => q.id === p.questionId)!, attempt = attempts.get(p.extractor!.request.requestSha256)!;
      const response = authenticate(store, attempt); if (!response) fail("extractor response unavailable");
      return factories.get(q.corpusId)!.reconstruct(q, p.parent, p.extractor, store.readRaw(p.extractor!.request), response);
    };
    const extract = async (p: PreparedCase) => {
      if (!p.extractor) return;
      const attempt = await execute("extractor", p.extractor.request);
      if (authenticate(store, attempt)?.status !== "completed") return;
      try { captures.set(p.questionId, reconstruct(p)); } catch (e) { if (!(e instanceof TypeError)) throw e; }
    };
    const canaryIds = [...config.questionIds].sort().slice(0, 6), canary = canaryIds.map(id => plan.cases.find(p => p.questionId === id)!);
    await parallel(canary, extract);
    const canaryCompleted = canary.filter(p => p.extractor && attempts.get(p.extractor.request.requestSha256)?.response?.status === "completed").length;
    if (canaryCompleted === 0) stopped = true;
    await parallel(plan.cases.filter(p => !canaryIds.includes(p.questionId)), extract);
    for (const p of plan.cases) for (const arm of ARMS) {
      const capture = captures.get(p.questionId), attempt = p.extractor ? attempts.get(p.extractor.request.requestSha256)! : null;
      const extractorStatus: Status = !p.extractor ? "preparation-failed" : capture ? "completed" : attempt!.notRun !== null ? "not-run" : "failed";
      cases.push({ questionId: p.questionId, arm, captureSha256: capture?.captureSha256 ?? null, context: null,
        extractorRequestSha256: p.extractor?.request.requestSha256 ?? null, extractorStatus, readerRequestSha256: null,
        readerStatus: capture ? "not-run" : "skipped-extractor", judgeRequestSha256: null, judgeStatus: "skipped-reader", score: 0 });
    }
    const readerRequests = new Map<string, EvolutionRequest>();
    for (const c of cases) {
      if (c.extractorStatus !== "completed") continue;
      const p = plan.cases.find(p => p.questionId === c.questionId)!, q = input.questions.find(q => q.id === c.questionId)!;
      let request: EvolutionRequest;
      try { const capture = reconstruct(p); same(capture, captures.get(c.questionId), "shared extractor capture changed");
        c.context = renderEvolutionFactCards(capture, c.arm);
        request = makeEvolutionRequest(READER, evolutionAnswerMessages(q, c.context.context, evolutionReaderContract(READER)));
      } catch (e) { if (!(e instanceof TypeError)) throw e; c.readerStatus = "preparation-failed"; continue; }
      c.readerRequestSha256 = request.requestSha256; readerRequests.set(request.requestSha256, request);
    }
    await freezePhase("reader", readerRequests);
    await parallel(cases, async c => {
      if (c.readerRequestSha256 === null) return;
      const attempt = await execute("reader", readerRequests.get(c.readerRequestSha256)!), response = authenticate(store, attempt);
      c.readerStatus = attempt.notRun !== null ? "not-run" : response?.status === "completed" ? "completed" : "failed";
    });
    const questions = await scorer(config.scorerPin, input), rubric = await loadJudgeProfile();
    if (rubric.sha256 !== EVOLUTION_LME_NATIVE_REFERENCE.parityRubricSha256) fail("native rubric pin changed");
    const judgeRequests = new Map<string, EvolutionRequest>();
    for (const c of cases) {
      if (c.readerStatus !== "completed") continue;
      const response = authenticate(store, attempts.get(c.readerRequestSha256!)!); if (response?.status !== "completed" || response.answer === null) fail("reader changed before scorer");
      let request: EvolutionRequest;
      try { request = makeEvolutionRequest(JUDGE, [{ role: "user", content: buildJudgePrompt(questions.get(c.questionId)!, response.answer, rubric) }]); }
      catch (e) { if (!(e instanceof TypeError)) throw e; c.judgeStatus = "preparation-failed"; continue; }
      c.judgeRequestSha256 = request.requestSha256; judgeRequests.set(request.requestSha256, request);
    }
    await freezePhase("judge", judgeRequests);
    await parallel(cases, async c => {
      if (c.judgeRequestSha256 === null) return;
      const attempt = await execute("judge", judgeRequests.get(c.judgeRequestSha256)!), judged = authenticate(store, attempt);
      c.judgeStatus = attempt.notRun !== null ? "not-run" : judged?.status === "completed" ? "completed" : "failed";
      c.score = c.judgeStatus === "completed" ? scoreEvolutionJudgeDecision(JUDGE, judged!.answer) ?? 0 : 0;
    });
    for (const a of attempts.values()) authenticate(store, a);
    await Promise.all([readEvolutionPin(options.configPin), readEvolutionPin(options.planPin, 128 * 1024 * 1024), readEvolutionPin(config.contextPin, 128 * 1024 * 1024),
      readEvolutionPin(config.sourcePin, SELECTOR_LANE_SOURCE_MAX_BYTES), readEvolutionPin(config.scorerPin, 32 * 1024 * 1024), readEvolutionPin(config.campaignPin)]);
    if ((await codeIdentity()).sourceSha256 !== source.sourceSha256) fail("execution source changed");
    const physical = [...attempts.values()].sort((a, b) => a.request.requestSha256 < b.request.requestSha256 ? -1 : 1), total = accounting(physical), after = store.summary();
    if (after.calls - before.calls !== total.newlyOccupied) fail("admission reconciliation");
    const complete = plan.cases.every(p => p.extractor !== null) && physical.every(a => a.response !== null || a.failure !== null);
    const summaries = ARMS.map(arm => {
      const rows = cases.filter(c => c.arm === arm), ids = new Set(rows.flatMap(c => [c.extractorRequestSha256, c.readerRequestSha256, c.judgeRequestSha256].filter((id): id is string => id !== null)));
      const latency = rows.map(c => {
        if (c.judgeStatus !== "completed") return null;
        const times = [...new Set([c.extractorRequestSha256!, c.readerRequestSha256!, c.judgeRequestSha256!])].map(id => attempts.get(id)!.serviceMs);
        return times.some(t => t === null) ? null : times.reduce<number>((s, t) => s + t!, 0);
      });
      return { arm, denominator: 100, correct: rows.reduce((s, c) => s + c.score, 0), accuracy: rows.reduce((s, c) => s + c.score, 0) / 100,
        failedCases: rows.filter(c => c.judgeStatus !== "completed").length,
        statuses: Object.fromEntries((["extractorStatus", "readerStatus", "judgeStatus"] as const).map(key => [key,
          Object.fromEntries([...new Set(rows.map(c => c[key]))].sort().map(status => [status, rows.filter(c => c[key] === status).length]))])),
        accounting: accounting(physical.filter(a => ids.has(a.request.requestSha256))), originalEndToEndServiceMs: latency,
        categories: [...new Set([...questions.values()].map(q => q.category))].sort().map(category => {
          const subset = rows.filter(c => questions.get(c.questionId)!.category === category);
          return { category, denominator: subset.length, correct: subset.reduce((s, c) => s + c.score, 0) };
        }) };
    });
    const deltas = input.questions.map(q => { const a = cases.find(c => c.questionId === q.id && c.arm === ARMS[0])!, b = cases.find(c => c.questionId === q.id && c.arm === ARMS[1])!;
      return { questionId: q.id, quoteCards: a.score, quoteCardsOps: b.score, delta: b.score - a.score }; });
    const payload = { protocol: "oh.memory.fact-card-experiment-report.v1" as const, configPin: options.configPin, planPin: options.planPin,
      sourcePin: config.sourcePin, contextPin: config.contextPin, scorerPin: config.scorerPin, campaignPin: config.campaignPin,
      executionSourceSha256: source.sourceSha256, retrievalSourceSha256: plan.retrievalSourceSha256, planSha256: plan.planSha256,
      policySha256: plan.policySha256, reader: READER, judge: JUDGE, rubricSha256: rubric.sha256, scoringRule: "native-contains-yes",
      qualification: "Fixed exposed100 development comparison; Gateway native16 rubric alias, not official snapshot or full-release accuracy.",
      complete, status: complete ? "complete" : "incomplete", stopped, denominator: 100,
      serviceQualification: { questionIds: canaryIds, completedExtractorResponses: canaryCompleted,
        criterion: "First six lexically sorted IDs; captured completed response availability only, no correctness gate. Exact captures reused." },
      coverage: { completeCaseAccounting: true, completeAttemptCoverage: complete, logicalCases: 200, occupiedRequests: total.occupiedRequests, notRunRequests: total.notRun },
      cases, captures: [...captures.values()], phasePlans, attempts: physical, total,
      phases: Object.fromEntries((["extractor", "reader", "judge"] as const).map(phase => [phase, accounting(physical.filter(a => a.phase === phase))])), summaries,
      paired: { denominator: 100, wins: deltas.filter(d => d.delta > 0).length, losses: deltas.filter(d => d.delta < 0).length,
        ties: deltas.filter(d => d.delta === 0).length, meanDelta: deltas.reduce((s, d) => s + d.delta, 0) / 100, deltas },
      campaignBefore: before, campaignAfter: after, wallMs: performance.now() - started,
      accountingMeaning: "Physical request IDs deduplicate globally in one campaign store. Each arm attributes its shared extractor and judge costs, so arm totals must not be added. Invalid, skipped and missing cases score zero. Unresolved attempts retain their full original reservations.",
      latencyMeaning: "Original captured extractor + reader + judge service time, including on replay; wall time reported separately." };
    return { ...payload, reportSha256: canonicalSha256(payload) };
  } finally {
    await Promise.allSettled(inflight.values()); process.off("SIGINT", stop); process.off("SIGTERM", stop); await store.close();
  }
}
