// Frozen one-candidate confirmation. Four one-corpus processes share one
// scheduler owner; no embedding/provider calls and no confirmation retuning.
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { canonicalJson, canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, selectSplit, type Dataset } from "./datasets";
import { CONTROL_BUDGET, FROZEN_SOURCE, FROZEN_SOURCE_SHA256, frozenWindow,
  loadFrozenControlSource, type FrozenRow } from "./deductive-frozen-control";
import { FUSION_POLICY, frozenFusionRetrieve, mechanicalRank } from "./deductive-fusion-probe";
import { prepareDeductive, RETRIEVAL_PROGRAM_SHA256 } from "./deductive-retrieval";
import { ROOT, writeNew } from "./io";
import { evidenceMetrics, mean, pairedBootstrap, percentile } from "./metrics";
import { pack } from "./retrieval";

export const FUSION_DEV_SOURCE = "benchmarks/results/deductive-fusion-dev-v1.json";
export const FUSION_DEV_SOURCE_SHA256 = "3a6599c82bc4603f48cfb4673db76def89c6d9054ef93b10533db1e655b59edc";
export const FUSION_DEV_RESULT_SHA256 = "bbfc441f47a5cb3e72fbc2e085cce28122aa754274d11f4d187430f9b3450861";
export const FUSION_DEV_POLICY_SHA256 = "6ff28e16ec26ff01996a4b5759650c9431acbc60b1777c7ff94ebd7dca5a4d11";
export const CONFIRM_ALPHA = 0.5;
const CONFIRM_PROTOCOL = "oh.deductive-frozen-rank-fusion-confirm.v1";
const ARMS = ["vector-window", "fusion-0.5"] as const;
const CORPUS_IDS = ["conv-26", "conv-30", "conv-41", "conv-42", "conv-43", "conv-44", "conv-47", "conv-48"];
const MAX_WORKERS = 4;
const SOURCE_FILES = ["src/canonical.ts", "scripts/benchmarks/datasets.ts",
  "scripts/benchmarks/retrieval.ts", "scripts/benchmarks/memory-datalog.ts",
  "scripts/benchmarks/evolution-dates.ts", "scripts/benchmarks/consistency-rules.ts",
  "scripts/benchmarks/metrics.ts", "scripts/benchmarks/io.ts", "package.json", "bun.lock",
  "scripts/benchmarks/deductive-retrieval.ts", "scripts/benchmarks/deductive-packing.ts",
  "scripts/benchmarks/deductive-frozen-control.ts", "scripts/benchmarks/deductive-fusion-probe.ts",
  "scripts/benchmarks/deductive-fusion-confirm.ts"];

interface FrozenDevelopment {
  policy: typeof FUSION_POLICY; policySha256: string; resultSha256: string;
  datasetSha256: string; mechanicalProgramSha256: string;
  source: { path: string; sha256: string };
  winner: { arm: string; structuralWeight: number }; rows: FrozenRow[];
}

/** Pins the selected development result and policy before any confirmation
 * corpus is evaluated. The byte pin is checked separately by the loader. */
export function validateDevelopmentSelection(value: unknown): FrozenDevelopment {
  if (!isPlainRecord(value) || !Array.isArray(value.rows) || !isPlainRecord(value.policy)
    || !isPlainRecord(value.winner) || !isPlainRecord(value.source)) {
    throw new Error("Invalid frozen development artifact.");
  }
  if (value.resultSha256 !== FUSION_DEV_RESULT_SHA256
    || canonicalSha256(value.rows) !== FUSION_DEV_RESULT_SHA256) {
    throw new Error("Frozen development result changed.");
  }
  if (value.policySha256 !== FUSION_DEV_POLICY_SHA256
    || canonicalSha256(value.policy) !== FUSION_DEV_POLICY_SHA256
    || canonicalSha256(FUSION_POLICY) !== FUSION_DEV_POLICY_SHA256) {
    throw new Error("Frozen development policy changed.");
  }
  if (value.winner.arm !== "fusion-0.5" || value.winner.structuralWeight !== CONFIRM_ALPHA
    || value.source.path !== FROZEN_SOURCE || value.source.sha256 !== FROZEN_SOURCE_SHA256
    || value.datasetSha256 !== DATASETS.locomo.sha256
    || value.mechanicalProgramSha256 !== RETRIEVAL_PROGRAM_SHA256) {
    throw new Error("Frozen development winner or source changed.");
  }
  // Exact canonical row/policy digests above pin the immutable reviewed shapes.
  return value as unknown as FrozenDevelopment;
}

