import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runRecommendationProgram } from "../scripts/benchmarks/answer-program";

test("replays every frozen synthetic exact and semantic program outcome without providers", () => {
  const text = readFileSync(new URL("../benchmarks/results/memory-answer-program-v5-replay.json", import.meta.url), "utf8");
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1_048_576);
  const fixture = JSON.parse(text) as { protocol: string; rows: { caseId: string; exactInput: unknown; semanticInput: unknown;
    exact: unknown; semantic: unknown }[] };
  expect(fixture.protocol).toBe("oh.benchmark.answer-program-replay.v5");
  expect(fixture.rows.map(x => x.caseId)).toEqual(Array.from({ length: 20 }, (_, i) => `f${String(i + 1).padStart(2, "0")}`));
  for (const row of fixture.rows) {
    for (const arm of ["exact", "semantic"] as const) {
      const result = runRecommendationProgram(arm === "exact" ? row.exactInput : row.semanticInput);
      // Historical implementation/input identities remain in the artifact.
      // Compare behavior so a later compatible implementation can replay it.
      expect({ status: result.status, items: result.items, text: result.text }).toEqual(row[arm]);
    }
  }
});
