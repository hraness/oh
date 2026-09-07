import {
  canonicalJson,
  canonicalSha256,
  parseCanonicalInstantV1,
  parseSha256Hex,
  safeCode,
  sha256Hex,
  type Sha256Hex,
} from "./canonical";
import {
  OH_CLOUDFLARE_EMBEDDING_PROFILE_V1,
  OH_SEMANTIC_RENDERER_V1,
  type OhCloudflareEmbeddingClientV1,
  type OhRenderedEmbeddingInputV1,
} from "./cloudflare-embedding";
import type { OhLibSqlResultV1 } from "./libsql";
import { normalizeOhEmbeddingV1 } from "./semantic-model";
export const OH_LIBSQL_SEMANTIC_LIMITS_V2 = Object.freeze({
  chunksPerDocument: 64,
  chunksPerGeneration: 4096,
  documentsPerGeneration: 512,
  embeddingBatch: 16,
  searchLimit: 100,
  searchPage: 128,
});
export class OhLibSqlSemanticV2Error extends Error {
  readonly code: "conflict" | "integrity" | "invalid-input" | "purged" | "schema-unavailable";
  constructor(code: OhLibSqlSemanticV2Error["code"], message: string) {
    super(message);
    this.name = "OhLibSqlSemanticV2Error";
    this.code = code;
  }
}
export type OhSemanticAuthorityRefV2 = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  generation: number;
  /** Defaults to an authority-specific isolation when omitted. */
  isolationSha256?: Sha256Hex;
  records: readonly Readonly<{
    key: string;
    recordSha256: Sha256Hex;
  }>[];
  v: 2;
}>;
export type OhSemanticDocumentV2 = Readonly<{
  content: string;
  key: string;
  recordSha256: Sha256Hex;
  title: string;
  v: 2;
}>;
export type OhSemanticStageResultV2 = Readonly<{
  authorityId: string;
  chunks: number;
  documents: number;
  embedded: number;
  generation: number;
  generationSha256: Sha256Hex;
  isolationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  reused: number;
  status: "staged";
  v: 2;
}>;
export type OhSemanticPublishResultV2 = Readonly<{
  authorityId: string;
  generation: number;
  generationSha256: Sha256Hex;
  isolationSha256: Sha256Hex;
  published: boolean;
  v: 2;
}>;
export type OhSemanticPublishedHeadV2 = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  generation: number;
  generationSha256: Sha256Hex;
  isolationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  profileSha256: Sha256Hex;
  publishedAt: string;
  rendererSha256: Sha256Hex;
  v: 2;
}>;
export type OhSemanticSearchResultV2 = Readonly<{
  chunkOrdinal: number;
  key: string;
  recordSha256: Sha256Hex;
  score: number;
  v: 2;
}>;
export type OhSemanticPurgeResultV2 = Readonly<{
  authorityId: string;
  countsRecorded: boolean;
  generations: number;
  isolationScopes: number;
  isolationSha256: Sha256Hex;
  memberships: number;
  orphanVectors: number;
  profileSha256: Sha256Hex;
  publishedGeneration: number | null;
  publishedGenerationSha256: Sha256Hex | null;
  purgeMarkerSha256: Sha256Hex;
  purgeReceiptSha256: Sha256Hex;
  purgedAt: string;
  residualGenerations: 0;
  residualMemberships: 0;
  residualScopedVectors: 0;
  v: 2;
}>;
export const SCHEMA_NAME_V1 = "oh.libsql-semantic-cache.v1";
export const SCHEMA_VERSION_V1 = 1;
export const SCHEMA_NAME = "oh.libsql-semantic-cache.v2";
export const SCHEMA_VERSION = 2;
export const VECTOR_BYTES = OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions * 4;
export const DEFAULT_ISOLATION_KIND = "oh.semantic-authority-isolation.v2";
export const GENERATION_KIND = "oh.semantic-generation.v2";
export const MEMBERSHIP_KIND = "oh.semantic-membership.v2";
export const PURGE_MARKER_KIND = "oh.semantic-purge-marker.v2";
export const PURGE_RECEIPT_KIND = "oh.semantic-purge-receipt.v2";
export const TRANSITION_PAGE_SIZE = 32;
export const TRANSITION_TABLE_NAME = "oh_semantic_v1_purge_transition";
export const SCHEMA_TABLE = `CREATE TABLE IF NOT EXISTS oh_semantic_schemas (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;
export const TRANSITION_TABLE = `CREATE TABLE oh_semantic_v1_purge_transition (
  authority_id TEXT PRIMARY KEY,
  purged_at TEXT NOT NULL
) STRICT`;
export const SCHEMA_STATEMENTS_V1 = Object.freeze([
  `CREATE TABLE IF NOT EXISTS oh_semantic_vectors (
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    vector_sha256 TEXT NOT NULL,
    vector BLOB NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(profile_sha256, renderer_sha256, input_sha256)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_generations (
    authority_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    authority_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    membership_sha256 TEXT NOT NULL,
    generation_sha256 TEXT NOT NULL UNIQUE,
    document_count INTEGER NOT NULL CHECK(document_count >= 0),
    chunk_count INTEGER NOT NULL CHECK(chunk_count >= 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY(authority_id, generation)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_memberships (
    authority_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    generation_sha256 TEXT NOT NULL,
    record_key TEXT NOT NULL,
    record_sha256 TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    input_sha256 TEXT NOT NULL,
    PRIMARY KEY(authority_id, generation, record_key, ordinal)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_heads (
    authority_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    authority_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    membership_sha256 TEXT NOT NULL,
    generation_sha256 TEXT NOT NULL,
    published_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_purges (
    authority_id TEXT PRIMARY KEY,
    purged_at TEXT NOT NULL
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS oh_semantic_memberships_generation
    ON oh_semantic_memberships(authority_id, generation, record_key, ordinal)`,
  `CREATE INDEX IF NOT EXISTS oh_semantic_memberships_input
    ON oh_semantic_memberships(input_sha256)`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_vectors_no_update
    BEFORE UPDATE ON oh_semantic_vectors
    BEGIN SELECT RAISE(ABORT, 'Oh semantic vectors are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_generations_no_update
    BEFORE UPDATE ON oh_semantic_generations
    BEGIN SELECT RAISE(ABORT, 'Oh semantic generations are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_no_update
    BEFORE UPDATE ON oh_semantic_memberships
    BEGIN SELECT RAISE(ABORT, 'Oh semantic memberships are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_generations_purge_guard
    BEFORE INSERT ON oh_semantic_generations
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_purge_guard
    BEFORE INSERT ON oh_semantic_memberships
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_published_guard
    BEFORE INSERT ON oh_semantic_memberships
    WHEN EXISTS (SELECT 1 FROM oh_semantic_heads
      WHERE authority_id = NEW.authority_id AND generation = NEW.generation)
      AND NOT EXISTS (SELECT 1 FROM oh_semantic_memberships
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND record_key = NEW.record_key AND record_sha256 = NEW.record_sha256
          AND ordinal = NEW.ordinal AND input_sha256 = NEW.input_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic generation is published'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_heads_insert_purge_guard
    BEFORE INSERT ON oh_semantic_heads
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_heads_update_purge_guard
    BEFORE UPDATE ON oh_semantic_heads
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_purges_no_update
    BEFORE UPDATE ON oh_semantic_purges
    BEGIN SELECT RAISE(ABORT, 'Oh semantic purge markers are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_purges_no_delete
    BEFORE DELETE ON oh_semantic_purges
    BEGIN SELECT RAISE(ABORT, 'Oh semantic purge markers are immutable'); END`,
]);
export const SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS oh_semantic_isolations (
    isolation_sha256 TEXT PRIMARY KEY,
    authority_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_vectors (
    isolation_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    input_sha256 TEXT NOT NULL,
    vector_sha256 TEXT NOT NULL,
    vector BLOB NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(isolation_sha256, profile_sha256, renderer_sha256, input_sha256)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_generations (
    authority_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    authority_sha256 TEXT NOT NULL,
    isolation_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    membership_sha256 TEXT NOT NULL,
    generation_sha256 TEXT NOT NULL UNIQUE,
    document_count INTEGER NOT NULL CHECK(document_count >= 0),
    chunk_count INTEGER NOT NULL CHECK(chunk_count >= 0),
    created_at TEXT NOT NULL,
    PRIMARY KEY(authority_id, generation)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_memberships (
    authority_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    generation_sha256 TEXT NOT NULL,
    isolation_sha256 TEXT NOT NULL,
    record_key TEXT NOT NULL,
    record_sha256 TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    input_sha256 TEXT NOT NULL,
    PRIMARY KEY(authority_id, generation, record_key, ordinal)
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_heads (
    authority_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL CHECK(generation >= 0),
    authority_sha256 TEXT NOT NULL,
    isolation_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    renderer_sha256 TEXT NOT NULL,
    membership_sha256 TEXT NOT NULL,
    generation_sha256 TEXT NOT NULL,
    published_at TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS oh_semantic_purges (
    authority_id TEXT PRIMARY KEY,
    isolation_sha256 TEXT NOT NULL,
    profile_sha256 TEXT NOT NULL,
    published_generation INTEGER CHECK(published_generation IS NULL OR published_generation >= 0),
    published_generation_sha256 TEXT,
    purged_at TEXT NOT NULL,
    purge_marker_sha256 TEXT NOT NULL,
    generation_count INTEGER NOT NULL CHECK(generation_count >= 0),
    membership_count INTEGER NOT NULL CHECK(membership_count >= 0),
    orphan_vector_count INTEGER NOT NULL CHECK(orphan_vector_count >= 0),
    isolation_scope_count INTEGER NOT NULL CHECK(isolation_scope_count >= 0),
    counts_recorded INTEGER NOT NULL CHECK(counts_recorded IN (0, 1))
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS oh_semantic_isolations_authority
    ON oh_semantic_isolations(authority_id, isolation_sha256)`,
  `CREATE INDEX IF NOT EXISTS oh_semantic_memberships_generation
    ON oh_semantic_memberships(authority_id, generation, record_key, ordinal)`,
  `CREATE INDEX IF NOT EXISTS oh_semantic_memberships_input
    ON oh_semantic_memberships(isolation_sha256, input_sha256)`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_isolations_no_update
    BEFORE UPDATE ON oh_semantic_isolations
    BEGIN SELECT RAISE(ABORT, 'Oh semantic isolations are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_isolations_no_delete
    BEFORE DELETE ON oh_semantic_isolations
    BEGIN SELECT RAISE(ABORT, 'Oh semantic isolations are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_isolations_purge_guard
    BEFORE INSERT ON oh_semantic_isolations
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority was purged'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_vectors_no_update
    BEFORE UPDATE ON oh_semantic_vectors
    BEGIN SELECT RAISE(ABORT, 'Oh semantic vectors are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_vectors_isolation_guard
    BEFORE INSERT ON oh_semantic_vectors
    WHEN NOT EXISTS (SELECT 1 FROM oh_semantic_isolations
      WHERE isolation_sha256 = NEW.isolation_sha256)
      OR EXISTS (SELECT 1 FROM oh_semantic_purges AS purge
        JOIN oh_semantic_isolations AS isolation
          ON isolation.authority_id = purge.authority_id
        WHERE isolation.isolation_sha256 = NEW.isolation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic vector isolation is unavailable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_generations_no_update
    BEFORE UPDATE ON oh_semantic_generations
    BEGIN SELECT RAISE(ABORT, 'Oh semantic generations are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_no_update
    BEFORE UPDATE ON oh_semantic_memberships
    BEGIN SELECT RAISE(ABORT, 'Oh semantic memberships are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_generations_purge_guard
    BEFORE INSERT ON oh_semantic_generations
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
      OR NOT EXISTS (SELECT 1 FROM oh_semantic_isolations
        WHERE isolation_sha256 = NEW.isolation_sha256 AND authority_id = NEW.authority_id)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority or isolation is unavailable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_purge_guard
    BEFORE INSERT ON oh_semantic_memberships
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
      OR NOT EXISTS (SELECT 1 FROM oh_semantic_generations
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND isolation_sha256 = NEW.isolation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority or isolation is unavailable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_memberships_published_guard
    BEFORE INSERT ON oh_semantic_memberships
    WHEN EXISTS (SELECT 1 FROM oh_semantic_heads
      WHERE authority_id = NEW.authority_id AND generation = NEW.generation)
      AND NOT EXISTS (SELECT 1 FROM oh_semantic_memberships
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND isolation_sha256 = NEW.isolation_sha256
          AND record_key = NEW.record_key AND record_sha256 = NEW.record_sha256
          AND ordinal = NEW.ordinal AND input_sha256 = NEW.input_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic generation is published'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_heads_insert_purge_guard
    BEFORE INSERT ON oh_semantic_heads
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
      OR NOT EXISTS (SELECT 1 FROM oh_semantic_generations
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND isolation_sha256 = NEW.isolation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority or isolation is unavailable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_heads_update_purge_guard
    BEFORE UPDATE ON oh_semantic_heads
    WHEN EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = NEW.authority_id)
      OR NOT EXISTS (SELECT 1 FROM oh_semantic_generations
        WHERE authority_id = NEW.authority_id AND generation = NEW.generation
          AND generation_sha256 = NEW.generation_sha256
          AND isolation_sha256 = NEW.isolation_sha256)
    BEGIN SELECT RAISE(ABORT, 'Oh semantic authority or isolation is unavailable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_purges_no_update
    BEFORE UPDATE ON oh_semantic_purges
    BEGIN SELECT RAISE(ABORT, 'Oh semantic purge markers are immutable'); END`,
  `CREATE TRIGGER IF NOT EXISTS oh_semantic_purges_no_delete
    BEFORE DELETE ON oh_semantic_purges
    BEGIN SELECT RAISE(ABORT, 'Oh semantic purge markers are immutable'); END`,
]);
export function normalizedSchemaSql(sql: string): string {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\b/giu, "").replace(/\s+/gu, " ").trim();
}
export type SchemaObject = Readonly<{
  name: string;
  sql: string;
  tableName: string;
  type: "index" | "table" | "trigger";
}>;
export function expectedSchemaObject(statement: string): SchemaObject {
  const match = /^CREATE\s+(TABLE|INDEX|TRIGGER)(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z0-9_]+)/iu
    .exec(statement.trim());
  if (match === null)
    throw new Error("Invalid compiled semantic schema statement.");
  const declared = match[1]?.toLowerCase();
  const type = declared === "index" ? "index" as const
    : declared === "trigger" ? "trigger" as const : "table" as const;
  const name = match[2] as string;
  const owner = type === "table" ? name : /\bON\s+([a-z0-9_]+)/iu.exec(statement)?.[1];
  if (owner === undefined)
    throw new Error("Invalid compiled semantic schema owner.");
  return { name, sql: normalizedSchemaSql(statement), tableName: owner, type };
}
export const EXPECTED_SCHEMA_OBJECTS = Object.freeze([SCHEMA_TABLE, ...SCHEMA_STATEMENTS]
  .map(expectedSchemaObject)
  .sort((left, right) => canonicalJson([left.type, left.name])
    .localeCompare(canonicalJson([right.type, right.name]))));
export const SCHEMA_SHA256 = canonicalSha256(EXPECTED_SCHEMA_OBJECTS);
export const EXPECTED_SCHEMA_OBJECTS_V1 = Object.freeze([SCHEMA_TABLE, ...SCHEMA_STATEMENTS_V1]
  .map(expectedSchemaObject)
  .sort((left, right) => canonicalJson([left.type, left.name])
    .localeCompare(canonicalJson([right.type, right.name]))));
export const SCHEMA_SHA256_V1 = canonicalSha256(EXPECTED_SCHEMA_OBJECTS_V1);
export const EXPECTED_TRANSITION_SCHEMA_OBJECTS = Object.freeze([...EXPECTED_SCHEMA_OBJECTS, expectedSchemaObject(TRANSITION_TABLE)]
  .sort((left, right) => canonicalJson([left.type, left.name])
    .localeCompare(canonicalJson([right.type, right.name]))));
export function rowValue(row: Readonly<Record<string, unknown>> | readonly unknown[], key: string, index: number): unknown {
  return Array.isArray(row) ? row[index] : (row as Readonly<Record<string, unknown>>)[key];
}
export function integer(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : null;
  }
  return null;
}
export function rowsAffected(result: OhLibSqlResultV1): number {
  return typeof result.rowsAffected === "number" && Number.isSafeInteger(result.rowsAffected)
    && result.rowsAffected >= 0 ? result.rowsAffected : 0;
}
export function parseAuthorityId(value: unknown): string {
  const parsed = safeCode(value, 256);
  if (parsed === null)
    throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic authority ID.");
  return parsed;
}
export function deriveOhSemanticIsolationSha256V2(authorityId: string): Sha256Hex {
  return canonicalSha256({
    authorityId: parseAuthorityId(authorityId),
    kind: DEFAULT_ISOLATION_KIND,
    v: 2,
  });
}
export function isolationSha256(authorityId: string, value: unknown): Sha256Hex {
  return value === undefined
    ? deriveOhSemanticIsolationSha256V2(authorityId)
    : parseDigest(value, "semantic isolation");
}
export function purgeMarkerSha256(authorityId: string, isolation: Sha256Hex, purgedAt: string): Sha256Hex {
  return canonicalSha256({
    authorityId,
    isolationSha256: isolation,
    kind: PURGE_MARKER_KIND,
    purgedAt,
    v: 2,
  });
}
export function parseRecordKey(value: unknown): string {
  const parsed = safeCode(value, 512);
  if (parsed === null)
    throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic record key.");
  return parsed;
}
export function parseGeneration(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic authority generation.");
  }
  return value as number;
}
export function parseDigest(value: unknown, label: string): Sha256Hex {
  const digest = parseSha256Hex(value);
  if (digest === null)
    throw new OhLibSqlSemanticV2Error("invalid-input", `Invalid ${label} digest.`);
  return digest;
}
export function parseInstant(value: unknown): string {
  const instant = parseCanonicalInstantV1(value);
  if (instant === null)
    throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic instant.");
  return instant;
}
export type LegacyPurge = Readonly<{
  authorityId: string;
  purgedAt: string;
}>;
export function vectorBytes(vector: readonly number[]): Uint8Array {
  const normalized = normalizeOhEmbeddingV1(vector);
  const bytes = new Uint8Array(VECTOR_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const [index, component] of normalized.entries())
    view.setFloat32(index * 4, component, true);
  return bytes;
}
export function storedBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array)
    return new Uint8Array(value);
  if (value instanceof ArrayBuffer)
    return new Uint8Array(value.slice(0));
  return null;
}
export function decodeVector(value: unknown, expectedSha256: unknown): readonly number[] {
  const bytes = storedBytes(value);
  const digest = parseSha256Hex(expectedSha256);
  if (bytes === null || bytes.byteLength !== VECTOR_BYTES || digest === null
    || sha256Hex(bytes) !== digest) {
    throw new OhLibSqlSemanticV2Error("integrity", "A cached semantic vector is corrupt.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = Array.from({ length: OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions }, (_, index) => view.getFloat32(index * 4, true));
  try {
    return Object.freeze([...normalizeOhEmbeddingV1(vector)]);
  }
  catch {
    throw new OhLibSqlSemanticV2Error("integrity", "A cached semantic vector is invalid.");
  }
}
export type Membership = Readonly<{
  input: OhRenderedEmbeddingInputV1;
  inputSha256: Sha256Hex;
  ordinal: number;
  recordKey: string;
  recordSha256: Sha256Hex;
}>;
export type Generation = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  chunkCount: number;
  createdAt: string;
  documentCount: number;
  generation: number;
  generationSha256: Sha256Hex;
  isolationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  memberships: readonly Membership[];
}>;
export type StoredGeneration = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  chunkCount: number;
  createdAt: string;
  documentCount: number;
  generation: number;
  generationSha256: Sha256Hex;
  isolationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  profileSha256: Sha256Hex;
  rendererSha256: Sha256Hex;
}>;
export type StoredHead = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  generation: number;
  generationSha256: Sha256Hex;
  isolationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  profileSha256: Sha256Hex;
  publishedAt: string;
  rendererSha256: Sha256Hex;
}>;
export function parseStoredGeneration(row: Readonly<Record<string, unknown>> | readonly unknown[]): StoredGeneration {
  const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
  const generation = integer(rowValue(row, "generation", 1));
  const authoritySha256 = parseSha256Hex(rowValue(row, "authority_sha256", 2));
  const isolation = parseSha256Hex(rowValue(row, "isolation_sha256", 3));
  const profileSha256 = parseSha256Hex(rowValue(row, "profile_sha256", 4));
  const rendererSha256 = parseSha256Hex(rowValue(row, "renderer_sha256", 5));
  const membershipSha256 = parseSha256Hex(rowValue(row, "membership_sha256", 6));
  const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 7));
  const documentCount = integer(rowValue(row, "document_count", 8));
  const chunkCount = integer(rowValue(row, "chunk_count", 9));
  const createdAtValue = rowValue(row, "created_at", 10);
  const createdAt = parseCanonicalInstantV1(createdAtValue);
  if (authorityId === null || generation === null || generation < 0
    || authoritySha256 === null || isolation === null
    || profileSha256 === null || rendererSha256 === null
    || membershipSha256 === null || generationSha256 === null
    || documentCount === null || documentCount < 1
    || documentCount > OH_LIBSQL_SEMANTIC_LIMITS_V2.documentsPerGeneration
    || chunkCount === null || chunkCount < 1
    || chunkCount > OH_LIBSQL_SEMANTIC_LIMITS_V2.chunksPerGeneration
    || createdAt === null) {
    throw new OhLibSqlSemanticV2Error("integrity", "A stored semantic generation is invalid.");
  }
  return Object.freeze({
    authorityId,
    authoritySha256,
    chunkCount,
    createdAt,
    documentCount,
    generation,
    generationSha256,
    isolationSha256: isolation,
    membershipSha256,
    profileSha256,
    rendererSha256,
  });
}
export function generationMatches(left: StoredGeneration, right: Generation): boolean {
  return left.authorityId === right.authorityId
    && left.authoritySha256 === right.authoritySha256
    && left.chunkCount === right.chunkCount
    && left.documentCount === right.documentCount
    && left.generation === right.generation
    && left.generationSha256 === right.generationSha256
    && left.isolationSha256 === right.isolationSha256
    && left.membershipSha256 === right.membershipSha256
    && left.profileSha256 === OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256
    && left.rendererSha256 === OH_SEMANTIC_RENDERER_V1.rendererSha256;
}
export function parseStoredHead(row: Readonly<Record<string, unknown>> | readonly unknown[]): StoredHead {
  const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
  const generation = integer(rowValue(row, "generation", 1));
  const authoritySha256 = parseSha256Hex(rowValue(row, "authority_sha256", 2));
  const isolation = parseSha256Hex(rowValue(row, "isolation_sha256", 3));
  const profileSha256 = parseSha256Hex(rowValue(row, "profile_sha256", 4));
  const rendererSha256 = parseSha256Hex(rowValue(row, "renderer_sha256", 5));
  const membershipSha256 = parseSha256Hex(rowValue(row, "membership_sha256", 6));
  const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 7));
  const publishedAtValue = rowValue(row, "published_at", 8);
  const publishedAt = parseCanonicalInstantV1(publishedAtValue);
  if (authorityId === null || generation === null || generation < 0
    || authoritySha256 === null || isolation === null
    || profileSha256 === null || rendererSha256 === null
    || membershipSha256 === null || generationSha256 === null || publishedAt === null) {
    throw new OhLibSqlSemanticV2Error("integrity", "A stored semantic head is invalid.");
  }
  return Object.freeze({
    authorityId,
    authoritySha256,
    generation,
    generationSha256,
    isolationSha256: isolation,
    membershipSha256,
    profileSha256,
    publishedAt,
    rendererSha256,
  });
}
export function headMatchesGeneration(head: StoredHead, generation: StoredGeneration): boolean {
  return head.authorityId === generation.authorityId
    && head.authoritySha256 === generation.authoritySha256
    && head.generation === generation.generation
    && head.generationSha256 === generation.generationSha256
    && head.isolationSha256 === generation.isolationSha256
    && head.membershipSha256 === generation.membershipSha256
    && head.profileSha256 === generation.profileSha256
    && head.rendererSha256 === generation.rendererSha256;
}
export const GENERATION_SELECT = `SELECT authority_id, generation, authority_sha256,
  isolation_sha256, profile_sha256, renderer_sha256, membership_sha256, generation_sha256,
  document_count, chunk_count, created_at
  FROM oh_semantic_generations WHERE authority_id = ? AND generation = ?`;
export const HEAD_SELECT = `SELECT authority_id, generation, authority_sha256,
  isolation_sha256, profile_sha256, renderer_sha256, membership_sha256,
  generation_sha256, published_at
  FROM oh_semantic_heads WHERE authority_id = ?`;
export type StoredPurge = Readonly<Omit<OhSemanticPurgeResultV2, "purgeReceiptSha256">>;
export function purgeResult(stored: StoredPurge): OhSemanticPurgeResultV2 {
  return Object.freeze({
    ...stored,
    purgeReceiptSha256: canonicalSha256({
      kind: PURGE_RECEIPT_KIND,
      receipt: stored,
      v: 2,
    }),
  });
}
export type StoredVector = Readonly<{
  bytes: Uint8Array;
  inputSha256: Sha256Hex;
  vectorSha256: Sha256Hex;
}>;
export function validateEmbeddingClient(client: OhCloudflareEmbeddingClientV1): void {
  if (client.profile.profileSha256 !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256) {
    throw new OhLibSqlSemanticV2Error("invalid-input", "The embedding client profile is incompatible.");
  }
}
