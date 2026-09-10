/** Offline BEAM data-side seal commands: exposure review and the cryptographic family draw.
 * No provider, network or campaign store is touched; both commands print counts and digests only.
 *
 *   bun scripts/benchmarks/beam-seal-cli.ts review --output PATH --declare PATH [--reference longmemeval-s,locomo]
 *       [--max-exact-turn-matches N] [--max-sampled-shingle-matches-per-corpus N]   (sampled shingles are report-only unless bounded)
 *   --declare is mandatory: a JSON array of prior-exposure declarations, or an explicit empty array when the operator asserts none.
 *   bun scripts/benchmarks/beam-seal-cli.ts draw --review PATH --families N --output PATH
 */
import { parseArgs } from "node:util";

import { canonicalSha256, sha256Hex } from "../../src/canonical";
import { parseBeamProvenance, DATASETS, type DatasetName } from "./datasets";
import { displayPath, loadDataset, loadDatasetValue, parseDataset, writeJson } from "./io";
import { BEAM_DEFAULT_THRESHOLDS, parseBeamExposureDeclarations, parseBeamExposureReview, reviewBeamExposure,
  type BeamExposureReview, type BeamReferenceDataset } from "./beam-review";
import { createBeamSelection } from "./beam-selection";

const REFERENCE_NAMES = new Set<DatasetName>(["longmemeval-s", "locomo", "longmemeval-oracle"]);

function integer(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new TypeError(`${label} must be a non-negative integer.`);
  return result;
}

async function readJson(path: string, maximum: number): Promise<{ value: unknown; sha256: string }> {
  const file = Bun.file(path);
  if (!await file.exists() || file.size > maximum) throw new Error(`${displayPath(path)} must exist and be at most ${maximum} bytes.`);
  const bytes = await file.bytes();
  return { value: JSON.parse(new TextDecoder().decode(bytes)) as unknown, sha256: sha256Hex(bytes) };
}

export async function loadBeamReview(path: string): Promise<{ review: BeamExposureReview; sha256: string }> {
  const { value, sha256 } = await readJson(path, 16 * 1024 * 1024);
  return { review: parseBeamExposureReview(value), sha256 };
}

export async function main(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, options: {
    output: { type: "string" }, declare: { type: "string" }, reference: { type: "string" }, review: { type: "string" },
    families: { type: "string" }, "max-exact-turn-matches": { type: "string" }, "max-sampled-shingle-matches-per-corpus": { type: "string" },
  } });
  const command = positionals[0];
  if (command === "review") {
    if (!values.output || !values.declare) throw new TypeError("review requires --output and --declare (a JSON array of prior-exposure declarations; [] declares none explicitly).");
    const referenceNames = (values.reference ?? "longmemeval-s,locomo").split(",").filter((name) => name.length > 0);
    for (const name of referenceNames) if (!REFERENCE_NAMES.has(name as DatasetName)) throw new TypeError(`Unknown reference dataset ${name}.`);
    const declarations = parseBeamExposureDeclarations((await readJson(values.declare, 1024 * 1024)).value);
    const thresholds = { maximumExactTurnMatches: integer(values["max-exact-turn-matches"], BEAM_DEFAULT_THRESHOLDS.maximumExactTurnMatches, "--max-exact-turn-matches"),
      maximumSampledShingleMatchesPerCorpus: values["max-sampled-shingle-matches-per-corpus"] === undefined ? BEAM_DEFAULT_THRESHOLDS.maximumSampledShingleMatchesPerCorpus
        : integer(values["max-sampled-shingle-matches-per-corpus"], 0, "--max-sampled-shingle-matches-per-corpus") };
    const raw = await loadDatasetValue("beam");
    const beam = parseDataset("beam", raw), provenance = parseBeamProvenance(raw);
    const references: BeamReferenceDataset[] = [];
    for (const name of referenceNames as DatasetName[]) references.push({ dataset: name, sha256: DATASETS[name].sha256, data: await loadDataset(name) });
    const review = reviewBeamExposure({ beam, provenance, references, declarations, thresholds });
    await writeJson(values.output, review);
    console.log(JSON.stringify({ output: displayPath(values.output), reviewSha256: sha256Hex(await Bun.file(values.output).bytes()),
      summary: review.summary, groups: review.groups.length, references: review.references.map((reference) => ({ dataset: reference.dataset, corpora: reference.corpora })) }, null, 2));
    return;
  }
  if (command === "draw") {
    if (!values.review || !values.output || !values.families) throw new TypeError("draw requires --review, --families and --output.");
    const { review, sha256 } = await loadBeamReview(values.review);
    const dataset = await loadDataset("beam");
    const document = createBeamSelection({ dataset, review, reviewSha256: sha256, sampleFamilies: integer(values.families, 0, "--families") });
    await writeJson(values.output, document);
    console.log(JSON.stringify({ output: displayPath(values.output), protocol: document.protocol, reviewSha256: sha256, poolSha256: document.poolSha256,
      poolSize: document.poolSize, sampleFamilies: document.sampleFamilies, sampleQuestions: document.sampleQuestions,
      selectedSha256: canonicalSha256(document.selected.map((family) => family.groupId)) }, null, 2));
    return;
  }
  throw new TypeError("Usage: beam-seal-cli.ts <review|draw> [options]");
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
