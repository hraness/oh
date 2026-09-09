import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS, type Dataset } from "../scripts/benchmarks/datasets";
import { parseEvolutionRunConfig } from "../scripts/benchmarks/evolution";
import { type EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";
import { projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { EVOLUTION_LME_NATIVE_REFERENCE, makeEvolutionJudgePlan, scoreEvolutionJudgeDecision, validateEvolutionJudgePlan } from "../scripts/benchmarks/evolution-judge";
import { EVOLUTION_GATEWAY_ENDPOINT, EVOLUTION_PROFILES, makeEvolutionRequest, makeEvolutionProfileWindowRequest, parseEvolutionResponse, validateEvolutionRequest,
  type EvolutionProfileId, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { makeEvolutionContextPlan, makeEvolutionReaderPlan } from "../scripts/benchmarks/evolution-plan";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { buildJudgePrompt, loadJudgeProfile } from "../scripts/benchmarks/judge";

const native = "gpt4o-gateway-native-rubric-judge-v1";
const messages = [{ role: "system" as const, content: "Use supplied memory only." }, { role: "user" as const, content: "Which color?" }];
const single = [{ role: "user" as const, content: "Evaluate this LongMemEval answer exactly as instructed." }];
const hash = "a".repeat(64);
function response(request: EvolutionRequest, answer = "  Blue.  ") {
  return new TextEncoder().encode(JSON.stringify({ model: request.model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 20 }, completion_tokens_details: { reasoning_tokens: 2 } },
    ...(request.endpoint === EVOLUTION_GATEWAY_ENDPOINT ? { providerMetadata: { gateway: { routing: {
      finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model,
      resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1),
    } } } } : {}) }));
}
// Generated before the new profile existed at source revision 275b8b1be37d82a5821508f7de6f5057689a6d5c.
// These hashes cover serialized requests/responses as well as canonical profile/request identities.
const legacy = [
  {
    "id": "qwen37-flash-reader",
    "protocol": "oh.memory.evolution-model.v1",
    "profileSha256": "a0956117db5d7a60e6979d25c55d91f9885fd89c76ecf1c4c2c875d9d74c049c",
    "requestSha256": "b5cdfa9cc2233819c61f485dad37716b22481a827a63b2acb526ff24a7c5d898",
    "requestJsonSha256": "a8043bf66d7502f15a7c3e3294c51a03878fd17e44c8c69c31f208d6ecfa6f40",
    "parsedJsonSha256": "f484d76398307236f17824023fb09f50d2111a2703a5b2416efc6ff873a289fe"
  },
  {
    "id": "gpt5-nano-reader",
    "protocol": "oh.memory.evolution-model.v1",
    "profileSha256": "84f6173929020c34331062d734983dca33bcba1bb8cd20daf51aeffad2a6f4a6",
    "requestSha256": "428e0de5351157b7990dda9febad1c5819a134df9b761c143b546ab5856946e2",
    "requestJsonSha256": "4363b6ee85136820959dda29406b69aeb7a4a4335ad4c44d690d83b9dc020aac",
    "parsedJsonSha256": "fcd96fef30d814070ad9a905beac6cfad0343a9d9c7a101898f7cd408c160af9"
  },
  {
    "id": "gemini25-flash-lite-reader",
    "protocol": "oh.memory.evolution-model.v1",
    "profileSha256": "5d3bd22435515b31dbd70e01f5629a97806e604cd3ff46f6cfb84dab2ab73f62",
    "requestSha256": "b86c0290007e44f681542f8dd7c083d4c9ff3ac8f2c7bf210917e07071434daf",
    "requestJsonSha256": "3620ef619a310d9e4ffdfaee12726d83e0784fac017f2c416304fa32aa112f9d",
    "parsedJsonSha256": "f7c2fa9535013423f2228922ef533f1a953cb886e677dd31e8767ad847f1c040"
  },
  {
    "id": "gpt5-mini-reader",
    "protocol": "oh.memory.evolution-model.v1",
    "profileSha256": "d14d723b4c3d4e5871fcbb5e45f22c82bc76fe233467d3bdbbe526c2b13832b9",
    "requestSha256": "e323bd7aee9d833c82b18e44968eec40dbf1966248ecc701007b9f8357de5567",
    "requestJsonSha256": "6961de99991825b9562fea8294a4aae27caa102208190fdccd1edfba85a7ab53",
    "parsedJsonSha256": "513bea5196210720c19f39bbae5e29b4f51b6e95e5e45328deb5f4d68b269777"
  },
  {
    "id": "gpt4o-gateway-judge",
    "protocol": "oh.memory.evolution-model.v1",
    "profileSha256": "9039b11f05b27bbe8ae493c6ca8f89b846061ccb6499661cf2774d2ee232ec74",
    "requestSha256": "e02ebbb448a9123be4785d39cb6e465e5199c36ae4089dc2febf8087054811fa",
    "requestJsonSha256": "91fa995938bc7062345d3a869392331f11819afba9336e7c8c5f2b1148fd5c93",
    "parsedJsonSha256": "c0fafe28741c3ecf40ad442c59d5d2b21d05e410ebeb08acb5cf7fc21c009988"
  },
  {
    "id": "gpt4o-official-snapshot-judge",
    "protocol": "oh.memory.evolution-model.v1",
    "profileSha256": "b731858105c5ce80bf3600c6c6c7c766626157259925ce746bcaeae9a26d54c5",
    "requestSha256": "d1e13efbc279be8aaf18dc87fd6be908eef3985777fcb30d9079329f1bed0282",
    "requestJsonSha256": "d2a96aa987e667c1d8ad3db662051f2d8e319b2f4ba540c721141e5afae877d9",
    "parsedJsonSha256": "90388dd37c22c34549049d910d051a44c345e160b307fc47d662323c88bb0dc0"
  },
  {
    "id": "gpt5-nano-reader",
    "protocol": "oh.memory.evolution-model.v2",
    "profileSha256": "84f6173929020c34331062d734983dca33bcba1bb8cd20daf51aeffad2a6f4a6",
    "requestSha256": "e356a25441c8be3e8326bf4e277c2a09e7f30885c5fd7792af69f19f17487789",
    "requestJsonSha256": "f596553a41b7dba5e805a25f35c5771a82ae265f3cf07c210a70a4f0b9acd1ab",
    "parsedJsonSha256": "12215d5ca2cb8be4e1ddb9258c3b9d7e789b7496b69ad172fe81c5e1e328061f"
  },
  {
    "id": "gpt5-mini-reader",
    "protocol": "oh.memory.evolution-model.v2",
    "profileSha256": "d14d723b4c3d4e5871fcbb5e45f22c82bc76fe233467d3bdbbe526c2b13832b9",
    "requestSha256": "d3c96a838bd463d8dcde50b23cd34a051c990fd547b39132f3fdacd1f3c939d8",
    "requestJsonSha256": "e1adecba2d1f61cb396cad0250ca342e0835eb63047f3d0a1bec615be8522b47",
    "parsedJsonSha256": "d646849646858bf720a720a2aa356b41b5443df0e132906197c33f7ae343e36b"
  }
];

