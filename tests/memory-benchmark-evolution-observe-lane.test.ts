import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalSha256, sha256Hex } from "../src/canonical";
import { OH_OBSERVATION_INSTRUCTION_SHA256_V1, OH_OBSERVATION_INSTRUCTION_V1, ohObservationActivityKeyV1, ohObservationKeyV1,
  parseOhObservationActivityValueV1, parseOhObservationRecordV1 } from "../src/observe";
import type { EvolutionCampaign, EvolutionPin } from "../scripts/benchmarks/evolution-budget";
import { EVOLUTION_PROFILES } from "../scripts/benchmarks/evolution-model";
import { EVOLUTION_OBSERVE_LANE_POLICY, OBSERVE_LANE_MAXIMUM_CAMPAIGN_MICROS, observeLaneArtifactName, observeLaneCorpusSha256,
  observeLaneSessions, parseObserveLaneConfig, parseObserveLaneSource, prepareEvolutionObserveLane, projectObserveLaneSource,
  rebuildObserveLaneRecords, runEvolutionObserveLane, type ObserveLaneConfig } from "../scripts/benchmarks/evolution-observe-lane";
import { codeIdentity } from "../scripts/benchmarks/io";
import { parseObserveFixtureCorpus } from "../scripts/benchmarks/observe-rubric";

const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No provider or network in lane fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });

const auth = { method: "project-oidc" as const, project: "synthetic-observe", scope: "synthetic-team", environment: "development" as const };
async function corpora() {
  const fixture = parseObserveFixtureCorpus(JSON.parse(await readFile(join(import.meta.dir, "fixtures", "observe-fixture-corpus-v1.json"), "utf8")));
  return fixture.corpora;
}
function raw(answer: string, finish = "stop") {
  const model = "openai/gpt-5-nano", provider = Object.values(EVOLUTION_PROFILES).find(p => p.model === model)!.provider;
  return new TextEncoder().encode(JSON.stringify({ model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }, providerMetadata: { gateway: { cost: "0.0001",
      routing: { finalProvider: provider, originalModelId: model, canonicalSlug: model } } } }));
}
function credential() {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url"), now = Math.floor(Date.now() / 1000);
  return { kind: "gateway-oidc" as const, auth, token: `${encode({ alg: "RS256" })}.${encode({ sub: `owner:${auth.scope}:project:${auth.project}:environment:development`,
    aud: `https://vercel.com/${auth.scope}`, iss: "https://oidc.vercel.com", exp: now + 3600, iat: now })}.synthetic` };
}
async function fixture(options: Readonly<{ maximumNewCalls?: number; budgetMicros?: number; laneCapMicros?: number }> = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-observe-lane-")));
  async function pin(name: string, value: unknown): Promise<EvolutionPin> { const content = typeof value === "string" ? value : JSON.stringify(value), path = join(directory, name);
    await writeFile(path, content, { mode: 0o600 }); return { path, sha256: sha256Hex(content) }; }
  const sourceCorpora = await corpora();
  const runnerInput = { corpora: sourceCorpora, questions: sourceCorpora.map((c, i) => ({ id: `q${i}`, corpusId: c.id, question: `PRIVATE_QUESTION_${i}`, questionDate: "2026-09-01" })) };
  const source = projectObserveLaneSource(runnerInput);
  const sourcePin = await pin("source.json", source), ledger = await pin("historical.jsonl", "");
  const authAuthority = await pin("auth.json", { schema: "oh.gateway-v3-authority.v1", ...auth });
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "synthetic-observe", storeDirectory: join(directory, "store"),
    approval: "Fake provider only; no network or real credentials", additionalBudgetMicros: options.budgetMicros ?? 10_000_000, maximumCalls: 500,
    historicalExposureMicros: 0, historicalLedgers: [{ ...ledger, bytes: 0 }], authAuthority };
  const config: ObserveLaneConfig = { protocol: "oh.memory.observe-lane-experiment.v1", partition: "development", sourcePin, campaignPin: await pin("campaign.json", campaign),
    executionSourceSha256: (await codeIdentity()).sourceSha256, extractor: "gpt5-nano-reader", maximumNewCalls: options.maximumNewCalls ?? 500, concurrency: 2,
    maximumCampaignMicros: options.laneCapMicros ?? OBSERVE_LANE_MAXIMUM_CAMPAIGN_MICROS };
  const configPin = await pin("config.json", config);
  return { directory, pin, sourceCorpora, source, campaign, config, configPin };
}
/** A deterministic provider that distils every turn into one observation; it never sees a question. */
function fakeProvider(mode: "normal" | "mixed" | "network" = "normal") {
  const counts = { extractor: 0 }, prompts: string[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions"); expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body)); counts.extractor++;
    expect(body.model).toBe("openai/gpt-5-nano"); expect(body.max_tokens).toBe(8192); expect(body.messages).toHaveLength(2);
    expect(body.messages[0].content).toBe(OH_OBSERVATION_INSTRUCTION_V1); prompts.push(body.messages[1].content);
    const prompt = JSON.parse(body.messages[1].content) as { sessionDate: string; turns: { id: string; speaker: string; text: string }[] };
    expect(Object.keys(prompt).sort()).toEqual(["sessionDate", "turns"]);
    if (mode === "network") throw new Error("Synthetic network uncertainty");
    const first = prompt.turns[0]!.text;
    if (mode === "mixed" && first.startsWith("Pottery update")) return new Response(raw("{\"observations\": ["), { status: 200 });
    if (mode === "mixed" && first.startsWith("Tomorrow I fly")) return new Response(raw("{\"observations\": []", "length"), { status: 200 });
    const observations = prompt.turns.map((turn, i) => ({ text: `${turn.speaker} said: ${turn.text}`, speaker: turn.speaker, kind: "fact", eventAt: null,
      resolvedFrom: null, facet: `topic-${i}`, sources: [turn.id] }));
    return new Response(raw(JSON.stringify({ observations })), { status: 200 });
  };
  return { fetcher, counts, prompts };
}

