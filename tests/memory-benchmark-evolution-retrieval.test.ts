import { describe, expect, test } from "bun:test";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { createEvolutionContextSourceValidator, evolutionQuestionFacets, EvolutionSemanticUnavailableError, prepareEvolutionCorpus,
  validateEvolutionContextSources, type EvolutionRetrievalResult, type EvolutionRetrievalSystem,
  type EvolutionRetrievalVariant } from "../scripts/benchmarks/evolution-retrieval";
import { createLabSession } from "../scripts/benchmarks/lab-session";
import { createRetrievers, renderTurn } from "../scripts/benchmarks/retrieval";

const corpus: Corpus = { id: "conversation-a", groupId: "family-a", turns: [
  { id: "a", sessionId: "s1", date: "2025-01-01", speaker: "Ada", text: "My kayak is crimson." },
  { id: "b", sessionId: "s1", date: "2025-01-01", speaker: "Lin", text: "We paddled on Sunday." },
  { id: "c", sessionId: "s2", date: "2025-02-01", speaker: "Ada", text: "My bicycle is turquoise." },
  { id: "d", sessionId: "s2", date: "2025-02-01", speaker: "Lin", text: "The bicycle has a basket." },
] };
const variant = (system: EvolutionRetrievalSystem, topK = 20, contextBytes = 24_000): EvolutionRetrievalVariant => ({
  id: `${system}:${topK}:${contextBytes}`, system, budget: { topK, contextBytes },
});

