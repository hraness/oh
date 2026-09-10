/**
 * Private staging implementation for a future Mem0 parent bridge. It is a
 * separate authority: no existing evolution campaign store is opened or
 * modified. A future calibration must explicitly pin antecedent evolution
 * exposure in this ledger authority before dispatch.
 */
import { chmod, lstat, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { lstatSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { qualifyGatewayOIDC, type GatewayStudyAuth } from "./gateway-study-v3";
import { evolutionPin, readEvolutionPin, verifyEvolutionCampaign, type EvolutionPin } from "./evolution-budget";

const ENDPOINT = "https://ai-gateway.vercel.sh/v1";
// A deliberately small new authority bounds private receipt growth as well as spend.
const MAX_RAW = 1_048_576, MAX_REQUEST = 524_288, MAX_TEXT = 262_144, MAX_CALLS = 1_000;
const MAX_LEDGER_BYTES = MAX_CALLS * (Math.ceil(MAX_RAW * 4 / 3) + 16_384);
type Operation = "extract" | "ingest-embed" | "query-embed";
type CallKind = "llm" | "embedding";
type Transport = Readonly<{ httpStatus: number | null; complete: boolean; receivedBytes: number;
  error: "network" | "body-read" | "response-bound" | null; serviceMs: number }>;
export type Mem0CallProfile = Readonly<{ id: string; kind: CallKind; model: string; provider: string;
  endpoint: `${typeof ENDPOINT}/${"chat/completions" | "embeddings"}`; maxInputTokens: number; maxOutputTokens: number;
  embeddingDimensions: number | null; timeoutMs: number; inputNanodollarsPerToken: number; outputNanodollarsPerToken: number }>;
export type Mem0BridgePolicy = Readonly<{ protocol: "oh.memory.mem0-bridge-policy.v1"; runSha256: string;
  namespace: string; llmProfile: Mem0CallProfile; embeddingProfile: Mem0CallProfile }>;
export type Mem0AntecedentAccounting = Readonly<{ protocol: "oh.memory.mem0-antecedent-accounting.v1"; campaignPin: EvolutionPin;
  campaignSha256: string; historicalExposureMicros: number; completedCampaignExposureMicros: number; cumulativeExposureMicros: number }>;
export type Mem0LedgerAuthority = Readonly<{ protocol: "oh.memory.mem0-ledger-authority.v1"; ledgerId: string;
  directory: string; additionalBudgetMicros: number; maximumCalls: number; policyPins: readonly EvolutionPin[];
  antecedentAccountingPin: EvolutionPin }>;
export type Mem0Request = Readonly<{ protocol: "oh.memory.mem0-call.v1"; kind: CallKind; operation: Operation;
  runSha256: string; namespace: string; ordinal: number; profile: Mem0CallProfile; profileSha256: string;
  endpoint: string; body: Readonly<Record<string, unknown>>; inputUpperBound: number; reservationMicros: number;
  timeoutMs: number; requestSha256: string }>;
export type Mem0Result = Readonly<{ requestSha256: string; profileSha256: string; rawSha256: string; rawBytes: number;
  kind: CallKind; value: Readonly<{ content: string }> | Readonly<{ embedding: readonly number[] }>;
  usage: Readonly<{ inputTokens: number; outputTokens: number; tokenRateMicros: number; gatewayReportedMicros: number | null; micros: number }> }>;
export type Mem0Credential = Readonly<{ token: string; auth: GatewayStudyAuth }>;
export type Mem0BatchEmbeddingRequest = Readonly<Omit<Mem0Request, "protocol" | "kind" | "operation"> & {
  protocol: "oh.memory.mem0-call.v2"; kind: "embedding-batch"; operation: "ingest-embed" | "query-embed"; inputCount: number;
}>;
export type Mem0BatchEmbeddingResult = Readonly<Omit<Mem0Result, "kind" | "value"> & {
  protocol: "oh.memory.mem0-result.v2"; kind: "embedding-batch"; value: Readonly<{ embeddings: readonly (readonly number[])[] }>;
}>;
export type Mem0AnyRequest = Mem0Request | Mem0BatchEmbeddingRequest;
export type Mem0AnyResult = Mem0Result | Mem0BatchEmbeddingResult;
export const MEM0_MAX_BATCH_INPUTS = 100, MEM0_MAX_BATCH_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_BATCH_VECTOR_VALUES = 262_144;
function responseBound(request: Mem0AnyRequest) { return request.protocol === "oh.memory.mem0-call.v2" ? MEM0_MAX_BATCH_RESPONSE_BYTES : MAX_RAW; }
type State = "reserved" | "captured" | "settled";
type Entry = Readonly<{ request: Mem0AnyRequest; state: State; raw: Uint8Array | null; transport: Transport | null; result: Mem0AnyResult | null }>;
type Event = Readonly<{ kind: "reserved"; request: Mem0AnyRequest }> | Readonly<{ kind: "captured"; requestSha256: string; rawBase64: string; transport: Transport }>
  | Readonly<{ kind: "settled"; requestSha256: string; result: Mem0AnyResult }>;
function fail(reason: string): never { throw new TypeError(`Mem0 ledger: ${reason}.`); }
const integer = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value <= maximum;
const sha = (value: unknown) => typeof value === "string" && parseSha256Hex(value) !== null;
const namespace = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> { if (!isPlainRecord(value) || !hasExactKeys(value, keys)) fail("invalid exact object"); return value; }
function boundedText(value: unknown, maximum = MAX_TEXT): string { if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > maximum || /\p{Surrogate}/u.test(value)) fail("invalid bounded text"); return value; }
function profile(value: unknown): Mem0CallProfile {
  const current = exact(value, ["id", "kind", "model", "provider", "endpoint", "maxInputTokens", "maxOutputTokens", "embeddingDimensions", "timeoutMs", "inputNanodollarsPerToken", "outputNanodollarsPerToken"]);
  if (typeof current.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(current.id) || (current.kind !== "llm" && current.kind !== "embedding")
    || typeof current.model !== "string" || current.model.length < 1 || current.model.length > 256 || typeof current.provider !== "string" || !/^[a-z0-9-]{1,80}$/.test(current.provider)
    || current.endpoint !== `${ENDPOINT}/${current.kind === "llm" ? "chat/completions" : "embeddings"}` || !integer(current.maxInputTokens, 1_000_000)
    || !integer(current.maxOutputTokens, 32_768) || !integer(current.timeoutMs, 600_000) || current.timeoutMs === 0
    || !integer(current.inputNanodollarsPerToken, 1_000_000) || !integer(current.outputNanodollarsPerToken, 1_000_000)
    || (current.kind === "llm" && (current.maxOutputTokens === 0 || current.embeddingDimensions !== null))
    || (current.kind === "embedding" && (current.maxOutputTokens !== 0 || !integer(current.embeddingDimensions, 16_384) || current.embeddingDimensions === 0))) fail("invalid profile");
  return Object.freeze(structuredClone(current) as Mem0CallProfile);
}
export function validateMem0BridgePolicy(value: unknown): Mem0BridgePolicy {
  const current = exact(value, ["protocol", "runSha256", "namespace", "llmProfile", "embeddingProfile"]);
  const llmProfile = profile(current.llmProfile), embeddingProfile = profile(current.embeddingProfile);
  if (current.protocol !== "oh.memory.mem0-bridge-policy.v1" || !sha(current.runSha256) || !namespace(current.namespace)
    || llmProfile.kind !== "llm" || embeddingProfile.kind !== "embedding") fail("invalid bridge policy");
  return Object.freeze({ protocol: current.protocol, runSha256: current.runSha256 as string, namespace: current.namespace as string, llmProfile, embeddingProfile });
}
export function validateMem0AntecedentAccounting(value: unknown): Mem0AntecedentAccounting {
  const current = exact(value, ["protocol", "campaignPin", "campaignSha256", "historicalExposureMicros", "completedCampaignExposureMicros", "cumulativeExposureMicros"]);
  const campaignPin = evolutionPin(current.campaignPin);
  if (current.protocol !== "oh.memory.mem0-antecedent-accounting.v1" || !sha(current.campaignSha256)
    || !integer(current.historicalExposureMicros, 1_000_000_000) || !integer(current.completedCampaignExposureMicros, 1_000_000_000)
    || !integer(current.cumulativeExposureMicros, 1_000_000_000)
    || current.cumulativeExposureMicros !== current.historicalExposureMicros + current.completedCampaignExposureMicros) fail("invalid antecedent accounting");
  return Object.freeze({ protocol: current.protocol, campaignPin, campaignSha256: current.campaignSha256 as string,
    historicalExposureMicros: current.historicalExposureMicros, completedCampaignExposureMicros: current.completedCampaignExposureMicros,
    cumulativeExposureMicros: current.cumulativeExposureMicros });
}
export function validateMem0LedgerAuthority(value: unknown): Mem0LedgerAuthority {
  const current = exact(value, ["protocol", "ledgerId", "directory", "additionalBudgetMicros", "maximumCalls", "policyPins", "antecedentAccountingPin"]);
  if (!Array.isArray(current.policyPins) || current.policyPins.length < 1 || current.policyPins.length > 128) fail("invalid policy pins");
  const policyPins = current.policyPins.map(evolutionPin), antecedentAccountingPin = evolutionPin(current.antecedentAccountingPin);
  if (current.protocol !== "oh.memory.mem0-ledger-authority.v1" || typeof current.ledgerId !== "string" || !/^[a-z0-9-]{1,80}$/.test(current.ledgerId)
    || typeof current.directory !== "string" || resolve(current.directory) !== current.directory || current.directory.includes("\0") || current.directory.length > 4096
    || !integer(current.additionalBudgetMicros, 1_000_000_000) || current.additionalBudgetMicros === 0 || !integer(current.maximumCalls, MAX_CALLS) || current.maximumCalls === 0
    || new Set(policyPins.map(pin => pin.path)).size !== policyPins.length || policyPins.some(pin => pin.path === antecedentAccountingPin.path)) fail("invalid ledger authority");
  return Object.freeze({ protocol: current.protocol, ledgerId: current.ledgerId, directory: current.directory, additionalBudgetMicros: current.additionalBudgetMicros,
    maximumCalls: current.maximumCalls, policyPins: Object.freeze(policyPins), antecedentAccountingPin });
}
function cost(input: number, output: number, selected: Mem0CallProfile) { const nanos = BigInt(input) * BigInt(selected.inputNanodollarsPerToken) + BigInt(output) * BigInt(selected.outputNanodollarsPerToken); const result = Number((nanos + 999n) / 1_000n); if (!integer(result, 1_000_000_000)) fail("cost overflow"); return result; }
function bodyBase(selected: Mem0CallProfile) { return { model: selected.model, providerOptions: { gateway: { only: [selected.provider], order: [selected.provider] } } }; }
function request(preimage: Omit<Mem0Request, "requestSha256">): Mem0Request { return Object.freeze({ ...preimage, requestSha256: canonicalSha256(preimage) }); }
export function makeMem0LlmRequest(policyInput: unknown, ordinal: unknown, messages: unknown): Mem0Request {
  const policy = validateMem0BridgePolicy(policyInput), selected = policy.llmProfile;
  if (!integer(ordinal, 1_000_000) || !Array.isArray(messages) || messages.length !== 2) fail("invalid extraction RPC");
  const copied = messages.map(message => { const current = exact(message, ["role", "content"]); if ((current.role !== "system" && current.role !== "user") || !boundedText(current.content)) fail("invalid extraction message"); return { role: current.role as string, content: current.content as string }; });
  const body = Object.freeze({ ...bodyBase(selected), messages: copied, stream: false, store: false, max_tokens: selected.maxOutputTokens, response_format: { type: "json_object" } });
  const inputUpperBound = Buffer.byteLength(JSON.stringify(body)) + 2_048;
  if (inputUpperBound > selected.maxInputTokens || Buffer.byteLength(JSON.stringify(body)) > MAX_REQUEST) fail("extraction request bound exceeded");
  const profileSha256 = canonicalSha256(selected), reservationMicros = cost(selected.maxInputTokens, selected.maxOutputTokens, selected);
  return request({ protocol: "oh.memory.mem0-call.v1", kind: "llm", operation: "extract", runSha256: policy.runSha256, namespace: policy.namespace, ordinal: ordinal as number,
    profile: selected, profileSha256, endpoint: selected.endpoint, body, inputUpperBound, reservationMicros, timeoutMs: selected.timeoutMs });
}
export function makeMem0EmbeddingRequest(policyInput: unknown, ordinal: unknown, operation: unknown, text: unknown): Mem0Request {
  const policy = validateMem0BridgePolicy(policyInput), selected = policy.embeddingProfile;
  if (!integer(ordinal, 1_000_000) || (operation !== "ingest-embed" && operation !== "query-embed")) fail("invalid embedding operation");
  const body = Object.freeze({ ...bodyBase(selected), input: boundedText(text), encoding_format: "float" });
  const inputUpperBound = Buffer.byteLength(JSON.stringify(body)) + 2_048;
  if (inputUpperBound > selected.maxInputTokens || Buffer.byteLength(JSON.stringify(body)) > MAX_REQUEST) fail("embedding request bound exceeded");
  const profileSha256 = canonicalSha256(selected), reservationMicros = cost(selected.maxInputTokens, 0, selected);
  return request({ protocol: "oh.memory.mem0-call.v1", kind: "embedding", operation, runSha256: policy.runSha256, namespace: policy.namespace, ordinal: ordinal as number,
    profile: selected, profileSha256, endpoint: selected.endpoint, body, inputUpperBound, reservationMicros, timeoutMs: selected.timeoutMs });
}
/** Separate opt-in batch wire: legacy requests and result preimages are unchanged. */
export function makeMem0BatchEmbeddingRequest(policyInput: unknown, ordinal: unknown, operation: unknown, texts: unknown): Mem0BatchEmbeddingRequest {
  const policy = validateMem0BridgePolicy(policyInput), selected = policy.embeddingProfile;
  if (!integer(ordinal, 1_000_000) || operation !== "ingest-embed" && operation !== "query-embed" || !Array.isArray(texts)
    || texts.length < 1 || texts.length > MEM0_MAX_BATCH_INPUTS || texts.length * selected.embeddingDimensions! > MAX_BATCH_VECTOR_VALUES) fail("invalid bounded embedding batch");
  const copied = Object.freeze(texts.map(value => boundedText(value)));
  const body = Object.freeze({ ...bodyBase(selected), input: copied, encoding_format: "float" });
  const bodyBytes = Buffer.byteLength(JSON.stringify(body)), inputUpperBound = bodyBytes + 2_048;
  if (inputUpperBound > selected.maxInputTokens || bodyBytes > MAX_REQUEST) fail("embedding batch request bound exceeded");
  const preimage = { protocol: "oh.memory.mem0-call.v2", kind: "embedding-batch", operation, runSha256: policy.runSha256, namespace: policy.namespace,
    ordinal, profile: selected, profileSha256: canonicalSha256(selected), endpoint: selected.endpoint, body, inputCount: copied.length,
    inputUpperBound, reservationMicros: cost(selected.maxInputTokens, 0, selected), timeoutMs: selected.timeoutMs } as const;
  return Object.freeze({ ...preimage, requestSha256: canonicalSha256(preimage) });
}
/** Greedy stable subdivision: the SDK's at-most100-text RPC may need smaller
 * HTTP arrays to stay within the pinned profile's aggregate input byte bound. */
export function splitMem0EmbeddingBatch(policyInput: unknown, texts: unknown): readonly (readonly string[])[] {
  const policy = validateMem0BridgePolicy(policyInput);
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > MEM0_MAX_BATCH_INPUTS || texts.length * policy.embeddingProfile.embeddingDimensions! > MAX_BATCH_VECTOR_VALUES) fail("embedding batch list bound");
  const input = texts.map(value => boundedText(value)), groups: string[][] = []; let pending: string[] = [];
  for (const text of input) {
    // Validate every single text before any dispatcher admission.
    makeMem0BatchEmbeddingRequest(policy, 0, "ingest-embed", [text]);
    const next = [...pending, text], body = { ...bodyBase(policy.embeddingProfile), input: next, encoding_format: "float" };
    if (pending.length > 0 && (Buffer.byteLength(JSON.stringify(body)) + 2_048 > policy.embeddingProfile.maxInputTokens
      || Buffer.byteLength(JSON.stringify(body)) > MAX_REQUEST || next.length * policy.embeddingProfile.embeddingDimensions! > MAX_BATCH_VECTOR_VALUES)) { groups.push(pending); pending = [text]; }
    else pending = next;
  }
  if (pending.length) groups.push(pending);
  return Object.freeze(groups.map(group => Object.freeze(group)));
}
export function validateMem0BatchEmbeddingRequest(value: unknown): Mem0BatchEmbeddingRequest {
  const current = exact(value, ["protocol", "kind", "operation", "runSha256", "namespace", "ordinal", "profile", "profileSha256", "endpoint", "body", "inputCount", "inputUpperBound", "reservationMicros", "timeoutMs", "requestSha256"]);
  if (current.protocol !== "oh.memory.mem0-call.v2" || current.kind !== "embedding-batch" || !isPlainRecord(current.body)) fail("batch request protocol");
  const selected = profile(current.profile); if (selected.kind !== "embedding") fail("batch embedding profile");
  const rebuilt = makeMem0BatchEmbeddingRequest({ protocol: "oh.memory.mem0-bridge-policy.v1", runSha256: current.runSha256, namespace: current.namespace,
    embeddingProfile: selected, llmProfile: { ...selected, kind: "llm", endpoint: `${ENDPOINT}/chat/completions`, maxOutputTokens: 1, embeddingDimensions: null } }, current.ordinal, current.operation, current.body.input);
  if (canonicalSha256(current) !== canonicalSha256(rebuilt)) fail("batch request reconstruction changed"); return rebuilt;
}
function validateAnyRequest(value: unknown): Mem0AnyRequest { return isPlainRecord(value) && value.protocol === "oh.memory.mem0-call.v2" ? validateMem0BatchEmbeddingRequest(value) : validateMem0Request(value); }
export function validateMem0Request(value: unknown): Mem0Request {
  const current = exact(value, ["protocol", "kind", "operation", "runSha256", "namespace", "ordinal", "profile", "profileSha256", "endpoint", "body", "inputUpperBound", "reservationMicros", "timeoutMs", "requestSha256"]);
  if (current.protocol !== "oh.memory.mem0-call.v1" || (current.kind !== "llm" && current.kind !== "embedding") || (current.operation !== "extract" && current.operation !== "ingest-embed" && current.operation !== "query-embed")
    || !sha(current.runSha256) || !namespace(current.namespace) || !integer(current.ordinal, 1_000_000) || !isPlainRecord(current.body)) fail("invalid request identity");
  const selected = profile(current.profile); if (selected.kind !== current.kind || current.profileSha256 !== canonicalSha256(selected) || current.endpoint !== selected.endpoint
    || !integer(current.inputUpperBound, selected.maxInputTokens) || !integer(current.reservationMicros, 1_000_000_000) || current.reservationMicros !== cost(selected.maxInputTokens, selected.maxOutputTokens, selected)
    || current.timeoutMs !== selected.timeoutMs) fail("invalid request accounting");
  const body = current.body as Record<string, unknown>;
  const rebuilt = current.kind === "llm" ? makeMem0LlmRequest({ protocol: "oh.memory.mem0-bridge-policy.v1", runSha256: current.runSha256, namespace: current.namespace, llmProfile: selected, embeddingProfile: { ...selected, kind: "embedding", endpoint: `${ENDPOINT}/embeddings`, maxOutputTokens: 0, embeddingDimensions: 1 } }, current.ordinal, body.messages)
    : makeMem0EmbeddingRequest({ protocol: "oh.memory.mem0-bridge-policy.v1", runSha256: current.runSha256, namespace: current.namespace, llmProfile: { ...selected, kind: "llm", endpoint: `${ENDPOINT}/chat/completions`, maxOutputTokens: 1, embeddingDimensions: null }, embeddingProfile: selected }, current.ordinal, current.operation, body.input);
  if (canonicalSha256(current) !== canonicalSha256(rebuilt)) fail("request reconstruction changed");
  return rebuilt;
}
function gateway(envelope: Record<string, unknown>, selected: Mem0CallProfile, message: Record<string, unknown> = {}) {
  const copies = [envelope.providerMetadata, envelope.provider_metadata, message.providerMetadata, message.provider_metadata]
    .filter(value => value !== undefined);
  if (copies.length === 0 || copies.some(value => canonicalSha256(value) !== canonicalSha256(copies[0]))) fail("missing or conflicting gateway metadata");
  const meta = copies[0];
  if (!isPlainRecord(meta) || !isPlainRecord(meta.gateway) || !isPlainRecord(meta.gateway.routing)) fail("missing gateway routing");
  const route = meta.gateway.routing;
  if (envelope.model !== selected.model || route.finalProvider !== selected.provider || route.originalModelId !== selected.model || route.canonicalSlug !== selected.model) fail("gateway route mismatch");
  return meta.gateway as Record<string, unknown>;
}
function micros(value: unknown): number | null {
  if (typeof value === "string") {
    // Gateway can serialize dollars as a decimal string. Bound before parsing,
    // then round upward exactly so a positive fractional micro is never lost.
    if (value.length > 128) fail("gateway cost bound");
    const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
    if (!match || match[0] !== value) fail("invalid gateway cost");
    const fraction = match[2] ?? "", scale = 10n ** BigInt(fraction.length);
    const numerator = BigInt(match[1]! + fraction) * 1_000_000n;
    const result = (numerator + scale - 1n) / scale;
    if (result > 1_000_000_000n) fail("gateway cost bound");
    return Number(result);
  }
  // Preserve the historical numeric path and its settled result identities.
  if (value === undefined) return null; if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) fail("invalid gateway cost"); const result = Math.ceil(value * 1_000_000); if (!integer(result, 1_000_000_000)) fail("gateway cost bound"); return result;
}
function usageDetail(value: unknown, allowed: readonly string[], maximum: number): void {
  if (value === undefined) return;
  if (!isPlainRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) fail("ambiguous usage detail");
  for (const item of Object.values(value)) if (!integer(item, maximum)) fail("usage detail bound");
}
/** Compare decimal aliases before micro-dollar rounding; equal rounded charges
 * alone cannot establish that two reported costs agree. */
