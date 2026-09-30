/** Subscription transport for development screens: readers and judges run through xcb's application route
 * (`xcb --json generate`) on the operator's own AI subscriptions instead of the paid Gateway.
 *
 * Results are not comparable with the released GPT-4o BEAM scorer or any Gateway profile: the model, the
 * one-block prompt rendering and the provider's hidden settings all differ. Use them to screen cheaply;
 * make claims with the paid Gateway profiles. No dollar ledger is kept; every xcb call is recorded in a
 * local JSONL ledger (no credentials, no environment) that also lets an interrupted run resume. */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { canonicalSha256, hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import type { Message } from "./model";
import { EVOLUTION_BEAM_JUDGE_PROFILE_IDS, EVOLUTION_PROFILES, EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_V11_READER_PROFILE_ID,
  type EvolutionProfileId } from "./evolution-model";

export const XCB_SUBSCRIPTION_PROTOCOL = "oh.xcb-subscription-transport.v1" as const;
export const XCB_SUBSCRIPTION_PROMPT_PROTOCOL = "oh.xcb-subscription-prompt.v1" as const;
export const XCB_SUBSCRIPTION_LEDGER_PROTOCOL = "oh.xcb-subscription-ledger.v1" as const;
export const XCB_SUBSCRIPTION_COMPARABILITY = Object.freeze({
  releasedScorerComparable: false as const, gatewayComparable: false as const, use: "development-screen-only" as const,
  note: "Subscription model and one-block prompt rendering differ from the released GPT-4o scorer and Gateway readers; claims use the paid Gateway profiles.",
});

const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_CAPABILITIES_BYTES = 2 * 1024 * 1024;

export type XcbSubscriptionRole = "reader" | "judge";
export type XcbSubscriptionProfile = Readonly<{
  id: string; role: XcbSubscriptionRole; transport: "xcb-subscription";
  /** Exact xcb model key, or a prefix matched as `prefix/<effort>`; the exact key is preferred. */
  modelKey: string;
  /** Gateway profiles whose message bytes this profile sends, rendered into one prompt block. */
  mirrors: readonly EvolutionProfileId[];
  /** Accepted message shapes: one user message, or system followed by user. */
  shapes: readonly ("user" | "system-user")[];
  /** Reader instruction pin: the system message must hash to the mirrored Gateway reader's contract. */
  instructionSha256: string | null;
  maxOutputBytes: number; timeoutMs: number;
  promptProtocol: typeof XCB_SUBSCRIPTION_PROMPT_PROTOCOL;
  comparability: typeof XCB_SUBSCRIPTION_COMPARABILITY;
}>;

for (const [mirror, contract] of [[EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID, "task-complete-v10"], [EVOLUTION_TASK_COMPLETE_V11_READER_PROFILE_ID, "task-complete-v11"]] as const) {
  if (EVOLUTION_PROFILES[mirror].readerContract?.id !== contract) throw new TypeError(`xcb subscription: ${contract} reader contract missing.`);
}

function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
const reader = (id: string, modelKey: string, mirror: EvolutionProfileId): XcbSubscriptionProfile => ({ id, role: "reader", transport: "xcb-subscription", modelKey,
  mirrors: [mirror], shapes: ["system-user"], instructionSha256: EVOLUTION_PROFILES[mirror].readerContract!.instructionSha256,
  maxOutputBytes: 65_536, timeoutMs: 300_000, promptProtocol: XCB_SUBSCRIPTION_PROMPT_PROTOCOL, comparability: XCB_SUBSCRIPTION_COMPARABILITY });
// One judge profile serves the three released BEAM scorer calls: extraction and nugget send one user
// message; equivalence sends system and user. Template bytes stay caller-owned (beam-released-scorer-v1).
const judge = (id: string, modelKey: string): XcbSubscriptionProfile => ({ id, role: "judge", transport: "xcb-subscription", modelKey,
  mirrors: [...EVOLUTION_BEAM_JUDGE_PROFILE_IDS], shapes: ["user", "system-user"], instructionSha256: null,
  maxOutputBytes: 16_384, timeoutMs: 120_000, promptProtocol: XCB_SUBSCRIPTION_PROMPT_PROTOCOL, comparability: XCB_SUBSCRIPTION_COMPARABILITY });

export const XCB_CLAUDE_HAIKU_TASK_COMPLETE_V10_READER_PROFILE_ID = "xcb-claude-haiku-task-complete-v10" as const;
export const XCB_CLAUDE_HAIKU_TASK_COMPLETE_V11_READER_PROFILE_ID = "xcb-claude-haiku-task-complete-v11" as const;
export const XCB_CLAUDE_HAIKU_BEAM_JUDGE_PROFILE_ID = "xcb-claude-haiku-beam-judge" as const;
/** Development lab reader: same message shape and limits as the v10 mirror but no instruction pin, so a lab can screen
 * unregistered instructions. The lab freezes each instruction's hash itself; a winner is registered as a contract before any paid run. */
export const XCB_CLAUDE_HAIKU_LAB_READER_PROFILE_ID = "xcb-claude-haiku-lab-reader" as const;
export const XCB_SUBSCRIPTION_PROFILES = frozen({
  [XCB_CLAUDE_HAIKU_TASK_COMPLETE_V10_READER_PROFILE_ID]: reader(XCB_CLAUDE_HAIKU_TASK_COMPLETE_V10_READER_PROFILE_ID, "claude/haiku", EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID),
  [XCB_CLAUDE_HAIKU_TASK_COMPLETE_V11_READER_PROFILE_ID]: reader(XCB_CLAUDE_HAIKU_TASK_COMPLETE_V11_READER_PROFILE_ID, "claude/haiku", EVOLUTION_TASK_COMPLETE_V11_READER_PROFILE_ID),
  [XCB_CLAUDE_HAIKU_LAB_READER_PROFILE_ID]: { ...reader(XCB_CLAUDE_HAIKU_LAB_READER_PROFILE_ID, "claude/haiku", EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID), instructionSha256: null },
  [XCB_CLAUDE_HAIKU_BEAM_JUDGE_PROFILE_ID]: judge(XCB_CLAUDE_HAIKU_BEAM_JUDGE_PROFILE_ID, "claude/haiku"),
} satisfies Record<string, XcbSubscriptionProfile>);
export type XcbSubscriptionProfileId = keyof typeof XCB_SUBSCRIPTION_PROFILES;

/** Driver selection: subscription profile ids never collide with Gateway ids, which stay the default. */
export function isXcbSubscriptionProfileId(value: unknown): value is XcbSubscriptionProfileId {
  return typeof value === "string" && Object.hasOwn(XCB_SUBSCRIPTION_PROFILES, value);
}
function profileOf(id: unknown): XcbSubscriptionProfile {
  if (!isXcbSubscriptionProfileId(id)) throw new TypeError("xcb subscription: unknown profile.");
  return XCB_SUBSCRIPTION_PROFILES[id];
}
export function xcbModelMatches(profileValue: XcbSubscriptionProfile, key: string): boolean {
  return key === profileValue.modelKey || (key.startsWith(`${profileValue.modelKey}/`) && !key.slice(profileValue.modelKey.length + 1).includes("/"));
}

export type XcbSubscriptionRequest = Readonly<{ protocol: typeof XCB_SUBSCRIPTION_PROTOCOL; profileId: XcbSubscriptionProfileId;
  prompt: string; promptSha256: string; promptBytes: number; maxOutputBytes: number; timeoutMs: number; requestSha256: string }>;

/** Render Gateway messages into xcb's single text block. One user message passes through byte-identical;
 * system + user become two tagged sections, because the application route has no system role. */
export function renderXcbPrompt(messages: readonly Message[]): string {
  if (messages.length === 1 && messages[0]!.role === "user") return messages[0]!.content;
  if (messages.length === 2 && messages[0]!.role === "system" && messages[1]!.role === "user") {
    return `<system>\n${messages[0]!.content}\n</system>\n\n<user>\n${messages[1]!.content}\n</user>`;
  }
  throw new TypeError("xcb subscription: unsupported message shape.");
}

/** Pure request preparation with the same message checks the mirrored Gateway profile applies. */
export function makeXcbSubscriptionRequest(profileId: XcbSubscriptionProfileId, messages: readonly Message[]): XcbSubscriptionRequest {
  const selected = profileOf(profileId);
  if (!Array.isArray(messages) || !messages.every(message => isPlainRecord(message) && hasExactKeys(message, ["role", "content"])
    && typeof message.content === "string" && message.content.length > 0 && message.content.length <= 1_048_576
    && !/\p{Surrogate}/u.test(message.content) && !message.content.includes("\u0000"))) throw new TypeError("xcb subscription: invalid messages.");
  const shape = messages.length === 1 && messages[0]!.role === "user" ? "user"
    : messages.length === 2 && messages[0]!.role === "system" && messages[1]!.role === "user" ? "system-user" : null;
  if (shape === null || !selected.shapes.includes(shape)) throw new TypeError("xcb subscription: invalid prompt shape for profile.");
  if (selected.instructionSha256 !== null && canonicalSha256(messages[0]!.content) !== selected.instructionSha256) {
    throw new TypeError("xcb subscription: reader instruction differs from the mirrored contract.");
  }
  const prompt = renderXcbPrompt(messages);
  const preimage = { protocol: XCB_SUBSCRIPTION_PROTOCOL, profileId, promptProtocol: selected.promptProtocol, prompt,
    maxOutputBytes: selected.maxOutputBytes };
  return frozen({ protocol: XCB_SUBSCRIPTION_PROTOCOL, profileId, prompt, promptSha256: sha256Hex(prompt), promptBytes: Buffer.byteLength(prompt),
    maxOutputBytes: selected.maxOutputBytes, timeoutMs: selected.timeoutMs, requestSha256: canonicalSha256(preimage) });
}

// ---------------------------------------------------------------------------------------------------------
// xcb process boundary

export type XcbLimits = Readonly<{ maxInputBytes: number; maxOutputBytes: number; minTimeoutMs: number; maxTimeoutMs: number }>;
export type XcbAccount = Readonly<{ id: string; runtimeDigest: string; models: readonly string[] }>;
export type XcbCapabilities = Readonly<{ limits: XcbLimits; accounts: readonly XcbAccount[] }>;
export const XCB_FAILURE_CODES = ["invalid_request", "unavailable", "busy", "deadline", "cancelled", "provider_error", "output_limit", "custody_unproven"] as const;
export type XcbFailureCode = typeof XCB_FAILURE_CODES[number];
type Outcome = Readonly<{ kind: "completed"; text: string; xcbRequestId: string | null }>
  | Readonly<{ kind: "failed"; code: XcbFailureCode; xcbRequestId: string | null }>
  | Readonly<{ kind: "uncertain"; reason: string }>;

const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const accountId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value);