function readBounded(path: string): Buffer {
  if (statSync(path).size > 16 * 1024 * 1024) throw new Error("Fusion artifact exceeds 16 MiB.");
  return readFileSync(path);
}

function loadDevelopment(): FrozenDevelopment {
  const bytes = readBounded(join(ROOT, FUSION_DEV_SOURCE));
  if (sha256Hex(bytes) !== FUSION_DEV_SOURCE_SHA256) throw new Error("Frozen development bytes changed.");
  return validateDevelopmentSelection(JSON.parse(bytes.toString()));
}

function sourceIdentity() {
  const files = SOURCE_FILES.map((path) => ({ path, sha256: sha256Hex(readFileSync(join(ROOT, path))) }));
  return { files, sha256: canonicalSha256(files) };
}

function confirmationDataset(dataset: Dataset): Dataset {
  const test = selectSplit(dataset, "test", FUSION_POLICY.seed);
  if (test.corpora.map((corpus) => corpus.id).sort().join(",") !== CORPUS_IDS.join(",")) {
    throw new Error("Frozen confirmation corpus identity changed.");
  }
  return test;
}

interface WorkerResult {
  protocol: string; corpusId: string; mechanismSha256: string; developmentResultSha256: string;
  resultSha256: string; rows: FrozenRow[];
  timing: { elapsedMs: number; prepareMs: number; meanDeriveMs: number | null;
    p95DeriveMs: number | null; meanSelectionMs: number | null };
}

async function runCorpus(corpusId: string, output: string, mechanismSha256: string): Promise<void> {
  const started = performance.now();
  if (!CORPUS_IDS.includes(corpusId)
    || !dirname(output).startsWith(join(ROOT, ".cache/benchmarks/deductive-fusion-confirm-"))
    || basename(output) !== `${corpusId}.json`
    || sourceIdentity().sha256 !== mechanismSha256) throw new Error("Invalid frozen worker invocation.");
  loadDevelopment();
  const source = await loadFrozenControlSource();
  const dataset = confirmationDataset(source.dataset);
  const corpus = dataset.corpora.find((candidate) => candidate.id === corpusId)!;
  const vectors = new Map(source.rows.filter((row) => row.arm === "vector" && row.corpusId === corpusId)
    .map((row) => [row.questionId, row]));
  const prepareStart = performance.now();
  const prepared = prepareDeductive(corpus);
  const prepareMs = performance.now() - prepareStart;
  const rows: FrozenRow[] = [], deriveTimes: number[] = [], selectionTimes: number[] = [];
  try {
    const questions = dataset.questions.filter((question) => question.corpusId === corpusId);
    for (const [index, question] of questions.entries()) {
      const vector = vectors.get(question.id);
      if (vector === undefined) throw new Error("Missing frozen confirmation vector ranking.");
      const deriveStart = performance.now();
      const mechanical = mechanicalRank(corpus, prepared, question.question);
      deriveTimes.push(performance.now() - deriveStart);
      const selectionStart = performance.now();
      // Only the frozen candidate and control, both selected before gold enters.
      const selected = [
        { arm: ARMS[0], got: frozenFusionRetrieve(corpus, prepared, vector.turnIds, mechanical, 0) },
        { arm: ARMS[1], got: frozenFusionRetrieve(corpus, prepared, vector.turnIds, mechanical, CONFIRM_ALPHA) },
      ];
      const control = frozenWindow(corpus, vector.turnIds);
      if (selected[0]!.got.context !== control.context
        || canonicalJson(selected[0]!.got.turnIds) !== canonicalJson(control.turnIds)) {
        throw new Error("Frozen confirmation vector control drift.");
      }
      selectionTimes.push(performance.now() - selectionStart);
      for (const { arm, got } of selected) rows.push({ questionId: question.id, corpusId,
        groupId: corpus.groupId, category: question.category, unanswerable: question.unanswerable,
        arm, turnIds: got.turnIds, contextBytes: Buffer.byteLength(got.context),
        contextSha256: sha256Hex(got.context), metrics: evidenceMetrics(question, got.turnIds, got.sessionIds) });
      if ((index + 1) % 10 === 0 || index + 1 === questions.length) {
        console.error(`[deductive-fusion-confirm] ${corpusId} ${index + 1}/${questions.length}`);
      }
    }
  } finally { prepared.store.close(); prepared.fts.close(); }
  rows.sort((a, b) => `${a.questionId}:${a.arm}`.localeCompare(`${b.questionId}:${b.arm}`));
  if (sourceIdentity().sha256 !== mechanismSha256) throw new Error("Mechanism changed during confirmation.");
  const result: WorkerResult = { protocol: CONFIRM_PROTOCOL, corpusId, mechanismSha256,
    developmentResultSha256: FUSION_DEV_RESULT_SHA256, resultSha256: canonicalSha256(rows), rows,
    timing: { elapsedMs: performance.now() - started, prepareMs,
      meanDeriveMs: mean(deriveTimes), p95DeriveMs: percentile(deriveTimes, 0.95),
      meanSelectionMs: mean(selectionTimes) } };
  await writeNew(output, canonicalJson(result));
}

