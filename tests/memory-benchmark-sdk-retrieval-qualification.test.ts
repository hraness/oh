import { describe, expect, test } from "bun:test";
import { createKnowledgeGraphRecordV1 } from "../src/graph";
import { OH_RERANK_PROFILE_V1, type OhRerankBackendV1 } from "../src/rerank-model";
import { recordDocument } from "../src/semantic-model";
import { openSdkQualificationPersona, parseSdkQualificationPersona } from "../scripts/benchmarks/sdk-retrieval-qualification";
import { verifySdkQualificationRows } from "../scripts/benchmarks/sdk-retrieval-qualification-run";

function fixture() {
  const memory = { personId: "test-person", personName: "Example", traces: [
    { id: "past", medium: "note", date: "2023-01-01T00:00:00", content: "Ada designed the analytical engine." },
    { id: "future", medium: "note", date: "2025-01-01T00:00:00", content: "Ada engine future information." },
  ] };
  const record = createKnowledgeGraphRecordV1({ key: "edition:trace-00000", kind: "edition", dependencies: [], v: 1,
    value: { ...memory.traces[0]! } });
  const query = { id: "q1", personId: memory.personId, query: "What engine did Ada design?", questionDate: "2024-01-01T00:00:00",
    eligibleTraceIds: ["past"], semanticCapture: [{ key: record.key, recordSha256: record.recordSha256, score: .8, v: 1 }],
    originalResultSha256: "a".repeat(64) };
  return { input: { memory, queries: [query] }, record };
}

describe("SDK qualification capture boundary", () => {
  test("rejects gold fields, incorrect eligibility and stale semantic records", () => {
    const { input } = fixture();
    expect(() => parseSdkQualificationPersona({ ...input, queries: [{ ...input.queries[0], correctChoiceId: "A" }] })).toThrow("gold-free");
    expect(() => parseSdkQualificationPersona({ ...input, memory: { ...input.memory,
      traces: [{ ...input.memory.traces[0], evidenceLabel: true }] } })).toThrow("gold-free trace");
    expect(() => parseSdkQualificationPersona({ ...input, queries: [{ ...input.queries[0], eligibleTraceIds: ["past", "future"] }] })).toThrow("temporal");
    expect(() => parseSdkQualificationPersona({ ...input, queries: [{ ...input.queries[0], semanticCapture: [{
      ...input.queries[0]!.semanticCapture[0], recordSha256: "b".repeat(64),
    }] }] })).toThrow("stale");
    expect(() => parseSdkQualificationPersona({ ...input, queries: [input.queries[0], input.queries[0]] })).toThrow("duplicate question");
  });

  test("crosses real SDK/SQLite routing and passes exact recordDocument without future records", async () => {
    const { input, record } = fixture();
    const calls: unknown[] = [];
    let closes = 0;
    // Synthetic unit fixture only. Native qualification never uses this backend.
    const ranker: OhRerankBackendV1 = { profile: OH_RERANK_PROFILE_V1,
      async rerank(query, docs) {
        calls.push({ query, docs });
        expect(docs).toEqual([{ key: record.key, text: recordDocument(record), v: 1 }]);
        return [{ key: record.key, score: .9, v: 1 }];
      }, async close() { closes++; } };
    const session = openSdkQualificationPersona(parseSdkQualificationPersona(input), ranker);
    try {
      const result = await session.next();
      expect(result.defaultMode).toBe("rerank");
      expect(result.eligibleRecords).toBe(1);
      expect(result.pool).toHaveLength(1);
      expect(result.arms.map(a => a.armId)).toEqual(["sdk-semantic", "sdk-hybrid", "sdk-default-rerank"]);
      for (const arm of result.arms) {
        expect(arm.traceIds).toEqual(["past"]);
        expect(arm.context).toBe("---- idx 1 ----\nAda designed the analytical engine.");
      }
      expect(result.diagnostics).toEqual([]);
      await expect(session.next()).rejects.toThrow("complete");
    } finally { await session.close(); }
    expect(calls).toHaveLength(1);
    expect(closes).toBe(0); // The outer native owner closes the shared ranker.
  });

  test("native failures cannot silently qualify fallback results or be retried", async () => {
    const { input } = fixture();
    const ranker: OhRerankBackendV1 = { profile: OH_RERANK_PROFILE_V1,
      async rerank() { throw Error("fixture native failure"); }, async close() {} };
    const session = openSdkQualificationPersona(parseSdkQualificationPersona(input), ranker);
    try {
      await expect(session.next()).rejects.toThrow("fallback");
      await expect(session.next()).rejects.toThrow("failed");
    } finally { await session.close(); }
  });

  test("offline score replay rejects altered pool, ranking context and diagnostics", async () => {
    const { input, record } = fixture(), persona = parseSdkQualificationPersona(input);
    const ranker: OhRerankBackendV1 = { profile: OH_RERANK_PROFILE_V1,
      async rerank() { return [{ key: record.key, score: .9, v: 1 }]; }, async close() {} };
    const session = openSdkQualificationPersona(persona, ranker);
    let row;
    try { row = await session.next(); } finally { await session.close(); }
    expect(await verifySdkQualificationRows([persona], [row])).toEqual([row]);
    await expect(verifySdkQualificationRows([persona], [{ ...row,
      pool: [{ ...row.pool[0], documentSha256: "b".repeat(64) }],
    }])).rejects.toThrow("fallback");
    await expect(verifySdkQualificationRows([persona], [{ ...row,
      arms: row.arms.map((arm, i) => i === 0 ? { ...arm, context: "forged" } : arm),
    }])).rejects.toThrow("context differs");
    await expect(verifySdkQualificationRows([persona], [{ ...row, diagnostics: ["rerank-unavailable"] }])).rejects.toThrow("diagnostics");
  });
});
