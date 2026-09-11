import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { EVOLUTION_BEAM_JUDGE_PROFILE_IDS, EVOLUTION_GATEWAY_ENDPOINT, EVOLUTION_PROFILES, evolutionReaderContract, makeEvolutionProfileWindowRequest,
  makeEvolutionRequest, parseEvolutionResponse, supportsEvolutionProfileWindow, validateEvolutionRequest,
  type EvolutionExtractorProfileId, type EvolutionProfileId, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT } from "../scripts/benchmarks/observe-extractor-v2";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { invokeEvolutionRequest } from "../scripts/benchmarks/evolution-transport";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";

const messages = [{ role: "system" as const, content: "Use supplied memory only." }, { role: "user" as const, content: "Which color?" }];
const directJudgeMessages = [{ role: "user" as const, content: "Evaluate this LongMemEval answer exactly as instructed." }];
const extractors: readonly EvolutionExtractorProfileId[] = ["gpt5-mini-low-extractor-v1", "gpt5-mini-structured-extractor-v2"];
const low = () => makeEvolutionRequest("gpt5-mini-low-extractor-v1", messages);
const structured = () => makeEvolutionRequest("gpt5-mini-structured-extractor-v2", messages);

test("adding extractor profiles preserves every existing profile, V1 request and full-window request byte", () => {
  // Frozen from ebc46ed201714641d59907bd9cabe933e6dfa70e before adding these profiles.
  // JSON-byte digests cover property order, all profile/request digests and financial preimages.
  const profiles = Object.entries(EVOLUTION_PROFILES).filter(([id]) => !extractors.includes(id as EvolutionExtractorProfileId) && id !== "gpt5-mini-answer-audit-v1"
    && !(EVOLUTION_BEAM_JUDGE_PROFILE_IDS as readonly string[]).includes(id))
    .sort(([a], [b]) => a < b ? -1 : 1);
  const requests = profiles.map(([id, profile]) => makeEvolutionRequest(id as EvolutionProfileId,
    profile.qualification === "official-snapshot-request" || ["gpt4o-gateway-native-rubric-judge-v1", "gpt4o-gateway-native-rubric-16-judge-v1"].includes(id)
      ? directJudgeMessages : messages));
  const windows = profiles.filter(([id]) => supportsEvolutionProfileWindow(id as EvolutionProfileId))
    .map(([id]) => makeEvolutionProfileWindowRequest(id as EvolutionProfileId, messages));
  expect(profiles).toHaveLength(95);
  expect(sha256Hex(JSON.stringify(profiles))).toBe("169b40467ad3a873058fe491d2cc9145716c667dacf6cb02a3ea2dc6c4c168bb");
  expect(sha256Hex(JSON.stringify(requests))).toBe("de6aec014427fda0a62a0916647d54bd39331f65dbdc2e4c2a82dc52d0deaaa2");
  expect(windows).toHaveLength(54);
  expect(sha256Hex(JSON.stringify(windows))).toBe("556d1793bb16f3504e4e7e30bc0c13b08299b20503ac265947a32fe5b87faa67");
});

test("extractors use the fixed low-effort mini profile and only V2 includes its strict response schema", () => {
  const base = EVOLUTION_PROFILES["gpt5-mini-reader"], original = makeEvolutionRequest("gpt5-mini-reader", messages);
  for (const id of extractors) {
    const profile = EVOLUTION_PROFILES[id], request = makeEvolutionRequest(id, messages);
    expect(profile).toEqual({ ...base, id, settings: { reasoning: { effort: "low" } },
      ...(id === "gpt5-mini-structured-extractor-v2" ? { responseFormat: OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT } : {}) });
    expect(request.body).toEqual({ ...original.body, reasoning: { effort: "low" },
      ...(id === "gpt5-mini-structured-extractor-v2" ? { response_format: OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT } : {}) });
    expect(request.endpoint).toBe(EVOLUTION_GATEWAY_ENDPOINT);
    expect(request.profileSha256).toBe(canonicalSha256(profile));
    expect(request.requestSha256).not.toBe(original.requestSha256);
    expect(validateEvolutionRequest(structuredClone(request))).toEqual(request);
    expect(Object.isFrozen(profile)).toBe(true);
  }
  expect(low().body.response_format).toBeUndefined();
  expect(structured().body.response_format?.json_schema.strict).toBe(true);
  expect(Object.isFrozen(structured().body.response_format?.json_schema.schema.properties)).toBe(true);
  expect(low().requestSha256).not.toBe(structured().requestSha256);
});

