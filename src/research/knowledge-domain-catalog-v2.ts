import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text } from "./integrity-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalog, SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS,
  type SpongeKnowledgeDomainCatalog } from "./knowledge-domain-catalog";
import {
  createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1,
  createKnowledgeVocabularyRevisionV1, type KnowledgeConceptRevisionV1,
  type KnowledgeExecutableShapeV1, type KnowledgePredicateRevisionV1,
  type KnowledgeSchemaRevisionV1, type KnowledgeValueKindV1, type KnowledgeValueRangeV1,
} from "./knowledge-ontology-contract-v1";
import { parseKnowledgeEntityId, type KnowledgeOntologyResult, type KnowledgeSchemaRefV1,
  type KnowledgeValueV1 } from "./knowledge-ontology-v1";
import { createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  resolveKnowledgeVocabularyPacksV1, type KnowledgeVocabularyPackManifestV1 } from "./knowledge-vocabulary-pack-v1";

export type SpongeKnowledgeDomainCatalogV2 = SpongeKnowledgeDomainCatalog & Readonly<{
  foundationPack: KnowledgeVocabularyPackManifestV1;
  /** Published V1 packs remain available for exact historical references and installation receipts. */
  historicalPacks: readonly KnowledgeVocabularyPackManifestV1[];
}>;

type QualifiedRange = Readonly<{ concepts: readonly string[]; note?: string }>;
/** These are application-profile constraints, not a translation of an upstream class hierarchy. */
const qualifiedRanges: Readonly<Record<string, Readonly<Record<string, QualifiedRange>>>> = {
  language: {
    "has-form": { concepts: ["form"] }, "has-sense": { concepts: ["sense"] },
    "translation-of-sense": { concepts: ["sense"] }, "attested-in": { concepts: ["text-occurrence"] },
  },
  culture: {
    depicts: { concepts: ["core:entity"], note: "Depictions can represent physical, fictional or abstract subjects; the open subject family is intentional." },
    "alludes-to": { concepts: ["core:entity"], note: "An allusion may concern an entity from any domain; attribution does not imply identity." },
    "named-after": { concepts: ["core:entity"], note: "A naming explanation may refer to a person, place, event, motif or other entity." },
    "interpreted-as": { concepts: ["core:concept"] },
  },
  "natural-world": {
    "classified-under": { concepts: ["natural-class", "taxon"] },
    observes: { concepts: ["physical-occurrence"] }, "observed-at": { concepts: ["core:place"] },
    "has-feature": { concepts: ["feature"] },
  },
  body: {
    "involves-structure": { concepts: ["anatomical-structure"] },
    "reports-experience": { concepts: ["bodily-phenomenon"] },
    "proposes-mechanism": { concepts: ["mechanism-hypothesis"] },
  },
  research: {
    tests: { concepts: ["core:entity"], note: "Studies may investigate a hypothesis, intervention, material or other identified object; the investigation target remains broad." },
    "uses-method": { concepts: ["method"] }, "produces-finding": { concepts: ["finding"] },
    supersedes: { concepts: ["publication-version"] },
  },
  substances: {
    "sample-of": { concepts: ["batch", "material"] }, "batch-of": { concepts: ["product"] },
    assays: { concepts: ["sample"] }, "offered-by": { concepts: ["core:agent"] },
  },
  organizations: {
    operates: { concepts: ["brand", "core:artifact", "core:process"], note: "Operated products and services may be artifacts or processes; brands retain their separate identity." },
    "held-by": { concepts: ["core:agent"] }, announces: { concepts: ["core:event"] },
    completes: { concepts: ["transaction"] },
  },
  editorial: {
    "reports-on": { concepts: ["core:event", "event-series"] },
    "contains-placement": { concepts: ["placement"] }, "ranks-under": { concepts: ["ranking-assessment"] },
    updates: { concepts: ["article"] },
  },
  software: {
    "evaluated-under": { concepts: ["benchmark-protocol"] }, "uses-configuration": { concepts: ["configuration"] },
    "uses-dataset": { concepts: ["dataset-version"] },
    produces: { concepts: ["measurement", "core:artifact"], note: "A run can produce a measured result or an output artifact; this relation alone does not establish comparability." },
  },
  music: {
    performs: { concepts: ["musical-work", "arrangement"] }, records: { concepts: ["performance"] },
    "appears-on": { concepts: ["release"] },
    "similar-under": { concepts: ["musical-work", "arrangement", "performance", "recording", "release", "track"],
      note: "The object is a musical subject participating in the assessment; its comparison method and other subjects are supplied separately." },
  },
  people: {
    "describes-person": { concepts: ["core:person"] },
    "derived-from-record": { concepts: ["source-contact-record", "public-profile-document"] },
    "involves-person": { concepts: ["core:person"] }, "accounts-for": { concepts: ["relationship"] },
  },
  finance: {
    "issued-by": { concepts: ["issuer"] }, "lists-instrument": { concepts: ["instrument"] },
    "tests-strategy": { concepts: ["strategy-version"] },
    "uses-dataset": { concepts: ["core:artifact"], note: "The data artifact can come from any installed domain; split, date, costs and assumptions remain separate context." },
  },
  "formal-systems": {
    instantiates: { concepts: ["rule-set-version"] }, "starts-from": { concepts: ["initial-state"] },
    "has-proof": { concepts: ["proof-artifact"] },
  },
  "agent-work": {
    "uses-skill": { concepts: ["skill-version"] }, attempts: { concepts: ["task"] },
    produces: { concepts: ["core:artifact", "core:information-resource"], note: "Attempts can produce physical or digital artifacts and information resources; production does not imply validation." },
    "validated-by": { concepts: ["check-result"] },
  },
};

