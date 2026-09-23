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
/** Parse a manifest value from `unknown`; returns `null` on any violation. */
export declare function parseOhRustArtifactManifest(value: unknown): OhRustArtifactManifest | null;
/**
 * Load the generated artifact manifest shipped in this package, or `null`
 * when the package was installed without built Rust artifacts or the file
 * fails validation.
 */
export declare function loadOhRustArtifactManifest(): Promise<OhRustArtifactManifest | null>;
/** Look up the manifest entry for one engine ABI and target. */
export declare function findOhRustArtifact(manifest: OhRustArtifactManifest, abi: string, target?: string): OhRustArtifactEntry | null;
//# sourceMappingURL=artifact-manifest.d.ts.map