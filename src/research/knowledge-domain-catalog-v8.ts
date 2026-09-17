import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV7, type SpongeKnowledgeDomainCatalogV7 } from "./knowledge-domain-catalog-v7";
import { createSpongeCitationPackV1 } from "./knowledge-citation";
import { createSpongeEvidenceGradingPackV1 } from "./knowledge-evidence-grading";
import { createSpongeResearchOpsPackV1 } from "./knowledge-research-ops";
import { createSpongeSourcePolicyPackV1 } from "./knowledge-source-policy";
import { createSpongeSourceQualityPackV1 } from "./knowledge-source-quality";
import { createSpongeTemporalRolesPackV1 } from "./knowledge-temporal-roles";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1, type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";

export const SPONGE_KNOWLEDGE_EXTENSION_PACK_IDS_V8 = [
  "sponge.temporal-roles", "sponge.evidence-grading", "sponge.citation",
  "sponge.research-ops", "sponge.source-quality", "sponge.source-policy",
] as const;

export type SpongeKnowledgeDomainCatalogV8 = SpongeKnowledgeDomainCatalogV7 & Readonly<{
  temporalRolesPack: KnowledgeVocabularyPackManifestV1;
  evidenceGradingPack: KnowledgeVocabularyPackManifestV1;
  citationPack: KnowledgeVocabularyPackManifestV1;
  researchOpsPack: KnowledgeVocabularyPackManifestV1;
  sourceQualityPack: KnowledgeVocabularyPackManifestV1;
  sourcePolicyPack: KnowledgeVocabularyPackManifestV1;
}>;

let catalogPromise: Promise<SpongeKnowledgeDomainCatalogV8> | undefined;

/** Research evidence operations: temporal roles, grading, citations, corpus operations and source governance. */
export function spongeKnowledgeDomainCatalogV8(): Promise<SpongeKnowledgeDomainCatalogV8> {
  catalogPromise ??= buildCatalog();
  return catalogPromise;
}

async function buildCatalog(): Promise<SpongeKnowledgeDomainCatalogV8> {
  const previous = await spongeKnowledgeDomainCatalogV7();
  const temporalRolesPack = await createSpongeTemporalRolesPackV1(previous);
  const evidenceGradingPack = await createSpongeEvidenceGradingPackV1(previous, temporalRolesPack);
  const researchOpsPack = await createSpongeResearchOpsPackV1(previous, temporalRolesPack);
  const [citationPack, sourceQualityPack, sourcePolicyPack] = await Promise.all([
    createSpongeCitationPackV1(previous),
    createSpongeSourceQualityPackV1(previous),
    createSpongeSourcePolicyPackV1(previous),
  ]);
  const extensions = [temporalRolesPack, evidenceGradingPack, citationPack, researchOpsPack, sourceQualityPack, sourcePolicyPack];
  const packs = [...previous.packs, ...extensions].sort((a, b) => a.packId < b.packId ? -1 : 1);
  const roots = [...previous.lock.roots, ...extensions.map(knowledgeVocabularyPackPinV1)]
    .sort((a, b) => a.packId < b.packId ? -1 : 1);
  const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots });
  if (!resolved.ok) throw new Error(`Invalid research evidence catalog: ${resolved.error.field}:${resolved.error.code}.`);
  return freezeKnowledgeDeclaration({ ...previous, temporalRolesPack, evidenceGradingPack, citationPack,
    researchOpsPack, sourceQualityPack, sourcePolicyPack, lock: resolved.value.lock, packs,
    schemas: packs.flatMap(pack => pack.schemas), vocabularies: packs.map(pack => pack.vocabulary) });
}
