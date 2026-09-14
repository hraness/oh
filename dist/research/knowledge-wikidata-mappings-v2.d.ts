import { type Sha256Hex } from "./integrity-domain";
import { type KnowledgeWikidataImportResultV2, type KnowledgeWikidataSourceAssertionV2 } from "./knowledge-wikidata-import-v2";
import { type KnowledgeWikidataSourceMappingV1 } from "./knowledge-wikidata-mappings-v1";
export declare const KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V2 = "sponge.wikidata-source-mappings.v2";
export type KnowledgeWikidataSourceMappingV2 = Omit<KnowledgeWikidataSourceMappingV1, "v"> & Readonly<{
    v: 2;
}>;
export type KnowledgeWikidataMappingCatalogV2 = Readonly<{
    v: 2;
    mappingVersion: typeof KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V2;
    mappings: readonly KnowledgeWikidataSourceMappingV2[];
    catalogSha256: Sha256Hex;
}>;
/** A new mapping version preserves the three historical target refs and adds twelve reviewed relationships. */
export declare function spongeKnowledgeWikidataMappingCatalogV2(): Promise<KnowledgeWikidataMappingCatalogV2>;
export type KnowledgeWikidataMappedSourceCandidateV2 = Readonly<{
    source: KnowledgeWikidataSourceAssertionV2;
    mapping: KnowledgeWikidataSourceMappingV2;
    object: Readonly<{
        entityId: string;
        uri: string;
    }>;
    status: "requires-local-identity-and-proposal-review";
    normalization: "none";
    eligibleForAdmission: false;
}>;
export type KnowledgeWikidataMappingPreviewV2 = Readonly<{
    v: 2;
    sourcePreviewSha256: Sha256Hex;
    mappingCatalogSha256: Sha256Hex;
    candidates: readonly KnowledgeWikidataMappedSourceCandidateV2[];
    gaps: readonly Readonly<{
        source: KnowledgeWikidataSourceAssertionV2;
        reason: "property-not-mapped" | "source-value-not-an-item";
    }>[];
    /** Only retained main statements are counted; source coverage and omission ledgers remain authoritative. */
    scope: "retained-main-statements";
    previewSha256: Sha256Hex;
}>;
/** Source constraints, caller labels, ranks and prose cannot install mappings or grant admission. */
export declare function createKnowledgeWikidataMappingPreviewV2(input: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataMappingPreviewV2>>;
/** Rebuilds source selectors and exact pinned mappings before accepting transported preview bytes. */
export declare function verifyKnowledgeWikidataMappingPreviewV2(foreign: unknown, input: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataMappingPreviewV2>>;
//# sourceMappingURL=knowledge-wikidata-mappings-v2.d.ts.map