type ConceptDefinition = readonly [code: string, definition: string, broader: string];
const additionalConcepts: Readonly<Record<string, readonly ConceptDefinition[]>> = {
  "natural-world": [["natural-class", "A natural classification category, distinct from the scheme that defines it and an occurrence classified under it.", "concept"]],
  substances: [["material", "Identified physical material from which a sample is taken, including material without a marketed product or production batch.", "entity"]],
  people: [["relationship", "An identified relationship among people or organizations, with dates, source accounts and access governed separately.", "entity"]],
};

const foundationConcepts: readonly ConceptDefinition[] = [
  ["contextual-entity", "An entity considered under an optional research profile; the profile does not require complete descriptions or mutually exclusive types.", "entity"],
  ["measurement", "An attributed measurement record whose subject, quantity, method and conditions are stated independently.", "information-resource"],
  ["julian-calendar", "The proleptic Julian calendar for an explicitly normalized time value; declaring the calendar does not convert source date lexemes.", "concept"],
  ["wgs84-geographic-crs", "A local descriptor for WGS 84 geographic coordinates ordered longitude then latitude in decimal degrees, with optional height in meters. It does not normalize an arbitrary source globe.", "concept"],
  ["earth-globe", "A descriptor identifying Earth as the globe of a source coordinate claim, distinct from a coordinate reference system or a coordinate conversion.", "concept"],
  ["wikidata-item", "The Wikidata item identifier scheme for Q identifiers. Its use preserves source identity and does not merge a local entity.", "concept"],
  ["wikidata-property", "The Wikidata property identifier scheme for P identifiers. Identifying a property does not approve a mapping to a local predicate.", "concept"],
  ["wikidata-lexeme", "The Wikidata lexeme identifier scheme for L identifiers, distinct from forms and senses.", "concept"],
  ["wikidata-form", "The Wikidata form identifier scheme for L-F identifiers, distinct from the lexical entry and its senses.", "concept"],
  ["wikidata-sense", "The Wikidata sense identifier scheme for L-S identifiers, distinct from the lexical entry and its forms.", "concept"],
  ["wikidata-entity-schema", "The Wikidata EntitySchema identifier scheme for E identifiers; a referenced schema is not an accepted local validation policy.", "concept"],
  ["wikidata-statement", "The Wikidata statement identifier scheme for source statement GUIDs; the source revision and capture remain separate provenance.", "concept"],
  ["doi", "The DOI identifier scheme for registered digital object identifiers. Equality of supplied strings is not independent validation of registration or identity.", "concept"],
  ["orcid", "The ORCID identifier scheme for researcher identifiers. A supplied identifier is not proof of account control or of a person's identity.", "concept"],
];

