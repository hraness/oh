import { canonicalJson, canonicalSha256 } from "./canonical";

export type CanonicalRustTextEngine = Readonly<{
  /** Canonicalize a JSON text string. */
  canonicalJson(text: string): string;
  /** SHA-256 hex digest of the canonical JSON form of `text`. */
  canonicalSha256(text: string): string;
  implementation: "rust-wasm" | "typescript";
}>;

type WasmModule = {
  canonical_json(text: string): string;
  canonical_sha256(text: string): string;
  initSync(input: { module: ArrayBufferView | ArrayBuffer }): void;
  default(input?: URL | ArrayBuffer | ArrayBufferView): Promise<unknown>;
};

function decodeString(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("canonical_json must return a string");
  return value;
}

async function tryLoadWasm(moduleUrl: URL, wasmUrl: URL): Promise<WasmModule | null> {
  try {
    const wasm = (await import(moduleUrl.href)) as WasmModule;
    const buffer = await Bun.file(wasmUrl).arrayBuffer();
    wasm.initSync({ module: buffer });
    return wasm;
  } catch {
    return null;
  }
}

async function loadWasmModule(): Promise<WasmModule | null> {
  // The built module sits in dist/, beside the packaged dist/rust-artifacts/.
  // From src/ in development, fall back to the source crate output.
  return (
    (await tryLoadWasm(
      new URL("./rust-artifacts/oh-canonical-wasm/oh_canonical_wasm.js", import.meta.url),
      new URL("./rust-artifacts/oh-canonical-wasm/oh_canonical_wasm_bg.wasm", import.meta.url),
    )) ??
    (await tryLoadWasm(
      new URL("../rust/oh-canonical-wasm/pkg/oh_canonical_wasm.js", import.meta.url),
      new URL("../rust/oh-canonical-wasm/pkg/oh_canonical_wasm_bg.wasm", import.meta.url),
    ))
  );
}

/** Load the Rust WASM canonical-JSON text engine, falling back to TS. */
export async function loadCanonicalRustTextEngine(): Promise<CanonicalRustTextEngine> {
  const wasm = await loadWasmModule();
  if (wasm === null) {
    return {
      canonicalJson: (text) => canonicalJson(JSON.parse(text)),
      canonicalSha256: (text) => canonicalSha256(JSON.parse(text)),
      implementation: "typescript",
    };
  }
  return {
    canonicalJson: (text) => decodeString(wasm.canonical_json(text)),
    canonicalSha256: (text) => decodeString(wasm.canonical_sha256(text)),
    implementation: "rust-wasm",
  };
}
