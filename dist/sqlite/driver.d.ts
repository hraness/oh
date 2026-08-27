import { Database } from "bun:sqlite";
export type OhSqliteDatabase = Database;
export declare function openOhSqliteDatabase(path: string): OhSqliteDatabase;
export declare function withImmediateTransaction<T>(database: OhSqliteDatabase, work: () => T): T;
//# sourceMappingURL=driver.d.ts.map