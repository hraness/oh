import { type KnowledgeEntityId, type KnowledgeSchemaRefV1, type KnowledgeValueV1, type KnowledgeAssertionStanceV1, type KnowledgeEvidenceBearingV1, type KnowledgeScenarioV1 } from "./knowledge-ontology-v1";
export type SpongeKnowledgeEntityReferenceV3 = Readonly<{
    kind: "key";
    key: string;
}> | Readonly<{
    kind: "existing";
    entityId: KnowledgeEntityId;
}>;
export type SpongeKnowledgeProposalValueV3 = Exclude<KnowledgeValueV1, {
    kind: "list" | "set";
}> | Readonly<{
    kind: "entity-key";
    entityKey: string;
}> | Readonly<{
    kind: "list";
    values: readonly SpongeKnowledgeProposalValueV3[];
    v: 1;
}> | Readonly<{
    kind: "set";
    values: readonly SpongeKnowledgeProposalValueV3[];
    v: 1;
}>;
export type SpongeKnowledgeProposalDimensionV3 = Readonly<{
    predicate: KnowledgeSchemaRefV1;
    value: SpongeKnowledgeProposalValueV3;
}>;
export type SpongeKnowledgeProposalEntityV3 = Readonly<{
    key: string;
    kind: "new";
    concepts: readonly KnowledgeSchemaRefV1[];
    name: Readonly<{
        language: string;
        text: string;
    }>;
}> | Readonly<{
    key: string;
    kind: "existing";
    entityId: KnowledgeEntityId;
}>;
export type SpongeKnowledgeProposalDraftV3 = Readonly<{
    v: 3;
    entities: readonly SpongeKnowledgeProposalEntityV3[];
    facts: readonly Readonly<{
        key: string;
        subject: SpongeKnowledgeEntityReferenceV3;
        predicate: KnowledgeSchemaRefV1;
        object: SpongeKnowledgeProposalValueV3;
        qualifiers: readonly SpongeKnowledgeProposalDimensionV3[];
        contextKey: string | null;
        stance: KnowledgeAssertionStanceV1;
    }>[];
    contexts: readonly Readonly<{
        key: string;
        scenario: KnowledgeScenarioV1;
        dimensions: readonly SpongeKnowledgeProposalDimensionV3[];
    }>[];
    evidence: readonly Readonly<{
        key: string;
        factKey: string;
        source: SpongeKnowledgeEntityReferenceV3;
        bearing: KnowledgeEvidenceBearingV1;
        selector: string | null;
        attribution: Readonly<{
            kind: "agent-supplied";
            sourceUri: string | null;
        }>;
    }>[];
    vocabularyDependencies: readonly KnowledgeSchemaRefV1[];
}>;
/** No actor, review, publication, merge, installed-state, or source-verification claims are accepted. */
export declare function parseSpongeKnowledgeProposalDraftV3(foreign: unknown): SpongeKnowledgeProposalDraftV3 | null;
//# sourceMappingURL=knowledge-proposal-v3.d.ts.map