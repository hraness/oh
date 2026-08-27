import { describe, expect, test } from "bun:test";

import { createOhSqliteRuntime } from "./runtime";

describe("Bun SQLite runtime initialization", () => {
  test("selects Homebrew SQLite before constructing the first database", () => {
    const events: string[] = [];
    const library = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
    const runtime = createOhSqliteRuntime({
      exists: (path) => {
        events.push(`exists:${path}`);
        return path === library;
      },
      open: (path, options) => {
        events.push(`open:${path}:${String(options.create)}:${String(options.strict)}`);
        return { path };
      },
      platform: "darwin",
      setCustomSQLite: (path) => {
        events.push(`set:${path}`);
        return true;
      },
    });

    expect(runtime.customLibrary).toBe(library);
    expect(events).toEqual([`exists:${library}`, `set:${library}`]);
    expect(runtime.open("authority.sqlite")).toEqual({ path: "authority.sqlite" });
    expect(events).toEqual([
      `exists:${library}`,
      `set:${library}`,
      "open:authority.sqlite:true:true",
    ]);
  });

  test("falls back across standard macOS paths without trying duplicates", () => {
    const attempted: string[] = [];
    const appleSilicon = "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib";
    const intel = "/usr/local/opt/sqlite/lib/libsqlite3.dylib";
    const runtime = createOhSqliteRuntime({
      exists: () => true,
      open: () => ({}),
      platform: "darwin",
      setCustomSQLite: (path) => {
        attempted.push(path);
        return path === intel;
      },
    });

    expect(attempted).toEqual([appleSilicon, intel]);
    expect(runtime.customLibrary).toBe(intel);
  });

  test("does not inspect or configure custom libraries outside macOS", () => {
    let inspected = false;
    let configured = false;
    const runtime = createOhSqliteRuntime({
      exists: () => { inspected = true; return true; },
      open: (path) => path,
      platform: "linux",
      setCustomSQLite: () => { configured = true; return true; },
    });

    expect(runtime.customLibrary).toBeNull();
    expect(inspected).toBe(false);
    expect(configured).toBe(false);
    expect(runtime.open(":memory:")).toBe(":memory:");
  });
});
