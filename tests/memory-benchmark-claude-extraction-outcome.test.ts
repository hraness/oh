import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { adaptClaudeExtractionOutcomeForRetrieval, CLAUDE_EXTRACTION_OUTCOME_PROFILE, completeClaudeExtractionOutcome } from "../scripts/benchmarks/claude-extraction-outcome";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import { CLAUDE_STUDY_MODEL, completeClaudeExtraction, makeClaudeExtractionJobs } from "../scripts/benchmarks/claude-study-plan";
import { claudeRequestSha256, CLAUDE_SUBSCRIPTION_PROFILE, type ClaudeCompletion, type ClaudeInvocation, type ClaudeRequest } from "../scripts/benchmarks/claude-subscription";
import { DATASETS, type Corpus } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_LIMITS, EXTRACTION_PROFILE, EXTRACTION_SCHEMA } from "../scripts/benchmarks/units";

const h = (label: string) => sha256Hex(`extraction-outcome-synthetic:${label}`);
function fixture() {
  const corpus: Corpus = { id: "synthetic-corpus", groupId: "synthetic-family", turns: [
    { id: "turn-0", sessionId: "session-0", date: "2026-01-01", speaker: "Casey", text: "Casey owns a blue bicycle." },
  ] };
  const chunk = buildExtractionChunks(corpus)[0];
  if (!chunk) throw new Error("Missing synthetic chunk.");
  const legacy: ClaudeLegacyExtraction = {
    protocol: "oh.memory-claude-legacy.v1",
    provenance: { reportSha256: h("legacy"), sourceSha256: h("source"), selectionReportSha256: h("selection"),
      dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256, split: "test", seed: 17,
      originalStatus: "incomplete", extractor: { profile: EXTRACTION_PROFILE, promptSha256: sha256Hex(EXTRACTION_INSTRUCTION),
        reader: "openai/gpt-4.1-mini", provider: "vercel-gateway", maximumOutput: 8192 },
      schemaSha256: canonicalSha256(EXTRACTION_SCHEMA), reportedUsage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, micros: 0 } },
    parents: [{ ordinal: 0, corpusId: corpus.id, corpusSha256: corpusIdentity(corpus), chunkId: chunk.id, legacy: null }],
    requiredChunks: 1, completedChunks: 0, missingChunks: 1, totalUnits: 0, qualifications: [],
  };
  const job = makeClaudeExtractionJobs([corpus], legacy)[0];
  if (!job) throw new Error("Missing synthetic job.");
  return job;
}
function invocation(request: ClaudeRequest, prediction: string) {
  const usage = { inputTokens: 11, outputTokens: 7, cacheReadInputTokens: 13, cacheCreationInputTokens: 17 };
  const completion = { prediction, reportedModel: CLAUDE_STUDY_MODEL, sessionId: "synthetic-session", numTurns: 1,
    durationMs: 20, usage, modelUsage: { [CLAUDE_STUDY_MODEL]: usage }, listPriceEstimateUsd: 0.001,
    billedUsd: null, physicalModelAttempts: null } satisfies ClaudeCompletion;
  return { protocol: CLAUDE_SUBSCRIPTION_PROFILE, status: "completed", requestSha256: claudeRequestSha256(request), exitCode: 0,
    timedOut: false, outputBoundExceeded: false, stdout: { bytes: 20, sha256: h("stdout") },
    stderr: { bytes: 0, sha256: sha256Hex("") }, completion } satisfies ClaudeInvocation;
}

