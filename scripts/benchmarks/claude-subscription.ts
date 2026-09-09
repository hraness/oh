/** Claude Code transport for subscription benchmarks. No Anthropic HTTP client or USD ledger. */
import { open, type FileHandle } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";

export const CLAUDE_CODE_VERSION = "2.1.263" as const;
export const CLAUDE_SUBSCRIPTION_PROFILE = "oh.claude-subscription-transport.v1" as const;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const MAX_PROMPT_BYTES = 2 * 1024 * 1024;
const SETTINGS = JSON.stringify({ disableAllHooks: true, forceLoginMethod: "claudeai", fastMode: false });
const encoder = new TextEncoder();
const decoder = () => new TextDecoder("utf-8", { fatal: true });

export type ClaudeRequest = Readonly<{
  model: string;
  effort: "low" | "medium" | "high";
  systemPrompt: string;
  prompt: string;
  maximumOutputTokens: number;
  timeoutMs: number;
}>;
export type ClaudeTokenUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}>;
export type ClaudeCompletion = Readonly<{
  prediction: string;
  reportedModel: string;
  sessionId: string;
  numTurns: number;
  durationMs: number;
  usage: ClaudeTokenUsage;
  modelUsage: Readonly<Record<string, ClaudeTokenUsage>>;
  listPriceEstimateUsd: number | null;
  billedUsd: null;
  physicalModelAttempts: null;
}>;
export type ClaudeSubscriptionAuth = Readonly<{
  authMethod: "claude.ai";
  apiProvider: "firstParty";
  subscriptionType: "max" | "pro" | "team" | "enterprise";
}>;
export type ClaudeInvocation = Readonly<{
  protocol: typeof CLAUDE_SUBSCRIPTION_PROFILE;
  requestSha256: string;
  status: "completed" | "incomplete";
  exitCode: number;
  timedOut: boolean;
  outputBoundExceeded: boolean;
  stdout: Readonly<{ bytes: number; sha256: string }>;
  stderr: Readonly<{ bytes: number; sha256: string }>;
  completion: ClaudeCompletion | null;
}>;

function count(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`Invalid Claude ${field}.`);
  }
  return value;
}
function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`Invalid Claude ${field}.`);
  }
  return value;
}
function text(value: unknown, field: string, maximum = 1024): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > maximum || /\p{Surrogate}/u.test(value)) {
    throw new TypeError(`Invalid Claude ${field}.`);
  }
  return value;
}
function tokenUsage(value: unknown, nativeKeys: boolean): ClaudeTokenUsage {
  if (!isPlainRecord(value)) throw new TypeError("Missing Claude token usage.");
  const names = nativeKeys
    ? ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]
    : ["inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"];
  return Object.freeze({ inputTokens: count(value[names[0]!], "input tokens"),
    outputTokens: count(value[names[1]!], "output tokens"),
    cacheReadInputTokens: count(value[names[2]!], "cache read tokens"),
    cacheCreationInputTokens: count(value[names[3]!], "cache creation tokens") });
}

/** Allowlist the child environment. Stored subscription credentials remain owned by Claude Code. */
export function subscriptionEnvironment(environment: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ["HOME", "USER", "LOGNAME", "PATH", "SHELL", "TMPDIR", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR"]) {
    const descriptor = Object.getOwnPropertyDescriptor(environment, key);
    if (descriptor === undefined) continue;
    if (!("value" in descriptor) || (descriptor.value !== undefined && typeof descriptor.value !== "string")) {
      throw new TypeError("Environment must use string data properties.");
    }
    if (typeof descriptor.value === "string") result[key] = descriptor.value;
  }
  result.TERM = "dumb";
  result.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  return result;
}

