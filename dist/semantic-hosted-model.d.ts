import { type Sha256Hex } from "./canonical";
import { type KnowledgeGraphRecordV1 } from "./graph";
import { type OhSemanticSearchBackendV1 } from "./semantic-model";
/** Separate from the immutable local QMD profile. The provider model is an alias. */
export declare const OH_HOSTED_EMBEDDING_PROFILE_V2: Readonly<{
    readonly chunkBytes: 4096;
    readonly chunking: "contiguous-utf8-scalars-no-overlap-v1";
    readonly dimensions: 1536;
    readonly distance: "cosine";
    readonly documentFormat: "oh-record-document-v1";
    readonly encoding: "float";
    readonly engine: "oh.precomputed-hosted.v1";
    readonly gateway: "vercel-ai-gateway";
    readonly model: "openai/text-embedding-3-small";
    readonly modelIdentity: "alias";
    readonly normalization: "l2";
    readonly provider: "openai";
    readonly queryFormat: "raw-utf8-v1";
    readonly queryMaxBytes: 8192;
    readonly recordAggregation: "maximum-chunk-cosine-v1";
    readonly v: 2;
}>;
export declare const OH_HOSTED_PROFILE_SHA256_V2: Sha256Hex;
export declare const OH_HOSTED_LIMITS_V1: Readonly<{
    records: 4096;
    embeddings: 4096;
    queries: 1024;
    sourceBytes: number;
    snapshotBytes: number;
    batchInputs: 128;
    batchBytes: number;
    inputBytes: number;
}>;
export type OhHostedEmbeddingProfileV2 = typeof OH_HOSTED_EMBEDDING_PROFILE_V2;
export interface OhSemanticSearchBackendV2 extends Omit<OhSemanticSearchBackendV1, "profile"> {
    readonly profile: OhHostedEmbeddingProfileV2;
}
export type OhSemanticSearchBackend = OhSemanticSearchBackendV1 | OhSemanticSearchBackendV2;
export type OhHostedEmbeddingRoleV1 = "document" | "query";
export type OhHostedSettlementV1 = Readonly<{
    authoritySha256: Sha256Hex;
    settlementSha256: Sha256Hex;
    requestSha256: Sha256Hex;
    responseSha256: Sha256Hex;
    profileSha256: Sha256Hex;
    role: OhHostedEmbeddingRoleV1;
    inputSha256s: readonly Sha256Hex[];
    knownCostMicros: number;
    reservationMicros: number;
    latencyMs: number;
    physicalCalls: 1;
}>;
export type OhHostedEmbeddingV1 = Readonly<{
    role: OhHostedEmbeddingRoleV1;
    inputSha256: Sha256Hex;
    vector: readonly number[];
    receiptIndex: number;
    inputIndex: number;
}>;
export type OhHostedRecordV1 = Readonly<{
    key: string;
    recordSha256: Sha256Hex;
    documentSha256: Sha256Hex;
    chunks: readonly Readonly<{
        start: number;
        end: number;
        inputSha256: Sha256Hex;
        embeddingIndex: number;
    }>[];
}>;
export type OhHostedSnapshotV1 = Readonly<{
    protocol: "oh.semantic-hosted-snapshot.v1";
    profileSha256: Sha256Hex;
    sourceSha256: Sha256Hex;
    records: readonly OhHostedRecordV1[];
    queries: readonly Readonly<{
        querySha256: Sha256Hex;
        embeddingIndex: number;
    }>[];
    embeddings: readonly OhHostedEmbeddingV1[];
    receipts: readonly OhHostedSettlementV1[];
}>;
export declare function hostedInteger(value: unknown, maximum: number, minimum?: number): number;
export declare function normalizeOhHostedEmbeddingV2(value: unknown): readonly number[];
export declare function hostedQueryV1(value: unknown): string;
export declare function hostedDocumentChunksV1(record: KnowledgeGraphRecordV1): readonly Readonly<{
    start: number;
    end: number;
    input: string;
    inputSha256: Sha256Hex;
}>[];
export declare function hostedRecordsV1(value: unknown): readonly KnowledgeGraphRecordV1[];
export declare function hostedSourceSha256V1(records: readonly Readonly<{
    key: string;
    recordSha256: Sha256Hex;
}>[]): Sha256Hex;
export declare function parseOhHostedSettlementV1(value: unknown): OhHostedSettlementV1;
/** Validates structure/bindings; the caller authenticates settlement and raw-capture pins against its ledger. */
export declare function parseOhHostedSnapshotV1(value: unknown): OhHostedSnapshotV1;
//# sourceMappingURL=semantic-hosted-model.d.ts.map