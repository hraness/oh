import { canonicalJson, type JsonValue } from "./document-domain";
import {
  createKnowledgeSchemaRevisionV1,
  createKnowledgeVocabularyRevisionV1,
  type KnowledgeConceptRevisionV1,
  type KnowledgePredicateRevisionV1,
  type KnowledgeSchemaRevisionV1,
  type KnowledgeValueRangeV1,
  type KnowledgeVocabularyRevisionV1,
} from "./knowledge-ontology-contract-v1";
import {
  parseKnowledgeEntityId,
  type KnowledgeOntologyResult,
  type KnowledgeSchemaRefV1,
} from "./knowledge-ontology-v1";
import { sha256Text, type Sha256Hex } from "./integrity-domain";

const coreOwnerEntityId = (() => {
  const parsed = parseKnowledgeEntityId(`kent_${"0".repeat(24)}`);
  if (parsed === null) throw new Error("Invalid Sponge core owner identity.");
  return parsed;
})();

const conceptDefinitions = [
  ["entity", "Anything with a stable identity that can be referred to across contexts."],
  ["agent", "An entity capable of action, intention, or attributed responsibility."],
  ["account", "A provider-neutral online identity used by an agent or organization."],
  ["artifact", "A material or digital object produced, modified, or used by agents."],
  ["concept", "An abstract subject used to classify, compare, or explain entities."],
  ["event", "An occurrence situated in time and optionally in place."],
  ["information-resource", "An entity whose content can carry information across contexts."],
  ["inquiry", "A durable human question and its evolving investigation."],
  ["organization", "An agent formed by people, roles, or institutions acting collectively."],
  ["person", "A human agent represented without assuming a single name, role, or account."],
  ["place", "A spatial entity at any scale, from a locality to a region or celestial body."],
  ["process", "An ordered or continuous course of activity that changes state over time."],
  ["source", "An information resource that can be cited as evidence."],
  ["work", "An intellectual or creative entity distinct from any one expression or copy."],
] as const;

const broaderByConcept = Object.freeze({
  account: "entity",
  agent: "entity",
  artifact: "entity",
  concept: "entity",
  entity: null,
  event: "entity",
  "information-resource": "entity",
  inquiry: "entity",
  organization: "agent",
  person: "agent",
  place: "entity",
  process: "entity",
  source: "information-resource",
  work: "information-resource",
} satisfies Readonly<Record<(typeof conceptDefinitions)[number][0], string | null>>);

type CorePredicateDefinition = Readonly<{
  code: string;
  definition: string;
  domain: (typeof conceptDefinitions)[number][0];
  label: string;
  range: KnowledgeValueRangeV1;
}>;

const anyRange = { kind: "any", v: 1 } as const;
const entityRange = { kind: "value-kinds", v: 1, valueKinds: ["entity"] } as const;
const textRange = {
  kind: "text",
  languages: null,
  maximumBytes: 65_536,
  v: 1,
} as const;
const stringRange = { kind: "value-kinds", v: 1, valueKinds: ["string"] } as const;
const timeRange = { kind: "value-kinds", v: 1, valueKinds: ["time"] } as const;
const uriRange = { kind: "value-kinds", v: 1, valueKinds: ["uri"] } as const;

