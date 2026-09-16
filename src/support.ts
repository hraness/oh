import { maybeShowSupportInvitation, runSupportCommand, type SupportCommandOptions } from "@hraness/support-foundation/node";
import { ohSupportProfile } from "./support-profile";

/** Only the standalone executable changes its descendant audience. */
export function standaloneSupportEnvironment(): Readonly<Record<string, string | undefined>> {
  const original = { ...process.env };
  process.env.HRANESS_SUPPORT_AUDIENCE = "off";
  return original;
}

export async function runOhSupportCommand(args: readonly string[], options: SupportCommandOptions): Promise<number> {
  const result = await runSupportCommand(ohSupportProfile, args, { gitEmail: false, ...options });
  if (result.stdout !== "") process.stdout.write(result.stdout);
  if (result.stderr !== "") process.stderr.write(result.stderr);
  return result.exitCode;
}

const usefulCommands = new Set(["init", "put", "get", "list", "log", "search", "recall", "tombstone"]);

/** The existing parser and completed exit status have already admitted the command. */
export function hasUsefulOhResult(args: readonly string[], exitCode: number): boolean {
  if (exitCode !== 0) return false;
  if (args[0] === "sync") return args[1] === "export" || args[1] === "import";
  if (args[0] === "research") return args[1] === "prepare-packet";
  return usefulCommands.has(args[0] ?? "");
}

export async function showOhSupportInvitation(args: readonly string[], exitCode: number, options: SupportCommandOptions): Promise<void> {
  if (!hasUsefulOhResult(args, exitCode)) return;
  try {
    await maybeShowSupportInvitation(ohSupportProfile, { usefulResult: true, gitEmail: false, ...options });
  } catch {
    // Optional support never changes a completed research command's result.
  }
}
