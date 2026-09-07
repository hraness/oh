/** Outcome-blind amendment: completed malformed extractor envelopes resolve once with zero memory. */
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { claudeStudyInternals as shared, checkPriorClaudeStudyBatches, executeClaudeJobs, type ClaudeJobHooks } from "./claude-study";
import { loadClaudeStudyImport } from "./claude-study-import";
import { completeClaudeExtractionOutcome, adaptClaudeExtractionOutcomeForRetrieval,
  CLAUDE_EXTRACTION_OUTCOME_PROFILE, type ClaudeExtractionOutcome } from "./claude-extraction-outcome";
import { makeClaudeReaderJobs, completeClaudeReader, makeClaudeJudgePlan, completeClaudeJudge,
  expandClaudeJudgments } from "./claude-study-plan";
import { openClaudeStudyStore, type ClaudeStudyStore } from "./claude-study-store";
import { inspectClaudeSubscriptionCapacity, verifyClaudeSubscription, type ClaudeSubscriptionCapacity } from "./claude-qualification";
import { runClaudeSubscription, type ClaudeInvocation } from "./claude-subscription";
import type { ClaudeLegacyExtraction } from "./claude-legacy";
import { codeIdentity } from "./io";
import { loadJudgeProfile } from "./judge";
import { assessSuperiority } from "./superiority";

export const CLAUDE_STUDY_V2_PROFILE = "oh.memory-claude-subscription-study.v2" as const;
const FREEZE_PROFILE = "oh.memory-claude-subscription-freeze.v2" as const;
type Pin = Readonly<{ path: string; sha256: string }>;
type OriginalFreeze = ReturnType<typeof shared.parseFreeze>;
export type ClaudeStudyV2Freeze = Omit<OriginalFreeze, "protocol"> & Readonly<{
  protocol: typeof FREEZE_PROFILE; importedStudy: Pin;
}>;
function fail(reason: string): never { throw new Error(`Claude study v2: ${reason}.`); }

/** Historical pause evidence stays frozen; only admission evaluates whether its reset has passed. */
export function claudeImportedCapacityReady(pauses: readonly ClaudeSubscriptionCapacity[], nowSeconds = Date.now() / 1000): boolean {
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) fail("invalid admission time");
  return pauses.every(pause => Object.values(pause.unifiedWindows).every(window => window.utilization < 0.7 || window.resetsAt <= nowSeconds));
}

export function claudeStudyV2Procedure(judgeSha256: string) {
  const original = shared.procedure(judgeSha256);
  return { ...original, profile: CLAUDE_STUDY_V2_PROFILE,
    generationProfile: original.profile,
    completionPolicy: "First completed response only; no repair, regeneration or retry. Invalid extraction envelopes resolve with zero memory.",
    amendment: { profile: CLAUDE_EXTRACTION_OUTCOME_PROFILE,
      timing: "post-start, outcome-blind amendment; original v1 remains incomplete",
      invalidEnvelope: "JSON syntax failure or native top-level envelope shape/size failure contributes zero memory with a separate invalid disposition",
      validEnvelope: "Native valid, empty and unit-rejected payloads remain unchanged",
      fatal: "Transport, request, source, custody, capacity and unexpected native parser failures still stop",
      imports: "All closed v1 first responses, including the terminal invalid envelope; raw/source/request/parent lineage and usage retained once",
      scope: "A different end-to-end failure policy; not v1 completion, a guaranteed accuracy lower bound, or an unchanged preregistered procedure" },
    assessment: { ...original.assessment,
      scope: "Post-start outcome-blind amended mixed-extractor study on the original fixed sample; numerical decision rule retained without asserting unchanged confirmatory error control or official leaderboard status" } };
}

