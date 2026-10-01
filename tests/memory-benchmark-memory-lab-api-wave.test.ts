import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { Message } from "../scripts/benchmarks/model";
import { ApiLabTransport, prepareApiRequest, type ApiConfig, type ApiLedgerEvent, type ApiReply } from "../scripts/benchmarks/memory-lab/api-transport";
import { ApiLabWaveTransport, type ApiWaveBoundary, type ApiWaveCheckpoint, type ApiWaveOptions, type ApiWavePin, type ApiWavePlan, type ApiWaveResult, type ApiWaveSubmission } from "../scripts/benchmarks/memory-lab/api-wave";
import { waveReadJournal, type ApiWaveJob } from "../scripts/benchmarks/memory-lab/api-wave-store";
import { verifyApiWaveRun } from "../scripts/benchmarks/memory-lab/api-wave-replay";

// These fixtures run with an empty external environment. Every provider operation
// is an injected function, every key is invented, and all files are task-owned.
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  delete process.env.VERTEX_API_KEY;
  delete process.env.XAI_API_KEY;
});
const baseTime = Date.parse("2026-10-01T06:00:00Z");
const messages: readonly Message[] = [{ role: "user", content: "Invented wave fixture: a purple kite is beside a toy lighthouse." }];
const inventedKey = "invented-wave-fixture-not-a-credential";
type FixtureOptions = { count?: number; concurrency?: number; maxCalls?: number; maxUsd?: number; expiresAt?: string;
  jobs?: (config: ApiConfig) => readonly ApiWaveJob[] };
function pin(path: string): ApiWavePin {
  const raw = readFileSync(path); return { path, bytes: raw.length, sha256: sha256Hex(raw) };
}
function save(path: string, value: unknown): ApiWavePin {
  writeFileSync(path, JSON.stringify(value) + "\n", { mode: 0o600 }); return pin(path);
}
function job(config: ApiConfig, id: string, changes: Partial<ApiWaveJob> = {}): ApiWaveJob {
  const request = prepareApiRequest(config.reader, messages);
  return { id, profileId: config.reader.id, requestSha256: request.requestSha256,
    maximumReservationMicros: request.reservationMicros, maximumRequestBytes: Buffer.byteLength(request.raw), dependencies: [], ...changes };
}
function fixture(options: FixtureOptions = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oh-api-wave-invented-"))); roots.push(root);
  const cache = join(root, "cache"), run = join(root, "run");
  mkdirSync(cache, { mode: 0o700 }); mkdirSync(run, { mode: 0o700 });
  const ledgerPath = join(cache, "ledger.jsonl"), budgetPath = join(root, "budget.json"), journalPath = join(run, "waves.jsonl");
  const config: ApiConfig = { budgetPath,
    reader: { id: "invented-reader", model: "gemini-3.8-flash", keyEnv: "VERTEX_API_KEY", maximumOutput: 64 },
    judge: { id: "invented-judge", model: "grok-4.7", keyEnv: "XAI_API_KEY", maximumOutput: 64 } };
  save(budgetPath, { protocol: "oh.memory-lab-api-budget.v2", maxUsd: options.maxUsd ?? 5,
    maxCalls: options.maxCalls ?? 100, expiresAt: options.expiresAt ?? "2026-10-03T00:00:00Z", ledgerPath });
  const jobs = options.jobs?.(config) ?? Array.from({ length: options.count ?? 4 }, (_, i) => job(config, `job-${i}`));
  const planValue: ApiWavePlan = { protocol: "oh.memory-lab-api-wave-plan.v1", runId: "invented-wave-run",
    policySha256: canonicalSha256({ fixture: "invented policy", noRetries: true }), concurrency: options.concurrency ?? 4,
    requestTimeoutMs: 600000, jobs };
  const plan = save(join(root, "plan.json"), planValue);
  process.env.VERTEX_API_KEY = inventedKey; process.env.XAI_API_KEY = inventedKey;
  return { root, run, ledgerPath, journalPath, config, plan, planValue };
}
type Fixture = ReturnType<typeof fixture>;
function fakeFetch(fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return Object.assign(fn, { preconnect() { throw Error("invented fixture cannot connect"); } }) as typeof fetch;
}
function reply(text = "Invented answer."): Response {
  return Response.json({ modelVersion: "gemini-3.8-flash", candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 0, totalTokenCount: 12 } });
}
function judgeReply(): Response {
  return Response.json({ model: "grok-4.7", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Invented judge answer." }] }],
    usage: { input_tokens: 10, output_tokens: 2, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 12,
      num_server_side_tools_used: 0, num_sources_used: 0 } });
}
function defer<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject };
}
async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await Promise.resolve();
  expect(predicate()).toBeTrue();
}
function ledger(f: Fixture): ApiLedgerEvent[] {
  return existsSync(f.ledgerPath) ? readFileSync(f.ledgerPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as ApiLedgerEvent) : [];
}
function captures(f: Fixture): string[] {
  return existsSync(f.ledgerPath + ".attempts") ? readdirSync(f.ledgerPath + ".attempts").sort() : [];
}
function submissions(f: Fixture, start = 0, count = f.planValue.concurrency): ApiWaveSubmission[] {
  return f.planValue.jobs.slice(start, start + count).map(row => ({ jobId: row.id, messages, dependencyReceipts: [] }));
}
function open(f: Fixture, fetcher: typeof fetch, options: Partial<Pick<ApiWaveOptions, "now" | "onBoundary">> = {}) {
  return ApiLabWaveTransport.open({ config: f.config, plan: f.plan, journalPath: f.journalPath,
    concurrency: f.planValue.concurrency, requestTimeoutMs: 600000, fetcher, now: () => baseTime, ...options });
}
function tree(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  function walk(directory: string, relative: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name), path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, name); else hashes[name] = sha256Hex(readFileSync(path));
    }
  }
  walk(root, ""); return hashes;
}
function replay(f: Fixture) { return verifyApiWaveRun({ config: f.config, plan: f.plan, journalPath: f.journalPath }); }