function dollarIdentity(value: unknown): string {
  if (micros(value) === null) fail("missing gateway cost alias");
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!match) fail("invalid gateway cost alias");
  let coefficient = BigInt(match[1]! + (match[2] ?? "")), exponent = Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (coefficient === 0n) return "0";
  while (coefficient % 10n === 0n) { coefficient /= 10n; exponent++; }
  return `${coefficient}e${exponent}`;
}
function usageExtensions(value: Record<string, unknown>, gatewayMeta: Record<string, unknown>): void {
  for (const [usageKey, gatewayKey] of [["cost", "cost"], ["market_cost", "marketCost"], ["gateway_cost", "gatewayCost"]] as const) {
    if (Object.hasOwn(value, usageKey) && dollarIdentity(value[usageKey]) !== dollarIdentity(gatewayMeta[gatewayKey])) fail("conflicting gateway cost alias");
  }
  if (Object.hasOwn(value, "is_byok") && value.is_byok !== false) fail("unsupported usage credential mode");
  if (Object.hasOwn(value, "cache_creation_input_tokens") && !integer(value.cache_creation_input_tokens, 0)) fail("unsupported cache creation usage");
  if (Object.hasOwn(value, "cost_details")) {
    const detail = exact(value.cost_details, ["upstream_inference_cost", "upstream_inference_prompt_cost", "upstream_inference_completions_cost"]);
    // The admitted system-credential response reports no separately billed
    // upstream/BYOK charge. Other billing modes require their own qualification.
    if (detail.upstream_inference_cost !== null && dollarIdentity(detail.upstream_inference_cost) !== "0"
      || dollarIdentity(detail.upstream_inference_prompt_cost) !== "0" || dollarIdentity(detail.upstream_inference_completions_cost) !== "0") fail("unsupported upstream usage cost");
  }
}
function parseUsage(value: unknown, request: Mem0AnyRequest, gatewayMeta: Record<string, unknown>) {
  if (!isPlainRecord(value)) fail("usage object");
  const keys = Object.keys(value).sort();
  const llm = request.kind === "llm";
  const required = llm ? ["completion_tokens", "prompt_tokens", "total_tokens"] : ["prompt_tokens", "total_tokens"];
  const extensions = ["cost", "market_cost", "gateway_cost", "is_byok", "cost_details", "cache_creation_input_tokens"];
  const allowed = llm ? [...required, "completion_tokens_details", "prompt_tokens_details", ...extensions] : [...required, "prompt_tokens_details", ...extensions];
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !allowed.includes(key))) fail("ambiguous usage metadata");
  usageExtensions(value, gatewayMeta);
  if (!integer(value.prompt_tokens, request.inputUpperBound) || !integer(value.total_tokens, request.inputUpperBound + request.profile.maxOutputTokens)) fail("usage bound");
  const output = llm ? value.completion_tokens : 0;
  if (!integer(output, request.profile.maxOutputTokens) || value.total_tokens !== value.prompt_tokens + output) fail("usage total");
  usageDetail(value.prompt_tokens_details, ["audio_tokens", "cached_tokens", "video_tokens"], value.prompt_tokens);
  if (isPlainRecord(value.prompt_tokens_details) && Object.hasOwn(value.prompt_tokens_details, "video_tokens") && value.prompt_tokens_details.video_tokens !== 0) fail("unsupported video usage");
  if (llm) {
    usageDetail(value.completion_tokens_details, ["accepted_prediction_tokens", "audio_tokens", "reasoning_tokens", "rejected_prediction_tokens", "image_tokens"], output);
    if (isPlainRecord(value.completion_tokens_details) && Object.hasOwn(value.completion_tokens_details, "image_tokens") && value.completion_tokens_details.image_tokens !== 0) fail("unsupported image usage");
  }
  const tokenRateMicros = cost(value.prompt_tokens, output, request.profile), gatewayReportedMicros = micros(gatewayMeta.cost);
  const charged = Math.max(tokenRateMicros, gatewayReportedMicros ?? 0); if (charged > request.reservationMicros) fail("usage exceeds reservation");
  return Object.freeze({ inputTokens: value.prompt_tokens, outputTokens: output, tokenRateMicros, gatewayReportedMicros, micros: charged });
}
export function parseMem0Response(raw: Uint8Array, requestInput: unknown): Mem0Result {
  const request = validateMem0Request(requestInput); if (!(raw instanceof Uint8Array) || raw.length === 0 || raw.length > MAX_RAW) fail("response bytes");
  let envelope: unknown; try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { fail("malformed response"); }
  if (!isPlainRecord(envelope)) fail("response object");
  let message: Record<string, unknown> | undefined;
  if (request.kind === "llm") {
    const choice = Array.isArray(envelope.choices) && envelope.choices.length === 1 && isPlainRecord(envelope.choices[0]) ? envelope.choices[0] : null;
    if (!choice || choice.index !== undefined && choice.index !== 0 || choice.finish_reason !== "stop" || !isPlainRecord(choice.message)
      || choice.message.role !== "assistant" || Object.hasOwn(choice.message, "refusal") && choice.message.refusal !== null
      || choice.message.tool_calls !== undefined && choice.message.tool_calls !== null
      || choice.message.function_call !== undefined && choice.message.function_call !== null) fail("LLM completion shape");
    message = choice.message;
  }
  const meta = gateway(envelope, request.profile, message), usage = parseUsage(envelope.usage, request, meta);
  let value: Mem0Result["value"];
  if (request.kind === "llm") { value = Object.freeze({ content: boundedText(message!.content) }); }
  else { if (envelope.object !== "list" || !Array.isArray(envelope.data) || envelope.data.length !== 1 || !isPlainRecord(envelope.data[0]) || envelope.data[0].index !== 0 || !Array.isArray(envelope.data[0].embedding) || envelope.data[0].embedding.length !== request.profile.embeddingDimensions || envelope.data[0].embedding.some(n => typeof n !== "number" || !Number.isFinite(n))) fail("embedding shape"); value = Object.freeze({ embedding: Object.freeze([...envelope.data[0].embedding] as number[]) }); }
  return Object.freeze({ requestSha256: request.requestSha256, profileSha256: request.profileSha256, rawSha256: sha256Hex(raw), rawBytes: raw.length, kind: request.kind, value, usage });
}
export function parseMem0BatchEmbeddingResponse(raw: Uint8Array, requestInput: unknown): Mem0BatchEmbeddingResult {
  const request = validateMem0BatchEmbeddingRequest(requestInput);
  if (!(raw instanceof Uint8Array) || raw.length === 0 || raw.length > MEM0_MAX_BATCH_RESPONSE_BYTES) fail("batch response bytes");
  let envelope: unknown; try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { fail("malformed batch response"); }
  if (!isPlainRecord(envelope)) fail("batch response object");
  const meta = gateway(envelope, request.profile), usage = parseUsage(envelope.usage, request, meta);
  if (envelope.object !== "list" || !Array.isArray(envelope.data) || envelope.data.length !== request.inputCount) fail("batch vector count");
  const vectors: (readonly number[])[] = new Array(request.inputCount), seen = new Set<number>();
  for (const item of envelope.data) {
    const row = exact(item, isPlainRecord(item) && Object.hasOwn(item, "object") ? ["index", "embedding", "object"] : ["index", "embedding"]);
    if (Object.hasOwn(row, "object") && row.object !== "embedding" || !integer(row.index, request.inputCount - 1) || seen.has(row.index)
      || !Array.isArray(row.embedding) || row.embedding.length !== request.profile.embeddingDimensions || row.embedding.some(n => typeof n !== "number" || !Number.isFinite(n))) fail("batch vector index or dimensions");
    seen.add(row.index); vectors[row.index] = Object.freeze([...row.embedding] as number[]);
  }
  return Object.freeze({ protocol: "oh.memory.mem0-result.v2", requestSha256: request.requestSha256, profileSha256: request.profileSha256, rawSha256: sha256Hex(raw), rawBytes: raw.length,
    kind: "embedding-batch", value: Object.freeze({ embeddings: Object.freeze(vectors) }), usage });
}
function parseAnyResponse(raw: Uint8Array, request: Mem0AnyRequest): Mem0AnyResult { return request.protocol === "oh.memory.mem0-call.v2" ? parseMem0BatchEmbeddingResponse(raw, request) : parseMem0Response(raw, request); }
/** Derived storage obligations; no ledger event or legacy digest changes.
 * A finite ECMAScript Number serializes in fewer than32 ASCII characters. */
