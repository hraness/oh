import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import type { Message } from "./model";
import { EVOLUTION_READER_CONTRACTS, parseEvolutionReaderContractId, type EvolutionReaderContractId, type EvolutionReaderAblationContractId } from "./evolution-reader-contracts";

export const EVOLUTION_GATEWAY_ENDPOINT = "https://ai-gateway.vercel.sh/v1/chat/completions";
export const EVOLUTION_OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
export const EVOLUTION_RESPONSE_MAX_BYTES = 1_048_576;
export const EVOLUTION_MODEL_PROTOCOL = "oh.memory.evolution-model.v1";
export const EVOLUTION_MODEL_V2_PROTOCOL = "oh.memory.evolution-model.v2";
export const EVOLUTION_PROFILE_WINDOW_INPUT_TOKENS = 400_000;
export const EVOLUTION_PROFILE_WINDOW_MAX_BODY_BYTES = 2 * 1024 * 1024;

export const EVOLUTION_BASE_READER_IDS = ["qwen37-flash-reader", "gpt5-nano-reader", "gemini25-flash-lite-reader",
  "gpt5-nano-medium-reader", "gpt5-nano-high-reader", "gpt5-mini-reader"] as const;
export type EvolutionBaseReaderId = typeof EVOLUTION_BASE_READER_IDS[number];
type ReaderStem<T> = T extends `${infer Stem}-reader` ? Stem : never;
export type EvolutionAblationReaderId = `${ReaderStem<EvolutionBaseReaderId>}-${EvolutionReaderAblationContractId}-reader`;
export type EvolutionLegacyProfileId = EvolutionBaseReaderId | "gpt4o-gateway-judge" | "gpt4o-official-snapshot-judge"
  | "gpt4o-gateway-native-rubric-judge-v1" | "gpt4o-gateway-native-rubric-16-judge-v1";
export type EvolutionProfileId = EvolutionLegacyProfileId | EvolutionAblationReaderId;
/** Integer nanodollars per token: 30 means $0.03 per million tokens. */
type PriceTier = Readonly<{ fromInputTokens: number; input: number; cachedInput: number; cacheWrite: number; output: number }>;
export type EvolutionModelProfile = Readonly<{ id: EvolutionProfileId; model: string; provider: string;
  endpoint: string; contextWindow: number; maxOutputTokens: number; timeoutMs: number;
  qualification: "gateway-alias" | "official-snapshot-request"; expectedSnapshot: string | null;
  settings: Readonly<{ temperature?: number; reasoning?: Readonly<{ effort?: string; enabled?: boolean }> }>;
  pricingCheckedAt: "2026-09-09"; prices: readonly PriceTier[];
  readerContract?: Readonly<{ baseReader: EvolutionBaseReaderId; id: EvolutionReaderAblationContractId; instructionSha256: string }> }>;
type Body = Readonly<{ model: string; messages: readonly Message[]; stream: false; store: false; max_tokens: number;
  temperature?: number; reasoning?: Readonly<{ effort?: string; enabled?: boolean }>;
  providerOptions?: Readonly<{ gateway: Readonly<{ only: readonly string[]; order: readonly string[] }> }> }>;
type EvolutionRequestCommon = Readonly<{ profileId: EvolutionProfileId;
  endpoint: string; body: Body; model: string; provider: string; requestSha256: string; profileSha256: string;
  inputUpperBound: number; maxOutputTokens: number; reservationMicros: number; timeoutMs: number }>;
export type EvolutionRequestV1 = EvolutionRequestCommon & Readonly<{ protocol: typeof EVOLUTION_MODEL_PROTOCOL }>;
/** Full-history route: the profile window is reserved financially while tokenizer fit remains explicitly unknown. */
export type EvolutionInputAccountingV2 = Readonly<{ protocol: "profile-window-v1"; tokenizerFit: "unknown";
  providerWindowAcceptance: "required"; profileWindowInputTokens: typeof EVOLUTION_PROFILE_WINDOW_INPUT_TOKENS;
  bodyBytes: number; bodySha256: string }>;
export type EvolutionRequestV2 = EvolutionRequestCommon & Readonly<{ protocol: typeof EVOLUTION_MODEL_V2_PROTOCOL;
  inputAccounting: EvolutionInputAccountingV2 }>;
