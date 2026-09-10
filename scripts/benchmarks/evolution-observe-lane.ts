/**
 * Question-blind observation extraction lane. One request per corpus session,
 * input = corpus sessions only, output = a pinned observations artifact that
 * rebuilds the exact `oh.observation.v1` records through the library. The lane
 * reuses the campaign store, transport and admission of the other lanes and
 * adds no dispatcher of its own. Budget policy: GPT-5 nano or GPT-5 mini
 * extractors only, and a campaign cap of at most $20.
 */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../../src/graph";
import { makeOhObservationPromptV1, observeOhV1, OH_OBSERVATION_INSTRUCTION_SHA256_V1, OH_OBSERVATION_LIMITS_V1,
  OH_OBSERVATION_REJECTIONS_V1, parseOhObservationResponseV1, parseOhObservationSessionV1,
  type OhObservationRejectionV1, type OhObservationSessionV1 } from "../../src/observe";
import { OhSqliteStore } from "../../src/sqlite/store";
import type { Corpus, Turn } from "./datasets";
import type { EvolutionRunnerInput } from "./evolution-dataset";
import { evolutionPin, parseEvolutionCampaign, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import { makeEvolutionRequest, parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { openEvolutionStore, type EvolutionAttemptFailure, type EvolutionStore } from "./evolution-store";
import { invokeEvolutionRequest, type EvolutionCredential } from "./evolution-transport";
import { codeIdentity } from "./io";

export const OBSERVE_LANE_EXTRACTORS = ["gpt5-nano-reader", "gpt5-mini-reader"] as const;
export type ObserveLaneExtractor = typeof OBSERVE_LANE_EXTRACTORS[number];
export const OBSERVE_LANE_MAXIMUM_CAMPAIGN_MICROS = 20_000_000;
export const OBSERVE_LANE_SOURCE_MAX_BYTES = 64 * 1024 * 1024;
export const OBSERVE_LANE_ARTIFACT_MAX_BYTES = 128 * 1024 * 1024;
const CONFIG_PROTOCOL = "oh.memory.observe-lane-experiment.v1" as const;
const SOURCE_PROTOCOL = "oh.memory.observe-lane-input.v1" as const;
const PLAN_PROTOCOL = "oh.memory.observe-lane-plan.v1" as const;
export const OBSERVE_LANE_ARTIFACT_PROTOCOL = "oh.memory.observations.v1" as const;

/** Frozen with the instruction digest before any extraction run; a change is a new lane version. */
export const EVOLUTION_OBSERVE_LANE_POLICY = freezeEvolutionCompletion({
  protocol: "oh.memory.observe-lane-policy.v1", partition: "development", extractors: OBSERVE_LANE_EXTRACTORS,
  defaultExtractor: "gpt5-nano-reader", instructionSha256: OH_OBSERVATION_INSTRUCTION_SHA256_V1,
  requestsPerSession: 1, input: "corpus-sessions-only", maximumObservationsPerSession: OH_OBSERVATION_LIMITS_V1.observationsPerSession,
  maximumResponseBytes: OH_OBSERVATION_LIMITS_V1.responseBytes, maximumCampaignMicros: OBSERVE_LANE_MAXIMUM_CAMPAIGN_MICROS,
  turnKeyScheme: "edition:turn-<five digit corpus turn index>", serviceCanary: { sessions: 3, order: "lexical-session-key",
    criterion: "completed-extractor-response-availability-only" }, artifactProtocol: OBSERVE_LANE_ARTIFACT_PROTOCOL,
  diagnostics: ["parserRejectionRate", "observationsPerSession", "facetFillRate", "byteShare"],
} as const);

export type ObserveLaneConfig = Readonly<{ protocol: typeof CONFIG_PROTOCOL; partition: "development"; sourcePin: EvolutionPin;
  campaignPin: EvolutionPin; executionSourceSha256: string; extractor: ObserveLaneExtractor; maximumNewCalls: number;
  concurrency: number; maximumCampaignMicros: number }>;
export type ObserveLaneSource = Readonly<{ protocol: typeof SOURCE_PROTOCOL; partition: "development";
  corpora: readonly Readonly<{ id: string; turns: readonly Turn[] }>[] }>;
export type ObserveLaneCase = Readonly<{ corpusId: string; corpusSha256: string; sessionId: string; sessionIndex: number | null;
  sessionSha256: string | null; turnKeys: readonly string[]; promptSha256: string | null; requestSha256: string | null;
  preparationFailure: "session-rejected" | "request-rejected" | null }>;
export type ObserveLanePlan = Readonly<{ protocol: typeof PLAN_PROTOCOL; configSha256: string; sourceSha256: string; policySha256: string;
  executionSourceSha256: string; extractor: ObserveLaneExtractor; instructionSha256: string;
  corpora: readonly Readonly<{ corpusId: string; corpusSha256: string; sessions: number }>[]; cases: readonly ObserveLaneCase[];
  requests: readonly EvolutionRequest[]; maximumPhysicalCalls: number; reservationMicros: number; planSha256: string }>;
export type ObserveLaneSessionStatus = "preparation-failed" | "not-run" | "failed" | "rejected" | "completed";
export type ObserveLaneArtifactSession = Readonly<{ sessionId: string; sessionIndex: number | null; sessionSha256: string | null;
  turnKeys: readonly string[]; requestSha256: string | null; responseSha256: string | null; status: ObserveLaneSessionStatus;
  rejection: OhObservationRejectionV1 | null; rejectionIndex: number | null; response: string | null; observationCount: number;
  facetCount: number; observationBytes: number; turnBytes: number }>;
export type ObserveLaneArtifactCorpus = Readonly<{ corpusId: string; corpusSha256: string; sessions: readonly ObserveLaneArtifactSession[] }>;
export type ObserveLaneAttempt = Readonly<{ request: EvolutionRequest; response: EvolutionResponse | null; failure: EvolutionAttemptFailure | null;
  notRun: "admission-stopped" | "call-limit" | "admission-rejected" | null; cached: boolean; newlyOccupied: boolean; serviceMs: number | null }>;

function fail(reason: string): never { throw new TypeError(`Observe lane: ${reason}.`); }
const same = (a: unknown, b: unknown, reason: string) => { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); };
const integer = (v: unknown, max: number, min = 1): v is number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max;
function record(v: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(v) || !hasExactKeys(v, keys)) fail(`${label} shape`); return v;
}
function text(v: unknown, max: number, empty = false): string {
  if (typeof v !== "string" || (!empty && !v.trim()) || Buffer.byteLength(v) > max || /\p{Surrogate}/u.test(v)) fail("bounded text"); return v;
}
function unique(ids: readonly string[]): void { if (new Set(ids).size !== ids.length) fail("duplicate IDs"); }
async function json(pin: EvolutionPin, maximum: number): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readEvolutionPin(pin, maximum)));
}

