/** Independent final Gateway reconstruction. Production requires pinned complete owner custody.
 * No store open, model dispatch, credential lookup, retry or partial comparison is permitted. */
import { constants } from "node:fs";
import { open, lstat, readdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { verifyGatewayV5Supervisor, type GatewayAuditPin as Pin } from "./gateway-v5-audit-supervisor";
import type { ClaudeExtractionJob } from "../benchmarks/claude-study-plan";
import type { ClaudeExtractionOutcomeV3 } from "../benchmarks/claude-extraction-outcome-v3";
import type { ClaudeLegacyExtraction } from "../benchmarks/claude-legacy";
import type { Corpus, Question } from "../benchmarks/datasets";
import type { FamilyCase } from "../benchmarks/superiority";
import type { GatewayJob, GatewayReaderJob, GatewayExtractionJob, GatewayExtractionRow } from "../benchmarks/gateway-study-plan-v3";
import type { GatewayStudyLedgerEvent, GatewayStudyRaw, GatewayStudyIdentity } from "../benchmarks/gateway-study-transport-v3";
import type { GatewayExtractionRowV5 } from "../benchmarks/gateway-study-plan-v5";
import type { GatewayStudyAuth } from "../benchmarks/gateway-study-v3";

const M = 1024 * 1024, STORE = "oh.memory-gateway-store.v5", BATCH = "oh.memory-gateway-batch.v5", PROFILE = "oh.memory-gateway-study.v5";
const CARRIED = 809209, ORIGINAL_GATEWAY_CARRY = 121802, PRIOR_SOURCE = "50128750d92090d99ec4d4968dafe54cda9866a9d12bb1e28b94aa075c76a037";
const SELECTION = "83983f9408c90388d19361561f910dfe3a59e4128af5de63c1c63a9bad058fa5";
const LEGACY = "e863b15b303d07f5a806904d8f972834cfb49c37d83abecafc01eb2b732f9b93";
const ORIGINAL = "dd6a32b3fc5098c93494b0bd13151f53480a46a142a575222d122ca4634db23b";
const SELECTED = "65d538eeeda7b4f59069f3cf28253c626b7e2327cffcb6028cadbe993264ae73";
export type GatewayFinalAuditInput = Readonly<{ runtimeRoot: string; expectedSourceSha256: string; studyDirectory: string;
  freeze: Pin; finalBatch: Pin; comparison: Pin; inventory: Pin; supervisorClosure: Pin }>;
export type GatewayArtifactRead = (path: string, maximum: number) => Promise<Uint8Array>;
type File = Readonly<{ path: string; bytes: number; sha256: string }>;
type Loaded = Readonly<{ corpora: readonly Corpus[]; questions: readonly Question[]; originalJobs: readonly ClaudeExtractionJob[];
  legacy: ClaudeLegacyExtraction; imported: ReadonlyMap<string, ClaudeExtractionOutcomeV3>; importedSummary: unknown;
  priorGateway: Readonly<{ rows: readonly GatewayExtractionRow[]; origins: readonly unknown[]; summary: unknown }>;
  priorContinuation: Readonly<{ rows: readonly GatewayExtractionRowV5[]; origins: readonly unknown[]; summary: unknown }>;
  selection: Readonly<{ poolSize: number; selected: readonly FamilyCase[] }> }>;
export class GatewayFinalAuditFailure extends Error { constructor(readonly category: string) { super(`Gateway final audit: ${category}.`); } }
function need(v: unknown, why: string): asserts v { if (!v) throw new GatewayFinalAuditFailure(why); }
function record(v: unknown): Record<string, unknown> { need(isPlainRecord(v), "record"); return v; }
function exact(v: Record<string, unknown>, keys: readonly string[]) { need(hasExactKeys(v, keys), "exact-keys"); }
function string(v: unknown): string { need(typeof v === "string", "string"); return v; }
function hash(v: unknown): string { const s = string(v); need(/^[a-f0-9]{64}$/.test(s), "hash"); return s; }
function integer(v: unknown, max = Number.MAX_SAFE_INTEGER): number { need(typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max && !Object.is(v, -0), "integer"); return v; }
function absolute(v: unknown): string { const p = string(v); need(p.length <= 4096 && isAbsolute(p) && resolve(p) === p && !p.includes("\0"), "absolute-path"); return p; }
function rel(v: unknown): string { const p = string(v); need(p.length > 0 && p.length <= 1024 && !isAbsolute(p) && !p.includes("\0") && !p.includes("\\") && p.split("/").every(s => s !== "" && s !== "." && s !== ".."), "relative-path"); return p; }
function pin(v: unknown): Pin { const p = record(v); exact(p, ["path", "sha256"]); return { path: absolute(p.path), sha256: hash(p.sha256) }; }
function array(v: unknown, max = 50000): unknown[] { need(Array.isArray(v) && v.length <= max, "array-bound"); return v; }
function same(a: unknown, b: unknown, why: string) { need(canonicalSha256(a) === canonicalSha256(b), why); }
function json(raw: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
function at<T>(a: readonly T[], i: number): T { const v = a[i]; need(v !== undefined, "position"); return v; }
function time(v: unknown): number { const s = string(v), n = Date.parse(s); need(Number.isFinite(n) && new Date(n).toISOString() === s, "timestamp"); return n; }
async function readFile(p: string, max: number, privateFile = false): Promise<Uint8Array> {
  absolute(p); const h = await open(p, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const a = await h.stat(); need(a.isFile() && a.nlink === 1 && a.size <= max && a.uid === process.getuid?.(), "file-custody");
    if (privateFile) need((a.mode & 0o777) === 0o600, "private-file-mode");
    const raw = new Uint8Array(a.size); for (let offset = 0; offset < raw.length;) { const got = await h.read(raw, offset, raw.length - offset, offset); need(got.bytesRead > 0, "short-read"); offset += got.bytesRead; }
    for (const b of [await h.stat(), await lstat(p)]) need(!b.isSymbolicLink() && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs, "file-changed");
    return raw;
  } finally { await h.close(); }
}
async function pinned(p: Pin, max: number) { const raw = await readFile(p.path, max); need(sha256Hex(raw) === p.sha256, "pin-changed"); return raw; }
export async function gatewayAuditorSourceIdentity(root: string) {
  absolute(root); need(await realpath(root) === root, "source-alias");
  const paths = ["package.json", "bun.lock", "tsconfig.json", "tsconfig.scripts.json", "scripts/benchmark-memory.ts"];
  async function visit(dir: string, depth: number): Promise<void> { need(depth <= 16, "source-depth");
    for (const e of await readdir(join(root, dir), { withFileTypes: true })) { const p = `${dir}/${e.name}`;
      if (e.isDirectory()) await visit(p, depth + 1); else if (e.isFile() && e.name.endsWith(".ts")) paths.push(p); else need(!e.isSymbolicLink(), "source-symlink"); need(paths.length <= 512, "source-count"); } }
  await visit("src", 0); await visit("scripts/benchmarks", 0);
  const files = []; for (const p of paths.sort()) files.push({ path: p, sha256: sha256Hex(await readFile(join(root, p), 8 * M)) });
  return { sha256: canonicalSha256(files), files };
}
export async function gatewayClosedFileSet(root: string) {
  need(await realpath(root) === root, "study-alias"); const paths: string[] = [];
  async function visit(p: string, depth: number): Promise<void> { const s = await lstat(p); need(s.isDirectory() && !s.isSymbolicLink() && (s.mode & 0o777) === 0o700 && s.uid === process.getuid?.() && depth <= 2, "directory-custody");
    const entries = await readdir(p, { withFileTypes: true });
    if (depth === 1) need(relative(root, p) === "jobs", "unexpected-directory");
    if (depth === 2) { need(/^jobs\/[a-f0-9]{64}$/.test(relative(root, p)), "job-directory"); same(entries.map(e => e.name).sort(), ["pending.json", "reserved.json", "response.body", "response.json", "result.json", "settled.json"], "complete-job-files"); }
    for (const e of entries) { need(e.name !== "active.lock", "live-store-lock"); const path = join(p, e.name);
      if (e.isDirectory()) await visit(path, depth + 1); else { need(e.isFile(), "special-file"); paths.push(rel(relative(root, path))); } need(paths.length <= 65536, "file-count"); } }
  await visit(root, 0); return paths.sort();
}
function inventory(value: unknown, freezeSha256: string): File[] {
  const v = record(value); exact(v, ["schema", "freezeSha256", "files"]); need(v.schema === "oh.gateway-final-inventory.v5" && v.freezeSha256 === freezeSha256, "inventory-binding");
  const files = array(v.files, 65536).map(value => { const f = record(value); exact(f, ["path", "bytes", "sha256"]); return { path: rel(f.path), bytes: integer(f.bytes, 128 * M), sha256: hash(f.sha256) }; });
  need(files.every((f, i) => i === 0 || at(files, i - 1).path < f.path) && files.reduce((s, f) => s + f.bytes, 0) <= 8 * 1024 * M, "inventory-order-or-bound"); return files;
}
function reader(root: string, files: readonly File[]): GatewayArtifactRead { const map = new Map(files.map(f => [f.path, f])); return async (p, max) => { const f = map.get(rel(p)); need(f && f.bytes <= max, "missing-or-oversized-file");
  const raw = await readFile(join(root, p), max, true); need(raw.length === f.bytes && sha256Hex(raw) === f.sha256, "inventory-file-changed"); return raw; }; }

/** Testable native reconstruction factory. Only auditGatewayStudyV5Final authenticates production scope. */
export async function createGatewayV5Auditor(runtimeRoot: string, expectedSourceSha256: string) {
  const root = absolute(runtimeRoot), sourceSha256 = hash(expectedSourceSha256), loadedSource = await gatewayAuditorSourceIdentity(root);
  need(loadedSource.sha256 === sourceSha256, "runtime-before-import");
  const plan = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-plan-v3.ts")).href) as typeof import("../benchmarks/gateway-study-plan-v3");
  const transport = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-transport-v3.ts")).href) as typeof import("../benchmarks/gateway-study-transport-v3");
  const store = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-store-v3.ts")).href) as typeof import("../benchmarks/gateway-study-store-v3");
  const runner = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-v3.ts")).href) as typeof import("../benchmarks/gateway-study-v3");
  const continuation = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-v5.ts")).href) as typeof import("../benchmarks/gateway-study-v5");
  const priorImport = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-import-v4.ts")).href) as typeof import("../benchmarks/gateway-study-import-v4");
  const v5plan = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-plan-v5.ts")).href) as typeof import("../benchmarks/gateway-study-plan-v5");
  const v5transport = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-transport-v5.ts")).href) as typeof import("../benchmarks/gateway-study-transport-v5");
  const v5store = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-store-v5.ts")).href) as typeof import("../benchmarks/gateway-study-store-v5");
  const v5import = await import(pathToFileURL(join(root, "scripts/benchmarks/gateway-study-import-v5.ts")).href) as typeof import("../benchmarks/gateway-study-import-v5");
  const retrieval = await import(pathToFileURL(join(root, "scripts/benchmarks/retrieval.ts")).href) as typeof import("../benchmarks/retrieval");
  const models = await import(pathToFileURL(join(root, "scripts/benchmarks/model.ts")).href) as typeof import("../benchmarks/model");
  const nativePlan = await import(pathToFileURL(join(root, "scripts/benchmarks/claude-study-plan.ts")).href) as typeof import("../benchmarks/claude-study-plan");
  const judges = await import(pathToFileURL(join(root, "scripts/benchmarks/judge.ts")).href) as typeof import("../benchmarks/judge");
  const stats = await import(pathToFileURL(join(root, "scripts/benchmarks/superiority.ts")).href) as typeof import("../benchmarks/superiority");
  same(await gatewayAuditorSourceIdentity(root), loadedSource, "source-during-import");
  function parseLedger(raw: Uint8Array): GatewayStudyLedgerEvent[] { need(raw.length <= 8 * M, "ledger-bound"); const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    need(text === "" || text.endsWith("\n"), "partial-ledger-line"); const events = text === "" ? [] : text.slice(0, -1).split("\n").map(line => JSON.parse(line));
    transport.gatewayStudyLedgerExposure(events);
    let exposure = CARRIED; const pending = new Map<string, number>();
    for (const e of events as GatewayStudyLedgerEvent[]) {
      if (e.kind === "reserved") { exposure += e.micros; pending.set(e.id, e.micros); }
      else { exposure += e.micros - pending.get(e.id)!; pending.delete(e.id); }
      need(exposure <= 40_000_000, "carried-ledger-prefix-cap");
    }
    return events; }
  function verifyWaves(events: readonly GatewayStudyLedgerEvent[], orderedKeys: readonly string[], extractionCount: number, readerCases: number) {
    const positions = new Map(orderedKeys.map((key, i) => [key, i])), pending = new Set<string>(); let phase = -1, reserved = 0, settling = false;
    for (const event of events) {
      if (event.kind === "reserved") { const index = positions.get(event.id); need(index !== undefined, "wave-unknown-job");
        const nextPhase = index < extractionCount ? 0 : index < extractionCount + readerCases ? 1 : 2;
        if (pending.size === 0) { phase = nextPhase; reserved = 0; settling = false; }
        need(!settling && nextPhase === phase && ++reserved <= 4 && !pending.has(event.id), "invalid-four-call-wave"); pending.add(event.id);
      } else { need(pending.delete(event.id), "wave-settlement-without-reservation"); settling = true; }
    }
    need(pending.size === 0, "unclosed-reservation-wave");
  }
  async function readResponse(read: GatewayArtifactRead, freezeSha256: string, job: GatewayJob, events: readonly GatewayStudyLedgerEvent[]) {
    const p = `jobs/${hash(job.key)}`;
    same(json(await read(`${p}/pending.json`, 8 * M)), v5store.gatewayV5JobPending(job, freezeSha256), "pending-request-binding");
    const reservation = store.gatewayReservation(job), reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros };
    same(json(await read(`${p}/reserved.json`, 4096)), reserved, "reserved-binding");
    const metadata = record(json(await read(`${p}/response.json`, 32768))); exact(metadata, ["requestSha256", "httpStatus", "bodyComplete", "receivedBytes", "transportError", "body"]);
    const body = await read(`${p}/response.body`, M); same(metadata.body, { bytes: body.length, sha256: sha256Hex(body) }, "response-body-binding");
    const response = v5transport.parseGatewayStudyV5(job.request, reservation, { ...metadata, body } as GatewayStudyRaw);
    const settled = { v: 1, id: job.key, kind: "settled", micros: response.usage.micros };
    same(json(await read(`${p}/settled.json`, 4096)), settled, "settled-binding"); same(events.filter(e => e.id === job.key), [reserved, settled], "job-ledger-binding");
    same(json(await read(`${p}/result.json`, 8 * M)), { protocol: STORE, freezeSha256, jobKey: job.key, result: response }, "saved-result-binding"); return response;
  }
  /** The failed v3 store has captures and reservations only. Never invent a settlement or rewrite its native failure. */
  async function verifyPriorResponses(input: Readonly<{ jobs: readonly GatewayExtractionJob[]; prior: Loaded["priorGateway"];
    freezeSha256: string; sourceSha256: string; runId: string; ledgerRaw: Uint8Array; read: GatewayArtifactRead }>) {
    const jobs = input.jobs.slice(0, 4), prior = input.prior, s = record(prior.summary);
    need(jobs.length === 4 && prior.rows.length === 4 && prior.origins.length === 4, "four-prior-captures");
    exact(s, ["schema", "manifestSha256", "freezeSha256", "sourceSha256", "importedClaudeManifestSha256", "importedTransportInvocations", "importedRowsSha256", "originsSha256", "originalGatewayStatus", "externalExposureMicros", "ledger", "reportedUsage", "validCount", "invalidEnvelopeCount", "invalidRefusalCount", "billedUsd", "physicalModelAttempts", "qualification"]);
    hash(s.manifestSha256); hash(s.importedClaudeManifestSha256);
    const reserved = jobs.map(j => ({ v: 1, id: j.key, kind: "reserved", micros: store.gatewayReservation(j).micros }));
    const ledgerText = new TextDecoder("utf-8", { fatal: true }).decode(input.ledgerRaw);
    need(input.ledgerRaw.length <= 32768 && ledgerText.endsWith("\n"), "prior-ledger-lines");
    const events = ledgerText.slice(0, -1).split("\n").map(line => JSON.parse(line)); same(events, reserved, "prior-unsettled-reservations");
    const exposure = transport.gatewayStudyLedgerExposure(events), ledger = record(s.ledger); exact(ledger, ["path", "sha256", "bytes", "exposureMicros"]); absolute(ledger.path);
    same(ledger, { path: ledger.path, sha256: sha256Hex(input.ledgerRaw), bytes: input.ledgerRaw.length, exposureMicros: exposure }, "prior-ledger-pin");
    const rows = [], origins = [], usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 };
    for (const job of jobs) {
      const p = `jobs/${job.key}`, reservation = store.gatewayReservation(job);
      same(json(await input.read(`${p}/pending.json`, M)), store.gatewayJobPending(job, input.freezeSha256), "prior-pending-request");
      same(json(await input.read(`${p}/reserved.json`, 4096)), { v: 1, id: job.key, kind: "reserved", micros: reservation.micros }, "prior-reservation");
      const metadata = record(json(await input.read(`${p}/response.json`, 32768))); exact(metadata, ["requestSha256", "httpStatus", "bodyComplete", "receivedBytes", "transportError", "body"]);
      const body = await input.read(`${p}/response.body`, M); same(metadata.body, { bytes: body.length, sha256: sha256Hex(body) }, "prior-raw-binding");
      need(metadata.httpStatus === 200, "prior-http-status");
      const response = transport.parseGatewayStudyResponse(job.request, reservation, { ...metadata, body } as GatewayStudyRaw);
      need(response.finishReason === "stop" && response.identity.resolvedProviderApiModelId === null && response.identity.resolvedSnapshot === null && response.identity.snapshotPinned === false, "prior-alias-amendment");
      rows.push(plan.completeGatewayExtraction(job, response));
      origins.push({ origin: "imported-rejected-gateway-v3-capture", replayProfile: "oh.gateway-study-import.v4", originalNativeStatus: "blocked", key: job.key,
        ordinal: job.ordinal, requestSha256: job.request.requestSha256, freezeSha256: input.freezeSha256, sourceSha256: input.sourceSha256, runId: input.runId,
        rawSha256: response.rawSha256, rawBytes: response.rawBytes, conservativeReservedMicros: reservation.micros });
      for (const key of Object.keys(usage) as Array<keyof typeof usage>) usage[key] = integer(usage[key] + response.usage[key]);
    }
    same(rows, prior.rows, "prior-native-rows"); same(origins, prior.origins, "prior-native-origins");
    same(s, { schema: "oh.gateway-study-import-summary.v4", manifestSha256: s.manifestSha256, freezeSha256: input.freezeSha256, sourceSha256: input.sourceSha256,
      importedClaudeManifestSha256: s.importedClaudeManifestSha256, importedTransportInvocations: 4, importedRowsSha256: canonicalSha256(rows), originsSha256: canonicalSha256(origins),
      originalGatewayStatus: "blocked", externalExposureMicros: exposure, ledger, reportedUsage: usage, validCount: rows.filter(r => r.status === "valid").length,
      invalidEnvelopeCount: rows.filter(r => r.status === "invalid-envelope").length, invalidRefusalCount: rows.filter(r => r.status === "invalid-refusal").length,
      billedUsd: null, physicalModelAttempts: null, qualification: priorImport.GATEWAY_STUDY_IMPORT_V4_QUALIFICATION }, "prior-summary-once");
    return { importedGatewayCount: rows.length, importedGatewayRowsSha256: canonicalSha256(rows), originsSha256: canonicalSha256(origins), reportedUsage: usage, externalExposureMicros: exposure };
  }
  /** Independently replay the closed v4 raw prefix; its single unresolved reserve remains unchanged. */
  async function verifyContinuationResponses(input: Readonly<{ jobs: readonly GatewayExtractionJob[]; prior: Loaded["priorContinuation"];
    freezeSha256: string; sourceSha256: string; runIds: readonly string[]; firstBatchCount: number; truncatedKey: string;
    ledgerRaw: Uint8Array; read: GatewayArtifactRead }>) {
    const { prior } = input, count = prior.rows.length, jobs = input.jobs.slice(0, count), summary = record(prior.summary);
    need(count > 0 && jobs.length === count && prior.origins.length === count && input.runIds.length === 2
      && input.firstBatchCount > 0 && input.firstBatchCount < count, "continuation-counts");
    exact(summary, ["schema", "manifestSha256", "freezeSha256", "sourceSha256", "importedClaudeManifestSha256", "importedPriorGatewayManifestSha256",
      "importedTransportInvocations", "importedRowsSha256", "originsSha256", "originalGatewayStatus", "externalExposureMicros", "ledger", "reportedUsage",
      "validCount", "invalidEnvelopeCount", "invalidRefusalCount", "invalidTruncationCount", "billedUsd", "physicalModelAttempts", "qualification"]);
    for (const key of ["manifestSha256", "importedClaudeManifestSha256", "importedPriorGatewayManifestSha256"]) hash(summary[key]);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input.ledgerRaw); need(text.endsWith("\n"), "continuation-ledger-lines");
    const events = text.slice(0, -1).split("\n").map(line => JSON.parse(line)) as GatewayStudyLedgerEvent[];
    const exposure = transport.gatewayStudyLedgerExposure(events), ledger = record(summary.ledger);
    exact(ledger, ["path", "sha256", "bytes", "exposureMicros"]); absolute(ledger.path);
    same(ledger, { path: ledger.path, sha256: sha256Hex(input.ledgerRaw), bytes: input.ledgerRaw.length, exposureMicros: exposure }, "continuation-ledger-pin");
    same(events.filter(e => e.kind === "reserved").map(e => e.id), jobs.map(j => j.key), "continuation-native-order");
    need(events.length === count * 2 - 1, "continuation-ledger-count");
    let prefixExposure = ORIGINAL_GATEWAY_CARRY; const pending = new Map<string, number>();
    for (const event of events) {
      if (event.kind === "reserved") { prefixExposure += event.micros; pending.set(event.id, event.micros); }
      else { prefixExposure += event.micros - pending.get(event.id)!; pending.delete(event.id); }
      need(prefixExposure <= 40_000_000, "continuation-prefix-cap");
    }
    same([...pending.keys()], [input.truncatedKey], "continuation-only-unresolved-truncation");

    const rows = [], origins = [], usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 };
    let truncated = 0;
    for (const [index, job] of jobs.entries()) {
      const p = `jobs/${job.key}`, reservation = store.gatewayReservation(job), reserved = { v: 1, id: job.key, kind: "reserved", micros: reservation.micros };
      same(json(await input.read(`${p}/pending.json`, M)), store.gatewayJobPending(job, input.freezeSha256), "continuation-pending-request");
      same(json(await input.read(`${p}/reserved.json`, 4096)), reserved, "continuation-reservation");
      const metadata = record(json(await input.read(`${p}/response.json`, 32768))); exact(metadata, ["requestSha256", "httpStatus", "bodyComplete", "receivedBytes", "transportError", "body"]);
      const body = await input.read(`${p}/response.body`, M); same(metadata.body, { bytes: body.length, sha256: sha256Hex(body) }, "continuation-raw-binding");
      const raw = { ...metadata, body } as GatewayStudyRaw, response = v5transport.parseGatewayStudyV5(job.request, reservation, raw), row = v5plan.completeGatewayV5Extraction(job, response);
      const isTruncated = job.key === input.truncatedKey;
      if (isTruncated) {
        need(response.kind === "truncated-extraction" && row.status === "invalid-truncation" && row.payload.units.length === 0 && !("prediction" in response), "continuation-zero-memory-truncation");
        same(events.filter(e => e.id === job.key), [reserved], "continuation-unsettled-truncation"); truncated++;
      } else {
        need(response.kind !== "truncated-extraction", "unexpected-continuation-truncation");
        const original = transport.parseGatewayStudyResponse(job.request, reservation, raw); same(response, original, "continuation-original-response");
        same(row, plan.completeGatewayExtraction(job, original), "continuation-original-row");
        const settled = { v: 1, id: job.key, kind: "settled", micros: original.usage.micros };
        same(json(await input.read(`${p}/settled.json`, 4096)), settled, "continuation-settlement");
        same(events.filter(e => e.id === job.key), [reserved, settled], "continuation-ledger-once");
        same(json(await input.read(`${p}/result.json`, M)), { protocol: "oh.memory-gateway-store.v3", freezeSha256: input.freezeSha256, jobKey: job.key, result: original }, "continuation-original-result");
      }
      rows.push(row);
      origins.push({ origin: "imported-gateway-v4-first-response", replayProfile: "oh.gateway-study-import.v5", originalNativeStatus: isTruncated ? "blocked" : "completed",
        key: job.key, ordinal: job.ordinal, requestSha256: job.request.requestSha256, freezeSha256: input.freezeSha256, sourceSha256: input.sourceSha256,
        runId: at(input.runIds, index < input.firstBatchCount ? 0 : 1), rawSha256: response.rawSha256, rawBytes: response.rawBytes,
        conservativeReservedMicros: reservation.micros, originalSettledMicros: isTruncated ? null : response.usage.micros });
      for (const key of Object.keys(usage) as Array<keyof typeof usage>) usage[key] = integer(usage[key] + response.usage[key]);
    }
    need(truncated === 1, "exactly-one-continuation-truncation"); same(rows, prior.rows, "continuation-native-rows"); same(origins, prior.origins, "continuation-native-origins");
    same(summary, { schema: "oh.gateway-study-import-summary.v5", manifestSha256: summary.manifestSha256, freezeSha256: input.freezeSha256, sourceSha256: input.sourceSha256,
      importedClaudeManifestSha256: summary.importedClaudeManifestSha256, importedPriorGatewayManifestSha256: summary.importedPriorGatewayManifestSha256,
      importedTransportInvocations: count, importedRowsSha256: canonicalSha256(rows), originsSha256: canonicalSha256(origins), originalGatewayStatus: "blocked",
      externalExposureMicros: exposure, ledger, reportedUsage: usage, validCount: rows.filter(r => r.status === "valid").length,
      invalidEnvelopeCount: rows.filter(r => r.status === "invalid-envelope").length, invalidRefusalCount: rows.filter(r => r.status === "invalid-refusal").length,
      invalidTruncationCount: 1, billedUsd: null, physicalModelAttempts: null, qualification: v5import.GATEWAY_STUDY_IMPORT_V5_QUALIFICATION }, "continuation-summary-once");
    return { importedCount: count, invalidTruncationCount: 1, rowsSha256: canonicalSha256(rows), originsSha256: canonicalSha256(origins), reportedUsage: usage, externalExposureMicros: exposure };
  }
  async function verifyContexts(loaded: Loaded, memory: ReturnType<typeof plan.gatewayStudyMemory>, jobs: readonly GatewayReaderJob[]) {
    need(jobs.length === loaded.questions.length * 3 && loaded.corpora.length === loaded.questions.length && memory.length === loaded.corpora.length, "reader-context-coverage");
    for (const [i, corpus] of loaded.corpora.entries()) { const q = at(loaded.questions, i), m = at(memory, i); need(m.corpusId === corpus.id && q.corpusId === corpus.id, "context-corpus");
      const engine = retrieval.createRetrievers(corpus, m.chunks.flatMap(c => c.units));
      try { for (const [arm, system] of retrieval.benchmarkOrder(nativePlan.CLAUDE_STUDY_SYSTEMS, i).entries()) { const job = at(jobs, i * 3 + arm), n = job.native;
        need(job.ordinal === i * 3 + arm && n.questionIndex === i && n.system === system, "reader-order");
        const retrieved = await engine.retrieve(system, q.question, nativePlan.CLAUDE_STUDY_BUDGET); same(n.retrieved, retrieved, "entire-reader-context");
        need(n.retrievedSha256 === canonicalSha256(retrieved) && n.contextSha256 === sha256Hex(retrieved.context), "reader-context-hashes");
        same(job.request, transport.makeGatewayStudyRequest({ phase: "reader", messages: models.answerMessages(n.question, retrieved.context) }), "gold-free-reader-request");
      } } finally { engine.close(); }
    }
  }
  async function reconstruct(input: Readonly<{ loaded: Loaded; freezeSha256: string; study: unknown; procedure: unknown; comparison: unknown;
    jobKeys: readonly string[]; ledgerRaw: Uint8Array; read: GatewayArtifactRead; profile: Awaited<ReturnType<typeof judges.loadJudgeProfile>> }>) {
    const { loaded, read } = input, comparison = record(input.comparison), count = loaded.questions.length * 3;
    exact(comparison, ["protocol", "freezeSha256", "study", "procedure", "originalStudiesStatus", "extraction", "readers", "judgments", "physicalJudgeResults", "assessment"]);
    // Require complete positional identities before looking at any outcome fields.
    for (const field of ["readers", "judgments"]) { const rows = array(comparison[field], 3000); need(rows.length === count, "incomplete-matrix");
      for (let i = 0; i < count; i++) { const row = record(at(rows, i)), family = at(loaded.selection.selected, Math.floor(i / 3)), q = at(loaded.questions, Math.floor(i / 3));
        need(row.status === "completed" && row.ordinal === i && row.questionId === family.questionId && row.corpusId === family.corpusId && row.groupId === family.groupId
          && row.category === q.category && row.system === at(retrieval.benchmarkOrder(nativePlan.CLAUDE_STUDY_SYSTEMS, Math.floor(i / 3)), i % 3), "matrix-identity"); } }
    const events = parseLedger(input.ledgerRaw), allExtractionJobs = plan.makeGatewayExtractionJobs(loaded.originalJobs, loaded.imported), extractionJobs = allExtractionJobs.slice(4 + loaded.priorContinuation.rows.length), extraction = [];
    need(loaded.priorGateway.rows.length === 4 && loaded.priorGateway.origins.length === 4, "four-prior-captures");
    for (const [i, row] of loaded.priorGateway.rows.entries()) {
      const job = at(allExtractionJobs, i), origin = record(at(loaded.priorGateway.origins, i));
      same(row, plan.completeGatewayExtraction(job, row.response), "prior-parent-partition");
      need(origin.key === job.key && origin.ordinal === job.ordinal && origin.requestSha256 === job.request.requestSha256, "prior-origin-partition");
    }
    need(record(loaded.priorGateway.summary).importedRowsSha256 === canonicalSha256(loaded.priorGateway.rows)
      && record(loaded.priorGateway.summary).originsSha256 === canonicalSha256(loaded.priorGateway.origins), "prior-summary-partition");
    for (const [i, row] of loaded.priorContinuation.rows.entries()) {
      const job = at(allExtractionJobs, i + 4), origin = record(at(loaded.priorContinuation.origins, i));
      same(row, v5plan.completeGatewayV5Extraction(job, row.response), "continuation-parent-partition");
      need(origin.key === job.key && origin.ordinal === job.ordinal && origin.requestSha256 === job.request.requestSha256, "continuation-origin-partition");
    }
    need(loaded.priorContinuation.origins.length === loaded.priorContinuation.rows.length
      && record(loaded.priorContinuation.summary).importedRowsSha256 === canonicalSha256(loaded.priorContinuation.rows)
      && record(loaded.priorContinuation.summary).originsSha256 === canonicalSha256(loaded.priorContinuation.origins), "continuation-summary-partition");
    need(array(record(comparison.extraction).rows).length === extractionJobs.length, "incomplete-extraction");
    for (const job of extractionJobs) extraction.push(v5plan.completeGatewayV5Extraction(job, await readResponse(read, input.freezeSha256, job, events)));
    const memory = plan.gatewayStudyMemory(loaded.legacy, loaded.imported, [...loaded.priorGateway.rows, ...loaded.priorContinuation.rows, ...extraction]);
    const readerJobs = await plan.makeGatewayReaderJobs({ corpora: loaded.corpora, questions: loaded.questions, memory }); await verifyContexts(loaded, memory, readerJobs);
    const readers = []; for (const job of readerJobs) readers.push(v5plan.completeGatewayV5Reader(job, at(loaded.questions, job.native.questionIndex), await readResponse(read, input.freezeSha256, job, events)));
    const judgePlan = plan.makeGatewayJudgePlan({ readerJobs, readerRows: readers, questions: loaded.questions, profile: input.profile });
    const physical = []; for (const job of judgePlan.jobs) physical.push(v5plan.completeGatewayV5Judge(job, await readResponse(read, input.freezeSha256, job, events)));
    const judgments = plan.expandGatewayJudgments(judgePlan, physical), assessment = stats.assessSuperiority(loaded.selection.poolSize, loaded.selection.selected, judgments);
    need(assessment.status === "completed", "incomplete-assessment");
    same(comparison, { protocol: PROFILE, freezeSha256: input.freezeSha256, study: input.study, procedure: input.procedure, originalStudiesStatus: "incomplete",
      extraction: { imported: loaded.importedSummary, priorGateway: loaded.priorGateway.summary, priorContinuation: loaded.priorContinuation.summary, rows: extraction }, readers, judgments, physicalJudgeResults: physical, assessment }, "full-native-comparison");
    const allJobs = [...extractionJobs, ...readerJobs, ...judgePlan.jobs], orderedKeys = allJobs.map(j => j.key);
    need(new Set(orderedKeys).size === orderedKeys.length, "duplicate-planned-job"); same([...input.jobKeys].sort(), [...orderedKeys].sort(), "complete-job-inventory");
    need(events.length === allJobs.length * 2, "ledger-complete-inventory"); same(events.filter(e => e.kind === "reserved").map(e => e.id), orderedKeys, "reservation-native-order");
    const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 }; const identities: Record<string, { identity: GatewayStudyIdentity; calls: number }> = {};
    for (const row of [...extraction, ...readers, ...physical]) { for (const key of Object.keys(usage) as Array<keyof typeof usage>) usage[key] = integer(usage[key] + row.response.usage[key]);
      const key = canonicalSha256(row.response.identity); identities[key] = { identity: row.response.identity, calls: (identities[key]?.calls ?? 0) + 1 }; }
    need(usage.micros === transport.gatewayStudyLedgerExposure(events), "usage-ledger-once");
    return { orderedKeys, allJobs, events, extractionCount: extractionJobs.length, importedCount: loaded.imported.size, importedGatewayCount: loaded.priorGateway.rows.length + loaded.priorContinuation.rows.length,
      readerCases: readers.length, judgeOwners: physical.length, assessment, usage, identities,
      invalidGatewayExtraction: extraction.filter(row => row.status !== "valid").length,
      invalidTruncationCount: extraction.filter(row => row.status === "invalid-truncation").length, memorySha256: canonicalSha256(memory),
      extractionSha256: canonicalSha256(extraction), readerContextsSha256: canonicalSha256(readerJobs.map(j => ({ key: j.key, context: j.native.retrieved, request: j.request }))),
      readerRowsSha256: canonicalSha256(readers), judgePlanSha256: canonicalSha256(judgePlan), judgmentsSha256: canonicalSha256(judgments), comparisonSha256: canonicalSha256(comparison) };
  }
  function qualified(value: unknown, startedAt: number, auth: GatewayStudyAuth) { const q = record(value); exact(q, ["method", "project", "scope", "environment", "issuer", "subject", "audience", "expiresAt", "signatureVerifiedLocally"]);
    need(q.method === auth.method && q.project === auth.project && q.scope === auth.scope && q.environment === auth.environment
      && [`https://oidc.vercel.com/${auth.scope}`, "https://oidc.vercel.com"].includes(string(q.issuer)) && q.subject === `owner:${auth.scope}:project:${auth.project}:environment:${auth.environment}`
      && q.audience === `https://vercel.com/${auth.scope}` && q.signatureVerifiedLocally === false && typeof q.expiresAt === "number" && Number.isFinite(q.expiresAt)
      && q.expiresAt >= startedAt / 1000 + 310, "scoped-oidc-metadata"); return q; }
  /** Validate all supplied producer proof before any new response text or semantic comparison is read. */
  async function verifyCustody(input: Readonly<{ closure: unknown; files: readonly string[]; read: GatewayArtifactRead; readPin: typeof pinned;
    studyDirectory: string; freezeSha256: string; freezeCreatedAt: string; importedSha256: string; priorGatewaySha256: string; priorContinuationSha256: string; finalBatch: Pin; comparison: Pin; auth: GatewayStudyAuth }>) {
    const c = record(input.closure); exact(c, ["schema", "createdAt", "freezeSha256", "inventorySha256", "finalBatchSha256", "verification", "allProducersClosed", "runs"]);
    need(c.schema === "oh.gateway-final-supervisor-closure.v5" && c.freezeSha256 === input.freezeSha256 && c.finalBatchSha256 === input.finalBatch.sha256
      && c.verification === "owner-verified-complete-producer-inventory" && c.allProducersClosed === true, "external-owner-closure");
    hash(c.inventorySha256); const manifestAt = time(c.createdAt), runs = array(c.runs, 4096), seen = new Set<string>(), proofPins = new Set<string>(), identities = new Set<string>(), names: string[] = [];
    need(runs.length > 0, "empty-history"); let previousEnd = time(input.freezeCreatedAt);
    for (const [i, value] of runs.entries()) { const r = record(value); exact(r, ["runId", "admissionSha256", "closureSha256", "configuration", "supervisorStatus", "groupGone", "runnerExitCode", "newTransportInvocations"]);
      const runId = string(r.runId); need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId) && !seen.has(runId), "run-id"); seen.add(runId);
      need(r.groupGone === true && r.runnerExitCode === 0, "producer-not-closed-successfully");
      const name = `batch-${runId}.json`, admissionName = `batch-${runId}-started.json`; names.push(name, admissionName);
      const raw = await input.read(name, M); need(sha256Hex(raw) === hash(r.closureSha256), "batch-pin"); const b = record(json(raw));
      exact(b, ["protocol", "runId", "freezeSha256", "sourceSha256", "importedStudySha256", "start", "end", "admission", "maximumNewCalls", "concurrency", "newTransportInvocations", "admittedKeys", "initialJobKeys", "finalJobKeys", "failed", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose", "priorGatewayVerifiedAtClose", "priorGatewayStudySha256", "priorContinuationVerifiedAtClose", "priorContinuationStudySha256", "interrupted", "stopReason", "qualified", "ledger", "comparisonArtifact", "result"]);
      const start = time(b.start), end = time(b.end), max = integer(b.maximumNewCalls, 256), calls = integer(b.newTransportInvocations, 256);
      need(max > 0 && calls <= max && b.protocol === BATCH && b.runId === runId && b.freezeSha256 === input.freezeSha256 && b.sourceSha256 === sourceSha256 && b.importedStudySha256 === input.importedSha256
        && b.concurrency === 4 && calls === r.newTransportInvocations && b.failed === false && b.storeClosed === true && b.sourceVerifiedAtClose === true && b.importVerifiedAtClose === true
        && b.originalLedgerVerifiedAtClose === true && b.priorGatewayVerifiedAtClose === true && b.priorGatewayStudySha256 === input.priorGatewaySha256 && b.priorContinuationStudySha256 === input.priorContinuationSha256 && b.priorContinuationVerifiedAtClose === true && b.interrupted === false && start >= previousEnd && end >= start && end <= manifestAt, "batch-custody-or-time"); previousEnd = end;
      const admission = pin(b.admission); same(admission, { path: join(input.studyDirectory, admissionName), sha256: hash(r.admissionSha256) }, "admission-binding");
      const aRaw = await input.read(admissionName, 32768); need(sha256Hex(aRaw) === admission.sha256, "admission-pin"); const a = record(json(aRaw)), q = qualified(b.qualified, start, input.auth);
      same(a, { protocol: "oh.memory-gateway-batch-admission.v5", runId, freezeSha256: input.freezeSha256, sourceSha256, importedStudySha256: input.importedSha256,
        start: b.start, maximumNewCalls: max, concurrency: 4, openingLedgerExposureMicros: integer(a.openingLedgerExposureMicros, 40_000_000 - CARRIED), priorGatewayExposureMicros: CARRIED, priorGatewayStudySha256: input.priorGatewaySha256, priorContinuationStudySha256: input.priorContinuationSha256, initialJobKeysSha256: canonicalSha256(b.initialJobKeys), qualified: q }, "native-admission");
      const configuration = pin(r.configuration), supervisorStatus = pin(r.supervisorStatus);
      for (const p of [configuration, supervisorStatus]) for (const key of [p.path, p.sha256]) { need(!proofPins.has(key), "reused-producer-proof"); proofPins.add(key); }
      const producer = await verifyGatewayV5Supervisor({ configuration, supervisorStatus, maximumNewCalls: max, startAt: start, endAt: end,
        studyDirectory: input.studyDirectory, runtimeRoot: root, freezeSha256: input.freezeSha256, manifestAt, auth: input.auth }, input.readPin);
      need(!identities.has(producer.producerIdentitySha256), "reused-producer-identity"); identities.add(producer.producerIdentitySha256);
      if (i === runs.length - 1) { need(join(input.studyDirectory, name) === input.finalBatch.path && input.comparison.path === join(input.studyDirectory, `comparison-${runId}.json`) && r.closureSha256 === input.finalBatch.sha256
        && record(b.result).status === "completed" && record(b.result).phase === "judge", "final-batch-complete"); same(b.comparisonArtifact, input.comparison, "final-comparison-pin"); }
      else need(b.comparisonArtifact === null && record(b.result).status === "paused" && b.stopReason === "call-limit", "earlier-comparison");
    }
    same(input.files.filter(p => p.startsWith("batch-") && p.endsWith(".json")).sort(), names.sort(), "complete-batch-file-set");
    return { producers: runs.length, metadataOnly: true };
  }
  async function verifyHistory(input: Readonly<{ closure: unknown; files: readonly string[]; read: GatewayArtifactRead; readPin: typeof pinned;
    studyDirectory: string; freezeSha256: string; freezeCreatedAt: string; importedSha256: string; priorGatewaySha256: string; priorContinuationSha256: string; finalBatch: Pin; comparison: Pin;
    ledgerRaw: Uint8Array; orderedKeys: readonly string[]; extractionCount: number; readerCases: number; judgeOwners: number; importedCount: number; auth: GatewayStudyAuth }>) {
    const c = record(input.closure); exact(c, ["schema", "createdAt", "freezeSha256", "inventorySha256", "finalBatchSha256", "verification", "allProducersClosed", "runs"]);
    need(c.schema === "oh.gateway-final-supervisor-closure.v5" && c.freezeSha256 === input.freezeSha256 && c.finalBatchSha256 === input.finalBatch.sha256
      && c.verification === "owner-verified-complete-producer-inventory" && c.allProducersClosed === true, "external-owner-closure");
    const manifestAt = time(c.createdAt), runs = array(c.runs, 4096); need(runs.length > 0, "empty-history");
    const pins: Pin[] = [], names: string[] = [], seen = new Set<string>(), producerPins = new Set<string>(), producerIdentities = new Set<string>(); let previousEnd = time(input.freezeCreatedAt), frontier = 0, previousLedgerBytes = 0, previousExposure = 0, previousEventCount = 0;
    const history = [];
    for (const [index, value] of runs.entries()) { const r = record(value); exact(r, ["runId", "admissionSha256", "closureSha256", "configuration", "supervisorStatus", "groupGone", "runnerExitCode", "newTransportInvocations"]);
      const runId = string(r.runId); need(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId) && !seen.has(runId), "run-id"); seen.add(runId);
      need(r.groupGone === true && r.runnerExitCode === 0, "producer-not-closed-successfully");
      const name = `batch-${runId}.json`, admissionName = `batch-${runId}-started.json`; names.push(name, admissionName);
      const raw = await input.read(name, M), b = record(json(raw)); need(sha256Hex(raw) === hash(r.closureSha256), "batch-pin");
      exact(b, ["protocol", "runId", "freezeSha256", "sourceSha256", "importedStudySha256", "start", "end", "admission", "maximumNewCalls", "concurrency", "newTransportInvocations", "admittedKeys", "initialJobKeys", "finalJobKeys", "failed", "storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose", "priorGatewayVerifiedAtClose", "priorGatewayStudySha256", "priorContinuationVerifiedAtClose", "priorContinuationStudySha256", "interrupted", "stopReason", "qualified", "ledger", "comparisonArtifact", "result"]);
      const start = time(b.start), end = time(b.end), max = integer(b.maximumNewCalls, 256), calls = integer(b.newTransportInvocations, 256), before = frontier;
      need(max > 0 && calls <= max && b.runId === runId && b.protocol === BATCH && b.freezeSha256 === input.freezeSha256 && b.sourceSha256 === sourceSha256
        && b.importedStudySha256 === input.importedSha256 && b.concurrency === 4 && calls === r.newTransportInvocations && b.failed === false
        && b.storeClosed === true && b.sourceVerifiedAtClose === true && b.importVerifiedAtClose === true && b.originalLedgerVerifiedAtClose === true
        && b.priorGatewayVerifiedAtClose === true && b.priorGatewayStudySha256 === input.priorGatewaySha256 && b.priorContinuationStudySha256 === input.priorContinuationSha256 && b.priorContinuationVerifiedAtClose === true && b.interrupted === false && start >= previousEnd && end >= start && end <= manifestAt, "batch-custody-or-time"); previousEnd = end; frontier += calls;
      need(frontier <= input.orderedKeys.length, "frontier-overrun");
      same(b.admittedKeys, input.orderedKeys.slice(before, frontier), "admitted-native-order");
      same(b.initialJobKeys, input.orderedKeys.slice(0, before).sort(), "opening-complete-inventory"); same(b.finalJobKeys, input.orderedKeys.slice(0, frontier).sort(), "closing-complete-inventory");
      const aPin = pin(b.admission); same(aPin, { path: join(input.studyDirectory, admissionName), sha256: hash(r.admissionSha256) }, "admission-binding");
      const aRaw = await input.read(admissionName, 32768); need(sha256Hex(aRaw) === aPin.sha256, "admission-pin");
      const q = qualified(b.qualified, start, input.auth);
      same(json(aRaw), { protocol: "oh.memory-gateway-batch-admission.v5", runId, freezeSha256: input.freezeSha256, sourceSha256,
        importedStudySha256: input.importedSha256, start: b.start, maximumNewCalls: max, concurrency: 4,
        openingLedgerExposureMicros: previousExposure, priorGatewayExposureMicros: CARRIED, priorGatewayStudySha256: input.priorGatewaySha256, priorContinuationStudySha256: input.priorContinuationSha256, initialJobKeysSha256: canonicalSha256(b.initialJobKeys), qualified: q }, "native-admission");
      const configuration = pin(r.configuration), supervisorStatus = pin(r.supervisorStatus); pins.push(configuration, supervisorStatus);
      for (const p of [configuration, supervisorStatus]) for (const key of [p.path, p.sha256]) { need(!producerPins.has(key), "reused-producer-proof"); producerPins.add(key); }
      const producer = await verifyGatewayV5Supervisor({ configuration, supervisorStatus, maximumNewCalls: max, startAt: start, endAt: end,
        studyDirectory: input.studyDirectory, runtimeRoot: root, freezeSha256: input.freezeSha256, manifestAt, auth: input.auth }, input.readPin);
      need(!producerIdentities.has(producer.producerIdentitySha256), "reused-producer-identity"); producerIdentities.add(producer.producerIdentitySha256);
      const l = record(b.ledger); exact(l, ["path", "bytes", "sha256", "exposureMicros", "priorGatewayExposureMicros", "totalAmendmentExposureMicros", "budget"]); const bytes = integer(l.bytes, input.ledgerRaw.length);
      need(l.path === join(input.studyDirectory, "ledger.jsonl") && bytes >= previousLedgerBytes, "ledger-prefix-path"); const prefix = input.ledgerRaw.subarray(0, bytes);
      need(sha256Hex(prefix) === hash(l.sha256), "ledger-prefix-hash"); const events = parseLedger(prefix), exposure = transport.gatewayStudyLedgerExposure(events);
      need(l.exposureMicros === exposure && l.priorGatewayExposureMicros === CARRIED && l.totalAmendmentExposureMicros === CARRIED + exposure && events.length === frontier * 2, "ledger-prefix-coverage");
      same([...new Set(events.map(e => e.id))].sort(), input.orderedKeys.slice(0, frontier).sort(), "ledger-prefix-keys");
      verifyWaves(events.slice(previousEventCount), input.orderedKeys, input.extractionCount, input.readerCases); previousEventCount = events.length;
      const settledThisRun = events.filter(e => e.kind === "settled" && input.orderedKeys.slice(before, frontier).includes(e.id)).reduce((sum, e) => sum + e.micros, 0);
      same(l.budget, { capUsd: 40, maxCalls: max, reservedCalls: calls, historicalExposureUsd: 21.655385,
        priorAmendmentExposureUsd: (CARRIED + previousExposure) / 1_000_000, accountedUsd: (CARRIED + exposure) / 1_000_000,
        confirmedThisRunUsd: settledThisRun / 1_000_000, unresolvedThisRunUsd: 0, billedUsd: null }, "budget-summary");
      previousExposure = exposure; previousLedgerBytes = bytes;
      const total = input.orderedKeys.length, extract = input.extractionCount, readers = input.readerCases;
      const expected = frontier < extract ? { status: "paused", phase: "extract", resolved: frontier, required: extract, importedClaude: input.importedCount, importedGateway: 188 }
        : frontier < extract + readers ? { status: "paused", phase: "reader", resolved: frontier - extract, required: readers }
        : frontier < total ? { status: "paused", phase: "judge", resolved: frontier - extract - readers, required: input.judgeOwners }
        : { status: "completed", phase: "judge", resolved: readers, required: readers };
      same(b.result, expected, "native-phase-frontier");
      if (frontier < total) need(b.stopReason === "call-limit", "paused-reason");
      else need(b.stopReason === null && b.interrupted === false, "completed-stop-state");
      if (b.stopReason === "call-limit") need(calls === max, "call-limit-count");
      if (index === runs.length - 1) { need(frontier === total && join(input.studyDirectory, name) === input.finalBatch.path && input.comparison.path === join(input.studyDirectory, `comparison-${runId}.json`) && r.closureSha256 === input.finalBatch.sha256, "final-batch-complete"); same(b.comparisonArtifact, input.comparison, "final-comparison-pin"); }
      else need(frontier < total && b.comparisonArtifact === null, "earlier-comparison");
      history.push({ runId, closureSha256: r.closureSha256, admissionSha256: r.admissionSha256, newCalls: calls, ledgerBytes: bytes, exposureMicros: exposure, priorGatewayExposureMicros: CARRIED, totalAmendmentExposureMicros: CARRIED + exposure, configuration, supervisorStatus });
    }
    need(previousLedgerBytes === input.ledgerRaw.length, "unclosed-ledger-suffix"); same(input.files.filter(p => p.startsWith("batch-") && p.endsWith(".json")).sort(), names.sort(), "complete-batch-file-set");
    return { pins, history, total: frontier, exposureMicros: previousExposure };
  }
  async function audit(input: GatewayFinalAuditInput) {
    need(input.runtimeRoot === root && input.expectedSourceSha256 === sourceSha256 && Bun.version === "1.3.14", "runtime-binding");
    const directory = absolute(input.studyDirectory), pins = { freeze: pin(input.freeze), finalBatch: pin(input.finalBatch), comparison: pin(input.comparison), inventory: pin(input.inventory), supervisorClosure: pin(input.supervisorClosure) };
    need(pins.freeze.path === join(directory, "freeze.json") && dirname(pins.finalBatch.path) === directory && dirname(pins.comparison.path) === directory
      && !pins.inventory.path.startsWith(directory + "/") && !pins.supervisorClosure.path.startsWith(directory + "/"), "external-custody-paths");
    const closure = record(json(await pinned(pins.supervisorClosure, 8 * M)));
    need(closure.allProducersClosed === true && closure.verification === "owner-verified-complete-producer-inventory"
      && array(closure.runs, 4096).every(r => record(r).groupGone === true), "owner-closure-before-study-read");
    const files = inventory(json(await pinned(pins.inventory, 16 * M)), pins.freeze.sha256); need(closure.inventorySha256 === pins.inventory.sha256, "closure-inventory-binding");
    same(await gatewayClosedFileSet(directory), files.map(f => f.path), "closed-inventory"); const read = reader(directory, files);
    const rawFreeze = await read("freeze.json", 8 * M); need(sha256Hex(rawFreeze) === pins.freeze.sha256, "freeze-pin"); const freeze = continuation.parseGatewayStudyV5Freeze(json(rawFreeze));
    need(freeze.sourceSha256 === sourceSha256, "freeze-source"); same(await gatewayAuditorSourceIdentity(root), loadedSource, "source-before");
    const finalRaw = await read(relative(directory, pins.finalBatch.path), M); need(sha256Hex(finalRaw) === pins.finalBatch.sha256, "final-batch-pin"); const final = record(json(finalRaw));
    same(final.result, { status: "completed", phase: "judge", resolved: 360, required: 360 }, "full-final-required"); need(final.failed === false && final.storeClosed === true, "closed-final-required");
    const auth = await runner.readGatewayStudyAuth(freeze.authority);
    await verifyCustody({ closure, files: files.map(f => f.path), read, readPin: pinned, studyDirectory: directory, freezeSha256: pins.freeze.sha256,
      freezeCreatedAt: freeze.createdAt, importedSha256: freeze.importedStudy.sha256, priorGatewaySha256: freeze.priorGatewayStudy.sha256, priorContinuationSha256: freeze.priorContinuationStudy.sha256, finalBatch: pins.finalBatch, comparison: pins.comparison, auth });
    same(await runner.verifyGatewayStudyAuthority(freeze.authority), freeze.originalLedger, "authority-ledger-binding");
    need(freeze.inputs.selection.sha256 === SELECTION && freeze.inputs.legacy.sha256 === LEGACY && freeze.inputs.originalSourceSha256 === ORIGINAL && freeze.inputs.exclusions.length === 4, "original-fixed-inputs");
    const context = await continuation.loadGatewayStudyV5Context(freeze.importedStudy, freeze.priorGatewayStudy, freeze.priorContinuationStudy, freeze.authority);
    need(context.loaded.selection.document.sampleSize === 120 && context.loaded.selection.document.poolSize === 308 && canonicalSha256(context.loaded.selection.document.selected) === SELECTED
      && context.loaded.legacy.requiredChunks === 8413 && context.loaded.legacy.completedChunks === 2442 && context.loaded.legacy.missingChunks === 5971
      && context.imported.outcomes.size === 1051 && context.imported.summary.validCount === 1049 && context.imported.summary.invalidEnvelopeCount === 1
      && context.imported.summary.invalidRefusalFallbackCount === 1 && context.allExtractionJobs.length === 4920 && context.extractionJobs.length === 4732 && context.priorContinuation.rows.length === 184 && context.totalPriorGatewayExposureMicros === CARRIED
      && context.priorGateway.rows.length === 4 && context.priorGateway.summary.externalExposureMicros === ORIGINAL_GATEWAY_CARRY && context.priorGateway.freeze.sourceSha256 === PRIOR_SOURCE, "fixed-complete-ancestry");
    same(context.extractionJobs, context.allExtractionJobs.slice(188), "unchanged-new-extraction-suffix");
    same(context.imported.originalFreeze.inputs, freeze.inputs, "ancestral-inputs"); same(continuation.gatewayStudyV5Identity(context), freeze.study, "frozen-study"); same(continuation.gatewayStudyV5Procedure(context.judge.sha256, auth), freeze.procedure, "frozen-procedure");
    same(context.priorGateway.freeze.study, context.originalGatewayIdentity, "original-gateway-study");
    const priorInventory = record(json(await pinned(context.priorGateway.manifest.inventory, M)));
    const priorFiles = array(priorInventory.files, 64).map(v => { const f = record(v); exact(f, ["path", "bytes", "sha256"]); return { path: rel(f.path), bytes: integer(f.bytes, 8 * M), sha256: hash(f.sha256) }; });
    const priorRead = reader(context.priorGateway.manifest.studyDirectory, priorFiles);
    const priorClosure = record(json(await pinned(context.priorGateway.manifest.supervisorClosure, M))), priorRun = record(at(array(priorClosure.runs, 1), 0));
    need(time(context.priorGateway.manifest.createdAt) <= time(freeze.createdAt), "prior-manifest-before-freeze");
    need(context.priorGateway.manifest.studyDirectory !== directory && !context.priorGateway.manifest.studyDirectory.startsWith(directory + "/") && !directory.startsWith(context.priorGateway.manifest.studyDirectory + "/"), "distinct-prior-study");
    same(context.priorGateway.manifest.jobs, context.allExtractionJobs.slice(0, 4).map(j => ({ key: j.key, ordinal: j.ordinal, requestSha256: j.request.requestSha256 })), "exact-prior-four-prefix");
    const priorReplay = await verifyPriorResponses({ jobs: context.allExtractionJobs, prior: context.priorGateway, freezeSha256: context.priorGateway.manifest.freeze.sha256,
      sourceSha256: PRIOR_SOURCE, runId: string(priorRun.runId), ledgerRaw: await priorRead("ledger.jsonl", 32768), read: priorRead });
    need(priorReplay.externalExposureMicros === ORIGINAL_GATEWAY_CARRY, "fixed-prior-exposure");
    const continuationInventory = record(json(await pinned(context.priorContinuation.manifest.inventory, M)));
    const continuationFiles = array(continuationInventory.files, 2048).map(v => { const f = record(v); exact(f, ["path", "bytes", "sha256"]); return { path: rel(f.path), bytes: integer(f.bytes, 8 * M), sha256: hash(f.sha256) }; });
    const continuationRead = reader(context.priorContinuation.manifest.studyDirectory, continuationFiles);
    const continuationClosure = record(json(await pinned(context.priorContinuation.manifest.supervisorClosure, M)));
    const continuationRuns = array(continuationClosure.runs, 2).map(record); need(continuationRuns.length === 2, "continuation-two-producers");
    need(time(context.priorContinuation.manifest.createdAt) <= time(freeze.createdAt) && context.priorContinuation.summary.externalExposureMicros === 687407
      && context.priorContinuation.freeze.sourceSha256 === "adaa4eb6585465908fa61cf7fa3d5c0bb764fa240210f071ea0176e4f5985f6f", "continuation-frozen-scope");
    const continuationReplay = await verifyContinuationResponses({ jobs: context.allContinuationJobs, prior: context.priorContinuation,
      freezeSha256: context.priorContinuation.manifest.freeze.sha256, sourceSha256: context.priorContinuation.freeze.sourceSha256,
      runIds: continuationRuns.map(r => string(r.runId)), firstBatchCount: 32, truncatedKey: context.priorContinuation.manifest.truncatedJobKey,
      ledgerRaw: await continuationRead("ledger.jsonl", 8 * M), read: continuationRead });
    need(continuationReplay.externalExposureMicros + priorReplay.externalExposureMicros === CARRIED && continuationReplay.importedCount === 184, "complete-continuation-carry");
    const preparation = record(json(await read("preparation.json", 8 * M))), preparedSource = record(preparation.source);
    exact(preparation, ["source", "noModelCalls", "imported", "priorGateway", "priorContinuation", "originalLedger", "maximumTotalAmendmentExposureMicros"]);
    need(preparation.noModelCalls === true && preparation.maximumTotalAmendmentExposureMicros === 40_000_000 && preparedSource.sourceSha256 === sourceSha256 && preparedSource.bun === "1.3.14" && preparedSource.dirty === false, "preparation-source");
    same(preparedSource.files, loadedSource.files, "preparation-source-files"); same(preparation.imported, context.imported.summary, "preparation-import"); same(preparation.priorGateway, context.priorGateway.summary, "preparation-prior-gateway"); same(preparation.originalLedger, freeze.originalLedger, "preparation-ledger"); same(preparation.priorContinuation, context.priorContinuation.summary, "preparation-prior-continuation");
    same(json(await read("store.json", 2048)), { protocol: STORE, freezeSha256: pins.freeze.sha256 }, "store-header");
    const comparisonRaw = await read(relative(directory, pins.comparison.path), 128 * M); need(sha256Hex(comparisonRaw) === pins.comparison.sha256, "comparison-pin");
    const jobKeys = [...new Set(files.filter(f => f.path.startsWith("jobs/")).map(f => { const parts = f.path.split("/"); need(parts.length === 3, "job-file"); return hash(parts[1]); }))].sort();
    const ledgerRaw = await read("ledger.jsonl", 8 * M), result = await reconstruct({ loaded: { corpora: context.loaded.selection.dataset.corpora,
      questions: context.loaded.selection.dataset.questions, originalJobs: context.loaded.extractionJobs, legacy: context.loaded.legacy,
      imported: context.imported.outcomes, importedSummary: context.imported.summary, priorGateway: context.priorGateway, priorContinuation: context.priorContinuation, selection: context.loaded.selection.document },
      freezeSha256: pins.freeze.sha256, study: freeze.study, procedure: freeze.procedure, comparison: json(comparisonRaw), jobKeys, ledgerRaw, read, profile: context.judge });
    const history = await verifyHistory({ closure, files: files.map(f => f.path), read, readPin: pinned, studyDirectory: directory, freezeSha256: pins.freeze.sha256,
      freezeCreatedAt: freeze.createdAt, importedSha256: freeze.importedStudy.sha256, priorGatewaySha256: freeze.priorGatewayStudy.sha256, priorContinuationSha256: freeze.priorContinuationStudy.sha256, finalBatch: pins.finalBatch, comparison: pins.comparison,
      ledgerRaw, orderedKeys: result.orderedKeys, extractionCount: result.extractionCount, readerCases: result.readerCases, judgeOwners: result.judgeOwners, importedCount: result.importedCount, auth });
    const expectedFiles = ["freeze.json", "preparation.json", "store.json", "ledger.jsonl", relative(directory, pins.comparison.path),
      ...history.history.flatMap(r => [`batch-${r.runId}.json`, `batch-${r.runId}-started.json`]),
      ...result.orderedKeys.flatMap(key => ["pending.json", "reserved.json", "response.body", "response.json", "result.json", "settled.json"].map(name => `jobs/${key}/${name}`))].sort();
    same(files.map(f => f.path), expectedFiles, "exact-final-file-set");
    const after = await continuation.loadGatewayStudyV5Context(freeze.importedStudy, freeze.priorGatewayStudy, freeze.priorContinuationStudy, freeze.authority); same(after.imported.summary, context.imported.summary, "ancestry-after");
    same(after.priorGateway, context.priorGateway, "prior-gateway-after"); same(after.priorContinuation, context.priorContinuation, "prior-continuation-after");
    await runner.verifyGatewayHistoricalLedger(freeze.originalLedger); same(await runner.verifyGatewayStudyAuthority(freeze.authority), freeze.originalLedger, "authority-after");
    for (const file of files) await read(file.path, 128 * M); same(await gatewayClosedFileSet(directory), files.map(f => f.path), "inventory-after");
    for (const p of [...Object.values(pins), ...history.pins, ...context.priorGateway.evidencePins, ...context.priorContinuation.evidencePins, freeze.priorContinuationStudy, freeze.authority, freeze.importedStudy, freeze.priorGatewayStudy, freeze.inputs.selection, freeze.inputs.legacy, ...freeze.inputs.exclusions]) await pinned(p, 128 * M);
    need((await judges.loadJudgeProfile()).sha256 === context.judge.sha256, "judge-profile-after"); same(await gatewayAuditorSourceIdentity(root), loadedSource, "source-after");
    const { orderedKeys: _keys, allJobs: _jobs, events: _events, ...safe } = result;
    return { schema: "oh.gateway-final-audit.v5", status: "accepted", sourceSha256, sourceFiles: loadedSource.files.length, ...safe,
      importedAudit: context.imported.summary, priorGatewayAudit: context.priorGateway.summary, priorGatewayReplay: priorReplay, priorContinuationAudit: context.priorContinuation.summary, priorContinuationReplay: continuationReplay,
      historicalLedger: freeze.originalLedger, priorGatewayLedger: context.priorGateway.ledgerPin, priorContinuationLedger: context.priorContinuation.ledgerPin, newLedgerExposureMicros: history.exposureMicros,
      totalAmendmentExposureMicros: CARRIED + history.exposureMicros,
      batchCount: history.history.length, batchHistorySha256: canonicalSha256(history.history), inventoryFiles: files.length,
      pins: Object.fromEntries(Object.entries(pins).map(([name, p]) => [name, p.sha256])),
      qualifications: ["Complete producer discovery and quiescence are separately verified owner inputs; hashes and absent locks do not establish them.",
        "All earlier first responses are retained once; original API/Claude and Gateway v3/v4 studies remain incomplete. Refusal fallback text never becomes memory.",
        "Post-start outcome-blind mixed-extractor/provider amendment; no unchanged confirmatory error control, guaranteed accuracy lower bound or official leaderboard claim.",
        "Gateway family aliases have recorded routing identities; snapshots are not pinned and physical attempt counts remain unknown.",
        "Native recorded usage/exposure estimates are not billed dollars. Every new ledger prefix plus809209micros of unchanged prior Gateway reservations remains at or below40USD."],
      modelCalls: 0, credentialCalls: 0, studyWrites: 0, originalLedgerUnchanged: true, priorGatewayLedgerUnchanged: true, priorContinuationLedgerUnchanged: true };
  }
  return { audit, reconstruct, verifyHistory, verifyCustody, verifyContexts, parseLedger, readResponse, verifyPriorResponses, verifyContinuationResponses, verifyWaves };
}
export async function auditGatewayStudyV5Final(input: GatewayFinalAuditInput) { return (await createGatewayV5Auditor(input.runtimeRoot, input.expectedSourceSha256)).audit(input); }
if (import.meta.main) {
  const emit = console.log.bind(console); let networkCalls = 0, spawnCalls = 0, suppressedLogs = 0;
  for (const key of ["log", "warn", "error", "info", "debug"] as const) console[key] = () => { suppressedLogs++; };
  globalThis.fetch = Object.assign(async () => { networkCalls++; throw new GatewayFinalAuditFailure("network-forbidden"); }, { preconnect: () => { networkCalls++; throw new GatewayFinalAuditFailure("network-forbidden"); } }) as typeof fetch;
  Bun.spawn = (() => { spawnCalls++; throw new GatewayFinalAuditFailure("spawn-forbidden"); }) as typeof Bun.spawn;
  Bun.spawnSync = (() => { spawnCalls++; throw new GatewayFinalAuditFailure("spawn-forbidden"); }) as typeof Bun.spawnSync;
  try { const [p, ...rest] = process.argv.slice(2); need(p && rest.length === 0, "one-input-path-required"); const v = record(json(await readFile(absolute(p), 65536)));
    exact(v, ["runtimeRoot", "expectedSourceSha256", "studyDirectory", "freeze", "finalBatch", "comparison", "inventory", "supervisorClosure"]);
    const result = await auditGatewayStudyV5Final({ runtimeRoot: absolute(v.runtimeRoot), expectedSourceSha256: hash(v.expectedSourceSha256), studyDirectory: absolute(v.studyDirectory),
      freeze: pin(v.freeze), finalBatch: pin(v.finalBatch), comparison: pin(v.comparison), inventory: pin(v.inventory), supervisorClosure: pin(v.supervisorClosure) });
    need(networkCalls === 0 && spawnCalls === 0 && suppressedLogs === 0, "unexpected-side-channel"); emit(JSON.stringify({ ...result, networkCalls, spawnCalls, suppressedLogs }, null, 2));
  } catch (error) { emit(JSON.stringify({ schema: "oh.gateway-final-audit.v5", status: "rejected", category: error instanceof GatewayFinalAuditFailure ? error.category : "native-or-io-rejection", networkCalls, spawnCalls, suppressedLogs, semanticTextPrinted: false })); process.exitCode = 1; }
}
