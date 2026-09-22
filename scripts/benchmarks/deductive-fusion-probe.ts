// Development-only rank fusion over the pinned, complete top-20 vector capture.
// Selection sees corpus/question/ranks only; gold enters afterward in scoring.
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../../src/canonical";
import { DATASETS, selectSplit, type Corpus } from "./datasets";
import { CONTROL_BUDGET, FROZEN_SOURCE, FROZEN_SOURCE_SHA256,
  frozenWindow, loadFrozenControlSource, type FrozenRow } from "./deductive-frozen-control";
import { orderedWindowPlan } from "./deductive-packing";
import { deriveCandidates, parseQuestion, prepareDeductive, RETRIEVAL_PROGRAM_SHA256,
  scoreDerived, turnCandidate } from "./deductive-retrieval";
import { parseEvolutionInstant } from "./evolution-dates";
import { ROOT, writeNew } from "./io";
import { evidenceMetrics, mean, pairedBootstrap, percentile } from "./metrics";
import { pack } from "./retrieval";

export const FUSION_POLICY = Object.freeze({
  protocol: "oh.deductive-frozen-rank-fusion-dev.v1",
  split: "dev", seed: 17, rrfK: 60,
  structuralWeights: Object.freeze([0, 0.25, 0.5, 0.75]),
  vectorRanks: 20, topK: 20, windowRadius: 2, contextBytes: 12_000, tailFill: false,
  missingRankContribution: 0,
  tieBreak: "vector-rank,mechanical-rank,turn-id",
  winner: "highest-development-turn-recall,then-lowest-structural-weight",
});

/** Alpha weights the mechanical rank; missing ranks contribute zero. The
 * vector list is exactly the captured top 20, never an extrapolated tail. */
