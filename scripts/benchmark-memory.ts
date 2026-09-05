import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { canonicalSha256, isPlainRecord, sha256Hex } from "../src/canonical";
import { exportSummary, summarizeReport } from "./benchmarks/artifacts";
import { DATASETS, selectQuestions, selectSplit, type DatasetName, type Split } from "./benchmarks/datasets";
import { codeIdentity, displayPath, fetchDataset, loadDataset, ROOT, writeJson, writeNew } from "./benchmarks/io";
import { SYSTEMS, type System } from "./benchmarks/retrieval";
import { runRetrieval } from "./benchmarks/runner";

const HELP = `Usage: bun run bench:memory <fetch|retrieval|state|projection|answer|summarize> [options]

  --dataset locomo|longmemeval-s|longmemeval-oracle   Default: locomo
  --split dev|test|all                            Default: dev; split by conversation/family
  --seed N                                       Default: 17
  --limit N                                      Deterministic category-balanced pilot
  --systems NAME,NAME                            Default: all offline baselines
  --top-k N                                      Default: 20; maximum: 100
  --context-bytes N                              Default: 12000 (UTF-8, not tokens)
  --output PATH                                  New JSON report; never overwrites
  --summary-output PATH                          Optional new compact report
  --input PATH                                   Existing report for summarize
  --steps N                                      State mutations per seed; default: 32
  --sizes N,N                                    Projection chain sizes; default: 16,32,48
  --repeat N                                     Projection timed repetitions; default: 5
  --paid --max-usd N --max-calls N                 Required for answer; USD cap at most 10
  --reader MODEL                                 Pinned GPT-4.1 or GPT-4.1-mini snapshot
  --help

Datasets are checksum-pinned, fetched explicitly, and cached under .cache/benchmarks.
Every Oh store is in-memory. No production database, hosted cache, or sync is accessed.
LoCoMo is CC BY-NC 4.0; review that license for your use. Datasets are not bundled.
LongMemEval oracle contains only evidence sessions; it is not the S leaderboard split.
Model runs require OPENAI_API_KEY and explicit paid limits. No key is logged.
Use bun --env-file=.env.benchmark run bench:memory answer ... for a dedicated ignored key file.
Offline scores are evidence recall, not LLM answer accuracy. See benchmarks/research.json.
`;

