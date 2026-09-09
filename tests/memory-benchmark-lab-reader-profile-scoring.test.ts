import { expect, spyOn, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { Dataset } from "../scripts/benchmarks/datasets";
import { CLAUDE_JUDGE_SYSTEM } from "../scripts/benchmarks/claude-study-plan";
import { makeGatewayStudyRequest } from "../scripts/benchmarks/gateway-study-transport-v3";
import { GATEWAY_READER_FAILURE_V6_POLICY_SHA256 } from "../scripts/benchmarks/gateway-study-transport-v6";
import { labReaderMessages } from "../scripts/benchmarks/lab-paid-reader";
import type { LabPaidJob, LabPaidReaderCase, LabPaidReaderPlan } from "../scripts/benchmarks/lab-paid-plan";
import * as judge from "../scripts/benchmarks/judge";
import { parseReaderJudge, reserveReaderJudge, type FrozenJudgeRequest, type LabReaderJudgeRequest, type LabReaderJudgeResult } from "../scripts/benchmarks/lab-reader-profile-judge";
import type { LabReaderResult } from "../scripts/benchmarks/lab-reader-profile";
import { LAB_READER_PROFILE_VARIANTS, makeLabReaderProfilePlan } from "../scripts/benchmarks/lab-reader-profile-plan";
import { LAB_GPT5_MINI_MEDIUM_READER_FAILURE_POLICY_SHA256, LAB_GPT5_MINI_READER_FAILURE_POLICY_SHA256, makeLabReaderProfileJudgePlan, scoreLabReaderProfileJudgePlan, type ProfileJudgePlan } from "../scripts/benchmarks/lab-reader-profile-scoring";

function seal<T extends { cases: readonly unknown[] }>(value: T) {
  const { planSha256: _old, ...payload } = value as T & { planSha256?: string };
  const next = { ...payload, casesSha256: canonicalSha256(value.cases) };
  return { ...next, planSha256: canonicalSha256(next) };
}
function fixture(count = 2, readerProfile: "minimal" | "medium" = "minimal") {
  const dataset: Dataset = { corpora: [{ id: "c", groupId: "group", turns: [{ id: "t", sessionId: "s", date: "2026-01-01", speaker: "user", text: "Bicycle is red." }] }],
    questions: Array.from({ length: count }, (_, i) => ({ id: `q${i}`, corpusId: "c", category: "single-session-user", question: `Bicycle color, question ${i}?`, questionDate: "2026-01-01", answer: "red", unanswerable: false, evidenceTurnIds: ["t"], evidenceSessionIds: ["s"] })) };
  const variants = [{ id: LAB_READER_PROFILE_VARIANTS[0], system: "bm25-window" as const, budget: { topK: 20, contextBytes: 24000 } },
    { id: LAB_READER_PROFILE_VARIANTS[1], system: "bm25-user-hybrid" as const, budget: { topK: 100, contextBytes: 24000 } }];
  const namespaceSha256 = sha256Hex("parent"), jobs: LabPaidJob[] = [], cases: LabPaidReaderCase[] = [];
  for (const question of dataset.questions) for (const variant of variants) {
    const context = `Bicycle is red. ${variant.system}`;
    const request = makeGatewayStudyRequest({ phase: "reader", messages: labReaderMessages(question, context, "question-last-v1") });
    const key = canonicalSha256({ namespaceSha256, requestSha256: request.requestSha256 });
    jobs.push({ key, ordinal: 0, phase: "reader", request });
    cases.push({ ordinal: cases.length, questionId: question.id, corpusId: "c", groupId: "group", category: question.category,
      system: variant.system, variant: variant.id, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context), requestSha256: request.requestSha256, jobKey: key });
  }
  const parent: LabPaidReaderPlan = seal({ profile: "oh.lab-paid-reader-plan.v2" as const, readerPolicy: "question-last-v1" as const, namespaceSha256, variants, cases, jobs });
  const reader = makeLabReaderProfilePlan(dataset, parent, sha256Hex("new-reader"), readerProfile);
  const responses = new Map(reader.jobs.map(j => [j.key, response(j.request, "red") as LabReaderResult]));
  return { dataset, parent, reader, responses };
}
/** Bytes traverse actual accepted parsers, with no provider calls. */
function response(request: LabReaderJudgeRequest, prediction: string, length = false): LabReaderJudgeResult {
  const reader = !("phase" in request), model = reader ? "openai/gpt-5-mini" : "openai/gpt-4o";
  const body = new TextEncoder().encode(JSON.stringify({ model, choices: [{ index: 0, finish_reason: length ? "length" : "stop", message: { role: "assistant", content: prediction } }],
    usage: { prompt_tokens: 10, completion_tokens: length ? 9 : 2, total_tokens: length ? 19 : 12 },
    providerMetadata: { gateway: { routing: { finalProvider: "openai", originalModelId: model, canonicalSlug: model, resolvedProviderApiModelId: reader ? "gpt-5-mini" : "gpt-4o-2024-08-06" } } } }));
  return parseReaderJudge(request, reserveReaderJudge(request, "fixture"), { requestSha256: request.requestSha256, httpStatus: 200,
    body, bodyComplete: true, receivedBytes: body.byteLength, transportError: null });
}
const judgedResponses = (plan: ProfileJudgePlan, prediction = "Yes.") => new Map(plan.jobs.map(j => [j.key, response(j.request, prediction)]));

