import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { canonicalSha256, isPlainRecord, sha256Hex } from "../../src/canonical";
import { DATASETS, parseLocomo, parseLongMemEval, type Dataset, type DatasetName } from "./datasets";

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

export async function fetchDataset(name: DatasetName): Promise<string> {
  const source = DATASETS[name];
  const path = datasetPath(name);
  if (await Bun.file(path).exists()) {
    await loadDataset(name);
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
    const response = await fetch(source.url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || response.body === null) throw new Error(`Dataset download failed (HTTP ${response.status}).`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.length;
        if (total > source.bytes) throw new RangeError("Dataset download exceeded its pinned byte size.");
        chunks.push(next.value);
      }
    } finally { await reader.cancel(); }
    bytes = Buffer.concat(chunks, total);
  }
  if (bytes.length !== source.bytes || sha256Hex(bytes) !== source.sha256) throw new Error("Dataset checksum mismatch.");
  await writeNew(path, bytes);
  return path;
}

export async function loadDataset(name: DatasetName) {
  const file = Bun.file(datasetPath(name));
  const source = DATASETS[name];
  if (!await file.exists()) throw new Error(`Dataset is not cached; run bench:memory fetch --dataset ${name}.`);
  if (file.size !== source.bytes) throw new Error("Cached dataset byte size does not match its pinned source.");
  const bytes = await file.bytes();
  if (sha256Hex(bytes) !== source.sha256) throw new Error("Cached dataset checksum mismatch.");
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return name === "locomo" ? parseLocomo(value) : parseLongMemEval(value);
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
