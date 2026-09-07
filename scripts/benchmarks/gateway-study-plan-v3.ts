/** A separately frozen Gateway generation plan. Earlier first responses stay attached to their original parents. */
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { adaptClaudeExtractionOutcomeV3ForRetrieval, type ClaudeExtractionOutcomeV3 } from "./claude-extraction-outcome-v3";
import type { ClaudeLegacyExtraction, ClaudeLegacyPayload } from "./claude-legacy";
import { claudeStudyInternals } from "./claude-study";
import { CLAUDE_JUDGE_SYSTEM, CLAUDE_STUDY_SYSTEMS, makeClaudeReaderJobs, type ClaudeExtractionJob,
  type ClaudeReaderJob } from "./claude-study-plan";
import type { Question } from "./datasets";
import { buildJudgePrompt, loadJudgeProfile, parseJudgeDecision } from "./judge";
import { tokenF1 } from "./metrics";
import { benchmarkOrder } from "./retrieval";
import { EXTRACTION_LIMITS, extractionMessages, parseMemoryUnits } from "./units";
import { makeGatewayStudyRequest, type invokeGatewayStudy } from "./gateway-study-transport-v3";

export const GATEWAY_STUDY_PLAN_V3_PROFILE = "oh.memory-gateway-study-plan.v3" as const;
export type GatewayRequest = ReturnType<typeof makeGatewayStudyRequest>;
export type GatewayResponse = Awaited<ReturnType<typeof invokeGatewayStudy>>;
type Base = Readonly<{ key: string; ordinal: number; request: GatewayRequest }>;
export type GatewayExtractionJob = Base & Readonly<{ phase: "extract"; original: ClaudeExtractionJob }>;
export type GatewayReaderJob = Base & Readonly<{ phase: "reader"; native: ClaudeReaderJob }>;
export type GatewayJudgeJob = Base & Readonly<{ phase: "judge"; promptSha256: string; profileSha256: string }>;
export type GatewayJob = GatewayExtractionJob | GatewayReaderJob | GatewayJudgeJob;
export type GatewayExtractionRow = Readonly<{ profile: typeof GATEWAY_STUDY_PLAN_V3_PROFILE;
  origin: "gateway-v3-first-response"; jobKey: string; originalJobKey: string; ordinal: number;
  corpusId: string; corpusSha256: string; chunkId: string; requestSha256: string;
  status: "valid" | "invalid-envelope" | "invalid-refusal";
  reason: "invalid-json" | "wrong-envelope" | "refusal" | "content-filter" | null;
  payload: ClaudeLegacyPayload; payloadSha256: string; response: GatewayResponse }>;
export type GatewayReaderRow = Readonly<{ jobKey: string; ordinal: number; questionId: string; corpusId: string;
  groupId: string; category: string; system: ClaudeReaderJob["system"]; status: "completed";
  prediction: string; tokenF1: number; requestSha256: string; retrievedSha256: string; contextSha256: string;
  response: GatewayResponse }>;
export type GatewayJudgeCase = Readonly<{ ordinal: number; readerJobKey: string; questionId: string;
  corpusId: string; groupId: string; category: string; system: ClaudeReaderJob["system"];
  jobKey: string; ownerOrdinal: number }>;
export type GatewayJudgePlan = Readonly<{ jobs: readonly GatewayJudgeJob[]; cases: readonly GatewayJudgeCase[]; casesSha256: string }>;
export type GatewayJudgeRow = Readonly<{ jobKey: string; requestSha256: string; correct: 0 | 1; response: GatewayResponse }>;