test("the fixed schema adds conservative input reservation and reduces the admitted context by its exact bytes", () => {
  const plain = low(), strict = structured(), schemaBytes = Buffer.byteLength(JSON.stringify({ response_format: OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT }));
  expect(strict.inputUpperBound - plain.inputUpperBound).toBe(schemaBytes);
  expect(strict.reservationMicros).toBe(Math.ceil((strict.inputUpperBound * 250 + 8192 * 2000) / 1000));
  expect(strict.reservationMicros).toBeGreaterThan(plain.reservationMicros);
  expect(plain.reservationMicros).toBe(makeEvolutionRequest("gpt5-mini-reader", messages).reservationMicros);
  const boundary = [{ ...messages[0]! }, { role: "user" as const, content: "x" }];
  boundary[1]!.content = "x".repeat(400_000 - 8192 - 2048 - Buffer.byteLength(JSON.stringify(boundary)) + 1);
  expect(makeEvolutionRequest("gpt5-mini-low-extractor-v1", boundary).inputUpperBound + 8192).toBe(400_000);
  expect(() => makeEvolutionRequest("gpt5-mini-structured-extractor-v2", boundary)).toThrow("context bound");
});

function reseal(request: EvolutionRequest, mutate: (value: Record<string, any>) => void): EvolutionRequest {
  const copy = structuredClone(request); mutate(copy);
  const { requestSha256: _old, ...body } = copy;
  return { ...body, requestSha256: canonicalSha256(body) };
}
test("reconstruction rejects resealed schema changes, deletion, injection and profile swaps", () => {
  for (const mutate of [
    (value: Record<string, any>) => { value.body.response_format.json_schema.strict = false; },
    (value: Record<string, any>) => { value.body.response_format.json_schema.schema.properties.observations.maxItems = 49; },
    (value: Record<string, any>) => { value.body.response_format.json_schema.schema.additionalProperties = true; },
    (value: Record<string, any>) => { value.body.response_format = { type: "json_object" }; },
    (value: Record<string, any>) => { delete value.body.response_format; },
    (value: Record<string, any>) => { value.inputUpperBound = low().inputUpperBound; value.reservationMicros = low().reservationMicros; },
    (value: Record<string, any>) => { value.profileId = "gpt5-mini-low-extractor-v1"; value.profileSha256 = low().profileSha256; },
  ]) expect(() => validateEvolutionRequest(reseal(structured(), mutate))).toThrow("request changed");
  expect(() => validateEvolutionRequest(reseal(low(), value => { value.body.response_format = OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT; }))).toThrow("request changed");
  expect(() => validateEvolutionRequest(reseal(structured(), value => { value.body.arbitrary_schema = {}; }))).toThrow("request changed");
});

test("extractor profiles cannot be answer readers or use full-history accounting", () => {
  for (const id of extractors) {
    expect(id.endsWith("-reader")).toBe(false);
    expect(() => evolutionReaderContract(id)).toThrow("reader profile");
    expect(supportsEvolutionProfileWindow(id)).toBe(false);
    expect(() => makeEvolutionProfileWindowRequest(id, messages)).toThrow("profile-window");
    expect(() => validateEvolutionRequest(reseal(makeEvolutionRequest(id, messages), value => { value.protocol = "oh.memory.evolution-model.v2"; }))).toThrow("profile-window");
  }
});