export function parseObserveLaneConfig(value: unknown): ObserveLaneConfig {
  boundEvolutionCompletionWire(value, 65_536);
  const v = record(value, ["protocol", "partition", "sourcePin", "campaignPin", "executionSourceSha256", "extractor", "maximumNewCalls",
    "concurrency", "maximumCampaignMicros"], "config");
  if (v.protocol !== CONFIG_PROTOCOL || v.partition !== "development" || parseSha256Hex(v.executionSourceSha256) === null
    || !integer(v.maximumNewCalls, 20_000, 0) || !integer(v.concurrency, 12)) fail("explicit development configuration");
  const extractor = OBSERVE_LANE_EXTRACTORS.find(id => id === v.extractor);
  if (extractor === undefined) fail("extractor must be GPT-5 nano or GPT-5 mini");
  if (!integer(v.maximumCampaignMicros, OBSERVE_LANE_MAXIMUM_CAMPAIGN_MICROS)) fail("campaign cap above the $20 lane bound");
  const sourcePin = evolutionPin(v.sourcePin), campaignPin = evolutionPin(v.campaignPin);
  unique([sourcePin.path, campaignPin.path]);
  return { protocol: CONFIG_PROTOCOL, partition: "development", sourcePin, campaignPin, executionSourceSha256: v.executionSourceSha256 as string,
    extractor, maximumNewCalls: v.maximumNewCalls, concurrency: v.concurrency, maximumCampaignMicros: v.maximumCampaignMicros };
}

