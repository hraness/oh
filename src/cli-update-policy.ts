/** Match only branches that return before opening a store or doing research. */
export function ohUpdatePolicy(argv: readonly string[]): { effectFree: boolean; offline: boolean } {
  const [command, ...rest] = argv;
  const help = (args: readonly string[]) => args.includes("--help") || args.includes("-h");
  const effectFree = command === undefined || ["help", "--help", "-h", "version", "--version", "-V"].includes(command)
    || (command === "research" ? rest.length === 0 || rest[0] === "help" || help(rest.slice(0, 1)) : help(rest));
  return { effectFree, offline: command === "research" };
}
