import { canonicalJson, isPlainRecord, sha256Hex } from "../../src/canonical";
import type { Corpus, Dataset, Question, Turn } from "./datasets";

export const EVOLUTION_DATASET_PROTOCOL = "oh.memory-evolution.dataset.v1" as const;
export type EvolutionPartition = "development" | "search-validation" | "sealed" | "closed";
export type EvolutionExposure = "unseen" | "development" | "evaluated" | "unknown";
export type EvolutionGroupDisposition = Readonly<{
  groupId: string; partition: EvolutionPartition; exposure: EvolutionExposure; evidence: string;
}>;
export type EvolutionDatasetManifestInput = Readonly<{
  dataset: string; revision: string; sourceSha256: string;
  groups: readonly EvolutionGroupDisposition[];
  histories?: readonly Readonly<{ corpusId: string; historyId: string }>[];
}>;
export type EvolutionDatasetManifest = Readonly<{
  protocol: typeof EVOLUTION_DATASET_PROTOCOL;
  dataset: string; revision: string; sourceSha256: string; datasetSha256: string;
  groups: readonly EvolutionGroupDisposition[];
  corpora: readonly Readonly<{
    id: string; runnerId: string; groupId: string; historyId: string; contentSha256: string;
  }>[];
  questions: readonly Readonly<{
    id: string; runnerId: string; corpusId: string; groupId: string; historyId: string;
    category: string; partition: EvolutionPartition; contentSha256: string;
  }>[];
  qualification: "Declared grouping and exposure; no independence or freshness inferred.";
}>;
export type EvolutionRunnerQuestion = Readonly<{
  id: string; corpusId: string; question: string; questionDate: string;
}>;
export type EvolutionRunnerCorpus = Readonly<{ id: string; turns: readonly Turn[] }>;
export type EvolutionRunnerInput = Readonly<{
  corpora: readonly EvolutionRunnerCorpus[]; questions: readonly EvolutionRunnerQuestion[];
}>;

const MAX_ITEMS = 100_000;
const partitions = new Set<string>(["development", "search-validation", "sealed", "closed"]);
const exposures = new Set<string>(["unseen", "development", "evaluated", "unknown"]);
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainRecord(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) {
    throw new TypeError(`${label} has invalid keys.`);
  }
  return value;
}
function text(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) > maximum) {
    throw new TypeError(`${label} must be nonempty bounded text.`);
  }
  return value;
}
function list(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) throw new TypeError(`${label} must be a bounded array.`);
  return value;
}
function unique(values: readonly string[], label: string): void {
  if (values.length > MAX_ITEMS || new Set(values).size !== values.length) throw new TypeError(`${label} contains duplicates or exceeds its bound.`);
  values.forEach(value => text(value, label));
}
function digest(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new TypeError(`${label} must be a SHA-256 digest.`);
  return value;
}
function disposition(value: unknown): EvolutionGroupDisposition {
  const r = record(value, ["groupId", "partition", "exposure", "evidence"], "Group disposition");
  const partition = text(r.partition, "Partition");
  const exposure = text(r.exposure, "Exposure");
  if (!partitions.has(partition) || !exposures.has(exposure)) throw new TypeError("Unknown partition or exposure.");
  if (partition === "sealed" && exposure !== "unseen") throw new TypeError("A sealed group needs an explicit unseen attestation.");
  return { groupId: text(r.groupId, "Group ID"), partition: partition as EvolutionPartition,
    exposure: exposure as EvolutionExposure, evidence: text(r.evidence, "Exposure evidence", 4_096) };
}
function cleanTurn(turn: Turn): Turn {
  return { id: turn.id, sessionId: turn.sessionId,
    ...(turn.sessionIndex === undefined ? {} : { sessionIndex: turn.sessionIndex }),
    date: turn.date, speaker: turn.speaker, text: turn.text };
}
function cleanQuestion(question: Question): Question {
  return { id: question.id, corpusId: question.corpusId, category: question.category,
    question: question.question, questionDate: question.questionDate, answer: question.answer,
    unanswerable: question.unanswerable, evidenceTurnIds: [...question.evidenceTurnIds],
    evidenceSessionIds: [...question.evidenceSessionIds],
    ...(question.rawEvidenceTurnIds === undefined ? {} : { rawEvidenceTurnIds: [...question.rawEvidenceTurnIds] }) };
}
function validateDatasetStructure(dataset: Dataset): void {
  if (!dataset.corpora.length || !dataset.questions.length) throw new TypeError("Evolution dataset cannot be empty.");
  unique(dataset.corpora.map(c => c.id), "Corpus IDs");
  unique(dataset.questions.map(q => q.id), "Question IDs");
  const corpora = new Set(dataset.corpora.map(c => c.id));
  for (const corpus of dataset.corpora) {
    text(corpus.groupId, "Corpus group");
    if (!corpus.turns.length) throw new TypeError("Evolution corpus cannot be empty.");
    unique(corpus.turns.map(t => t.id), "Turn IDs");
  }
  for (const question of dataset.questions) {
    if (!corpora.has(question.corpusId)) throw new TypeError("Question references a foreign corpus.");
  }
}

