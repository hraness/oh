/** Direct Gemini/xAI development transport. All roles share one locked native
 * reservation ledger; unknown outcomes stop dispatch and retain their bound. */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { hasExactKeys, isPlainRecord, sha256Hex } from "../../../src/canonical";
import { ledgerExposure, type Message } from "../model";

export const API_PROTOCOL = "oh.memory-lab-api.v1";
export const API_MODELS = Object.freeze({
  "gemini-3.8-flash": { provider: "gemini", input: 0.75, output: 3.75, context: 1_048_576 },
  "grok-4.7": { provider: "xai", input: 2, output: 6, context: 500_000 },
} as const);
export type ApiModel = keyof typeof API_MODELS;
export type ApiBinding = Readonly<{ id: string; model: ApiModel; keyEnv: "VERTEX_API_KEY" | "GEMINI_API_KEY" | "XAI_API_KEY"; maximumOutput: number }>;
export type ApiConfig = Readonly<{ budgetPath: string; reader: ApiBinding; judge: ApiBinding }>;
type Budget = Readonly<{ protocol: "oh.memory-lab-api-budget.v1"; maxUsd: number; maxCalls: number; expiresAt: string; ledgerPath: string }>;
type Event = { v: 1; id: string; kind: "reserved" | "settled"; micros: number };
type Usage = { inputTokens: number; outputTokens: number; micros: number; providerReportedMicros: number | null;
  costBasis: "maximum-token-rate-and-provider-reported" };
export type ApiReply = { result: { status: "completed" | "failed"; answer: string | null; partialAnswer: string | null;
  failureReason: string | null }; usage: Usage; identity: { requestedModel: ApiModel; reportedModel: string; provider: string; requestSha256: string } };
