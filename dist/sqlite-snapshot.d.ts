export type SnapshotOptions = Readonly<{
    sourcePath: string;
    outputDirectory: string;
    maxFileBytes?: number;
    maxTotalBytes?: number;
}>;
export type Snapshot = Readonly<{
    databasePath: string;
    walPath: string | null;
    journalPath: string | null;
    totalBytes: number;
}>;
export type SnapshotErrorDetails = Readonly<{
    error: string;
    [key: string]: unknown;
}>;
export declare class SnapshotSidecarNotFoundError extends Error {
    readonly platform: string;
    readonly arch: string;
    readonly binaryPath: string;
    readonly name: "SnapshotSidecarNotFoundError";
    constructor(platform: string, arch: string, binaryPath: string);
}
export declare class SnapshotTimeoutError extends Error {
    readonly timeoutMs: number;
    readonly name: "SnapshotTimeoutError";
    constructor(timeoutMs: number);
}
export declare class SnapshotProtocolError extends Error {
    readonly reason: unknown;
    readonly stdout: string;
    readonly name: "SnapshotProtocolError";
    constructor(reason: unknown, stdout: string);
}
export declare class SnapshotError extends Error {
    readonly code: string;
    readonly details: SnapshotErrorDetails;
    readonly name: "SnapshotError";
    constructor(code: string, details: SnapshotErrorDetails);
}
export declare function sidecarBinaryPath(platform?: string, arch?: string): string;
/**
 * Isolate a SQLite database and its WAL/journal sidecars using the product-neutral
 * oh-sqlite-cli sidecar binary shipped with this package.
 *
 * The original source files are never modified. On success the returned paths point
 * to the private copies inside `outputDirectory`.
 */
export declare function snapshotDatabase(options: SnapshotOptions): Promise<Snapshot>;
/**
 * Synchronous variant of {@link snapshotDatabase}. Useful for callers that need
 * a blocking, single-process snapshot for a small database.
 */
export declare function snapshotDatabaseSync(options: SnapshotOptions): Snapshot;
//# sourceMappingURL=sqlite-snapshot.d.ts.map