/** Explicitly separate subscription study. The original paid benchmark remains incomplete. */
import { constants } from "node:fs";
import { mkdir, open, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { validateClaudeLegacyExtraction, type ClaudeLegacyExtraction } from "./claude-legacy";
import { inspectClaudeSubscriptionCapacity, verifyClaudeSubscription, type ClaudeSubscriptionCapacity } from "./claude-qualification";
import { runClaudeSubscription, type ClaudeInvocation, type ClaudeRequest } from "./claude-subscription";
import { openClaudeStudyStore, type ClaudeStudyStore } from "./claude-study-store";
import { CLAUDE_STUDY_PROFILE, CLAUDE_STUDY_MODEL, CLAUDE_STUDY_SYSTEMS, CLAUDE_STUDY_BUDGET, CLAUDE_JUDGE_SYSTEM,
  makeClaudeExtractionJobs, completeClaudeExtraction, makeClaudeReaderJobs, completeClaudeReader,
  makeClaudeJudgePlan, completeClaudeJudge, expandClaudeJudgments,
  type ClaudeCorpusMemory, type ClaudeExtractionResult } from "./claude-study-plan";
import { DATASETS } from "./datasets";
import { codeIdentity, loadExclusions } from "./io";
import { loadJudgeProfile } from "./judge";
import { loadFrozenSelection } from "./selection";
import { assessSuperiority, CONFIRMATION_ALPHA, MINIMUM_OBSERVED_GAIN } from "./superiority";

const FREEZE_PROFILE = "oh.memory-claude-subscription-freeze.v1";
const VERSION = "2.1.263 (Claude Code)";
const LIMIT = 128 * 1024 * 1024;
type Pin = Readonly<{ path: string; sha256: string }>;
type Inputs = Readonly<{ selection: Pin; legacy: Pin; exclusions: readonly Pin[]; originalSourceSha256: string }>;
type Freeze = Readonly<{
  protocol: typeof FREEZE_PROFILE; createdAt: string; sourceSha256: string;
  cli: Pin & Readonly<{ version: typeof VERSION }>; inputs: Inputs; capacityEvidence: Pin;
  procedure: Readonly<Record<string, unknown>>; study: Readonly<Record<string, unknown>>;
}>;
function fail(message: string): never { throw new Error(`Claude study: ${message}.`); }
function path(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value || value.includes("\0")) fail("expected an absolute normalized path");
  return value;
}
function digest(value: unknown): string {
  if (parseSha256Hex(value) === null || typeof value !== "string") fail("expected a SHA-256 digest");
  return value;
}
function pin(value: unknown): Pin {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["path", "sha256"])) fail("invalid input pin");
  return { path: path(value.path), sha256: digest(value.sha256) };
}
function same(left: unknown, right: unknown, label: string): void {
  if (canonicalSha256(left) !== canonicalSha256(right)) fail(label);
}
async function bytes(file: string, maximum = LIMIT): Promise<Uint8Array> {
  const handle = await open(path(file), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximum) fail("file exceeds its bound");
    const result = new Uint8Array(before.size);
    let offset = 0;
    while (offset < result.length) {
      const read = await handle.read(result, offset, result.length - offset, offset);
      if (read.bytesRead === 0) fail("file changed during read");
      offset += read.bytesRead;
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail("file changed during read");
    return result;
  } finally { await handle.close(); }
}
async function verified(input: Pin, maximum = LIMIT): Promise<Uint8Array> {
  const raw = await bytes(input.path, maximum);
  if (sha256Hex(raw) !== input.sha256) fail("pinned file changed");
  return raw;
}
async function durableJson(file: string, value: unknown): Promise<Pin> {
  const raw = new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n");
  if (raw.length > LIMIT) fail("report exceeds its bound");
  const handle = await open(file, "wx", 0o600);
  try {
    let offset = 0;
    while (offset < raw.length) {
      const wrote = await handle.write(raw, offset, raw.length - offset);
      if (wrote.bytesWritten === 0) fail("report write made no progress");
      offset += wrote.bytesWritten;
    }
    await handle.sync();
  } finally { await handle.close(); }
  const parent = await open(dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await parent.sync(); } finally { await parent.close(); }
  const receipt = { path: file, sha256: sha256Hex(raw) };
  await verified(receipt);
  return receipt;
}
async function pinned(file: string, maximum = LIMIT): Promise<Pin> {
  return { path: path(file), sha256: sha256Hex(await bytes(file, maximum)) };
}
function procedure(judgeSha256: string) {
  return { profile: CLAUDE_STUDY_PROFILE, model: CLAUDE_STUDY_MODEL, effort: "low", cliVersion: VERSION,
    systems: [...CLAUDE_STUDY_SYSTEMS], retrievalBudget: CLAUDE_STUDY_BUDGET,
    maximumOutputTokens: { extract: 16384, reader: 512, judge: 512 },
    timeoutMs: { extract: 300000, reader: 120000, judge: 120000 }, maxTurns: 1, ordinaryRetryLimit: 0,
    concurrency: 1, pauseAtReportedWindowUtilization: 0.7, completionPolicy: "first completed response; no automatic semantic repair or retry",
    credentialRoute: "stored first-party Claude subscription; API environment credentials excluded",
    billingPolicy: "Require explicit disabled-overage evidence; stop on quota or changed/ambiguous capacity signals; never enable extra usage.",
    usageMeaning: "CLI terminal usage and separate model usage; USD values are list-price estimates, billed dollars and physical model attempts unknown.",
    sourcePolicy: "Exact source verified at each bounded batch start and end; run from an unchanged checkout.",
    extractionPolicy: "Preserve original native parent boundaries and independently pinned legacy successes; use Claude only for missing parents.",
    judging: { profileSha256: judgeSha256, allArmsSameModel: true, exactPromptAliases: "first positional owner", systemPrompt: CLAUDE_JUDGE_SYSTEM,
      gold: "Never supplied to extraction/reader prompts or admission; used by the separate judge and post-return native token-F1 diagnostic" },
    assessment: { alphaPerComparison: CONFIRMATION_ALPHA, minimumObservedGain: MINIMUM_OBSERVED_GAIN,
      rule: "complete fixed family matrix before assessment; both paired finite-population lower bounds positive",
      scope: "new mixed-extractor Claude study on the original fixed sample; not original API-study completion or official leaderboard" } };
}
async function loadInputs(inputs: Inputs) {
  for (const exclusion of inputs.exclusions) await verified(exclusion, 64 * 1024 * 1024);
  const exclusions = await loadExclusions(inputs.exclusions.map(entry => entry.path), "longmemeval-s");
  const selection = await loadFrozenSelection({ path: inputs.selection.path, name: "longmemeval-s", split: "test", seed: 17, exclusions });
  if (selection.reportSha256 !== inputs.selection.sha256) fail("selection pin changed");
  const legacy = validateClaudeLegacyExtraction({ reportBytes: await verified(inputs.legacy), expected: {
    reportSha256: inputs.legacy.sha256, sourceSha256: inputs.originalSourceSha256,
    selectionReportSha256: selection.reportSha256, dataset: "longmemeval-s", split: "test", seed: 17,
  }, corpora: selection.dataset.corpora });
  const extractionJobs = makeClaudeExtractionJobs(selection.dataset.corpora, legacy);
  return { selection, legacy, extractionJobs };
}
function studyIdentity(loaded: Awaited<ReturnType<typeof loadInputs>>) {
  return { dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256, split: "test", splitSeed: 17,
    selection: loaded.selection.document, legacy: loaded.legacy.provenance,
    requiredChunks: loaded.legacy.requiredChunks, legacyCompletedChunks: loaded.legacy.completedChunks,
    missingChunks: loaded.legacy.missingChunks, originalStatus: "incomplete",
    legacyParentsSha256: canonicalSha256(loaded.legacy.parents),
    extractionOrderSha256: canonicalSha256(loaded.extractionJobs.map(job => ({ key: job.key, ordinal: job.ordinal, requestSha256: job.requestSha256 }))),
    expectedReaderCases: loaded.selection.document.sampleSize * CLAUDE_STUDY_SYSTEMS.length,
    qualifications: loaded.legacy.qualifications };
}
function parseFreeze(value: unknown): Freeze {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "createdAt", "sourceSha256", "cli", "inputs", "capacityEvidence", "procedure", "study"])
    || value.protocol !== FREEZE_PROFILE || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || !isPlainRecord(value.cli) || !hasExactKeys(value.cli, ["path", "sha256", "version"]) || value.cli.version !== VERSION
    || !isPlainRecord(value.inputs) || !hasExactKeys(value.inputs, ["selection", "legacy", "exclusions", "originalSourceSha256"])
    || !Array.isArray(value.inputs.exclusions) || value.inputs.exclusions.length < 1 || value.inputs.exclusions.length > 32
    || !isPlainRecord(value.procedure) || !isPlainRecord(value.study)) fail("invalid freeze");
  return { protocol: FREEZE_PROFILE, createdAt: value.createdAt, sourceSha256: digest(value.sourceSha256),
    cli: { path: path(value.cli.path), sha256: digest(value.cli.sha256), version: VERSION },
    inputs: { selection: pin(value.inputs.selection), legacy: pin(value.inputs.legacy), exclusions: value.inputs.exclusions.map(pin),
      originalSourceSha256: digest(value.inputs.originalSourceSha256) }, capacityEvidence: pin(value.capacityEvidence),
    procedure: value.procedure, study: value.study };
}