const MAX_JSON_NUMBER_BYTES = 32;
export function mem0ResponseStorageUpperBounds(requestInput: unknown) {
  const request = validateAnyRequest(requestInput), rawBound = responseBound(request);
  const captureEnvelope = { kind: "captured", requestSha256: request.requestSha256, rawBase64: "", transport: {
    httpStatus: null, complete: false, receivedBytes: Number.MAX_SAFE_INTEGER, error: "response-bound", serviceMs: 0,
  } };
  const captureBytes = Buffer.byteLength(JSON.stringify(captureEnvelope)) + 1 + 4 * Math.ceil(rawBound / 3) + MAX_JSON_NUMBER_BYTES - 1;
  const usage = { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: Number.MAX_SAFE_INTEGER, tokenRateMicros: Number.MAX_SAFE_INTEGER,
    gatewayReportedMicros: Number.MAX_SAFE_INTEGER, micros: Number.MAX_SAFE_INTEGER };
  const resultBase = { requestSha256: request.requestSha256, profileSha256: request.profileSha256, rawSha256: "f".repeat(64), rawBytes: rawBound, usage };
  const vectorBytes = (dimensions: number) => 2 + dimensions * MAX_JSON_NUMBER_BYTES + Math.max(0, dimensions - 1);
  let skeleton: unknown, variableBytes: number;
  if (request.protocol === "oh.memory.mem0-call.v2") {
    skeleton = { ...resultBase, protocol: "oh.memory.mem0-result.v2", kind: "embedding-batch", value: { embeddings: [] } };
    variableBytes = 2 + request.inputCount * vectorBytes(request.profile.embeddingDimensions!) + request.inputCount - 1 - 2;
  } else if (request.kind === "embedding") {
    skeleton = { ...resultBase, kind: "embedding", value: { embedding: [] } }; variableBytes = vectorBytes(request.profile.embeddingDimensions!) - 2;
  } else {
    skeleton = { ...resultBase, kind: "llm", value: { content: "" } }; variableBytes = 6 * MAX_TEXT;
  }
  const settlementBytes = Buffer.byteLength(JSON.stringify({ kind: "settled", requestSha256: request.requestSha256, result: skeleton })) + 1 + variableBytes;
  return Object.freeze({ captureBytes, settlementBytes });
}
/** Pure admission gate permits small boundary tests without a multi-GB fixture.
 * Once a batch is involved, every outstanding format's future rows are covered. */