export function parseSubscriptionAuth(raw: Uint8Array): ClaudeSubscriptionAuth {
  if (raw.byteLength > 32 * 1024) throw new RangeError("Claude authentication output exceeds its bound.");
  const value: unknown = JSON.parse(decoder().decode(raw));
  if (!isPlainRecord(value) || value.loggedIn !== true || value.authMethod !== "claude.ai"
    || value.apiProvider !== "firstParty" || !["max", "pro", "team", "enterprise"].includes(String(value.subscriptionType))) {
    throw new Error("Claude Code must be logged in with a first-party subscription.");
  }
  const plan = value.subscriptionType;
  if (plan !== "max" && plan !== "pro" && plan !== "team" && plan !== "enterprise") throw new TypeError("Unsupported subscription.");
  // This proves the selected credential. It does not prove that account overage is disabled.
  return Object.freeze({ authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: plan });
}

export function claudeRequestArguments(request: ClaudeRequest): readonly string[] {
  const model = text(request.model, "model", 128);
  if (!/^claude-[a-z0-9.-]+$/.test(model)) throw new TypeError("Pin a full Claude model name.");
  if (!["low", "medium", "high"].includes(request.effort)) throw new TypeError("Invalid Claude effort.");
  text(request.systemPrompt, "system prompt", 64 * 1024);
  text(request.prompt, "prompt", MAX_PROMPT_BYTES);
  const maximum = count(request.maximumOutputTokens, "output bound");
  if (maximum < 1 || maximum > 32768) throw new RangeError("Claude output bound must be within 1..32768.");
  const timeout = count(request.timeoutMs, "timeout");
  if (timeout < 1000 || timeout > 900000) throw new RangeError("Claude timeout must be within 1000..900000 milliseconds.");
  return Object.freeze(["--print", "--model", model, "--effort", request.effort,
    "--tools", "", "--safe-mode", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "", "--settings", SETTINGS, "--disable-slash-commands", "--no-chrome",
    "--no-session-persistence", "--max-turns", "1", "--system-prompt", request.systemPrompt,
    "--output-format", "stream-json", "--verbose"]);
}

export function claudeRequestSha256(request: ClaudeRequest): string {
  claudeRequestArguments(request);
  return canonicalSha256({ profile: CLAUDE_SUBSCRIPTION_PROFILE, ...request, settings: SETTINGS, maxTurns: 1, ordinaryRetryLimit: 0 });
}

