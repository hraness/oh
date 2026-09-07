/** Separately frozen alias-metadata parser correction; imports all four closed Gateway first responses without replaying network calls. */
import { gatewayStudyProcedure, gatewayStudyIdentity, loadGatewayStudyContext, readGatewayStudyAuth,
  verifyGatewayStudyAuthority, verifyGatewayHistoricalLedger, qualifyGatewayOIDC, settleGatewayWave,
  type GatewayStudyAuth } from "./gateway-study-v3";
import { loadGatewayStudyImportV4 } from "./gateway-study-import-v4";
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { claudeStudyInternals as shared } from "./claude-study";
import { loadClaudeStudyImportV3 } from "./claude-study-import-v3";
import { codeIdentity } from "./io";
import { loadJudgeProfile } from "./judge";
import { assessSuperiority } from "./superiority";
import { GatewayStudyBudget, gatewayStudyLedgerExposure, invokeGatewayStudy,
  type GatewayStudyResult, type GatewayStudyLedgerEvent } from "./gateway-study-transport-v3";
import { openGatewayStudyStore, gatewayReservation, readGatewayStudyFile, writeGatewayStudyJson } from "./gateway-study-store-v3";
import { makeGatewayReaderJobs, makeGatewayJudgePlan,
  completeGatewayExtraction, completeGatewayReader, completeGatewayJudge, expandGatewayJudgments, gatewayStudyMemory,
  type GatewayJob, type GatewayExtractionJob, type GatewayExtractionRow } from "./gateway-study-plan-v3";

export const GATEWAY_STUDY_V4_PROFILE = "oh.memory-gateway-study.v4" as const;
const FREEZE = "oh.memory-gateway-freeze.v4" as const;
const BATCH = "oh.memory-gateway-batch.v4" as const;
const ADMISSION = "oh.memory-gateway-batch-admission.v4" as const;
export const GATEWAY_STUDY_CONCURRENCY = 4;
type Pin = Readonly<{ path: string; sha256: string }>;
type Inputs = ReturnType<typeof shared.parseFreeze>["inputs"];
type OriginalLedger = Readonly<{ path: string; sha256: string; bytes: number; exposureMicros: number }>;
export type GatewayStudyV4Freeze = Readonly<{ protocol: typeof FREEZE; createdAt: string; sourceSha256: string;
  importedStudy: Pin; priorGatewayStudy: Pin; authority: Pin; originalLedger: OriginalLedger; inputs: Inputs;
  procedure: Readonly<Record<string, unknown>>; study: Readonly<Record<string, unknown>> }>;
function fail(reason: string): never { throw new Error(`Gateway study v4: ${reason}.`); }
function json(raw: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
function record(value: unknown): Record<string, unknown> { if (!isPlainRecord(value)) fail("expected record"); return value; }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail("expected nonnegative integer"); return value; }
function time(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("noncanonical timestamp"); return value; }

export function gatewayStudyV4Procedure(judgeSha256: string, auth: GatewayStudyAuth) {
  return { ...gatewayStudyProcedure(judgeSha256, auth), profile: GATEWAY_STUDY_V4_PROFILE,
    priorGateway: { correction: "Accept corroborated alias-only Gateway routing without inventing an unreported snapshot",
      import: "Replay every captured first response under the corrected parser; never resubmit an attempted parent",
      budget: "Carry the immutable earlier Gateway ledger's complete unresolved reservation exposure within the same $40 cap",
      originalStudyStatus: "incomplete", timing: "Recorded parser correction after four transports, before correctness inspection" } };
}