export function validateMem0BatchStorageAdmission(input: Readonly<{ ledgerBytes: number; pending: readonly Readonly<{ request: unknown; state: "reserved" | "captured" }>[]; request: unknown }>): number {
  if (!integer(input.ledgerBytes, MAX_LEDGER_BYTES) || !Array.isArray(input.pending) || input.pending.length > MAX_CALLS) fail("invalid storage obligations");
  const request = validateAnyRequest(input.request), next = mem0ResponseStorageUpperBounds(request);
  let requiredBytes = input.ledgerBytes + Buffer.byteLength(JSON.stringify({ kind: "reserved", request })) + 1 + next.captureBytes + next.settlementBytes;
  for (const row of input.pending) {
    if (row.state !== "reserved" && row.state !== "captured") fail("invalid outstanding storage state");
    const bound = mem0ResponseStorageUpperBounds(row.request); requiredBytes += bound.settlementBytes + (row.state === "reserved" ? bound.captureBytes : 0);
  }
  if (requiredBytes > MAX_LEDGER_BYTES) fail("batch admission lacks capture and settlement storage headroom"); return requiredBytes;
}
function transport(value: Transport, rawBytes: number): Transport { if (!isPlainRecord(value) || !hasExactKeys(value, ["httpStatus", "complete", "receivedBytes", "error", "serviceMs"]) || value.httpStatus !== null && (!integer(value.httpStatus, 599) || value.httpStatus < 100) || typeof value.complete !== "boolean" || !integer(value.receivedBytes) || value.receivedBytes < rawBytes || value.error !== null && value.error !== "network" && value.error !== "body-read" && value.error !== "response-bound" || typeof value.serviceMs !== "number" || !Number.isFinite(value.serviceMs) || value.serviceMs < 0 || value.serviceMs > 86_400_000 || value.complete && (value.error !== null || value.receivedBytes !== rawBytes)) fail("transport metadata"); return Object.freeze(structuredClone(value)); }
function event(value: unknown): Event { const current = exact(value, ["kind", ...(isPlainRecord(value) && value.kind === "reserved" ? ["request"] : isPlainRecord(value) && value.kind === "captured" ? ["requestSha256", "rawBase64", "transport"] : isPlainRecord(value) && value.kind === "settled" ? ["requestSha256", "result"] : [])]); if (current.kind === "reserved") return Object.freeze({ kind: "reserved", request: validateAnyRequest(current.request) }); if (current.kind === "captured") { if (!sha(current.requestSha256) || typeof current.rawBase64 !== "string") fail("capture event"); const raw = Buffer.from(current.rawBase64, "base64"); if (raw.length > MEM0_MAX_BATCH_RESPONSE_BYTES || raw.toString("base64") !== current.rawBase64) fail("raw encoding"); return Object.freeze({ kind: "captured", requestSha256: current.requestSha256 as string, rawBase64: current.rawBase64, transport: transport(current.transport as Transport, raw.length) }); } if (current.kind === "settled") { if (!sha(current.requestSha256) || !isPlainRecord(current.result)) fail("settlement event"); return Object.freeze({ kind: "settled", requestSha256: current.requestSha256 as string, result: current.result as Mem0AnyResult }); } fail("event kind"); }
export async function openMem0Ledger(authorityInput: unknown) {
  const authority = validateMem0LedgerAuthority(authorityInput);
  const [policyBytes, accountingBytes] = await Promise.all([
    Promise.all(authority.policyPins.map(pin => readEvolutionPin(pin, 2 * 1024 * 1024))), readEvolutionPin(authority.antecedentAccountingPin, 2 * 1024 * 1024),
  ]);
  let policyInputs: unknown[], accountingInput: unknown;
  try { policyInputs = policyBytes.map(bytes => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))); accountingInput = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(accountingBytes)); }
  catch { fail("pinned policy or accounting JSON"); }
  const policies = policyInputs.map(validateMem0BridgePolicy), accounting = validateMem0AntecedentAccounting(accountingInput);
  if (new Set(policies.map(policy => `${policy.runSha256}:${policy.namespace}`)).size !== policies.length) fail("duplicate policy identity");
  const policyFor = (request: Mem0AnyRequest) => { const policy = policies.find(candidate => candidate.runSha256 === request.runSha256 && candidate.namespace === request.namespace); if (!policy || request.profileSha256 !== (request.kind === "llm" ? canonicalSha256(policy.llmProfile) : canonicalSha256(policy.embeddingProfile))) fail("request does not match pinned policy"); };
  const campaign = await verifyEvolutionCampaign(accounting.campaignPin);
  if (canonicalSha256(campaign.campaign) !== accounting.campaignSha256 || campaign.historicalExposureMicros !== accounting.historicalExposureMicros) fail("antecedent campaign accounting differs");
  const directory = authority.directory; await mkdir(directory, { mode: 0o700, recursive: true }); const stat = lstatSync(directory); if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || realpathSync(directory) !== directory) fail("private canonical ledger directory");
  const lockPath = join(directory, "active.lock"), lock = await open(lockPath, "wx", 0o600), lockStat = await lock.stat(), ledgerPath = join(directory, "ledger.jsonl"), authorityPath = join(directory, "authority.json");
  try {
  const authorityBytes = new TextEncoder().encode(JSON.stringify(authority));
  try { const saved = await readFile(authorityPath); if (sha256Hex(saved) !== sha256Hex(authorityBytes)) fail("persisted authority changed"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(authorityPath, authorityBytes, { flag: "wx", mode: 0o600 }); }
  const persisted = await lstat(authorityPath); if (!persisted.isFile() || persisted.isSymbolicLink() || (persisted.mode & 0o777) !== 0o600 || realpathSync(authorityPath) !== authorityPath) fail("private authority receipt required");
  const entries = new Map<string, Entry>(); let exposure = 0, ledgerBytes = 0, closed = false, mutation: Promise<void> = Promise.resolve();
  const append = async (value: Event) => { const encoded = new TextEncoder().encode(`${JSON.stringify(value)}\n`); if (ledgerBytes + encoded.length > MAX_LEDGER_BYTES) fail("ledger storage bound"); const handle = await open(ledgerPath, "a", 0o600); try { await handle.writeFile(encoded); await handle.sync(); ledgerBytes += encoded.length; } finally { await handle.close(); } };
  const mutate = <T>(action: () => Promise<T>): Promise<T> => { const next = mutation.then(action, action); mutation = next.then(() => undefined, () => undefined); return next; };
    try { const ledgerStat = await lstat(ledgerPath); if (!ledgerStat.isFile() || ledgerStat.isSymbolicLink() || ledgerStat.size > MAX_LEDGER_BYTES || realpathSync(ledgerPath) !== ledgerPath) fail("ledger file custody or bound"); ledgerBytes = ledgerStat.size;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(ledgerPath)); if (!text.endsWith("\n")) fail("partial ledger"); for (const line of text.slice(0, -1).split("\n")) { if (!line) continue; const next = event(JSON.parse(line)); if (next.kind === "reserved") { policyFor(next.request); if (entries.has(next.request.requestSha256)) fail("duplicate reservation"); entries.set(next.request.requestSha256, { request: next.request, state: "reserved", raw: null, transport: null, result: null }); exposure += next.request.reservationMicros; } else { const found = entries.get(next.requestSha256); if (found === undefined || found.state === "settled") fail("orphan or duplicate event"); if (next.kind === "captured") { if (found.state !== "reserved" || Buffer.from(next.rawBase64, "base64").length > responseBound(found.request)) fail("capture order or response bound"); entries.set(next.requestSha256, { ...found, state: "captured", raw: Buffer.from(next.rawBase64, "base64"), transport: next.transport }); } else { if (found.state !== "captured" || found.raw === null || found.transport === null || found.transport.httpStatus !== 200 || !found.transport.complete || found.transport.error !== null) fail("settlement transport"); const result = parseAnyResponse(found.raw, found.request); if (canonicalSha256(result) !== canonicalSha256(next.result)) fail("settlement replay"); entries.set(next.requestSha256, { ...found, state: "settled", result }); exposure += result.usage.micros - found.request.reservationMicros; } } } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (entries.size > authority.maximumCalls || exposure > authority.additionalBudgetMicros) fail("replayed budget");
    const custody = () => { if (closed || lstatSync(lockPath).ino !== lockStat.ino) fail("ledger closed or custody changed"); };
    return {
      summary: () => { custody(); return Object.freeze({ calls: entries.size, exposureMicros: exposure, antecedentExposureMicros: accounting.cumulativeExposureMicros, combinedExposureMicros: exposure + accounting.cumulativeExposureMicros, additionalBudgetMicros: authority.additionalBudgetMicros, maximumCalls: authority.maximumCalls, policySha256es: Object.freeze(policyBytes.map(sha256Hex)), antecedentAccountingSha256: sha256Hex(accountingBytes) }); },
      auth: campaign.auth,
      lookup: (requestInput: unknown) => { custody(); const request = validateAnyRequest(requestInput), found = entries.get(request.requestSha256); if (!found) return { kind: "miss" as const }; if (found.state === "settled") return { kind: "hit" as const, result: found.result! }; return { kind: "occupied" as const, state: found.state }; },
      /** Read-only evidence for an explicitly authorized ingestion-vector recovery.
       * An empty transport failure remains occupied and fully reserved. */
      inspectIngestEmbeddingFailure: (requestInput: unknown) => {
        custody(); const request = validateMem0Request(requestInput), found = entries.get(request.requestSha256);
        if (request.kind !== "embedding" || request.operation !== "ingest-embed" || !found
          || found.state !== "captured" || found.raw === null || found.raw.length !== 0 || found.transport === null
          || found.transport.httpStatus !== null || found.transport.complete || found.transport.receivedBytes !== 0
          || found.transport.error !== "network") fail("ineligible ingestion embedding recovery failure");
        const evidence = Object.freeze({ protocol: "oh.memory.mem0-ingest-embedding-failure.v1" as const,
          requestSha256: request.requestSha256, rawSha256: sha256Hex(found.raw), transport: Object.freeze({ ...found.transport }) });
        return Object.freeze({ ...evidence, evidenceSha256: canonicalSha256(evidence) });
      },
      admit: (requestInput: unknown) => mutate(async () => { custody(); const request = validateAnyRequest(requestInput); policyFor(request); if (entries.has(request.requestSha256) || entries.size >= authority.maximumCalls || exposure + request.reservationMicros > authority.additionalBudgetMicros) fail("duplicate or exhausted admission");
        if (request.protocol === "oh.memory.mem0-call.v2" || [...entries.values()].some(entry => entry.request.protocol === "oh.memory.mem0-call.v2")) {
          const pending = [...entries.values()].filter(entry => entry.state !== "settled").map(entry => ({ request: entry.request, state: entry.state as "reserved" | "captured" }));
          validateMem0BatchStorageAdmission({ ledgerBytes, pending, request });
        }
        await append({ kind: "reserved", request }); entries.set(request.requestSha256, { request, state: "reserved", raw: null, transport: null, result: null }); exposure += request.reservationMicros; }),
      capture: (requestInput: unknown, raw: Uint8Array, meta: Transport) => { const snapshot = raw.slice(), checked = transport(meta, snapshot.length); return mutate(async () => { custody(); const request = validateAnyRequest(requestInput), found = entries.get(request.requestSha256); if (!found || found.state !== "reserved" || snapshot.length > responseBound(request)) fail("capture requires reservation"); await append({ kind: "captured", requestSha256: request.requestSha256, rawBase64: Buffer.from(snapshot).toString("base64"), transport: checked }); entries.set(request.requestSha256, { ...found, state: "captured", raw: snapshot, transport: checked }); }); },
      finalize: (requestInput: unknown) => mutate(async () => { custody(); const request = validateAnyRequest(requestInput), found = entries.get(request.requestSha256); if (!found || found.state !== "captured" || !found.raw || !found.transport || found.transport.httpStatus !== 200 || !found.transport.complete || found.transport.error !== null) fail("unverifiable first response remains charged"); const result = parseAnyResponse(found.raw, request); await append({ kind: "settled", requestSha256: request.requestSha256, result }); entries.set(request.requestSha256, { ...found, state: "settled", result }); exposure += result.usage.micros - request.reservationMicros; return result; }),
      close: async () => { await mutation; if (closed) return; closed = true; await lock.close(); try { if (lstatSync(lockPath).ino === lockStat.ino) await unlink(lockPath); } catch { /* custody marker was replaced or removed */ } },
    };
  } catch (error) { await lock.close(); try { await unlink(lockPath); } catch {} throw error; }
}
/** Abort races also bound an injected transport or stalled response stream.
 * Any admitted interrupted call is captured once and remains fully reserved. */
