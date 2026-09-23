import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../src/canonical";
import { makeCloneMemChoiceMessages } from "../scripts/benchmarks/clonemem-dataset";
import { CLONEMEM_KEYWORD_DEV_PERSON_IDS as PEOPLE, CLONEMEM_KEYWORD_DEV_ARMS as ARMS,
  type CloneMemKeywordDevScorer } from "../scripts/benchmarks/clonemem-keyword-dev-source";
import { authenticateCloneMemKeywordDevelopment, decideCloneMemKeywordDevelopment,
  scoreCloneMemKeywordDevelopment } from "../scripts/benchmarks/clonemem-keyword-dev-report";
import type { EvolutionCampaign } from "../scripts/benchmarks/evolution-budget";
import { parseEvolutionResponse, type EvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { openEvolutionStore } from "../scripts/benchmarks/evolution-store";
import { collectPairedMemoryResult, makePairedMemoryPlan, selectPairedMemoryIds,
  type PairedMemorySource, type PairedMemoryResult } from "../scripts/benchmarks/paired-memory-study";

const roots: string[] = [];
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
const pin = (name: string) => ({ path: `/fixture/${name}`, sha256: sha256Hex(name) });
function raw(request: EvolutionRequest) {
  const answer = canonicalJson(request.body).includes("PRIVATE_candidate") ? " a \n" : "B";
  const body = Buffer.from(JSON.stringify({ model: request.model, choices: [{ index: 0, finish_reason: "stop",
    message: { role: "assistant", content: answer } }], usage: { prompt_tokens: 100, completion_tokens: 1, total_tokens: 101 },
    providerMetadata: { gateway: { routing: { finalProvider: request.provider, originalModelId: request.model,
      canonicalSlug: request.model, resolvedProviderApiModelId: "gpt-4o-mini" } } } }));
  return { body, httpStatus: 200, complete: true, receivedBytes: body.length, error: null, serviceMs: 1 } as const;
}
function fixture(storeDirectory = "/fixture/store") {
  const population = PEOPLE.flatMap((groupId, index) => Array.from({ length: [114, 32][index]! }, (_, n) => ({ questionId: `${groupId}:${n}`, groupId })));
  const source: PairedMemorySource = { protocol: "oh.memory.paired-source.v1", datasetRevision: "a".repeat(40), arms: ARMS,
    selection: { algorithm: "clonemem-balanced-sha256-v1", seed: 17, population, count: 146 },
    questions: selectPairedMemoryIds(population, 17, 146).map(id => ({ id, groupId: population.find(row => row.questionId === id)!.groupId,
      personName: "Fixture", question: "PRIVATE_question", questionDate: "2023-01-01",
      choices: [{ id: "A", text: "First" }, { id: "B", text: "Second" }], contexts: ARMS.map((armId, i) => ({ armId, text: `PRIVATE_${i ? "candidate" : "baseline"}` })) })) };
  const scorer: CloneMemKeywordDevScorer = { protocol: "oh.clonemem-keyword-dev-scorer.v1", sourceRevision: source.datasetRevision,
    sourceSha256: canonicalSha256(source), rows: source.questions.map(q => ({ questionId: q.id, personId: q.groupId,
      category: "native", correctChoiceId: "A", evidenceGroups: [["gold-trace"]] })) };
  const rankRows = source.questions.map(q => ({ questionId: q.id, personId: q.groupId, originalResultSha256: sha256Hex("original"),
    candidateResultSha256: sha256Hex("candidate"), semanticCaptureSha256: sha256Hex("capture"), eligibleTraceIdsSha256: sha256Hex("eligible"),
    arms: q.contexts.map((context, i) => ({ armId: context.armId, traceIds: [i ? "gold-trace" : "irrelevant"],
      contextSha256: sha256Hex(context.text), contextBytes: Buffer.byteLength(context.text) })) }));
  const campaign: EvolutionCampaign = { protocol: "oh.memory.evolution-campaign.v1", campaignId: "keyword-report-fixture", storeDirectory,
    approval: "Synthetic offline fixture", additionalBudgetMicros: 5_000_000, maximumCalls: 876,
    historicalExposureMicros: 0, historicalLedgers: [{ ...pin("history"), bytes: 0 }], authAuthority: pin("auth") };
  const plan = makePairedMemoryPlan({ source, sourcePin: pin("source"), scorerPin: pin("scorer"), promptPin: pin("prompt"),
    campaignPin: pin("campaign"), campaign, readerProfile: "gpt4o-mini-clonemem-choice-v1-reader", renderMessages: makeCloneMemChoiceMessages });
  const responses = plan.jobs.map(job => parseEvolutionResponse(raw(job.request).body, job.request));
  const outcomes = plan.jobs.map((job, index) => ({ jobKey: job.key, disposition: responses[index]!.status,
    answerSha256: sha256Hex(responses[index]!.answer!), rawSha256: responses[index]!.rawSha256,
    chargeMicros: responses[index]!.usage.micros, serviceMs: 1 }));
  const charge = outcomes.reduce((sum, row) => sum + row.chargeMicros, 0);
  const result: PairedMemoryResult = { protocol: "oh.memory.paired-result.v1", planSha256: canonicalSha256(plan), halt: "none", outcomes,
    ledger: { calls: outcomes.length, exposureMicros: charge, confirmedMicros: charge, unresolvedMicros: 0,
      additionalBudgetMicros: 5_000_000, maximumCalls: 876, historicalExposureMicros: 0, combinedExposureMicros: charge } };
  return { source, scorer, rankRows, plan, result, campaign,
    answers: plan.jobs.map((job, index) => ({ jobKey: job.key, answer: responses[index]!.answer })) };
}

test("new arm IDs, full146 native recall and three-repeat MC scoring produce private-free aggregates", () => {
  const value = fixture(), { publicSummary: report } = scoreCloneMemKeywordDevelopment(value);
  expect(report).toMatchObject({ questions: 146, logicalCases: 876, matrixComplete: true,
    reader: { primary: { baseline: 0, candidate: 1, delta: 1, wins: 146 } },
    retrieval: { evaluableQuestions: 146, primary: { baseline: 0, candidate: 1 } },
    decision: { advanceToSeparateConfirmation: true, confirmedImprovement: false } });
  expect(report.reader.byPersona.map(row => row.questions)).toEqual([114, 32]);
  expect(report.reader.arms.map(row => row.cases)).toEqual([438, 438]);
  expect(report.reader.byRepeat.map(row => row.arms[1]!.correct)).toEqual([146, 146, 146]);
  expect(canonicalJson(report)).not.toContain("PRIVATE_");
  for (const id of PEOPLE) expect(canonicalJson(report)).not.toContain(id);
});

test("missing or duplicated cells, response hashes, rank/context drift and old arm substitution fail", () => {
  const value = fixture();
  expect(() => scoreCloneMemKeywordDevelopment({ ...value, answers: value.answers.slice(1) })).toThrow("coverage");
  expect(() => scoreCloneMemKeywordDevelopment({ ...value, answers: value.answers.map((row, i) => i ? row : { ...row, answer: "tampered" }) })).toThrow("custody");
  expect(() => scoreCloneMemKeywordDevelopment({ ...value, rankRows: value.rankRows.map((row, i) => i ? row : { ...row,
    arms: row.arms.map(arm => ({ ...arm, contextSha256: sha256Hex("drift") })) }) })).toThrow("context");
  expect(() => scoreCloneMemKeywordDevelopment({ ...value, scorer: { ...value.scorer, rows: [...value.scorer.rows.slice(1), value.scorer.rows[1]!] } })).toThrow("coverage");
  expect(() => scoreCloneMemKeywordDevelopment({ ...value, source: { ...value.source, arms: ["raw-vector", "oh-hybrid"] } })).toThrow();
  const plan = { ...value.plan, cases: [value.plan.cases[1]!, ...value.plan.cases.slice(1)] };
  expect(() => scoreCloneMemKeywordDevelopment({ ...value, plan, result: { ...value.result, planSha256: canonicalSha256(plan) } })).toThrow("identity");
});

test("known failure keeps denominator; unattempted case and missing evidence veto advancement", () => {
  for (const status of ["failed", "unattempted"] as const) {
    const v = fixture(), key = v.plan.jobs[0]!.key, prior = v.result.outcomes[0]!.chargeMicros;
    const outcomes = v.result.outcomes.map((row, i) => i ? row : { ...row, disposition: status, answerSha256: null,
      ...(status === "unattempted" ? { rawSha256: null, serviceMs: null, chargeMicros: 0 } : {}) });
    const charge = v.result.ledger.exposureMicros - (status === "unattempted" ? prior : 0);
    const result = { ...v.result, outcomes, ledger: { ...v.result.ledger, calls: v.plan.jobs.length - (status === "unattempted" ? 1 : 0),
      exposureMicros: charge, confirmedMicros: charge, combinedExposureMicros: charge } };
    const report = scoreCloneMemKeywordDevelopment({ ...v, result, answers: v.answers.map(a => a.jobKey === key ? { ...a, answer: null } : a) }).publicSummary;
    expect(report.reader.arms.map(row => row.cases)).toEqual([438, 438]);
    expect(report.failedLogicalCases).toBeGreaterThan(0);
    expect(report.matrixComplete).toBe(status === "failed");
    expect(report.decision.advanceToSeparateConfirmation).toBeFalse();
  }
  const v = fixture(), scorer = { ...v.scorer, rows: v.scorer.rows.map((row, i) => i ? row : { ...row, evidenceGroups: [] }) };
  const report = scoreCloneMemKeywordDevelopment({ ...v, scorer }).publicSummary;
  expect(report.retrieval.evaluableQuestions).toBe(145); expect(report.retrieval.missingEvidenceQuestions).toBe(1);
  expect(report.decision.advanceToSeparateConfirmation).toBeFalse();
});

test("advancement requires3pp, nonnegative QA and positive recall in each persona", () => {
  const value = { readerDelta: .03, personaReaderDeltas: [0, .1], recallDelta: .01, personaRecallDeltas: [.01, .01],
    recallQuestions: 146, matrixComplete: true, failedLogicalCases: 0 };
  expect(decideCloneMemKeywordDevelopment(value).advanceToSeparateConfirmation).toBeTrue();
  for (const update of [{ readerDelta: .029 }, { personaReaderDeltas: [-.01, .1] }, { recallDelta: 0 },
    { personaRecallDeltas: [.1, 0] }, { matrixComplete: false }, { failedLogicalCases: 1 }]) {
    expect(decideCloneMemKeywordDevelopment({ ...value, ...update }).advanceToSeparateConfirmation).toBeFalse();
  }
});

test("immutable native authentication rejects active stores and self-consistently altered settled projections", async () => {
  const path = await realpath(await mkdtemp(join(tmpdir(), "oh-keyword-report-"))); roots.push(path);
  const value = fixture(path), store = await openEvolutionStore({ directory: path, campaign: value.campaign });
  for (const job of value.plan.jobs) {
    store.admit(job.request, job.repeat); store.capture(job.request, raw(job.request), job.repeat); store.finalize(job.request, job.repeat);
  }
  const result = collectPairedMemoryResult(value.plan, store, "none"); await store.close();
  const databasePath = join(path, "campaign.sqlite");
  const databasePin = { path: databasePath, sha256: sha256Hex(await readFile(databasePath)) };
  const native = await authenticateCloneMemKeywordDevelopment(value.plan, result, value.campaign, databasePin);
  expect(native.size).toBe(value.plan.jobs.length);
  expect(sha256Hex(await readFile(databasePath))).toBe(databasePin.sha256);
  await writeFile(join(path, "active.lock"), "synthetic", { mode: 0o600 });
  await expect(authenticateCloneMemKeywordDevelopment(value.plan, result, value.campaign, databasePin)).rejects.toThrow("closed");
  await rm(join(path, "active.lock"));
  const db = new Database(databasePath);
  const row = db.query<{ key: string; result: string }, []>("SELECT key,result FROM jobs LIMIT 1").get()!;
  const response = JSON.parse(row.result); response.answer = "altered";
  db.query("UPDATE jobs SET result=? WHERE key=?").run(JSON.stringify(response), row.key); db.close();
  const changedPin = { path: databasePath, sha256: sha256Hex(await readFile(databasePath)) };
  await expect(authenticateCloneMemKeywordDevelopment(value.plan, result, value.campaign, changedPin)).rejects.toThrow("response");
});
