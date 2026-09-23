import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import type { SpongeKnowledgeDomainCatalogV7 } from "./knowledge-domain-catalog-v7";
import {
  createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgeExecutableShapeV1, type KnowledgePredicateRevisionV1, type KnowledgeSchemaRevisionV1,
  type KnowledgeValueKindV1, type KnowledgeValueRangeV1,
} from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult, KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";

function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid research-ops pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}

/** Declared monitors, append-only run ledgers, rejection records, review events and publication policies. */
export async function createSpongeResearchOpsPackV1(
  previous: SpongeKnowledgeDomainCatalogV7,
  temporalRolesPack: KnowledgeVocabularyPackManifestV1,
): Promise<KnowledgeVocabularyPackManifestV1> {
  const dependencyIds = ["sponge.core", "sponge.foundation", "sponge.reference"];
  const dependencies = dependencyIds.map(packId => {
    const pack = previous.packs.find(item => item.packId === packId);
    if (pack === undefined) throw new Error(`Missing research-ops dependency ${packId}.`);
    return pack;
  });
  const allDependencies = [...dependencies, temporalRolesPack];
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const schema = allDependencies.find(pack => pack.packId === packId)?.schemas.find(item => item.identity.code === code);
    if (schema === undefined) throw new Error(`Missing research-ops schema ${packId}/${code}.`);
    return schema.ref;
  };
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge research operations"),
    namespace: "sponge.research-ops", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
    labels: labels(code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  const entity = ref("sponge.core", "entity");
  const entityRange = { concepts: [entity], kind: "entity-concepts", v: 1 } as const;
  const entityConcepts = (...targets: KnowledgeSchemaRefV1[]): KnowledgeValueRangeV1 =>
    ({ concepts: sortedRefs(targets), kind: "entity-concepts", v: 1 });
  const valueKinds = (...kinds: KnowledgeValueKindV1[]): KnowledgeValueRangeV1 =>
    ({ kind: "value-kinds", valueKinds: [...kinds].sort(), v: 1 });
  const textRange = { kind: "text", languages: null, maximumBytes: 65_536, v: 1 } as const;
  const monitor = required(await createKnowledgeSchemaRevisionV1({
    ...base("research-monitor", "A declared bounded input a corpus checks on a stated cadence, such as a watched source or venue. Declaring a monitor does not schedule or run it."),
    kind: "concept", broader: [ref("sponge.core", "information-resource")],
  }));
  const run = required(await createKnowledgeSchemaRevisionV1({
    ...base("monitor-run", "One recorded execution of a monitor or a declared manual sweep. Runs are append-only ledger entries; a later run adds to the ledger rather than rewriting it."),
    kind: "concept", broader: [ref("sponge.core", "process")],
  }));
  const rejection = required(await createKnowledgeSchemaRevisionV1({
    ...base("rejection-record", "A recorded decision not to admit a candidate in a run, with its stated reason. Rejection records preserve disagreement and refusal; they are not errors."),
    kind: "concept", broader: [ref("sponge.core", "information-resource")],
  }));
  const review = required(await createKnowledgeSchemaRevisionV1({
    ...base("review-event", "One recorded review decision about an entity. The review's times stay under temporal roles; the outcome stays a descriptor entity."),
    kind: "concept", broader: [ref("sponge.core", "event")],
  }));
  const policy = required(await createKnowledgeSchemaRevisionV1({
    ...base("publication-policy", "A stated policy governing which record classes may be published automatically, which require review, and which are never publishable. The record is the policy, not its enforcement."),
    kind: "concept", broader: [ref("sponge.core", "information-resource")],
  }));
  const outcome = required(await createKnowledgeSchemaRevisionV1({
    ...base("review-outcome-descriptor", "A recorded review outcome a corpus declares, such as admitted, rejected, deferred or escalated."),
    kind: "concept", broader: [ref("sponge.core", "concept")],
  }));
  const policyClass = required(await createKnowledgeSchemaRevisionV1({
    ...base("policy-class-descriptor", "A publication class a policy declares, such as auto-publishable, review-required or not-publishable."),
    kind: "concept", broader: [ref("sponge.core", "concept")],
  }));
  const qualifiers = sortedRefs(allDependencies.filter(pack => pack.packId === "sponge.reference"
      || pack.packId === "sponge.foundation" || pack.packId === "sponge.temporal-roles")
    .flatMap(pack => pack.schemas)
    .filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0)
    .map(schema => schema.ref));
  const predicates: KnowledgePredicateRevisionV1[] = [];
  const add = async (code: string, definition: string, domains: readonly KnowledgeSchemaRefV1[], range: KnowledgeValueRangeV1) => {
    const predicate = required(await createKnowledgeSchemaRevisionV1({
      ...base(code, definition), kind: "predicate", domainConcepts: sortedRefs(domains), inversePredicate: null,
      qualifierPredicates: qualifiers, range,
    }));
    if (predicate.kind !== "predicate") throw new Error(`Expected research-ops predicate ${code}.`);
    predicates.push(predicate);
    return predicate;
  };
  const monitorsInquiry = await add("monitors-inquiry", "The inquiry this monitor watches for.",
    [monitor.ref], entityConcepts(ref("sponge.core", "inquiry")));
  const monitorTarget = await add("monitor-target", "The source or venue entity this monitor checks.",
    [monitor.ref], entityRange);
  const monitorCadenceDays = await add("monitor-cadence-days", "The stated check cadence in whole days. The cadence is declared, not scheduled.",
    [monitor.ref], valueKinds("integer"));
  const monitorStatus = await add("monitor-status", "The recorded monitor status: active, paused or retired.",
    [monitor.ref], { kind: "enum", values: ["active", "paused", "retired"].map(value => ({ kind: "string" as const, value, v: 1 as const })), v: 1 });
  const runOfMonitor = await add("run-of-monitor", "The monitor this run executed. A run without a monitor is a declared manual sweep.",
    [run.ref], entityConcepts(monitor.ref));
  const runScope = await add("run-scope", "The declared scope of this sweep: what the run actually covered.",
    [run.ref], textRange);
  const admittedInRun = await add("admitted-in-run", "An entity this run admitted. Recorded admission is evidence about a decision, not authority over the admitted content.",
    [run.ref], entityRange);
  const rejectedInRun = await add("rejected-in-run", "The run this rejection decision belongs to.",
    [rejection.ref], entityConcepts(run.ref));
  const rejectionOf = await add("rejection-of", "The candidate entity this rejection declined to admit.",
    [rejection.ref], entityRange);
  const rejectionReason = await add("rejection-reason", "The stated reason the candidate was not admitted.",
    [rejection.ref], textRange);
  const reviewOf = await add("review-of", "The entity this review event decided about.",
    [review.ref], entityRange);
  const reviewOutcome = await add("review-outcome", "The review-outcome-descriptor entity naming this review's recorded outcome.",
    [review.ref], entityConcepts(outcome.ref));
  const policyClassPredicate = await add("policy-class", "The policy-class-descriptor entity naming the publication class this policy assigns.",
    [policy.ref], entityConcepts(policyClass.ref));
  const policyAppliesTo = await add("policy-applies-to", "The stratum, grade descriptor or record class entity this policy governs.",
    [policy.ref], entityRange);
  const reassessmentWindowDays = await add("reassessment-window-days", "The stated reassessment window in whole days. Records governed by the class must be reassessed within it; the window is declared, not enforced.",
    [policy.ref], valueKinds("integer"));
  const policyReference = await add("policy-reference", "A URI for the governing policy document this record cites.",
    [policy.ref], valueKinds("uri"));
  const shapeFor = async (conceptRef: KnowledgeSchemaRefV1, requiredCodes: readonly string[]) => required(await createKnowledgeExecutableShapeV1({
    appliesToConcepts: [conceptRef], closed: false, extends: [], maximumInheritanceDepth: 1,
    rules: predicates.filter(predicate => predicate.domainConcepts.some(domain => canonical(domain) === canonical(conceptRef)))
      .map(predicate => ({ allowedDisclosures: ["private"] as const,
        cardinality: { maximum: null, minimum: requiredCodes.includes(predicate.identity.code) ? 1 : 0, v: 1 as const },
        predicate: predicate.ref, purpose: "private-research",
        range: predicate.range.kind === "entity-concepts" ? valueKinds("entity") : predicate.range,
        requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const }))
      .sort((a, b) => canonical({ predicate: a.predicate, purpose: a.purpose }) < canonical({ predicate: b.predicate, purpose: b.purpose }) ? -1 : 1),
    shape: conceptRef, v: 1,
  }));
  const shapes: KnowledgeExecutableShapeV1[] = [
    await shapeFor(monitor.ref, []),
    await shapeFor(run.ref, []),
    await shapeFor(rejection.ref, ["rejected-in-run", "rejection-of", "rejection-reason"]),
    await shapeFor(review.ref, ["review-of", "review-outcome"]),
    await shapeFor(policy.ref, []),
  ].sort((a, b) => a.shape.code < b.shape.code ? -1 : 1);
  const schemas: KnowledgeSchemaRevisionV1[] = [monitor, run, rejection, review, policy, outcome, policyClass, ...predicates];
  return freezeKnowledgeDeclaration(required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256,
    dependencies: allDependencies.map(knowledgeVocabularyPackPinV1),
    display: core.display, examples: [],
    migrationNotes: "Additive declared monitors, append-only run ledgers, rejection records, review events and publication policies. Existing V1–V7 declarations and locks remain unchanged. These records describe what a corpus declared and decided; they do not run monitors, enforce cadences or deadlines, grant publication authority, or delete rejected candidates and refuted records.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1,
    schemas: schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1), shapes,
    queries: [
      { description: "Declarative join guidance, not an executable query: from a monitor follow monitors-inquiry, monitor-target, monitor-cadence-days and monitor-status, then run-of-monitor to each run. For each run return run-scope, admitted-in-run and every rejection-record reached through rejected-in-run with its rejection-of and rejection-reason. Runs are append-only; return all of them rather than collapsing to a latest state.",
        id: "monitor-ledger",
        predicates: sortedRefs([monitorsInquiry.ref, monitorTarget.ref, monitorCadenceDays.ref, monitorStatus.ref,
          runOfMonitor.ref, runScope.ref, admittedInRun.ref, rejectedInRun.ref, rejectionOf.ref, rejectionReason.ref]), v: 1 },
      { description: "Declarative join guidance, not an executable query: from a governed record follow review-of in reverse to its review events with review-outcome, and read its policy through policy-applies-to, policy-class and reassessment-window-days. Carry temporal reviewed-at and reassess-by roles where recorded. A review event records a decision; it does not grant publication.",
        id: "review-and-policy",
        predicates: sortedRefs([reviewOf.ref, reviewOutcome.ref, policyClassPredicate.ref, policyAppliesTo.ref,
          reassessmentWindowDays.ref, policyReference.ref,
          ref("sponge.temporal-roles", "reviewed-at"), ref("sponge.temporal-roles", "reassess-by")]), v: 1 },
    ],
    sources: [{ contentSha256: "1501985d78ba233a7d1d4003a3d70be04ffd4b96df654a019619cedc7c89d20b", license: "MIT", revision: "2026-09-16",
      uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/research-ops-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  })));
}
