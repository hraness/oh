import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import type { EvolutionCampaign, EvolutionPin } from "../scripts/benchmarks/evolution-budget";
import { codeIdentity } from "../scripts/benchmarks/io";
import { prepareEvolutionCorpus, type EvolutionRetrievalResult } from "../scripts/benchmarks/evolution-retrieval";
import { validateEvolutionContextPlanSources } from "../scripts/benchmarks/evolution-plan";
import { parseSelectorLaneSource } from "../scripts/benchmarks/evolution-selector-lane";
import { EVOLUTION_PROFILES, parseEvolutionResponse, validateEvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { EVIDENCE_SELECTION_INSTRUCTION, EVOLUTION_READER_CONTRACTS, evolutionAnswerMessages } from "../scripts/benchmarks/evolution-reader-contracts";
import { EVOLUTION_QUESTION_SHAPE_ROUTER_V1, routeEvolutionQuestionShapeV1 } from "../scripts/benchmarks/evolution-question-shape";
import { EVOLUTION_TWO_STAGE_SELECTOR_PROFILES, OH_SELECTOR_POLICY_V2, evolutionTwoStageProfiles, makeEvolutionTwoStageAnswerRequest,
  parseEvidenceSelectionIds, prepareEvolutionTwoStage, type EvolutionTwoStagePool } from "../scripts/benchmarks/evolution-two-stage";
import { EVOLUTION_TWO_STAGE_ARMS, EVOLUTION_TWO_STAGE_ARM_IDS, parseEvolutionTwoStageLaneConfig, prepareEvolutionTwoStageLane,
  runEvolutionTwoStageLane, type EvolutionTwoStageArmId, type EvolutionTwoStageLaneConfig } from "../scripts/benchmarks/evolution-two-stage-lane";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { renderTurn } from "../scripts/benchmarks/retrieval";

const auth = { method: "project-oidc" as const, project: "synthetic-two-stage", scope: "synthetic-team", environment: "development" as const };
const corpus = { id: "synthetic-two-stage", turns: [
  { id: "runs", sessionId: "one", sessionIndex: 0, date: "2026-01-04", speaker: "user", text: "🏃 I ran 2 km on 2026-01-01 and 3 km on 2026-01-03 on the trails." },
  { id: "assistant", sessionId: "two", sessionIndex: 1, date: "2026-01-05", speaker: "assistant", text: "A hypothetical run could be 12 km on the trails. That is an example, not a completed run." },
  { id: "repeat", sessionId: "three", sessionIndex: 2, date: "2026-01-06", speaker: "user", text: "blue blue" },
  { id: "later", sessionId: "four", sessionIndex: 3, date: "2026-01-07", speaker: "user", text: "Yesterday I ran 5 km along the river trails." },
] };
/** Forty quote-heavy user turns: every pool packs within 96,000 bytes, but the twice JSON-escaped selection request body
 * exceeds the 262,144-byte cap, so selection preparation must fail closed instead of truncating the pool. */
const heavy = { id: "synthetic-two-stage-heavy", turns: Array.from({ length: 40 }, (_, i) => ({ id: `h${String(i).padStart(2, "0")}`, sessionId: `h${i}`, sessionIndex: i,
  date: "2026-01-04", speaker: "user", text: `I ran on the trails. ${'"'.repeat(2_300)}` })) };
type SyntheticCorpus = typeof corpus | typeof heavy;
const variants = [
  { id: "semantic-96k", system: "oh-semantic" as const, budget: { topK: 100, contextBytes: 96_000 } },
  { id: "window-96k", system: "bm25-window" as const, budget: { topK: 100, contextBytes: 96_000 } },
];
const PROFILES = evolutionTwoStageProfiles();
const qid = (i: number) => `q${String(i).padStart(3, "0")}`;
/** Even questions are routed (aggregate), odd questions are not; every question shares terms with the turns so both pools are non-empty,
 * except the `emptyPool` indices, whose text shares no term with any turn so their BM25 window pool holds no turn at all. */
function question(i: number, corpusId = corpus.id, emptyPool: ReadonlySet<number> = new Set()) {
  const routed = i % 2 === 0;
  return { id: qid(i), corpusId, questionDate: "2026-01-08",
    question: emptyPool.has(i) ? (routed ? `How many colours did I mention? Case ${qid(i)}` : `Which colour did I mention? Case ${qid(i)}`)
      : routed ? `How many km did I run on the trails altogether? Case ${qid(i)}` : `Where did I say I ran on the trails? Case ${qid(i)}` };
}
async function retrieveAll(count: number, source: SyntheticCorpus = corpus, emptyPool: ReadonlySet<number> = new Set()) {
  let records: readonly KnowledgeGraphRecordV1[] = [];
  const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index(value) { records = value; return { indexed: value.length, v: 1 }; },
    async search(_query, _limit, authority) { return records.map((r, i) => {
      if (authority.get(r.key)?.recordSha256 !== r.recordSha256) throw new Error("Synthetic current SQLite join missing");
      return { key: r.key, recordSha256: r.recordSha256, score: 1 - i / (records.length + 1), v: 1 as const };
    }); }, async close() {} };
  // The runner stamps the prepared identity per variant family: semantic pools carry the embedding profile, BM25 pools do not.
  const semantic = await prepareEvolutionCorpus({ ...source, groupId: source.id }, { semanticBackend: backend }), plain = await prepareEvolutionCorpus({ ...source, groupId: source.id });
  try {
    const results = new Map<string, EvolutionRetrievalResult>();
    for (let i = 0; i < count; i++) for (const v of variants) results.set(`${qid(i)}:${v.id}`, await (v.system === "oh-semantic" ? semantic : plain).retrieve(question(i, source.id, emptyPool).question, v));
    return results;
  } finally { await semantic.close(); await plain.close(); }
}
function raw(answer: string, model: string, finish = "stop", tools = false) {
  const provider = Object.values(EVOLUTION_PROFILES).find(p => p.model === model)!.provider;
  return new TextEncoder().encode(JSON.stringify({ model, choices: [{ index: 0, finish_reason: finish,
    message: { role: "assistant", content: answer, ...(tools ? { tool_calls: [{ id: "x", type: "function", function: { name: "f", arguments: "{}" } }] } : {}) } }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 }, providerMetadata: { gateway: { cost: "0.0001",
      routing: { finalProvider: provider, originalModelId: model, canonicalSlug: model } } } }));
}
function credential() {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url"), now = Math.floor(Date.now() / 1000);
  return { kind: "gateway-oidc" as const, auth, token: `${encode({ alg: "RS256" })}.${encode({ sub: `owner:${auth.scope}:project:${auth.project}:environment:development`,
    aud: `https://vercel.com/${auth.scope}`, iss: "https://oidc.vercel.com", exp: now + 3600, iat: now })}.synthetic` };
}
const turnById = new Map(corpus.turns.map(t => [t.id, t]));
const position = new Map(corpus.turns.map((t, i) => [t.id, i]));
/** The stage-2 memory the lane must send for a pool and a model priority list: source turns, corpus order, never model text. */
function expectedContext(pool: EvolutionRetrievalResult, aliases: readonly string[]) {
  return aliases.map(a => pool.turnIds[Number(a.slice(1))]!).sort((a, b) => position.get(a)! - position.get(b)!).map(id => renderTurn(turnById.get(id)!)).join("\n\n");
}
async function fixture(options: Readonly<{ arms?: readonly EvolutionTwoStageArmId[]; variantIds?: readonly string[]; repeats?: number; maximumNewCalls?: number;
  concurrency?: number; corpus?: SyntheticCorpus; emptyPoolQuestions?: readonly number[] }> = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-two-stage-"))), sourceCorpus = options.corpus ?? corpus, emptyPool = new Set(options.emptyPoolQuestions ?? []);
  async function pin(name: string, value: unknown): Promise<EvolutionPin> { const content = typeof value === "string" ? value : JSON.stringify(value), path = join(directory, name);
    await writeFile(path, content, { mode: 0o600 }); return { path, sha256: sha256Hex(content) }; }
  const questions = Array.from({ length: 100 }, (_, i) => question(i, sourceCorpus.id, emptyPool));
  const source = { protocol: "oh.memory.source-selector-input.v1", partition: "development", corpora: [sourceCorpus], questions }, input = parseSelectorLaneSource(source);
  const results = await retrieveAll(100, sourceCorpus, emptyPool);
  const contextPayload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: sha256Hex("synthetic-manifest"), retrievalSourceSha256: sha256Hex("synthetic-source"),
    inputSha256: canonicalSha256(input), variants, questions, cases: questions.flatMap(q => variants.map(v => ({ questionId: q.id, variantId: v.id, result: results.get(`${q.id}:${v.id}`)! }))) };
  const context = { ...contextPayload, planSha256: canonicalSha256(contextPayload) }; validateEvolutionContextPlanSources(context, input);
  const sourcePin = await pin("source.json", source), contextPin = await pin("context.json", context);
  const scorerPin = await pin("scorer.json", { protocol: "oh.memory.source-selector-scoring-input.v1", inputSha256: canonicalSha256(input),
    questions: questions.map((q, i) => ({ ...q, answer: `GOLD_SECRET_${q.id}`, category: i % 4 === 0 ? "temporal-reasoning" : "multi-session", unanswerable: false, evidenceSessionIds: [], evidenceTurnIds: [] })) });
  const ledger = await pin("historical.jsonl", ""), authAuthority = await pin("auth.json", { schema: "oh.gateway-v3-authority.v1", ...auth });
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "synthetic-two-stage", storeDirectory: join(directory, "store"),
    approval: "Fake provider only; no network or real credentials", additionalBudgetMicros: 20_000_000, maximumCalls: 6_000,
    historicalExposureMicros: 0, historicalLedgers: [{ ...ledger, bytes: 0 }], authAuthority };
  const config: EvolutionTwoStageLaneConfig = { protocol: "oh.memory.two-stage-experiment.v1", partition: "development", sourcePin, contextPin, scorerPin,
    campaignPin: await pin("campaign.json", campaign), executionSourceSha256: (await codeIdentity()).sourceSha256, contextPlanSha256: context.planSha256,
    variantIds: options.variantIds ?? variants.map(v => v.id), questionIds: questions.map(q => q.id), arms: options.arms ?? EVOLUTION_TWO_STAGE_ARM_IDS,
    repeats: options.repeats ?? 1, maximumNewCalls: options.maximumNewCalls ?? 6_000, concurrency: options.concurrency ?? 4 };
  const configPin = await pin("config.json", config), plan = await prepareEvolutionTwoStageLane(configPin), planPin = await pin("plan.json", plan);
  return { directory, pin, source, input, context, results, config, configPin, plan, planPin, campaign };
}
type Mode = "normal" | "mixed-failures" | "high-fallback" | "selector-network" | "empty-pool";
function fakeProvider(mode: Mode = "normal") {
  const counts = { select: 0, answer: 0, judge: 0 }, bodies: any[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions"); expect(init.redirect).toBe("error");
    const body = JSON.parse(String(init.body)); bodies.push(body); let answer: string, finish = "stop", tools = false;
    // Gold reaches only the separate judge; selection and answer requests never carry it.
    if (body.messages.length !== 1) expect(JSON.stringify(body.messages)).not.toContain("GOLD_SECRET");
    if (body.messages[0].content === EVIDENCE_SELECTION_INSTRUCTION) {
      counts.select++; expect(body.messages).toHaveLength(2); expect(body.max_tokens).toBe(8192);
      const prompt = JSON.parse(body.messages[1].content); expect(Object.keys(prompt).sort()).toEqual(["question", "questionDate", "sources"]);
      expect(prompt.sources).toContain("[s000] ["); expect(prompt.sources).not.toContain("[runs] ");
      const id = prompt.question.slice(-4);
      // An uncertain dispatch: the store keeps the full reservation and the lane stops admission.
      if (mode === "selector-network") throw new Error("Synthetic network uncertainty");
      answer = prompt.sources.includes("[s001] [") ? '{"ids":["s001","s000"]}' : '{"ids":["s000"]}';
      if (mode === "mixed-failures") {
        if (id === "q000") answer = "I think the relevant turns are s000 and s001.";
        if (id === "q002") finish = "length";
        if (id === "q004") answer = '{"ids":[]}';
        if (id === "q006") answer = '{"ids":["s999"]}';
        if (id === "q008") { answer = ""; tools = true; }
        if (id === "q010") { answer = ""; finish = "content_filter"; }
      }
      // Thirteen empty selections of one hundred: above the 10% fallback gate.
      if (mode === "high-fallback" && Number(id.slice(1)) % 8 === 0) answer = '{"ids":[]}';
    } else if (body.messages.length === 1) {
      counts.judge++; expect(body.max_tokens).toBe(16); expect(body.messages[0].content).toContain("GOLD_SECRET");
      answer = body.messages[0].content.includes("WRONG") ? "no" : "yes";
    } else {
      counts.answer++; expect(body.messages).toHaveLength(2);
      const prompt = JSON.parse(body.messages[1].content), id = prompt.question.slice(-4), routed = routeEvolutionQuestionShapeV1(prompt.question).routed;
      expect(Object.keys(prompt).sort()).toEqual(["memory", "question", "questionDate"]);
      expect(typeof prompt.memory).toBe("string");
      // An empty pool reaches the answer readers as an empty memory string; every other memory is rendered source turns.
      if (!(mode === "empty-pool" && prompt.memory === "")) expect(prompt.memory).toMatch(/^\[(?:runs|assistant|repeat|later)\] \[2026-01-0\d\] (?:user|assistant): /);
      // The single-call EAC control answers routed questions wrongly so two-stage arms show paired wins.
      const wrong = body.messages[0].content === EVOLUTION_READER_CONTRACTS["explicit-abstention-composition-v1"].instruction && routed;
      answer = `${wrong ? "WRONG" : "CORRECT"}_${id}`;
    }
    return new Response(raw(answer, body.model, finish, tools), { status: 200 });
  };
  return { fetcher, counts, bodies };
}

