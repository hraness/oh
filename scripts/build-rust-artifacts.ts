import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { $ } from "bun";
import { buildRustArtifactManifest } from "./build-rust-manifest";

function hostPlatformArch(): { platform: string; arch: string; triple: string } {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === "darwin" && arch === "arm64") {
    return { platform: "darwin", arch: "arm64", triple: "aarch64-apple-darwin" };
  }
  if (platform === "darwin" && arch === "x64") {
    return { platform: "darwin", arch: "x64", triple: "x86_64-apple-darwin" };
  }
  if (platform === "linux" && arch === "x64") {
    return { platform: "linux", arch: "x64", triple: "x86_64-unknown-linux-gnu" };
  }
  throw new Error(`Unsupported host platform for sidecar build: ${platform}-${arch}`);
}

const root = resolve(import.meta.dir, "..");
const outDir = resolve(root, "dist", "rust-artifacts");

// Ensure rustup-managed toolchains take precedence over any system/Homebrew
// Rust installation that may lack the wasm32 target.
const cargoBin = `${process.env.HOME ?? ""}/.cargo/bin`;
process.env.PATH = `${cargoBin}:${process.env.PATH ?? ""}`;
process.env.RUSTFLAGS = `${process.env.RUSTFLAGS ?? ""} --remap-path-prefix=${root}=. --remap-path-prefix=${process.env.HOME ?? ""}/.cargo/registry/src/=/cargo-registry-src/ --remap-path-prefix=${process.env.HOME ?? ""}/.rustup/toolchains/=/rust-toolchains/ -C strip=symbols`.trim();

type Artifact = {
  readonly crate: string;
  readonly kind: "wasm-pack" | "cargo-wasm" | "cargo-native";
  readonly sourceFiles?: readonly string[];
  readonly cargoTarget?: string;
};

const artifacts: readonly Artifact[] = [
  { crate: "oh-canonical-wasm", kind: "wasm-pack" },
  { crate: "oh-canonical-raw-wasm", kind: "cargo-wasm", cargoTarget: "oh_canonical_raw_wasm.wasm" },
  { crate: "oh-archive-wasm", kind: "wasm-pack" },
  { crate: "oh-archive-strict-wasm", kind: "cargo-wasm", cargoTarget: "oh_archive_strict_wasm.wasm" },
  { crate: "oh-datalog-wasm", kind: "wasm-pack" },
  { crate: "oh-sqlite-cli", kind: "cargo-native" },
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
  const artifactPath = resolve(target, "artifact.js");
  const declarationPath = resolve(target, "artifact.d.ts");
  const constName = crate.toUpperCase().replace(/-/g, "_");
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
export const ${constName}_SHA256 = "${sha}";
export const ${constName}_BASE64 =\n${joined};\n`,
  );
  await writeFile(
    declarationPath,
    `/** Generated declaration for ${crate} raw-ABI WASM artifact. */
export const ${constName}_SHA256: string;
export const ${constName}_BASE64: string;\n`,
  );
}

async function copyCargoNative(crate: string) {
  const { platform, arch, triple } = hostPlatformArch();
  const source = resolve(root, "rust", "target", triple, "release", crate);
  const target = resolve(outDir, "oh-sqlite", `${platform}-${arch}`);
  await mkdir(target, { recursive: true });
  const dest = resolve(target, crate);
  await writeFile(dest, await readFile(source));
  await chmod(dest, 0o755);
  try {
    execFileSync("strip", [dest]);
  } catch {
    // Stripping is best-effort; some hosts may not have a compatible strip for the target.
  }
  const finalBytes = await readFile(dest);
  const sha = createHash("sha256").update(finalBytes).digest("hex");
  const manifestPath = resolve(target, "artifact.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      crate,
      platform,
      arch,
      triple,
      sha256: sha,
      bytes: finalBytes.length,
    }, null, 2) + "\n",
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
    } else if (artifact.kind === "cargo-wasm") {
      const result = await $`cd ${resolve(root, "rust")} && cargo build --release --target wasm32-unknown-unknown -p ${artifact.crate}`.quiet();
      if (result.exitCode !== 0) {
        throw new Error(`cargo build failed for ${artifact.crate}: ${result.stderr}`);
      }
      await copyCargoWasm(artifact.crate, artifact.cargoTarget!);
    } else {
      const { triple } = hostPlatformArch();
      const result = await $`cd ${resolve(root, "rust")} && cargo build --release --target ${triple} -p ${artifact.crate}`.quiet();
      if (result.exitCode !== 0) {
        throw new Error(`cargo build failed for ${artifact.crate} (${triple}): ${result.stderr}`);
      }
      await copyCargoNative(artifact.crate);
    }
  }
}

await build();
await buildRustArtifactManifest();
