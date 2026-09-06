import { type OhChangesPageV1, type OhCommitInputV1, type OhDependencyClosureV1, type OhHeadRefV1, type OhHeadV1, type OhSnapshotV1, type OhStoreBindingV1, type OhStoreHostControlV1, type OhStoreProfileV1, type OhStoreV1, type OhStoreVerificationV1 } from "../store";
import type { OhOperationV1 } from "../operation";
import { type OhSyncBundleV1 } from "../sync-model";
import type { OhSqliteDatabase } from "./driver";
import { OhSqliteStore, type OhOperationImportResultV1 } from "./store";
export type OhSqliteStoreAuthorityOptionsV1 = Readonly<{
    database?: OhSqliteDatabase;
    path?: string;
    profile?: OhStoreProfileV1;
    realmId?: string;
    spaceId?: string;
}>;
export interface OhSqliteCanonicalReplicationV1 {
    readonly binding: OhStoreBindingV1;
    exportBundle(input: Readonly<{
        after: OhHeadRefV1;
        limit?: number;
        through: OhHeadRefV1;
    }>): Promise<Readonly<{
        bundle: OhSyncBundleV1;
        from: OhChangesPageV1["from"];
        hasMore: boolean;
        through: OhChangesPageV1["through"];
        to: OhChangesPageV1["to"];
        v: 1;
    }>>;
    head(): Promise<OhHeadV1>;
    importBundle(input: Readonly<{
        bundle: unknown;
        expectedHead: OhHeadRefV1;
    }>): Promise<OhOperationImportResultV1>;
}
export interface OhSqliteStoreHostControlV1 extends OhStoreHostControlV1 {
    readonly replication: OhSqliteCanonicalReplicationV1 | null;
}
export type OhSqliteStoreAuthorityV1 = Readonly<{
    host: OhSqliteStoreHostControlV1;
    store: OhStoreV1;
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
export declare function createOhSqliteStoreAuthorityV1(options?: OhSqliteStoreAuthorityOptionsV1): OhSqliteStoreAuthorityV1;
//# sourceMappingURL=port.d.ts.map