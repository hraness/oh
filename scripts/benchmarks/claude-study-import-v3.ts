/** Read-only ancestry bridge. Original v1 and v2 remain incomplete; no first response is regenerated. */
import { join, basename } from "node:path";
import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { loadClaudeStudyImport, claudeStudyImportInternals as u, type ClaudeStudyImportPin as Pin } from "./claude-study-import";
import { parseClaudeStudyV2Freeze, claudeStudyV2Procedure, summarizeClaudeExtractionOutcomes } from "./claude-study-v2";
import { completeClaudeExtractionOutcome } from "./claude-extraction-outcome";
import { completeClaudeExtraction, type ClaudeExtractionJob } from "./claude-study-plan";
import { CLAUDE_SUBSCRIPTION_PROFILE, parseClaudeCompletion, type ClaudeInvocation, type ClaudeTokenUsage } from "./claude-subscription";
import { inspectClaudeSubscriptionCapacity, type ClaudeSubscriptionCapacity } from "./claude-qualification";
import { loadJudgeProfile } from "./judge";
import { completeClaudeExtractionOutcomeV3, type ClaudeExtractionOutcomeV3 } from "./claude-extraction-outcome-v3";

const M = 1024 * 1024, STORE = "oh.claude-study-store.v1", VERSION = "2.1.263 (Claude Code)";
export const CLAUDE_STUDY_IMPORT_V3_QUALIFICATION = "Outcome-blind closed v1/v2 ancestry import; both original studies remain incomplete; explicit refusal fallbacks contribute zero memory and no first response is regenerated." as const;
export type ClaudeStudyImportV3Manifest = Readonly<{
  schema: "oh.claude-study-import.v3"; createdAt: string; studyDirectory: string; sourceDirectory: string;
  freeze: Pin; inventory: Pin; supervisorClosure: Pin;
  jobs: readonly Readonly<{ key: string; ordinal: number; requestSha256: string }>[];
  terminalFailedKey: string; qualification: typeof CLAUDE_STUDY_IMPORT_V3_QUALIFICATION;
}>;
export type ClaudeStudyImportV3Origin = Readonly<{
  origin: "imported-v1-first-response" | "imported-v2-first-response";
  jobKey: string; ordinal: number; requestSha256: string; freezeSha256: string; sourceSha256: string;
}>;
type RecordValue = Record<string, unknown>;
type InventoryFile = Readonly<{ path: string; bytes: number; sha256: string }>;
type Read = (path: string, maximum: number) => Promise<Uint8Array>;
type V2Freeze = ReturnType<typeof parseClaudeStudyV2Freeze>;
type Batch = Readonly<{ runId: string; newCalls: number; admitted: boolean; startAt: number; endAt: number;
  pause: ClaudeSubscriptionCapacity | null; jobKeys: readonly string[] | null; receiptSha256: string }>;
export class ClaudeStudyImportV3Error extends Error {
  constructor(readonly code: string) { super(`Claude study v3 ancestry rejected: ${code}.`); this.name = "ClaudeStudyImportV3Error"; }
}
function fail(code: string): never { throw new ClaudeStudyImportV3Error(code); }
function need(v: unknown, code: string): asserts v { if (!v) fail(code); }

