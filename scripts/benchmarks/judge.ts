import { open } from "node:fs/promises";
import { join } from "node:path";

import { hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { DATASETS, selectSplit, type DatasetName, type Question, type Split } from "./datasets";
import { loadDataset, ROOT, writeNew } from "./io";
import { mean, pairedBootstrap, tokenF1 } from "./metrics";
import { callOpenAI, MODELS, ModelCompletionError, openPilotLedger, PilotBudget, validatePaidAccess } from "./model";
import { benchmarkBaseline, SYSTEMS, type System } from "./retrieval";

type JudgeProfile = Readonly<{ profileId: string; sha256: string; source: string; templates: Readonly<Record<string, string>> }>;
type JudgeCase = Readonly<{ question: Question; system: System; readerStatus: "completed" | "error" | "not-run"; prediction: string | null }>;
type JudgeUsage = Awaited<ReturnType<typeof callOpenAI>>["usage"];
type JudgeRow = Readonly<{ questionId: string; corpusId: string; groupId: string; category: string; system: System;
  status: "completed" | "judge-error" | "reader-error" | "reader-not-run" | "not-run";
  correct: number | null; usage?: JudgeUsage; error?: string; requestSha256?: string; reportedModel?: string;
  reusedJudgment?: boolean; decisionSource?: "model" | "exact-abstention" }>;

export function createJudgeMemo<T>(evaluate: (prompt: string) => Promise<T>) {
  const entries = new Map<string, Promise<T>>();
  return (prompt: string) => {
    const key = sha256Hex(prompt);
    const existing = entries.get(key);
    if (existing !== undefined) return { key, reused: true, result: existing };
    const result = Promise.resolve().then(() => evaluate(prompt));
    entries.set(key, result);
    return { key, reused: false, result };
  };
}

export function exactJudgeAbstention(question: Question, prediction: string): boolean {
  return question.category === "locomo:5" && question.unanswerable && tokenF1(prediction, "") === 1;
}

export async function loadJudgeProfile(): Promise<JudgeProfile> {
  const file = Bun.file(join(ROOT, "benchmarks/profiles/longmemeval-judge-v1.json"));
  if (file.size > 32 * 1024) throw new RangeError("Judge profile exceeds its byte bound.");
  const bytes = await file.bytes();
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const keys = ["general", "temporal-reasoning", "knowledge-update", "single-session-preference", "abstention"];
  if (!isPlainRecord(value) || !hasExactKeys(value, ["v", "profileId", "source", "revision", "adaptation", "license", "templates"])
    || value.v !== 1 || value.profileId !== "longmemeval.native-judge-prompts.v1" || typeof value.source !== "string"
    || typeof value.license !== "string" || !isPlainRecord(value.templates) || !hasExactKeys(value.templates, keys)) {
    throw new TypeError("Invalid judge prompt profile.");
  }
  const templates: Record<string, string> = {};
  for (const key of keys) {
    const template = value.templates[key];
    if (typeof template !== "string" || template.length > 8_192 || !["question", "answer", "response"]
      .every((field) => template.includes(`{${field}}`))) throw new TypeError("Invalid judge template.");
    templates[key] = template;
  }
  return { profileId: value.profileId, source: value.source, sha256: sha256Hex(bytes), templates };
}

export function buildJudgePrompt(question: Question, prediction: string, profile: JudgeProfile): string {
  const key = question.unanswerable ? "abstention" : ["temporal-reasoning", "knowledge-update", "single-session-preference"]
    .includes(question.category) ? question.category : "general";
  const template = profile.templates[key];
  if (template === undefined) throw new TypeError("Missing judge template.");
  const fields: Record<string, string> = { question: question.question, response: prediction,
    answer: question.category === "locomo:5" && question.unanswerable
      ? "The conversation does not provide an answer to this question."
      : question.category === "locomo:3" ? question.answer.split(";")[0]!.trim() : question.answer };
  return template.replace(/\{(question|answer|response)\}/g, (_match, field: string) => fields[field]!);
}

export function parseJudgeDecision(value: unknown): 0 | 1 | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const verdict = value.trim().toLowerCase();
  if (/^yes[.!]?$/.test(verdict)) return 1;
  return /^no[.!]?$/.test(verdict) ? 0 : null;
}

