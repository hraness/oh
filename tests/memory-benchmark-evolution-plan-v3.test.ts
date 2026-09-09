import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { DATASETS, type Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { EVOLUTION_CONTEXT_SOURCE_FILES, parseEvolutionRunConfig } from "../scripts/benchmarks/evolution";
import { makeEvolutionExperimentContextPlan, makeEvolutionReaderPlan, validateEvolutionAnyContextPlan, validateEvolutionContextPlanSources, validateEvolutionReaderPlan } from "../scripts/benchmarks/evolution-plan";
import { makeEvolutionJudgePlan } from "../scripts/benchmarks/evolution-judge";
import { buildEvolutionReport } from "../scripts/benchmarks/evolution-report";
import { EVOLUTION_MODEL_PROTOCOL, EVOLUTION_MODEL_V2_PROTOCOL, parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import type { EvolutionAttemptFailure } from "../scripts/benchmarks/evolution-store";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { OH_SPAN_PROTOTYPE_VARIANTS } from "../scripts/benchmarks/evolution-spans-prototype";
import { createEvolutionFullHistorySource } from "../scripts/benchmarks/evolution-full-history";
import { parseEvolutionTreatment, type EvolutionTreatment } from "../scripts/benchmarks/evolution-treatments-v3";
import { renderTurn } from "../scripts/benchmarks/retrieval";
const fetchBefore = globalThis.fetch;
beforeAll(() => { globalThis.fetch = Object.assign(async () => { throw new Error("network forbidden in V3 synthetic tests"); }, { preconnect() { throw new Error("network forbidden"); } }); });
afterAll(() => { globalThis.fetch = fetchBefore; });
const bytes = (v: unknown) => new TextEncoder().encode(canonicalJson(v));
const corpus = { id: "v3-synthetic", groupId: "v3-synthetic-family", turns: [
        { id: "t1", sessionId: "s1", sessionIndex: 0, date: "2026-01-01", speaker: "user", text: "I visited Paris 🗼 for my summer holiday. I took a train. I enjoyed the visit." },
        { id: "t2", sessionId: "s1", sessionIndex: 1, date: "2026-01-02", speaker: "assistant", text: "Your Paris visit was during summer. The train journey was memorable." },
        { id: "t3", sessionId: "s3", sessionIndex: 2, date: "2026-02-01", speaker: "user", text: "My bicycle is red now. The old bicycle was blue. The bicycle arrived yesterday." },
        { id: "t4", sessionId: "s4", sessionIndex: 3, date: "2026-03-01", speaker: "user", text: "Completely unrelated last-source sentinel: porcupine café." },
    ] };
const dataset: Dataset = { corpora: [corpus], questions: [
        { id: "holiday", corpusId: corpus.id, category: "single-session-user", question: "Where did I visit for my summer holiday?", questionDate: "2026-04-01", answer: "GOLD_ONLY_HOLIDAY", unanswerable: false, evidenceTurnIds: ["t1"], evidenceSessionIds: ["s1"] },
        { id: "bicycle", corpusId: corpus.id, category: "knowledge-update", question: "What color is my bicycle now?", questionDate: "2026-04-01", answer: "GOLD_ONLY_BICYCLE", unanswerable: false, evidenceTurnIds: ["t3"], evidenceSessionIds: ["s3"] },
    ] };
const native = { id: "native-96k", system: "oh-keyword" as const, budget: { topK: 100, contextBytes: 96000 } };
const legacySpan = { id: "legacy-span-48k", system: "oh-source-spans" as const, budget: { topK: 100 as const, contextBytes: 48000 } };
const prototypes: EvolutionTreatment[] = OH_SPAN_PROTOTYPE_VARIANTS.map(mechanism => ({ id: `prototype-${mechanism}`, system: "oh-source-spans-v2", mechanism, budget: { topK: 100, contextBytes: 48000 } }));
const full = { id: "full", system: "full-history" as const };
const treatments: EvolutionTreatment[] = [native, legacySpan, ...prototypes, full];
const manifest = createEvolutionDatasetManifest(dataset, { dataset: "longmemeval-s", revision: "synthetic-v3", sourceSha256: "a".repeat(64), groups: [{ groupId: corpus.groupId, partition: "development", exposure: "evaluated", evidence: "Synthetic implementation fixture only." }], histories: [{ corpusId: corpus.id, historyId: "synthetic-history" }] });
const manifestBytes = bytes(manifest), manifestSha256 = sha256Hex(manifestBytes), projected = () => projectEvolutionRunnerInput(dataset);
const options = () => ({ dataset: projected(), variants: treatments, manifestSha256, retrievalSourceSha256: "b".repeat(64) });
async function fixture() { const { plan, timing } = await makeEvolutionExperimentContextPlan(options()); if (plan.protocol !== "oh.memory.evolution-context-plan.v3")
    throw Error("Expected V3"); return { plan, timing }; }
function seal(v: any, key: string) { const { [key]: _, ...payload } = v; v[key] = canonicalSha256(payload); return v; }
function resultSeal(v: any) { v.contextBytes = Buffer.byteLength(v.context); v.contextSha256 = sha256Hex(v.context); return seal(v, "resultSha256"); }
function renderSpan(s: any) { return `[source ${JSON.stringify({ turnId: s.turnId, sessionId: s.sessionId, sessionIndex: s.sessionIndex, date: s.date, speaker: s.speaker, startByte: s.startByte, endByte: s.endByte })}]\n${s.text}`; }
function raw(r: EvolutionRequest, answer = "synthetic reader answer", finish = "stop") { return bytes({ model: r.model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: answer } }], usage: { prompt_tokens: 100, completion_tokens: 3, total_tokens: 103 }, providerMetadata: { gateway: { routing: { finalProvider: r.provider, originalModelId: r.model, canonicalSlug: r.model } } } }); }
function phase(kind: "reader" | "judge", planSha256: string, responses: Map<string, EvolutionResponse>, failures: Map<string, EvolutionAttemptFailure> = new Map()) { return bytes({ protocol: "oh.memory.evolution-phase.v1", phase: kind, planSha256, complete: true, responses: [...responses].map(([requestSha256, response]) => ({ requestSha256, response })), failures: [...failures.values()] }); }
describe("explicit V3 source mechanisms and complete full-history control", () => {
    test("shares exact raw/focused pools and all-source rendering without labels or provider calls", async () => {
        const { plan, timing } = await fixture();
        expect(plan).toEqual((await fixture()).plan);
        expect(plan.cases).toHaveLength(12);
        expect(plan.pools).toHaveLength(4);
        expect(timing).toHaveLength(1);
        expect(timing[0]!.queries).toBe(6);
        expect(() => validateEvolutionContextPlanSources(plan, projected())).not.toThrow();
        expect(validateEvolutionAnyContextPlan(plan)).toEqual(plan);
        for (const q of plan.questions) {
            expect(plan.pools.filter(p => p.questionId === q.id).map(p => p.kind)).toEqual(["raw", "focused"]);
            const f = plan.cases.find(c => c.questionId === q.id && c.kind === "full-history")!;
            expect(f.result.context).toBe(corpus.turns.map(renderTurn).join("\n\n"));
            expect(f.result.turnIds).toEqual(corpus.turns.map(t => t.id));
            expect(f.result.context).toContain("porcupine café");
        }
        for (const c of plan.cases.filter(c => c.kind === "source-spans-v2")) {
            if (c.kind !== "source-spans-v2")
                continue;
            expect(c.result.poolResultSha256).toBe(plan.pools.find(p => p.questionId === c.questionId && p.kind === "focused")!.result.resultSha256);
            expect(c.result.contextBytes).toBeLessThanOrEqual(48000);
        }
        expect(JSON.stringify(plan)).not.toContain("GOLD_ONLY");
        expect(JSON.stringify(plan)).not.toContain('"answer"');
        const guarded = projected();
        for (const object of [guarded, ...guarded.corpora, ...guarded.corpora.flatMap(c => c.turns), ...guarded.questions])
            for (const key of ["answer", "evidenceTurnIds", "evidenceSessionIds", "unanswerable", "category"])
                Object.defineProperty(object, key, { enumerable: true, get() { throw Error("gold getter"); } });
        expect((await makeEvolutionExperimentContextPlan({ ...options(), dataset: guarded })).plan).toEqual(plan);
    });
    test("native V1 and span V2 controls preserve their context and reader request identities inside V3", async () => {
        const v1 = (await makeEvolutionExperimentContextPlan({ ...options(), variants: [native] })).plan, v2 = (await makeEvolutionExperimentContextPlan({ ...options(), variants: [native, legacySpan] })).plan, v3 = (await fixture()).plan;
        expect(v1.protocol).toBe("oh.memory.evolution-context-plan.v1");
        expect(v2.protocol).toBe("oh.memory.evolution-context-plan.v2");
        const readers = ["gpt5-nano-reader", "gpt5-mini-reader"] as const, r3 = makeEvolutionReaderPlan(v3, readers);
        expect(validateEvolutionReaderPlan(r3, v3)).toEqual(r3);
        for (const old of [v1, v2]) {
            const rp = makeEvolutionReaderPlan(old, readers);
            for (const c of old.cases)
                expect(v3.cases.find(n => n.questionId === c.questionId && n.variantId === c.variantId)!.result).toEqual(c.result);
            for (const c of rp.cases)
                expect(r3.cases.find(n => n.questionId === c.questionId && n.variantId === c.variantId && n.reader === c.reader)).toEqual(c);
            for (const r of rp.requests)
                expect(r3.requests.find(n => n.requestSha256 === r.requestSha256)).toEqual(r);
        }
        for (const c of r3.cases) {
            const r = r3.requests.find(r => r.requestSha256 === c.requestSha256)!;
            expect(r.protocol).toBe(c.variantId === "full" ? EVOLUTION_MODEL_V2_PROTOCOL : EVOLUTION_MODEL_PROTOCOL);
            expect(JSON.stringify(r.body)).not.toContain("GOLD_ONLY");
        }
    });
    test("resealed shape, coverage, pool-kind, request-kind, budget and gold injection attacks fail", async () => {
        const { plan } = await fixture();
        const attacks: Array<(p: any) => void> = [p => p.cases.pop(), p => p.cases[1] = p.cases[0], p => p.cases[0].questionId = "foreign", p => p.pools.pop(), p => p.pools[1] = p.pools[0], p => p.pools[0].kind = "focused", p => p.pools[0].questionId = "foreign", p => p.pools[0].result.omittedForBudget = 1, p => p.pools[0].result.variantSha256 = "d".repeat(64), p => p.cases.find((c: any) => c.kind === "full-history").kind = "whole-turn", p => p.cases.find((c: any) => c.kind === "source-spans-v2").kind = "source-spans", p => p.cases.find((c: any) => c.kind === "source-spans-v2").result.variant = "missing", p => p.variants.find((v: any) => v.system === "full-history").budget = { contextBytes: 48000, topK: 100 }, p => p.variants.find((v: any) => v.system === "oh-source-spans-v2").budget.topK = 20, p => p.questions[0].answer = "GOLD_ONLY", p => p.extra = "GOLD_ONLY"];
        for (const attack of attacks) {
            const bad = structuredClone(plan) as any;
            attack(bad);
            for (const p of bad.pools)
                resultSeal(p.result);
            for (const c of bad.cases)
                resultSeal(c.result);
            seal(bad, "planSha256");
            expect(() => validateEvolutionAnyContextPlan(bad)).toThrow();
        }
        const rp = makeEvolutionReaderPlan(plan, ["gpt5-nano-reader"]);
        for (const attack of [(r: any) => r.cases.pop(), (r: any) => r.cases[0] = r.cases[1], (r: any) => r.cases.find((c: any) => c.variantId === "full").requestSha256 = r.cases[0].requestSha256]) {
            const bad = structuredClone(rp);
            attack(bad);
            seal(bad, "planSha256");
            expect(() => validateEvolutionReaderPlan(bad, plan)).toThrow();
        }
    });
    test("resealed source bytes, offset, metadata, stale corpus and truncated full-history claims fail source authentication", async () => {
        const { plan } = await fixture();
        for (const attack of [(r: any) => r.spans[0].text = "Invented source", (r: any) => r.spans[0].speaker = "forged", (r: any) => r.spans[0].startByte++, (r: any) => r.spans[0].sessionIndex = 99, (r: any) => r.spans[0].sourceTextSha256 = "f".repeat(64), (r: any) => r.spans.push({ ...r.spans[0] })]) {
            const bad = structuredClone(plan) as any, c = bad.cases.find((c: any) => c.kind === "source-spans-v2");
            expect(c.result.spans.length).toBeGreaterThan(0);
            attack(c.result);
            for (const span of c.result.spans)
                seal(span, "id");
            c.result.context = c.result.spans.map(renderSpan).join("\n\n");
            resultSeal(c.result);
            seal(bad, "planSha256");
            expect(() => validateEvolutionContextPlanSources(bad, projected())).toThrow();
        }
        const bad = structuredClone(plan) as any, p = bad.pools.find((p: any) => p.kind === "focused");
        p.result.context += "\nInvented pool";
        resultSeal(p.result);
        for (const c of bad.cases.filter((c: any) => c.questionId === p.questionId && c.kind === "source-spans-v2")) {
            c.result.poolResultSha256 = p.result.resultSha256;
            resultSeal(c.result);
        }
        seal(bad, "planSha256");
        expect(() => validateEvolutionContextPlanSources(bad, projected())).toThrow("source");
        const projectedInput = projected(), shortened = structuredClone(plan) as any, source = projectedInput.corpora[0]!;
        const subset = createEvolutionFullHistorySource({ ...source, groupId: source.id, turns: source.turns.slice(0, -1) }).result;
        for (const c of shortened.cases)
            if (c.kind === "full-history")
                c.result = subset;
        seal(shortened, "planSha256");
        expect(() => validateEvolutionAnyContextPlan(shortened)).not.toThrow();
        expect(() => validateEvolutionContextPlanSources(shortened, projectedInput)).toThrow("complete current source");
        const stale = structuredClone(plan), changed = projected();
        (changed.corpora[0]!.turns[3] as any).text += " source revision";
        (stale as any).inputSha256 = canonicalSha256(changed);
        seal(stale, "planSha256");
        expect(() => validateEvolutionContextPlanSources(stale, changed)).toThrow();
    });
    test("requires explicit V3 configuration, exact fixed mechanisms and supported full-history readers", () => {
        const pin = { path: "/fixture/pin.json", sha256: "b".repeat(64) }, config = { protocol: "oh.memory.evolution-run.v3", dataset: "longmemeval-s", datasetPin: { ...pin, sha256: DATASETS["longmemeval-s"].sha256 }, manifestPin: pin, campaignPin: pin, limit: 2, seed: 7, variants: treatments, readers: ["gpt5-nano-reader", "gpt5-mini-reader"], judge: "gpt4o-gateway-judge", directory: "/fixture/run", storeDirectory: "/fixture/store", concurrency: 2 };
        expect(parseEvolutionRunConfig(config).variants).toEqual(treatments);
        for (const protocol of ["oh.memory.evolution-run.v1", "oh.memory.evolution-run.v2"])
            expect(() => parseEvolutionRunConfig({ ...config, protocol })).toThrow("V3");
        expect(() => parseEvolutionRunConfig({ ...config, readers: ["qwen37-flash-reader"] })).toThrow("nano and mini");
        expect(() => parseEvolutionRunConfig({ ...config, variants: [native] })).toThrow("V3");
        for (const v of [{ ...full, budget: {} }, { ...prototypes[0]!, mechanism: "unknown" }, { ...prototypes[0]!, budget: { topK: 100, contextBytes: 96000 } }])
            expect(() => parseEvolutionTreatment(v)).toThrow();
        for (const file of ["evolution-plan-v3.ts", "evolution-treatments-v3.ts", "evolution-spans-prototype.ts", "evolution-full-history.ts"])
            expect(EVOLUTION_CONTEXT_SOURCE_FILES as readonly string[]).toContain(`scripts/benchmarks/${file}`);
    });
    test("complete V3 reader/judge/report matrix retains failed full-history reservation and counts judge failures separately", async () => {
        const { plan: contextPlan } = await fixture(), readerPlan = makeEvolutionReaderPlan(contextPlan, ["gpt5-nano-reader"]), captures = new Map<string, Uint8Array>(), responses = new Map<string, EvolutionResponse>(), failures = new Map<string, EvolutionAttemptFailure>();
        const failed = readerPlan.requests.find(r => r.protocol === EVOLUTION_MODEL_V2_PROTOCOL)!;
        for (const r of readerPlan.requests) {
            if (r === failed) {
                failures.set(r.requestSha256, { requestSha256: r.requestSha256, profileSha256: r.profileSha256, repeat: 0, storeStatus: "captured", reason: "unverifiable-first-response", rawSha256: sha256Hex(new Uint8Array()), rawBytes: 0, transport: { httpStatus: 413, complete: true, receivedBytes: 0, error: null }, serviceMs: 1, reservationMicros: r.reservationMicros });
                continue;
            }
            const b = raw(r);
            captures.set(r.requestSha256, b);
            responses.set(r.requestSha256, parseEvolutionResponse(b, r));
        }
        const readerOutputBytes = phase("reader", readerPlan.planSha256, responses, failures), judgePlan = makeEvolutionJudgePlan({ contextPlan, readerPlan, responses, failures, dataset, profile: "gpt4o-gateway-judge", rubric: await loadJudgeProfile(), readerOutputSha256: sha256Hex(readerOutputBytes) }), judges = new Map<string, EvolutionResponse>();
        for (const [i, r] of judgePlan.requests.entries()) {
            const b = raw(r, "yes", i === 0 ? "length" : "stop");
            captures.set(r.requestSha256, b);
            judges.set(r.requestSha256, parseEvolutionResponse(b, r));
        }
        const judgeOutputBytes = phase("judge", judgePlan.planSha256, judges), report = await buildEvolutionReport({ dataset, manifestBytes, manifestSha256, contextPlan, readerPlan, judgePlan, readerOutputBytes, judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes), loadRawResponse: async (r) => captures.get(r.requestSha256)!, loadAttemptFailure: async (r) => failures.get(r.requestSha256)! });
        expect(report.coverage).toMatchObject({ logicalReaderCases: 12, logicalJudgeCases: 12, expectedQuestionsPerArm: 2, completeAttemptCoverage: true, completePhysicalResponses: false, capturedUnverifiableAttempts: 1 });
        expect(report.arms).toHaveLength(6);
        expect(report.cost.unresolvedReservationMicros).toBe(failed.reservationMicros);
        expect(report.cost.knownUsageMicros).toBe([...responses.values(), ...judges.values()].reduce((s, r) => s + r.usage.micros, 0));
        expect(report.arms.reduce((s, a) => s + a.readerFailures, 0)).toBe(1);
        expect(report.arms.reduce((s, a) => s + a.judgeFailures, 0)).toBeGreaterThan(0);
        for (const arm of report.arms)
            expect(arm.metrics.find(m => m.metric === "judge-accuracy")!.overall).toMatchObject({ cases: 2, scored: 2, unscored: 0 });
        expect(JSON.stringify(report)).not.toContain("GOLD_ONLY");
        expect(report.qualification).toContain("no superiority claim");
    });
});