/** Parent-side context, coverage, and metric replay checks every worker row
 * without rerunning its costly derivation or fitting another candidate. */
function validateRows(rows: readonly FrozenRow[], dataset: Dataset): void {
  const questions = new Map(dataset.questions.map((question) => [question.id, question]));
  const corpora = new Map(dataset.corpora.map((corpus) => [corpus.id, corpus]));
  const seen = new Set<string>();
  for (const row of rows) {
    const question = questions.get(row.questionId), corpus = corpora.get(row.corpusId);
    const identity = `${row.questionId}:${row.arm}`;
    if (question === undefined || corpus === undefined || question.corpusId !== corpus.id
      || row.groupId !== corpus.groupId || row.category !== question.category
      || row.unanswerable !== question.unanswerable || !(ARMS as readonly string[]).includes(row.arm)
      || seen.has(identity)) throw new Error("Invalid confirmation row identity or duplicate.");
    seen.add(identity);
    const turns = new Map(corpus.turns.map((turn) => [turn.id, turn]));
    const replay = pack(row.turnIds.map((id) => {
      const turn = turns.get(id);
      if (turn === undefined) throw new Error("Unknown confirmation turn.");
      return { turn };
    }), CONTROL_BUDGET.contextBytes);
    if (canonicalJson(replay.turnIds) !== canonicalJson(row.turnIds)
      || sha256Hex(replay.context) !== row.contextSha256 || Buffer.byteLength(replay.context) !== row.contextBytes
      || canonicalJson(evidenceMetrics(question, replay.turnIds, replay.sessionIds)) !== canonicalJson(row.metrics)) {
      throw new Error("Confirmation context or metric replay mismatch.");
    }
  }
  if (rows.length !== dataset.questions.length * ARMS.length) throw new Error("Incomplete confirmation coverage.");
}

