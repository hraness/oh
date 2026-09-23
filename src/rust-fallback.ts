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

const MAX_FALLBACK_TAGS = 32;
const MAX_FALLBACK_NOTICES_PER_TAG = 4;
const DIAGNOSTIC_FIELD = /^[A-Za-z0-9._-]{1,64}$/u;

const emittedNotices = new Map<string, Set<string>>();

function boundedField(value: string): string {
  return DIAGNOSTIC_FIELD.test(value) ? value : "other";
}

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
export function emitOhRustFallback(notice: OhRustFallbackNotice): void {
  const tag = boundedField(notice.tag);
  const reason = boundedField(notice.reason);
  const inputClass = notice.inputClass === undefined ? undefined : boundedField(notice.inputClass);
  const diagnostic = inputClass === undefined ? reason : `${reason}:${inputClass}`;

  let seen = emittedNotices.get(tag);
  if (seen === undefined) {
    if (emittedNotices.size >= MAX_FALLBACK_TAGS) return;
    seen = new Set<string>();
    emittedNotices.set(tag, seen);
  }
  if (seen.has(diagnostic) || seen.size >= MAX_FALLBACK_NOTICES_PER_TAG) return;
  seen.add(diagnostic);

  try {
    if (typeof process !== "undefined" && typeof process.stderr?.write === "function") {
      const detail = inputClass === undefined ? reason : `${reason} input=${inputClass}`;
      process.stderr.write(`[${tag}] ${detail}\n`);
    }
  } catch {
    // Fallback diagnostics are best-effort and never affect the engine path.
  }
}
