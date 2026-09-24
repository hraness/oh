import { canonicalJson, canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { EVOLUTION_LME_NATIVE_REFERENCE } from "./evolution-judge";
import { EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_JUDGE_PROFILE_ID, makeEvolutionRequest,
  parseEvolutionResponse, type EvolutionRequest } from "./evolution-model";
import { FRAMEWORK_PILOT_PAID_READER_POLICY_V1 as READER, freezeFrameworkPilotReaderResultsV1,
  validateFrameworkPilotReaderPlanV1 } from "./framework-pilot-paid-reader-v1";
import type { FrameworkPilotReportArmV1 as Arm, FrameworkPilotReportInputV1,
  FrameworkPilotReportStageStatusV1 as Stage } from "./framework-pilot-report-v1";
import { buildJudgePrompt, parseJudgeDecision } from "./judge";

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
}
export const FRAMEWORK_PILOT_PAID_JUDGE_POLICY_V1 = immutable({
  protocol: "oh.framework-pilot-paid-judge-policy.v1", profileId: EVOLUTION_FRAMEWORK_PILOT_GATEWAY_ALIAS_JUDGE_PROFILE_ID,
  rubricSha256: EVOLUTION_LME_NATIVE_REFERENCE.parityRubricSha256,
  parserSourceSha256: "ff93c4ed99762cfe40de5f23c3f6807703eaaa9a364ff056cca80fe6cfbecdb4",
  scoring: "existing-parseJudgeDecision; completed-responses-only; no-abstention-shortcut",
  nativeAdaptation: "native-LongMemEval-prompts; strict-yes-no; unpinned-Gateway-alias; 16-output-tokens",
  qualification: "gateway-alias", snapshotPinned: false, maximumOutputTokens: 16,
  maximumLogicalCells: 180, maximumPhysicalCalls: 180, repeat: 0, automaticRetries: 0, redirects: 0,
  maximumWaveSize: READER.maximumWaveSize, wavePolicy: READER.wavePolicy, deduplication: READER.deduplication,
  requestTimeoutMs: READER.requestTimeoutMs, stopAdmissionMs: READER.stopAdmissionMs, ownerMaximumMs: READER.ownerMaximumMs,
  ownerRequirements: READER.ownerRequirements, maximumPlanBytes: READER.maximumPlanBytes,
  maximumResultsBytes: READER.maximumResultsBytes, maximumAggregateRawBytes: READER.maximumAggregateRawBytes,
  priorTaskExposureMicros: READER.priorTaskExposureMicros, priorGlobalExposureMicros: READER.priorGlobalExposureMicros,
  taskCeilingMicros: READER.taskCeilingMicros,
  allocation: "task-ceiling-minus-prior-task-and-closed-reader-confirmed-plus-held-exposure",
  authentication: "caller-authenticates-source-closure-frozen-reader-store-owner-and-gold-projection; helper-checks-bindings-only",
  goldProjection: "neutral-case/query/type-join; finite-number-reference-to-String; caller-proves-original-id-_abs-semantics",
} as const);
const POLICY = FRAMEWORK_PILOT_PAID_JUDGE_POLICY_V1;
type Cell = Readonly<{ caseId: string; arm: Arm; requestSha256: string | null; disposition: "ready" | "failed" | "not-run";
  reason: null | "reader-failed" | "reader-not-run" | "request-bound" }>;
type Job = Readonly<{ key: string; repeat: 0; request: EvolutionRequest }>;
function fail(reason: string): never { throw new TypeError(`Framework pilot paid judge: ${reason}.`); }
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
function size(value: unknown, maximum: number): void { if (Buffer.byteLength(canonicalJson(value)) > maximum) fail("artifact byte bound"); }

/** This barrier checks complete first captures through the existing reader parser
 * and binds an explicit caller audit. It cannot authenticate a caller's receipts,
 * source code, store closure or process custody. The separate private gold-only
 * process must establish those facts before providing this input. */
