import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { makeEvolutionAnswerAuditMessages } from "../scripts/benchmarks/evolution-answer-audit";
import { EVOLUTION_EVIDENCE_EXTRACTOR_PROFILE_ID, EVOLUTION_BEAM_JUDGE_PROFILE_IDS as beamIds, EVOLUTION_LONG_DEADLINE_READER_PROFILE_ID, EVOLUTION_TASK_COMPLETE_READER_PROFILE_ID, EVOLUTION_GATEWAY_ENDPOINT, EVOLUTION_PROFILES,
  evolutionReaderContract, makeEvolutionRequest, makeEvolutionProfileWindowRequest, parseEvolutionResponse,
  supportsEvolutionProfileWindow, validateEvolutionRequest, type EvolutionProfileId, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { invokeEvolutionRequest } from "../scripts/benchmarks/evolution-transport";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";

const ordinary = [{ role: "system" as const, content: "Use supplied memory only." }, { role: "user" as const, content: "Which color?" }];
const single = [{ role: "user" as const, content: "Evaluate this LongMemEval answer exactly as instructed." }];
const prompts = (id: string) => id === "gpt4o-beam-event-equivalence-v1" ? ordinary : single;

test("BEAM profiles preserve all 98 existing profile/request bytes and all 54 full-window requests", () => {
  const old = Object.entries(EVOLUTION_PROFILES).filter(([id]) => id !== EVOLUTION_EVIDENCE_EXTRACTOR_PROFILE_ID && !(beamIds as readonly string[]).includes(id)
    && id !== EVOLUTION_LONG_DEADLINE_READER_PROFILE_ID && id !== EVOLUTION_TASK_COMPLETE_READER_PROFILE_ID).sort(([a], [b]) => a < b ? -1 : 1);
  const audit = makeEvolutionAnswerAuditMessages({ question: "Which color?", questionDate: "", originalMemory: "The synthetic tile is blue.", draftAnswer: "Blue." });
  const requests = old.map(([id, p]) => makeEvolutionRequest(id as EvolutionProfileId,
    id === "gpt5-mini-answer-audit-v1" ? audit : p.qualification === "official-snapshot-request"
      || ["gpt4o-gateway-native-rubric-judge-v1", "gpt4o-gateway-native-rubric-16-judge-v1"].includes(id) ? single : ordinary));
  const windows = old.filter(([id]) => supportsEvolutionProfileWindow(id as EvolutionProfileId)).map(([id]) => makeEvolutionProfileWindowRequest(id as EvolutionProfileId, ordinary));
  // Captured from clean 3134b001 before these three additions. JSON hashes include ordering and nested preimages.
  expect(old).toHaveLength(98);
  expect(sha256Hex(JSON.stringify(old))).toBe("0be0bc5e36c698e9f43f01d2330df30bafd0997da63f370c89237f4d778d7413");
  expect(sha256Hex(JSON.stringify(requests))).toBe("74848ebb7ae2a6d2f46b931251ad54c6308496471b28f1d7ce505e1b26b78868");
  expect(windows).toHaveLength(54);
  expect(sha256Hex(JSON.stringify(windows))).toBe("556d1793bb16f3504e4e7e30bc0c13b08299b20503ac265947a32fe5b87faa67");
});

test("closed BEAM roles have faithful message shapes, explicit output caps and conservative exact native pricing", () => {
  for (const [id, cap] of [[beamIds[0], 1024], [beamIds[1], 32], [beamIds[2], 512]] as const) {
    const request = makeEvolutionRequest(id, prompts(id)), profile = EVOLUTION_PROFILES[id];
    expect(request.body.messages).toEqual(prompts(id));
    expect(request.body.max_tokens).toBe(cap); expect(request.maxOutputTokens).toBe(cap);
    expect(request.body).toMatchObject({ model: "openai/gpt-4o", temperature: 0, stream: false, store: false,
      providerOptions: { gateway: { only: ["openai"], order: ["openai"] } } });
    expect(request.body.response_format).toBeUndefined(); expect(request.body.reasoning).toBeUndefined();
    expect(request.endpoint).toBe(EVOLUTION_GATEWAY_ENDPOINT);
    expect(profile.qualification).toBe("gateway-alias"); expect(profile.expectedSnapshot).toBeNull();
    expect(request.profileSha256).toBe(canonicalSha256(profile)); expect(Object.isFrozen(profile)).toBe(true);
    expect(request.inputUpperBound).toBe(Buffer.byteLength(JSON.stringify(prompts(id))) + 2048);
    expect(request.reservationMicros).toBe(Math.ceil((request.inputUpperBound * 2500 + cap * 10000) / 1000));
    expect(validateEvolutionRequest(structuredClone(request))).toEqual(request);
    expect(() => makeEvolutionRequest(id, id === beamIds[1] ? single : ordinary)).toThrow("prompt shape");
    expect(() => evolutionReaderContract(id)).toThrow("reader profile");
    expect(supportsEvolutionProfileWindow(id)).toBe(false);
    expect(() => makeEvolutionProfileWindowRequest(id, prompts(id))).toThrow("profile-window");
  }
});

test("native validation rejects resealed cap, schema, pricing and role changes", () => {
  for (const id of beamIds) {
    const request = makeEvolutionRequest(id, prompts(id));
    for (const patch of [(r: any) => { r.body.max_tokens++; }, (r: any) => { r.body.response_format = { type: "json_object" }; },
      (r: any) => { r.reservationMicros--; }, (r: any) => { r.inputUpperBound--; }, (r: any) => { r.body.temperature = 1; }]) {
      const changed = structuredClone(request); patch(changed);
      const { requestSha256: _, ...preimage } = changed;
      expect(() => validateEvolutionRequest({ ...preimage, requestSha256: canonicalSha256(preimage) })).toThrow("request changed");
    }
  }
});

const reply = (request: EvolutionRequest, answer: string, finish = "stop") => new TextEncoder().encode(JSON.stringify({ model: request.model,
  choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: answer } }],
  usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  providerMetadata: { gateway: { routing: { finalProvider: "openai", originalModelId: request.model, canonicalSlug: request.model,
    resolvedProviderApiModelId: "gpt-4o" } } } }));

