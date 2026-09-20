import { canonicalSha256, sha256Hex } from "../../src/canonical";
import type { Corpus, Turn } from "./datasets";
import { createEvolutionContextSourceValidator, type EvolutionRetrievalResult, type EvolutionRetrievalVariant } from "./evolution-retrieval";
import { pack } from "./retrieval";

/** A development adapter over an existing retained semantic ranking. It does not
 * reconstruct omitted top-k hits or treat adjacency as semantic support. */
export const EVOLUTION_SEMANTIC_NEIGHBORHOOD_POLICY = Object.freeze({
  protocol: "oh.evolution-semantic-neighborhood-policy.v1",
  parentSystem: "oh-semantic", maximumAnchors: 100,
  order: "anchor-previous-next", radius: 1,
  boundary: "same-session-id-and-occurrence",
  packing: "whole-unchanged-turns-first-fit-parent-byte-budget",
  inputPool: "retained-parent-turns-only",
} as const);

export type SemanticNeighborhoodParent = Readonly<{
  variant: EvolutionRetrievalVariant;
  result: EvolutionRetrievalResult;
  expectedResultSha256: string;
}>;

export function prepareEvolutionSemanticNeighborhood(input: Corpus) {
  if (!Array.isArray(input.turns) || input.turns.length < 1 || input.turns.length > 8192) {
    throw new RangeError("Semantic neighborhood needs 1–8192 source turns.");
  }
  // Whitelist source fields. In particular, never inspect attached QA or labels.
  const corpus: Corpus = { id: input.id, groupId: input.groupId, turns: input.turns.map((turn): Turn => {
    const { id, sessionId, sessionIndex, date, speaker, text } = turn;
    return Object.freeze({ id, sessionId, ...(sessionIndex === undefined ? {} : { sessionIndex }), date, speaker, text });
  }) };
  const validate = createEvolutionContextSourceValidator(corpus, { semantic: true });
  const corpusSha256 = canonicalSha256(corpus), positions = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  return (question: string, parent: SemanticNeighborhoodParent) => {
    const { variant, result } = parent;
    if (typeof question !== "string" || question.length === 0 || Buffer.byteLength(question) > 16_384
      || variant.system !== "oh-semantic" || !Number.isSafeInteger(variant.budget.topK)
      || variant.budget.topK < 1 || variant.budget.topK > 100
      || !Number.isSafeInteger(variant.budget.contextBytes) || variant.budget.contextBytes < 1 || variant.budget.contextBytes > 4_000_000
      || result.variantSha256 !== canonicalSha256(variant) || result.querySha256 !== sha256Hex(question)
      || result.resultSha256 !== parent.expectedResultSha256 || result.turnIds.length > variant.budget.topK
      || result.contextBytes > variant.budget.contextBytes) throw new TypeError("Invalid semantic neighborhood parent.");
    validate(result);
    const candidates: Turn[] = [], seen = new Set<string>();
    const witnesses: { turnId: string; turnSha256: string; anchorId: string; offset: number }[] = [];
    for (const id of result.turnIds) {
      const index = positions.get(id)!;
      const anchor = corpus.turns[index]!;
      for (const offset of [0, -1, 1]) {
        const turn = corpus.turns[index + offset];
        if (!turn || turn.sessionId !== anchor.sessionId || turn.sessionIndex !== anchor.sessionIndex || seen.has(turn.id)) continue;
        seen.add(turn.id); candidates.push(turn);
        witnesses.push({ turnId: turn.id, turnSha256: canonicalSha256(turn), anchorId: id, offset });
      }
    }
    const packed = pack(candidates.map(turn => ({ turn })), variant.budget.contextBytes);
    const selected = new Set(packed.turnIds), original = new Set(result.turnIds);
    const payload = {
      protocol: "oh.evolution-semantic-neighborhood.v1" as const,
      policySha256: canonicalSha256(EVOLUTION_SEMANTIC_NEIGHBORHOOD_POLICY),
      corpusSha256, parentResultSha256: result.resultSha256, querySha256: result.querySha256,
      budgetBytes: variant.budget.contextBytes, candidateTurnIds: candidates.map(turn => turn.id), witnesses,
      context: packed.context, contextSha256: sha256Hex(packed.context), contextBytes: Buffer.byteLength(packed.context),
      turnIds: packed.turnIds, sessionIds: packed.sessionIds, omittedForBudget: packed.omittedForBudget,
      addedTurnIds: packed.turnIds.filter(id => !original.has(id)),
      removedTurnIds: result.turnIds.filter(id => !selected.has(id)),
    };
    return { ...payload, resultSha256: canonicalSha256(payload) };
  };
}
