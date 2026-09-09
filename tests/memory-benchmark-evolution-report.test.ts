import { describe, expect, test } from "bun:test";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import type { Dataset } from "../scripts/benchmarks/datasets";
import { createEvolutionDatasetManifest, projectEvolutionRunnerInput } from "../scripts/benchmarks/evolution-dataset";
import { makeEvolutionJudgePlan, type EvolutionJudgeProfileId } from "../scripts/benchmarks/evolution-judge";
import { EVOLUTION_GATEWAY_ENDPOINT, parseEvolutionResponse, type EvolutionRequest, type EvolutionResponse } from "../scripts/benchmarks/evolution-model";
import { makeEvolutionContextPlan, makeEvolutionReaderPlan } from "../scripts/benchmarks/evolution-plan";
import { buildEvolutionReport } from "../scripts/benchmarks/evolution-report";
import type { EvolutionAttemptFailure } from "../scripts/benchmarks/evolution-store";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";

const bytes = (value: unknown) => new TextEncoder().encode(canonicalJson(value));
const phase = (kind: "reader" | "judge", planSha256: string, responses: ReadonlyMap<string, EvolutionResponse>, wallMs?: number,
  failures?: readonly EvolutionAttemptFailure[]) => bytes({
  protocol: "oh.memory.evolution-phase.v1", phase: kind, planSha256, complete: true,
  ...(wallMs === undefined ? {} : { wallMs }),
  ...(failures === undefined ? {} : { failures }),
  responses: [...responses].map(([requestSha256, response]) => ({ requestSha256, response })),
});
function raw(request: EvolutionRequest, answer: string, finish = "stop") {
  return bytes({ model: request.model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: answer } }],
    usage: { prompt_tokens: 100, completion_tokens: 3, total_tokens: 103 },
    ...(request.endpoint === EVOLUTION_GATEWAY_ENDPOINT ? { providerMetadata: { gateway: { routing: {
      finalProvider: request.provider, originalModelId: request.model, canonicalSlug: request.model,
      resolvedProviderApiModelId: request.model.slice(request.model.indexOf("/") + 1),
    } } } } : {}) });
}
async function fixture(locomo = false, profile: EvolutionJudgeProfileId = "gpt4o-gateway-judge") {
  const corpus = (id: string, groupId: string) => ({ id, groupId, turns: [
    { id: "D1:1", sessionId: "session-1", date: "2026-01-01", speaker: "user", text: "I visited Paris during my summer holiday." },
    { id: "D1:2", sessionId: "session-1", date: "2026-01-01", speaker: "user", text: "I travelled by train to my holiday destination." },
    { id: "D2:1", sessionId: "session-2", date: "2026-02-01", speaker: "user", text: "I bought a red bicycle." },
  ] });
  const question = (i: number, corpusId: string) => ({ id: `PRIVATE-question-${i}`, corpusId,
    category: locomo ? `locomo:${i === 2 ? 3 : i + 1}` : ["single-session-user", "multi-session", "knowledge-update"][i]!,
    question: ["Where did I visit during my summer holiday?", "How did I travel to my holiday destination?", "What color is my bicycle?"][i]!,
    questionDate: "2026-03-01", answer: ["Paris", "train", "red"][i]!, unanswerable: false,
    evidenceTurnIds: i === 0 ? ["D1:1", "UNRESOLVED-label"] : i === 1 ? [] : ["D2:1"],
    evidenceSessionIds: i === 0 ? ["session-1"] : i === 1 ? [] : ["session-2"] });
  const a = corpus("PRIVATE-corpus-a", "PRIVATE-family-a"), b = corpus("PRIVATE-corpus-b", "PRIVATE-family-b");
  const dataset: Dataset = { corpora: [a, b], questions: [question(0, a.id), question(1, a.id), question(2, b.id)] };
  // The pinned manifest contains an unrelated closed partition, which reporting must never select.
  const c = corpus("PRIVATE-closed-corpus", "PRIVATE-closed-family"), closedQuestion = { ...question(0, c.id), id: "PRIVATE-closed-question" };
  const manifest = createEvolutionDatasetManifest({ corpora: [...dataset.corpora, c], questions: [...dataset.questions, closedQuestion] }, {
    dataset: locomo ? "locomo" : "longmemeval-s", revision: "synthetic-v1", sourceSha256: "a".repeat(64),
    groups: [a, b, c].map(corpus => ({ groupId: corpus.groupId, partition: corpus === c ? "closed" as const : "development" as const,
      exposure: "evaluated" as const, evidence: "Synthetic fixture already used for implementation testing." })),
    histories: [a, b, c].map(corpus => ({ corpusId: corpus.id, historyId: corpus === c ? "PRIVATE-closed-history" : "PRIVATE-shared-history" })),
  });
  const manifestBytes = bytes(manifest), manifestSha256 = sha256Hex(manifestBytes), projected = projectEvolutionRunnerInput(dataset);
  const { plan: contextPlan } = await makeEvolutionContextPlan({ dataset: projected, manifestSha256, retrievalSourceSha256: "b".repeat(64),
    variants: [{ id: "narrow", system: "bm25-window", budget: { topK: 1, contextBytes: 1024 } },
      { id: "wide", system: "bm25-session", budget: { topK: 2, contextBytes: 4096 } }] });
  const readerPlan = makeEvolutionReaderPlan(contextPlan, ["qwen37-flash-reader", "gpt5-nano-reader"]);
  const captures = new Map<string, Uint8Array>(), readerResponses = new Map<string, EvolutionResponse>();
  for (const request of readerPlan.requests) {
    const c = readerPlan.cases.find(c => c.requestSha256 === request.requestSha256)!;
    const i = projected.questions.findIndex(q => q.id === c.questionId), qwen = c.reader === "qwen37-flash-reader";
    const prediction = i === 0 && !qwen ? "Lyon" : dataset.questions[i]!.answer;
    const responseBytes = raw(request, prediction, i === 1 && qwen ? "length" : "stop");
    captures.set(request.requestSha256, responseBytes); readerResponses.set(request.requestSha256, parseEvolutionResponse(responseBytes, request));
  }
  const readerOutputBytes = phase("reader", readerPlan.planSha256, readerResponses, 123);
  const judgePlan = makeEvolutionJudgePlan({ contextPlan, readerPlan, responses: readerResponses, dataset, profile,
    rubric: await loadJudgeProfile(), readerOutputSha256: sha256Hex(readerOutputBytes) });
  const judgeResponses = new Map<string, EvolutionResponse>();
  for (const request of judgePlan.requests) {
    const c = judgePlan.cases.find(c => c.requestSha256 === request.requestSha256)!, i = projected.questions.findIndex(q => q.id === c.questionId);
    const answer = i === 2 ? "maybe" : request.body.messages.at(-1)!.content.includes("Model Response: Lyon") ? "no" : "yes";
    const responseBytes = raw(request, answer);
    captures.set(request.requestSha256, responseBytes); judgeResponses.set(request.requestSha256, parseEvolutionResponse(responseBytes, request));
  }
  const judgeOutputBytes = phase("judge", judgePlan.planSha256, judgeResponses, 45);
  const loaded: string[] = [];
  const input = { dataset, manifestBytes, manifestSha256, contextPlan, readerPlan, judgePlan, readerOutputBytes,
    judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes), loadRawResponse: async (request: EvolutionRequest) => {
      loaded.push(request.requestSha256); const capture = captures.get(request.requestSha256); if (!capture) throw new Error("Missing capture"); return capture;
    } };
  return { input, captures, loaded, manifest, readerResponses, judgeResponses };
}
const metric = (arm: Awaited<ReturnType<typeof buildEvolutionReport>>["arms"][number], name: string) => arm.metrics.find(m => m.metric === name)!;
function reseal<T extends { planSha256: string }>(value: T): T {
  const { planSha256: _old, ...payload } = value;
  return { ...payload, planSha256: canonicalSha256(payload) } as T;
}
function attemptFailure(request: EvolutionRequest, mode: "network" | "malformed" | "reserved"): EvolutionAttemptFailure {
  const shared = { requestSha256: request.requestSha256, profileSha256: request.profileSha256, repeat: 0,
    reservationMicros: request.reservationMicros };
  if (mode === "reserved") return { ...shared, storeStatus: "reserved", reason: "dispatch-outcome-unknown",
    rawSha256: null, rawBytes: null, transport: null, serviceMs: null };
  const raw = new TextEncoder().encode(mode === "network" ? "" : "invalid JSON");
  return { ...shared, storeStatus: "captured", reason: "unverifiable-first-response", rawSha256: sha256Hex(raw), rawBytes: raw.length,
    transport: { httpStatus: mode === "network" ? null : 200, complete: mode !== "network", receivedBytes: raw.length,
      error: mode === "network" ? "network" : null }, serviceMs: mode === "network" ? 120_001.639083 : 14 };
}
async function allFailedReaders() {
  const f = await fixture(true), failures = new Map(f.input.readerPlan.requests.map((request, index) =>
    [request.requestSha256, attemptFailure(request, index % 2 ? "reserved" : "network")] as const));
  const responses = new Map<string, EvolutionResponse>();
  const readerOutputBytes = phase("reader", f.input.readerPlan.planSha256, responses, 130_000, [...failures.values()]);
  const judgePlan = makeEvolutionJudgePlan({ contextPlan: f.input.contextPlan, readerPlan: f.input.readerPlan, responses, failures,
    dataset: f.input.dataset, profile: f.input.judgePlan.profile, rubric: await loadJudgeProfile(), readerOutputSha256: sha256Hex(readerOutputBytes) });
  const judgeOutputBytes = phase("judge", judgePlan.planSha256, new Map(), 0, []);
  const failureLoads: string[] = [];
  const input = { ...f.input, readerOutputBytes, judgePlan, judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes),
    loadAttemptFailure: async (request: EvolutionRequest) => { failureLoads.push(request.requestSha256); return failures.get(request.requestSha256)!; } };
  return { f, input, responses, failures, failureLoads };
}