test("policy v2 derives closed profile identities and the bounded alias-list grammar", () => {
  expect(OH_SELECTOR_POLICY_V2).toMatchObject({ protocol: "oh.memory.source-selector-policy.v2", poolProtocol: "oh.memory.evolution-context-plan.v1",
    selectorContract: "evidence-selection-v1", answerContract: "selected-answer-v1", fallbackContract: "calibration-only-v1",
    maximumSelectedTurns: 32, contextByteLimit: 96_000, fallbackRateGate: 0.1, maximumPoolTurns: 400 });
  expect(Object.isFrozen(OH_SELECTOR_POLICY_V2)).toBeTrue();
  expect(PROFILES).toEqual({ primary: "gpt5-mini-evidence-selection-v1-reader", ablation: "gpt5-nano-evidence-selection-v1-reader",
    answer: "gpt5-mini-selected-answer-v1-reader", fallback: "gpt5-mini-calibration-only-v1-reader" });
  expect(EVOLUTION_TWO_STAGE_SELECTOR_PROFILES).toEqual([PROFILES.primary, PROFILES.ablation]);
  expect(EVOLUTION_PROFILES[PROFILES.primary]!.settings).toEqual(EVOLUTION_PROFILES["gpt5-mini-reader"]!.settings);
  expect(EVOLUTION_PROFILES[PROFILES.ablation]!.settings).toEqual(EVOLUTION_PROFILES["gpt5-nano-reader"]!.settings);
  const allowed = ["s000", "s001", "s002"];
  expect(parseEvidenceSelectionIds(' {"ids" : [ "s002", "s000" ]} ', allowed)).toEqual(["s002", "s000"]);
  expect(parseEvidenceSelectionIds('{"ids":[]}', allowed)).toEqual([]);
  expect(() => parseEvidenceSelectionIds('{"ids":["s003"]}', allowed)).toThrow("duplicate, foreign or excessive selected IDs");
  for (const bad of ['{"ids":["s000","s000"]}', '{"ids":["s000"],"why":"x"}', '```json\n{"ids":["s000"]}\n```', 'The ids are ["s000"]',
    '{"ids":["s\\u0030\\u0030\\u0030"]}', '{"ids":["s000"]} extra', `{"ids":[${Array.from({ length: 33 }, (_, i) => `"s${String(i).padStart(3, "0")}"`).join(",")}]}`,
    `{"ids":[]}${" ".repeat(2_048)}`, "", 7]) expect(() => parseEvidenceSelectionIds(bad, Array.from({ length: 40 }, (_, i) => `s${String(i).padStart(3, "0")}`))).toThrow("Two-stage selector:");
  expect(parseEvidenceSelectionIds(`{"ids":[${Array.from({ length: 32 }, (_, i) => `"s${String(i).padStart(3, "0")}"`).join(",")}]}`,
    Array.from({ length: 40 }, (_, i) => `s${String(i).padStart(3, "0")}`))).toHaveLength(32);
});

