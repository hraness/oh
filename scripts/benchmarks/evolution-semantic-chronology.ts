import { canonicalSha256, sha256Hex } from "../../src/canonical";
import type { Corpus, Turn } from "./datasets";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion } from "./evolution-completion";
import { createEvolutionContextSourceValidator } from "./evolution-retrieval";
import type { SemanticNeighborhoodParent } from "./evolution-semantic-neighborhood";
import { renderTurn } from "./retrieval";

export const EVOLUTION_SEMANTIC_CHRONOLOGY_POLICY = Object.freeze({
  protocol: "oh.evolution-semantic-chronology-policy.v1",
  parentSystem: "oh-semantic", maximumSourceTurns: 8192, maximumAnchors: 100,
  inputPool: "exact-retained-parent-turns", order: "ascending-source-array-position",
  rendering: "unchanged-whole-turns-with-native-separators",
  retention: "all-and-only-parent-turns-same-byte-count",
} as const);

/** Reorders an authenticated retained semantic context; it does not retrieve,
 * infer event dates or add evidence. The caller must authenticate the original
 * parent artifact pin: source validation alone does not prove search custody. */
export function prepareEvolutionSemanticChronology(input: Corpus) {
  const rawTurns = input.turns;
  if (!Array.isArray(rawTurns) || rawTurns.length < 1 || rawTurns.length > 8192) {
    throw new RangeError("Semantic chronology needs 1–8192 source turns.");
  }
  // Read each permitted source field once. Validation and rendering share this
  // detached snapshot; evaluator properties and their accessors are not read.
  const corpus: Corpus = { id: input.id, groupId: input.groupId, turns: rawTurns.map((turn): Turn => {
    const { id, sessionId, sessionIndex, date, speaker, text } = turn;
    return Object.freeze({ id, sessionId, ...(sessionIndex === undefined ? {} : { sessionIndex }), date, speaker, text });
  }) };
  const validate = createEvolutionContextSourceValidator(corpus, { semantic: true });
  freezeEvolutionCompletion(corpus);
  const corpusSha256 = canonicalSha256(corpus);
  const positions = new Map(corpus.turns.map((turn, index) => [turn.id, index]));

  return (question: string, inputParent: SemanticNeighborhoodParent) => {
    // Reject parent accessors before cloning, so authentication and use cannot
    // observe different result arrays or source identities.
    boundEvolutionCompletionWire(inputParent, 4_200_000);
    const parent = structuredClone(inputParent), { variant, result } = parent;
    if (typeof question !== "string" || question.length === 0 || Buffer.byteLength(question) > 16_384
      || /\p{Surrogate}/u.test(question) || typeof variant.id !== "string" || !variant.id
      || Buffer.byteLength(variant.id) > 512 || variant.system !== "oh-semantic"
      || !Number.isSafeInteger(variant.budget.topK) || variant.budget.topK < 1 || variant.budget.topK > 100
      || !Number.isSafeInteger(variant.budget.contextBytes) || variant.budget.contextBytes < 1 || variant.budget.contextBytes > 4_000_000
      || result.variantSha256 !== canonicalSha256(variant) || result.querySha256 !== sha256Hex(question)
      || result.resultSha256 !== parent.expectedResultSha256 || !Array.isArray(result.turnIds)
      || result.turnIds.length > variant.budget.topK || result.contextBytes > variant.budget.contextBytes) {
      throw new TypeError("Invalid semantic chronology parent.");
    }
    validate(result);
    const originalRanks = new Map(result.turnIds.map((id, rank) => [id, rank]));
    const turnIds = [...result.turnIds].sort((a, b) => positions.get(a)! - positions.get(b)!);
    const turns = turnIds.map(id => corpus.turns[positions.get(id)!]!);
    const context = turns.map(renderTurn).join("\n\n"), contextBytes = Buffer.byteLength(context);
    if (contextBytes !== result.contextBytes || contextBytes > variant.budget.contextBytes) {
      throw new Error("Semantic chronology changed the authenticated context byte count.");
    }
    let inversionCount = 0;
    for (let i = 0; i < result.turnIds.length; i++) {
      for (let j = i + 1; j < result.turnIds.length; j++) {
        if (positions.get(result.turnIds[i]!)! > positions.get(result.turnIds[j]!)!) inversionCount++;
      }
    }
    const movedTurnCount = turnIds.filter((id, rank) => originalRanks.get(id) !== rank).length;
    const payload = {
      protocol: "oh.evolution-semantic-chronology.v1" as const,
      policySha256: canonicalSha256(EVOLUTION_SEMANTIC_CHRONOLOGY_POLICY), corpusSha256,
      preparedSha256: result.preparedSha256, parentResultSha256: result.resultSha256,
      variantSha256: result.variantSha256, querySha256: result.querySha256,
      budgetBytes: variant.budget.contextBytes,
      originalContextSha256: result.contextSha256, originalContextBytes: result.contextBytes,
      originalTurnIds: result.turnIds, originalOrderSha256: canonicalSha256(result.turnIds),
      context, contextSha256: sha256Hex(context), contextBytes,
      turnIds, orderSha256: canonicalSha256(turnIds), sessionIds: [...new Set(turns.map(turn => turn.sessionId))],
      sources: turnIds.map(id => result.sources[originalRanks.get(id)!]!),
      witnesses: turns.map((turn, rank) => ({ turnId: turn.id, turnSha256: canonicalSha256(turn),
        corpusIndex: positions.get(turn.id)!, originalRank: originalRanks.get(turn.id)!, rank })),
      changed: movedTurnCount > 0, movedTurnCount, inversionCount,
      addedTurnIds: [] as readonly string[], removedTurnIds: [] as readonly string[],
      omittedForBudget: 0, originalOmittedForBudget: result.omittedForBudget,
    };
    return freezeEvolutionCompletion({ ...payload, resultSha256: canonicalSha256(payload) });
  };
}