export async function prepareClaudeStudy(input: Readonly<{
  directory: string; cliPath: string; selection: Pin; legacy: Pin; exclusions: readonly Pin[];
  originalSourceSha256: string; capacityEvidence: Pin;
}>) {
  const directory = path(input.directory);
  // mkdir is exclusive: preparing a second protocol never replaces a pre-existing study.
  await mkdir(directory, { mode: 0o700 });
  if (await realpath(directory) !== directory) fail("study directory must be canonical");
  const cliPath = await realpath(path(input.cliPath));
  const qualified = await verifyClaudeSubscription({ cliPath, cwd: directory, expectedVersion: VERSION });
  const capacity = inspectClaudeSubscriptionCapacity(await verified(input.capacityEvidence, 16 * 1024 * 1024));
  const inputs = { selection: pin(input.selection), legacy: pin(input.legacy), exclusions: input.exclusions.map(pin), originalSourceSha256: digest(input.originalSourceSha256) };
  const loaded = await loadInputs(inputs);
  const source = await codeIdentity();
  if (source.bun !== "1.3.14") fail("Bun 1.3.14 is required");
  const judge = await loadJudgeProfile();
  const freeze: Freeze = { protocol: FREEZE_PROFILE, createdAt: new Date().toISOString(), sourceSha256: source.sourceSha256,
    cli: { ...await pinned(cliPath, 512 * 1024 * 1024), version: VERSION }, inputs,
    capacityEvidence: pin(input.capacityEvidence), procedure: procedure(judge.sha256), study: studyIdentity(loaded) };
  await durableJson(join(directory, "preparation.json"), { source, qualified, capacity, noModelCalls: true });
  await durableJson(join(directory, "freeze.json"), freeze);
  return { directory, freezeSha256: sha256Hex(await bytes(join(directory, "freeze.json"))), sourceSha256: source.sourceSha256,
    selectedFamilies: loaded.selection.document.sampleSize, legacyCompletedChunks: loaded.legacy.completedChunks,
    remainingExtractionChunks: loaded.extractionJobs.length, expectedReaderCases: loaded.selection.document.sampleSize * 3 };
}