export function summarizeConfirmation(rows: readonly FrozenRow[]) {
  const summarize = (selected: readonly FrozenRow[]) => ({ questions: selected.length,
    annotatedQuestions: selected.filter((row) => row.metrics.turnRecall !== null).length,
    turnRecall: mean(selected.map((row) => row.metrics.turnRecall)),
    allEvidenceRecall: mean(selected.map((row) => row.metrics.allTurns)),
    reciprocalRank: mean(selected.map((row) => row.metrics.reciprocalRank)),
    meanContextBytes: mean(selected.map((row) => row.contextBytes)) });
  const baseline = new Map(rows.filter((row) => row.arm === ARMS[0]).map((row) => [row.questionId, row]));
  return { arms: Object.fromEntries(ARMS.map((arm) => [arm, summarize(rows.filter((row) => row.arm === arm))])),
    fusionMinusVectorWindow: pairedBootstrap(rows.filter((row) => row.arm === ARMS[1]).flatMap((row) => {
      const left = baseline.get(row.questionId)?.metrics.turnRecall, right = row.metrics.turnRecall;
      return left === undefined || left === null || right === null ? [] : [{ cluster: row.groupId, left, right }];
    }), FUSION_POLICY.seed) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--worker" && args.length === 4) {
    await runCorpus(args[1]!, args[2]!, args[3]!);
    return;
  }
  if (args.length === 1 && args[0] === "--help") {
    console.log("bun run scripts/benchmarks/deductive-fusion-confirm.ts\nFrozen alpha-0.5 confirmation on eight corpora; four local workers under one exclusive scheduler owner.");
    return;
  }
  if (args.length > 0) throw new Error("Unknown arguments; use --help.");
  const started = performance.now(), development = loadDevelopment(), mechanism = sourceIdentity();
  const source = await loadFrozenControlSource();
  const dataset = confirmationDataset(source.dataset);
  const outputDirectory = mkdtempSync(join(ROOT, ".cache/benchmarks/deductive-fusion-confirm-"));
  let nextCorpus = 0;
  const results: WorkerResult[] = [];
  const ownedChildren = new Set<Bun.Subprocess>();
  let failure: unknown;
  let stopped = false;
  let collecting: Promise<void> | undefined;
  const collectOwned = (): Promise<void> => {
    if (collecting !== undefined) return collecting;
    const children = [...ownedChildren];
    const signal = (name: "SIGTERM" | "SIGKILL") => {
      for (const child of children) if (child.exitCode === null && child.signalCode === null) {
        try { child.kill(name); } catch { /* Reaped between the liveness check and signal. */ }
      }
    };
    signal("SIGTERM");
    collecting = (async () => {
      // These are exactly this coordinator's children. Escalate only those
      // still alive after five seconds, then collect every exit before return.
      const force = setTimeout(() => signal("SIGKILL"), 5_000);
      try { await Promise.allSettled(children.map((child) => child.exited)); }
      finally { clearTimeout(force); }
    })();
    return collecting;
  };
  const stop = (error: unknown) => {
    if (!stopped) { stopped = true; failure = error; }
    void collectOwned();
  };
  const interrupted = () => stop(new Error("Confirmation interrupted; owned workers collected."));
  const terminated = () => stop(new Error("Confirmation terminated; owned workers collected."));
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", terminated);
  const runLane = async () => {
    try { while (!stopped) {
      const corpusId = CORPUS_IDS[nextCorpus++];
      if (corpusId === undefined) return;
      const output = join(outputDirectory, `${corpusId}.json`);
      const child = Bun.spawn([process.execPath, "run", import.meta.path,
        "--worker", corpusId, output, mechanism.sha256], {
        cwd: ROOT, stdin: "ignore", stdout: "inherit", stderr: "inherit", timeout: 20 * 60_000,
      });
      ownedChildren.add(child);
      try {
        const exitCode = await child.exited;
        if (exitCode !== 0) throw new Error(`Confirmation worker ${corpusId} exited ${exitCode}.`);
        if (stopped) return;
        const result = JSON.parse(readBounded(output).toString()) as WorkerResult;
        if (result.protocol !== CONFIRM_PROTOCOL || result.corpusId !== corpusId
          || result.mechanismSha256 !== mechanism.sha256
          || result.developmentResultSha256 !== FUSION_DEV_RESULT_SHA256
          || canonicalSha256(result.rows) !== result.resultSha256) throw new Error("Worker result pin mismatch.");
        results.push(result);
        console.error(`[deductive-fusion-confirm] completed ${corpusId}; ${results.length}/${CORPUS_IDS.length} corpora`);
      } finally { ownedChildren.delete(child); }
    } } catch (error) { stop(error); throw error; }
  };
  try {
    const lanes = await Promise.allSettled(Array.from({ length: MAX_WORKERS }, runLane));
    const rejected = lanes.find((lane) => lane.status === "rejected");
    if (stopped) throw failure;
    if (rejected?.status === "rejected") throw rejected.reason;
  } finally {
    stopped = true;
    await collectOwned();
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", terminated);
  }
  if (sourceIdentity().sha256 !== mechanism.sha256) throw new Error("Mechanism changed during confirmation.");
  const rows = results.flatMap((result) => result.rows)
    .sort((a, b) => `${a.questionId}:${a.arm}`.localeCompare(`${b.questionId}:${b.arm}`));
  validateRows(rows, dataset);
  const devRows = development.rows.filter((row) => (ARMS as readonly string[]).includes(row.arm));
  validateRows(devRows, selectSplit(source.dataset, "dev", FUSION_POLICY.seed));
  const splits = { dev: summarizeConfirmation(devRows), test: summarizeConfirmation(rows),
    all: summarizeConfirmation([...devRows, ...rows]) };
  const artifact = { protocol: CONFIRM_PROTOCOL, development: { path: FUSION_DEV_SOURCE,
    sha256: FUSION_DEV_SOURCE_SHA256, resultSha256: FUSION_DEV_RESULT_SHA256,
    policySha256: FUSION_DEV_POLICY_SHA256 }, source: { path: FROZEN_SOURCE, sha256: FROZEN_SOURCE_SHA256 },
    datasetSha256: DATASETS.locomo.sha256, mechanicalProgramSha256: RETRIEVAL_PROGRAM_SHA256,
    mechanism, selection: { structuralWeight: CONFIRM_ALPHA, rrfK: FUSION_POLICY.rrfK,
      topK: 20, frozenVectorRanks: 20, windowRadius: 2, contextBytes: 12_000, tailFill: false },
    corpora: CORPUS_IDS, splits,
    byCorpus: Object.fromEntries(CORPUS_IDS.map((corpusId) =>
      [corpusId, summarizeConfirmation(rows.filter((row) => row.corpusId === corpusId))])),
    resultSha256: canonicalSha256(rows), rows,
    timing: { elapsedMs: performance.now() - started, maximumWorkers: MAX_WORKERS,
      corpora: results.sort((a, b) => a.corpusId.localeCompare(b.corpusId))
        .map((result) => ({ corpusId: result.corpusId, ...result.timing })) },
    qualifications: [
      "Alpha 0.5 and RRF k60 were frozen from the exact development result before this confirmation; no other fusion weights were evaluated here.",
      "Test denotes eight conversations excluded from this fusion policy's development selection; all ten conversations appeared in earlier project studies and are not globally unseen.",
      "Historical source rows are replay-validated for integrity; new policy selection uses only corpus/question/ranks, with gold consulted afterward for metrics.",
      "Both arms use exactly twenty seeds, radius-two windows, 12000 bytes and no tail fill; absent vector tail ranks are never inferred.",
      "Every alpha-zero context matches the independent frozen vector-window control; every published context and metric is replay-validated in the parent.",
      "Evidence recall is not answer accuracy, a public leaderboard result, or proof of truth; derivation proofs establish provenance from supplied facts.",
      "No model, provider, reader or judge calls were made. Timing measures this local four-process run and is not a production latency claim.",
    ] };
  const output = join(ROOT, "benchmarks/results/deductive-fusion-confirm-v1.json");
  await writeNew(output, canonicalJson(artifact));
  console.log(JSON.stringify({ output, resultSha256: artifact.resultSha256, mechanismSha256: mechanism.sha256,
    elapsedMs: artifact.timing.elapsedMs, splits }, null, 2));
}

if (import.meta.main) await main();
