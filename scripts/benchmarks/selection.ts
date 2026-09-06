import { randomInt } from "node:crypto";

import { canonicalNow, canonicalSha256, hasExactKeys, isPlainRecord, orderedUnique, parseCanonicalInstantV1, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { DATASETS, selectSplit, type Dataset, type DatasetName, type Split } from "./datasets";
import { excludeGroups, loadDataset, writeJson } from "./io";

export const SELECTION_PROTOCOL = "oh.memory-family-selection.v1" as const;
export const SELECTION_METHOD = "crypto-random-int-partial-fisher-yates.v1" as const;
export const REPRESENTATIVE_POLICY = "minimum-question-id-code-unit-order.v1" as const;
export const SELECTION_DATASET = "longmemeval-s" as const;
export const SELECTION_FAMILY_CAP = 1000;

export type RandomIndex = (exclusiveMax: number) => number;

export type SelectionRepresentative = Readonly<{ groupId: string; questionId: string; corpusId: string }>;
export type ExcludedReport = Readonly<{ sha256: string; groups: number }>;

export type SelectionDocument = Readonly<{
  protocol: typeof SELECTION_PROTOCOL;
  createdAt: string;
  dataset: typeof SELECTION_DATASET;
  source: Readonly<{ sha256: string }>;
  split: Split;
  splitSeed: number;
  excludedReports: readonly ExcludedReport[];
  poolSha256: string;
  poolSize: number;
  eligibleRepresentatives: readonly SelectionRepresentative[];
  sampleSize: number;
  method: typeof SELECTION_METHOD;
  representativePolicy: typeof REPRESENTATIVE_POLICY;
  selected: readonly SelectionRepresentative[];
}>;

export type Provenance = Readonly<{
  reportSha256: string; poolSha256: string; poolSize: number; sampleSize: number;
  method: string; representativePolicy: typeof REPRESENTATIVE_POLICY;
}>;

export function provenanceOf(reportSha256: string, document: SelectionDocument): Provenance {
  return { reportSha256, poolSha256: document.poolSha256, poolSize: document.poolSize,
    sampleSize: document.sampleSize, method: document.method, representativePolicy: REPRESENTATIVE_POLICY };
}

export function cryptoRandomIndex(exclusiveMax: number): number {
  if (!Number.isSafeInteger(exclusiveMax) || exclusiveMax < 1) throw new RangeError("exclusiveMax must be a positive integer.");
  return randomInt(exclusiveMax);
}

/** A partial Fisher-Yates shuffle: equivalent to a full shuffle truncated to sampleSize, so every draw order is equally likely. */
export function sampleWithoutReplacement<T>(pool: readonly T[], sampleSize: number, randomIndex: RandomIndex): T[] {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 1 || sampleSize > pool.length) throw new RangeError("Invalid sample size.");
  const working = [...pool];
  for (let i = 0; i < sampleSize; i += 1) {
    const exclusiveMax = working.length - i;
    const offset = randomIndex(exclusiveMax);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= exclusiveMax) {
      throw new RangeError("randomIndex returned an out-of-bounds value.");
    }
    const j = i + offset;
    const temp = working[i]!;
    working[i] = working[j]!;
    working[j] = temp;
  }
  return working.slice(0, sampleSize);
}

type MinimalCorpus = Readonly<{ id: string; groupId: string }>;
type MinimalQuestion = Readonly<{ id: string; corpusId: string }>;

export function buildRepresentativePool(dataset: {
  corpora: readonly MinimalCorpus[]; questions: readonly MinimalQuestion[];
}): readonly SelectionRepresentative[] {
  const corpusGroup = new Map<string, string>();
  for (const corpus of dataset.corpora) {
    if (corpusGroup.has(corpus.id)) throw new Error("Duplicate corpus ID.");
    corpusGroup.set(corpus.id, corpus.groupId);
  }
  const byGroup = new Map<string, { questionId: string; corpusId: string }[]>();
  const seen = new Set<string>();
  for (const question of dataset.questions) {
    if (seen.has(question.id)) throw new Error(`Duplicate question ID ${question.id}.`);
    seen.add(question.id);
    const groupId = corpusGroup.get(question.corpusId);
    if (groupId === undefined) throw new Error(`Question ${question.id} has no corpus mapping.`);
    const entries = byGroup.get(groupId) ?? [];
    entries.push({ questionId: question.id, corpusId: question.corpusId });
    byGroup.set(groupId, entries);
  }
  if (byGroup.size > SELECTION_FAMILY_CAP) throw new RangeError("Family pool exceeds the 1000-family cap.");
  const representatives: SelectionRepresentative[] = [];
  for (const [groupId, entries] of byGroup) {
    let best = entries[0]!;
    for (const entry of entries) if (entry.questionId < best.questionId) best = entry;
    representatives.push({ groupId, questionId: best.questionId, corpusId: best.corpusId });
  }
  return representatives.sort((left, right) => left.groupId < right.groupId ? -1 : left.groupId > right.groupId ? 1 : 0);
}

