import { expect, test } from "bun:test";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "../src/canonical";
import { DATASETS } from "../scripts/benchmarks/datasets";
import { executeEvolutionPhase, parseEvolutionRunConfig, prepareEvolution, prepareEvolutionJudges, prepareEvolutionReaders } from "../scripts/benchmarks/evolution";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";
import { assertEvolutionLiveProfiles } from "../scripts/benchmarks/evolution-live-admission";
import { EVOLUTION_PROFILES, makeEvolutionRequest, type EvolutionProfileId, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { evolutionJobKey } from "../scripts/benchmarks/evolution-reader-plan-v2";
import { executeEvolutionPhaseV9, prepareEvolutionV9, prepareEvolutionReadersV9, prepareEvolutionJudgesV9, runEvolutionJobsV9 } from "../scripts/benchmarks/evolution-runner-v9";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { invokeEvolutionRequest } from "../scripts/benchmarks/evolution-transport";

const native10 = "gpt4o-gateway-native-rubric-judge-v1";
const native16 = "gpt4o-gateway-native-rubric-16-judge-v1";
const direct10 = "gpt4o-official-snapshot-judge";
const blocked = /Evolution live admission:.*10-token.*historical replay only/;
const request = (profile: typeof native10 | typeof native16 | typeof direct10 = native10) => makeEvolutionRequest(profile, [{ role: "user", content: "Is the answer correct?" }]);
const campaign = (storeDirectory: string): EvolutionCampaign => ({ protocol: "oh.memory.evolution-campaign.v1", campaignId: "admission-test", storeDirectory,
  approval: "Synthetic regression only", additionalBudgetMicros: 100_000, maximumCalls: 10, historicalExposureMicros: 0,
  historicalLedgers: [{ path: "/tmp/fixture-ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/tmp/fixture-auth", sha256: "b".repeat(64) } });
function credential() {
  const auth = { method: "project-oidc" as const, project: "synthetic-admission", scope: "synthetic-team", environment: "development" as const };
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url"), now = Math.floor(Date.now() / 1000);
  return { kind: "gateway-oidc" as const, auth, token: `${encode({ alg: "RS256" })}.${encode({ sub: `owner:${auth.scope}:project:${auth.project}:environment:development`,
    aud: `https://vercel.com/${auth.scope}`, iss: "https://oidc.vercel.com", exp: now + 3600, iat: now })}.synthetic` };
}
function body(req: EvolutionRequest) {
  return new TextEncoder().encode(JSON.stringify({ model: req.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "yes" } }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }, ...(req.profileId === direct10 ? {} : {
      providerMetadata: { gateway: { routing: { finalProvider: req.provider, originalModelId: req.model, canonicalSlug: req.model } } } }) }));
}
async function withStore(run: (store: Awaited<ReturnType<typeof openEvolutionStore>>) => Promise<void>) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-live-admission-"))), store = await openEvolutionStore({ directory, campaign: campaign(directory) });
  try { await run(store); } finally { await store.close(); await rm(directory, { recursive: true, force: true }); }
}

test("live preflight rejects the known negative qualification without changing other catalog eligibility", () => {
  const eligible = (Object.keys(EVOLUTION_PROFILES) as EvolutionProfileId[]).filter(id => id !== native10);
  expect(() => assertEvolutionLiveProfiles(eligible)).not.toThrow();
  expect(() => assertEvolutionLiveProfiles([...eligible, native10])).toThrow(blocked);
  expect(() => assertEvolutionLiveProfiles(["unknown" as EvolutionProfileId])).toThrow(/unknown profile/);
});

