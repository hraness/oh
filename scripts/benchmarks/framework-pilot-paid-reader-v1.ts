import { canonicalJson, canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_READER_PROFILE_ID, makeEvolutionRequest,
  parseEvolutionResponse, type EvolutionRequest } from "./evolution-model";
import { renderFrameworkPilotReaderV1 } from "./framework-pilot-reader-v1";
import { FRAMEWORK_PILOT_REPORT_ARMS_V1 as ARMS, FRAMEWORK_PILOT_REPORT_TYPES_V1 as TYPES,
  FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1, type FrameworkPilotReportArmV1 as Arm,
  type FrameworkPilotReportQuestionTypeV1 as QuestionType } from "./framework-pilot-report-v1";

type Stage = "completed" | "failed" | "not-run";
type Case = Readonly<{ caseId: string; questionType: QuestionType; sourceSha256: string;
  query: Readonly<{ queryId: "q0001"; text: string; questionDate: string }>; querySha256: string }>;
type Context = Readonly<{ context: string; contextSha256: string; contextTokens: number;
  evidenceSha256: string; tokenizationSha256: string }>;
type Retrieval = Readonly<{ caseId: string; arm: Arm; status: Stage; searchMs: number | null;
  captureSha256: string | null; context: Context | null }>;
export type FrameworkPilotReaderFreezeInputV1 = Readonly<{
  protocol: "oh.framework-pilot-retrieval-freeze.v1"; sourceManifestSha256: string;
  judgeRubricSha256: string; judgeParserSha256: string; reportPlanSha256: string;
  cases: readonly Case[]; rows: readonly Retrieval[]; freezeSha256: string;
}>;
type Cell = Readonly<{ caseId: string; arm: Arm; requestSha256: string | null;
  disposition: "ready" | "failed" | "not-run";
  reason: null | "retrieval-failed" | "retrieval-not-run" | "context-preparation" | "request-bound" }>;
type Job = Readonly<{ key: string; repeat: 0; request: EvolutionRequest }>;

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
}
export const FRAMEWORK_PILOT_PAID_READER_POLICY_V1 = immutable({
  protocol: "oh.framework-pilot-paid-reader-policy.v1", maximumLogicalCells: 180, maximumPhysicalCalls: 180,
  readerProfileId: EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_READER_PROFILE_ID,
  judgeProfileId: "gpt4o-gateway-framework-pilot-16-alias-v1-judge", readerOutputTokens: 512, judgeOutputTokens: 16,
  qualification: "gateway-alias", snapshotPinned: false, repeat: 0, automaticRetries: 0, redirects: 0,
  maximumWaveSize: 4, wavePolicy: "fixed-prefix; previous-wave-fully-drained; unchanged-store-reservations",
  deduplication: "identical-request-digests-share-one-first-response; all-logical-cells-retained",
  priorTaskExposureMicros: 14_348_242, priorGlobalExposureMicros: 263_307_255,
  retainedV1UnresolvedMicros: 10_478, observedV1CostNotSettledMicros: 63, settledV2Micros: 176,
  taskCeilingMicros: 25_000_000, readerCapMicros: 9_000_000,
  requestTimeoutMs: 120_000, stopAdmissionMs: 900_000, ownerMaximumMs: 1_050_000,
  ownerRequirements: { signalsBeforeChildAcquisition: true, exceptionalPostSpawnCollection: true,
    stopThenDrainMs: 130_000, ownedKillAndCollectionMs: 10_000, retainedBytesPerLog: 65_536 },
  maximumPlanBytes: 64 * 1024 * 1024, maximumResultsBytes: 8 * 1024 * 1024,
  maximumAggregateRawBytes: 64 * 1024 * 1024,
  artifactAuthentication: "caller-must-verify-frozen-retrieval-and-closed-store-pins",
  processAndFinancialAuthority: "not-established-by-this-pure-helper",
  goldBarrier: "separate-gold-only-judge-preparation-requires-closed-reader-freeze",
} as const);
const POLICY = FRAMEWORK_PILOT_PAID_READER_POLICY_V1;
const FREEZE_KEYS = ["protocol", "sourceManifestSha256", "judgeRubricSha256", "judgeParserSha256", "reportPlanSha256", "cases", "rows", "freezeSha256"];
const PLAN_KEYS = ["protocol", "policySha256", "input", "cells", "jobs", "sumReservationMicros", "maximumFourReservationMicros", "planSha256"];
function fail(reason: string): never { throw new TypeError(`Framework pilot paid reader: ${reason}.`); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) fail("plain data record required");
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some(key => typeof key !== "string" || !keys.includes(key))) fail("unexpected fields");
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !("value" in field)) fail("data properties required");
    result[key] = field.value;
  }
  return result;
}
function list(value: unknown, maximum: number, minimum = maximum): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum
    || Reflect.ownKeys(value).length !== value.length + 1) fail("bounded dense array required");
  return Array.from({ length: value.length }, (_, index) => {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    if (!field?.enumerable || !("value" in field)) fail("array data properties required");
    return field.value;
  });
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum || Buffer.byteLength(value) > maximum || /\p{Surrogate}/u.test(value)) fail("bounded Unicode text required");
  return value;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("SHA256 required");
  return value;
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum || Object.is(value, -0)) fail("nonnegative bounded integer required");
  return value;
}
function duration(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) fail("nonnegative finite duration required");
  return value;
}
function stage(value: unknown): Stage {
  if (value !== "completed" && value !== "failed" && value !== "not-run") fail("unknown stage status");
  return value;
}
function size(value: unknown, maximum: number): void { if (Buffer.byteLength(canonicalJson(value)) > maximum) fail("artifact byte bound"); }