export function parseClaudeStudyImportV3Manifest(value: unknown): ClaudeStudyImportV3Manifest {
  const v = u.record(value);
  u.keys(v, ["schema", "createdAt", "studyDirectory", "sourceDirectory", "freeze", "inventory", "supervisorClosure", "jobs", "terminalFailedKey", "qualification"]);
  need(v.schema === "oh.claude-study-import.v3" && v.qualification === CLAUDE_STUDY_IMPORT_V3_QUALIFICATION, "manifest-policy");
  u.time(v.createdAt);
  const jobs = u.array(v.jobs, 50000).map(value => { const b = u.record(value); u.keys(b, ["key", "ordinal", "requestSha256"]);
    return { key: u.hash(b.key), ordinal: u.integer(b.ordinal, 49999), requestSha256: u.hash(b.requestSha256) }; });
  const terminalFailedKey = u.hash(v.terminalFailedKey);
  need(jobs.length > 0 && u.at(jobs, jobs.length - 1).key === terminalFailedKey && new Set(jobs.map(j => j.key)).size === jobs.length, "manifest-prefix");
  return u.frozen({ schema: "oh.claude-study-import.v3", createdAt: u.string(v.createdAt), studyDirectory: u.absolute(v.studyDirectory),
    sourceDirectory: u.absolute(v.sourceDirectory), freeze: u.pin(v.freeze), inventory: u.pin(v.inventory), supervisorClosure: u.pin(v.supervisorClosure),
    jobs, terminalFailedKey, qualification: CLAUDE_STUDY_IMPORT_V3_QUALIFICATION });
}
function parseInventory(value: unknown, freezeSha256: string): InventoryFile[] {
  const v = u.record(value); u.keys(v, ["schema", "freezeSha256", "files"]);
  need(v.schema === "oh.claude-final-inventory.v2" && v.freezeSha256 === freezeSha256, "inventory-binding");
  const files = u.array(v.files, 65536).map(value => { const f = u.record(value); u.keys(f, ["path", "bytes", "sha256"]);
    return { path: u.rel(f.path), bytes: u.integer(f.bytes, 128 * M), sha256: u.hash(f.sha256) }; });
  need(files.every((f, i) => i === 0 || u.at(files, i - 1).path < f.path) && new Set(files.map(f => f.path)).size === files.length, "inventory-order");
  need(files.reduce((sum, f) => sum + f.bytes, 0) <= 8 * 1024 * M, "inventory-total"); return files;
}

async function bindSupervisor(configuration: Pin, statusPin: Pin, manifest: ClaudeStudyImportV3Manifest,
  maximum: number, exit: number, startAt: number, endAt: number): Promise<void> {
  const config = u.record(u.json(await u.pinned(configuration, 128 * 1024))); u.keys(config, ["argv", "cwd", "jobDir", "requireAbsent"]);
  const jobDir = u.absolute(config.jobDir), argv = u.array(config.argv, 16).map(u.string), bun = u.absolute(u.at(argv, 0));
  need(basename(bun) === "bun" && configuration.path === join(jobDir, "config.json") && statusPin.path === join(jobDir, "status.json")
    && jobDir !== manifest.studyDirectory && !jobDir.startsWith(manifest.studyDirectory + "/") && config.cwd === manifest.sourceDirectory, "supervisor-path-binding");
  u.same(argv, [bun, join(manifest.sourceDirectory, "scripts/benchmarks/claude-study-v2.ts"), "run", "--directory", manifest.studyDirectory,
    "--freeze-sha256", manifest.freeze.sha256, "--max-new-calls", String(maximum)], "supervisor-argv");
  const absent = u.array(config.requireAbsent, 64).map(u.absolute); need(new Set(absent).size === absent.length, "supervisor-absence-shape");
  need(sha256Hex(u.supervisorJson(config)) === configuration.sha256, "supervisor-canonical-config");
  const status = u.record(u.json(await u.pinned(statusPin, 128 * 1024)));
  u.keys(status, ["state", "supervisorPid", "supervisorStart", "bootIdentity", "commandSha256", "configSha256", "startedAt", "childPid", "childPgid", "childStart", "exitCode", "groupGone", "finishedAt"]);
  const supervisor = u.integer(status.supervisorPid), child = u.integer(status.childPid), pgid = u.integer(status.childPgid);
  need(supervisor > 0 && child > 0 && child === pgid && supervisor !== child, "supervisor-process-binding");
  for (const value of [status.supervisorStart, status.bootIdentity]) need(u.string(value).length > 0 && u.string(value).length <= 512 && !u.string(value).includes("\0"), "supervisor-identity");
  need(status.childStart === null || (typeof status.childStart === "string" && status.childStart.length > 0 && status.childStart.length <= 512 && !status.childStart.includes("\0")), "supervisor-child-start");
  need(status.state === "exited" && status.groupGone === true && status.exitCode === exit && status.configSha256 === configuration.sha256
    && status.commandSha256 === sha256Hex(u.supervisorJson(argv)), "supervisor-status-binding");
  const began = u.supervisorTime(status.startedAt), ended = u.supervisorTime(status.finishedAt);
  need(began <= startAt && ended >= began && ended <= u.time(manifest.createdAt) && endAt < ended + 1000, "supervisor-time-window");
}

