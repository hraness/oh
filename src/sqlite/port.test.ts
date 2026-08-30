import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createKnowledgeGraphRecordV1 } from "../graph";
import {
  createOhStoreBindingV1,
  OH_CANONICAL_STORE_PROFILE_V1,
  OH_WORKING_STORE_PROFILE_V1,
  OhProfileError,
  OhPurgedSpaceError,
} from "../store";
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

  test("refuses operation replication for a bound working profile", () => {
    const store = new OhSqliteStore({ path: ":memory:", spaceId: "local-only" });
    store.bind(createOhStoreBindingV1({ profile: OH_WORKING_STORE_PROFILE_V1,
      realmId: "realm:local-only", spaceId: "local-only", v: 1 }));
    expect(() => store.exportOperations()).toThrow(OhProfileError);
    expect(() => store.importOperation({})).toThrow(OhProfileError);
    expect(store.verifyReplay()).toMatchObject({ operations: 0, records: 0 });
    store.close();
  });
});
