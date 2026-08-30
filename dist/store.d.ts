import { type Sha256Hex } from "./canonical";
import { OhRecordCodecRegistry } from "./contract";
export { OhRecordCodecRegistry } from "./contract";
import { type KnowledgeGraphChangeV1, type KnowledgeGraphRecordKindV1, type KnowledgeGraphRecordV1 } from "./graph";
import { type OhOperationV1 } from "./operation";
export declare class OhConflictError extends Error {
    constructor(message: string);
}
export declare class OhIntegrityError extends Error {
    constructor(message: string);
}
export declare class OhDependencyError extends Error {
    constructor(message: string);
}
export declare class OhProfileError extends Error {
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
export type OhHeadRefV1 = Pick<OhHeadV1, "operationSha256" | "sequence">;
export type OhCommitInputV1 = Readonly<{
    actorId: string;
    changes: readonly KnowledgeGraphChangeV1[];
    expectedHead: Pick<OhHeadV1, "generation" | "operationSha256">;
    instant?: string;
    operationId: string;
}>;
export type OhSnapshotV1 = Readonly<{
    head: OhHeadV1;
    records: readonly KnowledgeGraphRecordV1[];
    v: 1;
}>;
export type OhChangesPageV1 = Readonly<{
    from: OhHeadRefV1;
    hasMore: boolean;
    operations: readonly OhOperationV1[];
    through: OhHeadV1;
    to: OhHeadRefV1;
    v: 1;
}>;
export type OhStoreVerificationV1 = Readonly<{
    head: OhHeadV1;
    integrity: "verified";
    operations: number;
    records: number;
    v: 1;
}>;
export type OhStoreCapabilitiesV1 = Readonly<{
    changesSince: true;
    dependencyClosureExport: true;
    exactSnapshots: true;
    operationReplication: boolean;
    semanticBundleCommit: true;
    v: 1;
    wholeSpacePurge: boolean;
}>;
export type OhStoreProfileV1 = Readonly<{
    applicationProfileSha256: Sha256Hex | null;
    capabilities: OhStoreCapabilitiesV1;
    profileId: string;
    profileKind: "canonical" | "working";
    profileSha256: Sha256Hex;
    v: 1;
}>;
export type OhStoreBindingV1 = Readonly<{
    bindingSha256: Sha256Hex;
    contractSha256: Sha256Hex;
    profile: OhStoreProfileV1;
    realmId: string;
    spaceId: string;
    v: 1;
}>;
export declare const OH_CANONICAL_STORE_PROFILE_V1: Readonly<{
    applicationProfileSha256: Sha256Hex | null;
    capabilities: OhStoreCapabilitiesV1;
    profileId: string;
    profileKind: "canonical" | "working";
    profileSha256: Sha256Hex;
    v: 1;
}>;
export declare const OH_WORKING_STORE_PROFILE_V1: Readonly<{
    applicationProfileSha256: Sha256Hex | null;
    capabilities: OhStoreCapabilitiesV1;
    profileId: string;
    profileKind: "canonical" | "working";
    profileSha256: Sha256Hex;
    v: 1;
}>;
export type OhDependencyClosureV1 = Readonly<{
    binding: OhStoreBindingV1;
    closureSha256: Sha256Hex;
    head: OhHeadV1;
    records: readonly KnowledgeGraphRecordV1[];
    roots: readonly string[];
    v: 1;
}>;
export declare const OH_DEPENDENCY_CLOSURE_LIMITS_V1: Readonly<{
    bytes: number;
    records: 8192;
    roots: 1024;
}>;
export type OhSpacePurgeReceiptV1 = Readonly<{
    bindingSha256: Sha256Hex;
    priorHead: OhHeadV1;
    purgedAt: string;
    receiptSha256: Sha256Hex;
    spaceId: string;
    v: 1;
}>;
export declare class OhPurgedSpaceError extends Error {
    readonly receipt: OhSpacePurgeReceiptV1;
    constructor(receipt: OhSpacePurgeReceiptV1);
}
export interface OhStoreV1 {
    readonly binding: OhStoreBindingV1;
    changesSince(from: OhHeadRefV1, options?: Readonly<{
        limit?: number;
        through?: OhHeadRefV1;
    }>): Promise<OhChangesPageV1>;
    close(): Promise<void>;
    commit(input: OhCommitInputV1): Promise<OhOperationV1>;
    exportDependencyClosure(input: Readonly<{
        head?: OhHeadRefV1;
        maximumRecords?: number;
        roots: readonly string[];
    }>): Promise<OhDependencyClosureV1>;
    head(): Promise<OhHeadV1>;
    snapshot(options?: Readonly<{
        head?: OhHeadRefV1;
        maximumRecords?: number;
    }>): Promise<OhSnapshotV1>;
    verify(): Promise<OhStoreVerificationV1>;
}
/** Kept separate so an agent-facing store object never carries deletion authority. */
export interface OhStoreHostControlV1 {
    readonly binding: OhStoreBindingV1;
    purgeWorkingSpace(input: Readonly<{
        purgedAt?: string;
    }>): Promise<OhSpacePurgeReceiptV1>;
}
export type OhStoreAuthorityV1 = Readonly<{
    host: OhStoreHostControlV1;
    store: OhStoreV1;
}>;
export declare function emptyOhHeadV1(): OhHeadV1;
export declare function parseOhHeadV1(value: unknown): OhHeadV1 | null;
export declare function parseOhHeadRefV1(value: unknown): OhHeadRefV1 | null;
type OhStoreProfileInputV1 = Omit<OhStoreProfileV1, "profileSha256">;
export declare function createOhStoreProfileV1(input: OhStoreProfileInputV1): OhStoreProfileV1;
export declare function parseOhStoreProfileV1(value: unknown): OhStoreProfileV1 | null;
export declare function createOhStoreBindingV1(input: Readonly<{
    profile: OhStoreProfileV1;
    realmId: string;
    spaceId: string;
    v: 1;
}>): OhStoreBindingV1;
export declare function parseOhStoreBindingV1(value: unknown): OhStoreBindingV1 | null;
export declare function replayOhOperationsV1(spaceId: string, values: readonly OhOperationV1[], maximumRecords?: number): OhSnapshotV1;
export declare function transitionOhSnapshotV1(input: Readonly<{
    actorId: string;
    changes: readonly KnowledgeGraphChangeV1[];
    instant: string;
    operationId: string;
    snapshot: OhSnapshotV1;
    spaceId: string;
}>): Readonly<{
    operation: OhOperationV1;
    snapshot: OhSnapshotV1;
}>;
export declare function createOhDependencyClosureV1(input: Readonly<{
    binding: OhStoreBindingV1;
    maximumRecords?: number;
    roots: readonly string[];
    snapshot: OhSnapshotV1;
}>): OhDependencyClosureV1;
export declare function parseOhDependencyClosureV1(value: unknown): OhDependencyClosureV1 | null;
export declare function verifyOhDependencyClosureV1(value: unknown): Readonly<{
    closure: OhDependencyClosureV1;
    ok: true;
}> | Readonly<{
    ok: false;
    reason: "invalid-closure";
}>;
/**
 * Strong adoption check. Unlike structural self-verification, this also binds
 * the capsule to the exact store binding and head selected by trusted host code.
 */
export declare function verifyOhDependencyClosureAgainstV1(value: unknown, expected: Readonly<{
    binding: OhStoreBindingV1;
    head: OhHeadV1;
}>): Readonly<{
    closure: OhDependencyClosureV1;
    ok: true;
    verification: "expected-authority-and-head";
}> | Readonly<{
    ok: false;
    reason: "binding-mismatch" | "head-mismatch" | "invalid-closure" | "invalid-expectation";
}>;
export declare function createOhSpacePurgeReceiptV1(input: Readonly<{
    binding: OhStoreBindingV1;
    priorHead: OhHeadV1;
    purgedAt: string;
}>): OhSpacePurgeReceiptV1;
export declare function parseOhSpacePurgeReceiptV1(value: unknown): OhSpacePurgeReceiptV1 | null;
export type OhSemanticBundleV1 = Readonly<{
    actorId: string;
    expectedHead: Pick<OhHeadV1, "generation" | "operationSha256">;
    instant: string | null;
    operationId: string;
    puts: readonly Readonly<{
        dependencies: readonly string[];
        key: string;
        kind: KnowledgeGraphRecordKindV1;
        v: 1;
        value: unknown;
    }>[];
    tombstones: readonly Readonly<{
        key: string;
        priorSha256: Sha256Hex;
        v: 1;
    }>[];
    v: 1;
}>;
/** A strict model-facing ingress: every put must have a registered codec. */
export declare class OhSemanticBundleIngressV1 {
    #private;
    constructor(store: OhStoreV1, codecs: OhRecordCodecRegistry);
    commit(value: unknown): Promise<OhOperationV1>;
}
//# sourceMappingURL=store.d.ts.map