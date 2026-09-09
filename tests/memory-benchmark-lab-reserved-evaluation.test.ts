import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalSha256, sha256Hex } from "../src/canonical";
import { ROOT } from "../scripts/benchmarks/io";
import type { Dataset } from "../scripts/benchmarks/datasets";
import { LAB_RESERVED_SELECTION_PINS, type LabReservedSelection } from "../scripts/benchmarks/lab-reserved-selection";
import { projectReservedReaderDataset, RESERVED_SELECTION_PATH } from "../scripts/benchmarks/lab-reserved-evaluation";
import { parseSelectionDocument } from "../scripts/benchmarks/selection";

async function fixture() {
  const document = parseSelectionDocument(JSON.parse(await readFile(join(ROOT, RESERVED_SELECTION_PATH), "utf8")));
  const excluded = new Set(document.selected.map(r => r.groupId));
  const records = document.eligibleRepresentatives.filter(r => !excluded.has(r.groupId))
    .sort((a, b) => sha256Hex(`oh.reserved-reader-v1:${a.groupId}`).localeCompare(sha256Hex(`oh.reserved-reader-v1:${b.groupId}`))).slice(0, 100);
  const selection: LabReservedSelection = { protocol: "oh.memory.lab-reserved-selection.v1", records,
    recordSha256: canonicalSha256(records), groupIdsSha256: canonicalSha256(records.map(r => r.groupId)),
    provenance: { ...LAB_RESERVED_SELECTION_PINS } };
  const dataset: Dataset = {
    corpora: records.map(r => ({ id: r.corpusId, groupId: r.groupId, get turns(): never { throw Error("No ingestion during projection"); } })).reverse(),
    questions: records.map(r => ({ id: r.questionId, corpusId: r.corpusId, category: "single-session-user", questionDate: "2026-01-01",
      get question(): never { throw Error("Question not needed for selection"); }, get answer(): never { throw Error("Gold accessed"); },
      get unanswerable(): never { throw Error("Gold accessed"); }, get evidenceTurnIds(): never { throw Error("Gold accessed"); },
      get evidenceSessionIds(): never { throw Error("Gold accessed"); } })).reverse(),
  };
  return { selection, dataset };
}
test("reserved projection binds the locked order without reading raw context, question or labels", async () => {
  const { selection, dataset } = await fixture(), chosen = projectReservedReaderDataset(dataset, selection);
  expect(chosen.questions.map(q => q.id)).toEqual(selection.records.map(r => r.questionId));
  expect(chosen.corpora.map(c => c.groupId)).toEqual(selection.records.map(r => r.groupId));
  expect(chosen.questions[0]).toBe(dataset.questions.at(-1)!);
});
test("reserved projection rejects missing, duplicate, crossed and changed sample identities", async () => {
  const { selection, dataset } = await fixture();
  expect(() => projectReservedReaderDataset({ ...dataset, corpora: dataset.corpora.slice(1) }, selection)).toThrow("corpus");
  expect(() => projectReservedReaderDataset({ ...dataset, questions: [...dataset.questions, dataset.questions[0]!] }, selection)).toThrow("duplicate");
  const q = dataset.questions[0]!;
  expect(() => projectReservedReaderDataset({ ...dataset, questions: [{ id: q.id, corpusId: "wrong" } as typeof q, ...dataset.questions.slice(1)] }, selection)).toThrow("question");
  expect(() => projectReservedReaderDataset(dataset, { ...selection, records: [...selection.records].reverse() })).toThrow("sample");
});
