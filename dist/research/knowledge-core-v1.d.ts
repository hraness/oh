import { type KnowledgeConceptRevisionV1, type KnowledgePredicateRevisionV1, type KnowledgeSchemaRevisionV1, type KnowledgeVocabularyRevisionV1 } from "./knowledge-ontology-contract-v1";
import { type Sha256Hex } from "./integrity-domain";
export type SpongeCoreRightsPolicyV1 = Readonly<{
    defaultDisclosure: "private";
    humanReviewRequiredFor: readonly ["identity", "public-encyclopedia", "schema"];
    purposes: readonly ["public-encyclopedia"];
    publicRequiresEvidence: true;
    v: 1;
}>;
export type SpongeCoreKnowledgeCatalogV1 = Readonly<{
    canonicalizerSha256: Sha256Hex;
    concepts: readonly KnowledgeConceptRevisionV1[];
    predicates: readonly KnowledgePredicateRevisionV1[];
    recordSchemaSha256: Sha256Hex;
    rightsPolicy: SpongeCoreRightsPolicyV1;
    rightsPolicySha256: Sha256Hex;
    schemas: readonly KnowledgeSchemaRevisionV1[];
    v: 1;
    vocabulary: KnowledgeVocabularyRevisionV1;
    vocabularySetSha256: Sha256Hex;
}>;
/**
 * The immutable, minimal vocabulary every Sponge knowledge space can rely on.
 * Product-specific ontologies extend it through reviewed vocabulary revisions;
 * they never add new hard-coded root entity kinds.
 */
export declare function spongeCoreKnowledgeCatalogV1(): Promise<SpongeCoreKnowledgeCatalogV1>;
//# sourceMappingURL=knowledge-core-v1.d.ts.map