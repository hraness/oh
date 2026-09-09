import { describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { OhSqliteStore } from "../src/sqlite/store";
import type { Dataset } from "../scripts/benchmarks/datasets";
import { CLAUDE_JUDGE_SYSTEM } from "../scripts/benchmarks/claude-study-plan";
import { makeGatewayStudyRequest } from "../scripts/benchmarks/gateway-study-transport-v3";
import { GATEWAY_READER_FAILURE_V6_POLICY_SHA256, type GatewayStudyV6Result } from "../scripts/benchmarks/gateway-study-transport-v6";
import { buildJudgePrompt, loadJudgeProfile } from "../scripts/benchmarks/judge";
import { createLabDiverse } from "../scripts/benchmarks/lab-diverse";
import { createLabFusion } from "../scripts/benchmarks/lab-fusion";
import { createLabMemory } from "../scripts/benchmarks/lab-memory";
import { createLabSession } from "../scripts/benchmarks/lab-session";
import { makeLabPaidReaderPlan, validateLabPaidReaderPlan, makeLabPaidJudgePlan, scoreLabPaidJudgePlan,
  type LabPaidJob, type LabPaidJudgePlan } from "../scripts/benchmarks/lab-paid-plan";
import type { LabSystem, LabVariant } from "../scripts/benchmarks/lab";
import { answerMessages } from "../scripts/benchmarks/model";
import { createRetrievers, type System } from "../scripts/benchmarks/retrieval";

const namespace = sha256Hex("synthetic-paid-plan-namespace");
function fixture(): Dataset {
  return { corpora: [{ id: "corpus", groupId: "group", turns: [
    { id: "one", sessionId: "S", sessionIndex: 0, date: "2026-01-01", speaker: "User", text: "Mira owns a crimson bicycle." },
    { id: "two", sessionId: "S", sessionIndex: 0, date: "2026-01-01", speaker: "User", text: "It is kept in the shed." },
  ] }], questions: [{ id: "q1", corpusId: "corpus", category: "single-session-user", question: "What bicycle does Mira own?",
    questionDate: "2026-01-02", answer: "crimson", unanswerable: false, evidenceTurnIds: ["one"], evidenceSessionIds: ["S"] }] };
}
const variant = (id: string, system: LabSystem = "bm25-focused"): LabVariant => ({ id, system, budget: { topK: 20, contextBytes: 12_000 } });
const aliases = [variant("raw-a"), variant("raw-b")];
/** Synthetic stand-in for a response already authenticated by cache raw replay. */
function response(job: LabPaidJob, prediction = "crimson"): GatewayStudyV6Result {
  return { kind: "completed", finishReason: "stop", prediction, requestSha256: job.request.requestSha256,
    rawSha256: sha256Hex(`synthetic:${prediction}`), rawBytes: 123,
    usage: { inputTokens: 20, cachedInputTokens: 0, outputTokens: 2, tokenRateMicros: 12, gatewayReportedMicros: null,
      micros: 12, costBasis: "token-rate-estimate", billedUsd: null },
    identity: { requestedModel: job.request.model, reportedModel: job.request.model, resolvedProviderApiModelId: null,
      resolvedSnapshot: null, snapshotPinned: false, finalProvider: "openai", reportedModelAttemptCount: 1,
      reportedProviderAttemptCount: 1, physicalAttemptCount: null } };
}
function failure(job: LabPaidJob): GatewayStudyV6Result {
  const ordinary = response(job);
  const { kind: _kind, prediction: _prediction, finishReason: _finish, ...base } = ordinary as Extract<GatewayStudyV6Result, { kind: "completed" }>;
  return { ...base, usage: { ...base.usage, outputTokens: 512 }, kind: "terminal-reader-failure", finishReason: "length",
    reason: "output-token-limit", policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256 };
}
function reseal<T extends { planSha256: string; casesSha256: string; cases: readonly unknown[] }>(plan: T): T {
  const { planSha256: _old, ...payload } = plan;
  const next = { ...payload, casesSha256: canonicalSha256(plan.cases) };
  return { ...next, planSha256: canonicalSha256(next) } as unknown as T;
}

describe("paid development request planning", () => {
  test("builds the complete ordered reader matrix while exact request aliases have one physical owner", async () => {
    const dataset = fixture();
    const two = { corpora: [{ ...dataset.corpora[0]!, id: "corpus2", groupId: "group2" }, ...dataset.corpora],
      questions: [dataset.questions[0]!, { ...dataset.questions[0]!, id: "q2", corpusId: "corpus2", answer: "different gold" }] };
    const input = aliases.map(v => ({ ...v, budget: { ...v.budget } }));
    const plan = await makeLabPaidReaderPlan(two, input, namespace);
    expect(plan.cases.map(c => [c.ordinal, c.questionId, c.variant])).toEqual([[0, "q1", "raw-a"], [1, "q1", "raw-b"], [2, "q2", "raw-a"], [3, "q2", "raw-b"]]);
    expect(plan.jobs).toHaveLength(1);
    expect(plan.cases.map(c => c.groupId)).toEqual(["group", "group", "group2", "group2"]);
    expect(plan.jobs[0]!.ordinal).toBe(0);
    expect(plan.jobs[0]!.key).toBe(canonicalSha256({ namespaceSha256: namespace, requestSha256: plan.jobs[0]!.request.requestSha256 }));
    expect(new Set(plan.cases.map(c => c.jobKey)).size).toBe(1);
    expect(Object.isFrozen(plan.jobs[0]!.request.body.messages)).toBe(true);
    expect(Object.isFrozen(plan.cases[0])).toBe(true);
    input[0]!.budget.topK = 1;
    expect(plan.variants[0]!.budget.topK).toBe(20);
    const renamed = await makeLabPaidReaderPlan(dataset, [variant("renamed-a"), variant("renamed-b")], namespace);
    expect(renamed.jobs[0]!.key).toBe(plan.jobs[0]!.key);
    const changed = await makeLabPaidReaderPlan(dataset, aliases, sha256Hex("new namespace"));
    expect(changed.jobs[0]!.key).not.toBe(plan.jobs[0]!.key);
  });

  test("pre-dispatch validation rejects changed case and request aliases without rebuilding retrieval", async () => {
    const dataset = fixture(), plan = await makeLabPaidReaderPlan(dataset, [variant("raw"), variant("empty", "no-memory")], namespace);
    const serialized = JSON.stringify(plan), closed = spyOn(OhSqliteStore.prototype, "close");
    try {
      expect(() => validateLabPaidReaderPlan(dataset, JSON.parse(serialized))).not.toThrow();
      const caseDrift = reseal({ ...plan, cases: plan.cases.map((c, i) => i === 0 ? { ...c, questionId: "other-question" } : c) });
      expect(() => validateLabPaidReaderPlan(dataset, caseDrift)).toThrow("reader matrix alias drift");
      const other = plan.jobs[1]!;
      const requestDrift = reseal({ ...plan, cases: plan.cases.map((c, i) => i === 0
        ? { ...c, jobKey: other.key, requestSha256: other.request.requestSha256 } : c) });
      expect(() => validateLabPaidReaderPlan(dataset, requestDrift)).toThrow("reader context/request alias binding");
      expect(closed.mock.calls.length).toBe(0);
      expect(JSON.stringify(plan)).toBe(serialized);
    } finally { closed.mockRestore(); }
  });

  test("never reads gold or evidence getters during reader planning and closes native stores before return", async () => {
    const original = fixture(), raw = { ...original.corpora[0]!.turns[0]! }, q = { ...original.questions[0]! };
    let reads = 0;
    const forbidden = { enumerable: true, get() { reads += 1; throw new Error("Gold was read."); } };
    for (const key of ["answer", "unanswerable", "evidenceTurnIds", "evidenceSessionIds"]) Object.defineProperty(q, key, forbidden);
    for (const key of ["answer", "has_answer"]) Object.defineProperty(raw, key, forbidden);
    const dataset = { corpora: [{ ...original.corpora[0]!, turns: [raw] }], questions: [q] };
    const closed = spyOn(OhSqliteStore.prototype, "close"), rawClosed = spyOn(Database.prototype, "close");
    try {
      const plan = await makeLabPaidReaderPlan(dataset, [variant("native", "oh-memory-api"), variant("raw")], namespace);
      expect(reads).toBe(0);
      // Native canonical/working authorities, plus native and shared raw indexes.
      expect(closed.mock.calls.length).toBe(2);
      expect(rawClosed.mock.calls.length).toBe(4);
      expect(plan.jobs).toHaveLength(1);
      expect(Object.keys(JSON.parse(plan.jobs[0]!.request.body.messages[1]!.content))).toEqual(["question", "questionDate", "memory"]);
      expect(Object.keys(plan.cases[0]!)).not.toContain("answer");
      expect(Object.keys(plan.cases[0]!)).not.toContain("retrievedTurns");
    } finally { closed.mockRestore(); rawClosed.mockRestore(); }
  });

  test("uses byte-identical contexts and canonical requests for every supported lab adapter", async () => {
    const dataset = fixture(), corpus = dataset.corpora[0]!, q = dataset.questions[0]!;
    const shared = createRetrievers(corpus), session = createLabSession(corpus), native = await createLabMemory(corpus);
    const fusion = createLabFusion(corpus, shared), diverse = createLabDiverse(corpus, shared);
    const systems: LabSystem[] = ["bm25-focused", "bm25-session", "bm25-fusion", "bm25-diverse-window", "oh-memory-api", "full-context", "no-memory"];
    try {
      for (const system of systems) {
        const selected = [variant(system, system), variant("control")];
        const plan = await makeLabPaidReaderPlan(dataset, selected, namespace), budget = selected[0]!.budget;
        const expected = system === "bm25-session" ? await session.retrieve(q.question, budget)
          : system === "bm25-fusion" ? await fusion.retrieve(q.question, budget)
          : system === "bm25-diverse-window" ? await diverse.retrieve(q.question, budget)
          : system === "oh-memory-api" ? await native.retrieve(q.question, budget)
          : await shared.retrieve(system as System, q.question, budget);
        const request = makeGatewayStudyRequest({ phase: "reader", messages: answerMessages(q, expected.context) });
        expect(plan.cases[0]!.contextSha256).toBe(sha256Hex(expected.context));
        expect(plan.cases[0]!.contextBytes).toBe(Buffer.byteLength(expected.context));
        expect(plan.jobs.find(j => j.key === plan.cases[0]!.jobKey)!.request).toEqual(request);
      }
    } finally { await native.close(); session.close(); shared.close(); }
  });

  test("closes stores when request planning fails and rejects unsupported or ambiguous selections", async () => {
    const dataset = fixture(), closed = spyOn(OhSqliteStore.prototype, "close"), rawClosed = spyOn(Database.prototype, "close");
    try {
      const excessive = { ...dataset, corpora: [{ ...dataset.corpora[0]!, turns: Array.from({ length: 3 }, (_, i) => ({
        ...dataset.corpora[0]!.turns[0]!, id: `turn-${i}`, text: "x".repeat(400_000) })) }] };
      await expect(makeLabPaidReaderPlan(excessive, [variant("full", "full-context"), variant("raw")], namespace)).rejects.toThrow("context bound");
      expect(closed).not.toHaveBeenCalled();
      expect(rawClosed.mock.calls.length).toBe(1);
    } finally { closed.mockRestore(); rawClosed.mockRestore(); }
    await expect(makeLabPaidReaderPlan(dataset, [aliases[0]!], namespace)).rejects.toThrow("two or three");
    await expect(makeLabPaidReaderPlan(dataset, [aliases[0]!, aliases[0]!], namespace)).rejects.toThrow("duplicate variant");
    await expect(makeLabPaidReaderPlan(dataset, [variant("fact", "oh-fact"), variant("raw")], namespace)).rejects.toThrow("unsupported fact");
    await expect(makeLabPaidReaderPlan(dataset, [variant("raw"), { ...variant("bad"), budget: { topK: 101, contextBytes: 12_000 } }], namespace)).rejects.toThrow("budget");
    await expect(makeLabPaidReaderPlan(dataset, aliases, "bad")).rejects.toThrow("namespace");
    await expect(makeLabPaidReaderPlan({ ...dataset, questions: [dataset.questions[0]!, dataset.questions[0]!] }, aliases, namespace)).rejects.toThrow("duplicate");
  });

  test("separate judge stage uses native gold prompt, aliases equal requests, and expands every case", async () => {
    const dataset = fixture(), reader = await makeLabPaidReaderPlan(dataset, aliases, namespace);
    const readers = new Map(reader.jobs.map(j => [j.key, response(j)]));
    const judge = await makeLabPaidJudgePlan(dataset, reader, readers), profile = await loadJudgeProfile();
    expect(judge.cases).toHaveLength(2);
    expect(judge.jobs).toHaveLength(1);
    const request = makeGatewayStudyRequest({ phase: "judge", messages: [{ role: "system", content: CLAUDE_JUDGE_SYSTEM },
      { role: "user", content: buildJudgePrompt(dataset.questions[0]!, "crimson", profile) }] });
    expect(judge.jobs[0]!.request).toEqual(request);
    expect(judge.judgeProfileSha256).toBe(profile.sha256);
    const scored = scoreLabPaidJudgePlan(judge, new Map(judge.jobs.map(j => [j.key, response(j, "Yes.")])));
    expect(scored.map(c => [c.ordinal, c.variant, c.correct, c.decisionSource, c.reusedJudgment]))
      .toEqual([[0, "raw-a", 1, "model", false], [1, "raw-b", 1, "model", true]]);
    expect(Object.isFrozen(scored)).toBe(true);
    expect(Object.isFrozen(scored[0])).toBe(true);
    const changedGold = { ...dataset, questions: [{ ...dataset.questions[0]!, answer: "different gold" }] };
    const differentJudge = await makeLabPaidJudgePlan(changedGold, reader, readers);
    expect(differentJudge.jobs[0]!.key).not.toBe(judge.jobs[0]!.key);
  });

  test("terminal reader failures preserve the denominator without gold reads, prediction or judge jobs", async () => {
    const dataset = fixture(), reader = await makeLabPaidReaderPlan(dataset, aliases, namespace);
    const question = { ...dataset.questions[0]! };
    Object.defineProperty(question, "answer", { get() { throw new Error("Failure must not read gold."); } });
    Object.defineProperty(question, "unanswerable", { get() { throw new Error("Failure must not classify gold."); } });
    const judge = await makeLabPaidJudgePlan({ ...dataset, questions: [question] }, reader,
      new Map(reader.jobs.map(j => [j.key, failure(j)])));
    expect(judge.jobs).toEqual([]);
    expect(judge.cases).toHaveLength(2);
    const scored = scoreLabPaidJudgePlan(judge, new Map());
    expect(scored.every(c => c.correct === 0 && c.decisionSource === "reader-failure-policy" && c.status === "terminal-reader-failure")).toBe(true);
    expect(scored.every(c => !Object.hasOwn(c, "prediction") && !Object.hasOwn(c, "jobKey"))).toBe(true);
  });

  test("mixed ordinary and terminal reader outcomes retain both cases in complete scoring", async () => {
    const dataset = fixture(), reader = await makeLabPaidReaderPlan(dataset, [variant("raw"), variant("empty", "no-memory")], namespace);
    expect(reader.jobs).toHaveLength(2);
    const judge = await makeLabPaidJudgePlan(dataset, reader,
      new Map(reader.jobs.map((j, index) => [j.key, index === 0 ? response(j) : failure(j)])));
    expect(judge.jobs).toHaveLength(1);
    expect(judge.cases.map(c => c.kind)).toEqual(["model", "reader-failure"]);
    const scored = scoreLabPaidJudgePlan(judge, new Map(judge.jobs.map(j => [j.key, response(j, "yes")])));
    expect(scored.map(c => [c.variant, c.correct, c.decisionSource]))
      .toEqual([["raw", 1, "model"], ["empty", 0, "reader-failure-policy"]]);
  });

  test("rejects missing/extra or transplanted reader responses and malformed complete matrices", async () => {
    const dataset = fixture(), reader = await makeLabPaidReaderPlan(dataset, aliases, namespace), j = reader.jobs[0]!;
    await expect(makeLabPaidJudgePlan(dataset, reader, new Map())).rejects.toThrow("missing or extra");
    await expect(makeLabPaidJudgePlan(dataset, reader, new Map([[j.key, response(j)], [sha256Hex("extra"), response(j)]]))).rejects.toThrow("missing or extra");
    await expect(makeLabPaidJudgePlan(dataset, reader, new Map([[j.key, { ...response(j), requestSha256: sha256Hex("other") }]]))).rejects.toThrow("identity");
    await expect(makeLabPaidJudgePlan(dataset, reader, new Map([[j.key, { ...failure(j), policySha256: sha256Hex("other") } as GatewayStudyV6Result]]))).rejects.toThrow("policy");
    for (const cases of [reader.cases.slice(1), [reader.cases[0]!, reader.cases[0]!]]) {
      const invalid = reseal({ ...reader, cases });
      await expect(makeLabPaidJudgePlan(dataset, invalid, new Map([[j.key, response(j)]]))).rejects.toThrow();
    }
    const invalid = structuredClone(reader);
    (invalid.jobs[0] as { phase: string }).phase = "judge";
    await expect(makeLabPaidJudgePlan(dataset, reseal(invalid), new Map([[j.key, response(j)]]))).rejects.toThrow("phase");
  });

  test("scoring rejects dropped or duplicated judge cases, missing aliases, wrong requests and invalid decisions", async () => {
    const dataset = fixture(), reader = await makeLabPaidReaderPlan(dataset, aliases, namespace);
    const judge = await makeLabPaidJudgePlan(dataset, reader, new Map(reader.jobs.map(j => [j.key, response(j)])));
    const j = judge.jobs[0]!, responses = new Map([[j.key, response(j, "no")]]);
    expect(scoreLabPaidJudgePlan(judge, responses).map(c => c.correct)).toEqual([0, 0]);
    expect(() => scoreLabPaidJudgePlan(judge, new Map())).toThrow("missing or extra");
    expect(() => scoreLabPaidJudgePlan(judge, new Map([[j.key, response(j, "possibly")]]))).toThrow("decision");
    expect(() => scoreLabPaidJudgePlan(judge, new Map([[j.key, { ...response(j, "yes"), requestSha256: sha256Hex("wrong") }]]))).toThrow("identity");
    expect(() => scoreLabPaidJudgePlan(reseal({ ...judge, cases: judge.cases.slice(1) }), responses)).toThrow();
    expect(() => scoreLabPaidJudgePlan(reseal({ ...judge, cases: [judge.cases[0]!, judge.cases[0]!] }), responses)).toThrow();
    const forged = structuredClone(judge) as LabPaidJudgePlan;
    (forged.cases[1] as { ownerOrdinal: number }).ownerOrdinal = 1;
    expect(() => scoreLabPaidJudgePlan(reseal(forged), responses)).toThrow("ownership");
  });
});
