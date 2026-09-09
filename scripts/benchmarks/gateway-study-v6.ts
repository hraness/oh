/** Separately frozen reader-failure scoring amendment; earlier stores and reservations remain immutable. */
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { claudeStudyInternals as shared } from "./claude-study";
import type { Question } from "./datasets";
import { codeIdentity } from "./io";
import { loadJudgeProfile } from "./judge";
import type { FamilyCase } from "./superiority";
import { readGatewayStudyAuth, verifyGatewayStudyAuthority, verifyGatewayHistoricalLedger, qualifyGatewayOIDC,
  settleGatewayWave, type GatewayStudyAuth } from "./gateway-study-v3";
import { parseGatewayStudyV5Freeze, gatewayStudyV5Identity, gatewayStudyV5Procedure } from "./gateway-study-v5";
import { loadGatewayStudyImportV6, parseGatewayStudyImportV6Manifest } from "./gateway-study-import-v6";
import { GatewayStudyBudget, gatewayStudyLedgerExposure, type GatewayStudyLedgerEvent } from "./gateway-study-transport-v3";
import { GATEWAY_READER_FAILURE_V6_POLICY, GATEWAY_READER_FAILURE_V6_POLICY_SHA256, invokeGatewayStudyV6,
  type GatewayStudyV6Result } from "./gateway-study-transport-v6";
import { gatewayReservation, readGatewayStudyFile, writeGatewayStudyJson } from "./gateway-study-store-v3";
import { openGatewayStudyV6Store } from "./gateway-study-store-v6";
import type { GatewayJob, GatewayReaderJob } from "./gateway-study-plan-v3";
import { completeGatewayV6Reader, completeGatewayV6Judge, makeGatewayV6JudgePlan, expandGatewayV6Judgments } from "./gateway-study-plan-v6";
import { assessGatewayV6Superiority } from "./gateway-study-assessment-v6";

export const GATEWAY_STUDY_V6_PROFILE = "oh.memory-gateway-study.v6" as const;
export const GATEWAY_V6_PRIOR_EXPOSURE_MICROS = 18_268_639;
export const GATEWAY_STUDY_V6_CONCURRENCY = 4;
const FREEZE = "oh.memory-gateway-freeze.v6", ADMISSION = "oh.memory-gateway-batch-admission.v6", BATCH = "oh.memory-gateway-batch.v6";
const OLD_FREEZE = "92fed47664b2907d4f47c3a7a247aa439222d70c850fc6a1f21e2c2afa87d97a";
const OLD_SOURCE = "896d7a9cc58a907d45c2db5276455eae57ab66f4e74cb1d91b14914ed2aed433";
const POLICY = "22d10f39368869e0e9b877658d57192c7b00e5abee77494854978851c6ec91f1";
type Pin = Readonly<{ path: string; sha256: string }>;
type OriginalLedger = Readonly<{ path: string; sha256: string; bytes: number; exposureMicros: number }>;
type ImportedReader = Readonly<{ job: GatewayReaderJob; response: GatewayStudyV6Result }>;
type Imported = Awaited<ReturnType<typeof loadGatewayStudyImportV6>>;
type Store = Awaited<ReturnType<typeof openGatewayStudyV6Store>>;
export type GatewayStudyV6Freeze = Readonly<{ protocol: typeof FREEZE; createdAt: string; sourceSha256: string; sourceGitHead: string;
  importedStudy: Pin; authority: Pin; originalLedger: OriginalLedger; inputs: ReturnType<typeof shared.parseFreeze>["inputs"];
  policySha256: string; priorAmendmentExposureMicros: number; procedure: Readonly<Record<string, unknown>>; study: Readonly<Record<string, unknown>> }>;
function fail(reason: string): never { throw new Error(`Gateway study v6: ${reason}.`); }
function json(raw: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
function record(value: unknown): Record<string, unknown> { if (!isPlainRecord(value)) fail("expected record"); return value; }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail("nonnegative integer required"); return value; }
function time(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("noncanonical time"); return value; }
function hashes(value: unknown): string[] { if (!Array.isArray(value) || value.length > 6000) fail("bounded key array required"); return value.map(shared.digest); }
function maxCalls(value: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > 256) fail("new calls must be 1..256"); return value; }
function assertPolicy() { if (GATEWAY_READER_FAILURE_V6_POLICY_SHA256 !== POLICY || canonicalSha256(GATEWAY_READER_FAILURE_V6_POLICY) !== POLICY) fail("reviewed policy changed"); }