function parseFreeze(value: unknown): FrameworkPilotReaderFreezeInputV1 {
  const input = exact(value, FREEZE_KEYS);
  if (input.protocol !== "oh.framework-pilot-retrieval-freeze.v1" || input.reportPlanSha256 !== FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1) fail("freeze/report protocol mismatch");
  const cases = list(input.cases, 60).map((raw, index): Case => {
    const row = exact(raw, ["caseId", "questionType", "sourceSha256", "query", "querySha256"]);
    if (row.caseId !== `c${String(index + 1).padStart(4, "0")}` || !TYPES.some(type => row.questionType === type)) fail("ordered aliases or declared type required");
    const query = exact(row.query, ["queryId", "text", "questionDate"]);
    if (query.queryId !== "q0001") fail("neutral query alias required");
    const checked = { queryId: "q0001" as const, text: text(query.text, 16_384), questionDate: text(query.questionDate, 256) };
    if (checked.text.length === 0 || canonicalSha256(checked) !== digest(row.querySha256)) fail("query digest mismatch");
    return { caseId: row.caseId, questionType: row.questionType as QuestionType, sourceSha256: digest(row.sourceSha256), query: checked, querySha256: row.querySha256 as string };
  });
  for (const type of TYPES) if (cases.filter(row => row.questionType === type).length !== 10) fail("ten cases per question type required");
  const rows = list(input.rows, 180).map((raw, index): Retrieval => {
    const row = exact(raw, ["caseId", "arm", "status", "searchMs", "captureSha256", "context"]);
    if (row.caseId !== cases[Math.floor(index / 3)]!.caseId || row.arm !== ARMS[index % 3]) fail("complete ordered case-arm matrix required");
    const status = stage(row.status), searchMs = duration(row.searchMs);
    const captureSha256 = row.captureSha256 === null ? null : digest(row.captureSha256);
    if (status === "completed" && (searchMs === null || captureSha256 === null)
      || status === "not-run" && searchMs !== null || status !== "completed" && row.context !== null) fail("retrieval status conflicts with evidence");
    let context: Context | null = null;
    if (row.context !== null) {
      const c = exact(row.context, ["context", "contextSha256", "contextTokens", "evidenceSha256", "tokenizationSha256"]);
      context = { context: text(c.context, 262_144), contextSha256: digest(c.contextSha256), contextTokens: integer(c.contextTokens, 8192),
        evidenceSha256: digest(c.evidenceSha256), tokenizationSha256: digest(c.tokenizationSha256) };
      if (sha256Hex(context.context) !== context.contextSha256) fail("context digest mismatch");
    }
    return { caseId: row.caseId as string, arm: row.arm as Arm, status, searchMs, captureSha256, context };
  });
  const body = { protocol: "oh.framework-pilot-retrieval-freeze.v1" as const, sourceManifestSha256: digest(input.sourceManifestSha256),
    judgeRubricSha256: digest(input.judgeRubricSha256), judgeParserSha256: digest(input.judgeParserSha256), reportPlanSha256: input.reportPlanSha256 as string, cases, rows };
  size(body, POLICY.maximumPlanBytes);
  if (canonicalSha256(body) !== digest(input.freezeSha256)) fail("retrieval freeze changed");
  return { ...body, freezeSha256: input.freezeSha256 as string };
}