describe("versioned Claude extraction outcomes", () => {
  test("valid native result, provenance, usage and payload remain exactly equal", () => {
    const job = fixture(), turn = job.chunk.turns[0];
    if (!turn) throw new Error("Missing synthetic turn.");
    const transport = invocation(job.request, JSON.stringify({ units: [{ text: turn.text, supports: [{ turnId: turn.id, quote: turn.text }] }] }));
    const originalJobHash = canonicalSha256(job), native = completeClaudeExtraction(job, transport);
    const outcome = completeClaudeExtractionOutcome(job, transport);
    expect(outcome.profile).toBe(CLAUDE_EXTRACTION_OUTCOME_PROFILE);
    expect(outcome.status).toBe("valid");
    if (outcome.status !== "valid") throw new Error("Expected native valid outcome.");
    expect(outcome.result).toEqual(native);
    expect(outcome.result.payload.units.length).toBe(1);
    expect(outcome.result.completion).not.toBe(transport.completion);
    expect(canonicalSha256(job)).toBe(originalJobHash);
    const adapter = adaptClaudeExtractionOutcomeForRetrieval(outcome);
    expect(adapter).toEqual({ kind: "native-valid", payload: native.payload, invalidEnvelope: null });
    expect(Object.isFrozen(adapter.payload.units)).toBe(true);
  });

  test("valid empty, all-rejected and the exact native unit limit remain valid", () => {
    const job = fixture();
    for (const count of [0, 1, EXTRACTION_LIMITS.units]) {
      const transport = invocation(job.request, JSON.stringify({ units: Array.from({ length: count }, () => null) }));
      const outcome = completeClaudeExtractionOutcome(job, transport);
      expect(outcome.status).toBe("valid");
      if (outcome.status !== "valid") throw new Error("Expected native valid envelope.");
      expect(outcome.result).toEqual(completeClaudeExtraction(job, transport));
      expect(outcome.result.payload).toEqual({ id: job.chunk.id, units: [], rejected: count });
      expect(adaptClaudeExtractionOutcomeForRetrieval(outcome).kind).toBe("native-valid");
    }
  });

  test("malformed JSON retains exact original text hash and completion without inventing rejected counts", () => {
    const job = fixture();
    for (const prediction of ['{"units":[', '```json\n{"units":[]}\n```', '{"units":["π 😀']) {
      const transport = invocation(job.request, prediction), outcome = completeClaudeExtractionOutcome(job, transport);
      expect(outcome.status).toBe("invalid-envelope");
      if (outcome.status !== "invalid-envelope") throw new Error("Expected invalid envelope.");
      expect(outcome).toEqual({ profile: CLAUDE_EXTRACTION_OUTCOME_PROFILE, status: "invalid-envelope", reason: "invalid-json",
        jobKey: job.key, ordinal: job.ordinal, corpusId: job.corpusId, corpusSha256: job.corpusSha256,
        chunkId: job.chunk.id, requestSha256: job.requestSha256, predictionSha256: sha256Hex(prediction),
        completion: transport.completion, contributedUnits: 0 });
      expect(Object.hasOwn(outcome, "rejected")).toBe(false);
      expect(Object.hasOwn(outcome, "payload")).toBe(false);
      const adapter = adaptClaudeExtractionOutcomeForRetrieval(outcome);
      expect(adapter.kind).toBe("invalid-envelope-empty-adapter");
      expect(adapter.payload).toEqual({ id: job.chunk.id, units: [], rejected: 0 });
      expect(adapter.invalidEnvelope).toEqual(outcome);
      expect(Object.isFrozen(adapter.invalidEnvelope?.completion.usage)).toBe(true);
    }
  });

  test("wrong top-level shape and oversized unit array are distinct from syntax errors", () => {
    const job = fixture();
    for (const value of [null, [], "text", 1, {}, { units: null }, { units: {} }, { units: [], extra: true },
      { units: Array.from({ length: EXTRACTION_LIMITS.units + 1 }, () => null) }]) {
      const outcome = completeClaudeExtractionOutcome(job, invocation(job.request, JSON.stringify(value)));
      expect(outcome.status).toBe("invalid-envelope");
      if (outcome.status !== "invalid-envelope") throw new Error("Expected invalid envelope.");
      expect(outcome.reason).toBe("wrong-envelope");
      expect(outcome.contributedUnits).toBe(0);
    }
  });

  test("transport uncertainty and identity mismatch remain fatal before malformed JSON classification", () => {
    const job = fixture(), successful = invocation(job.request, '{"units":[');
    const badProtocol = structuredClone(successful);
    Object.defineProperty(badProtocol, "protocol", { value: "wrong-protocol" });
    for (const bad of [badProtocol, { ...successful, status: "incomplete" as const }, { ...successful, exitCode: 1 },
      { ...successful, timedOut: true }, { ...successful, outputBoundExceeded: true }, { ...successful, completion: null },
      { ...successful, requestSha256: h("wrong") },
      { ...successful, completion: { ...successful.completion, reportedModel: "claude-other" } }]) {
      expect(() => completeClaudeExtractionOutcome(job, bad)).toThrow("incomplete or mismatched invocation");
    }
    expect(() => completeClaudeExtractionOutcome({ ...job, request: { ...job.request, prompt: "changed" } }, successful)).toThrow();
  });

  test("a failure in native unit parsing is not converted to an invalid-envelope outcome", () => {
    const job = fixture(), chunk = { ...job.chunk }, marker = new RangeError("synthetic native failure");
    Object.defineProperty(chunk, "turns", { get: () => { throw marker; } });
    expect(() => completeClaudeExtractionOutcome({ ...job, chunk }, invocation(job.request, '{"units":[]}'))).toThrow(marker);
  });

  test("completed outcomes and adapters detach mutable completion input and freeze nested evidence", () => {
    const job = fixture();
    for (const prediction of ['{"units":[]}', '{"units":[']) {
      const transport = invocation(job.request, prediction), outcome = completeClaudeExtractionOutcome(job, transport);
      const adapter = adaptClaudeExtractionOutcomeForRetrieval(outcome), before = canonicalSha256({ outcome, adapter });
      transport.completion.prediction = "changed";
      transport.completion.usage.outputTokens = 999;
      transport.completion.modelUsage[CLAUDE_STUDY_MODEL].inputTokens = 999;
      expect(canonicalSha256({ outcome, adapter })).toBe(before);
      expect(Object.isFrozen(outcome)).toBe(true);
      const completion = outcome.status === "valid" ? outcome.result.completion : outcome.completion;
      expect(Object.isFrozen(completion.modelUsage[CLAUDE_STUDY_MODEL])).toBe(true);
      expect(completion.billedUsd).toBeNull();
      expect(completion.physicalModelAttempts).toBeNull();
      expect(Object.isFrozen(adapter)).toBe(true);
      expect(Object.isFrozen(adapter.payload)).toBe(true);
    }
  });
});
