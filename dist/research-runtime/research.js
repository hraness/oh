import {
  OH_RESEARCH_PACKET_LIMITS_V1,
  OH_RESEARCH_PACKET_PROFILE_V1,
  SPONGE_CANONICAL_INSTANT_PATTERN,
  SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1,
  SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1,
  SPONGE_KNOWLEDGE_ASSERTION_STATES_V1,
  SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1,
  SPONGE_KNOWLEDGE_DISCLOSURES_V1,
  SPONGE_KNOWLEDGE_ENTITY_STATES_V1,
  SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1,
  SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1,
  SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1,
  SPONGE_KNOWLEDGE_KERNEL_CONCEPTS_V1,
  SPONGE_KNOWLEDGE_LIMITS_V1,
  SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1,
  SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1,
  SPONGE_KNOWLEDGE_SCENARIOS_V1,
  SPONGE_SHA256_HEX_PATTERN,
  canonicalJson,
  compareUtf16CodeUnits,
  createKnowledgeActivityV1,
  createKnowledgeAssertionV1,
  createKnowledgeContextV1,
  createKnowledgeEditionDependencyManifestV1,
  createKnowledgeEditionReleaseV1,
  createKnowledgeEditionV1,
  createKnowledgeEvidenceLinkV1,
  createKnowledgeExecutableShapeV1,
  createKnowledgeGraphRevisionV1,
  createKnowledgeHumanReviewReceiptV1,
  createKnowledgeIdentityOperationV1,
  createKnowledgeInquiryEventV1,
  createKnowledgeInquiryV1,
  createKnowledgeReviewDecisionV1,
  createKnowledgeRightsDecisionV1,
  createKnowledgeSchemaRevisionV1,
  createKnowledgeShapeV1,
  createKnowledgeStatementV1,
  createKnowledgeSynthesisCandidateV1,
  createKnowledgeTypeMembershipV1,
  createKnowledgeViewSpecV1,
  createKnowledgeVocabularyRevisionV1,
  effectiveKnowledgeReviewV1,
  effectiveKnowledgeRightsV1,
  evaluateKnowledgeShapeV1,
  exactKeys,
  freezeKnowledgeDeclaration,
  graphRevisionRetainsEvidenceV1,
  hasExactDataKeys,
  isJsonRecord,
  isPlainRecord,
  isPreparedOhResearchPacketV1,
  isRecord,
  knowledgeDeclarativeJson,
  knowledgeGraphRecordKeyV1,
  knowledgeInquiryTransitionEventKindV1,
  knowledgeInquiryTransitionNoteV1,
  ohResearchRecordKeyV1,
  parseCanonicalInstantV1,
  parseJsonValue,
  parseKnowledgeActivityV1,
  parseKnowledgeAssertionId,
  parseKnowledgeAssertionV1,
  parseKnowledgeContextV1,
  parseKnowledgeEditionDependencyManifestV1,
  parseKnowledgeEditionId,
  parseKnowledgeEditionReleaseV1,
  parseKnowledgeEditionV1,
  parseKnowledgeEntityId,
  parseKnowledgeEntityV1,
  parseKnowledgeEvidenceId,
  parseKnowledgeEvidenceLinkV1,
  parseKnowledgeExecutableShapeV1,
  parseKnowledgeGraphRecordV1,
  parseKnowledgeGraphRevisionV1,
  parseKnowledgeHumanReviewReceiptV1,
  parseKnowledgeIdentityOperationV1,
  parseKnowledgeInquiryEventV1,
  parseKnowledgeInquiryId,
  parseKnowledgeInquiryV1,
  parseKnowledgeReviewDecisionV1,
  parseKnowledgeRightsDecisionV1,
  parseKnowledgeSchemaRefV1,
  parseKnowledgeSchemaRevisionV1,
  parseKnowledgeShapeV1,
  parseKnowledgeStatementV1,
  parseKnowledgeSynthesisCandidateV1,
  parseKnowledgeTypeMembershipV1,
  parseKnowledgeValueRangeV1,
  parseKnowledgeValueV1,
  parseKnowledgeViewSpecV1,
  parseKnowledgeVocabularyRevisionV1,
  parseSha256Hex,
  prepareOhResearchPacketV1,
  reduceKnowledgeGraphRevisionsV1,
  reduceKnowledgeInquiryEventsV1,
  sha256Hex,
  sha256Text,
  traverseKnowledgeGraphV1,
  utf8ByteLength,
  verifyKnowledgeEditionDependencyCompletenessV1,
  verifyKnowledgeIdentityOperationAgainstHeadsV1,
  verifyKnowledgeSchemaEvolutionV1,
  verifyKnowledgeValueV1,
  verifyOhResearchPacketV1
} from "./chunk-ng3qn9zx.js";
// src/research/knowledge-core-v1.ts
var coreOwnerEntityId = (() => {
  const parsed = parseKnowledgeEntityId(`kent_${"0".repeat(24)}`);
  if (parsed === null)
    throw new Error("Invalid Sponge core owner identity.");
  return parsed;
})();
var conceptDefinitions = [
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
  ["work", "An intellectual or creative entity distinct from any one expression or copy."]
];
var broaderByConcept = Object.freeze({
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
  work: "information-resource"
});
var anyRange = { kind: "any", v: 1 };
var entityRange = { kind: "value-kinds", v: 1, valueKinds: ["entity"] };
var textRange = {
  kind: "text",
  languages: null,
  maximumBytes: 65536,
  v: 1
};
var stringRange = { kind: "value-kinds", v: 1, valueKinds: ["string"] };
var timeRange = { kind: "value-kinds", v: 1, valueKinds: ["time"] };
var uriRange = { kind: "value-kinds", v: 1, valueKinds: ["uri"] };
var predicateDefinitions = [
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
  { code: "title", definition: "The title an information resource gives itself or receives from its publisher.", domain: "information-resource", label: "Title", range: textRange }
];
function label(text) {
  return [{ language: "en", text, v: 1 }];
}
function unwrap(result, field) {
  if (!result.ok) {
    throw new Error(`Invalid Sponge core ${field}: ${result.error.field}.`);
  }
  return result.value;
}
function conceptRef(concepts, code) {
  const concept = concepts.get(code);
  if (concept === undefined)
    throw new Error(`Missing Sponge core concept: ${code}.`);
  return concept.ref;
}
var catalogPromise;
function spongeCoreKnowledgeCatalogV1() {
  catalogPromise ??= buildSpongeCoreKnowledgeCatalogV1();
  return catalogPromise;
}
async function buildSpongeCoreKnowledgeCatalogV1() {
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
    v: 1
  }), "vocabulary");
  const concepts = [];
  const conceptsByCode = new Map;
  for (const [code, definition] of conceptDefinitions) {
    const broader = broaderByConcept[code];
    const concept = unwrap(await createKnowledgeSchemaRevisionV1({
      broader: broader === null ? [] : [conceptRef(conceptsByCode, broader)],
      definitions: label(definition),
      identity: { code, namespace: "sponge.core", revision: 1, v: 1 },
      kind: "concept",
      labels: label(code.split("-").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ")),
      previousRevisionSha256: null,
      reviewDecisionSha256: null,
      v: 1,
      vocabularySha256: vocabulary.revisionSha256
    }), `concept:${code}`);
    if (concept.kind !== "concept")
      throw new Error(`Invalid concept kind: ${code}.`);
    concepts.push(concept);
    conceptsByCode.set(code, concept);
  }
  const predicates = [];
  for (const definition of predicateDefinitions) {
    const predicate = unwrap(await createKnowledgeSchemaRevisionV1({
      definitions: label(definition.definition),
      domainConcepts: [conceptRef(conceptsByCode, definition.domain)],
      identity: {
        code: definition.code,
        namespace: "sponge.core",
        revision: 1,
        v: 1
      },
      inversePredicate: null,
      kind: "predicate",
      labels: label(definition.label),
      previousRevisionSha256: null,
      qualifierPredicates: [],
      range: definition.range,
      reviewDecisionSha256: null,
      v: 1,
      vocabularySha256: vocabulary.revisionSha256
    }), `predicate:${definition.code}`);
    if (predicate.kind !== "predicate") {
      throw new Error(`Invalid predicate kind: ${definition.code}.`);
    }
    predicates.push(predicate);
  }
  const rightsPolicy = {
    defaultDisclosure: "private",
    humanReviewRequiredFor: ["identity", "public-encyclopedia", "schema"],
    purposes: ["public-encyclopedia"],
    publicRequiresEvidence: true,
    v: 1
  };
  const rightsPolicyJson = {
    defaultDisclosure: rightsPolicy.defaultDisclosure,
    humanReviewRequiredFor: [...rightsPolicy.humanReviewRequiredFor],
    publicRequiresEvidence: rightsPolicy.publicRequiresEvidence,
    purposes: [...rightsPolicy.purposes],
    v: rightsPolicy.v
  };
  const rightsPolicySha256 = await sha256Text(canonicalJson(rightsPolicyJson));
  const schemas = [...concepts, ...predicates].sort((left, right) => {
    const leftKey = `${left.identity.namespace}:${left.identity.code}:${left.kind}`;
    const rightKey = `${right.identity.namespace}:${right.identity.code}:${right.kind}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const vocabularySet = {
    canonicalizerSha256,
    rightsPolicySha256,
    schemaRevisionSha256s: schemas.map((schema) => schema.revisionSha256),
    v: 1,
    vocabularyRevisionSha256s: [vocabulary.revisionSha256]
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
    vocabularySetSha256
  };
}
// src/research/knowledge-vocabulary-pack-v1.ts
var SPONGE_KNOWLEDGE_PACK_CODECS_V1 = [
  "globe-coordinate",
  "language-text",
  "missing-value",
  "wikibase-time"
];
var manifestKeys = ["canonicalizerSha256", "dependencies", "display", "examples", "migrationNotes", "packId", "previousManifestSha256", "queries", "revision", "schemas", "shapes", "sources", "supportedCodecs", "v", "vocabulary"];
function failure(field, code = "invalid-input") {
  return { ok: false, error: { code, field } };
}
function success(value) {
  return { ok: true, value: freezeKnowledgeDeclaration(value) };
}
function key(value) {
  return canonicalJson(value);
}
function code(value) {
  return typeof value === "string" && value.length <= 128 && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u.test(value);
}
function text(value, maximum = 16384) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
function revision(value) {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function ordered(items, identity) {
  return items.every((item, index) => index === 0 || identity(items[index - 1]) < identity(item));
}
function pins(value) {
  if (!Array.isArray(value) || value.length > 64)
    return null;
  const parsed = [];
  for (const pin of value) {
    if (!isPlainRecord(pin) || !hasExactDataKeys(pin, ["manifestSha256", "packId", "revision", "v"]) || pin["v"] !== 1 || !code(pin["packId"]) || !revision(pin["revision"]))
      return null;
    const manifestSha256 = parseSha256Hex(pin["manifestSha256"]);
    if (manifestSha256 === null)
      return null;
    parsed.push({ manifestSha256, packId: pin["packId"], revision: pin["revision"], v: 1 });
  }
  return ordered(parsed, (pin) => pin.packId) ? parsed : null;
}
function refs(value) {
  if (!Array.isArray(value) || value.length > 256)
    return null;
  const parsed = [];
  for (const ref of value) {
    const result = parseKnowledgeSchemaRefV1(ref);
    if (!result.ok)
      return null;
    parsed.push(result.value);
  }
  return ordered(parsed, key) ? parsed : null;
}
function knowledgeVocabularyPackPinV1(pack) {
  return freezeKnowledgeDeclaration({ manifestSha256: pack.manifestSha256, packId: pack.packId, revision: pack.revision, v: 1 });
}
async function parseManifestInput(value) {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, manifestKeys) || value["v"] !== 1 || !code(value["packId"]) || !revision(value["revision"]) || !text(value["migrationNotes"]))
    return failure("pack");
  const canonicalizerSha256 = parseSha256Hex(value["canonicalizerSha256"]);
  const previousManifestSha256 = value["previousManifestSha256"] === null ? null : parseSha256Hex(value["previousManifestSha256"]);
  const dependencies = pins(value["dependencies"]);
  if (canonicalizerSha256 === null || dependencies === null || value["previousManifestSha256"] !== null && previousManifestSha256 === null || value["revision"] === 1 !== (previousManifestSha256 === null) || dependencies.some((pin) => pin.packId === value["packId"]))
    return failure("pack.dependencies");
  const vocabulary = await parseKnowledgeVocabularyRevisionV1(value["vocabulary"]);
  if (!vocabulary.ok)
    return failure("pack.vocabulary", vocabulary.error.code);
  if (vocabulary.value.namespace !== value["packId"] || vocabulary.value.revision !== value["revision"] || vocabulary.value.canonicalizerSha256 !== canonicalizerSha256)
    return failure("pack.namespace", "authority-violation");
  if (!Array.isArray(value["schemas"]) || value["schemas"].length > 512 || !Array.isArray(value["shapes"]) || value["shapes"].length > 128 || !Array.isArray(value["sources"]) || value["sources"].length > 64 || !Array.isArray(value["examples"]) || value["examples"].length > 64 || !Array.isArray(value["queries"]) || value["queries"].length > 64 || !Array.isArray(value["supportedCodecs"]) || value["supportedCodecs"].length > 4)
    return failure("pack.bounds", "limit-exceeded");
  const schemas = [];
  for (const schema of value["schemas"]) {
    const result = await parseKnowledgeSchemaRevisionV1(schema);
    if (!result.ok)
      return failure("pack.schemas", result.error.code);
    if (result.value.identity.namespace !== value["packId"] || result.value.vocabularySha256 !== vocabulary.value.revisionSha256)
      return failure("pack.schemas.namespace", "authority-violation");
    schemas.push(result.value);
  }
  if (!ordered(schemas, (schema) => schema.identity.code))
    return failure("pack.schemas", "noncanonical-input");
  const shapes = [];
  for (const shape of value["shapes"]) {
    const result = await parseKnowledgeExecutableShapeV1(shape);
    if (!result.ok)
      return failure("pack.shapes", result.error.code);
    if (result.value.shape.namespace !== value["packId"])
      return failure("pack.shapes.namespace", "authority-violation");
    shapes.push(result.value);
  }
  if (!ordered(shapes, (shape) => shape.shape.code))
    return failure("pack.shapes", "noncanonical-input");
  const sources = [];
  for (const source of value["sources"]) {
    if (!isPlainRecord(source) || !hasExactDataKeys(source, ["contentSha256", "license", "revision", "uri", "v"]) || source["v"] !== 1 || !text(source["uri"], 2048) || !/^(?:https?:\/\/|urn:)/u.test(source["uri"]) || !text(source["license"], 256) || !text(source["revision"], 256))
      return failure("pack.sources");
    const contentSha256 = parseSha256Hex(source["contentSha256"]);
    if (contentSha256 === null)
      return failure("pack.sources");
    sources.push({ contentSha256, license: source["license"], revision: source["revision"], uri: source["uri"], v: 1 });
  }
  if (!ordered(sources, key))
    return failure("pack.sources", "noncanonical-input");
  const supportedCodecs = [];
  for (const codec of value["supportedCodecs"]) {
    const admitted = SPONGE_KNOWLEDGE_PACK_CODECS_V1.find((item) => item === codec);
    if (admitted === undefined)
      return failure("pack.supportedCodecs");
    supportedCodecs.push(admitted);
  }
  if (!ordered(supportedCodecs, (item) => item))
    return failure("pack.supportedCodecs", "noncanonical-input");
  const examples = [];
  for (const example of value["examples"]) {
    if (!isPlainRecord(example) || !hasExactDataKeys(example, ["description", "id", "object", "predicate", "subjectConcept", "v"]) || example["v"] !== 1 || !code(example["id"]) || !text(example["description"]))
      return failure("pack.examples");
    const predicate = parseKnowledgeSchemaRefV1(example["predicate"]);
    const subjectConcept = parseKnowledgeSchemaRefV1(example["subjectConcept"]);
    const object = parseKnowledgeValueV1(example["object"]);
    if (!predicate.ok || !subjectConcept.ok || !object.ok || !(await verifyKnowledgeValueV1(object.value)).ok)
      return failure("pack.examples");
    examples.push({ description: example["description"], id: example["id"], object: object.value, predicate: predicate.value, subjectConcept: subjectConcept.value, v: 1 });
  }
  if (!ordered(examples, (item) => item.id))
    return failure("pack.examples", "noncanonical-input");
  const queries = [];
  for (const query of value["queries"]) {
    if (!isPlainRecord(query) || !hasExactDataKeys(query, ["description", "id", "predicates", "v"]) || query["v"] !== 1 || !code(query["id"]) || !text(query["description"]))
      return failure("pack.queries");
    const predicates = refs(query["predicates"]);
    if (predicates === null || predicates.length === 0)
      return failure("pack.queries.predicates");
    queries.push({ description: query["description"], id: query["id"], predicates, v: 1 });
  }
  if (!ordered(queries, (item) => item.id))
    return failure("pack.queries", "noncanonical-input");
  const display = value["display"];
  if (!isPlainRecord(display) || !hasExactDataKeys(display, ["labelPredicates", "v"]) || display["v"] !== 1)
    return failure("pack.display");
  const labelPredicates = refs(display["labelPredicates"]);
  if (labelPredicates === null)
    return failure("pack.display");
  return success({ canonicalizerSha256, dependencies, display: { labelPredicates, v: 1 }, examples, migrationNotes: value["migrationNotes"], packId: value["packId"], previousManifestSha256, queries, revision: value["revision"], schemas, shapes, sources, supportedCodecs, v: 1, vocabulary: vocabulary.value });
}
async function createKnowledgeVocabularyPackManifestV1(value) {
  const input = knowledgeDeclarativeJson(value);
  const parsed = await parseManifestInput(input);
  return parsed.ok ? success({ ...parsed.value, manifestSha256: await sha256Text(key(parsed.value)) }) : parsed;
}
async function parseKnowledgeVocabularyPackManifestV1(value) {
  const input = knowledgeDeclarativeJson(value);
  if (!isPlainRecord(input) || !hasExactDataKeys(input, [...manifestKeys, "manifestSha256"]))
    return failure("pack");
  const { manifestSha256, ...body } = input;
  const parsed = await createKnowledgeVocabularyPackManifestV1(body);
  return parsed.ok && manifestSha256 !== parsed.value.manifestSha256 ? failure("manifestSha256", "digest-mismatch") : parsed;
}
async function createKnowledgeVocabularyPackLockV1(value) {
  const input = knowledgeDeclarativeJson(value, 65536);
  if (!isPlainRecord(input) || !hasExactDataKeys(input, ["packs", "roots", "v"]) || input["v"] !== 1)
    return failure("lock");
  const packs = pins(input["packs"]);
  const roots = pins(input["roots"]);
  if (packs === null || roots === null || roots.length === 0 || roots.some((root) => !packs.some((pin) => key(pin) === key(root))))
    return failure("lock.pins");
  const body = { packs, roots, v: 1 };
  return success({ ...body, lockSha256: await sha256Text(key(body)) });
}
async function parseKnowledgeVocabularyPackLockV1(value) {
  const input = knowledgeDeclarativeJson(value, 65536);
  if (!isPlainRecord(input) || !hasExactDataKeys(input, ["lockSha256", "packs", "roots", "v"]))
    return failure("lock");
  const parsed = await createKnowledgeVocabularyPackLockV1({ packs: input["packs"], roots: input["roots"], v: input["v"] });
  return parsed.ok && input["lockSha256"] !== parsed.value.lockSha256 ? failure("lockSha256", "digest-mismatch") : parsed;
}
async function resolveKnowledgeVocabularyPacksV1(input) {
  const rootJson = knowledgeDeclarativeJson(input.roots, 65536);
  const roots = pins(rootJson);
  if (roots === null || roots.length === 0 || !Array.isArray(input.manifests) || input.manifests.length > 64)
    return failure("packs.bounds", "limit-exceeded");
  const byId = new Map;
  for (const manifest of input.manifests) {
    const parsed = await parseKnowledgeVocabularyPackManifestV1(manifest);
    if (!parsed.ok)
      return parsed;
    if (byId.has(parsed.value.packId))
      return failure("packs.namespace", "authority-violation");
    byId.set(parsed.value.packId, parsed.value);
  }
  const visiting = new Set;
  const visited = new Set;
  const packs = [];
  function visit(pin) {
    const pack = byId.get(pin.packId);
    if (pack === undefined)
      return failure("packs.dependency", "dependency-missing");
    if (key(knowledgeVocabularyPackPinV1(pack)) !== key(pin))
      return failure("packs.dependency", "digest-mismatch");
    if (visiting.has(pack.packId))
      return failure("packs.dependencies", "cycle-detected");
    if (visited.has(pack.packId))
      return { ok: true, value: true };
    visiting.add(pack.packId);
    for (const dependency of pack.dependencies) {
      const result = visit(dependency);
      if (!result.ok)
        return result;
      if (byId.get(dependency.packId)?.canonicalizerSha256 !== pack.canonicalizerSha256)
        return failure("packs.canonicalizer", "digest-mismatch");
    }
    visiting.delete(pack.packId);
    visited.add(pack.packId);
    packs.push(pack);
    return { ok: true, value: true };
  }
  for (const root of roots) {
    const result = visit(root);
    if (!result.ok)
      return result;
  }
  for (const pack of packs) {
    let include = function(current) {
      if (allowedPacks.has(current.packId))
        return;
      allowedPacks.add(current.packId);
      for (const schema of current.schemas)
        allowed.set(key(schema.ref), schema);
      for (const shape of current.shapes)
        allowedShapes.set(key(shape.shape), shape);
      for (const dependency of current.dependencies)
        include(byId.get(dependency.packId));
    }, inspect = function(value) {
      if (Array.isArray(value))
        return value.every(inspect);
      if (!isPlainRecord(value))
        return true;
      if (hasExactDataKeys(value, ["code", "namespace", "revision", "schemaSha256", "v"]))
        return allowed.has(key(value));
      return Object.values(value).every(inspect);
    };
    const allowed = new Map;
    const allowedShapes = new Map;
    const allowedPacks = new Set;
    include(pack);
    if (!inspect([pack.schemas, pack.shapes, pack.examples, pack.queries, pack.display]))
      return failure("packs.schema-reference", "dependency-missing");
    const hasKind = (ref, kind) => allowed.get(key(ref))?.kind === kind;
    for (const schema of pack.schemas) {
      if (schema.kind === "concept" && !schema.broader.every((ref) => hasKind(ref, "concept")))
        return failure("packs.broader");
      if (schema.kind === "predicate" && (!schema.domainConcepts.every((ref) => hasKind(ref, "concept")) || !schema.qualifierPredicates.every((ref) => hasKind(ref, "predicate")) || schema.inversePredicate !== null && !hasKind(schema.inversePredicate, "predicate") || schema.range.kind === "entity-concepts" && !schema.range.concepts.every((ref) => hasKind(ref, "concept")) || schema.range.kind === "numeric" && schema.range.unit !== null && !hasKind(schema.range.unit, "unit")))
        return failure("packs.predicate");
    }
    for (const shape of pack.shapes) {
      let validateInheritance = function(current, depth) {
        const identity = key(current.shape);
        if (ancestry.has(identity))
          return failure("packs.shape-inheritance", "cycle-detected");
        if (depth > shape.maximumInheritanceDepth || completed.size >= 256)
          return failure("packs.shape-inheritance", "limit-exceeded");
        if (completed.has(identity))
          return { ok: true, value: true };
        ancestry.add(identity);
        for (const ref of current.extends) {
          const parent = allowedShapes.get(key(ref));
          if (parent === undefined)
            return failure("packs.shape-inheritance", "dependency-missing");
          const result = validateInheritance(parent, depth + 1);
          if (!result.ok)
            return result;
        }
        ancestry.delete(identity);
        completed.add(identity);
        return { ok: true, value: true };
      };
      if (!shape.appliesToConcepts.every((ref) => hasKind(ref, "concept")) || !shape.rules.every((rule) => hasKind(rule.predicate, "predicate")))
        return failure("packs.shape");
      const ancestry = new Set;
      const completed = new Set;
      const inheritance = validateInheritance(shape, 0);
      if (!inheritance.ok)
        return inheritance;
    }
    if (!pack.examples.every((example) => hasKind(example.subjectConcept, "concept") && hasKind(example.predicate, "predicate")) || !pack.queries.every((query) => query.predicates.every((ref) => hasKind(ref, "predicate"))) || !pack.display.labelPredicates.every((ref) => hasKind(ref, "predicate")))
      return failure("packs.declarations");
  }
  const lock = await createKnowledgeVocabularyPackLockV1({ packs: packs.map(knowledgeVocabularyPackPinV1).sort((left, right) => left.packId < right.packId ? -1 : 1), roots, v: 1 });
  return lock.ok ? success({ lock: lock.value, packs }) : lock;
}
async function verifyKnowledgeVocabularyPackLockV1(input) {
  const lock = await parseKnowledgeVocabularyPackLockV1(input.lock);
  if (!lock.ok)
    return lock;
  const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: input.manifests, roots: lock.value.roots });
  if (!resolved.ok)
    return resolved;
  return resolved.value.lock.lockSha256 === lock.value.lockSha256 ? resolved : failure("lock.closure", "digest-mismatch");
}
// src/research/knowledge-reference-catalog.ts
function unwrap2(result) {
  if (!result.ok)
    throw new Error(`Invalid builtin knowledge pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels(value) {
  return [{ language: "en", text: value, v: 1 }];
}
function title(value) {
  return value.split("-").map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ");
}
function sortSchemas(schemas) {
  return [...schemas].sort((left, right) => left.identity.code < right.identity.code ? -1 : 1);
}
function mustSchema(schemas, code2) {
  const schema = schemas.find((item) => item.identity.code === code2);
  if (schema === undefined)
    throw new Error(`Missing builtin schema: ${code2}.`);
  return schema;
}
var referencePromise;
function spongeKnowledgeReferenceCatalog() {
  referencePromise ??= buildReferenceCatalog();
  return referencePromise;
}
async function buildReferenceCatalog() {
  const core = await spongeCoreKnowledgeCatalogV1();
  const ownerEntityId = core.vocabulary.ownerEntityId;
  const base = {
    canonicalizerSha256: core.canonicalizerSha256,
    display: { labelPredicates: [mustSchema(core.schemas, "name").ref], v: 1 },
    examples: [],
    migrationNotes: "Initial additive application profile. Existing records retain their meanings; installation and publication require separate authorization.",
    previousManifestSha256: null,
    queries: [],
    revision: 1,
    shapes: [],
    sources: [],
    supportedCodecs: [],
    v: 1
  };
  const corePack = unwrap2(await createKnowledgeVocabularyPackManifestV1({ ...base, dependencies: [], packId: "sponge.core", schemas: sortSchemas(core.schemas), vocabulary: core.vocabulary }));
  const referenceVocabulary = unwrap2(await createKnowledgeVocabularyRevisionV1({ canonicalizerSha256: core.canonicalizerSha256, labels: labels("Sponge source value preservation"), namespace: "sponge.reference", ownerEntityId, previousRevisionSha256: null, revision: 1, state: "private", v: 1 }));
  const referenceSchemas = [];
  for (const codec of SPONGE_KNOWLEDGE_PACK_CODECS_V1) {
    referenceSchemas.push(unwrap2(await createKnowledgeSchemaRevisionV1({ broader: [mustSchema(core.schemas, "information-resource").ref], definitions: labels(`A bounded ${codec} source-value preservation codec. Its data does not imply normalized truth, schema review or publication authority.`), identity: { code: codec, namespace: "sponge.reference", revision: 1, v: 1 }, kind: "concept", labels: labels(title(codec)), previousRevisionSha256: null, reviewDecisionSha256: null, v: 1, vocabularySha256: referenceVocabulary.revisionSha256 })));
  }
  for (const [code2, description] of [
    ["gregorian-calendar", "The proleptic Gregorian civil calendar for explicitly normalized time values. Referencing it does not normalize a retained source calendar."],
    ["language-system", "An identified language or language variety under an explicit naming scheme, distinct from text written in it."],
    ["population", "An identified population to which a scoped claim applies, distinct from an estimate about that population."]
  ]) {
    referenceSchemas.push(unwrap2(await createKnowledgeSchemaRevisionV1({ broader: [mustSchema(core.schemas, "concept").ref], definitions: labels(description), identity: { code: code2, namespace: "sponge.reference", revision: 1, v: 1 }, kind: "concept", labels: labels(title(code2)), previousRevisionSha256: null, reviewDecisionSha256: null, v: 1, vocabularySha256: referenceVocabulary.revisionSha256 })));
  }
  const entityContext = (concept) => ({ concepts: [concept.ref], kind: "entity-concepts", v: 1 });
  const contextDefinitions = [
    ["at-time", "The explicitly stated time of this claim or observation, without dating every similar claim.", { kind: "value-kinds", valueKinds: ["time"], v: 1 }],
    ["valid-during", "The explicitly stated interval during which this claim applies.", { kind: "value-kinds", valueKinds: ["interval"], v: 1 }],
    ["place-context", "The identified place under which this claim applies, distinct from the subject's intrinsic location.", entityContext(mustSchema(core.schemas, "place"))],
    ["language-context", "The identified language or variety under which this claim or interpretation applies.", entityContext(mustSchema(referenceSchemas, "language-system"))],
    ["method-context", "The identified procedure or interpretive method under which this claim was made.", entityContext(mustSchema(core.schemas, "information-resource"))],
    ["population-context", "The identified population bounding this claim; it does not generalize the claim beyond that population.", entityContext(mustSchema(referenceSchemas, "population"))],
    ["source-context", "The attributed source under which this claim is reported, without treating attribution as verified evidence.", entityContext(mustSchema(core.schemas, "source"))]
  ];
  for (const [code2, description, range] of contextDefinitions) {
    const predicate = unwrap2(await createKnowledgeSchemaRevisionV1({ definitions: labels(description), domainConcepts: [mustSchema(core.schemas, "entity").ref], identity: { code: code2, namespace: "sponge.reference", revision: 1, v: 1 }, inversePredicate: null, kind: "predicate", labels: labels(title(code2)), previousRevisionSha256: null, qualifierPredicates: [], range, reviewDecisionSha256: null, v: 1, vocabularySha256: referenceVocabulary.revisionSha256 }));
    if (predicate.kind !== "predicate")
      throw new Error("Expected context predicate.");
    referenceSchemas.push(predicate);
  }
  const referencePack = unwrap2(await createKnowledgeVocabularyPackManifestV1({ ...base, dependencies: [knowledgeVocabularyPackPinV1(corePack)], packId: "sponge.reference", schemas: sortSchemas(referenceSchemas), supportedCodecs: SPONGE_KNOWLEDGE_PACK_CODECS_V1, sources: [{ contentSha256: await sha256Text(canonicalJson(referenceSchemas)), license: "MIT", revision: "1", uri: "urn:sponge:application-profile:reference", v: 1 }], vocabulary: referenceVocabulary }));
  return freezeKnowledgeDeclaration({ corePack, referencePack });
}

// src/research/knowledge-domain-catalog.ts
var definitions = [
  { id: "language", question: "Which forms and contextual meanings belong to this lexeme?", concepts: [
    ["lexeme", "A lexical entry, distinct from its written forms and contextual senses.", "information-resource"],
    ["form", "A written or spoken realization of a lexical entry.", "information-resource"],
    ["sense", "One contextual meaning associated with a lexical entry.", "concept"],
    ["text-occurrence", "A particular usage at a locator in a retained text.", "entity"]
  ], predicates: [
    ["has-form", "Connects a lexical entry to one of its realizations.", "lexeme", "entity"],
    ["has-sense", "Connects a lexical entry to one of its contextual meanings.", "lexeme", "entity"],
    ["translation-of-sense", "Relates contextual meanings under attributed translation evidence.", "sense", "entity"],
    ["attested-in", "Identifies a retained usage that attests a lexical entry.", "lexeme", "entity"]
  ] },
  { id: "culture", question: "Which depictions and naming explanations refer to this motif?", concepts: [
    ["motif", "A recurring cultural subject whose interpretations may differ.", "concept"],
    ["fictional-entity", "An identity situated in a fictional narrative or setting.", "entity"],
    ["depiction", "A particular representation of a subject in an artifact.", "artifact"],
    ["reference-occurrence", "An attributed cultural reference with a particular source location.", "entity"]
  ], predicates: [
    ["depicts", "Identifies the subject represented by a depiction.", "depiction", "entity"],
    ["alludes-to", "Records an attributed indirect reference, distinct from depicted identity.", "reference-occurrence", "entity"],
    ["named-after", "Records a naming explanation requiring its own attributed evidence.", "reference-occurrence", "entity"],
    ["interpreted-as", "Relates a reference to an attributed interpretation.", "reference-occurrence", "entity"]
  ] },
  { id: "natural-world", question: "How was this occurrence classified and observed?", concepts: [
    ["physical-occurrence", "A particular natural occurrence, distinct from its classification.", "event"],
    ["classification-scheme", "A versioned navigational scheme for natural entities and features.", "concept"],
    ["taxon", "A classification unit under an identified biological scheme.", "concept"],
    ["observation", "An attributed observation of a feature under stated conditions.", "event"],
    ["feature", "An observable characteristic distinguished by a classification scheme.", "concept"]
  ], predicates: [
    ["classified-under", "Assigns an occurrence to a class under an explicit scheme.", "physical-occurrence", "entity"],
    ["observes", "Identifies the particular occurrence an observation concerns.", "observation", "entity"],
    ["observed-at", "Locates an observation without implying the location of every similar occurrence.", "observation", "entity"],
    ["has-feature", "Records an attributed feature of an occurrence.", "physical-occurrence", "entity"]
  ] },
  { id: "body", question: "Which experiences, structures and population estimates bear on this phenomenon?", concepts: [
    ["bodily-phenomenon", "A bodily phenomenon independent of any proposed explanation.", "concept"],
    ["anatomical-structure", "A structure identified under an anatomical description.", "entity"],
    ["experience-report", "A person's attributed report, distinct from physiological verification.", "information-resource"],
    ["study-population", "The sampled population to which an estimate applies.", "entity"],
    ["mechanism-hypothesis", "A proposed physiological explanation requiring evidence.", "concept"]
  ], predicates: [
    ["involves-structure", "Relates a phenomenon to a proposed or observed anatomical structure.", "bodily-phenomenon", "entity"],
    ["reports-experience", "Identifies the experience described by an attributed report.", "experience-report", "entity"],
    ["estimates-prevalence", "Records a numeric estimate scoped to its study population.", "study-population", "decimal"],
    ["proposes-mechanism", "Connects a phenomenon to a distinct explanatory hypothesis.", "bodily-phenomenon", "entity"]
  ] },
  { id: "research", question: "What was tested, by which method, and what corrections followed?", concepts: [
    ["publication-version", "One version of a research work, with its own source history.", "source"],
    ["study", "A particular investigation with method and population boundaries.", "process"],
    ["sample", "Material or participants selected under an identified sampling procedure.", "entity"],
    ["method", "A specified procedure for producing or assessing observations.", "information-resource"],
    ["finding", "An attributed research result, distinct from an acceptance decision.", "information-resource"],
    ["correction", "A source-issued correction or retraction notice about a publication version.", "source"]
  ], predicates: [
    ["tests", "Identifies the hypothesis or object a study investigates.", "study", "entity"],
    ["uses-method", "Pins the method under which the study was conducted.", "study", "entity"],
    ["produces-finding", "Relates a study to an attributed finding.", "study", "entity"],
    ["supersedes", "Identifies the exact publication version addressed by a correction.", "correction", "entity"]
  ] },
  { id: "substances", question: "Which batch and sample support this assay and dated offer?", concepts: [
    ["molecular-identity", "A chemical identity including relevant sequence, structure and modification distinctions.", "concept"],
    ["product", "A marketed substance formulation distinct from its physical batches.", "artifact"],
    ["batch", "An identified physical production batch of a product.", "artifact"],
    ["sample", "A particular sample taken from identified material.", "artifact"],
    ["assay", "An analytical activity on a particular sample under a method.", "process"],
    ["offer", "A dated seller offer with its own product, price and territory conditions.", "information-resource"]
  ], predicates: [
    ["sample-of", "Connects a tested sample to the material from which it came.", "sample", "entity"],
    ["batch-of", "Connects an identified batch to a product formulation.", "batch", "entity"],
    ["assays", "Identifies the exact sample tested by an assay.", "assay", "entity"],
    ["offered-by", "Identifies the seller of a dated offer without conferring trust.", "offer", "entity"]
  ] },
  { id: "organizations", question: "Which roles, transactions and completion claims define this history?", concepts: [
    ["legal-entity", "A legal organizational identity under an identified jurisdiction.", "organization"],
    ["brand", "A commercial identity distinct from its legal owner and products.", "concept"],
    ["role-assignment", "An agent's role in an organization during stated conditions or dates.", "entity"],
    ["transaction", "An economic transaction distinct from announcements about it.", "event"],
    ["announcement", "An attributed public announcement about a proposed or completed event.", "information-resource"],
    ["completion", "A reported completion event with separately attributable evidence.", "event"]
  ], predicates: [
    ["operates", "Relates a legal entity to a product or brand it operates.", "legal-entity", "entity"],
    ["held-by", "Identifies the agent occupying a dated role assignment.", "role-assignment", "entity"],
    ["announces", "Identifies an event mentioned by an announcement without asserting completion.", "announcement", "entity"],
    ["completes", "Identifies the transaction a reported completion concerns.", "completion", "entity"]
  ] },
  { id: "editorial", question: "Which stories report this event and why were they placed prominently?", concepts: [
    ["event-series", "A collection of related events under a stated organizing basis.", "entity"],
    ["article", "A particular editorial source distinct from its reported events.", "source"],
    ["story-cluster", "A navigational grouping of reports under an explicit grouping policy.", "concept"],
    ["edition", "A dated editorial selection distinct from graph acceptance or publication authority.", "work"],
    ["placement", "An article's location in one editorial edition.", "entity"],
    ["ranking-assessment", "An attributed assessment explaining editorial prominence.", "information-resource"]
  ], predicates: [
    ["reports-on", "Identifies an event discussed in an article.", "article", "entity"],
    ["contains-placement", "Connects an edition to one of its placements.", "edition", "entity"],
    ["ranks-under", "Connects a placement to the assessment that explains its prominence.", "placement", "entity"],
    ["updates", "Identifies an earlier article that a report updates.", "article", "entity"]
  ] },
  { id: "software", question: "Which protocol and configuration make these evaluation results comparable?", concepts: [
    ["repository", "A software source repository distinct from its commits and releases.", "information-resource"],
    ["release", "An identified release of software or a model.", "artifact"],
    ["model-version", "An exact model version distinct from a marketing family name.", "artifact"],
    ["configuration", "A pinned runtime and tool configuration.", "information-resource"],
    ["dataset-version", "An identified dataset revision with its own split and provenance.", "artifact"],
    ["benchmark-protocol", "A specified evaluation protocol with scope and metric definitions.", "information-resource"],
    ["run", "One observed execution under a configuration and protocol.", "process"],
    ["measurement", "A measured result with method, units and conditions supplied separately.", "information-resource"]
  ], predicates: [
    ["evaluated-under", "Pins the benchmark protocol for one run.", "run", "entity"],
    ["uses-configuration", "Pins the runtime configuration for one run.", "run", "entity"],
    ["uses-dataset", "Pins the dataset version for one run.", "run", "entity"],
    ["produces", "Connects a run to a measured result or output artifact.", "run", "entity"]
  ] },
  { id: "music", question: "Which work, performance and recording produced this released track?", concepts: [
    ["musical-work", "A composition distinct from arrangements, performances and recordings.", "work"],
    ["arrangement", "An arrangement of a musical work.", "work"],
    ["performance", "One performance of a work or arrangement.", "event"],
    ["recording", "An audio recording identity distinct from its release placements.", "artifact"],
    ["release", "An issued music release containing tracks.", "artifact"],
    ["track", "A recording's placement on a particular release.", "entity"],
    ["similarity-assessment", "A dated similarity assessment under a stated listening or computational method.", "information-resource"]
  ], predicates: [
    ["performs", "Identifies the work or arrangement performed.", "performance", "entity"],
    ["records", "Identifies the performance captured by a recording.", "recording", "entity"],
    ["appears-on", "Identifies the release containing a track.", "track", "entity"],
    ["similar-under", "Identifies a method-specific comparison without asserting influence or rights.", "similarity-assessment", "entity"]
  ] },
  { id: "people", question: "Which dated source records support this profile within its authorized purpose?", concepts: [
    ["public-profile-document", "An attributed public profile source, distinct from the person it describes.", "source"],
    ["source-contact-record", "A source-owned contact record whose sensitive payload needs a deletable retention store.", "information-resource"],
    ["interaction", "An interaction with separately governed access and retention.", "event"],
    ["relationship-account", "An attributed account of a relationship, distinct from intrinsic personal properties.", "information-resource"],
    ["profile-projection", "A dated, scoped selection of profile knowledge and uncertainty.", "information-resource"]
  ], predicates: [
    ["describes-person", "Identifies the person a profile source describes without merging source identities.", "public-profile-document", "entity"],
    ["derived-from-record", "Identifies a source record used by a purpose-bound profile projection.", "profile-projection", "entity"],
    ["involves-person", "Identifies a participant under the interaction's authorization boundary.", "interaction", "entity"],
    ["accounts-for", "Identifies a relationship described by an attributed account.", "relationship-account", "entity"]
  ] },
  { id: "finance", question: "Which instrument, listing and backtest assumptions define this comparison?", concepts: [
    ["issuer", "An entity issuing a financial instrument.", "organization"],
    ["instrument", "A financial instrument distinct from its exchange listings.", "entity"],
    ["listing", "An instrument's listing at a venue under dated conditions.", "entity"],
    ["ticker-assignment", "A dated ticker assignment to a listing, without assuming global permanence.", "entity"],
    ["strategy-version", "A specified strategy hypothesis distinct from future outcome claims.", "information-resource"],
    ["backtest-run", "A historical simulation under identified data, period, costs and assumptions.", "process"]
  ], predicates: [
    ["issued-by", "Identifies the issuer of an instrument.", "instrument", "entity"],
    ["lists-instrument", "Identifies the instrument associated with a venue listing.", "listing", "entity"],
    ["tests-strategy", "Pins the strategy version tested by a historical run.", "backtest-run", "entity"],
    ["uses-dataset", "Pins the data artifact used by a backtest.", "backtest-run", "entity"]
  ] },
  { id: "formal-systems", question: "Which rule, initial state and proof artifact support this result?", concepts: [
    ["conjecture", "A formal claim whose proof status is attributed separately.", "concept"],
    ["proof-artifact", "An inspectable proof artifact under a specified formal system.", "artifact"],
    ["rule-set-version", "An identified set of transition rules.", "information-resource"],
    ["initial-state", "An exact initial state of a formal or artificial-life system.", "artifact"],
    ["simulation", "An execution under rules, topology, initial state and seed.", "process"],
    ["state-snapshot", "A recorded state at a particular simulation tick.", "artifact"]
  ], predicates: [
    ["instantiates", "Pins the rule-set version used by a simulation.", "simulation", "entity"],
    ["starts-from", "Pins a simulation's initial state.", "simulation", "entity"],
    ["observed-at-tick", "Records the exact discrete tick associated with a state snapshot.", "state-snapshot", "integer"],
    ["has-proof", "Connects a formal claim to a proof artifact without asserting unchecked validity.", "conjecture", "entity"]
  ] },
  { id: "agent-work", question: "Which attempts and checks produced a resumable verified outcome?", concepts: [
    ["goal", "A desired outcome distinct from the actions intended to achieve it.", "concept"],
    ["task", "A bounded unit of work associated with a goal.", "entity"],
    ["skill-version", "A pinned reusable instruction or workflow artifact.", "information-resource"],
    ["trajectory", "An observable execution record without private chain-of-thought requirements.", "information-resource"],
    ["attempt", "One execution attempt with inputs, observations and completion state.", "process"],
    ["check-result", "An observed validation result tied to an exact output and validator.", "information-resource"]
  ], predicates: [
    ["uses-skill", "Pins a skill version used during an attempt.", "attempt", "entity"],
    ["attempts", "Identifies the task an execution attempt addresses.", "attempt", "entity"],
    ["produces", "Identifies an output artifact produced by an attempt.", "attempt", "entity"],
    ["validated-by", "Connects an attempt to an observed check result without inferring universal correctness.", "attempt", "entity"]
  ] }
];
var SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS = Object.freeze(definitions.map((definition) => `sponge.${definition.id}`));
function unwrap3(result) {
  if (!result.ok)
    throw new Error(`Invalid builtin knowledge pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels2(value) {
  return [{ language: "en", text: value, v: 1 }];
}
function title2(value) {
  return value.split("-").map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ");
}
function sortSchemas2(schemas) {
  return [...schemas].sort((left, right) => left.identity.code < right.identity.code ? -1 : 1);
}
function mustSchema2(schemas, code2) {
  const schema = schemas.find((item) => item.identity.code === code2);
  if (schema === undefined)
    throw new Error(`Missing builtin schema: ${code2}.`);
  return schema;
}
var catalogPromise2;
function spongeKnowledgeDomainCatalog() {
  catalogPromise2 ??= buildCatalog();
  return catalogPromise2;
}
function knowledgeDomainSchemaByRef(catalog, ref) {
  return catalog.schemas.find((schema) => schema.ref.namespace === ref.namespace && schema.ref.code === ref.code && schema.ref.revision === ref.revision && schema.ref.schemaSha256 === ref.schemaSha256 && ref.v === 1) ?? null;
}
async function buildCatalog() {
  const core = await spongeCoreKnowledgeCatalogV1();
  const ownerEntityId = core.vocabulary.ownerEntityId;
  const base = {
    canonicalizerSha256: core.canonicalizerSha256,
    display: { labelPredicates: [mustSchema2(core.schemas, "name").ref], v: 1 },
    examples: [],
    migrationNotes: "Initial additive application profile. Existing records retain their meanings; installation and publication require separate authorization.",
    previousManifestSha256: null,
    queries: [],
    revision: 1,
    shapes: [],
    sources: [],
    supportedCodecs: [],
    v: 1
  };
  const { corePack, referencePack } = await spongeKnowledgeReferenceCatalog();
  const qualifierPredicates = referencePack.schemas.filter((schema) => schema.kind === "predicate").map((predicate) => predicate.ref).sort((left, right) => canonicalJson(left) < canonicalJson(right) ? -1 : 1);
  const packs = [corePack, referencePack];
  for (const definition of definitions) {
    const namespace = `sponge.${definition.id}`;
    const vocabulary = unwrap3(await createKnowledgeVocabularyRevisionV1({ canonicalizerSha256: core.canonicalizerSha256, labels: labels2(`Sponge ${title2(definition.id)} vocabulary`), namespace, ownerEntityId, previousRevisionSha256: null, revision: 1, state: "private", v: 1 }));
    const concepts = [];
    const predicates = [];
    for (const [code2, description, broader] of definition.concepts) {
      const concept = unwrap3(await createKnowledgeSchemaRevisionV1({ broader: [mustSchema2(core.schemas, broader).ref], definitions: labels2(description), identity: { code: code2, namespace, revision: 1, v: 1 }, kind: "concept", labels: labels2(title2(code2)), previousRevisionSha256: null, reviewDecisionSha256: null, v: 1, vocabularySha256: vocabulary.revisionSha256 }));
      if (concept.kind !== "concept")
        throw new Error("Expected concept.");
      concepts.push(concept);
    }
    for (const [code2, description, domain, valueKind] of definition.predicates) {
      const predicate = unwrap3(await createKnowledgeSchemaRevisionV1({ definitions: labels2(description), domainConcepts: [mustSchema2(concepts, domain).ref], identity: { code: code2, namespace, revision: 1, v: 1 }, inversePredicate: null, kind: "predicate", labels: labels2(title2(code2)), previousRevisionSha256: null, qualifierPredicates, range: { kind: "value-kinds", v: 1, valueKinds: [valueKind] }, reviewDecisionSha256: null, v: 1, vocabularySha256: vocabulary.revisionSha256 }));
      if (predicate.kind !== "predicate")
        throw new Error("Expected predicate.");
      predicates.push(predicate);
    }
    const primary = predicates[0];
    if (primary === undefined)
      throw new Error("Missing profile predicate.");
    const shape = unwrap3(await createKnowledgeExecutableShapeV1({ appliesToConcepts: primary.domainConcepts, closed: false, extends: [], maximumInheritanceDepth: 1, rules: [{ allowedDisclosures: ["private"], cardinality: { maximum: null, minimum: 1, v: 1 }, predicate: primary.ref, purpose: "private-research", range: primary.range, requiredEvidenceBearings: [], severity: "error", v: 1 }], shape: primary.domainConcepts[0], v: 1 }));
    const entityId = parseKnowledgeEntityId(`kent_${"e".repeat(24)}`);
    if (entityId === null)
      throw new Error("Invalid example identity.");
    const object = { entityId, kind: "entity", v: 1 };
    const sourceSha256 = await sha256Text(canonicalJson(definition));
    packs.push(unwrap3(await createKnowledgeVocabularyPackManifestV1({ ...base, dependencies: [knowledgeVocabularyPackPinV1(corePack), knowledgeVocabularyPackPinV1(referencePack)], examples: [{ description: `Synthetic structural example: ${definition.question} The example identity makes no real-world factual assertion.`, id: "first-relation", object, predicate: primary.ref, subjectConcept: primary.domainConcepts[0], v: 1 }], packId: namespace, queries: [{ description: definition.question, id: "first-question", predicates: predicates.map((predicate) => predicate.ref).sort((left, right) => canonicalJson(left) < canonicalJson(right) ? -1 : 1), v: 1 }], schemas: sortSchemas2([...concepts, ...predicates]), shapes: [shape], sources: [{ contentSha256: sourceSha256, license: "MIT", revision: "1", uri: `urn:sponge:application-profile:${definition.id}`, v: 1 }], vocabulary })));
  }
  packs.sort((left, right) => left.packId < right.packId ? -1 : 1);
  const resolved = unwrap3(await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots: packs.filter((pack) => SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS.includes(pack.packId)).map(knowledgeVocabularyPackPinV1) }));
  return freezeKnowledgeDeclaration({ corePack, lock: resolved.lock, packs, referencePack, schemas: packs.flatMap((pack) => pack.schemas), vocabularies: packs.map((pack) => pack.vocabulary) });
}
// src/research/knowledge-value-codecs-v1.ts
var mediaType = "application/vnd.sponge.preserved-value+json";
var canonicalizerIdentity = "sponge.knowledge.preserved-value.canonical-json.v1";
function failure2(field) {
  return { ok: false, error: { code: "invalid-input", field } };
}
function success2(value) {
  return { ok: true, value: freezeKnowledgeDeclaration(value) };
}
var grandfathered = new Set([
  "art-lojban",
  "cel-gaulish",
  "en-gb-oed",
  "i-ami",
  "i-bnn",
  "i-default",
  "i-enochian",
  "i-hak",
  "i-klingon",
  "i-lux",
  "i-mingo",
  "i-navajo",
  "i-pwn",
  "i-tao",
  "i-tay",
  "i-tsu",
  "no-bok",
  "no-nyn",
  "sgn-be-fr",
  "sgn-be-nl",
  "sgn-ch-de",
  "zh-guoyu",
  "zh-hakka",
  "zh-min",
  "zh-min-nan",
  "zh-xiang"
]);
function isKnowledgeLanguageTagV1(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || !/^[A-Za-z0-9-]+$/u.test(value))
    return false;
  const lower = value.toLowerCase();
  if (grandfathered.has(lower))
    return true;
  const parts = lower.split("-");
  if (parts[0] === "x")
    return parts.length > 1 && parts.slice(1).every((part) => /^[a-z0-9]{1,8}$/u.test(part));
  const language = parts[0] ?? "";
  if (!/^[a-z]{2,8}$/u.test(language))
    return false;
  let index = 1;
  if (language.length <= 3) {
    for (let count = 0;count < 3 && /^[a-z]{3}$/u.test(parts[index] ?? ""); count++)
      index++;
  }
  if (/^[a-z]{4}$/u.test(parts[index] ?? ""))
    index++;
  if (/^(?:[a-z]{2}|[0-9]{3})$/u.test(parts[index] ?? ""))
    index++;
  const variants = new Set;
  while (/^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/u.test(parts[index] ?? "")) {
    const variant = parts[index];
    if (variants.has(variant))
      return false;
    variants.add(variant);
    index++;
  }
  const extensions = new Set;
  while (/^[0-9a-wy-z]$/u.test(parts[index] ?? "")) {
    const singleton = parts[index];
    if (extensions.has(singleton))
      return false;
    extensions.add(singleton);
    index++;
    const first = index;
    while (/^[a-z0-9]{2,8}$/u.test(parts[index] ?? ""))
      index++;
    if (first === index)
      return false;
  }
  if (parts[index] === "x") {
    index++;
    const first = index;
    while (/^[a-z0-9]{1,8}$/u.test(parts[index] ?? ""))
      index++;
    if (first === index)
      return false;
  }
  return index === parts.length;
}
function uri(value) {
  return typeof value === "string" && value.length <= 2048 && /^https?:\/\/[^\s?#]+(?:[?#][^\s]*)?$/u.test(value);
}
function natural(value) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
function numeric(value) {
  if (typeof value !== "string" || value.length > 512 || !/^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]{1,4})?$/u.test(value))
    return null;
  const [mantissa = "", exponentPart = "0"] = value.toLowerCase().split("e");
  const exponent = Number(exponentPart);
  if (Math.abs(exponent) > 1024)
    return null;
  const [integer = "0", fraction = ""] = mantissa.split(".");
  const digits = BigInt(`${integer}${fraction}`);
  const scale = fraction.length - exponent;
  return scale >= 0 ? [digits, 10n ** BigInt(scale)] : [digits * 10n ** BigInt(-scale), 1n];
}
function within(value, minimum, maximum) {
  const parsed = numeric(value);
  return parsed !== null && parsed[0] >= BigInt(minimum) * parsed[1] && parsed[0] <= BigInt(maximum) * parsed[1];
}
function parseKnowledgePreservedValuePayloadV1(value) {
  const input = knowledgeDeclarativeJson(value, 60000);
  if (!isPlainRecord(input) || input["v"] !== 1 || typeof input["kind"] !== "string")
    return failure2("preserved-value");
  switch (input["kind"]) {
    case "missing-value": {
      if (!hasExactDataKeys(input, ["captureSha256", "kind", "occurrence", "state", "v"]))
        return failure2("missing-value");
      const captureSha256 = parseSha256Hex(input["captureSha256"]);
      if (captureSha256 === null || typeof input["occurrence"] !== "string" || input["occurrence"].length === 0 || input["occurrence"].length > 4096 || input["state"] !== "somevalue" && input["state"] !== "novalue")
        return failure2("missing-value");
      return success2({ captureSha256, kind: "missing-value", occurrence: input["occurrence"], state: input["state"], v: 1 });
    }
    case "language-text":
      return hasExactDataKeys(input, ["kind", "language", "text", "v"]) && isKnowledgeLanguageTagV1(input["language"]) && typeof input["text"] === "string" && input["text"].length > 0 ? success2({ kind: "language-text", language: input["language"], text: input["text"], v: 1 }) : failure2("language-text");
    case "wikibase-time": {
      if (!hasExactDataKeys(input, ["after", "before", "calendarmodel", "kind", "precision", "serialization", "time", "timezone", "v"]) || input["serialization"] !== "wikibase-json-v1" || !uri(input["calendarmodel"]) || !natural(input["before"]) || !natural(input["after"]) || !natural(input["precision"]) || input["precision"] > 14 || !Number.isSafeInteger(input["timezone"]) || Math.abs(Number(input["timezone"])) > 1440 || typeof input["time"] !== "string" || !/^[+-][0-9]{4,16}-(?:0[0-9]|1[0-2])-(?:[0-2][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$/u.test(input["time"]))
        return failure2("wikibase-time");
      const match = /-([0-9]{2})-([0-9]{2})T/u.exec(input["time"]);
      if (match === null || input["precision"] >= 10 && match[1] === "00" || input["precision"] >= 11 && match[2] === "00")
        return failure2("wikibase-time.precision");
      return success2({ after: input["after"], before: input["before"], calendarmodel: input["calendarmodel"], kind: "wikibase-time", precision: input["precision"], serialization: "wikibase-json-v1", time: input["time"], timezone: Number(input["timezone"]), v: 1 });
    }
    case "globe-coordinate": {
      if (!hasExactDataKeys(input, ["altitude", "globe", "kind", "latitude", "longitude", "precision", "serialization", "v"]) || input["serialization"] !== "wikibase-json-v1" || !uri(input["globe"]) || !within(input["latitude"], -90, 90) || !within(input["longitude"], -180, 180) || !(input["altitude"] === null || typeof input["altitude"] === "string" && numeric(input["altitude"]) !== null) || !(input["precision"] === null || within(input["precision"], 0, 360)))
        return failure2("globe-coordinate");
      return success2({ altitude: input["altitude"], globe: input["globe"], kind: "globe-coordinate", latitude: input["latitude"], longitude: input["longitude"], precision: input["precision"], serialization: "wikibase-json-v1", v: 1 });
    }
    default:
      return failure2("preserved-value.kind");
  }
}
async function createKnowledgePreservedValueV1(value) {
  const parsed = parseKnowledgePreservedValuePayloadV1(value);
  if (!parsed.ok)
    return parsed;
  const catalog = await spongeKnowledgeReferenceCatalog();
  const schema = catalog.referencePack.schemas.find((item) => item.identity.code === parsed.value.kind);
  if (schema === undefined)
    return failure2("preserved-value.schema");
  const canonicalValue = canonicalJson(parsed.value);
  return success2({ canonicalizerSha256: await sha256Text(canonicalizerIdentity), canonicalValue, kind: "extension", mediaType, schema: schema.ref, v: 1, valueSha256: await sha256Text(canonicalValue) });
}
async function parseKnowledgePreservedValueV1(value) {
  const input = knowledgeDeclarativeJson(value, 65536);
  const extension = parseKnowledgeValueV1(input);
  if (!extension.ok || extension.value.kind !== "extension" || !(await verifyKnowledgeValueV1(extension.value)).ok)
    return failure2("preserved-value.extension");
  let payload;
  try {
    payload = JSON.parse(extension.value.canonicalValue);
  } catch {
    return failure2("preserved-value.canonicalValue");
  }
  const parsed = parseKnowledgePreservedValuePayloadV1(payload);
  if (!parsed.ok)
    return parsed;
  const expected = await createKnowledgePreservedValueV1(parsed.value);
  if (!expected.ok || canonicalJson(extension.value) !== canonicalJson(expected.value))
    return failure2("preserved-value.codec");
  return parsed;
}
// src/research/knowledge-proposal-v2.ts
var SPONGE_AGENT_CORE_CONCEPT_CODES_V2 = [
  "account",
  "agent",
  "artifact",
  "concept",
  "entity",
  "event",
  "information-resource",
  "inquiry",
  "organization",
  "person",
  "place",
  "process",
  "source",
  "work"
];
var SPONGE_AGENT_CORE_PREDICATE_CODES_V2 = [
  "about",
  "authored-by",
  "cites",
  "created-by",
  "derived-from",
  "description",
  "identifier",
  "located-in",
  "name",
  "object",
  "part-of",
  "related-to",
  "same-as"
];
var SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2 = [
  "activity",
  "assertion",
  "context",
  "entity",
  "evidence",
  "identity-operation",
  "inquiry",
  "inquiry-event",
  "schema",
  "shape",
  "statement",
  "type-membership",
  "view",
  "vocabulary"
];
var callerKeyPattern = /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u;
var maximumRecords = 256;
function validCallerKey(value) {
  return typeof value === "string" && value.length <= 512 && callerKeyPattern.test(value);
}
function authorityFreeProposalRecord(kind, value) {
  if (!isRecord(value))
    return false;
  if (kind === "assertion")
    return value["state"] === "proposed" && Array.isArray(value["acceptedPurposes"]) && value["acceptedPurposes"].length === 0 && value["reviewActivitySha256"] === null;
  if (kind === "evidence")
    return value["disclosure"] === "private";
  if (kind === "schema")
    return value["reviewDecisionSha256"] === null;
  if (kind === "activity")
    return value["kind"] !== "human-review";
  return true;
}
async function parseSpongeKnowledgeProposalBundleV2(foreign) {
  const value = knowledgeDeclarativeJson(foreign, 4 * 1024 * 1024, { maxDepth: 48, maxNodes: 250000 });
  if (!isRecord(value) || !exactKeys(value, ["records", "v"]) || value["v"] !== 2 || !Array.isArray(value["records"]) || value["records"].length < 1 || value["records"].length > maximumRecords) {
    return null;
  }
  const parsed = [];
  const callerKinds = new Set(SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1);
  const allowedKinds = new Set(SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2);
  for (const candidate of value["records"]) {
    if (!isRecord(candidate))
      return null;
    const hasCallerKey = Object.hasOwn(candidate, "callerRecordKey");
    if (!exactKeys(candidate, hasCallerKey ? ["callerRecordKey", "kind", "value"] : ["kind", "value"]))
      return null;
    const kind = SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2.find((item) => item === candidate["kind"]);
    if (kind === undefined || !allowedKinds.has(kind))
      return null;
    const needsCallerKey = callerKinds.has(kind);
    if (hasCallerKey !== needsCallerKey)
      return null;
    const callerRecordKey = hasCallerKey && validCallerKey(candidate["callerRecordKey"]) ? candidate["callerRecordKey"] : undefined;
    if (needsCallerKey && callerRecordKey === undefined)
      return null;
    const record = await parseKnowledgeGraphRecordV1(kind, candidate["value"]);
    if (!record.ok || !authorityFreeProposalRecord(kind, record.value.value))
      return null;
    const recordKey = knowledgeGraphRecordKeyV1(kind, record.value.value, callerRecordKey);
    if (!recordKey.ok)
      return null;
    const input = {
      ...callerRecordKey === undefined ? {} : { callerRecordKey },
      kind,
      value: record.value.value
    };
    const orderPayload = {
      kind,
      recordKey: recordKey.value,
      recordSha256: record.value.recordSha256,
      v: 2
    };
    parsed.push({ input, orderKey: canonicalJson(orderPayload) });
  }
  parsed.sort((left, right) => left.orderKey.localeCompare(right.orderKey));
  if (parsed.some((item, index) => index > 0 && parsed[index - 1]?.orderKey === item.orderKey))
    return null;
  return { records: parsed.map((item) => item.input), v: 2 };
}
// src/research/knowledge-proposal-v3.ts
function key2(value) {
  return typeof value === "string" && value.length <= 96 && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u.test(value);
}
function canonical(value) {
  return canonicalJson(value);
}
function ref(value) {
  const parsed = parseKnowledgeSchemaRefV1(value);
  return parsed.ok ? parsed.value : null;
}
function refs2(value) {
  if (!Array.isArray(value) || value.length > 256)
    return null;
  const parsed = value.map(ref);
  if (parsed.some((item) => item === null))
    return null;
  const sorted = parsed.sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
  return new Set(sorted.map(canonical)).size === sorted.length ? sorted : null;
}
function entityReference(value) {
  if (!isPlainRecord(value))
    return null;
  if (value["kind"] === "key" && hasExactDataKeys(value, ["kind", "key"]) && key2(value["key"])) {
    return { kind: "key", key: value["key"] };
  }
  if (value["kind"] === "existing" && hasExactDataKeys(value, ["kind", "entityId"])) {
    const entityId = parseKnowledgeEntityId(value["entityId"]);
    if (entityId !== null)
      return { kind: "existing", entityId };
  }
  return null;
}
function draftValue(value, depth = 0) {
  if (depth > 16 || !isPlainRecord(value))
    return null;
  if (value["kind"] === "entity-key" && hasExactDataKeys(value, ["kind", "entityKey"]) && key2(value["entityKey"])) {
    return { kind: "entity-key", entityKey: value["entityKey"] };
  }
  if ((value["kind"] === "list" || value["kind"] === "set") && hasExactDataKeys(value, ["kind", "values", "v"]) && value["v"] === 1 && Array.isArray(value["values"]) && value["values"].length <= 256) {
    const values = value["values"].map((item) => draftValue(item, depth + 1));
    if (values.some((item) => item === null))
      return null;
    const parsed2 = values;
    if (value["kind"] === "set") {
      parsed2.sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
      if (new Set(parsed2.map(canonical)).size !== parsed2.length)
        return null;
    }
    return { kind: value["kind"], values: parsed2, v: 1 };
  }
  const parsed = parseKnowledgeValueV1(value);
  return parsed.ok ? parsed.value : null;
}
function dimensions(value) {
  if (!Array.isArray(value) || value.length > 64)
    return null;
  const parsed = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactDataKeys(item, ["predicate", "value"]))
      return null;
    const predicate = ref(item["predicate"]);
    const child = draftValue(item["value"]);
    if (predicate === null || child === null)
      return null;
    parsed.push({ predicate, value: child });
  }
  parsed.sort((a, b) => canonical(a) < canonical(b) ? -1 : 1);
  return new Set(parsed.map(canonical)).size === parsed.length ? parsed : null;
}
function parseSpongeKnowledgeProposalDraftV3(foreign) {
  const value = knowledgeDeclarativeJson(foreign, 256 * 1024);
  if (!isPlainRecord(value) || !hasExactDataKeys(value, ["v", "entities", "facts", "contexts", "evidence", "vocabularyDependencies"]) || value["v"] !== 3 || !Array.isArray(value["entities"]) || value["entities"].length > 32 || !Array.isArray(value["facts"]) || value["facts"].length > 128 || !Array.isArray(value["contexts"]) || value["contexts"].length > 32 || !Array.isArray(value["evidence"]) || value["evidence"].length > 128)
    return null;
  const entities = [];
  for (const item of value["entities"]) {
    if (!isPlainRecord(item) || !key2(item["key"]))
      return null;
    if (item["kind"] === "existing" && hasExactDataKeys(item, ["key", "kind", "entityId"])) {
      const entityId = parseKnowledgeEntityId(item["entityId"]);
      if (entityId === null)
        return null;
      entities.push({ key: item["key"], kind: "existing", entityId });
    } else if (item["kind"] === "new" && hasExactDataKeys(item, ["key", "kind", "concepts", "name"]) && isPlainRecord(item["name"]) && hasExactDataKeys(item["name"], ["language", "text"])) {
      const concepts = refs2(item["concepts"]);
      const name = parseKnowledgeValueV1({ kind: "text", v: 1, ...item["name"] });
      if (concepts === null || concepts.length === 0 || concepts.length > 16 || !name.ok || name.value.kind !== "text")
        return null;
      entities.push({
        key: item["key"],
        kind: "new",
        concepts,
        name: { language: name.value.language, text: name.value.text }
      });
    } else
      return null;
  }
  const facts = [];
  for (const item of value["facts"]) {
    if (!isPlainRecord(item) || !hasExactDataKeys(item, ["key", "subject", "predicate", "object", "qualifiers", "contextKey", "stance"]) || !key2(item["key"]))
      return null;
    const subject = entityReference(item["subject"]);
    const predicate = ref(item["predicate"]);
    const object = draftValue(item["object"]);
    const qualifiers = dimensions(item["qualifiers"]);
    const stance = SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1.find((candidate) => candidate === item["stance"]);
    if (subject === null || predicate === null || object === null || qualifiers === null || stance === undefined || !(item["contextKey"] === null || key2(item["contextKey"])))
      return null;
    facts.push({ key: item["key"], subject, predicate, object, qualifiers, contextKey: item["contextKey"], stance });
  }
  const contexts = [];
  for (const item of value["contexts"]) {
    if (!isPlainRecord(item) || !hasExactDataKeys(item, ["key", "scenario", "dimensions"]) || !key2(item["key"]))
      return null;
    const scenario = SPONGE_KNOWLEDGE_SCENARIOS_V1.find((candidate) => candidate === item["scenario"]);
    const parsed = dimensions(item["dimensions"]);
    if (scenario === undefined || parsed === null)
      return null;
    contexts.push({ key: item["key"], scenario, dimensions: parsed });
  }
  const evidence = [];
  for (const item of value["evidence"]) {
    if (!isPlainRecord(item) || !hasExactDataKeys(item, ["key", "factKey", "source", "bearing", "selector", "attribution"]) || !key2(item["key"]) || !key2(item["factKey"]) || !(item["selector"] === null || typeof item["selector"] === "string" && item["selector"].length > 0 && item["selector"].length <= 4096) || !isPlainRecord(item["attribution"]) || !hasExactDataKeys(item["attribution"], ["kind", "sourceUri"]) || item["attribution"]["kind"] !== "agent-supplied")
      return null;
    const source = entityReference(item["source"]);
    const bearing = SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1.find((candidate) => candidate === item["bearing"]);
    const sourceUri = item["attribution"]["sourceUri"];
    if (source === null || bearing === undefined || !(sourceUri === null || typeof sourceUri === "string"))
      return null;
    if (sourceUri !== null && !parseKnowledgeValueV1({ kind: "uri", uri: sourceUri, v: 1 }).ok)
      return null;
    evidence.push({
      key: item["key"],
      factKey: item["factKey"],
      source,
      bearing,
      selector: item["selector"],
      attribution: { kind: "agent-supplied", sourceUri }
    });
  }
  const vocabularyDependencies = refs2(value["vocabularyDependencies"]);
  if (vocabularyDependencies === null || facts.length + entities.length + contexts.length + evidence.length === 0)
    return null;
  const all = [...entities, ...facts, ...contexts, ...evidence];
  if (new Set(all.map((item) => item.key)).size !== all.length)
    return null;
  const entityKeys = new Set(entities.map((item) => item.key));
  const contextKeys = new Set(contexts.map((item) => item.key));
  const factKeys = new Set(facts.map((item) => item.key));
  const validReference = (item) => item.kind === "existing" || entityKeys.has(item.key);
  const validValue = (item) => item.kind === "entity-key" ? entityKeys.has(item.entityKey) : item.kind === "list" || item.kind === "set" ? item.values.every(validValue) : true;
  if (facts.some((item) => !validReference(item.subject) || !validValue(item.object) || item.qualifiers.some((dimension) => !validValue(dimension.value)) || item.contextKey !== null && !contextKeys.has(item.contextKey)) || contexts.some((item) => item.dimensions.some((dimension) => !validValue(dimension.value))) || evidence.some((item) => !validReference(item.source) || !factKeys.has(item.factKey)))
    return null;
  const sortKeys = (items) => items.sort((a, b) => a.key < b.key ? -1 : 1);
  return freezeKnowledgeDeclaration({
    v: 3,
    entities: sortKeys(entities),
    facts: sortKeys(facts),
    contexts: sortKeys(contexts),
    evidence: sortKeys(evidence),
    vocabularyDependencies
  });
}
// src/research/knowledge-proposal-compiler-v3.ts
function canonical2(value) {
  return canonicalJson(value);
}
function required(result) {
  if (!result.ok || result.value === undefined)
    throw new Error("Invalid external proposal dependency.");
  return result.value;
}
function compareDecimal(a, b) {
  const parts = (value) => {
    const [integer2 = "0", fraction = ""] = value.replace(/^-/, "").split(".");
    return { negative: value.startsWith("-"), integer: integer2, fraction };
  };
  const left = parts(a);
  const right = parts(b);
  const scale = Math.max(left.fraction.length, right.fraction.length);
  const integer = (value) => BigInt(`${value.integer}${value.fraction.padEnd(scale, "0")}`) * (value.negative ? -1n : 1n);
  const x = integer(left);
  const y = integer(right);
  return x < y ? -1 : x > y ? 1 : 0;
}
async function compileSpongeKnowledgeProposalV3(foreign, authority) {
  const draft = parseSpongeKnowledgeProposalDraftV3(foreign);
  const authorEntityId = parseKnowledgeEntityId(authority.authorEntityId);
  const policySha256 = parseSha256Hex(authority.authoringPolicySha256);
  const receipt = parseSha256Hex(authority.externalOperationReceiptSha256);
  const occurredAt = parseCanonicalInstantV1(authority.occurredAt);
  if (draft === null || authorEntityId === null || policySha256 === null || receipt === null || occurredAt === null || !/^[A-Za-z0-9][A-Za-z0-9._:/@#~-]{7,159}$/u.test(authority.spaceId) || authority.schemas.length > 1024 || authority.existingEntities.size > 1024)
    return null;
  try {
    let schema = function(ref2, kind) {
      const found = schemas.get(canonical2(ref2));
      if (found === undefined || kind !== undefined && found.kind !== kind)
        throw new Error("Unknown exact schema reference.");
      return found;
    }, resolve = function(reference) {
      const id = reference.kind === "key" ? entityIds.get(reference.key) : existing.get(reference.entityId)?.entity.entityId;
      if (id === undefined)
        throw new Error("Unauthorized existing entity reference.");
      return id;
    }, hasConcept = function(entityId, expected) {
      const pending = [...entityConcepts.get(entityId) ?? []];
      const visited = new Set;
      while (pending.length > 0) {
        if (visited.size > 256)
          throw new Error("Concept closure bound reached.");
        const current = pending.pop();
        const key3 = canonical2(current);
        if (key3 === canonical2(expected))
          return true;
        if (visited.has(key3))
          continue;
        visited.add(key3);
        const concept = schema(current, "concept");
        if (concept.kind === "concept")
          pending.push(...concept.broader);
      }
      return false;
    }, resolveValue = function(value) {
      if (value.kind === "entity-key")
        return { kind: "entity", v: 1, entityId: resolve({ kind: "key", key: value.entityKey }) };
      if (value.kind === "entity") {
        if (!existing.has(value.entityId))
          throw new Error("Unauthorized literal entity reference.");
        return value;
      }
      if (value.kind === "list" || value.kind === "set") {
        const values = value.values.map(resolveValue);
        if (value.kind === "set")
          values.sort((a, b) => canonical2(a) < canonical2(b) ? -1 : 1);
        return { kind: value.kind, values, v: 1 };
      }
      if (value.kind === "media" && !existing.has(value.sourceEntityId))
        throw new Error("Unauthorized media source.");
      if (value.kind === "quantity")
        schema(value.unit, "unit");
      if (value.kind === "time" || value.kind === "recurrence")
        schema(value.calendar, "concept");
      if (value.kind === "geometry")
        schema(value.crs, "concept");
      if (value.kind === "identifier")
        schema(value.scheme, "concept");
      if (value.kind === "extension")
        schema(value.schema);
      if (value.kind === "interval") {
        if (value.start !== null)
          resolveValue(value.start);
        if (value.end !== null)
          resolveValue(value.end);
      }
      if (value.kind === "recurrence" && value.startsAt !== null)
        resolveValue(value.startsAt);
      return value;
    }, rangeAccepts = function(value, range) {
      switch (range.kind) {
        case "any":
          return true;
        case "value-kinds":
          return range.valueKinds.includes(value.kind);
        case "entity-concepts":
          return value.kind === "entity" && range.concepts.some((concept) => hasConcept(value.entityId, concept));
        case "text":
          return value.kind === "text" && utf8ByteLength(value.text) <= range.maximumBytes && (range.languages === null || range.languages.includes(value.language));
        case "enum":
          return range.values.some((candidate) => canonical2(candidate) === canonical2(value));
        case "numeric": {
          const numeric2 = value.kind === "integer" || value.kind === "decimal" || value.kind === "quantity" ? value.value : null;
          return numeric2 !== null && (range.unit === null || value.kind === "quantity" && canonical2(value.unit) === canonical2(range.unit)) && (range.lowerBound === null || compareDecimal(numeric2, range.lowerBound) >= 0) && (range.upperBound === null || compareDecimal(numeric2, range.upperBound) <= 0);
        }
      }
    }, predicate = function(ref2) {
      const found = schema(ref2, "predicate");
      if (found.kind !== "predicate")
        throw new Error("Invalid predicate.");
      return found;
    };
    const schemas = new Map;
    for (const foreignSchema of authority.schemas) {
      const copied = knowledgeDeclarativeJson(foreignSchema);
      const schema2 = required(await parseKnowledgeSchemaRevisionV1(copied));
      const id = canonical2(schema2.ref);
      if (schemas.has(id))
        return null;
      schemas.set(id, schema2);
    }
    const existing = new Map;
    for (const [id, item] of authority.existingEntities) {
      const entity = required(parseKnowledgeEntityV1(knowledgeDeclarativeJson(item.entity)));
      if (entity.entityId !== id || entity.state !== "active" || entity.redirectEntityId !== null || item.concepts.length > 64)
        return null;
      const concepts = item.concepts.map((item2) => required(parseKnowledgeSchemaRefV1(knowledgeDeclarativeJson(item2))));
      for (const concept of concepts)
        schema(concept, "concept");
      if (new Set(concepts.map(canonical2)).size !== concepts.length)
        return null;
      existing.set(id, { entity, concepts });
    }
    if (!existing.has(authorEntityId))
      return null;
    const draftSha256 = await sha256Text(canonical2({ domain: "sponge.external-knowledge-draft.v3", draft, v: 3 }));
    const operation = { externalOperationReceiptSha256: receipt, draftSha256, spaceId: authority.spaceId, v: 3 };
    const digestId = async (prefix, kind, key3) => `${prefix}_${(await sha256Text(canonical2({ ...operation, domain: `sponge.external-proposal.${kind}.v3`, key: key3 }))).slice(0, 24)}`;
    const callerPrefix = `external.${receipt.slice(0, 24)}.${draftSha256.slice(0, 16)}`;
    const core = await spongeCoreKnowledgeCatalogV1();
    const identifierPredicate = core.predicates.find((item) => item.identity.code === "identifier");
    if (identifierPredicate === undefined)
      return null;
    schema(identifierPredicate.ref, "predicate");
    const provenance = required(await createKnowledgeContextV1({ scenario: "actual", dimensions: [
      { predicate: identifierPredicate.ref, value: { kind: "uri", uri: `urn:sponge:external-operation:sha256:${receipt}`, v: 1 }, v: 1 },
      { predicate: identifierPredicate.ref, value: { kind: "uri", uri: `urn:sponge:external-draft:sha256:${draftSha256}`, v: 1 }, v: 1 }
    ], v: 1 }));
    const actor = { kind: "entity", entityId: authorEntityId, v: 1 };
    const activity = required(await createKnowledgeActivityV1({
      actor,
      kind: "model-proposal",
      occurredAt,
      inputSha256s: [provenance.contextSha256],
      outputSha256s: [],
      policySha256,
      tool: null,
      v: 1
    }));
    const records = [
      { kind: "context", callerRecordKey: `${callerPrefix}.provenance`, value: provenance },
      { kind: "activity", callerRecordKey: `${callerPrefix}.activity`, value: activity }
    ];
    const entityIds = new Map;
    const entityConcepts = new Map([...existing].map(([id, item]) => [id, item.concepts]));
    for (const item of draft.entities) {
      if (item.kind === "existing") {
        if (!existing.has(item.entityId))
          return null;
        entityIds.set(item.key, item.entityId);
        continue;
      }
      for (const concept of item.concepts)
        schema(concept, "concept");
      const entityId = parseKnowledgeEntityId(await digestId("kent", "entity", item.key));
      if (entityId === null || existing.has(entityId))
        return null;
      const operationId = `identity.external.${(await sha256Text(canonical2({ ...operation, entityId }))).slice(0, 32)}`;
      const entity = {
        entityId,
        identityOperationId: operationId,
        identityRevision: 1,
        redirectEntityId: null,
        state: "active",
        v: 1
      };
      const identity = required(await createKnowledgeIdentityOperationV1({
        activitySha256: activity.activitySha256,
        assignments: [],
        kind: "create",
        occurredAt,
        operationId,
        postimageEntities: [entity],
        preimageEntities: [],
        v: 1
      }));
      records.push({ kind: "entity", value: entity }, { kind: "identity-operation", value: identity });
      entityIds.set(item.key, entityId);
      entityConcepts.set(entityId, item.concepts);
    }
    async function dimension(item) {
      const relation = predicate(item.predicate);
      const value = resolveValue(item.value);
      if (!rangeAccepts(value, relation.range) || !(await verifyKnowledgeValueV1(value)).ok)
        throw new Error("Invalid dimension value.");
      return { predicate: relation.ref, value, v: 1 };
    }
    const contexts = new Map;
    for (const item of draft.contexts) {
      const context = required(await createKnowledgeContextV1({
        scenario: item.scenario,
        dimensions: await Promise.all(item.dimensions.map(dimension)),
        v: 1
      }));
      contexts.set(item.key, context);
      records.push({ kind: "context", callerRecordKey: `${callerPrefix}.context.${item.key}`, value: context });
    }
    async function fact(input) {
      const relation = predicate(input.predicate);
      if (!rangeAccepts(input.object, relation.range) || relation.domainConcepts.length > 0 && !relation.domainConcepts.some((concept) => hasConcept(input.subject, concept))) {
        throw new Error("Predicate domain or range mismatch.");
      }
      if (input.qualifiers.some((item) => !relation.qualifierPredicates.some((allowed) => canonical2(allowed) === canonical2(item.predicate)))) {
        throw new Error("Undeclared qualifier predicate.");
      }
      const statement = required(await createKnowledgeStatementV1({
        subject: input.subject,
        predicate: relation.ref,
        object: input.object,
        qualifiers: await Promise.all(input.qualifiers.map(dimension)),
        v: 1
      }));
      const assertionId = parseKnowledgeAssertionId(await digestId("kast", "assertion", input.key));
      if (assertionId === null)
        throw new Error("Invalid assertion identity.");
      const assertion = required(await createKnowledgeAssertionV1({
        acceptedPurposes: [],
        assertionId,
        assertor: actor,
        confidence: null,
        contextSha256: input.context?.contextSha256 ?? null,
        provenanceActivitySha256: activity.activitySha256,
        reviewActivitySha256: null,
        stance: input.stance,
        state: "proposed",
        statementSha256: statement.statementSha256,
        v: 1
      }));
      records.push({ kind: "statement", callerRecordKey: `${callerPrefix}.fact.${input.key}`, value: statement }, { kind: "assertion", value: assertion });
      return assertion;
    }
    const namePredicate = core.predicates.find((item) => item.identity.code === "name");
    if (namePredicate === undefined)
      return null;
    for (const item of draft.entities) {
      if (item.kind !== "new")
        continue;
      const subject = resolve({ kind: "key", key: item.key });
      const name = await fact({
        key: `name.${item.key}`,
        subject,
        predicate: namePredicate.ref,
        object: { kind: "text", language: item.name.language, text: item.name.text, v: 1 },
        qualifiers: [],
        context: null,
        stance: "reports"
      });
      for (const concept of item.concepts) {
        const membership = required(await createKnowledgeTypeMembershipV1({
          entityId: subject,
          concept,
          assertionSha256: name.assertionSha256,
          contextSha256: null,
          validDuring: null,
          v: 1
        }));
        records.push({
          kind: "type-membership",
          callerRecordKey: `${callerPrefix}.membership.${item.key}.${concept.schemaSha256.slice(0, 16)}`,
          value: membership
        });
      }
    }
    const assertions = new Map;
    for (const item of draft.facts) {
      assertions.set(item.key, await fact({
        key: `draft.${item.key}`,
        predicate: item.predicate,
        subject: resolve(item.subject),
        object: resolveValue(item.object),
        qualifiers: item.qualifiers,
        context: item.contextKey === null ? null : contexts.get(item.contextKey) ?? null,
        stance: item.stance
      }));
    }
    const sourceAttributions = [];
    for (const item of draft.evidence) {
      const assertion = assertions.get(item.factKey);
      const evidenceId = parseKnowledgeEvidenceId(await digestId("kevd", "evidence", item.key));
      if (assertion === undefined || evidenceId === null)
        return null;
      const sourceEntityId = resolve(item.source);
      const selector = canonical2({
        kind: "agent-supplied-source-attribution",
        sourceUri: item.attribution.sourceUri,
        selector: item.selector,
        v: 3
      });
      const evidence = required(await createKnowledgeEvidenceLinkV1({
        assertionSha256: assertion.assertionSha256,
        bearing: item.bearing,
        disclosure: "private",
        evidenceId,
        observationSha256: null,
        provenanceActivitySha256: activity.activitySha256,
        selector,
        sourceEntityId,
        v: 1
      }));
      records.push({ kind: "evidence", value: evidence });
      sourceAttributions.push({
        evidenceSha256: evidence.evidenceSha256,
        kind: "agent-supplied",
        sourceEntityId,
        sourceUri: item.attribution.sourceUri,
        selector: item.selector,
        disclosure: "private"
      });
    }
    const schemaCandidates = draft.vocabularyDependencies.map((ref2) => ({ status: "unreviewed", schema: schema(ref2) }));
    if (records.length > 256)
      return null;
    const bundle = await parseSpongeKnowledgeProposalBundleV2({ records, v: 2 });
    if (bundle === null)
      return null;
    return freezeKnowledgeDeclaration({
      v: 3,
      bundle,
      draftSha256,
      externalOperationReceiptSha256: receipt,
      entityIds: Object.fromEntries(entityIds),
      sourceAttributions,
      schemaCandidates
    });
  } catch {
    return null;
  }
}
// src/research/knowledge-wikidata-import-v1.ts
var KNOWLEDGE_WIKIDATA_IMPORTER_V1 = "sponge.wikidata-json-import.v1";
var KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1 = Object.freeze({
  maxEntities: 100,
  maxStatements: 1000,
  maxRecords: 4096,
  maxSourceBytes: 8 * 1024 * 1024
});
function failure3(field, code2 = "invalid-input") {
  return { ok: false, error: { code: code2, field, retryable: false } };
}
function asJson(value) {
  return value;
}
function boundedText(value, max = 256) {
  return typeof value === "string" && value.length > 0 && utf8ByteLength(value) <= max && value.normalize("NFC") === value && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
}
function isKnowledgeWikidataEntityIdV1(value) {
  return typeof value === "string" && /^(?:Q[1-9][0-9]*|P[1-9][0-9]*|L[1-9][0-9]*(?:-[FS][1-9][0-9]*)?)$/u.test(value) && value.length <= 64;
}
function propertyId(value) {
  return isKnowledgeWikidataEntityIdV1(value) && value.startsWith("P");
}
function properties(value) {
  if (!Array.isArray(value) || value.length > 256 || !value.every(propertyId) || new Set(value).size !== value.length)
    return null;
  return [...value].sort();
}
function parseCoverage(value) {
  if (!isPlainRecord(value))
    return null;
  if (value["kind"] === "complete-entity" && hasExactDataKeys(value, ["kind"])) {
    return { kind: "complete-entity" };
  }
  if (value["kind"] === "selected-properties" && hasExactDataKeys(value, ["kind", "properties"])) {
    const selected = properties(value["properties"]);
    return selected === null ? null : { kind: "selected-properties", properties: selected };
  }
  if (value["kind"] === "partial" && hasExactDataKeys(value, ["kind", "reason"]) && boundedText(value["reason"]))
    return { kind: "partial", reason: value["reason"] };
  return null;
}
function parseCapture(value) {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, ["requestedId", "resolvedId", "sourceUri", "capturedAt", "body", "redirects", "coverage"]) || !isKnowledgeWikidataEntityIdV1(value["requestedId"]) || !isKnowledgeWikidataEntityIdV1(value["resolvedId"]) || !boundedText(value["sourceUri"], 4096) || parseCanonicalInstantV1(value["capturedAt"]) === null || typeof value["body"] !== "string" || !Array.isArray(value["redirects"]) || value["redirects"].length > 16)
    return null;
  let url;
  try {
    url = new URL(value["sourceUri"]);
  } catch {
    return null;
  }
  if (url.origin !== "https://www.wikidata.org" || url.username || url.password || url.hash || !(url.pathname === "/w/api.php" || /^\/wiki\/Special:EntityData\/(?:Q|P|L)[1-9][0-9]*(?:-[FS][1-9][0-9]*)?\.json$/u.test(url.pathname)))
    return null;
  const redirects = [];
  let last = value["requestedId"];
  const seen = new Set([last]);
  for (const redirect of value["redirects"]) {
    if (!isPlainRecord(redirect) || !hasExactDataKeys(redirect, ["from", "to"]) || redirect["from"] !== last || !isKnowledgeWikidataEntityIdV1(redirect["to"]) || seen.has(redirect["to"]))
      return null;
    redirects.push({ from: last, to: redirect["to"] });
    last = redirect["to"];
    seen.add(last);
  }
  const coverage = parseCoverage(value["coverage"]);
  if (last !== value["resolvedId"] || coverage === null)
    return null;
  return {
    requestedId: value["requestedId"],
    resolvedId: value["resolvedId"],
    sourceUri: value["sourceUri"],
    capturedAt: value["capturedAt"],
    body: value["body"],
    redirects,
    coverage
  };
}
function parseKnowledgeWikidataImportInputV1(value) {
  value = knowledgeDeclarativeJson(value, 2 * KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxSourceBytes, { preserveStrings: true, maxDepth: 12 });
  if (!isPlainRecord(value) || !hasExactDataKeys(value, Object.hasOwn(value, "bounds") ? ["v", "captures", "properties", "mappingVersion", "bounds"] : ["v", "captures", "properties", "mappingVersion"]) || value["v"] !== 1 || !boundedText(value["mappingVersion"]) || !Array.isArray(value["captures"]) || value["captures"].length === 0 || value["captures"].length > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxEntities)
    return null;
  const selected = properties(value["properties"]);
  const captures = value["captures"].map(parseCapture);
  if (selected === null || captures.some((capture) => capture === null))
    return null;
  let bounds = KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1;
  if (Object.hasOwn(value, "bounds")) {
    const candidate = value["bounds"];
    if (!isPlainRecord(candidate) || !hasExactDataKeys(candidate, Object.keys(bounds)))
      return null;
    for (const [key3, maximum] of Object.entries(bounds)) {
      const item = candidate[key3];
      if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 1 || item > maximum)
        return null;
    }
    bounds = {
      maxEntities: candidate["maxEntities"],
      maxStatements: candidate["maxStatements"],
      maxRecords: candidate["maxRecords"],
      maxSourceBytes: candidate["maxSourceBytes"]
    };
  }
  return {
    v: 1,
    captures,
    properties: selected,
    mappingVersion: value["mappingVersion"],
    bounds
  };
}
function parseEntity(body, resolvedId) {
  let foreign;
  try {
    foreign = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = parseJsonValue(foreign, { maxDepth: 48, maxNodes: 250000 });
  if (!parsed.ok || !isJsonRecord(parsed.value))
    return null;
  const root = parsed.value;
  const entity = isJsonRecord(root["entities"]) ? root["entities"][resolvedId] : root;
  if (!isJsonRecord(entity) || entity["id"] !== resolvedId || typeof entity["lastrevid"] !== "number" || !Number.isSafeInteger(entity["lastrevid"]) || entity["lastrevid"] < 1 || !(entity["type"] === "item" && resolvedId.startsWith("Q") || entity["type"] === "property" && resolvedId.startsWith("P") || entity["type"] === "lexeme" && /^L[1-9][0-9]*$/u.test(resolvedId)))
    return null;
  return entity;
}
function decimal(value) {
  return typeof value === "string" && value.length <= 1024 && /^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function entityValue(value) {
  if (!isJsonRecord(value))
    return false;
  const id = value["id"];
  const kind = value["entity-type"];
  const numericId = value["numeric-id"];
  if (id !== undefined) {
    if (!isKnowledgeWikidataEntityIdV1(id))
      return false;
    const expected = id.startsWith("Q") ? "item" : id.startsWith("P") ? "property" : id.includes("-F") ? "form" : id.includes("-S") ? "sense" : "lexeme";
    if (kind !== expected)
      return false;
    return numericId === undefined || typeof numericId === "number" && Number.isSafeInteger(numericId) && numericId > 0 && !id.includes("-") && id.slice(1) === String(numericId);
  }
  return (kind === "item" || kind === "property" || kind === "lexeme") && typeof numericId === "number" && Number.isSafeInteger(numericId) && numericId > 0;
}
function supportedDatavalue(datatype, datavalue) {
  const value = datavalue["value"];
  if (value === undefined)
    return false;
  const type = datavalue["type"];
  if (["wikibase-item", "wikibase-property", "wikibase-lexeme", "wikibase-form", "wikibase-sense"].includes(datatype)) {
    return type === "wikibase-entityid" && entityValue(value) && isJsonRecord(value) && datatype === `wikibase-${String(value["entity-type"])}`;
  }
  if (["string", "external-id", "url", "commonsMedia", "math", "musical-notation", "geo-shape", "tabular-data"].includes(datatype)) {
    return type === "string" && typeof value === "string";
  }
  if (!isJsonRecord(value))
    return ["quantity", "time", "globe-coordinate", "monolingualtext"].includes(datatype) ? false : null;
  if (datatype === "monolingualtext")
    return type === "monolingualtext" && typeof value["language"] === "string" && typeof value["text"] === "string";
  if (datatype === "quantity")
    return type === "quantity" && decimal(value["amount"]) && typeof value["unit"] === "string" && (value["lowerBound"] === undefined || value["lowerBound"] === null || decimal(value["lowerBound"])) && (value["upperBound"] === undefined || value["upperBound"] === null || decimal(value["upperBound"]));
  if (datatype === "time")
    return type === "time" && typeof value["time"] === "string" && /^[+-][0-9]{4,16}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u.test(value["time"]) && typeof value["calendarmodel"] === "string" && ["timezone", "before", "after", "precision"].every((key3) => Number.isSafeInteger(value[key3])) && value["before"] >= 0 && value["after"] >= 0 && value["precision"] >= 0 && value["precision"] <= 14;
  if (datatype === "globe-coordinate")
    return type === "globecoordinate" && finiteNumber(value["latitude"]) && finiteNumber(value["longitude"]) && Math.abs(value["latitude"]) <= 90 && Math.abs(value["longitude"]) <= 180 && (value["altitude"] === null || finiteNumber(value["altitude"])) && (value["precision"] === null || finiteNumber(value["precision"]) && value["precision"] >= 0) && typeof value["globe"] === "string";
  return null;
}
function preserveValue(raw, selector, captureSha256) {
  const state = raw["snaktype"];
  if ((state === "somevalue" || state === "novalue") && raw["datavalue"] === undefined) {
    return { kind: "absence", state, captureSha256, occurrence: selector };
  }
  const datatype = typeof raw["datatype"] === "string" ? raw["datatype"] : null;
  const datavalue = raw["datavalue"];
  const supported = datatype !== null && isJsonRecord(datavalue) ? supportedDatavalue(datatype, datavalue) : false;
  if (state === "value" && datatype !== null && datavalue !== undefined && supported === true) {
    return { kind: "typed-source-value", datatype, datavalue };
  }
  return {
    kind: "unsupported",
    reason: supported === null ? "unknown-datatype" : "invalid-datavalue",
    datatype,
    raw
  };
}
function extract(entity, captureSha256, selected) {
  const metadata = [];
  const groups = [];
  let invalidMetadata = 0;
  function addMetadata(entityId, path, raw) {
    metadata.push({ kind: "metadata", captureSha256, selector: { kind: "metadata", entityId, path }, raw });
  }
  function visit(record, path, entityId) {
    const terms = ["labels", "descriptions", "aliases", "sitelinks", "lemmas", "representations", "glosses"];
    for (const field of terms) {
      const values = record[field];
      if (values === undefined)
        continue;
      if (!isJsonRecord(values)) {
        invalidMetadata += 1;
        continue;
      }
      for (const language of Object.keys(values).sort()) {
        const item = values[language];
        if (item === undefined)
          continue;
        if (field === "aliases") {
          if (!Array.isArray(item)) {
            invalidMetadata += 1;
            continue;
          }
          item.forEach((alias, index) => {
            addMetadata(entityId, [...path, field, language, index], alias);
          });
        } else
          addMetadata(entityId, [...path, field, language], item);
      }
    }
    for (const field of ["language", "lexicalCategory", "grammaticalFeatures", "datatype"]) {
      if (record[field] !== undefined)
        addMetadata(entityId, [...path, field], record[field]);
    }
    const claims = record["claims"];
    if (claims !== undefined) {
      if (!isJsonRecord(claims))
        invalidMetadata += 1;
      else
        for (const id of Object.keys(claims).sort()) {
          if (propertyId(id) && claims[id] !== undefined)
            groups.push({ entityId, propertyId: id, raw: claims[id] });
          else
            invalidMetadata += 1;
        }
    }
    for (const id of selected) {
      if (!groups.some((group) => group.entityId === entityId && group.propertyId === id)) {
        groups.push({ entityId, propertyId: id, raw: claims === undefined || isJsonRecord(claims) ? [] : null });
      }
    }
    for (const field of ["forms", "senses"]) {
      const members = record[field];
      if (members === undefined)
        continue;
      if (!Array.isArray(members)) {
        invalidMetadata += 1;
        continue;
      }
      const seen = new Set;
      members.forEach((member, index) => {
        if (!isJsonRecord(member) || !isKnowledgeWikidataEntityIdV1(member["id"]) || !member["id"].startsWith(`${entityId}-${field === "forms" ? "F" : "S"}`) || seen.has(member["id"])) {
          invalidMetadata += 1;
          return;
        }
        seen.add(member["id"]);
        addMetadata(member["id"], [...path, field, index, "id"], member["id"]);
        visit(member, [...path, field, index], member["id"]);
      });
    }
  }
  visit(entity, [], entity["id"]);
  return { metadata, groups, invalidMetadata };
}
function groupRecords(group, captureSha256) {
  if (!Array.isArray(group.raw))
    return null;
  const result = [];
  const ids = new Set;
  for (let statementIndex = 0;statementIndex < group.raw.length; statementIndex += 1) {
    let addSnak = function(raw, location) {
      if (!isJsonRecord(raw) || !propertyId(raw["property"]) || !["value", "somevalue", "novalue"].includes(String(raw["snaktype"])))
        return false;
      const selector = { ...base, location };
      result.push({ kind: "snak", captureSha256, raw, selector, value: preserveValue(raw, selector, captureSha256) });
      return true;
    };
    const statement = group.raw[statementIndex];
    if (!isJsonRecord(statement) || statement["type"] !== "statement" || !boundedText(statement["id"], 256) || !statement["id"].startsWith(`${group.entityId}$`) || ids.has(statement["id"]) || !isJsonRecord(statement["mainsnak"]) || statement["mainsnak"]["property"] !== group.propertyId || !["normal", "preferred", "deprecated"].includes(String(statement["rank"])))
      return null;
    ids.add(statement["id"]);
    const base = {
      kind: "statement",
      entityId: group.entityId,
      propertyId: group.propertyId,
      statementId: statement["id"],
      statementIndex
    };
    result.push({
      kind: "statement",
      captureSha256,
      raw: statement,
      selector: { ...base, location: { kind: "statement" } },
      rank: statement["rank"]
    });
    if (!addSnak(statement["mainsnak"], { kind: "main" }))
      return null;
    const qualifiers = statement["qualifiers"];
    if (qualifiers !== undefined) {
      if (!isJsonRecord(qualifiers))
        return null;
      for (const id of Object.keys(qualifiers).sort()) {
        const snaks = qualifiers[id];
        if (!propertyId(id) || !Array.isArray(snaks))
          return null;
        for (let snakIndex = 0;snakIndex < snaks.length; snakIndex += 1) {
          const snak = snaks[snakIndex];
          if (!isJsonRecord(snak) || snak["property"] !== id || !addSnak(snak, { kind: "qualifier", propertyId: id, snakIndex }))
            return null;
        }
      }
    }
    const references = statement["references"];
    if (references !== undefined) {
      if (!Array.isArray(references))
        return null;
      for (let referenceIndex = 0;referenceIndex < references.length; referenceIndex += 1) {
        const reference = references[referenceIndex];
        if (!isJsonRecord(reference) || !isJsonRecord(reference["snaks"]) || !(reference["hash"] === undefined || typeof reference["hash"] === "string"))
          return null;
        for (const id of Object.keys(reference["snaks"]).sort()) {
          const snaks = reference["snaks"][id];
          if (!propertyId(id) || !Array.isArray(snaks))
            return null;
          for (let snakIndex = 0;snakIndex < snaks.length; snakIndex += 1) {
            const snak = snaks[snakIndex];
            if (!isJsonRecord(snak) || snak["property"] !== id || !addSnak(snak, {
              kind: "reference",
              referenceIndex,
              referenceHash: typeof reference["hash"] === "string" ? reference["hash"] : null,
              propertyId: id,
              snakIndex
            }))
              return null;
          }
        }
      }
    }
  }
  return result;
}
async function createKnowledgeWikidataImportPreviewV1(foreign) {
  const input = parseKnowledgeWikidataImportInputV1(foreign);
  if (input === null)
    return failure3("input");
  if (input.captures.some((capture) => capture.body.length > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxSourceBytes) || input.captures.reduce((sum, capture) => sum + utf8ByteLength(capture.body), 0) > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxSourceBytes)
    return failure3("captures.body", "input-bound");
  const bounds = input.bounds ?? KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1;
  const sources = [];
  const records = [];
  const coverage = [];
  const omissions = [];
  const retry = new Set;
  let sourceBytes = 0;
  let statements = 0;
  const seenCaptures = new Set;
  for (let captureIndex = 0;captureIndex < input.captures.length; captureIndex += 1) {
    const capture = input.captures[captureIndex];
    const bytes = utf8ByteLength(capture.body);
    const omit = (entityId, propertyId2, reason, count) => {
      omissions.push({ captureIndex, entityId, propertyId: propertyId2, reason, count });
      if (reason !== "property-not-selected" && reason !== "invalid-metadata" && reason !== "invalid-statement-group")
        retry.add(captureIndex);
    };
    if (sources.length >= bounds.maxEntities || sourceBytes + bytes > bounds.maxSourceBytes) {
      omit(capture.resolvedId, null, sources.length >= bounds.maxEntities ? "entity-bound" : "source-byte-bound", 1);
      continue;
    }
    const entity = parseEntity(capture.body, capture.resolvedId);
    if (entity === null)
      return failure3(`captures.${captureIndex}.body`, "invalid-source");
    if (entity["claims"] !== undefined && !isJsonRecord(entity["claims"])) {
      return failure3(`captures.${captureIndex}.body.claims`, "invalid-source");
    }
    const captureSha256 = await sha256Text(capture.body);
    const captureKey = `${capture.requestedId}:${capture.resolvedId}:${captureSha256}`;
    if (seenCaptures.has(captureKey))
      return failure3(`captures.${captureIndex}`, "invalid-source");
    seenCaptures.add(captureKey);
    const source = {
      ...capture,
      captureSha256,
      sourceBytes: bytes,
      revision: entity["lastrevid"],
      serialization: "wikibase-json-v1",
      provenanceStatus: "caller-asserted",
      license: {
        id: "CC0-1.0",
        scope: "wikidata-structured-data-only",
        uri: "https://creativecommons.org/publicdomain/zero/1.0/"
      }
    };
    sources.push(source);
    sourceBytes += bytes;
    const extracted = extract(entity, captureSha256, input.properties);
    if (extracted.invalidMetadata > 0)
      omit(capture.resolvedId, null, "invalid-metadata", extracted.invalidMetadata);
    if (records.length + extracted.metadata.length <= bounds.maxRecords)
      records.push(...extracted.metadata);
    else
      omit(capture.resolvedId, null, "record-bound", extracted.metadata.length);
    for (const group of extracted.groups) {
      const observedStatements = Array.isArray(group.raw) ? group.raw.length : 0;
      if (!input.properties.includes(group.propertyId)) {
        omit(group.entityId, group.propertyId, "property-not-selected", observedStatements);
        continue;
      }
      const groupValues = groupRecords(group, captureSha256);
      let retainedStatements = 0;
      let retained = false;
      if (groupValues === null)
        omit(group.entityId, group.propertyId, "invalid-statement-group", observedStatements);
      else if (statements + observedStatements > bounds.maxStatements)
        omit(group.entityId, group.propertyId, "statement-bound", observedStatements);
      else if (records.length + groupValues.length > bounds.maxRecords)
        omit(group.entityId, group.propertyId, "record-bound", groupValues.length);
      else {
        records.push(...groupValues);
        retainedStatements = observedStatements;
        retained = true;
        statements += observedStatements;
      }
      const assertedComplete = capture.coverage.kind === "complete-entity" || capture.coverage.kind === "selected-properties" && capture.coverage.properties.includes(group.propertyId);
      coverage.push({
        captureSha256,
        entityId: group.entityId,
        propertyId: group.propertyId,
        observedStatements,
        retainedStatements,
        status: retained && assertedComplete ? "complete-in-asserted-source" : "incomplete",
        sourceCoverage: "caller-asserted",
        definitiveAnswer: false
      });
    }
  }
  const mappingCandidates = records.flatMap((record) => {
    if (record.kind !== "snak" || record.selector.kind !== "statement")
      return [];
    const property = record.selector.location.kind === "qualifier" || record.selector.location.kind === "reference" ? record.selector.location.propertyId : record.selector.propertyId;
    return [{
      captureSha256: record.captureSha256,
      selector: record.selector,
      propertyId: property,
      status: record.value.kind === "unsupported" ? "unsupported-value" : "requires-property-mapping",
      value: record.value,
      normalization: "none",
      eligibleForAdmission: false,
      diagnostics: record.value.kind === "unsupported" ? ["unsupported-source-value"] : [
        "property-mapping-required",
        ...record.value.kind === "typed-source-value" && record.value.datatype === "time" ? ["time-normalization-unsupported"] : [],
        ...record.value.kind === "typed-source-value" && record.value.datatype === "globe-coordinate" ? ["coordinate-normalization-unsupported"] : [],
        ...record.value.kind === "typed-source-value" && record.value.datatype === "quantity" ? ["quantity-unit-mapping-required"] : []
      ]
    }];
  });
  const payload = {
    v: 1,
    kind: "wikidata-import-preview",
    provider: "wikidata",
    importerVersion: KNOWLEDGE_WIKIDATA_IMPORTER_V1,
    mappingVersion: input.mappingVersion,
    status: "unadmitted",
    disclosure: "private",
    identityResolution: "candidate-only",
    properties: input.properties,
    bounds,
    sources,
    identityCandidates: sources.map((source) => ({
      requestedId: source.requestedId,
      resolvedId: source.resolvedId,
      revision: source.revision,
      captureSha256: source.captureSha256,
      redirects: source.redirects,
      localIdentity: null
    })),
    records,
    mappingCandidates,
    coverage,
    omissions,
    cursor: retry.size === 0 ? null : { kind: "retry-with-selection", captureIndices: [...retry] }
  };
  return { ok: true, value: { ...payload, previewSha256: await sha256Text(canonicalJson(asJson(payload))) } };
}
function canonicalKnowledgeWikidataImportPreviewV1(value) {
  return canonicalJson(asJson(value));
}
async function verifyKnowledgeWikidataImportPreviewV1(foreign, input) {
  const rebuilt = await createKnowledgeWikidataImportPreviewV1(input);
  if (!rebuilt.ok)
    return rebuilt;
  const parsed = knowledgeDeclarativeJson(foreign, 8 * KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1.maxSourceBytes, { preserveStrings: true, maxDepth: 64, maxNodes: 1e6 });
  if (parsed === undefined || canonicalJson(parsed) !== canonicalKnowledgeWikidataImportPreviewV1(rebuilt.value)) {
    return failure3("preview", "integrity-mismatch");
  }
  return rebuilt;
}
// src/research/knowledge-wikidata-import-v2.ts
var KNOWLEDGE_WIKIDATA_IMPORTER_V2 = "sponge.wikidata-json-import.v2";
var KNOWLEDGE_WIKIDATA_DATATYPES_V2 = Object.freeze([
  "commonsMedia",
  "entity-schema",
  "external-id",
  "geo-shape",
  "globe-coordinate",
  "math",
  "monolingualtext",
  "musical-notation",
  "quantity",
  "string",
  "tabular-data",
  "time",
  "url",
  "wikibase-form",
  "wikibase-item",
  "wikibase-lexeme",
  "wikibase-property",
  "wikibase-sense"
]);
function knowledgeWikidataDatatypeSupportV2(datatype) {
  return KNOWLEDGE_WIKIDATA_DATATYPES_V2.some((known) => known === datatype) ? "typed-source-value" : "opaque-source-value";
}
var KNOWLEDGE_WIKIDATA_PROPERTY_GROUP_LIMIT_V2 = 4096;
var KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2 = Object.freeze({
  maxBytes: 64 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1e6,
  maxArrayItems: 250000
});
function boundedKnowledgeWikidataPreviewJsonV2(value) {
  return knowledgeDeclarativeJson(value, KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2.maxBytes, { ...KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2, preserveStrings: true, preserveObjectKeys: true });
}
var KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2 = Object.freeze({
  maxEntities: 100,
  maxStatements: 1000,
  maxRecords: 4096,
  maxSourceBytes: 8 * 1024 * 1024
});
function failure4(field, code2 = "invalid-input") {
  return { ok: false, error: { code: code2, field, retryable: false } };
}
function asJson2(value) {
  return value;
}
function boundedText2(value, max = 256) {
  return typeof value === "string" && value.length > 0 && utf8ByteLength(value) <= max && value.normalize("NFC") === value && !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value);
}
function isKnowledgeWikidataEntityIdV2(value) {
  return typeof value === "string" && /^(?:Q[1-9][0-9]*|P[1-9][0-9]*|E[1-9][0-9]*|L[1-9][0-9]*(?:-[FS][1-9][0-9]*)?)$/u.test(value) && value.length <= 64;
}
function propertyId2(value) {
  return isKnowledgeWikidataEntityIdV2(value) && value.startsWith("P");
}
function properties2(value) {
  if (!Array.isArray(value) || value.length > 256 || !value.every(propertyId2) || new Set(value).size !== value.length)
    return null;
  return [...value].sort();
}
function parseCoverage2(value) {
  if (!isPlainRecord(value))
    return null;
  if (value["kind"] === "complete-entity" && hasExactDataKeys(value, ["kind"])) {
    return { kind: "complete-entity" };
  }
  if (value["kind"] === "selected-properties" && hasExactDataKeys(value, ["kind", "properties"])) {
    const selected = properties2(value["properties"]);
    return selected === null ? null : { kind: "selected-properties", properties: selected };
  }
  if (value["kind"] === "partial" && hasExactDataKeys(value, ["kind", "reason"]) && boundedText2(value["reason"]))
    return { kind: "partial", reason: value["reason"] };
  return null;
}
function parseCapture2(value) {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, ["requestedId", "resolvedId", "sourceUri", "capturedAt", "body", "redirects", "coverage"]) || !isKnowledgeWikidataEntityIdV2(value["requestedId"]) || !isKnowledgeWikidataEntityIdV2(value["resolvedId"]) || !boundedText2(value["sourceUri"], 4096) || parseCanonicalInstantV1(value["capturedAt"]) === null || typeof value["body"] !== "string" || !Array.isArray(value["redirects"]) || value["redirects"].length > 16)
    return null;
  let url;
  try {
    url = new URL(value["sourceUri"]);
  } catch {
    return null;
  }
  if (url.origin !== "https://www.wikidata.org" || url.username || url.password || url.hash || !(url.pathname === "/w/api.php" || /^\/wiki\/Special:EntityData\/(?:Q|P|L)[1-9][0-9]*(?:-[FS][1-9][0-9]*)?\.json$/u.test(url.pathname)))
    return null;
  const redirects = [];
  let last = value["requestedId"];
  const seen = new Set([last]);
  for (const redirect of value["redirects"]) {
    if (!isPlainRecord(redirect) || !hasExactDataKeys(redirect, ["from", "to"]) || redirect["from"] !== last || !isKnowledgeWikidataEntityIdV2(redirect["to"]) || seen.has(redirect["to"]))
      return null;
    redirects.push({ from: last, to: redirect["to"] });
    last = redirect["to"];
    seen.add(last);
  }
  const coverage = parseCoverage2(value["coverage"]);
  if (last !== value["resolvedId"] || coverage === null)
    return null;
  return {
    requestedId: value["requestedId"],
    resolvedId: value["resolvedId"],
    sourceUri: value["sourceUri"],
    capturedAt: value["capturedAt"],
    body: value["body"],
    redirects,
    coverage
  };
}
function parseKnowledgeWikidataImportInputV2(value) {
  value = knowledgeDeclarativeJson(value, 2 * KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2.maxSourceBytes, { preserveStrings: true, maxDepth: 12 });
  if (!isPlainRecord(value) || !hasExactDataKeys(value, Object.hasOwn(value, "bounds") ? ["v", "captures", "properties", "mappingVersion", "bounds"] : ["v", "captures", "properties", "mappingVersion"]) || value["v"] !== 2 || !boundedText2(value["mappingVersion"]) || !Array.isArray(value["captures"]) || value["captures"].length === 0 || value["captures"].length > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2.maxEntities)
    return null;
  const selected = value["properties"] === "all-present" ? "all-present" : properties2(value["properties"]);
  const captures = value["captures"].map(parseCapture2);
  if (selected === null || captures.some((capture) => capture === null))
    return null;
  let bounds = KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2;
  if (Object.hasOwn(value, "bounds")) {
    const candidate = value["bounds"];
    if (!isPlainRecord(candidate) || !hasExactDataKeys(candidate, Object.keys(bounds)))
      return null;
    for (const [key3, maximum] of Object.entries(bounds)) {
      const item = candidate[key3];
      if (typeof item !== "number" || !Number.isSafeInteger(item) || item < 1 || item > maximum)
        return null;
    }
    bounds = {
      maxEntities: candidate["maxEntities"],
      maxStatements: candidate["maxStatements"],
      maxRecords: candidate["maxRecords"],
      maxSourceBytes: candidate["maxSourceBytes"]
    };
  }
  return {
    v: 2,
    captures,
    properties: selected,
    mappingVersion: value["mappingVersion"],
    bounds
  };
}
function parseEntity2(body, resolvedId) {
  let foreign;
  try {
    foreign = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = parseJsonValue(foreign, { maxDepth: 48, maxNodes: 250000 });
  if (!parsed.ok || !isJsonRecord(parsed.value))
    return null;
  const root = parsed.value;
  const entity = isJsonRecord(root["entities"]) ? root["entities"][resolvedId] : root;
  if (!isJsonRecord(entity) || entity["id"] !== resolvedId || typeof entity["lastrevid"] !== "number" || !Number.isSafeInteger(entity["lastrevid"]) || entity["lastrevid"] < 1 || !(entity["type"] === "item" && resolvedId.startsWith("Q") || entity["type"] === "property" && resolvedId.startsWith("P") || entity["type"] === "lexeme" && /^L[1-9][0-9]*$/u.test(resolvedId)))
    return null;
  return entity;
}
function decimal2(value) {
  return typeof value === "string" && value.length <= 1024 && /^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}
function finiteNumber2(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function entityValue2(value) {
  if (!isJsonRecord(value))
    return false;
  const id = value["id"];
  const kind = value["entity-type"];
  const numericId = value["numeric-id"];
  if (id !== undefined) {
    if (!isKnowledgeWikidataEntityIdV2(id))
      return false;
    const expected = id.startsWith("Q") ? "item" : id.startsWith("P") ? "property" : id.startsWith("E") ? "entity-schema" : id.includes("-F") ? "form" : id.includes("-S") ? "sense" : "lexeme";
    if (kind !== expected)
      return false;
    return numericId === undefined || typeof numericId === "number" && Number.isSafeInteger(numericId) && numericId > 0 && !id.includes("-") && id.slice(1) === String(numericId);
  }
  return (kind === "item" || kind === "property" || kind === "lexeme" || kind === "entity-schema") && typeof numericId === "number" && Number.isSafeInteger(numericId) && numericId > 0;
}
function supportedDatavalue2(datatype, datavalue) {
  const value = datavalue["value"];
  if (value === undefined)
    return false;
  const type = datavalue["type"];
  if (["wikibase-item", "wikibase-property", "wikibase-lexeme", "wikibase-form", "wikibase-sense", "entity-schema"].includes(datatype)) {
    return type === "wikibase-entityid" && entityValue2(value) && isJsonRecord(value) && (datatype === "entity-schema" ? value["entity-type"] === "entity-schema" : datatype === `wikibase-${String(value["entity-type"])}`);
  }
  if (["string", "external-id", "url", "commonsMedia", "math", "musical-notation", "geo-shape", "tabular-data"].includes(datatype)) {
    return type === "string" && typeof value === "string";
  }
  if (!isJsonRecord(value))
    return ["quantity", "time", "globe-coordinate", "monolingualtext"].includes(datatype) ? false : null;
  if (datatype === "monolingualtext")
    return type === "monolingualtext" && typeof value["language"] === "string" && typeof value["text"] === "string";
  if (datatype === "quantity")
    return type === "quantity" && decimal2(value["amount"]) && typeof value["unit"] === "string" && (value["lowerBound"] === undefined || value["lowerBound"] === null || decimal2(value["lowerBound"])) && (value["upperBound"] === undefined || value["upperBound"] === null || decimal2(value["upperBound"]));
  if (datatype === "time")
    return type === "time" && typeof value["time"] === "string" && /^[+-][0-9]{4,16}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u.test(value["time"]) && typeof value["calendarmodel"] === "string" && ["timezone", "before", "after", "precision"].every((key3) => Number.isSafeInteger(value[key3])) && value["before"] >= 0 && value["after"] >= 0 && value["precision"] >= 0 && value["precision"] <= 14;
  if (datatype === "globe-coordinate")
    return type === "globecoordinate" && finiteNumber2(value["latitude"]) && finiteNumber2(value["longitude"]) && Math.abs(value["latitude"]) <= 90 && Math.abs(value["longitude"]) <= 180 && (value["altitude"] === null || finiteNumber2(value["altitude"])) && (value["precision"] === null || finiteNumber2(value["precision"]) && value["precision"] >= 0) && typeof value["globe"] === "string";
  return null;
}
function preserveValue2(raw, selector, captureSha256) {
  const state = raw["snaktype"];
  if ((state === "somevalue" || state === "novalue") && raw["datavalue"] === undefined) {
    return { kind: "absence", state, captureSha256, occurrence: selector };
  }
  const datatype = typeof raw["datatype"] === "string" ? raw["datatype"] : null;
  const datavalue = raw["datavalue"];
  const supported = datatype !== null && isJsonRecord(datavalue) ? supportedDatavalue2(datatype, datavalue) : false;
  if (state === "value" && datatype !== null && datavalue !== undefined && supported === true) {
    return { kind: "typed-source-value", datatype, datavalue };
  }
  return {
    kind: "unsupported",
    reason: supported === null ? "unknown-datatype" : "invalid-datavalue",
    datatype,
    raw
  };
}

class PropertyGroupBoundError extends Error {
}
function extract2(entity, captureSha256, selected, maximumGroups) {
  const metadata = [];
  const groups = [];
  let invalidMetadata = 0;
  function addGroup(group) {
    if (groups.length >= maximumGroups)
      throw new PropertyGroupBoundError;
    groups.push(group);
  }
  function addMetadata(entityId, path, raw) {
    metadata.push({ kind: "metadata", captureSha256, selector: { kind: "metadata", entityId, path }, raw });
  }
  function visit(record, path, entityId) {
    const terms = ["labels", "descriptions", "aliases", "sitelinks", "lemmas", "representations", "glosses"];
    for (const field of terms) {
      const values = record[field];
      if (values === undefined)
        continue;
      if (!isJsonRecord(values)) {
        invalidMetadata += 1;
        continue;
      }
      for (const language of Object.keys(values).sort()) {
        const item = values[language];
        if (item === undefined)
          continue;
        if (field === "aliases") {
          if (!Array.isArray(item)) {
            invalidMetadata += 1;
            continue;
          }
          item.forEach((alias, index) => {
            addMetadata(entityId, [...path, field, language, index], alias);
          });
        } else
          addMetadata(entityId, [...path, field, language], item);
      }
    }
    for (const field of ["language", "lexicalCategory", "grammaticalFeatures", "datatype"]) {
      if (record[field] !== undefined)
        addMetadata(entityId, [...path, field], record[field]);
    }
    const claims = record["claims"];
    const presentProperties = new Set;
    if (claims !== undefined) {
      if (!isJsonRecord(claims))
        invalidMetadata += 1;
      else
        for (const id of Object.keys(claims).sort()) {
          if (propertyId2(id) && claims[id] !== undefined) {
            addGroup({ entityId, propertyId: id, raw: claims[id] });
            presentProperties.add(id);
          } else
            invalidMetadata += 1;
        }
    }
    for (const id of selected === "all-present" ? [] : selected) {
      if (!presentProperties.has(id)) {
        addGroup({ entityId, propertyId: id, raw: claims === undefined || isJsonRecord(claims) ? [] : null });
      }
    }
    for (const field of ["forms", "senses"]) {
      const members = record[field];
      if (members === undefined)
        continue;
      if (!Array.isArray(members)) {
        invalidMetadata += 1;
        continue;
      }
      const seen = new Set;
      members.forEach((member, index) => {
        if (!isJsonRecord(member) || !isKnowledgeWikidataEntityIdV2(member["id"]) || !member["id"].startsWith(`${entityId}-${field === "forms" ? "F" : "S"}`) || seen.has(member["id"])) {
          invalidMetadata += 1;
          return;
        }
        seen.add(member["id"]);
        addMetadata(member["id"], [...path, field, index, "id"], member["id"]);
        visit(member, [...path, field, index], member["id"]);
      });
    }
  }
  visit(entity, [], entity["id"]);
  return { metadata, groups, invalidMetadata };
}
function groupRecords2(group, captureSha256) {
  if (!Array.isArray(group.raw))
    return null;
  const result = [];
  const ids = new Set;
  for (let statementIndex = 0;statementIndex < group.raw.length; statementIndex += 1) {
    let addSnak = function(raw, location) {
      if (!isJsonRecord(raw) || !propertyId2(raw["property"]) || !["value", "somevalue", "novalue"].includes(String(raw["snaktype"])))
        return false;
      const selector = { ...base, location };
      result.push({ kind: "snak", captureSha256, raw, selector, value: preserveValue2(raw, selector, captureSha256) });
      return true;
    };
    const statement = group.raw[statementIndex];
    if (!isJsonRecord(statement) || statement["type"] !== "statement" || !boundedText2(statement["id"], 256) || statement["id"].slice(0, group.entityId.length + 1).toUpperCase() !== `${group.entityId}$` || ids.has(statement["id"]) || !isJsonRecord(statement["mainsnak"]) || statement["mainsnak"]["property"] !== group.propertyId || !["normal", "preferred", "deprecated"].includes(String(statement["rank"])))
      return null;
    ids.add(statement["id"]);
    const base = {
      kind: "statement",
      entityId: group.entityId,
      propertyId: group.propertyId,
      statementId: statement["id"],
      statementIndex
    };
    result.push({
      kind: "statement",
      captureSha256,
      raw: statement,
      selector: { ...base, location: { kind: "statement" } },
      rank: statement["rank"]
    });
    if (!addSnak(statement["mainsnak"], { kind: "main" }))
      return null;
    const qualifiers = statement["qualifiers"];
    if (qualifiers !== undefined) {
      if (!isJsonRecord(qualifiers))
        return null;
      for (const id of Object.keys(qualifiers).sort()) {
        const snaks = qualifiers[id];
        if (!propertyId2(id) || !Array.isArray(snaks))
          return null;
        for (let snakIndex = 0;snakIndex < snaks.length; snakIndex += 1) {
          const snak = snaks[snakIndex];
          if (!isJsonRecord(snak) || snak["property"] !== id || !addSnak(snak, { kind: "qualifier", propertyId: id, snakIndex }))
            return null;
        }
      }
    }
    const references = statement["references"];
    if (references !== undefined) {
      if (!Array.isArray(references))
        return null;
      for (let referenceIndex = 0;referenceIndex < references.length; referenceIndex += 1) {
        const reference = references[referenceIndex];
        if (!isJsonRecord(reference) || !isJsonRecord(reference["snaks"]) || !(reference["hash"] === undefined || typeof reference["hash"] === "string"))
          return null;
        for (const id of Object.keys(reference["snaks"]).sort()) {
          const snaks = reference["snaks"][id];
          if (!propertyId2(id) || !Array.isArray(snaks))
            return null;
          for (let snakIndex = 0;snakIndex < snaks.length; snakIndex += 1) {
            const snak = snaks[snakIndex];
            if (!isJsonRecord(snak) || snak["property"] !== id || !addSnak(snak, {
              kind: "reference",
              referenceIndex,
              referenceHash: typeof reference["hash"] === "string" ? reference["hash"] : null,
              propertyId: id,
              snakIndex
            }))
              return null;
          }
        }
      }
    }
  }
  return result;
}
async function createKnowledgeWikidataImportPreviewV2(foreign) {
  const input = parseKnowledgeWikidataImportInputV2(foreign);
  if (input === null)
    return failure4("input");
  if (input.captures.some((capture) => capture.body.length > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2.maxSourceBytes) || input.captures.reduce((sum, capture) => sum + utf8ByteLength(capture.body), 0) > KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2.maxSourceBytes)
    return failure4("captures.body", "input-bound");
  const bounds = input.bounds ?? KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2;
  const sources = [];
  const records = [];
  const coverage = [];
  const omissions = [];
  const retry = new Set;
  let sourceBytes = 0;
  let statements = 0;
  let propertyGroups = 0;
  const seenCaptures = new Set;
  for (let captureIndex = 0;captureIndex < input.captures.length; captureIndex += 1) {
    const capture = input.captures[captureIndex];
    const bytes = utf8ByteLength(capture.body);
    const omit = (entityId, propertyId3, reason, count) => {
      omissions.push({ captureIndex, entityId, propertyId: propertyId3, reason, count });
      if (reason !== "property-not-selected" && reason !== "invalid-metadata" && reason !== "invalid-statement-group")
        retry.add(captureIndex);
    };
    if (sources.length >= bounds.maxEntities || sourceBytes + bytes > bounds.maxSourceBytes) {
      omit(capture.resolvedId, null, sources.length >= bounds.maxEntities ? "entity-bound" : "source-byte-bound", 1);
      continue;
    }
    const entity = parseEntity2(capture.body, capture.resolvedId);
    if (entity === null)
      return failure4(`captures.${captureIndex}.body`, "invalid-source");
    if (entity["claims"] !== undefined && !isJsonRecord(entity["claims"])) {
      return failure4(`captures.${captureIndex}.body.claims`, "invalid-source");
    }
    const captureSha256 = await sha256Text(capture.body);
    const captureKey = `${capture.requestedId}:${capture.resolvedId}:${captureSha256}`;
    if (seenCaptures.has(captureKey))
      return failure4(`captures.${captureIndex}`, "invalid-source");
    seenCaptures.add(captureKey);
    const source = {
      ...capture,
      captureSha256,
      sourceBytes: bytes,
      revision: entity["lastrevid"],
      serialization: "wikibase-json-v1",
      provenanceStatus: "caller-asserted",
      license: {
        id: "CC0-1.0",
        scope: "wikidata-structured-data-only",
        uri: "https://creativecommons.org/publicdomain/zero/1.0/"
      }
    };
    sources.push(source);
    sourceBytes += bytes;
    let extracted;
    try {
      extracted = extract2(entity, captureSha256, input.properties, KNOWLEDGE_WIKIDATA_PROPERTY_GROUP_LIMIT_V2 - propertyGroups);
    } catch (error) {
      if (error instanceof PropertyGroupBoundError)
        return failure4(`captures.${captureIndex}.property-groups`, "input-bound");
      throw error;
    }
    propertyGroups += extracted.groups.length;
    if (extracted.invalidMetadata > 0)
      omit(capture.resolvedId, null, "invalid-metadata", extracted.invalidMetadata);
    if (records.length + extracted.metadata.length <= bounds.maxRecords)
      records.push(...extracted.metadata);
    else
      omit(capture.resolvedId, null, "record-bound", extracted.metadata.length);
    for (const group of extracted.groups) {
      const observedStatements = Array.isArray(group.raw) ? group.raw.length : 0;
      if (input.properties !== "all-present" && !input.properties.includes(group.propertyId)) {
        omit(group.entityId, group.propertyId, "property-not-selected", observedStatements);
        continue;
      }
      const groupValues = groupRecords2(group, captureSha256);
      let retainedStatements = 0;
      let retained = false;
      if (groupValues === null)
        omit(group.entityId, group.propertyId, "invalid-statement-group", observedStatements);
      else if (statements + observedStatements > bounds.maxStatements)
        omit(group.entityId, group.propertyId, "statement-bound", observedStatements);
      else if (records.length + groupValues.length > bounds.maxRecords)
        omit(group.entityId, group.propertyId, "record-bound", groupValues.length);
      else {
        records.push(...groupValues);
        retainedStatements = observedStatements;
        retained = true;
        statements += observedStatements;
      }
      const assertedComplete = capture.coverage.kind === "complete-entity" || capture.coverage.kind === "selected-properties" && capture.coverage.properties.includes(group.propertyId);
      coverage.push({
        captureSha256,
        entityId: group.entityId,
        propertyId: group.propertyId,
        observedStatements,
        retainedStatements,
        status: retained && assertedComplete ? "complete-in-asserted-source" : "incomplete",
        sourceCoverage: "caller-asserted",
        definitiveAnswer: false
      });
    }
  }
  const mappingCandidates = records.flatMap((record) => {
    if (record.kind !== "snak" || record.selector.kind !== "statement")
      return [];
    const property = record.selector.location.kind === "qualifier" || record.selector.location.kind === "reference" ? record.selector.location.propertyId : record.selector.propertyId;
    return [{
      captureSha256: record.captureSha256,
      selector: record.selector,
      propertyId: property,
      status: record.value.kind === "unsupported" ? "unsupported-value" : "requires-property-mapping",
      value: record.value,
      normalization: "none",
      eligibleForAdmission: false,
      diagnostics: record.value.kind === "unsupported" ? ["unsupported-source-value"] : [
        "property-mapping-required",
        ...record.value.kind === "typed-source-value" && record.value.datatype === "time" ? ["time-normalization-unsupported"] : [],
        ...record.value.kind === "typed-source-value" && record.value.datatype === "globe-coordinate" ? ["coordinate-normalization-unsupported"] : [],
        ...record.value.kind === "typed-source-value" && record.value.datatype === "quantity" ? ["quantity-unit-mapping-required"] : []
      ]
    }];
  });
  const sourceAssertions = records.flatMap((record) => {
    if (record.kind !== "statement" || record.selector.kind !== "statement")
      return [];
    return [{
      subject: { entityId: record.selector.entityId, uri: `http://www.wikidata.org/entity/${record.selector.entityId}` },
      predicate: { propertyId: record.selector.propertyId, uri: `http://www.wikidata.org/entity/${record.selector.propertyId}` },
      captureSha256: record.captureSha256,
      selector: record.selector,
      rank: record.rank,
      rawStatement: record.raw,
      interpretation: "source-asserted",
      eligibleForAdmission: false
    }];
  });
  const payload = {
    v: 2,
    kind: "wikidata-import-preview",
    provider: "wikidata",
    importerVersion: KNOWLEDGE_WIKIDATA_IMPORTER_V2,
    mappingVersion: input.mappingVersion,
    status: "unadmitted",
    disclosure: "private",
    identityResolution: "candidate-only",
    properties: input.properties,
    bounds,
    sources,
    identityCandidates: sources.map((source) => ({
      requestedId: source.requestedId,
      resolvedId: source.resolvedId,
      revision: source.revision,
      captureSha256: source.captureSha256,
      redirects: source.redirects,
      localIdentity: null
    })),
    records,
    mappingCandidates,
    sourceAssertions,
    coverage,
    omissions,
    cursor: retry.size === 0 ? null : { kind: "retry-with-selection", captureIndices: [...retry] }
  };
  if (boundedKnowledgeWikidataPreviewJsonV2({ ...payload, previewSha256: "0".repeat(64) }) === undefined) {
    return failure4("preview", "input-bound");
  }
  return { ok: true, value: { ...payload, previewSha256: await sha256Text(canonicalJson(asJson2(payload))) } };
}
function canonicalKnowledgeWikidataImportPreviewV2(value) {
  return canonicalJson(asJson2(value));
}
async function verifyKnowledgeWikidataImportPreviewV2(foreign, input) {
  const rebuilt = await createKnowledgeWikidataImportPreviewV2(input);
  if (!rebuilt.ok)
    return rebuilt;
  const parsed = boundedKnowledgeWikidataPreviewJsonV2(foreign);
  if (parsed === undefined || canonicalJson(parsed) !== canonicalKnowledgeWikidataImportPreviewV2(rebuilt.value)) {
    return failure4("preview", "integrity-mismatch");
  }
  return rebuilt;
}
// src/research/knowledge-domain-catalog-v2.ts
var qualifiedRanges = {
  language: {
    "has-form": { concepts: ["form"] },
    "has-sense": { concepts: ["sense"] },
    "translation-of-sense": { concepts: ["sense"] },
    "attested-in": { concepts: ["text-occurrence"] }
  },
  culture: {
    depicts: { concepts: ["core:entity"], note: "Depictions can represent physical, fictional or abstract subjects; the open subject family is intentional." },
    "alludes-to": { concepts: ["core:entity"], note: "An allusion may concern an entity from any domain; attribution does not imply identity." },
    "named-after": { concepts: ["core:entity"], note: "A naming explanation may refer to a person, place, event, motif or other entity." },
    "interpreted-as": { concepts: ["core:concept"] }
  },
  "natural-world": {
    "classified-under": { concepts: ["natural-class", "taxon"] },
    observes: { concepts: ["physical-occurrence"] },
    "observed-at": { concepts: ["core:place"] },
    "has-feature": { concepts: ["feature"] }
  },
  body: {
    "involves-structure": { concepts: ["anatomical-structure"] },
    "reports-experience": { concepts: ["bodily-phenomenon"] },
    "proposes-mechanism": { concepts: ["mechanism-hypothesis"] }
  },
  research: {
    tests: { concepts: ["core:entity"], note: "Studies may investigate a hypothesis, intervention, material or other identified object; the investigation target remains broad." },
    "uses-method": { concepts: ["method"] },
    "produces-finding": { concepts: ["finding"] },
    supersedes: { concepts: ["publication-version"] }
  },
  substances: {
    "sample-of": { concepts: ["batch", "material"] },
    "batch-of": { concepts: ["product"] },
    assays: { concepts: ["sample"] },
    "offered-by": { concepts: ["core:agent"] }
  },
  organizations: {
    operates: { concepts: ["brand", "core:artifact", "core:process"], note: "Operated products and services may be artifacts or processes; brands retain their separate identity." },
    "held-by": { concepts: ["core:agent"] },
    announces: { concepts: ["core:event"] },
    completes: { concepts: ["transaction"] }
  },
  editorial: {
    "reports-on": { concepts: ["core:event", "event-series"] },
    "contains-placement": { concepts: ["placement"] },
    "ranks-under": { concepts: ["ranking-assessment"] },
    updates: { concepts: ["article"] }
  },
  software: {
    "evaluated-under": { concepts: ["benchmark-protocol"] },
    "uses-configuration": { concepts: ["configuration"] },
    "uses-dataset": { concepts: ["dataset-version"] },
    produces: { concepts: ["measurement", "core:artifact"], note: "A run can produce a measured result or an output artifact; this relation alone does not establish comparability." }
  },
  music: {
    performs: { concepts: ["musical-work", "arrangement"] },
    records: { concepts: ["performance"] },
    "appears-on": { concepts: ["release"] },
    "similar-under": {
      concepts: ["musical-work", "arrangement", "performance", "recording", "release", "track"],
      note: "The object is a musical subject participating in the assessment; its comparison method and other subjects are supplied separately."
    }
  },
  people: {
    "describes-person": { concepts: ["core:person"] },
    "derived-from-record": { concepts: ["source-contact-record", "public-profile-document"] },
    "involves-person": { concepts: ["core:person"] },
    "accounts-for": { concepts: ["relationship"] }
  },
  finance: {
    "issued-by": { concepts: ["issuer"] },
    "lists-instrument": { concepts: ["instrument"] },
    "tests-strategy": { concepts: ["strategy-version"] },
    "uses-dataset": { concepts: ["core:artifact"], note: "The data artifact can come from any installed domain; split, date, costs and assumptions remain separate context." }
  },
  "formal-systems": {
    instantiates: { concepts: ["rule-set-version"] },
    "starts-from": { concepts: ["initial-state"] },
    "has-proof": { concepts: ["proof-artifact"] }
  },
  "agent-work": {
    "uses-skill": { concepts: ["skill-version"] },
    attempts: { concepts: ["task"] },
    produces: { concepts: ["core:artifact", "core:information-resource"], note: "Attempts can produce physical or digital artifacts and information resources; production does not imply validation." },
    "validated-by": { concepts: ["check-result"] }
  }
};
var additionalConcepts = {
  "natural-world": [["natural-class", "A natural classification category, distinct from the scheme that defines it and an occurrence classified under it.", "concept"]],
  substances: [["material", "Identified physical material from which a sample is taken, including material without a marketed product or production batch.", "entity"]],
  people: [["relationship", "An identified relationship among people or organizations, with dates, source accounts and access governed separately.", "entity"]]
};
var foundationConcepts = [
  ["contextual-entity", "An entity considered under an optional research profile; the profile does not require complete descriptions or mutually exclusive types.", "entity"],
  ["measurement", "An attributed measurement record whose subject, quantity, method and conditions are stated independently.", "information-resource"],
  ["julian-calendar", "The proleptic Julian calendar for an explicitly normalized time value; declaring the calendar does not convert source date lexemes.", "concept"],
  ["wgs84-geographic-crs", "A local descriptor for WGS 84 geographic coordinates ordered longitude then latitude in decimal degrees, with optional height in meters. It does not normalize an arbitrary source globe.", "concept"],
  ["earth-globe", "A descriptor identifying Earth as the globe of a source coordinate claim, distinct from a coordinate reference system or a coordinate conversion.", "concept"],
  ["wikidata-item", "The Wikidata item identifier scheme for Q identifiers. Its use preserves source identity and does not merge a local entity.", "concept"],
  ["wikidata-property", "The Wikidata property identifier scheme for P identifiers. Identifying a property does not approve a mapping to a local predicate.", "concept"],
  ["wikidata-lexeme", "The Wikidata lexeme identifier scheme for L identifiers, distinct from forms and senses.", "concept"],
  ["wikidata-form", "The Wikidata form identifier scheme for L-F identifiers, distinct from the lexical entry and its senses.", "concept"],
  ["wikidata-sense", "The Wikidata sense identifier scheme for L-S identifiers, distinct from the lexical entry and its forms.", "concept"],
  ["wikidata-entity-schema", "The Wikidata EntitySchema identifier scheme for E identifiers; a referenced schema is not an accepted local validation policy.", "concept"],
  ["wikidata-statement", "The Wikidata statement identifier scheme for source statement GUIDs; the source revision and capture remain separate provenance.", "concept"],
  ["doi", "The DOI identifier scheme for registered digital object identifiers. Equality of supplied strings is not independent validation of registration or identity.", "concept"],
  ["orcid", "The ORCID identifier scheme for researcher identifiers. A supplied identifier is not proof of account control or of a person's identity.", "concept"]
];
var foundationUnits = [
  ["meter", "length", "m", "1", "0", "The meter as the local base length unit."],
  ["second", "time", "s", "1", "0", "The second as the local base duration unit; calendar periods are not fixed durations."],
  ["kilogram", "mass", "kg", "1", "0", "The kilogram as the local base mass unit."],
  ["gram", "mass", "g", "0.001", "0", "A gram, one thousandth of the local kilogram base unit."],
  ["milligram", "mass", "mg", "0.000001", "0", "A milligram, one millionth of the local kilogram base unit."],
  ["kelvin", "temperature", "K", "1", "0", "The kelvin as the local base unit for thermodynamic temperature."],
  ["celsius", "temperature", "°C", "1", "273.15", "A Celsius temperature has a local kelvin value 273.15 greater; temperature differences need a separately stated quantity kind."],
  ["dimensionless", "dimensionless", "1", "1", "0", "A dimensionless ratio expressed as a fraction; its numerator and denominator meanings remain contextual."],
  ["percent", "dimensionless", "%", "0.01", "0", "One percent is one hundredth of a dimensionless ratio; the population and denominator remain contextual."],
  ["count", "count", "count", "1", "0", "A count of explicitly identified units or events; the counted population is stated separately and is not an arbitrary ratio."]
];
var SPONGE_KNOWLEDGE_DOMAIN_RANGE_NOTES_V2 = freezeKnowledgeDeclaration(Object.fromEntries(Object.entries(qualifiedRanges).flatMap(([domain, predicates]) => Object.entries(predicates).filter(([, range]) => range.note !== undefined).map(([code2, range]) => [`sponge.${domain}/${code2}`, range.note]))));
function canonical3(value) {
  return canonicalJson(value);
}
function unwrap4(result) {
  if (!result.ok)
    throw new Error(`Invalid qualified knowledge pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function labels3(value) {
  return [{ language: "en", text: value, v: 1 }];
}
function title3(value) {
  return value.split("-").map((word) => `${word[0]?.toUpperCase()}${word.slice(1)}`).join(" ");
}
function sortedRefs(refs3) {
  return [...refs3].sort((left, right) => canonical3(left) < canonical3(right) ? -1 : 1);
}
function sortedSchemas(schemas) {
  return [...schemas].sort((left, right) => left.identity.code < right.identity.code ? -1 : 1);
}
function requiredSchema(schemas, code2) {
  const schema = schemas.find((item) => item.identity.code === code2);
  if (schema === undefined)
    throw new Error(`Missing qualified schema ${code2}.`);
  return schema;
}
function entityRange2(refs3) {
  return { concepts: sortedRefs(refs3), kind: "entity-concepts", v: 1 };
}
function valueRange(...valueKinds) {
  return { kind: "value-kinds", valueKinds: [...valueKinds].sort(), v: 1 };
}
function schemaInput(previous) {
  return {
    definitions: previous.definitions,
    identity: { ...previous.identity, revision: 2 },
    labels: previous.labels,
    previousRevisionSha256: previous.revisionSha256,
    reviewDecisionSha256: null,
    v: 1
  };
}
async function executableShapes(predicates, shapeForConcept = (ref2) => ref2) {
  const subjects = new Map;
  for (const predicate of predicates)
    for (const concept of predicate.domainConcepts)
      subjects.set(canonical3(concept), concept);
  const shapes = [];
  for (const concept of subjects.values()) {
    const rules = predicates.filter((predicate) => predicate.domainConcepts.some((ref2) => canonical3(ref2) === canonical3(concept))).map((predicate) => ({
      allowedDisclosures: ["private"],
      cardinality: { maximum: null, minimum: 0, v: 1 },
      predicate: predicate.ref,
      purpose: "private-research",
      range: predicate.range,
      requiredEvidenceBearings: [],
      severity: "error",
      v: 1
    }));
    rules.sort((left, right) => canonical3({ predicate: left.predicate, purpose: left.purpose }) < canonical3({ predicate: right.predicate, purpose: right.purpose }) ? -1 : 1);
    shapes.push(unwrap4(await createKnowledgeExecutableShapeV1({
      appliesToConcepts: [concept],
      closed: false,
      extends: [],
      maximumInheritanceDepth: 1,
      rules,
      shape: shapeForConcept(concept),
      v: 1
    })));
  }
  return shapes.sort((left, right) => left.shape.code < right.shape.code ? -1 : 1);
}
async function buildFoundation(legacy) {
  const core = legacy.corePack;
  const reference = legacy.referencePack;
  const vocabulary = unwrap4(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: core.canonicalizerSha256,
    labels: labels3("Sponge qualified research foundation"),
    namespace: "sponge.foundation",
    ownerEntityId: core.vocabulary.ownerEntityId,
    previousRevisionSha256: null,
    revision: 1,
    state: "private",
    v: 1
  }));
  const schemas = [];
  const base = (code2, definition) => ({
    definitions: labels3(definition),
    identity: { code: code2, namespace: vocabulary.namespace, revision: 1, v: 1 },
    labels: labels3(title3(code2)),
    previousRevisionSha256: null,
    reviewDecisionSha256: null,
    vocabularySha256: vocabulary.revisionSha256,
    v: 1
  });
  for (const [code2, definition, broader] of foundationConcepts)
    schemas.push(unwrap4(await createKnowledgeSchemaRevisionV1({
      ...base(code2, definition),
      kind: "concept",
      broader: [requiredSchema(core.schemas, broader).ref]
    })));
  for (const [code2, dimension, symbol, scale, offset, definition] of foundationUnits)
    schemas.push(unwrap4(await createKnowledgeSchemaRevisionV1({
      ...base(code2, `${definition} This original local descriptor neither performs conversion nor qualifies a source unit mapping.`),
      kind: "unit",
      dimension,
      symbol,
      scale,
      offset
    })));
  const coreRef = (code2) => requiredSchema(core.schemas, code2).ref;
  const localRef = (code2) => requiredSchema(schemas, code2).ref;
  const contexts = [
    ["globe-context", "The identified celestial body bounding this coordinate claim; this does not select or transform a coordinate system.", entityRange2([coreRef("place")])],
    ["retrieved-at", "The explicitly recorded retrieval time of the supporting capture, distinct from the time the reported event occurred.", valueRange("time")],
    ["scope-context", "An identified scope, classification scheme or denominator definition for this claim.", entityRange2([coreRef("concept")])],
    ["source-property", "The original property identifier for this source claim, retained independently of a local predicate mapping.", valueRange("identifier")],
    [
      "source-rank",
      "The source statement rank, retained as source metadata without converting preferred rank into accepted truth.",
      { kind: "enum", values: ["deprecated", "normal", "preferred"].map((value) => ({ kind: "string", value, v: 1 })), v: 1 }
    ],
    ["source-statement", "The original source statement identifier; capture identity and source revision are retained independently.", valueRange("identifier")],
    ["version-context", "The exact version entity under which a claim applies, without asserting identity with other versions.", entityRange2([coreRef("entity")])]
  ];
  for (const [code2, definition, range] of contexts)
    schemas.push(unwrap4(await createKnowledgeSchemaRevisionV1({
      ...base(code2, definition),
      kind: "predicate",
      domainConcepts: [coreRef("entity")],
      inversePredicate: null,
      qualifierPredicates: [],
      range
    })));
  const qualifiers = sortedRefs([...reference.schemas, ...schemas].filter((schema) => schema.kind === "predicate").map((schema) => schema.ref));
  const definitions2 = [
    ["external-identifier", "An identifier under an explicitly named scheme. Source identity is retained without approving entity equivalence or a schema mapping.", coreRef("entity"), valueRange("identifier")],
    ["measurement-of", "The identified subject of one measurement. Any domain may supply the subject; units and method do not generalize its result.", localRef("measurement"), entityRange2([coreRef("entity")])],
    ["measurement-method", "The identified measurement procedure or protocol used for this result.", localRef("measurement"), entityRange2([coreRef("information-resource")])],
    ["measured-at", "The explicitly normalized time associated with this measurement, retaining its declared calendar and precision.", localRef("measurement"), valueRange("time")],
    ["normalized-quantity", "A quantity under an exact local unit descriptor, with bounds or uncertainty where known. Normalization requires separately attributable evidence.", localRef("measurement"), valueRange("quantity")],
    ["normalized-time", "A time explicitly normalized under the declared calendar, certainty and precision. Retained source time lexemes remain separate.", coreRef("entity"), valueRange("time")],
    ["normalized-location", "A geometry explicitly normalized under its declared coordinate reference system. A source globe claim alone does not justify this geometry.", coreRef("entity"), valueRange("geometry")],
    ["version-of", "Relates a version to the continuing entity it versions under attributed identity evidence. It does not assert same-as, succession or automatic equivalence.", coreRef("entity"), entityRange2([coreRef("entity")])],
    ["source-asserted-instance-of", "Retains a source's direct instance-of claim between identified entities. It neither creates a local type membership nor permits transitive instance inference.", coreRef("entity"), entityRange2([coreRef("entity")])],
    ["source-asserted-subclass-of", "Retains a source's subclass-of claim between identified class entities. It does not establish a local broader relation or imply an instance-of claim.", coreRef("entity"), entityRange2([coreRef("entity")])],
    ["source-asserted-part-of", "Retains a source's constituent relation between identified entities. It remains distinct from classification, instance membership and entity equivalence.", coreRef("entity"), entityRange2([coreRef("entity")])]
  ];
  for (const [code2, definition, domain, range] of definitions2)
    schemas.push(unwrap4(await createKnowledgeSchemaRevisionV1({
      ...base(code2, definition),
      kind: "predicate",
      domainConcepts: [domain],
      inversePredicate: null,
      qualifierPredicates: qualifiers,
      range
    })));
  const predicates = schemas.filter((schema) => schema.kind === "predicate");
  const shapes = await executableShapes(predicates, (ref2) => ref2.namespace === "sponge.core" ? localRef("contextual-entity") : ref2);
  return unwrap4(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: core.canonicalizerSha256,
    dependencies: [core, reference].map(knowledgeVocabularyPackPinV1),
    display: core.display,
    examples: [],
    migrationNotes: "Additive local descriptors and optional structural rules. No upstream mapping, coordinate or unit conversion, complete description, source truth, publication or identity authority is implied. Monetary quantities require explicit currency and valuation context; no currency conversion is defined.",
    packId: vocabulary.namespace,
    previousManifestSha256: null,
    queries: [{ description: "Which source identities, versions, units and explicit contexts qualify this research claim?", id: "qualified-context", predicates: sortedRefs(predicates.map((predicate) => predicate.ref)), v: 1 }],
    revision: 1,
    schemas: sortedSchemas(schemas),
    shapes,
    sources: [{
      contentSha256: await sha256Text(canonical3({ foundationConcepts, foundationUnits, schemas })),
      license: "MIT",
      revision: "1",
      uri: "urn:sponge:application-profile:foundation",
      v: 1
    }],
    supportedCodecs: [],
    v: 1,
    vocabulary
  }));
}
var catalogPromise3;
function spongeKnowledgeDomainCatalogV2() {
  catalogPromise3 ??= buildCatalog2();
  return catalogPromise3;
}
async function buildCatalog2() {
  const legacy = await spongeKnowledgeDomainCatalog();
  const foundationPack = await buildFoundation(legacy);
  const { corePack, referencePack } = legacy;
  const qualifiers = sortedRefs([...referencePack.schemas, ...foundationPack.schemas].filter((schema) => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map((schema) => schema.ref));
  const packs = [corePack, referencePack, foundationPack];
  for (const previous of legacy.packs.filter((pack) => SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS.includes(pack.packId))) {
    const domain = previous.packId.slice("sponge.".length);
    const vocabulary = unwrap4(await createKnowledgeVocabularyRevisionV1({
      canonicalizerSha256: previous.canonicalizerSha256,
      labels: previous.vocabulary.labels,
      namespace: previous.packId,
      ownerEntityId: previous.vocabulary.ownerEntityId,
      previousRevisionSha256: previous.vocabulary.revisionSha256,
      revision: 2,
      state: "private",
      v: 1
    }));
    const concepts = [];
    for (const schema of previous.schemas.filter((item) => item.kind === "concept")) {
      const concept = unwrap4(await createKnowledgeSchemaRevisionV1({
        ...schemaInput(schema),
        broader: schema.broader,
        kind: "concept",
        vocabularySha256: vocabulary.revisionSha256
      }));
      if (concept.kind !== "concept")
        throw new Error("Expected qualified concept.");
      concepts.push(concept);
    }
    for (const [code2, definition, broader] of additionalConcepts[domain] ?? []) {
      const concept = unwrap4(await createKnowledgeSchemaRevisionV1({
        broader: [requiredSchema(corePack.schemas, broader).ref],
        definitions: labels3(definition),
        identity: { code: code2, namespace: previous.packId, revision: 1, v: 1 },
        kind: "concept",
        labels: labels3(title3(code2)),
        previousRevisionSha256: null,
        reviewDecisionSha256: null,
        vocabularySha256: vocabulary.revisionSha256,
        v: 1
      }));
      if (concept.kind !== "concept")
        throw new Error("Expected additional concept.");
      concepts.push(concept);
    }
    const localRef = (code2) => requiredSchema(concepts, code2).ref;
    const predicates = [];
    for (const schema of previous.schemas.filter((item) => item.kind === "predicate")) {
      const qualification = qualifiedRanges[domain]?.[schema.identity.code];
      const entityPredicate = schema.range.kind === "value-kinds" && schema.range.valueKinds.includes("entity");
      if (entityPredicate && qualification === undefined)
        throw new Error(`Unqualified entity relation ${previous.packId}/${schema.identity.code}.`);
      const range = qualification === undefined ? schema.range : entityRange2(qualification.concepts.map((code2) => code2.startsWith("core:") ? requiredSchema(corePack.schemas, code2.slice(5)).ref : localRef(code2)));
      const predicate = unwrap4(await createKnowledgeSchemaRevisionV1({
        ...schemaInput(schema),
        definitions: qualification?.note === undefined ? schema.definitions : labels3(`${schema.definitions[0]?.text} ${qualification.note}`),
        domainConcepts: sortedRefs(schema.domainConcepts.map((ref2) => localRef(ref2.code))),
        inversePredicate: null,
        kind: "predicate",
        qualifierPredicates: qualifiers,
        range,
        vocabularySha256: vocabulary.revisionSha256
      }));
      if (predicate.kind !== "predicate")
        throw new Error("Expected qualified predicate.");
      predicates.push(predicate);
    }
    const exampleEntityId = parseKnowledgeEntityId(`kent_${"e".repeat(24)}`);
    if (exampleEntityId === null)
      throw new Error("Invalid structural example identity.");
    const examples = predicates.map((predicate) => {
      const object = predicate.range.kind === "entity-concepts" ? { entityId: exampleEntityId, kind: "entity", v: 1 } : { kind: predicate.identity.code === "observed-at-tick" ? "integer" : "decimal", value: "1", v: 1 };
      return {
        description: `Synthetic structural example for ${predicate.identity.code}; the referenced entity must independently have an allowed range concept. No real-world claim or completeness is asserted.`,
        id: predicate.identity.code,
        object,
        predicate: predicate.ref,
        subjectConcept: predicate.domainConcepts[0],
        v: 1
      };
    });
    const schemas = sortedSchemas([...concepts, ...predicates]);
    packs.push(unwrap4(await createKnowledgeVocabularyPackManifestV1({
      canonicalizerSha256: previous.canonicalizerSha256,
      dependencies: [corePack, foundationPack, referencePack].map(knowledgeVocabularyPackPinV1),
      display: previous.display,
      examples,
      migrationNotes: "Revision 2 qualifies relation ranges and adds optional contextual shapes. Revision 1 records and digests remain unchanged; a new revision does not retype existing entities, rewrite accepted statements, or grant publication or identity authority. Multiple compatible types are allowed; absent optional relations do not establish completeness.",
      packId: previous.packId,
      previousManifestSha256: previous.manifestSha256,
      queries: previous.queries.map((query) => ({ ...query, predicates: sortedRefs(predicates.map((predicate) => predicate.ref)) })),
      revision: 2,
      schemas,
      shapes: await executableShapes(predicates),
      sources: [{
        contentSha256: await sha256Text(canonical3({ qualification: qualifiedRanges[domain], schemas })),
        license: "MIT",
        revision: "2",
        uri: `urn:sponge:application-profile:${domain}`,
        v: 1
      }],
      supportedCodecs: [],
      v: 1,
      vocabulary
    })));
  }
  packs.sort((left, right) => left.packId < right.packId ? -1 : 1);
  const resolved = unwrap4(await resolveKnowledgeVocabularyPacksV1({
    manifests: packs,
    roots: packs.filter((pack) => SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS.includes(pack.packId)).map(knowledgeVocabularyPackPinV1)
  }));
  return freezeKnowledgeDeclaration({
    corePack,
    foundationPack,
    historicalPacks: legacy.packs,
    lock: resolved.lock,
    packs,
    referencePack,
    schemas: packs.flatMap((pack) => pack.schemas),
    vocabularies: packs.map((pack) => pack.vocabulary)
  });
}
// src/research/knowledge-wikidata-mappings-v1.ts
var KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V1 = "sponge.wikidata-source-mappings.v1";
var reviewedProperties = [
  ["P31", 2544460086, "789d22e92cffde51227efdc235a56c0a73cd07905f78b92d4b3707dcaa57920c", "source-asserted-instance-of"],
  ["P279", 2544822399, "a9bd8764254319bbf8af70a8d55d068c8e06df0408658735e029871627ff375e", "source-asserted-subclass-of"],
  ["P361", 2544660587, "4ed5238812e042dcbb8b5c4cd38a80d78945289e760a85554d2d47b8a20dcd4f", "source-asserted-part-of"]
];
var catalogPromise4;
function spongeKnowledgeWikidataMappingCatalogV1() {
  catalogPromise4 ??= (async () => {
    const catalog = await spongeKnowledgeDomainCatalogV2();
    const mappings = reviewedProperties.map(([propertyId3, revision2, captureSha256, code2]) => {
      const predicate = catalog.foundationPack.schemas.find((schema) => schema.kind === "predicate" && schema.identity.code === code2);
      if (predicate === undefined)
        throw new Error("Missing source-attribution predicate.");
      return {
        source: { propertyId: propertyId3, datatype: "wikibase-item", revision: revision2, captureSha256 },
        target: predicate.ref,
        relation: "source-attribution",
        localMembershipInference: false,
        identityMerge: false,
        v: 1
      };
    });
    const body = { v: 1, mappingVersion: KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V1, mappings };
    return freezeKnowledgeDeclaration({ ...body, catalogSha256: await sha256Text(canonicalJson(body)) });
  })();
  return catalogPromise4;
}
async function createKnowledgeWikidataMappingPreviewV1(input) {
  const source = await createKnowledgeWikidataImportPreviewV2(input);
  if (!source.ok)
    return source;
  const catalog = await spongeKnowledgeWikidataMappingCatalogV1();
  const candidates = [];
  const gaps = [];
  for (const assertion of source.value.sourceAssertions) {
    const mapping = catalog.mappings.find((item) => item.source.propertyId === assertion.predicate.propertyId);
    if (mapping === undefined) {
      gaps.push({ source: assertion, reason: "property-not-mapped" });
      continue;
    }
    const raw = assertion.rawStatement;
    const main = isJsonRecord(raw) && isJsonRecord(raw["mainsnak"]) ? raw["mainsnak"] : null;
    const preserved = source.value.mappingCandidates.find((candidate) => candidate.captureSha256 === assertion.captureSha256 && candidate.selector.kind === "statement" && candidate.selector.statementId === assertion.selector.statementId && candidate.selector.entityId === assertion.selector.entityId && candidate.selector.propertyId === assertion.selector.propertyId && candidate.selector.statementIndex === assertion.selector.statementIndex && candidate.selector.location.kind === "main");
    const data = main !== null && isJsonRecord(main["datavalue"]) ? main["datavalue"] : null;
    const value = data !== null && isJsonRecord(data["value"]) ? data["value"] : null;
    const id = value === null ? undefined : value["id"] ?? (typeof value["numeric-id"] === "number" ? `Q${value["numeric-id"]}` : undefined);
    if (preserved?.value.kind !== "typed-source-value" || preserved.value.datatype !== mapping.source.datatype || typeof id !== "string" || !/^Q[1-9][0-9]*$/u.test(id)) {
      gaps.push({ source: assertion, reason: "source-value-not-an-item" });
      continue;
    }
    candidates.push({
      source: assertion,
      mapping,
      object: { entityId: id, uri: `http://www.wikidata.org/entity/${id}` },
      status: "requires-local-identity-and-proposal-review",
      normalization: "none",
      eligibleForAdmission: false
    });
  }
  const body = {
    v: 1,
    sourcePreviewSha256: source.value.previewSha256,
    mappingCatalogSha256: catalog.catalogSha256,
    candidates,
    gaps,
    scope: "retained-main-statements"
  };
  if (boundedKnowledgeWikidataPreviewJsonV2({ ...body, previewSha256: "0".repeat(64) }) === undefined) {
    return { ok: false, error: { code: "input-bound", field: "mapping-preview", retryable: false } };
  }
  return { ok: true, value: freezeKnowledgeDeclaration({
    ...body,
    previewSha256: await sha256Text(canonicalJson(body))
  }) };
}
async function verifyKnowledgeWikidataMappingPreviewV1(foreign, input) {
  const rebuilt = await createKnowledgeWikidataMappingPreviewV1(input);
  if (!rebuilt.ok)
    return rebuilt;
  const parsed = boundedKnowledgeWikidataPreviewJsonV2(foreign);
  if (parsed === undefined || canonicalJson(parsed) !== canonicalJson(rebuilt.value)) {
    return { ok: false, error: { code: "integrity-mismatch", field: "mapping-preview", retryable: false } };
  }
  return rebuilt;
}
// src/research/knowledge-source-relations.ts
var reviewedSourceRelations = [
  [
    "P527",
    2544660189,
    "e9374ff970896dfef5e706054d269be2e20dc7600c7e01275791c15b9262da51",
    "has-part",
    "The source states that this entity has the identified part. No inverse claim or transitive composition is inferred."
  ],
  [
    "P50",
    2528636255,
    "60d1b0837173d401a3ed0fcb9769691e3a62e3f7307167595b43f8bd0e133cfa",
    "author",
    "The source attributes authorship of this written work to the identified entity. Authorship remains distinct from a generic creator attribution and does not establish ownership or rights."
  ],
  [
    "P170",
    2534300026,
    "522ab3639a5487087e8479abf4c310cf3e5f0cd19dded0dec5435ec001c93e63",
    "creator",
    "The source attributes creation of this work or object to the identified entity. It does not establish ownership, rights, employment or authorship of a written work."
  ],
  [
    "P921",
    2537871557,
    "9b89c62a2b15c46724e6f21c88c8672c36665f421150a42704dc1108916b4d19",
    "main-subject",
    "The source identifies a primary topic of this work or communication. A topic relation does not establish that the work supports a claim about that topic."
  ],
  [
    "P144",
    2544603547,
    "6491923b1a2a232b2a304b2d10587b0d56ebdf85f31b38cb8e28cf7af5ec65cf",
    "based-on",
    "The source identifies a work or input used as a basis for this entity. No equivalence, endorsement, identity or causal proof follows."
  ],
  [
    "P629",
    2537669859,
    "5df98fe0198569e121f82be1203c8d8ba3262ee2e52147f7ed0d4673450f2740",
    "version-edition-or-translation-of",
    "The source states that this entity is a version, edition or translation of the identified entity. The union is retained without choosing one alternative, equating identities or narrowing it to a local version-of claim."
  ],
  [
    "P407",
    2544572361,
    "72be35a6524dd893406c7d8b4a585e397c2d7c3f0e6e14f11b6c5894a1d6bfc6",
    "language-of-work-or-name",
    "The source associates this work or name with an identified language. It does not establish a person's spoken language, a lexical sense or a translation between senses."
  ],
  [
    "P136",
    2544600023,
    "6bf5951fe86505a3fdeeaee23cb52e482ddd799eeff7878908a27c566fec7590",
    "genre",
    "The source assigns this work or artist a genre or field of creative work. This attribution neither creates local concept membership nor substitutes a topic relation."
  ],
  [
    "P175",
    2542419149,
    "426d54d7ea13be9941cc2a65a9bcf92853ccdd2a7fe09071ed6631ef06d5cbcc",
    "performer",
    "The source associates this role or musical work with an identified performer. Its direction is work or role to performer; it does not create a performance, recording or the local music/performs relation."
  ],
  [
    "P414",
    2503386869,
    "f52af3ce24b2313cb2d6f565faab9a2b184061dc25265ecd7bae46af0145af63",
    "stock-exchange",
    "The source identifies an exchange on which this company is traded. It does not create instrument, listing or ticker identities or establish current tradability."
  ],
  [
    "P703",
    2511372721,
    "e6ed9c7ac12e7be27bbf989ac69986fcf16e7a27c2e2dc2c690719d7188dbc56",
    "found-in-taxon",
    "The source reports that this item can be found in the identified taxon. This is not an assay, prevalence estimate, efficacy result, safety assessment or vendor qualification."
  ],
  [
    "P277",
    2527096569,
    "19d54b17eddb66f0fc6662853c1f5160946ff468775672640ea452174327d3c1",
    "programmed-in",
    "The source identifies a programming language used to develop this software. It does not establish a deployed runtime, dependency, execution configuration or benchmark result."
  ]
];

