import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical";
import { ApiLabTransport, EXTENDED_API_REQUEST_TIMEOUT_MS, parseApiRequestTimeoutPolicy, prepareApiRequest } from "../scripts/benchmarks/memory-lab/api-transport";

const roots: string[] = [], previousKey = process.env.VERTEX_API_KEY;
afterEach(() => { for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true }); if (previousKey === undefined) delete process.env.VERTEX_API_KEY; else process.env.VERTEX_API_KEY = previousKey; });
const baseTime = Date.parse("2026-10-01T06:00:00Z"), messages = [{ role: "user" as const, content: "Invented timing fixture." }];
function fixture(expiresAt = "2026-10-03T00:00:00Z") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oh-timeout-policy-"))); roots.push(root);
  const cache = join(root, "cache"); mkdirSync(cache, { mode: 0o700 }); const ledgerPath = join(cache, "ledger.jsonl"), budgetPath = join(root, "budget.json");
  writeFileSync(budgetPath, JSON.stringify({ protocol: "oh.memory-lab-api-budget.v2", maxUsd: 5, maxCalls: 100, expiresAt, ledgerPath }), { mode: 0o600 });
  const config = { budgetPath, reader: { id: "invented-reader", model: "gemini-3.8-flash" as const, keyEnv: "VERTEX_API_KEY" as const, maximumOutput: 8192 }, judge: { id: "unused-judge", model: "grok-4.7" as const, keyEnv: "XAI_API_KEY" as const, maximumOutput: 8192 } };
  let calls = 0; process.env.VERTEX_API_KEY = "invented-only";
  const fetcher = Object.assign(async () => { calls++; return Response.json({ modelVersion: "gemini-3.8-flash", candidates: [{ finishReason: "STOP", content: { parts: [{ text: "invented" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 0, totalTokenCount: 12 } }); }, { preconnect() { throw Error("fixture cannot connect"); } }) as typeof fetch;
  return { root, ledgerPath, config, fetcher, calls: () => calls };
}
function captures(f: ReturnType<typeof fixture>) { return existsSync(f.ledgerPath + ".attempts") ? readdirSync(f.ledgerPath + ".attempts") : []; }

test("omitted timeout keeps legacy120s and request bytes; explicit600s adds a separate bound policy", async () => {
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
  try {
    for (const extended of [false, true]) {
      const f = fixture(), t = await ApiLabTransport.open({ config: f.config, maxCalls: 1, fetcher: f.fetcher, now: () => baseTime, ...(extended ? { requestTimeoutMs: EXTENDED_API_REQUEST_TIMEOUT_MS } : {}) });
      try { await t.invoke(f.config.reader.id, messages); } finally { t.close(); }
      expect(timeout.mock.calls.at(-1)).toEqual([extended ? 600000 : 120000]);
      const requestName = captures(f).find(n => n.endsWith(".request.json"))!, raw = readFileSync(join(f.ledgerPath + ".attempts", requestName));
      const request = JSON.parse(raw.toString()), prepared = prepareApiRequest(f.config.reader, messages);
      expect(request.requestSha256).toBe(prepared.requestSha256); expect(JSON.stringify(request.body)).toBe(prepared.raw);
      const policyName = captures(f).find(n => n.endsWith(".request-policy.json"));
      if (!extended) expect(policyName).toBeUndefined();
      else {
        const policy = parseApiRequestTimeoutPolicy(JSON.parse(readFileSync(join(f.ledgerPath + ".attempts", policyName!), "utf8")));
        expect(policy).toMatchObject({ timeoutMs: 600000, admittedAtMs: baseTime, sessionDeadlineMs: baseTime + 3600000, requestSha256: prepared.requestSha256, requestCaptureSha256: sha256Hex(raw), budgetSha256: sha256Hex(readFileSync(f.config.budgetPath)) });
        expect(policy.attemptId + ".request.json").toBe(requestName);
      }
    }
  } finally { timeout.mockRestore(); }
});

test("legacy120s still clips near session end without an extended policy", async () => {
  const f = fixture(); let current = baseTime;
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal), t = await ApiLabTransport.open({ config: f.config, maxCalls: 1, fetcher: f.fetcher, now: () => current });
  try { current += 3540000; await t.invoke(f.config.reader.id, messages); expect(timeout.mock.calls.at(-1)).toEqual([60000]); expect(captures(f).some(n => n.endsWith(".request-policy.json"))).toBeFalse(); }
  finally { t.close(); timeout.mockRestore(); }
});

test("extended timeout requires full600s at the session and budget boundaries before reservation", async () => {
  for (const boundary of ["session", "budget"]) for (const offset of [0, 1]) {
    const f = fixture(boundary === "budget" ? new Date(baseTime + 600000 - offset).toISOString() : undefined); let current = baseTime;
    const t = await ApiLabTransport.open({ config: f.config, maxCalls: 1, fetcher: f.fetcher, now: () => current, requestTimeoutMs: 600000 });
    try {
      if (boundary === "session") current += 3000000 + offset;
      if (offset === 0) { await t.invoke(f.config.reader.id, messages); expect(f.calls()).toBe(1); }
      else { await expect(t.invoke(f.config.reader.id, messages)).rejects.toThrow("full extended"); expect(f.calls()).toBe(0); expect(existsSync(f.ledgerPath)).toBeFalse(); expect(captures(f)).toEqual([]); }
    } finally { t.close(); }
  }
});

test("extended policy includes rate expiry even when budget and session continue", async () => {
  const cutoff = Date.parse("2027-01-01T00:00:00Z");
  for (const offset of [0, 1]) {
    const f = fixture("2027-01-02T00:00:00Z"), current = cutoff - 600000 + offset;
    const t = await ApiLabTransport.open({ config: f.config, maxCalls: 1, fetcher: f.fetcher, now: () => current, requestTimeoutMs: 600000 });
    try {
      if (offset === 0) {
        await t.invoke(f.config.reader.id, messages); const name = captures(f).find(n => n.endsWith(".request-policy.json"))!;
        expect(JSON.parse(readFileSync(join(f.ledgerPath + ".attempts", name), "utf8")).sessionDeadlineMs).toBe(cutoff);
      } else { await expect(t.invoke(f.config.reader.id, messages)).rejects.toThrow("full extended"); expect(f.calls()).toBe(0); expect(existsSync(f.ledgerPath)).toBeFalse(); }
    } finally { t.close(); }
  }
});

test("clock advance across durable writes never causes a clipped or late dispatch", async () => {
  for (const advanceAt of [4, 5]) {
    const f = fixture(new Date(baseTime + 600000).toISOString()); let invokeReads = 0, invoked = false;
    const clock = () => invoked && ++invokeReads >= advanceAt ? baseTime + 1 : baseTime;
    const t = await ApiLabTransport.open({ config: f.config, maxCalls: 1, fetcher: f.fetcher, now: clock, requestTimeoutMs: 600000 });
    try {
      invoked = true; await expect(t.invoke(f.config.reader.id, messages)).rejects.toThrow(advanceAt === 4 ? "before reservation" : "after reservation");
      expect(f.calls()).toBe(0); expect(captures(f).filter(n => n.endsWith(".request-policy.json"))).toHaveLength(1);
      if (advanceAt === 4) { expect(existsSync(f.ledgerPath)).toBeFalse(); expect(t.summary.callsThisRun).toBe(0); }
      else { const rows = readFileSync(f.ledgerPath, "utf8").trim().split("\n").map(line => JSON.parse(line)); expect(rows).toHaveLength(1); expect(rows[0].kind).toBe("reserved"); expect(t.summary.accountedUsd).toBe(rows[0].micros / 1e6); }
    } finally { t.close(); }
  }
});

test("unsupported overrides fail before ownership or captures", async () => {
  for (const requestTimeoutMs of [0, 120000, 600001, null, "600000", Infinity]) {
    const f = fixture();
    await expect(ApiLabTransport.open({ config: f.config, maxCalls: 1, fetcher: f.fetcher, now: () => baseTime, requestTimeoutMs: requestTimeoutMs as 600000 })).rejects.toThrow("unsupported");
    expect(existsSync(f.ledgerPath + ".lock")).toBeFalse(); expect(captures(f)).toEqual([]); expect(f.calls()).toBe(0);
  }
});

test("pure policy parser rejects shortened, unbounded and malformed policy claims", async () => {
  const policy = { protocol: "oh.memory-lab-api-request-policy.v1", attemptId: "12345678-1234-1234-1234-123456789abc", requestSha256: "a".repeat(64), requestCaptureSha256: "b".repeat(64), timeoutMs: 600000, admittedAtMs: baseTime, sessionDeadlineMs: baseTime + 3600000, budgetSha256: "c".repeat(64) };
  expect(parseApiRequestTimeoutPolicy(policy)).toEqual(policy);
  for (const change of [{ timeoutMs: 120000 }, { sessionDeadlineMs: baseTime + 599999 }, { sessionDeadlineMs: baseTime + 3600001 }, { admittedAtMs: 1.5 }, { budgetSha256: "bad" }, { extra: true }]) expect(() => parseApiRequestTimeoutPolicy({ ...policy, ...change })).toThrow("policy");
});
