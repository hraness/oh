import { describe, expect, test } from "bun:test";
import { Database, type SQLQueryBindings } from "bun:sqlite";

import { canonicalJson } from "./canonical";
import { createKnowledgeGraphRecordV1 } from "./graph";
import {
  bootstrapOhLibSqlAuthorityV1,
  createOhLibSqlStoreAuthorityV1,
  OH_LIBSQL_STORE_LIMITS_V1,
  type OhLibSqlClientV1,
  type OhLibSqlResultV1,
  type OhLibSqlStatementV1,
} from "./libsql";
import {
  OH_CANONICAL_STORE_PROFILE_V1,
  OH_WORKING_STORE_PROFILE_V1,
  OhConflictError,
  OhIntegrityError,
  OhProfileError,
  OhPurgedSpaceError,
} from "./store";

class SqliteCompatibleLibSqlClient implements OhLibSqlClientV1 {
  readonly database = new Database(":memory:", { strict: true });
  lastBatchResponseBytes = 0;

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
    const results = this.database.transaction((items: readonly OhLibSqlStatementV1[]) =>
      items.map((statement) => this.#execute(statement)))(statements);
    this.lastBatchResponseBytes = Buffer.byteLength(JSON.stringify(results), "utf8");
    return results;
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
  test("refuses to bless preexisting or drifted authority schema objects", async () => {
    const malformed = new SqliteCompatibleLibSqlClient();
    malformed.database.exec("CREATE TABLE oh_authority_commit_guards(value TEXT)");
    await expect(bootstrapOhLibSqlAuthorityV1(malformed)).rejects.toThrow(OhIntegrityError);
    malformed.close();

    const drifted = await bootstrappedClient();
    drifted.database.exec(`CREATE TRIGGER unexpected_authority_trigger
      BEFORE INSERT ON oh_authority_records BEGIN SELECT 1; END`);
    await expect(createOhLibSqlStoreAuthorityV1(drifted, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:drift", spaceId: "drift",
    })).rejects.toThrow(OhIntegrityError);
    drifted.close();
  });

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
    expect(await authority.store.snapshot({ head: { operationSha256: null, sequence: 0 } }))
      .toMatchObject({ head: { operationSha256: null, sequence: 0 }, records: [] });
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

  test("rejects orphaned idempotency rows and duplicated binding-column drift", async () => {
    const sourceClient = await bootstrappedClient();
    const source = await createOhLibSqlStoreAuthorityV1(sourceClient, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:remote-orphan", spaceId: "remote-orphan",
    });
    const changes = [{ kind: "put" as const, record: entity("entity:orphan", "Orphan"), v: 1 as const }];
    const operation = await source.store.commit({ actorId: "agent.remote", changes,
      expectedHead: await source.store.head(), operationId: "op_remote_orphan" });

    const targetClient = await bootstrappedClient();
    const target = await createOhLibSqlStoreAuthorityV1(targetClient, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:remote-orphan", spaceId: "remote-orphan",
    });
    targetClient.database.query(`INSERT INTO oh_authority_operations(operation_sha256, space_id,
      sequence, operation_id, parent_operation_sha256, graph_revision_sha256, records_sha256,
      operation_json, instant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      operation.operationSha256, operation.spaceId, operation.sequence, operation.operationId,
      operation.parentOperationSha256, operation.graphRevisionSha256, operation.recordsSha256,
      canonicalJson(operation), operation.instant,
    );
    await expect(target.store.commit({ actorId: operation.actorId, changes,
      expectedHead: await target.store.head(), operationId: operation.operationId }))
      .rejects.toThrow(OhIntegrityError);
    expect((await target.store.head()).sequence).toBe(0);
    targetClient.database.query("UPDATE oh_authority_bindings SET realm_id = ? WHERE space_id = ?")
      .run("realm:alien", "remote-orphan");
    await expect(createOhLibSqlStoreAuthorityV1(targetClient, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:remote-orphan", spaceId: "remote-orphan",
    })).rejects.toThrow(OhIntegrityError);
    await target.store.close(); await source.store.close(); targetClient.close(); sourceClient.close();
  });

  test("refuses snapshots and commits when the current head drifts from its operation", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:head-drift", spaceId: "head-drift",
    });
    await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:one", "One"), v: 1 }], expectedHead: await authority.store.head(),
    operationId: "op_head_one" });
    client.database.query("UPDATE oh_authority_spaces SET graph_revision_sha256 = ? WHERE space_id = ?")
      .run("f".repeat(64), "head-drift");
    const drifted = await authority.store.head();
    await expect(authority.store.snapshot()).rejects.toThrow(OhIntegrityError);
    await expect(authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:two", "Two"), v: 1 }], expectedHead: drifted,
    operationId: "op_head_two" })).rejects.toThrow(OhIntegrityError);
    expect((await authority.store.head()).sequence).toBe(1);
    await authority.store.close(); client.close();
  });

  test("detects record-column and operation-record tampering before advancing authority", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:tamper", spaceId: "tamper",
    });
    const record = entity("entity:tamper", "Tamper");
    await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put", record, v: 1 }],
      expectedHead: await authority.store.head(), operationId: "op_tamper" });
    const head = await authority.store.head();
    client.database.query(`UPDATE oh_authority_records SET record_sha256 = ?
      WHERE space_id = ? AND record_key = ?`).run("f".repeat(64), "tamper", record.key);
    await expect(authority.store.verify()).rejects.toThrow(OhIntegrityError);
    await expect(authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "tombstone",
      key: record.key, priorSha256: record.recordSha256, v: 1 }], expectedHead: head,
    operationId: "op_after_tamper" })).rejects.toThrow(OhIntegrityError);
    expect((await authority.store.head()).sequence).toBe(1);
    client.database.query(`UPDATE oh_authority_records SET record_sha256 = ?
      WHERE space_id = ? AND record_key = ?`).run(record.recordSha256, "tamper", record.key);
    expect(() => client.database.query("DELETE FROM oh_authority_operation_records WHERE space_id = ?")
      .run("tamper")).toThrow("require a purge receipt");
    client.database.exec("DROP TRIGGER oh_authority_operation_records_guard_delete");
    client.database.query("DELETE FROM oh_authority_operation_records WHERE space_id = ?").run("tamper");
    await expect(authority.store.verify()).rejects.toThrow(OhIntegrityError);
    await authority.store.close(); client.close();
  });

  test("refuses to extend noncanonical current-record provenance", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:provenance", spaceId: "provenance",
    });
    await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:first", "First"), v: 1 }], expectedHead: await authority.store.head(),
    operationId: "op_provenance_one" });
    await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:second", "Second"), v: 1 }], expectedHead: await authority.store.head(),
    operationId: "op_provenance_two" });
    const row = client.database.query<{ operation_json: string }, []>(`SELECT operation_json
      FROM oh_authority_operations WHERE operation_id = 'op_provenance_one'`).get();
    expect(row).not.toBeNull();
    const noncanonical = JSON.stringify(JSON.parse(row?.operation_json ?? "null"), null, 2);
    expect(() => client.database.query(`UPDATE oh_authority_operations SET operation_json = ?
      WHERE operation_id = 'op_provenance_one'`).run(noncanonical)).toThrow("immutable");
    client.database.exec("DROP TRIGGER oh_authority_operations_no_update");
    client.database.query(`UPDATE oh_authority_operations SET operation_json = ?
      WHERE operation_id = 'op_provenance_one'`).run(noncanonical);
    const head = await authority.store.head();
    await expect(authority.store.snapshot()).rejects.toThrow(OhIntegrityError);
    await expect(authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:third", "Third"), v: 1 }], expectedHead: head,
    operationId: "op_provenance_three" })).rejects.toThrow(OhIntegrityError);
    expect((await authority.store.head()).sequence).toBe(2);
    await authority.store.close(); client.close();
  });

  test("never reports a remote feed that omits its tail or hides a bad sentinel", async () => {
    const client = await bootstrappedClient();
    const populate = async (spaceId: string) => {
      const authority = await createOhLibSqlStoreAuthorityV1(client, {
        profile: OH_WORKING_STORE_PROFILE_V1, realmId: `realm:${spaceId}`, spaceId,
      });
      for (let index = 1; index <= 3; index += 1) {
        await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
          record: entity(`entity:${spaceId}-${index}`, `${spaceId} ${index}`), v: 1 }],
        expectedHead: await authority.store.head(), operationId: `op_${spaceId}_${index}` });
      }
      return authority;
    };
    const tail = await populate("feed-tail");
    const sentinel = await populate("feed-sentinel");
    client.database.exec("DROP TRIGGER oh_authority_operations_guard_delete");
    client.database.query("DELETE FROM oh_authority_operations WHERE space_id = ? AND sequence = 3")
      .run("feed-tail");
    await expect(tail.store.changesSince({ operationSha256: null, sequence: 0 }, { limit: 3 }))
      .rejects.toThrow(OhIntegrityError);
    client.database.query("DELETE FROM oh_authority_operations WHERE space_id = ? AND sequence = 2")
      .run("feed-sentinel");
    await expect(sentinel.store.changesSince({ operationSha256: null, sequence: 0 }, { limit: 1 }))
      .rejects.toThrow(OhIntegrityError);
    await tail.store.close(); await sentinel.store.close(); client.close();
  });

  test("enforces provider-safe operation, feed, and snapshot response bounds", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:provider-bounds", spaceId: "provider-bounds",
    });
    await expect(authority.store.changesSince({ operationSha256: null, sequence: 0 }, { limit: 16 }))
      .rejects.toThrow(RangeError);
    const oversized = entity("entity:oversized", "x".repeat(600_000));
    await expect(authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: oversized, v: 1 }], expectedHead: await authority.store.head(),
    operationId: "op_oversized" })).rejects.toThrow("canonical byte bound");
    expect((await authority.store.head()).sequence).toBe(0);

    await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:bounded", "Bounded"), v: 1 }], expectedHead: await authority.store.head(),
    operationId: "op_bounded" });
    client.database.query(`UPDATE oh_authority_records
      SET record_json = json_object('blob', hex(zeroblob(2200000))) WHERE space_id = ?`)
      .run("provider-bounds");
    await expect(authority.store.snapshot()).rejects.toThrow("provider-safe response bounds");
    await authority.store.close(); client.close();
  });

  test("keeps escape-heavy feeds and accepted history below the libSQL response ceiling", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:response-ceiling",
      spaceId: "response-ceiling",
    });
    const escaped = "\\\"\n".repeat(50_000);
    const heads = [];
    for (let index = 1; index <= 14; index += 1) {
      const operation = await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
        record: entity("entity:response-ceiling", `${String(index).padStart(2, "0")}:${escaped}`), v: 1 }],
      expectedHead: await authority.store.head(), operationId: `op_response_ceiling_${index}` });
      heads.push({ operationSha256: operation.operationSha256, sequence: operation.sequence });
    }
    expect(OH_LIBSQL_STORE_LIMITS_V1.changeFeedLimit).toBe(7);
    const page = await authority.store.changesSince({ operationSha256: null, sequence: 0 });
    expect(page.operations).toHaveLength(7);
    expect(page.hasMore).toBe(true);
    expect(client.lastBatchResponseBytes).toBeLessThan(10_000_000);

    const historical = await authority.store.snapshot({ head: heads[12]! });
    expect(historical.head.sequence).toBe(13);
    expect(client.lastBatchResponseBytes).toBeLessThan(10_000_000);
    await authority.store.close(); client.close();
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

  test("rejects new cross-space operation records and cleans legacy mismatches by owner", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:owner-purge", spaceId: "owner-purge",
    });
    const operation = await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:private", "Private"), v: 1 }], expectedHead: await authority.store.head(),
    operationId: "op_owner_private" });
    const insertMismatch = () => client.database.query(`INSERT INTO oh_authority_operation_records(
      space_id, operation_sha256, ordinal, record_key, change_kind, record_sha256)
      VALUES (?, ?, 1, ?, 'put', ?)`).run("alien-space", operation.operationSha256,
      "entity:alien", "f".repeat(64));
    expect(insertMismatch).toThrow("no owning operation");
    client.database.exec("DROP TRIGGER oh_authority_operation_records_guard_insert");
    insertMismatch();
    await authority.host.purgeWorkingSpace({ purgedAt: "2026-08-29T13:00:00.000Z" });
    expect(client.database.query<{ count: number }, []>(`SELECT count(*) AS count
      FROM oh_authority_operation_records`).get()?.count).toBe(0);
    await authority.store.close(); client.close();
  });

  test("cannot resurrect a space purged between open preflight and creation batch", async () => {
    const client = await bootstrappedClient();
    const original = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:open-purge-race", spaceId: "open-purge-race",
    });
    let interleaved = false;
    const racingClient: OhLibSqlClientV1 = {
      execute: async (statement) => {
        const result = await client.execute(statement);
        const sql = typeof statement === "string" ? statement : statement.sql;
        const firstArgument = typeof statement === "string" ? undefined : statement.args?.[0];
        if (!interleaved && firstArgument === "open-purge-race"
          && sql.includes("FROM oh_authority_purges WHERE space_id = ?")) {
          interleaved = true;
          await original.host.purgeWorkingSpace({ purgedAt: "2026-08-29T13:00:00.000Z" });
        }
        return result;
      },
      batch: async (statements, mode) => await client.batch(statements, mode),
    };
    await expect(createOhLibSqlStoreAuthorityV1(racingClient, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:open-purge-race", spaceId: "open-purge-race",
    })).rejects.toThrow(OhPurgedSpaceError);
    expect(interleaved).toBe(true);
    expect(client.database.query<{ count: number }, []>(`SELECT count(*) AS count
      FROM oh_authority_spaces WHERE space_id = 'open-purge-race'`).get()?.count).toBe(0);
    expect(client.database.query<{ count: number }, []>(`SELECT count(*) AS count
      FROM oh_authority_purges WHERE space_id = 'open-purge-race'`).get()?.count).toBe(1);
    client.close();
  });

  test("rolls purge back when any private payload row resists deletion", async () => {
    const client = await bootstrappedClient();
    const authority = await createOhLibSqlStoreAuthorityV1(client, {
      profile: OH_WORKING_STORE_PROFILE_V1, realmId: "realm:blocked-purge", spaceId: "blocked-purge",
    });
    await authority.store.commit({ actorId: "agent.remote", changes: [{ kind: "put",
      record: entity("entity:private", "Private"), v: 1 }], expectedHead: await authority.store.head(),
    operationId: "op_blocked_private" });
    client.database.exec(`CREATE TRIGGER block_record_delete BEFORE DELETE ON oh_authority_records
      BEGIN SELECT RAISE(IGNORE); END`);
    await expect(authority.host.purgeWorkingSpace({ purgedAt: "2026-08-29T13:00:00.000Z" }))
      .rejects.toThrow();
    expect(client.database.query<{ count: number }, []>(`SELECT count(*) AS count
      FROM oh_authority_purges WHERE space_id = 'blocked-purge'`).get()?.count).toBe(0);
    expect(client.database.query<{ count: number }, []>(`SELECT count(*) AS count
      FROM oh_authority_records WHERE space_id = 'blocked-purge'`).get()?.count).toBe(1);
    expect(client.database.query<{ count: number }, []>(`SELECT count(*) AS count
      FROM oh_authority_spaces WHERE space_id = 'blocked-purge'`).get()?.count).toBe(1);
    await authority.store.close(); client.close();
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