function scalarString(value: unknown, minimum: number, maximum: number): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) throw new TypeError("Invalid selection field.");
  return value;
}

function scalarInt(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value)) throw new TypeError("Invalid selection field.");
  const result = value as number;
  if (result < minimum || result > maximum) throw new TypeError("Invalid selection field.");
  return result;
}

function parseRepresentative(value: unknown): SelectionRepresentative {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["groupId", "questionId", "corpusId"])) {
    throw new TypeError("Invalid selection representative.");
  }
  return { groupId: scalarString(value.groupId, 1, 512), questionId: scalarString(value.questionId, 1, 512),
    corpusId: scalarString(value.corpusId, 1, 512) };
}

function parseExcludedReport(value: unknown): ExcludedReport {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["sha256", "groups"])) throw new TypeError("Invalid excluded report entry.");
  const sha256 = parseSha256Hex(value.sha256);
  if (sha256 === null) throw new TypeError("Invalid excluded report sha256.");
  return { sha256, groups: scalarInt(value.groups, 0, 20_000) };
}

export function parseSelectionDocument(value: unknown): SelectionDocument {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "createdAt", "dataset", "source", "split", "splitSeed",
    "excludedReports", "poolSha256", "poolSize", "eligibleRepresentatives", "sampleSize", "method", "representativePolicy", "selected"])) {
    throw new TypeError("Selection document has an unexpected shape.");
  }
  const protocol = value.protocol;
  if (protocol !== SELECTION_PROTOCOL) throw new TypeError("Unexpected selection protocol.");
  const createdAt = parseCanonicalInstantV1(value.createdAt);
  if (createdAt === null) throw new TypeError("Invalid selection createdAt.");
  const dataset = value.dataset;
  if (dataset !== SELECTION_DATASET) throw new TypeError("Selection dataset must be longmemeval-s.");
  const source = value.source;
  if (!isPlainRecord(source) || !hasExactKeys(source, ["sha256"])) throw new TypeError("Invalid selection source.");
  const sourceSha256 = parseSha256Hex(source.sha256);
  if (sourceSha256 === null) throw new TypeError("Invalid selection source sha256.");
  const split = value.split;
  if (split !== "dev" && split !== "test" && split !== "all") throw new TypeError("Invalid selection split.");
  const splitSeed = scalarInt(value.splitSeed, 0, 4_294_967_295);
  const excludedReportsRaw = value.excludedReports;
  if (!Array.isArray(excludedReportsRaw) || excludedReportsRaw.length > 32) throw new TypeError("Invalid excludedReports.");
  const excludedReports = excludedReportsRaw.map(parseExcludedReport);
  const poolSha256 = parseSha256Hex(value.poolSha256);
  if (poolSha256 === null) throw new TypeError("Invalid poolSha256.");
  const poolSize = scalarInt(value.poolSize, 1, SELECTION_FAMILY_CAP);
  const eligibleRaw = value.eligibleRepresentatives;
  if (!Array.isArray(eligibleRaw) || eligibleRaw.length !== poolSize) throw new TypeError("Invalid eligibleRepresentatives.");
  const eligibleRepresentatives = eligibleRaw.map(parseRepresentative);
  if (!orderedUnique(eligibleRepresentatives, (representative) => representative.groupId)) {
    throw new TypeError("eligibleRepresentatives must be sorted by groupId without duplicates.");
  }
  if (canonicalSha256(eligibleRepresentatives) !== poolSha256) throw new TypeError("poolSha256 does not match eligibleRepresentatives.");
  const sampleSize = scalarInt(value.sampleSize, 1, poolSize);
  const method = value.method;
  if (method !== SELECTION_METHOD) throw new TypeError("Unexpected selection method.");
  if (value.representativePolicy !== REPRESENTATIVE_POLICY) throw new TypeError("Unexpected representative policy.");
  const selectedRaw = value.selected;
  if (!Array.isArray(selectedRaw) || selectedRaw.length !== sampleSize) throw new TypeError("Invalid selected array.");
  const selected = selectedRaw.map(parseRepresentative);
  if (new Set(selected.map((representative) => representative.groupId)).size !== selected.length) {
    throw new TypeError("selected representatives must be unique.");
  }
  const poolByGroup = new Map(eligibleRepresentatives.map(x => [x.groupId, x]));
  if (selected.some(x => canonicalSha256(x) !== canonicalSha256(poolByGroup.get(x.groupId) ?? null))) {
    throw new TypeError("Selected representative does not match the recomputed pool.");
  }
  return { protocol, createdAt, dataset, source: { sha256: sourceSha256 }, split, splitSeed, excludedReports,
    poolSha256, poolSize, eligibleRepresentatives, sampleSize, method, representativePolicy: REPRESENTATIVE_POLICY, selected };
}