function integer(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new RangeError(`Expected integer ${minimum} through ${maximum}.`);
  return result;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    dataset: { type: "string" }, split: { type: "string" }, seed: { type: "string" }, limit: { type: "string" },
    systems: { type: "string" }, "top-k": { type: "string" }, "context-bytes": { type: "string" },
    output: { type: "string" }, "summary-output": { type: "string" }, input: { type: "string" }, steps: { type: "string" },
    sizes: { type: "string" }, repeat: { type: "string" }, paid: { type: "boolean" },
    "max-usd": { type: "string" }, "max-calls": { type: "string" }, reader: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help || positionals.length === 0) { console.log(HELP); return; }
  if (positionals.length !== 1 || !["fetch", "retrieval", "state", "projection", "answer", "summarize"].includes(positionals[0]!)) {
    throw new TypeError("Unknown benchmark command. Use --help.");
  }
  const command = positionals[0]!;
  if (command === "summarize") {
    if (!values.input || !values.output) throw new TypeError("summarize requires --input and --output.");
    const fullReportSha256 = await exportSummary(values.input, values.output);
    console.log(JSON.stringify({ output: displayPath(values.output), fullReportSha256 }));
    return;
  }
  const datasetName = values.dataset ?? "locomo";
  if (!Object.hasOwn(DATASETS, datasetName)) throw new TypeError("Unknown dataset.");
  const name = datasetName as DatasetName;
  if (command === "fetch") {
    const path = await fetchDataset(name);
    console.log(JSON.stringify({ dataset: name, path: displayPath(path), source: DATASETS[name] }, null, 2));
    return;
  }
  const split = values.split ?? "dev";
  if (!["dev", "test", "all"].includes(split)) throw new TypeError("Unknown split.");
  const seed = integer(values.seed, 17, 0, 4_294_967_295);
  const output = resolve(values.output ?? `${ROOT}/.cache/benchmarks/runs/${command}-${name}-${split}-${Date.now()}.json`);
  if (await Bun.file(output).exists()) throw new Error("Report already exists; choose a new output path.");
  if (values["summary-output"] !== undefined && (resolve(values["summary-output"]) === output
    || await Bun.file(values["summary-output"]).exists())) throw new Error("Summary must use a distinct, new output path.");
  const reader = values.reader ?? (name === "locomo" ? "gpt-4.1-mini-2025-04-14" : "gpt-4.1-2025-04-14");
  const paidOptions = { paid: values.paid === true, maxUsd: Number(values["max-usd"]), maxCalls: Number(values["max-calls"]), reader };
  if (command === "answer") {
    const { validatePaidAccess } = await import("./benchmarks/model");
    validatePaidAccess(paidOptions);
  }
  const code = await codeIdentity();
  let manifest: object;
  let result: Record<string, unknown>;
  if (command === "state") {
    const { runState } = await import("./benchmarks/state");
    const steps = integer(values.steps, 32, 1, 256);
    manifest = { command, seed, steps, code };
    result = await runState(seed, steps);
  } else if (command === "projection") {
    const { runProjection } = await import("./benchmarks/state");
    const sizes = (values.sizes ?? "16,32,48").split(",").map((value) => integer(value, 16, 2, 64));
    if (sizes.length > 8) throw new RangeError("At most eight projection sizes.");
    const repeat = integer(values.repeat, 5, 1, 20);
    manifest = { command, sizes, repeat, code };
    result = await runProjection(sizes, repeat);
  } else {
    const systems = values.systems === undefined ? (command === "answer"
      ? ["no-memory", "full-context", "bm25-window", "oh-window"] : [...SYSTEMS]) : values.systems.split(",");
    if (systems.length === 0 || new Set(systems).size !== systems.length || systems.some((system) => !SYSTEMS.includes(system as System))) {
      throw new TypeError("Unknown or duplicate benchmark systems.");
    }
    const budget = { topK: integer(values["top-k"], 20, 1, 100), contextBytes: integer(values["context-bytes"], 12_000, 1, 4_000_000) };
    const limit = values.limit === undefined ? undefined : integer(values.limit, 1, 1, 20_000);
    const selected = selectQuestions(selectSplit(await loadDataset(name), split as Split, seed), limit, seed);
    manifest = { command, dataset: name, source: DATASETS[name], split, seed, limit: limit ?? null, systems, budget, code,
      selectedCorpora: selected.corpora.map((corpus) => corpus.id), selectedQuestions: selected.questions.map((question) => question.id),
      selectionSha256: canonicalSha256(selected.questions.map((question) => question.id).sort()) };
    if (command === "answer") {
      const { runAnswer } = await import("./benchmarks/model");
      result = await runAnswer({ dataset: selected, datasetName: name, systems: systems as System[], budget, seed, output, ...paidOptions });
    } else result = await runRetrieval(selected, systems as System[], budget, seed);
  }
  const report = { protocol: "oh.memory-benchmark.v1", createdAt: new Date().toISOString(), manifest, ...result };
  const raw = `${JSON.stringify(report, null, 2)}\n`;
  await writeNew(output, raw);
  if (values["summary-output"] !== undefined) await writeJson(values["summary-output"], summarizeReport(report, sha256Hex(raw)));
  const summaries = isPlainRecord(result.summaries)
    ? Object.fromEntries(Object.entries(result.summaries).map(([system, value]) => {
      if (!isPlainRecord(value)) return [system, value];
      const { byCategory: _byCategory, ...metrics } = value;
      return [system, metrics];
    })) : result.summaries;
  console.log(JSON.stringify({ output: displayPath(output), protocol: report.protocol, command,
    dataset: command === "retrieval" || command === "answer" ? name : undefined,
    split: command === "retrieval" || command === "answer" ? split : undefined,
    seed, sourceSha256: code.sourceSha256, gitHead: code.gitHead,
    status: result.status ?? "completed", summaries, comparisons: result.comparisons,
    spend: result.spend, stopped: result.stopped, unresolvedEvidence: result.unresolvedEvidence,
    evidenceProtocol: result.evidenceProtocol, evidenceNormalization: result.evidenceNormalization,
    unresolvedReferences: result.unresolvedReferences, resultSha256: result.resultSha256 }, null, 2));
  if (result.status === "failed" || result.status === "incomplete") process.exitCode = 1;
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Benchmark failed.");
  process.exitCode = 1;
});
