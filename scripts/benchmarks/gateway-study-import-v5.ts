/** Immutable import of a closed v4 prefix; truncation is zero-memory, never a retried parent. */
import { basename, join, relative } from "node:path";
import { lstat, readdir, realpath } from "node:fs/promises";
import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { claudeStudyImportInternals as u, type ClaudeStudyImportPin as Pin } from "./claude-study-import";
import { readGatewayStudyAuth, verifyGatewayStudyAuthority, type GatewayStudyAuth } from "./gateway-study-v3";
import { parseGatewayStudyV4Freeze, gatewayStudyV4Procedure, gatewayStudyV4Identity, loadGatewayStudyV4Context, gatewayV4LedgerExposure, type GatewayStudyV4Freeze } from "./gateway-study-v4";
import { gatewayJobPending, gatewayReservation } from "./gateway-study-store-v3";
import { completeGatewayExtraction, makeGatewayExtractionJobs, type GatewayExtractionJob } from "./gateway-study-plan-v3";
import { completeGatewayV5Extraction, type GatewayExtractionRowV5 } from "./gateway-study-plan-v5";
import { parseGatewayStudyV5 } from "./gateway-study-transport-v5";
import { parseGatewayStudyResponse, type GatewayStudyRaw, type GatewayStudyLedgerEvent } from "./gateway-study-transport-v3";
import { loadJudgeProfile } from "./judge";

const M = 1024 * 1024, CARRIED = 121802;
export const GATEWAY_STUDY_IMPORT_V5_QUALIFICATION = "Every closed Gateway v4 first response is retained once under the universal v5 extraction-truncation zero-memory rule; the original v4 study remains blocked, no parent is resubmitted, and its complete immutable ledger exposure remains charged." as const;
export type GatewayStudyImportV5Manifest = Readonly<{ schema: "oh.gateway-study-import.v5"; createdAt: string; studyDirectory: string; sourceDirectory: string;
  freeze: Pin; inventory: Pin; supervisorClosure: Pin; jobs: readonly Readonly<{ key: string; ordinal: number; requestSha256: string }>[];
  truncatedJobKey: string; qualification: typeof GATEWAY_STUDY_IMPORT_V5_QUALIFICATION }>;
type Ledger = Readonly<{ path: string; sha256: string; bytes: number; exposureMicros: number }>;
type Input = Readonly<{ manifest: Pin; jobs: readonly GatewayExtractionJob[]; expectedPriorGatewayImportSha256: string; expectedClaudeImportSha256: string; expectedOriginalLedger: Ledger }>;
type File = Readonly<{ path: string; bytes: number; sha256: string }>;
type Scope = Readonly<{ sourceSha256: string; freezeSha256: string; ledgerSha256: string; ledgerBytes: number; priorGatewayImportSha256: string;
  jobCount: number; importCount: number; batchCounts: readonly [number, number]; maximumCalls: readonly [number, number]; truncatedJobKey: string;
  truncatedOrdinal: number; externalExposureMicros: number; verifyAuthority: typeof verifyGatewayStudyAuthority;
  verifyAncestry: (freeze: GatewayStudyV4Freeze, jobs: readonly GatewayExtractionJob[]) => Promise<void> }>;