export type EvolutionRequest = EvolutionRequestV1 | EvolutionRequestV2;
export type EvolutionUsage = Readonly<{ inputTokens: number; cachedInputTokens: number; outputTokens: number;
  reasoningTokens: number; tokenRateMicros: number; gatewayReportedMicros: number | null; micros: number }>;
export type EvolutionIdentity = Readonly<{ requestedModel: string; reportedModel: string; finalProvider: string;
  resolvedProviderApiModelId: string | null; qualification: EvolutionModelProfile["qualification"];
  snapshotPinned: boolean; resolvedSnapshot: string | null }>;
export type EvolutionResponse = Readonly<{ requestSha256: string; profileSha256: string; rawSha256: string; rawBytes: number;
  answer: string | null; partialAnswer: string | null; status: "completed" | "truncated" | "refused" | "failed";
  finishReason: string | null; failureReason: string | null; usage: EvolutionUsage; identity: EvolutionIdentity }>;

function fail(reason: string): never { throw new TypeError(`Evolution model: ${reason}.`); }
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
const tier = (input: number, cachedInput: number, output: number, cacheWrite = input, fromInputTokens = 0): PriceTier =>
  ({ fromInputTokens, input, cachedInput, cacheWrite, output });
function profile(id: EvolutionProfileId, model: string, provider: string, contextWindow: number,
  maxOutputTokens: number, settings: EvolutionModelProfile["settings"], prices: readonly PriceTier[], snapshot: string | null = null): EvolutionModelProfile {
  return { id, model, provider, endpoint: snapshot === null ? EVOLUTION_GATEWAY_ENDPOINT : EVOLUTION_OPENAI_ENDPOINT,
    contextWindow, maxOutputTokens, timeoutMs: 120_000, settings, prices, pricingCheckedAt: "2026-09-09",
    qualification: snapshot === null ? "gateway-alias" : "official-snapshot-request", expectedSnapshot: snapshot };
}

/** Closed research profiles. Listing and request construction do not imply live provider qualification. */
const LEGACY_PROFILES: Readonly<Record<EvolutionLegacyProfileId, EvolutionModelProfile>> = frozen({
  "qwen37-flash-reader": profile("qwen37-flash-reader", "alibaba/qwen3.7-flash", "alibaba", 991_000, 2_048,
    { temperature: 0, reasoning: { effort: "none" } }, [tier(30, 6, 130, 40), tier(100, 20, 400, 125, 32_000), tier(200, 40, 800, 250, 256_000)]),
  "gpt5-nano-reader": profile("gpt5-nano-reader", "openai/gpt-5-nano", "openai", 400_000, 8_192,
    { reasoning: { effort: "low" } }, [tier(50, 5, 400)]),
  "gpt5-nano-medium-reader": profile("gpt5-nano-medium-reader", "openai/gpt-5-nano", "openai", 400_000, 8_192,
    { reasoning: { effort: "medium" } }, [tier(50, 5, 400)]),
  "gpt5-nano-high-reader": profile("gpt5-nano-high-reader", "openai/gpt-5-nano", "openai", 400_000, 8_192,
    { reasoning: { effort: "high" } }, [tier(50, 5, 400)]),
  "gemini25-flash-lite-reader": profile("gemini25-flash-lite-reader", "google/gemini-2.5-flash-lite", "google", 1_048_576, 2_048,
    { temperature: 0, reasoning: { effort: "none" } }, [tier(100, 10, 400)]),
  "gpt5-mini-reader": profile("gpt5-mini-reader", "openai/gpt-5-mini", "openai", 400_000, 8_192,
    { reasoning: { effort: "medium" } }, [tier(250, 25, 2_000)]),
  "gpt4o-gateway-judge": profile("gpt4o-gateway-judge", "openai/gpt-4o", "openai", 128_000, 16,
    { temperature: 0 }, [tier(2_500, 1_250, 10_000)]),
  "gpt4o-gateway-native-rubric-16-judge-v1": profile("gpt4o-gateway-native-rubric-16-judge-v1", "openai/gpt-4o", "openai", 128_000, 16,
    { temperature: 0 }, [tier(2_500, 1_250, 10_000)]),
  "gpt4o-gateway-native-rubric-judge-v1": profile("gpt4o-gateway-native-rubric-judge-v1", "openai/gpt-4o", "openai", 128_000, 10,
    { temperature: 0 }, [tier(2_500, 1_250, 10_000)]),
  "gpt4o-official-snapshot-judge": profile("gpt4o-official-snapshot-judge", "gpt-4o-2024-08-06", "openai", 128_000, 10,
    { temperature: 0 }, [tier(2_500, 1_250, 10_000)], "gpt-4o-2024-08-06"),
});

