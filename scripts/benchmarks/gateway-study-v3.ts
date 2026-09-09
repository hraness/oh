/** Approved post-start Gateway amendment; historical attempts remain immutable and are never resubmitted. */
import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { claudeStudyInternals as shared } from "./claude-study";
import { parseClaudeStudyV2Freeze } from "./claude-study-v2";
import { loadClaudeStudyImportV3, parseClaudeStudyImportV3Manifest } from "./claude-study-import-v3";
import { codeIdentity } from "./io";
import { loadJudgeProfile } from "./judge";
import { ledgerExposure } from "./model";
import { assessSuperiority } from "./superiority";
import { GatewayStudyBudget, GATEWAY_STUDY_PROFILES, gatewayStudyLedgerExposure, invokeGatewayStudy,
  type GatewayStudyResult } from "./gateway-study-transport-v3";
import { openGatewayStudyStore, gatewayReservation, readGatewayStudyFile, writeGatewayStudyJson } from "./gateway-study-store-v3";
import { GATEWAY_STUDY_PLAN_V3_PROFILE, makeGatewayExtractionJobs, makeGatewayReaderJobs, makeGatewayJudgePlan,
  completeGatewayExtraction, completeGatewayReader, completeGatewayJudge, expandGatewayJudgments, gatewayStudyMemory,
  type GatewayJob } from "./gateway-study-plan-v3";

export const GATEWAY_STUDY_V3_PROFILE = "oh.memory-gateway-study.v3" as const;
const FREEZE = "oh.memory-gateway-freeze.v3" as const;
const BATCH = "oh.memory-gateway-batch.v3" as const;
const ADMISSION = "oh.memory-gateway-batch-admission.v3" as const;
export const GATEWAY_STUDY_CONCURRENCY = 4;
type Pin = Readonly<{ path: string; sha256: string }>;
type Inputs = ReturnType<typeof shared.parseFreeze>["inputs"];
type OriginalLedger = Readonly<{ path: string; sha256: string; bytes: number; exposureMicros: number }>;
export type GatewayStudyFreeze = Readonly<{ protocol: typeof FREEZE; createdAt: string; sourceSha256: string;
  importedStudy: Pin; authority: Pin; originalLedger: OriginalLedger; inputs: Inputs;
  procedure: Readonly<Record<string, unknown>>; study: Readonly<Record<string, unknown>> }>;
function fail(reason: string): never { throw new Error(`Gateway study v3: ${reason}.`); }
function json(raw: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
function record(value: unknown): Record<string, unknown> { if (!isPlainRecord(value)) fail("expected record"); return value; }
function integer(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail("expected nonnegative integer"); return value; }
function time(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("noncanonical timestamp"); return value; }

export type GatewayStudyAuth = Readonly<{ method: "project-oidc"; project: string; scope: string; environment: "development" }>;
function gatewayStudyAuth(value: unknown): GatewayStudyAuth {
  const a = record(value);
  if (!hasExactKeys(a, ["method", "project", "scope", "environment"]) || a.method !== "project-oidc" || a.environment !== "development"
    || typeof a.project !== "string" || typeof a.scope !== "string"
    || [a.project, a.scope].some(value => value.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))) fail("invalid approved project identity");
  return { method: "project-oidc", project: a.project, scope: a.scope, environment: "development" };
}
export async function readGatewayStudyAuth(authority: Pin): Promise<GatewayStudyAuth> {
  const a = record(json(await shared.verified(shared.pin(authority), 1024 * 1024)));
  if (a.schema !== "oh.gateway-v3-authority.v1") fail("authority schema");
  return gatewayStudyAuth({ method: "project-oidc", project: a.project, scope: a.scope, environment: a.environment });
}

