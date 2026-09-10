/** Offline paired re-scoring, strata declaration and power tables over private evolution run directories.
 *
 * Reads run artifacts read-only from paths supplied on the command line, makes no model,
 * provider or campaign-store call, and prints only counts, digests and development-partition
 * identifiers. Closed-partition identifiers, question text, gold and answers never leave the
 * private artifacts. Usage:
 *
 *   rescore --manifest M [--pin M1] --study LABEL=DIR[@REPEAT][,DIR[@REPEAT]...] ...
 *           [--compare LABEL:VARIANT/READER=VARIANT/READER ...] [--dataset PATH] [--predictions PATH]
 *           [--canaries ID,ID,...] [--resamples N] [--seed N] [--alpha A] [--output PATH]
 *   declare-strata --manifest M1 --inspected PATH --output PATH
 *   power --questions N --repeats K --base-accuracy F --gain-points G --flip-rate F
 *         --rule majority-gain:MIN_GAIN:MAX_REGRESSIONS | lower-bound:ALPHA:MIN_POINTS [--simulations N] [--seed N] */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, sha256Hex } from "../../src/canonical";
import { DATASETS, parseLongMemEval } from "./datasets";
import { analyzeEvolutionPairs, contentClusters, declareEvolutionStrata, loadEvolutionQuestionMeta, loadEvolutionRunRows, parseEvolutionPredictedFlips,
  simulateEvolutionPower, summarizeEvolutionStrata, type EvolutionPairedComparisonRequest, type EvolutionPairedRow, type EvolutionPowerRule } from "./evolution-paired-stats";

const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024, MAX_MANIFEST_BYTES = 8 * 1024 * 1024, MAX_SMALL_BYTES = 1024 * 1024, MAX_STUDIES = 16, MAX_DIRECTORIES = 64;
const COMMANDS = {
  rescore: { required: ["manifest", "study"], optional: ["pin", "compare", "dataset", "predictions", "canaries", "resamples", "seed", "alpha", "output"], repeatable: ["study", "compare"] },
  "declare-strata": { required: ["manifest", "inspected", "output"], optional: [], repeatable: [] },
  power: { required: ["questions", "repeats", "base-accuracy", "gain-points", "flip-rate", "rule"], optional: ["simulations", "seed"], repeatable: [] },
} as const;
export type EvolutionPairedStatsCommand = keyof typeof COMMANDS;
export type EvolutionPairedStatsArgs = Readonly<{ command: EvolutionPairedStatsCommand; flags: ReadonlyMap<string, readonly string[]> }>;

/** Fixed public-safe evidence text for the V2 strata declaration; it cites the three published reads and names no question. */
export const EVOLUTION_STRATA_EVIDENCE = {
  evaluated: "Exposure declared evaluated on 2026-09-10: aggregate closed-stratum scores were read for the nano, mini and full-context 500-question studies (benchmarks/EVOLUTION_RELEASE_RESULTS.md), so no closed group is a holdout. Partition unchanged.",
  inspected: "Inspected: at least one question of this group was read per question during the 2026-09-10 failure analysis of the mini reader; further per-question reads are allowed only under the private work directory.",
  aggregateOnly: "Aggregate-only: no question of this group has been read per question; it may be scored in aggregate but never inspected per question.",
} as const;

function fail(reason: string): never { throw new TypeError(`Evolution paired stats CLI: ${reason}.`); }
function absolute(value: string, label: string): string {
  if (!value.length || value.length > 4096 || value.includes("\0") || resolve(value) !== value) fail(`${label} must be an absolute path`);
  return value;
}
function number(value: string, label: string, minimum: number, maximum: number, integerOnly = false): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum || (integerOnly && !Number.isSafeInteger(parsed))) fail(`${label} must be a number from ${minimum} through ${maximum}`);
  return parsed;
}

export function parseEvolutionPairedStatsArgs(args: readonly string[]): EvolutionPairedStatsArgs {
  const command = args[0];
  if (command === undefined || !Object.hasOwn(COMMANDS, command)) fail("expected rescore, declare-strata or power");
  const spec = COMMANDS[command as EvolutionPairedStatsCommand], allowed = [...spec.required, ...spec.optional] as readonly string[];
  const flags = new Map<string, string[]>();
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1], key = flag?.slice(2);
    if (flag === undefined || !flag.startsWith("--") || key === undefined || !allowed.includes(key) || value === undefined || value.startsWith("--") || !value.length) fail("unknown, malformed or missing argument");
    const bucket = flags.get(key) ?? [];
    if (bucket.length && !(spec.repeatable as readonly string[]).includes(key)) fail(`duplicate --${key}`);
    bucket.push(value); flags.set(key, bucket);
  }
  for (const key of spec.required) if (!flags.has(key)) fail(`missing --${key}`);
  return { command: command as EvolutionPairedStatsCommand, flags };
}
const one = (flags: ReadonlyMap<string, readonly string[]>, key: string): string | undefined => flags.get(key)?.[0];

