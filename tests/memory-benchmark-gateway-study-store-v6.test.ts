import { afterEach, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sha256Hex } from "../src/canonical";
import type { Corpus, Question } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { makeGatewayReaderJobs, type GatewayReaderJob } from "../scripts/benchmarks/gateway-study-plan-v3";
import { completeGatewayV6Reader } from "../scripts/benchmarks/gateway-study-plan-v6";
import { gatewayReservation } from "../scripts/benchmarks/gateway-study-store-v3";
import { gatewayV5JobPending, openGatewayStudyV5Store, readGatewayV5SavedJob } from "../scripts/benchmarks/gateway-study-store-v5";
import { gatewayV6JobPending, openGatewayStudyV6Store, readGatewayV6SavedJob } from "../scripts/benchmarks/gateway-study-store-v6";
import { GatewayStudyBudget, gatewayStudyLedgerExposure, type GatewayStudyFetcher } from "../scripts/benchmarks/gateway-study-transport-v3";
import { invokeGatewayStudyV5 } from "../scripts/benchmarks/gateway-study-transport-v5";
import { invokeGatewayStudyV6 } from "../scripts/benchmarks/gateway-study-transport-v6";
import { buildExtractionChunks } from "../scripts/benchmarks/units";

const freeze = sha256Hex("gateway-v6-store-synthetic-freeze"), prior = 18_268_639;
const partial = "SYNTHETIC_PARTIAL_ANSWER_PRESERVED_ONLY_AS_RAW";
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function directory() {
  const p = await realpath(await mkdtemp(join(tmpdir(), "gateway-v6-store-synthetic-")));
  await chmod(p, 0o700); temporary.push(p); return p;
}
async function fixture() {
  const corpus: Corpus = { id: "synthetic-corpus", groupId: "synthetic-group", turns: [
    { id: "turn-0", sessionId: "session-0", date: "2026-01-01", speaker: "Casey", text: "Casey owns a bicycle." },
  ] };
  const question: Question = { id: "synthetic-question", corpusId: corpus.id, category: "single-session-user",
    question: "What does Casey own?", questionDate: "2026-01-02", answer: "SYNTHETIC_GOLD",
    unanswerable: false, evidenceTurnIds: ["turn-0"], evidenceSessionIds: ["session-0"] };
  const memory = [{ corpusId: corpus.id, corpusSha256: corpusIdentity(corpus),
    chunks: buildExtractionChunks(corpus).map(chunk => ({ id: chunk.id, units: [], rejected: 0 })) }];
  const jobs = await makeGatewayReaderJobs({ corpora: [corpus], questions: [question], memory });
  return { job: jobs[0]!, question };
}
function envelope(job: GatewayReaderJob, finish = "length", output = 512) {
  return { model: job.request.model,
    choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: partial, refusal: null } }],
    usage: { prompt_tokens: 20, completion_tokens: output, total_tokens: 20 + output },
    providerMetadata: { gateway: { routing: { originalModelId: job.request.model, canonicalSlug: job.request.model,
      resolvedProvider: "openai", finalProvider: "openai", modelAttemptCount: 1, totalProviderAttemptCount: 1,
      modelAttempts: [{ canonicalSlug: job.request.model, success: true, providerAttemptCount: 1,
        providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } };
}
async function runStored(store: Awaited<ReturnType<typeof openGatewayStudyV6Store>>, job: GatewayReaderJob,
  fetcher: GatewayStudyFetcher = async () => Response.json(envelope(job))) {
  const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1, priorExposureMicros: prior });
  await store.begin(job);
  const result = await invokeGatewayStudyV6({ request: job.request, oidcToken: "synthetic-only",
    reservationId: job.key, budget, record: event => store.record(job, event), capture: raw => store.capture(job, raw), fetcher });
  await store.complete(job, result); return { result, budget };
}

