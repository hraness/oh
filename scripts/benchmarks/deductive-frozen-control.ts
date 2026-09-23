// Re-evaluate a frozen ranking with the shared window policy. No model calls,
// no fitting, no invented vector scores, and no rewriting the original run.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, sha256Hex } from "../../src/canonical";
import { DATASETS, selectSplit, type Corpus, type Dataset } from "./datasets";
import { loadDataset, ROOT, writeNew } from "./io";
import { evidenceMetrics, mean, pairedBootstrap } from "./metrics";
import { pack, type RetrievalBudget } from "./retrieval";
import { orderedWindowPlan } from "./deductive-packing";

export const FROZEN_SOURCE = "benchmarks/results/deductive-recall-locomo-all-sem-v1.json";
export const FROZEN_SOURCE_SHA256 = "9511e49eee28cb339021c08591fbd21831e514675334612ca630cb883cfd1f9c";
export const FROZEN_CONTROL_PROTOCOL = "oh.deductive-frozen-window-control.v1";
export const CONTROL_BUDGET: RetrievalBudget = { topK: 20, contextBytes: 12_000 };
const HISTORICAL_ARMS = ["bm25-block", "deductive", "deductive-semantic", "vector"] as const;

export interface FrozenRow {
  questionId: string; corpusId: string; groupId: string; category: string;
  arm: string; unanswerable: boolean; contextBytes: number; contextSha256: string;
  turnIds: readonly string[]; metrics: ReturnType<typeof evidenceMetrics>;
}

/** A packed ranking is reusable only when all top-K seeds survived packing.
 * The pinned capture records exactly 20 unique turns for every vector row. */
export function frozenWindow(corpus: Corpus, turnIds: readonly string[],
  budget: RetrievalBudget = CONTROL_BUDGET) {
  if (turnIds.length !== budget.topK || new Set(turnIds).size !== turnIds.length) {
    throw new Error("Frozen vector row does not contain a complete unique top-K ranking.");
  }
  const positionOf = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  if (turnIds.some((id) => !positionOf.has(id))) throw new Error("Frozen vector row references an unknown turn.");
  const candidateOf = (id: string) => {
    const position = positionOf.get(id);
    return position === undefined ? undefined : { turn: corpus.turns[position]! };
  };
  // The capture contains ordering, not scores or tail ranks. All twenty ranks
  // seed windows; there is deliberately no inferred tail-fill evidence.
  return pack(orderedWindowPlan({ corpus, positionOf,
    ordered: turnIds.map((turnId) => ({ turnId })), topK: budget.topK,
    candidateOf, canFill: () => false }).candidates, budget.contextBytes);
}

export async function loadFrozenControlSource(): Promise<{
  dataset: Dataset; rows: readonly FrozenRow[];
}> {
  const path = join(ROOT, FROZEN_SOURCE);
  if (statSync(path).size > 64 * 1024 * 1024) throw new Error("Frozen source exceeds 64 MiB.");
  const bytes = readFileSync(path);
  if (sha256Hex(bytes) !== FROZEN_SOURCE_SHA256) throw new Error("Frozen source byte identity changed.");
  // This cast follows the exact immutable source-byte check, not a permissive
  // parser for arbitrary reports. A new source requires a reviewed new pin.
  const source = JSON.parse(bytes.toString()) as {
    datasetSha256: string; rows: FrozenRow[]; resultSha256: string;
    corpora: { corpusId: string; corpusSha256: string }[];
  };
  if (source.datasetSha256 !== DATASETS.locomo.sha256
    || canonicalSha256(source.rows.map(({ turnIds: _, ...row }) => row)) !== source.resultSha256) {
    throw new Error("Frozen source manifest or result digest mismatch.");
  }
  const dataset = await loadDataset("locomo");
  const corpora = new Map(dataset.corpora.map((corpus) => [corpus.id, corpus]));
  for (const identity of source.corpora) {
    if (canonicalSha256(corpora.get(identity.corpusId)) !== identity.corpusSha256) {
      throw new Error(`Frozen corpus identity mismatch: ${identity.corpusId}`);
    }
  }
  return { dataset, rows: replayFrozenRows(dataset, source.rows) };
}

/** Rejoin every comparison row to source identities and recompute its exact
 * context and metrics before admitting the complete question/arm matrix. */
export function replayFrozenRows(dataset: Dataset, sourceRows: readonly FrozenRow[]): readonly FrozenRow[] {
  const corpora = new Map(dataset.corpora.map((corpus) => [corpus.id, corpus]));
  const questions = new Map(dataset.questions.map((question) => [question.id, question]));
  const rows = sourceRows.filter((row) => (HISTORICAL_ARMS as readonly string[]).includes(row.arm));
  const identities = new Set<string>();
  for (const row of rows) {
    const identity = `${row.arm}:${row.questionId}`;
    if (identities.has(identity)) throw new Error("Duplicate frozen question/arm.");
    identities.add(identity);
    const question = questions.get(row.questionId);
    const corpus = corpora.get(row.corpusId);
    if (question === undefined || corpus === undefined || question.corpusId !== corpus.id || row.groupId !== corpus.groupId
      || row.category !== question.category || row.unanswerable !== question.unanswerable) {
      throw new Error(`Frozen row identity mismatch: ${identity}`);
    }
    const turns = new Map(corpus.turns.map((turn) => [turn.id, turn]));
    const replay = pack(row.turnIds.map((id) => {
      const turn = turns.get(id);
      if (turn === undefined) throw new Error(`Unknown frozen turn: ${id}`);
      return { turn };
    }), CONTROL_BUDGET.contextBytes);
    if (canonicalJson(replay.turnIds) !== canonicalJson(row.turnIds)
      || sha256Hex(replay.context) !== row.contextSha256
      || Buffer.byteLength(replay.context) !== row.contextBytes
      || canonicalJson(evidenceMetrics(question, replay.turnIds, replay.sessionIds)) !== canonicalJson(row.metrics)) {
      throw new Error(`Frozen context/metric replay mismatch: ${identity}`);
    }
  }
  if (rows.length !== dataset.questions.length * HISTORICAL_ARMS.length) {
    throw new Error("Frozen source does not cover every question and comparison arm.");
  }
  return rows;
}

