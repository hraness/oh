import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import type { EvolutionCampaign, EvolutionPin } from "../scripts/benchmarks/evolution-budget";
import { codeIdentity } from "../scripts/benchmarks/io";
import { prepareEvolutionCorpus } from "../scripts/benchmarks/evolution-retrieval";
import { validateEvolutionContextPlanSources } from "../scripts/benchmarks/evolution-plan";
import { parseSelectorLaneSource } from "../scripts/benchmarks/evolution-selector-lane";
import { EVOLUTION_FACT_CARD_INSTRUCTION, EVOLUTION_FACT_CARD_POLICY, parseEvolutionFactCardJson, prepareEvolutionFactCards, renderEvolutionFactCards } from "../scripts/benchmarks/evolution-fact-cards";
import { parseEvolutionFactCardLaneConfig, prepareEvolutionFactCardLane, runEvolutionFactCardLane, type EvolutionFactCardLaneConfig } from "../scripts/benchmarks/evolution-fact-card-lane";
import { EVOLUTION_PROFILES, parseEvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { EVOLUTION_READER_CONTRACTS } from "../scripts/benchmarks/evolution-reader-contracts";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";

const auth = { method: "project-oidc" as const, project: "synthetic-cards", scope: "synthetic-team", environment: "development" as const };
const corpus = { id: "synthetic-cards", turns: [
  { id: "runs", sessionId: "one", date: "2026-01-04", speaker: "user", text: "🏃 I ran 2 km on 2026-01-01 and 3 km on 2026-01-03. My preference is trails." },
  { id: "assistant", sessionId: "two", date: "2026-01-05", speaker: "assistant", text: "A hypothetical route could be 12 km. That is an example, not a completed run." },
  { id: "repeat", sessionId: "three", date: "2026-01-06", speaker: "user", text: "blue blue" },
] };
const variant = { id: "oh-semantic-top100-96k-v1", system: "oh-semantic" as const, budget: { topK: 100, contextBytes: 96_000 } };
function question(i: number) { return { id: `q${String(i).padStart(3, "0")}`, corpusId: corpus.id, question: `How far did I run altogether? Case q${String(i).padStart(3, "0")}`, questionDate: "2026-01-07" }; }
const extraction = () => ({ cards: [{ source: "s000", quote: "I ran 2 km on 2026-01-01 and 3 km on 2026-01-03.", tag: "experience" }],
  operations: [{ kind: "sum", operands: [{ cardId: "c000", literal: "2 km" }, { cardId: "c000", literal: "3 km" }], unit: "km" }] });
async function semanticResults(count: number, sourceCorpus = corpus) {
  let records: readonly KnowledgeGraphRecordV1[] = [], builds = 0, closes = 0;
  const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index(value) { records = value; builds++; return { indexed: value.length, v: 1 }; },
    async search(_query, _limit, authority) { return records.map((r, i) => {
      if (authority.get(r.key)?.recordSha256 !== r.recordSha256) throw new Error("Synthetic current SQLite join missing");
      return { key: r.key, recordSha256: r.recordSha256, score: 1 - i * 0.1, v: 1 as const };
    }); }, async close() { closes++; } };
  const prepared = await prepareEvolutionCorpus({ ...sourceCorpus, groupId: sourceCorpus.id }, { semanticBackend: backend });
  try { const results = []; for (let i = 0; i < count; i++) results.push(await prepared.retrieve(question(i).question, variant)); return results; }
  finally { await prepared.close(); expect([builds, closes]).toEqual([1, 1]); }
}
function raw(answer: string, model = "openai/gpt-5-nano", finish = "stop") {
  const provider = Object.values(EVOLUTION_PROFILES).find(p => p.model === model)!.provider;
  return new TextEncoder().encode(JSON.stringify({ model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }, providerMetadata: { gateway: { cost: "0.0001",
      routing: { finalProvider: provider, originalModelId: model, canonicalSlug: model } } } }));
}
function credential() {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url"), now = Math.floor(Date.now() / 1000);
  return { kind: "gateway-oidc" as const, auth, token: `${encode({ alg: "RS256" })}.${encode({ sub: `owner:${auth.scope}:project:${auth.project}:environment:development`,
    aud: `https://vercel.com/${auth.scope}`, iss: "https://oidc.vercel.com", exp: now + 3600, iat: now })}.synthetic` };
}
async function fixture(maximumNewCalls = 500) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-fact-cards-")));
  async function pin(name: string, value: unknown): Promise<EvolutionPin> { const content = typeof value === "string" ? value : JSON.stringify(value), path = join(directory, name);
    await writeFile(path, content, { mode: 0o600 }); return { path, sha256: sha256Hex(content) }; }
  const questions = Array.from({ length: 100 }, (_, i) => question(i));
  const source = { protocol: "oh.memory.source-selector-input.v1", partition: "development", corpora: [corpus], questions }, input = parseSelectorLaneSource(source);
  const results = await semanticResults(100);
  const contextPayload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: sha256Hex("synthetic-manifest"), retrievalSourceSha256: sha256Hex("synthetic-semantic-source"),
    inputSha256: canonicalSha256(input), variants: [variant], questions, cases: questions.map((q, i) => ({ questionId: q.id, variantId: variant.id, result: results[i]! })) };
  const context = { ...contextPayload, planSha256: canonicalSha256(contextPayload) }; validateEvolutionContextPlanSources(context, input);
  const sourcePin = await pin("source.json", source), contextPin = await pin("context.json", context);
  const scorerPin = await pin("scorer.json", { protocol: "oh.memory.source-selector-scoring-input.v1", inputSha256: canonicalSha256(input),
    questions: questions.map(q => ({ ...q, answer: `GOLD_SECRET_${q.id}`, category: "synthetic-multi-session", unanswerable: false, evidenceSessionIds: [], evidenceTurnIds: [] })) });
  const ledger = await pin("historical.jsonl", ""), authAuthority = await pin("auth.json", { schema: "oh.gateway-v3-authority.v1", ...auth });
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "synthetic-fact-cards", storeDirectory: join(directory, "store"),
    approval: "Fake provider only; no network or real credentials", additionalBudgetMicros: 10_000_000, maximumCalls: 500,
    historicalExposureMicros: 0, historicalLedgers: [{ ...ledger, bytes: 0 }], authAuthority };
  const config: EvolutionFactCardLaneConfig = { protocol: "oh.memory.fact-card-experiment.v1", partition: "development", sourcePin, contextPin, scorerPin,
    campaignPin: await pin("campaign.json", campaign), executionSourceSha256: (await codeIdentity()).sourceSha256, variantId: variant.id,
    questionIds: questions.map(q => q.id), maximumNewCalls, concurrency: 2 };
  const configPin = await pin("config.json", config), plan = await prepareEvolutionFactCardLane(configPin), planPin = await pin("plan.json", plan);
  return { directory, pin, source, input, context, config, configPin, plan, planPin, campaign };
}
function fakeProvider(mode: "normal" | "mixed-failures" | "network" | "downstream-truncation" = "normal") {
  const counts = { extractor: 0, reader: 0, judge: 0 }, observed: unknown[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions"); expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body)); observed.push(body); let answer: string, finish = "stop";
    if (body.messages[0].content === EVOLUTION_FACT_CARD_INSTRUCTION) {
      counts.extractor++; expect(body.max_tokens).toBe(8192); expect(JSON.stringify(body)).not.toContain("GOLD_SECRET");
      const prompt = JSON.parse(body.messages[1].content); expect(Object.keys(prompt).sort()).toEqual(["question", "questionDate", "sources"]);
      if (mode === "network") throw new Error("Synthetic network uncertainty");
      const e = extraction();
      if (mode === "mixed-failures" && prompt.question.endsWith("q000")) e.cards[0]!.quote = "made-up quote";
      if (mode === "mixed-failures" && prompt.question.endsWith("q001")) finish = "length";
      if (mode === "mixed-failures" && prompt.question.endsWith("q002")) { e.cards = []; e.operations = []; }
      if (mode === "mixed-failures" && prompt.question.endsWith("q003")) e.operations[0]!.operands[0]!.literal = "99 km";
      answer = JSON.stringify(e);
    } else if (body.messages.length === 1) {
      counts.judge++; expect(counts.reader).toBe(mode === "mixed-failures" ? 196 : 200);
      expect(body.max_tokens).toBe(16); expect(body.messages[0].content).toContain("GOLD_SECRET");
      answer = body.messages[0].content.includes("WRONG") ? "no" : "yes";
      if (mode === "downstream-truncation" && body.messages[0].content.includes("GOLD_SECRET_q001")) finish = "length";
    } else {
      counts.reader++; expect(counts.extractor).toBe(100); expect(JSON.stringify(body)).not.toContain("GOLD_SECRET");
      expect(body.messages[0].content).toBe(EVOLUTION_READER_CONTRACTS["explicit-abstention-composition-v1"].instruction);
      const prompt = JSON.parse(body.messages[1].content), memory = JSON.parse(prompt.memory);
      expect(memory.cards.every((c: any) => c.speaker === "user" && c.statementDate === "2026-01-04")).toBeTrue();
      const id = prompt.question.slice(-4);
      answer = `${memory.operations?.some((o: any) => o.status === "resolved") ? "CORRECT" : "WRONG"}_${id}`;
      if (mode === "downstream-truncation" && id === "q000") finish = "length";
    }
    return new Response(raw(answer, body.model, finish), { status: 200 });
  };
  return { fetcher, counts, observed };
}

