type SqliteOpenOptions = Readonly<{ create: true; strict: true }>;

const MACOS_SQLITE_LIBRARY_CANDIDATES = Object.freeze([
  "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
  "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
]);

export type OhSqliteRuntimeDependencies<TDatabase> = Readonly<{
  exists: (path: string) => boolean;
  open: (path: string, options: SqliteOpenOptions) => TDatabase;
  platform: NodeJS.Platform;
  setCustomSQLite: (path: string) => boolean;
}>;

export type OhSqliteRuntime<TDatabase> = Readonly<{
  customLibrary: string | null;
  open: (path: string) => TDatabase;
}>;

function macosSqliteLibraryCandidates(): readonly string[] {
  return MACOS_SQLITE_LIBRARY_CANDIDATES;
}

/**
 * Bun can replace macOS' extension-disabled system SQLite only before the first
 * Database is constructed. Creating the opener here makes that ordering an
 * invariant rather than leaving optional semantic backends to configure it
 * after the authoritative store is already open.
 */
export function createOhSqliteRuntime<TDatabase>(
  dependencies: OhSqliteRuntimeDependencies<TDatabase>,
): OhSqliteRuntime<TDatabase> {
  let customLibrary: string | null = null;
  if (dependencies.platform === "darwin") {
    for (const candidate of macosSqliteLibraryCandidates()) {
      if (!dependencies.exists(candidate)) continue;
      try {
        if (!dependencies.setCustomSQLite(candidate)) continue;
        customLibrary = candidate;
        break;
      } catch {
        // SQLite may already be loaded by another consumer. Oh remains usable
        // without extensions; the optional semantic backend will report its
        // own precise availability error when opened.
      }
    }
  }

  return Object.freeze({
    customLibrary,
    open: (path: string) => dependencies.open(path, { create: true, strict: true }),
  });
}