function fail(reason: string): never { throw new TypeError(`Gateway study plan: ${reason}.`); }
function same(a: unknown, b: unknown, reason: string): void { if (canonicalSha256(a) !== canonicalSha256(b)) fail(reason); }
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
function at<T>(values: readonly T[], index: number): T { return values[index] ?? fail("missing ordered element"); }
function base(phase: string, ordinal: number, identity: unknown, request: GatewayRequest): Base {
  return { ordinal, request, key: canonicalSha256({ profile: GATEWAY_STUDY_PLAN_V3_PROFILE,
    phase, ordinal, identity, requestSha256: request.requestSha256 }) };
}
function originalParent(outcome: ClaudeExtractionOutcomeV3) { return outcome.status === "valid" ? outcome.result : outcome; }
function prediction(response: GatewayResponse): string {
  if (!("prediction" in response) || typeof response.prediction !== "string") fail("reader or judge did not complete");
  return response.prediction;
}
function accept(job: GatewayJob, response: GatewayResponse): void {
  same(job.request, makeGatewayStudyRequest({ phase: job.phase, messages: job.request.body.messages }), "prepared request drift");
  if (response.requestSha256 !== job.request.requestSha256 || response.identity.requestedModel !== job.request.model
    || response.identity.finalProvider !== "openai" || (job.phase !== "extract" && response.kind !== "completed")) fail("response request or phase identity");
}

/** A changed provider/request hash cannot make an already attempted parent eligible again. */
export function makeGatewayExtractionJobs(original: readonly ClaudeExtractionJob[], imported: ReadonlyMap<string, ClaudeExtractionOutcomeV3>) {
  const byKey = new Map(original.map(job => [job.key, job]));
  if (byKey.size !== original.length || new Set(original.map(job => job.ordinal)).size !== original.length) fail("duplicate original parent");
  const importedOrdinals = new Set<number>();
  for (const [key, outcome] of imported) {
    const job = byKey.get(key), parent = originalParent(outcome);
    if (!job || key !== parent.jobKey || job.ordinal !== parent.ordinal || importedOrdinals.has(parent.ordinal)) fail("imported parent binding");
    same({ corpusId: parent.corpusId, corpusSha256: parent.corpusSha256, requestSha256: parent.requestSha256 },
      { corpusId: job.corpusId, corpusSha256: job.corpusSha256, requestSha256: job.requestSha256 }, "imported request binding");
    const payload = adaptClaudeExtractionOutcomeV3ForRetrieval(outcome).payload;
    if (payload.id !== job.chunk.id) fail("imported chunk binding");
    importedOrdinals.add(parent.ordinal);
  }
  const jobs = original.filter(job => !importedOrdinals.has(job.ordinal)).map(job => {
    const request = makeGatewayStudyRequest({ phase: "extract", messages: extractionMessages(job.chunk) });
    return { ...base("extract", job.ordinal, { originalJobKey: job.key, corpusId: job.corpusId,
      corpusSha256: job.corpusSha256, chunkId: job.chunk.id }, request), phase: "extract" as const, original: job };
  });
  if (jobs.length + imported.size !== original.length) fail("complete parent partition");
  return frozen(jobs);
}

export function completeGatewayExtraction(job: GatewayExtractionJob, response: GatewayResponse): GatewayExtractionRow {
  accept(job, response);
  let status: GatewayExtractionRow["status"] = "valid", reason: GatewayExtractionRow["reason"] = null;
  let payload: ClaudeLegacyPayload = { id: job.original.chunk.id, units: [], rejected: 0 };
  if (!("prediction" in response)) {
    if (!("reason" in response) || (response.reason !== "refusal" && response.reason !== "content-filter")) fail("unrecognized extraction failure");
    status = "invalid-refusal"; reason = response.reason;
  } else {
    let envelope: unknown;
    try { envelope = JSON.parse(prediction(response)); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; status = "invalid-envelope"; reason = "invalid-json"; }
    if (status === "valid") {
      if (!isPlainRecord(envelope) || !hasExactKeys(envelope, ["units"]) || !Array.isArray(envelope.units)
        || envelope.units.length > EXTRACTION_LIMITS.units) { status = "invalid-envelope"; reason = "wrong-envelope"; }
      else {
        const parsed = parseMemoryUnits(envelope, job.original.chunk);
        payload = { id: job.original.chunk.id, units: parsed.units, rejected: parsed.rejected };
      }
    }
  }
  return frozen({ profile: GATEWAY_STUDY_PLAN_V3_PROFILE, origin: "gateway-v3-first-response", jobKey: job.key,
    originalJobKey: job.original.key, ordinal: job.ordinal, corpusId: job.original.corpusId,
    corpusSha256: job.original.corpusSha256, chunkId: job.original.chunk.id, requestSha256: job.request.requestSha256,
    status, reason, payload, payloadSha256: canonicalSha256(payload), response });
}

