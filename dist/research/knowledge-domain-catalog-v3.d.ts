import { type SpongeKnowledgeDomainCatalogV2 } from "./knowledge-domain-catalog-v2";
import { type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
export type SpongeKnowledgeDomainCatalogV3 = SpongeKnowledgeDomainCatalogV2 & Readonly<{
    sourceRelationsPack: KnowledgeVocabularyPackManifestV1;
}>;
/** Adds source-attribution predicates without revising any published pack or granting installation authority. */
export declare function spongeKnowledgeDomainCatalogV3(): Promise<SpongeKnowledgeDomainCatalogV3>;
//# sourceMappingURL=knowledge-domain-catalog-v3.d.ts.map