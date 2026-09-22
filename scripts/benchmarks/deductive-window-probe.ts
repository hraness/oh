// Fixed development-only window allocation matrix. It consumes a dev-only
// vector capture; no model calls, inferred tail ranks, or shortened turns.
// Only development samples enter the dataset adapter, selection, and scoring.
// Labels enter only after every context is built.
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, parseLocomo, type Corpus, type Dataset } from "./datasets";
import { frozenWindow } from "./deductive-frozen-control";
import { orderedWindowPlan } from "./deductive-packing";
import { parseQuestion } from "./deductive-retrieval";
import { datasetPath, ROOT, writeNew } from "./io";
import { evidenceMetrics, mean, pairedBootstrap, percentile } from "./metrics";
import { pack, queryTerms, renderTurn, type Retrieved } from "./retrieval";

export const WINDOW_DEV_SOURCE = "benchmarks/results/deductive-recall-locomo-dev-sem-v1.json";
export const WINDOW_DEV_SOURCE_SHA256 = "9421a32a877a509d21c0a4ddff1921347b3eb78e4fb8954d9b14de8a19d777cf";
export const WINDOW_ARMS = Object.freeze(["vector-window", "anchors-ring-2", "anchors-ring-4",
  "anchors-query-4", "anchors-query-density-4", "session-round-robin-2", "joint-query-4"] as const);
export type WindowArm = (typeof WINDOW_ARMS)[number];
export const WINDOW_POLICY = Object.freeze({
  protocol: "oh.deductive-window-dev.v1", corpora: Object.freeze(["conv-49", "conv-50"]),
  seed: 17, vectorRanks: 20, contextBytes: 12_000, arms: WINDOW_ARMS,
  support: "max(61/(60+one-based-seed-rank)/(1+turn-distance))",
  queryCoverage: "sum(matched-idf)/sum(question-idf); idf=log(1+turn-count/max(1,document-frequency))",
  namedSpeakerBonus: 0.1, densityExponent: 0.5, neighborRadius: 4,
  scoreTie: "turn-id", ringOrder: "distance,seed-rank,previous-before-next",
  winner: "highest-development-turn-recall,then-fixed-complexity-order",
  complexityOrder: Object.freeze(["vector-window", "anchors-ring-2", "anchors-ring-4",
    "session-round-robin-2", "anchors-query-4", "anchors-query-density-4", "joint-query-4"]),
});

