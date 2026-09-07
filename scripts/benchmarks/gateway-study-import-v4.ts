/** Read-only continuation of four closed, rejected Gateway captures. No old job is dispatched or settled. */
import { basename, join, relative } from "node:path";
import { lstat, readdir, realpath } from "node:fs/promises";
import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { claudeStudyImportInternals as u, type ClaudeStudyImportPin as Pin } from "./claude-study-import";
import { parseGatewayStudyFreeze, readGatewayStudyAuth, verifyGatewayStudyAuthority, gatewayStudyProcedure, type GatewayStudyAuth } from "./gateway-study-v3";
import { gatewayJobPending, gatewayReservation } from "./gateway-study-store-v3";
import { completeGatewayExtraction, makeGatewayExtractionJobs, type GatewayExtractionJob, type GatewayExtractionRow } from "./gateway-study-plan-v3";
import { gatewayStudyLedgerExposure, parseGatewayStudyResponse, type GatewayStudyRaw, type GatewayStudyLedgerEvent } from "./gateway-study-transport-v3";
import { loadJudgeProfile } from "./judge";

const M = 1024 * 1024;
const SOURCE = "50128750d92090d99ec4d4968dafe54cda9866a9d12bb1e28b94aa075c76a037";
export const GATEWAY_STUDY_IMPORT_V4_QUALIFICATION = "Closed Gateway v3 first responses are replayed once under the v4 optional-routing amendment; the original v3 study remains blocked, no parent is resubmitted, and its full reserved ledger exposure remains charged." as const;
export type GatewayStudyImportV4Manifest = Readonly<{ schema: "oh.gateway-study-import.v4"; createdAt: string; studyDirectory: string; sourceDirectory: string;
  freeze: Pin; inventory: Pin; supervisorClosure: Pin; jobs: readonly Readonly<{ key: string; ordinal: number; requestSha256: string }>[];
  qualification: typeof GATEWAY_STUDY_IMPORT_V4_QUALIFICATION }>;
type Ledger = Readonly<{ path: string; sha256: string; bytes: number; exposureMicros: number }>;
type Input = Readonly<{ manifest: Pin; jobs: readonly GatewayExtractionJob[]; expectedClaudeImportSha256: string; expectedOriginalLedger: Ledger }>;
type File = Readonly<{ path: string; bytes: number; sha256: string }>;
type Scope = Readonly<{ sourceSha256: string; jobCount: number; externalExposureMicros: number; verifyAuthority: typeof verifyGatewayStudyAuthority }>;
type Read = (path: string, maximum: number) => Promise<Uint8Array>;
export class GatewayStudyImportV4Error extends Error { constructor(readonly code: string) { super(`Gateway v4 import rejected: ${code}.`); this.name = "GatewayStudyImportV4Error"; } }
function need(v: unknown, code: string): asserts v { if (!v) throw new GatewayStudyImportV4Error(code); }
function binding(job: GatewayExtractionJob) { return { key: job.key, ordinal: job.ordinal, requestSha256: job.request.requestSha256 }; }

