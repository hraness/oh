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
async function fixture(root: string) {
  const study = join(root, "study"), source = join(root, "source");
  for (const p of [study, join(study, "jobs"), source, join(source, "src"), join(source, "scripts"), join(source, "scripts/benchmarks")]) await mkdir(p, { mode: 0o700 });
  const sourceFiles = ["package.json", "bun.lock", "tsconfig.json", "tsconfig.scripts.json", "scripts/benchmark-memory.ts", "src/synthetic.ts", "scripts/benchmarks/synthetic.ts"].sort();
  const entries = [];
  for (const p of sourceFiles) { const pin = await put(join(source, p), `// inert synthetic source ${p}\n`); entries.push({ path: p, sha256: pin.sha256 }); }
  const sourceSha256 = canonicalSha256(entries), cli = await put(join(root, "inert-cli"), "This synthetic CLI is never executed.\n");
  const selection = await put(join(root, "selection.json"), "synthetic selection\n"), legacyPin = await put(join(root, "legacy.json"), "synthetic legacy\n");
  const exclusion = await put(join(root, "exclusion.json"), "synthetic exclusion\n"), originalSourceSha256 = h("legacy-source");
  const corpus: Corpus = { id: "synthetic-corpus", groupId: "synthetic-family", turns: Array.from({ length: 4 }, (_, i) => ({
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
    requiredChunks: 4, completedChunks: 1, missingChunks: 3, totalUnits: 0, qualifications: [] };
  const jobs = makeClaudeExtractionJobs([corpus], legacy), bindings = jobs.map(({ key, ordinal, requestSha256 }) => ({ key, ordinal, requestSha256 }));
  if (jobs.length !== 3) throw new Error("synthetic fixture must have three native missing parents");
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
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function owned(run: (f: Fixture) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "oh-claude-import-"))); await chmod(root, 0o700);
  try { await run(await fixture(root)); } finally { await rm(root, { recursive: true, force: true }); }
}
async function rejects(promise: Promise<unknown>, code?: string) {
  let observed: unknown; try { await promise; } catch (error) { observed = error; }
  expect(observed).toBeInstanceOf(ClaudeStudyImportError);
  if (code !== undefined) expect((observed as ClaudeStudyImportError).code).toBe(code);
}

describe("closed v1 first-response import", () => {
  test("replays every raw first response, preserves native payloads and counts malformed usage once, without writes", async () => {
    await owned(async f => {
      const before = await inventory(f.study), result = await f.load(), first = take(f.jobs, 0), second = take(f.jobs, 1);
      expect(result.invocations.size).toBe(2); expect([...result.invocations.keys()]).toEqual([first.key, second.key]);
      expect(result.invocations.has(take(f.jobs, 2).key)).toBe(false);
      const native = completeClaudeExtraction(first, result.invocations.get(first.key)!);
      expect(native.payload.units.length).toBe(1);
      expect(result.summary.validPayloadsSha256).toBe(canonicalSha256([{ key: first.key, ordinal: first.ordinal, payloadSha256: native.payloadSha256 }]));
      expect(result.summary.terminalUsage).toEqual({ inputTokens: 22, outputTokens: 14, cacheReadInputTokens: 26, cacheCreationInputTokens: 34 });
      expect(result.summary.modelUsageSeparate).toEqual({ [MODEL]: result.summary.terminalUsage });
      expect(result.summary.listPriceEstimateUsdKnownSubtotal).toBe(0.002);
      expect(result.summary.unknownListPriceEstimates).toBe(0); expect(result.summary.billedUsd).toBeNull(); expect(result.summary.physicalModelAttempts).toBeNull();
      expect(result.summary.importedTransportInvocations).toBe(2); expect(result.summary.validCount).toBe(1); expect(result.summary.invalidCount).toBe(1);
      expect(result.summary.originalV1Status).toBe("incomplete"); expect(result.summary.jobToBatchAttribution).toContain("independently retained rosters");
      expect(result.invocations.get(second.key)?.completion?.prediction).toBe("{");
      expect(Object.hasOwn(result.invocations, "set")).toBe(false); expect(Object.isFrozen(result.invocations)).toBe(true);
      expect(Object.isFrozen(result.invocations.get(first.key)?.completion?.modelUsage[MODEL])).toBe(true);
      expect(Object.isFrozen(result.freeze.study)).toBe(true); expect(Object.isFrozen(result.manifest.jobs)).toBe(true);
      expect(result.freeze.sourceSha256).toBe(f.sourceSha256); expect(await inventory(f.study)).toEqual(before);
    });
  });
  test("honestly qualifies attribution when independently retained rosters do not exist", async () => {
    await owned(async f => { for (const run of f.runs) Reflect.deleteProperty(run, "jobKeys"); await f.seal();
      expect((await f.load()).summary.jobToBatchAttribution).toContain("standalone producing batch unproven"); });
  });
  test("valid empty and all-rejected earlier envelopes stay valid; terminal wrong envelope stays invalid", async () => {
    for (const units of [[], [null]]) await owned(async f => { await f.writeJob(0, JSON.stringify({ units })); await f.writeJob(1, "[]"); await f.seal();
      const result = await f.load(), native = completeClaudeExtraction(take(f.jobs, 0), result.invocations.get(take(f.jobs, 0).key)!);
      expect(native.payload).toEqual({ id: take(f.jobs, 0).chunk.id, units: [], rejected: units.length });
      expect(result.summary.validCount).toBe(1); expect(result.summary.invalidCount).toBe(1); });
  });
  test("terminal valid-empty or all-rejected output is never relabelled invalid", async () => {
    for (const units of [[], [null]]) await owned(async f => { await f.writeJob(1, JSON.stringify({ units })); await f.seal(); await rejects(f.load(), "terminal-is-not-invalid-envelope"); });
  });
  test("an earlier malformed envelope cannot be skipped", async () => {
    await owned(async f => { await f.writeJob(0, "{"); await f.seal(); await rejects(f.load(), "earlier-invalid-envelope"); });
  });
  test("complete occupied inventory forbids missing files, empty directories, later jobs and semantic artifacts", async () => {
    for (const mode of ["missing", "empty", "later", "comparison"]) await owned(async f => {
      if (mode === "missing") await unlink(f.jobPath(1, "result.json"));
      if (mode === "empty") await mkdir(join(f.study, "jobs", h("orphan")), { mode: 0o700 });
      if (mode === "later") await f.writeJob(2, '{"units":[]}');
      if (mode === "comparison") await putJson(join(f.study, "comparison-invented.json"), { rows: [] });
      await f.seal(); await rejects(f.load(), mode === "missing" || mode === "empty" ? "incomplete-job-directory" : "exact-extraction-only-inventory");
    });
  });
  test("changed raw bytes cannot be hidden behind a refreshed outer inventory", async () => {
    await owned(async f => { await put(f.jobPath(0, "stdout.jsonl"), stream(take(f.jobs, 0), '{"units":[]}')); await f.seal(); await rejects(f.load(), "stdout-hash"); });
  });
  test("old freeze, request and complete original job order remain bound", async () => {
    await owned(async f => { await mutate(f.jobPath(0, "pending.json"), v => { v.freezeSha256 = h("other-freeze"); }); await f.seal(); await rejects(f.load(), "pending-binding"); });
    await owned(async f => { const pin = await mutate(f.manifestPath, v => { rec(take(v.jobs as unknown[], 0)).requestSha256 = h("other-request"); });
      await rejects(loadClaudeStudyImport({ manifest: pin, jobs: f.jobs }), "exact-ordered-prefix"); });
    await owned(async f => { await rejects(loadClaudeStudyImport({ manifest: f.manifestPin, jobs: f.jobs.slice(0, 2) }), "complete-original-job-plan"); });
  });
  test("source and executable drift fail before accepting first responses", async () => {
    await owned(async f => { await put(join(f.source, "src/synthetic.ts"), "source changed"); await rejects(f.load(), "source-before"); });
    await owned(async f => { await put(f.cli.path, "binary changed"); await rejects(f.load(), "pin-changed"); });
  });
  test("original selection, legacy and exclusion pins are reread before returning", async () => {
    for (const name of ["selection.json", "legacy.json", "exclusion.json"]) await owned(async f => {
      await put(join(f.root, name), "changed original input bytes"); await rejects(f.load(), "pin-changed");
    });
  });
  test("native transport uncertainty, missing billing evidence and torn framing remain fatal", async () => {
    for (const mode of ["exit", "timeout", "bound", "quota", "overage", "missing-rate", "torn", "wrong-version"]) await owned(async f => {
      if (["exit", "timeout", "bound"].includes(mode)) {
        await mutate(f.jobPath(1, "result.json"), v => { const saved = rec(v.invocation); if (mode === "exit") saved.exitCode = 1;
          else if (mode === "timeout") saved.timedOut = true; else saved.outputBoundExceeded = true; });
      } else {
        const events = (await readFile(f.jobPath(1, "stdout.jsonl"), "utf8")).trimEnd().split("\n").map(s => rec(JSON.parse(s)));
        if (mode === "quota") rec(take(events, 3).rate_limit_info).status = "rejected";
        if (mode === "overage") rec(take(events, 3).rate_limit_info).isUsingOverage = true;
        if (mode === "missing-rate") events.pop();
        if (mode === "wrong-version") take(events, 0).claude_code_version = "2.1.264";
        const raw = Buffer.from(events.map(v => JSON.stringify(v)).join("\n") + (mode === "torn" ? "" : "\n"));
        await put(f.jobPath(1, "stdout.jsonl"), raw); await mutate(f.jobPath(1, "result.json"), v => { rec(v.invocation).stdout = { bytes: raw.length, sha256: sha256Hex(raw) }; });
      }
      await f.seal(); await rejects(f.load(), ["exit", "timeout", "bound"].includes(mode) ? "incomplete-transport" : "native-or-io-rejection");
    });
  });
  test("only the final admitted native extraction-format failure is importable", async () => {
    for (const mode of ["prior-failure", "exit", "closed", "gone", "frontier", "cached"]) await owned(async f => {
      if (mode === "prior-failure") await mutate(f.batchPath(0), v => { v.failed = true; });
      if (mode === "exit") take(f.runs, 1).runnerExitCode = 0;
      if (mode === "closed") await mutate(f.batchPath(1), v => { v.storeClosed = false; });
      if (mode === "gone") take(f.runs, 1).groupGone = false;
      if (mode === "frontier") await mutate(f.batchPath(1), v => { rec(v.result).completed = 2; });
      if (mode === "cached") await mutate(f.batchPath(1), v => { rec(v.result).cached = 0; });
      await f.seal(); await rejects(f.load(), ({ "prior-failure": "earlier-admitted-failure", exit: "supervisor-status-binding", closed: "batch-binding-or-custody",
        gone: "closed-owner-required", frontier: "terminal-native-frontier", cached: "terminal-native-frontier" } as Record<string, string>)[mode]);
    });
  });
  test("original producer pins, independent roster and closed file custody cannot be omitted", async () => {
    await owned(async f => { take(f.runs, 1).jobKeys = [take(f.jobs, 0).key]; await f.seal(); await rejects(f.load(), "independent-roster"); });
    await owned(async f => { await put(take(f.runs, 1).supervisorStatus.path, "changed closure source"); await rejects(f.load(), "pin-changed"); });
    await owned(async f => { await put(join(f.study, "active.lock"), "owned synthetic active lock"); await f.seal(); await rejects(f.load(), "active-lock"); });
    await owned(async f => { await chmod(f.jobPath(0, "stdout.jsonl"), 0o644); await rejects(f.load(), "private-file-mode"); });
    await owned(async f => { const p = f.jobPath(0, "stdout.jsonl"), raw = await readFile(p), target = join(f.root, "symlink-target"); await put(target, raw); await unlink(p); await symlink(target, p);
      await f.seal(); await rejects(f.load(), "special-file"); });
  });
  test("raw high capacity requires the exact last-job pause; expired-by-end evidence stays qualified", async () => {
    await owned(async f => { await f.writeJob(1, "{", capacity(0.8)); await f.seal(); await rejects(f.load(), "missing-proven-pause"); });
    await owned(async f => { await f.writeJob(1, "{", capacity(0.8)); await mutate(f.batchPath(1), v => { v.capacityPause = capacity(0.75); }); await f.seal(); await rejects(f.load(), "pause-raw-mismatch"); });
    await owned(async f => { await f.writeJob(1, "{", capacity(0.8)); await mutate(f.batchPath(1), v => { v.capacityPause = capacity(0.8); }); await f.seal();
      const imported = await f.load(); expect(imported.summary.importedTransportInvocations).toBe(2);
      expect(imported.capacityPauses).toEqual([capacity(0.8)]); expect(Object.isFrozen(imported.capacityPauses)).toBe(true);
      expect(imported.summary.capacityPausesSha256).toBe(canonicalSha256(imported.capacityPauses)); });
    await owned(async f => { await f.writeJob(0, f.validPrediction, capacity(0.8, 15)); await f.seal(); expect((await f.load()).summary.validCount).toBe(1); });
  });
  test("new admissions cannot continue within or after a provably active raw capacity pause", async () => {
    await owned(async f => {
      await f.writeJob(0, f.validPrediction, capacity(0.8));
      await mutate(f.batchPath(0), v => { v.capacityPause = capacity(0.8); });
      await f.seal(); await rejects(f.load(), "admission-before-capacity-reset");
    });
    await owned(async f => {
      await f.writeJob(0, f.validPrediction, capacity(0.8));
      const removed = f.runs.shift(); if (!removed) throw new Error("synthetic missing first run");
      await unlink(join(f.study, `batch-${removed.runId}.json`)); await unlink(join(f.study, `batch-${removed.runId}-started.json`));
      const run = take(f.runs, 0); run.newTransportInvocations = 2; run.jobKeys = f.jobs.slice(0, 2).map(job => job.key);
      const admission = await mutate(join(f.study, `batch-${run.runId}-started.json`), v => { v.maximumNewCalls = 2; });
      await mutate(f.batchPath(1), v => { v.maximumNewCalls = 2; v.newTransportInvocations = 2;
        v.admissionSha256 = admission.sha256; rec(v.result).cached = 0; });
      const config = rec(JSON.parse(await readFile(run.configuration.path, "utf8")));
      (config.argv as string[])[8] = "2"; run.configuration = await put(run.configuration.path, pyJson(config));
      run.supervisorStatus = await mutate(run.supervisorStatus.path, v => { v.configSha256 = run.configuration.sha256; v.commandSha256 = sha256Hex(pyJson(config.argv)); });
      await f.seal(); await rejects(f.load(), "call-after-proven-pause");
    });
  });
  test("supervisor config, command, closed state and native time window must agree even after repinning", async () => {
    for (const mode of ["cwd", "argv", "config-hash", "command-hash", "state", "child-group", "same-process", "window", "future-finish", "group-gone"]) await owned(async f => {
      const run = take(f.runs, 1);
      if (mode === "cwd" || mode === "argv") {
        const config = rec(JSON.parse(await readFile(run.configuration.path, "utf8")));
        if (mode === "cwd") config.cwd = f.root; else (config.argv as string[])[8] = "2";
        run.configuration = await put(run.configuration.path, pyJson(config));
        run.supervisorStatus = await mutate(run.supervisorStatus.path, v => { v.configSha256 = run.configuration.sha256; v.commandSha256 = sha256Hex(pyJson(config.argv)); });
      } else run.supervisorStatus = await mutate(run.supervisorStatus.path, v => {
        if (mode === "config-hash") v.configSha256 = h("wrong-config");
        if (mode === "command-hash") v.commandSha256 = h("wrong-command");
        if (mode === "state") v.state = "running";
        if (mode === "child-group") v.childPgid = 2222;
        if (mode === "same-process") v.supervisorPid = v.childPid;
        if (mode === "window") v.finishedAt = iso(35).replace(".000Z", "Z");
        if (mode === "future-finish") v.finishedAt = iso(101).replace(".000Z", "Z");
        if (mode === "group-gone") v.groupGone = false;
      });
      await f.seal(); await rejects(f.load(), ({ cwd: "supervisor-path-binding", argv: "supervisor-argv", "config-hash": "supervisor-status-binding",
        "command-hash": "supervisor-status-binding", state: "supervisor-status-binding", "child-group": "supervisor-process-binding",
        "same-process": "supervisor-process-binding", window: "supervisor-time-window", "future-finish": "supervisor-time-window", "group-gone": "supervisor-status-binding" } as Record<string, string>)[mode]);
    });
  });
  test("complete prefix job inputs are detached before the first await and cannot invoke getters", async () => {
    await owned(async f => { const jobs = structuredClone(f.jobs), promise = loadClaudeStudyImport({ manifest: f.manifestPin, jobs });
      Object.defineProperty(take(jobs, 0), "requestSha256", { value: h("changed-after-start") });
      expect((await promise).summary.importedTransportInvocations).toBe(2); });
    await owned(async f => { const jobs = structuredClone(f.jobs); let called = 0;
      Object.defineProperty(take(jobs, 0), "request", { enumerable: true, get() { called++; throw new Error("getter must not run"); } });
      await rejects(loadClaudeStudyImport({ manifest: f.manifestPin, jobs })); expect(called).toBe(0); });
  });
});
