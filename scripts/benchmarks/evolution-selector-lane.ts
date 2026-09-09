/** Isolated, versioned experiment. Legacy context plans, requests and reports are untouched. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex } from "../../src/canonical";
import type { Corpus, Question, Turn } from "./datasets";
import type { EvolutionRunnerInput, EvolutionRunnerQuestion } from "./evolution-dataset";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";
import { codeIdentity } from "./io";
import { prepareEvolutionCorpus, createEvolutionContextSourceValidator, type EvolutionRetrievalResult } from "./evolution-retrieval";
import { OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT } from "./evolution-spans-prototype";
import { OH_SELECTOR_POLICY, prepareOhSourceSelector, type OhSelectedSourceContext, type OhSelectorPlan } from "./evolution-selector";
import { EVOLUTION_PROFILES, evolutionReaderContract, makeEvolutionRequest, parseEvolutionResponse, type EvolutionProfileId, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { evolutionAnswerMessages } from "./evolution-reader-contracts";
import { openEvolutionStore, type EvolutionStore, type EvolutionAttemptFailure } from "./evolution-store";
import { invokeEvolutionRequest, type EvolutionCredential } from "./evolution-transport";
import { buildJudgePrompt, loadJudgeProfile } from "./judge";
import { EVOLUTION_LME_NATIVE_REFERENCE, scoreEvolutionJudgeDecision } from "./evolution-judge";

export const SELECTOR_LANE_SOURCE_MAX_BYTES = 64 * 1024 * 1024;
const PROTOCOL = "oh.memory.source-selector-experiment.v1" as const;
export const SELECTOR_LANE_CONTROL = Object.freeze({ id: "native-focused-top100-48000", system: "oh-focused" as const,
  budget: Object.freeze({ topK: 100, contextBytes: 48_000 }) });
const JUDGE = "gpt4o-gateway-native-rubric-16-judge-v1" as const;
type Arm = "native-control" | "selected-sources";
type Phase = "selector" | "reader" | "judge";
export type SelectorLaneConfig = Readonly<{ protocol: typeof PROTOCOL; sourcePin: EvolutionPin; scorerPin: EvolutionPin;
  campaignPin: EvolutionPin; executionSourceSha256: string; readers: readonly EvolutionProfileId[];
  maximumNewCalls: number; concurrency: number; partition: "development" }>;
type SelectorCase = Readonly<{ questionId: string; pool: EvolutionRetrievalResult; control: EvolutionRetrievalResult;
  selector: OhSelectorPlan | null; preparationFailure: "selector-input-rejected" | null }>;
export type SelectorLanePlan = Readonly<{ protocol: "oh.memory.source-selector-experiment-plan.v1";
  configSha256: string; inputSha256: string; executionSourceSha256: string; policySha256: string;
  controlSha256: string; cases: readonly SelectorCase[]; maximumSelectorCalls: number;
  maximumSelectorReservationMicros: number; planSha256: string }>;
export type SelectorLaneContext = Readonly<{ kind: "native-control"; result: EvolutionRetrievalResult }>
  | Readonly<{ kind: "selected-sources"; result: OhSelectedSourceContext }>;
export type SelectorLaneAttempt = Readonly<{ phase: Phase; request: EvolutionRequest; response: EvolutionResponse | null;
  failure: EvolutionAttemptFailure | null; notRun: "admission-stopped" | "call-limit" | "admission-rejected" | null;
  cached: boolean; newlyOccupied: boolean; serviceMs: number | null }>;
type ReaderCase = { questionId: string; arm: Arm; reader: EvolutionProfileId; context: SelectorLaneContext | null;
  selectorRequestSha256: string | null; selectorFailed: boolean;
  selectorStatus: "not-applicable" | "preparation-failed" | "not-run" | "failed" | "completed";
  readerRequestSha256: string | null; readerFailed: boolean; readerStatus: "skipped-selector" | "not-run" | "failed" | "completed";
  judgeRequestSha256: string | null; judgeFailed: boolean; judgeStatus: "skipped-reader" | "not-run" | "failed" | "completed"; score: 0 | 1 };
function fail(reason: string): never { throw new TypeError(`Selector lane: ${reason}.`); }
const same = (a: unknown, b: unknown, reason: string) => { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); };
const integer = (v: unknown, max: number, min = 1): v is number => typeof v === "number" && Number.isSafeInteger(v) && !Object.is(v, -0) && v >= min && v <= max;
function record(v: unknown, keys: readonly string[], name: string): Record<string, unknown> {
  if (!isPlainRecord(v) || !hasExactKeys(v, keys)) fail(`${name} shape`); return v;
}
function text(v: unknown, max: number, empty = false): string {
  if (typeof v !== "string" || (!empty && !v.trim()) || Buffer.byteLength(v) > max || /\p{Surrogate}/u.test(v)) fail("bounded text"); return v;
}
function unique(ids: readonly string[]): void { if (new Set(ids).size !== ids.length) fail("duplicate IDs"); }
async function json(pin: EvolutionPin, maximum = 32 * 1024 * 1024): Promise<unknown> {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readEvolutionPin(pin, maximum)));
}
export function parseSelectorLaneConfig(value: unknown): SelectorLaneConfig {
  const v = record(value, ["protocol", "sourcePin", "scorerPin", "campaignPin", "executionSourceSha256", "readers", "maximumNewCalls", "concurrency", "partition"], "config");
  if (v.protocol !== PROTOCOL || v.partition !== "development" || typeof v.executionSourceSha256 !== "string"
    || parseSha256Hex(v.executionSourceSha256) === null || !integer(v.maximumNewCalls, 20_000, 0) || !integer(v.concurrency, 12)
    || !Array.isArray(v.readers) || v.readers.length < 1 || v.readers.length > 8) fail("explicit configuration");
  const readers = v.readers.map((id: unknown) => {
    if (typeof id !== "string" || !id.endsWith("-reader") || !Object.hasOwn(EVOLUTION_PROFILES, id)) fail("reader profile");
    return id as EvolutionProfileId;
  }); unique(readers);
  const sourcePin = evolutionPin(v.sourcePin), scorerPin = evolutionPin(v.scorerPin), campaignPin = evolutionPin(v.campaignPin);
  unique([sourcePin.path, scorerPin.path, campaignPin.path]);
  return { protocol: PROTOCOL, sourcePin, scorerPin, campaignPin, executionSourceSha256: v.executionSourceSha256,
    readers, maximumNewCalls: v.maximumNewCalls, concurrency: v.concurrency, partition: "development" };
}
/** A caller-approved development projection. This loader rejects labels, categories and unknown keys. */
export function parseSelectorLaneSource(value: unknown): EvolutionRunnerInput {
  const v = record(value, ["protocol", "partition", "corpora", "questions"], "source");
  if (v.protocol !== "oh.memory.source-selector-input.v1" || v.partition !== "development" || !Array.isArray(v.corpora)
    || !Array.isArray(v.questions) || !integer(v.corpora.length, 2000) || !integer(v.questions.length, 2000)) fail("source bounds or partition");
  let totalTurns = 0;
  const corpora = v.corpora.map((c: unknown) => {
    const source = record(c, ["id", "turns"], "corpus");
    if (!Array.isArray(source.turns) || !integer(source.turns.length, 8192) || (totalTurns += source.turns.length) > 100_000) fail("turn bounds");
    const turns: Turn[] = source.turns.map((t: unknown) => {
      if (!isPlainRecord(t)) fail("turn shape");
      const turn = record(t, ["id", "sessionId", "date", "speaker", "text", ...(Object.hasOwn(t, "sessionIndex") ? ["sessionIndex"] : [])], "turn");
      if (turn.sessionIndex !== undefined && !integer(turn.sessionIndex, 8191, 0)) fail("session occurrence");
      return { id: text(turn.id, 512), sessionId: text(turn.sessionId, 512), date: text(turn.date, 256, true), speaker: text(turn.speaker, 512),
        text: text(turn.text, 1_048_576, true), ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }) };
    }); unique(turns.map(t => t.id)); return { id: text(source.id, 512), turns };
  }); unique(corpora.map(c => c.id));
  const questions: EvolutionRunnerQuestion[] = v.questions.map((q: unknown) => {
    const question = record(q, ["id", "corpusId", "question", "questionDate"], "question");
    return { id: text(question.id, 512), corpusId: text(question.corpusId, 512), question: text(question.question, 16_384), questionDate: text(question.questionDate, 256, true) };
  }); unique(questions.map(q => q.id));
  if (questions.some(q => !corpora.some(c => c.id === q.corpusId)) || corpora.some(c => !questions.some(q => q.corpusId === c.id))) fail("source coverage");
  return { corpora, questions };
}
/** The source projection alone has a 64 MiB bound; config, scorer and plan bounds stay separate. */
export async function readSelectorLaneSource(pin: EvolutionPin): Promise<EvolutionRunnerInput> {
  return parseSelectorLaneSource(await json(pin, SELECTOR_LANE_SOURCE_MAX_BYTES));
}
async function sourceInputs(configPin: EvolutionPin) {
  const config = parseSelectorLaneConfig(await json(configPin, 65_536));
  const source = await codeIdentity();
  if (source.sourceSha256 !== config.executionSourceSha256 || source.bun !== "1.3.14"
    || !source.files.some(f => f.path === "scripts/benchmarks/evolution-selector.ts")
    || !source.files.some(f => f.path === "scripts/benchmarks/evolution-selector-lane.ts")) fail("execution source or toolchain pin");
  const input = await readSelectorLaneSource(config.sourcePin);
  return { config, source, input };
}
async function makePlan(config: SelectorLaneConfig, input: EvolutionRunnerInput): Promise<SelectorLanePlan> {
  const cases: SelectorCase[] = [];
  for (const c of input.corpora) {
    const corpus: Corpus = { ...c, groupId: c.id }, prepared = await prepareEvolutionCorpus(corpus), selector = prepareOhSourceSelector(corpus);
    const validateControl = createEvolutionContextSourceValidator(corpus);
    try {
      for (const q of input.questions.filter(q => q.corpusId === c.id)) {
        const pool = await prepared.retrieve(q.question, OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT);
        const control = await prepared.retrieve(q.question, SELECTOR_LANE_CONTROL);
        validateControl(control);
        let selected: OhSelectorPlan | null = null;
        try { selected = selector.makePlan(q, pool, pool.resultSha256); } catch (error) { if (!(error instanceof TypeError)) throw error; }
        cases.push({ questionId: q.id, pool, control, selector: selected, preparationFailure: selected === null ? "selector-input-rejected" : null });
      }
    } finally { await prepared.close(); }
  }
  const order = new Map(input.questions.map((q, i) => [q.id, i])); cases.sort((a, b) => order.get(a.questionId)! - order.get(b.questionId)!);
  const requests = new Map(cases.flatMap(c => c.selector === null ? [] : [[c.selector.request.requestSha256, c.selector.request] as const]));
  const payload = { protocol: "oh.memory.source-selector-experiment-plan.v1" as const, configSha256: canonicalSha256(config),
    inputSha256: canonicalSha256(input), executionSourceSha256: config.executionSourceSha256, policySha256: canonicalSha256(OH_SELECTOR_POLICY),
    controlSha256: canonicalSha256(SELECTOR_LANE_CONTROL), cases, maximumSelectorCalls: requests.size,
    maximumSelectorReservationMicros: [...requests.values()].reduce((sum, r) => sum + r.reservationMicros, 0) };
  return { ...payload, planSha256: canonicalSha256(payload) };
}
export async function prepareSelectorLane(configPin: EvolutionPin): Promise<SelectorLanePlan> {
  const { config, input } = await sourceInputs(configPin), plan = await makePlan(config, input);
  await readEvolutionPin(configPin); await readEvolutionPin(config.sourcePin, SELECTOR_LANE_SOURCE_MAX_BYTES); return plan;
}
function authenticate(store: EvolutionStore, attempt: SelectorLaneAttempt): EvolutionResponse | null {
  const lookup = store.lookup(attempt.request);
  if (attempt.response !== null) {
    if (lookup.kind !== "hit") fail("settled response missing from canonical store");
    same(lookup.result, attempt.response, "store response mismatch");
    const parsed = parseEvolutionResponse(store.readRaw(attempt.request), attempt.request);
    same(parsed, attempt.response, "authenticated raw response mismatch"); return parsed;
  }
  if (attempt.failure !== null) same(store.readAttemptFailure(attempt.request), attempt.failure, "unresolved attempt mismatch");
  else if (lookup.kind !== "miss") fail("unreported occupied request");
  return null;
}
/** Only this stage opens the gold pin. Source, selector and reader stages never receive it. */
async function scorerQuestions(pin: EvolutionPin, input: EvolutionRunnerInput): Promise<ReadonlyMap<string, Question>> {
  const value = record(await json(pin), ["protocol", "inputSha256", "questions"], "scorer");
  if (value.protocol !== "oh.memory.source-selector-scoring-input.v1" || value.inputSha256 !== canonicalSha256(input)
    || !Array.isArray(value.questions) || value.questions.length !== input.questions.length) fail("scorer source or denominator");
  const questions = value.questions.map((v: unknown) => {
    const q = record(v, ["id", "corpusId", "question", "questionDate", "answer", "category", "unanswerable", "evidenceSessionIds", "evidenceTurnIds"], "scoring question");
    const source = input.questions.find(s => s.id === q.id);
    if (source === undefined) fail("foreign scoring question");
    same({ id: q.id, corpusId: q.corpusId, question: q.question, questionDate: q.questionDate }, source, "scoring question source changed");
    if (typeof q.unanswerable !== "boolean" || !Array.isArray(q.evidenceSessionIds) || !Array.isArray(q.evidenceTurnIds)
      || q.evidenceSessionIds.length > 8192 || q.evidenceTurnIds.length > 8192) fail("scorer labels");
    return { ...source, answer: text(q.answer, 16_384, true), category: text(q.category, 512), unanswerable: q.unanswerable,
      evidenceSessionIds: q.evidenceSessionIds.map(id => text(id, 512)), evidenceTurnIds: q.evidenceTurnIds.map(id => text(id, 512)) };
  }); unique(questions.map(q => q.id)); return new Map(questions.map(q => [q.id, q]));
}
function accounting(attempts: readonly SelectorLaneAttempt[]) {
  const uniqueAttempts = [...new Map(attempts.map(a => [a.request.requestSha256, a])).values()];
  return { physicalRequests: uniqueAttempts.length, occupiedRequests: uniqueAttempts.filter(a => a.response !== null || a.failure !== null).length,
    newlyOccupied: uniqueAttempts.filter(a => a.newlyOccupied).length, cacheHits: uniqueAttempts.filter(a => a.cached).length,
    completed: uniqueAttempts.filter(a => a.response?.status === "completed").length,
    failed: uniqueAttempts.filter(a => a.failure !== null || a.response !== null && a.response.status !== "completed").length,
    notRun: uniqueAttempts.filter(a => a.notRun !== null).length,
    confirmedMicros: uniqueAttempts.reduce((s, a) => s + (a.response?.usage.micros ?? 0), 0),
    unresolvedMicros: uniqueAttempts.reduce((s, a) => s + (a.failure?.reservationMicros ?? 0), 0),
    exposureMicros: uniqueAttempts.reduce((s, a) => s + (a.response?.usage.micros ?? a.failure?.reservationMicros ?? 0), 0),
    originalServiceMs: uniqueAttempts.reduce((s, a) => s + (a.serviceMs ?? 0), 0),
    missingServiceTimes: uniqueAttempts.filter(a => a.serviceMs === null).length };
}
/** Runs one complete fixed denominator matrix. A single canonical store and cap cover every phase.
 * fetcher is an explicit offline test seam, never a credential or accounting bypass. */
