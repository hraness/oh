import { type Sha256Hex } from "./canonical";
import { OhIntegrityError } from "./errors";
import { type KnowledgeGraphRecordV1 } from "./graph";
import { type OhHeadRefV1, type OhHeadV1, type OhStoreV1 } from "./store";
export declare const OH_MEMORY_CONTEXT_FORMAT_VERSION_V1: 1;
export declare const OH_MEMORY_CONTEXT_LANES_V1: readonly ["canonical", "working"];
export type OhMemoryContextLaneV1 = (typeof OH_MEMORY_CONTEXT_LANES_V1)[number];
export declare const OH_MEMORY_CONTEXT_LIMITS_V1: Readonly<{
    readonly bindings: 2;
    readonly changeFeedPage: 1000;
    readonly continuationBytes: number;
    readonly continuationKeyBytes: 32;
    readonly detailedIndices: 1024;
    readonly leafFetchesPerRead: 128;
    readonly leaves: 4096;
    readonly pageBytes: number;
    readonly pageItems: 64;
    readonly poolBytes: number;
    readonly scannedBytes: number;
    readonly searchMatches: 256;
    readonly searchPatternBytes: 512;
    readonly summariesPerGeneration: 2048;
    readonly summaryBodyBytes: number;
    readonly summaryChildren: 2;
}>;
export declare const OH_MEMORY_CONTEXT_CONTINUATION_LIFETIME_MS_V1: number;
export type OhMemoryContextDenialReasonV1 = "authorization" | "availability" | "budget" | "integrity" | "stale";
/** A denied or inconsistent progressive-memory read; the original class survives bundling. */
export declare class OhMemoryContextError extends OhIntegrityError {
    readonly reason: OhMemoryContextDenialReasonV1;
    constructor(reason: OhMemoryContextDenialReasonV1, message: string);
}
export type OhMemoryContextContinuationReasonV1 = "authentication" | "encoding" | "expired" | "identity";
/** A caller-supplied continuation cannot be decoded, authenticated, or rebound exactly. */
export declare class OhMemoryContextContinuationError extends OhIntegrityError {
    readonly code: "memory-context-continuation";
    readonly reason: OhMemoryContextContinuationReasonV1;
    constructor(reason: OhMemoryContextContinuationReasonV1, message: string);
}
/** One log change: the record a put wrote, or the digest a tombstone removed. */
export type OhMemoryContextLeafV1 = Readonly<{
    changeIndex: number;
    instant: string;
    key: string;
    kind: "put" | "tombstone";
    lane: OhMemoryContextLaneV1;
    /** Whether the record still exists at the captured head with this digest. */
    live: boolean;
    operationSha256: Sha256Hex;
    parentOperationSha256: Sha256Hex | null;
    recordSha256: Sha256Hex;
    sequence: number;
    v: 1;
}>;
export declare function ohMemoryContextLeafSha256V1(leaf: OhMemoryContextLeafV1): Sha256Hex;
/** The captured binding and pinned head for one lane. */
export type OhMemoryContextLaneBindingV1 = Readonly<{
    bindingSha256: Sha256Hex;
    head: OhHeadV1;
    lane: OhMemoryContextLaneV1;
}>;
/**
 * A captured, ordered list of log changes across one or both lanes. The
 * capture is self-describing: it carries the bindings and heads it was taken
 * against, so a later reader can detect a rebound store or a rolled-back log.
 * Leaves are ordered by each operation's recorded instant, then lane,
 * sequence, and change index — a deterministic merge, not a permission claim.
 */
export type OhMemoryContextHistoryV1 = Readonly<{
    bindings: readonly OhMemoryContextLaneBindingV1[];
    leaves: readonly OhMemoryContextLeafV1[];
    v: 1;
}>;
export declare function ohMemoryContextHistorySha256V1(history: OhMemoryContextHistoryV1): Sha256Hex;
export declare function parseOhMemoryContextHistoryV1(value: unknown): OhMemoryContextHistoryV1;
/** A binary range over the captured leaves, aligned to its own size. */
export type OhMemoryContextNodeV1 = Readonly<{
    end: number;
    historySha256: Sha256Hex;
    sourcesSha256: Sha256Hex;
    start: number;
    v: 1;
}>;
export declare function createOhMemoryContextNodeV1(history: OhMemoryContextHistoryV1, start: number, end: number): OhMemoryContextNodeV1;
export declare function ohMemoryContextNodeSha256V1(node: OhMemoryContextNodeV1): Sha256Hex;
export declare function parseOhMemoryContextNodeV1(value: unknown): OhMemoryContextNodeV1;
/**
 * A host-supplied summary over one node. It is a detached reading aid with
 * explicit lineage, never an Oh store record and never a query premise.
 */
