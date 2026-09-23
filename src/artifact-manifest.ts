import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Typed reader for `dist/rust-artifacts/manifest.json`, the generated
 * compatibility manifest describing every Rust artifact shipped in this
 * package: stable engine identity, ABI contract identity, artifact digest,
 * input bound, and supported target.
 *
 * Hosts may use the manifest to verify that an artifact they are about to
 * load is the exact reviewed build they expect, and to select a sidecar
 * binary for their platform.
 */

export type OhRustArtifactKind = "wasm-pack" | "cargo-wasm" | "cargo-native";

export type OhRustArtifactEntry = Readonly<{
  /** Stable semantic engine identity, for example "oh.canonical.rust.v1". */
  engine: string;
  /** ABI contract identity, for example "oh.canonical-raw-abi.v1". */
  abi: string;
  /** Source crate name, for example "oh-canonical-raw-wasm". */
  crate: string;
  /** How the artifact was produced. */
  kind: OhRustArtifactKind;
  /** Target triple or "wasm32" for portable WASM. */
  target: string;
  /** Files shipped for this entry, relative to `dist/rust-artifacts/`. */
  files: readonly string[];
  /** Primary artifact file relative to `dist/rust-artifacts/`; `sha256` covers it. */
  primary: string;
  /** SHA-256 hex digest of the primary artifact bytes. */
  sha256: string;
  /** Byte length of the primary artifact. */
  bytes: number;
  /**
   * Maximum single-input bytes the ABI accepts, or `null` when the ABI does
   * not bound the input itself (callers or per-request budgets still apply).
   */
  maxInputBytes: number | null;
}>;

export type OhRustArtifactManifest = Readonly<{
  version: 1;
  artifacts: readonly OhRustArtifactEntry[];
}>;

const IDENTITY = /^[a-z0-9][a-z0-9._-]{0,126}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const RELATIVE_FILE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u;
const MAX_ARTIFACTS = 64;
const MAX_FILES = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function parseFiles(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) return null;
  const files: string[] = [];
  for (const item of value) {
    const file = boundedString(item, RELATIVE_FILE);
    if (file === null || file.includes("..") || isAbsolute(file)) return null;
    files.push(file);
  }
  return files;
}

function parseEntry(value: unknown): OhRustArtifactEntry | null {
  if (!isRecord(value)) return null;
  const engine = boundedString(value.engine, IDENTITY);
  const abi = boundedString(value.abi, IDENTITY);
  const crate = boundedString(value.crate, IDENTITY);
  const kind = value.kind;
  const target = boundedString(value.target, IDENTITY);
  const files = parseFiles(value.files);
  const primary = boundedString(value.primary, RELATIVE_FILE);
  const sha256 = boundedString(value.sha256, SHA256_HEX);
  const bytes = value.bytes;
  const maxInputBytes = value.maxInputBytes;
  if (
    engine === null || abi === null || crate === null || target === null
    || files === null || primary === null || sha256 === null
    || (kind !== "wasm-pack" && kind !== "cargo-wasm" && kind !== "cargo-native")
    || !files.includes(primary)
    || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 1
    || !(maxInputBytes === null
      || (typeof maxInputBytes === "number" && Number.isSafeInteger(maxInputBytes) && maxInputBytes >= 1))
  ) return null;
  return Object.freeze({
    engine, abi, crate, kind, target, files, primary, sha256, bytes,
    maxInputBytes: maxInputBytes as number | null,
  });
}

/** Parse a manifest value from `unknown`; returns `null` on any violation. */
export function parseOhRustArtifactManifest(value: unknown): OhRustArtifactManifest | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.artifacts)) return null;
  if (value.artifacts.length < 1 || value.artifacts.length > MAX_ARTIFACTS) return null;
  const artifacts: OhRustArtifactEntry[] = [];
  const identities = new Set<string>();
  for (const item of value.artifacts) {
    const entry = parseEntry(item);
    if (entry === null) return null;
    const identity = `${entry.abi}\0${entry.target}\0${entry.primary}`;
    if (identities.has(identity)) return null;
    identities.add(identity);
    artifacts.push(entry);
  }
  return Object.freeze({ version: 1, artifacts: Object.freeze(artifacts) });
}

function manifestPath(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(modulePath);
  const base = moduleDir.endsWith("/src") || moduleDir.endsWith("\\src")
    ? resolve(moduleDir, "..", "dist")
    : moduleDir;
  return resolve(base, "rust-artifacts", "manifest.json");
}

/**
 * Load the generated artifact manifest shipped in this package, or `null`
 * when the package was installed without built Rust artifacts or the file
 * fails validation.
 */
export async function loadOhRustArtifactManifest(): Promise<OhRustArtifactManifest | null> {
  try {
    const text = await readFile(manifestPath(), "utf8");
    if (text.length > 1_048_576) return null;
    return parseOhRustArtifactManifest(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Look up the manifest entry for one engine ABI and target. */
export function findOhRustArtifact(
  manifest: OhRustArtifactManifest,
  abi: string,
  target?: string,
): OhRustArtifactEntry | null {
  for (const entry of manifest.artifacts) {
    if (entry.abi === abi && (target === undefined || entry.target === target)) return entry;
  }
  return null;
}
