/** Oh's one-line description from the portfolio registry, wrapped to 80 columns. */
export declare const OH_DESCRIPTION = "Oh is open-source memory for agents that stores each fact with its sources\nand every change in a history you can replay.";
export declare const OH_COMMANDS: readonly ["init", "put", "get", "list", "log", "search", "recall", "tombstone", "verify", "sync", "contract", "version", "research", "support", "help"];
export declare function bareScreen(version: string): string;
export declare function rootHelp(): string;
/** Per-command help, or undefined when `command` has none. */
export declare function commandHelp(command: string): string | undefined;
export declare const OH_HELP_TOPICS: readonly string[];
//# sourceMappingURL=cli-help.d.ts.map