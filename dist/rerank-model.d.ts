/** Cross-encoder rerank profile for the optional local Qwen3 backend.
 * The procedure mirrors the frozen CloneMem confirmation arm
 * `oh-union-qwen3-rerank-v1`: the lexical lane receives the normalized query,
 * the semantic lane keeps the original stem, their bounded top-N results form
 * one union pool, and every candidate document is reranked against the
 * original query before the top results are returned. */
export declare const OH_RERANK_PROFILE_V1: Readonly<{
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
export declare const OH_RERANK_LIMITS_V1: Readonly<{
    readonly defaultPoolSize: 30;
    readonly maximumDocumentBytes: 65536;
    readonly maximumDocuments: 128;
    readonly maximumPoolSize: 60;
    readonly maximumQueryBytes: 16384;
    readonly minimumPoolSize: 1;
}>;
/** English stopwords frozen with the lexical normalization profile. */
export declare const OH_RERANK_STOPWORDS_V1: readonly string[];
/** Normalizes a query for the rerank pool's lexical lane. Does not stem words;
 * an empty content-term output is an empty lexical lane, never an error. */
export declare function normalizeOhRerankLexicalQueryV1(query: string): string;
export type OhRerankDocumentV1 = Readonly<{
    key: string;
    text: string;
    v: 1;
}>;
export type OhRerankResultV1 = Readonly<{
    key: string;
    score: number;
    v: 1;
}>;
/** Optional local cross-encoder boundary. Implementations own their model
 * lifecycle; `rerank` returns one bounded score per submitted document and
 * `close` releases the model. Scores are engine-specific relevance values. */
export interface OhRerankBackendV1 {
    readonly profile: typeof OH_RERANK_PROFILE_V1;
    rerank(query: string, documents: readonly OhRerankDocumentV1[]): Promise<readonly OhRerankResultV1[]>;
    close(): Promise<void>;
}
export declare function parseOhRerankQueryV1(query: unknown): string;
export declare function parseOhRerankDocumentsV1(documents: unknown): readonly OhRerankDocumentV1[];
export declare function parseOhRerankResultsV1(results: unknown, keys: ReadonlySet<string>): readonly OhRerankResultV1[];
//# sourceMappingURL=rerank-model.d.ts.map