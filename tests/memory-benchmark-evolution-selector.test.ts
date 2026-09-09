import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { prepareEvolutionCorpus, type EvolutionRetrievalResult } from "../scripts/benchmarks/evolution-retrieval";
import { OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT } from "../scripts/benchmarks/evolution-spans-prototype";
import { makeEvolutionRequest, parseEvolutionResponse, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { renderTurn } from "../scripts/benchmarks/retrieval";
import { OH_SELECTOR_POLICY, OH_SELECTOR_INSTRUCTION, parseOhSelectorIds, prepareOhSourceSelector, type OhSelectorPlan } from "../scripts/benchmarks/evolution-selector";
const previousFetch = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw Error("network disabled"); }, { preconnect() { throw Error("network disabled"); } }); });
afterAll(() => { globalThis.fetch = previousFetch; });
const question = { question: "What is the lamp color?", questionDate: "2026-01-03" };
function corpus(): Corpus { return { id: "source-only-fixture", groupId: "source-only-fixture", turns: [
  { id: "turn-a", sessionId: "session", sessionIndex: 0, date: "2026-01-01", speaker: "user", text: "The lamp color is blue. Café ☀️\n" },
  { id: "turn-b", sessionId: "session", sessionIndex: 0, date: "2026-01-01", speaker: "assistant", text: "I recorded the lamp color." },
  { id: "turn-c", sessionId: "session", sessionIndex: 1, date: "2026-01-02", speaker: "user", text: "The lamp color changed to green; keep the old shade for the spare lamp." },
] }; }
async function poolFor(source: Corpus, q = question.question) {
  const prepared = await prepareEvolutionCorpus(source);
  try { return await prepared.retrieve(q, OH_SPAN_PROTOTYPE_FOCUSED_POOL_VARIANT); } finally { await prepared.close(); }
}
function rawResponse(request: EvolutionRequest, answer: string, finish = "stop") {
  return new TextEncoder().encode(JSON.stringify({ model: request.model,
    choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
    providerMetadata: { gateway: { routing: { finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model } } } }));
}
function reseal<T extends object>(value: T, field: string): T { const copy: any = structuredClone(value); delete copy[field]; return { ...copy, [field]: canonicalSha256(copy) }; }
const idsFor = (plan: OhSelectorPlan, turnIds: string[]) => turnIds.map(id => plan.sources.find(s => s.turnId === id)!.alias);
function proof(plan: OhSelectorPlan, ids: string[]) { const raw = rawResponse(plan.request, JSON.stringify({ ids })); return { raw, response: parseEvolutionResponse(raw, plan.request) }; }