export function gatewayStudyProcedure(judgeSha256: string, auth: GatewayStudyAuth) {
  const original = shared.procedure(judgeSha256);
  return { profile: GATEWAY_STUDY_V3_PROFILE, plan: GATEWAY_STUDY_PLAN_V3_PROFILE,
    generation: { provider: "vercel-gateway", profiles: GATEWAY_STUDY_PROFILES, temperature: 0, store: false,
      only: ["openai"], order: ["openai"], fallbackModels: [], ordinaryRetryLimit: 0,
      concurrency: GATEWAY_STUDY_CONCURRENCY, interpretation: "Gateway family aliases with recorded returned routing; model snapshots are not pinned" },
    auth: gatewayStudyAuth(auth),
    budget: { newCapMicros: 40_000_000, sharedAcrossAllPhases: true, reserveBeforeDispatch: true, originalLedgerImmutable: true },
    systems: original.systems, retrievalBudget: original.retrievalBudget,
    amendment: { timing: "post-start, outcome-blind; original API and Claude v1/v2 studies remain incomplete",
      history: "Every prior first response is imported once; a changed provider or request hash never permits repeating its parent",
      zeroMemory: "Malformed extraction JSON/native top-level envelopes and explicitly authenticated extraction refusals/content filters contribute zero memory with a separate invalid disposition",
      inheritedFallback: "Explicit Claude refusal-driven fallback is invalid zero memory; fallback text is never accepted as requested-model output or used as memory",
      nativeEmpty: "Valid empty/all-rejected native extraction envelopes remain valid",
      fatal: "Unexplained model identity, incomplete transport, output truncation, request, source, custody, cost/usage and unexpected parser failures stop; reader/judge failures remain fatal",
      scope: "Distinct mixed-extractor/provider failure policy, not completion of earlier studies, a guaranteed accuracy lower bound or unchanged confirmatory error control" },
    judging: { ...original.judging, model: GATEWAY_STUDY_PROFILES.judge.model },
    assessment: { ...original.assessment, scope: "post-start mixed-extractor/provider Gateway amendment on the original fixed sample; earlier studies remain incomplete, no unchanged confirmatory error-control or official leaderboard claim" } };
}

export function parseGatewayStudyFreeze(value: unknown): GatewayStudyFreeze {
  const v = record(value);
  if (!hasExactKeys(v, ["protocol", "createdAt", "sourceSha256", "importedStudy", "authority", "originalLedger", "inputs", "procedure", "study"])
    || v.protocol !== FREEZE) fail("freeze shape");
  const inputs = record(v.inputs), ledger = record(v.originalLedger);
  if (!hasExactKeys(inputs, ["selection", "legacy", "exclusions", "originalSourceSha256"]) || !Array.isArray(inputs.exclusions)
    || inputs.exclusions.length < 1 || inputs.exclusions.length > 64 || !hasExactKeys(ledger, ["path", "sha256", "bytes", "exposureMicros"])) fail("input identity");
  return { protocol: FREEZE, createdAt: time(v.createdAt), sourceSha256: shared.digest(v.sourceSha256),
    importedStudy: shared.pin(v.importedStudy), authority: shared.pin(v.authority),
    originalLedger: { path: shared.path(ledger.path), sha256: shared.digest(ledger.sha256), bytes: integer(ledger.bytes), exposureMicros: integer(ledger.exposureMicros) },
    inputs: { selection: shared.pin(inputs.selection), legacy: shared.pin(inputs.legacy), exclusions: inputs.exclusions.map(shared.pin), originalSourceSha256: shared.digest(inputs.originalSourceSha256) },
    procedure: record(v.procedure), study: record(v.study) };
}

export async function loadGatewayStudyContext(importedStudy: Pin) {
  const manifest = parseClaudeStudyImportV3Manifest(json(await shared.verified(importedStudy, 8 * 1024 * 1024)));
  const old = parseClaudeStudyV2Freeze(json(await shared.verified(manifest.freeze, 8 * 1024 * 1024)));
  const loaded = await shared.loadInputs(old.inputs), judge = await loadJudgeProfile();
  const imported = await loadClaudeStudyImportV3({ manifest: importedStudy, jobs: loaded.extractionJobs });
  shared.same(imported.originalFreeze.inputs, old.inputs, "ancestral inputs changed");
  shared.same(imported.originalFreeze.study, shared.studyIdentity(loaded), "original complete native study identity changed");
  shared.same(imported.originalFreeze.procedure, shared.procedure(judge.sha256), "original generation changed");
  const extractionJobs = makeGatewayExtractionJobs(loaded.extractionJobs, imported.outcomes);
  return { loaded, imported, extractionJobs, judge };
}
export function gatewayStudyIdentity(context: Awaited<ReturnType<typeof loadGatewayStudyContext>>) {
  return { ...shared.studyIdentity(context.loaded), imported: context.imported.summary,
    remainingFirstExtractionCalls: context.extractionJobs.length,
    newExtractionOrderSha256: canonicalSha256(context.extractionJobs.map(job => ({ key: job.key, ordinal: job.ordinal,
      originalJobKey: job.original.key, requestSha256: job.request.requestSha256 }))) };
}

