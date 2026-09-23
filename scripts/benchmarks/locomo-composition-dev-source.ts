/** Offline admission for one fixed reader-instruction development comparison. */
import { canonicalJson, canonicalSha256, sha256Hex } from "../../src/canonical";
import { DATASETS, type Corpus } from "./datasets";
import { frozenWindow } from "./deductive-frozen-control";
import { loadWindowDevelopment, WINDOW_DEV_SOURCE_SHA256 } from "./deductive-window-probe";
import { EVOLUTION_LOCOMO_J_CATEGORIES } from "./evolution-locomo-judge";
import { LOCOMO_COMPOSITION_DEV_ARMS, LOCOMO_COMPOSITION_DEV_GROUPS, parseLocomoCompositionDevScorer,
  parseLocomoCompositionDevSource, selectLocomoCompositionDevIds,
  type LocomoCompositionDevQuestion } from "./locomo-composition-dev";
import { renderTurn } from "./retrieval";

export const LOCOMO_COMPOSITION_DEV_POLICY = Object.freeze({ protocol: "oh.locomo-composition-dev-policy.v1",
  groups: LOCOMO_COMPOSITION_DEV_GROUPS, arms: LOCOMO_COMPOSITION_DEV_ARMS,
  selection: "unchanged-frozen-top20-vector-window-radius2-v1", contextBytes: 12000,
  separator: "\n\n", nativeEligibleCounts: { "conv-49": 156, "conv-50": 158 }, samplePerGroup: 80,
  draw: "oh.locomo.order-dev-draw.v1:17:${id}", presentation: "identical-original-vector-window-order",
  questionDate: "original-final-session-timestamp-v1", contracts: ["legacy-v1", "composition-v1"] });

/** Takes no question or labels. Authenticate the selected original renderings
 * once, then copy the same bytes and ordered identifiers to both reader arms. */
export function compositionContexts(corpus: Pick<Corpus, "turns">,
  selected: Readonly<{ context: string; turnIds: readonly string[] }>): LocomoCompositionDevQuestion["contexts"] {
  if (selected.turnIds.length > 512 || new Set(selected.turnIds).size !== selected.turnIds.length
    || Buffer.byteLength(selected.context) > 12000) throw Error("Composition development: selected turn bound");
  const turns = new Map(corpus.turns.map(turn => [turn.id, turn]));
  if (turns.size !== corpus.turns.length || selected.turnIds.some(id => !turns.has(id))) {
    throw Error("Composition development: ambiguous or unknown source turn");
  }
  if (selected.turnIds.map(id => renderTurn(turns.get(id)!)).join("\n\n") !== selected.context) {
    throw Error("Composition development: original text, order or separator changed");
  }
  return Object.freeze(LOCOMO_COMPOSITION_DEV_ARMS.map(armId => Object.freeze({ armId, text: selected.context,
    contextSha256: sha256Hex(selected.context), turnIds: Object.freeze([...selected.turnIds]) })));
}

/** The pinned loader adapts only conversations49/50. Other conversations' question,
 * answer and evidence fields never enter this experiment's source construction. */
export function buildLocomoCompositionDevSources() {
  const { dataset, vectors } = loadWindowDevelopment();
  const eligible = dataset.questions.filter(question => !question.unanswerable
    && (EVOLUTION_LOCOMO_J_CATEGORIES as readonly string[]).includes(question.category));
  const population = eligible.map(question => ({ questionId: question.id, groupId: question.corpusId }));
  const selectedIds = selectLocomoCompositionDevIds(population), questionsById = new Map(eligible.map(q => [q.id, q]));
  const corpora = new Map(dataset.corpora.map(corpus => [corpus.id, corpus]));
  const questions: LocomoCompositionDevQuestion[] = selectedIds.map(id => {
    const question = questionsById.get(id)!, corpus = corpora.get(question.corpusId)!;
    const selected = frozenWindow(corpus, vectors.get(id)!.turnIds);
    const questionDate = corpus.turns.at(-1)?.date;
    if (typeof questionDate !== "string" || questionDate.length === 0) throw Error("Composition development: missing source date");
    return { id: question.id, groupId: corpus.id, question: question.question, questionDate,
      contexts: compositionContexts(corpus, selected) };
  });
  const source = parseLocomoCompositionDevSource({ protocol: "oh.locomo-composition-dev-source.v1", datasetSha256: DATASETS.locomo.sha256,
    captureSha256: WINDOW_DEV_SOURCE_SHA256, selectionPolicySha256: canonicalSha256(LOCOMO_COMPOSITION_DEV_POLICY), population, questions });
  const scorer = parseLocomoCompositionDevScorer({ protocol: "oh.locomo-composition-dev-scorer.v1", datasetSha256: source.datasetSha256,
    sourceSha256: canonicalSha256(source), questions: selectedIds.map(id => {
      const q = questionsById.get(id)!;
      return { id: q.id, corpusId: q.corpusId, category: q.category, question: q.question, answer: q.answer, unanswerable: false };
    }) }, source);
  if (questions.some(q => q.contexts[0]!.text !== q.contexts[1]!.text
    || canonicalJson(q.contexts[0]!.turnIds) !== canonicalJson(q.contexts[1]!.turnIds))) {
    throw Error("Composition development: source equality invariant");
  }
  return { source, scorer, provenance: { protocol: "oh.locomo-composition-dev-source-admission.v1",
    datasetSha256: source.datasetSha256, captureSha256: source.captureSha256,
    policySha256: source.selectionPolicySha256, selectedQuestionIdsSha256: canonicalSha256(selectedIds),
    sourceSha256: canonicalSha256(source), scorerSha256: canonicalSha256(scorer),
    corpusIdentities: dataset.corpora.map(corpus => ({ corpusId: corpus.id, sha256: canonicalSha256(corpus) })),
    developmentQuestions: 400, eligibleQuestions: eligible.length, selectedQuestions: selectedIds.length,
    contextRows: questions.length * 2, identicalContextBytesAndOrderedIds: true,
    providerCalls: 0, scoresComputed: false } };
}