/** Drops questions before anything is written: the lane input carries corpora only. */
export function projectObserveLaneSource(input: EvolutionRunnerInput): ObserveLaneSource {
  return parseObserveLaneSource({ protocol: SOURCE_PROTOCOL, partition: "development",
    corpora: input.corpora.map(c => ({ id: c.id, turns: c.turns.map(cleanTurn) })) });
}
function cleanTurn(turn: Turn): Turn {
  return { id: turn.id, sessionId: turn.sessionId, ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }),
    date: turn.date, speaker: turn.speaker, text: turn.text };
}
export function parseObserveLaneSource(value: unknown): ObserveLaneSource {
  const v = record(value, ["protocol", "partition", "corpora"], "source");
  if (v.protocol !== SOURCE_PROTOCOL || v.partition !== "development" || !Array.isArray(v.corpora) || !integer(v.corpora.length, 2000)) fail("source bounds or partition");
  let totalTurns = 0;
  const corpora = v.corpora.map((c: unknown) => {
    const source = record(c, ["id", "turns"], "corpus");
    if (!Array.isArray(source.turns) || !integer(source.turns.length, 8192) || (totalTurns += source.turns.length) > 100_000) fail("turn bounds");
    const turns: Turn[] = source.turns.map((t: unknown) => {
      if (!isPlainRecord(t)) fail("turn shape");
      const turn = record(t, ["id", "sessionId", "date", "speaker", "text", ...(Object.hasOwn(t, "sessionIndex") ? ["sessionIndex"] : [])], "turn");
      if (turn.sessionIndex !== undefined && !integer(turn.sessionIndex, 8191, 0)) fail("session occurrence");
      return { id: text(turn.id, 512), sessionId: text(turn.sessionId, 512), ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }),
        date: text(turn.date, 256, true), speaker: text(turn.speaker, OH_OBSERVATION_LIMITS_V1.speakerBytes), text: text(turn.text, 1_048_576, true) };
    }); unique(turns.map(t => t.id)); return { id: text(source.id, 512), turns };
  }); unique(corpora.map(c => c.id));
  return { protocol: SOURCE_PROTOCOL, partition: "development", corpora };
}

/** The same turn record keys the retrieval corpus uses, so provenance dependencies line up. */
export function observeLaneTurnRecords(corpus: Readonly<{ id: string; turns: readonly Turn[] }>): readonly KnowledgeGraphRecordV1[] {
  return corpus.turns.map((turn, index) => createKnowledgeGraphRecordV1({ dependencies: [],
    key: `edition:turn-${index.toString().padStart(5, "0")}`, kind: "edition", v: 1, value: { ...cleanTurn(turn) } }));
}
export function observeLaneCorpusSha256(corpus: Readonly<{ id: string; turns: readonly Turn[] }>): string {
  const detached: Corpus = { id: corpus.id, groupId: corpus.id, turns: corpus.turns.map(cleanTurn) };
  return canonicalSha256(detached);
}
/** Sessions are ordered by first appearance, keyed by session ID and occurrence, exactly as retrieval groups them. */
export function observeLaneSessions(corpus: Readonly<{ id: string; turns: readonly Turn[] }>): readonly Readonly<{ sessionId: string;
  sessionIndex: number | null; indices: readonly number[] }>[] {
  const occurrences = new Map<string, { sessionId: string; sessionIndex: number | null; indices: number[] }>();
  corpus.turns.forEach((turn, index) => {
    const key = JSON.stringify([turn.sessionId, turn.sessionIndex ?? null]);
    let session = occurrences.get(key);
    if (session === undefined) { session = { sessionId: turn.sessionId, sessionIndex: turn.sessionIndex ?? null, indices: [] }; occurrences.set(key, session); }
    session.indices.push(index);
  });
  return [...occurrences.values()];
}

