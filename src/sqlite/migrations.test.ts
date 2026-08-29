import { describe, expect, test } from "bun:test";

import { canonicalNow, sha256Hex } from "../canonical";
import { openOhSqliteDatabase } from "./driver";
import { OH_SQLITE_MIGRATIONS, OH_SQLITE_SCHEMA_VERSION } from "./migrations";
import { OhSqliteStore } from "./store";

describe("SQLite schema evolution", () => {
  test("preserves the released 0001 bytes and appends store realms as version 2", () => {
    expect(OH_SQLITE_SCHEMA_VERSION).toBe(2);
    expect(OH_SQLITE_MIGRATIONS.map(({ name, version }) => ({ name, version }))).toEqual([
      { name: "0001_oh_core", version: 1 },
      { name: "0002_store_realms", version: 2 },
    ]);
    expect(String(sha256Hex(OH_SQLITE_MIGRATIONS[0]?.sql ?? ""))).toBe(
      "f525fc4f521b544d8e00526f2993a3b6bf81ae936950765c51406566ea4b1b7c",
    );
  });

  test("upgrades an applied version-1 authority without rewriting its migration evidence", () => {
    const database = openOhSqliteDatabase(":memory:");
    const first = OH_SQLITE_MIGRATIONS[0];
    if (first === undefined) throw new Error("Missing first migration.");
    database.exec(`CREATE TABLE oh_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      migration_sha256 TEXT NOT NULL CHECK(length(migration_sha256) = 64),
      applied_at TEXT NOT NULL
    ) STRICT`);
    database.exec(first.sql);
    database.query(`INSERT INTO oh_migrations(version, name, migration_sha256, applied_at)
      VALUES (?, ?, ?, ?)`).run(first.version, first.name, sha256Hex(first.sql), canonicalNow());

    const store = new OhSqliteStore({ database, spaceId: "upgraded" });
    expect(store.contract().sqliteSchemaVersion).toBe(2);
    expect(database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM oh_migrations",
    ).get()?.count).toBe(2);
    expect(database.query<{ count: number }, []>(
      "SELECT count(*) AS count FROM sqlite_schema WHERE name IN ('oh_space_bindings', 'oh_space_purges')",
    ).get()?.count).toBe(2);
    store.close();
  });
});
