/** BEAM exposure and overlap review: digests, counts and dispositions only.
 * No conversation text, question text, rubric nugget or reference answer is
 * ever placed in the review document. The review is the eligibility audit a
 * sealed-confirmation scope references by digest; it declares dispositions and
 * proves neither independence nor freshness. */
import { canonicalNow, canonicalSha256, hasExactKeys, isPlainRecord, parseCanonicalInstantV1, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { BEAM_QUESTION_DATE_POLICY, BEAM_SPLITS, DATASETS, beamCorpusId, type BeamHistoryProvenance, type BeamSplit, type Dataset } from "./datasets";
import type { EvolutionExposure, EvolutionGroupDisposition } from "./evolution-dataset";

export const BEAM_REVIEW_PROTOCOL = "oh.beam-exposure-review.v1" as const;
/** Word 8-grams over normalized turn text, kept when a cheap 32-bit hash is 0 modulo 16 (about 1 in 16 shingles). */
export const BEAM_SHINGLE_POLICY = { words: 8, sampleModulus: 16, minimumTurnWords: 6 } as const;
export const BEAM_REVIEW_MAX_HISTORIES = 1_000;
const MAX_MATCHED_CORPORA = 8;

export type BeamExposureDeclaration = Readonly<{ corpusId: string; exposure: Exclude<EvolutionExposure, "unseen">; evidence: string }>;
/** Exact-turn matches gate eligibility; sampled shingles are per matched reference corpus and gate only when a bound is declared (null = report only). */
export type BeamOverlapThresholds = Readonly<{ maximumExactTurnMatches: number; maximumSampledShingleMatchesPerCorpus: number | null }>;
export type BeamReferenceDataset = Readonly<{ dataset: string; sha256: string; data: Dataset }>;
export type BeamReviewMatch = Readonly<{ dataset: string; exactTurnMatches: number; sampledShingleMatches: number; maximumCorpusSampledShingleMatches: number;
  matchedCorpora: readonly Readonly<{ corpusId: string; exactTurnMatches: number; sampledShingleMatches: number }>[] }>;
/** `contentSha256` is canonicalSha256 of the parsed turns alone; the manifest's corpus digest covers id, groupId and cleaned turns, so the two are distinct preimages. */
export type BeamReviewHistory = Readonly<{
  corpusId: string; split: BeamSplit; rowIndex: number; sessions: number; turns: number; questions: number; ambiguousEvidenceQuestions: number;
  contentSha256: string; conversationIdSha256: string; seedSha256: string; profileSha256: string; narrativesSha256: string;
  planSha256: string; userQuestionsSha256: string; suggestedGroupId: string; relatedHistories: readonly string[];
  declaredExposure: Readonly<{ exposure: EvolutionExposure; evidence: string }> | null; overlap: readonly BeamReviewMatch[];
  eligible: boolean;
}>;
export type BeamExposureReview = Readonly<{
  protocol: typeof BEAM_REVIEW_PROTOCOL; createdAt: string; dataset: "beam";
  source: Readonly<{ revision: string; sha256: string; questionDatePolicy: typeof BEAM_QUESTION_DATE_POLICY }>;
  references: readonly Readonly<{ dataset: string; sha256: string; corpora: number; turns: number }>[];
  shinglePolicy: typeof BEAM_SHINGLE_POLICY; thresholds: BeamOverlapThresholds;
  declarations: readonly BeamExposureDeclaration[];
  histories: readonly BeamReviewHistory[];
  groups: readonly EvolutionGroupDisposition[];
  summary: Readonly<{ histories: number; questions: number; ambiguousEvidenceQuestions: number; eligibleHistories: number; eligibleQuestions: number;
    eligibleGroups: number; declaredExposures: number; overlappingHistories: number; relatedGroups: number }>;
  qualification: "Declared dispositions from digests and sampled overlap only; no independence, freshness or absence of undeclared exposure is inferred.";
}>;

export const BEAM_DEFAULT_THRESHOLDS: BeamOverlapThresholds = { maximumExactTurnMatches: 0, maximumSampledShingleMatchesPerCorpus: null };

export function normalizeBeamText(value: string): string[] {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter((word) => word.length > 0);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Sampled shingle digests and the exact-turn digest for one turn's text; empty for short turns. */
export function turnSignatures(text: string): Readonly<{ turnDigest: string | null; shingles: readonly string[] }> {
  const words = normalizeBeamText(text);
  if (words.length < BEAM_SHINGLE_POLICY.minimumTurnWords) return { turnDigest: null, shingles: [] };
  const shingles: string[] = [];
  for (let start = 0; start + BEAM_SHINGLE_POLICY.words <= words.length; start += 1) {
    const shingle = words.slice(start, start + BEAM_SHINGLE_POLICY.words).join(" ");
    if (fnv1a(shingle) % BEAM_SHINGLE_POLICY.sampleModulus === 0) shingles.push(sha256Hex(shingle));
  }
  return { turnDigest: sha256Hex(words.join(" ")), shingles };
}

type Index = Readonly<{ turns: Map<string, number[]>; shingles: Map<string, number[]> }>;

function indexBeam(beam: Dataset): Index {
  const turns = new Map<string, number[]>(), shingles = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, history: number) => {
    const entries = map.get(key) ?? [];
    if (entries[entries.length - 1] !== history) entries.push(history);
    map.set(key, entries);
  };
  beam.corpora.forEach((corpus, history) => {
    for (const turn of corpus.turns) {
      const signature = turnSignatures(turn.text);
      if (signature.turnDigest !== null) add(turns, signature.turnDigest, history);
      for (const shingle of new Set(signature.shingles)) add(shingles, shingle, history);
    }
  });
  return { turns, shingles };
}

function scanReference(index: Index, reference: BeamReferenceDataset, histories: number): BeamReviewMatch[] {
  const counts = new Map<number, Map<string, { exact: number; shingles: number }>>();
  const bump = (history: number, corpusId: string, field: "exact" | "shingles") => {
    const byCorpus = counts.get(history) ?? new Map<string, { exact: number; shingles: number }>();
    const entry = byCorpus.get(corpusId) ?? { exact: 0, shingles: 0 };
    entry[field] += 1;
    byCorpus.set(corpusId, entry);
    counts.set(history, byCorpus);
  };
  for (const corpus of reference.data.corpora) {
    const seenShingles = new Set<string>(), seenTurns = new Set<string>();
    for (const turn of corpus.turns) {
      const signature = turnSignatures(turn.text);
      if (signature.turnDigest !== null && !seenTurns.has(signature.turnDigest)) {
        seenTurns.add(signature.turnDigest);
        for (const history of index.turns.get(signature.turnDigest) ?? []) bump(history, corpus.id, "exact");
      }
      for (const shingle of signature.shingles) {
        if (seenShingles.has(shingle)) continue;
        seenShingles.add(shingle);
        for (const history of index.shingles.get(shingle) ?? []) bump(history, corpus.id, "shingles");
      }
    }
  }
  const perHistory: { corpusId: string; exactTurnMatches: number; sampledShingleMatches: number }[][] = Array.from({ length: histories }, () => []);
  for (const [history, byCorpus] of counts) {
    for (const [corpusId, entry] of byCorpus) perHistory[history]!.push({ corpusId, exactTurnMatches: entry.exact, sampledShingleMatches: entry.shingles });
  }
  return perHistory.map((matches) => {
    const sorted = matches.sort((left, right) => (right.exactTurnMatches - left.exactTurnMatches)
      || (right.sampledShingleMatches - left.sampledShingleMatches) || (left.corpusId < right.corpusId ? -1 : 1));
    return { dataset: reference.dataset, exactTurnMatches: sorted.reduce((sum, match) => sum + match.exactTurnMatches, 0),
      sampledShingleMatches: sorted.reduce((sum, match) => sum + match.sampledShingleMatches, 0),
      maximumCorpusSampledShingleMatches: sorted.reduce((best, match) => Math.max(best, match.sampledShingleMatches), 0),
      matchedCorpora: sorted.slice(0, MAX_MATCHED_CORPORA) };
  });
}

function parseDeclaration(value: unknown): BeamExposureDeclaration {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["corpusId", "exposure", "evidence"])) throw new TypeError("Invalid BEAM exposure declaration.");
  const { corpusId, exposure, evidence } = value;
  if (typeof corpusId !== "string" || !/^beam-(?:100K|500K|1M)-\d{1,3}$/.test(corpusId)) throw new TypeError("Invalid BEAM declaration corpusId.");
  if (exposure !== "development" && exposure !== "evaluated" && exposure !== "unknown") throw new TypeError("BEAM declarations cannot declare a history unseen.");
  if (typeof evidence !== "string" || evidence.length === 0 || Buffer.byteLength(evidence) > 512) throw new TypeError("BEAM declaration evidence must be bounded text.");
  return { corpusId, exposure, evidence };
}

