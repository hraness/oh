import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { answerMessages, ANSWER_INSTRUCTION } from "../scripts/benchmarks/model";
import { EVOLUTION_ANSWER_CONTRACT_IDS, EVOLUTION_READER_CONTRACT_IDS, EVOLUTION_READER_CONTRACTS, evolutionAnswerMessages } from "../scripts/benchmarks/evolution-reader-contracts";
import { EVOLUTION_BASE_READER_IDS, EVOLUTION_PROFILES, evolutionReaderContract, evolutionReaderProfileId, makeEvolutionRequest, makeEvolutionProfileWindowRequest,
  parseEvolutionResponse, supportsEvolutionProfileWindow, validateEvolutionRequest, type EvolutionProfileId, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { makeEvolutionExperimentContextPlan, makeEvolutionReaderPlan, validateEvolutionReaderPlan } from "../scripts/benchmarks/evolution-plan";
import { DATASETS } from "../scripts/benchmarks/datasets";
import { parseEvolutionRunConfig } from "../scripts/benchmarks/evolution";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import golden from "./fixtures/evolution-reader-contracts-legacy-golden.json";
const fetchBefore = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw new Error("network forbidden"); }, { preconnect() { throw new Error("network forbidden"); } }); });
afterAll(() => { globalThis.fetch = fetchBefore; });
const question = { question: "What is the current color?", questionDate: "2026-01-03" }, context = "[source synthetic]\nThe current color is blue.";
const messages = answerMessages(question, context);
function response(r: EvolutionRequest) { return new TextEncoder().encode(JSON.stringify({ model: r.model,
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "blue" } }],
  usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 }, ...(r.endpoint.includes("ai-gateway")
    ? { providerMetadata: { gateway: { routing: { finalProvider: r.provider, originalModelId: r.model, canonicalSlug: r.model } } } } : {}) })); }
const input = { protocol: "oh.memory.evolution-runner-input.v1" as const,
  corpora: [{ id: "synthetic-corpus", turns: [{ id: "t1", sessionId: "s1", sessionIndex: 0, date: "2026-01-01", speaker: "user", text: "The color is blue." }] }],
  questions: [{ id: "synthetic-question", corpusId: "synthetic-corpus", ...question }] };
const variants = [{ id: "window", system: "bm25-window" as const, budget: { topK: 100, contextBytes: 96000 } }, { id: "full", system: "full-history" as const }];
async function fixture() { return (await makeEvolutionExperimentContextPlan({ dataset: input, variants, manifestSha256: "a".repeat(64), retrievalSourceSha256: "b".repeat(64) })).plan; }
function seal(value: any) { const { planSha256: _, ...payload } = value; value.planSha256 = canonicalSha256(payload); return value; }