export function parseGatewayStudyImportV4Manifest(value: unknown): GatewayStudyImportV4Manifest {
  const v = u.record(value); u.keys(v, ["schema", "createdAt", "studyDirectory", "sourceDirectory", "freeze", "inventory", "supervisorClosure", "jobs", "qualification"]);
  need(v.schema === "oh.gateway-study-import.v4" && v.qualification === GATEWAY_STUDY_IMPORT_V4_QUALIFICATION, "manifest-policy"); u.time(v.createdAt);
  const jobs = u.array(v.jobs, 4).map(value => { const j = u.record(value); u.keys(j, ["key", "ordinal", "requestSha256"]);
    return { key: u.hash(j.key), ordinal: u.integer(j.ordinal, 49999), requestSha256: u.hash(j.requestSha256) }; });
  need(jobs.length === 4 && new Set(jobs.map(j => j.key)).size === 4 && jobs.every((j, i) => i === 0 || j.ordinal > u.at(jobs, i - 1).ordinal), "four-original-jobs");
  return u.frozen({ schema: "oh.gateway-study-import.v4", createdAt: u.string(v.createdAt), studyDirectory: u.absolute(v.studyDirectory), sourceDirectory: u.absolute(v.sourceDirectory),
    freeze: u.pin(v.freeze), inventory: u.pin(v.inventory), supervisorClosure: u.pin(v.supervisorClosure), jobs, qualification: GATEWAY_STUDY_IMPORT_V4_QUALIFICATION });
}
function inventory(value: unknown, freezeSha256: string): File[] {
  const v = u.record(value); u.keys(v, ["schema", "freezeSha256", "files"]); need(v.schema === "oh.gateway-import-inventory.v4" && v.freezeSha256 === freezeSha256, "inventory-binding");
  const files = u.array(v.files, 64).map(value => { const f = u.record(value); u.keys(f, ["path", "bytes", "sha256"]);
    return { path: u.rel(f.path), bytes: u.integer(f.bytes, 8 * M), sha256: u.hash(f.sha256) }; });
  need(files.every((f, i) => i === 0 || u.at(files, i - 1).path < f.path) && files.reduce((n, f) => n + f.bytes, 0) <= 32 * M, "inventory-order-or-bound"); return files;
}
async function closedFiles(root: string): Promise<string[]> {
  need(await realpath(root) === root, "study-alias"); const files: string[] = [];
  async function visit(path: string, depth: number): Promise<void> {
    const s = await lstat(path); need(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o700 && s.uid === process.getuid?.() && depth <= 2, "directory-custody");
    const entries = await readdir(path, { withFileTypes: true });
    if (depth === 1) need(relative(root, path) === "jobs" && entries.length === 4, "four-job-directories");
    if (depth === 2) { need(/^jobs\/[a-f0-9]{64}$/.test(relative(root, path)), "job-directory");
      u.same(entries.map(e => e.name).sort(), ["pending.json", "reserved.json", "response.body", "response.json"], "rejected-capture-files"); }
    for (const entry of entries) { need(entry.name !== "active.lock", "active-lock"); const p = join(path, entry.name);
      if (entry.isDirectory()) await visit(p, depth + 1); else { need(entry.isFile(), "special-file"); files.push(u.rel(relative(root, p))); } need(files.length <= 64, "file-count"); }
  }
  await visit(root, 0); return files.sort();
}
function qualified(value: unknown, start: number, auth: GatewayStudyAuth) {
  const q = u.record(value); u.keys(q, ["method", "project", "scope", "environment", "issuer", "subject", "audience", "expiresAt", "signatureVerifiedLocally"]);
  need(q.method === auth.method && q.project === auth.project && q.scope === auth.scope && q.environment === auth.environment
    && ["https://oidc.vercel.com", `https://oidc.vercel.com/${auth.scope}`].includes(u.string(q.issuer)) && q.subject === `owner:${auth.scope}:project:${auth.project}:environment:${auth.environment}`
    && q.audience === `https://vercel.com/${auth.scope}` && q.signatureVerifiedLocally === false && typeof q.expiresAt === "number" && Number.isFinite(q.expiresAt)
    && q.expiresAt >= start / 1000 + 310, "scoped-oidc-metadata"); return q;
}
async function supervisor(configuration: Pin, statusPin: Pin, manifest: GatewayStudyImportV4Manifest, maximum: number, start: number, end: number, auth: GatewayStudyAuth) {
  const c = u.record(u.json(await u.pinned(configuration, 128 * 1024))); u.keys(c, ["argv", "cwd", "jobDir", "requireAbsent"]);
  const argv = u.array(c.argv, 32).map(u.string), executable = u.absolute(u.at(argv, 0)), bun = u.absolute(u.at(argv, 10)), jobDir = u.absolute(c.jobDir);
  need(basename(executable) === "vercel" && basename(bun) === "bun" && c.cwd === manifest.sourceDirectory && jobDir !== manifest.studyDirectory && !jobDir.startsWith(manifest.studyDirectory + "/")
    && configuration.path === join(jobDir, "config.json") && statusPin.path === join(jobDir, "status.json"), "supervisor-path-binding");
  u.same(argv, [executable, "env", "run", "--project", auth.project, "--scope", auth.scope, "--environment", auth.environment, "--", bun,
    join(manifest.sourceDirectory, "scripts/benchmarks/gateway-study-v3.ts"), "run", "--directory", manifest.studyDirectory, "--freeze-sha256", manifest.freeze.sha256, "--max-new-calls", String(maximum)], "supervisor-command");
  const absent = u.array(c.requireAbsent, 64).map(u.absolute); need(new Set(absent).size === absent.length && absent.includes(join(manifest.studyDirectory, "active.lock")), "supervisor-lock-gate");
  need(sha256Hex(u.supervisorJson(c)) === configuration.sha256, "supervisor-canonical-config");
  const s = u.record(u.json(await u.pinned(statusPin, 128 * 1024))); u.keys(s, ["state", "supervisorPid", "supervisorStart", "bootIdentity", "commandSha256", "configSha256", "startedAt", "childPid", "childPgid", "childStart", "exitCode", "groupGone", "finishedAt"]);
  const parent = u.integer(s.supervisorPid), child = u.integer(s.childPid); need(parent > 0 && child > 0 && child === s.childPgid && child !== parent, "supervisor-process-binding");
  for (const v of [s.supervisorStart, s.bootIdentity]) need(typeof v === "string" && v.length > 0 && v.length <= 512 && !v.includes("\0"), "supervisor-identity");
  need(s.childStart === null || (typeof s.childStart === "string" && s.childStart.length > 0 && s.childStart.length <= 512 && !s.childStart.includes("\0")), "supervisor-child-identity");
  need(s.state === "exited" && s.exitCode === 1 && s.groupGone === true && s.configSha256 === configuration.sha256 && s.commandSha256 === sha256Hex(u.supervisorJson(argv)), "supervisor-terminal-failure");
  const began = u.supervisorTime(s.startedAt), ended = u.supervisorTime(s.finishedAt);
  need(began <= start && ended >= began && end < ended + 1000 && ended <= u.time(manifest.createdAt), "supervisor-time-window");
}