async function history(manifest: ClaudeStudyImportV3Manifest, freeze: V2Freeze, files: readonly InventoryFile[], read: Read,
  closure: RecordValue, allJobs: number, inherited: Awaited<ReturnType<typeof loadClaudeStudyImport>>) {
  u.keys(closure, ["schema", "freezeSha256", "inventorySha256", "finalBatchSha256", "verification", "allProducersClosed", "runs"]);
  need(closure.schema === "oh.claude-final-supervisor-closure.v2" && closure.freezeSha256 === manifest.freeze.sha256
    && closure.inventorySha256 === manifest.inventory.sha256 && closure.verification === "owner-verified-complete-producer-inventory"
    && closure.allProducersClosed === true, "supervisor-closure");
  const runs = u.array(closure.runs, 4096); need(runs.length > 0, "empty-history");
  const batches: Batch[] = [], externalPins: Pin[] = [], expectedFiles = new Set(["freeze.json", "preparation.json", "store.json"]), seen = new Set<string>();
  let cumulative = 0, previousEnd = u.time(freeze.createdAt);
  const pauses = [...inherited.capacityPauses];
  for (const [index, item] of runs.entries()) {
    const run = u.record(item); u.keys(run, ["runId", "admissionSha256", "closureSha256", "configuration", "supervisorStatus", "groupGone", "runnerExitCode", "newTransportInvocations", ...(Object.hasOwn(run, "jobKeys") ? ["jobKeys"] : [])]);
    const runId = u.string(run.runId); need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId) && !seen.has(runId), "run-id"); seen.add(runId);
    need(run.groupGone === true, "active-producer"); const configuration = u.pin(run.configuration), statusPin = u.pin(run.supervisorStatus); externalPins.push(configuration, statusPin);
    const name = `batch-${runId}.json`, raw = await read(name, 32768); expectedFiles.add(name);
    const receiptSha256 = u.hash(run.closureSha256); need(sha256Hex(raw) === receiptSha256, "closure-pin"); const c = u.record(u.json(raw));
    u.keys(c, ["protocol", "runId", "freezeSha256", "sourceSha256", "importedStudySha256", "importedFirstResponses", "importVerifiedAtClose", "start", "end", "admissionSha256", "sourceVerifiedAtClose", "cliVerifiedAtClose", "storeClosed", "comparisonArtifact", "qualified", "newTransportInvocations", "maximumNewCalls", "interrupted", "capacityPause", "failed", "result"]);
    const startAt = u.time(c.start), endAt = u.time(c.end), max = u.integer(c.maximumNewCalls, 256), newCalls = u.integer(run.newTransportInvocations, 256);
    need(max > 0 && newCalls <= max && startAt >= previousEnd && endAt >= startAt && endAt <= u.time(manifest.createdAt), "batch-time-or-limit"); previousEnd = endAt;
    need(c.protocol === "oh.memory-claude-subscription-batch.v2" && c.runId === runId && c.freezeSha256 === manifest.freeze.sha256
      && c.sourceSha256 === freeze.sourceSha256 && c.newTransportInvocations === newCalls && c.sourceVerifiedAtClose === true
      && c.cliVerifiedAtClose === true && c.importVerifiedAtClose === true && c.importedStudySha256 === freeze.importedStudy.sha256
      && c.importedFirstResponses === inherited.invocations.size && c.storeClosed === true && c.comparisonArtifact === null
      && typeof c.interrupted === "boolean" && typeof c.failed === "boolean", "batch-binding-or-custody");
    const q = u.record(c.qualified), auth = u.record(q.auth); u.keys(q, ["version", "auth"]); u.keys(auth, ["authMethod", "apiProvider", "subscriptionType"]);
    need(q.version === VERSION && auth.authMethod === "claude.ai" && auth.apiProvider === "firstParty" && ["max", "pro", "team", "enterprise"].includes(u.string(auth.subscriptionType)), "subscription-route");
    const terminal = index === runs.length - 1, admitted = run.admissionSha256 !== null, before = cumulative, exit = u.integer(run.runnerExitCode, 255);
    await bindSupervisor(configuration, statusPin, manifest, max, exit, startAt, endAt);
    if (admitted) {
      const admissionName = `batch-${runId}-started.json`, aRaw = await read(admissionName, 32768); expectedFiles.add(admissionName);
      const admissionSha = u.hash(run.admissionSha256); need(sha256Hex(aRaw) === admissionSha && c.admissionSha256 === admissionSha, "admission-pin");
      u.same(u.json(aRaw), { protocol: "oh.memory-claude-subscription-batch-admission.v2", runId, freezeSha256: manifest.freeze.sha256,
        sourceSha256: freeze.sourceSha256, cliSha256: freeze.cli.sha256, start: c.start, maximumNewCalls: max,
        importedStudySha256: freeze.importedStudy.sha256, importedFirstResponses: inherited.invocations.size }, "admission-binding");
      need(pauses.every(p => Object.values(p.unifiedWindows).every(w => w.utilization < 0.7 || w.resetsAt <= startAt / 1000)), "admission-before-capacity-reset");
      cumulative += newCalls; need(cumulative <= manifest.jobs.length, "history-overrun");
      if (terminal) {
        need(newCalls > 0 && c.failed === true && exit === 1 && c.interrupted === false && cumulative === manifest.jobs.length
          && closure.finalBatchSha256 === receiptSha256, "terminal-failure-shape");
        u.same(c.result, { status: "blocked", phase: "extract", completed: inherited.invocations.size + cumulative - 1,
          cached: inherited.invocations.size + before, reason: "Private evidence requires review before accepting this batch." }, "terminal-native-frontier");
      } else {
        need(c.failed === false && exit === 0 && cumulative < manifest.jobs.length, "earlier-admitted-failure");
        u.same(c.result, { status: "paused", phase: "extract", resolved: inherited.invocations.size + cumulative, required: allJobs,
          valid: inherited.summary.validCount + cumulative, invalid: inherited.summary.invalidCount, imported: inherited.invocations.size }, "prior-native-frontier");
      }
    } else {
      need(!terminal && newCalls === 0 && c.admissionSha256 === null && c.failed === true && exit === 1, "unadmitted-failure");
      u.same(c.result, { status: "blocked", phase: "extract", completed: 0, cached: 0, reason: "Private evidence requires review before accepting this batch." }, "unadmitted-native-frontier");
    }
    let pause: ClaudeSubscriptionCapacity | null = null;
    if (c.capacityPause !== null) { const rawPause = u.record(c.capacityPause);
      pause = inspectClaudeSubscriptionCapacity(new TextEncoder().encode(JSON.stringify({ type: "rate_limit_event", rate_limit_info: rawPause }) + "\n"));
      u.same(pause, rawPause, "pause-shape"); pauses.push(pause); }
    const jobKeys = Object.hasOwn(run, "jobKeys") ? u.array(run.jobKeys, 256).map(u.hash) : null;
    if (jobKeys !== null) u.same(jobKeys, manifest.jobs.slice(before, before + newCalls).map(job => job.key), "independent-roster");
    batches.push({ runId, newCalls, admitted, startAt, endAt, pause, jobKeys, receiptSha256 });
  }
  need(cumulative === manifest.jobs.length, "history-incomplete");
  for (const job of manifest.jobs) for (const name of ["pending.json", "result.json", "stdout.jsonl", "stderr.txt"]) expectedFiles.add(`jobs/${job.key}/${name}`);
  u.same(files.map(f => f.path), [...expectedFiles].sort(), "exact-extraction-only-inventory");
  return { batches, externalPins };
}

