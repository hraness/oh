import type { SupportCommandOptions } from "@hraness/support-foundation/node";
/** Only the standalone executable changes its descendant audience. */
export declare function standaloneSupportEnvironment(): Readonly<Record<string, string | undefined>>;
export declare function runOhSupportCommand(args: readonly string[], options: SupportCommandOptions): Promise<number>;
/** The existing parser and completed exit status have already admitted the command. */
export declare function hasUsefulOhResult(args: readonly string[], exitCode: number): boolean;
export declare function showOhSupportInvitation(args: readonly string[], exitCode: number, options: SupportCommandOptions): Promise<void>;
//# sourceMappingURL=support.d.ts.map