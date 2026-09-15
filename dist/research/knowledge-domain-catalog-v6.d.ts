import { type SpongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import { type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
export declare const SPONGE_KNOWLEDGE_EXTENSION_PACK_IDS_V6: readonly ["sponge.measurement-results", "sponge.monetary-values", "sponge.content-occurrences"];
export type SpongeKnowledgeDomainCatalogV6 = SpongeKnowledgeDomainCatalogV5 & Readonly<{
    measurementResultsPack: KnowledgeVocabularyPackManifestV1;
    monetaryValuesPack: KnowledgeVocabularyPackManifestV1;
    contentOccurrencesPack: KnowledgeVocabularyPackManifestV1;
}>;
/** Independently selectable depth extensions; published catalog declarations remain unchanged. */
export declare function spongeKnowledgeDomainCatalogV6(): Promise<SpongeKnowledgeDomainCatalogV6>;
//# sourceMappingURL=knowledge-domain-catalog-v6.d.ts.map