export function evolutionRunnerQuestionId(id: string): string { return `q-${sha256Hex(text(id, "Question ID"))}`; }
export function evolutionRunnerCorpusId(id: string): string { return `c-${sha256Hex(text(id, "Corpus ID"))}`; }

/** Exact eligible coverage is enforced before scoring; failed rows still need an explicit result. */
export function assertExactEvolutionCoverage(expectedIds: readonly string[], actualIds: readonly string[]): void {
  unique(expectedIds, "Expected IDs");
  unique(actualIds, "Actual IDs");
  const expected = new Set(expectedIds);
  if (actualIds.some(id => !expected.has(id))) throw new TypeError("Coverage includes foreign IDs.");
  if (actualIds.length !== expectedIds.length) throw new TypeError("Coverage is missing eligible IDs.");
}

/** Every family disposition is supplied by the caller; no existing split is reclassified as fresh. */
export function createEvolutionDatasetManifest(dataset: Dataset, input: EvolutionDatasetManifestInput): EvolutionDatasetManifest {
  validateDatasetStructure(dataset);
  const raw = record(input, input.histories === undefined
    ? ["dataset", "revision", "sourceSha256", "groups"] : ["dataset", "revision", "sourceSha256", "groups", "histories"], "Manifest input");
  const groups = list(raw.groups, "Groups").map(disposition).sort((a, b) => compareIds(a.groupId, b.groupId));
  assertExactEvolutionCoverage([...new Set(dataset.corpora.map(c => c.groupId))], groups.map(g => g.groupId));
  const byGroup = new Map(groups.map(g => [g.groupId, g]));
  const histories = input.histories === undefined
    ? dataset.corpora.map(c => ({ corpusId: c.id, historyId: c.groupId }))
    : list(input.histories, "Histories").map(value => {
      const h = record(value, ["corpusId", "historyId"], "History");
      return { corpusId: text(h.corpusId, "History corpus ID"), historyId: text(h.historyId, "History ID") };
    });
  assertExactEvolutionCoverage(dataset.corpora.map(c => c.id), histories.map(h => h.corpusId));
  const byHistory = new Map(histories.map(h => [h.corpusId, h.historyId]));
  const historyPartitions = new Map<string, EvolutionPartition>();
  const corpora = dataset.corpora.map(corpus => {
    const historyId = byHistory.get(corpus.id)!;
    const partition = byGroup.get(corpus.groupId)!.partition;
    const previous = historyPartitions.get(historyId);
    if (previous !== undefined && previous !== partition) throw new TypeError("A shared history crosses partitions.");
    historyPartitions.set(historyId, partition);
    return { id: corpus.id, runnerId: evolutionRunnerCorpusId(corpus.id), groupId: corpus.groupId, historyId,
      contentSha256: sha256Hex(JSON.stringify({ id: corpus.id, groupId: corpus.groupId, turns: corpus.turns.map(cleanTurn) })) };
  }).sort((a, b) => compareIds(a.id, b.id));
  const byCorpus = new Map(corpora.map(c => [c.id, c]));
  const questions = dataset.questions.map(question => {
    const corpus = byCorpus.get(question.corpusId)!;
    return { id: question.id, runnerId: evolutionRunnerQuestionId(question.id), corpusId: question.corpusId,
      groupId: corpus.groupId, historyId: corpus.historyId, category: question.category,
      partition: byGroup.get(corpus.groupId)!.partition, contentSha256: sha256Hex(JSON.stringify(cleanQuestion(question))) };
  }).sort((a, b) => compareIds(a.id, b.id));
  return { protocol: EVOLUTION_DATASET_PROTOCOL, dataset: text(raw.dataset, "Dataset"), revision: text(raw.revision, "Revision"),
    sourceSha256: digest(raw.sourceSha256, "Source SHA"), datasetSha256: sha256Hex(JSON.stringify({ corpora, questions })),
    groups, corpora, questions, qualification: "Declared grouping and exposure; no independence or freshness inferred." };
}