test("width four reserves the complete canonical wave before fetch and preserves distinct identical-body attempts", async () => {
  const f = fixture({ count: 8 }), gates = Array.from({ length: 8 }, () => defer<Response>());
  const bodies: string[] = [], completed: string[] = []; let calls = 0, active = 0, maximumActive = 0;
  const transport = await open(f, fakeFetch(async (_input, init) => {
    const index = calls++; active++; maximumActive = Math.max(maximumActive, active);
    const rows = ledger(f), reservations = rows.filter(row => row.kind === "reserved");
    expect(reservations).toHaveLength(index < 4 ? 4 : 8);
    if (index < 4) expect(rows.every(row => row.kind === "reserved")).toBeTrue();
    expect(captures(f).filter(name => name.endsWith(".request.json"))).toHaveLength(index < 4 ? 4 : 8);
    expect(captures(f).filter(name => name.endsWith(".request-policy.json"))).toHaveLength(index < 4 ? 4 : 8);
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe(inventedKey);
    expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
    bodies.push(String(init?.body));
    try { return await gates[index]!.promise; } finally { active--; }
  }), { onBoundary(point, identity) { if (point === "checkpoint") completed.push(identity.jobId!); } });
  const pending = transport.invokeWave(submissions(f)); let finished = false, secondPending: Promise<ApiWaveResult> | undefined;
  void pending.then(() => { finished = true; });
  try {
    expect(calls).toBe(4); expect(active).toBe(4);
    await expect(transport.invokeWave(submissions(f, 4))).rejects.toThrow("concurrent");
    expect(() => transport.close()).toThrow("drain"); expect(existsSync(f.ledgerPath + ".lock")).toBeTrue();
    for (const index of [2, 0, 3]) { gates[index]!.resolve(reply(`Invented completion ${index}.`)); await until(() => completed.length === [2, 0, 3].indexOf(index) + 1); }
    expect(completed).toEqual(["job-2", "job-0", "job-3"]); expect(finished).toBeFalse(); expect(calls).toBe(4);
    expect(() => transport.rotateSession()).toThrow("drained");
    gates[1]!.resolve(reply("Invented final sibling."));
    const first = await pending;
    expect(first.status).toBe("complete"); expect(first.members.map(row => row.jobId)).toEqual(["job-0", "job-1", "job-2", "job-3"]);
    expect(new Set(first.members.map(row => row.attemptId)).size).toBe(4);
    expect(first.members.every(row => row.status === "completed" && row.checkpoint !== null)).toBeTrue();
    expect(new Set(bodies).size).toBe(1);
    const firstCheckpoints = first.members.map(row => JSON.parse(readFileSync(row.checkpoint!.path, "utf8")) as ApiWaveCheckpoint);
    expect(new Set(firstCheckpoints.map(row => row.requestSha256)).size).toBe(1);
    expect(new Set(firstCheckpoints.map(row => row.requestCapture.path)).size).toBe(4);
    for (const checkpoint of firstCheckpoints) {
      expect(checkpoint.requestCapture).toEqual(pin(checkpoint.requestCapture.path));
      expect(checkpoint.sendPermit).toEqual(pin(checkpoint.sendPermit.path));
      expect(checkpoint.resultCapture).toEqual(pin(checkpoint.resultCapture!.path));
      expect(checkpoint.settlementOffset).toBeGreaterThan(checkpoint.reservationOffset);
    }
    secondPending = transport.invokeWave(submissions(f, 4)); expect(calls).toBe(8); expect(active).toBe(4);
    for (const gate of gates.slice(4)) gate.resolve(reply());
    const second = await secondPending;
    expect(second.status).toBe("complete"); expect(second.completedJobs).toBe(8); expect(maximumActive).toBe(4);
    expect(ledger(f).filter(row => row.kind === "reserved")).toHaveLength(8);
    expect(ledger(f).filter(row => row.kind === "settled")).toHaveLength(8);
  } finally {
    for (const gate of gates) gate.resolve(reply()); await Promise.all([pending, secondPending]); transport.close();
  }
  expect(waveReadJournal(f.journalPath).filter(row => row.kind === "wave-close")).toHaveLength(2);
  expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
});

