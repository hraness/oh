import { type SpongeKnowledgeDomainCatalogV6 } from "./knowledge-domain-catalog-v6";
import { type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
export type SpongeKnowledgeDomainCatalogV7 = SpongeKnowledgeDomainCatalogV6 & Readonly<{
    participationRolesPack: KnowledgeVocabularyPackManifestV1;
}>;
/** Attributed participation roles, with every earlier declaration retained unchanged. */
export declare function spongeKnowledgeDomainCatalogV7(): Promise<SpongeKnowledgeDomainCatalogV7>;
//# sourceMappingURL=knowledge-domain-catalog-v7.d.ts.map