const LIMIT = 1_048_576, RATES_EXPIRE = Date.parse("2027-01-01T00:00:00Z");
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function fail(reason: string): never { throw new Error(`Memory lab API: ${reason}.`); }
function path(v: unknown): string {
  if (typeof v !== "string" || !isAbsolute(v) || v.length > 4096 || v.includes("\0")) fail("absolute path required");
  return v;
}
function file(p: string, maximum: number): string {
  const stat = lstatSync(p);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || realpathSync(p) !== p) fail("unsafe or oversized file");
  return readFileSync(p, "utf8");
}
function syncDirectory(p: string): void {
  const fd = openSync(p, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function writeCapture(p: string, content: string): void {
  const fd = openSync(p, "wx", 0o600);
  try { writeSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(p));
}
function binding(v: unknown): ApiBinding {
  if (!isPlainRecord(v) || !hasExactKeys(v, ["id", "model", "keyEnv", "maximumOutput"])
    || typeof v.id !== "string" || !/^[a-z0-9-]{1,100}$/u.test(v.id)
    || typeof v.model !== "string" || !Object.hasOwn(API_MODELS, v.model)
    || !integer(v.maximumOutput) || v.maximumOutput < 64 || v.maximumOutput > 8192) fail("invalid model binding");
  const model = v.model as ApiModel;
  if (model === "grok-4.7" ? v.keyEnv !== "XAI_API_KEY" : !["VERTEX_API_KEY", "GEMINI_API_KEY"].includes(String(v.keyEnv))) fail("key/provider mismatch");
  return Object.freeze({ id: v.id, model, keyEnv: v.keyEnv as ApiBinding["keyEnv"], maximumOutput: v.maximumOutput });
}
export function parseApiConfig(v: unknown): ApiConfig {
  if (!isPlainRecord(v) || !hasExactKeys(v, ["budgetPath", "reader", "judge"])) fail("invalid API configuration");
  const reader = binding(v.reader), judge = binding(v.judge);
  if (reader.id === judge.id) fail("roles require separate identities");
  return Object.freeze({ budgetPath: path(v.budgetPath), reader, judge });
}
function budget(v: unknown): Budget {
  if (!isPlainRecord(v) || !hasExactKeys(v, ["protocol", "maxUsd", "maxCalls", "expiresAt", "ledgerPath"])
    || v.protocol !== "oh.memory-lab-api-budget.v1" || typeof v.maxUsd !== "number" || !Number.isFinite(v.maxUsd)
    || v.maxUsd <= 0 || v.maxUsd > 100 || !integer(v.maxCalls) || v.maxCalls < 1 || v.maxCalls > 1000
    || typeof v.expiresAt !== "string" || !Number.isFinite(Date.parse(v.expiresAt))) fail("explicit bounded campaign budget required");
  return { protocol: v.protocol, maxUsd: v.maxUsd, maxCalls: v.maxCalls, expiresAt: v.expiresAt, ledgerPath: path(v.ledgerPath) };
}

export function prepareApiRequest(selected: ApiBinding, messages: readonly Message[]) {
  const b = binding(selected), prices = API_MODELS[b.model];
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 2
    || messages.at(-1)?.role !== "user" || (messages.length === 2 && messages[0]?.role !== "system")
    || messages.some(m => !isPlainRecord(m) || !hasExactKeys(m, ["role", "content"])
      || typeof m.content !== "string" || !m.content || m.content.length > prices.context
      || Buffer.byteLength(m.content) > prices.context || /\p{Surrogate}/u.test(m.content))) fail("bounded system/user messages required");
  const body = prices.provider === "gemini" ? {
    ...(messages.length === 2 ? { systemInstruction: { parts: [{ text: messages[0]!.content }] } } : {}),
    contents: [{ role: "user", parts: [{ text: messages.at(-1)!.content }] }],
    generationConfig: { temperature: 0, candidateCount: 1, maxOutputTokens: b.maximumOutput, thinkingConfig: { thinkingLevel: "low" } },
  } : { model: b.model, input: messages.map(m => ({ role: m.role, content: [{ type: "input_text", text: m.content }] })),
    temperature: 0, max_output_tokens: b.maximumOutput, reasoning: { effort: "low" }, store: false, stream: false };
  const raw = JSON.stringify(body), inputUpperBound = Buffer.byteLength(raw) + 2048;
  if (inputUpperBound + b.maximumOutput > prices.context) fail("conservative context bound exceeded");
  // xAI doubles rates above 200K input tokens; reserve the higher tier when the byte bound crosses it.
  const multiplier = prices.provider === "xai" && inputUpperBound > 200_000 ? 2 : 1;
  const reservationMicros = Math.ceil((inputUpperBound * prices.input + b.maximumOutput * prices.output) * multiplier);
  const endpoint = prices.provider === "gemini"
    ? `https://generativelanguage.googleapis.com/v1beta/models/${b.model}:generateContent`
    : "https://api.x.ai/v1/responses";
  return Object.freeze({ binding: b, endpoint, raw, inputUpperBound, reservationMicros,
    requestSha256: sha256Hex(JSON.stringify({ protocol: API_PROTOCOL, binding: b, endpoint, body })) });
}

export function parseApiReply(value: unknown, request: ReturnType<typeof prepareApiRequest>): ApiReply {
  return parseReply(value, request, false);
}
// Only the cost-only rejection path may inspect an over-bound reply. It never
// returns that reply to a reader, scorer, or accepted-result capture.
function parseReply(value: unknown, request: ReturnType<typeof prepareApiRequest>, inspectOutputOverrun: boolean): ApiReply {
  if (!isPlainRecord(value)) fail("invalid response; reservation retained");
  const b = request.binding, prices = API_MODELS[b.model];
  let input: unknown, output: unknown, finish: unknown, answer: unknown, reported: unknown;
  let providerReportedMicros: number | null = null;
  if (prices.provider === "gemini") {
    const u = value.usageMetadata, c = Array.isArray(value.candidates) && value.candidates.length === 1 ? value.candidates[0] : null;
    if (!isPlainRecord(u) || !isPlainRecord(c)) fail("missing Gemini usage/candidate");
    const visible = u.candidatesTokenCount ?? 0, thoughts = u.thoughtsTokenCount ?? 0;
    if (!integer(visible) || !integer(thoughts)) fail("missing Gemini usage/candidate");
    input = u.promptTokenCount; output = visible + thoughts;
    if (u.totalTokenCount !== (Number(input) + Number(output))) fail("Gemini token accounting mismatch");
    finish = c.finishReason; reported = value.modelVersion;
    const content = c.content;
    answer = isPlainRecord(content) && Array.isArray(content.parts)
      ? content.parts.filter(p => isPlainRecord(p) && p.thought !== true && typeof p.text === "string").map(p => (p as { text: string }).text).join("") : null;
  } else {
    const u = value.usage;
    if (!isPlainRecord(u) || !integer(u.input_tokens) || !integer(u.output_tokens) || !isPlainRecord(u.output_tokens_details)
      || !integer(u.output_tokens_details.reasoning_tokens) || u.num_server_side_tools_used !== 0 || u.num_sources_used !== 0
      || !Array.isArray(value.output) || value.output.length > 8) fail("missing or unsafe xAI usage/output");
    input = u.input_tokens;
    // xAI reports reasoning separately from visible output. Accept either
    // documented separate accounting or an explicitly consistent inclusive count.
    const reasoning = u.output_tokens_details.reasoning_tokens;
    if (u.total_tokens === u.input_tokens + u.output_tokens + reasoning) output = u.output_tokens + reasoning;
    else if (reasoning <= u.output_tokens && u.total_tokens === u.input_tokens + u.output_tokens) output = u.output_tokens;
    else fail("xAI token accounting mismatch");
    for (const [field, divisor] of [["cost_in_usd_ticks", 10_000], ["cost_in_nano_usd", 1000]] as const) {
      const cost = u[field];
      if (cost === undefined || cost === null) continue;
      if (!integer(cost)) fail("invalid provider-reported cost");
      providerReportedMicros = Math.max(providerReportedMicros ?? 0, Math.ceil(cost / divisor));
    }
    if (value.output.some(item => !isPlainRecord(item) || !["message", "reasoning"].includes(String(item.type)))) fail("undeclared xAI output type");
    const text: string[] = [];
    for (const item of value.output) if (isPlainRecord(item) && item.type === "message") {
      if (item.role !== "assistant" || !Array.isArray(item.content)) fail("invalid xAI message");
      for (const part of item.content) {
        if (!isPlainRecord(part) || part.type !== "output_text" || typeof part.text !== "string") fail("invalid xAI text");
        text.push(part.text);
      }
    }
    finish = value.status === "completed" ? "stop" : isPlainRecord(value.incomplete_details)
      && value.incomplete_details.reason === "max_output_tokens" ? "length" : value.status;
    reported = value.model; answer = text.join("");
  }
  if (!integer(input) || input > request.inputUpperBound || !integer(output) || (!inspectOutputOverrun && output > b.maximumOutput)
    || Number(input) + Number(output) > prices.context
    || typeof reported !== "string" || !(reported === b.model || reported.startsWith(b.model + "-"))) fail("unverified usage or model identity");
  if (answer !== null && (typeof answer !== "string" || Buffer.byteLength(answer) > LIMIT)) fail("invalid answer");
  const multiplier = prices.provider === "xai" && input > 200_000 ? 2 : 1;
  // Ignore cache discounts and free-tier allowances: this is an upper token-rate estimate, not a billing receipt.
  const micros = Math.max(providerReportedMicros ?? 0, Math.ceil((input * prices.input + output * prices.output) * multiplier));
  if (micros > request.reservationMicros) fail("usage exceeds reservation");
  const completed = (finish === "STOP" || finish === "stop") && typeof answer === "string" && answer.trim().length > 0;
  return { result: { status: completed ? "completed" : "failed", answer: completed ? answer as string : null,
    partialAnswer: typeof answer === "string" ? answer : null,
    failureReason: completed ? null : finish === "MAX_TOKENS" || finish === "length" ? "output-token-limit" : "provider-terminal" },
    usage: { inputTokens: input, outputTokens: output, micros, providerReportedMicros, costBasis: "maximum-token-rate-and-provider-reported" },
    identity: { requestedModel: b.model, reportedModel: reported, provider: prices.provider, requestSha256: request.requestSha256 } };
}

export type TerminalApiRejection = Readonly<{
  protocol: "oh.memory-lab-api-terminal-rejection.v1"; attemptId: string;
  requestSha256: string; requestCaptureSha256: string; responseCaptureSha256: string;
  httpStatus: number; reason: "output-bound-exceeded"; maximumOutput: number; observedOutputTokens: number;
  reportedModel: string; usageMicrosUpperBound: number; retainedMicros: number;
  chargeBasis: "full-reservation-retained-billing-unverified";
}>;
export class TerminalApiResponseError extends Error {
  constructor(readonly rejection: TerminalApiRejection) {
    super("Memory lab API: terminal output-bound rejection; no accepted result.");
  }
}
function terminalRejection(id: string, request: ReturnType<typeof prepareApiRequest>, requestRaw: string, responseRaw: string): TerminalApiRejection {
  const response: unknown = JSON.parse(responseRaw);
  if (!isPlainRecord(response) || !hasExactKeys(response, ["httpStatus", "body"]) || !integer(response.httpStatus)
    || response.httpStatus < 200 || response.httpStatus >= 300 || typeof response.body !== "string"
    || Buffer.byteLength(response.body) > LIMIT) fail("complete successful HTTP capture required for terminal rejection");
  const body: unknown = JSON.parse(response.body);
  if (!isPlainRecord(body)) fail("unverified terminal provider status");
  if (API_MODELS[request.binding.model].provider === "xai") {
    if (!((body.status === "completed" && (body.incomplete_details === undefined || body.incomplete_details === null))
      || (body.status === "incomplete" && isPlainRecord(body.incomplete_details)
        && hasExactKeys(body.incomplete_details, ["reason"]) && body.incomplete_details.reason === "max_output_tokens"))) fail("unverified terminal xAI status");
  } else {
    const candidate = Array.isArray(body.candidates) && body.candidates.length === 1 ? body.candidates[0] : null;
    if (!isPlainRecord(candidate) || !["STOP", "MAX_TOKENS"].includes(String(candidate.finishReason))) fail("unverified terminal Gemini status");
  }
  const reply = parseReply(body, request, true);
  if (reply.usage.outputTokens <= request.binding.maximumOutput
    || (reply.result.status !== "completed" && reply.result.failureReason !== "output-token-limit")) fail("not a verified terminal output-bound rejection");
  return { protocol: "oh.memory-lab-api-terminal-rejection.v1", attemptId: id,
    requestSha256: request.requestSha256, requestCaptureSha256: sha256Hex(requestRaw), responseCaptureSha256: sha256Hex(responseRaw),
    httpStatus: response.httpStatus, reason: "output-bound-exceeded", maximumOutput: request.binding.maximumOutput,
    observedOutputTokens: reply.usage.outputTokens, reportedModel: reply.identity.reportedModel,
    usageMicrosUpperBound: reply.usage.micros, retainedMicros: request.reservationMicros,
    chargeBasis: "full-reservation-retained-billing-unverified" };
}
function privateLedgerParent(ledgerPath: string): void {
  const parent = dirname(ledgerPath), stat = lstatSync(parent);
  if (realpathSync(parent) !== parent || !stat.isDirectory() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) fail("private owned ledger directory required");
}
function readLedger(b: Budget): Event[] {
  const text = existsSync(b.ledgerPath) ? file(b.ledgerPath, 16 * LIMIT) : "";
  if (text && !text.endsWith("\n")) fail("partial ledger; reconcile before continuing");
  const events: unknown[] = text.split("\n").filter(Boolean).map(line => JSON.parse(line) as unknown);
  let prefix = 0; const charges = new Map<string, number>(), settled = new Set<string>();
  for (const e of events) {
    if (!isPlainRecord(e) || !hasExactKeys(e, ["v", "id", "kind", "micros"]) || e.v !== 1
      || typeof e.id !== "string" || !/^[a-f0-9-]{36}$/u.test(e.id) || !integer(e.micros)) fail("invalid ledger event");
    if (e.kind === "reserved") { if (charges.has(e.id)) fail("duplicate reservation"); prefix += e.micros; charges.set(e.id, e.micros); }
    else if (e.kind === "settled") {
      if (!charges.has(e.id) || settled.has(e.id) || e.micros > charges.get(e.id)!) fail("invalid settlement");
      prefix -= charges.get(e.id)! - e.micros; settled.add(e.id);
    } else fail("invalid event kind");
    if (!Number.isSafeInteger(prefix) || prefix > Math.floor(b.maxUsd * 1_000_000)) fail("ledger exceeded campaign authority");
  }
  return events as Event[];
}
function appendLedger(ledgerPath: string, event: Event): void {
  const fd = openSync(ledgerPath, "a", 0o600);
  try { writeSync(fd, JSON.stringify(event) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
  syncDirectory(dirname(ledgerPath));
}
function releaseOwnedLock(lockPath: string, fd: number): void {
  let owned = false;
  try { owned = lstatSync(lockPath).ino === fstatSync(fd).ino; }
  finally { closeSync(fd); }
  if (!owned) fail("lock identity changed");
  unlinkSync(lockPath); syncDirectory(dirname(lockPath));
}
function capturedRequest(raw: string, config: ApiConfig): ReturnType<typeof prepareApiRequest> {
  const c: unknown = JSON.parse(raw);
  if (!isPlainRecord(c) || !hasExactKeys(c, ["protocol", "binding", "requestSha256", "endpoint", "body", "reservationMicros"])
    || c.protocol !== API_PROTOCOL || !isPlainRecord(c.body)) fail("invalid request capture");
  const selected = binding(c.binding), body = c.body;
  if (![config.reader, config.judge].some(b => JSON.stringify(b) === JSON.stringify(selected))) fail("undeclared captured binding");
  let messages: Message[];
  if (API_MODELS[selected.model].provider === "xai") {
    if (!Array.isArray(body.input)) fail("invalid captured input");
    messages = body.input.map((v: unknown) => {
      if (!isPlainRecord(v) || !Array.isArray(v.content) || !isPlainRecord(v.content[0])) fail("invalid captured input");
      return { role: v.role, content: v.content[0].text } as Message;
    });
  } else {
    const system = body.systemInstruction, contents = body.contents;
    if (!Array.isArray(contents) || !isPlainRecord(contents[0]) || !Array.isArray(contents[0].parts)
      || !isPlainRecord(contents[0].parts[0])) fail("invalid captured input");
    messages = [];
    if (system !== undefined) {
      if (!isPlainRecord(system) || !Array.isArray(system.parts) || !isPlainRecord(system.parts[0])) fail("invalid captured system input");
      messages.push({ role: "system", content: system.parts[0].text } as Message);
    }
    messages.push({ role: "user", content: contents[0].parts[0].text } as Message);
  }
  const request = prepareApiRequest(selected, messages);
  if (JSON.stringify(body) !== request.raw || c.endpoint !== request.endpoint || c.requestSha256 !== request.requestSha256
    || c.reservationMicros !== request.reservationMicros) fail("captured request identity changed");
  return request;
}
function terminalEvidence(config: ApiConfig, b: Budget, id: string, expectedRequestSha256: string) {
  const events = readLedger(b), prefix = join(b.ledgerPath + ".attempts", id);
  if (existsSync(prefix + ".result.json")) fail("accepted result cannot be reconciled as rejected");
  const requestRaw = file(prefix + ".request.json", 3 * LIMIT), responseRaw = file(prefix + ".response.json", 3 * LIMIT);
  const request = capturedRequest(requestRaw, config), receipt = terminalRejection(id, request, requestRaw, responseRaw);
  const reserved = events.find(e => e.id === id && e.kind === "reserved"), settled = events.find(e => e.id === id && e.kind === "settled");
  if (request.requestSha256 !== expectedRequestSha256 || reserved?.micros !== receipt.retainedMicros
    || (settled && settled.micros !== receipt.retainedMicros)) fail("terminal evidence/reservation mismatch");
  const receiptPath = prefix + ".terminal-rejection.json", raw = JSON.stringify(receipt);
  if (existsSync(receiptPath) && file(receiptPath, 8192) !== raw) fail("terminal rejection receipt changed");
  return { events, prefix, settled, receiptPath, raw, receipt };
}
function ownerIsDead(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}
function acquireTerminalLock(config: ApiConfig, b: Budget, budgetRaw: string, id: string, expectedRequestSha256: string, recoverDeadOwner: boolean): number {
  const lockPath = b.ledgerPath + ".lock";
  if (!recoverDeadOwner || !existsSync(lockPath)) return openSync(lockPath, "wx", 0o600);
  // Never race two dead-owner transfers. An uncertain recovery mutex is retained
  // for separate custody review, not recursively deleted to obtain admission.
  const mutexPath = b.ledgerPath + ".recovery.lock", mutex = openSync(mutexPath, "wx", 0o600);
  try {
    writeSync(mutex, JSON.stringify({ pid: process.pid, protocol: "oh.memory-lab-api-lock-transfer.v1" })); fsyncSync(mutex); syncDirectory(dirname(mutexPath));
    const stat = lstatSync(lockPath), raw = file(lockPath, 4096), owner: unknown = JSON.parse(raw);
    if (!isPlainRecord(owner) || !hasExactKeys(owner, ["pid", "protocol", "budgetSha256"])
      || !integer(owner.pid) || owner.pid < 1 || owner.pid > 2147483647 || owner.protocol !== API_PROTOCOL
      || owner.budgetSha256 !== sha256Hex(budgetRaw) || !ownerIsDead(owner.pid)) fail("native lock owner is live, uncertain or bound to other authority");
    const evidence = terminalEvidence(config, b, id, expectedRequestSha256), settledIds = new Set(evidence.events.filter(e => e.kind === "settled").map(e => e.id));
    // Settled dead-owner cleanup belongs to the existing campaign recovery
    // path. It must never compete with this unresolved-attempt transfer.
    if (evidence.settled) fail("dead-owner transfer requires an unresolved target; recover settled campaign locks separately");
    if (evidence.events.some(e => e.kind === "reserved" && !settledIds.has(e.id) && e.id !== id)) fail("other unresolved attempts prevent dead-owner transfer");
    const proof = JSON.stringify({ protocol: "oh.memory-lab-api-lock-transfer.v1", attemptId: id, oldLock: raw,
      oldInode: stat.ino, rejectionSha256: sha256Hex(evidence.raw) });
    const proofPath = evidence.prefix + ".dead-lock-" + sha256Hex(proof) + ".json";
    if (Buffer.byteLength(proof) > 8192) fail("lock recovery evidence exceeds bound");
    if (existsSync(proofPath)) { if (file(proofPath, 8192) !== proof) fail("lock recovery evidence changed"); }
    else {
      if (readdirSync(dirname(evidence.prefix)).filter(name => name.startsWith(id + ".dead-lock-")).length >= 16) fail("lock recovery evidence count exhausted");
      writeCapture(proofPath, proof);
    }
    if (lstatSync(lockPath).ino !== stat.ino || file(lockPath, 4096) !== raw || !ownerIsDead(owner.pid)) fail("native lock identity or owner changed");
    unlinkSync(lockPath); syncDirectory(dirname(lockPath));
  } finally {
    releaseOwnedLock(mutexPath, mutex);
  }
  // Acquire only after successful mutex cleanup: no unreturned descriptor can
  // leak on a cleanup failure. Another opener may win; wx then fails closed.
  // An unresolved reservation prevents any normal opener from dispatching.
  return openSync(lockPath, "wx", 0o600);
}
function terminalAttempt(value: unknown, reconcile: boolean): TerminalApiRejection {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["config", "attemptId", "expectedRequestSha256", ...(Object.hasOwn(value, "recoverDeadOwner") ? ["recoverDeadOwner"] : [])])
    || typeof value.attemptId !== "string" || !/^[a-f0-9-]{36}$/u.test(value.attemptId)
    || typeof value.expectedRequestSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.expectedRequestSha256)
    || (Object.hasOwn(value, "recoverDeadOwner") && (value.recoverDeadOwner !== true || !reconcile))) fail("exact terminal attempt identity required");
  const config = parseApiConfig(value.config), budgetRaw = file(config.budgetPath, 8192), b = budget(JSON.parse(budgetRaw));
  privateLedgerParent(b.ledgerPath);
  const id = value.attemptId, lockPath = b.ledgerPath + ".lock", fd = acquireTerminalLock(config, b, budgetRaw, id, value.expectedRequestSha256, value.recoverDeadOwner === true);
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, protocol: API_PROTOCOL, budgetSha256: sha256Hex(budgetRaw) })); fsyncSync(fd); syncDirectory(dirname(lockPath));
    const { receipt, receiptPath, raw, settled } = terminalEvidence(config, b, id, value.expectedRequestSha256);
    if (existsSync(receiptPath)) { if (file(receiptPath, 8192) !== raw) fail("terminal rejection receipt changed"); }
    else if (reconcile) writeCapture(receiptPath, raw);
    else fail("terminal rejection receipt missing");
    if (!settled) {
      if (!reconcile) fail("terminal rejection not settled");
      appendLedger(b.ledgerPath, { v: 1, id, kind: "settled", micros: receipt.retainedMicros });
    }
    return receipt;
  } finally {
    releaseOwnedLock(lockPath, fd);
  }
}
/** Offline, exactly-once full-reservation reconciliation; never accepts a score or dispatches. */
export function reconcileTerminalApiAttempt(value: unknown): TerminalApiRejection { return terminalAttempt(value, true); }
/** Read-only evidence validation under the same ledger lock. Expired authority permits no new calls. */
export function verifyTerminalApiAttempt(value: unknown): TerminalApiRejection { return terminalAttempt(value, false); }

