import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { openLabReaderProfileCustody } from "../scripts/benchmarks/lab-reader-profile-custody";
import { invokeLabGpt5MiniReader } from "../scripts/benchmarks/lab-reader-profile-transport";
import { makeLabGpt5MiniReaderRequest, parseLabGpt5MiniReaderResponse, reserveLabGpt5MiniReader } from "../scripts/benchmarks/lab-reader-profile";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const request = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Use memory." }, { role: "user", content: "Memory: the bicycle is green. Question: What color is the bicycle?" }]);
async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "lab-profile-integrated-"))); roots.push(directory);
  const options = { directory, namespaceSha256: "a".repeat(64), ancestry: { priorExposureMicros: 23_223_035, fingerprint: "f".repeat(64), recheck: async () => {} },
    maxUsd: 24, maxCalls: 1, reserve: reserveLabGpt5MiniReader, parse: parseLabGpt5MiniReaderResponse };
  return { options, cache: await openLabReaderProfileCustody(options) };
}
function response(finishReason: "stop" | "length" = "stop") {
  return Response.json({ model: "gpt-5-mini", choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content: "Green." } }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    providerMetadata: { gateway: { routing: { finalProvider: "openai", originalModelId: "openai/gpt-5-mini", canonicalSlug: "openai/gpt-5-mini" } } } });
}

test("real cache and transport preserve first response through close/reopen without dispatch", async () => {
  const { options, cache } = await fixture(); let calls = 0;
  const invoke = { request, oidcToken: "fixture-token", qualify: async () => {}, fetcher: async () => { calls++; return response(); } };
  const first = await invokeLabGpt5MiniReader({ ...invoke, cache });
  expect(first).toMatchObject({ cached: false, result: { kind: "completed", prediction: "Green." } });
  expect(cache.events.map(e => e.kind)).toEqual(["reserved", "settled"]);
  expect(cache.exposureMicros).toBe(options.ancestry.priorExposureMicros + first.result.usage.micros);
  await cache.close();
  const reopened = await openLabReaderProfileCustody(options);
  try {
    expect(await invokeLabGpt5MiniReader({ ...invoke, cache: reopened })).toEqual({ cached: true, result: first.result });
    expect(calls).toBe(1); expect(reopened.newCalls).toBe(1);
  } finally { await reopened.close(); }
});

test("terminal output is retained as a terminal result with no accepted partial answer", async () => {
  const { cache } = await fixture();
  try {
    const result = await invokeLabGpt5MiniReader({ request, cache, oidcToken: "fixture-token", qualify: async () => {}, fetcher: async () => response("length") });
    expect(result.result).toMatchObject({ kind: "terminal", prediction: null, reason: "length" });
    expect(cache.events.map(e => e.kind)).toEqual(["reserved", "settled"]);
    await expect(cache.admit(request)).rejects.toThrow("cannot be retried");
  } finally { await cache.close(); }
});