async function load(input: Input, scope: Scope) {
  try {
    const manifestPin = u.pin(input.manifest), manifest = parseGatewayStudyImportV4Manifest(u.json(await u.pinned(manifestPin, 8 * M)));
    need(manifest.freeze.path === join(manifest.studyDirectory, "freeze.json") && [manifestPin, manifest.inventory, manifest.supervisorClosure].every(p => p.path !== manifest.studyDirectory && !p.path.startsWith(manifest.studyDirectory + "/"))
      && manifest.sourceDirectory !== manifest.studyDirectory && !manifest.sourceDirectory.startsWith(manifest.studyDirectory + "/"), "external-evidence-paths");
    const jobs = u.frozen(structuredClone(input.jobs)); need(jobs.length === scope.jobCount, "complete-plan-count");
    const original = u.checkedJobs(jobs.map(j => j.original)); u.same(jobs, makeGatewayExtractionJobs(original, new Map()), "native-complete-plan");
    u.same(manifest.jobs, jobs.slice(0, 4).map(binding), "first-four-prefix");
    const closure = u.record(u.json(await u.pinned(manifest.supervisorClosure, M)));
    u.keys(closure, ["schema", "freezeSha256", "inventorySha256", "verification", "allProducersClosed", "runs"]);
    need(closure.schema === "oh.gateway-import-supervisor-closure.v4" && closure.freezeSha256 === manifest.freeze.sha256 && closure.inventorySha256 === manifest.inventory.sha256
      && closure.verification === "owner-verified-complete-producer-inventory" && closure.allProducersClosed === true, "closed-owner-evidence");
    const runs = u.array(closure.runs, 1); need(runs.length === 1, "one-failed-batch"); const run = u.record(u.at(runs, 0));
    u.keys(run, ["runId", "admissionSha256", "closureSha256", "configuration", "supervisorStatus", "groupGone", "runnerExitCode", "newTransportInvocations"]);
    const runId = u.string(run.runId); need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId) && run.groupGone === true && run.runnerExitCode === 1 && run.newTransportInvocations === 4, "failed-producer-evidence");
    const files = inventory(u.json(await u.pinned(manifest.inventory, M)), manifest.freeze.sha256);
    const expectedFiles = ["freeze.json", "preparation.json", "store.json", "ledger.jsonl", `batch-${runId}.json`, `batch-${runId}-started.json`,
      ...manifest.jobs.flatMap(j => ["pending.json", "reserved.json", "response.body", "response.json"].map(n => `jobs/${j.key}/${n}`))].sort();
    u.same(files.map(f => f.path), expectedFiles, "exact-closed-inventory"); u.same(await closedFiles(manifest.studyDirectory), expectedFiles, "closed-file-set");
    const read: Read = u.inventoryReader(manifest.studyDirectory, files), rawFreeze = await read("freeze.json", 8 * M);
    need(sha256Hex(rawFreeze) === manifest.freeze.sha256, "freeze-pin"); const freeze = parseGatewayStudyFreeze(u.json(rawFreeze));
    need(freeze.sourceSha256 === scope.sourceSha256 && freeze.importedStudy.sha256 === u.hash(input.expectedClaudeImportSha256), "frozen-source-or-claude-import");
    u.same(freeze.originalLedger, input.expectedOriginalLedger, "original-ledger-binding");
    const source = await u.sourceIdentity(manifest.sourceDirectory); need(source.sha256 === scope.sourceSha256, "source-before");
    need(freeze.study.remainingFirstExtractionCalls === jobs.length && freeze.study.newExtractionOrderSha256 === canonicalSha256(jobs.map(j => ({ key: j.key, ordinal: j.ordinal, originalJobKey: j.original.key, requestSha256: j.request.requestSha256 }))), "frozen-native-plan");
    const auth = await readGatewayStudyAuth(freeze.authority), profile = await loadJudgeProfile(); u.same(freeze.procedure, gatewayStudyProcedure(profile.sha256, auth), "frozen-procedure");
    const batchName = `batch-${runId}.json`, batchRaw = await read(batchName, M); need(sha256Hex(batchRaw) === u.hash(run.closureSha256), "batch-pin"); const b = u.record(u.json(batchRaw));
    u.keys(b, ["protocol", "runId", "freezeSha256", "sourceSha256", "importedStudySha256", "start", "end", "admission", "maximumNewCalls", "concurrency", "newTransportInvocations", "admittedKeys", "initialJobKeys", "finalJobKeys", "failed", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose", "interrupted", "stopReason", "qualified", "ledger", "comparisonArtifact", "result"]);
    const start = u.time(b.start), end = u.time(b.end), maximum = u.integer(b.maximumNewCalls, 256);
    need(maximum >= 4 && start >= u.time(freeze.createdAt) && end >= start && end <= u.time(manifest.createdAt) && b.protocol === "oh.memory-gateway-batch.v3" && b.runId === runId
      && b.freezeSha256 === manifest.freeze.sha256 && b.sourceSha256 === freeze.sourceSha256 && b.importedStudySha256 === freeze.importedStudy.sha256 && b.newTransportInvocations === 4 && b.concurrency === 4
      && b.failed === true && b.storeClosed === true && b.sourceVerifiedAtClose === true && b.importVerifiedAtClose === true && b.originalLedgerVerifiedAtClose === true
      && b.interrupted === false && b.stopReason === null && b.comparisonArtifact === null, "failed-native-batch");
    u.same(b.result, { status: "blocked", phase: "extract", reason: "Preserved first-response evidence requires review; no retry." }, "failed-native-result");
    u.same(b.initialJobKeys, [], "no-previous-gateway-jobs"); u.same(b.admittedKeys, manifest.jobs.map(j => j.key), "admitted-order"); u.same(b.finalJobKeys, manifest.jobs.map(j => j.key).sort(), "final-job-inventory");
    const admission = u.pin(b.admission), admissionName = `batch-${runId}-started.json`;
    u.same(admission, { path: join(manifest.studyDirectory, admissionName), sha256: u.hash(run.admissionSha256) }, "admission-pin-binding");
    const admissionRaw = await read(admissionName, 32768); need(sha256Hex(admissionRaw) === admission.sha256, "admission-pin"); const q = qualified(b.qualified, start, auth);
    u.same(u.json(admissionRaw), { protocol: "oh.memory-gateway-batch-admission.v3", runId, freezeSha256: manifest.freeze.sha256, sourceSha256: freeze.sourceSha256,
      importedStudySha256: freeze.importedStudy.sha256, start: b.start, maximumNewCalls: maximum, concurrency: 4, openingLedgerExposureMicros: 0, initialJobKeysSha256: canonicalSha256([]), qualified: q }, "native-admission");
    const configuration = u.pin(run.configuration), statusPin = u.pin(run.supervisorStatus); await supervisor(configuration, statusPin, manifest, maximum, start, end, auth);
    u.same(await scope.verifyAuthority(freeze.authority), input.expectedOriginalLedger, "authority-before-replay");
    const preparation = u.record(u.json(await read("preparation.json", 8 * M))), preparedSource = u.record(preparation.source);
    u.keys(preparation, ["source", "noModelCalls", "imported", "originalLedger", "maximumNewExposureMicros"]);
    need(preparation.noModelCalls === true && preparation.maximumNewExposureMicros === 40_000_000 && preparedSource.sourceSha256 === scope.sourceSha256 && preparedSource.bun === "1.3.14" && preparedSource.dirty === false, "preparation-source");
    u.same(preparedSource.files, source.entries, "preparation-files"); u.same(preparation.imported, freeze.study.imported, "preparation-imported"); u.same(preparation.originalLedger, input.expectedOriginalLedger, "preparation-original-ledger");
    u.same(u.json(await read("store.json", 2048)), { protocol: "oh.memory-gateway-store.v3", freezeSha256: manifest.freeze.sha256 }, "store-header");
    const ledgerRaw = await read("ledger.jsonl", 32768), ledgerText = new TextDecoder("utf-8", { fatal: true }).decode(ledgerRaw);
    need(ledgerText.endsWith("\n"), "partial-ledger-line"); const events: GatewayStudyLedgerEvent[] = ledgerText.slice(0, -1).split("\n").map(line => JSON.parse(line));
    const expectedEvents = jobs.slice(0, 4).map(job => ({ v: 1, id: job.key, kind: "reserved", micros: gatewayReservation(job).micros })); u.same(events, expectedEvents, "four-unsettled-reservations");
    const exposure = gatewayStudyLedgerExposure(events); need(exposure === scope.externalExposureMicros, "conservative-exposure");
    const ledgerPin = u.frozen({ path: join(manifest.studyDirectory, "ledger.jsonl"), sha256: sha256Hex(ledgerRaw), bytes: ledgerRaw.length, exposureMicros: exposure });
    u.same(b.ledger, { path: ledgerPin.path, bytes: ledgerPin.bytes, sha256: ledgerPin.sha256, exposureMicros: exposure,
      budget: { capUsd: 40, maxCalls: maximum, reservedCalls: 4, historicalExposureUsd: 21.655385, priorAmendmentExposureUsd: 0, accountedUsd: exposure / 1e6,
        confirmedThisRunUsd: 0, unresolvedThisRunUsd: exposure / 1e6, billedUsd: null } }, "failed-ledger-budget");
    const rows: GatewayExtractionRow[] = [], origins = [], usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 };
    for (const job of jobs.slice(0, 4)) {
      const prefix = `jobs/${job.key}`; u.same(u.json(await read(`${prefix}/pending.json`, M)), gatewayJobPending(job, manifest.freeze.sha256), "pending-request");
      const reservation = gatewayReservation(job); u.same(u.json(await read(`${prefix}/reserved.json`, 4096)), { v: 1, id: job.key, kind: "reserved", micros: reservation.micros }, "reserved-file");
      const metadata = u.record(u.json(await read(`${prefix}/response.json`, 32768))); u.keys(metadata, ["requestSha256", "httpStatus", "bodyComplete", "receivedBytes", "transportError", "body"]);
      const body = await read(`${prefix}/response.body`, M); u.same(metadata.body, { bytes: body.length, sha256: sha256Hex(body) }, "captured-body-binding");
      need(metadata.httpStatus === 200 && metadata.bodyComplete === true && metadata.transportError === null, "completed-original-transport");
      const response = parseGatewayStudyResponse(job.request, reservation, { ...metadata, body } as GatewayStudyRaw);
      need(response.finishReason === "stop" && response.identity.resolvedProviderApiModelId === null && response.identity.resolvedSnapshot === null && response.identity.snapshotPinned === false, "optional-routing-amendment-only");
      rows.push(completeGatewayExtraction(job, response)); for (const key of Object.keys(usage) as Array<keyof typeof usage>) usage[key] = u.integer(usage[key] + response.usage[key]);
      origins.push({ origin: "imported-rejected-gateway-v3-capture", replayProfile: "oh.gateway-study-import.v4", originalNativeStatus: "blocked", ...binding(job),
        freezeSha256: manifest.freeze.sha256, sourceSha256: scope.sourceSha256, runId, rawSha256: response.rawSha256, rawBytes: response.rawBytes, conservativeReservedMicros: reservation.micros });
    }
    for (const file of files) await read(file.path, 8 * M); u.same(await closedFiles(manifest.studyDirectory), expectedFiles, "closed-files-after");
    u.same(await u.sourceIdentity(manifest.sourceDirectory), source, "source-after"); u.same(await scope.verifyAuthority(freeze.authority), input.expectedOriginalLedger, "authority-after");
    need((await loadJudgeProfile()).sha256 === profile.sha256, "judge-profile-after");
    const evidencePins = u.frozen([manifestPin, manifest.freeze, manifest.inventory, manifest.supervisorClosure, configuration, statusPin, admission,
      { path: join(manifest.studyDirectory, batchName), sha256: u.hash(run.closureSha256) }, freeze.authority, freeze.importedStudy, input.expectedOriginalLedger, ledgerPin]);
    for (const pin of evidencePins) await u.pinned(pin, 16 * M);
    const summary = u.frozen({ schema: "oh.gateway-study-import-summary.v4", manifestSha256: manifestPin.sha256, freezeSha256: manifest.freeze.sha256,
      sourceSha256: scope.sourceSha256, importedClaudeManifestSha256: freeze.importedStudy.sha256, importedTransportInvocations: 4, importedRowsSha256: canonicalSha256(rows),
      originsSha256: canonicalSha256(origins), originalGatewayStatus: "blocked", externalExposureMicros: exposure, ledger: ledgerPin, reportedUsage: usage,
      validCount: rows.filter(r => r.status === "valid").length, invalidEnvelopeCount: rows.filter(r => r.status === "invalid-envelope").length,
      invalidRefusalCount: rows.filter(r => r.status === "invalid-refusal").length, billedUsd: null, physicalModelAttempts: null, qualification: manifest.qualification });
    return u.frozen({ rows, origins, summary, manifest, freeze, ledgerPin, evidencePins });
  } catch (error) { if (error instanceof GatewayStudyImportV4Error) throw error; throw new GatewayStudyImportV4Error("native-or-io-rejection"); }
}

/** Fixed production acceptance. Callers cannot relax the original source, four-capture prefix or reserved exposure. */
export function loadGatewayStudyImportV4(input: Input) {
  return load(input, { sourceSha256: SOURCE, jobCount: 4920, externalExposureMicros: 121802, verifyAuthority: verifyGatewayStudyAuthority });
}
/** Synthetic validation seam only. This is not production-study acceptance and is never used by a runner. */
export const gatewayStudyImportV4Internals = Object.freeze({ loadSynthetic: load, closedFiles });