export class GatewayStudyImportV5Error extends Error { constructor(readonly code: string) { super(`Gateway v5 import rejected: ${code}.`); this.name = "GatewayStudyImportV5Error"; } }
function need(v: unknown, code: string): asserts v { if (!v) throw new GatewayStudyImportV5Error(code); }
function binding(job: GatewayExtractionJob) { return { key: job.key, ordinal: job.ordinal, requestSha256: job.request.requestSha256 }; }
function parseManifest(value: unknown, count: number): GatewayStudyImportV5Manifest {
  const v = u.record(value); u.keys(v, ["schema", "createdAt", "studyDirectory", "sourceDirectory", "freeze", "inventory", "supervisorClosure", "jobs", "truncatedJobKey", "qualification"]);
  need(v.schema === "oh.gateway-study-import.v5" && v.qualification === GATEWAY_STUDY_IMPORT_V5_QUALIFICATION, "manifest-policy"); u.time(v.createdAt);
  const jobs = u.array(v.jobs, count).map(value => { const j = u.record(value); u.keys(j, ["key", "ordinal", "requestSha256"]);
    return { key: u.hash(j.key), ordinal: u.integer(j.ordinal, 49999), requestSha256: u.hash(j.requestSha256) }; });
  const truncatedJobKey = u.hash(v.truncatedJobKey);
  need(jobs.length === count && new Set(jobs.map(j => j.key)).size === count && jobs.some(j => j.key === truncatedJobKey)
    && jobs.every((j, i) => i === 0 || j.ordinal > u.at(jobs, i - 1).ordinal), "original-prefix-jobs");
  return u.frozen({ schema: "oh.gateway-study-import.v5", createdAt: u.string(v.createdAt), studyDirectory: u.absolute(v.studyDirectory), sourceDirectory: u.absolute(v.sourceDirectory),
    freeze: u.pin(v.freeze), inventory: u.pin(v.inventory), supervisorClosure: u.pin(v.supervisorClosure), jobs, truncatedJobKey, qualification: GATEWAY_STUDY_IMPORT_V5_QUALIFICATION });
}
export function parseGatewayStudyImportV5Manifest(value: unknown) { return parseManifest(value, 184); }
function inventory(value: unknown, freezeSha256: string): File[] {
  const v = u.record(value); u.keys(v, ["schema", "freezeSha256", "files"]); need(v.schema === "oh.gateway-import-inventory.v5" && v.freezeSha256 === freezeSha256, "inventory-binding");
  const files = u.array(v.files, 2048).map(value => { const f = u.record(value); u.keys(f, ["path", "bytes", "sha256"]);
    return { path: u.rel(f.path), bytes: u.integer(f.bytes, 8 * M), sha256: u.hash(f.sha256) }; });
  need(files.every((f, i) => i === 0 || u.at(files, i - 1).path < f.path) && files.reduce((n, f) => n + f.bytes, 0) <= 256 * M, "inventory-order-or-bound"); return files;
}
async function closedFiles(root: string): Promise<string[]> {
  need(await realpath(root) === root, "study-alias"); const files: string[] = [];
  async function visit(path: string, depth: number): Promise<void> {
    const s = await lstat(path); need(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o700 && s.uid === process.getuid?.() && depth <= 2, "directory-custody");
    const entries = await readdir(path, { withFileTypes: true });
    if (depth === 1) need(relative(root, path) === "jobs", "job-directories");
    if (depth === 2) need(/^jobs\/[a-f0-9]{64}$/.test(relative(root, path)), "job-directory");
    for (const entry of entries) { need(entry.name !== "active.lock", "active-lock"); const p = join(path, entry.name);
      if (entry.isDirectory()) await visit(p, depth + 1); else { need(entry.isFile(), "special-file"); files.push(u.rel(relative(root, p))); } need(files.length <= 2048, "file-count"); }
  }
  await visit(root, 0); return files.sort();
}
function ledger(raw: Uint8Array): GatewayStudyLedgerEvent[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw); need(text.endsWith("\n"), "partial-ledger-line");
  const events = text.slice(0, -1).split("\n").map(line => JSON.parse(line)); gatewayV4LedgerExposure(events, CARRIED); return events;
}
function waves(events: readonly GatewayStudyLedgerEvent[], unresolved: string | null) {
  const pending = new Set<string>(); let count = 0, settling = false;
  for (const event of events) {
    if (event.kind === "reserved") {
      if (pending.size === 0) { need(count === 0 || count === 4, "incomplete-native-wave"); count = 0; settling = false; }
      need(!settling && ++count <= 4 && !pending.has(event.id), "native-wave-order"); pending.add(event.id);
    } else { need(pending.delete(event.id), "native-wave-settlement"); settling = true; }
  }
  need(count === 4, "native-final-wave-size"); u.same([...pending], unresolved === null ? [] : [unresolved], "native-unresolved-wave");
}
function qualified(value: unknown, start: number, auth: GatewayStudyAuth) {
  const q = u.record(value); u.keys(q, ["method", "project", "scope", "environment", "issuer", "subject", "audience", "expiresAt", "signatureVerifiedLocally"]);
  need(q.method === auth.method && q.project === auth.project && q.scope === auth.scope && q.environment === auth.environment
    && ["https://oidc.vercel.com", `https://oidc.vercel.com/${auth.scope}`].includes(u.string(q.issuer)) && q.subject === `owner:${auth.scope}:project:${auth.project}:environment:${auth.environment}`
    && q.audience === `https://vercel.com/${auth.scope}` && q.signatureVerifiedLocally === false && typeof q.expiresAt === "number" && Number.isFinite(q.expiresAt)
    && q.expiresAt >= start / 1000 + 310, "scoped-oidc-metadata"); return q;
}
async function supervisor(configuration: Pin, statusPin: Pin, manifest: GatewayStudyImportV5Manifest, maximum: number, start: number, end: number, auth: GatewayStudyAuth, exitCode: number) {
  const c = u.record(u.json(await u.pinned(configuration, 128 * 1024))); u.keys(c, ["argv", "cwd", "jobDir", "requireAbsent"]);
  const argv = u.array(c.argv, 32).map(u.string), executable = u.absolute(u.at(argv, 0)), bun = u.absolute(u.at(argv, 10)), jobDir = u.absolute(c.jobDir);
  need(basename(executable) === "vercel" && basename(bun) === "bun" && c.cwd === manifest.sourceDirectory && jobDir !== manifest.studyDirectory && !jobDir.startsWith(manifest.studyDirectory + "/")
    && configuration.path === join(jobDir, "config.json") && statusPin.path === join(jobDir, "status.json"), "supervisor-path-binding");
  u.same(argv, [executable, "env", "run", "--project", auth.project, "--scope", auth.scope, "--environment", auth.environment, "--", bun,
    join(manifest.sourceDirectory, "scripts/benchmarks/gateway-study-v4.ts"), "run", "--directory", manifest.studyDirectory, "--freeze-sha256", manifest.freeze.sha256, "--max-new-calls", String(maximum)], "supervisor-command");
  const absent = u.array(c.requireAbsent, 64).map(u.absolute); need(new Set(absent).size === absent.length && absent.includes(join(manifest.studyDirectory, "active.lock")), "supervisor-lock-gate");
  need(sha256Hex(u.supervisorJson(c)) === configuration.sha256, "supervisor-canonical-config");
  const s = u.record(u.json(await u.pinned(statusPin, 128 * 1024))); u.keys(s, ["state", "supervisorPid", "supervisorStart", "bootIdentity", "commandSha256", "configSha256", "startedAt", "childPid", "childPgid", "childStart", "exitCode", "groupGone", "finishedAt"]);
  const parent = u.integer(s.supervisorPid), child = u.integer(s.childPid); need(parent > 0 && child > 0 && child === s.childPgid && child !== parent, "supervisor-process-binding");
  for (const v of [s.supervisorStart, s.bootIdentity]) need(typeof v === "string" && v.length > 0 && v.length <= 512 && !v.includes("\0"), "supervisor-identity");
  need(s.childStart === null || (typeof s.childStart === "string" && s.childStart.length > 0 && s.childStart.length <= 512 && !s.childStart.includes("\0")), "supervisor-child-identity");
  need(s.state === "exited" && s.exitCode === exitCode && s.groupGone === true && s.configSha256 === configuration.sha256 && s.commandSha256 === sha256Hex(u.supervisorJson(argv)), "supervisor-terminal-failure");
  const began = u.supervisorTime(s.startedAt), ended = u.supervisorTime(s.finishedAt);
  need(began <= start && ended >= began && end < ended + 1000 && ended <= u.time(manifest.createdAt), "supervisor-time-window");
  return canonicalSha256({ parent, child, supervisorStart: s.supervisorStart, bootIdentity: s.bootIdentity, childStart: s.childStart });
}