export function fuseRanks(vector: readonly string[], mechanical: readonly string[],
  alpha: number): readonly Readonly<{ turnId: string; score: number }>[] {
  if (!FUSION_POLICY.structuralWeights.includes(alpha)) throw new Error("Undeclared fusion weight.");
  if (vector.length !== FUSION_POLICY.vectorRanks || new Set(vector).size !== vector.length
    || new Set(mechanical).size !== mechanical.length) throw new Error("Invalid complete fusion ranks.");
  const vr = new Map(vector.map((id, rank) => [id, rank + 1]));
  const mr = new Map(mechanical.map((id, rank) => [id, rank + 1]));
  return [...new Set([...vector, ...mechanical])].map((turnId) => {
    const v = vr.get(turnId), m = mr.get(turnId);
    return { turnId, score: (v === undefined ? 0 : (1 - alpha) / (FUSION_POLICY.rrfK + v))
      + (m === undefined ? 0 : alpha / (FUSION_POLICY.rrfK + m)) };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score
    || (vr.get(a.turnId) ?? Infinity) - (vr.get(b.turnId) ?? Infinity)
    || (mr.get(a.turnId) ?? Infinity) - (mr.get(b.turnId) ?? Infinity)
    || a.turnId.localeCompare(b.turnId));
}

const armOf = (alpha: number) => alpha === 0 ? "vector-window" : `fusion-${alpha}`;

/** Label-free mechanical ordering shared unchanged by development and the
 * independently frozen confirmation. One invocation derives and replay-
 * verifies once; every subsequent fusion weight consumes this same ranking. */
export function mechanicalRank(corpus: Corpus, prepared: ReturnType<typeof prepareDeductive>,
  question: string): readonly string[] {
  const parsed = parseQuestion(question);
  const derived = deriveCandidates(prepared, parsed);
  const chronology = (turnId: string) => {
    if (parsed.chronology === null) return 0;
    const turn = corpus.turns[prepared.positionOf.get(turnId)!]!;
    const instant = parseEvolutionInstant(turn.date);
    const time = instant === null ? 0 : Date.parse(instant);
    return parsed.chronology === "asc" ? time : -time;
  };
  return derived.map((row) => ({ turnId: row.turnId,
    score: scoreDerived(row, parsed, prepared.documentFrequency, corpus.turns.length) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || chronology(a.turnId) - chronology(b.turnId)
      || a.turnId.localeCompare(b.turnId)).map((row) => row.turnId);
}

export function frozenFusionRetrieve(corpus: Corpus, prepared: ReturnType<typeof prepareDeductive>,
  vector: readonly string[], mechanical: readonly string[], alpha: number) {
  const ordered = fuseRanks(vector, mechanical, alpha);
  const plan = orderedWindowPlan({ corpus, positionOf: prepared.positionOf,
    ordered, topK: CONTROL_BUDGET.topK,
    candidateOf: (id) => turnCandidate(prepared, id), canFill: () => false,
    options: { windowRadius: FUSION_POLICY.windowRadius } });
  return pack(plan.candidates, CONTROL_BUDGET.contextBytes);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--help")) throw new Error("Unknown argument; use --help.");
  if (args.includes("--help")) {
    console.log("bun run scripts/benchmarks/deductive-fusion-probe.ts\nDevelopment only: pinned top-20 vector ranks plus mechanical RRF; no models, network, or paid calls.");
    return;
  }
  const started = performance.now();
  const source = await loadFrozenControlSource();
  const dataset = selectSplit(source.dataset, "dev", FUSION_POLICY.seed);
  if (dataset.corpora.map((corpus) => corpus.id).sort().join(",") !== "conv-49,conv-50") {
    throw new Error("Frozen development corpus identity changed.");
  }
  const capturedVectors = new Map(source.rows.filter((row) => row.arm === "vector")
    .map((row) => [row.questionId, row]));
  const rows: FrozenRow[] = [];
  const timings: { questionId: string; deriveMs: number; selectionMs: number }[] = [];
  const corpusTimings: { corpusId: string; prepareMs: number }[] = [];
  for (const corpus of [...dataset.corpora].sort((a, b) => a.id.localeCompare(b.id))) {
    const prepareStart = performance.now();
    const prepared = prepareDeductive(corpus);
    corpusTimings.push({ corpusId: corpus.id, prepareMs: performance.now() - prepareStart });
    try {
      const questions = dataset.questions.filter((question) => question.corpusId === corpus.id);
      for (const [questionIndex, question] of questions.entries()) {
        const vector = capturedVectors.get(question.id);
        if (vector === undefined || vector.corpusId !== corpus.id) throw new Error("Missing frozen vector row.");
        const deriveStart = performance.now();
        const mechanical = mechanicalRank(corpus, prepared, question.question);
        const deriveMs = performance.now() - deriveStart;
        const selectionStart = performance.now();
        // Build every policy's output before consulting this question's gold.
        const selected = FUSION_POLICY.structuralWeights.map((alpha) => ({ arm: armOf(alpha),
          got: frozenFusionRetrieve(corpus, prepared, vector.turnIds, mechanical, alpha) }));
        // Alpha zero must reproduce the independently checked window control.
        const control = frozenWindow(corpus, vector.turnIds);
        if (selected[0]!.got.context !== control.context) throw new Error("Vector control drift.");
        const selectionMs = performance.now() - selectionStart;
        for (const { arm, got } of selected) rows.push({ questionId: question.id, corpusId: corpus.id,
          groupId: corpus.groupId, category: question.category, unanswerable: question.unanswerable,
          arm, turnIds: got.turnIds, contextBytes: Buffer.byteLength(got.context),
          contextSha256: sha256Hex(got.context), metrics: evidenceMetrics(question, got.turnIds, got.sessionIds) });
        timings.push({ questionId: question.id, deriveMs, selectionMs });
        if ((questionIndex + 1) % 10 === 0 || questionIndex + 1 === questions.length) {
          console.error(`[deductive-fusion-dev] ${corpus.id} ${questionIndex + 1}/${questions.length}`);
        }
      }
    } finally { prepared.store.close(); prepared.fts.close(); }
  }
  const baseline = new Map(rows.filter((row) => row.arm === "vector-window").map((row) => [row.questionId, row]));
  const summarize = (selected: readonly FrozenRow[]) => ({ questions: selected.length,
    annotatedQuestions: selected.filter((row) => row.metrics.turnRecall !== null).length,
    turnRecall: mean(selected.map((row) => row.metrics.turnRecall)),
    allEvidenceRecall: mean(selected.map((row) => row.metrics.allTurns)),
    reciprocalRank: mean(selected.map((row) => row.metrics.reciprocalRank)),
    meanContextBytes: mean(selected.map((row) => row.contextBytes)) });
  const summaries = Object.fromEntries(FUSION_POLICY.structuralWeights.map((alpha) => {
    const selected = rows.filter((row) => row.arm === armOf(alpha));
    return [armOf(alpha), { alpha, ...summarize(selected),
      byCorpus: Object.fromEntries(dataset.corpora.map((corpus) =>
        [corpus.id, summarize(selected.filter((row) => row.corpusId === corpus.id))])),
      versusVectorWindow: pairedBootstrap(selected.flatMap((row) => {
        const left = baseline.get(row.questionId)!.metrics.turnRecall, right = row.metrics.turnRecall;
        return left === null || right === null ? [] : [{ cluster: row.groupId, left, right }];
      }), FUSION_POLICY.seed) }];
  }));
  const winner = [...FUSION_POLICY.structuralWeights].sort((a, b) =>
    (summaries[armOf(b)]!.turnRecall ?? -Infinity) - (summaries[armOf(a)]!.turnRecall ?? -Infinity) || a - b)[0]!;
  rows.sort((a, b) => `${a.questionId}:${a.arm}`.localeCompare(`${b.questionId}:${b.arm}`));
  const timing = { elapsedMs: performance.now() - started, corpora: corpusTimings,
    meanDeriveMs: mean(timings.map((row) => row.deriveMs)),
    p95DeriveMs: percentile(timings.map((row) => row.deriveMs), 0.95),
    meanSelectionMs: mean(timings.map((row) => row.selectionMs)), questions: timings };
  const artifact = { policy: FUSION_POLICY, policySha256: canonicalSha256(FUSION_POLICY),
    source: { path: FROZEN_SOURCE, sha256: FROZEN_SOURCE_SHA256 }, datasetSha256: DATASETS.locomo.sha256,
    mechanicalProgramSha256: RETRIEVAL_PROGRAM_SHA256, corpora: dataset.corpora.map((corpus) => corpus.id).sort(),
    summaries, winner: { arm: armOf(winner), structuralWeight: winner }, rows,
    resultSha256: canonicalSha256(rows), timing,
    qualifications: [
      "Development-only policy selection on conv-49/conv-50; no test-corpus outcomes evaluated by this probe.",
      "Every vector ranking is the pinned complete top 20; missing tail ranks contribute zero.",
      "Mechanical derivations use only question/corpus facts and replay verification; labels enter only after selection.",
      "Every arm uses top 20 seeds, radius-two windows, 12000 context bytes, and no tail fill.",
      "No model, provider, reader, or judge calls; evidence recall is not answer accuracy.",
      "Only two development conversation clusters; the selected policy requires frozen independent confirmation.",
    ] };
  const output = join(ROOT, ".cache/benchmarks/deductive-fusion-dev-v1.json");
  await writeNew(output, canonicalJson(artifact));
  console.log(JSON.stringify({ output, resultSha256: artifact.resultSha256,
    policySha256: artifact.policySha256, summaries, winner: artifact.winner,
    elapsedMs: timing.elapsedMs, meanDeriveMs: timing.meanDeriveMs }, null, 2));
}

if (import.meta.main) await main();
