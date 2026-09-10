/** Pure two-stage evidence-selection reader protocol (selector policy v2). No dispatch, store opening or gold.
 * Stage 1 selects opaque aliases over the pinned whole-turn context pool; stage 2 re-renders the selected turns
 * from source with renderTurn and answers with the selected-answer contract. Model text never becomes memory. */
import { canonicalSha256, hasExactKeys, isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import type { Corpus, Turn } from "./datasets";
import { boundEvolutionCompletionWire, freezeEvolutionCompletion, projectEvolutionCompletionCorpus, projectEvolutionCompletionQuestion, type EvolutionCompletionQuestion } from "./evolution-completion";
import { createEvolutionContextSourceValidator, type EvolutionRetrievalResult, type EvolutionRetrievalVariant, type EvolutionSourceIdentity } from "./evolution-retrieval";
import { EVOLUTION_READER_CONTRACTS, evolutionAnswerMessages } from "./evolution-reader-contracts";
import { evolutionReaderContract, evolutionReaderProfileId, makeEvolutionRequest, parseEvolutionResponse, validateEvolutionRequest, type EvolutionProfileId, type EvolutionRequest, type EvolutionResponse } from "./evolution-model";
import { renderTurn } from "./retrieval";

export const OH_SELECTOR_POLICY_V2 = freezeEvolutionCompletion({
  protocol: "oh.memory.source-selector-policy.v2" as const, role: "evidence-selection" as const, partition: "development" as const,
  poolProtocol: "oh.memory.evolution-context-plan.v1" as const,
  poolVariants: [{ system: "oh-semantic" as const, topK: 100, contextBytes: 96_000 }, { system: "bm25-window" as const, topK: 100, contextBytes: 96_000 }],
  selectorContract: "evidence-selection-v1" as const,
  selectorProfiles: { primary: "gpt5-mini-evidence-selection-v1-reader" as const, ablation: "gpt5-nano-evidence-selection-v1-reader" as const },
  answerContract: "selected-answer-v1" as const, answerProfile: "gpt5-mini-selected-answer-v1-reader" as const,
  fallbackContract: "calibration-only-v1" as const, fallbackProfile: "gpt5-mini-calibration-only-v1-reader" as const,
  maximumPoolTurns: 400, maximumSelectedTurns: 32, maximumRequestBodyBytes: 262_144, maximumAnswerBytes: 2_048,
  contextByteLimit: 96_000, maximumNewCallsPerSelection: 1,
  sourceUnit: "whole-turn" as const, selectedOrder: "model-priority" as const,
  packing: "atomic-turn-fit-in-model-priority" as const, outputOrder: "input-corpus-order" as const,
  fallback: "empty-invalid-truncated-or-failed-selection-answers-from-the-full-pool-context-under-the-fallback-contract-flagged-and-kept-in-the-denominator" as const,
  fallbackRateGate: 0.1,
});
const POLICY_SHA = canonicalSha256(OH_SELECTOR_POLICY_V2);
export const EVOLUTION_TWO_STAGE_SELECTOR_PROFILES = [OH_SELECTOR_POLICY_V2.selectorProfiles.primary, OH_SELECTOR_POLICY_V2.selectorProfiles.ablation] as const;
export type EvolutionTwoStageSelectorProfile = typeof EVOLUTION_TWO_STAGE_SELECTOR_PROFILES[number];
export type EvolutionTwoStageSource = Readonly<{ alias: string; turnId: string; sessionId: string; sessionIndex: number | null;
  date: string; speaker: string; key: string; recordSha256: string; textSha256: string; renderedBytes: number }>;
export type EvolutionTwoStagePool = Readonly<{ variant: EvolutionRetrievalVariant; result: EvolutionRetrievalResult; expectedResultSha256: string }>;
export type EvolutionTwoStageSelectionPlan = Readonly<{ protocol: "oh.memory.evidence-selection-plan.v2"; role: "evidence-selection";
  policySha256: string; instructionSha256: string; selectorProfile: EvolutionTwoStageSelectorProfile; corpusSha256: string;
  questionSha256: string; poolResultSha256: string; poolPreparedSha256: string; poolVariantSha256: string;
  sources: readonly EvolutionTwoStageSource[]; request: EvolutionRequest; planSha256: string }>;
export type EvolutionTwoStageFallbackReason = "empty-selection" | "invalid-selection" | "selector-truncated" | "selector-failed";
export type EvolutionTwoStageSelectedContext = Readonly<{ protocol: "oh.memory.selected-evidence-context.v2"; policySha256: string;
  selectionPlanSha256: string; selectorRequestSha256: string; selectorResponseSha256: string; selectorRawSha256: string;
  poolResultSha256: string; questionSha256: string; selectedAliases: readonly string[]; packedAliases: readonly string[];
  omittedAliasesForBudget: readonly string[]; contextByteLimit: number; context: string; contextSha256: string; contextBytes: number;
  turnIds: readonly string[]; sessionIds: readonly string[]; sources: readonly EvolutionSourceIdentity[]; resultSha256: string }>;
export type EvolutionTwoStageSelection = Readonly<{ kind: "selected"; context: EvolutionTwoStageSelectedContext }>
  | Readonly<{ kind: "fallback"; reason: EvolutionTwoStageFallbackReason; selectorRequestSha256: string; selectorResponseSha256: string | null }>;
function fail(message: string): never { throw new TypeError(`Two-stage selector: ${message}.`); }
function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || !value.trim().length || Buffer.byteLength(value) > maximum || /\p{Surrogate}/u.test(value)) fail(`invalid ${label}`);
  return value;
}
/** Accept only the bounded ID-list grammar; duplicate keys, escapes, prose and markdown are rejected. */
export function parseEvidenceSelectionIds(answer: unknown, allowedAliases: readonly string[]): readonly string[] {
  const raw = text(answer, OH_SELECTOR_POLICY_V2.maximumAnswerBytes, "selection answer");
  if (!/^\s*\{\s*"ids"\s*:\s*\[\s*(?:"s\d{3}"(?:\s*,\s*"s\d{3}")*)?\s*\]\s*\}\s*$/.test(raw)) fail("selection answer must contain only an ID list");
  const parsed = JSON.parse(raw) as { ids: string[] };
  if (parsed.ids.length > OH_SELECTOR_POLICY_V2.maximumSelectedTurns || new Set(parsed.ids).size !== parsed.ids.length
    || parsed.ids.some(id => !allowedAliases.includes(id))) fail("duplicate, foreign or excessive selected IDs");
  return Object.freeze([...parsed.ids]);
}
export function isEvolutionTwoStageSelectorProfile(value: unknown): value is EvolutionTwoStageSelectorProfile {
  return (EVOLUTION_TWO_STAGE_SELECTOR_PROFILES as readonly unknown[]).includes(value);
}
function renderAliased(turn: Turn, alias: string): string { return renderTurn({ ...turn, id: alias }); }
/** Build once per corpus. The caller authenticates the pinned context plan; this factory verifies source bytes and pool policy. */
export function prepareEvolutionTwoStage(input: Corpus) {
  const corpus = projectEvolutionCompletionCorpus(input), corpusSha256 = canonicalSha256(corpus);
  const positions = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  const validators = new Map<boolean, ReturnType<typeof createEvolutionContextSourceValidator>>();
  function pool(value: EvolutionTwoStagePool, querySha256: string): EvolutionTwoStagePool {
    boundEvolutionCompletionWire(value, 4_000_000);
    if (!isPlainRecord(value) || !hasExactKeys(value, ["variant", "result", "expectedResultSha256"])) fail("exact pool binding");
    const v = value.variant, r = value.result;
    if (parseSha256Hex(value.expectedResultSha256) === null || !isPlainRecord(v) || !hasExactKeys(v, ["id", "system", "budget"]) || typeof v.id !== "string"
      || !isPlainRecord(v.budget) || !hasExactKeys(v.budget, ["topK", "contextBytes"])
      || !OH_SELECTOR_POLICY_V2.poolVariants.some(p => p.system === v.system && p.topK === v.budget.topK && p.contextBytes === v.budget.contextBytes)
      || !isPlainRecord(r) || r.resultSha256 !== value.expectedResultSha256 || r.variantSha256 !== canonicalSha256(v) || r.querySha256 !== querySha256
      || r.contextBytes > OH_SELECTOR_POLICY_V2.contextByteLimit || !Array.isArray(r.turnIds) || r.turnIds.length < 1
      || r.turnIds.length > OH_SELECTOR_POLICY_V2.maximumPoolTurns || r.coverageKind !== null) fail("pinned pool variant, query or result identity");
    const semantic = v.system === "oh-semantic";
    if (!validators.has(semantic)) validators.set(semantic, createEvolutionContextSourceValidator(corpus, { semantic }));
    validators.get(semantic)!(r);
    return value;
  }
  function makeSelectionPlan(questionInput: EvolutionCompletionQuestion, poolInput: EvolutionTwoStagePool, selectorProfile: EvolutionTwoStageSelectorProfile): EvolutionTwoStageSelectionPlan {
    const question = projectEvolutionCompletionQuestion(questionInput), checked = pool(poolInput, sha256Hex(question.question));
    if (!isEvolutionTwoStageSelectorProfile(selectorProfile) || evolutionReaderContract(selectorProfile) !== OH_SELECTOR_POLICY_V2.selectorContract) fail("closed selector profile");
    const result = checked.result;
    const sources: EvolutionTwoStageSource[] = result.turnIds.map((id, rank) => {
      const turn = corpus.turns[positions.get(id)!]!, source = result.sources[rank]!;
      return { alias: `s${rank.toString().padStart(3, "0")}`, turnId: id, sessionId: turn.sessionId, sessionIndex: turn.sessionIndex ?? null,
        date: turn.date, speaker: turn.speaker, key: source.key, recordSha256: source.recordSha256, textSha256: sha256Hex(turn.text), renderedBytes: Buffer.byteLength(renderTurn(turn)) };
    });
    const rendered = sources.map(s => renderAliased(corpus.turns[positions.get(s.turnId)!]!, s.alias)).join("\n\n");
    const request = makeEvolutionRequest(selectorProfile, [{ role: "system", content: EVOLUTION_READER_CONTRACTS[OH_SELECTOR_POLICY_V2.selectorContract].instruction },
      { role: "user", content: JSON.stringify({ question: question.question, questionDate: question.questionDate, sources: rendered }) }]);
    if (Buffer.byteLength(JSON.stringify(request.body)) > OH_SELECTOR_POLICY_V2.maximumRequestBodyBytes) fail("selection request exceeds the fixed byte cap; never truncate the pool");
    const payload = { protocol: "oh.memory.evidence-selection-plan.v2" as const, role: "evidence-selection" as const, policySha256: POLICY_SHA,
      instructionSha256: EVOLUTION_READER_CONTRACTS[OH_SELECTOR_POLICY_V2.selectorContract].instructionSha256, selectorProfile, corpusSha256,
      questionSha256: canonicalSha256(question), poolResultSha256: result.resultSha256, poolPreparedSha256: result.preparedSha256,
      poolVariantSha256: result.variantSha256, sources, request };
    return freezeEvolutionCompletion({ ...payload, planSha256: canonicalSha256(payload) });
  }
  function validateSelectionPlan(question: EvolutionCompletionQuestion, poolInput: EvolutionTwoStagePool, value: unknown): EvolutionTwoStageSelectionPlan {
    boundEvolutionCompletionWire(value, 1_000_000);
    if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "role", "policySha256", "instructionSha256", "selectorProfile", "corpusSha256", "questionSha256",
      "poolResultSha256", "poolPreparedSha256", "poolVariantSha256", "sources", "request", "planSha256"]) || !isEvolutionTwoStageSelectorProfile(value.selectorProfile)) fail("selection plan shape");
    validateEvolutionRequest(value.request as EvolutionRequest);
    const expected = makeSelectionPlan(question, poolInput, value.selectorProfile);
    if (canonicalSha256(value) !== canonicalSha256(expected)) fail("selection plan differs from current source, pool, policy or request");
    return expected;
  }
  /** Raw bytes must come from store.readRaw for the exact occupied request and repeat. An empty, invalid,
   * truncated or failed selection yields an explicit fallback marker; nothing is repaired or retried. */
  function reconstruct(question: EvolutionCompletionQuestion, poolInput: EvolutionTwoStagePool, planValue: unknown, raw: Uint8Array, response: EvolutionResponse): EvolutionTwoStageSelection {
    const plan = validateSelectionPlan(question, poolInput, planValue), parsed = parseEvolutionResponse(raw, plan.request);
    boundEvolutionCompletionWire(response, 2_000_000);
    if (canonicalSha256(parsed) !== canonicalSha256(response)) fail("selection response is not the exact captured response");
    const selectorResponseSha256 = canonicalSha256(parsed);
    if (parsed.status !== "completed" || parsed.answer === null) {
      return Object.freeze({ kind: "fallback" as const, reason: parsed.status === "truncated" ? "selector-truncated" as const : "selector-failed" as const,
        selectorRequestSha256: plan.request.requestSha256, selectorResponseSha256 });
    }
    let selectedAliases: readonly string[];
    try { selectedAliases = parseEvidenceSelectionIds(parsed.answer, plan.sources.map(s => s.alias)); }
    catch (error) { if (!(error instanceof TypeError)) throw error;
      return Object.freeze({ kind: "fallback" as const, reason: "invalid-selection" as const, selectorRequestSha256: plan.request.requestSha256, selectorResponseSha256 }); }
    if (selectedAliases.length === 0) return Object.freeze({ kind: "fallback" as const, reason: "empty-selection" as const, selectorRequestSha256: plan.request.requestSha256, selectorResponseSha256 });
    const byAlias = new Map(plan.sources.map(s => [s.alias, s]));
    const selected: EvolutionTwoStageSource[] = [], omittedAliasesForBudget: string[] = []; let bytes = 0;
    for (const alias of selectedAliases) {
      const source = byAlias.get(alias)!, required = source.renderedBytes + (selected.length ? 2 : 0);
      if (bytes + required > OH_SELECTOR_POLICY_V2.contextByteLimit) { omittedAliasesForBudget.push(alias); continue; }
      selected.push(source); bytes += required;
    }
    selected.sort((a, b) => positions.get(a.turnId)! - positions.get(b.turnId)!);
    const context = selected.map(s => renderTurn(corpus.turns[positions.get(s.turnId)!]!)).join("\n\n");
    const sources = selected.map(s => ({ turnId: s.turnId, sessionId: s.sessionId, key: s.key, recordSha256: s.recordSha256 }));
    const payload = { protocol: "oh.memory.selected-evidence-context.v2" as const, policySha256: POLICY_SHA, selectionPlanSha256: plan.planSha256,
      selectorRequestSha256: plan.request.requestSha256, selectorResponseSha256, selectorRawSha256: parsed.rawSha256,
      poolResultSha256: plan.poolResultSha256, questionSha256: plan.questionSha256, selectedAliases, packedAliases: selected.map(s => s.alias), omittedAliasesForBudget,
      contextByteLimit: OH_SELECTOR_POLICY_V2.contextByteLimit, context, contextSha256: sha256Hex(context), contextBytes: Buffer.byteLength(context),
      turnIds: sources.map(s => s.turnId), sessionIds: [...new Set(sources.map(s => s.sessionId))], sources };
    return Object.freeze({ kind: "selected" as const, context: freezeEvolutionCompletion({ ...payload, resultSha256: canonicalSha256(payload) }) });
  }
  return Object.freeze({ corpusId: corpus.id, corpusSha256, makeSelectionPlan, validateSelectionPlan, reconstruct });
}
/** Stage-2 request: the selected context under the selected-answer contract, or the full pool context under the fallback contract. */
export function makeEvolutionTwoStageAnswerRequest(question: EvolutionCompletionQuestion, pool: EvolutionRetrievalResult, selection: EvolutionTwoStageSelection): EvolutionRequest {
  const q = projectEvolutionCompletionQuestion(question);
  if (selection.kind === "selected") {
    if (selection.context.poolResultSha256 !== pool.resultSha256) fail("selected context does not belong to this pool");
    return makeEvolutionRequest(OH_SELECTOR_POLICY_V2.answerProfile, evolutionAnswerMessages(q, selection.context.context, OH_SELECTOR_POLICY_V2.answerContract));
  }
  return makeEvolutionRequest(OH_SELECTOR_POLICY_V2.fallbackProfile, evolutionAnswerMessages(q, pool.context, OH_SELECTOR_POLICY_V2.fallbackContract));
}
/** Closed profile identities are derived, never typed by hand. */
export function evolutionTwoStageProfiles() {
  const primary = evolutionReaderProfileId("gpt5-mini-reader", "evidence-selection-v1"), ablation = evolutionReaderProfileId("gpt5-nano-reader", "evidence-selection-v1");
  const answer = evolutionReaderProfileId("gpt5-mini-reader", "selected-answer-v1"), fallback = evolutionReaderProfileId("gpt5-mini-reader", "calibration-only-v1");
  if (primary !== OH_SELECTOR_POLICY_V2.selectorProfiles.primary || ablation !== OH_SELECTOR_POLICY_V2.selectorProfiles.ablation
    || answer !== OH_SELECTOR_POLICY_V2.answerProfile || fallback !== OH_SELECTOR_POLICY_V2.fallbackProfile) fail("policy profile identities drifted");
  return Object.freeze({ primary, ablation, answer, fallback } as const satisfies Record<string, EvolutionProfileId>);
}
