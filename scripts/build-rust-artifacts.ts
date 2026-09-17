import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { $ } from "bun";

const root = resolve(import.meta.dir, "..");
const outDir = resolve(root, "dist", "rust-artifacts");

// Ensure rustup-managed toolchains take precedence over any system/Homebrew
// Rust installation that may lack the wasm32 target.
const cargoBin = `${process.env.HOME ?? ""}/.cargo/bin`;
process.env.PATH = `${cargoBin}:${process.env.PATH ?? ""}`;

type Artifact = {
  readonly crate: string;
  readonly kind: "wasm-pack" | "cargo-wasm";
  readonly sourceFiles?: readonly string[];
  readonly cargoTarget?: string;
};

const artifacts: readonly Artifact[] = [
  { crate: "oh-canonical-wasm", kind: "wasm-pack" },
  { crate: "oh-canonical-raw-wasm", kind: "cargo-wasm", cargoTarget: "oh_canonical_raw_wasm.wasm" },
  { crate: "oh-archive-wasm", kind: "wasm-pack" },
  { crate: "oh-archive-strict-wasm", kind: "cargo-wasm", cargoTarget: "oh_archive_strict_wasm.wasm" },
  { crate: "oh-datalog-wasm", kind: "wasm-pack" },
];

async function copyWasmPack(crate: string) {
  const snake = crate.replace(/-/g, "_");
  const pkg = resolve(root, "rust", crate, "pkg");
  const target = resolve(outDir, crate);
  await mkdir(target, { recursive: true });
  const jsName = `${snake}.js`;
  const wasmName = `${snake}_bg.wasm`;
  for (const name of [jsName, wasmName]) {
    const source = resolve(pkg, name);
    const dest = resolve(target, name);
    await Bun.write(dest, Bun.file(source));
  }
}

async function copyCargoWasm(crate: string, cargoTarget: string) {
  const source = resolve(
    root,
    "rust",
    "target",
    "wasm32-unknown-unknown",
    "release",
    cargoTarget,
  );
  const target = resolve(outDir, crate);
  await mkdir(target, { recursive: true });
  const dest = resolve(target, cargoTarget);
  const bytes = await readFile(source);
  await writeFile(dest, bytes);
  const b64 = bytes.toString("base64");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const artifactPath = resolve(target, "artifact.ts");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 120) {
    lines.push(`  "${b64.slice(i, i + 120)}"`);
  }
  const joined = lines.join(" +\n");
  await writeFile(
    artifactPath,
    `/**
 * Generated: ${crate} raw-ABI WASM artifact, base64-encoded for portable embedding.
 * SHA-256: ${sha}
 * Rebuild: bun run rust:build:artifacts
 */
export const ${crate.toUpperCase().replace(/-/g, "_")}_WASM_SHA256 = "${sha}";
export const ${crate.toUpperCase().replace(/-/g, "_")}_WASM_BASE64 =\n${joined};\n`,
  );
}

async function build() {
  for (const artifact of artifacts) {
    if (artifact.kind === "wasm-pack") {
      const crateDir = resolve(root, "rust", artifact.crate);
      const result = await $`cd ${crateDir} && wasm-pack build --target web --out-dir pkg`.quiet();
      if (result.exitCode !== 0) {
        throw new Error(`wasm-pack build failed for ${artifact.crate}: ${result.stderr}`);
      }
      await copyWasmPack(artifact.crate);
    } else {
      const result = await $`cd ${resolve(root, "rust")} && cargo build --release --target wasm32-unknown-unknown -p ${artifact.crate}`.quiet();
      if (result.exitCode !== 0) {
        throw new Error(`cargo build failed for ${artifact.crate}: ${result.stderr}`);
      }
      await copyCargoWasm(artifact.crate, artifact.cargoTarget!);
    }
  }
}

await build();
