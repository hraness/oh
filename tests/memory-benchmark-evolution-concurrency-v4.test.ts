import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DATASETS } from "../scripts/benchmarks/datasets";
import { parseEvolutionRunConfig, validateEvolutionContextRunVersion } from "../scripts/benchmarks/evolution";
import { makeEvolutionExperimentContextPlan, makeEvolutionReaderPlan, validateEvolutionReaderPlan } from "../scripts/benchmarks/evolution-plan";
import { EVOLUTION_PAID_QUEUE_V2_PROTOCOL, runLabPaidQueue, runLabPaidQueueV2 } from "../scripts/benchmarks/lab-paid-queue";
import { makeEvolutionProfileWindowRequest, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { invokeEvolutionRequest, type EvolutionCredential } from "../scripts/benchmarks/evolution-transport";
const fetchBefore = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("network forbidden"); }, { preconnect() { throw Error("network forbidden"); } }); });
afterAll(() => { globalThis.fetch = fetchBefore; });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const protocol = EVOLUTION_PAID_QUEUE_V2_PROTOCOL;
const configs = [
  { protocol: "oh.memory.evolution-run.v1", variants: [{ id: "native", system: "oh-keyword", budget: { topK: 100, contextBytes: 96000 } }] },
  { protocol: "oh.memory.evolution-run.v2", variants: [{ id: "span", system: "oh-source-spans", budget: { topK: 100, contextBytes: 48000 } }] },
  { protocol: "oh.memory.evolution-run.v3", variants: [{ id: "full", system: "full-history" }] },
] as const;
const common = { dataset: "longmemeval-s", datasetPin: { path: "/fixture/data", sha256: DATASETS["longmemeval-s"].sha256 },
  manifestPin: { path: "/fixture/manifest", sha256: "a".repeat(64) }, campaignPin: { path: "/fixture/campaign", sha256: "b".repeat(64) },
  limit: 1, seed: 17, readers: ["gpt5-nano-reader"], judge: "gpt4o-gateway-native-rubric-16-judge-v1", directory: "/fixture/output", storeDirectory: "/fixture/store" } as const;
