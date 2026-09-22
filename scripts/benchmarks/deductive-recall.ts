// Purpose: head-to-head evidence recall — proof-carrying deductive retrieval
// vs. the repository's existing retrieval systems on real LOCOMO dev corpora.
// Baselines run through the canonical createRetrievers path (the same code the
// published locomo-dev-final artifact used); the deductive arms run through
// prepareDeductive/deductiveRetrieve, which derive candidates by replay-
// verified Datalog over real Oh store records. Same budget, same metrics,
// same paired-bootstrap comparison — the delta is the mechanism.
// Usage: bun run scripts/benchmarks/deductive-recall.ts

import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { canonicalJson, canonicalSha256, sha256Hex } from "../../src/canonical";
import { DATASETS, selectSplit, type Dataset } from "./datasets";
import { fetchDataset, loadDataset, ROOT, writeNew } from "./io";
import { createRetrievers, DEFAULT_SYSTEMS, type RetrievalBudget, type System } from "./retrieval";
import { evidenceMetrics, mean, pairedBootstrap, percentile } from "./metrics";
import { DEDUCTIVE_RETRIEVAL_PROTOCOL, DEDUCTIVE_SYSTEMS, prepareDeductive, deductiveRetrieve,
  parseQuestion, RETRIEVAL_PROGRAM_SHA256, type DeductiveSystem } from "./deductive-retrieval";

const PROTOCOL = "oh.deductive-recall.v1" as const;
const SEED = 17;
const BUDGET: RetrievalBudget = { topK: 20, contextBytes: 12_000 };
const BASELINE_SYSTEMS: readonly System[] = DEFAULT_SYSTEMS;
const ARMS = [...BASELINE_SYSTEMS, ...DEDUCTIVE_SYSTEMS] as const;
type Arm = (typeof ARMS)[number];
// dev is the tuning split (radius, fill policy chosen there); test is the
// held-out confirmation — 8 corpora, 8 bootstrap clusters, never touched
// during design. DEDUCTIVE_RECALL_SPLIT=test selects it.
const SPLIT = (process.env.DEDUCTIVE_RECALL_SPLIT ?? "dev") as "dev" | "test" | "all";
if (SPLIT !== "dev" && SPLIT !== "test" && SPLIT !== "all") {
  throw new TypeError(`deductive-recall: unknown split ${SPLIT}`);
}

interface Row {
  questionId: string; corpusId: string; groupId: string; category: string;
  arm: Arm; unanswerable: boolean; contextBytes: number; contextSha256: string;
  turnIds: readonly string[]; metrics: ReturnType<typeof evidenceMetrics>;
}

