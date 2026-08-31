import {
  canonicalJson,
  canonicalNow,
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
  renderOhCloudflareEmbeddingDocumentV1,
  renderOhCloudflareEmbeddingQueryV1,
  type OhCloudflareEmbeddingClientV1,
  type OhRenderedEmbeddingInputV1,
} from "./cloudflare-embedding";
import type {
  OhLibSqlClientV1,
  OhLibSqlResultV1,
  OhLibSqlStatementV1,
} from "./libsql";
import { normalizeOhEmbeddingV1 } from "./semantic";

export const OH_LIBSQL_SEMANTIC_LIMITS_V1 = Object.freeze({
  chunksPerDocument: 64,
  chunksPerGeneration: 4_096,
  documentsPerGeneration: 512,
  embeddingBatch: 16,
  searchLimit: 100,
  searchPage: 128,
});

export class OhLibSqlSemanticError extends Error {
  readonly code: "conflict" | "integrity" | "invalid-input" | "purged" | "schema-unavailable";

  constructor(code: OhLibSqlSemanticError["code"], message: string) {
    super(message);
    this.name = "OhLibSqlSemanticError";
    this.code = code;
  }
}

export type OhSemanticAuthorityRefV1 = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  generation: number;
  records: readonly Readonly<{ key: string; recordSha256: Sha256Hex }>[];
  v: 1;
}>;

export type OhSemanticDocumentV1 = Readonly<{
  content: string;
  key: string;
  recordSha256: Sha256Hex;
  title: string;
  v: 1;
}>;

export type OhSemanticStageResultV1 = Readonly<{
  authorityId: string;
  chunks: number;
  documents: number;
  embedded: number;
  generation: number;
  generationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  reused: number;
  status: "staged";
  v: 1;
}>;

export type OhSemanticPublishResultV1 = Readonly<{
  authorityId: string;
  generation: number;
  generationSha256: Sha256Hex;
  published: boolean;
  v: 1;
}>;

/** The exact, currently published cache pointer for one semantic authority. */
export type OhSemanticPublishedHeadV1 = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  generation: number;
  generationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  profileSha256: Sha256Hex;
  publishedAt: string;
  rendererSha256: Sha256Hex;
  v: 1;
}>;

export type OhSemanticSearchResultV1 = Readonly<{
  chunkOrdinal: number;
  key: string;
  recordSha256: Sha256Hex;
  score: number;
  v: 1;
}>;

export type OhSemanticPurgeResultV1 = Readonly<{
  authorityId: string;
  generations: number;
  memberships: number;
  orphanVectors: number;
  purgedAt: string;
  v: 1;
}>;

const SCHEMA_NAME = "oh.libsql-semantic-cache.v1";
const SCHEMA_VERSION = 1;
const VECTOR_BYTES = OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions * 4;