function rawResponse(request: EvolutionRequest, finishReason = "stop") {
  return new TextEncoder().encode(JSON.stringify({ model: request.model,
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content: '{"observations":[]}' } }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, completion_tokens_details: { reasoning_tokens: 2 } },
    providerMetadata: { gateway: { routing: { finalProvider: request.provider, originalModelId: request.model,
      canonicalSlug: request.model, resolvedProviderApiModelId: "gpt-5-mini" } } } }));
}
function credential() {
  const auth = { method: "project-oidc" as const, project: "fixture-project", scope: "fixture-scope", environment: "development" as const };
  const now = Math.floor(Date.now() / 1000), encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "RS256" })}.${encode({ sub: "owner:fixture-scope:project:fixture-project:environment:development",
    aud: "https://vercel.com/fixture-scope", iss: "https://oidc.vercel.com/fixture-scope", exp: now + 600, iat: now })}.synthetic`;
  return { kind: "gateway-oidc" as const, auth, token };
}

test("extractor requests cross the transport and durable replay store without retries or schema loss", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-extractor-profile-")));
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "extractor-profile-test", storeDirectory: directory,
    approval: "Synthetic local transport fixture only; no paid calls", additionalBudgetMicros: 100_000, maximumCalls: 3, historicalExposureMicros: 0,
    historicalLedgers: [{ path: "/fixture/unused-ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/fixture/unused-authority", sha256: "b".repeat(64) } };
  let store = await openEvolutionStore({ directory, campaign }), calls = 0;
  const requests = extractors.map(id => makeEvolutionRequest(id, messages));
  try {
    const altered = reseal(structured(), value => { value.body.response_format.json_schema.strict = false; });
    await expect(invokeEvolutionRequest({ request: altered, store, credential: credential(), fetcher: async () => { calls++; throw new Error("Must not dispatch"); } })).rejects.toThrow("request changed");
    expect(store.summary().calls).toBe(0); expect(calls).toBe(0);
    for (const request of requests) {
      const raw = rawResponse(request), expected = parseEvolutionResponse(raw, request);
      const result = await invokeEvolutionRequest({ request, store, credential: credential(), fetcher: async (url, init) => {
        calls++; expect(url).toBe(EVOLUTION_GATEWAY_ENDPOINT); expect(init.body).toBe(JSON.stringify(request.body));
        return new Response(raw);
      } });
      expect(result.result).toEqual(expected); expect(expected.answer).toBe('{"observations":[]}');
      expect(expected.status).toBe("completed"); expect(expected.usage.micros).toBeLessThanOrEqual(request.reservationMicros);
      expect(store.readRaw(request)).toEqual(raw);
    }
    const stopped = makeEvolutionRequest("gpt5-mini-structured-extractor-v2", [messages[0]!, { role: "user", content: "A different session." }]);
    const truncated = await invokeEvolutionRequest({ request: stopped, store, credential: credential(), fetcher: async () => { calls++; return new Response(rawResponse(stopped, "length")); } });
    expect(truncated.result).toMatchObject({ status: "truncated", answer: null, partialAnswer: '{"observations":[]}' });
    const summary = store.summary(); await store.close(); store = await openEvolutionStore({ directory, campaign });
    expect(store.summary()).toEqual(summary);
    for (const request of [...requests, stopped]) {
      const replay = await invokeEvolutionRequest({ request, store, credential: { ...credential(), token: "" }, fetcher: async () => { throw new Error("Replay cannot dispatch"); } });
      expect(replay.cached).toBe(true);
      expect(replay.result).toEqual(parseEvolutionResponse(store.readRaw(request), request));
    }
    expect(calls).toBe(3); expect(store.summary()).toMatchObject({ calls: 3, unresolvedMicros: 0 });
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