/** Resolve a closed model/effort × answer-contract choice without changing legacy identities. */
export function evolutionReaderProfileId(baseReader: EvolutionBaseReaderId, contract: EvolutionReaderContractId = "legacy-v1"): EvolutionBaseReaderId | EvolutionAblationReaderId {
  if (!EVOLUTION_BASE_READER_IDS.includes(baseReader)) fail("unknown base reader");
  const id = parseEvolutionReaderContractId(contract);
  return id === "legacy-v1" ? baseReader : `${baseReader.slice(0, -7)}-${id}-reader` as EvolutionAblationReaderId;
}
const ablationProfiles = Object.fromEntries(EVOLUTION_BASE_READER_IDS.flatMap(baseReader =>
  (["explicit-abstention-v1", "composition-v1", "explicit-abstention-composition-v1"] as const).map(contract => {
    const id = evolutionReaderProfileId(baseReader, contract), base = LEGACY_PROFILES[baseReader];
    return [id, { ...base, id, readerContract: { baseReader, id: contract, instructionSha256: EVOLUTION_READER_CONTRACTS[contract].instructionSha256 } }];
  }))) as unknown as Record<EvolutionAblationReaderId, EvolutionModelProfile>;
export const EVOLUTION_PROFILES: Readonly<Record<EvolutionProfileId, EvolutionModelProfile>> = frozen({ ...LEGACY_PROFILES, ...ablationProfiles });
export function evolutionReaderContract(profileId: EvolutionProfileId): EvolutionReaderContractId {
  const selected = getProfile(profileId);
  if (!profileId.endsWith("-reader")) fail("reader contract requires a reader profile");
  return selected.readerContract?.id ?? "legacy-v1";
}
export function supportsEvolutionProfileWindow(profileId: EvolutionProfileId): boolean {
  const selected = getProfile(profileId), base = selected.readerContract?.baseReader ?? selected.id;
  return ["gpt5-nano-reader", "gpt5-nano-medium-reader", "gpt5-nano-high-reader", "gpt5-mini-reader"].includes(base)
    && selected.contextWindow === EVOLUTION_PROFILE_WINDOW_INPUT_TOKENS && selected.maxOutputTokens === 8_192;
}

function getProfile(value: unknown): EvolutionModelProfile {
  if (typeof value !== "string" || !Object.hasOwn(EVOLUTION_PROFILES, value)) fail("unknown profile");
  return EVOLUTION_PROFILES[value as EvolutionProfileId];
}
function validMessages(value: unknown, selected: EvolutionModelProfile): value is readonly Message[] {
  const nativeJudge = selected.qualification === "official-snapshot-request" || selected.id === "gpt4o-gateway-native-rubric-judge-v1" || selected.id === "gpt4o-gateway-native-rubric-16-judge-v1";
  return Array.isArray(value) && (nativeJudge
    ? value.length === 1 && value[0]?.role === "user"
    : value.length === 2 && value[0]?.role === "system" && value[1]?.role === "user")
    && value.every(message => isPlainRecord(message) && hasExactKeys(message, ["role", "content"])
      && typeof message.content === "string" && message.content.length > 0 && message.content.length <= 1_048_576
      && !/\p{Surrogate}/u.test(message.content));
}
function ceilingMicros(nanodollars: bigint): number {
  const value = Number((nanodollars + 999n) / 1_000n);
  if (!integer(value)) fail("cost overflow");
  return value;
}
function rateCost(input: number, cached: number, output: number, price: PriceTier, reserve = false): number {
  return ceilingMicros(BigInt(input - cached) * BigInt(reserve ? Math.max(price.input, price.cacheWrite) : price.input)
    + BigInt(cached) * BigInt(price.cachedInput) + BigInt(output) * BigInt(price.output));
}
function applicablePrice(prices: readonly PriceTier[], input: number): PriceTier {
  return prices.filter(price => price.fromInputTokens <= input).at(-1)!;
}