export function parseGatewayStudyV6Freeze(value: unknown): GatewayStudyV6Freeze {
  const v = record(value);
  if (!hasExactKeys(v, ["protocol", "createdAt", "sourceSha256", "sourceGitHead", "importedStudy", "authority", "originalLedger", "inputs", "policySha256", "priorAmendmentExposureMicros", "procedure", "study"])
    || v.protocol !== FREEZE || v.policySha256 !== POLICY || v.priorAmendmentExposureMicros !== GATEWAY_V6_PRIOR_EXPOSURE_MICROS
    || typeof v.sourceGitHead !== "string" || !/^[a-f0-9]{40}$/.test(v.sourceGitHead)) fail("freeze shape or fixed policy");
  const inputs = record(v.inputs), ledger = record(v.originalLedger);
  if (!hasExactKeys(inputs, ["selection", "legacy", "exclusions", "originalSourceSha256"]) || !Array.isArray(inputs.exclusions)
    || inputs.exclusions.length < 1 || inputs.exclusions.length > 64 || !hasExactKeys(ledger, ["path", "sha256", "bytes", "exposureMicros"])) fail("input identity");
  assertPolicy();
  return { protocol: FREEZE, createdAt: time(v.createdAt), sourceSha256: shared.digest(v.sourceSha256), sourceGitHead: v.sourceGitHead,
    importedStudy: shared.pin(v.importedStudy), authority: shared.pin(v.authority),
    originalLedger: { path: shared.path(ledger.path), sha256: shared.digest(ledger.sha256), bytes: integer(ledger.bytes), exposureMicros: integer(ledger.exposureMicros) },
    inputs: { selection: shared.pin(inputs.selection), legacy: shared.pin(inputs.legacy), exclusions: inputs.exclusions.map(shared.pin), originalSourceSha256: shared.digest(inputs.originalSourceSha256) },
    policySha256: POLICY, priorAmendmentExposureMicros: GATEWAY_V6_PRIOR_EXPOSURE_MICROS, procedure: record(v.procedure), study: record(v.study) };
}

export function gatewayStudyV6Procedure(judgeSha256: string, auth: GatewayStudyAuth) {
  assertPolicy(); const prior = gatewayStudyV5Procedure(judgeSha256, auth);
  return { ...prior, profile: GATEWAY_STUDY_V6_PROFILE,
    amendment: { ...prior.amendment,
      fatal: "All unexpected identity, transport, request, source, custody, cost/usage and parser failures stop; only the explicit extraction policies and exact-cap reader terminal failure have a disposition; judge failures remain fatal" },
    readerFailure: { policy: GATEWAY_READER_FAILURE_V6_POLICY, policySha256: POLICY,
      importedGatewayV5Status: "blocked", firstResponses: "Retain all 5064 v5 attempted jobs and every settled final-wave sibling; dispatch only the 28 unattempted readers then ordinary judge owners",
      carryMicros: GATEWAY_V6_PRIOR_EXPOSURE_MICROS, oldLedgers: "Immutable; full unresolved reservation exposure carried once",
      timing: "Post-start amendment before correctness inspection; generation prompts, models, caps, sample and statistical criterion unchanged" },
    assessment: { ...prior.assessment, readerFailurePolicySha256: POLICY,
      scope: "Further post-start reader-failure scoring amendment; report primary criterion and adverse sensitivity separately; earlier studies remain incomplete and confirmatory error control is not preserved" } };
}

/** The import authenticates the exact blocked v5 source/freeze before deriving any expected ancestry. */
export async function loadGatewayStudyV6Context(importedStudy: Pin, authority: Pin) {
  assertPolicy();
  const manifest = parseGatewayStudyImportV6Manifest(json(await shared.verified(shared.pin(importedStudy), 8 * 1024 * 1024)));
  if (manifest.freeze.sha256 !== OLD_FREEZE) fail("unexpected v5 freeze");
  const old = parseGatewayStudyV5Freeze(json(await shared.verified(manifest.freeze, 8 * 1024 * 1024)));
  if (old.sourceSha256 !== OLD_SOURCE) fail("unexpected v5 source");
  shared.same(old.authority, shared.pin(authority), "inherited authority changed");
  const originalLedger = await verifyGatewayStudyAuthority(authority);
  shared.same(old.originalLedger, originalLedger, "inherited original ledger changed");
  const imported = await loadGatewayStudyImportV6({ manifest: importedStudy, expectedClaudeImportSha256: old.importedStudy.sha256,
    expectedPriorGatewayImportSha256: old.priorGatewayStudy.sha256, expectedPriorContinuationImportSha256: old.priorContinuationStudy.sha256,
    expectedOriginalLedger: originalLedger });
  shared.same(imported.freeze, old, "imported freeze changed");
  const c = imported.context;
  if (c.loaded.selection.document.sampleSize !== 120 || c.loaded.selection.document.selected.length !== 120
    || c.loaded.selection.dataset.questions.length !== 120 || c.loaded.legacy.parents.length !== 8413
    || c.imported.outcomes.size !== 1051 || c.priorGateway.rows.length !== 4 || c.priorContinuation.rows.length !== 184
    || c.extractionJobs.length !== 4732 || imported.extractionRows.length !== 4732
    || imported.summary.importedTransportInvocations !== 5064 || imported.summary.externalExposureMicros !== GATEWAY_V6_PRIOR_EXPOSURE_MICROS
    || imported.summary.importedReaderCount !== 332 || imported.summary.terminalReaderFailureCount !== 1 || imported.summary.policySha256 !== POLICY) fail("fixed study import counts or policy changed");
  gatewayV6RemainingReaderJobs(imported.readerJobs, imported.readerResults);
  return imported;
}

