import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import type { SpongeKnowledgeDomainCatalogV7 } from "./knowledge-domain-catalog-v7";
import {
  createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgeSchemaRevisionV1,
} from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult, KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";

function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid temporal-roles pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}

const TEMPORAL_ROLE_PREDICATES_V1 = [
  ["event-time", "The time the reported event or occurrence happened, as the source states it. It never doubles as the time the report was written, retrieved or reviewed."],
  ["observation-time", "The time the source observed or collected the reported content. It is distinct from a location claim and from a measurement record's own time."],
  ["available-at", "The time the content became retrievable to the observer. A claim admitted under point-in-time discipline uses this role rather than the source's reported publication date."],
  ["first-seen-at", "The time the recording system first observed the content, however stale its original publication."],
  ["entered-at", "The time the record entered the local store. It asserts nothing about the source or the event."],
  ["searched-at", "The time a bounded search ran. Pair with an absence-finding record when the search's outcome is itself recorded."],
  ["as-of-time", "The point in time the record's content describes, where a source publishes data as of a stated snapshot."],
  ["reviewed-at", "The time a review or reassessment decision was recorded. The decision and its outcome stay a separate review event."],
  ["reassess-by", "The recorded time by which the record must be reassessed under its declared policy. The deadline is stated, not enforced; passing it changes nothing by itself."],
  ["superseded-at", "The time the record was superseded by a correction or withdrawal. The superseding record remains a separate entity."],
] as const;

/** Named time roles for records and for V8 predicates that declare them as qualifiers. */
export async function createSpongeTemporalRolesPackV1(previous: SpongeKnowledgeDomainCatalogV7): Promise<KnowledgeVocabularyPackManifestV1> {
  const dependencyIds = ["sponge.core", "sponge.foundation", "sponge.reference"];
  const dependencies = dependencyIds.map(packId => {
    const pack = previous.packs.find(item => item.packId === packId);
    if (pack === undefined) throw new Error(`Missing temporal-roles dependency ${packId}.`);
    return pack;
  });
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const schema = dependencies.find(pack => pack.packId === packId)?.schemas.find(item => item.identity.code === code);
    if (schema === undefined) throw new Error(`Missing temporal-roles schema ${packId}/${code}.`);
    return schema.ref;
  };
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge temporal roles"),
    namespace: "sponge.temporal-roles", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const schemas: KnowledgeSchemaRevisionV1[] = [];
  for (const [code, definition] of TEMPORAL_ROLE_PREDICATES_V1) {
    const predicate = required(await createKnowledgeSchemaRevisionV1({
      definitions: labels(`${definition} The recorded time does not verify it; contradictory roles from different sources remain separate.`),
      identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
      labels: labels(code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")),
      previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256,
      kind: "predicate", domainConcepts: [ref("sponge.core", "entity")], inversePredicate: null,
      qualifierPredicates: [], range: { kind: "value-kinds", valueKinds: ["time"], v: 1 }, v: 1 as const,
    }));
    schemas.push(predicate);
  }
  return freezeKnowledgeDeclaration(required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256, dependencies: dependencies.map(knowledgeVocabularyPackPinV1),
    display: core.display, examples: [],
    migrationNotes: "Additive named time roles. Existing V1–V7 declarations, their frozen qualifier sets and all prior locks remain unchanged. These roles may qualify V8 predicates that declare them; they do not verify times, establish ordering or freshness, enforce a reassessment deadline, or replace at-time, valid-during, retrieved-at, measured-at or captured-at.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1,
    schemas: schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1), shapes: [],
    queries: [
      { description: "Declarative join guidance, not an executable query: enumerate every temporal-role statement whose subject is the record, and return each role's time value with its declared calendar, precision and certainty. No role implies another; absence of a role means it was not recorded, not that it does not exist.",
        id: "record-temporal-roles",
        predicates: sortedRefs(schemas.map(schema => schema.ref)), v: 1 },
    ],
    sources: [{ contentSha256: "d734855f0bf89d33d47471ffb1a3434fd23956738f20089b69df929ff8481f35", license: "MIT", revision: "2026-09-16",
      uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/temporal-roles-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  })));
}
