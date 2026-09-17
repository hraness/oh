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
  if (!result.ok) throw new Error(`Invalid source-quality pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}

/** Measured source scorecards, maturity descriptors and veto rules — recorded data, never a truth score. */
export async function createSpongeSourceQualityPackV1(previous: SpongeKnowledgeDomainCatalogV7): Promise<KnowledgeVocabularyPackManifestV1> {
  const dependencyIds = ["sponge.core", "sponge.foundation", "sponge.reference"];
  const dependencies = dependencyIds.map(packId => {
    const pack = previous.packs.find(item => item.packId === packId);
    if (pack === undefined) throw new Error(`Missing source-quality dependency ${packId}.`);
    return pack;
  });
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const schema = dependencies.find(pack => pack.packId === packId)?.schemas.find(item => item.identity.code === code);
    if (schema === undefined) throw new Error(`Missing source-quality schema ${packId}/${code}.`);
    return schema.ref;
  };
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge source quality"),
    namespace: "sponge.source-quality", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
    labels: labels(code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  const entity = ref("sponge.core", "entity");
  const entityConcepts = (...targets: KnowledgeSchemaRefV1[]): KnowledgeValueRangeV1 =>
    ({ concepts: sortedRefs(targets), kind: "entity-concepts", v: 1 });
  const valueKinds = (...kinds: KnowledgeValueKindV1[]): KnowledgeValueRangeV1 =>
    ({ kind: "value-kinds", valueKinds: [...kinds].sort(), v: 1 });
  const scorecard = required(await createKnowledgeSchemaRevisionV1({
    ...base("source-scorecard", "One measured performance record for a source at a stated horizon over a stated sample. It is recorded data about the source, not a truth score, and it never generalizes beyond its stated domain."),
    kind: "concept", broader: [ref("sponge.core", "information-resource")],
  }));
  const maturity = required(await createKnowledgeSchemaRevisionV1({
    ...base("maturity-descriptor", "The recorded maturity of a scorecard's measurement, such as provisional, calibrated, established or retired. A corpus declares its own instances."),
    kind: "concept", broader: [ref("sponge.core", "concept")],
  }));
  const vetoRule = required(await createKnowledgeSchemaRevisionV1({
    ...base("veto-rule", "A stated rule that disqualifies a source for a purpose regardless of its measured rate, such as undisclosed sponsorship or a retracted record."),
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
    if (predicate.kind !== "predicate") throw new Error(`Expected source-quality predicate ${code}.`);
    predicates.push(predicate);
    return predicate;
  };
  const scorecardSource = await add("scorecard-source", "The source entity this scorecard measures.",
    [scorecard.ref], entityConcepts(ref("sponge.core", "source")));
  const horizonDays = await add("horizon-days", "The evaluation horizon in whole days: the window after which the source's predictions or claims were checked.",
    [scorecard.ref], valueKinds("integer"));
  const hitRate = await add("hit-rate", "The measured hit rate as a decimal between 0 and 1, computed over this scorecard's stated sample only.",
    [scorecard.ref], { kind: "numeric", lowerBound: "0", upperBound: "1", unit: null, v: 1 });
  const observationCount = await add("observation-count", "The number of scored observations behind this scorecard.",
    [scorecard.ref], valueKinds("integer"));
  const preregisteredSample = await add("preregistered-sample", "The sample size committed before scoring. Comparing observation-count with it is the recorded basis for trusting or discounting the rate.",
    [scorecard.ref], valueKinds("integer"));
  const scorecardMaturity = await add("scorecard-maturity", "The maturity-descriptor entity recording this measurement's maturity.",
    [scorecard.ref], entityConcepts(maturity.ref));
  const appliesToDomain = await add("applies-to-domain", "The domain entity this measurement covers. A scorecard measured on one domain does not score the source on another.",
    [scorecard.ref], { concepts: [entity], kind: "entity-concepts", v: 1 });
  const triggeredVeto = await add("triggered-veto", "The veto-rule entity that fired against this scorecard or record. A triggered veto is recorded evidence; it does not delete or rewrite the record.",
    [entity], entityConcepts(vetoRule.ref));
  const vetoRuleText = await add("veto-rule-text", "The stated rule a veto-rule applies.",
    [vetoRule.ref], { kind: "text", languages: null, maximumBytes: 65_536, v: 1 });
  const shape = required(await createKnowledgeExecutableShapeV1({
    appliesToConcepts: [scorecard.ref], closed: false, extends: [], maximumInheritanceDepth: 1,
    rules: [scorecardSource, horizonDays, hitRate, observationCount, preregisteredSample, scorecardMaturity, appliesToDomain]
      .map(predicate => ({ allowedDisclosures: ["private"] as const,
        cardinality: { maximum: null, minimum: predicate === scorecardSource ? 1 : 0, v: 1 as const },
        predicate: predicate.ref, purpose: "private-research",
        range: predicate.range.kind === "entity-concepts" ? valueKinds("entity") : predicate.range,
        requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const }))
      .sort((a, b) => canonical({ predicate: a.predicate, purpose: a.purpose }) < canonical({ predicate: b.predicate, purpose: b.purpose }) ? -1 : 1),
    shape: scorecard.ref, v: 1,
  }));
  const schemas: KnowledgeSchemaRevisionV1[] = [scorecard, maturity, vetoRule, ...predicates];
  return freezeKnowledgeDeclaration(required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256, dependencies: dependencies.map(knowledgeVocabularyPackPinV1),
    display: core.display, examples: [],
    migrationNotes: "Additive measured source scorecards, maturity descriptors and veto rules. Existing V1–V7 declarations and locks remain unchanged. A scorecard carries its own horizon, sample and domain parameters; it does not compute rates, verify pre-registration, select trusted sources or rank sources for any purpose.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1,
    schemas: schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1), shapes: [shape],
    queries: [
      { description: "Declarative join guidance, not an executable query: reverse scorecard-source from a source to its scorecards, and return each card's horizon-days, hit-rate, observation-count, preregistered-sample, scorecard-maturity and applies-to-domain with any triggered-veto. Compare rates only inside one stated horizon and domain.",
        id: "source-scorecards",
        predicates: sortedRefs([scorecardSource.ref, horizonDays.ref, hitRate.ref, observationCount.ref,
          preregisteredSample.ref, scorecardMaturity.ref, appliesToDomain.ref, triggeredVeto.ref]), v: 1 },
    ],
    sources: [{ contentSha256: "5039e9ffe27bf568bde319cc77cecb36fb1ac0440eeaf0bddfcaef1e733bb128", license: "MIT", revision: "2026-09-16",
      uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/source-quality-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  })));
}
