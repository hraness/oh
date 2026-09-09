import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { Corpus, Question } from "../scripts/benchmarks/datasets";
import { corpusIdentity } from "../scripts/benchmarks/extract";
import { makeGatewayReaderJobs, makeGatewayJudgePlan, completeGatewayJudge, type GatewayJob } from "../scripts/benchmarks/gateway-study-plan-v3";
import { completeGatewayV5Reader } from "../scripts/benchmarks/gateway-study-plan-v5";
import { GatewayStudyBudget, makeGatewayStudyRequest, type GatewayStudyRequest, type GatewayStudyRaw,
  type GatewayStudyPhase, type GatewayStudyLedgerEvent } from "../scripts/benchmarks/gateway-study-transport-v3";
import { parseGatewayStudyV5 } from "../scripts/benchmarks/gateway-study-transport-v5";
import { GATEWAY_READER_FAILURE_V6_POLICY, GATEWAY_READER_FAILURE_V6_POLICY_SHA256,
  parseGatewayStudyV6, invokeGatewayStudyV6 } from "../scripts/benchmarks/gateway-study-transport-v6";
import { completeGatewayV6Reader, completeGatewayV6Judge, completeGatewayV6Extraction,
  makeGatewayV6JudgePlan, expandGatewayV6Judgments, type GatewayReaderOutcomeV6 } from "../scripts/benchmarks/gateway-study-plan-v6";
import { assessGatewayV6Superiority } from "../scripts/benchmarks/gateway-study-assessment-v6";
import { loadJudgeProfile } from "../scripts/benchmarks/judge";
import { assessSuperiority } from "../scripts/benchmarks/superiority";
import { buildExtractionChunks } from "../scripts/benchmarks/units";

const partial = "SYNTHETIC_TRUNCATED_READER_TEXT_NEVER_ACCEPTED";
const hash = (value: string) => sha256Hex(`reader-policy-v6-synthetic:${value}`);
function request(phase: GatewayStudyPhase = "reader") {
  return makeGatewayStudyRequest({ phase, messages: [{ role: "system", content: "Synthetic instruction." }, { role: "user", content: "Synthetic input." }] });
}
function envelope(req: GatewayStudyRequest, finish = "length", content: string | null = partial, output = req.maximumOutput) {
  return { model: req.model, choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content, refusal: null } }],
    usage: { prompt_tokens: 20, completion_tokens: output, total_tokens: 20 + output }, providerMetadata: { gateway: { routing: {
      originalModelId: req.model, canonicalSlug: req.model, finalProvider: "openai", resolvedProvider: "openai", modelAttemptCount: 1,
      totalProviderAttemptCount: 1, modelAttempts: [{ canonicalSlug: req.model, success: true, providerAttemptCount: 1,
        providerAttempts: [{ provider: "openai", success: true, statusCode: 200 }] }] } } } };
}
function evidence(req: GatewayStudyRequest, value: unknown = envelope(req)) {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const raw: GatewayStudyRaw = { requestSha256: req.requestSha256, httpStatus: 200, body, bodyComplete: true, receivedBytes: body.length, transportError: null };
  const reservation = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }).reserve(req, "synthetic");
  return { raw, reservation };
}
function parsed(req: GatewayStudyRequest, value: unknown = envelope(req)) {
  const { raw, reservation } = evidence(req, value); return parseGatewayStudyV6(req, reservation, raw);
}
async function fixture(count = 1, failed: (system: string, family: number, ordinal: number) => boolean = () => false,
  answer: (system: string) => string = () => "Synthetic shared answer") {
  const corpora: Corpus[] = Array.from({ length: count }, (_, i) => ({ id: `synthetic-corpus-${i}`, groupId: `synthetic-group-${i}`,
    turns: [{ id: `turn-${i}`, sessionId: `session-${i}`, date: "2026-01-01", speaker: "Casey", text: "Casey owns a bicycle." }] }));
  const questions: Question[] = corpora.map((c, i) => ({ id: `synthetic-question-${i}`, corpusId: c.id, category: "single-session-user",
    question: `Synthetic question ${i}: what does Casey own?`, questionDate: "2026-01-02", answer: "SYNTHETIC_GOLD_ONLY",
    unanswerable: false, evidenceTurnIds: [`turn-${i}`], evidenceSessionIds: [`session-${i}`] }));
  const memory = corpora.map(c => ({ corpusId: c.id, corpusSha256: corpusIdentity(c),
    chunks: buildExtractionChunks(c).map(chunk => ({ id: chunk.id, units: [], rejected: 0 })) }));
  const readerJobs = await makeGatewayReaderJobs({ corpora, questions, memory });
  const readerRows = readerJobs.map(job => completeGatewayV6Reader(job, questions[job.native.questionIndex]!,
    parsed(job.request, failed(job.native.system, job.native.questionIndex, job.ordinal)
      ? envelope(job.request) : envelope(job.request, "stop", answer(job.native.system), 2))));
  const selected = questions.map((q, i) => ({ questionId: q.id, corpusId: q.corpusId, groupId: corpora[i]!.groupId }));
  return { questions, readerJobs, readerRows, selected, profile: await loadJudgeProfile() };
}
function score(f: Awaited<ReturnType<typeof fixture>>, verdict: (job: GatewayJob) => string = () => "yes") {
  const plan = makeGatewayV6JudgePlan(f);
  const physicalJudgeRows = plan.jobs.map(job => completeGatewayV6Judge(job, parsed(job.request, envelope(job.request, "stop", verdict(job), 1))));
  const caseOutcomes = expandGatewayV6Judgments(plan, physicalJudgeRows);
  return { plan, physicalJudgeRows, caseOutcomes };
}

