/** LoCoMo exposure manifest and leaderboard-parity selection. Every conversation is declared: the seed-17
 * development split as development/development, the remaining eight as closed/evaluated, because both have been read
 * by earlier public runs. Nothing here is unseen, and no question text, answer or label leaves the manifest's digests. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256Hex } from "../../src/canonical";
import { DATASETS, parseLocomo, selectSplit, type Dataset } from "./datasets";
import { evolutionPin, type EvolutionPin } from "./evolution-budget";
import { createEvolutionDatasetManifest, type EvolutionDatasetManifest } from "./evolution-dataset";
import { EVOLUTION_LOCOMO_CATEGORY_NAMES, EVOLUTION_LOCOMO_J_CATEGORIES } from "./evolution-locomo-judge";
import { writeJson } from "./io";

export const LOCOMO_EXPOSURE_SEED = 17;
export const LOCOMO_SELECTION_PROTOCOL = "oh.memory.evolution-selection.v1" as const;
export const LOCOMO_DEVELOPMENT_EVIDENCE = "Seed-17 development split (selectSplit dev, 20% of conversations). Used for development-only reader, judge and memory-representation runs recorded in benchmarks/README.md and benchmarks/results/locomo-*dev*.json. Exposure: development."
export const LOCOMO_EVALUATED_EVIDENCE = "Seed-17 test split. Read by the retrieval-only held-out report benchmarks/results/locomo-heldout-v2.json (1,586 questions, 1,224 evidence-labelled) and the 48-question reader/judge held-out run benchmarks/results/locomo-judge-heldout.json, both summarized in benchmarks/README.md. Closed to development selection; exposure is evaluated, not unseen.";
function fail(reason: string): never { throw new TypeError(`LoCoMo exposure: ${reason}.`); }

export function makeLocomoExposureManifest(dataset: Dataset, seed = LOCOMO_EXPOSURE_SEED): EvolutionDatasetManifest {
  if (dataset.questions.some(q => !/^locomo:[1-5]$/.test(q.category))) fail("LoCoMo categories required");
  const development = new Set(selectSplit(dataset, "dev", seed).corpora.map(c => c.groupId));
  const groups = [...new Set(dataset.corpora.map(c => c.groupId))].sort().map(groupId => development.has(groupId)
    ? { groupId, partition: "development" as const, exposure: "development" as const, evidence: LOCOMO_DEVELOPMENT_EVIDENCE }
    : { groupId, partition: "closed" as const, exposure: "evaluated" as const, evidence: LOCOMO_EVALUATED_EVIDENCE });
  return createEvolutionDatasetManifest(dataset, { dataset: "locomo", revision: DATASETS.locomo.revision, sourceSha256: DATASETS.locomo.sha256, groups });
}
const questionIndex = (id: string) => { const index = Number(id.slice(id.lastIndexOf(":") + 1)); if (!Number.isSafeInteger(index) || index < 0) fail("LoCoMo question identifier"); return index; };
/** Explicit ordered selection for the J denominator: categories 1-4 in conversation order, then original question order. */
export function locomoParitySelection(manifest: EvolutionDatasetManifest): readonly string[] {
  if (manifest.dataset !== "locomo") fail("LoCoMo manifest required");
  return manifest.questions.filter(q => (EVOLUTION_LOCOMO_J_CATEGORIES as readonly string[]).includes(q.category))
    .sort((a, b) => a.corpusId < b.corpusId ? -1 : a.corpusId > b.corpusId ? 1 : questionIndex(a.id) - questionIndex(b.id)).map(q => q.runnerId);
}
/** Aggregate counts only; suitable for a public results page. */
export function summarizeLocomoExposure(manifest: EvolutionDatasetManifest) {
  const byGroup = new Map(manifest.groups.map(g => [g.groupId, g]));
  const categories = Object.keys(EVOLUTION_LOCOMO_CATEGORY_NAMES).sort();
  const conversations = manifest.corpora.map(c => { const g = byGroup.get(c.groupId)!, rows = manifest.questions.filter(q => q.corpusId === c.id);
    return { conversation: c.id, partition: g.partition, exposure: g.exposure, questions: rows.length,
      parityQuestions: rows.filter(q => (EVOLUTION_LOCOMO_J_CATEGORIES as readonly string[]).includes(q.category)).length,
      byCategory: Object.fromEntries(categories.map(category => [category, rows.filter(q => q.category === category).length])) }; });
  return { dataset: manifest.dataset, revision: manifest.revision, sourceSha256: manifest.sourceSha256, datasetSha256: manifest.datasetSha256,
    conversations, totals: { questions: manifest.questions.length, parityQuestions: locomoParitySelection(manifest).length,
      byCategory: Object.fromEntries(categories.map(category => [category, manifest.questions.filter(q => q.category === category).length])),
      byExposure: Object.fromEntries(["development", "evaluated"].map(exposure => [exposure, conversations.filter(c => c.exposure === exposure).length])) },
    categoryNames: EVOLUTION_LOCOMO_CATEGORY_NAMES };
}
export function parseLocomoExposureArgs(args: readonly string[]) {
  const allowed = ["dataset", "dataset-sha256", "output", "selection"], flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.slice(2), value = args[i + 1];
    if (!args[i]?.startsWith("--") || !key || !allowed.includes(key) || !value || value.startsWith("--") || flags.has(key)) fail("unknown, duplicate or missing argument");
    flags.set(key, value);
  }
  if (flags.size !== allowed.length) fail("missing argument");
  const absolute = (value: string) => { if (resolve(value) !== value || value.includes("\0") || value.length > 4096) fail("absolute path required"); return value; };
  return { pin: evolutionPin({ path: flags.get("dataset"), sha256: flags.get("dataset-sha256") }), output: absolute(flags.get("output")!), selection: absolute(flags.get("selection")!) };
}
/** Reads only the pinned official LoCoMo file and writes two metadata files exclusively; no question text is written. */
export async function writeLocomoExposure(pin: EvolutionPin, output: string, selection: string) {
  if (pin.sha256 !== DATASETS.locomo.sha256) fail("official LoCoMo pin required");
  const raw = await readFile(pin.path);
  if (raw.length !== DATASETS.locomo.bytes || sha256Hex(raw) !== pin.sha256) fail("pinned dataset changed");
  const dataset = parseLocomo(JSON.parse(raw.toString("utf8"))), manifest = makeLocomoExposureManifest(dataset);
  if ([output, selection].some(p => p === pin.path) || output === selection) fail("outputs overlap");
  await writeJson(output, manifest);
  const manifestSha256 = sha256Hex(await readFile(output)), questionIds = locomoParitySelection(manifest);
  await writeJson(selection, { protocol: LOCOMO_SELECTION_PROTOCOL, dataset: "locomo", manifestSha256, categories: EVOLUTION_LOCOMO_J_CATEGORIES,
    order: "conversation-then-question-index", questionIds });
  return { status: "written", output, manifestSha256, selection, selectionSha256: sha256Hex(await readFile(selection)), summary: summarizeLocomoExposure(manifest), modelCalls: 0 };
}
if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (!args.length || args[0] === "--help") console.log("LoCoMo exposure manifest (no question text, gold or provider calls).\n--dataset ABS --dataset-sha256 SHA --output ABS --selection ABS");
    else { const a = parseLocomoExposureArgs(args); console.log(JSON.stringify(await writeLocomoExposure(a.pin, a.output, a.selection))); }
  } catch (error) { console.error(error instanceof Error ? error.message : "LoCoMo exposure failed."); process.exitCode = 1; }
}
