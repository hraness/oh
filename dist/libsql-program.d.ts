import { Effect } from "effect";
import { type Sha256Hex } from "./canonical";
import { type OhOperationV1 } from "./operation";
import { type OhChangesPageV1, type OhCommitInputV1, type OhDependencyClosureV1, type OhHeadRefV1, type OhHeadV1, type OhSnapshotV1, type OhSpacePurgeReceiptV1, type OhStoreBindingV1, type OhStoreVerificationV1 } from "./store";
import { type OhLibSqlStoreAuthorityOptionsV1 } from "./libsql-model";
import { type LibSqlFailure, type LibSqlAuthorityClientService } from "./libsql-platform";
/** One-time schema operation for a client authorized to create authority tables. */
export declare function bootstrapAuthority(client: LibSqlAuthorityClientService): Effect.Effect<Readonly<{
    schemaSha256: Sha256Hex;
    schemaVersion: 1;
    v: 1;
}>, LibSqlFailure>;
export declare class LibSqlStoreProgram {
    #private;
    readonly binding: OhStoreBindingV1;
    constructor(client: LibSqlAuthorityClientService, binding: OhStoreBindingV1);
    closedFailure(): LibSqlFailure;
    purgeFromHost(input: Readonly<{
        purgedAt?: string;
    }>): Effect.Effect<OhSpacePurgeReceiptV1, LibSqlFailure>;
    head(): Effect.Effect<OhHeadV1, LibSqlFailure>;
    snapshot(options?: Readonly<{
        head?: OhHeadRefV1;
        maximumRecords?: number;
    }>): Effect.Effect<OhSnapshotV1, LibSqlFailure>;
    changesSince(fromValue: OhHeadRefV1, options?: Readonly<{
        limit?: number;
        through?: OhHeadRefV1;
    }>): Effect.Effect<OhChangesPageV1, LibSqlFailure>;
    commit(input: OhCommitInputV1): Effect.Effect<OhOperationV1, LibSqlFailure>;
    exportDependencyClosure(input: Readonly<{
        head?: OhHeadRefV1;
        maximumRecords?: number;
        roots: readonly string[];
    }>): Effect.Effect<OhDependencyClosureV1, LibSqlFailure>;
    verify(): Effect.Effect<OhStoreVerificationV1, LibSqlFailure>;
    purgeWorkingSpace(purgedAt: string): Effect.Effect<OhSpacePurgeReceiptV1, LibSqlFailure>;
}
/** Opens a direct libSQL/Turso authority; this is not operation-log sync. */
export declare function createAuthority(client: LibSqlAuthorityClientService, options?: OhLibSqlStoreAuthorityOptionsV1): Effect.Effect<LibSqlStoreProgram, LibSqlFailure>;
/**
 * Opens an already-bound direct libSQL/Turso authority without creating or
 * updating data. This seam is for separately held read or purge custody that
 * must fail closed instead of acquiring space-creation authority.
 */
export declare function openExistingAuthority(client: LibSqlAuthorityClientService, options?: OhLibSqlStoreAuthorityOptionsV1): Effect.Effect<LibSqlStoreProgram, LibSqlFailure>;
/**
 * Purges an existing working authority or atomically fences its exact binding
 * when creation never completed. The empty-space receipt prevents a delayed
 * creator from resurrecting abandoned custody without granting the purge
 * credential permission to create a space or binding.
 */
export declare function purgeWorkingSpace(client: LibSqlAuthorityClientService, options?: OhLibSqlStoreAuthorityOptionsV1 & Readonly<{
    purgedAt?: string;
}>): Effect.Effect<OhSpacePurgeReceiptV1, LibSqlFailure>;
/** Admission and drain are one local authority lifetime. SQL still arbitrates
 * concurrent commits; this gate does not serialize independent operations. */
export declare const makeLibSqlOwner: Effect.Effect<{
    admit: Effect.Effect<boolean, never, never>;
    beginClose: Effect.Effect<void, never, never>;
    drained: Effect.Effect<void, never, never>;
    complete: <A>(operation: Effect.Effect<A, LibSqlFailure>) => Effect.Effect<A, LibSqlFailure>;
}, never, never>;
//# sourceMappingURL=libsql-program.d.ts.map