async function readJson(path: string, maximum: number): Promise<Readonly<{ value: unknown; sha256: string }>> {
  const information = await stat(path);
  if (!information.isFile() || information.size > maximum) fail(`${path} is not a file within ${maximum} bytes`);
  const bytes = await readFile(path);
  return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), sha256: sha256Hex(bytes) };
}
async function writeNewJson(path: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) fail("output bound exceeded");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, { flag: "wx", mode: 0o600 });
  return { output: path, sha256: sha256Hex(text) };
}

export type EvolutionStudySpec = Readonly<{ label: string; directories: readonly Readonly<{ directory: string; repeat: number }>[] }>;
export function parseStudySpec(value: string): EvolutionStudySpec {
  const separator = value.indexOf("=");
  if (separator < 1) fail("study needs LABEL=DIR[@REPEAT][,...]");
  const label = value.slice(0, separator);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(label)) fail("study label must be lowercase letters, digits and hyphens");
  const directories = value.slice(separator + 1).split(",").map(entry => {
    const at = entry.lastIndexOf("@"), directory = at < 0 ? entry : entry.slice(0, at);
    const repeat = at < 0 ? 0 : number(entry.slice(at + 1), "repeat", 0, 100, true);
    return { directory: absolute(directory, "study directory"), repeat };
  });
  if (!directories.length || directories.length > MAX_DIRECTORIES) fail("study directory list is empty or too long");
  return { label, directories };
}
export function parseCompareSpec(value: string): Readonly<{ label: string; comparison: EvolutionPairedComparisonRequest }> {
  const match = /^([a-z0-9-]+):([^/=]+)\/([^/=]+)=([^/=]+)\/([^/=]+)$/u.exec(value);
  if (match === null) fail("compare needs LABEL:VARIANT/READER=VARIANT/READER");
  const [, label = "", candidateVariant = "", candidateReader = "", controlVariant = "", controlReader = ""] = match;
  return { label, comparison: { candidate: { variantId: candidateVariant, reader: candidateReader }, control: { variantId: controlVariant, reader: controlReader } } };
}
export function parsePowerRule(value: string): EvolutionPowerRule {
  const parts = value.split(":");
  if (parts[0] === "majority-gain" && parts.length === 3) return { kind: "majority-gain", minimumGain: number(parts[1] ?? "", "minimum gain", 0, 100_000, true), maximumRegressions: number(parts[2] ?? "", "maximum regressions", 0, 100_000, true) };
  if (parts[0] === "lower-bound" && parts.length === 3) return { kind: "mean-lower-bound", alpha: number(parts[1] ?? "", "alpha", 1e-6, 0.499), minimumGainPoints: number(parts[2] ?? "", "minimum gain points", 0, 100) };
  return fail("rule must be majority-gain:MIN_GAIN:MAX_REGRESSIONS or lower-bound:ALPHA:MIN_POINTS");
}

async function loadManifests(flags: ReadonlyMap<string, readonly string[]>) {
  const manifestPath = absolute(one(flags, "manifest") ?? "", "manifest"), manifest = await readJson(manifestPath, MAX_MANIFEST_BYTES);
  const questions = loadEvolutionQuestionMeta(manifest.value), accepted = new Set([manifest.sha256]);
  const pinPath = one(flags, "pin");
  if (pinPath !== undefined) {
    const pin = await readJson(absolute(pinPath, "pin"), MAX_MANIFEST_BYTES), pinned = loadEvolutionQuestionMeta(pin.value);
    const strip = (rows: readonly Readonly<{ runnerId: string; id: string; groupId: string; historyId: string; category: string; partition: string }>[]) =>
      canonicalJson(rows.map(q => ({ runnerId: q.runnerId, id: q.id, groupId: q.groupId, historyId: q.historyId, category: q.category, partition: q.partition })));
    const manifestRecord = manifest.value as Record<string, unknown>, pinRecord = pin.value as Record<string, unknown>;
    if (manifestRecord.datasetSha256 !== pinRecord.datasetSha256 || strip(questions) !== strip(pinned)) fail("the legacy pin and the strata manifest describe different questions or partitions");
    accepted.add(pin.sha256);
  }
  return { manifestPath, manifestSha256: manifest.sha256, questions, accepted };
}

