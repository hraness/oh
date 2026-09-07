import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { withClaudeImportedResponses, claudeOutcomeMemory, summarizeClaudeExtractionOutcomes,
  claudeStudyV2Procedure, parseClaudeStudyV2Freeze, claudeImportedCapacityReady } from "../scripts/benchmarks/claude-study-v2";
import { checkPriorBatches, checkPriorClaudeStudyBatches, executeClaudeJobs, claudeStudyInternals } from "../scripts/benchmarks/claude-study";
import { completeClaudeExtractionOutcome } from "../scripts/benchmarks/claude-extraction-outcome";
import { makeClaudeExtractionJobs, type ClaudeExtractionJob } from "../scripts/benchmarks/claude-study-plan";
import { CLAUDE_SUBSCRIPTION_PROFILE, type ClaudeInvocation } from "../scripts/benchmarks/claude-subscription";
import type { ClaudeStudyLookup, ClaudeStudyStore } from "../scripts/benchmarks/claude-study-store";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import type { ClaudeSubscriptionCapacity } from "../scripts/benchmarks/claude-qualification";
import { DATASETS, type Corpus } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { buildExtractionChunks, parseMemoryUnits, EXTRACTION_PROFILE, EXTRACTION_INSTRUCTION, EXTRACTION_SCHEMA } from "../scripts/benchmarks/units";

const h = (s: string) => sha256Hex(`v2-synthetic:${s}`);
function fixture() {
  const corpus: Corpus = { id: "c", groupId: "g", turns: [0, 1, 2].map(i => ({
    id: `turn-${i}`, sessionId: `session-${i}`, date: `2026-01-0${i + 1}`, speaker: "Casey", text: `Casey visited city ${i}.`,
  })) };
  const chunks = buildExtractionChunks(corpus), first = chunks[0];
  if (chunks.length !== 3 || !first) throw new Error("Synthetic chunk fixture changed.");
  const payload = { id: first.id, ...parseMemoryUnits({ units: [{ text: "Casey visited city 0.",
    supports: [{ turnId: "turn-0", quote: "Casey visited city 0." }] }] }, first) };
  const legacy: ClaudeLegacyExtraction = {
    protocol: "oh.memory-claude-legacy.v1",
    provenance: { reportSha256: h("legacy"), sourceSha256: h("source"), selectionReportSha256: h("selection"),
      dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256, split: "test", seed: 17,
      originalStatus: "incomplete", extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION),
        reader: "openai/gpt-4.1-mini", provider: "vercel-gateway", maximumOutput: 8192 },
      schemaSha256: canonicalSha256(EXTRACTION_SCHEMA), reportedUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 } },
    parents: chunks.map((chunk, ordinal) => ({ ordinal, corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunkId: chunk.id,
      legacy: ordinal === 0 ? { origin: "legacy-native", payload, payloadSha256: canonicalSha256(payload) } : null })),
    requiredChunks: 3, completedChunks: 1, missingChunks: 2, totalUnits: payload.units.length, qualifications: [],
  };
  const jobs = makeClaudeExtractionJobs([corpus], legacy), [a, b] = jobs;
  if (!a || !b) throw new Error("Missing synthetic extraction jobs.");
  return { legacy, jobs, a, b, payload };
}
function invocation(job: ClaudeExtractionJob, prediction: string): ClaudeInvocation {
  const usage = { inputTokens: 11, outputTokens: 7, cacheReadInputTokens: 13, cacheCreationInputTokens: 17 };
  return { protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256: job.requestSha256, status: "completed", exitCode: 0,
    timedOut: false, outputBoundExceeded: false, stdout: { bytes: 1, sha256: h(job.key) }, stderr: { bytes: 0, sha256: sha256Hex("") },
    completion: { prediction, reportedModel: job.request.model, sessionId: job.key, numTurns: 1, durationMs: 1,
      usage, modelUsage: { [job.request.model]: usage }, listPriceEstimateUsd: 0.01, billedUsd: null, physicalModelAttempts: null } };
}
function fakeStore() {
  const saved = new Map<string, ClaudeStudyLookup>(), events: string[] = [];
  const store: Pick<ClaudeStudyStore, "lookup" | "begin" | "complete"> = {
    lookup: async key => saved.get(key) ?? { state: "missing" },
    begin: async key => { events.push(`begin:${key}`); saved.set(key, { state: "incomplete", reason: "pending" }); return { stdoutPath: key, stderrPath: `${key}.err` }; },
    complete: async (key, _request, value) => { events.push(`persist:${key}`); saved.set(key, { state: "completed", invocation: value }); },
  };
  return { store, saved, events };
}