test("pure quote cards bind unique UTF8 source ranges, roles/dates, raw capture and fixed semantic parent", async () => {
  const result = (await semanticResults(1))[0]!, parent = { variant, result, expectedResultSha256: result.resultSha256 };
  let leaked = 0;
  const source = { ...corpus, groupId: corpus.id, get answer() { leaked++; throw new Error("gold must not be read"); } };
  const factory = prepareEvolutionFactCards(source), plan = factory.makePlan(question(0), parent), bytes = raw(JSON.stringify(extraction())), response = parseEvolutionResponse(bytes, plan.request);
  const capture = factory.reconstruct(question(0), parent, plan, bytes, response), card = capture.cards[0]!;
  expect(leaked).toBe(0); expect(card.startByte).toBe(5); expect(card.endByte - card.startByte).toBe(Buffer.byteLength(card.quote));
  expect(Buffer.from(corpus.turns[0]!.text).subarray(card.startByte, card.endByte).toString()).toBe(card.quote);
  expect(card).toMatchObject({ speaker: "user", statementDate: "2026-01-04", textSha256: sha256Hex(corpus.turns[0]!.text), modelTag: "experience" });
  const a = renderEvolutionFactCards(capture, "quote-cards"), b = renderEvolutionFactCards(capture, "quote-cards-ops");
  expect(a.captureSha256).toBe(b.captureSha256); expect(a.operationResults).toBeNull(); expect(a.context).not.toContain('"operations"');
  expect(b.operationResults![0]).toMatchObject({ status: "resolved", value: "5", unit: "km" });
  expect(Object.isFrozen(capture.cards)).toBeTrue(); expect(Object.isFrozen(card)).toBeTrue();
  expect(() => factory.reconstruct(question(1), parent, plan, bytes, response)).toThrow();
  expect(() => factory.reconstruct(question(0), parent, plan, raw('{"cards":[],"operations":[]}'), response)).toThrow("exact completed");
  expect(() => factory.makePlan(question(0), { ...parent, variant: { ...variant, system: "oh-keyword" } })).toThrow("semantic parent");
  const bad = { ...extraction(), cards: [{ source: "s002", quote: "blue", tag: "other" }] }, badRaw = raw(JSON.stringify(bad));
  expect(() => factory.reconstruct(question(0), parent, plan, badRaw, parseEvolutionResponse(badRaw, plan.request))).toThrow("exactly once");
  let accessed = 0; const changed = { ...corpus, groupId: corpus.id, turns: [{ ...corpus.turns[0], get text() { accessed++; return "changed"; } }] };
  expect(() => prepareEvolutionFactCards(changed as any)).toThrow("accessor"); expect(accessed).toBe(0);
});

