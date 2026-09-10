/** Pure presentation-order control over an authenticated, budgeted semantic result.
 * No search, generated facts, truncation, labels, or model/provider operations. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import type { Corpus } from "./datasets";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion, projectEvolutionCompletionCorpus,
  projectEvolutionCompletionQuestion, type EvolutionCompletionParent, type EvolutionCompletionQuestion } from "./evolution-completion";
import { validateEvolutionLegacyResultEnvelope } from "./evolution-plan";
import { createEvolutionContextSourceValidator, type EvolutionSourceIdentity } from "./evolution-retrieval";
import { renderTurn } from "./retrieval";

export const EVOLUTION_SOURCE_ORDER_POLICY = Object.freeze({
  protocol: "oh.memory.evolution-source-order-policy.v1" as const,
  parentSystem: "oh-semantic" as const, parentTopK: 100, parentContextBytes: 96_000,
  sourceUnit: "whole-turn" as const, order: "canonical-corpus-position" as const,
  membership: "exact-parent-turn-multiset" as const, rendering: "unchanged-renderTurn" as const,
  separator: "\n\n", additionalSourceUnits: 0, sourceTextChanges: 0,
});
const POLICY_SHA = canonicalSha256(EVOLUTION_SOURCE_ORDER_POLICY);
export type EvolutionSourceOrderInput = Readonly<{ question: EvolutionCompletionQuestion; parent: EvolutionCompletionParent }>;
export type EvolutionSourceOrderResult = Readonly<{
  protocol: "oh.memory.evolution-source-order.v1"; policySha256: string;
  corpusId: string; corpusSha256: string; questionSha256: string; querySha256: string;
  parentResultSha256: string; parentPreparedSha256: string; parentVariantSha256: string; parentContextSha256: string;
  context: string; contextSha256: string; contextBytes: number; turnIds: readonly string[];
  sessionIds: readonly string[]; sources: readonly EvolutionSourceIdentity[];
  originalRanks: readonly number[]; orderChanged: boolean; resultSha256: string;
}>;
const KEYS = ["protocol", "policySha256", "corpusId", "corpusSha256", "questionSha256", "querySha256", "parentResultSha256",
  "parentPreparedSha256", "parentVariantSha256", "parentContextSha256", "context", "contextSha256", "contextBytes", "turnIds",
  "sessionIds", "sources", "originalRanks", "orderChanged", "resultSha256"];
function fail(reason: string): never { throw new TypeError(`Evolution source order: ${reason}.`); }
/** Structural parent binding only. Current-source authentication is performed by the factory. */
export function validateEvolutionSourceOrderParent(value: unknown, question: EvolutionCompletionQuestion): EvolutionCompletionParent {
  boundEvolutionCompletionWire(value, 2_000_000);
  if (!isPlainRecord(value) || !hasExactKeys(value, ["variant", "result", "expectedResultSha256"])) fail("exact parent required");
  const p = value as unknown as EvolutionCompletionParent, v = p.variant;
  if (!isPlainRecord(v) || !hasExactKeys(v, ["id", "system", "budget"]) || typeof v.id !== "string" || !/^[a-z0-9][a-z0-9:-]{0,99}$/.test(v.id)
    || v.system !== "oh-semantic" || !isPlainRecord(v.budget) || !hasExactKeys(v.budget, ["topK", "contextBytes"])
    || v.budget.topK !== 100 || v.budget.contextBytes !== 96_000) fail("fixed semantic top100/96KB parent required");
  // The legacy envelope consumes only question bytes; corpus/ID custody is bound
  // separately by the source factory and enclosing plan.
  validateEvolutionLegacyResultEnvelope(p.result, { id: "source-order-envelope", corpusId: "source-order-envelope",
    ...projectEvolutionCompletionQuestion(question) }, 96_000);
  if (p.result.protocol !== "oh.evolution-retrieval.v1" || p.expectedResultSha256 !== p.result.resultSha256
    || p.result.variantSha256 !== canonicalSha256(v) || p.result.coverageKind !== null || p.result.turnIds.length > 100) fail("parent result binding");
  return p;
}
/** Envelope consistency is not source custody. Admission must also rebuild from the
 * current corpus and the independently reloaded original artifact via factory.validate. */