export class ApiLabTransport {
  readonly concurrency = 1;
  readonly config: ApiConfig;
  readonly #budget: Budget;
  readonly #budgetSha: string;
  readonly #lockPath: string;
  readonly #lockFd: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #deadline: number;
  readonly #runMaxCalls: number;
  #exposure: number;
  #campaignCalls: number;
  #busy = false;
  #closed = false;
  calls = 0;
  halted = false;
  private constructor(config: ApiConfig, b: Budget, raw: string, fd: number, events: Event[], fetcher: typeof fetch, now: () => number, maxCalls: number) {
    this.config = config; this.#budget = b; this.#runMaxCalls = maxCalls;
    this.#budgetSha = sha256Hex(raw); this.#lockPath = b.ledgerPath + ".lock"; this.#lockFd = fd;
    this.#exposure = ledgerExposure(events); this.#campaignCalls = events.filter(e => e.kind === "reserved").length;
    this.#fetch = fetcher; this.#now = now; this.#deadline = Math.min(Date.parse(b.expiresAt), now() + 60 * 60 * 1000);
  }
  static async open(options: { config: unknown; maxCalls: number; fetcher?: typeof fetch; now?: () => number }) {
    const config = parseApiConfig(options.config), raw = file(config.budgetPath, 8192), b = budget(JSON.parse(raw));
    const now = options.now ?? Date.now;
    if (!integer(options.maxCalls) || options.maxCalls < 1 || options.maxCalls > 1000 || now() >= Date.parse(b.expiresAt) || now() >= RATES_EXPIRE) fail("expired authority/rates or invalid call limit");
    privateLedgerParent(b.ledgerPath);
    const fd = openSync(b.ledgerPath + ".lock", "wx", 0o600);
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, protocol: API_PROTOCOL, budgetSha256: sha256Hex(raw) })); fsyncSync(fd);
      const events = readLedger(b);
      if (events.filter(e => e.kind === "reserved").length !== events.filter(e => e.kind === "settled").length) fail("unresolved provider attempt; reconcile before continuing");
      return new ApiLabTransport(config, b, raw, fd, events as Event[], options.fetcher ?? fetch, now, options.maxCalls);
    } catch (error) { closeSync(fd); unlinkSync(b.ledgerPath + ".lock"); throw error; }
  }
  #append(event: Event) { appendLedger(this.#budget.ledgerPath, event); }
  get summary() { return { capUsd: this.#budget.maxUsd, accountedUsd: this.#exposure / 1_000_000,
    campaignCalls: this.#campaignCalls, callsThisRun: this.calls, halted: this.halted }; }
  async invoke(profileId: string, messages: readonly Message[]): Promise<ApiReply> {
    if (this.#closed || this.halted || this.#busy) fail("closed, halted or concurrent transport");
    this.#busy = true;
    try {
      const b = [this.config.reader, this.config.judge].find(x => x.id === profileId);
      if (!b) fail("undeclared role");
      if (sha256Hex(file(this.config.budgetPath, 8192)) !== this.#budgetSha || this.#now() >= this.#deadline || this.#now() >= RATES_EXPIRE) fail("authority changed or expired");
      const key = process.env[b.keyEnv];
      if (!key) fail("selected credential is absent");
      const request = prepareApiRequest(b, messages);
      if (this.calls >= this.#runMaxCalls || this.#campaignCalls >= this.#budget.maxCalls
        || this.#exposure + request.reservationMicros > Math.floor(this.#budget.maxUsd * 1_000_000)) fail("campaign limit reached before dispatch");
      const id = randomUUID(), attempts = this.#budget.ledgerPath + ".attempts";
      mkdirSync(attempts, { recursive: true, mode: 0o700 });
      const capture = (suffix: string, content: string) => writeCapture(join(attempts, id + suffix), content);
      const requestRaw = JSON.stringify({ protocol: API_PROTOCOL, binding: b, requestSha256: request.requestSha256,
        endpoint: request.endpoint, body: JSON.parse(request.raw), reservationMicros: request.reservationMicros });
      capture(".request.json", requestRaw);
      this.#append({ v: 1, id, kind: "reserved", micros: request.reservationMicros });
      this.#exposure += request.reservationMicros; this.#campaignCalls++; this.calls++;
      const response = await this.#fetch(request.endpoint, { method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json", ...(API_MODELS[b.model].provider === "gemini" ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` }) },
        body: request.raw, signal: AbortSignal.timeout(Math.min(120_000, Math.max(1, this.#deadline - this.#now()))) });
      const reader = response.body?.getReader(); if (!reader) fail("missing response body; reservation retained");
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) { const item = await reader.read(); if (item.done) break; bytes += item.value.length;
          if (bytes > LIMIT) { await reader.cancel(); fail("response bound exceeded; reservation retained"); } chunks.push(item.value); }
      } finally { reader.releaseLock(); }
      const raw = Buffer.concat(chunks).toString("utf8");
      const responseRaw = JSON.stringify({ httpStatus: response.status, body: raw });
      capture(".response.json", responseRaw);
      if (!response.ok) {
        // An acknowledged pre-generation rejection can be reconciled without
        // asserting a zero bill. Keep the entire bound charged and stop this run.
        if ([400, 401, 403, 404, 422].includes(response.status)) {
          capture(".rejection.json", JSON.stringify({ httpStatus: response.status, outcome: "acknowledged-rejection",
            chargeBasis: "full-reservation-retained-billing-unverified", micros: request.reservationMicros }));
          this.#append({ v: 1, id, kind: "settled", micros: request.reservationMicros });
        }
        fail(`HTTP ${response.status}; reservation retained`);
      }
      let reply: ApiReply;
      try { reply = parseApiReply(JSON.parse(raw) as unknown, request); }
      catch (error) {
        let rejection: TerminalApiRejection;
        try { rejection = terminalRejection(id, request, requestRaw, responseRaw); }
        catch { throw error; } // Unverifiable outcomes keep the unresolved reservation.
        capture(".terminal-rejection.json", JSON.stringify(rejection));
        this.#append({ v: 1, id, kind: "settled", micros: request.reservationMicros });
        throw new TerminalApiResponseError(rejection);
      }
      capture(".result.json", JSON.stringify(reply));
      this.#append({ v: 1, id, kind: "settled", micros: reply.usage.micros });
      this.#exposure -= request.reservationMicros - reply.usage.micros;
      return reply;
    } catch (error) { this.halted = true; throw error; } finally { this.#busy = false; }
  }
  close() {
    if (this.#closed) return;
    if (this.#busy) fail("cannot close during a provider call");
    if (lstatSync(this.#lockPath).ino !== fstatSync(this.#lockFd).ino) fail("lock identity changed");
    closeSync(this.#lockFd); unlinkSync(this.#lockPath); this.#closed = true;
  }
}