test("one failed fetch drains three delayed successful siblings before stop or close and never retries", async () => {
  const f = fixture({ count: 8 }), gates = Array.from({ length: 4 }, () => defer<Response>());
  let calls = 0; const transport = await open(f, fakeFetch(async () => gates[calls++]!.promise));
  const pending = transport.invokeWave(submissions(f)); let finished = false;
  void pending.then(() => { finished = true; });
  try {
    expect(calls).toBe(4); gates[0]!.reject(Error("invented connection loss"));
    await until(() => transport.summary.halted); expect(finished).toBeFalse();
    expect(waveReadJournal(f.journalPath).some(row => row.kind === "wave-close" || row.kind === "stopped")).toBeFalse();
    expect(() => transport.close()).toThrow("drain"); expect(() => transport.rotateSession()).toThrow("drained");
    await expect(transport.invokeWave(submissions(f, 4))).rejects.toThrow("halted");
    for (const gate of gates.slice(1)) gate.resolve(reply());
    const result = await pending;
    expect(result.status).toBe("stopped"); expect(result.completedJobs).toBe(3); expect(result.resumable).toBeFalse();
    expect(result.members.map(row => row.status)).toEqual(["unknown", "completed", "completed", "completed"]);
    expect(ledger(f).filter(row => row.kind === "reserved")).toHaveLength(4);
    expect(ledger(f).filter(row => row.kind === "settled")).toHaveLength(3);
    expect(calls).toBe(4);
    await expect(transport.invokeWave(submissions(f))).rejects.toThrow("halted"); expect(calls).toBe(4);
    const kinds = waveReadJournal(f.journalPath).map(row => row.kind);
    expect(kinds.indexOf("wave-close")).toBeLessThan(kinds.indexOf("stopped"));
  } finally { for (const gate of gates) gate.resolve(reply()); await pending; transport.close(); }
  expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
  const before = tree(f.root), verified = replay(f);
  expect(verified).toMatchObject({ status: "stopped", completedJobs: 3, attemptedCalls: 4, providerCalls: 0, invoiceVerified: false, resumable: false });
  expect(verified.jobs.map(row => row.status)).toEqual(["unknown", "completed", "completed", "completed", "not-attempted", "not-attempted", "not-attempted", "not-attempted"]);
  expect(tree(f.root)).toEqual(before); expect(calls).toBe(4);
});

test("a missing selected fake key retains whole-wave reservations and cannot reach injected fetch", async () => {
  const f = fixture(); let calls = 0;
  const transport = await open(f, fakeFetch(async () => { calls++; return reply(); }));
  delete process.env.VERTEX_API_KEY;
  try {
    const result = await transport.invokeWave(submissions(f));
    expect(result.status).toBe("stopped"); expect(result.members.every(row => row.status === "not-dispatched")).toBeTrue();
    expect(calls).toBe(0); expect(ledger(f).map(row => row.kind)).toEqual(["reserved", "reserved", "reserved", "reserved"]);
    expect(captures(f).some(name => name.endsWith(".wave-send-permit.json"))).toBeFalse();
  } finally { transport.close(); }
});

test("canonical ready order, whole-wave width and exact job envelopes reject before reservations or sends", async () => {
  for (const change of ["reverse", "short", "duplicate", "message", "reservation", "bytes"] as const) {
    const f = fixture({ jobs: config => Array.from({ length: 4 }, (_, i) => job(config, `job-${i}`,
      i === 3 && change === "reservation" ? { maximumReservationMicros: 1 } : i === 3 && change === "bytes" ? { maximumRequestBytes: 1 } : {})) });
    let calls = 0; const transport = await open(f, fakeFetch(async () => { calls++; return reply(); }));
    try {
      const rows = submissions(f);
      if (change === "reverse") rows.reverse();
      if (change === "short") rows.pop();
      if (change === "duplicate") rows[3] = rows[0]!;
      if (change === "message") rows[3] = { ...rows[3]!, messages: [{ role: "user", content: "Another invented body." }] };
      await expect(transport.invokeWave(rows)).rejects.toThrow();
      expect(calls).toBe(0); expect(ledger(f)).toEqual([]); expect(captures(f)).toEqual([]);
      expect(transport.summary.halted).toBeTrue();
    } finally { transport.close(); }
  }
});

test("whole remaining plan must fit call and money budgets before acquiring runnable ownership", async () => {
  for (const options of [{ count: 5, maxCalls: 4 }, { count: 4, maxUsd: 0.000001 }]) {
    const f = fixture(options); let calls = 0;
    await expect(open(f, fakeFetch(async () => { calls++; return reply(); }))).rejects.toThrow("remaining plan");
    expect(calls).toBe(0); expect(ledger(f)).toEqual([]); expect(captures(f)).toEqual([]);
    expect(existsSync(f.ledgerPath + ".lock")).toBeFalse(); expect(readdirSync(f.run)).toEqual([]);
  }
});

