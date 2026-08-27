import { type Sha256Hex } from "../canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "../contract";
import { type KnowledgeGraphChangeV1, type KnowledgeGraphRecordKindV1, type KnowledgeGraphRecordV1 } from "../graph";
import { type OhOperationV1 } from "../operation";
import { type OhSqliteDatabase } from "./driver";
export declare class OhConflictError extends Error {
    constructor(message: string);
}
export declare class OhIntegrityError extends Error {
    constructor(message: string);
}
export declare class OhDependencyError extends Error {
    constructor(message: string);
}
export type OhHeadV1 = Readonly<{
    generation: number;
    graphRevisionSha256: Sha256Hex | null;
    operationSha256: Sha256Hex | null;
    recordsSha256: Sha256Hex;
    sequence: number;
    v: 1;
}>;
export type OhCommitInputV1 = Readonly<{
    actorId: string;
    changes: readonly KnowledgeGraphChangeV1[];
    expectedHead: Pick<OhHeadV1, "generation" | "operationSha256">;
    instant?: string;
    operationId: string;
}>;
export type OhRecordListOptions = Readonly<{
    kind?: KnowledgeGraphRecordKindV1;
    limit?: number;
}>;
export type OhKeywordSearchResultV1 = Readonly<{
    key: string;
    kind: KnowledgeGraphRecordKindV1;
    recordSha256: Sha256Hex;
    score: number;
    snippet: string;
    v: 1;
}>;
export type OhReplayVerificationV1 = Readonly<{
    head: OhHeadV1;
    operations: number;
    records: number;
    sqliteIntegrity: "ok";
    v: 1;
}>;
export declare class OhSqliteStore {
    #private;
    readonly database: OhSqliteDatabase;
    readonly spaceId: string;
    constructor(options?: Readonly<{
        database?: OhSqliteDatabase;
        path?: string;
        spaceId?: string;
    }>);
    ensureSpace(): OhHeadV1;
    head(): OhHeadV1;
    commit(input: OhCommitInputV1): OhOperationV1;
    importOperation(value: unknown): Readonly<{
        imported: boolean;
        operation: OhOperationV1;
    }>;
    exportOperations(afterSequence?: number, limit?: number): readonly OhOperationV1[];
    get(key: string): KnowledgeGraphRecordV1 | null;
    list(options?: OhRecordListOptions): readonly KnowledgeGraphRecordV1[];
    snapshotRecords(maximum?: number): readonly KnowledgeGraphRecordV1[];
    log(limit?: number): readonly OhOperationV1[];
    searchKeyword(query: string, limit?: number): readonly OhKeywordSearchResultV1[];
    syncState(remoteId: string): Readonly<{
        pulledSequence: number;
        pushedSequence: number;
        remoteHeadSha256: Sha256Hex | null;
    }>;
    updateSyncState(remoteId: string, state: Readonly<{
        pulledSequence: number;
        pushedSequence: number;
        remoteHeadSha256: Sha256Hex | null;
    }>): void;
    verifyReplay(): OhReplayVerificationV1;
    contract(): Readonly<{
        manifest: typeof OH_CONTRACT_MANIFEST_V1;
        sqliteSchemaVersion: number;
    }>;
    close(): void;
}
//# sourceMappingURL=store.d.ts.map