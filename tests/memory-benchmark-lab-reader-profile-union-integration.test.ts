import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { makeGatewayStudyRequest } from "../scripts/benchmarks/gateway-study-transport-v3";
import { makeLabGpt5MiniReaderRequest } from "../scripts/benchmarks/lab-reader-profile";
import { canonicalReaderJudgeRequest, reserveReaderJudge, parseReaderJudge, type LabReaderJudgeRequest } from "../scripts/benchmarks/lab-reader-profile-judge";
import { openLabReaderProfileCustody } from "../scripts/benchmarks/lab-reader-profile-custody";
import { invokeLabReaderJudge } from "../scripts/benchmarks/lab-reader-profile-transport-union";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
test("new reader and unchanged judge share one atomic ledger and both replay without new calls", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "lab-profile-union-"))); roots.push(directory);
  const options = { directory, namespaceSha256: "a".repeat(64), ancestry: { priorExposureMicros: 23_223_090, fingerprint: "f".repeat(64), recheck: async () => {} },
    maxUsd: 24, maxCalls: 2, reserve: reserveReaderJudge, parse: parseReaderJudge };
  const cache = await openLabReaderProfileCustody(options);
  const reader = makeLabGpt5MiniReaderRequest([{ role: "system", content: "Use memory." }, { role: "user", content: "Memory: bike green. Question: bike color?" }]);
  const nativeJudge = makeGatewayStudyRequest({ phase: "judge", messages: [{ role: "system", content: "Judge the answer." }, { role: "user", content: "Is green correct?" }] });
  const judge = canonicalReaderJudgeRequest({ ...nativeJudge, phase: "judge" });
  const requests: LabReaderJudgeRequest[] = [reader, judge]; let calls = 0;
  const fetcher = async (_url: string, init: RequestInit) => {
    calls++; const body = JSON.parse(init.body as string); const isJudge = body.model === "openai/gpt-4o";
    expect(body).toEqual(isJudge ? nativeJudge.body : reader.body);
    return Response.json({ model: body.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: isJudge ? "Yes." : "Green." } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      providerMetadata: { gateway: { routing: { finalProvider: "openai", resolvedProvider: "openai", originalModelId: body.model, canonicalSlug: body.model,
        modelAttemptCount: 1, totalProviderAttemptCount: 1, modelAttempts: [{ canonicalSlug: body.model, success: true, providerAttemptCount: 1,
          providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } });
  };
  const results = await Promise.all(requests.map(request => invokeLabReaderJudge({ request, cache, oidcToken: "fixture-token", qualify: async () => {}, fetcher })));
  expect(results.map(r => r.result.kind)).toEqual(["completed", "completed"]);
  expect(cache.events.filter(e => e.kind === "reserved")).toHaveLength(2);
  expect(cache.events.filter(e => e.kind === "settled")).toHaveLength(2);
  expect(cache.localExposureMicros).toBe(results.reduce((sum, r) => sum + r.result.usage.micros, 0));
  await cache.close();
  const replay = await openLabReaderProfileCustody(options);
  try {
    for (const [i, request] of requests.entries()) expect(await invokeLabReaderJudge({ request, cache: replay, oidcToken: "fixture-token", qualify: async () => {}, fetcher })).toEqual({ cached: true, result: results[i]!.result });
    expect(calls).toBe(2);
  } finally { await replay.close(); }
});
