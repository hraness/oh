import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV6, type SpongeKnowledgeDomainCatalogV6 } from "./knowledge-domain-catalog-v6";
import { createSpongeParticipationRolesPackV1 } from "./knowledge-participation-roles";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1, type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";

export type SpongeKnowledgeDomainCatalogV7 = SpongeKnowledgeDomainCatalogV6 & Readonly<{
  participationRolesPack: KnowledgeVocabularyPackManifestV1;
}>;

let catalogPromise: Promise<SpongeKnowledgeDomainCatalogV7> | undefined;

/** Attributed participation roles, with every earlier declaration retained unchanged. */
export function spongeKnowledgeDomainCatalogV7(): Promise<SpongeKnowledgeDomainCatalogV7> {
  catalogPromise ??= buildCatalog();
  return catalogPromise;
}

async function buildCatalog(): Promise<SpongeKnowledgeDomainCatalogV7> {
  const previous = await spongeKnowledgeDomainCatalogV6();
  const participationRolesPack = await createSpongeParticipationRolesPackV1(previous);
  const packs = [...previous.packs, participationRolesPack].sort((a, b) => a.packId < b.packId ? -1 : 1);
  const roots = [...previous.lock.roots, knowledgeVocabularyPackPinV1(participationRolesPack)]
    .sort((a, b) => a.packId < b.packId ? -1 : 1);
  const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots });
  if (!resolved.ok) throw new Error(`Invalid participation catalog: ${resolved.error.field}:${resolved.error.code}.`);
  return freezeKnowledgeDeclaration({ ...previous, participationRolesPack,
    lock: resolved.value.lock, packs,
    schemas: packs.flatMap(pack => pack.schemas), vocabularies: packs.map(pack => pack.vocabulary) });
}
