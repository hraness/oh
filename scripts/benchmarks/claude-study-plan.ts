import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import type { ClaudeLegacyExtraction, ClaudeLegacyPayload } from "./claude-legacy";
import { claudeRequestSha256, CLAUDE_SUBSCRIPTION_PROFILE, type ClaudeCompletion, type ClaudeInvocation, type ClaudeRequest } from "./claude-subscription";
import type { Corpus, Question } from "./datasets";
import { corpusIdentity } from "./extract";
import { buildJudgePrompt, parseJudgeDecision, type loadJudgeProfile } from "./judge";
import { tokenF1 } from "./metrics";
import { answerMessages } from "./model";
import { benchmarkOrder, createRetrievers, type Retrieved } from "./retrieval";
import { buildExtractionChunks, extractionMessages, EXTRACTION_LIMITS, parseMemoryUnits, type ExtractionChunk } from "./units";

/** A new mixed-extractor study, not a completion of the original API procedure. */
export const CLAUDE_STUDY_PROFILE = "oh.memory-claude-subscription-study.v1" as const;
export const CLAUDE_STUDY_MODEL = "claude-opus-5" as const;
export const CLAUDE_STUDY_SYSTEMS = Object.freeze(["bm25-window", "bm25-record-window", "oh-fact"] as const);
export const CLAUDE_JUDGE_SYSTEM = "Follow the supplied evaluation instructions. Return only yes or no.";
export const CLAUDE_STUDY_BUDGET = Object.freeze({ topK: 20, contextBytes: 12_000 });
export type ClaudeStudySystem = typeof CLAUDE_STUDY_SYSTEMS[number];
export type ClaudeGoldFreeQuestion = Pick<Question, "id" | "corpusId" | "category" | "question" | "questionDate">;
export type ClaudeCorpusMemory = Readonly<{ corpusId: string; corpusSha256: string; chunks: readonly ClaudeLegacyPayload[] }>;
export type ClaudeJudgeProfile = Awaited<ReturnType<typeof loadJudgeProfile>>;
type JobBase = Readonly<{ key: string; ordinal: number; request: ClaudeRequest; requestSha256: string }>;
export type ClaudeExtractionJob = JobBase & Readonly<{
  phase: "extract"; corpusId: string; corpusSha256: string; chunk: ExtractionChunk; legacyReportSha256: string;
}>;
export type ClaudeExtractionResult = Readonly<{
  jobKey: string; requestSha256: string; corpusId: string; corpusSha256: string; ordinal: number;
  origin: "claude-subscription"; payload: ClaudeLegacyPayload; payloadSha256: string; completion: ClaudeCompletion;
}>;
export type ClaudeReaderJob = JobBase & Readonly<{
  phase: "reader"; questionIndex: number; question: ClaudeGoldFreeQuestion; groupId: string; corpusSha256: string;
  memorySha256: string; system: ClaudeStudySystem; retrieved: Retrieved; retrievedSha256: string; contextSha256: string;
}>;
export type ClaudeReaderRow = Readonly<{
  jobKey: string; ordinal: number; questionId: string; corpusId: string; groupId: string; category: string;
  system: ClaudeStudySystem; status: "completed"; prediction: string; tokenF1: number;
  requestSha256: string; retrievedSha256: string; contextSha256: string; completion: ClaudeCompletion;
}>;
export type ClaudeJudgeJob = JobBase & Readonly<{ phase: "judge"; profileSha256: string; promptSha256: string }>;
export type ClaudeJudgeCase = Readonly<{
  ordinal: number; readerJobKey: string; questionId: string; corpusId: string; groupId: string; category: string;
  system: ClaudeStudySystem; jobKey: string; ownerOrdinal: number;
}>;
export type ClaudeJudgePlan = Readonly<{ profile: typeof CLAUDE_STUDY_PROFILE; jobs: readonly ClaudeJudgeJob[]; cases: readonly ClaudeJudgeCase[] }>;
export type ClaudeJudgeResult = Readonly<{ jobKey: string; requestSha256: string; correct: 0 | 1; completion: ClaudeCompletion }>;
export type ClaudeJudgmentRow = ClaudeJudgeCase & Readonly<{
  status: "completed"; correct: 0 | 1; requestSha256: string; reportedModel: string;
  reusedJudgment: boolean; decisionSource: "model"; usage?: ClaudeCompletion["usage"];
}>;