async function load(input: Input, scope: Scope) {
  try {
    const manifestPin = u.pin(input.manifest), manifest = parseManifest(u.json(await u.pinned(manifestPin, 8 * M)), scope.importCount);
    need(manifest.freeze.sha256 === scope.freezeSha256 && manifest.truncatedJobKey === scope.truncatedJobKey, "fixed-freeze-or-truncated-key");
    need(manifest.freeze.path === join(manifest.studyDirectory, "freeze.json") && [manifestPin, manifest.inventory, manifest.supervisorClosure].every(p => p.path !== manifest.studyDirectory && !p.path.startsWith(manifest.studyDirectory + "/"))
      && manifest.sourceDirectory !== manifest.studyDirectory && !manifest.sourceDirectory.startsWith(manifest.studyDirectory + "/") && !manifest.studyDirectory.startsWith(manifest.sourceDirectory + "/"), "external-evidence-paths");
    const jobs = u.frozen(structuredClone(input.jobs)); need(jobs.length === scope.jobCount, "complete-plan-count");
    const original = u.checkedJobs(jobs.map(j => j.original)); u.same(jobs, makeGatewayExtractionJobs(original, new Map()), "native-complete-plan");
    u.same(manifest.jobs, jobs.slice(0, scope.importCount).map(binding), "original-prefix");
    need(jobs.find(j => j.key === scope.truncatedJobKey)?.ordinal === scope.truncatedOrdinal
      && jobs.slice(scope.importCount - 4, scope.importCount).some(j => j.key === scope.truncatedJobKey), "truncation-final-wave");
    const closure = u.record(u.json(await u.pinned(manifest.supervisorClosure, M)));
    u.keys(closure, ["schema", "freezeSha256", "inventorySha256", "verification", "allProducersClosed", "runs"]);
    need(closure.schema === "oh.gateway-import-supervisor-closure.v5" && closure.freezeSha256 === manifest.freeze.sha256 && closure.inventorySha256 === manifest.inventory.sha256
      && closure.verification === "owner-verified-complete-producer-inventory" && closure.allProducersClosed === true, "closed-owner-evidence");
    const runs = u.array(closure.runs, 2).map(u.record); need(runs.length === 2, "two-producer-batches");
    const runIds = runs.map((r, i) => { u.keys(r, ["runId", "admissionSha256", "closureSha256", "configuration", "supervisorStatus", "groupGone", "runnerExitCode", "newTransportInvocations"]);
      const id = u.string(r.runId); need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) && r.groupGone === true && r.runnerExitCode === i && r.newTransportInvocations === scope.batchCounts[i], "producer-evidence"); return id; });
    need(new Set(runIds).size === 2 && scope.batchCounts[0] + scope.batchCounts[1] === scope.importCount, "producer-counts");
    const files = inventory(u.json(await u.pinned(manifest.inventory, M)), manifest.freeze.sha256);
    const expectedFiles = ["freeze.json", "preparation.json", "store.json", "ledger.jsonl", ...runIds.flatMap(id => [`batch-${id}.json`, `batch-${id}-started.json`]),
      ...manifest.jobs.flatMap(j => ["pending.json", "reserved.json", "response.body", "response.json", ...(j.key === scope.truncatedJobKey ? [] : ["result.json", "settled.json"])].map(n => `jobs/${j.key}/${n}`))].sort();
    u.same(files.map(f => f.path), expectedFiles, "exact-closed-inventory"); u.same(await closedFiles(manifest.studyDirectory), expectedFiles, "closed-file-set");
    const read = u.inventoryReader(manifest.studyDirectory, files), rawFreeze = await read("freeze.json", 8 * M);
    need(sha256Hex(rawFreeze) === manifest.freeze.sha256, "freeze-pin"); const freeze = parseGatewayStudyV4Freeze(u.json(rawFreeze));
    need(freeze.sourceSha256 === scope.sourceSha256 && freeze.importedStudy.sha256 === u.hash(input.expectedClaudeImportSha256)
      && freeze.priorGatewayStudy.sha256 === u.hash(input.expectedPriorGatewayImportSha256) && freeze.priorGatewayStudy.sha256 === scope.priorGatewayImportSha256, "frozen-source-or-import");
    u.same(freeze.originalLedger, input.expectedOriginalLedger, "original-ledger-binding");
    const source = await u.sourceIdentity(manifest.sourceDirectory); need(source.sha256 === scope.sourceSha256, "source-before");
    need(freeze.study.remainingFirstExtractionCalls === jobs.length && freeze.study.newExtractionOrderSha256 === canonicalSha256(jobs.map(j => ({ key: j.key, ordinal: j.ordinal, originalJobKey: j.original.key, requestSha256: j.request.requestSha256 }))), "frozen-native-plan");
    const auth = await readGatewayStudyAuth(freeze.authority), profile = await loadJudgeProfile(); u.same(freeze.procedure, gatewayStudyV4Procedure(profile.sha256, auth), "frozen-procedure");
    const batches: Record<string, unknown>[] = [], evidencePins: Pin[] = [manifestPin, manifest.freeze, manifest.inventory, manifest.supervisorClosure, freeze.authority, freeze.importedStudy, freeze.priorGatewayStudy, freeze.originalLedger];
    const proofs = new Set<string>(), identities = new Set<string>(); let previousEnd = u.time(freeze.createdAt), frontier = 0;
    for (const [i, run] of runs.entries()) {
      const runId = u.at(runIds, i), name = `batch-${runId}.json`, raw = await read(name, M); need(sha256Hex(raw) === u.hash(run.closureSha256), "batch-pin"); const b = u.record(u.json(raw));
      u.keys(b, ["protocol", "runId", "freezeSha256", "sourceSha256", "importedStudySha256", "start", "end", "admission", "maximumNewCalls", "concurrency", "newTransportInvocations", "admittedKeys", "initialJobKeys", "finalJobKeys", "failed", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose", "priorGatewayVerifiedAtClose", "priorGatewayStudySha256", "interrupted", "stopReason", "qualified", "ledger", "comparisonArtifact", "result"]);
      const start = u.time(b.start), end = u.time(b.end), maximum = u.integer(b.maximumNewCalls, 256), calls = u.at(scope.batchCounts, i), before = frontier; frontier += calls;
      need(maximum === scope.maximumCalls[i] && start >= previousEnd && end >= start && end <= u.time(manifest.createdAt) && b.protocol === "oh.memory-gateway-batch.v4" && b.runId === runId
        && b.freezeSha256 === manifest.freeze.sha256 && b.sourceSha256 === freeze.sourceSha256 && b.importedStudySha256 === freeze.importedStudy.sha256
        && b.priorGatewayStudySha256 === freeze.priorGatewayStudy.sha256 && b.newTransportInvocations === calls && b.concurrency === 4
        && b.failed === (i === 1) && b.storeClosed === true && b.sourceVerifiedAtClose === true && b.importVerifiedAtClose === true && b.originalLedgerVerifiedAtClose === true && b.priorGatewayVerifiedAtClose === true
        && b.interrupted === false && b.stopReason === (i === 0 ? "call-limit" : null) && b.comparisonArtifact === null, "native-batch"); previousEnd = end;
      if (i === 0) u.same(b.result, { status: "paused", phase: "extract", resolved: frontier, required: jobs.length, importedClaude: u.integer(u.record(freeze.study.imported).importedTransportInvocations), importedGateway: 4 }, "paused-native-result");
      else u.same(b.result, { status: "blocked", phase: "extract", reason: "Preserved first-response evidence requires review; no retry." }, "failed-native-result");
      u.same(b.initialJobKeys, manifest.jobs.slice(0, before).map(j => j.key).sort(), "initial-job-inventory");
      u.same(b.admittedKeys, manifest.jobs.slice(before, frontier).map(j => j.key), "admitted-order"); u.same(b.finalJobKeys, manifest.jobs.slice(0, frontier).map(j => j.key).sort(), "final-job-inventory");
      const admission = u.pin(b.admission), admissionName = `batch-${runId}-started.json`;
      u.same(admission, { path: join(manifest.studyDirectory, admissionName), sha256: u.hash(run.admissionSha256) }, "admission-pin-binding");
      const admissionRaw = await read(admissionName, 32768); need(sha256Hex(admissionRaw) === admission.sha256, "admission-pin"); const q = qualified(b.qualified, start, auth), a = u.record(u.json(admissionRaw));
      u.same(a, { protocol: "oh.memory-gateway-batch-admission.v4", runId, freezeSha256: manifest.freeze.sha256, sourceSha256: freeze.sourceSha256,
        importedStudySha256: freeze.importedStudy.sha256, priorGatewayStudySha256: freeze.priorGatewayStudy.sha256, priorGatewayExposureMicros: CARRIED,
        start: b.start, maximumNewCalls: maximum, concurrency: 4, openingLedgerExposureMicros: u.integer(a.openingLedgerExposureMicros), initialJobKeysSha256: canonicalSha256(b.initialJobKeys), qualified: q }, "native-admission");
      const configuration = u.pin(run.configuration), statusPin = u.pin(run.supervisorStatus);
      for (const p of [configuration, statusPin]) for (const key of [p.path, p.sha256]) { need(!proofs.has(key), "reused-producer-proof"); proofs.add(key); }
      const identity = await supervisor(configuration, statusPin, manifest, maximum, start, end, auth, i); need(!identities.has(identity), "reused-producer-identity"); identities.add(identity);
      batches.push(b); evidencePins.push(configuration, statusPin, admission, { path: join(manifest.studyDirectory, name), sha256: u.hash(run.closureSha256) });
    }
    u.same(await scope.verifyAuthority(freeze.authority), input.expectedOriginalLedger, "authority-before-replay"); await scope.verifyAncestry(freeze, jobs);
    const preparation = u.record(u.json(await read("preparation.json", 8 * M))), preparedSource = u.record(preparation.source);
    u.keys(preparation, ["source", "noModelCalls", "imported", "priorGateway", "originalLedger", "maximumTotalAmendmentExposureMicros"]);
    need(preparation.noModelCalls === true && preparation.maximumTotalAmendmentExposureMicros === 40_000_000 && preparedSource.sourceSha256 === scope.sourceSha256 && preparedSource.bun === "1.3.14" && preparedSource.dirty === false, "preparation-source");
    u.same(preparedSource.files, source.entries, "preparation-files"); u.same(preparation.imported, freeze.study.imported, "preparation-imported");
    u.same(preparation.priorGateway, freeze.study.priorGateway, "preparation-prior-gateway"); u.same(preparation.originalLedger, input.expectedOriginalLedger, "preparation-original-ledger");
    u.same(u.json(await read("store.json", 2048)), { protocol: "oh.memory-gateway-store.v3", freezeSha256: manifest.freeze.sha256 }, "store-header");
    const ledgerRaw = await read("ledger.jsonl", M); need(ledgerRaw.length === scope.ledgerBytes && sha256Hex(ledgerRaw) === scope.ledgerSha256, "fixed-ledger-pin"); const events = ledger(ledgerRaw);
    u.same(events.filter(e => e.kind === "reserved").map(e => e.id), manifest.jobs.map(j => j.key), "reservation-native-order");
    need(events.length === scope.importCount * 2 - 1, "ledger-exact-count");
    const exposure = gatewayV4LedgerExposure(events, CARRIED); need(exposure === scope.externalExposureMicros, "conservative-exposure");
    const ledgerPin = u.frozen({ path: join(manifest.studyDirectory, "ledger.jsonl"), sha256: sha256Hex(ledgerRaw), bytes: ledgerRaw.length, exposureMicros: exposure }); evidencePins.push(ledgerPin);
    const rows: GatewayExtractionRowV5[] = [], origins = [], usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 };
    for (const [index, job] of jobs.slice(0, scope.importCount).entries()) {
      const prefix = `jobs/${job.key}`, isTruncated = job.key === scope.truncatedJobKey;
      u.same(u.json(await read(`${prefix}/pending.json`, M)), gatewayJobPending(job, manifest.freeze.sha256), "pending-request");
      const reservation = gatewayReservation(job), reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros };
      u.same(u.json(await read(`${prefix}/reserved.json`, 4096)), reserved, "reserved-file");
      const metadata = u.record(u.json(await read(`${prefix}/response.json`, 32768))); u.keys(metadata, ["requestSha256", "httpStatus", "bodyComplete", "receivedBytes", "transportError", "body"]);
      const body = await read(`${prefix}/response.body`, M); u.same(metadata.body, { bytes: body.length, sha256: sha256Hex(body) }, "captured-body-binding");
      need(metadata.httpStatus === 200 && metadata.bodyComplete === true && metadata.transportError === null, "completed-original-transport");
      const raw = { ...metadata, body } as GatewayStudyRaw, response = parseGatewayStudyV5(job.request, reservation, raw), row = completeGatewayV5Extraction(job, response);
      if (isTruncated) { need(response.kind === "truncated-extraction" && row.status === "invalid-truncation", "explicit-truncation-only"); u.same(events.filter(e => e.id === job.key), [reserved], "truncated-unsettled-once"); }
      else {
        need(response.kind !== "truncated-extraction", "unexpected-additional-truncation"); const native = parseGatewayStudyResponse(job.request, reservation, raw);
        u.same(response, native, "unchanged-native-response"); u.same(row, completeGatewayExtraction(job, native), "unchanged-native-row");
        const settled = { v: 1, id: job.key, kind: "settled", micros: native.usage.micros };
        u.same(u.json(await read(`${prefix}/settled.json`, 4096)), settled, "settled-file"); u.same(events.filter(e => e.id === job.key), [reserved, settled], "native-settlement-once");
        u.same(u.json(await read(`${prefix}/result.json`, 8 * M)), { protocol: "oh.memory-gateway-store.v3", freezeSha256: manifest.freeze.sha256, jobKey: job.key, result: native }, "native-saved-result");
      }
      rows.push(row); for (const key of Object.keys(usage) as Array<keyof typeof usage>) usage[key] = u.integer(usage[key] + response.usage[key]);
      origins.push({ origin: "imported-gateway-v4-first-response", replayProfile: "oh.gateway-study-import.v5", originalNativeStatus: isTruncated ? "blocked" : "completed", key: job.key, ordinal: job.ordinal,
        requestSha256: job.request.requestSha256, freezeSha256: manifest.freeze.sha256, sourceSha256: scope.sourceSha256, runId: u.at(runIds, index < scope.batchCounts[0] ? 0 : 1),
        rawSha256: response.rawSha256, rawBytes: response.rawBytes, conservativeReservedMicros: reservation.micros, originalSettledMicros: isTruncated ? null : response.usage.micros });
    }
    let previousBytes = 0, previousEvents = 0, previousExposure = 0, before = 0;
    for (const [i, b] of batches.entries()) {
      const l = u.record(b.ledger); u.keys(l, ["path", "bytes", "sha256", "exposureMicros", "priorGatewayExposureMicros", "totalAmendmentExposureMicros", "budget"]);
      const bytes = u.integer(l.bytes, ledgerRaw.length), prefix = ledgerRaw.subarray(0, bytes); need(bytes > previousBytes && sha256Hex(prefix) === u.hash(l.sha256), "ledger-prefix-pin");
      const prefixEvents = ledger(prefix), current = gatewayV4LedgerExposure(prefixEvents, CARRIED), calls = u.at(scope.batchCounts, i), end = before + calls;
      need(prefixEvents.length === end * 2 - (i === 1 ? 1 : 0), "ledger-prefix-count");
      u.same([...new Set(prefixEvents.map(e => e.id))].sort(), manifest.jobs.slice(0, end).map(j => j.key).sort(), "ledger-prefix-membership");
      const newEvents = prefixEvents.slice(previousEvents); waves(newEvents, i === 0 ? null : scope.truncatedJobKey);
      const settled = newEvents.filter(e => e.kind === "settled").reduce((n, e) => n + e.micros, 0), unresolved = i === 0 ? 0 : gatewayReservation(u.at(jobs, jobs.findIndex(j => j.key === scope.truncatedJobKey))).micros;
      u.same(l, { path: ledgerPin.path, bytes, sha256: sha256Hex(prefix), exposureMicros: current, priorGatewayExposureMicros: CARRIED, totalAmendmentExposureMicros: CARRIED + current,
        budget: { capUsd: 40, maxCalls: scope.maximumCalls[i], reservedCalls: calls, historicalExposureUsd: 21.655385, priorAmendmentExposureUsd: (CARRIED + previousExposure) / 1e6,
          accountedUsd: (CARRIED + current) / 1e6, confirmedThisRunUsd: settled / 1e6, unresolvedThisRunUsd: unresolved / 1e6, billedUsd: null } }, "native-ledger-budget");
      const admission = u.record(u.json(await u.pinned(u.pin(b.admission), 32768))); need(admission.openingLedgerExposureMicros === previousExposure, "opening-ledger-exposure");
      previousBytes = bytes; previousEvents = prefixEvents.length; previousExposure = current; before = end;
    }
    need(previousBytes === ledgerRaw.length, "unclosed-ledger-suffix");
    const summary = u.frozen({ schema: "oh.gateway-study-import-summary.v5", manifestSha256: manifestPin.sha256, freezeSha256: manifest.freeze.sha256, sourceSha256: scope.sourceSha256,
      importedClaudeManifestSha256: freeze.importedStudy.sha256, importedPriorGatewayManifestSha256: freeze.priorGatewayStudy.sha256, importedTransportInvocations: rows.length,
      importedRowsSha256: canonicalSha256(rows), originsSha256: canonicalSha256(origins), originalGatewayStatus: "blocked", externalExposureMicros: exposure, ledger: ledgerPin,
      reportedUsage: usage, validCount: rows.filter(r => r.status === "valid").length, invalidEnvelopeCount: rows.filter(r => r.status === "invalid-envelope").length,
      invalidRefusalCount: rows.filter(r => r.status === "invalid-refusal").length, invalidTruncationCount: rows.filter(r => r.status === "invalid-truncation").length,
      billedUsd: null, physicalModelAttempts: null, qualification: GATEWAY_STUDY_IMPORT_V5_QUALIFICATION });
    for (const f of files) await read(f.path, 8 * M); u.same(await closedFiles(manifest.studyDirectory), expectedFiles, "files-after");
    for (const p of evidencePins) await u.pinned(p, 128 * M);
    u.same(await scope.verifyAuthority(freeze.authority), input.expectedOriginalLedger, "authority-after"); await scope.verifyAncestry(freeze, jobs);
    need((await loadJudgeProfile()).sha256 === profile.sha256, "judge-profile-after"); u.same(await u.sourceIdentity(manifest.sourceDirectory), source, "source-after");
    return u.frozen({ manifest, freeze, rows, origins, summary, ledgerPin, evidencePins });
  } catch (error) { if (error instanceof GatewayStudyImportV5Error) throw error; throw new GatewayStudyImportV5Error("native-or-evidence-validation"); }
}
export async function loadGatewayStudyImportV5(input: Input) {
  return load(input, { sourceSha256: "adaa4eb6585465908fa61cf7fa3d5c0bb764fa240210f071ea0176e4f5985f6f", freezeSha256: "1a7d63c3a1be6a6607fb41ce20054c048ee71623271e0b49ad66f5898f3f0396",
    ledgerSha256: "426f0ab07b34613a7265f1ef600bdc477cd169f23b92e5941108cc0142e1415b", ledgerBytes: 41101,
    priorGatewayImportSha256: "e7657389e60a7136694a609cbe6db19cc1f5db84d2136ab84d0d41f78644a589", jobCount: 4916, importCount: 184, batchCounts: [32, 152], maximumCalls: [32, 256],
    truncatedJobKey: "8924f090189f0d6130833af9a6246bf7fa9d612884c802ba2f8379cb0620a05f", truncatedOrdinal: 3677, externalExposureMicros: 687407,
    verifyAuthority: verifyGatewayStudyAuthority, verifyAncestry: async (freeze, jobs) => {
      const context = await loadGatewayStudyV4Context(freeze.importedStudy, freeze.priorGatewayStudy, freeze.authority);
      u.same(context.extractionJobs, jobs, "complete-ancestral-plan"); u.same(gatewayStudyV4Identity(context), freeze.study, "complete-ancestral-study");
      u.same(context.imported.originalFreeze.inputs, freeze.inputs, "ancestral-inputs");
    } });
}
/** Only synthetic fixtures can relax fixed production identities; the public loader never accepts this scope. */
export const gatewayStudyImportV5Internals = Object.freeze({ loadSynthetic: load, closedFiles, ledger, waves });
