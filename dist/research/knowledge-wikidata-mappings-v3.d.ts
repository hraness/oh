import { type Sha256Hex } from "./integrity-domain";
import { type KnowledgeWikidataSourceMappingV2 } from "./knowledge-wikidata-mappings-v2";
import { KNOWLEDGE_WIKIDATA_DATATYPES_V2 } from "./knowledge-wikidata-import-v2";
/** Version 3 adds explicit, source-pinned coverage for high-value properties beyond reviewed mappings.
 * These entries are preservation-only: they never invent a local predicate or normalize a literal. */
export declare const KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V3 = "sponge.wikidata-source-mappings.v3";
export type KnowledgeWikidataPreservedPropertyV3 = Readonly<{
    source: Readonly<{
        propertyId: string;
        datatype: (typeof KNOWLEDGE_WIKIDATA_DATATYPES_V2)[number];
        revision: number;
        captureSha256: Sha256Hex;
    }>;
    coverage: "preserved-only";
    target: null;
    observedStatements: number;
    rationale: string;
    v: 3;
}>;
export type KnowledgeWikidataMappingCatalogV3 = Readonly<{
    v: 3;
    mappingVersion: typeof KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V3;
    /** Reviewed item-valued mappings from V2 remain available without mutation. */
    reviewedMappings: readonly KnowledgeWikidataSourceMappingV2[];
    /** High-value literal and temporal properties are addressable with exact source evidence. */
    preservedProperties: readonly KnowledgeWikidataPreservedPropertyV3[];
    catalogSha256: Sha256Hex;
}>;
export declare function spongeKnowledgeWikidataMappingCatalogV3(): Promise<KnowledgeWikidataMappingCatalogV3>;
/** Seeds are intentionally exported for corpus-audit tooling, not runtime mutation. */
export declare const KNOWLEDGE_WIKIDATA_PRESERVED_PROPERTY_IDS_V3: readonly string[];
//# sourceMappingURL=knowledge-wikidata-mappings-v3.d.ts.map