export function parseClaudeStudyV2Freeze(value: unknown): ClaudeStudyV2Freeze {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "createdAt", "sourceSha256", "cli", "inputs",
    "capacityEvidence", "procedure", "study", "importedStudy"]) || value.protocol !== FREEZE_PROFILE) fail("invalid freeze");
  const { importedStudy, ...base } = value;
  const original = shared.parseFreeze({ ...base, protocol: "oh.memory-claude-subscription-freeze.v1" });
  return { ...original, protocol: FREEZE_PROFILE, importedStudy: shared.pin(importedStudy) };
}

/** Imported receipts are read-only history. They can never acquire a v2 pending/result receipt. */
export function withClaudeImportedResponses(store: Pick<ClaudeStudyStore, "lookup" | "begin" | "complete">,
  imported: ReadonlyMap<string, ClaudeInvocation>): Pick<ClaudeStudyStore, "lookup" | "begin" | "complete"> {
  // Copy the map so caller mutation cannot change admission while a batch is running.
  const history = new Map([...imported].map(([key, invocation]) => {
    canonicalSha256(invocation);
    return [key, structuredClone(invocation)] as const;
  }));
  return Object.freeze({
    lookup: async (key: string, requestSha256: string, model: string) => {
      const old = history.get(key);
      const current = await store.lookup(key, requestSha256, model);
      if (!old) return current;
      if (current.state !== "missing") fail("an imported job was duplicated in the new store");
      if (old.requestSha256 !== requestSha256 || old.status !== "completed" || old.completion?.reportedModel !== model
        || old.exitCode !== 0 || old.timedOut || old.outputBoundExceeded) fail("imported request binding changed");
      return { state: "completed" as const, invocation: old };
    },
    begin: async (key: string, requestSha256: string) => {
      if (history.has(key)) fail("an imported first response cannot be regenerated");
      return store.begin(key, requestSha256);
    },
    complete: async (key: string, requestSha256: string, invocation: ClaudeInvocation) => {
      if (history.has(key)) fail("an imported response cannot be relabelled as a new invocation");
      return store.complete(key, requestSha256, invocation);
    },
  });
}

export function claudeOutcomeMemory(legacy: ClaudeLegacyExtraction, outcomes: readonly ClaudeExtractionOutcome[]) {
  return shared.memory(legacy, outcomes.map(outcome => {
    const parent = outcome.status === "valid" ? outcome.result : outcome;
    return { ordinal: parent.ordinal, corpusId: parent.corpusId, corpusSha256: parent.corpusSha256,
      payload: adaptClaudeExtractionOutcomeForRetrieval(outcome).payload };
  }));
}

/** Counts and structural dispositions only; malformed usage is retained and is never called valid. */
export function summarizeClaudeExtractionOutcomes(outcomes: readonly ClaudeExtractionOutcome[], importedKeys: ReadonlySet<string>) {
  const dispositions = outcomes.map(outcome => {
    const row = outcome.status === "valid" ? outcome.result : outcome;
    const common = { jobKey: row.jobKey, ordinal: row.ordinal, corpusId: row.corpusId, corpusSha256: row.corpusSha256,
      chunkId: outcome.status === "valid" ? outcome.result.payload.id : outcome.chunkId,
      requestSha256: row.requestSha256, origin: importedKeys.has(row.jobKey) ? "imported-v1-first-response" : "v2-first-response",
      predictionSha256: sha256Hex(row.completion.prediction), usage: row.completion.usage,
      modelUsage: row.completion.modelUsage, listPriceEstimateUsd: row.completion.listPriceEstimateUsd,
      billedUsd: null, physicalModelAttempts: null };
    return outcome.status === "valid"
      ? { ...common, status: "valid" as const, payloadSha256: outcome.result.payloadSha256, contributedUnits: outcome.result.payload.units.length }
      : { ...common, status: "invalid-envelope" as const, reason: outcome.reason, contributedUnits: 0 };
  });
  if (new Set(dispositions.map(row => row.jobKey)).size !== dispositions.length
    || new Set(dispositions.map(row => row.ordinal)).size !== dispositions.length) fail("duplicate extraction disposition");
  const invalid = dispositions.filter(row => row.status === "invalid-envelope");
  const imported = dispositions.filter(row => row.origin === "imported-v1-first-response");
  return { profile: CLAUDE_EXTRACTION_OUTCOME_PROFILE, resolvedNewParents: dispositions.length,
    validNewChunks: dispositions.length - invalid.length, invalidNewParents: invalid.length,
    invalidCorpusCount: new Set(invalid.map(row => row.corpusId)).size,
    importedFirstResponses: imported.length, newFirstResponses: dispositions.length - imported.length,
    dispositions, dispositionsSha256: canonicalSha256(dispositions) };
}