const predicateDefinitions: readonly CorePredicateDefinition[] = [
  { code: "about", definition: "Relates an information resource to the entity it concerns.", domain: "information-resource", label: "About", range: entityRange },
  { code: "authored-by", definition: "Relates a work or source to an agent responsible for authorship.", domain: "information-resource", label: "Authored by", range: entityRange },
  { code: "cites", definition: "Relates an information resource to a source it explicitly references.", domain: "information-resource", label: "Cites", range: entityRange },
  { code: "created-by", definition: "Relates an entity to the agent responsible for its creation.", domain: "entity", label: "Created by", range: entityRange },
  { code: "derived-from", definition: "Relates a value or entity to the prior entity from which it was derived.", domain: "entity", label: "Derived from", range: entityRange },
  { code: "description", definition: "A purpose-bound textual account of an entity.", domain: "entity", label: "Description", range: textRange },
  { code: "end-time", definition: "The time at which an event or process ends.", domain: "entity", label: "End time", range: timeRange },
  { code: "identifier", definition: "A URI that identifies or locates an entity in an external namespace.", domain: "entity", label: "Identifier", range: uriRange },
  { code: "located-in", definition: "Relates an entity to a place that spatially contains or situates it.", domain: "entity", label: "Located in", range: entityRange },
  { code: "name", definition: "A name used for an entity in a language and context.", domain: "entity", label: "Name", range: textRange },
  { code: "object", definition: "A deliberately open relation used only when no more precise predicate is available.", domain: "entity", label: "Object", range: anyRange },
  { code: "part-of", definition: "Relates an entity to a larger entity of which it is a constituent.", domain: "entity", label: "Part of", range: entityRange },
  { code: "published-date", definition: "The date on which an information resource was published, as an ISO 8601 date lexeme reported by its publisher or provider.", domain: "information-resource", label: "Published date", range: stringRange },
  { code: "related-to", definition: "A weak symmetric association whose more precise meaning is not yet known.", domain: "entity", label: "Related to", range: entityRange },
  { code: "same-as", definition: "Asserts that two identity anchors denote the same entity under a reviewed policy.", domain: "entity", label: "Same as", range: entityRange },
  { code: "source-type", definition: "The kind of information resource a source is, as reported by its provider, such as an article, paper, or report.", domain: "source", label: "Source type", range: stringRange },
  { code: "start-time", definition: "The time at which an event or process begins.", domain: "entity", label: "Start time", range: timeRange },
  { code: "title", definition: "The title an information resource gives itself or receives from its publisher.", domain: "information-resource", label: "Title", range: textRange },
] as const;

export type SpongeCoreRightsPolicyV1 = Readonly<{
  defaultDisclosure: "private";
  humanReviewRequiredFor: readonly ["identity", "public-encyclopedia", "schema"];
  purposes: readonly ["public-encyclopedia"];
  publicRequiresEvidence: true;
  v: 1;
}>;

export type SpongeCoreKnowledgeCatalogV1 = Readonly<{
  canonicalizerSha256: Sha256Hex;
  concepts: readonly KnowledgeConceptRevisionV1[];
  predicates: readonly KnowledgePredicateRevisionV1[];
  recordSchemaSha256: Sha256Hex;
  rightsPolicy: SpongeCoreRightsPolicyV1;
  rightsPolicySha256: Sha256Hex;
  schemas: readonly KnowledgeSchemaRevisionV1[];
  v: 1;
  vocabulary: KnowledgeVocabularyRevisionV1;
  vocabularySetSha256: Sha256Hex;
}>;

function label(text: string) {
  return [{ language: "en", text, v: 1 }] as const;
}

function unwrap<T>(result: KnowledgeOntologyResult<T>, field: string): T {
  if (!result.ok) {
    throw new Error(`Invalid Sponge core ${field}: ${result.error.field}.`);
  }
  return result.value;
}

function conceptRef(
  concepts: ReadonlyMap<string, KnowledgeConceptRevisionV1>,
  code: string,
): KnowledgeSchemaRefV1 {
  const concept = concepts.get(code);
  if (concept === undefined) throw new Error(`Missing Sponge core concept: ${code}.`);
  return concept.ref;
}

let catalogPromise: Promise<SpongeCoreKnowledgeCatalogV1> | undefined;

/**
 * The immutable, minimal vocabulary every Sponge knowledge space can rely on.
 * Product-specific ontologies extend it through reviewed vocabulary revisions;
 * they never add new hard-coded root entity kinds.
 */
export function spongeCoreKnowledgeCatalogV1(): Promise<SpongeCoreKnowledgeCatalogV1> {
  catalogPromise ??= buildSpongeCoreKnowledgeCatalogV1();
  return catalogPromise;
}

