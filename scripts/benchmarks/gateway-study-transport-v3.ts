import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { ledgerExposure, MODELS, type Message } from "./model";
import { EXTRACTION_SCHEMA } from "./units";

export const GATEWAY_STUDY_TRANSPORT = "oh.memory-gateway-transport.v3" as const;
export const GATEWAY_STUDY_MAX_USD = 40;
export const GATEWAY_STUDY_HISTORICAL_EXPOSURE_MICROS = 21_655_385;
export const GATEWAY_STUDY_RESPONSE_BYTES = 1_048_576;
export type GatewayStudyPhase = "extract" | "reader" | "judge";
export type GatewayStudyModel = "openai/gpt-4.1-mini" | "openai/gpt-4o";
export const GATEWAY_STUDY_PROFILES = Object.freeze({
  extract: Object.freeze({ model: "openai/gpt-4.1-mini", maximumOutput: 16_384, timeoutMs: 300_000 }),
  reader: Object.freeze({ model: "openai/gpt-4.1-mini", maximumOutput: 512, timeoutMs: 120_000 }),
  judge: Object.freeze({ model: "openai/gpt-4o", maximumOutput: 512, timeoutMs: 120_000 }),
} as const);
export type GatewayStudyRequest = Readonly<{
  protocol: typeof GATEWAY_STUDY_TRANSPORT; phase: GatewayStudyPhase;
  endpoint: "https://ai-gateway.vercel.sh/v1/chat/completions";
  body: Readonly<{ model: GatewayStudyModel; messages: readonly Message[]; temperature: 0; store: false;
    max_tokens: number; providerOptions: { gateway: { only: readonly ["openai"]; order: readonly ["openai"] } };
    response_format?: { type: "json_schema"; json_schema: { name: "oh_memory_units_v1"; strict: true; schema: typeof EXTRACTION_SCHEMA } } }>;
  requestSha256: string; inputBytes: number; maximumOutput: number; timeoutMs: number; model: GatewayStudyModel;
}>;
export type GatewayStudyReservation = Readonly<{ id: string; requestSha256: string; micros: number;
  inputUpperBound: number; maximumOutput: number; model: GatewayStudyModel }>;
export type GatewayStudyLedgerEvent = Readonly<{ v: 1; id: string; kind: "reserved" | "settled"; micros: number }>;
export type GatewayStudyUsage = Readonly<{ inputTokens: number; cachedInputTokens: number; outputTokens: number;
  tokenRateMicros: number; gatewayReportedMicros: number | null; micros: number;
  costBasis: "token-rate-estimate" | "maximum-token-rate-and-gateway-reported"; billedUsd: null }>;
export type GatewayStudyRaw = Readonly<{ requestSha256: string; httpStatus: number | null; body: Uint8Array;
  bodyComplete: boolean; receivedBytes: number; transportError: "network" | "body-read" | "response-bound" | null }>;
export type GatewayStudyFetcher = (...parameters: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
export type GatewayStudyIdentity = Readonly<{ requestedModel: GatewayStudyModel; reportedModel: string;
  resolvedProviderApiModelId: string; resolvedSnapshot: string | null; snapshotPinned: false; finalProvider: "openai";
  reportedModelAttemptCount: number | null; reportedProviderAttemptCount: number | null; physicalAttemptCount: null }>;
export type GatewayStudyResult = Readonly<{ requestSha256: string; rawSha256: string; rawBytes: number;
  usage: GatewayStudyUsage; identity: GatewayStudyIdentity }> & (
  | Readonly<{ kind: "completed"; prediction: string; finishReason: "stop" }>
  | Readonly<{ kind: "extraction-terminal"; reason: "refusal" | "content-filter"; finishReason: "stop" | "content_filter" }>
);

function fail(reason: string): never { throw new TypeError(`Gateway study transport: ${reason}.`); }
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
}
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}