test("new native10 Gateway requests fail before credentials, reservation or fetch", async () => {
  await withStore(async store => {
    let calls = 0;
    const before = store.summary(), req = request(), serialized = JSON.stringify(req);
    for (const token of [credential().token, ""]) await expect(invokeEvolutionRequest({ request: req, store, credential: { ...credential(), token },
      fetcher: async () => { calls++; return new Response(body(req)); } })).rejects.toThrow(blocked);
    expect(calls).toBe(0); expect(store.summary()).toEqual(before); expect(store.lookup(req).kind).toBe("miss");
    expect(JSON.stringify(req)).toBe(serialized); expect(req.body.max_tokens).toBe(10);
  });
});

test("native10 occupied evidence still recovers, replays and retains failed full reservations without dispatch", async () => {
  await withStore(async store => {
    const req = request(), raw = body(req); let calls = 0;
    const send = (repeat: number) => invokeEvolutionRequest({ request: req, repeat, store, credential: { ...credential(), token: "" },
      fetcher: async () => { calls++; throw Error("No fetch allowed"); } });
    store.admit(req); store.capture(req, { body: raw, complete: true, receivedBytes: raw.length, httpStatus: 200, error: null, serviceMs: 12 });
    const recovered = await send(0);
    expect(recovered.recovered).toBeTrue(); expect(recovered.result.answer).toBe("yes"); expect(recovered.result.rawSha256).toBe(sha256Hex(raw));
    const settled = store.summary(); expect((await send(0)).result).toEqual(recovered.result); expect(store.summary()).toEqual(settled);
    const rejected = new TextEncoder().encode('{"error":{"message":"max_output_tokens must be at least 16"}}');
    store.admit(req, 1); store.capture(req, { body: rejected, complete: true, receivedBytes: rejected.length, httpStatus: 400, error: null, serviceMs: 3 }, 1);
    store.admit(req, 2);
    const occupied = store.summary();
    await expect(send(1)).rejects.toThrow(); await expect(send(1)).rejects.toThrow(); await expect(send(2)).rejects.toThrow(/unresolved reservation/);
    expect(store.summary()).toEqual(occupied); expect(occupied.unresolvedMicros).toBe(2 * req.reservationMicros); expect(calls).toBe(0);
    expect(store.readAttemptFailure(req, 1)).toMatchObject({ rawSha256: sha256Hex(rejected), reservationMicros: req.reservationMicros });
    expect(store.readServiceMs(req)).toBe(12);
  });
});

test("separately identified Gateway16 and direct10 profiles still admit through the fake transport", async () => {
  await withStore(async store => {
    let calls = 0;
    for (const profile of [native16, direct10] as const) {
      const req = request(profile);
      const result = await invokeEvolutionRequest({ request: req, store, credential: profile === direct10 ? { kind: "benchmark-openai-key", token: "synthetic" } : credential(),
        fetcher: async () => { calls++; return new Response(body(req)); } });
      expect(result.cached).toBeFalse(); expect(result.result.answer).toBe("yes");
    }
    expect(calls).toBe(2); expect(store.summary()).toMatchObject({ calls: 2, unresolvedMicros: 0 });
  });
});

test("V9 mixed pending batch rejects before any call; zero-call recovery still admits no new jobs", async () => {
  await withStore(async store => {
    const good = request(native16), bad = request(); let calls = 0;
    const jobs = [good, bad].map(request => ({ request, repeat: 0, key: evolutionJobKey(request.requestSha256, 0) }));
    const input = { store, jobs, credential: credential(), concurrency: 24 as const, fetcher: async () => { calls++; return new Response(body(good)); } };
    const before = store.summary();
    await expect(runEvolutionJobsV9({ ...input, maxNewCalls: 2 })).rejects.toThrow(blocked);
    expect(calls).toBe(0); expect(store.summary()).toEqual(before);
    const raw = body(bad); store.admit(bad); store.capture(bad, { body: raw, complete: true, receivedBytes: raw.length, httpStatus: 200, error: null });
    const recovered = await runEvolutionJobsV9({ ...input, maxNewCalls: 0 });
    expect(recovered.admissionAttempts).toBe(0); expect(recovered.responses.get(jobs[1]!.key)?.answer).toBe("yes");
    expect(calls).toBe(0); expect(store.summary().calls).toBe(1);
    // A cached historical judge does not block unrelated fresh eligible work.
    const fresh = await runEvolutionJobsV9({ ...input, maxNewCalls: 1 });
    expect(fresh.admissionAttempts).toBe(1); expect(fresh.responses.size).toBe(2); expect(calls).toBe(1);
  });
});