test("v2 reuses an invalid first response, runs only the next request, and resumes both without redispatch", async () => {
  const { jobs, a, b } = fixture(), f = fakeStore(), old = invocation(a, '{"units":['), fresh = invocation(b, '{"units":[]}');
  const imported = new Map([[a.key, old]]), store = withClaudeImportedResponses(f.store, imported);
  imported.clear(); // Admission owns a detached snapshot of the imported key set.
  const hooks = { store, invoke: async () => { f.events.push("invoke"); return fresh; }, capacity: async () => {},
    admission: () => true, progress: () => {} };
  const first = await executeClaudeJobs(jobs, completeClaudeExtractionOutcome, hooks);
  expect(first.status).toBe("completed"); expect(first.invoked).toBe(1); expect(first.cached).toBe(1);
  expect(first.rows.map(row => row.status)).toEqual(["invalid-envelope", "valid"]);
  expect(f.events).toEqual([`begin:${b.key}`, "invoke", `persist:${b.key}`]);
  expect(f.saved.has(a.key)).toBe(false);
  const second = await executeClaudeJobs(jobs, completeClaudeExtractionOutcome, { ...hooks, admission: () => false });
  expect(second.rows).toEqual(first.rows); expect(second.invoked).toBe(0); expect(second.cached).toBe(2);
  expect(f.events).toHaveLength(3);
});

test("imported jobs cannot be omitted by mutable input, copied into the new store, regenerated, or relabelled", async () => {
  const { a } = fixture(), f = fakeStore(), old = invocation(a, '{"units":[]}');
  const mutable = structuredClone(old), store = withClaudeImportedResponses(f.store, new Map([[a.key, mutable]]));
  Object.defineProperty(mutable, "requestSha256", { value: h("changed") });
  expect((await store.lookup(a.key, a.requestSha256, a.request.model)).state).toBe("completed");
  await expect(store.begin(a.key, a.requestSha256)).rejects.toThrow("regenerated");
  await expect(store.complete(a.key, a.requestSha256, old)).rejects.toThrow("relabelled");
  await expect(store.lookup(a.key, h("wrong-request"), a.request.model)).rejects.toThrow("binding");
  f.saved.set(a.key, { state: "completed", invocation: old });
  await expect(store.lookup(a.key, a.requestSha256, a.request.model)).rejects.toThrow("duplicated");
  expect(f.events).toEqual([]);
});

test("new incomplete transport still blocks the full stream without redispatch", async () => {
  const { jobs, a, b } = fixture(), f = fakeStore();
  f.saved.set(b.key, { state: "incomplete", reason: "pending" });
  await expect(executeClaudeJobs(jobs, completeClaudeExtractionOutcome, {
    store: withClaudeImportedResponses(f.store, new Map([[a.key, invocation(a, '{"units":[')]])),
    invoke: async () => { throw new Error("Must not invoke"); }, capacity: async () => {}, admission: () => true, progress: () => {},
  })).rejects.toThrow("occupied incomplete");
  expect(f.events).toEqual([]);
});

test("all parents remain in retrieval; valid legacy payloads and invalid provenance remain distinct", () => {
  const { legacy, a, b, payload } = fixture();
  const outcomes = [completeClaudeExtractionOutcome(a, invocation(a, '{"units":[')),
    completeClaudeExtractionOutcome(b, invocation(b, '{"units":[]}'))];
  const memory = claudeOutcomeMemory(legacy, outcomes);
  expect(memory).toHaveLength(1); expect(memory[0]?.chunks).toHaveLength(3);
  expect(memory[0]?.chunks[0]).toEqual(payload);
  expect(memory[0]?.chunks.slice(1)).toEqual([{ id: a.chunk.id, units: [], rejected: 0 }, { id: b.chunk.id, units: [], rejected: 0 }]);
  const summary = summarizeClaudeExtractionOutcomes(outcomes, new Set([a.key]));
  expect([summary.resolvedNewParents, summary.validNewChunks, summary.invalidNewParents, summary.invalidCorpusCount,
    summary.importedFirstResponses, summary.newFirstResponses]).toEqual([2, 1, 1, 1, 1, 1]);
  expect(summary.dispositions[0]?.status).toBe("invalid-envelope"); expect(summary.dispositions[1]?.status).toBe("valid");
  expect(summary.dispositions.map(row => row.usage.outputTokens)).toEqual([7, 7]);
  expect(() => claudeOutcomeMemory(legacy, outcomes.slice(1))).toThrow("coverage");
  expect(() => summarizeClaudeExtractionOutcomes([outcomes[0]!, outcomes[0]!], new Set())).toThrow("duplicate");
});

