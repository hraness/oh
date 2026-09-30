import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { EVOLUTION_BEAM_JUDGE_PROFILE_IDS, EVOLUTION_PROFILES, EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID, makeEvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { evolutionAnswerMessages } from "../scripts/benchmarks/evolution-reader-contracts";
import {
  XCB_CLAUDE_HAIKU_BEAM_JUDGE_PROFILE_ID as JUDGE, XCB_CLAUDE_HAIKU_TASK_COMPLETE_V10_READER_PROFILE_ID as READER,
  XCB_SUBSCRIPTION_PROFILES, XcbSubscriptionFailure, XcbSubscriptionHalt, XcbSubscriptionTransport,
  isXcbSubscriptionProfileId, makeXcbSubscriptionRequest, parseXcbCapabilities, renderXcbPrompt, xcbBin,
} from "../scripts/benchmarks/xcb-subscription";

// A stub xcb: capabilities come from a file; generate validates the exact six-field input, records every call,
// detects two in-flight calls on one account, and fails according to markers in the prompt.
const STUB = String.raw`
const { appendFileSync, existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const dir = process.env.STUB_DIR, args = process.argv.slice(2);
if (args.join(" ") === "--json generate --capabilities") { process.stdout.write(readFileSync(dir + "/capabilities.json", "utf8")); process.exit(0); }
if (args.join(" ") !== "--json generate") process.exit(64);
const raw = readFileSync(0, "utf8"), input = JSON.parse(raw);
const keys = Object.keys(input).sort().join(",");
const fail = (code) => { process.stdout.write(JSON.stringify({ version: 1, status: "failed", code, requestId: "application_stub" })); process.exit(1); };
if (keys !== "account,maxOutputBytes,model,prompt,timeoutMs,version" || input.version !== 1) fail("invalid_request");
appendFileSync(dir + "/calls.jsonl", JSON.stringify({ account: input.account, model: input.model, timeoutMs: input.timeoutMs, maxOutputBytes: input.maxOutputBytes, promptSha256: createHash("sha256").update(input.prompt).digest("hex") }) + "\n");
const lock = dir + "/inflight-" + input.account;
try { mkdirSync(lock); } catch { appendFileSync(dir + "/violations", input.account + "\n"); }
const delay = Number(process.env.STUB_DELAY_MS ?? "0");
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
try { rmdirSync(lock); } catch {}
const counter = (name) => { const path = dir + "/count-" + name + "-" + createHash("sha256").update(input.prompt).digest("hex"); const n = existsSync(path) ? Number(readFileSync(path, "utf8")) : 0; writeFileSync(path, String(n + 1)); return n; };
const marker = input.prompt.match(/\[\[(\w+)(?::(\d+))?\]\]/);
if (marker) {
  const [, kind, times] = marker;
  if (kind === "garbage") { process.stdout.write("not json"); process.exit(1); }
  if (kind === "always") fail(times === "1" ? "busy" : "provider_error");
  if (times === undefined || counter(kind) < Number(times)) fail(kind);
}
process.stdout.write(JSON.stringify({ version: 1, status: "completed", requestId: "application_stub", account: input.account, model: input.model,
  text: " ECHO " + input.prompt.length + " ", outcome: { terminal: "completed", joined: true, effects: "none" } }));
`;

const account = (id: string, models: string[], extra: object = {}) => ({ id, name: `claude/${id}`, provider: "claude", enabled: true, busy: false, connected: true,
  runtimeAdmitted: true, available: true, reason: null, models: models.map(key => ({ key, label: key, observedAtMs: 1 })),
  qualification: { runtimeVersion: "0.11.1", runtimeDigest: "d".repeat(64), evidenceDigest: "e".repeat(64), expiresAt: null }, ...extra });
const capabilities = (accounts: object[]) => ({ version: 1, supported: true, zeroTools: true, zeroHooks: true, ephemeral: true,
  limits: { maxInputBytes: 1_048_576, maxOutputBytes: 262_144, minTimeoutMs: 1_000, maxTimeoutMs: 300_000 }, accounts });

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });
async function stub(accounts: object[], delayMs = 0) {
  const dir = await mkdtemp(join(tmpdir(), "oh-xcb-stub-"));
  roots.push(dir);
  await writeFile(join(dir, "stub.cjs"), STUB);
  await writeFile(join(dir, "capabilities.json"), JSON.stringify(capabilities(accounts)));
  const bin = join(dir, "xcb");
  await writeFile(bin, `#!/bin/sh\nSTUB_DIR='${dir}' STUB_DELAY_MS='${delayMs}' exec '${process.execPath}' '${join(dir, "stub.cjs")}' "$@"\n`);
  await chmod(bin, 0o755);
  const calls = async () => existsSync(join(dir, "calls.jsonl")) ? (await readFile(join(dir, "calls.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)) : [];
  const ledger = async () => existsSync(join(dir, "ledger.jsonl")) ? (await readFile(join(dir, "ledger.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line)) : [];
  return { dir, bin, ledgerPath: join(dir, "ledger.jsonl"), calls, ledger, violations: () => existsSync(join(dir, "violations")) };
}
const open = (s: Awaited<ReturnType<typeof stub>>, extra: Partial<Parameters<typeof XcbSubscriptionTransport.open>[0]> = {}) =>
  XcbSubscriptionTransport.open({ bin: s.bin, ledgerPath: s.ledgerPath, profiles: [READER, JUDGE], maxCalls: 100, sleep: async () => {}, ...extra });
const readerMessages = (question = "What did I say?", context = "Session 1: hello") =>
  evolutionAnswerMessages({ question, questionDate: "2026-01-01" }, context, "task-complete-v10");
const judgeMessages = (text: string) => [{ role: "user" as const, content: text }];

describe("xcb subscription profiles", () => {
  test("are distinct from Gateway ids, labeled non-comparable, and leave Gateway profiles unchanged", () => {
    expect(isXcbSubscriptionProfileId(READER)).toBe(true);
    expect(isXcbSubscriptionProfileId(EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID)).toBe(false);
    for (const id of Object.keys(XCB_SUBSCRIPTION_PROFILES)) expect(Object.hasOwn(EVOLUTION_PROFILES, id)).toBe(false);
    expect(XCB_SUBSCRIPTION_PROFILES[READER].comparability.releasedScorerComparable).toBe(false);
    expect(XCB_SUBSCRIPTION_PROFILES[JUDGE].mirrors).toEqual([...EVOLUTION_BEAM_JUDGE_PROFILE_IDS]);
    expect(XCB_SUBSCRIPTION_PROFILES[READER].instructionSha256).toBe(EVOLUTION_PROFILES[EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID].readerContract!.instructionSha256);
  });

  test("bind the v11 reader to its own contract and reject v10 messages", () => {
    const v11 = XCB_SUBSCRIPTION_PROFILES["xcb-claude-haiku-task-complete-v11"];
    expect(v11.mirrors).toEqual(["gpt5-mini-task-complete-long-deadline-v11-reader"]);
    expect(v11.instructionSha256).toBe(EVOLUTION_PROFILES["gpt5-mini-task-complete-long-deadline-v11-reader"].readerContract!.instructionSha256);
    const messages = evolutionAnswerMessages({ question: "q?", questionDate: "2026-01-01" }, "context", "task-complete-v11");
    expect(makeXcbSubscriptionRequest("xcb-claude-haiku-task-complete-v11", messages).prompt).toContain("does not replace an explicitly set goal");
    expect(() => makeXcbSubscriptionRequest("xcb-claude-haiku-task-complete-v11", readerMessages())).toThrow(/differs from the mirrored contract/u);
  });

  test("render the Gateway reader messages into one delimited block", () => {
    const messages = readerMessages();
    const gateway = makeEvolutionRequest(EVOLUTION_TASK_COMPLETE_V10_READER_PROFILE_ID, messages);
    const request = makeXcbSubscriptionRequest(READER, messages);
    expect(request.prompt).toBe(`<system>\n${gateway.body.messages[0]!.content}\n</system>\n\n<user>\n${gateway.body.messages[1]!.content}\n</user>`);
    expect(request.promptSha256).toBe(sha256Hex(request.prompt));
    expect(request.promptBytes).toBe(Buffer.byteLength(request.prompt));
    expect(makeXcbSubscriptionRequest(READER, messages).requestSha256).toBe(request.requestSha256);
    expect(renderXcbPrompt(judgeMessages("single"))).toBe("single");
    expect(makeXcbSubscriptionRequest(JUDGE, [{ role: "system", content: "s" }, { role: "user", content: "u" }]).prompt).toBe("<system>\ns\n</system>\n\n<user>\nu\n</user>");
  });

  test("reject a reader instruction that differs from task-complete-v10 and wrong shapes", () => {
    const other = evolutionAnswerMessages({ question: "q", questionDate: "2026-01-01" }, "c", "task-complete-v9");
    expect(() => makeXcbSubscriptionRequest(READER, other)).toThrow(/instruction/u);
    expect(() => makeXcbSubscriptionRequest(READER, judgeMessages("x"))).toThrow(/shape/u);
    expect(() => makeXcbSubscriptionRequest(JUDGE, [{ role: "user", content: "a\u0000b" }])).toThrow(/messages/u);
    expect(canonicalSha256(readerMessages()[0]!.content)).toBe(XCB_SUBSCRIPTION_PROFILES[READER].instructionSha256!);
  });

  test("the xcb binary comes from the option, then XCB_BIN, then PATH", () => {
    expect(xcbBin({ bin: "/opt/xcb" })).toBe("/opt/xcb");
    expect(xcbBin({ env: { XCB_BIN: "/env/xcb" } })).toBe("/env/xcb");
    expect(xcbBin({ env: {} })).toBe(process.env.XCB_BIN ?? "xcb");
    expect(() => xcbBin({ bin: "" })).toThrow(/invalid/u);
  });

  test("capabilities keep only available, qualified rows", () => {
    const parsed = parseXcbCapabilities(JSON.stringify(capabilities([account("a_1", ["claude/haiku"]),
      account("a_2", ["claude/haiku"], { available: false, reason: "application_not_qualified" }), account("a_3", ["claude/haiku"], { qualification: undefined })])));
    expect(parsed.accounts.map(row => row.id)).toEqual(["a_1"]);
    expect(parsed.limits.maxTimeoutMs).toBe(300_000);
  });
});

describe("xcb subscription transport (stub xcb)", () => {
  test("completes a reader call with the exact six-field input and records a ledger line", async () => {
    const s = await stub([account("a_1", ["claude/haiku", "claude/sonnet/low"])]);
    const transport = await open(s);
    expect(transport.concurrency).toBe(1);
    const { result, request, replayed } = await transport.invoke(READER, readerMessages());
    expect(replayed).toBe(false);
    expect(result.status).toBe("completed");
    expect(result.answer).toBe(`ECHO ${request.prompt.length}`);
    expect(result.usage.micros).toBe(0);
    expect(result.identity).toMatchObject({ transport: "xcb-subscription", account: "a_1", model: "claude/haiku" });
    const [call] = await s.calls();
    expect(call).toEqual({ account: "a_1", model: "claude/haiku", timeoutMs: 300_000, maxOutputBytes: 65_536, promptSha256: request.promptSha256 });
    const [line] = await s.ledger();
    expect(line).toMatchObject({ requestSha256: request.requestSha256, account: "a_1", model: "claude/haiku", promptSha256: request.promptSha256,
      promptBytes: request.promptBytes, status: "completed", code: null, attempt: 0 });
    expect(typeof line.latencyMs).toBe("number");
    expect(JSON.stringify(line)).not.toMatch(/token|secret|password|HOME/iu);
  });

  test("never runs two calls on one account and round-robins across accounts", async () => {
    const s = await stub([account("a_1", ["claude/haiku"]), account("a_2", ["claude/haiku"]), account("a_3", ["claude/sonnet"])], 150);
    const transport = await open(s);
    expect(transport.concurrency).toBe(2);
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => transport.invoke(JUDGE, judgeMessages(`judge ${index}`))));
    expect(results.every(row => row.result.status === "completed")).toBe(true);
    expect(s.violations()).toBe(false);
    const accounts = (await s.calls()).map(row => row.account);
    expect(accounts.length).toBe(6);
    expect(accounts.filter(id => id === "a_1").length).toBeGreaterThanOrEqual(2);
    expect(accounts.filter(id => id === "a_2").length).toBeGreaterThanOrEqual(2);
    expect(accounts).not.toContain("a_3");
  }, 20_000);

  test("retries busy and deadline with bounded backoff, then succeeds", async () => {
    const s = await stub([account("a_1", ["claude/haiku"])]);
    const waits: number[] = [];
    const transport = await open(s, { sleep: async ms => { waits.push(ms); }, backoffBaseMs: 1_000, backoffCapMs: 3_000 });
    const busy = await transport.invoke(JUDGE, judgeMessages("[[busy:2]] a"));
    expect(busy.result.status).toBe("completed");
    expect(busy.counted).toBe(2);
    const deadline = await transport.invoke(JUDGE, judgeMessages("[[deadline:3]] b"));
    expect(deadline.counted).toBe(3);
    expect(waits).toEqual([1_000, 2_000, 1_000, 2_000, 3_000]);
    expect((await s.ledger()).map(line => line.code)).toEqual(["busy", "busy", null, "deadline", "deadline", "deadline", null]);
  });

  test("gives up after the attempt cap without halting the run", async () => {
    const s = await stub([account("a_1", ["claude/haiku"])]);
    const transport = await open(s, { maxAttempts: 3 });
    await expect(transport.invoke(JUDGE, judgeMessages("[[always:2]]"))).rejects.toBeInstanceOf(XcbSubscriptionFailure);
    expect((await s.calls()).length).toBe(3);
    expect(transport.halted).toBeNull();
  });

  test("invalid_request is a hard failure and output_limit is a truncated reader outcome", async () => {
    const s = await stub([account("a_1", ["claude/haiku"])]);
    const transport = await open(s);
    await expect(transport.invoke(JUDGE, judgeMessages("[[invalid_request]]"))).rejects.toBeInstanceOf(XcbSubscriptionFailure);
    const truncated = await transport.invoke(READER, readerMessages("[[output_limit]]"));
    expect(truncated.result).toMatchObject({ status: "truncated", answer: null, failureReason: "output-token-limit" });
    expect((await s.calls()).length).toBe(2);
    expect(transport.halted).toBeNull();
  });

  test("custody_unproven halts the run and holds the account", async () => {
    const s = await stub([account("a_1", ["claude/haiku"])]);
    const transport = await open(s);
    await expect(transport.invoke(JUDGE, judgeMessages("[[custody_unproven]]"))).rejects.toBeInstanceOf(XcbSubscriptionHalt);
    expect(transport.halted).toMatch(/custody_unproven/u);
    await expect(transport.invoke(JUDGE, judgeMessages("fine"))).rejects.toBeInstanceOf(XcbSubscriptionHalt);
    expect((await s.calls()).length).toBe(1);
  });

  test("unparseable xcb output halts rather than retrying", async () => {
    const s = await stub([account("a_1", ["claude/haiku"])]);
    const transport = await open(s);
    await expect(transport.invoke(JUDGE, judgeMessages("[[garbage]]"))).rejects.toBeInstanceOf(XcbSubscriptionHalt);
    expect((await s.ledger())[0]).toMatchObject({ status: "uncertain" });
  });

  test("honors the per-run call cap, counting retries", async () => {
    const s = await stub([account("a_1", ["claude/haiku"])]);
    const transport = await open(s, { maxCalls: 2 });
    await expect(transport.invoke(JUDGE, judgeMessages("[[busy:5]] x"))).rejects.toThrow(/call cap/u);
    expect((await s.calls()).length).toBe(2);
  });

  test("resumes from the ledger without new calls", async () => {
    const s = await stub([account("a_1", ["claude/haiku"])]);
    const first = await open(s);
    const original = await first.invoke(JUDGE, judgeMessages("resume me"));
    await first.invoke(READER, readerMessages("[[output_limit]]"));
    const second = await open(s);
    const again = await second.invoke(JUDGE, judgeMessages("resume me"));
    expect(again.replayed).toBe(true);
    expect(again.result.answer).toBe(original.result.answer);
    expect((await second.invoke(READER, readerMessages("[[output_limit]]"))).result.status).toBe("truncated");
    expect(second.calls).toBe(0);
    expect((await s.calls()).length).toBe(2);
  });

  test("refuses to open when no available account serves a profile", async () => {
    const s = await stub([account("a_1", ["claude/sonnet"])]);
    await expect(open(s)).rejects.toThrow(/no available account/u);
  });
});
