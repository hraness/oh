import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createKnowledgeGraphRecordV1 } from "../graph";
import { createOhStoreBindingV1, OH_WORKING_STORE_PROFILE_V1 } from "../store";
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

  test("rejects orphaned and cross-space rows as idempotent operations", () => {
    const changes = [{ kind: "put" as const, record: record("entity:orphan", "Orphan"), v: 1 as const }];
    const source = new OhSqliteStore({ path: ":memory:", spaceId: "orphan-target" });
    const operation = source.commit({ actorId: "agent.test", changes, expectedHead: source.head(),
      operationId: "op_orphan" });
    const target = new OhSqliteStore({ path: ":memory:", spaceId: "orphan-target" });
    target.database.query(`INSERT INTO oh_operations(operation_sha256, space_id, sequence,
      operation_id, parent_operation_sha256, graph_revision_sha256, records_sha256,
      operation_json, instant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      operation.operationSha256, operation.spaceId, operation.sequence, operation.operationId,
      operation.parentOperationSha256, operation.graphRevisionSha256, operation.recordsSha256,
      JSON.stringify(operation), operation.instant,
    );
    expect(() => target.commit({ actorId: operation.actorId, changes, expectedHead: target.head(),
      operationId: operation.operationId })).toThrow(OhIntegrityError);
    expect(() => target.importOperation(operation)).toThrow(OhIntegrityError);
    expect(target.head().sequence).toBe(0);
    source.close(); target.close();

    const alienSource = new OhSqliteStore({ path: ":memory:", spaceId: "alien-source" });
    const alien = alienSource.commit({ actorId: "agent.test", changes, expectedHead: alienSource.head(),
      operationId: "op_alien" });
    const alienTarget = new OhSqliteStore({ path: ":memory:", spaceId: "alien-target" });
    alienTarget.database.query(`INSERT INTO oh_operations(operation_sha256, space_id, sequence,
      operation_id, parent_operation_sha256, graph_revision_sha256, records_sha256,
      operation_json, instant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      alien.operationSha256, alienTarget.spaceId, alien.sequence, alien.operationId,
      alien.parentOperationSha256, alien.graphRevisionSha256, alien.recordsSha256,
      JSON.stringify(alien), alien.instant,
    );
    alienTarget.database.query(`UPDATE oh_spaces SET generation = 1, head_operation_sha256 = ?,
      graph_revision_sha256 = ?, records_sha256 = ?, sequence = 1 WHERE space_id = ?`).run(
      alien.operationSha256, alien.graphRevisionSha256, alien.recordsSha256, alienTarget.spaceId,
    );
    expect(() => alienTarget.commit({ actorId: alien.actorId, changes,
      expectedHead: alienTarget.head(), operationId: alien.operationId })).toThrow(OhIntegrityError);
    alienSource.close(); alienTarget.close();
  });

  test("refuses to advance a space whose duplicated binding or current head drifted", () => {
    const store = new OhSqliteStore({ path: ":memory:", spaceId: "authority-drift" });
    const binding = createOhStoreBindingV1({ profile: OH_WORKING_STORE_PROFILE_V1,
      realmId: "realm:authority-drift", spaceId: store.spaceId, v: 1 });
    store.bind(binding);
    store.database.query("UPDATE oh_space_bindings SET realm_id = ? WHERE space_id = ?")
      .run("realm:alien", store.spaceId);
    expect(() => store.binding()).toThrow(OhIntegrityError);
    store.database.query("UPDATE oh_space_bindings SET realm_id = ? WHERE space_id = ?")
      .run(binding.realmId, store.spaceId);
    store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: record("entity:one", "One"), v: 1 }], expectedHead: store.head(), operationId: "op_one" });
    store.database.query("UPDATE oh_spaces SET graph_revision_sha256 = ? WHERE space_id = ?")
      .run("f".repeat(64), store.spaceId);
    const drifted = store.head();
    expect(() => store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: record("entity:two", "Two"), v: 1 }], expectedHead: drifted,
    operationId: "op_two" })).toThrow(OhIntegrityError);
    expect(store.head().sequence).toBe(1);
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

  test("verifies duplicated operation columns against canonical envelopes", () => {
    const store = new OhSqliteStore({ path: ":memory:" });
    store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: record("entity:a", "A"), v: 1 }], expectedHead: store.head(), operationId: "op_columns" });
    store.database.query("UPDATE oh_operations SET operation_id = ? WHERE space_id = ?")
      .run("op_alien", store.spaceId);
    expect(() => store.verifyReplay()).toThrow(OhIntegrityError);
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
    expect(() => store.verifyReplay()).toThrow(OhIntegrityError);
    store.close();
  });

  test("never reports a feed page that omits its tail or hides a bad sentinel", () => {
    const tail = new OhSqliteStore({ path: ":memory:", spaceId: "feed-tail" });
    for (let index = 1; index <= 3; index += 1) {
      tail.commit({ actorId: "agent.test", changes: [{ kind: "put",
        record: record(`entity:tail-${index}`, `Tail ${index}`), v: 1 }], expectedHead: tail.head(),
      operationId: `op_tail_${index}` });
    }
    tail.database.exec("PRAGMA foreign_keys = OFF");
    tail.database.query("DELETE FROM oh_operations WHERE space_id = ? AND sequence = 3").run(tail.spaceId);
    tail.database.exec("PRAGMA foreign_keys = ON");
    expect(() => tail.changesSince({ operationSha256: null, sequence: 0 }, { limit: 3 }))
      .toThrow(OhIntegrityError);
    tail.close();

    const sentinel = new OhSqliteStore({ path: ":memory:", spaceId: "feed-sentinel" });
    for (let index = 1; index <= 3; index += 1) {
      sentinel.commit({ actorId: "agent.test", changes: [{ kind: "put",
        record: record(`entity:sentinel-${index}`, `Sentinel ${index}`), v: 1 }],
      expectedHead: sentinel.head(), operationId: `op_sentinel_${index}` });
    }
    sentinel.database.exec("PRAGMA foreign_keys = OFF");
    sentinel.database.query("DELETE FROM oh_operations WHERE space_id = ? AND sequence = 2")
      .run(sentinel.spaceId);
    sentinel.database.exec("PRAGMA foreign_keys = ON");
    expect(() => sentinel.changesSince({ operationSha256: null, sequence: 0 }, { limit: 1 }))
      .toThrow(OhIntegrityError);
    sentinel.close();
  });

  test("rolls a working-space purge back when a payload delete is masked", () => {
    const store = new OhSqliteStore({ path: ":memory:", spaceId: "purge-postcondition" });
    const binding = createOhStoreBindingV1({ profile: OH_WORKING_STORE_PROFILE_V1,
      realmId: "realm:purge-postcondition", spaceId: store.spaceId, v: 1 });
    store.bind(binding);
    store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: record("entity:private", "Private"), v: 1 }], expectedHead: store.head(),
    operationId: "op_private" });
    store.database.exec(`CREATE TRIGGER mask_private_operation_delete BEFORE DELETE ON oh_operations
      BEGIN SELECT RAISE(IGNORE); END`);
    store.database.exec(`CREATE TRIGGER mask_private_space_delete BEFORE DELETE ON oh_spaces
      BEGIN SELECT RAISE(IGNORE); END`);
    expect(() => store.purgeWorkingSpace(binding, "2026-08-29T13:00:00.000Z"))
      .toThrow(OhIntegrityError);
    expect(store.database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM oh_space_purges").get()?.count).toBe(0);
    expect(store.get("entity:private")).not.toBeNull();
    expect(store.head().sequence).toBe(1);
    store.close();
  });

  test("cross-checks every stored purge receipt column before refusing resurrection", () => {
    const store = new OhSqliteStore({ path: ":memory:", spaceId: "purge-columns" });
    const binding = createOhStoreBindingV1({ profile: OH_WORKING_STORE_PROFILE_V1,
      realmId: "realm:purge-columns", spaceId: store.spaceId, v: 1 });
    store.bind(binding);
    store.purgeWorkingSpace(binding, "2026-08-29T13:00:00.000Z");
    store.database.query("UPDATE oh_space_purges SET prior_sequence = 99 WHERE space_id = ?")
      .run(store.spaceId);
    expect(() => store.ensureSpace()).toThrow(OhIntegrityError);
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
