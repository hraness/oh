import { canonicalJson, type JsonValue } from "./document-domain";
import { parseSha256Hex, sha256Text, type Sha256Hex } from "./integrity-domain";
import { freezeKnowledgeDeclaration, knowledgeDeclarativeJson } from "./knowledge-declarative-json";
import {
  parseKnowledgeExecutableShapeV1,
  parseKnowledgeSchemaRevisionV1,
  parseKnowledgeVocabularyRevisionV1,
  type KnowledgeExecutableShapeV1,
  type KnowledgeSchemaRevisionV1,
  type KnowledgeVocabularyRevisionV1,
} from "./knowledge-ontology-contract-v1";
import {
  parseKnowledgeSchemaRefV1,
  parseKnowledgeValueV1,
  verifyKnowledgeValueV1,
  type KnowledgeOntologyIssueCode,
  type KnowledgeOntologyResult,
  type KnowledgeSchemaRefV1,
  type KnowledgeValueV1,
} from "./knowledge-ontology-v1";
import { hasExactDataKeys, isPlainRecord } from "./unknown";

export const SPONGE_KNOWLEDGE_PACK_CODECS_V1 = [
  "globe-coordinate", "language-text", "missing-value", "wikibase-time",
] as const;
export type KnowledgePackCodecV1 = (typeof SPONGE_KNOWLEDGE_PACK_CODECS_V1)[number];
export type KnowledgeVocabularyPackPinV1 = Readonly<{
  manifestSha256: Sha256Hex;
  packId: string;
  revision: number;
  v: 1;
}>;
export type KnowledgeVocabularyPackSourceV1 = Readonly<{
  contentSha256: Sha256Hex;
  license: string;
  revision: string;
  uri: string;
  v: 1;
}>;
export type KnowledgeVocabularyPackExampleV1 = Readonly<{
  description: string;
  id: string;
  object: KnowledgeValueV1;
  predicate: KnowledgeSchemaRefV1;
  subjectConcept: KnowledgeSchemaRefV1;
  v: 1;
}>;
export type KnowledgeVocabularyPackQueryV1 = Readonly<{
  description: string;
  id: string;
  predicates: readonly KnowledgeSchemaRefV1[];
  v: 1;
}>;
export type KnowledgeVocabularyPackManifestV1 = Readonly<{
  canonicalizerSha256: Sha256Hex;
  dependencies: readonly KnowledgeVocabularyPackPinV1[];
  display: Readonly<{ labelPredicates: readonly KnowledgeSchemaRefV1[]; v: 1 }>;
  examples: readonly KnowledgeVocabularyPackExampleV1[];
  manifestSha256: Sha256Hex;
  migrationNotes: string;
  packId: string;
  previousManifestSha256: Sha256Hex | null;
  queries: readonly KnowledgeVocabularyPackQueryV1[];
  revision: number;
  schemas: readonly KnowledgeSchemaRevisionV1[];
  shapes: readonly KnowledgeExecutableShapeV1[];
  sources: readonly KnowledgeVocabularyPackSourceV1[];
  supportedCodecs: readonly KnowledgePackCodecV1[];
  v: 1;
  vocabulary: KnowledgeVocabularyRevisionV1;
}>;
export type KnowledgeVocabularyPackManifestInputV1 = Omit<KnowledgeVocabularyPackManifestV1, "manifestSha256">;
export type KnowledgeVocabularyPackLockV1 = Readonly<{
  lockSha256: Sha256Hex;
  packs: readonly KnowledgeVocabularyPackPinV1[];
  roots: readonly KnowledgeVocabularyPackPinV1[];
  v: 1;
}>;
export type KnowledgeVocabularyPackResolutionV1 = Readonly<{
  lock: KnowledgeVocabularyPackLockV1;
  /** Dependencies precede dependants; independent branches sort by pack identity. */
  packs: readonly KnowledgeVocabularyPackManifestV1[];
}>;

