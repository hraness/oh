import { canonicalJson, isPlainRecord, utf8ByteLength } from "../../src/canonical";

/** These are source-envelope bounds, not provider-request or model-context qualifications. */
export const FRAMEWORK_PILOT_CONTEXT_LIMITS_V1 = Object.freeze({
  maximumCandidates: 20,
  maximumContextTokens: 8_192,
  maximumCandidateJsonBytes: 65_536,
  maximumInputJsonBytes: 262_144,
  maximumTokenizerIdentityBytes: 256,
  maximumNeutralUnitOrdinal: 32_768,
});

export type FrameworkPilotContextCandidateV1 = Readonly<{ unitId: string; content: string }>;
export type FrameworkPilotContextInputV1 = Readonly<{
  protocol: "oh.framework-pilot-context-input.v1";
  maxContextTokens: number;
  candidates: readonly FrameworkPilotContextCandidateV1[];
}>;
/** Identity is a caller assertion. This module neither loads nor qualifies a tokenizer artifact. */
export type FrameworkPilotContextTokenizerV1 = Readonly<{
  identity: string;
  countTokens(context: string): number;
}>;
export type FrameworkPilotContextOmissionV1 = Readonly<{
  rank: number;
  unitId: string;
  reason: "duplicate" | "overflow" | "after-overflow";
  firstOccurrenceRank: number;
  attemptedContextTokens: number | null;
}>;
export type FrameworkPilotContextResultV1 = Readonly<{
  protocol: "oh.framework-pilot-context.v1";
  tokenizerIdentity: string;
  tokenizerQualification: "not-established-by-this-module";
  tokenCountScope: "context-string-only";
  rendering: "canonical-candidate-json-lines.v1";
  maxContextTokens: number;
  candidateCount: number;
  uniqueCandidateCount: number;
  included: readonly Readonly<{ rank: number; unitId: string }>[];
  omitted: readonly FrameworkPilotContextOmissionV1[];
  context: string;
  contextBytes: number;
  contextTokens: number;
}>;

function fail(message: string): never { throw new TypeError(`Framework pilot context: ${message}.`); }

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(`invalid ${label}`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) {
    fail(`unexpected ${label} fields`);
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail(`invalid ${label} property`);
    result[key] = descriptor.value;
  }
  return result;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) fail("invalid candidates");
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value as unknown;
  if (!integer(length, FRAMEWORK_PILOT_CONTEXT_LIMITS_V1.maximumCandidates)) fail("candidate count exceeded");
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length + 1 || keys.some(key => key !== "length"
    && (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) {
    fail("invalid candidate array properties");
  }
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) fail("invalid candidate array entry");
    result.push(descriptor.value);
  }
  return result;
}

function integer(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)
    && value >= 0 && value <= maximum;
}

function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.length > maximum || /\p{Surrogate}/u.test(value)
    || utf8ByteLength(value) > maximum) fail(`invalid ${label}`);
  return value;
}

/** No Corpus, question, gold, provenance map, or arbitrary metadata is accepted here.
 * The caller must already have validated each complete block against its source.
 * We validate this envelope, not the block's provenance or factual content. */
export function parseFrameworkPilotContextInputV1(value: unknown): FrameworkPilotContextInputV1 {
  const input = record(value, ["protocol", "maxContextTokens", "candidates"], "input");
  if (input.protocol !== "oh.framework-pilot-context-input.v1"
    || !integer(input.maxContextTokens, FRAMEWORK_PILOT_CONTEXT_LIMITS_V1.maximumContextTokens)
    || input.maxContextTokens < 1) fail("invalid protocol or context-token budget");
  const candidates: FrameworkPilotContextCandidateV1[] = [];
  const firstContent = new Map<string, string>();
  for (const raw of array(input.candidates)) {
    const value = record(raw, ["unitId", "content"], "candidate");
    const unitId = text(value.unitId, 32, "neutral unit ID");
    if (!/^u[0-9]{6}$/.test(unitId) || unitId === "u000000"
      || Number(unitId.slice(1)) > FRAMEWORK_PILOT_CONTEXT_LIMITS_V1.maximumNeutralUnitOrdinal) fail("invalid neutral unit ID");
    const candidate = Object.freeze({ unitId,
      content: text(value.content, FRAMEWORK_PILOT_CONTEXT_LIMITS_V1.maximumCandidateJsonBytes, "candidate content") });
    if (utf8ByteLength(canonicalJson(candidate)) > FRAMEWORK_PILOT_CONTEXT_LIMITS_V1.maximumCandidateJsonBytes) {
      fail("candidate JSON byte bound exceeded");
    }
    if (firstContent.has(unitId) && firstContent.get(unitId) !== candidate.content) fail("conflicting duplicate unit ID");
    firstContent.set(unitId, candidate.content);
    candidates.push(candidate);
  }
  const parsed: FrameworkPilotContextInputV1 = Object.freeze({ protocol: "oh.framework-pilot-context-input.v1",
    maxContextTokens: input.maxContextTokens, candidates: Object.freeze(candidates) });
  if (utf8ByteLength(canonicalJson(parsed)) > FRAMEWORK_PILOT_CONTEXT_LIMITS_V1.maximumInputJsonBytes) {
    fail("input JSON byte bound exceeded");
  }
  return parsed;
}

