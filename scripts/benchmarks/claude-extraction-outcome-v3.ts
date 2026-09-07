/** V3 adds an explicit refusal-fallback disposition; no generation or safety setting changes. */
import { canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { adaptClaudeExtractionOutcomeForRetrieval, completeClaudeExtractionOutcome, type ClaudeExtractionOutcome, type ClaudeExtractionRetrievalAdapter } from "./claude-extraction-outcome";
import type { ClaudeLegacyPayload } from "./claude-legacy";
import { inspectClaudeSubscriptionCapacity, type ClaudeSubscriptionCapacity } from "./claude-qualification";
import type { ClaudeExtractionJob } from "./claude-study-plan";
import { CLAUDE_CODE_VERSION, CLAUDE_SUBSCRIPTION_PROFILE, claudeRequestSha256, parseClaudeCompletion, type ClaudeCompletion, type ClaudeInvocation, type ClaudeTokenUsage } from "./claude-subscription";

export const CLAUDE_EXTRACTION_OUTCOME_V3_PROFILE = "oh.claude-extraction-outcome.v3" as const;
export type ClaudeRefusalFallbackEvidence = Readonly<{
  kind: "refusal-fallback";
  requestedModel: string;
  fallbackModel: string;
  sessionId: string;
  refusalEventSha256: string;
  refusalCategory: string;
  predictionSha256: string;
  predictionBytes: number;
  numTurns: 1;
  durationMs: number;
  usage: ClaudeTokenUsage;
  modelUsage: Readonly<Record<string, ClaudeTokenUsage>>;
  listPriceEstimateUsd: number | null;
  billedUsd: null;
  physicalModelAttempts: null;
  capacity: ClaudeSubscriptionCapacity;
}>;
export type ClaudeExtractionTransportV3 = Readonly<{ kind: "fixed-model"; completion: ClaudeCompletion }> | ClaudeRefusalFallbackEvidence;
export type ClaudeInvalidRefusalFallback = Readonly<{
  profile: typeof CLAUDE_EXTRACTION_OUTCOME_V3_PROFILE;
  status: "invalid-refusal-fallback";
  reason: "explicit-subscription-refusal-fallback";
  jobKey: string;
  ordinal: number;
  corpusId: string;
  corpusSha256: string;
  chunkId: string;
  requestSha256: string;
  stdout: ClaudeInvocation["stdout"];
  stderr: ClaudeInvocation["stderr"];
  fallback: ClaudeRefusalFallbackEvidence;
  contributedUnits: 0;
}>;
export type ClaudeExtractionOutcomeV3 = ClaudeExtractionOutcome | ClaudeInvalidRefusalFallback;
export type ClaudeExtractionRetrievalAdapterV3 = ClaudeExtractionRetrievalAdapter | Readonly<{
  kind: "invalid-refusal-fallback-empty-adapter";
  payload: ClaudeLegacyPayload;
  invalidRefusalFallback: ClaudeInvalidRefusalFallback;
}>;

function fail(message: string): never { throw new TypeError(`Invalid Claude refusal fallback: ${message}.`); }
function text(value: unknown, maximum = 1024): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > maximum || /\p{Surrogate}/u.test(value)) fail("bounded text required");
  return value;
}
function number(value: unknown, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)
    || (integer && !Number.isSafeInteger(value))) fail("nonnegative numeric metadata required");
  return value;
}
function usage(value: unknown, native: boolean): ClaudeTokenUsage {
  if (!isPlainRecord(value)) fail("missing usage");
  return Object.freeze({ inputTokens: number(value[native ? "input_tokens" : "inputTokens"], true),
    outputTokens: number(value[native ? "output_tokens" : "outputTokens"], true),
    cacheReadInputTokens: number(value[native ? "cache_read_input_tokens" : "cacheReadInputTokens"], true),
    cacheCreationInputTokens: number(value[native ? "cache_creation_input_tokens" : "cacheCreationInputTokens"], true) });
}
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function model(value: unknown): string {
  const result = text(value, 128);
  if (!/^claude-[a-z0-9.-]+$/.test(result)) fail("invalid model name");
  return result;
}

/** The caller authenticates CLI/source, subscription admission, request and closed file custody.
 * A fallback is never represented as ClaudeCompletion, and its text is never exposed as memory. */