/** Parse `xcb --json generate --capabilities`: only rows with available:true and qualification evidence are eligible. */
export function parseXcbCapabilities(raw: string): XcbCapabilities {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new TypeError("xcb capabilities: malformed JSON."); }
  if (!isPlainRecord(value) || value.version !== 1 || !isPlainRecord(value.limits) || !Array.isArray(value.accounts)) throw new TypeError("xcb capabilities: unexpected shape.");
  const { maxInputBytes, maxOutputBytes, minTimeoutMs, maxTimeoutMs } = value.limits;
  if (!positive(maxInputBytes) || !positive(maxOutputBytes) || !positive(minTimeoutMs) || !positive(maxTimeoutMs) || minTimeoutMs > maxTimeoutMs) {
    throw new TypeError("xcb capabilities: invalid limits.");
  }
  const accounts: XcbAccount[] = [];
  for (const row of value.accounts) {
    if (!isPlainRecord(row) || row.available !== true || !accountId(row.id) || !Array.isArray(row.models)) continue;
    const qualification = row.qualification;
    if (!isPlainRecord(qualification) || typeof qualification.runtimeDigest !== "string" || qualification.runtimeDigest.length === 0) continue;
    const models = row.models.flatMap(model => isPlainRecord(model) && typeof model.key === "string" && model.key.length > 0 && model.key.length <= 256 ? [model.key] : []);
    accounts.push({ id: row.id, runtimeDigest: qualification.runtimeDigest, models: [...new Set(models)].sort() });
  }
  return frozen({ limits: { maxInputBytes, maxOutputBytes, minTimeoutMs, maxTimeoutMs }, accounts });
}