export function gatewayStudyMemory(legacy: ClaudeLegacyExtraction, imported: ReadonlyMap<string, ClaudeExtractionOutcomeV3>,
  newRows: readonly Pick<GatewayExtractionRow, "ordinal" | "corpusId" | "corpusSha256" | "payload">[]) {
  const parents = [...imported.values()].map(outcome => {
    const parent = originalParent(outcome);
    return { ordinal: parent.ordinal, corpusId: parent.corpusId, corpusSha256: parent.corpusSha256,
      payload: adaptClaudeExtractionOutcomeV3ForRetrieval(outcome).payload };
  });
  parents.push(...newRows.map(row => ({ ordinal: row.ordinal, corpusId: row.corpusId, corpusSha256: row.corpusSha256, payload: row.payload })));
  if (new Set(parents.map(row => row.ordinal)).size !== parents.length || parents.length !== legacy.missingChunks) fail("complete unique extraction coverage");
  parents.sort((a, b) => a.ordinal - b.ordinal);
  return claudeStudyInternals.memory(legacy, parents);
}

/** Reuse the native retrieval contexts and order, then explicitly create distinct Gateway requests. */
export async function makeGatewayReaderJobs(input: Parameters<typeof makeClaudeReaderJobs>[0]): Promise<readonly GatewayReaderJob[]> {
  const native = await makeClaudeReaderJobs(input);
  return frozen(native.map(job => {
    const request = makeGatewayStudyRequest({ phase: "reader", messages: [
      { role: "system", content: job.request.systemPrompt }, { role: "user", content: job.request.prompt }] });
    return { ...base("reader", job.ordinal, { question: job.question, groupId: job.groupId,
      corpusSha256: job.corpusSha256, memorySha256: job.memorySha256, system: job.system,
      retrievedSha256: job.retrievedSha256, contextSha256: job.contextSha256 }, request), phase: "reader" as const, native: job };
  }));
}

export function completeGatewayReader(job: GatewayReaderJob, question: Question, response: GatewayResponse): GatewayReaderRow {
  accept(job, response);
  const n = job.native, text = prediction(response);
  same(n.question, { id: question.id, corpusId: question.corpusId, category: question.category,
    question: question.question, questionDate: question.questionDate }, "authenticated reader question");
  return frozen({ jobKey: job.key, ordinal: job.ordinal, questionId: question.id, corpusId: question.corpusId,
    groupId: n.groupId, category: question.category, system: n.system, status: "completed", prediction: text,
    tokenF1: tokenF1(text, question.answer), requestSha256: job.request.requestSha256,
    retrievedSha256: n.retrievedSha256, contextSha256: n.contextSha256, response });
}

