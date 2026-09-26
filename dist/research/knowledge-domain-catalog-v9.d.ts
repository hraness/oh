import { type SpongeKnowledgeDomainCatalogV8 } from "./knowledge-domain-catalog-v8";
/** Packs whose pinned guide was rewritten in plain style; each moves to manifest revision 2. */
export declare const SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9: readonly ["sponge.bridge-relations", "sponge.citation", "sponge.content-occurrences", "sponge.evidence-grading", "sponge.measurement-results", "sponge.monetary-values", "sponge.participation-roles", "sponge.research-ops", "sponge.source-policy", "sponge.source-quality", "sponge.temporal-roles"];
export type SpongeKnowledgeRevisedPackIdV9 = (typeof SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9)[number];
export type SpongeKnowledgeDomainCatalogV9 = SpongeKnowledgeDomainCatalogV8;
/** Catalog V8 with every digest-pinned guide pack moved to revision 2 under its V2 guide. */
export declare function spongeKnowledgeDomainCatalogV9(): Promise<SpongeKnowledgeDomainCatalogV9>;
//# sourceMappingURL=knowledge-domain-catalog-v9.d.ts.map