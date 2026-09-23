import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, canonicalSha256 } from "../src/canonical";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { createSemanticProducer } from "../scripts/benchmarks/deductive-semantic";
import { readSemanticCache, semanticCachePath, semanticCorpusSha256, semanticRequest,
  semanticResult, writeSemanticCache, SEMANTIC_CACHE_LIMITS, type SemanticRank,
  type SemanticRequest } from "../scripts/benchmarks/deductive-semantic-cache";

const corpus: Corpus = { id: "one", groupId: "dev", turns: [
  { id: "s:0", sessionId: "s", date: "2023-01-01", speaker: "A", text: "I like hiking." },
  { id: "s:1", sessionId: "s", date: "2023-01-01", speaker: "B", text: "A trail near home." },
  { id: "s:2", sessionId: "s", date: "2023-01-01", speaker: "A", text: "We went yesterday." },
] };
const ids = new Set(corpus.turns.map((turn) => turn.id));
const digest = "sha256:" + "a".repeat(64);
const ranks = [{ turnId: "s:0", score: 0.8 }, { turnId: "s:1", score: 0.6 },
  { turnId: "s:2", score: 0.4 }];
const roots: string[] = [];
function root(): string { const path = mkdtempSync(join(tmpdir(), "oh-sem-replay-")); roots.push(path); return path; }
function request(rankLimit = 3, query = "Where did A hike?", topN = 2): SemanticRequest {
  return semanticRequest(semanticCorpusSha256(corpus), query, digest, 0.3, topN, rankLimit);
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("deductive semantic replay cache", () => {
  test("replays frozen ranked hits and declared facts without QMD or model access", async () => {
    const cacheRoot = root();
    const expected = writeSemanticCache(cacheRoot, request(), ranks, ids);
    for (const cacheMode of ["replay-only", "read-write"] as const) {
      const producer = await createSemanticProducer({ cacheRoot, cacheMode, topN: 2,
        qmdModulePath: "/missing/qmd", qmdCacheRoot: "/missing/index", modelPath: "/missing/model" });
      await producer.prepare(corpus);
      const result = await producer.searchAndFacts(request().query, digest, 3);
      expect(result).toEqual(expected);
      expect(Object.isFrozen(result.ranked)).toBe(true);
      expect(result.nearTurns).toEqual(["s:0", "s:1"]);
      await producer.close();
    }
  });

  test("raw query, corpus bytes, rank limit, thresholds and runtime identify separate requests", () => {
    const cacheRoot = root();
    const key = request();
    writeSemanticCache(cacheRoot, key, ranks, ids);
    for (const next of [request(3, "WHERE did A hike?"), request(2), { ...key, tau: 0.4 },
      { ...key, runtime: { ...key.runtime, bun: "different" } },
      { ...key, modelSha256: "b".repeat(64) },
      { ...key, corpusSha256: semanticCorpusSha256({ ...corpus, turns: corpus.turns.map((turn, index) =>
        index === 0 ? { ...turn, text: "I like swimming." } : turn) }) }]) {
      expect(semanticCachePath(cacheRoot, next)).not.toBe(semanticCachePath(cacheRoot, key));
      expect(readSemanticCache(cacheRoot, next, ids)).toBeNull();
    }
  });

  test("replay-only misses fail closed even when no runtime is installed", async () => {
    const producer = await createSemanticProducer({ cacheRoot: root(), cacheMode: "replay-only",
      qmdModulePath: "/missing/qmd" });
    await producer.prepare(corpus);
    await expect(producer.searchAndFacts("missing query", digest, 20)).rejects.toThrow("replay-only cache miss");
    await producer.close();
    await expect(producer.searchAndFacts("missing query", digest, 20)).rejects.toThrow("closed");
  });

  test("capture refuses unverified loaded model bytes before embedding and closes its store", async () => {
    const cacheRoot = root();
    const modules = join(cacheRoot, "node_modules");
    const qmdModulePath = join(modules, "@tobilu/qmd");
    for (const [name, version] of [["@tobilu/qmd", "2.5.3"], ["node-llama-cpp", "3.18.1"],
      ["sqlite-vec", "0.1.9"]]) {
      const path = join(modules, name!);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "package.json"), JSON.stringify({ name, version, type: "module", main: "index.js" }));
    }
    const modelPath = join(cacheRoot, "wrong.gguf");
    const calls = join(cacheRoot, "calls");
    writeFileSync(modelPath, "GGUF wrong model bytes");
    writeFileSync(join(qmdModulePath, "index.js"), `
      import { appendFileSync } from "node:fs";
      const call = (name) => appendFileSync(${JSON.stringify(calls)}, name + "\\n");
      export async function createStore() { call("open"); return {
        internal: { llm: { embedModelName: ${JSON.stringify(request().model)},
          async ensureEmbedModel() { call("model"); return { _modelPath: ${JSON.stringify(modelPath)} }; } } },
        async update() { call("update"); }, async embed() { call("embed"); },
        async close() { call("close"); }
      }; }
    `);
    const producer = await createSemanticProducer({ cacheRoot, qmdModulePath, topN: 2 });
    await producer.prepare(corpus);
    await expect(producer.searchAndFacts(request().query, digest, 3)).rejects.toThrow("model SHA-256 mismatch");
    await producer.close();
    expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual(["open", "model", "close"]);
    expect(existsSync(semanticCachePath(cacheRoot, request()))).toBe(false);
  });

  test("bounds persistent QMD corpus index count before loading the runtime", async () => {
    const cacheRoot = root();
    for (let i = 0; i < SEMANTIC_CACHE_LIMITS.indexes; i++) {
      mkdirSync(join(cacheRoot, "indexes", `prior-${i}`), { recursive: true });
    }
    const producer = await createSemanticProducer({ cacheRoot, qmdModulePath: "/missing/qmd" });
    await producer.prepare(corpus);
    await expect(producer.searchAndFacts(request().query, digest, 3)).rejects.toThrow("index count limit");
    await producer.close();
  });

  test("capture is immutable and create-or-verify rejects changed scores", () => {
    const cacheRoot = root();
    const first = writeSemanticCache(cacheRoot, request(), ranks, ids);
    expect(writeSemanticCache(cacheRoot, request(), ranks, ids)).toEqual(first);
    expect(() => writeSemanticCache(cacheRoot, request(), [{ turnId: "s:0", score: 0.9 },
      ...ranks.slice(1)], ids)).toThrow("immutable cache entry conflicts");
    expect(readSemanticCache(cacheRoot, request(), ids)).toEqual(first);
  });

  test("larger vector budgets do not change topN facts or their provenance", () => {
    const short = semanticResult(request(2), ranks.slice(0, 2), ids);
    const long = semanticResult(request(3), ranks, ids);
    expect(short.facts).toEqual(long.facts);
    expect(short.producerDigest).toBe(long.producerDigest);
    expect(long.nearTurns).toHaveLength(2);
    expect(long.ranked).toHaveLength(3);
  });

  test("rejects stale ids, duplicate hits, nonfinite/out-of-range scores and unsorted hits", () => {
    const invalid: readonly (readonly SemanticRank[])[] = [
      [{ turnId: "stale", score: 0.8 }], [ranks[0]!, ranks[0]!],
      [{ turnId: "s:0", score: Number.NaN }], [{ turnId: "s:0", score: Infinity }],
      [{ turnId: "s:0", score: -1.1 }], [{ turnId: "s:0", score: 1.1 }],
      [{ turnId: "s:0", score: -0 }], [...ranks].reverse(),
    ];
    for (const ranking of invalid) expect(() => semanticResult(request(), ranking, ids)).toThrow("invalid cached rank");
  });

  test("validates parsed records before trusting hashes or fact payloads", () => {
    for (const field of ["request", "rawRanks", "result", "sha256", "extra"]) {
      const cacheRoot = root();
      const key = request();
      writeSemanticCache(cacheRoot, key, ranks, ids);
      const path = semanticCachePath(cacheRoot, key);
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (field === "request") value.request.query += " changed";
      if (field === "rawRanks") value.rawRanks[0].turnId = "removed-turn";
      if (field === "result") value.result.facts[0].tuple = ["turn:wrong"];
      if (field === "sha256") value.sha256 = "0".repeat(64);
      if (field === "extra") value.extra = true;
      writeFileSync(path, canonicalJson(value));
      expect(() => readSemanticCache(cacheRoot, key, ids)).toThrow();
    }
  });

  test("content digest detects score tampering even below the semantic topN", () => {
    const cacheRoot = root();
    const key = request();
    writeSemanticCache(cacheRoot, key, ranks, ids);
    const path = semanticCachePath(cacheRoot, key);
    const value = JSON.parse(readFileSync(path, "utf8"));
    value.rawRanks[2].score = 0.39;
    value.result.ranked[2].score = 0.39;
    writeFileSync(path, canonicalJson(value));
    expect(() => readSemanticCache(cacheRoot, key, ids)).toThrow("content digest mismatch");
  });

  test("bounds query, rank, corpus, parsed entry size, and duplicate corpus ids", () => {
    expect(() => request(SEMANTIC_CACHE_LIMITS.rankLimit + 1)).toThrow("rankLimit");
    expect(() => request(3, "x".repeat(SEMANTIC_CACHE_LIMITS.queryBytes + 1))).toThrow("query");
    expect(() => semanticCorpusSha256({ ...corpus, turns: [corpus.turns[0]!, corpus.turns[0]!] })).toThrow("duplicate");
    const cacheRoot = root();
    writeSemanticCache(cacheRoot, request(), ranks, ids);
    writeFileSync(semanticCachePath(cacheRoot, request()), " ".repeat(SEMANTIC_CACHE_LIMITS.entryBytes + 1));
    expect(() => readSemanticCache(cacheRoot, request(), ids)).toThrow("byte limit");
  });

  test("vectorRank and factsFor replay through the same validated record mechanism", async () => {
    const cacheRoot = root();
    const key = request();
    const factsKey = semanticRequest(key.corpusSha256, key.query, digest, 0.3, 2, 0);
    const vectorKey = semanticRequest(key.corpusSha256, key.query,
      canonicalSha256({ query: key.query }), 0.3, 2, 3);
    writeSemanticCache(cacheRoot, factsKey, ranks.slice(0, 2), ids);
    writeSemanticCache(cacheRoot, vectorKey, ranks, ids);
    const producer = await createSemanticProducer({ cacheRoot, cacheMode: "replay-only", topN: 2 });
    await producer.prepare(corpus);
    expect((await producer.factsFor(key.query, digest)).nearTurns).toEqual(["s:0", "s:1"]);
    expect(await producer.vectorRank(key.query, 3)).toEqual(ranks);
    await producer.close();
  });
});
