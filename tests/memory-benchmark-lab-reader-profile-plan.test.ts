import { beforeAll, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { Dataset } from "../scripts/benchmarks/datasets";
import type { LabVariant } from "../scripts/benchmarks/lab";
import { makeLabPaidReaderPlan, validateLabPaidReaderPlan, type LabPaidReaderPlan } from "../scripts/benchmarks/lab-paid-plan";
import { makeLabGpt5MiniReaderRequest } from "../scripts/benchmarks/lab-reader-profile";
import { LAB_READER_PROFILE_VARIANTS, makeLabReaderProfilePlan, validateLabReaderProfilePlan,
  type LabReaderProfilePlan } from "../scripts/benchmarks/lab-reader-profile-plan";

const namespace = sha256Hex("synthetic-profile-plan"), parentNamespace = sha256Hex("synthetic-parent-plan");
const variants: readonly LabVariant[] = [
  { id: LAB_READER_PROFILE_VARIANTS[0], system: "bm25-window", budget: { topK: 20, contextBytes: 24_000 } },
  { id: LAB_READER_PROFILE_VARIANTS[1], system: "bm25-user-hybrid", budget: { topK: 100, contextBytes: 24_000 } },
  { id: "bm25-window:k100:b96000", system: "bm25-window", budget: { topK: 100, contextBytes: 96_000 } },
];
function fixture(): Dataset {
  const turns = [
    { id: "one", sessionId: "S", sessionIndex: 0, date: "2026-01-01", speaker: "user", text: "Mira owns a crimson bicycle. Its name is Étoile 🚲." },
    { id: "two", sessionId: "S", sessionIndex: 0, date: "2026-01-01", speaker: "assistant", text: "Mira keeps the bicycle in the garden shed." },
  ];
  const question = { id: "q1", corpusId: "a", category: "single-session-user", question: "What bicycle does Mira own?",
    questionDate: "2026-01-02", answer: "crimson", unanswerable: false, evidenceTurnIds: ["one"], evidenceSessionIds: ["S"] };
  // Corpus order differs from question order; equal prompts exercise physical aliases.
  return { corpora: [{ id: "b", groupId: "group-b", turns }, { id: "a", groupId: "group-a", turns }],
    questions: [question, { ...question, id: "q2", corpusId: "b", question: "Where does Mira keep the bicycle?" },
      { ...question, id: "q3", answer: "different gold, same reader prompt" }] };
}
function reseal<T extends { planSha256: string; casesSha256: string; cases: readonly unknown[] }>(plan: T): T {
  const { planSha256: _old, ...payload } = plan;
  const next = { ...payload, casesSha256: canonicalSha256(plan.cases) };
  return { ...next, planSha256: canonicalSha256(next) } as unknown as T;
}
const dataset = fixture();
let parent: LabPaidReaderPlan, plan: LabReaderProfilePlan;
beforeAll(async () => {
  // Actual parent planner/validator and real retrieval, with a small synthetic dataset.
  parent = await makeLabPaidReaderPlan(dataset, variants, parentNamespace);
  validateLabPaidReaderPlan(dataset, parent);
  plan = makeLabReaderProfilePlan(dataset, parent, namespace);
});

test("real three-arm parent becomes the complete fixed two-arm matrix with byte-identical selected prompts", () => {
  expect(parent.cases).toHaveLength(9);
  expect(plan.cases.map(c => [c.ordinal, c.parentOrdinal, c.questionId, c.variant])).toEqual([
    [0, 0, "q1", variants[0]!.id], [1, 1, "q1", variants[1]!.id], [2, 3, "q2", variants[0]!.id],
    [3, 4, "q2", variants[1]!.id], [4, 6, "q3", variants[0]!.id], [5, 7, "q3", variants[1]!.id],
  ]);
  expect(plan.variants).toEqual(LAB_READER_PROFILE_VARIANTS);
  expect(plan.parentPlanSha256).toBe(parent.planSha256);
  for (const c of plan.cases) {
    const source = parent.cases[c.parentOrdinal]!, original = parent.jobs.find(j => j.key === source.jobKey)!;
    const job = plan.jobs.find(j => j.key === c.jobKey)!;
    expect(job.request).toEqual(makeLabGpt5MiniReaderRequest(original.request.body.messages));
    expect(JSON.stringify(job.request.body.messages)).toBe(JSON.stringify(original.request.body.messages));
    expect(c).toMatchObject({ questionId: source.questionId, corpusId: source.corpusId, groupId: source.groupId,
      category: source.category, contextSha256: source.contextSha256, contextBytes: source.contextBytes });
    const memory = JSON.parse(job.request.body.messages[1]!.content).memory as string;
    expect(c.contextSha256).toBe(sha256Hex(memory)); expect(c.contextBytes).toBe(Buffer.byteLength(memory));
    expect(job.key).toBe(canonicalSha256({ namespaceSha256: namespace, requestSha256: job.request.requestSha256 }));
    expect(c.requestSha256).toBe(job.request.requestSha256);
    expect(job.request.body.model).toBe("openai/gpt-5-mini"); expect(job.ordinal).toBe(0);
  }
  expect(() => validateLabReaderProfilePlan(dataset, JSON.parse(JSON.stringify(plan)), parent)).not.toThrow();
});

test("shared physical requests retain first-use job order and every case alias", () => {
  expect(plan.cases[0]!.jobKey).toBe(plan.cases[4]!.jobKey);
  expect(plan.cases[1]!.jobKey).toBe(plan.cases[5]!.jobKey);
  expect(plan.jobs.length).toBeLessThan(plan.cases.length); expect(plan.jobs.length).toBeGreaterThan(1);
  expect(plan.jobs.map(j => j.key)).toEqual([...new Set(plan.cases.map(c => c.jobKey))]);
  expect(() => validateLabReaderProfilePlan(dataset, plan, parent)).not.toThrow();
});

test("conversion is deterministic, deeply frozen, and isolated from parent mutation", () => {
  const mutableParent = structuredClone(parent), converted = makeLabReaderProfilePlan(dataset, mutableParent, namespace);
  expect(converted).toEqual(plan);
  for (const value of [converted, converted.variants, converted.cases, converted.cases[0], converted.jobs,
    converted.jobs[0], converted.jobs[0]!.request.body.messages, converted.jobs[0]!.request.body.messages[0]]) expect(Object.isFrozen(value)).toBe(true);
  (mutableParent.jobs[0]!.request.body.messages[0] as { content: string }).content = "changed after conversion";
  expect(converted).toEqual(plan);
  const changed = makeLabReaderProfilePlan(dataset, parent, sha256Hex("other namespace"));
  expect(changed.planSha256).not.toBe(plan.planSha256); expect(changed.jobs[0]!.key).not.toBe(plan.jobs[0]!.key);
  expect(changed.jobs[0]!.request).toEqual(plan.jobs[0]!.request);
});

test("question-last two-arm parents retain JSON field order and policy", async () => {
  const source = await makeLabPaidReaderPlan(dataset, variants.slice(0, 2), parentNamespace, "question-last-v1");
  const converted = makeLabReaderProfilePlan(dataset, source, namespace);
  expect(converted.cases.map(c => c.parentOrdinal)).toEqual([0, 1, 2, 3, 4, 5]);
  for (const job of converted.jobs) expect(Object.keys(JSON.parse(job.request.body.messages[1]!.content))).toEqual(["memory", "questionDate", "question"]);
  expect(() => validateLabReaderProfilePlan(dataset, converted, source)).not.toThrow();
});

test("planning and validation never read gold or raw evidence getters", async () => {
  const guarded = fixture(); let reads = 0;
  const forbidden = { enumerable: true, configurable: true, get() { reads++; throw new Error("Gold was read"); } };
  for (const q of guarded.questions) for (const key of ["answer", "unanswerable", "evidenceTurnIds", "evidenceSessionIds", "rawEvidenceTurnIds"]) Object.defineProperty(q, key, forbidden);
  for (const corpus of guarded.corpora) for (const turn of corpus.turns) for (const key of ["answer", "has_answer"]) Object.defineProperty(turn, key, forbidden);
  const guardedParent = await makeLabPaidReaderPlan(guarded, variants, parentNamespace);
  const converted = makeLabReaderProfilePlan(guarded, guardedParent, namespace);
  expect(() => validateLabReaderProfilePlan(guarded, converted, guardedParent)).not.toThrow();
  expect(reads).toBe(0); expect(converted).toEqual(plan); expect(JSON.stringify(converted)).not.toContain("different gold");
});

type Drift = readonly [string, (plan: LabReaderProfilePlan) => LabReaderProfilePlan];
const drifts: readonly Drift[] = [
  ["parent digest", p => ({ ...p, parentPlanSha256: sha256Hex("other parent") })],
  ["variant order", p => ({ ...p, variants: [...p.variants].reverse() })],
  ["duplicate variant", p => ({ ...p, variants: [p.variants[0]!, p.variants[0]!] })],
  ["missing case", p => ({ ...p, cases: p.cases.slice(1) })],
  ["duplicate case", p => ({ ...p, cases: [p.cases[0]!, ...p.cases.slice(0, -1)] })],
  ["case order", p => ({ ...p, cases: [...p.cases].reverse() })],
  ["question alias", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, questionId: "q2" }) })],
  ["corpus alias", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, corpusId: "b" }) })],
  ["group alias", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, groupId: "group-b" }) })],
  ["category alias", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, category: "other" }) })],
  ["parent ordinal", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, parentOrdinal: 2 }) })],
  ["case ordinal", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, ordinal: 2 }) })],
  ["context digest", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, contextSha256: sha256Hex("changed") }) })],
  ["context bytes", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, contextBytes: c.contextBytes + 1 }) })],
  ["request digest", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, requestSha256: sha256Hex("changed") }) })],
  ["job alias", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, jobKey: p.cases[2]!.jobKey }) })],
  ["missing job", p => ({ ...p, jobs: p.jobs.slice(1) })],
  ["duplicate job", p => ({ ...p, jobs: [...p.jobs, p.jobs[0]!] })],
  ["job order", p => ({ ...p, jobs: [...p.jobs].reverse() })],
  ["job key", p => ({ ...p, jobs: p.jobs.map((j, i) => i ? j : { ...j, key: sha256Hex("changed") }) })],
  ["job ordinal", p => ({ ...p, jobs: p.jobs.map((j, i) => i ? j : { ...j, ordinal: 1 as 0 }) })],
  ["unknown case field", p => ({ ...p, cases: p.cases.map((c, i) => i ? c : { ...c, answer: "forbidden" }) })],
  ["unknown job field", p => ({ ...p, jobs: p.jobs.map((j, i) => i ? j : { ...j, extra: true }) })],
];
for (const [name, alter] of drifts) test(`rejects rehashed ${name}`, () => expect(() => validateLabReaderProfilePlan(dataset, reseal(alter(plan)), parent)).toThrow());

