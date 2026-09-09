import { describe, expect, test } from "bun:test";

import { canonicalSha256, sha256Hex } from "../src/canonical";
import { LAB_RESERVED_SELECTION_PREFIX, LAB_RESERVED_SELECTION_SAMPLE_SIZE, lockLabReservedSelection, type LabReservedSelectionPins } from "../scripts/benchmarks/lab-reserved-selection";
import { REPRESENTATIVE_POLICY, SELECTION_METHOD, SELECTION_PROTOCOL, type SelectionDocument, type SelectionRepresentative } from "../scripts/benchmarks/selection";

const reports = [{ sha256: "a".repeat(64), groups: 2 }] as const;
const pool = Array.from({ length: 106 }, (_, index): SelectionRepresentative => ({ groupId: `g${index.toString().padStart(3, "0")}`,
  questionId: `q${index.toString().padStart(3, "0")}`, corpusId: `c${index.toString().padStart(3, "0")}` }));
const selected = pool.slice(0, 2);
const document: SelectionDocument = { protocol: SELECTION_PROTOCOL, createdAt: "2026-09-09T00:00:00.000Z", dataset: "longmemeval-s",
  source: { sha256: "b".repeat(64) }, split: "test", splitSeed: 17, excludedReports: reports,
  poolSha256: canonicalSha256(pool), poolSize: pool.length, eligibleRepresentatives: pool, sampleSize: selected.length,
  method: SELECTION_METHOD, representativePolicy: REPRESENTATIVE_POLICY, selected };
const developmentGroupIds = ["dev-a", "dev-b"] as const;
const retained = pool.slice(2);
const ordered = [...retained].sort((left, right) => sha256Hex(`${LAB_RESERVED_SELECTION_PREFIX}${left.groupId}`)
  .localeCompare(sha256Hex(`${LAB_RESERVED_SELECTION_PREFIX}${right.groupId}`)) || left.groupId.localeCompare(right.groupId));
const locked = ordered.slice(0, LAB_RESERVED_SELECTION_SAMPLE_SIZE);
const pins: LabReservedSelectionPins = { frozenReportSha256: "d".repeat(64), sourceSha256: document.source.sha256,
  poolSha256: document.poolSha256, poolSize: pool.length, frozenSampleSize: selected.length,
  excludedReportsSha256: canonicalSha256([...reports]), developmentGroupCount: developmentGroupIds.length,
  developmentGroupsSha256: canonicalSha256([...developmentGroupIds]),
  retainedRecordsSha256: canonicalSha256(ordered), lockedRecordsSha256: canonicalSha256(locked),
  lockedGroupIdsSha256: canonicalSha256(locked.map(record => record.groupId)) };

describe("lockLabReservedSelection", () => {
  test("locks exactly 100 raw-metadata representatives in deterministic hash order", () => {
    const result = lockLabReservedSelection(document, pins.frozenReportSha256, developmentGroupIds, pins);
    expect(result.records).toEqual(locked);
    expect(result.records).toHaveLength(100);
    expect(result.records.some(record => selected.some(frozen => frozen.groupId === record.groupId))).toBe(false);
    expect(result.records.some(record => new Set<string>(developmentGroupIds).has(record.groupId))).toBe(false);
    expect(result.recordSha256).toBe(pins.lockedRecordsSha256);
    expect(result.groupIdsSha256).toBe(pins.lockedGroupIdsSha256);
    expect(result.provenance.retainedRecordsSha256).toBe(pins.retainedRecordsSha256);
  });

  test("does not read non-metadata question-like fields", () => {
    const contaminated = { ...document, eligibleRepresentatives: document.eligibleRepresentatives.map(record => {
      const value: SelectionRepresentative & { answer?: string } = { ...record };
      Object.defineProperty(value, "answer", { get() { throw new Error("question data read"); } });
      return value;
    }) };
    const result = lockLabReservedSelection(contaminated, pins.frozenReportSha256, developmentGroupIds, pins);
    expect(result.records).toEqual(locked);
  });

  test("fails closed on frozen bytes, exclusion metadata, development, and locked-record tampering", () => {
    expect(() => lockLabReservedSelection(document, "e".repeat(64), developmentGroupIds, pins)).toThrow("frozen report");
    expect(() => lockLabReservedSelection({ ...document, split: "dev" }, pins.frozenReportSha256, developmentGroupIds, pins)).toThrow("scope");
    expect(() => lockLabReservedSelection({ ...document, excludedReports: [] }, pins.frozenReportSha256, developmentGroupIds, pins)).toThrow();
    expect(() => lockLabReservedSelection(document, pins.frozenReportSha256, ["dev-a", "dev-a"], pins)).toThrow("duplicates");
    expect(() => lockLabReservedSelection(document, pins.frozenReportSha256, ["g001", "dev-b"], pins)).toThrow();
    expect(() => lockLabReservedSelection({ ...document, selected: pool.slice(1, 3) }, pins.frozenReportSha256, developmentGroupIds, pins)).toThrow("retained record");
  });
});
