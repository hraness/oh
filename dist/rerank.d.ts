import { type OhRerankBackendV1, type OhRerankDocumentV1, type OhRerankResultV1 } from "./rerank-model";
export { OH_RERANK_LIMITS_V1, OH_RERANK_PROFILE_V1, OH_RERANK_STOPWORDS_V1, normalizeOhRerankLexicalQueryV1, } from "./rerank-model";
export type { OhRerankBackendV1, OhRerankDocumentV1, OhRerankResultV1, } from "./rerank-model";
/** Optional local Qwen3 rerank backend through the pinned @tobilu/qmd peer.
 * The model path must already exist locally; this boundary never downloads.
 * Operations are serial and the backend must be closed to release the model. */
export declare class OhQmdRerankBackendV1 implements OhRerankBackendV1 {
    #private;
    readonly profile: Readonly<{
        readonly contextSize: 4096;
        readonly engine: "@tobilu/qmd@2.5.3 LlamaCpp.rerank";
        readonly language: "en";
        readonly lexicalQuery: "normalized original query stem";
        readonly model: "Qwen3-Reranker-0.6B Q8_0 GGUF";
        readonly modelSha256: "22c9979ce4fbcdc5acdc310c6641c32797eff1aa980b8f7a2db8a8ea23429a48";
        readonly modelRevision: "a02f48bb4f057028298c21fa033da2b30d7742d5";
        readonly normalization: "NFC; en-US lowercase; token regex; first-occurrence deduplication; fixed stopword removal; first16";
        readonly ranking: "score descending, then ASCII key ascending";
        readonly semanticQuery: "unchanged original query stem";
        readonly v: 1;
    }>;
    constructor(options: Readonly<{
        modelPath: string;
        modelCacheDir?: string;
    }>);
    rerank(query: string, documents: readonly OhRerankDocumentV1[]): Promise<readonly OhRerankResultV1[]>;
    close(): Promise<void>;
}
//# sourceMappingURL=rerank.d.ts.map