export function validateEvolutionSourceOrderResultEnvelope(value: unknown, input: EvolutionSourceOrderInput): EvolutionSourceOrderResult {
  boundEvolutionCompletionWire(value, 2_000_000);
  if (!isPlainRecord(value) || !hasExactKeys(value, KEYS)) fail("exact result shape");
  const q = projectEvolutionCompletionQuestion(input.question), p = validateEvolutionSourceOrderParent(input.parent, q).result;
  const r = value as unknown as EvolutionSourceOrderResult;
  if (r.protocol !== "oh.memory.evolution-source-order.v1" || r.policySha256 !== POLICY_SHA
    || typeof r.corpusId !== "string" || !r.corpusId.length || Buffer.byteLength(r.corpusId) > 512 || /\p{Surrogate}/u.test(r.corpusId)
    || parseSha256Hex(r.corpusSha256) === null || r.questionSha256 !== canonicalSha256(q) || r.querySha256 !== sha256Hex(q.question)
    || r.parentResultSha256 !== p.resultSha256 || r.parentPreparedSha256 !== p.preparedSha256 || r.parentVariantSha256 !== p.variantSha256
    || r.parentContextSha256 !== p.contextSha256 || r.contextBytes !== p.contextBytes
    || typeof r.context !== "string" || /\p{Surrogate}/u.test(r.context) || Buffer.byteLength(r.context) !== r.contextBytes || sha256Hex(r.context) !== r.contextSha256
    || !Array.isArray(r.originalRanks) || r.originalRanks.length !== p.turnIds.length || new Set(r.originalRanks).size !== p.turnIds.length
    || r.originalRanks.some(i => !Number.isSafeInteger(i) || Object.is(i, -0) || i < 0 || i >= p.turnIds.length)
    || !Array.isArray(r.turnIds) || !Array.isArray(r.sources) || !Array.isArray(r.sessionIds)) fail("result binding or bounds");
  const sources = r.originalRanks.map(i => p.sources[i]!);
  if (canonicalSha256(r.turnIds) !== canonicalSha256(r.originalRanks.map(i => p.turnIds[i]!)) || canonicalSha256(r.sources) !== canonicalSha256(sources)
    || canonicalSha256(r.sessionIds) !== canonicalSha256([...new Set(sources.map(s => s.sessionId))])
    || sources.some((s, i) => i > 0 && sources[i - 1]!.key >= s.key)
    || r.orderChanged !== r.originalRanks.some((rank, i) => rank !== i)
    || !r.orderChanged && r.context !== p.context) fail("exact source membership or canonical order");
  const { resultSha256, ...payload } = r;
  if (canonicalSha256(payload) !== resultSha256) fail("result digest");
  return r;
}
/** The corpus array already carries parser chronology, including stable equal-date
 * order. Do not reinterpret dates or regroup repeated session IDs. Reuse once per corpus. */
export function createEvolutionSourceOrder(input: Corpus) {
  const corpus = projectEvolutionCompletionCorpus(input), corpusSha256 = canonicalSha256(corpus);
  const validateSource = createEvolutionContextSourceValidator(corpus, { semantic: true });
  const positions = new Map(corpus.turns.map((t, i) => [t.id, i])), rendered = corpus.turns.map(renderTurn);
  function order(input: EvolutionSourceOrderInput): EvolutionSourceOrderResult {
    if (!isPlainRecord(input) || !hasExactKeys(input, ["question", "parent"])) fail("exact inputs required");
    const question = projectEvolutionCompletionQuestion(input.question), p = validateEvolutionSourceOrderParent(input.parent, question).result;
    validateSource(p);
    const originalRanks = p.turnIds.map((_, i) => i).sort((a, b) => positions.get(p.turnIds[a]!)! - positions.get(p.turnIds[b]!)!);
    const turnIds = originalRanks.map(i => p.turnIds[i]!), sources = originalRanks.map(i => p.sources[i]!);
    const context = turnIds.map(id => rendered[positions.get(id)!]!).join("\n\n"), contextBytes = Buffer.byteLength(context);
    if (contextBytes !== p.contextBytes) fail("internal source byte parity");
    const payload = { protocol: "oh.memory.evolution-source-order.v1" as const, policySha256: POLICY_SHA,
      corpusId: corpus.id, corpusSha256, questionSha256: canonicalSha256(question), querySha256: sha256Hex(question.question),
      parentResultSha256: p.resultSha256, parentPreparedSha256: p.preparedSha256, parentVariantSha256: p.variantSha256, parentContextSha256: p.contextSha256,
      context, contextSha256: sha256Hex(context), contextBytes, turnIds, sessionIds: [...new Set(sources.map(s => s.sessionId))], sources,
      originalRanks, orderChanged: originalRanks.some((rank, i) => rank !== i) };
    return freezeEvolutionCompletion(structuredClone({ ...payload, resultSha256: canonicalSha256(payload) }));
  }
  function validate(input: EvolutionSourceOrderInput, value: unknown): EvolutionSourceOrderResult {
    validateEvolutionSourceOrderResultEnvelope(value, input);
    const expected = order(input);
    if (canonicalSha256(value) !== canonicalSha256(expected)) fail("result differs from current source or authenticated parent");
    return expected;
  }
  return Object.freeze({ corpusId: corpus.id, corpusSha256, sourceRecordCount: corpus.turns.length, order, validate });
}
