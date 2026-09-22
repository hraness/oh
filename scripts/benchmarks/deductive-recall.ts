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
import { DATASETS, selectSplit, type Corpus, type Dataset } from "./datasets";
import { fetchDataset, loadDataset, ROOT, writeNew } from "./io";
import { createRetrievers, DEFAULT_SYSTEMS, type RetrievalBudget, type System } from "./retrieval";
import { evidenceMetrics, mean, pairedBootstrap, percentile } from "./metrics";
import { DEDUCTIVE_RETRIEVAL_PROTOCOL, DEDUCTIVE_SYSTEMS, prepareDeductive, deductiveRetrieve,
  parseQuestion, questionScope, questionDigestOf, turnCandidate, RETRIEVAL_PROGRAM_SHA256,
  RETRIEVAL_SEM_PROGRAM_SHA256, type DeductiveSystem } from "./deductive-retrieval";
import { createSemanticProducer, SEMANTIC_MODEL_SHA256, SEMANTIC_PRODUCER_ID,
  type SemanticProducer } from "./deductive-semantic";
import { pack } from "./retrieval";

// The semantic arms run only when the pinned qmd producer is provisioned
// (DEDUCTIVE_RECALL_SEM=0 disables them for environments without the engine).
// Enabling them changes the fact surface — a distinct protocol literal and a
// `-sem` artifact suffix keep the published mechanical artifact untouched.
const SEM_ENABLED = process.env.DEDUCTIVE_RECALL_SEM !== "0";
const PROTOCOL = SEM_ENABLED
  ? "oh.deductive-recall-semantic.v1" as const
  : "oh.deductive-recall.v1" as const;
const SEED = 17;
const BUDGET: RetrievalBudget = { topK: 20, contextBytes: 12_000 };
const BASELINE_SYSTEMS: readonly System[] = DEFAULT_SYSTEMS;
const VECTOR_ARM = "vector" as const;
const ARMS = [...BASELINE_SYSTEMS, ...DEDUCTIVE_SYSTEMS.filter((arm) =>
  arm !== "deductive-semantic" || SEM_ENABLED),
  ...(SEM_ENABLED ? [VECTOR_ARM] : [])] as const;
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

  let producer: SemanticProducer | null = null;
  if (SEM_ENABLED) producer = await createSemanticProducer({});
  // One function invocation per corpus: per-invocation locals make a stale
  // prepared/retrievers binding impossible by construction — the earlier
  // inlined loop let a prior iteration's closed store surface inside the next
  // corpus under Bun's async desugaring (observed twice; not reproducible on
  // demand). The corpusId invariant turns any recurrence into a labeled
  // invariant failure rather than a bare "store is closed".
  for (const corpus of corpora) {
    await runCorpus(corpus, dataset, producer, rows, corpusInfo);
  }
  if (producer !== null) await producer.close();

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

  // Paired bootstrap vs the relevant baselines: bm25-window (the turn-level
  // champion the deductive arm is designed to beat), bm25-block (the
  // strongest existing system overall — the bar for "outperforming"), and
  // vector (embeddings alone — the bar for the semantic composition adding
  // anything over raw proximity).
  const baselines = SEM_ENABLED
    ? ["bm25-window", "bm25-block", "vector"] as const
    : ["bm25-window", "bm25-block"] as const;
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
    ...(SEM_ENABLED ? { semProgramSha256: RETRIEVAL_SEM_PROGRAM_SHA256,
      semanticProducer: { id: SEMANTIC_PRODUCER_ID,
        modelSha256: SEMANTIC_MODEL_SHA256 } } : {}),
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
      "No LLM extraction, reranking, reader, or judge was used; every arm is deterministic.",
      SEM_ENABLED
        ? "Deductive candidates are derived by bounded positive Datalog; the deductive/deductive-union arms use mechanical facts only (speaker, session, date, tokens, capitalized entities), while deductive-semantic and vector additionally consume declared sem-near edges emitted by the pinned local embedding producer (engine and model sha256 are bound into each fact's provenance digest)."
        : "Deductive candidates are derived by bounded positive Datalog over mechanical facts (speaker, session, date, tokens, capitalized entities); every derived row is replay-verified and its proof terminates in a real store record digest or the pinned question digest.",
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
  const path = `${dir}/deductive-recall-locomo-${SPLIT}${SEM_ENABLED ? "-sem" : ""}-v1.json`;
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

async function runCorpus(corpus: Corpus, dataset: Dataset,
  producer: SemanticProducer | null, rows: Row[],
  corpusInfo: { corpusId: string; turns: number; sessions: number;
    shardFacts: number[]; corpusSha256: string }[]): Promise<void> {
  const retrievers = createRetrievers(corpus);
  const prepared = prepareDeductive(corpus);
  try {
    retrievers.prepare([...BASELINE_SYSTEMS]);
    if (producer !== null) await producer.prepare(corpus);
    corpusInfo.push({ corpusId: corpus.id, turns: corpus.turns.length,
      sessions: prepared.shards.size,
      shardFacts: [...prepared.shards.values()].map((s) => s.facts.length),
      corpusSha256: canonicalSha256({ id: corpus.id, groupId: corpus.groupId, turns: corpus.turns }) });
    const questions = dataset.questions.filter((q) => q.corpusId === corpus.id);
    console.error(`[deductive-recall] corpus ${corpus.id}: ${questions.length} questions`);
    for (const question of questions) {
      if (prepared.corpusId !== corpus.id) {
        throw new Error(`stale prepared ${prepared.corpusId} inside corpus ${corpus.id}`);
      }
      const contexts = new Map<Arm, { turnIds: readonly string[]; sessionIds: readonly string[];
        contextBytes: number; contextSha256: string }>();
      for (const system of BASELINE_SYSTEMS) {
        const retrieved = await retrievers.retrieve(system, question.question, BUDGET);
        contexts.set(system, { turnIds: retrieved.turnIds, sessionIds: retrieved.sessionIds,
          contextBytes: Buffer.byteLength(retrieved.context),
          contextSha256: sha256Hex(retrieved.context) });
      }
      let sem: Awaited<ReturnType<SemanticProducer["searchAndFacts"]>> | null = null;
      if (producer !== null) {
        const parsed = parseQuestion(question.question);
        const inScope = questionScope(prepared, parsed);
        sem = await producer.searchAndFacts(question.question,
          questionDigestOf(parsed, inScope), BUDGET.topK);
        const retrieved = pack(sem.ranked.flatMap((hit) => {
          const candidate = turnCandidate(prepared, hit.turnId);
          return candidate === undefined ? [] : [candidate];
        }), BUDGET.contextBytes);
        contexts.set(VECTOR_ARM, { turnIds: retrieved.turnIds,
          sessionIds: retrieved.sessionIds,
          contextBytes: Buffer.byteLength(retrieved.context),
          contextSha256: sha256Hex(retrieved.context) });
      }
      for (const system of DEDUCTIVE_SYSTEMS) {
        if (system === "deductive-semantic" && producer === null) continue;
        const retrieved = deductiveRetrieve(corpus, prepared, system, question.question, BUDGET,
          system === "deductive-semantic" ? { semFacts: sem!.facts } : {});
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

if (import.meta.main) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