async function readCapture(read: Read, freezeSha256: string, job: ClaudeExtractionJob) {
  const base = `jobs/${job.key}`, pending = u.record(u.json(await read(`${base}/pending.json`, 2048)));
  u.same(pending, { protocol: STORE, freezeSha256, jobKey: job.key, requestSha256: job.requestSha256 }, "pending-binding");
  const result = u.record(u.json(await read(`${base}/result.json`, 4 * M))); u.keys(result, ["protocol", "freezeSha256", "jobKey", "requestSha256", "invocation"]);
  need(result.protocol === STORE && result.freezeSha256 === freezeSha256 && result.jobKey === job.key && result.requestSha256 === job.requestSha256, "result-binding");
  const saved = u.record(result.invocation); u.keys(saved, ["protocol", "requestSha256", "exitCode", "timedOut", "outputBoundExceeded", "stdout", "stderr"]);
  need(saved.protocol === CLAUDE_SUBSCRIPTION_PROFILE && saved.requestSha256 === job.requestSha256 && saved.exitCode === 0
    && saved.timedOut === false && saved.outputBoundExceeded === false, "incomplete-transport");
  const raw = await read(`${base}/stdout.jsonl`, 16 * M), err = await read(`${base}/stderr.txt`, M);
  const stdout = { bytes: raw.length, sha256: sha256Hex(raw) }, stderr = { bytes: err.length, sha256: sha256Hex(err) };
  u.same(saved.stdout, stdout, "stdout-hash"); u.same(saved.stderr, stderr, "stderr-hash");
  let completion: ClaudeInvocation["completion"] = null;
  try { completion = parseClaudeCompletion(raw, job.request.model); } catch { /* The versioned classifier must independently explain the only allowed failure. */ }
  const invocation: ClaudeInvocation = u.frozen({ protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256: job.requestSha256,
    status: completion === null ? "incomplete" : "completed", exitCode: 0, timedOut: false, outputBoundExceeded: false, stdout, stderr, completion });
  return { invocation, raw, capacity: inspectClaudeSubscriptionCapacity(raw) };
}

