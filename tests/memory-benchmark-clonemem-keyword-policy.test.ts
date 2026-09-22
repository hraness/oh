import { expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { cloneMemTimestamp, type CloneMemMemory } from "../scripts/benchmarks/clonemem-dataset";
import { CLONEMEM_KEYWORD_POLICY_V1, normalizeCloneMemKeywordQuery, prepareCloneMemKeywordReplay,
  type CloneMemKeywordSemanticCapture } from "../scripts/benchmarks/clonemem-keyword-policy";

const memory: CloneMemMemory = { personId: "person", personName: "Person", traces: [
  { id: "semantic", date: "2024-01-01T00:00:00", medium: "diary", content: "Original semantic trace.\nA second whole line." },
  { id: "future", date: "2024-01-03T00:00:00", medium: "mail", content: "Rareterm rareterm rareterm future." },
  { id: "lexical", date: "2024-01-01T00:00:00", medium: "note", content: "Rareterm lexical trace." },
] };
const query = "I have been and you have been and we have been and they have been asking about Rareterm";
function fixture(source: CloneMemMemory = memory) {
  const prepared = prepareCloneMemKeywordReplay(source);
  function capture(text = query, date = "2024-01-01T00:00:00"): CloneMemKeywordSemanticCapture {
    const cutoff = cloneMemTimestamp(date), eligible = source.traces.flatMap((trace, index) => cloneMemTimestamp(trace.date) <= cutoff ? [index] : []);
    const semanticCapture = eligible.slice(0, 30).map((index, rank) => ({ key: prepared.identity.records[index]!.key,
      recordSha256: prepared.identity.records[index]!.recordSha256, score: 1 - rank / 100, v: 1 as const }));
    return { personId: source.personId, querySha256: sha256Hex(text), identitySha256: canonicalSha256(prepared.identity),
      questionDate: date, eligibleTraceIds: eligible.map(index => source.traces[index]!.id), semanticCapture,
      semanticCaptureSha256: canonicalSha256(semanticCapture) };
  }
  return { prepared, capture };
}

test("frozen normalization deduplicates before the16 content-term cap without word stemming", () => {
  expect(normalizeCloneMemKeywordQuery(query)).toBe("asking about rareterm");
  expect(normalizeCloneMemKeywordQuery("THE café cafe\u0301 RUNNING running run no not don't")).toBe("café running run");
  expect(normalizeCloneMemKeywordQuery("the and is have you")).toBe("");
  const terms = Array.from({ length: 20 }, (_, index) => `term${index}`);
  expect(normalizeCloneMemKeywordQuery(`the the ${terms.join(" ")}`)).toBe(terms.slice(0, 16).join(" "));
  expect(CLONEMEM_KEYWORD_POLICY_V1.stopwords).toContain("not");
  expect(CLONEMEM_KEYWORD_POLICY_V1.probeFreezeSha256).toBe("642f9f47e82f3b3cade4a957ba38fa312bb79afa112975655e35ebb199a730dc");
  expect(() => normalizeCloneMemKeywordQuery("x".repeat(16_385))).toThrow("byte bound");
  expect(() => normalizeCloneMemKeywordQuery("x\0")).toThrow("scalar");
  expect(() => normalizeCloneMemKeywordQuery("\ud800")).toThrow("scalar");
});

test("shipped fusion has explicit split-query identity, global lexical candidates and original whole traces", async () => {
  const source = structuredClone(memory);
  Object.defineProperty(source, "gold", { enumerable: true, get() { throw Error("gold read"); } });
  Object.defineProperty(source.traces[0]!, "choices", { enumerable: true, get() { throw Error("choice read"); } });
  const { prepared, capture } = fixture(source);
  try {
    const row = await prepared.retrieve(query, "2024-01-01T00:00:00", capture());
    expect(row.queryPlan).toEqual({ lexicalQuery: "asking about rareterm", lexicalQuerySha256: sha256Hex("asking about rareterm"),
      semanticQuery: query, semanticQuerySha256: sha256Hex(query), semanticSource: "captured-original-question-stem" });
    expect(row.eligibleTraceIds).toEqual(["semantic", "lexical"]);
    expect(row.arms[0]!.traceIds).toEqual(["semantic", "lexical"]);
    expect(row.arms[1]!.traceIds).toEqual(["lexical", "semantic"]);
    expect(row.arms[0]!.context).toBe("---- idx 1 ----\nOriginal semantic trace.\nA second whole line.\n\n---- idx 2 ----\nRareterm lexical trace.");
    for (const arm of row.arms) {
      expect(arm.traceIds).not.toContain("future");
      expect(arm.contextBytes).toBe(Buffer.byteLength(arm.context));
      expect(arm.contextSha256).toBe(sha256Hex(arm.context));
      expect(Object.isFrozen(arm.traceIds)).toBe(true);
    }
    expect(Object.isFrozen(row.queryPlan)).toBe(true);
  } finally { await prepared.close(); }
});

test("causal admission precedes both pools, preserves global keys and includes the exact cutoff", async () => {
  const { prepared, capture } = fixture();
  try {
    await prepared.retrieve(query, "2024-01-01T00:00:00", capture());
    const later = "2024-01-03T00:00:00Z", row = await prepared.retrieve(query, later, capture(query, later));
    expect(row.eligibleTraceIds).toEqual(["semantic", "future", "lexical"]);
    expect(row.arms[1]!.traceIds[0]).toBe("future");
    await expect(prepared.retrieve(query, "2024-01-01T00:00:00", capture())).rejects.toThrow("chronological");
    await expect(prepared.retrieve(query, later, capture(query, later))).rejects.toThrow("failed");
  } finally { await prepared.close(); }
});

test("capture identity rejects normalized-query vectors, wrong scope, future/stale/duplicate hits and oversized pools", async () => {
  const mutations: ((row: CloneMemKeywordSemanticCapture, identity: ReturnType<typeof prepareCloneMemKeywordReplay>["identity"]) => unknown)[] = [
    row => ({ ...row, querySha256: sha256Hex(normalizeCloneMemKeywordQuery(query)) }),
    row => ({ ...row, personId: "another" }), row => ({ ...row, identitySha256: sha256Hex("other memory") }),
    row => ({ ...row, questionDate: "2024-01-02T00:00:00" }), row => ({ ...row, eligibleTraceIds: [...row.eligibleTraceIds, "future"] }),
    row => ({ ...row, eligibleTraceIds: [{}] }), row => ({ ...row, eligibleTraceIds: ["x".repeat(257)] }),
    row => ({ ...row, semanticCaptureSha256: sha256Hex("changed") }),
    row => ({ ...row, semanticCapture: [...row.semanticCapture, row.semanticCapture[0]!] }),
    (row, identity) => ({ ...row, semanticCapture: [{ ...row.semanticCapture[0]!, key: identity.records[1]!.key,
      recordSha256: identity.records[1]!.recordSha256 }] }),
    row => ({ ...row, semanticCapture: [{ ...row.semanticCapture[0]!, recordSha256: sha256Hex("stale") }] }),
    row => ({ ...row, semanticCapture: [{ ...row.semanticCapture[0]!, score: NaN }] }),
    row => ({ ...row, semanticCapture: Array.from({ length: 31 }, () => row.semanticCapture[0]!) }),
    row => ({ ...row, choices: [] }),
  ];
  for (const mutate of mutations) {
    const { prepared, capture } = fixture();
    try { await expect(prepared.retrieve(query, "2024-01-01T00:00:00",
      mutate(capture(), prepared.identity) as CloneMemKeywordSemanticCapture)).rejects.toThrow("CloneMem keyword replay"); }
    finally { await prepared.close(); }
  }
});

test("empty normalized lexical lane keeps semantic order; top30 capture and global lexical union return at most10 whole traces", async () => {
  const many: CloneMemMemory = { personId: "many", personName: "Person", traces: Array.from({ length: 40 }, (_, index) => ({
    id: `trace-${index}`, date: "2024-01-01T00:00:00", medium: "mail", content: `${index === 39 ? "rareterm" : "other"} ${"x".repeat(2_000)}` })) };
  const { prepared, capture } = fixture(many);
  try {
    const empty = "the and is you", date = "2024-01-01T00:00:00";
    const emptyRow = await prepared.retrieve(empty, date, capture(empty, date));
    expect(emptyRow.arms[1]!.traceIds).toEqual(emptyRow.arms[0]!.traceIds);
    const row = await prepared.retrieve("rareterm", date, capture("rareterm", date));
    expect(row.arms[0]!.traceIds).toEqual(Array.from({ length: 10 }, (_, index) => `trace-${index}`));
    expect(row.arms[1]!.traceIds[0]).toBe("trace-39"); // Outside semantic30; globally admitted lexical match.
    expect(row.arms[1]!.traceIds).toHaveLength(10);
    expect(row.arms[1]!.contextBytes).toBeGreaterThan(12_000);
    expect(row.arms[1]!.context).toContain(many.traces[39]!.content);
  } finally { await prepared.close(); }
});

test("owned close drains active replay, is idempotent and refuses later admission", async () => {
  const { prepared, capture } = fixture();
  const active = prepared.retrieve(query, "2024-01-01T00:00:00", capture());
  await expect(prepared.retrieve(query, "2024-01-01T00:00:00", capture())).rejects.toThrow("busy");
  const closing = prepared.close();
  expect(prepared.close()).toBe(closing);
  await active; await closing;
  await expect(prepared.retrieve(query, "2024-01-01T00:00:00", capture())).rejects.toThrow("closed");
});