/** Rebuild the manifest from the current parsed source before accepting any stored manifest. */
export function validateEvolutionDatasetManifest(dataset: Dataset, value: unknown): EvolutionDatasetManifest {
  const raw = record(value, ["protocol", "dataset", "revision", "sourceSha256", "datasetSha256", "groups", "corpora", "questions", "qualification"], "Manifest");
  const corpora = list(raw.corpora, "Manifest corpora").map(value => {
    const corpus = record(value, ["id", "runnerId", "groupId", "historyId", "contentSha256"], "Manifest corpus");
    text(corpus.runnerId, "Runner corpus ID"); text(corpus.groupId, "Group ID"); digest(corpus.contentSha256, "Corpus content SHA");
    return { corpusId: text(corpus.id, "Corpus ID"), historyId: text(corpus.historyId, "History ID") };
  });
  list(raw.questions, "Manifest questions").forEach(value => {
    const q = record(value, ["id", "runnerId", "corpusId", "groupId", "historyId", "category", "partition", "contentSha256"], "Manifest question");
    for (const key of ["id", "runnerId", "corpusId", "groupId", "historyId", "category", "partition"]) text(q[key], `Question ${key}`);
    digest(q.contentSha256, "Question content SHA");
  });
  const rebuilt = createEvolutionDatasetManifest(dataset, { dataset: text(raw.dataset, "Dataset"), revision: text(raw.revision, "Revision"),
    sourceSha256: digest(raw.sourceSha256, "Source SHA"), groups: list(raw.groups, "Manifest groups").map(disposition), histories: corpora });
  // Preserve ordered rows while allowing JSON object keys to be serialized canonically.
  if (raw.protocol !== rebuilt.protocol || raw.qualification !== rebuilt.qualification || raw.datasetSha256 !== rebuilt.datasetSha256
    || canonicalJson(raw.groups) !== canonicalJson(rebuilt.groups) || canonicalJson(raw.corpora) !== canonicalJson(rebuilt.corpora)
    || canonicalJson(raw.questions) !== canonicalJson(rebuilt.questions)) throw new TypeError("Manifest does not match the current dataset or canonical manifest structure.");
  return rebuilt;
}

/** This development selector deliberately cannot open sealed or closed evaluation partitions. */
export function selectEvolutionPartition(dataset: Dataset, manifest: EvolutionDatasetManifest,
  partition: "development" | "search-validation"): Dataset {
  if (partition !== "development" && partition !== "search-validation") throw new TypeError("Evolution cannot open sealed or closed partitions.");
  const valid = validateEvolutionDatasetManifest(dataset, manifest);
  const ids = new Set(valid.questions.filter(q => q.partition === partition).map(q => q.id));
  const questions = dataset.questions.filter(q => ids.has(q.id));
  if (!questions.length) throw new TypeError("Selected evolution partition has no eligible questions.");
  const corpusIds = new Set(questions.map(q => q.corpusId));
  return { corpora: dataset.corpora.filter(c => corpusIds.has(c.id)), questions };
}

/** A fresh, explicitly projected object; benchmark labels cannot survive via extra input properties. */
export function projectEvolutionRunnerInput(dataset: Dataset): EvolutionRunnerInput {
  validateDatasetStructure(dataset);
  return {
    corpora: dataset.corpora.map(c => ({ id: evolutionRunnerCorpusId(c.id), turns: c.turns.map(cleanTurn) })),
    questions: dataset.questions.map(q => ({ id: evolutionRunnerQuestionId(q.id), corpusId: evolutionRunnerCorpusId(q.corpusId),
      question: q.question, questionDate: q.questionDate })),
  };
}