/** Affine descriptors use base value = value × scale + offset within the named dimension; no conversion runs implicitly. */
const foundationUnits = [
  ["meter", "length", "m", "1", "0", "The meter as the local base length unit."],
  ["second", "time", "s", "1", "0", "The second as the local base duration unit; calendar periods are not fixed durations."],
  ["kilogram", "mass", "kg", "1", "0", "The kilogram as the local base mass unit."],
  ["gram", "mass", "g", "0.001", "0", "A gram, one thousandth of the local kilogram base unit."],
  ["milligram", "mass", "mg", "0.000001", "0", "A milligram, one millionth of the local kilogram base unit."],
  ["kelvin", "temperature", "K", "1", "0", "The kelvin as the local base unit for thermodynamic temperature."],
  ["celsius", "temperature", "°C", "1", "273.15", "A Celsius temperature has a local kelvin value 273.15 greater; temperature differences need a separately stated quantity kind."],
  ["dimensionless", "dimensionless", "1", "1", "0", "A dimensionless ratio expressed as a fraction; its numerator and denominator meanings remain contextual."],
  ["percent", "dimensionless", "%", "0.01", "0", "One percent is one hundredth of a dimensionless ratio; the population and denominator remain contextual."],
  ["count", "count", "count", "1", "0", "A count of explicitly identified units or events; the counted population is stated separately and is not an arbitrary ratio."],
] as const;

export const SPONGE_KNOWLEDGE_DOMAIN_RANGE_NOTES_V2 = freezeKnowledgeDeclaration(
  Object.fromEntries(Object.entries(qualifiedRanges).flatMap(([domain, predicates]) =>
    Object.entries(predicates).filter(([, range]) => range.note !== undefined)
      .map(([code, range]) => [`sponge.${domain}/${code}`, range.note as string]))),
);

