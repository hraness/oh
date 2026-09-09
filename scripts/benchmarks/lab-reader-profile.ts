import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";

export const LAB_GPT5_MINI_READER_PROFILE = "oh.memory.lab-reader-profile.gpt-5-mini.v1" as const;
export const LAB_GPT5_MINI_MEDIUM_READER_PROFILE = "oh.memory.lab-reader-profile.gpt-5-mini-medium.v1" as const;
export const LAB_GPT5_MINI_ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions" as const;
export const LAB_GPT5_MINI_RESPONSE_BYTES = 1_048_576;
export const LAB_GPT5_MINI_MAX_OUTPUT = 2_048;
export const LAB_GPT5_MINI_MEDIUM_MAX_OUTPUT = 8_192;
export const LAB_GPT5_MINI_TIMEOUT_MS = 120_000;

const PRICE = Object.freeze({ input: 0.25, cachedInput: 0.03, output: 2 });
const PROFILE = Object.freeze({ id: LAB_GPT5_MINI_READER_PROFILE, model: "openai/gpt-5-mini" as const,
  provider: "openai" as const, reasoning: Object.freeze({ effort: "minimal" as const }),
  maximumOutput: LAB_GPT5_MINI_MAX_OUTPUT, timeoutMs: LAB_GPT5_MINI_TIMEOUT_MS, pricing: PRICE });
const MEDIUM_PROFILE = Object.freeze({ id: LAB_GPT5_MINI_MEDIUM_READER_PROFILE, model: "openai/gpt-5-mini" as const,
  provider: "openai" as const, reasoning: Object.freeze({ effort: "medium" as const }),
  maximumOutput: LAB_GPT5_MINI_MEDIUM_MAX_OUTPUT, timeoutMs: LAB_GPT5_MINI_TIMEOUT_MS, pricing: PRICE });

export type LabReaderMessage = Readonly<{ role: "system" | "user"; content: string }>;
export type LabGpt5MiniReaderProfileSelector = "minimal" | "medium";
export type LabGpt5MiniReaderProfileId = typeof LAB_GPT5_MINI_READER_PROFILE | typeof LAB_GPT5_MINI_MEDIUM_READER_PROFILE;
type LabReaderRequestBase = Readonly<{
  endpoint: typeof LAB_GPT5_MINI_ENDPOINT; body: Readonly<{ model: "openai/gpt-5-mini";
    messages: readonly LabReaderMessage[]; stream: false; store: false;
    providerOptions: Readonly<{ gateway: Readonly<{ only: readonly ["openai"]; order: readonly ["openai"] }> }> }>;
  requestSha256: string; profileSha256: string; inputBytes: number; inputUpperBound: number; timeoutMs: 120_000 }>;
export type LabReaderRequest =
  | (LabReaderRequestBase & Readonly<{ protocol: typeof LAB_GPT5_MINI_READER_PROFILE;
    body: LabReaderRequestBase["body"] & Readonly<{ max_tokens: 2_048; reasoning: Readonly<{ effort: "minimal" }> }>;
    maximumOutput: 2_048 }>)
  | (LabReaderRequestBase & Readonly<{ protocol: typeof LAB_GPT5_MINI_MEDIUM_READER_PROFILE;
    body: LabReaderRequestBase["body"] & Readonly<{ max_tokens: 8_192; reasoning: Readonly<{ effort: "medium" }> }>;
    maximumOutput: 8_192 }>);
export type LabReaderReservation = Readonly<{ id: string; requestSha256: string; inputUpperBound: number;
  maximumOutput: 2_048 | 8_192; micros: number }>;
export type LabReaderRaw = Readonly<{ requestSha256: string; httpStatus: number | null; body: Uint8Array;
  bodyComplete: boolean; receivedBytes: number; transportError: "network" | "body-read" | "response-bound" | null }>;
export type LabReaderUsage = Readonly<{ inputTokens: number; cachedInputTokens: number; outputTokens: number;
  tokenRateMicros: number; gatewayReportedMicros: number | null; micros: number }>;
export type LabReaderIdentity = Readonly<{ requestedModel: "openai/gpt-5-mini"; reportedModel: string;
  finalProvider: "openai"; resolvedProviderApiModelId: string | null }>;
export type LabReaderResult = Readonly<{ requestSha256: string; rawSha256: string; rawBytes: number;
  raw: Readonly<{ httpStatus: number; receivedBytes: number }>; usage: LabReaderUsage; identity: LabReaderIdentity }> & (
  | Readonly<{ kind: "completed"; finishReason: "stop"; prediction: string }>
  | Readonly<{ kind: "terminal"; finishReason: "length"; reason: "length"; prediction: null }>
);

