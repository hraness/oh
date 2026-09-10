/** Cryptographic BEAM family draw. The unit is a sealed family from the exposure
 * review (one or more related histories); every probing question of a drawn
 * family enters the sample, so the sample size is fixed in families and reported
 * in questions. The saved document is the replay authority: a changed review,
 * pool or dataset fails verification instead of drawing replacements. */
import { canonicalNow, canonicalSha256, hasExactKeys, isPlainRecord, orderedUnique, parseCanonicalInstantV1, parseSha256Hex } from "../../src/canonical";
import { DATASETS, type Dataset } from "./datasets";
import { evolutionRunnerQuestionId } from "./evolution-dataset";
import { cryptoRandomIndex, sampleWithoutReplacement, SELECTION_METHOD, type RandomIndex } from "./selection";
import type { BeamExposureReview } from "./beam-review";

export const BEAM_SELECTION_PROTOCOL = "oh.beam-family-selection.v1" as const;
export const BEAM_SELECTION_FAMILY_CAP = 1_000;

export type BeamFamily = Readonly<{ groupId: string; corpusIds: readonly string[]; questions: number }>;
export type BeamSelectionDocument = Readonly<{
  protocol: typeof BEAM_SELECTION_PROTOCOL; createdAt: string; dataset: "beam";
  source: Readonly<{ revision: string; sha256: string }>; reviewSha256: string;
  poolSha256: string; poolSize: number; eligibleFamilies: readonly BeamFamily[];
  sampleFamilies: number; sampleQuestions: number; method: typeof SELECTION_METHOD;
  selected: readonly BeamFamily[]; selectedQuestionIds: readonly string[];
}>;

/** Eligible families in groupId order: sealed/unseen review groups with their histories and question counts. */
export function buildBeamFamilyPool(dataset: Dataset, review: BeamExposureReview): readonly BeamFamily[] {
  const corpora = new Map(dataset.corpora.map((corpus) => [corpus.id, corpus]));
  const questionsByCorpus = new Map<string, number>();
  for (const question of dataset.questions) questionsByCorpus.set(question.corpusId, (questionsByCorpus.get(question.corpusId) ?? 0) + 1);
  const sealed = new Set(review.groups.filter((group) => group.partition === "sealed" && group.exposure === "unseen").map((group) => group.groupId));
  const members = new Map<string, string[]>();
  for (const history of review.histories) {
    if (!corpora.has(history.corpusId)) throw new TypeError("BEAM review names a history missing from the dataset.");
    if (!sealed.has(history.suggestedGroupId)) continue;
    const list = members.get(history.suggestedGroupId) ?? [];
    list.push(history.corpusId);
    members.set(history.suggestedGroupId, list);
  }
  if (members.size > BEAM_SELECTION_FAMILY_CAP) throw new RangeError("BEAM family pool exceeds its cap.");
  return [...members.entries()].sort(([left], [right]) => left < right ? -1 : 1).map(([groupId, corpusIds]) => {
    const sorted = [...corpusIds].sort();
    return { groupId, corpusIds: sorted, questions: sorted.reduce((sum, corpusId) => sum + (questionsByCorpus.get(corpusId) ?? 0), 0) };
  });
}

function selectedQuestions(dataset: Dataset, selected: readonly BeamFamily[]): readonly string[] {
  const corpusIds = new Set(selected.flatMap((family) => family.corpusIds));
  return dataset.questions.filter((question) => corpusIds.has(question.corpusId)).map((question) => question.id);
}

