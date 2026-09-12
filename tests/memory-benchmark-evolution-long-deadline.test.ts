import { expect, spyOn, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { makeEvolutionAnswerAuditMessages } from "../scripts/benchmarks/evolution-answer-audit";
import { EVOLUTION_LONG_DEADLINE_READER_PROFILE_ID as longId, EVOLUTION_TASK_COMPLETE_READER_PROFILE_ID, EVOLUTION_PROFILES, evolutionReaderContract,
  evolutionReaderProfileId, makeEvolutionRequest, makeEvolutionProfileWindowRequest, parseEvolutionResponse,
  supportsEvolutionProfileWindow, validateEvolutionRequest, type EvolutionProfileId, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { evolutionAnswerMessages } from "../scripts/benchmarks/evolution-reader-contracts";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { invokeEvolutionRequest } from "../scripts/benchmarks/evolution-transport";

const oldId = "gpt5-mini-explicit-abstention-composition-v1-reader";
const ordinary = [{ role: "system" as const, content: "Use supplied memory only." }, { role: "user" as const, content: "Which color?" }];
const single = [{ role: "user" as const, content: "Evaluate this LongMemEval answer exactly as instructed." }];
const messages = evolutionAnswerMessages({ question: "Which color?", questionDate: "2026-09-11" }, "[t0] Blue.", "explicit-abstention-composition-v1");

test("the opt-in deadline preserves all 101 prior profile/request bytes and all 54 profile-window requests", () => {
  const old = Object.entries(EVOLUTION_PROFILES).filter(([id]) => id !== longId && id !== EVOLUTION_TASK_COMPLETE_READER_PROFILE_ID).sort(([a], [b]) => a < b ? -1 : 1);
  const audit = makeEvolutionAnswerAuditMessages({ question: "Which color?", questionDate: "", originalMemory: "The synthetic tile is blue.", draftAnswer: "Blue." });
  const requests = old.map(([id, p]) => makeEvolutionRequest(id as EvolutionProfileId,
    id === "gpt5-mini-answer-audit-v1" ? audit : p.qualification === "official-snapshot-request"
      || ["gpt4o-gateway-native-rubric-judge-v1", "gpt4o-gateway-native-rubric-16-judge-v1", "gpt4o-beam-event-extraction-v1", "gpt4o-beam-nugget-v1"].includes(id) ? single : ordinary));
  const windows = old.filter(([id]) => supportsEvolutionProfileWindow(id as EvolutionProfileId))
    .map(([id]) => makeEvolutionProfileWindowRequest(id as EvolutionProfileId, ordinary));
  // Captured from untouched 0d95f0612ac0c8beba6357f7a86ca6b207621be0 before this addition.
  // JSON-byte digests include field order, every profile/request hash, and all accounting preimages.
  expect(old).toHaveLength(101);
  expect(String(sha256Hex(JSON.stringify(old)))).toBe("b21def7e807ec33313ea88313db3bc2e8ed53599ecf2a3a7fe0651d6c057aeb4");
  expect(String(sha256Hex(JSON.stringify(requests)))).toBe("5cfc5337224a724025ca78f2dfe57e478f852962e1fef4cf437e975f45f763fa");
  expect(windows).toHaveLength(54);
  expect(String(sha256Hex(JSON.stringify(windows)))).toBe("556d1793bb16f3504e4e7e30bc0c13b08299b20503ac265947a32fe5b87faa67");
});

test("only identity and deadline differ; the default EAC selector, body, cost and admission bounds stay fixed", () => {
  expect(EVOLUTION_PROFILES[longId]).toEqual({ ...EVOLUTION_PROFILES[oldId], id: longId, timeoutMs: 600000 });
  expect(EVOLUTION_PROFILES[oldId].timeoutMs).toBe(120000);
  expect(Object.isFrozen(EVOLUTION_PROFILES[longId])).toBe(true);
  expect(Object.isFrozen(EVOLUTION_PROFILES[longId].readerContract)).toBe(true);
  expect(evolutionReaderProfileId("gpt5-mini-reader", "explicit-abstention-composition-v1")).toBe(oldId);
  expect(evolutionReaderContract(longId)).toBe("explicit-abstention-composition-v1");
  expect(supportsEvolutionProfileWindow(longId)).toBe(true);
  for (const prepare of [makeEvolutionRequest, makeEvolutionProfileWindowRequest]) {
    const old = prepare(oldId, messages), extended = prepare(longId, messages);
    const { profileId: _oldId, profileSha256: oldProfile, requestSha256: oldRequest, timeoutMs: _oldTimeout, ...oldRest } = old;
    const { profileId: _newId, profileSha256: newProfile, requestSha256: newRequest, timeoutMs: _newTimeout, ...newRest } = extended;
    expect(newRest).toEqual(oldRest);
    expect(JSON.stringify(extended.body)).toBe(JSON.stringify(old.body));
    expect(extended.timeoutMs).toBe(600000); expect(newProfile).not.toBe(oldProfile); expect(newRequest).not.toBe(oldRequest);
    expect(validateEvolutionRequest(structuredClone(extended))).toEqual(extended);
    expect(extended.body.reasoning).toEqual({ effort: "medium" }); expect(extended.maxOutputTokens).toBe(8192);
  }
  expect(() => makeEvolutionRequest(longId, single)).toThrow("prompt shape");
  expect(() => makeEvolutionRequest(longId, [{ ...ordinary[0]! }, { role: "user", content: "x".repeat(400000) }])).toThrow("context bound");
});

test("resealed deadline or profile transplants fail native reconstruction for both request protocols", () => {
  for (const prepare of [makeEvolutionRequest, makeEvolutionProfileWindowRequest]) for (const id of [oldId, longId] as const) {
    const request = prepare(id, messages);
    for (const patch of [(r: any) => { r.timeoutMs = id === oldId ? 600000 : 120000; },
      (r: any) => { r.timeoutMs = 600001; }, (r: any) => { r.profileId = id === oldId ? longId : oldId; },
      (r: any) => { r.profileSha256 = canonicalSha256(EVOLUTION_PROFILES[id === oldId ? longId : oldId]); },
      (r: any) => { r.reservationMicros--; }, (r: any) => { r.body.reasoning.effort = "low"; }]) {
      const changed = structuredClone(request); patch(changed); const { requestSha256: _, ...preimage } = changed;
      expect(() => validateEvolutionRequest({ ...preimage, requestSha256: canonicalSha256(preimage) })).toThrow("request changed");
    }
  }
});

const reply = (request: EvolutionRequest) => new TextEncoder().encode(JSON.stringify({ model: request.model,
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Blue." } }],
  usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  providerMetadata: { gateway: { routing: { finalProvider: "openai", originalModelId: request.model, canonicalSlug: request.model,
    resolvedProviderApiModelId: "gpt-5-mini" } } } }));

test("native transport uses the 600000 ms signal and preserves old and new occupied jobs without retries", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-reader-deadline-")));
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "deadline-synthetic", storeDirectory: directory,
    approval: "Synthetic fake-fetch test only; no provider requests", additionalBudgetMicros: 100000, maximumCalls: 3, historicalExposureMicros: 0,
    historicalLedgers: [{ path: "/fixture/unused-ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/fixture/unused-authority", sha256: "b".repeat(64) } };
  const now = Math.floor(Date.now() / 1000), encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const auth = { method: "project-oidc" as const, project: "fixture", scope: "fixture", environment: "development" as const };
  const credential = { kind: "gateway-oidc" as const, auth, token: `${encode({ alg: "RS256" })}.${encode({ sub: "owner:fixture:project:fixture:environment:development",
    aud: "https://vercel.com/fixture", iss: "https://oidc.vercel.com/fixture", exp: now + 1200, iat: now })}.synthetic` };
  let store = await openEvolutionStore({ directory, campaign }), fetches = 0;
  const old = makeEvolutionRequest(oldId, messages), extended = makeEvolutionRequest(longId, messages);
  const failing = makeEvolutionRequest(longId, [...messages.slice(0, 1), { role: "user", content: "Distinct synthetic deadline failure." }]);
  const scheduled: number[] = [], signals: AbortController[] = [];
  const timer = spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    scheduled.push(ms); const controller = new AbortController(); signals.push(controller); return controller.signal;
  });
  try {
    store.admit(old); store.capture(old, { httpStatus: null, body: new Uint8Array(), complete: false, receivedBytes: 0, error: "network", serviceMs: 120001 });
    const oldFailure = store.readAttemptFailure(old);
    expect(store.lookup(extended).kind).toBe("miss");
    const raw = reply(extended);
    const success = await invokeEvolutionRequest({ request: extended, store, credential, fetcher: async (_url, init) => {
      fetches++; expect(init.signal).toBe(signals[0]!.signal); expect(init.body).toBe(JSON.stringify(old.body)); return new Response(raw);
    } });
    expect(success.result).toEqual(parseEvolutionResponse(raw, extended)); expect(store.readRaw(extended)).toEqual(raw);
    await expect(invokeEvolutionRequest({ request: failing, store, credential, fetcher: async (_url, init) => {
      fetches++; expect(init.signal).toBe(signals[1]!.signal); signals[1]!.abort(); throw Error("Synthetic deadline; no network");
    } })).rejects.toThrow();
    expect(scheduled).toEqual([600000, 600000]);
    const newFailure = store.readAttemptFailure(failing);
    expect(newFailure).toMatchObject({ storeStatus: "captured", reason: "unverifiable-first-response", rawBytes: 0,
      rawSha256: sha256Hex(new Uint8Array()), reservationMicros: failing.reservationMicros,
      transport: { httpStatus: null, complete: false, receivedBytes: 0, error: "network" } });
    expect(store.readAttemptFailure(old)).toEqual(oldFailure);
    expect(store.summary()).toMatchObject({ calls: 3, unresolvedMicros: old.reservationMicros + failing.reservationMicros });
    const summary = store.summary(); await store.close(); store = await openEvolutionStore({ directory, campaign });
    const forbidden = async () => { fetches++; throw Error("Occupied key fetched again"); };
    for (const request of [old, failing]) await expect(invokeEvolutionRequest({ request, store, credential, fetcher: forbidden })).rejects.toThrow();
    const cached = await invokeEvolutionRequest({ request: extended, store, credential: { ...credential, token: "" }, fetcher: forbidden });
    expect(cached.cached).toBe(true); expect(cached.result).toEqual(success.result);
    expect(store.readAttemptFailure(old)).toEqual(oldFailure); expect(store.readAttemptFailure(failing)).toEqual(newFailure);
    expect(store.summary()).toEqual(summary); expect(fetches).toBe(2); expect(scheduled).toEqual([600000, 600000]);
  } finally { timer.mockRestore(); await store.close(); await rm(directory, { recursive: true, force: true }); }
});