export type OhMemoryContextSummaryV1 = Readonly<{
    body: string;
    childrenSha256s: readonly Sha256Hex[];
    historySha256: Sha256Hex;
    nodeSha256: Sha256Hex;
    policySha256: Sha256Hex;
    promptSha256: Sha256Hex;
    sourcesSha256: Sha256Hex;
    summarizerSha256: Sha256Hex;
    v: 1;
}>;
export declare function ohMemoryContextSummarySha256V1(summary: OhMemoryContextSummaryV1): Sha256Hex;
export declare function parseOhMemoryContextSummaryV1(value: unknown): OhMemoryContextSummaryV1;
/** One generation of derivative summaries; a later correction increments it. */
export type OhMemoryContextGenerationV1 = Readonly<{
    generation: number;
    historySha256: Sha256Hex;
    policySha256: Sha256Hex;
    promptSha256: Sha256Hex;
    summarizerSha256: Sha256Hex;
    summaries: readonly Readonly<{
        nodeSha256: Sha256Hex;
        summarySha256: Sha256Hex;
    }>[];
    v: 1;
}>;
export declare function ohMemoryContextGenerationSha256V1(generation: OhMemoryContextGenerationV1): Sha256Hex;
export declare function parseOhMemoryContextGenerationV1(value: unknown): OhMemoryContextGenerationV1;
/** The records host code supplies when it publishes one derivative generation. */
export type OhMemoryContextPoolV1 = Readonly<{
    generation: OhMemoryContextGenerationV1;
    nodes: readonly OhMemoryContextNodeV1[];
    summaries: readonly OhMemoryContextSummaryV1[];
}>;
export declare function parseOhMemoryContextPoolV1(history: OhMemoryContextHistoryV1, value: unknown): OhMemoryContextPoolV1;
/** The host's current permission decision for one admitted capture. */
export type OhMemoryContextAccessV1 = Readonly<{
    historySha256: Sha256Hex;
    /** Permitted leaf positions, or `null` for all leaves. */
    indices: readonly number[] | null;
    /** Permitted lanes, or `null` for every captured lane. */
    lanes: readonly OhMemoryContextLaneV1[] | null;
    revision: number;
    state: "active" | "revoked";
    v: 1;
}>;
export declare function parseOhMemoryContextAccessV1(value: unknown): OhMemoryContextAccessV1;
export type OhMemoryContextRefV1 = Readonly<{
    historySha256: Sha256Hex;
    v: 1;
}>;
export declare function ohMemoryContextRefSha256V1(ref: OhMemoryContextRefV1): Sha256Hex;
/** Per-lane capture bound: `from` is exclusive, `through` pins the upper head. */
export type OhMemoryContextCaptureBoundV1 = Readonly<{
    from?: OhHeadRefV1;
    store: OhStoreV1;
    through?: OhHeadRefV1;
}>;
/**
 * Walks the change feed of each supplied lane from `from` (default: genesis)
 * through `through` (default: the lane's current head) and returns the merged,
 * deterministically ordered leaf list. Every `live` flag is resolved against
 * the captured head's snapshot.
 */
