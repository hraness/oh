import { describe, expect, test } from "bun:test";

import {
  auditConsistency,
  memoryRecordDigest,
  projectRecords,
  queryMemory,
  selectInstructionChannel,
  type MemoryRecord,
} from "../scripts/benchmarks/deductive-memory";
import { query as datalogQuery, verify as datalogVerify } from "../scripts/benchmarks/memory-datalog";
import { buildQuery } from "../scripts/benchmarks/consistency-rules";
import type { JsonValue } from "../src/canonical";

const stateA = {
  kind: "state", entity: "app", attr: "depends", value: "parser",
  content: "app depends on parser",
} satisfies MemoryRecord;
const stateB = {
  kind: "state", entity: "parser", attr: "depends", value: "lexer",
} satisfies MemoryRecord;
const conflictOld = {
  kind: "state", entity: "app", attr: "status", value: "green",
} satisfies MemoryRecord;
const conflictNew = {
  kind: "contradiction", target: memoryRecordDigest(conflictOld as unknown as JsonValue),
} satisfies MemoryRecord;

const records: MemoryRecord[] = [
  stateA,
  stateB,
  { kind: "alias", alias: "the-app", canonical: "app" },
  conflictOld,
  conflictNew,
];

describe("deductive memory steel thread", () => {
  test("records project into a bounded fact snapshot with source digests", () => {
    const snapshot = projectRecords(records);
    expect(snapshot.contract).toBe("algal.memory.v1");
    expect(snapshot.facts.length).toBeGreaterThanOrEqual(8);
    for (const fact of snapshot.facts) {
      expect(fact.sources).toHaveLength(1);
      expect(fact.sources[0]).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    // byte-identical replay
    expect(projectRecords(records)).toEqual(snapshot);
  });

  test("alias expansion derives canonical references with verifiable proofs", () => {
    const snapshot = projectRecords(records);
    const result = queryMemory(snapshot, "alias-expansion", {
      relation: "refers",
      terms: [{ var: "x" }, "app"],
    });
    expect(result.verified).toBe(true);
    expect(result.rows.some(r => r.tuple[0] === "the-app")).toBe(true);
    expect(Object.keys(result.proofs).length).toBeGreaterThanOrEqual(2);
  });

  test("consistency audit surfaces the injected contradiction with proof witnesses", () => {
    const snapshot = projectRecords(records);
    const audit = auditConsistency(snapshot);
    expect(audit.conflicts.length).toBeGreaterThanOrEqual(1);
    const pair = audit.conflicts[0]!.pair;
    const digests = new Set([memoryRecordDigest(conflictNew as unknown as JsonValue), memoryRecordDigest(conflictOld as unknown as JsonValue)]);
    expect(digests.has(String(pair[0])) && digests.has(String(pair[1]))).toBe(true);
    expect(audit.auditSha256).toMatch(/^[a-f0-9]{64}$/);
    // replay-verify the underlying program end-to-end with the raw engine
    const program = buildQuery("consistency-audit", { relation: "conflict-pair", terms: [{ var: "a" }, { var: "b" }] });
    const raw = datalogQuery(snapshot, program);
    expect(datalogVerify(snapshot, program, raw)).toBe(true);
    const tampered = { ...raw, rows: [...raw.rows, { tuple: ["mallory", "mallory"], proof: "sha256:" + "0".repeat(64) }] };
    expect(datalogVerify(snapshot, program, tampered)).toBe(false);
  });

  test("channel selection chains calibrate -> conformal -> submodular with a bound receipt", () => {
    // 20 calibration samples: low scores mostly negative, high scores positive
    const samples = Array.from({ length: 40 }, (_, i) => ({
      score: i / 39,
      label: (i >= 28 ? 1 : 0) as 0 | 1,
    }));
    const candidates = [
      { id: "keep-a", score: 0.9, bytes: 100, features: ["entity:app"] },
      { id: "keep-b", score: 0.8, bytes: 200, features: ["entity:app", "entity:parser"] },
      { id: "drop-lo", score: 0.05, bytes: 50 },
      { id: "drop-mid", score: 0.4, bytes: 50 },
    ];
    const out = selectInstructionChannel({ candidates, samples, alpha: 0.2, budgetBytes: 300, diversityWeight: 0.05 });
    expect(out.channel.totalBytes).toBeLessThanOrEqual(300);
    const ids = out.channel.selected.map(i => i.id);
    expect(ids).toContain("keep-a");
    expect(ids).not.toContain("drop-lo");
    expect(out.coverageSet.bound.coverage).not.toBeNull();
    expect(out.receipt.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
    // deterministic end-to-end
    const again = selectInstructionChannel({ candidates, samples, alpha: 0.2, budgetBytes: 300, diversityWeight: 0.05 });
    expect(again.receipt.receiptSha256).toBe(out.receipt.receiptSha256);
  });

  test("empty calibration positives fail closed rather than selecting", () => {
    const samples = Array.from({ length: 10 }, () => ({ score: 0.9, label: 0 as const }));
    const out = selectInstructionChannel({
      candidates: [{ id: "x", score: 0.9, bytes: 10 }],
      samples, budgetBytes: 100,
    });
    expect(out.conformal.unbounded).toBe(true);
    expect(out.channel.selected).toHaveLength(0);
  });

  test("tampered snapshot fails replay verification", () => {
    const snapshot = projectRecords(records);
    const program = buildQuery("alias-expansion", { relation: "refers", terms: [{ var: "x" }, "app"] });
    const result = datalogQuery(snapshot, program);
    expect(datalogVerify(snapshot, program, result)).toBe(true);
    const tampered = { ...snapshot, facts: [...snapshot.facts, { relation: "entity", tuple: ["mallory"], sources: [memoryRecordDigest("mallory")] }] };
    expect(datalogVerify(tampered, program, result)).toBe(false);
  });
});