/** The request has no authentication data, tools, automatic retries, or alternate model/provider routes. */
export function makeGatewayStudyRequest(spec: Readonly<{ phase: GatewayStudyPhase; messages: readonly Message[] }>): GatewayStudyRequest {
  if (!Object.hasOwn(GATEWAY_STUDY_PROFILES, spec.phase) || !Array.isArray(spec.messages) || spec.messages.length !== 2
    || spec.messages[0]?.role !== "system" || spec.messages[1]?.role !== "user"
    || spec.messages.some(message => !isPlainRecord(message) || !hasExactKeys(message, ["role", "content"])
      || typeof message.content !== "string" || message.content.length === 0 || /\p{Surrogate}/u.test(message.content))) fail("invalid request messages");
  const profile = GATEWAY_STUDY_PROFILES[spec.phase];
  const responseFormat = spec.phase === "extract" ? { type: "json_schema" as const,
    json_schema: { name: "oh_memory_units_v1" as const, strict: true as const, schema: structuredClone(EXTRACTION_SCHEMA) } } : undefined;
  const messages = structuredClone(spec.messages);
  const body: GatewayStudyRequest["body"] = { model: profile.model, messages, temperature: 0, store: false,
    max_tokens: profile.maximumOutput, providerOptions: { gateway: { only: ["openai"], order: ["openai"] } },
    ...(responseFormat === undefined ? {} : { response_format: responseFormat }) };
  const endpoint = "https://ai-gateway.vercel.sh/v1/chat/completions";
  const inputBytes = Buffer.byteLength(JSON.stringify(messages)) + (responseFormat === undefined ? 0 : Buffer.byteLength(JSON.stringify(responseFormat)));
  const context = profile.model === "openai/gpt-4o" ? 128_000 : 1_047_576;
  if (inputBytes + 2_048 + profile.maximumOutput > context) fail("conservative context bound exceeded");
  return frozen({ protocol: GATEWAY_STUDY_TRANSPORT, phase: spec.phase, endpoint, body,
    requestSha256: canonicalSha256({ protocol: GATEWAY_STUDY_TRANSPORT, phase: spec.phase, endpoint, body }),
    inputBytes, maximumOutput: profile.maximumOutput, timeoutMs: profile.timeoutMs, model: profile.model });
}
function checkedRequest(request: GatewayStudyRequest): GatewayStudyRequest {
  const expected = makeGatewayStudyRequest({ phase: request.phase, messages: request.body.messages });
  if (canonicalSha256(expected) !== canonicalSha256(request)) fail("request changed after preparation");
  return expected;
}
function expectedReservation(request: GatewayStudyRequest, id: string): GatewayStudyReservation {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) fail("invalid reservation identifier");
  const prices = MODELS[request.model], inputUpperBound = request.inputBytes + 2_048;
  return frozen({ id, requestSha256: request.requestSha256,
    micros: Math.ceil(inputUpperBound * prices.input + request.maximumOutput * prices.output),
    inputUpperBound, maximumOutput: request.maximumOutput, model: request.model });
}