export function createBeamSelection(input: Readonly<{
  dataset: Dataset; review: BeamExposureReview; reviewSha256: string; sampleFamilies: number; randomIndex?: RandomIndex; createdAt?: string;
}>): BeamSelectionDocument {
  const reviewSha256 = parseSha256Hex(input.reviewSha256);
  if (reviewSha256 === null) throw new TypeError("BEAM selection needs the review document digest.");
  const pool = buildBeamFamilyPool(input.dataset, input.review);
  if (pool.length === 0) throw new RangeError("BEAM review leaves no sealed family to draw from.");
  if (!Number.isSafeInteger(input.sampleFamilies) || input.sampleFamilies < 1 || input.sampleFamilies > pool.length) {
    throw new RangeError("BEAM sample size must be 1..eligible families.");
  }
  const createdAt = parseCanonicalInstantV1(input.createdAt ?? canonicalNow());
  if (createdAt === null) throw new TypeError("Invalid selection createdAt.");
  const selected = sampleWithoutReplacement(pool, input.sampleFamilies, input.randomIndex ?? cryptoRandomIndex);
  const selectedQuestionIds = selectedQuestions(input.dataset, selected);
  return { protocol: BEAM_SELECTION_PROTOCOL, createdAt, dataset: "beam", source: { revision: DATASETS.beam.revision, sha256: DATASETS.beam.sha256 },
    reviewSha256, poolSha256: canonicalSha256(pool), poolSize: pool.length, eligibleFamilies: pool, sampleFamilies: input.sampleFamilies,
    sampleQuestions: selectedQuestionIds.length, method: SELECTION_METHOD, selected, selectedQuestionIds };
}

function parseFamily(value: unknown): BeamFamily {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["groupId", "corpusIds", "questions"])) throw new TypeError("Invalid BEAM family.");
  if (typeof value.groupId !== "string" || value.groupId.length === 0 || value.groupId.length > 64) throw new TypeError("Invalid BEAM family groupId.");
  if (!Array.isArray(value.corpusIds) || value.corpusIds.length < 1 || value.corpusIds.length > BEAM_SELECTION_FAMILY_CAP
    || value.corpusIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 64)) throw new TypeError("Invalid BEAM family histories.");
  if (!orderedUnique(value.corpusIds as string[], (id) => id)) throw new TypeError("BEAM family histories must be sorted and unique.");
  if (value.corpusIds[0] !== value.groupId) throw new TypeError("BEAM family groupId must be its smallest history.");
  if (!Number.isSafeInteger(value.questions) || (value.questions as number) < 0 || (value.questions as number) > 100_000) throw new TypeError("Invalid BEAM family question count.");
  return { groupId: value.groupId, corpusIds: value.corpusIds as string[], questions: value.questions as number };
}