export function parseGatewayStudyV4Freeze(value: unknown): GatewayStudyV4Freeze {
  const v = record(value);
  if (!hasExactKeys(v, ["protocol", "createdAt", "sourceSha256", "importedStudy", "priorGatewayStudy", "authority", "originalLedger", "inputs", "procedure", "study"])
    || v.protocol !== FREEZE) fail("freeze shape");
  const inputs = record(v.inputs), ledger = record(v.originalLedger);
  if (!hasExactKeys(inputs, ["selection", "legacy", "exclusions", "originalSourceSha256"]) || !Array.isArray(inputs.exclusions)
    || inputs.exclusions.length < 1 || inputs.exclusions.length > 64 || !hasExactKeys(ledger, ["path", "sha256", "bytes", "exposureMicros"])) fail("input identity");
  return { protocol: FREEZE, createdAt: time(v.createdAt), sourceSha256: shared.digest(v.sourceSha256),
    importedStudy: shared.pin(v.importedStudy), priorGatewayStudy: shared.pin(v.priorGatewayStudy), authority: shared.pin(v.authority),
    originalLedger: { path: shared.path(ledger.path), sha256: shared.digest(ledger.sha256), bytes: integer(ledger.bytes), exposureMicros: integer(ledger.exposureMicros) },
    inputs: { selection: shared.pin(inputs.selection), legacy: shared.pin(inputs.legacy), exclusions: inputs.exclusions.map(shared.pin), originalSourceSha256: shared.digest(inputs.originalSourceSha256) },
    procedure: record(v.procedure), study: record(v.study) };
}

/** Only the exact four imported parents may be removed from the original fixed Gateway plan. */
export function gatewayV4RemainingExtractionJobs(allJobs: readonly GatewayExtractionJob[], priorRows: readonly GatewayExtractionRow[]) {
  if (allJobs.length !== 4920 || priorRows.length !== 4 || new Set(allJobs.map(job => job.key)).size !== allJobs.length
    || new Set(allJobs.map(job => job.original.key)).size !== allJobs.length
    || new Set(allJobs.map(job => job.ordinal)).size !== allJobs.length) fail("fixed Gateway partition counts");
  for (let i = 0; i < priorRows.length; i++) {
    const job = allJobs[i]!, row = priorRows[i]!;
    shared.same({ key: row.jobKey, originalKey: row.originalJobKey, ordinal: row.ordinal, requestSha256: row.requestSha256 },
      { key: job.key, originalKey: job.original.key, ordinal: job.ordinal, requestSha256: job.request.requestSha256 }, "imported Gateway prefix binding");
  }
  return allJobs.slice(4);
}

export async function loadGatewayStudyV4Context(importedStudy: Pin, priorGatewayStudy: Pin, authority: Pin) {
  const originalLedger = await verifyGatewayStudyAuthority(authority), base = await loadGatewayStudyContext(importedStudy);
  const priorGateway = await loadGatewayStudyImportV4({ manifest: priorGatewayStudy, jobs: base.extractionJobs,
    expectedClaudeImportSha256: importedStudy.sha256, expectedOriginalLedger: originalLedger });
  return { ...base, priorGateway, originalGatewayIdentity: gatewayStudyIdentity(base), allExtractionJobs: base.extractionJobs,
    extractionJobs: gatewayV4RemainingExtractionJobs(base.extractionJobs, priorGateway.rows) };
}
export function gatewayStudyV4Identity(context: Awaited<ReturnType<typeof loadGatewayStudyV4Context>>) {
  return { ...context.originalGatewayIdentity, priorGateway: context.priorGateway.summary,
    remainingFirstExtractionCalls: context.extractionJobs.length,
    newExtractionOrderSha256: canonicalSha256(context.extractionJobs.map(job => ({ key: job.key, ordinal: job.ordinal,
      originalJobKey: job.original.key, requestSha256: job.request.requestSha256 }))) };
}
/** The old Gateway ledger remains immutable; its reserved exposure is included at every new-ledger prefix. */
export function gatewayV4LedgerExposure(events: Parameters<typeof gatewayStudyLedgerExposure>[0], externalMicros: number) {
  const final = gatewayStudyLedgerExposure(events);
  if (externalMicros !== 121802) fail("unexpected carried Gateway exposure");
  let running = externalMicros; const pending = new Map<string, number>();
  for (const item of events) {
    const event = item as GatewayStudyLedgerEvent; // The native validator above accepted every event shape and pairing.
    if (event.kind === "reserved") { running += event.micros; pending.set(event.id, event.micros); }
    else { running -= pending.get(event.id)! - event.micros; pending.delete(event.id); }
    if (running > 40_000_000) fail("combined amendment ledger prefix exceeds $40");
  }
  return final;
}

