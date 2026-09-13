import { canonicalJson, type JsonValue } from "./document-domain";
import { sha256Text } from "./integrity-domain";
import { spongeCoreKnowledgeCatalogV1 } from "./knowledge-core-v1";
import { spongeKnowledgeReferenceCatalog } from "./knowledge-reference-catalog";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import {
  createKnowledgeExecutableShapeV1,
  createKnowledgeSchemaRevisionV1,
  createKnowledgeVocabularyRevisionV1,
  type KnowledgeConceptRevisionV1,
  type KnowledgePredicateRevisionV1,
  type KnowledgeSchemaRevisionV1,
  type KnowledgeValueKindV1,
  type KnowledgeVocabularyRevisionV1,
} from "./knowledge-ontology-contract-v1";
import { parseKnowledgeEntityId, type KnowledgeOntologyResult, type KnowledgeSchemaRefV1, type KnowledgeValueV1 } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackManifestV1,
  knowledgeVocabularyPackPinV1,
  resolveKnowledgeVocabularyPacksV1,
  type KnowledgeVocabularyPackLockV1,
  type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";

type ConceptDefinition = readonly [code: string, definition: string, broader: string];
type PredicateDefinition = readonly [code: string, definition: string, domain: string, range: KnowledgeValueKindV1];
type DomainDefinition = Readonly<{
  concepts: readonly ConceptDefinition[];
  id: string;
  predicates: readonly PredicateDefinition[];
  question: string;
}>;

