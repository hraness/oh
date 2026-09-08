/** Immutable complete import of closed v5 attempts; one reader failure is policy-classified without a retry or old-ledger settlement. */
import { basename, join, relative } from "node:path";
import { lstat, readdir, realpath } from "node:fs/promises";
import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { claudeStudyImportInternals as u, type ClaudeStudyImportPin as Pin } from "./claude-study-import";
import { readGatewayStudyAuth, verifyGatewayStudyAuthority, type GatewayStudyAuth } from "./gateway-study-v3";
import { parseGatewayStudyV5Freeze, gatewayStudyV5Procedure, gatewayStudyV5Identity, loadGatewayStudyV5Context, gatewayV5LedgerExposure, type GatewayStudyV5Freeze } from "./gateway-study-v5";
import { gatewayStudyStoreInternals, gatewayReservation } from "./gateway-study-store-v3";
import { gatewayStudyMemory, makeGatewayExtractionJobs, makeGatewayReaderJobs, type GatewayExtractionJob, type GatewayReaderJob } from "./gateway-study-plan-v3";
import { completeGatewayV5Extraction, type GatewayExtractionRowV5 } from "./gateway-study-plan-v5";
import { parseGatewayStudyV5 } from "./gateway-study-transport-v5";
import { parseGatewayStudyV6, GATEWAY_READER_FAILURE_V6_POLICY_SHA256, type GatewayStudyV6Result } from "./gateway-study-transport-v6";
import { type GatewayStudyRaw, type GatewayStudyLedgerEvent } from "./gateway-study-transport-v3";
import { loadJudgeProfile } from "./judge";

const M = 1024 * 1024, CARRIED = 809209;
export const GATEWAY_STUDY_IMPORT_V6_QUALIFICATION = "Every closed Gateway v5 first response is retained once; the exact reader output-limit failure becomes an explicit v6 terminal failure without accepted partial text, retry, or old-ledger settlement. The original v5 study remains incomplete and its full immutable exposure, including earlier ancestry and unresolved reservations, is carried once." as const;
type Job = GatewayExtractionJob | GatewayReaderJob;
type Binding = Readonly<{ key: string; phase: "extract" | "reader"; ordinal: number; requestSha256: string }>;
export type GatewayStudyImportV6Manifest = Readonly<{ schema: "oh.gateway-study-import.v6"; createdAt: string; studyDirectory: string; sourceDirectory: string;
  freeze: Pin; inventory: Pin; supervisorClosure: Pin; jobs: readonly Binding[]; terminalReaderJobKey: string; policySha256: string;
  qualification: typeof GATEWAY_STUDY_IMPORT_V6_QUALIFICATION }>;
type Ledger = Readonly<{ path: string; sha256: string; bytes: number; exposureMicros: number }>;
export type GatewayStudyImportV6Input = Readonly<{ manifest: Pin; expectedPriorGatewayImportSha256: string; expectedPriorContinuationImportSha256: string;
  expectedClaudeImportSha256: string; expectedOriginalLedger: Ledger }>;
type File = Readonly<{ path: string; bytes: number; sha256: string }>;
type Ancestry = Readonly<{ context?: Awaited<ReturnType<typeof loadGatewayStudyV5Context>>; extractionJobs: readonly GatewayExtractionJob[]; studyIdentity: unknown; inputs: unknown;
  readerJobs: (rows: readonly GatewayExtractionRowV5[]) => Promise<readonly GatewayReaderJob[]> }>;
type Scope = Readonly<{ sourceSha256: string; freezeSha256: string; ledgerSha256: string; ledgerBytes: number;
  priorGatewayImportSha256: string; priorContinuationImportSha256: string; claudeImportSha256: string;
  extractionCount: number; readerCount: number; importedReaderCount: number; batchCounts: readonly number[]; maximumCalls: readonly number[];
  terminalReaderJobKey: string; terminalReaderOrdinal: number; nativeLedgerExposureMicros: number;
  verifyAuthority: typeof verifyGatewayStudyAuthority; loadAncestry: (freeze: GatewayStudyV5Freeze) => Promise<Ancestry> }>;