export function parseJudgeInput(value: unknown, name: DatasetName, split: Split, questions: readonly Question[], seed = 17) {
  if (!isPlainRecord(value) || value.protocol !== "oh.memory-benchmark.v1" || !isPlainRecord(value.manifest)
    || !isPlainRecord(value.provider) || !Array.isArray(value.rows) || value.rows.length > 20_000) {
    throw new TypeError("Expected a bounded answer benchmark report.");
  }
  const manifest = value.manifest;
  if (manifest.command !== "answer" || manifest.dataset !== name || manifest.split !== split || manifest.seed !== seed
    || !isPlainRecord(manifest.source) || manifest.source.sha256 !== DATASETS[name].sha256
    || !isPlainRecord(manifest.code) || parseSha256Hex(manifest.code.sourceSha256) === null
    || !Array.isArray(manifest.selectedQuestions) || !Array.isArray(manifest.systems)) {
    throw new TypeError("Reader report does not match the requested pinned dataset and split.");
  }
  const systems = manifest.systems;
  const ids = manifest.selectedQuestions;
  const byId = new Map(questions.map((question) => [question.id, question]));
  if (systems.length < 1 || systems.length > SYSTEMS.length || new Set(systems).size !== systems.length
    || systems.some((system) => typeof system !== "string" || !SYSTEMS.includes(system as System))
    || ids.length < 1 || ids.length > questions.length || new Set(ids).size !== ids.length
    || ids.some((id) => typeof id !== "string" || !byId.has(id)) || value.rows.length !== ids.length * systems.length
    || typeof value.provider.reader !== "string" || !Object.hasOwn(MODELS, value.provider.reader)) {
    throw new TypeError("Reader report has invalid selection or model identity.");
  }
  const seen = new Set<string>();
  const selected = new Set(ids);
  const rows: JudgeCase[] = [];
  for (const candidate of value.rows) {
    if (!isPlainRecord(candidate) || typeof candidate.questionId !== "string" || !selected.has(candidate.questionId)
      || !systems.includes(candidate.system) || typeof candidate.status !== "string"
      || !["completed", "error", "not-run"].includes(candidate.status)) {
      throw new TypeError("Invalid reader result row.");
    }
    const question = byId.get(candidate.questionId)!;
    const identity = `${question.id}\u0000${candidate.system}`;
    if (seen.has(identity) || candidate.corpusId !== question.corpusId || candidate.category !== question.category) {
      throw new TypeError("Duplicate or mismatched reader result row.");
    }
    seen.add(identity);
    if (candidate.status === "completed" && (typeof candidate.prediction !== "string" || !candidate.prediction.trim()
      || Buffer.byteLength(candidate.prediction) > 64 * 1024)) throw new TypeError("Invalid reader prediction.");
    rows.push({ question, system: candidate.system as System, readerStatus: candidate.status as JudgeCase["readerStatus"],
      prediction: candidate.status === "completed" ? candidate.prediction as string : null });
  }
  return { rows, systems: systems as System[], reader: value.provider.reader,
    readerSourceSha256: manifest.code.sourceSha256 as string,
    readerTransport: value.provider.transport === "openai" || value.provider.transport === "vercel-gateway"
      ? value.provider.transport : "unspecified" };
}

