import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { OH_EMBEDDING_PROFILE_V1 } from "../src/semantic";
import { DATASETS, selectSplit, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { createEvolutionFullHistorySource } from "../scripts/benchmarks/evolution-full-history";
import { renderTurn } from "../scripts/benchmarks/retrieval";
import { makeEvolutionJudgePlan, scoreEvolutionJudgeDecision, evolutionJudgeScoringRule } from "../scripts/benchmarks/evolution-judge";
import { EVOLUTION_LOCOMO_CATEGORY_NAMES, EVOLUTION_LOCOMO_J_CATEGORIES, EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, EVOLUTION_LOCOMO_JUDGE_RUBRIC_SHA,
  buildLocomoJudgeMessages, loadLocomoJudgeProfile, parseLocomoJudgeDecision } from "../scripts/benchmarks/evolution-locomo-judge";
import { EVOLUTION_PROFILES, evolutionReaderContract, evolutionReaderProfileId, makeEvolutionRequest, parseEvolutionResponse, validateEvolutionRequest,
  type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { makeEvolutionContextPlan, makeEvolutionReaderPlan, type EvolutionContextPlan } from "../scripts/benchmarks/evolution-plan";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { EVOLUTION_READER_DATE_POLICIES, evolutionFinalSessionDates, evolutionReaderDatePolicySha256, parseEvolutionReaderDatePolicy,
  projectEvolutionRunnerInputV9 } from "../scripts/benchmarks/evolution-reader-date-policy";
import { LOCOMO_SELECTION_PROTOCOL, locomoParitySelection, makeLocomoExposureManifest, parseLocomoExposureArgs, summarizeLocomoExposure,
  writeLocomoExposure } from "../scripts/benchmarks/evolution-locomo-exposure";
import { EVOLUTION_STUDY_V9_PROTOCOL, makeEvolutionStudyV9Scope, parseEvolutionStudyV9, selectEvolutionStudyV9Shard, validateEvolutionStudyV9Artifacts,
  type EvolutionStudyV9 } from "../scripts/benchmarks/evolution-study-v9";
import { evolutionContextBindingV9, makeEvolutionContextPlanV9 } from "../scripts/benchmarks/evolution-plan-v9";
import { evolutionJobKey, evolutionReaderJobsV2, makeEvolutionReaderPlanV2 } from "../scripts/benchmarks/evolution-reader-plan-v2";
import { evolutionJudgeJobsV9, loadEvolutionJudgeRubricV9, makeEvolutionJudgePlanV9 } from "../scripts/benchmarks/evolution-judge-v9";
import { EVOLUTION_PHASE_V2_PROTOCOL, buildEvolutionReportV9 } from "../scripts/benchmarks/evolution-report-v9";
import { parseEvolutionRunConfig } from "../scripts/benchmarks/evolution";
import { EVOLUTION_RUN_V9_PROTOCOL } from "../scripts/benchmarks/evolution-runner-v9";

const oldFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("No provider or network in LoCoMo fixtures"); }, { preconnect() { throw Error("No network"); } }); });
afterAll(() => { globalThis.fetch = oldFetch; });
const bytes = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
const h = canonicalSha256;
const gold = (i: number) => `PRIVATE_GOLD_SENTINEL_${i}`;
/** Ten synthetic conversations shaped like LoCoMo: named speakers, dated sessions, categories 1-5, empty question dates. */
function locomoSource(root = "/example/locomo") {
  const corpora = Array.from({ length: 10 }, (_, c) => ({ id: `conv-${c}`, groupId: `conv-${c}`, turns: [0, 1, 2].map(n => ({ id: `D${n + 1}:1`, sessionId: `session_${n + 1}`,
    date: `1:${n + 1}0 pm on 2${n} May, 2023`, speaker: n % 2 ? "Caroline" : "Melanie", text: `Synthetic memory ${c}/${n} about a pottery class.` })) }));
  const questions = corpora.flatMap((corpus, c) => [1, 2, 3, 4, 5, 4, 1].map((category, i) => ({ id: `${corpus.id}:${i}`, corpusId: corpus.id, category: `locomo:${category}`,
    question: `Synthetic question ${c}/${i}?`, questionDate: "", answer: category === 5 ? "" : gold(i), unanswerable: category === 5,
    evidenceTurnIds: [corpus.turns[i % 3]!.id], evidenceSessionIds: [corpus.turns[i % 3]!.sessionId] })));
  const dataset: Dataset = { corpora, questions }, manifest = makeLocomoExposureManifest(dataset), manifestBytes = bytes(manifest);
  const pin = (name: string, sha256: string) => ({ path: join(root, name + ".json"), sha256 });
  return { dataset, manifest, manifestBytes, pin, root };
}
type Source = ReturnType<typeof locomoSource>;
const control = { id: "window-24k", system: "bm25-window", budget: { topK: 20, contextBytes: 24_000 } } as const;
const candidate = { id: "semantic-24k", system: "oh-semantic", budget: { topK: 20, contextBytes: 24_000 } } as const;
const nano = evolutionReaderProfileId("gpt5-nano-reader", "explicit-abstention-composition-v1"), mini = evolutionReaderProfileId("gpt5-mini-reader", "explicit-abstention-composition-v1");
function study(s: Source, overrides: Partial<EvolutionStudyV9> = {}): EvolutionStudyV9 {
  return { protocol: EVOLUTION_STUDY_V9_PROTOCOL, mode: "explicit-selection-descriptive", dataset: "locomo", datasetPin: s.pin("locomo", DATASETS.locomo.sha256),
    manifestPin: s.pin("locomo-exposure", sha256Hex(s.manifestBytes)), campaignPin: s.pin("campaign", h("locomo campaign")), retrievalSourceSha256: h("current source"),
    candidate, control, readers: [nano, mini], judge: EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, rubricSha256: EVOLUTION_LOCOMO_JUDGE_RUBRIC_SHA, repeats: 1, judgeRepeats: 1,
    selection: locomoParitySelection(s.manifest), maximumQuestionsPerShard: 260, shardPolicy: "one-cluster-per-shard", derivedRecordsPin: null, retrievalProvenance: null,
    readerDatePolicy: "final-session-date", candidatePresentation: "retrieval-order", repeatPolicy: "predeclared-full-matrix-indexed-repeats", ...overrides };
}
function authorized(s: Source, overrides: Partial<EvolutionStudyV9> = {}) {
  const value = study(s, overrides), studyBytes = bytes(value), scope = makeEvolutionStudyV9Scope(studyBytes, s.manifestBytes), scopeBytes = bytes(scope);
  return { study: value, studyBytes, scope, scopeBytes, authorization: validateEvolutionStudyV9Artifacts({ studyBytes, manifestBytes: s.manifestBytes, scopeBytes }) };
}
function question(category: string, unanswerable = false) {
  return { id: "synthetic", corpusId: "synthetic", category, question: "Do you remember what I got in Hawaii?", questionDate: "", answer: "A shell necklace",
    unanswerable, evidenceTurnIds: [], evidenceSessionIds: [] };
}
function raw(request: EvolutionRequest, answer: string) {
  return bytes({ model: request.model, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 }, providerMetadata: { gateway: { routing: { finalProvider: request.provider,
      originalModelId: request.model, canonicalSlug: request.model, resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1) } } } });
}