/** Read terminal usage once. Assistant usage repeats and may include auxiliary models. */
export function parseClaudeCompletion(raw: Uint8Array, expectedModel: string): ClaudeCompletion {
  if (raw.byteLength === 0 || raw.byteLength > MAX_STREAM_BYTES || raw[raw.length - 1] !== 10) {
    throw new TypeError("Claude stream must contain complete bounded LF records.");
  }
  const lines = decoder().decode(raw).split("\n");
  if (lines.length > 20000) throw new RangeError("Claude stream contains too many events.");
  let terminal: Record<string, unknown> | null = null;
  let sawExpectedAssistant = false;
  let sawInit = false;
  let sessionId: string | null = null;
  for (const line of lines.slice(0, -1)) {
    if (!line || Buffer.byteLength(line) > 4 * 1024 * 1024) throw new TypeError("Invalid Claude event frame.");
    const event: unknown = JSON.parse(line);
    if (!isPlainRecord(event)) throw new TypeError("Invalid Claude event.");
    if (event.type === "rate_limit_event") {
      if (!isPlainRecord(event.rate_limit_info) || event.rate_limit_info.isUsingOverage === true
        || event.rate_limit_info.status === "rejected") throw new Error("Claude reported unavailable subscription capacity.");
    }
    if (terminal !== null) {
      const informational = event.type === "rate_limit_event" || (event.type === "system"
        && typeof event.subtype === "string" && ["informational", "turn_duration", "thinking_tokens", "prompt_suggestion"].includes(event.subtype));
      if (!informational) throw new TypeError("New work or duplicate result follows the terminal Claude result.");
    }
    if (event.type === "system" && event.subtype === "init") {
      if (sawInit || event.model !== expectedModel || event.claude_code_version !== CLAUDE_CODE_VERSION) throw new TypeError("Claude initialization model mismatch.");
      sessionId = text(event.session_id, "initial session id", 128);
      sawInit = true;
      if (event.apiKeySource !== "none") throw new Error("Claude selected an unexpected API credential source.");
      if (!Array.isArray(event.tools) || event.tools.length !== 0 || !Array.isArray(event.mcp_servers)
        || event.mcp_servers.length !== 0) throw new Error("Claude benchmark must have no tools or MCP servers.");
    }
    if (["assistant", "result"].includes(String(event.type)) && (!sawInit || event.session_id !== sessionId)) {
      throw new TypeError("Claude session identity mismatch.");
    }
    if (event.type === "user" || event.type === "tool_result" || event.type === "tool_use") {
      throw new Error("Claude benchmark attempted an additional interaction.");
    }
    if (event.type === "assistant") {
      if ((event.error !== undefined && event.error !== null) || event.parent_tool_use_id !== null) {
        throw new Error("Claude assistant reported an error or nested tool work.");
      }
      if (!isPlainRecord(event.message) || event.message.model !== expectedModel || !Array.isArray(event.message.content)) {
        throw new TypeError("Claude assistant model mismatch.");
      }
      for (const block of event.message.content) {
        if (!isPlainRecord(block) || !["text", "thinking", "redacted_thinking"].includes(String(block.type))) {
          throw new TypeError("Claude benchmark attempted a tool or unsupported response block.");
        }
      }
      sawExpectedAssistant = true;
    }
    if (event.type === "result") terminal = event;
  }
  if (!sawInit || !sawExpectedAssistant || terminal === null || terminal.subtype !== "success"
    || terminal.is_error !== false || (terminal.terminal_reason !== undefined && terminal.terminal_reason !== "completed") || terminal.stop_reason !== "end_turn"
    || terminal.num_turns !== 1) {
    throw new Error("Claude did not return a completed benchmark response.");
  }
  if (!Array.isArray(terminal.permission_denials) || terminal.permission_denials.length !== 0) {
    throw new Error("Claude reported a denied tool operation.");
  }
  const modelUsage: Record<string, ClaudeTokenUsage> = {};
  if (!isPlainRecord(terminal.modelUsage) || Object.keys(terminal.modelUsage).length > 16) {
    throw new TypeError("Missing bounded Claude model usage.");
  }
  for (const [model, usage] of Object.entries(terminal.modelUsage)) modelUsage[text(model, "usage model", 128)] = tokenUsage(usage, false);
  if (!Object.hasOwn(modelUsage, expectedModel)) throw new TypeError("Expected model is absent from Claude usage.");
  return Object.freeze({ prediction: text(terminal.result, "prediction", 2 * 1024 * 1024), reportedModel: expectedModel,
    sessionId: text(terminal.session_id, "session id", 128), numTurns: count(terminal.num_turns, "turns"),
    durationMs: finite(terminal.duration_ms, "duration"), usage: tokenUsage(terminal.usage, true),
    modelUsage: Object.freeze(modelUsage),
    listPriceEstimateUsd: terminal.total_cost_usd === undefined ? null : finite(terminal.total_cost_usd, "list-price estimate"),
    billedUsd: null, physicalModelAttempts: null });
}

type Capture = Readonly<{ bytes: Uint8Array; exceeded: boolean }>;
async function capture(stream: ReadableStream<Uint8Array>, file: FileHandle, maximum: number, stop: () => void): Promise<Capture> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  let exceeded = false;
  try {
    const reader = stream.getReader();
    try {
      for (;;) {
        const entry = await reader.read();
        if (entry.done) break;
        const room = Math.max(0, maximum - length);
        const bytes = entry.value.subarray(0, room);
        if (bytes.length) {
          let offset = 0;
          while (offset < bytes.length) {
            const wrote = await file.write(bytes, offset, bytes.length - offset);
            if (wrote.bytesWritten <= 0) throw new Error("Claude evidence write made no progress.");
            offset += wrote.bytesWritten;
          }
          chunks.push(new Uint8Array(bytes));
          length += bytes.length;
        }
        if (bytes.length !== entry.value.length) { exceeded = true; stop(); }
      }
    } finally { reader.releaseLock(); }
    await file.sync();
  } catch (error) { stop(); throw error; }
  finally { await file.close(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, exceeded };
}