/** Pure preparation, not provenance or live admission. A null context after a
 * successful search is an explicit evidence-preparation failure; no replacement
 * or shortened context is invented. Empty successful contexts remain eligible. */
export function prepareFrameworkPilotReaderPlanV1(value: unknown) {
  const input = parseFreeze(value), jobs = new Map<string, Job>(), cells: Cell[] = [];
  const ordered = Array.from({ length: 10 }, (_, index) => TYPES.map(type => input.cases.filter(row => row.questionType === type)[index]!)).flat();
  const retrieval = new Map(input.rows.map(row => [`${row.caseId}:${row.arm}`, row] as const));
  for (const row of ordered) {
    const rotation = (Number(row.caseId.slice(1)) - 1) % 3;
    for (let index = 0; index < 3; index++) {
      const arm = ARMS[(index + rotation) % 3]!, source = retrieval.get(`${row.caseId}:${arm}`)!;
      const base = { caseId: row.caseId, arm, requestSha256: null };
      if (source.status !== "completed") {
        cells.push({ ...base, disposition: "not-run", reason: source.status === "failed" ? "retrieval-failed" : "retrieval-not-run" }); continue;
      }
      if (source.context === null) { cells.push({ ...base, disposition: "failed", reason: "context-preparation" }); continue; }
      const rendered = renderFrameworkPilotReaderV1({ protocol: "oh.framework-pilot-reader-input.v1", question: row.query.text,
        questionDate: row.query.questionDate, context: source.context.context, contextSha256: source.context.contextSha256, contextTokens: source.context.contextTokens });
      let request: EvolutionRequest;
      try { request = makeEvolutionRequest(POLICY.readerProfileId, rendered.messages); }
      catch (error) {
        if (!(error instanceof TypeError) || error.message !== "Evolution model: conservative context bound exceeded.") throw error;
        cells.push({ ...base, disposition: "failed", reason: "request-bound" }); continue;
      }
      if (!jobs.has(request.requestSha256)) jobs.set(request.requestSha256, { key: request.requestSha256, repeat: 0, request });
      cells.push({ ...base, requestSha256: request.requestSha256, disposition: "ready", reason: null });
    }
  }
  const physical = [...jobs.values()], reservations = physical.map(job => job.request.reservationMicros);
  const body = { protocol: "oh.framework-pilot-reader-plan.v1" as const, policySha256: canonicalSha256(POLICY), input, cells, jobs: physical,
    sumReservationMicros: reservations.reduce((sum, value) => sum + value, 0),
    maximumFourReservationMicros: [...reservations].sort((a, b) => b - a).slice(0, 4).reduce((sum, value) => sum + value, 0) };
  size(body, POLICY.maximumPlanBytes);
  return immutable({ ...body, planSha256: canonicalSha256(body) });
}
export type FrameworkPilotReaderPlanV1 = ReturnType<typeof prepareFrameworkPilotReaderPlanV1>;