async function loadImported(manifest: Pin, loaded: Awaited<ReturnType<typeof shared.loadInputs>>, judgeSha256: string) {
  const imported = await loadClaudeStudyImport({ manifest, jobs: loaded.extractionJobs });
  const original = shared.parseFreeze(imported.freeze);
  shared.same(original.study, shared.studyIdentity(loaded), "imported native study identity changed");
  shared.same(original.procedure, shared.procedure(judgeSha256), "imported generation procedure changed");
  const outcomes = loaded.extractionJobs.filter(job => imported.invocations.has(job.key))
    .map(job => completeClaudeExtractionOutcome(job, imported.invocations.get(job.key) ?? fail("missing imported response")));
  const summary = summarizeClaudeExtractionOutcomes(outcomes, new Set(imported.invocations.keys()));
  return { ...imported, original, summary };
}

function studyIdentity(loaded: Awaited<ReturnType<typeof shared.loadInputs>>, imported: Awaited<ReturnType<typeof loadImported>>) {
  return { ...shared.studyIdentity(loaded), importedFirstResponses: imported.summary.resolvedNewParents,
    importedValidChunks: imported.summary.validNewChunks, importedInvalidParents: imported.summary.invalidNewParents,
    importedDispositionsSha256: imported.summary.dispositionsSha256,
    remainingFirstExtractionCalls: loaded.extractionJobs.length - imported.summary.resolvedNewParents };
}

export async function prepareClaudeStudyV2(input: Readonly<{ directory: string; importedStudy: Pin; capacityEvidence: Pin }>) {
  const directory = shared.path(input.directory), importedStudy = shared.pin(input.importedStudy);
  const manifest: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await shared.verified(importedStudy)));
  if (!isPlainRecord(manifest)) fail("invalid import manifest");
  const original = shared.parseFreeze(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await shared.verified(shared.pin(manifest.freeze)))));
  const loaded = await shared.loadInputs(original.inputs), judge = await loadJudgeProfile();
  const imported = await loadImported(importedStudy, loaded, judge.sha256);
  const source = await codeIdentity();
  if (source.bun !== "1.3.14" || source.dirty) fail("prepare from a clean committed Bun 1.3.14 runtime");
  await shared.verified(original.cli, 512 * 1024 * 1024);
  const capacityEvidence = shared.pin(input.capacityEvidence);
  const capacity = inspectClaudeSubscriptionCapacity(await shared.verified(capacityEvidence, 16 * 1024 * 1024));
  await mkdir(directory, { mode: 0o700 });
  if (await realpath(directory) !== directory) fail("study directory must be canonical");
  const qualified = await verifyClaudeSubscription({ cliPath: original.cli.path, cwd: directory, expectedVersion: original.cli.version });
  const freeze: ClaudeStudyV2Freeze = { protocol: FREEZE_PROFILE, createdAt: new Date().toISOString(), sourceSha256: source.sourceSha256,
    cli: original.cli, inputs: original.inputs, capacityEvidence, importedStudy,
    procedure: claudeStudyV2Procedure(judge.sha256), study: studyIdentity(loaded, imported) };
  if ((await codeIdentity()).sourceSha256 !== source.sourceSha256) fail("source changed during preparation");
  await shared.durableJson(join(directory, "preparation.json"), { source, qualified, capacity, noModelCalls: true, imported: imported.summary });
  const pin = await shared.durableJson(join(directory, "freeze.json"), freeze);
  return { directory, freezeSha256: pin.sha256, sourceSha256: source.sourceSha256,
    selectedFamilies: loaded.selection.document.sampleSize, legacyCompletedChunks: loaded.legacy.completedChunks,
    importedFirstResponses: imported.invocations.size, remainingFirstExtractionCalls: loaded.extractionJobs.length - imported.invocations.size,
    expectedReaderCases: loaded.selection.document.sampleSize * 3 };
}

