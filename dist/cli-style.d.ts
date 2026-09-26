export type Audience = "human" | "agent" | "quiet";
export type Env = Readonly<Record<string, string | undefined>>;
export type Stream = {
    readonly isTTY?: boolean;
};
/** HRANESS_AUDIENCE wins, then exact agent markers, then a TTY stderr means a person. */
export declare function detectAudience(env?: Env, stderr?: Stream): Audience;
/** ASCII fallbacks when the terminal can't be trusted with Unicode. */
export declare function useAscii(env?: Env): boolean;
/** Color only on a TTY, never with TERM=dumb or a nonempty NO_COLOR; FORCE_COLOR=1 forces it. */
export declare function useColor(stream: Stream, env?: Env): boolean;
export type SymbolName = "ok" | "fail" | "warn" | "next" | "on" | "off" | "skip" | "progress" | "notice";
/** One status symbol for `stream`; only the symbol is ever colored. */
export declare function sym(name: SymbolName, stream: Stream, env?: Env): string;
/** The closest known name, if it is close enough to be a likely typo. */
export declare function closestMatch(input: string, known: readonly string[]): string | undefined;
/** Two-line text error (SPEC § D5): `✗ what happened` then `→ next command`. */
export declare function formatError(message: string, next: string | undefined, stream?: Stream, env?: Env): string;
/** A closed stdout pipe (`| head -1`) ends the program quietly. */
export declare function exitQuietlyOnClosedPipe(): void;
//# sourceMappingURL=cli-style.d.ts.map