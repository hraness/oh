import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { parseSelectionDocument, type ExcludedReport, type SelectionDocument, type SelectionRepresentative } from "./selection";

export const LAB_RESERVED_SELECTION_PROTOCOL = "oh.memory.lab-reserved-selection.v1" as const;
export const LAB_RESERVED_SELECTION_SAMPLE_SIZE = 100;
export const LAB_RESERVED_SELECTION_PREFIX = "oh.reserved-reader-v1:" as const;

export type LabReservedSelectionPins = Readonly<{
  frozenReportSha256: string;
  sourceSha256: string;
  poolSha256: string;
  poolSize: number;
  frozenSampleSize: number;
  excludedReportsSha256: string;
  developmentGroupCount: number;
  developmentGroupsSha256: string;
  retainedRecordsSha256: string;
  lockedRecordsSha256: string;
  lockedGroupIdsSha256: string;
}>;

/** Pins from the metadata-only reserved-family design. */
export const LAB_RESERVED_SELECTION_PINS: LabReservedSelectionPins = Object.freeze({
  frozenReportSha256: "83983f9408c90388d19361561f910dfe3a59e4128af5de63c1c63a9bad058fa5",
  sourceSha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
  poolSha256: "d9d2f29ee7f258e0b067493b36f5f049cc08a3794b9ad094ca38a91a5c493147",
  poolSize: 308,
  frozenSampleSize: 120,
  excludedReportsSha256: "2734c320b1c1b6daa13c0c51d02889e0b8e65e83224929232a74352bfdb8b71b",
  developmentGroupCount: 94,
  developmentGroupsSha256: "8cdedd6ec61dbf3c5e3e1a319d7f6d71e9dfbf2ad1eddf75fd97026f9e7373bc",
  retainedRecordsSha256: "93e8647c90a5e20ad45d39d22aed8791041a1b035ac2a36f77913ee4e0fbb908",
  lockedRecordsSha256: "7d13988b7c6d76cf665cd26d1858b95f269586df42c69db19b7da6ea5984f993",
  lockedGroupIdsSha256: "bec33143aaef5f57bb20f8631ba6f0ce01f560688724f1cbf5dbf7b53c4f98b3",
});

export type LabReservedSelection = Readonly<{
  protocol: typeof LAB_RESERVED_SELECTION_PROTOCOL;
  records: readonly SelectionRepresentative[];
  recordSha256: string;
  groupIdsSha256: string;
  provenance: Readonly<{
    frozenReportSha256: string; sourceSha256: string; poolSha256: string; poolSize: number; frozenSampleSize: number;
    excludedReportsSha256: string; developmentGroupsSha256: string; retainedRecordsSha256: string;
  }>;
}>;

function fail(message: string): never { throw new Error(`Reserved selection: ${message}`); }
function pinned(value: string, expected: string, label: string) {
  if (value !== expected) fail(`${label} pin mismatch.`);
}
function sortedReports(reports: readonly ExcludedReport[]) {
  return [...reports].sort((left, right) => left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0);
}
function normalizedGroups(groupIds: readonly string[]): readonly string[] {
  if (!Array.isArray(groupIds) || groupIds.length === 0 || groupIds.length > 1_000) fail("development groups are invalid.");
  if (groupIds.some(groupId => typeof groupId !== "string" || groupId.length < 1 || groupId.length > 512)) {
    fail("development group ID is invalid.");
  }
  const result = [...groupIds].sort();
  if (new Set(result).size !== result.length) fail("development groups contain duplicates.");
  return result;
}
function ranked(records: readonly SelectionRepresentative[]) {
  return [...records].sort((left, right) => sha256Hex(`${LAB_RESERVED_SELECTION_PREFIX}${left.groupId}`)
    .localeCompare(sha256Hex(`${LAB_RESERVED_SELECTION_PREFIX}${right.groupId}`)) || left.groupId.localeCompare(right.groupId));
}

/**
 * Locks a group-disjoint, metadata-only reserved sample. The caller must hash the frozen
 * selection bytes and may derive development group IDs from parsed dataset metadata first;
 * no reserved context retrieval, reader, or judge work may begin before this lock succeeds.
 */
export function lockLabReservedSelection(frozenDocument: unknown, frozenReportSha256: string,
  developmentGroupIds: readonly string[], pins: LabReservedSelectionPins = LAB_RESERVED_SELECTION_PINS): LabReservedSelection {
  const document: SelectionDocument = parseSelectionDocument(frozenDocument);
  pinned(frozenReportSha256, pins.frozenReportSha256, "frozen report");
  pinned(document.source.sha256, pins.sourceSha256, "source");
  pinned(document.poolSha256, pins.poolSha256, "pool");
  if (document.split !== "test" || document.splitSeed !== 17) fail("frozen selection scope pin mismatch.");
  if (document.poolSize !== pins.poolSize || document.eligibleRepresentatives.length !== pins.poolSize) fail("pool size pin mismatch.");
  if (document.sampleSize !== pins.frozenSampleSize || document.selected.length !== pins.frozenSampleSize) fail("frozen sample size pin mismatch.");
  pinned(canonicalSha256(sortedReports(document.excludedReports)), pins.excludedReportsSha256, "exclusion metadata");
  const developmentGroups = normalizedGroups(developmentGroupIds);
  if (developmentGroups.length !== pins.developmentGroupCount) fail("development group count pin mismatch.");
  pinned(canonicalSha256(developmentGroups), pins.developmentGroupsSha256, "development group");

  const frozenGroups = new Set(document.selected.map(record => record.groupId));
  const developmentSet = new Set(developmentGroups);
  if ([...frozenGroups].some(groupId => developmentSet.has(groupId))) fail("frozen and development groups overlap.");
  if (document.eligibleRepresentatives.some(record => developmentSet.has(record.groupId))) fail("development group appears in frozen pool.");
  const retained = document.eligibleRepresentatives.filter(record => !frozenGroups.has(record.groupId));
  if (retained.length < LAB_RESERVED_SELECTION_SAMPLE_SIZE) fail("fewer than 100 reserved families remain.");
  const ordered = ranked(retained);
  pinned(canonicalSha256(ordered), pins.retainedRecordsSha256, "retained record");
  const records = ordered.slice(0, LAB_RESERVED_SELECTION_SAMPLE_SIZE)
    .map(record => Object.freeze({ groupId: record.groupId, questionId: record.questionId, corpusId: record.corpusId }));
  const recordSha256 = canonicalSha256(records), groupIdsSha256 = canonicalSha256(records.map(record => record.groupId));
  pinned(recordSha256, pins.lockedRecordsSha256, "locked record");
  pinned(groupIdsSha256, pins.lockedGroupIdsSha256, "locked group");
  return Object.freeze({ protocol: LAB_RESERVED_SELECTION_PROTOCOL, records: Object.freeze(records), recordSha256, groupIdsSha256,
    provenance: Object.freeze({ frozenReportSha256, sourceSha256: document.source.sha256, poolSha256: document.poolSha256,
      poolSize: document.poolSize, frozenSampleSize: document.sampleSize, excludedReportsSha256: pins.excludedReportsSha256,
      developmentGroupsSha256: pins.developmentGroupsSha256,
      retainedRecordsSha256: pins.retainedRecordsSha256 }) });
}
