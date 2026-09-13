import { type SpongeKnowledgeDomainCatalog } from "./knowledge-domain-catalog";
import { type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
export type SpongeKnowledgeDomainCatalogV2 = SpongeKnowledgeDomainCatalog & Readonly<{
    foundationPack: KnowledgeVocabularyPackManifestV1;
    /** Published V1 packs remain available for exact historical references and installation receipts. */
    historicalPacks: readonly KnowledgeVocabularyPackManifestV1[];
}>;
export declare const SPONGE_KNOWLEDGE_DOMAIN_RANGE_NOTES_V2: {
    [k: string]: string;
};
/** Qualified local profiles with explicit V1 lineage; availability does not imply installation or review. */
export declare function spongeKnowledgeDomainCatalogV2(): Promise<SpongeKnowledgeDomainCatalogV2>;
//# sourceMappingURL=knowledge-domain-catalog-v2.d.ts.map