type AnyJob = Readonly<{ key: string; requestSha256: string; request: ClaudeRequest }>;
export type ClaudeJobHooks = Readonly<{
  store: Pick<ClaudeStudyStore, "lookup" | "begin" | "complete">;
  invoke: (paths: Readonly<{ stdoutPath: string; stderrPath: string }>, request: ClaudeRequest) => Promise<ClaudeInvocation>;
  capacity: (job: AnyJob, invocation: ClaudeInvocation, cached: boolean) => Promise<void>;
  admission: () => boolean;
  progress: (completed: number, cached: number, invoked: number) => void;
}>;
/** Durable transport evidence precedes semantic interpretation; an occupied job is never reissued. */
export async function executeClaudeJobs<J extends AnyJob, T>(jobs: readonly J[], complete: (job: J, invocation: ClaudeInvocation) => T,
  hooks: ClaudeJobHooks): Promise<Readonly<{ status: "completed" | "paused"; rows: readonly T[]; cached: number; invoked: number }>> {
  const rows: T[] = [];
  let cached = 0, invoked = 0;
  for (const job of jobs) {
    const prior = await hooks.store.lookup(job.key, job.requestSha256, job.request.model);
    if (prior.state === "incomplete") fail("an occupied incomplete job requires evidence review before any redispatch");
    let invocation: ClaudeInvocation;
    if (prior.state === "completed") { invocation = prior.invocation; cached++; }
    else {
      if (!hooks.admission()) return { status: "paused", rows, cached, invoked };
      const capture = await hooks.store.begin(job.key, job.requestSha256);
      invocation = await hooks.invoke(capture, job.request);
      invoked++;
      await hooks.store.complete(job.key, job.requestSha256, invocation);
    }
    await hooks.capacity(job, invocation, prior.state === "completed");
    rows.push(complete(job, invocation));
    hooks.progress(rows.length, cached, invoked);
  }
  return { status: "completed", rows, cached, invoked };
}
function memory(legacy: ClaudeLegacyExtraction, extractions: readonly Pick<ClaudeExtractionResult, "ordinal" | "corpusId" | "corpusSha256" | "payload">[]): readonly ClaudeCorpusMemory[] {
  const newByOrdinal = new Map(extractions.map(row => [row.ordinal, row]));
  if (newByOrdinal.size !== legacy.missingChunks || extractions.length !== legacy.missingChunks) fail("missing extraction coverage");
  const result: { corpusId: string; corpusSha256: string; chunks: ClaudeCorpusMemory["chunks"][number][] }[] = [];
  for (const parent of legacy.parents) {
    const fresh = newByOrdinal.get(parent.ordinal);
    if (parent.legacy && fresh) fail("legacy extraction was replaced");
    if (fresh && (fresh.corpusId !== parent.corpusId || fresh.corpusSha256 !== parent.corpusSha256 || fresh.payload.id !== parent.chunkId)) fail("extraction parent mismatch");
    const payload = parent.legacy?.payload ?? fresh?.payload;
    if (!payload) fail("missing native parent payload");
    let corpus = result[result.length - 1];
    if (!corpus || corpus.corpusId !== parent.corpusId) {
      corpus = { corpusId: parent.corpusId, corpusSha256: parent.corpusSha256, chunks: [] };
      result.push(corpus);
    }
    corpus.chunks.push(payload);
  }
  return result;
}

