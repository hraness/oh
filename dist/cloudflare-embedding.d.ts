import { type Sha256Hex } from "./canonical";
/** A hosted embedding space. It is intentionally distinct from the local QMD profile. */
export declare const OH_CLOUDFLARE_EMBEDDING_PROFILE_V1: Readonly<{
    profileSha256: Sha256Hex;
    dimensions: 768;
    distance: "cosine";
    documentFormat: "title: {title} | text: {content}";
    inputUtf8Bytes: 448;
    model: "@cf/google/embeddinggemma-300m";
    normalization: "l2";
    profileId: "oh.cloudflare.embeddinggemma.v1";
    provider: "cloudflare.workers-ai";
    queryFormat: "task: search result | query: {query}";
    v: 1;
}>;
export declare const OH_SEMANTIC_RENDERER_V1: Readonly<{
    rendererSha256: Sha256Hex;
    documentFormat: "title: {title} | text: {content}";
    inputUtf8Bytes: 448;
    rendererId: "oh.embedding-input.utf8-chunks.v1";
    split: "unicode-scalar-greedy";
    v: 1;
}>;
export declare const OH_CLOUDFLARE_EMBEDDING_LIMITS_V1: Readonly<{
    batchInputs: 32;
    deadlineMs: 30000;
    documentBytes: number;
    inputUtf8Bytes: 448;
    responseBytes: number;
    renderedChunks: 256;
    titleBytes: number;
}>;
export type OhRenderedEmbeddingInputV1 = Readonly<{
    input: string;
    inputSha256: Sha256Hex;
    kind: "document" | "query";
    utf8Bytes: number;
    v: 1;
}>;
export type OhRenderedDocumentChunkV1 = Readonly<{
    content: string;
    input: OhRenderedEmbeddingInputV1;
    ordinal: number;
    title: string;
    v: 1;
}>;
export type OhRenderedDocumentV1 = Readonly<{
    chunks: readonly OhRenderedDocumentChunkV1[];
    diagnostic: null | Readonly<{
        code: "oversize-prefix" | "partial";
        maximumChunks: number;
        omittedUtf8Bytes: number;
        v: 1;
    }>;
    sourceUtf8Bytes: number;
    status: "complete" | "oversize" | "partial";
    v: 1;
}>;
export declare class OhCloudflareEmbeddingError extends Error {
    readonly code: "aborted" | "invalid-input" | "invalid-response" | "provider-unavailable";
    readonly status: number | null;
    constructor(code: OhCloudflareEmbeddingError["code"], message: string, status?: number | null);
}
export declare function renderOhCloudflareEmbeddingQueryV1(query: string): OhRenderedEmbeddingInputV1;
/**
 * Renders every source scalar in order. A caller-selected chunk limit is made
 * visible as `partial`; a title that leaves no content capacity is `oversize`.
 */
export declare function renderOhCloudflareEmbeddingDocumentV1(input: Readonly<{
    content: string;
    maximumChunks?: number;
    title: string;
}>): OhRenderedDocumentV1;
export type OhEmbeddingFetchV1 = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type OhCloudflareEmbeddingClientOptionsV1 = Readonly<{
    accountId: string;
    apiToken: string;
    deadlineMs?: number;
    fetch?: OhEmbeddingFetchV1;
    maximumBatchInputs?: number;
    maximumResponseBytes?: number;
}>;
/** Fixed Workers AI adapter; credentials are never included in surfaced errors. */
export declare class OhCloudflareEmbeddingClientV1 {
    #private;
    readonly profile: Readonly<{
        profileSha256: Sha256Hex;
        dimensions: 768;
        distance: "cosine";
        documentFormat: "title: {title} | text: {content}";
        inputUtf8Bytes: 448;
        model: "@cf/google/embeddinggemma-300m";
        normalization: "l2";
        profileId: "oh.cloudflare.embeddinggemma.v1";
        provider: "cloudflare.workers-ai";
        queryFormat: "task: search result | query: {query}";
        v: 1;
    }>;
    constructor(options: OhCloudflareEmbeddingClientOptionsV1);
    embed(inputs: readonly OhRenderedEmbeddingInputV1[], options?: Readonly<{
        signal?: AbortSignal;
    }>): Promise<readonly (readonly number[])[]>;
}
//# sourceMappingURL=cloudflare-embedding.d.ts.map