test("complete 100x2 matrix preserves frozen native judges, dedup owners and separate reader aliases", async () => {
  const f = fixture(100), plan = await makeLabReaderProfileJudgePlan(f.dataset, f.reader, f.responses, f.parent);
  expect(plan.cases).toHaveLength(200); expect(plan.jobs).toHaveLength(100);
  const profile = await judge.loadJudgeProfile();
  expect(plan.judgeProfileSha256).toBe(profile.sha256);
  expect(plan.jobs[0]!.request).toEqual(makeGatewayStudyRequest({ phase: "judge", messages: [{ role: "system", content: CLAUDE_JUDGE_SYSTEM },
    { role: "user", content: judge.buildJudgePrompt(f.dataset.questions[0]!, "red", profile) }] }) as FrozenJudgeRequest);
  expect(plan.jobs[0]!.request.model).toBe("openai/gpt-4o");
  expect(plan.jobs[0]!.key).toBe(canonicalSha256({ namespaceSha256: f.reader.namespaceSha256, requestSha256: plan.jobs[0]!.request.requestSha256 }));
  expect(plan.cases[0]!.readerJobKey).toBe(f.reader.cases[0]!.jobKey);
  expect(plan.cases[0]!.readerRequestSha256).toBe(f.reader.cases[0]!.requestSha256);
  expect(plan.cases[0]!.readerResponseSha256).toBe(canonicalSha256(f.responses.get(f.reader.cases[0]!.jobKey)));
  expect(Object.isFrozen(plan.readerPlan.cases[0])).toBe(true); expect(Object.isFrozen(plan.jobs[0]!.request.body.messages)).toBe(true);
  const scores = scoreLabReaderProfileJudgePlan(plan, judgedResponses(plan));
  expect(scores).toHaveLength(200); expect(scores.filter(s => s.correct === 1)).toHaveLength(200);
  expect(scores.filter(s => s.reusedJudgment)).toHaveLength(100);
  expect(scores.map(s => [s.ordinal, s.questionId, s.groupId, s.variant])).toEqual(f.reader.cases.map(c => [c.ordinal, c.questionId, c.groupId, c.variant]));
  expect(await makeLabReaderProfileJudgePlan(f.dataset, f.reader, f.responses, f.parent)).toEqual(plan);
});

test("missing, extra, swapped and late malformed reader results reject before loading profile or gold", async () => {
  const f = fixture(); let goldReads = 0;
  for (const q of f.dataset.questions) for (const key of ["answer", "unanswerable", "evidenceTurnIds", "evidenceSessionIds"])
    Object.defineProperty(q, key, { get() { goldReads++; throw new Error("gold accessed"); } });
  const profile = spyOn(judge, "loadJudgeProfile");
  try {
    const keys = [...f.responses.keys()], missing = new Map(f.responses); missing.delete(keys[0]!);
    const extra = new Map(f.responses); extra.set(sha256Hex("extra"), f.responses.get(keys[0]!)!);
    const swapped = new Map(f.responses); swapped.set(keys[0]!, f.responses.get(keys[1]!)!); swapped.set(keys[1]!, f.responses.get(keys[0]!)!);
    const malformed = new Map(f.responses); malformed.set(keys.at(-1)!, { ...f.responses.get(keys.at(-1)!)!, rawSha256: "wrong" });
    for (const values of [missing, extra, swapped, malformed]) await expect(makeLabReaderProfileJudgePlan(f.dataset, f.reader, values, f.parent)).rejects.toThrow();
    expect(profile).not.toHaveBeenCalled(); expect(goldReads).toBe(0);
  } finally { profile.mockRestore(); }
});

