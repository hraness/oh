#!/usr/bin/env bun
import { fileURLToPath } from "node:url";
import type { CliUpdateOptions, StartupResult } from "@hraness/cli-update";
import { OH_PACKAGE_VERSION } from "./cli-version";
import { ohUpdatePolicy } from "./cli-update-policy";

type EntryPorts = {
  update(options: CliUpdateOptions): Promise<StartupResult>;
  main(): Promise<void>;
};

export async function runOhEntrypoint(argv = process.argv.slice(2), ports: Partial<EntryPorts> = {}): Promise<void> {
  // The product renders its own command help; the updater sees an inert help request.
  const gateArgv = argv[0] === "update" && argv.slice(1).some(arg => arg === "--help" || arg === "-h")
    ? ["help", "update"] : argv;
  const update = await (ports.update ?? (async options => (await import("@hraness/cli-update")).runCliUpdate(options)))({
    packageName: "@hraness/oh", version: OH_PACKAGE_VERSION, binName: "oh",
    entrypoint: fileURLToPath(import.meta.url), argv: gateArgv,
    provider: { kind: "github", repository: "hraness/oh", assetName: "hraness-oh-{version}.tgz" },
    ...ohUpdatePolicy(gateArgv),
  });
  if (update.handled) { process.exitCode = update.exitCode; return; }
  try { await (ports.main ?? (async () => (await import("./cli")).runOhMain()))(); }
  finally { await update.release(); }
}

if (import.meta.main) await runOhEntrypoint();
