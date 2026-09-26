/** The CLI's shortening of Oh's one-line description. Help shows it once. */
export const OH_CLI_TAGLINE = "Open-source memory for agents";

/** Compact ASCII identity for interactive root help; never command output. */
export function terminalIntro(terminal: Readonly<{ isTTY: boolean | undefined; columns: number | undefined; term: string | undefined }>): string {
  if (terminal.isTTY !== true || terminal.term === "dumb" || (terminal.columns ?? 80) < 48) return "";
  return `  .----.\n / .--. \\    oh\n| |    | |   ${OH_CLI_TAGLINE}\n \\ '--' /\n  '----'\n\n`;
}