export async function runClaudeStudyV2(input: Readonly<{ directory: string; freezeSha256: string; maximumNewCalls: number }>) {
  const directory = shared.path(input.directory), freezeSha256 = shared.digest(input.freezeSha256);
  if (!Number.isSafeInteger(input.maximumNewCalls) || input.maximumNewCalls < 1 || input.maximumNewCalls > 256) fail("batch calls must be within 1..256");
  const freeze = parseClaudeStudyV2Freeze(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
    await shared.verified({ path: join(directory, "freeze.json"), sha256: freezeSha256 }, 8 * 1024 * 1024))));
  const source = await codeIdentity();
  if (source.sourceSha256 !== freeze.sourceSha256 || source.bun !== "1.3.14") fail("frozen source or Bun version changed");
  await shared.verified(freeze.cli, 512 * 1024 * 1024);
  const qualified = await verifyClaudeSubscription({ cliPath: freeze.cli.path, cwd: directory, expectedVersion: freeze.cli.version });
  inspectClaudeSubscriptionCapacity(await shared.verified(freeze.capacityEvidence, 16 * 1024 * 1024));
  const loaded = await shared.loadInputs(freeze.inputs), judgeProfile = await loadJudgeProfile();
  const imported = await loadImported(freeze.importedStudy, loaded, judgeProfile.sha256);
  shared.same(imported.original.inputs, freeze.inputs, "imported inputs changed");
  shared.same(imported.original.cli, freeze.cli, "imported CLI changed");
  shared.same(studyIdentity(loaded, imported), freeze.study, "study input identity changed");
  shared.same(claudeStudyV2Procedure(judgeProfile.sha256), freeze.procedure, "study procedure changed");
  if (!claudeImportedCapacityReady(imported.capacityPauses)) fail("imported capacity pause remains active until its reported window reset");
  const store = await openClaudeStudyStore({ directory, freezeSha256 });
  let stopped = false, invoked = 0;
  let capacityPause: ClaudeSubscriptionCapacity | null = null;
  const stop = () => { stopped = true; };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  let phase = "extract", completeCount = 0, cacheCount = 0;
  const runId = randomUUID(), start = new Date().toISOString();
  const hooks: ClaudeJobHooks = {
    store: withClaudeImportedResponses(store, imported.invocations),
    invoke: async (paths, request) => { invoked++; return runClaudeSubscription({ cliPath: freeze.cli.path, cwd: directory, ...paths, request }); },
    capacity: async (job, invocation, cached) => {
      // The importer has already authenticated capacity for every old response. No old utilization triggers a new pause.
      if (imported.invocations.has(job.key)) return;
      const raw = await shared.verified({ path: join(directory, "jobs", job.key, "stdout.jsonl"), sha256: invocation.stdout.sha256 }, 16 * 1024 * 1024);
      const capacity = inspectClaudeSubscriptionCapacity(raw);
      if (!cached && Object.values(capacity.unifiedWindows).some(window => window.utilization >= 0.7 && window.resetsAt * 1000 > Date.now())) capacityPause = capacity;
    },
    admission: () => !stopped && capacityPause === null && invoked < input.maximumNewCalls && claudeImportedCapacityReady(imported.capacityPauses),
    progress: (completed, cached) => {
      completeCount = completed; cacheCount = cached;
      if (completed === 1 || completed % 25 === 0) console.log(JSON.stringify({ phase, resolved: completed, cached, newTransportInvocations: invoked }));
    },
  };
  let failure: unknown, failed = false, final: unknown, comparison: unknown, admission: Pin | undefined;
  try {
    await checkPriorClaudeStudyBatches(directory, freezeSha256, "v2", { sha256: freeze.importedStudy.sha256, count: imported.invocations.size });
    admission = await shared.durableJson(join(directory, `batch-${runId}-started.json`), { protocol: "oh.memory-claude-subscription-batch-admission.v2",
      runId, freezeSha256, sourceSha256: freeze.sourceSha256, cliSha256: freeze.cli.sha256, start, maximumNewCalls: input.maximumNewCalls,
      importedStudySha256: freeze.importedStudy.sha256, importedFirstResponses: imported.invocations.size });
    const extracted = await executeClaudeJobs(loaded.extractionJobs, completeClaudeExtractionOutcome, hooks);
    const extraction = summarizeClaudeExtractionOutcomes(extracted.rows, new Set(imported.invocations.keys()));
    final = { status: extracted.status, phase, resolved: extracted.rows.length, required: loaded.extractionJobs.length,
      valid: extraction.validNewChunks, invalid: extraction.invalidNewParents, imported: extraction.importedFirstResponses };
    if (extracted.status === "completed") {
      const corpusMemory = claudeOutcomeMemory(loaded.legacy, extracted.rows);
      phase = "reader"; completeCount = 0; cacheCount = 0;
      const readerJobs = await makeClaudeReaderJobs({ ...loaded.selection.dataset, memory: corpusMemory });
      const readers = await executeClaudeJobs(readerJobs, (job, result) => {
        const question = loaded.selection.dataset.questions[job.questionIndex];
        if (!question) fail("missing authenticated question");
        return completeClaudeReader(job, question, result);
      }, hooks);
      final = { status: readers.status, phase, completed: readers.rows.length, required: readerJobs.length };
      if (readers.status === "completed") {
        phase = "judge"; completeCount = 0; cacheCount = 0;
        const judgePlan = makeClaudeJudgePlan({ readerJobs, readerRows: readers.rows, questions: loaded.selection.dataset.questions, profile: judgeProfile });
        const judged = await executeClaudeJobs(judgePlan.jobs, completeClaudeJudge, hooks);
        final = { status: judged.status, phase, completed: judged.rows.length, required: judgePlan.jobs.length };
        if (judged.status === "completed") {
          const rows = expandClaudeJudgments(judgePlan, judged.rows);
          const assessment = assessSuperiority(loaded.selection.document.poolSize, loaded.selection.document.selected, rows);
          if (assessment.status !== "completed") fail("full comparison matrix is incomplete");
          final = { status: "completed", phase, completed: rows.length, required: rows.length, assessment };
          comparison = { protocol: CLAUDE_STUDY_V2_PROFILE, freezeSha256,
            originalStudyStatus: "incomplete", originalSubscriptionV1Status: "incomplete", importedStudy: freeze.importedStudy,
            study: freeze.study, procedure: freeze.procedure,
            extraction: { legacy: loaded.legacy.provenance, ...extraction },
            readers: readers.rows, judgments: rows, physicalJudgeResults: judged.rows, assessment };
        }
      }
    }
  } catch (error) { failed = true; failure = error; }
  let storeClosed = false, sourceVerifiedAtClose = false, cliVerifiedAtClose = false, importVerifiedAtClose = false;
  try { await store.close(); storeClosed = true; } catch (error) { failed = true; failure = error; }
  process.off("SIGINT", stop); process.off("SIGTERM", stop);
  try {
    // Re-read the entire immutable history before accepting any output from this batch.
    const after = await loadImported(freeze.importedStudy, loaded, judgeProfile.sha256);
    shared.same(after.summary, imported.summary, "import changed during batch"); importVerifiedAtClose = true;
    if ((await loadJudgeProfile()).sha256 !== judgeProfile.sha256) fail("judge profile changed during batch");
    if ((await codeIdentity()).sourceSha256 !== freeze.sourceSha256) fail("source changed during batch");
    sourceVerifiedAtClose = true;
    await shared.verified(freeze.cli, 512 * 1024 * 1024); cliVerifiedAtClose = true;
  } catch (error) { failed = true; failure = error; }
  let comparisonArtifact: Pin | null = null;
  if (failed) final = { status: "blocked", phase, completed: completeCount, cached: cacheCount, reason: "Private evidence requires review before accepting this batch." };
  else if (comparison !== undefined) comparisonArtifact = await shared.durableJson(join(directory, `comparison-${runId}.json`), comparison);
  const receipt = { protocol: "oh.memory-claude-subscription-batch.v2", runId, freezeSha256, sourceSha256: freeze.sourceSha256,
    importedStudySha256: freeze.importedStudy.sha256, importedFirstResponses: imported.invocations.size, importVerifiedAtClose,
    start, end: new Date().toISOString(), admissionSha256: admission?.sha256 ?? null, sourceVerifiedAtClose, cliVerifiedAtClose, storeClosed, comparisonArtifact,
    qualified, newTransportInvocations: invoked, maximumNewCalls: input.maximumNewCalls,
    interrupted: stopped, capacityPause, failed, result: final };
  await shared.durableJson(join(directory, `batch-${runId}.json`), receipt);
  if (failed) throw new Error("Claude study v2 stopped; all first-response evidence is preserved.", { cause: failure });
  return receipt;
}