type PreparedSession = Readonly<{ laneCase: ObserveLaneCase; session: OhObservationSessionV1 | null; request: EvolutionRequest | null; turnBytes: number }>;
function prepareSessions(extractor: ObserveLaneExtractor, corpus: Readonly<{ id: string; turns: readonly Turn[] }>): readonly PreparedSession[] {
  const records = observeLaneTurnRecords(corpus), corpusSha256 = observeLaneCorpusSha256(corpus);
  return observeLaneSessions(corpus).map((group): PreparedSession => {
    const turnKeys = group.indices.map(index => records[index]!.key);
    const base = { corpusId: corpus.id, corpusSha256, sessionId: group.sessionId, sessionIndex: group.sessionIndex, turnKeys };
    const turnBytes = group.indices.reduce((sum, index) => sum + Buffer.byteLength(corpus.turns[index]!.text), 0);
    let session: OhObservationSessionV1;
    try { session = parseOhObservationSessionV1(group.indices.map(index => records[index]!)); }
    catch (error) { if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
      return { laneCase: { ...base, sessionSha256: null, promptSha256: null, requestSha256: null, preparationFailure: "session-rejected" }, session: null, request: null, turnBytes }; }
    try {
      const prompt = makeOhObservationPromptV1(session), request = makeEvolutionRequest(extractor, prompt.messages);
      return { laneCase: { ...base, sessionSha256: session.sessionSha256, promptSha256: prompt.promptSha256, requestSha256: request.requestSha256,
        preparationFailure: null }, session, request, turnBytes };
    } catch (error) { if (!(error instanceof TypeError || error instanceof RangeError)) throw error;
      return { laneCase: { ...base, sessionSha256: session.sessionSha256, promptSha256: null, requestSha256: null, preparationFailure: "request-rejected" }, session, request: null, turnBytes }; }
  });
}
async function inputs(configPin: EvolutionPin) {
  const config = parseObserveLaneConfig(await json(configPin, 65_536)), source = await codeIdentity();
  if (source.sourceSha256 !== config.executionSourceSha256 || source.bun !== "1.3.14"
    || !source.files.some(f => f.path === "scripts/benchmarks/evolution-observe-lane.ts")
    || !source.files.some(f => f.path === "src/observe.ts")) fail("execution source or runtime pin");
  const campaign = parseEvolutionCampaign(await json(config.campaignPin, 2 * 1024 * 1024));
  if (campaign.additionalBudgetMicros > config.maximumCampaignMicros) fail("campaign budget exceeds the declared lane cap");
  const input = parseObserveLaneSource(await json(config.sourcePin, OBSERVE_LANE_SOURCE_MAX_BYTES));
  return { config, source, campaign, input };
}
function compile(data: Awaited<ReturnType<typeof inputs>>) {
  const { config, input } = data;
  const prepared = input.corpora.map(corpus => ({ corpus, sessions: prepareSessions(config.extractor, corpus) }));
  const cases = prepared.flatMap(p => p.sessions.map(s => s.laneCase));
  const requests = [...new Map(prepared.flatMap(p => p.sessions.flatMap(s => s.request ? [[s.request.requestSha256, s.request] as const] : []))).values()]
    .sort((a, b) => a.requestSha256 < b.requestSha256 ? -1 : 1);
  const payload = { protocol: PLAN_PROTOCOL, configSha256: canonicalSha256(config), sourceSha256: canonicalSha256(input),
    policySha256: canonicalSha256(EVOLUTION_OBSERVE_LANE_POLICY), executionSourceSha256: config.executionSourceSha256, extractor: config.extractor,
    instructionSha256: OH_OBSERVATION_INSTRUCTION_SHA256_V1,
    corpora: prepared.map(p => ({ corpusId: p.corpus.id, corpusSha256: observeLaneCorpusSha256(p.corpus), sessions: p.sessions.length })),
    cases, requests, maximumPhysicalCalls: requests.length, reservationMicros: requests.reduce((s, r) => s + r.reservationMicros, 0) };
  const plan: ObserveLanePlan = freezeEvolutionCompletion({ ...payload, planSha256: canonicalSha256(payload) });
  return { plan, prepared };
}
export async function prepareEvolutionObserveLane(configPin: EvolutionPin): Promise<ObserveLanePlan> {
  const data = await inputs(configPin), { plan } = compile(data);
  await Promise.all([readEvolutionPin(configPin), readEvolutionPin(data.config.sourcePin, OBSERVE_LANE_SOURCE_MAX_BYTES), readEvolutionPin(data.config.campaignPin, 2 * 1024 * 1024)]);
  return plan;
}

