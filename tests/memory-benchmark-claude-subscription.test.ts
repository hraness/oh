import { describe, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical";
import {
  claudeRequestArguments, parseClaudeCompletion, parseSubscriptionAuth,
  runClaudeSubscription, subscriptionEnvironment, type ClaudeRequest,
} from "../scripts/benchmarks/claude-subscription";

const MODEL = "claude-opus-5";
const SESSION = "00000000-0000-4000-8000-000000000001";
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const frames = (events: readonly object[]): Uint8Array => encode(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
function fixture() {
  return {
    init: { type: "system", subtype: "init", session_id: SESSION, model: MODEL,
      apiKeySource: "none", tools: [] as string[], mcp_servers: [] as object[],
      permissionMode: "default", claude_code_version: "2.1.263" },
    assistant: { type: "assistant", session_id: SESSION, parent_tool_use_id: null,
      request_id: "synthetic-request-1", message: { id: "synthetic-message-1", model: MODEL,
        stop_reason: null, content: [{ type: "text", text: "Synthetic π response" }],
        usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 } } },
    result: { type: "result", subtype: "success", is_error: false, terminal_reason: "completed",
      stop_reason: "end_turn", session_id: SESSION, result: "Synthetic π response", num_turns: 1,
      duration_ms: 25, permission_denials: [] as object[], total_cost_usd: 0.002,
      usage: { input_tokens: 2, output_tokens: 20, cache_read_input_tokens: 100, cache_creation_input_tokens: 50,
        output_tokens_details: { thinking_tokens: 5 }, cache_creation: { ephemeral_1h_input_tokens: 50, ephemeral_5m_input_tokens: 0 } },
      modelUsage: { [MODEL]: { inputTokens: 2, outputTokens: 20, cacheReadInputTokens: 100, cacheCreationInputTokens: 50,
        thinkingTokens: 5, costUSD: 0.0018, costBasis: "list" },
      "claude-haiku-4-5-20251001": { inputTokens: 3, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        thinkingTokens: 0, costUSD: 0.0002, costBasis: "list" } },
    },
  };
}
type Fixture = ReturnType<typeof fixture>;
function ordinary(value = fixture()): Uint8Array { return frames([value.init, value.assistant, value.result]); }
const request = (): ClaudeRequest => ({ model: MODEL, effort: "low", systemPrompt: "Synthetic isolated test.",
  prompt: "Synthetic input π", maximumOutputTokens: 64, timeoutMs: 1000 });

describe("Claude subscription JSONL protocol", () => {
  test("uses terminal main-loop usage once and keeps auxiliary models separate", () => {
    const f = fixture();
    const partial = { ...f.assistant, message: { ...f.assistant.message, content: [{ type: "thinking" }] } };
    const completion = parseClaudeCompletion(frames([f.init, partial, f.assistant, f.result]), MODEL);
    expect(completion.prediction).toBe(f.result.result);
    expect(completion.usage).toEqual({ inputTokens: 2, outputTokens: 20, cacheReadInputTokens: 100, cacheCreationInputTokens: 50 });
    expect(completion.modelUsage["claude-haiku-4-5-20251001"]?.outputTokens).toBe(2);
    expect(completion.listPriceEstimateUsd).toBe(0.002);
    expect(completion.physicalModelAttempts).toBeNull();
    expect(completion.billedUsd).toBeNull();
  });

  test("allows trailing passive telemetry and retains rate/retry distinctions", () => {
    const f = fixture();
    const rate = { type: "rate_limit_event", session_id: SESSION, rate_limit_info: {
      status: "allowed", overageStatus: "rejected", isUsingOverage: false } };
    const retry = { type: "system", subtype: "api_retry", session_id: SESSION,
      attempt: 1, max_retries: 10, retry_delay_ms: 1, error_status: null, error: "unknown" };
    const raw = frames([f.init, retry, retry, f.assistant, f.result, rate]);
    const completion = parseClaudeCompletion(raw, MODEL);
    expect(completion.numTurns).toBe(1);
    expect(completion.physicalModelAttempts).toBeNull();
  });

  const contradictions: ReadonlyArray<readonly [string, (f: Fixture) => object[]]> = [
    ["success subtype with is_error true", (f) => [f.init, f.assistant, { ...f.result, is_error: true }]],
    ["API error terminal reason", (f) => [f.init, f.assistant, { ...f.result, terminal_reason: "api_error" }]],
    ["error subtype", (f) => [f.init, f.assistant, { ...f.result, subtype: "error_max_turns" }]],
    ["null stop reason", (f) => [f.init, f.assistant, { ...f.result, stop_reason: null }]],
    ["capped output", (f) => [f.init, f.assistant, { ...f.result, stop_reason: "max_tokens" }]],
    ["refusal", (f) => [f.init, f.assistant, { ...f.result, stop_reason: "refusal" }]],
    ["tool stop", (f) => [f.init, f.assistant, { ...f.result, stop_reason: "tool_use" }]],
    ["multiple turns", (f) => [f.init, f.assistant, { ...f.result, num_turns: 2 }]],
    ["zero turns", (f) => [f.init, f.assistant, { ...f.result, num_turns: 0 }]],
    ["duplicate result", (f) => [f.init, f.assistant, f.result, f.result]],
    ["work after terminal", (f) => [f.init, f.assistant, f.result, f.assistant]],
    ["no result", (f) => [f.init, f.assistant]],
    ["no init", (f) => [f.assistant, f.result]],
    ["duplicate init", (f) => [f.init, f.init, f.assistant, f.result]],
    ["assistant before init", (f) => [f.assistant, f.init, f.result]],
    ["wrong init model", (f) => [{ ...f.init, model: "claude-sonnet-5" }, f.assistant, f.result]],
    ["wrong initialized CLI version", (f) => [{ ...f.init, claude_code_version: "2.1.264" }, f.assistant, f.result]],
    ["API key source", (f) => [{ ...f.init, apiKeySource: "environment" }, f.assistant, f.result]],
    ["wrong assistant model", (f) => [f.init, { ...f.assistant, message: { ...f.assistant.message, model: "claude-sonnet-5" } }, f.result]],
    ["assistant error", (f) => [f.init, { ...f.assistant, error: "rate_limit" }, f.result]],
    ["assistant from another session", (f) => [f.init, { ...f.assistant, session_id: "different" }, f.result]],
    ["result from another session", (f) => [f.init, f.assistant, { ...f.result, session_id: "different" }]],
    ["child assistant", (f) => [f.init, { ...f.assistant, parent_tool_use_id: "child-tool" }, f.result]],
    ["enabled built-in tools", (f) => [{ ...f.init, tools: ["Read"] }, f.assistant, f.result]],
    ["enabled MCP", (f) => [{ ...f.init, mcp_servers: [{ name: "synthetic-server", status: "connected" }] }, f.assistant, f.result]],
    ["tool content", (f) => [f.init, { ...f.assistant, message: { ...f.assistant.message, content: [{ type: "tool_use" }] } }, f.result]],
    ["tool result user event", (f) => [f.init, f.assistant, { type: "user", session_id: SESSION, tool_use_result: {} }, f.result]],
    ["denied tool", (f) => [f.init, f.assistant, { ...f.result, permission_denials: [{ tool_name: "Read" }] }]],
    ["malformed denials", (f) => [f.init, f.assistant, { ...f.result, permission_denials: "none" }]],
    ["active overage", (f) => [f.init, { type: "rate_limit_event", session_id: SESSION,
      rate_limit_info: { status: "allowed", isUsingOverage: true } }, f.assistant, f.result]],
  ];
  for (const [name, make] of contradictions) test(`rejects ${name}`, () => {
    expect(() => parseClaudeCompletion(frames(make(fixture())), MODEL)).toThrow();
  });

  test("rejects malformed, torn, invalid UTF-8 and oversized frames", () => {
    const raw = ordinary();
    for (const invalid of [raw.subarray(0, raw.length - 1), encode("{}\n\n"), encode("{bad}\n"),
      new Uint8Array([0xff, 10]), new Uint8Array(), encode('"' + "x".repeat(4 * 1024 * 1024) + '"\n')]) {
      expect(() => parseClaudeCompletion(invalid, MODEL)).toThrow();
    }
  });

  test("requires finite safe token counts and preserves missing cost as unknown", () => {
    const f = fixture();
    for (const invalid of [-1, 1.1, Number.MAX_SAFE_INTEGER + 1, "2", null]) {
      const terminal = { ...f.result, usage: { ...f.result.usage, input_tokens: invalid } };
      expect(() => parseClaudeCompletion(frames([f.init, f.assistant, terminal]), MODEL)).toThrow();
    }
    const { total_cost_usd: ignored, ...withoutCost } = f.result;
    expect(ignored).toBe(0.002);
    expect(parseClaudeCompletion(frames([f.init, f.assistant, withoutCost]), MODEL).listPriceEstimateUsd).toBeNull();
    const { [MODEL]: main, ...onlyAuxiliary } = f.result.modelUsage;
    expect(main).toBeDefined();
    expect(() => parseClaudeCompletion(frames([f.init, f.assistant, { ...f.result, modelUsage: onlyAuxiliary }]), MODEL)).toThrow();
  });
});

describe("Claude subscription launch profile", () => {
  test("allows subscription status without exposing user account details", () => {
    const auth = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max", email: "synthetic@example.invalid" };
    expect(parseSubscriptionAuth(encode(JSON.stringify(auth)))).toEqual({ authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" });
    for (const mutation of [{ loggedIn: false }, { authMethod: "api_key" }, { apiProvider: "bedrock" }, { subscriptionType: "free" }]) {
      expect(() => parseSubscriptionAuth(encode(JSON.stringify({ ...auth, ...mutation })))).toThrow();
    }
  });

  test("uses tool-less no-schema arguments and excludes API-provider credentials/settings", () => {
    const args = claudeRequestArguments(request());
    const argument = (flag: string): string | undefined => args[args.indexOf(flag) + 1];
    expect(argument("--tools")).toBe("");
    expect(argument("--max-turns")).toBe("1");
    expect(argument("--model")).toBe(MODEL);
    expect(argument("--mcp-config")).toBe('{"mcpServers":{}}');
    for (const flag of ["--safe-mode", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"]) expect(args).toContain(flag);
    for (const flag of ["--json-schema", "--bare", "--fallback-model", "--resume", "--continue", "--dangerously-skip-permissions"]) expect(args).not.toContain(flag);
    const env = subscriptionEnvironment({ HOME: "/synthetic", PATH: "/synthetic/bin", ANTHROPIC_API_KEY: "synthetic-secret",
      ANTHROPIC_AUTH_TOKEN: "synthetic-secret", ANTHROPIC_BASE_URL: "https://example.invalid", CLAUDE_CODE_OAUTH_TOKEN: "synthetic-secret",
      CLAUDE_CONFIG_DIR: "/synthetic/other", NODE_OPTIONS: "--inspect", CLAUDE_CODE_USE_BEDROCK: "1", CLAUDECODE: "1" });
    expect(Object.keys(env).sort()).toEqual(["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "HOME", "PATH", "TERM"]);
    let reads = 0;
    const invalid = Object.defineProperty({}, "HOME", { get() { reads++; return "/synthetic"; } });
    expect(() => subscriptionEnvironment(invalid)).toThrow();
    expect(reads).toBe(0);
  });

  test("rejects malformed or unbounded requests before launch", () => {
    for (const mutation of [{ model: "opus" }, { model: "--help" }, { maximumOutputTokens: 0 },
      { maximumOutputTokens: 32769 }, { timeoutMs: 999 }, { timeoutMs: 900001 }, { prompt: "" }, { systemPrompt: "\ud800" }]) {
      expect(() => claudeRequestArguments({ ...request(), ...mutation })).toThrow();
    }
  });
});

async function withFakeCli(body: string, run: (directory: string, executable: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "oh-claude-subscription-test-"));
  try {
    const executable = join(directory, "fake-claude");
    await writeFile(executable, `#!${process.execPath}\n${body}\n`, { mode: 0o700, flag: "wx" });
    await chmod(executable, 0o700);
    await run(directory, executable);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const fakeOutput = (): string => `const output = Buffer.from(${JSON.stringify(Buffer.from(ordinary()).toString("base64"))}, "base64");`;
async function absent(path: string): Promise<boolean> {
  try { await lstat(path); return false; } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return true;
    throw error;
  }
}

describe("Claude subscription process custody with a local fake executable", () => {
  test("captures split UTF-8 bytes privately and sends only the fixed stdin/argv/environment", async () => {
    await withFakeCli(`${fakeOutput()}
      const prompt = await new Response(Bun.stdin.stream()).text();
      await Bun.write(Bun.stderr, JSON.stringify({ prompt, args: process.argv.slice(2), envKeys: Object.keys(process.env), retryLimit: process.env.CLAUDE_CODE_MAX_RETRIES }));
      for (let i = 0; i < output.length; i++) await Bun.write(Bun.stdout, output.subarray(i, i + 1));`, async (cwd, cliPath) => {
      const stdoutPath = join(cwd, "stdout.jsonl"), stderrPath = join(cwd, "stderr.txt");
      const result = await runClaudeSubscription({ cliPath, cwd, stdoutPath, stderrPath, request: request() }, { HOME: cwd, ANTHROPIC_API_KEY: "synthetic-secret" });
      expect(result.exitCode).toBe(0);
      expect(result.completion?.prediction).toBe("Synthetic π response");
      const output = await readFile(stdoutPath);
      expect(output).toEqual(Buffer.from(ordinary()));
      expect(result.stdout.sha256).toBe(sha256Hex(output));
      expect(result.stdout.bytes).toBe(output.length);
      const captured: unknown = JSON.parse(await readFile(stderrPath, "utf8"));
      expect(captured).toEqual({ prompt: request().prompt, args: [...claudeRequestArguments(request())],
        envKeys: expect.arrayContaining(["HOME", "TERM", "CLAUDE_CODE_MAX_OUTPUT_TOKENS"]), retryLimit: "0" });
      expect(JSON.stringify(captured)).not.toContain("ANTHROPIC_API_KEY");
      expect((await stat(stdoutPath)).mode & 0o777).toBe(0o600);
      expect((await stat(stderrPath)).mode & 0o777).toBe(0o600);
    });
  });

  test("a second evidence path collision prevents any process launch", async () => {
    await withFakeCli('await Bun.write("launched", "yes");', async (cwd, cliPath) => {
      const stdoutPath = join(cwd, "stdout.jsonl"), stderrPath = join(cwd, "stderr.txt");
      await writeFile(stderrPath, "existing evidence", { flag: "wx" });
      await expect(runClaudeSubscription({ cliPath, cwd, stdoutPath, stderrPath, request: request() }, { HOME: cwd })).rejects.toThrow();
      expect(await absent(join(cwd, "launched"))).toBe(true);
      expect(await readFile(stderrPath, "utf8")).toBe("existing evidence");
    });
  });

  test("nonzero exit and torn output retain exact evidence without a usable completion", async () => {
    await withFakeCli(`${fakeOutput()} await Bun.write(Bun.stdout, output.subarray(0, output.length - 1)); process.exit(7);`, async (cwd, cliPath) => {
      const stdoutPath = join(cwd, "stdout.jsonl"), stderrPath = join(cwd, "stderr.txt");
      const result = await runClaudeSubscription({ cliPath, cwd, stdoutPath, stderrPath, request: request() }, { HOME: cwd });
      expect(result.exitCode).toBe(7);
      expect(result.completion).toBeNull();
      expect(await readFile(stdoutPath)).toEqual(Buffer.from(ordinary().subarray(0, ordinary().length - 1)));
    });
  });

  test("retains an observed valid result when the process exits nonzero afterward", async () => {
    await withFakeCli(`${fakeOutput()} await Bun.write(Bun.stdout, output); process.exit(7);`, async (cwd, cliPath) => {
      const stdoutPath = join(cwd, "stdout.jsonl"), stderrPath = join(cwd, "stderr.txt");
      const result = await runClaudeSubscription({ cliPath, cwd, stdoutPath, stderrPath, request: request() }, { HOME: cwd });
      expect(result.status).toBe("incomplete");
      expect(result.exitCode).toBe(7);
      expect(result.completion?.prediction).toBe("Synthetic π response");
      expect(result.stdout.sha256).toBe(sha256Hex(ordinary()));
    });
  });

  test("captures request and paths before opening evidence asynchronously", async () => {
    await withFakeCli(`${fakeOutput()}
      const prompt = await new Response(Bun.stdin.stream()).text();
      await Bun.write(Bun.stderr, prompt); await Bun.write(Bun.stdout, output);`, async (cwd, cliPath) => {
      const originalPrompt = request().prompt;
      const mutableRequest = { ...request() };
      const originalOutput = join(cwd, "stdout.jsonl"), originalError = join(cwd, "stderr.txt");
      const input = { cliPath, cwd, stdoutPath: originalOutput, stderrPath: originalError, request: mutableRequest };
      const pending = runClaudeSubscription(input, { HOME: cwd });
      mutableRequest.prompt = "mutated after launch";
      input.stdoutPath = join(cwd, "wrong-output");
      input.stderrPath = join(cwd, "wrong-error");
      const result = await pending;
      expect(result.status).toBe("completed");
      expect(await readFile(originalError, "utf8")).toBe(originalPrompt);
      expect((await readFile(originalOutput)).length).toBe(ordinary().length);
      expect(await absent(input.stdoutPath)).toBe(true);
      expect(await absent(input.stderrPath)).toBe(true);
    });
  });

  test("escalates an ignored SIGTERM and waits for the owned process to exit", async () => {
    await withFakeCli('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);', async (cwd, cliPath) => {
      const stdoutPath = join(cwd, "stdout.jsonl"), stderrPath = join(cwd, "stderr.txt");
      const result = await runClaudeSubscription({ cliPath, cwd, stdoutPath, stderrPath, request: request() }, { HOME: cwd });
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).not.toBe(0);
      expect(result.status).toBe("incomplete");
      expect(result.completion).toBeNull();
      expect(result.stdout.bytes).toBe(0);
      expect(result.stderr.bytes).toBe(0);
    });
  }, 15000);

  test("enforces the stderr bound and reaps the fake process", async () => {
    await withFakeCli('await Bun.write(Bun.stderr, new Uint8Array(1024 * 1024 + 1));', async (cwd, cliPath) => {
      const stdoutPath = join(cwd, "stdout.jsonl"), stderrPath = join(cwd, "stderr.txt");
      const result = await runClaudeSubscription({ cliPath, cwd, stdoutPath, stderrPath, request: request() }, { HOME: cwd });
      expect(result.outputBoundExceeded).toBe(true);
      expect(result.stderr.bytes).toBe(1024 * 1024);
      expect((await stat(stderrPath)).size).toBe(1024 * 1024);
      expect(result.completion).toBeNull();
    });
  });
});
