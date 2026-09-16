import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { OH_PACKAGE_VERSION } from "./cli";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hasUsefulOhResult } from "./support";

const entry = resolve(import.meta.dir, "cli.ts");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "oh-support-"));
  const env = { HOME: root, XDG_STATE_HOME: join(root, "state"), HRANESS_SUPPORT_EMAIL: "off", PATH: process.env.PATH ?? "/usr/bin:/bin", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  const run = async (args: string[], extra: Record<string, string> = {}, source = entry) => {
    const child = Bun.spawn([process.execPath, source, ...args], { cwd: root, env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  };
  return { root, run, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("explicit support is available before a database and returns its actual executable prefix", async () => {
  const f = await fixture();
  try {
    const result = await f.run(["support", "protocol", "--json"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const protocol = JSON.parse(result.stdout);
    expect(protocol.offer.product.id).toBe("oh-computer");
    expect(protocol.offer.actions.map((action: { kind: string }) => action.kind)).toEqual(["support"]);
    expect(protocol.commands.protocol).toEqual([process.execPath, entry, "support", "protocol", "--json"]);
    expect(await access(join(f.root, ".oh")).then(() => true, () => false)).toBe(false);
    expect(await access(join(f.root, "state")).then(() => true, () => false)).toBe(false);
  } finally { await f.cleanup(); }
});

test("useful standalone output is unchanged and shared shown acknowledgement controls cadence", async () => {
  const f = await fixture();
  try {
    const quiet = await f.run(["init"], { HRANESS_SUPPORT_AUDIENCE: "off" });
    const first = await f.run(["init"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toBe(quiet.stdout);
    expect(quiet.stderr).toBe("");
    expect(JSON.parse(first.stderr)).toMatchObject({ schemaVersion: "hraness-support-discovery-v1", protocol: [process.execPath, entry, "support", "protocol", "--json"] });
    expect((await f.run(["init"])).stderr).toBe("");
    const offer = JSON.parse((await f.run(["support", "offer", "--json"])).stdout);
    expect(offer.kind).toBe("offer");
    expect(offer.invitation.emailSuggestion).toBeUndefined();
    expect(JSON.parse((await f.run(["support", "shown", offer.invitation.id])).stdout).kind).toBe("shown");
    expect(JSON.parse((await f.run(["support", "offer", "--json"])).stdout).kind).toBe("quiet");
  } finally { await f.cleanup(); }
});

test("CI, off, probes, errors and imported runners remain quiet", async () => {
  const f = await fixture();
  try {
    for (const env of [{ CI: "true" }, { HRANESS_SUPPORT_AUDIENCE: "off" }]) {
      expect((await f.run(["init"], env)).stderr).toBe("");
    }
    for (const args of [["help"], ["version"], ["contract"], ["verify"]]) expect((await f.run(args)).stderr).toBe("");
    const missing = await f.run(["get", "entity:missing"]);
    expect(missing.code).toBe(3);
    expect(missing.stderr).toBe("");
    const invalid = await f.run(["init", "--unknown"]);
    expect(invalid.code).not.toBe(0);
    expect(invalid.stderr).not.toContain("hraness-support");
    const imported = join(f.root, "imported.ts");
    await writeFile(imported, `import { runOhCli } from ${JSON.stringify(entry)}; process.exitCode=await runOhCli(["init"]); if(process.env.HRANESS_SUPPORT_AUDIENCE!=="agent")throw new Error("Imported CLI changed host policy");`);
    expect((await f.run([], { HRANESS_SUPPORT_AUDIENCE: "agent" }, imported)).stderr).toBe("");
    expect(await access(join(f.root, "state")).then(() => true, () => false)).toBe(false);
  } finally { await f.cleanup(); }
});

test("eligibility is restricted to successful useful operations", () => {
  for (const args of [["put"], ["get"], ["search"], ["recall"], ["sync", "import"], ["research", "prepare-packet"]]) {
    expect(hasUsefulOhResult(args, 0)).toBe(true);
    expect(hasUsefulOhResult(args, 1)).toBe(false);
  }
  for (const args of [[], ["help"], ["version"], ["verify"], ["contract"], ["research", "catalog-v7"], ["research", "verify-packet"], ["support"]]) expect(hasUsefulOhResult(args, 0)).toBe(false);
});


test("cold source probes do not load the optional support dependency", async () => {
  const f = await fixture();
  try {
    const sourceRoot = join(f.root, "cold-checkout");
    function copySource(from: string, to: string): void {
      mkdirSync(to, { recursive: true });
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        if (entry.isDirectory()) copySource(join(from, entry.name), join(to, entry.name));
        else if (entry.isFile()) copyFileSync(join(from, entry.name), join(to, entry.name));
        else throw new Error("Cold source fixture must contain regular source files");
      }
    }
    copySource(import.meta.dir, join(sourceRoot, "src"));
    copyFileSync(resolve(import.meta.dir, "../package.json"), join(sourceRoot, "package.json"));
    const coldEntry = join(sourceRoot, "src/cli.ts");
    const runCold = (args: string[]) => spawnSync(process.execPath, ["--no-install", "--no-env-file", coldEntry, ...args], {
      cwd: sourceRoot, encoding: "utf8", timeout: 5_000,
      env: { HOME: f.root, XDG_STATE_HOME: join(f.root, "state"), PATH: process.env.PATH,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", HRANESS_SUPPORT_EMAIL: "off" },
    });
    for (const args of [["--version"], ["version"], ["--help"], ["help"], ["contract"]]) {
      const result = runCold(args);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      if (args[0] === "--version" || args[0] === "version") expect(result.stdout).toBe(`${OH_PACKAGE_VERSION}\n`);
    }
    const invalid = runCold(["--version", "extra"]);
    expect(invalid.error).toBeUndefined();
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("version does not accept arguments or options");
    expect(await access(join(sourceRoot, "node_modules")).then(() => true, () => false)).toBe(false);
    expect(await access(join(f.root, "state")).then(() => true, () => false)).toBe(false);
  } finally { await f.cleanup(); }
});
