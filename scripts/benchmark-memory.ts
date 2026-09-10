import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { canonicalSha256, isPlainRecord, sha256Hex } from "../src/canonical";
import { exportSummary, summarizeReport } from "./benchmarks/artifacts";
import { DATASETS, selectQuestions, selectSplit, type DatasetName, type Split } from "./benchmarks/datasets";
import { codeIdentity, displayPath, excludeGroups, fetchDataset, loadDataset, loadExclusions, ROOT, writeJson, writeNew } from "./benchmarks/io";
import { createSelection, loadFrozenSelection, provenanceOf } from "./benchmarks/selection";
import { DEFAULT_SYSTEMS, SYSTEMS, type System } from "./benchmarks/retrieval";
import type { LoadedUnits } from "./benchmarks/extract";
import { runRetrieval } from "./benchmarks/runner";

const HELP = `Usage: bun run bench:memory <fetch|extract|retrieval|state|projection|answer|judge|summarize|select> [options]

  --dataset locomo|longmemeval-s|longmemeval-oracle|beam   Default: locomo
                                                  (beam fetch needs python3 + pyarrow; see benchmarks/EVOLUTION_CONFIRMATION.md)
  --split dev|test|all                            Default: dev; split by conversation/family
  --seed N                                       Default: 17
  --limit N                                      Deterministic category-balanced pilot
  --systems NAME,NAME                            Default: all offline baselines
  --top-k N                                      Default: 20; maximum: 100
  --context-bytes N                              Default: 12000 (UTF-8, not tokens)
  --output PATH                                  New JSON report; never overwrites
  --summary-output PATH                          Optional new compact report
  --input PATH                                   Existing report for summarize or judge
  --units PATH                                   Verified question-blind extraction report
  --resume-units PATH                            Resume verified completed extraction chunks
  --extraction-concurrency N                     Default: 3; maximum: 12
  --exclude-report PATH                          Exclude previously used families; repeatable
  --selection PATH                               Replay a frozen longmemeval-s family selection
                                                  (extract, retrieval, answer only; not with --limit)
  --steps N                                      State mutations per seed; default: 32
  --sizes N,N                                    Projection chain sizes; default: 16,32,48
  --repeat N                                     Projection timed repetitions; default: 5
  --paid --max-usd N --max-calls N                 Required for extract/answer/judge; cap <=62.248769
  --reader MODEL                                 Direct snapshot or explicit Gateway alias
  --provider openai|vercel-gateway                Default: openai
  --answer-tokens N                              Default: 512; maximum: 4096
  --judge-model MODEL                            Default: GPT-4o profile for the provider
  --help

Datasets are checksum-pinned, fetched explicitly, and cached under .cache/benchmarks.
Every Oh store is in-memory. No production database, hosted cache, or sync is accessed.
LoCoMo is CC BY-NC 4.0; review that license for your use. Datasets are not bundled.
LongMemEval oracle contains only evidence sessions; it is not the S leaderboard split.
Paid limits are mandatory. Direct OpenAI uses OPENAI_API_KEY; Gateway uses VERCEL_OIDC_TOKEN.
Use vercel env run --project PROJECT -- bun run bench:memory answer --provider vercel-gateway ...
No credential is logged or persisted. Both transports share the same spending ledger.
Use bun --env-file=.env.benchmark run bench:memory answer ... for a dedicated direct-OpenAI key file.
Offline scores are evidence recall, not LLM answer accuracy. See benchmarks/research.json.

select freezes a uniform-random sample of longmemeval-s families (one fixed representative
question per family, chosen deterministically) for exact replay. It makes no paid calls.
Example: bun run bench:memory select --split dev --seed 17 --limit 50 --output selection.json
Replay it later with: bun run bench:memory retrieval --dataset longmemeval-s --selection selection.json --split dev --seed 17
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
    output: { type: "string" }, "summary-output": { type: "string" }, input: { type: "string" }, units: { type: "string" }, steps: { type: "string" },
    sizes: { type: "string" }, repeat: { type: "string" }, paid: { type: "boolean" },
    "max-usd": { type: "string" }, "max-calls": { type: "string" }, reader: { type: "string" },
    provider: { type: "string" }, "answer-tokens": { type: "string" }, "judge-model": { type: "string" },
    "exclude-report": { type: "string", multiple: true }, "resume-units": { type: "string" },
    "extraction-concurrency": { type: "string" }, selection: { type: "string" }, help: { type: "boolean" },
  } });
  if (values.help || positionals.length === 0) { console.log(HELP); return; }
  const commands = ["fetch", "extract", "retrieval", "state", "projection", "answer", "judge", "summarize", "select"];
  if (positionals.length !== 1 || !commands.includes(positionals[0]!)) {
    throw new TypeError("Unknown benchmark command. Use --help.");
  }
  const command = positionals[0]!;
  if (values.selection !== undefined && !["extract", "retrieval", "answer"].includes(command)) {
    throw new TypeError("--selection is only supported for extract, retrieval, and answer.");
  }
  if (values.selection !== undefined && values.limit !== undefined) {
    throw new TypeError("--selection cannot be combined with --limit.");
  }
  if (command === "select" && (values.limit === undefined || values.output === undefined)) {
    throw new TypeError("select requires --limit and --output.");
  }
  if (command === "summarize") {
    if (!values.input || !values.output) throw new TypeError("summarize requires --input and --output.");
    const fullReportSha256 = await exportSummary(values.input, values.output);
    console.log(JSON.stringify({ output: displayPath(values.output), fullReportSha256 }));
    return;
  }
  const datasetName = values.dataset ?? (command === "select" ? "longmemeval-s" : "locomo");
  if (!Object.hasOwn(DATASETS, datasetName)) throw new TypeError("Unknown dataset.");
  const name = datasetName as DatasetName;
  if ((command === "select" || values.selection !== undefined) && name !== "longmemeval-s") {
    throw new TypeError("Family selection is limited to longmemeval-s.");
  }
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
  const provider = values.provider ?? "openai";
  const family = command === "judge" ? "gpt-4o" : command === "extract" || name === "locomo" ? "gpt-4.1-mini" : "gpt-4.1";
  const snapshotDate = command === "judge" ? "2024-08-06" : "2025-04-14";
  const reader = (command === "judge" ? values["judge-model"] : values.reader)
    ?? (provider === "vercel-gateway" ? `openai/${family}` : `${family}-${snapshotDate}`);
  const paidOptions = { paid: values.paid === true, maxUsd: Number(values["max-usd"]), maxCalls: Number(values["max-calls"]),
    reader, provider, maximumOutput: integer(values["answer-tokens"], 512, 1, 4_096) };
  if (command === "extract" || command === "answer" || command === "judge") {
    const { validatePaidAccess } = await import("./benchmarks/model");
    validatePaidAccess(paidOptions);
  }
  const exclusions = await loadExclusions(values["exclude-report"] ?? [], name);
  if (command === "select") {
    const limit = integer(values.limit, 1, 1, 1000);
    const dataset = excludeGroups(selectSplit(await loadDataset(name), split as Split, seed), exclusions.groups);
    const document = await createSelection({ name, split: split as Split, seed, exclusions, dataset, sampleSize: limit, output });
    console.log(JSON.stringify({ output: displayPath(output), protocol: document.protocol, dataset: name, split, seed,
      poolSize: document.poolSize, sampleSize: document.sampleSize, poolSha256: document.poolSha256,
      selectedFamilies: document.selected.map((representative) => representative.groupId),
      selectedQuestions: document.selected.map((representative) => representative.questionId) }, null, 2));
    return;
  }
  const code = await codeIdentity();
  let manifest: object;
  let result: Record<string, unknown>;
  if (command === "extract") {
    const { runExtraction } = await import("./benchmarks/extract");
    const concurrency = integer(values["extraction-concurrency"], 3, 1, 12);
    const limit = values.limit === undefined ? undefined : integer(values.limit, 1, 1, 20_000);
    const frozen = values.selection === undefined ? undefined
      : await loadFrozenSelection({ path: values.selection, name, split: split as Split, seed, exclusions });
    const selected = frozen !== undefined ? frozen.dataset
      : selectQuestions(excludeGroups(selectSplit(await loadDataset(name), split as Split, seed), exclusions.groups), limit, seed);
    manifest = { command, dataset: name, source: DATASETS[name], split, seed, limit: limit ?? null, concurrency, code, exclusions: exclusions.reports,
      selectedCorpora: selected.corpora.map((corpus) => corpus.id),
      ...(frozen === undefined ? {} : { selectedQuestions: selected.questions.map((question) => question.id),
        selectionSha256: canonicalSha256(selected.questions.map((question) => question.id).sort()),
        provenance: provenanceOf(frozen.reportSha256, frozen.document) }) };
    result = await runExtraction({ dataset: selected, datasetName: name, split: split as Split, seed, output, concurrency,
      ...(frozen === undefined ? {} : { frozen: { sourceSha256: code.sourceSha256, selectionReportSha256: frozen.reportSha256 } }),
      ...(values["resume-units"] === undefined ? {} : { resume: values["resume-units"] }), ...paidOptions });
  } else if (command === "judge") {
    if (!values.input) throw new TypeError("judge requires --input with an existing answer report.");
    const { runJudge } = await import("./benchmarks/judge");
    manifest = { command, dataset: name, source: DATASETS[name], split, seed, code };
    result = await runJudge({ input: values.input, output, datasetName: name, split: split as Split, seed, ...paidOptions });
  } else if (command === "state") {
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
      ? ["no-memory", "full-context", "bm25-window", "oh-window"] : [...DEFAULT_SYSTEMS]) : values.systems.split(",");
    if (systems.length === 0 || new Set(systems).size !== systems.length || systems.some((system) => !SYSTEMS.includes(system as System))) {
      throw new TypeError("Unknown or duplicate benchmark systems.");
    }
    const budget = { topK: integer(values["top-k"], 20, 1, 100), contextBytes: integer(values["context-bytes"], 12_000, 1, 4_000_000) };
    const limit = values.limit === undefined ? undefined : integer(values.limit, 1, 1, 20_000);
    const frozen = values.selection === undefined ? undefined
      : await loadFrozenSelection({ path: values.selection, name, split: split as Split, seed, exclusions });
    const selected = frozen !== undefined ? frozen.dataset
      : selectQuestions(excludeGroups(selectSplit(await loadDataset(name), split as Split, seed), exclusions.groups), limit, seed);
    let memory: LoadedUnits | undefined;
    if (systems.some((system) => system.includes("fact"))) {
      if (!values.units) throw new TypeError("Fact systems require --units with a completed extraction report.");
      const { loadUnitReport } = await import("./benchmarks/extract");
      memory = await loadUnitReport(values.units, name, split as Split, seed, selected.corpora);
    }
    manifest = { command, dataset: name, source: DATASETS[name], split, seed, limit: limit ?? null, systems, budget, code,
      exclusions: exclusions.reports, selectedCorpora: selected.corpora.map((corpus) => corpus.id), selectedQuestions: selected.questions.map((question) => question.id),
      selectionSha256: canonicalSha256(selected.questions.map((question) => question.id).sort()),
      ...(frozen === undefined ? {} : { provenance: provenanceOf(frozen.reportSha256, frozen.document) }) };
    if (command === "answer") {
      const { runAnswer } = await import("./benchmarks/model");
      result = await runAnswer({ dataset: selected, datasetName: name, systems: systems as System[], budget, seed, output,
        ...(memory === undefined ? {} : { memory }), ...paidOptions });
    } else result = await runRetrieval(selected, systems as System[], budget, seed, memory);
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
    dataset: command === "retrieval" || command === "answer" || command === "judge" ? name : undefined,
    split: command === "retrieval" || command === "answer" || command === "judge" ? split : undefined,
    seed, sourceSha256: code.sourceSha256, gitHead: code.gitHead,
    status: result.status ?? "completed", summaries, comparisons: result.comparisons,
    provider: result.provider, spend: result.spend, stopped: result.stopped, extraction: result.extraction, memoryUnits: result.memoryUnits,
    unresolvedEvidence: result.unresolvedEvidence,
    evidenceProtocol: result.evidenceProtocol, evidenceNormalization: result.evidenceNormalization,
    unresolvedReferences: result.unresolvedReferences, resultSha256: result.resultSha256 }, null, 2));
  if (result.status === "failed" || result.status === "incomplete") process.exitCode = 1;
}

if (import.meta.main) main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Benchmark failed.");
  process.exitCode = 1;
});