export async function prepareGatewayStudyV4(input: Readonly<{ directory: string; importedStudy: Pin; priorGatewayStudy: Pin; authority: Pin }>) {
  const directory = shared.path(input.directory), importedStudy = shared.pin(input.importedStudy), authority = shared.pin(input.authority), priorGatewayStudy = shared.pin(input.priorGatewayStudy);
  const context = await loadGatewayStudyV4Context(importedStudy, priorGatewayStudy, authority), originalLedger = await verifyGatewayStudyAuthority(authority), source = await codeIdentity();
  if (source.bun !== "1.3.14" || source.dirty) fail("prepare requires a clean committed Bun 1.3.14 runtime");
  if (context.imported.summary.importedTransportInvocations !== 1051 || context.extractionJobs.length !== 4916 || context.priorGateway.rows.length !== 4 || context.priorGateway.summary.externalExposureMicros !== 121802
    || context.loaded.selection.document.sampleSize !== 120) fail("approved fixed-study counts changed");
  const freeze: GatewayStudyV4Freeze = { protocol: FREEZE, createdAt: new Date().toISOString(), sourceSha256: source.sourceSha256,
    importedStudy, priorGatewayStudy, authority, originalLedger, inputs: context.imported.originalFreeze.inputs,
    procedure: gatewayStudyV4Procedure(context.judge.sha256, await readGatewayStudyAuth(authority)), study: gatewayStudyV4Identity(context) };
  parseGatewayStudyV4Freeze(freeze);
  if ((await codeIdentity()).sourceSha256 !== source.sourceSha256) fail("source changed during preparation");
  await mkdir(directory, { mode: 0o700 });
  await writeGatewayStudyJson(join(directory, "preparation.json"), { source, noModelCalls: true,
    imported: context.imported.summary, priorGateway: context.priorGateway.summary, originalLedger, maximumTotalAmendmentExposureMicros: 40_000_000 });
  const pin = await writeGatewayStudyJson(join(directory, "freeze.json"), freeze);
  return { directory, freezeSha256: pin.sha256, sourceSha256: source.sourceSha256, selectedFamilies: 120,
    importedClaudeFirstResponses: 1051, importedGatewayFirstResponses: 4, remainingFirstExtractionCalls: 4916, readerCases: 360, maxTotalAmendmentUsd: 40, carriedGatewayExposureUsd: 0.121802 };
}

export async function checkGatewayV4PriorBatches(directory: string, freezeSha256: string, sourceSha256: string, importedSha256: string, priorGatewaySha256: string) {
  const names = (await readdir(directory)).filter(name => name.startsWith("batch-"));
  for (const name of names) {
    if (!/^batch-[a-f0-9-]{36}(?:-started)?\.json$/.test(name)) fail("unexpected batch file");
    if (name.endsWith("-started.json") && !names.includes(name.replace("-started.json", ".json"))) fail("unclosed batch admission");
    if (name.endsWith("-started.json")) continue;
    const c = record(json(await readGatewayStudyFile(join(directory, name), 1024 * 1024)));
    if (c.protocol !== BATCH || c.freezeSha256 !== freezeSha256 || c.sourceSha256 !== sourceSha256 || c.importedStudySha256 !== importedSha256
      || c.failed !== false || c.storeClosed !== true || c.sourceVerifiedAtClose !== true || c.importVerifiedAtClose !== true
      || c.originalLedgerVerifiedAtClose !== true || c.priorGatewayVerifiedAtClose !== true || c.priorGatewayStudySha256 !== priorGatewaySha256) fail("prior batch did not close successfully");
    const admission = shared.pin(c.admission);
    if (admission.path !== join(directory, name.replace(".json", "-started.json"))) fail("prior admission path");
    const a = record(json(await shared.verified(admission, 32768)));
    if (a.protocol !== ADMISSION || a.freezeSha256 !== freezeSha256 || a.runId !== c.runId || a.sourceSha256 !== sourceSha256
      || a.importedStudySha256 !== importedSha256 || a.priorGatewayStudySha256 !== priorGatewaySha256 || a.priorGatewayExposureMicros !== 121802 || a.maximumNewCalls !== c.maximumNewCalls || a.start !== c.start) fail("prior admission binding");
  }
}

