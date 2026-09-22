import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic-model";
import { prepareCloneMemRetrieval } from "../scripts/benchmarks/clonemem-retrieval";
import { cloneMemKeywordSemanticCapture, cloneMemKeywordDevPairedSource, CLONEMEM_KEYWORD_DEV_PERSON_IDS, CLONEMEM_KEYWORD_DEV_INPUT_SHA256,
  parseCloneMemKeywordDevInputPins, replayCloneMemKeywordPersona } from "../scripts/benchmarks/clonemem-keyword-dev-source";
import type { CloneMemMemory, CloneMemQuery } from "../scripts/benchmarks/clonemem-dataset";
import { parsePairedMemorySource } from "../scripts/benchmarks/paired-memory-study";

async function fixture() {
  const memory: CloneMemMemory = { personId: "synthetic", personName: "Person", traces: [
    { id: "first", medium: "note", date: "2024-01-01T00:00:00", content: "The gardener grows red roses." },
    { id: "second", medium: "note", date: "2024-02-01T00:00:00", content: "A visitor prefers blue flowers." },
    { id: "future", medium: "note", date: "2025-01-01T00:00:00", content: "The future garden contains tulips." },
  ] };
  const queries: CloneMemQuery[] = [
    { id: "synthetic:q1", localId: "q1", personId: "synthetic", question: "What does the gardener grow?", questionDate: "2024-01-01T00:00:00" },
    { id: "synthetic:q2", localId: "q2", personId: "synthetic", question: "Which flowers does the visitor prefer?", questionDate: "2024-02-01T00:00:00" },
  ];
  let indexed: Parameters<OhSemanticSearchBackendV1["index"]>[0] = [];
  const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index(records) { indexed = records; return { indexed: records.length, v: 1 }; },
    async search() { return [...indexed].reverse().map(record => ({ key: record.key, recordSha256: record.recordSha256, score: .8, v: 1 })); },
    async close() {} };
  const prepared = await prepareCloneMemRetrieval(memory, backend);
  try {
    const rows = [];
    for (const query of queries) rows.push({ questionId: query.id, result: await prepared.retrieve(query.question, query.questionDate) as unknown });
    return { projection: { memory, queries }, identity: prepared.identity, rows };
  } finally { await prepared.close(); }
}
function reseal(value: unknown, mutate: (row: Record<string, unknown>) => void) {
  const { resultSha256: _, ...payload } = structuredClone(value) as Record<string, unknown>;
  mutate(payload); return { ...payload, resultSha256: canonicalSha256(payload) };
}

test("development input roles bind exact historical pins and reject alias or substituted scope", () => {
  const pins = Object.fromEntries(Object.entries(CLONEMEM_KEYWORD_DEV_INPUT_SHA256).map(([role, sha256]) => [role, { path: `/private/tmp/${role}`, sha256 }]));
  expect(Object.entries(parseCloneMemKeywordDevInputPins(pins))).toEqual(Object.entries(pins));
  for (const role of Object.keys(pins)) {
    expect(() => parseCloneMemKeywordDevInputPins({ ...pins, [role]: { ...pins[role], sha256: "0".repeat(64) } })).toThrow("changed");
  }
  expect(() => parseCloneMemKeywordDevInputPins({ ...pins, extra: pins.capturePin })).toThrow("shape");
  expect(() => parseCloneMemKeywordDevInputPins({ ...pins, replayPin: { ...pins.replayPin, path: pins.capturePin!.path } })).toThrow("alias");
});

test("persona replay authenticates original full context and reconstructs gold-free causal candidate", async () => {
  const input = await fixture();
  const result = await replayCloneMemKeywordPersona(input);
  expect(result).toHaveLength(2);
  for (const row of result) {
    const originalVector = row.original.arms.find(arm => arm.arm === "raw-vector")!;
    expect(row.candidate.arms[0]).toEqual({ arm: "raw-vector", traceIds: originalVector.traceIds,
      context: originalVector.context, contextBytes: originalVector.contextBytes, contextSha256: originalVector.contextSha256 });
    expect(row.candidate.arms.flatMap(arm => arm.traceIds)).not.toContain("future");
    expect(row.candidate.queryPlan.semanticQuerySha256).toBe(row.original.querySha256);
    expect(Object.keys(cloneMemKeywordSemanticCapture(row.original)).sort()).toEqual([
      "eligibleTraceIds", "identitySha256", "personId", "querySha256", "questionDate", "semanticCapture", "semanticCaptureSha256"]);
    expect(JSON.stringify(row.candidate)).not.toContain("correctChoiceId");
    expect(JSON.stringify(row.candidate)).not.toContain("evidenceGroups");
  }
});