function preparation(value: unknown) {
  const input = exact(value, ["readerPlan", "readerEvidence", "readerAudit", "rubricText", "gold"]);
  const readerPlan = validateFrameworkPilotReaderPlanV1(input.readerPlan);
  const reader = freezeFrameworkPilotReaderResultsV1(readerPlan, input.readerEvidence);
  const audit = exact(input.readerAudit, ["protocol", "authenticated", "readerPlanSha256", "readerResultsSha256",
    "readerDatabaseSha256", "readerSourceClosureSha256", "closedStoreAuditSha256", "ownerReceiptSha256"]);
  if (audit.protocol !== "oh.framework-pilot-reader-authentication.v1" || audit.authenticated !== true
    || audit.readerPlanSha256 !== readerPlan.planSha256 || audit.readerResultsSha256 !== reader.resultsSha256
    || audit.readerDatabaseSha256 !== reader.databaseSha256) fail("authenticated closed reader audit required before gold");
  for (const key of ["readerSourceClosureSha256", "closedStoreAuditSha256", "ownerReceiptSha256"]) digest(audit[key]);
  if (readerPlan.input.judgeRubricSha256 !== POLICY.rubricSha256 || readerPlan.input.judgeParserSha256 !== POLICY.parserSourceSha256) fail("pre-reader judge pins changed");
  // Gold is not inspected until the complete reader and audit barriers above pass.
  const rubricText = text(input.rubricText, 32_768);
  if (sha256Hex(rubricText) !== POLICY.rubricSha256) fail("native rubric bytes changed");
  const rubric = JSON.parse(rubricText) as { profileId: string; source: string; templates: Record<string, string> };
  const gold = exact(input.gold, ["protocol", "sourceManifestSha256", "sourceDatasetSha256", "privateMapSha256", "rows", "projectionSha256"]);
  if (gold.protocol !== "oh.framework-pilot-gold-projection.v1" || gold.sourceManifestSha256 !== readerPlan.input.sourceManifestSha256) fail("gold source manifest changed");
  const rows = list(gold.rows, 60).map((raw, index) => {
    const row = exact(raw, ["caseId", "querySha256", "questionType", "reference", "unanswerable"]), source = readerPlan.input.cases[index]!;
    if (row.caseId !== source.caseId || row.querySha256 !== source.querySha256 || row.questionType !== source.questionType
      || typeof row.unanswerable !== "boolean") fail("complete ordered gold join required");
    // Native dataset semantics normalize finite numbers, including -0, to strings.
    const reference = typeof row.reference === "number" && Number.isFinite(row.reference) ? String(row.reference) : text(row.reference, 524_288);
    return { caseId: source.caseId, querySha256: source.querySha256, questionType: source.questionType, reference, unanswerable: row.unanswerable };
  });
  const projection = { protocol: "oh.framework-pilot-gold-projection.v1", sourceManifestSha256: readerPlan.input.sourceManifestSha256,
    sourceDatasetSha256: digest(gold.sourceDatasetSha256), privateMapSha256: digest(gold.privateMapSha256), rows };
  size(projection, POLICY.maximumPlanBytes);
  if (canonicalSha256(projection) !== digest(gold.projectionSha256)) fail("normalized gold projection changed");
  return { readerPlan, reader, auditSha256: canonicalSha256(audit), gold: projection, goldProjectionSha256: gold.projectionSha256 as string,
    rubric: { ...rubric, sha256: POLICY.rubricSha256 } };
}

/** Pure evaluator-only preparation. Gold-bearing requests stay private; a closed
 * result matrix includes failures and does not imply every reader succeeded. */