test("real native transport/store captures plain or JSON text unchanged and never retries a captured BEAM role", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-beam-profile-")));
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "beam-profile-synthetic", storeDirectory: directory,
    approval: "Synthetic fake-fetch test only; no real provider requests", additionalBudgetMicros: 100000, maximumCalls: 4, historicalExposureMicros: 0,
    historicalLedgers: [{ path: "/fixture/unused-ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/fixture/unused-authority", sha256: "b".repeat(64) } };
  const now = Math.floor(Date.now() / 1000), encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const auth = { method: "project-oidc" as const, project: "fixture", scope: "fixture", environment: "development" as const };
  const credential = { kind: "gateway-oidc" as const, auth, token: `${encode({ alg: "RS256" })}.${encode({ sub: "owner:fixture:project:fixture:environment:development",
    aud: "https://vercel.com/fixture", iss: "https://oidc.vercel.com/fixture", exp: now + 600, iat: now })}.synthetic` };
  let store = await openEvolutionStore({ directory, campaign }), calls = 0;
  const requests = beamIds.map(id => makeEvolutionRequest(id, prompts(id)));
  try {
    for (const [i, request] of requests.entries()) {
      const answer = ["Opened the file.\nClosed the file.", "Yes.", '{"score":0.5,"reason":"synthetic"}'][i]!, raw = reply(request, answer);
      const result = await invokeEvolutionRequest({ request, store, credential, fetcher: async (url, init) => {
        calls++; expect(url).toBe(EVOLUTION_GATEWAY_ENDPOINT); expect(init.body).toBe(JSON.stringify(request.body)); return new Response(raw);
      } });
      expect(result.result).toEqual(parseEvolutionResponse(raw, request)); expect(result.result.answer).toBe(answer);
      expect(result.result.usage.micros).toBeLessThanOrEqual(request.reservationMicros); expect(store.readRaw(request)).toEqual(raw);
    }
    const truncated = makeEvolutionRequest(beamIds[2], [{ role: "user", content: "Distinct synthetic truncation." }]);
    const result = await invokeEvolutionRequest({ request: truncated, store, credential, fetcher: async () => { calls++; return new Response(reply(truncated, '{"score":', "length")); } });
    expect(result.result).toMatchObject({ status: "truncated", answer: null, partialAnswer: '{"score":' });
    const summary = store.summary(); await store.close(); store = await openEvolutionStore({ directory, campaign });
    expect(store.summary()).toEqual(summary);
    for (const request of [...requests, truncated]) {
      const replay = await invokeEvolutionRequest({ request, store, credential: { ...credential, token: "" }, fetcher: async () => { calls++; throw Error("Unexpected repeat"); } });
      expect(replay.cached).toBe(true);
    }
    expect(calls).toBe(4); expect(store.summary()).toMatchObject({ calls: 4, unresolvedMicros: 0 });
  } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
});