function authenticate(store: EvolutionStore, attempt: ObserveLaneAttempt): EvolutionResponse | null {
  const current = store.lookup(attempt.request);
  if (attempt.response !== null) {
    if (current.kind !== "hit") fail("settled response missing"); same(current.result, attempt.response, "store response changed");
    const parsed = parseEvolutionResponse(store.readRaw(attempt.request), attempt.request); same(parsed, attempt.response, "raw response changed"); return parsed;
  }
  if (attempt.failure !== null) same(store.readAttemptFailure(attempt.request), attempt.failure, "charged failure changed");
  else if (current.kind !== "miss") fail("unreported occupied request"); return null;
}
function accounting(values: readonly ObserveLaneAttempt[]) {
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

/** Executes the frozen plan under the campaign cap and returns the pinned observations artifact. Nothing reads a question. */
export async function runEvolutionObserveLane(options: Readonly<{ configPin: EvolutionPin; planPin: EvolutionPin; credential: EvolutionCredential;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>; stopped?: () => boolean }>) {
  const started = performance.now(), data = await inputs(options.configPin), { config, source } = data, { plan, prepared } = compile(data);
  if (options.fetcher === undefined && source.dirty) fail("paid execution requires clean committed source");
  same(await json(options.planPin, OBSERVE_LANE_ARTIFACT_MAX_BYTES), plan, "prepared plan changed");
  const authority = await verifyEvolutionCampaign(config.campaignPin);
  if (authority.campaign.additionalBudgetMicros > config.maximumCampaignMicros) fail("campaign budget exceeds the declared lane cap");
  if (options.credential.kind !== "gateway-oidc") fail("selected campaign OIDC required"); same(options.credential.auth, authority.auth, "selected identity");
  const store = await openEvolutionStore({ directory: authority.campaign.storeDirectory, campaign: authority.campaign });
  const before = store.summary(), attempts = new Map<string, ObserveLaneAttempt>(), inflight = new Map<string, Promise<ObserveLaneAttempt>>();
  let newCalls = 0, stopped = false;
  const stop = () => { stopped = true; }; process.on("SIGINT", stop); process.on("SIGTERM", stop);
  async function execute(request: EvolutionRequest): Promise<ObserveLaneAttempt> {
    const key = request.requestSha256, present = inflight.get(key); if (present) return present;
    const pending = (async () => {
      const initial = store.lookup(request); let notRun: ObserveLaneAttempt["notRun"] = null;
      if (initial.kind === "miss" && (stopped || options.stopped?.())) notRun = "admission-stopped";
      else if (initial.kind === "miss" && newCalls >= config.maximumNewCalls) notRun = "call-limit";
      if (initial.kind === "miss" && notRun === null) newCalls++;
      if (notRun === null) try { await invokeEvolutionRequest({ request, store, credential: options.credential,
        ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }), stopped: () => stopped || !!options.stopped?.() }); }
      catch { if (store.lookup(request).kind === "miss") { notRun = "admission-rejected"; stopped = true; } }
      const current = store.lookup(request), response = current.kind === "hit" ? current.result : null;
      const failure = current.kind === "occupied" ? store.readAttemptFailure(request) : null; if (failure !== null) stopped = true;
      const value: ObserveLaneAttempt = { request, response, failure, notRun, cached: initial.kind !== "miss",
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
  try {
    const sessions = prepared.flatMap(p => p.sessions).filter(s => s.request !== null);
    const sessionKey = (s: PreparedSession) => `${s.laneCase.corpusId} ${s.laneCase.sessionId} ${s.laneCase.sessionIndex ?? ""}`;
    const canary = [...sessions].sort((a, b) => sessionKey(a) < sessionKey(b) ? -1 : 1).slice(0, EVOLUTION_OBSERVE_LANE_POLICY.serviceCanary.sessions);
    const canaryIds = new Set(canary.map(sessionKey));
    await parallel(canary, async s => { await execute(s.request!); });
    const canaryCompleted = canary.filter(s => attempts.get(s.request!.requestSha256)?.response?.status === "completed").length;
    if (canary.length > 0 && canaryCompleted === 0) stopped = true;
    await parallel(sessions.filter(s => !canaryIds.has(sessionKey(s))), async s => { await execute(s.request!); });
    const corpora: ObserveLaneArtifactCorpus[] = prepared.map(p => ({ corpusId: p.corpus.id, corpusSha256: observeLaneCorpusSha256(p.corpus),
      sessions: p.sessions.map((s): ObserveLaneArtifactSession => {
        const base = { sessionId: s.laneCase.sessionId, sessionIndex: s.laneCase.sessionIndex, sessionSha256: s.laneCase.sessionSha256,
          turnKeys: s.laneCase.turnKeys, requestSha256: s.laneCase.requestSha256, turnBytes: s.turnBytes };
        const empty = { responseSha256: null, rejection: null, rejectionIndex: null, response: null, observationCount: 0, facetCount: 0, observationBytes: 0 };
        if (s.request === null || s.session === null) return { ...base, ...empty, status: "preparation-failed" };
        const attempt = attempts.get(s.request.requestSha256)!, response = authenticate(store, attempt);
        if (attempt.notRun !== null) return { ...base, ...empty, status: "not-run" };
        if (response?.status !== "completed" || response.answer === null) return { ...base, ...empty, status: "failed" };
        const parsed = parseOhObservationResponseV1(response.answer, s.session), responseSha256 = sha256Hex(response.answer);
        if (!parsed.ok) return { ...base, ...empty, responseSha256, status: "rejected", rejection: parsed.rejection, rejectionIndex: parsed.index, response: response.answer };
        return { ...base, responseSha256, status: "completed", rejection: null, rejectionIndex: null, response: response.answer,
          observationCount: parsed.observations.length, facetCount: parsed.observations.filter(o => o.facet !== null).length,
          observationBytes: parsed.observations.reduce((sum, o) => sum + Buffer.byteLength(o.text), 0) };
      }) }));
    for (const a of attempts.values()) authenticate(store, a);
    await Promise.all([readEvolutionPin(options.configPin), readEvolutionPin(options.planPin, OBSERVE_LANE_ARTIFACT_MAX_BYTES),
      readEvolutionPin(config.sourcePin, OBSERVE_LANE_SOURCE_MAX_BYTES), readEvolutionPin(config.campaignPin, 2 * 1024 * 1024)]);
    if ((await codeIdentity()).sourceSha256 !== source.sourceSha256) fail("execution source changed");
    const physical = [...attempts.values()].sort((a, b) => a.request.requestSha256 < b.request.requestSha256 ? -1 : 1), total = accounting(physical), after = store.summary();
    if (after.calls - before.calls !== total.newlyOccupied) fail("admission reconciliation");
    const rows = corpora.flatMap(c => c.sessions), attempted = rows.filter(r => r.status === "completed" || r.status === "rejected");
    const completed = rows.filter(r => r.status === "completed"), turnBytes = rows.reduce((s, r) => s + r.turnBytes, 0);
    const observationBytes = completed.reduce((s, r) => s + r.observationBytes, 0), observations = completed.reduce((s, r) => s + r.observationCount, 0);
    const complete = rows.every(r => r.status !== "not-run") && physical.every(a => a.response !== null || a.failure !== null);
    const diagnostics = { sessions: rows.length, preparationFailed: rows.filter(r => r.status === "preparation-failed").length,
      notRun: rows.filter(r => r.status === "not-run").length, failed: rows.filter(r => r.status === "failed").length,
      rejected: rows.filter(r => r.status === "rejected").length, completed: completed.length, observations,
      rejections: Object.fromEntries(OH_OBSERVATION_REJECTIONS_V1.map(code => [code, rows.filter(r => r.rejection === code).length])),
      parserRejectionRate: attempted.length === 0 ? null : rows.filter(r => r.status === "rejected").length / attempted.length,
      observationsPerSession: completed.length === 0 ? null : observations / completed.length,
      facetFillRate: observations === 0 ? null : completed.reduce((s, r) => s + r.facetCount, 0) / observations,
      byteShare: turnBytes === 0 ? null : observationBytes / (turnBytes + observationBytes), observationBytes, turnBytes };
    const payload = { protocol: OBSERVE_LANE_ARTIFACT_PROTOCOL, configPin: options.configPin, planPin: options.planPin, sourcePin: config.sourcePin,
      campaignPin: config.campaignPin, configSha256: plan.configSha256, planSha256: plan.planSha256, sourceSha256: plan.sourceSha256,
      policySha256: plan.policySha256, executionSourceSha256: source.sourceSha256, extractor: config.extractor, instructionSha256: plan.instructionSha256,
      qualification: "Question-blind extraction over corpus sessions; observations rebuild through the library from the source turns and these responses.",
      complete, status: complete ? "complete" : "incomplete", stopped, serviceQualification: { sessions: canary.length, completedExtractorResponses: canaryCompleted,
        criterion: EVOLUTION_OBSERVE_LANE_POLICY.serviceCanary.criterion }, corpora, diagnostics, attempts: physical, total,
      campaignBefore: before, campaignAfter: after, wallMs: performance.now() - started,
      accountingMeaning: "Physical request IDs deduplicate globally in one campaign store. Unresolved attempts retain their full original reservations." };
    return { ...payload, artifactSha256: canonicalSha256(payload) };
  } finally {
    await Promise.allSettled(inflight.values()); process.off("SIGINT", stop); process.off("SIGTERM", stop); await store.close();
  }
}
export type ObserveLaneArtifact = Awaited<ReturnType<typeof runEvolutionObserveLane>>;

export function observeLaneArtifactName(corpusSha256: string, extractor: ObserveLaneExtractor): string {
  if (parseSha256Hex(corpusSha256) === null || !OBSERVE_LANE_EXTRACTORS.includes(extractor)) fail("artifact name inputs");
  return `observations-${corpusSha256}-${extractor}.json`;
}

/**
 * Rebuilds the derived records for one corpus from its source turns and the
 * pinned responses by running the library itself, so the records a retrieval
 * corpus appends are exactly the records a product store would commit.
 */
export async function rebuildObserveLaneRecords(corpus: Readonly<{ id: string; turns: readonly Turn[] }>, artifact: ObserveLaneArtifactCorpus,
  options: Readonly<{ extractor: ObserveLaneExtractor; supersession?: boolean }>) {
  if (artifact.corpusId !== corpus.id || artifact.corpusSha256 !== observeLaneCorpusSha256(corpus)) fail("artifact does not describe this corpus");
  const turns = observeLaneTurnRecords(corpus), store = new OhSqliteStore({ path: ":memory:", spaceId: "observe-lane" });
  try {
    for (let start = 0; start < turns.length; start += 512) {
      store.commit({ actorId: "evolution.observe", changes: turns.slice(start, start + 512).map(record => ({ kind: "put" as const, record, v: 1 as const })),
        expectedHead: store.head(), instant: "2026-01-01T00:00:00.000Z", operationId: `op_observe_turns_${start}` });
    }
    const sessions: Array<{ sessionSha256: string; activityKey: string; observationKeys: readonly string[] }> = [];
    const derived: KnowledgeGraphRecordV1[] = [];
    for (const row of artifact.sessions) {
      if (row.status !== "completed" || row.response === null) continue;
      const result = await observeOhV1({ actorId: "evolution.observe", instant: "2026-01-01T00:00:00.000Z", sessionRecordKeys: row.turnKeys, store,
        supersession: options.supersession === true, observer: { modelId: options.extractor, observe(prompt) {
          if (prompt.sessionSha256 !== row.sessionSha256) fail("artifact session digest differs from the source session");
          return row.response!;
        } } });
      if (result.status !== "committed" || result.sessionSha256 !== row.sessionSha256 || result.observationKeys.length !== row.observationCount) fail("artifact response no longer rebuilds");
      for (const key of [result.activityKey, ...result.observationKeys]) derived.push(store.get(key)!);
      sessions.push({ sessionSha256: result.sessionSha256, activityKey: result.activityKey, observationKeys: result.observationKeys });
    }
    return Object.freeze({ turns, derived: Object.freeze(derived), sessions: Object.freeze(sessions) });
  } finally { store.close(); }
}
