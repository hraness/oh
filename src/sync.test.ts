import { describe, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";

import { OH_CONTRACT_MANIFEST_V1 } from "./contract";
import { createKnowledgeGraphRecordV1 } from "./graph";
import { OhSqliteStore } from "./sqlite/store";
import { createLibSqlOperationSyncTransportV1, createOhSyncBundleV1, parseOhSyncBundleV1,
  synchronizeOhStoreV1, type LibSqlClientV1, type LibSqlStatementV1,
  type LibSqlResultV1,
  type OhOperationSyncTransportV1, type OhSyncBundleV1, type OhSyncHeadV1 } from "./sync";

const record = (key: string, name: string) => createKnowledgeGraphRecordV1({
  dependencies: [], key, kind: "entity", v: 1, value: { name },
});

class MemoryTransport implements OhOperationSyncTransportV1 {
  readonly store = new OhSqliteStore({ path: ":memory:" });
  handshakes = 0;

  async handshake(manifest: typeof OH_CONTRACT_MANIFEST_V1): Promise<void> {
    if (manifest.contractSha256 !== OH_CONTRACT_MANIFEST_V1.contractSha256) throw new Error("contract mismatch");
    this.handshakes += 1;
  }
  async head(spaceId: string): Promise<OhSyncHeadV1> {
    if (spaceId !== this.store.spaceId) throw new Error("space mismatch");
    const head = this.store.head();
    return { operationSha256: head.operationSha256, sequence: head.sequence, v: 1 };
  }
  async pull(spaceId: string, afterSequence: number, limit: number): Promise<OhSyncBundleV1> {
    return createOhSyncBundleV1(spaceId, this.store.exportOperations(afterSequence, limit));
  }
  async push(bundle: OhSyncBundleV1): Promise<OhSyncHeadV1> {
    for (const operation of bundle.operations) this.store.importOperation(operation);
    return await this.head(bundle.spaceId);
  }
  close(): void { this.store.close(); }
}

function put(store: OhSqliteStore, key: string, name: string, operationId: string): void {
  store.commit({ actorId: "agent.test", changes: [{ kind: "put", record: record(key, name), v: 1 }],
    expectedHead: store.head(), operationId });
}

describe("operation sync", () => {
  test("round-trips fast-forward logs and settles idempotently", async () => {
    const remote = new MemoryTransport();
    const first = new OhSqliteStore({ path: ":memory:" });
    const second = new OhSqliteStore({ path: ":memory:" });
    put(first, "entity:a", "A", "op_a");
    put(first, "entity:b", "B", "op_b");
    expect(await synchronizeOhStoreV1(first, remote)).toMatchObject({ pulled: 0, pushed: 2 });
    expect(await synchronizeOhStoreV1(second, remote)).toMatchObject({ pulled: 2, pushed: 0 });
    expect(second.head().operationSha256).toBe(first.head().operationSha256);
    put(second, "entity:c", "C", "op_c");
    expect(await synchronizeOhStoreV1(second, remote)).toMatchObject({ pushed: 1 });
    expect(await synchronizeOhStoreV1(first, remote)).toMatchObject({ pulled: 1 });
    expect(await synchronizeOhStoreV1(first, remote)).toMatchObject({ pulled: 0, pushed: 0 });
    expect(remote.handshakes).toBeGreaterThanOrEqual(5);
    first.close(); second.close(); remote.close();
  });

  test("rejects diverged heads without modifying either log", async () => {
    const remote = new MemoryTransport();
    const local = new OhSqliteStore({ path: ":memory:" });
    put(local, "entity:base", "Base", "op_base");
    await synchronizeOhStoreV1(local, remote);
    put(local, "entity:local", "Local", "op_local");
    put(remote.store, "entity:remote", "Remote", "op_remote");
    await expect(synchronizeOhStoreV1(local, remote)).rejects.toThrow("different heads");
    expect(local.get("entity:local")).not.toBeNull();
    expect(remote.store.get("entity:remote")).not.toBeNull();
    local.close(); remote.close();
  });

  test("binds every bundle byte to its digest", () => {
    const source = new OhSqliteStore({ path: ":memory:" });
    put(source, "entity:a", "A", "op_a");
    const bundle = createOhSyncBundleV1(source.spaceId, source.exportOperations());
    expect(parseOhSyncBundleV1(bundle)).toEqual(bundle);
    expect(parseOhSyncBundleV1({ ...bundle, spaceId: "other" })).toBeNull();
    expect(parseOhSyncBundleV1({ ...bundle, contractSha256: "a".repeat(64) })).toBeNull();
    source.close();
  });

  test("runs the libSQL/Turso seam against SQLite-compatible statements", async () => {
    const database = new Database(":memory:", { strict: true });
    const execute = (statement: LibSqlStatementV1 | string): LibSqlResultV1 => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : statement.args ?? [];
      const bindings: SQLQueryBindings[] = args.map((value) => value instanceof Date
        ? value.toISOString() : value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      if (/^\s*SELECT\b/iu.test(sql)) {
        return { rows: database.query<Record<string, unknown>, SQLQueryBindings[]>(sql).all(...bindings) };
      }
      database.query<never, SQLQueryBindings[]>(sql).run(...bindings);
      return { rows: [] };
    };
    const client: LibSqlClientV1 = {
      execute: async (statement) => execute(statement),
      batch: async (statements) => database.transaction((items: LibSqlStatementV1[]) =>
        items.map((statement) => execute(statement)))(statements),
    };
    const transport = createLibSqlOperationSyncTransportV1(client);
    const source = new OhSqliteStore({ path: ":memory:" });
    put(source, "entity:a", "A", "op_a");
    await expect(transport.handshake({ ...OH_CONTRACT_MANIFEST_V1,
      ontologyVersion: "9.9.9" } as unknown as typeof OH_CONTRACT_MANIFEST_V1))
      .rejects.toThrow("Unsupported contract manifest");
    await transport.handshake(OH_CONTRACT_MANIFEST_V1);
    const pushed = await transport.push(createOhSyncBundleV1(source.spaceId, source.exportOperations()));
    expect(pushed).toEqual({ operationSha256: source.head().operationSha256, sequence: 1, v: 1 });
    expect((await transport.pull(source.spaceId, 0, 100)).operations).toEqual(source.exportOperations());
    expect(await transport.push(createOhSyncBundleV1(source.spaceId, source.exportOperations()))).toEqual(pushed);
    source.close();
    database.close();
  });
});
