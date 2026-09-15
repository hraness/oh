import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV3, type SpongeKnowledgeDomainCatalogV3 } from "./knowledge-domain-catalog-v3";
import { buildSpongeIdentityContextPackV1 } from "./knowledge-identity-context-pack";
import { resolveKnowledgeVocabularyPacksV1, knowledgeVocabularyPackPinV1, type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
import type { KnowledgeOntologyResult } from "./knowledge-ontology-v1";

export type SpongeKnowledgeDomainCatalogV4 = SpongeKnowledgeDomainCatalogV3 & Readonly<{
  identityContextPack: KnowledgeVocabularyPackManifestV1;
}>;
function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid identity-context catalog: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
let catalogPromise: Promise<SpongeKnowledgeDomainCatalogV4> | undefined;
/** Adds identity and context records while preserving V1–V3 catalog and pack bytes. */
export function spongeKnowledgeDomainCatalogV4(): Promise<SpongeKnowledgeDomainCatalogV4> {
  catalogPromise ??= buildCatalog();
  return catalogPromise;
}
async function buildCatalog(): Promise<SpongeKnowledgeDomainCatalogV4> {
  const previous = await spongeKnowledgeDomainCatalogV3();
  const identityContextPack = await buildSpongeIdentityContextPackV1(previous);
  const packs = [...previous.packs, identityContextPack].sort((left, right) => left.packId < right.packId ? -1 : 1);
  const roots = [...previous.lock.roots, knowledgeVocabularyPackPinV1(identityContextPack)].sort((left, right) => left.packId < right.packId ? -1 : 1);
  const resolved = required(await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots }));
  return freezeKnowledgeDeclaration({ ...previous, identityContextPack, lock: resolved.lock, packs,
    schemas: packs.flatMap(pack => pack.schemas), vocabularies: packs.map(pack => pack.vocabulary) });
}
