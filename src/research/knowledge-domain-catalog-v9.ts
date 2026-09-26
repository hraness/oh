import { canonicalJson, type JsonValue } from "./document-domain";
import { freezeKnowledgeDeclaration } from "./knowledge-declarative-json";
import { spongeKnowledgeDomainCatalogV8, type SpongeKnowledgeDomainCatalogV8 } from "./knowledge-domain-catalog-v8";
import {
  createKnowledgeExecutableShapeV1, createKnowledgeSchemaRevisionV1, createKnowledgeVocabularyRevisionV1,
  type KnowledgeExecutableShapeV1, type KnowledgeSchemaRevisionV1,
} from "./knowledge-ontology-contract-v1";
import type { KnowledgeOntologyResult, KnowledgeSchemaRefV1 } from "./knowledge-ontology-v1";
import {
  createKnowledgeVocabularyPackManifestV1, knowledgeVocabularyPackPinV1, resolveKnowledgeVocabularyPacksV1,
  type KnowledgeVocabularyPackManifestV1, type KnowledgeVocabularyPackPinV1,
} from "./knowledge-vocabulary-pack-v1";

/** Packs whose pinned guide was rewritten in plain style; each moves to manifest revision 2. */
export const SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9 = [
  "sponge.bridge-relations", "sponge.citation", "sponge.content-occurrences", "sponge.evidence-grading",
  "sponge.measurement-results", "sponge.monetary-values", "sponge.participation-roles", "sponge.research-ops",
  "sponge.source-policy", "sponge.source-quality", "sponge.temporal-roles",
] as const;

export type SpongeKnowledgeRevisedPackIdV9 = (typeof SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9)[number];

const GUIDE_REVISION_V9 = "2026-09-26";

/** SHA-256 of each spec/research-v1/<name>-v2.md guide, byte for byte. */
const GUIDE_SHA256_V9: Readonly<Record<SpongeKnowledgeRevisedPackIdV9, string>> = {
  "sponge.bridge-relations": "aa43285f5d74e36daf65c63092d90ac01795f8ea31cbe692b9f38152ef7dbc24",
  "sponge.citation": "637574160df2d2c44e53d413641b06342260843fae682a6e140c834e1ae1e7d9",
  "sponge.content-occurrences": "481cc7d5255943b2b9ab99f42ca8d581dd322a457442d8dab583a67fe153de00",
  "sponge.evidence-grading": "368703e54b0ca282783484efc3ab9f9c2a870554c42a732c3d82b24985b7a889",
  "sponge.measurement-results": "5262d3571bce145d59cf6ce757d53ec3f721d0394cae8668ca75fbfcca9ff80b",
  "sponge.monetary-values": "c26f2739317539c714596f49985e502ff74fc833516b02bedf0dd6f315a494c6",
  "sponge.participation-roles": "b804396f5234cbce44a8866135338aaae74d81b71ef98dca4f502c3ab559ff0b",
  "sponge.research-ops": "2dade72875ff7a4956fbcc971e9a03940de54d83b1bd45b71fcf89c845e1d033",
  "sponge.source-policy": "43c3d120dcb7c7af08b8efcdde36cc935971d350c8b2fee761b909270c8c65ec",
  "sponge.source-quality": "609a2b04597ffc98933dbb8c7e7ac04f7995ee98e53f5b49a155d2d3205c23c3",
  "sponge.temporal-roles": "4f2626634b52767727386633b6359a613b67eef3f60f10e9c3842702463adcc1",
};

const MIGRATION_NOTES_V9 = "Revision 2 pins the V2 guide, which rewrites the V1 guide prose in plain style. Concepts, predicates, labels, definitions, ranges, qualifiers, shapes, queries and examples have the same meaning as revision 1; schema references point at revision 2 schemas and dependency pins point at catalog V9 manifests. Revision 1 manifests and digests are unchanged and resolve from catalog V8. No entity is retyped, no accepted statement is rewritten, and no publication or identity authority is granted.";

export type SpongeKnowledgeDomainCatalogV9 = SpongeKnowledgeDomainCatalogV8;