test("imported pauses gate new calls until every qualifying active window has reset", () => {
  const pause: ClaudeSubscriptionCapacity = { status: "allowed", isUsingOverage: false, overageStatus: "rejected", overageDisabledReason: "org_level_disabled",
    rateLimitType: null, resetsAt: null, unifiedWindows: { five_hour: { utilization: 0.8, resetsAt: 200 }, seven_day: { utilization: 0.7, resetsAt: 300 } } };
  expect(claudeImportedCapacityReady([pause], 100)).toBe(false);
  expect(claudeImportedCapacityReady([pause], 200)).toBe(false);
  expect(claudeImportedCapacityReady([pause], 300)).toBe(true);
  expect(claudeImportedCapacityReady([], 100)).toBe(true);
  expect(claudeImportedCapacityReady([{ ...pause, unifiedWindows: { five_hour: { utilization: 0.69, resetsAt: 900 } } }], 100)).toBe(true);
});

test("v2 retains numeric decision thresholds and generation policy but discloses the changed procedure", () => {
  const original = claudeStudyInternals.procedure(h("judge")), amended = claudeStudyV2Procedure(h("judge"));
  expect(amended.profile).not.toBe(original.profile); expect(amended.generationProfile).toBe(original.profile);
  expect(amended.assessment.alphaPerComparison).toBe(original.assessment.alphaPerComparison);
  expect(amended.assessment.minimumObservedGain).toBe(original.assessment.minimumObservedGain);
  expect(amended.judging).toEqual(original.judging); expect(amended.maximumOutputTokens).toEqual(original.maximumOutputTokens);
  expect(amended.amendment.timing).toContain("post-start");
  expect(amended.assessment.scope).toContain("without asserting unchanged confirmatory");
  expect(() => parseClaudeStudyV2Freeze({ protocol: "oh.memory-claude-subscription-freeze.v1" })).toThrow("invalid freeze");
});

test("v2 resumes only closed v2 batches with verified imports; failed v1 custody remains strict", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oh-v2-prior-")), runId = "00000000-0000-4000-8000-000000000001", freezeSha256 = h("freeze");
  try {
    const admission = { protocol: "oh.memory-claude-subscription-batch-admission.v2", runId, freezeSha256,
      importedStudySha256: h("import"), importedFirstResponses: 2 };
    const raw = JSON.stringify(admission);
    await writeFile(join(directory, `batch-${runId}-started.json`), raw);
    const closure = { protocol: "oh.memory-claude-subscription-batch.v2", runId, freezeSha256, failed: false,
      admissionSha256: sha256Hex(raw), sourceVerifiedAtClose: true, cliVerifiedAtClose: true, storeClosed: true,
      importedStudySha256: h("import"), importedFirstResponses: 2, importVerifiedAtClose: true, capacityPause: null };
    const save = (value: unknown) => writeFile(join(directory, `batch-${runId}.json`), JSON.stringify(value));
    await save(closure);
    const expectedImport = { sha256: h("import"), count: 2 };
    await expect(checkPriorClaudeStudyBatches(directory, freezeSha256, "v2", expectedImport)).resolves.toBeUndefined();
    await expect(checkPriorClaudeStudyBatches(directory, freezeSha256, "v2")).rejects.toThrow("expected frozen import");
    await expect(checkPriorClaudeStudyBatches(directory, freezeSha256, "v2", { sha256: h("different"), count: 2 })).rejects.toThrow();
    await expect(checkPriorBatches(directory, freezeSha256)).rejects.toThrow("admission");
    for (const patch of [{ importVerifiedAtClose: false }, { importedStudySha256: h("changed") }, { importedFirstResponses: 1 }, { failed: true }]) {
      await save({ ...closure, ...patch });
      await expect(checkPriorClaudeStudyBatches(directory, freezeSha256, "v2", expectedImport)).rejects.toThrow();
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
