import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical";
import { gatewayReservation } from "../scripts/benchmarks/gateway-study-store-v3";
import { GatewayStudyBudget, gatewayStudyLedgerExposure, makeGatewayStudyRequest,
  type GatewayStudyRequest, type GatewayStudyLedgerEvent } from "../scripts/benchmarks/gateway-study-transport-v3";
import { invokeGatewayStudyV6 } from "../scripts/benchmarks/gateway-study-transport-v6";
import { openLabPaidCache } from "../scripts/benchmarks/lab-paid-cache";
import { executeLabPaidPhase, LabPaidAdmissionStopped } from "../scripts/benchmarks/lab-paid-executor";

const namespace = sha256Hex("synthetic-paid-executor-namespace"), paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
/** Deadlines only reject broken coordination; they never release synthetic requests. */
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Synthetic executor coordination did not finish.")), 3_000);
  })]); } finally { clearTimeout(timer); }
}
function requests(count: number, phase: "reader" | "judge" = "reader") {
  return Array.from({ length: count }, (_, i) => makeGatewayStudyRequest({ phase, messages: [
    { role: "system", content: "Follow synthetic instructions." }, { role: "user", content: `Synthetic question ${i}` },
  ] }));
}
/** Same accepted native envelope as the cache fixture, with no provider involved. */
function envelope(input: GatewayStudyRequest, finish = "stop", outputTokens = 2) {
  return { model: input.model, choices: [{ index: 0, finish_reason: finish,
    message: { role: "assistant", content: "SYNTHETIC_CAPTURE_TEXT", refusal: null } }],
    usage: { prompt_tokens: 20, completion_tokens: outputTokens, total_tokens: 20 + outputTokens },
    providerMetadata: { gateway: { routing: { originalModelId: input.model, canonicalSlug: input.model,
      resolvedProvider: "openai", finalProvider: "openai", modelAttemptCount: 1, totalProviderAttemptCount: 1,
      modelAttempts: [{ canonicalSlug: input.model, success: true, providerAttemptCount: 1,
        providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } };
}
type Snapshot = { key: string; events: readonly GatewayStudyLedgerEvent[]; durableReservation: unknown;
  accountedMicros: number; reservedCalls: number };
async function harness(inputs: readonly GatewayStudyRequest[], limits: { maxUsd?: number; maxCalls?: number; prior?: number } = {}) {
  const path = await realpath(await mkdtemp(join(tmpdir(), "oh-paid-executor-synthetic-")));
  await chmod(path, 0o700); paths.push(path);
  const cache = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
  const prior = limits.prior ?? 0;
  const budget = new GatewayStudyBudget({ maxUsd: limits.maxUsd ?? 40, maxCalls: limits.maxCalls ?? 100, priorExposureMicros: prior });
  const arrivals = inputs.map(() => deferred<void>()), replies = inputs.map(() => deferred<Response>());
  const snapshots: Snapshot[] = [], fetched: number[] = [], failed = deferred<unknown>();
  const pending: Promise<unknown>[] = []; let active = 0, peak = 0, qualified = 0;
  const invoke: typeof invokeGatewayStudyV6 = options => {
    const index = inputs.findIndex(input => input.requestSha256 === options.request.requestSha256);
    if (index < 0) throw new Error("Unplanned synthetic request.");
    const response = invokeGatewayStudyV6({ ...options, fetcher: async () => {
      fetched.push(index); active += 1; peak = Math.max(peak, active);
      try {
        snapshots.push({ key: options.reservationId, events: [...cache.events],
          durableReservation: JSON.parse(await readFile(join(path, "jobs", options.reservationId, "reserved.json"), "utf8")),
          accountedMicros: Math.round(budget.summary.accountedUsd * 1_000_000), reservedCalls: budget.summary.reservedCalls });
        arrivals[index]!.resolve();
        return await replies[index]!.promise;
      } finally { active -= 1; }
    } });
    pending.push(response);
    return response.catch(error => { failed.resolve(error); throw error; });
  };
  let running: ReturnType<typeof executeLabPaidPhase> | undefined;
  return { path, cache, budget, snapshots, fetched, prior,
    get active() { return active; }, get peak() { return peak; }, get qualified() { return qualified; },
    arrived: (index: number) => bounded(arrivals[index]!.promise), failed: () => bounded(failed.promise),
    reply: (index: number, value = Response.json(envelope(inputs[index]!))) => replies[index]!.resolve(value),
    start(concurrency = 4, stopped = () => false) {
      running = executeLabPaidPhase({ requests: inputs, cache, budget, concurrency,
        oidcToken: "synthetic-only", qualify: () => { qualified += 1; }, stopped, invoke });
      // Preserve the original promise for assertions without an unhandled rejection during cleanup.
      void running.catch(() => undefined); return running;
    },
    async close() {
      replies.forEach((reply, index) => reply.resolve(Response.json(envelope(inputs[index]!))));
      if (running) await bounded(running.catch(() => undefined));
      await bounded(Promise.allSettled(pending)); await cache.close();
    },
  };
}
function assertPrefetch(h: Awaited<ReturnType<typeof harness>>) {
  for (const snapshot of h.snapshots) {
    const reservation = snapshot.events.find(event => event.kind === "reserved" && event.id === snapshot.key);
    expect(reservation).toBeDefined();
    expect(snapshot.durableReservation).toEqual(reservation);
    expect(snapshot.reservedCalls).toBeGreaterThanOrEqual(snapshot.events.filter(event => event.kind === "reserved").length);
    expect(snapshot.accountedMicros).toBeGreaterThanOrEqual(h.prior + gatewayStudyLedgerExposure(snapshot.events));
  }
}

describe("paid lab executor with durable cache and native budget", () => {
  test("refills a free slot while a slow sibling is held, with every fetch durably reserved", async () => {
    const input = requests(6), h = await harness(input);
    try {
      const running = h.start(3);
      await Promise.all([h.arrived(0), h.arrived(1), h.arrived(2)]);
      expect(h.active).toBe(3); expect(h.budget.summary.reservedCalls).toBe(3);
      h.reply(1); await h.arrived(3);
      expect(h.active).toBe(3); expect(h.fetched).toEqual([0, 1, 2, 3]);
      expect(h.cache.events.some(event => event.kind === "settled" && event.id === h.cache.job(input[0]!).key)).toBe(false);
      h.reply(2); await h.arrived(4); h.reply(3); await h.arrived(5);
      h.reply(4); h.reply(5); h.reply(0);
      const result = await bounded(running);
      expect(result.complete).toBe(true); expect(result.execution.errors).toHaveLength(0);
      expect(result.execution.startedKeys).toEqual(input.map(request => h.cache.job(request).key));
      expect(h.peak).toBe(3); expect(h.active).toBe(0); expect(h.fetched).toHaveLength(6);
      expect(h.cache.events.filter(event => event.kind === "reserved")).toHaveLength(6);
      expect(h.cache.events.filter(event => event.kind === "settled")).toHaveLength(6);
      expect(result.budget.unresolvedThisRunUsd).toBe(0); assertPrefetch(h);
    } finally { await h.close(); }
  });

  test("a known spending cap and an external stop create no pending jobs or reservations", async () => {
    for (const stopped of [false, true]) {
      const input = requests(3), reserve = gatewayReservation({ key: sha256Hex("synthetic-reservation"), ordinal: 0, phase: "reader", request: input[0]! });
      const h = await harness(input, { prior: stopped ? 0 : 40_000_000 - reserve.micros + 1 });
      try {
        const result = await bounded(h.start(3, () => stopped));
        expect(result.complete).toBe(false); expect(h.fetched).toHaveLength(0);
        expect(h.cache.keys()).toHaveLength(0); expect(h.cache.events).toHaveLength(0);
        expect(result.budget.reservedCalls).toBe(0); expect(await readdir(join(h.path, "jobs"))).toHaveLength(0);
        if (!stopped) expect(result.execution.errors[0]!.error).toBeInstanceOf(LabPaidAdmissionStopped);
      } finally { await h.close(); }
    }
  });

  test("the shared call limit stops concurrent admission before other pending directories are created", async () => {
    const input = requests(5), h = await harness(input, { maxCalls: 1 });
    try {
      const running = h.start(4); await h.arrived(0);
      expect(h.cache.keys()).toEqual([h.cache.job(input[0]!).key]);
      h.reply(0); const result = await bounded(running);
      expect(result.complete).toBe(false); expect(h.fetched).toEqual([0]);
      expect(result.budget.reservedCalls).toBe(1); expect(result.budget.unresolvedThisRunUsd).toBe(0);
      expect(h.cache.keys()).toHaveLength(1); expect(await readdir(join(h.path, "jobs"))).toHaveLength(1);
      expect(h.cache.events).toHaveLength(2);
      expect(result.execution.errors.every(entry => entry.error instanceof LabPaidAdmissionStopped)).toBe(true);
      assertPrefetch(h);
    } finally { await h.close(); }
  });

  test("a reopened all-hit phase authenticates cache bytes and makes no new reservation or invocation", async () => {
    const input = requests(2), h = await harness(input);
    let first: Awaited<ReturnType<typeof executeLabPaidPhase>>;
    try { const running = h.start(2); h.reply(0); h.reply(1); first = await bounded(running); }
    finally { await h.close(); }
    const ledger = await readFile(join(h.path, "ledger.jsonl"));
    const cache = await openLabPaidCache({ directory: h.path, namespaceSha256: namespace });
    try {
      const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1, priorExposureMicros: cache.exposure });
      let invokes = 0, qualifies = 0;
      const result = await executeLabPaidPhase({ requests: input, cache, budget, concurrency: 4,
        oidcToken: "synthetic-only", stopped: () => false, qualify: () => { qualifies += 1; },
        invoke: () => { invokes += 1; throw new Error("Cache hit dispatched."); } });
      expect(result.complete).toBe(true); expect(result.responses).toEqual(first!.responses);
      expect(result.cachedKeys).toEqual(input.map(request => cache.job(request).key));
      expect(result.execution.startedKeys).toHaveLength(0); expect(invokes).toBe(0); expect(qualifies).toBe(0);
      expect(result.budget.reservedCalls).toBe(0); expect(result.budget.accountedUsd).toBe(cache.exposure / 1_000_000);
      expect(await readFile(join(h.path, "ledger.jsonl"))).toEqual(ledger);
    } finally { await cache.close(); }
  });

  test("occupied incomplete preflight forbids dispatching earlier or later misses", async () => {
    const input = requests(3), h = await harness(input);
    try {
      await h.cache.begin(input[1]!);
      await expect(h.start(3)).rejects.toThrow("incomplete or unexpected");
      expect(h.cache.keys()).toEqual([h.cache.job(input[1]!).key]);
      expect(h.cache.events).toHaveLength(0); expect(h.fetched).toHaveLength(0); expect(h.qualified).toBe(0);
      expect(h.budget.summary.reservedCalls).toBe(0);
    } finally { await h.close(); }
  });

  test("malformed transport stops admission, drains held siblings, and retains its reservation without retry", async () => {
    const input = requests(6), h = await harness(input);
    try {
      let returned = false;
      const running = h.start(3).then(value => { returned = true; return value; });
      await Promise.all([h.arrived(0), h.arrived(1), h.arrived(2)]);
      h.reply(0, Response.json({ malformed: true })); await h.failed();
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(returned).toBe(false); expect(h.active).toBe(2); expect(h.fetched).toEqual([0, 1, 2]);
      expect(h.cache.events.filter(event => event.kind === "settled")).toHaveLength(0);
      h.reply(1); h.reply(2); const result = await bounded(running);
      expect(result.complete).toBe(false); expect(result.execution.errors).toHaveLength(1);
      expect(result.execution.pendingKeys).toEqual(input.slice(3).map(request => h.cache.job(request).key));
      expect(result.responses.size).toBe(2); expect(h.fetched).toEqual([0, 1, 2]); expect(h.active).toBe(0);
      const held = gatewayReservation(h.cache.job(input[0]!)).micros;
      expect(result.budget.unresolvedThisRunUsd).toBe(held / 1_000_000);
      expect(h.cache.events.filter(event => event.kind === "reserved")).toHaveLength(3);
      expect(h.cache.events.filter(event => event.kind === "settled")).toHaveLength(2);
      expect((await readdir(join(h.path, "jobs", h.cache.job(input[0]!).key))).sort())
        .toEqual(["pending.json", "reserved.json", "response.body", "response.json"]);
      const ledger = await readFile(join(h.path, "ledger.jsonl"));
      await expect(h.start(3)).rejects.toThrow("incomplete or unexpected");
      expect(h.fetched).toEqual([0, 1, 2]); expect(await readFile(join(h.path, "ledger.jsonl"))).toEqual(ledger);
      assertPrefetch(h);
    } finally { await h.close(); }
  });

  test("an authenticated exact-cap reader failure is cleanly settled and cached without accepted partial text", async () => {
    const input = requests(2), h = await harness(input);
    try {
      const running = h.start(2); h.reply(0, Response.json(envelope(input[0]!, "length", 512))); h.reply(1);
      const result = await bounded(running), failed = result.responses.get(h.cache.job(input[0]!).key)!;
      expect(result.complete).toBe(true); expect(result.execution.errors).toHaveLength(0);
      expect(failed.kind).toBe("terminal-reader-failure"); expect(JSON.stringify(failed)).not.toContain("SYNTHETIC_CAPTURE_TEXT");
      expect(result.budget.unresolvedThisRunUsd).toBe(0); expect(h.cache.events).toHaveLength(4);
      expect(await h.cache.lookup(input[0]!)).toEqual(failed);
      expect((await readdir(join(h.path, "jobs", h.cache.job(input[0]!).key))).sort())
        .toEqual(["pending.json", "reserved.json", "response.body", "response.json", "result.json", "settled.json"]);
      const ledger = await readFile(join(h.path, "ledger.jsonl")), again = await h.start(2);
      expect(again.complete).toBe(true); expect(again.cachedKeys).toHaveLength(2); expect(h.fetched).toHaveLength(2);
      expect(await readFile(join(h.path, "ledger.jsonl"))).toEqual(ledger);
    } finally { await h.close(); }
  });
});
