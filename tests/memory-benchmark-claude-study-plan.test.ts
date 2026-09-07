import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { validateClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import { claudeRequestSha256, CLAUDE_SUBSCRIPTION_PROFILE, type ClaudeCompletion, type ClaudeInvocation, type ClaudeRequest } from "../scripts/benchmarks/claude-subscription";
import {
  makeClaudeExtractionJobs, completeClaudeExtraction, makeClaudeReaderJobs, completeClaudeReader,
  makeClaudeJudgePlan, completeClaudeJudge, expandClaudeJudgments, CLAUDE_JUDGE_SYSTEM,
  CLAUDE_STUDY_MODEL, CLAUDE_STUDY_SYSTEMS, CLAUDE_STUDY_BUDGET, type ClaudeCorpusMemory,
} from "../scripts/benchmarks/claude-study-plan";
import { DATASETS, type Corpus, type Question } from "../scripts/benchmarks/datasets";
import { corpusIdentity, type UnitBundle } from "../scripts/benchmarks/extract";
import { buildJudgePrompt, loadJudgeProfile } from "../scripts/benchmarks/judge";
import { answerMessages } from "../scripts/benchmarks/model";
import { tokenF1 } from "../scripts/benchmarks/metrics";
import { createRetrievers } from "../scripts/benchmarks/retrieval";
import { buildExtractionChunks, extractionMessages, parseMemoryUnits, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, EXTRACTION_SCHEMA } from "../scripts/benchmarks/units";

const h = (label: string): string => sha256Hex(`claude-study-synthetic:${label}`);
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error("Missing synthetic fixture item.");
  return value;
}
function fixture() {
  const corpora: Corpus[] = ["a", "b"].map((id) => ({ id: `corpus-${id}`, groupId: `family-${id}`, turns: [
    { id: `${id}-0`, sessionId: `${id}-s0`, date: "2026-01-01", speaker: "Casey", text: "Casey owns a blue bicycle." },
    { id: `${id}-1`, sessionId: `${id}-s1`, date: "2026-01-02", speaker: "Casey", text: "Hello there." },
  ] }));
  const questions: Question[] = corpora.map((corpus, index) => ({ id: `q-${index}`, corpusId: corpus.id, category: "single-session-user",
    question: `What does Casey own in conversation ${index}?`, questionDate: "2026-01-03", answer: "a blue bicycle",
    unanswerable: false, evidenceTurnIds: [at(corpus.turns, 0).id], evidenceSessionIds: [at(corpus.turns, 0).sessionId] }));
  const memory: ClaudeCorpusMemory[] = corpora.map(corpus => ({ corpusId: corpus.id, corpusSha256: corpusIdentity(corpus),
    chunks: buildExtractionChunks(corpus).map((chunk, index) => {
      const turn = at(chunk.turns, 0);
      const parsed = parseMemoryUnits({ units: index === 1 ? [] : [{ text: turn.text, supports: [{ turnId: turn.id, quote: turn.text }] }] }, chunk);
      return { id: chunk.id, units: parsed.units, rejected: parsed.rejected };
    }) }));
  const originalSource = h("original-source"), selection = h("selection");
  const legacyCorpora = memory.map((entry, index) => {
    // Inherited empty and all-rejected are successes, whereas the final parent is missing.
    const chunks = index === 0 ? [at(entry.chunks, 0), { ...at(entry.chunks, 1), rejected: 1 }] : [at(entry.chunks, 0)];
    return { ...entry, chunks, unitsSha256: canonicalSha256(chunks.flatMap(chunk => chunk.units)) };
  });
  const bundle: UnitBundle = { protocol: "oh.memory-unit-bundle.v1", dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256,
    split: "test", seed: 7, extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION),
      reader: "openai/gpt-4.1-mini", provider: "vercel-gateway", maximumOutput: 8192 }, corpora: legacyCorpora,
    usage: { inputTokens: 20, cachedInputTokens: 0, outputTokens: 10, micros: 30 } };
  const raw = new TextEncoder().encode(JSON.stringify({ protocol: "oh.memory-benchmark.v1", status: "incomplete",
    manifest: { command: "extract", dataset: "longmemeval-s", source: DATASETS["longmemeval-s"], split: "test", seed: 7,
      selectedCorpora: corpora.map(corpus => corpus.id), code: { sourceSha256: originalSource }, provenance: { reportSha256: selection } },
    provider: { extractor: "openai/gpt-4.1-mini", transport: "vercel-gateway", maximumOutput: 8192, temperature: 0,
      responseFormat: "json_schema", responseSchemaSha256: canonicalSha256(EXTRACTION_SCHEMA) }, unitBundle: bundle }));
  const legacy = validateClaudeLegacyExtraction({ reportBytes: raw, corpora, expected: { reportSha256: sha256Hex(raw),
    sourceSha256: originalSource, selectionReportSha256: selection, dataset: "longmemeval-s", split: "test", seed: 7 } });
  return { corpora, questions, memory, legacy };
}
function invocation(request: ClaudeRequest, prediction: string): ClaudeInvocation & Readonly<{ completion: ClaudeCompletion }> {
  const usage = { inputTokens: 11, outputTokens: 7, cacheReadInputTokens: 13, cacheCreationInputTokens: 17 };
  const completion: ClaudeCompletion = { prediction, reportedModel: CLAUDE_STUDY_MODEL, sessionId: "synthetic-session", numTurns: 1,
    durationMs: 20, usage, modelUsage: { [CLAUDE_STUDY_MODEL]: usage }, listPriceEstimateUsd: 0.001, billedUsd: null, physicalModelAttempts: null };
  return { protocol: CLAUDE_SUBSCRIPTION_PROFILE, status: "completed", requestSha256: claudeRequestSha256(request), exitCode: 0,
    timedOut: false, outputBoundExceeded: false, stdout: { bytes: 20, sha256: h("stdout") }, stderr: { bytes: 0, sha256: sha256Hex("") }, completion };
}

