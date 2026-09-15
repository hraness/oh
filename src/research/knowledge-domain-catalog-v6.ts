import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV5, type SpongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import { createSpongeContentOccurrencesPackV1 } from "./knowledge-content-occurrences";
import { createSpongeMeasurementResultsPackV1 } from "./knowledge-measurement-results";
import { createSpongeMonetaryValuesPackV1 } from "./knowledge-monetary-values";
import { knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1, type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";

export const SPONGE_KNOWLEDGE_EXTENSION_PACK_IDS_V6 = [
  "sponge.measurement-results", "sponge.monetary-values", "sponge.content-occurrences",
] as const;

export type SpongeKnowledgeDomainCatalogV6 = SpongeKnowledgeDomainCatalogV5 & Readonly<{
  measurementResultsPack: KnowledgeVocabularyPackManifestV1;
  monetaryValuesPack: KnowledgeVocabularyPackManifestV1;
  contentOccurrencesPack: KnowledgeVocabularyPackManifestV1;
}>;

let catalogPromise: Promise<SpongeKnowledgeDomainCatalogV6> | undefined;

/** Independently selectable depth extensions; published catalog declarations remain unchanged. */
export function spongeKnowledgeDomainCatalogV6(): Promise<SpongeKnowledgeDomainCatalogV6> {
  catalogPromise ??= buildCatalog();
  return catalogPromise;
}

async function buildCatalog(): Promise<SpongeKnowledgeDomainCatalogV6> {
  const previous = await spongeKnowledgeDomainCatalogV5();
  const [measurementResultsPack, monetaryValuesPack, contentOccurrencesPack] = await Promise.all([
    createSpongeMeasurementResultsPackV1(previous),
    createSpongeMonetaryValuesPackV1(previous),
    createSpongeContentOccurrencesPackV1(previous),
  ]);
  const extensions = [measurementResultsPack, monetaryValuesPack, contentOccurrencesPack];
  const packs = [...previous.packs, ...extensions].sort((a, b) => a.packId < b.packId ? -1 : 1);
  const roots = [...previous.lock.roots, ...extensions.map(knowledgeVocabularyPackPinV1)]
    .sort((a, b) => a.packId < b.packId ? -1 : 1);
  const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots });
  if (!resolved.ok) throw new Error(`Invalid depth catalog: ${resolved.error.field}:${resolved.error.code}.`);
  return freezeKnowledgeDeclaration({ ...previous, measurementResultsPack, monetaryValuesPack,
    contentOccurrencesPack, lock: resolved.value.lock, packs,
    schemas: packs.flatMap(pack => pack.schemas), vocabularies: packs.map(pack => pack.vocabulary) });
}