describe("Gateway v6 durable terminal reader outcomes", () => {
  test("captures, settles and replays a new terminal failure without accepting its partial answer or retrying", async () => {
    const p = await directory(), { job, question } = await fixture(), store = await openGatewayStudyV6Store(p, freeze);
    let calls = 0;
    const { result, budget } = await runStored(store, job, async () => { calls++; return Response.json(envelope(job)); });
    expect(calls).toBe(1); expect(result.kind).toBe("terminal-reader-failure");
    const row = completeGatewayV6Reader(job, question, result);
    expect(row.status).toBe("terminal-reader-failure"); expect(row).not.toHaveProperty("prediction");
    expect(row).not.toHaveProperty("tokenF1"); expect(JSON.stringify(row)).not.toContain(partial);
    expect(store.events.map(e => e.kind)).toEqual(["reserved", "settled"]);
    expect(gatewayStudyLedgerExposure(store.events)).toBe(result.usage.micros);
    expect(budget.summary.accountedUsd).toBe((prior + result.usage.micros) / 1e6);
    expect(await store.lookup(job)).toEqual(result);
    await expect(store.begin(job)).rejects.toThrow("occupied first response");
    await store.close();
    const reopened = await openGatewayStudyV6Store(p, freeze);
    try {
      expect(reopened.exposure).toBe(result.usage.micros);
      expect(await reopened.lookup(job)).toEqual(result);
      expect(await readGatewayV6SavedJob(p, freeze, job, reopened.events)).toEqual(result);
      await expect(reopened.begin(job)).rejects.toThrow("occupied first response");
      const files = (await readdir(join(p, "jobs", job.key))).sort();
      expect(files).toEqual(["pending.json", "reserved.json", "response.body", "response.json", "result.json", "settled.json"]);
      expect(await readFile(join(p, "jobs", job.key, "result.json"), "utf8")).not.toContain(partial);
      expect(await readFile(join(p, "jobs", job.key, "response.body"), "utf8")).toContain(partial);
    } finally { await reopened.close(); }
    await expect(lstat(join(p, "active.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("raw bytes, metadata, policy projection and ledger evidence must agree on replay", async () => {
    const { job } = await fixture();
    for (const file of ["response.body", "response.json", "reserved.json", "settled.json", "result.json", "pending.json"]) {
      const p = await directory(), store = await openGatewayStudyV6Store(p, freeze);
      await runStored(store, job); const events = store.events; await store.close();
      await writeFile(join(p, "jobs", job.key, file), "{}\n", { mode: 0o600 });
      await expect(readGatewayV6SavedJob(p, freeze, job, events)).rejects.toThrow();
    }
    const p = await directory(), store = await openGatewayStudyV6Store(p, freeze);
    await runStored(store, job); const events = store.events; await store.close();
    await expect(readGatewayV6SavedJob(p, freeze, job, events.slice(0, 1))).rejects.toThrow("ledger job binding");
    await expect(readGatewayV6SavedJob(p, sha256Hex("wrong-freeze"), job, events)).rejects.toThrow("pending request changed");
    const path = join(p, "jobs", job.key, "result.json");
    const projection = JSON.parse(await readFile(path, "utf8"));
    projection.result.policySha256 = sha256Hex("forged-policy");
    await writeFile(path, JSON.stringify(projection) + "\n", { mode: 0o600 });
    await expect(readGatewayV6SavedJob(p, freeze, job, events)).rejects.toThrow("saved response projection changed");
  });

  test("out-of-policy truncation remains an occupied four-file capture with a retained reservation", async () => {
    const p = await directory(), { job } = await fixture(), store = await openGatewayStudyV6Store(p, freeze);
    let calls = 0;
    await expect(runStored(store, job, async () => { calls++; return Response.json(envelope(job, "length", 511)); })).rejects.toThrow();
    expect(calls).toBe(1); expect(store.events.map(e => e.kind)).toEqual(["reserved"]);
    expect(gatewayStudyLedgerExposure(store.events)).toBe(gatewayReservation(job).micros);
    expect((await readdir(join(p, "jobs", job.key))).sort()).toEqual(["pending.json", "reserved.json", "response.body", "response.json"]);
    await expect(store.lookup(job)).rejects.toThrow("incomplete or unexpected");
    await expect(store.begin(job)).rejects.toThrow("occupied first response");
    await store.close();
    const reopened = await openGatewayStudyV6Store(p, freeze);
    try {
      await expect(reopened.lookup(job)).rejects.toThrow("incomplete or unexpected");
      await expect(reopened.begin(job)).rejects.toThrow("occupied first response");
      expect(reopened.exposure).toBe(gatewayReservation(job).micros);
    } finally { await reopened.close(); }
  });

  test("a v6 adapter cannot reclassify or settle an old v5 failure in place", async () => {
    const p = await directory(), { job } = await fixture(), old = await openGatewayStudyV5Store(p, freeze);
    const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 });
    await old.begin(job);
    await expect(invokeGatewayStudyV5({ request: job.request, oidcToken: "synthetic-only", reservationId: job.key, budget,
      record: e => old.record(job, e), capture: raw => old.capture(job, raw),
      fetcher: async () => Response.json(envelope(job)) })).rejects.toThrow("outside the exact-cap extraction policy");
    const events = old.events; await old.close();
    const ledger = await readFile(join(p, "ledger.jsonl"));
    expect(events).toHaveLength(1);
    await expect(readGatewayV6SavedJob(p, freeze, job, events)).rejects.toThrow("incomplete or unexpected");
    await expect(openGatewayStudyV6Store(p, freeze)).rejects.toThrow("store header changed");
    expect(await readFile(join(p, "ledger.jsonl"))).toEqual(ledger);
    expect((await readdir(join(p, "jobs", job.key))).sort()).toEqual(["pending.json", "reserved.json", "response.body", "response.json"]);
  });

  test("versioned headers and pending identities isolate ordinary and terminal results", async () => {
    const { job } = await fixture();
    expect(gatewayV6JobPending(job, freeze)).toEqual({ ...gatewayV5JobPending(job, freeze), protocol: "oh.memory-gateway-store.v6" });
    for (const finish of ["stop", "length"]) {
      const p = await directory(), store = await openGatewayStudyV6Store(p, freeze);
      await runStored(store, job, async () => Response.json(envelope(job, finish, finish === "stop" ? 2 : 512)));
      const events = store.events; await store.close();
      await expect(readGatewayV5SavedJob(p, freeze, job, events)).rejects.toThrow("pending request changed");
      await expect(openGatewayStudyV5Store(p, freeze)).rejects.toThrow("store header changed");
    }
    const p = await directory(), old = await openGatewayStudyV5Store(p, freeze); await old.close();
    await expect(openGatewayStudyV6Store(p, freeze)).rejects.toThrow("store header changed");
  });
});