export function prepareFrameworkPilotJudgePlanV1(input: unknown) {
  const checked = preparation(input), jobs = new Map<string, Job>(), cells: Cell[] = [];
  const readers = new Map(checked.reader.rows.map(row => [`${row.caseId}:${row.arm}`, row])), gold = new Map(checked.gold.rows.map(row => [row.caseId, row]));
  const questions = new Map(checked.readerPlan.input.cases.map(row => [row.caseId, row]));
  for (const scheduled of checked.readerPlan.cells) {
    const row = readers.get(`${scheduled.caseId}:${scheduled.arm}`)!, reference = gold.get(row.caseId)!, source = questions.get(row.caseId)!;
    const base = { caseId: row.caseId, arm: row.arm, requestSha256: null };
    if (row.readerStatus !== "completed") {
      cells.push({ ...base, disposition: "not-run", reason: row.readerStatus === "failed" ? "reader-failed" : "reader-not-run" }); continue;
    }
    const prompt = buildJudgePrompt({ id: row.caseId, corpusId: row.caseId, category: reference.questionType,
      question: source.query.text, questionDate: source.query.questionDate, answer: reference.reference,
      unanswerable: reference.unanswerable, evidenceTurnIds: [], evidenceSessionIds: [] }, row.answer!, checked.rubric);
    let request: EvolutionRequest;
    if (prompt.length > 1_048_576) { cells.push({ ...base, disposition: "failed", reason: "request-bound" }); continue; }
    try { request = makeEvolutionRequest(POLICY.profileId, [{ role: "user", content: prompt }]); }
    catch (error) {
      if (!(error instanceof TypeError) || error.message !== "Evolution model: conservative context bound exceeded.") throw error;
      cells.push({ ...base, disposition: "failed", reason: "request-bound" }); continue;
    }
    if (!jobs.has(request.requestSha256)) jobs.set(request.requestSha256, { key: request.requestSha256, repeat: 0, request });
    cells.push({ ...base, requestSha256: request.requestSha256, disposition: "ready", reason: null });
  }
  const physical = [...jobs.values()], reservations = physical.map(job => job.request.reservationMicros);
  const body = { protocol: "oh.framework-pilot-judge-plan.v1" as const, policySha256: canonicalSha256(POLICY),
    readerPlanSha256: checked.readerPlan.planSha256, readerResultsSha256: checked.reader.resultsSha256, readerAuditSha256: checked.auditSha256,
    goldProjectionSha256: checked.goldProjectionSha256, judgeRubricSha256: POLICY.rubricSha256, judgeParserSha256: POLICY.parserSourceSha256,
    reportPlanSha256: checked.readerPlan.input.reportPlanSha256, maximumJudgeAllocationMicros: checked.reader.accounting.maximumJudgeAllocationMicros,
    cells, jobs: physical, sumReservationMicros: reservations.reduce((sum, amount) => sum + amount, 0),
    maximumFourReservationMicros: [...reservations].sort((a, b) => b - a).slice(0, 4).reduce((sum, amount) => sum + amount, 0) };
  size(body, POLICY.maximumPlanBytes);
  return immutable({ ...body, planSha256: canonicalSha256(body) });
}
export type FrameworkPilotJudgePlanV1 = ReturnType<typeof prepareFrameworkPilotJudgePlanV1>;

// Traverse only the bounded, freshly reconstructed shape, never arbitrary input.
function same(value: unknown, expected: unknown): void {
  if (Array.isArray(expected)) { list(value, expected.length).forEach((child, index) => same(child, expected[index])); return; }
  if (isPlainRecord(expected)) {
    const keys = Object.keys(expected), checked = exact(value, keys);
    for (const key of keys) same(checked[key], expected[key]);
  } else if (value !== expected) fail("reconstructed plan changed");
}
export function validateFrameworkPilotJudgePlanV1(plan: unknown, preparationInput: unknown): FrameworkPilotJudgePlanV1 {
  const expected = prepareFrameworkPilotJudgePlanV1(preparationInput); same(plan, expected); return expected;
}

/** Arithmetic over an authenticated closed-wave projection only. No dispatch,
 * store mutation, retry, settlement or owner/process authority is implemented. */
export function selectFrameworkPilotJudgeWaveV1(planInput: unknown, preparationInput: unknown, stateInput: unknown) {
  const plan = validateFrameworkPilotJudgePlanV1(planInput, preparationInput);
  const state = exact(stateInput, ["planSha256", "previousWaveDrained", "charges", "stopped", "elapsedMs"]);
  if (state.planSha256 !== plan.planSha256 || state.previousWaveDrained !== true || typeof state.stopped !== "boolean") fail("owned drained wave required");
  const elapsedMs = duration(state.elapsedMs); if (elapsedMs === null) fail("elapsed time required");
  const previous = list(state.charges, plan.jobs.length, 0).map((raw, index) => {
    const row = exact(raw, ["requestSha256", "state", "chargeMicros"]), job = plan.jobs[index]!;
    if (row.requestSha256 !== job.key || row.state !== "settled" && row.state !== "held") fail("drained prefix identity required");
    const chargeMicros = integer(row.chargeMicros, job.request.reservationMicros);
    if (row.state === "held" && chargeMicros !== job.request.reservationMicros) fail("unresolved reservation cannot be released");
    return { state: row.state, chargeMicros };
  });
  const exposureMicros = previous.reduce((sum, row) => sum + row.chargeMicros, 0);
  if (exposureMicros > plan.maximumJudgeAllocationMicros) fail("judge cap exceeded");
  let stopReason: "stopped" | "deadline" | "unresolved" | "complete" | "budget-cap" | null = state.stopped ? "stopped"
    : elapsedMs >= POLICY.stopAdmissionMs ? "deadline" : previous.some(row => row.state === "held") ? "unresolved"
      : previous.length === plan.jobs.length ? "complete" : null;
  const jobs: Job[] = []; let reservationMicros = 0;
  if (stopReason === null) for (const job of plan.jobs.slice(previous.length, previous.length + POLICY.maximumWaveSize)) {
    if (exposureMicros + reservationMicros + job.request.reservationMicros > plan.maximumJudgeAllocationMicros) break;
    jobs.push(job); reservationMicros += job.request.reservationMicros;
  }
  if (stopReason === null && jobs.length === 0) stopReason = "budget-cap";
  return immutable({ protocol: "oh.framework-pilot-judge-wave.v1", planSha256: plan.planSha256,
    previousPhysicalJobs: previous.length, exposureMicros, reservationMicros, jobs, stopReason });
}

