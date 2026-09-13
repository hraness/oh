import { type Sha256Hex } from "./integrity-domain";
import { type KnowledgeExecutableShapeV1, type KnowledgeSchemaRevisionV1, type KnowledgeVocabularyRevisionV1 } from "./knowledge-ontology-contract-v1";
import { type KnowledgeOntologyResult, type KnowledgeSchemaRefV1, type KnowledgeValueV1 } from "./knowledge-ontology-v1";
export declare const SPONGE_KNOWLEDGE_PACK_CODECS_V1: readonly ["globe-coordinate", "language-text", "missing-value", "wikibase-time"];
export type KnowledgePackCodecV1 = (typeof SPONGE_KNOWLEDGE_PACK_CODECS_V1)[number];
export type KnowledgeVocabularyPackPinV1 = Readonly<{
    manifestSha256: Sha256Hex;
    packId: string;
    revision: number;
    v: 1;
}>;
export type KnowledgeVocabularyPackSourceV1 = Readonly<{
    contentSha256: Sha256Hex;
    license: string;
    revision: string;
    uri: string;
    v: 1;
}>;
export type KnowledgeVocabularyPackExampleV1 = Readonly<{
    description: string;
    id: string;
    object: KnowledgeValueV1;
    predicate: KnowledgeSchemaRefV1;
    subjectConcept: KnowledgeSchemaRefV1;
    v: 1;
}>;
export type KnowledgeVocabularyPackQueryV1 = Readonly<{
    description: string;
    id: string;
    predicates: readonly KnowledgeSchemaRefV1[];
    v: 1;
}>;
export type KnowledgeVocabularyPackManifestV1 = Readonly<{
    canonicalizerSha256: Sha256Hex;
    dependencies: readonly KnowledgeVocabularyPackPinV1[];
    display: Readonly<{
        labelPredicates: readonly KnowledgeSchemaRefV1[];
        v: 1;
    }>;
    examples: readonly KnowledgeVocabularyPackExampleV1[];
    manifestSha256: Sha256Hex;
    migrationNotes: string;
    packId: string;
    previousManifestSha256: Sha256Hex | null;
    queries: readonly KnowledgeVocabularyPackQueryV1[];
    revision: number;
    schemas: readonly KnowledgeSchemaRevisionV1[];
    shapes: readonly KnowledgeExecutableShapeV1[];
    sources: readonly KnowledgeVocabularyPackSourceV1[];
    supportedCodecs: readonly KnowledgePackCodecV1[];
    v: 1;
    vocabulary: KnowledgeVocabularyRevisionV1;
}>;
export type KnowledgeVocabularyPackManifestInputV1 = Omit<KnowledgeVocabularyPackManifestV1, "manifestSha256">;
export type KnowledgeVocabularyPackLockV1 = Readonly<{
    lockSha256: Sha256Hex;
    packs: readonly KnowledgeVocabularyPackPinV1[];
    roots: readonly KnowledgeVocabularyPackPinV1[];
    v: 1;
}>;
export type KnowledgeVocabularyPackResolutionV1 = Readonly<{
    lock: KnowledgeVocabularyPackLockV1;
    /** Dependencies precede dependants; independent branches sort by pack identity. */
    packs: readonly KnowledgeVocabularyPackManifestV1[];
}>;
export declare function knowledgeVocabularyPackPinV1(pack: KnowledgeVocabularyPackManifestV1): KnowledgeVocabularyPackPinV1;
export declare function createKnowledgeVocabularyPackManifestV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackManifestV1>>;
export declare function parseKnowledgeVocabularyPackManifestV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackManifestV1>>;
export declare function createKnowledgeVocabularyPackLockV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackLockV1>>;
export declare function parseKnowledgeVocabularyPackLockV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackLockV1>>;
/** Validates data closure only. Installation must independently authorize the space and namespace owner. */
export declare function resolveKnowledgeVocabularyPacksV1(input: Readonly<{
    manifests: readonly unknown[];
    roots: readonly KnowledgeVocabularyPackPinV1[];
}>): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackResolutionV1>>;
/** A digest-valid lock is authoritative only after its exact transitive closure is verified. */
export declare function verifyKnowledgeVocabularyPackLockV1(input: Readonly<{
    lock: unknown;
    manifests: readonly unknown[];
}>): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackResolutionV1>>;
//# sourceMappingURL=knowledge-vocabulary-pack-v1.d.ts.map