export async function verifyGatewayStudyAuthority(pin: Pin): Promise<OriginalLedger> {
  const a = record(json(await shared.verified(pin, 1024 * 1024)));
  if (a.schema !== "oh.gateway-v3-authority.v1" || a.approvedRefusalAmendment !== true || a.provider !== "vercel-gateway"
    || a.maximumNewExposureMicros !== 40_000_000 || a.previousAdditionalBudgetMicros !== 50_000_000
    || a.previousAdditionalExposureMicros !== 9_406_616 || a.previousUnusedAdditionalBudgetMicros !== 40_593_384
    || a.extractionModel !== GATEWAY_STUDY_PROFILES.extract.model || a.readerModel !== GATEWAY_STUDY_PROFILES.reader.model
    || a.judgeModel !== GATEWAY_STUDY_PROFILES.judge.model || a.preserveOldLedger !== true || a.newLedgerSharedAcrossAllNewPhases !== true
    || a.importAll1051FirstResponsesWithoutRetry !== true || a.neverResubmitRefusedParentToGateway !== true) fail("authority or spending scope changed");
  gatewayStudyAuth({ method: "project-oidc", project: a.project, scope: a.scope, environment: a.environment });
  const l = record(a.originalLedger), ledger = { path: shared.path(l.path), sha256: shared.digest(l.sha256), bytes: integer(l.bytes), exposureMicros: integer(l.exposureMicros) };
  if (ledger.bytes !== 925682 || ledger.sha256 !== "c972b7e8643db61aa5a3d2b50df9aa095834be1f5b43ec680aacf5d0507f559b" || ledger.exposureMicros !== 21_655_385
    || ledger.exposureMicros + 40_000_000 !== a.newCumulativeCeilingAcrossLedgersMicros || a.oldAuthorityCumulativeCeilingMicros !== 62_248_769
    || ledger.exposureMicros + 40_000_000 > 62_248_769) fail("historical budget anchor changed");
  await verifyGatewayHistoricalLedger(ledger); return ledger;
}
export async function verifyGatewayHistoricalLedger(ledger: OriginalLedger) {
  const raw = await shared.verified(ledger, 16 * 1024 * 1024);
  if (raw.length !== ledger.bytes) fail("historical ledger length changed");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  if (!text.endsWith("\n") || ledgerExposure(text.slice(0, -1).split("\n").map(line => JSON.parse(line))) !== ledger.exposureMicros) fail("historical ledger exposure changed");
}

/** Claims are local sanity checks; trusted scoped CLI injection and Gateway TLS/authentication verify the credential. */
export function qualifyGatewayOIDC(token: string, expected: GatewayStudyAuth, now = Date.now() / 1000) {
  const auth = gatewayStudyAuth(expected);
  if (typeof token !== "string" || token.length > 32768) fail("missing bounded project OIDC token");
  const parts = token.split("."); if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) fail("invalid OIDC serialization");
  const header = record(json(Buffer.from(parts[0]!, "base64url"))), c = record(json(Buffer.from(parts[1]!, "base64url")));
  if (header.alg !== "RS256" || c.sub !== `owner:${auth.scope}:project:${auth.project}:environment:${auth.environment}`
    || c.aud !== `https://vercel.com/${auth.scope}` || ![`https://oidc.vercel.com/${auth.scope}`, "https://oidc.vercel.com"].includes(String(c.iss))
    || typeof c.exp !== "number" || c.exp < now + 310 || typeof c.iat !== "number" || c.iat > now + 60) fail("project OIDC identity or lifetime mismatch");
  return { ...auth,
    issuer: c.iss, subject: c.sub, audience: c.aud, expiresAt: c.exp, signatureVerifiedLocally: false };
}