export function parseClaudeExtractionTransportV3(raw: Uint8Array, expectedModel: string): ClaudeExtractionTransportV3 {
  model(expectedModel);
  if (raw.byteLength === 0 || raw.byteLength > 16 * 1024 * 1024 || raw[raw.length - 1] !== 10) fail("incomplete or unbounded stream");
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(raw).split("\n");
  if (lines.length > 20000) fail("too many events");
  const events = lines.slice(0, -1).map(line => {
    if (!line || Buffer.byteLength(line) > 4 * 1024 * 1024) fail("invalid event frame");
    const event: unknown = JSON.parse(line);
    if (!isPlainRecord(event)) fail("invalid event object");
    return event;
  });
  if (!events.some(event => event.type === "system" && event.subtype === "model_refusal_fallback")) {
    return Object.freeze({ kind: "fixed-model", completion: parseClaudeCompletion(raw, expectedModel) });
  }
  const capacity = inspectClaudeSubscriptionCapacity(raw);
  let sessionId: string | null = null, fallbackModel: string | null = null, marker: Record<string, unknown> | null = null;
  let markerIndex = -1, terminal: Record<string, unknown> | null = null, assistantText: string | null = null;
  for (const [index, event] of events.entries()) {
    const informational = event.type === "rate_limit_event" || (event.type === "system"
      && ["informational", "turn_duration", "thinking_tokens", "prompt_suggestion"].includes(String(event.subtype)));
    if (terminal !== null && !informational) fail("work after terminal result");
    if (event.type === "system" && event.subtype === "init") {
      if (sessionId !== null || event.model !== expectedModel || event.claude_code_version !== CLAUDE_CODE_VERSION) fail("initialization mismatch");
      sessionId = text(event.session_id, 128);
      if (event.apiKeySource !== "none" || !Array.isArray(event.tools) || event.tools.length !== 0
        || !Array.isArray(event.mcp_servers) || event.mcp_servers.length !== 0) fail("credential or tool initialization");
      continue;
    }
    if (event.type === "system" && event.subtype === "model_refusal_fallback") {
      if (marker !== null || sessionId === null || event.session_id !== sessionId || event.trigger !== "refusal"
        || event.direction !== "retry" || event.scope !== "session" || event.original_model !== expectedModel) fail("unbound or repeated refusal event");
      fallbackModel = model(event.fallback_model);
      if (fallbackModel === expectedModel || !Array.isArray(event.retracted_message_uuids)
        || event.retracted_message_uuids.length !== 0) fail("ambiguous fallback or retraction");
      for (const key of ["request_id", "api_refusal_category", "api_refusal_explanation", "refused_user_message_uuid", "content", "uuid"]) text(event[key], 64 * 1024);
      marker = event; markerIndex = index;
      continue;
    }
    if (event.type === "assistant" || event.type === "result") {
      if (sessionId === null || event.session_id !== sessionId) fail("session mismatch");
    }
    if (event.type === "assistant") {
      // The narrow amendment admits one final assistant after the explicit marker; other sequences remain fatal.
      if (marker === null || assistantText !== null || (event.error !== undefined && event.error !== null)
        || event.parent_tool_use_id !== null || !isPlainRecord(event.message)
        || event.message.model !== fallbackModel || !Array.isArray(event.message.content)) fail("unexplained assistant model or work");
      const blocks: string[] = [];
      for (const block of event.message.content) {
        if (!isPlainRecord(block) || !["text", "thinking", "redacted_thinking"].includes(String(block.type))) fail("tool or unsupported response block");
        if (block.type === "text") blocks.push(text(block.text, 2 * 1024 * 1024));
      }
      assistantText = blocks.join("");
      continue;
    }
    if (event.type === "result") { terminal = event; continue; }
    if (!informational) fail("unsupported interaction or system event");
  }
  if (sessionId === null || marker === null || fallbackModel === null || assistantText === null || terminal === null
    || terminal.subtype !== "success" || terminal.is_error !== false || terminal.num_turns !== 1
    || (terminal.terminal_reason !== undefined && terminal.terminal_reason !== "completed") || terminal.stop_reason !== "end_turn"
    || !Array.isArray(terminal.permission_denials) || terminal.permission_denials.length !== 0) fail("incomplete terminal response");
  const prediction = text(terminal.result, 2 * 1024 * 1024);
  if (prediction !== assistantText) fail("assistant/terminal mismatch");
  if (!isPlainRecord(terminal.modelUsage) || Object.keys(terminal.modelUsage).length !== 2
    || !Object.hasOwn(terminal.modelUsage, expectedModel) || !Object.hasOwn(terminal.modelUsage, fallbackModel)) fail("unexplained model usage");
  const modelUsage: Record<string, ClaudeTokenUsage> = {};
  for (const [name, value] of Object.entries(terminal.modelUsage)) {
    if (!isPlainRecord(value) || value.provider !== "firstParty" || value.canonicalModel !== name
      || value.costBasis !== "list" || value.webSearchRequests !== 0) fail("unverified model usage or server tool");
    modelUsage[name] = usage(value, false);
  }
  if (!isPlainRecord(terminal.usage) || !isPlainRecord(terminal.usage.server_tool_use)
    || terminal.usage.server_tool_use.web_search_requests !== 0 || terminal.usage.server_tool_use.web_fetch_requests !== 0) fail("unverified terminal server tools");
  return deepFreeze({ kind: "refusal-fallback", requestedModel: expectedModel, fallbackModel, sessionId,
    refusalEventSha256: sha256Hex(lines[markerIndex]!), refusalCategory: text(marker.api_refusal_category),
    predictionSha256: sha256Hex(prediction), predictionBytes: Buffer.byteLength(prediction), numTurns: 1,
    durationMs: number(terminal.duration_ms), usage: usage(terminal.usage, true), modelUsage,
    listPriceEstimateUsd: terminal.total_cost_usd === undefined ? null : number(terminal.total_cost_usd),
    billedUsd: null, physicalModelAttempts: null, capacity });
}

