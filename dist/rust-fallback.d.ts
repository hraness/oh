/**
 * Shared bounded fallback diagnostics for hosts that prefer a Rust engine and
 * keep a TypeScript implementation as the authoritative fallback.
 *
 * Notices are deduplicated per surface tag, capped at a small fixed budget per
 * process, sanitized to closed ASCII fields, and written to stderr without ever
 * throwing. Raw exception text, input content, paths, URLs, and secrets never
 * cross this boundary: callers pass only bounded reason classes and optional
 * input classifications.
 */
export type OhRustFallbackNotice = Readonly<{
    /**
     * Stable surface tag identifying the engine path that fell back, for example
     * "oh-canonical-rust-fallback" or "oh-archive-rust-fallback".
     */
    tag: string;
    /** Bounded reason class, for example "load-failed" or "evaluate-failed". */
    reason: string;
    /** Optional bounded input classification, for example "object" or "array". */
    inputClass?: string;
}>;
/**
 * Emit a non-fatal stderr notice that a Rust engine path fell back to the
 * TypeScript implementation. At most {@link MAX_FALLBACK_NOTICES_PER_TAG}
 * distinct notices are emitted per tag per process; repeated or excess
 * notices are dropped silently.
 */
export declare function emitOhRustFallback(notice: OhRustFallbackNotice): void;
//# sourceMappingURL=rust-fallback.d.ts.map