/** Closed first-response projection. The caller authenticates the judge store and
 * collected owner separately. Invalid verdicts retain their confirmed charges;
 * unknown outcomes retain the entire reservation. No partial answer is scored. */
export function freezeFrameworkPilotJudgeResultsV1(planInput: unknown, preparationInput: unknown, evidenceInput: unknown) {
  const plan = validateFrameworkPilotJudgePlanV1(planInput, preparationInput), checked = preparation(preparationInput);
  const evidence = exact(evidenceInput, ["planSha256", "storeClosed", "ownerCollected", "databaseSha256", "outcomes"]);
  if (evidence.planSha256 !== plan.planSha256 || evidence.storeClosed !== true || evidence.ownerCollected !== true) fail("closed collected judge required");
  const databaseSha256 = plan.jobs.length === 0 && evidence.databaseSha256 === null ? null : digest(evidence.databaseSha256);
  let rawBytes = 0, confirmedMicros = 0, unresolvedMicros = 0, pending = false;
  const captureBytes = (bytes: number) => { rawBytes += bytes; if (rawBytes > POLICY.maximumAggregateRawBytes) fail("aggregate raw byte bound"); };
  const physical = list(evidence.outcomes, plan.jobs.length).map((raw, index) => {
    if (!isPlainRecord(raw)) fail("physical outcome record required");
    const state = Object.getOwnPropertyDescriptor(raw, "state"), job = plan.jobs[index]!;
    if (!state?.enumerable || !("value" in state)) fail("outcome data state required");
    if (state.value === "not-run") {
      const row = exact(raw, ["requestSha256", "state", "reason"]);
      if (row.requestSha256 !== job.key || typeof row.reason !== "string" || !["stopped", "deadline", "budget-cap", "operational-halt"].includes(row.reason)) fail("not-run identity/reason");
      pending = true;
      return { requestSha256: job.key, status: "not-run" as const, reason: row.reason as string, verdict: null, rawSha256: null, rawBytes: null, chargeMicros: 0, heldMicros: 0, serviceMs: null };
    }
    if (pending) fail("started outcomes must form the frozen schedule prefix");
    if (state.value === "held") {
      const row = exact(raw, ["requestSha256", "state", "rawSha256", "rawBytes", "chargeMicros", "serviceMs"]);
      if (row.requestSha256 !== job.key || row.chargeMicros !== job.request.reservationMicros) fail("held identity/reservation mismatch");
      const hash = row.rawSha256 === null ? null : digest(row.rawSha256), bytes = row.rawBytes === null ? null : integer(row.rawBytes, 2 * 1024 * 1024);
      if ((hash === null) !== (bytes === null)) fail("held raw identity mismatch");
      const serviceMs = duration(row.serviceMs); if (hash === null && serviceMs !== null) fail("uncaptured response cannot have service timing");
      captureBytes(bytes ?? 0); unresolvedMicros += job.request.reservationMicros;
      return { requestSha256: job.key, status: "failed" as const, reason: "unresolved-first-attempt", verdict: null,
        rawSha256: hash, rawBytes: bytes, chargeMicros: job.request.reservationMicros, heldMicros: job.request.reservationMicros, serviceMs };
    }
    if (state.value !== "settled") fail("unknown physical state");
    const row = exact(raw, ["requestSha256", "state", "raw", "chargeMicros", "serviceMs"]);
    if (row.requestSha256 !== job.key || !(row.raw instanceof Uint8Array) || row.raw.byteLength > 1_048_576) fail("settled raw identity/bound");
    captureBytes(row.raw.byteLength);
    const result = parseEvolutionResponse(row.raw, job.request), serviceMs = duration(row.serviceMs);
    if (row.chargeMicros !== result.usage.micros || serviceMs === null) fail("settled charge/timing mismatch");
    confirmedMicros += result.usage.micros;
    const verdict = result.status === "completed" ? parseJudgeDecision(result.answer) : null;
    return { requestSha256: job.key, status: verdict === null ? "failed" as const : "completed" as const,
      reason: verdict !== null ? null : result.status === "completed" ? "invalid-verdict" : result.failureReason ?? result.status,
      verdict, rawSha256: result.rawSha256, rawBytes: result.rawBytes, chargeMicros: result.usage.micros, heldMicros: 0, serviceMs };
  });
  const exposureMicros = confirmedMicros + unresolvedMicros;
  if (exposureMicros > plan.maximumJudgeAllocationMicros) fail("closed judge exposure exceeds cap");
  const outcomes = new Map(physical.map(row => [row.requestSha256, row])), cells = new Map(plan.cells.map(row => [`${row.caseId}:${row.arm}`, row]));
  const rows = checked.reader.rows.map(row => {
    const cell = cells.get(`${row.caseId}:${row.arm}`)!, outcome = cell.requestSha256 === null ? null : outcomes.get(cell.requestSha256)!;
    return { caseId: row.caseId, arm: row.arm, retrievalStatus: row.retrievalStatus, readerStatus: row.readerStatus,
      judgeStatus: outcome?.status ?? cell.disposition as Stage, verdict: outcome?.verdict ?? null, searchMs: row.searchMs,
      judgeRequestSha256: cell.requestSha256, reason: outcome?.reason ?? cell.reason };
  });
  const combinedConfirmedMicros = checked.reader.accounting.confirmedMicros + confirmedMicros;
  const combinedUnresolvedMicros = checked.reader.accounting.unresolvedMicros + unresolvedMicros;
  const reportInput: FrameworkPilotReportInputV1 = { protocol: "oh.framework-pilot-report-input.v1", cases: checked.reader.cases,
    rows: rows.map(({ judgeRequestSha256: _request, reason: _reason, ...row }) => row),
    accounting: { unit: "USD-microdollars", observed: null, confirmed: combinedConfirmedMicros, unresolved: combinedUnresolvedMicros,
      priorTaskExposure: POLICY.priorTaskExposureMicros, priorGlobalExposure: POLICY.priorGlobalExposureMicros } };
  const body = { protocol: "oh.framework-pilot-judge-results.v1", planSha256: plan.planSha256, readerResultsSha256: checked.reader.resultsSha256,
    databaseSha256, storeClosed: true, ownerCollected: true, coverageComplete: true, allJudgmentsCompleted: rows.every(row => row.judgeStatus === "completed"),
    authentication: POLICY.authentication, qualification: POLICY.qualification, snapshotPinned: POLICY.snapshotPinned,
    logicalCells: rows.length, physicalCallsPlanned: plan.jobs.length, reusedLogicalCells: plan.cells.filter(row => row.requestSha256 !== null).length - plan.jobs.length,
    rows, physical, accounting: { unit: "USD-microdollars", judgeConfirmedMicros: confirmedMicros, judgeUnresolvedMicros: unresolvedMicros,
      judgeExposureMicros: exposureMicros, maximumJudgeAllocationMicros: plan.maximumJudgeAllocationMicros,
      readerConfirmedMicros: checked.reader.accounting.confirmedMicros, readerUnresolvedMicros: checked.reader.accounting.unresolvedMicros,
      combinedConfirmedMicros, combinedUnresolvedMicros, totalTaskExposureMicros: POLICY.priorTaskExposureMicros + combinedConfirmedMicros + combinedUnresolvedMicros,
      totalGlobalExposureMicros: POLICY.priorGlobalExposureMicros + combinedConfirmedMicros + combinedUnresolvedMicros,
      providerCredits: "separate; not-reconciled-here" }, reportInput };
  size(body, POLICY.maximumResultsBytes);
  return immutable({ ...body, resultsSha256: canonicalSha256(body) });
}
