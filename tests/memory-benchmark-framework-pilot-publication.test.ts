import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import result from "../benchmarks/results/memory-framework-pilot-v1.json";
import registry from "../costs.json";
import { FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1 } from "../scripts/benchmarks/framework-pilot-report-v1";

const root = resolve(import.meta.dir, "..");
const budget = registry.surfaces["benchmark:framework-pilot-result"].budget;
const arms = ["oh", "supermemory", "bm25"] as const;
const types = ["knowledge-update", "multi-session", "single-session-assistant", "single-session-preference", "single-session-user", "temporal-reasoning"];
const hex64 = /^[0-9a-f]{64}$/u;
const armSummary = (arm: string) => result.quality.arms.find(row => row.arm === arm)!;

describe("framework pilot public result", () => {
  test("keeps the fixed 60-question, 180-cell matrix with every disposition counted", () => {
    const raw = readFileSync(resolve(root, "benchmarks/results/memory-framework-pilot-v1.json"));
    expect(raw.length).toBeLessThanOrEqual(budget.reportBytes);
    expect(result.protocol).toBe("oh.framework-pilot-public-result.v1");
    expect(result.arms).toEqual([...arms]);
    expect(result.quality.plannedCases).toBe(60);
    expect(result.quality.plannedCaseArmRows).toBe(180);
    expect(result.pins.reportPlanSha256).toBe(FRAMEWORK_PILOT_REPORT_PLAN_SHA256_V1);
    for (const value of Object.values(result.pins)) expect(value).toMatch(hex64);
    for (const arm of arms) {
      const dispositions = result.retrievalDispositions[arm];
      expect(Object.values(dispositions).reduce((sum, count) => sum + count, 0)).toBe(60);
      const summary = armSummary(arm);
      expect(summary.plannedCases).toBe(60);
      expect(summary.conservativeSuccessRate.denominator).toBe(60);
      expect(summary.conservativeSuccessRate.value).toBeCloseTo(summary.correct / 60, 12);
      expect(summary.completedJudgments).toBeGreaterThanOrEqual(summary.correct);
      expect(summary.completedJudgments).toBeLessThanOrEqual(dispositions.completed ?? 0);
      expect(summary.byType.map(row => row.questionType)).toEqual(types);
      expect(summary.byType.reduce((sum, row) => sum + row.correct, 0)).toBe(summary.correct);
      for (const row of summary.byType) expect(row.plannedCases).toBe(10);
      const readerStatuses = Object.entries(result.reader.statuses).filter(([key]) => key.startsWith(`${arm}:`));
      expect(readerStatuses.reduce((sum, [, count]) => sum + count, 0)).toBe(60);
      const judgeStatuses = Object.entries(result.judge.statuses).filter(([key]) => key.startsWith(`${arm}:`));
      expect(judgeStatuses.reduce((sum, [, count]) => sum + count, 0)).toBe(60);
    }
  });

  test("reports paired comparisons from the same conservative rates and keeps the caps", () => {
    const { primary, secondary } = result.quality.comparisons;
    expect(primary.left).toBe("oh"); expect(primary.right).toBe("supermemory"); expect(primary.role).toBe("primary");
    expect(secondary.left).toBe("oh"); expect(secondary.right).toBe("bm25"); expect(secondary.role).toBe("secondary-descriptive");
    for (const comparison of [primary, secondary]) {
      const left = armSummary(comparison.left).conservativeSuccessRate.value, right = armSummary(comparison.right).conservativeSuccessRate.value;
      expect(comparison.estimate).toBeCloseTo((left - right) * 100, 9);
      expect(comparison.interval95.lower).toBeLessThanOrEqual(comparison.estimate);
      expect(comparison.interval95.upper).toBeGreaterThanOrEqual(comparison.estimate);
      expect(comparison.pairedCases).toBe(60);
    }
    expect(result.reader.physicalRequests).toBeLessThanOrEqual(180);
    expect(result.judge.physicalRequests).toBeLessThanOrEqual(180);
    expect(result.reader.accounting.exposureMicros).toBeLessThanOrEqual(9_000_000);
    expect(result.judge.accounting.combinedConfirmedMicros + result.judge.accounting.combinedUnresolvedMicros).toBeLessThanOrEqual(25_000_000);
    expect(result.supermemory.attemptedCases).toBe(60);
    expect(result.supermemory.completedCases + result.supermemory.failedCases).toBe(60);
    expect(result.supermemory.cleanupVerifiedCases).toBe(60);
    expect(result.supermemory.representation).toBe("session-occurrence.v1");
    expect(budget.providerCalls).toBe(0);
  });

  test("publishes aggregates only", () => {
    const text = JSON.stringify(result);
    for (const forbidden of ["question_id", "haystack", "\"answer\":", "\"reference\":", "oh_fp1_", "/Users/", "VERCEL_OIDC", "Bearer "]) {
      expect(text).not.toContain(forbidden);
    }
    expect(result.limitations.some(line => line.includes("session"))).toBeTrue();
    expect(result.limitations.some(line => line.includes("state-of-the-art"))).toBeTrue();
  });
});