/** Original local application profiles; no upstream ontology release or schema mapping is claimed. */
const definitions = [
  { id: "language", question: "Which forms and contextual meanings belong to this lexeme?", concepts: [
    ["lexeme", "A lexical entry, distinct from its written forms and contextual senses.", "information-resource"],
    ["form", "A written or spoken realization of a lexical entry.", "information-resource"],
    ["sense", "One contextual meaning associated with a lexical entry.", "concept"],
    ["text-occurrence", "A particular usage at a locator in a retained text.", "entity"],
  ], predicates: [
    ["has-form", "Connects a lexical entry to one of its realizations.", "lexeme", "entity"],
    ["has-sense", "Connects a lexical entry to one of its contextual meanings.", "lexeme", "entity"],
    ["translation-of-sense", "Relates contextual meanings under attributed translation evidence.", "sense", "entity"],
    ["attested-in", "Identifies a retained usage that attests a lexical entry.", "lexeme", "entity"],
  ] },
  { id: "culture", question: "Which depictions and naming explanations refer to this motif?", concepts: [
    ["motif", "A recurring cultural subject whose interpretations may differ.", "concept"],
    ["fictional-entity", "An identity situated in a fictional narrative or setting.", "entity"],
    ["depiction", "A particular representation of a subject in an artifact.", "artifact"],
    ["reference-occurrence", "An attributed cultural reference with a particular source location.", "entity"],
  ], predicates: [
    ["depicts", "Identifies the subject represented by a depiction.", "depiction", "entity"],
    ["alludes-to", "Records an attributed indirect reference, distinct from depicted identity.", "reference-occurrence", "entity"],
    ["named-after", "Records a naming explanation requiring its own attributed evidence.", "reference-occurrence", "entity"],
    ["interpreted-as", "Relates a reference to an attributed interpretation.", "reference-occurrence", "entity"],
  ] },
  { id: "natural-world", question: "How was this occurrence classified and observed?", concepts: [
    ["physical-occurrence", "A particular natural occurrence, distinct from its classification.", "event"],
    ["classification-scheme", "A versioned navigational scheme for natural entities and features.", "concept"],
    ["taxon", "A classification unit under an identified biological scheme.", "concept"],
    ["observation", "An attributed observation of a feature under stated conditions.", "event"],
    ["feature", "An observable characteristic distinguished by a classification scheme.", "concept"],
  ], predicates: [
    ["classified-under", "Assigns an occurrence to a class under an explicit scheme.", "physical-occurrence", "entity"],
    ["observes", "Identifies the particular occurrence an observation concerns.", "observation", "entity"],
    ["observed-at", "Locates an observation without implying the location of every similar occurrence.", "observation", "entity"],
    ["has-feature", "Records an attributed feature of an occurrence.", "physical-occurrence", "entity"],
  ] },
  { id: "body", question: "Which experiences, structures and population estimates bear on this phenomenon?", concepts: [
    ["bodily-phenomenon", "A bodily phenomenon independent of any proposed explanation.", "concept"],
    ["anatomical-structure", "A structure identified under an anatomical description.", "entity"],
    ["experience-report", "A person's attributed report, distinct from physiological verification.", "information-resource"],
    ["study-population", "The sampled population to which an estimate applies.", "entity"],
    ["mechanism-hypothesis", "A proposed physiological explanation requiring evidence.", "concept"],
  ], predicates: [
    ["involves-structure", "Relates a phenomenon to a proposed or observed anatomical structure.", "bodily-phenomenon", "entity"],
    ["reports-experience", "Identifies the experience described by an attributed report.", "experience-report", "entity"],
    ["estimates-prevalence", "Records a numeric estimate scoped to its study population.", "study-population", "decimal"],
    ["proposes-mechanism", "Connects a phenomenon to a distinct explanatory hypothesis.", "bodily-phenomenon", "entity"],
  ] },
  { id: "research", question: "What was tested, by which method, and what corrections followed?", concepts: [
    ["publication-version", "One version of a research work, with its own source history.", "source"],
    ["study", "A particular investigation with method and population boundaries.", "process"],
    ["sample", "Material or participants selected under an identified sampling procedure.", "entity"],
    ["method", "A specified procedure for producing or assessing observations.", "information-resource"],
    ["finding", "An attributed research result, distinct from an acceptance decision.", "information-resource"],
    ["correction", "A source-issued correction or retraction notice about a publication version.", "source"],
  ], predicates: [
    ["tests", "Identifies the hypothesis or object a study investigates.", "study", "entity"],
    ["uses-method", "Pins the method under which the study was conducted.", "study", "entity"],
    ["produces-finding", "Relates a study to an attributed finding.", "study", "entity"],
    ["supersedes", "Identifies the exact publication version addressed by a correction.", "correction", "entity"],
  ] },
  { id: "substances", question: "Which batch and sample support this assay and dated offer?", concepts: [
    ["molecular-identity", "A chemical identity including relevant sequence, structure and modification distinctions.", "concept"],
    ["product", "A marketed substance formulation distinct from its physical batches.", "artifact"],
    ["batch", "An identified physical production batch of a product.", "artifact"],
    ["sample", "A particular sample taken from identified material.", "artifact"],
    ["assay", "An analytical activity on a particular sample under a method.", "process"],
    ["offer", "A dated seller offer with its own product, price and territory conditions.", "information-resource"],
  ], predicates: [
    ["sample-of", "Connects a tested sample to the material from which it came.", "sample", "entity"],
    ["batch-of", "Connects an identified batch to a product formulation.", "batch", "entity"],
    ["assays", "Identifies the exact sample tested by an assay.", "assay", "entity"],
    ["offered-by", "Identifies the seller of a dated offer without conferring trust.", "offer", "entity"],
  ] },
  { id: "organizations", question: "Which roles, transactions and completion claims define this history?", concepts: [
    ["legal-entity", "A legal organizational identity under an identified jurisdiction.", "organization"],
    ["brand", "A commercial identity distinct from its legal owner and products.", "concept"],
    ["role-assignment", "An agent's role in an organization during stated conditions or dates.", "entity"],
    ["transaction", "An economic transaction distinct from announcements about it.", "event"],
    ["announcement", "An attributed public announcement about a proposed or completed event.", "information-resource"],
    ["completion", "A reported completion event with separately attributable evidence.", "event"],
  ], predicates: [
    ["operates", "Relates a legal entity to a product or brand it operates.", "legal-entity", "entity"],
    ["held-by", "Identifies the agent occupying a dated role assignment.", "role-assignment", "entity"],
    ["announces", "Identifies an event mentioned by an announcement without asserting completion.", "announcement", "entity"],
    ["completes", "Identifies the transaction a reported completion concerns.", "completion", "entity"],
  ] },
  { id: "editorial", question: "Which stories report this event and why were they placed prominently?", concepts: [
    ["event-series", "A collection of related events under a stated organizing basis.", "entity"],
    ["article", "A particular editorial source distinct from its reported events.", "source"],
    ["story-cluster", "A navigational grouping of reports under an explicit grouping policy.", "concept"],
    ["edition", "A dated editorial selection distinct from graph acceptance or publication authority.", "work"],
    ["placement", "An article's location in one editorial edition.", "entity"],
    ["ranking-assessment", "An attributed assessment explaining editorial prominence.", "information-resource"],
  ], predicates: [
    ["reports-on", "Identifies an event discussed in an article.", "article", "entity"],
    ["contains-placement", "Connects an edition to one of its placements.", "edition", "entity"],
    ["ranks-under", "Connects a placement to the assessment that explains its prominence.", "placement", "entity"],
    ["updates", "Identifies an earlier article that a report updates.", "article", "entity"],
  ] },
  { id: "software", question: "Which protocol and configuration make these evaluation results comparable?", concepts: [
    ["repository", "A software source repository distinct from its commits and releases.", "information-resource"],
    ["release", "An identified release of software or a model.", "artifact"],
    ["model-version", "An exact model version distinct from a marketing family name.", "artifact"],
    ["configuration", "A pinned runtime and tool configuration.", "information-resource"],
    ["dataset-version", "An identified dataset revision with its own split and provenance.", "artifact"],
    ["benchmark-protocol", "A specified evaluation protocol with scope and metric definitions.", "information-resource"],
    ["run", "One observed execution under a configuration and protocol.", "process"],
    ["measurement", "A measured result with method, units and conditions supplied separately.", "information-resource"],
  ], predicates: [
    ["evaluated-under", "Pins the benchmark protocol for one run.", "run", "entity"],
    ["uses-configuration", "Pins the runtime configuration for one run.", "run", "entity"],
    ["uses-dataset", "Pins the dataset version for one run.", "run", "entity"],
    ["produces", "Connects a run to a measured result or output artifact.", "run", "entity"],
  ] },
  { id: "music", question: "Which work, performance and recording produced this released track?", concepts: [
    ["musical-work", "A composition distinct from arrangements, performances and recordings.", "work"],
    ["arrangement", "An arrangement of a musical work.", "work"],
    ["performance", "One performance of a work or arrangement.", "event"],
    ["recording", "An audio recording identity distinct from its release placements.", "artifact"],
    ["release", "An issued music release containing tracks.", "artifact"],
    ["track", "A recording's placement on a particular release.", "entity"],
    ["similarity-assessment", "A dated similarity assessment under a stated listening or computational method.", "information-resource"],
  ], predicates: [
    ["performs", "Identifies the work or arrangement performed.", "performance", "entity"],
    ["records", "Identifies the performance captured by a recording.", "recording", "entity"],
    ["appears-on", "Identifies the release containing a track.", "track", "entity"],
    ["similar-under", "Identifies a method-specific comparison without asserting influence or rights.", "similarity-assessment", "entity"],
  ] },
  { id: "people", question: "Which dated source records support this profile within its authorized purpose?", concepts: [
    ["public-profile-document", "An attributed public profile source, distinct from the person it describes.", "source"],
    ["source-contact-record", "A source-owned contact record whose sensitive payload needs a deletable retention store.", "information-resource"],
    ["interaction", "An interaction with separately governed access and retention.", "event"],
    ["relationship-account", "An attributed account of a relationship, distinct from intrinsic personal properties.", "information-resource"],
    ["profile-projection", "A dated, scoped selection of profile knowledge and uncertainty.", "information-resource"],
  ], predicates: [
    ["describes-person", "Identifies the person a profile source describes without merging source identities.", "public-profile-document", "entity"],
    ["derived-from-record", "Identifies a source record used by a purpose-bound profile projection.", "profile-projection", "entity"],
    ["involves-person", "Identifies a participant under the interaction's authorization boundary.", "interaction", "entity"],
    ["accounts-for", "Identifies a relationship described by an attributed account.", "relationship-account", "entity"],
  ] },
  { id: "finance", question: "Which instrument, listing and backtest assumptions define this comparison?", concepts: [
    ["issuer", "An entity issuing a financial instrument.", "organization"],
    ["instrument", "A financial instrument distinct from its exchange listings.", "entity"],
    ["listing", "An instrument's listing at a venue under dated conditions.", "entity"],
    ["ticker-assignment", "A dated ticker assignment to a listing, without assuming global permanence.", "entity"],
    ["strategy-version", "A specified strategy hypothesis distinct from future outcome claims.", "information-resource"],
    ["backtest-run", "A historical simulation under identified data, period, costs and assumptions.", "process"],
  ], predicates: [
    ["issued-by", "Identifies the issuer of an instrument.", "instrument", "entity"],
    ["lists-instrument", "Identifies the instrument associated with a venue listing.", "listing", "entity"],
    ["tests-strategy", "Pins the strategy version tested by a historical run.", "backtest-run", "entity"],
    ["uses-dataset", "Pins the data artifact used by a backtest.", "backtest-run", "entity"],
  ] },
  { id: "formal-systems", question: "Which rule, initial state and proof artifact support this result?", concepts: [
    ["conjecture", "A formal claim whose proof status is attributed separately.", "concept"],
    ["proof-artifact", "An inspectable proof artifact under a specified formal system.", "artifact"],
    ["rule-set-version", "An identified set of transition rules.", "information-resource"],
    ["initial-state", "An exact initial state of a formal or artificial-life system.", "artifact"],
    ["simulation", "An execution under rules, topology, initial state and seed.", "process"],
    ["state-snapshot", "A recorded state at a particular simulation tick.", "artifact"],
  ], predicates: [
    ["instantiates", "Pins the rule-set version used by a simulation.", "simulation", "entity"],
    ["starts-from", "Pins a simulation's initial state.", "simulation", "entity"],
    ["observed-at-tick", "Records the exact discrete tick associated with a state snapshot.", "state-snapshot", "integer"],
    ["has-proof", "Connects a formal claim to a proof artifact without asserting unchecked validity.", "conjecture", "entity"],
  ] },
  { id: "agent-work", question: "Which attempts and checks produced a resumable verified outcome?", concepts: [
    ["goal", "A desired outcome distinct from the actions intended to achieve it.", "concept"],
    ["task", "A bounded unit of work associated with a goal.", "entity"],
    ["skill-version", "A pinned reusable instruction or workflow artifact.", "information-resource"],
    ["trajectory", "An observable execution record without private chain-of-thought requirements.", "information-resource"],
    ["attempt", "One execution attempt with inputs, observations and completion state.", "process"],
    ["check-result", "An observed validation result tied to an exact output and validator.", "information-resource"],
  ], predicates: [
    ["uses-skill", "Pins a skill version used during an attempt.", "attempt", "entity"],
    ["attempts", "Identifies the task an execution attempt addresses.", "attempt", "entity"],
    ["produces", "Identifies an output artifact produced by an attempt.", "attempt", "entity"],
    ["validated-by", "Connects an attempt to an observed check result without inferring universal correctness.", "attempt", "entity"],
  ] },
] as const satisfies readonly DomainDefinition[];

