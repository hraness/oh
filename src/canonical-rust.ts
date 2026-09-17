import { canonicalJson, canonicalSha256 } from "./canonical";

export type CanonicalRustTextEngine = Readonly<{
  /** Canonicalize a JSON text string. */
  canonicalJson(text: string): string;
  /** SHA-256 hex digest of the canonical JSON form of `text`. */
  canonicalSha256(text: string): string;
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

async function loadWasmModule(): Promise<WasmModule | null> {
  try {
    // Dynamic import with a computed URL so TypeScript does not try to
    // resolve the wasm-pack output at compile time (it lives outside `src/`).
    const url = new URL("../rust/oh-canonical-wasm/pkg/oh_canonical_wasm.js", import.meta.url);
    const wasm = (await import(url.href)) as WasmModule;
    const wasmBinaryUrl = new URL("../rust/oh-canonical-wasm/pkg/oh_canonical_wasm_bg.wasm", import.meta.url);
    const buffer = await Bun.file(wasmBinaryUrl).arrayBuffer();
    wasm.initSync({ module: buffer });
    return wasm;
  } catch {
    return null;
  }
}

/** Load the Rust WASM canonical-JSON text engine, falling back to TS. */
export async function loadCanonicalRustTextEngine(): Promise<CanonicalRustTextEngine> {
  const wasm = await loadWasmModule();
  if (wasm === null) {
    return {
      canonicalJson: (text) => canonicalJson(JSON.parse(text)),
      canonicalSha256: (text) => canonicalSha256(JSON.parse(text)),
    };
  }
  return {
    canonicalJson: (text) => decodeString(wasm.canonical_json(text)),
    canonicalSha256: (text) => decodeString(wasm.canonical_sha256(text)),
  };
}
