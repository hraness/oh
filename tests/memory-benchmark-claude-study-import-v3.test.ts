import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { loadClaudeStudyImport, ClaudeStudyImportError, CLAUDE_STUDY_IMPORT_QUALIFICATION, type ClaudeStudyImportPin } from "../scripts/benchmarks/claude-study-import";
import { claudeStudyInternals } from "../scripts/benchmarks/claude-study";
import { completeClaudeExtraction, makeClaudeExtractionJobs, type ClaudeExtractionJob } from "../scripts/benchmarks/claude-study-plan";
import { parseClaudeCompletion, CLAUDE_SUBSCRIPTION_PROFILE } from "../scripts/benchmarks/claude-subscription";
import { inspectClaudeSubscriptionCapacity, type ClaudeSubscriptionCapacity } from "../scripts/benchmarks/claude-qualification";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { DATASETS, type Corpus } from "../scripts/benchmarks/datasets";
import { buildExtractionChunks, EXTRACTION_PROFILE, EXTRACTION_INSTRUCTION, EXTRACTION_SCHEMA } from "../scripts/benchmarks/units";

const MODEL = "claude-opus-5", STORE = "oh.claude-study-store.v1", VERSION = "2.1.263 (Claude Code)";
const h = (s: string) => sha256Hex(`synthetic-import:${s}`);
const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const iso = (n: number) => new Date(T0 + n * 1000).toISOString();
const pyJson = (value: unknown) => canonicalJson(value).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const usage = { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 13, cache_creation_input_tokens: 17 };
const modelUsage = { inputTokens: 11, outputTokens: 7, cacheReadInputTokens: 13, cacheCreationInputTokens: 17 };
const capacity = (utilization = 0.1, reset = 1000): ClaudeSubscriptionCapacity => ({ status: "allowed", isUsingOverage: false, overageStatus: "rejected",
  overageDisabledReason: "org_level_disabled", rateLimitType: "five_hour", resetsAt: T0 / 1000 + reset,
  unifiedWindows: { five_hour: { resetsAt: T0 / 1000 + reset, utilization } } });
function stream(job: ClaudeExtractionJob, prediction: string, cap = capacity()): Uint8Array {
  return Buffer.from([
    { type: "system", subtype: "init", session_id: job.key, model: MODEL, claude_code_version: "2.1.263", apiKeySource: "none", tools: [], mcp_servers: [] },
    { type: "assistant", session_id: job.key, parent_tool_use_id: null, message: { model: MODEL, content: [{ type: "text", text: prediction }] } },
    { type: "result", subtype: "success", is_error: false, terminal_reason: "completed", stop_reason: "end_turn", session_id: job.key,
      result: prediction, num_turns: 1, duration_ms: 7, permission_denials: [], usage, modelUsage: { [MODEL]: modelUsage }, total_cost_usd: 0.001 },
    { type: "rate_limit_event", rate_limit_info: cap },
  ].map(v => JSON.stringify(v)).join("\n") + "\n");
}
function take<T>(values: readonly T[], n: number): T { const v = values[n]; if (v === undefined) throw new Error("synthetic fixture position"); return v; }
function rec(v: unknown): Record<string, unknown> { if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("synthetic fixture object"); return v as Record<string, unknown>; }
async function put(path: string, raw: Uint8Array | string): Promise<ClaudeStudyImportPin> {
  await writeFile(path, raw, { mode: 0o600 }); await chmod(path, 0o600); return { path, sha256: sha256Hex(raw) };
}
async function putJson(path: string, v: unknown) { return put(path, JSON.stringify(v, null, 2) + "\n"); }
async function mutate(path: string, fn: (v: Record<string, unknown>) => void) {
  const v = rec(JSON.parse(await readFile(path, "utf8"))); fn(v); return putJson(path, v);
}
async function inventory(directory: string) {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  async function visit(dir: string): Promise<void> {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name); if (e.isDirectory()) await visit(p);
      else { const raw = await readFile(p); files.push({ path: relative(directory, p), bytes: raw.length, sha256: sha256Hex(raw) }); }
    }
  }
  await visit(directory); return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
