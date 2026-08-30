import { type JsonPrimitive, type Sha256Hex } from "./canonical";
import { type OhRecordCodecRegistry } from "./contract";
import { type KnowledgeGraphRecordV1 } from "./graph";
import { type OhProjectionAtomV1, type OhProjectionEvaluationOptionsV1, type OhProjectionQueryV1, type OhProjectionRulePackV1 } from "./projection";
import { type OhDependencyClosureV1, type OhHeadV1, type OhStoreV1 } from "./store";
export declare const OH_MEMORY_FORMAT_VERSION_V1: 1;
export declare const OH_MEMORY_CONFLICT_POLICY_V1: "visible-conflicts.v1";
export declare const OH_MEMORY_LIMITS_V1: Readonly<{
    explainCapabilityEntryBytes: number;
    explainCapabilities: 256;
    explainCapabilityLifetimeMs: number;
    explainCapabilityTotalBytes: number;
    factsPerRecordPerExtractor: 512;
    maximumExtractorInvocations: 262144;
    maximumExtractors: 32;
    maximumNominationRoutes: 64;
    maximumPrograms: 128;
    maximumRecordsPerLane: 8192;
    maximumSyntheticRecords: 16384;
    rememberBytes: number;
    resultBytes: number;
    snapshotBytesPerLane: number;
    relationsPerExtractor: 64;
}>;
export declare const OH_MEMORY_COMPOSITE_FACT_EXTRACTOR_V1: Readonly<{
    extractorSha256: Sha256Hex;
    factPackId: "oh.memory.composite-facts";
    factPackRevision: 1;
    relations: readonly string[];
    semantics: "oh.projection.positive-datalog.v1";
    v: 1;
}>;
export type OhMemoryLaneV1 = "canonical" | "working";
export type OhMemoryAuthoritySourceV1 = Readonly<{
    authorityId: string;
    bindingSha256: Sha256Hex;
    head: OhHeadV1;
    key: string;
    lane: OhMemoryLaneV1;
    recordSha256: Sha256Hex;
    snapshotSha256: Sha256Hex;
    v: 1;
}>;
export type OhMemoryProofV1 = Readonly<{
    factPolicy: OhMemoryFactPolicyV1;
    kind: "fact";
    relation: string;
    sources: readonly OhMemoryAuthoritySourceV1[];
    tuple: readonly OhProjectionAtomV1[];
    v: 1;
}> | Readonly<{
    kind: "derived";
    premises: readonly OhMemoryProofV1[];
    premisesTruncated: boolean;
    relation: string;
    ruleId: string;
    ruleSha256: Sha256Hex;
    tuple: readonly OhProjectionAtomV1[];
    v: 1;
}> | Readonly<{
    kind: "truncated";
    reason: "cycle" | "depth" | "nodes";
    relation: string;
    tuple: readonly OhProjectionAtomV1[];
    v: 1;
}>;
export type OhMemoryLaneIdentityV1 = Readonly<{
    authorityId: string;
    bindingSha256: Sha256Hex;
    datasetSha256: Sha256Hex;
    head: OhHeadV1;
    lane: OhMemoryLaneV1;
    snapshotSha256: Sha256Hex;
    v: 1;
}>;
export type OhMemoryIdentityV1 = Readonly<{
    canonical: OhMemoryLaneIdentityV1;
    compositeDatasetSha256: Sha256Hex;
    conflictPolicy: typeof OH_MEMORY_CONFLICT_POLICY_V1;
    evaluationSha256: Sha256Hex;
    memorySha256: Sha256Hex;
    programId: string;
    projectionSha256: Sha256Hex;
    purpose: string;
    querySha256: Sha256Hex;
    rulePackSha256: Sha256Hex;
    v: 1;
    working: OhMemoryLaneIdentityV1;
}>;
export type OhMemoryConflictV1 = Readonly<{
    canonicalRecordSha256: Sha256Hex;
    key: string;
    v: 1;
    workingRecordSha256: Sha256Hex;
}>;
export type OhMemoryResultRowV1 = Readonly<{
    premiseAuthority: "canonical" | "unknown" | "working";
    premiseLanes: readonly OhMemoryLaneV1[];
    proofsTruncated: boolean;
    resultRowSha256: Sha256Hex;
    supportCount: number;
    v: 1;
    values: readonly OhProjectionAtomV1[];
}>;
export type OhMemoryQueryResultV1 = Readonly<{
    authority: "derived";
    conflicts: readonly OhMemoryConflictV1[];
    explainCapability: Readonly<{
        expiresAt: string;
        token: string;
        v: 1;
    }>;
    identity: OhMemoryIdentityV1;
    projectionResultSha256: Sha256Hex;
    resultSha256: Sha256Hex;
    rows: readonly OhMemoryResultRowV1[];
    v: 1;
}>;
export type OhMemoryRememberReceiptV1 = Readonly<{
    actorId: string;
    authorityId: string;
    bindingSha256: Sha256Hex;
    head: OhHeadV1;
    instant: string;
    lane: "working";
    operationSha256: Sha256Hex;
    receiptSha256: Sha256Hex;
    requestId: string;
    status: "committed";
    v: 1;
}>;
export type OhMemoryExplanationV1 = Readonly<{
    authority: "derived";
    explanationSha256: Sha256Hex;
    identity: OhMemoryIdentityV1;
    premiseAuthority: OhMemoryResultRowV1["premiseAuthority"];
    premiseLanes: readonly OhMemoryLaneV1[];
    proofs: readonly OhMemoryProofV1[];
    proofsTruncated: boolean;
    resultRowSha256: Sha256Hex;
    resultSha256: Sha256Hex;
    supportCount: number;
    v: 1;
    values: readonly OhProjectionAtomV1[];
}>;
export type OhMemoryNominationV1 = Readonly<{
    closure: OhDependencyClosureV1;
    destinationPurpose: string;
    nominationId: string;
    nominationSha256: Sha256Hex;
    source: Readonly<{
        authorityId: string;
        bindingSha256: Sha256Hex;
        head: OhHeadV1;
        lane: "working";
        v: 1;
    }>;
    status: "prepared";
    v: 1;
}>;
export type OhMemoryNamedProgramV1 = Readonly<{
    evaluation?: OhProjectionEvaluationOptionsV1;
    programId: string;
    purpose: string;
    query: OhProjectionQueryV1;
    rulePack: OhProjectionRulePackV1;
}>;
export type OhMemoryNominationRouteV1 = Readonly<{
    destinationPurpose: string;
    nominationId: string;
}>;
export type OhMemoryFactPolicyV1 = Readonly<{
    extractorSha256: Sha256Hex;
    factPackId: string;
    kind: "built-in";
    v: 1;
}> | Readonly<{
    extractorId: string;
    extractorSha256: Sha256Hex;
    kind: "domain";
    v: 1;
}>;
export type OhMemoryFactDeclarationV1 = Readonly<{
    relation: string;
    tuple: readonly JsonPrimitive[];
    v: 1;
}>;
/** Host-owned, digest-identified domain projection; it cannot choose sources. */
export type OhMemoryFactExtractorV1 = Readonly<{
    extract(input: Readonly<{
        lane: OhMemoryLaneV1;
        record: KnowledgeGraphRecordV1;
    }>): readonly OhMemoryFactDeclarationV1[];
    extractorId: string;
    extractorSha256: Sha256Hex;
    relations: readonly string[];
}>;
export type OhMemoryFacadeOptionsV1 = Readonly<{
    actorId: string;
    canonical: Readonly<{
        authorityId: string;
        expectedBindingSha256: Sha256Hex;
        expectedHead: OhHeadV1;
        store: OhStoreV1;
    }>;
    explainCapabilityLifetimeMs?: number;
    extractors?: readonly OhMemoryFactExtractorV1[];
    monotonicNow?: () => number;
    nominationRoutes?: readonly OhMemoryNominationRouteV1[];
    now?: () => Date;
    programs: readonly OhMemoryNamedProgramV1[];
    working: Readonly<{
        authorityId: string;
        codecs: OhRecordCodecRegistry;
        expectedBindingSha256: Sha256Hex;
        store: OhStoreV1;
    }>;
}>;
export interface OhMemoryAgentV1 {
    explain(value: unknown): Promise<OhMemoryExplanationV1>;
    nominate(value: unknown): Promise<OhMemoryNominationV1>;
    query(value: unknown): Promise<OhMemoryQueryResultV1>;
    remember(value: unknown): Promise<OhMemoryRememberReceiptV1>;
}
/**
 * Creates a model-facing memory surface over two host-bound physical Oh
 * authorities. The returned object has no store, locator, rule, sync, canonical
 * write, or purge handle.
 */
export declare function createOhMemoryAgentV1(options: OhMemoryFacadeOptionsV1): Promise<OhMemoryAgentV1>;
//# sourceMappingURL=memory.d.ts.map