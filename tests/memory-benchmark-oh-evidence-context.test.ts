import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderOhAuthorLogV1, renderOhSessionZoomV1 } from "../src/author-log";
import { utf8ByteLength } from "../src/canonical";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import { prepareEvolutionCorpus } from "../scripts/benchmarks/evolution-retrieval";
import { createOhEvidenceContextGeneratorV1 } from "../scripts/benchmarks/oh-evidence-context-run";
import type { Turn } from "../scripts/benchmarks/datasets";
import { fuseOhNativeRanksV1, packOhEvidenceContextV1, projectOhEvidenceTurnsV1,
  type OhNativeRankListV1 } from "../scripts/benchmarks/oh-evidence-context";

const turn = (id: string, text = id, sessionIndex = 0, speaker = "user"): Turn =>
  ({ id, text, sessionId: `s${sessionIndex}`, sessionIndex, speaker, date: "2026-05-06T12:00:00.000Z" });
const list = (source: string, ...ids: string[]): OhNativeRankListV1 => ({ source, kind: source === "lexical" ? "lexical" : "vector",
  stage: "native", hits: ids.map((turnId, index) => ({ turnId, rank: index + 1 })) });

describe("source-order evidence projection", () => {
  test("does not confuse outer session numbers with numeric turn ordinals above nine", () => {
    const turns = [2, 10].flatMap(session => Array.from({ length: 13 }, (_, index) =>
      turn(`s${session}:${index}`, `message ${index}`, session, index % 2 === 0 ? "user" : "assistant")));
    const projection = projectOhEvidenceTurnsV1(turns);
    const records = [...projection.records].reverse(); // Storage order must not change the source order.
    const options = { asOf: null, view: projection.view, sessionOrder: projection.sessionOrder };
    const zoom = renderOhSessionZoomV1({ question: "message", ranked: records.map(record => ({ record })), records }, options);
    expect(zoom.keys).toEqual(projection.records.map(record => record.key));
    const log = renderOhAuthorLogV1({ ranked: records.map(record => ({ record })), records }, options);
    const source = projection.byTurnId;
    expect(log.keys.slice(0, 7)).toEqual(Array.from({ length: 7 }, (_, index) => source.get(`s2:${index * 2}`)!.record.key));
    expect(log.text).toContain(`assistant (follows [${source.get("s2:10")!.record.key}]): message 11`);
    expect(projection.view(source.get("s2:10")!.record).order).toBe(10);
    expect(source.get("s2:10")!.record.value).toMatchObject({ turnIndex: 10, sourceSessionOrder: 2 });
    expect(source.get("s2:10")!.record.value).not.toHaveProperty("sessionIndex");
  });

  test("explicit positions survive corpus storage permutation and numeric IDs are unnecessary", () => {
    const turns = [turn("z", "first"), turn("a", "second"), turn("j", "third")];
    const positions = turns.map((source, index) => ({ turnId: source.id, sessionOrder: 0, turnOrder: index }));
    const a = projectOhEvidenceTurnsV1(turns, { positions });
    const b = projectOhEvidenceTurnsV1([...turns].reverse(), { positions });
    const rankings = [list("lexical", "a")];
    expect(packOhEvidenceContextV1({ projection: a, rankings }, { contextBytes: 2000 }))
      .toEqual(packOhEvidenceContextV1({ projection: b, rankings }, { contextBytes: 2000 }));
    expect(a.records).toEqual(b.records);
  });

  test("separates repeated named session occurrences and never opens unrelated source properties", () => {
    const first = { ...turn("a", "first", 2), sessionId: "same" };
    Object.defineProperty(first, "answer", { get() { throw new Error("Gold must remain unread."); } });
    const projection = projectOhEvidenceTurnsV1([first, { ...turn("b", "second", 10), sessionId: "same" }]);
    expect(projection.turns.map(item => item.turnOrder)).toEqual([0, 0]);
    expect(projection.turns[0]!.session).not.toBe(projection.turns[1]!.session);
    const context = packOhEvidenceContextV1({ projection, rankings: [list("lexical", "b")] }, { contextBytes: 2000 });
    expect(context.turnIds).toEqual(["b"]); // Adjacency cannot cross a session occurrence.
  });

  test("fails closed on ambiguous or missing source identity and invalid dates", () => {
    expect(() => projectOhEvidenceTurnsV1([turn("a"), turn("a")])).toThrow("Duplicate");
    expect(() => projectOhEvidenceTurnsV1([turn("a")], { positions: [] })).toThrow("cover every");
    expect(() => projectOhEvidenceTurnsV1([turn("a"), turn("b")], { positions: [
      { turnId: "a", sessionOrder: 0, turnOrder: 0 }, { turnId: "b", sessionOrder: 0, turnOrder: 0 }] })).toThrow("Duplicate source");
    expect(() => projectOhEvidenceTurnsV1([turn("a", "second", 2), turn("b", "tenth", 10)], { positions: [
      { turnId: "a", sessionOrder: 0, turnOrder: 0 }, { turnId: "b", sessionOrder: 0, turnOrder: 0 }] })).toThrow("Duplicate source session");
    expect(() => projectOhEvidenceTurnsV1([turn("a"), { ...turn("b"), sessionId: "different" }])).toThrow("Duplicate source session");
    expect(() => projectOhEvidenceTurnsV1([turn("a")], { dependencies: [{ turnId: "a", sourceTurnIds: ["missing"] }] })).toThrow("dependency");
    expect(() => projectOhEvidenceTurnsV1([{ ...turn("a"), date: "someday" }])).toThrow("timestamp");
  });
});