export class GatewayStudyImportV6Error extends Error { constructor(readonly code: string) { super(`Gateway v6 import rejected: ${code}.`); this.name = "GatewayStudyImportV6Error"; } }
function need(v: unknown, code: string): asserts v { if (!v) throw new GatewayStudyImportV6Error(code); }
function binding(job: Job): Binding { return { key: job.key, phase: job.phase, ordinal: job.ordinal, requestSha256: job.request.requestSha256 }; }
function parseManifest(value: unknown, count: number): GatewayStudyImportV6Manifest {
  const v = u.record(value); u.keys(v, ["schema", "createdAt", "studyDirectory", "sourceDirectory", "freeze", "inventory", "supervisorClosure", "jobs", "terminalReaderJobKey", "policySha256", "qualification"]);
  need(v.schema === "oh.gateway-study-import.v6" && v.qualification === GATEWAY_STUDY_IMPORT_V6_QUALIFICATION && v.policySha256 === GATEWAY_READER_FAILURE_V6_POLICY_SHA256, "manifest-policy"); u.time(v.createdAt);
  const jobs = u.array(v.jobs, count).map((value): Binding => { const j = u.record(value); u.keys(j, ["key", "phase", "ordinal", "requestSha256"]);
    need(j.phase === "extract" || j.phase === "reader", "manifest-job-phase");
    return { key: u.hash(j.key), phase: j.phase, ordinal: u.integer(j.ordinal, 49999), requestSha256: u.hash(j.requestSha256) }; });
  const terminalReaderJobKey = u.hash(v.terminalReaderJobKey);
  need(jobs.length === count && new Set(jobs.map(j => j.key)).size === count && jobs.some(j => j.key === terminalReaderJobKey && j.phase === "reader"), "manifest-attempted-jobs");
  return u.frozen({ schema: "oh.gateway-study-import.v6", createdAt: u.string(v.createdAt), studyDirectory: u.absolute(v.studyDirectory), sourceDirectory: u.absolute(v.sourceDirectory),
    freeze: u.pin(v.freeze), inventory: u.pin(v.inventory), supervisorClosure: u.pin(v.supervisorClosure), jobs, terminalReaderJobKey,
    policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256, qualification: GATEWAY_STUDY_IMPORT_V6_QUALIFICATION });
}
export function parseGatewayStudyImportV6Manifest(value: unknown) { return parseManifest(value, 5064); }
function ownerTime(value: unknown) {
  const s = u.string(value); need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}\+00:00$/.test(s), "owner-timestamp");
  return u.time(s.slice(0, 23) + "Z");
}
function inventory(value: unknown, freezeSha256: string): File[] {
  const v = u.record(value); u.keys(v, ["schema", "freezeSha256", "files"]); need(v.schema === "oh.gateway-import-inventory.v6" && v.freezeSha256 === freezeSha256, "inventory-binding");
  const files = u.array(v.files, 65536).map(value => { const f = u.record(value); u.keys(f, ["path", "bytes", "sha256"]);
    return { path: u.rel(f.path), bytes: u.integer(f.bytes, 8 * M), sha256: u.hash(f.sha256) }; });
  need(files.every((f, i) => i === 0 || u.at(files, i - 1).path < f.path) && files.reduce((n, f) => n + f.bytes, 0) <= 1024 * M, "inventory-order-or-bound"); return files;
}
async function closedFiles(root: string): Promise<string[]> {
  need(await realpath(root) === root, "study-alias"); const files: string[] = [];
  async function visit(path: string, depth: number): Promise<void> {
    const s = await lstat(path); need(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o700 && s.uid === process.getuid?.() && depth <= 2, "directory-custody");
    const entries = await readdir(path, { withFileTypes: true });
    if (depth === 1) need(relative(root, path) === "jobs", "job-directories");
    if (depth === 2) need(/^jobs\/[a-f0-9]{64}$/.test(relative(root, path)), "job-directory");
    for (const entry of entries) { need(entry.name !== "active.lock", "active-lock"); const p = join(path, entry.name);
      if (entry.isDirectory()) await visit(p, depth + 1); else { need(entry.isFile(), "special-file"); files.push(u.rel(relative(root, p))); } need(files.length <= 65536, "file-count"); }
  }
  await visit(root, 0); return files.sort();
}
function ledger(raw: Uint8Array): GatewayStudyLedgerEvent[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw); need(text.endsWith("\n"), "partial-ledger-line");
  const events = text.slice(0, -1).split("\n").map(line => JSON.parse(line)); gatewayV5LedgerExposure(events, CARRIED); return events;
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
async function supervisor(configuration: Pin, statusPin: Pin, manifest: GatewayStudyImportV6Manifest, maximum: number, start: number, end: number, auth: GatewayStudyAuth, exitCode: number) {
  const c = u.record(u.json(await u.pinned(configuration, 128 * 1024))); u.keys(c, ["argv", "cwd", "jobDir", "requireAbsent"]);
  const argv = u.array(c.argv, 32).map(u.string), executable = u.absolute(u.at(argv, 0)), bun = u.absolute(u.at(argv, 10)), jobDir = u.absolute(c.jobDir);
  need(basename(executable) === "vercel" && basename(bun) === "bun" && c.cwd === manifest.sourceDirectory && jobDir !== manifest.studyDirectory && !jobDir.startsWith(manifest.studyDirectory + "/")
    && configuration.path === join(jobDir, "config.json") && statusPin.path === join(jobDir, "status.json"), "supervisor-path-binding");
  u.same(argv, [executable, "env", "run", "--project", auth.project, "--scope", auth.scope, "--environment", auth.environment, "--", bun,
    join(manifest.sourceDirectory, "scripts/benchmarks/gateway-study-v5.ts"), "run", "--directory", manifest.studyDirectory, "--freeze-sha256", manifest.freeze.sha256, "--max-new-calls", String(maximum)], "supervisor-command");
  const absent = u.array(c.requireAbsent, 64).map(u.absolute); need(new Set(absent).size === absent.length && absent.includes(join(manifest.studyDirectory, "active.lock")), "supervisor-lock-gate");
  need(sha256Hex(u.supervisorJson(c)) === configuration.sha256, "supervisor-canonical-config");
  const s = u.record(u.json(await u.pinned(statusPin, 128 * 1024))); u.keys(s, ["state", "supervisorPid", "supervisorStart", "bootIdentity", "commandSha256", "configSha256", "startedAt", "childPid", "childPgid", "childStart", "exitCode", "groupGone", "finishedAt"]);
  const parent = u.integer(s.supervisorPid), child = u.integer(s.childPid); need(parent > 0 && child > 0 && child === s.childPgid && child !== parent, "supervisor-process-binding");
  for (const v of [s.supervisorStart, s.bootIdentity]) need(typeof v === "string" && v.length > 0 && v.length <= 512 && !v.includes("\0"), "supervisor-identity");
  need(s.childStart === null || (typeof s.childStart === "string" && s.childStart.length > 0 && s.childStart.length <= 512 && !s.childStart.includes("\0")), "supervisor-child-identity");
  need(s.state === "exited" && s.exitCode === exitCode && s.groupGone === true && s.configSha256 === configuration.sha256 && s.commandSha256 === sha256Hex(u.supervisorJson(argv)), "supervisor-terminal-failure");
  const began = u.supervisorTime(s.startedAt), ended = u.supervisorTime(s.finishedAt);
  need(began <= start && ended >= began && end < ended + 1000 && ended <= u.time(manifest.createdAt), "supervisor-time-window");
  return { identity: canonicalSha256({ parent, child, supervisorStart: s.supervisorStart, bootIdentity: s.bootIdentity, childStart: s.childStart }), began, ended };
}