export async function checkPriorBatches(directory: string, freezeSha256: string): Promise<void> {
  return checkPriorClaudeStudyBatches(directory, freezeSha256, "v1");
}
/** Versioned runners share custody checks, never a failed-batch exception. */
export async function checkPriorClaudeStudyBatches(directory: string, freezeSha256: string, version: "v1" | "v2",
  expectedImport?: Readonly<{ sha256: string; count: number }>): Promise<void> {
  if (version === "v2" && (!expectedImport || parseSha256Hex(expectedImport.sha256) === null
    || !Number.isSafeInteger(expectedImport.count) || expectedImport.count < 1)) fail("expected frozen import is required");
  const nowSeconds = Date.now() / 1000;
  const names = (await readdir(directory)).filter(name => /^batch-[0-9a-f-]{36}-started\.json$/.test(name));
  if (names.length > 4096) fail("too many batch receipts");
  for (const name of names) {
    const started = await bytes(join(directory, name), 32768);
    const admission: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(started));
    if (!isPlainRecord(admission) || admission.protocol !== `oh.memory-claude-subscription-batch-admission.${version}`
      || admission.freezeSha256 !== freezeSha256 || typeof admission.runId !== "string"
      || name !== `batch-${admission.runId}-started.json`) fail("prior batch admission changed");
    const closed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bytes(join(directory, `batch-${admission.runId}.json`), 32768)));
    if (!isPlainRecord(closed) || closed.protocol !== `oh.memory-claude-subscription-batch.${version}`
      || closed.runId !== admission.runId || closed.freezeSha256 !== freezeSha256 || closed.failed !== false
      || closed.admissionSha256 !== sha256Hex(started) || closed.sourceVerifiedAtClose !== true
      || closed.cliVerifiedAtClose !== true || closed.storeClosed !== true) fail("prior batch needs custody review");
    if (version === "v2" && (closed.importVerifiedAtClose !== true
      || typeof admission.importedStudySha256 !== "string" || parseSha256Hex(admission.importedStudySha256) === null
      || admission.importedStudySha256 !== expectedImport?.sha256 || admission.importedFirstResponses !== expectedImport?.count
      || closed.importedStudySha256 !== admission.importedStudySha256
      || closed.importedFirstResponses !== admission.importedFirstResponses)) fail("prior import custody changed");
    const pause = closed.capacityPause;
    if (pause !== undefined && pause !== null) {
      if (!isPlainRecord(pause) || !hasExactKeys(pause, ["status", "isUsingOverage", "overageStatus", "overageDisabledReason", "rateLimitType", "resetsAt", "unifiedWindows"])
        || pause.status !== "allowed" || pause.isUsingOverage !== false || pause.overageStatus !== "rejected"
        || pause.overageDisabledReason !== "org_level_disabled" || !isPlainRecord(pause.unifiedWindows)
        || Object.keys(pause.unifiedWindows).length > 16
        || (pause.rateLimitType !== null && (typeof pause.rateLimitType !== "string" || !/^[a-z0-9_]{1,64}$/.test(pause.rateLimitType)))
        || (pause.resetsAt !== null && (typeof pause.resetsAt !== "number" || !Number.isSafeInteger(pause.resetsAt)
          || pause.resetsAt < 0 || Object.is(pause.resetsAt, -0)))) fail("invalid prior capacity pause");
      let activePause = false;
      for (const [key, window] of Object.entries(pause.unifiedWindows)) {
        if (!/^[a-z0-9_]{1,64}$/.test(key) || !isPlainRecord(window) || !hasExactKeys(window, ["resetsAt", "utilization"])
          || typeof window.resetsAt !== "number" || !Number.isSafeInteger(window.resetsAt) || window.resetsAt < 0
          || Object.is(window.resetsAt, -0) || typeof window.utilization !== "number" || !Number.isFinite(window.utilization)
          || window.utilization < 0 || Object.is(window.utilization, -0)) fail("invalid prior capacity window");
        if (window.utilization >= 0.7 && window.resetsAt > nowSeconds) activePause = true;
      }
      if (activePause) fail("prior capacity pause remains active until its reported window reset");
    }
  }
}