/** Imports every first transport in the authenticated ancestral prefix, without opening any writable store. */
export async function loadClaudeStudyImportV3(input: Readonly<{ manifest: Pin; jobs: readonly ClaudeExtractionJob[] }>) {
  try {
    const args = u.record(input); u.keys(args, ["manifest", "jobs"]);
    const manifestPin = u.pin(args.manifest), jobs = u.checkedJobs(input.jobs);
    const manifest = parseClaudeStudyImportV3Manifest(u.json(await u.pinned(manifestPin, 8 * M)));
    need(manifest.freeze.path === join(manifest.studyDirectory, "freeze.json") && ![manifestPin, manifest.inventory, manifest.supervisorClosure]
      .some(p => p.path.startsWith(manifest.studyDirectory + "/")), "external-manifest-pins");
    const closure = u.record(u.json(await u.pinned(manifest.supervisorClosure, 8 * M)));
    need(closure.allProducersClosed === true && closure.verification === "owner-verified-complete-producer-inventory"
      && u.array(closure.runs, 4096).every(run => u.record(run).groupGone === true), "closed-owner-required");
    const files = parseInventory(u.json(await u.pinned(manifest.inventory, 16 * M)), manifest.freeze.sha256);
    u.same(await u.closedFiles(manifest.studyDirectory), files.map(f => f.path), "closed-file-inventory");
    const read = u.inventoryReader(manifest.studyDirectory, files), freezeRaw = await read("freeze.json", 8 * M);
    need(sha256Hex(freezeRaw) === manifest.freeze.sha256, "freeze-pin");
    const freeze = u.frozen(parseClaudeStudyV2Freeze(u.json(freezeRaw)));
    const sourceBefore = await u.sourceIdentity(manifest.sourceDirectory); need(sourceBefore.sha256 === freeze.sourceSha256, "source-before");
    await u.pinned(freeze.cli, 512 * M);
    const initialCapacity = inspectClaudeSubscriptionCapacity(await u.pinned(freeze.capacityEvidence, 16 * M));
    const inherited = await loadClaudeStudyImport({ manifest: freeze.importedStudy, jobs });
    need(manifest.studyDirectory !== inherited.manifest.studyDirectory && !manifest.studyDirectory.startsWith(inherited.manifest.studyDirectory + "/")
      && !inherited.manifest.studyDirectory.startsWith(manifest.studyDirectory + "/"), "overlapping-studies");
    need(u.time(freeze.createdAt) >= u.time(inherited.manifest.createdAt), "freeze-before-ancestral-closure");
    need(inherited.invocations.size + manifest.jobs.length <= jobs.length, "prefix-overrun");
    u.same(manifest.jobs, jobs.slice(inherited.invocations.size, inherited.invocations.size + manifest.jobs.length).map(u.binding), "exact-ordered-prefix");
    u.same(freeze.inputs, inherited.freeze.inputs, "original-inputs"); u.same(freeze.cli, inherited.freeze.cli, "original-cli");
    const profile = await loadJudgeProfile(); u.same(freeze.procedure, claudeStudyV2Procedure(profile.sha256), "v2-procedure");
    const originalOutcomes = jobs.slice(0, inherited.invocations.size).map(job => completeClaudeExtractionOutcome(job,
      inherited.invocations.get(job.key) ?? fail("missing-ancestral-response")));
    const originalSummary = summarizeClaudeExtractionOutcomes(originalOutcomes, new Set(inherited.invocations.keys()));
    u.same(freeze.study, { ...inherited.freeze.study, importedFirstResponses: inherited.invocations.size,
      importedValidChunks: originalSummary.validNewChunks, importedInvalidParents: originalSummary.invalidNewParents,
      importedDispositionsSha256: originalSummary.dispositionsSha256, remainingFirstExtractionCalls: jobs.length - inherited.invocations.size }, "v2-study-identity");
    const prepared = u.record(u.json(await read("preparation.json", 8 * M))), preparedSource = u.record(prepared.source);
    need(prepared.noModelCalls === true && preparedSource.sourceSha256 === freeze.sourceSha256 && preparedSource.bun === "1.3.14", "preparation-source");
    u.same(preparedSource.files, sourceBefore.entries, "preparation-source-files"); u.same(prepared.capacity, initialCapacity, "preparation-capacity");
    u.same(prepared.imported, originalSummary, "preparation-import");
    const qualified = u.record(prepared.qualified), auth = u.record(qualified.auth); u.keys(qualified, ["version", "auth"]); u.keys(auth, ["authMethod", "apiProvider", "subscriptionType"]);
    need(qualified.version === VERSION && auth.authMethod === "claude.ai" && auth.apiProvider === "firstParty" && ["max", "pro", "team", "enterprise"].includes(u.string(auth.subscriptionType)), "preparation-subscription");
    u.same(u.json(await read("store.json", 1024)), { protocol: STORE, freezeSha256: manifest.freeze.sha256 }, "store-header");
    const verified = await history(manifest, freeze, files, read, closure, jobs.length, inherited);
    const entries: (readonly [string, ClaudeExtractionOutcomeV3])[] = [], origins: (readonly [string, ClaudeStudyImportV3Origin])[] = [];
    const sessions = new Set<string>(), capacities: ClaudeSubscriptionCapacity[] = [], rawEvidence: RecordValue[] = [], payloads: RecordValue[] = [];
    for (const [index, outcome] of originalOutcomes.entries()) {
      const job = u.at(jobs, index), invocation = inherited.invocations.get(job.key) ?? fail("missing-ancestral-response");
      need(invocation.completion && !sessions.has(invocation.completion.sessionId), "ancestral-session"); sessions.add(invocation.completion.sessionId);
      entries.push([job.key, outcome]); origins.push([job.key, u.frozen({ origin: "imported-v1-first-response", jobKey: job.key, ordinal: job.ordinal,
        requestSha256: job.requestSha256, freezeSha256: inherited.manifest.freeze.sha256, sourceSha256: inherited.freeze.sourceSha256 })]);
    }
    let newTerminalUsage = u.zeroUsage(), knownUsd = 0, unknownUsd = 0, terminalOutcomeSha256: string | null = null;
    const newModelUsage: Record<string, ClaudeTokenUsage> = {};
    for (const [index, b] of manifest.jobs.entries()) {
      const job = u.at(jobs, inherited.invocations.size + index), capture = await readCapture(read, manifest.freeze.sha256, job);
      const outcome = completeClaudeExtractionOutcomeV3(job, capture.invocation, capture.raw);
      if (index < manifest.jobs.length - 1) {
        need(outcome.status === "valid", "earlier-v2-outcome-changed");
        const native = completeClaudeExtraction(job, capture.invocation); u.same(outcome.result, native, "native-valid-payload-changed");
        payloads.push({ key: job.key, ordinal: job.ordinal, payloadSha256: native.payloadSha256 });
      } else { need(outcome.status === "invalid-refusal-fallback" && job.key === manifest.terminalFailedKey, "terminal-is-not-refusal-fallback"); terminalOutcomeSha256 = canonicalSha256(outcome); }
      const facts = outcome.status === "invalid-refusal-fallback" ? outcome.fallback : outcome.result.completion;
      need(!sessions.has(facts.sessionId), "reused-cli-session"); sessions.add(facts.sessionId);
      newTerminalUsage = u.addUsage(newTerminalUsage, facts.usage);
      for (const [model, usage] of Object.entries(facts.modelUsage)) newModelUsage[model] = u.addUsage(newModelUsage[model] ?? u.zeroUsage(), usage);
      if (facts.listPriceEstimateUsd === null) unknownUsd++; else knownUsd += facts.listPriceEstimateUsd; need(Number.isFinite(knownUsd), "estimate-overflow");
      entries.push([job.key, outcome]); origins.push([job.key, u.frozen({ origin: "imported-v2-first-response", jobKey: job.key, ordinal: job.ordinal,
        requestSha256: job.requestSha256, freezeSha256: manifest.freeze.sha256, sourceSha256: freeze.sourceSha256 })]);
      capacities.push(capture.capacity); rawEvidence.push({ key: b.key, requestSha256: job.requestSha256, stdout: capture.invocation.stdout, stderr: capture.invocation.stderr });
    }
    need(terminalOutcomeSha256 !== null, "missing-terminal-outcome"); u.verifyCapacity(verified.batches, capacities);
    for (const file of files) await read(file.path, 128 * M);
    u.same(await u.closedFiles(manifest.studyDirectory), files.map(f => f.path), "final-inventory");
    const evidencePins = u.frozen([manifestPin, manifest.freeze, manifest.inventory, manifest.supervisorClosure, freeze.importedStudy,
      freeze.capacityEvidence, inherited.manifest.freeze, inherited.manifest.inventory, inherited.manifest.supervisorClosure,
      inherited.freeze.capacityEvidence, ...verified.externalPins]);
    for (const p of evidencePins) await u.pinned(p, 16 * M);
    await u.pinned(freeze.cli, 512 * M); u.same(await u.sourceIdentity(manifest.sourceDirectory), sourceBefore, "source-after");
    const after = await loadClaudeStudyImport({ manifest: freeze.importedStudy, jobs }); u.same(after.summary, inherited.summary, "ancestry-changed-at-close");
    need((await loadJudgeProfile()).sha256 === profile.sha256, "profile-after");
    const capacityPauses = u.frozen([...inherited.capacityPauses, ...verified.batches.flatMap(b => b.pause === null ? [] : [b.pause])]);
    const modelUsageSeparate: Record<string, ClaudeTokenUsage> = { ...inherited.summary.modelUsageSeparate };
    for (const [model, usage] of Object.entries(newModelUsage)) modelUsageSeparate[model] = u.addUsage(modelUsageSeparate[model] ?? u.zeroUsage(), usage);
    const summary = u.frozen({ profile: "oh.claude-study-import.v3", manifestSha256: manifestPin.sha256,
      importedV1ManifestSha256: freeze.importedStudy.sha256, freezeSha256: manifest.freeze.sha256, sourceSha256: freeze.sourceSha256,
      inventorySha256: manifest.inventory.sha256, supervisorClosureSha256: manifest.supervisorClosure.sha256,
      importedTransportInvocations: entries.length, v1TransportInvocations: inherited.invocations.size, v2TransportInvocations: manifest.jobs.length,
      validCount: inherited.summary.validCount + payloads.length, invalidEnvelopeCount: inherited.summary.invalidCount, invalidRefusalFallbackCount: 1,
      terminalFailedKey: manifest.terminalFailedKey, terminalOutcomeSha256, originalMissingParents: jobs.length, remainingFirstExtractionCalls: jobs.length - entries.length,
      outcomesSha256: canonicalSha256(entries), originsSha256: canonicalSha256(origins), orderedJobsSha256: canonicalSha256(jobs.slice(0, entries.length).map(u.binding)),
      newValidPayloadsSha256: canonicalSha256(payloads), newInvocationEvidenceSha256: canonicalSha256(rawEvidence),
      inheritedSummarySha256: canonicalSha256(inherited.summary), inheritedTerminalUsage: inherited.summary.terminalUsage, newTerminalUsage,
      terminalUsage: u.addUsage(inherited.summary.terminalUsage, newTerminalUsage), inheritedModelUsageSeparate: inherited.summary.modelUsageSeparate,
      newModelUsageSeparate: newModelUsage, modelUsageSeparate,
      listPriceEstimateUsdKnownSubtotal: inherited.summary.listPriceEstimateUsdKnownSubtotal + knownUsd,
      unknownListPriceEstimates: inherited.summary.unknownListPriceEstimates + unknownUsd, billedUsd: null, physicalModelAttempts: null,
      capacityPausesSha256: canonicalSha256(capacityPauses), batchCount: verified.batches.length, batchEvidenceSha256: canonicalSha256(verified.batches),
      jobToBatchAttribution: verified.batches.every(b => b.jobKeys !== null || b.newCalls === 0)
        ? "independently retained rosters checked against original order" : "bounded deterministic partition under complete external custody; standalone producing batch unproven",
      originalV1Status: "incomplete", originalV2Status: "incomplete", qualification: manifest.qualification });
    need(Number.isFinite(summary.listPriceEstimateUsdKnownSubtotal), "estimate-overflow");
    return Object.freeze({ outcomes: u.immutableMap(entries), origins: u.immutableMap(origins), summary, manifest, freeze,
      originalFreeze: inherited.freeze, capacityPauses, evidencePins });
  } catch (error) { if (error instanceof ClaudeStudyImportV3Error) throw error; return fail("native-or-io-rejection"); }
}