test("selection plans alias the pinned pool, stage two re-renders selected turns from source and every failure is an explicit fallback", async () => {
  const results = await retrieveAll(2), factory = prepareEvolutionTwoStage({ ...corpus, groupId: corpus.id });
  const q0 = question(0), semantic = results.get("q000:semantic-96k")!, window = results.get("q000:window-96k")!;
  const pool = (result: EvolutionRetrievalResult, variant = variants[0]!): EvolutionTwoStagePool => ({ variant, result, expectedResultSha256: result.resultSha256 });
  const plan = factory.makeSelectionPlan(q0, pool(semantic), PROFILES.primary);
  expect(plan).toMatchObject({ protocol: "oh.memory.evidence-selection-plan.v2", role: "evidence-selection", selectorProfile: PROFILES.primary,
    policySha256: canonicalSha256(OH_SELECTOR_POLICY_V2), poolResultSha256: semantic.resultSha256, corpusSha256: factory.corpusSha256 });
  expect(plan.sources.map(s => s.alias)).toEqual(semantic.turnIds.map((_, i) => `s${String(i).padStart(3, "0")}`));
  expect(plan.sources.map(s => s.turnId)).toEqual([...semantic.turnIds]);
  for (const s of plan.sources) { const turn = turnById.get(s.turnId)!; expect(s).toMatchObject({ sessionId: turn.sessionId, sessionIndex: turn.sessionIndex, date: turn.date,
    speaker: turn.speaker, textSha256: sha256Hex(turn.text), renderedBytes: Buffer.byteLength(renderTurn(turn)) }); expect(Object.keys(s)).not.toContain("text"); }
  expect(plan.request.body.messages.map((m: any) => m.role)).toEqual(["system", "user"]);
  expect(plan.request.body.messages[0]!.content).toBe(EVOLUTION_READER_CONTRACTS["evidence-selection-v1"].instruction);
  const prompt = JSON.parse(plan.request.body.messages[1]!.content);
  expect(prompt).toEqual({ question: q0.question, questionDate: q0.questionDate, sources: plan.sources.map(s => renderTurn({ ...turnById.get(s.turnId)!, id: s.alias })).join("\n\n") });
  expect(validateEvolutionRequest(plan.request)).toEqual(plan.request);
  expect(factory.validateSelectionPlan(q0, pool(semantic), JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  expect(() => factory.validateSelectionPlan(q0, pool(semantic), { ...plan, instructionSha256: sha256Hex("other") })).toThrow("selection plan differs");
  expect(() => factory.validateSelectionPlan(q0, pool(semantic), { ...plan, extra: 1 })).toThrow("selection plan shape");
  expect(() => factory.makeSelectionPlan(q0, pool(semantic), PROFILES.answer as any)).toThrow("closed selector profile");
  expect(() => factory.makeSelectionPlan(q0, pool(semantic, { ...variants[0]!, budget: { topK: 50, contextBytes: 96_000 } }), PROFILES.primary)).toThrow("pinned pool variant");
  expect(() => factory.makeSelectionPlan(q0, { ...pool(semantic), expectedResultSha256: sha256Hex("x") }, PROFILES.primary)).toThrow("pinned pool variant");
  expect(() => factory.makeSelectionPlan(question(1), pool(semantic), PROFILES.primary)).toThrow("pinned pool variant, query or result identity");
  expect(() => factory.makeSelectionPlan(q0, pool({ ...semantic, context: semantic.context + " " }), PROFILES.primary)).toThrow();
  expect(() => factory.makeSelectionPlan(q0, pool(window, variants[0]!), PROFILES.primary)).toThrow("pinned pool variant");
  const windowPlan = factory.makeSelectionPlan(q0, pool(window, variants[1]!), PROFILES.ablation);
  expect(windowPlan.request.profileId).toBe(PROFILES.ablation); expect(windowPlan.sources.map(s => s.turnId)).toEqual([...window.turnIds]);
  const respond = (p: typeof plan, answer: string, finish = "stop", tools = false) => {
    const bytes = raw(answer, EVOLUTION_PROFILES[p.selectorProfile]!.model, finish, tools);
    return factory.reconstruct(q0, pool(p === plan ? semantic : window, p === plan ? variants[0]! : variants[1]!), p, bytes, parseEvolutionResponse(bytes, p.request));
  };
  const selected = respond(plan, '{"ids":["s002","s000"]}');
  if (selected.kind !== "selected") throw new Error("expected a selection");
  expect(selected.context).toMatchObject({ protocol: "oh.memory.selected-evidence-context.v2", selectionPlanSha256: plan.planSha256, selectorRequestSha256: plan.request.requestSha256,
    poolResultSha256: semantic.resultSha256, selectedAliases: ["s002", "s000"], packedAliases: ["s000", "s002"], omittedAliasesForBudget: [], contextByteLimit: 96_000 });
  expect(selected.context.context).toBe(expectedContext(semantic, ["s002", "s000"]));
  expect(selected.context.turnIds).toEqual([semantic.turnIds[0]!, semantic.turnIds[2]!]); expect(selected.context.contextSha256).toBe(sha256Hex(selected.context.context));
  expect(selected.context.sources.map(s => s.recordSha256)).toEqual([semantic.sources[0]!.recordSha256, semantic.sources[2]!.recordSha256]);
  { const { resultSha256, ...payload } = selected.context; expect(resultSha256).toBe(canonicalSha256(payload)); }
  expect(Object.isFrozen(selected.context)).toBeTrue();
  const answer = makeEvolutionTwoStageAnswerRequest(q0, semantic, selected);
  expect(answer.profileId).toBe(PROFILES.answer);
  expect(answer.body.messages).toEqual(evolutionAnswerMessages(q0, selected.context.context, "selected-answer-v1"));
  expect(() => makeEvolutionTwoStageAnswerRequest(q0, window, selected)).toThrow("selected context does not belong to this pool");
  for (const [reason, value, finish, tools] of [["empty-selection", '{"ids":[]}', "stop", false], ["invalid-selection", "s000 and s001", "stop", false],
    ["invalid-selection", '{"ids":["s099"]}', "stop", false], ["selector-truncated", '{"ids":["s000"', "length", false], ["selector-failed", "", "stop", true]] as const) {
    const fallback = respond(plan, value, finish, tools);
    expect(fallback).toMatchObject({ kind: "fallback", reason, selectorRequestSha256: plan.request.requestSha256 });
    const request = makeEvolutionTwoStageAnswerRequest(q0, semantic, fallback);
    expect(request.profileId).toBe(PROFILES.fallback); expect(request.body.messages).toEqual(evolutionAnswerMessages(q0, semantic.context, "calibration-only-v1"));
  }
  const bytes = raw('{"ids":["s000"]}', EVOLUTION_PROFILES[PROFILES.primary]!.model), parsed = parseEvolutionResponse(bytes, plan.request);
  expect(() => factory.reconstruct(q0, pool(semantic), plan, raw('{"ids":["s001"]}', EVOLUTION_PROFILES[PROFILES.primary]!.model), parsed)).toThrow("not the exact captured response");
});

test("complete fake-provider matrix: six arms on two pins, shared physical requests, router audit, 2x2 memory delta and zero-call replay", async () => {
  const f = await fixture(), fake = fakeProvider();
  try {
    expect(f.plan).toMatchObject({ protocol: "oh.memory.two-stage-experiment-plan.v1", contextPlanSha256: f.context.planSha256, policySha256: canonicalSha256(OH_SELECTOR_POLICY_V2),
      routerSha256: canonicalSha256(EVOLUTION_QUESTION_SHAPE_ROUTER_V1) });
    expect(f.plan.routes.filter(r => r.routed).map(r => r.questionId)).toEqual(Array.from({ length: 50 }, (_, i) => qid(2 * i)));
    expect(f.plan.pools).toHaveLength(200); expect(f.plan.cases).toHaveLength(1200);
    expect(f.plan.selections).toHaveLength(400); expect(f.plan.selections.every(s => s.plan !== null && s.preparationFailure === null)).toBeTrue();
    expect(f.plan.selections.filter(s => s.selectorProfile === PROFILES.ablation)).toHaveLength(200);
    expect(f.plan.maximumPhysicalCalls).toBe(400 + 2400);
    expect(f.plan.reservationBounds.selectionMicros).toBe(f.plan.selections.reduce((s, c) => s + c.plan!.request.reservationMicros, 0));
    expect(JSON.stringify(f.plan)).not.toContain("GOLD_SECRET");
    const frozen: string[] = [];
    const report = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher,
      onPhasePrepared: async phase => { expect(phase.cases).toHaveLength(1200); expect(Object.isFrozen(phase)).toBeTrue(); expect(fake.counts[phase.phase]).toBe(0);
        await f.pin(`${phase.phase}-prepared.json`, phase); frozen.push(phase.phase); } });
    expect(frozen).toEqual(["answer", "judge"]);
    expect(report.protocol).toBe("oh.memory.two-stage-lane-report.v1"); expect(report.complete).toBeTrue(); expect(report.status).toBe("complete");
    expect(report.cases).toHaveLength(1200); expect(report.denominator).toBe(100);
    expect(report.coverage).toEqual({ completeCaseAccounting: true, completeAttemptCoverage: true, logicalCases: 1200, preparationFailedCases: 0, occupiedRequests: 1150, notRunRequests: 0 });
    // Unrouted two-stage cases share the calibration-only control's physical answer requests, each routed arm's selections
    // coincide with its all-questions arm's (200 mini + 200 nano selections), and the nano selector's identical selections
    // yield byte-identical stage-2 requests. Judge prompts dedupe by identical answer strings: 100 correct plus 50 wrong answers.
    expect(fake.counts).toEqual({ select: 400, answer: 600, judge: 150 });
    expect(report.total).toMatchObject({ newlyOccupied: 400 + 600 + 150, unresolvedMicros: 0, notRun: 0 });
    expect(report.phases.select).toMatchObject({ physicalRequests: 400, completed: 400 });
    const selectionOf = (arm: EvolutionTwoStageArmId, questionId: string, variantId: string) => report.cases.find(c => c.arm === arm && c.questionId === questionId && c.variantId === variantId)!.selectionRequestSha256;
    for (const v of f.config.variantIds) for (const q of [qid(0), qid(2)]) {
      expect(selectionOf("two-stage-routed", q, v)).toBe(selectionOf("two-stage-all", q, v)); expect(selectionOf("two-stage-routed-nano", q, v)).toBe(selectionOf("two-stage-all-nano", q, v));
      expect(selectionOf("two-stage-all", q, v)).not.toBe(selectionOf("two-stage-all-nano", q, v));
    }
    for (const c of report.cases) {
      expect(c).toMatchObject({ judgeStatus: "completed", readerStatus: "completed" });
      expect(typeof c.answerRequestSha256).toBe("string"); expect(typeof c.judgeRequestSha256).toBe("string");
      const spec = EVOLUTION_TWO_STAGE_ARMS[c.arm];
      if (spec.kind === "single") { expect(c).toMatchObject({ selectorStatus: "not-applicable", memory: "full-context", selectionRequestSha256: null, reader: spec.reader, repeat: 0 }); continue; }
      if (spec.routed && !c.routed) { expect(c).toMatchObject({ selectorStatus: "not-applicable", memory: "full-context", reader: PROFILES.fallback, selectionRequestSha256: null }); continue; }
      expect(c).toMatchObject({ selectorStatus: "completed", memory: "selected", reader: PROFILES.answer, selectorProfile: spec.selector, fallbackReason: null });
      expect(typeof c.selectionRequestSha256).toBe("string");
      const pool = f.results.get(`${c.questionId}:${c.variantId}`)!, aliases = pool.turnIds.length > 1 ? ["s001", "s000"] : ["s000"];
      expect(c.selectedTurnCount).toBe(aliases.length); expect(c.selectedContextSha256).toBe(sha256Hex(expectedContext(pool, aliases)));
      const attempt = report.attempts.find(a => a.request.requestSha256 === c.answerRequestSha256)!;
      expect(JSON.parse(attempt.request.body.messages[1]!.content).memory).toBe(expectedContext(pool, aliases));
    }
    const summary = (arm: EvolutionTwoStageArmId, variantId: string) => report.summaries.find(s => s.arm === arm && s.variantId === variantId)!;
    for (const v of f.config.variantIds) {
      expect(summary("single-call-eac", v)).toMatchObject({ denominator: 100, repeats: 1, logicalCases: 100, majorityCorrect: 50, meanCorrect: 50, perRepeat: [50], failedCases: 0, routedQuestions: 50, selectionsPlanned: 0, selectionsCompleted: 0, fallbackRate: null });
      expect(summary("calibration-only", v)).toMatchObject({ majorityCorrect: 100, selectionsPlanned: 0 });
      expect(summary("two-stage-routed", v)).toMatchObject({ majorityCorrect: 100, selectionsPlanned: 50, selectionsCompleted: 50, selected: 50, fallbacks: 0, fallbackRate: 0 });
      expect(summary("two-stage-all", v)).toMatchObject({ majorityCorrect: 100, selectionsPlanned: 100, selectionsCompleted: 100, selected: 100, fallbackRate: 0 });
      expect(summary("two-stage-routed-nano", v)).toMatchObject({ majorityCorrect: 100, selectionsPlanned: 50, selectionsCompleted: 50, selected: 50, fallbackRate: 0 });
      expect(summary("two-stage-all-nano", v)).toMatchObject({ majorityCorrect: 100, selectionsPlanned: 100, selectionsCompleted: 100, selected: 100, fallbacks: 0, emptyPoolCases: 0, fallbackRate: 0 });
      const pairedRow = (arm: EvolutionTwoStageArmId, control: EvolutionTwoStageArmId) => report.paired.find(p => p.arm === arm && p.control === control && p.variantId === v)!;
      expect(pairedRow("two-stage-all-nano", "single-call-eac").gate.rule).toMatchObject({ minimumMajorityDelta: 3, maximumRegressions: 2 });
      expect(summary("two-stage-all", v).categories.map(c => c.category)).toEqual(["multi-session", "temporal-reasoning"]);
      const paired = pairedRow("two-stage-all", "single-call-eac");
      expect(paired).toMatchObject({ control: "single-call-eac", denominator: 100, majorityDelta: 50, meanDelta: 50, wins: 50, losses: 0, ties: 50,
        temporal: { category: "temporal-reasoning", denominator: 25, majorityDelta: 25 } });
      expect(paired.comparison).toContain("includes the calibration instruction");
      expect(paired.gate).toMatchObject({ majorityDeltaOk: true, regressionsOk: true, temporalOk: true, fallbackOk: true, descriptivePass: false, rule: { minimumMajorityDelta: 3, maximumRegressions: 2 } });
      expect(pairedRow("calibration-only", "single-call-eac").gate.rule).toMatchObject({ minimumMajorityDelta: 2, maximumRegressions: 1 });
      // The calibration-only control is the exact physical answer of every unrouted and fallback case, so the rows against it
      // isolate the selection gain: here the fake answers every calibration-only and selected case correctly, so every delta is zero.
      for (const arm of ["two-stage-routed", "two-stage-all", "two-stage-routed-nano", "two-stage-all-nano"] as const) {
        const isolated = pairedRow(arm, "calibration-only");
        expect(isolated).toMatchObject({ arm, control: "calibration-only", variantId: v, majorityDelta: 0, meanDelta: 0, wins: 0, losses: 0, ties: 100,
          gate: { rule: { minimumMajorityDelta: 3, maximumRegressions: 2 }, majorityDeltaOk: false, regressionsOk: true, temporalOk: true, fallbackOk: true, descriptivePass: false } });
        expect(isolated.comparison).toContain("selection gain alone");
      }
      expect(report.paired.filter(p => p.control === "calibration-only" && p.variantId === v).map(p => p.arm)).toEqual(["two-stage-routed", "two-stage-all", "two-stage-routed-nano", "two-stage-all-nano"]);
    }
    // Five arms against the single-call control plus four two-stage arms against the calibration-only control, on two pins.
    expect(report.paired).toHaveLength(10 + 8);
    expect(report.paired.slice(0, 10).every(p => p.control === "single-call-eac")).toBeTrue();
    expect(report.memoryDelta).toEqual(f.config.arms.map(arm => ({ arm, minuend: "semantic-96k", subtrahend: "window-96k", majorityDelta: 0, meanDelta: 0 })));
    expect(report.routerAudit).toMatchObject({ denominator: 100, routed: 50, hitRate: 0.5, byShape: { aggregate: 50, other: 50 },
      routedByCategory: { "temporal-reasoning": { denominator: 25, routed: 25 }, "multi-session": { denominator: 75, routed: 25 } } });
    expect(report.routerAudit.categoryLeakage).toEqual({ aggregate: { "multi-session": 25, "temporal-reasoning": 25 }, order: { "multi-session": 0, "temporal-reasoning": 0 },
      recommendation: { "multi-session": 0, "temporal-reasoning": 0 }, other: { "multi-session": 50, "temporal-reasoning": 0 } });
    expect(JSON.stringify({ routes: report.routes, audit: report.routerAudit, cases: report.cases, summaries: report.summaries, paired: report.paired })).not.toContain("trails");
    expect(report.phasePlans).toHaveLength(2); expect(report.judge).toBe("gpt4o-gateway-native-rubric-16-judge-v1");
    const replay = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: { ...credential(), token: "" },
      fetcher: async () => { throw new Error("Never redispatch cached captures"); } });
    expect(replay.total).toMatchObject({ newlyOccupied: 0, cacheHits: 1150, confirmedMicros: report.total.confirmedMicros });
    expect(replay.cases).toEqual(report.cases); expect(replay.paired).toEqual(report.paired);
    const scored = (rows: typeof report.summaries) => rows.map(({ accounting, ...rest }) => rest);
    expect(scored(replay.summaries)).toEqual(scored(report.summaries)); expect(replay.summaries.map(s => s.accounting.cacheHits)).toEqual(report.summaries.map(s => s.accounting.physicalRequests));
    const store = await openEvolutionStore({ directory: f.campaign.storeDirectory, campaign: f.campaign });
    try { expect(store.summary().calls).toBe(1150); for (const a of report.attempts) expect(sha256Hex(store.readRaw(a.request, a.repeat))).toBe(a.response!.rawSha256); } finally { await store.close(); }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 120_000);

