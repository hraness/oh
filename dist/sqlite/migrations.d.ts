import type { OhSqliteDatabase } from "./driver";
export declare const OH_SQLITE_SCHEMA_VERSION: 1;
export type OhSqliteMigration = Readonly<{
    name: string;
    sql: string;
    version: number;
}>;
export declare const OH_SQLITE_MIGRATIONS: readonly OhSqliteMigration[];
export declare function applyOhSqliteMigrations(database: OhSqliteDatabase): void;
//# sourceMappingURL=migrations.d.ts.map