export async function runClaudeStudy(input: Readonly<{ directory: string; freezeSha256: string; maximumNewCalls: number }>) {
  const directory = path(input.directory), freezeSha256 = digest(input.freezeSha256);
  if (!Number.isSafeInteger(input.maximumNewCalls) || input.maximumNewCalls < 1 || input.maximumNewCalls > 256) fail("batch calls must be within 1..256");
  const freeze = parseFreeze(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await verified({ path: join(directory, "freeze.json"), sha256: freezeSha256 }, 8 * 1024 * 1024))));
  const source = await codeIdentity();
  if (source.sourceSha256 !== freeze.sourceSha256 || source.bun !== "1.3.14") fail("frozen source or Bun version changed");
  await verified(freeze.cli, 512 * 1024 * 1024);
  const qualified = await verifyClaudeSubscription({ cliPath: freeze.cli.path, cwd: directory, expectedVersion: freeze.cli.version });
  inspectClaudeSubscriptionCapacity(await verified(freeze.capacityEvidence, 16 * 1024 * 1024));
  const loaded = await loadInputs(freeze.inputs);
  const judgeProfile = await loadJudgeProfile();
  same(studyIdentity(loaded), freeze.study, "study input identity changed");
  same(procedure(judgeProfile.sha256), freeze.procedure, "study procedure changed");
  const store = await openClaudeStudyStore({ directory, freezeSha256 });
  let stopped = false, invoked = 0;
  let capacityPause: ClaudeSubscriptionCapacity | null = null;
  const stop = () => { stopped = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  let phase = "extract", completeCount = 0, cacheCount = 0;
  const runId = randomUUID(), start = new Date().toISOString();
  const hooks: ClaudeJobHooks = {
    store,
    invoke: async (paths, request) => { invoked++; return runClaudeSubscription({ cliPath: freeze.cli.path, cwd: directory, ...paths, request }); },
    capacity: async (job, invocation, cached) => {
      const raw = await verified({ path: join(directory, "jobs", job.key, "stdout.jsonl"), sha256: invocation.stdout.sha256 }, 16 * 1024 * 1024);
      const capacity = inspectClaudeSubscriptionCapacity(raw);
      if (!cached && Object.values(capacity.unifiedWindows).some(window => window.utilization >= 0.7 && window.resetsAt * 1000 > Date.now())) capacityPause = capacity;
    },
    admission: () => !stopped && capacityPause === null && invoked < input.maximumNewCalls,
    progress: (completed, cached) => {
      completeCount = completed; cacheCount = cached;
      // Counts only. Predictions, token-F1 and judge outcomes stay private until the full matrix is ready.
      if (completed === 1 || completed % 25 === 0) console.log(JSON.stringify({ phase, completed, cached, newTransportInvocations: invoked }));
    },
  };
  let failure: unknown, failed = false, final: unknown, comparison: unknown, admission: Pin | undefined;
  try {
    await checkPriorBatches(directory, freezeSha256);
    admission = await durableJson(join(directory, `batch-${runId}-started.json`), { protocol: "oh.memory-claude-subscription-batch-admission.v1",
      runId, freezeSha256, sourceSha256: freeze.sourceSha256, cliSha256: freeze.cli.sha256, start, maximumNewCalls: input.maximumNewCalls });
    const extracted = await executeClaudeJobs(loaded.extractionJobs, completeClaudeExtraction, hooks);
    final = { status: extracted.status, phase, completed: extracted.rows.length, required: loaded.extractionJobs.length };
    if (extracted.status === "completed") {
      const corpusMemory = memory(loaded.legacy, extracted.rows);
      phase = "reader"; completeCount = 0; cacheCount = 0;
      const readerJobs = await makeClaudeReaderJobs({ ...loaded.selection.dataset, memory: corpusMemory });
      const readers = await executeClaudeJobs(readerJobs, (job, result) => {
        const question = loaded.selection.dataset.questions[job.questionIndex];
        if (!question) fail("missing authenticated question");
        return completeClaudeReader(job, question, result);
      }, hooks);
      final = { status: readers.status, phase, completed: readers.rows.length, required: readerJobs.length };
      if (readers.status === "completed") {
        phase = "judge"; completeCount = 0; cacheCount = 0;
        const judgePlan = makeClaudeJudgePlan({ readerJobs, readerRows: readers.rows, questions: loaded.selection.dataset.questions, profile: judgeProfile });
        const judged = await executeClaudeJobs(judgePlan.jobs, completeClaudeJudge, hooks);
        final = { status: judged.status, phase, completed: judged.rows.length, required: judgePlan.jobs.length };
        if (judged.status === "completed") {
          const rows = expandClaudeJudgments(judgePlan, judged.rows);
          const assessment = assessSuperiority(loaded.selection.document.poolSize, loaded.selection.document.selected, rows);
          if (assessment.status !== "completed") fail("full comparison matrix is incomplete");
          final = { status: "completed", phase, completed: rows.length, required: rows.length, assessment };
          comparison = { protocol: CLAUDE_STUDY_PROFILE, freezeSha256,
            originalStudyStatus: "incomplete", study: freeze.study, procedure: freeze.procedure,
            extraction: { legacy: loaded.legacy.provenance, completedNewChunks: extracted.rows.length },
            readers: readers.rows, judgments: rows, physicalJudgeResults: judged.rows, assessment };
        }
      }
    }
  } catch (error) { failed = true; failure = error; final = { status: "blocked", phase, completed: completeCount, cached: cacheCount,
    reason: "Preserved job evidence needs review; no automatic redispatch." }; }
  let storeClosed = false, sourceVerifiedAtClose = false, cliVerifiedAtClose = false;
  try { await store.close(); storeClosed = true; } catch (error) { failed = true; failure = error; }
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
  try {
    const after = await codeIdentity();
    if (after.sourceSha256 !== freeze.sourceSha256) fail("source changed during batch; do not accept resulting study output");
    sourceVerifiedAtClose = true;
    await verified(freeze.cli, 512 * 1024 * 1024);
    cliVerifiedAtClose = true;
  } catch (error) { failed = true; failure = error; }
  let comparisonArtifact: Pin | null = null;
  if (failed) final = { status: "blocked", phase, completed: completeCount, cached: cacheCount, reason: "Private evidence requires review before accepting this batch." };
  else if (comparison !== undefined) comparisonArtifact = await durableJson(join(directory, `comparison-${runId}.json`), comparison);
  const receipt = { protocol: "oh.memory-claude-subscription-batch.v1", runId, freezeSha256, sourceSha256: freeze.sourceSha256,
    start, end: new Date().toISOString(), admissionSha256: admission?.sha256 ?? null, sourceVerifiedAtClose, cliVerifiedAtClose, storeClosed, comparisonArtifact,
    qualified, newTransportInvocations: invoked, maximumNewCalls: input.maximumNewCalls,
    interrupted: stopped, capacityPause, failed, result: final };
  await durableJson(join(directory, `batch-${runId}.json`), receipt);
  if (failed) throw new Error("Claude study batch stopped; private checkpoint evidence is preserved.", { cause: failure });
  return receipt;
}