export async function createSelection(options: {
  name: DatasetName; split: Split; seed: number;
  exclusions: { reports: readonly ExcludedReport[] };
  dataset: Dataset; sampleSize: number; output: string; randomIndex?: RandomIndex;
}): Promise<SelectionDocument> {
  if (options.name !== SELECTION_DATASET) throw new TypeError("Family selection is limited to longmemeval-s.");
  const pool = buildRepresentativePool(options.dataset);
  if (options.sampleSize > pool.length) throw new RangeError("Sample size exceeds the eligible family pool.");
  const selected = sampleWithoutReplacement(pool, options.sampleSize, options.randomIndex ?? cryptoRandomIndex);
  const document: SelectionDocument = {
    protocol: SELECTION_PROTOCOL, createdAt: canonicalNow(), dataset: SELECTION_DATASET,
    source: { sha256: DATASETS[options.name].sha256 }, split: options.split, splitSeed: options.seed,
    excludedReports: options.exclusions.reports, poolSha256: canonicalSha256(pool), poolSize: pool.length,
    eligibleRepresentatives: pool, sampleSize: options.sampleSize, method: SELECTION_METHOD, representativePolicy: REPRESENTATIVE_POLICY, selected,
  };
  await writeJson(options.output, document);
  return document;
}

function sortedReports(reports: readonly ExcludedReport[]): readonly ExcludedReport[] {
  return [...reports].sort((left, right) => left.sha256 < right.sha256 ? -1 : left.sha256 > right.sha256 ? 1 : 0);
}

export function verifySelection(options: {
  document: SelectionDocument; dataset: Dataset; split: Split; seed: number; datasetSha256: string;
  exclusions: { groups: ReadonlySet<string>; reports: readonly ExcludedReport[] };
}): Dataset {
  const document = parseSelectionDocument(options.document);
  if (document.source.sha256 !== options.datasetSha256) throw new Error("Selection source checksum does not match the pinned dataset.");
  if (document.split !== options.split) throw new Error("Selection split does not match the current command.");
  if (document.splitSeed !== options.seed) throw new Error("Selection split seed does not match the current command.");
  if (JSON.stringify(sortedReports(document.excludedReports)) !== JSON.stringify(sortedReports(options.exclusions.reports))) {
    throw new Error("Selection exclusions do not match the current command.");
  }
  const filtered = excludeGroups(selectSplit(options.dataset, options.split, options.seed), options.exclusions.groups);
  const pool = buildRepresentativePool(filtered);
  if (JSON.stringify(pool) !== JSON.stringify(document.eligibleRepresentatives)) {
    throw new Error("Selection pool no longer matches the current dataset and exclusions.");
  }
  if (canonicalSha256(pool) !== document.poolSha256) throw new Error("Selection pool hash mismatch.");
  const poolByGroup = new Map(pool.map((representative) => [representative.groupId, representative]));
  for (const representative of document.selected) {
    const canonical = poolByGroup.get(representative.groupId);
    if (canonical === undefined || canonical.questionId !== representative.questionId || canonical.corpusId !== representative.corpusId) {
      throw new Error("Selected representative does not match the recomputed pool.");
    }
  }
  const corpusById = new Map(filtered.corpora.map((corpus) => [corpus.id, corpus]));
  const questionById = new Map(filtered.questions.map((question) => [question.id, question]));
  const corpora = document.selected.map((representative) => {
    const corpus = corpusById.get(representative.corpusId);
    if (corpus === undefined) throw new Error("Selected corpus is missing from the recomputed dataset.");
    return corpus;
  });
  const questions = document.selected.map((representative) => {
    const question = questionById.get(representative.questionId);
    if (question === undefined) throw new Error("Selected question is missing from the recomputed dataset.");
    return question;
  });
  return { corpora, questions };
}

export async function loadFrozenSelection(options: {
  path: string; name: DatasetName; split: Split; seed: number;
  exclusions: { groups: ReadonlySet<string>; reports: readonly ExcludedReport[] };
}): Promise<{ dataset: Dataset; document: SelectionDocument; reportSha256: string }> {
  if (options.name !== SELECTION_DATASET) throw new TypeError("Family selection is limited to longmemeval-s.");
  const file = Bun.file(options.path);
  if (!await file.exists() || file.size > 8 * 1024 * 1024) throw new Error("Selection file must exist and be at most 8 MiB.");
  const bytes = await file.bytes();
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new TypeError("Selection file is not valid JSON."); }
  const document = parseSelectionDocument(raw);
  const dataset = await loadDataset(options.name);
  const ordered = verifySelection({ document, dataset, split: options.split, seed: options.seed,
    datasetSha256: DATASETS[options.name].sha256, exclusions: options.exclusions });
  return { dataset: ordered, document, reportSha256: sha256Hex(bytes) };
}
