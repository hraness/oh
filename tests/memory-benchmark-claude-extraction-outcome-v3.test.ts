import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { completeClaudeExtractionOutcome } from "../scripts/benchmarks/claude-extraction-outcome";
import { adaptClaudeExtractionOutcomeV3ForRetrieval, completeClaudeExtractionOutcomeV3, parseClaudeExtractionTransportV3 } from "../scripts/benchmarks/claude-extraction-outcome-v3";
import type { ClaudeLegacyExtraction } from "../scripts/benchmarks/claude-legacy";
import { CLAUDE_STUDY_MODEL, makeClaudeExtractionJobs } from "../scripts/benchmarks/claude-study-plan";
import { CLAUDE_CODE_VERSION, CLAUDE_SUBSCRIPTION_PROFILE, parseClaudeCompletion, type ClaudeInvocation } from "../scripts/benchmarks/claude-subscription";
import { DATASETS, type Corpus } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { buildExtractionChunks, EXTRACTION_INSTRUCTION, EXTRACTION_PROFILE, EXTRACTION_SCHEMA } from "../scripts/benchmarks/units";

const h = (label: string) => sha256Hex(`v3-outcome-synthetic:${label}`);
const fallbackModel = "claude-opus-4-8", sessionId = "synthetic-session";
function fixture() {
  const corpus: Corpus = { id: "synthetic-corpus", groupId: "synthetic-family", turns: [
    { id: "turn-0", sessionId: "session-0", date: "2026-01-01", speaker: "Casey", text: "Casey owns a blue bicycle." },
  ] };
  const chunk = buildExtractionChunks(corpus)[0]!;
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
  return makeClaudeExtractionJobs([corpus], legacy)[0]!;
}
function modelUsage(model: string) {
  return { inputTokens: 11, outputTokens: model === CLAUDE_STUDY_MODEL ? 0 : 7,
    cacheReadInputTokens: 13, cacheCreationInputTokens: 17, webSearchRequests: 0,
    canonicalModel: model, provider: "firstParty", costBasis: "list" };
}
function events(prediction = "synthetic fallback text", fallback = true) {
  const init = { type: "system", subtype: "init", model: CLAUDE_STUDY_MODEL, claude_code_version: CLAUDE_CODE_VERSION,
    session_id: sessionId, apiKeySource: "none", tools: [], mcp_servers: [] };
  const marker = { type: "system", subtype: "model_refusal_fallback", trigger: "refusal", direction: "retry", scope: "session",
    original_model: CLAUDE_STUDY_MODEL, fallback_model: fallbackModel, request_id: "synthetic-request",
    api_refusal_category: "synthetic-category", api_refusal_explanation: "synthetic explanation", retracted_message_uuids: [],
    refused_user_message_uuid: "synthetic-refused-message", content: "synthetic provider notice", session_id: sessionId, uuid: "synthetic-marker" };
  const assistant = { type: "assistant", session_id: sessionId, parent_tool_use_id: null,
    message: { model: fallback ? fallbackModel : CLAUDE_STUDY_MODEL, content: [{ type: "text", text: prediction }] } };
  const capacity = { type: "rate_limit_event", rate_limit_info: { status: "allowed", isUsingOverage: false, overageStatus: "rejected",
    overageDisabledReason: "org_level_disabled", unifiedWindows: { five_hour: { resetsAt: 9999999999, utilization: 0.4 } } } };
  const terminal = { type: "result", subtype: "success", is_error: false, terminal_reason: "completed", stop_reason: "end_turn", num_turns: 1,
    session_id: sessionId, duration_ms: 20, permission_denials: [], result: prediction,
    usage: { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 13, cache_creation_input_tokens: 17,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
    modelUsage: { [CLAUDE_STUDY_MODEL]: modelUsage(CLAUDE_STUDY_MODEL), ...(fallback ? { [fallbackModel]: modelUsage(fallbackModel) } : {}) }, total_cost_usd: 0.001 };
  return { init, marker, assistant, capacity, terminal };
}
function encode(value: ReturnType<typeof events>, fallback = true) {
  return Buffer.from([value.init, ...(fallback ? [value.marker] : []), value.assistant, value.capacity, value.terminal].map(e => JSON.stringify(e)).join("\n") + "\n");
}
function invocation(job = fixture(), raw = encode(events())): ClaudeInvocation {
  let completion: ClaudeInvocation["completion"] = null;
  try { completion = parseClaudeCompletion(raw, job.request.model); } catch { /* Native status stays incomplete on fallback. */ }
  return { protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256: job.requestSha256, status: completion ? "completed" : "incomplete",
    exitCode: 0, timedOut: false, outputBoundExceeded: false, stdout: { bytes: raw.length, sha256: sha256Hex(raw) },
    stderr: { bytes: 0, sha256: sha256Hex("") }, completion };
}

describe("v3 explicit refusal fallback extraction disposition", () => {
  test("old parser rejects fallback; v3 retains zero memory and distinct actual model usage without text or completion", () => {
    const job = fixture(), source = events(), raw = encode(source), transport = invocation(job, raw);
    expect(() => parseClaudeCompletion(raw, job.request.model)).toThrow("assistant model mismatch");
    expect(transport.status).toBe("incomplete");
    const before = canonicalSha256(transport), outcome = completeClaudeExtractionOutcomeV3(job, transport, raw);
    expect(outcome.status).toBe("invalid-refusal-fallback");
    if (outcome.status !== "invalid-refusal-fallback") throw new Error("Expected fallback disposition.");
    expect(outcome.contributedUnits).toBe(0);
    expect(outcome.requestSha256).toBe(job.requestSha256);
    expect(outcome.fallback.requestedModel).toBe(CLAUDE_STUDY_MODEL);
    expect(outcome.fallback.fallbackModel).toBe(fallbackModel);
    expect(outcome.fallback.modelUsage[CLAUDE_STUDY_MODEL]?.outputTokens).toBe(0);
    expect(outcome.fallback.modelUsage[fallbackModel]?.outputTokens).toBe(7);
    expect(outcome.fallback.usage.outputTokens).toBe(7);
    expect(outcome.fallback.refusalEventSha256).toBe(sha256Hex(JSON.stringify(source.marker)));
    expect(outcome.fallback.predictionSha256).toBe(sha256Hex(source.terminal.result));
    expect(outcome.fallback.listPriceEstimateUsd).toBe(0.001);
    expect(outcome.fallback.billedUsd).toBeNull();
    expect(outcome.fallback.physicalModelAttempts).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain(source.terminal.result);
    expect(Object.hasOwn(outcome, "completion")).toBe(false);
    expect(Object.hasOwn(outcome, "rejected")).toBe(false);
    const adapted = adaptClaudeExtractionOutcomeV3ForRetrieval(outcome);
    expect(adapted.kind).toBe("invalid-refusal-fallback-empty-adapter");
    expect(adapted.payload).toEqual({ id: job.chunk.id, units: [], rejected: 0 });
    expect(Object.isFrozen(adapted.payload.units)).toBe(true);
    expect(Object.isFrozen(outcome.fallback.modelUsage[fallbackModel])).toBe(true);
    expect(canonicalSha256(transport)).toBe(before);
  });

  test("native valid, valid-empty, all-rejected, invalid JSON and wrong-envelope outcomes are unchanged", () => {
    const job = fixture(), turn = job.chunk.turns[0]!;
    for (const prediction of [JSON.stringify({ units: [{ text: turn.text, supports: [{ turnId: turn.id, quote: turn.text }] }] }),
      '{"units":[]}', '{"units":[null]}', '{"units":[', '{"wrong":[]}']) {
      const raw = encode(events(prediction, false), false), transport = invocation(job, raw);
      expect(completeClaudeExtractionOutcomeV3(job, transport, raw)).toEqual(completeClaudeExtractionOutcome(job, transport));
    }
  });

  test("source-independent fallback output content cannot contribute otherwise valid memory", () => {
    const job = fixture(), turn = job.chunk.turns[0]!;
    const raw = encode(events(JSON.stringify({ units: [{ text: turn.text, supports: [{ turnId: turn.id, quote: turn.text }] }] })));
    const result = completeClaudeExtractionOutcomeV3(job, invocation(job, raw), raw);
    expect(result.status).toBe("invalid-refusal-fallback");
    expect(adaptClaudeExtractionOutcomeV3ForRetrieval(result).payload.units).toEqual([]);
  });

  test("incomplete or altered physical/request evidence remains fatal", () => {
    const job = fixture(), raw = encode(events()), original = invocation(job, raw);
    for (const altered of [{ ...original, exitCode: 1 }, { ...original, timedOut: true }, { ...original, outputBoundExceeded: true },
      { ...original, requestSha256: h("other") }, { ...original, stdout: { ...original.stdout, bytes: raw.length - 1 } },
      { ...original, stdout: { ...original.stdout, sha256: h("other") } },
      { ...original, stderr: { bytes: -1, sha256: h("other") } }, { ...original, status: "completed" as const }]) {
      expect(() => completeClaudeExtractionOutcomeV3(job, altered, raw)).toThrow();
    }
    expect(() => completeClaudeExtractionOutcomeV3({ ...job, request: { ...job.request, prompt: "different" } }, original, raw)).toThrow();
    expect(() => parseClaudeExtractionTransportV3(raw.subarray(0, -1), job.request.model)).toThrow();
    expect(() => parseClaudeExtractionTransportV3(Buffer.from([0xff, 10]), job.request.model)).toThrow();
  });

  test("marker/model/session ambiguity, API credentials, tools, overage and nonterminal work remain fatal", () => {
    type E = ReturnType<typeof events>;
    const bad: Array<(e: E) => void> = [
      e => { Object.assign(e.init, { model: "other" }); }, e => { e.init.apiKeySource = "env"; },
      e => { Object.assign(e.init, { tools: ["tool"] }); }, e => { Object.assign(e.init, { mcp_servers: ["mcp"] }); },
      e => { e.marker.trigger = "error"; }, e => { e.marker.direction = "other"; }, e => { e.marker.scope = "other"; },
      e => { Object.assign(e.marker, { original_model: "other" }); }, e => { e.marker.fallback_model = CLAUDE_STUDY_MODEL; },
      e => { e.marker.session_id = "other"; }, e => { Object.assign(e.marker, { retracted_message_uuids: ["other"] }); },
      e => { e.assistant.session_id = "other"; }, e => { e.assistant.message.model = "claude-other"; },
      e => { Object.assign(e.assistant, { error: "failure" }); }, e => { Object.assign(e.assistant, { parent_tool_use_id: "tool" }); },
      e => { Object.assign(e.assistant.message, { content: [{ type: "tool_use" }] }); },
      e => { e.assistant.message.content[0]!.text = "different"; },
      e => { e.capacity.rate_limit_info.isUsingOverage = true; }, e => { e.capacity.rate_limit_info.status = "rejected"; },
      e => { e.capacity.rate_limit_info.overageDisabledReason = "other"; },
      e => { e.terminal.num_turns = 2; }, e => { e.terminal.stop_reason = "max_tokens"; }, e => { e.terminal.is_error = true; },
      e => { e.terminal.session_id = "other"; }, e => { Object.assign(e.terminal, { permission_denials: ["denied"] }); },
      e => { e.terminal.usage.server_tool_use.web_search_requests = 1; },
      e => { e.terminal.modelUsage[fallbackModel]!.provider = "other"; },
      e => { e.terminal.modelUsage[fallbackModel]!.canonicalModel = "other"; },
      e => { e.terminal.modelUsage[fallbackModel]!.webSearchRequests = 1; },
      e => { e.terminal.modelUsage[fallbackModel]!.inputTokens = -1; },
      e => { Object.assign(e.terminal.modelUsage, { "claude-other": modelUsage("claude-other") }); },
      e => { Reflect.deleteProperty(e.terminal.modelUsage, CLAUDE_STUDY_MODEL); },
    ];
    for (const mutate of bad) {
      const event = events(); mutate(event);
      expect(() => parseClaudeExtractionTransportV3(encode(event), CLAUDE_STUDY_MODEL)).toThrow();
    }
    const event = events(), raw = encode(event);
    for (const changed of [encode(event, false), Buffer.from(raw.toString().replace(JSON.stringify(event.capacity) + "\n", "")),
      Buffer.from(raw.toString() + JSON.stringify(event.marker) + "\n"),
      Buffer.from(raw.toString().replace(JSON.stringify(event.assistant), JSON.stringify(event.marker) + "\n" + JSON.stringify(event.assistant))),
      Buffer.from(raw.toString().replace(JSON.stringify(event.assistant), JSON.stringify({ type: "user" }) + "\n" + JSON.stringify(event.assistant)))]) {
      expect(() => parseClaudeExtractionTransportV3(changed, CLAUDE_STUDY_MODEL)).toThrow();
    }
  });

  test("native completion tampering and unexpected semantic parser errors are not converted", () => {
    const job = fixture(), raw = encode(events('{"units":[]}', false), false), transport = invocation(job, raw);
    if (transport.completion === null) throw new Error("Expected native completion.");
    const completion = transport.completion;
    expect(() => completeClaudeExtractionOutcomeV3(job, { ...transport, completion: { ...completion, prediction: "changed" } }, raw)).toThrow();
    const chunk = { ...job.chunk }, marker = new RangeError("synthetic parser failure");
    Object.defineProperty(chunk, "turns", { get: () => { throw marker; } });
    expect(() => completeClaudeExtractionOutcomeV3({ ...job, chunk }, transport, raw)).toThrow(marker);
  });
});