/** Shared native identities and bounded I/O; the v1 procedure and CLI remain strict. */
export const claudeStudyInternals = Object.freeze({ path, digest, pin, same, bytes, verified, durableJson, pinned,
  procedure, loadInputs, studyIdentity, parseFreeze, memory });

async function main(args: readonly string[]) {
  const [command, ...rest] = args;
  if (command === "--help" || command === undefined) {
    console.log(`Claude Code subscription memory benchmark (Bun 1.3.14)\n\nprepare --directory ABS --cli ABS --selection ABS --legacy ABS --original-source SHA --capacity-evidence ABS --exclude ABS [--exclude ABS...]\nrun --directory ABS --freeze-sha256 SHA --max-new-calls 1..256\n\nPrepare freezes current source and pinned inputs without model calls. Run uses a stored first-party subscription, disables ordinary retries and tool access, and checkpoints each CLI invocation. It stops on quota, changed billing signals, incomplete transport or invalid benchmark output. Original API reports and USD ledgers are never changed. No automatic recovery of occupied incomplete jobs. Keep the frozen checkout unchanged.`);
    return;
  }
  if (command !== "prepare" && command !== "run") fail("unknown command");
  const permitted = command === "prepare" ? ["directory", "cli", "selection", "legacy", "original-source", "capacity-evidence", "exclude"]
    : ["directory", "freeze-sha256", "max-new-calls"];
  const values = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]?.slice(2), value = rest[i + 1];
    if (!rest[i]?.startsWith("--") || !name || !permitted.includes(name) || !value || (values.has(name) && name !== "exclude")) fail("invalid command arguments");
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  const one = (key: string): string => values.get(key)?.[0] ?? fail("missing command argument");
  if (command === "prepare") {
    const exclusions = values.get("exclude");
    if (!exclusions?.length) fail("exclusion reports are required");
    console.log(JSON.stringify(await prepareClaudeStudy({ directory: one("directory"), cliPath: one("cli"),
      selection: await pinned(one("selection"), 8 * 1024 * 1024), legacy: await pinned(one("legacy")),
      originalSourceSha256: one("original-source"), capacityEvidence: await pinned(one("capacity-evidence"), 16 * 1024 * 1024),
      exclusions: await Promise.all(exclusions.map(file => pinned(file, 64 * 1024 * 1024))) }), null, 2));
  } else {
    const count = one("max-new-calls");
    if (!/^[1-9][0-9]{0,2}$/.test(count)) fail("invalid batch call count");
    console.log(JSON.stringify(await runClaudeStudy({ directory: one("directory"), freezeSha256: one("freeze-sha256"), maximumNewCalls: Number(count) }), null, 2));
  }
}
if (import.meta.main) {
  try { await main(process.argv.slice(2)); }
  catch { console.error("Claude study stopped. Inspect the private checkpoint and batch evidence; no automatic retry was attempted."); process.exitCode = 1; }
}