describe("Gateway v6 authenticated reader failure", () => {
  test("exact-cap reader length produces a policy-bound result with no accepted partial prediction", () => {
    const req = request(), { raw, reservation } = evidence(req), result = parseGatewayStudyV6(req, reservation, raw);
    expect(result).toMatchObject({ kind: "terminal-reader-failure", reason: "output-token-limit", finishReason: "length",
      policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256, requestSha256: req.requestSha256, rawSha256: sha256Hex(raw.body),
      rawBytes: raw.body.length, usage: { outputTokens: 512 }, identity: { requestedModel: req.model, finalProvider: "openai", resolvedSnapshot: null } });
    expect(Object.keys(result).sort()).toEqual(["finishReason", "identity", "kind", "policySha256", "rawBytes", "rawSha256", "reason", "requestSha256", "usage"]);
    expect(JSON.stringify(result)).not.toContain(partial); expect(result).not.toHaveProperty("prediction");
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.usage)).toBe(true);
    expect(GATEWAY_READER_FAILURE_V6_POLICY_SHA256).toBe(canonicalSha256(GATEWAY_READER_FAILURE_V6_POLICY));
    expect(GATEWAY_READER_FAILURE_V6_POLICY).toMatchObject({ eligibility: { maximumOutput: 512, outputTokens: 512 },
      disposition: { correct: 0, judgeRequest: "none" }, sensitivity: { candidateFailure: 0, baselineFailure: 1 } });
    expect(() => parseGatewayStudyV5(req, reservation, raw)).toThrow("outside the exact-cap extraction policy");
  });
  test("ordinary results and extraction policy remain byte-equivalent to v5 while judge length remains fatal", () => {
    for (const phase of ["extract", "reader", "judge"] as const) {
      const req = request(phase), values = [envelope(req, "stop", "Synthetic answer", 2)];
      if (phase === "extract") values.push(envelope(req));
      for (const value of values) {
        const { raw, reservation } = evidence(req, value);
        expect(JSON.stringify(parseGatewayStudyV6(req, reservation, raw))).toBe(JSON.stringify(parseGatewayStudyV5(req, reservation, raw)));
      }
    }
    expect(() => parsed(request("judge"))).toThrow("outside the exact-cap extraction policy");
    expect(() => parsed(request("extract"), envelope(request("extract"), "length", partial, 512))).toThrow();
  });
  test("wrong output counts, phases, caps, refusal, content, identity, usage and transport cannot acquire the policy", () => {
    const req = request(), base = envelope(req), routing = base.providerMetadata.gateway.routing;
    const bad: unknown[] = [envelope(req, "length", partial, 511), envelope(req, "length", partial, 513),
      { ...base, choices: [{ ...base.choices[0], message: { role: "assistant", content: partial, refusal: "Synthetic refusal" } }] },
      { ...base, choices: [{ ...base.choices[0], message: { role: "assistant", content: {}, refusal: null } }] },
      { ...base, choices: [{ ...base.choices[0], message: { role: "assistant", content: partial, tool_calls: [{ id: "synthetic-tool" }] } }] },
      { ...base, model: "openai/gpt-4o" }, { ...base, providerMetadata: { gateway: { routing: { ...routing, finalProvider: "azure" } } } },
      { ...base, usage: { ...base.usage, total_tokens: 1 } }, { ...base, usage: undefined },
      { ...base, providerMetadata: { gateway: { routing, cost: "1000" } } }];
    for (const value of bad) expect(() => parsed(req, value)).toThrow();
    const { raw, reservation } = evidence(req);
    for (const changed of [{ ...raw, httpStatus: 500 }, { ...raw, bodyComplete: false }, { ...raw, transportError: "body-read" as const },
      { ...raw, requestSha256: hash("wrong") }, { ...raw, receivedBytes: raw.receivedBytes + 1 }]) {
      expect(() => parseGatewayStudyV6(req, reservation, changed)).toThrow();
    }
    expect(() => parseGatewayStudyV6({ ...req, phase: "judge" }, reservation, raw)).toThrow();
    expect(() => parseGatewayStudyV6({ ...req, maximumOutput: 1024 }, reservation, raw)).toThrow();
    expect(() => parseGatewayStudyV6(req, { ...reservation, micros: reservation.micros - 1 }, raw)).toThrow();
  });
  test("new invocations capture then settle exactly once and retain inherited exposure", async () => {
    const req = request(), prior = 18_268_639, order: string[] = [], events: GatewayStudyLedgerEvent[] = [], captured: GatewayStudyRaw[] = [];
    const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1, priorExposureMicros: prior });
    const result = await invokeGatewayStudyV6({ request: req, oidcToken: "synthetic-only", reservationId: "synthetic", budget,
      record: async event => { events.push(event); order.push(event.kind); }, capture: async raw => { captured.push(raw); order.push("capture"); },
      fetcher: async () => { order.push("fetch"); return Response.json(envelope(req)); } });
    expect(order).toEqual(["reserved", "fetch", "capture", "settled"]); expect(captured).toHaveLength(1);
    expect(events.map(event => event.kind)).toEqual(["reserved", "settled"]);
    expect(budget.summary.accountedUsd).toBe((prior + result.usage.micros) / 1e6);
    expect(budget.summary.priorAmendmentExposureUsd).toBe(prior / 1e6);
    expect(budget.summary.unresolvedThisRunUsd).toBe(0);
  });
  test("failure outside the class or durable capture failure retains the new reservation without retry", async () => {
    for (const failure of ["capture", "judge-length"] as const) {
      const req = request(failure === "judge-length" ? "judge" : "reader"), events: GatewayStudyLedgerEvent[] = [];
      const budget = new GatewayStudyBudget({ maxUsd: 40, maxCalls: 1 }); let calls = 0;
      await expect(invokeGatewayStudyV6({ request: req, oidcToken: "synthetic-only", reservationId: "synthetic", budget,
        record: async event => { events.push(event); }, capture: async () => { if (failure === "capture") throw new Error("synthetic disk failure"); },
        fetcher: async () => { calls++; return Response.json(envelope(req)); } })).rejects.toThrow();
      expect(calls).toBe(1); expect(events.map(event => event.kind)).toEqual(["reserved"]); expect(budget.summary.unresolvedThisRunUsd).toBeGreaterThan(0);
    }
  });
});