describe("composable isolated reader answer contracts", () => {
  test("preserves exact legacy profile, message, V1/V2 request and parsed-response bytes", () => {
    expect(String(canonicalSha256(messages))).toBe(golden.messagesSha256);
    expect(evolutionAnswerMessages(question, context)).toEqual(messages);
    for (const row of golden.rows) {
      const id = row.profileId as EvolutionProfileId;
      const prompt = id.endsWith("-reader") ? messages : id.includes("native") || id === "gpt4o-official-snapshot-judge"
        ? [{ role: "user" as const, content: "Synthetic judge instruction." }]
        : [{ role: "system" as const, content: "Synthetic judge system." }, { role: "user" as const, content: "Synthetic judge instruction." }];
      const request = makeEvolutionRequest(id, prompt);
      expect(String(canonicalSha256(EVOLUTION_PROFILES[id]))).toBe(row.profileSha256);
      expect(request.requestSha256).toBe(row.requestSha256);
      expect(String(sha256Hex(JSON.stringify(request)))).toBe(row.serializedRequestSha256);
      expect(String(canonicalSha256(parseEvolutionResponse(response(request), request)))).toBe(row.parsedSha256);
      expect(EVOLUTION_PROFILES[id].readerContract).toBeUndefined();
      if ("windowRequestSha256" in row) {
        if (typeof row.windowRequestSha256 !== "string") throw new Error("Golden window request digest is missing.");
        const window = makeEvolutionProfileWindowRequest(id, messages);
        expect(window.requestSha256).toBe(row.windowRequestSha256);
        expect(String(sha256Hex(JSON.stringify(window)))).toBe(row.windowSerializedSha256!);
        expect(String(canonicalSha256(parseEvolutionResponse(response(window), window)))).toBe(row.windowParsedSha256!);
      }
    }
  });
  test("composes two independent prompt changes without model, question, memory or gold coupling", () => {
    const legacy = EVOLUTION_READER_CONTRACTS["legacy-v1"].instruction;
    const abstention = EVOLUTION_READER_CONTRACTS["explicit-abstention-v1"].instruction;
    const composition = EVOLUTION_READER_CONTRACTS["composition-v1"].instruction;
    const combined = EVOLUTION_READER_CONTRACTS["explicit-abstention-composition-v1"].instruction;
    expect(legacy).toBe(ANSWER_INSTRUCTION);
    expect(composition.startsWith(legacy + " ")).toBeTrue();
    expect(combined.slice(abstention.length)).toBe(composition.slice(legacy.length));
    expect(abstention).not.toContain("reply exactly None");
    expect(composition).toContain("reply exactly None");
    expect(combined).not.toContain("reply exactly None");
    expect(abstention).toContain("does not contain enough information");
    const guarded = { ...question };
    for (const key of ["answer", "evidenceTurnIds", "evidenceSessionIds", "unanswerable", "category", "gold"]) Object.defineProperty(guarded, key, { enumerable: true, get() { throw Error("gold accessed"); } });
    // The selection contract shares the catalog but never answers over a memory field.
    expect(EVOLUTION_ANSWER_CONTRACT_IDS).toEqual(EVOLUTION_READER_CONTRACT_IDS.filter(id => id !== "evidence-selection-v1"));
    expect(() => evolutionAnswerMessages(guarded, context, "evidence-selection-v1")).toThrow("Evolution reader contract: evidence-selection-v1 is a selection contract, not an answer contract.");
    for (const id of EVOLUTION_ANSWER_CONTRACT_IDS) {
      const result = evolutionAnswerMessages(guarded, context, id);
      expect(result[1]).toEqual(messages[1]);
      expect(result[0]!.content).toBe(EVOLUTION_READER_CONTRACTS[id].instruction);
      expect(EVOLUTION_READER_CONTRACTS[id].instructionSha256).toBe(canonicalSha256(result[0]!.content));
      expect(Object.isFrozen(EVOLUTION_READER_CONTRACTS[id])).toBeTrue();
      for (const forbidden of ["LongMemEval", "LoCoMo", "BEAM", "Correct Answer", "judge", "rubric", "GOLD_ONLY"]) expect(result[0]!.content).not.toContain(forbidden);
    }
    expect(() => evolutionAnswerMessages(question, context, "foreign" as any)).toThrow("unknown contract");
    expect(() => evolutionReaderProfileId("gpt4o-gateway-judge" as any)).toThrow("unknown base");
    expect(() => evolutionReaderContract("gpt4o-gateway-judge")).toThrow("reader profile");
  });
  test("calibration-only, selected-answer and evidence-selection compose from the frozen parts without the legacy dataset-specific clause", () => {
    const eac = EVOLUTION_READER_CONTRACTS["explicit-abstention-composition-v1"].instruction;
    const calibrated = EVOLUTION_READER_CONTRACTS["calibrated-composition-v1"].instruction;
    const calibrationOnly = EVOLUTION_READER_CONTRACTS["calibration-only-v1"].instruction;
    const selected = EVOLUTION_READER_CONTRACTS["selected-answer-v1"].instruction;
    const selection = EVOLUTION_READER_CONTRACTS["evidence-selection-v1"].instruction;
    expect(EVOLUTION_READER_CONTRACT_IDS).toHaveLength(9);
    expect(calibrationOnly.startsWith(eac + " ")).toBeTrue();
    const calibration = calibrationOnly.slice(eac.length + 1);
    expect(calibrated.endsWith(" " + calibration)).toBeTrue();
    expect(calibration).toContain("Give exact values");
    expect(calibrationOnly).not.toContain("first order"); expect(selected).not.toContain("first order"); expect(calibrated).toContain("first order");
    expect(calibrationOnly).toContain("does not contain enough information"); expect(calibrationOnly).not.toContain("reply exactly None");
    expect(selected.startsWith(calibrationOnly + " ")).toBeTrue();
    expect(selected.slice(calibrationOnly.length + 1)).toContain("selected for this question");
    expect(selection).toContain('{"ids":[]}'); expect(selection).toContain("at most 32"); expect(selection).not.toContain("memory");
    expect(new Set(EVOLUTION_READER_CONTRACT_IDS.map(id => EVOLUTION_READER_CONTRACTS[id].instructionSha256)).size).toBe(EVOLUTION_READER_CONTRACT_IDS.length);
    expect(evolutionReaderProfileId("gpt5-mini-reader", "evidence-selection-v1")).toBe("gpt5-mini-evidence-selection-v1-reader");
    expect(evolutionReaderContract("gpt5-nano-evidence-selection-v1-reader")).toBe("evidence-selection-v1");
  });
  test("every closed model/effort choice retains prices, routing, cap and full-history eligibility", () => {
    const ids = new Set<string>();
    for (const base of EVOLUTION_BASE_READER_IDS) for (const contract of EVOLUTION_READER_CONTRACT_IDS) {
      const id = evolutionReaderProfileId(base, contract), selected = EVOLUTION_PROFILES[id]; ids.add(id);
      expect(evolutionReaderContract(id)).toBe(contract);
      const { id: _id, readerContract, ...body } = selected, { id: _baseId, ...original } = EVOLUTION_PROFILES[base];
      expect(body).toEqual(original);
      if (contract === "evidence-selection-v1") {
        // Selection profiles keep the base pricing and routing but never build an answer request.
        expect(readerContract).toEqual({ baseReader: base, id: contract, instructionSha256: EVOLUTION_READER_CONTRACTS[contract].instructionSha256 });
        expect(() => evolutionAnswerMessages(question, context, contract)).toThrow("selection contract, not an answer contract");
        continue;
      }
      const msg = evolutionAnswerMessages(question, context, contract), request = makeEvolutionRequest(id, msg);
      expect(validateEvolutionRequest(request)).toEqual(request);
      expect(parseEvolutionResponse(response(request), request).status).toBe("completed");
      expect(supportsEvolutionProfileWindow(id)).toBe(supportsEvolutionProfileWindow(base));
      if (contract !== "legacy-v1") {
        expect(readerContract).toEqual({ baseReader: base, id: contract, instructionSha256: EVOLUTION_READER_CONTRACTS[contract].instructionSha256 });
        expect(request.requestSha256).not.toBe(makeEvolutionRequest(base, messages).requestSha256);
      }
      if (supportsEvolutionProfileWindow(base)) {
        const window = makeEvolutionProfileWindowRequest(id, msg), old = makeEvolutionProfileWindowRequest(base, messages);
        expect(window.reservationMicros).toBe(old.reservationMicros);
        expect(window.inputAccounting.profileWindowInputTokens).toBe(400000);
        expect(window.inputAccounting.tokenizerFit).toBe("unknown");
        expect(validateEvolutionRequest(window)).toEqual(window);
      } else expect(() => makeEvolutionProfileWindowRequest(id, msg)).toThrow("profile-window");
    }
    expect(ids.size).toBe(EVOLUTION_BASE_READER_IDS.length * EVOLUTION_READER_CONTRACT_IDS.length);
    // Four GPT-4o judges plus the LoCoMo leaderboard-parity judge on gpt-4o-mini.
    expect(Object.keys(EVOLUTION_PROFILES)).toHaveLength(EVOLUTION_BASE_READER_IDS.length * EVOLUTION_READER_CONTRACT_IDS.length + 5);
  });
  test("renders complete matched factorial arms and rejects a resealed prompt substitution", async () => {
    // The answer factorial holds the eight answer contracts; evidence-selection-v1 is the stage-1 selector contract of the two-stage lane.
    const answerContracts = EVOLUTION_ANSWER_CONTRACT_IDS; expect(answerContracts).toHaveLength(8);
    const ctx = await fixture(), profiles = answerContracts.map(c => evolutionReaderProfileId("gpt5-nano-reader", c));
    const plan = makeEvolutionReaderPlan(ctx, profiles);
    expect(plan.cases).toHaveLength(answerContracts.length * 2); expect(plan.requests).toHaveLength(answerContracts.length * 2);
    expect(validateEvolutionReaderPlan(plan, ctx)).toEqual(plan);
    for (const c of plan.cases) {
      const request = plan.requests.find(r => r.requestSha256 === c.requestSha256)!;
      expect(c.contextSha256).toBe(ctx.cases.find(r => r.variantId === c.variantId)!.result.contextSha256);
      expect(request.body.messages[0]!.content).toBe(EVOLUTION_READER_CONTRACTS[evolutionReaderContract(c.reader)].instruction);
      expect(request.protocol).toBe(c.variantId === "full" ? "oh.memory.evolution-model.v2" : "oh.memory.evolution-model.v1");
    }
    const bad: any = structuredClone(plan), previous = bad.requests[0];
    const replaced = makeEvolutionRequest(previous.profileId, [{ role: "system", content: "Unapproved prompt substitution." }, previous.body.messages[1]]);
    bad.requests[0] = replaced;
    for (const c of bad.cases) if (c.requestSha256 === previous.requestSha256) c.requestSha256 = replaced.requestSha256;
    seal(bad);
    expect(() => validateEvolutionReaderPlan(bad, ctx)).toThrow("complete prepared context/profile product");
    const config = { protocol: "oh.memory.evolution-run.v3", dataset: "longmemeval-s", datasetPin: { path: "/fixture/data", sha256: DATASETS["longmemeval-s"].sha256 },
      manifestPin: { path: "/fixture/manifest", sha256: "a".repeat(64) }, campaignPin: { path: "/fixture/campaign", sha256: "b".repeat(64) },
      limit: 1, seed: 17, variants, readers: profiles, judge: "gpt4o-gateway-native-rubric-16-judge-v1", directory: "/fixture/output", storeDirectory: "/fixture/store", concurrency: 1 };
    expect(parseEvolutionRunConfig(config).readers).toEqual(profiles);
    expect(() => parseEvolutionRunConfig({ ...config, readers: [evolutionReaderProfileId("qwen37-flash-reader", "explicit-abstention-v1")] })).toThrow("nano and mini");
    expect(() => parseEvolutionRunConfig({ ...config, readers: [evolutionReaderProfileId("gpt5-nano-reader", "evidence-selection-v1")] })).toThrow("selection contracts are not answer readers");
    expect(() => makeEvolutionReaderPlan(ctx, [evolutionReaderProfileId("gpt5-nano-reader", "evidence-selection-v1")])).toThrow("selection contract, not an answer contract");
  });
  test("store keeps each contract's first response and exact replay independent", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "oh-contract-synthetic-")));
    const campaign = { protocol: "oh.memory.evolution-campaign.v1" as const, campaignId: "contract-fixture", storeDirectory: root,
      approval: "Synthetic isolated test", additionalBudgetMicros: 1000000, maximumCalls: 10, historicalExposureMicros: 0,
      historicalLedgers: [{ path: "/fixture/ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/fixture/auth", sha256: "b".repeat(64) } };
    const requests = EVOLUTION_ANSWER_CONTRACT_IDS.map(c => makeEvolutionProfileWindowRequest(evolutionReaderProfileId("gpt5-nano-reader", c), evolutionAnswerMessages(question, context, c)));
    try {
      const store = await openEvolutionStore({ directory: root, campaign });
      try {
        for (const request of requests) { expect(store.lookup(request).kind).toBe("miss"); store.admit(request); const body = response(request);
          store.capture(request, { body, httpStatus: 200, complete: true, receivedBytes: body.length, error: null }); store.finalize(request); }
        expect(store.summary()).toMatchObject({ calls: requests.length, unresolvedMicros: 0 });
      } finally { await store.close(); }
      const reopened = await openEvolutionStore({ directory: root, campaign });
      try { for (const request of requests) expect(reopened.lookup(request).kind).toBe("hit"); expect(reopened.summary().calls).toBe(requests.length); }
      finally { await reopened.close(); }
    } finally { await rm(root, { recursive: true }); }
  });
});
