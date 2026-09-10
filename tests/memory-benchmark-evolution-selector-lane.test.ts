import { test, expect } from "bun:test";
import { mkdtemp, realpath, writeFile, rm, truncate } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { codeIdentity } from "../scripts/benchmarks/io";
import { EVOLUTION_PROFILES, evolutionReaderProfileId, evolutionReaderContract } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { parseSelectorLaneConfig, parseSelectorLaneSource, readSelectorLaneSource, SELECTOR_LANE_SOURCE_MAX_BYTES, prepareSelectorLane, runSelectorLane, type SelectorLaneConfig } from "../scripts/benchmarks/evolution-selector-lane";
import { EVOLUTION_ANSWER_CONTRACT_IDS, EVOLUTION_READER_CONTRACTS, EVOLUTION_READER_CONTRACT_IDS } from "../scripts/benchmarks/evolution-reader-contracts";
import { answerMessages } from "../scripts/benchmarks/model";
import type { EvolutionCampaign, EvolutionPin } from "../scripts/benchmarks/evolution-budget";

const auth = { method: "project-oidc" as const, project: "synthetic-selector", scope: "synthetic-team", environment: "development" as const };
function credential() {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return { kind: "gateway-oidc" as const, auth, token: `${encode({ alg: "RS256" })}.${encode({ sub: `owner:${auth.scope}:project:${auth.project}:environment:development`,
    aud: `https://vercel.com/${auth.scope}`, iss: "https://oidc.vercel.com", exp: now + 3600, iat: now })}.synthetic` };
}
async function fixture(readers: SelectorLaneConfig["readers"] = ["gpt5-nano-reader", "gpt5-nano-medium-reader"], maximumNewCalls = 100) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-selector-lane-")));
  async function pin(name: string, value: unknown): Promise<EvolutionPin> {
    const bytes = typeof value === "string" ? value : JSON.stringify(value);
    const path = join(directory, name); await writeFile(path, bytes, { mode: 0o600 }); return { path, sha256: sha256Hex(bytes) };
  }
  const source = { protocol: "oh.memory.source-selector-input.v1", partition: "development", corpora: [{ id: "corpus", turns: [
    { id: "launch", sessionId: "session-one", sessionIndex: 0, date: "2026-01-01", speaker: "user", text: "The launch color is blue." },
    { id: "landing", sessionId: "session-two", sessionIndex: 1, date: "2026-01-02", speaker: "user", text: "The landing color is red." },
    { id: "decoy", sessionId: "session-three", sessionIndex: 2, date: "2026-01-03", speaker: "user", text: "Distractor: launch and landing color posters are green." },
  ] }], questions: [
    { id: "q1", corpusId: "corpus", question: "What is the launch color?", questionDate: "2026-01-04" },
    { id: "q2", corpusId: "corpus", question: "What is the landing color?", questionDate: "2026-01-04" },
  ] };
  const input = parseSelectorLaneSource(source), sourcePin = await pin("source.json", source);
  const scorerPin = await pin("scorer.json", { protocol: "oh.memory.source-selector-scoring-input.v1", inputSha256: canonicalSha256(input),
    questions: source.questions.map((q, i) => ({ ...q, answer: `SECRET_GOLD_${i === 0 ? "blue" : "red"}`, category: "single-session-user", unanswerable: false,
      evidenceSessionIds: [], evidenceTurnIds: [] })) });
  const ledger = await pin("historical.jsonl", ""), authAuthority = await pin("auth.json", { schema: "oh.gateway-v3-authority.v1", ...auth });
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "synthetic-selector-lane", storeDirectory: join(directory, "store"),
    approval: "Offline synthetic fake-provider test only; never send this fixture token", additionalBudgetMicros: 10_000_000, maximumCalls: 100,
    historicalExposureMicros: 0, historicalLedgers: [{ ...ledger, bytes: 0 }], authAuthority };
  const campaignPin = await pin("campaign.json", campaign), identity = await codeIdentity();
  const config: SelectorLaneConfig = { protocol: "oh.memory.source-selector-experiment.v1", sourcePin, scorerPin, campaignPin,
    executionSourceSha256: identity.sourceSha256, readers, maximumNewCalls, concurrency: 2, partition: "development" };
  const configPin = await pin("config.json", config), plan = await prepareSelectorLane(configPin), planPin = await pin("plan.json", plan);
  return { directory, pin, source, sourcePin, scorerPin, campaign, config, configPin, plan, planPin };
}
function provider(mode: "normal" | "invalid-selector" | "network" | "reader-truncated" | "judge-truncated" = "normal") {
  let calls = 0, selectorCalls = 0, readerCalls = 0, judgeCalls = 0;
  const requests: unknown[] = [];
  const fetcher = async (url: string, init: RequestInit): Promise<Response> => {
    calls++; expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
    expect(init.redirect).toBe("error"); expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)); requests.push(body);
    const isSelector = body.messages[0].content.startsWith("Select original source turns");
    const isJudge = body.messages.length === 1;
    let answer: string;
    if (isSelector) {
      selectorCalls++;
      expect(JSON.stringify(body)).not.toContain("SECRET_GOLD");
      const prompt = JSON.parse(body.messages[1].content);
      expect(Object.keys(prompt).sort()).toEqual(["question", "questionDate", "sources"]);
      expect(prompt.sources.every((s: any) => /^s\d{3}$/.test(s.id))).toBeTrue();
      if (mode === "network") throw new Error("Synthetic network uncertainty");
      const launch = prompt.question.includes("launch");
      const selected = prompt.sources.find((s: any) => s.text === (launch ? "The launch color is blue." : "The landing color is red."));
      answer = mode === "invalid-selector" && launch ? '{"ids":["s999"]}' : JSON.stringify({ ids: [selected.id] });
    } else if (isJudge) {
      judgeCalls++; expect(body.max_tokens).toBe(16); expect(body.messages[0].content).toContain("SECRET_GOLD");
      answer = body.messages[0].content.includes("WRONG") ? "no" : "yes";
    } else {
      readerCalls++; expect(JSON.stringify(body)).not.toContain("SECRET_GOLD");
      const prompt = JSON.parse(body.messages[1].content);
      answer = prompt.memory.includes("Distractor") ? "WRONG" : prompt.question.includes("launch") ? "blue" : "red";
    }
    const selectedProfile = Object.values(EVOLUTION_PROFILES).find(p => p.model === body.model)!;
    const wire = { model: body.model, choices: [{ index: 0, finish_reason: mode === "reader-truncated" && !isSelector && !isJudge || mode === "judge-truncated" && isJudge ? "length" : "stop", message: { role: "assistant", content: answer } }],
      usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
      providerMetadata: { gateway: { cost: "0.0001", routing: { finalProvider: selectedProfile.provider, originalModelId: body.model, canonicalSlug: body.model } } } };
    await Promise.resolve(); return new Response(JSON.stringify(wire), { status: 200 });
  };
  return { fetcher, requests, counts: () => ({ calls, selectorCalls, readerCalls, judgeCalls }) };
}

