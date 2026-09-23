import { type SpongeKnowledgeDomainCatalogV7 } from "./knowledge-domain-catalog-v7";
import { type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
export declare const SPONGE_KNOWLEDGE_EXTENSION_PACK_IDS_V8: readonly ["sponge.temporal-roles", "sponge.evidence-grading", "sponge.citation", "sponge.research-ops", "sponge.source-quality", "sponge.source-policy"];
export type SpongeKnowledgeDomainCatalogV8 = SpongeKnowledgeDomainCatalogV7 & Readonly<{
    temporalRolesPack: KnowledgeVocabularyPackManifestV1;
    evidenceGradingPack: KnowledgeVocabularyPackManifestV1;
    citationPack: KnowledgeVocabularyPackManifestV1;
    researchOpsPack: KnowledgeVocabularyPackManifestV1;
    sourceQualityPack: KnowledgeVocabularyPackManifestV1;
    sourcePolicyPack: KnowledgeVocabularyPackManifestV1;
}>;
/** Research evidence operations: temporal roles, grading, citations, corpus operations and source governance. */
export declare function spongeKnowledgeDomainCatalogV8(): Promise<SpongeKnowledgeDomainCatalogV8>;
//# sourceMappingURL=knowledge-domain-catalog-v8.d.ts.map