describe("Gateway v6 reader outcomes and original-ordinal judge ownership", () => {
  test("terminal rows contain no prediction/tokenF1 and cannot be transplanted or passed to other phases", async () => {
    const f = await fixture(1, (_s, _f, ordinal) => ordinal === 0), failure = f.readerRows[0]!;
    expect(failure).toMatchObject({ status: "terminal-reader-failure", reason: "output-token-limit", policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256 });
    expect(failure).not.toHaveProperty("prediction"); expect(failure).not.toHaveProperty("tokenF1"); expect(JSON.stringify(failure)).not.toContain(partial);
    const job = f.readerJobs[0]!, response = failure.response;
    for (const changed of [{ ...response, prediction: "Forged answer" }, { ...response, policySha256: hash("wrong") },
      { ...response, usage: { ...response.usage, outputTokens: 511 } }, { ...response, identity: { ...response.identity, finalProvider: "azure" } },
      { ...response, requestSha256: hash("wrong") }]) expect(() => completeGatewayV6Reader(job, f.questions[0]!, changed as any)).toThrow();
    expect(() => completeGatewayV6Reader(job, { ...f.questions[0]!, id: "wrong" }, response)).toThrow();
    expect(() => completeGatewayV6Extraction(job as any, response)).toThrow("outside reader phase");
    expect(() => completeGatewayV6Judge(job as any, response)).toThrow("outside reader phase");
    const ordinary = f.readerRows[1]!;
    expect(ordinary).toEqual(completeGatewayV5Reader(f.readerJobs[1]!, f.questions[0]!, ordinary.response as any));
  });
  test("a failure before identical answers owns no judge; aliases retain their original case ordinals", async () => {
    const f = await fixture(1, (_s, _f, ordinal) => ordinal === 0), scored = score(f);
    expect(scored.plan.jobs).toHaveLength(1); expect(scored.plan.jobs[0]!.ordinal).toBe(1);
    expect(scored.plan.cases[0]).toMatchObject({ kind: "reader-failure", ordinal: 0 });
    expect(scored.plan.cases[0]).not.toHaveProperty("jobKey"); expect(scored.plan.cases[0]).not.toHaveProperty("ownerOrdinal");
    expect(scored.plan.cases[1]).toMatchObject({ kind: "model", ordinal: 1, ownerOrdinal: 1 });
    expect(scored.plan.cases[2]).toMatchObject({ kind: "model", ordinal: 2, ownerOrdinal: 1 });
    expect(scored.caseOutcomes[0]).toMatchObject({ status: "terminal-reader-failure", correct: 0, decisionSource: "reader-failure-policy" });
    expect(scored.caseOutcomes[0]).not.toHaveProperty("requestSha256"); expect(scored.caseOutcomes[0]).not.toHaveProperty("reusedJudgment");
    expect(scored.caseOutcomes[2]).toMatchObject({ status: "completed", correct: 1, reusedJudgment: true, decisionSource: "model" });
  });
  test("without failures the physical requests and model decisions match the original judge plan", async () => {
    const f = await fixture(2), scored = score(f);
    const old = makeGatewayJudgePlan({ ...f, readerRows: f.readerRows as any });
    expect(scored.plan.jobs).toEqual(old.jobs);
    for (const [i, c] of scored.plan.cases.entries()) {
      expect(c).toMatchObject(old.cases[i]!);
      expect(completeGatewayJudge(scored.plan.jobs[0]!, scored.physicalJudgeRows[0]!.response)).toEqual(scored.physicalJudgeRows[0]!);
    }
  });
  test("all failure cases remain present and require zero physical judgments", async () => {
    const f = await fixture(1, () => true), scored = score(f);
    expect(scored.plan.jobs).toHaveLength(0); expect(scored.caseOutcomes).toHaveLength(3);
    expect(scored.caseOutcomes.every(row => row.status === "terminal-reader-failure" && row.correct === 0)).toBe(true);
    const result = assessGatewayV6Superiority({ ...f, ...scored, poolSize: 1 });
    expect(result.coverage).toEqual({ cases: 3, modelJudgedCases: 0, policyScoredReaderFailures: 3, physicalJudgeRequests: 0 });
    expect(result.criterionPassed).toBe(false);
    expect(result.adverse.comparisons?.["bm25-window"]?.observedDelta).toBe(-1);
    expect(result.adverse.comparisons?.["bm25-record-window"]?.observedDelta).toBe(-1);
    expect(result.robustToReaderFailureAssignments).toBe(false);
  });
  test("omitted rows, forged predictions, ordinal drift, failure aliases and reordered physical responses are rejected", async () => {
    const f = await fixture(2, (_s, _f, ordinal) => ordinal === 0), scored = score(f);
    expect(() => makeGatewayV6JudgePlan({ ...f, readerRows: f.readerRows.slice(1) })).toThrow();
    const changedRows = structuredClone(f.readerRows) as any[]; changedRows[1].prediction = "forged";
    expect(() => makeGatewayV6JudgePlan({ ...f, readerRows: changedRows })).toThrow("outcome drift");
    const changedJobs = structuredClone(f.readerJobs) as any[]; changedJobs[1].ordinal = 0;
    expect(() => makeGatewayV6JudgePlan({ ...f, readerJobs: changedJobs })).toThrow();
    for (const change of [(p: any) => { p.cases[0].jobKey = p.jobs[0].key; }, (p: any) => { p.cases[2].ownerOrdinal = 2; },
      (p: any) => { p.cases[0].policySha256 = hash("wrong"); }, (p: any) => { p.cases[1].ordinal = 0; }]) {
      const plan = structuredClone(scored.plan) as any; change(plan); plan.casesSha256 = canonicalSha256(plan.cases);
      expect(() => expandGatewayV6Judgments(plan, scored.physicalJudgeRows)).toThrow();
    }
    expect(() => expandGatewayV6Judgments(scored.plan, [...scored.physicalJudgeRows].reverse())).toThrow();
    expect(() => expandGatewayV6Judgments(scored.plan, scored.physicalJudgeRows.slice(1))).toThrow();
  });
});

