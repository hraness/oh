import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function run(cwd: string, ...args: string[]) {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "cli.ts"), "research", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited,
    new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr };
}
async function root() {
  const dir = await mkdtemp(join(tmpdir(), "oh-research-cli-")); roots.push(dir); return dir;
}

test("offline CLI prepares and verifies source identities without opening a store", async () => {
  const dir = await root();
  const catalog = await run(dir, "catalog");
  expect(catalog.code).toBe(0);
  expect((JSON.parse(catalog.stdout) as { schemas: unknown[] }).schemas).toHaveLength(182);
  const value = { entityId: `kent_${"a".repeat(24)}`, identityOperationId: "identity.bootstrap",
    identityRevision: 1, redirectEntityId: null, state: "active", v: 1 };
  await writeFile(join(dir, "source.json"), JSON.stringify({ records: [{ kind: "entity", value }] }));
  const prepared = await run(dir, "prepare-packet", "--file", "source.json");
  expect(prepared.code).toBe(0);
  const packet = JSON.parse(prepared.stdout);
  expect(packet.records[0].value.source.value).toEqual(value);
  await writeFile(join(dir, "packet.json"), prepared.stdout);
  expect(await run(dir, "verify-packet", "--file", "packet.json")).toEqual(prepared);
  packet.records[0].dependencies = ["entity:forged"];
  await writeFile(join(dir, "forged.json"), JSON.stringify(packet));
  const rejected = await run(dir, "verify-packet", "--file", "forged.json");
  expect(rejected.code).not.toBe(0); expect(rejected.stdout).toBe("");
  expect(existsSync(join(dir, ".oh"))).toBe(false);
});

test("offline CLI rejects unknown options, oversized files and symlinks before processing", async () => {
  const dir = await root();
  await writeFile(join(dir, "source.json"), "{}");
  await symlink("source.json", join(dir, "link.json"));
  await writeFile(join(dir, "large.json"), "");
  await truncate(join(dir, "large.json"), 16 * 1024 * 1024 + 1);
  for (const args of [["catalog", "--db", "unexpected.sqlite"],
    ["verify-packet", "--file", "large.json"], ["verify-packet", "--file", "link.json"],
    ["validate-draft", "--file", "source.json"], ["verify-packet", "--file", "."]]) {
    const result = await run(dir, ...args);
    expect(result.code).not.toBe(0); expect(result.stdout).toBe("");
  }
  expect(existsSync(join(dir, "unexpected.sqlite"))).toBe(false);
  expect(existsSync(join(dir, ".oh"))).toBe(false);
});
