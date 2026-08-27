import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createKnowledgeGraphRecordV1 } from "../graph";
import { OhConflictError, OhDependencyError, OhIntegrityError, OhSqliteStore } from "./store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oh-store-test-"));
  roots.push(root);
  return join(root, "oh.sqlite");
}

const record = (key: string, name: string, dependencies: readonly string[] = []) =>
  createKnowledgeGraphRecordV1({ dependencies, key, kind: "entity", v: 1, value: { name } });

describe("Oh SQLite authority", () => {
  test("commits, reopens, searches, and reproduces the exact head by replay", async () => {
    const path = await databasePath();
    const store = new OhSqliteStore({ path });
    const first = record("entity:ada", "Ada Lovelace");
    const operation = store.commit({ actorId: "agent.test", changes: [{ kind: "put", record: first, v: 1 }],
      expectedHead: store.head(), instant: "2026-08-27T12:00:00.000Z", operationId: "op_first" });
    expect(operation.sequence).toBe(1);
    expect(store.searchKeyword("Lovelace")[0]?.key).toBe(first.key);
    expect(store.verifyReplay()).toMatchObject({ operations: 1, records: 1, sqliteIntegrity: "ok" });
    store.close();

    const reopened = new OhSqliteStore({ path });
    expect(reopened.get(first.key)).toEqual(first);
    expect(reopened.verifyReplay().head.operationSha256).toBe(operation.operationSha256);
    reopened.close();
  });

  test("enforces compare-and-swap across independent connections", async () => {
    const path = await databasePath();
    const first = new OhSqliteStore({ path });
    const second = new OhSqliteStore({ path });
    const stale = second.head();
    first.commit({ actorId: "agent.one", changes: [{ kind: "put", record: record("entity:first", "First"), v: 1 }],
      expectedHead: first.head(), operationId: "op_one" });
    expect(() => second.commit({ actorId: "agent.two", changes: [{ kind: "put", record: record("entity:second", "Second"), v: 1 }],
      expectedHead: stale, operationId: "op_two" })).toThrow(OhConflictError);
    expect(second.head().sequence).toBe(1);
    first.close(); second.close();
  });

  test("makes operation IDs idempotent but never aliases different content", () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    const input = { actorId: "agent.test", changes: [{ kind: "put" as const, record: record("entity:a", "A"), v: 1 as const }],
      expectedHead: store.head(), operationId: "op_retry" };
    const first = store.commit(input);
    expect(store.commit(input)).toEqual(first);
    expect(() => store.commit({ ...input, changes: [{ kind: "put", record: record("entity:a", "Other"), v: 1 }] }))
      .toThrow(OhConflictError);
    expect(store.log()).toHaveLength(1);
    store.close();
  });

  test("checks final dependency closure before changing durable state", () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    expect(() => store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: record("entity:child", "Child", ["entity:missing"]), v: 1 }],
      expectedHead: store.head(), operationId: "op_missing" })).toThrow(OhDependencyError);
    expect(store.head().sequence).toBe(0);
    const parent = record("entity:parent", "Parent");
    const child = record("entity:child", "Child", [parent.key]);
    store.commit({ actorId: "agent.test", changes: [{ kind: "put", record: child, v: 1 },
      { kind: "put", record: parent, v: 1 }], expectedHead: store.head(), operationId: "op_both" });
    expect(() => store.commit({ actorId: "agent.test", changes: [{ key: parent.key, kind: "tombstone",
      priorSha256: parent.recordSha256, v: 1 }], expectedHead: store.head(), operationId: "op_bad_delete" }))
      .toThrow(OhDependencyError);
    expect(store.head().sequence).toBe(1);
    store.close();
  });

  test("rolls an interrupted write back atomically", () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    store.database.exec(`CREATE TRIGGER test_abort_record BEFORE INSERT ON oh_records
      BEGIN SELECT RAISE(ABORT, 'simulated interruption'); END`);
    expect(() => store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: record("entity:a", "A"), v: 1 }], expectedHead: store.head(), operationId: "op_crash" })).toThrow();
    store.database.exec("DROP TRIGGER test_abort_record");
    expect(store.head().sequence).toBe(0);
    expect(store.log()).toHaveLength(0);
    expect(store.verifyReplay()).toMatchObject({ operations: 0, records: 0 });
    store.close();
  });

  test("detects materialized-state tampering", () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    store.commit({ actorId: "agent.test", changes: [{ kind: "put", record: record("entity:a", "A"), v: 1 }],
      expectedHead: store.head(), operationId: "op_one" });
    store.database.query("UPDATE oh_records SET record_json = ? WHERE space_id = ? AND record_key = ?")
      .run('{"dependencies":[],"key":"entity:a","kind":"entity","recordSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","v":1,"value":{"name":"A"}}', store.spaceId, "entity:a");
    expect(() => store.verifyReplay()).toThrow(OhIntegrityError);
    store.close();
  });

  test("verifies dependency and operation-record materializations", () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    const parent = record("entity:parent", "Parent");
    const child = record("entity:child", "Child", [parent.key]);
    const operation = store.commit({ actorId: "agent.test", changes: [
      { kind: "put", record: child, v: 1 }, { kind: "put", record: parent, v: 1 },
    ], expectedHead: store.head(), operationId: "op_materialized" });
    store.database.query("DELETE FROM oh_dependencies WHERE space_id = ?").run(store.spaceId);
    expect(() => store.verifyReplay()).toThrow("Materialized dependencies");
    store.database.query("INSERT INTO oh_dependencies(space_id, record_key, dependency_key) VALUES (?, ?, ?)")
      .run(store.spaceId, child.key, parent.key);
    store.database.query("DELETE FROM oh_operation_records WHERE operation_sha256 = ?").run(operation.operationSha256);
    expect(() => store.verifyReplay()).toThrow("Materialized operation records");
    store.close();
  });

  test("checks canonical operation bytes beyond the export batch ceiling", () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    for (let index = 0; index < 1001; index += 1) {
      store.commit({ actorId: "agent.test", changes: [{ kind: "put",
        record: record("entity:a", `A ${index}`), v: 1 }], expectedHead: store.head(),
        operationId: `op_${String(index).padStart(4, "0")}` });
    }
    store.database.query(`UPDATE oh_operations SET operation_json = ' ' || operation_json
      WHERE space_id = ? AND sequence = 1`).run(store.spaceId);
    expect(() => store.verifyReplay()).toThrow("not canonical JSON");
    store.close();
  });

  test("imports an exact operation once and rejects a fork", () => {
    const source = new OhSqliteStore({ path: ":memory:" });
    const target = new OhSqliteStore({ path: ":memory:" });
    const operation = source.commit({ actorId: "agent.test", changes: [{ kind: "put", record: record("entity:a", "A"), v: 1 }],
      expectedHead: source.head(), operationId: "op_one" });
    expect(target.importOperation(operation).imported).toBe(true);
    expect(target.importOperation(operation).imported).toBe(false);
    const fork = source.commit({ actorId: "agent.test", changes: [{ kind: "put", record: record("entity:b", "B"), v: 1 }],
      expectedHead: source.head(), operationId: "op_two" });
    target.commit({ actorId: "agent.other", changes: [{ kind: "put", record: record("entity:c", "C"), v: 1 }],
      expectedHead: target.head(), operationId: "op_other" });
    expect(() => target.importOperation(fork)).toThrow(OhConflictError);
    source.close(); target.close();
  });

  test("keeps a thousand-record batch bounded", () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    const changes = Array.from({ length: 1000 }, (_, index) => ({ kind: "put" as const,
      record: record(`entity:item-${String(index).padStart(4, "0")}`, `Item ${index}`), v: 1 as const }));
    const started = performance.now();
    store.commit({ actorId: "agent.test", changes, expectedHead: store.head(), operationId: "op_batch" });
    expect(store.snapshotRecords()).toHaveLength(1000);
    expect(() => store.snapshotRecords(65_537)).toThrow("65536");
    expect(performance.now() - started).toBeLessThan(5000);
    store.close();
  });
});