test("three repeats live in one store by repeat index; invalid, empty, foreign, truncated, refused and failed selections fall back, stay flagged and count", async () => {
  const f = await fixture({ arms: ["single-call-eac", "two-stage-all"], variantIds: ["semantic-96k"], repeats: 3 }), fake = fakeProvider("mixed-failures");
  try {
    expect(f.plan.cases).toHaveLength(600); expect(f.plan.selections).toHaveLength(100); expect(f.plan.maximumPhysicalCalls).toBe(300 + 1200);
    const report = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.complete).toBeTrue(); expect(fake.counts.select).toBe(300);
    // Truncated, tool-calling and refused selections are charged failures of the selection phase; invalid and empty ones completed.
    expect(report.phases.select).toMatchObject({ physicalRequests: 300, completed: 300 - 3 * 3, failed: 3 * 3, unresolvedMicros: 0 });
    const twoStage = report.cases.filter(c => c.arm === "two-stage-all");
    expect(new Set(twoStage.map(c => c.repeat))).toEqual(new Set([0, 1, 2]));
    const reasons = (id: string) => twoStage.filter(c => c.questionId === id).map(c => [c.memory, c.fallbackReason, c.reader, c.readerStatus, c.judgeStatus, c.score]);
    expect(reasons("q000")).toEqual(Array(3).fill(["fallback", "invalid-selection", PROFILES.fallback, "completed", "completed", 1]));
    expect(reasons("q002")).toEqual(Array(3).fill(["fallback", "selector-truncated", PROFILES.fallback, "completed", "completed", 1]));
    expect(reasons("q004")).toEqual(Array(3).fill(["fallback", "empty-selection", PROFILES.fallback, "completed", "completed", 1]));
    expect(reasons("q006")).toEqual(Array(3).fill(["fallback", "invalid-selection", PROFILES.fallback, "completed", "completed", 1]));
    expect(reasons("q008")).toEqual(Array(3).fill(["fallback", "selector-failed", PROFILES.fallback, "completed", "completed", 1]));
    expect(reasons("q010")).toEqual(Array(3).fill(["fallback", "selector-failed", PROFILES.fallback, "completed", "completed", 1]));
    expect(report.attempts.find(a => a.request.requestSha256 === twoStage.find(c => c.questionId === "q010")!.selectionRequestSha256)!.response).toMatchObject({ status: "refused", failureReason: "provider-refusal" });
    expect(reasons("q012")).toEqual(Array(3).fill(["selected", null, PROFILES.answer, "completed", "completed", 1]));
    const summary = report.summaries.find(s => s.arm === "two-stage-all")!;
    expect(summary).toMatchObject({ repeats: 3, logicalCases: 300, selectionsPlanned: 300, selectionsCompleted: 300, selected: 282, fallbacks: 18, emptyPoolCases: 0, fallbackRate: 0.06,
      fallbackReasons: { "empty-selection": 3, "invalid-selection": 6, "selector-failed": 6, "selector-truncated": 3 }, majorityCorrect: 100, meanCorrect: 100, perRepeat: [100, 100, 100] });
    expect(summary.statuses.selectorStatus).toEqual({ completed: 300 });
    const control = report.summaries.find(s => s.arm === "single-call-eac")!;
    expect(control).toMatchObject({ majorityCorrect: 50, meanCorrect: 50, perRepeat: [50, 50, 50] });
    expect(control.perQuestion.find(q => q.questionId === "q000")).toMatchObject({ scores: [0, 0, 0], mean: 0, majority: 0 });
    expect(control.perQuestion.find(q => q.questionId === "q001")).toMatchObject({ scores: [1, 1, 1], mean: 1, majority: 1 });
    const paired = report.paired[0]!;
    expect(paired).toMatchObject({ arm: "two-stage-all", control: "single-call-eac", majorityDelta: 50, wins: 50, losses: 0, ties: 50 });
    expect(paired.gate).toMatchObject({ descriptivePass: true, fallbackOk: true });
    expect(report.memoryDelta).toBeNull();
    // The same logical request is three distinct physical rows; the control's three repeats reuse one request digest.
    const controlRequests = new Set(report.cases.filter(c => c.arm === "single-call-eac").map(c => c.answerRequestSha256));
    expect(controlRequests.size).toBe(100); expect(report.cases.filter(c => c.arm === "single-call-eac")).toHaveLength(300);
    // 150 distinct judge prompts (two answers on routed questions, one on the rest) times three repeats.
    expect(report.total.physicalRequests).toBe(300 + 600 + 450);
    const store = await openEvolutionStore({ directory: f.campaign.storeDirectory, campaign: f.campaign });
    try {
      expect(store.summary().calls).toBe(1350);
      const first = report.cases.find(c => c.arm === "single-call-eac" && c.questionId === "q001")!, request = report.attempts.find(a => a.request.requestSha256 === first.answerRequestSha256)!.request;
      for (const repeat of [0, 1, 2]) expect(store.lookup(request, repeat).kind).toBe("hit"); expect(store.lookup(request, 3).kind).toBe("miss");
    } finally { await store.close(); }
    const replay = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: { ...credential(), token: "" }, fetcher: async () => { throw new Error("no redispatch"); } });
    expect(replay.total).toMatchObject({ newlyOccupied: 0, cacheHits: 1350 }); expect(replay.cases).toEqual(report.cases);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 120_000);