export function parseBeamSelectionDocument(value: unknown): BeamSelectionDocument {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "createdAt", "dataset", "source", "reviewSha256", "poolSha256", "poolSize",
    "eligibleFamilies", "sampleFamilies", "sampleQuestions", "method", "selected", "selectedQuestionIds"])) {
    throw new TypeError("BEAM selection document has an unexpected shape.");
  }
  if (value.protocol !== BEAM_SELECTION_PROTOCOL || value.dataset !== "beam" || value.method !== SELECTION_METHOD) throw new TypeError("Unexpected BEAM selection protocol.");
  const createdAt = parseCanonicalInstantV1(value.createdAt);
  if (createdAt === null) throw new TypeError("Invalid BEAM selection createdAt.");
  const source = value.source;
  if (!isPlainRecord(source) || !hasExactKeys(source, ["revision", "sha256"]) || source.revision !== DATASETS.beam.revision || source.sha256 !== DATASETS.beam.sha256) {
    throw new TypeError("BEAM selection source does not match the pinned dataset.");
  }
  const reviewSha256 = parseSha256Hex(value.reviewSha256), poolSha256 = parseSha256Hex(value.poolSha256);
  if (reviewSha256 === null || poolSha256 === null) throw new TypeError("Invalid BEAM selection digests.");
  if (!Number.isSafeInteger(value.poolSize) || (value.poolSize as number) < 1 || (value.poolSize as number) > BEAM_SELECTION_FAMILY_CAP) throw new TypeError("Invalid BEAM pool size.");
  const poolSize = value.poolSize as number;
  if (!Array.isArray(value.eligibleFamilies) || value.eligibleFamilies.length !== poolSize) throw new TypeError("Invalid BEAM eligible families.");
  const eligibleFamilies = value.eligibleFamilies.map(parseFamily);
  if (!orderedUnique(eligibleFamilies, (family) => family.groupId)) throw new TypeError("BEAM eligible families must be sorted by groupId without duplicates.");
  if (canonicalSha256(eligibleFamilies) !== poolSha256) throw new TypeError("BEAM poolSha256 does not match eligibleFamilies.");
  if (!Number.isSafeInteger(value.sampleFamilies) || (value.sampleFamilies as number) < 1 || (value.sampleFamilies as number) > poolSize) throw new TypeError("Invalid BEAM sample size.");
  const sampleFamilies = value.sampleFamilies as number;
  if (!Array.isArray(value.selected) || value.selected.length !== sampleFamilies) throw new TypeError("Invalid BEAM selected families.");
  const selected = value.selected.map(parseFamily);
  if (new Set(selected.map((family) => family.groupId)).size !== selected.length) throw new TypeError("BEAM selected families must be unique.");
  const byGroup = new Map(eligibleFamilies.map((family) => [family.groupId, family]));
  if (selected.some((family) => canonicalSha256(family) !== canonicalSha256(byGroup.get(family.groupId) ?? null))) {
    throw new TypeError("BEAM selected family does not match the eligible pool.");
  }
  if (!Array.isArray(value.selectedQuestionIds) || value.selectedQuestionIds.length > 100_000
    || value.selectedQuestionIds.some((id) => typeof id !== "string" || id.length === 0 || id.length > 128)) throw new TypeError("Invalid BEAM selected question IDs.");
  const selectedQuestionIds = value.selectedQuestionIds as string[];
  if (new Set(selectedQuestionIds).size !== selectedQuestionIds.length) throw new TypeError("BEAM selected question IDs repeat.");
  if (value.sampleQuestions !== selectedQuestionIds.length || selected.reduce((sum, family) => sum + family.questions, 0) !== selectedQuestionIds.length) {
    throw new TypeError("BEAM sampleQuestions disagrees with the selected families.");
  }
  const selectedCorpora = new Set(selected.flatMap((family) => family.corpusIds));
  if (selectedQuestionIds.some((id) => !selectedCorpora.has(id.slice(0, id.indexOf(":"))))) {
    throw new TypeError("BEAM selected question IDs do not belong to the selected families.");
  }
  return { protocol: BEAM_SELECTION_PROTOCOL, createdAt, dataset: "beam", source: { revision: DATASETS.beam.revision, sha256: DATASETS.beam.sha256 },
    reviewSha256, poolSha256, poolSize, eligibleFamilies, sampleFamilies, sampleQuestions: selectedQuestionIds.length, method: SELECTION_METHOD,
    selected, selectedQuestionIds };
}

/** Recompute the pool from the current dataset and review; return the drawn sample in draw order. */
export function verifyBeamSelection(input: Readonly<{ document: unknown; dataset: Dataset; review: BeamExposureReview; reviewSha256: string }>): Dataset {
  const document = parseBeamSelectionDocument(input.document);
  if (document.reviewSha256 !== input.reviewSha256) throw new Error("BEAM selection was drawn under a different exposure review.");
  const pool = buildBeamFamilyPool(input.dataset, input.review);
  if (canonicalSha256(pool) !== document.poolSha256 || JSON.stringify(pool) !== JSON.stringify(document.eligibleFamilies)) {
    throw new Error("BEAM family pool no longer matches the current dataset and review.");
  }
  if (JSON.stringify(selectedQuestions(input.dataset, document.selected)) !== JSON.stringify(document.selectedQuestionIds)) {
    throw new Error("BEAM selected question IDs no longer match the selected families.");
  }
  const corpusById = new Map(input.dataset.corpora.map((corpus) => [corpus.id, corpus]));
  const corpora = document.selected.flatMap((family) => family.corpusIds.map((corpusId) => {
    const corpus = corpusById.get(corpusId);
    if (corpus === undefined) throw new Error("BEAM selected history is missing from the dataset.");
    return corpus;
  }));
  const chosen = new Set(document.selectedQuestionIds);
  return { corpora, questions: input.dataset.questions.filter((question) => chosen.has(question.id)) };
}

/** Runner-side identifiers for a sealed-confirmation scope request (`selectedQuestionIds`). */
export function beamScopeQuestionIds(document: BeamSelectionDocument): readonly string[] {
  return document.selectedQuestionIds.map(evolutionRunnerQuestionId);
}
