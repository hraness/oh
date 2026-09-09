import { expect, test } from "bun:test";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { prepareEvolutionCorpus, validateEvolutionContextSources } from "../scripts/benchmarks/evolution-retrieval";
import { parseEvolutionExperimentVariant } from "../scripts/benchmarks/evolution-variants";
import { renderTurn } from "../scripts/benchmarks/retrieval";

const corpus: Corpus = { id: "opening", groupId: "opening", turns: [
  { id: "greeting", sessionId: "same", sessionIndex: 0, date: "2025-01-01", speaker: "assistant", text: "Welcome back." },
  { id: "opening", sessionId: "same", sessionIndex: 0, date: "2025-01-01", speaker: "user", text: "My destination is Montréal. 🛶" },
  { id: "bridge", sessionId: "same", sessionIndex: 0, date: "2025-01-01", speaker: "assistant", text: "Let us discuss the arrangements." },
  { id: "before", sessionId: "same", sessionIndex: 0, date: "2025-01-01", speaker: "user", text: "I am taking the night train." },
  { id: "hit", sessionId: "same", sessionIndex: 0, date: "2025-01-01", speaker: "assistant", text: "The quasar travel pass covers the journey." },
  { id: "after", sessionId: "same", sessionIndex: 0, date: "2025-01-01", speaker: "user", text: "Please keep that plan." },
  { id: "other", sessionId: "same", sessionIndex: 1, date: "2025-02-01", speaker: "user", text: "Different trip and occurrence." },
] };
const variant = (contextBytes: number) => parseEvolutionExperimentVariant({
  id: `opening:${contextBytes}`, system: "oh-focused-window-opening", budget: { topK: 1, contextBytes },
});

test("opening completion adds the first user source while preserving native hits and session occurrence", async () => {
  const mutable = structuredClone(corpus);
  for (const object of [mutable, ...mutable.turns]) for (const key of ["answer", "evidence", "category"]) {
    Object.defineProperty(object, key, { enumerable: true, get() { throw Error("No label access"); } });
  }
  const prepared = await prepareEvolutionCorpus(mutable);
  try {
    const candidate = variant(96_000);
    if (candidate.system === "oh-source-spans") throw Error("Unexpected span variant");
    const result = await prepared.retrieve("quasar", candidate);
    expect(result.turnIds).toEqual(["opening", "hit", "before", "after"]);
    expect(result.context).toContain("Montréal. 🛶");
    expect(result.turnIds).not.toContain("greeting");
    expect(result.turnIds).not.toContain("other");
    expect(result).toEqual(await prepared.retrieve("quasar", candidate));
    validateEvolutionContextSources(corpus, result);
    expect(result.omittedForBudget).toBe(0);
    const control = await prepared.retrieve("quasar", { ...candidate, system: "oh-focused-window" });
    expect(control.turnIds).toEqual(["hit", "before", "after"]);
    expect(prepared.stats.authorityBuilds).toBe(1);
  } finally { await prepared.close(); }
});

test("an opening cannot evict its introducing hit, and whole UTF-8 messages fit exactly", async () => {
  const prepared = await prepareEvolutionCorpus(corpus);
  const hitBytes = Buffer.byteLength(renderTurn(corpus.turns[4]!));
  const pairBytes = hitBytes + Buffer.byteLength(renderTurn(corpus.turns[1]!)) + 2;
  try {
    for (const [bytes, expected] of [[1, []], [hitBytes, ["hit"]], [pairBytes, ["opening", "hit"]]] as const) {
      const candidate = variant(bytes);
      if (candidate.system === "oh-source-spans") throw Error("Unexpected span variant");
      const result = await prepared.retrieve("quasar", candidate);
      expect(result.turnIds).toEqual([...expected]);
      expect(result.contextBytes).toBeLessThanOrEqual(bytes);
      expect(result.contextBytes).toBe(Buffer.byteLength(result.context));
      expect(result.omittedForBudget).toBe(bytes === pairBytes ? 2 : 3);
      validateEvolutionContextSources(corpus, result);
    }
  } finally { await prepared.close(); }
});

test("named-speaker conversations use their first source turn and unmatched sessions add nothing", async () => {
  const named: Corpus = { ...corpus, turns: corpus.turns.map(turn => ({ ...turn, speaker: turn.speaker === "user" ? "Ada" : "Lin" })) };
  const prepared = await prepareEvolutionCorpus(named);
  try {
    const candidate = variant(96_000);
    if (candidate.system === "oh-source-spans") throw Error("Unexpected span variant");
    expect((await prepared.retrieve("quasar", candidate)).turnIds).toEqual(["greeting", "hit", "before", "after"]);
    expect((await prepared.retrieve("unmatchedkeyword", candidate)).turnIds).toEqual([]);
    const openingHit = await prepared.retrieve("Montréal", candidate);
    expect(openingHit.turnIds.filter(id => id === "greeting")).toHaveLength(1);
    expect(new Set(openingHit.turnIds).size).toBe(openingHit.turnIds.length);
    validateEvolutionContextSources(named, openingHit);
  } finally { await prepared.close(); }
});