test("a selection request above the fixed byte cap fails preparation without truncating the pool and keeps its cases in the denominator", async () => {
  const results = await retrieveAll(1, heavy), factory = prepareEvolutionTwoStage({ ...heavy, groupId: heavy.id }), semantic = results.get("q000:semantic-96k")!;
  expect(semantic.contextBytes).toBeLessThanOrEqual(OH_SELECTOR_POLICY_V2.contextByteLimit); expect(semantic.turnIds.length).toBeGreaterThan(1);
  expect(() => factory.makeSelectionPlan(question(0, heavy.id), { variant: variants[0]!, result: semantic, expectedResultSha256: semantic.resultSha256 }, PROFILES.primary))
    .toThrow("Two-stage selector: selection request exceeds the fixed byte cap; never truncate the pool.");
  const f = await fixture({ corpus: heavy, arms: ["two-stage-all"], variantIds: ["semantic-96k"] });
  try {
    expect(f.plan.selections).toHaveLength(100);
    expect(f.plan.selections.every(s => s.plan === null && s.preparationFailure === "selection-input-rejected")).toBeTrue();
    expect(f.plan.cases.every(c => c.selectionPlanSha256 === null && c.selectorProfile === PROFILES.primary)).toBeTrue();
    expect(f.plan.maximumPhysicalCalls).toBe(200); expect(f.plan.reservationBounds.selectionMicros).toBe(0);
    const report = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: async () => { throw new Error("no dispatch"); } });
    expect(report.complete).toBeFalse(); expect(report.status).toBe("incomplete"); expect(report.stopped).toBeFalse(); expect(report.cases).toHaveLength(100);
    expect(report.cases.every(c => c.selectorStatus === "preparation-failed" && c.readerStatus === "skipped-selector" && c.judgeStatus === "skipped-reader"
      && c.memory === "full-context" && c.selectionRequestSha256 === null && c.answerRequestSha256 === null && c.score === 0)).toBeTrue();
    expect(report.coverage).toEqual({ completeCaseAccounting: true, completeAttemptCoverage: false, logicalCases: 100, preparationFailedCases: 100, occupiedRequests: 0, notRunRequests: 0 });
    expect(report.total).toMatchObject({ physicalRequests: 0, newlyOccupied: 0 }); expect(report.campaignAfter.calls).toBe(0);
    expect(report.summaries[0]).toMatchObject({ arm: "two-stage-all", denominator: 100, majorityCorrect: 0, selectionsPlanned: 100, selectionsCompleted: 0, fallbacks: 0, fallbackRate: null,
      statuses: { selectorStatus: { "preparation-failed": 100 }, readerStatus: { "skipped-selector": 100 }, judgeStatus: { "skipped-reader": 100 } } });
    expect(report.paired).toEqual([]);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 120_000);

