import { type Sha256Hex } from "./integrity-domain";
import type { KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import { type KnowledgeWikidataImportResultV2, type KnowledgeWikidataSourceAssertionV2 } from "./knowledge-wikidata-import-v2";
export declare const KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V1 = "sponge.wikidata-source-mappings.v1";
export type KnowledgeWikidataSourceMappingV1 = Readonly<{
    source: Readonly<{
        propertyId: string;
        datatype: "wikibase-item";
        revision: number;
        captureSha256: Sha256Hex;
    }>;
    target: KnowledgeSchemaRefV1;
    relation: "source-attribution";
    localMembershipInference: false;
    identityMerge: false;
    v: 1;
}>;
export type KnowledgeWikidataMappingCatalogV1 = Readonly<{
    v: 1;
    mappingVersion: typeof KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V1;
    mappings: readonly KnowledgeWikidataSourceMappingV1[];
    catalogSha256: Sha256Hex;
}>;
export declare function spongeKnowledgeWikidataMappingCatalogV1(): Promise<KnowledgeWikidataMappingCatalogV1>;
export type KnowledgeWikidataMappedSourceCandidateV1 = Readonly<{
    source: KnowledgeWikidataSourceAssertionV2;
    mapping: KnowledgeWikidataSourceMappingV1;
    object: Readonly<{
        entityId: string;
        uri: string;
    }>;
    status: "requires-local-identity-and-proposal-review";
    normalization: "none";
    eligibleForAdmission: false;
}>;
export type KnowledgeWikidataMappingPreviewV1 = Readonly<{
    v: 1;
    sourcePreviewSha256: Sha256Hex;
    mappingCatalogSha256: Sha256Hex;
    candidates: readonly KnowledgeWikidataMappedSourceCandidateV1[];
    gaps: readonly Readonly<{
        source: KnowledgeWikidataSourceAssertionV2;
        reason: "property-not-mapped" | "source-value-not-an-item";
    }>[];
    /** Counts describe retained main statements only. Source omission and coverage ledgers remain authoritative. */
    scope: "retained-main-statements";
    previewSha256: Sha256Hex;
}>;
/** Rebuilds the bounded source preview; caller labels cannot install mappings or create authority. */
export declare function createKnowledgeWikidataMappingPreviewV1(input: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataMappingPreviewV1>>;
/** Verify transported candidates by rebuilding both pinned mappings and source selectors. */
export declare function verifyKnowledgeWikidataMappingPreviewV1(foreign: unknown, input: unknown): Promise<KnowledgeWikidataImportResultV2<KnowledgeWikidataMappingPreviewV1>>;
//# sourceMappingURL=knowledge-wikidata-mappings-v1.d.ts.map