function fail(reason: string): never { throw new TypeError(`Claude study plan: ${reason}.`); }
function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) return fail("missing ordered item");
  return value;
}
function same(left: unknown, right: unknown, reason: string): void {
  if (canonicalSha256(left) !== canonicalSha256(right)) fail(reason);
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function snapshot<T>(value: T): T {
  canonicalSha256(value);
  return deepFreeze(structuredClone(value));
}
function questionView(question: ClaudeGoldFreeQuestion): ClaudeGoldFreeQuestion {
  return { id: question.id, corpusId: question.corpusId, category: question.category,
    question: question.question, questionDate: question.questionDate };
}
function selected(corpora: readonly Corpus[], questions?: readonly ClaudeGoldFreeQuestion[]): void {
  if (corpora.length < 1 || corpora.length > 1_000 || new Set(corpora.map(c => c.id)).size !== corpora.length
    || new Set(corpora.map(c => c.groupId)).size !== corpora.length) fail("selected corpus/family coverage");
  if (questions !== undefined && (questions.length !== corpora.length || new Set(questions.map(q => q.id)).size !== questions.length
    || questions.some((question, index) => question.corpusId !== at(corpora, index).id))) fail("selected representative order");
}
function request(phase: "extract" | "reader" | "judge", systemPrompt: string, prompt: string): ClaudeRequest {
  return Object.freeze({ model: CLAUDE_STUDY_MODEL, effort: "low", systemPrompt, prompt,
    maximumOutputTokens: phase === "extract" ? 16_384 : 512, timeoutMs: phase === "extract" ? 300_000 : 120_000 });
}
function base(phase: string, ordinal: number, identity: unknown, input: ClaudeRequest): JobBase {
  const requestSha256 = claudeRequestSha256(input);
  return { ordinal, request: input, requestSha256,
    key: canonicalSha256({ profile: CLAUDE_STUDY_PROFILE, phase, ordinal, identity, requestSha256 }) };
}
export function acceptClaudeStudyCompletion(job: JobBase, result: ClaudeInvocation): ClaudeCompletion {
  if (result.protocol !== CLAUDE_SUBSCRIPTION_PROFILE || result.status !== "completed" || result.exitCode !== 0
    || result.timedOut || result.outputBoundExceeded || result.completion === null
    || result.requestSha256 !== job.requestSha256 || claudeRequestSha256(job.request) !== job.requestSha256
    || result.completion.reportedModel !== job.request.model || typeof result.completion.prediction !== "string") {
    return fail("incomplete or mismatched invocation cannot become a semantic result");
  }
  return snapshot(result.completion);
}

function checkedPayload(payload: ClaudeLegacyPayload, chunk: ExtractionChunk): ClaudeLegacyPayload {
  if (!isPlainRecord(payload) || !hasExactKeys(payload, ["id", "units", "rejected"]) || payload.id !== chunk.id
    || !Array.isArray(payload.units) || !Number.isSafeInteger(payload.rejected) || payload.rejected < 0
    || Object.is(payload.rejected, -0) || payload.rejected > EXTRACTION_LIMITS.units) return fail("memory payload shape");
  const parsed = parseMemoryUnits({ units: payload.units.map(unit => ({ text: unit.text, supports: unit.supports })) }, chunk);
  if (parsed.rejected !== 0 || payload.rejected + payload.units.length > EXTRACTION_LIMITS.units) fail("memory payload source validation");
  same(parsed.units, payload.units, "memory native identity");
  return payload;
}

/** Only native missing parents receive new jobs; legacy successes never receive a new request. */
export function makeClaudeExtractionJobs(corporaInput: readonly Corpus[], legacy: ClaudeLegacyExtraction): readonly ClaudeExtractionJob[] {
  const corpora = snapshot(corporaInput);
  selected(corpora);
  const jobs: ClaudeExtractionJob[] = [];
  let ordinal = 0, completed = 0, totalUnits = 0;
  for (const corpus of corpora) {
    const corpusSha256 = corpusIdentity(corpus);
    for (const chunk of buildExtractionChunks(corpus)) {
      const parent = at(legacy.parents, ordinal);
      if (parent.ordinal !== ordinal || parent.corpusId !== corpus.id || parent.corpusSha256 !== corpusSha256 || parent.chunkId !== chunk.id) fail("legacy native parent order");
      if (parent.legacy !== null) {
        checkedPayload(parent.legacy.payload, chunk);
        if (parent.legacy.origin !== "legacy-native" || canonicalSha256(parent.legacy.payload) !== parent.legacy.payloadSha256) fail("legacy payload identity");
        completed += 1; totalUnits += parent.legacy.payload.units.length;
      } else {
        const messages = extractionMessages(chunk);
        const input = request("extract", at(messages, 0).content, at(messages, 1).content);
        const identity = { corpusId: corpus.id, corpusSha256, chunkId: chunk.id, legacyReportSha256: legacy.provenance.reportSha256 };
        jobs.push({ ...base("extract", ordinal, identity, input), phase: "extract", corpusId: corpus.id,
          corpusSha256, chunk, legacyReportSha256: legacy.provenance.reportSha256 });
      }
      ordinal += 1;
    }
  }
  if (legacy.protocol !== "oh.memory-claude-legacy.v1" || ordinal !== legacy.parents.length || ordinal !== legacy.requiredChunks
    || completed !== legacy.completedChunks || jobs.length !== legacy.missingChunks || totalUnits !== legacy.totalUnits) fail("legacy complete coverage counters");
  return deepFreeze(jobs);
}

export function completeClaudeExtraction(job: ClaudeExtractionJob, result: ClaudeInvocation): ClaudeExtractionResult {
  const completion = acceptClaudeStudyCompletion(job, result);
  const parsed = parseMemoryUnits(JSON.parse(completion.prediction), job.chunk);
  const payload = { id: job.chunk.id, units: parsed.units, rejected: parsed.rejected };
  return deepFreeze({ jobKey: job.key, requestSha256: job.requestSha256, corpusId: job.corpusId,
    corpusSha256: job.corpusSha256, ordinal: job.ordinal, origin: "claude-subscription", payload,
    payloadSha256: canonicalSha256(payload), completion });
}

/** All memory is validated before creating a retriever or awaiting any work. Gold never enters a job. */
export async function makeClaudeReaderJobs(input: Readonly<{
  corpora: readonly Corpus[]; questions: readonly ClaudeGoldFreeQuestion[]; memory: readonly ClaudeCorpusMemory[];
}>): Promise<readonly ClaudeReaderJob[]> {
  const corpora = snapshot(input.corpora), questions = snapshot(input.questions.map(questionView)), memory = snapshot(input.memory);
  selected(corpora, questions);
  if (memory.length !== corpora.length) fail("complete memory corpus coverage");
  for (const [index, corpus] of corpora.entries()) {
    const entry = at(memory, index), chunks = buildExtractionChunks(corpus);
    if (entry.corpusId !== corpus.id || entry.corpusSha256 !== corpusIdentity(corpus) || entry.chunks.length !== chunks.length) fail("complete native memory order");
    for (const [chunkIndex, chunk] of chunks.entries()) checkedPayload(at(entry.chunks, chunkIndex), chunk);
  }
  const jobs: ClaudeReaderJob[] = [];
  for (const [questionIndex, question] of questions.entries()) {
    const corpus = at(corpora, questionIndex), entry = at(memory, questionIndex);
    const retrievers = createRetrievers(corpus, entry.chunks.flatMap(chunk => chunk.units));
    let failed = false, failure: unknown;
    try {
      for (const system of benchmarkOrder(CLAUDE_STUDY_SYSTEMS, questionIndex)) {
        if (system !== "bm25-window" && system !== "bm25-record-window" && system !== "oh-fact") fail("unexpected study arm");
        const retrieved = snapshot(await retrievers.retrieve(system, question.question, CLAUDE_STUDY_BUDGET));
        const retrievedSha256 = canonicalSha256(retrieved), contextSha256 = sha256Hex(retrieved.context);
        const messages = answerMessages(question, retrieved.context);
        const req = request("reader", at(messages, 0).content, at(messages, 1).content);
        const identity = { question, groupId: corpus.groupId, corpusSha256: entry.corpusSha256,
          memorySha256: canonicalSha256(entry), system, retrievedSha256, contextSha256 };
        jobs.push({ ...base("reader", jobs.length, identity, req), phase: "reader", questionIndex,
          ...identity, retrieved });
      }
    } catch (error) { failed = true; failure = error; }
    try { retrievers.close(); } catch (error) {
      if (failed) throw new AggregateError([failure, error], "Retrieval and cleanup failed.");
      throw error;
    }
    if (failed) throw failure;
  }
  return deepFreeze(jobs);
}

export function completeClaudeReader(job: ClaudeReaderJob, question: Question, result: ClaudeInvocation): ClaudeReaderRow {
  same(questionView(question), job.question, "authenticated diagnostic question");
  const completion = acceptClaudeStudyCompletion(job, result);
  return deepFreeze({ jobKey: job.key, ordinal: job.ordinal, questionId: question.id, corpusId: question.corpusId,
    groupId: job.groupId, category: question.category, system: job.system, status: "completed", prediction: completion.prediction,
    tokenF1: tokenF1(completion.prediction, question.answer), requestSha256: job.requestSha256,
    retrievedSha256: job.retrievedSha256, contextSha256: job.contextSha256, completion });
}

/** Exact prompt aliases have the first positional owner, independent of eventual completion order. */
export function makeClaudeJudgePlan(input: Readonly<{
  readerJobs: readonly ClaudeReaderJob[]; readerRows: readonly ClaudeReaderRow[]; questions: readonly Question[]; profile: ClaudeJudgeProfile;
}>): ClaudeJudgePlan {
  const { readerJobs, readerRows, questions, profile } = input;
  if (questions.length < 1 || readerJobs.length !== questions.length * CLAUDE_STUDY_SYSTEMS.length
    || readerRows.length !== readerJobs.length || new Set(questions.map(q => q.id)).size !== questions.length
    || new Set(questions.map(q => q.corpusId)).size !== questions.length || new Set(readerJobs.map(job => job.key)).size !== readerJobs.length) fail("complete reader coverage before judging");
  const jobs: ClaudeJudgeJob[] = [], cases: ClaudeJudgeCase[] = [];
  const owners = new Map<string, ClaudeJudgeJob>();
  for (const [ordinal, job] of readerJobs.entries()) {
    const row = at(readerRows, ordinal), questionIndex = Math.floor(ordinal / CLAUDE_STUDY_SYSTEMS.length), question = at(questions, questionIndex);
    const system = at(benchmarkOrder(CLAUDE_STUDY_SYSTEMS, questionIndex), ordinal % CLAUDE_STUDY_SYSTEMS.length);
    if (job.ordinal !== ordinal || job.questionIndex !== questionIndex || job.system !== system || row.status !== "completed"
      || row.jobKey !== job.key || row.ordinal !== ordinal || row.requestSha256 !== job.requestSha256
      || claudeRequestSha256(job.request) !== job.requestSha256 || row.retrievedSha256 !== job.retrievedSha256
      || row.contextSha256 !== job.contextSha256 || row.prediction !== row.completion.prediction
      || row.completion.reportedModel !== CLAUDE_STUDY_MODEL) fail("reader result identity/order");
    same(questionView(question), job.question, "judge authenticated question");
    same({ questionId: row.questionId, corpusId: row.corpusId, groupId: row.groupId, category: row.category, system: row.system },
      { questionId: question.id, corpusId: question.corpusId, groupId: job.groupId, category: question.category, system }, "reader row case identity");
    if (row.tokenF1 !== tokenF1(row.prediction, question.answer)) fail("reader native diagnostic mismatch");
    const prompt = buildJudgePrompt(question, row.prediction, profile);
    let owner = owners.get(prompt);
    if (owner === undefined) {
      const req = request("judge", CLAUDE_JUDGE_SYSTEM, prompt), promptSha256 = sha256Hex(prompt);
      owner = { ...base("judge", ordinal, { profileSha256: profile.sha256, promptSha256 }, req),
        phase: "judge", profileSha256: profile.sha256, promptSha256 };
      owners.set(prompt, owner); jobs.push(owner);
    }
    cases.push({ ordinal, readerJobKey: job.key, questionId: question.id, corpusId: question.corpusId,
      groupId: job.groupId, category: question.category, system: job.system, jobKey: owner.key, ownerOrdinal: owner.ordinal });
  }
  return deepFreeze({ profile: CLAUDE_STUDY_PROFILE, jobs, cases });
}

export function completeClaudeJudge(job: ClaudeJudgeJob, result: ClaudeInvocation): ClaudeJudgeResult {
  const completion = acceptClaudeStudyCompletion(job, result), correct = parseJudgeDecision(completion.prediction);
  if (correct === null) return fail("judge output is not a native yes/no decision");
  return deepFreeze({ jobKey: job.key, requestSha256: job.requestSha256, correct, completion });
}

/** A partial physical result set never becomes a scored subset; usage belongs only to each physical owner. */
export function expandClaudeJudgments(plan: ClaudeJudgePlan, results: readonly ClaudeJudgeResult[]): readonly ClaudeJudgmentRow[] {
  if (plan.profile !== CLAUDE_STUDY_PROFILE || results.length !== plan.jobs.length
    || new Set(results.map(result => result.jobKey)).size !== results.length) fail("complete physical judge coverage");
  const byKey = new Map(results.map(result => [result.jobKey, result]));
  const jobs = new Map(plan.jobs.map(job => [job.key, job]));
  for (const job of plan.jobs) {
    const result = byKey.get(job.key);
    if (!result || result.requestSha256 !== job.requestSha256 || claudeRequestSha256(job.request) !== job.requestSha256
      || result.completion.reportedModel !== CLAUDE_STUDY_MODEL || result.correct !== parseJudgeDecision(result.completion.prediction)) fail("judge result identity/decision");
  }
  return deepFreeze(plan.cases.map((entry, ordinal) => {
    const job = jobs.get(entry.jobKey), result = byKey.get(entry.jobKey);
    if (!job || !result || entry.ordinal !== ordinal || entry.ownerOrdinal !== job.ordinal
      || entry.ownerOrdinal > ordinal || at(plan.cases, entry.ownerOrdinal).jobKey !== entry.jobKey) return fail("judge owner/alias coverage");
    const reusedJudgment = entry.ownerOrdinal !== ordinal;
    return { ...entry, status: "completed" as const, correct: result.correct, requestSha256: result.requestSha256,
      reportedModel: result.completion.reportedModel, reusedJudgment, decisionSource: "model" as const,
      ...(!reusedJudgment ? { usage: snapshot(result.completion.usage) } : {}) };
  }));
}