test("resealed original context or evidence changes cannot pass native replay", async () => {
  const original = await fixture();
  for (const mutate of [
    (row: Record<string, unknown>) => { const arms = row.arms as Record<string, unknown>[];
      arms[0]!.context = "Changed whole trace"; arms[0]!.contextBytes = 19; arms[0]!.contextSha256 = sha256Hex("Changed whole trace"); },
    (row: Record<string, unknown>) => { const arms = row.arms as Record<string, unknown>[];
      arms[0]!.evidence = [[]]; },
    (row: Record<string, unknown>) => { row.authorityHeadSha256 = "0".repeat(64); },
  ]) {
    const input = structuredClone(original); input.rows[0]!.result = reseal(input.rows[0]!.result, mutate);
    await expect(replayCloneMemKeywordPersona(input)).rejects.toThrow("original SDK replay");
  }
});

test("query identity, date eligibility, duplicate rows and stale semantic digests fail closed", async () => {
  const original = await fixture();
  const query = structuredClone(original); query.projection.queries[0] = { ...query.projection.queries[0]!, question: "Different query" };
  await expect(replayCloneMemKeywordPersona(query)).rejects.toThrow();
  const duplicate = structuredClone(original); duplicate.rows[1] = duplicate.rows[0]!;
  await expect(replayCloneMemKeywordPersona(duplicate)).rejects.toThrow("order");
  const date = structuredClone(original); date.projection.queries[0] = { ...date.projection.queries[0]!, questionDate: "2024-01-02T00:00:00" };
  await expect(replayCloneMemKeywordPersona(date)).rejects.toThrow("date");
  const stale = structuredClone(original); stale.rows[0]!.result = reseal(stale.rows[0]!.result, row => {
    const hits = row.semanticCapture as Record<string, unknown>[]; hits[0]!.recordSha256 = "0".repeat(64);
    row.semanticCaptureSha256 = canonicalSha256(hits);
  });
  await expect(replayCloneMemKeywordPersona(stale)).rejects.toThrow();
  const foreignIdentity = { ...original, identity: { wrong: true } };
  await expect(replayCloneMemKeywordPersona(foreignIdentity)).rejects.toThrow("memory identity");
});

test("all146 metadata-only reader projections preserve both groups and reject omissions or gold fields", () => {
  const projections = CLONEMEM_KEYWORD_DEV_PERSON_IDS.map((personId, index) => ({
    readerQuestions: Array.from({ length: index === 0 ? 114 : 32 }, (_, ordinal) => ({
      id: `${personId}:q${ordinal}`, localId: `q${ordinal}`, personId, personName: "Person",
      question: `Question ${personId} ${ordinal}?`, questionDate: "2024-01-01T00:00:00",
      choices: [{ id: "A", text: "First" }, { id: "B", text: "Second" }],
    })),
  }));
  const contexts = new Map(projections.flatMap(projection => projection.readerQuestions).map(q => [q.id, {
    arms: (["raw-vector", "oh-hybrid-keywords-v1"] as const).map(arm => ({ arm, context: `${arm} trace`,
      traceIds: ["trace"], contextBytes: Buffer.byteLength(`${arm} trace`), contextSha256: sha256Hex(`${arm} trace`) })),
  }]));
  const source = cloneMemKeywordDevPairedSource(projections, contexts);
  expect(source.questions).toHaveLength(146);
  expect(source.selection.population).toHaveLength(146);
  expect(source.questions.filter(q => q.groupId === CLONEMEM_KEYWORD_DEV_PERSON_IDS[0])).toHaveLength(114);
  expect(source.questions.filter(q => q.groupId === CLONEMEM_KEYWORD_DEV_PERSON_IDS[1])).toHaveLength(32);
  expect(new Set(source.questions.map(q => q.id))).toEqual(new Set(contexts.keys()));
  expect(() => cloneMemKeywordDevPairedSource(projections, new Map([...contexts].slice(1)))).toThrow("population");
  const duplicate = structuredClone(projections); duplicate[0]!.readerQuestions[1] = duplicate[0]!.readerQuestions[0]!;
  expect(() => cloneMemKeywordDevPairedSource(duplicate, contexts)).toThrow("duplicate");
  const foreign = structuredClone(projections); foreign[0]!.readerQuestions[0]!.personId = CLONEMEM_KEYWORD_DEV_PERSON_IDS[1];
  expect(() => cloneMemKeywordDevPairedSource(foreign, contexts)).toThrow("persona");
  const extraGold = { ...source, questions: source.questions.map(q => ({ ...q, correctChoiceId: "A" })) };
  // The shared reader schema rejects injected scorer fields after projection too.
  expect(() => parsePairedMemorySource(extraGold)).toThrow("projection");
});