test("extractor JSON rejects duplicate decoded keys, malformed, oversized and scalar-invalid quotes", () => {
  expect(() => parseEvolutionFactCardJson('{"cards":[],"cards":[],"operations":[]}')).toThrow("duplicate JSON key");
  expect(() => parseEvolutionFactCardJson('{"cards":[],"c\\u0061rds":[],"operations":[]}')).toThrow("duplicate JSON key");
  expect(() => parseEvolutionFactCardJson('```json\n{}\n```')).toThrow("extractor JSON");
  expect(() => parseEvolutionFactCardJson(" ".repeat(32769))).toThrow("bounded scalar");
  expect(parseEvolutionFactCardJson('{ "cards": [], "operations": [] }')).toEqual({ cards: [], operations: [] });
});

test("B context overflow fails without dropping any A quote or rerunning extraction", async () => {
  const quote = "x".repeat(1024), source = { ...corpus, turns: [{ ...corpus.turns[0]!, text: quote }] };
  const result = (await semanticResults(1, source))[0]!, parent = { variant, result, expectedResultSha256: result.resultSha256 };
  const factory = prepareEvolutionFactCards({ ...source, groupId: source.id }), plan = factory.makePlan(question(0), parent);
  const answer = JSON.stringify({ cards: [{ source: "s000", quote, tag: "other" }], operations: Array.from({ length: 16 }, () => ({
    kind: "distinct-literals", operands: [{ cardId: "c000", literal: quote }], unit: null })) });
  const bytes = raw(answer), capture = factory.reconstruct(question(0), parent, plan, bytes, parseEvolutionResponse(bytes, plan.request));
  expect(renderEvolutionFactCards(capture, "quote-cards").contextBytes).toBeLessThan(16384);
  expect(() => renderEvolutionFactCards(capture, "quote-cards-ops")).toThrow("context exceeds bound");
  expect(capture.cards[0]!.quote).toBe(quote); expect(capture.operations).toHaveLength(16);
});