function fail(reason: string): never { throw new TypeError(`Lab GPT-5 mini reader profile: ${reason}.`); }
function integer(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0); }
function frozen<T>(value: T): T { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); } return value; }
function validMessages(messages: readonly LabReaderMessage[]): boolean {
  return Array.isArray(messages) && messages.length === 2 && messages[0]?.role === "system" && messages[1]?.role === "user"
    && messages.every(message => isPlainRecord(message) && hasExactKeys(message, ["role", "content"])
      && (message.role === "system" || message.role === "user") && typeof message.content === "string"
      && message.content.length > 0 && !/\p{Surrogate}/u.test(message.content));
}
function profile(selector: LabGpt5MiniReaderProfileSelector | undefined) {
  if (selector === undefined || selector === "minimal") return PROFILE;
  if (selector === "medium") return MEDIUM_PROFILE;
  fail("unknown profile selector");
}
function profileForProtocol(value: unknown) {
  if (value === LAB_GPT5_MINI_READER_PROFILE) return PROFILE;
  if (value === LAB_GPT5_MINI_MEDIUM_READER_PROFILE) return MEDIUM_PROFILE;
  fail("unknown profile");
}

/** Builds the documented non-streaming Chat Completions fields. Runtime acceptance remains canary-only. */
export function makeLabGpt5MiniReaderRequest(messages: readonly LabReaderMessage[], options: Readonly<{ profile?: LabGpt5MiniReaderProfileSelector }> = {}): LabReaderRequest {
  if (!validMessages(messages)) fail("invalid two-message text prompt");
  if (!isPlainRecord(options) || !hasExactKeys(options, options.profile === undefined ? [] : ["profile"])) fail("invalid request options");
  const selected = profile(options.profile);
  const copied = structuredClone(messages);
  const body = { model: selected.model, messages: copied, stream: false as const, store: false as const,
    max_tokens: selected.maximumOutput, reasoning: structuredClone(selected.reasoning),
    providerOptions: { gateway: { only: ["openai"] as ["openai"], order: ["openai"] as ["openai"] } } };
  const inputBytes = Buffer.byteLength(JSON.stringify(copied));
  const inputUpperBound = inputBytes + 2_048;
  if (inputUpperBound + selected.maximumOutput > 400_000) fail("conservative context bound exceeded");
  const profileSha256 = canonicalSha256(selected);
  return frozen({ protocol: selected.id, endpoint: LAB_GPT5_MINI_ENDPOINT, body,
    requestSha256: canonicalSha256({ protocol: selected.id, endpoint: LAB_GPT5_MINI_ENDPOINT, body, profileSha256 }),
    profileSha256, inputBytes, inputUpperBound, maximumOutput: selected.maximumOutput, timeoutMs: selected.timeoutMs }) as LabReaderRequest;
}

function checkedRequest(value: LabReaderRequest): LabReaderRequest {
  const selected = profileForProtocol(value.protocol);
  const expected = makeLabGpt5MiniReaderRequest(value.body.messages, { profile: selected === PROFILE ? "minimal" : "medium" });
  if (canonicalSha256(value) !== canonicalSha256(expected)) fail("request changed after preparation");
  return expected;
}

export function reserveLabGpt5MiniReader(requestInput: LabReaderRequest, id: string): LabReaderReservation {
  const request = checkedRequest(requestInput);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) fail("invalid reservation identifier");
  return frozen({ id, requestSha256: request.requestSha256, inputUpperBound: request.inputUpperBound,
    maximumOutput: request.maximumOutput,
    micros: Math.ceil(request.inputUpperBound * PRICE.input + request.maximumOutput * PRICE.output) });
}

