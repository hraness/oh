import { describe, expect, test } from "bun:test";
import { utf8ByteLength } from "../src/canonical";
import type { KnowledgeGraphRecordV1 } from "../src/graph";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic";
import type { Turn } from "../scripts/benchmarks/datasets";
import { projectOhEvidenceTurnsV1, type OhNativeRankListV1 } from "../scripts/benchmarks/oh-evidence-context";
import { composeOhAuthorLogContextV1, createOhAuthorLogContextGeneratorV1, OH_AUTHOR_LOG_CONTEXT_PROTOCOL_V1,
  rankOhAuthorLogEvidenceV1, type OhAuthorLogContextOptionsV1 } from "../scripts/benchmarks/oh-author-log-context";

const turn = (id: string, text = id, sessionIndex = 0, speaker = "user", date = "2026-05-06T12:00:00.000Z"): Turn =>
  ({ id, text, sessionId: `s${sessionIndex}`, sessionIndex, speaker, date });
const list = (source: string, ...ids: string[]): OhNativeRankListV1 => ({ source, kind: source.startsWith("lexical") ? "lexical" : "vector",
  stage: "native", hits: ids.map((turnId, index) => ({ turnId, rank: index + 1 })) });
const options = (overrides: Partial<OhAuthorLogContextOptionsV1> = {}): OhAuthorLogContextOptionsV1 => ({ asOf: "2026-05-10T00:00:00.000Z",
  budgetBytes: 180_000, retrievedBytes: 96_000, logReserveBytes: 24_000, topK: 100, previousTurns: 1, nextTurns: 1, rrfK: 60, ...overrides });

describe("length-general author-log context (invented histories only)", () => {
  test("complete log keeps numeric session and turn order and retrieves an anchor's neighbors", () => {
    const turns = [10, 2].flatMap(session => Array.from({ length: 13 }, (_, index) =>
      turn(`s${session}:${index}`, `session ${session} message ${index}`, session, index % 2 === 0 ? "user" : "assistant")));
    const projection = projectOhEvidenceTurnsV1(turns), key = (id: string) => projection.byTurnId.get(id)!.record.key;
    const result = composeOhAuthorLogContextV1({ projection, rankings: [list("lexical", "s10:5")] }, options());
    expect(result.protocol).toBe(OH_AUTHOR_LOG_CONTEXT_PROTOCOL_V1);
    expect(result.log).toEqual({ bytes: expect.any(Number), included: 14, mode: "complete", total: 14 });
    expect(result.rankedTurnIds).toEqual(["s10:5", "s10:4", "s10:6"]);
    const at = (id: string) => result.context.indexOf(`[${key(id)}] user:`);
    expect(at("s2:2")).toBeLessThan(at("s2:10"));
    expect(at("s2:12")).toBeLessThan(at("s10:0"));
    expect(result.context).toContain(`assistant (follows [${key("s10:4")}]): session 10 message 5`);
    expect(result.contextBytes).toBe(utf8ByteLength(result.context));
    expect(Object.isFrozen(result.options)).toBeTrue();
  });

  test("a partial log admits fused anchors before recency and still renders chronologically", () => {
    const filler = (index: number) => ` ${"harbor ".repeat(30)}${index}`;
    const turns = Array.from({ length: 40 }, (_, index) => turn(`u${index}`, index === 3 ? `The zeppelin permit is due.${filler(index)}` : `Routine note${filler(index)}`,
      Math.floor(index / 10), "user", `2026-05-0${1 + Math.floor(index / 10)}T12:00:00.000Z`));
    const projection = projectOhEvidenceTurnsV1(turns), entry = (id: string) => `[${projection.byTurnId.get(id)!.record.key}] user:`;
    const result = composeOhAuthorLogContextV1({ projection, rankings: [list("lexical", "u3")] },
      options({ budgetBytes: 6_000, retrievedBytes: 1_000, logReserveBytes: 1_000 }));
    expect(result.log.mode).toBe("ranked");
    expect(result.log.included).toBeLessThan(40);
    expect(result.context).toContain("Partial log of user messages");
    expect(result.context).toContain(`${entry("u3")} The zeppelin permit is due.`);
    expect(result.context).toContain(entry("u39"));
    expect(result.context).not.toContain(entry("u0"));
    expect(result.context.indexOf(entry("u3"))).toBeLessThan(result.context.indexOf(entry("u39")));
    expect(result.contextBytes).toBeLessThanOrEqual(6_000);
  });

  test("fuses unclipped native lists before the anchor limit and expansion", () => {
    const projection = projectOhEvidenceTurnsV1(["a", "b", "c", "d"].map(id => turn(id)));
    const ranking = rankOhAuthorLogEvidenceV1(projection, [list("lexical", "a", "b", "c"), list("vector", "c", "d")],
      { topK: 2, previousTurns: 0, nextTurns: 0, rrfK: 60 });
    expect(ranking.anchors.map(anchor => anchor.turnId)).toEqual(["c", "a"]);
    expect(ranking.rankedTurnIds).toEqual(["c", "a"]);
    const reversed = rankOhAuthorLogEvidenceV1(projection, [list("vector", "c", "d"), list("lexical", "a", "b", "c")],
      { topK: 2, previousTurns: 0, nextTurns: 0, rrfK: 60 });
    expect(reversed).toEqual(ranking);
  });

  test("an anchor brings its explicit sources across sessions, listed once", () => {
    const projection = projectOhEvidenceTurnsV1([turn("source", "Use the red canoe", 0), turn("later", "Change that to blue", 1), turn("other", "Unrelated", 1)],
      { dependencies: [{ turnId: "later", sourceTurnIds: ["source"] }] });
    const ranking = rankOhAuthorLogEvidenceV1(projection, [list("lexical", "later", "source")], { topK: 10, previousTurns: 0, nextTurns: 0, rrfK: 60 });
    expect(ranking.rankedTurnIds).toEqual(["later", "source"]);
  });

  test("rejects invalid bounds, unknown ranked turns and duplicate votes before rendering", () => {
    const projection = projectOhEvidenceTurnsV1([turn("a")]);
    for (const bad of [{ budgetBytes: 0 }, { budgetBytes: 4_000_001 }, { budgetBytes: 1.5 }, { logReserveBytes: 180_001 },
      { retrievedBytes: 180_001 }, { topK: 0 }, { topK: 401 }, { previousTurns: 9 }, { nextTurns: -1 }, { rrfK: 0 }, { asOf: 5 as unknown as string }]) {
      expect(() => composeOhAuthorLogContextV1({ projection, rankings: [] }, options(bad))).toThrow();
    }
    expect(() => composeOhAuthorLogContextV1({ projection, rankings: [list("lexical", "missing")] }, options())).toThrow("unknown source turn");
    expect(() => composeOhAuthorLogContextV1({ projection, rankings: [{ ...list("lexical", "a"), hits: [{ turnId: "a", rank: 1 }, { turnId: "a", rank: 2 }] }] },
      options())).toThrow("Duplicate");
  });
});