/** Pure, immutable request preparation; the caller owns admission, raw-byte capture, transport and settlement. */
export function makeEvolutionRequest(profileId: EvolutionProfileId, messages: readonly Message[]): EvolutionRequest {
  const selected = getProfile(profileId);
  if (!validMessages(messages, selected)) fail("invalid prompt shape");
  const copied = structuredClone(messages);
  const body: Body = { model: selected.model, messages: copied, stream: false, store: false, max_tokens: selected.maxOutputTokens,
    ...structuredClone(selected.settings), ...(selected.endpoint === EVOLUTION_GATEWAY_ENDPOINT
      ? { providerOptions: { gateway: { only: [selected.provider], order: [selected.provider] } } } : {}) };
  // UTF-8 bytes plus framing is intentionally looser than an estimated token count. No silent truncation.
  const inputUpperBound = Buffer.byteLength(JSON.stringify(copied)) + 2_048;
  if (inputUpperBound + selected.maxOutputTokens > selected.contextWindow) fail("conservative context bound exceeded");
  const profileSha256 = canonicalSha256(selected);
  const reservationMicros = rateCost(inputUpperBound, 0, selected.maxOutputTokens,
    applicablePrice(selected.prices, inputUpperBound), true);
  const preimage: Omit<EvolutionRequestV1, "requestSha256"> = { protocol: EVOLUTION_MODEL_PROTOCOL, profileId, endpoint: selected.endpoint, body, model: selected.model,
    provider: selected.provider, profileSha256, inputUpperBound, maxOutputTokens: selected.maxOutputTokens,
    reservationMicros, timeoutMs: selected.timeoutMs };
  return frozen({ ...preimage, requestSha256: canonicalSha256(preimage) });
}

/** Explicit unqualified full-history admission. This reserves the whole supported input window and never estimates bytes as tokens. */
export function makeEvolutionProfileWindowRequest(profileId: EvolutionProfileId, messages: readonly Message[]): EvolutionRequestV2 {
  const selected = getProfile(profileId);
  if (!supportsEvolutionProfileWindow(profileId) || !validMessages(messages, selected)) fail("invalid profile-window prompt");
  const copied = structuredClone(messages);
  const body: Body = { model: selected.model, messages: copied, stream: false, store: false, max_tokens: selected.maxOutputTokens,
    ...structuredClone(selected.settings), ...(selected.endpoint === EVOLUTION_GATEWAY_ENDPOINT
      ? { providerOptions: { gateway: { only: [selected.provider], order: [selected.provider] } } } : {}) };
  const encodedBody = JSON.stringify(body), bodyBytes = Buffer.byteLength(encodedBody);
  if (bodyBytes > EVOLUTION_PROFILE_WINDOW_MAX_BODY_BYTES) fail("profile-window body bound exceeded");
  const inputAccounting: EvolutionInputAccountingV2 = { protocol: "profile-window-v1", tokenizerFit: "unknown",
    providerWindowAcceptance: "required", profileWindowInputTokens: EVOLUTION_PROFILE_WINDOW_INPUT_TOKENS,
    bodyBytes, bodySha256: sha256Hex(encodedBody) };
  const profileSha256 = canonicalSha256(selected), inputUpperBound = EVOLUTION_PROFILE_WINDOW_INPUT_TOKENS;
  const reservationMicros = rateCost(inputUpperBound, 0, selected.maxOutputTokens,
    applicablePrice(selected.prices, inputUpperBound), true);
  const preimage: Omit<EvolutionRequestV2, "requestSha256"> = { protocol: EVOLUTION_MODEL_V2_PROTOCOL, profileId, endpoint: selected.endpoint,
    body, model: selected.model, provider: selected.provider, profileSha256, inputUpperBound, maxOutputTokens: selected.maxOutputTokens,
    reservationMicros, timeoutMs: selected.timeoutMs, inputAccounting };
  return frozen({ ...preimage, requestSha256: canonicalSha256(preimage) });
}