export async function prepareGatewayStudy(input: Readonly<{ directory: string; importedStudy: Pin; authority: Pin }>) {
  const directory = shared.path(input.directory), importedStudy = shared.pin(input.importedStudy), authority = shared.pin(input.authority);
  const context = await loadGatewayStudyContext(importedStudy), originalLedger = await verifyGatewayStudyAuthority(authority), source = await codeIdentity();
  if (source.bun !== "1.3.14" || source.dirty) fail("prepare requires a clean committed Bun1.3.14 runtime");
  if (context.imported.summary.importedTransportInvocations !== 1051 || context.extractionJobs.length !== 4920
    || context.loaded.selection.document.sampleSize !== 120) fail("approved fixed-study counts changed");
  const freeze: GatewayStudyFreeze = { protocol: FREEZE, createdAt: new Date().toISOString(), sourceSha256: source.sourceSha256,
    importedStudy, authority, originalLedger, inputs: context.imported.originalFreeze.inputs,
    procedure: gatewayStudyProcedure(context.judge.sha256, await readGatewayStudyAuth(authority)), study: gatewayStudyIdentity(context) };
  parseGatewayStudyFreeze(freeze);
  if ((await codeIdentity()).sourceSha256 !== source.sourceSha256) fail("source changed during preparation");
  await mkdir(directory, { mode: 0o700 });
  await writeGatewayStudyJson(join(directory, "preparation.json"), { source, noModelCalls: true,
    imported: context.imported.summary, originalLedger, maximumNewExposureMicros: 40_000_000 });
  const pin = await writeGatewayStudyJson(join(directory, "freeze.json"), freeze);
  return { directory, freezeSha256: pin.sha256, sourceSha256: source.sourceSha256, selectedFamilies: 120,
    importedFirstResponses: 1051, remainingFirstExtractionCalls: 4920, readerCases: 360, maxNewUsd: 40 };
}

export async function checkGatewayPriorBatches(directory: string, freezeSha256: string, sourceSha256: string, importedSha256: string) {
  const names = (await readdir(directory)).filter(name => name.startsWith("batch-"));
  for (const name of names) {
    if (!/^batch-[a-f0-9-]{36}(?:-started)?\.json$/.test(name)) fail("unexpected batch file");
    if (name.endsWith("-started.json") && !names.includes(name.replace("-started.json", ".json"))) fail("unclosed batch admission");
    if (name.endsWith("-started.json")) continue;
    const c = record(json(await readGatewayStudyFile(join(directory, name), 1024 * 1024)));
    if (c.protocol !== BATCH || c.freezeSha256 !== freezeSha256 || c.sourceSha256 !== sourceSha256 || c.importedStudySha256 !== importedSha256
      || c.failed !== false || c.storeClosed !== true || c.sourceVerifiedAtClose !== true || c.importVerifiedAtClose !== true
      || c.originalLedgerVerifiedAtClose !== true) fail("prior batch did not close successfully");
    const admission = shared.pin(c.admission);
    if (admission.path !== join(directory, name.replace(".json", "-started.json"))) fail("prior admission path");
    const a = record(json(await shared.verified(admission, 32768)));
    if (a.protocol !== ADMISSION || a.freezeSha256 !== freezeSha256 || a.runId !== c.runId || a.sourceSha256 !== sourceSha256
      || a.importedStudySha256 !== importedSha256 || a.maximumNewCalls !== c.maximumNewCalls || a.start !== c.start) fail("prior admission binding");
  }
}

/** Drain every admitted request before surfacing a failure; this helper never admits another wave. */
export async function settleGatewayWave<J, R>(jobs: readonly J[], execute: (job: J) => Promise<R>): Promise<readonly R[]> {
  if (jobs.length < 1 || jobs.length > GATEWAY_STUDY_CONCURRENCY) fail("wave must contain1..4 jobs");
  const settled = await Promise.allSettled(jobs.map(job => Promise.resolve().then(() => execute(job))));
  const rejected = settled.find(result => result.status === "rejected");
  if (rejected?.status === "rejected") throw rejected.reason;
  return settled.map(result => result.status === "fulfilled" ? result.value : fail("unsettled wave"));
}