test("an empty pinned pool is a flagged empty-pool fallback on the calibration-only request, not a preparation failure, and stays out of the selector fallback rate", async () => {
  // q004 is routed and q005 is not; both share no term with any turn, so their BM25 window pools hold no turn.
  const f = await fixture({ arms: ["single-call-eac", "calibration-only", "two-stage-routed", "two-stage-all"], variantIds: ["window-96k"], emptyPoolQuestions: [4, 5] }), fake = fakeProvider("empty-pool");
  try {
    expect(f.plan.pools.filter(p => p.turnCount === 0).map(p => p.questionId)).toEqual(["q004", "q005"]);
    expect(f.results.get("q004:window-96k")!.turnIds).toEqual([]); expect(f.results.get("q005:window-96k")!.context).toBe("");
    // 98 mini selections for two-stage-all; two-stage-routed's 49 are the routed subset of the same selections. None is a preparation failure.
    expect(f.plan.selections).toHaveLength(98); expect(f.plan.selections.every(s => s.plan !== null && s.preparationFailure === null)).toBeTrue();
    expect(f.plan.selections.some(s => s.questionId === "q004" || s.questionId === "q005")).toBeFalse();
    expect(f.plan.cases).toHaveLength(400);
    const planned = (arm: EvolutionTwoStageArmId, questionId: string) => f.plan.cases.find(c => c.arm === arm && c.questionId === questionId)!;
    expect(planned("two-stage-all", "q004")).toMatchObject({ emptyPool: true, selectorProfile: null, selectionPlanSha256: null });
    expect(planned("two-stage-all", "q005")).toMatchObject({ emptyPool: true, selectorProfile: null });
    expect(planned("two-stage-routed", "q004")).toMatchObject({ emptyPool: true, selectorProfile: null, routed: true });
    expect(planned("two-stage-routed", "q005")).toMatchObject({ emptyPool: false, selectorProfile: null, routed: false });
    expect(planned("two-stage-all", "q006")).toMatchObject({ emptyPool: false, selectorProfile: PROFILES.primary });
    expect(planned("single-call-eac", "q004")).toMatchObject({ emptyPool: false, selectorProfile: null });
    expect(f.plan.cases.filter(c => c.emptyPool)).toHaveLength(3);
    const report = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.complete).toBeTrue(); expect(report.status).toBe("complete");
    expect(report.coverage).toMatchObject({ completeAttemptCoverage: true, logicalCases: 400, preparationFailedCases: 0, notRunRequests: 0 });
    // 98 selections; 100 single-call, 100 calibration-only and 98 selected-answer requests (empty-pool and unrouted cases share the calibration-only requests).
    expect(fake.counts.select).toBe(98); expect(fake.counts.answer).toBe(298);
    const row = (arm: EvolutionTwoStageArmId, questionId: string) => report.cases.find(c => c.arm === arm && c.questionId === questionId)!;
    for (const [arm, questionId] of [["two-stage-all", "q004"], ["two-stage-all", "q005"], ["two-stage-routed", "q004"]] as const) {
      expect(row(arm, questionId)).toMatchObject({ selectorStatus: "not-applicable", memory: "fallback", fallbackReason: "empty-pool", selectorProfile: null, selectionRequestSha256: null,
        selectedTurnCount: null, selectedContextSha256: null, reader: PROFILES.fallback, readerStatus: "completed", judgeStatus: "completed", score: 1 });
      expect(row(arm, questionId).answerRequestSha256).toBe(row("calibration-only", questionId).answerRequestSha256);
      expect(JSON.parse(report.attempts.find(a => a.request.requestSha256 === row(arm, questionId).answerRequestSha256)!.request.body.messages[1]!.content).memory).toBe("");
    }
    expect(row("two-stage-routed", "q005")).toMatchObject({ selectorStatus: "not-applicable", memory: "full-context", fallbackReason: null, reader: PROFILES.fallback, score: 1 });
    expect(row("two-stage-all", "q006")).toMatchObject({ selectorStatus: "completed", memory: "selected", fallbackReason: null, reader: PROFILES.answer, score: 1 });
    expect(row("single-call-eac", "q004")).toMatchObject({ memory: "full-context", fallbackReason: null, score: 0 });
    expect(row("single-call-eac", "q005")).toMatchObject({ memory: "full-context", fallbackReason: null, score: 1 });
    const summary = (arm: EvolutionTwoStageArmId) => report.summaries.find(s => s.arm === arm)!;
    expect(summary("two-stage-all")).toMatchObject({ majorityCorrect: 100, selectionsPlanned: 98, selectionsCompleted: 98, selected: 98, fallbacks: 0, emptyPoolCases: 2, fallbackRate: 0, fallbackReasons: {},
      statuses: { selectorStatus: { completed: 98, "not-applicable": 2 } } });
    expect(summary("two-stage-routed")).toMatchObject({ majorityCorrect: 100, selectionsPlanned: 49, selectionsCompleted: 49, selected: 49, fallbacks: 0, emptyPoolCases: 1, fallbackRate: 0 });
    expect(summary("calibration-only")).toMatchObject({ majorityCorrect: 100, emptyPoolCases: 0 }); expect(summary("single-call-eac")).toMatchObject({ majorityCorrect: 50, emptyPoolCases: 0 });
    // Three rows against the single-call control, then two against the calibration-only control.
    expect(report.paired.map(p => [p.arm, p.control])).toEqual([["calibration-only", "single-call-eac"], ["two-stage-routed", "single-call-eac"], ["two-stage-all", "single-call-eac"],
      ["two-stage-routed", "calibration-only"], ["two-stage-all", "calibration-only"]]);
    expect(report.paired[2]).toMatchObject({ majorityDelta: 50, wins: 50, losses: 0, ties: 50, gate: { fallbackOk: true } });
    expect(report.paired[4]).toMatchObject({ majorityDelta: 0, wins: 0, losses: 0, ties: 100 });
    expect(JSON.stringify({ plan: f.plan, cases: report.cases, summaries: report.summaries })).not.toContain("colour");
    const replay = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: { ...credential(), token: "" }, fetcher: async () => { throw new Error("no redispatch"); } });
    expect(replay.total).toMatchObject({ newlyOccupied: 0 }); expect(replay.cases).toEqual(report.cases); expect(replay.paired).toEqual(report.paired);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 120_000);

