import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text } from "./integrity-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV3, type SpongeKnowledgeDomainCatalogV3 } from "./knowledge-domain-catalog-v3";
import { createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgePredicateRevisionV1, type KnowledgeSchemaRevisionV1, type KnowledgeValueKindV1,
  type KnowledgeValueRangeV1, type KnowledgeExecutableShapeV1 } from "./knowledge-ontology-contract-v1";
import type { KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import type { KnowledgeOntologyResult } from "./knowledge-ontology-v1";
import { createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";

export const SPONGE_IDENTITY_CONTEXT_CONCEPTS_V1 = [
  ["identity-claim", "An attributed claim that an identifier or description refers to an entity; it never merges identities automatically."],
  ["identity-scheme", "A named identifier scheme or authority whose syntax, scope and resolution policy are stated separately."],
  ["temporal-record", "A temporal record with independently stated boundaries, calendar, precision and uncertainty."],
  ["location-record", "A location record with independently stated geometry, globe, coordinate reference system and accuracy."],
  ["evidence-bundle", "A bounded bundle of evidence items assembled for one claim, with completeness and authority left explicit."],
  ["evidence-item", "One source, observation, document or capture that can support or qualify a claim."],
  ["value-record", "A typed value with optional unit, bounds, language and interpretation context."],
  ["provenance-activity", "An activity that generated, transformed, reviewed or published a record; actor and time remain separate."],
] as const;

type PredicateSpec = readonly [string, string, string, "entity" | KnowledgeValueKindV1, (readonly string[] | undefined)?];
export const SPONGE_IDENTITY_CONTEXT_PREDICATES_V1: readonly PredicateSpec[] = [
  ["claims-identity-of", "The entity a claim proposes as the referent of an identifier or description.", "identity-claim", "entity", ["entity"]],
  ["uses-scheme", "The identifier scheme used by this claim or identifier.", "identity-claim", "entity", ["identity-scheme"]],
  ["has-identifier", "The literal identifier supplied by this claim; equality does not prove identity.", "identity-claim", "identifier"],
  ["identity-confidence", "An explicitly attributed confidence value for this claim, with scale and calibration stated separately.", "identity-claim", "decimal"],
  ["scheme-namespace", "The namespace or prefix assigned by an identifier scheme.", "identity-scheme", "string"],
  ["scheme-resolver", "A resolver endpoint or procedure for an identifier scheme.", "identity-scheme", "string"],
  ["has-start", "The lower temporal boundary of this record, retaining precision and uncertainty.", "temporal-record", "time"],
  ["has-end", "The upper temporal boundary of this record, retaining precision and uncertainty.", "temporal-record", "time"],
  ["has-interval", "An interval value for this record when both boundaries are represented together.", "temporal-record", "interval"],
  ["uses-calendar", "The calendar or temporal reference system used to interpret the record.", "temporal-record", "entity", ["entity"]],
  ["time-precision", "The stated precision of the temporal value, distinct from certainty or measurement accuracy.", "temporal-record", "decimal"],
  ["has-geometry", "The geometry attached to this location record; coordinate interpretation remains explicit.", "location-record", "geometry"],
  ["has-globe", "The celestial body or globe bounding this location claim.", "location-record", "entity", ["entity"]],
  ["uses-crs", "The coordinate reference system used by the geometry.", "location-record", "entity", ["entity"]],
  ["location-accuracy", "The stated spatial accuracy or uncertainty of this record.", "location-record", "quantity"],
  ["supports-claim", "A claim supported by this evidence bundle or item; support is not truth or completeness.", "evidence-bundle", "entity", ["identity-claim"]],
  ["contains-evidence", "An evidence item contained in this bundle.", "evidence-bundle", "entity", ["evidence-item"]],
  ["has-evidence-item", "A source, observation, document or capture represented as an evidence item.", "evidence-bundle", "entity", ["evidence-item"]],
  ["evidence-source", "The source entity for this evidence item.", "evidence-item", "entity", ["entity"]],
  ["captured-at", "The retrieval or capture time of this evidence item, distinct from event time.", "evidence-item", "time"],
  ["evidence-excerpt", "A bounded excerpt or locator retained for auditability; it is not the complete source.", "evidence-item", "string"],
  ["value-kind", "The declared kind or interpretation family for this value record.", "value-record", "entity", ["entity"]],
  ["value-unit", "The unit descriptor for a quantity value; no conversion runs implicitly.", "value-record", "entity", ["entity"]],
  ["value-lower-bound", "The lower bound of a value range or uncertainty interval.", "value-record", "quantity"],
  ["value-upper-bound", "The upper bound of a value range or uncertainty interval.", "value-record", "quantity"],
  ["value-language", "The language context for a textual value.", "value-record", "string"],
  ["activity-actor", "The agent that performed or sponsored this provenance activity.", "provenance-activity", "entity", ["entity"]],
  ["activity-input", "An input entity consumed by this provenance activity.", "provenance-activity", "entity", ["entity"]],
  ["activity-output", "An output entity produced by this provenance activity.", "provenance-activity", "entity", ["entity"]],
  ["activity-time", "The time at which this provenance activity occurred.", "provenance-activity", "time"],
  ["activity-purpose", "The stated purpose of this provenance activity.", "provenance-activity", "string"],
] as const;

function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid identity-context pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function title(code: string): string { return code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" "); }
function schemaByCode(schemas: readonly KnowledgeSchemaRevisionV1[], code: string): KnowledgeSchemaRevisionV1 {
  const schema = schemas.find(item => item.identity.code === code);
  if (schema === undefined) throw new Error(`Missing identity-context schema ${code}.`);
  return schema;
}
function refs(schemas: readonly KnowledgeSchemaRevisionV1[], codes: readonly string[]): KnowledgeSchemaRefV1[] {
  return codes.map(code => schemaByCode(schemas, code).ref).sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}
function range(kind: "entity" | KnowledgeValueKindV1, concepts: readonly KnowledgeSchemaRefV1[] = []): KnowledgeValueRangeV1 {
  return kind === "entity" ? { concepts, kind: "entity-concepts", v: 1 } : { kind: "value-kinds", valueKinds: [kind], v: 1 };
}

export async function buildSpongeIdentityContextPackV1(catalog: SpongeKnowledgeDomainCatalogV3): Promise<KnowledgeVocabularyPackManifestV1> {
  const core = catalog.corePack;
  const foundation = catalog.foundationPack;
  const reference = catalog.referencePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge identity and context records"),
    namespace: "sponge.identity-context", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const coreEntity = schemaByCode(core.schemas, "entity").ref;
  const concepts: KnowledgeSchemaRevisionV1[] = [];
  for (const [code, definition] of SPONGE_IDENTITY_CONTEXT_CONCEPTS_V1) concepts.push(required(await createKnowledgeSchemaRevisionV1({
    definitions: labels(`${definition} Multiple compatible descriptions may coexist; absence does not establish completeness.`),
    identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 }, labels: labels(title(code)), previousRevisionSha256: null,
    reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1, kind: "concept", broader: [coreEntity],
  })));
  const local = (code: string) => schemaByCode(concepts, code).ref;
  const qualifierPredicates = [...reference.schemas, ...foundation.schemas].filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map(schema => schema.ref).sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
  const predicates: KnowledgePredicateRevisionV1[] = [];
  for (const [code, definition, domain, kind, target] of SPONGE_IDENTITY_CONTEXT_PREDICATES_V1) {
    const common = { definitions: labels(`${definition} This relation is descriptive and source-scoped; it does not grant identity, truth, access or publication authority.`),
      identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const }, labels: labels(title(code)), previousRevisionSha256: null,
      reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const, kind: "predicate" as const,
      domainConcepts: [local(domain)], inversePredicate: null, qualifierPredicates };
    const valueRange = kind === "entity"
      ? range("entity", target?.[0] === "entity" ? [coreEntity] : [local(target?.[0] ?? "entity")])
      : range(kind);
    predicates.push(required(await createKnowledgeSchemaRevisionV1({ ...common, range: valueRange })) as KnowledgePredicateRevisionV1);
  }
  const schemas = [...concepts, ...predicates].sort((a, b) => a.identity.code < b.identity.code ? -1 : 1);
  const shapes: KnowledgeExecutableShapeV1[] = [];
  for (const concept of concepts) {
    const rules = predicates.filter(predicate => predicate.domainConcepts.some(ref => canonical(ref) === canonical(concept.ref))).map(predicate => ({
      allowedDisclosures: ["private"] as const, cardinality: { maximum: null, minimum: 0, v: 1 as const }, predicate: predicate.ref,
      purpose: "private-research", range: predicate.range, requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const,
    })).sort((a, b) => canonical(a.predicate) < canonical(b.predicate) ? -1 : 1);
    shapes.push(required(await createKnowledgeExecutableShapeV1({ appliesToConcepts: [concept.ref], closed: false, extends: [], maximumInheritanceDepth: 1,
      rules, shape: concept.ref, v: 1 })));
  }
  const sourceContent = { concepts: SPONGE_IDENTITY_CONTEXT_CONCEPTS_V1, predicates: SPONGE_IDENTITY_CONTEXT_PREDICATES_V1 };
  return required(await createKnowledgeVocabularyPackManifestV1({ canonicalizerSha256: core.canonicalizerSha256,
    dependencies: [core, foundation, reference].map(knowledgeVocabularyPackPinV1), display: core.display, examples: [],
    migrationNotes: "Additive open-world identity, time, location, evidence, value and provenance records. Existing pack revisions and source assertions remain unchanged. No identifier equality, identity merge, truth, completeness, unit conversion, coordinate conversion, access right or publication authority is implied; every assertion still requires its own source and review policy.",
    packId: vocabulary.namespace, previousManifestSha256: null,
    queries: [{ description: "Which identity, temporal, spatial, evidence, value and provenance context qualifies this record?", id: "identity-context", predicates: predicates.map(predicate => predicate.ref).sort((a, b) => canonical(a) < canonical(b) ? -1 : 1), v: 1 }],
    revision: 1, schemas, shapes: shapes.sort((a, b) => a.shape.code < b.shape.code ? -1 : 1), sources: [{ contentSha256: await sha256Text(canonical(sourceContent)), license: "MIT", revision: "1", uri: "urn:sponge:application-profile:identity-context", v: 1 }], supportedCodecs: [], v: 1, vocabulary,
  }));
}

let packPromise: Promise<KnowledgeVocabularyPackManifestV1> | undefined;
export function spongeIdentityContextPackV1(): Promise<KnowledgeVocabularyPackManifestV1> {
  packPromise ??= spongeKnowledgeDomainCatalogV3().then(buildSpongeIdentityContextPackV1);
  return packPromise;
}