export function prepareWindowIndex(corpus: Corpus) {
  const positionOf = new Map(corpus.turns.map((turn, index) => [turn.id, index]));
  const tokens = new Map(corpus.turns.map((turn) => [turn.id,
    new Set(turn.text.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]));
  const documentFrequency = new Map<string, number>();
  for (const words of tokens.values()) for (const word of words) {
    documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
  }
  const bytes = new Map(corpus.turns.map((turn) => [turn.id, Buffer.byteLength(renderTurn(turn))]));
  return { positionOf, tokens, documentFrequency, bytes };
}

/** Pure label-free selection: the interface accepts no question metadata,
 * evidence annotations, model scores, or text other than the original corpus. */
export function selectWindowPolicies(corpus: Corpus, index: ReturnType<typeof prepareWindowIndex>,
  question: string, vector: readonly string[]): ReadonlyMap<WindowArm, Retrieved> {
  if (vector.length !== 20 || new Set(vector).size !== 20
    || vector.some((id) => !index.positionOf.has(id))) throw new Error("Expected complete unique top-20 vector ranks.");
  const seedIds = new Set(vector);
  const candidateOf = (turnId: string) => {
    const position = index.positionOf.get(turnId);
    return position === undefined ? undefined : { turn: corpus.turns[position]! };
  };
  const sameSession = (left: number, right: number) => {
    const a = corpus.turns[left], b = corpus.turns[right];
    return a !== undefined && b !== undefined && a.sessionId === b.sessionId && a.sessionIndex === b.sessionIndex;
  };
  const ring = (radius: number): string[] => {
    const out: string[] = [];
    for (let distance = 1; distance <= radius; distance++) for (const id of vector) {
      const position = index.positionOf.get(id)!;
      for (const neighbor of [position - distance, position + distance]) {
        if (sameSession(position, neighbor)) out.push(corpus.turns[neighbor]!.id);
      }
    }
    return out;
  };
  const support = new Map<string, number>();
  for (const [rank, id] of vector.entries()) {
    const position = index.positionOf.get(id)!;
    for (let offset = -4; offset <= 4; offset++) {
      const neighbor = position + offset;
      if (!sameSession(position, neighbor)) continue;
      const turnId = corpus.turns[neighbor]!.id;
      const score = 61 / (61 + rank) / (1 + Math.abs(offset));
      support.set(turnId, Math.max(support.get(turnId) ?? 0, score));
    }
  }
  const terms = queryTerms(question, true);
  const idf = new Map(terms.map((term) => [term,
    Math.log(1 + corpus.turns.length / Math.max(1, index.documentFrequency.get(term) ?? 0))]));
  const totalIdf = [...idf.values()].reduce((sum, value) => sum + value, 0) || 1;
  const entities = new Set(parseQuestion(question).entities);
  const scores = new Map([...support].map(([turnId, base]) => {
    const turn = corpus.turns[index.positionOf.get(turnId)!]!;
    const coverage = terms.reduce((sum, term) => sum + (index.tokens.get(turnId)!.has(term) ? idf.get(term)! : 0), 0) / totalIdf;
    return [turnId, base + coverage + (entities.has(turn.speaker.toLowerCase()) ? 0.1 : 0)];
  }));
  const scored = (density: boolean) => [...support.keys()].sort((a, b) => {
    const score = (id: string) => scores.get(id)! / (density ? Math.sqrt(index.bytes.get(id)!) : 1);
    return score(b) - score(a) || a.localeCompare(b);
  });
  const bySession = new Map<string, string[]>();
  for (const id of vector) {
    const turn = corpus.turns[index.positionOf.get(id)!]!;
    const key = JSON.stringify([turn.sessionId, turn.sessionIndex ?? null]);
    const queue = bySession.get(key) ?? [];
    queue.push(id); bySession.set(key, queue);
  }
  const roundRobin: string[] = [];
  const queues = [...bySession.values()];
  for (let depth = 0; queues.some((queue) => depth < queue.length); depth++) {
    for (const queue of queues) if (depth < queue.length) roundRobin.push(queue[depth]!);
  }
  const windows = (seeds: readonly string[]) => orderedWindowPlan({ corpus, positionOf: index.positionOf,
    ordered: seeds.map((turnId) => ({ turnId })), topK: 20, candidateOf, canFill: () => false,
    options: { windowRadius: 2 } }).candidates;
  const packIds = (ids: readonly string[]) => pack(ids.map((id) => candidateOf(id)!), WINDOW_POLICY.contextBytes);
  const result = new Map<WindowArm, Retrieved>([
    ["vector-window", pack(windows(vector), WINDOW_POLICY.contextBytes)],
    ["anchors-ring-2", packIds([...vector, ...ring(2)])],
    ["anchors-ring-4", packIds([...vector, ...ring(4)])],
    ["anchors-query-4", packIds([...vector, ...scored(false).filter((id) => !seedIds.has(id))])],
    ["anchors-query-density-4", packIds([...vector, ...scored(true).filter((id) => !seedIds.has(id))])],
    ["session-round-robin-2", pack(windows(roundRobin), WINDOW_POLICY.contextBytes)],
    ["joint-query-4", packIds(scored(false))],
  ]);
  if (result.get("vector-window")!.context !== frozenWindow(corpus, vector).context) {
    throw new Error("Matched vector-window control changed.");
  }
  return result;
}

interface CapturedVector {
  questionId: string; corpusId: string; turnIds: readonly string[];
  contextBytes: number; contextSha256: string;
}

function readPinned(path: string, expectedSha256: string, maxBytes: number): Buffer {
  if (statSync(path).size > maxBytes) throw new Error("Pinned window source exceeds byte limit.");
  const bytes = readFileSync(path);
  if (sha256Hex(bytes) !== expectedSha256) throw new Error("Pinned window source bytes changed.");
  return bytes;
}

/** Decode the pinned full JSON, then pass only development samples to the
 * dataset adapter, selection, and scoring. The experiment does not access
 * confirmation question, answer, or evidence fields. */
export function loadWindowDevelopment(): { dataset: Dataset; vectors: ReadonlyMap<string, CapturedVector> } {
  const raw: unknown = JSON.parse(readPinned(datasetPath("locomo"), DATASETS.locomo.sha256, DATASETS.locomo.bytes).toString());
  if (!Array.isArray(raw)) throw new Error("Expected pinned LOCOMO samples.");
  const dev = raw.filter((sample) => isPlainRecord(sample)
    && (WINDOW_POLICY.corpora as readonly unknown[]).includes(sample.sample_id));
  const dataset = parseLocomo(dev);
  if (dataset.corpora.map((corpus) => corpus.id).sort().join(",") !== "conv-49,conv-50") {
    throw new Error("Development corpus identity changed.");
  }
  const capture = JSON.parse(readPinned(join(ROOT, WINDOW_DEV_SOURCE), WINDOW_DEV_SOURCE_SHA256, 16 * 1024 * 1024).toString()) as {
    split: string; seed: number; datasetSha256: string;
    corpora: { corpusId: string; corpusSha256: string }[];
    rows: (CapturedVector & { arm: string })[];
  };
  if (capture.split !== "dev" || capture.seed !== 17 || capture.datasetSha256 !== DATASETS.locomo.sha256) {
    throw new Error("Wrong development capture manifest.");
  }
  for (const corpus of dataset.corpora) {
    if (capture.corpora.find((row) => row.corpusId === corpus.id)?.corpusSha256 !== canonicalSha256(corpus)) {
      throw new Error("Development corpus and vector capture disagree.");
    }
  }
  const questions = new Map(dataset.questions.map((question) => [question.id, question.corpusId]));
  const vectors = new Map<string, CapturedVector>();
  for (const row of capture.rows.filter((row) => row.arm === "vector")) {
    if (questions.get(row.questionId) !== row.corpusId || vectors.has(row.questionId)) throw new Error("Invalid captured vector identity.");
    const corpus = dataset.corpora.find((candidate) => candidate.id === row.corpusId)!;
    const turns = new Map(corpus.turns.map((turn) => [turn.id, turn]));
    if (row.turnIds.length !== 20 || new Set(row.turnIds).size !== 20) throw new Error("Incomplete captured top-20 ranking.");
    const replay = pack(row.turnIds.map((id) => {
      const turn = turns.get(id);
      if (turn === undefined) throw new Error("Unknown captured vector turn.");
      return { turn };
    }), WINDOW_POLICY.contextBytes);
    if (sha256Hex(replay.context) !== row.contextSha256 || Buffer.byteLength(replay.context) !== row.contextBytes
      || canonicalJson(replay.turnIds) !== canonicalJson(row.turnIds)) throw new Error("Captured vector context replay failed.");
    // Discard all historical score and metric fields before experiment selection.
    vectors.set(row.questionId, { questionId: row.questionId, corpusId: row.corpusId,
      turnIds: row.turnIds, contextBytes: row.contextBytes, contextSha256: row.contextSha256 });
  }
  if (vectors.size !== dataset.questions.length) throw new Error("Incomplete development vector coverage.");
  return { dataset, vectors };
}

interface Row {
  questionId: string; corpusId: string; groupId: string; category: string; arm: WindowArm;
  turnIds: readonly string[]; contextBytes: number; contextSha256: string;
  metrics: ReturnType<typeof evidenceMetrics>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("bun run scripts/benchmarks/deductive-window-probe.ts\nSix frozen development-only whole-turn packing policies at 12KB; no model or provider calls.\nReads only conv-49/conv-50 and a dev-only vector capture. Writes .cache/benchmarks/deductive-window-dev-*/result.json.");
    return;
  }
  if (args.length !== 0) throw new Error("Unknown arguments; use --help.");
  const started = performance.now(), { dataset, vectors } = loadWindowDevelopment();
  const rows: Row[] = [], selectionMs: number[] = [];
  for (const corpus of [...dataset.corpora].sort((a, b) => a.id.localeCompare(b.id))) {
    const index = prepareWindowIndex(corpus);
    const questions = dataset.questions.filter((question) => question.corpusId === corpus.id);
    for (const question of questions) {
      const start = performance.now();
      const selected = selectWindowPolicies(corpus, index, question.question, vectors.get(question.id)!.turnIds);
      selectionMs.push(performance.now() - start);
      // The first access to gold/category is after all seven contexts exist.
      for (const arm of WINDOW_ARMS) {
        const got = selected.get(arm)!;
        rows.push({ questionId: question.id, corpusId: corpus.id, groupId: corpus.groupId,
          category: question.category, arm, turnIds: got.turnIds, contextBytes: Buffer.byteLength(got.context),
          contextSha256: sha256Hex(got.context), metrics: evidenceMetrics(question, got.turnIds, got.sessionIds) });
      }
    }
    console.error(`[deductive-window-dev] ${corpus.id}: ${questions.length} questions complete`);
  }
  const baseline = new Map(rows.filter((row) => row.arm === "vector-window").map((row) => [row.questionId, row]));
  const summarize = (selected: readonly Row[]) => ({ questions: selected.length,
    annotatedQuestions: selected.filter((row) => row.metrics.turnRecall !== null).length,
    turnRecall: mean(selected.map((row) => row.metrics.turnRecall)),
    allEvidenceRecall: mean(selected.map((row) => row.metrics.allTurns)),
    reciprocalRank: mean(selected.map((row) => row.metrics.reciprocalRank)),
    meanContextBytes: mean(selected.map((row) => row.contextBytes)) });
  const summaries = Object.fromEntries(WINDOW_ARMS.map((arm) => {
    const selected = rows.filter((row) => row.arm === arm);
    return [arm, { ...summarize(selected),
      byCorpus: Object.fromEntries(dataset.corpora.map((corpus) =>
        [corpus.id, summarize(selected.filter((row) => row.corpusId === corpus.id))])),
      versusControl: pairedBootstrap(selected.flatMap((row) => {
        const left = baseline.get(row.questionId)!.metrics.turnRecall, right = row.metrics.turnRecall;
        return left === null || right === null ? [] : [{ cluster: row.groupId, left, right }];
      }), 17) }];
  }));
  const winner = [...WINDOW_ARMS].sort((a, b) => (summaries[b]!.turnRecall ?? -Infinity)
    - (summaries[a]!.turnRecall ?? -Infinity)
    || WINDOW_POLICY.complexityOrder.indexOf(a) - WINDOW_POLICY.complexityOrder.indexOf(b))[0]!;
  rows.sort((a, b) => `${a.questionId}:${a.arm}`.localeCompare(`${b.questionId}:${b.arm}`));
  const artifact = { policy: WINDOW_POLICY, policySha256: canonicalSha256(WINDOW_POLICY),
    source: { path: WINDOW_DEV_SOURCE, sha256: WINDOW_DEV_SOURCE_SHA256 },
    datasetSha256: DATASETS.locomo.sha256, scriptSha256: sha256Hex(readFileSync(import.meta.path)),
    summaries, winner, resultSha256: canonicalSha256(rows), rows,
    timing: { elapsedMs: performance.now() - started, meanSelectionMs: mean(selectionMs),
      p95SelectionMs: percentile(selectionMs, 0.95) },
    qualifications: [
      "Only conv-49 and conv-50 enter parsing/selection/scoring; the source ranking capture contains development corpora only.",
      "Six policies were declared before scoring. The reported winner is development-selected and unconfirmed; two clusters limit inference.",
      "All contexts contain whole unmodified original turns under the same 12000-byte budget. No absent vector tail rank is inferred.",
      "Candidate expansion never crosses a session occurrence; all vector controls match the shared frozen-window implementation.",
      "No model, provider, Datalog, reader or judge was invoked. This isolates context allocation; evidence recall is not answer accuracy.",
    ] };
  const directory = mkdtempSync(join(ROOT, ".cache/benchmarks/deductive-window-dev-"));
  const output = join(directory, "result.json");
  await writeNew(output, canonicalJson(artifact));
  console.log(JSON.stringify({ output, resultSha256: artifact.resultSha256, policySha256: artifact.policySha256,
    summaries, winner, timing: artifact.timing }, null, 2));
}

if (import.meta.main) await main();
