import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { DATASETS, selectQuestions, selectSplit, type Dataset, type DatasetName } from "./datasets";
import { codeIdentity, loadDataset, writeJson } from "./io";
import { evidenceMetrics } from "./metrics";
import { createRetrievers, SYSTEMS, type RetrievalBudget, type System } from "./retrieval";
import { summarizeRetrieval, type RetrievalRow } from "./runner";
import type { LoadedUnits } from "./extract";
import { createLabMemory, type LabMemoryMetadata } from "./lab-memory";
import { createLabSession } from "./lab-session";
import { createLabFusion } from "./lab-fusion";

export const LAB_SYSTEMS = [...SYSTEMS, "oh-memory-api", "bm25-session", "bm25-fusion"] as const;
export type LabSystem = typeof LAB_SYSTEMS[number];
export type LabVariant = Readonly<{ id: string; system: LabSystem; budget: RetrievalBudget }>;
export type LabRow = Omit<RetrievalRow, "system"> & Readonly<{ system: LabSystem; variant: string }>;
const ordinary = (system: LabSystem): system is System => SYSTEMS.includes(system as System);

export function labVariants(systems: readonly LabSystem[], topKs: readonly number[], contextBytes: readonly number[]): LabVariant[] {
  if (!systems.length || new Set(systems).size !== systems.length || systems.some(s => !LAB_SYSTEMS.includes(s))) throw new TypeError("Unknown or duplicate systems.");
  const valid = (values: readonly number[], max: number) => values.length > 0 && new Set(values).size === values.length
    && values.every(n => Number.isSafeInteger(n) && n >= 1 && n <= max);
  if (!valid(topKs, 100) || !valid(contextBytes, 4_000_000)) throw new RangeError("Invalid or duplicate retrieval budgets.");
  const variants = systems.flatMap<LabVariant>(system => system === "full-context" || system === "no-memory"
    ? [{ id: system, system, budget: { topK: 1, contextBytes: 1 } }]
    : (system === "recent" ? [1] : topKs).flatMap(topK => contextBytes.map(bytes => ({ id: `${system}:k${topK}:b${bytes}`, system, budget: { topK, contextBytes: bytes } }))));
  if (variants.length > 128) throw new RangeError("At most 128 variants per sweep.");
  return variants;
}

/** Offline development screening: one corpus index serves every variant; labels enter metrics only. */
export async function runLab(dataset: Dataset, variants: readonly LabVariant[], memory?: LoadedUnits) {
  if (variants.length < 1 || variants.length > 128 || new Set(variants.map(v => v.id)).size !== variants.length) throw new TypeError("Invalid variant set.");
  const start = performance.now();
  const rows: LabRow[] = [];
  const ingestion: { corpusId: string; turns: number; buildMs: number; native?: LabMemoryMetadata }[] = [];
  const questions = new Map(dataset.corpora.map(c => [c.id, dataset.questions.filter(q => q.corpusId === c.id)]));
  let questionIndex = 0;
  for (const corpus of dataset.corpora) {
    const built = performance.now();
    const retrievers = createRetrievers(corpus, memory?.units.get(corpus.id));
    let native: Awaited<ReturnType<typeof createLabMemory>> | undefined;
    let session: ReturnType<typeof createLabSession> | undefined;
    const fusion = variants.some(v => v.system === "bm25-fusion") ? createLabFusion(corpus, retrievers) : undefined;
    try {
      retrievers.prepare([...new Set([...variants.map(v => v.system).filter(ordinary),
        ...(fusion ? ["bm25-block" as const] : [])])]);
      if (variants.some(v => v.system === "oh-memory-api")) native = await createLabMemory(corpus);
      if (variants.some(v => v.system === "bm25-session")) session = createLabSession(corpus);
      ingestion.push({ corpusId: corpus.id, turns: corpus.turns.length, buildMs: performance.now() - built,
        ...(native ? { native: native.native } : {}) });
      for (const question of questions.get(corpus.id)!) {
        const offset = questionIndex++ % variants.length;
        for (const variant of [...variants.slice(offset), ...variants.slice(0, offset)]) {
          const began = performance.now();
          const retrieved = variant.system === "oh-memory-api" ? await native!.retrieve(question.question, variant.budget)
            : variant.system === "bm25-session" ? await session!.retrieve(question.question, variant.budget)
            : variant.system === "bm25-fusion" ? await fusion!.retrieve(question.question, variant.budget)
            : await retrievers.retrieve(variant.system, question.question, variant.budget);
          const retrievalMs = performance.now() - began;
          const derived = retrieved.evidenceKind === "derived-unit";
          rows.push({ variant: variant.id, questionId: question.id, corpusId: corpus.id, groupId: corpus.groupId,
            category: question.category, system: variant.system, unanswerable: question.unanswerable,
            contextBytes: Buffer.byteLength(retrieved.context), contextSha256: sha256Hex(retrieved.context),
            fullContextBytes: retrievers.fullContextBytes, retrievedTurns: retrieved.turnIds, recordDigests: retrieved.recordDigests,
            budgetExempt: retrieved.budgetExempt, omittedForBudget: retrieved.omittedForBudget, retrievalMs,
            ...(derived ? { evidenceKind: "derived-unit" as const,
              supportCitationRecall: evidenceMetrics(question, retrieved.supportTurnIds ?? [], retrieved.sessionIds).turnRecall } : {}),
            metrics: derived ? { turnRecall: null, turnPrecision: null, allTurns: null, reciprocalRank: null, sessionRecall: null }
              : evidenceMetrics(question, retrieved.turnIds, retrieved.sessionIds) });
        }
      }
    } finally {
      try { await native?.close(); } finally { try { session?.close(); } finally { retrievers.close(); } }
    }
  }
  const summaries = Object.fromEntries(variants.map(variant => {
    const selected = rows.filter(row => row.variant === variant.id);
    return [variant.id, { ...summarizeRetrieval(selected), byCategory: Object.fromEntries(
      [...new Set(selected.map(row => row.category))].sort().map(category =>
        [category, summarizeRetrieval(selected.filter(row => row.category === category))])) }];
  }));
  const deterministic = rows.map(({ retrievalMs: _ms, ...row }) => row)
    .sort((a, b) => `${a.questionId}:${a.variant}`.localeCompare(`${b.questionId}:${b.variant}`));
  return { status: "completed" as const, variants, rows, summaries, ingestion,
    timing: { elapsedMs: performance.now() - start, corpusPreparations: ingestion.length,
      independentVariantCorpusPreparations: ingestion.length * variants.length,
      corpusPreparationMs: ingestion.reduce((sum, row) => sum + row.buildMs, 0),
      retrievalMs: rows.reduce((sum, row) => sum + row.retrievalMs, 0) },
    resultSha256: canonicalSha256(deterministic), modelCalls: 0, memoryUnits: memory?.provenance ?? null,
    qualifications: ["Development screening only; evidence recall is not answer accuracy or a superiority claim.",
      "All variants share the same questions and reuse corpus indexes; variant order rotates per question.",
      "Independent variant corpus preparations is a counterfactual count, not a measured speedup or physical index count.",
      "Full context is an unbounded control; other systems use the stated byte budget.",
      "Fact support citation recall is not raw-turn evidence recall.",
      "oh-memory-api materializes the actual native record projection once; host BM25 supplies ranking, not native semantic search.",
      "bm25-session ranks whole sessions; topK counts session hits before raw-turn packing.",
      "bm25-fusion combines up to 100 raw and 100 block-source turns by reciprocal rank, caches source ranks per question, then packs original turns.",
      "Do not tune on final-test results. Paid reader and judge experiments remain separately budgeted."] };
}