test("all six legacy profiles and both V2 requests retain exact profile/request/parsed replay bytes", () => {
  for (const expected of legacy) {
    const id = expected.id as EvolutionProfileId;
    const request = expected.protocol === "oh.memory.evolution-model.v2" ? makeEvolutionProfileWindowRequest(id, messages)
      : makeEvolutionRequest(id, id === "gpt4o-official-snapshot-judge" ? single : messages);
    expect(request.profileSha256).toBe(expected.profileSha256);
    expect(String(canonicalSha256(EVOLUTION_PROFILES[id]))).toBe(expected.profileSha256);
    expect(request.requestSha256).toBe(expected.requestSha256);
    expect(String(sha256Hex(JSON.stringify(request)))).toBe(expected.requestJsonSha256);
    expect(String(sha256Hex(JSON.stringify(parseEvolutionResponse(response(request), request))))).toBe(expected.parsedJsonSha256);
    expect(validateEvolutionRequest(structuredClone(request))).toEqual(request);
  }
});

test("native rubric uses a distinct alias profile with one user prompt, ten tokens and OpenAI-only routing", () => {
  const request = makeEvolutionRequest(native, single), proxy = makeEvolutionRequest("gpt4o-gateway-judge", messages);
  expect(request.body).toEqual({ model: "openai/gpt-4o", messages: single, stream: false, store: false,
    max_tokens: 10, temperature: 0, providerOptions: { gateway: { only: ["openai"], order: ["openai"] } } });
  expect(request.endpoint).toBe(EVOLUTION_GATEWAY_ENDPOINT);
  expect(request.requestSha256).not.toBe(proxy.requestSha256);
  expect(request.profileSha256).not.toBe(proxy.profileSha256);
  expect(parseEvolutionResponse(response(request), request).identity).toMatchObject({ qualification: "gateway-alias", snapshotPinned: false, resolvedSnapshot: null });
  const reported = JSON.parse(new TextDecoder().decode(response(request)));
  reported.model = "gpt-4o-2024-08-06";
  reported.providerMetadata.gateway.routing.resolvedProviderApiModelId = "gpt-4o-2024-08-06";
  expect(parseEvolutionResponse(new TextEncoder().encode(JSON.stringify(reported)), request).identity)
    .toMatchObject({ qualification: "gateway-alias", snapshotPinned: false, resolvedSnapshot: "gpt-4o-2024-08-06" });
  expect(() => makeEvolutionRequest(native, messages)).toThrow("prompt shape");
  expect(() => makeEvolutionRequest("gpt4o-gateway-judge", single)).toThrow("prompt shape");
  expect(() => makeEvolutionProfileWindowRequest(native, single)).toThrow("profile-window");
  for (const mutation of [(r: any) => { r.body.max_tokens = 16; }, (r: any) => { r.body.providerOptions.gateway.only = ["azure"]; },
    (r: any) => { r.profileId = "gpt4o-gateway-judge"; }]) {
    const altered = structuredClone(request); mutation(altered);
    const { requestSha256: _old, ...payload } = altered;
    expect(() => validateEvolutionRequest({ ...payload, requestSha256: canonicalSha256(payload) })).toThrow();
  }
});