async function main(): Promise<void> {
  await fetchDataset("locomo");
  const dataset = selectSplit(await loadDataset("locomo"), SPLIT, SEED) as Dataset;
  const corpora = [...dataset.corpora].sort((a, b) => a.id.localeCompare(b.id));
  const rows: Row[] = [];
  const corpusInfo: { corpusId: string; turns: number; sessions: number;
    shardFacts: number[]; corpusSha256: string }[] = [];

  for (const corpus of corpora) {
    const retrievers = createRetrievers(corpus);
    const prepared = prepareDeductive(corpus);
    try {
      retrievers.prepare([...BASELINE_SYSTEMS]);
      corpusInfo.push({ corpusId: corpus.id, turns: corpus.turns.length,
        sessions: prepared.shards.size,
        shardFacts: [...prepared.shards.values()].map((s) => s.facts.length),
        corpusSha256: canonicalSha256({ id: corpus.id, groupId: corpus.groupId, turns: corpus.turns }) });
      const questions = dataset.questions.filter((q) => q.corpusId === corpus.id);
      for (const question of questions) {
        const contexts = new Map<Arm, { turnIds: readonly string[]; sessionIds: readonly string[];
          contextBytes: number; contextSha256: string }>();
        for (const system of BASELINE_SYSTEMS) {
          const retrieved = await retrievers.retrieve(system, question.question, BUDGET);
          contexts.set(system, { turnIds: retrieved.turnIds, sessionIds: retrieved.sessionIds,
            contextBytes: Buffer.byteLength(retrieved.context),
            contextSha256: sha256Hex(retrieved.context) });
        }
        for (const system of DEDUCTIVE_SYSTEMS) {
          const retrieved = deductiveRetrieve(corpus, prepared, system, question.question, BUDGET);
          contexts.set(system, { turnIds: retrieved.turnIds, sessionIds: retrieved.sessionIds,
            contextBytes: Buffer.byteLength(retrieved.context),
            contextSha256: sha256Hex(retrieved.context) });
        }
        for (const arm of ARMS) {
          const got = contexts.get(arm)!;
          rows.push({ questionId: question.id, corpusId: corpus.id, groupId: corpus.groupId,
            category: question.category, arm, unanswerable: question.unanswerable,
            contextBytes: got.contextBytes, contextSha256: got.contextSha256,
            turnIds: got.turnIds,
            metrics: evidenceMetrics(question, got.turnIds, got.sessionIds) });
        }
      }
    } finally {
      retrievers.close();
      prepared.store.close();
      prepared.fts.close();
    }
  }

  const summarize = (selected: readonly Row[]) => ({
    questions: selected.length,
    annotatedQuestions: selected.filter((row) => row.metrics.turnRecall !== null).length,
    turnRecall: mean(selected.map((row) => row.metrics.turnRecall)),
    allEvidenceRecall: mean(selected.map((row) => row.metrics.allTurns)),
    turnPrecision: mean(selected.map((row) => row.metrics.turnPrecision)),
    reciprocalRank: mean(selected.map((row) => row.metrics.reciprocalRank)),
    sessionRecall: mean(selected.map((row) => row.metrics.sessionRecall)),
    meanContextBytes: mean(selected.map((row) => row.contextBytes)),
    emptyContexts: selected.filter((row) => row.contextBytes === 0).length,
  });
  const summaries = Object.fromEntries(ARMS.map((arm) => {
    const selected = rows.filter((row) => row.arm === arm);
    return [arm, { ...summarize(selected), byCategory: Object.fromEntries(
      [...new Set(selected.map((row) => row.category))].sort().map((category) => [category,
        summarize(selected.filter((row) => row.category === category))])) }];
  }));

  // Paired bootstrap vs BOTH relevant baselines: bm25-window (the turn-level
  // champion the deductive arm is designed to beat) and bm25-block (the
  // strongest existing system overall — the bar for "outperforming").
  const baselines = ["bm25-window", "bm25-block"] as const;
  const comparisons = Object.fromEntries(baselines.map((baseline) => {
    const baselineRows = new Map(rows.filter((row) => row.arm === baseline)
      .map((row) => [row.questionId, row]));
    return [baseline, Object.fromEntries(ARMS.filter((arm) => arm !== baseline).map((arm) => [arm,
      { metric: "turn-recall", interval95: pairedBootstrap(
        rows.filter((row) => row.arm === arm).flatMap((row) => {
          const left = baselineRows.get(row.questionId)?.metrics.turnRecall;
          const right = row.metrics.turnRecall;
          return left === undefined || left === null || right === null ? []
            : [{ cluster: row.groupId, left, right }];
        }), SEED) }]))];
  }));

  // Attribution: evidence turns the deductive arm surfaced that bm25-window
  // missed on the same question, and vice versa.
  const windowRows = new Map(rows.filter((row) => row.arm === "bm25-window")
    .map((row) => [row.questionId, row]));
  const deductiveRows = new Map(rows.filter((row) => row.arm === "deductive").map((row) => [row.questionId, row]));
  let deductiveOnlyHits = 0, windowOnlyHits = 0;
  const dataset_questions = new Map(dataset.questions.map((q) => [q.id, q]));
  for (const [questionId, row] of deductiveRows) {
    const evidence = new Set(dataset_questions.get(questionId)?.evidenceTurnIds ?? []);
    if (evidence.size === 0) continue;
    const window = new Set(windowRows.get(questionId)?.turnIds ?? []);
    deductiveOnlyHits += row.turnIds.filter((id) => evidence.has(id) && !window.has(id)).length;
    windowOnlyHits += [...window].filter((id) => evidence.has(id) && !row.turnIds.includes(id)).length;
  }

  const deterministicRows = rows.map((row) => ({ ...row, contextBytes: row.contextBytes }))
    .sort((a, b) => `${a.questionId}:${a.arm}`.localeCompare(`${b.questionId}:${b.arm}`));
  const artifact = {
    protocol: PROTOCOL,
    retrievalProtocol: DEDUCTIVE_RETRIEVAL_PROTOCOL,
    programSha256: RETRIEVAL_PROGRAM_SHA256,
    dataset: "locomo",
    datasetSha256: DATASETS.locomo.sha256,
    split: SPLIT, seed: SEED, budget: BUDGET,
    corpora: corpusInfo,
    arms: [...ARMS],
    summaries,
    comparisons,
    attribution: { deductiveVsWindow: { deductiveOnlyHits, windowOnlyHits } },
    resultSha256: canonicalSha256(deterministicRows.map(({ turnIds: _turnIds, ...row }) => row)),
    // Per-question rows are the complete audit surface: pooled/subset
    // bootstrap analyses replay from this artifact without re-running
    // retrieval; contextSha256 binds each arm's retrieved bytes.
    rows: deterministicRows,
    qualifications: [
      "Evidence recall is not answer accuracy or an OSS leaderboard score.",
      "No LLM extraction, embeddings, reranking, reader, or judge was used; every arm is deterministic.",
      "Deductive candidates are derived by bounded positive Datalog over mechanical facts (speaker, session, date, tokens, capitalized entities); every derived row is replay-verified and its proof terminates in a real store record digest or the pinned question digest.",
      "Question-side facts (question-term, question-entity, in-scope) are parsed mechanically from the question text; no semantic labels.",
      "Missing evidence references remain misses; unanswerable or unannotated cases have null retrieval metrics.",
      SPLIT === "dev"
        ? "Intervals are paired conversation-cluster bootstrap estimates; two dev conversations limit statistical power."
        : SPLIT === "test"
          ? "Intervals are paired conversation-cluster bootstrap estimates; the test corpora were never used for design or tuning."
          : "Intervals are paired conversation-cluster bootstrap estimates over all ten corpora; the two dev conversations were used for tuning, the other eight were held out.",
    ],
    v: 1,
  };
  const dir = `${ROOT}/benchmarks/results`;
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/deductive-recall-locomo-${SPLIT}-v1.json`;
  await writeNew(path, Buffer.from(canonicalJson(artifact)));
  console.log(JSON.stringify({ output: path.replace(`${ROOT}/`, ""),
    artifactSha256: canonicalSha256(artifact),
    turnRecall: Object.fromEntries(ARMS.map((arm) => [arm, summaries[arm]!.turnRecall])),
    attribution: artifact.attribution.deductiveVsWindow,
    bootstrap: Object.fromEntries(Object.entries(comparisons).map(([baseline, byArm]) =>
      [baseline, Object.fromEntries(Object.entries(byArm as Record<string, { interval95: unknown }>)
        .filter(([arm]) => arm.startsWith("deductive"))
        .map(([arm, c]) => [arm, c.interval95]))])),
  }));
}

if (import.meta.main) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
