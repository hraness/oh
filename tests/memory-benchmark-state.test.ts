import { describe, expect, test } from "bun:test";

import { runProjection, runState } from "../scripts/benchmarks/state";

describe("memory state benchmark", () => {
  test("checks updates, multi-hop support, conflicts, pinning, CAS, and exact proof provenance", async () => {
    const result = await runState(17, 8);
    expect(result.status).toBe("passed");
    expect(result.summaries.ohExactStateAccuracy).toBe(1);
    expect(result.summaries.appendOnlyAblationAccuracy).toBeLessThan(1);
    for (const category of ["multi-hop", "independent-support-survives", "last-support-retraction", "knowledge-update",
      "canonical-pin", "visible-authority-conflict", "stale-write-rejected", "idempotent-write", "current-proof-provenance"]) {
      const summary = result.summaries.byCategory[category]!;
      expect(summary.checks).toBeGreaterThan(0);
      expect(summary.passed).toBe(summary.checks);
    }
  });

  test("preserves the pre-optimization projection result, proofs, and work accounting", async () => {
    const result = await runProjection([16], 1);
    expect(result.rows[0]?.resultSha256).toBe("3213c8907a71c3302b6024da5d134a71fb5cfb0ee1a1f89f863b744685d406d6");
    expect(result.rows[0]?.stats).toMatchObject({ workUnits: 20_200, proofNodes: 1_360, proofsTruncated: false });
  });

  test("keeps the complete result digest stable across repeated projection evaluations", async () => {
    const first = await runProjection([6], 2);
    const second = await runProjection([6], 1);
    expect(first.status).toBe("passed");
    expect(first.rows[0]?.actualRows).toBe(15);
    expect(first.rows[0]?.resultSha256).toBe(second.rows[0]?.resultSha256);
    expect(first.rows[0]?.timingsMs).toHaveLength(2);
  });
});
