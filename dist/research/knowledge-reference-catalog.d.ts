import { type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
export type SpongeKnowledgeReferenceCatalog = Readonly<{
    corePack: KnowledgeVocabularyPackManifestV1;
    referencePack: KnowledgeVocabularyPackManifestV1;
}>;
/** The immutable reference codecs and shared context definitions, without domain-profile initialization. */
export declare function spongeKnowledgeReferenceCatalog(): Promise<SpongeKnowledgeReferenceCatalog>;
//# sourceMappingURL=knowledge-reference-catalog.d.ts.map