/** Readback re-derives status from authenticated raw bytes; old incomplete parser status is never rewritten. */
export function completeClaudeExtractionOutcomeV3(job: ClaudeExtractionJob, invocation: ClaudeInvocation, rawStdout: Uint8Array): ClaudeExtractionOutcomeV3 {
  if (job.phase !== "extract" || invocation.protocol !== CLAUDE_SUBSCRIPTION_PROFILE || invocation.exitCode !== 0
    || invocation.timedOut || invocation.outputBoundExceeded || invocation.requestSha256 !== job.requestSha256
    || claudeRequestSha256(job.request) !== job.requestSha256 || invocation.stdout.bytes !== rawStdout.length
    || invocation.stdout.sha256 !== sha256Hex(rawStdout) || !Number.isSafeInteger(invocation.stderr.bytes)
    || invocation.stderr.bytes < 0 || invocation.stderr.bytes > 1024 * 1024 || !/^[a-f0-9]{64}$/.test(invocation.stderr.sha256)) fail("transport/request/raw evidence mismatch");
  const parsed = parseClaudeExtractionTransportV3(rawStdout, job.request.model);
  if (parsed.kind === "fixed-model") {
    if (invocation.status !== "completed" || invocation.completion === null
      || canonicalSha256(invocation.completion) !== canonicalSha256(parsed.completion)) fail("fixed-model native completion mismatch");
    return completeClaudeExtractionOutcome(job, invocation);
  }
  if (invocation.status !== "incomplete" || invocation.completion !== null) fail("fallback must preserve the native incomplete disposition");
  return deepFreeze({ profile: CLAUDE_EXTRACTION_OUTCOME_V3_PROFILE, status: "invalid-refusal-fallback",
    reason: "explicit-subscription-refusal-fallback", jobKey: job.key, ordinal: job.ordinal,
    corpusId: job.corpusId, corpusSha256: job.corpusSha256, chunkId: job.chunk.id, requestSha256: job.requestSha256,
    stdout: structuredClone(invocation.stdout), stderr: structuredClone(invocation.stderr), fallback: parsed, contributedUnits: 0 });
}

/** Only this separate zero-memory adapter enters retrieval; fallback text is never returned. */
export function adaptClaudeExtractionOutcomeV3ForRetrieval(outcome: ClaudeExtractionOutcomeV3): ClaudeExtractionRetrievalAdapterV3 {
  if (outcome.status !== "invalid-refusal-fallback") return adaptClaudeExtractionOutcomeForRetrieval(outcome);
  canonicalSha256(outcome);
  const copy = deepFreeze(structuredClone(outcome));
  return deepFreeze({ kind: "invalid-refusal-fallback-empty-adapter", payload: { id: copy.chunkId, units: [], rejected: 0 }, invalidRefusalFallback: copy });
}