describe("Gateway v6 strict scoring provenance and separate sensitivity", () => {
  test("forged policy grades, sources, reader failure hashes and omitted cases cannot enter statistics", async () => {
    const f = await fixture(1, (_s, _f, ordinal) => ordinal === 0), scored = score(f), input = { ...f, ...scored, poolSize: 1 };
    for (const change of [(r: any) => { r.correct = 1; }, (r: any) => { r.decisionSource = "model"; },
      (r: any) => { r.readerOutcomeSha256 = hash("wrong"); }, (r: any) => { r.status = "completed"; },
      (r: any) => { r.policySha256 = hash("wrong"); }, (r: any) => { r.jobKey = hash("fake-judge"); }]) {
      const rows = structuredClone(scored.caseOutcomes); change(rows[0]);
      expect(() => assessGatewayV6Superiority({ ...input, caseOutcomes: rows })).toThrow("provenance drift");
    }
    expect(() => assessGatewayV6Superiority({ ...input, caseOutcomes: scored.caseOutcomes.slice(1) })).toThrow();
    expect(() => assessGatewayV6Superiority({ ...input, selected: [{ ...f.selected[0]!, groupId: "wrong" }] })).toThrow("family order drift");
    const readerRows = structuredClone(f.readerRows) as GatewayReaderOutcomeV6[];
    (readerRows[0] as any).status = "completed";
    expect(() => assessGatewayV6Superiority({ ...input, readerRows })).toThrow("outcome drift");
  });
  test("a primary-only pass is exposed when candidate success depends on baseline failures scoring zero", async () => {
    const f = await fixture(20, system => system !== "oh-fact"), scored = score(f);
    const result = assessGatewayV6Superiority({ ...f, ...scored, poolSize: 20 });
    expect(result).toMatchObject({ criterionPassed: true, robustToReaderFailureAssignments: false,
      primary: { status: "completed", established: true }, adverse: { status: "completed", established: false },
      coverage: { cases: 60, policyScoredReaderFailures: 40, modelJudgedCases: 20 } });
    expect(scored.caseOutcomes.filter(row => row.decisionSource === "reader-failure-policy").every(row => row.status === "terminal-reader-failure" && row.correct === 0)).toBe(true);
    expect(result.failureCountsBySystem).toEqual({ "oh-fact": 0, "bm25-window": 20, "bm25-record-window": 20 });
  });
  test("robust evidence keeps ordinary decisions fixed, and no-failure results equal the unchanged assessor", async () => {
    const f = await fixture(20, (system, family) => family === 0 && system === "bm25-window", system => system === "oh-fact" ? "Candidate synthetic answer" : "Baseline synthetic answer");
    const scored = score(f, job => f.readerJobs[job.ordinal]!.native.system === "oh-fact" ? "yes" : "no");
    const result = assessGatewayV6Superiority({ ...f, ...scored, poolSize: 20 });
    expect(result.criterionPassed).toBe(true); expect(result.robustToReaderFailureAssignments).toBe(true);
    expect(result.primary.comparisons?.["bm25-window"]?.observedDelta).toBe(1);
    expect(result.adverse.comparisons?.["bm25-window"]?.observedDelta).toBe(0.95);
    const ordinary = await fixture(2), ordinaryScore = score(ordinary);
    const original = assessSuperiority(2, ordinary.selected, ordinaryScore.caseOutcomes);
    const unchanged = assessGatewayV6Superiority({ ...ordinary, ...ordinaryScore, poolSize: 2 });
    expect(unchanged.primary).toEqual(original); expect(unchanged.adverse).toEqual(original);
  });
});
