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
  if (!result.ok) throw new Error(`Invalid evidence-grading pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}

/** Recorded evidence strata, tiers, grades, corroboration, verbatim bindings and bounded absence findings. */
export async function createSpongeEvidenceGradingPackV1(
  previous: SpongeKnowledgeDomainCatalogV7,
  temporalRolesPack: KnowledgeVocabularyPackManifestV1,
): Promise<KnowledgeVocabularyPackManifestV1> {
  const dependencyIds = ["sponge.content-occurrences", "sponge.core", "sponge.foundation", "sponge.reference", "sponge.research"];
  const dependencies = dependencyIds.map(packId => {
    const pack = previous.packs.find(item => item.packId === packId);
    if (pack === undefined) throw new Error(`Missing evidence-grading dependency ${packId}.`);
    return pack;
  });
  const allDependencies = [...dependencies, temporalRolesPack];
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const schema = allDependencies.find(pack => pack.packId === packId)?.schemas.find(item => item.identity.code === code);
    if (schema === undefined) throw new Error(`Missing evidence-grading schema ${packId}/${code}.`);
    return schema.ref;
  };
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge evidence grading"),
    namespace: "sponge.evidence-grading", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
    labels: labels(code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  const concept = (code: string, definition: string, broader: KnowledgeSchemaRefV1) => {
    return createKnowledgeSchemaRevisionV1({ ...base(code, definition), kind: "concept", broader: [broader] });
  };
  const entity = ref("sponge.core", "entity");
  const entityRange = { concepts: [entity], kind: "entity-concepts", v: 1 } as const;
  const entityConcepts = (...targets: KnowledgeSchemaRefV1[]): KnowledgeValueRangeV1 =>
    ({ concepts: sortedRefs(targets), kind: "entity-concepts", v: 1 });
  const valueKinds = (...kinds: KnowledgeValueKindV1[]): KnowledgeValueRangeV1 =>
    ({ kind: "value-kinds", valueKinds: [...kinds].sort(), v: 1 });
  const textRange = { kind: "text", languages: null, maximumBytes: 65_536, v: 1 } as const;
  const enumRange = (...values: string[]): KnowledgeValueRangeV1 =>
    ({ kind: "enum", values: values.sort().map(value => ({ kind: "string", value, v: 1 })), v: 1 });
  const stratum = required(await concept("evidence-stratum",
    "An evidence channel class that owns its own tier ladder. A corpus declares the instances, such as clinical, community, historical, registry or licensed channels. A stratum is never collapsed into another stratum.",
    ref("sponge.core", "concept")));
  const tier = required(await concept("stratum-tier",
    "One rung of exactly one stratum's tier ladder. A tier is meaningless across strata; a strong community tier is not a weaker clinical tier.",
    ref("sponge.core", "concept")));
  const grade = required(await concept("epistemic-grade-descriptor",
    "A recorded epistemic grade a policy assigns to a record, such as established, emerging, contested, community-signal, historical-record or refuted. The grade is attributed data, not an assertion's review state or a verdict.",
    ref("sponge.core", "concept")));
  const corroboration = required(await concept("corroboration-descriptor",
    "A recorded corroboration state a policy assigns, such as convergent, contested, refuted or single-source. Multi-stratum records may carry contested or refuted honestly.",
    ref("sponge.core", "concept")));
  const absence = required(await concept("absence-finding",
    "A bounded-search record reporting that a stated scope, searched with a stated method inside a stated source set, produced no result or insufficient coverage. It is evidence about the search, never about nonexistence.",
    ref("sponge.core", "information-resource")));
  const qualifiers = sortedRefs([...allDependencies.filter(pack => pack.packId === "sponge.reference"
      || pack.packId === "sponge.foundation" || pack.packId === "sponge.temporal-roles")
    .flatMap(pack => pack.schemas)
    .filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0)
    .map(schema => schema.ref)]);
  const predicates: KnowledgePredicateRevisionV1[] = [];
  const add = async (code: string, definition: string, domains: readonly KnowledgeSchemaRefV1[], range: KnowledgeValueRangeV1) => {
    const predicate = required(await createKnowledgeSchemaRevisionV1({
      ...base(code, definition), kind: "predicate", domainConcepts: sortedRefs(domains), inversePredicate: null,
      qualifierPredicates: qualifiers, range,
    }));
    if (predicate.kind !== "predicate") throw new Error(`Expected evidence-grading predicate ${code}.`);
    predicates.push(predicate);
    return predicate;
  };
  const ofStratum = await add("of-stratum", "The stratum a record was admitted under. Admission is recorded; it does not verify the channel or grade the record.",
    [entity], entityConcepts(stratum.ref));
  const ofTier = await add("of-tier", "The tier the record holds on its own stratum's ladder.",
    [entity], entityConcepts(tier.ref));
  const tierInStratum = await add("tier-in-stratum", "The stratum ladder this tier belongs to.",
    [tier.ref], entityConcepts(stratum.ref));
  const tierRank = await add("tier-rank", "The tier's ordinal rank within its own ladder, for ordering only. Ranks do not compare across ladders.",
    [tier.ref], valueKinds("integer"));
  const epistemicGrade = await add("epistemic-grade", "The recorded epistemic grade a policy assigned to this record. Grading is source-scoped evidence, not acceptance.",
    [entity], entityConcepts(grade.ref));
  const corroborationState = await add("corroboration-state", "The recorded corroboration state of this record under its policy.",
    [entity], entityConcepts(corroboration.ref));
  const corroboratedBy = await add("corroborated-by", "An explicitly identified record or source that corroborates or contests the subject. Contesting evidence stays attached.",
    [entity], entityRange);
  const assessedUnder = await add("assessed-under", "The criteria version or era entity under which this record was assessed. Documentation under an earlier era is not endorsement under a later one.",
    [entity], entityRange);
  const corpusNovelty = await add("corpus-novelty", "How this record relates to the existing corpus: known, new, unknown or update.",
    [entity], enumRange("known", "new", "unknown", "update"));
  const boundSelector = await add("bound-selector", "The verbatim selector or quote span locating this claim's support inside its bound payload. A selector that matches nothing is itself evidence about the claim.",
    [entity], valueKinds("string"));
  const boundPayload = await add("bound-payload", "The exact retained content version or source this record's selector reads from. Binding to a version does not verify its bytes.",
    [entity], entityConcepts(ref("sponge.content-occurrences", "retained-content-version"), ref("sponge.core", "source")));
  const corrects = await add("corrects", "The earlier record this record corrects or retracts. Corrections supersede; they do not rewrite, and the corrected record remains.",
    [entity], entityRange);
  const absenceOutcome = await add("absence-outcome", "The recorded outcome of this bounded search: insufficient-coverage or no-result. Not-searched and not-applicable are not findings.",
    [absence.ref], enumRange("insufficient-coverage", "no-result"));
  const searchScope = await add("search-scope", "The declared scope of this bounded search: the queries, source set and window actually covered.",
    [absence.ref], textRange);
  const searchedWithin = await add("searched-within", "The corpus or source entity this bounded search covered.",
    [absence.ref], entityConcepts(ref("sponge.core", "source")));
  const searchMethod = await add("search-method", "The method entity used for this bounded search.",
    [absence.ref], entityConcepts(ref("sponge.research", "method")));
  const shape = required(await createKnowledgeExecutableShapeV1({
    appliesToConcepts: [absence.ref], closed: false, extends: [], maximumInheritanceDepth: 1,
    rules: [
      { cardinality: { maximum: 1, minimum: 1 }, predicate: absenceOutcome },
      { cardinality: { maximum: null, minimum: 0 }, predicate: searchMethod },
      { cardinality: { maximum: 1, minimum: 1 }, predicate: searchScope },
      { cardinality: { maximum: null, minimum: 1 }, predicate: searchedWithin },
    ]
      .map(rule => ({ allowedDisclosures: ["private"] as const,
        cardinality: { maximum: rule.cardinality.maximum, minimum: rule.cardinality.minimum, v: 1 as const },
        predicate: rule.predicate.ref, purpose: "private-research",
        range: rule.predicate.range.kind === "entity-concepts" ? valueKinds("entity") : rule.predicate.range,
        requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const }))
      .sort((a, b) => canonical({ predicate: a.predicate, purpose: a.purpose }) < canonical({ predicate: b.predicate, purpose: b.purpose }) ? -1 : 1),
    shape: absence.ref, v: 1,
  }));
  const schemas: KnowledgeSchemaRevisionV1[] = [stratum, tier, grade, corroboration, absence, ...predicates];
  return freezeKnowledgeDeclaration(required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256,
    dependencies: allDependencies.map(knowledgeVocabularyPackPinV1),
    display: core.display, examples: [],
    migrationNotes: "Additive recorded grading, corroboration, verbatim binding, correction and bounded absence findings. Existing V1–V7 declarations and locks remain unchanged. A recorded grade or corroboration state is attributed evidence, never assertion review state, truth, acceptance, identity equivalence or publication authority. Strata are never collapsed; corrections append rather than rewrite; a null search result does not imply nonexistence.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1,
    schemas: schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1), shapes: [shape],
    queries: [
      { description: "Declarative join guidance, not an executable query: enumerate absence-finding records with their search-scope, searched-within, search-method and absence-outcome, and carry the temporal searched-at role. An absence finding bounds its stated scope only; it never implies nonexistence outside it.",
        id: "absence-ledger",
        predicates: sortedRefs([absenceOutcome.ref, searchScope.ref, searchedWithin.ref,
          searchMethod.ref, ref("sponge.temporal-roles", "searched-at")]), v: 1 },
      { description: "Declarative join guidance, not an executable query: follow of-stratum and of-tier from a record, then tier-in-stratum and tier-rank on the tier. Return epistemic-grade, corroboration-state, corroborated-by, assessed-under and corpus-novelty statements with their temporal-role qualifiers. Keep contested and refuted records; do not collapse strata or select one current grade.",
        id: "graded-record",
        predicates: sortedRefs([ofStratum.ref, ofTier.ref, tierInStratum.ref, tierRank.ref,
          epistemicGrade.ref, corroborationState.ref, corroboratedBy.ref, assessedUnder.ref,
          corpusNovelty.ref]), v: 1 },
      { description: "Declarative join guidance, not an executable query: follow bound-payload from a claim to its retained content version or source, then evaluate bound-selector verbatim against that version. Follow corrects to earlier records and return them alongside rather than replacing them.",
        id: "verbatim-binding",
        predicates: sortedRefs([boundPayload.ref, boundSelector.ref, corrects.ref]), v: 1 },
    ],
    sources: [{ contentSha256: "a2ed1580b94c6f3f2aae041810695bb8104f1c03f0d278fb7aa8c090d7dcee48", license: "MIT", revision: "2026-09-16",
      uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/evidence-grading-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  })));
}
