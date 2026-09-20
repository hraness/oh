import { expect, test } from "bun:test";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { prepareEvolutionCorpus, type EvolutionRetrievalResult } from "../scripts/benchmarks/evolution-retrieval";
import { prepareEvolutionSemanticChronology } from "../scripts/benchmarks/evolution-semantic-chronology";
import { renderTurn } from "../scripts/benchmarks/retrieval";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";

const query = "What changed?";
const source: Corpus = { id: "synthetic-chronology", groupId: "synthetic-chronology", turns: [
  { id: "t9", sessionId: "repeated", sessionIndex: 7, date: "2030-03-03", speaker: "Zoë", text: "First source occurrence: café / café 🙂." },
  { id: "t2", sessionId: "earlier-name", sessionIndex: 0, date: "2020-01-01", speaker: "B", text: "Second source occurrence.\nPreserve this line." },
  { id: "t10", sessionId: "repeated", sessionIndex: 2, date: "2010-01-01", speaker: "A", text: "Third source occurrence, repeated session ID." },
  { id: "t1", sessionId: "repeated", sessionIndex: 2, date: "2010-01-01", speaker: "B", text: "An unretained detail must stay absent." },
  { id: "t5", sessionId: "last", date: "2000-01-01", speaker: "C", text: "Last source occurrence: −12°C, +3.50 kg; 中文." },
] };

async function fixture(ids = ["t5", "t2", "t9"], contextBytes = 24_000, corpus = source) {
  let records: readonly KnowledgeGraphRecordV1[] = [];
  const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index(value) { records = value; return { indexed: value.length, v: 1 }; },
    async search() { return ids.map((id, index) => {
      const record = records.find(record => (record.value as { id: string }).id === id)!;
      return { key: record.key, recordSha256: record.recordSha256, score: 1 - index / 100, v: 1 as const };
    }); }, async close() {} };
  const variant = { id: "semantic-test", system: "oh-semantic" as const, budget: { topK: 100, contextBytes } };
  const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
  try {
    const result = await prepared.retrieve(query, variant);
    return { variant, result, expectedResultSha256: result.resultSha256 };
  } finally { await prepared.close(); }
}

function rehash(result: EvolutionRetrievalResult): EvolutionRetrievalResult {
  const { resultSha256: _, ...payload } = result;
  return { ...payload, resultSha256: canonicalSha256(payload) };
}

test("chronology reorders only retained turns by source position and preserves every source witness", async () => {
  const parent = await fixture(), result = prepareEvolutionSemanticChronology(source)(query, parent);
  expect(parent.result.turnIds).toEqual(["t5", "t2", "t9"]);
  expect(result.turnIds).toEqual(["t9", "t2", "t5"]);
  expect(result.context).toBe([source.turns[0]!, source.turns[1]!, source.turns[4]!].map(renderTurn).join("\n\n"));
  expect(result.context).not.toContain("unretained detail");
  expect(result.sources).toEqual([parent.result.sources[2]!, parent.result.sources[1]!, parent.result.sources[0]!]);
  expect(result.witnesses.map(w => [w.turnId, w.corpusIndex, w.originalRank, w.rank])).toEqual([
    ["t9", 0, 2, 0], ["t2", 1, 1, 1], ["t5", 4, 0, 2],
  ]);
  expect(result.witnesses.map(w => w.turnSha256)).toEqual([0, 1, 4].map(i => canonicalSha256(source.turns[i]!)));
  expect(result.movedTurnCount).toBe(2);
  expect(result.inversionCount).toBe(3);
  expect(result.changed).toBeTrue();
  expect(result.addedTurnIds).toEqual([]);
  expect(result.removedTurnIds).toEqual([]);
  expect(result.originalOrderSha256).toBe(canonicalSha256(parent.result.turnIds));
  expect(result.orderSha256).toBe(canonicalSha256(result.turnIds));
  const { resultSha256, ...payload } = result;
  expect(resultSha256).toBe(canonicalSha256(payload));
});

test("repeated session IDs, dates and nonmonotonic session indices cannot override source occurrence order", async () => {
  const result = prepareEvolutionSemanticChronology(source)(query, await fixture(["t10", "t9", "t2"]));
  expect(result.turnIds).toEqual(["t9", "t2", "t10"]);
  expect(result.sessionIds).toEqual(["repeated", "earlier-name"]);
  expect(result.witnesses.map(w => w.corpusIndex)).toEqual([0, 1, 2]);
});

test("UTF-8 content and exact full budget survive reordering without normalization or added prose", async () => {
  const ids = ["t5", "t2", "t9"];
  const bytes = Buffer.byteLength([source.turns[4]!, source.turns[1]!, source.turns[0]!].map(renderTurn).join("\n\n"));
  const parent = await fixture(ids, bytes), result = prepareEvolutionSemanticChronology(source)(query, parent);
  expect(result.contextBytes).toBe(bytes);
  expect(result.contextBytes).toBe(parent.result.contextBytes);
  expect(result.budgetBytes).toBe(bytes);
  expect(result.contextSha256).toBe(sha256Hex(result.context));
  expect(result.originalContextSha256).toBe(parent.result.contextSha256);
  expect(result.context).toContain("café / café 🙂");
  expect(result.context).toContain("−12°C, +3.50 kg; 中文");
  expect(result.context.length).toBe(parent.result.context.length);
  expect(result.omittedForBudget).toBe(0);
});