test("complete fake-provider100 extraction -> shared quotes/two finalizers -> native16 judge report and zero-call replay", async () => {
  const f = await fixture(), fake = fakeProvider();
  try {
    expect(f.plan.maximumPhysicalCalls).toBe(500); expect(f.plan.reservationBounds.extractorMicros).toBe(f.plan.cases.reduce((s, c) => s + c.extractor!.request.reservationMicros, 0));
    expect(f.plan.reservationBounds.totalMicros).toBeGreaterThan(f.plan.reservationBounds.extractorMicros);
    const frozenPhases: string[] = [];
    const report = await runEvolutionFactCardLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher,
      onPhasePrepared: async phase => {
        expect(phase.cases).toHaveLength(200); expect(phase.requests).toHaveLength(200); expect(Object.isFrozen(phase)).toBeTrue();
        expect(fake.counts[phase.phase]).toBe(0); await f.pin(`${phase.phase}-prepared.json`, phase); frozenPhases.push(phase.phase);
      } });
    expect(frozenPhases).toEqual(["reader", "judge"]); expect(report.phasePlans).toHaveLength(2);
    expect(fake.counts).toEqual({ extractor: 100, reader: 200, judge: 200 }); expect(report.complete).toBeTrue(); expect(report.cases).toHaveLength(200);
    expect(report.total).toMatchObject({ newlyOccupied: 500, occupiedRequests: 500, confirmedMicros: 50_000, unresolvedMicros: 0 });
    expect(report.paired).toMatchObject({ denominator: 100, wins: 100, losses: 0, ties: 0, meanDelta: 1 });
    expect(report.summaries.map(s => s.correct)).toEqual([0, 100]); expect(report.summaries.map(s => s.accounting.confirmedMicros)).toEqual([30_000, 30_000]);
    expect(report.captures).toHaveLength(100); expect(report.serviceQualification.questionIds).toEqual(f.config.questionIds.slice(0, 6));
    expect(report.phases.extractor).toMatchObject({ physicalRequests: 100, confirmedMicros: 10_000 });
    for (const c of report.cases) expect(c.captureSha256).toBe(report.captures.find(p => p.requestSha256 === c.extractorRequestSha256)!.captureSha256);
    const replay = await runEvolutionFactCardLane({ configPin: f.configPin, planPin: f.planPin, credential: { ...credential(), token: "" },
      fetcher: async () => { throw new Error("Never redispatch cached captures"); } });
    expect(replay.total).toMatchObject({ newlyOccupied: 0, cacheHits: 500, confirmedMicros: 50_000 });
    expect(replay.cases).toEqual(report.cases); expect(replay.campaignAfter).toEqual(report.campaignAfter); expect(replay.paired).toEqual(report.paired);
    const store = await openEvolutionStore({ directory: f.campaign.storeDirectory, campaign: f.campaign });
    try { for (const a of report.attempts) expect(String(sha256Hex(store.readRaw(a.request)))).toBe(a.response!.rawSha256); } finally { await store.close(); }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 30_000);