export async function runSelectorLane(options: Readonly<{ configPin: EvolutionPin; planPin: EvolutionPin;
  credential: EvolutionCredential; fetcher?: (url: string, init: RequestInit) => Promise<Response>; stopped?: () => boolean }>) {
  const started = performance.now(), { config, source, input } = await sourceInputs(options.configPin);
  if (options.fetcher === undefined && source.dirty) fail("paid execution requires clean committed source");
  const plan = await makePlan(config, input); same(await json(options.planPin, 128 * 1024 * 1024), plan, "prepared plan differs from pinned source/config/native retrieval");
  await Promise.all([readEvolutionPin(options.configPin), readEvolutionPin(config.sourcePin, SELECTOR_LANE_SOURCE_MAX_BYTES), readEvolutionPin(config.scorerPin, 32 * 1024 * 1024)]);
  const authority = await verifyEvolutionCampaign(config.campaignPin);
  if (options.credential.kind !== "gateway-oidc") fail("selected project OIDC required");
  same(options.credential.auth, authority.auth, "selected campaign identity");
  const store = await openEvolutionStore({ directory: authority.campaign.storeDirectory, campaign: authority.campaign });
  const attempts = new Map<string, SelectorLaneAttempt>(), inflight = new Map<string, Promise<SelectorLaneAttempt>>();
  const before = store.summary(); let newCalls = 0, stopped = false;
  async function execute(phase: Phase, request: EvolutionRequest): Promise<SelectorLaneAttempt> {
    const key = request.requestSha256, existing = inflight.get(key); if (existing !== undefined) return existing;
    const pending = (async () => {
      const initial = store.lookup(request); let notRun: SelectorLaneAttempt["notRun"] = null;
      if (initial.kind === "miss" && (stopped || options.stopped?.())) notRun = "admission-stopped";
      else if (initial.kind === "miss" && newCalls >= config.maximumNewCalls) notRun = "call-limit";
      if (initial.kind === "miss" && notRun === null) newCalls++;
      if (notRun === null) {
        try { await invokeEvolutionRequest({ request, store, credential: options.credential,
          ...(options.fetcher === undefined ? {} : { fetcher: options.fetcher }), stopped: () => stopped || !!options.stopped?.() }); }
        catch { if (store.lookup(request).kind === "miss") { notRun = "admission-rejected"; stopped = true; } }
      }
      const current = store.lookup(request), response = current.kind === "hit" ? current.result : null;
      const failure = current.kind === "occupied" ? store.readAttemptFailure(request) : null;
      // Preserve the first uncertain reservation and stop new admissions after transport/provider rejection.
      if (failure !== null) stopped = true;
      const attempt: SelectorLaneAttempt = { phase, request, response, failure, notRun,
        cached: initial.kind !== "miss", newlyOccupied: initial.kind === "miss" && current.kind !== "miss",
        serviceMs: current.kind === "miss" ? null : current.kind === "occupied" && current.status === "reserved" ? null : store.readServiceMs(request) };
      authenticate(store, attempt); attempts.set(key, attempt); return attempt;
    })(); inflight.set(key, pending); return pending;
  }
  async function parallel<T>(items: readonly T[], work: (item: T) => Promise<void>) {
    let cursor = 0;
    const results = await Promise.allSettled(Array.from({ length: Math.min(config.concurrency, items.length) }, async () => {
      while (cursor < items.length) { const item = items[cursor++]!; await work(item); }
    }));
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (rejected !== undefined) throw rejected.reason;
  }
  const cases: ReaderCase[] = [];
  try {
    const factories = new Map(input.corpora.map(c => [c.id, prepareOhSourceSelector({ ...c, groupId: c.id })]));
    const selected = new Map<string, OhSelectedSourceContext>();
    await parallel(plan.cases, async c => {
      if (c.selector === null) return;
      const attempt = await execute("selector", c.selector.request), response = authenticate(store, attempt);
      if (response?.status !== "completed") return;
      const question = input.questions.find(q => q.id === c.questionId)!;
      try { selected.set(c.questionId, factories.get(question.corpusId)!.reconstruct(question, c.pool, c.pool.resultSha256,
        c.selector, store.readRaw(c.selector.request), response)); }
      catch (error) { if (!(error instanceof TypeError)) throw error; }
    });
    // Establish all cases before invoking any reader, retaining failures as explicit zero-score cases.
    for (const q of input.questions) for (const arm of ["native-control", "selected-sources"] as const) for (const reader of config.readers) {
      const prepared = plan.cases.find(c => c.questionId === q.id)!, context = selected.get(q.id);
      const value: SelectorLaneContext | null = arm === "native-control" ? { kind: arm, result: prepared.control }
        : context === undefined ? null : { kind: arm, result: context };
      const selectorAttempt = prepared.selector === null ? undefined : attempts.get(prepared.selector.request.requestSha256);
      const selectorStatus: ReaderCase["selectorStatus"] = arm === "native-control" ? "not-applicable"
        : prepared.selector === null ? "preparation-failed" : value !== null ? "completed"
        : selectorAttempt?.notRun !== null ? "not-run" : "failed";
      cases.push({ questionId: q.id, arm, reader, context: value,
        selectorRequestSha256: arm === "selected-sources" ? prepared.selector?.request.requestSha256 ?? null : null,
        selectorFailed: selectorStatus === "failed" || selectorStatus === "preparation-failed", selectorStatus,
        readerRequestSha256: null, readerFailed: false, readerStatus: value === null ? "skipped-selector" : "not-run",
        judgeRequestSha256: null, judgeFailed: false, judgeStatus: "skipped-reader", score: 0 });
    }
    await parallel(cases, async c => {
      if (c.context === null) return;
      const question = input.questions.find(q => q.id === c.questionId)!;
      const request = makeEvolutionRequest(c.reader, evolutionAnswerMessages(question, c.context.result.context, evolutionReaderContract(c.reader)));
      c.readerRequestSha256 = request.requestSha256;
      const attempt = await execute("reader", request), response = authenticate(store, attempt);
      c.readerStatus = attempt.notRun !== null ? "not-run" : response?.status === "completed" ? "completed" : "failed";
      c.readerFailed = c.readerStatus === "failed";
    });
    // Gold crosses only the scorer boundary after the entire selector/reader matrix has drained.
    const questions = await scorerQuestions(config.scorerPin, input), rubric = await loadJudgeProfile();
    if (rubric.sha256 !== EVOLUTION_LME_NATIVE_REFERENCE.parityRubricSha256) fail("native rubric pin changed");
    await parallel(cases, async c => {
      if (c.readerStatus !== "completed" || c.readerRequestSha256 === null) return;
      const reader = authenticate(store, attempts.get(c.readerRequestSha256)!);
      if (reader?.status !== "completed" || reader.answer === null) fail("reader changed before scoring");
      const request = makeEvolutionRequest(JUDGE, [{ role: "user", content: buildJudgePrompt(questions.get(c.questionId)!, reader.answer, rubric) }]);
      c.judgeRequestSha256 = request.requestSha256;
      const attempt = await execute("judge", request), response = authenticate(store, attempt);
      c.judgeStatus = attempt.notRun !== null ? "not-run" : response?.status === "completed" ? "completed" : "failed";
      c.judgeFailed = c.judgeStatus === "failed";
      c.score = c.judgeStatus === "completed" ? scoreEvolutionJudgeDecision(JUDGE, response!.answer) ?? 0 : 0;
    });
    for (const attempt of attempts.values()) authenticate(store, attempt);
    await Promise.all([readEvolutionPin(options.configPin), readEvolutionPin(options.planPin, 128 * 1024 * 1024), readEvolutionPin(config.sourcePin, SELECTOR_LANE_SOURCE_MAX_BYTES), readEvolutionPin(config.scorerPin, 32 * 1024 * 1024), readEvolutionPin(config.campaignPin)]);
    const finalSource = await codeIdentity(); if (finalSource.sourceSha256 !== source.sourceSha256) fail("execution source changed during run");
    const physical = [...attempts.values()].sort((a, b) => a.request.requestSha256 < b.request.requestSha256 ? -1 : 1);
    const phaseAccounting = Object.fromEntries((["selector", "reader", "judge"] as const).map(phase => [phase, accounting(physical.filter(a => a.phase === phase))]));
    const summaries = config.readers.flatMap(reader => (["native-control", "selected-sources"] as const).map(arm => {
      const rows = cases.filter(c => c.reader === reader && c.arm === arm);
      const ids = new Set(rows.flatMap(c => [c.selectorRequestSha256, c.readerRequestSha256, c.judgeRequestSha256].filter((s): s is string => s !== null)));
      const latency = rows.map(c => {
        if (c.judgeStatus !== "completed") return null;
        const requests = [...new Set([c.selectorRequestSha256, c.readerRequestSha256, c.judgeRequestSha256].filter((s): s is string => s !== null))];
        const times = requests.map(id => attempts.get(id)!.serviceMs); return times.some(t => t === null) ? null : times.reduce<number>((sum, t) => sum + t!, 0);
      });
      return { reader, arm, denominator: input.questions.length, correct: rows.reduce((s, c) => s + c.score, 0),
        accuracy: rows.reduce((s, c) => s + c.score, 0) / input.questions.length,
        failedCases: rows.filter(c => c.judgeStatus !== "completed").length,
        selectorFailures: rows.filter(c => c.selectorFailed).length, readerFailures: rows.filter(c => c.readerFailed).length,
        judgeFailures: rows.filter(c => c.judgeFailed).length,
        skippedReaders: rows.filter(c => c.readerStatus === "skipped-selector").length,
        skippedJudges: rows.filter(c => c.judgeStatus === "skipped-reader").length,
        notRunSelectors: rows.filter(c => c.selectorStatus === "not-run").length,
        notRunReaders: rows.filter(c => c.readerStatus === "not-run").length,
        notRunJudges: rows.filter(c => c.judgeStatus === "not-run").length, accounting: accounting(physical.filter(a => ids.has(a.request.requestSha256))),
        originalEndToEndServiceMs: latency, missingEndToEndTimes: latency.filter(t => t === null).length };
    }));
    const paired = config.readers.map(reader => {
      const deltas = input.questions.map(q => {
        const left = cases.find(c => c.reader === reader && c.questionId === q.id && c.arm === "native-control")!;
        const right = cases.find(c => c.reader === reader && c.questionId === q.id && c.arm === "selected-sources")!;
        return { questionId: q.id, control: left.score, selected: right.score, delta: right.score - left.score };
      });
      return { reader, denominator: input.questions.length, meanDelta: deltas.reduce((s, c) => s + c.delta, 0) / input.questions.length,
        wins: deltas.filter(c => c.delta > 0).length, losses: deltas.filter(c => c.delta < 0).length, ties: deltas.filter(c => c.delta === 0).length, deltas };
    });
    const after = store.summary(), total = accounting(physical);
    if (after.calls - before.calls !== total.newlyOccupied) fail("physical admission reconciliation");
    const completeAttemptCoverage = physical.every(a => a.response !== null || a.failure !== null);
    const payload = { protocol: "oh.memory.source-selector-experiment-report.v1" as const, configPin: options.configPin, planPin: options.planPin,
      planSha256: plan.planSha256, executionSourceSha256: source.sourceSha256, sourcePin: config.sourcePin, scorerPin: config.scorerPin,
      campaignSha256: authority.campaignSha256, judge: JUDGE, rubricSha256: rubric.sha256, scoringRule: "native-contains-yes" as const,
      status: completeAttemptCoverage ? "complete" as const : "incomplete" as const,
      complete: completeAttemptCoverage, coverage: { completeCaseAccounting: true, completeAttemptCoverage,
        logicalCases: cases.length, expectedQuestionsPerArm: input.questions.length,
        occupiedRequests: total.occupiedRequests, notRunRequests: total.notRun }, stopped, denominator: input.questions.length, cases, attempts: physical, phases: phaseAccounting, total, summaries, paired,
      phaseCaseFailures: { selector: input.questions.filter(q => cases.some(c => c.questionId === q.id && c.selectorFailed)).length,
        reader: cases.filter(c => c.readerFailed).length, judge: cases.filter(c => c.judgeFailed).length },
      campaignBefore: before, campaignAfter: after, wallMs: performance.now() - started,
      latencyMeaning: "Original captured selector + reader + judge service time; cache reuse does not imply zero original cost or latency.",
      accountingMeaning: "Physical requests deduplicated globally; standalone arm costs include shared selectors and may not be summed. Missing and failed cases score zero." };
    return { ...payload, reportSha256: canonicalSha256(payload) };
  } finally { await Promise.allSettled(inflight.values()); await store.close(); }
}