const SCHEMA_TABLE = `CREATE TABLE IF NOT EXISTS oh_semantic_schemas (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;

const SCHEMA_STATEMENTS = Object.freeze([
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

function normalizedSchemaSql(sql: string): string {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\b/giu, "").replace(/\s+/gu, " ").trim();
}

type SchemaObject = Readonly<{
  name: string;
  sql: string;
  tableName: string;
  type: "index" | "table" | "trigger";
}>;

function expectedSchemaObject(statement: string): SchemaObject {
  const match = /^CREATE\s+(TABLE|INDEX|TRIGGER)(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z0-9_]+)/iu
    .exec(statement.trim());
  if (match === null) throw new Error("Invalid compiled semantic schema statement.");
  const declared = match[1]?.toLowerCase();
  const type = declared === "index" ? "index" as const
    : declared === "trigger" ? "trigger" as const : "table" as const;
  const name = match[2] as string;
  const owner = type === "table" ? name : /\bON\s+([a-z0-9_]+)/iu.exec(statement)?.[1];
  if (owner === undefined) throw new Error("Invalid compiled semantic schema owner.");
  return { name, sql: normalizedSchemaSql(statement), tableName: owner, type };
}

const EXPECTED_SCHEMA_OBJECTS = Object.freeze(
  [SCHEMA_TABLE, ...SCHEMA_STATEMENTS]
    .map(expectedSchemaObject)
    .sort((left, right) => canonicalJson([left.type, left.name])
      .localeCompare(canonicalJson([right.type, right.name]))),
);
const SCHEMA_SHA256 = canonicalSha256(EXPECTED_SCHEMA_OBJECTS);

function rowValue(
  row: Readonly<Record<string, unknown>> | readonly unknown[],
  key: string,
  index: number,
): unknown {
  return Array.isArray(row) ? row[index] : (row as Readonly<Record<string, unknown>>)[key];
}

function integer(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : null;
  }
  return null;
}

function rowsAffected(result: OhLibSqlResultV1): number {
  return typeof result.rowsAffected === "number" && Number.isSafeInteger(result.rowsAffected)
    && result.rowsAffected >= 0 ? result.rowsAffected : 0;
}

function parseAuthorityId(value: unknown): string {
  const parsed = safeCode(value, 256);
  if (parsed === null) throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic authority ID.");
  return parsed;
}

function parseRecordKey(value: unknown): string {
  const parsed = safeCode(value, 512);
  if (parsed === null) throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic record key.");
  return parsed;
}

function parseGeneration(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic authority generation.");
  }
  return value as number;
}

function parseDigest(value: unknown, label: string): Sha256Hex {
  const digest = parseSha256Hex(value);
  if (digest === null) throw new OhLibSqlSemanticError("invalid-input", `Invalid ${label} digest.`);
  return digest;
}

function parseInstant(value: unknown): string {
  const instant = parseCanonicalInstantV1(value);
  if (instant === null) throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic instant.");
  return instant;
}

async function schemaObjects(client: OhLibSqlClientV1): Promise<readonly SchemaObject[]> {
  const result = await client.execute(`SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL AND (name GLOB 'oh_semantic_*' OR tbl_name GLOB 'oh_semantic_*')
    ORDER BY type, name`);
  return result.rows.map((row) => {
    const type = rowValue(row, "type", 0);
    const name = rowValue(row, "name", 1);
    const tableName = rowValue(row, "tbl_name", 2);
    const sql = rowValue(row, "sql", 3);
    if ((type !== "index" && type !== "table" && type !== "trigger")
      || typeof name !== "string" || typeof tableName !== "string" || typeof sql !== "string") {
      throw new OhLibSqlSemanticError("integrity", "The semantic schema inventory is malformed.");
    }
    const schemaType: SchemaObject["type"] = type;
    return { name, sql: normalizedSchemaSql(sql), tableName, type: schemaType };
  }).sort((left, right) => canonicalJson([left.type, left.name])
    .localeCompare(canonicalJson([right.type, right.name])));
}

async function verifySchema(client: OhLibSqlClientV1): Promise<void> {
  let marker: OhLibSqlResultV1;
  try {
    marker = await client.execute({
      args: [SCHEMA_VERSION],
      sql: "SELECT name, schema_sha256 FROM oh_semantic_schemas WHERE version = ?",
    });
  } catch {
    throw new OhLibSqlSemanticError("schema-unavailable", "The semantic cache schema is unavailable.");
  }
  const row = marker.rows[0];
  if (marker.rows.length !== 1 || row === undefined
    || rowValue(row, "name", 0) !== SCHEMA_NAME
    || rowValue(row, "schema_sha256", 1) !== SCHEMA_SHA256) {
    throw new OhLibSqlSemanticError("schema-unavailable", "The semantic cache schema marker is invalid.");
  }
  if (canonicalJson(await schemaObjects(client)) !== canonicalJson(EXPECTED_SCHEMA_OBJECTS)) {
    throw new OhLibSqlSemanticError("integrity", "The semantic cache schema has drifted.");
  }
}

export async function bootstrapOhLibSqlSemanticCacheV1(
  client: OhLibSqlClientV1,
  options: Readonly<{ appliedAt?: string }> = {},
): Promise<Readonly<{ schemaSha256: Sha256Hex; schemaVersion: 1; v: 1 }>> {
  const appliedAt = parseInstant(options.appliedAt ?? canonicalNow());
  const existing = await schemaObjects(client);
  if (existing.length === 0) {
    await client.batch([
      { sql: SCHEMA_TABLE },
      ...SCHEMA_STATEMENTS.map((sql) => ({ sql })),
      {
        args: [SCHEMA_VERSION, SCHEMA_NAME, SCHEMA_SHA256, appliedAt],
        sql: `INSERT INTO oh_semantic_schemas(version, name, schema_sha256, applied_at)
          VALUES (?, ?, ?, ?) ON CONFLICT(version) DO NOTHING`,
      },
    ], "write");
  } else if (canonicalJson(existing) !== canonicalJson(EXPECTED_SCHEMA_OBJECTS)) {
    throw new OhLibSqlSemanticError("integrity", "Refusing to bless a partial or drifted semantic schema.");
  }
  await verifySchema(client);
  return Object.freeze({ schemaSha256: SCHEMA_SHA256, schemaVersion: 1, v: 1 });
}

function vectorBytes(vector: readonly number[]): Uint8Array {
  const normalized = normalizeOhEmbeddingV1(vector);
  const bytes = new Uint8Array(VECTOR_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const [index, component] of normalized.entries()) view.setFloat32(index * 4, component, true);
  return bytes;
}

function storedBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return null;
}

function decodeVector(value: unknown, expectedSha256: unknown): readonly number[] {
  const bytes = storedBytes(value);
  const digest = parseSha256Hex(expectedSha256);
  if (bytes === null || bytes.byteLength !== VECTOR_BYTES || digest === null
    || sha256Hex(bytes) !== digest) {
    throw new OhLibSqlSemanticError("integrity", "A cached semantic vector is corrupt.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = Array.from({ length: OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions },
    (_, index) => view.getFloat32(index * 4, true));
  try { return Object.freeze([...normalizeOhEmbeddingV1(vector)]); }
  catch { throw new OhLibSqlSemanticError("integrity", "A cached semantic vector is invalid."); }
}

type Membership = Readonly<{
  input: OhRenderedEmbeddingInputV1;
  inputSha256: Sha256Hex;
  ordinal: number;
  recordKey: string;
  recordSha256: Sha256Hex;
}>;

type Generation = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  chunkCount: number;
  createdAt: string;
  documentCount: number;
  generation: number;
  generationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  memberships: readonly Membership[];
}>;

function prepareGeneration(input: Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  createdAt?: string;
  documents: readonly OhSemanticDocumentV1[];
  generation: number;
  maximumChunksPerDocument?: number;
}>): Generation {
  const authorityId = parseAuthorityId(input.authorityId);
  const authoritySha256 = parseDigest(input.authoritySha256, "authority");
  const generation = parseGeneration(input.generation);
  const createdAt = parseInstant(input.createdAt ?? canonicalNow());
  const maximumChunks = input.maximumChunksPerDocument
    ?? OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerDocument;
  if (!Number.isSafeInteger(maximumChunks) || maximumChunks < 1
    || maximumChunks > OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerDocument
    || !Array.isArray(input.documents) || input.documents.length < 1
    || input.documents.length > OH_LIBSQL_SEMANTIC_LIMITS_V1.documentsPerGeneration) {
    throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic generation bounds.");
  }
  const documents = input.documents.map((document) => {
    if (document.v !== 1) throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic document version.");
    return {
      ...document,
      key: parseRecordKey(document.key),
      recordSha256: parseDigest(document.recordSha256, "record"),
    };
  }).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  if (new Set(documents.map(({ key }) => key)).size !== documents.length) {
    throw new OhLibSqlSemanticError("invalid-input", "Semantic document keys must be unique.");
  }
  const memberships: Membership[] = [];
  for (const document of documents) {
    const rendered = renderOhCloudflareEmbeddingDocumentV1({
      content: document.content,
      maximumChunks,
      title: document.title,
    });
    if (rendered.status !== "complete") {
      throw new OhLibSqlSemanticError("invalid-input", "A semantic document exceeds the complete renderer bound.");
    }
    for (const chunk of rendered.chunks) {
      memberships.push(Object.freeze({
        input: chunk.input,
        inputSha256: chunk.input.inputSha256,
        ordinal: chunk.ordinal,
        recordKey: document.key,
        recordSha256: document.recordSha256,
      }));
    }
  }
  if (memberships.length < 1
    || memberships.length > OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerGeneration) {
    throw new OhLibSqlSemanticError("invalid-input", "The semantic generation exceeds its chunk bound.");
  }
  const membershipSha256 = canonicalSha256(memberships.map((membership) => ({
    inputSha256: membership.inputSha256,
    ordinal: membership.ordinal,
    recordKey: membership.recordKey,
    recordSha256: membership.recordSha256,
  })));
  const generationSha256 = canonicalSha256({
    authorityId,
    authoritySha256,
    chunkCount: memberships.length,
    documentCount: documents.length,
    generation,
    membershipSha256,
    profileSha256: OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
    rendererSha256: OH_SEMANTIC_RENDERER_V1.rendererSha256,
    v: 1,
  });
  return Object.freeze({
    authorityId,
    authoritySha256,
    chunkCount: memberships.length,
    createdAt,
    documentCount: documents.length,
    generation,
    generationSha256,
    membershipSha256,
    memberships: Object.freeze(memberships),
  });
}

type StoredGeneration = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  chunkCount: number;
  createdAt: string;
  documentCount: number;
  generation: number;
  generationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  profileSha256: Sha256Hex;
  rendererSha256: Sha256Hex;
}>;

type StoredHead = Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  generation: number;
  generationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  profileSha256: Sha256Hex;
  publishedAt: string;
  rendererSha256: Sha256Hex;
}>;

function parseStoredGeneration(
  row: Readonly<Record<string, unknown>> | readonly unknown[],
): StoredGeneration {
  const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
  const generation = integer(rowValue(row, "generation", 1));
  const authoritySha256 = parseSha256Hex(rowValue(row, "authority_sha256", 2));
  const profileSha256 = parseSha256Hex(rowValue(row, "profile_sha256", 3));
  const rendererSha256 = parseSha256Hex(rowValue(row, "renderer_sha256", 4));
  const membershipSha256 = parseSha256Hex(rowValue(row, "membership_sha256", 5));
  const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 6));
  const documentCount = integer(rowValue(row, "document_count", 7));
  const chunkCount = integer(rowValue(row, "chunk_count", 8));
  const createdAtValue = rowValue(row, "created_at", 9);
  const createdAt = parseCanonicalInstantV1(createdAtValue);
  if (authorityId === null || generation === null || generation < 0
    || authoritySha256 === null || profileSha256 === null || rendererSha256 === null
    || membershipSha256 === null || generationSha256 === null
    || documentCount === null || documentCount < 1
    || documentCount > OH_LIBSQL_SEMANTIC_LIMITS_V1.documentsPerGeneration
    || chunkCount === null || chunkCount < 1
    || chunkCount > OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerGeneration
    || createdAt === null) {
    throw new OhLibSqlSemanticError("integrity", "A stored semantic generation is invalid.");
  }
  return Object.freeze({
    authorityId,
    authoritySha256,
    chunkCount,
    createdAt,
    documentCount,
    generation,
    generationSha256,
    membershipSha256,
    profileSha256,
    rendererSha256,
  });
}

function generationMatches(left: StoredGeneration, right: Generation): boolean {
  return left.authorityId === right.authorityId
    && left.authoritySha256 === right.authoritySha256
    && left.chunkCount === right.chunkCount
    && left.documentCount === right.documentCount
    && left.generation === right.generation
    && left.generationSha256 === right.generationSha256
    && left.membershipSha256 === right.membershipSha256
    && left.profileSha256 === OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256
    && left.rendererSha256 === OH_SEMANTIC_RENDERER_V1.rendererSha256;
}

function parseStoredHead(row: Readonly<Record<string, unknown>> | readonly unknown[]): StoredHead {
  const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
  const generation = integer(rowValue(row, "generation", 1));
  const authoritySha256 = parseSha256Hex(rowValue(row, "authority_sha256", 2));
  const profileSha256 = parseSha256Hex(rowValue(row, "profile_sha256", 3));
  const rendererSha256 = parseSha256Hex(rowValue(row, "renderer_sha256", 4));
  const membershipSha256 = parseSha256Hex(rowValue(row, "membership_sha256", 5));
  const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 6));
  const publishedAtValue = rowValue(row, "published_at", 7);
  const publishedAt = parseCanonicalInstantV1(publishedAtValue);
  if (authorityId === null || generation === null || generation < 0
    || authoritySha256 === null || profileSha256 === null || rendererSha256 === null
    || membershipSha256 === null || generationSha256 === null || publishedAt === null) {
    throw new OhLibSqlSemanticError("integrity", "A stored semantic head is invalid.");
  }
  return Object.freeze({
    authorityId,
    authoritySha256,
    generation,
    generationSha256,
    membershipSha256,
    profileSha256,
    publishedAt,
    rendererSha256,
  });
}

function headMatchesGeneration(head: StoredHead, generation: StoredGeneration): boolean {
  return head.authorityId === generation.authorityId
    && head.authoritySha256 === generation.authoritySha256
    && head.generation === generation.generation
    && head.generationSha256 === generation.generationSha256
    && head.membershipSha256 === generation.membershipSha256
    && head.profileSha256 === generation.profileSha256
    && head.rendererSha256 === generation.rendererSha256;
}

const GENERATION_SELECT = `SELECT authority_id, generation, authority_sha256,
  profile_sha256, renderer_sha256, membership_sha256, generation_sha256,
  document_count, chunk_count, created_at
  FROM oh_semantic_generations WHERE authority_id = ? AND generation = ?`;
const HEAD_SELECT = `SELECT authority_id, generation, authority_sha256,
  profile_sha256, renderer_sha256, membership_sha256, generation_sha256, published_at
  FROM oh_semantic_heads WHERE authority_id = ?`;

async function readGeneration(
  client: OhLibSqlClientV1,
  authorityId: string,
  generation: number,
): Promise<StoredGeneration | null> {
  const result = await client.execute({ args: [authorityId, generation], sql: GENERATION_SELECT });
  if (result.rows.length > 1) throw new OhLibSqlSemanticError("integrity", "Duplicate semantic generations.");
  const row = result.rows[0];
  return row === undefined ? null : parseStoredGeneration(row);
}

async function readHead(client: OhLibSqlClientV1, authorityId: string): Promise<StoredHead | null> {
  const result = await client.execute({ args: [authorityId], sql: HEAD_SELECT });
  if (result.rows.length > 1) throw new OhLibSqlSemanticError("integrity", "Duplicate semantic heads.");
  const row = result.rows[0];
  return row === undefined ? null : parseStoredHead(row);
}

async function readPurge(client: OhLibSqlClientV1, authorityId: string): Promise<string | null> {
  const result = await client.execute({
    args: [authorityId],
    sql: "SELECT purged_at FROM oh_semantic_purges WHERE authority_id = ?",
  });
  if (result.rows.length > 1) throw new OhLibSqlSemanticError("integrity", "Duplicate semantic purge markers.");
  const row = result.rows[0];
  if (row === undefined) return null;
  const purgedAt = parseCanonicalInstantV1(rowValue(row, "purged_at", 0));
  if (purgedAt === null) throw new OhLibSqlSemanticError("integrity", "The semantic purge marker is invalid.");
  return purgedAt;
}

async function readMemberships(
  client: OhLibSqlClientV1,
  generation: StoredGeneration,
): Promise<readonly Omit<Membership, "input">[]> {
  const memberships: Array<Omit<Membership, "input">> = [];
  for (let offset = 0; offset < generation.chunkCount; offset += OH_LIBSQL_SEMANTIC_LIMITS_V1.searchPage) {
    const result = await client.execute({
      args: [generation.authorityId, generation.generation,
        OH_LIBSQL_SEMANTIC_LIMITS_V1.searchPage, offset],
      sql: `SELECT generation_sha256, record_key, record_sha256, ordinal, input_sha256
        FROM oh_semantic_memberships
        WHERE authority_id = ? AND generation = ?
        ORDER BY record_key, ordinal LIMIT ? OFFSET ?`,
    });
    for (const row of result.rows) {
      const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 0));
      const recordKey = safeCode(rowValue(row, "record_key", 1), 512);
      const recordSha256 = parseSha256Hex(rowValue(row, "record_sha256", 2));
      const ordinal = integer(rowValue(row, "ordinal", 3));
      const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 4));
      if (generationSha256 !== generation.generationSha256 || recordKey === null
        || recordSha256 === null || ordinal === null || ordinal < 0
        || ordinal >= OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerDocument
        || inputSha256 === null) {
        throw new OhLibSqlSemanticError("integrity", "A semantic generation membership is invalid.");
      }
      memberships.push(Object.freeze({ inputSha256, ordinal, recordKey, recordSha256 }));
    }
  }
  if (memberships.length !== generation.chunkCount
    || canonicalSha256(memberships.map((membership) => ({
      inputSha256: membership.inputSha256,
      ordinal: membership.ordinal,
      recordKey: membership.recordKey,
      recordSha256: membership.recordSha256,
    }))) !== generation.membershipSha256) {
    throw new OhLibSqlSemanticError("integrity", "A semantic generation membership digest is invalid.");
  }
  return Object.freeze(memberships);
}

type StoredVector = Readonly<{
  bytes: Uint8Array;
  inputSha256: Sha256Hex;
  vectorSha256: Sha256Hex;
}>;

async function readVectors(
  client: OhLibSqlClientV1,
  inputSha256s: readonly Sha256Hex[],
): Promise<ReadonlyMap<Sha256Hex, StoredVector>> {
  const vectors = new Map<Sha256Hex, StoredVector>();
  for (let offset = 0; offset < inputSha256s.length; offset += 64) {
    const page = inputSha256s.slice(offset, offset + 64);
    if (page.length === 0) continue;
    const placeholders = page.map(() => "?").join(", ");
    const result = await client.execute({
      args: [OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
        OH_SEMANTIC_RENDERER_V1.rendererSha256, ...page],
      sql: `SELECT input_sha256, vector_sha256, vector FROM oh_semantic_vectors
        WHERE profile_sha256 = ? AND renderer_sha256 = ?
          AND input_sha256 IN (${placeholders}) ORDER BY input_sha256`,
    });
    for (const row of result.rows) {
      const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 0));
      const vectorSha256 = parseSha256Hex(rowValue(row, "vector_sha256", 1));
      if (inputSha256 === null || vectorSha256 === null || !page.includes(inputSha256)
        || vectors.has(inputSha256)) {
        throw new OhLibSqlSemanticError("integrity", "A cached semantic vector identity is invalid.");
      }
      const bytes = storedBytes(rowValue(row, "vector", 2));
      if (bytes === null) {
        throw new OhLibSqlSemanticError("integrity", "A cached semantic vector is corrupt.");
      }
      decodeVector(bytes, vectorSha256);
      vectors.set(inputSha256, Object.freeze({
        bytes,
        inputSha256,
        vectorSha256,
      }));
    }
  }
  return vectors;
}

function validateEmbeddingClient(client: OhCloudflareEmbeddingClientV1): void {
  if (client.profile.profileSha256 !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256) {
    throw new OhLibSqlSemanticError("invalid-input", "The embedding client profile is incompatible.");
  }
}

export class OhLibSqlSemanticCacheV1 {
  readonly #client: OhLibSqlClientV1;
  readonly #closeClient: boolean;
  #closed = false;

  private constructor(client: OhLibSqlClientV1, closeClient: boolean) {
    this.#client = client;
    this.#closeClient = closeClient;
  }

  /** @internal Public callers should use `openOhLibSqlSemanticCacheV1`. */
  static async open(client: OhLibSqlClientV1, closeClient: boolean): Promise<OhLibSqlSemanticCacheV1> {
    await verifySchema(client);
    return new OhLibSqlSemanticCacheV1(client, closeClient);
  }

  #open(): void {
    if (this.#closed) throw new OhLibSqlSemanticError("schema-unavailable", "The semantic cache is closed.");
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#closeClient) this.#client.close?.();
  }

  /**
   * Reads the current compare-and-swap base without exposing cache rows or
   * private source text. An absent or purged authority has no published head.
   */
  async publishedHead(input: Readonly<{
    authorityId: string;
  }>): Promise<OhSemanticPublishedHeadV1 | null> {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    if (await readPurge(this.#client, authorityId) !== null) return null;
    const head = await readHead(this.#client, authorityId);
    if (head === null) return null;
    const generation = await readGeneration(this.#client, authorityId, head.generation);
    if (generation === null || !headMatchesGeneration(head, generation)) {
      if (await readPurge(this.#client, authorityId) !== null) return null;
      throw new OhLibSqlSemanticError(
        "integrity",
        "The semantic published head does not match its immutable generation.",
      );
    }
    if (await readPurge(this.#client, authorityId) !== null) return null;
    const finalHead = await readHead(this.#client, authorityId);
    if (finalHead === null) {
      if (await readPurge(this.#client, authorityId) !== null) return null;
      throw new OhLibSqlSemanticError(
        "integrity",
        "The semantic published head disappeared during its read.",
      );
    }
    if (canonicalJson(finalHead) !== canonicalJson(head)) {
      throw new OhLibSqlSemanticError(
        "conflict",
        "The semantic published head changed during its read.",
      );
    }
    return Object.freeze({ ...head, v: 1 });
  }

  async stage(input: Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    createdAt?: string;
    documents: readonly OhSemanticDocumentV1[];
    embeddingClient: OhCloudflareEmbeddingClientV1;
    generation: number;
    maximumChunksPerDocument?: number;
    signal?: AbortSignal;
  }>): Promise<OhSemanticStageResultV1> {
    this.#open();
    validateEmbeddingClient(input.embeddingClient);
    const prepared = prepareGeneration(input);
    if (await readPurge(this.#client, prepared.authorityId) !== null) {
      throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
    }
    const uniqueInputs = new Map<Sha256Hex, OhRenderedEmbeddingInputV1>();
    for (const membership of prepared.memberships) uniqueInputs.set(membership.inputSha256, membership.input);
    const orderedInputs = [...uniqueInputs.entries()].sort(([left], [right]) => left < right ? -1 : 1);
    const existingVectors = await readVectors(this.#client, orderedInputs.map(([digest]) => digest));
    const missing = orderedInputs.filter(([digest]) => !existingVectors.has(digest));
    const candidateVectors = new Map(existingVectors);
    for (let offset = 0; offset < missing.length; offset += OH_LIBSQL_SEMANTIC_LIMITS_V1.embeddingBatch) {
      const page = missing.slice(offset, offset + OH_LIBSQL_SEMANTIC_LIMITS_V1.embeddingBatch);
      const vectors = await input.embeddingClient.embed(
        page.map(([, rendered]) => rendered),
        input.signal === undefined ? {} : { signal: input.signal },
      );
      if (vectors.length !== page.length) {
        throw new OhLibSqlSemanticError("integrity", "The embedding client returned a mismatched vector batch.");
      }
      for (const [index, [inputSha256]] of page.entries()) {
        const vector = vectors[index];
        if (vector === undefined) throw new OhLibSqlSemanticError("integrity", "A semantic vector is missing.");
        const bytes = vectorBytes(vector);
        const vectorSha256 = sha256Hex(bytes);
        decodeVector(bytes, vectorSha256);
        candidateVectors.set(inputSha256, Object.freeze({ bytes, inputSha256, vectorSha256 }));
      }
    }
    const statements: OhLibSqlStatementV1[] = [{
      args: [prepared.authorityId, prepared.generation, prepared.authoritySha256,
        OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
        OH_SEMANTIC_RENDERER_V1.rendererSha256, prepared.membershipSha256,
        prepared.generationSha256, prepared.documentCount, prepared.chunkCount,
        prepared.createdAt, prepared.authorityId],
      sql: `INSERT INTO oh_semantic_generations(authority_id, generation,
        authority_sha256, profile_sha256, renderer_sha256, membership_sha256,
        generation_sha256, document_count, chunk_count, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
        ON CONFLICT DO NOTHING`,
    }];
    for (const [inputSha256] of orderedInputs) {
      const candidate = candidateVectors.get(inputSha256);
      if (candidate === undefined) {
        throw new OhLibSqlSemanticError("integrity", "A semantic vector candidate is missing.");
      }
      statements.push({
        args: [OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
          OH_SEMANTIC_RENDERER_V1.rendererSha256, inputSha256, candidate.vectorSha256,
          candidate.bytes, prepared.createdAt, prepared.authorityId, prepared.generation,
          prepared.generationSha256, prepared.authorityId],
        sql: `INSERT INTO oh_semantic_vectors(profile_sha256, renderer_sha256,
          input_sha256, vector_sha256, vector, created_at)
          SELECT ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM oh_semantic_generations
            WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
          ON CONFLICT DO NOTHING`,
      });
    }
    for (const membership of prepared.memberships) {
      statements.push({
        args: [prepared.authorityId, prepared.generation, prepared.generationSha256,
          membership.recordKey, membership.recordSha256, membership.ordinal,
          membership.inputSha256, prepared.authorityId, prepared.generation,
          prepared.generationSha256, prepared.authorityId],
        sql: `INSERT INTO oh_semantic_memberships(authority_id, generation,
          generation_sha256, record_key, record_sha256, ordinal, input_sha256)
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM oh_semantic_generations
            WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
          ON CONFLICT DO NOTHING`,
      });
    }
    await this.#client.batch(statements, "write");
    const completeVectors = await readVectors(this.#client, orderedInputs.map(([digest]) => digest));
    if (completeVectors.size !== orderedInputs.length) {
      if (await readPurge(this.#client, prepared.authorityId) !== null) {
        throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
      }
      throw new OhLibSqlSemanticError("integrity", "The semantic vector cache did not converge.");
    }
    const stored = await readGeneration(this.#client, prepared.authorityId, prepared.generation);
    if (await readPurge(this.#client, prepared.authorityId) !== null) {
      throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
    }
    if (stored === null || !generationMatches(stored, prepared)) {
      throw new OhLibSqlSemanticError("conflict", "The semantic generation identity conflicts.");
    }
    const memberships = await readMemberships(this.#client, stored);
    if (canonicalJson(memberships) !== canonicalJson(prepared.memberships.map((membership) => ({
      inputSha256: membership.inputSha256,
      ordinal: membership.ordinal,
      recordKey: membership.recordKey,
      recordSha256: membership.recordSha256,
    })))) {
      throw new OhLibSqlSemanticError("conflict", "The semantic generation membership conflicts.");
    }
    return Object.freeze({
      authorityId: prepared.authorityId,
      chunks: prepared.chunkCount,
      documents: prepared.documentCount,
      embedded: missing.length,
      generation: prepared.generation,
      generationSha256: prepared.generationSha256,
      membershipSha256: prepared.membershipSha256,
      reused: orderedInputs.length - missing.length,
      status: "staged",
      v: 1,
    });
  }

  async publish(input: Readonly<{
    authorityId: string;
    expectedPublishedGeneration: number | null;
    generation: number;
    publishedAt?: string;
  }>): Promise<OhSemanticPublishResultV1> {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    const generationNumber = parseGeneration(input.generation);
    const expected = input.expectedPublishedGeneration === null
      ? null : parseGeneration(input.expectedPublishedGeneration);
    const publishedAt = parseInstant(input.publishedAt ?? canonicalNow());
    if (await readPurge(this.#client, authorityId) !== null) {
      throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
    }
    const generation = await readGeneration(this.#client, authorityId, generationNumber);
    if (generation === null) {
      throw new OhLibSqlSemanticError("conflict", "The semantic generation is not staged.");
    }
    await readMemberships(this.#client, generation);
    const before = await readHead(this.#client, authorityId);
    if (before !== null && headMatchesGeneration(before, generation)) {
      return Object.freeze({
        authorityId,
        generation: generationNumber,
        generationSha256: generation.generationSha256,
        published: false,
        v: 1,
      });
    }
    if ((before === null) !== (expected === null)
      || (before !== null && before.generation !== expected)
      || (before !== null && generationNumber < before.generation)) {
      throw new OhLibSqlSemanticError("conflict", "The semantic published-head precondition failed.");
    }
    let result: OhLibSqlResultV1;
    const values = [generation.authorityId, generation.generation,
      generation.authoritySha256, generation.profileSha256, generation.rendererSha256,
      generation.membershipSha256, generation.generationSha256, publishedAt];
    if (expected === null) {
      result = await this.#client.execute({
        args: [...values, generation.authorityId, generation.generation,
          generation.generationSha256, authorityId, authorityId],
        sql: `INSERT INTO oh_semantic_heads(authority_id, generation,
          authority_sha256, profile_sha256, renderer_sha256, membership_sha256,
          generation_sha256, published_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM oh_semantic_generations
            WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_heads WHERE authority_id = ?)
          ON CONFLICT DO NOTHING`,
      });
    } else {
      result = await this.#client.execute({
        args: [generation.generation, generation.authoritySha256, generation.profileSha256,
          generation.rendererSha256, generation.membershipSha256,
          generation.generationSha256, publishedAt, authorityId, expected,
          generation.authorityId, generation.generation, generation.generationSha256,
          authorityId],
        sql: `UPDATE oh_semantic_heads SET generation = ?, authority_sha256 = ?,
          profile_sha256 = ?, renderer_sha256 = ?, membership_sha256 = ?,
          generation_sha256 = ?, published_at = ?
          WHERE authority_id = ? AND generation = ?
            AND EXISTS (SELECT 1 FROM oh_semantic_generations
              WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)`,
      });
    }
    if (await readPurge(this.#client, authorityId) !== null) {
      throw new OhLibSqlSemanticError("purged", "The semantic authority was purged.");
    }
    const after = await readHead(this.#client, authorityId);
    if (after === null || !headMatchesGeneration(after, generation)) {
      throw new OhLibSqlSemanticError("conflict", "The semantic published head did not converge.");
    }
    return Object.freeze({
      authorityId,
      generation: generationNumber,
      generationSha256: generation.generationSha256,
      published: rowsAffected(result) > 0,
      v: 1,
    });
  }

  async search(input: Readonly<{
    authority: OhSemanticAuthorityRefV1;
    embeddingClient: OhCloudflareEmbeddingClientV1;
    limit?: number;
    query: string;
    signal?: AbortSignal;
  }>): Promise<readonly OhSemanticSearchResultV1[]> {
    this.#open();
    validateEmbeddingClient(input.embeddingClient);
    const authorityId = parseAuthorityId(input.authority.authorityId);
    const authoritySha256 = parseDigest(input.authority.authoritySha256, "authority");
    const authorityGeneration = parseGeneration(input.authority.generation);
    const limit = input.limit ?? 10;
    if (input.authority.v !== 1 || !Number.isSafeInteger(limit) || limit < 1
      || limit > OH_LIBSQL_SEMANTIC_LIMITS_V1.searchLimit
      || !Array.isArray(input.authority.records)
      || input.authority.records.length > OH_LIBSQL_SEMANTIC_LIMITS_V1.documentsPerGeneration) {
      throw new OhLibSqlSemanticError("invalid-input", "Invalid semantic search authority or limit.");
    }
    const records = new Map<string, Sha256Hex>();
    for (const record of input.authority.records) {
      const key = parseRecordKey(record.key);
      const recordSha256 = parseDigest(record.recordSha256, "record");
      if (records.has(key)) throw new OhLibSqlSemanticError("invalid-input", "Duplicate authority record key.");
      records.set(key, recordSha256);
    }
    if (await readPurge(this.#client, authorityId) !== null) return Object.freeze([]);
    const head = await readHead(this.#client, authorityId);
    if (head === null || head.authoritySha256 !== authoritySha256
      || head.generation !== authorityGeneration
      || head.profileSha256 !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256
      || head.rendererSha256 !== OH_SEMANTIC_RENDERER_V1.rendererSha256) {
      return Object.freeze([]);
    }
    const generation = await readGeneration(this.#client, authorityId, authorityGeneration);
    if (generation === null || !headMatchesGeneration(head, generation)) return Object.freeze([]);
    const renderedQuery = renderOhCloudflareEmbeddingQueryV1(input.query);
    const queryVectors = await input.embeddingClient.embed(
      [renderedQuery],
      input.signal === undefined ? {} : { signal: input.signal },
    );
    const queryVector = queryVectors[0];
    if (queryVectors.length !== 1 || queryVector === undefined) {
      throw new OhLibSqlSemanticError("integrity", "The query embedding response is invalid.");
    }
    const normalizedQuery = normalizeOhEmbeddingV1(queryVector);
    const best = new Map<string, OhSemanticSearchResultV1>();
    let scanned = 0;
    for (let offset = 0; offset < generation.chunkCount;
      offset += OH_LIBSQL_SEMANTIC_LIMITS_V1.searchPage) {
      const result = await this.#client.execute({
        args: [OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
          OH_SEMANTIC_RENDERER_V1.rendererSha256, authorityId, authorityGeneration,
          OH_LIBSQL_SEMANTIC_LIMITS_V1.searchPage, offset],
        sql: `SELECT membership.generation_sha256, membership.record_key,
          membership.record_sha256, membership.ordinal, membership.input_sha256,
          vector.vector_sha256, vector.vector
          FROM oh_semantic_memberships AS membership
          JOIN oh_semantic_vectors AS vector
            ON vector.input_sha256 = membership.input_sha256
            AND vector.profile_sha256 = ? AND vector.renderer_sha256 = ?
          WHERE membership.authority_id = ? AND membership.generation = ?
          ORDER BY membership.record_key, membership.ordinal LIMIT ? OFFSET ?`,
      });
      for (const row of result.rows) {
        scanned += 1;
        const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 0));
        const key = safeCode(rowValue(row, "record_key", 1), 512);
        const recordSha256 = parseSha256Hex(rowValue(row, "record_sha256", 2));
        const ordinal = integer(rowValue(row, "ordinal", 3));
        const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 4));
        const vectorSha256 = parseSha256Hex(rowValue(row, "vector_sha256", 5));
        if (generationSha256 !== generation.generationSha256 || key === null
          || recordSha256 === null || ordinal === null || ordinal < 0
          || ordinal >= OH_LIBSQL_SEMANTIC_LIMITS_V1.chunksPerDocument
          || inputSha256 === null || vectorSha256 === null) {
          throw new OhLibSqlSemanticError("integrity", "A semantic search row is invalid.");
        }
        if (records.get(key) !== recordSha256) continue;
        const vector = decodeVector(rowValue(row, "vector", 6), vectorSha256);
        let score = 0;
        for (let index = 0; index < normalizedQuery.length; index += 1) {
          score += (normalizedQuery[index] as number) * (vector[index] as number);
        }
        score = Math.max(-1, Math.min(1, score));
        const previous = best.get(key);
        if (previous === undefined || score > previous.score
          || (score === previous.score && ordinal < previous.chunkOrdinal)) {
          best.set(key, Object.freeze({ chunkOrdinal: ordinal, key, recordSha256, score, v: 1 }));
        }
      }
    }
    if (scanned !== generation.chunkCount) {
      throw new OhLibSqlSemanticError("integrity", "The semantic search scan is incomplete.");
    }
    const finalHead = await readHead(this.#client, authorityId);
    if (finalHead === null || canonicalJson(finalHead) !== canonicalJson(head)
      || await readPurge(this.#client, authorityId) !== null) return Object.freeze([]);
    return Object.freeze([...best.values()]
      .sort((left, right) => right.score - left.score
        || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .slice(0, limit));
  }

  async purgeAuthority(input: Readonly<{
    authorityId: string;
    purgedAt?: string;
  }>): Promise<OhSemanticPurgeResultV1> {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    const requestedAt = parseInstant(input.purgedAt ?? canonicalNow());
    const previous = await readPurge(this.#client, authorityId);
    const results = await this.#client.batch([
      {
        args: [authorityId, requestedAt],
        sql: `INSERT INTO oh_semantic_purges(authority_id, purged_at)
          VALUES (?, ?) ON CONFLICT DO NOTHING`,
      },
      { args: [authorityId], sql: "DELETE FROM oh_semantic_heads WHERE authority_id = ?" },
      { args: [authorityId], sql: "DELETE FROM oh_semantic_memberships WHERE authority_id = ?" },
      { args: [authorityId], sql: "DELETE FROM oh_semantic_generations WHERE authority_id = ?" },
      {
        sql: `DELETE FROM oh_semantic_vectors AS vector
          WHERE NOT EXISTS (SELECT 1 FROM oh_semantic_memberships AS membership
            WHERE membership.input_sha256 = vector.input_sha256)`,
      },
    ], "write");
    const purgedAt = await readPurge(this.#client, authorityId);
    if (purgedAt === null || (previous !== null && purgedAt !== previous)) {
      throw new OhLibSqlSemanticError("integrity", "The semantic purge did not converge.");
    }
    if (await readHead(this.#client, authorityId) !== null
      || (await this.#client.execute({
        args: [authorityId, authorityId],
        sql: `SELECT authority_id FROM oh_semantic_generations WHERE authority_id = ?
          UNION ALL SELECT authority_id FROM oh_semantic_memberships WHERE authority_id = ? LIMIT 1`,
      })).rows.length !== 0) {
      throw new OhLibSqlSemanticError("integrity", "The semantic authority purge is incomplete.");
    }
    return Object.freeze({
      authorityId,
      generations: rowsAffected(results[3] ?? { rows: [] }),
      memberships: rowsAffected(results[2] ?? { rows: [] }),
      orphanVectors: rowsAffected(results[4] ?? { rows: [] }),
      purgedAt,
      v: 1,
    });
  }
}

export async function openOhLibSqlSemanticCacheV1(
  client: OhLibSqlClientV1,
  options: Readonly<{ closeClient?: boolean }> = {},
): Promise<OhLibSqlSemanticCacheV1> {
  return await OhLibSqlSemanticCacheV1.open(client, options.closeClient ?? false);
}