export function validateEvolutionRequest(value: EvolutionRequest): EvolutionRequest {
  if (!isPlainRecord(value) || !isPlainRecord(value.body)) fail("invalid request");
  const expected = value.protocol === EVOLUTION_MODEL_PROTOCOL ? makeEvolutionRequest(value.profileId, value.body.messages)
    : value.protocol === EVOLUTION_MODEL_V2_PROTOCOL ? makeEvolutionProfileWindowRequest(value.profileId, value.body.messages) : fail("unknown request protocol");
  if (canonicalSha256(value) !== canonicalSha256(expected)) fail("request changed after preparation");
  return expected;
}
function boundedJson(value: unknown): void {
  const pending: Array<readonly [unknown, number]> = [[value, 0]];
  let nodes = 0;
  while (pending.length > 0) {
    const [current, depth] = pending.pop()!;
    if (++nodes > 20_000 || depth > 32) fail("response structure bound exceeded");
    if (current !== null && typeof current === "object") {
      for (const child of Object.values(current)) pending.push([child, depth + 1]);
    }
  }
}
function gatewayMetadata(envelope: Record<string, unknown>, message: Record<string, unknown>): Record<string, unknown> {
  const copies = [envelope.providerMetadata, envelope.provider_metadata, message.providerMetadata, message.provider_metadata]
    .filter(value => value !== undefined);
  if (copies.length === 0 || copies.some(value => canonicalSha256(value) !== canonicalSha256(copies[0]))) fail("missing or conflicting Gateway metadata");
  const metadata = copies[0];
  if (!isPlainRecord(metadata) || !isPlainRecord(metadata.gateway) || !isPlainRecord(metadata.gateway.routing)) fail("missing Gateway routing");
  return metadata.gateway;
}
function compatibleModel(value: unknown, model: string): value is string {
  if (typeof value !== "string") return false;
  const family = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  const candidate = value.startsWith(model.slice(0, model.indexOf("/") + 1)) && value.includes("/") ? value.slice(value.indexOf("/") + 1) : value;
  if (candidate === family) return true;
  if (!candidate.startsWith(`${family}-`)) return false;
  const date = candidate.slice(family.length + 1);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))
    && new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
}
function identity(envelope: Record<string, unknown>, gateway: Record<string, unknown> | null, selected: EvolutionModelProfile): EvolutionIdentity {
  if (selected.expectedSnapshot !== null) {
    if (gateway !== null || envelope.model !== selected.expectedSnapshot) fail("official snapshot mismatch");
    return { requestedModel: selected.model, reportedModel: selected.expectedSnapshot, finalProvider: selected.provider,
      resolvedProviderApiModelId: selected.expectedSnapshot, qualification: selected.qualification,
      snapshotPinned: true, resolvedSnapshot: selected.expectedSnapshot };
  }
  if (gateway === null || !isPlainRecord(gateway.routing)) fail("missing Gateway routing");
  const route = gateway.routing;
  if (!compatibleModel(envelope.model, selected.model) || route.finalProvider !== selected.provider
    || route.originalModelId !== selected.model || route.canonicalSlug !== selected.model) fail("model or provider mismatch");
  const resolved = route.resolvedProviderApiModelId;
  if (resolved !== undefined && resolved !== null && !compatibleModel(resolved, selected.model)) fail("resolved model mismatch");
  const strip = (model: string) => model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  const family = strip(selected.model), reported = strip(envelope.model);
  if (typeof resolved === "string" && reported !== family && strip(resolved) !== family && strip(resolved) !== reported) fail("conflicting resolved snapshots");
  // An alias request is never retroactively promoted to the official snapshot treatment.
  return { requestedModel: selected.model, reportedModel: envelope.model, finalProvider: selected.provider,
    resolvedProviderApiModelId: typeof resolved === "string" ? resolved : null,
    qualification: selected.qualification, snapshotPinned: false,
    resolvedSnapshot: typeof resolved === "string" && strip(resolved) !== family ? strip(resolved) : null };
}
function dollarMicros(value: unknown): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || Object.is(value, -0)) fail("invalid Gateway cost");
    const result = Math.ceil(value * 1_000_000);
    if (!integer(result)) fail("invalid Gateway cost");
    return result;
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,12})?$/.test(value)) fail("invalid Gateway cost");
  const [whole, fraction = ""] = value.split(".");
  const pico = BigInt(whole!) * 1_000_000_000_000n + BigInt(fraction.padEnd(12, "0"));
  const result = Number((pico + 999_999n) / 1_000_000n);
  if (!integer(result)) fail("invalid Gateway cost");
  return result;
}
function usage(value: unknown, gateway: Record<string, unknown> | null, selected: EvolutionModelProfile, request: EvolutionRequest): EvolutionUsage {
  if (!isPlainRecord(value) || !integer(value.prompt_tokens) || !integer(value.completion_tokens)
    || value.total_tokens !== value.prompt_tokens + value.completion_tokens
    || value.prompt_tokens > request.inputUpperBound || value.completion_tokens > request.maxOutputTokens) fail("invalid usage or token cap");
  const inputDetails = value.prompt_tokens_details, outputDetails = value.completion_tokens_details;
  if ((inputDetails !== undefined && inputDetails !== null && !isPlainRecord(inputDetails))
    || (outputDetails !== undefined && outputDetails !== null && !isPlainRecord(outputDetails))) fail("invalid usage details");
  const cached = isPlainRecord(inputDetails) ? inputDetails.cached_tokens ?? 0 : 0;
  const reasoning = isPlainRecord(outputDetails) ? outputDetails.reasoning_tokens ?? 0 : 0;
  if (!integer(cached) || cached > value.prompt_tokens || !integer(reasoning) || reasoning > value.completion_tokens) fail("invalid cached or reasoning usage");
  const tokenRateMicros = rateCost(value.prompt_tokens, cached, value.completion_tokens, applicablePrice(selected.prices, value.prompt_tokens));
  const gatewayReportedMicros = gateway?.cost === undefined ? null : dollarMicros(gateway.cost);
  const micros = Math.max(tokenRateMicros, gatewayReportedMicros ?? 0);
  if (!integer(micros) || micros > request.reservationMicros) fail("usage exceeds reservation");
  return { inputTokens: value.prompt_tokens, cachedInputTokens: cached, outputTokens: value.completion_tokens,
    reasoningTokens: reasoning, tokenRateMicros, gatewayReportedMicros, micros };
}