test("reader matrix aliases and digests reject even with resealed modified cases", async () => {
  const f = fixture();
  await expect(makeLabReaderProfileJudgePlan(f.dataset, { ...f.reader, planSha256: sha256Hex("wrong") }, f.responses, f.parent)).rejects.toThrow();
  const changed = seal({ ...f.reader, cases: f.reader.cases.map((c, i) => i === 0 ? { ...c, groupId: "other" } : c) });
  await expect(makeLabReaderProfileJudgePlan(f.dataset, changed, f.responses, f.parent)).rejects.toThrow();
  const missing = seal({ ...f.reader, cases: f.reader.cases.slice(0, -1) });
  await expect(makeLabReaderProfileJudgePlan(f.dataset, missing, f.responses, f.parent)).rejects.toThrow();
});

test("length failures count zero without partial answers, gold access or judge jobs under their own non-512 policy", async () => {
  const f = fixture(); let goldReads = 0;
  const failures = new Map(f.reader.jobs.map(j => [j.key, response(j.request, "partial answer must disappear", true) as LabReaderResult]));
  for (const q of f.dataset.questions) for (const key of ["answer", "unanswerable"])
    Object.defineProperty(q, key, { get() { goldReads++; throw new Error("failure gold accessed"); } });
  const plan = await makeLabReaderProfileJudgePlan(f.dataset, f.reader, failures, f.parent);
  expect(goldReads).toBe(0); expect(plan.jobs).toHaveLength(0);
  expect(plan.policySha256).toBe(LAB_GPT5_MINI_READER_FAILURE_POLICY_SHA256);
  expect(plan.policySha256).not.toBe(GATEWAY_READER_FAILURE_V6_POLICY_SHA256);
  expect(JSON.stringify(plan)).not.toContain("partial answer must disappear");
  expect(scoreLabReaderProfileJudgePlan(plan, new Map()).map(s => [s.correct, s.status])).toEqual(Array(4).fill([0, "terminal-reader-failure"]));
  const key = f.reader.jobs[0]!.key;
  const partial = new Map(failures); partial.set(key, { ...failures.get(key)!, prediction: "partial" } as unknown as LabReaderResult);
  await expect(makeLabReaderProfileJudgePlan(f.dataset, f.reader, partial, f.parent)).rejects.toThrow("terminal reader policy");
  expect(() => scoreLabReaderProfileJudgePlan(seal({ ...plan, policySha256: GATEWAY_READER_FAILURE_V6_POLICY_SHA256 }), new Map())).toThrow();
});

test("medium profile completes under its own request binding and applies its distinct 8192-token terminal policy", async () => {
  const complete = fixture(2, "medium"), completePlan = await makeLabReaderProfileJudgePlan(complete.dataset, complete.reader, complete.responses, complete.parent);
  expect(completePlan.policySha256).toBe(LAB_GPT5_MINI_MEDIUM_READER_FAILURE_POLICY_SHA256);
  expect(completePlan.policySha256).not.toBe(LAB_GPT5_MINI_READER_FAILURE_POLICY_SHA256);
  expect(scoreLabReaderProfileJudgePlan(completePlan, judgedResponses(completePlan))).toHaveLength(4);

  const terminal = fixture(2, "medium"), failures = new Map(terminal.reader.jobs.map(job => [job.key, response(job.request, "partial medium answer", true) as LabReaderResult]));
  const terminalPlan = await makeLabReaderProfileJudgePlan(terminal.dataset, terminal.reader, failures, terminal.parent);
  expect(terminalPlan.jobs).toHaveLength(0);
  expect(terminalPlan.policySha256).toBe(LAB_GPT5_MINI_MEDIUM_READER_FAILURE_POLICY_SHA256);
  expect(JSON.stringify(terminalPlan)).not.toContain("partial medium answer");
  expect(scoreLabReaderProfileJudgePlan(terminalPlan, new Map()).every(score => score.correct === 0 && score.status === "terminal-reader-failure")).toBe(true);
  expect(() => scoreLabReaderProfileJudgePlan(seal({ ...terminalPlan, policySha256: LAB_GPT5_MINI_READER_FAILURE_POLICY_SHA256 }), new Map())).toThrow("reader failure policy");
});

