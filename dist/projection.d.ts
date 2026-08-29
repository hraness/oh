import { type JsonPrimitive, type Sha256Hex } from "./canonical";
import { type KnowledgeGraphRecordKindV1, type KnowledgeGraphRecordRefV1, type KnowledgeGraphRecordV1 } from "./graph";
export declare const OH_PROJECTION_FORMAT_VERSION_V1: 1;
export declare const OH_PROJECTION_SEMANTICS_V1: "oh.projection.positive-datalog.v1";
export declare const OH_PROJECTION_INTERNAL_ENGINE_V1: "oh.naive.positive.v1";
export declare const OH_PROJECTION_LIMITS_V1: Readonly<{
    arity: 32;
    atomBytes: number;
    derivedTuples: 262144;
    facts: 262144;
    literalsPerRule: 64;
    proofDepth: 128;
    proofNodes: 4096;
    queryLiterals: 64;
    queryMatches: 262144;
    queryResults: 65536;
    relations: 4096;
    rounds: 1024;
    rules: 1024;
    sourcesPerFact: 64;
    variables: 256;
}>;
export type OhProjectionAtomV1 = JsonPrimitive;
export type OhProjectionSnapshotV1 = Readonly<{
    contractSha256: Sha256Hex;
    generation: number;
    graphRevisionSha256: Sha256Hex | null;
    operationSha256: Sha256Hex | null;
    recordRefs: readonly KnowledgeGraphRecordRefV1[];
    recordsSha256: Sha256Hex;
    sequence: number;
    snapshotSha256: Sha256Hex;
    spaceId: string;
    v: 1;
}>;
export type OhProjectionFactSourceV1 = Readonly<{
    key: string;
    recordSha256: Sha256Hex;
    v: 1;
}>;
export type OhProjectionFactV1 = Readonly<{
    factSha256: Sha256Hex;
    relation: string;
    sources: readonly OhProjectionFactSourceV1[];
    tuple: readonly OhProjectionAtomV1[];
    v: 1;
}>;
export type OhProjectionDatasetV1 = Readonly<{
    datasetSha256: Sha256Hex;
    extractorSha256: Sha256Hex;
    factPackId: string;
    factPackRevision: number;
    factPackSha256: Sha256Hex;
    facts: readonly OhProjectionFactV1[];
    factsSha256: Sha256Hex;
    snapshotSha256: Sha256Hex;
    v: 1;
}>;
export declare const OH_PROJECTION_RECORD_FACT_EXTRACTOR_V1: Readonly<{
    extractorSha256: Sha256Hex;
    factPackId: "oh.record-facts";
    factPackRevision: 1;
    relations: readonly ["oh.dependency", "oh.record"];
    semantics: "oh.projection.positive-datalog.v1";
    v: 1;
}>;
export type OhProjectionTermV1 = Readonly<{
    kind: "constant";
    v: 1;
    value: OhProjectionAtomV1;
}> | Readonly<{
    kind: "variable";
    name: string;
    v: 1;
}>;
export type OhProjectionLiteralV1 = Readonly<{
    relation: string;
    terms: readonly OhProjectionTermV1[];
    v: 1;
}>;
export type OhProjectionRuleV1 = Readonly<{
    body: readonly OhProjectionLiteralV1[];
    head: OhProjectionLiteralV1;
    ruleId: string;
    ruleSha256: Sha256Hex;
    v: 1;
}>;
export type OhProjectionRulePackV1 = Readonly<{
    rulePackId: string;
    rulePackRevision: number;
    rulePackSha256: Sha256Hex;
    rules: readonly OhProjectionRuleV1[];
    rulesSha256: Sha256Hex;
    semantics: typeof OH_PROJECTION_SEMANTICS_V1;
    v: 1;
}>;
export type OhProjectionQueryV1 = Readonly<{
    find: readonly string[];
    limit: number;
    queryId: string;
    querySha256: Sha256Hex;
    where: readonly OhProjectionLiteralV1[];
    v: 1;
}>;
export type OhProjectionIdentityV1 = Readonly<{
    contractSha256: Sha256Hex;
    datasetSha256: Sha256Hex;
    projectionSha256: Sha256Hex;
    querySha256: Sha256Hex;
    rulePackSha256: Sha256Hex;
    semantics: typeof OH_PROJECTION_SEMANTICS_V1;
    snapshotSha256: Sha256Hex;
    v: 1;
}>;
export type OhProjectionProofV1 = Readonly<{
    kind: "fact";
    relation: string;
    sources: readonly OhProjectionFactSourceV1[];
    tuple: readonly OhProjectionAtomV1[];
    v: 1;
}> | Readonly<{
    kind: "derived";
    premises: readonly OhProjectionProofV1[];
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
export type OhProjectionResultRowV1 = Readonly<{
    proofs: readonly OhProjectionProofV1[];
    values: readonly OhProjectionAtomV1[];
    v: 1;
}>;
export type OhProjectionResultV1 = Readonly<{
    authority: "derived";
    cache: Readonly<{
        strategy: "full-rebuild";
        v: 1;
    }>;
    engine: string;
    evaluation: Readonly<{
        maximumDerivedTuples: number;
        maximumProofDepth: number;
        maximumProofNodes: number;
        maximumRounds: number;
        v: 1;
    }>;
    identity: OhProjectionIdentityV1;
    resultSha256: Sha256Hex;
    rows: readonly OhProjectionResultRowV1[];
    stats: Readonly<{
        baseFacts: number;
        derivedFacts: number;
        queryMatches: number;
        relations: number;
        rounds: number;
        truncated: boolean;
        v: 1;
    }>;
    v: 1;
}>;
export type OhProjectionEvaluationOptionsV1 = Readonly<{
    maximumDerivedTuples?: number;
    maximumProofDepth?: number;
    maximumProofNodes?: number;
    maximumRounds?: number;
}>;
export type OhProjectionInvalidationReasonV1 = "dataset-changed" | "query-changed" | "rule-pack-changed" | "snapshot-changed";
export type OhProjectionInvalidationV1 = Readonly<{
    kind: "reusable";
    v: 1;
}> | Readonly<{
    kind: "full-rebuild";
    reasons: readonly OhProjectionInvalidationReasonV1[];
    v: 1;
}>;
type ProjectionHeadInputV1 = Readonly<{
    generation: number;
    graphRevisionSha256: Sha256Hex | null;
    operationSha256: Sha256Hex | null;
    recordsSha256: Sha256Hex;
    sequence: number;
}>;
export declare function createOhProjectionSnapshotV1(input: Readonly<{
    head: ProjectionHeadInputV1;
    records: readonly KnowledgeGraphRecordV1[];
    spaceId: string;
}>): OhProjectionSnapshotV1;
export declare function parseOhProjectionSnapshotV1(value: unknown): OhProjectionSnapshotV1 | null;
export declare function createOhProjectionFactV1(input: Readonly<{
    relation: string;
    sources: readonly OhProjectionFactSourceV1[];
    tuple: readonly OhProjectionAtomV1[];
}>): OhProjectionFactV1;
export declare function parseOhProjectionFactV1(value: unknown): OhProjectionFactV1 | null;
export declare function createOhProjectionDatasetV1(input: Readonly<{
    extractorSha256: Sha256Hex;
    factPackId: string;
    factPackRevision: number;
    facts: readonly OhProjectionFactV1[];
    snapshot: OhProjectionSnapshotV1;
}>): OhProjectionDatasetV1;
export declare function parseOhProjectionDatasetV1(value: unknown, snapshot: OhProjectionSnapshotV1): OhProjectionDatasetV1 | null;
export declare function ohProjectionVariableV1(name: string): OhProjectionTermV1;
export declare function ohProjectionConstantV1(value: OhProjectionAtomV1): OhProjectionTermV1;
export declare function createOhProjectionLiteralV1(input: Readonly<{
    relation: string;
    terms: readonly OhProjectionTermV1[];
}>): OhProjectionLiteralV1;
export declare function parseOhProjectionTermV1(value: unknown): OhProjectionTermV1 | null;
export declare function parseOhProjectionLiteralV1(value: unknown): OhProjectionLiteralV1 | null;
export declare function createOhProjectionRuleV1(input: Readonly<{
    body: readonly OhProjectionLiteralV1[];
    head: OhProjectionLiteralV1;
    ruleId: string;
}>): OhProjectionRuleV1;
export declare function parseOhProjectionRuleV1(value: unknown): OhProjectionRuleV1 | null;
export declare function createOhProjectionRulePackV1(input: Readonly<{
    rulePackId: string;
    rulePackRevision: number;
    rules: readonly OhProjectionRuleV1[];
}>): OhProjectionRulePackV1;
export declare function parseOhProjectionRulePackV1(value: unknown): OhProjectionRulePackV1 | null;
export declare function createOhProjectionQueryV1(input: Readonly<{
    find: readonly string[];
    limit?: number;
    queryId: string;
    where: readonly OhProjectionLiteralV1[];
}>): OhProjectionQueryV1;
export declare function parseOhProjectionQueryV1(value: unknown): OhProjectionQueryV1 | null;
export declare function createOhProjectionIdentityV1(input: Readonly<{
    dataset: OhProjectionDatasetV1;
    query: OhProjectionQueryV1;
    rulePack: OhProjectionRulePackV1;
    snapshot: OhProjectionSnapshotV1;
}>): OhProjectionIdentityV1;
export declare function parseOhProjectionIdentityV1(value: unknown): OhProjectionIdentityV1 | null;
export declare function invalidationForOhProjectionV1(previous: OhProjectionIdentityV1, next: OhProjectionIdentityV1): OhProjectionInvalidationV1;
export declare function evaluateOhProjectionV1(input: Readonly<{
    dataset: OhProjectionDatasetV1;
    options?: OhProjectionEvaluationOptionsV1;
    query: OhProjectionQueryV1;
    rulePack: OhProjectionRulePackV1;
    snapshot: OhProjectionSnapshotV1;
}>): OhProjectionResultV1;
/**
 * Internal adapter seam. It is exported for package-owned optional engines,
 * not as authority: callers receive the same derived-only result envelope.
 */
export declare function evaluateOhProjectionWithMaterializerV1(input: Readonly<{
    dataset: OhProjectionDatasetV1;
    engine: string;
    materialize: (program: Readonly<{
        dataset: OhProjectionDatasetV1;
        maximumDerivedTuples: number;
        maximumRounds: number;
        query: OhProjectionQueryV1;
        rulePack: OhProjectionRulePackV1;
    }>) => Readonly<{
        relationFacts: ReadonlyMap<string, readonly OhProjectionAtomV1[][]>;
    }>;
    options?: OhProjectionEvaluationOptionsV1;
    query: OhProjectionQueryV1;
    rulePack: OhProjectionRulePackV1;
    snapshot: OhProjectionSnapshotV1;
}>): OhProjectionResultV1;
export type OhProjectionRecordFactOptionsV1 = Readonly<{
    includeDependencies?: boolean;
    includeRecords?: boolean;
}>;
/** Builds the stable structural fact layer shared by every domain fact pack. */
export declare function createOhProjectionRecordFactsV1(records: readonly KnowledgeGraphRecordV1[], options?: OhProjectionRecordFactOptionsV1): readonly OhProjectionFactV1[];
export declare function isOhProjectionRecordKindV1(value: unknown): value is KnowledgeGraphRecordKindV1;
export {};
//# sourceMappingURL=projection.d.ts.map