let catalogPromise: Promise<SpongeKnowledgeDomainCatalogV9> | undefined;

/** Catalog V8 with every digest-pinned guide pack moved to revision 2 under its V2 guide. */
export function spongeKnowledgeDomainCatalogV9(): Promise<SpongeKnowledgeDomainCatalogV9> {
  catalogPromise ??= buildCatalog();
  return catalogPromise;
}

function canonical(value: unknown): string { return canonicalJson(value as JsonValue); }
function unwrap<T>(result: KnowledgeOntologyResult<T>): T {
  if (!result.ok) throw new Error(`Invalid revised guide pack: ${result.error.field}:${result.error.code}.`);
  return result.value;
}
function isRef(value: unknown): value is KnowledgeSchemaRefV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.join(",") === "code,namespace,revision,schemaSha256,v";
}
function refsIn(value: unknown, found: KnowledgeSchemaRefV1[] = []): KnowledgeSchemaRefV1[] {
  if (Array.isArray(value)) for (const item of value) refsIn(item, found);
  else if (isRef(value)) found.push(value);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) refsIn(item, found);
  return found;
}

type RefMap = Map<string, KnowledgeSchemaRefV1>;

/** Replaces every revised schema reference and keeps reference arrays in canonical order. */
function remap<T>(value: T, refs: RefMap): T {
  if (Array.isArray(value)) {
    const items = value.map(item => remap(item, refs));
    return (items.length > 0 && items.every(isRef)
      ? items.sort((left, right) => canonical(left) < canonical(right) ? -1 : 1)
      : items) as T;
  }
  if (isRef(value)) return (refs.get(canonical(value)) ?? value) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, refs)])) as T;
  }
  return value;
}