async function loadStudyRows(study: EvolutionStudySpec, accepted: ReadonlySet<string>) {
  const rows: EvolutionPairedRow[] = [], pins: Record<string, string>[] = [];
  for (const { directory, repeat } of study.directories) {
    const [readers, readersComplete, judges, judgesComplete] = await Promise.all(["readers.json", "readers-complete.json", "judges.json", "judges-complete.json"]
      .map(name => readJson(join(directory, name), MAX_ARTIFACT_BYTES)));
    const manifestSha256 = (readers?.value as Record<string, unknown> | undefined)?.manifestSha256;
    if (typeof manifestSha256 !== "string" || !accepted.has(manifestSha256)) fail(`${directory} pins a manifest other than the supplied strata manifest or legacy pin`);
    rows.push(...loadEvolutionRunRows({ readers: readers?.value, readersComplete: readersComplete?.value, judges: judges?.value, judgesComplete: judgesComplete?.value }, repeat));
    pins.push({ directory, repeat: String(repeat), readersSha256: readers?.sha256 ?? "", readersCompleteSha256: readersComplete?.sha256 ?? "", judgesSha256: judges?.sha256 ?? "", judgesCompleteSha256: judgesComplete?.sha256 ?? "" });
  }
  return { rows, pins };
}

export async function runEvolutionPairedStatsCli(args: readonly string[]): Promise<unknown> {
  const { command, flags } = parseEvolutionPairedStatsArgs(args);
  if (command === "power") {
    return simulateEvolutionPower({ questions: number(one(flags, "questions") ?? "", "questions", 1, 100_000, true), repeats: number(one(flags, "repeats") ?? "", "repeats", 1, 100, true),
      baseAccuracy: number(one(flags, "base-accuracy") ?? "", "base accuracy", 1e-6, 0.999999), trueGainPoints: number(one(flags, "gain-points") ?? "", "gain points", 0, 100),
      flipRate: number(one(flags, "flip-rate") ?? "", "flip rate", 0, 0.499), rule: parsePowerRule(one(flags, "rule") ?? ""),
      simulations: number(one(flags, "simulations") ?? "2000", "simulations", 1, 1_000_000, true), seed: number(one(flags, "seed") ?? "17", "seed", 0, 0xffff_ffff, true) });
  }
  if (command === "declare-strata") {
    const manifest = await readJson(absolute(one(flags, "manifest") ?? "", "manifest"), MAX_MANIFEST_BYTES);
    const inspected = await readJson(absolute(one(flags, "inspected") ?? "", "inspected"), MAX_SMALL_BYTES);
    if (!Array.isArray(inspected.value) || inspected.value.some(id => typeof id !== "string")) fail("inspected file must be a JSON array of question IDs");
    const declared = declareEvolutionStrata(manifest.value, inspected.value as string[], EVOLUTION_STRATA_EVIDENCE);
    const written = await writeNewJson(absolute(one(flags, "output") ?? "", "output"), declared);
    return { command, inputManifestSha256: manifest.sha256, inspectedSha256: inspected.sha256, strata: summarizeEvolutionStrata(loadEvolutionQuestionMeta(declared)), ...written, modelCalls: 0 };
  }
  const manifests = await loadManifests(flags);
  const studies = (flags.get("study") ?? []).map(parseStudySpec);
  if (studies.length > MAX_STUDIES || new Set(studies.map(s => s.label)).size !== studies.length) fail("too many or duplicate study labels");
  const comparisons = (flags.get("compare") ?? []).map(parseCompareSpec);
  for (const c of comparisons) if (!studies.some(s => s.label === c.label)) fail(`comparison names an unknown study ${c.label}`);
  const datasetPath = one(flags, "dataset");
  const reclusters = datasetPath === undefined ? undefined : await (async () => {
    const dataset = await readJson(absolute(datasetPath, "dataset"), 512 * 1024 * 1024);
    if (dataset.sha256 !== DATASETS["longmemeval-s"].sha256) fail("dataset bytes do not match the pinned longmemeval-s source");
    return contentClusters(parseLongMemEval(dataset.value));
  })();
  const predictionsPath = one(flags, "predictions");
  const predictions = predictionsPath === undefined ? undefined : parseEvolutionPredictedFlips((await readJson(absolute(predictionsPath, "predictions"), MAX_SMALL_BYTES)).value);
  const canaries = one(flags, "canaries")?.split(",") ?? [];
  const resamples = number(one(flags, "resamples") ?? "10000", "resamples", 100, 100_000, true), seed = number(one(flags, "seed") ?? "17", "seed", 0, 0xffff_ffff, true);
  const alpha = number(one(flags, "alpha") ?? "0.025", "alpha", 1e-6, 0.499);
  const results = [];
  for (const study of studies) {
    const { rows, pins } = await loadStudyRows(study, manifests.accepted);
    const analysis = analyzeEvolutionPairs({ rows, questions: manifests.questions, comparisons: comparisons.filter(c => c.label === study.label).map(c => c.comparison),
      resamples, seed, alpha, ...(reclusters === undefined ? {} : { reclusters }), ...(predictions === undefined ? {} : { predictions }), canaries });
    results.push({ label: study.label, runs: pins, analysis });
  }
  const output = { protocol: "oh.memory.evolution-paired-rescore.v1", manifest: { path: manifests.manifestPath, sha256: manifests.manifestSha256, acceptedPins: [...manifests.accepted].sort() },
    strata: summarizeEvolutionStrata(manifests.questions), reclustered: reclusters !== undefined, predictionsSha256: predictions?.basisSha256 ?? null, resamples, seed, alpha, studies: results, modelCalls: 0 };
  const outputPath = one(flags, "output");
  return outputPath === undefined ? output : { ...output, written: await writeNewJson(absolute(outputPath, "output"), output) };
}

