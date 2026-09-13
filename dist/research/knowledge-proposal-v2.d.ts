import type { SpongeKnowledgeSemanticRecordInputV2 } from "./record-input";
export declare const SPONGE_AGENT_CORE_CONCEPT_CODES_V2: readonly ["account", "agent", "artifact", "concept", "entity", "event", "information-resource", "inquiry", "organization", "person", "place", "process", "source", "work"];
export declare const SPONGE_AGENT_CORE_PREDICATE_CODES_V2: readonly ["about", "authored-by", "cites", "created-by", "derived-from", "description", "identifier", "located-in", "name", "object", "part-of", "related-to", "same-as"];
export declare const SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2: readonly ["activity", "assertion", "context", "entity", "evidence", "identity-operation", "inquiry", "inquiry-event", "schema", "shape", "statement", "type-membership", "view", "vocabulary"];
export type SpongeAgentProposableKnowledgeKindV2 = (typeof SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2)[number];
export type SpongeKnowledgeProposalBundleV2 = Readonly<{
    records: readonly SpongeKnowledgeSemanticRecordInputV2[];
    v: 2;
}>;
/** Revalidates the compiled, authority-free proposal envelope. */
export declare function parseSpongeKnowledgeProposalBundleV2(foreign: unknown): Promise<SpongeKnowledgeProposalBundleV2 | null>;
//# sourceMappingURL=knowledge-proposal-v2.d.ts.map