/** Reconstruct instead of trusting a resealed request, changed limit or mapping. */
export function validateFrameworkPilotReaderPlanV1(value: unknown): FrameworkPilotReaderPlanV1 {
  const plan = exact(value, PLAN_KEYS), expected = prepareFrameworkPilotReaderPlanV1(plan.input);
  // Bound and compare derived fields without traversing arbitrary supplied objects.
  for (const key of ["protocol", "policySha256", "sumReservationMicros", "maximumFourReservationMicros", "planSha256"]) {
    if (plan[key] !== expected[key as keyof typeof expected]) fail("derived plan identity changed");
  }
  const cells = list(plan.cells, 180), jobs = list(plan.jobs, expected.jobs.length);
  cells.forEach((row, index) => {
    const fields = exact(row, ["caseId", "arm", "requestSha256", "disposition", "reason"]), wanted = expected.cells[index]!;
    for (const key of Object.keys(wanted)) if (fields[key] !== wanted[key as keyof Cell]) fail("cell mapping changed");
  });
  jobs.forEach((row, index) => {
    const job = exact(row, ["key", "repeat", "request"]), wanted = expected.jobs[index]!;
    if (job.key !== wanted.key || job.repeat !== 0) fail("physical identity changed");
    // Exact serialized equality is bounded before parsing any supplied request.
    sameRequest(job.request, wanted.request);
  });
  return expected;
}
function sameRequest(value: unknown, expected: EvolutionRequest): void {
  const row = exact(value, Object.keys(expected));
  for (const key of Object.keys(expected).filter(key => key !== "body")) if (row[key] !== expected[key as keyof EvolutionRequest]) fail("request identity changed");
  const body = exact(row.body, Object.keys(expected.body));
  for (const key of ["model", "stream", "store", "max_tokens", "temperature"]) if (body[key] !== expected.body[key as keyof typeof expected.body]) fail("request settings changed");
  const messages = list(body.messages, 1), message = exact(messages[0], ["role", "content"]);
  if (message.role !== "user" || text(message.content, 262_144) !== expected.body.messages[0]!.content) fail("request prompt changed");
  const provider = exact(body.providerOptions, ["gateway"]), route = exact(provider.gateway, ["only", "order"]);
  for (const key of ["only", "order"]) if (list(route[key], 1)[0] !== "openai") fail("request provider changed");
}

type Charge = Readonly<{ requestSha256: string; state: "settled" | "held"; chargeMicros: number }>;
function charges(value: unknown, plan: FrameworkPilotReaderPlanV1): readonly Charge[] {
  return list(value, plan.jobs.length, 0).map((raw, index) => {
    const row = exact(raw, ["requestSha256", "state", "chargeMicros"]), job = plan.jobs[index]!;
    if (row.requestSha256 !== job.key || row.state !== "settled" && row.state !== "held") fail("drained prefix identity required");
    const chargeMicros = integer(row.chargeMicros, job.request.reservationMicros);
    if (row.state === "held" && chargeMicros !== job.request.reservationMicros) fail("unresolved reservation cannot be released");
    return { requestSha256: job.key, state: row.state, chargeMicros };
  });
}

/** Snapshot arithmetic only. The caller must authenticate closedWave/charges
 * against its owned store. This grants no dispatch or process authority. */