export function gatewayV6RemainingReaderJobs(jobs: readonly GatewayReaderJob[], imported: readonly ImportedReader[]) {
  if (jobs.length !== 360 || imported.length !== 332 || new Set(jobs.map(j => j.key)).size !== 360) fail("fixed reader partition counts");
  for (const [i, row] of imported.entries()) {
    const expected = jobs[i]!;
    shared.same(row.job, expected, "imported reader prefix job changed");
    if (expected.phase !== "reader" || expected.ordinal !== i || row.response.requestSha256 !== expected.request.requestSha256) fail("imported reader prefix response changed");
  }
  return jobs.slice(332);
}
function importedKeys(imported: Imported) {
  const keys = [...imported.context.extractionJobs.map(j => j.key), ...imported.readerResults.map(r => r.job.key)].sort();
  if (keys.length !== 5064 || new Set(keys).size !== 5064) fail("imported physical job inventory");
  return keys;
}
export function gatewayStudyV6Identity(imported: Imported) {
  const remaining = gatewayV6RemainingReaderJobs(imported.readerJobs, imported.readerResults);
  return { originalV5: gatewayStudyV5Identity(imported.context), importedV5: imported.summary,
    selectedFamilies: 120, extractionParents: 8413, importedExtractionCount: 4732, importedReaderCount: 332, remainingFirstReaderCalls: 28, readerCases: 360,
    importedJobKeysSha256: canonicalSha256(importedKeys(imported)), importedOriginsSha256: canonicalSha256(imported.origins),
    importedReaderResultsSha256: canonicalSha256(imported.readerResults), importedEvidencePinsSha256: canonicalSha256(imported.evidencePins),
    readerOrderSha256: canonicalSha256(imported.readerJobs.map(j => ({ key: j.key, ordinal: j.ordinal, requestSha256: j.request.requestSha256 }))),
    newReaderOrderSha256: canonicalSha256(remaining.map(j => ({ key: j.key, ordinal: j.ordinal, requestSha256: j.request.requestSha256 }))) };
}

/** Validates every prefix against the once-carried complete ancestral exposure. */
export function gatewayV6LedgerExposure(events: Parameters<typeof gatewayStudyLedgerExposure>[0], priorMicros: number) {
  const final = gatewayStudyLedgerExposure(events);
  if (priorMicros !== GATEWAY_V6_PRIOR_EXPOSURE_MICROS) fail("unexpected carried exposure");
  let running = priorMicros; const pending = new Map<string, number>();
  for (const item of events) {
    const e = item as GatewayStudyLedgerEvent;
    if (e.kind === "reserved") { running += e.micros; pending.set(e.id, e.micros); }
    else { running -= pending.get(e.id)! - e.micros; pending.delete(e.id); }
    if (running > 40_000_000) fail("combined amendment ledger prefix exceeds $40");
  }
  return final;
}
function assertSource(source: Awaited<ReturnType<typeof codeIdentity>>, expected?: GatewayStudyV6Freeze) {
  if (source.bun !== "1.3.14" || source.dirty || !/^[a-f0-9]{40}$/.test(source.gitHead)
    || expected !== undefined && (source.sourceSha256 !== expected.sourceSha256 || source.gitHead !== expected.sourceGitHead)) fail("clean committed frozen Bun 1.3.14 runtime required");
}
export async function prepareGatewayStudyV6(input: Readonly<{ directory: string; importedStudy: Pin; authority: Pin }>) {
  const directory = shared.path(input.directory), importedStudy = shared.pin(input.importedStudy), authority = shared.pin(input.authority);
  const source = await codeIdentity(); assertSource(source);
  const imported = await loadGatewayStudyV6Context(importedStudy, authority), originalLedger = await verifyGatewayStudyAuthority(authority);
  const freeze: GatewayStudyV6Freeze = { protocol: FREEZE, createdAt: new Date().toISOString(), sourceSha256: source.sourceSha256, sourceGitHead: source.gitHead,
    importedStudy, authority, originalLedger, inputs: imported.context.imported.originalFreeze.inputs, policySha256: POLICY,
    priorAmendmentExposureMicros: GATEWAY_V6_PRIOR_EXPOSURE_MICROS,
    procedure: gatewayStudyV6Procedure(imported.context.judge.sha256, await readGatewayStudyAuth(authority)), study: gatewayStudyV6Identity(imported) };
  parseGatewayStudyV6Freeze(freeze); assertSource(await codeIdentity(), freeze);
  await mkdir(directory, { mode: 0o700 });
  await writeGatewayStudyJson(join(directory, "preparation.json"), { source, noModelCalls: true, importedV5: imported.summary,
    importedEvidencePins: imported.evidencePins, originalLedger, policySha256: POLICY, maximumTotalAmendmentExposureMicros: 40_000_000,
    priorAmendmentExposureMicros: GATEWAY_V6_PRIOR_EXPOSURE_MICROS });
  const pin = await writeGatewayStudyJson(join(directory, "freeze.json"), freeze);
  return { directory, freezeSha256: pin.sha256, sourceSha256: source.sourceSha256, sourceGitHead: source.gitHead, policySha256: POLICY,
    selectedFamilies: 120, extractionParents: 8413, importedPhysicalJobs: 5064, remainingFirstReaderCalls: 28, readerCases: 360,
    maxTotalAmendmentUsd: 40, carriedGatewayExposureUsd: GATEWAY_V6_PRIOR_EXPOSURE_MICROS / 1e6 };
}