describe("evolution prepared raw-source retrieval", () => {
  test("matches legacy window, session and native keyword controls without rebuilding indexes", async () => {
    const prepared = await prepareEvolutionCorpus(corpus);
    const raw = createRetrievers(corpus, undefined, { lazyOh: true }), session = createLabSession(corpus);
    try {
      for (const question of ["What color is Ada's kayak?", "What does the bicycle have?", "snowflakes"]) {
        for (const contextBytes of [1, 130, 24_000]) {
          const window = await prepared.retrieve(question, variant("bm25-window", 2, contextBytes));
          expect(window.context).toBe((await raw.retrieve("bm25-window", question, { topK: 2, contextBytes })).context);
          const sessions = await prepared.retrieve(question, variant("bm25-session", 2, contextBytes));
          expect(sessions.context).toBe((await session.retrieve(question, { topK: 2, contextBytes })).context);
          const native = await prepared.retrieve(question, variant("oh-keyword", 2, contextBytes));
          expect(native.context).toBe((await raw.retrieve("oh-keyword", question, { topK: 2, contextBytes })).context);
          expect(native.contextBytes).toBeLessThanOrEqual(contextBytes);
          expect(native.sources.map(source => source.turnId)).toEqual([...native.turnIds]);
        }
      }
      expect(prepared.stats).toEqual({ rawIndexBuilds: 1, sessionIndexBuilds: 1, authorityBuilds: 1,
        semanticIndexBuilds: 0, queryCount: 27 });
    } finally { raw.close(); session.close(); await prepared.close(); }
  });

  test("never reads labels, detaches source text, and keys identity to changed content", async () => {
    const mutable = { ...corpus, turns: corpus.turns.map(turn => ({ ...turn })) };
    for (const value of [mutable, ...mutable.turns]) for (const key of ["answer", "evidence", "has_answer", "category"]) {
      Object.defineProperty(value, key, { get() { throw new Error("gold getter read"); }, enumerable: true });
    }
    const prepared = await prepareEvolutionCorpus(mutable), plain = await prepareEvolutionCorpus(corpus);
    try {
      expect(prepared.identity).toEqual(plain.identity);
      mutable.turns[0]!.text = "The source was replaced.";
      const result = await prepared.retrieve("kayak", variant("oh-keyword"));
      expect(result.context).toContain("crimson");
      expect(result.context).not.toContain("replaced");
      expect(result.contextSha256).toBe(sha256Hex(result.context));
      const { resultSha256, ...payload } = result;
      expect(resultSha256).toBe(canonicalSha256(payload));
      expect(JSON.parse(JSON.stringify(result))).toEqual(result);
      const changed = await prepareEvolutionCorpus(mutable);
      try { expect(changed.identity.preparedSha256).not.toBe(prepared.identity.preparedSha256); }
      finally { await changed.close(); }
    } finally { await prepared.close(); await plain.close(); }
  });

  test("covers distinctive query clauses under a whole-source UTF-8 budget", async () => {
    const noisy: Corpus = { id: "facets", groupId: "facets", turns: [
      ...Array.from({ length: 5 }, (_, index) => ({ id: `noise-${index}`, sessionId: `n${index}`,
        date: "2025", speaker: "Ada", text: "Kayak kayak kayak kayak kayak is discussed." })),
      { id: "color", sessionId: "boat", date: "2025", speaker: "Ada", text: "The kayak is crimson." },
      { id: "size", sessionId: "cycle", date: "2025", speaker: "Ada", text: "The bicycle is turquoise." },
    ] };
    const prepared = await prepareEvolutionCorpus(noisy);
    try {
      const budget = Buffer.byteLength(renderTurn(noisy.turns[0]!)) + Buffer.byteLength(renderTurn(noisy.turns[6]!)) + 2;
      for (const system of ["bm25-facets", "oh-facets"] as const) {
        const result = await prepared.retrieve("What color is the kayak and what color is the bicycle?", variant(system, 10, budget));
        expect(result.facets).toEqual(["color kayak", "color bicycle"]);
        expect(result.coverageKind).toBe("lexical-clause");
        expect(result.coveredFacets).toEqual([0, 1]);
        expect(result.turnIds).toContain("size");
        expect(result.contextBytes).toBeLessThanOrEqual(budget);
        expect(result.sources.every(source => noisy.turns.some(turn => turn.id === source.turnId))).toBe(true);
        expect(result).toEqual(await prepared.retrieve("What color is the kayak and what color is the bicycle?", variant(system, 10, budget)));
      }
      const tiny = await prepared.retrieve("kayak and bicycle", variant("bm25-facets", 10, 1));
      expect(tiny.context).toBe(""); expect(tiny.coveredFacets).toEqual([]);
    } finally { await prepared.close(); }
  });

  test("neighbors never cross repeated session occurrences and source instances stay isolated", async () => {
    const occurrence: Corpus = { id: "occurrences", groupId: "occurrences", turns: [
      { ...corpus.turns[0]!, sessionId: "same", sessionIndex: 0 },
      { ...corpus.turns[2]!, sessionId: "same", sessionIndex: 1 },
    ] };
    const left = await prepareEvolutionCorpus(occurrence), right = await prepareEvolutionCorpus({ ...occurrence,
      id: "other", turns: occurrence.turns.map(turn => ({ ...turn, text: "Other source." })) });
    try {
      const result = await left.retrieve("kayak", variant("bm25-window", 1));
      expect(result.turnIds).toEqual(["a"]);
      expect((await right.retrieve("kayak", variant("bm25-window", 1))).turnIds).toEqual([]);
      expect(left.identity.preparedSha256).not.toBe(right.identity.preparedSha256);
    } finally { await left.close(); await right.close(); }
  });

  test("rejects invalid bounds, preserves empty-query behavior, and closes idempotently", async () => {
    const prepared = await prepareEvolutionCorpus(corpus);
    await expect(prepared.retrieve("kayak", variant("bm25-window", 101))).rejects.toThrow("budget");
    await expect(prepared.retrieve("x".repeat(16_385), variant("bm25-window"))).rejects.toThrow("question");
    expect((await prepared.retrieve("???", variant("bm25-facets"))).context).toBe("");
    expect(evolutionQuestionFacets("a and b and c and d and e").length).toBeLessThanOrEqual(4);
    const firstClose = prepared.close(); expect(prepared.close()).toBe(firstClose); await firstClose;
    await expect(prepared.retrieve("kayak", variant("bm25-window"))).rejects.toThrow("closed");
    await expect(prepareEvolutionCorpus({ ...corpus, turns: [corpus.turns[0]!, corpus.turns[0]!] })).rejects.toThrow("Duplicate");
  });

  test("validates reused source contexts without rebuilding retrieval and rejects resealed source claims", async () => {
    const prepared = await prepareEvolutionCorpus(corpus), validate = createEvolutionContextSourceValidator(corpus);
    try {
      for (const system of ["bm25-window", "bm25-session", "oh-keyword", "bm25-facets", "oh-facets"] as const) {
        const result = await prepared.retrieve("kayak and bicycle", variant(system));
        const before = prepared.stats;
        validate(result); validateEvolutionContextSources(corpus, JSON.parse(JSON.stringify(result)) as EvolutionRetrievalResult);
        expect(prepared.stats).toEqual(before);
      }
      const original = await prepared.retrieve("kayak and bicycle", variant("bm25-facets"));
      for (const mutate of [
        (r: any) => { r.context = "Fabricated answer."; r.contextBytes = Buffer.byteLength(r.context); r.contextSha256 = sha256Hex(r.context); },
        (r: any) => { r.sources[0].recordSha256 = sha256Hex("different source"); },
        (r: any) => { r.sources[0].extra = "false provenance"; },
        (r: any) => { r.sources.pop(); },
        (r: any) => { r.turnIds[0] = "another-corpus-turn"; },
        (r: any) => { r.turnIds.push(r.turnIds[0]); },
        (r: any) => { r.sessionIds = ["another-session"]; },
        (r: any) => { r.coveredFacets = []; },
        (r: any) => { r.preparedSha256 = sha256Hex("another-corpus"); },
        (r: any) => { r.protocol = "future-unreviewed-protocol"; },
        (r: any) => { r.extra = "unrecognized field"; },
      ]) {
        const changed = structuredClone(original) as any; mutate(changed);
        const { resultSha256: _ignored, ...payload } = changed;
        changed.resultSha256 = canonicalSha256(payload);
        expect(() => validate(changed)).toThrow("source identity");
      }
      const changedCorpus = { ...corpus, turns: corpus.turns.map(turn => ({ ...turn, text: `${turn.text} changed` })) };
      expect(() => validateEvolutionContextSources(changedCorpus, original)).toThrow("source identity");
    } finally { await prepared.close(); }
  });
});

