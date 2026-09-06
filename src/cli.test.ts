import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { canonicalJson, canonicalSha256 } from "./canonical";
import { createKnowledgeGraphRecordV1 } from "./graph";
import { createOhOperationV1 } from "./operation";
import { OhSqliteStore } from "./sqlite/store";
import { createOhSyncBundleV1, OH_SYNC_BUNDLE_MAX_BYTES_V1 } from "./sync";

const roots: string[] = [];
const CLI_PATH = join(import.meta.dir, "cli.ts");
const REPOSITORY_ROOT = join(import.meta.dir, "..");
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function run(arguments_: readonly string[], cwd = REPOSITORY_ROOT): Promise<{ code: number; stderr: string; stdout: string }> {
  const process_ = Bun.spawn([process.execPath, CLI_PATH, ...arguments_], { cwd,
    stderr: "pipe", stdout: "pipe" });
  const [code, stdout, stderr] = await Promise.all([process_.exited,
    new Response(process_.stdout).text(), new Response(process_.stderr).text()]);
  return { code, stderr, stdout };
}

describe("oh CLI", () => {
  test("loads the SDK only after a store command passes validation", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-cli-lazy-test-"));
    roots.push(root);
    const probe = `
      import { createRequire } from "node:module";
      import { dirname, sep } from "node:path";
      const require = createRequire(${JSON.stringify(CLI_PATH)});
      const effectRoot = dirname(require.resolve("effect/package.json")) + sep;
      const loaded = () => Object.keys(require.cache).some((path) => path.startsWith(effectRoot));
      const { runOhCli } = await import(${JSON.stringify(CLI_PATH)});
      if (loaded()) throw new Error("CLI import loaded Effect");
      for (const args of [["help"], ["version"], ["contract"]]) {
        if (await runOhCli(args) !== 0) throw new Error("Static command failed");
        if (loaded()) throw new Error("Static command loaded Effect");
      }
      let rejected = false;
      try { await runOhCli(["sync", "export", "--limit", "0"]); }
      catch (error) { if (!(error instanceof TypeError)) throw error; rejected = true; }
      if (!rejected || loaded()) throw new Error("Invalid command crossed the SDK boundary");
      // A real store command is also the positive control for the cache observer.
      if (await runOhCli(["init"]) !== 0 || !loaded()) {
        throw new Error("Store command did not load the runtime");
      }
    `;
    const child = Bun.spawn([process.execPath, "--eval", probe], {
      cwd: root, stderr: "pipe", stdout: "pipe",
    });
    const [code, stderr, stdout] = await Promise.all([
      child.exited, new Response(child.stderr).text(), new Response(child.stdout).text(),
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout).toContain('"spaceId":"default"');
    expect(existsSync(join(root, ".oh", "oh.sqlite"))).toBe(true);
  });

  test("initializes, writes, searches, and verifies one local database", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-cli-test-"));
    roots.push(root);
    const database = join(root, "oh.sqlite");
    expect(await run(["init", "--db", database])).toMatchObject({ code: 0, stderr: "" });
    const put = await run(["put", "--db", database, "--kind", "entity", "--key", "entity:ada",
      "--json", '{"name":"Ada Lovelace"}', "--operation", "op_cli"]);
    expect(put.code).toBe(0);
    expect(JSON.parse(put.stdout)).toMatchObject({ operationId: "op_cli", sequence: 1 });
    const search = await run(["search", "Ada", "--db", database]);
    expect(JSON.parse(search.stdout).results[0].record.key).toBe("entity:ada");
    const verify = await run(["verify", "--db", database]);
    expect(JSON.parse(verify.stdout)).toMatchObject({ operations: 1, records: 1, sqliteIntegrity: "ok" });
  });

  test("returns a distinct missing-record status", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-cli-test-"));
    roots.push(root);
    const result = await run(["get", "entity:missing", "--db", join(root, "oh.sqlite")]);
    expect(result.code).toBe(3);
    expect(result.stdout).toBe("");
  });

  test("rejects malformed and command-invalid input before opening a database", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-cli-invalid-test-"));
    roots.push(root);
    const database = join(root, "custom.sqlite");
    const malformedJson = join(root, "malformed.json");
    const malformedBundle = join(root, "malformed-bundle.json");
    await writeFile(malformedJson, "not-json", "utf8");
    await writeFile(malformedBundle, '{"v":1}', "utf8");
    const invalidInvocations: readonly (readonly string[])[] = [
      ["unknown"],
      ["help", "extra"],
      ["version", "--db", database],
      ["init", "extra"],
      ["init", "--dba", database],
      ["init", "--db", ""],
      ["init", "--db", database, "--spacee", "default"],
      ["init", "--db", database, "--space", "bad space"],
      ["get", "entity:ada", "--db", database, "--limit", "1"],
      ["get", "entity:ada", "--db", database, "--db", database],
      ["list", "--db", database, "--limit", "01"],
      ["list", "--db", database, "--limit", "0"],
      ["log", "--db", database, "--limit", "1001"],
      ["search", "Ada", "--db", database, "--mode", "remote"],
      ["search", "Ada", "--db", database, "--limit", "101"],
      ["put", "--kind", "unknown", "--key", "entity:ada", "--json", "{}"],
      ["put", "--kind", "entity", "--key", "bad key", "--json", "{}"],
      ["put", "--kind", "entity", "--key", "entity:ada", "--json", "{}", "--file", malformedJson],
      ["put", "--kind", "entity", "--key", "entity:ada", "--json", "not-json"],
      ["put", "--kind", "entity", "--key", "entity:ada", "--file", malformedJson],
      ["put", "--kind", "entity", "--key", "entity:ada", "--json", "{}", "--expected-generation", "+1"],
      ["sync", "import", "--file", malformedBundle],
      ["sync", "export", "--after", "-1"],
      ["sync", "export", "--limit", "0"],
    ];
    for (const invocation of invalidInvocations) {
      const result = await run(invocation, root);
      expect(result.code, invocation.join(" ")).toBe(1);
      expect(result.stderr, invocation.join(" ")).toStartWith("oh: ");
      expect(result.stdout, invocation.join(" ")).toBe("");
      expect(existsSync(join(root, ".oh")), invocation.join(" ")).toBe(false);
      expect(existsSync(database), invocation.join(" ")).toBe(false);
    }
  });

  test("serves the static contract without creating a default store", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-cli-contract-test-"));
    roots.push(root);
    const database = join(root, "contract.sqlite");
    const result = await run(["contract"], root);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      manifest: { contractId: "oh.ontology.v1" },
      sqliteSchemaVersion: 2,
      v: 1,
    });
    expect(existsSync(join(root, ".oh"))).toBe(false);
    expect((await run(["contract", "--db", database, "--space", "contract.test"], root)).code).toBe(0);
    expect(existsSync(database)).toBe(false);
  });

  test("imports a sync bundle atomically when a later operation is invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-cli-atomic-import-test-"));
    roots.push(root);
    const database = join(root, "target.sqlite");
    const bundlePath = join(root, "hostile-bundle.json");
    const source = new OhSqliteStore({ path: ":memory:" });
    const entity = (key: string, name: string) => createKnowledgeGraphRecordV1({
      dependencies: [], key, kind: "entity", v: 1, value: { name },
    });
    source.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: entity("entity:first", "First"), v: 1 }], expectedHead: source.head(),
    operationId: "op_first" });
    source.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: entity("entity:second", "Second"), v: 1 }], expectedHead: source.head(),
    operationId: "op_second" });
    const [first, second] = source.exportOperations();
    if (first === undefined || second === undefined) throw new Error("Expected two operations.");
    const { operationSha256: _operationSha256, ...payload } = second;
    const hostileSecond = createOhOperationV1({ ...payload,
      graphRevisionSha256: canonicalSha256("hostile graph revision"),
      recordsSha256: canonicalSha256("hostile records") });
    await writeFile(bundlePath,
      canonicalJson(createOhSyncBundleV1(source.spaceId, [first, hostileSecond])), "utf8");
    source.close();

    const imported = await run(["sync", "import", "--db", database, "--file", bundlePath]);
    expect(imported.code).toBe(1);
    expect(imported.stderr).toContain("does not reproduce");
    const verified = await run(["verify", "--db", database]);
    expect(verified.code).toBe(0);
    expect(JSON.parse(verified.stdout)).toMatchObject({ operations: 0, records: 0 });
  });

  test("rejects an oversized sparse sync bundle before opening the database", async () => {
    const root = await mkdtemp(join(tmpdir(), "oh-cli-bounded-import-test-"));
    roots.push(root);
    const database = join(root, "target.sqlite");
    const bundlePath = join(root, "oversized-bundle.json");
    await writeFile(bundlePath, "", "utf8");
    await truncate(bundlePath, OH_SYNC_BUNDLE_MAX_BYTES_V1 + 2);
    const imported = await run(["sync", "import", "--db", database, "--file", bundlePath]);
    expect(imported.code).toBe(1);
    expect(imported.stderr).toContain("regular file of at most");
    expect(existsSync(database)).toBe(false);
  });
});
