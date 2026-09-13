import { type Sha256Hex } from "./integrity-domain";
import { type KnowledgeActivityV1, type KnowledgeAssertionV1, type KnowledgeContextV1, type KnowledgeEditionV1, type KnowledgeEntityId, type KnowledgeEntityV1, type KnowledgeEvidenceBearingV1, type KnowledgeEvidenceLinkV1, type KnowledgeInquiryId, type KnowledgeInquiryV1, type KnowledgeOntologyResult, type KnowledgeSchemaRefV1, type KnowledgeStatementV1, type KnowledgeHumanReviewReceiptV1, type KnowledgeSynthesisCandidateV1, type KnowledgeTemporalValueV1, type KnowledgeValueV1, type KnowledgeViewSpecV1 } from "./knowledge-ontology-v1";
export type KnowledgeLocalizedTextV1 = Readonly<{
    language: string;
    text: string;
    v: 1;
}>;
export type KnowledgeSchemaIdentityV1 = Readonly<{
    code: string;
    namespace: string;
    revision: number;
    v: 1;
}>;
export type KnowledgeValueKindV1 = KnowledgeValueV1["kind"];
export type KnowledgeValueRangeV1 = Readonly<{
    kind: "any";
    v: 1;
}> | Readonly<{
    kind: "value-kinds";
    v: 1;
    valueKinds: readonly KnowledgeValueKindV1[];
}> | Readonly<{
    concepts: readonly KnowledgeSchemaRefV1[];
    kind: "entity-concepts";
    v: 1;
}> | Readonly<{
    kind: "numeric";
    lowerBound: string | null;
    unit: KnowledgeSchemaRefV1 | null;
    upperBound: string | null;
    v: 1;
}> | Readonly<{
    kind: "text";
    languages: readonly string[] | null;
    maximumBytes: number;
    v: 1;
}> | Readonly<{
    kind: "enum";
    v: 1;
    values: readonly KnowledgeValueV1[];
}>;
export declare function parseKnowledgeValueRangeV1(value: unknown): KnowledgeOntologyResult<KnowledgeValueRangeV1>;
export type KnowledgeVocabularyRevisionV1 = Readonly<{
    canonicalizerSha256: Sha256Hex;
    labels: readonly KnowledgeLocalizedTextV1[];
    namespace: string;
    ownerEntityId: KnowledgeEntityId;
    previousRevisionSha256: Sha256Hex | null;
    revision: number;
    revisionSha256: Sha256Hex;
    state: "private" | "public" | "retired" | "shared";
    v: 1;
}>;
export type KnowledgeVocabularyRevisionInputV1 = Omit<KnowledgeVocabularyRevisionV1, "revisionSha256">;
export declare function createKnowledgeVocabularyRevisionV1(input: KnowledgeVocabularyRevisionInputV1): Promise<KnowledgeOntologyResult<KnowledgeVocabularyRevisionV1>>;
export declare function parseKnowledgeVocabularyRevisionV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyRevisionV1>>;
type KnowledgeSchemaRevisionBaseV1 = Readonly<{
    definitions: readonly KnowledgeLocalizedTextV1[];
    identity: KnowledgeSchemaIdentityV1;
    labels: readonly KnowledgeLocalizedTextV1[];
    previousRevisionSha256: Sha256Hex | null;
    reviewDecisionSha256: Sha256Hex | null;
    v: 1;
    vocabularySha256: Sha256Hex;
}>;
export type KnowledgeConceptRevisionInputV1 = KnowledgeSchemaRevisionBaseV1 & Readonly<{
    broader: readonly KnowledgeSchemaRefV1[];
    kind: "concept";
}>;
export type KnowledgePredicateRevisionInputV1 = KnowledgeSchemaRevisionBaseV1 & Readonly<{
    domainConcepts: readonly KnowledgeSchemaRefV1[];
    inversePredicate: KnowledgeSchemaRefV1 | null;
    kind: "predicate";
    qualifierPredicates: readonly KnowledgeSchemaRefV1[];
    range: KnowledgeValueRangeV1;
}>;
export type KnowledgeUnitRevisionInputV1 = KnowledgeSchemaRevisionBaseV1 & Readonly<{
    dimension: string;
    kind: "unit";
    offset: string;
    scale: string;
    symbol: string;
}>;
export type KnowledgeMappingRevisionInputV1 = KnowledgeSchemaRevisionBaseV1 & Readonly<{
    kind: "mapping";
    mappingActivitySha256: Sha256Hex;
    mappingPolicySha256: Sha256Hex;
    relation: "broader" | "close" | "exact" | "narrower" | "related" | "transformable";
    source: KnowledgeSchemaRefV1;
    target: KnowledgeSchemaRefV1;
}>;
export type KnowledgeSchemaRevisionInputV1 = KnowledgeConceptRevisionInputV1 | KnowledgeMappingRevisionInputV1 | KnowledgePredicateRevisionInputV1 | KnowledgeUnitRevisionInputV1;
export type KnowledgeSchemaRevisionV1 = KnowledgeSchemaRevisionInputV1 & Readonly<{
    ref: KnowledgeSchemaRefV1;
    revisionSha256: Sha256Hex;
}>;
export type KnowledgeConceptRevisionV1 = Extract<KnowledgeSchemaRevisionV1, {
    kind: "concept";
}>;
export type KnowledgePredicateRevisionV1 = Extract<KnowledgeSchemaRevisionV1, {
    kind: "predicate";
}>;
export type KnowledgeUnitRevisionV1 = Extract<KnowledgeSchemaRevisionV1, {
    kind: "unit";
}>;
export type KnowledgeMappingRevisionV1 = Extract<KnowledgeSchemaRevisionV1, {
    kind: "mapping";
}>;
export declare function createKnowledgeSchemaRevisionV1(input: KnowledgeSchemaRevisionInputV1): Promise<KnowledgeOntologyResult<KnowledgeSchemaRevisionV1>>;
export declare function parseKnowledgeSchemaRevisionV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeSchemaRevisionV1>>;
export declare function verifyKnowledgeSchemaEvolutionV1(revisions: readonly KnowledgeSchemaRevisionV1[]): KnowledgeOntologyResult<readonly KnowledgeSchemaRevisionV1[]>;
export declare const SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1: readonly ["create", "merge", "quarantine", "rekey", "split", "tombstone"];
export type KnowledgeIdentityOperationKindV1 = (typeof SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1)[number];
export type KnowledgeIdentityAssignmentV1 = Readonly<{
    fromEntityId: KnowledgeEntityId;
    toEntityIds: readonly KnowledgeEntityId[];
    v: 1;
}>;
export type KnowledgeIdentityOperationV1 = Readonly<{
    activitySha256: Sha256Hex;
    assignments: readonly KnowledgeIdentityAssignmentV1[];
    kind: KnowledgeIdentityOperationKindV1;
    occurredAt: string;
    operationId: string;
    operationSha256: Sha256Hex;
    postimageEntities: readonly KnowledgeEntityV1[];
    postimageSha256: Sha256Hex;
    preimageEntities: readonly KnowledgeEntityV1[];
    preimageSha256: Sha256Hex;
    v: 1;
}>;
export type KnowledgeIdentityOperationInputV1 = Omit<KnowledgeIdentityOperationV1, "operationSha256" | "postimageSha256" | "preimageSha256">;
export declare function createKnowledgeIdentityOperationV1(input: KnowledgeIdentityOperationInputV1): Promise<KnowledgeOntologyResult<KnowledgeIdentityOperationV1>>;
export declare function parseKnowledgeIdentityOperationV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeIdentityOperationV1>>;
export declare function verifyKnowledgeIdentityOperationAgainstHeadsV1(operation: KnowledgeIdentityOperationV1, currentHeads: readonly KnowledgeEntityV1[]): Promise<KnowledgeOntologyResult<KnowledgeIdentityOperationV1>>;
export type KnowledgeTypeMembershipV1 = Readonly<{
    assertionSha256: Sha256Hex;
    concept: KnowledgeSchemaRefV1;
    contextSha256: Sha256Hex | null;
    entityId: KnowledgeEntityId;
    membershipSha256: Sha256Hex;
    validDuring: Readonly<{
        end: KnowledgeTemporalValueV1 | null;
        start: KnowledgeTemporalValueV1 | null;
        v: 1;
    }> | null;
    v: 1;
}>;
export type KnowledgeTypeMembershipInputV1 = Omit<KnowledgeTypeMembershipV1, "membershipSha256">;
export declare function createKnowledgeTypeMembershipV1(input: KnowledgeTypeMembershipInputV1): Promise<KnowledgeOntologyResult<KnowledgeTypeMembershipV1>>;
export declare function parseKnowledgeTypeMembershipV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeTypeMembershipV1>>;
export declare const SPONGE_KNOWLEDGE_DISCLOSURES_V1: readonly ["export", "model", "private", "public", "search", "shared"];
export type KnowledgeDisclosureV1 = (typeof SPONGE_KNOWLEDGE_DISCLOSURES_V1)[number];
export type KnowledgeRightsDecisionV1 = Readonly<{
    actorEntityId: KnowledgeEntityId;
    allowedDisclosures: readonly KnowledgeDisclosureV1[];
    decidedAt: string;
    decisionSha256: Sha256Hex;
    policySha256: Sha256Hex;
    purposes: readonly string[];
    subjectSha256: Sha256Hex;
    v: 1;
}>;
export type KnowledgeRightsDecisionInputV1 = Omit<KnowledgeRightsDecisionV1, "decisionSha256">;
export declare function createKnowledgeRightsDecisionV1(input: KnowledgeRightsDecisionInputV1): Promise<KnowledgeOntologyResult<KnowledgeRightsDecisionV1>>;
export declare function parseKnowledgeRightsDecisionV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeRightsDecisionV1>>;
export declare function effectiveKnowledgeRightsV1(input: Readonly<{
    decisions: readonly KnowledgeRightsDecisionV1[];
    purpose: string;
    subjectSha256: Sha256Hex;
}>): readonly KnowledgeDisclosureV1[];
export declare const SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1: readonly ["activity", "assertion", "context", "entity", "evidence", "identity-operation", "inquiry", "inquiry-event", "schema", "shape", "statement", "synthesis-candidate", "type-membership", "view", "vocabulary"];
export type KnowledgeReviewSubjectKindV1 = (typeof SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1)[number];
export type KnowledgeReviewDecisionV1 = Readonly<{
    decidedAt: string;
    decisionSha256: Sha256Hex;
    outcome: "accept" | "reject" | "request-changes" | "withdraw";
    policySha256: Sha256Hex;
    purpose: string;
    reviewerEntityId: KnowledgeEntityId;
    subjectKind: KnowledgeReviewSubjectKindV1;
    subjectSha256: Sha256Hex;
    supersedesDecisionSha256: Sha256Hex | null;
    v: 1;
}>;
export type KnowledgeReviewDecisionInputV1 = Omit<KnowledgeReviewDecisionV1, "decisionSha256">;
export declare function createKnowledgeReviewDecisionV1(input: KnowledgeReviewDecisionInputV1): Promise<KnowledgeOntologyResult<KnowledgeReviewDecisionV1>>;
export declare function parseKnowledgeReviewDecisionV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeReviewDecisionV1>>;
export declare function effectiveKnowledgeReviewV1(input: Readonly<{
    decisions: readonly KnowledgeReviewDecisionV1[];
    purpose: string;
    subjectKind: KnowledgeReviewDecisionV1["subjectKind"];
    subjectSha256: Sha256Hex;
}>): KnowledgeReviewDecisionV1 | null;
export type KnowledgeShapeCardinalityV1 = Readonly<{
    maximum: number | null;
    minimum: number;
    v: 1;
}>;
export type KnowledgeShapePropertyRuleV1 = Readonly<{
    allowedDisclosures: readonly KnowledgeDisclosureV1[];
    cardinality: KnowledgeShapeCardinalityV1;
    predicate: KnowledgeSchemaRefV1;
    purpose: string;
    range: KnowledgeValueRangeV1;
    requiredEvidenceBearings: readonly KnowledgeEvidenceBearingV1[];
    severity: "error" | "warning";
    v: 1;
}>;
export type KnowledgeExecutableShapeV1 = Readonly<{
    appliesToConcepts: readonly KnowledgeSchemaRefV1[];
    closed: boolean;
    extends: readonly KnowledgeSchemaRefV1[];
    maximumInheritanceDepth: number;
    rules: readonly KnowledgeShapePropertyRuleV1[];
    shape: KnowledgeSchemaRefV1;
    shapeSha256: Sha256Hex;
    v: 1;
}>;
export type KnowledgeExecutableShapeInputV1 = Omit<KnowledgeExecutableShapeV1, "shapeSha256">;
export declare function createKnowledgeExecutableShapeV1(input: KnowledgeExecutableShapeInputV1): Promise<KnowledgeOntologyResult<KnowledgeExecutableShapeV1>>;
export declare function parseKnowledgeExecutableShapeV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeExecutableShapeV1>>;
export type KnowledgeShapeViolationCodeV1 = "cardinality-maximum" | "cardinality-minimum" | "closed-predicate" | "evidence-missing" | "privacy-denied" | "range-mismatch" | "shape-cycle" | "shape-missing" | "shape-resource-limit" | "type-membership-missing";
export type KnowledgeShapeViolationV1 = Readonly<{
    code: KnowledgeShapeViolationCodeV1;
    predicate: KnowledgeSchemaRefV1 | null;
    severity: "error" | "warning";
    statementSha256: Sha256Hex | null;
    v: 1;
}>;
export type KnowledgeShapeEvaluationV1 = Readonly<{
    complete: boolean;
    evaluatedShapeSha256s: readonly Sha256Hex[];
    passed: boolean;
    truncation: "cycle" | "resource-limit" | null;
    v: 1;
    violations: readonly KnowledgeShapeViolationV1[];
}>;
export declare function evaluateKnowledgeShapeV1(input: Readonly<{
    assertions: readonly KnowledgeAssertionV1[];
    disclosure: KnowledgeDisclosureV1;
    entityId: KnowledgeEntityId;
    evidence: readonly KnowledgeEvidenceLinkV1[];
    memberships: readonly KnowledgeTypeMembershipV1[];
    purpose: string;
    rightsDecisions: readonly KnowledgeRightsDecisionV1[];
    rootShape: KnowledgeSchemaRefV1;
    shapes: readonly KnowledgeExecutableShapeV1[];
    statements: readonly KnowledgeStatementV1[];
}>): Promise<KnowledgeShapeEvaluationV1>;
export declare const SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1: readonly ["activity", "assertion", "context", "dependency-manifest", "edition", "entity", "evidence", "identity-operation", "inquiry", "inquiry-event", "review-decision", "rights-decision", "schema", "shape", "statement", "type-membership", "view", "vocabulary"];
export type KnowledgeGraphRecordKindV1 = (typeof SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1)[number];
export type KnowledgeGraphRecordRefV1 = Readonly<{
    kind: KnowledgeGraphRecordKindV1;
    sha256: Sha256Hex;
    v: 1;
}>;
export type KnowledgeGraphRevisionV1 = Readonly<{
    additions: readonly KnowledgeGraphRecordRefV1[];
    graphRevisionSha256: Sha256Hex;
    operationId: string;
    parentGraphRevisionSha256: Sha256Hex | null;
    recordRefs: readonly KnowledgeGraphRecordRefV1[];
    recordsSha256: Sha256Hex;
    revision: number;
    v: 1;
}>;
export declare function createKnowledgeGraphRevisionV1(input: Readonly<{
    additions: readonly KnowledgeGraphRecordRefV1[];
    operationId: string;
    parent: KnowledgeGraphRevisionV1 | null;
}>): Promise<KnowledgeOntologyResult<KnowledgeGraphRevisionV1>>;
export declare function parseKnowledgeGraphRevisionV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeGraphRevisionV1>>;
export declare function graphRevisionRetainsEvidenceV1(prior: KnowledgeGraphRevisionV1, next: KnowledgeGraphRevisionV1): boolean;
export declare function reduceKnowledgeGraphRevisionsV1(revisions: readonly KnowledgeGraphRevisionV1[]): Promise<KnowledgeOntologyResult<KnowledgeGraphRevisionV1>>;
export declare const SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1: readonly ["abandoned", "evidence-added", "gap-identified", "paused", "plan-proposed", "question-refined", "resolved", "resumed", "reviewed", "source-added", "statement-proposed"];
export type KnowledgeInquiryEventKindV1 = (typeof SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1)[number];
export type KnowledgeInquiryEventV1 = Readonly<{
    actorEntityId: KnowledgeEntityId;
    eventSha256: Sha256Hex;
    inputRefs: readonly KnowledgeGraphRecordRefV1[];
    inquiryId: KnowledgeInquiryId;
    kind: KnowledgeInquiryEventKindV1;
    note: string | null;
    occurredAt: string;
    outputRefs: readonly KnowledgeGraphRecordRefV1[];
    parentEventSha256: Sha256Hex | null;
    sequence: number;
    v: 1;
}>;
export type KnowledgeInquiryEventInputV1 = Omit<KnowledgeInquiryEventV1, "eventSha256">;
export type KnowledgeInquiryTransitionEventKindV1 = "abandoned" | "paused" | "resolved" | "resumed";
/**
 * Resolves the only legal lifecycle edge for a requested status. A repeated
 * target is not an event, and terminal inquiries cannot be reopened.
 */