const HELP = `Usage: bun run bench:lab [options]
  --dataset locomo|longmemeval-s     Default: locomo
  --limit N                        Default: 24 development questions
  --systems NAME,NAME              Default: bm25-window,oh-window,bm25-block,oh-block,full-context
  Extra lab systems: oh-memory-api (native provenance + host BM25), bm25-session, bm25-fusion
  --top-k N,N                      Default: 10,20,40
  --context-bytes N,N              Default: 4000,12000,24000
  --units PATH                     Optional verified development extraction report
  --output PATH                    Required; new report, never overwrites
  --help

No model calls. Fixed dev split and seed17 protect the existing test split.
Loads the pinned dataset once and builds each corpus index once for all variants.
Use --limit 8 for a quick check,24 for exploration,then the full dev set for promotion.
Full-context/no-memory controls run once,without duplicate budget combinations.
Fact variants require --units. Reports contain evidence metrics and timings,not answer accuracy.
`;

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    dataset: { type: "string" }, limit: { type: "string" }, systems: { type: "string" }, "top-k": { type: "string" },
    "context-bytes": { type: "string" }, units: { type: "string" }, output: { type: "string" }, help: { type: "boolean" } } });
  if (values.help) { console.log(HELP); return; }
  if (positionals.length || !values.output) throw new TypeError("Use --output for a new lab report; see --help.");
  const name = values.dataset ?? "locomo";
  if (name !== "locomo" && name !== "longmemeval-s") throw new TypeError("Lab supports locomo and longmemeval-s development splits.");
  const limit = values.limit === undefined ? 24 : Number(values.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20_000) throw new RangeError("Invalid question limit.");
  const output = resolve(values.output);
  if (await Bun.file(output).exists()) throw new Error("Report exists; choose a new output path.");
  const variants = labVariants((values.systems ?? "bm25-window,oh-window,bm25-block,oh-block,full-context").split(",") as LabSystem[],
    (values["top-k"] ?? "10,20,40").split(",").map(Number), (values["context-bytes"] ?? "4000,12000,24000").split(",").map(Number));
  if (variants.some(v => v.system.includes("fact")) && !values.units) throw new TypeError("Fact variants require --units.");
  const started = performance.now(), code = await codeIdentity();
  const loadStarted = performance.now();
  const dataset = selectQuestions(selectSplit(await loadDataset(name as DatasetName), "dev", 17), limit, 17);
  const datasetLoadMs = performance.now() - loadStarted;
  const memory = values.units ? await (await import("./extract")).loadUnitReport(values.units, name, "dev", 17, dataset.corpora) : undefined;
  const result = await runLab(dataset, variants, memory);
  const after = await codeIdentity();
  if (after.sourceSha256 !== code.sourceSha256) throw new Error("Source changed during sweep; rerun after edits converge.");
  const report = { protocol: "oh.memory-development-lab.v1", createdAt: new Date().toISOString(),
    manifest: { dataset: name, source: DATASETS[name], split: "dev", seed: 17, code,
      selectedCorpora: dataset.corpora.map(c => c.id), selectedQuestions: dataset.questions.map(q => q.id),
      selectedGroups: [...new Set(dataset.corpora.map(c => c.groupId))], selectionSha256: canonicalSha256(dataset.questions.map(q => q.id)) },
    ...result, timing: { ...result.timing, datasetLoadMs, totalMs: performance.now() - started } };
  await writeJson(output, report);
  console.log(JSON.stringify({ output, variants: variants.length, questions: dataset.questions.length,
    modelCalls: 0, timing: report.timing, summaries: Object.fromEntries(Object.entries(result.summaries)
      .map(([id, { byCategory: _categories, ...summary }]) => [id, summary])) }, null, 2));
}

if (import.meta.main) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Lab failed."); process.exitCode = 1; });
