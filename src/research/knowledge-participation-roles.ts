import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import type { SpongeKnowledgeDomainCatalogV6 } from "./knowledge-domain-catalog-v6";
import {
  createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgePredicateRevisionV1, type KnowledgeSchemaRevisionV1,
} from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult, KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1,
  type KnowledgeVocabularyPackManifestV1,
} from "./knowledge-vocabulary-pack-v1";

function required<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid participation-roles pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}

/** Adds attributed participants, focal subjects and roles without revising V1–V6 declarations. */
export async function createSpongeParticipationRolesPackV1(previous: SpongeKnowledgeDomainCatalogV6): Promise<KnowledgeVocabularyPackManifestV1> {
  const dependencyIds = ["sponge.bridge-relations", "sponge.core", "sponge.foundation", "sponge.organizations", "sponge.reference"];
  const dependencies = dependencyIds.map(packId => {
    const pack = previous.packs.find(item => item.packId === packId);
    if (pack === undefined) throw new Error(`Missing participation-roles dependency ${packId}.`);
    return pack;
  });
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const schema = dependencies.find(pack => pack.packId === packId)?.schemas.find(item => item.identity.code === code);
    if (schema === undefined) throw new Error(`Missing participation-roles schema ${packId}/${code}.`);
    return schema.ref;
  };
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge participation and roles"),
    namespace: "sponge.participation-roles", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
    labels: labels(code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  const participation = required(await createKnowledgeSchemaRevisionV1({
    ...base("participation", "One source-scoped participation or credit, with its participant, exact focal subject, role and dates stated separately. It does not imply employment, legal authority, ownership or completeness."),
    kind: "concept", broader: [ref("sponge.core", "entity")],
  }));
  const role = required(await createKnowledgeSchemaRevisionV1({
    ...base("role-descriptor", "An identified capacity attributed to a participant or organization assignment. Its name and interpretation remain source-scoped; equal labels do not establish equivalent roles or authority."),
    kind: "concept", broader: [ref("sponge.core", "concept")],
  }));
  const qualifiers = sortedRefs(dependencies.filter(pack => pack.packId === "sponge.reference" || pack.packId === "sponge.foundation")
    .flatMap(pack => pack.schemas).filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map(schema => schema.ref));
  const predicates: KnowledgePredicateRevisionV1[] = [];
  const add = async (code: string, definition: string, domains: readonly KnowledgeSchemaRefV1[], target: KnowledgeSchemaRefV1) => {
    const predicate = required(await createKnowledgeSchemaRevisionV1({
      ...base(code, definition), kind: "predicate", domainConcepts: sortedRefs(domains), inversePredicate: null,
      qualifierPredicates: qualifiers, range: { concepts: [target], kind: "entity-concepts", v: 1 },
    }));
    if (predicate.kind !== "predicate") throw new Error(`Expected participation-roles predicate ${code}.`);
    predicates.push(predicate);
    return predicate;
  };
  await add("participant", "The agent named as the participant in this particular participation or credit. Attribution does not establish account control, identity equivalence or employment.", [participation.ref], ref("sponge.core", "agent"));
  await add("participation-in", "The exact focal entity named by this participation, including an event, process, work, recording, edition or organization. The entity range is deliberately broad; no participation transfers to another subject, version or containing work.", [participation.ref], ref("sponge.core", "entity"));
  const assignedRole = await add("assigned-role", "The stated capacity attributed to this participation or existing organization role assignment. Dates, subject, source and contrary claims remain separate; the role alone grants no rights or authority.",
    [participation.ref, ref("sponge.organizations", "role-assignment")], role.ref);
  const shape = required(await createKnowledgeExecutableShapeV1({
    appliesToConcepts: [participation.ref], closed: false, extends: [], maximumInheritanceDepth: 1,
    rules: predicates.map(predicate => ({
      allowedDisclosures: ["private"] as const, cardinality: { maximum: null, minimum: 0, v: 1 as const },
      // V1 shape ranges match exact memberships; the compiler checks inherited agent/entity concepts.
      predicate: predicate.ref, purpose: "private-research", range: predicate === assignedRole ? predicate.range
        : { kind: "value-kinds" as const, valueKinds: ["entity"] as const, v: 1 as const },
      requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const,
    })).sort((a, b) => canonical(a.predicate) < canonical(b.predicate) ? -1 : 1), shape: participation.ref, v: 1,
  }));
  const contextRefs = [ref("sponge.reference", "valid-during"), ref("sponge.reference", "source-context"),
    ref("sponge.foundation", "version-context"), ref("sponge.foundation", "version-of"), ref("sponge.core", "name")];
  const schemas: KnowledgeSchemaRevisionV1[] = [participation, role, ...predicates];
  return freezeKnowledgeDeclaration(required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256, dependencies: dependencies.map(knowledgeVocabularyPackPinV1),
    display: core.display, examples: [],
    migrationNotes: "Additive participation and role descriptions. Existing V1–V6 declarations, organization assignments, assertion semantics and historical locks remain unchanged. Partial records and multiple source-scoped claims are allowed. No identity merge, inherited credit, employment, ownership, completion, current-role selection, context-aware conformance, source verification or publication authority is implied.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1,
    schemas: schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1), shapes: [shape],
    queries: [
      { description: "Declarative join guidance, not an executable query: follow held-by and role-assignment-at-organization from each organization assignment, then assigned-role; retain that assignment's validity, source and version qualifiers and explicitly stated source version-of links. Return separate assignments rather than infer one current role.",
        id: "dated-organization-roles", predicates: sortedRefs([assignedRole.ref, ref("sponge.organizations", "held-by"), ref("sponge.bridge-relations", "role-assignment-at-organization"), ...contextRefs]), v: 1 },
      { description: "Declarative join guidance, not an executable query: reverse participant from an agent, then follow participation-in and assigned-role with validity, source and version qualifiers and explicit version-of links. Return the exact credited subject without transferring the credit to other recordings, editions or works.",
        id: "scoped-credits", predicates: sortedRefs([...predicates.map(predicate => predicate.ref), ...contextRefs]), v: 1 },
    ],
    sources: [{ contentSha256: "be3d0200f1a0fd906ad1a32d5f31443127d0374726a080ccaddd2bedcea000ab", license: "MIT", revision: "2026-09-15",
      uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/participation-roles-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  })));
}