test("complete pinned fake-provider selector -> source readback -> reader -> native judge paired report and replay", async () => {
  const f = await fixture(), fake = provider();
  try {
    expect(f.plan.maximumSelectorCalls).toBe(2); expect(f.plan.maximumSelectorReservationMicros).toBeGreaterThan(0);
    const report = await runSelectorLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.complete).toBeTrue(); expect(report.stopped).toBeFalse(); expect(report.denominator).toBe(2);
    expect(report.cases).toHaveLength(8);
    expect(fake.counts()).toEqual({ calls: 14, selectorCalls: 2, readerCalls: 8, judgeCalls: 4 });
    expect(report.attempts).toHaveLength(14); expect(report.total).toMatchObject({ newlyOccupied: 14, occupiedRequests: 14, confirmedMicros: 1400, unresolvedMicros: 0 });
    expect(report.campaignAfter).toMatchObject({ calls: 14, confirmedMicros: 1400, unresolvedMicros: 0 });
    expect(report.phases.selector).toMatchObject({ physicalRequests: 2, confirmedMicros: 200 });
    expect(report.phases.reader).toMatchObject({ physicalRequests: 8, confirmedMicros: 800 });
    expect(report.phases.judge).toMatchObject({ physicalRequests: 4, confirmedMicros: 400 });
    for (const pair of report.paired) expect(pair).toMatchObject({ denominator: 2, meanDelta: 1, wins: 2, losses: 0 });
    for (const summary of report.summaries) {
      expect(summary.denominator).toBe(2); expect(summary.failedCases).toBe(0); expect(summary.missingEndToEndTimes).toBe(0);
      expect(summary.accuracy).toBe(summary.arm === "selected-sources" ? 1 : 0);
      expect(summary.accounting.confirmedMicros).toBe(summary.arm === "selected-sources" ? 600 : 400);
    }
    for (const c of report.cases.filter(c => c.arm === "selected-sources")) {
      expect(c.context?.kind).toBe("selected-sources");
      expect(c.context?.result.protocol).toBe("oh.memory.selected-source-context.v1-prototype");
      expect(c.context?.result.context).not.toContain("Distractor");
      expect(c.context?.result.context).toContain(c.questionId === "q1" ? "The launch color is blue." : "The landing color is red.");
    }
    const replay = await runSelectorLane({ configPin: f.configPin, planPin: f.planPin, credential: { ...credential(), token: "" },
      fetcher: async () => { throw new Error("No second network call permitted"); } });
    expect(replay.total).toMatchObject({ newlyOccupied: 0, cacheHits: 14, confirmedMicros: 1400, unresolvedMicros: 0 });
    expect(replay.paired).toEqual(report.paired); expect(replay.campaignAfter).toEqual(report.campaignAfter);
    expect(replay.cases).toEqual(report.cases);
    const store = await openEvolutionStore({ directory: f.campaign.storeDirectory, campaign: f.campaign });
    try { for (const attempt of report.attempts) expect(String(sha256Hex(store.readRaw(attempt.request)))).toBe(attempt.response!.rawSha256); }
    finally { await store.close(); }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("invalid selected IDs stay zero in the complete pair and retain the selector charge", async () => {
  const f = await fixture(["gpt5-nano-reader"]), fake = provider("invalid-selector");
  try {
    const report = await runSelectorLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.cases).toHaveLength(4); expect(report.total.unresolvedMicros).toBe(0);
    expect(report.cases.find(c => c.questionId === "q1" && c.arm === "selected-sources"))
      .toMatchObject({ selectorFailed: true, readerRequestSha256: null, judgeRequestSha256: null, score: 0 });
    expect(report.summaries.find(s => s.arm === "selected-sources")).toMatchObject({ denominator: 2, accuracy: 0.5, failedCases: 1, selectorFailures: 1 });
    expect(report.phases.selector).toMatchObject({ confirmedMicros: 200 }); expect(fake.counts().selectorCalls).toBe(2);
    expect(report.phaseCaseFailures).toEqual({ selector: 1, reader: 0, judge: 0 });
    expect(report.summaries.find(s => s.arm === "selected-sources")).toMatchObject({ readerFailures: 0, judgeFailures: 0, skippedReaders: 1, skippedJudges: 1 });
    expect(report.paired[0]).toMatchObject({ denominator: 2, meanDelta: 0.5, wins: 1, ties: 1 });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("uncertain first selector requests retain full reservations, stop admission, replay without retry, and score every case zero", async () => {
  const f = await fixture(["gpt5-nano-reader"]), fake = provider("network");
  try {
    const report = await runSelectorLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.complete).toBeFalse(); expect(report.coverage.completeCaseAccounting).toBeTrue();
    expect(report.stopped).toBeTrue(); expect(report.cases).toHaveLength(4); expect(report.cases.every(c => c.score === 0)).toBeTrue();
    const reserved = report.attempts.filter(a => a.failure !== null).reduce((sum, a) => sum + a.request.reservationMicros, 0);
    expect(reserved).toBeGreaterThan(0); expect(report.total.unresolvedMicros).toBe(reserved); expect(report.campaignAfter.unresolvedMicros).toBe(reserved);
    expect(report.total.confirmedMicros).toBe(0); expect(fake.counts().readerCalls).toBe(0); expect(fake.counts().judgeCalls).toBe(0);
    expect(report.summaries.every(s => s.denominator === 2 && s.accuracy === 0 && s.failedCases === 2)).toBeTrue();
    const replay = await runSelectorLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(replay.campaignAfter).toEqual(report.campaignAfter); expect(replay.total.unresolvedMicros).toBe(reserved);
    expect(fake.counts().calls).toBe(report.total.newlyOccupied);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("source, config, scorer and prepared-plan pins reject substitution; labels cannot enter source projection", async () => {
  const f = await fixture(["gpt5-nano-reader"]), fake = provider();
  try {
    expect(() => parseSelectorLaneConfig({ ...f.config, partition: "sealed" })).toThrow();
    expect(() => parseSelectorLaneConfig({ ...f.config, readers: ["gpt5-nano-evidence-selection-v1-reader"] })).toThrow("selection contracts are not answer readers");
    expect(() => parseSelectorLaneSource({ ...f.source, questions: [{ ...f.source.questions[0], answer: "leak" }] })).toThrow("question shape");
    const tampered = structuredClone(f.plan); (tampered.cases[0]!.pool as any).context = "invented replacement";
    const badPlan = await f.pin("bad-plan.json", tampered);
    await expect(runSelectorLane({ configPin: f.configPin, planPin: badPlan, credential: credential(), fetcher: fake.fetcher })).rejects.toThrow("prepared plan differs");
    expect(fake.counts().calls).toBe(0);
    await writeFile(f.sourcePin.path, JSON.stringify({ ...f.source, questions: [] }));
    await expect(runSelectorLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher })).rejects.toThrow("pinned content changed");
    expect(fake.counts().calls).toBe(0);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("explicit zero new-call allowance preserves all missing cases without opening a second allowance", async () => {
  const f = await fixture(["gpt5-nano-reader"], 0), fake = provider();
  try {
    const report = await runSelectorLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(fake.counts().calls).toBe(0); expect(report.total.newlyOccupied).toBe(0);
    expect(report.status).toBe("incomplete"); expect(report.complete).toBeFalse();
    expect(report.coverage).toEqual({ completeCaseAccounting: true, completeAttemptCoverage: false, logicalCases: 4, expectedQuestionsPerArm: 2, occupiedRequests: 0, notRunRequests: 4 });
    expect(report.phaseCaseFailures).toEqual({ selector: 0, reader: 0, judge: 0 });
    expect(report.summaries.every(s => s.readerFailures === 0 && s.judgeFailures === 0 && s.skippedJudges === 2)).toBeTrue();
    expect(report.cases).toHaveLength(4); expect(report.cases.every(c => c.score === 0)).toBeTrue();
    expect(report.campaignAfter).toMatchObject({ calls: 0, exposureMicros: 0 });
    expect(report.attempts.every(a => a.notRun === "call-limit")).toBeTrue();
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});


test("each answer-contract profile dispatches its exact immutable instruction for both selector arms", async () => {
  // evidence-selection-v1 is a stage-1 selector contract, not an answer contract; the answer factorial keeps the eight answer contracts.
  const contracts = EVOLUTION_ANSWER_CONTRACT_IDS; expect(contracts).toEqual(EVOLUTION_READER_CONTRACT_IDS.filter(contract => contract !== "evidence-selection-v1"));
  const readers = contracts.map(contract => evolutionReaderProfileId("gpt5-nano-reader", contract));
  const f = await fixture(readers), fake = provider();
  try {
    const report = await runSelectorLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.complete).toBeTrue(); expect(report.cases).toHaveLength(contracts.length * 4);
    expect(report.phases.selector!.physicalRequests).toBe(2);
    for (const attempt of report.attempts.filter(a => a.phase === "reader")) {
      const contract = evolutionReaderContract(attempt.request.profileId);
      expect(attempt.request.body.messages[0]!.content).toBe(EVOLUTION_READER_CONTRACTS[contract].instruction);
      expect(JSON.stringify(attempt.request.body)).not.toContain("SECRET_GOLD");
      if (contract === "legacy-v1") {
        const data = JSON.parse(attempt.request.body.messages[1]!.content);
        expect(attempt.request.body.messages).toEqual(answerMessages(data, data.memory));
      }
    }
    expect(new Set(report.attempts.filter(a => a.phase === "reader").map(a => a.request.body.messages[0]!.content)).size).toBe(contracts.length);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("reader and judge truncation count only the phase actually attempted; skipped downstream scoring remains zero", async () => {
  for (const mode of ["reader-truncated", "judge-truncated"] as const) {
    const f = await fixture(["gpt5-nano-reader"]), fake = provider(mode);
    try {
      const report = await runSelectorLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
      expect(report.complete).toBeTrue(); expect(report.cases.every(c => c.score === 0)).toBeTrue();
      if (mode === "reader-truncated") {
        expect(fake.counts().judgeCalls).toBe(0);
        expect(report.phaseCaseFailures).toEqual({ selector: 0, reader: 4, judge: 0 });
        expect(report.cases.every(c => c.readerStatus === "failed" && c.judgeStatus === "skipped-reader" && c.judgeFailed === false)).toBeTrue();
      } else {
        expect(report.phaseCaseFailures).toEqual({ selector: 0, reader: 0, judge: 4 });
        expect(report.cases.every(c => c.readerStatus === "completed" && c.judgeStatus === "failed" && c.judgeFailed === true)).toBeTrue();
      }
      expect(report.total.unresolvedMicros).toBe(0); expect(report.total.confirmedMicros).toBeGreaterThan(0);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  }
});

test("only the source pin admits exactly64MiB and rejects64MiB plus one before parsing", async () => {
  const f = await fixture(["gpt5-nano-reader"]);
  try {
    expect(SELECTOR_LANE_SOURCE_MAX_BYTES).toBe(67_108_864);
    const prefix = JSON.stringify(f.source), body = prefix + " ".repeat(SELECTOR_LANE_SOURCE_MAX_BYTES - Buffer.byteLength(prefix));
    const exact = await f.pin("source-at-limit.json", body);
    expect((await readSelectorLaneSource(exact)).questions).toEqual(f.source.questions);
    const oversizePath = join(f.directory, "source-over-limit.json");
    await writeFile(oversizePath, ""); await truncate(oversizePath, SELECTOR_LANE_SOURCE_MAX_BYTES + 1);
    await expect(readSelectorLaneSource({ path: oversizePath, sha256: "a".repeat(64) })).rejects.toThrow("pinned file type, size or alias");
    expect(() => parseSelectorLaneSource({ ...f.source, answer: "SECRET_GOLD" })).toThrow("source shape");
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