/** A failed, interrupted, budget-paused or already-completed batch is never an ordinary continuation. */
export async function checkGatewayV6PriorBatches(directory: string, freezeSha256: string, freeze: GatewayStudyV6Freeze) {
  const names = (await readdir(directory)).filter(n => n.startsWith("batch-"));
  if (names.length > 2048) fail("too many prior batch files");
  for (const name of names) {
    if (!/^batch-[a-f0-9-]{36}(?:-started)?\.json$/.test(name)) fail("unexpected batch file");
    if (name.endsWith("-started.json") && !names.includes(name.replace("-started.json", ".json"))) fail("unclosed batch admission");
  }
  const closed = await Promise.all(names.filter(n => !n.endsWith("-started.json")).map(async name => ({ name,
    value: record(json(await readGatewayStudyFile(join(directory, name), 1024 * 1024))) })));
  closed.sort((a, b) => time(a.value.start).localeCompare(time(b.value.start)));
  let ledgerRaw: Uint8Array;
  try { ledgerRaw = await readGatewayStudyFile(join(directory, "ledger.jsonl"), 8 * 1024 * 1024); }
  catch (error) { if (closed.length !== 0 || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; ledgerRaw = new Uint8Array(); }
  if (closed.length === 0) {
    let jobs: string[];
    try { jobs = await readdir(join(directory, "jobs")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; jobs = []; }
    if (ledgerRaw.length !== 0 || jobs.length !== 0) fail("occupied store without native batch history");
  }
  let previousKeys: string[] = [], previousEnd = freeze.createdAt, previousExposure = 0, previousBytes = 0;
  for (const { name, value: c } of closed) {
    const admitted = hashes(c.admittedKeys), initial = hashes(c.initialJobKeys), final = hashes(c.finalJobKeys), ledger = record(c.ledger), result = record(c.result);
    const calls = integer(c.newTransportInvocations), maximum = maxCalls(integer(c.maximumNewCalls));
    if (c.protocol !== BATCH || c.runId !== name.slice(6, -5) || c.freezeSha256 !== freezeSha256 || c.sourceSha256 !== freeze.sourceSha256
      || c.sourceGitHead !== freeze.sourceGitHead || c.importedStudySha256 !== freeze.importedStudy.sha256 || c.policySha256 !== POLICY
      || c.priorAmendmentExposureMicros !== GATEWAY_V6_PRIOR_EXPOSURE_MICROS || c.importedJobKeysSha256 !== freeze.study.importedJobKeysSha256
      || c.failed !== false || c.interrupted !== false || c.stopReason !== "call-limit" || c.comparisonArtifact !== null
      || result.status !== "paused" || !["reader", "judge"].includes(String(result.phase)) || calls !== maximum || c.concurrency !== 4
      || admitted.length !== calls || new Set(admitted).size !== calls || new Set(final).size !== final.length
      || !["storeClosed", "sourceVerifiedAtClose", "importVerifiedAtClose", "originalLedgerVerifiedAtClose"].every(k => c[k] === true)
      || time(c.start) < previousEnd || time(c.end) < time(c.start)) fail("prior batch did not close for continuation");
    shared.same(initial, previousKeys, "prior key chain"); shared.same(final, [...initial, ...admitted].sort(), "prior admitted keys");
    if (admitted.some(k => initial.includes(k))) fail("repeated prior admission");
    const admission = shared.pin(c.admission);
    if (admission.path !== join(directory, name.replace(".json", "-started.json"))) fail("prior admission path");
    const a = record(json(await shared.verified(admission, 32768)));
    shared.same(a, { protocol: ADMISSION, runId: c.runId, freezeSha256, sourceSha256: freeze.sourceSha256, sourceGitHead: freeze.sourceGitHead,
      importedStudySha256: freeze.importedStudy.sha256, policySha256: POLICY, start: c.start, maximumNewCalls: maximum, concurrency: 4,
      openingLedgerExposureMicros: previousExposure, priorAmendmentExposureMicros: GATEWAY_V6_PRIOR_EXPOSURE_MICROS,
      initialJobKeysSha256: canonicalSha256(initial), importedJobKeysSha256: freeze.study.importedJobKeysSha256, qualified: c.qualified }, "prior admission binding");
    const bytes = integer(ledger.bytes);
    if (bytes < previousBytes || bytes > ledgerRaw.length || ledger.path !== join(directory, "ledger.jsonl") || sha256Hex(ledgerRaw.slice(0, bytes)) !== ledger.sha256) fail("prior ledger prefix");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(ledgerRaw.slice(0, bytes));
    if (!text.endsWith("\n")) fail("partial prior ledger");
    const events = text.slice(0, -1).split("\n").map(line => JSON.parse(line)), exposure = gatewayV6LedgerExposure(events, GATEWAY_V6_PRIOR_EXPOSURE_MICROS);
    if (ledger.exposureMicros !== exposure || ledger.priorAmendmentExposureMicros !== GATEWAY_V6_PRIOR_EXPOSURE_MICROS
      || ledger.totalAmendmentExposureMicros !== GATEWAY_V6_PRIOR_EXPOSURE_MICROS + exposure
      || events.length !== final.length * 2 || events.filter(e => e.kind === "settled").length !== final.length) fail("prior ledger closure");
    shared.same(events.filter(e => e.kind === "reserved").map(e => e.id).sort(), final, "prior ledger jobs");
    previousKeys = final; previousEnd = time(c.end); previousExposure = exposure; previousBytes = bytes;
  }
  if (ledgerRaw.length !== previousBytes) fail("unclosed ledger suffix");
  return { keys: previousKeys, ledgerBytes: ledgerRaw.length, ledgerSha256: sha256Hex(ledgerRaw), exposureMicros: previousExposure };
}
async function assertStoreFrontier(directory: string, store: Store, frontier: Awaited<ReturnType<typeof checkGatewayV6PriorBatches>>) {
  shared.same(store.keys(), frontier.keys, "opened store differs from native history keys");
  const raw = await readGatewayStudyFile(join(directory, "ledger.jsonl"), 8 * 1024 * 1024);
  if (raw.length !== frontier.ledgerBytes || sha256Hex(raw) !== frontier.ledgerSha256 || store.exposure !== frontier.exposureMicros) fail("opened store differs from native history ledger");
}

type ExecutionState = { phase: "reader" | "judge"; newTransportInvocations: number; admittedKeys: string[]; passedKeys: Set<string>;
  stopReason: "call-limit" | "budget" | "interrupted" | null; result: Record<string, unknown> };
type PhaseInput = Readonly<{ readerJobs: readonly GatewayReaderJob[]; importedReaderResults: readonly ImportedReader[]; importedJobKeys: readonly string[];
  questions: readonly Question[]; selected: readonly FamilyCase[]; poolSize: number; profile: Awaited<ReturnType<typeof loadJudgeProfile>>;
  maximumNewCalls: number; oidcToken: string; store: Store; budget: GatewayStudyBudget; state: ExecutionState;
  invoke: typeof invokeGatewayStudyV6; qualify: () => void; stopped: () => boolean; progress: (row: Record<string, unknown>) => void }>;
function newExecutionState(): ExecutionState { return { phase: "reader", newTransportInvocations: 0, admittedKeys: [], passedKeys: new Set(), stopReason: null,
  result: { status: "paused", phase: "reader", resolved: 332, required: 360, importedReaders: 332 } }; }

/** The production entry point supplies the fixed invoker. Synthetic tests replace only transport dependencies. */
async function executePhases(input: PhaseInput) {
  const { store, state } = input; maxCalls(input.maximumNewCalls);
  if (input.questions.length !== 120 || input.selected.length !== 120 || input.importedJobKeys.length !== 5064
    || new Set(input.importedJobKeys).size !== 5064) fail("fixed phase inventory");
  const remainingReaders = gatewayV6RemainingReaderJobs(input.readerJobs, input.importedReaderResults), forbidden = new Set(input.importedJobKeys);
  if (input.importedReaderResults.some(r => !forbidden.has(r.job.key)) || store.keys().some(k => forbidden.has(k))) fail("imported job cannot enter new store");
  async function execute<J extends GatewayJob, R>(jobs: readonly J[], complete: (job: J, response: GatewayStudyV6Result) => R, offset = 0) {
    if (jobs.some(j => forbidden.has(j.key))) fail("attempted imported job cannot dispatch");
    const rows: R[] = [], expected = new Set(jobs.map(j => j.key)); let cached = 0;
    for (const job of jobs) {
      const response = await store.lookup(job); if (response === null) break;
      rows.push(complete(job, response)); cached++; state.passedKeys.add(job.key);
    }
    if (rows.length < jobs.length) {
      const keys = new Set(store.keys());
      if (jobs.slice(rows.length).some(j => keys.has(j.key)) || [...keys].some(k => !state.passedKeys.has(k) && !expected.has(k))) fail("non-prefix or unexpected occupied job");
    }
    while (rows.length < jobs.length) {
      if (input.stopped()) { state.stopReason = "interrupted"; break; }
      const available = input.maximumNewCalls - state.newTransportInvocations;
      if (available <= 0) { state.stopReason = "call-limit"; break; }
      input.qualify();
      const remainingMicros = 40_000_000 - GATEWAY_V6_PRIOR_EXPOSURE_MICROS - gatewayV6LedgerExposure(store.events, GATEWAY_V6_PRIOR_EXPOSURE_MICROS);
      const wave: J[] = []; let reserved = 0;
      for (const job of jobs.slice(rows.length, rows.length + Math.min(4, available))) {
        const amount = gatewayReservation(job).micros; if (reserved + amount > remainingMicros) break;
        reserved += amount; wave.push(job);
      }
      if (wave.length === 0) { state.stopReason = "budget"; break; }
      const completed = await settleGatewayWave(wave, async job => {
        await store.begin(job); state.admittedKeys.push(job.key); state.newTransportInvocations++;
        const response = await input.invoke({ request: job.request, oidcToken: input.oidcToken, reservationId: job.key, budget: input.budget,
          record: e => store.record(job, e), capture: raw => store.capture(job, raw) });
        await store.complete(job, response); return complete(job, response);
      });
      for (const [i, row] of completed.entries()) { rows.push(row); state.passedKeys.add(wave[i]!.key); }
      input.progress({ phase: state.phase, resolved: offset + rows.length, required: offset + jobs.length, cached, imported: offset,
        newTransportInvocations: state.newTransportInvocations,
        amendmentExposureUsd: (GATEWAY_V6_PRIOR_EXPOSURE_MICROS + gatewayV6LedgerExposure(store.events, GATEWAY_V6_PRIOR_EXPOSURE_MICROS)) / 1e6 });
    }
    return { rows, complete: rows.length === jobs.length };
  }
  const importedReaders = input.importedReaderResults.map(r => completeGatewayV6Reader(r.job, input.questions[r.job.native.questionIndex]!, r.response));
  const readers = await execute(remainingReaders, (job, response) => completeGatewayV6Reader(job, input.questions[job.native.questionIndex]!, response), 332);
  state.result = { status: readers.complete ? "completed" : "paused", phase: "reader", resolved: 332 + readers.rows.length, required: 360, importedReaders: 332 };
  if (!readers.complete) return null;
  const allReaders = [...importedReaders, ...readers.rows]; state.phase = "judge";
  const planInput = { readerJobs: input.readerJobs, readerRows: allReaders, questions: input.questions, profile: input.profile };
  const plan = makeGatewayV6JudgePlan(planInput), judgments = await execute(plan.jobs, completeGatewayV6Judge);
  state.result = { status: judgments.complete ? "completed" : "paused", phase: "judge", resolved: judgments.rows.length, required: plan.jobs.length };
  if (!judgments.complete) return null;
  const scoredCases = expandGatewayV6Judgments(plan, judgments.rows), assessment = assessGatewayV6Superiority({ ...planInput,
    poolSize: input.poolSize, selected: input.selected, physicalJudgeRows: judgments.rows, caseOutcomes: scoredCases });
  if (scoredCases.length !== 360 || assessment.primary.status !== "completed" || assessment.adverse.status !== "completed") fail("full fixed scored matrix required");
  shared.same(store.keys(), [...state.passedKeys].sort(), "unexpected final stored jobs");
  state.result = { status: "completed", phase: "judge", resolved: 360, required: 360,
    modelJudgedCases: assessment.coverage.modelJudgedCases, policyScoredReaderFailures: assessment.coverage.policyScoredReaderFailures,
    physicalJudgeRequests: plan.jobs.length };
  return { readers: allReaders, scoredCases, physicalJudgeResults: judgments.rows, assessment };
}

export async function runGatewayStudyV6(input: Readonly<{ directory: string; freezeSha256: string; maximumNewCalls: number }>) {
  const directory = shared.path(input.directory), freezeSha256 = shared.digest(input.freezeSha256), maximum = maxCalls(input.maximumNewCalls);
  const freeze = parseGatewayStudyV6Freeze(json(await shared.verified({ path: join(directory, "freeze.json"), sha256: freezeSha256 }, 8 * 1024 * 1024)));
  assertSource(await codeIdentity(), freeze);
  const auth = await readGatewayStudyAuth(freeze.authority), oidcToken = process.env.VERCEL_OIDC_TOKEN ?? "", qualified = qualifyGatewayOIDC(oidcToken, auth);
  const imported = await loadGatewayStudyV6Context(freeze.importedStudy, freeze.authority), identity = gatewayStudyV6Identity(imported);
  shared.same(identity, freeze.study, "frozen study identity changed"); shared.same(imported.context.imported.originalFreeze.inputs, freeze.inputs, "frozen inputs changed");
  shared.same(gatewayStudyV6Procedure(imported.context.judge.sha256, auth), freeze.procedure, "frozen procedure changed");
  shared.same(await verifyGatewayStudyAuthority(freeze.authority), freeze.originalLedger, "frozen budget anchor changed");
  const frontier = await checkGatewayV6PriorBatches(directory, freezeSha256, freeze);
  const store = await openGatewayStudyV6Store(directory, freezeSha256), start = new Date().toISOString(), runId = randomUUID(), state = newExecutionState();
  const initialKeys = store.keys(), importedJobKeys = importedKeys(imported), importedJobKeysSha256 = canonicalSha256(importedJobKeys);
  let stopped = false, failed = false, failure: unknown, comparison: unknown, admission: Pin | undefined;
  let storeClosed = false, sourceVerifiedAtClose = false, importVerifiedAtClose = false, originalLedgerVerifiedAtClose = false;
  const stop = () => { stopped = true; }; process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const batchIdentity = { runId, freezeSha256, sourceSha256: freeze.sourceSha256, sourceGitHead: freeze.sourceGitHead,
    importedStudySha256: freeze.importedStudy.sha256, policySha256: POLICY, priorAmendmentExposureMicros: GATEWAY_V6_PRIOR_EXPOSURE_MICROS, importedJobKeysSha256 };
  let budget: GatewayStudyBudget | undefined;
  try {
    await assertStoreFrontier(directory, store, frontier);
    budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: maximum,
      priorExposureMicros: GATEWAY_V6_PRIOR_EXPOSURE_MICROS + gatewayV6LedgerExposure(store.events, GATEWAY_V6_PRIOR_EXPOSURE_MICROS) });
    admission = await writeGatewayStudyJson(join(directory, `batch-${runId}-started.json`), { protocol: ADMISSION, ...batchIdentity, start,
      maximumNewCalls: maximum, concurrency: 4, openingLedgerExposureMicros: store.exposure, initialJobKeysSha256: canonicalSha256(initialKeys), qualified });
    const c = imported.context, completed = await executePhases({ readerJobs: imported.readerJobs, importedReaderResults: imported.readerResults,
      importedJobKeys, questions: c.loaded.selection.dataset.questions, selected: c.loaded.selection.document.selected,
      poolSize: c.loaded.selection.document.poolSize, profile: c.judge, maximumNewCalls: maximum, oidcToken, store, budget, state,
      invoke: invokeGatewayStudyV6, qualify: () => { qualifyGatewayOIDC(oidcToken, auth); }, stopped: () => stopped,
      progress: row => console.log(JSON.stringify(row)) });
    if (completed !== null) comparison = { protocol: GATEWAY_STUDY_V6_PROFILE, freezeSha256, study: freeze.study, procedure: freeze.procedure,
      originalStudiesStatus: "incomplete", importedGatewayV5Status: "blocked", importedV5: imported.summary,
      extraction: { imported: c.imported.summary, priorGateway: c.priorGateway.summary, priorContinuation: c.priorContinuation.summary, rows: imported.extractionRows }, ...completed };
  } catch (error) { failed = true; failure = error; }
  try { await store.close(); storeClosed = true; } catch (error) { failed = true; failure = error; }
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
  try {
    const after = await loadGatewayStudyV6Context(freeze.importedStudy, freeze.authority);
    shared.same(gatewayStudyV6Identity(after), identity, "complete import changed during batch");
    shared.same(after.extractionRows, imported.extractionRows, "imported extractions changed"); importVerifiedAtClose = true;
    await verifyGatewayHistoricalLedger(freeze.originalLedger); originalLedgerVerifiedAtClose = true;
    assertSource(await codeIdentity(), freeze);
    if ((await loadJudgeProfile()).sha256 !== imported.context.judge.sha256) fail("judge profile changed"); sourceVerifiedAtClose = true;
  } catch (error) { failed = true; failure = error; }
  if (admission === undefined || budget === undefined) throw new Error("Gateway v6 admission failed; preserved state requires review.", { cause: failure });
  const ledgerRaw = await readGatewayStudyFile(join(directory, "ledger.jsonl"), 8 * 1024 * 1024), exposure = gatewayV6LedgerExposure(store.events, GATEWAY_V6_PRIOR_EXPOSURE_MICROS);
  const comparisonArtifact = !failed && !stopped && comparison !== undefined ? await writeGatewayStudyJson(join(directory, `comparison-${runId}.json`), comparison) : null;
  const receipt = { protocol: BATCH, ...batchIdentity, start, end: new Date().toISOString(), admission, maximumNewCalls: maximum, concurrency: 4,
    newTransportInvocations: state.newTransportInvocations, admittedKeys: state.admittedKeys, initialJobKeys: initialKeys, finalJobKeys: store.keys(),
    failed, interrupted: stopped, stopReason: state.stopReason, storeClosed, sourceVerifiedAtClose, importVerifiedAtClose, originalLedgerVerifiedAtClose, qualified,
    ledger: { path: join(directory, "ledger.jsonl"), bytes: ledgerRaw.length, sha256: sha256Hex(ledgerRaw), exposureMicros: exposure,
      priorAmendmentExposureMicros: GATEWAY_V6_PRIOR_EXPOSURE_MICROS, totalAmendmentExposureMicros: GATEWAY_V6_PRIOR_EXPOSURE_MICROS + exposure, budget: budget.summary },
    comparisonArtifact, result: failed ? { status: "blocked", phase: state.phase, reason: "Preserved first-response evidence requires review; no retry." } : state.result };
  await writeGatewayStudyJson(join(directory, `batch-${runId}.json`), receipt);
  if (failed) throw new Error("Gateway v6 stopped; all first-response evidence is preserved.", { cause: failure });
  return receipt;
}

