import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import type { ClaudeLegacyPayload } from "./claude-legacy";
import { acceptClaudeStudyCompletion, completeClaudeExtraction, type ClaudeExtractionJob, type ClaudeExtractionResult } from "./claude-study-plan";
import type { ClaudeCompletion, ClaudeInvocation } from "./claude-subscription";
import { EXTRACTION_LIMITS } from "./units";

/** A versioned interpretation of completed extraction responses; generation is unchanged. */
export const CLAUDE_EXTRACTION_OUTCOME_PROFILE = "oh.claude-extraction-outcome.v1" as const;
export type ClaudeInvalidExtractionEnvelope = Readonly<{
  profile: typeof CLAUDE_EXTRACTION_OUTCOME_PROFILE;
  status: "invalid-envelope";
  reason: "invalid-json" | "wrong-envelope";
  jobKey: string;
  ordinal: number;
  corpusId: string;
  corpusSha256: string;
  chunkId: string;
  requestSha256: string;
  predictionSha256: string;
  completion: ClaudeCompletion;
  contributedUnits: 0;
}>;
export type ClaudeExtractionOutcome = Readonly<{
  profile: typeof CLAUDE_EXTRACTION_OUTCOME_PROFILE;
  status: "valid";
  result: ClaudeExtractionResult;
}> | ClaudeInvalidExtractionEnvelope;
export type ClaudeExtractionRetrievalAdapter = Readonly<{
  kind: "native-valid";
  payload: ClaudeLegacyPayload;
  invalidEnvelope: null;
}> | Readonly<{
  kind: "invalid-envelope-empty-adapter";
  payload: ClaudeLegacyPayload;
  invalidEnvelope: ClaudeInvalidExtractionEnvelope;
}>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Transport uncertainty remains fatal, even when a response contains malformed JSON. */
export function completeClaudeExtractionOutcome(job: ClaudeExtractionJob, invocation: ClaudeInvocation): ClaudeExtractionOutcome {
  const completion = acceptClaudeStudyCompletion(job, invocation);
  const invalid = (reason: ClaudeInvalidExtractionEnvelope["reason"]): ClaudeInvalidExtractionEnvelope => Object.freeze({
    profile: CLAUDE_EXTRACTION_OUTCOME_PROFILE, status: "invalid-envelope", reason,
    jobKey: job.key, ordinal: job.ordinal, corpusId: job.corpusId, corpusSha256: job.corpusSha256,
    chunkId: job.chunk.id, requestSha256: job.requestSha256,
    predictionSha256: sha256Hex(completion.prediction), completion, contributedUnits: 0,
  });
  let envelope: unknown;
  try { envelope = JSON.parse(completion.prediction); }
  catch (error) {
    if (error instanceof SyntaxError) return invalid("invalid-json");
    throw error;
  }
  // Exactly the native parser's top-level shape and item bound. Unit-level rejections remain native results.
  if (!isPlainRecord(envelope) || !hasExactKeys(envelope, ["units"]) || !Array.isArray(envelope.units)
    || envelope.units.length > EXTRACTION_LIMITS.units) return invalid("wrong-envelope");
  const result = completeClaudeExtraction(job, { ...invocation, completion });
  return Object.freeze({ profile: CLAUDE_EXTRACTION_OUTCOME_PROFILE, status: "valid", result });
}

/** Consume a decoded outcome, not an unauthenticated serialized report.
 * The empty native payload is only a retrieval adapter. Its rejected:0 is not a count of malformed units;
 * the complete invalid-envelope provenance remains alongside it and never becomes a valid extraction result. */
export function adaptClaudeExtractionOutcomeForRetrieval(outcome: ClaudeExtractionOutcome): ClaudeExtractionRetrievalAdapter {
  canonicalSha256(outcome);
  const copy = deepFreeze(structuredClone(outcome));
  if (copy.status === "valid") return Object.freeze({ kind: "native-valid", payload: copy.result.payload, invalidEnvelope: null });
  const payload: ClaudeLegacyPayload = deepFreeze({ id: copy.chunkId, units: [], rejected: 0 });
  return Object.freeze({ kind: "invalid-envelope-empty-adapter", payload, invalidEnvelope: copy });
}
