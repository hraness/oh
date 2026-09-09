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
type State = "reserved" | "captured" | "settled";
type Entry = Readonly<{ request: Mem0Request; state: State; raw: Uint8Array | null; transport: Transport | null; result: Mem0Result | null }>;
type Event = Readonly<{ kind: "reserved"; request: Mem0Request }> | Readonly<{ kind: "captured"; requestSha256: string; rawBase64: string; transport: Transport }>
  | Readonly<{ kind: "settled"; requestSha256: string; result: Mem0Result }>;
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
function gateway(envelope: Record<string, unknown>, selected: Mem0CallProfile) {
  const meta = envelope.providerMetadata ?? envelope.provider_metadata;
  if (!isPlainRecord(meta) || !isPlainRecord(meta.gateway) || !isPlainRecord(meta.gateway.routing)) fail("missing gateway routing");
  const route = meta.gateway.routing;
  if (envelope.model !== selected.model || route.finalProvider !== selected.provider || route.originalModelId !== selected.model || route.canonicalSlug !== selected.model) fail("gateway route mismatch");
  return meta.gateway as Record<string, unknown>;
}
function micros(value: unknown): number | null { if (value === undefined) return null; if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) fail("invalid gateway cost"); const result = Math.ceil(value * 1_000_000); if (!integer(result, 1_000_000_000)) fail("gateway cost bound"); return result; }
function usageDetail(value: unknown, allowed: readonly string[], maximum: number): void {
  if (value === undefined) return;
  if (!isPlainRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) fail("ambiguous usage detail");
  for (const item of Object.values(value)) if (!integer(item, maximum)) fail("usage detail bound");
}
function parseUsage(value: unknown, request: Mem0Request, gatewayMeta: Record<string, unknown>) {
  if (!isPlainRecord(value)) fail("usage object");
  const keys = Object.keys(value).sort();
  const llm = request.kind === "llm";
  const required = llm ? ["completion_tokens", "prompt_tokens", "total_tokens"] : ["prompt_tokens", "total_tokens"];
  const allowed = llm ? [...required, "completion_tokens_details", "prompt_tokens_details"] : [...required, "prompt_tokens_details"];
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !allowed.includes(key))) fail("ambiguous usage metadata");
  if (!integer(value.prompt_tokens, request.inputUpperBound) || !integer(value.total_tokens, request.inputUpperBound + request.profile.maxOutputTokens)) fail("usage bound");
  const output = llm ? value.completion_tokens : 0;
  if (!integer(output, request.profile.maxOutputTokens) || value.total_tokens !== value.prompt_tokens + output) fail("usage total");
  usageDetail(value.prompt_tokens_details, ["audio_tokens", "cached_tokens"], value.prompt_tokens);
  if (llm) usageDetail(value.completion_tokens_details, ["accepted_prediction_tokens", "audio_tokens", "reasoning_tokens", "rejected_prediction_tokens"], output);
  const tokenRateMicros = cost(value.prompt_tokens, output, request.profile), gatewayReportedMicros = micros(gatewayMeta.cost);
  const charged = Math.max(tokenRateMicros, gatewayReportedMicros ?? 0); if (charged > request.reservationMicros) fail("usage exceeds reservation");
  return Object.freeze({ inputTokens: value.prompt_tokens, outputTokens: output, tokenRateMicros, gatewayReportedMicros, micros: charged });
}
export function parseMem0Response(raw: Uint8Array, requestInput: unknown): Mem0Result {
  const request = validateMem0Request(requestInput); if (!(raw instanceof Uint8Array) || raw.length === 0 || raw.length > MAX_RAW) fail("response bytes");
  let envelope: unknown; try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); } catch { fail("malformed response"); }
  if (!isPlainRecord(envelope)) fail("response object"); const meta = gateway(envelope, request.profile), usage = parseUsage(envelope.usage, request, meta);
  let value: Mem0Result["value"];
  if (request.kind === "llm") { const choice = Array.isArray(envelope.choices) && envelope.choices.length === 1 && isPlainRecord(envelope.choices[0]) ? envelope.choices[0] : null;
    if (!choice || choice.finish_reason !== "stop" || !isPlainRecord(choice.message) || choice.message.role !== "assistant" || (Object.hasOwn(choice.message, "refusal") && choice.message.refusal !== null)) fail("LLM completion shape");
    value = Object.freeze({ content: boundedText(choice.message.content) }); }
  else { if (envelope.object !== "list" || !Array.isArray(envelope.data) || envelope.data.length !== 1 || !isPlainRecord(envelope.data[0]) || envelope.data[0].index !== 0 || !Array.isArray(envelope.data[0].embedding) || envelope.data[0].embedding.length !== request.profile.embeddingDimensions || envelope.data[0].embedding.some(n => typeof n !== "number" || !Number.isFinite(n))) fail("embedding shape"); value = Object.freeze({ embedding: Object.freeze([...envelope.data[0].embedding] as number[]) }); }
  return Object.freeze({ requestSha256: request.requestSha256, profileSha256: request.profileSha256, rawSha256: sha256Hex(raw), rawBytes: raw.length, kind: request.kind, value, usage });
}
function transport(value: Transport, rawBytes: number): Transport { if (!isPlainRecord(value) || !hasExactKeys(value, ["httpStatus", "complete", "receivedBytes", "error", "serviceMs"]) || value.httpStatus !== null && (!integer(value.httpStatus, 599) || value.httpStatus < 100) || typeof value.complete !== "boolean" || !integer(value.receivedBytes) || value.receivedBytes < rawBytes || value.error !== null && value.error !== "network" && value.error !== "body-read" && value.error !== "response-bound" || typeof value.serviceMs !== "number" || !Number.isFinite(value.serviceMs) || value.serviceMs < 0 || value.serviceMs > 86_400_000 || value.complete && (value.error !== null || value.receivedBytes !== rawBytes)) fail("transport metadata"); return Object.freeze(structuredClone(value)); }
function event(value: unknown): Event { const current = exact(value, ["kind", ...(isPlainRecord(value) && value.kind === "reserved" ? ["request"] : isPlainRecord(value) && value.kind === "captured" ? ["requestSha256", "rawBase64", "transport"] : isPlainRecord(value) && value.kind === "settled" ? ["requestSha256", "result"] : [])]); if (current.kind === "reserved") return Object.freeze({ kind: "reserved", request: validateMem0Request(current.request) }); if (current.kind === "captured") { if (!sha(current.requestSha256) || typeof current.rawBase64 !== "string") fail("capture event"); const raw = Buffer.from(current.rawBase64, "base64"); if (raw.length > MAX_RAW || raw.toString("base64") !== current.rawBase64) fail("raw encoding"); return Object.freeze({ kind: "captured", requestSha256: current.requestSha256 as string, rawBase64: current.rawBase64, transport: transport(current.transport as Transport, raw.length) }); } if (current.kind === "settled") { if (!sha(current.requestSha256) || !isPlainRecord(current.result)) fail("settlement event"); return Object.freeze({ kind: "settled", requestSha256: current.requestSha256 as string, result: current.result as Mem0Result }); } fail("event kind"); }
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
  const policyFor = (request: Mem0Request) => { const policy = policies.find(candidate => candidate.runSha256 === request.runSha256 && candidate.namespace === request.namespace); if (!policy || request.profileSha256 !== (request.kind === "llm" ? canonicalSha256(policy.llmProfile) : canonicalSha256(policy.embeddingProfile))) fail("request does not match pinned policy"); };
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
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(ledgerPath)); if (!text.endsWith("\n")) fail("partial ledger"); for (const line of text.slice(0, -1).split("\n")) { if (!line) continue; const next = event(JSON.parse(line)); if (next.kind === "reserved") { policyFor(next.request); if (entries.has(next.request.requestSha256)) fail("duplicate reservation"); entries.set(next.request.requestSha256, { request: next.request, state: "reserved", raw: null, transport: null, result: null }); exposure += next.request.reservationMicros; } else { const found = entries.get(next.requestSha256); if (found === undefined || found.state === "settled") fail("orphan or duplicate event"); if (next.kind === "captured") { if (found.state !== "reserved") fail("capture order"); entries.set(next.requestSha256, { ...found, state: "captured", raw: Buffer.from(next.rawBase64, "base64"), transport: next.transport }); } else { if (found.state !== "captured" || found.raw === null || found.transport === null || found.transport.httpStatus !== 200 || !found.transport.complete || found.transport.error !== null) fail("settlement transport"); const result = parseMem0Response(found.raw, found.request); if (canonicalSha256(result) !== canonicalSha256(next.result)) fail("settlement replay"); entries.set(next.requestSha256, { ...found, state: "settled", result }); exposure += result.usage.micros - found.request.reservationMicros; } } } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (entries.size > authority.maximumCalls || exposure > authority.additionalBudgetMicros) fail("replayed budget");
    const custody = () => { if (closed || lstatSync(lockPath).ino !== lockStat.ino) fail("ledger closed or custody changed"); };
    return {
      summary: () => { custody(); return Object.freeze({ calls: entries.size, exposureMicros: exposure, antecedentExposureMicros: accounting.cumulativeExposureMicros, combinedExposureMicros: exposure + accounting.cumulativeExposureMicros, additionalBudgetMicros: authority.additionalBudgetMicros, maximumCalls: authority.maximumCalls, policySha256es: Object.freeze(policyBytes.map(sha256Hex)), antecedentAccountingSha256: sha256Hex(accountingBytes) }); },
      auth: campaign.auth,
      lookup: (requestInput: unknown) => { custody(); const request = validateMem0Request(requestInput), found = entries.get(request.requestSha256); if (!found) return { kind: "miss" as const }; if (found.state === "settled") return { kind: "hit" as const, result: found.result! }; return { kind: "occupied" as const, state: found.state }; },
      admit: (requestInput: unknown) => mutate(async () => { custody(); const request = validateMem0Request(requestInput); policyFor(request); if (entries.has(request.requestSha256) || entries.size >= authority.maximumCalls || exposure + request.reservationMicros > authority.additionalBudgetMicros) fail("duplicate or exhausted admission"); await append({ kind: "reserved", request }); entries.set(request.requestSha256, { request, state: "reserved", raw: null, transport: null, result: null }); exposure += request.reservationMicros; }),
      capture: (requestInput: unknown, raw: Uint8Array, meta: Transport) => { const snapshot = raw.slice(), checked = transport(meta, snapshot.length); return mutate(async () => { custody(); const request = validateMem0Request(requestInput), found = entries.get(request.requestSha256); if (!found || found.state !== "reserved" || snapshot.length > MAX_RAW) fail("capture requires reservation"); await append({ kind: "captured", requestSha256: request.requestSha256, rawBase64: Buffer.from(snapshot).toString("base64"), transport: checked }); entries.set(request.requestSha256, { ...found, state: "captured", raw: snapshot, transport: checked }); }); },
      finalize: (requestInput: unknown) => mutate(async () => { custody(); const request = validateMem0Request(requestInput), found = entries.get(request.requestSha256); if (!found || found.state !== "captured" || !found.raw || !found.transport || found.transport.httpStatus !== 200 || !found.transport.complete || found.transport.error !== null) fail("unverifiable first response remains charged"); const result = parseMem0Response(found.raw, request); await append({ kind: "settled", requestSha256: request.requestSha256, result }); entries.set(request.requestSha256, { ...found, state: "settled", result }); exposure += result.usage.micros - request.reservationMicros; return result; }),
      close: async () => { await mutation; if (closed) return; closed = true; await lock.close(); try { if (lstatSync(lockPath).ino === lockStat.ino) await unlink(lockPath); } catch { /* custody marker was replaced or removed */ } },
    };
  } catch (error) { await lock.close(); try { await unlink(lockPath); } catch {} throw error; }
}
export type Mem0Fetcher = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;
export async function invokeMem0Request(input: Readonly<{ request: Mem0Request; ledger: Awaited<ReturnType<typeof openMem0Ledger>>; credential: Mem0Credential; fetcher?: Mem0Fetcher }>) {
  const request = validateMem0Request(input.request), cached = input.ledger.lookup(request); if (cached.kind === "hit") return cached.result; if (cached.kind === "occupied") fail("occupied request cannot be retried");
  if (typeof input.credential.token !== "string" || input.credential.token.length < 1 || input.credential.token.length > 32768 || canonicalSha256(input.credential.auth) !== canonicalSha256(input.ledger.auth)) fail("missing or mismatched bounded OIDC credential"); qualifyGatewayOIDC(input.credential.token, input.ledger.auth); await input.ledger.admit(request);
  const started = performance.now(); let response: Response | null = null, error: Transport["error"] = null, complete = false, receivedBytes = 0; const chunks: Uint8Array[] = [];
  try { response = await (input.fetcher ?? fetch)(request.endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(request.timeoutMs), headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.credential.token}` }, body: JSON.stringify(request.body) }); } catch { error = "network"; }
  if (response?.body) { const reader = response.body.getReader(); try { while (true) { const next = await reader.read(); if (next.done) { complete = true; break; } receivedBytes += next.value.length; if (receivedBytes > MAX_RAW) { error = "response-bound"; break; } chunks.push(next.value); } } catch { error = "body-read"; } finally { try { await reader.cancel(); } catch {} } } else if (response !== null) error = "body-read";
  const raw = Buffer.concat(chunks); await input.ledger.capture(request, raw, { httpStatus: response?.status ?? null, complete, receivedBytes, error, serviceMs: performance.now() - started }); return await input.ledger.finalize(request);
}
