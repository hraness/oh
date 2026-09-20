import { expect, test } from "bun:test";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { prepareEvolutionCorpus } from "../scripts/benchmarks/evolution-retrieval";
import { prepareEvolutionSemanticNeighborhood } from "../scripts/benchmarks/evolution-semantic-neighborhood";
import { prepareEvolutionSemanticCompletion } from "../scripts/benchmarks/evolution-semantic-completion";
import { renderTurn } from "../scripts/benchmarks/retrieval";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import { canonicalSha256 } from "../src/canonical";

const query = "What changed?";
const source: Corpus = { id: "synthetic-neighborhood", groupId: "synthetic-neighborhood", turns: [
  { id: "t0", sessionId: "s1", sessionIndex: 0, date: "2028-01-01", speaker: "A", text: "The older context." },
  { id: "t1", sessionId: "s1", sessionIndex: 0, date: "2028-01-01", speaker: "B", text: "It changed yesterday. 🙂" },
  { id: "t2", sessionId: "s1", sessionIndex: 0, date: "2028-01-01", speaker: "A", text: "The follow-up." },
  { id: "t3", sessionId: "s1", sessionIndex: 1, date: "2028-01-02", speaker: "B", text: "Repeated session name, different occurrence." },
  { id: "t4", sessionId: "s2", sessionIndex: 2, date: "2028-01-03", speaker: "A", text: "A different session." },
] };

async function fixture(ids = ["t1"], contextBytes = 24_000, corpus = source) {
  let records: readonly KnowledgeGraphRecordV1[] = [];
  const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index(value) { records = value; return { indexed: value.length, v: 1 }; },
    async search(_query, _limit, authority) { return ids.map((id, index) => {
      const r = records.find(record => (record.value as { id: string }).id === id)!;
      expect(authority.get(r.key)?.recordSha256).toBe(r.recordSha256);
      return { key: r.key, recordSha256: r.recordSha256, score: 1 - index / 100, v: 1 as const };
    }); }, async close() {} };
  const variant = { id: "semantic-test", system: "oh-semantic" as const, budget: { topK: 100, contextBytes } };
  const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
  try {
    const result = await prepared.retrieve(query, variant);
    return { variant, result, expectedResultSha256: result.resultSha256 };
  } finally { await prepared.close(); }
}

test("neighborhood includes exact adjacent sources and records every added witness", async () => {
  const parent = await fixture();
  const result = prepareEvolutionSemanticNeighborhood(source)(query, parent);
  expect(result.turnIds).toEqual(["t1", "t0", "t2"]);
  expect(result.context).toBe([source.turns[1]!, source.turns[0]!, source.turns[2]!].map(renderTurn).join("\n\n"));
  expect(result.witnesses.map(x => [x.turnId, x.anchorId, x.offset])).toEqual([["t1", "t1", 0], ["t0", "t1", -1], ["t2", "t1", 1]]);
  expect(result.addedTurnIds).toEqual(["t0", "t2"]);
  expect(result.removedTurnIds).toEqual([]);
  const { resultSha256, ...payload } = result;
  expect(resultSha256).toBe(canonicalSha256(payload));
});

test("adjacency cannot cross session identity or repeated session occurrence", async () => {
  expect(prepareEvolutionSemanticNeighborhood(source)(query, await fixture(["t2"])).turnIds).toEqual(["t2", "t1"]);
  expect(prepareEvolutionSemanticNeighborhood(source)(query, await fixture(["t3"])).turnIds).toEqual(["t3"]);
});

test("whole UTF-8 turns share the exact parent ceiling and displaced anchors stay visible", async () => {
  const ceiling = Buffer.byteLength(renderTurn(source.turns[1]!)) + 2 + Buffer.byteLength(renderTurn(source.turns[0]!));
  const result = prepareEvolutionSemanticNeighborhood(source)(query, await fixture(["t1", "t2"], ceiling));
  expect(result.contextBytes).toBe(ceiling);
  expect(result.turnIds).toEqual(["t1", "t0"]);
  expect(result.removedTurnIds).toEqual(["t2"]);
  expect(result.omittedForBudget).toBe(1);
  expect(result.context.endsWith(source.turns[0]!.text)).toBeTrue();
});

test("overlapping neighborhoods deduplicate without moving the first occurrence", async () => {
  const result = prepareEvolutionSemanticNeighborhood(source)(query, await fixture(["t1", "t2", "t0"]));
  expect(result.candidateTurnIds).toEqual(["t1", "t0", "t2"]);
  expect(result.turnIds).toEqual(["t1", "t0", "t2"]);
});

