import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { EVIDENCE_REFERENCE_PROTOCOL, type Dataset } from "./datasets";
import type { LoadedUnits } from "./extract";
import { evidenceMetrics, mean, pairedBootstrap, percentile } from "./metrics";
import { benchmarkBaseline, benchmarkOrder, createRetrievers, type RetrievalBudget, type System, type UnitIndexIngestion } from "./retrieval";

export type RetrievalRow = Readonly<{
  questionId: string; corpusId: string; groupId: string; category: string; system: System;
  unanswerable: boolean; contextBytes: number; contextSha256: string; fullContextBytes: number;
  retrievedTurns: readonly string[]; recordDigests: readonly string[]; budgetExempt: boolean;
  omittedForBudget: number; retrievalMs: number; metrics: ReturnType<typeof evidenceMetrics>;
  evidenceKind?: "derived-unit"; supportCitationRecall?: number | null;
}>;

export function summarizeRetrieval(rows: readonly RetrievalRow[]) {
  return {
    questions: rows.length,
    annotatedQuestions: rows.filter((row) => row.metrics.turnRecall !== null).length,
    turnRecall: mean(rows.map((row) => row.metrics.turnRecall)),
    allEvidenceRecall: mean(rows.map((row) => row.metrics.allTurns)),
    turnPrecision: mean(rows.map((row) => row.metrics.turnPrecision)),
    reciprocalRank: mean(rows.map((row) => row.metrics.reciprocalRank)),
    sessionRecall: mean(rows.map((row) => row.metrics.sessionRecall)),
    meanContextBytes: mean(rows.map((row) => row.contextBytes)),
    meanContextFraction: mean(rows.map((row) => row.contextBytes / Math.max(1, row.fullContextBytes))),
    latencyP50Ms: percentile(rows.map((row) => row.retrievalMs), 0.5),
    latencyP95Ms: percentile(rows.map((row) => row.retrievalMs), 0.95),
    emptyContexts: rows.filter((row) => row.contextBytes === 0).length,
    supportCitationRecall: mean(rows.map((row) => row.supportCitationRecall ?? null)),
  };
}