function withoutKeys(value: object, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

async function reviseSchemas(previous: KnowledgeVocabularyPackManifestV1, vocabularySha256: string, refs: RefMap) {
  const pending = new Map(previous.schemas.map(schema => [canonical(schema.ref), schema]));
  const revised: KnowledgeSchemaRevisionV1[] = [];
  while (pending.size > 0) {
    const ready = [...pending.values()].filter(schema => refsIn(withoutKeys(schema, ["ref"]))
      .every(ref => !pending.has(canonical(ref))));
    if (ready.length === 0) throw new Error(`Cyclic schema references in ${previous.packId}.`);
    for (const schema of ready) {
      const input = remap(withoutKeys(schema, ["ref", "revisionSha256"]), refs);
      const next = unwrap(await createKnowledgeSchemaRevisionV1({ ...input,
        identity: { ...schema.identity, revision: schema.identity.revision + 1 },
        previousRevisionSha256: schema.revisionSha256, reviewDecisionSha256: null,
        vocabularySha256 } as never));
      refs.set(canonical(schema.ref), next.ref);
      revised.push(next);
      pending.delete(canonical(schema.ref));
    }
  }
  return revised.sort((left, right) => left.identity.code < right.identity.code ? -1 : 1);
}

async function reviseShape(shape: KnowledgeExecutableShapeV1, refs: RefMap): Promise<KnowledgeExecutableShapeV1> {
  const input = remap(withoutKeys(shape, ["shapeSha256"]), refs) as Omit<KnowledgeExecutableShapeV1, "shapeSha256">;
  const rules = [...input.rules].sort((left, right) =>
    canonical({ predicate: left.predicate, purpose: left.purpose }) < canonical({ predicate: right.predicate, purpose: right.purpose }) ? -1 : 1);
  return unwrap(await createKnowledgeExecutableShapeV1({ ...input, rules }));
}

async function revisePack(
  previous: KnowledgeVocabularyPackManifestV1,
  refs: RefMap,
  pins: ReadonlyMap<string, KnowledgeVocabularyPackPinV1>,
): Promise<KnowledgeVocabularyPackManifestV1> {
  const packId = previous.packId as SpongeKnowledgeRevisedPackIdV9;
  const vocabulary = unwrap(await createKnowledgeVocabularyRevisionV1({
    ...withoutKeys(previous.vocabulary, ["revisionSha256"]),
    previousRevisionSha256: previous.vocabulary.revisionSha256, revision: previous.vocabulary.revision + 1,
  } as never));
  const schemas = await reviseSchemas(previous, vocabulary.revisionSha256, refs);
  const shapes: KnowledgeExecutableShapeV1[] = [];
  for (const shape of previous.shapes) shapes.push(await reviseShape(shape, refs));
  const name = packId.slice("sponge.".length);
  return unwrap(await createKnowledgeVocabularyPackManifestV1({
    canonicalizerSha256: previous.canonicalizerSha256,
    dependencies: previous.dependencies.map(pin => pins.get(pin.packId) ?? pin),
    display: remap(previous.display, refs), examples: remap(previous.examples, refs),
    migrationNotes: MIGRATION_NOTES_V9, packId, previousManifestSha256: previous.manifestSha256,
    queries: remap(previous.queries, refs), revision: previous.revision + 1, schemas, shapes,
    sources: [{ contentSha256: GUIDE_SHA256_V9[packId], license: "MIT", revision: GUIDE_REVISION_V9,
      uri: `https://github.com/hraness/oh/blob/main/spec/research-v1/${name}-v2.md`, v: 1 }],
    supportedCodecs: previous.supportedCodecs, v: 1, vocabulary,
  }));
}

async function buildCatalog(): Promise<SpongeKnowledgeDomainCatalogV9> {
  const previous = await spongeKnowledgeDomainCatalogV8();
  const revisedIds = new Set<string>(SPONGE_KNOWLEDGE_REVISED_PACK_IDS_V9);
  const replaced = previous.packs.filter(pack => revisedIds.has(pack.packId));
  if (replaced.length !== revisedIds.size) throw new Error("Missing a catalog V8 guide pack.");
  const refs: RefMap = new Map();
  const pins = new Map<string, KnowledgeVocabularyPackPinV1>();
  const revised = new Map<string, KnowledgeVocabularyPackManifestV1>();
  while (revised.size < replaced.length) {
    const ready = replaced.filter(pack => !revised.has(pack.packId)
      && pack.dependencies.every(pin => !revisedIds.has(pin.packId) || revised.has(pin.packId)));
    if (ready.length === 0) throw new Error("Cyclic guide pack dependencies.");
    for (const pack of ready) {
      const next = await revisePack(pack, refs, pins);
      revised.set(pack.packId, next);
      pins.set(pack.packId, knowledgeVocabularyPackPinV1(next));
    }
  }
  const pack = (id: SpongeKnowledgeRevisedPackIdV9) => revised.get(id) as KnowledgeVocabularyPackManifestV1;
  const packs = previous.packs.map(item => revised.get(item.packId) ?? item);
  const roots = previous.lock.roots.map(pin => pins.get(pin.packId) ?? pin);
  const resolved = await resolveKnowledgeVocabularyPacksV1({ manifests: packs, roots });
  if (!resolved.ok) throw new Error(`Invalid revised guide catalog: ${resolved.error.field}:${resolved.error.code}.`);
  return freezeKnowledgeDeclaration({ ...previous,
    bridgeRelationsPack: pack("sponge.bridge-relations"), citationPack: pack("sponge.citation"),
    contentOccurrencesPack: pack("sponge.content-occurrences"), evidenceGradingPack: pack("sponge.evidence-grading"),
    historicalPacks: [...previous.historicalPacks, ...replaced], lock: resolved.value.lock,
    measurementResultsPack: pack("sponge.measurement-results"), monetaryValuesPack: pack("sponge.monetary-values"),
    packs, participationRolesPack: pack("sponge.participation-roles"), researchOpsPack: pack("sponge.research-ops"),
    schemas: packs.flatMap(item => item.schemas), sourcePolicyPack: pack("sponge.source-policy"),
    sourceQualityPack: pack("sponge.source-quality"), temporalRolesPack: pack("sponge.temporal-roles"),
    vocabularies: packs.map(item => item.vocabulary) });
}