export async function runGatewayStudy(input: Readonly<{ directory: string; freezeSha256: string; maximumNewCalls: number }>) {
  const directory = shared.path(input.directory), freezeSha256 = shared.digest(input.freezeSha256);
  if (!Number.isSafeInteger(input.maximumNewCalls) || input.maximumNewCalls < 1 || input.maximumNewCalls > 256) fail("new calls must be1..256");
  const freeze = parseGatewayStudyFreeze(json(await shared.verified({ path: join(directory, "freeze.json"), sha256: freezeSha256 }, 8 * 1024 * 1024)));
  const source = await codeIdentity(); if (source.sourceSha256 !== freeze.sourceSha256 || source.bun !== "1.3.14") fail("frozen source changed");
  const auth = await readGatewayStudyAuth(freeze.authority);
  const oidcToken = process.env.VERCEL_OIDC_TOKEN ?? "", qualified = qualifyGatewayOIDC(oidcToken, auth);
  const context = await loadGatewayStudyContext(freeze.importedStudy);
  shared.same(context.imported.originalFreeze.inputs, freeze.inputs, "frozen inputs changed");
  shared.same(gatewayStudyIdentity(context), freeze.study, "frozen study identity changed");
  shared.same(gatewayStudyProcedure(context.judge.sha256, auth), freeze.procedure, "frozen procedure changed");
  shared.same(await verifyGatewayStudyAuthority(freeze.authority), freeze.originalLedger, "frozen budget anchor changed");
  await checkGatewayPriorBatches(directory, freezeSha256, freeze.sourceSha256, freeze.importedStudy.sha256);
  const store = await openGatewayStudyStore(directory, freezeSha256), start = new Date().toISOString(), runId = randomUUID();
  const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: input.maximumNewCalls, priorExposureMicros: store.exposure });
  let stopped = false, newCalls = 0, phase = "extract", final: unknown, comparison: unknown, failure: unknown;
  let failed = false, stopReason: "call-limit" | "budget" | "interrupted" | null = null;
  const stop = () => { stopped = true; }; process.on("SIGINT", stop); process.on("SIGTERM", stop);
  const initialKeys = store.keys(), passedKeys = new Set<string>(), admittedKeys: string[] = [];
  const admission = await writeGatewayStudyJson(join(directory, `batch-${runId}-started.json`), {
    protocol: ADMISSION, runId, freezeSha256, sourceSha256: freeze.sourceSha256, importedStudySha256: freeze.importedStudy.sha256,
    start, maximumNewCalls: input.maximumNewCalls, concurrency: GATEWAY_STUDY_CONCURRENCY,
    openingLedgerExposureMicros: store.exposure, initialJobKeysSha256: canonicalSha256(initialKeys), qualified });
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
      const remainingMicros = 40_000_000 - gatewayStudyLedgerExposure(store.events), wave: J[] = [];
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
        amendmentExposureUsd: gatewayStudyLedgerExposure(store.events) / 1_000_000 }));
    }
    return { rows, complete: rows.length === jobs.length, cached };
  }
  try {
    const extracted = await execute(context.extractionJobs, completeGatewayExtraction);
    final = { status: extracted.complete ? "completed" : "paused", phase, resolved: extracted.rows.length,
      required: context.extractionJobs.length, imported: context.imported.outcomes.size };
    if (extracted.complete) {
      const memory = gatewayStudyMemory(context.loaded.legacy, context.imported.outcomes, extracted.rows);
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
          comparison = { protocol: GATEWAY_STUDY_V3_PROFILE, freezeSha256, study: freeze.study, procedure: freeze.procedure,
            originalStudiesStatus: "incomplete", extraction: { imported: context.imported.summary, rows: extracted.rows },
            readers: readers.rows, judgments: rows, physicalJudgeResults: judgments.rows, assessment };
          final = { status: "completed", phase, resolved: rows.length, required: 360 };
        }
      }
    }
  } catch (error) { failed = true; failure = error; final = { status: "blocked", phase, reason: "Preserved first-response evidence requires review; no retry." }; }
  const finalKeys = store.keys(), events = store.events;
  let storeClosed = false, sourceVerifiedAtClose = false, importVerifiedAtClose = false, originalLedgerVerifiedAtClose = false;
  try { await store.close(); storeClosed = true; } catch (error) { failed = true; failure = error; }
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
  try {
    const after = await loadClaudeStudyImportV3({ manifest: freeze.importedStudy, jobs: context.loaded.extractionJobs });
    shared.same(after.summary, context.imported.summary, "ancestry changed during batch"); importVerifiedAtClose = true;
    await verifyGatewayHistoricalLedger(freeze.originalLedger); originalLedgerVerifiedAtClose = true;
    if ((await codeIdentity()).sourceSha256 !== freeze.sourceSha256 || (await loadJudgeProfile()).sha256 !== context.judge.sha256) fail("source or judge profile changed");
    sourceVerifiedAtClose = true;
  } catch (error) { failed = true; failure = error; }
  const ledgerRaw = await readGatewayStudyFile(join(directory, "ledger.jsonl"), 8 * 1024 * 1024);
  const comparisonArtifact = !failed && comparison !== undefined ? await writeGatewayStudyJson(join(directory, `comparison-${runId}.json`), comparison) : null;
  const receipt = { protocol: BATCH, runId, freezeSha256, sourceSha256: freeze.sourceSha256, importedStudySha256: freeze.importedStudy.sha256,
    start, end: new Date().toISOString(), admission, maximumNewCalls: input.maximumNewCalls, concurrency: GATEWAY_STUDY_CONCURRENCY,
    newTransportInvocations: newCalls, admittedKeys, initialJobKeys: initialKeys, finalJobKeys: finalKeys,
    failed, storeClosed, sourceVerifiedAtClose, importVerifiedAtClose, originalLedgerVerifiedAtClose, interrupted: stopped,
    stopReason, qualified, ledger: { path: join(directory, "ledger.jsonl"), bytes: ledgerRaw.length, sha256: sha256Hex(ledgerRaw),
      exposureMicros: gatewayStudyLedgerExposure(events), budget: budget.summary }, comparisonArtifact,
    result: failed ? { status: "blocked", phase, reason: "Preserved first-response evidence requires review; no retry." } : final };
  await writeGatewayStudyJson(join(directory, `batch-${runId}.json`), receipt);
  if (failed) throw new Error("Gateway study stopped; all first-response evidence is preserved.", { cause: failure });
  return receipt;
}