test("a fallback rate above the gate fails fallbackOk and the descriptive pass even when every paired delta passes", async () => {
  const f = await fixture({ arms: ["single-call-eac", "two-stage-all"], variantIds: ["window-96k"] }), fake = fakeProvider("high-fallback");
  try {
    const report = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(report.complete).toBeTrue(); expect(fake.counts.select).toBe(100);
    const summary = report.summaries.find(s => s.arm === "two-stage-all")!;
    expect(summary).toMatchObject({ selectionsPlanned: 100, selectionsCompleted: 100, selected: 87, fallbacks: 13, fallbackRate: 0.13, fallbackReasons: { "empty-selection": 13 }, majorityCorrect: 100 });
    expect(summary.statuses.selectorStatus).toEqual({ completed: 100 });
    const paired = report.paired[0]!;
    expect(paired).toMatchObject({ arm: "two-stage-all", majorityDelta: 50, wins: 50, losses: 0, ties: 50 });
    expect(paired.gate).toMatchObject({ majorityDeltaOk: true, regressionsOk: true, temporalOk: true, fallbackOk: false, descriptivePass: false, rule: { fallbackRateAtMost: 0.1 } });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 120_000);

test("an uncertain selection dispatch keeps its full reservation, stops admission, stays unresolved and replays without retry", async () => {
  const f = await fixture({ arms: ["two-stage-all"], variantIds: ["semantic-96k"], concurrency: 1 }), fake = fakeProvider("selector-network");
  try {
    const report = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(fake.counts.select).toBe(1); expect(report.stopped).toBeTrue(); expect(report.complete).toBeFalse(); expect(report.status).toBe("incomplete");
    expect(report.cases.map(c => c.selectorStatus).sort()).toEqual([...Array<string>(99).fill("not-run"), "unresolved"]);
    expect(report.cases.every(c => c.readerStatus === "skipped-selector" && c.judgeStatus === "skipped-reader" && c.memory === "full-context" && c.answerRequestSha256 === null && c.score === 0)).toBeTrue();
    const unresolved = report.attempts.filter(a => a.failure !== null);
    expect(unresolved).toHaveLength(1); expect(report.attempts).toHaveLength(100);
    expect(unresolved[0]!.failure).toMatchObject({ storeStatus: "captured", reason: "unverifiable-first-response", transport: { httpStatus: null, complete: false, error: "network" },
      reservationMicros: unresolved[0]!.request.reservationMicros });
    expect(unresolved[0]!.response).toBeNull(); expect(unresolved[0]!).toMatchObject({ phase: "select", notRun: null, newlyOccupied: true });
    expect(report.attempts.filter(a => a.notRun === "admission-stopped")).toHaveLength(99);
    expect(report.total).toMatchObject({ physicalRequests: 100, occupiedRequests: 1, newlyOccupied: 1, notRun: 99, confirmedMicros: 0, unresolvedMicros: unresolved[0]!.request.reservationMicros });
    // An unresolved reservation alone keeps the run incomplete, independently of the not-run remainder.
    expect(report.total.unresolvedMicros).toBeGreaterThan(0); expect(report.coverage.completeAttemptCoverage).toBeFalse();
    expect(report.campaignAfter).toMatchObject({ calls: 1, confirmedMicros: 0, unresolvedMicros: unresolved[0]!.request.reservationMicros });
    expect(report.summaries[0]).toMatchObject({ selectionsPlanned: 100, selectionsCompleted: 0, fallbacks: 0, fallbackRate: null, majorityCorrect: 0 });
    expect(report.summaries[0]!.statuses.selectorStatus).toEqual({ "not-run": 99, unresolved: 1 });
    // A later invocation never retries the unresolved attempt, but unrelated requests may proceed (EVOLUTION.md);
    // here the next dispatch is uncertain too, so the replay occupies exactly one more request and stops again.
    const replay = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: fake.fetcher });
    expect(fake.counts.select).toBe(2); expect(replay.stopped).toBeTrue(); expect(replay.complete).toBeFalse();
    const original = replay.attempts.find(a => a.request.requestSha256 === unresolved[0]!.request.requestSha256 && a.repeat === unresolved[0]!.repeat)!;
    expect(original).toMatchObject({ cached: true, newlyOccupied: false, notRun: null, response: null }); expect(original.failure).toEqual(unresolved[0]!.failure);
    expect(replay.total).toMatchObject({ newlyOccupied: 1, occupiedRequests: 2, notRun: 98, failed: 2 }); expect(replay.total.unresolvedMicros).toBeGreaterThan(report.total.unresolvedMicros);
    expect(replay.campaignAfter).toMatchObject({ calls: 2, confirmedMicros: 0 });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 120_000);

test("zero allowance keeps every case in the denominator without dispatch; config parser pins the fixed development matrix", async () => {
  const f = await fixture({ arms: ["two-stage-routed"], variantIds: ["window-96k"], maximumNewCalls: 0 });
  try {
    const report = await runEvolutionTwoStageLane({ configPin: f.configPin, planPin: f.planPin, credential: credential(), fetcher: async () => { throw new Error("no admission"); } });
    expect(report.complete).toBeFalse(); expect(report.status).toBe("incomplete"); expect(report.cases).toHaveLength(100);
    expect(report.cases.filter(c => c.routed).every(c => c.selectorStatus === "not-run" && c.readerStatus === "skipped-selector" && c.judgeStatus === "skipped-reader" && c.score === 0)).toBeTrue();
    expect(report.cases.filter(c => !c.routed).every(c => c.readerStatus === "not-run" && c.score === 0)).toBeTrue();
    expect(report.total).toMatchObject({ newlyOccupied: 0, notRun: 100, occupiedRequests: 0 });
    expect(report.coverage).toMatchObject({ completeAttemptCoverage: false, preparationFailedCases: 0, occupiedRequests: 0, notRunRequests: 100 });
    // No selection completed, so the fallback rate is undefined rather than an understated zero.
    expect(report.summaries[0]).toMatchObject({ denominator: 100, majorityCorrect: 0, selectionsPlanned: 50, selectionsCompleted: 0, selected: 0, fallbacks: 0, fallbackRate: null });
    const base = JSON.parse(JSON.stringify(f.config));
    expect(parseEvolutionTwoStageLaneConfig(base)).toEqual(f.config);
    for (const [label, mutate] of [["protocol", (c: any) => { c.protocol = "oh.memory.fact-card-experiment.v1"; }], ["99 ids", (c: any) => { c.questionIds = c.questionIds.slice(1); }],
      ["repeats", (c: any) => { c.repeats = 4; }], ["arm", (c: any) => { c.arms = ["quote-cards"]; }], ["variants", (c: any) => { c.variantIds = ["a", "b", "c"]; }],
      ["duplicate arm", (c: any) => { c.arms = ["two-stage-all", "two-stage-all"]; }], ["pins", (c: any) => { c.scorerPin = c.sourcePin; }], ["calls", (c: any) => { c.maximumNewCalls = 12_001; }],
      ["extra", (c: any) => { c.repeat = 1; }]] as const) {
      const c = JSON.parse(JSON.stringify(base)); mutate(c);
      expect(() => parseEvolutionTwoStageLaneConfig(c), label).toThrow("Two-stage lane:");
    }
    await expect(prepareEvolutionTwoStageLane(await f.pin("config-bad.json", { ...base, contextPlanSha256: sha256Hex("other") }))).rejects.toThrow("pinned V1 context plan identity");
    await expect(prepareEvolutionTwoStageLane(await f.pin("config-bad2.json", { ...base, questionIds: [...base.questionIds].reverse() }))).rejects.toThrow("exact ordered development selection");
    const { planSha256: _ignored, ...changedPayload } = { ...f.context, variants: [{ ...variants[1]!, budget: { topK: 100, contextBytes: 48_000 } }, variants[0]!] };
    const changedSha = canonicalSha256(changedPayload);
    await expect(prepareEvolutionTwoStageLane(await f.pin("config-bad3.json", { ...base, contextPin: await f.pin("context-bad.json", { ...changedPayload, planSha256: changedSha }),
      contextPlanSha256: changedSha }))).rejects.toThrow();
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 60_000);
