import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text } from "./integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgeSchemaRevisionV1, type KnowledgeValueRangeV1,
} from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult } from "./knowledge-ontology-v1";
import { createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  SPONGE_KNOWLEDGE_PACK_CODECS_V1, type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";

export type SpongeKnowledgeReferenceCatalog = Readonly<{
  corePack: KnowledgeVocabularyPackManifestV1;
  referencePack: KnowledgeVocabularyPackManifestV1;
}>;
function unwrap<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid builtin knowledge pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(value: string) { return [{ language: "en", text: value, v: 1 }] as const; }
function title(value: string): string { return value.split("-").map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" "); }
function sortSchemas(schemas: readonly KnowledgeSchemaRevisionV1[]) { return [...schemas].sort((left, right) => left.identity.code < right.identity.code ? -1 : 1); }
function mustSchema(schemas: readonly KnowledgeSchemaRevisionV1[], code: string): KnowledgeSchemaRevisionV1 {
  const schema = schemas.find((item) => item.identity.code === code);
  if (schema === undefined) throw new Error(`Missing builtin schema: ${code}.`);
  return schema;
}
let referencePromise: Promise<SpongeKnowledgeReferenceCatalog> | undefined;
/** The immutable reference codecs and shared context definitions, without domain-profile initialization. */
export function spongeKnowledgeReferenceCatalog(): Promise<SpongeKnowledgeReferenceCatalog> {
  referencePromise ??= buildReferenceCatalog();
  return referencePromise;
}
async function buildReferenceCatalog(): Promise<SpongeKnowledgeReferenceCatalog> {
  const core = await spongeCoreKnowledgeCatalogV1();
  const ownerEntityId = core.vocabulary.ownerEntityId;
  const base = {
    canonicalizerSha256: core.canonicalizerSha256,
    display: { labelPredicates: [mustSchema(core.schemas, "name").ref], v: 1 },
    examples: [], migrationNotes: "Initial additive application profile. Existing records retain their meanings; installation and publication require separate authorization.",
    previousManifestSha256: null, queries: [], revision: 1, shapes: [], sources: [], supportedCodecs: [], v: 1,
  } as const;
  const corePack = unwrap(await createKnowledgeVocabularyPackManifestV1({ ...base, dependencies: [], packId: "sponge.core", schemas: sortSchemas(core.schemas), vocabulary: core.vocabulary }));
  const referenceVocabulary = unwrap(await createKnowledgeVocabularyRevisionV1({ canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge source value preservation"), namespace: "sponge.reference", ownerEntityId, previousRevisionSha256: null, revision: 1, state: "private", v: 1 }));
  const referenceSchemas: KnowledgeSchemaRevisionV1[] = [];
  for (const codec of SPONGE_KNOWLEDGE_PACK_CODECS_V1) {
    referenceSchemas.push(unwrap(await createKnowledgeSchemaRevisionV1({ broader: [mustSchema(core.schemas, "information-resource").ref], definitions: labels(`A bounded ${codec} source-value preservation codec. Its data does not imply normalized truth, schema review or publication authority.`), identity: { code: codec, namespace: "sponge.reference", revision: 1, v: 1 }, kind: "concept", labels: labels(title(codec)), previousRevisionSha256: null, reviewDecisionSha256: null, v: 1, vocabularySha256: referenceVocabulary.revisionSha256 })));
  }
  for (const [code, description] of [
    ["gregorian-calendar", "The proleptic Gregorian civil calendar for explicitly normalized time values. Referencing it does not normalize a retained source calendar."],
    ["language-system", "An identified language or language variety under an explicit naming scheme, distinct from text written in it."],
    ["population", "An identified population to which a scoped claim applies, distinct from an estimate about that population."],
  ] as const) {
    referenceSchemas.push(unwrap(await createKnowledgeSchemaRevisionV1({ broader: [mustSchema(core.schemas, "concept").ref], definitions: labels(description), identity: { code, namespace: "sponge.reference", revision: 1, v: 1 }, kind: "concept", labels: labels(title(code)), previousRevisionSha256: null, reviewDecisionSha256: null, v: 1, vocabularySha256: referenceVocabulary.revisionSha256 })));
  }
  const entityContext = (concept: KnowledgeSchemaRevisionV1): KnowledgeValueRangeV1 => ({ concepts: [concept.ref], kind: "entity-concepts", v: 1 });
  const contextDefinitions: readonly (readonly [string, string, KnowledgeValueRangeV1])[] = [
    ["at-time", "The explicitly stated time of this claim or observation, without dating every similar claim.", { kind: "value-kinds", valueKinds: ["time"], v: 1 }],
    ["valid-during", "The explicitly stated interval during which this claim applies.", { kind: "value-kinds", valueKinds: ["interval"], v: 1 }],
    ["place-context", "The identified place under which this claim applies, distinct from the subject's intrinsic location.", entityContext(mustSchema(core.schemas, "place"))],
    ["language-context", "The identified language or variety under which this claim or interpretation applies.", entityContext(mustSchema(referenceSchemas, "language-system"))],
    ["method-context", "The identified procedure or interpretive method under which this claim was made.", entityContext(mustSchema(core.schemas, "information-resource"))],
    ["population-context", "The identified population bounding this claim; it does not generalize the claim beyond that population.", entityContext(mustSchema(referenceSchemas, "population"))],
    ["source-context", "The attributed source under which this claim is reported, without treating attribution as verified evidence.", entityContext(mustSchema(core.schemas, "source"))],
  ];
  for (const [code, description, range] of contextDefinitions) {
    const predicate = unwrap(await createKnowledgeSchemaRevisionV1({ definitions: labels(description), domainConcepts: [mustSchema(core.schemas, "entity").ref], identity: { code, namespace: "sponge.reference", revision: 1, v: 1 }, inversePredicate: null, kind: "predicate", labels: labels(title(code)), previousRevisionSha256: null, qualifierPredicates: [], range, reviewDecisionSha256: null, v: 1, vocabularySha256: referenceVocabulary.revisionSha256 }));
    if (predicate.kind !== "predicate") throw new Error("Expected context predicate.");
    referenceSchemas.push(predicate);
  }
  const referencePack = unwrap(await createKnowledgeVocabularyPackManifestV1({ ...base, dependencies: [knowledgeVocabularyPackPinV1(corePack)], packId: "sponge.reference", schemas: sortSchemas(referenceSchemas), supportedCodecs: SPONGE_KNOWLEDGE_PACK_CODECS_V1, sources: [{ contentSha256: await sha256Text(canonicalJson(referenceSchemas as unknown as JsonValue)), license: "MIT", revision: "1", uri: "urn:sponge:application-profile:reference", v: 1 }], vocabulary: referenceVocabulary }));
  return freezeKnowledgeDeclaration({ corePack, referencePack });
}