test("invalid/truncated extraction charges remain; empty cards proceed, unsupported operations unresolved, all200 cases retained", async () => {
  const f = await fixture(), fake = fakeProvider("mixed-failures");
  try {
    const report = await runEvolutionFactCardLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.complete).toBeTrue(); expect(report.cases).toHaveLength(200); expect(fake.counts).toEqual({ extractor: 100, reader: 196, judge: 194 });
    for (const q of ["q000", "q001"]) for (const c of report.cases.filter(c => c.questionId === q)) expect(c).toMatchObject({ extractorStatus: "failed", readerStatus: "skipped-extractor", judgeStatus: "skipped-reader", score: 0 });
    expect(report.cases.filter(c => c.questionId === "q002").every(c => c.readerStatus === "completed")).toBeTrue();
    expect(report.cases.find(c => c.questionId === "q003" && c.arm === "quote-cards-ops")!.context!.operationResults![0]!.status).toBe("unresolved");
    expect(report.phases.extractor!.confirmedMicros).toBe(10_000); expect(report.total.unresolvedMicros).toBe(0);
    // Empty and unresolved-operation A/B answers match exactly, so their judges share physical requests.
    expect(report.phases.judge!.physicalRequests).toBe(194); expect(report.total.confirmedMicros).toBe(49_000);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 30_000);

test("uncertain extraction retains reservations and never retries; zero allowance stays incomplete with fixed denominator", async () => {
  for (const limit of [500, 0]) {
    const f = await fixture(limit), fake = fakeProvider("network");
    try {
      const report = await runEvolutionFactCardLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
      expect(report.complete).toBeFalse(); expect(report.cases).toHaveLength(200); expect(report.cases.every(c => c.score === 0)).toBeTrue();
      expect(report.summaries.every(s => s.denominator === 100)).toBeTrue(); expect(fake.counts.reader + fake.counts.judge).toBe(0);
      expect(report.total.confirmedMicros).toBe(0); expect(report.total.unresolvedMicros).toBe(report.attempts.reduce((s, a) => s + (a.failure?.reservationMicros ?? 0), 0));
      if (limit === 0) { expect(fake.counts.extractor).toBe(0); expect(report.cases.every(c => c.extractorStatus === "not-run")).toBeTrue(); }
      else expect(report.total.unresolvedMicros).toBeGreaterThan(0);
      const calls = fake.counts.extractor;
      const replay = await runEvolutionFactCardLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
      expect(fake.counts.extractor).toBe(calls); expect(replay.campaignAfter).toEqual(report.campaignAfter);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  }
}, 30_000);

test("fixed selection and source/context/plan pins fail before provider admission", async () => {
  const f = await fixture(), fake = fakeProvider();
  try {
    expect(() => parseEvolutionFactCardLaneConfig({ ...f.config, questionIds: f.config.questionIds.slice(1) })).toThrow("development100");
    expect(() => parseEvolutionFactCardLaneConfig({ ...f.config, partition: "sealed" })).toThrow();
    const changed = structuredClone(f.plan); (changed.cases[0]!.parent.result as any).context = "invented";
    const badPin = await f.pin("bad-plan.json", changed);
    await expect(runEvolutionFactCardLane({ configPin: f.configPin, planPin: badPin, credential: credential(), fetcher: fake.fetcher })).rejects.toThrow("prepared plan changed");
    await writeFile(f.config.sourcePin.path, JSON.stringify({ ...f.source, questions: [] }));
    await expect(runEvolutionFactCardLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher })).rejects.toThrow("pinned content changed");
    expect(fake.counts).toEqual({ extractor: 0, reader: 0, judge: 0 }); expect(EVOLUTION_FACT_CARD_POLICY.extractor).toBe("gpt5-nano-reader");
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 30_000);

test("downstream truncation scores zero only in its attempted phase and preserves charges", async () => {
  const f = await fixture(), fake = fakeProvider("downstream-truncation");
  try {
    const report = await runEvolutionFactCardLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.complete).toBeTrue(); expect(fake.counts).toEqual({ extractor: 100, reader: 200, judge: 198 });
    for (const c of report.cases.filter(c => c.questionId === "q000")) expect(c).toMatchObject({ extractorStatus: "completed", readerStatus: "failed", judgeStatus: "skipped-reader", score: 0 });
    for (const c of report.cases.filter(c => c.questionId === "q001")) expect(c).toMatchObject({ readerStatus: "completed", judgeStatus: "failed", score: 0 });
    expect(report.total).toMatchObject({ confirmedMicros: 49_800, unresolvedMicros: 0 });
    expect(report.summaries.map(s => s.correct)).toEqual([0, 98]);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 30_000);

test("phase-persistence interruption drains and releases store; continuation reuses every extractor capture", async () => {
  const f = await fixture(), fake = fakeProvider();
  try {
    await expect(runEvolutionFactCardLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher,
      onPhasePrepared: async () => { throw new Error("Synthetic phase persistence interruption"); } })).rejects.toThrow("phase persistence interruption");
    expect(fake.counts).toEqual({ extractor: 100, reader: 0, judge: 0 });
    const store = await openEvolutionStore({ directory: f.campaign.storeDirectory, campaign: f.campaign });
    try { expect(store.summary()).toMatchObject({ calls: 100, confirmedMicros: 10_000, unresolvedMicros: 0 }); } finally { await store.close(); }
    const report = await runEvolutionFactCardLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.complete).toBeTrue(); expect(fake.counts).toEqual({ extractor: 100, reader: 200, judge: 200 });
    expect(report.total).toMatchObject({ newlyOccupied: 400, cacheHits: 100, confirmedMicros: 50_000, unresolvedMicros: 0 });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 30_000);