async function main(args: readonly string[]) {
  const [command, ...rest] = args;
  if (command === undefined || command === "--help") {
    console.log("Gateway memory study v3\nprepare --directory ABS --import-manifest ABS --import-sha256 SHA --authority ABS --authority-sha256 SHA\nrun --directory ABS --freeze-sha256 SHA --max-new-calls1..256\n\nCodex implements; fixed Gateway models complete benchmark prompts through project OIDC. Hard40USD new ledger,4-request waves, no automatic retries or old-parent resubmission. Earlier frozen studies remain incomplete."); return;
  }
  const allowed = command === "prepare" ? ["directory", "import-manifest", "import-sha256", "authority", "authority-sha256"]
    : command === "run" ? ["directory", "freeze-sha256", "max-new-calls"] : fail("unknown command");
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i + 1], name = flag?.slice(2);
    if (!flag?.startsWith("--") || !name || !allowed.includes(name) || !value || values.has(name)) fail("invalid command arguments");
    values.set(name, value);
  }
  const one = (key: string) => values.get(key) ?? fail("missing command argument");
  if (command === "prepare") console.log(JSON.stringify(await prepareGatewayStudy({ directory: one("directory"),
    importedStudy: { path: one("import-manifest"), sha256: one("import-sha256") }, authority: { path: one("authority"), sha256: one("authority-sha256") } })));
  else console.log(JSON.stringify(await runGatewayStudy({ directory: one("directory"), freezeSha256: one("freeze-sha256"), maximumNewCalls: Number(one("max-new-calls")) })));
}
if (import.meta.main) { try { await main(process.argv.slice(2)); } catch { console.error("Gateway study stopped. Inspect preserved evidence; no automatic retry."); process.exitCode = 1; } }
