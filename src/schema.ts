import {
  boundedText,
  canonicalJson,
  canonicalSha256,
  hasExactKeys,
  isPlainRecord,
  orderedUnique,
  parseSha256Hex,
  safeCode,
  type JsonObject,
  type Sha256Hex,
} from "./canonical";
import { parseKnowledgeSchemaRefV1, type KnowledgeSchemaRefV1 } from "./ontology";

export const OH_SCHEMA_FORMAT_VERSION_V1 = 1 as const;
export const OH_SCHEMA_KINDS_V1 = ["concept", "mapping", "predicate", "shape", "unit", "vocabulary"] as const;
export type KnowledgeSchemaKindV1 = (typeof OH_SCHEMA_KINDS_V1)[number];

export type KnowledgeLocalizedTextV1 = Readonly<{ language: string; text: string; v: 1 }>;

export type KnowledgeSchemaRevisionInputV1 = Readonly<{
  body: JsonObject;
  code: string;
  compatibility: "additive" | "breaking";
  description: readonly KnowledgeLocalizedTextV1[];
  kind: KnowledgeSchemaKindV1;
  labels: readonly KnowledgeLocalizedTextV1[];
  namespace: string;
  previousSchemaSha256: Sha256Hex | null;
  revision: number;
  v: 1;
}>;

export type KnowledgeSchemaRevisionV1 = KnowledgeSchemaRevisionInputV1 & Readonly<{
  schemaSha256: Sha256Hex;
}>;

export type KnowledgeVocabularyRevisionV1 = Readonly<{
  namespace: string;
  revision: number;
  schemaRefs: readonly KnowledgeSchemaRefV1[];
  v: 1;
  vocabularySha256: Sha256Hex;
}>;

function parseLocalizedTexts(value: unknown): readonly KnowledgeLocalizedTextV1[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return null;
  const output: KnowledgeLocalizedTextV1[] = [];
  for (const item of value) {
    if (!isPlainRecord(item) || !hasExactKeys(item, ["language", "text", "v"]) || item.v !== 1) return null;
    const language = typeof item.language === "string"
        && /^(?:und|[a-z]{2,3}(?:-[a-z0-9]{2,8})*)$/u.test(item.language)
      ? item.language : null;
    const text = boundedText(item.text, 16_384);
    if (language === null || text === null) return null;
    output.push({ language, text, v: 1 });
  }
  return orderedUnique(output, canonicalJson) ? output : null;
}

function parseSchemaInput(value: unknown): KnowledgeSchemaRevisionInputV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["body", "code", "compatibility", "description",
    "kind", "labels", "namespace", "previousSchemaSha256", "revision", "v"]) || value.v !== 1
    || !isPlainRecord(value.body)) return null;
  try { canonicalJson(value.body); } catch { return null; }
  const code = safeCode(value.code);
  const namespace = safeCode(value.namespace);
  const kind = OH_SCHEMA_KINDS_V1.find((candidate) => candidate === value.kind);
  const labels = parseLocalizedTexts(value.labels);
  const description = parseLocalizedTexts(value.description);
  const previousSchemaSha256 = value.previousSchemaSha256 === null ? null : parseSha256Hex(value.previousSchemaSha256);
  const revision = Number.isSafeInteger(value.revision) && (value.revision as number) > 0
    ? value.revision as number : null;
  const compatibility = value.compatibility === "additive" || value.compatibility === "breaking"
    ? value.compatibility : null;
  return code !== null && namespace !== null && kind !== undefined && labels !== null
      && description !== null && (value.previousSchemaSha256 === null || previousSchemaSha256 !== null)
      && revision !== null && compatibility !== null
      && ((revision === 1) === (previousSchemaSha256 === null))
      && (revision !== 1 || compatibility === "additive")
    ? { body: value.body as JsonObject, code, compatibility, description, kind, labels,
        namespace, previousSchemaSha256, revision, v: 1 }
    : null;
}