function compatibleModel(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const model = value.startsWith("openai/") ? value.slice(7) : value;
  if (model === "gpt-5-mini") return true;
  const snapshot = model.slice("gpt-5-mini-".length);
  if (!model.startsWith("gpt-5-mini-") || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot)) return false;
  const parsed = new Date(`${snapshot}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === snapshot;
}
function checkedMetadata(envelope: Record<string, unknown>, message: Record<string, unknown>): Record<string, unknown> {
  const candidates = [envelope.providerMetadata, envelope.provider_metadata, message.providerMetadata, message.provider_metadata]
    .filter(candidate => candidate !== undefined);
  if (candidates.length === 0 || candidates.some(candidate => canonicalSha256(candidate) !== canonicalSha256(candidates[0]))) fail("missing or conflicting Gateway metadata");
  const metadata = candidates[0];
  if (!isPlainRecord(metadata) || !isPlainRecord(metadata.gateway) || !isPlainRecord(metadata.gateway.routing)) fail("missing authenticated Gateway routing metadata");
  return metadata;
}
function checkedIdentity(envelope: Record<string, unknown>, metadata: Record<string, unknown>): LabReaderIdentity {
  const gateway = metadata.gateway as Record<string, unknown>, route = gateway.routing as Record<string, unknown>;
  if (!compatibleModel(envelope.model) || route.finalProvider !== "openai" || route.originalModelId !== "openai/gpt-5-mini"
    || route.canonicalSlug !== "openai/gpt-5-mini") fail("model or provider mismatch");
  const resolved = route.resolvedProviderApiModelId;
  if (resolved !== undefined && !compatibleModel(resolved)) fail("resolved model mismatch");
  return { requestedModel: "openai/gpt-5-mini", reportedModel: envelope.model as string, finalProvider: "openai",
    resolvedProviderApiModelId: typeof resolved === "string" ? resolved : null };
}
function checkedUsage(value: unknown, metadata: Record<string, unknown>, reservation: LabReaderReservation): LabReaderUsage {
  if (!isPlainRecord(value) || !integer(value.prompt_tokens) || !integer(value.completion_tokens)
    || value.total_tokens !== value.prompt_tokens + value.completion_tokens || value.prompt_tokens > reservation.inputUpperBound
    || value.completion_tokens > reservation.maximumOutput) fail("invalid usage or cap");
  const details = value.prompt_tokens_details, cached = isPlainRecord(details) ? details.cached_tokens ?? 0 : 0;
  if (details !== undefined && details !== null && !isPlainRecord(details) || !integer(cached) || cached > value.prompt_tokens) fail("invalid cached usage");
  const completionDetails = value.completion_tokens_details, reasoning = isPlainRecord(completionDetails) ? completionDetails.reasoning_tokens ?? 0 : 0;
  if (completionDetails !== undefined && completionDetails !== null && !isPlainRecord(completionDetails)
    || !integer(reasoning) || reasoning > value.completion_tokens) fail("invalid usage or cap");
  let gatewayReportedMicros: number | null = null;
  const gateway = metadata.gateway as Record<string, unknown>;
  if (gateway.cost !== undefined) {
    const cost = gateway.cost;
    if ((typeof cost !== "number" && typeof cost !== "string") || (typeof cost === "string" && !/^\d+(?:\.\d{1,12})?$/.test(cost))) fail("invalid Gateway cost");
    gatewayReportedMicros = Math.ceil(Number(cost) * 1_000_000);
    if (!integer(gatewayReportedMicros)) fail("invalid Gateway cost");
  }
  const tokenRateMicros = Math.ceil((value.prompt_tokens - cached) * PRICE.input + cached * PRICE.cachedInput + value.completion_tokens * PRICE.output);
  const micros = Math.max(tokenRateMicros, gatewayReportedMicros ?? 0);
  if (!integer(micros) || micros > reservation.micros) fail("usage exceeds reservation");
  return frozen({ inputTokens: value.prompt_tokens, cachedInputTokens: cached, outputTokens: value.completion_tokens, tokenRateMicros, gatewayReportedMicros, micros });
}

/** Parses captured response bytes only. Network dispatch, cache, and ledger ownership stay outside this module. */
export function parseLabGpt5MiniReaderResponse(requestInput: LabReaderRequest, reservation: LabReaderReservation, raw: LabReaderRaw): LabReaderResult {
  const request = checkedRequest(requestInput);
  const expected = reserveLabGpt5MiniReader(request, reservation.id);
  if (canonicalSha256(expected) !== canonicalSha256(reservation)) fail("reservation/request binding mismatch");
  if (raw.requestSha256 !== request.requestSha256 || !(raw.body instanceof Uint8Array) || raw.body.byteLength > LAB_GPT5_MINI_RESPONSE_BYTES
    || !integer(raw.receivedBytes) || raw.receivedBytes !== raw.body.byteLength || !raw.bodyComplete || raw.transportError !== null
    || !Number.isInteger(raw.httpStatus) || raw.httpStatus === null || raw.httpStatus < 200 || raw.httpStatus > 299) fail("incomplete transport or HTTP failure");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.body)); } catch { return fail("malformed response bytes"); }
  if (!isPlainRecord(value) || !Array.isArray(value.choices) || value.choices.length !== 1) fail("ambiguous response choices");
  const choice = value.choices[0];
  if (!isPlainRecord(choice) || (choice.index !== undefined && choice.index !== 0) || !isPlainRecord(choice.message)
    || choice.message.role !== "assistant" || (choice.message.tool_calls !== undefined && choice.message.tool_calls !== null)
    || (choice.message.function_call !== undefined && choice.message.function_call !== null)) fail("invalid completion message");
  const metadata = checkedMetadata(value, choice.message);
  const identity = checkedIdentity(value, metadata), usage = checkedUsage(value.usage, metadata, reservation);
  const base = frozen({ requestSha256: request.requestSha256, rawSha256: sha256Hex(raw.body), rawBytes: raw.body.byteLength,
    raw: { httpStatus: raw.httpStatus, receivedBytes: raw.receivedBytes }, usage, identity });
  if (choice.finish_reason === "length") return frozen({ ...base, kind: "terminal" as const, finishReason: "length" as const, reason: "length" as const, prediction: null });
  if (choice.finish_reason !== "stop" || typeof choice.message.content !== "string" || choice.message.content.trim().length === 0
    || /\p{Surrogate}/u.test(choice.message.content)) fail("failed or empty completion");
  return frozen({ ...base, kind: "completed" as const, finishReason: "stop" as const, prediction: choice.message.content.trim() });
}

export const labGpt5MiniReaderProfile = Object.freeze({ profile: PROFILE, makeRequest: makeLabGpt5MiniReaderRequest,
  reserve: reserveLabGpt5MiniReader, parse: parseLabGpt5MiniReaderResponse });
/** Closed, opt-in profiles. The original export above remains the minimal default. */
export const labGpt5MiniReaderProfiles = Object.freeze({ minimal: PROFILE, medium: MEDIUM_PROFILE });