async function load(input: GatewayStudyImportV6Input, scope: Scope) {
  try {
    const count = scope.extractionCount + scope.importedReaderCount, last = scope.batchCounts.length - 1;
    need(last >= 1 && scope.maximumCalls.length === last + 1 && scope.batchCounts.reduce((n, c) => n + c, 0) === count, "scope-counts");
    const manifestPin = u.pin(input.manifest), manifest = parseManifest(u.json(await u.pinned(manifestPin, 8 * M)), count);
    need(manifest.freeze.sha256 === scope.freezeSha256 && manifest.terminalReaderJobKey === scope.terminalReaderJobKey, "fixed-freeze-or-failure-key");
    const outside = (p: Pin) => p.path !== manifest.studyDirectory && !p.path.startsWith(manifest.studyDirectory + "/");
    need(manifest.freeze.path === join(manifest.studyDirectory, "freeze.json") && [manifestPin, manifest.inventory, manifest.supervisorClosure].every(outside)
      && manifest.sourceDirectory !== manifest.studyDirectory && !manifest.sourceDirectory.startsWith(manifest.studyDirectory + "/") && !manifest.studyDirectory.startsWith(manifest.sourceDirectory + "/"), "external-evidence-paths");
    const owner = u.record(u.json(await u.pinned(manifest.supervisorClosure, M)));
    u.keys(owner, ["schema", "freezeSha256", "inventorySha256", "verification", "allProducersClosed", "runs", "acceptances"]);
    need(owner.schema === "oh.gateway-import-supervisor-closure.v6" && owner.freezeSha256 === manifest.freeze.sha256 && owner.inventorySha256 === manifest.inventory.sha256
      && owner.verification === "owner-verified-complete-producer-inventory" && owner.allProducersClosed === true, "closed-owner-evidence");
    const runs = u.array(owner.runs, 64).map(u.record), acceptances = u.array(owner.acceptances, 64).map(u.pin);
    need(runs.length === last + 1 && acceptances.length === last && acceptances.every(outside), "complete-producer-history");
    const runIds = runs.map((r, i) => {
      u.keys(r, ["runId", "admissionSha256", "closureSha256", "configuration", "supervisorStatus", "groupGone", "runnerExitCode", "newTransportInvocations"]);
      const id = u.string(r.runId); need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id) && r.groupGone === true
        && r.runnerExitCode === (i === last ? 1 : 0) && r.newTransportInvocations === scope.batchCounts[i], "producer-evidence"); return id;
    });
    need(new Set(runIds).size === runs.length, "unique-producers");
    const files = inventory(u.json(await u.pinned(manifest.inventory, 16 * M)), manifest.freeze.sha256);
    const expectedFiles = ["freeze.json", "preparation.json", "store.json", "ledger.jsonl", ...runIds.flatMap(id => [`batch-${id}.json`, `batch-${id}-started.json`]),
      ...manifest.jobs.flatMap(j => ["pending.json", "reserved.json", "response.body", "response.json", ...(j.key === scope.terminalReaderJobKey ? [] : ["result.json", "settled.json"])].map(n => `jobs/${j.key}/${n}`))].sort();
    u.same(files.map(f => f.path), expectedFiles, "exact-closed-inventory"); u.same(await closedFiles(manifest.studyDirectory), expectedFiles, "closed-file-set");
    const read = u.inventoryReader(manifest.studyDirectory, files), rawFreeze = await read("freeze.json", 8 * M);
    need(sha256Hex(rawFreeze) === manifest.freeze.sha256, "freeze-pin"); const freeze = parseGatewayStudyV5Freeze(u.json(rawFreeze));
    need(freeze.sourceSha256 === scope.sourceSha256 && freeze.importedStudy.sha256 === input.expectedClaudeImportSha256 && freeze.importedStudy.sha256 === scope.claudeImportSha256
      && freeze.priorGatewayStudy.sha256 === input.expectedPriorGatewayImportSha256 && freeze.priorGatewayStudy.sha256 === scope.priorGatewayImportSha256
      && freeze.priorContinuationStudy.sha256 === input.expectedPriorContinuationImportSha256 && freeze.priorContinuationStudy.sha256 === scope.priorContinuationImportSha256, "frozen-source-or-import");
    u.same(freeze.originalLedger, input.expectedOriginalLedger, "original-ledger-binding");
    const source = await u.sourceIdentity(manifest.sourceDirectory); need(source.sha256 === scope.sourceSha256, "source-before");
    const auth = await readGatewayStudyAuth(freeze.authority), profile = await loadJudgeProfile(); u.same(freeze.procedure, gatewayStudyV5Procedure(profile.sha256, auth), "frozen-procedure");
    const batches: Record<string, unknown>[] = [], evidencePins: Pin[] = [manifestPin, manifest.freeze, manifest.inventory, manifest.supervisorClosure,
      freeze.authority, freeze.importedStudy, freeze.priorGatewayStudy, freeze.priorContinuationStudy, freeze.originalLedger, ...acceptances];
    const proofs = new Set<string>(), identities = new Set<string>(); let previousEnd = u.time(freeze.createdAt), previousSupervisorEnd = u.time(freeze.createdAt), frontier = 0;
    const producerTimes: Array<{ began: number; ended: number }> = [];
    for (const [i, run] of runs.entries()) {
      const runId = u.at(runIds, i), name = `batch-${runId}.json`, raw = await read(name, M); need(sha256Hex(raw) === u.hash(run.closureSha256), "batch-pin"); const b = u.record(u.json(raw));
      u.keys(b, ["protocol", "runId", "freezeSha256", "sourceSha256", "importedStudySha256", "start", "end", "admission", "maximumNewCalls", "concurrency", "newTransportInvocations", "admittedKeys", "initialJobKeys", "finalJobKeys", "failed", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose", "priorGatewayVerifiedAtClose", "priorGatewayStudySha256", "priorContinuationVerifiedAtClose", "priorContinuationStudySha256", "interrupted", "stopReason", "qualified", "ledger", "comparisonArtifact", "result"]);
      const start = u.time(b.start), end = u.time(b.end), maximum = u.integer(b.maximumNewCalls, 256), calls = u.at(scope.batchCounts, i), before = frontier; frontier += calls;
      need(maximum === scope.maximumCalls[i] && start >= previousEnd && end >= start && end <= u.time(manifest.createdAt) && b.protocol === "oh.memory-gateway-batch.v5" && b.runId === runId
        && b.freezeSha256 === manifest.freeze.sha256 && b.sourceSha256 === freeze.sourceSha256 && b.importedStudySha256 === freeze.importedStudy.sha256
        && b.priorGatewayStudySha256 === freeze.priorGatewayStudy.sha256 && b.priorContinuationStudySha256 === freeze.priorContinuationStudy.sha256
        && b.newTransportInvocations === calls && b.concurrency === 4 && b.failed === (i === last) && b.storeClosed === true && b.sourceVerifiedAtClose === true && b.importVerifiedAtClose === true
        && b.originalLedgerVerifiedAtClose === true && b.priorGatewayVerifiedAtClose === true && b.priorContinuationVerifiedAtClose === true && b.interrupted === false
        && b.stopReason === (i === last ? null : "call-limit") && b.comparisonArtifact === null, "native-batch"); previousEnd = end;
      if (i === last) u.same(b.result, { status: "blocked", phase: "reader", reason: "Preserved first-response evidence requires review; no retry." }, "failed-native-result");
      else if (frontier < scope.extractionCount) u.same(b.result, { status: "paused", phase: "extract", resolved: frontier, required: scope.extractionCount,
        importedClaude: u.integer(u.record(freeze.study.imported).importedTransportInvocations), importedGateway: 188 }, "paused-extraction-result");
      else u.same(b.result, { status: "paused", phase: "reader", resolved: frontier - scope.extractionCount, required: scope.readerCount }, "paused-reader-result");
      u.same(b.initialJobKeys, manifest.jobs.slice(0, before).map(j => j.key).sort(), "initial-job-inventory");
      u.same(b.admittedKeys, manifest.jobs.slice(before, frontier).map(j => j.key), "admitted-order"); u.same(b.finalJobKeys, manifest.jobs.slice(0, frontier).map(j => j.key).sort(), "final-job-inventory");
      const admission = u.pin(b.admission), admissionName = `batch-${runId}-started.json`;
      u.same(admission, { path: join(manifest.studyDirectory, admissionName), sha256: u.hash(run.admissionSha256) }, "admission-pin-binding");
      const admissionRaw = await read(admissionName, 32768); need(sha256Hex(admissionRaw) === admission.sha256, "admission-pin"); const q = qualified(b.qualified, start, auth), a = u.record(u.json(admissionRaw));
      u.same(a, { protocol: "oh.memory-gateway-batch-admission.v5", runId, freezeSha256: manifest.freeze.sha256, sourceSha256: freeze.sourceSha256,
        importedStudySha256: freeze.importedStudy.sha256, priorGatewayStudySha256: freeze.priorGatewayStudy.sha256, priorContinuationStudySha256: freeze.priorContinuationStudy.sha256,
        priorGatewayExposureMicros: CARRIED, start: b.start, maximumNewCalls: maximum, concurrency: 4, openingLedgerExposureMicros: u.integer(a.openingLedgerExposureMicros), initialJobKeysSha256: canonicalSha256(b.initialJobKeys), qualified: q }, "native-admission");
      const configuration = u.pin(run.configuration), statusPin = u.pin(run.supervisorStatus);
      need([configuration, statusPin].every(outside), "external-producer-evidence");
      for (const p of [configuration, statusPin]) for (const key of [p.path, p.sha256]) { need(!proofs.has(key), "reused-producer-proof"); proofs.add(key); }
      const producer = await supervisor(configuration, statusPin, manifest, maximum, start, end, auth, i === last ? 1 : 0);
      need(producer.began >= previousSupervisorEnd, "overlapping-producer-lifetimes"); previousSupervisorEnd = producer.ended; producerTimes.push(producer);
      need(!identities.has(producer.identity), "reused-producer-identity"); identities.add(producer.identity);
      batches.push(b); evidencePins.push(configuration, statusPin, admission, { path: join(manifest.studyDirectory, name), sha256: u.hash(run.closureSha256) });
    }
    const preparation = u.record(u.json(await read("preparation.json", 8 * M))), preparedSource = u.record(preparation.source);
    u.keys(preparation, ["source", "noModelCalls", "imported", "priorGateway", "priorContinuation", "originalLedger", "maximumTotalAmendmentExposureMicros"]);
    need(preparation.noModelCalls === true && preparation.maximumTotalAmendmentExposureMicros === 40_000_000 && preparedSource.sourceSha256 === scope.sourceSha256 && preparedSource.bun === "1.3.14" && preparedSource.dirty === false, "preparation-source");
    u.same(preparedSource.files, source.entries, "preparation-files"); u.same(preparation.imported, freeze.study.imported, "preparation-imported");
    u.same(preparation.priorGateway, freeze.study.priorGateway, "preparation-prior-gateway"); u.same(preparation.priorContinuation, freeze.study.priorContinuation, "preparation-prior-continuation");
    u.same(preparation.originalLedger, input.expectedOriginalLedger, "preparation-original-ledger");
    u.same(u.json(await read("store.json", 2048)), { protocol: "oh.memory-gateway-store.v5", freezeSha256: manifest.freeze.sha256 }, "store-header");
    const ledgerRaw = await read("ledger.jsonl", 8 * M); need(ledgerRaw.length === scope.ledgerBytes && sha256Hex(ledgerRaw) === scope.ledgerSha256, "fixed-ledger-pin"); const events = ledger(ledgerRaw);
    u.same(events.filter(e => e.kind === "reserved").map(e => e.id), manifest.jobs.map(j => j.key), "reservation-native-order");
    need(events.length === count * 2 - 1, "ledger-exact-count");
    const exposure = gatewayV5LedgerExposure(events, CARRIED); need(exposure === scope.nativeLedgerExposureMicros, "conservative-exposure");
    const ledgerPin = u.frozen({ path: join(manifest.studyDirectory, "ledger.jsonl"), sha256: sha256Hex(ledgerRaw), bytes: ledgerRaw.length, exposureMicros: exposure }); evidencePins.push(ledgerPin);
    let previousBytes = 0, previousEvents = 0, previousExposure = 0, before = 0;
    for (const [i, b] of batches.entries()) {
      const l = u.record(b.ledger); u.keys(l, ["path", "bytes", "sha256", "exposureMicros", "priorGatewayExposureMicros", "totalAmendmentExposureMicros", "budget"]);
      const bytes = u.integer(l.bytes, ledgerRaw.length), prefix = ledgerRaw.subarray(0, bytes); need(bytes > previousBytes && sha256Hex(prefix) === u.hash(l.sha256), "ledger-prefix-pin");
      const prefixEvents = ledger(prefix), current = gatewayV5LedgerExposure(prefixEvents, CARRIED), calls = u.at(scope.batchCounts, i), end = before + calls;
      need(prefixEvents.length === end * 2 - (i === last ? 1 : 0), "ledger-prefix-count");
      u.same([...new Set(prefixEvents.map(e => e.id))].sort(), manifest.jobs.slice(0, end).map(j => j.key).sort(), "ledger-prefix-membership");
      const newEvents = prefixEvents.slice(previousEvents); waves(newEvents, i === last ? scope.terminalReaderJobKey : null);
      const settled = newEvents.filter(e => e.kind === "settled").reduce((n, e) => n + e.micros, 0), unresolved = i === last ? u.at(newEvents.filter(e => e.kind === "reserved" && e.id === scope.terminalReaderJobKey), 0).micros : 0;
      u.same(l, { path: ledgerPin.path, bytes, sha256: sha256Hex(prefix), exposureMicros: current, priorGatewayExposureMicros: CARRIED, totalAmendmentExposureMicros: CARRIED + current,
        budget: { capUsd: 40, maxCalls: scope.maximumCalls[i], reservedCalls: calls, historicalExposureUsd: 21.655385, priorAmendmentExposureUsd: (CARRIED + previousExposure) / 1e6,
          accountedUsd: (CARRIED + current) / 1e6, confirmedThisRunUsd: settled / 1e6, unresolvedThisRunUsd: unresolved / 1e6, billedUsd: null } }, "native-ledger-budget");
      const admission = u.record(u.json(await u.pinned(u.pin(b.admission), 32768))); need(admission.openingLedgerExposureMicros === previousExposure, "opening-ledger-exposure");
      if (i < last) {
        const acceptancePin = u.at(acceptances, i), accepted = u.record(u.json(await u.pinned(acceptancePin, M))), inventoryPin = u.pin(accepted.inventory);
        need(basename(acceptancePin.path) === `gateway-v5-batch-${String(i + 1).padStart(3, "0")}-acceptance.json`
          && inventoryPin.path === join(acceptancePin.path.slice(0, acceptancePin.path.lastIndexOf("/")), `gateway-v5-batch-${String(i + 1).padStart(3, "0")}-closed-inventory.json`), "numbered-owner-acceptance");
        const recordedAt = u.string(accepted.recordedAt), recorded = ownerTime(recordedAt);
        need(recorded >= Math.max(u.time(b.end), u.at(producerTimes, i).ended) && recorded <= (i + 1 < producerTimes.length ? u.at(producerTimes, i + 1).began : u.time(manifest.createdAt)), "acceptance-time");
        u.same(accepted, { schema: "oh.gateway-v5-batch-acceptance.v1", recordedAt, number: i + 1, runId: runIds[i], admission: b.admission,
          closure: { path: join(manifest.studyDirectory, `batch-${runIds[i]}.json`), sha256: runs[i]!.closureSha256 }, configuration: runs[i]!.configuration, supervisorStatus: runs[i]!.supervisorStatus,
          groupGone: true, freshOsProcessMatches: 0, newTransportInvocations: calls, totalNewJobCount: end, result: b.result, ledgerExposureMicros: current,
          priorGatewayExposureMicros: CARRIED, totalAmendmentExposureMicros: CARRIED + current, inventory: inventoryPin, allOriginalLedgersUnchanged: true,
          priorInventoryUnchanged: true, correctnessInspected: false, modelCallsByVerifier: 0 }, "ordinary-owner-acceptance");
        const priorValue = u.record(u.json(await u.pinned(inventoryPin, 16 * M))); need(priorValue.schema === "oh.gateway-final-inventory.v5", "owner-inventory-schema");
        const priorFiles = inventory({ ...priorValue, schema: "oh.gateway-import-inventory.v6" }, manifest.freeze.sha256);
        const oldKeys = new Set(manifest.jobs.slice(0, end).map(j => j.key)), oldRuns = new Set(runIds.slice(0, i + 1).flatMap(id => [`batch-${id}.json`, `batch-${id}-started.json`]));
        u.same(priorFiles, files.filter(f => f.path.startsWith("jobs/") ? oldKeys.has(f.path.split("/")[1]!) : f.path.startsWith("batch-") ? oldRuns.has(f.path) : true)
          .map(f => f.path === "ledger.jsonl" ? { path: f.path, bytes, sha256: sha256Hex(prefix) } : f), "unchanged-owner-inventory-prefix"); evidencePins.push(inventoryPin);
      }
      previousBytes = bytes; previousEvents = prefixEvents.length; previousExposure = current; before = end;
    }
    need(previousBytes === ledgerRaw.length, "unclosed-ledger-suffix");
    // Complete custody and all ledger histories are authenticated before any captured response is decoded.
    u.same(await scope.verifyAuthority(freeze.authority), input.expectedOriginalLedger, "authority-before-replay");
    const ancestry = await scope.loadAncestry(freeze); u.same(ancestry.studyIdentity, freeze.study, "complete-ancestral-study"); u.same(ancestry.inputs, freeze.inputs, "ancestral-inputs");
    const extractionJobs = ancestry.extractionJobs;
    need(extractionJobs.length === scope.extractionCount, "complete-extraction-count");
    u.same(extractionJobs, makeGatewayExtractionJobs(u.checkedJobs(extractionJobs.map(j => j.original)), new Map()), "native-extraction-plan");
    u.same(manifest.jobs.slice(0, scope.extractionCount), extractionJobs.map(binding), "extraction-prefix");
    need(freeze.study.remainingFirstExtractionCalls === extractionJobs.length && freeze.study.newExtractionOrderSha256 === canonicalSha256(extractionJobs.map(j => ({ key: j.key, ordinal: j.ordinal, originalJobKey: j.original.key, requestSha256: j.request.requestSha256 }))), "frozen-native-plan");
    const eventsByJob = new Map<string, GatewayStudyLedgerEvent[]>();
    for (const event of events) { const list = eventsByJob.get(event.id) ?? []; list.push(event); eventsByJob.set(event.id, list); }
    const origins: Array<Binding & { origin: "imported-gateway-v5-first-response"; replayProfile: "oh.gateway-study-import.v6"; originalNativeStatus: "blocked" | "completed"; freezeSha256: string; sourceSha256: string; runId: string; rawSha256: string; rawBytes: number; conservativeReservedMicros: number; originalSettledMicros: number | null }> = [], usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 };
    async function replay(job: Job, index: number): Promise<GatewayStudyV6Result> {
      const path = `jobs/${job.key}`, terminal = job.key === scope.terminalReaderJobKey;
      u.same(u.json(await read(`${path}/pending.json`, M)), gatewayStudyStoreInternals.jobPending(job, manifest.freeze.sha256, "oh.memory-gateway-store.v5"), "pending-request");
      const reservation = gatewayReservation(job), reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros };
      u.same(u.json(await read(`${path}/reserved.json`, 4096)), reserved, "reserved-file");
      const metadata = u.record(u.json(await read(`${path}/response.json`, 32768))); u.keys(metadata, ["requestSha256", "httpStatus", "bodyComplete", "receivedBytes", "transportError", "body"]);
      const body = await read(`${path}/response.body`, M); u.same(metadata.body, { bytes: body.length, sha256: sha256Hex(body) }, "captured-body-binding");
      need(metadata.httpStatus === 200 && metadata.bodyComplete === true && metadata.transportError === null, "completed-original-transport");
      const raw = { ...metadata, body } as GatewayStudyRaw;
      const response = terminal ? parseGatewayStudyV6(job.request, reservation, raw) : parseGatewayStudyV5(job.request, reservation, raw);
      if (terminal) {
        need(job.phase === "reader" && response.kind === "terminal-reader-failure" && response.policySha256 === manifest.policySha256, "explicit-reader-failure-only");
        u.same(eventsByJob.get(job.key), [reserved], "failure-unsettled-once");
      } else {
        need(response.kind !== "terminal-reader-failure", "unexpected-additional-terminal-failure");
        u.same(parseGatewayStudyV6(job.request, reservation, raw), response, "unchanged-v5-response");
        const settled = { v: 1, id: job.key, kind: "settled", micros: response.usage.micros };
        u.same(u.json(await read(`${path}/settled.json`, 4096)), settled, "settled-file"); u.same(eventsByJob.get(job.key), [reserved, settled], "native-settlement-once");
        u.same(u.json(await read(`${path}/result.json`, 8 * M)), { protocol: "oh.memory-gateway-store.v5", freezeSha256: manifest.freeze.sha256, jobKey: job.key, result: response }, "native-saved-result");
      }
      for (const key of Object.keys(usage) as Array<keyof typeof usage>) usage[key] = u.integer(usage[key] + response.usage[key]);
      let runIndex = 0, runEnd = scope.batchCounts[0]!; while (index >= runEnd) runEnd += scope.batchCounts[++runIndex]!;
      origins.push({ origin: "imported-gateway-v5-first-response", replayProfile: "oh.gateway-study-import.v6", originalNativeStatus: terminal ? "blocked" : "completed", ...binding(job),
        freezeSha256: manifest.freeze.sha256, sourceSha256: scope.sourceSha256, runId: u.at(runIds, runIndex), rawSha256: response.rawSha256, rawBytes: response.rawBytes,
        conservativeReservedMicros: reservation.micros, originalSettledMicros: terminal ? null : response.usage.micros });
      return response;
    }
    const extractionRows: GatewayExtractionRowV5[] = [];
    for (const [i, job] of extractionJobs.entries()) {
      const response = await replay(job, i); need(response.kind !== "terminal-reader-failure", "reader-failure-outside-reader"); extractionRows.push(completeGatewayV5Extraction(job, response));
    }
    const readerJobs = await ancestry.readerJobs(extractionRows);
    need(readerJobs.length === scope.readerCount && new Set(readerJobs.map(j => j.key)).size === readerJobs.length && readerJobs.every((j, i) => j.phase === "reader" && j.ordinal === i), "complete-reader-plan");
    u.same(manifest.jobs.slice(scope.extractionCount), readerJobs.slice(0, scope.importedReaderCount).map(binding), "exact-attempted-reader-prefix");
    need(readerJobs.find(j => j.key === scope.terminalReaderJobKey)?.ordinal === scope.terminalReaderOrdinal
      && manifest.jobs.slice(-4).some(j => j.key === scope.terminalReaderJobKey), "failure-final-wave");
    const readerResults: Array<Readonly<{ job: GatewayReaderJob; response: GatewayStudyV6Result }>> = [];
    for (const [i, job] of readerJobs.slice(0, scope.importedReaderCount).entries()) readerResults.push({ job, response: await replay(job, scope.extractionCount + i) });
    need(readerResults.filter(r => r.response.kind === "terminal-reader-failure").length === 1, "single-terminal-reader");
    const summary = u.frozen({ schema: "oh.gateway-study-import-summary.v6", manifestSha256: manifestPin.sha256, freezeSha256: manifest.freeze.sha256, sourceSha256: scope.sourceSha256,
      importedClaudeManifestSha256: freeze.importedStudy.sha256, importedPriorGatewayManifestSha256: freeze.priorGatewayStudy.sha256, importedPriorContinuationManifestSha256: freeze.priorContinuationStudy.sha256,
      importedTransportInvocations: count, importedExtractionCount: extractionRows.length, importedReaderCount: readerResults.length, terminalReaderFailureCount: 1,
      extractionRowsSha256: canonicalSha256(extractionRows), readerJobsSha256: canonicalSha256(readerJobs), readerResultsSha256: canonicalSha256(readerResults), originsSha256: canonicalSha256(origins),
      originalGatewayStatus: "blocked-incomplete", externalExposureMicros: CARRIED + exposure, nativeLedgerExposureMicros: exposure, ancestryExposureMicros: CARRIED,
      ledger: ledgerPin, reportedUsage: usage, policySha256: manifest.policySha256, billedUsd: null, physicalModelAttempts: null, qualification: GATEWAY_STUDY_IMPORT_V6_QUALIFICATION });
    for (const f of files) await read(f.path, 8 * M); u.same(await closedFiles(manifest.studyDirectory), expectedFiles, "files-after");
    for (const p of evidencePins) await u.pinned(p, 128 * M);
    u.same(await scope.verifyAuthority(freeze.authority), input.expectedOriginalLedger, "authority-after");
    const after = await scope.loadAncestry(freeze); u.same(after.studyIdentity, ancestry.studyIdentity, "ancestry-after"); u.same(after.inputs, ancestry.inputs, "inputs-after");
    u.same(after.extractionJobs, extractionJobs, "extraction-plan-after"); u.same(await after.readerJobs(extractionRows), readerJobs, "reader-plan-after");
    need((await loadJudgeProfile()).sha256 === profile.sha256, "judge-profile-after"); u.same(await u.sourceIdentity(manifest.sourceDirectory), source, "source-after");
    return u.frozen({ manifest, freeze, context: ancestry.context, extractionRows, readerJobs, readerResults, origins, summary, ledgerPin, evidencePins });
  } catch (error) { if (error instanceof GatewayStudyImportV6Error) throw error; throw new GatewayStudyImportV6Error("native-or-evidence-validation"); }
}
export async function loadGatewayStudyImportV6(input: GatewayStudyImportV6Input) {
  const result = await load(input, {
    sourceSha256: "896d7a9cc58a907d45c2db5276455eae57ab66f4e74cb1d91b14914ed2aed433", freezeSha256: "92fed47664b2907d4f47c3a7a247aa439222d70c850fc6a1f21e2c2afa87d97a",
    ledgerSha256: "37f8a79e8dc7bd64ebccfadf9ecd5e232462c3cd6182c678b02344c017e16a80", ledgerBytes: 1133712,
    claudeImportSha256: "737cc332334d684c81bba60f7c47fc38caefd8739817983a4655e84d1cfa65c4", priorGatewayImportSha256: "e7657389e60a7136694a609cbe6db19cc1f5db84d2136ab84d0d41f78644a589",
    priorContinuationImportSha256: "a34af0222ca0857956b7cc42efeb5261a68b1b0a57826c0cfbfe3fdfad630939", extractionCount: 4732, readerCount: 360, importedReaderCount: 332,
    batchCounts: [32, ...Array<number>(19).fill(256), 168], maximumCalls: [32, ...Array<number>(20).fill(256)],
    terminalReaderJobKey: "80927985272587b8f59baa170613cb429887a0e41d8d2360cbbd3da3ec68a259", terminalReaderOrdinal: 331, nativeLedgerExposureMicros: 17459430,
    verifyAuthority: verifyGatewayStudyAuthority, loadAncestry: async freeze => {
      const context = await loadGatewayStudyV5Context(freeze.importedStudy, freeze.priorGatewayStudy, freeze.priorContinuationStudy, freeze.authority);
      return { context, extractionJobs: context.extractionJobs, studyIdentity: gatewayStudyV5Identity(context), inputs: context.imported.originalFreeze.inputs,
        readerJobs: rows => makeGatewayReaderJobs({ ...context.loaded.selection.dataset,
          memory: gatewayStudyMemory(context.loaded.legacy, context.imported.outcomes, [...context.priorGateway.rows, ...context.priorContinuation.rows, ...rows]) }) };
    },
  });
  need(result.context !== undefined, "production-context"); return Object.freeze({ ...result, context: result.context });
}
/** Synthetic fixtures alone can supply alternate pins/counts/ancestry; production has no such override. */
export const gatewayStudyImportV6Internals = Object.freeze({ loadSynthetic: load, closedFiles, ledger, waves });
