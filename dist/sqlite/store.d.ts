import { type Sha256Hex } from "../canonical";
import { OH_CONTRACT_MANIFEST_V1 } from "../contract";
import { type KnowledgeGraphRecordKindV1, type KnowledgeGraphRecordV1 } from "../graph";
import { type OhOperationV1 } from "../operation";
import { OhConflictError, OhDependencyError, OhIntegrityError, OhProfileError, OhPurgedSpaceError, type OhChangesPageV1, type OhCommitInputV1, type OhDependencyClosureV1, type OhHeadRefV1, type OhHeadV1, type OhSnapshotV1, type OhSpacePurgeReceiptV1, type OhStoreBindingV1 } from "../store";
import { type OhSqliteDatabase } from "./driver";
export { OhConflictError, OhDependencyError, OhIntegrityError, OhProfileError, OhPurgedSpaceError, };
export type { OhCommitInputV1, OhHeadV1 };
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
    bind(bindingValue: OhStoreBindingV1): OhStoreBindingV1;
    binding(): OhStoreBindingV1 | null;
    head(): OhHeadV1;
    commit(input: OhCommitInputV1): OhOperationV1;
    importOperation(value: unknown): Readonly<{
        imported: boolean;
        operation: OhOperationV1;
    }>;
    exportOperations(afterSequence?: number, limit?: number): readonly OhOperationV1[];
    snapshotAtHead(options?: Readonly<{
        head?: OhHeadRefV1;
        maximumRecords?: number;
    }>): OhSnapshotV1;
    changesSince(fromValue: OhHeadRefV1, options?: Readonly<{
        limit?: number;
        through?: OhHeadRefV1;
    }>): OhChangesPageV1;
    exportDependencyClosure(input: Readonly<{
        binding: OhStoreBindingV1;
        head?: OhHeadRefV1;
        maximumRecords?: number;
        roots: readonly string[];
    }>): OhDependencyClosureV1;
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
    /** Host control-plane primitive. Do not expose this method through agent tools. */
    purgeWorkingSpace(bindingValue: OhStoreBindingV1, purgedAt?: string): OhSpacePurgeReceiptV1;
    close(): void;
}
//# sourceMappingURL=store.d.ts.map