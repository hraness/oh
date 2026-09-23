export type CanonicalRustTextEngine = Readonly<{
    /** Canonicalize a JSON text string. */
    canonicalJson(text: string): string;
    /** SHA-256 hex digest of the canonical JSON form of `text`. */
    canonicalSha256(text: string): string;
    implementation: "rust-wasm" | "typescript";
}>;
/** Load the Rust WASM canonical-JSON text engine, falling back to TS. */
export declare function loadCanonicalRustTextEngine(): Promise<CanonicalRustTextEngine>;
//# sourceMappingURL=canonical-rust.d.ts.map