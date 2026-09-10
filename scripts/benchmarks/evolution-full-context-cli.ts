/** Offline companion admission/reduction. No dataset text, paid store or provider I/O. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { hasExactKeys, isPlainRecord, sha256Hex } from "../../src/canonical";
import { evolutionPin, readEvolutionPin, type EvolutionPin } from "./evolution-budget";
import { parseEvolutionFullContextStudy, validateEvolutionFullContextArtifacts } from "./evolution-full-context-study";
import { buildEvolutionFullContextReport } from "./evolution-full-context-report";
import { retrievalIdentity } from "./evolution";
function fail(reason: string): never { throw new TypeError(`Evolution full-context CLI: ${reason}.`); }
function outputPath(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 4096 || value.includes("\0") || resolve(value) !== value) fail("absolute output path required");
  return value;
}
const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
export function parseEvolutionFullContextArgs(args: readonly string[]) {
  const command = args[0], allowed = command === "check" ? ["study", "study-sha256", "output"] : command === "combine" ? ["input", "input-sha256", "output"] : null;
  if (allowed === null) fail("expected check or combine");
  const flags = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith("--") || !key || !allowed.includes(key) || !value || value.startsWith("--") || flags.has(key)) fail("unknown, duplicate or missing argument");
    flags.set(key, value);
  }
  if (flags.size !== allowed.length) fail("missing argument");
  const kind = command === "check" ? "study" : "input";
  return { command: command as "check" | "combine", pin: evolutionPin({ path: flags.get(kind), sha256: flags.get(kind + "-sha256") }), output: outputPath(flags.get("output")) };
}
async function authorization(studyPin: EvolutionPin) {
  const studyBytes = await readEvolutionPin(studyPin, 1_048_576), study = parseEvolutionFullContextStudy(decode(studyBytes));
  const manifestBytes = await readEvolutionPin(study.manifestPin, 8 * 1024 * 1024);
  const result = validateEvolutionFullContextArtifacts({ studyBytes, manifestBytes,
    parentStudyBytes: await readEvolutionPin(study.parentStudyPin, 1_048_576), parentScopeBytes: await readEvolutionPin(study.parentScopePin, 8 * 1024 * 1024) });
  return { result, pins: [studyPin, study.parentStudyPin, study.parentScopePin, study.manifestPin] };
}
async function publish(output: string, value: unknown, pins: readonly EvolutionPin[], protectedPins: readonly EvolutionPin[]) {
  const path = outputPath(output); if ([...pins, ...protectedPins].some(p => p.path === path)) fail("output overlaps immutable input");
  for (const pin of pins) await readEvolutionPin(pin, 32 * 1024 * 1024);
  const text = JSON.stringify(value, null, 2) + "\n"; if (Buffer.byteLength(text) > 32 * 1024 * 1024) fail("output bound");
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, text, { flag: "wx", mode: 0o600 });
  return { status: "written", output: path, sha256: sha256Hex(text), modelCalls: 0 };
}
export async function checkEvolutionFullContextStudy(studyPin: EvolutionPin, output: string) {
  const { result: a, pins } = await authorization(studyPin);
  if (a.study.sourceSha256 !== await retrievalIdentity()) fail("companion must pin current source before preparation");
  return publish(output, { protocol: "oh.memory.evolution-full-context-admission.v1", studySha256: a.studySha256,
    parentStudySha256: a.parent.studySha256, parentScopeSha256: a.parent.scope.scopeSha256,
    questions: 500, logicalReaderCases: 500, shards: a.parent.scope.shards.map(s => ({ id: s.id, questionIdsSha256: s.questionIdsSha256, questions: s.questionIds.length })),
    sourceSha256: a.study.sourceSha256, fullHistoryPolicySha256: a.study.fullHistoryPolicySha256,
    qualification: "Metadata/source-version admission only; no corpus preparation, capacity, campaign approval, paid store or provider qualification." },
    pins, [a.study.datasetPin, a.study.campaignPin, a.parent.study.campaignPin]);
}
export async function combineEvolutionFullContext(inputPin: EvolutionPin, output: string) {
  const value = decode(await readEvolutionPin(inputPin, 1_048_576));
  if (!isPlainRecord(value) || !hasExactKeys(value, ["protocol", "studyPin", "parentReportPins", "reportPins"])
    || value.protocol !== "oh.memory.evolution-full-context-combine.v1" || !Array.isArray(value.parentReportPins) || value.parentReportPins.length !== 5
    || !Array.isArray(value.reportPins) || value.reportPins.length !== 5) fail("exact five parent and five companion shard pins required");
  const studyPin = evolutionPin(value.studyPin), parentReportPins = value.parentReportPins.map(evolutionPin), reportPins = value.reportPins.map(evolutionPin);
  const all = [...parentReportPins, ...reportPins];
  if (new Set(all.map(p => p.path)).size !== 10 || new Set(all.map(p => p.sha256)).size !== 10) fail("distinct shard artifacts required");
  const { result: a, pins } = await authorization(studyPin);
  const read = async (pin: EvolutionPin) => ({ pin, report: decode(await readEvolutionPin(pin, 32 * 1024 * 1024)) });
  const parentReports = await Promise.all(parentReportPins.map(read)), reports = await Promise.all(reportPins.map(read));
  const report = buildEvolutionFullContextReport({ authorization: a, parentReports, reports });
  return publish(output, report, [inputPin, ...pins, ...all], [a.study.datasetPin, a.study.campaignPin, a.parent.study.campaignPin]);
}
async function main(args: readonly string[]) {
  if (!args.length || args[0] === "--help") {
    console.log("Full-context500 companion metadata/reduction (no dataset, store or provider calls).\ncheck --study ABS --study-sha256 SHA --output ABS\ncombine --input ABS --input-sha256 SHA --output ABS\nUse evolution.ts V8 for each original100-ID shard; its prepare/readers/judge/report retain existing paid custody. Parent V7 stays two arms."); return;
  }
  const a = parseEvolutionFullContextArgs(args);
  console.log(JSON.stringify(a.command === "check" ? await checkEvolutionFullContextStudy(a.pin, a.output) : await combineEvolutionFullContext(a.pin, a.output)));
}
if (import.meta.main) try { await main(process.argv.slice(2)); } catch (error) { console.error(error instanceof Error ? error.message : "Companion command failed."); process.exitCode = 1; }