/** Map one finished xcb process to an outcome. Anything unverifiable is "uncertain": the run must halt. */
export function parseXcbGenerateOutput(stdout: string, exitCode: number, account: string, model: string): Outcome {
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { return { kind: "uncertain", reason: `unparseable xcb output (exit ${exitCode})` }; }
  if (!isPlainRecord(value) || value.version !== 1) return { kind: "uncertain", reason: `unexpected xcb output (exit ${exitCode})` };
  const xcbRequestId = typeof value.requestId === "string" && value.requestId.length <= 256 ? value.requestId : null;
  if (exitCode === 0 && value.status === "completed") {
    if (typeof value.text !== "string" || value.account !== account || value.model !== model) return { kind: "uncertain", reason: "completed output does not match the request" };
    return { kind: "completed", text: value.text, xcbRequestId };
  }
  if (exitCode !== 0 && value.status === "failed" && typeof value.code === "string" && (XCB_FAILURE_CODES as readonly string[]).includes(value.code)) {
    return { kind: "failed", code: value.code as XcbFailureCode, xcbRequestId };
  }
  return { kind: "uncertain", reason: `inconsistent xcb status (exit ${exitCode})` };
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<{ text: string; exceeded: boolean }> {
  const chunks: Uint8Array[] = [];
  let bytes = 0, exceeded = false;
  for await (const chunk of stream) {
    if (exceeded) continue;
    bytes += chunk.byteLength;
    if (bytes > limit) { exceeded = true; continue; }
    chunks.push(chunk);
  }
  return { text: exceeded ? "" : Buffer.concat(chunks).toString("utf8"), exceeded };
}

/** `bin` defaults to `XCB_BIN`, then `xcb` on PATH. */
export type XcbProcessOptions = Readonly<{ bin?: string; env?: Record<string, string | undefined>;
  /** Extra wait past the xcb deadline before sending SIGTERM (xcb cleanup may outlast its deadline). */
  graceMs?: number; /** Wait after SIGTERM before declaring custody uncertain. Never SIGKILL: a killed xcb proves nothing. */ termWaitMs?: number }>;

export function xcbBin(options: XcbProcessOptions): string {
  const bin = options.bin ?? options.env?.XCB_BIN ?? process.env.XCB_BIN ?? "xcb";
  if (bin.length === 0 || bin.includes("\0")) throw new Error("xcb binary path is invalid.");
  return bin;
}

export async function readXcbCapabilities(options: XcbProcessOptions): Promise<XcbCapabilities> {
  const child = Bun.spawn([xcbBin(options), "--json", "generate", "--capabilities"], { env: options.env ?? process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, , code] = await Promise.all([readBounded(child.stdout, MAX_CAPABILITIES_BYTES), readBounded(child.stderr, MAX_STDERR_BYTES), child.exited]);
  if (code !== 0 || out.exceeded) throw new Error(`xcb capabilities failed (exit ${code}).`);
  return parseXcbCapabilities(out.text);
}

async function runXcbGenerate(options: XcbProcessOptions, input: string, account: string, model: string, timeoutMs: number): Promise<Outcome> {
  const child = Bun.spawn([xcbBin(options), "--json", "generate"], { env: options.env ?? process.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const stdout = readBounded(child.stdout, MAX_STDOUT_BYTES);
  const stderr = readBounded(child.stderr, MAX_STDERR_BYTES); // Drained and discarded; never logged.
  try { child.stdin.write(input); await child.stdin.end(); } catch { /* The exit status and stdout decide the outcome. */ }
  let terminated = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const watchdog = new Promise<"stuck">(resolve => {
    timers.push(setTimeout(() => { terminated = true; child.kill("SIGTERM");
      timers.push(setTimeout(() => resolve("stuck"), options.termWaitMs ?? 60_000)); }, timeoutMs + (options.graceMs ?? 120_000)));
  });
  const exited = await Promise.race([child.exited, watchdog]);
  for (const timer of timers) clearTimeout(timer);
  if (exited === "stuck") return { kind: "uncertain", reason: "xcb did not exit after SIGTERM" };
  const [out] = await Promise.all([stdout, stderr]);
  if (out.exceeded) return { kind: "uncertain", reason: "xcb output exceeded the local bound" };
  const outcome = parseXcbGenerateOutput(out.text, exited, account, model);
  // A watchdog-cancelled call is not an application-requested cancellation; keep it retryable as a deadline.
  return terminated && outcome.kind === "failed" && outcome.code === "cancelled" ? { ...outcome, code: "deadline" } : outcome;
}

// ---------------------------------------------------------------------------------------------------------
// Account pool, retries and ledger

export class XcbSubscriptionHalt extends Error { override name = "XcbSubscriptionHalt"; }
export class XcbSubscriptionFailure extends Error { override name = "XcbSubscriptionFailure"; }

export type XcbSubscriptionResult = Readonly<{
  requestSha256: string; status: "completed" | "truncated" | "failed";
  answer: string | null; partialAnswer: string | null; finishReason: null;
  failureReason: string | null;
  /** Subscription calls have no metered cost here; the field keeps Gateway drivers' arithmetic working. */
  usage: Readonly<{ micros: 0 }>;
  identity: Readonly<{ transport: "xcb-subscription"; profileId: XcbSubscriptionProfileId; account: string | null; model: string | null;
    runtimeDigest: string | null; comparability: typeof XCB_SUBSCRIPTION_COMPARABILITY }>;
}>;
export type XcbSubscriptionInvocation = Readonly<{ request: XcbSubscriptionRequest; result: XcbSubscriptionResult;
  /** Retries after the first attempt. */ counted: number; replayed: boolean }>;

export type XcbSubscriptionOptions = XcbProcessOptions & Readonly<{
  ledgerPath: string;
  /** Profiles this run will use; each needs at least one available (account, model) pair. */
  profiles: readonly XcbSubscriptionProfileId[];
  /** Per-run cap on xcb generate processes (retries count; ledger replays do not). */
  maxCalls: number;
  /** Optional account allow-list (exact ids). */
  accounts?: readonly string[];
  maxAttempts?: number; backoffBaseMs?: number; backoffCapMs?: number;
  capabilities?: XcbCapabilities;
  now?: () => number; sleep?: (ms: number) => Promise<void>;
}>;
const RETRYABLE: ReadonlySet<XcbFailureCode> = new Set(["busy", "deadline", "provider_error", "unavailable"]);
const HALTING: ReadonlySet<XcbFailureCode> = new Set(["custody_unproven", "cancelled"]);

type Slot = { account: XcbAccount; busy: boolean; held: boolean };
type LedgerLine = Readonly<{ protocol: typeof XCB_SUBSCRIPTION_LEDGER_PROTOCOL; at: string; requestSha256: string; profileId: string;
  attempt: number; account: string | null; model: string | null; runtimeDigest: string | null; xcbRequestId: string | null;
  promptSha256: string; promptBytes: number; outputBytes: number | null; latencyMs: number;
  status: "completed" | "failed" | "uncertain" | "rejected-local"; code: string | null; text?: string }>;

/** One transport per run: owns the account pool, the per-run call cap and the append-only ledger. */
export class XcbSubscriptionTransport {
  readonly concurrency: number;
  readonly limits: XcbLimits;
  #halted: string | null = null;
  #calls = 0;
  #cursor = 0;
  readonly #slots: Slot[];
  readonly #waiters: Array<() => void> = [];
  readonly #replay = new Map<string, LedgerLine>();
  readonly #options: XcbSubscriptionOptions;
  readonly #models: ReadonlyMap<string, ReadonlyMap<XcbSubscriptionProfileId, string>>;

  private constructor(options: XcbSubscriptionOptions, capabilities: XcbCapabilities) {
    if (!Number.isSafeInteger(options.maxCalls) || options.maxCalls < 1) throw new TypeError("xcb subscription: maxCalls must be a positive integer.");
    if (options.profiles.length === 0) throw new TypeError("xcb subscription: at least one profile is required.");
    this.#options = options;
    this.limits = capabilities.limits;
    const allow = options.accounts === undefined ? null : new Set(options.accounts);
    const models = new Map<string, Map<XcbSubscriptionProfileId, string>>();
    for (const account of capabilities.accounts) {
      if (allow !== null && !allow.has(account.id)) continue;
      const chosen = new Map<XcbSubscriptionProfileId, string>();
      for (const id of options.profiles) {
        const selected = profileOf(id);
        const matches = account.models.filter(key => xcbModelMatches(selected, key));
        const key = matches.includes(selected.modelKey) ? selected.modelKey : matches[0];
        if (key !== undefined) chosen.set(id, key);
      }
      if (chosen.size > 0) models.set(account.id, chosen);
    }
    for (const id of options.profiles) {
      if (![...models.values()].some(map => map.has(id))) throw new Error(`xcb subscription: no available account/model for ${id}; run \`xcb --json generate --capabilities\`.`);
    }
    this.#models = models;
    this.#slots = capabilities.accounts.filter(account => models.has(account.id)).map(account => ({ account, busy: false, held: false }));
    this.concurrency = this.#slots.length;
    if (existsSync(options.ledgerPath)) {
      for (const line of readFileSync(options.ledgerPath, "utf8").split("\n")) {
        if (line.length === 0) continue;
        let row: unknown;
        try { row = JSON.parse(line); } catch { continue; } // A torn final line from a killed run is skipped.
        if (!isPlainRecord(row) || row.protocol !== XCB_SUBSCRIPTION_LEDGER_PROTOCOL || typeof row.requestSha256 !== "string") continue;
        const terminal = (row.status === "completed" && typeof row.text === "string") || (row.status === "failed" && row.code === "output_limit")
          || row.status === "rejected-local";
        if (terminal && !this.#replay.has(row.requestSha256)) this.#replay.set(row.requestSha256, row as LedgerLine);
      }
    }
  }

  static async open(options: XcbSubscriptionOptions): Promise<XcbSubscriptionTransport> {
    return new XcbSubscriptionTransport(options, options.capabilities ?? await readXcbCapabilities(options));
  }

  get halted(): string | null { return this.#halted; }
  get calls(): number { return this.#calls; }
  /** (account, model) pairs per profile, for the run header. Account ids are opaque, not credentials. */
  pairs(): ReadonlyArray<Readonly<{ account: string; profileId: XcbSubscriptionProfileId; model: string }>> {
    return [...this.#models].flatMap(([account, map]) => [...map].map(([profileId, model]) => ({ account, profileId, model })));
  }

  #halt(reason: string): never {
    this.#halted ??= reason;
    for (const wake of this.#waiters.splice(0)) wake();
    throw new XcbSubscriptionHalt(`xcb subscription halted: ${reason}.`);
  }
  #log(line: Omit<LedgerLine, "protocol" | "at">): void {
    appendFileSync(this.#options.ledgerPath, JSON.stringify({ protocol: XCB_SUBSCRIPTION_LEDGER_PROTOCOL, at: new Date().toISOString(), ...line }) + "\n", { mode: 0o600 });
  }
  async #acquire(profileId: XcbSubscriptionProfileId): Promise<Slot> {
    for (;;) {
      if (this.#halted !== null) this.#halt(this.#halted);
      const eligible = this.#slots.filter(slot => !slot.held && this.#models.get(slot.account.id)!.has(profileId));
      if (eligible.length === 0) this.#halt(`every account for ${profileId} is held after an uncertain outcome`);
      for (let offset = 0; offset < this.#slots.length; offset++) {
        const index = (this.#cursor + offset) % this.#slots.length, slot = this.#slots[index]!;
        if (slot.busy || slot.held || !this.#models.get(slot.account.id)!.has(profileId)) continue;
        slot.busy = true;
        this.#cursor = (index + 1) % this.#slots.length;
        return slot;
      }
      await new Promise<void>(resolve => this.#waiters.push(resolve));
    }
  }
  #release(slot: Slot): void {
    slot.busy = false;
    this.#waiters.shift()?.();
  }

  /** Send one reader or judge request. Returns a Gateway-shaped result; throws XcbSubscriptionHalt (stop the run)
   * or XcbSubscriptionFailure (this request failed permanently). */
  async invoke(profileId: XcbSubscriptionProfileId, messages: readonly Message[]): Promise<XcbSubscriptionInvocation> {
    const request = makeXcbSubscriptionRequest(profileId, messages);
    const identity = (account: string | null, model: string | null, runtimeDigest: string | null) =>
      ({ transport: "xcb-subscription" as const, profileId, account, model, runtimeDigest, comparability: XCB_SUBSCRIPTION_COMPARABILITY });
    const result = (status: XcbSubscriptionResult["status"], text: string | null, failureReason: string | null, id: XcbSubscriptionResult["identity"]): XcbSubscriptionResult =>
      frozen({ requestSha256: request.requestSha256, status, answer: status === "completed" ? text!.trim() : null,
        partialAnswer: text === null ? null : text.trim(), finishReason: null, failureReason, usage: { micros: 0 as const }, identity: id });
    const truncated = (id: XcbSubscriptionResult["identity"]) => result("truncated", null, "output-token-limit", id);

    const prior = this.#replay.get(request.requestSha256);
    if (prior !== undefined) {
      const id = identity(prior.account, prior.model, prior.runtimeDigest);
      const replayed = prior.status === "completed" ? result("completed", prior.text!, null, id)
        : prior.status === "rejected-local" ? result("failed", null, "xcb-input-limit", id) : truncated(id);
      return frozen({ request, result: replayed, counted: 0, replayed: true });
    }
    if (this.#halted !== null) this.#halt(this.#halted);
    const base = { requestSha256: request.requestSha256, profileId, promptSha256: request.promptSha256, promptBytes: request.promptBytes };
    const timeoutMs = Math.min(Math.max(request.timeoutMs, this.limits.minTimeoutMs), this.limits.maxTimeoutMs);
    const maxOutputBytes = Math.min(request.maxOutputBytes, this.limits.maxOutputBytes);
    const maxAttempts = this.#options.maxAttempts ?? 6, now = this.#options.now ?? Date.now;
    const sleep = this.#options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
    let lastCode: string | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) await sleep(Math.min(this.#options.backoffCapMs ?? 60_000, (this.#options.backoffBaseMs ?? 2_000) * 2 ** (attempt - 1)));
      const slot = await this.#acquire(profileId);
      const account = slot.account.id, model = this.#models.get(account)!.get(profileId)!;
      const input = JSON.stringify({ version: 1, account, model, prompt: request.prompt, timeoutMs, maxOutputBytes });
      const where = { ...base, attempt, account, model, runtimeDigest: slot.account.runtimeDigest };
      if (Buffer.byteLength(input) > this.limits.maxInputBytes) {
        this.#release(slot);
        this.#log({ ...where, xcbRequestId: null, outputBytes: null, latencyMs: 0, status: "rejected-local", code: "input_limit" });
        return frozen({ request, result: result("failed", null, "xcb-input-limit", identity(account, model, slot.account.runtimeDigest)), counted: attempt, replayed: false });
      }
      if (this.#calls >= this.#options.maxCalls) { this.#release(slot); this.#halt(`per-run call cap reached (maximum ${this.#options.maxCalls})`); }
      this.#calls += 1;
      const started = now();
      let outcome: Outcome;
      try { outcome = await runXcbGenerate(this.#options, input, account, model, timeoutMs); }
      catch (error) { outcome = { kind: "uncertain", reason: `xcb spawn failed: ${String(error).slice(0, 120)}` }; }
      const latencyMs = Math.max(0, now() - started);
      if (outcome.kind === "uncertain") {
        slot.held = true; // Never reuse an account whose provider process may still be running.
        this.#log({ ...where, xcbRequestId: null, outputBytes: null, latencyMs, status: "uncertain", code: outcome.reason });
        this.#release(slot);
        this.#halt(`${outcome.reason} on account ${account}`);
      }
      if (outcome.kind === "completed") {
        this.#log({ ...where, xcbRequestId: outcome.xcbRequestId, outputBytes: Buffer.byteLength(outcome.text), latencyMs, status: "completed", code: null, text: outcome.text });
        this.#release(slot);
        const id = identity(account, model, slot.account.runtimeDigest);
        return frozen({ request, result: outcome.text.trim().length > 0 ? result("completed", outcome.text, null, id)
          : result("failed", outcome.text, "empty-or-unsuccessful-completion", id), counted: attempt, replayed: false });
      }
      this.#log({ ...where, xcbRequestId: outcome.xcbRequestId, outputBytes: null, latencyMs, status: "failed", code: outcome.code });
      if (HALTING.has(outcome.code)) {
        if (outcome.code === "custody_unproven") slot.held = true;
        this.#release(slot);
        this.#halt(`${outcome.code} on account ${account}`);
      }
      this.#release(slot);
      if (outcome.code === "output_limit") return frozen({ request, result: truncated(identity(account, model, slot.account.runtimeDigest)), counted: attempt, replayed: false });
      if (!RETRYABLE.has(outcome.code)) throw new XcbSubscriptionFailure(`xcb ${outcome.code} for ${profileId} request ${request.requestSha256.slice(0, 12)}.`);
      lastCode = outcome.code;
    }
    throw new XcbSubscriptionFailure(`xcb ${lastCode} persisted through ${maxAttempts} attempts for ${profileId} request ${request.requestSha256.slice(0, 12)}.`);
  }

  summary(): Readonly<{ calls: number; maxCalls: number; concurrency: number; halted: string | null; replayable: number }> {
    return { calls: this.#calls, maxCalls: this.#options.maxCalls, concurrency: this.concurrency, halted: this.#halted, replayable: this.#replay.size };
  }
}
