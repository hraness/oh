import { type OhChangesPageV1, type OhCommitInputV1, type OhDependencyClosureV1, type OhHeadRefV1, type OhHeadV1, type OhSnapshotV1, type OhStoreAuthorityV1, type OhStoreBindingV1, type OhStoreProfileV1, type OhStoreV1, type OhStoreVerificationV1 } from "../store";
import type { OhOperationV1 } from "../operation";
import type { OhSqliteDatabase } from "./driver";
import { OhSqliteStore } from "./store";
export type OhSqliteStoreAuthorityOptionsV1 = Readonly<{
    database?: OhSqliteDatabase;
    path?: string;
    profile?: OhStoreProfileV1;
    realmId?: string;
    spaceId?: string;
}>;
export declare class OhSqliteStorePortV1 implements OhStoreV1 {
    #private;
    readonly binding: OhStoreBindingV1;
    constructor(authority: OhSqliteStore, binding: OhStoreBindingV1);
    head(): Promise<OhHeadV1>;
    snapshot(options?: Readonly<{
        head?: OhHeadRefV1;
        maximumRecords?: number;
    }>): Promise<OhSnapshotV1>;
    changesSince(from: OhHeadRefV1, options?: Readonly<{
        limit?: number;
        through?: OhHeadRefV1;
    }>): Promise<OhChangesPageV1>;
    commit(input: OhCommitInputV1): Promise<OhOperationV1>;
    exportDependencyClosure(input: Readonly<{
        head?: OhHeadRefV1;
        maximumRecords?: number;
        roots: readonly string[];
    }>): Promise<OhDependencyClosureV1>;
    verify(): Promise<OhStoreVerificationV1>;
    close(): Promise<void>;
}
/**
 * Binds a Bun SQLite authority to the promise-based store port. Retain the
 * returned `host` object in trusted control-plane code; pass only `store` to
 * ordinary consumers.
 */
export declare function createOhSqliteStoreAuthorityV1(options?: OhSqliteStoreAuthorityOptionsV1): OhStoreAuthorityV1;
//# sourceMappingURL=port.d.ts.map