test("the leaderboard-parity judge renders the pinned CORRECT/WRONG prompt on gpt-4o-mini, grades only categories 1-4 and never enters V1 plans", async () => {
  const profile = await loadLocomoJudgeProfile();
  expect(profile.sha256).toBe(EVOLUTION_LOCOMO_JUDGE_RUBRIC_SHA); expect(profile.scoringRule).toBe("correct-wrong");
  expect(profile.templates["correct-wrong"]).toContain("label an answer to a question as 'CORRECT' or 'WRONG'");
  expect(profile.templates["correct-wrong"]).toContain("you should be generous with your grading");
  expect(profile.templates["correct-wrong"]).toContain("Do NOT include both CORRECT and WRONG in your response");
  const messages = buildLocomoJudgeMessages(question("locomo:2"), "I think it was a necklace made of shells", profile);
  expect(messages.map(m => m.role)).toEqual(["system", "user"]);
  expect(messages[1]!.content).toContain("Question: Do you remember what I got in Hawaii?\nGold answer: A shell necklace\nGenerated answer: I think it was a necklace made of shells");
  expect(messages[1]!.content).not.toContain("{question}");
  for (const category of EVOLUTION_LOCOMO_J_CATEGORIES) expect(() => buildLocomoJudgeMessages(question(category), "x", profile)).not.toThrow();
  expect(() => buildLocomoJudgeMessages(question("locomo:5", true), "x", profile)).toThrow("denominator");
  expect(() => buildLocomoJudgeMessages(question("locomo:1", true), "x", profile)).toThrow("denominator");
  expect(() => buildLocomoJudgeMessages(question("single-session-user"), "x", profile)).toThrow("denominator");
  expect(() => buildLocomoJudgeMessages(question("locomo:1"), "", profile)).toThrow("bounded prediction");
  const request = makeEvolutionRequest(EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, messages);
  expect(request.body).toMatchObject({ model: "openai/gpt-4o-mini", max_tokens: 128, temperature: 0, providerOptions: { gateway: { only: ["openai"], order: ["openai"] } } });
  expect(validateEvolutionRequest(request)).toEqual(request);
  expect(EVOLUTION_PROFILES[EVOLUTION_LOCOMO_JUDGE_PROFILE_ID].qualification).toBe("gateway-alias");
  for (const [text, decision] of [["The answer touches on the topic. CORRECT", 1], ["It names a different item.\nWRONG", 0], ["CORRECT", 1], ["WRONG.", 0], ["correct", null],
    ["CORRECT but also WRONG", null], ["The response is incorrect", null], ["", null], ["INCORRECT", null], ["It is CORRECTLY stated", null]] as const) {
    expect(parseLocomoJudgeDecision(text)).toBe(decision); expect(scoreEvolutionJudgeDecision(EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, text)).toBe(decision);
  }
  expect(parseLocomoJudgeDecision(null)).toBeNull(); expect(parseLocomoJudgeDecision("CORRECT".padEnd(5000, " "))).toBeNull();
  expect(evolutionJudgeScoringRule(EVOLUTION_LOCOMO_JUDGE_PROFILE_ID)).toBe("correct-wrong"); expect(evolutionJudgeScoringRule("gpt4o-gateway-judge")).toBe("strict-yes-no");
  expect(EVOLUTION_LOCOMO_CATEGORY_NAMES).toEqual({ "locomo:1": "multi-hop", "locomo:2": "temporal", "locomo:3": "open-domain", "locomo:4": "single-hop", "locomo:5": "adversarial" });
  // The V1 judge plan keeps its closed list: the parity profile is a V9-only treatment.
  const corpus = { id: "PRIVATE-corpus", groupId: "PRIVATE-family", turns: [{ id: "D1:1", sessionId: "session-1", date: "2026-01-01", speaker: "Melanie", text: "I got a shell necklace in Hawaii." }] };
  const dataset: Dataset = { corpora: [corpus], questions: [{ ...question("locomo:4"), id: "PRIVATE-q", corpusId: corpus.id }] };
  const { plan } = await makeEvolutionContextPlan({ dataset: projectEvolutionRunnerInput(dataset), variants: [control], manifestSha256: h("m"), retrievalSourceSha256: h("s") });
  const readerPlan = makeEvolutionReaderPlan(plan, ["gpt5-nano-reader"]), r = readerPlan.requests[0]!, response = parseEvolutionResponse(raw(r, "a shell necklace"), r);
  const nativeRubric = await loadJudgeProfile();
  expect(() => makeEvolutionJudgePlan({ contextPlan: plan, readerPlan, responses: new Map([[r.requestSha256, response]]), dataset, profile: EVOLUTION_LOCOMO_JUDGE_PROFILE_ID as any,
    rubric: nativeRubric, readerOutputSha256: h("o") })).toThrow("V1 judge plans");
  expect(() => parseEvolutionRunConfig({ protocol: "oh.memory.evolution-run.v4", dataset: "locomo", datasetPin: { path: "/x/d.json", sha256: DATASETS.locomo.sha256 },
    manifestPin: { path: "/x/m.json", sha256: h("m") }, campaignPin: { path: "/x/c.json", sha256: h("c") }, limit: 10, seed: 17, variants: [control], readers: ["gpt5-nano-reader"],
    judge: EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, directory: "/x/run", storeDirectory: "/x/store", concurrency: 24 })).toThrow();
});

