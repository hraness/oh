import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV2, type SpongeKnowledgeDomainCatalogV2 } from "./knowledge-domain-catalog-v2";
import { createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1 } from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult } from "./knowledge-ontology-v1";
import { reviewedSourceRelations } from "./knowledge-source-relations";
import { createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  resolveKnowledgeVocabularyPacksV1, type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";

export type SpongeKnowledgeDomainCatalogV3 = SpongeKnowledgeDomainCatalogV2 & Readonly<{
  sourceRelationsPack: KnowledgeVocabularyPackManifestV1;
}>;
const labels = (text: string) => [{ language: "en", text, v: 1 }] as const;
function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid source-relations pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
let catalogPromise: Promise<SpongeKnowledgeDomainCatalogV3> | undefined;
/** Adds source-attribution predicates without revising any published pack or granting installation authority. */
export function spongeKnowledgeDomainCatalogV3(): Promise<SpongeKnowledgeDomainCatalogV3> {
  catalogPromise ??= buildCatalog();
  return catalogPromise;
}
async function buildCatalog(): Promise<SpongeKnowledgeDomainCatalogV3> {
  const previous = await spongeKnowledgeDomainCatalogV2();
  const { corePack, referencePack, foundationPack } = previous;
  const entity = corePack.schemas.find(schema => schema.kind === "concept" && schema.identity.code === "entity");
  if (entity === undefined) throw new Error("Missing core entity concept.");
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: corePack.canonicalizerSha256, labels: labels("Sponge source relationships"),
    namespace: "sponge.source-relations", ownerEntityId: corePack.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const qualifierPredicates = [...referencePack.schemas, ...foundationPack.schemas]
    .filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map(schema => schema.ref)
    .sort((a, b) => canonicalJson(a as unknown as JsonValue) < canonicalJson(b as unknown as JsonValue) ? -1 : 1);
  const schemas = await Promise.all(reviewedSourceRelations.map(async ([, , , suffix, definition]) =>
    required(await createKnowledgeSchemaRevisionV1({
      definitions: labels(`${definition} Source attribution does not infer local membership or identity; capture, rank, qualifiers and references remain separate evidence.`),
      identity: { code: `source-asserted-${suffix}`, namespace: vocabulary.namespace, revision: 1, v: 1 },
      labels: labels(`Source asserted ${suffix.replaceAll("-", " ")}`), previousRevisionSha256: null,
      reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1, kind: "predicate",
      domainConcepts: [entity.ref], inversePredicate: null, qualifierPredicates,
      range: { concepts: [entity.ref], kind: "entity-concepts", v: 1 },
    }))));
  schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1);
  const sourceRelationsPack = required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: corePack.canonicalizerSha256,
    dependencies: [corePack, foundationPack, referencePack].map(knowledgeVocabularyPackPinV1), display: corePack.display,
    examples: [], migrationNotes: "Additive source relationships. Existing pack revisions, local records and historical previews remain unchanged. Explicit installation and proposal review are required; no source claim implies truth, classification, identity equality, publication rights or a complete description.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1, schemas, shapes: [],
    queries: [{ description: "Which relationships does the retained source state, with which qualifiers and references?",
      id: "source-relationships", predicates: schemas.map(schema => schema.ref), v: 1 }],
    sources: reviewedSourceRelations.map(([property, revision, contentSha256]) => ({ contentSha256,
      license: "CC0-1.0", revision: String(revision),
      uri: `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${property}&format=json&maxlag=5`, v: 1 }))
      .sort((a, b) => canonicalJson(a as unknown as JsonValue) < canonicalJson(b as unknown as JsonValue) ? -1 : 1),
    supportedCodecs: [], v: 1, vocabulary,
  }));
  const packs = [...previous.packs, sourceRelationsPack].sort((a, b) => a.packId < b.packId ? -1 : 1);
  const roots = [...previous.lock.roots, knowledgeVocabularyPackPinV1(sourceRelationsPack)].sort((a, b) => a.packId < b.packId ? -1 : 1);
  const resolved = required(await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots }));
  return freezeKnowledgeDeclaration({ ...previous, sourceRelationsPack, lock: resolved.lock, packs,
    schemas: packs.flatMap(pack => pack.schemas), vocabularies: packs.map(pack => pack.vocabulary) });
}
