import { canonicalJson, type JsonValue } from "./document-domain";
import type { SpongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
import {
  createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgeSchemaRevisionV1, type KnowledgeValueRangeV1,
} from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult, KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";

type ConceptCode = `${string}/${string}`;
type PredicateDefinition = readonly [code: string, definition: string, domains: readonly ConceptCode[], ranges: readonly ConceptCode[] | "string"];
const namespace = "sponge.measurement-results";
const concepts = [
  ["metric-definition", "An identified definition of the quantity or score being reported, including its population, denominator, aggregation and direction where stated. Different definitions remain distinct even when their labels match."],
  ["dataset-split", "An identified selection within an exact dataset version. Its source-native selector, membership and intended use remain explicit; a shared split label does not prove identical examples or freedom from contamination."],
] as const;
const definitions: readonly PredicateDefinition[] = [
  ["software-result-measurement", "Connects a software result record to the foundation measurement that describes its quantity and context. The records retain separate identities; neither concept becomes a subtype of the other.", ["software/measurement"], ["foundation/measurement"]],
  ["measurement-model-version", "Identifies the exact model version evaluated for this measurement. A family name, routing alias or another run's model is insufficient to establish this relation.", ["foundation/measurement"], ["software/model-version"]],
  ["measurement-metric", "Identifies the metric definition used to interpret this measurement. Equal units or labels do not establish equal metrics or comparable results.", ["foundation/measurement"], ["measurement-results/metric-definition"]],
  ["metric-definition-text", "Retains the attributed definition of a metric, including the stated denominator, aggregation, direction and evaluation scope. Omitted details remain unknown.", ["measurement-results/metric-definition"], "string"],
  ["measurement-dataset-split", "Identifies the dataset selection used for this particular measurement; a run may report measurements from different selections.", ["foundation/measurement"], ["measurement-results/dataset-split"]],
  ["split-of-dataset-version", "Pins the exact dataset version containing this selection. Split names do not identify a dataset version independently.", ["measurement-results/dataset-split"], ["software/dataset-version"]],
  ["split-selector", "Retains a source-native split selector or membership description interpreted only within its exact dataset version. It does not assert complete membership, disjointness or absence of training leakage.", ["measurement-results/dataset-split"], "string"],
  ["definition-evidence", "Connects a metric definition or dataset selection to its attributed evidence item or bundle. Evidence identity and source version remain separately inspectable.", ["measurement-results/metric-definition", "measurement-results/dataset-split"], ["identity-context/evidence-item", "identity-context/evidence-bundle"]],
  ["observation-has-measurement", "Connects an observation to a measurement it reports; the observation, observed occurrence and measurement remain distinct records.", ["natural-world/observation"], ["foundation/measurement"]],
  ["finding-has-measurement", "Connects a research finding to a measurement it reports. This does not establish clinical significance, validity, replication or a causal conclusion.", ["research/finding"], ["foundation/measurement"]],
  ["backtest-has-measurement", "Connects a historical backtest to a measurement it reports under its stated data, period, costs and assumptions. This does not predict live performance or investment suitability.", ["finance/backtest-run"], ["foundation/measurement"]],
  ["measurement-at-location", "Identifies the place associated with this measurement. Its role, coordinate reference and reference surface require their own context; it is not the location of every similar observation.", ["foundation/measurement"], ["core/place"]],
  ["measurement-evidence", "Connects a measurement to its attributed evidence item or bundle. Support does not imply accuracy, authority or completeness.", ["foundation/measurement"], ["identity-context/evidence-item", "identity-context/evidence-bundle"]],
  ["measurement-feature", "Identifies the natural feature quantified by this measurement, such as cloud-base altitude. A feature label alone does not supply a method or a reference surface.", ["foundation/measurement"], ["natural-world/feature"]],
];

const dependencyIds = ["sponge.core", "sponge.finance", "sponge.foundation", "sponge.identity-context", "sponge.natural-world", "sponge.reference", "sponge.research", "sponge.software"];
const labels = (text: string) => [{ language: "en", text, v: 1 }] as const;
const title = (code: string) => code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ");
const canonical = (value: unknown) => canonicalJson(value as JsonValue);
const sortedRefs = (refs: readonly KnowledgeSchemaRefV1[]) => [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid measurement-results pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}

/** Adds measurement joins while retaining every published catalog declaration. */
export async function createSpongeMeasurementResultsPackV1(previous: SpongeKnowledgeDomainCatalogV5): Promise<KnowledgeVocabularyPackManifestV1> {
  const core = previous.corePack;
  const schemas: KnowledgeSchemaRevisionV1[] = [];
  function ref(identity: ConceptCode): KnowledgeSchemaRefV1 {
    const [packCode, code] = identity.split("/");
    const packId = `sponge.${packCode}`;
    const found = (packId === namespace ? schemas : previous.packs.find(pack => pack.packId === packId)?.schemas)
      ?.find(item => item.identity.code === code);
    if (found === undefined) throw new Error(`Missing measurement-results schema ${identity}.`);
    return found.ref;
  }
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge measurement results"), namespace,
    ownerEntityId: core.vocabulary.ownerEntityId, previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace, revision: 1, v: 1 as const }, labels: labels(title(code)),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  for (const [code, definition] of concepts) schemas.push(required(await createKnowledgeSchemaRevisionV1({
    ...base(code, definition), kind: "concept", broader: [ref("core/information-resource")],
  })));
  const qualifierPredicates = sortedRefs([...previous.referencePack.schemas, ...previous.foundationPack.schemas]
    .filter(item => item.kind === "predicate" && item.qualifierPredicates.length === 0).map(item => item.ref));
  for (const [code, definition, domains, ranges] of definitions) {
    const range: KnowledgeValueRangeV1 = ranges === "string" ? { kind: "value-kinds", valueKinds: ["string"], v: 1 }
      : { concepts: sortedRefs(ranges.map(ref)), kind: "entity-concepts", v: 1 };
    schemas.push(required(await createKnowledgeSchemaRevisionV1({ ...base(code, definition), kind: "predicate",
      domainConcepts: sortedRefs(domains.map(ref)), inversePredicate: null, qualifierPredicates, range,
    })));
  }
  const shapes = await Promise.all(concepts.map(async ([code]) => {
    const concept = ref(`measurement-results/${code}`);
    const rules = schemas.filter(item => item.kind === "predicate" && item.domainConcepts.some(domain => canonical(domain) === canonical(concept)))
      .map(item => {
        if (item.kind !== "predicate") throw new Error("Expected measurement-results predicate.");
        return { allowedDisclosures: ["private"] as const, cardinality: { maximum: null, minimum: 0, v: 1 as const },
          predicate: item.ref, purpose: "private-research", range: item.range, requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const };
      }).sort((a, b) => canonical(a.predicate) < canonical(b.predicate) ? -1 : 1);
    return required(await createKnowledgeExecutableShapeV1({ appliesToConcepts: [concept], closed: false, extends: [],
      maximumInheritanceDepth: 1, rules, shape: concept, v: 1 }));
  }));
  const query = (id: string, description: string, predicates: readonly ConceptCode[]) => ({ id, description, predicates: sortedRefs(predicates.map(ref)), v: 1 as const });
  const contextPredicates: readonly ConceptCode[] = ["foundation/measurement-of", "foundation/measurement-method", "foundation/measured-at", "foundation/normalized-quantity",
    "measurement-results/measurement-metric", "measurement-results/metric-definition-text", "measurement-results/definition-evidence", "measurement-results/measurement-evidence",
    "identity-context/contains-evidence", "identity-context/evidence-source", "identity-context/evidence-excerpt", "identity-context/captured-at", "foundation/version-context"];
  return required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256,
    dependencies: dependencyIds.map(id => {
      const pack = previous.packs.find(item => item.packId === id);
      if (pack === undefined) throw new Error(`Missing measurement-results dependency ${id}.`);
      return knowledgeVocabularyPackPinV1(pack);
    }),
    display: core.display, examples: [],
    migrationNotes: "Additive measurement joins reuse foundation quantities, methods and times. Software result records retain their existing types and identities. Metric, model, split, source, scope and method context are explicit; no conversion, comparability, leaderboard ranking, clinical conclusion, investment suitability or complete description is inferred. Installation and proposal review remain required.",
    packId: namespace, previousManifestSha256: null, revision: 1,
    queries: [
      query("benchmark-score", "Retrieve a run's software result, foundation quantity, exact model, metric definition, dataset split, protocol and retained evidence. Context joins describe the score; they do not prove comparability.", [
        ...contextPredicates, "software/produces", "software/evaluated-under", "software/uses-configuration", "software/uses-dataset",
        "measurement-results/software-result-measurement", "measurement-results/measurement-model-version", "measurement-results/measurement-dataset-split", "measurement-results/split-of-dataset-version", "measurement-results/split-selector",
      ]),
      query("cloud-observation", "Retrieve an observed cloud's feature quantity with units, measurement time, place, method, reference-surface context and retained evidence.", [
        ...contextPredicates, "natural-world/observes", "natural-world/observed-at", "measurement-results/observation-has-measurement", "measurement-results/measurement-feature", "measurement-results/measurement-at-location", "foundation/scope-context", "foundation/normalized-location",
      ]),
      query("research-and-backtest-results", "Retrieve the quantities reported by findings or backtests with independently stated metric, subject, method, time and evidence; preserve the study, strategy and dataset joins.", [
        ...contextPredicates, "research/produces-finding", "research/uses-method", "finance/tests-strategy", "finance/uses-dataset", "measurement-results/finding-has-measurement", "measurement-results/backtest-has-measurement",
      ]),
    ],
    schemas: schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1), shapes: shapes.sort((a, b) => a.shape.code < b.shape.code ? -1 : 1),
    sources: [{ contentSha256: "c0b54b80818fb916aeb9b9a4021dc3d1e8900837b08c2f147452afa24f82fc52", license: "MIT", revision: "2026-09-15", uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/measurement-results-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  }));
}