test("mixed failures keep denominator; malformed normalized usage and model cannot enter scoring", async () => {
  const f = fixture(), key = f.reader.jobs[0]!.key;
  f.responses.set(key, response(f.reader.jobs[0]!.request, "partial", true) as LabReaderResult);
  const plan = await makeLabReaderProfileJudgePlan(f.dataset, f.reader, f.responses, f.parent);
  const scores = scoreLabReaderProfileJudgePlan(plan, judgedResponses(plan, "no!"));
  expect(scores).toHaveLength(4); expect(scores.filter(s => s.status === "terminal-reader-failure")).toHaveLength(1);
  expect(scores.every(s => s.correct === 0)).toBe(true);
  for (const malformed of [
    { ...f.responses.get(key)!, usage: { ...f.responses.get(key)!.usage, outputTokens: 2049 } },
    { ...f.responses.get(key)!, identity: { ...f.responses.get(key)!.identity, requestedModel: "openai/gpt-4.1-mini" } },
  ]) {
    const values = new Map(f.responses); values.set(key, malformed as unknown as LabReaderResult);
    await expect(makeLabReaderProfileJudgePlan(f.dataset, f.reader, values, f.parent)).rejects.toThrow();
  }
});

test("strict judge decisions, complete maps and response identity are mandatory", async () => {
  const f = fixture(), plan = await makeLabReaderProfileJudgePlan(f.dataset, f.reader, f.responses, f.parent);
  for (const text of ["yes, because correct", "{\"correct\":true}", "yes\nno", "y", "No?", "1"])
    expect(() => scoreLabReaderProfileJudgePlan(plan, judgedResponses(plan, text))).toThrow("invalid semantic judge");
  for (const text of [" yes ", "YES!", "No."]) expect(scoreLabReaderProfileJudgePlan(plan, judgedResponses(plan, text))).toHaveLength(4);
  const map = judgedResponses(plan), keys = [...map.keys()];
  const missing = new Map(map); missing.delete(keys[0]!);
  const extra = new Map(map); extra.set(sha256Hex("extra"), map.get(keys[0]!)!);
  const swapped = new Map(map); swapped.set(keys[0]!, map.get(keys[1]!)!);
  const reader = new Map(map); reader.set(keys[0]!, f.responses.values().next().value!);
  for (const bad of [missing, extra, swapped, reader]) expect(() => scoreLabReaderProfileJudgePlan(plan, bad)).toThrow();
});

test("scoring rejects digest, matrix, namespace, request and dedup owner tampering", async () => {
  const f = fixture(), plan = await makeLabReaderProfileJudgePlan(f.dataset, f.reader, f.responses, f.parent), map = judgedResponses(plan);
  expect(() => scoreLabReaderProfileJudgePlan({ ...plan, planSha256: sha256Hex("wrong") }, map)).toThrow("judge plan digest");
  for (const bad of [
    seal({ ...plan, cases: plan.cases.slice(0, -1) }),
    seal({ ...plan, namespaceSha256: sha256Hex("wrong") }),
    seal({ ...plan, cases: plan.cases.map((c, i) => i === 1 && c.kind === "model" ? { ...c, ownerOrdinal: 1 } : c) }),
    seal({ ...plan, cases: plan.cases.map((c, i) => i === 1 ? { ...c, variant: LAB_READER_PROFILE_VARIANTS[0] } : c) }),
    seal({ ...plan, cases: plan.cases.map((c, i) => i === 1 ? { ...c, groupId: "swapped-group" } : c) }),
    seal({ ...plan, jobs: [...plan.jobs].reverse() }),
  ]) expect(() => scoreLabReaderProfileJudgePlan(bad, map)).toThrow();
  const changed = structuredClone(plan); (changed.jobs[0]!.request.body as { model: string }).model = "openai/gpt-4.1-mini";
  expect(() => scoreLabReaderProfileJudgePlan(seal(changed), map)).toThrow("frozen profile");
});