test("full declared session timeout headroom is required at budget, rate and session boundaries", async () => {
  for (const boundary of ["budget", "rates"] as const) for (const shortBy of [0, 1]) {
    const cutoff = boundary === "rates" ? Date.parse("2027-01-01T00:00:00Z") : baseTime + 600000;
    const current = cutoff - 600000 + shortBy;
    const f = fixture({ count: 1, expiresAt: new Date(boundary === "rates" ? cutoff + 86400000 : cutoff).toISOString() });
    let calls = 0; const fetcher = fakeFetch(async () => { calls++; return reply(); });
    if (shortBy) {
      await expect(open(f, fetcher, { now: () => current })).rejects.toThrow("session wave time");
      expect(ledger(f)).toEqual([]); expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
    } else {
      const transport = await open(f, fetcher, { now: () => current });
      try { expect((await transport.invokeWave(submissions(f))).status).toBe("complete"); } finally { transport.close(); }
    }
    expect(calls).toBe(shortBy ? 0 : 1);
  }
  const f = fixture({ count: 4 }); let current = baseTime, calls = 0;
  const transport = await open(f, fakeFetch(async () => { calls++; return reply(); }), { now: () => current });
  try {
    current = baseTime + 1200001;
    await expect(transport.invokeWave(submissions(f))).rejects.toThrow("remaining session waves");
    expect(calls).toBe(0); expect(ledger(f)).toEqual([]); expect(captures(f)).toEqual([]);
  } finally { transport.close(); }
});

test("clock crossing the full timeout after reservation or send permit never dispatches a clipped request", async () => {
  for (const point of ["reservation", "send-permit", "fetch-start"] as const) {
    const f = fixture({ count: 1, expiresAt: new Date(baseTime + 600000).toISOString() }); let current = baseTime, calls = 0;
    const transport = await open(f, fakeFetch(async () => { calls++; return reply(); }), {
      now: () => current, onBoundary(boundary) { if (boundary === point) current++; },
    });
    try {
      const result = await transport.invokeWave(submissions(f));
      expect(result.status).toBe("stopped"); expect(calls).toBe(0);
      expect(ledger(f).map(row => row.kind)).toEqual(["reserved"]);
      expect(result.members[0]!.status).toBe(point === "reservation" ? "not-dispatched" : "unknown");
      expect(captures(f).filter(name => name.endsWith(".wave-send-permit.json"))).toHaveLength(point === "reservation" ? 0 : 1);
    } finally { transport.close(); }
  }
});