describe("source-only Oh ID selector prototype", () => {
  test("prepares once from the native complete pool; source and question gold getters never enter request", async () => {
    const source: any = corpus(), guarded: any = { ...question };
    for (const object of [source, ...source.turns, guarded]) for (const field of ["answer", "gold", "evidenceSessionIds", "unanswerable", "category", "has_answer"]) {
      Object.defineProperty(object, field, { enumerable: true, get() { throw Error("gold must not be accessed"); } });
    }
    const pool = await poolFor(source), selector = prepareOhSourceSelector(source), plan = selector.makePlan(guarded, pool, pool.resultSha256);
    expect(selector.makePlan(guarded, pool, pool.resultSha256)).toEqual(plan);
    expect(selector.validatePlan(guarded, pool, pool.resultSha256, plan)).toEqual(plan);
    expect(plan.role).toBe("source-selection"); expect(plan.maximumNewCalls).toBe(1);
    expect(plan.maximumReservationMicros).toBe(plan.request.reservationMicros);
    expect(plan.request.profileId).toBe("gpt5-nano-reader"); expect(plan.request.body.messages[0]!.content).toBe(OH_SELECTOR_INSTRUCTION);
    const user = JSON.parse(plan.request.body.messages[1]!.content);
    expect(user.question).toBe(question.question); expect(user.questionDate).toBe(question.questionDate);
    expect(user.sources).toHaveLength(pool.turnIds.length);
    for (const item of plan.sources) {
      const actual = source.turns.find((t: any) => t.id === item.turnId), supplied = user.sources.find((s: any) => s.id === item.alias);
      expect(item.alias).toMatch(/^s\d{3}$/); expect(supplied.text).toBe(actual.text); expect(supplied.date).toBe(actual.date);
      expect(supplied.speaker).toBe(actual.speaker); expect(item.renderedBytes).toBe(Buffer.byteLength(renderTurn(actual)));
      expect(item.textSha256).toBe(sha256Hex(actual.text)); expect(supplied.turnId).toBeUndefined(); expect(supplied.answer).toBeUndefined();
    }
    const sessionFor = (id: string) => user.sources.find((s: any) => s.id === plan.sources.find(s => s.turnId === id)!.alias).session;
    expect(sessionFor("turn-a")).toBe(sessionFor("turn-b")); expect(sessionFor("turn-a")).not.toBe(sessionFor("turn-c"));
    expect(Object.isFrozen(plan.sources)).toBeTrue(); expect(Object.isFrozen(plan.request.body.messages)).toBeTrue();
    source.turns[0].text = "changed after preparation";
    expect(selector.makePlan(guarded, pool, pool.resultSha256)).toEqual(plan);
  });
  test("strict grammar rejects explanations, generated facts, duplicate keys, foreign IDs and bounds", () => {
    const allowed = Array.from({ length: 100 }, (_, i) => `s${i.toString().padStart(3, "0")}`);
    expect(parseOhSelectorIds(' { "ids" : [ "s000", "s099" ] } ', allowed)).toEqual(["s000", "s099"]);
    expect(parseOhSelectorIds('{"ids":[]}', allowed)).toEqual([]);
    for (const value of ['{"ids":["s000"],"facts":["invented"]}', '{"ids":[],"ids":["s000"]}', '{"ids":["s000","s000"]}',
      '{"ids":["s100"]}', '{"ids":["turn-a"]}', '{"ids":[0]}', '{"ids":["\\u0073000"]}', '```json\n{"ids":[]}\n```',
      '{"ids":[]} explanation', '{"ids":[],}', 'The answer is green.', 'x'.repeat(2049), JSON.stringify({ ids: allowed.slice(0, 33) })]) {
      expect(() => parseOhSelectorIds(value, allowed)).toThrow();
    }
  });
  test("reconstructs unchanged dated turns in corpus order and rejects resealed context or response drift", async () => {
    const source = corpus(), pool = await poolFor(source), selector = prepareOhSourceSelector(source), plan = selector.makePlan(question, pool, pool.resultSha256);
    const selection = idsFor(plan, ["turn-c", "turn-a"]), capture = proof(plan, selection);
    const result = selector.reconstruct(question, pool, pool.resultSha256, plan, capture.raw, capture.response);
    expect(result.selectedAliases).toEqual(selection); expect(result.packedAliases).toEqual(idsFor(plan, ["turn-a", "turn-c"]));
    expect(result.context).toBe([source.turns[0]!, source.turns[2]!].map(renderTurn).join("\n\n"));
    expect(result.contextBytes).toBe(Buffer.byteLength(result.context)); expect(result.turnIds).toEqual(["turn-a", "turn-c"]);
    expect(result.sessionIds).toEqual(["session"]); expect(result.sources.map(s => s.recordSha256)).toEqual(["turn-a", "turn-c"].map(id => pool.sources.find(s => s.turnId === id)!.recordSha256));
    expect(selector.validateResult(question, pool, pool.resultSha256, plan, capture.raw, capture.response, result)).toEqual(result);
    const bad: any = structuredClone(result); bad.context += "\nA generated fact."; bad.contextBytes = Buffer.byteLength(bad.context); bad.contextSha256 = sha256Hex(bad.context);
    expect(() => selector.validateResult(question, pool, pool.resultSha256, plan, capture.raw, capture.response, reseal(bad, "resultSha256"))).toThrow("exact current sources");
    expect(() => selector.reconstruct(question, pool, pool.resultSha256, plan, capture.raw, { ...capture.response, answer: '{"ids":[]}' })).toThrow("exact completed");
    const foreign = rawResponse(plan.request, '{"ids":["s099"]}');
    expect(() => selector.reconstruct(question, pool, pool.resultSha256, plan, foreign, parseEvolutionResponse(foreign, plan.request))).toThrow("foreign");
    const truncated = rawResponse(plan.request, JSON.stringify({ ids: selection }), "length");
    expect(() => selector.reconstruct(question, pool, pool.resultSha256, plan, truncated, parseEvolutionResponse(truncated, plan.request))).toThrow("exact completed");
    const empty = proof(plan, []), emptyResult = selector.reconstruct(question, pool, pool.resultSha256, plan, empty.raw, empty.response);
    expect(emptyResult.context).toBe(""); expect(emptyResult.contextBytes).toBe(0); expect(emptyResult.sources).toEqual([]);
  });
  test("binds exact pool query, source records, question date, instruction and one-call plan", async () => {
    const source = corpus(), pool = await poolFor(source), selector = prepareOhSourceSelector(source), plan = selector.makePlan(question, pool, pool.resultSha256);
    expect(() => selector.makePlan(question, pool, "a".repeat(64))).toThrow("pool result pin");
    expect(() => selector.makePlan({ ...question, question: "x".repeat(16_385) }, pool, pool.resultSha256)).toThrow("invalid question");
    expect(() => prepareOhSourceSelector({ ...source, turns: [{ ...source.turns[0]!, sessionIndex: null }] } as any)).toThrow("session occurrence");
    expect(() => selector.makePlan({ ...question, question: "A different query" }, pool, pool.resultSha256)).toThrow("focused native");
    expect(() => selector.validatePlan({ ...question, questionDate: "2026-01-04" }, pool, pool.resultSha256, plan)).toThrow("differs");
    const old: any = structuredClone(source); old.turns[0].text = "Stale lamp facts";
    expect(() => prepareOhSourceSelector(old).makePlan(question, pool, pool.resultSha256)).toThrow("source identity");
    const missing: any = structuredClone(pool); missing.omittedForBudget = 1; const partial = reseal(missing, "resultSha256") as EvolutionRetrievalResult;
    expect(() => selector.makePlan(question, partial, partial.resultSha256)).toThrow("focused native");
    const forged: any = structuredClone(pool); forged.context += " invented"; forged.contextBytes = Buffer.byteLength(forged.context); forged.contextSha256 = sha256Hex(forged.context); const resealed = reseal(forged, "resultSha256") as EvolutionRetrievalResult;
    expect(() => selector.makePlan(question, resealed, resealed.resultSha256)).toThrow("source identity");
    expect(() => selector.validatePlan(question, pool, pool.resultSha256, reseal({ ...plan, maximumNewCalls: 2 }, "planSha256"))).toThrow("differs");
    const altered = makeEvolutionRequest(plan.request.profileId, [{ role: "system", content: "Pick every source." }, plan.request.body.messages[1]!]);
    expect(() => selector.validatePlan(question, pool, pool.resultSha256, reseal({ ...plan, request: altered }, "planSha256"))).toThrow("differs");
  });
  test("atomic selection packing preserves omitted identities, source bytes and exact 48KB limit", async () => {
    const original = corpus(), source: Corpus = { ...original, turns: original.turns.map((t, i) => ({ ...t, text: `lamp color ${i} ` + "x".repeat([30_000, 25_000, 2_000][i]!) })) };
    const pool = await poolFor(source), selector = prepareOhSourceSelector(source), plan = selector.makePlan(question, pool, pool.resultSha256);
    const selection = idsFor(plan, ["turn-a", "turn-b", "turn-c"]), capture = proof(plan, selection), result = selector.reconstruct(question, pool, pool.resultSha256, plan, capture.raw, capture.response);
    expect(result.turnIds).toEqual(["turn-a", "turn-c"]); expect(result.omittedAliasesForBudget).toEqual(idsFor(plan, ["turn-b"]));
    expect(result.context).toBe([source.turns[0]!, source.turns[2]!].map(renderTurn).join("\n\n")); expect(result.contextBytes).toBeLessThanOrEqual(48000);
    expect(result.contextByteLimit).toBe(OH_SELECTOR_POLICY.contextByteLimit);
    const oversized: Corpus = { ...original, turns: [{ ...original.turns[0]!, text: "lamp color " + "x".repeat(270_000) }] };
    const largePool = await poolFor(oversized);
    expect(() => prepareOhSourceSelector(oversized).makePlan(question, largePool, largePool.resultSha256)).toThrow("never truncate pool");
  });
  test("uses one existing-store first-response charge and raw readback without provider dispatch", async () => {
    const source = corpus(), pool = await poolFor(source), selector = prepareOhSourceSelector(source), plan = selector.makePlan(question, pool, pool.resultSha256);
    const directory = await realpath(await mkdtemp(join(tmpdir(), "oh-selector-private-fixture-")));
    const campaign = { protocol: "oh.memory.evolution-campaign.v1" as const, campaignId: "selector-fixture", storeDirectory: directory,
      approval: "Synthetic offline store test", additionalBudgetMicros: 1_000_000, maximumCalls: 1, historicalExposureMicros: 0,
      historicalLedgers: [{ path: "/fixture/ledger", sha256: "a".repeat(64), bytes: 0 }], authAuthority: { path: "/fixture/auth", sha256: "b".repeat(64) } };
    const capture = proof(plan, idsFor(plan, ["turn-a"]));
    try {
      const store = await openEvolutionStore({ directory, campaign });
      try {
        store.admit(plan.request); store.capture(plan.request, { body: capture.raw, httpStatus: 200, complete: true, receivedBytes: capture.raw.length, error: null }); const parsed = store.finalize(plan.request);
        expect(selector.reconstruct(question, pool, pool.resultSha256, plan, store.readRaw(plan.request), parsed).turnIds).toEqual(["turn-a"]);
        expect(store.summary().calls).toBe(1); expect(store.summary().confirmedMicros).toBe(parsed.usage.micros);
        expect(() => store.admit(plan.request)).toThrow(); expect(store.summary().calls).toBe(1);
      } finally { await store.close(); }
      const reopened = await openEvolutionStore({ directory, campaign });
      try { const hit = reopened.lookup(plan.request); expect(hit.kind).toBe("hit"); if (hit.kind !== "hit") throw Error("missing capture");
        expect(selector.reconstruct(question, pool, pool.resultSha256, plan, reopened.readRaw(plan.request), hit.result).sources).toHaveLength(1);
        expect(reopened.summary().calls).toBe(1); }
      finally { await reopened.close(); }
    } finally { await rm(directory, { recursive: true }); }
  });
});