/** Only the new amendment ledger enters this exposure; its immutable historical anchor is reported separately. */
export function gatewayStudyLedgerExposure(events: readonly unknown[]): number {
  if (events.some(event => !isPlainRecord(event) || !hasExactKeys(event, ["v", "id", "kind", "micros"])
    || !integer(event.micros) || typeof event.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(event.id))) fail("invalid native ledger event");
  const exposure = ledgerExposure(events);
  if (!Number.isSafeInteger(exposure) || exposure > GATEWAY_STUDY_MAX_USD * 1_000_000) fail("amendment ledger exceeds its authorized cap");
  const charges = new Map<string, number>(); let prefixExposure = 0;
  for (const event of events as readonly GatewayStudyLedgerEvent[]) {
    prefixExposure += event.micros - (event.kind === "settled" ? charges.get(event.id)! : 0);
    charges.set(event.id, event.micros);
    if (!Number.isSafeInteger(prefixExposure) || prefixExposure > GATEWAY_STUDY_MAX_USD * 1_000_000) fail("historical amendment ledger prefix exceeds its authorized cap");
  }
  return exposure;
}
export class GatewayStudyBudget {
  readonly #cap: number; readonly #maximumCalls: number; readonly #prior: number;
  readonly #pending = new Map<string, GatewayStudyReservation>(); readonly #seen = new Set<string>();
  #exposure: number; #confirmed = 0;
  constructor(options: Readonly<{ maxUsd: number; maxCalls: number; priorExposureMicros?: number }>) {
    const prior = options.priorExposureMicros ?? 0;
    if (!Number.isFinite(options.maxUsd) || options.maxUsd <= 0 || options.maxUsd > GATEWAY_STUDY_MAX_USD
      || !Number.isSafeInteger(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > 10_000
      || !integer(prior) || prior > Math.floor(options.maxUsd * 1_000_000)) fail("invalid bounded amendment budget");
    this.#cap = Math.floor(options.maxUsd * 1_000_000); this.#maximumCalls = options.maxCalls;
    this.#prior = prior; this.#exposure = prior;
  }
  reserve(request: GatewayStudyRequest, id: string): GatewayStudyReservation {
    const reservation = expectedReservation(checkedRequest(request), id);
    if (this.#seen.has(id)) fail("reservation identifier already used");
    if (this.#seen.size >= this.#maximumCalls || this.#exposure + reservation.micros > this.#cap) fail("budget exhausted before dispatch");
    this.#seen.add(id); this.#pending.set(id, reservation); this.#exposure += reservation.micros;
    return reservation;
  }
  settle(reservation: GatewayStudyReservation, usage: GatewayStudyUsage): void {
    const prices = MODELS[reservation.model];
    if (this.#pending.get(reservation.id) !== reservation || !integer(usage.micros) || usage.micros > reservation.micros
      || !integer(usage.inputTokens) || usage.inputTokens > reservation.inputUpperBound || !integer(usage.outputTokens)
      || usage.outputTokens > reservation.maximumOutput || !integer(usage.cachedInputTokens) || usage.cachedInputTokens > usage.inputTokens
      || (usage.gatewayReportedMicros !== null && !integer(usage.gatewayReportedMicros))
      || usage.tokenRateMicros !== Math.ceil((usage.inputTokens - usage.cachedInputTokens) * prices.input
        + usage.cachedInputTokens * prices.cachedInput + usage.outputTokens * prices.output)
      || usage.micros !== Math.max(usage.tokenRateMicros, usage.gatewayReportedMicros ?? 0)
      || usage.costBasis !== (usage.gatewayReportedMicros === null ? "token-rate-estimate" : "maximum-token-rate-and-gateway-reported")
      || usage.billedUsd !== null) fail("invalid settlement; reservation retained");
    this.#pending.delete(reservation.id); this.#exposure -= reservation.micros - usage.micros; this.#confirmed += usage.micros;
  }
  get summary() {
    return { capUsd: this.#cap / 1_000_000, maxCalls: this.#maximumCalls, reservedCalls: this.#seen.size,
      historicalExposureUsd: GATEWAY_STUDY_HISTORICAL_EXPOSURE_MICROS / 1_000_000,
      priorAmendmentExposureUsd: this.#prior / 1_000_000, accountedUsd: this.#exposure / 1_000_000,
      confirmedThisRunUsd: this.#confirmed / 1_000_000,
      unresolvedThisRunUsd: [...this.#pending.values()].reduce((sum, value) => sum + value.micros, 0) / 1_000_000,
      billedUsd: null };
  }
}

function compatibleModel(value: unknown, family: string): value is string {
  if (typeof value !== "string") return false;
  const label = value.startsWith("openai/") ? value.slice(7) : value;
  if (label === family) return true;
  const suffix = label.slice(family.length + 1);
  return label.startsWith(`${family}-`) && /^\d{4}-\d{2}-\d{2}$/.test(suffix)
    && Number.isFinite(Date.parse(suffix)) && new Date(suffix).toISOString().slice(0, 10) === suffix;
}
function plainModel(value: string): string { return value.startsWith("openai/") ? value.slice(7) : value; }
function consistentModel(value: unknown, family: string, resolved: string): boolean {
  return compatibleModel(value, family) && (plainModel(value) === family || plainModel(value) === plainModel(resolved));
}
function checkedProviderAttempt(provider: unknown, family: string, resolved: string): void {
  if (!isPlainRecord(provider) || provider.provider !== "openai" || provider.success !== true) fail("unexpected reported provider attempt");
  const labels = [provider.providerApiModelId, provider.modelId, provider.internalModelId].filter(label => label !== undefined);
  if (labels.length === 0 || labels.some(label => typeof label !== "string"
    || !consistentModel(label.startsWith("openai:") ? label.slice(7) : label, family, resolved))) fail("provider attempt model mismatch");
}
function identity(value: Record<string, unknown>, message: Record<string, unknown>, request: GatewayStudyRequest): { identity: GatewayStudyIdentity; gateway: Record<string, unknown> } {
  const copies = [value.providerMetadata, value.provider_metadata, message.providerMetadata, message.provider_metadata]
    .filter(metadata => metadata !== undefined);
  const metadata = copies[0];
  if (copies.some(copy => canonicalSha256(copy) !== canonicalSha256(metadata))) fail("conflicting Gateway metadata");
  if (!isPlainRecord(metadata) || !isPlainRecord(metadata.gateway) || !isPlainRecord(metadata.gateway.routing)) fail("missing authenticated Gateway routing metadata");
  const gateway = metadata.gateway, routing = gateway.routing as Record<string, unknown>, family = request.model.slice(7);
  const resolved = routing.resolvedProviderApiModelId;
  if (routing.finalProvider !== "openai" || !compatibleModel(resolved, family) || !compatibleModel(value.model, family)
    || (plainModel(value.model) !== family && plainModel(value.model) !== plainModel(resolved))) fail("model or provider mismatch");
  const count = routing.modelAttemptCount;
  if (count !== undefined && count !== 1) fail("multiple or invalid reported model attempts");
  const totalProviderAttemptCount = routing.totalProviderAttemptCount;
  if (totalProviderAttemptCount !== undefined && totalProviderAttemptCount !== 1) fail("multiple or invalid reported provider attempts");
  let providerAttemptCount: number | null = totalProviderAttemptCount === 1 ? 1 : null;
  if (routing.attempts !== undefined) {
    if (!Array.isArray(routing.attempts) || routing.attempts.length !== 1) fail("legacy provider attempt inventory mismatch");
    checkedProviderAttempt(routing.attempts[0], family, resolved);
    providerAttemptCount = 1;
  }
  if (routing.modelAttempts !== undefined) {
    if (!Array.isArray(routing.modelAttempts) || routing.modelAttempts.length !== 1) fail("model attempt inventory mismatch");
    const attempt: unknown = routing.modelAttempts[0];
    if (!isPlainRecord(attempt) || attempt.success !== true || !consistentModel(attempt.canonicalSlug, family, resolved)
      || typeof attempt.modelId !== "string" || !attempt.modelId.startsWith("openai:")
      || !consistentModel(attempt.modelId.slice(7), family, resolved)) fail("unexpected reported model attempt");
    if (attempt.providerAttemptCount !== undefined) {
      if (attempt.providerAttemptCount !== 1) fail("multiple or invalid reported provider attempts");
      providerAttemptCount = 1;
    }
    if (attempt.providerAttempts !== undefined) {
      if (!Array.isArray(attempt.providerAttempts) || attempt.providerAttempts.length !== 1) fail("provider attempt inventory mismatch");
      checkedProviderAttempt(attempt.providerAttempts[0], family, resolved);
      providerAttemptCount = 1;
    }
  }
  return { gateway, identity: { requestedModel: request.model, reportedModel: value.model,
    resolvedProviderApiModelId: resolved, resolvedSnapshot: plainModel(resolved) === family ? null : plainModel(resolved),
    snapshotPinned: false, finalProvider: "openai", reportedModelAttemptCount: count === 1 || routing.modelAttempts !== undefined ? 1 : null,
    reportedProviderAttemptCount: providerAttemptCount, physicalAttemptCount: null } };
}
function parseUsage(value: unknown, gateway: Record<string, unknown>, reservation: GatewayStudyReservation): GatewayStudyUsage {
  if (!isPlainRecord(value) || !integer(value.prompt_tokens) || !integer(value.completion_tokens)
    || value.total_tokens !== value.prompt_tokens + value.completion_tokens || value.prompt_tokens > reservation.inputUpperBound
    || value.completion_tokens > reservation.maximumOutput) fail("missing or invalid usage; reservation retained");
  if (value.prompt_tokens_details !== undefined && value.prompt_tokens_details !== null
    && !isPlainRecord(value.prompt_tokens_details)) fail("invalid cached usage details");
  const cached = isPlainRecord(value.prompt_tokens_details) ? value.prompt_tokens_details.cached_tokens ?? 0 : 0;
  if (!integer(cached) || cached > value.prompt_tokens) fail("invalid cached usage");
  const price = MODELS[reservation.model];
  const tokenRateMicros = Math.ceil((value.prompt_tokens - cached) * price.input + cached * price.cachedInput + value.completion_tokens * price.output);
  let gatewayReportedMicros: number | null = null;
  if (gateway.cost !== undefined) {
    if ((typeof gateway.cost !== "number" && typeof gateway.cost !== "string")
      || (typeof gateway.cost === "string" && !/^\d+(?:\.\d{1,12})?$/.test(gateway.cost))) fail("invalid Gateway cost");
    const amount = Number(gateway.cost);
    if (!Number.isFinite(amount) || amount < 0 || Object.is(amount, -0)) fail("invalid Gateway cost");
    gatewayReportedMicros = Math.ceil(amount * 1_000_000);
  }
  const micros = Math.max(tokenRateMicros, gatewayReportedMicros ?? 0);
  if (!integer(micros) || micros > reservation.micros) fail("usage exceeds reserved exposure");
  return { inputTokens: value.prompt_tokens, cachedInputTokens: cached, outputTokens: value.completion_tokens,
    tokenRateMicros, gatewayReportedMicros, micros,
    costBasis: gatewayReportedMicros === null ? "token-rate-estimate" : "maximum-token-rate-and-gateway-reported", billedUsd: null };
}

/** Replaying stored bytes uses exactly the same parser as an admitted live response. */
export function parseGatewayStudyResponse(requestInput: GatewayStudyRequest, reservation: GatewayStudyReservation, raw: GatewayStudyRaw): GatewayStudyResult {
  const request = checkedRequest(requestInput);
  if (canonicalSha256(reservation) !== canonicalSha256(expectedReservation(request, reservation.id))) fail("reservation/request binding mismatch");
  if (raw.requestSha256 !== request.requestSha256 || !(raw.body instanceof Uint8Array)
    || raw.body.byteLength > GATEWAY_STUDY_RESPONSE_BYTES || !integer(raw.receivedBytes)
    || !raw.bodyComplete || raw.receivedBytes !== raw.body.byteLength || raw.transportError !== null
    || !Number.isInteger(raw.httpStatus) || raw.httpStatus === null || raw.httpStatus < 200 || raw.httpStatus > 299) fail("incomplete transport or HTTP failure; reservation retained");
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.body)); } catch { return fail("malformed response bytes; reservation retained"); }
  if (!isPlainRecord(value)) fail("invalid provider response envelope");
  if (!Array.isArray(value.choices) || value.choices.length !== 1) fail("ambiguous response choices");
  const choice: unknown = value.choices[0];
  if (!isPlainRecord(choice) || (choice.index !== undefined && choice.index !== 0) || !isPlainRecord(choice.message)
    || choice.message.role !== "assistant" || (choice.message.tool_calls !== undefined && choice.message.tool_calls !== null
      && (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length !== 0))
    || choice.message.function_call !== undefined && choice.message.function_call !== null) fail("invalid completion message");
  const checked = identity(value, choice.message, request), usage = parseUsage(value.usage, checked.gateway, reservation);
  const base = { requestSha256: request.requestSha256, rawSha256: sha256Hex(raw.body), rawBytes: raw.body.byteLength,
    usage, identity: checked.identity };
  const content = choice.message.content, refusal = choice.message.refusal;
  if (refusal !== undefined && refusal !== null && (typeof refusal !== "string" || refusal.trim().length === 0)) fail("invalid refusal evidence");
  if (choice.finish_reason === "content_filter") {
    if (request.phase !== "extract" || (content !== null && content !== undefined && typeof content !== "string")) fail("content filter outside extraction policy");
    return frozen({ ...base, kind: "extraction-terminal", reason: "content-filter", finishReason: "content_filter" });
  }
  if (choice.finish_reason !== "stop") fail("incomplete or truncated completion; reservation retained");
  if (typeof refusal === "string") {
    if (request.phase !== "extract" || (content !== undefined && content !== null && content !== "")) fail("ambiguous refusal or refusal outside extraction policy");
    return frozen({ ...base, kind: "extraction-terminal", reason: "refusal", finishReason: "stop" });
  }
  if (typeof content !== "string" || content.trim().length === 0 || /\p{Surrogate}/u.test(content)) fail("empty or invalid completion text");
  return frozen({ ...base, kind: "completed", prediction: content.trim(), finishReason: "stop" });
}

/** Capture and ledger callbacks must durably finish; callback failure never dispatches another request. */
export async function invokeGatewayStudy(options: Readonly<{
  request: GatewayStudyRequest; oidcToken: string; reservationId: string; budget: GatewayStudyBudget;
  record: (event: GatewayStudyLedgerEvent) => Promise<void>; capture: (raw: GatewayStudyRaw) => Promise<void>; fetcher?: GatewayStudyFetcher;
}>): Promise<GatewayStudyResult> {
  const request = checkedRequest(options.request);
  if (typeof options.oidcToken !== "string" || options.oidcToken.trim().length === 0
    || typeof options.record !== "function" || typeof options.capture !== "function") fail("OIDC and durable callbacks required before dispatch");
  const reservation = options.budget.reserve(request, options.reservationId);
  await options.record({ v: 1, id: reservation.id, kind: "reserved", micros: reservation.micros });
  let response: Response | null = null, body = new Uint8Array(0), receivedBytes = 0;
  let bodyComplete = false, transportError: GatewayStudyRaw["transportError"] = null;
  try {
    response = await (options.fetcher ?? fetch)(request.endpoint, { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(request.timeoutMs), headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.oidcToken}` },
      body: JSON.stringify(request.body) });
  } catch { transportError = "network"; }
  if (response !== null) {
    const reader = response.body?.getReader();
    if (reader === undefined) transportError = "body-read";
    else {
      const chunks: Uint8Array[] = []; let retained = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) { bodyComplete = true; break; }
          receivedBytes += next.value.byteLength;
          const piece = next.value.slice(0, GATEWAY_STUDY_RESPONSE_BYTES - retained);
          chunks.push(piece); retained += piece.byteLength;
          if (receivedBytes > GATEWAY_STUDY_RESPONSE_BYTES) { transportError = "response-bound"; break; }
        }
      } catch { transportError = "body-read"; }
      finally { try { await reader.cancel(); } catch { /* Captured state remains incomplete if reading failed. */ } }
      body = new Uint8Array(retained); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    }
  }
  const raw: GatewayStudyRaw = { requestSha256: request.requestSha256, httpStatus: response?.status ?? null,
    body, bodyComplete, receivedBytes, transportError };
  await options.capture({ ...raw, body: new Uint8Array(body) });
  const result = parseGatewayStudyResponse(request, reservation, raw);
  await options.record({ v: 1, id: reservation.id, kind: "settled", micros: result.usage.micros });
  options.budget.settle(reservation, result.usage);
  return result;
}