export function selectFrameworkPilotReaderWaveV1(planInput: unknown, stateInput: unknown) {
  const plan = validateFrameworkPilotReaderPlanV1(planInput);
  const state = exact(stateInput, ["planSha256", "previousWaveDrained", "charges", "stopped", "elapsedMs"]);
  if (state.planSha256 !== plan.planSha256 || state.previousWaveDrained !== true || typeof state.stopped !== "boolean") fail("owned drained wave required");
  const elapsedMs = duration(state.elapsedMs); if (elapsedMs === null) fail("elapsed time required");
  const previous = charges(state.charges, plan), exposureMicros = previous.reduce((sum, row) => sum + row.chargeMicros, 0);
  if (exposureMicros > POLICY.readerCapMicros) fail("reader cap exceeded");
  let stopReason: "stopped" | "deadline" | "unresolved" | "complete" | "budget-cap" | null = state.stopped ? "stopped"
    : elapsedMs >= POLICY.stopAdmissionMs ? "deadline" : previous.some(row => row.state === "held") ? "unresolved"
      : previous.length === plan.jobs.length ? "complete" : null;
  const jobs: Job[] = []; let reservationMicros = 0;
  if (stopReason === null) for (const job of plan.jobs.slice(previous.length, previous.length + 4)) {
    if (exposureMicros + reservationMicros + job.request.reservationMicros > POLICY.readerCapMicros) break;
    jobs.push(job); reservationMicros += job.request.reservationMicros;
  }
  if (stopReason === null && jobs.length === 0) stopReason = "budget-cap";
  return immutable({ protocol: "oh.framework-pilot-reader-wave.v1", planSha256: plan.planSha256,
    previousPhysicalJobs: previous.length, exposureMicros, reservationMicros, jobs, stopReason });
}

export type FrameworkPilotReaderPhysicalOutcomeV1 = Readonly<{ requestSha256: string; state: "settled";
  raw: Uint8Array; chargeMicros: number; serviceMs: number }> | Readonly<{ requestSha256: string; state: "held";
  rawSha256: string | null; rawBytes: number | null; chargeMicros: number; serviceMs: number | null }>
  | Readonly<{ requestSha256: string; state: "not-run"; reason: "stopped" | "deadline" | "budget-cap" | "operational-halt" }>;

/** Parse exact first-response bytes with the unchanged public parser. A private
 * owner must independently join these projections to its closed immutable store;
 * this function does not settle, retry, open a store or read gold. */