async function main(args: readonly string[]) {
  const [command, ...rest] = args;
  if (command === "--help" || command === undefined) {
    console.log("Claude subscription study v2 (Bun 1.3.14)\nprepare --directory ABS --import-manifest ABS --import-sha256 SHA --capacity-evidence ABS\nrun --directory ABS --freeze-sha256 SHA --max-new-calls 1..256\n\nCodex implements this runner; Claude Code performs benchmark completions through the stored subscription. V2 imports every first response from a closed terminal-envelope v1 failure and freezes a universal invalid-envelope-to-zero-memory policy. It never rewrites v1 evidence or retries an occupied job. Keep both frozen checkouts unchanged. No API credentials, extra usage or automatic quota recovery.");
    return;
  }
  if (command !== "prepare" && command !== "run") fail("unknown command");
  const permitted = command === "prepare" ? ["directory", "import-manifest", "import-sha256", "capacity-evidence"] : ["directory", "freeze-sha256", "max-new-calls"];
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i]?.slice(2), value = rest[i + 1];
    if (!rest[i]?.startsWith("--") || !name || !permitted.includes(name) || !value || values.has(name)) fail("invalid arguments");
    values.set(name, value);
  }
  const one = (name: string) => values.get(name) ?? fail("missing argument");
  if (command === "prepare") console.log(JSON.stringify(await prepareClaudeStudyV2({ directory: one("directory"),
    importedStudy: { path: one("import-manifest"), sha256: one("import-sha256") },
    capacityEvidence: await shared.pinned(one("capacity-evidence"), 16 * 1024 * 1024) }), null, 2));
  else {
    if (!/^[1-9][0-9]{0,2}$/.test(one("max-new-calls"))) fail("invalid batch count");
    console.log(JSON.stringify(await runClaudeStudyV2({ directory: one("directory"), freezeSha256: one("freeze-sha256"), maximumNewCalls: Number(one("max-new-calls")) }), null, 2));
  }
}
if (import.meta.main) {
  try { await main(process.argv.slice(2)); }
  catch { console.error("Claude study v2 stopped. Inspect the private evidence; no automatic retry was attempted."); process.exitCode = 1; }
}