test("dependent judge uses the completed parent checkpoint and its frozen request envelope", async () => {
  const judgeMessages: readonly Message[] = [{ role: "user", content: "Judge only this invented parent answer: a purple kite." }];
  const f = fixture({ jobs: config => {
    const request = prepareApiRequest(config.judge, judgeMessages);
    return [job(config, "parent"), job(config, "judge", { profileId: config.judge.id, requestSha256: null,
      maximumReservationMicros: request.reservationMicros, maximumRequestBytes: Buffer.byteLength(request.raw), dependencies: ["parent"] })];
  } });
  const seen: string[] = []; const transport = await open(f, fakeFetch(async (input, init) => {
    seen.push(String(input));
    if (seen.length === 2) {
      expect(waveReadJournal(f.journalPath).filter(row => row.kind === "checkpoint")).toHaveLength(1);
      expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${inventedKey}`);
      return judgeReply();
    }
    return reply("A purple kite.");
  }));
  try {
    const parent = await transport.invokeWave([{ jobId: "parent", messages, dependencyReceipts: [] }]);
    expect(seen).toHaveLength(1); const parentPin = parent.members[0]!.checkpoint!;
    const result = await transport.invokeWave([{ jobId: "judge", messages: judgeMessages, dependencyReceipts: [parentPin] }]);
    expect(result.status).toBe("complete"); expect(result.completedJobs).toBe(2);
    const checkpoint = JSON.parse(readFileSync(result.members[0]!.checkpoint!.path, "utf8")) as ApiWaveCheckpoint;
    expect(checkpoint.dependencyReceipts).toEqual([parentPin]);
    expect(checkpoint.requestSha256).toBe(prepareApiRequest(f.config.judge, judgeMessages).requestSha256);
    expect(seen[1]).toBe("https://api.x.ai/v1/responses");
  } finally { transport.close(); }
});

test("missing, changed, premature and over-envelope dependency submissions cannot send a judge", async () => {
  for (const change of ["missing", "changed-pin", "changed-file", "changed-parent-result", "premature", "over-envelope"] as const) {
    const f = fixture({ jobs: config => [job(config, "parent"), job(config, "judge", {
      requestSha256: null, dependencies: ["parent"], maximumRequestBytes: 512, maximumReservationMicros: 5000 })] });
    let calls = 0; const transport = await open(f, fakeFetch(async () => { calls++; return reply(); }));
    try {
      let parent: ApiWavePin | undefined;
      if (change !== "premature") parent = (await transport.invokeWave([{ jobId: "parent", messages, dependencyReceipts: [] }])).members[0]!.checkpoint!;
      const before = ledger(f);
      if (change === "changed-file") writeFileSync(parent!.path, "{}\n");
      if (change === "changed-parent-result") {
        const checkpoint = JSON.parse(readFileSync(parent!.path, "utf8")) as ApiWaveCheckpoint;
        writeFileSync(checkpoint.resultCapture!.path, "{}\n");
      }
      const receipts = change === "missing" || change === "premature" ? [] : [{ ...parent!, ...(change === "changed-pin" ? { sha256: "f".repeat(64) } : {}) }];
      await expect(transport.invokeWave([{ jobId: "judge", messages: change === "over-envelope" ? [{ role: "user", content: "Invented ".repeat(100) }] : messages,
        dependencyReceipts: receipts }])).rejects.toThrow();
      expect(calls).toBe(change === "premature" ? 0 : 1); expect(ledger(f)).toEqual(before);
    } finally { transport.close(); }
  }
});

test("at most five waves execute in one session and only the same drained object rotates", async () => {
  const f = fixture({ count: 6, concurrency: 1 }); let calls = 0;
  const transport = await open(f, fakeFetch(async () => { calls++; return reply(); }));
  try {
    const owner = transport.ownerId, lock = readFileSync(f.ledgerPath + ".lock");
    for (let i = 0; i < 5; i++) expect((await transport.invokeWave(submissions(f, i, 1))).status).toBe("complete");
    expect(transport.summary).toMatchObject({ session: 0, wavesThisSession: 5, completedJobs: 5 });
    transport.rotateSession(); expect(transport.ownerId).toBe(owner);
    expect(readFileSync(f.ledgerPath + ".lock")).toEqual(lock);
    expect(transport.summary).toMatchObject({ session: 1, wavesThisSession: 0 });
    expect((await transport.invokeWave(submissions(f, 5, 1))).status).toBe("complete"); expect(calls).toBe(6);
    expect(waveReadJournal(f.journalPath).filter(row => row.kind === "session")).toHaveLength(2);
  } finally { transport.close(); }
  const blocked = fixture({ count: 6, concurrency: 1 }); let blockedCalls = 0;
  const unrotated = await open(blocked, fakeFetch(async () => { blockedCalls++; return reply(); }));
  try {
    for (let i = 0; i < 5; i++) await unrotated.invokeWave(submissions(blocked, i, 1));
    await expect(unrotated.invokeWave(submissions(blocked, 5, 1))).rejects.toThrow("rotate");
    expect(blockedCalls).toBe(5); expect(unrotated.summary.halted).toBeTrue();
  } finally { unrotated.close(); }
});

test("completed, stopped and pre-populated execution directories cannot reopen or resume", async () => {
  for (const mode of ["complete", "stopped", "pre-populated"] as const) {
    const f = fixture({ count: 1 }); let calls = 0;
    const fetcher = fakeFetch(async () => { calls++; return reply(); });
    if (mode === "pre-populated") save(join(f.run, "foreign.json"), { invented: true });
    else {
      const transport = await open(f, fetcher);
      try { if (mode === "complete") await transport.invokeWave(submissions(f)); } finally { transport.close(); }
    }
    const before = readdirSync(f.run), rows = ledger(f);
    await expect(open(f, fetcher)).rejects.toThrow("fresh empty");
    expect(readdirSync(f.run)).toEqual(before); expect(ledger(f)).toEqual(rows); expect(calls).toBe(mode === "complete" ? 1 : 0);
    expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
  }
});

test("offline replay proves complete UUID associations without a key, fetch or filesystem mutation", async () => {
  const f = fixture(), gates = Array.from({ length: 4 }, () => defer<Response>()); let calls = 0;
  const transport = await open(f, fakeFetch(async () => gates[calls++]!.promise));
  const pending = transport.invokeWave(submissions(f)); let result: ApiWaveResult;
  try {
    for (const i of [3, 1, 0, 2]) gates[i]!.resolve(reply(`Invented answer ${i}.`));
    result = await pending;
    expect(result.status).toBe("complete");
    const whileOwned = tree(f.root);
    expect(() => replay(f)).toThrow("absent native and recovery locks"); expect(tree(f.root)).toEqual(whileOwned);
  } finally { for (const gate of gates) gate.resolve(reply()); await pending; transport.close(); }
  delete process.env.VERTEX_API_KEY; delete process.env.XAI_API_KEY;
  const before = tree(f.root), verified = replay(f);
  expect(verified).toMatchObject({ protocol: "oh.memory-lab-api-wave-replay.v1", ownerId: transport.ownerId,
    status: "complete", plannedJobs: 4, completedJobs: 4, attemptedCalls: 4, providerCalls: 0, invoiceVerified: false, resumable: false });
  expect(verified.jobs).toEqual(result!.members.map(row => ({ jobId: row.jobId, attemptId: row.attemptId, status: row.status, checkpoint: row.checkpoint })));
  expect(Object.isFrozen(verified)).toBeTrue(); expect(Object.isFrozen(verified.jobs)).toBeTrue();
  expect(replay(f)).toEqual(verified); expect(tree(f.root)).toEqual(before); expect(calls).toBe(4);
  expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
});

test("offline replay rejects changed plan, budget, journal, captures, checkpoints and ledger without repairing evidence", async () => {
  const f = fixture({ count: 2 }); let calls = 0;
  const transport = await open(f, fakeFetch(async () => reply(`Invented distinct answer ${calls++}.`)));
  let result: ApiWaveResult;
  try { result = await transport.invokeWave(submissions(f)); expect(result.status).toBe("complete"); } finally { transport.close(); }
  const checkpointPath = result!.members[0]!.checkpoint!.path;
  const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8")) as ApiWaveCheckpoint;
  const original = replay(f);
  const paths = [f.plan.path, f.config.budgetPath, f.journalPath, f.ledgerPath, join(f.run, "owner.json"), checkpointPath,
    checkpoint.requestCapture.path, checkpoint.requestPolicy.path, checkpoint.sendPermit.path,
    checkpoint.responseCapture.path, checkpoint.resultCapture!.path];
  for (const path of paths) {
    const prior = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([prior, Buffer.from("{invented-torn-change")]), { mode: 0o600 });
      const changed = tree(f.root); expect(() => replay(f)).toThrow(); expect(tree(f.root)).toEqual(changed); expect(calls).toBe(2);
      expect(existsSync(f.ledgerPath + ".lock")).toBeFalse(); expect(existsSync(f.ledgerPath + ".recovery.lock")).toBeFalse();
    } finally { writeFileSync(path, prior, { mode: 0o600 }); }
    expect(replay(f)).toEqual(original);
  }
  // Same request bodies are not interchangeable attempt identities: replay must
  // preserve the response, result, and checkpoint belonging to each UUID.
  const other = JSON.parse(readFileSync(result!.members[1]!.checkpoint!.path, "utf8")) as ApiWaveCheckpoint;
  for (const [target, source] of [[checkpoint.responseCapture.path, other.responseCapture.path], [checkpoint.resultCapture!.path, other.resultCapture!.path]]) {
    const prior = readFileSync(target!);
    try { writeFileSync(target!, readFileSync(source!), { mode: 0o600 }); const changed = tree(f.root); expect(() => replay(f)).toThrow(); expect(tree(f.root)).toEqual(changed); }
    finally { writeFileSync(target!, prior, { mode: 0o600 }); }
  }
  expect(replay(f)).toEqual(original); expect(calls).toBe(2);
});

test("rehashed stopped and closed records cannot roll the ledger prefix behind a drained wave", async () => {
  for (const scenario of [
    { status: "complete", kind: "closed" },
    { status: "stopped", kind: "stopped" },
    { status: "stopped", kind: "closed" },
  ] as const) {
    const f = fixture({ count: 1 }); let calls = 0;
    const transport = await open(f, fakeFetch(async () => {
      calls++; if (scenario.status === "stopped") throw Error("invented unknown outcome"); return reply();
    }));
    try { expect((await transport.invokeWave(submissions(f))).status).toBe(scenario.status); } finally { transport.close(); }
    expect(replay(f).status).toBe(scenario.status);
    const original = readFileSync(f.journalPath), records = waveReadJournal(f.journalPath);
    const emptyPrefix = { bytes: 0, sha256: sha256Hex(Buffer.alloc(0)) };
    let previousSha256: string | null = null, changed = 0;
    const rewritten = records.map((record, sequence) => {
      const data = record.data as Record<string, unknown>;
      if (record.kind === scenario.kind) changed++;
      const payload = { protocol: record.protocol, sequence, previousSha256, kind: record.kind,
        data: record.kind === scenario.kind ? { ...data, ledgerPrefix: emptyPrefix } : data };
      const sha256 = canonicalSha256(payload); previousSha256 = sha256; return { ...payload, sha256 };
    });
    expect(changed).toBe(1); writeFileSync(f.journalPath, rewritten.map(row => JSON.stringify(row) + "\n").join(""));
    // The entire digest chain is valid: rejection must come from ledger
    // continuity rather than from a stale record hash.
    expect(waveReadJournal(f.journalPath)).toHaveLength(records.length);
    const before = tree(f.root);
    expect(() => replay(f)).toThrow("prefix"); expect(tree(f.root)).toEqual(before); expect(calls).toBe(1);
    expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
    writeFileSync(f.journalPath, original); expect(replay(f).status).toBe(scenario.status);
  }
});

test("a rehashed duplicate stopped record with null cannot erase a known terminal ledger prefix", async () => {
  const f = fixture({ count: 1 }); let calls = 0;
  const transport = await open(f, fakeFetch(async () => { calls++; return reply(); }), {
    onBoundary(point) { if (point === "reservation") throw Error("invented partial-reservation stop"); },
  });
  try { await expect(transport.invokeWave(submissions(f))).rejects.toThrow("invented partial-reservation"); }
  finally { transport.close(); }
  const original = readFileSync(f.journalPath), records = waveReadJournal(f.journalPath), stopped = records.find(row => row.kind === "stopped")!;
  const emptyPrefix = { bytes: 0, sha256: sha256Hex(Buffer.alloc(0)) };
  const extra = { ...stopped, data: { ...(stopped.data as Record<string, unknown>), ledgerPrefix: null } };
  const forged = records.flatMap(row => row.kind === "closed"
    ? [extra, { ...row, data: { ...(row.data as Record<string, unknown>), ledgerPrefix: emptyPrefix } }] : [row]);
  let previousSha256: string | null = null;
  const rewritten = forged.map((record, sequence) => {
    const payload = { protocol: record.protocol, sequence, previousSha256, kind: record.kind, data: record.data };
    const sha256 = canonicalSha256(payload); previousSha256 = sha256; return { ...payload, sha256 };
  });
  writeFileSync(f.journalPath, rewritten.map(row => JSON.stringify(row) + "\n").join(""));
  expect(waveReadJournal(f.journalPath)).toHaveLength(records.length + 1);
  const before = tree(f.root);
  expect(() => replay(f)).toThrow("stopped"); expect(tree(f.root)).toEqual(before); expect(calls).toBe(0);
  expect(ledger(f).map(row => row.kind)).toEqual(["reserved"]); expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
  writeFileSync(f.journalPath, original); expect(replay(f)).toMatchObject({ status: "stopped", attemptedCalls: 1, completedJobs: 0 });
});

test("478 invented jobs preserve the full native serial result and usage denominator over 120 waves and 24 sessions", async () => {
  // This is a native transport equivalence fixture. It contains no actual
  // campaign manifest, benchmark answers, grader, or model-quality assertion.
  const count = 478;
  const inventory = Array.from({ length: count }, (_, index) => ({ id: `invented-${String(index).padStart(3, "0")}`,
    messages: [{ role: "user" as const, content: `Invented case ${index}: toy lighthouse ${index} has a purple paper flag.` }] }));
  const serialFixture = fixture({ count: 1, maxCalls: count });
  const waveFixture = fixture({ maxCalls: count, jobs: config => inventory.map(item => {
    const request = prepareApiRequest(config.reader, item.messages);
    return { id: item.id, profileId: config.reader.id, requestSha256: request.requestSha256,
      maximumReservationMicros: request.reservationMicros, maximumRequestBytes: Buffer.byteLength(request.raw), dependencies: [] };
  }) });
  const indexByBody = new Map(inventory.map((item, index) => [prepareApiRequest(waveFixture.config.reader, item.messages).raw, index]));
  const serialSeen: number[] = [], waveSeen: number[] = [];
  function fetcher(seen: number[]) {
    return fakeFetch(async (_input, init) => {
      const index = indexByBody.get(String(init?.body));
      if (index === undefined) throw Error("unknown invented request body"); seen.push(index);
      const inputTokens = 10 + index % 7, outputTokens = 2 + index % 3;
      return Response.json({ modelVersion: "gemini-3.8-flash", candidates: [{ finishReason: "STOP",
        content: { parts: [{ text: `Invented answer for toy lighthouse ${index}.` }] } }],
        usageMetadata: { promptTokenCount: inputTokens, candidatesTokenCount: outputTokens, thoughtsTokenCount: 0,
          totalTokenCount: inputTokens + outputTokens } });
    });
  }
  const serialReplies: ApiReply[] = [], waveReplies: ApiReply[] = [], widths: number[] = [], attemptIds = new Set<string>();
  const serial = await ApiLabTransport.open({ config: serialFixture.config, maxCalls: count, requestTimeoutMs: 600000,
    fetcher: fetcher(serialSeen), now: () => baseTime });
  try { for (const item of inventory) serialReplies.push(await serial.invoke(serialFixture.config.reader.id, item.messages)); }
  finally { serial.close(); }
  const wave = await open(waveFixture, fetcher(waveSeen)), ownerId = wave.ownerId;
  try {
    for (let start = 0; start < count; start += 4) {
      if (widths.length > 0 && widths.length % 5 === 0) wave.rotateSession();
      const result = await wave.invokeWave(inventory.slice(start, start + 4).map(item => ({ jobId: item.id, messages: item.messages, dependencyReceipts: [] })));
      expect(result.status).toBe("complete"); expect(result.ownerId).toBe(ownerId);
      widths.push(result.members.length);
      for (const member of result.members) {
        expect(member.status).toBe("completed"); expect(member.reply).not.toBeNull();
        waveReplies.push(member.reply!); attemptIds.add(member.attemptId);
      }
    }
    expect(wave.summary).toMatchObject({ plannedJobs: count, completedJobs: count, campaignCalls: count,
      waves: 120, session: 23, wavesThisSession: 5, halted: false, resumable: false });
  } finally { wave.close(); }
  expect(serialReplies).toHaveLength(count); expect(waveReplies).toHaveLength(count); expect(attemptIds.size).toBe(count);
  expect(serialSeen).toEqual(inventory.map((_, index) => index)); expect(waveSeen).toEqual(serialSeen);
  expect(canonicalSha256(waveReplies)).toBe(canonicalSha256(serialReplies));
  expect(waveReplies.every(row => row.result.status === "completed")).toBeTrue();
  expect(waveReplies.reduce((sum, row) => sum + row.usage.micros, 0)).toBe(serialReplies.reduce((sum, row) => sum + row.usage.micros, 0));
  expect(widths).toHaveLength(120); expect(widths.slice(0, -1).every(width => width === 4)).toBeTrue(); expect(widths.at(-1)).toBe(2);
  expect(waveReadJournal(waveFixture.journalPath).filter(row => row.kind === "session")).toHaveLength(24);
  for (const f of [serialFixture, waveFixture]) {
    expect(ledger(f).filter(row => row.kind === "reserved")).toHaveLength(count);
    expect(ledger(f).filter(row => row.kind === "settled")).toHaveLength(count);
    expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
  }
  expect(replay(waveFixture)).toMatchObject({ status: "complete", plannedJobs: count, completedJobs: count, attemptedCalls: count, providerCalls: 0, resumable: false });
}, 30000);

const faults: readonly { point: ApiWaveBoundary; reservations: number; sends: number; settlements: number; checkpoints: number; rejects: boolean }[] = [
  { point: "wave-intent", reservations: 0, sends: 0, settlements: 0, checkpoints: 0, rejects: true },
  { point: "request-capture", reservations: 0, sends: 0, settlements: 0, checkpoints: 0, rejects: true },
  { point: "before-reservation", reservations: 0, sends: 0, settlements: 0, checkpoints: 0, rejects: true },
  { point: "reservation", reservations: 1, sends: 0, settlements: 0, checkpoints: 0, rejects: true },
  { point: "send-permit", reservations: 4, sends: 0, settlements: 0, checkpoints: 0, rejects: false },
  { point: "fetch-start", reservations: 4, sends: 0, settlements: 0, checkpoints: 0, rejects: false },
  { point: "response-capture", reservations: 4, sends: 4, settlements: 3, checkpoints: 3, rejects: false },
  { point: "result-capture", reservations: 4, sends: 4, settlements: 3, checkpoints: 3, rejects: false },
  { point: "settlement", reservations: 4, sends: 4, settlements: 4, checkpoints: 3, rejects: false },
  { point: "checkpoint", reservations: 4, sends: 4, settlements: 4, checkpoints: 4, rejects: false },
];
for (const fault of faults) test(`fault after ${fault.point} retains the durable prefix and never retries`, async () => {
  const f = fixture(); let calls = 0, injected = false;
  const transport = await open(f, fakeFetch(async () => { calls++; return reply(); }), { onBoundary(point, identity) {
    if (!injected && point === fault.point && (identity.jobId === null || identity.jobId === "job-0")) {
      injected = true; throw Error(`invented fault at ${point}`);
    }
  } });
  try {
    if (fault.rejects) await expect(transport.invokeWave(submissions(f))).rejects.toThrow("invented fault");
    else expect((await transport.invokeWave(submissions(f))).status).toBe("stopped");
    expect(injected).toBeTrue(); expect(calls).toBe(fault.sends);
    expect(ledger(f).filter(row => row.kind === "reserved")).toHaveLength(fault.reservations);
    expect(ledger(f).filter(row => row.kind === "settled")).toHaveLength(fault.settlements);
    expect(readdirSync(f.run).filter(name => name.endsWith(".checkpoint.json"))).toHaveLength(fault.checkpoints);
    const before = ledger(f), names = captures(f);
    await expect(transport.invokeWave(submissions(f))).rejects.toThrow("halted");
    expect(ledger(f)).toEqual(before); expect(captures(f)).toEqual(names); expect(calls).toBe(fault.sends);
  } finally { transport.close(); }
  expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
});

test("owner and session-close faults release only their own lock without dispatch or reopening", async () => {
  for (const fault of ["owner", "session-close"] as const) {
    const f = fixture({ count: 1 }); let calls = 0;
    const fetcher = fakeFetch(async () => { calls++; return reply(); });
    const options = { onBoundary(point: ApiWaveBoundary) { if (point === fault) throw Error(`invented ${fault} fault`); } };
    if (fault === "owner") await expect(open(f, fetcher, options)).rejects.toThrow("invented owner");
    else { const transport = await open(f, fetcher, options); expect(() => transport.close()).toThrow("invented session-close"); expect(transport.summary.closed).toBeTrue(); }
    expect(calls).toBe(0); expect(ledger(f)).toEqual([]); expect(existsSync(f.ledgerPath + ".lock")).toBeFalse();
    await expect(open(f, fetcher)).rejects.toThrow("fresh empty");
  }
});
