import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OH_PACKAGE_VERSION, supportCommandPrefix } from "./cli";
import { OH_HELP_TOPICS } from "./cli-help";

const CLI = join(import.meta.dir, "cli.ts");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oh-cli-ux-"));
  roots.push(root);
  return root;
}

type Result = { code: number; stderr: string; stdout: string };
async function oh(args: readonly string[], options: { cwd?: string; env?: Record<string, string> } = {}): Promise<Result> {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: options.cwd ?? import.meta.dir,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(), LANG: "en_US.UTF-8",
      HRANESS_AUDIENCE: "human", HRANESS_SUPPORT: "off", ...options.env },
    stderr: "pipe", stdout: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited,
    new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stderr, stdout };
}

const lines = (text: string) => text.trimEnd().split("\n");
const widest = (text: string) => Math.max(...lines(text).map((line) => line.length));

describe("oh help", () => {
  test("bare invocation is a short start screen", async () => {
    const result = await oh([]);
    expect(result).toEqual({ code: 0, stderr: "", stdout: `Oh is open-source memory for agents that stores each fact with its sources
and every change in a history you can replay.

Start here
  oh init                      Create a store in .oh/oh.sqlite
  oh put --kind entity --key entity:ada --value '{"name":"Ada"}'
                               Save a record
  oh get entity:ada            Print one record
  oh search Ada                Find records by keyword
  oh verify                    Replay the history and check the store

All commands: oh --help · Command help: oh help <command>
oh ${OH_PACKAGE_VERSION}
` });
    expect(lines(result.stdout).length).toBeLessThanOrEqual(25);
    expect(widest(result.stdout)).toBeLessThanOrEqual(80);
  });

  test("root help is grouped, short and free of research versions and inert modes", async () => {
    for (const flag of ["--help", "-h", "help"]) {
      const result = await oh([flag]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(lines(result.stdout)[0]).toBe("Usage: oh <command> [options]");
      expect(lines(result.stdout).length).toBeLessThanOrEqual(60);
      expect(widest(result.stdout)).toBeLessThanOrEqual(80);
      expect(result.stdout).not.toMatch(/catalog-v|semantic|hybrid|HRANESS_SUPPORT_AUDIENCE/u);
      expect(result.stdout).toContain("Optional support: oh support · Turn off: HRANESS_SUPPORT=off\n");
    }
  });

  test("every command has the same help from <command> --help, -h and help <command>", async () => {
    for (const topic of OH_HELP_TOPICS) {
      const forms = topic === "research" || topic === "sync"
        ? [[topic, "--help"], [topic, "-h"], ["help", topic]]
        : [[topic, "--help"], [topic, "-h"], ["help", topic], [topic, "extra", "--help"]];
      const outputs = await Promise.all(forms.map((args) => oh(args)));
      for (const result of outputs) {
        expect(result.code).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toStartWith("Usage: oh ");
        expect(result.stdout).toBe(outputs[0]!.stdout);
      }
      expect(widest(outputs[0]!.stdout)).toBeLessThanOrEqual(80);
    }
    expect((await oh(["research"])).stdout).toBe((await oh(["help", "research"])).stdout);
    expect((await oh(["help", "research"])).stdout).not.toMatch(/catalog-v2 /u);
  }, 120_000);

  test("put help lists every record kind", async () => {
    const result = await oh(["put", "--help"]);
    for (const kind of ["activity", "entity", "evidence", "vocabulary"]) expect(result.stdout).toContain(kind);
  });

  test("--version prints the name and version", async () => {
    for (const flag of ["--version", "-V", "version"]) {
      expect(await oh([flag])).toEqual({ code: 0, stderr: "", stdout: `oh ${OH_PACKAGE_VERSION}\n` });
    }
    expect(JSON.parse((await oh(["--version", "--json"])).stdout)).toEqual({ name: "oh", version: OH_PACKAGE_VERSION });
  });

  test("closing the pipe early exits quietly", async () => {
    const child = Bun.spawn(["/bin/sh", "-c", `"${process.execPath}" "${CLI}" --help | head -1`], {
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HRANESS_SUPPORT: "off" }, stderr: "pipe", stdout: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([child.exited,
      new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stderr, stdout }).toEqual({ code: 0, stderr: "", stdout: "Usage: oh <command> [options]\n" });
  });
});

describe("oh output", () => {
  test("people get sentences and one Next hint; agents and --json get JSON", async () => {
    const cwd = await scratch();
    const init = await oh(["init"], { cwd });
    expect(init).toEqual({ code: 0,
      stderr: `Next: oh put --kind entity --key entity:ada --value '{"name":"Ada"}'\n`,
      stdout: "✓ Store ready at .oh/oh.sqlite, space default, generation 0.\n" });
    expect(await oh(["put", "--kind", "entity", "--key", "entity:ada", "--value", '{"name":"Ada Lovelace"}'], { cwd }))
      .toEqual({ code: 0, stderr: "Next: oh get entity:ada\n", stdout: "✓ Saved entity:ada (generation 1).\n" });
    // `--json VALUE` still carries the value, as it did before --value.
    expect((await oh(["put", "--kind", "entity", "--key", "entity:bob", "--json", '{"name":"Bob"}',
      "--depends-on", "entity:ada"], { cwd })).stdout).toBe("✓ Saved entity:bob (generation 2).\n");
    expect((await oh(["get", "entity:bob"], { cwd })).stdout).toBe(`entity:bob (entity)
{
  "name": "Bob"
}
Depends on: entity:ada
`);
    expect((await oh(["list"], { cwd })).stdout).toBe("entity:ada  entity\nentity:bob  entity\n");
    expect((await oh(["log"], { cwd })).stdout).toMatch(
      /^#2 {2}\S+Z {2}agent\.local {2}put entity:bob\n#1 {2}\S+Z {2}agent\.local {2}put entity:ada\n$/u);
    expect((await oh(["search", "Lovelace"], { cwd })).stdout).toBe("1.  entity:ada  entity\n");
    expect((await oh(["search", "nobody"], { cwd })).stdout).toBe('No records match "nobody".\n');
    expect((await oh(["verify"], { cwd })).stdout)
      .toBe("✓ Store checked: 2 records and 2 changes replay to the same state (generation 2).\n");
    expect(await oh(["tombstone", "entity:bob"], { cwd })).toEqual({ code: 0, stderr: "",
      stdout: "✓ Removed entity:bob (generation 3). Its history stays in the log.\n" });

    const quiet = await oh(["init"], { cwd, env: { HRANESS_AUDIENCE: "quiet" } });
    expect(quiet).toEqual({ code: 0, stderr: "", stdout: "✓ Store ready at .oh/oh.sqlite, space default, generation 3.\n" });
    for (const env of [{ HRANESS_AUDIENCE: "agent" }, { HRANESS_AUDIENCE: "human" }]) {
      const listed = await oh(env.HRANESS_AUDIENCE === "agent" ? ["list"] : ["list", "--json"], { cwd, env });
      expect(listed.stderr).toBe("");
      expect(JSON.parse(listed.stdout).records.map((record: { key: string }) => record.key)).toEqual(["entity:ada"]);
    }
    const agentPut = await oh(["put", "--kind", "entity", "--key", "entity:cy", "--value", "{}", "--json"], { cwd });
    expect(JSON.parse(agentPut.stdout)).toMatchObject({ sequence: 4 });
  });

  test("an empty store says so", async () => {
    const cwd = await scratch();
    await oh(["init"], { cwd });
    expect(await oh(["list"], { cwd })).toEqual({ code: 0, stderr: "Next: oh put --help\n", stdout: "No records in space default.\n" });
    expect((await oh(["log"], { cwd })).stdout).toBe("No changes in space default yet.\n");
  });

  test("semantic and hybrid modes warn that the CLI has only keyword search", async () => {
    const cwd = await scratch();
    await oh(["init"], { cwd });
    expect((await oh(["search", "x", "--mode", "semantic"], { cwd })).stderr)
      .toBe("⚠ Semantic search isn't available in the CLI, so there are no results. Use keyword search instead.\n");
    expect((await oh(["search", "x", "--mode", "hybrid"], { cwd })).stderr)
      .toBe("⚠ Semantic search isn't available in the CLI; showing keyword results only.\n");
    expect((await oh(["search", "x", "--mode", "hybrid", "--json"], { cwd })).stderr).toBe("");
  });
});

describe("oh errors", () => {
  test("reads never create a store", async () => {
    const cwd = await scratch();
    for (const args of [["get", "entity:ada"], ["list"], ["log"], ["search", "Ada"], ["recall", "Ada"], ["verify"],
      ["tombstone", "entity:ada"], ["sync", "export"]]) {
      expect(await oh(args, { cwd }), args.join(" ")).toEqual({ code: 1, stdout: "",
        stderr: "✗ No Oh store at .oh/oh.sqlite.\n→ oh init\n" });
    }
    expect((await oh(["list", "--db", "other dir/x.db"], { cwd })).stderr)
      .toBe("✗ No Oh store at other dir/x.db.\n→ oh init --db 'other dir/x.db'\n");
    expect(existsSync(join(cwd, ".oh"))).toBe(false);
  });

  test("usage errors name the input, suggest a match and point at help", async () => {
    const cwd = await scratch();
    expect(await oh(["gte", "x"], { cwd })).toEqual({ code: 2, stdout: "",
      stderr: '✗ Unknown command "gte". Did you mean "get"?\n→ oh --help\n' });
    expect((await oh(["list", "--limt", "3"], { cwd })).stderr)
      .toBe('✗ Unknown option "--limt". Did you mean "--limit"?\n→ oh list --help\n');
    expect((await oh(["put", "--kind", "entty", "--key", "k", "--value", "1"], { cwd })).stderr)
      .toBe('✗ Unknown record kind "entty". Did you mean "entity"?\n→ oh put --help\n');
    expect((await oh(["put", "--kind", "entity", "--key", "k", "--value", "{nope"], { cwd })).stderr)
      .toBe("✗ The --value text isn't valid JSON.\n→ oh put --help\n");
    expect((await oh(["put", "--kind", "entity", "--key", "k", "--file", "missing.json"], { cwd })).stderr)
      .toBe("✗ No file at missing.json.\n→ oh put --help\n");
    expect((await oh(["help", "serch"], { cwd })).stderr).toBe('✗ No help for "serch". Did you mean "search"?\n→ oh --help\n');
    expect((await oh(["research", "catalog-v99"], { cwd })).stderr)
      .toBe('✗ Unknown research command "catalog-v99".\n→ oh research --help\n');
    expect(existsSync(join(cwd, ".oh"))).toBe(false);
  });

  test("--json and agents get one error object on stdout", async () => {
    const cwd = await scratch();
    const expected = { error: { code: "usage", message: 'Unknown command "gte". Did you mean "get"?', next: "oh --help" }, ok: false };
    for (const [args, env] of [[["gte", "--json"], {}], [["gte"], { HRANESS_AUDIENCE: "agent" }],
      [["gte"], { HRANESS_AUDIENCE: "", CLAUDECODE: "1" }]] as const) {
      const result = await oh(args, { cwd, env });
      expect(result.code).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual(expected);
    }
    const store = await oh(["get", "x", "--json"], { cwd });
    expect(JSON.parse(store.stdout)).toEqual({ error: { code: "no_store", message: "No Oh store at .oh/oh.sqlite.",
      next: "oh init" }, ok: false });
    // In put, `--json VALUE` is the record value, so the error stays text.
    expect((await oh(["put", "--kind", "entty", "--key", "k", "--json", "{}"], { cwd })).stderr).toStartWith("✗ Unknown record kind");
  });

  test("NO_COLOR, FORCE_COLOR and TERM=dumb", async () => {
    expect((await oh(["gte"], { env: { NO_COLOR: "1" } })).stderr).not.toContain("\x1b[");
    expect((await oh(["gte"], { env: { FORCE_COLOR: "1" } })).stderr).toStartWith("\x1b[31m✗\x1b[0m Unknown");
    expect((await oh(["gte"], { env: { TERM: "dumb" } })).stderr)
      .toBe('FAIL Unknown command "gte". Did you mean "get"?\n-> oh --help\n');
    expect((await oh(["gte"], { env: { LANG: "C" } })).stderr).toStartWith("FAIL ");
  });
});

describe("oh support command", () => {
  test("names oh when that name on PATH runs this file", async () => {
    const root = await scratch();
    const bin = join(root, "bin");
    await mkdir(bin);
    await symlink(CLI, join(bin, "oh"));
    const env = { PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`, HOME: root, XDG_STATE_HOME: join(root, "state"),
      HRANESS_SUPPORT: "", HRANESS_SUPPORT_EMAIL: "off" };
    const result = await oh(["support", "protocol", "--json"], { cwd: root, env });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).commands.protocol).toEqual(["oh", "support", "protocol", "--json"]);
  });
});

describe("oh support command prefix", () => {
  test("names oh only when the first oh on PATH is this script", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-prefix-"));
    roots.push(root);
    const [other, mine] = [join(root, "other"), join(root, "mine")];
    await Promise.all([mkdir(other), mkdir(mine)]);
    await symlink(join(import.meta.dir, "cli-help.ts"), join(other, "oh"));
    await symlink(CLI, join(mine, "oh"));
    expect(supportCommandPrefix(CLI, mine)).toEqual(["oh"]);
    expect(supportCommandPrefix(CLI, `${other}:${mine}`)).toEqual([process.execPath, CLI]);
    expect(supportCommandPrefix(CLI, `${join(root, "none")}:${mine}`)).toEqual(["oh"]);
  });
});
