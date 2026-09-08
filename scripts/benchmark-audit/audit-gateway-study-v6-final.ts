/** V6 final semantic audit. External custody is authenticated before response replay; this module never opens a writable store. */
import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { gatewayAuditorSourceIdentity, gatewayClosedFileSet } from "./audit-gateway-study-v5-final";
import { verifyGatewayV6Supervisor, type GatewayAuditPin as Pin } from "./gateway-v6-audit-supervisor";
import type { GatewayJob, GatewayReaderJob } from "../benchmarks/gateway-study-plan-v3";
import type { GatewayStudyLedgerEvent, GatewayStudyRaw } from "../benchmarks/gateway-study-transport-v3";
import type { GatewayStudyV6Result } from "../benchmarks/gateway-study-transport-v6";
import type { GatewayStudyV6Freeze } from "../benchmarks/gateway-study-v6";
import type { GatewayStudyAuth } from "../benchmarks/gateway-study-v3";
import type { Corpus, Question } from "../benchmarks/datasets";
import type { FamilyCase } from "../benchmarks/superiority";
import type { loadJudgeProfile } from "../benchmarks/judge";

const M = 1024 * 1024, CARRY = 18_268_639, POLICY = "22d10f39368869e0e9b877658d57192c7b00e5abee77494854978851c6ec91f1";
const FILES = ["pending.json", "reserved.json", "response.body", "response.json", "result.json", "settled.json"];
export type GatewayFinalAuditV6Input = Readonly<{ runtimeRoot: string; expectedSourceSha256: string; studyDirectory: string;
  freeze: Pin; finalBatch: Pin; comparison: Pin; inventory: Pin; supervisorClosure: Pin }>;
export type GatewayV6ArtifactRead = (path: string, maximum: number) => Promise<Uint8Array>;
type File = Readonly<{ path: string; bytes: number; sha256: string }>;
type ReplayInput = Readonly<{ readerJobs: readonly GatewayReaderJob[];
  importedReaderResults: readonly Readonly<{ job: GatewayReaderJob; response: GatewayStudyV6Result }>[];
  importedJobKeys: readonly string[]; questions: readonly Question[]; selected: readonly FamilyCase[]; poolSize: number;
  profile: Awaited<ReturnType<typeof loadJudgeProfile>>; freezeSha256: string; jobKeys: readonly string[];
  ledgerRaw: Uint8Array; read: GatewayV6ArtifactRead }>;
