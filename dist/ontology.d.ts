import { type Sha256Hex } from "./canonical";
export declare const OH_ONTOLOGY_VERSION_V1: "1.0.0";
export declare const OH_CONTRACT_ID_V1: "oh.ontology.v1";
export declare const OH_KNOWLEDGE_LIMITS_V1: Readonly<{
    dimensions: 64;
    listValues: 256;
    qualifiers: 128;
    statementBytes: number;
    textBytes: number;
}>;
export declare const OH_KNOWLEDGE_KERNEL_CONCEPTS_V1: readonly [{
    readonly code: "entity";
    readonly description: "A stable identity anchor for something that can be referred to.";
    readonly label: "Entity";
}, {
    readonly code: "statement";
    readonly description: "An immutable proposition with a subject, predicate, object, and qualifiers.";
    readonly label: "Statement";
}, {
    readonly code: "assertion";
    readonly description: "An attributable stance toward a statement.";
    readonly label: "Assertion";
}, {
    readonly code: "evidence";
    readonly description: "A typed account of how an observation bears on an assertion.";
    readonly label: "Evidence";
}, {
    readonly code: "context";
    readonly description: "The scenario and dimensions in which knowledge applies.";
    readonly label: "Context";
}, {
    readonly code: "inquiry";
    readonly description: "A question and its durable investigation trail.";
    readonly label: "Inquiry";
}, {
    readonly code: "projection";
    readonly description: "A reproducible view derived from exact knowledge.";
    readonly label: "Projection";
}];
export type KnowledgeOntologyIssueCode = "dependency-missing" | "digest-mismatch" | "invalid-input" | "limit-exceeded" | "noncanonical-input";
export type KnowledgeOntologyResult<T> = Readonly<{
    ok: true;
    value: T;
}> | Readonly<{
    error: Readonly<{
        code: KnowledgeOntologyIssueCode;
        field: string;
    }>;
    ok: false;
}>;
declare const entityIdBrand: unique symbol;
declare const assertionIdBrand: unique symbol;
declare const evidenceIdBrand: unique symbol;
declare const inquiryIdBrand: unique symbol;
export type KnowledgeEntityId = string & {
    readonly [entityIdBrand]: "KnowledgeEntityId";
};
export type KnowledgeAssertionId = string & {
    readonly [assertionIdBrand]: "KnowledgeAssertionId";
};
export type KnowledgeEvidenceId = string & {
    readonly [evidenceIdBrand]: "KnowledgeEvidenceId";
};
export type KnowledgeInquiryId = string & {
    readonly [inquiryIdBrand]: "KnowledgeInquiryId";
};
export declare function parseKnowledgeEntityId(value: unknown): KnowledgeEntityId | null;
export declare function parseKnowledgeAssertionId(value: unknown): KnowledgeAssertionId | null;
export declare function parseKnowledgeEvidenceId(value: unknown): KnowledgeEvidenceId | null;
export declare function parseKnowledgeInquiryId(value: unknown): KnowledgeInquiryId | null;
export declare const OH_KNOWLEDGE_ENTITY_STATES_V1: readonly ["active", "quarantined", "redirected", "tombstoned"];
export type KnowledgeEntityStateV1 = (typeof OH_KNOWLEDGE_ENTITY_STATES_V1)[number];
export type KnowledgeEntityV1 = Readonly<{
    entityId: KnowledgeEntityId;
    identityOperationId: string;
    identityRevision: number;
    redirectEntityId: KnowledgeEntityId | null;
    state: KnowledgeEntityStateV1;
    v: 1;
}>;
export declare function parseKnowledgeEntityV1(value: unknown): KnowledgeOntologyResult<KnowledgeEntityV1>;
export type KnowledgeSchemaRefV1 = Readonly<{
    code: string;
    namespace: string;
    revision: number;
    schemaSha256: Sha256Hex;
    v: 1;
}>;
export declare function parseKnowledgeSchemaRefV1(value: unknown): KnowledgeOntologyResult<KnowledgeSchemaRefV1>;
export type KnowledgeValueV1 = Readonly<{
    entityId: KnowledgeEntityId;
    kind: "entity";
    v: 1;
}> | Readonly<{
    kind: "text";
    language: string;
    text: string;
    v: 1;
}> | Readonly<{
    kind: "string";
    v: 1;
    value: string;
}> | Readonly<{
    kind: "boolean";
    v: 1;
    value: boolean;
}> | Readonly<{
    kind: "integer" | "decimal";
    v: 1;
    value: string;
}> | Readonly<{
    kind: "uri";
    uri: string;
    v: 1;
}> | Readonly<{
    kind: "list" | "set";
    v: 1;
    values: readonly KnowledgeValueV1[];
}> | Readonly<{
    canonicalizerSha256: Sha256Hex;
    canonicalValue: string;
    kind: "extension";
    mediaType: string;
    schema: KnowledgeSchemaRefV1;
    v: 1;
    valueSha256: Sha256Hex;
}>;
export declare function parseKnowledgeValueV1(value: unknown): KnowledgeOntologyResult<KnowledgeValueV1>;
export declare function verifyKnowledgeValueV1(value: KnowledgeValueV1): KnowledgeOntologyResult<KnowledgeValueV1>;
export type KnowledgeDimensionV1 = Readonly<{
    predicate: KnowledgeSchemaRefV1;
    v: 1;
    value: KnowledgeValueV1;
}>;
export type KnowledgeContextV1 = Readonly<{
    contextSha256: Sha256Hex;
    dimensions: readonly KnowledgeDimensionV1[];
    scenario: "actual" | "counterfactual" | "hypothetical" | "planned";
    v: 1;
}>;
export type KnowledgeContextInputV1 = Omit<KnowledgeContextV1, "contextSha256">;
export declare function createKnowledgeContextV1(input: KnowledgeContextInputV1): KnowledgeOntologyResult<KnowledgeContextV1>;
export declare function parseKnowledgeContextV1(value: unknown): KnowledgeOntologyResult<KnowledgeContextV1>;
export type KnowledgeStatementV1 = Readonly<{
    object: KnowledgeValueV1;
    predicate: KnowledgeSchemaRefV1;
    qualifiers: readonly KnowledgeDimensionV1[];
    statementSha256: Sha256Hex;
    subject: KnowledgeEntityId;
    v: 1;
}>;
export type KnowledgeStatementInputV1 = Omit<KnowledgeStatementV1, "statementSha256">;
export declare function createKnowledgeStatementV1(input: KnowledgeStatementInputV1): KnowledgeOntologyResult<KnowledgeStatementV1>;
export declare function parseKnowledgeStatementV1(value: unknown): KnowledgeOntologyResult<KnowledgeStatementV1>;
export type KnowledgeAgentRefV1 = Readonly<{
    entityId: KnowledgeEntityId;
    kind: "entity";
    v: 1;
}> | Readonly<{
    kind: "model";
    model: KnowledgeSchemaRefV1;
    receiptSha256: Sha256Hex;
    v: 1;
}> | Readonly<{
    authority: KnowledgeSchemaRefV1;
    kind: "system";
    receiptSha256: Sha256Hex;
    v: 1;
}>;
export declare const OH_KNOWLEDGE_ACTIVITY_KINDS_V1: readonly ["extraction", "human-entry", "human-review", "import", "model-proposal", "normalization", "publication", "resolution", "transformation"];
export type KnowledgeActivityKindV1 = (typeof OH_KNOWLEDGE_ACTIVITY_KINDS_V1)[number];
export type KnowledgeActivityV1 = Readonly<{
    activitySha256: Sha256Hex;
    actor: KnowledgeAgentRefV1;
    inputSha256s: readonly Sha256Hex[];
    kind: KnowledgeActivityKindV1;
    occurredAt: string;
    outputSha256s: readonly Sha256Hex[];
    policySha256: Sha256Hex;
    tool: KnowledgeSchemaRefV1 | null;
    v: 1;
}>;
export type KnowledgeActivityInputV1 = Omit<KnowledgeActivityV1, "activitySha256">;
export declare function createKnowledgeActivityV1(input: KnowledgeActivityInputV1): KnowledgeOntologyResult<KnowledgeActivityV1>;
export declare function parseKnowledgeActivityV1(value: unknown): KnowledgeOntologyResult<KnowledgeActivityV1>;
export declare const OH_KNOWLEDGE_ASSERTION_STANCES_V1: readonly ["questions", "refutes", "reports", "supports", "undetermined"];
export type KnowledgeAssertionStanceV1 = (typeof OH_KNOWLEDGE_ASSERTION_STANCES_V1)[number];
export declare const OH_KNOWLEDGE_ASSERTION_STATES_V1: readonly ["accepted-for-purpose", "disputed", "proposed", "reviewed", "superseded", "withdrawn"];
export type KnowledgeAssertionStateV1 = (typeof OH_KNOWLEDGE_ASSERTION_STATES_V1)[number];
export type KnowledgeAssertionV1 = Readonly<{
    acceptedPurposes: readonly string[];
    assertionId: KnowledgeAssertionId;
    assertionSha256: Sha256Hex;
    assertor: KnowledgeAgentRefV1;
    confidence: KnowledgeSchemaRefV1 | null;
    contextSha256: Sha256Hex | null;
    provenanceActivitySha256: Sha256Hex;
    reviewActivitySha256: Sha256Hex | null;
    stance: KnowledgeAssertionStanceV1;
    state: KnowledgeAssertionStateV1;
    statementSha256: Sha256Hex;
    v: 1;
}>;
export type KnowledgeAssertionInputV1 = Omit<KnowledgeAssertionV1, "assertionSha256">;
export declare function createKnowledgeAssertionV1(input: KnowledgeAssertionInputV1): KnowledgeOntologyResult<KnowledgeAssertionV1>;
export declare function parseKnowledgeAssertionV1(value: unknown): KnowledgeOntologyResult<KnowledgeAssertionV1>;
export declare const OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1: readonly ["background", "contradicts", "corroborates", "direct-observation", "method", "quotation", "registry-record", "supports"];
export type KnowledgeEvidenceBearingV1 = (typeof OH_KNOWLEDGE_EVIDENCE_BEARINGS_V1)[number];
export type KnowledgeEvidenceLinkV1 = Readonly<{
    assertionSha256: Sha256Hex;
    bearing: KnowledgeEvidenceBearingV1;
    disclosure: "private" | "public" | "shared";
    evidenceId: KnowledgeEvidenceId;
    evidenceSha256: Sha256Hex;
    observationSha256: Sha256Hex | null;
    provenanceActivitySha256: Sha256Hex;
    selector: string | null;
    sourceEntityId: KnowledgeEntityId | null;
    v: 1;
}>;
export type KnowledgeEvidenceLinkInputV1 = Omit<KnowledgeEvidenceLinkV1, "evidenceSha256">;
export declare function createKnowledgeEvidenceLinkV1(input: KnowledgeEvidenceLinkInputV1): KnowledgeOntologyResult<KnowledgeEvidenceLinkV1>;
export declare function parseKnowledgeEvidenceLinkV1(value: unknown): KnowledgeOntologyResult<KnowledgeEvidenceLinkV1>;
export type KnowledgeInquiryV1 = Readonly<{
    answerForm: string;
    authorEntityId: KnowledgeEntityId;
    contextSha256: Sha256Hex | null;
    createdAt: string;
    inquiryId: KnowledgeInquiryId;
    inquirySha256: Sha256Hex;
    language: string;
    parentInquiryIds: readonly KnowledgeInquiryId[];
    privacy: "private" | "public" | "shared";
    question: string;
    status: "abandoned" | "open" | "paused" | "resolved";
    v: 1;
}>;
export type KnowledgeInquiryInputV1 = Omit<KnowledgeInquiryV1, "inquirySha256">;
export declare function createKnowledgeInquiryV1(input: KnowledgeInquiryInputV1): KnowledgeOntologyResult<KnowledgeInquiryV1>;
export declare function parseKnowledgeInquiryV1(value: unknown): KnowledgeOntologyResult<KnowledgeInquiryV1>;
export {};
//# sourceMappingURL=ontology.d.ts.map