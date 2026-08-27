import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";

import { createOhSqliteRuntime } from "./runtime";

export type OhSqliteDatabase = Database;

const SQLITE_RUNTIME = createOhSqliteRuntime({
  exists: existsSync,
  open: (path, options) => new Database(path, options),
  platform: process.platform,
  setCustomSQLite: (path) => Database.setCustomSQLite(path),
});

export function openOhSqliteDatabase(path: string): OhSqliteDatabase {
  const database = SQLITE_RUNTIME.open(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA trusted_schema = OFF");
  return database;
}

export function withImmediateTransaction<T>(database: OhSqliteDatabase, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* preserve the original failure */ }
    throw error;
  }
}
