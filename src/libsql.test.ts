import { describe, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";

import { createKnowledgeGraphRecordV1 } from "./graph";
import {
  bootstrapOhLibSqlAuthorityV1,
  createOhLibSqlStoreAuthorityV1,
  type OhLibSqlClientV1,
  type OhLibSqlResultV1,
  type OhLibSqlStatementV1,
} from "./libsql";
import {
  OH_CANONICAL_STORE_PROFILE_V1,
  OH_WORKING_STORE_PROFILE_V1,
  OhConflictError,
  OhProfileError,
  OhPurgedSpaceError,
} from "./store";

class SqliteCompatibleLibSqlClient implements OhLibSqlClientV1 {
  readonly database = new Database(":memory:", { strict: true });

  #execute(statement: OhLibSqlStatementV1 | string): OhLibSqlResultV1 {
    const sql = typeof statement === "string" ? statement : statement.sql;
    const args = typeof statement === "string" ? [] : statement.args ?? [];
    const bindings: SQLQueryBindings[] = args.map((value) => value instanceof Date
      ? value.toISOString() : value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    if (/^\s*(?:SELECT|PRAGMA)\b/iu.test(sql)) {
      return { rows: this.database.query<Record<string, unknown>, SQLQueryBindings[]>(sql).all(...bindings) };
    }
    const result = this.database.query<never, SQLQueryBindings[]>(sql).run(...bindings);
    return { rows: [], rowsAffected: result.changes };
  }

  async execute(statement: OhLibSqlStatementV1 | string): Promise<OhLibSqlResultV1> {
    return this.#execute(statement);
  }

  async batch(
    statements: readonly OhLibSqlStatementV1[],
    _mode?: "deferred" | "read" | "write",
  ): Promise<readonly OhLibSqlResultV1[]> {
    return this.database.transaction((items: readonly OhLibSqlStatementV1[]) =>
      items.map((statement) => this.#execute(statement)))(statements);
  }

  close(): void { this.database.close(); }
}

const entity = (key: string, name: string, dependencies: readonly string[] = []) =>
  createKnowledgeGraphRecordV1({ dependencies, key, kind: "entity", v: 1, value: { name } });

async function bootstrappedClient(): Promise<SqliteCompatibleLibSqlClient> {
  const client = new SqliteCompatibleLibSqlClient();
  expect(await bootstrapOhLibSqlAuthorityV1(client)).toMatchObject({ schemaVersion: 1, v: 1 });
  return client;
}

describe("direct libSQL Oh authority", () => {
  test("does not bootstrap schema as a side effect of the runtime open", async () => {
    const client = new SqliteCompatibleLibSqlClient();
    await expect(createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:missing", spaceId: "missing",
    })).rejects.toThrow();
    expect(client.database.query<{ count: number }, []>(`SELECT count(*) AS count FROM sqlite_schema
      WHERE name LIKE 'oh_authority_%'`).get()?.count).toBe(0);
    client.close();
  });

  test("opens with a data-only runtime client after one explicit schema bootstrap", async () => {
    const schemaClient = await bootstrappedClient();
    const rejectDdl = (statement: OhLibSqlStatementV1 | string): void => {
      const sql = typeof statement === "string" ? statement : statement.sql;
      if (/^\s*(?:ALTER|CREATE|DROP|REINDEX|VACUUM)\b/iu.test(sql)) {
        throw new Error("runtime credential cannot execute schema DDL");
      }
    };
    const runtimeClient: OhLibSqlClientV1 = {
      execute: async (statement) => {
        rejectDdl(statement);
        return await schemaClient.execute(statement);
      },
      batch: async (statements, mode) => {
        statements.forEach(rejectDdl);
        return await schemaClient.batch(statements, mode);
      },
    };
    const authority = await createOhLibSqlStoreAuthorityV1(runtimeClient, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:data-only", spaceId: "data-only",
    });
    expect((await authority.store.head()).sequence).toBe(0);
    await authority.store.close();
    schemaClient.close();
  });

  test("is an async authoritative store rather than an operation-sync cache", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:remote", spaceId: "remote",
    });
    const parent = entity("entity:parent", "Parent");
    const child = entity("entity:child", "Child", [parent.key]);
    const first = await authority.store.commit({ actorId: "agent.remote", changes: [
      { kind: "put", record: parent, v: 1 }, { kind: "put", record: child, v: 1 },
    ], expectedHead: await authority.store.head(), instant: "2026-08-29T12:00:00.000Z",
    operationId: "op_remote_one" });
    await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:later", "Later"), v: 1 }], expectedHead: await authority.store.head(),
    instant: "2026-08-29T12:01:00.000Z", operationId: "op_remote_two" });

    expect((await authority.store.snapshot({ head: {
      operationSha256: first.operationSha256, sequence: first.sequence } })).records)
      .toEqual([child, parent].sort((left, right) => left.key.localeCompare(right.key)));
    expect((await authority.store.exportDependencyClosure({ roots: [child.key] })).records)
      .toEqual([child, parent].sort((left, right) => left.key.localeCompare(right.key)));
    expect(await authority.store.verify()).toMatchObject({ integrity: "verified", operations: 2, records: 3 });

    const reopened = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:remote", spaceId: "remote",
    });
    expect((await reopened.store.head()).operationSha256).toBe((await authority.store.head()).operationSha256);
    await reopened.store.close();
    await authority.store.close();
    client.close();
  });

  test("uses compare-and-swap guards to leave no partial remote mutation", async () => {
    const client = await bootstrappedClient();
    const first = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:cas", spaceId: "cas",
    });
    const second = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:cas", spaceId: "cas",
    });
    const stale = await second.store.head();
    await first.store.commit({ actorId: "agent.one", changes: [{ kind: "put",
      record: entity("entity:first", "First"), v: 1 }], expectedHead: stale,
    operationId: "op_first" });
    await expect(second.store.commit({ actorId: "agent.two", changes: [{ kind: "put",
      record: entity("entity:stale", "Stale"), v: 1 }], expectedHead: stale,
    operationId: "op_stale" })).rejects.toThrow(OhConflictError);
    expect((await first.store.snapshot()).records.map(({ key }) => key)).toEqual(["entity:first"]);
    expect(client.database.query<{ count: number }, []>(`SELECT count(*) AS count
      FROM oh_authority_operations WHERE operation_id = 'op_stale'`).get()?.count).toBe(0);
    await first.store.close(); await second.store.close(); client.close();
  });

  test("rejects profile drift and permanently purges a working realm with a receipt", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:purge", spaceId: "purge",
    });
    await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:private", "Private"), v: 1 }], expectedHead: await authority.store.head(),
    operationId: "op_private" });
    await expect(createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:other", spaceId: "purge",
    })).rejects.toThrow(OhProfileError);

    const receipt = await authority.host.purgeWorkingSpace({ purgedAt: "2026-08-29T13:00:00.000Z" });
    expect(receipt.priorHead.sequence).toBe(1);
    expect("purgeWorkingSpace" in authority.store).toBe(false);
    for (const table of ["oh_authority_spaces", "oh_authority_bindings", "oh_authority_operations",
      "oh_authority_operation_records", "oh_authority_records", "oh_authority_dependencies"]) {
      const count = client.database.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()?.count;
      expect(count, table).toBe(0);
    }
    expect(client.database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM oh_authority_purges WHERE space_id = 'purge'",
    ).get()?.count).toBe(1);
    await expect(createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:purge", spaceId: "purge",
    })).rejects.toThrow(OhPurgedSpaceError);
    client.close();
  });

  test("does not grant canonical stores a purge path", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_CANONICAL_STORE_PROFILE_V1, realmId: "realm:canonical", spaceId: "canonical",
    });
    await expect(authority.host.purgeWorkingSpace({})).rejects.toThrow(OhProfileError);
    await authority.store.close(); client.close();
  });
});
