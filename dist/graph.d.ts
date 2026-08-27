import { type JsonValue, type Sha256Hex } from "./canonical";
export declare const OH_GRAPH_FORMAT_VERSION_V1: 1;
export declare const OH_GRAPH_LIMITS_V1: Readonly<{
    changesPerOperation: 8192;
    dependenciesPerRecord: 4096;
    recordBytes: number;
    recordsPerSnapshot: 65536;
}>;
export declare const OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1: readonly ["activity", "assertion", "context", "dependency-manifest", "edition", "entity", "evidence", "identity-operation", "inquiry", "inquiry-event", "review-decision", "rights-decision", "schema", "shape", "statement", "type-membership", "view", "vocabulary"];
export type KnowledgeGraphRecordKindV1 = (typeof OH_KNOWLEDGE_GRAPH_RECORD_KINDS_V1)[number];
export type KnowledgeGraphRecordV1 = Readonly<{
    dependencies: readonly string[];
    key: string;
    kind: KnowledgeGraphRecordKindV1;
    recordSha256: Sha256Hex;
    v: 1;
    value: JsonValue;
}>;
export type KnowledgeGraphRecordInputV1 = Omit<KnowledgeGraphRecordV1, "recordSha256">;
export type KnowledgeGraphRecordRefV1 = Readonly<{
    dependencies: readonly string[];
    key: string;
    kind: KnowledgeGraphRecordKindV1;
    sha256: Sha256Hex;
    v: 1;
}>;
export declare function createKnowledgeGraphRecordV1(input: KnowledgeGraphRecordInputV1): KnowledgeGraphRecordV1;
export declare function parseKnowledgeGraphRecordV1(value: unknown): KnowledgeGraphRecordV1 | null;
export declare function knowledgeGraphRecordRefV1(record: KnowledgeGraphRecordV1): KnowledgeGraphRecordRefV1;
export type KnowledgeGraphChangeV1 = Readonly<{
    kind: "put";
    record: KnowledgeGraphRecordV1;
    v: 1;
}> | Readonly<{
    key: string;
    kind: "tombstone";
    priorSha256: Sha256Hex;
    v: 1;
}>;
export type KnowledgeGraphRevisionV1 = Readonly<{
    changes: readonly KnowledgeGraphChangeV1[];
    graphRevisionSha256: Sha256Hex;
    operationId: string;
    parentGraphRevisionSha256: Sha256Hex | null;
    recordRefs: readonly KnowledgeGraphRecordRefV1[];
    recordsSha256: Sha256Hex;
    revision: number;
    v: 1;
}>;
export declare function canonicalKnowledgeGraphChangesV1(changes: readonly KnowledgeGraphChangeV1[]): readonly KnowledgeGraphChangeV1[];
/** Hashes the canonical graph transition envelope used by snapshots and operations. */
export declare function graphRevisionSha256V1(input: Readonly<{
    changes: readonly KnowledgeGraphChangeV1[];
    operationId: string;
    parentGraphRevisionSha256: Sha256Hex | null;
    recordsSha256: Sha256Hex;
    revision: number;
}>): Sha256Hex;
export declare function createKnowledgeGraphRevisionV1(input: Readonly<{
    changes: readonly KnowledgeGraphChangeV1[];
    operationId: string;
    parent: KnowledgeGraphRevisionV1 | null;
}>): KnowledgeGraphRevisionV1;
export declare function parseKnowledgeGraphRevisionV1(value: unknown): KnowledgeGraphRevisionV1 | null;
/** Deterministically reduces a revision chain and rejects gaps, forks, and false snapshots. */
export declare function reduceKnowledgeGraphRevisionsV1(revisions: readonly KnowledgeGraphRevisionV1[]): KnowledgeGraphRevisionV1 | null;
//# sourceMappingURL=graph.d.ts.map