export function parseBeamExposureDeclarations(value: unknown): readonly BeamExposureDeclaration[] {
  if (!Array.isArray(value) || value.length > BEAM_REVIEW_MAX_HISTORIES) throw new TypeError("BEAM declarations must be a bounded array.");
  const declarations = value.map(parseDeclaration);
  if (new Set(declarations.map((declaration) => declaration.corpusId)).size !== declarations.length) throw new TypeError("BEAM declarations repeat a corpusId.");
  return declarations;
}

function parseThresholds(value: unknown): BeamOverlapThresholds {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["maximumExactTurnMatches", "maximumSampledShingleMatchesPerCorpus"])) throw new TypeError("Invalid BEAM overlap thresholds.");
  for (const key of ["maximumExactTurnMatches", "maximumSampledShingleMatchesPerCorpus"]) {
    if (key === "maximumSampledShingleMatchesPerCorpus" && value[key] === null) continue;
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0 || (value[key] as number) > 1_000_000) throw new TypeError("Invalid BEAM overlap threshold.");
  }
  return { maximumExactTurnMatches: value.maximumExactTurnMatches as number, maximumSampledShingleMatchesPerCorpus: value.maximumSampledShingleMatchesPerCorpus as number | null };
}

function exceedsThresholds(overlap: readonly BeamReviewMatch[], thresholds: BeamOverlapThresholds): boolean {
  return overlap.some((match) => match.exactTurnMatches > thresholds.maximumExactTurnMatches
    || (thresholds.maximumSampledShingleMatchesPerCorpus !== null && match.maximumCorpusSampledShingleMatches > thresholds.maximumSampledShingleMatchesPerCorpus));
}