describe("Claude subscription native study planning", () => {
  test("only the original missing parent receives an extraction job with exact native prompt and original ordinal", () => {
    const f = fixture(), jobs = makeClaudeExtractionJobs(f.corpora, f.legacy), job = at(jobs, 0);
    expect(jobs.length).toBe(1);
    expect(job.ordinal).toBe(3);
    const native = at(buildExtractionChunks(at(f.corpora, 1)), 1), messages = extractionMessages(native);
    expect(job.chunk).toEqual(native);
    expect(job.request).toEqual({ model: CLAUDE_STUDY_MODEL, effort: "low", systemPrompt: at(messages, 0).content,
      prompt: at(messages, 1).content, maximumOutputTokens: 16384, timeoutMs: 300000 });
    expect(job.requestSha256).toBe(claudeRequestSha256(job.request));
    expect(job.legacyReportSha256).toBe(f.legacy.provenance.reportSha256);
    expect(job.request.prompt).not.toContain(at(f.questions, 1).question);
    expect(Object.isFrozen(job.chunk.turns)).toBe(true);
    expect(() => makeClaudeExtractionJobs([...f.corpora].reverse(), f.legacy)).toThrow();
    expect(() => makeClaudeExtractionJobs(f.corpora, { ...f.legacy, completedChunks: 2 })).toThrow();
  });

  test("extraction converts native accepted, empty and rejected payloads without changing actual Claude usage", () => {
    const f = fixture(), job = at(makeClaudeExtractionJobs(f.corpora, f.legacy), 0), turn = at(job.chunk.turns, 0);
    for (const [prediction, unitCount, rejected] of [
      [JSON.stringify({ units: [{ text: turn.text, supports: [{ turnId: turn.id, quote: turn.text }] }] }), 1, 0],
      ['{"units":[]}', 0, 0],
      ['{"units":[{"text":"invented","supports":[{"turnId":"missing","quote":"missing"}]}]}', 0, 1],
    ] as const) {
      const transport = invocation(job.request, prediction), result = completeClaudeExtraction(job, transport);
      expect([result.payload.units.length, result.payload.rejected]).toEqual([unitCount, rejected]);
      expect(result.completion).toEqual(transport.completion);
      expect(result.completion).not.toBe(transport.completion);
      expect(result.payloadSha256).toBe(canonicalSha256(result.payload));
      expect(result.origin).toBe("claude-subscription");
      expect(result.completion.billedUsd).toBeNull();
      expect(result.completion.physicalModelAttempts).toBeNull();
    }
    expect(() => completeClaudeExtraction(job, invocation(job.request, "```json\n{\"units\":[]}\n```"))).toThrow();
    expect(() => completeClaudeExtraction(job, invocation(job.request, '{"units":[],"extra":true}'))).toThrow();
  });

  test("known response text does not admit an incomplete, mismatched, timed-out, capped or nonzero invocation", () => {
    const f = fixture(), job = at(makeClaudeExtractionJobs(f.corpora, f.legacy), 0), success = invocation(job.request, '{"units":[]}');
    for (const bad of [{ ...success, status: "incomplete" as const }, { ...success, exitCode: 1 }, { ...success, timedOut: true },
      { ...success, outputBoundExceeded: true }, { ...success, requestSha256: h("wrong") }, { ...success, completion: null }]) {
      expect(() => completeClaudeExtraction(job, bad)).toThrow();
    }
    expect(() => completeClaudeExtraction({ ...job, request: { ...job.request, prompt: "different" } }, success)).toThrow();
  });

  test("reader plans preserve global rotation and whole native retrieval; gold stays outside all requests", async () => {
    const f = fixture(), jobs = await makeClaudeReaderJobs(f);
    expect(jobs.length).toBe(6);
    expect(jobs.map(job => job.system)).toEqual(["bm25-window", "bm25-record-window", "oh-fact", "bm25-record-window", "oh-fact", "bm25-window"]);
    expect(jobs.map(job => job.ordinal)).toEqual([0, 1, 2, 3, 4, 5]);
    for (const [index, corpus] of f.corpora.entries()) {
      const native = createRetrievers(corpus, at(f.memory, index).chunks.flatMap(chunk => chunk.units));
      try {
        for (const job of jobs.filter(candidate => candidate.questionIndex === index)) {
          const retrieved = await native.retrieve(job.system, job.question.question, CLAUDE_STUDY_BUDGET);
          expect(job.retrieved).toEqual(retrieved);
          expect(job.retrievedSha256).toBe(canonicalSha256(retrieved));
          expect(job.contextSha256).toBe(sha256Hex(retrieved.context));
          const messages = answerMessages(job.question, retrieved.context);
          expect(job.request.systemPrompt).toBe(at(messages, 0).content);
          expect(job.request.prompt).toBe(at(messages, 1).content);
          expect(job.request.maximumOutputTokens).toBe(512);
          expect(job.request.timeoutMs).toBe(120000);
          expect(Object.keys(job.question).sort()).toEqual(["category", "corpusId", "id", "question", "questionDate"]);
          expect(JSON.parse(job.request.prompt)).toEqual({ question: job.question.question, questionDate: job.question.questionDate, memory: retrieved.context });
        }
      } finally { native.close(); }
    }
    const job = at(jobs, 4), question = at(f.questions, 1), prediction = "a blue bicycle\n";
    const row = completeClaudeReader(job, question, invocation(job.request, prediction));
    expect(row.prediction).toBe(prediction);
    expect(row.tokenF1).toBe(tokenF1(prediction, question.answer));
    expect(row.completion.usage).toEqual({ inputTokens: 11, outputTokens: 7, cacheReadInputTokens: 13, cacheCreationInputTokens: 17 });
    expect(() => completeClaudeReader(job, at(f.questions, 0), invocation(job.request, prediction))).toThrow();
  });

  test("partial/reordered/forged memory and representative changes fail before reader work", async () => {
    const f = fixture(), entry = at(f.memory, 1), first = at(entry.chunks, 0), unit = at(first.units, 0);
    for (const memory of [f.memory.slice(0, 1), [...f.memory].reverse(), [at(f.memory, 0), { ...entry, chunks: entry.chunks.slice(0, 1) }],
      [at(f.memory, 0), { ...entry, chunks: [...entry.chunks].reverse() }],
      [at(f.memory, 0), { ...entry, chunks: [{ ...first, units: [{ ...unit, id: "forged-unit" }] }, ...entry.chunks.slice(1)] }]]) {
      await expect(makeClaudeReaderJobs({ ...f, memory })).rejects.toThrow();
    }
    await expect(makeClaudeReaderJobs({ ...f, questions: [...f.questions].reverse() })).rejects.toThrow();
    const completeEmpty = f.memory.map(entry => ({ ...entry, chunks: entry.chunks.map(chunk => ({ ...chunk, units: [] })) }));
    const emptyJobs = await makeClaudeReaderJobs({ ...f, memory: completeEmpty });
    expect(emptyJobs.filter(job => job.system === "oh-fact").map(job => job.retrieved.context)).toEqual(["", ""]);
  });

  test("all reader inputs are captured before the first await and result objects are frozen", async () => {
    const f = fixture(), originalQuestion = at(f.questions, 1).question;
    const running = makeClaudeReaderJobs(f);
    f.corpora[1] = { ...at(f.corpora, 1), turns: [] };
    f.questions[1] = { ...at(f.questions, 1), question: "Changed while awaiting." };
    f.memory.length = 0;
    const jobs = await running;
    expect(at(jobs, 3).question.question).toBe(originalQuestion);
    expect(at(jobs, 3).retrieved.context).not.toBe("");
    expect(Object.isFrozen(at(jobs, 3).retrieved.turnIds)).toBe(true);
    expect(Object.isFrozen(jobs)).toBe(true);
  });

  test("native judge prompt owners and aliases preserve all six cases with usage on two physical owners", async () => {
    const f = fixture(), readerJobs = await makeClaudeReaderJobs(f), profile = await loadJudgeProfile();
    const readerRows = readerJobs.map(job => completeClaudeReader(job, at(f.questions, job.questionIndex), invocation(job.request, "a blue bicycle")));
    const plan = makeClaudeJudgePlan({ readerJobs, readerRows, questions: f.questions, profile });
    expect(plan.jobs.length).toBe(2);
    expect(plan.cases.length).toBe(6);
    expect(plan.cases.map(entry => entry.ownerOrdinal)).toEqual([0, 0, 0, 3, 3, 3]);
    for (const job of plan.jobs) {
      const owner = at(readerRows, job.ordinal), question = at(f.questions, Math.floor(job.ordinal / 3));
      expect(job.request.prompt).toBe(buildJudgePrompt(question, owner.prediction, profile));
      expect(job.request.systemPrompt).toBe(CLAUDE_JUDGE_SYSTEM);
      expect(job.request.maximumOutputTokens).toBe(512);
      expect(job.profileSha256).toBe(profile.sha256);
    }
    const results = plan.jobs.map((job, index) => completeClaudeJudge(job, invocation(job.request, index === 0 ? "YES!" : "no.")));
    const rows = expandClaudeJudgments(plan, [...results].reverse());
    expect(rows.map(row => row.correct)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(rows.map(row => row.reusedJudgment)).toEqual([false, true, true, false, true, true]);
    expect(rows.filter(row => row.usage !== undefined).length).toBe(2);
    expect(rows.map(row => row.system)).toEqual(readerRows.map(row => row.system));
    expect(rows.map(row => row.questionId)).toEqual(readerRows.map(row => row.questionId));
    expect(() => expandClaudeJudgments(plan, results.slice(1))).toThrow();
    expect(() => expandClaudeJudgments(plan, [at(results, 0), at(results, 0)])).toThrow();
    expect(() => completeClaudeJudge(at(plan.jobs, 0), invocation(at(plan.jobs, 0).request, "yes, because it is correct"))).toThrow();
    expect(() => makeClaudeJudgePlan({ readerJobs, readerRows: readerRows.slice(1), questions: f.questions, profile })).toThrow();
    expect(() => makeClaudeJudgePlan({ readerJobs, readerRows: [...readerRows].reverse(), questions: f.questions, profile })).toThrow();
    const changed = readerRows.map((row, index) => index === 1 ? { ...row, tokenF1: 0 } : row);
    expect(() => makeClaudeJudgePlan({ readerJobs, readerRows: changed, questions: f.questions, profile })).toThrow();
  });

  test("exact prompt bytes determine aliases and all arms retain the fixed Claude model", async () => {
    const f = fixture(), readerJobs = await makeClaudeReaderJobs(f), profile = await loadJudgeProfile();
    const readerRows = readerJobs.map(job => completeClaudeReader(job, at(f.questions, job.questionIndex),
      invocation(job.request, job.ordinal === 1 ? "a blue bicycle\n" : "a blue bicycle")));
    const plan = makeClaudeJudgePlan({ readerJobs, readerRows, questions: f.questions, profile });
    expect(plan.jobs.length).toBe(3);
    expect(plan.cases.map(entry => entry.ownerOrdinal)).toEqual([0, 1, 0, 3, 3, 3]);
    expect([...readerJobs, ...plan.jobs].every(job => job.request.model === CLAUDE_STUDY_MODEL && job.request.effort === "low")).toBe(true);
    expect(CLAUDE_STUDY_SYSTEMS.length).toBe(3);
  });
});
