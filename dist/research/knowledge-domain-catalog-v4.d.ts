import { type SpongeKnowledgeDomainCatalogV3 } from "./knowledge-domain-catalog-v3";
import { type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
export type SpongeKnowledgeDomainCatalogV4 = SpongeKnowledgeDomainCatalogV3 & Readonly<{
    identityContextPack: KnowledgeVocabularyPackManifestV1;
}>;
/** Adds identity and context records while preserving V1–V3 catalog and pack bytes. */
export declare function spongeKnowledgeDomainCatalogV4(): Promise<SpongeKnowledgeDomainCatalogV4>;
//# sourceMappingURL=knowledge-domain-catalog-v4.d.ts.map