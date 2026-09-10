import type { KnowledgeGraphRecordV1 } from "./graph";
import { type OhSemanticSearchResultV1 } from "./semantic-model";
import { type OhHostedSnapshotV1, type OhSemanticSearchBackendV2 } from "./semantic-hosted-model";
import type { OhSqliteStore } from "./sqlite/store";
/** Immutable precomputed vectors; no provider, filesystem or asynchronous resource ownership. */
export declare class OhHostedSemanticBackendV2 implements OhSemanticSearchBackendV2 {
    #private;
    readonly profile: Readonly<{
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
    readonly snapshot: OhHostedSnapshotV1;
    readonly snapshotSha256: import("./canonical").Sha256Hex;
    constructor(snapshot: unknown);
    index(value: readonly KnowledgeGraphRecordV1[]): Promise<Readonly<{
        indexed: number;
        v: 1;
    }>>;
    search(query: string, limit: number, authority: OhSqliteStore): Promise<readonly OhSemanticSearchResultV1[]>;
    close(): Promise<void>;
}
//# sourceMappingURL=semantic-hosted.d.ts.map