function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function unwrap<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid qualified knowledge pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(value: string) { return [{ language: "en", text: value, v: 1 }] as const; }
function title(value: string): string { return value.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" "); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((left, right) => canonical(left) < canonical(right) ? -1 : 1);
}
function sortedSchemas(schemas: readonly KnowledgeSchemaRevisionV1[]): KnowledgeSchemaRevisionV1[] {
  return [...schemas].sort((left, right) => left.identity.code < right.identity.code ? -1 : 1);
}
function requiredSchema(schemas: readonly KnowledgeSchemaRevisionV1[], code: string): KnowledgeSchemaRevisionV1 {
  const schema = schemas.find(item => item.identity.code === code);
  if (schema === undefined) throw new Error(`Missing qualified schema ${code}.`);
  return schema;
}
function entityRange(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeValueRangeV1 {
  return { concepts: sortedRefs(refs), kind: "entity-concepts", v: 1 };
}
function valueRange(...valueKinds: KnowledgeValueKindV1[]): KnowledgeValueRangeV1 {
  return { kind: "value-kinds", valueKinds: [...valueKinds].sort(), v: 1 };
}
function schemaInput(previous: KnowledgeSchemaRevisionV1) {
  return { definitions: previous.definitions, identity: { ...previous.identity, revision: 2 },
    labels: previous.labels, previousRevisionSha256: previous.revisionSha256,
    reviewDecisionSha256: null, v: 1 as const };
}
async function executableShapes(
  predicates: readonly KnowledgePredicateRevisionV1[],
  shapeForConcept: (ref: KnowledgeSchemaRefV1) => KnowledgeSchemaRefV1 = ref => ref,
): Promise<readonly KnowledgeExecutableShapeV1[]> {
  const subjects = new Map<string, KnowledgeSchemaRefV1>();
  for (const predicate of predicates) for (const concept of predicate.domainConcepts) subjects.set(canonical(concept), concept);
  const shapes: KnowledgeExecutableShapeV1[] = [];
  for (const concept of subjects.values()) {
    const rules = predicates.filter(predicate => predicate.domainConcepts.some(ref => canonical(ref) === canonical(concept)))
      .map(predicate => ({ allowedDisclosures: ["private"] as const,
        cardinality: { maximum: null, minimum: 0, v: 1 as const }, predicate: predicate.ref,
        purpose: "private-research", range: predicate.range, requiredEvidenceBearings: [],
        severity: "error" as const, v: 1 as const }));
    rules.sort((left, right) => canonical({ predicate: left.predicate, purpose: left.purpose }) < canonical({ predicate: right.predicate, purpose: right.purpose }) ? -1 : 1);
    shapes.push(unwrap(await createKnowledgeExecutableShapeV1({ appliesToConcepts: [concept], closed: false,
      extends: [], maximumInheritanceDepth: 1, rules, shape: shapeForConcept(concept), v: 1 })));
  }
  return shapes.sort((left, right) => left.shape.code < right.shape.code ? -1 : 1);
}

async function buildFoundation(legacy: SpongeKnowledgeDomainCatalog): Promise<KnowledgeVocabularyPackManifestV1> {
  const core = legacy.corePack;
  const reference = legacy.referencePack;
  const vocabulary = unwrap(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge qualified research foundation"),
    namespace: "sponge.foundation", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const schemas: KnowledgeSchemaRevisionV1[] = [];
  const base = (code: string, definition: string) => ({ definitions: labels(definition),
    identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const }, labels: labels(title(code)),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const });
  for (const [code, definition, broader] of foundationConcepts) schemas.push(unwrap(await createKnowledgeSchemaRevisionV1({
    ...base(code, definition), kind: "concept", broader: [requiredSchema(core.schemas, broader).ref],
  })));
  for (const [code, dimension, symbol, scale, offset, definition] of foundationUnits) schemas.push(unwrap(await createKnowledgeSchemaRevisionV1({
    ...base(code, `${definition} This original local descriptor neither performs conversion nor qualifies a source unit mapping.`),
    kind: "unit", dimension, symbol, scale, offset,
  })));
  const coreRef = (code: string) => requiredSchema(core.schemas, code).ref;
  const localRef = (code: string) => requiredSchema(schemas, code).ref;
  const contexts: readonly (readonly [string, string, KnowledgeValueRangeV1])[] = [
    ["globe-context", "The identified celestial body bounding this coordinate claim; this does not select or transform a coordinate system.", entityRange([coreRef("place")])],
    ["retrieved-at", "The explicitly recorded retrieval time of the supporting capture, distinct from the time the reported event occurred.", valueRange("time")],
    ["scope-context", "An identified scope, classification scheme or denominator definition for this claim.", entityRange([coreRef("concept")])],
    ["source-property", "The original property identifier for this source claim, retained independently of a local predicate mapping.", valueRange("identifier")],
    ["source-rank", "The source statement rank, retained as source metadata without converting preferred rank into accepted truth.",
      { kind: "enum", values: ["deprecated", "normal", "preferred"].map(value => ({ kind: "string", value, v: 1 })), v: 1 }],
    ["source-statement", "The original source statement identifier; capture identity and source revision are retained independently.", valueRange("identifier")],
    ["version-context", "The exact version entity under which a claim applies, without asserting identity with other versions.", entityRange([coreRef("entity")])],
  ];
  for (const [code, definition, range] of contexts) schemas.push(unwrap(await createKnowledgeSchemaRevisionV1({
    ...base(code, definition), kind: "predicate", domainConcepts: [coreRef("entity")], inversePredicate: null,
    qualifierPredicates: [], range,
  })));
  const qualifiers = sortedRefs([...reference.schemas, ...schemas].filter(schema => schema.kind === "predicate").map(schema => schema.ref));
  const definitions: readonly (readonly [string, string, KnowledgeSchemaRefV1, KnowledgeValueRangeV1])[] = [
    ["external-identifier", "An identifier under an explicitly named scheme. Source identity is retained without approving entity equivalence or a schema mapping.", coreRef("entity"), valueRange("identifier")],
    ["measurement-of", "The identified subject of one measurement. Any domain may supply the subject; units and method do not generalize its result.", localRef("measurement"), entityRange([coreRef("entity")])],
    ["measurement-method", "The identified measurement procedure or protocol used for this result.", localRef("measurement"), entityRange([coreRef("information-resource")])],
    ["measured-at", "The explicitly normalized time associated with this measurement, retaining its declared calendar and precision.", localRef("measurement"), valueRange("time")],
    ["normalized-quantity", "A quantity under an exact local unit descriptor, with bounds or uncertainty where known. Normalization requires separately attributable evidence.", localRef("measurement"), valueRange("quantity")],
    ["normalized-time", "A time explicitly normalized under the declared calendar, certainty and precision. Retained source time lexemes remain separate.", coreRef("entity"), valueRange("time")],
    ["normalized-location", "A geometry explicitly normalized under its declared coordinate reference system. A source globe claim alone does not justify this geometry.", coreRef("entity"), valueRange("geometry")],
    ["version-of", "Relates a version to the continuing entity it versions under attributed identity evidence. It does not assert same-as, succession or automatic equivalence.", coreRef("entity"), entityRange([coreRef("entity")])],
    ["source-asserted-instance-of", "Retains a source's direct instance-of claim between identified entities. It neither creates a local type membership nor permits transitive instance inference.", coreRef("entity"), entityRange([coreRef("entity")])],
    ["source-asserted-subclass-of", "Retains a source's subclass-of claim between identified class entities. It does not establish a local broader relation or imply an instance-of claim.", coreRef("entity"), entityRange([coreRef("entity")])],
    ["source-asserted-part-of", "Retains a source's constituent relation between identified entities. It remains distinct from classification, instance membership and entity equivalence.", coreRef("entity"), entityRange([coreRef("entity")])],
  ];
  for (const [code, definition, domain, range] of definitions) schemas.push(unwrap(await createKnowledgeSchemaRevisionV1({
    ...base(code, definition), kind: "predicate", domainConcepts: [domain], inversePredicate: null,
    qualifierPredicates: qualifiers, range,
  })));
  const predicates = schemas.filter((schema): schema is KnowledgePredicateRevisionV1 => schema.kind === "predicate");
  const shapes = await executableShapes(predicates, ref => ref.namespace === "sponge.core" ? localRef("contextual-entity") : ref);
  return unwrap(await createKnowledgeVocabularyPackManifestV1({ canonicalizerSha256: core.canonicalizerSha256,
    dependencies: [core, reference].map(knowledgeVocabularyPackPinV1), display: core.display, examples: [],
    migrationNotes: "Additive local descriptors and optional structural rules. No upstream mapping, coordinate or unit conversion, complete description, source truth, publication or identity authority is implied. Monetary quantities require explicit currency and valuation context; no currency conversion is defined.",
    packId: vocabulary.namespace, previousManifestSha256: null, queries: [{ description: "Which source identities, versions, units and explicit contexts qualify this research claim?", id: "qualified-context", predicates: sortedRefs(predicates.map(predicate => predicate.ref)), v: 1 }],
    revision: 1, schemas: sortedSchemas(schemas), shapes,
    sources: [{ contentSha256: await sha256Text(canonical({ foundationConcepts, foundationUnits, schemas })), license: "MIT",
      revision: "1", uri: "urn:sponge:application-profile:foundation", v: 1 }], supportedCodecs: [], v: 1, vocabulary,
  }));
}

let catalogPromise: Promise<SpongeKnowledgeDomainCatalogV2> | undefined;
/** Qualified local profiles with explicit V1 lineage; availability does not imply installation or review. */
export function spongeKnowledgeDomainCatalogV2(): Promise<SpongeKnowledgeDomainCatalogV2> {
  catalogPromise ??= buildCatalog();
  return catalogPromise;
}
async function buildCatalog(): Promise<SpongeKnowledgeDomainCatalogV2> {
  const legacy = await spongeKnowledgeDomainCatalog();
  const foundationPack = await buildFoundation(legacy);
  const { corePack, referencePack } = legacy;
  const qualifiers = sortedRefs([...referencePack.schemas, ...foundationPack.schemas]
    .filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map(schema => schema.ref));
  const packs: KnowledgeVocabularyPackManifestV1[] = [corePack, referencePack, foundationPack];
  for (const previous of legacy.packs.filter(pack => SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS.includes(pack.packId))) {
    const domain = previous.packId.slice("sponge.".length);
    const vocabulary = unwrap(await createKnowledgeVocabularyRevisionV1({
      canonicalizerSha256: previous.canonicalizerSha256, labels: previous.vocabulary.labels,
      namespace: previous.packId, ownerEntityId: previous.vocabulary.ownerEntityId,
      previousRevisionSha256: previous.vocabulary.revisionSha256, revision: 2, state: "private", v: 1,
    }));
    const concepts: KnowledgeConceptRevisionV1[] = [];
    for (const schema of previous.schemas.filter((item): item is KnowledgeConceptRevisionV1 => item.kind === "concept")) {
      const concept = unwrap(await createKnowledgeSchemaRevisionV1({ ...schemaInput(schema), broader: schema.broader,
        kind: "concept", vocabularySha256: vocabulary.revisionSha256 }));
      if (concept.kind !== "concept") throw new Error("Expected qualified concept.");
      concepts.push(concept);
    }
    for (const [code, definition, broader] of additionalConcepts[domain] ?? []) {
      const concept = unwrap(await createKnowledgeSchemaRevisionV1({ broader: [requiredSchema(corePack.schemas, broader).ref],
        definitions: labels(definition), identity: { code, namespace: previous.packId, revision: 1, v: 1 },
        kind: "concept", labels: labels(title(code)), previousRevisionSha256: null, reviewDecisionSha256: null,
        vocabularySha256: vocabulary.revisionSha256, v: 1 }));
      if (concept.kind !== "concept") throw new Error("Expected additional concept.");
      concepts.push(concept);
    }
    const localRef = (code: string) => requiredSchema(concepts, code).ref;
    const predicates: KnowledgePredicateRevisionV1[] = [];
    for (const schema of previous.schemas.filter((item): item is KnowledgePredicateRevisionV1 => item.kind === "predicate")) {
      const qualification = qualifiedRanges[domain]?.[schema.identity.code];
      const entityPredicate = schema.range.kind === "value-kinds" && schema.range.valueKinds.includes("entity");
      if (entityPredicate && qualification === undefined) throw new Error(`Unqualified entity relation ${previous.packId}/${schema.identity.code}.`);
      const range = qualification === undefined ? schema.range : entityRange(qualification.concepts.map(code =>
        code.startsWith("core:") ? requiredSchema(corePack.schemas, code.slice(5)).ref : localRef(code)));
      const predicate = unwrap(await createKnowledgeSchemaRevisionV1({ ...schemaInput(schema),
        definitions: qualification?.note === undefined ? schema.definitions : labels(`${schema.definitions[0]?.text} ${qualification.note}`),
        domainConcepts: sortedRefs(schema.domainConcepts.map(ref => localRef(ref.code))), inversePredicate: null,
        kind: "predicate", qualifierPredicates: qualifiers, range, vocabularySha256: vocabulary.revisionSha256 }));
      if (predicate.kind !== "predicate") throw new Error("Expected qualified predicate.");
      predicates.push(predicate);
    }
    const exampleEntityId = parseKnowledgeEntityId(`kent_${"e".repeat(24)}`);
    if (exampleEntityId === null) throw new Error("Invalid structural example identity.");
    const examples = predicates.map(predicate => {
      const object: KnowledgeValueV1 = predicate.range.kind === "entity-concepts"
        ? { entityId: exampleEntityId, kind: "entity", v: 1 }
        : { kind: predicate.identity.code === "observed-at-tick" ? "integer" : "decimal", value: "1", v: 1 };
      return { description: `Synthetic structural example for ${predicate.identity.code}; the referenced entity must independently have an allowed range concept. No real-world claim or completeness is asserted.`,
        id: predicate.identity.code, object, predicate: predicate.ref, subjectConcept: predicate.domainConcepts[0], v: 1 };
    });
    const schemas = sortedSchemas([...concepts, ...predicates]);
    packs.push(unwrap(await createKnowledgeVocabularyPackManifestV1({ canonicalizerSha256: previous.canonicalizerSha256,
      dependencies: [corePack, foundationPack, referencePack].map(knowledgeVocabularyPackPinV1), display: previous.display,
      examples, migrationNotes: "Revision 2 qualifies relation ranges and adds optional contextual shapes. Revision 1 records and digests remain unchanged; a new revision does not retype existing entities, rewrite accepted statements, or grant publication or identity authority. Multiple compatible types are allowed; absent optional relations do not establish completeness.",
      packId: previous.packId, previousManifestSha256: previous.manifestSha256,
      queries: previous.queries.map(query => ({ ...query, predicates: sortedRefs(predicates.map(predicate => predicate.ref)) })),
      revision: 2, schemas, shapes: await executableShapes(predicates), sources: [{
        contentSha256: await sha256Text(canonical({ qualification: qualifiedRanges[domain], schemas })), license: "MIT",
        revision: "2", uri: `urn:sponge:application-profile:${domain}`, v: 1,
      }], supportedCodecs: [], v: 1, vocabulary })));
  }
  packs.sort((left, right) => left.packId < right.packId ? -1 : 1);
  const resolved = unwrap(await resolveKnowledgeVocabularyPacksV1({ manifests: packs,
    roots: packs.filter(pack => SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS.includes(pack.packId)).map(knowledgeVocabularyPackPinV1) }));
  return freezeKnowledgeDeclaration({ corePack, foundationPack, historicalPacks: legacy.packs, lock: resolved.lock,
    packs, referencePack, schemas: packs.flatMap(pack => pack.schemas), vocabularies: packs.map(pack => pack.vocabulary) });
}
