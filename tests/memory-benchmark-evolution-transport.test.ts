import { test, expect } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeEvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { invokeEvolutionRequest } from "../scripts/benchmarks/evolution-transport";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";

const campaign = (storeDirectory: string): EvolutionCampaign => ({ protocol: "oh.memory.evolution-campaign.v1", campaignId: "transport-test", storeDirectory, approval: "Test fixture only",
  additionalBudgetMicros: 100_000, maximumCalls: 10, historicalExposureMicros: 0,
  historicalLedgers: [{ path: "/tmp/fixture-ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/tmp/fixture-auth", sha256: "b".repeat(64) } });
const request = () => makeEvolutionRequest("gpt4o-official-snapshot-judge", [{ role: "user", content: "Is the answer correct?" }]);
const body = () => new TextEncoder().encode(JSON.stringify({ model: "gpt-4o-2024-08-06", choices: [{ index: 0, finish_reason: "stop",
  message: { role: "assistant", content: "yes" } }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }));
const credential = { kind: "benchmark-openai-key" as const, token: "fixture-never-sent" };

test("concurrent identical requests dispatch once and settle once", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-evolution-transport-")));
  const store = await openEvolutionStore({ directory, campaign: campaign(directory) });
  let calls = 0;
  try {
    const send = () => invokeEvolutionRequest({ request: request(), store, credential,
      fetcher: async () => { calls++; await Promise.resolve(); return new Response(body()); } });
    const results = await Promise.allSettled([send(), send()]);
    expect(calls).toBe(1); expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(store.summary()).toMatchObject({ calls: 1, confirmedMicros: 35, unresolvedMicros: 0 });
    const dispatched = results.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof send>>> => result.status === "fulfilled")!;
    expect(dispatched.value.serviceMs).toBeGreaterThanOrEqual(0);
    expect(store.readServiceMs(request())).toBe(dispatched.value.serviceMs);
    expect((await send()).cached).toBeTrue(); expect(calls).toBe(1);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("captured valid response recovers without credentials or a new physical call", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-evolution-recovery-")));
  const store = await openEvolutionStore({ directory, campaign: campaign(directory) });
  try {
    const req = request(), raw = body(); store.admit(req);
    store.capture(req, { body: raw, complete: true, receivedBytes: raw.length, httpStatus: 200, error: null });
    const result = await invokeEvolutionRequest({ request: req, store, credential: { ...credential, token: "" }, fetcher: async () => { throw new Error("No network permitted"); } });
    expect(result.recovered).toBeTrue(); expect(result.result.answer).toBe("yes"); expect(store.summary().calls).toBe(1);
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});

test("network failure preserves first capture and full charge without retry", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-evolution-failure-")));
  const store = await openEvolutionStore({ directory, campaign: campaign(directory) }); let calls = 0;
  try {
    const req = request();
    const send = () => invokeEvolutionRequest({ request: req, store, credential, fetcher: async () => { calls++; throw new Error("fixture failure"); } });
    await expect(send()).rejects.toThrow(); await expect(send()).rejects.toThrow();
    expect(calls).toBe(1); expect(store.summary()).toMatchObject({ calls: 1, exposureMicros: req.reservationMicros, unresolvedMicros: req.reservationMicros });
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