export async function runGatewayStudyV4(input: Readonly<{ directory: string; freezeSha256: string; maximumNewCalls: number }>) {
  const directory = shared.path(input.directory), freezeSha256 = shared.digest(input.freezeSha256);
  if (!Number.isSafeInteger(input.maximumNewCalls) || input.maximumNewCalls < 1 || input.maximumNewCalls > 256) fail("new calls must be 1..256");
  const freeze = parseGatewayStudyV4Freeze(json(await shared.verified({ path: join(directory, "freeze.json"), sha256: freezeSha256 }, 8 * 1024 * 1024)));
  const source = await codeIdentity(); if (source.sourceSha256 !== freeze.sourceSha256 || source.bun !== "1.3.14") fail("frozen source changed");
  const auth = await readGatewayStudyAuth(freeze.authority);
  const oidcToken = process.env.VERCEL_OIDC_TOKEN ?? "", qualified = qualifyGatewayOIDC(oidcToken, auth);
  const context = await loadGatewayStudyV4Context(freeze.importedStudy, freeze.priorGatewayStudy, freeze.authority);
  shared.same(context.imported.originalFreeze.inputs, freeze.inputs, "frozen inputs changed");
  shared.same(gatewayStudyV4Identity(context), freeze.study, "frozen study identity changed");
  shared.same(gatewayStudyV4Procedure(context.judge.sha256, auth), freeze.procedure, "frozen procedure changed");
  shared.same(await verifyGatewayStudyAuthority(freeze.authority), freeze.originalLedger, "frozen budget anchor changed");
  await checkGatewayV4PriorBatches(directory, freezeSha256, freeze.sourceSha256, freeze.importedStudy.sha256, freeze.priorGatewayStudy.sha256);
  const store = await openGatewayStudyStore(directory, freezeSha256), start = new Date().toISOString(), runId = randomUUID();
  const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: input.maximumNewCalls, priorExposureMicros: context.priorGateway.summary.externalExposureMicros + gatewayV4LedgerExposure(store.events, context.priorGateway.summary.externalExposureMicros) });
  let stopped = false, newCalls = 0, phase = "extract", final: unknown, comparison: unknown, failure: unknown;
  let failed = false, stopReason: "call-limit" | "budget" | "interrupted" | null = null;
  const stop = () => { stopped = true; }; process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const initialKeys = store.keys(), passedKeys = new Set<string>(), admittedKeys: string[] = [];
  const admission = await writeGatewayStudyJson(join(directory, `batch-${runId}-started.json`), {
    protocol: ADMISSION, runId, freezeSha256, sourceSha256: freeze.sourceSha256, importedStudySha256: freeze.importedStudy.sha256,
    start, maximumNewCalls: input.maximumNewCalls, concurrency: GATEWAY_STUDY_CONCURRENCY,
    openingLedgerExposureMicros: store.exposure, priorGatewayExposureMicros: context.priorGateway.summary.externalExposureMicros, priorGatewayStudySha256: freeze.priorGatewayStudy.sha256, initialJobKeysSha256: canonicalSha256(initialKeys), qualified });
  async function execute<J extends GatewayJob, R>(jobs: readonly J[], complete: (job: J, result: GatewayStudyResult) => R) {
    const rows: R[] = [], expected = new Set(jobs.map(job => job.key)); let cached = 0;
    for (const job of jobs) {
      const result = await store.lookup(job); if (result === null) break;
      rows.push(complete(job, result)); cached++; passedKeys.add(job.key);
    }
    if (rows.length < jobs.length) {
      const keys = new Set(store.keys());
      if (jobs.slice(rows.length).some(job => keys.has(job.key)) || [...keys].some(key => !passedKeys.has(key) && !expected.has(key))) fail("non-prefix or unexpected occupied job");
    }
    while (rows.length < jobs.length) {
      if (stopped) { stopReason = "interrupted"; break; }
      const available = input.maximumNewCalls - newCalls;
      if (available <= 0) { stopReason = "call-limit"; break; }
      qualifyGatewayOIDC(oidcToken, auth);
      const remainingMicros = 40_000_000 - context.priorGateway.summary.externalExposureMicros - gatewayV4LedgerExposure(store.events, context.priorGateway.summary.externalExposureMicros), wave: J[] = [];
      let reserveMicros = 0;
      for (const job of jobs.slice(rows.length, rows.length + Math.min(GATEWAY_STUDY_CONCURRENCY, available))) {
        const amount = gatewayReservation(job).micros;
        if (reserveMicros + amount > remainingMicros) break;
        reserveMicros += amount; wave.push(job);
      }
      if (wave.length === 0) { stopReason = "budget"; break; }
      const results = await settleGatewayWave(wave, async job => {
        await store.begin(job); admittedKeys.push(job.key); newCalls++;
        const response = await invokeGatewayStudy({ request: job.request, oidcToken, reservationId: job.key, budget,
          record: event => store.record(job, event), capture: raw => store.capture(job, raw) });
        await store.complete(job, response); return complete(job, response);
      });
      for (let i = 0; i < results.length; i++) {
        rows.push(results[i]!); passedKeys.add(wave[i]!.key);
      }
      console.log(JSON.stringify({ phase, resolved: rows.length, required: jobs.length, cached, newTransportInvocations: newCalls,
        amendmentExposureUsd: (context.priorGateway.summary.externalExposureMicros + gatewayV4LedgerExposure(store.events, context.priorGateway.summary.externalExposureMicros)) / 1_000_000 }));
    }
    return { rows, complete: rows.length === jobs.length, cached };
  }
  try {
    const extracted = await execute(context.extractionJobs, completeGatewayExtraction);
    final = { status: extracted.complete ? "completed" : "paused", phase, resolved: extracted.rows.length,
      required: context.extractionJobs.length, importedClaude: context.imported.outcomes.size, importedGateway: context.priorGateway.rows.length };
    if (extracted.complete) {
      const memory = gatewayStudyMemory(context.loaded.legacy, context.imported.outcomes, [...context.priorGateway.rows, ...extracted.rows]);
      phase = "reader";
      const readerJobs = await makeGatewayReaderJobs({ ...context.loaded.selection.dataset, memory });
      const readers = await execute(readerJobs, (job, response) => {
        const q = context.loaded.selection.dataset.questions[job.native.questionIndex] ?? fail("reader question missing");
        return completeGatewayReader(job, q, response);
      });
      final = { status: readers.complete ? "completed" : "paused", phase, resolved: readers.rows.length, required: readerJobs.length };
      if (readers.complete) {
        phase = "judge";
        const plan = makeGatewayJudgePlan({ readerJobs, readerRows: readers.rows, questions: context.loaded.selection.dataset.questions, profile: context.judge });
        const judgments = await execute(plan.jobs, completeGatewayJudge);
        final = { status: judgments.complete ? "completed" : "paused", phase, resolved: judgments.rows.length, required: plan.jobs.length };
        if (judgments.complete) {
          const rows = expandGatewayJudgments(plan, judgments.rows);
          const assessment = assessSuperiority(context.loaded.selection.document.poolSize, context.loaded.selection.document.selected, rows);
          if (assessment.status !== "completed" || rows.length !== 360) fail("full fixed judgment matrix required");
          shared.same(store.keys(), [...passedKeys].sort(), "unexpected final stored jobs");
          comparison = { protocol: GATEWAY_STUDY_V4_PROFILE, freezeSha256, study: freeze.study, procedure: freeze.procedure,
            originalStudiesStatus: "incomplete", extraction: { imported: context.imported.summary, priorGateway: context.priorGateway.summary, rows: extracted.rows },
            readers: readers.rows, judgments: rows, physicalJudgeResults: judgments.rows, assessment };
          final = { status: "completed", phase, resolved: rows.length, required: 360 };
        }
      }
    }
  } catch (error) { failed = true; failure = error; final = { status: "blocked", phase, reason: "Preserved first-response evidence requires review; no retry." }; }
  const finalKeys = store.keys(), events = store.events;
  let storeClosed = false, sourceVerifiedAtClose = false, importVerifiedAtClose = false, originalLedgerVerifiedAtClose = false, priorGatewayVerifiedAtClose = false;
  try { await store.close(); storeClosed = true; } catch (error) { failed = true; failure = error; }
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
  try {
    const after = await loadClaudeStudyImportV3({ manifest: freeze.importedStudy, jobs: context.loaded.extractionJobs });
    shared.same(after.summary, context.imported.summary, "ancestry changed during batch"); importVerifiedAtClose = true;
    const priorAfter = await loadGatewayStudyImportV4({ manifest: freeze.priorGatewayStudy, jobs: context.allExtractionJobs,
      expectedClaudeImportSha256: freeze.importedStudy.sha256, expectedOriginalLedger: freeze.originalLedger });
    shared.same(priorAfter.summary, context.priorGateway.summary, "prior Gateway changed during continuation"); priorGatewayVerifiedAtClose = true;
    await verifyGatewayHistoricalLedger(freeze.originalLedger); originalLedgerVerifiedAtClose = true;
    if ((await codeIdentity()).sourceSha256 !== freeze.sourceSha256 || (await loadJudgeProfile()).sha256 !== context.judge.sha256) fail("source or judge profile changed");
    sourceVerifiedAtClose = true;
  } catch (error) { failed = true; failure = error; }
  const ledgerRaw = await readGatewayStudyFile(join(directory, "ledger.jsonl"), 8 * 1024 * 1024);
  const comparisonArtifact = !failed && comparison !== undefined ? await writeGatewayStudyJson(join(directory, `comparison-${runId}.json`), comparison) : null;
  const receipt = { protocol: BATCH, runId, freezeSha256, sourceSha256: freeze.sourceSha256, importedStudySha256: freeze.importedStudy.sha256,
    start, end: new Date().toISOString(), admission, maximumNewCalls: input.maximumNewCalls, concurrency: GATEWAY_STUDY_CONCURRENCY,
    newTransportInvocations: newCalls, admittedKeys, initialJobKeys: initialKeys, finalJobKeys: finalKeys,
    failed, storeClosed, sourceVerifiedAtClose, importVerifiedAtClose, originalLedgerVerifiedAtClose, priorGatewayVerifiedAtClose, priorGatewayStudySha256: freeze.priorGatewayStudy.sha256, interrupted: stopped,
    stopReason, qualified, ledger: { path: join(directory, "ledger.jsonl"), bytes: ledgerRaw.length, sha256: sha256Hex(ledgerRaw),
      exposureMicros: gatewayV4LedgerExposure(events, context.priorGateway.summary.externalExposureMicros), priorGatewayExposureMicros: context.priorGateway.summary.externalExposureMicros, totalAmendmentExposureMicros: context.priorGateway.summary.externalExposureMicros + gatewayV4LedgerExposure(events, context.priorGateway.summary.externalExposureMicros), budget: budget.summary }, comparisonArtifact,
    result: failed ? { status: "blocked", phase, reason: "Preserved first-response evidence requires review; no retry." } : final };
  await writeGatewayStudyJson(join(directory, `batch-${runId}.json`), receipt);
  if (failed) throw new Error("Gateway study stopped; all first-response evidence is preserved.", { cause: failure });
  return receipt;
}

