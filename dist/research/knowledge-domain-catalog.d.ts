import { type KnowledgeSchemaRevisionV1, type KnowledgeVocabularyRevisionV1 } from "./knowledge-ontology-contract-v1";
import { type KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import { type KnowledgeVocabularyPackLockV1, type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
export declare const SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS: readonly string[];
export type SpongeKnowledgeDomainCatalog = Readonly<{
    corePack: KnowledgeVocabularyPackManifestV1;
    lock: KnowledgeVocabularyPackLockV1;
    /** Available builtin definitions, not an assertion of installation in a knowledge space. */
    packs: readonly KnowledgeVocabularyPackManifestV1[];
    referencePack: KnowledgeVocabularyPackManifestV1;
    schemas: readonly KnowledgeSchemaRevisionV1[];
    vocabularies: readonly KnowledgeVocabularyRevisionV1[];
}>;
export declare function spongeKnowledgeDomainCatalog(): Promise<SpongeKnowledgeDomainCatalog>;
/** Exact digest-bound lookup; display labels and unqualified codes cannot resolve schema identity. */
export declare function knowledgeDomainSchemaByRef(catalog: SpongeKnowledgeDomainCatalog, ref: KnowledgeSchemaRefV1): KnowledgeSchemaRevisionV1 | null;
//# sourceMappingURL=knowledge-domain-catalog.d.ts.map