/** Requires captured complete successful-HTTP bytes. Unverifiable responses throw; retain raw bytes and the reservation. */
export function parseEvolutionResponse(raw: Uint8Array, requestInput: EvolutionRequest): EvolutionResponse {
  const request = validateEvolutionRequest(requestInput), selected = getProfile(request.profileId);
  if (!(raw instanceof Uint8Array) || raw.byteLength === 0 || raw.byteLength > EVOLUTION_RESPONSE_MAX_BYTES) fail("response byte bound exceeded");
  let envelope: unknown;
  try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { return fail("malformed response bytes"); }
  boundedJson(envelope);
  if (!isPlainRecord(envelope) || !Array.isArray(envelope.choices) || envelope.choices.length !== 1) fail("ambiguous response choices");
  const choice = envelope.choices[0];
  if (!isPlainRecord(choice) || (choice.index !== undefined && choice.index !== 0) || !isPlainRecord(choice.message)
    || choice.message.role !== "assistant") fail("invalid completion message");
  const message = choice.message;
  const gateway = selected.endpoint === EVOLUTION_GATEWAY_ENDPOINT ? gatewayMetadata(envelope, message) : null;
  const checkedIdentity = identity(envelope, gateway, selected), checkedUsage = usage(envelope.usage, gateway, selected, request);
  const finishReason = choice.finish_reason;
  if (finishReason !== null && (typeof finishReason !== "string" || finishReason.length > 64)) fail("invalid finish reason");
  if (message.content !== undefined && message.content !== null && typeof message.content !== "string") fail("non-text completion");
  if (typeof message.content === "string" && /\p{Surrogate}/u.test(message.content)) fail("invalid completion unicode");
  const partialAnswer = typeof message.content === "string" ? message.content.trim() : null;
  const tools = (message.tool_calls !== undefined && message.tool_calls !== null) || (message.function_call !== undefined && message.function_call !== null);
  const refused = finishReason === "content_filter" || (typeof message.refusal === "string" && message.refusal.length > 0);
  const status = tools ? "failed" : finishReason === "length" ? "truncated" : refused ? "refused"
    : finishReason === "stop" && partialAnswer !== null && partialAnswer.length > 0 ? "completed" : "failed";
  return frozen({ requestSha256: request.requestSha256, profileSha256: request.profileSha256, rawSha256: sha256Hex(raw), rawBytes: raw.byteLength,
    status, answer: status === "completed" ? partialAnswer : null, partialAnswer, finishReason,
    failureReason: status === "completed" ? null : tools ? "unexpected-tool-call" : status === "truncated" ? "output-token-limit"
      : refused ? "provider-refusal" : "empty-or-unsuccessful-completion", usage: checkedUsage, identity: checkedIdentity });
}