describe("opt-in native candidate generator", () => {
  test("local CLI writes a fresh synthetic context and refuses to overwrite it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oh-evidence-cli-"));
    try {
      const corpus = join(directory, "corpus.json"), query = join(directory, "question.txt"), output = join(directory, "context.json");
      await writeFile(corpus, JSON.stringify({ id: "invented-cli", groupId: "invented", turns: [turn("source", "The crimson kayak.")] }));
      await writeFile(query, "kayak");
      const command = [process.execPath, "scripts/benchmarks/oh-evidence-context-run.ts", "--corpus", corpus, "--query", query, "--output", output];
      const first = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
      expect(await first.exited).toBe(0);
      const original = await readFile(output, "utf8"), result = JSON.parse(original);
      expect(result.rendering.turnIds).toEqual(["source"]);
      expect(result.rankings[0].stage).toBe("native");
      const second = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
      expect(await second.exited).not.toBe(0);
      expect(await readFile(output, "utf8")).toBe(original);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  test("native lexical candidates survive a context budget that clips every prior result", async () => {
    const corpus = { id: "invented-native", groupId: "invented", turns: [turn("a", "kayak " + "long ".repeat(100)), turn("b", "kayak " + "word ".repeat(80))] };
    const prepared = await prepareEvolutionCorpus(corpus);
    try {
      const clipped = await prepared.retrieve("kayak", { id: "tiny", system: "bm25-window", budget: { topK: 10, contextBytes: 1 } });
      const native = await prepared.nativeRanks("kayak", { source: "bm25", kind: "lexical", topK: 10 });
      expect(clipped.turnIds).toEqual([]);
      expect(native.hits).toHaveLength(2);
      expect(native.hits.map(hit => hit.rank)).toEqual([1, 2]);
      expect(native.sources.map(source => source.turnId)).toEqual(native.hits.map(hit => hit.turnId));
      expect(native.preparedSha256).toBe(prepared.identity.preparedSha256);
      await expect(prepared.nativeRanks("kayak", { source: "bm25", kind: "lexical", topK: 401 })).rejects.toThrow("options");
    } finally { await prepared.close(); }
    await expect(prepared.nativeRanks("kayak", { source: "bm25", kind: "lexical", topK: 2 })).rejects.toThrow("closed");
  });

  test("generator invokes native ranking then packs and binds immutable run identities", async () => {
    const generator = await createOhEvidenceContextGeneratorV1({ id: "invented-generator", groupId: "invented", turns: [
      turn("question", "Which boat did I choose?"), turn("answer", "The crimson kayak.")] });
    try {
      const result = await generator.generate("kayak", { contextBytes: 2000, topK: 10 });
      expect(result.rankings[0]!.stage).toBe("native");
      expect(result.rankings[0]!.hits.map(hit => hit.turnId)).toEqual(["answer"]);
      expect(result.rendering.turnIds).toEqual(["question", "answer"]);
      expect(result.runSha256).toHaveLength(64);
      expect(result.config.vector).toBe(false);
      expect(Object.isFrozen(result.config)).toBe(true);
      expect(Object.isFrozen(result.rankings)).toBe(true);
      expect(Object.isFrozen(generator.projection.records[0])).toBe(true);
      expect(Object.isFrozen(generator.projection.records[0]!.value)).toBe(true);
      expect(Object.isFrozen(generator.projection.records[0]!.dependencies)).toBe(true);
      expect(generator.projection.byTurnId).not.toHaveProperty("set");
      expect(await generator.generate("kayak", { contextBytes: 2000, topK: 10 })).toEqual(result);
    } finally { await generator.close(); }
  });

  test("vector native reads fail explicitly and close the backend even after failure", async () => {
    let closes = 0;
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { return { indexed: records.length, v: 1 }; },
      async search() { throw new Error("invented backend unavailable"); }, async close() { closes += 1; } };
    const generator = await createOhEvidenceContextGeneratorV1({ id: "invented-failure", groupId: "invented", turns: [turn("a", "kayak")] },
      { semanticBackend: backend });
    try {
      await expect(generator.generate("kayak", { contextBytes: 1000, topK: 10, vector: true })).rejects.toThrow("fallback");
    } finally { await generator.close(); }
    expect(closes).toBe(1);
  });

  test("configuration is detached before an asynchronous native query", async () => {
    const config = { contextBytes: 1000, topK: 10, vector: true };
    let captured: readonly KnowledgeGraphRecordV1[] = [];
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { captured = records; return { indexed: records.length, v: 1 }; },
      async search() { config.contextBytes = 0; config.topK = 1;
        return [{ key: captured[0]!.key, recordSha256: captured[0]!.recordSha256, score: 1, v: 1 }]; }, async close() {} };
    const generator = await createOhEvidenceContextGeneratorV1({ id: "invented-settings", groupId: "invented", turns: [turn("a", "kayak")] },
      { semanticBackend: backend });
    try {
      const result = await generator.generate("kayak", config);
      expect(result.config.contextBytes).toBe(1000);
      expect(result.config.topK).toBe(10);
      expect(result.rendering.turnIds).toEqual(["a"]);
    } finally { await generator.close(); }
  });

  test("native vector reads retain drain-before-close and reject stale digest joins", async () => {
    let captured: readonly KnowledgeGraphRecordV1[] = [], release!: () => void, entered!: () => void, closes = 0;
    const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { captured = records; return { indexed: records.length, v: 1 }; },
      async search() { entered(); await waiting; return [{ key: captured[0]!.key, recordSha256: captured[0]!.recordSha256, score: 1, v: 1 }]; },
      async close() { closes += 1; } };
    const prepared = await prepareEvolutionCorpus({ id: "invented-drain", groupId: "invented", turns: [turn("a", "kayak")] }, { semanticBackend: backend });
    const pending = prepared.nativeRanks("kayak", { source: "vector", kind: "vector", topK: 10 });
    await started;
    const closing = prepared.close();
    await expect(prepared.nativeRanks("kayak", { source: "lexical", kind: "lexical", topK: 10 })).rejects.toThrow("closed");
    expect(closes).toBe(0); release();
    expect((await pending).hits).toEqual([{ turnId: "a", rank: 1 }]);
    await closing; expect(closes).toBe(1);
    const stale = await prepareEvolutionCorpus({ id: "invented-stale", groupId: "invented", turns: [turn("a", "kayak")] },
      { semanticBackend: { profile: OH_EMBEDDING_PROFILE_V1, async index(records) { captured = records; return { indexed: records.length, v: 1 }; },
        async search() { return [{ key: captured[0]!.key, recordSha256: "0".repeat(64), score: 1, v: 1 }]; }, async close() {} } });
    try { await expect(stale.nativeRanks("kayak", { source: "vector", kind: "vector", topK: 10 })).rejects.toThrow("fallback"); }
    finally { await stale.close(); }
  });
});