test("coherently rewritten request, context and aliases cannot change parent content", () => {
  const original = plan.jobs[0]!, messages = original.request.body.messages;
  const user = JSON.parse(messages[1]!.content) as { question: string; questionDate: string; memory: string }, memory = "Substituted context";
  const request = makeLabGpt5MiniReaderRequest([messages[0]!, { role: "user", content: JSON.stringify({ ...user, memory }) }]);
  const key = canonicalSha256({ namespaceSha256: namespace, requestSha256: request.requestSha256 });
  const altered = reseal({ ...plan, jobs: plan.jobs.map(j => j.key === original.key ? { ...j, key, request } : j),
    cases: plan.cases.map(c => c.jobKey === original.key ? { ...c, jobKey: key, requestSha256: request.requestSha256,
      contextSha256: sha256Hex(memory), contextBytes: Buffer.byteLength(memory) } : c) });
  expect(() => validateLabReaderProfilePlan(dataset, altered, parent)).toThrow("parent conversion binding");
});

test("malformed digests, unknown envelope keys and stale digests fail", () => {
  for (const key of ["namespaceSha256", "parentPlanSha256", "casesSha256", "planSha256"] as const) {
    for (const value of ["", "g".repeat(64), "A".repeat(64), "a".repeat(63)]) expect(() => validateLabReaderProfilePlan(dataset, { ...plan, [key]: value }, parent)).toThrow();
  }
  expect(() => validateLabReaderProfilePlan(dataset, { ...plan, planSha256: sha256Hex("wrong") }, parent)).toThrow("digest");
  expect(() => validateLabReaderProfilePlan(dataset, { ...plan, casesSha256: sha256Hex("wrong") }, parent)).toThrow("digest");
  expect(() => validateLabReaderProfilePlan(dataset, reseal({ ...plan, extra: true }), parent)).toThrow("shape");
  expect(() => makeLabReaderProfilePlan(dataset, parent, "invalid")).toThrow("namespace");
});