export function makeGatewayJudgePlan(input: Readonly<{ readerJobs: readonly GatewayReaderJob[];
  readerRows: readonly GatewayReaderRow[]; questions: readonly Question[]; profile: Awaited<ReturnType<typeof loadJudgeProfile>> }>): GatewayJudgePlan {
  const { readerJobs, readerRows, questions, profile } = input;
  if (questions.length < 1 || readerJobs.length !== questions.length * 3 || readerRows.length !== readerJobs.length
    || new Set(questions.map(q => q.id)).size !== questions.length || new Set(readerJobs.map(j => j.key)).size !== readerJobs.length) fail("complete reader matrix required");
  const jobs: GatewayJudgeJob[] = [], cases: GatewayJudgeCase[] = [], owners = new Map<string, GatewayJudgeJob>();
  for (const [ordinal, job] of readerJobs.entries()) {
    const row = at(readerRows, ordinal), n = job.native, question = at(questions, Math.floor(ordinal / 3));
    const system = at(benchmarkOrder(CLAUDE_STUDY_SYSTEMS, Math.floor(ordinal / 3)), ordinal % 3);
    if (job.ordinal !== ordinal || n.questionIndex !== Math.floor(ordinal / 3) || n.system !== system || row.jobKey !== job.key
      || row.requestSha256 !== job.request.requestSha256 || row.prediction !== prediction(row.response)) fail("reader order or response binding");
    same(row, completeGatewayReader(job, question, row.response), "reader native result drift");
    const prompt = buildJudgePrompt(question, row.prediction, profile), request = makeGatewayStudyRequest({ phase: "judge",
      messages: [{ role: "system", content: CLAUDE_JUDGE_SYSTEM }, { role: "user", content: prompt }] });
    let owner = owners.get(request.requestSha256);
    if (owner === undefined) {
      owner = { ...base("judge", ordinal, { profileSha256: profile.sha256, promptSha256: sha256Hex(prompt) }, request),
        phase: "judge", promptSha256: sha256Hex(prompt), profileSha256: profile.sha256 };
      owners.set(request.requestSha256, owner); jobs.push(owner);
    }
    cases.push({ ordinal, readerJobKey: job.key, questionId: question.id, corpusId: question.corpusId,
      groupId: n.groupId, category: question.category, system: n.system, jobKey: owner.key, ownerOrdinal: owner.ordinal });
  }
  return frozen({ jobs, cases, casesSha256: canonicalSha256(cases) });
}

export function completeGatewayJudge(job: GatewayJudgeJob, response: GatewayResponse): GatewayJudgeRow {
  accept(job, response);
  const correct = parseJudgeDecision(prediction(response));
  if (correct === null) fail("judge did not return a native yes/no decision");
  return frozen({ jobKey: job.key, requestSha256: job.request.requestSha256, correct, response });
}

export function expandGatewayJudgments(plan: GatewayJudgePlan, rows: readonly GatewayJudgeRow[]) {
  if (rows.length !== plan.jobs.length || new Set(rows.map(r => r.jobKey)).size !== rows.length) fail("complete physical judgments required");
  if (plan.cases.length === 0 || plan.cases.length % 3 !== 0 || canonicalSha256(plan.cases) !== plan.casesSha256
    || new Set(plan.cases.map(c => c.readerJobKey)).size !== plan.cases.length) fail("complete bound judgment case matrix required");
  const firstOwners = new Map<string, number>(), questions = new Set<string>();
  for (const [ordinal, c] of plan.cases.entries()) {
    const family = Math.floor(ordinal / 3), first = at(plan.cases, family * 3);
    if (ordinal % 3 === 0) {
      if (questions.has(c.questionId)) fail("duplicate judgment family");
      questions.add(c.questionId);
    }
    if (c.ordinal !== ordinal || c.questionId !== first.questionId || c.corpusId !== first.corpusId
      || c.groupId !== first.groupId || c.category !== first.category
      || c.system !== at(benchmarkOrder(CLAUDE_STUDY_SYSTEMS, family), ordinal % 3)) fail("judgment family or arm order");
    if (!firstOwners.has(c.jobKey)) firstOwners.set(c.jobKey, ordinal);
    if (c.ownerOrdinal !== firstOwners.get(c.jobKey)) fail("judgment first-owner alias binding");
  }
  same(plan.jobs.map(job => ({ key: job.key, ordinal: job.ordinal })),
    [...firstOwners].map(([key, ordinal]) => ({ key, ordinal })), "physical judgment owner order");
  const byKey = new Map(rows.map((row, i) => {
    const job = at(plan.jobs, i); same(row, completeGatewayJudge(job, row.response), "judge response identity");
    return [row.jobKey, row] as const;
  }));
  return frozen(plan.cases.map(c => {
    const row = byKey.get(c.jobKey) ?? fail("missing judgment owner");
    return { ...c, status: "completed" as const, correct: row.correct, requestSha256: row.requestSha256,
      reusedJudgment: c.ordinal !== c.ownerOrdinal, decisionSource: "model" as const };
  }));
}