test("the lane descriptor freezes the instruction, restricts extractors to nano or mini, and caps the campaign at $20", async () => {
  const f = await fixture();
  try {
    expect(EVOLUTION_OBSERVE_LANE_POLICY).toMatchObject({ instructionSha256: OH_OBSERVATION_INSTRUCTION_SHA256_V1, defaultExtractor: "gpt5-nano-reader",
      requestsPerSession: 1, input: "corpus-sessions-only", maximumCampaignMicros: 20_000_000, extractors: ["gpt5-nano-reader", "gpt5-mini-reader"] });
    expect(Object.isFrozen(EVOLUTION_OBSERVE_LANE_POLICY)).toBeTrue();
    expect(parseObserveLaneConfig({ ...f.config, extractor: "gpt5-mini-reader" }).extractor).toBe("gpt5-mini-reader");
    expect(() => parseObserveLaneConfig({ ...f.config, extractor: "gpt5-low-reader" })).toThrow("nano or GPT-5 mini");
    expect(() => parseObserveLaneConfig({ ...f.config, extractor: "gpt4o-gateway-judge" })).toThrow("nano or GPT-5 mini");
    expect(() => parseObserveLaneConfig({ ...f.config, maximumCampaignMicros: 20_000_001 })).toThrow("$20");
    expect(() => parseObserveLaneConfig({ ...f.config, partition: "sealed" })).toThrow();
    expect(() => parseObserveLaneConfig({ ...f.config, questionIds: [] })).toThrow("config shape");
    expect(JSON.stringify(f.source)).not.toContain("PRIVATE_QUESTION"); expect(Object.keys(f.source)).toEqual(["protocol", "partition", "corpora"]);
    expect(() => parseObserveLaneSource({ ...f.source, questions: [] })).toThrow("source shape");
    expect(() => parseObserveLaneSource({ ...f.source, corpora: [{ ...f.source.corpora[0], turns: [...f.source.corpora[0]!.turns, f.source.corpora[0]!.turns[0]] }] })).toThrow("duplicate IDs");
    expect(observeLaneArtifactName(observeLaneCorpusSha256(f.sourceCorpora[0]!), "gpt5-nano-reader")).toMatch(/^observations-[a-f0-9]{64}-gpt5-nano-reader\.json$/u);
    expect(() => observeLaneArtifactName("x", "gpt5-nano-reader")).toThrow();
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("prepare builds exactly one frozen request per session from corpus sessions only", async () => {
  const f = await fixture();
  try {
    const plan = await prepareEvolutionObserveLane(f.configPin);
    expect(plan).toMatchObject({ protocol: "oh.memory.observe-lane-plan.v1", extractor: "gpt5-nano-reader", instructionSha256: OH_OBSERVATION_INSTRUCTION_SHA256_V1,
      configSha256: canonicalSha256(f.config), sourceSha256: canonicalSha256(f.source), policySha256: canonicalSha256(EVOLUTION_OBSERVE_LANE_POLICY), maximumPhysicalCalls: 8 });
    expect(plan.cases).toHaveLength(8); expect(plan.requests).toHaveLength(8);
    expect(plan.cases.every(c => c.preparationFailure === null && c.requestSha256 !== null && c.sessionSha256 !== null)).toBeTrue();
    expect(plan.corpora).toEqual(f.sourceCorpora.map(c => ({ corpusId: c.id, corpusSha256: observeLaneCorpusSha256(c), sessions: observeLaneSessions(c).length })));
    expect(plan.reservationMicros).toBe(plan.requests.reduce((s, r) => s + r.reservationMicros, 0));
    expect(plan.cases[0]!.turnKeys).toEqual(["edition:turn-00000", "edition:turn-00001", "edition:turn-00002"]);
    expect(plan.cases[3]!.turnKeys).toEqual(["edition:turn-00000", "edition:turn-00001", "edition:turn-00002"]);
    for (const request of plan.requests) {
      expect(request.body.messages[0]!.content).toBe(OH_OBSERVATION_INSTRUCTION_V1);
      expect(JSON.stringify(request)).not.toMatch(/PRIVATE_QUESTION|questionDate/u);
    }
    expect(Object.isFrozen(plan)).toBeTrue();
    expect(await prepareEvolutionObserveLane(f.configPin)).toEqual(plan);
    // A campaign budget above the lane's declared cap is refused before any plan exists.
    const wide = await fixture({ budgetMicros: 25_000_000 });
    try { await expect(prepareEvolutionObserveLane(wide.configPin)).rejects.toThrow("exceeds the declared lane cap"); }
    finally { await rm(wide.directory, { recursive: true, force: true }); }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("run captures one response per session into a rebuildable artifact with the Phase A diagnostics, and replays with zero calls", async () => {
  const f = await fixture(), fake = fakeProvider();
  try {
    const plan = await prepareEvolutionObserveLane(f.configPin), planPin = await f.pin("plan.json", plan);
    const artifact = await runEvolutionObserveLane({ configPin: f.configPin, planPin, credential: credential(), fetcher: fake.fetcher });
    expect(fake.counts.extractor).toBe(8);
    for (const prompt of fake.prompts) expect(prompt).not.toMatch(/PRIVATE_QUESTION|question|answer|gold/iu);
    expect(artifact).toMatchObject({ protocol: "oh.memory.observations.v1", complete: true, status: "complete", stopped: false, extractor: "gpt5-nano-reader",
      planSha256: plan.planSha256, instructionSha256: OH_OBSERVATION_INSTRUCTION_SHA256_V1, serviceQualification: { sessions: 3, completedExtractorResponses: 3 } });
    expect(artifact.total).toMatchObject({ physicalRequests: 8, newlyOccupied: 8, completed: 8, confirmedMicros: 800, unresolvedMicros: 0 });
    expect(artifact.diagnostics).toMatchObject({ sessions: 8, completed: 8, rejected: 0, failed: 0, notRun: 0, observations: 19, parserRejectionRate: 0,
      observationsPerSession: 19 / 8, facetFillRate: 1 });
    expect(artifact.diagnostics.byteShare).toBeGreaterThan(0.5);
    expect(artifact.corpora.map(c => c.sessions.length)).toEqual([3, 3, 2]);
    for (const c of artifact.corpora) for (const s of c.sessions) {
      expect(s).toMatchObject({ status: "completed", rejection: null, rejectionIndex: null });
      expect(s.responseSha256).toBe(sha256Hex(s.response!)); expect(s.observationCount).toBe(s.turnKeys.length);
    }
    const derived = await rebuildObserveLaneRecords(f.sourceCorpora[0]!, artifact.corpora[0]!, { extractor: "gpt5-nano-reader" });
    expect(derived.turns).toHaveLength(8); expect(derived.sessions).toHaveLength(3); expect(derived.derived).toHaveLength(3 + 8);
    const [first] = artifact.corpora[0]!.sessions;
    expect(derived.sessions[0]).toEqual({ sessionSha256: first!.sessionSha256!, activityKey: ohObservationActivityKeyV1(first!.sessionSha256! as never),
      observationKeys: [0, 1, 2].map(i => ohObservationKeyV1(first!.sessionSha256! as never, i)) });
    const receipt = parseOhObservationActivityValueV1(derived.derived[0]!.value)!;
    expect(receipt).toMatchObject({ modelId: "gpt5-nano-reader", instructionSha256: OH_OBSERVATION_INSTRUCTION_SHA256_V1, responseSha256: first!.responseSha256, observationCount: 3 });
    const observation = parseOhObservationRecordV1(derived.derived[1]!)!;
    expect(observation.value.sources).toEqual([{ key: "edition:turn-00000", recordSha256: derived.turns[0]!.recordSha256, v: 1 }]);
    expect(observation.value.text).toBe(`user said: ${f.sourceCorpora[0]!.turns[0]!.text}`);
    expect(observation.dependencies).toContain("edition:turn-00000");
    // Rebuilding twice is byte-identical, and a foreign corpus is refused.
    expect(await rebuildObserveLaneRecords(f.sourceCorpora[0]!, artifact.corpora[0]!, { extractor: "gpt5-nano-reader" })).toEqual(derived);
    await expect(rebuildObserveLaneRecords(f.sourceCorpora[1]!, artifact.corpora[0]!, { extractor: "gpt5-nano-reader" })).rejects.toThrow("does not describe this corpus");
    const chained = await rebuildObserveLaneRecords(f.sourceCorpora[0]!, artifact.corpora[0]!, { extractor: "gpt5-nano-reader", supersession: true });
    expect(chained.derived.map(r => r.key)).toEqual(derived.derived.map(r => r.key));
    const replay = await runEvolutionObserveLane({ configPin: f.configPin, planPin, credential: { ...credential(), token: "" },
      fetcher: async () => { throw new Error("Never redispatch cached captures"); } });
    expect(replay.total).toMatchObject({ newlyOccupied: 0, cacheHits: 8, confirmedMicros: 800 });
    expect(replay.corpora).toEqual(artifact.corpora); expect(replay.diagnostics).toEqual(artifact.diagnostics); expect(replay.campaignAfter).toEqual(artifact.campaignAfter);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 30_000);

test("rejected and truncated sessions are recorded with their reason and never rebuild; charges remain", async () => {
  const f = await fixture(), fake = fakeProvider("mixed");
  try {
    const plan = await prepareEvolutionObserveLane(f.configPin), planPin = await f.pin("plan.json", plan);
    const artifact = await runEvolutionObserveLane({ configPin: f.configPin, planPin, credential: credential(), fetcher: fake.fetcher });
    expect(fake.counts.extractor).toBe(8); expect(artifact.complete).toBeTrue();
    expect(artifact.diagnostics).toMatchObject({ sessions: 8, completed: 6, rejected: 1, failed: 1, notRun: 0, parserRejectionRate: 1 / 7 });
    expect(artifact.diagnostics.rejections["response-not-json"]).toBe(1);
    const rejected = artifact.corpora[0]!.sessions.find(s => s.sessionId === "h2")!, failed = artifact.corpora[1]!.sessions.find(s => s.sessionId === "w2")!;
    expect(rejected).toMatchObject({ status: "rejected", rejection: "response-not-json", rejectionIndex: null, observationCount: 0, response: "{\"observations\": [" });
    expect(failed).toMatchObject({ status: "failed", rejection: null, response: null, responseSha256: null, observationCount: 0 });
    const derived = await rebuildObserveLaneRecords(f.sourceCorpora[0]!, artifact.corpora[0]!, { extractor: "gpt5-nano-reader" });
    expect(derived.sessions.map(s => s.observationKeys.length)).toEqual([3, 3]);
    expect(artifact.total.confirmedMicros).toBe(800);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 30_000);

test("uncertain dispatch retains reservations without retry, and a zero allowance leaves every session not-run", async () => {
  for (const limit of [500, 0]) {
    const f = await fixture({ maximumNewCalls: limit }), fake = fakeProvider("network");
    try {
      const plan = await prepareEvolutionObserveLane(f.configPin), planPin = await f.pin("plan.json", plan);
      const artifact = await runEvolutionObserveLane({ configPin: f.configPin, planPin, credential: credential(), fetcher: fake.fetcher });
      expect(artifact.complete).toBeFalse(); expect(artifact.diagnostics.completed).toBe(0); expect(artifact.total.confirmedMicros).toBe(0);
      if (limit === 0) { expect(fake.counts.extractor).toBe(0); expect(artifact.diagnostics.notRun).toBe(8); }
      else { expect(artifact.total.unresolvedMicros).toBeGreaterThan(0); expect(artifact.stopped).toBeTrue(); }
      const calls = fake.counts.extractor;
      const replay = await runEvolutionObserveLane({ configPin: f.configPin, planPin, credential: credential(), fetcher: fake.fetcher });
      expect(fake.counts.extractor).toBe(calls); expect(replay.campaignAfter).toEqual(artifact.campaignAfter);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  }
}, 30_000);

test("plan, source and campaign pins fail before provider admission", async () => {
  const f = await fixture(), fake = fakeProvider();
  try {
    const plan = await prepareEvolutionObserveLane(f.configPin), planPin = await f.pin("plan.json", plan);
    const changed = structuredClone(plan) as any; changed.cases[0].turnKeys = []; const badPin = await f.pin("bad-plan.json", changed);
    await expect(runEvolutionObserveLane({ configPin: f.configPin, planPin: badPin, credential: credential(), fetcher: fake.fetcher })).rejects.toThrow("prepared plan changed");
    await writeFile(f.config.sourcePin.path, JSON.stringify({ ...f.source, corpora: f.source.corpora.slice(1) }));
    await expect(runEvolutionObserveLane({ configPin: f.configPin, planPin, credential: credential(), fetcher: fake.fetcher })).rejects.toThrow("pinned content changed");
    expect(fake.counts.extractor).toBe(0);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
