// Terminal output rules shared by Hraness CLIs (SPEC § C audience, § D6 symbols).
// TODO(df-0.8): use detectAudience and the cli-style helpers from
// @hraness/desktop-foundation once 0.8.0 ships; this is a verbatim inline copy.

export type Audience = "human" | "agent" | "quiet";
export type Env = Readonly<Record<string, string | undefined>>;
export type Stream = { readonly isTTY?: boolean };

const AGENT_MARKERS = [
  "AI_AGENT",
  "CLAUDECODE",
  "CODEX_SANDBOX",
  "CODEX_SANDBOX_NETWORK_DISABLED",
  "CURSOR_AGENT",
  "GEMINI_CLI",
] as const;

/** HRANESS_AUDIENCE wins, then exact agent markers, then a TTY stderr means a person. */
export function detectAudience(env: Env = process.env, stderr: Stream = process.stderr): Audience {
  const forced = (env.HRANESS_AUDIENCE ?? "").trim().toLowerCase();
  if (forced === "human" || forced === "agent" || forced === "quiet") return forced;
  if (forced === "off") return "quiet";
  if (AGENT_MARKERS.some((marker) => (env[marker] ?? "") !== "")) return "agent";
  return stderr.isTTY === true ? "human" : "quiet";
}

/** ASCII fallbacks when the terminal can't be trusted with Unicode. */
export function useAscii(env: Env = process.env): boolean {
  if (env.HRANESS_ASCII === "1" || env.TERM === "dumb") return true;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return !/utf-?8/i.test(locale);
}

/** Color only on a TTY, never with TERM=dumb or a nonempty NO_COLOR; FORCE_COLOR=1 forces it. */
export function useColor(stream: Stream, env: Env = process.env): boolean {
  if (env.FORCE_COLOR === "1") return true;
  return stream.isTTY === true && env.TERM !== "dumb" && (env.NO_COLOR ?? "") === "";
}

export type SymbolName = "ok" | "fail" | "warn" | "next" | "on" | "off" | "skip" | "progress" | "notice";

const GLYPHS: Record<SymbolName, readonly [unicode: string, ascii: string, color: string | null]> = {
  ok: ["✓", "OK", "32"],
  fail: ["✗", "FAIL", "31"],
  warn: ["⚠", "WARN", "33"],
  next: ["→", "->", "2"],
  on: ["●", "*", "32"],
  off: ["○", "o", null],
  skip: ["–", "-", "2"],
  progress: ["↻", "...", null],
  notice: ["🔐", "NOTE", null],
};

/** One status symbol for `stream`; only the symbol is ever colored. */
export function sym(name: SymbolName, stream: Stream, env: Env = process.env): string {
  const [unicode, ascii, color] = GLYPHS[name];
  const glyph = useAscii(env) ? ascii : unicode;
  return color !== null && useColor(stream, env) ? `\x1b[${color}m${glyph}\x1b[0m` : glyph;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** The closest known name, if it is close enough to be a likely typo. */
export function closestMatch(input: string, known: readonly string[]): string | undefined {
  let best: { name: string; d: number } | undefined;
  for (const name of known) {
    const d = distance(input.toLowerCase(), name.toLowerCase());
    if (best === undefined || d < best.d) best = { name, d };
  }
  if (best === undefined) return undefined;
  if (best.name.startsWith(input) && input.length >= 3) return best.name;
  return best.d <= Math.max(2, Math.floor(best.name.length / 3)) ? best.name : undefined;
}

/** Two-line text error (SPEC § D5): `✗ what happened` then `→ next command`. */
export function formatError(message: string, next: string | undefined, stream: Stream = process.stderr, env: Env = process.env): string {
  const line = `${sym("fail", stream, env)} ${message}\n`;
  return next === undefined ? line : `${line}${sym("next", stream, env)} ${next}\n`;
}

/** A closed stdout pipe (`| head -1`) ends the program quietly. */
export function exitQuietlyOnClosedPipe(): void {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
}
