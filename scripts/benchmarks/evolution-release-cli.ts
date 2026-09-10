/** Offline admission and final reduction for the explicit full500 descriptive run.
 * This command neither loads dataset questions nor opens a paid campaign store. */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { evolutionPin, readEvolutionPin, type EvolutionPin } from "./evolution-budget";
import { makeEvolutionReleaseScope, parseEvolutionReleaseStudy, validateEvolutionReleaseArtifacts } from "./evolution-release";
import { buildEvolutionReleaseReport } from "./evolution-release-report";
import { retrievalIdentity } from "./evolution";
function fail(reason: string): never { throw new TypeError(`Evolution release CLI: ${reason}.`); }
function absolute(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 4096 || value.includes("\0") || resolve(value) !== value) fail("absolute output path required");
  return value;
}
function parse(bytes: Uint8Array): unknown { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
export function parseEvolutionReleaseArgs(args: readonly string[]) {
  const command = args[0], allowed = command === "scope" ? ["study", "study-sha256", "output"] : command === "combine" ? ["input", "input-sha256", "output"] : null;
  if (allowed === null) fail("expected scope or combine");
  const flags = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith("--") || !key || !allowed.includes(key) || !value || value.startsWith("--") || flags.has(key)) fail("unknown, duplicate or missing argument");
    flags.set(key, value);
  }
  if (flags.size !== allowed.length) fail("missing argument");
  const kind = command === "scope" ? "study" : "input", pin = evolutionPin({ path: flags.get(kind), sha256: flags.get(kind + "-sha256") });
  return { command: command as "scope" | "combine", pin, output: absolute(flags.get("output")) };
}
async function writeOutput(output: string, value: unknown, inputs: readonly EvolutionPin[]) {
  if (inputs.some(p => p.path === output)) fail("output overlaps input");
  const text = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(text) > 32 * 1024 * 1024) fail("output bound");
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, text, { flag: "wx", mode: 0o600 });
  return { status: "written", output, sha256: sha256Hex(text), modelCalls: 0 };
}
export async function prepareEvolutionReleaseScope(studyPin: EvolutionPin, output: string) {
  const studyBytes = await readEvolutionPin(studyPin, 1_048_576), study = parseEvolutionReleaseStudy(parse(studyBytes));
  if (study.retrievalSourceSha256 !== await retrievalIdentity()) fail("study does not pin the current retrieval source");
  const manifestBytes = await readEvolutionPin(study.manifestPin, 8 * 1024 * 1024), scope = makeEvolutionReleaseScope(studyBytes, manifestBytes);
  await readEvolutionPin(studyPin, 1_048_576); await readEvolutionPin(study.manifestPin, 8 * 1024 * 1024);
  return writeOutput(absolute(output), scope, [studyPin, study.manifestPin, study.datasetPin, study.campaignPin]);
}
export async function combineEvolutionRelease(inputPin: EvolutionPin, output: string) {
  const value = parse(await readEvolutionPin(inputPin, 1_048_576));
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "studyPin", "scopePin", "reportPins"])
    || value.protocol !== "oh.memory.evolution-release-combine.v1" || !Array.isArray(value.reportPins) || value.reportPins.length !== 5) fail("exact five-shard combine descriptor required");
  const studyPin = evolutionPin(value.studyPin), scopePin = evolutionPin(value.scopePin), reportPins = value.reportPins.map(evolutionPin);
  if (new Set(reportPins.map(p => p.path)).size !== 5 || new Set(reportPins.map(p => p.sha256)).size !== 5) fail("duplicate shard artifact");
  const studyBytes = await readEvolutionPin(studyPin, 1_048_576), study = parseEvolutionReleaseStudy(parse(studyBytes));
  const manifestBytes = await readEvolutionPin(study.manifestPin, 8 * 1024 * 1024), scopeBytes = await readEvolutionPin(scopePin, 8 * 1024 * 1024);
  const authorization = validateEvolutionReleaseArtifacts({ studyBytes, manifestBytes, scopeBytes });
  const reports = await Promise.all(reportPins.map(async pin => ({ pin, report: parse(await readEvolutionPin(pin, 32 * 1024 * 1024)) })));
  const report = buildEvolutionReleaseReport({ authorization, reports });
  // Pins above authenticate the captured byte snapshots; recheck before publication.
  for (const pin of [inputPin, studyPin, study.manifestPin, scopePin, ...reportPins]) await readEvolutionPin(pin, 32 * 1024 * 1024);
  return writeOutput(absolute(output), report, [inputPin, studyPin, scopePin, study.manifestPin, study.datasetPin, study.campaignPin, ...reportPins]);
}
async function main(args: readonly string[]) {
  if (!args.length || args[0] === "--help") {
    console.log("Full500 descriptive scope/report tools (no dataset text, store or provider calls).\nscope --study ABS --study-sha256 SHA --output ABS\ncombine --input ABS --input-sha256 SHA --output ABS\nOutputs are exclusive. V7 prepare/readers/run-reader/judge-plan/run-judge/report use evolution.ts and the exact five shard IDs; old development configurations retain their partition checks."); return;
  }
  const a = parseEvolutionReleaseArgs(args);
  console.log(JSON.stringify(a.command === "scope" ? await prepareEvolutionReleaseScope(a.pin, a.output) : await combineEvolutionRelease(a.pin, a.output)));
}
if (import.meta.main) try { await main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : "Release command failed."); process.exitCode = 1; }
