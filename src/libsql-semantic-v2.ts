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

export const OH_LIBSQL_SEMANTIC_LIMITS_V2 = Object.freeze({
  chunksPerDocument: 64,
  chunksPerGeneration: 4_096,
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
  records: readonly Readonly<{ key: string; recordSha256: Sha256Hex }>[];
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

/** The exact, currently published cache pointer for one semantic authority. */
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

const SCHEMA_NAME_V1 = "oh.libsql-semantic-cache.v1";
const SCHEMA_VERSION_V1 = 1;
const SCHEMA_NAME = "oh.libsql-semantic-cache.v2";
const SCHEMA_VERSION = 2;
const VECTOR_BYTES = OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions * 4;
const DEFAULT_ISOLATION_KIND = "oh.semantic-authority-isolation.v2";
const GENERATION_KIND = "oh.semantic-generation.v2";
const MEMBERSHIP_KIND = "oh.semantic-membership.v2";
const PURGE_MARKER_KIND = "oh.semantic-purge-marker.v2";
const PURGE_RECEIPT_KIND = "oh.semantic-purge-receipt.v2";
const TRANSITION_PAGE_SIZE = 32;
const TRANSITION_TABLE_NAME = "oh_semantic_v1_purge_transition";

const SCHEMA_TABLE = `CREATE TABLE IF NOT EXISTS oh_semantic_schemas (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  schema_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT`;

const TRANSITION_TABLE = `CREATE TABLE oh_semantic_v1_purge_transition (
  authority_id TEXT PRIMARY KEY,
  purged_at TEXT NOT NULL
) STRICT`;

const SCHEMA_STATEMENTS_V1 = Object.freeze([
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

const SCHEMA_STATEMENTS = Object.freeze([
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
const EXPECTED_SCHEMA_OBJECTS_V1 = Object.freeze(
  [SCHEMA_TABLE, ...SCHEMA_STATEMENTS_V1]
    .map(expectedSchemaObject)
    .sort((left, right) => canonicalJson([left.type, left.name])
      .localeCompare(canonicalJson([right.type, right.name]))),
);
const SCHEMA_SHA256_V1 = canonicalSha256(EXPECTED_SCHEMA_OBJECTS_V1);
const EXPECTED_TRANSITION_SCHEMA_OBJECTS = Object.freeze(
  [...EXPECTED_SCHEMA_OBJECTS, expectedSchemaObject(TRANSITION_TABLE)]
    .sort((left, right) => canonicalJson([left.type, left.name])
      .localeCompare(canonicalJson([right.type, right.name]))),
);

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
  if (parsed === null) throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic authority ID.");
  return parsed;
}

/**
 * Derives the private-by-default cache scope used when a host does not supply
 * its own epoch/profile isolation digest.
 */
export function deriveOhSemanticIsolationSha256V2(authorityId: string): Sha256Hex {
  return canonicalSha256({
    authorityId: parseAuthorityId(authorityId),
    kind: DEFAULT_ISOLATION_KIND,
    v: 2,
  });
}

function isolationSha256(authorityId: string, value: unknown): Sha256Hex {
  return value === undefined
    ? deriveOhSemanticIsolationSha256V2(authorityId)
    : parseDigest(value, "semantic isolation");
}

function purgeMarkerSha256(
  authorityId: string,
  isolation: Sha256Hex,
  purgedAt: string,
): Sha256Hex {
  return canonicalSha256({
    authorityId,
    isolationSha256: isolation,
    kind: PURGE_MARKER_KIND,
    purgedAt,
    v: 2,
  });
}

function parseRecordKey(value: unknown): string {
  const parsed = safeCode(value, 512);
  if (parsed === null) throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic record key.");
  return parsed;
}

function parseGeneration(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic authority generation.");
  }
  return value as number;
}

function parseDigest(value: unknown, label: string): Sha256Hex {
  const digest = parseSha256Hex(value);
  if (digest === null) throw new OhLibSqlSemanticV2Error("invalid-input", `Invalid ${label} digest.`);
  return digest;
}

function parseInstant(value: unknown): string {
  const instant = parseCanonicalInstantV1(value);
  if (instant === null) throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic instant.");
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
      throw new OhLibSqlSemanticV2Error("integrity", "The semantic schema inventory is malformed.");
    }
    const schemaType: SchemaObject["type"] = type;
    return { name, sql: normalizedSchemaSql(sql), tableName, type: schemaType };
  }).sort((left, right) => canonicalJson([left.type, left.name])
    .localeCompare(canonicalJson([right.type, right.name])));
}

async function verifySchemaRevision(
  client: OhLibSqlClientV1,
  revision: Readonly<{
    expected: readonly SchemaObject[];
    name: string;
    schemaSha256: Sha256Hex;
    version: number;
  }>,
): Promise<void> {
  let marker: OhLibSqlResultV1;
  try {
    marker = await client.execute({
      args: [revision.version],
      sql: "SELECT name, schema_sha256 FROM oh_semantic_schemas WHERE version = ?",
    });
  } catch {
    throw new OhLibSqlSemanticV2Error("schema-unavailable", "The semantic cache schema is unavailable.");
  }
  const row = marker.rows[0];
  if (marker.rows.length !== 1 || row === undefined
    || rowValue(row, "name", 0) !== revision.name
    || rowValue(row, "schema_sha256", 1) !== revision.schemaSha256) {
    throw new OhLibSqlSemanticV2Error("schema-unavailable", "The semantic cache schema marker is invalid.");
  }
  if (canonicalJson(await schemaObjects(client)) !== canonicalJson(revision.expected)) {
    throw new OhLibSqlSemanticV2Error("integrity", "The semantic cache schema has drifted.");
  }
}

async function verifySchema(client: OhLibSqlClientV1): Promise<void> {
  const transition = await client.execute({
    args: [TRANSITION_TABLE_NAME],
    sql: "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = ?",
  });
  if (transition.rows.length !== 0) {
    throw new OhLibSqlSemanticV2Error(
      "schema-unavailable",
      "The semantic V2 cache upgrade is still materializing purge custody.",
    );
  }
  await verifySchemaRevision(client, {
    expected: EXPECTED_SCHEMA_OBJECTS,
    name: SCHEMA_NAME,
    schemaSha256: SCHEMA_SHA256,
    version: SCHEMA_VERSION,
  });
}

type LegacyPurge = Readonly<{ authorityId: string; purgedAt: string }>;

async function transitionPage(client: OhLibSqlClientV1): Promise<readonly LegacyPurge[]> {
  const result = await client.execute({
    args: [TRANSITION_PAGE_SIZE],
    sql: `SELECT authority_id, purged_at FROM oh_semantic_v1_purge_transition
      ORDER BY authority_id LIMIT ?`,
  });
  return Object.freeze(result.rows.map((row) => {
    const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
    const purgedAt = parseCanonicalInstantV1(rowValue(row, "purged_at", 1));
    if (authorityId === null || purgedAt === null) {
      throw new OhLibSqlSemanticV2Error("integrity", "A semantic v1 purge marker is invalid.");
    }
    return Object.freeze({ authorityId, purgedAt });
  }));
}

async function verifyTransitionSchema(client: OhLibSqlClientV1): Promise<void> {
  if (canonicalJson(await schemaObjects(client))
    !== canonicalJson(EXPECTED_TRANSITION_SCHEMA_OBJECTS)) {
    throw new OhLibSqlSemanticV2Error("integrity", "The semantic V2 transition schema has drifted.");
  }
  const markers = await client.execute(
    "SELECT version FROM oh_semantic_schemas ORDER BY version LIMIT 1",
  );
  if (markers.rows.length !== 0) {
    throw new OhLibSqlSemanticV2Error(
      "integrity",
      "The semantic V2 marker cannot exist during purge transition.",
    );
  }
}

async function startSemanticCacheV1ToV2Transition(
  client: OhLibSqlClientV1,
): Promise<void> {
  try {
    await verifySchemaRevision(client, {
      expected: EXPECTED_SCHEMA_OBJECTS_V1,
      name: SCHEMA_NAME_V1,
      schemaSha256: SCHEMA_SHA256_V1,
      version: SCHEMA_VERSION_V1,
    });
    await client.batch([
      { sql: TRANSITION_TABLE },
      {
        sql: `INSERT INTO oh_semantic_v1_purge_transition(authority_id, purged_at)
          SELECT authority_id, purged_at FROM oh_semantic_purges`,
      },
      { sql: "DROP TABLE oh_semantic_heads" },
      { sql: "DROP TABLE oh_semantic_memberships" },
      { sql: "DROP TABLE oh_semantic_generations" },
      { sql: "DROP TABLE oh_semantic_vectors" },
      { sql: "DROP TABLE oh_semantic_purges" },
      { sql: "DROP TABLE oh_semantic_schemas" },
      { sql: SCHEMA_TABLE },
      ...SCHEMA_STATEMENTS.map((sql) => ({ sql })),
    ], "write");
  } catch {
    const inventory = await schemaObjects(client);
    if (canonicalJson(inventory) === canonicalJson(EXPECTED_SCHEMA_OBJECTS)) {
      await verifySchema(client);
      return;
    }
    if (canonicalJson(inventory) !== canonicalJson(EXPECTED_TRANSITION_SCHEMA_OBJECTS)) {
      throw new OhLibSqlSemanticV2Error(
        "integrity",
        "The semantic V1-to-V2 transition did not begin atomically.",
      );
    }
  }
  await verifyTransitionSchema(client);
}

async function materializeTransitionPage(
  client: OhLibSqlClientV1,
  purges: readonly LegacyPurge[],
): Promise<void> {
  const statements: OhLibSqlStatementV1[] = [];
  for (const purge of purges) {
    const isolation = deriveOhSemanticIsolationSha256V2(purge.authorityId);
    const marker = purgeMarkerSha256(purge.authorityId, isolation, purge.purgedAt);
    statements.push({
      args: [isolation, purge.authorityId, purge.purgedAt,
        isolation, purge.authorityId, purge.purgedAt],
      sql: `INSERT INTO oh_semantic_isolations(isolation_sha256, authority_id, created_at)
        SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM oh_semantic_isolations
          WHERE isolation_sha256 = ? AND authority_id = ? AND created_at = ?)
        ON CONFLICT DO NOTHING`,
    });
    statements.push({
      args: [purge.authorityId, isolation,
        OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256, purge.purgedAt, marker],
      sql: `INSERT INTO oh_semantic_purges(authority_id, isolation_sha256,
        profile_sha256, published_generation, published_generation_sha256,
        purged_at, purge_marker_sha256, generation_count, membership_count,
        orphan_vector_count, isolation_scope_count, counts_recorded)
        VALUES (?, ?, ?, NULL, NULL, ?, ?, 0, 0, 0, 1, 0)
        ON CONFLICT DO NOTHING`,
    });
    statements.push({
      args: [purge.authorityId, purge.purgedAt,
        isolation, purge.authorityId, purge.purgedAt,
        purge.authorityId, isolation, OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
        purge.purgedAt, marker],
      sql: `DELETE FROM oh_semantic_v1_purge_transition
        WHERE authority_id = ? AND purged_at = ?
          AND EXISTS (SELECT 1 FROM oh_semantic_isolations
            WHERE isolation_sha256 = ? AND authority_id = ? AND created_at = ?)
          AND EXISTS (SELECT 1 FROM oh_semantic_purges
            WHERE authority_id = ? AND isolation_sha256 = ? AND profile_sha256 = ?
              AND published_generation IS NULL AND published_generation_sha256 IS NULL
              AND purged_at = ? AND purge_marker_sha256 = ?
              AND generation_count = 0 AND membership_count = 0
              AND orphan_vector_count = 0 AND isolation_scope_count = 1
              AND counts_recorded = 0)`,
    });
  }
  await client.batch(statements, "write");
  const placeholders = purges.map(() => "?").join(", ");
  const remaining = await client.execute({
    args: purges.map(({ authorityId }) => authorityId),
    sql: `SELECT authority_id FROM oh_semantic_v1_purge_transition
      WHERE authority_id IN (${placeholders}) LIMIT 1`,
  });
  if (remaining.rows.length !== 0) {
    throw new OhLibSqlSemanticV2Error(
      "integrity",
      "A semantic V1 purge tombstone did not materialize exactly in V2.",
    );
  }
}

async function finishSemanticCacheV2Transition(
  client: OhLibSqlClientV1,
  appliedAt: string,
): Promise<void> {
  try {
    await client.batch([
      {
        args: [SCHEMA_VERSION, SCHEMA_NAME, SCHEMA_SHA256, appliedAt],
        sql: `INSERT INTO oh_semantic_schemas(version, name, schema_sha256, applied_at)
          SELECT ?, CASE WHEN NOT EXISTS
            (SELECT 1 FROM oh_semantic_v1_purge_transition) THEN ? END, ?, ?`,
      },
      { sql: "DROP TABLE oh_semantic_v1_purge_transition" },
    ], "write");
  } catch {
    await verifySchema(client);
  }
}

async function hasConvergedSemanticCacheV2(client: OhLibSqlClientV1): Promise<boolean> {
  try {
    await verifySchema(client);
    return true;
  } catch {
    return false;
  }
}

async function resumeSemanticCacheV2Transition(
  client: OhLibSqlClientV1,
  appliedAt: string,
): Promise<void> {
  try {
    await verifyTransitionSchema(client);
    for (;;) {
      const page = await transitionPage(client);
      if (page.length === 0) break;
      await materializeTransitionPage(client, page);
    }
    await finishSemanticCacheV2Transition(client, appliedAt);
  } catch (error) {
    if (await hasConvergedSemanticCacheV2(client)) return;
    throw error;
  }
}

export async function bootstrapOhLibSqlSemanticCacheV2(
  client: OhLibSqlClientV1,
  options: Readonly<{ appliedAt?: string }> = {},
): Promise<Readonly<{ schemaSha256: Sha256Hex; schemaVersion: 2; v: 2 }>> {
  const appliedAt = parseInstant(options.appliedAt ?? canonicalNow());
  let existing = await schemaObjects(client);
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
  } else if (canonicalJson(existing) === canonicalJson(EXPECTED_SCHEMA_OBJECTS_V1)) {
    await startSemanticCacheV1ToV2Transition(client);
  }
  existing = await schemaObjects(client);
  if (canonicalJson(existing) === canonicalJson(EXPECTED_TRANSITION_SCHEMA_OBJECTS)) {
    await resumeSemanticCacheV2Transition(client, appliedAt);
  } else if (canonicalJson(existing) !== canonicalJson(EXPECTED_SCHEMA_OBJECTS)) {
    throw new OhLibSqlSemanticV2Error("integrity", "Refusing to bless a partial or drifted semantic V2 schema.");
  }
  await verifySchema(client);
  return Object.freeze({ schemaSha256: SCHEMA_SHA256, schemaVersion: 2, v: 2 });
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
    throw new OhLibSqlSemanticV2Error("integrity", "A cached semantic vector is corrupt.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vector = Array.from({ length: OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.dimensions },
    (_, index) => view.getFloat32(index * 4, true));
  try { return Object.freeze([...normalizeOhEmbeddingV1(vector)]); }
  catch { throw new OhLibSqlSemanticV2Error("integrity", "A cached semantic vector is invalid."); }
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
  isolationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  memberships: readonly Membership[];
}>;

