import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectClaudeSubscriptionCapacity, verifyClaudeSubscription } from "../scripts/benchmarks/claude-qualification";

const VERSION = "2.1.263 (Claude Code)";
const encode = (value: string): Uint8Array => new TextEncoder().encode(value);
const frames = (events: readonly object[]): Uint8Array => encode(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
const rate = () => ({ type: "rate_limit_event", session_id: "private-synthetic-id", rate_limit_info: {
  status: "allowed", isUsingOverage: false, overageStatus: "rejected", overageDisabledReason: "org_level_disabled",
  rateLimitType: "five_hour", resetsAt: 100, unifiedWindows: {
    five_hour: { resetsAt: 100, utilization: 0.25 }, seven_day: { resetsAt: 200, utilization: 0.5 },
  },
} });

describe("Claude subscription capacity evidence", () => {
  test("returns only sanitized latest capacity without interpreting it as money", () => {
    const first = rate();
    const last = rate();
    last.rate_limit_info.unifiedWindows.five_hour.utilization = 0.4;
    const observed = inspectClaudeSubscriptionCapacity(frames([first, { type: "system", subtype: "informational" }, last]));
    expect(observed.unifiedWindows.five_hour?.utilization).toBe(0.4);
    expect(observed.overageStatus).toBe("rejected");
    expect(observed.status).toBe("allowed");
    expect(Object.keys(observed).sort()).toEqual(["isUsingOverage", "overageDisabledReason", "overageStatus", "rateLimitType", "resetsAt", "status", "unifiedWindows"]);
    expect(JSON.stringify(observed)).not.toContain("private-synthetic-id");
    expect(Object.isFrozen(observed)).toBe(true);
    expect(Object.isFrozen(observed.unifiedWindows.five_hour)).toBe(true);
  });

  test("optional reset/window metadata stays unknown when unavailable", () => {
    const value = inspectClaudeSubscriptionCapacity(frames([{ type: "rate_limit_event", rate_limit_info: {
      status: "allowed", isUsingOverage: false, overageStatus: "rejected", overageDisabledReason: "org_level_disabled",
    } }]));
    expect(value.rateLimitType).toBeNull();
    expect(value.resetsAt).toBeNull();
    expect(Object.keys(value.unifiedWindows)).toHaveLength(0);
  });

  for (const [field, value] of [
    ["status", "rejected"], ["status", "unknown"], ["isUsingOverage", true], ["isUsingOverage", null],
    ["overageStatus", "allowed"], ["overageDisabledReason", "unknown"],
    ["rateLimitType", "bad label"], ["resetsAt", -1], ["resetsAt", 1.5], ["unifiedWindows", null],
  ] as const) test(`rejects incompatible ${field}=${String(value)}`, () => {
    const original = rate();
    const event = { ...original, rate_limit_info: { ...original.rate_limit_info, [field]: value } };
    expect(() => inspectClaudeSubscriptionCapacity(frames([event]))).toThrow();
    // Later healthy-looking evidence never erases observed earlier contradictory capacity.
    expect(() => inspectClaudeSubscriptionCapacity(frames([event, original]))).toThrow();
  });

  test("requires every explicit disabled-evidence field", () => {
    const info: Record<string, unknown> = rate().rate_limit_info;
    for (const key of ["status", "isUsingOverage", "overageStatus", "overageDisabledReason"]) {
      const changed = { ...info }; delete changed[key];
      expect(() => inspectClaudeSubscriptionCapacity(frames([{ type: "rate_limit_event", rate_limit_info: changed }]))).toThrow();
    }
  });

  test("rejects absence, torn/invalid encoding, invalid complete lines and stream bounds", () => {
    const valid = frames([rate()]);
    for (const raw of [frames([{ type: "result" }]), valid.subarray(0, valid.length - 1), encode("{bad}\n"),
      encode("{}\n\n"), new Uint8Array([0xff, 10]), new Uint8Array(), new Uint8Array(16 * 1024 * 1024 + 1)]) {
      expect(() => inspectClaudeSubscriptionCapacity(raw)).toThrow();
    }
    expect(() => inspectClaudeSubscriptionCapacity(encode('"' + "x".repeat(4 * 1024 * 1024) + '"\n'))).toThrow();
  });

  test("validates bounded window metadata without double-counting it", () => {
    for (const windows of [{ five_hour: { resetsAt: 2, utilization: -1 } },
      { five_hour: { resetsAt: Number.MAX_SAFE_INTEGER + 1, utilization: 0.4 } },
      { five_hour: { resetsAt: 2, utilization: "0.4" } }, Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`window_${i}`, { resetsAt: 2, utilization: 0.4 }]))]) {
      expect(() => inspectClaudeSubscriptionCapacity(frames([{ type: "rate_limit_event", rate_limit_info: {
        ...rate().rate_limit_info, unifiedWindows: windows,
      } }]))).toThrow();
    }
  });
});