test("the gpt-4o-mini reader is a closed single-call profile that composes with every answer contract", () => {
  const messages = [{ role: "system" as const, content: "Answer from memory." }, { role: "user" as const, content: JSON.stringify({ question: "q", questionDate: "", memory: "m" }) }];
  const request = makeEvolutionRequest("gpt4o-mini-reader", messages);
  expect(request.body).toMatchObject({ model: "openai/gpt-4o-mini", max_tokens: 2048, temperature: 0 }); expect("reasoning" in request.body).toBe(false);
  expect(EVOLUTION_PROFILES["gpt4o-mini-reader"].prices).toEqual([{ fromInputTokens: 0, input: 150, cachedInput: 75, cacheWrite: 150, output: 600 }]);
  const eac = evolutionReaderProfileId("gpt4o-mini-reader", "explicit-abstention-composition-v1");
  expect(eac).toBe("gpt4o-mini-explicit-abstention-composition-v1-reader"); expect(evolutionReaderContract(eac)).toBe("explicit-abstention-composition-v1");
  expect(EVOLUTION_PROFILES[eac].model).toBe("openai/gpt-4o-mini");
});

test("the reader date policy is a declared, digested choice that moves only questionDate", () => {
  const s = locomoSource();
  expect(EVOLUTION_READER_DATE_POLICIES).toEqual(["question-date", "final-session-date"]);
  expect(() => parseEvolutionReaderDatePolicy("today")).toThrow("unknown policy");
  expect(evolutionReaderDatePolicySha256("question-date")).not.toBe(evolutionReaderDatePolicySha256("final-session-date"));
  expect(evolutionReaderDatePolicySha256("final-session-date")).toBe(h({ protocol: "oh.memory.evolution-reader-date-policy.v1", policy: "final-session-date" }));
  expect([...evolutionFinalSessionDates(s.dataset).values()].every(d => d === "1:30 pm on 22 May, 2023")).toBe(true);
  const plain = projectEvolutionRunnerInput(s.dataset), dated = projectEvolutionRunnerInputV9(s.dataset, "final-session-date");
  expect(projectEvolutionRunnerInputV9(s.dataset, "question-date")).toEqual(plain);
  expect(dated.corpora).toEqual(plain.corpora); expect(dated.questions.map(q => ({ ...q, questionDate: "" }))).toEqual(plain.questions);
  expect(dated.questions.every(q => q.questionDate === "1:30 pm on 22 May, 2023")).toBe(true);
  expect(JSON.stringify(dated)).not.toContain("PRIVATE_GOLD");
  const undated = { ...s.dataset, corpora: s.dataset.corpora.map(c => ({ ...c, turns: c.turns.map(t => ({ ...t, date: "" })) })) };
  expect(() => projectEvolutionRunnerInputV9(undated, "final-session-date")).not.toThrow();
  expect(projectEvolutionRunnerInputV9(undated, "final-session-date").questions[0]!.questionDate).toBe("");
});

