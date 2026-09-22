/** Offline source admission for the fixed development-only presentation test. */
import { canonicalJson, canonicalSha256, sha256Hex } from "../../src/canonical";
import { DATASETS, type Corpus } from "./datasets";
import { loadWindowDevelopment, prepareWindowIndex, selectWindowPolicies,
  WINDOW_DEV_SOURCE_SHA256, WINDOW_POLICY } from "./deductive-window-probe";
import { EVOLUTION_LOCOMO_J_CATEGORIES } from "./evolution-locomo-judge";
import { LOCOMO_ORDER_DEV_ARMS, LOCOMO_ORDER_DEV_GROUPS, parseLocomoOrderDevScorer,
  parseLocomoOrderDevSource, selectLocomoOrderDevIds, type LocomoOrderDevQuestion } from "./locomo-order-dev";
import { renderTurn } from "./retrieval";

export const LOCOMO_ORDER_DEV_POLICY = Object.freeze({ protocol: "oh.locomo-order-dev-policy.v1",
  groups: LOCOMO_ORDER_DEV_GROUPS, arms: LOCOMO_ORDER_DEV_ARMS, selection: WINDOW_POLICY,
  presentation: "sort-selected-turns-by-original-corpus-position-without-repacking",
  contextBytes: 12000, separator: "\n\n", nativeEligibleCounts: { "conv-49": 156, "conv-50": 158 },
  samplePerGroup: 80, draw: "oh.locomo.order-dev-draw.v1:17:${id}",
  questionDate: "original-final-session-timestamp-v1" });

/** Takes no question, gold, category or evidence labels. Only selected source
 * turns move; their complete renderings and total byte volume are invariant. */
export function restoreSelectedSourceOrder(corpus: Pick<Corpus, "turns">,
  selected: Readonly<{ context: string; turnIds: readonly string[] }>) {
  if (selected.turnIds.length > 512 || new Set(selected.turnIds).size !== selected.turnIds.length
    || Buffer.byteLength(selected.context) > 12000) throw Error("Order development: selected turn bound");
  const positions = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  if (positions.size !== corpus.turns.length || selected.turnIds.some(id => !positions.has(id))) {
    throw Error("Order development: ambiguous or unknown source turn");
  }
  const render = (ids: readonly string[]) => ids.map(id => renderTurn(corpus.turns[positions.get(id)!]!)).join("\n\n");
  if (render(selected.turnIds) !== selected.context) throw Error("Order development: original text or separator changed");
  const turnIds = [...selected.turnIds].sort((a, b) => positions.get(a)! - positions.get(b)!);
  const context = render(turnIds);
  if (Buffer.byteLength(context) !== Buffer.byteLength(selected.context)
    || canonicalJson([...turnIds].sort()) !== canonicalJson([...selected.turnIds].sort())) {
    throw Error("Order development: permutation invariant");
  }
  return Object.freeze({ context, turnIds: Object.freeze(turnIds) });
}

/** The underlying loader admits only pinned development records and captured
 * rankings; confirmation question, answer and evidence fields are not adapted. */
export function buildLocomoOrderDevSources() {
  const { dataset, vectors } = loadWindowDevelopment();
  const eligible = dataset.questions.filter(question => !question.unanswerable
    && (EVOLUTION_LOCOMO_J_CATEGORIES as readonly string[]).includes(question.category));
  const population = eligible.map(question => ({ questionId: question.id, groupId: question.corpusId }));
  const selectedIds = selectLocomoOrderDevIds(population), questionsById = new Map(eligible.map(q => [q.id, q]));
  const corpora = new Map(dataset.corpora.map(corpus => [corpus.id, corpus]));
  const indexes = new Map(dataset.corpora.map(corpus => [corpus.id, prepareWindowIndex(corpus)]));
  const questions: LocomoOrderDevQuestion[] = selectedIds.map(id => {
    const question = questionsById.get(id)!, corpus = corpora.get(question.corpusId)!;
    const selected = selectWindowPolicies(corpus, indexes.get(corpus.id)!, question.question, vectors.get(id)!.turnIds);
    const contextPairs = ["vector-window", "anchors-query-4"].flatMap(policy => {
      const original = selected.get(policy as "vector-window" | "anchors-query-4")!;
      return [original, restoreSelectedSourceOrder(corpus, original)];
    });
    const questionDate = corpus.turns.at(-1)?.date;
    if (typeof questionDate !== "string" || questionDate.length === 0) throw Error("Order development: missing source date");
    return { id: question.id, groupId: corpus.id, question: question.question, questionDate,
      contexts: contextPairs.map((context, index) => ({ armId: LOCOMO_ORDER_DEV_ARMS[index]!, text: context.context,
        contextSha256: sha256Hex(context.context), turnIds: [...context.turnIds] })) };
  });
  const source = parseLocomoOrderDevSource({ protocol: "oh.locomo-order-dev-source.v1", datasetSha256: DATASETS.locomo.sha256,
    captureSha256: WINDOW_DEV_SOURCE_SHA256, selectionPolicySha256: canonicalSha256(LOCOMO_ORDER_DEV_POLICY), population, questions });
  const scorer = parseLocomoOrderDevScorer({ protocol: "oh.locomo-order-dev-scorer.v1", datasetSha256: source.datasetSha256,
    sourceSha256: canonicalSha256(source), questions: selectedIds.map(id => {
      const q = questionsById.get(id)!;
      return { id: q.id, corpusId: q.corpusId, category: q.category, question: q.question, answer: q.answer, unanswerable: false };
    }) }, source);
  return { source, scorer, provenance: { protocol: "oh.locomo-order-dev-source-admission.v1",
    datasetSha256: source.datasetSha256, captureSha256: source.captureSha256,
    policySha256: source.selectionPolicySha256, selectedQuestionIdsSha256: canonicalSha256(selectedIds),
    sourceSha256: canonicalSha256(source), scorerSha256: canonicalSha256(scorer),
    corpusIdentities: dataset.corpora.map(corpus => ({ corpusId: corpus.id, sha256: canonicalSha256(corpus) })),
    developmentQuestions: 400, eligibleQuestions: eligible.length, selectedQuestions: selectedIds.length,
    contextRows: questions.length * 4, membershipAndBytesInvariant: true,
    unchangedOrderPairs: [0, 2].map(index => ({ armId: LOCOMO_ORDER_DEV_ARMS[index], questions: questions.filter(q =>
      q.contexts[index]!.contextSha256 === q.contexts[index + 1]!.contextSha256).length })),
    providerCalls: 0, scoresComputed: false } };
}