function mem0WithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Mem0 call aborted or deadline exceeded"));
    operation.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
}
export type Mem0Fetcher = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;
type Mem0Invocation<T extends Mem0AnyRequest> = Readonly<{ request: T; ledger: Awaited<ReturnType<typeof openMem0Ledger>>; credential: Mem0Credential; fetcher?: Mem0Fetcher; signal?: AbortSignal }>;
export function invokeMem0Request(input: Mem0Invocation<Mem0Request>): Promise<Mem0Result>;
export function invokeMem0Request(input: Mem0Invocation<Mem0BatchEmbeddingRequest>): Promise<Mem0BatchEmbeddingResult>;
export function invokeMem0Request(input: Mem0Invocation<Mem0AnyRequest>): Promise<Mem0AnyResult>;
export async function invokeMem0Request(input: Mem0Invocation<Mem0AnyRequest>): Promise<Mem0AnyResult> {
  if (input.signal?.aborted) fail("call aborted before admission");
  const request = validateAnyRequest(input.request), cached = input.ledger.lookup(request); if (cached.kind === "hit") return cached.result; if (cached.kind === "occupied") fail("occupied request cannot be retried");
  if (typeof input.credential.token !== "string" || input.credential.token.length < 1 || input.credential.token.length > 32768 || canonicalSha256(input.credential.auth) !== canonicalSha256(input.ledger.auth)) fail("missing or mismatched bounded OIDC credential"); qualifyGatewayOIDC(input.credential.token, input.ledger.auth); await input.ledger.admit(request);
  const signal = input.signal === undefined ? AbortSignal.timeout(request.timeoutMs) : AbortSignal.any([input.signal, AbortSignal.timeout(request.timeoutMs)]);
  const started = performance.now(); let response: Response | null = null, error: Transport["error"] = null, complete = false, receivedBytes = 0; const chunks: Uint8Array[] = [];
  try { response = await mem0WithAbort((input.fetcher ?? fetch)(request.endpoint, { method: "POST", redirect: "error", signal, headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.credential.token}` }, body: JSON.stringify(request.body) }), signal); } catch { error = "network"; }
  if (response?.body) { const reader = response.body.getReader(); try { while (true) { const next = await mem0WithAbort(reader.read(), signal); if (next.done) { complete = true; break; } receivedBytes += next.value.length; if (receivedBytes > responseBound(request)) { error = "response-bound"; break; } chunks.push(next.value); } } catch { error = "body-read"; } finally { try { await mem0WithAbort(reader.cancel(), signal); } catch {} } } else if (response !== null) error = "body-read";
  const raw = Buffer.concat(chunks); await input.ledger.capture(request, raw, { httpStatus: response?.status ?? null, complete, receivedBytes, error, serviceMs: performance.now() - started }); return await input.ledger.finalize(request);
}