async function ancestralFixture(root: string) {
  const study = join(root, "study"), source = join(root, "source");
  for (const p of [study, join(study, "jobs"), source, join(source, "src"), join(source, "scripts"), join(source, "scripts/benchmarks")]) await mkdir(p, { mode: 0o700 });
  const sourceFiles = ["package.json", "bun.lock", "tsconfig.json", "tsconfig.scripts.json", "scripts/benchmark-memory.ts", "src/synthetic.ts", "scripts/benchmarks/synthetic.ts"].sort();
  const entries = [];
  for (const p of sourceFiles) { const pin = await put(join(source, p), `// inert synthetic source ${p}\n`); entries.push({ path: p, sha256: pin.sha256 }); }
  const sourceSha256 = canonicalSha256(entries), cli = await put(join(root, "inert-cli"), "This synthetic CLI is never executed.\n");
  const selection = await put(join(root, "selection.json"), "synthetic selection\n"), legacyPin = await put(join(root, "legacy.json"), "synthetic legacy\n");
  const exclusion = await put(join(root, "exclusion.json"), "synthetic exclusion\n"), originalSourceSha256 = h("legacy-source");
  const corpus: Corpus = { id: "synthetic-corpus", groupId: "synthetic-family", turns: Array.from({ length: 6 }, (_, i) => ({
    id: `turn-${i}`, sessionId: `session-${i}`, date: "2026-01-01", speaker: "Casey", text: `Casey owns bicycle number ${i}.` })) };
  const chunks = buildExtractionChunks(corpus);
  const legacy: ClaudeLegacyExtraction = { protocol: "oh.memory-claude-legacy.v1",
    provenance: { reportSha256: legacyPin.sha256, sourceSha256: originalSourceSha256, selectionReportSha256: selection.sha256,
      dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256, split: "test", seed: 17, originalStatus: "incomplete",
      extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION), reader: "openai/gpt-4.1-mini", provider: "vercel-gateway", maximumOutput: 8192 },
      schemaSha256: canonicalSha256(EXTRACTION_SCHEMA), reportedUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 } },
    parents: chunks.map((chunk, ordinal) => { const payload = { id: chunk.id, units: [], rejected: 0 };
      return { corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunkId: chunk.id, ordinal,
        legacy: ordinal === 0 ? { origin: "legacy-native", payload, payloadSha256: canonicalSha256(payload) } : null }; }),
    requiredChunks: 6, completedChunks: 1, missingChunks: 5, totalUnits: 0, qualifications: [] };
  const jobs = makeClaudeExtractionJobs([corpus], legacy), bindings = jobs.map(({ key, ordinal, requestSha256 }) => ({ key, ordinal, requestSha256 }));
  if (jobs.length !== 5) throw new Error("synthetic fixture must have five native missing parents");
  const capRaw = Buffer.from(JSON.stringify({ type: "rate_limit_event", rate_limit_info: capacity() }) + "\n");
  const capPin = await put(join(root, "capacity.jsonl"), capRaw), profile = await loadJudgeProfile();
  const freeze = { protocol: "oh.memory-claude-subscription-freeze.v1", createdAt: iso(0), sourceSha256, cli: { ...cli, version: VERSION },
    inputs: { selection, legacy: legacyPin, exclusions: [exclusion], originalSourceSha256 }, capacityEvidence: capPin,
    procedure: claudeStudyInternals.procedure(profile.sha256), study: { originalStatus: "incomplete", missingChunks: jobs.length,
      extractionOrderSha256: canonicalSha256(bindings), legacy: legacy.provenance } };
  const freezePin = await putJson(join(study, "freeze.json"), freeze);
  await putJson(join(study, "preparation.json"), { noModelCalls: true, source: { sourceSha256, files: entries, bun: "1.3.14" }, capacity: inspectClaudeSubscriptionCapacity(capRaw) });
  await putJson(join(study, "store.json"), { protocol: STORE, freezeSha256: freezePin.sha256 });
  const runIds = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
  const qualified = { version: VERSION, auth: { authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" } };
  async function writeJob(index: number, prediction: string, cap = capacity()) {
    const job = take(jobs, index), dir = join(study, "jobs", job.key); await mkdir(dir, { mode: 0o700, recursive: true });
    const base = { protocol: STORE, freezeSha256: freezePin.sha256, jobKey: job.key, requestSha256: job.requestSha256 };
    await putJson(join(dir, "pending.json"), base);
    const raw = stream(job, prediction, cap), err = Buffer.from("synthetic stderr π\n");
    await put(join(dir, "stdout.jsonl"), raw); await put(join(dir, "stderr.txt"), err);
    await putJson(join(dir, "result.json"), { ...base, invocation: { protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256: job.requestSha256,
      exitCode: 0, timedOut: false, outputBoundExceeded: false, stdout: { bytes: raw.length, sha256: sha256Hex(raw) }, stderr: { bytes: err.length, sha256: sha256Hex(err) } } });
  }
  const first = take(jobs, 0), turn = take(first.chunk.turns, 0);
  const validPrediction = JSON.stringify({ units: [{ text: turn.text, supports: [{ turnId: turn.id, quote: turn.text }] }] });
  await writeJob(0, validPrediction); await writeJob(1, "{");
  const runs: { runId: string; admissionSha256: string; closureSha256: string; configuration: ClaudeStudyImportPin; supervisorStatus: ClaudeStudyImportPin;
    groupGone: boolean; runnerExitCode: number; newTransportInvocations: number; jobKeys: string[] }[] = [];
  for (let i = 0; i < 2; i++) {
    const runId = take(runIds, i), start = iso(i * 20 + 10), end = iso(i * 20 + 20), terminal = i === 1;
    const admission = await putJson(join(study, `batch-${runId}-started.json`), { protocol: "oh.memory-claude-subscription-batch-admission.v1", runId,
      freezeSha256: freezePin.sha256, sourceSha256, cliSha256: cli.sha256, start, maximumNewCalls: 1 });
    const closure = await putJson(join(study, `batch-${runId}.json`), { protocol: "oh.memory-claude-subscription-batch.v1", runId,
      freezeSha256: freezePin.sha256, sourceSha256, start, end, admissionSha256: admission.sha256,
      sourceVerifiedAtClose: true, cliVerifiedAtClose: true, storeClosed: true, comparisonArtifact: null, qualified,
      newTransportInvocations: 1, maximumNewCalls: 1, interrupted: false, capacityPause: null, failed: terminal,
      result: terminal ? { status: "blocked", phase: "extract", completed: 1, cached: 1, reason: "Private evidence requires review before accepting this batch." }
        : { status: "paused", phase: "extract", completed: 1, required: jobs.length } });
    const jobDir = join(root, `supervisor-${i}`); await mkdir(jobDir, { mode: 0o700 });
    const argv = [join(root, "bin/bun"), join(source, "scripts/benchmarks/claude-study.ts"), "run", "--directory", study,
      "--freeze-sha256", freezePin.sha256, "--max-new-calls", "1"];
    const config = { argv, cwd: source, jobDir, requireAbsent: [join(root, "absent-π-😀")] };
    const configuration = await put(join(jobDir, "config.json"), pyJson(config));
    const supervisorStatus = await putJson(join(jobDir, "status.json"), { state: "exited", supervisorPid: 1000 + i * 10,
      supervisorStart: "synthetic OS process start", bootIdentity: "synthetic boot observation", commandSha256: sha256Hex(pyJson(argv)),
      configSha256: configuration.sha256, startedAt: iso(i * 20 + 9).replace(".000Z", "Z"), childPid: 1001 + i * 10,
      childPgid: 1001 + i * 10, childStart: "synthetic child start", exitCode: terminal ? 1 : 0, groupGone: true,
      finishedAt: iso(i * 20 + 21).replace(".000Z", "Z") });
    runs.push({ runId, admissionSha256: admission.sha256, closureSha256: closure.sha256, configuration, supervisorStatus,
      groupGone: true, runnerExitCode: terminal ? 1 : 0, newTransportInvocations: 1, jobKeys: [take(jobs, i).key] });
  }
  const manifestPath = join(root, "manifest.json"), inventoryPath = join(root, "inventory.json"), closurePath = join(root, "closure.json");
  let manifestPin: ClaudeStudyImportPin;
  async function seal() {
    for (const run of runs) {
      run.closureSha256 = sha256Hex(await readFile(join(study, `batch-${run.runId}.json`)));
      run.admissionSha256 = sha256Hex(await readFile(join(study, `batch-${run.runId}-started.json`)));
    }
    const inventoryPin = await putJson(inventoryPath, { schema: "oh.claude-final-inventory.v1", freezeSha256: freezePin.sha256, files: await inventory(study) });
    const closurePin = await putJson(closurePath, { schema: "oh.claude-final-supervisor-closure.v1", freezeSha256: freezePin.sha256,
      inventorySha256: inventoryPin.sha256, finalBatchSha256: take(runs, runs.length - 1).closureSha256,
      verification: "owner-verified-complete-producer-inventory", allProducersClosed: true, runs });
    manifestPin = await putJson(manifestPath, { schema: "oh.claude-study-import.v2", createdAt: iso(100), studyDirectory: study, sourceDirectory: source,
      freeze: freezePin, inventory: inventoryPin, supervisorClosure: closurePin, jobs: bindings.slice(0, 2), terminalFailedKey: take(jobs, 1).key,
      validCount: 1, invalidCount: 1, qualification: CLAUDE_STUDY_IMPORT_QUALIFICATION });
    return manifestPin;
  }
  await seal();
  return { root, study, source, cli, jobs, runs, runIds, manifestPath, inventoryPath, closurePath, freezePin, sourceSha256, validPrediction, writeJob, seal,
    get manifestPin() { return manifestPin; }, load: () => loadClaudeStudyImport({ manifest: manifestPin, jobs }),
    jobPath: (index: number, name: string) => join(study, "jobs", take(jobs, index).key, name),
    batchPath: (index: number) => join(study, `batch-${take(runIds, index)}.json`) };
}

import { loadClaudeStudyImportV3, ClaudeStudyImportV3Error, CLAUDE_STUDY_IMPORT_V3_QUALIFICATION } from "../scripts/benchmarks/claude-study-import-v3";
import { claudeStudyV2Procedure, summarizeClaudeExtractionOutcomes } from "../scripts/benchmarks/claude-study-v2";
import { completeClaudeExtractionOutcome } from "../scripts/benchmarks/claude-extraction-outcome";

function refusalStream(job: ClaudeExtractionJob, cap = capacity()): Uint8Array {
  const fallback = "claude-opus-4-8", prediction = "synthetic refusal";
  const perModel = (name: string) => ({ ...modelUsage, canonicalModel: name, provider: "firstParty", costBasis: "list", webSearchRequests: 0 });
  return Buffer.from([
    { type: "system", subtype: "init", session_id: job.key, model: MODEL, claude_code_version: "2.1.263", apiKeySource: "none", tools: [], mcp_servers: [] },
    { type: "system", subtype: "model_refusal_fallback", session_id: job.key, trigger: "refusal", direction: "retry", scope: "session",
      original_model: MODEL, fallback_model: fallback, retracted_message_uuids: [], request_id: "synthetic-request", api_refusal_category: "synthetic-category",
      api_refusal_explanation: "synthetic explanation", refused_user_message_uuid: "synthetic-user", content: "synthetic marker", uuid: "synthetic-event" },
    { type: "assistant", session_id: job.key, parent_tool_use_id: null, message: { model: fallback, content: [{ type: "text", text: prediction }] } },
    { type: "result", subtype: "success", is_error: false, terminal_reason: "completed", stop_reason: "end_turn", session_id: job.key,
      result: prediction, num_turns: 1, duration_ms: 7, permission_denials: [],
      usage: { ...usage, server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
      modelUsage: { [MODEL]: perModel(MODEL), [fallback]: perModel(fallback) }, total_cost_usd: 0.001 },
    { type: "rate_limit_event", rate_limit_info: cap },
  ].map(v => JSON.stringify(v)).join("\n") + "\n");
}
async function fixture(root: string, options: { inheritedPauseReset?: number } = {}) {
  const ancestor = await ancestralFixture(root);
  if (options.inheritedPauseReset !== undefined) {
    const cap = capacity(0.8, options.inheritedPauseReset);
    await ancestor.writeJob(1, "{", cap);
    await mutate(ancestor.batchPath(1), c => { c.capacityPause = cap; });
    await ancestor.seal();
  }
  const original = await ancestor.load();
  const study = join(root, "study-v2"); await mkdir(study, { mode: 0o700 }); await mkdir(join(study, "jobs"), { mode: 0o700 });
  const jobs = ancestor.jobs, v2Jobs = jobs.slice(2, 4), inheritedOutcomes = jobs.slice(0, 2).map(job => completeClaudeExtractionOutcome(job, original.invocations.get(job.key)!));
  const importedSummary = summarizeClaudeExtractionOutcomes(inheritedOutcomes, new Set(original.invocations.keys()));
  const profile = await loadJudgeProfile(), freeze = { ...original.freeze, protocol: "oh.memory-claude-subscription-freeze.v2", createdAt: iso(200),
    importedStudy: ancestor.manifestPin, procedure: claudeStudyV2Procedure(profile.sha256),
    study: { ...original.freeze.study, importedFirstResponses: 2, importedValidChunks: 1, importedInvalidParents: 1,
      importedDispositionsSha256: importedSummary.dispositionsSha256, remainingFirstExtractionCalls: jobs.length - 2 } };
  const freezePin = await putJson(join(study, "freeze.json"), freeze);
  const qualified = { version: VERSION, auth: { authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" } };
  const oldPreparation = rec(JSON.parse(await readFile(join(ancestor.study, "preparation.json"), "utf8")));
  await putJson(join(study, "preparation.json"), { ...oldPreparation, qualified, imported: importedSummary });
  await putJson(join(study, "store.json"), { protocol: STORE, freezeSha256: freezePin.sha256 });
  async function writeJob(index: number, raw: Uint8Array) {
    const job = take(jobs, index + 2), dir = join(study, "jobs", job.key); await mkdir(dir, { mode: 0o700, recursive: true });
    const base = { protocol: STORE, freezeSha256: freezePin.sha256, jobKey: job.key, requestSha256: job.requestSha256 };
    await putJson(join(dir, "pending.json"), base); await put(join(dir, "stdout.jsonl"), raw); await put(join(dir, "stderr.txt"), "");
    await putJson(join(dir, "result.json"), { ...base, invocation: { protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256: job.requestSha256,
      exitCode: 0, timedOut: false, outputBoundExceeded: false, stdout: { bytes: raw.length, sha256: sha256Hex(raw) }, stderr: { bytes: 0, sha256: sha256Hex("") } } });
  }
  await writeJob(0, stream(take(v2Jobs, 0), '{"units":[]}')); await writeJob(1, refusalStream(take(v2Jobs, 1)));
  const runIds = ["00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"];
  const runs: { runId: string; admissionSha256: string; closureSha256: string; configuration: ClaudeStudyImportPin; supervisorStatus: ClaudeStudyImportPin;
    groupGone: boolean; runnerExitCode: number; newTransportInvocations: number; jobKeys?: string[] }[] = [];
  for (let i = 0; i < 2; i++) {
    const runId = take(runIds, i), start = iso(210 + i * 20), end = iso(220 + i * 20), terminal = i === 1;
    const admission = await putJson(join(study, `batch-${runId}-started.json`), { protocol: "oh.memory-claude-subscription-batch-admission.v2", runId,
      freezeSha256: freezePin.sha256, sourceSha256: ancestor.sourceSha256, cliSha256: ancestor.cli.sha256, start, maximumNewCalls: 1,
      importedStudySha256: ancestor.manifestPin.sha256, importedFirstResponses: 2 });
    const closure = await putJson(join(study, `batch-${runId}.json`), { protocol: "oh.memory-claude-subscription-batch.v2", runId,
      freezeSha256: freezePin.sha256, sourceSha256: ancestor.sourceSha256, importedStudySha256: ancestor.manifestPin.sha256, importedFirstResponses: 2,
      importVerifiedAtClose: true, start, end, admissionSha256: admission.sha256, sourceVerifiedAtClose: true, cliVerifiedAtClose: true, storeClosed: true,
      comparisonArtifact: null, qualified, newTransportInvocations: 1, maximumNewCalls: 1, interrupted: false, capacityPause: null, failed: terminal,
      result: terminal ? { status: "blocked", phase: "extract", completed: 3, cached: 3, reason: "Private evidence requires review before accepting this batch." }
        : { status: "paused", phase: "extract", resolved: 3, required: jobs.length, valid: 2, invalid: 1, imported: 2 } });
    const jobDir = join(root, `supervisor-v2-${i}`); await mkdir(jobDir, { mode: 0o700 });
    const argv = [join(root, "bin/bun"), join(ancestor.source, "scripts/benchmarks/claude-study-v2.ts"), "run", "--directory", study,
      "--freeze-sha256", freezePin.sha256, "--max-new-calls", "1"];
    const configuration = await put(join(jobDir, "config.json"), pyJson({ argv, cwd: ancestor.source, jobDir, requireAbsent: [join(root, "absent")] }));
    const supervisorStatus = await putJson(join(jobDir, "status.json"), { state: "exited", supervisorPid: 2000 + i * 10, supervisorStart: "synthetic start",
      bootIdentity: "synthetic boot", commandSha256: sha256Hex(pyJson(argv)), configSha256: configuration.sha256,
      startedAt: iso(209 + i * 20).replace(".000Z", "Z"), childPid: 2001 + i * 10, childPgid: 2001 + i * 10, childStart: "synthetic child",
      exitCode: terminal ? 1 : 0, groupGone: true, finishedAt: iso(221 + i * 20).replace(".000Z", "Z") });
    runs.push({ runId, admissionSha256: admission.sha256, closureSha256: closure.sha256, configuration, supervisorStatus, groupGone: true,
      runnerExitCode: terminal ? 1 : 0, newTransportInvocations: 1, jobKeys: [take(v2Jobs, i).key] });
  }
  const manifestPath = join(root, "manifest-v3.json"), inventoryPath = join(root, "inventory-v2.json"), closurePath = join(root, "closure-v2.json");
  let manifestPin: ClaudeStudyImportPin;
  async function seal() {
    for (const run of runs) {
      run.closureSha256 = sha256Hex(await readFile(join(study, `batch-${run.runId}.json`)));
      run.admissionSha256 = sha256Hex(await readFile(join(study, `batch-${run.runId}-started.json`)));
    }
    const inventoryPin = await putJson(inventoryPath, { schema: "oh.claude-final-inventory.v2", freezeSha256: freezePin.sha256, files: await inventory(study) });
    const closurePin = await putJson(closurePath, { schema: "oh.claude-final-supervisor-closure.v2", freezeSha256: freezePin.sha256,
      inventorySha256: inventoryPin.sha256, finalBatchSha256: take(runs, 1).closureSha256,
      verification: "owner-verified-complete-producer-inventory", allProducersClosed: true, runs });
    manifestPin = await putJson(manifestPath, { schema: "oh.claude-study-import.v3", createdAt: iso(300), studyDirectory: study, sourceDirectory: ancestor.source,
      freeze: freezePin, inventory: inventoryPin, supervisorClosure: closurePin,
      jobs: v2Jobs.map(({ key, ordinal, requestSha256 }) => ({ key, ordinal, requestSha256 })), terminalFailedKey: take(v2Jobs, 1).key,
      qualification: CLAUDE_STUDY_IMPORT_V3_QUALIFICATION });
    return manifestPin;
  }
  await seal();
  return { ancestor, jobs, v2Jobs, study, runs, freeze, freezePin, manifestPath, inventoryPath, closurePath, writeJob, seal,
    get manifestPin() { return manifestPin; }, load: () => loadClaudeStudyImportV3({ manifest: manifestPin, jobs }),
    jobPath: (index: number, name: string) => join(study, "jobs", take(v2Jobs, index).key, name),
    batchPath: (index: number) => join(study, `batch-${take(runIds, index)}.json`) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function owned(run: (f: Fixture) => Promise<void>, options: { inheritedPauseReset?: number } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "oh-claude-import-v3-"))); await chmod(root, 0o700);
  try { await run(await fixture(root, options)); } finally { await rm(root, { recursive: true, force: true }); }
}
async function rejected(promise: Promise<unknown>) { await expect(promise).rejects.toBeInstanceOf(ClaudeStudyImportV3Error); }

describe("closed v1/v2 first-response ancestry import", () => {
  test("preserves both ancestries and typed zero-memory fallback without writes or duplicate usage", async () => {
    await owned(async f => {
      const beforeV1 = await inventory(f.ancestor.study), beforeV2 = await inventory(f.study);
      let fetchCalls = 0, spawnCalls = 0;
      const oldFetch = globalThis.fetch, oldSpawn = Bun.spawn, oldSpawnSync = Bun.spawnSync;
      globalThis.fetch = Object.assign((() => { fetchCalls++; throw new Error("network forbidden"); }), oldFetch) as typeof fetch;
      Bun.spawn = (() => { spawnCalls++; throw new Error("spawn forbidden"); }) as unknown as typeof Bun.spawn;
      Bun.spawnSync = (() => { spawnCalls++; throw new Error("spawn forbidden"); }) as unknown as typeof Bun.spawnSync;
      let result: Awaited<ReturnType<typeof loadClaudeStudyImportV3>>;
      try { result = await f.load(); } finally { globalThis.fetch = oldFetch; Bun.spawn = oldSpawn; Bun.spawnSync = oldSpawnSync; }
      expect(fetchCalls).toBe(0); expect(spawnCalls).toBe(0);
      expect(result.outcomes.size).toBe(4); expect(result.origins.size).toBe(4);
      expect([...result.outcomes.keys()]).toEqual(f.jobs.slice(0, 4).map(j => j.key));
      expect(result.summary.validCount).toBe(2); expect(result.summary.invalidEnvelopeCount).toBe(1); expect(result.summary.invalidRefusalFallbackCount).toBe(1);
      expect(result.summary.v1TransportInvocations).toBe(2); expect(result.summary.v2TransportInvocations).toBe(2);
      expect(result.summary.remainingFirstExtractionCalls).toBe(1); expect(result.summary.terminalUsage).toEqual({ inputTokens: 44, outputTokens: 28, cacheReadInputTokens: 52, cacheCreationInputTokens: 68 });
      expect(result.summary.listPriceEstimateUsdKnownSubtotal).toBe(0.004); expect(result.summary.billedUsd).toBeNull(); expect(result.summary.physicalModelAttempts).toBeNull();
      const fallback = result.outcomes.get(take(f.v2Jobs, 1).key);
      expect(fallback?.status).toBe("invalid-refusal-fallback"); expect(Object.hasOwn(fallback!, "completion")).toBe(false); expect(Object.hasOwn(fallback!, "prediction")).toBe(false);
      expect(Object.isFrozen(result.outcomes)).toBe(true); expect(Object.hasOwn(result.outcomes, "set")).toBe(false);
      expect(Object.isFrozen(fallback)).toBe(true); expect(Object.isFrozen(result.summary.modelUsageSeparate)).toBe(true);
      expect(result.summary.originalV1Status).toBe("incomplete"); expect(result.summary.originalV2Status).toBe("incomplete");
      expect(await inventory(f.ancestor.study)).toEqual(beforeV1); expect(await inventory(f.study)).toEqual(beforeV2);
    });
  });
  test("retains valid empty and unit-rejected v2 payloads as native successes", async () => {
    for (const units of [[], [null]]) await owned(async f => {
      await f.writeJob(0, stream(take(f.v2Jobs, 0), JSON.stringify({ units }))); await f.seal();
      const outcome = (await f.load()).outcomes.get(take(f.v2Jobs, 0).key);
      expect(outcome?.status).toBe("valid"); if (outcome?.status !== "valid") throw new Error("expected valid");
      expect(outcome.result.payload.units).toEqual([]); expect(outcome.result.payload.rejected).toBe(units.length);
    });
  });
  test("ordinary mismatches, earlier invalid responses, and a terminal valid response remain fatal", async () => {
    for (const mode of ["unexplained", "earlier-invalid", "terminal-valid"]) await owned(async f => {
      if (mode === "earlier-invalid") await f.writeJob(0, stream(take(f.v2Jobs, 0), "{"));
      else if (mode === "terminal-valid") await f.writeJob(1, stream(take(f.v2Jobs, 1), '{"units":[]}'));
      else { const events = new TextDecoder().decode(refusalStream(take(f.v2Jobs, 1))).trim().split("\n").map(line => JSON.parse(line));
        await f.writeJob(1, Buffer.from(events.filter(e => e.subtype !== "model_refusal_fallback").map(e => JSON.stringify(e)).join("\n") + "\n")); }
      await f.seal(); await rejected(f.load());
    });
  });
  test("omission, duplicated ancestry, and changed original job requests cannot become a new prefix", async () => {
    for (const mode of ["skip", "duplicate", "request"]) await owned(async f => {
      const value = rec(JSON.parse(await readFile(f.manifestPath, "utf8"))), bindings = value.jobs as Record<string, unknown>[];
      if (mode === "skip") bindings.shift(); else if (mode === "duplicate") bindings[0] = { key: take(f.jobs, 0).key, ordinal: take(f.jobs, 0).ordinal, requestSha256: take(f.jobs, 0).requestSha256 };
      else take(bindings, 0).requestSha256 = h("wrong-request");
      const manifest = await putJson(f.manifestPath, value); await rejected(loadClaudeStudyImportV3({ manifest, jobs: f.jobs }));
    });
  });
  test("exact closed inventory rejects missing, extra, symlink and occupied ancestor files", async () => {
    for (const mode of ["missing", "extra", "symlink", "ancestor"]) await owned(async f => {
      if (mode === "missing") await unlink(f.jobPath(1, "result.json"));
      if (mode === "extra") await putJson(join(f.study, "comparison-invented.json"), {});
      if (mode === "symlink") { await unlink(f.jobPath(0, "stderr.txt")); await symlink(f.ancestor.cli.path, f.jobPath(0, "stderr.txt")); }
      if (mode === "ancestor") await mkdir(join(f.study, "jobs", take(f.jobs, 0).key), { mode: 0o700 });
      await f.seal(); await rejected(f.load());
    });
  });
  test("modified raw bytes or original ancestry fail despite refreshed outer inventory", async () => {
    for (const which of ["raw", "ancestor"]) await owned(async f => {
      await put(which === "raw" ? f.jobPath(0, "stdout.jsonl") : f.ancestor.jobPath(0, "stdout.jsonl"), "changed\n");
      await f.seal(); await rejected(f.load());
    });
  });
  test("native closing custody and imported lineage checks cannot be waived", async () => {
    for (const key of ["sourceVerifiedAtClose", "cliVerifiedAtClose", "importVerifiedAtClose", "storeClosed", "importedStudySha256", "importedFirstResponses"]) await owned(async f => {
      await mutate(f.batchPath(1), c => { c[key] = typeof c[key] === "boolean" ? false : key.endsWith("Sha256") ? h("wrong") : 3; });
      await f.seal(); await rejected(f.load());
    });
  });
  test("terminal failure, successful prefix, and exact native frontiers remain bound", async () => {
    for (const mode of ["terminal-success", "prior-failure", "frontier", "cached"]) await owned(async f => {
      await mutate(f.batchPath(mode === "prior-failure" ? 0 : 1), c => {
        if (mode === "terminal-success") c.failed = false;
        else if (mode === "prior-failure") c.failed = true;
        else rec(c.result)[mode === "cached" ? "cached" : "completed"] = 999;
      }); await f.seal(); await rejected(f.load());
    });
  });
  test("supervisor owner closure, exact command, and native start time are mandatory", async () => {
    for (const mode of ["live", "command", "time"]) await owned(async f => {
      if (mode === "live") take(f.runs, 1).groupGone = false;
      if (mode === "command") { const run = take(f.runs, 1), cfg = rec(JSON.parse(await readFile(run.configuration.path, "utf8")));
        (cfg.argv as string[])[1] = join(f.ancestor.source, "scripts/benchmarks/claude-study.ts");
        run.configuration = await put(run.configuration.path, pyJson(cfg)); }
      if (mode === "time") await mutate(f.batchPath(0), c => { c.start = iso(190); });
      await f.seal(); await rejected(f.load());
    });
  });
  test("changed preparation provenance is fatal", async () => {
    for (const field of ["imported", "source", "qualified"]) await owned(async f => {
      await mutate(join(f.study, "preparation.json"), p => { p[field] = {}; }); await f.seal(); await rejected(f.load());
    });
  });
  test("reported capacity stop cannot disappear from native history", async () => {
    await owned(async f => { await f.writeJob(0, stream(take(f.v2Jobs, 0), '{"units":[]}', capacity(0.8, 1000))); await f.seal(); await rejected(f.load()); });
  });
  test("inherited capacity pauses block every later admission until the reported reset", async () => {
    await owned(async f => { await rejected(f.load()); }, { inheritedPauseReset: 1000 });
    await owned(async f => { const result = await f.load(); expect(result.capacityPauses.length).toBe(1);
      expect(result.capacityPauses[0]?.unifiedWindows.five_hour?.resetsAt).toBe(T0 / 1000 + 200); }, { inheritedPauseReset: 200 });
  });
  test("reusing a CLI session across ancestral and new stores is rejected", async () => {
    await owned(async f => {
      const raw = stream(take(f.v2Jobs, 0), '{"units":[]}');
      const events = new TextDecoder().decode(raw).trim().split("\n").map(line => JSON.parse(line));
      for (const e of events) if (e.session_id !== undefined) e.session_id = take(f.jobs, 0).key;
      await f.writeJob(0, Buffer.from(events.map(e => JSON.stringify(e)).join("\n") + "\n"));
      await f.seal(); await rejected(f.load());
    });
  });
  test("changed ancestral source is rejected even when v2 inventory is resealed", async () => {
    await owned(async f => { await put(join(f.ancestor.source, "src/synthetic.ts"), "// changed\n"); await f.seal(); await rejected(f.load()); });
  });
  test("unknown independent within-batch attribution remains qualified", async () => {
    await owned(async f => { for (const run of f.runs) delete run.jobKeys; await f.seal();
      expect((await f.load()).summary.jobToBatchAttribution).toContain("standalone producing batch unproven"); });
  });
});