function summarize(value: unknown): string {
  const lines: string[] = [];
  const v = value as { studies?: readonly { label: string; analysis: ReturnType<typeof analyzeEvolutionPairs> }[]; strata?: readonly { stratum: string; questions: number; groups: number }[] };
  if (v.strata) lines.push(`strata: ${v.strata.map(s => `${s.stratum} ${s.questions} questions / ${s.groups} groups`).join("; ")}`);
  for (const study of v.studies ?? []) {
    lines.push(`study ${study.label}: ${study.analysis.questions} questions`);
    for (const arm of study.analysis.arms) {
      lines.push(`  arm ${arm.variantId} / ${arm.reader}: mean ${arm.meanCorrect}/${arm.questions} (${arm.meanAccuracyPoints} pts), per repeat ${arm.perRepeat.map(r => r.correct).join("/")}, majority ${arm.majorityCorrect}`
        + `, strata ${arm.byStratum.map(s => `${s.label} ${s.meanCorrect}/${s.questions}`).join(", ")}`);
    }
    for (const c of study.analysis.comparisons) {
      lines.push(`  ${c.candidate.variantId}/${c.candidate.reader} vs ${c.control.variantId}/${c.control.reader}: ${c.wins}W/${c.losses}L/${c.ties}T, delta ${c.meanDeltaPoints} pts,`
        + ` sign p=${c.signTest.oneSidedPValue}, bootstrap ${Math.round((1 - 2 * study.analysis.alpha) * 1000) / 10}% CI [${c.clusterBootstrap.intervalPoints.join(", ")}] over ${c.clusterBootstrap.clusters} clusters`
        + (c.contentReclusterBootstrap ? `, reclustered [${c.contentReclusterBootstrap.intervalPoints.join(", ")}] over ${c.contentReclusterBootstrap.clusters}` : "")
        + `, Holm lower bound ${c.holm.lowerBoundPoints} (${c.holm.better ? "better" : "not established"}${c.holm.clearlyBetter ? ", clearly better" : ""})`
        + (c.finitePopulation ? `, finite-population bound ${c.finitePopulation.lowerBound}` : ""));
      lines.push(`    by stratum: ${c.byStratum.map(s => `${s.label} ${s.wins}W/${s.losses}L/${s.ties}T`).join("; ")}; by category: ${c.byCategory.map(s => `${s.label} ${s.wins}/${s.losses}`).join("; ")}`);
    }
  }
  return lines.join("\n");
}

if (import.meta.main) {
  runEvolutionPairedStatsCli(process.argv.slice(2)).then(result => {
    const summary = summarize(result);
    if (summary.length) console.log(summary);
    console.log(JSON.stringify(result, (key, value: unknown) => key === "studies" || key === "analysis" ? undefined : value, 2));
  }, error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
