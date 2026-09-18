import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

/**
 * Generate `dist/rust-artifacts/manifest.json`, the compatibility manifest
 * consumed by `@hraness/oh/artifact-manifest`. Run after the artifacts have
 * been built (and, in the release workflow, after every native sidecar has
 * been staged) so the manifest digests describe the exact shipped bytes.
 */

const root = resolve(import.meta.dir, "..");
const outDir = resolve(root, "dist", "rust-artifacts");

type WasmContract = Readonly<{
  crate: string;
  engine: string;
  abi: string;
  kind: "wasm-pack" | "cargo-wasm";
  primary: string;
  maxInputBytes: number | null;
}>;

const WASM_ARTIFACTS: readonly WasmContract[] = [
  {
    crate: "oh-canonical-wasm",
    engine: "oh.canonical.rust.v1",
    abi: "oh.canonical-bindgen-abi.v1",
    kind: "wasm-pack",
    primary: "oh-canonical-wasm/oh_canonical_wasm_bg.wasm",
    maxInputBytes: null,
  },
  {
    crate: "oh-canonical-raw-wasm",
    engine: "oh.canonical.rust.v1",
    abi: "oh.canonical-raw-abi.v1",
    kind: "cargo-wasm",
    primary: "oh-canonical-raw-wasm/oh_canonical_raw_wasm.wasm",
    maxInputBytes: 16 * 1024 * 1024,
  },
  {
    crate: "oh-archive-wasm",
    engine: "oh.archive.rust.v1",
    abi: "oh.archive-bindgen-abi.v1",
    kind: "wasm-pack",
    primary: "oh-archive-wasm/oh_archive_wasm_bg.wasm",
    maxInputBytes: null,
  },
  {
    crate: "oh-archive-strict-wasm",
    engine: "oh.archive.strict.rust.v1",
    abi: "oh.archive-strict-abi.v1",
    kind: "cargo-wasm",
    primary: "oh-archive-strict-wasm/oh_archive_strict_wasm.wasm",
    maxInputBytes: 512 * 1024 * 1024,
  },
  {
    crate: "oh-datalog-wasm",
    engine: "oh.projection.rust.v1",
    abi: "oh.projection-bindgen-abi.v1",
    kind: "wasm-pack",
    primary: "oh-datalog-wasm/oh_datalog_wasm_bg.wasm",
    maxInputBytes: null,
  },
];

const SQLITE_CONTRACT = {
  crate: "oh-sqlite-cli",
  engine: "oh.sqlite.rust.v1",
  abi: "oh.sqlite-sidecar-abi.v1",
  kind: "cargo-native",
  maxInputBytes: null,
} as const;

async function listFiles(dir: string): Promise<string[]> {
  const names = await readdir(dir);
  const files: string[] = [];
  for (const name of names) {
    const path = join(dir, name);
    if ((await stat(path)).isFile()) files.push(relative(outDir, path).split("\\").join("/"));
  }
  return files.sort();
}

async function hashFile(path: string): Promise<{ sha256: string; bytes: number }> {
  const bytes = await readFile(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

export async function buildRustArtifactManifest(): Promise<number> {
  const artifacts: Record<string, unknown>[] = [];

  for (const contract of WASM_ARTIFACTS) {
    const primaryPath = resolve(outDir, contract.primary);
    if (!(await stat(primaryPath)).isFile()) {
      throw new Error(`Missing Rust artifact ${contract.primary}; run bun run rust:build:artifacts first.`);
    }
    const { sha256, bytes } = await hashFile(primaryPath);
    const files = await listFiles(resolve(outDir, contract.crate));
    artifacts.push({
      engine: contract.engine,
      abi: contract.abi,
      crate: contract.crate,
      kind: contract.kind,
      target: "wasm32",
      files,
      primary: contract.primary,
      sha256,
      bytes,
      maxInputBytes: contract.maxInputBytes,
    });
  }

  const sqliteRoot = resolve(outDir, "oh-sqlite");
  const targets = (await readdir(sqliteRoot).catch(() => [] as string[])).sort();
  for (const target of targets) {
    const primary = `oh-sqlite/${target}/${SQLITE_CONTRACT.crate}`;
    const primaryPath = resolve(outDir, primary);
    if (!(await stat(primaryPath).catch(() => null))?.isFile()) continue;
    const { sha256, bytes } = await hashFile(primaryPath);
    const files = await listFiles(resolve(sqliteRoot, target));
    artifacts.push({
      engine: SQLITE_CONTRACT.engine,
      abi: SQLITE_CONTRACT.abi,
      crate: SQLITE_CONTRACT.crate,
      kind: SQLITE_CONTRACT.kind,
      target,
      files,
      primary,
      sha256,
      bytes,
      maxInputBytes: SQLITE_CONTRACT.maxInputBytes,
    });
  }

  const manifest = JSON.stringify({ version: 1, artifacts }, null, 2) + "\n";
  await writeFile(resolve(outDir, "manifest.json"), manifest);
  return artifacts.length;
}

if (import.meta.main) {
  const count = await buildRustArtifactManifest();
  console.log(`Wrote rust artifact manifest with ${count} entries.`);
}