const manifestKeys = ["canonicalizerSha256", "dependencies", "display", "examples", "migrationNotes", "packId", "previousManifestSha256", "queries", "revision", "schemas", "shapes", "sources", "supportedCodecs", "v", "vocabulary"];
function failure<T>(field: string, code: KnowledgeOntologyIssueCode = "invalid-input"): KnowledgeOntologyResult<T> {
  return { ok: false, error: { code, field } };
}
function success<T>(value: T): KnowledgeOntologyResult<T> { return { ok: true, value: freezeKnowledgeDeclaration(value) }; }
function key(value: unknown): string { return canonicalJson(value as JsonValue); }
function code(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u.test(value);
}
function text(value: unknown, maximum = 16_384): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
function revision(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function ordered<T>(items: readonly T[], identity: (item: T) => string): boolean {
  return items.every((item, index) => index === 0 || identity(items[index - 1] as T) < identity(item));
}
function pins(value: unknown): readonly KnowledgeVocabularyPackPinV1[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const parsed: KnowledgeVocabularyPackPinV1[] = [];
  for (const pin of value) {
    if (!isPlainRecord(pin) || !hasExactDataKeys(pin, ["manifestSha256", "packId", "revision", "v"])
      || pin["v"] !== 1 || !code(pin["packId"]) || !revision(pin["revision"])) return null;
    const manifestSha256 = parseSha256Hex(pin["manifestSha256"]);
    if (manifestSha256 === null) return null;
    parsed.push({ manifestSha256, packId: pin["packId"], revision: pin["revision"], v: 1 });
  }
  return ordered(parsed, (pin) => pin.packId) ? parsed : null;
}
function refs(value: unknown): readonly KnowledgeSchemaRefV1[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const parsed: KnowledgeSchemaRefV1[] = [];
  for (const ref of value) {
    const result = parseKnowledgeSchemaRefV1(ref);
    if (!result.ok) return null;
    parsed.push(result.value);
  }
  return ordered(parsed, key) ? parsed : null;
}
export function knowledgeVocabularyPackPinV1(pack: KnowledgeVocabularyPackManifestV1): KnowledgeVocabularyPackPinV1 {
  return freezeKnowledgeDeclaration({ manifestSha256: pack.manifestSha256, packId: pack.packId, revision: pack.revision, v: 1 });
}

async function parseManifestInput(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackManifestInputV1>> {
  if (!isPlainRecord(value) || !hasExactDataKeys(value, manifestKeys) || value["v"] !== 1
    || !code(value["packId"]) || !revision(value["revision"]) || !text(value["migrationNotes"])) return failure("pack");
  const canonicalizerSha256 = parseSha256Hex(value["canonicalizerSha256"]);
  const previousManifestSha256 = value["previousManifestSha256"] === null ? null : parseSha256Hex(value["previousManifestSha256"]);
  const dependencies = pins(value["dependencies"]);
  if (canonicalizerSha256 === null || dependencies === null
    || (value["previousManifestSha256"] !== null && previousManifestSha256 === null)
    || (value["revision"] === 1) !== (previousManifestSha256 === null)
    || dependencies.some((pin) => pin.packId === value["packId"])) return failure("pack.dependencies");
  const vocabulary = await parseKnowledgeVocabularyRevisionV1(value["vocabulary"]);
  if (!vocabulary.ok) return failure("pack.vocabulary", vocabulary.error.code);
  if (vocabulary.value.namespace !== value["packId"] || vocabulary.value.revision !== value["revision"]
    || vocabulary.value.canonicalizerSha256 !== canonicalizerSha256) return failure("pack.namespace", "authority-violation");
  if (!Array.isArray(value["schemas"]) || value["schemas"].length > 512
    || !Array.isArray(value["shapes"]) || value["shapes"].length > 128
    || !Array.isArray(value["sources"]) || value["sources"].length > 64
    || !Array.isArray(value["examples"]) || value["examples"].length > 64
    || !Array.isArray(value["queries"]) || value["queries"].length > 64
    || !Array.isArray(value["supportedCodecs"]) || value["supportedCodecs"].length > 4) return failure("pack.bounds", "limit-exceeded");
  const schemas: KnowledgeSchemaRevisionV1[] = [];
  for (const schema of value["schemas"]) {
    const result = await parseKnowledgeSchemaRevisionV1(schema);
    if (!result.ok) return failure("pack.schemas", result.error.code);
    if (result.value.identity.namespace !== value["packId"]
      || result.value.vocabularySha256 !== vocabulary.value.revisionSha256) return failure("pack.schemas.namespace", "authority-violation");
    schemas.push(result.value);
  }
  if (!ordered(schemas, (schema) => schema.identity.code)) return failure("pack.schemas", "noncanonical-input");
  const shapes: KnowledgeExecutableShapeV1[] = [];
  for (const shape of value["shapes"]) {
    const result = await parseKnowledgeExecutableShapeV1(shape);
    if (!result.ok) return failure("pack.shapes", result.error.code);
    if (result.value.shape.namespace !== value["packId"]) return failure("pack.shapes.namespace", "authority-violation");
    shapes.push(result.value);
  }
  if (!ordered(shapes, (shape) => shape.shape.code)) return failure("pack.shapes", "noncanonical-input");
  const sources: KnowledgeVocabularyPackSourceV1[] = [];
  for (const source of value["sources"]) {
    if (!isPlainRecord(source) || !hasExactDataKeys(source, ["contentSha256", "license", "revision", "uri", "v"])
      || source["v"] !== 1 || !text(source["uri"], 2_048) || !/^(?:https?:\/\/|urn:)/u.test(source["uri"])
      || !text(source["license"], 256) || !text(source["revision"], 256)) return failure("pack.sources");
    const contentSha256 = parseSha256Hex(source["contentSha256"]);
    if (contentSha256 === null) return failure("pack.sources");
    sources.push({ contentSha256, license: source["license"], revision: source["revision"], uri: source["uri"], v: 1 });
  }
  if (!ordered(sources, key)) return failure("pack.sources", "noncanonical-input");
  const supportedCodecs: KnowledgePackCodecV1[] = [];
  for (const codec of value["supportedCodecs"]) {
    const admitted = SPONGE_KNOWLEDGE_PACK_CODECS_V1.find((item) => item === codec);
    if (admitted === undefined) return failure("pack.supportedCodecs");
    supportedCodecs.push(admitted);
  }
  if (!ordered(supportedCodecs, (item) => item)) return failure("pack.supportedCodecs", "noncanonical-input");
  const examples: KnowledgeVocabularyPackExampleV1[] = [];
  for (const example of value["examples"]) {
    if (!isPlainRecord(example) || !hasExactDataKeys(example, ["description", "id", "object", "predicate", "subjectConcept", "v"])
      || example["v"] !== 1 || !code(example["id"]) || !text(example["description"])) return failure("pack.examples");
    const predicate = parseKnowledgeSchemaRefV1(example["predicate"]);
    const subjectConcept = parseKnowledgeSchemaRefV1(example["subjectConcept"]);
    const object = parseKnowledgeValueV1(example["object"]);
    if (!predicate.ok || !subjectConcept.ok || !object.ok || !(await verifyKnowledgeValueV1(object.value)).ok) return failure("pack.examples");
    examples.push({ description: example["description"], id: example["id"], object: object.value, predicate: predicate.value, subjectConcept: subjectConcept.value, v: 1 });
  }
  if (!ordered(examples, (item) => item.id)) return failure("pack.examples", "noncanonical-input");
  const queries: KnowledgeVocabularyPackQueryV1[] = [];
  for (const query of value["queries"]) {
    if (!isPlainRecord(query) || !hasExactDataKeys(query, ["description", "id", "predicates", "v"])
      || query["v"] !== 1 || !code(query["id"]) || !text(query["description"])) return failure("pack.queries");
    const predicates = refs(query["predicates"]);
    if (predicates === null || predicates.length === 0) return failure("pack.queries.predicates");
    queries.push({ description: query["description"], id: query["id"], predicates, v: 1 });
  }
  if (!ordered(queries, (item) => item.id)) return failure("pack.queries", "noncanonical-input");
  const display = value["display"];
  if (!isPlainRecord(display) || !hasExactDataKeys(display, ["labelPredicates", "v"]) || display["v"] !== 1) return failure("pack.display");
  const labelPredicates = refs(display["labelPredicates"]);
  if (labelPredicates === null) return failure("pack.display");
  return success({ canonicalizerSha256, dependencies, display: { labelPredicates, v: 1 }, examples, migrationNotes: value["migrationNotes"], packId: value["packId"], previousManifestSha256, queries, revision: value["revision"], schemas, shapes, sources, supportedCodecs, v: 1, vocabulary: vocabulary.value });
}
export async function createKnowledgeVocabularyPackManifestV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackManifestV1>> {
  const input = knowledgeDeclarativeJson(value);
  const parsed = await parseManifestInput(input);
  return parsed.ok ? success({ ...parsed.value, manifestSha256: await sha256Text(key(parsed.value)) }) : parsed;
}
export async function parseKnowledgeVocabularyPackManifestV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackManifestV1>> {
  const input = knowledgeDeclarativeJson(value);
  if (!isPlainRecord(input) || !hasExactDataKeys(input, [...manifestKeys, "manifestSha256"])) return failure("pack");
  const { manifestSha256, ...body } = input;
  const parsed = await createKnowledgeVocabularyPackManifestV1(body);
  return parsed.ok && manifestSha256 !== parsed.value.manifestSha256 ? failure("manifestSha256", "digest-mismatch") : parsed;
}
export async function createKnowledgeVocabularyPackLockV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackLockV1>> {
  const input = knowledgeDeclarativeJson(value, 65_536);
  if (!isPlainRecord(input) || !hasExactDataKeys(input, ["packs", "roots", "v"]) || input["v"] !== 1) return failure("lock");
  const packs = pins(input["packs"]);
  const roots = pins(input["roots"]);
  if (packs === null || roots === null || roots.length === 0 || roots.some((root) => !packs.some((pin) => key(pin) === key(root)))) return failure("lock.pins");
  const body = { packs, roots, v: 1 as const };
  return success({ ...body, lockSha256: await sha256Text(key(body)) });
}
export async function parseKnowledgeVocabularyPackLockV1(value: unknown): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackLockV1>> {
  const input = knowledgeDeclarativeJson(value, 65_536);
  if (!isPlainRecord(input) || !hasExactDataKeys(input, ["lockSha256", "packs", "roots", "v"])) return failure("lock");
  const parsed = await createKnowledgeVocabularyPackLockV1({ packs: input["packs"], roots: input["roots"], v: input["v"] });
  return parsed.ok && input["lockSha256"] !== parsed.value.lockSha256 ? failure("lockSha256", "digest-mismatch") : parsed;
}

/** Validates data closure only. Installation must independently authorize the space and namespace owner. */
export async function resolveKnowledgeVocabularyPacksV1(input: Readonly<{
  manifests: readonly unknown[];
  roots: readonly KnowledgeVocabularyPackPinV1[];
}>): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackResolutionV1>> {
  const rootJson = knowledgeDeclarativeJson(input.roots, 65_536);
  const roots = pins(rootJson);
  if (roots === null || roots.length === 0 || !Array.isArray(input.manifests) || input.manifests.length > 64) return failure("packs.bounds", "limit-exceeded");
  const byId = new Map<string, KnowledgeVocabularyPackManifestV1>();
  for (const manifest of input.manifests) {
    const parsed = await parseKnowledgeVocabularyPackManifestV1(manifest);
    if (!parsed.ok) return parsed;
    if (byId.has(parsed.value.packId)) return failure("packs.namespace", "authority-violation");
    byId.set(parsed.value.packId, parsed.value);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const packs: KnowledgeVocabularyPackManifestV1[] = [];
  function visit(pin: KnowledgeVocabularyPackPinV1): KnowledgeOntologyResult<true> {
    const pack = byId.get(pin.packId);
    if (pack === undefined) return failure("packs.dependency", "dependency-missing");
    if (key(knowledgeVocabularyPackPinV1(pack)) !== key(pin)) return failure("packs.dependency", "digest-mismatch");
    if (visiting.has(pack.packId)) return failure("packs.dependencies", "cycle-detected");
    if (visited.has(pack.packId)) return { ok: true, value: true };
    visiting.add(pack.packId);
    for (const dependency of pack.dependencies) {
      const result = visit(dependency);
      if (!result.ok) return result;
      if (byId.get(dependency.packId)?.canonicalizerSha256 !== pack.canonicalizerSha256) return failure("packs.canonicalizer", "digest-mismatch");
    }
    visiting.delete(pack.packId);
    visited.add(pack.packId);
    packs.push(pack);
    return { ok: true, value: true };
  }
  for (const root of roots) { const result = visit(root); if (!result.ok) return result; }
  for (const pack of packs) {
    const allowed = new Map<string, KnowledgeSchemaRevisionV1>();
    const allowedShapes = new Map<string, KnowledgeExecutableShapeV1>();
    const allowedPacks = new Set<string>();
    function include(current: KnowledgeVocabularyPackManifestV1): void {
      if (allowedPacks.has(current.packId)) return;
      allowedPacks.add(current.packId);
      for (const schema of current.schemas) allowed.set(key(schema.ref), schema);
      for (const shape of current.shapes) allowedShapes.set(key(shape.shape), shape);
      for (const dependency of current.dependencies) include(byId.get(dependency.packId) as KnowledgeVocabularyPackManifestV1);
    }
    include(pack);
    function inspect(value: unknown): boolean {
      if (Array.isArray(value)) return value.every(inspect);
      if (!isPlainRecord(value)) return true;
      if (hasExactDataKeys(value, ["code", "namespace", "revision", "schemaSha256", "v"])) return allowed.has(key(value));
      return Object.values(value).every(inspect);
    }
    if (!inspect([pack.schemas, pack.shapes, pack.examples, pack.queries, pack.display])) return failure("packs.schema-reference", "dependency-missing");
    const hasKind = (ref: KnowledgeSchemaRefV1, kind: KnowledgeSchemaRevisionV1["kind"]) => allowed.get(key(ref))?.kind === kind;
    for (const schema of pack.schemas) {
      if (schema.kind === "concept" && !schema.broader.every((ref) => hasKind(ref, "concept"))) return failure("packs.broader");
      if (schema.kind === "predicate" && (!schema.domainConcepts.every((ref) => hasKind(ref, "concept"))
        || !schema.qualifierPredicates.every((ref) => hasKind(ref, "predicate"))
        || (schema.inversePredicate !== null && !hasKind(schema.inversePredicate, "predicate"))
        || (schema.range.kind === "entity-concepts" && !schema.range.concepts.every((ref) => hasKind(ref, "concept")))
        || (schema.range.kind === "numeric" && schema.range.unit !== null && !hasKind(schema.range.unit, "unit")))) return failure("packs.predicate");
    }
    for (const shape of pack.shapes) {
      if (!shape.appliesToConcepts.every((ref) => hasKind(ref, "concept"))
        || !shape.rules.every((rule) => hasKind(rule.predicate, "predicate"))) return failure("packs.shape");
      const ancestry = new Set<string>();
      const completed = new Set<string>();
      function validateInheritance(current: KnowledgeExecutableShapeV1, depth: number): KnowledgeOntologyResult<true> {
        const identity = key(current.shape);
        if (ancestry.has(identity)) return failure("packs.shape-inheritance", "cycle-detected");
        if (depth > shape.maximumInheritanceDepth || completed.size >= 256) return failure("packs.shape-inheritance", "limit-exceeded");
        if (completed.has(identity)) return { ok: true, value: true };
        ancestry.add(identity);
        for (const ref of current.extends) {
          const parent = allowedShapes.get(key(ref));
          if (parent === undefined) return failure("packs.shape-inheritance", "dependency-missing");
          const result = validateInheritance(parent, depth + 1);
          if (!result.ok) return result;
        }
        ancestry.delete(identity);
        completed.add(identity);
        return { ok: true, value: true };
      }
      const inheritance = validateInheritance(shape, 0);
      if (!inheritance.ok) return inheritance;
    }
    if (!pack.examples.every((example) => hasKind(example.subjectConcept, "concept") && hasKind(example.predicate, "predicate"))
      || !pack.queries.every((query) => query.predicates.every((ref) => hasKind(ref, "predicate")))
      || !pack.display.labelPredicates.every((ref) => hasKind(ref, "predicate"))) return failure("packs.declarations");
  }
  const lock = await createKnowledgeVocabularyPackLockV1({ packs: packs.map(knowledgeVocabularyPackPinV1).sort((left, right) => left.packId < right.packId ? -1 : 1), roots, v: 1 });
  return lock.ok ? success({ lock: lock.value, packs }) : lock;
}

/** A digest-valid lock is authoritative only after its exact transitive closure is verified. */
export async function verifyKnowledgeVocabularyPackLockV1(input: Readonly<{
  lock: unknown;
  manifests: readonly unknown[];
}>): Promise<KnowledgeOntologyResult<KnowledgeVocabularyPackResolutionV1>> {
  const lock = await parseKnowledgeVocabularyPackLockV1(input.lock);
  if (!lock.ok) return lock;
  const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: input.manifests, roots: lock.value.roots });
  if (!resolved.ok) return resolved;
  return resolved.value.lock.lockSha256 === lock.value.lockSha256 ? resolved : failure("lock.closure", "digest-mismatch");
}
