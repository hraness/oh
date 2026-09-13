import { type Sha256Hex } from "./integrity-domain";
import { type KnowledgeSchemaRevisionV1 } from "./knowledge-ontology-contract-v1";
import { type KnowledgeEntityId, type KnowledgeEntityV1, type KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import { type SpongeKnowledgeProposalBundleV2 } from "./knowledge-proposal-v2";
export type SpongeKnowledgeExistingEntityV3 = Readonly<{
    entity: KnowledgeEntityV1;
    concepts: readonly KnowledgeSchemaRefV1[];
}>;
/** Trusted, authorized inputs supplied by the operation boundary, never the draft body. */
export type SpongeKnowledgeProposalCompilerAuthorityV3 = Readonly<{
    externalOperationReceiptSha256: string;
    authorEntityId: string;
    authoringPolicySha256: string;
    occurredAt: string;
    spaceId: string;
    schemas: readonly KnowledgeSchemaRevisionV1[];
    existingEntities: ReadonlyMap<string, SpongeKnowledgeExistingEntityV3>;
}>;
export type SpongeCompiledKnowledgeProposalV3 = Readonly<{
    v: 3;
    bundle: SpongeKnowledgeProposalBundleV2;
    draftSha256: Sha256Hex;
    externalOperationReceiptSha256: Sha256Hex;
    entityIds: Readonly<Record<string, KnowledgeEntityId>>;
    sourceAttributions: readonly Readonly<{
        evidenceSha256: Sha256Hex;
        kind: "agent-supplied";
        sourceEntityId: KnowledgeEntityId;
        sourceUri: string | null;
        selector: string | null;
        disclosure: "private";
    }>[];
    /** Reference candidates are not store writes or evidence that a vocabulary is installed. */
    schemaCandidates: readonly Readonly<{
        status: "unreviewed";
        schema: KnowledgeSchemaRevisionV1;
    }>[];
}>;
/** Full-fidelity draft compilation creates proposed/private records and never authorizes admission. */
export declare function compileSpongeKnowledgeProposalV3(foreign: unknown, authority: SpongeKnowledgeProposalCompilerAuthorityV3): Promise<SpongeCompiledKnowledgeProposalV3 | null>;
//# sourceMappingURL=knowledge-proposal-compiler-v3.d.ts.map