describe("opt-in author-log context generator", () => {
  test("ranks natively, renders once and binds immutable run identities", async () => {
    const generator = await createOhAuthorLogContextGeneratorV1({ id: "invented-author-log", groupId: "invented", turns: [
      turn("question", "Which boat did I choose?"), turn("answer", "The crimson kayak.", 0, "assistant")] });
    try {
      const result = await generator.generate("kayak", { asOf: null });
      expect(result.rankings[0]!.stage).toBe("native");
      expect(result.rendering.rankedTurnIds).toEqual(["answer", "question"]);
      expect(result.rendering.context).toContain("The crimson kayak.");
      expect(result.config).toMatchObject({ budgetBytes: 180_000, retrievedBytes: 96_000, logReserveBytes: 24_000, topK: 100, vector: false });
      expect(result.runSha256).toHaveLength(64);
      expect(Object.isFrozen(result.config)).toBeTrue();
      expect(await generator.generate("kayak", { asOf: null })).toEqual(result);
      const scaled = await generator.generate("kayak", { asOf: null, budgetBytes: 36_000 });
      expect(scaled.config).toMatchObject({ budgetBytes: 36_000, retrievedBytes: 19_200, logReserveBytes: 4_800 });
      expect(scaled.rendering.log.mode).toBe("complete");
    } finally { await generator.close(); }
  });

  test("checks configuration before a semantic backend performs work", async () => {
    let searches = 0, captured: readonly KnowledgeGraphRecordV1[] = [];
    const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
      async index(records) { captured = records; return { indexed: records.length, v: 1 }; },
      async search() { searches += 1; return [{ key: captured[0]!.key, recordSha256: captured[0]!.recordSha256, score: 1, v: 1 }]; }, async close() {} };
    const generator = await createOhAuthorLogContextGeneratorV1({ id: "invented-bounds", groupId: "invented", turns: [turn("a", "kayak")] },
      { semanticBackend: backend });
    try {
      await expect(generator.generate("kayak", { asOf: null, vector: true, budgetBytes: 0 })).rejects.toThrow("budget");
      await expect(generator.generate("kayak", { asOf: null, vector: true, topK: 101 })).rejects.toThrow("ranking configuration");
      expect(searches).toBe(0);
      const result = await generator.generate("kayak", { asOf: null, vector: true, topK: 10 });
      expect(result.rankings.map(ranking => ranking.source)).toEqual(["bm25-native", "oh-vector-native"]);
      expect(searches).toBe(1);
    } finally { await generator.close(); }
  });
});
