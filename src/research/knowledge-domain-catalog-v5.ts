import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV4, type SpongeKnowledgeDomainCatalogV4 } from "./knowledge-domain-catalog-v4";
import { createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1, type KnowledgeSchemaRevisionV1 } from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult, KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import { createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1, type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";
import { bridgeRelationDefinitions } from "./knowledge-bridge-relations";

export type SpongeKnowledgeDomainCatalogV5 = SpongeKnowledgeDomainCatalogV4 & Readonly<{
  bridgeRelationsPack: KnowledgeVocabularyPackManifestV1;
}>;

const labels = (text: string) => [{ language: "en", text, v: 1 }] as const;
function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid bridge-relations pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}
function schema(pack: SpongeKnowledgeDomainCatalogV4, packId: string, code: string): KnowledgeSchemaRevisionV1 {
  const found = pack.packs.find(item => item.packId === packId)?.schemas.find(item => item.identity.code === code);
  if (found === undefined) throw new Error(`Missing bridge schema ${packId}/${code}.`);
  return found;
}
function ref(pack: SpongeKnowledgeDomainCatalogV4, packId: string, code: string): KnowledgeSchemaRefV1 {
  return schema(pack, packId, code).ref;
}

const relationEndpoints = [
  ["offer-for-product", "sponge.substances", "offer", [["sponge.substances", "product"]]],
  ["offer-has-price", "sponge.substances", "offer", [["sponge.bridge-relations", "price"]]],
  ["assay-uses-method", "sponge.substances", "assay", [["sponge.research", "method"]]],
  ["assay-produces-result", "sponge.substances", "assay", [["sponge.research", "finding"]]],
  ["placement-in-article", "sponge.editorial", "placement", [["sponge.editorial", "article"], ["sponge.editorial", "edition"]]],
  ["series-has-member-event", "sponge.editorial", "event-series", [["sponge.core", "event"]]],
  ["track-has-recording", "sponge.music", "track", [["sponge.music", "recording"]]],
  ["listing-at-venue", "sponge.finance", "listing", [["sponge.core", "place"]]],
  ["snapshot-of-simulation", "sponge.formal-systems", "state-snapshot", [["sponge.formal-systems", "simulation"]]],
  ["trajectory-has-attempt", "sponge.agent-work", "trajectory", [["sponge.agent-work", "attempt"]]],
  ["task-pursues-goal", "sponge.agent-work", "task", [["sponge.agent-work", "goal"]]],
  ["profile-for-account", "sponge.people", "profile-projection", [["sponge.core", "account"]]],
  ["role-assignment-at-organization", "sponge.organizations", "role-assignment", [["sponge.core", "organization"]]],
  ["lexeme-in-language-system", "sponge.language", "lexeme", [["sponge.reference", "language-system"]]],
] as const;

let catalogPromise: Promise<SpongeKnowledgeDomainCatalogV5> | undefined;
/** Adds cross-domain bridge predicates without revising any published pack. */
export function spongeKnowledgeDomainCatalogV5(): Promise<SpongeKnowledgeDomainCatalogV5> {
  catalogPromise ??= buildCatalog();
  return catalogPromise;
}

async function buildCatalog(): Promise<SpongeKnowledgeDomainCatalogV5> {
  const previous = await spongeKnowledgeDomainCatalogV4();
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256,
    labels: labels("Sponge cross-domain bridge relations"),
    namespace: "sponge.bridge-relations", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
    labels: labels(code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  const price = required(await createKnowledgeSchemaRevisionV1({
    ...base("price", "A stated monetary amount or price record associated with an offer. Currency, tax, interval and effective dates are separate context."),
    kind: "concept", broader: [ref(previous, "sponge.core", "information-resource")],
  }));
  const localConcepts = new Map([["price", price.ref]]);
  const qualifierPredicates = previous.referencePack.schemas.filter(item => item.kind === "predicate").map(item => item.ref);
  const schemas: KnowledgeSchemaRevisionV1[] = [price];
  for (const [code, , description] of bridgeRelationDefinitions) {
    const endpoint = relationEndpoints.find(item => item[0] === code);
    if (endpoint === undefined) throw new Error(`Missing bridge endpoint ${code}.`);
    const [, domainPack, domainCode, ranges] = endpoint;
    const rangeRefs = ranges.map(([packId, rangeCode]) => packId === vocabulary.namespace ? (localConcepts.get(rangeCode) as KnowledgeSchemaRefV1) : ref(previous, packId, rangeCode));
    schemas.push(required(await createKnowledgeSchemaRevisionV1({
      ...base(code, description), kind: "predicate", domainConcepts: [ref(previous, domainPack, domainCode)],
      inversePredicate: null, qualifierPredicates: sortedRefs(qualifierPredicates), range: { concepts: sortedRefs(rangeRefs), kind: "entity-concepts", v: 1 },
    })));
  }
  schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1);
  const bridgeRelationsPack = required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256,
    dependencies: previous.packs.map(knowledgeVocabularyPackPinV1).sort((a, b) => a.packId < b.packId ? -1 : 1),
    display: core.display, examples: [],
    migrationNotes: "Additive bridge predicates for cross-domain navigation. Existing pack revisions and historical catalogs remain unchanged. Ranges remain open to preserve source distinctions; installation and proposal review are required.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1, schemas, shapes: [],
    queries: [{ description: "Which explicit cross-domain bridge relations connect a record to its adjacent research object?", id: "bridge-relations", predicates: schemas.filter(item => item.kind === "predicate").map(item => item.ref), v: 1 }],
    sources: [{ contentSha256: "f6f87dc67e668fe458115d8dec3f44023c35c3c3cce0f676f2a1de7169325aa3", license: "MIT", revision: "2026-09-14", uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/bridge-relations-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  }));
  const packs = [...previous.packs, bridgeRelationsPack].sort((a, b) => a.packId < b.packId ? -1 : 1);
  const roots = [...previous.lock.roots, knowledgeVocabularyPackPinV1(bridgeRelationsPack)].sort((a, b) => a.packId < b.packId ? -1 : 1);
  const resolved = required(await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots }));
  return freezeKnowledgeDeclaration({ ...previous, bridgeRelationsPack, lock: resolved.lock, packs, schemas: packs.flatMap(pack => pack.schemas), vocabularies: packs.map(pack => pack.vocabulary) });
}
