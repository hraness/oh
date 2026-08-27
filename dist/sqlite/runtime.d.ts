type SqliteOpenOptions = Readonly<{
    create: true;
    strict: true;
}>;
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
/**
 * Bun can replace macOS' extension-disabled system SQLite only before the first
 * Database is constructed. Creating the opener here makes that ordering an
 * invariant rather than leaving optional semantic backends to configure it
 * after the authoritative store is already open.
 */
export declare function createOhSqliteRuntime<TDatabase>(dependencies: OhSqliteRuntimeDependencies<TDatabase>): OhSqliteRuntime<TDatabase>;
export {};
//# sourceMappingURL=runtime.d.ts.map