function tokenizer(value: unknown): FrameworkPilotContextTokenizerV1 {
  const parsed = record(value, ["identity", "countTokens"], "tokenizer");
  const identity = text(parsed.identity, FRAMEWORK_PILOT_CONTEXT_LIMITS_V1.maximumTokenizerIdentityBytes, "tokenizer identity");
  if (identity.length === 0 || identity.trim() !== identity || /[\u0000-\u001f\u007f]/.test(identity)
    || typeof parsed.countTokens !== "function") fail("invalid explicit tokenizer");
  return Object.freeze({ identity, countTokens: parsed.countTokens as (context: string) => number });
}

function count(counter: FrameworkPilotContextTokenizerV1, context: string): number {
  const result: unknown = counter.countTokens(context);
  if (!integer(result, Number.MAX_SAFE_INTEGER)) fail("tokenizer returned an invalid count");
  return result;
}

/** Canonical JSON escapes content LF/CR, so each LF-delimited line is exactly one
 * complete candidate. Token counts include neutral IDs, JSON punctuation and separators.
 * The count excludes question, instructions, chat framing, tool schemas and output reserve.
 * No default counter, estimate, artifact verification or model-fit claim is supplied. */
export function packFrameworkPilotContextV1(input: unknown, suppliedTokenizer: FrameworkPilotContextTokenizerV1): FrameworkPilotContextResultV1 {
  // Finish all schema, byte, Unicode and duplicate checks before invoking external code.
  const parsed = parseFrameworkPilotContextInputV1(input);
  const counter = tokenizer(suppliedTokenizer);
  let context = "", contextTokens = count(counter, ""), overflow = false;
  if (contextTokens > parsed.maxContextTokens) fail("empty context exceeds the token budget");
  const firstRanks = new Map<string, number>();
  const included: Readonly<{ rank: number; unitId: string }>[] = [];
  const omitted: FrameworkPilotContextOmissionV1[] = [];
  for (const [index, candidate] of parsed.candidates.entries()) {
    const rank = index + 1, firstRank = firstRanks.get(candidate.unitId);
    if (firstRank !== undefined) {
      omitted.push(Object.freeze({ rank, unitId: candidate.unitId, reason: "duplicate", firstOccurrenceRank: firstRank,
        attemptedContextTokens: null }));
      continue;
    }
    firstRanks.set(candidate.unitId, rank);
    if (overflow) {
      omitted.push(Object.freeze({ rank, unitId: candidate.unitId, reason: "after-overflow", firstOccurrenceRank: rank,
        attemptedContextTokens: null }));
      continue;
    }
    const line = canonicalJson(candidate), joined = context === "" ? line : `${context}\n${line}`;
    const attemptedContextTokens = count(counter, joined);
    if (attemptedContextTokens > parsed.maxContextTokens) {
      overflow = true;
      omitted.push(Object.freeze({ rank, unitId: candidate.unitId, reason: "overflow", firstOccurrenceRank: rank,
        attemptedContextTokens }));
      continue;
    }
    context = joined;
    contextTokens = attemptedContextTokens;
    included.push(Object.freeze({ rank, unitId: candidate.unitId }));
  }
  return Object.freeze({ protocol: "oh.framework-pilot-context.v1", tokenizerIdentity: counter.identity,
    tokenizerQualification: "not-established-by-this-module", tokenCountScope: "context-string-only",
    rendering: "canonical-candidate-json-lines.v1", maxContextTokens: parsed.maxContextTokens,
    candidateCount: parsed.candidates.length, uniqueCandidateCount: firstRanks.size,
    included: Object.freeze(included), omitted: Object.freeze(omitted), context,
    contextBytes: utf8ByteLength(context), contextTokens });
}
