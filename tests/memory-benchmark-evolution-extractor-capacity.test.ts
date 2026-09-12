import { expect, spyOn, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { EVOLUTION_EVIDENCE_EXTRACTOR_PROFILE_ID as capacityId, EVOLUTION_PROFILES, evolutionReaderContract,
  makeEvolutionRequest, makeEvolutionProfileWindowRequest, supportsEvolutionProfileWindow, validateEvolutionRequest,
  parseEvolutionResponse, type EvolutionProfileId, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT } from "../scripts/benchmarks/observe-extractor-v2";
import { OBSERVE_EXTRACTOR_V3_RESPONSE_FORMAT, OBSERVE_EXTRACTOR_V3_SCHEMA_SHA256, OBSERVE_EXTRACTOR_V3_MODES } from "../scripts/benchmarks/observe-extractor-v3-schema";
import { makeEvolutionAnswerAuditMessages } from "../scripts/benchmarks/evolution-answer-audit";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { invokeEvolutionRequest } from "../scripts/benchmarks/evolution-transport";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";
const oldId = "gpt5-mini-low-extractor-v1", messages = [{ role: "system" as const, content: "Use supplied memory only." }, { role: "user" as const, content: "Which color?" }];

test("capacity addition preserves all103 prior profiles/requests and56 full-window bytes", () => {
  const single = [{ role: "user" as const, content: "Evaluate this LongMemEval answer exactly as instructed." }];
  const audit = makeEvolutionAnswerAuditMessages({ question: "Which color?", questionDate: "", originalMemory: "The synthetic tile is blue.", draftAnswer: "Blue." });
  const profiles = Object.entries(EVOLUTION_PROFILES).filter(([id]) => id !== capacityId).sort(([a], [b]) => a < b ? -1 : 1);
  const requests = profiles.map(([id, p]) => makeEvolutionRequest(id as EvolutionProfileId, id === "gpt5-mini-answer-audit-v1" ? audit : p.qualification === "official-snapshot-request"
    || ["gpt4o-gateway-native-rubric-judge-v1", "gpt4o-gateway-native-rubric-16-judge-v1", "gpt4o-beam-event-extraction-v1", "gpt4o-beam-nugget-v1"].includes(id) ? single : messages));
  const windows = profiles.filter(([id]) => supportsEvolutionProfileWindow(id as EvolutionProfileId)).map(([id]) => makeEvolutionProfileWindowRequest(id as EvolutionProfileId, messages));
  // Captured from clean d53be116f885eea960dad389a0340f5cdb520d19 before adding this profile.
  expect(profiles).toHaveLength(103); expect<string>(sha256Hex(JSON.stringify(profiles))).toBe("07eedb0b3cdd2920d6d64e585c481a3d2fbbc1e4a6c46c33756349e3ca8e0c48");
  expect<string>(sha256Hex(JSON.stringify(requests))).toBe("b151c38aebadb9f3d21d511ce84d0c83bfb65117f0b5acb3553399c709300f7c");
  expect(windows).toHaveLength(56); expect<string>(sha256Hex(JSON.stringify(windows))).toBe("528854d95caca09e90548fa5437607021f629a7a07c606b8cc8e08245c75b41f");
});
test("static V3 schema retains V2 fields and fixes modes/evidence without claiming source entailment", () => {
  const old = OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT.json_schema.schema.properties.observations.items;
  const schema = OBSERVE_EXTRACTOR_V3_RESPONSE_FORMAT, item = schema.json_schema.schema.properties.observations.items;
  expect<string>(OBSERVE_EXTRACTOR_V3_SCHEMA_SHA256).toBe("0c7bd14324ed72fe64808b7fbc1f9b5a55e9f19e6bb4aed2225a232a5669555b");
  expect(schema.type).toBe("json_schema"); expect(schema.json_schema.strict).toBe(true); expect(schema.json_schema.name).toBe("oh_observation_extraction_v3");
  expect(schema.json_schema.schema.properties.observations.maxItems).toBe(48); expect(item.required).toEqual([...old.required, "modes", "evidence"]);
  for (const key of Object.keys(old.properties) as Array<keyof typeof old.properties>) expect(item.properties[key]).toEqual(old.properties[key]);
  expect(item.properties.kind.enum).toEqual(["event", "fact", "plan", "preference", "update"]);
  expect(item.properties.modes.items.enum).toEqual([...OBSERVE_EXTRACTOR_V3_MODES]); expect(item.properties.modes.maxItems).toBe(7);
  expect(item.properties.evidence.maxItems).toBe(16); expect(item.properties.evidence.items.additionalProperties).toBe(false);
  expect(item.properties.evidence.items.required).toEqual(["turn", "quote"]); expect(item.properties.evidence.items.properties.turn).toEqual(old.properties.attributionTurn);
  expect(item.properties.evidence.items.properties.quote.maxLength).toBe(2048); expect(Object.isFrozen(item.properties.evidence.items.properties.quote)).toBe(true);
  expect(Object.isFrozen(item.properties.modes.items.enum)).toBe(true);
  expect(Object.isFrozen(OBSERVE_EXTRACTOR_V3_MODES)).toBe(true);
  expect(() => (OBSERVE_EXTRACTOR_V3_MODES as unknown as string[]).push("unsupported")).toThrow(TypeError);
});
test("opt-in evidence profile binds the fixed schema, output/deadline and full conservative reservation", () => {
  const old = makeEvolutionRequest(oldId, messages), large = makeEvolutionRequest(capacityId, messages);
  expect(EVOLUTION_PROFILES[capacityId]).toEqual({ ...EVOLUTION_PROFILES[oldId], id: capacityId, maxOutputTokens: 32768, timeoutMs: 600000, responseFormat: OBSERVE_EXTRACTOR_V3_RESPONSE_FORMAT });
  expect<string>(large.profileSha256).toBe("87503927638c777f702d6d16b7b6b8f6febd7d18ce31d583f26673eb144fc580");
  expect(large.body).toEqual({ ...old.body, max_tokens: 32768, response_format: OBSERVE_EXTRACTOR_V3_RESPONSE_FORMAT });
  const schemaBytes = Buffer.byteLength(JSON.stringify({ response_format: OBSERVE_EXTRACTOR_V3_RESPONSE_FORMAT }));
  expect(large.body.reasoning).toEqual({ effort: "low" }); expect(large.inputUpperBound - old.inputUpperBound).toBe(schemaBytes);
  expect(large.reservationMicros).toBe(Math.ceil((large.inputUpperBound * 250 + 32768 * 2000) / 1000));
  expect(large.reservationMicros).toBeGreaterThan(old.reservationMicros + (32768 - 8192) * 2);
  expect(large.timeoutMs).toBe(600000); expect(large.requestSha256).not.toBe(old.requestSha256);
  expect(validateEvolutionRequest(structuredClone(large))).toEqual(large); expect(Object.isFrozen(EVOLUTION_PROFILES[capacityId].settings)).toBe(true);
  const boundary = [{ ...messages[0]! }, { role: "user" as const, content: "x" }];
  boundary[1]!.content = "x".repeat(400000 - 32768 - 2048 - schemaBytes - Buffer.byteLength(JSON.stringify(boundary)) + 1);
  expect(makeEvolutionRequest(capacityId, boundary).inputUpperBound + 32768).toBe(400000);
  boundary[1]!.content += "x"; expect(() => makeEvolutionRequest(capacityId, boundary)).toThrow("context bound");
  expect(makeEvolutionRequest(oldId, boundary).inputUpperBound + 8192).toBeLessThan(400000);
  expect(() => evolutionReaderContract(capacityId)).toThrow("reader profile"); expect(supportsEvolutionProfileWindow(capacityId)).toBe(false);
  expect(() => makeEvolutionProfileWindowRequest(capacityId, messages)).toThrow("profile-window");
});
test("resealed capacity/price/schema and identity mutations are rejected; unchanged old output cap still applies", () => {
  const request = makeEvolutionRequest(capacityId, messages);
  for (const mutate of [
    (r: any) => { r.timeoutMs = 120000; }, (r: any) => { r.maxOutputTokens = 8192; }, (r: any) => { r.body.max_tokens = 65536; },
    (r: any) => { r.reservationMicros--; }, (r: any) => { r.body.reasoning.effort = "medium"; },
    (r: any) => { r.body.response_format = { type: "json_object" }; },
    (r: any) => { delete r.body.response_format; }, (r: any) => { r.body.response_format = OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT; },
    (r: any) => { r.body.response_format.json_schema.schema.properties.observations.items.properties.kind.enum.push("request"); },
    (r: any) => { r.body.response_format.json_schema.schema.properties.observations.items.properties.evidence.items.properties.quote.maxLength = 4096; }, (r: any) => { r.profileId = oldId; },
    (r: any) => { r.profileSha256 = canonicalSha256(EVOLUTION_PROFILES[oldId]); },
  ]) { const r = structuredClone(request); mutate(r); const { requestSha256: _, ...preimage } = r;
    expect(() => validateEvolutionRequest({ ...preimage, requestSha256: canonicalSha256(preimage) })).toThrow("request changed"); }
  const raw = reply(request, 9000);
  expect(parseEvolutionResponse(raw, request).status).toBe("completed");
  expect(() => parseEvolutionResponse(raw, makeEvolutionRequest(oldId, messages))).toThrow("token cap");
  expect(parseEvolutionResponse(reply(request, 32768, "length"), request)).toMatchObject({ status: "truncated", answer: null, partialAnswer: '{"observations":[]}' });
  expect(() => parseEvolutionResponse(reply(request, 32769), request)).toThrow("token cap");
});
function reply(request: EvolutionRequest, outputTokens = 9000, finishReason = "stop") { return new TextEncoder().encode(JSON.stringify({ model: request.model,
  choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content: '{"observations":[]}' } }],
  usage: { prompt_tokens: 100, completion_tokens: outputTokens, total_tokens: 100 + outputTokens, completion_tokens_details: { reasoning_tokens: 1000 } },
  providerMetadata: { gateway: { routing: { finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model, resolvedProviderApiModelId: "gpt-5-mini" } } } })); }