async function buildSpongeCoreKnowledgeCatalogV1(): Promise<SpongeCoreKnowledgeCatalogV1> {
  const canonicalizerSha256 = await sha256Text("sponge.knowledge.canonical-json.v1");
  const recordSchemaSha256 = await sha256Text("sponge.knowledge.graph-record-envelope.v1");
  const vocabulary = unwrap(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256,
    labels: label("Sponge core knowledge vocabulary"),
    namespace: "sponge.core",
    ownerEntityId: coreOwnerEntityId,
    previousRevisionSha256: null,
    revision: 1,
    state: "public",
    v: 1,
  }), "vocabulary");

  const concepts: KnowledgeConceptRevisionV1[] = [];
  const conceptsByCode = new Map<string, KnowledgeConceptRevisionV1>();
  for (const [code, definition] of conceptDefinitions) {
    const broader = broaderByConcept[code];
    const concept = unwrap(await createKnowledgeSchemaRevisionV1({
      broader: broader === null ? [] : [conceptRef(conceptsByCode, broader)],
      definitions: label(definition),
      identity: { code, namespace: "sponge.core", revision: 1, v: 1 },
      kind: "concept",
      labels: label(code.split("-").map((word) =>
        word[0]?.toUpperCase() + word.slice(1)).join(" ")),
      previousRevisionSha256: null,
      reviewDecisionSha256: null,
      v: 1,
      vocabularySha256: vocabulary.revisionSha256,
    }), `concept:${code}`);
    if (concept.kind !== "concept") throw new Error(`Invalid concept kind: ${code}.`);
    concepts.push(concept);
    conceptsByCode.set(code, concept);
  }

  const predicates: KnowledgePredicateRevisionV1[] = [];
  for (const definition of predicateDefinitions) {
    const predicate = unwrap(await createKnowledgeSchemaRevisionV1({
      definitions: label(definition.definition),
      domainConcepts: [conceptRef(conceptsByCode, definition.domain)],
      identity: {
        code: definition.code,
        namespace: "sponge.core",
        revision: 1,
        v: 1,
      },
      inversePredicate: null,
      kind: "predicate",
      labels: label(definition.label),
      previousRevisionSha256: null,
      qualifierPredicates: [],
      range: definition.range,
      reviewDecisionSha256: null,
      v: 1,
      vocabularySha256: vocabulary.revisionSha256,
    }), `predicate:${definition.code}`);
    if (predicate.kind !== "predicate") {
      throw new Error(`Invalid predicate kind: ${definition.code}.`);
    }
    predicates.push(predicate);
  }

  const rightsPolicy: SpongeCoreRightsPolicyV1 = {
    defaultDisclosure: "private",
    humanReviewRequiredFor: ["identity", "public-encyclopedia", "schema"],
    purposes: ["public-encyclopedia"],
    publicRequiresEvidence: true,
    v: 1,
  };
  const rightsPolicyJson: JsonValue = {
    defaultDisclosure: rightsPolicy.defaultDisclosure,
    humanReviewRequiredFor: [...rightsPolicy.humanReviewRequiredFor],
    publicRequiresEvidence: rightsPolicy.publicRequiresEvidence,
    purposes: [...rightsPolicy.purposes],
    v: rightsPolicy.v,
  };
  const rightsPolicySha256 = await sha256Text(canonicalJson(rightsPolicyJson));
  const schemas = [...concepts, ...predicates].sort((left, right) => {
    const leftKey = `${left.identity.namespace}:${left.identity.code}:${left.kind}`;
    const rightKey = `${right.identity.namespace}:${right.identity.code}:${right.kind}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const vocabularySet: JsonValue = {
    canonicalizerSha256,
    rightsPolicySha256,
    schemaRevisionSha256s: schemas.map((schema) => schema.revisionSha256),
    v: 1,
    vocabularyRevisionSha256s: [vocabulary.revisionSha256],
  };
  const vocabularySetSha256 = await sha256Text(canonicalJson(vocabularySet));

  return {
    canonicalizerSha256,
    concepts,
    predicates,
    recordSchemaSha256,
    rightsPolicy,
    rightsPolicySha256,
    schemas,
    v: 1,
    vocabulary,
    vocabularySetSha256,
  };
}