/** Union histories that share a generation seed, user profile or identical rendered content; the smallest corpusId names the family. */
function suggestGroups(provenance: readonly BeamHistoryProvenance[], contentDigests: readonly string[]): readonly string[] {
  const roots = provenance.map((_, index) => index);
  const find = (index: number): number => { while (roots[index] !== index) { roots[index] = roots[roots[index]!]!; index = roots[index]!; } return index; };
  const heads = new Map<string, number>();
  provenance.forEach((history, index) => {
    for (const key of [`seed:${history.seedSha256}`, `profile:${history.profileSha256}`, `content:${contentDigests[index]}`]) {
      const previous = heads.get(key);
      if (previous === undefined) heads.set(key, index); else roots[find(index)] = find(previous);
    }
  });
  const names = new Map<number, string>();
  provenance.forEach((history, index) => {
    const root = find(index), current = names.get(root);
    if (current === undefined || history.corpusId < current) names.set(root, history.corpusId);
  });
  return provenance.map((_, index) => names.get(find(index))!);
}

export function reviewBeamExposure(input: Readonly<{
  beam: Dataset; provenance: readonly BeamHistoryProvenance[]; references: readonly BeamReferenceDataset[];
  declarations?: readonly BeamExposureDeclaration[]; thresholds?: BeamOverlapThresholds; createdAt?: string;
}>): BeamExposureReview {
  const { beam, provenance } = input;
  if (beam.corpora.length === 0 || beam.corpora.length > BEAM_REVIEW_MAX_HISTORIES) throw new RangeError("BEAM review needs 1..1000 histories.");
  if (provenance.length !== beam.corpora.length || provenance.some((history, index) => history.corpusId !== beam.corpora[index]!.id)) {
    throw new TypeError("BEAM provenance must align with the parsed corpora.");
  }
  if (input.references.length > 8 || new Set(input.references.map((reference) => reference.dataset)).size !== input.references.length) {
    throw new RangeError("BEAM review accepts at most eight distinct reference datasets.");
  }
  const declarations = parseBeamExposureDeclarations(input.declarations ?? []);
  const thresholds = parseThresholds(input.thresholds ?? BEAM_DEFAULT_THRESHOLDS);
  const createdAt = parseCanonicalInstantV1(input.createdAt ?? canonicalNow());
  if (createdAt === null) throw new TypeError("Invalid review createdAt.");
  const known = new Set(beam.corpora.map((corpus) => corpus.id));
  for (const declaration of declarations) if (!known.has(declaration.corpusId)) throw new TypeError("BEAM declaration names an unknown history.");
  const declared = new Map(declarations.map((declaration) => [declaration.corpusId, declaration]));
  const questionsByCorpus = new Map<string, number>(), ambiguousByCorpus = new Map<string, number>();
  for (const question of beam.questions) {
    questionsByCorpus.set(question.corpusId, (questionsByCorpus.get(question.corpusId) ?? 0) + 1);
    if (question.ambiguousEvidence === true) ambiguousByCorpus.set(question.corpusId, (ambiguousByCorpus.get(question.corpusId) ?? 0) + 1);
  }
  const contentDigests = beam.corpora.map((corpus) => canonicalSha256(corpus.turns));
  const groupIds = suggestGroups(provenance, contentDigests);
  const index = indexBeam(beam);
  const overlapByReference = input.references.map((reference) => scanReference(index, reference, beam.corpora.length));
  const members = new Map<string, string[]>();
  beam.corpora.forEach((corpus, position) => { const list = members.get(groupIds[position]!) ?? []; list.push(corpus.id); members.set(groupIds[position]!, list); });
  const histories: BeamReviewHistory[] = beam.corpora.map((corpus, position) => {
    const history = provenance[position]!;
    const overlap = overlapByReference.map((matches) => matches[position]!);
    const declaration = declared.get(corpus.id);
    const overlapping = exceedsThresholds(overlap, thresholds);
    return { corpusId: corpus.id, split: history.split, rowIndex: history.rowIndex, sessions: new Set(corpus.turns.map((turn) => turn.sessionId)).size,
      turns: corpus.turns.length, questions: questionsByCorpus.get(corpus.id) ?? 0, ambiguousEvidenceQuestions: ambiguousByCorpus.get(corpus.id) ?? 0,
      contentSha256: contentDigests[position]!,
      conversationIdSha256: history.conversationIdSha256, seedSha256: history.seedSha256, profileSha256: history.profileSha256,
      narrativesSha256: history.narrativesSha256, planSha256: history.planSha256, userQuestionsSha256: history.userQuestionsSha256,
      suggestedGroupId: groupIds[position]!, relatedHistories: members.get(groupIds[position]!)!.filter((id) => id !== corpus.id).sort(),
      declaredExposure: declaration === undefined ? null : { exposure: declaration.exposure, evidence: declaration.evidence },
      overlap, eligible: declaration === undefined && !overlapping };
  });
  const byGroup = new Map<string, BeamReviewHistory[]>();
  for (const history of histories) { const list = byGroup.get(history.suggestedGroupId) ?? []; list.push(history); byGroup.set(history.suggestedGroupId, list); }
  const referenceNames = input.references.map((reference) => reference.dataset).join(", ") || "no reference dataset";
  const groups: EvolutionGroupDisposition[] = [...byGroup.entries()].sort(([left], [right]) => left < right ? -1 : 1).map(([groupId, rows]) => {
    const declaredRows = rows.filter((row) => row.declaredExposure !== null);
    if (declaredRows.length > 0) {
      const exposures = new Set(declaredRows.map((row) => row.declaredExposure!.exposure));
      const exposure: EvolutionExposure = exposures.has("evaluated") ? "evaluated" : exposures.has("development") ? "development" : "unknown";
      return { groupId, partition: "closed" as const, exposure, evidence: `Declared prior exposure for ${declaredRows.length} of ${rows.length} related histories.` };
    }
    const overlapping = rows.filter((row) => !row.eligible);
    if (overlapping.length > 0) {
      return { groupId, partition: "closed" as const, exposure: "unknown" as const,
        evidence: `${overlapping.length} of ${rows.length} related histories exceed the overlap thresholds against ${referenceNames}.` };
    }
    return { groupId, partition: "sealed" as const, exposure: "unseen" as const,
      evidence: `No declared exposure; ${rows.length} related histories within the overlap thresholds against ${referenceNames}.` };
  });
  const eligibleGroups = new Set(groups.filter((group) => group.partition === "sealed").map((group) => group.groupId));
  const eligibleHistories = histories.filter((history) => eligibleGroups.has(history.suggestedGroupId));
  return {
    protocol: BEAM_REVIEW_PROTOCOL, createdAt, dataset: "beam", source: { revision: DATASETS.beam.revision, sha256: DATASETS.beam.sha256, questionDatePolicy: BEAM_QUESTION_DATE_POLICY },
    references: input.references.map((reference) => {
      const sha256 = parseSha256Hex(reference.sha256);
      if (sha256 === null) throw new TypeError("Reference dataset sha256 required.");
      return { dataset: reference.dataset, sha256, corpora: reference.data.corpora.length,
        turns: reference.data.corpora.reduce((sum, corpus) => sum + corpus.turns.length, 0) };
    }),
    shinglePolicy: BEAM_SHINGLE_POLICY, thresholds, declarations, histories, groups,
    summary: { histories: histories.length, questions: beam.questions.length,
      ambiguousEvidenceQuestions: beam.questions.filter((question) => question.ambiguousEvidence === true).length, eligibleHistories: eligibleHistories.length,
      eligibleQuestions: eligibleHistories.reduce((sum, history) => sum + history.questions, 0), eligibleGroups: eligibleGroups.size,
      declaredExposures: declarations.length, overlappingHistories: histories.filter((history) => history.declaredExposure === null && !history.eligible).length,
      relatedGroups: groups.filter((group) => members.get(group.groupId)!.length > 1).length },
    qualification: "Declared dispositions from digests and sampled overlap only; no independence, freshness or absence of undeclared exposure is inferred.",
  };
}

