import { expect, test } from "bun:test";
import { canonicalSha256 } from "../src/canonical";
import { OH_EMBEDDING_PROFILE_V1, type OhSemanticSearchBackendV1 } from "../src/semantic-model";
import { prepareCloneMemRetrieval } from "../scripts/benchmarks/clonemem-retrieval";
import { parseCloneMemReplayResult, replayCloneMemCapture } from "../scripts/benchmarks/clonemem-replay";

test("replay parser bounds self-consistently resealed foreign arrays before SDK reconstruction", async () => {
  let indexed: Parameters<OhSemanticSearchBackendV1["index"]>[0] = [];
  const backend: OhSemanticSearchBackendV1 = { profile: OH_EMBEDDING_PROFILE_V1,
    async index(records) { indexed = records; return { indexed: records.length, v: 1 }; },
    async search() { return indexed.map(record => ({ key: record.key, recordSha256: record.recordSha256, score: .8, v: 1 })); },
    async close() {} };
  const prepared = await prepareCloneMemRetrieval({ personId: "test", personName: "Person", traces: [
    { id: "one", date: "2024-01-01T00:00:00", medium: "note", content: "Source only." }] }, backend);
  try {
    const result = await prepared.retrieve("Source", "2024-01-01T00:00:00");
    expect(parseCloneMemReplayResult(result)).toEqual(result);
    for (const mutate of [
      (value: Record<string, unknown>) => { value.semanticCapture = Array(31).fill(result.semanticCapture[0]); },
      (value: Record<string, unknown>) => { value.eligibleTraceIds = Array(2_001).fill("one"); },
      (value: Record<string, unknown>) => { value.arms = Array(4).fill(result.arms[0]); },
      (value: Record<string, unknown>) => { value.timing = { ...result.timing, hybridWallMs: -1 }; },
      (value: Record<string, unknown>) => { value.arms = [{ ...result.arms[0], evidence: Array(11).fill([]) }, ...result.arms.slice(1)]; },
    ]) {
      const { resultSha256: _, ...payload } = structuredClone(result);
      mutate(payload);
      expect(() => parseCloneMemReplayResult({ ...payload, resultSha256: canonicalSha256(payload) })).toThrow();
    }
  } finally { await prepared.close(); }
});

test("replay admits no live-model environment and restores fetch after bounded-file failure", async () => {
  const previous = process.env.QMD_EMBED_MODEL, originalFetch = globalThis.fetch;
  try {
    delete process.env.QMD_EMBED_MODEL;
    await expect(replayCloneMemCapture("/nonexistent/capture.json", "/nonexistent/custody.json")).rejects.toThrow("unavailable model");
    process.env.QMD_EMBED_MODEL = "/nonexistent/clonemem-replay.gguf";
    await expect(replayCloneMemCapture("/nonexistent/capture.json", "/nonexistent/custody.json")).rejects.toThrow();
    expect(globalThis.fetch).toBe(originalFetch);
  } finally {
    if (previous === undefined) delete process.env.QMD_EMBED_MODEL;
    else process.env.QMD_EMBED_MODEL = previous;
  }
});