/** Idempotent publication admits an existing file only when every byte is
 * identical. A differing or partially written artifact is preserved and the
 * command fails; publishing cannot overwrite historical evidence. */
export async function writeFrozenControl(path: string, content: string): Promise<void> {
  try { await writeNew(path, content); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || readFileSync(path, "utf8") !== content) throw error;
  }
}

export function summarizeControl(rows: readonly FrozenRow[]) {
  const summarize = (selected: readonly FrozenRow[]) => ({
    questions: selected.length,
    annotatedQuestions: selected.filter((row) => row.metrics.turnRecall !== null).length,
    turnRecall: mean(selected.map((row) => row.metrics.turnRecall)),
    allEvidenceRecall: mean(selected.map((row) => row.metrics.allTurns)),
    reciprocalRank: mean(selected.map((row) => row.metrics.reciprocalRank)),
    meanContextBytes: mean(selected.map((row) => row.contextBytes)),
  });
  const arms = [...new Set(rows.map((row) => row.arm))];
  const vector = new Map(rows.filter((row) => row.arm === "vector-window").map((row) => [row.questionId, row]));
  return {
    summaries: Object.fromEntries(arms.map((arm) => [arm, summarize(rows.filter((row) => row.arm === arm))])),
    // Positive differences mean vector-window exceeds the named historical arm.
    vectorWindowMinus: Object.fromEntries(arms.filter((arm) => arm !== "vector-window").map((arm) => [arm,
      pairedBootstrap(rows.filter((row) => row.arm === arm).flatMap((row) => {
        const right = vector.get(row.questionId)?.metrics.turnRecall;
        return row.metrics.turnRecall === null || right === null || right === undefined ? []
          : [{ cluster: row.groupId, left: row.metrics.turnRecall, right }];
      }), 17)])),
  };
}

async function main() {
  if (process.argv.slice(2).some((arg) => arg !== "--help")) throw new Error("Unknown argument; use --help.");
  if (process.argv.includes("--help")) {
    console.log("bun run bench:deductive:control\nReplays the pinned all-ten vector ranking with radius-two windows; no models or paid calls.");
    return;
  }
  const started = performance.now();
  const { dataset, rows } = await loadFrozenControlSource();
  const corpora = new Map(dataset.corpora.map((corpus) => [corpus.id, corpus]));
  const questions = new Map(dataset.questions.map((question) => [question.id, question]));
  const control: FrozenRow[] = rows.filter((row) => row.arm === "vector").map((row) => {
    const got = frozenWindow(corpora.get(row.corpusId)!, row.turnIds);
    return { ...row, arm: "vector-window", turnIds: got.turnIds,
      contextBytes: Buffer.byteLength(got.context), contextSha256: sha256Hex(got.context),
      metrics: evidenceMetrics(questions.get(row.questionId)!, got.turnIds, got.sessionIds) };
  });
  const joined = [...rows, ...control];
  const splits = Object.fromEntries((["dev", "test", "all"] as const).map((split) => {
    const ids = new Set(selectSplit(dataset, split, 17).corpora.map((corpus) => corpus.id));
    return [split, summarizeControl(joined.filter((row) => ids.has(row.corpusId)))];
  }));
  const artifact = { protocol: FROZEN_CONTROL_PROTOCOL, source: { path: FROZEN_SOURCE,
    sha256: FROZEN_SOURCE_SHA256 }, datasetSha256: DATASETS.locomo.sha256,
    budget: CONTROL_BUDGET, selection: { windowRadius: 2, frozenRanks: 20, tailFill: false },
    splits, resultSha256: canonicalSha256(control), rows: control,
    qualifications: [
      "Frozen top-20 ranks are complete: every original vector context replays exactly and contains 20 turns.",
      "The window policy is shared with deductive retrieval; vector tail ranks are unavailable and are not invented.",
      "All ten conversations were exposed in earlier project studies; test means excluded from this lane's tuning, not globally unseen.",
      "Evidence recall is not answer accuracy. Cluster bootstrap intervals have only ten conversations (two in development).",
      "This control changes selection only. It does not run or attest the embedding model, Datalog, or a production API.",
    ] };
  const output = join(ROOT, "benchmarks/results/deductive-frozen-window-control-v1.json");
  const content = canonicalJson(artifact);
  await writeFrozenControl(output, content);
  console.log(JSON.stringify({ output: output.slice(ROOT.length + 1), elapsedMs: performance.now() - started, splits }, null, 2));
}

if (import.meta.main) await main();