function scalar(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) throw new TypeError("Invalid BEAM review field.");
  return value as number;
}
function digest(value: unknown): string {
  const result = parseSha256Hex(value);
  if (result === null) throw new TypeError("Invalid BEAM review digest.");
  return result;
}
function bounded(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > maximum) throw new TypeError("Invalid BEAM review text.");
  return value;
}

/** Exact-key parse of a stored review; digests, counts and dispositions are re-checked for internal consistency. */
export function parseBeamExposureReview(value: unknown): BeamExposureReview {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "createdAt", "dataset", "source", "references", "shinglePolicy", "thresholds",
    "declarations", "histories", "groups", "summary", "qualification"])) throw new TypeError("BEAM review has an unexpected shape.");
  if (value.protocol !== BEAM_REVIEW_PROTOCOL || value.dataset !== "beam") throw new TypeError("Unexpected BEAM review protocol.");
  const createdAt = parseCanonicalInstantV1(value.createdAt);
  if (createdAt === null) throw new TypeError("Invalid BEAM review createdAt.");
  const source = value.source;
  if (!isPlainRecord(source) || !hasExactKeys(source, ["revision", "sha256", "questionDatePolicy"]) || source.revision !== DATASETS.beam.revision
    || source.sha256 !== DATASETS.beam.sha256 || source.questionDatePolicy !== BEAM_QUESTION_DATE_POLICY) {
    throw new TypeError("BEAM review source does not match the pinned dataset.");
  }
  if (canonicalSha256(value.shinglePolicy) !== canonicalSha256(BEAM_SHINGLE_POLICY)) throw new TypeError("BEAM review shingle policy changed.");
  const thresholds = parseThresholds(value.thresholds);
  const declarations = parseBeamExposureDeclarations(value.declarations);
  if (!Array.isArray(value.references) || value.references.length > 8) throw new TypeError("Invalid BEAM review references.");
  const references = value.references.map((raw) => {
    if (!isPlainRecord(raw) || !hasExactKeys(raw, ["dataset", "sha256", "corpora", "turns"])) throw new TypeError("Invalid BEAM review reference.");
    return { dataset: bounded(raw.dataset, 64), sha256: digest(raw.sha256), corpora: scalar(raw.corpora, 0, 1_000_000), turns: scalar(raw.turns, 0, 100_000_000) };
  });
  if (new Set(references.map((reference) => reference.dataset)).size !== references.length) throw new TypeError("BEAM review repeats a reference dataset.");
  if (!Array.isArray(value.histories) || value.histories.length < 1 || value.histories.length > BEAM_REVIEW_MAX_HISTORIES) throw new TypeError("Invalid BEAM review histories.");
  const histories: BeamReviewHistory[] = value.histories.map((raw) => {
    if (!isPlainRecord(raw) || !hasExactKeys(raw, ["corpusId", "split", "rowIndex", "sessions", "turns", "questions", "ambiguousEvidenceQuestions", "contentSha256", "conversationIdSha256",
      "seedSha256", "profileSha256", "narrativesSha256", "planSha256", "userQuestionsSha256", "suggestedGroupId", "relatedHistories", "declaredExposure",
      "overlap", "eligible"])) throw new TypeError("Invalid BEAM review history.");
    if (typeof raw.split !== "string" || !BEAM_SPLITS.includes(raw.split as BeamSplit)) throw new TypeError("Invalid BEAM review split.");
    if (!Array.isArray(raw.relatedHistories) || raw.relatedHistories.length > BEAM_REVIEW_MAX_HISTORIES) throw new TypeError("Invalid BEAM review relations.");
    if (!Array.isArray(raw.overlap) || raw.overlap.length !== references.length) throw new TypeError("BEAM review overlap must cover every reference.");
    const declaredExposure = raw.declaredExposure === null ? null : (() => {
      const declaration = parseDeclaration({ corpusId: raw.corpusId, ...(isPlainRecord(raw.declaredExposure) ? raw.declaredExposure : {}) });
      return { exposure: declaration.exposure, evidence: declaration.evidence };
    })();
    if (typeof raw.eligible !== "boolean") throw new TypeError("Invalid BEAM review eligibility.");
    const rowIndex = scalar(raw.rowIndex, 0, 999);
    if (raw.corpusId !== beamCorpusId(raw.split as BeamSplit, rowIndex)) throw new TypeError("BEAM review history coordinates disagree with its corpusId.");
    return { corpusId: bounded(raw.corpusId, 64), split: raw.split as BeamSplit, rowIndex, sessions: scalar(raw.sessions, 1, 8_192),
      turns: scalar(raw.turns, 1, 8_192), questions: scalar(raw.questions, 0, 10_000), ambiguousEvidenceQuestions: scalar(raw.ambiguousEvidenceQuestions, 0, 10_000),
      contentSha256: digest(raw.contentSha256),
      conversationIdSha256: digest(raw.conversationIdSha256), seedSha256: digest(raw.seedSha256), profileSha256: digest(raw.profileSha256),
      narrativesSha256: digest(raw.narrativesSha256), planSha256: digest(raw.planSha256), userQuestionsSha256: digest(raw.userQuestionsSha256),
      suggestedGroupId: bounded(raw.suggestedGroupId, 64), relatedHistories: raw.relatedHistories.map((id) => bounded(id, 64)), declaredExposure,
      overlap: raw.overlap.map((match, position) => {
        if (!isPlainRecord(match) || !hasExactKeys(match, ["dataset", "exactTurnMatches", "sampledShingleMatches", "maximumCorpusSampledShingleMatches", "matchedCorpora"])
          || match.dataset !== references[position]!.dataset || !Array.isArray(match.matchedCorpora) || match.matchedCorpora.length > MAX_MATCHED_CORPORA) {
          throw new TypeError("Invalid BEAM review overlap entry.");
        }
        return { dataset: references[position]!.dataset, exactTurnMatches: scalar(match.exactTurnMatches, 0, 100_000_000),
          sampledShingleMatches: scalar(match.sampledShingleMatches, 0, 100_000_000),
          maximumCorpusSampledShingleMatches: scalar(match.maximumCorpusSampledShingleMatches, 0, 100_000_000),
          matchedCorpora: match.matchedCorpora.map((entry) => {
            if (!isPlainRecord(entry) || !hasExactKeys(entry, ["corpusId", "exactTurnMatches", "sampledShingleMatches"])) throw new TypeError("Invalid BEAM review match.");
            return { corpusId: bounded(entry.corpusId), exactTurnMatches: scalar(entry.exactTurnMatches, 0, 100_000_000),
              sampledShingleMatches: scalar(entry.sampledShingleMatches, 0, 100_000_000) };
          }) };
      }), eligible: raw.eligible };
  });
  if (new Set(histories.map((history) => history.corpusId)).size !== histories.length) throw new TypeError("BEAM review repeats a history.");
  const known = new Set(histories.map((history) => history.corpusId));
  const declared = new Map(declarations.map((declaration) => [declaration.corpusId, declaration]));
  if (histories.filter((history) => history.declaredExposure !== null).length !== declarations.length) throw new TypeError("BEAM review declarations disagree with its histories.");
  const membersByGroup = new Map<string, string[]>();
  for (const history of histories) { const list = membersByGroup.get(history.suggestedGroupId) ?? []; list.push(history.corpusId); membersByGroup.set(history.suggestedGroupId, list); }
  for (const history of histories) {
    if (history.ambiguousEvidenceQuestions > history.questions) throw new TypeError("BEAM review ambiguous evidence exceeds its questions.");
    const declaration = declared.get(history.corpusId);
    if ((declaration === undefined) !== (history.declaredExposure === null) || (declaration !== undefined
      && (declaration.exposure !== history.declaredExposure!.exposure || declaration.evidence !== history.declaredExposure!.evidence))) {
      throw new TypeError("BEAM review declarations disagree with its histories.");
    }
    const overlapping = exceedsThresholds(history.overlap, thresholds);
    if (history.eligible !== (history.declaredExposure === null && !overlapping)) throw new TypeError("BEAM review eligibility disagrees with its evidence.");
    if (!known.has(history.suggestedGroupId) || history.relatedHistories.some((id) => !known.has(id) || id === history.corpusId)) throw new TypeError("BEAM review relations name unknown histories.");
    const expectedRelations = membersByGroup.get(history.suggestedGroupId)!.filter((id) => id !== history.corpusId).sort();
    if (JSON.stringify(history.relatedHistories) !== JSON.stringify(expectedRelations)) throw new TypeError("BEAM review relations disagree with its families.");
  }
  if (!Array.isArray(value.groups) || value.groups.length > BEAM_REVIEW_MAX_HISTORIES) throw new TypeError("Invalid BEAM review groups.");
  const groups: EvolutionGroupDisposition[] = value.groups.map((raw) => {
    if (!isPlainRecord(raw) || !hasExactKeys(raw, ["groupId", "partition", "exposure", "evidence"])) throw new TypeError("Invalid BEAM review group.");
    if ((raw.partition !== "sealed" && raw.partition !== "closed") || !["unseen", "development", "evaluated", "unknown"].includes(raw.exposure as string)
      || (raw.partition === "sealed") !== (raw.exposure === "unseen")) throw new TypeError("Invalid BEAM review disposition.");
    return { groupId: bounded(raw.groupId, 64), partition: raw.partition, exposure: raw.exposure as EvolutionExposure, evidence: bounded(raw.evidence) };
  });
  const groupIds = groups.map((group) => group.groupId);
  const suggested = [...new Set(histories.map((history) => history.suggestedGroupId))].sort();
  if (JSON.stringify(groupIds) !== JSON.stringify(suggested)) throw new TypeError("BEAM review groups must cover exactly the suggested families.");
  const sealed = new Set(groups.filter((group) => group.partition === "sealed").map((group) => group.groupId));
  for (const history of histories) if (sealed.has(history.suggestedGroupId) && !history.eligible) throw new TypeError("A sealed BEAM family contains an ineligible history.");
  const summary = value.summary;
  if (!isPlainRecord(summary) || !hasExactKeys(summary, ["histories", "questions", "ambiguousEvidenceQuestions", "eligibleHistories", "eligibleQuestions", "eligibleGroups",
    "declaredExposures", "overlappingHistories", "relatedGroups"])) throw new TypeError("Invalid BEAM review summary.");
  const eligible = histories.filter((history) => sealed.has(history.suggestedGroupId));
  const expected = { histories: histories.length, questions: histories.reduce((sum, history) => sum + history.questions, 0),
    ambiguousEvidenceQuestions: histories.reduce((sum, history) => sum + history.ambiguousEvidenceQuestions, 0), eligibleHistories: eligible.length,
    eligibleQuestions: eligible.reduce((sum, history) => sum + history.questions, 0), eligibleGroups: sealed.size, declaredExposures: declarations.length,
    overlappingHistories: histories.filter((history) => history.declaredExposure === null && !history.eligible).length,
    relatedGroups: groups.filter((group) => histories.filter((history) => history.suggestedGroupId === group.groupId).length > 1).length };
  if (canonicalSha256(summary) !== canonicalSha256(expected)) throw new TypeError("BEAM review summary disagrees with its histories.");
  const qualification = "Declared dispositions from digests and sampled overlap only; no independence, freshness or absence of undeclared exposure is inferred." as const;
  if (value.qualification !== qualification) throw new TypeError("BEAM review qualification changed.");
  return { protocol: BEAM_REVIEW_PROTOCOL, createdAt, dataset: "beam", source: { revision: DATASETS.beam.revision, sha256: DATASETS.beam.sha256, questionDatePolicy: BEAM_QUESTION_DATE_POLICY }, references,
    shinglePolicy: BEAM_SHINGLE_POLICY, thresholds, declarations, histories, groups, summary: expected, qualification };
}

/** The parsed dataset with each history's groupId replaced by the review's family; the manifest input follows the review's dispositions. */
export function applyBeamReview(dataset: Dataset, review: BeamExposureReview): Dataset {
  const families = new Map(review.histories.map((history) => [history.corpusId, history.suggestedGroupId]));
  if (dataset.corpora.length !== review.histories.length || dataset.corpora.some((corpus) => !families.has(corpus.id))) {
    throw new TypeError("BEAM review does not cover the parsed dataset.");
  }
  return { corpora: dataset.corpora.map((corpus) => ({ ...corpus, groupId: families.get(corpus.id)! })), questions: dataset.questions };
}

export function beamManifestInput(review: BeamExposureReview): Readonly<{ dataset: "beam"; revision: string; sourceSha256: string; groups: readonly EvolutionGroupDisposition[] }> {
  return { dataset: "beam", revision: review.source.revision, sourceSha256: review.source.sha256, groups: review.groups };
}