export const SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS = Object.freeze(definitions.map((definition) => `sponge.${definition.id}`));
export type SpongeKnowledgeDomainCatalog = Readonly<{
  corePack: KnowledgeVocabularyPackManifestV1;
  lock: KnowledgeVocabularyPackLockV1;
  /** Available builtin definitions, not an assertion of installation in a knowledge space. */
  packs: readonly KnowledgeVocabularyPackManifestV1[];
  referencePack: KnowledgeVocabularyPackManifestV1;
  schemas: readonly KnowledgeSchemaRevisionV1[];
  vocabularies: readonly KnowledgeVocabularyRevisionV1[];
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
let catalogPromise: Promise<SpongeKnowledgeDomainCatalog> | undefined;
export function spongeKnowledgeDomainCatalog(): Promise<SpongeKnowledgeDomainCatalog> {
  catalogPromise ??= buildCatalog();
  return catalogPromise;
}

/** Exact digest-bound lookup; display labels and unqualified codes cannot resolve schema identity. */
export function knowledgeDomainSchemaByRef(catalog: SpongeKnowledgeDomainCatalog, ref: KnowledgeSchemaRefV1): KnowledgeSchemaRevisionV1 | null {
  return catalog.schemas.find((schema) => schema.ref.namespace === ref.namespace
    && schema.ref.code === ref.code && schema.ref.revision === ref.revision
    && schema.ref.schemaSha256 === ref.schemaSha256 && ref.v === 1) ?? null;
}
async function buildCatalog(): Promise<SpongeKnowledgeDomainCatalog> {
  const core = await spongeCoreKnowledgeCatalogV1();
  const ownerEntityId = core.vocabulary.ownerEntityId;
  const base = {
    canonicalizerSha256: core.canonicalizerSha256,
    display: { labelPredicates: [mustSchema(core.schemas, "name").ref], v: 1 },
    examples: [], migrationNotes: "Initial additive application profile. Existing records retain their meanings; installation and publication require separate authorization.",
    previousManifestSha256: null, queries: [], revision: 1, shapes: [], sources: [], supportedCodecs: [], v: 1,
  } as const;
  const { corePack, referencePack } = await spongeKnowledgeReferenceCatalog();
  const qualifierPredicates = referencePack.schemas.filter(schema => schema.kind === "predicate")
    .map(predicate => predicate.ref).sort((left, right) => canonicalJson(left as unknown as JsonValue) < canonicalJson(right as unknown as JsonValue) ? -1 : 1);
  const packs: KnowledgeVocabularyPackManifestV1[] = [corePack, referencePack];
  for (const definition of definitions) {
    const namespace = `sponge.${definition.id}`;
    const vocabulary = unwrap(await createKnowledgeVocabularyRevisionV1({ canonicalizerSha256: core.canonicalizerSha256, labels: labels(`Sponge ${title(definition.id)} vocabulary`), namespace, ownerEntityId, previousRevisionSha256: null, revision: 1, state: "private", v: 1 }));
    const concepts: KnowledgeConceptRevisionV1[] = [];
    const predicates: KnowledgePredicateRevisionV1[] = [];
    for (const [code, description, broader] of definition.concepts) {
      const concept = unwrap(await createKnowledgeSchemaRevisionV1({ broader: [mustSchema(core.schemas, broader).ref], definitions: labels(description), identity: { code, namespace, revision: 1, v: 1 }, kind: "concept", labels: labels(title(code)), previousRevisionSha256: null, reviewDecisionSha256: null, v: 1, vocabularySha256: vocabulary.revisionSha256 }));
      if (concept.kind !== "concept") throw new Error("Expected concept.");
      concepts.push(concept);
    }
    for (const [code, description, domain, valueKind] of definition.predicates) {
      const predicate = unwrap(await createKnowledgeSchemaRevisionV1({ definitions: labels(description), domainConcepts: [mustSchema(concepts, domain).ref], identity: { code, namespace, revision: 1, v: 1 }, inversePredicate: null, kind: "predicate", labels: labels(title(code)), previousRevisionSha256: null, qualifierPredicates, range: { kind: "value-kinds", v: 1, valueKinds: [valueKind] }, reviewDecisionSha256: null, v: 1, vocabularySha256: vocabulary.revisionSha256 }));
      if (predicate.kind !== "predicate") throw new Error("Expected predicate.");
      predicates.push(predicate);
    }
    const primary = predicates[0];
    if (primary === undefined) throw new Error("Missing profile predicate.");
    const shape = unwrap(await createKnowledgeExecutableShapeV1({ appliesToConcepts: primary.domainConcepts, closed: false, extends: [], maximumInheritanceDepth: 1, rules: [{ allowedDisclosures: ["private"], cardinality: { maximum: null, minimum: 1, v: 1 }, predicate: primary.ref, purpose: "private-research", range: primary.range, requiredEvidenceBearings: [], severity: "error", v: 1 }], shape: primary.domainConcepts[0] as KnowledgeSchemaRefV1, v: 1 }));
    const entityId = parseKnowledgeEntityId(`kent_${"e".repeat(24)}`);
    if (entityId === null) throw new Error("Invalid example identity.");
    const object: KnowledgeValueV1 = { entityId, kind: "entity", v: 1 };
    const sourceSha256 = await sha256Text(canonicalJson(definition as unknown as JsonValue));
    packs.push(unwrap(await createKnowledgeVocabularyPackManifestV1({ ...base, dependencies: [knowledgeVocabularyPackPinV1(corePack), knowledgeVocabularyPackPinV1(referencePack)], examples: [{ description: `Synthetic structural example: ${definition.question} The example identity makes no real-world factual assertion.`, id: "first-relation", object, predicate: primary.ref, subjectConcept: primary.domainConcepts[0], v: 1 }], packId: namespace, queries: [{ description: definition.question, id: "first-question", predicates: predicates.map((predicate) => predicate.ref).sort((left, right) => canonicalJson(left as unknown as JsonValue) < canonicalJson(right as unknown as JsonValue) ? -1 : 1), v: 1 }], schemas: sortSchemas([...concepts, ...predicates]), shapes: [shape], sources: [{ contentSha256: sourceSha256, license: "MIT", revision: "1", uri: `urn:sponge:application-profile:${definition.id}`, v: 1 }], vocabulary })));
  }
  packs.sort((left, right) => left.packId < right.packId ? -1 : 1);
  const resolved = unwrap(await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots: packs.filter((pack) => SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS.includes(pack.packId)).map(knowledgeVocabularyPackPinV1) }));
  return freezeKnowledgeDeclaration({ corePack, lock: resolved.lock, packs, referencePack, schemas: packs.flatMap((pack) => pack.schemas), vocabularies: packs.map((pack) => pack.vocabulary) });
}