test("V4 prepared native, span and full-history context versions reach the reader plan while legacy mismatches fail", async () => {
  const dataset = { corpora: [{ id: "corpus-synthetic", turns: [{ id: "turn-1", sessionId: "session-1", date: "2026-01-01", speaker: "user", text: "My favorite color is blue." }] }],
    questions: [{ id: "question-synthetic", corpusId: "corpus-synthetic", question: "What is my favorite color?", questionDate: "2026-01-02" }] };
  for (const legacy of configs) {
    const config = parseEvolutionRunConfig({ ...common, ...legacy, protocol: "oh.memory.evolution-run.v4", concurrency: 24 });
    const { plan } = await makeEvolutionExperimentContextPlan({ dataset, variants: config.variants, manifestSha256: "a".repeat(64), retrievalSourceSha256: "b".repeat(64) });
    expect(plan.protocol.slice(-2)).toBe(legacy.protocol.slice(-2));
    expect(() => validateEvolutionContextRunVersion(plan, config)).not.toThrow();
    expect(() => validateEvolutionContextRunVersion(plan, legacy)).not.toThrow();
    for (const other of configs.filter(candidate => candidate.protocol !== legacy.protocol)) {
      expect(() => validateEvolutionContextRunVersion(plan, other)).toThrow("version");
    }
    const readers = makeEvolutionReaderPlan(plan, config.readers);
    expect(validateEvolutionReaderPlan(readers, plan)).toEqual(readers);
    expect(readers.cases).toHaveLength(1); expect(readers.requests).toHaveLength(1);
  }
});
test("V1-V3 retain their exact twelve-cap domain and V4 requires an explicit24/32", async () => {
  let calls = 0;
  for (const config of configs) {
    expect(parseEvolutionRunConfig({ ...common, ...config, concurrency: 12 })).toEqual({ ...common, ...config, concurrency: 12 });
    for (const concurrency of [0, 13, 24, 32]) expect(() => parseEvolutionRunConfig({ ...common, ...config, concurrency })).toThrow();
    for (const concurrency of [24, 32]) expect(parseEvolutionRunConfig({ ...common, ...config, protocol: "oh.memory.evolution-run.v4", concurrency }).concurrency).toBe(concurrency);
    for (const concurrency of [0, 1, 12, 13, 23, 25, 31, 33, 24.5, NaN, Infinity]) expect(() => parseEvolutionRunConfig({ ...common, ...config, protocol: "oh.memory.evolution-run.v4", concurrency })).toThrow();
  }
  for (const concurrency of [13, 24, 32]) await expect(runLabPaidQueue([{ key: "a" }], { concurrency, async execute() { calls++; } })).rejects.toThrow("through 12");
  for (const concurrency of [0, 12, 23, 25, 33]) await expect(runLabPaidQueueV2([{ key: "a" }], { protocol, concurrency, async execute() { calls++; } })).rejects.toThrow("24 or 32");
  await expect(runLabPaidQueueV2([{ key: "a" }], { protocol: "foreign" as any, concurrency: 24, async execute() { calls++; } })).rejects.toThrow();
  await expect(runLabPaidQueueV2([{ key: "same" }, { key: "same" }], { protocol, concurrency: 24, async execute() { calls++; } })).rejects.toThrow("unique");
  expect(calls).toBe(0);
});
test("24/32 refill released slots but preserve a hard peak and drain on external stop", async () => {
  for (const concurrency of [24, 32]) {
    const jobs = Array.from({ length: concurrency + 3 }, (_, index) => ({ key: `job-${index}`, index }));
    const gates = jobs.map(() => deferred<number>()), started = jobs.map(() => deferred<void>());
    let active = 0, peak = 0, stop = false;
    const pending = runLabPaidQueueV2(jobs, { protocol, concurrency, stopped: () => stop, async execute(job) {
      active++; peak = Math.max(peak, active); started[job.index]!.resolve();
      try { return await gates[job.index]!.promise; } finally { active--; }
    } });
    await Promise.all(started.slice(0, concurrency).map(g => g.promise)); expect(active).toBe(concurrency);
    gates[1]!.resolve(1); await started[concurrency]!.promise; expect(active).toBe(concurrency); stop = true;
    gates.forEach((g, i) => g.resolve(i)); const result = await pending;
    expect(peak).toBe(concurrency); expect(active).toBe(0);
    expect(result.startedKeys).toEqual(jobs.slice(0, concurrency + 1).map(j => j.key));
    expect(result.results.size).toBe(concurrency + 1); expect(result.errors).toEqual([]);
    expect(result.pendingKeys).toEqual(jobs.slice(concurrency + 1).map(j => j.key));
  }
});
test("24 concurrent first-attempt transports retain failed reservation and drain authenticated siblings before stopping", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-queue-v4-synthetic-")));
  const campaign = { protocol: "oh.memory.evolution-campaign.v1" as const, campaignId: "queue-v4-fixture", storeDirectory: directory,
    approval: "Synthetic no-provider qualification", additionalBudgetMicros: 1000000, maximumCalls: 40, historicalExposureMicros: 0,
    historicalLedgers: [{ path: "/fixture/ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/fixture/auth", sha256: "b".repeat(64) } };
  const auth = { method: "project-oidc" as const, project: "fixture-project", scope: "fixture-scope", environment: "development" as const };
  const encoded = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url"), now = Math.floor(Date.now() / 1000);
  const token = `${encoded({ alg: "RS256" })}.${encoded({ sub: "owner:fixture-scope:project:fixture-project:environment:development", aud: "https://vercel.com/fixture-scope", iss: "https://oidc.vercel.com/fixture-scope", exp: now + 600, iat: now })}.synthetic`;
  const credential: EvolutionCredential = { kind: "gateway-oidc", token, auth };
  const jobs = Array.from({ length: 40 }, (_, index) => { const request = makeEvolutionProfileWindowRequest("gpt5-nano-reader", [{ role: "system", content: "Synthetic memory only." }, { role: "user", content: `Synthetic question ${index}` }]); return { key: request.requestSha256, request, index }; });
  const gates = jobs.map(() => deferred<Response>()); let fetchCalls = 0, drained = false;
  function good(r: EvolutionRequest) { return new Response(JSON.stringify({ model: r.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "synthetic answer" } }],
    usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 }, providerMetadata: { gateway: { routing: { finalProvider: r.provider, originalModelId: r.model, canonicalSlug: r.model } } } })); }
  try {
    const store = await openEvolutionStore({ directory, campaign });
    try {
      const running = runLabPaidQueueV2(jobs, { protocol, concurrency: 24, execute: job => invokeEvolutionRequest({ request: job.request, store, credential,
        fetcher: async () => { fetchCalls++; return gates[job.index]!.promise; } }) });
      const observed = running.then(() => { drained = true; }); expect(fetchCalls).toBe(24); expect(store.summary().calls).toBe(24);
      gates[0]!.resolve(new Response('{"error":"synthetic bad request"}', { status: 400 }));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(drained).toBeFalse(); expect(fetchCalls).toBe(24);
      for (let i = 1; i < 24; i++) gates[i]!.resolve(good(jobs[i]!.request));
      const result = await running; await observed;
      expect(result.startedKeys).toEqual(jobs.slice(0, 24).map(j => j.key)); expect(result.results.size).toBe(23); expect(result.errors).toHaveLength(1);
      expect(result.pendingKeys).toEqual(jobs.slice(24).map(j => j.key)); expect(fetchCalls).toBe(24);
      expect(store.readAttemptFailure(jobs[0]!.request)).toMatchObject({ storeStatus: "captured", transport: { httpStatus: 400 }, reservationMicros: jobs[0]!.request.reservationMicros });
      expect(store.summary()).toMatchObject({ calls: 24, unresolvedMicros: jobs[0]!.request.reservationMicros });
      expect(store.summary().exposureMicros).toBeLessThanOrEqual(campaign.additionalBudgetMicros);
      await expect(invokeEvolutionRequest({ request: jobs[0]!.request, store, credential, fetcher: async () => { fetchCalls++; return good(jobs[0]!.request); } })).rejects.toThrow();
      expect(fetchCalls).toBe(24); expect(store.summary().calls).toBe(24);
    } finally { await store.close(); }
    const replay = await openEvolutionStore({ directory, campaign });
    try { expect(replay.summary().calls).toBe(24); expect(replay.lookup(jobs[0]!.request).kind).toBe("occupied");
      for (const job of jobs.slice(1, 24)) expect(replay.lookup(job.request).kind).toBe("hit"); }
    finally { await replay.close(); }
  } finally { await rm(directory, { recursive: true }); }
});