/** Caller must establish account overage is disabled before admission; auth status alone is insufficient. */
export async function runClaudeSubscription(input: Readonly<{
  cliPath: string;
  cwd: string;
  stdoutPath: string;
  stderrPath: string;
  request: ClaudeRequest;
}>, environment: Readonly<Record<string, string | undefined>> = process.env): Promise<ClaudeInvocation> {
  for (const path of [input.cliPath, input.cwd, input.stdoutPath, input.stderrPath]) {
    if (!isAbsolute(path) || resolve(path) !== path || path.includes("\u0000")) throw new TypeError("Claude paths must be normalized absolute paths.");
  }
  if (new Set([input.stdoutPath, input.stderrPath, input.cliPath]).size !== 3) throw new TypeError("Claude evidence paths collide.");
  const paths = Object.freeze({ cliPath: input.cliPath, cwd: input.cwd, stdoutPath: input.stdoutPath, stderrPath: input.stderrPath });
  const request = Object.freeze({ ...input.request });
  const args = claudeRequestArguments(request);
  const env = subscriptionEnvironment(environment);
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(request.maximumOutputTokens);
  env.CLAUDE_CODE_MAX_RETRIES = "0";
  const requestSha256 = claudeRequestSha256(request);
  // Claim both evidence files before a model process can start. Preserve partial owned files on failure.
  const stdoutFile = await open(paths.stdoutPath, "wx", 0o600);
  let stderrFile: FileHandle;
  try { stderrFile = await open(paths.stderrPath, "wx", 0o600); }
  catch (error) { await stdoutFile.close(); throw error; }
  const spawn = () => Bun.spawn([paths.cliPath, ...args], { cwd: paths.cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let child: ReturnType<typeof spawn>;
  try { child = spawn(); }
  catch (error) { await Promise.allSettled([stdoutFile.close(), stderrFile.close()]); throw error; }
  let timedOut = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    if (forceKill !== undefined) return;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 5000);
  };
  const timeout = setTimeout(() => { timedOut = true; stop(); }, request.timeoutMs);
  const out = capture(child.stdout, stdoutFile, MAX_STREAM_BYTES, stop);
  const err = capture(child.stderr, stderrFile, MAX_STDERR_BYTES, stop);
  const sent = Promise.resolve().then(async () => {
    try { child.stdin.write(encoder.encode(request.prompt)); await child.stdin.end(); }
    catch (error) { stop(); throw error; }
  });
  const results = await Promise.allSettled([out, err, sent, child.exited]);
  clearTimeout(timeout);
  if (forceKill !== undefined) clearTimeout(forceKill);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw new Error("Claude invocation or evidence custody failed.", { cause: failed.reason });
  const stdout = results[0], stderr = results[1], ended = results[3];
  if (stdout?.status !== "fulfilled" || stderr?.status !== "fulfilled" || ended?.status !== "fulfilled") throw new Error("Claude process did not close.");
  let completion: ClaudeCompletion | null = null;
  if (!stdout.value.exceeded) {
    try { completion = parseClaudeCompletion(stdout.value.bytes, request.model); } catch { /* Exact private stream remains available for diagnosis. */ }
  }
  const usable = ended.value === 0 && !timedOut && !stdout.value.exceeded && !stderr.value.exceeded && completion !== null;
  return Object.freeze({ protocol: CLAUDE_SUBSCRIPTION_PROFILE, requestSha256, status: usable ? "completed" : "incomplete",
    exitCode: ended.value, timedOut,
    outputBoundExceeded: stdout.value.exceeded || stderr.value.exceeded,
    stdout: { bytes: stdout.value.bytes.length, sha256: sha256Hex(stdout.value.bytes) },
    stderr: { bytes: stderr.value.bytes.length, sha256: sha256Hex(stderr.value.bytes) }, completion });
}