function prepareGeneration(input: Readonly<{
  authorityId: string;
  authoritySha256: Sha256Hex;
  createdAt?: string;
  documents: readonly OhSemanticDocumentV2[];
  generation: number;
  isolationSha256?: Sha256Hex;
  maximumChunksPerDocument?: number;
}>): Generation {
  const authorityId = parseAuthorityId(input.authorityId);
  const authoritySha256 = parseDigest(input.authoritySha256, "authority");
  const isolation = isolationSha256(authorityId, input.isolationSha256);
  const generation = parseGeneration(input.generation);
  const createdAt = parseInstant(input.createdAt ?? canonicalNow());
  const maximumChunks = input.maximumChunksPerDocument
    ?? OH_LIBSQL_SEMANTIC_LIMITS_V2.chunksPerDocument;
  if (!Number.isSafeInteger(maximumChunks) || maximumChunks < 1
    || maximumChunks > OH_LIBSQL_SEMANTIC_LIMITS_V2.chunksPerDocument
    || !Array.isArray(input.documents) || input.documents.length < 1
    || input.documents.length > OH_LIBSQL_SEMANTIC_LIMITS_V2.documentsPerGeneration) {
    throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic generation bounds.");
  }
  const documents = input.documents.map((document) => {
    if (document.v !== 2) throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic document version.");
    return {
      ...document,
      key: parseRecordKey(document.key),
      recordSha256: parseDigest(document.recordSha256, "record"),
    };
  }).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  if (new Set(documents.map(({ key }) => key)).size !== documents.length) {
    throw new OhLibSqlSemanticV2Error("invalid-input", "Semantic document keys must be unique.");
  }
  const memberships: Membership[] = [];
  for (const document of documents) {
    const rendered = renderOhCloudflareEmbeddingDocumentV1({
      content: document.content,
      maximumChunks,
      title: document.title,
    });
    if (rendered.status !== "complete") {
      throw new OhLibSqlSemanticV2Error("invalid-input", "A semantic document exceeds the complete renderer bound.");
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
    || memberships.length > OH_LIBSQL_SEMANTIC_LIMITS_V2.chunksPerGeneration) {
    throw new OhLibSqlSemanticV2Error("invalid-input", "The semantic generation exceeds its chunk bound.");
  }
  const membershipSha256 = canonicalSha256({
    kind: MEMBERSHIP_KIND,
    memberships: memberships.map((membership) => ({
      inputSha256: membership.inputSha256,
      isolationSha256: isolation,
      ordinal: membership.ordinal,
      recordKey: membership.recordKey,
      recordSha256: membership.recordSha256,
    })),
    v: 2,
  });
  const generationSha256 = canonicalSha256({
    authorityId,
    authoritySha256,
    chunkCount: memberships.length,
    documentCount: documents.length,
    generation,
    isolationSha256: isolation,
    kind: GENERATION_KIND,
    membershipSha256,
    profileSha256: OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
    rendererSha256: OH_SEMANTIC_RENDERER_V1.rendererSha256,
    v: 2,
  });
  return Object.freeze({
    authorityId,
    authoritySha256,
    chunkCount: memberships.length,
    createdAt,
    documentCount: documents.length,
    generation,
    generationSha256,
    isolationSha256: isolation,
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
  isolationSha256: Sha256Hex;
  membershipSha256: Sha256Hex;
  profileSha256: Sha256Hex;
  rendererSha256: Sha256Hex;
}>;

type StoredHead = Readonly<{
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

function parseStoredGeneration(
  row: Readonly<Record<string, unknown>> | readonly unknown[],
): StoredGeneration {
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

function generationMatches(left: StoredGeneration, right: Generation): boolean {
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

function parseStoredHead(row: Readonly<Record<string, unknown>> | readonly unknown[]): StoredHead {
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

function headMatchesGeneration(head: StoredHead, generation: StoredGeneration): boolean {
  return head.authorityId === generation.authorityId
    && head.authoritySha256 === generation.authoritySha256
    && head.generation === generation.generation
    && head.generationSha256 === generation.generationSha256
    && head.isolationSha256 === generation.isolationSha256
    && head.membershipSha256 === generation.membershipSha256
    && head.profileSha256 === generation.profileSha256
    && head.rendererSha256 === generation.rendererSha256;
}

const GENERATION_SELECT = `SELECT authority_id, generation, authority_sha256,
  isolation_sha256, profile_sha256, renderer_sha256, membership_sha256, generation_sha256,
  document_count, chunk_count, created_at
  FROM oh_semantic_generations WHERE authority_id = ? AND generation = ?`;
const HEAD_SELECT = `SELECT authority_id, generation, authority_sha256,
  isolation_sha256, profile_sha256, renderer_sha256, membership_sha256,
  generation_sha256, published_at
  FROM oh_semantic_heads WHERE authority_id = ?`;

async function readGeneration(
  client: OhLibSqlClientV1,
  authorityId: string,
  generation: number,
): Promise<StoredGeneration | null> {
  const result = await client.execute({ args: [authorityId, generation], sql: GENERATION_SELECT });
  if (result.rows.length > 1) throw new OhLibSqlSemanticV2Error("integrity", "Duplicate semantic generations.");
  const row = result.rows[0];
  return row === undefined ? null : parseStoredGeneration(row);
}

async function readHead(client: OhLibSqlClientV1, authorityId: string): Promise<StoredHead | null> {
  const result = await client.execute({ args: [authorityId], sql: HEAD_SELECT });
  if (result.rows.length > 1) throw new OhLibSqlSemanticV2Error("integrity", "Duplicate semantic heads.");
  const row = result.rows[0];
  return row === undefined ? null : parseStoredHead(row);
}

type StoredPurge = Readonly<Omit<OhSemanticPurgeResultV2, "purgeReceiptSha256">>;

function purgeResult(stored: StoredPurge): OhSemanticPurgeResultV2 {
  return Object.freeze({
    ...stored,
    purgeReceiptSha256: canonicalSha256({
      kind: PURGE_RECEIPT_KIND,
      receipt: stored,
      v: 2,
    }),
  });
}

async function readPurge(
  client: OhLibSqlClientV1,
  authorityId: string,
): Promise<OhSemanticPurgeResultV2 | null> {
  const result = await client.execute({
    args: [authorityId],
    sql: `SELECT isolation_sha256, profile_sha256, published_generation,
      published_generation_sha256, purged_at, purge_marker_sha256,
      generation_count, membership_count, orphan_vector_count,
      isolation_scope_count, counts_recorded
      FROM oh_semantic_purges WHERE authority_id = ?`,
  });
  if (result.rows.length > 1) throw new OhLibSqlSemanticV2Error("integrity", "Duplicate semantic purge markers.");
  const row = result.rows[0];
  if (row === undefined) return null;
  const isolation = parseSha256Hex(rowValue(row, "isolation_sha256", 0));
  const profileSha256 = parseSha256Hex(rowValue(row, "profile_sha256", 1));
  const publishedGenerationValue = rowValue(row, "published_generation", 2);
  const publishedGeneration = publishedGenerationValue === null
    ? null : integer(publishedGenerationValue);
  const publishedGenerationSha256Value = rowValue(row, "published_generation_sha256", 3);
  const publishedGenerationSha256 = publishedGenerationSha256Value === null
    ? null : parseSha256Hex(publishedGenerationSha256Value);
  const purgedAt = parseCanonicalInstantV1(rowValue(row, "purged_at", 4));
  const storedMarker = parseSha256Hex(rowValue(row, "purge_marker_sha256", 5));
  const generations = integer(rowValue(row, "generation_count", 6));
  const memberships = integer(rowValue(row, "membership_count", 7));
  const orphanVectors = integer(rowValue(row, "orphan_vector_count", 8));
  const isolationScopes = integer(rowValue(row, "isolation_scope_count", 9));
  const countsRecordedValue = integer(rowValue(row, "counts_recorded", 10));
  if (isolation === null
    || profileSha256 !== OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256
    || (publishedGeneration !== null && publishedGeneration < 0)
    || (publishedGeneration === null) !== (publishedGenerationSha256 === null)
    || purgedAt === null || storedMarker === null
    || storedMarker !== purgeMarkerSha256(authorityId, isolation, purgedAt)
    || generations === null || generations < 0
    || memberships === null || memberships < 0
    || orphanVectors === null || orphanVectors < 0
    || isolationScopes === null || isolationScopes < 1
    || (countsRecordedValue !== 0 && countsRecordedValue !== 1)) {
    throw new OhLibSqlSemanticV2Error("integrity", "The semantic purge marker is invalid.");
  }
  return purgeResult(Object.freeze({
    authorityId,
    countsRecorded: countsRecordedValue === 1,
    generations,
    isolationScopes,
    isolationSha256: isolation,
    memberships,
    orphanVectors,
    profileSha256,
    publishedGeneration,
    publishedGenerationSha256,
    purgeMarkerSha256: storedMarker,
    purgedAt,
    residualGenerations: 0,
    residualMemberships: 0,
    residualScopedVectors: 0,
    v: 2,
  }));
}

async function readIsolationOwner(
  client: OhLibSqlClientV1,
  isolation: Sha256Hex,
): Promise<string | null> {
  const result = await client.execute({
    args: [isolation],
    sql: "SELECT authority_id FROM oh_semantic_isolations WHERE isolation_sha256 = ?",
  });
  if (result.rows.length > 1) throw new OhLibSqlSemanticV2Error("integrity", "Duplicate semantic isolations.");
  const row = result.rows[0];
  if (row === undefined) return null;
  const authorityId = safeCode(rowValue(row, "authority_id", 0), 256);
  if (authorityId === null) throw new OhLibSqlSemanticV2Error("integrity", "A semantic isolation is invalid.");
  return authorityId;
}

async function reserveIsolation(
  client: OhLibSqlClientV1,
  authorityId: string,
  isolation: Sha256Hex,
  createdAt: string,
): Promise<void> {
  if (await readPurge(client, authorityId) !== null) {
    throw new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.");
  }
  await client.execute({
    args: [isolation, authorityId, createdAt, authorityId],
    sql: `INSERT INTO oh_semantic_isolations(isolation_sha256, authority_id, created_at)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
      ON CONFLICT DO NOTHING`,
  });
  const owner = await readIsolationOwner(client, isolation);
  if (await readPurge(client, authorityId) !== null) {
    throw new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.");
  }
  if (owner !== authorityId) {
    throw new OhLibSqlSemanticV2Error("conflict", "The semantic isolation belongs to another authority.");
  }
}

async function reservePurgeIsolation(
  client: OhLibSqlClientV1,
  authorityId: string,
  isolation: Sha256Hex,
  createdAt: string,
): Promise<void> {
  const head = await readHead(client, authorityId);
  if (head !== null && head.isolationSha256 !== isolation) {
    throw new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.");
  }
  const owner = await readIsolationOwner(client, isolation);
  if (owner !== null && owner !== authorityId) {
    throw new OhLibSqlSemanticV2Error("conflict", "The semantic isolation belongs to another authority.");
  }
  if (owner === null) {
    const existing = await client.execute({
      args: [authorityId],
      sql: "SELECT isolation_sha256 FROM oh_semantic_isolations WHERE authority_id = ? LIMIT 1",
    });
    if (existing.rows.length !== 0) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.");
    }
    await reserveIsolation(client, authorityId, isolation, createdAt);
  }
}

async function verifyPurgeResidual(
  client: OhLibSqlClientV1,
  authorityId: string,
): Promise<void> {
  const result = await client.execute({
    args: [authorityId, authorityId, authorityId, authorityId],
    sql: `SELECT
      (SELECT count(*) FROM oh_semantic_heads WHERE authority_id = ?) AS heads,
      (SELECT count(*) FROM oh_semantic_generations WHERE authority_id = ?) AS generations,
      (SELECT count(*) FROM oh_semantic_memberships WHERE authority_id = ?) AS memberships,
      (SELECT count(*) FROM oh_semantic_vectors AS vector
        JOIN oh_semantic_isolations AS isolation
          ON isolation.isolation_sha256 = vector.isolation_sha256
        WHERE isolation.authority_id = ?) AS vectors`,
  });
  const row = result.rows[0];
  if (result.rows.length !== 1 || row === undefined
    || integer(rowValue(row, "heads", 0)) !== 0
    || integer(rowValue(row, "generations", 1)) !== 0
    || integer(rowValue(row, "memberships", 2)) !== 0
    || integer(rowValue(row, "vectors", 3)) !== 0) {
    throw new OhLibSqlSemanticV2Error("integrity", "The semantic authority purge is incomplete.");
  }
}

async function readMemberships(
  client: OhLibSqlClientV1,
  generation: StoredGeneration,
): Promise<readonly Omit<Membership, "input">[]> {
  const memberships: Array<Omit<Membership, "input">> = [];
  for (let offset = 0; offset < generation.chunkCount; offset += OH_LIBSQL_SEMANTIC_LIMITS_V2.searchPage) {
    const result = await client.execute({
      args: [generation.authorityId, generation.generation,
        OH_LIBSQL_SEMANTIC_LIMITS_V2.searchPage, offset],
      sql: `SELECT generation_sha256, isolation_sha256, record_key,
        record_sha256, ordinal, input_sha256
        FROM oh_semantic_memberships
        WHERE authority_id = ? AND generation = ?
        ORDER BY record_key, ordinal LIMIT ? OFFSET ?`,
    });
    for (const row of result.rows) {
      const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 0));
      const isolation = parseSha256Hex(rowValue(row, "isolation_sha256", 1));
      const recordKey = safeCode(rowValue(row, "record_key", 2), 512);
      const recordSha256 = parseSha256Hex(rowValue(row, "record_sha256", 3));
      const ordinal = integer(rowValue(row, "ordinal", 4));
      const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 5));
      if (generationSha256 !== generation.generationSha256
        || isolation !== generation.isolationSha256 || recordKey === null
        || recordSha256 === null || ordinal === null || ordinal < 0
        || ordinal >= OH_LIBSQL_SEMANTIC_LIMITS_V2.chunksPerDocument
        || inputSha256 === null) {
        throw new OhLibSqlSemanticV2Error("integrity", "A semantic generation membership is invalid.");
      }
      memberships.push(Object.freeze({ inputSha256, ordinal, recordKey, recordSha256 }));
    }
  }
  if (memberships.length !== generation.chunkCount
    || canonicalSha256({
      kind: MEMBERSHIP_KIND,
      memberships: memberships.map((membership) => ({
        inputSha256: membership.inputSha256,
        isolationSha256: generation.isolationSha256,
        ordinal: membership.ordinal,
        recordKey: membership.recordKey,
        recordSha256: membership.recordSha256,
      })),
      v: 2,
    }) !== generation.membershipSha256) {
    throw new OhLibSqlSemanticV2Error("integrity", "A semantic generation membership digest is invalid.");
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
  isolationSha256: Sha256Hex,
  inputSha256s: readonly Sha256Hex[],
): Promise<ReadonlyMap<Sha256Hex, StoredVector>> {
  const vectors = new Map<Sha256Hex, StoredVector>();
  for (let offset = 0; offset < inputSha256s.length; offset += 64) {
    const page = inputSha256s.slice(offset, offset + 64);
    if (page.length === 0) continue;
    const placeholders = page.map(() => "?").join(", ");
    const result = await client.execute({
      args: [isolationSha256, OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
        OH_SEMANTIC_RENDERER_V1.rendererSha256, ...page],
      sql: `SELECT input_sha256, vector_sha256, vector FROM oh_semantic_vectors
        WHERE isolation_sha256 = ? AND profile_sha256 = ? AND renderer_sha256 = ?
          AND input_sha256 IN (${placeholders}) ORDER BY input_sha256`,
    });
    for (const row of result.rows) {
      const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 0));
      const vectorSha256 = parseSha256Hex(rowValue(row, "vector_sha256", 1));
      if (inputSha256 === null || vectorSha256 === null || !page.includes(inputSha256)
        || vectors.has(inputSha256)) {
        throw new OhLibSqlSemanticV2Error("integrity", "A cached semantic vector identity is invalid.");
      }
      const bytes = storedBytes(rowValue(row, "vector", 2));
      if (bytes === null) {
        throw new OhLibSqlSemanticV2Error("integrity", "A cached semantic vector is corrupt.");
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
    throw new OhLibSqlSemanticV2Error("invalid-input", "The embedding client profile is incompatible.");
  }
}

export class OhLibSqlSemanticCacheV2 {
  readonly #client: OhLibSqlClientV1;
  readonly #closeClient: boolean;
  #closed = false;

  private constructor(client: OhLibSqlClientV1, closeClient: boolean) {
    this.#client = client;
    this.#closeClient = closeClient;
  }

  /** @internal Public callers should use `openOhLibSqlSemanticCacheV2`. */
  static async open(client: OhLibSqlClientV1, closeClient: boolean): Promise<OhLibSqlSemanticCacheV2> {
    await verifySchema(client);
    return new OhLibSqlSemanticCacheV2(client, closeClient);
  }

  #open(): void {
    if (this.#closed) throw new OhLibSqlSemanticV2Error("schema-unavailable", "The semantic cache is closed.");
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
    isolationSha256?: Sha256Hex;
  }>): Promise<OhSemanticPublishedHeadV2 | null> {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    const isolation = isolationSha256(authorityId, input.isolationSha256);
    if (await readPurge(this.#client, authorityId) !== null) return null;
    const head = await readHead(this.#client, authorityId);
    if (head === null || head.isolationSha256 !== isolation) return null;
    const generation = await readGeneration(this.#client, authorityId, head.generation);
    if (generation === null || !headMatchesGeneration(head, generation)) {
      if (await readPurge(this.#client, authorityId) !== null) return null;
      throw new OhLibSqlSemanticV2Error(
        "integrity",
        "The semantic published head does not match its immutable generation.",
      );
    }
    if (await readPurge(this.#client, authorityId) !== null) return null;
    const finalHead = await readHead(this.#client, authorityId);
    if (finalHead === null) {
      if (await readPurge(this.#client, authorityId) !== null) return null;
      throw new OhLibSqlSemanticV2Error(
        "integrity",
        "The semantic published head disappeared during its read.",
      );
    }
    if (canonicalJson(finalHead) !== canonicalJson(head)) {
      throw new OhLibSqlSemanticV2Error(
        "conflict",
        "The semantic published head changed during its read.",
      );
    }
    return Object.freeze({ ...head, v: 2 });
  }

  async stage(input: Readonly<{
    authorityId: string;
    authoritySha256: Sha256Hex;
    createdAt?: string;
    documents: readonly OhSemanticDocumentV2[];
    embeddingClient: OhCloudflareEmbeddingClientV1;
    generation: number;
    isolationSha256?: Sha256Hex;
    maximumChunksPerDocument?: number;
    signal?: AbortSignal;
  }>): Promise<OhSemanticStageResultV2> {
    this.#open();
    validateEmbeddingClient(input.embeddingClient);
    const prepared = prepareGeneration(input);
    await reserveIsolation(
      this.#client,
      prepared.authorityId,
      prepared.isolationSha256,
      prepared.createdAt,
    );
    if (await readPurge(this.#client, prepared.authorityId) !== null) {
      throw new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.");
    }
    const existingGeneration = await readGeneration(
      this.#client,
      prepared.authorityId,
      prepared.generation,
    );
    if (existingGeneration !== null && !generationMatches(existingGeneration, prepared)) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic generation identity conflicts.");
    }
    const uniqueInputs = new Map<Sha256Hex, OhRenderedEmbeddingInputV1>();
    for (const membership of prepared.memberships) uniqueInputs.set(membership.inputSha256, membership.input);
    const orderedInputs = [...uniqueInputs.entries()].sort(([left], [right]) => left < right ? -1 : 1);
    const existingVectors = await readVectors(
      this.#client,
      prepared.isolationSha256,
      orderedInputs.map(([digest]) => digest),
    );
    const missing = orderedInputs.filter(([digest]) => !existingVectors.has(digest));
    const candidateVectors = new Map(existingVectors);
    for (let offset = 0; offset < missing.length; offset += OH_LIBSQL_SEMANTIC_LIMITS_V2.embeddingBatch) {
      const page = missing.slice(offset, offset + OH_LIBSQL_SEMANTIC_LIMITS_V2.embeddingBatch);
      const vectors = await input.embeddingClient.embed(
        page.map(([, rendered]) => rendered),
        input.signal === undefined ? {} : { signal: input.signal },
      );
      if (vectors.length !== page.length) {
        throw new OhLibSqlSemanticV2Error("integrity", "The embedding client returned a mismatched vector batch.");
      }
      for (const [index, [inputSha256]] of page.entries()) {
        const vector = vectors[index];
        if (vector === undefined) throw new OhLibSqlSemanticV2Error("integrity", "A semantic vector is missing.");
        const bytes = vectorBytes(vector);
        const vectorSha256 = sha256Hex(bytes);
        decodeVector(bytes, vectorSha256);
        candidateVectors.set(inputSha256, Object.freeze({ bytes, inputSha256, vectorSha256 }));
      }
    }
    const statements: OhLibSqlStatementV1[] = [{
      args: [prepared.authorityId, prepared.generation, prepared.authoritySha256,
        prepared.isolationSha256,
        OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
        OH_SEMANTIC_RENDERER_V1.rendererSha256, prepared.membershipSha256,
        prepared.generationSha256, prepared.documentCount, prepared.chunkCount,
        prepared.createdAt, prepared.authorityId],
      sql: `INSERT INTO oh_semantic_generations(authority_id, generation,
        authority_sha256, isolation_sha256, profile_sha256, renderer_sha256, membership_sha256,
        generation_sha256, document_count, chunk_count, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
        ON CONFLICT DO NOTHING`,
    }];
    for (const [inputSha256] of orderedInputs) {
      const candidate = candidateVectors.get(inputSha256);
      if (candidate === undefined) {
        throw new OhLibSqlSemanticV2Error("integrity", "A semantic vector candidate is missing.");
      }
      statements.push({
        args: [prepared.isolationSha256,
          OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
          OH_SEMANTIC_RENDERER_V1.rendererSha256, inputSha256, candidate.vectorSha256,
          candidate.bytes, prepared.createdAt, prepared.authorityId, prepared.generation,
          prepared.generationSha256, prepared.isolationSha256, prepared.authorityId],
        sql: `INSERT INTO oh_semantic_vectors(isolation_sha256, profile_sha256,
          renderer_sha256, input_sha256, vector_sha256, vector, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM oh_semantic_generations
            WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?
              AND isolation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
          ON CONFLICT DO NOTHING`,
      });
    }
    for (const membership of prepared.memberships) {
      statements.push({
        args: [prepared.authorityId, prepared.generation, prepared.generationSha256,
          prepared.isolationSha256, membership.recordKey, membership.recordSha256, membership.ordinal,
          membership.inputSha256, prepared.authorityId, prepared.generation,
          prepared.generationSha256, prepared.isolationSha256, prepared.authorityId],
        sql: `INSERT INTO oh_semantic_memberships(authority_id, generation,
          generation_sha256, isolation_sha256, record_key, record_sha256, ordinal, input_sha256)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM oh_semantic_generations
            WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?
              AND isolation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
          ON CONFLICT DO NOTHING`,
      });
    }
    await this.#client.batch(statements, "write");
    const completeVectors = await readVectors(
      this.#client,
      prepared.isolationSha256,
      orderedInputs.map(([digest]) => digest),
    );
    if (completeVectors.size !== orderedInputs.length) {
      if (await readPurge(this.#client, prepared.authorityId) !== null) {
        throw new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.");
      }
      throw new OhLibSqlSemanticV2Error("integrity", "The semantic vector cache did not converge.");
    }
    const stored = await readGeneration(this.#client, prepared.authorityId, prepared.generation);
    if (await readPurge(this.#client, prepared.authorityId) !== null) {
      throw new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.");
    }
    if (stored === null || !generationMatches(stored, prepared)) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic generation identity conflicts.");
    }
    const memberships = await readMemberships(this.#client, stored);
    if (canonicalJson(memberships) !== canonicalJson(prepared.memberships.map((membership) => ({
      inputSha256: membership.inputSha256,
      ordinal: membership.ordinal,
      recordKey: membership.recordKey,
      recordSha256: membership.recordSha256,
    })))) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic generation membership conflicts.");
    }
    return Object.freeze({
      authorityId: prepared.authorityId,
      chunks: prepared.chunkCount,
      documents: prepared.documentCount,
      embedded: missing.length,
      generation: prepared.generation,
      generationSha256: prepared.generationSha256,
      isolationSha256: prepared.isolationSha256,
      membershipSha256: prepared.membershipSha256,
      reused: orderedInputs.length - missing.length,
      status: "staged",
      v: 2,
    });
  }

  async publish(input: Readonly<{
    authorityId: string;
    expectedPublishedGeneration: number | null;
    generation: number;
    isolationSha256?: Sha256Hex;
    publishedAt?: string;
  }>): Promise<OhSemanticPublishResultV2> {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    const isolation = isolationSha256(authorityId, input.isolationSha256);
    const generationNumber = parseGeneration(input.generation);
    const expected = input.expectedPublishedGeneration === null
      ? null : parseGeneration(input.expectedPublishedGeneration);
    const publishedAt = parseInstant(input.publishedAt ?? canonicalNow());
    if (await readPurge(this.#client, authorityId) !== null) {
      throw new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.");
    }
    const generation = await readGeneration(this.#client, authorityId, generationNumber);
    if (generation === null || generation.isolationSha256 !== isolation) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic generation is not staged.");
    }
    await readMemberships(this.#client, generation);
    const before = await readHead(this.#client, authorityId);
    if (before !== null && headMatchesGeneration(before, generation)) {
      return Object.freeze({
        authorityId,
        generation: generationNumber,
        generationSha256: generation.generationSha256,
        isolationSha256: isolation,
        published: false,
        v: 2,
      });
    }
    if ((before === null) !== (expected === null)
      || (before !== null && before.generation !== expected)
      || (before !== null && generationNumber < before.generation)) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic published-head precondition failed.");
    }
    let result: OhLibSqlResultV1;
    const values = [generation.authorityId, generation.generation,
      generation.authoritySha256, generation.isolationSha256,
      generation.profileSha256, generation.rendererSha256,
      generation.membershipSha256, generation.generationSha256, publishedAt];
    if (expected === null) {
      result = await this.#client.execute({
        args: [...values, generation.authorityId, generation.generation,
          generation.generationSha256, generation.isolationSha256, authorityId, authorityId],
        sql: `INSERT INTO oh_semantic_heads(authority_id, generation,
          authority_sha256, isolation_sha256, profile_sha256, renderer_sha256, membership_sha256,
          generation_sha256, published_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM oh_semantic_generations
            WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?
              AND isolation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_heads WHERE authority_id = ?)
          ON CONFLICT DO NOTHING`,
      });
    } else {
      result = await this.#client.execute({
        args: [generation.generation, generation.authoritySha256, generation.isolationSha256,
          generation.profileSha256, generation.rendererSha256, generation.membershipSha256,
          generation.generationSha256, publishedAt, authorityId, expected,
          generation.authorityId, generation.generation, generation.generationSha256,
          generation.isolationSha256, authorityId],
        sql: `UPDATE oh_semantic_heads SET generation = ?, authority_sha256 = ?,
          isolation_sha256 = ?, profile_sha256 = ?, renderer_sha256 = ?, membership_sha256 = ?,
          generation_sha256 = ?, published_at = ?
          WHERE authority_id = ? AND generation = ?
            AND EXISTS (SELECT 1 FROM oh_semantic_generations
              WHERE authority_id = ? AND generation = ? AND generation_sha256 = ?
                AND isolation_sha256 = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_purges WHERE authority_id = ?)`,
      });
    }
    if (await readPurge(this.#client, authorityId) !== null) {
      throw new OhLibSqlSemanticV2Error("purged", "The semantic authority was purged.");
    }
    const after = await readHead(this.#client, authorityId);
    if (after === null || !headMatchesGeneration(after, generation)) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic published head did not converge.");
    }
    return Object.freeze({
      authorityId,
      generation: generationNumber,
      generationSha256: generation.generationSha256,
      isolationSha256: isolation,
      published: rowsAffected(result) > 0,
      v: 2,
    });
  }

  async search(input: Readonly<{
    authority: OhSemanticAuthorityRefV2;
    embeddingClient: OhCloudflareEmbeddingClientV1;
    limit?: number;
    query: string;
    signal?: AbortSignal;
  }>): Promise<readonly OhSemanticSearchResultV2[]> {
    this.#open();
    validateEmbeddingClient(input.embeddingClient);
    const authorityId = parseAuthorityId(input.authority.authorityId);
    const authoritySha256 = parseDigest(input.authority.authoritySha256, "authority");
    const isolation = isolationSha256(authorityId, input.authority.isolationSha256);
    const authorityGeneration = parseGeneration(input.authority.generation);
    const limit = input.limit ?? 10;
    if (input.authority.v !== 2 || !Number.isSafeInteger(limit) || limit < 1
      || limit > OH_LIBSQL_SEMANTIC_LIMITS_V2.searchLimit
      || !Array.isArray(input.authority.records)
      || input.authority.records.length > OH_LIBSQL_SEMANTIC_LIMITS_V2.documentsPerGeneration) {
      throw new OhLibSqlSemanticV2Error("invalid-input", "Invalid semantic search authority or limit.");
    }
    const records = new Map<string, Sha256Hex>();
    for (const record of input.authority.records) {
      const key = parseRecordKey(record.key);
      const recordSha256 = parseDigest(record.recordSha256, "record");
      if (records.has(key)) throw new OhLibSqlSemanticV2Error("invalid-input", "Duplicate authority record key.");
      records.set(key, recordSha256);
    }
    if (await readPurge(this.#client, authorityId) !== null) return Object.freeze([]);
    const head = await readHead(this.#client, authorityId);
    if (head === null || head.authoritySha256 !== authoritySha256
      || head.generation !== authorityGeneration
      || head.isolationSha256 !== isolation
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
      throw new OhLibSqlSemanticV2Error("integrity", "The query embedding response is invalid.");
    }
    const normalizedQuery = normalizeOhEmbeddingV1(queryVector);
    const best = new Map<string, OhSemanticSearchResultV2>();
    let scanned = 0;
    for (let offset = 0; offset < generation.chunkCount;
      offset += OH_LIBSQL_SEMANTIC_LIMITS_V2.searchPage) {
      const result = await this.#client.execute({
        args: [OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
          OH_SEMANTIC_RENDERER_V1.rendererSha256, authorityId, authorityGeneration,
          isolation, OH_LIBSQL_SEMANTIC_LIMITS_V2.searchPage, offset],
        sql: `SELECT membership.generation_sha256, membership.isolation_sha256,
          membership.record_key,
          membership.record_sha256, membership.ordinal, membership.input_sha256,
          vector.vector_sha256, vector.vector
          FROM oh_semantic_memberships AS membership
          JOIN oh_semantic_vectors AS vector
            ON vector.input_sha256 = membership.input_sha256
            AND vector.isolation_sha256 = membership.isolation_sha256
            AND vector.profile_sha256 = ? AND vector.renderer_sha256 = ?
          WHERE membership.authority_id = ? AND membership.generation = ?
            AND membership.isolation_sha256 = ?
          ORDER BY membership.record_key, membership.ordinal LIMIT ? OFFSET ?`,
      });
      for (const row of result.rows) {
        scanned += 1;
        const generationSha256 = parseSha256Hex(rowValue(row, "generation_sha256", 0));
        const storedIsolation = parseSha256Hex(rowValue(row, "isolation_sha256", 1));
        const key = safeCode(rowValue(row, "record_key", 2), 512);
        const recordSha256 = parseSha256Hex(rowValue(row, "record_sha256", 3));
        const ordinal = integer(rowValue(row, "ordinal", 4));
        const inputSha256 = parseSha256Hex(rowValue(row, "input_sha256", 5));
        const vectorSha256 = parseSha256Hex(rowValue(row, "vector_sha256", 6));
        if (generationSha256 !== generation.generationSha256
          || storedIsolation !== isolation || key === null
          || recordSha256 === null || ordinal === null || ordinal < 0
          || ordinal >= OH_LIBSQL_SEMANTIC_LIMITS_V2.chunksPerDocument
          || inputSha256 === null || vectorSha256 === null) {
          throw new OhLibSqlSemanticV2Error("integrity", "A semantic search row is invalid.");
        }
        if (records.get(key) !== recordSha256) continue;
        const vector = decodeVector(rowValue(row, "vector", 7), vectorSha256);
        let score = 0;
        for (let index = 0; index < normalizedQuery.length; index += 1) {
          score += (normalizedQuery[index] as number) * (vector[index] as number);
        }
        score = Math.max(-1, Math.min(1, score));
        const previous = best.get(key);
        if (previous === undefined || score > previous.score
          || (score === previous.score && ordinal < previous.chunkOrdinal)) {
          best.set(key, Object.freeze({ chunkOrdinal: ordinal, key, recordSha256, score, v: 2 }));
        }
      }
    }
    if (scanned !== generation.chunkCount) {
      throw new OhLibSqlSemanticV2Error("integrity", "The semantic search scan is incomplete.");
    }
    const finalHead = await readHead(this.#client, authorityId);
    if (finalHead === null || canonicalJson(finalHead) !== canonicalJson(head)
      || await readPurge(this.#client, authorityId) !== null) return Object.freeze([]);
    return Object.freeze([...best.values()]
      .sort((left, right) => right.score - left.score
        || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
      .slice(0, limit));
  }

  /** Reads the immutable, content-free receipt for a completed purge. */
  async purgeReceipt(input: Readonly<{
    authorityId: string;
    isolationSha256?: Sha256Hex;
  }>): Promise<OhSemanticPurgeResultV2 | null> {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    const isolation = isolationSha256(authorityId, input.isolationSha256);
    const receipt = await readPurge(this.#client, authorityId);
    if (receipt === null) return null;
    if (receipt.isolationSha256 !== isolation) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.");
    }
    await verifyPurgeResidual(this.#client, authorityId);
    return receipt;
  }

  async purgeAuthority(input: Readonly<{
    authorityId: string;
    isolationSha256?: Sha256Hex;
    purgedAt?: string;
  }>): Promise<OhSemanticPurgeResultV2> {
    this.#open();
    const authorityId = parseAuthorityId(input.authorityId);
    const isolation = isolationSha256(authorityId, input.isolationSha256);
    const previous = await readPurge(this.#client, authorityId);
    if (previous !== null) {
      if (previous.isolationSha256 !== isolation) {
        throw new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.");
      }
      await verifyPurgeResidual(this.#client, authorityId);
      return previous;
    }
    const requestedAt = parseInstant(input.purgedAt ?? canonicalNow());
    await reservePurgeIsolation(this.#client, authorityId, isolation, requestedAt);
    const markerSha256 = purgeMarkerSha256(authorityId, isolation, requestedAt);
    await this.#client.batch([
      {
        args: [authorityId, isolation, OH_CLOUDFLARE_EMBEDDING_PROFILE_V1.profileSha256,
          authorityId, authorityId, requestedAt, markerSha256,
          authorityId, authorityId, authorityId, authorityId,
          isolation, authorityId, authorityId, isolation],
        sql: `INSERT INTO oh_semantic_purges(authority_id, isolation_sha256,
          profile_sha256, published_generation, published_generation_sha256,
          purged_at, purge_marker_sha256, generation_count, membership_count,
          orphan_vector_count, isolation_scope_count, counts_recorded)
          SELECT ?, ?, ?,
            (SELECT generation FROM oh_semantic_heads WHERE authority_id = ?),
            (SELECT generation_sha256 FROM oh_semantic_heads WHERE authority_id = ?),
            ?, ?,
            (SELECT count(*) FROM oh_semantic_generations WHERE authority_id = ?),
            (SELECT count(*) FROM oh_semantic_memberships WHERE authority_id = ?),
            (SELECT count(*) FROM oh_semantic_vectors AS vector
              JOIN oh_semantic_isolations AS isolation
                ON isolation.isolation_sha256 = vector.isolation_sha256
              WHERE isolation.authority_id = ?),
            (SELECT count(*) FROM oh_semantic_isolations WHERE authority_id = ?),
            1
          WHERE EXISTS (SELECT 1 FROM oh_semantic_isolations
              WHERE isolation_sha256 = ? AND authority_id = ?)
            AND NOT EXISTS (SELECT 1 FROM oh_semantic_heads
              WHERE authority_id = ? AND isolation_sha256 <> ?)
          ON CONFLICT DO NOTHING`,
      },
      {
        args: [authorityId, authorityId, isolation],
        sql: `DELETE FROM oh_semantic_heads WHERE authority_id = ?
          AND EXISTS (SELECT 1 FROM oh_semantic_purges
            WHERE authority_id = ? AND isolation_sha256 = ?)`,
      },
      {
        args: [authorityId, authorityId, isolation],
        sql: `DELETE FROM oh_semantic_memberships WHERE authority_id = ?
          AND EXISTS (SELECT 1 FROM oh_semantic_purges
            WHERE authority_id = ? AND isolation_sha256 = ?)`,
      },
      {
        args: [authorityId, authorityId, isolation],
        sql: `DELETE FROM oh_semantic_vectors
          WHERE isolation_sha256 IN (SELECT isolation_sha256
            FROM oh_semantic_isolations WHERE authority_id = ?)
            AND EXISTS (SELECT 1 FROM oh_semantic_purges
              WHERE authority_id = ? AND isolation_sha256 = ?)`,
      },
      {
        args: [authorityId, authorityId, isolation],
        sql: `DELETE FROM oh_semantic_generations WHERE authority_id = ?
          AND EXISTS (SELECT 1 FROM oh_semantic_purges
            WHERE authority_id = ? AND isolation_sha256 = ?)`,
      },
    ], "write");
    const receipt = await readPurge(this.#client, authorityId);
    if (receipt === null) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic purge identity changed before tombstoning.");
    }
    if (receipt.isolationSha256 !== isolation) {
      throw new OhLibSqlSemanticV2Error("conflict", "The semantic purge isolation conflicts.");
    }
    await verifyPurgeResidual(this.#client, authorityId);
    return receipt;
  }
}

export async function openOhLibSqlSemanticCacheV2(
  client: OhLibSqlClientV1,
  options: Readonly<{ closeClient?: boolean }> = {},
): Promise<OhLibSqlSemanticCacheV2> {
  return await OhLibSqlSemanticCacheV2.open(client, options.closeClient ?? false);
}