export declare function captureOhMemoryContextV1(lanes: Readonly<Partial<Record<OhMemoryContextLaneV1, OhMemoryContextCaptureBoundV1>>>): Promise<OhMemoryContextHistoryV1>;
/** Aligned power-of-two ranges with finer granularity toward the present. */
export declare function ohMemoryContextCoverV1(leafCount: number, recentLeaves: number, detailedIndices?: readonly number[]): readonly Readonly<{
    start: number;
    end: number;
}>[];
export type OhMemoryContextItemV1 = Readonly<{
    kind: "leaf";
    leaf: OhMemoryContextLeafV1;
    leafIndex: number;
    record: KnowledgeGraphRecordV1 | null;
}> | Readonly<{
    kind: "summary";
    childrenSha256s: readonly Sha256Hex[];
    end: number;
    lanes: readonly OhMemoryContextLaneV1[];
    nodeSha256: Sha256Hex;
    start: number;
    summarySha256: Sha256Hex;
    text: string;
}> | Readonly<{
    end: number;
    kind: "pending";
    lanes: readonly OhMemoryContextLaneV1[];
    nodeSha256: Sha256Hex;
    reason: "missing-summary" | "unpermitted";
    start: number;
}>;
export type OhMemoryContextPageV1 = Readonly<{
    binding: Readonly<{
        generationSha256: Sha256Hex;
        historySha256: Sha256Hex;
        selectionSha256: Sha256Hex;
    }>;
    continuation: string | null;
    end: number;
    items: readonly OhMemoryContextItemV1[];
    start: number;
    status: "complete" | "partial";
    v: 1;
}>;
export type OhMemoryContextExpansionV1 = Readonly<{
    items: readonly OhMemoryContextItemV1[];
    nodeSha256: Sha256Hex;
    status: "complete" | "incomplete";
    v: 1;
}>;
export type OhMemoryContextReadV1 = Readonly<{
    leaf: OhMemoryContextLeafV1;
    leafIndex: number;
    record: KnowledgeGraphRecordV1 | null;
    v: 1;
}>;
export type OhMemoryContextSearchMatchV1 = Readonly<{
    end: number;
    key: string;
    lane: OhMemoryContextLaneV1;
    leafIndex: number;
    recordSha256: Sha256Hex;
    start: number;
}>;
export type OhMemoryContextSearchResultV1 = Readonly<{
    complete: boolean;
    denied: number;
    matches: readonly OhMemoryContextSearchMatchV1[];
    scannedBytes: number;
    v: 1;
}>;
export type OhMemoryContextInspectionV1 = Readonly<{
    generationSha256: Sha256Hex;
    heads: Readonly<Partial<Record<OhMemoryContextLaneV1, OhHeadV1>>>;
    historySha256: Sha256Hex;
    leaves: number;
    v: 1;
}>;
export type OhMemoryContextReadLimitsV1 = Readonly<{
    maxBytes?: number;
    maxItems?: number;
}>;
export interface OhMemoryContextReaderV1 {
    expand(nodeSha256: unknown, options?: Readonly<{
        continuation?: string | null;
    }>): Promise<OhMemoryContextExpansionV1>;
    inspect(): Promise<OhMemoryContextInspectionV1>;
    overview(options?: Readonly<{
        continuation?: string | null;
        detailedIndices?: readonly number[];
        limits?: OhMemoryContextReadLimitsV1;
        recentLeaves?: number;
    }>): Promise<OhMemoryContextPageV1>;
    read(leafIndex: unknown): Promise<OhMemoryContextReadV1>;
    search(options: unknown): Promise<OhMemoryContextSearchResultV1>;
}
export interface OhMemoryContextHostV1 {
    admit(history: unknown, options?: Readonly<{
        derivatives?: unknown;
        detailedIndices?: readonly number[];
        recentLeaves?: number;
    }>): Promise<OhMemoryContextRefV1>;
    bind(ref: unknown): OhMemoryContextReaderV1;
    publishDerivatives(ref: unknown, pool: unknown, expectedGenerationSha256: unknown): Promise<Sha256Hex>;
    revoke(ref: unknown): void;
}
export declare function createOhMemoryContextHostV1(options: Readonly<{
    canonical?: Readonly<{
        expectedBindingSha256: Sha256Hex;
        store: OhStoreV1;
    }>;
    continuationKey?: Uint8Array;
    continuationLifetimeMs?: number;
    monotonicNow?: () => number;
    resolveAccess: (ref: OhMemoryContextRefV1) => unknown;
    working?: Readonly<{
        expectedBindingSha256: Sha256Hex;
        store: OhStoreV1;
    }>;
}>): OhMemoryContextHostV1;
//# sourceMappingURL=memory-context.d.ts.map