test("source, context, question and pinned parent tampering are rejected", async () => {
  const parent = await fixture(), run = prepareEvolutionSemanticNeighborhood(source);
  expect(() => run("Another question", parent)).toThrow();
  expect(() => run(query, { ...parent, expectedResultSha256: "0".repeat(64) })).toThrow();
  expect(() => run(query, { ...parent, result: { ...parent.result, context: "forged" } })).toThrow();
  expect(() => run(query, { ...parent, variant: { ...parent.variant, system: "bm25-window" } })).toThrow();
  const changed = { ...source, turns: source.turns.map((turn, i) => i === 0 ? { ...turn, text: "Changed neighbor" } : turn) };
  expect(() => prepareEvolutionSemanticNeighborhood(changed)(query, parent)).toThrow();
});

test("source copy ignores evaluator properties and is detached from subsequent mutation", async () => {
  const turns = source.turns.map(turn => ({ ...turn }));
  const input = { ...source, turns, get answers(): never { throw Error("gold read"); } };
  Object.defineProperty(turns[0], "evidence", { get() { throw Error("gold read"); } });
  const run = prepareEvolutionSemanticNeighborhood(input), parent = await fixture();
  turns[0]!.text = "later mutation";
  expect(run(query, parent).context).toContain("The older context.");
});

test("empty parent ranking stays empty; duplicated sources and oversized corpora are rejected", async () => {
  expect(prepareEvolutionSemanticNeighborhood(source)(query, await fixture([])).turnIds).toEqual([]);
  expect(() => prepareEvolutionSemanticNeighborhood({ ...source, turns: [source.turns[0]!, source.turns[0]!] })).toThrow();
  expect(() => prepareEvolutionSemanticNeighborhood({ ...source, turns: Array(8193).fill(source.turns[0]) })).toThrow();
});

test("completion keeps every original turn and the exact prefix before filling byte slack", async () => {
  const parent = await fixture(["t1", "t2"]);
  const result = prepareEvolutionSemanticCompletion(source)(query, parent);
  expect(result.turnIds).toEqual(["t1", "t2", "t0"]);
  expect(result.addedTurnIds).toEqual(["t0"]);
  expect(result.context.startsWith(parent.result.context + "\n\n")).toBeTrue();
  expect(result.originalContextSha256).toBe(parent.result.contextSha256);
  const { resultSha256, ...payload } = result;
  expect(resultSha256).toBe(canonicalSha256(payload));
});

test("completion cannot evict an original anchor when a neighbor would use its space", async () => {
  const ceiling = Buffer.byteLength([source.turns[1]!, source.turns[2]!].map(renderTurn).join("\n\n"));
  const parent = await fixture(["t1", "t2"], ceiling);
  const result = prepareEvolutionSemanticCompletion(source)(query, parent);
  expect(result.turnIds).toEqual(parent.result.turnIds);
  expect(result.context).toBe(parent.result.context);
  expect(result.addedTurnIds).toEqual([]);
  expect(result.omittedForBudget).toBe(1);
  expect(result.contextBytes).toBe(ceiling);
});

test("completion retains source validation, session bounds and detached values", async () => {
  const mutable = { ...source, turns: source.turns.map(turn => ({ ...turn })) };
  const run = prepareEvolutionSemanticCompletion(mutable), parent = await fixture(["t2"]);
  mutable.turns[1]!.text = "changed after construction";
  expect(run(query, parent).turnIds).toEqual(["t2", "t1"]);
  expect(run(query, parent).context).toContain("It changed yesterday. 🙂");
  expect(() => run(query, { ...parent, expectedResultSha256: "0".repeat(64) })).toThrow();
});

test("completion binds rendering to the one authenticated read of a source accessor", async () => {
  let reads = 0;
  const first = { ...source.turns[0]!, get text() { return ++reads === 1 ? source.turns[0]!.text : "forged neighbor"; } };
  const run = prepareEvolutionSemanticCompletion({ ...source, turns: [first, ...source.turns.slice(1)] });
  const result = run(query, await fixture());
  expect(reads).toBe(1);
  expect(result.context).toContain("The older context.");
  expect(result.context).not.toContain("forged neighbor");
  expect(result.witnesses.find(w => w.turnId === "t0")!.turnSha256).toBe(canonicalSha256(source.turns[0]!));
});
