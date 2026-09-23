import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import type { SpongeKnowledgeDomainCatalogV7 } from "./knowledge-domain-catalog-v7";
import {
  createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgePredicateRevisionV1, type KnowledgeSchemaRevisionV1, type KnowledgeValueRangeV1,
} from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult, KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";

function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid citation pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}

/** Ordered citation clusters with locators, quotation selectors, stated intent and WEMI levels. */
export async function createSpongeCitationPackV1(previous: SpongeKnowledgeDomainCatalogV7): Promise<KnowledgeVocabularyPackManifestV1> {
  const dependencyIds = ["sponge.core", "sponge.foundation", "sponge.reference"];
  const dependencies = dependencyIds.map(packId => {
    const pack = previous.packs.find(item => item.packId === packId);
    if (pack === undefined) throw new Error(`Missing citation dependency ${packId}.`);
    return pack;
  });
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const schema = dependencies.find(pack => pack.packId === packId)?.schemas.find(item => item.identity.code === code);
    if (schema === undefined) throw new Error(`Missing citation schema ${packId}/${code}.`);
    return schema.ref;
  };
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge citations"),
    namespace: "sponge.citation", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
    labels: labels(code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  const entity = ref("sponge.core", "entity");
  const entityRange = { concepts: [entity], kind: "entity-concepts", v: 1 } as const;
  const cluster = required(await createKnowledgeSchemaRevisionV1({
    ...base("citation-cluster", "An ordered set of citations attached to one citing entity, such as a synthesis, document or claim record. Ordering is recorded per item; the cluster never claims completeness."),
    kind: "concept", broader: [ref("sponge.core", "information-resource")],
  }));
  const intent = required(await createKnowledgeSchemaRevisionV1({
    ...base("citation-intent-descriptor", "A stated reason an item is cited, such as support, method, data, background or disagreement. A corpus declares its own instances."),
    kind: "concept", broader: [ref("sponge.core", "concept")],
  }));
  const wemi = required(await createKnowledgeSchemaRevisionV1({
    ...base("wemi-level-descriptor", "The abstraction level at which an entity was cited: work, expression, manifestation or item. A citation to an expression does not transfer to other expressions of the work."),
    kind: "concept", broader: [ref("sponge.core", "concept")],
  }));
  const qualifiers = sortedRefs(dependencies.filter(pack => pack.packId === "sponge.reference" || pack.packId === "sponge.foundation")
    .flatMap(pack => pack.schemas).filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map(schema => schema.ref));
  const predicates: KnowledgePredicateRevisionV1[] = [];
  const add = async (code: string, definition: string, domains: readonly KnowledgeSchemaRefV1[], range: KnowledgeValueRangeV1,
    qualifierPredicates: readonly KnowledgeSchemaRefV1[] = qualifiers) => {
    const predicate = required(await createKnowledgeSchemaRevisionV1({
      ...base(code, definition), kind: "predicate", domainConcepts: sortedRefs(domains), inversePredicate: null,
      qualifierPredicates: sortedRefs(qualifierPredicates), range,
    }));
    if (predicate.kind !== "predicate") throw new Error(`Expected citation predicate ${code}.`);
    predicates.push(predicate);
    return predicate;
  };
  const citationOrder = await add("citation-order", "The item's ordinal position in its citation cluster.",
    [entity], { kind: "value-kinds", valueKinds: ["integer"], v: 1 }, []);
  const citationLocator = await add("citation-locator", "The page, section or locator string inside the cited entity.",
    [entity], { kind: "value-kinds", valueKinds: ["string"], v: 1 }, []);
  const quotationSelector = await add("quotation-selector", "A verbatim quotation selector binding the citation to exact content in the cited entity.",
    [entity], { kind: "value-kinds", valueKinds: ["string"], v: 1 }, []);
  const citationIntent = await add("citation-intent", "The citation-intent-descriptor entity stating why the item is cited.",
    [entity], { concepts: [intent.ref], kind: "entity-concepts", v: 1 }, []);
  const citedFrom = await add("cited-from", "The citing entity whose citation list this cluster is.",
    [cluster.ref], entityRange);
  const citesItem = await add("cites-item", "One cited entity in this cluster, typically a source or retained content version. Citation-order, citation-locator, quotation-selector and citation-intent may qualify the statement.",
    [cluster.ref], entityRange, [...qualifiers, citationOrder.ref, citationLocator.ref, quotationSelector.ref, citationIntent.ref]);
  const wemiLevel = await add("wemi-level", "The wemi-level-descriptor entity stating the abstraction level at which this entity was cited.",
    [entity], { concepts: [wemi.ref], kind: "entity-concepts", v: 1 });
  const shape = required(await createKnowledgeExecutableShapeV1({
    appliesToConcepts: [cluster.ref], closed: false, extends: [], maximumInheritanceDepth: 1,
    rules: [citedFrom, citesItem]
      .map(predicate => ({ allowedDisclosures: ["private"] as const,
        cardinality: { maximum: predicate === citedFrom ? 1 : null, minimum: 0, v: 1 as const },
        predicate: predicate.ref, purpose: "private-research",
        range: { kind: "value-kinds" as const, valueKinds: ["entity"] as const, v: 1 as const },
        requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const }))
      .sort((a, b) => canonical({ predicate: a.predicate, purpose: a.purpose }) < canonical({ predicate: b.predicate, purpose: b.purpose }) ? -1 : 1),
    shape: cluster.ref, v: 1,
  }));
  const schemas: KnowledgeSchemaRevisionV1[] = [cluster, intent, wemi, ...predicates];
  return freezeKnowledgeDeclaration(required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256, dependencies: dependencies.map(knowledgeVocabularyPackPinV1),
    display: core.display, examples: [],
    migrationNotes: "Additive ordered citation clusters with locators, quotation selectors, stated intent and WEMI levels. Existing V1–V7 declarations and locks remain unchanged. A citation records what a citing entity pointed at and why; it does not verify support, match selectors to bytes, establish completeness, or grant access or publication rights. Typed external identifiers remain under sponge.foundation/external-identifier and sponge.identity-context.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1,
    schemas: schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1), shapes: [shape],
    queries: [
      { description: "Declarative join guidance, not an executable query: for a cited entity, return its wemi-level statements and each cites-item that references it, with intent and locator qualifiers. A citation to one expression does not reach the work or other expressions.",
        id: "cited-level",
        predicates: sortedRefs([citesItem.ref, wemiLevel.ref]), v: 1 },
      { description: "Declarative join guidance, not an executable query: reverse cited-from from the citing entity to its clusters, then follow cites-item to each cited entity, returning citation-order, citation-locator, quotation-selector and citation-intent qualifiers where supplied. Sort by citation-order; keep unqualified items in recorded order rather than inferring position.",
        id: "ordered-citations",
        predicates: sortedRefs([citedFrom.ref, citesItem.ref, citationOrder.ref, citationLocator.ref, quotationSelector.ref, citationIntent.ref]), v: 1 },
    ],
    sources: [{ contentSha256: "42bd258b03ce78b2b85ffadf7f1da2a852c23b1473e1906d3f23adcfcb64fb06", license: "MIT", revision: "2026-09-16",
      uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/citation-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  })));
}