test("a32-slot queue cannot spend beyond the same synchronous shared reservation cap", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-queue-v4-budget-")));
  const campaign = { protocol: "oh.memory.evolution-campaign.v1" as const, campaignId: "queue-v4-budget", storeDirectory: directory,
    approval: "Synthetic no-provider budget test", additionalBudgetMicros: 50000, maximumCalls: 40, historicalExposureMicros: 0,
    historicalLedgers: [{ path: "/fixture/ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/fixture/auth", sha256: "b".repeat(64) } };
  const jobs = Array.from({ length: 40 }, (_, index) => { const request = makeEvolutionProfileWindowRequest("gpt5-nano-reader", [{ role: "system", content: "Synthetic only." }, { role: "user", content: `Budget fixture ${index}` }]); return { key: request.requestSha256, request }; });
  const gate = deferred<void>(); let admitted = 0;
  try {
    const store = await openEvolutionStore({ directory, campaign });
    try {
      const running = runLabPaidQueueV2(jobs, { protocol, concurrency: 32, async execute(job) { store.admit(job.request); admitted++; await gate.promise; return job.key; } });
      expect(admitted).toBe(2); expect(store.summary()).toMatchObject({ calls: 2, unresolvedMicros: 46554, exposureMicros: 46554 });
      gate.resolve(); const result = await running;
      expect(result.results.size).toBe(2); expect(result.errors).toHaveLength(30); expect(result.pendingKeys).toHaveLength(8);
      expect(admitted).toBe(2); expect(store.summary().exposureMicros).toBeLessThanOrEqual(campaign.additionalBudgetMicros);
      for (const job of jobs.slice(0, 2)) expect(store.readAttemptFailure(job.request)).toMatchObject({ storeStatus: "reserved", reservationMicros: 23277 });
    } finally { await store.close(); }
  } finally { await rm(directory, { recursive: true }); }
});