async function main(args: readonly string[]) {
  const [command, ...rest] = args;
  if (command === undefined || command === "--help") {
    console.log("Gateway memory study v4\nprepare --directory ABS --import-manifest ABS --import-sha256 SHA --prior-gateway-manifest ABS --prior-gateway-sha256 SHA --authority ABS --authority-sha256 SHA\nrun --directory ABS --freeze-sha256 SHA --max-new-calls 1..256\n\nCodex implements; fixed Gateway models complete benchmark prompts through project OIDC. Hard $40 total amendment exposure including prior Gateway reservations, four-request waves, no automatic retries or old-parent resubmission. Earlier frozen studies remain incomplete."); return;
  }
  const allowed = command === "prepare" ? ["directory", "import-manifest", "import-sha256", "prior-gateway-manifest", "prior-gateway-sha256", "authority", "authority-sha256"]
    : command === "run" ? ["directory", "freeze-sha256", "max-new-calls"] : fail("unknown command");
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1], name = flag?.slice(2);
    if (!flag?.startsWith("--") || !name || !allowed.includes(name) || !value || values.has(name)) fail("invalid command arguments");
    values.set(name, value);
  }
  const one = (key: string) => values.get(key) ?? fail("missing command argument");
  if (command === "prepare") console.log(JSON.stringify(await prepareGatewayStudyV4({ directory: one("directory"),
    importedStudy: { path: one("import-manifest"), sha256: one("import-sha256") }, priorGatewayStudy: { path: one("prior-gateway-manifest"), sha256: one("prior-gateway-sha256") }, authority: { path: one("authority"), sha256: one("authority-sha256") } })));
  else console.log(JSON.stringify(await runGatewayStudyV4({ directory: one("directory"), freezeSha256: one("freeze-sha256"), maximumNewCalls: Number(one("max-new-calls")) })));
}
if (import.meta.main) { try { await main(process.argv.slice(2)); } catch { console.error("Gateway study stopped. Inspect preserved evidence; no automatic retry."); process.exitCode = 1; } }
