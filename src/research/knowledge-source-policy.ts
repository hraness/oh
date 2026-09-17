import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import type { SpongeKnowledgeDomainCatalogV7 } from "./knowledge-domain-catalog-v7";
import {
  createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgePredicateRevisionV1, type KnowledgeSchemaRevisionV1, type KnowledgeValueKindV1, type KnowledgeValueRangeV1,
} from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult, KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";

function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid source-policy pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}

/** Recorded per-source capability and rights decisions: what was decided, never what is permitted. */
export async function createSpongeSourcePolicyPackV1(previous: SpongeKnowledgeDomainCatalogV7): Promise<KnowledgeVocabularyPackManifestV1> {
  const dependencyIds = ["sponge.core", "sponge.foundation", "sponge.reference"];
  const dependencies = dependencyIds.map(packId => {
    const pack = previous.packs.find(item => item.packId === packId);
    if (pack === undefined) throw new Error(`Missing source-policy dependency ${packId}.`);
    return pack;
  });
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const schema = dependencies.find(pack => pack.packId === packId)?.schemas.find(item => item.identity.code === code);
    if (schema === undefined) throw new Error(`Missing source-policy schema ${packId}/${code}.`);
    return schema.ref;
  };
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge source policy"),
    namespace: "sponge.source-policy", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
    labels: labels(code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  const entityConcepts = (...targets: KnowledgeSchemaRefV1[]): KnowledgeValueRangeV1 =>
    ({ concepts: sortedRefs(targets), kind: "entity-concepts", v: 1 });
  const valueKinds = (...kinds: KnowledgeValueKindV1[]): KnowledgeValueRangeV1 =>
    ({ kind: "value-kinds", valueKinds: [...kinds].sort(), v: 1 });
  const capability = required(await createKnowledgeSchemaRevisionV1({
    ...base("capability-policy", "One recorded policy decision for one source: which capabilities its material may be used for, under which status, reason, terms document and policy revision. The record is the decision; it grants no rights by itself."),
    kind: "concept", broader: [ref("sponge.core", "information-resource")],
  }));
  const status = required(await createKnowledgeSchemaRevisionV1({
    ...base("policy-status-descriptor", "A recorded policy status a corpus declares, such as denied, requires-entry, prohibited-pending-permission or allowed-with-review."),
    kind: "concept", broader: [ref("sponge.core", "concept")],
  }));
  const qualifiers = sortedRefs(dependencies.filter(pack => pack.packId === "sponge.reference" || pack.packId === "sponge.foundation")
    .flatMap(pack => pack.schemas).filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map(schema => schema.ref));
  const predicates: KnowledgePredicateRevisionV1[] = [];
  const add = async (code: string, definition: string, domains: readonly KnowledgeSchemaRefV1[], range: KnowledgeValueRangeV1) => {
    const predicate = required(await createKnowledgeSchemaRevisionV1({
      ...base(code, definition), kind: "predicate", domainConcepts: sortedRefs(domains), inversePredicate: null,
      qualifierPredicates: qualifiers, range,
    }));
    if (predicate.kind !== "predicate") throw new Error(`Expected source-policy predicate ${code}.`);
    predicates.push(predicate);
    return predicate;
  };
  const policyForSource = await add("policy-for-source", "The source entity this decision governs.",
    [capability.ref], entityConcepts(ref("sponge.core", "source")));
  const policyStatus = await add("policy-status", "The policy-status-descriptor entity recording this decision's status.",
    [capability.ref], entityConcepts(status.ref));
  const capabilityPredicates: KnowledgePredicateRevisionV1[] = [];
  for (const [code, noun] of [
    ["capability-storage", "stored"],
    ["capability-features", "shown as features"],
    ["capability-labels", "used as labels"],
    ["capability-ml", "used for machine learning"],
    ["capability-network", "fetched over the network"],
  ] as const) {
    capabilityPredicates.push(await add(code, `Whether this decision permits the source's material to be ${noun}. Absence of the statement is not permission.`,
      [capability.ref], valueKinds("boolean")));
  }
  const policyReason = await add("policy-reason", "The stated basis for this decision.",
    [capability.ref], { kind: "text", languages: null, maximumBytes: 65_536, v: 1 });
  const termsReference = await add("terms-reference", "A URI for the license or terms document this decision cites.",
    [capability.ref], valueKinds("uri"));
  const policyRevision = await add("policy-revision", "The integer revision of the policy that produced this decision, keeping the decision attributable after policy text changes.",
    [capability.ref], valueKinds("integer"));
  const shape = required(await createKnowledgeExecutableShapeV1({
    appliesToConcepts: [capability.ref], closed: false, extends: [], maximumInheritanceDepth: 1,
    rules: [policyForSource, policyStatus, policyReason, termsReference, policyRevision, ...capabilityPredicates]
      .map(predicate => ({ allowedDisclosures: ["private"] as const,
        cardinality: { maximum: null, minimum: predicate === policyForSource || predicate === policyStatus ? 1 : 0, v: 1 as const },
        predicate: predicate.ref, purpose: "private-research",
        range: predicate.range.kind === "entity-concepts" ? valueKinds("entity") : predicate.range,
        requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const }))
      .sort((a, b) => canonical({ predicate: a.predicate, purpose: a.purpose }) < canonical({ predicate: b.predicate, purpose: b.purpose }) ? -1 : 1),
    shape: capability.ref, v: 1,
  }));
  const schemas: KnowledgeSchemaRevisionV1[] = [capability, status, ...predicates];
  return freezeKnowledgeDeclaration(required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256, dependencies: dependencies.map(knowledgeVocabularyPackPinV1),
    display: core.display, examples: [],
    migrationNotes: "Additive recorded per-source capability and rights decisions. Existing V1–V7 declarations and locks remain unchanged. A capability policy records what was decided under which revision; it does not grant rights, execute the decision, or prevent supersession. Where no policy record exists for a source, the safe consumer default is to deny; this pack does not create that default.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1,
    schemas: schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1), shapes: [shape],
    queries: [
      { description: "Declarative join guidance, not an executable query: reverse policy-for-source from a source to its capability-policy records, and return each record's policy-status, policy-reason, terms-reference, policy-revision and the five capability booleans. Where several decisions exist, keep them all with their revisions rather than selecting a latest policy.",
        id: "source-decisions",
        predicates: sortedRefs([policyForSource.ref, policyStatus.ref, policyReason.ref, termsReference.ref,
          policyRevision.ref, ...capabilityPredicates.map(predicate => predicate.ref)]), v: 1 },
    ],
    sources: [{ contentSha256: "c0dcf36c1b0e20d967c919e51da9de4b38b7686f3a484dd614e6a6b58e3c3a4b", license: "MIT", revision: "2026-09-16",
      uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/source-policy-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  })));
}