export class GatewayFinalAuditV6Failure extends Error { constructor(readonly category: string) { super("Gateway v6 audit: " + category + "."); } }
function need(value: unknown, category: string): asserts value { if (!value) throw new GatewayFinalAuditV6Failure(category); }
function record(value: unknown): Record<string, unknown> { need(isPlainRecord(value), "record"); return value; }
function exact(value: Record<string, unknown>, keys: readonly string[]) { need(hasExactKeys(value, keys), "exact-keys"); }
function string(value: unknown): string { need(typeof value === "string", "string"); return value; }
function hash(value: unknown): string { const s = string(value); need(/^[a-f0-9]{64}$/.test(s), "hash"); return s; }
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  need(typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max && !Object.is(value, -0), "integer"); return value;
}
function absolute(value: unknown): string { const p = string(value); need(p.length <= 4096 && !p.includes("\0") && isAbsolute(p) && resolve(p) === p, "absolute-path"); return p; }
function rel(value: unknown): string { const p = string(value);
  need(p.length > 0 && p.length <= 1024 && !p.includes("\\") && !p.includes("\0") && !isAbsolute(p)
    && p.split("/").every(s => s !== "" && s !== "." && s !== ".."), "relative-path"); return p;
}
function pin(value: unknown): Pin { const p = record(value); exact(p, ["path", "sha256"]); return { path: absolute(p.path), sha256: hash(p.sha256) }; }
function array(value: unknown, max = 65536): unknown[] { need(Array.isArray(value) && value.length <= max, "array-bound"); return value; }
function same(a: unknown, b: unknown, why: string) { need(canonicalSha256(a) === canonicalSha256(b), why); }
function json(raw: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
function at<T>(rows: readonly T[], index: number): T { const value = rows[index]; need(value !== undefined, "position"); return value; }
function time(value: unknown): number { const s = string(value), n = Date.parse(s); need(Number.isFinite(n) && new Date(n).toISOString() === s, "timestamp"); return n; }
async function readFile(path: string, max: number, privateFile = false): Promise<Uint8Array> {
  absolute(path); need(await realpath(dirname(path)) === dirname(path), "file-parent-alias");
  const h = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const a = await h.stat(); need(a.isFile() && a.nlink === 1 && a.uid === process.getuid?.() && a.size <= max, "file-custody");
    if (privateFile) need((a.mode & 0o777) === 0o600, "private-file-mode");
    const raw = new Uint8Array(a.size);
    for (let offset = 0; offset < raw.length;) { const got = await h.read(raw, offset, raw.length - offset, offset); need(got.bytesRead > 0, "short-read"); offset += got.bytesRead; }
    for (const b of [await h.stat(), await lstat(path)]) need(!b.isSymbolicLink() && a.dev === b.dev && a.ino === b.ino && a.size === b.size
      && a.mode === b.mode && a.uid === b.uid && a.nlink === b.nlink && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs, "file-changed");
    return raw;
  } finally { await h.close(); }
}
async function pinned(p: Pin, max: number) { const raw = await readFile(p.path, max, true); need(sha256Hex(raw) === p.sha256, "pin-changed"); return raw; }
function inventory(value: unknown, freezeSha256: string): File[] {
  const v = record(value); exact(v, ["schema", "freezeSha256", "files"]);
  need(v.schema === "oh.gateway-final-inventory.v6" && v.freezeSha256 === freezeSha256, "inventory-binding");
  const files = array(v.files).map(value => { const f = record(value); exact(f, ["path", "bytes", "sha256"]);
    return { path: rel(f.path), bytes: integer(f.bytes, 128 * M), sha256: hash(f.sha256) }; });
  need(files.length > 0 && files.every((f, i) => i === 0 || at(files, i - 1).path < f.path)
    && files.reduce((n, f) => n + f.bytes, 0) <= 1024 * M, "inventory-order-or-bound"); return files;
}
function reader(root: string, files: readonly File[]): GatewayV6ArtifactRead {
  const byPath = new Map(files.map(f => [f.path, f]));
  return async (path, max) => { const f = byPath.get(rel(path)); need(f && f.bytes <= max, "missing-or-oversized-file");
    const raw = await readFile(join(root, path), max, true); need(raw.length === f.bytes && sha256Hex(raw) === f.sha256, "inventory-file-changed"); return raw; };
}
async function sourceHead(root: string): Promise<string> {
  const git = join(root, ".git"); need(await realpath(git) === git && (await lstat(git)).isDirectory(), "standalone-runtime-git");
  let head = new TextDecoder().decode(await readFile(join(git, "HEAD"), 4096)).trim();
  if (head.startsWith("ref: ")) {
    const ref = head.slice(5); need(/^refs\/heads\/[a-zA-Z0-9_./-]+$/.test(ref) && !ref.includes(".."), "head-ref");
    try { head = new TextDecoder().decode(await readFile(join(git, ref), 4096)).trim(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const lines = new TextDecoder().decode(await readFile(join(git, "packed-refs"), M)).split("\n");
      const matches = lines.filter(line => line.endsWith(" " + ref)); need(matches.length === 1, "packed-head-ref");
      head = at(matches, 0).split(" ")[0]!;
    }
  }
  need(/^[a-f0-9]{40}$/.test(head), "git-head"); return head;
}

/** Source-authenticated factory. Production scope and external custody are enforced by audit(). */
export async function createGatewayV6Auditor(runtimeRoot: string, expectedSourceSha256: string) {
  const root = absolute(runtimeRoot), sourceSha256 = hash(expectedSourceSha256), source = await gatewayAuditorSourceIdentity(root);
  need(source.sha256 === sourceSha256, "runtime-before-import");
  const from = (name: string) => pathToFileURL(join(root, "scripts/benchmarks", name + ".ts")).href;
  const plan = await import(from("gateway-study-plan-v6")) as typeof import("../benchmarks/gateway-study-plan-v6");
  const transport = await import(from("gateway-study-transport-v6")) as typeof import("../benchmarks/gateway-study-transport-v6");
  const nativeTransport = await import(from("gateway-study-transport-v3")) as typeof import("../benchmarks/gateway-study-transport-v3");
  const store = await import(from("gateway-study-store-v3")) as typeof import("../benchmarks/gateway-study-store-v3");
  const v6store = await import(from("gateway-study-store-v6")) as typeof import("../benchmarks/gateway-study-store-v6");
  const runner = await import(from("gateway-study-v6")) as typeof import("../benchmarks/gateway-study-v6");
  const authority = await import(from("gateway-study-v3")) as typeof import("../benchmarks/gateway-study-v3");
  const stats = await import(from("gateway-study-assessment-v6")) as typeof import("../benchmarks/gateway-study-assessment-v6");
  const judges = await import(from("judge")) as typeof import("../benchmarks/judge");
  same(await gatewayAuditorSourceIdentity(root), source, "source-during-import");
  need(transport.GATEWAY_READER_FAILURE_V6_POLICY_SHA256 === POLICY && canonicalSha256(transport.GATEWAY_READER_FAILURE_V6_POLICY) === POLICY, "fixed-policy");
  function parseLedger(raw: Uint8Array): GatewayStudyLedgerEvent[] {
    need(raw.length <= 8 * M, "ledger-bound"); const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    need(text === "" || text.endsWith("\n"), "partial-ledger-line");
    const events = text === "" ? [] : text.slice(0, -1).split("\n").map(line => JSON.parse(line));
    nativeTransport.gatewayStudyLedgerExposure(events);
    let exposure = CARRY; const pending = new Map<string, number>();
    for (const e of events as GatewayStudyLedgerEvent[]) {
      if (e.kind === "reserved") { exposure += e.micros; pending.set(e.id, e.micros); }
      else { exposure += e.micros - pending.get(e.id)!; pending.delete(e.id); }
      need(exposure <= 40_000_000, "carried-ledger-prefix-cap");
    }
    return events;
  }
  function verifyWaves(events: readonly GatewayStudyLedgerEvent[], jobs: readonly GatewayJob[]) {
    const phases = new Map(jobs.map(j => [j.key, j.phase])), pending = new Set<string>();
    let phase: string | undefined, count = 0, settling = false;
    for (const e of events) {
      if (e.kind === "reserved") {
        const next = phases.get(e.id); need(next === "reader" || next === "judge", "unexpected-new-phase");
        if (pending.size === 0) { count = 0; settling = false; phase = next; }
        need(!settling && phase === next && ++count <= 4 && !pending.has(e.id), "invalid-four-call-wave"); pending.add(e.id);
      } else { need(pending.delete(e.id), "wave-settlement"); settling = true; }
    }
    need(pending.size === 0, "unclosed-wave");
  }
  async function readResponse(read: GatewayV6ArtifactRead, freezeSha256: string, job: GatewayJob, events: readonly GatewayStudyLedgerEvent[]) {
    const prefix = "jobs/" + hash(job.key);
    same(json(await read(prefix + "/pending.json", 8 * M)), v6store.gatewayV6JobPending(job, freezeSha256), "pending-request-binding");
    const reservation = store.gatewayReservation(job), reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros };
    same(json(await read(prefix + "/reserved.json", 4096)), reserved, "reserved-binding");
    const metadata = record(json(await read(prefix + "/response.json", 32768)));
    exact(metadata, ["requestSha256", "httpStatus", "bodyComplete", "receivedBytes", "transportError", "body"]);
    const body = await read(prefix + "/response.body", M);
    same(metadata.body, { bytes: body.length, sha256: sha256Hex(body) }, "response-body-binding");
    const response = transport.parseGatewayStudyV6(job.request, reservation, { ...metadata, body } as GatewayStudyRaw);
    const settled = { v: 1, id: job.key, kind: "settled", micros: response.usage.micros };
    same(json(await read(prefix + "/settled.json", 4096)), settled, "settled-binding");
    same(events.filter(e => e.id === job.key), [reserved, settled], "job-ledger-binding");
    same(json(await read(prefix + "/result.json", 8 * M)), { protocol: "oh.memory-gateway-store.v6", freezeSha256, jobKey: job.key, result: response }, "saved-result-binding");
    return response;
  }
  async function reconstruct(input: ReplayInput) {
    const events = parseLedger(input.ledgerRaw), forbidden = new Set(input.importedJobKeys);
    need(forbidden.size === input.importedJobKeys.length && input.importedReaderResults.length <= input.readerJobs.length
      && input.jobKeys.every(key => !forbidden.has(key)) && new Set(input.jobKeys).size === input.jobKeys.length, "import-new-partition");
    const readers = [];
    for (const [i, imported] of input.importedReaderResults.entries()) {
      const job = at(input.readerJobs, i); same(imported.job, job, "imported-reader-prefix"); need(forbidden.has(job.key), "imported-reader-membership");
      readers.push(plan.completeGatewayV6Reader(job, at(input.questions, job.native.questionIndex), imported.response));
    }
    const remaining = input.readerJobs.slice(readers.length);
    for (const job of remaining) {
      need(!forbidden.has(job.key), "attempted-reader-resubmitted");
      readers.push(plan.completeGatewayV6Reader(job, at(input.questions, job.native.questionIndex), await readResponse(input.read, input.freezeSha256, job, events)));
    }
    const planInput = { readerJobs: input.readerJobs, readerRows: readers, questions: input.questions, profile: input.profile };
    const judgePlan = plan.makeGatewayV6JudgePlan(planInput), physicalJudgeResults = [];
    for (const job of judgePlan.jobs) {
      need(!forbidden.has(job.key), "attempted-judge-resubmitted");
      physicalJudgeResults.push(plan.completeGatewayV6Judge(job, await readResponse(input.read, input.freezeSha256, job, events)));
    }
    const scoredCases = plan.expandGatewayV6Judgments(judgePlan, physicalJudgeResults);
    const assessment = stats.assessGatewayV6Superiority({ ...planInput, poolSize: input.poolSize, selected: input.selected, physicalJudgeRows: physicalJudgeResults, caseOutcomes: scoredCases });
    const jobs: GatewayJob[] = [...remaining, ...judgePlan.jobs], orderedKeys = jobs.map(j => j.key);
    need(new Set(orderedKeys).size === orderedKeys.length, "new-job-uniqueness");
    same(input.jobKeys, [...orderedKeys].sort(), "exact-new-job-set");
    same(events.filter(e => e.kind === "reserved").map(e => e.id), orderedKeys, "new-request-order");
    need(events.length === orderedKeys.length * 2 && events.filter(e => e.kind === "settled").length === orderedKeys.length, "complete-new-ledger");
    verifyWaves(events, jobs);
    return { readers, scoredCases, physicalJudgeResults, assessment, jobs, orderedKeys, events,
      remainingReaderCount: remaining.length, judgeOwners: judgePlan.jobs.length, judgePlanSha256: canonicalSha256(judgePlan),
      newLedgerExposureMicros: nativeTransport.gatewayStudyLedgerExposure(events) };
  }
  function qualified(value: unknown, startedAt: number, auth: GatewayStudyAuth) {
    const q = record(value); exact(q, ["method", "project", "scope", "environment", "issuer", "subject", "audience", "expiresAt", "signatureVerifiedLocally"]);
    need(q.method === auth.method && q.project === auth.project && q.scope === auth.scope && q.environment === auth.environment
      && ["https://oidc.vercel.com", "https://oidc.vercel.com/" + auth.scope].includes(string(q.issuer))
      && q.subject === "owner:" + auth.scope + ":project:" + auth.project + ":environment:" + auth.environment
      && q.audience === "https://vercel.com/" + auth.scope && q.signatureVerifiedLocally === false
      && typeof q.expiresAt === "number" && Number.isFinite(q.expiresAt) && q.expiresAt >= startedAt / 1000 + 310, "scoped-oidc"); return q;
  }
  type CustodyInput = Readonly<{ closure: unknown; files: readonly string[]; read: GatewayV6ArtifactRead; readPin: typeof pinned;
    studyDirectory: string; freezeSha256: string; freeze: GatewayStudyV6Freeze; finalBatch: Pin; comparison: Pin; auth: GatewayStudyAuth }>;
  async function verifyCustody(input: CustodyInput) {
    const c = record(input.closure); exact(c, ["schema", "createdAt", "freezeSha256", "inventorySha256", "finalBatchSha256", "verification", "allProducersClosed", "runs"]);
    need(c.schema === "oh.gateway-final-supervisor-closure.v6" && c.freezeSha256 === input.freezeSha256 && c.finalBatchSha256 === input.finalBatch.sha256
      && c.verification === "owner-verified-complete-producer-inventory" && c.allProducersClosed === true, "external-owner-closure");
    const manifestAt = time(c.createdAt), runs = array(c.runs, 1024), seen = new Set<string>(), proofs = new Set<string>(), identities = new Set<string>(), names: string[] = [];
    need(runs.length > 0, "empty-producer-history"); hash(c.inventorySha256);
    const history = [], pins: Pin[] = []; let previousEnd = time(input.freeze.createdAt);
    for (const [i, value] of runs.entries()) {
      const r = record(value); exact(r, ["runId", "admissionSha256", "closureSha256", "configuration", "supervisorStatus", "groupGone", "runnerExitCode", "newTransportInvocations"]);
      const runId = string(r.runId); need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId) && !seen.has(runId), "run-id"); seen.add(runId);
      need(r.groupGone === true && r.runnerExitCode === 0, "producer-not-successful");
      const name = "batch-" + runId + ".json", admissionName = "batch-" + runId + "-started.json"; names.push(name, admissionName);
      const raw = await input.read(name, M); need(sha256Hex(raw) === hash(r.closureSha256), "batch-pin"); const b = record(json(raw));
      exact(b, ["protocol", "runId", "freezeSha256", "sourceSha256", "sourceGitHead", "importedStudySha256", "policySha256", "priorAmendmentExposureMicros", "importedJobKeysSha256",
        "start", "end", "admission", "maximumNewCalls", "concurrency", "newTransportInvocations", "admittedKeys", "initialJobKeys", "finalJobKeys", "failed", "interrupted",
        "stopReason", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose", "qualified", "ledger", "comparisonArtifact", "result"]);
      const start = time(b.start), end = time(b.end), maximum = integer(b.maximumNewCalls, 256), calls = integer(b.newTransportInvocations, 256);
      need(maximum > 0 && calls > 0 && calls <= maximum && calls === r.newTransportInvocations && b.protocol === "oh.memory-gateway-batch.v6"
        && b.runId === runId && b.freezeSha256 === input.freezeSha256 && b.sourceSha256 === sourceSha256 && b.sourceGitHead === input.freeze.sourceGitHead
        && b.importedStudySha256 === input.freeze.importedStudy.sha256 && b.policySha256 === POLICY && b.priorAmendmentExposureMicros === CARRY
        && b.importedJobKeysSha256 === input.freeze.study.importedJobKeysSha256 && b.concurrency === 4 && b.failed === false && b.interrupted === false
        && ["storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose"].every(k => b[k] === true)
        && start >= previousEnd && end >= start && end <= manifestAt, "batch-custody-or-time");
      const admission = pin(b.admission);
      same(admission, { path: join(input.studyDirectory, admissionName), sha256: hash(r.admissionSha256) }, "admission-binding");
      const admissionRaw = await input.read(admissionName, 32768); need(sha256Hex(admissionRaw) === admission.sha256, "admission-pin");
      const a = record(json(admissionRaw)), q = qualified(b.qualified, start, input.auth);
      same(a, { protocol: "oh.memory-gateway-batch-admission.v6", runId, freezeSha256: input.freezeSha256, sourceSha256, sourceGitHead: input.freeze.sourceGitHead,
        importedStudySha256: input.freeze.importedStudy.sha256, policySha256: POLICY, priorAmendmentExposureMicros: CARRY,
        importedJobKeysSha256: input.freeze.study.importedJobKeysSha256, start: b.start, maximumNewCalls: maximum, concurrency: 4,
        openingLedgerExposureMicros: integer(a.openingLedgerExposureMicros, 40_000_000 - CARRY), initialJobKeysSha256: canonicalSha256(b.initialJobKeys), qualified: q }, "native-admission");
      const configuration = pin(r.configuration), supervisorStatus = pin(r.supervisorStatus);
      for (const p of [configuration, supervisorStatus]) for (const key of [p.path, p.sha256]) { need(!proofs.has(key), "reused-producer-proof"); proofs.add(key); }
      const producer = await verifyGatewayV6Supervisor({ configuration, supervisorStatus, maximumNewCalls: maximum, startAt: start, endAt: end,
        studyDirectory: input.studyDirectory, runtimeRoot: root, freezeSha256: input.freezeSha256, manifestAt, auth: input.auth }, input.readPin);
      need(!identities.has(producer.producerIdentitySha256) && producer.startedAt >= previousEnd, "reused-or-overlapping-producer"); identities.add(producer.producerIdentitySha256);
      previousEnd = producer.finishedAt;
      if (i === runs.length - 1) {
        need(join(input.studyDirectory, name) === input.finalBatch.path && r.closureSha256 === input.finalBatch.sha256
          && input.comparison.path === join(input.studyDirectory, "comparison-" + runId + ".json") && record(b.result).status === "completed"
          && record(b.result).phase === "judge" && b.stopReason === null, "final-batch-complete");
        same(b.comparisonArtifact, input.comparison, "final-comparison-pin");
      } else need(b.comparisonArtifact === null && record(b.result).status === "paused" && b.stopReason === "call-limit" && calls === maximum, "earlier-batch-paused");
      pins.push(configuration, supervisorStatus, admission, { path: join(input.studyDirectory, name), sha256: hash(r.closureSha256) });
      history.push({ runId, batch: b, admission: a, configuration, supervisorStatus, calls, maximum });
    }
    same(input.files.filter(p => p.startsWith("batch-")).sort(), names.sort(), "complete-batch-file-set");
    return { history, pins };
  }
  function verifyHistory(custody: Awaited<ReturnType<typeof verifyCustody>>, replay: Awaited<ReturnType<typeof reconstruct>>, ledgerRaw: Uint8Array, directory: string) {
    let frontier = 0, bytesBefore = 0, eventsBefore = 0, exposureBefore = 0;
    for (const [i, entry] of custody.history.entries()) {
      const b = entry.batch, ledger = record(b.ledger), before = frontier; frontier += entry.calls;
      need(frontier <= replay.jobs.length, "history-extra-requests");
      same(b.initialJobKeys, replay.orderedKeys.slice(0, before).sort(), "initial-jobs");
      same(b.admittedKeys, replay.orderedKeys.slice(before, frontier), "admitted-native-order");
      same(b.finalJobKeys, replay.orderedKeys.slice(0, frontier).sort(), "final-jobs");
      exact(ledger, ["path", "bytes", "sha256", "exposureMicros", "priorAmendmentExposureMicros", "totalAmendmentExposureMicros", "budget"]);
      const bytes = integer(ledger.bytes, ledgerRaw.length), prefix = ledgerRaw.subarray(0, bytes);
      need(bytes > bytesBefore && ledger.path === join(directory, "ledger.jsonl") && sha256Hex(prefix) === hash(ledger.sha256), "ledger-prefix");
      const events = parseLedger(prefix), exposure = nativeTransport.gatewayStudyLedgerExposure(events), newEvents = events.slice(eventsBefore);
      same(events.filter(e => e.kind === "reserved").map(e => e.id), replay.orderedKeys.slice(0, frontier), "ledger-prefix-order");
      need(events.length === frontier * 2 && events.filter(e => e.kind === "settled").length === frontier, "settled-prefix");
      verifyWaves(newEvents, replay.jobs);
      need(ledger.exposureMicros === exposure && ledger.priorAmendmentExposureMicros === CARRY && ledger.totalAmendmentExposureMicros === CARRY + exposure
        && entry.admission.openingLedgerExposureMicros === exposureBefore, "once-carried-exposure");
      const settled = newEvents.filter(e => e.kind === "settled").reduce((n, e) => n + e.micros, 0);
      same(ledger.budget, { capUsd: 40, maxCalls: entry.maximum, reservedCalls: entry.calls, historicalExposureUsd: 21.655385,
        priorAmendmentExposureUsd: (CARRY + exposureBefore) / 1e6, accountedUsd: (CARRY + exposure) / 1e6,
        confirmedThisRunUsd: settled / 1e6, unresolvedThisRunUsd: 0, billedUsd: null }, "budget-summary");
      const expected = frontier < replay.remainingReaderCount
        ? { status: "paused", phase: "reader", resolved: 332 + frontier, required: 360, importedReaders: 332 }
        : frontier < replay.jobs.length
          ? { status: "paused", phase: "judge", resolved: frontier - replay.remainingReaderCount, required: replay.judgeOwners }
          : { status: "completed", phase: "judge", resolved: 360, required: 360, modelJudgedCases: replay.assessment.coverage.modelJudgedCases,
            policyScoredReaderFailures: replay.assessment.coverage.policyScoredReaderFailures, physicalJudgeRequests: replay.judgeOwners };
      same(b.result, expected, "phase-frontier");
      need(i === custody.history.length - 1 ? frontier === replay.jobs.length && b.stopReason === null : frontier < replay.jobs.length && b.stopReason === "call-limit", "final-frontier");
      bytesBefore = bytes; eventsBefore = events.length; exposureBefore = exposure;
    }
    need(bytesBefore === ledgerRaw.length && frontier === replay.jobs.length && exposureBefore === replay.newLedgerExposureMicros, "unclosed-ledger-suffix");
  }
  async function audit(input: GatewayFinalAuditV6Input) {
    need(input.runtimeRoot === root && input.expectedSourceSha256 === sourceSha256 && Bun.version === "1.3.14", "runtime-binding");
    const directory = absolute(input.studyDirectory), pins = { freeze: pin(input.freeze), finalBatch: pin(input.finalBatch), comparison: pin(input.comparison),
      inventory: pin(input.inventory), supervisorClosure: pin(input.supervisorClosure) };
    need(pins.freeze.path === join(directory, "freeze.json") && dirname(pins.finalBatch.path) === directory && dirname(pins.comparison.path) === directory
      && !pins.inventory.path.startsWith(directory + "/") && !pins.supervisorClosure.path.startsWith(directory + "/"), "external-custody-paths");
    const closure = record(json(await pinned(pins.supervisorClosure, 8 * M)));
    need(closure.allProducersClosed === true && closure.verification === "owner-verified-complete-producer-inventory", "owner-closure-before-read");
    const files = inventory(json(await pinned(pins.inventory, 16 * M)), pins.freeze.sha256);
    need(closure.inventorySha256 === pins.inventory.sha256, "closure-inventory");
    same(await gatewayClosedFileSet(directory), files.map(f => f.path), "closed-inventory");
    const read = reader(directory, files), freezeRaw = await read("freeze.json", 8 * M);
    need(sha256Hex(freezeRaw) === pins.freeze.sha256, "freeze-pin");
    const freeze = runner.parseGatewayStudyV6Freeze(json(freezeRaw));
    need(freeze.sourceSha256 === sourceSha256 && freeze.sourceGitHead === await sourceHead(root), "freeze-source");
    same(await gatewayAuditorSourceIdentity(root), source, "source-before");
    const auth = await authority.readGatewayStudyAuth(freeze.authority);
    const custody = await verifyCustody({ closure, files: files.map(f => f.path), read, readPin: pinned, studyDirectory: directory, freezeSha256: pins.freeze.sha256, freeze, finalBatch: pins.finalBatch, comparison: pins.comparison, auth });
    same(await authority.verifyGatewayStudyAuthority(freeze.authority), freeze.originalLedger, "authority");
    const imported = await runner.loadGatewayStudyV6Context(freeze.importedStudy, freeze.authority), c = imported.context;
    need(c.loaded.selection.document.poolSize === 308 && c.loaded.selection.document.sampleSize === 120
      && canonicalSha256(c.loaded.selection.document.selected) === "65d538eeeda7b4f59069f3cf28253c626b7e2327cffcb6028cadbe993264ae73"
      && imported.readerJobs.length === 360 && imported.readerResults.length === 332 && imported.extractionRows.length === 4732
      && imported.summary.externalExposureMicros === CARRY && imported.summary.terminalReaderFailureCount === 1, "fixed-import");
    need(imported.manifest.studyDirectory !== directory && !directory.startsWith(imported.manifest.studyDirectory + "/")
      && !imported.manifest.studyDirectory.startsWith(directory + "/") && time(imported.manifest.createdAt) <= time(freeze.createdAt), "separate-frozen-studies");
    same(runner.gatewayStudyV6Identity(imported), freeze.study, "frozen-study");
    same(runner.gatewayStudyV6Procedure(c.judge.sha256, auth), freeze.procedure, "frozen-procedure");
    same(c.imported.originalFreeze.inputs, freeze.inputs, "ancestral-inputs");
    const preparation = record(json(await read("preparation.json", 8 * M))), preparedSource = record(preparation.source);
    exact(preparation, ["source", "noModelCalls", "importedV5", "importedEvidencePins", "originalLedger", "policySha256", "maximumTotalAmendmentExposureMicros", "priorAmendmentExposureMicros"]);
    need(preparation.noModelCalls === true && preparation.policySha256 === POLICY && preparation.maximumTotalAmendmentExposureMicros === 40_000_000
      && preparation.priorAmendmentExposureMicros === CARRY && preparedSource.sourceSha256 === sourceSha256 && preparedSource.gitHead === freeze.sourceGitHead
      && preparedSource.bun === "1.3.14" && preparedSource.dirty === false, "preparation");
    same(preparedSource.files, source.files, "prepared-source-files"); same(preparation.importedV5, imported.summary, "prepared-import");
    same(preparation.importedEvidencePins, imported.evidencePins, "prepared-evidence"); same(preparation.originalLedger, freeze.originalLedger, "prepared-ledger");
    same(json(await read("store.json", 2048)), { protocol: "oh.memory-gateway-store.v6", freezeSha256: pins.freeze.sha256 }, "store-header");
    const importedJobKeys = [...c.extractionJobs.map(j => j.key), ...imported.readerResults.map(r => r.job.key)].sort();
    need(importedJobKeys.length === 5064 && new Set(importedJobKeys).size === 5064, "full-imported-key-set");
    const jobKeys = [...new Set(files.filter(f => f.path.startsWith("jobs/")).map(f => hash(f.path.split("/")[1])))].sort();
    const ledgerRaw = await read("ledger.jsonl", 8 * M), replay = await reconstruct({ readerJobs: imported.readerJobs, importedReaderResults: imported.readerResults,
      importedJobKeys, questions: c.loaded.selection.dataset.questions, selected: c.loaded.selection.document.selected, poolSize: 308, profile: c.judge,
      freezeSha256: pins.freeze.sha256, jobKeys, ledgerRaw, read });
    need(replay.readers.length === 360 && replay.scoredCases.length === 360 && replay.remainingReaderCount === 28
      && replay.assessment.primary.status === "completed" && replay.assessment.adverse.status === "completed", "complete-fixed-matrix");
    const comparisonRaw = await read(relative(directory, pins.comparison.path), 128 * M);
    need(sha256Hex(comparisonRaw) === pins.comparison.sha256, "comparison-pin");
    same(json(comparisonRaw), { protocol: "oh.memory-gateway-study.v6", freezeSha256: pins.freeze.sha256, study: freeze.study, procedure: freeze.procedure,
      originalStudiesStatus: "incomplete", importedGatewayV5Status: "blocked", importedV5: imported.summary,
      extraction: { imported: c.imported.summary, priorGateway: c.priorGateway.summary, priorContinuation: c.priorContinuation.summary, rows: imported.extractionRows },
      readers: replay.readers, scoredCases: replay.scoredCases, physicalJudgeResults: replay.physicalJudgeResults, assessment: replay.assessment }, "semantic-comparison");
    verifyHistory(custody, replay, ledgerRaw, directory);
    const expectedFiles = ["freeze.json", "preparation.json", "store.json", "ledger.jsonl", relative(directory, pins.comparison.path),
      ...custody.history.flatMap(h => ["batch-" + h.runId + ".json", "batch-" + h.runId + "-started.json"]),
      ...replay.orderedKeys.flatMap(key => FILES.map(file => "jobs/" + key + "/" + file))].sort();
    same(files.map(f => f.path), expectedFiles, "exact-final-files");
    const after = await runner.loadGatewayStudyV6Context(freeze.importedStudy, freeze.authority);
    same(runner.gatewayStudyV6Identity(after), freeze.study, "import-after"); same(after.extractionRows, imported.extractionRows, "extractions-after");
    await authority.verifyGatewayHistoricalLedger(freeze.originalLedger); same(await authority.verifyGatewayStudyAuthority(freeze.authority), freeze.originalLedger, "authority-after");
    for (const f of files) await read(f.path, 128 * M);
    for (const p of [...Object.values(pins), ...custody.pins, ...imported.evidencePins, freeze.authority, freeze.importedStudy]) await pinned(p, 128 * M);
    same(await gatewayClosedFileSet(directory), expectedFiles, "inventory-after");
    same(await gatewayAuditorSourceIdentity(root), source, "source-after"); need(await sourceHead(root) === freeze.sourceGitHead && (await judges.loadJudgeProfile()).sha256 === c.judge.sha256, "runtime-after");
    return { schema: "oh.gateway-final-audit.v6", status: "accepted", sourceSha256, sourceGitHead: freeze.sourceGitHead, policySha256: POLICY,
      sourceFiles: source.files.length, selectedFamilies: 120, cases: 360, importedJobs: 5064, newReaders: 28, physicalJudgeRequests: replay.judgeOwners,
      assessment: replay.assessment, judgePlanSha256: replay.judgePlanSha256, importedV5: imported.summary,
      historicalLedger: freeze.originalLedger, priorStudyLedger: imported.ledgerPin, priorAmendmentExposureMicros: CARRY,
      newLedgerExposureMicros: replay.newLedgerExposureMicros, totalAmendmentExposureMicros: CARRY + replay.newLedgerExposureMicros,
      batchCount: custody.history.length, batchHistorySha256: canonicalSha256(custody.history), inventoryFiles: files.length,
      pins: Object.fromEntries(Object.entries(pins).map(([name, p]) => [name, p.sha256])),
      qualifications: ["External owner custody must establish complete producer absence; hashes and absent locks alone do not establish it.",
        "Original studies remain incomplete. Every first response and unresolved old reservation is preserved without resubmission.",
        "Post-start failure-scoring amendment with mixed extraction provenance; no unchanged confirmatory error-control or official leaderboard claim.",
        "Report primary criterion and adverse reader-failure sensitivity separately. Gateway model aliases are not pinned snapshots.",
        "Exposure is conservative accounting, not a provider billing statement."],
      modelCalls: 0, credentialCalls: 0, studyWrites: 0, originalLedgerUnchanged: true, priorStudyUnchanged: true };
  }
  return { audit, reconstruct, verifyCustody, verifyHistory, parseLedger, readResponse, verifyWaves };
}
export async function auditGatewayStudyV6Final(input: GatewayFinalAuditV6Input) {
  return (await createGatewayV6Auditor(input.runtimeRoot, input.expectedSourceSha256)).audit(input);
}
if (import.meta.main) {
  const emit = console.log.bind(console); let networkCalls = 0, spawnCalls = 0, suppressedLogs = 0;
  for (const key of ["log", "warn", "error", "info", "debug"] as const) console[key] = () => { suppressedLogs++; };
  globalThis.fetch = Object.assign(async () => { networkCalls++; throw new GatewayFinalAuditV6Failure("network-forbidden"); },
    { preconnect: () => { networkCalls++; throw new GatewayFinalAuditV6Failure("network-forbidden"); } }) as typeof fetch;
  Bun.spawn = (() => { spawnCalls++; throw new GatewayFinalAuditV6Failure("spawn-forbidden"); }) as typeof Bun.spawn;
  Bun.spawnSync = (() => { spawnCalls++; throw new GatewayFinalAuditV6Failure("spawn-forbidden"); }) as typeof Bun.spawnSync;
  try {
    const [path, ...rest] = process.argv.slice(2); need(path && rest.length === 0, "one-input-path-required");
    const v = record(json(await readFile(absolute(path), 65536, true)));
    exact(v, ["runtimeRoot", "expectedSourceSha256", "studyDirectory", "freeze", "finalBatch", "comparison", "inventory", "supervisorClosure"]);
    const result = await auditGatewayStudyV6Final({ runtimeRoot: absolute(v.runtimeRoot), expectedSourceSha256: hash(v.expectedSourceSha256),
      studyDirectory: absolute(v.studyDirectory), freeze: pin(v.freeze), finalBatch: pin(v.finalBatch), comparison: pin(v.comparison),
      inventory: pin(v.inventory), supervisorClosure: pin(v.supervisorClosure) });
    need(networkCalls === 0 && spawnCalls === 0 && suppressedLogs === 0, "unexpected-side-channel");
    emit(JSON.stringify({ ...result, networkCalls, spawnCalls, suppressedLogs }, null, 2));
  } catch (error) {
    emit(JSON.stringify({ schema: "oh.gateway-final-audit.v6", status: "rejected", category: error instanceof GatewayFinalAuditV6Failure ? error.category : "native-or-io-rejection",
      networkCalls, spawnCalls, suppressedLogs, semanticTextPrinted: false })); process.exitCode = 1;
  }
}
