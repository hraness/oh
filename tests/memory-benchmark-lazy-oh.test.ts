import { expect, test, spyOn } from "bun:test";
import { createRetrievers, SYSTEMS } from "../scripts/benchmarks/retrieval";
import { OhSqliteStore } from "../src/sqlite/store";
import type { Corpus } from "../scripts/benchmarks/datasets";
const corpus: Corpus = { id: "raw", groupId: "g", turns: Array.from({ length: 16 }, (_, index) => ({
 id: `t${index}`, sessionId: `s${Math.floor(index / 4)}`, sessionIndex: Math.floor(index / 4), date: "2024-01-01", speaker: index % 2 ? "assistant" : "user",
 text: `I planted ${index % 3 ? "lemon trees" : "olive trees"} and counted ${index} plants. 🙂`,
})) };
const budget = { topK: 8, contextBytes: 4096 };
test("lazy authority preserves every non-fact retrieval output and native provenance", async () => {
 const eager = createRetrievers(corpus), lazy = createRetrievers(corpus, undefined, { lazyOh: true });
 try {
  expect(lazy.ohIngestMs).toBe(0);
  for (const system of SYSTEMS.filter(s => !s.includes("fact"))) {
   for (const contextBytes of [200,4096]) expect(await lazy.retrieve(system,"olive trees counted",{...budget,contextBytes})).toEqual(await eager.retrieve(system,"olive trees counted",{...budget,contextBytes}));
  }
  expect(lazy.ohIngestMs).toBeGreaterThan(0);
  expect(lazy.fullContextBytes).toBe(eager.fullContextBytes);
 } finally { eager.close(); lazy.close(); }
});
test("pure raw retrieval never opens an Oh authority; close cannot lazily reopen one", async () => {
 const closed = spyOn(OhSqliteStore.prototype,"close"), lazy = createRetrievers(corpus,undefined,{lazyOh:true});
 try {
  for (const system of ["bm25","bm25-focused","bm25-window","bm25-anchor-window","full-context","recent","no-memory"] as const) await lazy.retrieve(system,"olive trees",budget);
  expect(lazy.ohIngestMs).toBe(0);lazy.close();expect(closed).not.toHaveBeenCalled();
  await expect(lazy.retrieve("oh-window","olive trees",budget)).rejects.toThrow("closed");
  expect(()=>lazy.prepare(["oh-block"])).toThrow("closed");expect(closed).not.toHaveBeenCalled();
 } finally { closed.mockRestore(); }
});
test("lazy input snapshot keeps delayed native materialization consistent with raw indexing", async () => {
 const mutable = { ...corpus, turns: corpus.turns.map(t=>({...t})) }, lazy = createRetrievers(mutable,undefined,{lazyOh:true});
 const reference = createRetrievers(corpus);
 try {
  mutable.turns[0]!.text = "changed after construction";
  expect(await lazy.retrieve("oh-window","olive trees",budget)).toEqual(await reference.retrieve("oh-window","olive trees",budget));
  expect(await lazy.retrieve("bm25-window","olive trees",budget)).toEqual(await reference.retrieve("bm25-window","olive trees",budget));
 } finally { lazy.close();reference.close(); }
});