export async function runJudge(input: Readonly<{ input: string; output: string; datasetName: DatasetName; split: Split;
  provider: string; reader: string; paid: boolean; maxUsd: number; maxCalls: number; seed: number }>): Promise<Record<string, unknown>> {
  const { apiKey, provider, selection } = validatePaidAccess(input);
  const maximumOutput = provider === "vercel-gateway" ? 16 : 10;
  if (!["gpt-4o-2024-08-06", "openai/gpt-4o"].includes(input.reader)) throw new TypeError("The semantic judge requires a GPT-4o profile.");
  const source = Bun.file(input.input);
  if (!await source.exists() || source.size > 64 * 1024 * 1024) throw new Error("Reader report must be a file of at most 64 MiB.");
  const bytes = await source.bytes();
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("Reader report is not JSON."); }
  const dataset = await loadDataset(input.datasetName);
  const selected = selectSplit(dataset, input.split, input.seed);
  const sourceReport = parseJudgeInput(raw, input.datasetName, input.split, selected.questions, input.seed);
  const profile = await loadJudgeProfile();
  const checkpointPath = `${input.output}.judge.jsonl`;
  await writeNew(checkpointPath, "");
  const checkpoint = await open(checkpointPath, "a");
  const ledger = await openPilotLedger().catch(async (error: unknown) => { await checkpoint.close(); throw error; });
  const budget = new PilotBudget({ maxUsd: input.maxUsd, maxCalls: input.maxCalls, priorExposureMicros: ledger.exposure });
  const rows: JudgeRow[] = [];
  const evaluate = createJudgeMemo((prompt) => callOpenAI({ apiKey, provider, model: input.reader as keyof typeof MODELS,
    messages: [{ role: "user", content: prompt }], budget, seed: input.seed, maximumOutput, record: ledger.append }));
  let stopped: string | null = null;
  try {
    for (const candidate of sourceReport.rows) {
      const question = candidate.question;
      const base = { questionId: question.id, corpusId: question.corpusId, category: question.category, system: candidate.system,
        groupId: input.datasetName === "locomo" ? question.corpusId : question.corpusId.replace(/_abs$/, "") };
      if (candidate.prediction === null) {
        rows.push({ ...base, status: candidate.readerStatus === "error" ? "reader-error" : "reader-not-run", correct: null });
        continue;
      }
      if (stopped !== null) { rows.push({ ...base, status: "not-run", correct: null }); continue; }
      if (exactJudgeAbstention(question, candidate.prediction)) {
        const row: JudgeRow = { ...base, status: "completed", correct: 1, decisionSource: "exact-abstention" };
        await checkpoint.appendFile(`${JSON.stringify(row)}\n`); await checkpoint.sync();
        rows.push(row);
        continue;
      }
      const evaluation = evaluate(buildJudgePrompt(question, candidate.prediction, profile));
      let chargedUsage: JudgeUsage | undefined;
      try {
        const judged = await evaluation.result;
        chargedUsage = evaluation.reused ? undefined : judged.usage;
        const correct = parseJudgeDecision(judged.prediction);
        const row: JudgeRow = { ...base, correct, status: correct === null ? "judge-error" : "completed",
          ...(correct === null ? { error: "Judge did not return an exact yes/no verdict." } : {}),
          ...(chargedUsage === undefined ? {} : { usage: chargedUsage }), reusedJudgment: evaluation.reused, decisionSource: "model",
          requestSha256: judged.requestSha256, reportedModel: judged.reportedModel };
        await checkpoint.appendFile(`${JSON.stringify(row)}\n`); await checkpoint.sync();
        rows.push(row);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Judge failed.";
        const usage = evaluation.reused ? undefined : error instanceof ModelCompletionError ? error.usage : chargedUsage;
        rows.push({ ...base, status: "judge-error", correct: null, error: message, reusedJudgment: evaluation.reused,
          decisionSource: "model", ...(usage === undefined ? {} : { usage }) });
        if (!(error instanceof ModelCompletionError)) stopped = message;
      }
    }
  } finally { await ledger.close(); await checkpoint.close(); }
  const summarize = (selected: readonly JudgeRow[]) => ({ requested: selected.length,
    judged: selected.filter((row) => row.status === "completed").length,
    failedOrMissing: selected.filter((row) => row.status !== "completed").length,
    accuracyJudgedOnly: mean(selected.map((row) => row.correct)), accuracyLowerBound: mean(selected.map((row) => row.correct ?? 0)),
    inputTokens: selected.reduce((sum, row) => sum + (row.usage?.inputTokens ?? 0), 0),
    outputTokens: selected.reduce((sum, row) => sum + (row.usage?.outputTokens ?? 0), 0),
    accountedCostUsd: selected.reduce((sum, row) => sum + (row.usage?.micros ?? 0), 0) / 1_000_000 });
  const summaries = Object.fromEntries(sourceReport.systems.map((system) => {
    const selected = rows.filter((row) => row.system === system);
    return [system, { ...summarize(selected), byCategory: Object.fromEntries([...new Set(selected.map((row) => row.category))]
      .sort().map((category) => [category, summarize(selected.filter((row) => row.category === category))])) }];
  }));
  const baseline = benchmarkBaseline(sourceReport.systems);
  const baselineRows = new Map(rows.filter((row) => row.system === baseline).map((row) => [row.questionId, row]));
  const comparisons = Object.fromEntries(sourceReport.systems.filter((system) => system !== baseline).map((system) => [system,
    { baseline, metric: "semantic-judge", interval95: pairedBootstrap(rows.filter((row) => row.system === system).flatMap((row) => {
      const left = baselineRows.get(row.questionId)?.correct;
      return left === null || left === undefined || row.correct === null ? [] : [{ cluster: row.groupId, left, right: row.correct }];
    }), input.seed) },
  ]));
  return { status: rows.every((row) => row.status === "completed") ? "completed" : "incomplete", stopped, rows, summaries, comparisons,
    sourceReport: { sha256: sha256Hex(bytes), reader: sourceReport.reader, readerTransport: sourceReport.readerTransport,
      readerSourceSha256: sourceReport.readerSourceSha256 },
    judgeProtocol: input.datasetName === "locomo" ? "oh.semantic-reference-judge.v2" : profile.profileId,
    judgeExecution: { policy: "one-verdict-per-identical-prompt.v1", modelReservations: budget.summary.reservedCalls,
      reusedDecisions: rows.filter((row) => row.reusedJudgment).length,
      exactAbstentions: rows.filter((row) => row.decisionSource === "exact-abstention").length },
    judgeProfile: { source: profile.source, sha256: profile.sha256 },
    provider: { judge: input.reader, transport: provider, requestedModel: selection.requestedModel,
      snapshotPinned: selection.snapshotPinned, temperature: 0, maxCompletionTokens: maximumOutput, pricesUsdPerMillion: MODELS[input.reader as keyof typeof MODELS] },
    spend: budget.summary,
    qualifications: ["Judging is separate from ingestion, retrieval, and answering; only the judge receives gold references.",
      "LongMemEval uses its source-attributed native prompt wording. LoCoMo uses a separate semantic-reference diagnostic, not its native scorer.",
      "Gateway aliases and exact yes/no parsing differ from the published pinned native judge stack; this is not an official leaderboard submission.",
      "Identical rendered judge prompts share one verdict within a run; exact LoCoMo abstentions are checked deterministically. Judge costs are attributed only to the first physical call.",
      "An LLM judge is fallible. Small development samples and few independent conversations do not establish superiority.",
      "Reader errors and unattempted or invalid judge calls remain in coverage and lower-bound denominators."] };
}