export function createKnowledgeSchemaRevisionV1(input: KnowledgeSchemaRevisionInputV1): KnowledgeSchemaRevisionV1 {
  const parsed = parseSchemaInput(input);
  if (parsed === null) throw new TypeError("Invalid schema revision input.");
  return { ...parsed, schemaSha256: canonicalSha256(parsed) };
}

export function parseKnowledgeSchemaRevisionV1(value: unknown): KnowledgeSchemaRevisionV1 | null {
  if (!isPlainRecord(value) || !Object.hasOwn(value, "schemaSha256")) return null;
  const schemaSha256 = parseSha256Hex(value.schemaSha256);
  const { schemaSha256: _digest, ...input } = value;
  const parsed = parseSchemaInput(input);
  return schemaSha256 !== null && parsed !== null && canonicalSha256(parsed) === schemaSha256
    ? { ...parsed, schemaSha256 } : null;
}

export function knowledgeSchemaRefV1(schema: KnowledgeSchemaRevisionV1): KnowledgeSchemaRefV1 {
  return { code: schema.code, namespace: schema.namespace, revision: schema.revision,
    schemaSha256: schema.schemaSha256, v: 1 };
}

function additiveBodyRetainsPrior(prior: JsonObject, next: JsonObject): boolean {
  return Object.entries(prior).every(([key, value]) => Object.hasOwn(next, key)
    && canonicalJson(next[key]) === canonicalJson(value));
}

/** Checks the immutable chain and the meaning of an additive evolution claim. */
export function verifyKnowledgeSchemaEvolutionV1(
  prior: KnowledgeSchemaRevisionV1,
  next: KnowledgeSchemaRevisionV1,
): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }> {
  if (parseKnowledgeSchemaRevisionV1(prior) === null || parseKnowledgeSchemaRevisionV1(next) === null) {
    return { ok: false, reason: "invalid-schema" };
  }
  if (prior.namespace !== next.namespace || prior.code !== next.code || prior.kind !== next.kind) {
    return { ok: false, reason: "identity-changed" };
  }
  if (next.revision !== prior.revision + 1 || next.previousSchemaSha256 !== prior.schemaSha256) {
    return { ok: false, reason: "chain-broken" };
  }
  if (next.compatibility === "additive" && !additiveBodyRetainsPrior(prior.body, next.body)) {
    return { ok: false, reason: "false-additive-claim" };
  }
  return { ok: true };
}

export function createKnowledgeVocabularyRevisionV1(input: Omit<KnowledgeVocabularyRevisionV1, "vocabularySha256">): KnowledgeVocabularyRevisionV1 {
  const namespace = safeCode(input.namespace);
  if (namespace === null || input.v !== 1 || !Number.isSafeInteger(input.revision) || input.revision < 1
    || !Array.isArray(input.schemaRefs) || input.schemaRefs.length > 65_536) {
    throw new TypeError("Invalid vocabulary revision input.");
  }
  const refs: KnowledgeSchemaRefV1[] = [];
  for (const candidate of input.schemaRefs) {
    const parsed = parseKnowledgeSchemaRefV1(candidate);
    if (!parsed.ok || parsed.value.namespace !== namespace) throw new TypeError("Invalid vocabulary schema reference.");
    refs.push(parsed.value);
  }
  if (!orderedUnique(refs, canonicalJson)) throw new TypeError("Vocabulary schema references must be ordered and unique.");
  const payload = { namespace, revision: input.revision, schemaRefs: refs, v: 1 as const };
  return { ...payload, vocabularySha256: canonicalSha256(payload) };
}

export function parseKnowledgeVocabularyRevisionV1(value: unknown): KnowledgeVocabularyRevisionV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["namespace", "revision", "schemaRefs", "v", "vocabularySha256"])) return null;
  const digest = parseSha256Hex(value.vocabularySha256);
  try {
    const created = createKnowledgeVocabularyRevisionV1({ namespace: value.namespace as string,
      revision: value.revision as number, schemaRefs: value.schemaRefs as KnowledgeSchemaRefV1[], v: value.v as 1 });
    return digest !== null && created.vocabularySha256 === digest ? { ...created, vocabularySha256: digest } : null;
  } catch { return null; }
}
