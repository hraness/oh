import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { DATASETS, selectQuestions, selectSplit, type Dataset } from "./datasets";
import { ROOT, loadDataset } from "./io";
import { writeGatewayStudyJson } from "./gateway-study-store-v3";
import { makeLabPaidReaderPlan } from "./lab-paid-plan";
import { lockLabReservedSelection, LAB_RESERVED_SELECTION_PINS, type LabReservedSelection } from "./lab-reserved-selection";
import { buildRepresentativePool, parseSelectionDocument } from "./selection";

export const RESERVED_SELECTION_PATH = "benchmarks/results/longmemeval-superiority-selection-v1.json";
export const RESERVED_READER_QUALIFICATION = "Locked deterministic 100-family LongMemEval reserved comparison, outside the frozen 120 and current development groups. Fresh GPT-5 mini/OpenAI Gateway medium reader (8192 output tokens including reasoning), 24 KB/topK20 versus 96 KB/topK100; unchanged native GPT-4o judge with in-run deduplication only. Terminal reader length failures score zero; invalid reader/judge or custody failures make the run incomplete. No occupied retries, replacement sample or outcome-driven tuning. Report paired outcomes for this locked set only, without a random-sample interval, population superiority or leaderboard claim. Timing excludes preparation, authentication and initial preflight.";
const VARIANTS = [
  { id: "bm25-window:k20:b24000", system: "bm25-window", budget: { topK: 20, contextBytes: 24_000 } },
  { id: "bm25-window:k100:b96000", system: "bm25-window", budget: { topK: 100, contextBytes: 96_000 } },
] as const;
function fail(reason: string): never { throw new Error(`Reserved reader evaluation: ${reason}.`); }

/** Projects only the locked representative identities. Gold fields are never inspected here. */
export function projectReservedReaderDataset(dataset: Dataset, selection: LabReservedSelection): Dataset {
  if (selection.records.length !== 100 || canonicalSha256(selection.records) !== LAB_RESERVED_SELECTION_PINS.lockedRecordsSha256
    || selection.recordSha256 !== LAB_RESERVED_SELECTION_PINS.lockedRecordsSha256
    || canonicalSha256(selection.records.map(r => r.groupId)) !== LAB_RESERVED_SELECTION_PINS.lockedGroupIdsSha256) fail("locked sample identity");
  const corpora = new Map(dataset.corpora.map(c => [c.id, c])), questions = new Map(dataset.questions.map(q => [q.id, q]));
  if (corpora.size !== dataset.corpora.length || questions.size !== dataset.questions.length) fail("duplicate dataset identities");
  return {
    corpora: selection.records.map(r => { const c = corpora.get(r.corpusId); if (c?.groupId !== r.groupId) fail("missing or misbound corpus"); return c; }),
    questions: selection.records.map(r => { const q = questions.get(r.questionId); if (q?.corpusId !== r.corpusId) fail("missing or misbound question"); return q; }),
  };
}

/** Loading parses the checksum-pinned public source; only identity metadata selects the sample. */
export async function loadReservedReaderDataset(dataset: Dataset) {
  const bytes = await readFile(join(ROOT, RESERVED_SELECTION_PATH));
  if (bytes.byteLength > 1024 * 1024 || sha256Hex(bytes) !== LAB_RESERVED_SELECTION_PINS.frozenReportSha256) fail("frozen metadata bytes changed");
  const document = parseSelectionDocument(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const development = selectQuestions(selectSplit(dataset, "dev", 17), 100, 17);
  if (development.questions.length !== 100) fail("development selection count");
  const selection = lockLabReservedSelection(document, sha256Hex(bytes), [...new Set(development.corpora.map(c => c.groupId))]);
  const eligibleGroups = new Set(document.eligibleRepresentatives.map(r => r.groupId));
  const actual = buildRepresentativePool(selectSplit(dataset, "test", 17)).filter(r => eligibleGroups.has(r.groupId));
  if (canonicalSha256(actual) !== document.poolSha256) fail("eligible representatives differ from public dataset");
  return { dataset: projectReservedReaderDataset(dataset, selection), selection };
}

/** Reproducible gold-free retrieval preparation; no provider or score calls. */
export async function prepareReservedReaderParent(output: string) {
  if (!isAbsolute(output) || resolve(output) !== output || output.includes("\0")) fail("canonical absolute output required");
  const { dataset, selection } = await loadReservedReaderDataset(await loadDataset("longmemeval-s"));
  const namespace = canonicalSha256({ protocol: "oh.memory.lab-reserved-reader-parent.v1", selection, variants: VARIANTS });
  const reader = await makeLabPaidReaderPlan(dataset, VARIANTS, namespace);
  const pin = await writeGatewayStudyJson(output, { dataset: "longmemeval-s", datasetSha256: DATASETS["longmemeval-s"].sha256,
    split: "test", seed: 17, limit: 100, evaluation: "reserved-100-v1", selection,
    selectionSha256: canonicalSha256(dataset.questions.map(q => q.id)), reader });
  return { pin, families: 100, cases: reader.cases.length, modelCalls: 0, selectionSha256: selection.recordSha256 };
}

if (import.meta.main) {
  if (process.argv.length === 3 && process.argv[2] === "--help") console.log("Usage: bun scripts/benchmarks/lab-reserved-evaluation.ts --output ABSOLUTE_PRIVATE_NEW_FILE\nPrepare the fixed reserved100 medium-reader parent. Zero model calls; dataset must already be checksum-pinned in the local cache.");
  else if (process.argv.length === 4 && process.argv[2] === "--output") console.log(JSON.stringify(await prepareReservedReaderParent(process.argv[3]!)));
  else throw new Error("Expected --output ABSOLUTE_PRIVATE_NEW_FILE or --help.");
}