test("all official task and abstention prompt shapes match direct snapshot messages with separate scoring identity", async () => {
  const rubric = await loadJudgeProfile();
  const categories = ["single-session-user", "single-session-assistant", "multi-session", "temporal-reasoning", "knowledge-update", "single-session-preference"];
  const dataset: Dataset = { corpora: [{ id: "synthetic-corpus", groupId: "synthetic-family", turns: [{ id: "t1", sessionId: "s1", date: "2026", speaker: "user", text: "Synthetic color is blue." }] }],
    questions: categories.flatMap((category, index) => [false, true].map(unanswerable => ({ id: `q${index}-${unanswerable}`, corpusId: "synthetic-corpus", category,
      question: `Synthetic {question} ${index} café 😀`, questionDate: "2026", answer: "blue {response}", unanswerable, evidenceSessionIds: [], evidenceTurnIds: [] }))) };
  const { plan: contextPlan } = await makeEvolutionContextPlan({ dataset: projectEvolutionRunnerInput(dataset), manifestSha256: hash, retrievalSourceSha256: hash,
    variants: [{ id: "control", system: "bm25-window", budget: { topK: 1, contextBytes: 1024 } }] });
  const readerPlan = makeEvolutionReaderPlan(contextPlan, ["gpt5-nano-reader"]);
  const responses = new Map(readerPlan.requests.map(request => [request.requestSha256, parseEvolutionResponse(response(request), request)]));
  const input = { contextPlan, readerPlan, responses, dataset, rubric, readerOutputSha256: hash };
  const plan = makeEvolutionJudgePlan({ ...input, profile: native });
  const direct = makeEvolutionJudgePlan({ ...input, profile: "gpt4o-official-snapshot-judge" });
  const proxy = makeEvolutionJudgePlan({ ...input, profile: "gpt4o-gateway-judge" });
  expect(plan.rubricSha256).toBe(EVOLUTION_LME_NATIVE_REFERENCE.parityRubricSha256);
  expect(plan.scoringRule).toBe("native-contains-yes");
  expect(plan.requests).toHaveLength(12);
  expect(plan.requests.map(request => request.body.messages)).toEqual(direct.requests.map(request => request.body.messages));
  for (const [index, request] of plan.requests.entries()) {
    expect(request.body.messages).toEqual([{ role: "user", content: buildJudgePrompt(dataset.questions[index]!, "Blue.", rubric) }]);
    expect(request.requestSha256).not.toBe(direct.requests[index]!.requestSha256);
    expect(request.requestSha256).not.toBe(proxy.requests[index]!.requestSha256);
  }
  for (const text of ["yes", "YES.", "not yes", "yesterday", "no", "maybe", "", "yeſ", "ＮＯ"]) {
    expect(scoreEvolutionJudgeDecision(native, text)).toBe(scoreEvolutionJudgeDecision("gpt4o-official-snapshot-judge", text));
  }
  expect(scoreEvolutionJudgeDecision(native, null)).toBeNull();
  expect(scoreEvolutionJudgeDecision(native, "not yes")).toBe(1);
  expect(scoreEvolutionJudgeDecision("gpt4o-gateway-judge", "not yes")).toBeNull();
  expect(() => makeEvolutionJudgePlan({ ...input, profile: native, rubric: { ...rubric, sha256: hash } })).toThrow("parity-qualified rubric");
  const { planSha256: _old, ...payload } = plan;
  const altered = { ...payload, scoringRule: "strict-yes-no" as const };
  expect(() => validateEvolutionJudgePlan({ ...altered, planSha256: canonicalSha256(altered) })).toThrow("scoring rule");
});

