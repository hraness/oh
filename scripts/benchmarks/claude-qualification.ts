/** Read-only CLI qualification; these commands never contain a model prompt. */
import { isAbsolute, resolve } from "node:path";
import { isPlainRecord } from "../../src/canonical";
import { parseSubscriptionAuth, subscriptionEnvironment, type ClaudeSubscriptionAuth } from "./claude-subscription";

const MAX_AUTH_BYTES = 32 * 1024;
const MAX_VERSION_BYTES = 1024;
const MAX_STDERR_BYTES = 32 * 1024;
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const SETTINGS = JSON.stringify({ disableAllHooks: true, forceLoginMethod: "claudeai", fastMode: false });
const decode = (raw: Uint8Array): string => new TextDecoder("utf-8", { fatal: true }).decode(raw);

export type ClaudeSubscriptionQualification = Readonly<{ version: string; auth: ClaudeSubscriptionAuth }>;
export type ClaudeSubscriptionCapacity = Readonly<{
  status: "allowed";
  isUsingOverage: false;
  overageStatus: "rejected";
  overageDisabledReason: "org_level_disabled";
  rateLimitType: string | null;
  resetsAt: number | null;
  unifiedWindows: Readonly<Record<string, Readonly<{ resetsAt: number; utilization: number }>>>;
}>;

function normalizedPath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || resolve(value) !== value
    || value.includes("\u0000") || /\p{Surrogate}/u.test(value)) throw new TypeError("Invalid Claude qualification path.");
  return value;
}

async function readCommand(cliPath: string, cwd: string, tail: readonly string[], maximum: number,
  environment: Readonly<Record<string, string>>): Promise<Uint8Array> {
  const args = ["--safe-mode", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "", "--settings", SETTINGS, ...tail];
  const child = Bun.spawn([cliPath, ...args], { cwd, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  let exceeded = false;
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    if (forceKill !== undefined) return;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 5000);
  };
  const timer = setTimeout(() => { timedOut = true; stop(); }, TIMEOUT_MS);
  const collect = async (stream: ReadableStream<Uint8Array>, bound: number): Promise<Uint8Array> => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const entry = await reader.read();
        if (entry.done) break;
        const remaining = bound - length;
        const retained = entry.value.subarray(0, remaining);
        if (retained.length !== 0) { chunks.push(new Uint8Array(retained)); length += retained.length; }
        if (retained.length !== entry.value.length) { exceeded = true; stop(); }
      }
    } catch (error) { stop(); throw error; }
    finally { reader.releaseLock(); }
    const raw = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    return raw;
  };
  const results = await Promise.allSettled([collect(child.stdout, maximum), collect(child.stderr, MAX_STDERR_BYTES), child.exited]);
  clearTimeout(timer);
  if (forceKill !== undefined) clearTimeout(forceKill);
  const output = results[0], errors = results[1], exit = results[2];
  if (timedOut || exceeded || output?.status !== "fulfilled" || errors?.status !== "fulfilled"
    || exit?.status !== "fulfilled" || exit.value !== 0) {
    // Do not attach stderr or auth output: either may contain account information.
    throw new Error("Claude read-only qualification failed or exceeded its bounds.");
  }
  return output.value;
}

/** Snapshot the invocation before awaiting either read-only CLI command. */
export async function verifyClaudeSubscription(input: Readonly<{
  cliPath: string; cwd: string; expectedVersion: string;
}>): Promise<ClaudeSubscriptionQualification> {
  const cliPath = normalizedPath(input.cliPath), cwd = normalizedPath(input.cwd);
  const expectedVersion = input.expectedVersion;
  if (typeof expectedVersion !== "string" || !/^\d+\.\d+\.\d+ \(Claude Code\)$/.test(expectedVersion)
    || expectedVersion.length > MAX_VERSION_BYTES) throw new TypeError("Pin an exact Claude Code version.");
  const environment = Object.freeze(subscriptionEnvironment(process.env));
  const version = decode(await readCommand(cliPath, cwd, ["--version"], MAX_VERSION_BYTES, environment)).trim();
  if (version !== expectedVersion) throw new Error("Claude Code version differs from the pinned version.");
  const authRaw = await readCommand(cliPath, cwd, ["auth", "status", "--json"], MAX_AUTH_BYTES, environment);
  let auth: ClaudeSubscriptionAuth;
  try { auth = parseSubscriptionAuth(authRaw); }
  catch { throw new Error("Claude authentication status is invalid or is not a supported subscription."); }
  return Object.freeze({ version, auth });
}

function nonnegative(value: unknown, integer: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)
    || (integer && !Number.isSafeInteger(value))) throw new TypeError("Invalid Claude capacity metadata.");
  return value;
}
function label(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9_]{1,64}$/.test(value)) throw new TypeError("Invalid Claude capacity label.");
  return value;
}

/** Quota metadata is evidence of capacity, never a cash charge or remaining-call estimate. */
export function inspectClaudeSubscriptionCapacity(raw: Uint8Array): ClaudeSubscriptionCapacity {
  if (raw.byteLength === 0 || raw.byteLength > MAX_STREAM_BYTES || raw[raw.byteLength - 1] !== 10) {
    throw new TypeError("Claude capacity requires a complete bounded JSONL stream.");
  }
  const lines = decode(raw).split("\n");
  if (lines.length > 20000) throw new RangeError("Claude capacity stream has too many events.");
  let latest: ClaudeSubscriptionCapacity | null = null;
  for (const line of lines.slice(0, -1)) {
    if (line.length === 0 || Buffer.byteLength(line) > 4 * 1024 * 1024) throw new TypeError("Invalid Claude capacity frame.");
    const event: unknown = JSON.parse(line);
    if (!isPlainRecord(event)) throw new TypeError("Invalid Claude capacity event.");
    if (event.type !== "rate_limit_event") continue;
    const info = event.rate_limit_info;
    if (!isPlainRecord(info) || info.status !== "allowed" || info.isUsingOverage !== false
      || info.overageStatus !== "rejected" || info.overageDisabledReason !== "org_level_disabled") {
      throw new Error("Claude subscription capacity lacks explicit overage-disabled evidence.");
    }
    const rateLimitType = info.rateLimitType === undefined || info.rateLimitType === null ? null : label(info.rateLimitType);
    const resetsAt = info.resetsAt === undefined || info.resetsAt === null ? null : nonnegative(info.resetsAt, true);
    const windows: Record<string, Readonly<{ resetsAt: number; utilization: number }>> = Object.create(null);
    if (info.unifiedWindows !== undefined) {
      if (!isPlainRecord(info.unifiedWindows) || Object.keys(info.unifiedWindows).length > 16) throw new TypeError("Invalid Claude capacity windows.");
      for (const [key, value] of Object.entries(info.unifiedWindows)) {
        if (!isPlainRecord(value)) throw new TypeError("Invalid Claude capacity window.");
        windows[label(key)] = Object.freeze({ resetsAt: nonnegative(value.resetsAt, true), utilization: nonnegative(value.utilization, false) });
      }
    }
    latest = Object.freeze({ status: "allowed", isUsingOverage: false, overageStatus: "rejected",
      overageDisabledReason: "org_level_disabled", rateLimitType, resetsAt, unifiedWindows: Object.freeze(windows) });
  }
  if (latest === null) throw new Error("Claude emitted no explicit subscription capacity evidence.");
  return latest;
}