test("parent digest, matrix identities, actual budgets, systems and order are independently required", async () => {
  const corrupt = { ...parent, planSha256: sha256Hex("wrong") };
  expect(() => makeLabReaderProfilePlan(dataset, corrupt, namespace)).toThrow("reader plan digest");
  expect(() => validateLabReaderProfilePlan(dataset, plan, corrupt)).toThrow("reader plan digest");
  const aliases = reseal({ ...parent, cases: parent.cases.map((c, i) => i ? c : { ...c, questionId: "other" }) });
  expect(() => makeLabReaderProfilePlan(dataset, aliases, namespace)).toThrow("matrix alias");
  const wrongBudget = await makeLabPaidReaderPlan(dataset, variants.map((v, i) => i ? v : { ...v, budget: { ...v.budget, topK: 19 } }), parentNamespace);
  expect(() => makeLabReaderProfilePlan(dataset, wrongBudget, namespace)).toThrow("variant systems and budgets");
  const wrongSystem = await makeLabPaidReaderPlan(dataset, variants.map((v, i) => i ? v : { ...v, system: "bm25-focused" }), parentNamespace);
  expect(() => makeLabReaderProfilePlan(dataset, wrongSystem, namespace)).toThrow("variant systems and budgets");
  const reversed = await makeLabPaidReaderPlan(dataset, [variants[1]!, variants[0]!, variants[2]!], parentNamespace);
  expect(() => makeLabReaderProfilePlan(dataset, reversed, namespace)).toThrow("variant systems and budgets");
});

test("dataset question text, selected size and order remain bound to parent", () => {
  const changed = { ...dataset, questions: dataset.questions.map((q, i) => i ? q : { ...q, question: "A different question?" }) };
  expect(() => validateLabReaderProfilePlan(changed, plan, parent)).toThrow("prompt binding");
  expect(() => validateLabReaderProfilePlan({ ...dataset, questions: [...dataset.questions].reverse() }, plan, parent)).toThrow("matrix alias");
  expect(() => validateLabReaderProfilePlan({ ...dataset, questions: dataset.questions.slice(0, 2) }, plan, parent)).toThrow("matrix");
  expect(() => validateLabReaderProfilePlan({ ...dataset, questions: [] }, plan, parent)).toThrow();
});