// src/research/knowledge-domain-catalog-v3.ts
var labels4 = (text2) => [{ language: "en", text: text2, v: 1 }];
function required2(result) {
  if (!result.ok)
    throw new Error(`Invalid source-relations pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
var catalogPromise5;
function spongeKnowledgeDomainCatalogV3() {
  catalogPromise5 ??= buildCatalog3();
  return catalogPromise5;
}
async function buildCatalog3() {
  const previous = await spongeKnowledgeDomainCatalogV2();
  const { corePack, referencePack, foundationPack } = previous;
  const entity = corePack.schemas.find((schema) => schema.kind === "concept" && schema.identity.code === "entity");
  if (entity === undefined)
    throw new Error("Missing core entity concept.");
  const vocabulary = required2(await createKnowledgeVocabularyRevisionV1({
    canonicalizerSha256: corePack.canonicalizerSha256,
    labels: labels4("Sponge source relationships"),
    namespace: "sponge.source-relations",
    ownerEntityId: corePack.vocabulary.ownerEntityId,
    previousRevisionSha256: null,
    revision: 1,
    state: "private",
    v: 1
  }));
  const qualifierPredicates = [...referencePack.schemas, ...foundationPack.schemas].filter((schema) => schema.kind === "predicate" && schema.qualifierPredicates.length === 0).map((schema) => schema.ref).sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : 1);
  const schemas = await Promise.all(reviewedSourceRelations.map(async ([, , , suffix, definition]) => required2(await createKnowledgeSchemaRevisionV1({
    definitions: labels4(`${definition} Source attribution does not infer local membership or identity; capture, rank, qualifiers and references remain separate evidence.`),
    identity: { code: `source-asserted-${suffix}`, namespace: vocabulary.namespace, revision: 1, v: 1 },
    labels: labels4(`Source asserted ${suffix.replaceAll("-", " ")}`),
    previousRevisionSha256: null,
    reviewDecisionSha256: null,
    vocabularySha256: vocabulary.revisionSha256,
    v: 1,
    kind: "predicate",
    domainConcepts: [entity.ref],
    inversePredicate: null,
    qualifierPredicates,
    range: { concepts: [entity.ref], kind: "entity-concepts", v: 1 }
  }))));
  schemas.sort((a, b) => a.identity.code < b.identity.code ? -1 : 1);
  const sourceRelationsPack = required2(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: corePack.canonicalizerSha256,
    dependencies: [corePack, foundationPack, referencePack].map(knowledgeVocabularyPackPinV1),
    display: corePack.display,
    examples: [],
    migrationNotes: "Additive source relationships. Existing pack revisions, local records and historical previews remain unchanged. Explicit installation and proposal review are required; no source claim implies truth, classification, identity equality, publication rights or a complete description.",
    packId: vocabulary.namespace,
    previousManifestSha256: null,
    revision: 1,
    schemas,
    shapes: [],
    queries: [{
      description: "Which relationships does the retained source state, with which qualifiers and references?",
      id: "source-relationships",
      predicates: schemas.map((schema) => schema.ref),
      v: 1
    }],
    sources: reviewedSourceRelations.map(([property, revision2, contentSha256]) => ({
      contentSha256,
      license: "CC0-1.0",
      revision: String(revision2),
      uri: `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${property}&format=json&maxlag=5`,
      v: 1
    })).sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : 1),
    supportedCodecs: [],
    v: 1,
    vocabulary
  }));
  const packs = [...previous.packs, sourceRelationsPack].sort((a, b) => a.packId < b.packId ? -1 : 1);
  const roots = [...previous.lock.roots, knowledgeVocabularyPackPinV1(sourceRelationsPack)].sort((a, b) => a.packId < b.packId ? -1 : 1);
  const resolved = required2(await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots }));
  return freezeKnowledgeDeclaration({
    ...previous,
    sourceRelationsPack,
    lock: resolved.lock,
    packs,
    schemas: packs.flatMap((pack) => pack.schemas),
    vocabularies: packs.map((pack) => pack.vocabulary)
  });
}
// src/research/knowledge-wikidata-mappings-v2.ts
var KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V2 = "sponge.wikidata-source-mappings.v2";
var catalogPromise6;
function spongeKnowledgeWikidataMappingCatalogV2() {
  catalogPromise6 ??= (async () => {
    const [legacy, catalog] = await Promise.all([spongeKnowledgeWikidataMappingCatalogV1(), spongeKnowledgeDomainCatalogV3()]);
    const mappings = legacy.mappings.map((mapping) => ({ ...mapping, v: 2 }));
    for (const [propertyId3, revision2, captureSha256, suffix] of reviewedSourceRelations) {
      const predicate = catalog.sourceRelationsPack.schemas.find((schema) => schema.kind === "predicate" && schema.identity.code === `source-asserted-${suffix}`);
      if (predicate === undefined)
        throw new Error("Missing reviewed source relationship.");
      mappings.push({
        source: { propertyId: propertyId3, datatype: "wikibase-item", revision: revision2, captureSha256 },
        target: predicate.ref,
        relation: "source-attribution",
        localMembershipInference: false,
        identityMerge: false,
        v: 2
      });
    }
    const body = { v: 2, mappingVersion: KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V2, mappings };
    return freezeKnowledgeDeclaration({ ...body, catalogSha256: await sha256Text(canonicalJson(body)) });
  })();
  return catalogPromise6;
}
function occurrenceKey(capture, entity, property, statement, index) {
  return JSON.stringify([capture, entity, property, statement, index]);
}
async function createKnowledgeWikidataMappingPreviewV2(input) {
  const source = await createKnowledgeWikidataImportPreviewV2(input);
  if (!source.ok)
    return source;
  const catalog = await spongeKnowledgeWikidataMappingCatalogV2();
  const mappings = new Map(catalog.mappings.map((mapping) => [mapping.source.propertyId, mapping]));
  const mainValues = new Map(source.value.mappingCandidates.flatMap((candidate) => {
    const selector = candidate.selector;
    return selector.kind === "statement" && selector.location.kind === "main" ? [[occurrenceKey(candidate.captureSha256, selector.entityId, selector.propertyId, selector.statementId, selector.statementIndex), candidate.value]] : [];
  }));
  const candidates = [];
  const gaps = [];
  for (const assertion of source.value.sourceAssertions) {
    const mapping = mappings.get(assertion.predicate.propertyId);
    if (mapping === undefined) {
      gaps.push({ source: assertion, reason: "property-not-mapped" });
      continue;
    }
    const { selector } = assertion;
    const preserved = mainValues.get(occurrenceKey(assertion.captureSha256, selector.entityId, selector.propertyId, selector.statementId, selector.statementIndex));
    const raw = assertion.rawStatement;
    const main = isJsonRecord(raw) && isJsonRecord(raw["mainsnak"]) ? raw["mainsnak"] : null;
    const data = main !== null && isJsonRecord(main["datavalue"]) ? main["datavalue"] : null;
    const value = data !== null && isJsonRecord(data["value"]) ? data["value"] : null;
    const id = value === null ? undefined : value["id"] ?? (typeof value["numeric-id"] === "number" ? `Q${value["numeric-id"]}` : undefined);
    if (preserved?.kind !== "typed-source-value" || preserved.datatype !== mapping.source.datatype || typeof id !== "string" || !/^Q[1-9][0-9]*$/u.test(id)) {
      gaps.push({ source: assertion, reason: "source-value-not-an-item" });
      continue;
    }
    candidates.push({
      source: assertion,
      mapping,
      object: { entityId: id, uri: `http://www.wikidata.org/entity/${id}` },
      status: "requires-local-identity-and-proposal-review",
      normalization: "none",
      eligibleForAdmission: false
    });
  }
  const body = {
    v: 2,
    sourcePreviewSha256: source.value.previewSha256,
    mappingCatalogSha256: catalog.catalogSha256,
    candidates,
    gaps,
    scope: "retained-main-statements"
  };
  if (boundedKnowledgeWikidataPreviewJsonV2({ ...body, previewSha256: "0".repeat(64) }) === undefined) {
    return { ok: false, error: { code: "input-bound", field: "mapping-preview", retryable: false } };
  }
  return { ok: true, value: freezeKnowledgeDeclaration({ ...body, previewSha256: await sha256Text(canonicalJson(body)) }) };
}
async function verifyKnowledgeWikidataMappingPreviewV2(foreign, input) {
  const rebuilt = await createKnowledgeWikidataMappingPreviewV2(input);
  if (!rebuilt.ok)
    return rebuilt;
  const parsed = boundedKnowledgeWikidataPreviewJsonV2(foreign);
  if (parsed === undefined || canonicalJson(parsed) !== canonicalJson(rebuilt.value)) {
    return { ok: false, error: { code: "integrity-mismatch", field: "mapping-preview", retryable: false } };
  }
  return rebuilt;
}
export {
  verifyOhResearchPacketV1,
  verifyKnowledgeWikidataMappingPreviewV2,
  verifyKnowledgeWikidataMappingPreviewV1,
  verifyKnowledgeWikidataImportPreviewV2,
  verifyKnowledgeWikidataImportPreviewV1,
  verifyKnowledgeVocabularyPackLockV1,
  verifyKnowledgeValueV1,
  verifyKnowledgeSchemaEvolutionV1,
  verifyKnowledgeIdentityOperationAgainstHeadsV1,
  verifyKnowledgeEditionDependencyCompletenessV1,
  utf8ByteLength,
  traverseKnowledgeGraphV1,
  spongeKnowledgeWikidataMappingCatalogV2,
  spongeKnowledgeWikidataMappingCatalogV1,
  spongeKnowledgeReferenceCatalog,
  spongeKnowledgeDomainCatalogV3,
  spongeKnowledgeDomainCatalogV2,
  spongeKnowledgeDomainCatalog,
  spongeCoreKnowledgeCatalogV1,
  sha256Text,
  sha256Hex,
  resolveKnowledgeVocabularyPacksV1,
  reduceKnowledgeInquiryEventsV1,
  reduceKnowledgeGraphRevisionsV1,
  prepareOhResearchPacketV1,
  parseSpongeKnowledgeProposalDraftV3,
  parseSpongeKnowledgeProposalBundleV2,
  parseSha256Hex,
  parseKnowledgeWikidataImportInputV2,
  parseKnowledgeWikidataImportInputV1,
  parseKnowledgeVocabularyRevisionV1,
  parseKnowledgeVocabularyPackManifestV1,
  parseKnowledgeVocabularyPackLockV1,
  parseKnowledgeViewSpecV1,
  parseKnowledgeValueV1,
  parseKnowledgeValueRangeV1,
  parseKnowledgeTypeMembershipV1,
  parseKnowledgeSynthesisCandidateV1,
  parseKnowledgeStatementV1,
  parseKnowledgeShapeV1,
  parseKnowledgeSchemaRevisionV1,
  parseKnowledgeSchemaRefV1,
  parseKnowledgeRightsDecisionV1,
  parseKnowledgeReviewDecisionV1,
  parseKnowledgePreservedValueV1,
  parseKnowledgePreservedValuePayloadV1,
  parseKnowledgeInquiryV1,
  parseKnowledgeInquiryId,
  parseKnowledgeInquiryEventV1,
  parseKnowledgeIdentityOperationV1,
  parseKnowledgeHumanReviewReceiptV1,
  parseKnowledgeGraphRevisionV1,
  parseKnowledgeGraphRecordV1,
  parseKnowledgeExecutableShapeV1,
  parseKnowledgeEvidenceLinkV1,
  parseKnowledgeEvidenceId,
  parseKnowledgeEntityV1,
  parseKnowledgeEntityId,
  parseKnowledgeEditionV1,
  parseKnowledgeEditionReleaseV1,
  parseKnowledgeEditionId,
  parseKnowledgeEditionDependencyManifestV1,
  parseKnowledgeContextV1,
  parseKnowledgeAssertionV1,
  parseKnowledgeAssertionId,
  parseKnowledgeActivityV1,
  parseJsonValue,
  parseCanonicalInstantV1,
  ohResearchRecordKeyV1,
  knowledgeWikidataDatatypeSupportV2,
  knowledgeVocabularyPackPinV1,
  knowledgeInquiryTransitionNoteV1,
  knowledgeInquiryTransitionEventKindV1,
  knowledgeGraphRecordKeyV1,
  knowledgeDomainSchemaByRef,
  knowledgeDeclarativeJson,
  isPreparedOhResearchPacketV1,
  isKnowledgeWikidataEntityIdV2,
  isKnowledgeWikidataEntityIdV1,
  isKnowledgeLanguageTagV1,
  graphRevisionRetainsEvidenceV1,
  freezeKnowledgeDeclaration,
  evaluateKnowledgeShapeV1,
  effectiveKnowledgeRightsV1,
  effectiveKnowledgeReviewV1,
  createKnowledgeWikidataMappingPreviewV2,
  createKnowledgeWikidataMappingPreviewV1,
  createKnowledgeWikidataImportPreviewV2,
  createKnowledgeWikidataImportPreviewV1,
  createKnowledgeVocabularyRevisionV1,
  createKnowledgeVocabularyPackManifestV1,
  createKnowledgeVocabularyPackLockV1,
  createKnowledgeViewSpecV1,
  createKnowledgeTypeMembershipV1,
  createKnowledgeSynthesisCandidateV1,
  createKnowledgeStatementV1,
  createKnowledgeShapeV1,
  createKnowledgeSchemaRevisionV1,
  createKnowledgeRightsDecisionV1,
  createKnowledgeReviewDecisionV1,
  createKnowledgePreservedValueV1,
  createKnowledgeInquiryV1,
  createKnowledgeInquiryEventV1,
  createKnowledgeIdentityOperationV1,
  createKnowledgeHumanReviewReceiptV1,
  createKnowledgeGraphRevisionV1,
  createKnowledgeExecutableShapeV1,
  createKnowledgeEvidenceLinkV1,
  createKnowledgeEditionV1,
  createKnowledgeEditionReleaseV1,
  createKnowledgeEditionDependencyManifestV1,
  createKnowledgeContextV1,
  createKnowledgeAssertionV1,
  createKnowledgeActivityV1,
  compileSpongeKnowledgeProposalV3,
  compareUtf16CodeUnits,
  canonicalKnowledgeWikidataImportPreviewV2,
  canonicalKnowledgeWikidataImportPreviewV1,
  canonicalJson,
  boundedKnowledgeWikidataPreviewJsonV2,
  SPONGE_SHA256_HEX_PATTERN,
  SPONGE_KNOWLEDGE_SCENARIOS_V1,
  SPONGE_KNOWLEDGE_REVIEW_SUBJECT_KINDS_V1,
  SPONGE_KNOWLEDGE_PUBLIC_PURPOSE_V1,
  SPONGE_KNOWLEDGE_PACK_CODECS_V1,
  SPONGE_KNOWLEDGE_LIMITS_V1,
  SPONGE_KNOWLEDGE_KERNEL_CONCEPTS_V1,
  SPONGE_KNOWLEDGE_INQUIRY_EVENT_KINDS_V1,
  SPONGE_KNOWLEDGE_IDENTITY_OPERATION_KINDS_V1,
  SPONGE_KNOWLEDGE_GRAPH_RECORD_KINDS_V1,
  SPONGE_KNOWLEDGE_EVIDENCE_BEARINGS_V1,
  SPONGE_KNOWLEDGE_ENTITY_STATES_V1,
  SPONGE_KNOWLEDGE_DOMAIN_RANGE_NOTES_V2,
  SPONGE_KNOWLEDGE_DOMAIN_PACK_IDS,
  SPONGE_KNOWLEDGE_DISCLOSURES_V1,
  SPONGE_KNOWLEDGE_CALLER_KEY_RECORD_KINDS_V1,
  SPONGE_KNOWLEDGE_ASSERTION_STATES_V1,
  SPONGE_KNOWLEDGE_ASSERTION_STANCES_V1,
  SPONGE_KNOWLEDGE_ACTIVITY_KINDS_V1,
  SPONGE_CANONICAL_INSTANT_PATTERN,
  SPONGE_AGENT_PROPOSABLE_KNOWLEDGE_KINDS_V2,
  SPONGE_AGENT_CORE_PREDICATE_CODES_V2,
  SPONGE_AGENT_CORE_CONCEPT_CODES_V2,
  OH_RESEARCH_PACKET_PROFILE_V1,
  OH_RESEARCH_PACKET_LIMITS_V1,
  KNOWLEDGE_WIKIDATA_PROPERTY_GROUP_LIMIT_V2,
  KNOWLEDGE_WIKIDATA_PREVIEW_LIMITS_V2,
  KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V2,
  KNOWLEDGE_WIKIDATA_MAPPING_VERSION_V1,
  KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V2,
  KNOWLEDGE_WIKIDATA_IMPORT_LIMITS_V1,
  KNOWLEDGE_WIKIDATA_IMPORTER_V2,
  KNOWLEDGE_WIKIDATA_IMPORTER_V1,
  KNOWLEDGE_WIKIDATA_DATATYPES_V2
};
