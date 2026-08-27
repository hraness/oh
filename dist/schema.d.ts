import { type JsonObject, type Sha256Hex } from "./canonical";
import { type KnowledgeSchemaRefV1 } from "./ontology";
export declare const OH_SCHEMA_FORMAT_VERSION_V1: 1;
export declare const OH_SCHEMA_KINDS_V1: readonly ["concept", "mapping", "predicate", "shape", "unit", "vocabulary"];
export type KnowledgeSchemaKindV1 = (typeof OH_SCHEMA_KINDS_V1)[number];
export type KnowledgeLocalizedTextV1 = Readonly<{
    language: string;
    text: string;
    v: 1;
}>;
export type KnowledgeSchemaRevisionInputV1 = Readonly<{
    body: JsonObject;
    code: string;
    compatibility: "additive" | "breaking";
    description: readonly KnowledgeLocalizedTextV1[];
    kind: KnowledgeSchemaKindV1;
    labels: readonly KnowledgeLocalizedTextV1[];
    namespace: string;
    previousSchemaSha256: Sha256Hex | null;
    revision: number;
    v: 1;
}>;
export type KnowledgeSchemaRevisionV1 = KnowledgeSchemaRevisionInputV1 & Readonly<{
    schemaSha256: Sha256Hex;
}>;
export type KnowledgeVocabularyRevisionV1 = Readonly<{
    namespace: string;
    revision: number;
    schemaRefs: readonly KnowledgeSchemaRefV1[];
    v: 1;
    vocabularySha256: Sha256Hex;
}>;
export declare function createKnowledgeSchemaRevisionV1(input: KnowledgeSchemaRevisionInputV1): KnowledgeSchemaRevisionV1;
export declare function parseKnowledgeSchemaRevisionV1(value: unknown): KnowledgeSchemaRevisionV1 | null;
export declare function knowledgeSchemaRefV1(schema: KnowledgeSchemaRevisionV1): KnowledgeSchemaRefV1;
/** Checks the immutable chain and the meaning of an additive evolution claim. */
export declare function verifyKnowledgeSchemaEvolutionV1(prior: KnowledgeSchemaRevisionV1, next: KnowledgeSchemaRevisionV1): Readonly<{
    ok: true;
}> | Readonly<{
    ok: false;
    reason: string;
}>;
export declare function createKnowledgeVocabularyRevisionV1(input: Omit<KnowledgeVocabularyRevisionV1, "vocabularySha256">): KnowledgeVocabularyRevisionV1;
export declare function parseKnowledgeVocabularyRevisionV1(value: unknown): KnowledgeVocabularyRevisionV1 | null;
//# sourceMappingURL=schema.d.ts.map