describe("evolution native semantic path", () => {
  test("missing or failed semantics is explicit, including hybrid", async () => {
    const unavailable = await prepareEvolutionCorpus(corpus);
    try {
      for (const system of ["oh-semantic", "oh-hybrid"] as const) {
        await expect(unavailable.retrieve("kayak", variant(system))).rejects.toBeInstanceOf(EvolutionSemanticUnavailableError);
      }
      expect((await unavailable.retrieve("kayak", variant("oh-keyword"))).turnIds).toContain("a");
    } finally { await unavailable.close(); }
    let closed = 0;
    const failing: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { return { indexed: records.length, v: 1 }; },
      async search() { throw new Error("backend offline"); }, async close() { closed += 1; } };
    const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: failing });
    try { await expect(prepared.retrieve("kayak", variant("oh-hybrid"))).rejects.toThrow("fallback"); }
    finally { await prepared.close(); }
    expect(closed).toBe(1);
  });

  test("shares one semantic preparation and calls actual native search with current authority", async () => {
    let captured: readonly KnowledgeGraphRecordV1[] = [], builds = 0, searches = 0, closes = 0;
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { captured = records; builds += 1; return { indexed: records.length, v: 1 }; },
      async search(_question, _limit, authority) {
        searches += 1;
        const source = captured[2]!;
        expect(authority.get(source.key)?.recordSha256).toBe(source.recordSha256);
        return [{ key: source.key, recordSha256: source.recordSha256, score: 0.95, v: 1 }];
      }, async close() { closes += 1; } };
    const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
    try {
      const [semantic, hybrid] = await Promise.all([
        prepared.retrieve("two-wheeled vehicle", variant("oh-semantic")),
        prepared.retrieve("kayak", variant("oh-hybrid")),
      ]);
      expect(semantic.turnIds).toEqual(["c"]);
      expect(hybrid.turnIds).toContain("a"); expect(hybrid.turnIds).toContain("c");
      expect(builds).toBe(1); expect(searches).toBe(2);
      expect(prepared.stats.semanticIndexBuilds).toBe(1);
      expect(prepared.identity.semanticProfileSha256).toBe(canonicalSha256(OH_EMBEDDING_PROFILE_V1));
      validateEvolutionContextSources(corpus, semantic, { semantic: true });
      expect(() => validateEvolutionContextSources(corpus, semantic)).toThrow("source identity");
    } finally { await prepared.close(); }
    expect(closes).toBe(1);
  });

  test("rejects authority mutation during retrieval rather than returning an old source", async () => {
    let captured: readonly KnowledgeGraphRecordV1[] = [];
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { captured = records; return { indexed: records.length, v: 1 }; },
      async search(_question, _limit, authority) {
        const original = captured[0]!;
        const changed = createKnowledgeGraphRecordV1({ key: original.key, kind: "edition", dependencies: [], v: 1,
          value: { ...corpus.turns[0]!, text: "Changed source." } });
        authority.commit({ actorId: "test", expectedHead: authority.head(), operationId: "op_changed",
          changes: [{ kind: "put", record: changed, v: 1 }] });
        return [{ key: original.key, recordSha256: original.recordSha256, score: 1, v: 1 }];
      }, async close() {} };
    const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
    try {
      await expect(prepared.retrieve("kayak", variant("oh-semantic"))).rejects.toThrow("authority changed");
      await expect(prepared.retrieve("kayak", variant("bm25-window"))).rejects.toThrow("authority changed");
    } finally { await prepared.close(); }
  });

  test("rejects a stale backend digest before native search can rejoin its key", async () => {
    let captured: readonly KnowledgeGraphRecordV1[] = [];
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { captured = records; return { indexed: records.length, v: 1 }; },
      async search() { return [{ key: captured[0]!.key, recordSha256: sha256Hex("stale"), score: 1, v: 1 }]; },
      async close() {} };
    const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
    try { await expect(prepared.retrieve("kayak", variant("oh-hybrid"))).rejects.toBeInstanceOf(EvolutionSemanticUnavailableError); }
    finally { await prepared.close(); }
  });

  test("close drains an admitted semantic read and fences new requests", async () => {
    let captured: readonly KnowledgeGraphRecordV1[] = [], release!: () => void, entered!: () => void, closes = 0;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { captured = records; return { indexed: records.length, v: 1 }; },
      async search() {
        entered(); await waiting;
        return [{ key: captured[0]!.key, recordSha256: captured[0]!.recordSha256, score: 1, v: 1 }];
      }, async close() { closes += 1; } };
    const prepared = await prepareEvolutionCorpus(corpus, { semanticBackend: backend });
    const pending = prepared.retrieve("kayak", variant("oh-semantic")); await started;
    const closing = prepared.close();
    await expect(prepared.retrieve("kayak", variant("oh-keyword"))).rejects.toThrow("closed");
    expect(closes).toBe(0); release();
    expect((await pending).turnIds).toEqual(["a"]); await closing; expect(closes).toBe(1);
  });
});