test("the LoCoMo exposure manifest declares every conversation and the parity selection orders categories 1-4 by conversation and question", async () => {
  const s = locomoSource(), development = new Set(selectSplit(s.dataset, "dev", 17).corpora.map(c => c.groupId));
  expect(development.size).toBe(2);
  for (const g of s.manifest.groups) {
    expect(g.partition).toBe(development.has(g.groupId) ? "development" : "closed");
    expect(g.exposure).toBe(development.has(g.groupId) ? "development" : "evaluated");
    expect(g.evidence).toContain(development.has(g.groupId) ? "benchmarks/results/locomo-*dev*.json" : "locomo-heldout-v2.json");
  }
  expect(s.manifest.groups.some(g => g.exposure === "unseen" || g.exposure === "unknown")).toBe(false);
  const selection = locomoParitySelection(s.manifest);
  expect(selection).toHaveLength(60); expect(new Set(selection).size).toBe(60);
  const byRunner = new Map(s.manifest.questions.map(q => [q.runnerId, q]));
  expect(selection.map(id => byRunner.get(id)!.category).every(c => c !== "locomo:5")).toBe(true);
  expect(selection.slice(0, 6).map(id => byRunner.get(id)!.id)).toEqual(["conv-0:0", "conv-0:1", "conv-0:2", "conv-0:3", "conv-0:5", "conv-0:6"]);
  const summary = summarizeLocomoExposure(s.manifest), encoded = JSON.stringify(summary);
  expect(summary.totals).toEqual({ questions: 70, parityQuestions: 60, byCategory: { "locomo:1": 20, "locomo:2": 10, "locomo:3": 10, "locomo:4": 20, "locomo:5": 10 }, byExposure: { development: 2, evaluated: 8 } });
  expect(summary.conversations).toHaveLength(10); expect(encoded).not.toContain("PRIVATE_GOLD"); expect(encoded).not.toContain("Synthetic question");
  expect(() => makeLocomoExposureManifest({ ...s.dataset, questions: s.dataset.questions.map(q => ({ ...q, category: "multi-session" })) })).toThrow("categories");
  expect(parseLocomoExposureArgs(["--dataset", "/x/locomo.json", "--dataset-sha256", DATASETS.locomo.sha256, "--output", "/x/exposure.json", "--selection", "/x/selection.json"]).output).toBe("/x/exposure.json");
  expect(() => parseLocomoExposureArgs(["--dataset", "/x/locomo.json", "--dataset-sha256", DATASETS.locomo.sha256, "--output", "/x/exposure.json"])).toThrow("missing");
  expect(() => parseLocomoExposureArgs(["--dataset", "relative.json", "--dataset-sha256", DATASETS.locomo.sha256, "--output", "/x/e.json", "--selection", "/x/s.json"])).toThrow();
  const root = await mkdtemp(join(await realpath(tmpdir()), "oh-locomo-exposure-"));
  try {
    const fake = join(root, "locomo.json"); await writeFile(fake, "[]");
    await expect(writeLocomoExposure({ path: fake, sha256: sha256Hex("[]") }, join(root, "e.json"), join(root, "s.json"))).rejects.toThrow("official LoCoMo pin");
    await expect(writeLocomoExposure({ path: fake, sha256: DATASETS.locomo.sha256 }, join(root, "e.json"), join(root, "s.json"))).rejects.toThrow("pinned dataset changed");
    expect(LOCOMO_SELECTION_PROTOCOL).toBe("oh.memory.evolution-selection.v1");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a LoCoMo V9 study shards one conversation per shard over categories 1-4, requires the parity judge and reports J beside the F1 diagnostic", async () => {
  const s = locomoSource(), f = authorized(s);
  expect(f.scope.shards).toHaveLength(10); expect(f.scope.shards.every(x => x.questionIds.length === 6 && x.clusterIds.length === 1)).toBe(true);
  expect(f.scope.coverage).toMatchObject({ releaseQuestions: 70, selectedQuestions: 60, partiallySelectedClusters: 10, connectedDeclaredClusters: 10 });
  expect(f.scope.strata).toEqual([{ partition: "closed", exposure: "evaluated", questions: 48, groups: 8 }, { partition: "development", exposure: "development", questions: 12, groups: 2 }]);
  expect(f.scope.questions.every(q => q.category !== "locomo:5")).toBe(true);
  expect(() => parseEvolutionStudyV9({ ...f.study, judge: "gpt4o-gateway-native-rubric-16-judge-v1", rubricSha256: "00d319ba0a194a69871576d8c677c1557d7706f69b599c9b7beee32441d58cfc" })).toThrow("require each other");
  expect(() => parseEvolutionStudyV9({ ...f.study, judge: "gpt4o-gateway-native-rubric-16-judge-v1" })).toThrow();
  const adversarial = s.manifest.questions.find(q => q.category === "locomo:5")!.runnerId;
  expect(() => makeEvolutionStudyV9Scope(bytes({ ...f.study, selection: [...f.study.selection, adversarial] }), s.manifestBytes)).toThrow("categories 1-4");
  const config = { protocol: EVOLUTION_RUN_V9_PROTOCOL, dataset: "locomo", datasetPin: f.study.datasetPin, manifestPin: f.study.manifestPin, campaignPin: f.study.campaignPin,
    studyPin: s.pin("study", sha256Hex(f.studyBytes)), scopePin: s.pin("scope", sha256Hex(f.scopeBytes)), shardId: "shard-001", limit: 6, variants: [control, candidate], readers: [nano, mini],
    judge: EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, repeats: 1, judgeRepeats: 1, readerDatePolicy: "final-session-date", derivedRecordsPin: null,
    directory: join(s.root, "runs/shard-001"), storeDirectory: join(s.root, "store"), concurrency: 32, semanticCacheDirectory: join(s.root, "cache") };
  expect(parseEvolutionRunConfig(config).protocol).toBe(EVOLUTION_RUN_V9_PROTOCOL);
  // Offline shard: synthetic whole-turn contexts, reader answers, parity judge verdicts and the report.
  const shardId = "shard-003", dataset = selectEvolutionStudyV9Shard(s.dataset, s.manifest, f.authorization, shardId), projected = projectEvolutionRunnerInputV9(dataset, "final-session-date");
  expect(dataset.questions).toHaveLength(6); expect(dataset.corpora).toHaveLength(1); expect(projected.questions.every(q => q.questionDate === "1:30 pm on 22 May, 2023")).toBe(true);
  const corpora = new Map(projected.corpora.map(c => [c.id, c]));
  const cases = projected.questions.flatMap(q => [control, candidate].map(v => {
    const src = { ...corpora.get(q.corpusId)!, groupId: q.corpusId }, full = createEvolutionFullHistorySource(src), n = v.system === "oh-semantic" ? 0 : 1;
    const { preparedSha256: _old, ...identity } = full.identity;
    const preparedSha256 = h({ ...identity, semanticProfileSha256: v.system === "oh-semantic" ? h(OH_EMBEDDING_PROFILE_V1) : null });
    const context = renderTurn(src.turns[n]!), payload = { protocol: "oh.evolution-retrieval.v1" as const, preparedSha256, variantSha256: h(v), querySha256: sha256Hex(q.question),
      context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context), turnIds: [src.turns[n]!.id], sessionIds: [src.turns[n]!.sessionId],
      sources: [full.result.sources[n]!], omittedForBudget: 0, facets: [], coveredFacets: [], coverageKind: null };
    return { questionId: q.id, variantId: v.id, result: { ...payload, resultSha256: h(payload) } };
  }));
  const basePayload = { protocol: "oh.memory.evolution-context-plan.v1" as const, manifestSha256: f.study.manifestPin.sha256, retrievalSourceSha256: f.study.retrievalSourceSha256,
    inputSha256: h(projected), variants: [control, candidate], questions: projected.questions, cases };
  const basePlan: EvolutionContextPlan = { ...basePayload, planSha256: h(basePayload) };
  const plan = makeEvolutionContextPlanV9({ dataset: projected, basePlan, binding: evolutionContextBindingV9(f.authorization, shardId) });
  expect(plan.readerDatePolicy).toBe("final-session-date");
  const readerPlan = makeEvolutionReaderPlanV2(plan, [nano, mini], 1), captures = new Map<string, Uint8Array>(), responses = new Map<string, EvolutionResponse>();
  expect(readerPlan.requests.every(r => r.body.messages[1]!.content.includes('"questionDate":"1:30 pm on 22 May, 2023"'))).toBe(true);
  const rows: { requestSha256: string; repeat: number; response: EvolutionResponse }[] = [];
  const variantOf = new Map(readerPlan.cases.map(x => [x.requestSha256, x.variantId]));
  for (const job of evolutionReaderJobsV2(readerPlan)) {
    // Candidate answers state the gold item; control answers hedge with the native abstention phrase, which the F1 diagnostic cannot see for category 1-4.
    const answer = variantOf.get(job.request.requestSha256) === candidate.id ? "The supplied conversation shows PRIVATE_PREDICTION_SENTINEL" : "The supplied conversation does not contain enough information";
    const body = raw(job.request, answer), response = parseEvolutionResponse(body, job.request);
    captures.set(job.key, body); responses.set(job.key, response); rows.push({ requestSha256: job.request.requestSha256, repeat: 0, response });
  }
  const readerOutputBytes = bytes({ protocol: EVOLUTION_PHASE_V2_PROTOCOL, phase: "reader", planSha256: readerPlan.planSha256, complete: true, responses: rows, failures: [] });
  const rubric = await loadEvolutionJudgeRubricV9(EVOLUTION_LOCOMO_JUDGE_PROFILE_ID);
  expect(rubric.kind).toBe("locomo-parity");
  const judgePlan = makeEvolutionJudgePlanV9({ contextPlan: plan, readerPlan, responses, dataset, profile: EVOLUTION_LOCOMO_JUDGE_PROFILE_ID, rubric, judgeRepeats: 1, readerOutputSha256: sha256Hex(readerOutputBytes) });
  expect(judgePlan.scoringRule).toBe("correct-wrong"); expect(judgePlan.requests.every(r => r.model === "openai/gpt-4o-mini" && r.body.messages.length === 2)).toBe(true);
  expect(judgePlan.requests.some(r => r.body.messages[1]!.content.includes("Gold answer: PRIVATE_GOLD_SENTINEL"))).toBe(true);
  const judgeRows: { requestSha256: string; repeat: number; response: EvolutionResponse }[] = [];
  for (const job of evolutionJudgeJobsV9(judgePlan)) {
    const verdict = job.request.body.messages[1]!.content.includes("PRIVATE_PREDICTION_SENTINEL") ? "It touches on the same item. CORRECT" : "It does not answer. WRONG";
    const body = raw(job.request, verdict), response = parseEvolutionResponse(body, job.request);
    captures.set(job.key, body); judgeRows.push({ requestSha256: job.request.requestSha256, repeat: 0, response });
  }
  const judgeOutputBytes = bytes({ protocol: EVOLUTION_PHASE_V2_PROTOCOL, phase: "judge", planSha256: judgePlan.planSha256, complete: true, responses: judgeRows, failures: [] });
  const report = await buildEvolutionReportV9({ dataset, manifestBytes: s.manifestBytes, manifestSha256: f.study.manifestPin.sha256, contextPlan: plan, readerPlan, judgePlan, readerOutputBytes,
    judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes), loadRawResponse: async (r, _response, repeat) => captures.get(evolutionJobKey(r.requestSha256, repeat))!,
    study: { studyBytes: f.studyBytes, scopeBytes: f.scopeBytes, shardId, campaignSha256: h("campaign") } });
  expect(report.scoring.judgeProfile).toBe(EVOLUTION_LOCOMO_JUDGE_PROFILE_ID); expect(report.scoring.judgeRule).toBe("correct-wrong");
  expect(report.scoring.judgeQualification).toContain("CORRECT-WRONG"); expect(report.scoring.officialLocomoF1!.qualification).toContain("underestimates abstention");
  expect(report.scoring.evidenceUnit).toBe("turn"); expect(report.dataset.categoryNames).toEqual(EVOLUTION_LOCOMO_CATEGORY_NAMES);
  expect(report.dataset.strata).toEqual([{ partition: "closed", exposure: "evaluated", questions: 6 }]);
  for (const arm of report.arms) {
    expect(arm.metrics.find(m => m.metric === "judge-mean")!.overall.mean).toBe(arm.variantId === candidate.id ? 1 : 0);
    expect(arm.metrics.find(m => m.metric === "locomo-f1")!.overall.mean).toBe(0);
    expect(arm.metrics.find(m => m.metric === "judge-mean")!.byCategory.map(c => c.id)).toEqual(["locomo:1", "locomo:2", "locomo:3", "locomo:4"]);
  }
  expect(report.comparisons.filter(c => c.kind === "retrieval").every(c => c.metrics.find(m => m.metric === "judge-mean")!.paired.wins === 6)).toBe(true);
  expect(report.comparisons.find(c => c.kind === "reader")).toMatchObject({ left: { reader: mini }, right: { reader: nano } });
  const encoded = JSON.stringify(report);
  for (const secret of ["PRIVATE_GOLD_SENTINEL", "PRIVATE_PREDICTION_SENTINEL", "Synthetic question", "pottery"]) expect(encoded).not.toContain(secret);
});