test("native transport uses600s and preserves first captures, old held charges and replay without redispatch", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-extractor-capacity-")));
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "extractor-capacity-synthetic", storeDirectory: directory,
    approval: "Synthetic fake-fetch test only; no provider requests", additionalBudgetMicros: 300000, maximumCalls: 3, historicalExposureMicros: 0,
    historicalLedgers: [{ path: "/fixture/unused-ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/fixture/unused-authority", sha256: "b".repeat(64) } };
  const now = Math.floor(Date.now() / 1000), encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const auth = { method: "project-oidc" as const, project: "fixture", scope: "fixture", environment: "development" as const };
  const credential = { kind: "gateway-oidc" as const, auth, token: `${encode({ alg: "RS256" })}.${encode({ sub: "owner:fixture:project:fixture:environment:development",
    aud: "https://vercel.com/fixture", iss: "https://oidc.vercel.com/fixture", exp: now + 1200, iat: now })}.synthetic` };
  let store = await openEvolutionStore({ directory, campaign }), fetches = 0;
  const old = makeEvolutionRequest(oldId, messages), request = makeEvolutionRequest(capacityId, messages);
  const failed = makeEvolutionRequest(capacityId, [messages[0]!, { role: "user", content: "A different synthetic source." }]);
  const scheduled: number[] = [], signals: AbortController[] = [];
  const timer = spyOn(AbortSignal, "timeout").mockImplementation(ms => { scheduled.push(ms); const c = new AbortController(); signals.push(c); return c.signal; });
  try {
    store.admit(old); store.capture(old, { httpStatus: null, body: new Uint8Array(), complete: false, receivedBytes: 0, error: "network", serviceMs: 120001 });
    const oldFailure = store.readAttemptFailure(old), raw = reply(request); expect(store.lookup(request).kind).toBe("miss");
    const completed = await invokeEvolutionRequest({ request, store, credential, fetcher: async (_url, init) => {
      fetches++; expect(init.body).toBe(JSON.stringify(request.body)); expect(init.signal).toBe(signals[0]!.signal); return new Response(raw);
    } });
    expect(completed.result.usage.outputTokens).toBe(9000); expect(store.readRaw(request)).toEqual(raw);
    await expect(invokeEvolutionRequest({ request: failed, store, credential, fetcher: async () => { fetches++; signals[1]!.abort(); throw Error("Synthetic transport failure"); } })).rejects.toThrow();
    expect(scheduled).toEqual([600000, 600000]); expect(store.readAttemptFailure(old)).toEqual(oldFailure);
    const failedCapture = store.readAttemptFailure(failed), summary = store.summary();
    expect(summary).toMatchObject({ calls: 3, unresolvedMicros: old.reservationMicros + failed.reservationMicros });
    await store.close(); store = await openEvolutionStore({ directory, campaign });
    const forbidden = async () => { fetches++; throw Error("No repeat transport permitted"); };
    const replay = await invokeEvolutionRequest({ request, store, credential: { ...credential, token: "" }, fetcher: forbidden });
    expect(replay.cached).toBe(true); expect(replay.result).toEqual(completed.result);
    for (const r of [old, failed]) await expect(invokeEvolutionRequest({ request: r, store, credential, fetcher: forbidden })).rejects.toThrow();
    expect(store.readAttemptFailure(old)).toEqual(oldFailure); expect(store.readAttemptFailure(failed)).toEqual(failedCapture);
    expect(store.summary()).toEqual(summary); expect(fetches).toBe(2); expect(scheduled).toEqual([600000, 600000]);
  } finally { timer.mockRestore(); await store.close(); await rm(directory, { recursive: true, force: true }); }
});
