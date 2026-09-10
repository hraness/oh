import { mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, parseBeam, parseLocomo, parseLongMemEval, type Dataset, type DatasetName } from "./datasets";

export const ROOT = resolve(import.meta.dir, "../..");
// A 120-family extraction can exceed the original 64 MiB pilot bound.
export const MAX_REPORT_BYTES = 128 * 1024 * 1024;

export function datasetPath(name: DatasetName): string {
  return join(ROOT, ".cache/benchmarks/datasets", `${name}.json`);
}

export async function writeNew(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(content); } finally { await handle.close(); }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeNew(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function downloadBounded(url: string, maximum: number): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || response.body === null) throw new Error(`Dataset download failed (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > maximum) throw new RangeError("Dataset download exceeded its pinned byte size.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks, total);
}

/** BEAM parquet parts live beside the canonical JSON in the ignored cache; the converter is scripts/benchmarks/beam-parquet-to-json.py.
 * Acquisition is an explicit operator step (`bench:memory fetch --dataset beam`, about 106 MB of parquet plus a 285 MB
 * re-encoding); no benchmark command downloads BEAM implicitly. */
export function beamSourceDirectory(): string {
  return join(ROOT, ".cache/benchmarks/datasets/beam-source");
}

async function acquireBeam(path: string): Promise<void> {
  const source = DATASETS.beam;
  const directory = beamSourceDirectory();
  for (const part of source.parts) {
    const partPath = join(directory, part.path);
    const existing = Bun.file(partPath);
    let bytes: Uint8Array;
    if (await existing.exists()) {
      if (existing.size !== part.bytes) throw new Error(`Cached BEAM part ${part.path} byte size does not match its pin.`);
      bytes = await existing.bytes();
    } else {
      bytes = await downloadBounded(`https://huggingface.co/datasets/Mohammadta/BEAM/resolve/${source.revision}/${part.path}`, part.bytes);
    }
    if (bytes.length !== part.bytes || sha256Hex(bytes) !== part.sha256) throw new Error(`BEAM part ${part.path} checksum mismatch.`);
    if (!await existing.exists()) await writeNew(partPath, bytes);
  }
  await convertBeamSource({ directory, output: path, python: process.env.OH_BEAM_PYTHON ?? "python3" });
}

/** Run the pinned converter over verified parquet parts and keep the output only when it matches the canonical JSON pin. */
export async function convertBeamSource(input: Readonly<{ directory: string; output: string; python: string }>): Promise<void> {
  const source = DATASETS.beam;
  const conversion = Bun.spawnSync([input.python, join(ROOT, "scripts/benchmarks/beam-parquet-to-json.py"),
    "--input-dir", input.directory, "--output", input.output], { stdout: "pipe", stderr: "pipe", timeout: 600_000 });
  if (conversion.exitCode !== 0) {
    throw new Error(`BEAM conversion failed (set OH_BEAM_PYTHON to a Python with pyarrow 21.0.0): ${conversion.stderr.toString().trim().slice(0, 512)}`);
  }
  const produced = Bun.file(input.output);
  if (!await produced.exists() || produced.size !== source.bytes || sha256Hex(await produced.bytes()) !== source.sha256) {
    await rm(input.output, { force: true });
    throw new Error("BEAM canonical JSON does not match its pinned digest; the converted file was discarded.");
  }
}

export async function fetchDataset(name: DatasetName): Promise<string> {
  const source = DATASETS[name];
  const path = datasetPath(name);
  if (await Bun.file(path).exists()) {
    await loadDataset(name);
    return path;
  }
  if (name === "beam") {
    await acquireBeam(path);
    return path;
  }
  let bytes: Uint8Array;
  if (name === "locomo") {
    const response = Bun.spawnSync(["gh", "api", "-H", "Accept: application/vnd.github.raw+json",
      `repos/snap-research/locomo/contents/data/locomo10.json?ref=${source.revision}`],
    { stdout: "pipe", stderr: "pipe", timeout: 180_000 });
    if (response.exitCode !== 0) throw new Error("LoCoMo download via gh failed; check GitHub access.");
    bytes = response.stdout;
  } else {
    bytes = await downloadBounded(source.url, source.bytes);
  }
  if (bytes.length !== source.bytes || sha256Hex(bytes) !== source.sha256) throw new Error("Dataset checksum mismatch.");
  await writeNew(path, bytes);
  return path;
}