describe("authenticated memory evolution reports", () => {
  test("counts the full denominator, separates failures, and charges shared physical requests once", async () => {
    const f = await fixture(), report = await buildEvolutionReport(f.input);
    expect(report.coverage).toEqual({ logicalReaderCases: 12, logicalJudgeCases: 12, expectedQuestionsPerArm: 3, completePhysicalResponses: true,
      completeAttemptCoverage: true, verifiedPhysicalResponses: f.input.readerPlan.requests.length + f.input.judgePlan.requests.length,
      capturedUnverifiableAttempts: 0, unknownDispatches: 0 });
    expect(report.dataset).toMatchObject({ selectedQuestions: 3, selectedCorpora: 2, declaredGroups: 2, declaredHistories: 1, partition: "development" });
    for (const arm of report.arms) {
      expect(arm.readerFailures).toBe(arm.reader === "qwen37-flash-reader" ? 1 : 0);
      expect(arm.judgeFailures).toBe(1);
      expect(metric(arm, "judge-accuracy").overall).toMatchObject({ cases: 3, scored: 3, mean: 1 / 3,
        failed: arm.reader === "qwen37-flash-reader" ? 2 : 1 });
    }
    const expectedMicros = [...f.readerResponses.values(), ...f.judgeResponses.values()].reduce((sum, r) => sum + r.usage.micros, 0);
    expect(report.cost.accountedMicros).toBe(expectedMicros);
    expect(report.cost.reader.physicalRequests).toBe(f.input.readerPlan.requests.length);
    expect(report.cost.judge.physicalRequests).toBe(f.input.judgePlan.requests.length);
    expect(report.latency.reader).toMatchObject({ phaseWallMs: 123, physical: { count: 0,
      unmeasuredPhysicalRequests: f.input.readerPlan.requests.length, totalMs: 0, p50Ms: null, p95Ms: null } });
    expect(report.cost.judge.physicalRequests).toBeLessThan(report.coverage.logicalJudgeCases - 2);
    expect(f.loaded.length).toBe(new Set(f.loaded).size);
    expect(report.scoring.judgeQualification).toContain("alias proxy");
    expect(report.qualification).toContain("no superiority claim");
    expect(report.scoring.answerCitationF1).toBeNull();
    const serialized = JSON.stringify(report);
    for (const privateValue of ["PRIVATE-", "summer holiday", "Model Response:", "UNRESOLVED-label", "partialAnswer"]) expect(serialized).not.toContain(privateValue);
  });

  test("reports per-arm physical service-time distributions separately from phase wall time", async () => {
    const f = await fixture();
    const serviceMs = new Map([...f.input.readerPlan.requests.map((request, index) => [request.requestSha256, index + 1] as const),
      ...f.input.judgePlan.requests.map((request, index) => [request.requestSha256, index + 101] as const)]);
    const report = await buildEvolutionReport({ ...f.input, loadServiceMs: async request => serviceMs.get(request.requestSha256) ?? null });
    expect(report.latency.reader).toMatchObject({ phaseWallMs: 123, physical: { count: f.input.readerPlan.requests.length,
      totalMs: f.input.readerPlan.requests.length * (f.input.readerPlan.requests.length + 1) / 2,
      p50Ms: Math.ceil(f.input.readerPlan.requests.length * 0.5), p95Ms: Math.ceil(f.input.readerPlan.requests.length * 0.95) } });
    expect(report.latency.judge).toMatchObject({ phaseWallMs: 45, physical: { count: f.input.judgePlan.requests.length,
      totalMs: f.input.judgePlan.requests.length * 100 + f.input.judgePlan.requests.length * (f.input.judgePlan.requests.length + 1) / 2,
      p50Ms: 100 + Math.ceil(f.input.judgePlan.requests.length * 0.5), p95Ms: 100 + Math.ceil(f.input.judgePlan.requests.length * 0.95) } });
    const arm = report.arms.find(value => value.variantId === "narrow" && value.reader === "qwen37-flash-reader")!;
    expect(arm.latency).toMatchObject({ reader: { logicalCases: 3, attributedPhysicalRequests: 3, count: 3 },
      judge: { logicalCases: 2, attributedPhysicalRequests: 2, count: 2 } });
    expect(report.latency.qualification).toContain("cache-hit invocation");
  });

  test("uses declared histories and produces one-factor paired wins and losses", async () => {
    const f = await fixture(), report = await buildEvolutionReport(f.input);
    expect(report.comparisons.length).toBe(4);
    const readerComparison = report.comparisons.find(c => c.kind === "reader")!;
    expect(readerComparison.left.variantId).toBe(readerComparison.right.variantId);
    expect(readerComparison.metrics.find(m => m.metric === "judge-accuracy")!.paired).toMatchObject({ wins: 1, losses: 1, ties: 1,
      meanDelta: 0, declaredGroups: 2, declaredHistories: 1 });
    expect(report.comparisons.filter(c => c.kind === "retrieval").every(c => c.left.reader === c.right.reader)).toBeTrue();
  });

  test("keeps official LoCoMo F1 and unresolved evidence distinct from semantic judging", async () => {
    const f = await fixture(true), report = await buildEvolutionReport(f.input);
    expect(report.scoring.officialLocomoF1?.reference.referenceNltkVersion).toBe("3.9.2");
    expect(report.scoring.judgeQualification).toContain("Separate semantic diagnostic");
    const arm = report.arms[0]!;
    expect(metric(arm, "locomo-f1").overall.mean).toBe(2 / 3);
    expect(metric(arm, "judge-accuracy").overall.mean).toBe(1 / 3);
    expect(metric(arm, "evidence-recall").overall).toMatchObject({ scored: 2, unscored: 1, mean: 0.75 });
    // The selected window includes two turns; one of two reference labels remains unresolved.
    expect(metric(arm, "evidence-f1").byCategory.find(c => c.id === "locomo:1")!.mean).toBe(0.5);
    expect(metric(arm, "evidence-precision").byCategory.find(c => c.id === "locomo:1")!.mean).toBe(0.5);
  });

  test("direct snapshot applies native contains-yes grading and does not label a valid no as judge failure", async () => {
    const f = await fixture(false, "gpt4o-official-snapshot-judge"), report = await buildEvolutionReport(f.input);
    expect(report.scoring.judgeQualification).toContain("native LongMemEval prompts");
    expect(report.scoring.judgeRule).toBe("native-contains-yes");
    expect(report.arms.every(arm => arm.judgeFailures === 0)).toBeTrue();
    expect(f.input.judgePlan.requests.every(r => r.body.messages.length === 1 && r.body.messages[0]!.role === "user" && r.body.max_tokens === 10)).toBeTrue();
  });

  test("Gateway native-rubric scoring remains an alias and preserves reader failure denominators", async () => {
    const f = await fixture(false, "gpt4o-gateway-native-rubric-judge-v1"), report = await buildEvolutionReport(f.input);
    expect(report.scoring.judgeQualification).toContain("Gateway GPT-4o alias with native LongMemEval prompts");
    expect(report.scoring.judgeQualification).toContain("not a pinned snapshot");
    expect(report.scoring.judgeRule).toBe("native-contains-yes");
    expect(report.arms.every(arm => arm.judgeFailures === 0)).toBeTrue();
    expect(report.arms.filter(arm => arm.reader === "qwen37-flash-reader").every(arm => arm.readerFailures === 1)).toBeTrue();
    expect(report.arms.every(arm => metric(arm, "judge-accuracy").overall.cases === 3)).toBeTrue();
    expect(f.input.judgePlan.requests.every(r => r.body.messages.length === 1 && r.body.messages[0]!.role === "user" && r.body.max_tokens === 10)).toBeTrue();
    expect(report.cost.judge.physicalRequests).toBe(f.input.judgePlan.requests.length);
    expect(report.cost.accountedMicros).toBe([...f.readerResponses.values(), ...f.judgeResponses.values()].reduce((sum, r) => sum + r.usage.micros, 0));
  });

  test("scores total reader failure at zero with a valid empty physical judge phase", async () => {
    const f = await fixture(true), captures = new Map(f.captures), responses = new Map<string, EvolutionResponse>();
    for (const request of f.input.readerPlan.requests) {
      const capture = raw(request, "unfinished text", "length"); captures.set(request.requestSha256, capture);
      responses.set(request.requestSha256, parseEvolutionResponse(capture, request));
    }
    const readerOutputBytes = phase("reader", f.input.readerPlan.planSha256, responses);
    const judgePlan = makeEvolutionJudgePlan({ contextPlan: f.input.contextPlan, readerPlan: f.input.readerPlan, responses,
      dataset: f.input.dataset, profile: "gpt4o-gateway-judge", rubric: await loadJudgeProfile(), readerOutputSha256: sha256Hex(readerOutputBytes) });
    const judgeOutputBytes = phase("judge", judgePlan.planSha256, new Map());
    const report = await buildEvolutionReport({ ...f.input, readerOutputBytes, judgePlan, judgeOutputBytes,
      judgeOutputSha256: sha256Hex(judgeOutputBytes), loadRawResponse: async request => captures.get(request.requestSha256)! });
    expect(report.cost.judge).toMatchObject({ physicalRequests: 0, accountedMicros: 0 });
    for (const arm of report.arms) {
      expect(arm).toMatchObject({ readerFailures: 3, judgeFailures: 0 });
      expect(metric(arm, "judge-accuracy").overall).toMatchObject({ cases: 3, scored: 3, mean: 0, failed: 3 });
      expect(metric(arm, "locomo-f1").overall.mean).toBe(0);
      expect(metric(arm, "evidence-recall").overall.mean).toBe(0.75);
    }
  });

  test("authenticates captured timeouts and unknown dispatches without inventing usage or losing denominator", async () => {
    const f = await allFailedReaders(), report = await buildEvolutionReport(f.input);
    const reserved = [...f.failures.values()].filter(f => f.storeStatus === "reserved").length;
    const captured = f.failures.size - reserved, reservation = [...f.failures.values()].reduce((sum, f) => sum + f.reservationMicros, 0);
    expect(f.input.judgePlan.requests).toEqual([]);
    expect(report.coverage).toMatchObject({ logicalReaderCases: 12, logicalJudgeCases: 12, completeAttemptCoverage: true,
      completePhysicalResponses: false, verifiedPhysicalResponses: 0, capturedUnverifiableAttempts: captured, unknownDispatches: reserved });
    expect(report.cost).toMatchObject({ accountedMicros: reservation, knownUsageMicros: 0, unresolvedReservationMicros: reservation });
    expect(report.cost.reader).toMatchObject({ physicalRequests: captured, occupiedRequests: f.failures.size, unknownDispatches: reserved,
      usageCoverage: { knownRequests: 0, unknownRequests: f.failures.size }, identities: [] });
    expect(report.cost.reader.byRequestedModel.length).toBe(2);
    expect(report.cost.reader.byRequestedModel.reduce((sum, row) => sum + row.unresolvedReservationMicros, 0)).toBe(reservation);
    expect(report.cost.judge.occupiedRequests).toBe(0);
    expect(report.latency.reader.physical).toMatchObject({ attributedPhysicalRequests: captured, count: captured,
      unknownDispatches: reserved, unmeasuredPhysicalRequests: 0, p50Ms: 120_001.639083, p95Ms: 120_001.639083 });
    for (const arm of report.arms) {
      expect(arm).toMatchObject({ readerFailures: 3, judgeFailures: 0 });
      expect(metric(arm, "judge-accuracy").overall).toMatchObject({ cases: 3, scored: 3, failed: 3, mean: 0 });
      expect(metric(arm, "locomo-f1").overall.mean).toBe(0);
      expect(metric(arm, "evidence-recall").overall.mean).toBe(0.75);
    }
    expect(f.failureLoads.length).toBe(f.failures.size);
    expect(new Set(f.failureLoads).size).toBe(f.failureLoads.length);
    expect(f.f.loaded).toEqual([]);
    const publicText = JSON.stringify(report);
    for (const privateValue of ["PRIVATE-", "unverifiable-first-response", ...f.failures.keys()]) expect(publicText).not.toContain(privateValue);
  });

  test("malformed judge captures score zero separately while reader F1 and known usage remain intact", async () => {
    const f = await fixture(true), failures = new Map(f.input.judgePlan.requests.map(request =>
      [request.requestSha256, attemptFailure(request, "malformed")] as const));
    const judgeOutputBytes = phase("judge", f.input.judgePlan.planSha256, new Map(), 100, [...failures.values()]);
    const report = await buildEvolutionReport({ ...f.input, judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes),
      loadAttemptFailure: async request => failures.get(request.requestSha256)! });
    const known = [...f.readerResponses.values()].reduce((sum, response) => sum + response.usage.micros, 0);
    const unresolved = [...failures.values()].reduce((sum, f) => sum + f.reservationMicros, 0);
    expect(report.cost).toMatchObject({ knownUsageMicros: known, unresolvedReservationMicros: unresolved, accountedMicros: known + unresolved });
    expect(report.cost.judge).toMatchObject({ physicalRequests: failures.size, usageCoverage: { knownRequests: 0, unknownRequests: failures.size }, identities: [] });
    for (const arm of report.arms) {
      expect(arm.judgeFailures).toBe(3 - arm.readerFailures);
      expect(metric(arm, "judge-accuracy").overall).toMatchObject({ cases: 3, scored: 3, failed: 3, mean: 0 });
      expect(metric(arm, "locomo-f1").overall.mean).toBe(2 / 3);
    }
  });

  test("rejects forged, missing, duplicate, foreign and unbacked failure receipts", async () => {
    const f = await allFailedReaders();
    const { loadAttemptFailure: _omitted, ...withoutLoader } = f.input;
    await expect(buildEvolutionReport(withoutLoader)).rejects.toThrow("failure loader required");
    const mutations: Array<(receipt: any) => void> = [
      receipt => { receipt.failures.pop(); },
      receipt => { receipt.failures.push(receipt.failures[0]); },
      receipt => { receipt.failures[0].requestSha256 = "f".repeat(64); },
      receipt => { receipt.failures[0].profileSha256 = "e".repeat(64); },
      receipt => { receipt.failures[0].reservationMicros = 0; },
      receipt => { receipt.failures[0].repeat = 1; },
      receipt => { receipt.failures[0].rawSha256 = "d".repeat(64); },
      receipt => { receipt.failures[0].serviceMs = 1; },
      receipt => { receipt.failures[0].usage = { micros: 0 }; },
      receipt => { receipt.complete = false; },
    ];
    for (const mutate of mutations) {
      const receipt = JSON.parse(new TextDecoder().decode(f.input.readerOutputBytes)); mutate(receipt);
      const readerOutputBytes = bytes(receipt), judgePlan = reseal({ ...f.input.judgePlan, readerOutputSha256: sha256Hex(readerOutputBytes) });
      await expect(buildEvolutionReport({ ...f.input, readerOutputBytes, judgePlan })).rejects.toThrow();
    }
    const first = f.input.readerPlan.requests[0]!, forgedResponse = f.f.readerResponses.get(first.requestSha256)!;
    const overlap = JSON.parse(new TextDecoder().decode(f.input.readerOutputBytes));
    overlap.responses.push({ requestSha256: first.requestSha256, response: forgedResponse });
    const readerOutputBytes = bytes(overlap), judgePlan = reseal({ ...f.input.judgePlan, readerOutputSha256: sha256Hex(readerOutputBytes) });
    await expect(buildEvolutionReport({ ...f.input, readerOutputBytes, judgePlan })).rejects.toThrow();
    await expect(buildEvolutionReport({ ...f.input, loadAttemptFailure: async () => { throw new Error("unoccupied request"); } })).rejects.toThrow("unoccupied request");
  });

  test("judge planning requires the exact disjoint reader outcome matrix and bound failure identity", async () => {
    const f = await allFailedReaders(), rubric = await loadJudgeProfile();
    const input = { contextPlan: f.input.contextPlan, readerPlan: f.input.readerPlan, responses: f.responses, failures: f.failures,
      dataset: f.input.dataset, profile: f.input.judgePlan.profile, rubric, readerOutputSha256: sha256Hex(f.input.readerOutputBytes) };
    expect(makeEvolutionJudgePlan(input).cases.every(c => c.readerFailed && c.requestSha256 === null)).toBeTrue();
    const first = f.input.readerPlan.requests[0]!, missing = new Map(f.failures); missing.delete(first.requestSha256);
    expect(() => makeEvolutionJudgePlan({ ...input, failures: missing })).toThrow();
    expect(() => makeEvolutionJudgePlan({ ...input, responses: new Map([[first.requestSha256, f.f.readerResponses.get(first.requestSha256)!]]) })).toThrow();
    const foreign = new Map(f.failures); foreign.set(first.requestSha256, { ...foreign.get(first.requestSha256)!, profileSha256: "d".repeat(64) });
    expect(() => makeEvolutionJudgePlan({ ...input, failures: foreign })).toThrow();
  });

  test("rejects closed selections and shared-history partition drift before reading response bytes", async () => {
    const f = await fixture(), manifest = structuredClone(f.manifest);
    const index = manifest.groups.findIndex(g => g.partition === "development");
    manifest.groups[index] = { ...manifest.groups[index]!, partition: "closed" };
    const manifestBytes = bytes(manifest);
    await expect(buildEvolutionReport({ ...f.input, manifestBytes, manifestSha256: sha256Hex(manifestBytes) })).rejects.toThrow("crosses partitions");
    expect(f.loaded).toEqual([]);
    const allClosed = { ...f.manifest, groups: f.manifest.groups.map(g => ({ ...g, partition: "closed" as const })),
      questions: f.manifest.questions.map(q => ({ ...q, partition: "closed" as const })) };
    allClosed.datasetSha256 = sha256Hex(JSON.stringify({ corpora: allClosed.corpora, questions: allClosed.questions }));
    const closedBytes = bytes(allClosed);
    await expect(buildEvolutionReport({ ...f.input, manifestBytes: closedBytes, manifestSha256: sha256Hex(closedBytes) })).rejects.toThrow("only development");
    expect(f.loaded).toEqual([]);
  });

  test("refuses a changed rubric under the parity-qualified native judge identity", async () => {
    const f = await fixture(), rubric = await loadJudgeProfile();
    expect(() => makeEvolutionJudgePlan({ contextPlan: f.input.contextPlan, readerPlan: f.input.readerPlan,
      responses: f.readerResponses, dataset: f.input.dataset, profile: "gpt4o-official-snapshot-judge",
      rubric: { ...rubric, sha256: "e".repeat(64) }, readerOutputSha256: sha256Hex(f.input.readerOutputBytes) })).toThrow("parity-qualified rubric");
  });

  test("rejects forged predictions or usage even when output receipts and judge plan are rehashed", async () => {
    const f = await fixture(), receipt = JSON.parse(new TextDecoder().decode(f.input.readerOutputBytes));
    receipt.responses[0].response.answer = "forged answer";
    receipt.responses[0].response.usage.micros = 0;
    const changed = bytes(receipt), judgePlan = reseal({ ...f.input.judgePlan, readerOutputSha256: sha256Hex(changed) });
    await expect(buildEvolutionReport({ ...f.input, readerOutputBytes: changed, judgePlan })).rejects.toThrow("captured raw response");
    const j = JSON.parse(new TextDecoder().decode(f.input.judgeOutputBytes)); j.responses[0].response.answer = "yes, forged";
    const judgeOutputBytes = bytes(j);
    await expect(buildEvolutionReport({ ...f.input, judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes) })).rejects.toThrow("captured raw response");
  });

  test("requires exact physical coverage and complete phases", async () => {
    const f = await fixture();
    for (const change of [(r: any) => { r.responses.pop(); }, (r: any) => { r.responses.push(r.responses[0]); },
      (r: any) => { r.responses[0].requestSha256 = "f".repeat(64); }, (r: any) => { r.complete = false; }]) {
      const receipt = JSON.parse(new TextDecoder().decode(f.input.judgeOutputBytes)); change(receipt);
      const judgeOutputBytes = bytes(receipt);
      await expect(buildEvolutionReport({ ...f.input, judgeOutputBytes, judgeOutputSha256: sha256Hex(judgeOutputBytes) })).rejects.toThrow();
    }
  });

  test("rejects rehashed judge-case transplants and source/selection/gold changes", async () => {
    const f = await fixture(), changedCases = structuredClone(f.input.judgePlan.cases);
    changedCases[0] = { ...changedCases[0]!, readerFailed: true, requestSha256: null };
    const transplanted = reseal({ ...f.input.judgePlan, cases: changedCases });
    await expect(buildEvolutionReport({ ...f.input, judgePlan: transplanted })).rejects.toThrow();
    const dataset = structuredClone(f.input.dataset); dataset.questions[0] = { ...dataset.questions[0]!, answer: "changed gold" };
    await expect(buildEvolutionReport({ ...f.input, dataset })).rejects.toThrow("gold or corpus content");
    await expect(buildEvolutionReport({ ...f.input, manifestSha256: "d".repeat(64) })).rejects.toThrow("manifest bytes");
    const context = structuredClone(f.input.contextPlan), c = context.cases[0]!;
    const { resultSha256: _old, ...payload } = c.result;
    const result = { ...payload, context: "forged source", contextSha256: sha256Hex("forged source"), contextBytes: 13 };
    context.cases[0] = { ...c, result: { ...result, resultSha256: canonicalSha256(result) } };
    await expect(buildEvolutionReport({ ...f.input, contextPlan: reseal(context) })).rejects.toThrow("source identity or rendering mismatch");
  });
});