export declare function knowledgeInquiryTransitionEventKindV1(current: KnowledgeInquiryV1["status"], target: KnowledgeInquiryV1["status"]): KnowledgeInquiryTransitionEventKindV1 | null;
export declare function knowledgeInquiryTransitionNoteV1(kind: KnowledgeInquiryTransitionEventKindV1): string;
export declare function createKnowledgeInquiryEventV1(input: KnowledgeInquiryEventInputV1): Promise<KnowledgeOntologyResult<KnowledgeInquiryEventV1>>;
export declare function parseKnowledgeInquiryEventV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeInquiryEventV1>>;
export type KnowledgeInquiryTrailV1 = Readonly<{
    eventSha256s: readonly Sha256Hex[];
    gapRefs: readonly KnowledgeGraphRecordRefV1[];
    inquiryId: KnowledgeInquiryId;
    status: KnowledgeInquiryV1["status"];
    trailSha256: Sha256Hex;
    v: 1;
}>;
export declare function reduceKnowledgeInquiryEventsV1(inquiry: KnowledgeInquiryV1, events: readonly KnowledgeInquiryEventV1[]): Promise<KnowledgeOntologyResult<KnowledgeInquiryTrailV1>>;
export type KnowledgeEditionDependencyManifestV1 = Readonly<{
    activitySha256s: readonly Sha256Hex[];
    assertionSha256s: readonly Sha256Hex[];
    candidateSha256: Sha256Hex;
    canonicalOutputSha256: Sha256Hex;
    contextSha256s: readonly Sha256Hex[];
    editionId: KnowledgeEditionV1["editionId"];
    evidenceSha256s: readonly Sha256Hex[];
    generationReceiptSha256: Sha256Hex | null;
    inputGraphRevisionSha256: Sha256Hex;
    humanReviewReceiptSha256: Sha256Hex;
    identityReceiptSha256: Sha256Hex;
    manifestSha256: Sha256Hex;
    purpose: "public-encyclopedia";
    reviewDecisionSha256s: readonly Sha256Hex[];
    rightsDecisionSha256s: readonly Sha256Hex[];
    rightsReceiptSha256: Sha256Hex;
    schemaRevisionSha256s: readonly Sha256Hex[];
    statementSha256s: readonly Sha256Hex[];
    v: 1;
    viewSpecSha256: Sha256Hex;
}>;
export type KnowledgeEditionDependencyManifestInputV1 = Omit<KnowledgeEditionDependencyManifestV1, "manifestSha256">;
export declare function createKnowledgeEditionDependencyManifestV1(input: KnowledgeEditionDependencyManifestInputV1): Promise<KnowledgeOntologyResult<KnowledgeEditionDependencyManifestV1>>;
export declare function parseKnowledgeEditionDependencyManifestV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeEditionDependencyManifestV1>>;
export declare function verifyKnowledgeEditionDependencyCompletenessV1(input: Readonly<{
    availableSha256s: ReadonlySet<Sha256Hex>;
    candidate: KnowledgeSynthesisCandidateV1;
    edition: KnowledgeEditionV1;
    humanReviewReceipt: KnowledgeHumanReviewReceiptV1;
    manifest: KnowledgeEditionDependencyManifestV1;
}>): KnowledgeOntologyResult<KnowledgeEditionDependencyManifestV1>;
export type KnowledgeGraphEdgeV1 = Readonly<{
    fromEntityId: KnowledgeEntityId;
    predicate: KnowledgeSchemaRefV1;
    statementSha256: Sha256Hex;
    toEntityId: KnowledgeEntityId;
    v: 1;
}>;
export type KnowledgeGraphTraversalBudgetV1 = Readonly<{
    bytes: number;
    depth: number;
    edges: number;
    nodes: number;
    work: number;
}>;
export type KnowledgeGraphTraversalTruncationV1 = "byte-budget" | "depth-budget" | "edge-budget" | "node-budget" | "work-budget";
export type KnowledgeGraphTraversalV1 = Readonly<{
    complete: boolean;
    edges: readonly KnowledgeGraphEdgeV1[];
    frontierEntityIds: readonly KnowledgeEntityId[];
    nodeEntityIds: readonly KnowledgeEntityId[];
    truncations: readonly KnowledgeGraphTraversalTruncationV1[];
    v: 1;
    work: number;
}>;
export declare function traverseKnowledgeGraphV1(input: Readonly<{
    authorizedStatementSha256s: ReadonlySet<Sha256Hex>;
    budget: KnowledgeGraphTraversalBudgetV1;
    edges: readonly KnowledgeGraphEdgeV1[];
    rootEntityId: KnowledgeEntityId;
}>): KnowledgeOntologyResult<KnowledgeGraphTraversalV1>;
export type KnowledgeGraphRecordValueByKindV1 = Readonly<{
    activity: KnowledgeActivityV1;
    assertion: KnowledgeAssertionV1;
    context: KnowledgeContextV1;
    "dependency-manifest": KnowledgeEditionDependencyManifestV1;
    edition: KnowledgeEditionV1;
    entity: KnowledgeEntityV1;
    evidence: KnowledgeEvidenceLinkV1;
    "identity-operation": KnowledgeIdentityOperationV1;
    inquiry: KnowledgeInquiryV1;
    "inquiry-event": KnowledgeInquiryEventV1;
    "review-decision": KnowledgeReviewDecisionV1;
    "rights-decision": KnowledgeRightsDecisionV1;
    schema: KnowledgeSchemaRevisionV1;
    shape: KnowledgeExecutableShapeV1;
    statement: KnowledgeStatementV1;
    "type-membership": KnowledgeTypeMembershipV1;
    view: KnowledgeViewSpecV1;
    vocabulary: KnowledgeVocabularyRevisionV1;
}>;
export type ParsedKnowledgeGraphRecordV1<K extends KnowledgeGraphRecordKindV1 = KnowledgeGraphRecordKindV1> = Readonly<{
    kind: K;
    recordSha256: Sha256Hex;
    value: KnowledgeGraphRecordValueByKindV1[K];
    v: 1;
}>;
/**
 * The one semantic ingress for durable graph records. Each branch delegates to
 * the record's authoritative strict parser; embedded record digests are
 * recomputed there. Entity is the only identity record without an embedded
 * content digest, so its exact canonical bytes are hashed here.
 */
export declare function parseKnowledgeGraphRecordV1<K extends KnowledgeGraphRecordKindV1>(kind: K, value: unknown): Promise<KnowledgeOntologyResult<ParsedKnowledgeGraphRecordV1<K>>>;
export declare const SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1: readonly ["activity", "context", "review-decision", "rights-decision", "statement", "type-membership", "view"];
/**
 * Produces the logical, replay-stable key used beside the authoritative content
 * digest. Records without a natural semantic ID deliberately require a caller
 * key; accepting a digest as their logical key would hide idempotency mistakes.
 */
export declare function knowledgeGraphRecordKeyV1<K extends KnowledgeGraphRecordKindV1>(kind: K, value: KnowledgeGraphRecordValueByKindV1[K], requiredCallerRecordKey?: string): KnowledgeOntologyResult<string>;
export {};
//# sourceMappingURL=knowledge-ontology-contract-v1.d.ts.map