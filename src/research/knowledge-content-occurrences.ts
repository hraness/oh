import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import type { SpongeKnowledgeDomainCatalogV5 } from "./knowledge-domain-catalog-v5";
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
  if (!result.ok) throw new Error(`Invalid content-occurrences pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(text: string) { return [{ language: "en", text, v: 1 }] as const; }
function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function sortedRefs(refs: readonly KnowledgeSchemaRefV1[]): KnowledgeSchemaRefV1[] {
  return [...refs].sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
}

/** Adds source-bound lexical and cultural occurrence paths without revising V1–V5 declarations. */
export async function createSpongeContentOccurrencesPackV1(previous: SpongeKnowledgeDomainCatalogV5): Promise<KnowledgeVocabularyPackManifestV1> {
  const dependencyIds = ["sponge.core", "sponge.culture", "sponge.foundation", "sponge.language", "sponge.reference"];
  const dependencies = dependencyIds.map(packId => {
    const pack = previous.packs.find(item => item.packId === packId);
    if (pack === undefined) throw new Error(`Missing content-occurrences dependency ${packId}.`);
    return pack;
  });
  const ref = (packId: string, code: string): KnowledgeSchemaRefV1 => {
    const schema = dependencies.find(pack => pack.packId === packId)?.schemas.find(item => item.identity.code === code);
    if (schema === undefined) throw new Error(`Missing content-occurrences schema ${packId}/${code}.`);
    return schema.ref;
  };
  const core = previous.corePack;
  const vocabulary = required(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge content occurrences and lexical context"),
    namespace: "sponge.content-occurrences", ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null, revision: 1, state: "private", v: 1,
  }));
  const base = (code: string, definition: string) => ({
    definitions: labels(definition), identity: { code, namespace: vocabulary.namespace, revision: 1, v: 1 as const },
    labels: labels(code.split("-").map(word => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ")),
    previousRevisionSha256: null, reviewDecisionSha256: null, vocabularySha256: vocabulary.revisionSha256, v: 1 as const,
  });
  const version = required(await createKnowledgeSchemaRevisionV1({
    ...base("retained-content-version", "One retained representation of a source, artifact or work, with an explicit digest-bearing media value and containing identity. Source verification and byte retention remain host responsibilities; a mutable URL or retrieval time is not a version."),
    kind: "concept", broader: [ref("sponge.core", "source")],
  }));
  const occurrenceRefs = sortedRefs([
    ref("sponge.language", "text-occurrence"), ref("sponge.culture", "reference-occurrence"), ref("sponge.culture", "depiction"),
  ]);
  const predicates: KnowledgePredicateRevisionV1[] = [];
  const add = async (code: string, description: string, domains: readonly KnowledgeSchemaRefV1[], range: KnowledgeValueRangeV1,
    qualifierPredicates: readonly KnowledgeSchemaRefV1[]) => {
    const result = required(await createKnowledgeSchemaRevisionV1({
      ...base(code, description), kind: "predicate", domainConcepts: sortedRefs(domains), inversePredicate: null,
      qualifierPredicates: sortedRefs(qualifierPredicates), range,
    }));
    if (result.kind !== "predicate") throw new Error(`Expected content-occurrences predicate ${code}.`);
    predicates.push(result);
    return result;
  };
  const entityRange = (...concepts: KnowledgeSchemaRefV1[]): KnowledgeValueRangeV1 => ({ concepts: sortedRefs(concepts), kind: "entity-concepts", v: 1 });
  const locator = await add("source-native-locator", "The source selector preserved verbatim, including its scheme, units and coordinate basis when supplied. As a qualifier on occurrence-in-version it belongs only to that retained version; no selector verification or precision is inferred.",
    occurrenceRefs, { kind: "value-kinds", valueKinds: ["string"], v: 1 }, []);
  const qualifiers = sortedRefs(dependencies.filter(pack => pack.packId === "sponge.reference" || pack.packId === "sponge.foundation")
    .flatMap(pack => pack.schemas).filter(schema => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map(schema => schema.ref));
  const text = ref("sponge.language", "text-occurrence");
  const form = ref("sponge.language", "form");
  const language = ref("sponge.reference", "language-system");
  await add("text-realizes-form", "The written or spoken form realized by this particular text occurrence under attributed evidence; matching spelling does not identify a lexeme or sense.", [text], entityRange(form), qualifiers);
  await add("text-expresses-sense", "The contextual sense attributed to this text occurrence; alternate interpretations may coexist and remain source-scoped.", [text], entityRange(ref("sponge.language", "sense")), qualifiers);
  await add("text-in-language-system", "The language or variety attributed to this occurrence, independently of the form's language and permitting explicitly recorded multilingual use.", [text], entityRange(language), qualifiers);
  await add("form-in-language-system", "The language or variety under which this lexical form is described; this does not normalize spelling, script or pronunciation.", [form], entityRange(language), qualifiers);
  await add("occurrence-in-version", "The retained content version containing this text occurrence, cultural reference or depiction. A source-native-locator qualifier binds its selector to this exact version; containment does not establish interpretation or influence.", occurrenceRefs, entityRange(version.ref), [...qualifiers, locator.ref]);
  const containing = await add("content-version-of", "The source, artifact or work whose representation was retained. The continuing identity remains distinct from its retained bytes and may have multiple versions.", [version.ref], entityRange(ref("sponge.core", "source"), ref("sponge.core", "artifact"), ref("sponge.core", "work")), qualifiers);
  const content = await add("retained-content", "The existing media value naming the host-authorized retention source, exact source SHA-256 and media type, including textual content. Declaring this value does not verify bytes or grant retention or retrieval authority.", [version.ref], { kind: "value-kinds", valueKinds: ["media"], v: 1 }, qualifiers);
  const shape = required(await createKnowledgeExecutableShapeV1({
    appliesToConcepts: [version.ref], closed: false, extends: [], maximumInheritanceDepth: 1,
    rules: [containing, content].map(predicate => ({
      allowedDisclosures: ["private"] as const, cardinality: { maximum: 1, minimum: 1, v: 1 as const },
      // The compiler checks concept subtyping; the shape evaluator checks exact memberships only.
      // Keep this shape's container rule about presence/cardinality without rejecting an article subtype.
      predicate: predicate.ref, purpose: "private-research", range: predicate === containing
        ? { kind: "value-kinds" as const, valueKinds: ["entity"] as const, v: 1 as const } : predicate.range,
      requiredEvidenceBearings: [], severity: "error" as const, v: 1 as const,
    })).sort((a, b) => canonical(a.predicate) < canonical(b.predicate) ? -1 : 1), shape: version.ref, v: 1,
  }));
  return freezeKnowledgeDeclaration(required(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256, dependencies: dependencies.map(knowledgeVocabularyPackPinV1),
    display: core.display, examples: [],
    migrationNotes: "Additive occurrence, form, sense, language and retained-content paths. Published packs and source records remain unchanged. Locators qualify exact occurrence/version statements. Missing context stays unknown; no automatic capture verification, translation equivalence, cultural influence, identity merge or publication authority is implied.",
    packId: vocabulary.namespace, previousManifestSha256: null, revision: 1,
    schemas: [version, ...predicates].sort((a, b) => a.identity.code < b.identity.code ? -1 : 1), shapes: [shape],
    queries: [{ description: "Which form, contextual sense and language are attested by this occurrence, and which exact retained bytes and selector locate the text, allusion or depiction?",
      id: "retained-occurrences", predicates: sortedRefs([...predicates.map(predicate => predicate.ref),
        ref("sponge.culture", "alludes-to"), ref("sponge.culture", "depicts"),
        ref("sponge.core", "about"), ref("sponge.core", "authored-by"), ref("sponge.core", "cites"),
        ref("sponge.reference", "source-context"), ref("sponge.foundation", "version-context"),
      ]), v: 1 }],
    sources: [{ contentSha256: "a9264dbeba17f9675c92ac1a7e2b3b0f7412d3f61b35aae9ed135c9c235591a9", license: "MIT", revision: "2026-09-15",
      uri: "https://github.com/hraness/oh/blob/main/spec/research-v1/content-occurrences-v1.md", v: 1 }],
    supportedCodecs: [], v: 1, vocabulary,
  })));
}