export const gatewayStudyV6Internals = Object.freeze({ executePhases, newExecutionState, assertSource, assertStoreFrontier });
async function main(args: readonly string[]) {
  const [command, ...rest] = args;
  if (command === undefined || command === "--help") {
    console.log("Gateway memory study v6\nprepare --directory ABS --import-manifest ABS --import-sha256 SHA --authority ABS --authority-sha256 SHA\nrun --directory ABS --freeze-sha256 SHA --max-new-calls 1..256\n\nSeparately reviewed reader-failure scoring amendment. Retain every first response; no retries or extraction dispatch. Hard $40 total amendment cap includes $18.268639 carried exposure. Fixed project OIDC, models, prompts, output caps, sample and four-request drained waves."); return;
  }
  const allowed = command === "prepare" ? ["directory", "import-manifest", "import-sha256", "authority", "authority-sha256"]
    : command === "run" ? ["directory", "freeze-sha256", "max-new-calls"] : fail("unknown command");
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1], name = flag?.slice(2);
    if (!flag?.startsWith("--") || !name || !allowed.includes(name) || !value || values.has(name)) fail("invalid command arguments"); values.set(name, value);
  }
  const one = (key: string) => values.get(key) ?? fail("missing command argument");
  if (command === "prepare") console.log(JSON.stringify(await prepareGatewayStudyV6({ directory: one("directory"),
    importedStudy: { path: one("import-manifest"), sha256: one("import-sha256") }, authority: { path: one("authority"), sha256: one("authority-sha256") } })));
  else console.log(JSON.stringify(await runGatewayStudyV6({ directory: one("directory"), freezeSha256: one("freeze-sha256"), maximumNewCalls: Number(one("max-new-calls")) })));
}
if (import.meta.main) { try { await main(process.argv.slice(2)); } catch { console.error("Gateway v6 stopped. Inspect preserved evidence; no automatic retry."); process.exitCode = 1; } }