export function freezeFrameworkPilotReaderResultsV1(planInput: unknown, input: unknown) {
  const plan = validateFrameworkPilotReaderPlanV1(planInput), evidence = exact(input, ["planSha256", "storeClosed", "ownerCollected", "databaseSha256", "outcomes"]);
  if (evidence.planSha256 !== plan.planSha256 || evidence.storeClosed !== true || evidence.ownerCollected !== true) fail("closed reader phase required before judge preparation");
  const databaseSha256 = plan.jobs.length === 0 && evidence.databaseSha256 === null ? null : digest(evidence.databaseSha256);
  let rawBytes = 0, confirmedMicros = 0, unresolvedMicros = 0, pending = false;
  const physical = list(evidence.outcomes, plan.jobs.length).map((raw, index) => {
    if (!isPlainRecord(raw)) fail("physical outcome record required");
    const state = Object.getOwnPropertyDescriptor(raw, "state");
    if (!state?.enumerable || !("value" in state)) fail("outcome data state required");
    const job = plan.jobs[index]!;
    if (state.value === "not-run") {
      const row = exact(raw, ["requestSha256", "state", "reason"]);
      if (row.requestSha256 !== job.key || typeof row.reason !== "string"
        || !["stopped", "deadline", "budget-cap", "operational-halt"].includes(row.reason)) fail("not-run identity/reason");
      pending = true;
      return { requestSha256: job.key, status: "not-run" as const, reason: row.reason as string, answer: null,
        answerSha256: null, rawSha256: null, rawBytes: null, chargeMicros: 0, heldMicros: 0, serviceMs: null };
    }
    if (pending) fail("started outcomes must form the frozen schedule prefix");
    if (state.value === "held") {
      const row = exact(raw, ["requestSha256", "state", "rawSha256", "rawBytes", "chargeMicros", "serviceMs"]);
      if (row.requestSha256 !== job.key || row.chargeMicros !== job.request.reservationMicros) fail("held identity/reservation mismatch");
      const hash = row.rawSha256 === null ? null : digest(row.rawSha256), bytes = row.rawBytes === null ? null : integer(row.rawBytes, 2 * 1024 * 1024);
      if ((hash === null) !== (bytes === null)) fail("held raw identity mismatch");
      rawBytes += bytes ?? 0; if (rawBytes > POLICY.maximumAggregateRawBytes) fail("aggregate raw byte bound");
      const serviceMs = duration(row.serviceMs); if (hash === null && serviceMs !== null) fail("uncaptured response cannot have service timing");
      unresolvedMicros += job.request.reservationMicros;
      return { requestSha256: job.key, status: "failed" as const, reason: "unresolved-first-attempt", answer: null,
        answerSha256: null, rawSha256: hash, rawBytes: bytes, chargeMicros: job.request.reservationMicros, heldMicros: job.request.reservationMicros, serviceMs };
    }
    if (state.value !== "settled") fail("unknown physical state");
    const row = exact(raw, ["requestSha256", "state", "raw", "chargeMicros", "serviceMs"]);
    if (row.requestSha256 !== job.key || !(row.raw instanceof Uint8Array) || row.raw.byteLength > 1_048_576) fail("settled raw identity/bound");
    rawBytes += row.raw.byteLength; if (rawBytes > POLICY.maximumAggregateRawBytes) fail("aggregate raw byte bound");
    const result = parseEvolutionResponse(row.raw, job.request), serviceMs = duration(row.serviceMs);
    if (row.chargeMicros !== result.usage.micros || serviceMs === null) fail("settled charge/timing mismatch");
    confirmedMicros += result.usage.micros;
    const completed = result.status === "completed";
    return { requestSha256: job.key, status: completed ? "completed" as const : "failed" as const,
      reason: completed ? null : result.failureReason ?? result.status, answer: completed ? result.answer : null,
      answerSha256: completed ? sha256Hex(result.answer!) : null, rawSha256: result.rawSha256, rawBytes: result.rawBytes,
      chargeMicros: result.usage.micros, heldMicros: 0, serviceMs };
  });
  const exposureMicros = confirmedMicros + unresolvedMicros;
  if (exposureMicros > POLICY.readerCapMicros) fail("closed reader exposure exceeds cap");
  const outcomes = new Map(physical.map(row => [row.requestSha256, row])), cells = new Map(plan.cells.map(row => [`${row.caseId}:${row.arm}`, row]));
  const rows = plan.input.rows.map(retrieval => {
    const cell = cells.get(`${retrieval.caseId}:${retrieval.arm}`)!, result = cell.requestSha256 === null ? null : outcomes.get(cell.requestSha256)!;
    return { caseId: retrieval.caseId, arm: retrieval.arm, retrievalStatus: retrieval.status, searchMs: retrieval.searchMs,
      readerStatus: result?.status ?? cell.disposition as Stage, requestSha256: cell.requestSha256,
      answer: result?.answer ?? null, answerSha256: result?.answerSha256 ?? null, reason: result?.reason ?? cell.reason,
      judgeStatus: "not-run" as const, verdict: null };
  });
  const body = { protocol: "oh.framework-pilot-reader-results.v1", planSha256: plan.planSha256,
    retrievalFreezeSha256: plan.input.freezeSha256, databaseSha256, coverageComplete: true, allReadersCompleted: rows.every(row => row.readerStatus === "completed"),
    storeClosed: true, ownerCollected: true, authentication: POLICY.artifactAuthentication,
    cases: plan.input.cases.map(({ caseId, questionType }) => ({ caseId, questionType })), rows, physical,
    accounting: { unit: "USD-microdollars", confirmedMicros, unresolvedMicros, exposureMicros,
      totalTaskExposureMicros: POLICY.priorTaskExposureMicros + exposureMicros, totalGlobalExposureMicros: POLICY.priorGlobalExposureMicros + exposureMicros,
      maximumJudgeAllocationMicros: POLICY.taskCeilingMicros - POLICY.priorTaskExposureMicros - exposureMicros },
    judgePreparation: { separateGoldOnlyProcessRequired: true, rubricSha256: plan.input.judgeRubricSha256,
      parserSha256: plan.input.judgeParserSha256, reportPlanSha256: plan.input.reportPlanSha256 } };
  size(body, POLICY.maximumResultsBytes);
  return immutable({ ...body, resultsSha256: canonicalSha256(body) });
}
