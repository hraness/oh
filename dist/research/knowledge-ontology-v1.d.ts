import { type Sha256Hex } from "./integrity-domain";
declare const knowledgeEntityIdBrand: unique symbol;
declare const knowledgeAssertionIdBrand: unique symbol;
declare const knowledgeEvidenceIdBrand: unique symbol;
declare const knowledgeInquiryIdBrand: unique symbol;
declare const knowledgeEditionIdBrand: unique symbol;
export type KnowledgeEntityId = string & {
    readonly [knowledgeEntityIdBrand]: "KnowledgeEntityId";
};
export type KnowledgeAssertionId = string & {
    readonly [knowledgeAssertionIdBrand]: "KnowledgeAssertionId";
};
export type KnowledgeEvidenceId = string & {
    readonly [knowledgeEvidenceIdBrand]: "KnowledgeEvidenceId";
};
export type KnowledgeInquiryId = string & {
    readonly [knowledgeInquiryIdBrand]: "KnowledgeInquiryId";
};
export type KnowledgeEditionId = string & {
    readonly [knowledgeEditionIdBrand]: "KnowledgeEditionId";
};
export declare const SPONGE_KNOWLEDGE_LIMITS_V1: Readonly<{
    acceptedPurposes: 32;
    contexts: 128;
    dimensions: 64;
    evidence: 1024;
    extensionBytes: number;
    geometryPoints: 4096;
    listValues: 256;
    passages: 512;
    qualifiers: 128;
    references: 2048;
    statementBytes: number;
    textBytes: number;
}>;
/** The single purpose under which a synthesis may become a public edition. */
export declare const SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1: "public-encyclopedia";
export declare const SPONGE_KNOWLEDGE_KERNEL_CONCEPTS_V1: readonly [{
    readonly code: "entity";
    readonly description: "A stable identity anchor for something that can be referred to.";
    readonly label: "Entity";
}, {
    readonly code: "statement";
    readonly description: "An immutable proposition with a subject, predicate, object, and qualifiers.";
    readonly label: "Statement";
}, {
    readonly code: "assertion";
    readonly description: "An attributable stance toward a statement for a particular purpose.";
    readonly label: "Assertion";
}, {
    readonly code: "evidence";
    readonly description: "A typed account of how a source or observation bears on an assertion.";
    readonly label: "Evidence";
}, {
    readonly code: "context";
    readonly description: "The time, place, language, perspective, or scenario in which knowledge applies.";
    readonly label: "Context";
}, {
    readonly code: "inquiry";
    readonly description: "A human question and the durable trail of investigation it creates.";
    readonly label: "Inquiry";
}, {
    readonly code: "projection";
    readonly description: "A reproducible view or immutable edition derived from exact knowledge and policy.";
    readonly label: "Projection";
}];
export type KnowledgeOntologyIssueCode = "authority-violation" | "cycle-detected" | "dependency-missing" | "digest-mismatch" | "invalid-input" | "limit-exceeded" | "noncanonical-input" | "truncated";
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
export declare function parseKnowledgeEntityId(value: unknown): KnowledgeEntityId | null;
export declare function parseKnowledgeAssertionId(value: unknown): KnowledgeAssertionId | null;
export declare function parseKnowledgeEvidenceId(value: unknown): KnowledgeEvidenceId | null;
export declare function parseKnowledgeInquiryId(value: unknown): KnowledgeInquiryId | null;
export declare function parseKnowledgeEditionId(value: unknown): KnowledgeEditionId | null;
export declare const SPONGE_KNOWLEDGE_ENTITY_STATES_V1: readonly ["active", "quarantined", "redirected", "tombstoned"];
export type KnowledgeEntityStateV1 = (typeof SPONGE_KNOWLEDGE_ENTITY_STATES_V1)[number];
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
export type KnowledgeTemporalPrecisionV1 = "day" | "minute" | "millisecond" | "month" | "second" | "year";
export type KnowledgeTemporalValueV1 = Readonly<{
    calendar: KnowledgeSchemaRefV1;
    certainty: "after" | "approximate" | "before" | "between" | "exact";
    earliest: string | null;
    kind: "time";
    latest: string | null;
    precision: KnowledgeTemporalPrecisionV1;
    timezone: string | null;
    v: 1;
    value: string;
}>;
export type KnowledgeQuantityUncertaintyV1 = Readonly<{
    kind: "absolute" | "relative";
    minus: string;
    plus: string;
    v: 1;
}>;
export type KnowledgeGeometryPointV1 = readonly [string, string] | readonly [string, string, string];
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
    kind: "integer";
    v: 1;
    value: string;
}> | Readonly<{
    kind: "decimal";
    v: 1;
    value: string;
}> | Readonly<{
    kind: "quantity";
    lowerBound: string | null;
    uncertainty: KnowledgeQuantityUncertaintyV1 | null;
    unit: KnowledgeSchemaRefV1;
    upperBound: string | null;
    v: 1;
    value: string;
}> | KnowledgeTemporalValueV1 | Readonly<{
    end: KnowledgeTemporalValueV1 | null;
    kind: "interval";
    start: KnowledgeTemporalValueV1 | null;
    v: 1;
}> | Readonly<{
    iso8601: string;
    kind: "duration";
    v: 1;
}> | Readonly<{
    calendar: KnowledgeSchemaRefV1;
    kind: "recurrence";
    rule: string;
    startsAt: KnowledgeTemporalValueV1 | null;
    v: 1;
}> | Readonly<{
    coordinates: readonly KnowledgeGeometryPointV1[];
    crs: KnowledgeSchemaRefV1;
    geometryType: "line-string" | "point" | "polygon";
    kind: "geometry";
    precisionMeters: string | null;
    v: 1;
}> | Readonly<{
    kind: "uri";
    uri: string;
    v: 1;
}> | Readonly<{
    kind: "identifier";
    scheme: KnowledgeSchemaRefV1;
    v: 1;
    value: string;
}> | Readonly<{
    kind: "media";
    mediaType: string;
    sourceEntityId: KnowledgeEntityId;
    sourceSha256: Sha256Hex;
    v: 1;
}> | Readonly<{
    kind: "list";
    v: 1;
    values: readonly KnowledgeValueV1[];
}> | Readonly<{
    kind: "set";
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
export declare function verifyKnowledgeValueV1(value: KnowledgeValueV1): Promise<KnowledgeOntologyResult<KnowledgeValueV1>>;
export type KnowledgeDimensionV1 = Readonly<{
    predicate: KnowledgeSchemaRefV1;
    v: 1;
    value: KnowledgeValueV1;
}>;
export declare const SPONGE_KNOWLEDGE_SCENARIOS_V1: readonly ["actual", "counterfactual", "hypothetical", "planned"];
export type KnowledgeScenarioV1 = (typeof SPONGE_KNOWLEDGE_SCENARIOS_V1)[number];
export type KnowledgeContextV1 = Readonly<{
    contextSha256: Sha256Hex;
    dimensions: readonly KnowledgeDimensionV1[];
    scenario: KnowledgeScenarioV1;
    v: 1;
}>;
export type KnowledgeContextInputV1 = Omit<KnowledgeContextV1, "contextSha256">;
export declare function createKnowledgeContextV1(input: KnowledgeContextInputV1): Promise<KnowledgeOntologyResult<KnowledgeContextV1>>;
export declare function parseKnowledgeContextV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeContextV1>>;
export type KnowledgeStatementV1 = Readonly<{
    object: KnowledgeValueV1;
    predicate: KnowledgeSchemaRefV1;
    qualifiers: readonly KnowledgeDimensionV1[];
    statementSha256: Sha256Hex;
    subject: KnowledgeEntityId;
    v: 1;
}>;
export type KnowledgeStatementInputV1 = Omit<KnowledgeStatementV1, "statementSha256">;
export declare function createKnowledgeStatementV1(input: KnowledgeStatementInputV1): Promise<KnowledgeOntologyResult<KnowledgeStatementV1>>;
export declare function parseKnowledgeStatementV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeStatementV1>>;
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
export declare const SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1: readonly ["extraction", "human-entry", "human-review", "import", "model-proposal", "normalization", "publication", "resolution", "transformation"];
export type KnowledgeActivityKindV1 = (typeof SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1)[number];
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
export declare function createKnowledgeActivityV1(input: KnowledgeActivityInputV1): Promise<KnowledgeOntologyResult<KnowledgeActivityV1>>;
export declare function parseKnowledgeActivityV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeActivityV1>>;
export declare const SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1: readonly ["questions", "refutes", "reports", "supports", "undetermined"];
export type KnowledgeAssertionStanceV1 = (typeof SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1)[number];
export declare const SPONGE_KNOWLEDGE_ASSERTION_STATES_V1: readonly ["accepted-for-purpose", "disputed", "proposed", "reviewed", "superseded", "withdrawn"];
export type KnowledgeAssertionStateV1 = (typeof SPONGE_KNOWLEDGE_ASSERTION_STATES_V1)[number];
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
export declare function createKnowledgeAssertionV1(input: KnowledgeAssertionInputV1): Promise<KnowledgeOntologyResult<KnowledgeAssertionV1>>;
export declare function parseKnowledgeAssertionV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeAssertionV1>>;
export declare const SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1: readonly ["background", "contradicts", "corroborates", "direct-observation", "method", "quotation", "registry-record", "supports"];
export type KnowledgeEvidenceBearingV1 = (typeof SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1)[number];
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
export declare function createKnowledgeEvidenceLinkV1(input: KnowledgeEvidenceLinkInputV1): Promise<KnowledgeOntologyResult<KnowledgeEvidenceLinkV1>>;
export declare function parseKnowledgeEvidenceLinkV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeEvidenceLinkV1>>;
export type KnowledgeInquiryV1 = Readonly<{
    answerForm: string;
    authorEntityId: KnowledgeEntityId;
    contextSha256: Sha256Hex | null;
    createdAt: string;
    inquiryId: KnowledgeInquiryId;
    inquirySha256: Sha256Hex;
    language: string;
    /**
     * The released edition this question builds on. Records written before the
     * field existed omit it; a null value is left out of the digest so their
     * `inquirySha256` is unchanged.
     */
    parentEditionId: KnowledgeEditionId | null;
    parentInquiryIds: readonly KnowledgeInquiryId[];
    privacy: "private" | "public" | "shared";
    question: string;
    status: "abandoned" | "open" | "paused" | "resolved";
    v: 1;
}>;
export type KnowledgeInquiryInputV1 = Omit<KnowledgeInquiryV1, "inquirySha256" | "parentEditionId"> & Readonly<{
    parentEditionId?: KnowledgeEditionId | null;
}>;
export declare function createKnowledgeInquiryV1(input: KnowledgeInquiryInputV1): Promise<KnowledgeOntologyResult<KnowledgeInquiryV1>>;
export declare function parseKnowledgeInquiryV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeInquiryV1>>;
export type KnowledgeShapeV1 = Readonly<{
    allowedPredicates: readonly KnowledgeSchemaRefV1[] | null;
    extends: readonly KnowledgeSchemaRefV1[];
    requiredEvidenceBearings: readonly KnowledgeEvidenceBearingV1[];
    requiredPredicates: readonly KnowledgeSchemaRefV1[];
    shape: KnowledgeSchemaRefV1;
    shapeSha256: Sha256Hex;
    v: 1;
}>;
export type KnowledgeShapeInputV1 = Omit<KnowledgeShapeV1, "shapeSha256">;
export declare function createKnowledgeShapeV1(input: KnowledgeShapeInputV1): Promise<KnowledgeOntologyResult<KnowledgeShapeV1>>;
export declare function parseKnowledgeShapeV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeShapeV1>>;
export type KnowledgeViewSpecV1 = Readonly<{
    audience: string;
    budgets: Readonly<{
        bytes: number;
        depth: number;
        sources: number;
    }>;
    excludedContextSha256s: readonly Sha256Hex[];
    includedContextSha256s: readonly Sha256Hex[];
    language: string;
    policySha256s: Readonly<{
        dispute: Sha256Hex;
        evidence: Sha256Hex;
        rights: Sha256Hex;
        traversal: Sha256Hex;
    }>;
    root: Readonly<{
        entityId: KnowledgeEntityId;
        kind: "entity";
    }> | Readonly<{
        inquiryId: KnowledgeInquiryId;
        kind: "inquiry";
    }>;
    shapes: readonly KnowledgeSchemaRefV1[];
    v: 1;
    viewForm: string;
    viewSpecSha256: Sha256Hex;
    vocabularies: readonly KnowledgeSchemaRefV1[];
}>;
export type KnowledgeViewSpecInputV1 = Omit<KnowledgeViewSpecV1, "viewSpecSha256">;
export declare function createKnowledgeViewSpecV1(input: KnowledgeViewSpecInputV1): Promise<KnowledgeOntologyResult<KnowledgeViewSpecV1>>;
export declare function parseKnowledgeViewSpecV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeViewSpecV1>>;
export type KnowledgeSynthesisPassageV1 = Readonly<{
    authorship: "human" | "model";
    supportStatementSha256s: readonly Sha256Hex[];
    text: string;
    v: 1;
}>;
/**
 * Immutable, server-built review subject. A candidate owns the prose and its
 * complete semantic support set. It deliberately has no human review receipt,
 * edition digest, output graph, or publication clock, so reviewing it cannot
 * create a cryptographic cycle.
 */
export type KnowledgeSynthesisCandidateV1 = Readonly<{
    assertionSha256s: readonly Sha256Hex[];
    candidateSha256: Sha256Hex;
    canonicalOutputSha256: Sha256Hex;
    editionId: KnowledgeEditionId;
    evidenceSha256s: readonly Sha256Hex[];
    generationReceiptSha256: Sha256Hex | null;
    identityReceiptSha256: Sha256Hex;
    inputGraphRevisionSha256: Sha256Hex;
    passages: readonly KnowledgeSynthesisPassageV1[];
    purpose: typeof SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1;
    rightsReceiptSha256: Sha256Hex;
    statementSha256s: readonly Sha256Hex[];
    unresolvedStatementSha256s: readonly Sha256Hex[];
    v: 1;
    viewSpecSha256: Sha256Hex;
}>;
export type KnowledgeSynthesisCandidateInputV1 = Omit<KnowledgeSynthesisCandidateV1, "candidateSha256">;
/** A compact attestation to one accepted human review decision. */
export type KnowledgeHumanReviewReceiptV1 = Readonly<{
    candidateSha256: Sha256Hex;
    decisionSha256: Sha256Hex;
    outcome: "accept";
    policySha256: Sha256Hex;
    purpose: typeof SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1;
    receiptSha256: Sha256Hex;
    reviewedAt: string;
    reviewerEntityId: KnowledgeEntityId;
    v: 1;
}>;
export type KnowledgeHumanReviewReceiptInputV1 = Omit<KnowledgeHumanReviewReceiptV1, "receiptSha256">;
/**
 * The semantic record appended by the final edition operation. Prose remains
 * in the reviewed candidate; publication state remains in the later release.
 */
export type KnowledgeEditionV1 = Readonly<{
    candidateSha256: Sha256Hex;
    dependencyManifestSha256: Sha256Hex;
    editionId: KnowledgeEditionId;
    editionSha256: Sha256Hex;
    humanReviewReceiptSha256: Sha256Hex;
    inputGraphRevisionSha256: Sha256Hex;
    purpose: typeof SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1;
    reviewDecisionSha256: Sha256Hex;
    v: 1;
}>;
export type KnowledgeEditionInputV1 = Omit<KnowledgeEditionV1, "editionSha256">;
/**
 * Post-commit publication artifact. Only the authority boundary may choose
 * publishedAt; neither a candidate nor an edition operation can predeclare it.
 */
export type KnowledgeEditionReleaseV1 = Readonly<{
    authorityAckReceiptSha256: Sha256Hex;
    candidateSha256: Sha256Hex;
    completionReceiptSha256: Sha256Hex;
    dependencyManifestSha256: Sha256Hex;
    editionId: KnowledgeEditionId;
    editionSha256: Sha256Hex;
    humanReviewReceiptSha256: Sha256Hex;
    inputGraphRevisionSha256: Sha256Hex;
    operationId: string;
    outputGraphRevisionSha256: Sha256Hex;
    publishedAt: string;
    purpose: typeof SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1;
    releaseSha256: Sha256Hex;
    v: 1;
}>;
export type KnowledgeEditionReleaseInputV1 = Omit<KnowledgeEditionReleaseV1, "releaseSha256">;
export declare function createKnowledgeSynthesisCandidateV1(input: KnowledgeSynthesisCandidateInputV1): Promise<KnowledgeOntologyResult<KnowledgeSynthesisCandidateV1>>;
export declare function parseKnowledgeSynthesisCandidateV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeSynthesisCandidateV1>>;
export declare function createKnowledgeHumanReviewReceiptV1(input: KnowledgeHumanReviewReceiptInputV1): Promise<KnowledgeOntologyResult<KnowledgeHumanReviewReceiptV1>>;
export declare function parseKnowledgeHumanReviewReceiptV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeHumanReviewReceiptV1>>;
export declare function createKnowledgeEditionV1(input: KnowledgeEditionInputV1): Promise<KnowledgeOntologyResult<KnowledgeEditionV1>>;
export declare function parseKnowledgeEditionV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeEditionV1>>;
export declare function createKnowledgeEditionReleaseV1(input: KnowledgeEditionReleaseInputV1): Promise<KnowledgeOntologyResult<KnowledgeEditionReleaseV1>>;
export declare function parseKnowledgeEditionReleaseV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeEditionReleaseV1>>;
export {};
//# sourceMappingURL=knowledge-ontology-v1.d.ts.map