export async function runRetrieval(dataset: Dataset, systems: readonly System[], budget: RetrievalBudget, seed: number, memory?: LoadedUnits) {
  const rows: RetrievalRow[] = [];
  const ingestion: { corpusId: string; turns: number; duplicateSessionIds: number; ohMs: number; bm25Ms: number;
    unitIndexes: { blocks?: UnitIndexIngestion; facts?: UnitIndexIngestion } }[] = [];
  const unresolvedReferences: { questionId: string; reference: string }[] = [];
  let questionIndex = 0;
  for (const corpus of dataset.corpora) {
    const retrievers = createRetrievers(corpus, memory?.units.get(corpus.id));
    const occurrences = new Map<string, Set<number | undefined>>();
    for (const turn of corpus.turns) {
      const indices = occurrences.get(turn.sessionId) ?? new Set<number | undefined>();
      indices.add(turn.sessionIndex);
      occurrences.set(turn.sessionId, indices);
    }
    const questions = dataset.questions.filter((question) => question.corpusId === corpus.id);
    const ids = new Set(corpus.turns.map((turn) => turn.id));
    for (const question of questions) {
      for (const reference of question.evidenceTurnIds) {
        if (!ids.has(reference)) unresolvedReferences.push({ questionId: question.id, reference });
      }
    }
    try {
      const unitIndexes = retrievers.prepare(systems);
      ingestion.push({ corpusId: corpus.id, turns: corpus.turns.length,
        duplicateSessionIds: [...occurrences.values()].filter((indices) => indices.size > 1).length,
        ohMs: retrievers.ohIngestMs, bm25Ms: retrievers.bm25IngestMs, unitIndexes });
      for (const question of questions) {
        const order = benchmarkOrder(systems, questionIndex++);
        for (const system of order) {
          const started = performance.now();
          const retrieved = await retrievers.retrieve(system, question.question, budget);
          const retrievalMs = performance.now() - started;
          rows.push({ questionId: question.id, corpusId: corpus.id, groupId: corpus.groupId, category: question.category,
            system, unanswerable: question.unanswerable, contextBytes: Buffer.byteLength(retrieved.context),
            contextSha256: sha256Hex(retrieved.context), fullContextBytes: retrievers.fullContextBytes,
            retrievedTurns: retrieved.turnIds, recordDigests: retrieved.recordDigests,
            omittedForBudget: retrieved.omittedForBudget, budgetExempt: retrieved.budgetExempt, retrievalMs,
            ...(retrieved.evidenceKind === "derived-unit" ? { evidenceKind: "derived-unit" as const,
              supportCitationRecall: evidenceMetrics(question, retrieved.supportTurnIds ?? [], retrieved.sessionIds).turnRecall } : {}),
            metrics: retrieved.evidenceKind === "derived-unit" ? { turnRecall: null, turnPrecision: null, allTurns: null,
              reciprocalRank: null, sessionRecall: null } : evidenceMetrics(question, retrieved.turnIds, retrieved.sessionIds) });
        }
      }
    } finally { retrievers.close(); }
  }
  const summaries = Object.fromEntries(systems.map((system) => {
    const selected = rows.filter((row) => row.system === system);
    return [system, { ...summarizeRetrieval(selected), byCategory: Object.fromEntries(
      [...new Set(selected.map((row) => row.category))].sort().map((category) => [category,
        summarizeRetrieval(selected.filter((row) => row.category === category))]),
    ) }];
  }));
  const baseline = benchmarkBaseline(systems);
  const baselineRows = new Map(rows.filter((row) => row.system === baseline).map((row) => [row.questionId, row]));
  const comparisons = Object.fromEntries(systems.filter((system) => system !== baseline).map((system) => [system,
    { baseline, metric: "turn-recall", interval95: pairedBootstrap(rows.filter((row) => row.system === system)
      .flatMap((row) => {
        const left = baselineRows.get(row.questionId)?.metrics.turnRecall;
        const right = row.metrics.turnRecall;
        return left === undefined || left === null || right === null ? [] : [{ cluster: row.groupId, left, right }];
      }), seed) },
  ]));
  const normalizations = dataset.questions.flatMap((question) => question.rawEvidenceTurnIds === undefined
    || JSON.stringify(question.rawEvidenceTurnIds) === JSON.stringify(question.evidenceTurnIds) ? [] : [{
      questionId: question.id, raw: question.rawEvidenceTurnIds, normalized: question.evidenceTurnIds,
    }]);
  const deterministicRows = rows.map(({ retrievalMs: _retrievalMs, ...row }) => row)
    .sort((left, right) => `${left.questionId}:${left.system}`.localeCompare(`${right.questionId}:${right.system}`));
  return { status: "completed", rows, summaries, comparisons, ingestion, unresolvedEvidence: unresolvedReferences.length,
    evidenceProtocol: EVIDENCE_REFERENCE_PROTOCOL, queryOrder: "global-question-rotation.v1",
    evidenceNormalization: { questions: normalizations.length, examples: normalizations.slice(0, 64) },
    unresolvedReferences: unresolvedReferences.slice(0, 64),
    resultSha256: canonicalSha256(deterministicRows), memoryUnits: memory?.provenance ?? null,
    qualifications: ["Evidence recall is not answer accuracy or an OSS leaderboard score.",
      memory === undefined ? "No LLM extraction, embeddings, reranking, reader, or judge was used."
        : "Cached question-blind extraction is reported separately; no additional model calls occur during retrieval.",
      "Derived fact text is not raw-turn retrieval. Its support-citation coverage is reported separately and must not be treated as evidence recall.",
      "Oh candidates use the real local SQLite store and keyword API; focused/window variants are experimental benchmark adapters.",
      "Unit index build time covers both Oh and BM25 indexes once per representation; query latency excludes this preparation.",
      "Full context is an unbounded reference; every other system shares the same UTF-8 context-byte budget.",
      "Intervals are paired conversation/family-cluster bootstrap estimates; ten LoCoMo conversations limit statistical power.",
      "Missing evidence references remain misses; unanswerable or unannotated cases have null retrieval metrics."] };
}
