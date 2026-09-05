import { describe, expect, test } from "bun:test";

import { summarizeReport } from "../scripts/benchmarks/artifacts";

describe("benchmark evidence artifacts", () => {
  test("retains original code identity and scores without copying raw answers or extra fields", () => {
    const manifest = { command: "answer", code: { sourceSha256: "a".repeat(64) } };
    const summary = summarizeReport({ protocol: "oh.memory-benchmark.v1", manifest,
      summaries: { baseline: { completed: 1 } }, rows: [{ prediction: "RAW_ANSWER_SENTINEL" }],
      nativeLongMemEvalPredictions: { baseline: ["RAW_ANSWER_SENTINEL"] }, extra: "UNKNOWN_SENTINEL" }, "b".repeat(64));
    expect(summary).toMatchObject({ manifest, fullReportSha256: "b".repeat(64), summaries: { baseline: { completed: 1 } } });
    expect(JSON.stringify(summary)).not.toContain("SENTINEL");
  });

  test("refuses arbitrary JSON or a missing source fingerprint", () => {
    expect(() => summarizeReport({}, "b".repeat(64))).toThrow();
    expect(() => summarizeReport({ protocol: "oh.memory-benchmark.v1", manifest: { code: {} }, summaries: {} }, "b".repeat(64))).toThrow();
  });
});
