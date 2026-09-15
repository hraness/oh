import { type SpongeKnowledgeDomainCatalogV4 } from "./knowledge-domain-catalog-v4";
import { type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
export type SpongeKnowledgeDomainCatalogV5 = SpongeKnowledgeDomainCatalogV4 & Readonly<{
    bridgeRelationsPack: KnowledgeVocabularyPackManifestV1;
}>;
/** Adds cross-domain bridge predicates without revising any published pack. */
export declare function spongeKnowledgeDomainCatalogV5(): Promise<SpongeKnowledgeDomainCatalogV5>;
//# sourceMappingURL=knowledge-domain-catalog-v5.d.ts.map