async function withFakeCli(body: string, run: (directory: string, executable: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "oh-claude-qualification-test-"));
  try {
    const executable = join(directory, "fake-claude");
    await writeFile(executable, `#!${process.execPath}\nimport { appendFileSync } from "node:fs";\nconst args = process.argv.slice(2);\nappendFileSync("calls.jsonl", JSON.stringify(args) + "\\n");\n${body}\n`, { flag: "wx", mode: 0o700 });
    await chmod(executable, 0o700);
    await run(directory, executable);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
const auth = { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max",
  email: "private-synthetic@example.invalid", organization: "private-synthetic" };
const ordinary = `if (args.includes("--version")) console.log(${JSON.stringify(VERSION)}); else console.log(${JSON.stringify(JSON.stringify(auth))});`;

describe("read-only Claude CLI qualification", () => {
  test("checks exact version before auth, preserves safe settings and returns no account fields", async () => {
    await withFakeCli(ordinary, async (cwd, cliPath) => {
      const verified = await verifyClaudeSubscription({ cwd, cliPath, expectedVersion: VERSION });
      expect(verified).toEqual({ version: VERSION, auth: { authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" } });
      const calls: unknown[] = (await readFile(join(cwd, "calls.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        expect(call).toEqual(expect.arrayContaining(["--safe-mode", "--strict-mcp-config", "--setting-sources", "--settings"]));
        expect(call).not.toEqual(expect.arrayContaining(["--print"]));
      }
      expect(calls[0]).toEqual(expect.arrayContaining(["--version"]));
      expect(calls[1]).toEqual(expect.arrayContaining(["auth", "status", "--json"]));
      expect(JSON.stringify(verified)).not.toContain("private-synthetic");
    });
  });

  test("stops before auth when the exact installed version differs", async () => {
    await withFakeCli('console.log("2.1.264 (Claude Code)");', async (cwd, cliPath) => {
      await expect(verifyClaudeSubscription({ cwd, cliPath, expectedVersion: VERSION })).rejects.toThrow("pinned version");
      expect((await readFile(join(cwd, "calls.jsonl"), "utf8")).trim().split("\n")).toHaveLength(1);
    });
  });

  const failures = [
    ["nonzero version exit", `console.log(${JSON.stringify(VERSION)}); process.exit(7);`],
    ["nonzero auth exit", `if (args.includes("--version")) console.log(${JSON.stringify(VERSION)}); else { console.log(${JSON.stringify(JSON.stringify(auth))}); process.exit(7); }`],
    ["oversized version", 'console.log("x".repeat(1025));'],
    ["oversized auth", `if (args.includes("--version")) console.log(${JSON.stringify(VERSION)}); else console.log("x".repeat(32769));`],
    ["oversized stderr", `console.error("x".repeat(32769)); console.log(${JSON.stringify(VERSION)});`],
    ["invalid auth JSON", `if (args.includes("--version")) console.log(${JSON.stringify(VERSION)}); else console.log("private-synthetic-malformed-auth");`],
    ["wrong credential method", `if (args.includes("--version")) console.log(${JSON.stringify(VERSION)}); else console.log(${JSON.stringify(JSON.stringify({ ...auth, authMethod: "api_key" }))});`],
  ] as const;
  for (const [name, body] of failures) test(`rejects ${name} without exposing auth or stderr content`, async () => {
    await withFakeCli(body, async (cwd, cliPath) => {
      let caught: unknown;
      try { await verifyClaudeSubscription({ cwd, cliPath, expectedVersion: VERSION }); }
      catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(Error);
      expect(String(caught)).not.toContain("private-synthetic");
    });
  });

  test("snapshots validated paths/version before the first asynchronous command", async () => {
    await withFakeCli(ordinary, async (cwd, cliPath) => {
      const input = { cwd, cliPath, expectedVersion: VERSION };
      const pending = verifyClaudeSubscription(input);
      input.cliPath = join(cwd, "missing"); input.cwd = join(cwd, "missing"); input.expectedVersion = "0.0.0 (Claude Code)";
      expect((await pending).version).toBe(VERSION);
    });
  });

  test("rejects malformed control input before process acquisition", async () => {
    await expect(verifyClaudeSubscription({ cwd: "/", cliPath: "relative", expectedVersion: VERSION })).rejects.toThrow();
    await expect(verifyClaudeSubscription({ cwd: "/", cliPath: "/missing", expectedVersion: "latest" })).rejects.toThrow();
  });
});
