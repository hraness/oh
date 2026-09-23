import { canonicalSha256, sha256Hex } from "../../src/canonical";
import type { Corpus, Turn } from "./datasets";
import { prepareEvolutionSemanticNeighborhood, type SemanticNeighborhoodParent } from "./evolution-semantic-neighborhood";
import { pack } from "./retrieval";

export const EVOLUTION_SEMANTIC_COMPLETION_POLICY = Object.freeze({
  protocol: "oh.evolution-semantic-completion-policy.v1",
  inputPool: "retained-semantic-anchors-and-same-session-immediate-neighbors",
  retention: "exact-parent-context-prefix-all-original-turns",
  completionOrder: "first-occurrence-in-anchor-previous-next-order",
  packing: "whole-unchanged-neighbor-turns-first-fit-in-parent-byte-slack",
} as const);

/** The no-eviction control for source completion. It authenticates the parent and
 * expands the same source pool as the interleaved adapter, but preserves every
 * original passage. An omitted neighbor is not negative evidence. */
export function prepareEvolutionSemanticCompletion(input: Corpus) {
  const rawTurns = input.turns;
  if (!Array.isArray(rawTurns) || rawTurns.length < 1 || rawTurns.length > 8192) {
    throw new RangeError("Semantic completion needs 1–8192 source turns.");
  }
  // Detach once: validation and rendering must see the same source values even
  // when an input accessor changes. Labels and extra properties are never read.
  const corpus: Corpus = { id: input.id, groupId: input.groupId, turns: rawTurns.map((turn): Turn => {
    const { id, sessionId, sessionIndex, date, speaker, text } = turn;
    return Object.freeze({ id, sessionId, ...(sessionIndex === undefined ? {} : { sessionIndex }), date, speaker, text });
  }) };
  const neighborhood = prepareEvolutionSemanticNeighborhood(corpus);
  const turns = new Map(corpus.turns.map(turn => [turn.id, turn]));
  return (question: string, parent: SemanticNeighborhoodParent) => {
    const pool = neighborhood(question, parent), original = new Set(parent.result.turnIds);
    const completionIds = pool.candidateTurnIds.filter(id => !original.has(id));
    const ordered = [...parent.result.turnIds, ...completionIds];
    const packed = pack(ordered.map(id => ({ turn: turns.get(id)! })), parent.variant.budget.contextBytes);
    if (!parent.result.turnIds.every((id, i) => packed.turnIds[i] === id)
      || !packed.context.startsWith(parent.result.context)) throw new Error("Semantic completion lost its original source prefix.");
    const payload = {
      protocol: "oh.evolution-semantic-completion.v1" as const,
      policySha256: canonicalSha256(EVOLUTION_SEMANTIC_COMPLETION_POLICY),
      corpusSha256: pool.corpusSha256, parentResultSha256: parent.result.resultSha256,
      querySha256: parent.result.querySha256, budgetBytes: parent.variant.budget.contextBytes,
      candidateTurnIds: pool.candidateTurnIds, witnesses: pool.witnesses,
      context: packed.context, contextSha256: sha256Hex(packed.context), contextBytes: Buffer.byteLength(packed.context),
      turnIds: packed.turnIds, sessionIds: packed.sessionIds,
      addedTurnIds: packed.turnIds.slice(parent.result.turnIds.length),
      omittedForBudget: packed.omittedForBudget,
      originalContextSha256: parent.result.contextSha256,
      originalContextBytes: parent.result.contextBytes,
    };
    return { ...payload, resultSha256: canonicalSha256(payload) };
  };
}