describe("native fusion before atomic support packing", () => {
  test("a dual-source anchor wins before clipping or neighbor expansion", () => {
    const projection = projectOhEvidenceTurnsV1([turn("lexical-only", "x".repeat(5000)), turn("shared", "supported answer"), turn("vector-only")]);
    const rankings = [list("lexical", "lexical-only", "shared"), list("vector", "vector-only", "shared")];
    const result = packOhEvidenceContextV1({ projection, rankings }, { contextBytes: 150, topK: 1, previousTurns: 0, nextTurns: 0 });
    expect(result.turnIds).toEqual(["shared"]);
    expect(result.anchors.map(anchor => anchor.turnId)).toEqual(["shared"]);
    expect(fuseOhNativeRanksV1([...rankings].reverse())).toEqual(fuseOhNativeRanksV1(rankings));
    const expanded = packOhEvidenceContextV1({ projection, rankings }, { contextBytes: 10_000, topK: 1 });
    expect(expanded.turnIds).toEqual(["lexical-only", "shared", "vector-only"]);
    expect(expanded.anchors).toEqual(result.anchors); // Support membership never becomes a native rank.
  });

  test("adopts an explicit correction only together with its transitive source chain", () => {
    const projection = projectOhEvidenceTurnsV1([turn("original", "I use the red kayak.", 0),
      turn("correction", "Correction: I use the blue kayak.", 1), turn("adoption", "Yes, that one.", 2)],
    { dependencies: [{ turnId: "adoption", sourceTurnIds: ["correction"] }, { turnId: "correction", sourceTurnIds: ["original"] }] });
    const input = { projection, rankings: [list("lexical", "adoption")] };
    const complete = packOhEvidenceContextV1(input, { contextBytes: 10_000, previousTurns: 0, nextTurns: 0 });
    expect(complete.turnIds).toEqual(["original", "correction", "adoption"]);
    expect(packOhEvidenceContextV1(input, { contextBytes: complete.contextBytes, previousTurns: 0, nextTurns: 0 })).toEqual(complete);
    const short = packOhEvidenceContextV1(input, { contextBytes: complete.contextBytes - 1, previousTurns: 0, nextTurns: 0 });
    expect(short.turnIds).toEqual([]);
    expect(short.omittedForBudget).toBe(1);
    expect(short.bundles[0]!.turnIds).toEqual(complete.turnIds);
  });

  test("neighbor support carries its own dependencies, shared support is charged once, cycles terminate", () => {
    const projection = projectOhEvidenceTurnsV1([turn("prior", "previous source", 0), turn("reply", "that one", 1), turn("anchor", "specific anchor", 1)],
      { dependencies: [{ turnId: "reply", sourceTurnIds: ["prior"] }, { turnId: "prior", sourceTurnIds: ["reply"] }] });
    const full = packOhEvidenceContextV1({ projection, rankings: [list("lexical", "anchor", "reply")] }, { contextBytes: 1000 });
    expect(full.turnIds).toEqual(["prior", "reply", "anchor"]);
    expect(full.contextBytes).toBe(utf8ByteLength(full.context));
    expect(full.bundles.every(bundle => bundle.included)).toBe(true);
    const exact = packOhEvidenceContextV1({ projection, rankings: [list("lexical", "anchor", "reply")] }, { contextBytes: full.contextBytes });
    expect(exact).toEqual(full);
  });

  test("Unicode byte boundaries remain atomic across multiple budgets", () => {
    const projection = projectOhEvidenceTurnsV1([turn("a", "🛶 café"), turn("b", "sí — adopted")]);
    const input = { projection, rankings: [list("lexical", "b")] };
    const full = packOhEvidenceContextV1(input, { contextBytes: 1000 });
    for (const contextBytes of [0, 1, full.contextBytes - 1, full.contextBytes, full.contextBytes + 1]) {
      const result = packOhEvidenceContextV1(input, { contextBytes });
      expect(result.contextBytes).toBeLessThanOrEqual(contextBytes);
      expect(result.turnIds).toEqual(contextBytes < full.contextBytes ? [] : ["a", "b"]);
    }
  });

  test("an oversized bundle cannot starve a smaller independent complete bundle", () => {
    const projection = projectOhEvidenceTurnsV1([turn("huge", "x".repeat(1000), 0), turn("small", "small", 1)]);
    const result = packOhEvidenceContextV1({ projection, rankings: [list("lexical", "huge", "small")] }, { contextBytes: 100 });
    expect(result.turnIds).toEqual(["small"]);
    expect(result.omittedForBudget).toBe(1);
  });

  test("unrelated unranked dialogue and repeated rank-list ordering do not alter selected evidence", () => {
    const turns = [turn("referent", "the blue kayak"), turn("answer", "I chose that one")];
    const rankings = [list("lexical", "answer")], options = { contextBytes: 1000, nextTurns: 0 };
    const before = packOhEvidenceContextV1({ projection: projectOhEvidenceTurnsV1(turns), rankings }, options);
    const after = packOhEvidenceContextV1({ projection: projectOhEvidenceTurnsV1([...turns, turn("noise", "unrelated weather", 9)]), rankings }, options);
    expect(after).toEqual(before);
    expect(() => packOhEvidenceContextV1({ projection: projectOhEvidenceTurnsV1([turns[1]!],
      { dependencies: [{ turnId: "answer", sourceTurnIds: ["referent"] }] }), rankings }, options)).toThrow("dependency");
  });

  test("rejects expanded/clipped lists, duplicate votes, invalid native ranks and unmapped hits", () => {
    expect(() => fuseOhNativeRanksV1([{ ...list("lexical", "a"), stage: "packed" } as never])).toThrow("native");
    expect(() => fuseOhNativeRanksV1([list("lexical", "a", "a")])).toThrow("Duplicate");
    expect(() => fuseOhNativeRanksV1([list("lexical", "a"), list("lexical", "b")])).toThrow("distinct");
    expect(() => fuseOhNativeRanksV1([{ ...list("lexical", "a"), hits: [{ turnId: "a", rank: 0 }] }])).toThrow("rank");
    expect(() => packOhEvidenceContextV1({ projection: projectOhEvidenceTurnsV1([turn("a")]), rankings: [list("lexical", "missing")] },
      { contextBytes: 1000 })).toThrow("unknown source");
  });
});