test("legacy and V9 operational preflight rejects a downstream native10 judge before source or plan work", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "oh-admission-config-")));
  try {
    const missing = { path: join(root, "absent.json"), sha256: "a".repeat(64) };
    const common = { dataset: "longmemeval-s", datasetPin: { ...missing, sha256: DATASETS["longmemeval-s"].sha256 }, manifestPin: missing, campaignPin: missing,
      limit: 1, readers: ["gpt5-mini-reader"], judge: native10, directory: join(root, "run"), storeDirectory: join(root, "store") };
    const legacy = { ...common, protocol: "oh.memory.evolution-run.v1", seed: 17, concurrency: 1,
      variants: [{ id: "window-96k", system: "bm25-window", budget: { topK: 100, contextBytes: 96_000 } }] };
    const v9 = { ...common, protocol: "oh.memory.evolution-run.v9", concurrency: 24, studyPin: missing, scopePin: missing, shardId: "shard-001",
      variants: [{ id: "window-96k", system: "bm25-window", budget: { topK: 100, contextBytes: 96_000 } },
        { id: "semantic-96k", system: "oh-semantic", budget: { topK: 100, contextBytes: 96_000 } }],
      repeats: 1, judgeRepeats: 1, readerDatePolicy: "question-date", derivedRecordsPin: null, semanticCacheDirectory: join(root, "cache") };
    let sourceCalls = 0;
    const runtime = { identity: async () => { sourceCalls++; throw Error("No source identity expected"); },
      source: async () => { sourceCalls++; throw Error("No source read expected"); }, fetcher: async () => { sourceCalls++; throw Error("No fetch expected"); } };
    for (const config of [legacy, v9]) {
      expect(parseEvolutionRunConfig(config).judge).toBe(native10); // Historical artifact grammar remains valid.
      const configPath = join(root, `${config.protocol}.json`), serialized = JSON.stringify(config);
      await writeFile(configPath, serialized); const configPin = { path: configPath, sha256: sha256Hex(serialized) };
      for (const prepare of [() => prepareEvolution(configPin), () => prepareEvolutionReaders(configPin, missing), () => prepareEvolutionJudges(configPin, missing, missing)]) {
        await expect(prepare()).rejects.toThrow(blocked);
      }
      for (const phase of ["reader", "judge"] as const) {
        const input = { configPin, planPin: missing, phase, maxUsd: 1, maxNewCalls: 1, credential: credential(), output: join(root, "run", `${phase}.json`) };
        await expect(executeEvolutionPhase(input)).rejects.toThrow(blocked);
        if (config.protocol.endsWith(".v9")) await expect(executeEvolutionPhaseV9({ ...input, identity: runtime })).rejects.toThrow(blocked);
        // Replay reaches ordinary pinned-input validation; the live guard does not reject maxNewCalls: 0.
        await expect(executeEvolutionPhase({ ...input, maxNewCalls: 0 })).rejects.toThrow(/ENOENT/);
      }
      if (config.protocol.endsWith(".v9")) {
        await expect(prepareEvolutionV9(configPin, runtime)).rejects.toThrow(blocked);
        await expect(prepareEvolutionReadersV9(configPin, missing, runtime)).rejects.toThrow(blocked);
        await expect(prepareEvolutionJudgesV9(configPin, missing, missing, runtime)).rejects.toThrow(blocked);
      }
    }
    expect(sourceCalls).toBe(0);
    expect((await readdir(root)).sort()).toEqual(["oh.memory.evolution-run.v1.json", "oh.memory.evolution-run.v9.json"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
