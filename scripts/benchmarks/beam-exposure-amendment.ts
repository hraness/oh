/** Additive exposure updates use review metadata only; no corpus or question bytes are needed. */
import { parseCanonicalInstantV1 } from "../../src/canonical";
import known from "../../benchmarks/results/beam-exposure-declarations-v2.json";
import { parseBeamExposureDeclarations, parseBeamExposureReview,
  type BeamExposureDeclaration, type BeamExposureReview } from "./beam-review";

export const BEAM_KNOWN_EXPOSURES = Object.freeze(parseBeamExposureDeclarations(known));
const level = { unknown: 0, development: 1, evaluated: 2 } as const;

export function mergeBeamExposureDeclarations(...inputs: readonly (readonly BeamExposureDeclaration[])[]): readonly BeamExposureDeclaration[] {
  const byId = new Map<string, BeamExposureDeclaration>();
  for (const input of inputs) for (const declaration of parseBeamExposureDeclarations(input)) {
    const previous = byId.get(declaration.corpusId);
    if (previous === undefined || level[declaration.exposure] > level[previous.exposure]) byId.set(declaration.corpusId, declaration);
  }
  return parseBeamExposureDeclarations([...byId.values()].sort((a, b) => a.corpusId < b.corpusId ? -1 : 1));
}

export function amendBeamExposureReview(input: BeamExposureReview, additions: readonly BeamExposureDeclaration[], createdAt: string): BeamExposureReview {
  const review = parseBeamExposureReview(input);
  if (parseCanonicalInstantV1(createdAt) === null || createdAt < review.createdAt) throw new TypeError("Exposure amendment needs a canonical time no earlier than the review.");
  const declarations = mergeBeamExposureDeclarations(review.declarations, additions);
  const knownIds = new Set(review.histories.map(row => row.corpusId));
  if (declarations.some(row => !knownIds.has(row.corpusId))) throw new TypeError("Exposure amendment names a history absent from the review.");
  const declared = new Map(declarations.map(row => [row.corpusId, row]));
  const histories = review.histories.map(row => {
    const declaration = declared.get(row.corpusId);
    return declaration === undefined ? row : { ...row, eligible: false,
      declaredExposure: { exposure: declaration.exposure, evidence: declaration.evidence } };
  });
  const groups = review.groups.map(group => {
    const exposures = histories.filter(row => row.suggestedGroupId === group.groupId && row.declaredExposure !== null)
      .map(row => row.declaredExposure!.exposure);
    if (exposures.length === 0) return group;
    const exposure = exposures.includes("evaluated") ? "evaluated" : exposures.includes("development") ? "development" : "unknown";
    return { ...group, partition: "closed", exposure, evidence: "Prior exposure closes this entire related family; see the history declarations." };
  });
  const sealed = new Set(groups.filter(group => group.partition === "sealed").map(group => group.groupId));
  const eligible = histories.filter(row => sealed.has(row.suggestedGroupId));
  return parseBeamExposureReview({ ...review, createdAt, declarations, histories, groups,
    summary: { ...review.summary, eligibleHistories: eligible.length, eligibleQuestions: eligible.reduce((n, row) => n + row.questions, 0),
      eligibleGroups: sealed.size, declaredExposures: declarations.length,
      overlappingHistories: histories.filter(row => row.declaredExposure === null && !row.eligible).length } });
}

/** CLI draw preflight: historical reviews remain replayable, but cannot authorize a fresh draw. */
export function assertBeamKnownExposures(reviewInput: BeamExposureReview,
  required: readonly BeamExposureDeclaration[] = BEAM_KNOWN_EXPOSURES): void {
  const review = parseBeamExposureReview(reviewInput);
  const histories = new Map(review.histories.map(row => [row.corpusId, row]));
  const groups = new Map(review.groups.map(row => [row.groupId, row]));
  for (const declaration of parseBeamExposureDeclarations(required)) {
    const history = histories.get(declaration.corpusId), exposure = history?.declaredExposure?.exposure;
    if (history === undefined || exposure === undefined || exposure === "unseen" || level[exposure] < level[declaration.exposure]
      || groups.get(history.suggestedGroupId)?.partition !== "closed") {
      throw new TypeError(`BEAM review predates known exposure for ${declaration.corpusId}; amend the review before drawing.`);
    }
  }
}