test("an empty or already ordered ranking remains byte-identical", async () => {
  const run = prepareEvolutionSemanticChronology(source);
  for (const ids of [[], ["t2"], ["t9", "t2", "t5"]]) {
    const parent = await fixture(ids), result = run(query, parent);
    expect(result.context).toBe(parent.result.context);
    expect(result.orderSha256).toBe(result.originalOrderSha256);
    expect<string>(result.contextSha256).toBe(result.originalContextSha256);
    expect(result.changed).toBeFalse();
    expect(result.movedTurnCount).toBe(0);
    expect(result.inversionCount).toBe(0);
  }
});

test("historical budget omissions stay omitted rather than being recovered by reordering", async () => {
  const bytes = Buffer.byteLength(renderTurn(source.turns[4]!));
  const parent = await fixture(["t5", "t2", "t9"], bytes);
  expect(parent.result.omittedForBudget).toBe(2);
  const result = prepareEvolutionSemanticChronology(source)(query, parent);
  expect(result.turnIds).toEqual(["t5"]);
  expect(result.originalOmittedForBudget).toBe(2);
  expect(result.omittedForBudget).toBe(0);
});

test("a once-detached source snapshot ignores grading getters and later mutations", async () => {
  let textReads = 0, turnsReads = 0;
  const original = source.turns[0]!;
  const turns = [{ ...original, get text() { return ++textReads === 1 ? original.text : "forged second read"; } }, ...source.turns.slice(1).map(t => ({ ...t }))];
  Object.defineProperty(turns[1], "answer", { get() { throw Error("gold read"); } });
  const input = { ...source, get turns() { turnsReads++; return turns; }, get labels(): never { throw Error("labels read"); } };
  const run = prepareEvolutionSemanticChronology(input), parent = await fixture();
  turns[1]!.text = "mutated after snapshot";
  const result = run(query, parent);
  expect(textReads).toBe(1);
  expect(turnsReads).toBe(1);
  expect(result.context).toContain(original.text);
  expect(result.context).toContain(source.turns[1]!.text);
  expect(result.context).not.toContain("forged second read");
  expect(result.witnesses[0]!.turnSha256).toBe(canonicalSha256(original));
  expect(Object.isFrozen(result.sources[0])).toBeTrue();
  expect(Object.isFrozen(result.turnIds)).toBeTrue();
});

test("question, variant, budget and external parent pin mismatches fail closed", async () => {
  const parent = await fixture(), run = prepareEvolutionSemanticChronology(source);
  expect(() => run("another question", parent)).toThrow();
  expect(() => run(query, { ...parent, expectedResultSha256: "0".repeat(64) })).toThrow();
  expect(() => run(query, { ...parent, variant: { ...parent.variant, system: "bm25-window" } })).toThrow();
  expect(() => run(query, { ...parent, variant: { ...parent.variant, budget: { topK: 101, contextBytes: 24_000 } } })).toThrow();
  const variant = { ...parent.variant, budget: { topK: 100, contextBytes: parent.result.contextBytes - 1 } };
  const result = rehash({ ...parent.result, variantSha256: canonicalSha256(variant) });
  expect(() => run(query, { variant, result, expectedResultSha256: result.resultSha256 })).toThrow();
});

test("coherently rehashed text or provenance forgeries still fail native source authentication", async () => {
  const parent = await fixture(), run = prepareEvolutionSemanticChronology(source);
  const context = parent.result.context.replace("Second source", "Forged source");
  const forgedText = rehash({ ...parent.result, context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context) });
  expect(() => run(query, { ...parent, result: forgedText, expectedResultSha256: forgedText.resultSha256 })).toThrow();
  const forgedSource = rehash({ ...parent.result, sources: parent.result.sources.map((s, i) => i ? s : { ...s, recordSha256: "0".repeat(64) }) });
  expect(() => run(query, { ...parent, result: forgedSource, expectedResultSha256: forgedSource.resultSha256 })).toThrow();
  const changed = { ...source, turns: source.turns.map((t, i) => i === 3 ? { ...t, text: "Even unretained source changed" } : t) };
  expect(() => prepareEvolutionSemanticChronology(changed)(query, parent)).toThrow();
});

test("source population bounds and duplicate IDs are rejected", () => {
  expect(() => prepareEvolutionSemanticChronology({ ...source, turns: [] })).toThrow();
  expect(() => prepareEvolutionSemanticChronology({ ...source, turns: Array(8193).fill(source.turns[0]) })).toThrow();
  expect(() => prepareEvolutionSemanticChronology({ ...source, turns: [source.turns[0]!, source.turns[0]!] })).toThrow();
});

test("parent accessors are rejected without reading a changing retained set", async () => {
  const parent = await fixture(); let reads = 0;
  const result = { ...parent.result, get turnIds() { reads++; return parent.result.turnIds; } };
  expect(() => prepareEvolutionSemanticChronology(source)(query, { ...parent, result })).toThrow();
  expect(reads).toBe(0);
});
