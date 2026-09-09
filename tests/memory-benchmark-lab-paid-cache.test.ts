import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { GatewayJob } from "../scripts/benchmarks/gateway-study-plan-v3";
import { gatewayJobPending, gatewayReservation, gatewayStudyStoreInternals, openGatewayStudyStore,
  type GatewayStoreJob } from "../scripts/benchmarks/gateway-study-store-v3";
import { openGatewayStudyV5Store } from "../scripts/benchmarks/gateway-study-store-v5";
import { openGatewayStudyV6Store } from "../scripts/benchmarks/gateway-study-store-v6";
import { GatewayStudyBudget, gatewayStudyLedgerExposure, makeGatewayStudyRequest,
  type GatewayStudyRequest } from "../scripts/benchmarks/gateway-study-transport-v3";
import { invokeGatewayStudyV6 } from "../scripts/benchmarks/gateway-study-transport-v6";
import { labPaidCacheJob, openLabPaidCache } from "../scripts/benchmarks/lab-paid-cache";

const namespace = sha256Hex("synthetic-paid-cache-namespace"), paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "oh-paid-cache-synthetic-")));
  await chmod(path, 0o700); paths.push(path); return path;
}
function request(phase: "reader" | "judge" | "extract" = "reader", text = "Synthetic conversation question") {
  return makeGatewayStudyRequest({ phase, messages: [{ role: "system", content: "Follow synthetic instructions." },
    { role: "user", content: text }] });
}
function envelope(input: GatewayStudyRequest, finish = "stop", outputTokens = 2) {
  return { model: input.model, choices: [{ index: 0, finish_reason: finish,
    message: { role: "assistant", content: "SYNTHETIC_CAPTURE_TEXT", refusal: null } }],
    usage: { prompt_tokens: 20, completion_tokens: outputTokens, total_tokens: 20 + outputTokens },
    providerMetadata: { gateway: { routing: { originalModelId: input.model, canonicalSlug: input.model,
      resolvedProvider: "openai", finalProvider: "openai", modelAttemptCount: 1, totalProviderAttemptCount: 1,
      modelAttempts: [{ canonicalSlug: input.model, success: true, providerAttemptCount: 1,
        providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } };
}
async function complete(cache: Awaited<ReturnType<typeof openLabPaidCache>>, input: GatewayStudyRequest, finish = "stop", output = 2) {
  const job = cache.job(input), budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1, priorExposureMicros: cache.exposure });
  await cache.begin(input);
  const result = await invokeGatewayStudyV6({ request: input, reservationId: job.key, oidcToken: "synthetic-only",
    budget, record: event => cache.record(input, event), capture: raw => cache.capture(input, raw),
    fetcher: async () => Response.json(envelope(input, finish, output)) });
  await cache.complete(input, result); return result;
}

describe("paid development exact-request cache", () => {
  test("keys bind only namespace and canonical request; malformed profiles never enter storage", () => {
    const input = request(), job = labPaidCacheJob(namespace, input);
    expect(job).toEqual({ key: canonicalSha256({ namespaceSha256: namespace, requestSha256: input.requestSha256 }),
      ordinal: 0, phase: "reader", request: input });
    expect(labPaidCacheJob(namespace, structuredClone(input))).toEqual(job);
    expect(Object.isFrozen(job.request.body.messages)).toBe(true);
    expect(labPaidCacheJob(namespace, request("reader", "Changed question")).key).not.toBe(job.key);
    expect(labPaidCacheJob(sha256Hex("other policy namespace"), input).key).not.toBe(job.key);
    expect(labPaidCacheJob(namespace, request("judge")).key).not.toBe(job.key);
    expect(() => labPaidCacheJob("not-a-digest", input)).toThrow("namespace");
    expect(() => labPaidCacheJob(namespace, request("extract"))).toThrow("reader and judge");
    expect(() => labPaidCacheJob(namespace, { ...input, requestSha256: sha256Hex("forged") })).toThrow("canonical");
    expect(() => labPaidCacheJob(namespace, { ...input, maximumOutput: 256 })).toThrow("canonical");
  });

  test("ordinary reader and judge aliases reuse durable raw responses and one ledger charge after reopening", async () => {
    const path = await directory(), cache = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
    const reader = request(), judge = request("judge");
    expect(await cache.lookup(reader)).toBeNull();
    const result = await complete(cache, reader), judgment = await complete(cache, judge);
    expect(await cache.lookup(structuredClone(reader))).toEqual(result);
    expect(await cache.lookup(judge)).toEqual(judgment);
    expect(await cache.lookup(request("reader", "Different request"))).toBeNull();
    expect(cache.keys()).toHaveLength(2);
    expect(cache.events.filter(event => event.kind === "reserved")).toHaveLength(2);
    await expect(cache.begin(reader)).rejects.toThrow("occupied first response");
    const events = cache.events;
    expect(gatewayStudyLedgerExposure(events)).toBe(result.usage.micros + judgment.usage.micros);
    await cache.close();
    const ledger = await readFile(join(path, "ledger.jsonl"));
    const again = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
    try {
      expect(again.exposure).toBe(result.usage.micros + judgment.usage.micros);
      expect(await again.lookup(reader)).toEqual(result);
      expect(again.events).toEqual(events);
      expect(await readFile(join(path, "ledger.jsonl"))).toEqual(ledger);
    } finally { await again.close(); }
    expect(JSON.parse(await readFile(join(path, "store.json"), "utf8")))
      .toEqual({ protocol: "oh.memory-gateway-lab-cache.v1", freezeSha256: namespace });
  });

  test("valid exact-cap reader failures remain terminal cached outcomes without accepted partial text", async () => {
    const path = await directory(), cache = await openLabPaidCache({ directory: path, namespaceSha256: namespace }), input = request();
    const result = await complete(cache, input, "length", 512);
    expect(result.kind).toBe("terminal-reader-failure");
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_CAPTURE_TEXT");
    expect(await cache.lookup(input)).toEqual(result);
    await cache.close();
    const again = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
    try { expect(await again.lookup(input)).toEqual(result); } finally { await again.close(); }
    expect(await readFile(join(path, "jobs", cache.job(input).key, "response.body"), "utf8")).toContain("SYNTHETIC_CAPTURE_TEXT");
  });

  test("occupied pending or out-of-policy captures are failures rather than cache misses or retries", async () => {
    for (const captured of [false, true]) {
      const path = await directory(), cache = await openLabPaidCache({ directory: path, namespaceSha256: namespace }), input = request();
      if (captured) await expect(complete(cache, input, "length", 511)).rejects.toThrow();
      else await cache.begin(input);
      await expect(cache.lookup(input)).rejects.toThrow("incomplete or unexpected");
      await expect(cache.begin(input)).rejects.toThrow("occupied first response");
      await cache.close();
      const reopened = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
      try {
        expect(reopened.exposure).toBe(captured ? gatewayReservation(cache.job(input)).micros : 0);
        await expect(reopened.lookup(input)).rejects.toThrow("incomplete or unexpected");
        await expect(reopened.begin(input)).rejects.toThrow("occupied first response");
      } finally { await reopened.close(); }
    }
  });

  test("raw captures, pending identity, result projections and settlement evidence must all agree", async () => {
    for (const file of ["pending.json", "response.body", "response.json", "result.json", "reserved.json", "settled.json"]) {
      const path = await directory(), input = request(), cache = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
      await complete(cache, input); await cache.close();
      await writeFile(join(path, "jobs", cache.job(input).key, file), "{}\n", { mode: 0o600 });
      const reopened = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
      try { await expect(reopened.lookup(input)).rejects.toThrow(); } finally { await reopened.close(); }
    }
    const path = await directory(), input = request(), cache = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
    await complete(cache, input); const events = cache.events; await cache.close();
    await writeFile(join(path, "ledger.jsonl"), JSON.stringify(events[0]) + "\n", { mode: 0o600 });
    const reopened = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
    try { await expect(reopened.lookup(input)).rejects.toThrow("ledger job binding"); } finally { await reopened.close(); }
  });

  test("namespace and frozen-store profile boundaries reject incompatible existing directories", async () => {
    for (const mismatch of ["namespace", "profile"] as const) {
      const path = await directory(), cache = await openLabPaidCache({ directory: path, namespaceSha256: namespace });
      await complete(cache, request()); await cache.close();
      const ledger = await readFile(join(path, "ledger.jsonl"));
      if (mismatch === "namespace") await expect(openLabPaidCache({ directory: path, namespaceSha256: sha256Hex("changed") })).rejects.toThrow("header changed");
      else await expect(openGatewayStudyV6Store(path, namespace)).rejects.toThrow("header changed");
      expect(await readFile(join(path, "ledger.jsonl"))).toEqual(ledger);
    }
  });

  test("minimal jobs keep existing frozen pending bytes and all GatewayJob types assignable", async () => {
    const acceptsExisting = (job: GatewayJob): GatewayStoreJob => job;
    expect(typeof acceptsExisting).toBe("function");
    for (const [profile, opener] of [["oh.memory-gateway-store.v3", openGatewayStudyStore],
      ["oh.memory-gateway-store.v5", openGatewayStudyV5Store], ["oh.memory-gateway-store.v6", openGatewayStudyV6Store]] as const) {
      for (const phase of ["reader", "judge", "extract"] as const) {
        const input = request(phase), base = { key: sha256Hex(`${profile}:${phase}`), ordinal: 7, request: input };
        const job: GatewayStoreJob = phase === "extract" ? { ...base, phase, original: { key: sha256Hex("old parent"), ordinal: 3 } }
          : { ...base, phase };
        const expected = { protocol: profile, freezeSha256: namespace, jobKey: job.key, phase, ordinal: 7,
          originalParentOrdinal: phase === "extract" ? 3 : null, originalJobKey: phase === "extract" ? sha256Hex("old parent") : null,
          request: input };
        expect(gatewayStudyStoreInternals.jobPending(job, namespace, profile)).toEqual(expected);
        if (profile === "oh.memory-gateway-store.v3") expect(gatewayJobPending(job, namespace)).toEqual(expected);
        const path = await directory(), store = await opener(path, namespace);
        await store.begin(job);
        expect(await readFile(join(path, "jobs", job.key, "pending.json"), "utf8")).toBe(JSON.stringify(expected, null, 2) + "\n");
        await store.close();
      }
    }
  });
});
