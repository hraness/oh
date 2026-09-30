#!/usr/bin/env bun
export { OH_PACKAGE_VERSION } from "./cli-version";
/** A problem with how the command was typed: exit 2 and point at the command's help. */
export declare class OhUsageError extends TypeError {
    readonly next?: string | undefined;
    constructor(message: string, next?: string | undefined);
}
/** A failure with a known next step, such as a missing record (exit 3) or store (exit 1). */
export declare class OhCliError extends Error {
    readonly code: string;
    readonly next: string;
    readonly exitCode: number;
    constructor(message: string, code: string, next: string, exitCode: number);
}
export declare function runOhCli(arguments_: readonly string[]): Promise<number>;
type DescribedError = Readonly<{
    code: string;
    exitCode: number;
    message: string;
    next: string;
}>;
/** One sentence, one next command and an exit status for any error (SPEC § D5). */
export declare function describeOhCliError(error: unknown, arguments_: readonly string[]): DescribedError;
/** The support command prefix: `oh` when the first `oh` on PATH runs this file, else the full path. */
export declare function supportCommandPrefix(script?: string, path?: string): string[];
export declare function runOhMain(): Promise<void>;
//# sourceMappingURL=cli.d.ts.map