/** The authenticated, still unparsed cached dataset document; callers parse it with the dataset's own parser. */
export async function loadDatasetValue(name: DatasetName): Promise<unknown> {
  const file = Bun.file(datasetPath(name));
  const source = DATASETS[name];
  if (!await file.exists()) throw new Error(`Dataset is not cached; run bench:memory fetch --dataset ${name}.`);
  const stale = `delete ${displayPath(datasetPath(name))} and run bench:memory fetch --dataset ${name} again`;
  if (file.size !== source.bytes) throw new Error(`Cached dataset byte size does not match its pinned source; ${stale}.`);
  const bytes = await file.bytes();
  if (sha256Hex(bytes) !== source.sha256) throw new Error(`Cached dataset checksum mismatch; ${stale}.`);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function parseDataset(name: DatasetName, value: unknown): Dataset {
  return name === "locomo" ? parseLocomo(value) : name === "beam" ? parseBeam(value) : parseLongMemEval(value);
}

export async function loadDataset(name: DatasetName): Promise<Dataset> {
  return parseDataset(name, await loadDatasetValue(name));
}

export function excludeGroups(dataset: Dataset, groups: ReadonlySet<string>): Dataset {
  const corpora = dataset.corpora.filter((corpus) => !groups.has(corpus.groupId));
  const ids = new Set(corpora.map((corpus) => corpus.id));
  const questions = dataset.questions.filter((question) => ids.has(question.corpusId));
  if (corpora.length === 0 || questions.length === 0) throw new Error("No untouched question families remain after exclusions.");
  return { corpora, questions };
}

export function priorReportGroups(value: unknown, name: DatasetName): readonly string[] {
  if (!isPlainRecord(value) || value.protocol !== "oh.memory-benchmark.v1" || !isPlainRecord(value.manifest)
    || value.manifest.dataset !== name || !isPlainRecord(value.manifest.source)
    || value.manifest.source.sha256 !== DATASETS[name].sha256 || !Array.isArray(value.manifest.selectedCorpora)
    || value.manifest.selectedCorpora.length > 20_000
    || value.manifest.selectedCorpora.some((id) => typeof id !== "string" || id.length < 1 || id.length > 512)) {
    throw new TypeError("Exclusions require a selection report for the same pinned dataset.");
  }
  return [...new Set((value.manifest.selectedCorpora as string[]).map((id) => name === "locomo" ? id : id.replace(/_abs$/, "")))];
}

export async function loadExclusions(paths: readonly string[], name: DatasetName) {
  if (paths.length > 32) throw new RangeError("Too many exclusion reports.");
  const groups = new Set<string>();
  const reports: { sha256: string; groups: number }[] = [];
  for (const path of paths) {
    const file = Bun.file(path);
    if (!await file.exists() || file.size > 64 * 1024 * 1024) throw new Error("Exclusion report must be at most 64 MiB.");
    const bytes = await file.bytes();
    const selected = priorReportGroups(JSON.parse(new TextDecoder().decode(bytes)), name);
    selected.forEach((group) => groups.add(group));
    reports.push({ sha256: sha256Hex(bytes), groups: selected.length });
  }
  return { groups, reports };
}

export async function codeIdentity() {
  const files = ["package.json", "bun.lock", "tsconfig.json", "tsconfig.scripts.json", "scripts/benchmark-memory.ts"];
  const visit = async (directory: string) => {
    for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  };
  await visit("src");
  await visit("scripts/benchmarks");
  const entries = await Promise.all(files.sort().map(async (path) => ({ path, sha256: sha256Hex(await readFile(join(ROOT, path))) })));
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT });
  const status = Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=normal"], { cwd: ROOT });
  const node = Bun.spawnSync(["node", "--version"], { cwd: ROOT });
  if (head.exitCode !== 0 || status.exitCode !== 0) throw new Error("Cannot fingerprint the benchmark checkout.");
  return { sourceSha256: canonicalSha256(entries), gitHead: head.stdout.toString().trim(),
    dirty: status.stdout.length > 0, bun: Bun.version, node: node.exitCode === 0 ? node.stdout.toString().trim() : null,
    bunNodeCompatibility: process.versions.node, platform: process.platform, architecture: process.arch, files: entries };
}

export function displayPath(path: string): string {
  return relative(ROOT, resolve(path));
}