test("new judge ID is explicit in compatible config shapes and cannot be selected as a reader", () => {
  const pin = { path: "/synthetic/pin.json", sha256: hash };
  const common = { dataset: "longmemeval-s" as const, datasetPin: { ...pin, sha256: DATASETS["longmemeval-s"].sha256 }, manifestPin: pin, campaignPin: pin,
    limit: 1, seed: 7, readers: ["gpt5-nano-reader"] as const, judge: native, directory: "/synthetic/run", storeDirectory: "/synthetic/store", concurrency: 1 } as const;
  for (const [protocol, variants] of [
    ["oh.memory.evolution-run.v1", [{ id: "control", system: "bm25-window", budget: { topK: 1, contextBytes: 1024 } }]],
    ["oh.memory.evolution-run.v2", [{ id: "spans", system: "oh-source-spans", budget: { topK: 100, contextBytes: 48000 } }]],
    ["oh.memory.evolution-run.v3", [{ id: "full", system: "full-history" }]],
  ] as const) {
    const config = { ...common, protocol, variants };
    expect(parseEvolutionRunConfig(config)).toEqual(config);
    expect(() => parseEvolutionRunConfig({ ...config, readers: [native] })).toThrow("reader profile");
  }
});

test("legacy proxy and native alias captures coexist without cache transplant or uncertain-charge release", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-native-judge-")));
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "synthetic-native-judge", storeDirectory: directory,
    approval: "Synthetic offline test; no provider calls", additionalBudgetMicros: 1000000, maximumCalls: 10, historicalExposureMicros: 0,
    historicalLedgers: [{ path: "/synthetic/ledger", sha256: hash, bytes: 0 }], authAuthority: { path: "/synthetic/auth", sha256: hash } };
  const proxy = makeEvolutionRequest("gpt4o-gateway-judge", messages), request = makeEvolutionRequest(native, single);
  const failed = makeEvolutionRequest(native, [{ role: "user", content: "Separate synthetic failure." }]);
  const requests = [proxy, request];
  try {
    const store = await openEvolutionStore({ directory, campaign });
    for (const r of requests) {
      store.admit(r); const body = response(r, "not yes");
      store.capture(r, { httpStatus: 200, body, receivedBytes: body.length, complete: true, error: null }); store.finalize(r);
    }
    store.admit(failed); store.capture(failed, { httpStatus: null, body: new Uint8Array(), receivedBytes: 0, complete: false, error: "network" });
    const summary = store.summary(); await store.close();
    const replay = await openEvolutionStore({ directory, campaign });
    try {
      expect(replay.summary()).toEqual(summary);
      expect(summary.calls).toBe(3);
      expect(summary.unresolvedMicros).toBe(failed.reservationMicros);
      for (const r of requests) expect(replay.lookup(r)).toEqual({ kind: "hit", result: parseEvolutionResponse(response(r, "not yes"), r) });
      expect(replay.readAttemptFailure(failed)).toMatchObject({ profileSha256: failed.profileSha256, reservationMicros: failed.reservationMicros });
      expect(() => replay.admit(failed)).toThrow("occupied");
    } finally { await replay.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
