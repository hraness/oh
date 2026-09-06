import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { canonicalSha256 } from "../canonical";
import { createKnowledgeGraphRecordV1 } from "../graph";
import { createOhOperationV1 } from "../operation";
import {
  createOhStoreBindingV1,
  OH_CANONICAL_STORE_PROFILE_V1,
  OH_WORKING_STORE_PROFILE_V1,
  OhConflictError,
  OhProfileError,
  OhPurgedSpaceError,
  type OhHeadRefV1,
} from "../store";
import { createOhSyncBundleV1 } from "../sync";
import { createOhSqliteStoreAuthorityV1 } from "./port";
import { OhSqliteStore } from "./store";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function databasePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oh-port-test-"));
  roots.push(root);
  return join(root, "oh.sqlite");
}

const entity = (key: string, name: string, dependencies: readonly string[] = []) =>
  createKnowledgeGraphRecordV1({ dependencies, key, kind: "entity", v: 1, value: { name } });

describe("promise-based SQLite store port", () => {
  test("reads exact historical heads and paginates a feed through a pinned head", async () => {
    const authority = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:history", spaceId: "history" });
    const first = await authority.store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: entity("entity:a", "A"), v: 1 }], expectedHead: await authority.store.head(),
      instant: "2026-08-29T12:00:00.000Z", operationId: "op_a" });
    await authority.store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: entity("entity:b", "B"), v: 1 }], expectedHead: await authority.store.head(),
      instant: "2026-08-29T12:01:00.000Z", operationId: "op_b" });
    const third = await authority.store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: entity("entity:c", "C"), v: 1 }], expectedHead: await authority.store.head(),
      instant: "2026-08-29T12:02:00.000Z", operationId: "op_c" });

    const firstSnapshot = await authority.store.snapshot({ head: {
      operationSha256: first.operationSha256, sequence: first.sequence } });
    expect(firstSnapshot.records.map(({ key }) => key)).toEqual(["entity:a"]);
    const page = await authority.store.changesSince({ operationSha256: null, sequence: 0 }, {
      limit: 2, through: { operationSha256: third.operationSha256, sequence: third.sequence },
    });
    expect(page.operations.map(({ operationId }) => operationId)).toEqual(["op_a", "op_b"]);
    expect(page.hasMore).toBe(true);
    const final = await authority.store.changesSince(page.to, { limit: 2,
      through: { operationSha256: third.operationSha256, sequence: third.sequence } });
    expect(final.operations.map(({ operationId }) => operationId)).toEqual(["op_c"]);
    expect(final.hasMore).toBe(false);
    await authority.store.close();
  });

  test("exports a verified closure from the exact requested head", async () => {
    const authority = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:closure", spaceId: "closure" });
    const parent = entity("entity:parent", "Parent");
    const child = entity("entity:child", "Child", [parent.key]);
    await authority.store.commit({ actorId: "agent.test", changes: [
      { kind: "put", record: child, v: 1 }, { kind: "put", record: parent, v: 1 },
    ], expectedHead: await authority.store.head(), operationId: "op_closure" });
    const closure = await authority.store.exportDependencyClosure({ roots: [child.key] });
    expect(closure.records.map(({ key }) => key)).toEqual([child.key, parent.key].sort());
    expect(closure.binding.bindingSha256).toBe(authority.store.binding.bindingSha256);
    await authority.store.close();
  });

  test("persists an exact realm binding and rejects a different profile on reopen", async () => {
    const path = await databasePath();
    const canonical = createOhSqliteStoreAuthorityV1({ path, profile: OH_CANONICAL_STORE_PROFILE_V1,
      realmId: "realm:canonical", spaceId: "same" });
    await canonical.store.close();
    expect(() => createOhSqliteStoreAuthorityV1({ path, profile: OH_WORKING_STORE_PROFILE_V1,
      realmId: "realm:working", spaceId: "same" })).toThrow(OhProfileError);
  });

  test("keeps purge on host control, deletes all working payload rows, and leaves a receipt", async () => {
    const path = await databasePath();
    const authority = createOhSqliteStoreAuthorityV1({ path, profile: OH_WORKING_STORE_PROFILE_V1,
      realmId: "realm:purge", spaceId: "purge" });
    expect("purgeWorkingSpace" in authority.store).toBe(false);
    await authority.store.commit({ actorId: "agent.test", changes: [{ kind: "put",
      record: entity("entity:private", "Private"), v: 1 }], expectedHead: await authority.store.head(),
      operationId: "op_private" });
    const receipt = await authority.host.purgeWorkingSpace({ purgedAt: "2026-08-29T13:00:00.000Z" });
    expect(receipt.priorHead.sequence).toBe(1);
    expect(await authority.host.purgeWorkingSpace({ purgedAt: "2026-08-29T13:00:00.000Z" })).toEqual(receipt);

    const database = new OhSqliteStore({ path, spaceId: "other" });
    for (const table of ["oh_operations", "oh_operation_records", "oh_records", "oh_dependencies",
      "oh_search_documents", "oh_sync_outbox", "oh_sync_state", "oh_space_bindings", "oh_spaces"]) {
      const where = table === "oh_operation_records"
        ? "operation_sha256 IN (SELECT operation_sha256 FROM oh_operations WHERE space_id = 'purge')"
        : "space_id = 'purge'";
      const count = database.database.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table} WHERE ${where}`).get()?.count;
      expect(count, table).toBe(0);
    }
    expect(database.database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM oh_space_purges WHERE space_id = 'purge'",
    ).get()?.count).toBe(1);
    database.close();
    expect(() => new OhSqliteStore({ path, spaceId: "purge" })).toThrow(OhPurgedSpaceError);
  });

  test("never gives canonical profiles a destructive host capability", async () => {
    const authority = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:canonical", spaceId: "canonical" });
    await expect(authority.host.purgeWorkingSpace({})).rejects.toThrow(OhProfileError);
    await authority.store.close();
  });

  test("keeps pinned canonical replication on host control", async () => {
    const authority = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:replication", spaceId: "replication" });
    expect("replication" in authority.store).toBe(false);
    const replication = authority.host.replication;
    expect(replication).not.toBeNull();
    if (replication === null) throw new Error("Expected canonical replication authority.");
    expect(Object.isFrozen(replication)).toBe(true);
    const empty = await authority.store.head();
    const first = await authority.store.commit({ actorId: "host.test", changes: [{ kind: "put",
      record: entity("entity:first", "First"), v: 1 }], expectedHead: empty,
      instant: "2026-09-06T01:00:00.000Z", operationId: "op_first" });
    const second = await authority.store.commit({ actorId: "host.test", changes: [{ kind: "put",
      record: entity("entity:second", "Second"), v: 1 }], expectedHead: await authority.store.head(),
      instant: "2026-09-06T01:01:00.000Z", operationId: "op_second" });
    const pinned = await authority.store.head();
    await authority.store.commit({ actorId: "host.test", changes: [{ kind: "put",
      record: entity("entity:third", "Third"), v: 1 }], expectedHead: pinned,
      instant: "2026-09-06T01:02:00.000Z", operationId: "op_third" });

    const firstPage = await replication.exportBundle({
      after: { operationSha256: empty.operationSha256, sequence: empty.sequence },
      limit: 1,
      through: { operationSha256: pinned.operationSha256, sequence: pinned.sequence },
    });
    expect(firstPage.bundle.operations.map(({ operationId }) => operationId)).toEqual(["op_first"]);
    expect(firstPage).toMatchObject({
      from: { operationSha256: null, sequence: 0 },
      hasMore: true,
      through: pinned,
      to: { operationSha256: first.operationSha256, sequence: first.sequence },
      v: 1,
    });
    const finalPage = await replication.exportBundle({
      after: firstPage.to,
      limit: 1,
      through: { operationSha256: pinned.operationSha256, sequence: pinned.sequence },
    });
    expect(finalPage.bundle.operations.map(({ operationId }) => operationId)).toEqual(["op_second"]);
    expect(finalPage).toMatchObject({
      from: { operationSha256: first.operationSha256, sequence: first.sequence },
      hasMore: false,
      through: pinned,
      to: { operationSha256: second.operationSha256, sequence: second.sequence },
      v: 1,
    });

    const bundle = await replication.exportBundle({
      after: { operationSha256: empty.operationSha256, sequence: empty.sequence },
      through: { operationSha256: pinned.operationSha256, sequence: pinned.sequence },
    });
    expect(bundle.bundle.operations.map(({ operationId }) => operationId)).toEqual(["op_first", "op_second"]);
    expect(bundle.bundle.operations.at(-1)?.operationSha256).toBe(second.operationSha256);
    expect(bundle.bundle.operations).not.toContainEqual(expect.objectContaining({ operationId: "op_third" }));
    expect(bundle).toMatchObject({ from: { sequence: 0 }, hasMore: false,
      through: pinned, to: { sequence: 2 }, v: 1 });
    await expect(replication.exportBundle({
      after: { operationSha256: first.operationSha256, sequence: first.sequence },
      through: { operationSha256: canonicalSha256("wrong through head"), sequence: pinned.sequence },
    })).rejects.toThrow();

    const working = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:working-replication",
      spaceId: "working-replication" });
    expect(working.host.replication).toBeNull();
    await working.store.close();
    await authority.store.close();
  });

  test("imports canonical replication bundles atomically and replays them exactly", async () => {
    const source = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:atomic", spaceId: "atomic" });
    const targetDatabase = new Database(":memory:", { strict: true });
    const target = createOhSqliteStoreAuthorityV1({ database: targetDatabase,
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:atomic", spaceId: "atomic" });
    const empty = await target.store.head();
    const first = await source.store.commit({ actorId: "host.test", changes: [{ kind: "put",
      record: entity("entity:first", "First"), v: 1 }], expectedHead: await source.store.head(),
      instant: "2026-09-06T02:00:00.000Z", operationId: "op_atomic_first" });
    const second = await source.store.commit({ actorId: "host.test", changes: [{ kind: "put",
      record: entity("entity:second", "Second"), v: 1 }], expectedHead: await source.store.head(),
      instant: "2026-09-06T02:01:00.000Z", operationId: "op_atomic_second" });
    const { operationSha256: _operationSha256, ...secondPayload } = second;
    const hostileSecond = createOhOperationV1({
      ...secondPayload,
      graphRevisionSha256: canonicalSha256("hostile graph revision"),
      recordsSha256: canonicalSha256("hostile records"),
    });
    const hostile = createOhSyncBundleV1("atomic", [first, hostileSecond]);
    const targetReplication = target.host.replication;
    const sourceReplication = source.host.replication;
    if (targetReplication === null || sourceReplication === null) {
      throw new Error("Expected canonical replication authority.");
    }
    const firstBundle = createOhSyncBundleV1("atomic", [first]);
    await expect(targetReplication.importBundle({
      bundle: firstBundle,
      expectedHead: { operationSha256: null, sequence: -0 },
    })).rejects.toThrow(TypeError);
    let rejectedBundleReads = 0;
    const rejectedBundle = new Proxy({}, {
      get() { rejectedBundleReads += 1; throw new Error("must not read bundle"); },
      getOwnPropertyDescriptor() { rejectedBundleReads += 1; throw new Error("must not inspect bundle"); },
      getPrototypeOf() { rejectedBundleReads += 1; throw new Error("must not inspect bundle"); },
      ownKeys() { rejectedBundleReads += 1; throw new Error("must not inspect bundle"); },
    });
    await expect(targetReplication.importBundle({
      bundle: rejectedBundle,
      expectedHead: { operationSha256: null, sequence: -0 },
    })).rejects.toThrow(TypeError);
    expect(rejectedBundleReads).toBe(0);
    let expectedHeadAccessorReads = 0;
    const accessorExpectedHead = { operationSha256: null } as Record<PropertyKey, unknown>;
    Object.defineProperty(accessorExpectedHead, "sequence", { enumerable: true,
      get() { expectedHeadAccessorReads += 1; throw new Error("must not execute"); } });
    await expect(targetReplication.importBundle({
      bundle: firstBundle,
      expectedHead: accessorExpectedHead as OhHeadRefV1,
    })).rejects.toThrow(TypeError);
    let expectedHeadProxyReads = 0;
    const proxyExpectedHead = new Proxy({ operationSha256: null, sequence: 0 } as const, {
      get() { expectedHeadProxyReads += 1; throw new Error("must not execute"); },
    });
    await expect(targetReplication.importBundle({
      bundle: firstBundle,
      expectedHead: proxyExpectedHead,
    })).rejects.toThrow(TypeError);
    expect(expectedHeadAccessorReads).toBe(0);
    expect(expectedHeadProxyReads).toBe(0);
    expect(await target.store.head()).toEqual(empty);
    await expect(targetReplication.importBundle({
      bundle: hostile,
      expectedHead: { operationSha256: empty.operationSha256, sequence: empty.sequence },
    })).rejects.toThrow("does not reproduce");
    expect(await target.store.head()).toEqual(empty);
    expect((await target.store.snapshot()).records).toEqual([]);
    expect(await target.store.verify()).toMatchObject({ operations: 0, records: 0 });
    for (const table of ["oh_operations", "oh_operation_records", "oh_records", "oh_dependencies",
      "oh_search_documents", "oh_search_fts", "oh_sync_outbox"]) {
      const count = targetDatabase.query<{ count: number }, []>(
        `SELECT count(*) AS count FROM ${table}`,
      ).get()?.count;
      expect(count, table).toBe(0);
    }

    const sourceHead = await source.store.head();
    const exact = await sourceReplication.exportBundle({
      after: { operationSha256: empty.operationSha256, sequence: empty.sequence },
      through: { operationSha256: sourceHead.operationSha256, sequence: sourceHead.sequence },
    });
    expect(await targetReplication.importBundle({
      bundle: exact.bundle,
      expectedHead: { operationSha256: empty.operationSha256, sequence: empty.sequence },
    })).toMatchObject({ head: sourceHead, imported: 2, status: "imported" });
    expect(await targetReplication.importBundle({
      bundle: exact.bundle,
      expectedHead: { operationSha256: empty.operationSha256, sequence: empty.sequence },
    })).toMatchObject({ head: sourceHead, imported: 0, status: "already-present" });

    const third = await target.store.commit({ actorId: "host.test", changes: [{ kind: "put",
      record: entity("entity:third", "Third"), v: 1 }], expectedHead: await target.store.head(),
    instant: "2026-09-06T02:02:00.000Z", operationId: "op_atomic_third" });
    expect(await targetReplication.importBundle({
      bundle: exact.bundle,
      expectedHead: { operationSha256: empty.operationSha256, sequence: empty.sequence },
    })).toMatchObject({ head: { operationSha256: third.operationSha256, sequence: third.sequence },
      imported: 0, status: "already-present" });

    const fork = createOhSqliteStoreAuthorityV1({ path: ":memory:",
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:atomic", spaceId: "atomic" });
    const forkReplication = fork.host.replication;
    if (forkReplication === null) throw new Error("Expected fork replication authority.");
    await forkReplication.importBundle({
      bundle: createOhSyncBundleV1("atomic", [first]),
      expectedHead: { operationSha256: empty.operationSha256, sequence: empty.sequence },
    });
    const divergent = await fork.store.commit({ actorId: "host.fork", changes: [{ kind: "put",
      record: entity("entity:fork", "Fork"), v: 1 }], expectedHead: await fork.store.head(),
    instant: "2026-09-06T02:01:30.000Z", operationId: "op_atomic_fork" });
    await expect(targetReplication.importBundle({
      bundle: createOhSyncBundleV1("atomic", [divergent]),
      expectedHead: { operationSha256: first.operationSha256, sequence: first.sequence },
    })).rejects.toThrow(OhConflictError);
    expect(await target.store.head()).toMatchObject({
      operationSha256: third.operationSha256,
      sequence: third.sequence,
    });
    const history = await target.store.changesSince({ operationSha256: null, sequence: 0 }, {
      through: { operationSha256: third.operationSha256, sequence: third.sequence },
    });
    expect(history.operations.map(({ operationId }) => operationId))
      .toEqual(["op_atomic_first", "op_atomic_second", "op_atomic_third"]);
    expect(await target.store.verify()).toMatchObject({ operations: 3, records: 3 });

    await fork.store.close();
    await target.store.close();
    await source.store.close();
  });

  test("refuses operation replication for a bound working profile", () => {
    const store = new OhSqliteStore({ path: ":memory:", spaceId: "local-only" });
    store.bind(createOhStoreBindingV1({ profile: OH_WORKING_STORE_PROFILE_V1,
      realmId: "realm:local-only", spaceId: "local-only", v: 1 }));
    expect(() => store.exportOperations()).toThrow(OhProfileError);
    expect(() => store.importOperation({})).toThrow(OhProfileError);
    expect(() => store.importOperations({
      expectedHead: { operationSha256: null, sequence: 0 },
      operations: [],
    })).toThrow(OhProfileError);
    expect(store.verifyReplay()).toMatchObject({ operations: 0, records: 0 });
    store.close();
  });
});
